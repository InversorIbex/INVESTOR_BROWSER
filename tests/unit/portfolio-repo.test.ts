import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/db';
import { ResearchRepo } from '../../src/main/research';
import { PortfolioRepo } from '../../src/main/portfolio';
import { fifo } from '../../src/shared/portfolio';

let dir: string;
let store: Store;
let research: ResearchRepo;
let repo: PortfolioRepo;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ib-portfolio-'));
  store = new Store(path.join(dir, 'p.db'));
  research = new ResearchRepo(store.db);
  repo = new PortfolioRepo(store.db, research);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const file = {
  format: 'investor-browser/portfolio',
  version: 1,
  holdings: [
    { name: 'Aena', ticker: 'AENA', exchange: 'BME', currency: 'EUR', shares: 50, avgCost: 24 },
    { name: 'Diageo', ticker: 'DGE', exchange: 'LON', currency: 'GBX', shares: 10, avgCost: 2500, costEur: 300 },
    { name: 'Nestlé', ticker: 'NESN', exchange: 'SWX', currency: 'CHF', shares: null, avgCost: null },
    { name: 'Rara', ticker: 'RARA', exchange: 'XXX' },
  ],
  watchlist: [{ name: 'Apple', ticker: 'AAPL', exchange: 'NASDAQ', target: 180, note: 'Esperar' }],
  ops: [
    { ticker: 'PEP', exchange: 'NASDAQ', date: '2024-05-02', side: 'buy', qty: 10, price: 171.2, currency: 'USD', feeEur: 5, fxPerEur: 1.08 },
    { ticker: 'PEP', exchange: 'NASDAQ', date: '2025-05-02', side: 'sell', qty: 4, price: 150, currency: 'USD', feeEur: 5, fxPerEur: 1.12 },
  ],
};

describe('PortfolioRepo', () => {
  it('imports holdings, opening positions, operations and the watchlist', () => {
    const r = repo.import(file, () => 0.93);
    expect(r).toMatchObject({ companies: 6, holdings: 4, ops: 4, watchlist: 1 });
    expect(r.warnings.join('\n')).toMatch(/RARA: bolsa «XXX» desconocida/);
    const d = repo.get();
    expect(d.holdings).toHaveLength(5); // 4 holdings + PEP (operations add it)
    const byTicker = (t: string) => research.listCompanies().find((c) => c.ticker === t)!.id;
    // Diageo: 2500 pence → 25 GBP; fx implied by the cost in EUR: 10·25/300
    const dge = d.ops.find((o) => o.companyId === byTicker('DGE'))!;
    expect(dge).toMatchObject({ price: 25, currency: 'GBP', source: 'inicial', date: null });
    expect(dge.fxPerEur).toBeCloseTo(250 / 300, 9);
    expect(fifo(d.ops.filter((o) => o.companyId === byTicker('DGE'))).costEur).toBeCloseTo(300, 9);
    // Nestlé without shares: in the portfolio, no operations invented
    expect(d.ops.some((o) => o.companyId === byTicker('NESN'))).toBe(false);
    expect(d.watchlist[0]).toMatchObject({ target: 180, note: 'Esperar' });
  });

  it('importing the same file twice does not duplicate anything', () => {
    repo.import(file, () => 0.93);
    const once = repo.get();
    const r2 = repo.import(file, () => 0.93);
    expect(r2.companies).toBe(0);
    const twice = repo.get();
    expect(twice.ops).toHaveLength(once.ops.length);
    expect(research.listCompanies()).toHaveLength(6);
  });

  it('is atomic: a bad file changes nothing', () => {
    expect(() => repo.import({ ...file, ops: [{ ...file.ops[0], qty: -1 }] }, () => 1)).toThrow();
    expect(repo.get().holdings).toHaveLength(0);
    expect(research.listCompanies()).toHaveLength(0);
  });

  it('round-trips through export', () => {
    repo.import(file, () => 0.93);
    const exported = repo.export();
    const dir2 = mkdtempSync(path.join(tmpdir(), 'ib-portfolio2-'));
    const s2 = new Store(path.join(dir2, 'p.db'));
    try {
      const r2 = new PortfolioRepo(s2.db, new ResearchRepo(s2.db));
      r2.import(JSON.parse(JSON.stringify(exported)), () => 0.93);
      expect(r2.get().ops.map((o) => [o.side, o.qty, o.price, o.currency])).toEqual(repo.get().ops.map((o) => [o.side, o.qty, o.price, o.currency]));
    } finally {
      s2.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('validates operations and snapshots', () => {
    const id = research.saveCompany({ name: 'X', ticker: 'X', exchange: 'BME' }).id;
    expect(() => repo.addOp({ companyId: id, date: '2999-01-01', side: 'buy', qty: 1, price: 1, currency: 'EUR', feeEur: 0, fxPerEur: 1 })).toThrow(/futuro/);
    expect(() => repo.addOp({ companyId: 999, date: null, side: 'buy', qty: 1, price: 1, currency: 'EUR', feeEur: 0, fxPerEur: 1 })).toThrow();
    repo.snapshot('2026-10-24', 1000, 800, 3);
    repo.snapshot('2026-10-24', 1100, 800, 3);
    expect(repo.get().snapshots).toEqual([{ date: '2026-10-24', totalEur: 1100, costEur: 800, positions: 3 }]);
    // Deleting a company removes its portfolio data (no orphans)
    repo.addOp({ companyId: id, date: '2026-01-01', side: 'buy', qty: 1, price: 1, currency: 'EUR', feeEur: 0, fxPerEur: 1 });
    research.removeCompany(id);
    expect(repo.get().ops).toHaveLength(0);
  });
});
