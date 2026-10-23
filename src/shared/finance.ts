/**
 * Financial figures: metric catalogue, parsing of numbers copied from reports,
 * and derived metrics that always carry their formula and inputs.
 *
 * Rules (from the product spec):
 *  - Missing data is `null`, never 0.
 *  - Published figures win over own calculations.
 *  - Every calculated value says how it was obtained.
 */

export type MetricId =
  | 'revenue'
  | 'gross_profit'
  | 'operating_income'
  | 'ebit'
  | 'ebitda'
  | 'net_income'
  | 'cfo'
  | 'capex'
  | 'fcf'
  | 'gross_debt'
  | 'cash'
  | 'net_debt'
  | 'diluted_shares'
  | 'dividend_per_share'
  | 'eps_diluted'
  | 'other';

export interface MetricDef {
  id: MetricId;
  label: string;
  short: string;
  /** flow = per period (P&L / cash flow); stock = balance at period end; per_share. */
  kind: 'flow' | 'stock' | 'per_share' | 'count';
  hint?: string;
}

export const METRICS: readonly MetricDef[] = [
  { id: 'revenue', label: 'Ingresos', short: 'Ingresos', kind: 'flow' },
  { id: 'gross_profit', label: 'Beneficio bruto', short: 'B. bruto', kind: 'flow' },
  { id: 'operating_income', label: 'Beneficio operativo', short: 'B. operativo', kind: 'flow' },
  { id: 'ebit', label: 'EBIT', short: 'EBIT', kind: 'flow' },
  { id: 'ebitda', label: 'EBITDA (si la empresa lo publica)', short: 'EBITDA', kind: 'flow' },
  { id: 'net_income', label: 'Beneficio neto', short: 'B. neto', kind: 'flow' },
  { id: 'cfo', label: 'Flujo de caja operativo', short: 'FCO', kind: 'flow' },
  { id: 'capex', label: 'CAPEX (como importe positivo)', short: 'CAPEX', kind: 'flow', hint: 'Introduce la inversión como número positivo aunque el informe la muestre entre paréntesis.' },
  { id: 'fcf', label: 'Flujo de caja libre', short: 'FCL', kind: 'flow' },
  { id: 'gross_debt', label: 'Deuda financiera bruta', short: 'Deuda', kind: 'stock' },
  { id: 'cash', label: 'Caja y equivalentes', short: 'Caja', kind: 'stock' },
  { id: 'net_debt', label: 'Deuda neta', short: 'Deuda neta', kind: 'stock' },
  { id: 'diluted_shares', label: 'Acciones diluidas', short: 'Acciones', kind: 'count' },
  { id: 'dividend_per_share', label: 'Dividendo por acción', short: 'DPA', kind: 'per_share' },
  { id: 'eps_diluted', label: 'BPA diluido', short: 'BPA', kind: 'per_share' },
  { id: 'other', label: 'Otra cifra', short: 'Otra', kind: 'flow' },
];
export const METRIC_IDS = METRICS.map((m) => m.id) as [MetricId, ...MetricId[]];
export const metricDef = (id: string) => METRICS.find((m) => m.id === id) ?? METRICS[METRICS.length - 1]!;

export const SCALES = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 } as const;
export type Scale = keyof typeof SCALES;
export const SCALE_LABEL: Record<Scale, string> = { units: 'unidades', thousands: 'miles', millions: 'millones', billions: 'miles de millones' };

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'DKK', 'SEK', 'NOK', 'CAD', 'AUD', 'HKD', 'CNY', 'INR', 'BRL', 'MXN'] as const;

/** A figure as stored in the notebook (value in the unit shown in the source). */
export interface Figure {
  metric: MetricId;
  period: string; // e.g. FY2025, Q3 2026, H1 2026
  value: number;
  scale: Scale;
  currency: string | null;
  origin: 'published' | 'user' | 'estimate';
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  noteId?: number;
}

// ---------------------------------------------------------------- periods

const PERIOD_RE = /^(FY|Q[1-4]|H[12]|9M|TTM)\s?(\d{4})$/i;
export function normalizePeriod(raw: string): string | null {
  const m = PERIOD_RE.exec(raw.trim().toUpperCase().replace(/\s+/g, ' '));
  if (!m) return null;
  const [, kind, year] = m;
  return kind === 'FY' || kind === 'TTM' ? `${kind}${year}` : `${kind} ${year}`;
}

