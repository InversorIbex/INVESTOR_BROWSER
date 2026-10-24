import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EventChannel, EventMap, IbApi } from '../../shared/ipc';
import type { CommandId } from '../../shared/commands';
import type { Bookmark, BrowserSnapshot, Company, DownloadItemState, PopupNotice, PortfolioData, SaveDraft, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

declare global {
  interface Window {
    ib: IbApi;
  }
}

export const ib = window.ib;
export const isMac = ib.platform === 'darwin';

/** Tiny observable store fed by main-process events. */
function channelStore<E extends EventChannel>(channel: E, initial: EventMap[E], load?: () => Promise<EventMap[E]>) {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (v: EventMap[E]) => {
    value = v;
    listeners.forEach((l) => l());
  };
  ib.on(channel, set);
  void load?.().then(set).catch(() => {});
  return {
    get: () => value,
    set,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const stateStore = channelStore('state', { tabs: [], activeTabId: null, closedCount: 0 } as BrowserSnapshot, () =>
  ib.invoke('state:get'),
);
const settingsStore = channelStore('settings', structuredClone(DEFAULT_SETTINGS) as unknown as Settings, () => ib.invoke('settings:get'));
const bookmarksStore = channelStore('bookmarks', [] as Bookmark[], () => ib.invoke('bookmarks:list'));
const downloadsStore = channelStore('downloads', [] as DownloadItemState[], () => ib.invoke('downloads:list'));
const popupStore = channelStore('popup', [] as PopupNotice[]);
const companiesStore = channelStore('companies', [] as Company[], () => ib.invoke('companies:list'));
const portfolioStore = channelStore('portfolio', { holdings: [], ops: [], watchlist: [], snapshots: [] } as PortfolioData, () => ib.invoke('portfolio:get'));
/** Apply the data returned by a portfolio action (keeps every view in sync). */
export const setPortfolio = (d: PortfolioData) => portfolioStore.set(d);
const themeStore = channelStore(
  'resolvedTheme',
  (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') as 'dark' | 'light',
);

const use = <T,>(s: { get: () => T; subscribe: (l: () => void) => () => void }) => useSyncExternalStore(s.subscribe, s.get);

export const useBrowser = () => use(stateStore);
export const useSettings = () => use(settingsStore);
export const useBookmarks = () => use(bookmarksStore);
export const useDownloads = () => use(downloadsStore);
export const usePopups = () => use(popupStore);
export const useResolvedTheme = () => use(themeStore);
export const useCompanies = () => use(companiesStore);
export const usePortfolio = () => use(portfolioStore);
export function useCompany(id: number | null | undefined): Company | null {
  const list = useCompanies();
  return id ? (list.find((c) => c.id === id) ?? null) : null;
}

// ---------- notes revision: bump when any note changes so views refetch ----------
let notesRev = 0;
const notesListeners = new Set<() => void>();
ib.on('notesChanged', () => {
  notesRev++;
  notesListeners.forEach((l) => l());
});
export const useNotesRevision = () =>
  useSyncExternalStore(
    (l) => {
      notesListeners.add(l);
      return () => notesListeners.delete(l);
    },
    () => notesRev,
  );

// ---------- "save to research" dialog ----------
let draft: SaveDraft | null = null;
const draftListeners = new Set<() => void>();
export function openSaveDialog(d: SaveDraft | null): void {
  draft = d;
  draftListeners.forEach((l) => l());
}
ib.on('saveDraft', (d) => openSaveDialog(d));
export const useSaveDraft = () =>
  useSyncExternalStore(
    (l) => {
      draftListeners.add(l);
      return () => draftListeners.delete(l);
    },
    () => draft,
  );

/** Electron wraps errors thrown in main: "Error invoking remote method 'x': Error: message". */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const i = msg.lastIndexOf('Error: ');
  return i >= 0 ? msg.slice(i + 7) : msg;
}

export function useActiveTab() {
  const s = useBrowser();
  return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settingsStore.set(await ib.invoke('settings:update', patch));
}

// ---------- commands coming from main (keyboard shortcuts pressed in a page) ----------
const commandListeners = new Set<(id: CommandId) => void>();
ib.on('command', (id) => commandListeners.forEach((l) => l(id)));
export function emitLocalCommand(id: CommandId): void {
  commandListeners.forEach((l) => l(id));
}
export function useCommandListener(fn: (id: CommandId) => void): void {
  useEffect(() => {
    commandListeners.add(fn);
    return () => void commandListeners.delete(fn);
  }, [fn]);
}

/** Run any command: UI-only ones locally, the rest in main. */
export function runCommand(id: CommandId): void {
  if (id === 'ui.palette' || id === 'ui.find' || id === 'ui.focusAddress' || id === 'ui.focusMode') emitLocalCommand(id);
  else void ib.invoke('command:run', { id });
}

// ---------- toasts ----------
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}
let toasts: Toast[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();
export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const t = { id: ++toastId, message, kind };
  toasts = [...toasts.slice(-2), t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, 3200);
}
ib.on('toast', (t) => showToast(t.message, t.kind));
export const useToasts = () =>
  useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );

// ---------- overlays ----------
// Native web views are drawn above the HTML UI, so while any HTML overlay (palette,
// address-bar suggestions) is open we hide the page and show a snapshot of it instead.
let overlayCount = 0;
let snapshot: string | null = null;
const overlayListeners = new Set<() => void>();
const notifyOverlay = () => overlayListeners.forEach((l) => l());

export function useOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    overlayCount++;
    if (overlayCount === 1) {
      void ib.invoke('ui:overlay', { open: true, snapshot: true }).then((img) => {
        if (overlayCount > 0) {
          snapshot = img;
          notifyOverlay();
        }
      });
    }
    notifyOverlay();
    return () => {
      overlayCount--;
      if (overlayCount === 0) {
        snapshot = null;
        void ib.invoke('ui:overlay', { open: false });
      }
      notifyOverlay();
    };
  }, [open]);
}

export function useOverlayState(): { active: boolean; snapshot: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    overlayListeners.add(l);
    return () => void overlayListeners.delete(l);
  }, []);
  return { active: overlayCount > 0, snapshot };
}
