import { describe, expect, it } from 'vitest';
import {
  fiscalYearLabel,
  filingDocumentUrl,
  filingIndexUrl,
  isAnnualDuration,
  normalizeCompanyFacts,
  padCik,
  parseSubmissions,
  parseTickerFile,
  searchTickers,
  type CompanyFacts,
} from '../../src/shared/xbrl';
import { companyFacts, companyTickers, ifrsFacts, submissions } from '../fixtures/sec';

const byKey = (r: ReturnType<typeof normalizeCompanyFacts>) => new Map(r.facts.map((f) => [`${f.metric}|${f.period}`, f]));

describe('XBRL normalisation', () => {
  const r = normalizeCompanyFacts(companyFacts as CompanyFacts);
  const f = byKey(r);

  it('derives periods from dates, never from the filing fy', () => {
    // FY2023 comparative appears in the FY2024 10-K tagged fy=2024: still FY2023.
    expect(f.get('revenue|FY2023')).toMatchObject({ value: 900e6, periodEnd: '2023-06-30', currency: 'USD' });
    expect([...f.keys()].filter((k) => k.startsWith('revenue|'))).toEqual(['revenue|FY2023', 'revenue|FY2024', 'revenue|FY2025']);
  });

  it('keeps the most recent filing and flags the restatement with the original value', () => {
    expect(f.get('revenue|FY2024')).toMatchObject({
      value: 1010e6,
      accn: '0001999999-25-000015',
      restatedFrom: { value: 1000e6, accn: '0001999999-24-000012', form: '10-K' },
    });
    expect(f.get('revenue|FY2023')!.restatedFrom).toBeNull(); // same value repeated is not a restatement
  });

  it('ignores quarterly facts and quarter-end balances', () => {
    expect(r.facts.some((x) => x.value === 320e6 || x.value === 540e6)).toBe(false);
  });

  it('respects concept priority', () => {
    expect(f.get('revenue|FY2025')).toMatchObject({ value: 1180e6, concept: 'us-gaap:Revenues' });
  });

  it('balances at fiscal year end, debt summed from components and labelled as such', () => {
    expect(f.get('cash|FY2025')!.value).toBe(520e6);
    expect(f.get('gross_debt|FY2025')).toMatchObject({ value: 400e6, derived: true, concept: 'us-gaap:LongTermDebtNoncurrent + us-gaap:LongTermDebtCurrent' });
    expect(f.has('gross_debt|FY2023')).toBe(false); // components missing → no value, not 0
  });

  it('units: shares and per-share', () => {
    expect(f.get('diluted_shares|FY2025')).toMatchObject({ value: 150e6, unit: 'shares', currency: null });
    expect(f.get('eps_diluted|FY2025')).toMatchObject({ value: 1.75, unit: 'USD/shares', currency: 'USD' });
    expect(f.get('dividend_per_share|FY2024')!.value).toBe(0.4);
  });

  it('reports which concepts were used and what is missing', () => {
    expect(r.conceptsUsed.capex).toEqual(['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment']);
    expect(r.missing).toEqual([]);
    expect(r.taxonomy).toBe('us-gaap');
    expect(r.entityName).toBe('FIXTURE TEST CORP');
  });

  it('handles IFRS filers in their reporting currency', () => {
    const i = byKey(normalizeCompanyFacts(ifrsFacts as CompanyFacts));
    expect(i.get('revenue|FY2024')).toMatchObject({ value: 290_000e6, currency: 'DKK', concept: 'ifrs-full:Revenue', form: '20-F' });
    expect(i.get('net_income|FY2024')!.concept).toBe('ifrs-full:ProfitLoss');
    expect(i.get('cash|FY2024')!.value).toBe(15_000e6);
  });

  it('returns nothing (not zeros) for empty or foreign data', () => {
    expect(normalizeCompanyFacts({ cik: 1, facts: {} }).facts).toEqual([]);
    expect(normalizeCompanyFacts({ cik: 1, facts: { dei: {} } } as CompanyFacts).taxonomy).toBeNull();
  });

  it('periods', () => {
    expect(isAnnualDuration('2024-07-01', '2025-06-30')).toBe(true);
    expect(isAnnualDuration('2024-01-01', '2024-12-28')).toBe(true); // 52-week year
    expect(isAnnualDuration('2025-07-01', '2025-09-30')).toBe(false);
    expect(fiscalYearLabel('2025-06-30')).toBe('FY2025');
    expect(fiscalYearLabel('2025-01-03')).toBe('FY2024'); // 52/53-week year ending early January
  });
});

describe('SEC identifiers and documents', () => {
  it('pads and validates CIKs', () => {
    expect(padCik(320193)).toBe('0000320193');
    expect(padCik('0000320193')).toBe('0000320193');
    expect(() => padCik('12345678901')).toThrow();
  });

  it('builds archive URLs and rejects path tricks', () => {
    expect(filingIndexUrl('0000320193', '0000320193-25-000079')).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/');
    expect(filingDocumentUrl(320193, '0000320193-25-000079', 'aapl-20250927.htm')).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm',
    );
    expect(filingDocumentUrl(320193, '0000320193-25-000079', '../../evil')).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/');
    expect(() => filingIndexUrl(1, 'x/../y')).toThrow();
  });

  it('parses the ticker file and searches by ticker or name', () => {
    const t = parseTickerFile(companyTickers);
    expect(t).toHaveLength(4);
    expect(searchTickers(t, '$fxtc')[0]).toEqual({ cik: 1999999, ticker: 'FXTC', title: 'FIXTURE TEST CORP' });
    expect(searchTickers(t, 'FXT').map((x) => x.ticker)).toEqual(['FXTC', 'FXTB']);
    expect(searchTickers(t, 'nordic')[0]!.ticker).toBe('NVOX');
    expect(parseTickerFile({ a: { cik_str: 'x' } })).toEqual([]);
  });

  it('parses columnar submissions defensively', () => {
    const s = parseSubmissions(submissions)!;
    expect(s).toMatchObject({ cik: '0001999999', name: 'FIXTURE TEST CORP', tickers: ['FXTC'], exchanges: ['Nasdaq'], fiscalYearEnd: '0630' });
    expect(s.filings[0]).toMatchObject({ form: '10-Q', filingDate: '2025-10-28', url: 'https://www.sec.gov/Archives/edgar/data/1999999/000199999925000020/fxtc-20250930.htm' });
    // Form 4 primary documents contain a slash (XSL rendering path): falls back to the index page.
    expect(s.filings.find((x) => x.form === '4')!.url).toBe('https://www.sec.gov/Archives/edgar/data/1999999/000199999925000018/');
    expect(parseSubmissions({})).toBeNull();
  });
});
