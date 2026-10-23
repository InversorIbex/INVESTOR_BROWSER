/**
 * Single source of truth for branding. Rename the product by editing this file
 * (and `productName` / `build.appId` in package.json for the installer).
 */
export const BRAND = {
  name: 'Investor Browser',
  shortName: 'Investor',
  tagline: 'Everything an investor needs to research a stock, without leaving the browser.',
  /** Accent colour used across the UI (CSS var --accent). */
  accent: '#5B8CFF',
  /** Scheme used for the browser's own internal pages (never served to web content). */
  internalScheme: 'ib',
  repoUrl: 'https://github.com/InversorIbex/INVESTOR_BROWSER',
} as const;
