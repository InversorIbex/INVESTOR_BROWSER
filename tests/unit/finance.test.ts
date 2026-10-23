import { describe, expect, it } from 'vitest';
import { buildFigureTable, normalizePeriod, parseFigure, periodSortKey, ratiosFor, formatMoney, formatPct, type Figure } from '../../src/shared/finance';
import { dcf, multiples, sensitivity, sectorWarning, type ValuationInputs } from '../../src/shared/valuation';
import { edgarLinks, isOnIrSite, normalizeTicker, officialSourceFor } from '../../src/shared/sources';

describe('parseFigure', () => {
  const cases: [string, number, string | null, string | null][] = [
    ['$245,122 million', 245122, 'millions', 'USD'],
    ['1.234,5 M€', 1234.5, 'millions', 'EUR'],
    ['(12,345)', -12345, null, null],
    ['−3.2 bn', -3.2, 'billions', null],
    ['€2,3 mil millones', 2.3, 'billions', 'EUR'],
    ['US$ 1,234,567', 1234567, null, 'USD'],
    ['Revenue (in millions) 211,915', 211915, 'millions', null],
    ['12.5%', 12.5, null, null],
    ['7.432', 7432, null, null],
  ];
  for (const [text, value, scale, currency] of cases) {
    it(text, () => {
      const r = parseFigure(text)!;
      expect(r.value).toBeCloseTo(value);
      expect(r.scale).toBe(scale);
      expect(r.currency).toBe(currency);
    });
  }
  it('flags ambiguous separators', () => {
    expect(parseFigure('7.432')!.ambiguous).toBe(true);
    expect(parseFigure('7.432,10')!.ambiguous).toBe(false);
  });
  it('detects percentages and returns null without numbers', () => {
    expect(parseFigure('12.5%')!.percent).toBe(true);
    expect(parseFigure('no numbers here')).toBeNull();
  });
});

describe('periods', () => {
  it('normalizes', () => {
    expect(normalizePeriod('fy2025')).toBe('FY2025');
    expect(normalizePeriod('q3 2026')).toBe('Q3 2026');
    expect(normalizePeriod('Q32026')).toBe('Q3 2026');
    expect(normalizePeriod('2025')).toBeNull();
  });
  it('sorts chronologically', () => {
    const ps = ['FY2025', 'Q1 2025', 'Q4 2024', 'FY2024'];
    expect([...ps].sort((a, b) => periodSortKey(a) - periodSortKey(b))).toEqual(['Q4 2024', 'FY2024', 'Q1 2025', 'FY2025']);
  });
});

describe('figure table', () => {
  const base = (metric: Figure['metric'], value: number, origin: Figure['origin'] = 'published'): Figure => ({ metric, period: 'FY2025', value, scale: 'millions', currency: 'USD', origin });

  it('derives FCF and net debt with formulas, never inventing missing data', () => {
    const t = buildFigureTable([base('cfo', 100), base('capex', 30), base('gross_debt', 50), base('cash', 80), base('revenue', 400)]);
    const row = t.get('FY2025')!;
    expect(row.get('fcf')).toMatchObject({ value: 70e6, origin: 'calculated', formula: 'FCL = Flujo de caja operativo − CAPEX' });
    expect(row.get('net_debt')!.value).toBe(-30e6);
    expect(row.has('net_income')).toBe(false); // not filled with 0
    const r = ratiosFor(row);
    expect(r.find((x) => x.id === 'fcf_margin')!.value).toBeCloseTo(0.175);
    expect(r.find((x) => x.id === 'net_margin')!.value).toBeNull();
  });

  it('treats CAPEX entered as negative the same as positive', () => {
    const t = buildFigureTable([base('cfo', 100), base('capex', -30)]);
    expect(t.get('FY2025')!.get('fcf')!.value).toBe(70e6);
  });

  it('published figures win over calculations and estimates', () => {
    const t = buildFigureTable([base('cfo', 100), base('capex', 30), base('fcf', 65), base('fcf', 90, 'estimate')]);
    expect(t.get('FY2025')!.get('fcf')).toMatchObject({ value: 65e6, origin: 'published' });
  });

  it('does not mix currencies in derivations', () => {
    const t = buildFigureTable([base('cfo', 100), { ...base('capex', 30), currency: 'EUR' }]);
    expect(t.get('FY2025')!.has('fcf')).toBe(false);
  });

  it('formats', () => {
    expect(formatMoney(2.5e9, 'USD')).toBe('2,5 mil M USD');
    expect(formatMoney(null)).toBe('—');
    expect(formatPct(0.1234)).toBe('12,3 %');
  });
});

