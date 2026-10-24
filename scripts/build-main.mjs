// Bundles the main process and the preload with esbuild (CommonJS, Electron externals).
let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('\n  Faltan las dependencias del proyecto.\n  Ejecuta primero:  npm install\n  (y espera a que termine sin errores; descarga Electron, ~100 MB)\n');
  process.exit(1);
}
const { build, context } = esbuild;

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};
const targets = [
  { ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' },
  { ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs' },
];

if (watch) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
