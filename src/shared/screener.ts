/**
 * Screener: metrics computed from official figures (SEC / ESEF), your notebook
 * figures and the latest price — never scraped, never estimated.
 *
 *  - Every value says how it was obtained (formula, period) or why it is missing.
 *  - Price is converted to the statements' currency with ECB rates; if that is
 *    impossible, price-based metrics are null ("sin tipo de cambio").
 *  - Scores are percentiles WITHIN the universe you are screening (your
 *    companies), so they are relative, transparent and recomputable.
 */
import { annualPeriods, cagr, qualityReport, roicSeries } from './analysis';
import type { FigureTable, MetricId } from './finance';
import type { SectorKind } from './valuation';

export type ScreenKey =
  | 'price'
  | 'change_day'
  | 'market_cap_eur'
  | 'per'
  | 'p_fcf'
  | 'fcf_yield'
  | 'ev_ebitda'
  | 'p_sales'
  | 'p_book'
  | 'div_yield'
  | 'payout'
  | 'roic'
  | 'roe'
  | 'gross_margin'
  | 'op_margin'
  | 'net_margin'
  | 'fcf_margin'
  | 'net_debt_ebitda'
  | 'debt_equity'
  | 'dilution'
  | 'rev_cagr3'
  | 'eps_cagr3'
  | 'dps_growth'
  | 'quality_strong'
  | 'score_quality'
  | 'score_value';

export interface ScreenMetricDef {
  key: ScreenKey;
  label: string;
  group: 'Mercado' | 'Valoración' | 'Rentabilidad' | 'Solidez' | 'Dividendo' | 'Crecimiento' | 'Puntuaciones';
  fmt: 'pct' | 'x' | 'num' | 'money' | 'score' | 'count';
  /** For percentile scores and "best" highlighting. */
  better?: 'high' | 'low';
}

export const SCREEN_METRICS: ScreenMetricDef[] = [
  { key: 'price', label: 'Precio', group: 'Mercado', fmt: 'num' },
  { key: 'change_day', label: 'Día %', group: 'Mercado', fmt: 'pct', better: 'high' },
  { key: 'market_cap_eur', label: 'Capitalización (M€)', group: 'Mercado', fmt: 'money' },
  { key: 'per', label: 'PER', group: 'Valoración', fmt: 'x', better: 'low' },
  { key: 'p_fcf', label: 'P/FCL', group: 'Valoración', fmt: 'x', better: 'low' },
  { key: 'fcf_yield', label: 'Rentab. FCL', group: 'Valoración', fmt: 'pct', better: 'high' },
  { key: 'ev_ebitda', label: 'EV/EBITDA', group: 'Valoración', fmt: 'x', better: 'low' },
  { key: 'p_sales', label: 'P/Ventas', group: 'Valoración', fmt: 'x', better: 'low' },
  { key: 'p_book', label: 'P/Valor contable', group: 'Valoración', fmt: 'x', better: 'low' },
  { key: 'div_yield', label: 'Rentab. dividendo', group: 'Dividendo', fmt: 'pct', better: 'high' },
  { key: 'payout', label: 'Payout', group: 'Dividendo', fmt: 'pct', better: 'low' },
  { key: 'dps_growth', label: 'Crec. DPA 1a', group: 'Dividendo', fmt: 'pct', better: 'high' },
  { key: 'roic', label: 'ROIC', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'roe', label: 'ROE', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'gross_margin', label: 'Margen bruto', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'op_margin', label: 'Margen operativo', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'net_margin', label: 'Margen neto', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'fcf_margin', label: 'Margen FCL', group: 'Rentabilidad', fmt: 'pct', better: 'high' },
  { key: 'net_debt_ebitda', label: 'Deuda neta/EBITDA', group: 'Solidez', fmt: 'x', better: 'low' },
  { key: 'debt_equity', label: 'Deuda/Patrimonio', group: 'Solidez', fmt: 'x', better: 'low' },
  { key: 'dilution', label: 'Cambio nº acciones 1a', group: 'Solidez', fmt: 'pct', better: 'low' },
  { key: 'rev_cagr3', label: 'Crec. ingresos (CAGR 3a)', group: 'Crecimiento', fmt: 'pct', better: 'high' },
  { key: 'eps_cagr3', label: 'Crec. BPA (CAGR 3a)', group: 'Crecimiento', fmt: 'pct', better: 'high' },
  { key: 'quality_strong', label: 'Criterios de calidad fuertes', group: 'Puntuaciones', fmt: 'count', better: 'high' },
  { key: 'score_quality', label: 'Puntuación calidad', group: 'Puntuaciones', fmt: 'score', better: 'high' },
  { key: 'score_value', label: 'Puntuación valor', group: 'Puntuaciones', fmt: 'score', better: 'high' },
];
export const SCREEN_METRIC = Object.fromEntries(SCREEN_METRICS.map((m) => [m.key, m])) as Record<ScreenKey, ScreenMetricDef>;

