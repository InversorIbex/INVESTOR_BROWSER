import { test, expect } from '@playwright/test';
import { launch, newProfileDir } from './helpers';
import { startMockMarket } from './mockMarket';

test('Cartera: FIFO con comisiones, efecto divisa, ventas, foto diaria y seguimiento', async () => {
  const mock = await startMockMarket(); // only the ECB rates are used here
  const { app, ui } = await launch(newProfileDir(), { IB_MARKET_BASE_URL: mock.base });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    await ui.getByTestId('open-portfolio').click();
    await expect(ui.getByTestId('portfolio-page')).toBeVisible();

    // New company + opening position from the form (EUR)
    const add = ui.getByTestId('pf-add-hold');
    if (!(await add.evaluate((d) => (d as HTMLDetailsElement).open))) await add.locator('summary').click();
    await add.getByTestId('add-company').selectOption('new');
    await add.getByTestId('add-name').fill('Inditex');
    await add.getByTestId('add-ticker').fill('ITX');
    await add.getByTestId('add-exchange').selectOption('BME');
    await add.getByTestId('add-qty').fill('40');
    await add.getByTestId('add-avg').fill('24,10');
    await add.getByTestId('add-save').click();
    await expect(ui.getByTestId('pf-row')).toHaveCount(1);

    // US position with its cost in EUR (fixes the purchase exchange rate: 1500 USD / 1300 €)
    await add.getByTestId('add-company').selectOption('new');
    await add.getByTestId('add-name').fill('Apple');
    await add.getByTestId('add-ticker').fill('AAPL');
    await add.getByTestId('add-exchange').selectOption('NASDAQ');
    await add.getByTestId('add-qty').fill('10');
    await add.getByTestId('add-avg').fill('150');
    await add.getByTestId('add-cost-eur').fill('1300');
    await add.getByTestId('add-save').click();
    await expect(ui.getByTestId('pf-row')).toHaveCount(2);

    // Prices (manual here; the quotes test covers providers)
    const list = await ui.evaluate(() => window.ib.invoke('companies:list'));
    const id = (t: string) => list.find((c) => c.ticker === t)!.id;
    await ui.evaluate((i) => window.ib.invoke('companies:setPrice', { id: i, price: 30, currency: 'EUR', asOf: '2026-10-23', source: 'test' }), id('ITX'));
    await ui.evaluate((i) => window.ib.invoke('companies:setPrice', { id: i, price: 200, currency: 'USD', asOf: '2026-10-23', source: 'test' }), id('AAPL'));

    // ITX: 40 × 30 = 1200 €. AAPL: 2000 USD / 1.0812 = 1849.80 €. Total 3049.80 €
    await expect(ui.getByTestId('pf-total')).toHaveText(/3\.?050 €/);
    const aapl = ui.locator('[data-testid="pf-row"][data-ticker="AAPL"]');
    await expect(aapl.getByTestId('pf-value')).toHaveText(/1\.?850 €/);
    // P&L AAPL: 1849.80 − 1300 = +549.80; price effect 500/1.0812 = 462.45; fx effect +87.35
    await expect(aapl).toContainText('+550 €');
    await expect(aapl).toContainText('+87 €');

    // Sell 10 ITX at 35 with 2 € fee → realised 10·35 − 2 − 10·24.10 = +107 €
    await ui.locator('[data-testid="pf-row"][data-ticker="ITX"]').click();
    const form = ui.getByTestId('pf-opform').first();
    await form.getByRole('button', { name: 'Venta', exact: true }).click();
    await form.getByTestId('op-qty').fill('10');
    await form.getByTestId('op-price').fill('35');
    await form.getByTestId('op-fee').fill('2');
    await expect(form).toContainText('Cobras 348,00 €');
    await form.getByTestId('op-save').click();
    await expect(ui.getByTestId('pf-realized')).toHaveText('+107 €');
    await expect(ui.getByTestId('pf-op')).toHaveCount(2);
    // Overselling is refused before reaching the database
    await form.getByRole('button', { name: 'Venta', exact: true }).click();
    await form.getByTestId('op-qty').fill('31');
    await form.getByTestId('op-save').click();
    await expect(form).toContainText('Solo tienes 30 acciones');

    // A daily snapshot exists once every position has a price
    await expect(ui.getByTestId('pf-chart')).toContainText('Primera foto');
    const pf = await ui.evaluate(() => window.ib.invoke('portfolio:get'));
    expect(pf.snapshots).toHaveLength(1);

    // Watchlist: distance to the target price
    await ui.getByTestId('pf-tab-watch').click();
    const w = ui.getByTestId('pf-add-watch');
    await w.locator('summary').click();
    await w.getByTestId('add-company').selectOption('new');
    await w.getByTestId('add-name').fill('Santander');
    await w.getByTestId('add-ticker').fill('SAN');
    await w.getByTestId('add-exchange').selectOption('BME');
    await w.getByTestId('add-target').fill('5');
    await w.getByTestId('add-save').click();
    const san = (await ui.evaluate(() => window.ib.invoke('companies:list'))).find((c) => c.ticker === 'SAN')!.id;
    await ui.evaluate((i) => window.ib.invoke('companies:setPrice', { id: i, price: 5.5, currency: 'EUR', asOf: '2026-10-23', source: 'test' }), san);
    await expect(ui.getByTestId('watch-dist')).toHaveText('+10,0 %');
    await ui.getByTestId('watch-target').fill('6');
    await ui.getByTestId('watch-target').press('Enter');
    await expect(ui.getByTestId('watch-dist')).toHaveText('en precio');
  } finally {
    await app.close();
    mock.server.close();
  }
});
