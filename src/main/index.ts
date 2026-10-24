/**
 * Main process entry point: window, IPC, commands, persistence wiring.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, safeStorage, screen, session, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from './db';
import { TabManager, internalTitle, WEB_PARTITION } from './tabs';
import { configureWebSession, confirmExternal, installGlobalGuards, isTrustedUiUrl } from './security';
import { DownloadManager } from './downloads';
import { ResearchRepo, ValidationError } from './research';
import { isValidContact, SecClient, SecError, type HttpFetch } from './sec';
import { EsefClient } from './esef';
import { PortfolioRepo, type PortfolioExport } from './portfolio';
import { CalendarRepo, buildEvents } from './calendar';
import { EVENT_LABEL, toIcs, type EventType } from '../shared/calendar';
import { impliedFx, parseOpsCsv } from '../shared/portfolio';
import type { OpInput } from '../shared/portfolioSchema';
import { MarketService, type QuoteResult } from './market';
import { Secrets, SecretError } from './secrets';
import { exchangeCurrency, normalizeQuoteCurrency, providerSymbol, type FxRates, type QuoteProvider } from '../shared/market';
import { parseFigure } from '../shared/finance';
import { ProviderError } from './http';
import { countryOf, pickAnnualFilings, toCompanyFacts } from '../shared/esef';
import { normalizeCompanyFacts, parseSubmissions, parseTickerFile, searchTickers, type CompanyFacts } from '../shared/xbrl';
import { parseForm4, rawForm4File } from '../shared/form4';
import { logError } from './log';
import { BRAND } from '../shared/brand';
import { COMMANDS, UI_COMMANDS, commandForInput, tabIndexForInput, type CommandId, type KeyInput } from '../shared/commands';
import { RequestSchemas, type EventChannel, type EventMap, type RequestChannel, type ResponseMap } from '../shared/ipc';
import { isInternalUrl, isSafeWebUrl, normalizeInput, NEW_TAB_URL, displayUrl } from '../shared/url';
import { parseBookmarksHtml, serializeBookmarksHtml } from '../shared/bookmarksHtml';
import { rankBy } from '../shared/fuzzy';
import type { Company, PopupNotice, SaveDraft, Settings, Suggestion } from '../shared/types';
import type { CompanyInput, NoteInput } from '../shared/ipc';
import { normalizeTicker } from '../shared/sources';

const isMac = process.platform === 'darwin';
const DEV_SERVER_URL = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;

// Test/portable override of the profile directory. Must run before 'ready'.
if (process.env.IB_USER_DATA) app.setPath('userData', path.resolve(process.env.IB_USER_DATA));

// Every renderer runs in the Chromium sandbox.
app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

let win: BrowserWindow | null = null;
let store: Store;
let tabs: TabManager;
let downloads: DownloadManager;
let settings: Settings;
let popups: PopupNotice[] = [];
let research: ResearchRepo;
let portfolio: PortfolioRepo;
let calendar: CalendarRepo;
let sec: SecClient;
let esef: EsefClient;
let secrets: Secrets;
let market: MarketService;
let fxCache: { rates: FxRates; stale: boolean; fetchedAt: number } | null = null;
let quoteTimer: NodeJS.Timeout | null = null;
let companiesCache: Company[] = [];
let stateQueued = false;
let saveTimer: NodeJS.Timeout | null = null;

async function bootstrap(): Promise<void> {
  installGlobalGuards(
    () => win?.webContents ?? null,
    (url) => tabs?.create({ url }),
  );

  await app.whenReady();

  const opened = await openStoreWithRecovery(path.join(app.getPath('userData'), 'investor-browser.db'));
  if (!opened) {
    app.quit();
    return;
  }
  store = opened;
  research = new ResearchRepo(store.db);
  portfolio = new PortfolioRepo(store.db, research);
  calendar = new CalendarRepo(store.db);
  companiesCache = research.listCompanies();
  settings = store.getSettings();
  nativeTheme.themeSource = themeSourceFor(settings.theme);

  const webSession = configureWebSession({ store, win: () => win });
  sec = createSecClient();
  esef = createEsefClient();
  // E2E tests on Linux run without a keyring: only an unpackaged build may use a test-only cipher.
  const testCipher = !app.isPackaged && process.env.IB_TEST_ALLOW_WEAK_SECRETS === '1' && !safeStorage.isEncryptionAvailable();
  secrets = new Secrets(
    store,
    testCipher
      ? { isEncryptionAvailable: () => true, backend: () => 'test', encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((x) => x ^ 0x5a)), decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8') }
      : {
          isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
          backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'),
          encryptString: (s) => safeStorage.encryptString(s),
          decryptString: (b) => safeStorage.decryptString(b),
        },
    !app.isPackaged && process.env.IB_TEST_ALLOW_WEAK_SECRETS === '1',
  );
  market = createMarket();
  downloads = new DownloadManager(store, {
    win: () => win,
    askLocation: () => settings.askDownloadLocation,
    changed: (list) => send('downloads', list),
    downloadsDir: process.env.IB_DOWNLOADS_DIR,
  });
  downloads.attach(webSession);

  buildAppMenu();
  registerIpc();
  createWindow();

  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const url = argv.find((a) => isSafeWebUrl(a));
    if (url) tabs.create({ url });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('activate', () => {
    if (!win) createWindow();
  });
  app.on('before-quit', () => {
    persistSession();
  });
  app.on('will-quit', () => {
    try {
      store.close();
    } catch {
      /* already closed */
    }
  });
  nativeTheme.on('updated', () => {
    applyTheme();
  });
}

/**
 * A damaged or incompatible database must never brick the app. The user decides:
 * the file is moved aside (never deleted) and a fresh one is created.
 */
