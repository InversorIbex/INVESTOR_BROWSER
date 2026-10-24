/**
 * Synthetic ESEF data in the real filings.xbrl.org formats (JSON:API listings and
 * xBRL-JSON/OIM reports, checked against real responses in Oct 2026).
 * "FIXTURE EUROPA, S.A." does not exist. Traps included on purpose:
 *  - two versions of the FY2025 report (-0 and a corrected -1 processed later);
 *  - FY2024 revenue restated in the FY2025 report;
 *  - a segment fact with an extra dimension (must be ignored), an extension
 *    concept, a text fact and a duplicated fact;
 *  - OIM exclusive period ends ("2026-01-01T00:00:00" = 31 Dec 2025);
 *  - gross debt only as components (non-current + current borrowings).
 */
export const FIXTURE_LEI = '5493FIXTUREESEF00042';
const P = `/${FIXTURE_LEI}`;

export const entitySearch = {
  data: [
    {
      type: 'entity',
      id: '9001',
      attributes: { identifier: FIXTURE_LEI, name: 'FIXTURE EUROPA, S.A.' },
      links: { self: `/api/entities/${FIXTURE_LEI}` },
    },
    { type: 'entity', id: '9002', attributes: { identifier: 'not-a-lei', name: 'Broken' } },
  ],
  meta: { count: 2 },
  jsonapi: { version: '1.0' },
};

function filing(id: string, end: string, idx: number, published: string, processed: string) {
  const base = `${P}/${end}/ESEF/ES/${idx}/${FIXTURE_LEI}-${end}-${idx}-es`;
  return {
    type: 'filing',
    id,
    attributes: {
      period_end: end,
      country: 'ES',
      fxo_id: `${FIXTURE_LEI}-${end}-ESEF-ES-${idx}`,
      date_added: `${processed} 10:00:00.000000`,
      processed: `${processed} 12:00:00.000000`,
      published: `${published} 00:00:00`,
      sha256: 'x',
      viewer_url: `${base}/reports/ixbrlviewer.html`,
      package_url: `${P}/${end}/ESEF/ES/${idx}/${FIXTURE_LEI}-${end}.xbri`,
      report_url: `${base}/reports/${FIXTURE_LEI}-${end}-${idx}-es.xhtml`,
      json_url: `${base}.json`,
      error_count: 0,
      warning_count: 0,
      inconsistency_count: 0,
    },
    relationships: { entity: { links: { related: `/api/entities/${FIXTURE_LEI}` }, data: { type: 'entity', id: '9001' } } },
    links: { self: `/api/filings/${id}` },
  };
}

export const filingsList = {
  data: [
    filing('501', '2025-12-31', 1, '2026-03-02', '2026-10-21'),
    filing('500', '2025-12-31', 0, '2026-02-20', '2026-10-20'),
    filing('400', '2024-12-31', 0, '2025-02-21', '2025-06-01'),
    filing('300', '2023-12-31', 0, '2024-02-23', '2024-05-01'),
  ],
  meta: { count: 4 },
  jsonapi: { version: '1.0' },
};

type Fact = { value: string | number; decimals?: number; dimensions: Record<string, string> };
const E = `scheme:${FIXTURE_LEI}`;
const dur = (y: number) => `${y}-01-01T00:00:00/${y + 1}-01-01T00:00:00`;
const inst = (y: number) => `${y + 1}-01-01T00:00:00`; // end of year y
function f(concept: string, period: string, value: number | string, unit = 'iso4217:EUR', extra: Record<string, string> = {}): Fact {
  return { value: String(value), decimals: -3, dimensions: { concept, entity: E, period, unit, ...extra } };
}

