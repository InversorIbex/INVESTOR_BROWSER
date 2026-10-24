import { test, expect } from '@playwright/test';
import { launch, newProfileDir } from './helpers';
import { startMockEsef } from './mockEsef';
import { FIXTURE_LEI } from '../fixtures/esef';

test('Europa: cuentas oficiales ESEF con procedencia, re-expresiones y avisos de cobertura', async () => {
  const mock = await startMockEsef();
  const { app, ui } = await launch(newProfileDir(), { IB_ESEF_BASE_URL: mock.base });
  try {
    const c = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Fixture Europa', ticker: 'FXE', exchange: 'BME' }));
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), c.id);
    // A Spanish company shows the European card first; nothing is requested before consent.
    const card = ui.getByTestId('esef-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('sec-consent')).toBeVisible();
    expect(mock.hits).toHaveLength(0);
    await card.getByTestId('sec-contact').fill('Ana Pérez ana@example.com');
    await card.getByTestId('sec-contact-save').click();

    await card.getByTestId('esef-query').fill('fixture europa');
    await card.getByTestId('esef-search').click();
    await expect(card.getByTestId('esef-result')).toHaveCount(1);
    await card.getByTestId('esef-result').click();
    await expect(card.getByTestId('esef-synced')).not.toHaveText('Nunca');
    for (const h of mock.hits) expect(h.ua).toContain('ana@example.com');
    // Only the latest version per year is downloaded (the superseded FY2025 "-0" is not)
    const reports = mock.hits.filter((h) => h.path.endsWith('.json') && !h.path.startsWith('/api/')).map((h) => h.path);
    expect(reports).toHaveLength(3);
    expect(reports.some((p) => p.includes('-2025-12-31-0-es'))).toBe(false);

    const rev = ui.locator('td[data-metric="revenue"][data-period="FY2025"]');
    await expect(rev).toHaveAttribute('data-provider', 'esef');
    await expect(rev).toHaveText(/^1\.?150/);
    await expect(rev).toHaveAttribute('title', /ESEF/);
    await expect(ui.locator('td[data-metric="revenue"][data-period="FY2024"]')).toHaveAttribute('title', /Re-expresado/);
    await expect(card.getByTestId('esef-filings').locator('li')).toHaveCount(3);
    const all = await ui.evaluate(() => window.ib.invoke('companies:list'));
    expect(all.find((x) => x.id === c.id)?.lei).toBe(FIXTURE_LEI);

    // Second sync: reports are immutable → no new downloads
    const before = mock.hits.length;
    await card.getByTestId('esef-sync').click();
    await expect(card.getByTestId('esef-synced')).toBeVisible();
    await expect.poll(() => mock.hits.slice(before).filter((h) => h.path.endsWith('-es.json')).length).toBe(0);

    // Coverage: a German company is told plainly there is no automatic ESEF source
    const de = await ui.evaluate(() => window.ib.invoke('companies:save', { name: 'Fixture Alemania', ticker: 'FXD', exchange: 'ETR' }));
    await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), de.id);
    await expect(ui.getByTestId('esef-coverage')).toContainText('Alemania');
  } finally {
    await app.close();
    mock.server.close();
  }
});