async function openStoreWithRecovery(dbPath: string): Promise<Store | null> {
  try {
    return new Store(dbPath);
  } catch (err) {
    logError('db.open', err);
    const { response } = await dialog.showMessageBox({
      type: 'error',
      buttons: ['Empezar con datos nuevos', 'Salir'],
      defaultId: 1,
      cancelId: 1,
      title: BRAND.name,
      message: 'No se pudo abrir la base de datos local.',
      detail:
        `${err instanceof Error ? err.message : String(err)}\n\n` +
        'Si eliges empezar de nuevo, el archivo actual se renombrará (no se borra) para que puedas recuperarlo.',
    });
    if (response !== 0) return null;
    const backup = `${dbPath}.damaged-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        renameSync(dbPath + suffix, backup + suffix);
      } catch {
        /* file may not exist */
      }
    }
    return new Store(dbPath);
  }
}

// ---------------------------------------------------------------- window

function resolvedTheme(): 'dark' | 'light' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

const CHROME_COLORS = {
  dark: { bg: '#0b0d10', symbols: '#c9ced6' },
  light: { bg: '#f4f5f7', symbols: '#3b4250' },
  terminal: { bg: '#000000', symbols: '#ffb000' },
};

/** "terminal" is a dark theme for the OS and for web pages (prefers-color-scheme: dark). */
function themeSourceFor(theme: Settings['theme']): 'system' | 'dark' | 'light' {
  return theme === 'terminal' ? 'dark' : theme;
}

function chromeTheme(): keyof typeof CHROME_COLORS {
  return settings?.theme === 'terminal' ? 'terminal' : resolvedTheme();
}

function applyTheme(): void {
  const t = chromeTheme();
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(CHROME_COLORS[t].bg);
    if (!isMac) {
      try {
        win.setTitleBarOverlay({ color: CHROME_COLORS[t].bg, symbolColor: CHROME_COLORS[t].symbols, height: 44 });
      } catch {
        /* overlay unsupported on this platform */
      }
    }
  }
  send('resolvedTheme', resolvedTheme());
}

function restoredBounds(): Partial<Rectangle> & { maximized?: boolean } {
  const saved = store.getJson<Rectangle & { maximized?: boolean }>('windowState');
  if (!saved) return { width: 1440, height: 900 };
  const area = screen.getDisplayMatching(saved).workArea;
  const visible =
    saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100 && saved.x + saved.width > area.x + 100;
  return visible ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized };
}

function createWindow(): void {
  const bounds = restoredBounds();
  const t = chromeTheme();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: BRAND.name,
    backgroundColor: CHROME_COLORS[t].bg,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 15 } }
      : { titleBarOverlay: { color: CHROME_COLORS[t].bg, symbolColor: CHROME_COLORS[t].symbols, height: 44 } }),
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: true,
      navigateOnDragDrop: false,
    },
  });
  if (bounds.maximized) win.maximize();

  tabs = new TabManager({
    win,
    store,
    settings: () => settings,
    changed: scheduleState,
    handleKey,
    popupBlocked: (tabId, url) => {
      popups = [...popups.slice(-4), { id: `p${Date.now().toString(36)}`, tabId, url }];
      send('popup', popups);
    },
    openExternalWithConsent: (url) => void confirmExternal(win, url),
    focusAddressBar: () => uiCommand('ui.focusAddress'),
    runCommand,
    companies: () => companiesCache,
    saveDraft: (draft) => openSaveDraft(draft),
    capturePrice: (d) => void capturePrice(d),
    companyLabel: (id) => {
      const c = companiesCache.find((x) => x.id === id);
      return c ? (c.ticker ?? c.name) : null;
    },
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && handleKey(input)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') tabs.back();
    if (cmd === 'browser-forward') tabs.forward();
  });
  win.on('swipe', (_e, dir) => {
    if (dir === 'left') tabs.back();
    if (dir === 'right') tabs.forward();
  });
  win.on('close', () => {
    persistSession();
    if (win) store.setJson('windowState', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  });
  win.on('closed', () => {
    tabs.closeAll();
    win = null;
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.on('did-finish-load', () => {
    send('settings', settings);
    applyTheme();
    flushState();
  });
  win.webContents.on('render-process-gone', (_e, d) => logError('ui.gone', d.reason));

  restoreTabs();

  if (DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function restoreTabs(): void {
  const previous = store.rotateSession();
  const fromArgs = process.argv.slice(1).find((a) => isSafeWebUrl(a) && a !== 'about:blank');
  if (settings.restoreSession && previous && previous.tabs.length) {
    previous.tabs.forEach((t, i) =>
      tabs.create({ url: t.url, title: t.title, pinned: t.pinned, active: false, lazy: i !== previous.activeIndex, companyId: t.companyId ?? null }),
    );
    const snap = tabs.snapshot();
    const active = snap.tabs[Math.min(previous.activeIndex, snap.tabs.length - 1)];
    if (active) tabs.activate(active.id);
  }
  if (fromArgs) tabs.create({ url: fromArgs });
  if (tabs.snapshot().tabs.length === 0) tabs.create({ url: settings.homePage || NEW_TAB_URL });
}

function restorePreviousSession(): void {
  const prev = store.loadPreviousSession();
  if (!prev?.tabs.length) {
    send('toast', { message: 'No hay una sesión anterior guardada.', kind: 'info' });
    return;
  }
  const existing = new Set(tabs.snapshot().tabs.map((t) => t.url));
  let opened = 0;
  for (const t of prev.tabs) {
    if (existing.has(t.url)) continue;
    tabs.create({ url: t.url, title: t.title, pinned: t.pinned, active: false, lazy: true, companyId: t.companyId ?? null });
    opened++;
  }
  send('toast', { message: `Sesión anterior restaurada: ${opened} pestaña(s).`, kind: 'info' });
}

function persistSession(): void {
  if (!store || !tabs) return;
  try {
    store.saveSession(tabs.sessionTabs());
  } catch (err) {
    logError('session.save', err);
  }
}

// ---------------------------------------------------------------- state & events

function send<E extends EventChannel>(channel: E, payload: EventMap[E]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(`ib:${channel}`, payload);
}

function scheduleState(): void {
  if (!stateQueued) {
    stateQueued = true;
    setImmediate(flushState);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSession, 600);
}

function flushState(): void {
  stateQueued = false;
  if (!tabs) return;
  const snap = tabs.snapshot();
  send('state', snap);
  const active = snap.tabs.find((t) => t.id === snap.activeTabId);
  if (win && !win.isDestroyed()) win.setTitle(active ? `${active.title} — ${BRAND.name}` : BRAND.name);
}

function uiCommand(id: CommandId): void {
  if (!win) return;
  win.webContents.focus();
  send('command', id);
}

function updateSettings(patch: Partial<Settings>): Settings {
  if (patch.secContact !== undefined && patch.secContact.trim() && !isValidContact(patch.secContact))
    throw new Error('Escribe tu nombre y un correo, por ejemplo: «Ana Pérez ana@ejemplo.com».');
  settings = store.updateSettings(patch);
  if (patch.theme) nativeTheme.themeSource = themeSourceFor(settings.theme);
  send('settings', settings);
  applyTheme();
  return settings;
}

// ---------------------------------------------------------------- commands

function handleKey(input: Electron.Input | KeyInput): boolean {
  const key: KeyInput = { key: input.key, control: input.control, meta: input.meta, shift: input.shift, alt: input.alt };
  const n = tabIndexForInput(key, isMac);
  if (n !== null) {
    tabs.activateIndex(n);
    return true;
  }
  const cmd = commandForInput(key, isMac);
  if (!cmd) return false;
  runCommand(cmd);
  return true;
}

function openInternal(url: string): void {
  const existing = tabs.snapshot().tabs.find((t) => t.url === url);
  if (existing) tabs.activate(existing.id);
  else tabs.create({ url });
}

function toggleBookmark(): void {
  const t = tabs.active;
  if (!t || !isSafeWebUrl(t.url) || t.error) return;
  if (store.findBookmarkByUrl(t.url)) {
    store.removeBookmarksByUrl(t.url);
    send('toast', { message: 'Eliminado de favoritos', kind: 'info' });
  } else {
    store.addBookmark(t.url, t.title || displayUrl(t.url));
    send('toast', { message: 'Añadido a favoritos', kind: 'info' });
  }
  send('bookmarks', store.listBookmarks());
}

function runCommand(id: CommandId): void {
  if (UI_COMMANDS.has(id) || id === 'ui.focusMode') return uiCommand(id);
  const wc = tabs.activeWebContents();
  switch (id) {
    case 'tab.new':
      tabs.create({ url: NEW_TAB_URL });
      break;
    case 'tab.close':
      tabs.close();
      break;
    case 'tab.reopen':
      tabs.reopenClosed();
      break;
    case 'tab.next':
      tabs.activateRelative(1);
      break;
    case 'tab.prev':
      tabs.activateRelative(-1);
      break;
    case 'tab.pin': {
      const t = tabs.active;
      if (t) tabs.setPinned(t.id, !t.pinned);
      break;
    }
    case 'tab.duplicate':
      tabs.duplicate();
      break;
    case 'nav.back':
      tabs.back();
      break;
    case 'nav.forward':
      tabs.forward();
      break;
    case 'nav.reload':
      tabs.reload();
      break;
    case 'nav.hardReload':
      tabs.reload(undefined, true);
      break;
    case 'nav.stop':
      tabs.stop();
      break;
    case 'nav.home':
      tabs.navigate(undefined, settings.homePage || NEW_TAB_URL);
      break;
    case 'ui.toggleSidebar':
      updateSettings({ sidebarVisible: !settings.sidebarVisible });
      break;
    case 'ui.toggleRightPanel':
      updateSettings({ rightPanelVisible: !settings.rightPanelVisible });
      break;
    case 'ui.toggleTabLayout':
      updateSettings({ tabLayout: settings.tabLayout === 'vertical' ? 'horizontal' : 'vertical' });
      break;
    case 'ui.cycleTheme': {
      const order = ['dark', 'terminal', 'light', 'system'] as const;
      updateSettings({ theme: order[(order.indexOf(settings.theme) + 1) % order.length] });
      break;
    }
    case 'page.zoomIn':
      tabs.zoom('in');
      break;
    case 'page.zoomOut':
      tabs.zoom('out');
      break;
    case 'page.zoomReset':
      tabs.zoom('reset');
      break;
    case 'page.devtools':
      if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });
      break;
    case 'page.print':
      wc?.print();
      break;
    case 'page.bookmark':
      toggleBookmark();
      break;
    case 'page.copyUrl': {
      const t = tabs.active;
      if (t && !isInternalUrl(t.url)) {
        clipboard.writeText(t.error?.url ?? t.url);
        send('toast', { message: 'URL copiada', kind: 'info' });
      }
      break;
    }
    case 'open.history':
      openInternal('ib://history');
      break;
    case 'open.bookmarks':
      openInternal('ib://bookmarks');
      break;
    case 'open.downloads':
      openInternal('ib://downloads');
      break;
    case 'open.settings':
      openInternal('ib://settings');
      break;
    case 'bookmarks.import':
      void importBookmarks();
      break;
    case 'bookmarks.export':
      void exportBookmarks();
      break;
    case 'research.save':
      void tabs.captureSelection().then((d) => d && openSaveDraft({ ...d, kind: d.text ? 'snippet' : 'note' }));
      break;
    case 'open.research':
      openInternal('ib://research');
      break;
    case 'open.valuation': {
      const c = tabs.active?.companyId;
      openInternal(c ? `ib://valuation/${c}` : 'ib://valuation');
      break;
    }
    case 'open.compare':
      openInternal('ib://compare');
      break;
    case 'open.portfolio':
      openInternal('ib://portfolio');
      break;
    case 'open.screener':
      openInternal('ib://screener');
      break;
    case 'open.calendar':
      openInternal('ib://calendar');
      break;
    case 'portfolio.import':
      void importPortfolio();
      break;
    case 'portfolio.export':
      void exportPortfolio();
      break;
    case 'quotes.refresh':
      void runQuotes(undefined, true)
        .then((r) => send('toast', { message: `Cotizaciones: ${r.filter((x) => x.ok).length} actualizadas${r.some((x) => !x.ok) ? `, ${r.filter((x) => !x.ok).length} sin dato` : ''}.`, kind: 'info' }))
        .catch((err) => send('toast', { message: err instanceof Error ? err.message : 'No se pudieron actualizar las cotizaciones.', kind: 'error' }));
      break;
    case 'research.export':
      void exportResearch(undefined, 'markdown');
      break;
    case 'research.exportJson':
      void exportResearch(undefined, 'json');
      break;
    case 'research.import':
      void importResearch();
      break;
    case 'data.backup':
      void backupData();
      break;
    case 'session.restore':
      restorePreviousSession();
      break;
    default: {
      const _never: never = id as never;
      void _never;
    }
  }
}

