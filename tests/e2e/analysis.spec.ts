import { test, expect } from '@playwright/test';
import { launch, newProfileDir, state, waitFor } from './helpers';
import { startMockSec } from './mockSec';

test('Fase 4: calidad, forense, insiders (Form 4) y comparación de empresas', async () => {
  const mock = await startMockSec();
  const { app, ui } = await launch(newProfileDir(), { IB_SEC_BASE_URL: mock.base });
  try {
    await ui.evaluate(() => window.ib.invoke('settings:update', { secContact: 'Ana Pérez ana@example.com' }));
    const c = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Fixture Test', ticker: 'FXTC' }));
    await ui.evaluate((id) => window.ib.invoke('sec:link', { companyId: id, cik: 1999999 }), c.id);
    await ui.evaluate((id) => window.ib.invoke('sec:sync', { companyId: id }), c.id);
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), c.id);
    await expect(ui.getByTestId('dossier-tabs')).toBeVisible();

    // Detail metrics are collapsed by default and can be shown
    await expect(ui.locator('td[data-metric="receivables"]')).toHaveCount(0);
    await ui.getByTestId('toggle-detail').click();
    await expect(ui.locator('td[data-metric="receivables"][data-period="FY2025"]')).toHaveText(/^210/);

    // ---- Quality: decomposable, no opaque score
    await ui.locator('[data-testid="dossier-tabs"] [data-view="quality"]').click();
    await expect(ui.getByTestId('quality-view')).toBeVisible();
    await expect(ui.getByTestId('quality-summary')).toContainText('7 de 7 criterios fuertes');
    await expect(ui.locator('[data-testid="criterion"][data-id="growth"]')).toHaveAttribute('data-verdict', 'strong');
    await expect(ui.locator('[data-testid="criterion"][data-id="growth"]')).toContainText('14,5 %');
    await ui.locator('[data-testid="criterion"][data-id="growth"] .crit-toggle').click();
    await expect(ui.locator('[data-testid="criterion"][data-id="growth"] .crit-detail')).toContainText('FY2023 · Ingresos: 900 M');
    await expect(ui.getByTestId('roic-table')).toContainText('31,4 %');

    // ---- Forensics: explains itself, never accuses
    await ui.locator('[data-testid="dossier-tabs"] [data-view="forensics"]').click();
    await expect(ui.getByTestId('forensics-summary')).toContainText('2 señal(es) a revisar');
    const rec = ui.locator('[data-testid="signal"][data-id="receivables"]');
    await expect(rec).toHaveAttribute('data-status', 'triggered');
    await expect(rec).toContainText('Limitación');
    await expect(ui.locator('[data-testid="signal"][data-id="restatements"]')).toHaveAttribute('data-status', 'triggered');
    await expect(ui.getByTestId('forensics-view')).toContainText('No es una acusación de fraude');

    // ---- Insiders: Form 4 parsed from the SEC archive
    await ui.locator('[data-testid="dossier-tabs"] [data-view="insiders"]').click();
    const before = mock.hits.length;
    await ui.getByTestId('insiders-sync').click();
    await expect(ui.getByTestId('insider-summary')).toBeVisible();
    await expect(ui.getByTestId('insiders-progress')).toContainText('3 Form 4');
    await expect(ui.getByTestId('insiders-progress')).toContainText('todos procesados');
    const docHits = mock.hits.slice(before).filter((h) => h.path.startsWith('/Archives/'));
    expect(docHits.map((h) => h.path).sort()).toEqual([
      '/Archives/edgar/data/1999999/000199999925000018/wk-form4.xml',
      '/Archives/edgar/data/1999999/000199999925000021/form4-roe.xml',
      '/Archives/edgar/data/1999999/000199999925000022/doc4.xml',
    ]);
    for (const h of docHits) expect(h.ua).toContain('ana@example.com');

    // Default view: only market buys/sells; 10b5-1 sales are labelled
    const rows = ui.getByTestId('insider-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Roe Richard & Family Trust' })).toContainText('Compra');
    await expect(rows.filter({ hasText: 'Roe Richard & Family Trust' }).locator('td').nth(2)).toHaveAttribute('title', /P: Compra en mercado/);
    // Summary window: fixture filings are from 2025, so "Todo lo cargado" shows them
    await ui.locator('[data-testid="insider-period"] [data-months="1200"]').click();
    await expect(ui.getByTestId('insider-summary')).toContainText('1 insider(s) · 88.000 USD');
    await expect(rows.filter({ hasText: 'Doe Jane' }).locator('.plan-badge')).toHaveText('10b5-1');
    await expect(rows.filter({ hasText: 'Poe Alex' }).locator('.plan-badge')).toHaveText('10b5-1');
    await ui.getByTestId('insiders-all').check();
    await expect(rows).toHaveCount(7); // + grant, tax withholding, exercise, derivative
    // Second sync: nothing new to download (documents are immutable and cached)
    const before2 = mock.hits.length;
    await ui.getByTestId('insiders-sync').click();
    await expect(ui.getByTestId('insiders-progress')).toContainText('todos procesados');
    expect(mock.hits.slice(before2).filter((h) => h.path.startsWith('/Archives/'))).toHaveLength(0);

    // ---- Compare: SEC data vs notebook data, with honest gaps
    const other = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Demo Manual (ficticia)', ticker: 'DMO', exchange: 'BME' }));
    for (const [metric, period, value] of [
      ['revenue', 'FY2024', 500],
      ['operating_income', 'FY2024', 40],
      ['net_income', 'FY2024', 25],
    ] as const)
      await ui.evaluate((a) => window.ib.invoke('notes:add', { companyId: a.id, kind: 'figure', metric: a.metric, period: a.period, value: a.value, scale: 'millions', currency: 'EUR' }), {
        id: other.id,
        metric,
        period,
        value,
      });
    await ui.evaluate(() => window.ib.invoke('command:run', { id: 'open.compare' }));
    await expect(ui.getByTestId('compare-page')).toBeVisible();
    const table = ui.getByTestId('compare-table');
    await expect(table.locator('thead')).toContainText('FXTC');
    await expect(table.locator('thead')).toContainText('DMO');
    await expect(ui.getByTestId('compare-warning')).toContainText('Los últimos ejercicios no coinciden');
    await expect(ui.getByTestId('compare-warning')).toContainText('FY2024');
    await expect(ui.getByTestId('compare-warning')).toContainText('FY2025');
    await expect(ui.getByTestId('compare-warning')).toContainText('Monedas distintas (EUR, USD)');
    // Locate columns by ticker, not by position
    const heads = await table.locator('thead th').allTextContents();
    const col = (ticker: string) => heads.findIndex((h) => h.includes(ticker)) - 1; // first th is the row label
    const fx = col('FXTC');
    const dm = col('DMO');
    expect(fx).toBeGreaterThanOrEqual(0);
    expect(dm).toBeGreaterThanOrEqual(0);
    const opRow = table.locator('tr[data-row="margin_operating_income"] td');
    await expect(opRow.nth(fx)).toHaveText('29,7 %');
    await expect(opRow.nth(dm)).toHaveText('8,0 %');
    await expect(opRow.nth(fx)).toHaveClass(/is-best/);
    await expect(table.locator('tr[data-row="roic"] td').nth(dm)).toHaveText('Pendiente'); // never estimated
    await expect(table.locator('tr[data-row="fcf_yield"] td').nth(fx)).toHaveText('Sin precio');
    // Same forensic result as the dossier (includes the restatement); one period only → pending, not "0"
    await expect(table.locator('tr[data-row="forensics"] td').nth(fx)).toHaveText('2');
    await expect(table.locator('tr[data-row="forensics"] td').nth(dm)).toHaveText('Pendiente');
    const s = await state(ui);
    expect(s.tabs.some((t) => t.url === 'ib://compare')).toBe(true);

    // Crash Replay is shown as pending, not faked
    await ui.evaluate(() => window.ib.invoke('command:run', { id: 'open.research' }));
    await expect(ui.getByTestId('tools-strip')).toContainText('Crash Replay');
    await expect(ui.getByTestId('tools-strip')).toContainText('Pendiente');
    await waitFor(() => state(ui), (x) => x.tabs.length >= 1);
  } finally {
    await app.close();
    mock.server.close();
  }
});
