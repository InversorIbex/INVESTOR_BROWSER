/**
 * Official sources and link builders. Links are only *links*: nothing here
 * fetches data. Hosts are matched exactly or as true subdomains, so lookalikes
 * such as "sec.gov.example.com" or "evilsec.gov" never match.
 */
import { hostOf } from './url';

export const OFFICIAL_HOSTS: Record<string, string> = {
  'sec.gov': 'SEC (EE. UU.)',
  'cnmv.es': 'CNMV',
  'esma.europa.eu': 'ESMA',
  'ec.europa.eu': 'Comisión Europea',
  'ecb.europa.eu': 'BCE',
  'eba.europa.eu': 'EBA',
  'stlouisfed.org': 'Fed de St. Louis (FRED)',
  'federalreserve.gov': 'Reserva Federal',
  'treasury.gov': 'Tesoro de EE. UU.',
  'bls.gov': 'BLS (EE. UU.)',
  'bea.gov': 'BEA (EE. UU.)',
  'bde.es': 'Banco de España',
  'ine.es': 'INE',
  'bis.org': 'BIS',
  'imf.org': 'FMI',
  'oecd.org': 'OCDE',
  'fca.org.uk': 'FCA (Reino Unido)',
  'amf-france.org': 'AMF (Francia)',
  'bafin.de': 'BaFin (Alemania)',
  'consob.it': 'CONSOB (Italia)',
  'afm.nl': 'AFM (Países Bajos)',
  'finanstilsynet.dk': 'Finanstilsynet (Dinamarca)',
};

export function officialSourceFor(url: string): string | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null; // official badge only over HTTPS
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, label] of Object.entries(OFFICIAL_HOSTS)) {
    if (host === domain || host.endsWith('.' + domain)) return label;
  }
  return null;
}

export const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;
export function normalizeTicker(raw: string): string | null {
  const t = raw.trim().replace(/^\$/, '').toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export function isValidCik(cik: string): boolean {
  return /^\d{1,10}$/.test(cik.trim());
}

export interface QuickLink {
  label: string;
  url: string;
  group: 'sec' | 'company' | 'search';
  hint?: string;
}

/** EDGAR filing lists for a company. Uses the CIK when known, otherwise the ticker. */
export function edgarLinks(opts: { ticker?: string | null; cik?: string | null }): QuickLink[] {
  const id = opts.cik && isValidCik(opts.cik) ? opts.cik.trim() : opts.ticker ? normalizeTicker(opts.ticker) : null;
  if (!id) return [];
  const base = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&CIK=' + encodeURIComponent(id);
  return [
    { label: 'Informes anuales (10-K)', url: `${base}&type=10-K`, group: 'sec' },
    { label: 'Informes trimestrales (10-Q)', url: `${base}&type=10-Q`, group: 'sec' },
    { label: 'Hechos relevantes (8-K)', url: `${base}&type=8-K`, group: 'sec' },
    { label: 'Operaciones de insiders (Form 4)', url: `${base}&type=4`, group: 'sec' },
    { label: 'Emisores extranjeros (20-F)', url: `${base}&type=20-F`, group: 'sec' },
    { label: 'Todas las presentaciones', url: base, group: 'sec' },
  ];
}

export function searchLinks(name: string, ticker: string | null, searchUrl: (q: string) => string): QuickLink[] {
  const who = name || ticker || '';
  if (!who) return [];
  const year = new Date().getFullYear();
  return [
    { label: `Informe anual ${year - 1} (PDF)`, url: searchUrl(`${who} annual report ${year - 1} filetype:pdf`), group: 'search' },
    { label: 'Presentación de resultados', url: searchUrl(`${who} earnings presentation investor relations`), group: 'search' },
    { label: 'Transcripción de la última conferencia', url: searchUrl(`${who} earnings call transcript`), group: 'search' },
  ];
}

/** True when the URL is on the company's investor-relations host (or a subdomain of it). */
export function isOnIrSite(url: string, irUrl: string | null | undefined): boolean {
  if (!irUrl) return false;
  const a = hostOf(url);
  const b = hostOf(irUrl);
  return !!a && !!b && (a === b || a.endsWith('.' + b));
}