async function importBookmarks(): Promise<void> {
  if (!win) return;
  const res = await dialog.showOpenDialog(win, {
    title: 'Importar favoritos',
    filters: [{ name: 'Favoritos HTML', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  const file = res.filePaths[0];
  if (res.canceled || !file) return;
  try {
    const html = readFileSync(file, 'utf8');
    if (html.length > 50 * 1024 * 1024) throw new Error('Archivo demasiado grande');
    const { bookmarks, skipped } = parseBookmarksHtml(html);
    for (const b of bookmarks) store.addBookmark(b.url, b.title, b.folder, b.addedAt);
    send('bookmarks', store.listBookmarks());
    send('toast', {
      message: `Importados ${bookmarks.length} favoritos${skipped ? ` (${skipped} omitidos por URL no segura)` : ''}.`,
      kind: 'info',
    });
  } catch (err) {
    logError('bookmarks.import', err);
    send('toast', { message: 'No se pudo importar el archivo.', kind: 'error' });
  }
}

async function exportBookmarks(): Promise<void> {
  if (!win) return;
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportar favoritos',
    defaultPath: path.join(app.getPath('documents'), 'favoritos-investor-browser.html'),
    filters: [{ name: 'Favoritos HTML', extensions: ['html'] }],
  });
  if (res.canceled || !res.filePath) return;
  try {
    const list = store.listBookmarks().map((b) => ({ url: b.url, title: b.title, folder: b.folder, addedAt: b.createdAt }));
    writeFileSync(res.filePath, serializeBookmarksHtml(list, `${BRAND.name} — Favoritos`), 'utf8');
    send('toast', { message: `Exportados ${list.length} favoritos.`, kind: 'info' });
  } catch (err) {
    logError('bookmarks.export', err);
    send('toast', { message: 'No se pudo exportar.', kind: 'error' });
  }
}

function suggestions(query: string): Suggestion[] {
  const q = query.trim();
  if (!q) return [];
  const out: Suggestion[] = [];
  const target = normalizeInput(q, settings.searchEngine);
  out.push(
    target.kind === 'search'
      ? { kind: 'search', url: target.url, title: q }
      : { kind: 'url', url: target.url, title: target.kind === 'internal' ? internalTitle(target.url) : displayUrl(target.url) },
  );
  const seen = new Set<string>([target.url]);
  // Companies in your research come first when the query looks like a ticker or a name.
  const bare = q.replace(/^\$/, '');
  const companyHits = rankBy(companiesCache, bare, (c) => `${c.ticker ?? ''} ${c.name}`, 3).filter(
    (c) => (c.ticker ?? '').startsWith(bare.toUpperCase()) || c.name.toLowerCase().includes(bare.toLowerCase()),
  );
  if (companyHits.length) {
    const items: Suggestion[] = companyHits.map((c) => ({
      kind: 'company',
      url: `ib://company/${c.id}`,
      title: `${c.ticker ? c.ticker + ' · ' : ''}${c.name}`,
    }));
    if (q.startsWith('$')) out.unshift(...items);
    else out.push(...items);
  }
  const snap = tabs.snapshot();
  const openTabs = rankBy(
    snap.tabs.filter((t) => t.id !== snap.activeTabId && !isInternalUrl(t.url)),
    q,
    (t) => `${t.title} ${displayUrl(t.url)}`,
    2,
  );
  for (const t of openTabs) {
    out.push({ kind: 'tab', url: t.url, title: t.title, tabId: t.id });
    seen.add(t.url);
  }
  for (const b of rankBy(store.listBookmarks(), q, (b) => `${b.title} ${displayUrl(b.url)}`, 3)) {
    if (seen.has(b.url)) continue;
    out.push({ kind: 'bookmark', url: b.url, title: b.title });
    seen.add(b.url);
  }
  for (const h of store.topSites(q, 12)) {
    if (out.length >= 8) break;
    if (seen.has(h.url)) continue;
    out.push({ kind: 'history', url: h.url, title: h.title || displayUrl(h.url) });
    seen.add(h.url);
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------- IPC

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!win || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  return !!frame && frame === win.webContents.mainFrame && isTrustedUiUrl(frame.url, DEV_SERVER_URL);
}

type Handler<C extends RequestChannel> = (arg: never) => ResponseMap[C] | Promise<ResponseMap[C]>;

function handle<C extends RequestChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(`ib:${channel}`, async (event, raw) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const parsed = RequestSchemas[channel].safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid payload for ${channel}`);
    return fn(parsed.data as never);
  });
}

function registerIpc(): void {
  handle('state:get', () => tabs.snapshot());
  handle('tabs:create', (a: { url?: string; active?: boolean; companyId?: number }) => {
    const url = a.url ? normalizeInput(a.url, settings.searchEngine).url : NEW_TAB_URL;
    return tabs.create({ url, active: a.active, companyId: a.companyId ?? null });
  });
  handle('tabs:close', (a: { id: string }) => tabs.close(a.id));
  handle('tabs:activate', (a: { id: string }) => tabs.activate(a.id));
  handle('tabs:navigate', (a: { id?: string; input: string }) => tabs.navigate(a.id, resolveTickerInput(a.input)));
  handle('tabs:move', (a: { id: string; index: number }) => tabs.move(a.id, a.index));
  handle('tabs:pin', (a: { id: string; pinned: boolean }) => tabs.setPinned(a.id, a.pinned));
  handle('tabs:contextMenu', (a: { id: string }) => tabs.contextMenuForTab(a.id));
  handle('tabs:find', (a: { query: string; forward?: boolean; step?: boolean }) =>
    tabs.find(a.query, a.forward ?? true, a.step ?? false),
  );
  handle('tabs:stopFind', () => tabs.stopFind());
  handle('command:run', (a: { id: CommandId }) => {
    if (!(a.id in COMMANDS)) return;
    if (UI_COMMANDS.has(a.id) || a.id === 'ui.focusMode') return; // UI already handles these itself
    runCommand(a.id);
  });
  handle('ui:contentBounds', (a: Rectangle) => tabs.setBounds(a));
  handle('ui:overlay', async (a: { open: boolean; snapshot?: boolean }) => {
    let shot: string | null = null;
    if (a.open && a.snapshot) shot = await tabs.capture();
    tabs.setOverlay(a.open);
    return shot;
  });
  handle('settings:get', () => settings);
  handle('settings:update', (patch: Partial<Settings>) => updateSettings(patch));
  handle('bookmarks:list', () => store.listBookmarks());
  handle('bookmarks:add', (a: { url: string; title: string; folder?: string }) => {
    if (!isSafeWebUrl(a.url)) throw new Error('URL no permitida');
    const b = store.addBookmark(a.url, a.title || displayUrl(a.url), a.folder ?? '');
    send('bookmarks', store.listBookmarks());
    return b;
  });
  handle('bookmarks:update', (a: { id: number; title?: string; folder?: string }) => {
    store.updateBookmark(a.id, a);
    send('bookmarks', store.listBookmarks());
  });
  handle('bookmarks:remove', (a: { id: number }) => {
    store.removeBookmark(a.id);
    send('bookmarks', store.listBookmarks());
  });
  handle('history:list', (a: { query?: string; limit?: number }) => store.listHistory(a.query, a.limit));
  handle('history:remove', (a: { id: number }) => store.removeHistoryEntry(a.id));
  handle('history:clear', (a: { range: 'hour' | 'day' | 'week' | 'all' }) => {
    const span = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3, all: Infinity }[a.range];
    return store.clearHistory(span === Infinity ? 0 : Date.now() - span);
  });
  handle('suggest', (a: { query: string }) => suggestions(a.query));
  handle('downloads:list', () => downloads.list());
  handle('downloads:action', (a: { id: string; action: 'open' | 'show' | 'cancel' | 'pause' | 'resume' | 'remove' }) =>
    downloads.action(a.id, a.action),
  );
  handle('downloads:clear', () => downloads.clearFinished());
  handle('permissions:list', () => store.listPermissions());
  handle('permissions:remove', (a: { origin: string; permission: string }) => store.removePermission(a.origin, a.permission));
  handle('popups:open', (a: { id: string }) => {
    const p = popups.find((x) => x.id === a.id);
    popups = popups.filter((x) => x.id !== a.id);
    send('popup', popups);
    if (p) tabs.create({ url: p.url });
  });
  handle('popups:dismiss', (a: { id: string }) => {
    popups = popups.filter((x) => x.id !== a.id);
    send('popup', popups);
  });
  handle('app:info', () => ({
    name: BRAND.name,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userDataPath: app.getPath('userData'),
    dbPath: store.path,
  }));
  registerResearchIpc();
  registerSecIpc();
  registerEsefIpc();
  registerMarketIpc();
  registerPortfolioIpc();
  registerCalendarIpc();
  scheduleQuotes(15_000);
  handle('data:clear', async (a: { what: 'cache' | 'siteData' }) => {
    const ses = session.fromPartition(WEB_PARTITION);
    if (a.what === 'cache') {
      await ses.clearCache();
      send('toast', { message: 'Caché vaciada.', kind: 'info' });
      return;
    }
    if (!win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Borrar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: '¿Borrar cookies y datos de todos los sitios?',
      detail: 'Se cerrará la sesión en todas las webs. Favoritos, historial y notas no se tocan.',
    });
    if (response !== 0) return;
    await ses.clearStorageData();
    send('toast', { message: 'Cookies y datos de sitios borrados.', kind: 'info' });
  });
}

// ---------------------------------------------------------------- menu

function buildAppMenu(): void {
  if (!isMac) {
    // Windows/Linux: no native menu bar. Shortcuts are handled in before-input-event,
    // and Chromium provides copy/paste/undo natively.
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

// ---------------------------------------------------------------- research

function refreshCompanies(): void {
  companiesCache = research.listCompanies();
  send('companies', companiesCache);
  tabs?.refreshInternalTitles();
}

function openSaveDraft(draft: SaveDraft): void {
  if (!win) return;
  win.webContents.focus();
  send('saveDraft', draft);
}

/** "$MSFT" → the MSFT dossier when it exists in your research. */
function resolveTickerInput(input: string): string {
  const m = /^\$([A-Za-z0-9.\-]{1,10})$/.exec(input.trim());
  if (!m) return input;
  const ticker = normalizeTicker(m[1]!);
  const hits = ticker ? companiesCache.filter((c) => c.ticker === ticker) : [];
  if (hits.length >= 1) return `ib://company/${hits[0]!.id}`;
  send('toast', { message: `${ticker ?? m[1]} no está en tu investigación. Créala en Investigación.`, kind: 'info' });
  return 'ib://research';
}

/** Turn repository validation errors into clean messages for the UI. */
function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ValidationError) throw new Error(err.message);
    if (err && typeof err === 'object' && 'issues' in err) throw new Error('Datos no válidos.');
    throw err;
  }
}

