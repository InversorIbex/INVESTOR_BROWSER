/**
 * Portfolio maths: FIFO lots (as Spanish IRPF requires), fees, and the split of
 * an unrealised gain in euros into price effect and currency effect.
 *
 * Conventions:
 *  - Base currency: EUR.
 *  - Each operation keeps the exchange rate of its day as `fxPerEur`
 *    (units of the quote currency per 1 EUR; 1 for EUR).
 *  - Prices are in the quote currency, with London prices in GBP (not pence).
 *  - Fees are in EUR (what the broker charged).
 *  - Nothing is invented: a missing price or rate gives null, never 0.
 */

export type Side = 'buy' | 'sell';

export interface PortfolioOp {
  id?: number;
  companyId: number;
  date: string | null; // YYYY-MM-DD; null = opening position without date
  side: Side;
  qty: number;
  price: number;
  currency: string;
  feeEur: number;
  fxPerEur: number;
  source?: 'manual' | 'inicial' | 'import';
  createdAt?: number;
}

export interface Lot {
  qty: number;
  /** Cost per share in quote currency, fee included. */
  unitLocal: number;
  /** Cost per share in EUR at the operation's exchange rate, fee included. */
  unitEur: number;
  date: string | null;
}

export interface Position {
  lots: Lot[];
  shares: number;
  avgCost: number | null;
  costEur: number;
  realizedByYear: Record<string, number>;
  realizedTotal: number;
  /** e.g. sales of more shares than were bought */
  warning: string | null;
  ops: number;
}

const EPS = 1e-9;

export function sortOps<T extends Pick<PortfolioOp, 'date' | 'createdAt' | 'id'>>(ops: T[]): T[] {
  return ops.slice().sort((a, b) => {
    const da = a.date ?? '0000-00-00';
    const db = b.date ?? '0000-00-00';
    if (da !== db) return da < db ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id ?? 0) - (b.id ?? 0);
  });
}

/** FIFO position from a list of operations of ONE company. */
export function fifo(ops: PortfolioOp[]): Position {
  const lots: Lot[] = [];
  const realizedByYear: Record<string, number> = {};
  let realizedTotal = 0;
  let warning: string | null = null;
  for (const o of sortOps(ops)) {
    if (!(o.qty > 0) || !(o.price >= 0) || !(o.fxPerEur > 0)) continue;
    if (o.side === 'buy') {
      const gross = o.qty * o.price;
      lots.push({ qty: o.qty, unitLocal: (gross + o.feeEur * o.fxPerEur) / o.qty, unitEur: (gross / o.fxPerEur + o.feeEur) / o.qty, date: o.date });
      continue;
    }
    // Sell: consume the oldest lots first
    let left = o.qty;
    let costEur = 0;
    while (left > EPS && lots.length) {
      const lot = lots[0]!;
      const take = Math.min(left, lot.qty);
      costEur += take * lot.unitEur;
      lot.qty -= take;
      left -= take;
      if (lot.qty <= EPS) lots.shift();
    }
    if (left > EPS) warning = 'Hay ventas de más acciones de las compradas.';
    const sold = o.qty - left;
    const proceedsEur = (o.qty * o.price) / o.fxPerEur - o.feeEur;
    const gain = (sold > 0 ? (proceedsEur * sold) / o.qty : 0) - costEur;
    const year = (o.date ?? '').slice(0, 4) || 'sin fecha';
    realizedByYear[year] = (realizedByYear[year] ?? 0) + gain;
    realizedTotal += gain;
  }
  const shares = round6(lots.reduce((s, l) => s + l.qty, 0));
  return {
    lots,
    shares,
    avgCost: shares > EPS ? lots.reduce((s, l) => s + l.qty * l.unitLocal, 0) / shares : null,
    costEur: lots.reduce((s, l) => s + l.qty * l.unitEur, 0),
    realizedByYear,
    realizedTotal,
    warning,
    ops: ops.length,
  };
}

export interface Valuation {
  valueEur: number;
  costEur: number;
  pnlEur: number;
  pnlPct: number | null;
  /** Gain from the share price moving, at today's rate. */
  priceEffectEur: number;
  /** Gain (or loss) from the currency moving since each purchase. 0 for EUR. */
  fxEffectEur: number;
}

