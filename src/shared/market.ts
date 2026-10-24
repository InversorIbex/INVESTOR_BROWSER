/**
 * Market data helpers: exchange mapping, provider response parsing and currency
 * conversion. No network here (see src/main/market.ts).
 *
 * Honesty rules:
 *  - A price is never presented as real-time. Every price carries the provider,
 *    the time of the data and how it was obtained.
 *  - Missing data is null, never 0 (Finnhub answers c=0,t=0 for unknown symbols;
 *    EODHD answers "NA").
 *
 * Formats (provider documentation, Oct 2026):
 *  - Finnhub  GET /api/v1/quote?symbol=AAPL  (X-Finnhub-Token header)
 *             → {c, d, dp, h, l, o, pc, t}  (t = unix seconds)
 *  - EODHD    GET /api/real-time/AAPL.US?s=SAP.XETRA,ITX.MC&api_token=…&fmt=json
 *             → {code, timestamp, gmtoffset, open, high, low, close, volume, previousClose, change, change_p}
 *               (an array when several tickers are requested); 15-minute delayed.
 *  - ECB      GET /service/data/EXR/D.USD+GBP….EUR.SP00.A?lastNObservations=1&format=csvdata
 *             → CSV with CURRENCY, TIME_PERIOD and OBS_VALUE columns (units per 1 EUR).
 */

export type QuoteProvider = 'finnhub' | 'eodhd';
export type PriceKind = 'manual' | 'capture' | QuoteProvider;

export interface ExchangeInfo {
  /** EODHD exchange suffix. */
  eodhd: string;
  currency: string;
  country: string;
  label: string;
}

/** Exchange codes accepted in the company form (upper case), mapped to providers. */
export const EXCHANGES: Record<string, ExchangeInfo> = {
  NYSE: { eodhd: 'US', currency: 'USD', country: 'US', label: 'NYSE' },
  NASDAQ: { eodhd: 'US', currency: 'USD', country: 'US', label: 'Nasdaq' },
  NYSEARCA: { eodhd: 'US', currency: 'USD', country: 'US', label: 'NYSE Arca' },
  AMEX: { eodhd: 'US', currency: 'USD', country: 'US', label: 'NYSE American' },
  BME: { eodhd: 'MC', currency: 'EUR', country: 'ES', label: 'Bolsa de Madrid' },
  EPA: { eodhd: 'PA', currency: 'EUR', country: 'FR', label: 'Euronext París' },
  ETR: { eodhd: 'XETRA', currency: 'EUR', country: 'DE', label: 'Xetra' },
  XETRA: { eodhd: 'XETRA', currency: 'EUR', country: 'DE', label: 'Xetra' },
  SWX: { eodhd: 'SW', currency: 'CHF', country: 'CH', label: 'SIX Swiss Exchange' },
  SIX: { eodhd: 'SW', currency: 'CHF', country: 'CH', label: 'SIX Swiss Exchange' },
  BIT: { eodhd: 'MI', currency: 'EUR', country: 'IT', label: 'Borsa Italiana' },
  AMS: { eodhd: 'AS', currency: 'EUR', country: 'NL', label: 'Euronext Ámsterdam' },
  EBR: { eodhd: 'BR', currency: 'EUR', country: 'BE', label: 'Euronext Bruselas' },
  ELI: { eodhd: 'LS', currency: 'EUR', country: 'PT', label: 'Euronext Lisboa' },
  HEL: { eodhd: 'HE', currency: 'EUR', country: 'FI', label: 'Nasdaq Helsinki' },
  CPH: { eodhd: 'CO', currency: 'DKK', country: 'DK', label: 'Nasdaq Copenhague' },
  STO: { eodhd: 'ST', currency: 'SEK', country: 'SE', label: 'Nasdaq Estocolmo' },
  OSL: { eodhd: 'OL', currency: 'NOK', country: 'NO', label: 'Oslo Børs' },
  LON: { eodhd: 'LSE', currency: 'GBX', country: 'GB', label: 'Bolsa de Londres' },
  LSE: { eodhd: 'LSE', currency: 'GBX', country: 'GB', label: 'Bolsa de Londres' },
  VIE: { eodhd: 'VI', currency: 'EUR', country: 'AT', label: 'Bolsa de Viena' },
};

export const isUsExchange = (exchange: string | null | undefined) => EXCHANGES[(exchange ?? '').toUpperCase()]?.country === 'US';

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;

/**
 * Provider symbol for a company. An explicit override (EODHD style, e.g.
 * "NOVO-B.CO") wins; otherwise ticker + exchange suffix. null = cannot be quoted.
 */
export function providerSymbol(c: { ticker: string | null; exchange: string; quoteSymbol?: string | null }, provider: QuoteProvider): string | null {
  const override = (c.quoteSymbol ?? '').trim().toUpperCase();
  if (override) {
    if (!SYMBOL_RE.test(override)) return null;
    // An exchange suffix has 2+ letters (".MC", ".XETRA"); "BRK.B" is a US share class, not a suffix.
    const m = /^(.+)\.([A-Z]{2,6})$/.exec(override);
    const base = m ? m[1]! : override;
    const suffix = m ? m[2]! : 'US';
    if (provider === 'finnhub') return suffix === 'US' ? base : null;
    return `${base}.${suffix}`;
  }
  const t = (c.ticker ?? '').trim().toUpperCase();
  const ex = EXCHANGES[c.exchange.trim().toUpperCase()];
  if (!t || !SYMBOL_RE.test(t) || !ex) return null;
  if (provider === 'finnhub') return ex.country === 'US' ? t : null;
  return `${t.replace(/\./g, '-')}.${ex.eodhd}`;
}

