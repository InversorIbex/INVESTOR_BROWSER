import { test, expect } from '@playwright/test';
import { launch, newProfileDir } from './helpers';
import { KEYS, startMockMarket } from './mockMarket';

test('Calendario: resultados confirmados, dividendos confirmados y estimados, fechas propias', async () => {
  const mock = await startMockMarket();
  const { app, ui } = await launch(newProfileDir(), { IB_MARKET_BASE_URL: mock.base, IB_TEST_ALLOW_WEAK_SECRETS: '1' });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    await ui.evaluate((k) => window.ib.invoke('quotes:setKey', { provider: 'finnhub', key: k }), KEYS.finnhub);
    await ui.evaluate((k) => window.ib.invoke('quotes:setKey', { provider: 'eodhd', key: k }), KEYS.eodhd);
    const aapl = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Apple', ticker: 'AAPL', exchange: 'NASDAQ' }));
    const itx = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Inditex', ticker: 'ITX', exchange: 'BME' }));
    for (const id of [aapl.id, itx.id]) await ui.evaluate((i) => window.ib.invoke('portfolio:add', { companyId: i }), id);

    await ui.getByTestId('open-calendar').click();
    await expect(ui.getByTestId('calendar-page')).toBeVisible();
    // Nothing fetched until asked
    expect(mock.hits.filter((h) => h.path.startsWith('/api/div/') || h.path.startsWith('/api/v1/calendar'))).toHaveLength(0);
    await ui.getByTestId('cal-refresh').click();
    const items = ui.getByTestId('cal-item');
    await expect(items.filter({ hasText: 'Resultados' }).first()).toBeVisible();

    // AAPL earnings: confirmed by Finnhub with the hour; MSFT (not ours) ignored
    const earn = items.filter({ hasText: 'Resultados' });
    await expect(earn).toHaveCount(1);
    await expect(earn).toHaveAttribute('data-status', 'confirmed');
    await expect(earn).toContainText('tras el cierre');
    // ITX: next ex-dividend confirmed, later ones estimated and labelled as such
    const exdiv = items.filter({ hasText: 'Ex-dividendo' });
    await expect(exdiv.first()).toHaveAttribute('data-status', 'confirmed');
    await expect(exdiv.first()).toContainText('0,77 EUR');
    // The next ex-dividend after that (~3 months later) is projected: hollow dot in that month's grid
    for (let i = 0; i < 4 && !(await ui.locator('[data-testid="cal-month"] .ev-dot.ev-div.is-est').count()); i++) await ui.getByLabel('Mes siguiente').click();
    await expect(ui.locator('[data-testid="cal-month"] .ev-dot.ev-div.is-est').first()).toBeVisible();
    await ui.locator('[data-testid="cal-month"] .cal-day', { has: ui.locator('.ev-dot.ev-div.is-est') }).first().click();
    await expect(ui.locator('[data-testid="cal-item"][data-type="exdiv"][data-status="estimated"]')).toContainText('0,77 EUR');
    await ui.locator('[data-testid="cal-month"] .cal-day.is-sel').click();
    for (let i = 0; i < 4 && !(await ui.locator('.cal-day.is-today').count()); i++) await ui.getByLabel('Mes anterior').click();
    await expect(ui.getByTestId('cal-kpis')).toContainText('1 confirmados');
    // Dividend calls: one per company in scope (each is 1 of the daily quota), then cached
    const divCalls = mock.hits.filter((h) => h.path.startsWith('/api/div/')).length;
    expect(divCalls).toBe(2);
    await ui.getByTestId('cal-refresh').click();
    await expect(ui.getByTestId('cal-item').first()).toBeVisible();
    await expect.poll(() => mock.hits.filter((h) => h.path.startsWith('/api/div/')).length).toBe(2);

    // Hide estimates
    await ui.getByTestId('cal-hide-est').check();
    await expect(ui.locator('[data-testid="cal-item"][data-status="estimated"]')).toHaveCount(0);
    await ui.getByTestId('cal-hide-est').uncheck();

    // Own event
    const date = new Date(Date.now() + 12 * 86400e3).toISOString().slice(0, 10);
    await ui.getByTestId('cal-add-open').click();
    await ui.getByTestId('cal-add-company').selectOption(String(itx.id));
    await ui.getByTestId('cal-add-date').fill(date);
    await ui.getByTestId('cal-add-save').click();
    await expect(ui.locator('[data-testid="cal-item"][data-status="user"]')).toHaveCount(1);
  } finally {
    await app.close();
    mock.server.close();
  }
});
