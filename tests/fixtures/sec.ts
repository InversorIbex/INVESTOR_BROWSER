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
      // Receivables grow much faster than revenue in FY2025 (+40% vs +17%): a forensic signal.
      AccountsReceivableNetCurrent: {
        label: 'Accounts Receivable, after Allowance for Credit Loss, Current',
        units: { USD: [inst('2023-06-30', 120 * M, K23), inst('2024-06-30', 150 * M, K24), inst('2025-06-30', 210 * M, K25)] },
      },
      InventoryNet: { label: 'Inventory, Net', units: { USD: [inst('2023-06-30', 50 * M, K23), inst('2024-06-30', 56 * M, K24), inst('2025-06-30', 64 * M, K25)] } },
      Assets: { label: 'Assets', units: { USD: [inst('2023-06-30', 1500 * M, K23), inst('2024-06-30', 1650 * M, K24), inst('2025-06-30', 1800 * M, K25)] } },
      StockholdersEquity: { label: "Stockholders' Equity", units: { USD: [inst('2023-06-30', 900 * M, K23), inst('2024-06-30', 950 * M, K24), inst('2025-06-30', 1000 * M, K25)] } },
      ShareBasedCompensation: { label: 'Share-based Payment Arrangement, Noncash Expense', units: { USD: [dur(FY23, 30 * M, K23), dur(FY24, 40 * M, K24), dur(FY25, 55 * M, K25)] } },
      IncomeTaxExpenseBenefit: { label: 'Income Tax Expense (Benefit)', units: { USD: [dur(FY23, 45 * M, K23), dur(FY24, 52 * M, K24), dur(FY25, 66 * M, K25)] } },
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: {
        label: 'Income (Loss) from Continuing Operations before Income Taxes',
        units: { USD: [dur(FY23, 225 * M, K23), dur(FY24, 257 * M, K24), dur(FY25, 328 * M, K25)] },
      },
      EarningsPerShareDiluted: { label: 'Earnings Per Share, Diluted', units: { 'USD/shares': [dur(FY23, 1.18, K23), dur(FY24, 1.36, K24), dur(FY25, 1.75, K25)] } },
      CommonStockDividendsPerShareDeclared: { label: 'Common Stock, Dividends, Per Share, Declared', units: { 'USD/shares': [dur(FY24, 0.4, K24), dur(FY25, 0.48, K25)] } },
    },
  },
};

const recent = [
  { accessionNumber: Q1.accn, filingDate: Q1.filed, reportDate: '2025-09-30', form: '10-Q', primaryDocument: 'fxtc-20250930.htm', primaryDocDescription: '10-Q' },
  { accessionNumber: '0001999999-25-000022', filingDate: '2025-10-20', reportDate: '2025-10-17', form: '4', primaryDocument: 'xslF345X05/doc4.xml', primaryDocDescription: 'FORM 4' },
  { accessionNumber: '0001999999-25-000021', filingDate: '2025-10-16', reportDate: '2025-10-14', form: '4', primaryDocument: 'xslF345X05/form4-roe.xml', primaryDocDescription: 'FORM 4' },
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

// ---------------------------------------------------------------- Form 4 (synthetic, real element structure)
const owner = (name: string, cik: string, rel: string) => `
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>${name}</rptOwnerName></reportingOwnerId>
    <reportingOwnerAddress><rptOwnerStreet1>1 FIXTURE WAY</rptOwnerStreet1><rptOwnerCity>DOVER</rptOwnerCity><rptOwnerState>DE</rptOwnerState></reportingOwnerAddress>
    <reportingOwnerRelationship>${rel}</reportingOwnerRelationship>
  </reportingOwner>`;
const ndt = (date: string, code: string, shares: number, price: number | null, ad: 'A' | 'D', after: number, fn = '') => `
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>${date}</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${shares}</value>${fn}</transactionShares>
        <transactionPricePerShare>${price === null ? '<footnoteId id="F9"/>' : `<value>${price}</value>`}</transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>`;
const doc = (period: string, owners: string, plan: string, rows: string, deriv: string, notes: string) => `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>${period}</periodOfReport>
  <issuer><issuerCik>0001999999</issuerCik><issuerName>FIXTURE TEST CORP</issuerName><issuerTradingSymbol>FXTC</issuerTradingSymbol></issuer>
  ${owners}
  ${plan}
  <nonDerivativeTable>${rows}
  </nonDerivativeTable>
  <derivativeTable>${deriv}</derivativeTable>
  <footnotes>${notes}</footnotes>
  <ownerSignature><signatureName>/s/ Attorney-in-fact</signatureName><signatureDate>${period}</signatureDate></ownerSignature>
</ownershipDocument>`;

/** CEO: RSU grant, shares withheld for taxes, sale under a 10b5-1 plan (checkbox). */
export const form4PlanSale = doc(
  '2025-08-29',
  owner('Doe Jane', '0001900001', '<isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle>'),
  '<aff10b5One>1</aff10b5One>',
  ndt('2025-08-29', 'A', 5000, 0, 'A', 85000, '<footnoteId id="F1"/>') + ndt('2025-08-29', 'F', 1800, 45.1, 'D', 83200) + ndt('2025-08-30', 'S', 3000, 46, 'D', 80200, '<footnoteId id="F2"/>'),
  '',
  '<footnote id="F1">Restricted stock units vest ratably over 3 years.</footnote><footnote id="F2">Sale effected under a Rule 10b5-1 trading plan adopted on March 3, 2025.</footnote>',
);

/** Director: discretionary open-market purchase. Name contains an XML entity. */
export const form4DirectorBuy = doc(
  '2025-10-14',
  owner('Roe Richard &amp; Family Trust', '0001900002', '<isDirector>1</isDirector>'),
  '<aff10b5One>0</aff10b5One>',
  ndt('2025-10-14', 'P', 2000, 44, 'A', 12000),
  '',
  '',
);

/** CFO (older style): 10b5-1 only in a footnote; option exercise in the derivative table. */
export const form4FootnotePlan = doc(
  '2025-10-17',
  owner('Poe Alex', '0001900003', '<isOfficer>true</isOfficer><officerTitle>Chief Financial Officer</officerTitle>'),
  '',
  ndt('2025-10-17', 'M', 4000, 20, 'A', 30000) + ndt('2025-10-17', 'S', 1500, 47.5, 'D', 28500, '<footnoteId id="F1"/>'),
  `<derivativeTransaction>
      <securityTitle><value>Stock Option (right to buy)</value></securityTitle>
      <conversionOrExercisePrice><value>20</value></conversionOrExercisePrice>
      <transactionDate><value>2025-10-17</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>4000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>16000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </derivativeTransaction>`,
  '<footnote id="F1">The sales reported were effected pursuant to a Rule 10b5-1 trading plan.</footnote>',
);

export const form4Files: Record<string, string> = {
  '000199999925000018/wk-form4.xml': form4PlanSale,
  '000199999925000021/form4-roe.xml': form4DirectorBuy,
  '000199999925000022/doc4.xml': form4FootnotePlan,
};
