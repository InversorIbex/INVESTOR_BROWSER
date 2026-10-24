/**
 * SEC EDGAR client. Runs only in the main process; the UI and web pages never
 * talk to the SEC directly.
 *
 * Fair-access rules (https://www.sec.gov/os/accessing-edgar-data):
 *  - max 10 requests/second → we stay at ≤ 8/s with a serial queue;
 *  - declare a User-Agent with a contact → no request is made without one;
 *  - download only what is needed → responses are cached in SQLite.
 *
 * No Electron imports: the HTTP function is injected (Electron's session.fetch in
 * the app, a stub in tests).
 */
import { padCik } from '../shared/xbrl';

export type SecErrorCode = 'no-contact' | 'forbidden' | 'not-found' | 'rate-limited' | 'network' | 'too-large' | 'bad-data';

export class SecError extends Error {
  constructor(
    readonly code: SecErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}
export type HttpFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<HttpResponse>;

export interface SecCache {
  get(key: string): { body: string; fetchedAt: number } | null;
  set(key: string, body: string, fetchedAt: number): void;
}

export interface SecClientOptions {
  fetch: HttpFetch;
  cache: SecCache;
  /** Contact declared by the user, e.g. "Ana Pérez ana@example.com". */
  contact(): string;
  appVersion: string;
  /** Test-only override; must be a loopback URL (see resolveBaseUrls). */
  baseOverride?: string | null;
  now?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

const TTL = {
  tickers: 7 * 86400e3,
  submissions: 6 * 3600e3,
  facts: 12 * 3600e3,
};

/** Only a loopback http server may replace the SEC hosts (used by the E2E tests). */
export function resolveBaseUrls(override: string | null | undefined): { www: string; data: string } {
  if (override && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(override)) return { www: override, data: override };
  return { www: 'https://www.sec.gov', data: 'https://data.sec.gov' };
}

export const CONTACT_RE = /^[^\n\r]{2,120}\s+[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidContact(c: string): boolean {
  return CONTACT_RE.test(c.trim());
}

export interface FetchResult<T> {
  data: T;
  fromCache: boolean;
  /** Cached copy used because the SEC could not be reached. */
  stale: boolean;
  fetchedAt: number;
}

export class SecClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  private readonly base: { www: string; data: string };
  requestsMade = 0;
  lastError: string | null = null;

  constructor(private readonly o: SecClientOptions) {
    this.base = resolveBaseUrls(o.baseOverride);
  }

  userAgent(): string {
    const contact = this.o.contact().trim();
    if (!isValidContact(contact)) throw new SecError('no-contact', 'Configura tu nombre y correo de contacto para la SEC (Ajustes › Fuentes de datos).');
    // The SEC asks automated tools to identify themselves with a contact.
    const ascii = contact.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
    return `InvestorBrowser/${this.o.appVersion} ${ascii}`;
  }

  tickers(force = false): Promise<FetchResult<unknown>> {
    return this.getJson('tickers', `${this.base.www}/files/company_tickers.json`, TTL.tickers, force);
  }

  submissions(cik: number | string, force = false): Promise<FetchResult<unknown>> {
    const id = padCik(cik);
    return this.getJson(`submissions:${id}`, `${this.base.data}/submissions/CIK${id}.json`, TTL.submissions, force);
  }

  companyFacts(cik: number | string, force = false): Promise<FetchResult<unknown>> {
    const id = padCik(cik);
    return this.getJson(`facts:${id}`, `${this.base.data}/api/xbrl/companyfacts/CIK${id}.json`, TTL.facts, force);
  }

  private async getJson(key: string, url: string, ttl: number, force: boolean): Promise<FetchResult<unknown>> {
    const now = (this.o.now ?? Date.now)();
    const cached = this.o.cache.get(key);
    if (cached && !force && now - cached.fetchedAt < ttl) {
      return { data: JSON.parse(cached.body) as unknown, fromCache: true, stale: false, fetchedAt: cached.fetchedAt };
    }
    try {
      const body = await this.request(url);
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        throw new SecError('bad-data', 'La SEC devolvió una respuesta que no es JSON.');
      }
      this.o.cache.set(key, body, now);
      this.lastError = null;
      return { data, fromCache: false, stale: false, fetchedAt: now };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      // Stale-if-error: better an old, dated copy than nothing — the UI shows its date.
      if (cached && err instanceof SecError && (err.code === 'network' || err.code === 'rate-limited')) {
        return { data: JSON.parse(cached.body) as unknown, fromCache: true, stale: true, fetchedAt: cached.fetchedAt };
      }
      throw err;
    }
  }

  /** Serialised, rate-limited request. */
  private request(url: string): Promise<string> {
    const run = async () => {
      const ua = this.userAgent(); // throws before any network traffic if no contact
      const gap = this.o.minIntervalMs ?? 125;
      const wait = this.lastRequest + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequest = Date.now();
      this.requestsMade++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 30_000);
      let res: HttpResponse;
      try {
        res = await this.o.fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: ctrl.signal });
      } catch {
        throw new SecError('network', 'No se pudo conectar con la SEC. Comprueba tu conexión.');
      } finally {
        clearTimeout(timer);
        // Space requests from the END of the previous one: arrival gaps at the SEC are
        // then always ≥ the interval, whatever the network latency of the previous call.
        this.lastRequest = Date.now();
      }
      if (res.status === 403) throw new SecError('forbidden', 'La SEC rechazó la petición (403). Revisa que el contacto sea un nombre y un correo reales.');
      if (res.status === 404) throw new SecError('not-found', 'La SEC no tiene datos para este identificador (¿emisor no registrado en EE. UU.?).');
      if (res.status === 429) throw new SecError('rate-limited', 'La SEC pide esperar antes de nuevas consultas. Inténtalo en unos minutos.');
      if (res.status < 200 || res.status >= 300) throw new SecError('network', `La SEC respondió con un error (${res.status}).`);
      const max = this.o.maxBytes ?? 80 * 1024 * 1024;
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > max) throw new SecError('too-large', 'Respuesta de la SEC demasiado grande.');
      const text = await res.text();
      if (text.length > max) throw new SecError('too-large', 'Respuesta de la SEC demasiado grande.');
      return text;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