function notesChanged(companyId: number | null): void {
  send('notesChanged', { companyId });
  refreshCompanies();
}

function registerResearchIpc(): void {
  handle('companies:list', () => companiesCache);
  handle('companies:save', (a: CompanyInput) => {
    const c = guarded(() => research.saveCompany(a));
    refreshCompanies();
    return c;
  });
  handle('companies:remove', async (a: { id: number }) => {
    const c = companiesCache.find((x) => x.id === a.id);
    if (!c || !win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Eliminar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: `¿Eliminar ${c.ticker ?? c.name} y toda su investigación?`,
      detail: `Se borrarán ${c.noteCount} notas y sus fuentes. Las pestañas abiertas no se cierran. Puedes exportarla antes (Markdown o JSON).`,
    });
    if (response !== 0) return;
    research.removeCompany(a.id);
    notesChanged(a.id);
  });
  handle('companies:setPrice', (a: { id: number; price: number | null; currency?: string | null; asOf?: string | null; source?: string | null }) => {
    research.setPrice(a.id, a);
    refreshCompanies();
  });
  handle('tabs:setCompany', (a: { id: string; companyId: number | null }) => {
    if (a.companyId !== null && !companiesCache.some((c) => c.id === a.companyId)) throw new Error('La empresa no existe.');
    tabs.setCompany(a.id, a.companyId);
  });
  handle('workspace:close', (a: { companyId: number }) => {
    const saved = tabs.closeCompanyTabs(a.companyId);
    research.setSavedTabs(a.companyId, saved);
    refreshCompanies();
    send('toast', { message: `Espacio guardado: ${saved.length} pestaña(s).`, kind: 'info' });
  });
  handle('workspace:open', (a: { companyId: number }) => {
    const open = tabs.tabsForCompany(a.companyId);
    if (open.length) return tabs.activate(open[0]!.id);
    const c = companiesCache.find((x) => x.id === a.companyId);
    if (!c) return;
    if (!c.savedTabs.length) {
      tabs.create({ url: `ib://company/${c.id}` });
      return;
    }
    c.savedTabs.forEach((t, i) => tabs.create({ url: t.url, title: t.title, companyId: c.id, active: i === 0, lazy: i !== 0 }));
  });
  handle('notes:list', (a: { companyId?: number; query?: string }) => research.listNotes(a.companyId, a.query));
  handle('notes:add', (a: NoteInput) => {
    const n = guarded(() => research.addNote(a));
    notesChanged(n.companyId);
    return n;
  });
  handle('notes:update', (a: { id: number; body?: string; resolved?: boolean }) => {
    const companyId = guarded(() => research.updateNote(a.id, a));
    notesChanged(companyId);
  });
  handle('notes:remove', (a: { id: number }) => notesChanged(research.removeNote(a.id)));
  handle('sources:list', (a: { companyId: number }) => research.listSources(a.companyId));
  handle('research:captureSelection', async () => {
    const d = await tabs.captureSelection();
    if (d) openSaveDraft({ ...d, kind: d.text ? 'snippet' : 'note' });
  });
  handle('research:export', (a: { companyId?: number; format: 'markdown' | 'json' }) => exportResearch(a.companyId, a.format));
  handle('research:import', () => importResearch());
  handle('data:backup', () => backupData());
}

