/**
 * TabManager — owns one sandboxed WebContentsView per web tab.
 *
 * Security model:
 *  - Tab views get NO preload, nodeIntegration off, contextIsolation on, sandbox on,
 *    and their own persistent session partition separate from the trusted UI.
 *  - Only http(s) and about:blank can be loaded. Everything else is blocked or,
 *    for mailto:/tel:, handed to the OS only after the user confirms.
 *  - Internal pages (ib://…) are rendered by the trusted UI, never inside a web view.
 */
import { clipboard, Menu, WebContentsView, type BrowserWindow, type MenuItemConstructorOptions, type Rectangle, type WebContents } from 'electron';
import type { Store } from './db';
import { classifyUrl, isInternalUrl, isSafeWebUrl, NEW_TAB_URL, normalizeInput, parseInternalRoute, searchUrl, SEARCH_ENGINES } from '../shared/url';
import type { BrowserSnapshot, Company, SaveDraft, Settings, TabError, TabState } from '../shared/types';
import { parseFigure } from '../shared/finance';
import type { CommandId, KeyInput } from '../shared/commands';
import { logError } from './log';

export const WEB_PARTITION = 'persist:web';
const MAX_CLOSED = 25;

export const webPreferencesForTabs = {
  partition: WEB_PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  safeDialogs: true,
  spellcheck: false,
  navigateOnDragDrop: false,
} as const;

interface Tab extends TabState {
  view: WebContentsView | null;
  /** Restored tab whose page has not been loaded yet (lazy restore). */
  pendingLoad: boolean;
}

export interface TabsDeps {
  win: BrowserWindow;
  store: Store;
  settings(): Settings;
  changed(): void;
  handleKey(input: KeyInput): boolean;
  popupBlocked(tabId: string, url: string): void;
  openExternalWithConsent(url: string): void;
  focusAddressBar(): void;
  runCommand(id: CommandId): void;
  companies(): Company[];
  saveDraft(draft: SaveDraft): void;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private closed: { url: string; title: string; pinned: boolean; index: number }[] = [];
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private overlayOpen = false;
  private counter = 0;

  constructor(private readonly deps: TabsDeps) {}

  // ---------------- queries ----------------
  snapshot(): BrowserSnapshot {
    return {
      tabs: this.tabs.map(toState),
      activeTabId: this.activeId,
      closedCount: this.closed.length,
    };
  }

