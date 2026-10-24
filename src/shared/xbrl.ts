/**
 * Normalisation of SEC XBRL "companyfacts" into annual figures.
 *
 * Verified against real SEC responses (Oct 2026):
 *  - Facts look like {start?, end, val, accn, fy, fp, form, filed, frame?}.
 *  - `fy`/`fp` describe the FILING that reported the value, not the period of the
 *    value: a 10-K for FY2009 also reports FY2008 comparatives tagged fy=2009.
 *    Periods are therefore derived ONLY from the `start`/`end` dates.
 *  - The same period is reported by several filings (original, later comparatives,
 *    amendments). We keep the most recently filed value and flag restatements.
 *
 * Nothing here fills gaps: a metric with no matching concept is simply absent.
 */
import type { MetricId } from './finance';

export interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number | null;
  fp?: string | null;
  form: string;
  filed: string;
  frame?: string;
}

export interface CompanyFacts {
  cik: number | string;
  entityName?: string;
  facts: Record<string, Record<string, { label?: string; description?: string; units: Record<string, XbrlFact[]> }>>;
}

export type Taxonomy = 'us-gaap' | 'ifrs-full';

interface ConceptRule {
  taxonomy: Taxonomy;
  concepts: string[];
  kind: 'duration' | 'instant';
  unit: 'currency' | 'shares' | 'perShare';
}

/** Ordered by preference: the first concept with data for a period wins. */
export const CONCEPT_MAP: Partial<Record<MetricId, ConceptRule[]>> = {
  revenue: [
    {
      taxonomy: 'us-gaap',
      kind: 'duration',
      unit: 'currency',
      concepts: [
        'Revenues',
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'SalesRevenueNet',
        'SalesRevenueGoodsNet',
        'SalesRevenueServicesNet',
      ],
    },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'currency', concepts: ['Revenue', 'RevenueFromContractsWithCustomers'] },
  ],
  gross_profit: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'currency', concepts: ['GrossProfit'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'currency', concepts: ['GrossProfit'] },
  ],
  operating_income: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'currency', concepts: ['OperatingIncomeLoss'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'currency', concepts: ['ProfitLossFromOperatingActivities'] },
  ],
  net_income: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'currency', concepts: ['NetIncomeLoss', 'ProfitLoss'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'currency', concepts: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'] },
  ],
  cfo: [
    {
      taxonomy: 'us-gaap',
      kind: 'duration',
      unit: 'currency',
      concepts: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'currency', concepts: ['CashFlowsFromUsedInOperatingActivities'] },
  ],
  capex: [
    {
      taxonomy: 'us-gaap',
      kind: 'duration',
      unit: 'currency',
      concepts: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
    },
    {
      taxonomy: 'ifrs-full',
      kind: 'duration',
      unit: 'currency',
      concepts: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfPropertyPlantAndEquipment'],
    },
  ],
  cash: [
    { taxonomy: 'us-gaap', kind: 'instant', unit: 'currency', concepts: ['CashAndCashEquivalentsAtCarryingValue', 'Cash'] },
    { taxonomy: 'ifrs-full', kind: 'instant', unit: 'currency', concepts: ['CashAndCashEquivalents'] },
  ],
  gross_debt: [
    // Total debt only when the filer tags it directly. Component sums are derived below.
    { taxonomy: 'us-gaap', kind: 'instant', unit: 'currency', concepts: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount'] },
  ],
  diluted_shares: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'shares', concepts: ['WeightedAverageNumberOfDilutedSharesOutstanding'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'shares', concepts: ['WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'AdjustedWeightedAverageShares'] },
  ],
  eps_diluted: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'perShare', concepts: ['EarningsPerShareDiluted'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'perShare', concepts: ['DilutedEarningsLossPerShare'] },
  ],
  dividend_per_share: [
    { taxonomy: 'us-gaap', kind: 'duration', unit: 'perShare', concepts: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'] },
    { taxonomy: 'ifrs-full', kind: 'duration', unit: 'perShare', concepts: ['DividendsRecognisedAsDistributionsToOwnersPerShare'] },
  ],
};

/** Debt components summed when no total is tagged (leases and commercial paper excluded on purpose). */
const DEBT_COMPONENTS = ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'];

export const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT', '10-KT/A', '20-F', '20-F/A', '40-F', '40-F/A']);

export interface NormalizedFact {
  metric: MetricId;
  period: string; // FY2025
  periodStart: string | null;
  periodEnd: string;
  value: number; // base units
  unit: string; // as in SEC: USD, EUR, shares, USD/shares
  currency: string | null;
  taxonomy: Taxonomy;
  concept: string; // e.g. us-gaap:Revenues, or a formula for derived values
  accn: string;
  form: string;
  filed: string;
  derived: boolean;
  /** When a later filing changed the value for the same period. */
  restatedFrom: { value: number; accn: string; filed: string; form: string } | null;
}

export function padCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, '');
  if (!digits || digits.length > 10) throw new Error('CIK no válido');
  return digits.padStart(10, '0');
}