async function exportResearch(companyId: number | undefined, format: 'markdown' | 'json'): Promise<void> {
  if (!win) return;
  const c = companyId ? companiesCache.find((x) => x.id === companyId) : undefined;
  const base = c ? `investigacion-${(c.ticker ?? c.name).replace(/[^\w.-]+/g, '_')}` : 'investigacion';
  const ext = format === 'json' ? 'json' : 'md';
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportar investigación',
    defaultPath: path.join(app.getPath('documents'), `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`),
    filters: [format === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'Markdown', extensions: ['md'] }],
  });
  if (res.canceled || !res.filePath) return;
  const body = format === 'json' ? JSON.stringify(research.exportJson(companyId), null, 2) : research.exportMarkdown(companyId);
  writeFileSync(res.filePath, body, 'utf8');
  send('toast', { message: 'Investigación exportada.', kind: 'info' });
}

// ---------------------------------------------------------------- calendar

/** Companies the calendar follows: portfolio, watchlist and followed companies. */
function calendarScope() {
  const p = portfolio.get();
  const ids = new Set([...p.holdings.map((h) => h.companyId), ...p.watchlist.map((w) => w.companyId), ...companiesCache.filter((c) => c.followed).map((c) => c.id)]);
  const held = new Set(p.holdings.map((h) => h.companyId));
  // Holdings first: the free EODHD quota goes where it matters.
  return companiesCache.filter((c) => ids.has(c.id)).sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)));
}

async function calendarEvents(from: string, to: string) {
  const scope = calendarScope();
  const earn = await market.earnings(from, to, false);
  let withDividends = 0;
  const inputs = [];
  for (const c of scope) {
    const sym = providerSymbol(c, 'eodhd');
    const div = sym ? await market.dividends(sym, false) : null;
    if (div?.fetchedAt) withDividends++;
    inputs.push({ company: c, filings: research.listFilings(c.id, 60), esef: research.listEsefFilings(c.id), dividends: div?.rows ?? null });
  }
  const events = [...buildEvents(inputs, earn.rows, from, to, earn.fetchedAt), ...calendar.list(from, to)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.companyId - b.companyId));
  return { events, earningsAt: earn.fetchedAt, withDividends, scope: scope.length };
}

function registerCalendarIpc(): void {
  handle('calendar:get', (a: { from: string; to: string }) => providerGuard('el calendario', () => calendarEvents(a.from, a.to)));
  handle('calendar:refresh', (a: { from: string; to: string }) =>
    providerGuard('el calendario', async () => {
      const finnhub = secrets.describe('finnhub').readable;
      const eodhd = secrets.describe('eodhd').readable;
      let earnings = 0;
      if (finnhub) {
        const to90 = new Date(Date.now() + 90 * 86400e3).toISOString().slice(0, 10);
        earnings = (await market.earnings(a.from < new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : a.from, a.to > to90 ? a.to : to90, true)).rows.length;
      }
      let dividends = 0;
      let pending = 0;
      for (const c of calendarScope()) {
        const sym = providerSymbol(c, 'eodhd');
        if (!sym || !eodhd) continue;
        if (market.quotaLeft() < 1) {
          pending++;
          continue;
        }
        try {
          if ((await market.dividends(sym, true)).spent) dividends++;
        } catch (err) {
          if (err instanceof ProviderError && (err.code === 'quota' || err.code === 'forbidden')) {
            pending++;
            continue;
          }
          if (!(err instanceof ProviderError)) throw err;
        }
      }
      return { earnings, dividends, pending, eodhdLeft: market.quotaLeft(), finnhub, eodhd };
    }),
  );
  handle('calendar:add', (a: { companyId: number; date: string; type: EventType; note: string }) => {
    if (!companiesCache.some((c) => c.id === a.companyId)) throw new Error('La empresa no existe.');
    calendar.add(a.companyId, a.date, a.type, a.note);
  });
  handle('calendar:remove', (a: { id: number }) => calendar.remove(a.id));
  handle('calendar:exportIcs', async (a: { from: string; to: string }) => {
    if (!win) return null;
    const { events } = await calendarEvents(a.from, a.to);
    const res = await dialog.showSaveDialog(win, { title: 'Exportar calendario', defaultPath: 'calendario-bursatil.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (res.canceled || !res.filePath) return null;
    const name = (id: number) => {
      const c = companiesCache.find((x) => x.id === id);
      return c ? (c.ticker ?? c.name) : '';
    };
    writeFileSync(res.filePath, toIcs(events.map((e) => ({ ...e, title: `${name(e.companyId)} · ${EVENT_LABEL[e.type]}${e.amount ? ` ${e.amount} ${e.currency ?? ''}` : ''}` }))), 'utf8');
    send('toast', { message: `Calendario exportado: ${events.length} evento(s).`, kind: 'info' });
    return res.filePath;
  });
}

// ---------------------------------------------------------------- portfolio

function registerPortfolioIpc(): void {
  // Every change is broadcast, so all views stay in sync whoever made it.
  const data = () => {
    const d = portfolio.get();
    send('portfolio', d);
    return d;
  };
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ValidationError) throw new Error(err.message);
      if (err instanceof Error && err.name === 'ZodError') throw new Error('Datos de la operación no válidos.');
      throw err;
    }
  };
  handle('portfolio:get', () => portfolio.get());
  handle('portfolio:add', (a: { companyId: number }) => guard(() => (portfolio.add(a.companyId), data())));
  handle('portfolio:remove', (a: { companyId: number }) => guard(() => (portfolio.remove(a.companyId), data())));
  handle('portfolio:addOp', (a: OpInput) => guard(() => (portfolio.addOp(a), data())));
  handle('portfolio:removeOp', (a: { id: number }) => guard(() => (portfolio.removeOp(a.id), data())));
  handle('portfolio:snapshot', (a: { date: string; totalEur: number; costEur: number; positions: number }) => guard(() => void (portfolio.snapshot(a.date, a.totalEur, a.costEur, a.positions), data())));
  handle('watchlist:set', (a: { companyId: number; target: number | null; note: string | null }) => guard(() => (portfolio.setWatch(a.companyId, a.target, a.note), data())));
  handle('watchlist:remove', (a: { companyId: number }) => guard(() => (portfolio.removeWatch(a.companyId), data())));
  handle('portfolio:import', () => importPortfolio());
  handle('portfolio:export', () => exportPortfolio());
}