/** Sort key: year, then sub-period order within the year. */
export function periodSortKey(p: string): number {
  const m = /^(FY|Q[1-4]|H[12]|9M|TTM)\s?(\d{4})$/.exec(p);
  if (!m) return 0;
  const order: Record<string, number> = { Q1: 1, H1: 2, Q2: 2.5, '9M': 3, Q3: 3.5, Q4: 4, H2: 4.2, FY: 5, TTM: 6 };
  return Number(m[2]) * 10 + (order[m[1]!] ?? 0);
}

// ---------------------------------------------------------------- parsing

export interface ParsedFigure {
  value: number;
  scale: Scale | null;
  currency: string | null;
  percent: boolean;
  /** True when the decimal/thousands separator could not be determined with certainty. */
  ambiguous: boolean;
}

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/US\$|USD|\$/i, 'USD'],
  [/€|EUR/i, 'EUR'],
  [/£|GBP/i, 'GBP'],
  [/CHF/i, 'CHF'],
  [/¥|JPY/i, 'JPY'],
  [/DKK/i, 'DKK'],
  [/SEK/i, 'SEK'],
  [/NOK/i, 'NOK'],
];

/**
 * Parse a number copied from a report: "$1,234.5 million", "(2.345)", "1.234,5 M€",
 * "€2,3 mil millones", "12.5%". Returns null if no number is present.
 * The result is a *suggestion*: the UI always lets the user confirm it.
 */
