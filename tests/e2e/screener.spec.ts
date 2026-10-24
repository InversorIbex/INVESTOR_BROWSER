import { test, expect } from '@playwright/test';
import { launch, newProfileDir } from './helpers';
import { startMockSec } from './mockSec';

test('Screener: métricas con procedencia, estrategias, filtros y mapa', async () => {
  const sec = await startMockSec();
  const { app, ui } = await launch(newProfileDir(), { IB_SEC_BASE_URL: sec.base });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    await ui.evaluate(() => window.ib.invoke('settings:update', { secContact: 'Ana Pérez ana@example.com' }));
    // FXTC: official SEC data, US listing → bulk sync links it by exact ticker
    const fx = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Fixture Test', ticker: 'FXTC', exchange: 'NASDAQ' }));
    await ui.evaluate((id) => window.ib.invoke('companies:setPrice', { id, price: 20, currency: 'USD', asOf: '2026-10-23', source: 'test' }), fx.id);
    // A notebook company without price: never passes price-based filters
    const dmo = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Demo Manual', ticker: 'DMO', exchange: 'BME' }));
    for (const [metric, period, value] of [
      ['revenue', 'FY2025', 500],
      ['operating_income', 'FY2025', 40],
      ['net_income', 'FY2025', 25],
    ] as const)
      await ui.evaluate((a) => window.ib.invoke('notes:add', { companyId: a.id, kind: 'figure', metric: a.metric, period: a.period, value: a.value, scale: 'millions', currency: 'EUR' }), { id: dmo.id, metric, period, value });

    await ui.getByTestId('open-screener').click();
    await expect(ui.getByTestId('screener-page')).toBeVisible();
    await ui.getByTestId('scr-sync').click();
    await expect(ui.getByTestId('scr-report')).toContainText('DMO: vincula su LEI');
    await expect(ui.getByTestId('scr-coverage')).toContainText('1 con cifras oficiales');

    const row = ui.locator('[data-testid="scr-row"][data-ticker="FXTC"]');
    await expect(row.locator('td[data-key="roic"]')).toHaveText('31,4 %');
    await expect(row.locator('td[data-key="roic"]')).toHaveAttribute('title', /NOPAT/);
    const dmoRow = ui.locator('[data-testid="scr-row"][data-ticker="DMO"]');
    await expect(dmoRow.locator('td[data-key="per"]')).toHaveText('—');
    await expect(dmoRow.locator('td[data-key="per"]')).toHaveAttribute('title', 'Sin precio');
    await expect(dmoRow.locator('td[data-key="op_margin"]')).toHaveText('8,0 %');

    // Strategy: only companies with the data pass
    await ui.locator('[data-testid="scr-presets"] [data-id="compounders"]').click();
    await expect(ui.getByTestId('scr-count')).toHaveText('1 de 2');
    await expect(ui.getByTestId('scr-row')).toHaveCount(1);
    await ui.locator('[data-testid="scr-presets"] [data-id="compounders"]').click();
    // Custom range (percent typed as %)
    await ui.getByTestId('scr-range-metric').selectOption('op_margin');
    await ui.getByTestId('scr-range-min').fill('10');
    await ui.getByTestId('scr-range-add').click();
    await expect(ui.getByTestId('scr-count')).toHaveText('1 de 2');
    await expect(ui.getByTestId('scr-row')).toHaveAttribute('data-ticker', 'FXTC');
    await ui.getByLabel('Quitar filtro').click();
    await expect(ui.getByTestId('scr-count')).toHaveText('2 de 2');
    // Scatter needs two companies with both values
    await expect(ui.getByTestId('screener-page')).toContainText('Hacen falta al menos dos empresas');
  } finally {
    await app.close();
    sec.server.close();
  }
});
