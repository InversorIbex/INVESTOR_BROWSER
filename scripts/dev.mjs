// Development: Vite dev server for the UI + esbuild watch for main/preload + Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { existsSync } from 'node:fs';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';

const builder = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });
while (!existsSync('dist/main/index.cjs') || !existsSync('dist/preload/index.cjs')) await new Promise((r) => setTimeout(r, 150));

const electronPath = (await import('electron')).default;
const app = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on('exit', async (code) => {
  builder.kill();
  await server.close();
  process.exit(code ?? 0);
});
