import { describe, expect, it } from 'vitest';
import { annualPeriods, cagr, forensicsReport, qualityReport, roicSeries } from '../../src/shared/analysis';
import { buildFigureTable, type Figure, type MetricId } from '../../src/shared/finance';
import { normalizeCompanyFacts, type CompanyFacts } from '../../src/shared/xbrl';
import { companyFacts } from '../fixtures/sec';

/** Same conversion the app uses for SEC data (values already in base units). */
function fixtureTable() {
  const n = normalizeCompanyFacts(companyFacts as CompanyFacts);
  const figs: Figure[] = n.facts.map((f) => ({ metric: f.metric, period: f.period, value: f.value, scale: 'units', currency: f.currency, origin: 'published', restated: !!f.restatedFrom, provider: 'sec' }));
  return { table: buildFigureTable(figs), restated: n.facts.filter((f) => f.restatedFrom).map((f) => ({ period: f.period, metric: f.metric })) };
}

/** Compact builder: { FY2023: { revenue: 100, ... } } in millions. */
function table(data: Record<string, Partial<Record<MetricId, number>>>) {
  const figs: Figure[] = Object.entries(data).flatMap(([period, row]) =>
    Object.entries(row).map(([metric, value]) => ({ metric: metric as MetricId, period, value: value!, scale: 'millions' as const, currency: 'USD', origin: 'published' as const })),
  );
  return buildFigureTable(figs);
}

const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((x) => [x.id, x]));

describe('Quality Compounder', () => {
  it('evaluates the fixture company with transparent criteria', () => {
    const { table: t } = fixtureTable();
    const q = qualityReport(t);
    const c = byId(q.criteria);
    expect(q.years).toEqual(['FY2023', 'FY2024', 'FY2025']);
    expect(c.growth).toMatchObject({ verdict: 'strong', periods: ['FY2023', 'FY2025'] });
    expect(c.growth!.value).toBeCloseTo(Math.sqrt(1180 / 900) - 1, 6);
    expect(c.growth!.inputs.map((i) => i.value)).toEqual([900e6, 1180e6]);
    expect(c.margin!.verdict).toBe('strong');
    expect(c.fcf_conversion!.value).toBeCloseTo(700 / 647, 6);
    expect(c.leverage).toMatchObject({ verdict: 'strong', display: 'Caja neta' });
    expect(c.dilution!.verdict).toBe('strong');
    expect(c.stability!.verdict).toBe('strong');
    expect(c.roic!.verdict).toBe('strong');
    expect(q).toMatchObject({ strong: 7, evaluable: 7, sectorWarning: null });
  });

  it('ROIC: hand-checked, average invested capital, tax rate from the filings', () => {
    const { table: t } = fixtureTable();
    const r = byId(roicSeries(t).map((x) => ({ ...x, id: x.period })));
    expect(r.FY2023!.roic).toBeNull(); // no debt reported for FY2023 → not computed, not guessed
    expect(r.FY2024!.roic).toBeCloseTo((280 * (1 - 52 / 257)) / (950 + 420 - 470), 6);
    expect(r.FY2025!.roic).toBeCloseTo((350 * (1 - 66 / 328)) / ((900 + 880) / 2), 6);
  });

  it('flags weak businesses and never passes missing data', () => {
    const t = table({
      FY2021: { revenue: 100, operating_income: 10, net_income: 8, cfo: 5, capex: 4, diluted_shares: 100, gross_debt: 80, cash: 5 },
      FY2022: { revenue: 90, operating_income: 6, net_income: 5, cfo: 3, capex: 4, diluted_shares: 110 },
      FY2023: { revenue: 95, operating_income: 4, net_income: 4, cfo: 2, capex: 3, diluted_shares: 125, gross_debt: 80, cash: 5 },
    });
    const c = byId(qualityReport(t).criteria);
    expect(c.growth!.verdict).toBe('weak'); // CAGR −2.5 %
    expect(c.margin!.verdict).toBe('weak'); // 4.2 %
    expect(c.fcf_conversion!.verdict).toBe('weak'); // negative FCF in 2 of 3 years
    expect(c.leverage!.verdict).toBe('weak'); // 75 / 4 = 18.75×
    expect(c.dilution!.verdict).toBe('weak'); // +11.8 %/year
    expect(c.roic).toMatchObject({ verdict: 'na' });
    expect(c.roic!.reason).toBeTruthy();
  });

  it('needs enough history and adapts to banks', () => {
    const t = table({ FY2025: { revenue: 100, operating_income: 20 } });
    const c = byId(qualityReport(t).criteria);
    expect(c.growth).toMatchObject({ verdict: 'na', display: '—' });
    const bank = qualityReport(fixtureTable().table, 'bank');
    expect(byId(bank.criteria).roic!.verdict).toBe('na');
    expect(byId(bank.criteria).leverage!.reason).toContain('bancos');
    expect(bank.sectorWarning).toContain('Bancos');
  });

  it('ignores quarterly periods and computes CAGR safely', () => {
    expect(annualPeriods(table({ FY2024: { revenue: 1 }, 'Q1 2025': { revenue: 1 }, FY2025: { revenue: 2 } }))).toEqual(['FY2024', 'FY2025']);
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1);
    expect(cagr(-5, 10, 2)).toBeNull();
  });
});

