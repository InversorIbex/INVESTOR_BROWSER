// Regenerates THIRD_PARTY_LICENSES.md for code shipped inside the app bundle.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Packages whose code is bundled into dist/ (renderer + main) or shipped as the runtime.
const BUNDLED = ['react', 'react-dom', 'scheduler', 'zod', 'lucide-react', 'electron'];
let out = '# Licencias de terceros\n\nCódigo de terceros incluido en la aplicación distribuida. Generado con `node scripts/third-party-licenses.mjs`.\n\n';
out += 'Chromium y sus dependencias se distribuyen con Electron; sus licencias completas están en `LICENSES.chromium.html` junto al ejecutable.\n\n';
for (const name of BUNDLED) {
  const dir = path.join('node_modules', name);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licFile = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  out += `## ${name} ${pkg.version} — ${pkg.license}\n\n`;
  if (pkg.homepage) out += `${pkg.homepage}\n\n`;
  if (licFile && existsSync(path.join(dir, licFile))) out += '```\n' + readFileSync(path.join(dir, licFile), 'utf8').trim() + '\n```\n\n';
}
writeFileSync('THIRD_PARTY_LICENSES.md', out);
console.log('THIRD_PARTY_LICENSES.md updated');
