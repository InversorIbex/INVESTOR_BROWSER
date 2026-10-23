/**
 * Pure URL helpers shared by main and renderer. No Electron imports here so they
 * can be unit-tested in plain Node.
 */

export type InternalPage = 'newtab' | 'history' | 'bookmarks' | 'downloads' | 'settings';
export const INTERNAL_PAGES: readonly InternalPage[] = ['newtab', 'history', 'bookmarks', 'downloads', 'settings'];
export const NEW_TAB_URL = 'ib://newtab';

export interface SearchEngine {
  id: string;
  name: string;
  /** `{q}` is replaced by the URL-encoded query. */
  template: string;
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q={q}' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q={q}' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q={q}' },
  { id: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q={q}' },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/do/search?q={q}' },
];

export function searchUrl(engineId: string, query: string): string {
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]!;
  return engine.template.replace('{q}', encodeURIComponent(query.trim()));
}

export function isInternalUrl(url: string): boolean {
  return parseInternal(url) !== null;
}

export function parseInternal(url: string): InternalPage | null {
  const m = /^ib:\/\/([a-z]+)\/?$/i.exec(url.trim());
  if (!m) return null;
  const page = m[1]!.toLowerCase() as InternalPage;
  return INTERNAL_PAGES.includes(page) ? page : null;
}

/** Only these may be loaded inside a web tab. */
export function isSafeWebUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type ExternalKind = 'web' | 'internal' | 'mailto' | 'tel' | 'blocked';

/** Classify a URL a page tries to open. Anything not explicitly allowed is blocked. */
export function classifyUrl(url: string): ExternalKind {
  if (isInternalUrl(url)) return 'internal';
  if (isSafeWebUrl(url)) return 'web';
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('mailto:')) return 'mailto';
  if (lower.startsWith('tel:')) return 'tel';
  return 'blocked';
}

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$/i;

export type NormalizedInput =
  | { kind: 'url'; url: string }
  | { kind: 'internal'; url: string }
  | { kind: 'search'; url: string; query: string };

/**
 * Turn whatever the user typed in the address bar into something safe to load.
 * Dangerous schemes (javascript:, file:, data:, chrome:...) are never navigated;
 * they are treated as a search query instead.
 */
export function normalizeInput(raw: string, engineId = 'duckduckgo'): NormalizedInput {
  const input = raw.trim();
  const asSearch = (): NormalizedInput => ({ kind: 'search', url: searchUrl(engineId, input), query: input });
  if (!input) return { kind: 'internal', url: NEW_TAB_URL };

  const internal = parseInternal(input);
  if (internal) return { kind: 'internal', url: `ib://${internal}` };
  if (input === 'about:blank') return { kind: 'url', url: input };

  if (/\s/.test(input)) return asSearch();

  if (/^https?:\/\//i.test(input)) {
    try {
      return { kind: 'url', url: new URL(input).toString() };
    } catch {
      return asSearch();
    }
  }
  // Any other explicit scheme (javascript:, file:, data:, ftp:...) → search, never navigate.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(input) && !/^localhost:\d+/i.test(input)) return asSearch();

  const hostPart = input.split(/[/?#]/)[0]!;
  const hostNoPort = hostPart.replace(/:\d+$/, '');
  const isLocal = hostNoPort.toLowerCase() === 'localhost' || IPV4.test(hostNoPort);
  if (isLocal || HOST_LIKE.test(hostNoPort)) {
    try {
      const url = new URL(`${isLocal ? 'http' : 'https'}://${input}`);
      return { kind: 'url', url: url.toString() };
    } catch {
      return asSearch();
    }
  }
  return asSearch();
}

/** Compact URL for display: hides scheme, `www.` and trailing slash. */
export function displayUrl(url: string): string {
  if (isInternalUrl(url)) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
    const host = u.host.replace(/^www\./, '');
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
    return host + rest;
  } catch {
    return url;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Strip query string and fragment — used before writing anything URL-like to logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/** 'local' = plain http to this machine: not encrypted, but never leaves the computer. */
export type SecurityState = 'secure' | 'local' | 'insecure' | 'internal' | 'unknown';
export function securityStateOf(url: string): SecurityState {
  if (isInternalUrl(url)) return 'internal';
  if (url.startsWith('https://')) return 'secure';
  if (url.startsWith('http://')) {
    const host = hostOf(url);
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ? 'local' : 'insecure';
  }
  return 'unknown';
}
