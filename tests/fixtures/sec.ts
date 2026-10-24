/**
 * Synthetic SEC responses in the exact shapes returned by the real APIs
 * (verified Oct 2026 against company_tickers.json, submissions and companyconcept).
 * The company and numbers are FICTITIOUS. They deliberately include real-world traps:
 *  - comparatives tagged with the fiscal year of the filing (fy ≠ period),
 *  - a restatement in a later 10-K,
 *  - quarterly 10-Q facts that must not leak into annual figures,
 *  - two revenue concepts for the same period,
 *  - debt reported only as components.
 */
export const FIXTURE_CIK = 1999999;
export const FIXTURE_CIK_PADDED = '0001999999';

export const companyTickers = {
  '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
  '1': { cik_str: FIXTURE_CIK, ticker: 'FXTC', title: 'FIXTURE TEST CORP' },
  '2': { cik_str: 1888888, ticker: 'FXTB', title: 'FIXTURE BANK HOLDINGS' },
  '3': { cik_str: 1777777, ticker: 'NVOX', title: 'NORDIC FIXTURE A/S' },
};

const K23 = { accn: '0001999999-23-000010', form: '10-K', filed: '2023-08-01', fy: 2023, fp: 'FY' };
const K24 = { accn: '0001999999-24-000012', form: '10-K', filed: '2024-08-01', fy: 2024, fp: 'FY' };
const K25 = { accn: '0001999999-25-000015', form: '10-K', filed: '2025-07-30', fy: 2025, fp: 'FY' };
const Q1 = { accn: '0001999999-25-000020', form: '10-Q', filed: '2025-10-28', fy: 2026, fp: 'Q1' };

const FY23 = { start: '2022-07-01', end: '2023-06-30' };
const FY24 = { start: '2023-07-01', end: '2024-06-30' };
const FY25 = { start: '2024-07-01', end: '2025-06-30' };
const Q126 = { start: '2025-07-01', end: '2025-09-30' };

const M = 1e6;
const dur = (p: { start: string; end: string }, val: number, f: typeof K23, frame?: string) => ({ ...p, val, ...f, ...(frame ? { frame } : {}) });
const inst = (end: string, val: number, f: typeof K23) => ({ end, val, ...f });

export const companyFacts = {
  cik: FIXTURE_CIK,
  entityName: 'FIXTURE TEST CORP',
  facts: {
    dei: {
      EntityCommonStockSharesOutstanding: { label: 'Entity Common Stock, Shares Outstanding', units: { shares: [inst('2025-07-15', 149_000_000, K25)] } },
    },
    'us-gaap': {
      Revenues: {
        label: 'Revenues',
        description: 'Amount of revenue recognized…',
        units: {
          USD: [
            dur(FY23, 900 * M, K23, 'CY2022'),
            dur(FY23, 900 * M, { ...K24, fy: 2024 }), // comparative in FY2024 10-K: fy is the FILING year
            dur(FY24, 1000 * M, K24),
            dur(FY24, 1010 * M, { ...K25, fy: 2025 }, 'CY2023'), // restated in FY2025 10-K
            dur(FY25, 1180 * M, K25, 'CY2024'),
            dur(Q126, 320 * M, Q1, 'CY2025Q3'), // quarterly: must be ignored
          ],
        },
      },
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        label: 'Revenue from Contract with Customer',
        units: { USD: [dur(FY25, 1179 * M, K25)] }, // lower priority than Revenues
      },
      GrossProfit: { label: 'Gross Profit', units: { USD: [dur(FY23, 610 * M, K23), dur(FY24, 700 * M, K24), dur(FY25, 830 * M, K25)] } },
      OperatingIncomeLoss: { label: 'Operating Income (Loss)', units: { USD: [dur(FY23, 240 * M, K23), dur(FY24, 280 * M, K24), dur(FY25, 350 * M, K25)] } },
      NetIncomeLoss: { label: 'Net Income (Loss)', units: { USD: [dur(FY23, 180 * M, K23), dur(FY24, 205 * M, K24), dur(FY25, 262 * M, K25)] } },
      NetCashProvidedByUsedInOperatingActivities: {
        label: 'Net Cash Provided by (Used in) Operating Activities',
        units: { USD: [dur(FY23, 250 * M, K23), dur(FY24, 300 * M, K24), dur(FY25, 365 * M, K25)] },
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        label: 'Payments to Acquire Property, Plant, and Equipment',
        units: { USD: [dur(FY23, 60 * M, K23), dur(FY24, 70 * M, K24), dur(FY25, 85 * M, K25)] },
      },
      CashAndCashEquivalentsAtCarryingValue: {
        label: 'Cash and Cash Equivalents, at Carrying Value',
        units: { USD: [inst('2023-06-30', 410 * M, K23), inst('2024-06-30', 470 * M, K24), inst('2025-06-30', 520 * M, K25), inst('2025-09-30', 540 * M, Q1)] },
      },
      LongTermDebtNoncurrent: { label: 'Long-Term Debt, Excluding Current Maturities', units: { USD: [inst('2024-06-30', 380 * M, K24), inst('2025-06-30', 350 * M, K25)] } },
      LongTermDebtCurrent: { label: 'Long-Term Debt, Current Maturities', units: { USD: [inst('2024-06-30', 40 * M, K24), inst('2025-06-30', 50 * M, K25)] } },
      WeightedAverageNumberOfDilutedSharesOutstanding: {
        label: 'Weighted Average Number of Shares Outstanding, Diluted',
        units: { shares: [dur(FY23, 152 * M, K23), dur(FY24, 151 * M, K24), dur(FY25, 150 * M, K25)] },
      },
      EarningsPerShareDiluted: { label: 'Earnings Per Share, Diluted', units: { 'USD/shares': [dur(FY23, 1.18, K23), dur(FY24, 1.36, K24), dur(FY25, 1.75, K25)] } },
      CommonStockDividendsPerShareDeclared: { label: 'Common Stock, Dividends, Per Share, Declared', units: { 'USD/shares': [dur(FY24, 0.4, K24), dur(FY25, 0.48, K25)] } },
    },
  },
};

