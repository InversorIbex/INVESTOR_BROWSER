import { z } from 'zod';
import { NEW_TAB_URL } from './url';

// ---------- Settings ----------
export const ThemeSchema = z.enum(['system', 'dark', 'light']);
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
  kind: 'history' | 'bookmark' | 'tab' | 'search' | 'url';
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