export interface Cell {
  value: number | null;
  /** How it was obtained, or why it is missing. Shown as a tooltip. */
  note: string;
}

export interface ScreenInput {
  table: FigureTable;
  sector: SectorKind;
  /** Price already converted to the statements' currency (null if impossible). */
  priceInStatements: number | null;
  priceNote: string | null;
  /** Market cap in EUR for sorting across currencies (null if no rate). */
  priceInEur: number | null;
  changePct: number | null;
}

const ok = (value: number | null, note: string): Cell => ({ value: value !== null && Number.isFinite(value) ? value : null, note });
const miss = (why: string): Cell => ({ value: null, note: why });

/** Raw metrics of one company (scores are added by `scoreUniverse`). */
export function screenMetrics(inp: ScreenInput): Record<ScreenKey, Cell> {
  const t = inp.table;
  const years = annualPeriods(t);
  const last = years.at(-1) ?? null;
  const prevLabel = last ? `FY${Number(last.slice(2)) - 1}` : null;
  const prev = prevLabel && years.includes(prevLabel) ? prevLabel : null;
  const g = (m: MetricId, p: string | null = last) => (p ? (t.get(p)?.get(m)?.value ?? null) : null);
  const at = last ? ` (${last})` : '';
  const out = {} as Record<ScreenKey, Cell>;
  const noPrice = inp.priceNote ?? 'Sin precio';

  const price = inp.priceInStatements;
  const shares = g('diluted_shares');
  const mcap = price !== null && shares !== null ? price * shares : null;
  const ni = g('net_income');
  const rev = g('revenue');
  const fcf = g('fcf');
  const op = g('operating_income') ?? g('ebit');
  const ebitda = g('ebitda') ?? (op !== null && g('dna') !== null ? op + g('dna')! : null);
  const ebitdaNote = g('ebitda') !== null ? 'EBITDA publicado' : 'EBITDA = beneficio operativo + amortizaciones';
  const debt = g('gross_debt');
  const cash = g('cash');
  const equity = g('equity');
  const dps = g('dividend_per_share');

  out.price = ok(price, inp.priceNote ?? 'Último precio disponible');
  out.change_day = ok(inp.changePct === null ? null : inp.changePct / 100, 'Variación del día según el proveedor');
  out.market_cap_eur = inp.priceInEur !== null && shares !== null ? ok((inp.priceInEur * shares) / 1e6, `Precio en € × acciones diluidas${at}`) : miss(mcap === null ? (price === null ? noPrice : 'Faltan acciones diluidas') : 'Sin tipo de cambio a euros');

  const pos = (x: number | null) => x !== null && x > 0;
  out.per = mcap === null ? miss(price === null ? noPrice : 'Faltan acciones') : pos(ni) ? ok(mcap / ni!, `Capitalización / beneficio neto${at}`) : miss('Beneficio neto nulo o negativo');
  out.p_fcf = mcap === null ? miss(price === null ? noPrice : 'Faltan acciones') : pos(fcf) ? ok(mcap / fcf!, `Capitalización / FCL${at}`) : miss('FCL nulo o negativo');
  out.fcf_yield = mcap !== null && mcap > 0 && fcf !== null ? ok(fcf / mcap, `FCL${at} / capitalización`) : miss(mcap === null ? noPrice : 'Falta el FCL');
  const ev = mcap !== null && debt !== null && cash !== null ? mcap + debt - cash : null;
  out.ev_ebitda =
    inp.sector === 'bank' || inp.sector === 'insurer'
      ? miss('No aplicable a bancos y aseguradoras')
      : ev === null
        ? miss(mcap === null ? noPrice : 'Faltan deuda o caja')
        : pos(ebitda)
          ? ok(ev / ebitda!, `EV / EBITDA${at} · ${ebitdaNote}`)
          : miss('Falta el EBITDA (ni publicado ni beneficio operativo + amortizaciones)');
  out.p_sales = mcap !== null && pos(rev) ? ok(mcap / rev!, `Capitalización / ingresos${at}`) : miss(mcap === null ? noPrice : 'Faltan ingresos');
  out.p_book = mcap !== null && pos(equity) ? ok(mcap / equity!, `Capitalización / patrimonio neto${at}`) : miss(mcap === null ? noPrice : 'Falta patrimonio neto positivo');
  out.div_yield = dps !== null && price !== null && price > 0 ? ok(dps / price, `DPA${at} / precio`) : miss(dps === null ? 'Sin dividendo por acción en las cuentas' : noPrice);
  out.payout = dps !== null && shares !== null && pos(ni) ? ok((dps * shares) / ni!, `DPA × acciones / beneficio neto${at}`) : miss('Faltan DPA, acciones o beneficio');
  const dpsPrev = g('dividend_per_share', prev);
  out.dps_growth = dps !== null && dpsPrev !== null && dpsPrev > 0 ? ok(dps / dpsPrev - 1, `DPA ${prev} → ${last}`) : miss('Faltan dos años de DPA');

  const roic = roicSeries(t).at(-1);
  out.roic = roic?.roic !== null && roic?.roic !== undefined ? ok(roic.roic, `NOPAT / capital invertido medio (${roic.period})`) : miss(roic?.reason ?? 'Faltan datos');
  const eqPrev = g('equity', prev);
  const avgEq = equity !== null && eqPrev !== null ? (equity + eqPrev) / 2 : equity;
  out.roe = ni !== null && avgEq !== null && avgEq > 0 ? ok(ni / avgEq, `Beneficio neto / patrimonio medio${at}`) : miss('Faltan beneficio o patrimonio positivo');
  const margin = (num: number | null, label: string) => (num !== null && pos(rev) ? ok(num / rev!, `${label} / ingresos${at}`) : miss(`Falta ${label.toLowerCase()} o ingresos`));
  out.gross_margin = margin(g('gross_profit'), 'Beneficio bruto');
  out.op_margin = margin(op, 'Beneficio operativo');
  out.net_margin = margin(ni, 'Beneficio neto');
  out.fcf_margin = margin(fcf, 'FCL');

  out.net_debt_ebitda =
    inp.sector === 'bank' || inp.sector === 'insurer'
      ? miss('No aplicable a bancos y aseguradoras')
      : debt !== null && cash !== null && pos(ebitda)
        ? ok((debt - cash) / ebitda!, `(Deuda − caja) / EBITDA${at} · ${ebitdaNote}`)
        : miss('Faltan deuda, caja o EBITDA');
  out.debt_equity = debt !== null && pos(equity) ? ok(debt / equity!, `Deuda bruta / patrimonio${at}`) : miss('Faltan deuda o patrimonio positivo');
  const shPrev = g('diluted_shares', prev);
  out.dilution = shares !== null && shPrev !== null && shPrev > 0 ? ok(shares / shPrev - 1, `Acciones diluidas ${prev} → ${last}`) : miss('Faltan dos años de acciones');

  // Exactly three fiscal years apart (gaps in the data never stretch the period).
  const three = last && years.includes(`FY${Number(last.slice(2)) - 3}`) ? `FY${Number(last.slice(2)) - 3}` : null;
  const c3 = (a: number | null, b: number | null) => (a !== null && b !== null ? cagr(a, b, 3) : null);
  const revCagr = three ? c3(g('revenue', three), rev) : null;
  out.rev_cagr3 = revCagr !== null ? ok(revCagr, `Ingresos ${three} → ${last}`) : miss('Faltan 4 ejercicios de ingresos positivos');
  const epsCagr = three ? c3(g('eps_diluted', three), g('eps_diluted')) : null;
  out.eps_cagr3 = epsCagr !== null ? ok(epsCagr, `BPA diluido ${three} → ${last}`) : miss('Faltan 4 ejercicios de BPA positivo');

  const q = qualityReport(t, inp.sector);
  out.quality_strong = q.evaluable ? ok(q.strong, `${q.strong} de ${q.evaluable} criterios evaluables (pestaña Calidad del dossier)`) : miss('Sin datos suficientes');
  out.score_quality = miss('Se calcula sobre el universo');
  out.score_value = miss('Se calcula sobre el universo');
  return out;
}