/** CSV rows from a broker → portfolio file. Tickers must be unambiguous (or carry their exchange). */
function csvToPortfolio(text: string, fxToday: (c: string) => number | null): { file: PortfolioExport; warnings: string[] } {
  const { rows, errors } = parseOpsCsv(text);
  if (!rows.length) throw new ValidationError(errors[0] ?? 'El CSV no tiene operaciones.');
  const warnings = [...errors];
  const ops: PortfolioExport['ops'] = [];
  for (const r of rows) {
    const matches = companiesCache.filter((c) => c.ticker === r.ticker && (!r.exchange || c.exchange === r.exchange));
    const exchange = r.exchange ?? (matches.length === 1 ? matches[0]!.exchange : null);
    if (!exchange) {
      warnings.push(`${r.ticker}: ${matches.length > 1 ? 'el ticker existe en varias bolsas' : 'empresa desconocida'}; añade la columna «bolsa» (BME, NYSE, EPA…).`);
      continue;
    }
    const raw = exchangeCurrency(exchange) ?? 'EUR';
    const { price, currency } = normalizeQuoteCurrency(r.price, raw);
    const cur = currency ?? 'EUR';
    const fx = cur === 'EUR' ? 1 : (r.fxPerEur ?? impliedFx({ ...r, price }) ?? fxToday(cur));
    if (!fx) {
      warnings.push(`${r.ticker} ${r.date ?? ''}: sin tipo de cambio para ${cur}.`);
      continue;
    }
    if (cur !== 'EUR' && r.fxPerEur === null && r.totalEur === null) warnings.push(`${r.ticker} ${r.date ?? ''}: sin tipo de cambio de la operación; se usa el de hoy.`);
    ops.push({ ticker: r.ticker, exchange, date: r.date, side: r.side, qty: r.qty, price, currency: cur, feeEur: r.feeEur, fxPerEur: fx, source: 'import' });
  }
  return { file: { format: 'investor-browser/portfolio', version: 1, holdings: [], watchlist: [], ops }, warnings };
}

async function importPortfolio(): Promise<{ companies: number; holdings: number; ops: number; watchlist: number; warnings: string[] } | null> {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Importar cartera',
    filters: [{ name: 'Cartera (JSON de Investor Browser) o CSV del bróker', extensions: ['json', 'csv', 'txt'] }],
    properties: ['openFile'],
  });
  const file = res.filePaths[0];
  if (res.canceled || !file) return null;
  const fx = await getFx().catch(() => null);
  const fxToday = (c: string) => fx?.rates.perEur[c] ?? null;
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > 20 * 1024 * 1024) throw new ValidationError('Archivo demasiado grande.');
    let parsed: unknown;
    let extra: string[] = [];
    if (/\.json$/i.test(file)) parsed = JSON.parse(raw);
    else {
      const c = csvToPortfolio(raw, fxToday);
      parsed = c.file;
      extra = c.warnings;
    }
    const preview = parsed as Partial<PortfolioExport>;
    const tickers = new Set((preview.ops ?? []).map((o) => `${o.ticker}`));
    // Replacing operations is destructive: always ask.
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Importar', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      title: 'Importar cartera',
      message: `¿Importar ${preview.holdings?.length ?? 0} posición(es), ${preview.ops?.length ?? 0} operación(es) y ${preview.watchlist?.length ?? 0} empresa(s) en seguimiento?`,
      detail: `${tickers.size ? `Las operaciones de ${[...tickers].slice(0, 12).join(', ')}${tickers.size > 12 ? '…' : ''} sustituirán a las que ya tuvieran. ` : ''}Las empresas que no existan se crearán. Puedes exportar tu cartera antes como copia.${extra.length ? `\n\nAvisos:\n${extra.slice(0, 8).join('\n')}` : ''}`,
    });
    if (response !== 0) return null;
    const r = portfolio.import(parsed, fxToday);
    r.warnings.unshift(...extra);
    refreshCompanies();
    send('portfolio', portfolio.get());
    send('toast', { message: `Cartera importada: ${r.holdings} posición(es), ${r.ops} operación(es), ${r.watchlist} en seguimiento${r.warnings.length ? ` · ${r.warnings.length} aviso(s)` : ''}.`, kind: 'info' });
    return r;
  } catch (err) {
    logError('portfolio.import', err);
    const msg = err instanceof ValidationError ? err.message : 'El archivo no es una cartera válida (JSON de Investor Browser o CSV con ticker, acciones y precio).';
    send('toast', { message: msg, kind: 'error' });
    return null;
  }
}