  get active(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  get(id: string | undefined): Tab | null {
    if (!id) return this.active;
    return this.tabs.find((t) => t.id === id) ?? null;
  }

  activeWebContents(): WebContents | null {
    const t = this.active;
    return t?.view && !isInternalUrl(t.url) ? t.view.webContents : null;
  }

  ownsWebContents(wc: WebContents): boolean {
    return this.tabs.some((t) => t.view?.webContents === wc);
  }

  sessionTabs() {
    const tabs = this.tabs
      .filter((t) => isSafeWebUrl(t.url) || isInternalUrl(t.url))
      .map((t) => ({ url: t.error?.url ?? t.url, title: t.title, pinned: t.pinned, companyId: t.companyId }));
    const activeIndex = Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId));
    return { tabs, activeIndex: Math.min(activeIndex, Math.max(0, tabs.length - 1)), savedAt: Date.now() };
  }

  // ---------------- lifecycle ----------------
  create(
    opts: { url?: string; active?: boolean; index?: number; pinned?: boolean; title?: string; lazy?: boolean; companyId?: number | null } = {},
  ): string {
    const url = opts.url && (isSafeWebUrl(opts.url) || isInternalUrl(opts.url)) ? opts.url : NEW_TAB_URL;
    const route = parseInternalRoute(url);
    const companyId = route?.page === 'company' ? route.id : (opts.companyId ?? null);
    const tab: Tab = {
      id: `t${++this.counter}`,
      url,
      title: isInternalUrl(url) ? this.internalTitleFor(url) : (opts.title ?? url),
      favicon: null,
      pinned: !!opts.pinned,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      zoom: 1,
      find: null,
      audible: false,
      muted: false,
      view: null,
      pendingLoad: false,
      companyId: companyId && this.deps.companies().some((c) => c.id === companyId) ? companyId : null,
    };
    const index = opts.index ?? this.insertionIndex(tab.pinned);
    this.tabs.splice(Math.min(index, this.tabs.length), 0, tab);
    this.normalizeOrder();

    if (!isInternalUrl(url)) {
      if (opts.lazy) tab.pendingLoad = true;
      else this.load(tab, url);
    }
    if (opts.active ?? true) this.activate(tab.id);
    else this.deps.changed();
    if ((opts.active ?? true) && url === NEW_TAB_URL) this.deps.focusAddressBar();
    return tab.id;
  }

  close(id?: string): void {
    const tab = this.get(id);
    if (!tab) return;
    const index = this.tabs.indexOf(tab);
    if (tab.url !== NEW_TAB_URL || tab.view) {
      this.closed.push({ url: tab.error?.url ?? tab.url, title: tab.title, pinned: tab.pinned, index });
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    this.destroyView(tab);
    this.tabs.splice(index, 1);
    if (this.activeId === tab.id) {
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      this.activeId = null;
      if (next) this.activate(next.id);
    }
    if (this.tabs.length === 0) {
      this.create({ url: NEW_TAB_URL });
      return;
    }
    this.layout();
    this.deps.changed();
  }

  reopenClosed(): void {
    const last = this.closed.pop();
    if (!last) return;
    this.create({ url: last.url, pinned: last.pinned, index: last.index, title: last.title });
  }

  closeAll(): void {
    for (const t of this.tabs) this.destroyView(t);
    this.tabs = [];
    this.activeId = null;
  }

  activate(id: string): void {
    const tab = this.get(id);
    if (!tab) return;
    this.activeId = tab.id;
    if (tab.pendingLoad) {
      tab.pendingLoad = false;
      this.load(tab, tab.url);
    }
    this.layout();
    if (tab.view && !isInternalUrl(tab.url) && !this.overlayOpen) tab.view.webContents.focus();
    this.deps.changed();
  }

  activateRelative(delta: number): void {
    if (!this.tabs.length) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(i + delta + this.tabs.length) % this.tabs.length]!;
    this.activate(next.id);
  }

  /** 1-based; 9 means "last tab", like every other browser. */
  activateIndex(n: number): void {
    const tab = n === 9 ? this.tabs[this.tabs.length - 1] : this.tabs[n - 1];
    if (tab) this.activate(tab.id);
  }

  move(id: string, index: number): void {
    const tab = this.get(id);
    if (!tab) return;
    const from = this.tabs.indexOf(tab);
    this.tabs.splice(from, 1);
    this.tabs.splice(Math.min(index, this.tabs.length), 0, tab);
    this.normalizeOrder();
    this.deps.changed();
  }

  setPinned(id: string, pinned: boolean): void {
    const tab = this.get(id);
    if (!tab) return;
    tab.pinned = pinned;
    this.normalizeOrder();
    this.deps.changed();
  }

  duplicate(id?: string): void {
    const tab = this.get(id);
    if (!tab) return;
    this.create({ url: tab.error?.url ?? tab.url, index: this.tabs.indexOf(tab) + 1 });
  }

  // ---------------- navigation ----------------
  navigate(id: string | undefined, input: string): void {
    const tab = this.get(id) ?? this.get(this.create({ url: NEW_TAB_URL }));
    if (!tab) return;
    const target = normalizeInput(input, this.deps.settings().searchEngine);
    tab.error = null;
    tab.find = null;
    if (target.kind === 'internal') {
      this.destroyView(tab);
      tab.url = target.url;
      tab.title = this.internalTitleFor(target.url);
      const route = parseInternalRoute(target.url);
      if (route?.page === 'company') tab.companyId = route.id;
      tab.favicon = null;
      tab.loading = false;
      tab.canGoBack = tab.canGoForward = false;
      this.layout();
      this.deps.changed();
      return;
    }
    tab.pendingLoad = false;
    this.load(tab, target.url);
    this.layout();
    this.deps.changed();
  }

  back(id?: string): void {
    const wc = this.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(id?: string): void {
    const wc = this.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id?: string, ignoreCache = false): void {
    const tab = this.get(id);
    if (!tab || isInternalUrl(tab.url)) return;
    if (tab.error || !tab.view) {
      const url = tab.error?.url ?? tab.url;
      tab.error = null;
      this.load(tab, url);
      this.layout();
      this.deps.changed();
      return;
    }
    if (ignoreCache) tab.view.webContents.reloadIgnoringCache();
    else tab.view.webContents.reload();
  }

  stop(id?: string): void {
    this.get(id)?.view?.webContents.stop();
  }

  // ---------------- page tools ----------------
  /**
   * `step` = move to the next/previous match of the current query (Enter / arrows).
   * Otherwise a new find session starts. Note Electron's `findNext` option means
   * "begin a new session" — true for new queries, false for follow-ups.
   */
  find(query: string, forward = true, step = false): void {
    const tab = this.active;
    const wc = tab?.view?.webContents;
    if (!tab || !wc) return;
    if (!query) {
      wc.stopFindInPage('clearSelection');
      tab.find = { query: '', activeMatch: 0, matches: 0 };
      this.deps.changed();
      return;
    }
    const continuing = step && tab.find?.query === query;
    tab.find = continuing ? { ...tab.find!, query } : { query, activeMatch: 0, matches: 0 };
    wc.findInPage(query, { forward, findNext: !continuing });
  }

  stopFind(): void {
    const tab = this.active;
    if (!tab) return;
    tab.view?.webContents.stopFindInPage('keepSelection');
    tab.find = null;
    this.deps.changed();
  }

  zoom(delta: 'in' | 'out' | 'reset'): void {
    const tab = this.active;
    const wc = tab?.view?.webContents;
    if (!tab || !wc) return;
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const current = wc.getZoomFactor();
    let next = 1;
    if (delta === 'in') next = steps.find((s) => s > current + 0.001) ?? 5;
    if (delta === 'out') next = [...steps].reverse().find((s) => s < current - 0.001) ?? 0.25;
    wc.setZoomFactor(next);
    tab.zoom = next;
    this.deps.changed();
  }

  toggleMute(id?: string): void {
    const tab = this.get(id);
    const wc = tab?.view?.webContents;
    if (!tab || !wc) return;
    wc.setAudioMuted(!wc.isAudioMuted());
    tab.muted = wc.isAudioMuted();
    this.deps.changed();
  }

  // ---------------- research ----------------
  setCompany(id: string, companyId: number | null): void {
    const tab = this.get(id);
    if (!tab) return;
    tab.companyId = companyId;
    this.deps.changed();
  }

  tabsForCompany(companyId: number): TabState[] {
    return this.tabs.filter((t) => t.companyId === companyId).map(toState);
  }

  /** Close every tab of a company and return the web pages so the workspace can be saved. */
  closeCompanyTabs(companyId: number): { url: string; title: string }[] {
    const own = this.tabs.filter((t) => t.companyId === companyId);
    const saved = own
      .map((t) => ({ url: t.error?.url ?? t.url, title: t.title }))
      .filter((t) => isSafeWebUrl(t.url) && t.url !== 'about:blank');
    for (const t of own) this.close(t.id);
    return saved;
  }

  /** Refresh titles of internal pages after a company is renamed or deleted. */
  refreshInternalTitles(): void {
    const ids = new Set(this.deps.companies().map((c) => c.id));
    for (const t of this.tabs) {
      if (t.companyId !== null && !ids.has(t.companyId)) t.companyId = null;
      if (isInternalUrl(t.url)) t.title = this.internalTitleFor(t.url);
    }
    this.deps.changed();
  }

  /**
   * Read the current text selection of the active page from an isolated JS world:
   * page scripts cannot tamper with the getSelection used here, and nothing is
   * written into the page.
   */
  async captureSelection(): Promise<SaveDraft | null> {
    const tab = this.active;
    if (!tab) return null;
    const web = !!tab.view && isSafeWebUrl(tab.url) && !tab.error;
    let text = '';
    if (web) {
      try {
        const res = await tab.view!.webContents.executeJavaScriptInIsolatedWorld(1001, [
          { code: 'String(window.getSelection ? window.getSelection() : "").slice(0, 20000)' },
        ]);
        text = typeof res === 'string' ? res : '';
      } catch {
        text = ''; // e.g. PDF viewer: the user can still paste the quote by hand
      }
    }
    return {
      text: text.trim(),
      url: web ? tab.url : null,
      title: web ? tab.title : null,
      companyId: tab.companyId ?? this.companyForUrl(tab.url),
    };
  }

  private companyForUrl(url: string): number | null {
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    if (!host) return null;
    const match = this.deps.companies().find((c) => {
      if (!c.irUrl) return false;
      try {
        const ir = new URL(c.irUrl).hostname.replace(/^www\./, '');
        return host === ir || host.endsWith('.' + ir);
      } catch {
        return false;
      }
    });
    return match?.id ?? null;
  }

  private internalTitleFor(url: string): string {
    const route = parseInternalRoute(url);
    if (route?.page === 'company' && route.id) {
      const c = this.deps.companies().find((x) => x.id === route.id);
      return c ? `${c.ticker ? c.ticker + ' · ' : ''}${c.name}` : 'Empresa eliminada';
    }
    return internalTitle(url);
  }

  // ---------------- layout ----------------
  setBounds(b: Rectangle): void {
    this.bounds = {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)),
      height: Math.max(0, Math.round(b.height)),
    };
    this.layout();
  }

  setOverlay(open: boolean): void {
    this.overlayOpen = open;
    this.layout();
    if (!open) this.active?.view?.webContents.focus();
  }

  async capture(): Promise<string | null> {
    const tab = this.active;
    if (!tab?.view || isInternalUrl(tab.url) || tab.error || !tab.view.getVisible()) return null;
    try {
      const img = await tab.view.webContents.capturePage();
      if (img.isEmpty()) return null;
      return img.resize({ width: Math.min(img.getSize().width, 1600), quality: 'good' }).toDataURL();
    } catch {
      return null;
    }
  }

  layout(): void {
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      const visible =
        tab.id === this.activeId &&
        !this.overlayOpen &&
        !tab.error &&
        !isInternalUrl(tab.url) &&
        this.bounds.width > 0 &&
        this.bounds.height > 0;
      if (visible) tab.view.setBounds(this.bounds);
      tab.view.setVisible(visible);
    }
  }

  contextMenuForTab(id: string): void {
    const tab = this.get(id);
    if (!tab) return;
    const template: MenuItemConstructorOptions[] = [
      { label: 'Nueva pestaña a la derecha', click: () => this.create({ index: this.tabs.indexOf(tab) + 1 }) },
      { label: 'Recargar', enabled: !isInternalUrl(tab.url), click: () => this.reload(tab.id) },
      { label: 'Duplicar', click: () => this.duplicate(tab.id) },
      { label: tab.pinned ? 'Soltar pestaña' : 'Fijar pestaña', click: () => this.setPinned(tab.id, !tab.pinned) },
      {
        label: tab.muted ? 'Activar sonido del sitio' : 'Silenciar sitio',
        enabled: !!tab.view,
        click: () => this.toggleMute(tab.id),
      },
      { label: 'Copiar URL', enabled: !isInternalUrl(tab.url), click: () => clipboard.writeText(tab.error?.url ?? tab.url) },
      { type: 'separator' },
      {
        label: 'Vincular a empresa',
        submenu: this.deps.companies().length
          ? this.deps.companies().map((c) => ({
              label: `${c.ticker ? c.ticker + ' — ' : ''}${c.name}`,
              type: 'radio' as const,
              checked: tab.companyId === c.id,
              click: () => this.setCompany(tab.id, c.id),
            }))
          : [{ label: 'Aún no hay empresas — créalas en Investigación', enabled: false }],
      },
      { label: 'Desvincular de la empresa', enabled: tab.companyId !== null, click: () => this.setCompany(tab.id, null) },
      { type: 'separator' },
      { label: 'Cerrar pestaña', click: () => this.close(tab.id) },
      {
        label: 'Cerrar las demás pestañas',
        enabled: this.tabs.length > 1,
        click: () => this.tabs.filter((t) => t.id !== tab.id && !t.pinned).forEach((t) => this.close(t.id)),
      },
      {
        label: 'Cerrar pestañas a la derecha',
        enabled: this.tabs.indexOf(tab) < this.tabs.length - 1,
        click: () => this.tabs.slice(this.tabs.indexOf(tab) + 1).forEach((t) => this.close(t.id)),
      },
      { type: 'separator' },
      { label: 'Reabrir pestaña cerrada', enabled: this.closed.length > 0, click: () => this.reopenClosed() },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.deps.win });
  }

  // ---------------- internals ----------------
  private insertionIndex(pinned: boolean): number {
    if (pinned) return this.tabs.filter((t) => t.pinned).length;
    const active = this.active;
    // New tabs open right after the active one, like modern browsers.
    return active ? this.tabs.indexOf(active) + 1 : this.tabs.length;
  }

  /** Pinned tabs always come first; relative order is otherwise preserved. */
  private normalizeOrder(): void {
    this.tabs = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)];
  }

  private load(tab: Tab, url: string): void {
    if (!isSafeWebUrl(url)) {
      tab.error = { code: 0, description: 'Esquema de URL no permitido', url, kind: 'blocked' };
      return;
    }
    const view = this.ensureView(tab);
    tab.url = url;
    tab.loading = true;
    view.webContents.loadURL(url).catch(() => {
      /* failures are reported through did-fail-load */
    });
  }

  private ensureView(tab: Tab): WebContentsView {
    if (tab.view) return tab.view;
    const view = new WebContentsView({ webPreferences: { ...webPreferencesForTabs } });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    this.deps.win.contentView.addChildView(view);
    tab.view = view;
    this.wire(tab, view.webContents);
    return view;
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    tab.view = null;
    try {
      this.deps.win.contentView.removeChildView(view);
    } catch {
      /* window already gone */
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private sync(tab: Tab, wc: WebContents): void {
    if (wc.isDestroyed()) return;
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    this.deps.changed();
  }

  private wire(tab: Tab, wc: WebContents): void {
    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.deps.changed();
    });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      this.sync(tab, wc);
    });
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && tab.error) {
        tab.error = null;
        this.layout();
        this.deps.changed();
      }
    });
    wc.on('did-navigate', (_e, url) => {
      tab.url = url;
      tab.favicon = null;
      tab.find = null;
      tab.zoom = wc.getZoomFactor();
      this.recordVisit(url, wc.getTitle());
      this.sync(tab, wc);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      const changedPath = stripHash(url) !== stripHash(tab.url);
      tab.url = url;
      if (changedPath) this.recordVisit(url, wc.getTitle());
      this.sync(tab, wc);
    });
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title;
      if (this.deps.settings().historyEnabled && isSafeWebUrl(tab.url)) {
        try {
          this.deps.store.updateLatestTitle(tab.url, title);
        } catch (err) {
          logError('history.title', err);
        }
      }
      this.deps.changed();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons.find((f) => /^(https:|data:image\/)/.test(f)) ?? null;
      this.deps.changed();
    });
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      // -3 = ERR_ABORTED: user stopped / navigation replaced. Not an error to show.
      if (!isMainFrame || code === -3) return;
      tab.loading = false;
      tab.error = {
        code,
        description,
        url: validatedURL || tab.url,
        kind: code <= -200 && code > -300 ? 'certificate' : 'network',
      };
      this.layout();
      this.sync(tab, wc);
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      tab.loading = false;
      tab.error = { code: details.exitCode, description: details.reason, url: tab.url, kind: 'crashed' };
      this.layout();
      this.deps.changed();
    });
    wc.on('found-in-page', (_e, result) => {
      if (!tab.find) return;
      tab.find = { ...tab.find, activeMatch: result.activeMatchOrdinal ?? 0, matches: result.matches ?? 0 };
      this.deps.changed();
    });
    wc.on('audio-state-changed', () => {
      tab.audible = wc.isCurrentlyAudible();
      this.deps.changed();
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape' && tab.find && tab.id === this.activeId) {
        this.stopFind();
        event.preventDefault();
        return;
      }
      if (this.deps.handleKey(input)) event.preventDefault();
    });
    wc.on('will-navigate', (event) => this.guardNavigation(event, event.url));
    wc.on('will-redirect', (event) => this.guardNavigation(event, event.url));
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      const kind = classifyUrl(url);
      if (kind === 'web') {
        const isPopupWindow = disposition === 'new-window' && !!features;
        if (isPopupWindow) {
          if (this.deps.settings().blockPopupWindows) {
            this.deps.popupBlocked(tab.id, url);
            return { action: 'deny' };
          }
          // Allowed popups (e.g. "Sign in with…" flows) become small sandboxed windows,
          // inheriting the same locked-down webPreferences as tabs.
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 520,
              height: 680,
              autoHideMenuBar: true,
              webPreferences: { ...webPreferencesForTabs },
            },
          };
        }
        this.create({ url, active: disposition !== 'background-tab', index: this.tabs.indexOf(tab) + 1, companyId: tab.companyId });
      } else if (kind === 'mailto' || kind === 'tel') {
        this.deps.openExternalWithConsent(url);
      }
      return { action: 'deny' };
    });
    wc.on('context-menu', (_e, params) => this.pageContextMenu(tab, wc, params));
  }

  private guardNavigation(event: { preventDefault(): void }, url: string): void {
    const kind = classifyUrl(url);
    if (kind === 'web') return;
    event.preventDefault();
    if (kind === 'mailto' || kind === 'tel') this.deps.openExternalWithConsent(url);
  }

  private recordVisit(url: string, title: string): void {
    if (!this.deps.settings().historyEnabled || !isSafeWebUrl(url) || url === 'about:blank') return;
    try {
      this.deps.store.addVisit(url, title);
    } catch (err) {
      logError('history.add', err);
    }
  }

  private pageContextMenu(tab: Tab, wc: WebContents, params: Electron.ContextMenuParams): void {
    const items: MenuItemConstructorOptions[] = [];
    const sep = () => items.length && items[items.length - 1]!.type !== 'separator' && items.push({ type: 'separator' });
    const index = this.tabs.indexOf(tab) + 1;
    const inherit = { companyId: tab.companyId };
    const pageUrl = tab.url;
    const draftBase = { url: isSafeWebUrl(pageUrl) ? pageUrl : null, title: tab.title, companyId: tab.companyId ?? this.companyForUrl(pageUrl) };

    if (params.linkURL && isSafeWebUrl(params.linkURL)) {
      items.push(
        { label: 'Abrir enlace en pestaña nueva', click: () => this.create({ url: params.linkURL, index, ...inherit }) },
        { label: 'Abrir enlace en segundo plano', click: () => this.create({ url: params.linkURL, index, active: false, ...inherit }) },
        { label: 'Copiar dirección del enlace', click: () => clipboard.writeText(params.linkURL) },
      );
      sep();
    }
    if (params.mediaType === 'image' && params.srcURL) {
      if (isSafeWebUrl(params.srcURL))
        items.push({ label: 'Abrir imagen en pestaña nueva', click: () => this.create({ url: params.srcURL, index }) });
      items.push(
        { label: 'Copiar imagen', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copiar dirección de la imagen', click: () => clipboard.writeText(params.srcURL) },
      );
      sep();
    }
    if (params.isEditable) {
      items.push(
        { label: 'Deshacer', role: 'undo', enabled: params.editFlags.canUndo },
        { label: 'Rehacer', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Seleccionar todo', role: 'selectAll' },
      );
      sep();
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim();
      const engineId = this.deps.settings().searchEngine;
      const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]!;
      const preview = text.length > 28 ? text.slice(0, 28) + '…' : text;
      items.push(
        { label: 'Copiar', role: 'copy' },
        { label: 'Guardar en investigación…', accelerator: 'CmdOrCtrl+Shift+S', click: () => this.deps.saveDraft({ ...draftBase, text: text.slice(0, 20_000), kind: 'snippet' }) },
      );
      if (parseFigure(text) && text.length < 200)
        items.push({ label: 'Guardar como cifra…', click: () => this.deps.saveDraft({ ...draftBase, text, kind: 'figure' }) });
      items.push({ label: `Buscar «${preview}» en ${engine.name}`, click: () => this.create({ url: searchUrl(engineId, text), index }) });
      sep();
    }
    if (!params.isEditable && !params.linkURL && params.mediaType === 'none') {
      items.push(
        { label: 'Atrás', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Adelante', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Recargar', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Seleccionar todo', role: 'selectAll' },
        { label: 'Imprimir…', click: () => wc.print() },
        { type: 'separator' },
        { label: 'Guardar página en investigación…', click: () => this.deps.saveDraft({ ...draftBase, text: '', kind: 'note' }) },
      );
      sep();
    }
    items.push({ label: 'Inspeccionar', click: () => wc.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup({ window: this.deps.win });
  }
}

function toState(t: Tab): TabState {
  const { view: _view, pendingLoad: _p, ...state } = t;
  return { ...state, find: t.find ? { ...t.find } : null, error: t.error ? { ...(t.error as TabError) } : null };
}

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
}

export function internalTitle(url: string): string {
  const map: Record<string, string> = {
    'ib://newtab': 'Nueva pestaña',
    'ib://history': 'Historial',
    'ib://bookmarks': 'Favoritos',
    'ib://downloads': 'Descargas',
    'ib://settings': 'Ajustes',
    'ib://research': 'Investigación',
  };
  if (url.startsWith('ib://valuation')) return 'Valoración';
  return map[url] ?? 'Investor Browser';
}