export function filingIndexUrl(cik: number | string, accn: string): string {
  const c = String(Number(String(cik).replace(/\D/g, '')));
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accn)) throw new Error('Número de registro no válido');
  return `https://www.sec.gov/Archives/edgar/data/${c}/${accn.replace(/-/g, '')}/`;
}

export function filingDocumentUrl(cik: number | string, accn: string, primaryDocument: string): string {
  // Primary document names are plain file names; anything else is rejected.
  if (!/^[\w.\-]{1,200}$/.test(primaryDocument)) return filingIndexUrl(cik, accn);
  return filingIndexUrl(cik, accn) + primaryDocument;
}

const DAY = 86400e3;
function days(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY);
}

/** Annual = a 52/53-week or 12-month period. */
export function isAnnualDuration(start: string | undefined, end: string): boolean {
  if (!start) return false;
  const d = days(start, end);
  return d >= 350 && d <= 380;
}

/**
 * Label a fiscal year by the calendar year in which it ends. Fiscal years ending
 * in the first days of January (52/53-week calendars) belong to the previous year.
 */
export function fiscalYearLabel(end: string): string {
  const d = new Date(end + 'T00:00:00Z');
  let y = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) y -= 1;
  return `FY${y}`;
}

function isCurrencyUnit(u: string): boolean {
  return /^[A-Z]{3}$/.test(u);
}

function pickUnit(units: Record<string, XbrlFact[]>, kind: ConceptRule['unit']): string | null {
  const keys = Object.keys(units).filter((u) =>
    kind === 'currency' ? isCurrencyUnit(u) : kind === 'shares' ? u === 'shares' : /^[A-Z]{3}\/shares$/.test(u),
  );
  if (!keys.length) return null;
  // Prefer the unit with most annual facts (the reporting currency).
  return keys.sort((a, b) => units[b]!.length - units[a]!.length)[0]!;
}

interface Candidate {
  fact: XbrlFact;
  unit: string;
  taxonomy: Taxonomy;
  concept: string;
}

/** For one concept+unit: one value per annual period (latest filing wins; restatements flagged). */
function annualSeries(facts: XbrlFact[], kind: 'duration' | 'instant', annualEnds: Set<string> | null): Map<string, { latest: XbrlFact; original: XbrlFact }> {
  const byEnd = new Map<string, XbrlFact[]>();
  for (const f of facts) {
    if (!ANNUAL_FORMS.has(f.form) || !Number.isFinite(f.val) || !f.end || !f.accn) continue;
    if (kind === 'duration' && !isAnnualDuration(f.start, f.end)) continue;
    if (kind === 'instant' && (f.start || (annualEnds && !annualEnds.has(f.end)))) continue;
    const list = byEnd.get(f.end) ?? [];
    list.push(f);
    byEnd.set(f.end, list);
  }
  const out = new Map<string, { latest: XbrlFact; original: XbrlFact }>();
  for (const [end, list] of byEnd) {
    const sorted = [...list].sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : 0));
    out.set(end, { original: sorted[0]!, latest: sorted[sorted.length - 1]! });
  }
  return out;
}

export interface NormalizeResult {
  facts: NormalizedFact[];
  entityName: string | null;
  taxonomy: Taxonomy | null;
  /** Concepts used per metric, for transparency in the UI. */
  conceptsUsed: Partial<Record<MetricId, string[]>>;
  missing: MetricId[];
}

