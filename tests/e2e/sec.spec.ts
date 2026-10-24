import { test, expect } from '@playwright/test';
import { launch, newProfileDir, state, waitFor } from './helpers';
import { startMockSec } from './mockSec';
import pkg from '../../package.json' with { type: 'json' };

test('Fase 3: vincular con la SEC, importar cifras XBRL con procedencia y trabajar sin conexión', async () => {
  const mock = await startMockSec();
  const { app, ui } = await launch(newProfileDir(), { IB_SEC_BASE_URL: mock.base });
  try {
    const c = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Fixture Test', ticker: 'FXTC' }));
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), c.id);
    await expect(ui.getByTestId('sec-card')).toBeVisible();

    // 1. Consent first: without a declared contact nothing reaches the SEC.
    await expect(ui.getByTestId('sec-consent')).toBeVisible();
    const noContact = await ui.evaluate(() => window.ib.invoke('sec:searchTicker', { query: 'FXTC' }).then(() => 'ok', (e: Error) => e.message));
    expect(noContact).toContain('contacto');
    expect(mock.hits).toHaveLength(0);
    const badContact = await ui.evaluate(() => window.ib.invoke('settings:update', { secContact: 'solo-un-correo@x.com' }).then(() => 'ok', (e: Error) => e.message));
    expect(badContact).toContain('nombre');

    await ui.getByTestId('sec-contact').fill('Ana Pérez ana@example.com');
    await ui.getByTestId('sec-contact-save').click();

    // 2. Find the registrant by ticker and link it: this also imports the figures.
    await expect(ui.getByTestId('sec-query')).toHaveValue('FXTC');
    await ui.getByTestId('sec-search').click();
    await expect(ui.getByTestId('sec-result').first()).toContainText('FIXTURE TEST CORP');
    await ui.getByTestId('sec-result').first().click();
    await expect(ui.getByTestId('sec-synced')).not.toHaveText('Nunca');

    // Fair access: declared User-Agent on every request, ≤ 10 requests/second.
    expect(mock.hits.length).toBeGreaterThanOrEqual(3);
    for (const h of mock.hits) expect(h.ua).toBe(`InvestorBrowser/${pkg.version} Ana Perez ana@example.com`);
    const gaps = mock.hits.slice(1).map((h, i) => h.at - mock.hits[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);

    // 3. Figures in the dossier, with provenance
    const cell = (metric: string, period: string) => ui.locator(`[data-testid="figures-table"] td[data-metric="${metric}"][data-period="${period}"]`);
    await expect(cell('revenue', 'FY2025')).toHaveText(/1180/);
    await expect(cell('revenue', 'FY2025')).toHaveAttribute('data-provider', 'sec');
    await expect(cell('revenue', 'FY2025')).toHaveAttribute('title', /us-gaap:Revenues[\s\S]*0001999999-25-000015/);
    // The restatement is visible, with the original value
    await expect(cell('revenue', 'FY2024')).toHaveClass(/is-restated/);
    await expect(cell('revenue', 'FY2024')).toHaveAttribute('title', /Re-expresado[\s\S]*1\.000\.000\.000/);
    // Quarterly data did not leak in; FCF derived with its formula; debt from components
    await expect(ui.locator('[data-testid="figures-table"] thead th')).toHaveText(['', 'FY2023', 'FY2024', 'FY2025']);
    await expect(cell('fcf', 'FY2025')).toHaveText(/^280/);
    await expect(cell('fcf', 'FY2025')).toHaveClass(/cell-calculated/);
    await expect(cell('gross_debt', 'FY2025')).toHaveAttribute('title', /Suma de componentes/);
    await expect(cell('gross_debt', 'FY2023')).toHaveText('—'); // no data → dash, never 0

    // 4. Filings list opens documents in tabs linked to the company
    await expect(ui.getByTestId('filing-row').first()).toContainText('10-K');
    await ui.getByTestId('filing-row').first().click();
    const s = await waitFor(() => state(ui), (x) => x.tabs.some((t) => (t.error?.url ?? t.url).includes('/Archives/edgar/data/1999999/000199999925000015/fxtc-20250630.htm')));
    expect(s.tabs.find((t) => (t.error?.url ?? t.url).includes('fxtc-20250630'))!.companyId).toBe(c.id);

    // 5. Valuation lab uses SEC figures and says so
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://valuation/${id}` }), c.id);
    await ui.getByTestId('load-figures').click();
    await expect(ui.getByTestId('val-fcf')).toHaveValue('280');
    await expect(ui.getByTestId('val-netIncome')).toHaveValue('262');
    await expect(ui.locator('.val-field').filter({ hasText: 'Beneficio neto' })).toContainText('FY2025 · SEC');

    // 6. Cache: a normal refresh inside the TTL makes no new requests
    const before = mock.hits.length;
    await ui.evaluate((id) => window.ib.invoke('sec:sync', { companyId: id }), c.id);
    expect(mock.hits.length).toBe(before);
    const status = await ui.evaluate(() => window.ib.invoke('sec:status'));
    expect(status).toMatchObject({ contactSet: true, cacheEntries: 3 });

    // 7. Offline: a forced refresh falls back to the dated cached copy
    await new Promise<void>((r) => mock.server.close(() => r()));
    mock.server.closeAllConnections?.();
    const offline = await ui.evaluate((id) => window.ib.invoke('sec:sync', { companyId: id, force: true }), c.id);
    expect(offline).toMatchObject({ stale: true, fromCache: true });
    expect(offline.facts).toBeGreaterThan(20);
  } finally {
    await app.close();
    mock.server.close();
  }
});
