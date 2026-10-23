import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { inPage, launch, nativeKey, newProfileDir, run, startFixtureServer, state, waitFor, webTabs } from './helpers';

let server: Server;
let base: string;

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
});
test.afterAll(() => server.close());

test('arranca con la página de nueva pestaña y el modelo de seguridad correcto', async () => {
  const { app, ui } = await launch(newProfileDir());
  try {
    await expect(ui.getByTestId('newtab-page')).toBeVisible();
    // The trusted UI has the narrow bridge but no Node.
    const ui_probe = await ui.evaluate(() => ({ ib: typeof window.ib, require: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process }));
    expect(ui_probe).toEqual({ ib: 'object', require: 'undefined', process: 'undefined' });

    // Invalid IPC payloads are rejected by schema validation in main.
    const err = await ui.evaluate(() => window.ib.invoke('tabs:navigate', { input: 42 } as never).then(() => 'accepted', (e: Error) => e.message));
    expect(err).toContain('Invalid payload');

    // The web preferences of the main window are hardened.
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      const p = (w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox };
    });
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  } finally {
    await app.close();
  }
});

test('navega por páginas reales, pestañas, atrás/adelante, buscar y errores', async () => {
  const { app, ui } = await launch(newProfileDir());
  try {
    // Address bar → real navigation
    const bar = ui.getByTestId('address-bar');
    await bar.click();
    await bar.fill(`${base}/one`);
    await bar.press('Enter');
    await waitFor(() => webTabs(app), (t) => t.some((x) => x.title === 'Página uno'));
    await expect(ui.locator('[data-testid="tab"][data-active="true"]')).toContainText('Página uno');
    await expect(ui.getByTestId('security-indicator')).toHaveAttribute('data-state', 'local'); // plain http to 127.0.0.1

    // Web content has no access to the bridge, require or process.
    const probe = await inPage<{ hasIb: string; hasRequire: string; hasProcess: string }>(app, '/one', 'window.__probe');
    expect(probe).toEqual({ hasIb: 'undefined', hasRequire: 'undefined', hasProcess: 'undefined' });

    // Link navigation + back/forward
    await inPage(app, '/one', "document.getElementById('to-two').click()");
    await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página dos' && t.canGoBack));
    await ui.getByTestId('nav-back').click();
    await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página uno' && t.canGoForward));
    await ui.getByTestId('nav-forward').click();
    await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página dos'));
    await ui.getByTestId('nav-back').click();
    await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página uno'));

    // target=_blank → new tab, not a new window
    await inPage(app, '/one', "document.getElementById('blank').click()");
    await waitFor(() => state(ui), (s) => s.tabs.length === 2 && s.tabs.some((t) => t.title === 'Página tres'));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // file:// links are never followed from a web page
    await inPage(app, '/one', "document.getElementById('file').click()");
    await new Promise((r) => setTimeout(r, 500));
    expect((await webTabs(app)).every((t) => t.url.startsWith('http'))).toBe(true);
    expect((await state(ui)).tabs.some((t) => t.url.startsWith('file:'))).toBe(false);

    // Switch / close tabs
    let s = await state(ui);
    const one = s.tabs.find((t) => t.title === 'Página uno')!;
    await ui.evaluate((id) => window.ib.invoke('tabs:activate', { id }), one.id);
    await expect(ui.locator('[data-testid="tab"][data-active="true"]')).toContainText('Página uno');

    // Find in page — Ctrl+F pressed while the focus is inside the web page
    await nativeKey(app, { url: '/one' }, 'F', ['control']);
    await expect(ui.getByTestId('findbar')).toBeVisible();
    await ui.getByTestId('find-input').fill('free cash flow');
    await expect(ui.getByTestId('find-count')).toHaveText(/\d+\/3/);
    await ui.getByTestId('find-input').press('Escape');
    await expect(ui.getByTestId('findbar')).toBeHidden();

    // Keyboard shortcuts, delivered as native input to the UI
    await nativeKey(app, 'ui', 'T', ['control']);
    await waitFor(() => state(ui), (x) => x.tabs.length === 3);
    await expect(ui.getByTestId('newtab-page')).toBeVisible();
    await nativeKey(app, 'ui', 'W', ['control']);
    await waitFor(() => state(ui), (x) => x.tabs.length === 2);
    // Close a real web page tab, then bring it back with Ctrl+Shift+T
    await nativeKey(app, 'ui', 'W', ['control']);
    const afterClose = await waitFor(() => state(ui), (x) => x.tabs.length === 1 && x.closedCount === 1);
    const closedTitle = ['Página uno', 'Página tres'].find((t) => !afterClose.tabs.some((x) => x.title === t))!;
    await nativeKey(app, 'ui', 'T', ['control', 'shift']);
    await waitFor(() => state(ui), (x) => x.tabs.length === 2 && x.tabs.some((t) => t.title === closedTitle));
    // Ctrl+1 jumps to the first tab
    await nativeKey(app, 'ui', '1', ['control']);
    await waitFor(() => state(ui), (x) => x.activeTabId === x.tabs[0]!.id);

    // Network error → our error page, with retry
    await bar.click();
    await bar.fill('http://127.0.0.1:9/nothing-here');
    await bar.press('Enter');
    await expect(ui.getByTestId('error-page')).toBeVisible({ timeout: 15_000 });
    await expect(ui.getByTestId('error-page')).toHaveAttribute('data-kind', 'network');

    // Typing a javascript: URL searches instead of executing
    await bar.click();
    await bar.fill('javascript:alert(1)');
    await bar.press('Enter');
    s = await waitFor(() => state(ui), (x) => x.tabs.some((t) => t.url.includes('duckduckgo.com') || t.error?.url.includes('duckduckgo.com') === true));
    expect(s.tabs.some((t) => t.url.startsWith('javascript:'))).toBe(false);

    // History recorded the visits
    const history = await ui.evaluate(() => window.ib.invoke('history:list', {}));
    expect(history.some((h) => h.title === 'Página uno')).toBe(true);
    expect(history.some((h) => h.title === 'Página dos')).toBe(true);
  } finally {
    await app.close();
  }
});

