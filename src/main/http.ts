/**
 * Small "polite" HTTP client shared by the official/free data providers that are
 * not the SEC (ESEF repository, market data, ECB exchange rates).
 *
 * - Runs only in the main process; the HTTP function is injected (Electron's
 *   session.fetch in the app, a stub in tests).
 * - Serial queue with a minimum gap between requests (measured from the END of
 *   the previous one), timeout and size limit.
 * - Only the hosts listed for the provider can be contacted. Tests may replace
 *   them with a loopback server, never with anything else.
 * - Response cache with TTL and stale-if-error: a dated old copy beats nothing,
 *   and the UI always shows the date.
 */
import type { HttpFetch, SecCache } from './sec';

export type ProviderErrorCode = 'no-contact' | 'no-key' | 'forbidden' | 'not-found' | 'rate-limited' | 'quota' | 'network' | 'too-large' | 'bad-data';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PoliteClientOptions {
  /** Human name used in error messages ("filings.xbrl.org", "Finnhub"…). */
  name: string;
  fetch: HttpFetch;
  cache: SecCache;
  /** Real base URL, e.g. https://filings.xbrl.org */
  base: string;
  /** Test-only override; accepted only if it is http://127.0.0.1:<port>. */
  baseOverride?: string | null;
  userAgent: () => string;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  /** Map provider-specific HTTP statuses / bodies to errors. */
  classify?: (status: number, body: string) => ProviderError | null;
}

export interface Fetched<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
}

export function loopbackOr(base: string, override: string | null | undefined): string {
  return override && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(override) ? override : base;
}

export function asciiUserAgent(product: string, contact: string): string {
  const ascii = contact.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  return `${product} ${ascii}`.trim();
}

export class PoliteClient {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  readonly base: string;
  requestsMade = 0;
  lastError: string | null = null;

  constructor(private readonly o: PoliteClientOptions) {
    this.base = loopbackOr(o.base, o.baseOverride);
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /**
   * GET `path` (relative to the provider base) and parse JSON or return text.
   * `cacheKey` null → never cached (e.g. URLs carrying an API key are cached under a key without it).
   */
  async get<T = unknown>(
    path: string,
    opts: { cacheKey: string | null; ttlMs: number; force?: boolean; parse?: 'json' | 'text'; headers?: Record<string, string> },
  ): Promise<Fetched<T>> {
    if (!path.startsWith('/')) throw new ProviderError('bad-data', 'Ruta no válida.');
    const now = this.now();
    const cached = opts.cacheKey ? this.o.cache.get(opts.cacheKey) : null;
    const decode = (body: string): T => {
      if ((opts.parse ?? 'json') === 'text') return body as unknown as T;
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new ProviderError('bad-data', `${this.o.name} devolvió una respuesta que no es JSON.`);
      }
    };
    if (cached && !opts.force && now - cached.fetchedAt < opts.ttlMs) {
      return { data: decode(cached.body), fromCache: true, stale: false, fetchedAt: cached.fetchedAt };
    }
    try {
      const body = await this.request(this.base + path, opts.headers ?? {});
      const data = decode(body);
      if (opts.cacheKey) this.o.cache.set(opts.cacheKey, body, now);
      this.lastError = null;
      return { data, fromCache: false, stale: false, fetchedAt: now };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (cached && err instanceof ProviderError && (err.code === 'network' || err.code === 'rate-limited' || err.code === 'quota')) {
        return { data: decode(cached.body), fromCache: true, stale: true, fetchedAt: cached.fetchedAt };
      }
      throw err;
    }
  }

  private request(url: string, extraHeaders: Record<string, string>): Promise<string> {
    const run = async () => {
      const ua = this.o.userAgent();
      const gap = this.o.minIntervalMs ?? 250;
      const wait = this.last + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.requestsMade++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 30_000);
      let status = 0;
      let text = '';
      try {
        const res = await this.o.fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json, text/csv;q=0.9, */*;q=0.5', ...extraHeaders }, signal: ctrl.signal });
        status = res.status;
        const max = this.o.maxBytes ?? 40 * 1024 * 1024;
        if (Number(res.headers.get('content-length') ?? 0) > max) throw new ProviderError('too-large', `Respuesta de ${this.o.name} demasiado grande.`);
        text = await res.text();
        if (text.length > max) throw new ProviderError('too-large', `Respuesta de ${this.o.name} demasiado grande.`);
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError('network', `No se pudo conectar con ${this.o.name}. Comprueba tu conexión.`);
      } finally {
        clearTimeout(timer);
        this.last = Date.now();
      }
      const custom = this.o.classify?.(status, text);
      if (custom) throw custom;
      if (status === 401 || status === 403) throw new ProviderError('forbidden', `${this.o.name} rechazó la petición (${status}).`);
      if (status === 404) throw new ProviderError('not-found', `${this.o.name} no tiene datos para esta consulta.`);
      if (status === 429) throw new ProviderError('rate-limited', `${this.o.name} pide esperar antes de nuevas consultas.`);
      if (status < 200 || status >= 300) throw new ProviderError('network', `${this.o.name} respondió con un error (${status}).`);
      return text;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
