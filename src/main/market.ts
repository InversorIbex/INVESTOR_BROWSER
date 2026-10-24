/**
 * Delayed market prices with the user's own free API keys, and ECB reference
 * exchange rates. Main process only.
 *
 * - Finnhub (US shares): free tier ~60 calls/min → one call every 1.1 s.
 * - EODHD (any exchange, 15-minute delay): free tier 20 calls/day → a daily
 *   quota tracked locally; we never go over the limit the user set.
 * - ECB euro reference rates: official, free, no key, published once a day.
 *
 * Keys travel only to their provider (header for Finnhub, query string for
 * EODHD, which has no header option) and are never cached, logged or exported.
 */
import { PoliteClient, ProviderError } from './http';
import type { HttpFetch, SecCache } from './sec';
import type { Secrets, KvStore } from './secrets';
import {
  ECB_CURRENCIES,
  exchangeCurrency,
  normalizeQuoteCurrency,
  parseEcbCsv,
  parseEodhdQuotes,
  parseFinnhubQuote,
  providerSymbol,
  type FxRates,
  type QuoteProvider,
} from '../shared/market';

export interface QuoteTarget {
  companyId: number;
  ticker: string | null;
  exchange: string;
  quoteSymbol: string | null;
  /** When the current price was fetched (epoch ms), to skip fresh ones. */
  priceFetchedAt: number | null;
}

export interface QuoteResult {
  companyId: number;
  ok: boolean;
  provider?: QuoteProvider;
  symbol?: string;
  price?: number;
  currency?: string | null;
  prevClose?: number | null;
  changePct?: number | null;
  asOf?: number;
  error?: string;
}

export interface MarketOptions {
  fetch: { finnhub: HttpFetch; eodhd: HttpFetch; ecb: HttpFetch };
  cache: SecCache;
  kv: KvStore;
  secrets: Secrets;
  appVersion: string;
  eodhdDailyLimit: () => number;
  baseOverride?: string | null;
  now?: () => number;
}

const FRESH_MS = 15 * 60e3;

export class MarketService {
  readonly finnhub: PoliteClient;
  readonly eodhd: PoliteClient;
  readonly ecb: PoliteClient;

