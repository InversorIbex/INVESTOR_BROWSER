import { describe, expect, it } from 'vitest';
import { buildFigureTable, type Figure } from '../../src/shared/finance';
import { passes, PRESETS, scoreUniverse, screenMetrics } from '../../src/shared/screener';

const fig = (metric: string, period: string, value: number, scale: Figure['scale'] = 'millions'): Figure => ({ metric: metric as Figure['metric'], period, value, scale, currency: 'EUR', origin: 'published' });
function company(o: { rev: number[]; op: number[]; ni: number[]; cfo: number[]; capex: number[]; shares: number[]; dps?: number[] }) {
  const figs: Figure[] = [];
  o.rev.forEach((v, i) => {
    const p = `FY${2022 + i}`;
    figs.push(fig('revenue', p, v), fig('operating_income', p, o.op[i]!), fig('net_income', p, o.ni[i]!), fig('cfo', p, o.cfo[i]!), fig('capex', p, o.capex[i]!), fig('diluted_shares', p, o.shares[i]!));
    figs.push(fig('pretax_income', p, o.op[i]! * 0.95), fig('income_tax', p, o.op[i]! * 0.95 * 0.25), fig('equity', p, 1000), fig('gross_debt', p, 300), fig('cash', p, 100), fig('dna', p, 50));
    if (o.dps) figs.push({ ...fig('dividend_per_share', p, o.dps[i]!, 'units') });
  });
  return buildFigureTable(figs);
}

describe('screener metrics (checked by hand)', () => {
  const t = company({ rev: [800, 900, 1000, 1100], op: [160, 180, 200, 230], ni: [110, 120, 140, 160], cfo: [150, 170, 190, 210], capex: [40, 40, 50, 50], shares: [102, 101, 100, 98], dps: [0.8, 0.9, 1.0, 1.1] });
  const m = screenMetrics({ table: t, sector: 'general', priceInStatements: 20, priceNote: null, priceInEur: 20, changePct: 1.5 });
  it('valuation from price × diluted shares', () => {
    // mcap = 20 × 98 M = 1960 M; NI 160 → PER 12.25; FCL 160 → P/FCL 12.25, yield 8.16 %
    expect(m.per.value).toBeCloseTo(12.25, 9);
    expect(m.fcf_yield.value).toBeCloseTo(160 / 1960, 9);
    // EV = 1960 + 300 − 100 = 2160; EBITDA = 230 + 50 = 280 → 7.714
    expect(m.ev_ebitda.value).toBeCloseTo(2160 / 280, 9);
    expect(m.ev_ebitda.note).toMatch(/amortizaciones/);
    expect(m.div_yield.value).toBeCloseTo(1.1 / 20, 9);
    expect(m.payout.value).toBeCloseTo((1.1 * 98) / 160, 9);
    expect(m.market_cap_eur.value).toBeCloseTo(1960, 9);
  });
  it('profitability, solvency and growth', () => {
    expect(m.op_margin.value).toBeCloseTo(230 / 1100, 9);
    expect(m.fcf_margin.value).toBeCloseTo(160 / 1100, 9);
    expect(m.net_debt_ebitda.value).toBeCloseTo(200 / 280, 9);
    expect(m.dilution.value).toBeCloseTo(98 / 100 - 1, 9);
    expect(m.rev_cagr3.value).toBeCloseTo((1100 / 800) ** (1 / 3) - 1, 9);
    expect(m.dps_growth.value).toBeCloseTo(0.1, 9);
    expect(m.roe.value).toBeCloseTo(0.16, 9);
  });
  it('never invents: no price → price metrics null with the reason', () => {
    const n = screenMetrics({ table: t, sector: 'general', priceInStatements: null, priceNote: 'Precio en USD y cuentas en EUR: falta el tipo de cambio.', priceInEur: null, changePct: null });
    expect(n.per.value).toBeNull();
    expect(n.per.note).toMatch(/tipo de cambio/);
    expect(n.op_margin.value).not.toBeNull();
    expect(n.gross_margin.value).toBeNull(); // no gross profit in the data
  });
  it('banks: no EV multiples', () => {
    expect(screenMetrics({ table: t, sector: 'bank', priceInStatements: 20, priceNote: null, priceInEur: 20, changePct: null }).ev_ebitda.value).toBeNull();
  });
  it('percentile scores within the universe; presets need data to pass', () => {
    const mk = (op: number, price: number) =>
      screenMetrics({ table: company({ rev: [1000, 1000, 1000, 1000], op: [op, op, op, op], ni: [op * 0.7, op * 0.7, op * 0.7, op * 0.7], cfo: [op, op, op, op], capex: [10, 10, 10, 10], shares: [100, 100, 100, 100] }), sector: 'general', priceInStatements: price, priceNote: null, priceInEur: price, changePct: null });
    const rows = [mk(300, 10), mk(200, 20), mk(100, 40)];
    scoreUniverse(rows);
    // ROIC, op. margin and FCF margin rank 1 / ½ / 0; debt and dilution tie at ½ → (1+1+1+½+½)/5 = 80
    expect(rows.map((r) => r.score_quality.value)).toEqual([80, 50, 20]);
    expect(rows[0]!.score_value.value).toBe(100);
    expect(rows[2]!.score_value.value).toBe(0);
    const garp = PRESETS.find((p) => p.id === 'garp')!;
    expect(passes(rows[0]!, garp.f)).toBe(true);
    expect(passes(rows[2]!, garp.f)).toBe(false);
    expect(passes({ ...rows[0]!, per: { value: null, note: '' } }, garp.f)).toBe(false);
  });
});