export function normalizeCompanyFacts(data: CompanyFacts, maxYears = 10): NormalizeResult {
  const taxonomies: Taxonomy[] = (['us-gaap', 'ifrs-full'] as Taxonomy[]).filter((t) => data.facts?.[t]);
  // Use the taxonomy with more concepts (foreign private issuers use ifrs-full).
  const primary = taxonomies.sort((a, b) => Object.keys(data.facts[b] ?? {}).length - Object.keys(data.facts[a] ?? {}).length)[0] ?? null;
  const result: NormalizeResult = { facts: [], entityName: data.entityName ?? null, taxonomy: primary, conceptsUsed: {}, missing: [] };
  if (!primary) return result;
  const tax = data.facts[primary]!;

  // Annual period ends come from duration facts in annual filings (used to pick balance-sheet dates).
  const annualEnds = new Set<string>();
  for (const concept of Object.values(tax))
    for (const facts of Object.values(concept.units ?? {}))
      for (const f of facts) if (ANNUAL_FORMS.has(f.form) && isAnnualDuration(f.start, f.end)) annualEnds.add(f.end);

  const keepEnds = [...annualEnds].sort().slice(-maxYears);
  const keep = new Set(keepEnds);

  for (const [metric, rules] of Object.entries(CONCEPT_MAP) as [MetricId, ConceptRule[]][]) {
    const rule = rules.find((r) => r.taxonomy === primary);
    if (!rule) continue;
    const chosen = new Map<string, Candidate & { original: XbrlFact }>(); // end → candidate
    for (const concept of rule.concepts) {
      const entry = tax[concept];
      if (!entry?.units) continue;
      const unit = pickUnit(entry.units, rule.unit);
      if (!unit) continue;
      const series = annualSeries(entry.units[unit]!, rule.kind, annualEnds);
      for (const [end, { latest, original }] of series) {
        if (!keep.has(end) || chosen.has(end)) continue; // earlier concepts in the list win
        chosen.set(end, { fact: latest, original, unit, taxonomy: primary, concept: `${primary}:${concept}` });
      }
    }
    for (const [end, c] of chosen) result.facts.push(toNormalized(metric, end, c, c.original));
    if (chosen.size) result.conceptsUsed[metric] = [...new Set([...chosen.values()].map((c) => c.concept))];
  }

  // Gross debt from components when the total is not tagged.
  if (primary === 'us-gaap') {
    const have = new Set(result.facts.filter((f) => f.metric === 'gross_debt').map((f) => f.periodEnd));
    const parts = DEBT_COMPONENTS.map((c) => {
      const entry = tax[c];
      const unit = entry ? pickUnit(entry.units, 'currency') : null;
      return entry && unit ? { unit, series: annualSeries(entry.units[unit]!, 'instant', annualEnds) } : null;
    });
    if (parts.every((p) => p) && parts[0]!.unit === parts[1]!.unit) {
      for (const end of keepEnds) {
        if (have.has(end)) continue;
        const a = parts[0]!.series.get(end);
        const b = parts[1]!.series.get(end);
        if (!a || !b) continue;
        result.facts.push({
          metric: 'gross_debt',
          period: fiscalYearLabel(end),
          periodStart: null,
          periodEnd: end,
          value: a.latest.val + b.latest.val,
          unit: parts[0]!.unit,
          currency: parts[0]!.unit,
          taxonomy: 'us-gaap',
          concept: 'us-gaap:LongTermDebtNoncurrent + us-gaap:LongTermDebtCurrent',
          accn: a.latest.accn,
          form: a.latest.form,
          filed: a.latest.filed,
          derived: true,
          restatedFrom: null,
        });
        result.conceptsUsed.gross_debt = [...new Set([...(result.conceptsUsed.gross_debt ?? []), 'us-gaap:LongTermDebtNoncurrent + us-gaap:LongTermDebtCurrent'])];
      }
    }
  }

  result.missing = (Object.keys(CONCEPT_MAP) as MetricId[]).filter((m) => !result.conceptsUsed[m]);
  result.facts.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  return result;
}