export function parseFigure(text: string): ParsedFigure | null {
  const t = text.replace(/\u00a0/g, ' ').replace(/[\u2212\u2013]/g, '-').trim();
  // Optional "(" or "-", then digits with separators.
  const m = /(\()?\s?(-)?\s?(\d(?:[\d.,']*\d)?)\s?(\))?/.exec(t);
  if (!m) return null;
  const negative = (!!m[1] && !!m[4]) || !!m[2];
  const raw = m[3]!.replace(/[ ']/g, '');

  let ambiguous = false;
  let normalized: string;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    normalized = lastDot > lastComma ? raw.replace(/,/g, '') : raw.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = raw.split(sep);
    const groupsOf3 = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    if (parts.length > 2 && groupsOf3) normalized = parts.join(''); // 1,234,567 / 1.234.567
    else if (parts.length === 2 && groupsOf3) {
      // "1,234" or "1.234": thousands in one convention, decimal in the other.
      // We assume thousands (far more common in financial tables) and flag it.
      ambiguous = true;
      normalized = parts.join('');
    } else normalized = sep === ',' ? raw.replace(',', '.') : raw;
  } else normalized = raw;

  let value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -Math.abs(value);

  const after = t.slice(m.index + m[0].length).toLowerCase();
  const all = t.toLowerCase();
  let scale: Scale | null = null;
  if (/^(mil\s+millones|miles de millones|bn\b|billions?\b|b\b)/.test(after)) scale = 'billions';
  else if (/^(millones|millions?\b|mill\.?|mn\b|mm\b|m\b|m€|m\$)/.test(after)) scale = 'millions';
  else if (/^(miles\b|thousands?\b|k\b|mil\b)/.test(after)) scale = 'thousands';
  else if (/in millions|en millones|millones de/.test(all)) scale = 'millions';
  else if (/in thousands|en miles|miles de/.test(all)) scale = 'thousands';

  let currency: string | null = null;
  for (const [re, code] of CURRENCY_TOKENS)
    if (re.test(t)) {
      currency = code;
      break;
    }
  return { value, scale, currency, percent: after.startsWith('%'), ambiguous };
}

// ---------------------------------------------------------------- derived metrics

export interface ResolvedValue {
  /** Value in base units (scale applied). */
  value: number;
  currency: string | null;
  origin: 'published' | 'calculated' | 'user' | 'estimate';
  /** Human-readable formula for calculated values. */
  formula?: string;
  sources: { url?: string | null; title?: string | null }[];
}

export type FigureTable = Map<string, Map<MetricId, ResolvedValue>>; // period → metric → value

/** Build a period × metric table. Published (and user) figures win; then derived values fill gaps. */
export function buildFigureTable(figures: Figure[]): FigureTable {
  const table: FigureTable = new Map();
  const rank = { published: 3, user: 2, estimate: 1 } as const;
  for (const f of figures) {
    if (!Number.isFinite(f.value)) continue;
    const row = table.get(f.period) ?? new Map<MetricId, ResolvedValue>();
    const existing = row.get(f.metric);
    if (existing && existing.origin !== 'calculated' && rank[existing.origin as keyof typeof rank] > rank[f.origin]) continue;
    row.set(f.metric, {
      value: f.value * SCALES[f.scale],
      currency: f.currency,
      origin: f.origin,
      sources: [{ url: f.sourceUrl, title: f.sourceTitle }],
    });
    table.set(f.period, row);
  }
  for (const row of table.values()) deriveRow(row);
  return table;
}

function sameCurrency(...vals: (ResolvedValue | undefined)[]): boolean {
  const cs = vals.map((v) => v?.currency).filter((c) => c);
  return new Set(cs).size <= 1;
}

function derive(row: Map<MetricId, ResolvedValue>, metric: MetricId, inputs: MetricId[], fn: (...v: number[]) => number | null, formula: string): void {
  if (row.has(metric)) return;
  const vals = inputs.map((m) => row.get(m));
  if (vals.some((v) => v === undefined) || !sameCurrency(...vals)) return;
  const value = fn(...vals.map((v) => v!.value));
  if (value === null || !Number.isFinite(value)) return;
  row.set(metric, {
    value,
    currency: vals.find((v) => v!.currency)?.currency ?? null,
    origin: 'calculated',
    formula,
    sources: vals.flatMap((v) => v!.sources),
  });
}

function deriveRow(row: Map<MetricId, ResolvedValue>): void {
  derive(row, 'fcf', ['cfo', 'capex'], (cfo, capex) => cfo - Math.abs(capex), 'FCL = Flujo de caja operativo − CAPEX');
  derive(row, 'net_debt', ['gross_debt', 'cash'], (d, c) => d - c, 'Deuda neta = Deuda bruta − Caja');
}

export interface Ratio {
  id: 'gross_margin' | 'operating_margin' | 'net_margin' | 'fcf_margin' | 'cash_conversion';
  label: string;
  value: number | null;
  formula: string;
  note?: string;
}

export function ratiosFor(row: Map<MetricId, ResolvedValue> | undefined): Ratio[] {
  const g = (m: MetricId) => row?.get(m)?.value;
  const div = (a?: number, b?: number) => (a === undefined || b === undefined || b === 0 ? null : a / b);
  const rev = g('revenue');
  const ni = g('net_income');
  return [
    { id: 'gross_margin', label: 'Margen bruto', value: div(g('gross_profit'), rev), formula: 'Beneficio bruto / Ingresos' },
    { id: 'operating_margin', label: 'Margen operativo', value: div(g('operating_income') ?? g('ebit'), rev), formula: 'Beneficio operativo (o EBIT) / Ingresos' },
    { id: 'net_margin', label: 'Margen neto', value: div(ni, rev), formula: 'Beneficio neto / Ingresos' },
    { id: 'fcf_margin', label: 'Margen de FCL', value: div(g('fcf'), rev), formula: 'FCL / Ingresos' },
    {
      id: 'cash_conversion',
      label: 'Conversión en caja',
      value: ni !== undefined && ni > 0 ? div(g('cfo'), ni) : null,
      formula: 'Flujo de caja operativo / Beneficio neto',
      note: 'Valores persistentemente < 1 merecen investigar la calidad del beneficio. No implica irregularidad.',
    },
  ];
}

// ---------------------------------------------------------------- formatting

export function formatMoney(value: number | null | undefined, currency: string | null = null, compact = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  let body: string;
  if (compact && abs >= 1e9) body = `${(abs / 1e9).toLocaleString('es-ES', { maximumFractionDigits: 2 })} mil M`;
  else if (compact && abs >= 1e6) body = `${(abs / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M`;
  else body = abs.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return `${sign}${body}${currency ? ' ' + currency : ''}`;
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export function formatMultiple(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`;
}