/** One annual report: current year + comparative. `rev` lets each report state its own numbers. */
function report(y: number, nums: { rev: [number, number]; op: [number, number]; ni: [number, number]; cfo: [number, number]; capex: [number, number] }, version = 0) {
  const facts: Record<string, Fact> = {};
  let i = 0;
  const add = (x: Fact) => (facts[`f-${++i}`] = x);
  for (const [k, yy] of [
    [0, y],
    [1, y - 1],
  ] as const) {
    add(f('ifrs-full:Revenue', dur(yy), nums.rev[k]));
    add(f('ifrs-full:ProfitLossFromOperatingActivities', dur(yy), nums.op[k]));
    add(f('ifrs-full:ProfitLossAttributableToOwnersOfParent', dur(yy), nums.ni[k]));
    add(f('ifrs-full:CashFlowsFromUsedInOperatingActivities', dur(yy), nums.cfo[k]));
    add(f('ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', dur(yy), nums.capex[k]));
    add(f('ifrs-full:DepreciationAndAmortisationExpense', dur(yy), 150_000_000 + yy - 2000));
    add(f('ifrs-full:ProfitLossBeforeTax', dur(yy), Math.round(nums.op[k] * 0.95)));
    add(f('ifrs-full:IncomeTaxExpenseContinuingOperations', dur(yy), Math.round(nums.op[k] * 0.95 * 0.25)));
    add(f('ifrs-full:WeightedAverageNumberOfShareOutstandingBasicAndDiluted', dur(yy), 260_000_000, 'xbrli:shares'));
    add(f('ifrs-full:DilutedEarningsLossPerShare', dur(yy), (nums.ni[k] / 260_000_000).toFixed(4), 'iso4217:EUR/xbrli:shares'));
    add(f('ifrs-full:CashAndCashEquivalents', inst(yy), 400_000_000 + (yy - 2020) * 10_000_000));
    add(f('ifrs-full:NoncurrentPortionOfNoncurrentBorrowings', inst(yy), 2_000_000_000));
    add(f('ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings', inst(yy), 300_000_000));
    add(f('ifrs-full:EquityAttributableToOwnersOfParent', inst(yy), 3_000_000_000 + (yy - 2020) * 100_000_000));
    add(f('ifrs-full:Assets', inst(yy), 7_000_000_000));
  }
  // Traps
  add(f('ifrs-full:Revenue', dur(y), 1, 'iso4217:EUR', { 'ifrs-full:SegmentsAxis': 'fix:RetailMember' })); // segment → ignored
  add(f('fix:AdjustedEbitdaAlternativeMeasure', dur(y), 999)); // company extension → ignored
  add({ value: 'Sociedad anónima', dimensions: { concept: 'ifrs-full:LegalFormOfEntity', entity: E, period: dur(y), language: 'es' } }); // text → ignored
  add(f('ifrs-full:Revenue', dur(y), nums.rev[0])); // duplicate of the same fact → kept once
  return {
    documentInfo: {
      documentType: 'https://xbrl.org/2021/xbrl-json',
      features: { 'xbrl:canonicalValues': true },
      namespaces: { 'ifrs-full': 'https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full', iso4217: 'http://www.xbrl.org/2003/iso4217', scheme: 'http://standards.iso.org/iso/17442' },
      taxonomy: [`https://fixture.example/${y}-${version}.xsd`],
    },
    facts,
  };
}

export const reports: Record<string, unknown> = {
  // FY2025, first version: later corrected (operating profit typo)
  [`${P}/2025-12-31/ESEF/ES/0/${FIXTURE_LEI}-2025-12-31-0-es.json`]: report(2025, {
    rev: [1_150_000_000, 1_050_000_000],
    op: [200_000_000, 180_000_000],
    ni: [150_000_000, 120_000_000],
    cfo: [260_000_000, 230_000_000],
    capex: [90_000_000, 80_000_000],
  }),
  // FY2025 corrected version (-1): this is the one to use. FY2024 revenue restated (1,040 → 1,050).
  [`${P}/2025-12-31/ESEF/ES/1/${FIXTURE_LEI}-2025-12-31-1-es.json`]: report(
    2025,
    { rev: [1_150_000_000, 1_050_000_000], op: [210_000_000, 180_000_000], ni: [150_000_000, 120_000_000], cfo: [260_000_000, 230_000_000], capex: [90_000_000, 80_000_000] },
    1,
  ),
  [`${P}/2024-12-31/ESEF/ES/0/${FIXTURE_LEI}-2024-12-31-0-es.json`]: report(2024, {
    rev: [1_040_000_000, 950_000_000],
    op: [180_000_000, 160_000_000],
    ni: [120_000_000, 100_000_000],
    cfo: [230_000_000, 200_000_000],
    capex: [80_000_000, 75_000_000],
  }),
  [`${P}/2023-12-31/ESEF/ES/0/${FIXTURE_LEI}-2023-12-31-0-es.json`]: report(2023, {
    rev: [950_000_000, 900_000_000],
    op: [160_000_000, 150_000_000],
    ni: [100_000_000, 90_000_000],
    cfo: [200_000_000, 190_000_000],
    capex: [75_000_000, 70_000_000],
  }),
};
