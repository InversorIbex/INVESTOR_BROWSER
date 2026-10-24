/**
 * Market calendar: earnings dates and dividends.
 *
 * Every event says whether it is CONFIRMED (published by a provider or the
 * company), ESTIMATED (projected from the company's own history, and labelled
 * so) or YOURS (added by you). Nothing is presented as confirmed without a source.
 *
 * Formats (provider documentation; not verified live from the development
 * environment, parsed defensively):
 *  - Finnhub GET /api/v1/calendar/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD
 *      → {earningsCalendar: [{date, hour: 'bmo'|'amc'|'dmh'|'', epsEstimate, epsActual, quarter, year, symbol, revenueEstimate}]}
 *  - EODHD  GET /api/div/{TICKER.EXCH}?from=YYYY-MM-DD&fmt=json
 *      → [{date (ex-dividend), declarationDate, recordDate, paymentDate, period, value, unadjustedValue, currency}]
 */

export type EventType = 'earnings' | 'exdiv' | 'payment' | 'meeting' | 'other';
export type EventStatus = 'confirmed' | 'estimated' | 'user';

export interface CalEvent {
  id: string;
  companyId: number;
  date: string; // YYYY-MM-DD
  type: EventType;
  status: EventStatus;
  /** Where it comes from, in plain words (shown to the user). */
  source: string;
  detail?: string;
  amount?: number | null;
  currency?: string | null;
  /** Manual events: database id, to delete them. */
  userId?: number;
}

export const EVENT_LABEL: Record<EventType, string> = {
  earnings: 'Resultados',
  exdiv: 'Ex-dividendo',
  payment: 'Pago de dividendo',
  meeting: 'Junta',
  other: 'Otro',
};
export const STATUS_LABEL: Record<EventStatus, string> = { confirmed: 'Confirmada', estimated: 'Estimada', user: 'Tuya' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() && v !== 'NA' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};

export interface EarningsRow {
  symbol: string;
  date: string;
  hour: string;
  epsEstimate: number | null;
  quarter: number | null;
  year: number | null;
}

export function parseFinnhubEarnings(json: unknown): EarningsRow[] {
  const list = (json as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(list)) return [];
  const out: EarningsRow[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const symbol = typeof r?.symbol === 'string' ? r.symbol.toUpperCase() : '';
    const date = typeof r?.date === 'string' && DAY.test(r.date) ? r.date : '';
    if (!symbol || !date) continue;
    out.push({ symbol, date, hour: typeof r.hour === 'string' ? r.hour : '', epsEstimate: n(r.epsEstimate), quarter: n(r.quarter), year: n(r.year) });
  }
  return out;
}

export const HOUR_LABEL: Record<string, string> = { bmo: 'antes de la apertura', amc: 'tras el cierre', dmh: 'durante la sesión' };

export interface DividendRow {
  exDate: string;
  payDate: string | null;
  value: number;
  currency: string | null;
  period: string | null;
}

export function parseEodhdDividends(json: unknown): DividendRow[] {
  if (!Array.isArray(json)) return [];
  const out: DividendRow[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const exDate = typeof r?.date === 'string' && DAY.test(r.date) ? r.date : '';
    const value = n(r?.value) ?? n(r?.unadjustedValue);
    if (!exDate || value === null || value <= 0) continue;
    const pay = typeof r.paymentDate === 'string' && DAY.test(r.paymentDate) ? r.paymentDate : null;
    out.push({ exDate, payDate: pay, value, currency: typeof r.currency === 'string' ? r.currency.toUpperCase().slice(0, 3) : null, period: typeof r.period === 'string' ? r.period : null });
  }
  return out.sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
}

const PERIOD_ES: Record<string, string> = { quarterly: 'trimestral', 'semi-annual': 'semestral', semiannual: 'semestral', annual: 'anual', monthly: 'mensual', interim: 'a cuenta', final: 'complementario' };

const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);
export function addMonths(d: string, months: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fromTime(target.getTime());
}

