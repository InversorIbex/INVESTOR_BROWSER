/**
 * Client for filings.xbrl.org (XBRL International): European official annual
 * reports (ESEF) as xBRL-JSON. Free, no key. The operator asks regular users to
 * send a User-Agent with contact details, so — like the SEC — nothing is
 * requested until the user has declared a contact.
 */
import { PoliteClient, ProviderError, asciiUserAgent, type Fetched } from './http';
import type { HttpFetch, SecCache } from './sec';
import { isValidContact } from './sec';
import {
  ESEF_BASE,
  entitySearchPath,
  extractOimFacts,
  filingsPath,
  parseEntities,
  parseFilings,
  type CompactFact,
  type EsefEntity,
  type EsefFiling,
} from '../shared/esef';

export interface EsefClientOptions {
  fetch: HttpFetch;
  cache: SecCache;
  contact: () => string;
  appVersion: string;
  baseOverride?: string | null;
  now?: () => number;
}

export class EsefClient {
  readonly http: PoliteClient;

  constructor(private readonly o: EsefClientOptions) {
    this.http = new PoliteClient({
      name: 'filings.xbrl.org',
      fetch: o.fetch,
      cache: o.cache,
      base: ESEF_BASE,
      baseOverride: o.baseOverride,
      now: o.now,
      minIntervalMs: 500, // ≤ 2 requests/s: a free community service, be gentle
      timeoutMs: 60_000,
      maxBytes: 80 * 1024 * 1024,
      userAgent: () => {
        const c = o.contact().trim();
        if (!isValidContact(c))
          throw new ProviderError('no-contact', 'Declara tu nombre y correo en Ajustes › Fuentes de datos: filings.xbrl.org pide identificarse, igual que la SEC.');
        return asciiUserAgent(`InvestorBrowser/${o.appVersion}`, c);
      },
    });
  }

  async search(query: string): Promise<EsefEntity[]> {
    const path = entitySearchPath(query);
    if (!path) return [];
    try {
      const r = await this.http.get(path, { cacheKey: `esef:search:${path}`, ttlMs: 86400e3 });
      return parseEntities(r.data);
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not-found') return [];
      throw err;
    }
  }

  async filings(lei: string, force = false): Promise<Fetched<EsefFiling[]>> {
    const r = await this.http.get(filingsPath(lei), { cacheKey: `esef:filings:${lei}`, ttlMs: 12 * 3600e3, force });
    return { ...r, data: parseFilings(r.data, lei) };
  }

  /**
   * Facts of one report. Filings are immutable, so only the compact extract is
   * kept (a few KB instead of several MB) and never downloaded again.
   */
  async reportFacts(filing: EsefFiling): Promise<{ facts: CompactFact[]; fromCache: boolean }> {
    const key = `esef:facts:${filing.fxoId}`;
    const cached = this.o.cache.get(key);
    if (cached) return { facts: JSON.parse(cached.body) as CompactFact[], fromCache: true };
    if (!filing.jsonUrl?.startsWith(ESEF_BASE + '/')) throw new ProviderError('bad-data', 'Informe sin versión xBRL-JSON.');
    const path = filing.jsonUrl.slice(ESEF_BASE.length);
    const r = await this.http.get(path, { cacheKey: null, ttlMs: 0 });
    let facts: CompactFact[];
    try {
      facts = extractOimFacts(r.data);
    } catch (err) {
      throw new ProviderError('bad-data', err instanceof Error ? err.message : 'Informe no válido.');
    }
    this.o.cache.set(key, JSON.stringify(facts), (this.o.now ?? Date.now)());
    return { facts, fromCache: false };
  }
}
