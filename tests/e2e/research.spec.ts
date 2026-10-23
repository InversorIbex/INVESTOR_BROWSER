import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import { inPage, launch, nativeKey, newProfileDir, startFixtureServer, state, waitFor } from './helpers';

let server: Server;
let base: string;
test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
});
test.afterAll(() => server.close());

test('flujo de investigación: empresa, vincular, guardar cita con fuente, cifras, valoración y persistencia', async () => {
  const profile = newProfileDir();
  {
    const { app, ui } = await launch(profile);
    try {
      // 1. Create a company from the Research page (real UI)
      await ui.evaluate(() => window.ib.invoke('command:run', { id: 'open.research' }));
      await expect(ui.getByTestId('research-page')).toBeVisible();
      await ui.getByTestId('new-company').click();
      await ui.getByTestId('company-name').fill('Ejemplo Corp');
      await ui.getByTestId('company-ticker').fill('exm');
      await ui.getByTestId('company-ir').fill(`${base}/`);
      await ui.getByTestId('company-submit').click();
      await expect(ui.getByTestId('company-page')).toBeVisible();
      await expect(ui.getByTestId('dossier-name')).toHaveText('Ejemplo Corp');
      const company = (await ui.evaluate(() => window.ib.invoke('companies:list')))[0]!;
      expect(company.ticker).toBe('EXM');
      await expect(ui.getByTestId('sb-company')).toContainText('Ejemplo Corp');

      // 2. Open a page on the IR site: the address bar recognises it, the panel offers to link it
      await ui.evaluate(() => window.ib.invoke('settings:update', { rightPanelVisible: true }));
      await ui.evaluate((u) => window.ib.invoke('tabs:create', { url: u }), `${base}/one`);
      await waitFor(() => state(ui), (s) => s.tabs.some((t) => t.title === 'Página uno'));
      await expect(ui.getByTestId('chip-company')).toContainText('IR · EXM');
      await ui.getByTestId('rp-link-suggested').click();
      await waitFor(() => state(ui), (s) => s.tabs.find((t) => t.title === 'Página uno')?.companyId === company.id);

      // 3. Select text in the page and save it — read through an isolated world
      await inPage(app, '/one', "const r=document.createRange(); r.selectNodeContents(document.querySelector('p')); getSelection().removeAllRanges(); getSelection().addRange(r); true");
      await ui.getByTestId('rp-save-selection').click();
      await expect(ui.getByTestId('save-dialog')).toBeVisible();
      await expect(ui.getByTestId('save-quote')).toHaveValue('Free cash flow grew. Free cash flow yield matters.');
      await ui.getByTestId('save-body').fill('Buena señal');
      await ui.getByTestId('save-submit').click();
      await expect(ui.getByTestId('save-dialog')).toBeHidden();
      const notes = await ui.evaluate((id) => window.ib.invoke('notes:list', { companyId: id }), company.id);
      expect(notes[0]).toMatchObject({ kind: 'snippet', quote: 'Free cash flow grew. Free cash flow yield matters.', body: 'Buena señal', sourceTitle: 'Página uno' });
      expect(notes[0]!.sourceUrl).toBe(`${base}/one`);
      expect(notes[0]!.accessedAt).toBeGreaterThan(Date.now() - 60_000);

      // Keyboard path: Ctrl+Shift+S pressed inside the page opens the same dialog
      await nativeKey(app, { url: '/one' }, 'S', ['control', 'shift']);
      await expect(ui.getByTestId('save-dialog')).toBeVisible();
      await ui.keyboard.press('Escape');
      await expect(ui.getByTestId('save-dialog')).toBeHidden();

      // Links opened from a company tab inherit the company
      await inPage(app, '/one', "document.getElementById('blank').click()");
      await waitFor(() => state(ui), (s) => s.tabs.find((t) => t.title === 'Página tres')?.companyId === company.id);

      // 4. Figures through the dossier UI; FCF is derived and labelled as own calculation
      await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), company.id);
      for (const [metric, value] of [['cfo', '100'], ['capex', '30'], ['revenue', '400'], ['diluted_shares', '10'], ['gross_debt', '50'], ['cash', '20']] as const) {
        await ui.getByTestId('add-figure').click();
        await ui.getByTestId('figure-metric').selectOption(metric);
        await ui.getByTestId('figure-period').fill('FY2025');
        await ui.getByTestId('figure-value').fill(value);
        await ui.getByTestId('save-submit').click();
        await expect(ui.getByTestId('save-dialog')).toBeHidden();
      }
      const fcfCell = ui.locator('[data-testid="figures-table"] td[data-metric="fcf"][data-period="FY2025"]');
      await expect(fcfCell).toHaveText(/^70\b/);
      await expect(ui.locator('.table-caption')).toContainText('Millones de USD');
      await expect(fcfCell).toHaveClass(/cell-calculated/);
      await expect(fcfCell).toHaveAttribute('title', /FCL = Flujo de caja operativo − CAPEX/);

      // Manual price
      await ui.getByTestId('price-card').click();
      await ui.getByTestId('price-input').fill('100');
      await ui.getByTestId('price-save').click();
      await expect(ui.getByTestId('price-card')).toContainText('100');

      // Thesis autosaves
      await ui.getByTestId('thesis').fill('Negocio con caja creciente');
      await waitFor(() => ui.evaluate(() => window.ib.invoke('companies:list')), (c) => c[0]!.thesis === 'Negocio con caja creciente');

      // 5. Valuation lab loads saved figures with provenance
      await ui.getByTestId('to-valuation').click();
      await expect(ui.getByTestId('valuation-page')).toBeVisible();
      await ui.getByTestId('load-figures').click();
      await expect(ui.getByTestId('val-fcf')).toHaveValue('70');
      await expect(ui.getByTestId('val-price')).toHaveValue('100');
      // market cap = 100 × 10 M = 1.000 M; FCF yield = 70/1000 = 7 %
      await expect(ui.locator('[data-testid="multiples"] tr[data-id="fcf_yield"] td').first()).toHaveText('7,0 %');
      await expect(ui.getByTestId('scenario')).toHaveCount(3);
      await expect(ui.getByTestId('scenario-value').nth(1)).toContainText('USD/acción');
      await expect(ui.getByTestId('sensitivity')).toBeVisible();
      await ui.getByTestId('save-valuation').click();
      await waitFor(
        () => ui.evaluate((id) => window.ib.invoke('notes:list', { companyId: id }), company.id),
        (n) => n.some((x) => x.kind === 'conclusion' && x.body.includes('Valoración DCF')),
      );

      // 6. Security: hostile content is stored and shown as text, unsafe sources rejected
      await ui.evaluate((id) => window.ib.invoke('notes:add', { companyId: id, kind: 'snippet', quote: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>' }), company.id);
      const bad = await ui.evaluate((id) => window.ib.invoke('notes:add', { companyId: id, kind: 'note', body: 'x', sourceUrl: 'javascript:alert(1)' }).then(() => 'accepted', (e: Error) => e.message), company.id);
      expect(bad).not.toBe('accepted');
      await ui.evaluate((id) => window.ib.invoke('tabs:navigate', { input: `ib://company/${id}` }), company.id);
      await expect(ui.getByTestId('notebook')).toContainText('<script>window.__pwned=1</script>');
      expect(await ui.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      expect(await ui.locator('[data-testid="notebook"] img, [data-testid="notebook"] script').count()).toBe(0);
    } finally {
      await app.close();
    }
  }
  {
    // 7. Everything persists across restarts, including which tabs belong to the company
    const { app, ui } = await launch(profile);
    try {
      const s = await waitFor(() => state(ui), (x) => x.tabs.length >= 2);
      const c = (await ui.evaluate(() => window.ib.invoke('companies:list')))[0]!;
      expect(c).toMatchObject({ name: 'Ejemplo Corp', price: 100, thesis: 'Negocio con caja creciente' });
      expect(c.noteCount).toBeGreaterThanOrEqual(9);
      expect(s.tabs.filter((t) => t.companyId === c.id).length).toBeGreaterThanOrEqual(2);

      // $TICKER in the address bar opens the dossier
      const bar = ui.getByTestId('address-bar');
      await bar.click();
      await bar.fill('$exm');
      await bar.press('Enter');
      await expect(ui.getByTestId('company-page')).toBeVisible();

      // Workspace: save & close, then reopen
      const before = (await state(ui)).tabs.filter((t) => t.companyId === c.id && t.url.startsWith('http')).length;
      await ui.evaluate((id) => window.ib.invoke('workspace:close', { companyId: id }), c.id);
      await waitFor(() => state(ui), (x) => !x.tabs.some((t) => t.companyId === c.id));
      expect((await ui.evaluate(() => window.ib.invoke('companies:list')))[0]!.savedTabs.length).toBe(before);
      await ui.evaluate((id) => window.ib.invoke('workspace:open', { companyId: id }), c.id);
      await waitFor(() => state(ui), (x) => x.tabs.filter((t) => t.companyId === c.id).length === before);

      // Terminal theme
      await ui.evaluate(() => window.ib.invoke('settings:update', { theme: 'terminal' }));
      await expect(ui.locator('html')).toHaveAttribute('data-theme', 'terminal');
    } finally {
      await app.close();
    }
  }
});
