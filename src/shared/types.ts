import { z } from 'zod';
import { NEW_TAB_URL } from './url';

// ---------- Settings ----------
/** 'terminal' = high-density black/amber theme for long research sessions. */
export const ThemeSchema = z.enum(['system', 'dark', 'light', 'terminal']);
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * Field validators WITHOUT defaults. Patches are validated with these so that a
 * partial update never fills in (and silently resets) fields it didn't mention.
 */
const ToolbarFields = z.object({
  home: z.boolean(),
  bookmarkStar: z.boolean(),
  downloads: z.boolean(),
  palette: z.boolean(),
  rightPanel: z.boolean(),
});
const SettingsFields = {
  theme: ThemeSchema,
  fontSize: z.number().int().min(11).max(18),
  searchEngine: z.string().max(40),
  tabLayout: z.enum(['vertical', 'horizontal']),
  sidebarWidth: z.number().int().min(180).max(420),
  sidebarVisible: z.boolean(),
  rightPanelVisible: z.boolean(),
  rightPanelWidth: z.number().int().min(260).max(520),
  restoreSession: z.boolean(),
  historyEnabled: z.boolean(),
  askDownloadLocation: z.boolean(),
  blockPopupWindows: z.boolean(),
  homePage: z.string().max(8192),
  toolbar: ToolbarFields,
  /** "Name email" sent to the SEC as required by its fair-access policy. Empty = no SEC requests. */
  secContact: z.string().max(160),
};

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 13,
  searchEngine: 'duckduckgo',
  tabLayout: 'vertical',
  sidebarWidth: 248,
  sidebarVisible: true,
  rightPanelVisible: false,
  rightPanelWidth: 320,
  restoreSession: true,
  historyEnabled: true,
  askDownloadLocation: false,
  blockPopupWindows: false,
  homePage: NEW_TAB_URL,
  toolbar: { home: false, bookmarkStar: true, downloads: true, palette: true, rightPanel: true },
  secContact: '',
} as const satisfies z.infer<z.ZodObject<typeof SettingsFields>>;