function toNormalized(metric: MetricId, end: string, c: Candidate, original: XbrlFact): NormalizedFact {
  const restated =
    original.accn !== c.fact.accn && Math.abs(original.val - c.fact.val) > Math.max(1, Math.abs(original.val) * 0.0005)
      ? { value: original.val, accn: original.accn, filed: original.filed, form: original.form }
      : null;
  return {
    metric,
    period: fiscalYearLabel(end),
    periodStart: c.fact.start ?? null,
    periodEnd: end,
    value: c.fact.val,
    unit: c.unit,
    currency: isCurrencyUnit(c.unit) ? c.unit : /^([A-Z]{3})\/shares$/.exec(c.unit)?.[1] ?? null,
    taxonomy: c.taxonomy,
    concept: c.concept,
    accn: c.fact.accn,
    form: c.fact.form,
    filed: c.fact.filed,
    derived: false,
    restatedFrom: restated,
  };
}

// ---------------------------------------------------------------- tickers & filings

export interface TickerEntry {
  cik: number;
  ticker: string;
  title: string;
}

/** Parse https://www.sec.gov/files/company_tickers.json → {"0":{"cik_str":…,"ticker":…,"title":…},…} */
export function parseTickerFile(json: unknown): TickerEntry[] {
  if (!json || typeof json !== 'object') return [];
  const out: TickerEntry[] = [];
  for (const v of Object.values(json as Record<string, unknown>)) {
    const e = v as { cik_str?: unknown; ticker?: unknown; title?: unknown };
    const cik = Number(e?.cik_str);
    if (!Number.isInteger(cik) || cik <= 0 || typeof e.ticker !== 'string' || typeof e.title !== 'string') continue;
    out.push({ cik, ticker: e.ticker.toUpperCase().slice(0, 12), title: e.title.slice(0, 200) });
  }
  return out;
}

export function searchTickers(entries: TickerEntry[], query: string, limit = 8): TickerEntry[] {
  const q = query.trim().toUpperCase().replace(/^\$/, '');
  if (!q) return [];
  const exact = entries.filter((e) => e.ticker === q);
  const prefix = entries.filter((e) => e.ticker !== q && e.ticker.startsWith(q));
  const name = entries.filter((e) => !e.ticker.startsWith(q) && e.title.toUpperCase().includes(q));
  return [...exact, ...prefix, ...name].slice(0, limit);
}

export interface Filing {
  accn: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string | null;
  description: string | null;
  url: string;
}

export interface SubmissionsInfo {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sicDescription: string | null;
  fiscalYearEnd: string | null; // MMDD
  stateOfIncorporation: string | null;
  filings: Filing[];
}

/** Parse the columnar `filings.recent` arrays of the submissions API defensively. */
export function parseSubmissions(json: unknown, limit = 400): SubmissionsInfo | null {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || !d.cik) return null;
  const cik = String(d.cik);
  const recent = ((d.filings as Record<string, unknown> | undefined)?.recent ?? {}) as Record<string, unknown[]>;
  const col = (k: string) => (Array.isArray(recent[k]) ? recent[k] : []);
  const accns = col('accessionNumber');
  const filings: Filing[] = [];
  for (let i = 0; i < accns.length && filings.length < limit; i++) {
    const accn = String(accns[i] ?? '');
    const form = String(col('form')[i] ?? '');
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accn) || !form) continue;
    const primary = col('primaryDocument')[i] ? String(col('primaryDocument')[i]) : null;
    filings.push({
      accn,
      form: form.slice(0, 20),
      filingDate: String(col('filingDate')[i] ?? ''),
      reportDate: col('reportDate')[i] ? String(col('reportDate')[i]) : null,
      primaryDocument: primary,
      description: col('primaryDocDescription')[i] ? String(col('primaryDocDescription')[i]).slice(0, 200) : null,
      url: primary ? filingDocumentUrl(cik, accn, primary) : filingIndexUrl(cik, accn),
    });
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 200) : null);
  return {
    cik,
    name: str(d.name) ?? '',
    tickers: Array.isArray(d.tickers) ? d.tickers.map(String).slice(0, 10) : [],
    exchanges: Array.isArray(d.exchanges) ? d.exchanges.map(String).slice(0, 10) : [],
    sicDescription: str(d.sicDescription),
    fiscalYearEnd: str(d.fiscalYearEnd),
    stateOfIncorporation: str(d.stateOfIncorporation),
    filings,
  };
}