const QUALITY_PARTS: [ScreenKey, 'high' | 'low'][] = [
  ['roic', 'high'],
  ['op_margin', 'high'],
  ['fcf_margin', 'high'],
  ['debt_equity', 'low'],
  ['dilution', 'low'],
];
const VALUE_PARTS: [ScreenKey, 'high' | 'low'][] = [
  ['per', 'low'],
  ['p_fcf', 'low'],
  ['ev_ebitda', 'low'],
];

/**
 * Percentile scores (0–100) within the universe: average of the percentiles of
 * each part the company has; needs at least 2 parts and 3 companies with data.
 */
export function scoreUniverse(rows: Record<ScreenKey, Cell>[]): void {
  const pctFn = (key: ScreenKey, better: 'high' | 'low') => {
    const vals = rows.map((r) => r[key].value).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return (v: number | null) => {
      if (v === null || vals.length < 3) return null;
      const below = vals.filter((x) => x < v).length;
      const equal = vals.filter((x) => x === v).length;
      const p = (below + (equal - 1) / 2) / (vals.length - 1);
      return better === 'high' ? p : 1 - p;
    };
  };
  const build = (parts: [ScreenKey, 'high' | 'low'][], label: string, key: 'score_quality' | 'score_value') => {
    const fns = parts.map(([k, b]) => [k, pctFn(k, b)] as const);
    for (const r of rows) {
      const got = fns.map(([k, f]) => [k, f(r[k].value)] as const).filter(([, v]) => v !== null) as [ScreenKey, number][];
      r[key] =
        got.length >= 2
          ? ok(Math.round((100 * got.reduce((s, [, v]) => s + v, 0)) / got.length), `${label}: media del percentil en tu universo de ${got.map(([k]) => SCREEN_METRIC[k].label).join(', ')}`)
          : miss('Menos de 2 componentes con dato (o menos de 3 empresas comparables)');
    }
  };
  build(QUALITY_PARTS, 'Calidad', 'score_quality');
  build(VALUE_PARTS, 'Valor', 'score_value');
}

