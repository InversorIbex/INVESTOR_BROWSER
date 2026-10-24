/**
 * European official annual reports (ESEF / UKSEF) from filings.xbrl.org, run by
 * XBRL International ("At present, there are no restrictions on the ways that the
 * data can be used", checked Oct 2026).
 *
 * Formats verified against real responses (Oct 2026):
 *  - JSON:API: /api/entities/{LEI}/filings → data[].attributes {period_end, country,
 *    fxo_id, date_added, processed, published, json_url, viewer_url, report_url,
 *    error_count…}; entities carry {identifier (LEI), name}.
 *  - xBRL-JSON (OIM): facts{ id: {value: "960401000", decimals, dimensions:
 *    {concept: "ifrs-full:Revenue", entity: "scheme:LEI", period:
 *    "2025-01-01T00:00:00/2026-01-01T00:00:00", unit: "iso4217:EUR"}}}.
 *    OIM period ends are exclusive midnights: "2026-01-01T00:00:00" = 31 Dec 2025.
 *
 * Coverage: ESEF filings for Germany are not available in the repository, and
 * Switzerland is not in ESEF at all. Those companies get no automatic source here.
 */
import type { CompanyFacts, XbrlFact } from './xbrl';
import { CONCEPT_MAP, EXTRA_IFRS_CONCEPTS } from './xbrl';

export const ESEF_BASE = 'https://filings.xbrl.org';

export interface EsefEntity {
  lei: string;
  name: string;
}

export interface EsefFiling {
  id: string;
  lei: string;
  entityName: string | null;
  country: string | null;
  periodEnd: string; // YYYY-MM-DD
  published: string | null; // YYYY-MM-DD, as published by the national source
  processed: string | null; // YYYY-MM-DD, added/processed by filings.xbrl.org
  fxoId: string;
  jsonUrl: string | null; // absolute
  viewerUrl: string | null; // absolute
  errors: number;
}

export const LEI_RE = /^[A-Z0-9]{18}[0-9]{2}$/;