async function exportPortfolio(): Promise<string | null> {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportar cartera',
    defaultPath: `cartera-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Cartera (JSON)', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return null;
  writeFileSync(res.filePath, JSON.stringify(portfolio.export(), null, 2), 'utf8');
  send('toast', { message: 'Cartera exportada.', kind: 'info' });
  return res.filePath;
}

async function importResearch(): Promise<void> {
  if (!win) return;
  const res = await dialog.showOpenDialog(win, {
    title: 'Importar investigación',
    filters: [{ name: 'Investigación (JSON)', extensions: ['json'] }],
    properties: ['openFile'],
  });
  const file = res.filePaths[0];
  if (res.canceled || !file) return;
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > 50 * 1024 * 1024) throw new Error('Archivo demasiado grande');
    const r = research.importJson(JSON.parse(raw));
    notesChanged(null);
    send('toast', {
      message: `Importado: ${r.companies} empresa(s) nueva(s), ${r.notes} nota(s)${r.skipped ? `, ${r.skipped} omitida(s) por no ser válidas` : ''}.`,
      kind: 'info',
    });
  } catch (err) {
    logError('research.import', err);
    send('toast', { message: 'El archivo no es una exportación válida de Investor Browser.', kind: 'error' });
  }
}

/** Consistent snapshot of the whole database, safe while the app is running. */
async function backupData(): Promise<void> {
  if (!win) return;
  const res = await dialog.showSaveDialog(win, {
    title: 'Copia de seguridad',
    defaultPath: path.join(app.getPath('documents'), `investor-browser-backup-${new Date().toISOString().slice(0, 10)}.db`),
    filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
  });
  if (res.canceled || !res.filePath) return;
  try {
    rmSync(res.filePath, { force: true }); // VACUUM INTO refuses to overwrite
    store.db.prepare('VACUUM INTO ?').run(res.filePath);
    send('toast', { message: 'Copia de seguridad creada.', kind: 'info' });
  } catch (err) {
    logError('backup', err);
    send('toast', { message: 'No se pudo crear la copia de seguridad.', kind: 'error' });
  }
}

// ---------------------------------------------------------------- data sessions

/**
 * fetch() through a dedicated, cookie-less session that only accepts responses
 * from the given hosts (redirects elsewhere are rejected). Data traffic never
 * mixes with browsing and never carries the user's cookies.
 */
function dataFetch(partition: string, hostOk: (host: string) => boolean): HttpFetch {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  return async (url, init) => {
    const res = await ses.fetch(url, { headers: init.headers, signal: init.signal, credentials: 'omit' });
    const finalHost = new URL(res.url || url).hostname;
    if (!(hostOk(finalHost) || finalHost === '127.0.0.1')) throw new Error('Redirección a un dominio no permitido');
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };
}

function providerGuard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof ProviderError || err instanceof ValidationError || err instanceof SecError) throw new Error(err.message);
    logError(what, err);
    throw new Error(`No se pudieron procesar los datos de ${what}.`);
  });
}

// ---------------------------------------------------------------- ESEF (Europe)

function createEsefClient(): EsefClient {
  return new EsefClient({
    fetch: dataFetch('esef-data', (h) => h === 'filings.xbrl.org'),
    cache: { get: (k) => store.cacheGet('esef', k), set: (k, b, t) => store.cacheSet('esef', k, b, t) },
    contact: () => settings.secContact,
    appVersion: app.getVersion(),
    baseOverride: process.env.IB_ESEF_BASE_URL ?? null,
  });
}

function registerEsefIpc(): void {
  handle('esef:search', (a: { query: string }) => providerGuard('filings.xbrl.org', () => esef.search(a.query)));
  handle('esef:link', (a: { companyId: number; lei: string; name?: string }) =>
    providerGuard('filings.xbrl.org', async () => {
      const c = research.linkEsef(a.companyId, a.lei, a.name ?? null, null);
      refreshCompanies();
      return c;
    }),
  );
  handle('esef:unlink', (a: { companyId: number }) => {
    research.unlinkEsef(a.companyId);
    refreshCompanies();
    notesChanged(a.companyId);
  });
  handle('esef:filings', (a: { companyId: number }) => research.listEsefFilings(a.companyId));
  handle('esef:sync', (a: { companyId: number; force?: boolean }) =>
    providerGuard('filings.xbrl.org', async () => {
      const company = companiesCache.find((c) => c.id === a.companyId);
      if (!company?.lei) throw new ValidationError('Vincula primero la empresa con su identificador LEI.');
      const list = await esef.filings(company.lei, a.force);
      if (!list.data.length) throw new ValidationError('filings.xbrl.org no tiene informes anuales de esta entidad.');
      const chosen = pickAnnualFilings(list.data, 6);
      const reports = [];
      for (const f of chosen) {
        try {
          reports.push({ filing: f, facts: (await esef.reportFacts(f)).facts });
        } catch (err) {
          // One broken report must not hide the others; stop only on connection problems.
          if (err instanceof ProviderError && (err.code === 'network' || err.code === 'rate-limited') && reports.length === 0) throw err;
          logError('esef-report', err);
        }
      }
      if (!reports.length) throw new ValidationError('No se pudo leer ningún informe de esta entidad.');
      const entityName = list.data.find((f) => f.entityName)?.entityName ?? company.esefName;
      const norm = normalizeCompanyFacts(toCompanyFacts(company.lei, entityName, reports), 10);
      const country = list.data[0]?.country ?? countryOf(company);
      research.linkEsef(company.id, company.lei, entityName ?? null, country);
      research.saveEsef(company.id, list.data, new Set(reports.map((r) => r.filing.fxoId)), { ...norm, entityName: entityName ?? null }, list.fetchedAt);
      refreshCompanies();
      notesChanged(company.id);
      return {
        facts: norm.facts.length,
        periods: [...new Set(norm.facts.map((f) => f.period))],
        missing: norm.missing,
        restated: norm.facts.filter((f) => f.restatedFrom).length,
        filings: reports.length,
        entityName: entityName ?? null,
        fromCache: list.fromCache,
        stale: list.stale,
        fetchedAt: list.fetchedAt,
      };
    }),
  );
}

// ---------------------------------------------------------------- market data (delayed quotes, FX)

function createMarket(): MarketService {
  const override = process.env.IB_MARKET_BASE_URL ?? null;
  return new MarketService({
    fetch: {
      finnhub: dataFetch('market-data', (h) => h === 'finnhub.io'),
      eodhd: dataFetch('market-data', (h) => h === 'eodhd.com'),
      ecb: dataFetch('market-data', (h) => h === 'data-api.ecb.europa.eu'),
    },
    cache: { get: (k) => store.cacheGet('market', k), set: (k, b, t) => store.cacheSet('market', k, b, t) },
    kv: store,
    secrets,
    appVersion: app.getVersion(),
    eodhdDailyLimit: () => settings.eodhdDailyLimit,
    baseOverride: override,
  });
}

function quoteTargets(ids?: number[]) {
  // Followed companies first, then the oldest prices: the free EODHD quota goes where it matters.
  return companiesCache
    .filter((c) => (ids ? ids.includes(c.id) : c.followed))
    .sort((a, b) => Number(b.followed) - Number(a.followed) || (a.priceFetchedAt ?? 0) - (b.priceFetchedAt ?? 0))
    .map((c) => ({ companyId: c.id, ticker: c.ticker, exchange: c.exchange, quoteSymbol: c.quoteSymbol, priceFetchedAt: c.priceKind === 'manual' || c.priceKind === 'capture' ? null : c.priceFetchedAt }));
}

async function runQuotes(ids: number[] | undefined, force: boolean): Promise<QuoteResult[]> {
  const results = await market.refresh(quoteTargets(ids), force);
  const now = Date.now();
  for (const r of results)
    if (r.ok && r.price && r.asOf && r.provider && r.symbol)
      research.setQuote(r.companyId, { price: r.price, currency: r.currency ?? null, asOf: r.asOf, provider: r.provider, symbol: r.symbol, prevClose: r.prevClose ?? null, changePct: r.changePct ?? null }, now);
  if (results.some((r) => r.ok)) refreshCompanies();
  return results;
}

function scheduleQuotes(delay: number): void {
  if (quoteTimer) clearTimeout(quoteTimer);
  quoteTimer = setTimeout(() => {
    const hasKey = secrets.describe('finnhub').readable || secrets.describe('eodhd').readable;
    const job = settings.quotesAuto && hasKey ? runQuotes(undefined, false).catch((err) => logError('quotes', err)) : Promise.resolve();
    void job.finally(() => scheduleQuotes(30 * 60e3));
  }, delay);
  quoteTimer.unref?.();
}

async function getFx(force = false): Promise<{ rates: FxRates; stale: boolean; fetchedAt: number } | null> {
  try {
    fxCache = await market.fxRates(force);
  } catch (err) {
    if (!fxCache) logError('fx', err);
  }
  return fxCache;
}

/** A price selected by the user on a page they are reading. Always confirmed before saving. */
async function capturePrice(d: { url: string | null; title: string; companyId: number | null; text: string }): Promise<void> {
  const c = companiesCache.find((x) => x.id === d.companyId);
  const parsed = parseFigure(d.text);
  if (!c || !parsed || !(parsed.value > 0) || !win) return;
  const currency = c.priceCurrency ?? exchangeCurrency(c.exchange, c.quoteSymbol) ?? 'EUR';
  const norm = normalizeQuoteCurrency(parsed.value, currency);
  let host = 'página web';
  try {
    host = d.url ? new URL(d.url).hostname.replace(/^www\./, '') : host;
  } catch {
    /* keep default */
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Guardar precio', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    title: 'Usar como cotización',
    message: `¿Guardar ${norm.price.toLocaleString('es-ES', { maximumFractionDigits: 4 })} ${norm.currency ?? ''} como precio de ${c.ticker ?? c.name}?`,
    detail: `Texto seleccionado: «${d.text.slice(0, 60)}»${parsed.ambiguous ? '\n⚠ El separador es ambiguo: comprueba que el valor es correcto.' : ''}${currency === 'GBX' ? '\nPeniques convertidos a libras.' : ''}\nFuente: ${host}, ahora. Se guardará como «capturado», con la página como fuente; no es un dato en tiempo real.`,
  });
  if (response !== 0) return;
  research.setPrice(c.id, { price: norm.price, currency: norm.currency, asOf: new Date().toISOString(), source: `${host} · ${d.title.slice(0, 120)}`, kind: 'capture' });
  refreshCompanies();
  send('toast', { message: `Precio de ${c.ticker ?? c.name} guardado desde ${host}.`, kind: 'info' });
}

function registerMarketIpc(): void {
  const describe = () => ({
    finnhub: secrets.describe('finnhub'),
    eodhd: secrets.describe('eodhd'),
    canStore: secrets.canStore(),
    eodhdUsed: market.quotaUsed(),
    eodhdLimit: settings.eodhdDailyLimit,
  });
  handle('quotes:status', () => describe());
  handle('quotes:setKey', (a: { provider: QuoteProvider; key: string }) =>
    providerGuard(a.provider === 'finnhub' ? 'Finnhub' : 'EODHD', async () => {
      const can = secrets.canStore();
      if (!can.ok) throw new ValidationError(can.reason ?? 'No se puede guardar la clave de forma segura.');
      // Test first: an invalid key is never stored.
      const message = await market.testKey(a.provider, a.key.trim());
      try {
        secrets.set(a.provider, a.key);
      } catch (err) {
        if (err instanceof SecretError) throw new ValidationError(err.message);
        throw err;
      }
      scheduleQuotes(2_000);
      return { message, status: describe() };
    }),
  );
  handle('quotes:deleteKey', (a: { provider: QuoteProvider }) => {
    secrets.delete(a.provider);
    return describe();
  });
  handle('quotes:refresh', (a: { companyIds?: number[]; force?: boolean }) =>
    providerGuard('cotizaciones', async () => {
      const results = await runQuotes(a.companyIds, a.force ?? false);
      return {
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).map((r) => ({ companyId: r.companyId, error: r.error ?? 'Sin dato' })),
        eodhdLeft: market.quotaLeft(),
      };
    }),
  );
  handle('quotes:setSymbol', (a: { companyId: number; symbol: string | null }) => {
    research.setQuoteSymbol(a.companyId, a.symbol);
    refreshCompanies();
  });
  handle('fx:rates', (a: { force?: boolean } | undefined) =>
    providerGuard('el BCE', async () => {
      const r = await getFx(a?.force ?? false);
      return r ? { date: r.rates.date, perEur: r.rates.perEur, stale: r.stale, fetchedAt: r.fetchedAt } : null;
    }),
  );
}

// ---------------------------------------------------------------- SEC EDGAR

function createSecClient(): SecClient {
  // A dedicated, cookie-less network session: SEC traffic never mixes with browsing.
  const secSession = session.fromPartition('sec-data');
  secSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  return new SecClient({
    fetch: async (url, init) => {
      const res = await secSession.fetch(url, { headers: init.headers, signal: init.signal, credentials: 'omit' });
      // Redirects are only acceptable within the SEC (or the loopback test server).
      const finalHost = new URL(res.url || url).hostname;
      if (!(finalHost === 'sec.gov' || finalHost.endsWith('.sec.gov') || finalHost === '127.0.0.1')) throw new Error('Redirección fuera de sec.gov');
      return { status: res.status, headers: res.headers, text: () => res.text() };
    },
    cache: { get: (k) => store.cacheGet('sec', k), set: (k, b, t) => store.cacheSet('sec', k, b, t) },
    contact: () => settings.secContact,
    appVersion: app.getVersion(),
    // Test hook: only honoured for a loopback http URL (see resolveBaseUrls).
    baseOverride: process.env.IB_SEC_BASE_URL ?? null,
  });
}

function secGuard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof SecError || err instanceof ValidationError) throw new Error(err.message);
    logError('sec', err);
    throw new Error('No se pudieron procesar los datos de la SEC.');
  });
}

function registerSecIpc(): void {
  handle('sec:status', () => ({
    contactSet: isValidContact(settings.secContact),
    requestsMade: sec.requestsMade,
    lastError: sec.lastError,
    ...((s) => ({ cacheEntries: s.entries, cacheBytes: s.bytes }))(store.cacheStats('sec')),
  }));
  handle('sec:searchTicker', (a: { query: string }) =>
    secGuard(async () => searchTickers(parseTickerFile((await sec.tickers()).data), a.query, 8)),
  );
  handle('sec:link', (a: { companyId: number; cik: number }) =>
    secGuard(async () => {
      const info = parseSubmissions((await sec.submissions(a.cik)).data);
      if (!info) throw new ValidationError('Respuesta de la SEC no reconocida.');
      const c = research.linkSec(a.companyId, info);
      refreshCompanies();
      return c;
    }),
  );
  handle('sec:sync', (a: { companyId: number; force?: boolean }) =>
    secGuard(async () => {
      const company = companiesCache.find((c) => c.id === a.companyId);
      if (!company?.cik) throw new ValidationError('Vincula primero la empresa con su registro en la SEC.');
      const facts = await sec.companyFacts(company.cik, a.force);
      const subs = await sec.submissions(company.cik, a.force);
      const info = parseSubmissions(subs.data);
      if (info) research.saveFilings(company.id, info);
      const raw = facts.data as CompanyFacts;
      if (!raw || typeof raw !== 'object' || !('facts' in raw)) throw new ValidationError('Respuesta de la SEC no reconocida.');
      const norm = normalizeCompanyFacts(raw, 10);
      research.saveSecFacts(company.id, company.cik, norm, facts.fetchedAt);
      notesChanged(company.id);
      return {
        facts: norm.facts.length,
        periods: [...new Set(norm.facts.map((f) => f.period))],
        missing: norm.missing,
        restated: norm.facts.filter((f) => f.restatedFrom).length,
        taxonomy: norm.taxonomy,
        entityName: norm.entityName,
        fromCache: facts.fromCache,
        stale: facts.stale,
        fetchedAt: facts.fetchedAt,
      };
    }),
  );
  handle('sec:facts', (a: { companyId: number }) => research.listFacts(a.companyId));
  handle('sec:filings', (a: { companyId: number }) => research.listFilings(a.companyId));
  handle('sec:clearCache', () => store.cacheClear('sec'));
  handle('sec:insiders', (a: { companyId: number }) => research.listInsiders(a.companyId));
  handle('sec:insidersSync', (a: { companyId: number; limit?: number }) =>
    secGuard(async () => {
      const company = companiesCache.find((c) => c.id === a.companyId);
      if (!company?.cik) throw new ValidationError('Vincula primero la empresa con su registro en la SEC.');
      // Refresh the filings list so new Form 4s are known (cached for 6 h).
      const info = parseSubmissions((await sec.submissions(company.cik)).data);
      if (info) research.saveFilings(company.id, info);
      let parsed = 0;
      let transactions = 0;
      let errors = 0;
      for (const f of research.pendingForm4(company.id, a.limit ?? 30)) {
        const file = rawForm4File(f.primaryDocument);
        if (!file) {
          research.markForm4(company.id, f.accn, 'error', 'Documento XML no identificado');
          errors++;
          continue;
        }
        let xml: string;
        try {
          xml = (await sec.archiveText(company.cik, f.accn, file)).data;
        } catch (err) {
          // Network or rate limit: stop here; what was parsed is kept and the rest stays pending.
          if (parsed === 0 && errors === 0) throw err;
          break;
        }
        try {
          transactions += research.saveForm4(company.id, f.accn, f.filingDate, f.url, parseForm4(xml));
          parsed++;
        } catch (err) {
          research.markForm4(company.id, f.accn, 'error', err instanceof Error ? err.message : 'No se pudo leer');
          errors++;
        }
      }
      const counts = research.countForm4(company.id);
      send('notesChanged', { companyId: company.id });
      return { parsed, transactions, errors, remaining: counts.pending, available: counts.available };
    }),
  );
}
