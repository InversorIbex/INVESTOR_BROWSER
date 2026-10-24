import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { launch, newProfileDir } from './helpers';
import { KEYS, startMockMarket } from './mockMarket';

test('Cotizaciones: claves cifradas, retraso visible, cupo diario respetado y divisa convertida', async () => {
  const mock = await startMockMarket();
  const profile = newProfileDir();
  const { app, ui } = await launch(profile, { IB_MARKET_BASE_URL: mock.base, IB_TEST_ALLOW_WEAK_SECRETS: '1' });
  try {
    const aapl = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Apple', ticker: 'AAPL', exchange: 'NASDAQ' }));
    const itx = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Inditex', ticker: 'ITX', exchange: 'BME' }));
    const san = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Santander', ticker: 'SAN', exchange: 'BME' }));

    // Keys: tested before saving; a wrong key is never stored
    await ui.evaluate(() => window.ib.invoke('tabs:navigate', { input: 'ib://settings' }));
    const fh = ui.getByTestId('key-finnhub');
    await fh.getByTestId('key-finnhub-input').fill('wrong_key_000000');
    await fh.getByTestId('key-finnhub-save').click();
    await expect(fh.getByTestId('key-finnhub-msg')).toContainText('rechazó');
    await expect(fh.getByTestId('key-finnhub-input')).toBeVisible();
    await fh.getByTestId('key-finnhub-input').fill(KEYS.finnhub);
    await fh.getByTestId('key-finnhub-save').click();
    await expect(fh.getByTestId('key-finnhub-msg')).toContainText('Clave válida');
    await expect(fh.getByTestId('key-finnhub-status')).toHaveText(/····3456$/);
    const eo = ui.getByTestId('key-eodhd');
    await eo.getByTestId('key-eodhd-input').fill(KEYS.eodhd);
    await eo.getByTestId('key-eodhd-save').click();
    await expect(eo.getByTestId('key-eodhd-msg')).toContainText('retrasado');
    await expect(ui.getByTestId('eodhd-used')).toContainText('Hoy: 1 de 20'); // the test call counts

    // Refresh: US via Finnhub (header), Spain via EODHD (one batch)
    const r = await ui.evaluate((ids) => window.ib.invoke('quotes:refresh', { companyIds: ids, force: true }), [aapl.id, itx.id, san.id]);
    expect(r.updated).toBe(3);
    const fhHits = mock.hits.filter((h) => h.path.startsWith('/api/v1/quote'));
    expect(fhHits.every((h) => !h.path.includes(KEYS.finnhub))).toBe(true);
    expect(mock.hits.filter((h) => h.path.startsWith('/api/real-time/') && h.path.includes('s=')).length).toBe(1);
    for (const h of mock.hits) expect(h.ua).not.toContain(KEYS.eodhd);

    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), itx.id);
    const card = ui.getByTestId('price-card');
    await expect(card).toHaveAttribute('data-kind', 'eodhd');
    await expect(card).toContainText('51,36');
    await expect(card).toContainText('retrasado ~15 min');
    await expect(card.getByTestId('price-sub')).toContainText('EODHD · dato de 23/10/26');
    await expect(card).not.toContainText(/tiempo real/i);

    // Price in USD, statements in EUR → converted with the ECB reference rate, and said so
    for (const [metric, period, value, scale] of [
      ['revenue', 'FY2024', 900, 'millions'],
      ['revenue', 'FY2025', 1000, 'millions'],
      ['net_income', 'FY2025', 100, 'millions'],
      ['diluted_shares', 'FY2025', 10, 'millions'],
    ] as const)
      await ui.evaluate((a) => window.ib.invoke('notes:add', { companyId: a.id, kind: 'figure', metric: a.metric, period: a.period, value: a.value, scale: a.scale, currency: 'EUR' }), { id: aapl.id, metric, period, value, scale });
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), aapl.id);
    await ui.locator('[data-testid="dossier-tabs"] [data-view="quality"]').click();
    await expect(ui.getByTestId('quality-view')).toContainText('Precio convertido de USD a EUR (BCE, 2026-10-23)');
    // PER = (231.4 / 1.0812) / (100 M / 10 M) = 21.4
    await expect(ui.getByTestId('quality-view')).toContainText('21,4×');

    // Quota: lower the limit to what is already used → nothing more is requested
    await ui.evaluate(() => window.ib.invoke('settings:update', { eodhdDailyLimit: 3 }));
    const before = mock.hits.length;
    const r2 = await ui.evaluate((ids) => window.ib.invoke('quotes:refresh', { companyIds: ids, force: true }), [itx.id, san.id]);
    expect(r2.updated).toBe(0);
    expect(r2.failed[0]!.error).toMatch(/Cupo diario/);
    expect(mock.hits.slice(before).filter((h) => h.path.startsWith('/api/real-time/'))).toHaveLength(0);

    // Keys are not stored in clear anywhere in the profile (scanned after closing: Windows locks open files)
    await app.close();
    const files = readdirSync(profile, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    for (const f of files) {
      const buf = readFileSync(path.join(f.parentPath, f.name));
      expect(buf.includes(KEYS.finnhub), f.name).toBe(false);
      expect(buf.includes(KEYS.eodhd), f.name).toBe(false);
    }
  } finally {
    await app.close().catch(() => undefined);
    mock.server.close();
  }
});