describe('valuation', () => {
  const inp: ValuationInputs = { price: 100, shares: 1e6, grossDebt: 20e6, cash: 5e6, netIncome: 5e6, ebit: 8e6, ebitda: 10e6, fcf: 4e6, dividendPerShare: 2 };

  it('computes multiples with formulas', () => {
    const m = Object.fromEntries(multiples(inp).map((x) => [x.id, x]));
    expect(m.market_cap!.value).toBe(100e6);
    expect(m.ev!.value).toBe(115e6);
    expect(m.per!.value).toBe(20);
    expect(m.ev_ebit!.value).toBeCloseTo(14.375);
    expect(m.fcf_yield!.value).toBeCloseTo(0.04);
    expect(m.div_yield!.value).toBeCloseTo(0.02);
  });

  it('refuses meaningless multiples instead of showing nonsense', () => {
    const m = Object.fromEntries(multiples({ ...inp, netIncome: -1e6, price: null }).map((x) => [x.id, x]));
    expect(m.per!.value).toBeNull();
    expect(m.market_cap!.reason).toContain('Falta');
    const neg = Object.fromEntries(multiples({ ...inp, netIncome: -1e6 }).map((x) => [x.id, x]));
    expect(neg.per!.value).toBeNull();
    expect(neg.per!.reason).toContain('negativo');
  });

  it('adapts to banks', () => {
    const ids = multiples(inp, 'bank').map((x) => x.id);
    expect(ids).not.toContain('ev_ebit');
    expect(ids).not.toContain('p_fcf');
    expect(multiples(inp, 'bank').find((x) => x.id === 'ev')!.value).toBeNull();
    expect(sectorWarning('bank')).toContain('Bancos');
    expect(sectorWarning('general')).toBeNull();
  });

  it('DCF matches a hand calculation', () => {
    const r = dcf({ fcf0: 100, years: 2, netDebt: 0, shares: 10 }, { name: 'x', growth: 0.1, terminalGrowth: 0.02, discountRate: 0.1 });
    // FCF1=110 → PV 100; FCF2=121 → PV 100; TV = 121*1.02/0.08 = 1542.75 → PV 1275
    expect(r.ok).toBe(true);
    expect(r.projected[0]!.pv).toBeCloseTo(100);
    expect(r.projected[1]!.pv).toBeCloseTo(100);
    expect(r.pvTerminal).toBeCloseTo(1275);
    expect(r.perShare).toBeCloseTo(147.5);
  });

  it('DCF rejects invalid setups', () => {
    const inp2 = { fcf0: 100, years: 5, netDebt: 0, shares: 10 };
    expect(dcf(inp2, { name: 'x', growth: 0.05, terminalGrowth: 0.1, discountRate: 0.08 }).error).toContain('mayor');
    expect(dcf({ ...inp2, fcf0: -5 }, { name: 'x', growth: 0.05, terminalGrowth: 0.02, discountRate: 0.08 }).ok).toBe(false);
  });

  it('sensitivity grid has the right shape and ordering', () => {
    const g = sensitivity({ fcf0: 100, years: 5, netDebt: 0, shares: 10 }, { name: 'b', growth: 0.05, terminalGrowth: 0.02, discountRate: 0.09 }, [0.08, 0.1], [0.03, 0.07]);
    expect(g).toHaveLength(2);
    expect(g[0]![1]!).toBeGreaterThan(g[0]![0]!); // more growth → more value
    expect(g[0]![0]!).toBeGreaterThan(g[1]![0]!); // higher rate → less value
  });
});

describe('sources', () => {
  it('recognises official hosts and rejects lookalikes', () => {
    expect(officialSourceFor('https://www.sec.gov/edgar/search/')).toBe('SEC (EE. UU.)');
    expect(officialSourceFor('https://efts.sec.gov/x')).toBe('SEC (EE. UU.)');
    expect(officialSourceFor('https://sec.gov.evil.com/')).toBeNull();
    expect(officialSourceFor('https://evilsec.gov/')).toBeNull();
    expect(officialSourceFor('http://www.sec.gov/')).toBeNull(); // only over HTTPS
    expect(officialSourceFor('https://www.cnmv.es/portal/')).toBe('CNMV');
  });

  it('builds EDGAR links only from safe identifiers', () => {
    expect(edgarLinks({ ticker: 'msft' })[0]!.url).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&CIK=MSFT&type=10-K',
    );
    expect(edgarLinks({ ticker: 'X', cik: '789019' })[0]!.url).toContain('CIK=789019');
    expect(edgarLinks({ ticker: 'BAD&type=x' })).toEqual([]);
    expect(edgarLinks({})).toEqual([]);
  });

  it('tickers and IR matching', () => {
    expect(normalizeTicker('$brk.b')).toBe('BRK.B');
    expect(normalizeTicker('not a ticker')).toBeNull();
    expect(isOnIrSite('https://www.microsoft.com/en-us/investor/earnings', 'https://microsoft.com/investor')).toBe(true);
    expect(isOnIrSite('https://microsoft.com.evil.io/', 'https://microsoft.com/investor')).toBe(false);
  });
});
