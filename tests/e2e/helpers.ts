import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Local fixture site so navigation tests never depend on the Internet. */
export function startFixtureServer(): Promise<{ server: Server; base: string }> {
  const pages: Record<string, string> = {
    '/one': `<!doctype html><title>Página uno</title><body>
      <h1>Free cash flow</h1><p>Free cash flow grew. Free cash flow yield matters.</p>
      <a id="to-two" href="/two">dos</a>
      <a id="blank" href="/three" target="_blank">tres en pestaña nueva</a>
      <a id="file" href="file:///etc/passwd">file</a>
      <a id="js" href="javascript:document.title='HACKED'">js</a>
      <button id="popup" onclick="window.open('/two','pop','width=400,height=300')">popup</button>
      <script>window.__probe = { hasIb: typeof window.ib, hasRequire: typeof require, hasProcess: typeof process };</script>
    </body>`,
    '/two': '<!doctype html><title>Página dos</title><body>segunda</body>',
    '/three': '<!doctype html><title>Página tres</title><body>tercera</body>',
  };
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/report.pdf')) {
      const body = Buffer.alloc(64 * 1024, 65);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="annual-report.pdf"',
        'Content-Length': body.length,
      });
      res.end(body);
      return;
    }
    const html = pages[url];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html ?? '<title>404</title>not found');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    }),
  );
}

export function newProfileDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'ib-e2e-'));
}

export async function launch(profile: string): Promise<{ app: ElectronApplication; ui: Page }> {
  const downloads = path.join(profile, 'Downloads');
  const env = { ...process.env, IB_USER_DATA: profile, IB_DOWNLOADS_DIR: downloads } as Record<string, string>;
  delete env.NODE_OPTIONS;
  const app = await electron.launch({ args: [path.resolve('.')], env });
  const ui = await waitForUi(app);
  await ui.waitForSelector('[data-testid="topbar"]');
  return { app, ui };
}

async function waitForUi(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const page = app.windows().find((w) => w.url().includes('/renderer/index.html'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('UI window not found');
}

/** Info about every web-tab WebContents, read directly from the main process. */
export async function webTabs(app: ElectronApplication): Promise<{ id: number; url: string; title: string }[]> {
  return app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((wc) => /^https?:/.test(wc.getURL()))
      .map((wc) => ({ id: wc.id, url: wc.getURL(), title: wc.getTitle() })),
  );
}

/** Run a script inside a web page (as the page itself, no privileges). */
export async function inPage<T>(app: ElectronApplication, urlPart: string, script: string): Promise<T> {
  return app.evaluate(
    async ({ webContents }, { urlPart, script }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(urlPart));
      if (!wc) throw new Error('no webContents for ' + urlPart);
      return wc.executeJavaScript(script, true);
    },
    { urlPart, script },
  ) as Promise<T>;
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let last: T = await fn();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`waitFor timed out; last value: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
}

/**
 * Send a key as native input (the same path a physical keyboard uses), so
 * before-input-event shortcut handling is exercised for real. Playwright's own
 * keyboard API goes through CDP and bypasses that path.
 */
export async function nativeKey(app: ElectronApplication, target: 'ui' | { url: string }, keyCode: string, modifiers: string[] = []): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow, webContents }, { target, keyCode, modifiers }) => {
      const ui = BrowserWindow.getAllWindows()[0]!.webContents;
      const wc =
        target === 'ui'
          ? ui
          : webContents.getAllWebContents().find((w) => w !== ui && w.getURL().includes((target as { url: string }).url))!;
      wc.focus();
      const mods = modifiers as ('control' | 'shift' | 'alt' | 'meta')[];
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods });
    },
    { target, keyCode, modifiers },
  );
}

export const state =(ui: Page) => ui.evaluate(() => window.ib.invoke('state:get'));
export const run = (ui: Page, id: string) => ui.evaluate((id) => window.ib.invoke('command:run', { id: id as never }), id);
