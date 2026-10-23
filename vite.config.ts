import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer (trusted browser UI) build. Main and preload are bundled by scripts/build-main.mjs.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true },
});
