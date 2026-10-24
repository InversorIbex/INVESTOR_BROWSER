// Smoke test for the PACKAGED app (after electron-builder), with the Electron fuses applied.
// Playwright's _electron launcher needs Node's --inspect, which the fuses disable on purpose,
// so we start the executable ourselves and attach through Chromium's DevTools port instead.
//
// Checks: the UI loads from app.asar (asar integrity OK on Windows), the preload bridge exists,
// and ELECTRON_RUN_AS_NODE / NODE_OPTIONS are ignored (fuses really applied).
//
// Usage: node scripts/smoke-packaged.mjs <path-to-executable>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const exe = process.argv[2];
if (!exe) {
  console.error('Uso: node scripts/smoke-packaged.mjs <ejecutable>');
  process.exit(2);
}
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'ib-smoke-'));
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    // If the fuses were missing, these would turn the app into plain Node or crash it.
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--require ./this-file-does-not-exist.js',
  },
});
let exited = null;
child.on('exit', (code) => (exited = code));
child.stderr.on('data', (d) => process.stderr.write(d));

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  try { child.kill(); } catch {}
  process.exit(1);
};

let browser;
for (let i = 0; i < 60 && !browser; i++) {
  if (exited !== null) fail(`La app se cerró al arrancar (código ${exited}).`);
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
}
if (!browser) fail('No se pudo conectar con la app empaquetada.');

let ui;
for (let i = 0; i < 40 && !ui; i++) {
  ui = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('app.asar') && p.url().endsWith('index.html'));
  if (!ui) await new Promise((r) => setTimeout(r, 250));
}
if (!ui) fail('La interfaz no se cargó desde app.asar.');
await ui.waitForSelector('[data-testid]', { timeout: 15000 }).catch(() => fail('La interfaz no llegó a pintarse.'));
const bridge = await ui.evaluate(() => typeof window.ib?.invoke);
if (bridge !== 'function') fail('El puente window.ib no existe.');
const settings = await ui.evaluate(() => window.ib.invoke('settings:get'));
if (!settings || typeof settings !== 'object') fail('El proceso main no responde por IPC.');

console.log('✓ App empaquetada: UI cargada desde app.asar, IPC operativo, ELECTRON_RUN_AS_NODE y NODE_OPTIONS ignorados.');
await browser.close().catch(() => {});
child.kill();
await new Promise((r) => setTimeout(r, 1000));
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