describe('Financial Forensics', () => {
  it('fixture: receivables outpace revenue and a restated figure; the rest is clear', () => {
    const { table: t, restated } = fixtureTable();
    const f = forensicsReport(t, restated);
    const s = byId(f.signals);
    expect(s.receivables).toMatchObject({ status: 'triggered', periods: ['FY2024', 'FY2025'] });
    expect(s.receivables!.detail).toContain('40,0 %');
    expect(s.restatements).toMatchObject({ status: 'triggered', detail: '1 cifra(s): revenue FY2024' });
    for (const id of ['profit_vs_cash', 'cash_conversion', 'accruals', 'inventory', 'debt', 'dilution', 'margins', 'sbc']) expect(s[id]!.status, id).toBe('clear');
    expect(f.triggered).toBe(2);
    // Every signal explains itself and its limits
    for (const sig of f.signals) {
      expect(sig.why.length).toBeGreaterThan(20);
      expect(sig.limitation.length).toBeGreaterThan(20);
    }
    expect(f.notCovered.map((x) => x.title)).toContain('Cambios en políticas contables');
  });

  it('detects profit without cash, accruals, debt, dilution, margins and SBC', () => {
    const t = table({
      FY2022: { revenue: 1000, operating_income: 200, net_income: 150, cfo: 160, total_assets: 2000, gross_debt: 300, diluted_shares: 100 },
      FY2023: { revenue: 1050, operating_income: 170, net_income: 170, cfo: 120, total_assets: 2100, gross_debt: 320, diluted_shares: 101, inventory: 100 },
      FY2024: { revenue: 1100, operating_income: 140, net_income: 190, cfo: 100, total_assets: 2200, gross_debt: 450, diluted_shares: 106, sbc: 130, inventory: 140, capex: 20 },
    });
    const s = byId(forensicsReport(t).signals);
    expect(s.profit_vs_cash!.status).toBe('triggered');
    expect(s.cash_conversion!.status).toBe('triggered'); // 0.71 and 0.53
    expect(s.accruals!.status).toBe('clear'); // (190−100)/2150 = 4.2 %
    expect(s.debt!.status).toBe('triggered'); // +40.6 % vs +4.8 %
    expect(s.dilution!.status).toBe('triggered'); // +5 %
    expect(s.margins!.status).toBe('triggered'); // 20 % → 12.7 %
    expect(s.sbc!.status).toBe('triggered'); // 11.8 % of revenue
    expect(s.inventory!.status).toBe('triggered'); // +40 % vs +4.8 %
    expect(s.receivables!.status).toBe('na');
    expect(s.restatements!.status).toBe('clear');
  });

  it('returns "no evaluable" rather than inventing with too little data', () => {
    const f = forensicsReport(table({ FY2025: { revenue: 100 } }));
    expect(f.signals.filter((s) => s.id !== 'restatements').every((s) => s.status === 'na')).toBe(true);
    expect(f.triggered).toBe(0);
  });
});