/** Full settings object, as stored. */
export const SettingsSchema = z.object(SettingsFields);
export type Settings = z.infer<typeof SettingsSchema>;
/** A partial update: only the keys present are validated and applied. */
export const SettingsPatchSchema = z.object(SettingsFields).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** Merge stored (possibly old/corrupt) settings over defaults, field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  if (raw && typeof raw === 'object') {
    for (const [key, schema] of Object.entries(SettingsFields)) {
      const value = (raw as Record<string, unknown>)[key];
      if (key === 'toolbar' && value && typeof value === 'object') {
        const tb = out.toolbar as Record<string, boolean>;
        for (const k of Object.keys(tb)) {
          const v = (value as Record<string, unknown>)[k];
          if (typeof v === 'boolean') tb[k] = v;
        }
        continue;
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  return out as Settings;
}

// ---------- Tabs ----------
export interface TabError {
  code: number;
  description: string;
  url: string;
  kind: 'network' | 'certificate' | 'crashed' | 'blocked';
}

export interface FindState {
  query: string;
  activeMatch: number;
  matches: number;
}

export interface TabState {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: TabError | null;
  zoom: number; // zoom factor, 1 = 100%
  find: FindState | null;
  audible: boolean;
  muted: boolean;
  /** Research workspace this tab belongs to, if any. */
  companyId: number | null;
}

export interface BrowserSnapshot {
  tabs: TabState[];
  activeTabId: string | null;
  closedCount: number;
}

// ---------- Library ----------
export interface Bookmark {
  id: number;
  url: string;
  title: string;
  folder: string;
  createdAt: number;
}

export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  visitedAt: number;
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
export interface DownloadItemState {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  startedAt: number;
  endedAt: number | null;
}

export type PermissionDecision = 'allow' | 'deny';
export interface SitePermission {
  origin: string;
  permission: string;
  decision: PermissionDecision;
  updatedAt: number;
}

export interface Suggestion {
  kind: 'history' | 'bookmark' | 'tab' | 'search' | 'url' | 'company';
  url: string;
  title: string;
  tabId?: string;
}

export interface PopupNotice {
  id: string;
  url: string;
  tabId: string;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataPath: string;
  dbPath: string;
}

// ---------- Research ----------
export const NOTE_KINDS = ['snippet', 'figure', 'note', 'conclusion', 'question'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  snippet: 'Fragmento',
  figure: 'Cifra',
  note: 'Nota',
  conclusion: 'Conclusión',
  question: 'Pregunta',
};
export const SECTOR_KINDS = ['general', 'bank', 'insurer', 'reit'] as const;

export interface Company {
  id: number;
  name: string;
  ticker: string | null;
  exchange: string;
  country: string;
  sector: string;
  sectorKind: (typeof SECTOR_KINDS)[number];
  irUrl: string | null;
  cik: string | null;
  color: string;
  followed: boolean;
  thesis: string;
  price: number | null;
  priceCurrency: string | null;
  priceAsOf: string | null;
  priceSource: string | null;
  savedTabs: { url: string; title: string }[];
  secName: string | null;
  fiscalYearEnd: string | null;
  secSyncedAt: number | null;
  secTaxonomy: string | null;
  createdAt: number;
  updatedAt: number;
  noteCount: number;
  openQuestions: number;
}

export interface Note {
  id: number;
  companyId: number;
  kind: NoteKind;
  body: string;
  quote: string | null;
  metric: string | null;
  period: string | null;
  value: number | null;
  scale: string | null;
  currency: string | null;
  origin: 'published' | 'user' | 'estimate' | null;
  resolved: boolean;
  sourceId: number | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  accessedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  id: number;
  companyId: number;
  url: string;
  title: string;
  accessedAt: number;
  noteCount: number;
}

/** A value obtained from an official provider (e.g. SEC EDGAR XBRL). */
export interface FinancialFact {
  id: number;
  companyId: number;
  provider: 'sec';
  metric: string;
  period: string;
  periodStart: string | null;
  periodEnd: string;
  value: number;
  unit: string;
  currency: string | null;
  concept: string;
  accn: string;
  form: string;
  filed: string;
  derived: boolean;
  restatedValue: number | null;
  restatedAccn: string | null;
  restatedFiled: string | null;
  sourceUrl: string;
  fetchedAt: number;
}

export interface InsiderRow {
  accn: string;
  seq: number;
  filed: string;
  ownerName: string;
  ownerCik: string | null;
  role: string;
  table: 'nonDerivative' | 'derivative';
  security: string;
  date: string;
  code: string;
  category: 'buy' | 'sell' | 'grant' | 'exercise' | 'tax' | 'gift' | 'disposition' | 'other';
  shares: number | null;
  price: number | null;
  acquiredDisposed: 'A' | 'D' | null;
  sharesAfter: number | null;
  ownership: 'D' | 'I' | null;
  plan10b51: boolean;
  planSource: 'checkbox' | 'footnote' | null;
  footnotes: string;
  url: string;
}

export interface InsiderSyncResult {
  parsed: number;
  transactions: number;
  errors: number;
  remaining: number;
  available: number;
}

export interface FilingRow {
  accn: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  description: string | null;
  url: string;
}

export interface SecStatus {
  contactSet: boolean;
  requestsMade: number;
  lastError: string | null;
  cacheEntries: number;
  cacheBytes: number;
}

export interface SecSyncResult {
  facts: number;
  periods: string[];
  missing: string[];
  restated: number;
  taxonomy: string | null;
  entityName: string | null;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
}

/** Sent by main when the user asks to save something from a page. */
export interface SaveDraft {
  text: string;
  url: string | null;
  title: string | null;
  companyId: number | null;
  kind?: NoteKind;
}