/** Countries whose ESEF filings are in the repository (source: filings.xbrl.org/source, Oct 2026). */
export const ESEF_COUNTRIES = new Set([
  'AT', 'BE', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IS', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

/** Why a country has no automatic official source, to say it plainly in the UI. */
export function esefCoverageNote(country: string | null | undefined): string | null {
  const c = (country ?? '').toUpperCase();
  if (c === 'DE') return 'Alemania: sus informes ESEF no están disponibles para descarga automática (filings.xbrl.org no los recoge). Usa la SEC si presenta 20-F o captura las cifras del informe anual.';
  if (c === 'CH') return 'Suiza no está en ESEF ni exige XBRL a sus cotizadas. Usa la SEC si presenta 20-F o captura las cifras del informe anual.';
  if (c && c !== 'US' && !ESEF_COUNTRIES.has(c)) return `No hay una fuente ESEF automática conocida para ${c}.`;
  return null;
}

/** Only these exchanges map to a country automatically (the user can always edit the country). */
export const EXCHANGE_COUNTRY: Record<string, string> = {
  BME: 'ES', MC: 'ES', EPA: 'FR', PA: 'FR', BIT: 'IT', MI: 'IT', ETR: 'DE', XETRA: 'DE', FRA: 'DE', SWX: 'CH', SIX: 'CH', SW: 'CH',
  AMS: 'NL', AS: 'NL', EBR: 'BE', BR: 'BE', ELI: 'PT', LS: 'PT', HEL: 'FI', HE: 'FI', CPH: 'DK', CO: 'DK', STO: 'SE', ST: 'SE', OSL: 'NO', OL: 'NO',
  LON: 'GB', LSE: 'GB', VIE: 'AT', ISE: 'IE', NYSE: 'US', NASDAQ: 'US',
};

export function countryOf(company: { country?: string | null; exchange?: string | null }): string | null {
  const raw = (company.country ?? '').trim().toUpperCase();
  const byName: Record<string, string> = { ESPAÑA: 'ES', SPAIN: 'ES', FRANCIA: 'FR', FRANCE: 'FR', ITALIA: 'IT', ITALY: 'IT', ALEMANIA: 'DE', GERMANY: 'DE', SUIZA: 'CH', SWITZERLAND: 'CH', 'REINO UNIDO': 'GB', UK: 'GB', 'PAÍSES BAJOS': 'NL', NETHERLANDS: 'NL', DINAMARCA: 'DK', DENMARK: 'DK', 'EE. UU.': 'US', USA: 'US', 'ESTADOS UNIDOS': 'US' };
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  if (byName[raw]) return byName[raw]!;
  const ex = (company.exchange ?? '').trim().toUpperCase();
  return EXCHANGE_COUNTRY[ex] ?? null;
}

const abs = (u: unknown): string | null => (typeof u === 'string' && u.startsWith('/') && !u.includes('..') ? ESEF_BASE + u : null);
const day = (u: unknown): string | null => (typeof u === 'string' && /^\d{4}-\d{2}-\d{2}/.test(u) ? u.slice(0, 10) : null);

/** Build a safe "name contains" filter for /api/entities. */
export function entitySearchPath(query: string): string | null {
  const q = query.trim();
  if (LEI_RE.test(q.toUpperCase())) return `/api/entities/${q.toUpperCase()}`;
  const clean = q.replace(/[^\p{L}\p{N} .,&'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (clean.length < 2) return null;
  const filter = JSON.stringify([{ name: 'name', op: 'ilike', val: `%${clean.replace(/ /g, '%')}%` }]);
  return `/api/entities?filter=${encodeURIComponent(filter)}&page%5Bsize%5D=12`;
}

export function filingsPath(lei: string): string {
  if (!LEI_RE.test(lei)) throw new Error('LEI no válido');
  return `/api/entities/${lei}/filings?sort=-period_end&page%5Bsize%5D=40`;
}

export function parseEntities(json: unknown): EsefEntity[] {
  const j = json as { data?: unknown };
  const list = Array.isArray(j?.data) ? j.data : j?.data ? [j.data] : [];
  const out: EsefEntity[] = [];
  for (const e of list as { type?: string; attributes?: { identifier?: unknown; name?: unknown } }[]) {
    const lei = String(e?.attributes?.identifier ?? '').toUpperCase();
    const name = typeof e?.attributes?.name === 'string' ? e.attributes.name.slice(0, 200) : '';
    if (LEI_RE.test(lei) && name) out.push({ lei, name });
  }
  return out;
}

export function parseFilings(json: unknown, leiHint?: string): EsefFiling[] {
  const j = json as { data?: unknown; included?: unknown };
  if (!Array.isArray(j?.data)) return [];
  const entities = new Map<string, EsefEntity>();
  if (Array.isArray(j.included))
    for (const inc of j.included as { type?: string; id?: string; attributes?: { identifier?: unknown; name?: unknown } }[]) {
      if (inc?.type === 'entity' && inc.id) {
        const [ent] = parseEntities({ data: inc });
        if (ent) entities.set(inc.id, ent);
      }
    }
  const out: EsefFiling[] = [];
  for (const f of j.data as { id?: unknown; attributes?: Record<string, unknown>; relationships?: { entity?: { data?: { id?: string } } } }[]) {
    const a = f?.attributes ?? {};
    const periodEnd = day(a.period_end);
    const fxoId = typeof a.fxo_id === 'string' ? a.fxo_id.slice(0, 200) : '';
    const lei = (fxoId.split('-')[0] ?? '').toUpperCase() || (leiHint ?? '');
    if (!periodEnd || !fxoId || !LEI_RE.test(lei)) continue;
    const ent = entities.get(f.relationships?.entity?.data?.id ?? '');
    out.push({
      id: String(f.id ?? fxoId),
      lei,
      entityName: ent?.name ?? null,
      country: typeof a.country === 'string' ? a.country.slice(0, 2).toUpperCase() : null,
      periodEnd,
      published: day(a.published),
      processed: day(a.processed) ?? day(a.date_added),
      fxoId,
      jsonUrl: abs(a.json_url),
      viewerUrl: abs(a.viewer_url),
      errors: Number(a.error_count ?? 0) || 0,
    });
  }
  return out;
}

/**
 * One filing per financial year: the repository can hold several versions
 * (language or corrected re-filings, "…-ESEF-ES-0", "-1"…). Keep the latest
 * processed one for each period end, most recent periods first.
 */
export function pickAnnualFilings(filings: EsefFiling[], maxYears = 6): EsefFiling[] {
  const byEnd = new Map<string, EsefFiling>();
  for (const f of filings) {
    if (!f.jsonUrl) continue;
    const cur = byEnd.get(f.periodEnd);
    const key = (x: EsefFiling) => `${x.processed ?? ''}|${x.fxoId}`;
    if (!cur || key(f) > key(cur)) byEnd.set(f.periodEnd, f);
  }
  return [...byEnd.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1)).slice(0, maxYears);
}

/** OIM date-time → calendar date. Ends at midnight are exclusive (the previous day). */
export function oimDate(s: string, isEnd: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const midnight = !m[4] || (m[4] === '00' && m[5] === '00' && m[6] === '00');
  if (isEnd && midnight) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86400e3);
    return d.toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** iso4217:EUR → EUR; xbrli:shares → shares; iso4217:EUR/xbrli:shares → EUR/shares. */
export function oimUnit(u: string | undefined): string | null {
  if (!u) return null;
  const part = (p: string) => (p.startsWith('iso4217:') ? p.slice(8) : p === 'xbrli:shares' ? 'shares' : null);
  const [num, den] = u.split('/');
  const n = num ? part(num) : null;
  if (!n) return null;
  if (!den) return n;
  const d = part(den);
  return d ? `${n}/${d}` : null;
}

/** IFRS concepts worth keeping from a filing (everything the normaliser can use). */
export function wantedIfrsConcepts(): Set<string> {
  const s = new Set<string>(EXTRA_IFRS_CONCEPTS);
  for (const rules of Object.values(CONCEPT_MAP)) for (const r of rules ?? []) if (r.taxonomy === 'ifrs-full') r.concepts.forEach((c) => s.add(c));
  return s;
}

export interface CompactFact {
  c: string; // concept without prefix
  u: string; // unit
  s?: string; // start (durations)
  e: string; // end / instant
  v: number;
}

/**
 * Extract the compact list of non-dimensional numeric IFRS facts we use from an
 * xBRL-JSON report. Facts with extra dimensions (segments, equity components…)
 * are skipped on purpose: they are breakdowns, not the consolidated total.
 */
export function extractOimFacts(json: unknown, wanted = wantedIfrsConcepts()): CompactFact[] {
  const facts = (json as { facts?: Record<string, { value?: unknown; dimensions?: Record<string, unknown> }> })?.facts;
  if (!facts || typeof facts !== 'object') throw new Error('Informe xBRL-JSON sin hechos.');
  const out: CompactFact[] = [];
  const seen = new Set<string>();
  for (const f of Object.values(facts)) {
    const dims = f?.dimensions;
    if (!dims || typeof dims.concept !== 'string' || !dims.concept.startsWith('ifrs-full:')) continue;
    const extra = Object.keys(dims).filter((k) => !['concept', 'entity', 'period', 'unit', 'language'].includes(k));
    if (extra.length) continue;
    const c = dims.concept.slice(10);
    if (!wanted.has(c)) continue;
    const u = oimUnit(typeof dims.unit === 'string' ? dims.unit : undefined);
    if (!u) continue;
    const v = typeof f.value === 'number' ? f.value : Number(String(f.value ?? '').trim());
    if (!Number.isFinite(v) || String(f.value ?? '').trim() === '') continue;
    const period = typeof dims.period === 'string' ? dims.period : '';
    let s: string | undefined;
    let e: string | null;
    if (period.includes('/')) {
      const [a, b] = period.split('/');
      s = oimDate(a ?? '', false) ?? undefined;
      e = oimDate(b ?? '', true);
      if (!s) continue;
    } else e = oimDate(period, true);
    if (!e) continue;
    const key = `${c}|${u}|${s ?? ''}|${e}`;
    if (seen.has(key)) continue; // duplicated facts (same value tagged twice in the report)
    seen.add(key);
    out.push(s ? { c, u, s, e, v } : { c, u, e, v });
  }
  return out;
}

/** Merge several filings into the SEC "companyfacts" shape so the same normaliser (and restatement logic) applies. */
export function toCompanyFacts(lei: string, entityName: string | null, reports: { filing: EsefFiling; facts: CompactFact[] }[]): CompanyFacts {
  const tax: CompanyFacts['facts'][string] = {};
  for (const { filing, facts } of reports) {
    const filed = filing.published ?? filing.processed ?? filing.periodEnd;
    for (const f of facts) {
      const entry = (tax[f.c] ??= { units: {} });
      const list = (entry.units[f.u] ??= []);
      const x: XbrlFact = { end: f.e, val: f.v, accn: filing.fxoId, form: 'ESEF', filed, fy: null, fp: 'FY' };
      if (f.s) x.start = f.s;
      list.push(x);
    }
  }
  return { cik: lei, entityName: entityName ?? undefined, facts: { 'ifrs-full': tax } };
}