  constructor(private readonly o: MarketOptions) {
    const ua = () => `InvestorBrowser/${o.appVersion}`;
    const keyErrors = (name: string) => (status: number, body: string) => {
      if (status === 401 || status === 403) return new ProviderError('forbidden', `${name} rechazó la clave o el valor no está en tu plan gratuito.`);
      if (status === 402 || (status === 429 && /limit/i.test(body))) return new ProviderError('quota', `Se ha agotado el cupo diario de ${name}.`);
      return null;
    };
    this.finnhub = new PoliteClient({ name: 'Finnhub', fetch: o.fetch.finnhub, cache: o.cache, base: 'https://finnhub.io', baseOverride: o.baseOverride, userAgent: ua, minIntervalMs: 1100, timeoutMs: 15_000, maxBytes: 1e6, now: o.now, classify: keyErrors('Finnhub') });
    this.eodhd = new PoliteClient({ name: 'EODHD', fetch: o.fetch.eodhd, cache: o.cache, base: 'https://eodhd.com', baseOverride: o.baseOverride, userAgent: ua, minIntervalMs: 500, timeoutMs: 20_000, maxBytes: 2e6, now: o.now, classify: keyErrors('EODHD') });
    this.ecb = new PoliteClient({ name: 'el BCE', fetch: o.fetch.ecb, cache: o.cache, base: 'https://data-api.ecb.europa.eu', baseOverride: o.baseOverride, userAgent: ua, minIntervalMs: 1000, timeoutMs: 20_000, maxBytes: 1e6, now: o.now });
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  // ---------------- EODHD daily quota ----------------
  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10); // EODHD resets at midnight GMT
  }
  quotaUsed(): number {
    const q = this.o.kv.getJson<{ day: string; used: number }>('quota.eodhd');
    return q && q.day === this.today() ? q.used : 0;
  }
  quotaLeft(): number {
    return Math.max(0, this.o.eodhdDailyLimit() - this.quotaUsed());
  }
  private spend(n: number): void {
    this.o.kv.setJson('quota.eodhd', { day: this.today(), used: this.quotaUsed() + n });
  }
  private exhaust(): void {
    this.o.kv.setJson('quota.eodhd', { day: this.today(), used: Math.max(this.quotaUsed(), this.o.eodhdDailyLimit()) });
  }

  // ---------------- quotes ----------------
  async refresh(targets: QuoteTarget[], force = false): Promise<QuoteResult[]> {
    const results: QuoteResult[] = [];
    const now = this.now();
    const finnhubKey = this.o.secrets.get('finnhub');
    const eodhdKey = this.o.secrets.get('eodhd');
    const viaEodhd: { t: QuoteTarget; symbol: string }[] = [];

    for (const t of targets) {
      if (!force && t.priceFetchedAt && now - t.priceFetchedAt < FRESH_MS) continue;
      const fh = providerSymbol(t, 'finnhub');
      if (fh && finnhubKey) {
        try {
          const r = await this.finnhub.get(`/api/v1/quote?symbol=${encodeURIComponent(fh)}`, { cacheKey: null, ttlMs: 0, headers: { 'X-Finnhub-Token': finnhubKey } });
          const q = parseFinnhubQuote(fh, r.data);
          if (q) {
            results.push({ companyId: t.companyId, ok: true, provider: 'finnhub', symbol: fh, price: q.price, currency: 'USD', prevClose: q.prevClose, changePct: q.changePct, asOf: q.asOf });
            continue;
          }
        } catch (err) {
          if (err instanceof ProviderError && (err.code === 'rate-limited' || err.code === 'forbidden')) {
            results.push({ companyId: t.companyId, ok: false, provider: 'finnhub', error: err.message });
            continue;
          }
          if (!(err instanceof ProviderError)) throw err;
        }
        // Not found on Finnhub: try EODHD below
      }
      const eo = providerSymbol(t, 'eodhd');
      if (eo && eodhdKey) viaEodhd.push({ t, symbol: eo });
      else results.push({ companyId: t.companyId, ok: false, error: eo ? 'Sin clave de EODHD configurada.' : fh ? 'Sin clave de Finnhub configurada.' : 'Indica ticker y bolsa (o el símbolo de cotización).' });
    }

    // EODHD in batches, never beyond the daily quota; the oldest prices go first.
    viaEodhd.sort((a, b) => (a.t.priceFetchedAt ?? 0) - (b.t.priceFetchedAt ?? 0));
    let left = this.quotaLeft();
    const pending = viaEodhd.slice(0, left);
    for (const skipped of viaEodhd.slice(left))
      results.push({ companyId: skipped.t.companyId, ok: false, provider: 'eodhd', error: 'Cupo diario de EODHD agotado: se actualizará mañana o puedes capturar el precio desde una web.' });
    for (let i = 0; i < pending.length; i += 15) {
      const chunk = pending.slice(i, i + 15);
      const [first, ...rest] = chunk;
      const qs = rest.length ? `s=${encodeURIComponent(rest.map((x) => x.symbol).join(','))}&` : '';
      try {
        const r = await this.eodhd.get(`/api/real-time/${encodeURIComponent(first!.symbol)}?${qs}fmt=json&api_token=${encodeURIComponent(eodhdKey!)}`, { cacheKey: null, ttlMs: 0 });
        this.spend(chunk.length);
        left -= chunk.length;
        const quotes = new Map(parseEodhdQuotes(r.data).map((q) => [q.symbol, q]));
        for (const x of chunk) {
          const q = quotes.get(x.symbol);
          if (!q) {
            results.push({ companyId: x.t.companyId, ok: false, provider: 'eodhd', symbol: x.symbol, error: `EODHD no tiene cotización para ${x.symbol}. Revisa el símbolo.` });
            continue;
          }
          const cur = normalizeQuoteCurrency(q.price, exchangeCurrency(x.t.exchange, x.symbol));
          const prev = q.prevClose === null ? null : normalizeQuoteCurrency(q.prevClose, exchangeCurrency(x.t.exchange, x.symbol)).price;
          results.push({ companyId: x.t.companyId, ok: true, provider: 'eodhd', symbol: x.symbol, price: cur.price, currency: cur.currency, prevClose: prev, changePct: q.changePct, asOf: q.asOf });
        }
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        if (err.code === 'quota') this.exhaust();
        for (const x of chunk) results.push({ companyId: x.t.companyId, ok: false, provider: 'eodhd', symbol: x.symbol, error: err.message });
        if (err.code === 'quota' || err.code === 'forbidden') {
          for (const x of pending.slice(i + 15)) results.push({ companyId: x.t.companyId, ok: false, provider: 'eodhd', symbol: x.symbol, error: err.message });
          break;
        }
      }
    }
    return results;
  }

  /** Check a key without saving it (one call; for EODHD it uses 1 of the daily quota). */
  async testKey(provider: QuoteProvider, key: string): Promise<string> {
    if (provider === 'finnhub') {
      const r = await this.finnhub.get('/api/v1/quote?symbol=AAPL', { cacheKey: null, ttlMs: 0, headers: { 'X-Finnhub-Token': key } });
      const q = parseFinnhubQuote('AAPL', r.data);
      if (!q) throw new ProviderError('bad-data', 'Finnhub respondió sin datos.');
      return `Clave válida: Apple a ${q.price} USD (${new Date(q.asOf).toLocaleString('es-ES')}).`;
    }
    if (this.quotaLeft() < 1) throw new ProviderError('quota', 'No queda cupo diario de EODHD para probar la clave.');
    const r = await this.eodhd.get(`/api/real-time/AAPL.US?fmt=json&api_token=${encodeURIComponent(key)}`, { cacheKey: null, ttlMs: 0 });
    this.spend(1);
    const [q] = parseEodhdQuotes(r.data);
    if (!q) throw new ProviderError('bad-data', 'EODHD respondió sin datos.');
    return `Clave válida: Apple a ${q.price} USD (${new Date(q.asOf).toLocaleString('es-ES')}, retrasado).`;
  }

  // ---------------- FX ----------------
  async fxRates(force = false): Promise<{ rates: FxRates; stale: boolean; fetchedAt: number }> {
    const path = `/service/data/EXR/D.${ECB_CURRENCIES.join('+')}.EUR.SP00.A?lastNObservations=1&format=csvdata`;
    const r = await this.ecb.get<string>(path, { cacheKey: 'ecb:latest', ttlMs: 6 * 3600e3, force, parse: 'text' });
    const rates = parseEcbCsv(r.data);
    if (!rates) throw new ProviderError('bad-data', 'Respuesta del BCE no reconocida.');
    return { rates, stale: r.stale, fetchedAt: r.fetchedAt };
  }
}