export interface Preset {
  id: string;
  label: string;
  note: string;
  /** key → [min, max] (either may be undefined) */
  f: Partial<Record<ScreenKey, [number | undefined, number | undefined]>>;
}

/** Adapted from your "Calidad y Screener" dashboard; only rules computable from official data. */
export const PRESETS: Preset[] = [
  { id: 'compounders', label: 'Compounders de calidad', note: 'ROIC ≥ 15 %, margen operativo ≥ 20 %, margen FCL ≥ 15 % y deuda/patrimonio ≤ 1,5.', f: { roic: [0.15, undefined], op_margin: [0.2, undefined], fcf_margin: [0.15, undefined], debt_equity: [undefined, 1.5] } },
  { id: 'garp', label: 'Calidad a precio razonable', note: 'ROIC ≥ 15 % con PER ≤ 20 y P/FCL ≤ 25.', f: { roic: [0.15, undefined], per: [undefined, 20], p_fcf: [undefined, 25] } },
  { id: 'divcreciente', label: 'Dividendo creciente', note: 'Rentabilidad ≥ 2 %, payout ≤ 75 % y DPA al alza en el último año.', f: { div_yield: [0.02, undefined], payout: [undefined, 0.75], dps_growth: [0.0001, undefined] } },
  { id: 'fcf', label: 'Máquinas de caja', note: 'Rentabilidad FCL ≥ 5 % y margen FCL ≥ 15 %.', f: { fcf_yield: [0.05, undefined], fcf_margin: [0.15, undefined] } },
  { id: 'recompras', label: 'Recompras', note: 'Reducen sus acciones un 2 % o más en un año con ROIC ≥ 10 %.', f: { dilution: [undefined, -0.02], roic: [0.1, undefined] } },
  { id: 'crecimiento', label: 'Crecimiento rentable', note: 'Ingresos +10 % anual en 3 años con ROIC ≥ 12 %.', f: { rev_cagr3: [0.1, undefined], roic: [0.12, undefined] } },
  { id: 'solidez', label: 'Balance a prueba de bombas', note: 'Deuda neta/EBITDA ≤ 1 y deuda/patrimonio ≤ 0,5.', f: { net_debt_ebitda: [undefined, 1], debt_equity: [undefined, 0.5] } },
  { id: 'rentas', label: 'Rentas altas sostenibles', note: 'Rentabilidad ≥ 4 % con payout ≤ 80 % y ROIC ≥ 8 %.', f: { div_yield: [0.04, undefined], payout: [undefined, 0.8], roic: [0.08, undefined] } },
];

export const VIEWS: Record<string, ScreenKey[]> = {
  Resumen: ['market_cap_eur', 'per', 'fcf_yield', 'roic', 'op_margin', 'div_yield', 'rev_cagr3', 'score_quality', 'score_value'],
  Valoración: ['price', 'per', 'p_fcf', 'fcf_yield', 'ev_ebitda', 'p_sales', 'p_book', 'score_value'],
  Rentabilidad: ['roic', 'roe', 'gross_margin', 'op_margin', 'net_margin', 'fcf_margin', 'quality_strong', 'score_quality'],
  Solidez: ['net_debt_ebitda', 'debt_equity', 'dilution', 'quality_strong'],
  Dividendo: ['div_yield', 'payout', 'dps_growth', 'fcf_yield'],
  Crecimiento: ['rev_cagr3', 'eps_cagr3', 'dps_growth', 'roic'],
  Mercado: ['price', 'change_day', 'market_cap_eur', 'per', 'score_value'],
};

/** A company passes when every bound it is tested on has data and is satisfied (missing data never passes). */
export function passes(row: Record<ScreenKey, Cell>, f: Preset['f']): boolean {
  for (const [k, [min, max]] of Object.entries(f) as [ScreenKey, [number | undefined, number | undefined]][]) {
    const v = row[k]?.value ?? null;
    if (v === null) return false;
    if (min !== undefined && v < min) return false;
    if (max !== undefined && v > max) return false;
  }
  return true;
}