test('favoritos, ajustes y sesión persisten al reiniciar', async () => {
  const profile = newProfileDir();
  {
    const { app, ui } = await launch(profile);
    try {
      await ui.evaluate((u) => window.ib.invoke('tabs:navigate', { input: u }), `${base}/one`);
      await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página uno'));
      await ui.getByTestId('bookmark-star').click();
      await waitFor(() => ui.evaluate(() => window.ib.invoke('bookmarks:list')), (b) => b.length === 1);

      await ui.evaluate((u) => window.ib.invoke('tabs:create', { url: u }), `${base}/two`);
      await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página dos'));
      const s = await state(ui);
      await ui.evaluate((id) => window.ib.invoke('tabs:pin', { id, pinned: true }), s.tabs.find((t) => t.title === 'Página dos')!.id);

      // Settings UI
      await run(ui, 'open.settings');
      await expect(ui.getByTestId('settings-page')).toBeVisible();
      await ui.getByTestId('theme').locator('[data-value="light"]').click();
      await expect(ui.locator('html')).toHaveAttribute('data-theme', 'light');
      await ui.getByTestId('tab-layout').locator('[data-value="horizontal"]').click();
      await expect(ui.getByTestId('tabstrip')).toBeVisible();
    } finally {
      await app.close();
    }
  }
  {
    const { app, ui } = await launch(profile);
    try {
      const s = await waitFor(() => state(ui), (x) => x.tabs.length === 3);
      expect(s.tabs[0]!.pinned).toBe(true); // pinned first
      // Pinned tab first; Settings opened next to the active (pinned) tab; order preserved.
      expect(s.tabs.map((t) => t.url)).toEqual([`${base}/two`, 'ib://settings', `${base}/one`]);
      // Lazy restore: only the active tab's page is loaded at startup.
      expect((await webTabs(app)).length).toBeLessThanOrEqual(1);
      await expect(ui.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(ui.getByTestId('tabstrip')).toBeVisible();
      const bms = await ui.evaluate(() => window.ib.invoke('bookmarks:list'));
      expect(bms.map((b) => b.title)).toEqual(['Página uno']);
      // Restored background tabs load lazily: only the active tab has a live page.
      await run(ui, 'open.bookmarks');
      await expect(ui.getByTestId('bookmark-row')).toHaveCount(1);
    } finally {
      await app.close();
    }
  }
});

test('descargas: se guardan sin sobrescribir y aparecen en la lista', async () => {
  const profile = newProfileDir();
  const { app, ui } = await launch(profile);
  try {
    await ui.evaluate((u) => window.ib.invoke('tabs:navigate', { input: u }), `${base}/one`);
    await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página uno'));
    for (let i = 0; i < 2; i++) {
      await inPage(app, '/one', `location.href = '${base}/report.pdf?n=${i}'`);
      await waitFor(
        () => ui.evaluate(() => window.ib.invoke('downloads:list')),
        (d) => d.filter((x) => x.status === 'completed').length === i + 1,
        15_000,
      );
    }
    const files = readdirSync(path.join(profile, 'Downloads')).sort();
    expect(files).toEqual(['annual-report (1).pdf', 'annual-report.pdf']);
    expect(existsSync(path.join(profile, 'Downloads', 'annual-report.pdf'))).toBe(true);
    await run(ui, 'open.downloads');
    await expect(ui.getByTestId('download-row')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('paleta de comandos: abre, filtra y ejecuta', async () => {
  const { app, ui } = await launch(newProfileDir());
  try {
    await nativeKey(app, 'ui', 'K', ['control']);
    await expect(ui.getByTestId('palette')).toBeVisible();
    await ui.getByTestId('palette-input').fill('historial');
    await expect(ui.getByTestId('palette-item').first()).toContainText('Historial');
    await ui.getByTestId('palette-input').press('Enter');
    await expect(ui.getByTestId('history-page')).toBeVisible();
    await expect(ui.getByTestId('palette')).toBeHidden();
  } finally {
    await app.close();
  }
});