const recent = [
  { accessionNumber: Q1.accn, filingDate: Q1.filed, reportDate: '2025-09-30', form: '10-Q', primaryDocument: 'fxtc-20250930.htm', primaryDocDescription: '10-Q' },
  { accessionNumber: '0001999999-25-000018', filingDate: '2025-09-02', reportDate: '2025-08-29', form: '4', primaryDocument: 'xslF345X05/wk-form4.xml', primaryDocDescription: 'FORM 4' },
  { accessionNumber: '0001999999-25-000016', filingDate: '2025-08-05', reportDate: '2025-08-05', form: '8-K', primaryDocument: 'fxtc-8k.htm', primaryDocDescription: '8-K' },
  { accessionNumber: K25.accn, filingDate: K25.filed, reportDate: '2025-06-30', form: '10-K', primaryDocument: 'fxtc-20250630.htm', primaryDocDescription: '10-K' },
  { accessionNumber: K24.accn, filingDate: K24.filed, reportDate: '2024-06-30', form: '10-K', primaryDocument: 'fxtc-20240630.htm', primaryDocDescription: '10-K' },
];
const col = <K extends keyof (typeof recent)[number]>(k: K) => recent.map((r) => r[k]);

export const submissions = {
  cik: FIXTURE_CIK_PADDED,
  entityType: 'operating',
  sic: '7372',
  sicDescription: 'Services-Prepackaged Software',
  name: 'FIXTURE TEST CORP',
  tickers: ['FXTC'],
  exchanges: ['Nasdaq'],
  fiscalYearEnd: '0630',
  stateOfIncorporation: 'DE',
  filings: {
    recent: {
      accessionNumber: col('accessionNumber'),
      filingDate: col('filingDate'),
      reportDate: col('reportDate'),
      acceptanceDateTime: recent.map((r) => `${r.filingDate}T16:05:00.000Z`),
      act: recent.map(() => '34'),
      form: col('form'),
      fileNumber: recent.map(() => '001-99999'),
      filmNumber: recent.map(() => '25000000'),
      items: recent.map(() => ''),
      size: recent.map(() => 123456),
      isXBRL: recent.map((r) => (r.form.startsWith('10') ? 1 : 0)),
      isInlineXBRL: recent.map((r) => (r.form.startsWith('10') ? 1 : 0)),
      primaryDocument: col('primaryDocument'),
      primaryDocDescription: col('primaryDocDescription'),
    },
    files: [],
  },
};

/** A foreign private issuer reporting under IFRS in DKK (20-F). */
const F24 = { accn: '0001777777-25-000003', form: '20-F', filed: '2025-02-05', fy: 2024, fp: 'FY' };
export const ifrsFacts = {
  cik: 1777777,
  entityName: 'NORDIC FIXTURE A/S',
  facts: {
    'ifrs-full': {
      Revenue: { label: 'Revenue', units: { DKK: [{ start: '2024-01-01', end: '2024-12-31', val: 290_000 * M, ...F24 }] } },
      ProfitLoss: { label: 'Profit (loss)', units: { DKK: [{ start: '2024-01-01', end: '2024-12-31', val: 100_000 * M, ...F24 }] } },
      CashAndCashEquivalents: { label: 'Cash and cash equivalents', units: { DKK: [{ end: '2024-12-31', val: 15_000 * M, ...F24 }] } },
    },
  },
};