/** Quote currency for an exchange; GBX = pence. */
export function exchangeCurrency(exchange: string, quoteSymbol?: string | null): string | null {
  const ex = EXCHANGES[exchange.trim().toUpperCase()];
  if (ex) return ex.currency;
  const suffix = (quoteSymbol ?? '').toUpperCase().split('.').pop() ?? '';
  const hit = Object.values(EXCHANGES).find((e) => e.eodhd === suffix);
  return hit?.currency ?? null;
}

export interface ParsedQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
  /** Time of the data according to the provider (epoch ms). */
  asOf: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v !== 'NA' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseFinnhubQuote(symbol: string, json: unknown): ParsedQuote | null {
  const j = json as Record<string, unknown> | null;
  const c = num(j?.c);
  const t = num(j?.t);
  if (c === null || t === null || c <= 0 || t <= 0) return null; // unknown symbol → zeros
  return { symbol, price: c, prevClose: num(j?.pc), changePct: num(j?.dp), asOf: t * 1000 };
}

export function parseEodhdQuotes(json: unknown): ParsedQuote[] {
  const list = Array.isArray(json) ? json : [json];
  const out: ParsedQuote[] = [];
  for (const q of list as Record<string, unknown>[]) {
    const code = typeof q?.code === 'string' ? q.code.toUpperCase() : '';
    const price = num(q?.close);
    const ts = num(q?.timestamp);
    if (!code || price === null || price <= 0 || ts === null || ts <= 0) continue;
    out.push({ symbol: code, price, prevClose: num(q?.previousClose), changePct: num(q?.change_p), asOf: ts * 1000 });
  }
  return out;
}

/** Pence → pounds so prices match financial statements reported in GBP. */
export function normalizeQuoteCurrency(price: number, currency: string | null): { price: number; currency: string | null } {
  if (currency === 'GBX') return { price: price / 100, currency: 'GBP' };
  return { price, currency };
}

// ---------------------------------------------------------------- FX (ECB)

export interface FxRates {
  /** Reference date of the ECB rates. */
  date: string;
  /** Units of currency per 1 EUR (EUR itself = 1). */
  perEur: Record<string, number>;
}

export const ECB_CURRENCIES = ['USD', 'GBP', 'CHF', 'DKK', 'SEK', 'NOK', 'JPY', 'CAD', 'AUD', 'HKD', 'CNY', 'INR', 'BRL', 'MXN', 'PLN', 'CZK', 'HUF'];

export function parseEcbCsv(text: string): FxRates | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const split = (l: string) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]!);
  const iCur = head.indexOf('CURRENCY');
  const iDen = head.indexOf('CURRENCY_DENOM');
  const iDate = head.indexOf('TIME_PERIOD');
  const iVal = head.indexOf('OBS_VALUE');
  if (iCur < 0 || iDate < 0 || iVal < 0) return null;
  const perEur: Record<string, number> = { EUR: 1 };
  let date = '';
  for (const l of lines.slice(1)) {
    const c = split(l);
    const cur = c[iCur] ?? '';
    const v = Number(c[iVal]);
    if (iDen >= 0 && c[iDen] !== 'EUR') continue;
    if (!/^[A-Z]{3}$/.test(cur) || !Number.isFinite(v) || v <= 0) continue;
    perEur[cur] = v;
    if ((c[iDate] ?? '') > date) date = c[iDate] ?? '';
  }
  return Object.keys(perEur).length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, perEur } : null;
}

/** Convert between currencies with ECB cross rates. null when a rate is missing — never guessed. */
export function convert(amount: number, from: string | null, to: string | null, fx: FxRates | null): number | null {
  if (from === null || to === null) return null;
  let a = amount;
  let f = from.toUpperCase();
  if (f === 'GBX') {
    a = amount / 100;
    f = 'GBP';
  }
  const t = to.toUpperCase() === 'GBX' ? 'GBP' : to.toUpperCase();
  const scale = to.toUpperCase() === 'GBX' ? 100 : 1;
  if (f === t) return a * scale;
  const rf = fx?.perEur[f];
  const rt = fx?.perEur[t];
  if (!rf || !rt) return null;
  return (a / rf) * rt * scale;
}

// ---------------------------------------------------------------- labels

export const PROVIDER_LABEL: Record<PriceKind, string> = {
  finnhub: 'Finnhub',
  eodhd: 'EODHD',
  capture: 'Capturado de una web',
  manual: 'Manual',
};

/** "Retrasado · EODHD · 23/10 17:35" — never "en tiempo real". */
export function priceBadge(kind: PriceKind | null): string {
  if (kind === 'eodhd') return 'retrasado ~15 min';
  if (kind === 'finnhub') return 'último dato';
  if (kind === 'capture') return 'capturado';
  return 'manual';
}

export function formatAsOf(asOf: string | null): string {
  if (!asOf) return 's/f';
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return d.toLocaleDateString('es-ES', { timeZone: 'UTC' });
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