/**
 * Typical interval between past dates, snapped to 1, 3, 6 or 12 months.
 * null when there are fewer than 2 dates or the pattern is irregular.
 */
export function inferFrequency(dates: string[]): number | null {
  const s = [...new Set(dates)].sort();
  if (s.length < 2) return null;
  const gaps = s.slice(1).map((d, i) => (toTime(d) - toTime(s[i]!)) / 86400e3);
  const recent = gaps.slice(-4).sort((a, b) => a - b);
  const median = recent[Math.floor(recent.length / 2)]!;
  for (const [months, lo, hi] of [
    [1, 25, 38],
    [3, 75, 105],
    [6, 160, 205],
    [12, 330, 400],
  ] as const)
    if (median >= lo && median <= hi) return months;
  return null;
}

/**
 * Project the next occurrences after `from` (inclusive) up to `to`, from the last
 * known date and its frequency. Max 8 per series.
 */
export function project(lastDate: string, months: number, from: string, to: string): string[] {
  const out: string[] = [];
  let d = lastDate;
  for (let i = 0; i < 40 && out.length < 8; i++) {
    d = addMonths(d, months);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Dividend events (confirmed + projected) for one company. */
export function dividendEvents(companyId: number, rows: DividendRow[], from: string, to: string, source: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const r of rows) {
    if (r.exDate >= from && r.exDate <= to)
      out.push({ id: `div:${companyId}:${r.exDate}`, companyId, date: r.exDate, type: 'exdiv', status: 'confirmed', source, amount: r.value, currency: r.currency, detail: r.period ? (PERIOD_ES[r.period.toLowerCase()] ?? r.period) : undefined });
    if (r.payDate && r.payDate >= from && r.payDate <= to)
      out.push({ id: `pay:${companyId}:${r.payDate}`, companyId, date: r.payDate, type: 'payment', status: 'confirmed', source, amount: r.value, currency: r.currency });
  }
  const freq = inferFrequency(rows.map((r) => r.exDate));
  const last = rows.at(-1);
  if (freq && last)
    for (const d of project(last.exDate, freq, from, to))
      if (!out.some((e) => e.type === 'exdiv' && Math.abs(toTime(e.date) - toTime(d)) < 20 * 86400e3))
        out.push({
          id: `div~:${companyId}:${d}`,
          companyId,
          date: d,
          type: 'exdiv',
          status: 'estimated',
          source: `Estimada: cada ${freq} ${freq === 1 ? 'mes' : 'meses'} desde el último ex-dividendo (${last.exDate}), importe del último pago`,
          amount: last.value,
          currency: last.currency,
        });
  return out;
}

/**
 * Earnings estimated from the company's own past filing dates (10-Q/10-K or
 * annual ESEF reports): the next one is projected with the observed frequency.
 * The filing usually comes a few days after the results announcement.
 */
export function estimatedEarnings(companyId: number, filingDates: string[], from: string, to: string, what: string): CalEvent[] {
  const s = [...new Set(filingDates)].sort();
  const freq = inferFrequency(s);
  const last = s.at(-1);
  if (!freq || !last) return [];
  return project(last, freq, from, to).map((d) => ({
    id: `earn~:${companyId}:${d}`,
    companyId,
    date: d,
    type: 'earnings' as const,
    status: 'estimated' as const,
    source: `Estimada a partir de sus ${what} anteriores (última: ${last}, cada ${freq} meses). Los resultados suelen anunciarse unos días antes.`,
  }));
}

// ---------------------------------------------------------------- iCalendar export

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 all-day events; estimated ones say so in the title. */
export function toIcs(events: (CalEvent & { title: string })[], stamp = new Date()): string {
  const dt = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Investor Browser//Calendario//ES', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    const next = fromTime(toTime(e.date) + 86400e3).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id.replace(/[^\w:.~-]/g, '')}@investor-browser`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsEscape(`${e.status === 'estimated' ? '(Estimada) ' : ''}${e.title}`)}`,
      `DESCRIPTION:${icsEscape(e.source)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