/** Market value and unrealised gain in EUR. null when price or today's rate is missing. */
export function valuePosition(pos: Position, price: number | null, fxPerEurNow: number | null): Valuation | null {
  if (price === null || !(price > 0) || !fxPerEurNow || !pos.lots.length) return null;
  const valueEur = pos.lots.reduce((s, l) => s + l.qty * price, 0) / fxPerEurNow;
  const priceEffectEur = pos.lots.reduce((s, l) => s + l.qty * (price - l.unitLocal), 0) / fxPerEurNow;
  const costEur = pos.costEur;
  const pnlEur = valueEur - costEur;
  return { valueEur, costEur, pnlEur, pnlPct: costEur > 0 ? pnlEur / costEur : null, priceEffectEur, fxEffectEur: pnlEur - priceEffectEur };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// ---------------------------------------------------------------- import

export interface ImportedOpRow {
  ticker: string;
  exchange: string | null;
  date: string | null;
  side: Side;
  qty: number;
  price: number;
  feeEur: number;
  fxPerEur: number | null;
  totalEur: number | null;
}

/** Spanish or English decimal numbers: "1.234,56", "1234.56", "24,10". */
export function parseNumber(raw: string | undefined): number | null {
  const s = (raw ?? '').trim().replace(/\s|€|\$/g, '');
  if (!s) return null;
  let n: string;
  if (s.includes(',') && s.includes('.')) n = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) n = s.replace(',', '.');
  else n = s;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return null;
}

const HEADER_ALIASES: Record<string, string> = {
  fecha: 'date', date: 'date',
  ticker: 'ticker', simbolo: 'ticker', símbolo: 'ticker', symbol: 'ticker',
  bolsa: 'exchange', mercado: 'exchange', exchange: 'exchange',
  tipo: 'side', operacion: 'side', operación: 'side', side: 'side', type: 'side',
  acciones: 'qty', cantidad: 'qty', titulos: 'qty', títulos: 'qty', qty: 'qty', shares: 'qty', quantity: 'qty',
  precio: 'price', price: 'price',
  comision: 'fee', comisión: 'fee', comisiones: 'fee', fee: 'fee', fees: 'fee',
  tipo_cambio: 'fx', 'tipo de cambio': 'fx', fx: 'fx',
  total_eur: 'totalEur', 'total eur': 'totalEur', 'total €': 'totalEur',
};

/**
 * Broker CSV (comma, semicolon or tab separated). Required columns: ticker,
 * acciones, precio. Optional: fecha, bolsa, tipo (compra/venta), comision (EUR),
 * tipo_cambio (units per 1 EUR) or total_eur (paid/received in EUR, fees included).
 */
export function parseOpsCsv(text: string): { rows: ImportedOpRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ['El archivo no tiene filas de datos.'] };
  const sep = [';', '\t', ','].find((c) => lines[0]!.includes(c)) ?? ';';
  const head = lines[0]!.split(sep).map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? '');
  const col = (name: string) => head.indexOf(name);
  for (const req of ['ticker', 'qty', 'price']) if (col(req) < 0) errors.push(`Falta la columna «${req === 'qty' ? 'acciones' : req === 'price' ? 'precio' : 'ticker'}».`);
  if (errors.length) return { rows: [], errors };
  const rows: ImportedOpRow[] = [];
  lines.slice(1, 5001).forEach((line, i) => {
    const c = line.split(sep);
    const get = (name: string) => (col(name) >= 0 ? c[col(name)] : undefined);
    const ticker = (get('ticker') ?? '').trim().toUpperCase();
    const qty = parseNumber(get('qty'));
    const price = parseNumber(get('price'));
    const sideRaw = (get('side') ?? 'compra').trim().toLowerCase();
    const side: Side | null = /^(compra|buy|c|b)$/.test(sideRaw) ? 'buy' : /^(venta|sell|v|s)$/.test(sideRaw) ? 'sell' : null;
    const date = get('date') ? parseDate(get('date')) : null;
    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker) || qty === null || qty <= 0 || price === null || price < 0 || !side || (get('date') && !date)) {
      errors.push(`Fila ${i + 2}: no se entiende (${line.slice(0, 60)}).`);
      return;
    }
    rows.push({
      ticker,
      exchange: (get('exchange') ?? '').trim().toUpperCase() || null,
      date,
      side,
      qty: Math.abs(qty),
      price,
      feeEur: Math.abs(parseNumber(get('fee')) ?? 0),
      fxPerEur: parseNumber(get('fx')),
      totalEur: parseNumber(get('totalEur')),
    });
  });
  return { rows, errors };
}

/**
 * Exchange rate implied by what was paid in EUR: for a buy, total = qty·price/fx + fee;
 * for a sale, total = qty·price/fx − fee.
 */
export function impliedFx(row: Pick<ImportedOpRow, 'qty' | 'price' | 'feeEur' | 'totalEur' | 'side'>): number | null {
  if (row.totalEur === null) return null;
  const net = row.side === 'buy' ? row.totalEur - row.feeEur : row.totalEur + row.feeEur;
  if (!(net > 0)) return null;
  return (row.qty * row.price) / net;
}
