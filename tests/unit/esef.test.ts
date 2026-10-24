import { describe, expect, it } from 'vitest';
import {
  countryOf,
  entitySearchPath,
  esefCoverageNote,
  extractOimFacts,
  filingsPath,
  oimDate,
  oimUnit,
  parseEntities,
  parseFilings,
  pickAnnualFilings,
  toCompanyFacts,
} from '../../src/shared/esef';
import { normalizeCompanyFacts } from '../../src/shared/xbrl';
import { entitySearch, filingsList, FIXTURE_LEI, reports } from '../fixtures/esef';

describe('OIM conventions', () => {
  it('treats midnight period ends as exclusive', () => {
    expect(oimDate('2026-01-01T00:00:00', true)).toBe('2025-12-31');
    expect(oimDate('2025-01-01T00:00:00', false)).toBe('2025-01-01');
    expect(oimDate('2024-03-01T00:00:00', true)).toBe('2024-02-29'); // leap year
    expect(oimDate('2025-06-30', false)).toBe('2025-06-30');
    expect(oimDate('garbage', true)).toBeNull();
  });
  it('maps units', () => {
    expect(oimUnit('iso4217:EUR')).toBe('EUR');
    expect(oimUnit('xbrli:shares')).toBe('shares');
    expect(oimUnit('iso4217:DKK/xbrli:shares')).toBe('DKK/shares');
    expect(oimUnit('xbrli:pure')).toBeNull();
    expect(oimUnit(undefined)).toBeNull();
  });
});

describe('filings.xbrl.org listings', () => {
  it('parses entities and drops invalid LEIs', () => {
    expect(parseEntities(entitySearch)).toEqual([{ lei: FIXTURE_LEI, name: 'FIXTURE EUROPA, S.A.' }]);
    expect(parseEntities({ data: { attributes: { identifier: FIXTURE_LEI, name: 'Uno' } } })).toHaveLength(1);
    expect(parseEntities(null)).toEqual([]);
  });

  it('builds safe search paths', () => {
    expect(entitySearchPath(FIXTURE_LEI.toLowerCase())).toBe(`/api/entities/${FIXTURE_LEI}`);
    const p = entitySearchPath('Industria de Diseño "Textil"; DROP')!;
    const filter = JSON.parse(decodeURIComponent(p.split('filter=')[1]!.split('&')[0]!));
    expect(filter).toEqual([{ name: 'name', op: 'ilike', val: '%Industria%de%Diseño%Textil%DROP%' }]);
    expect(entitySearchPath('a')).toBeNull();
    expect(() => filingsPath('../../etc')).toThrow();
  });

  it('parses filings with absolute URLs only on the official host', () => {
    const list = parseFilings(filingsList);
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({
      lei: FIXTURE_LEI,
      country: 'ES',
      periodEnd: '2025-12-31',
      published: '2026-03-02',
      processed: '2026-10-21',
      fxoId: `${FIXTURE_LEI}-2025-12-31-ESEF-ES-1`,
    });
    expect(list[0]!.jsonUrl).toMatch(/^https:\/\/filings\.xbrl\.org\//);
    const evil = parseFilings({ data: [{ id: 'x', attributes: { period_end: '2025-12-31', fxo_id: `${FIXTURE_LEI}-x`, json_url: 'https://evil.example/a.json', viewer_url: '/../x' } }] });
    expect(evil[0]!.jsonUrl).toBeNull();
    expect(evil[0]!.viewerUrl).toBeNull();
  });

  it('keeps one report per year: the latest processed version', () => {
    const picked = pickAnnualFilings(parseFilings(filingsList));
    expect(picked.map((f) => f.fxoId)).toEqual([`${FIXTURE_LEI}-2025-12-31-ESEF-ES-1`, `${FIXTURE_LEI}-2024-12-31-ESEF-ES-0`, `${FIXTURE_LEI}-2023-12-31-ESEF-ES-0`]);
  });
});

describe('xBRL-JSON extraction and normalisation', () => {
  const list = pickAnnualFilings(parseFilings(filingsList));
  const reportsFor = list.map((filing) => ({ filing, facts: extractOimFacts(reports[filing.jsonUrl!.replace('https://filings.xbrl.org', '')]) }));

  it('ignores dimensional, extension, text and duplicated facts', () => {
    const facts = reportsFor[0]!.facts;
    const rev2025 = facts.filter((x) => x.c === 'Revenue' && x.e === '2025-12-31');
    expect(rev2025).toEqual([{ c: 'Revenue', u: 'EUR', s: '2025-01-01', e: '2025-12-31', v: 1_150_000_000 }]);
    expect(facts.some((x) => x.c.includes('Adjusted'))).toBe(false);
    expect(facts.some((x) => x.c === 'LegalFormOfEntity')).toBe(false);
    expect(() => extractOimFacts({})).toThrow();
  });

  it('produces annual figures with provenance, restatements and derived debt', () => {
    const norm = normalizeCompanyFacts(toCompanyFacts(FIXTURE_LEI, 'FIXTURE EUROPA, S.A.', reportsFor), 10);
    expect(norm.taxonomy).toBe('ifrs-full');
    const get = (m: string, p: string) => norm.facts.find((x) => x.metric === m && x.period === p);
    expect(get('revenue', 'FY2025')).toMatchObject({ value: 1_150_000_000, currency: 'EUR', form: 'ESEF', filed: '2026-03-02', concept: 'ifrs-full:Revenue' });
    // Corrected version wins
    expect(get('operating_income', 'FY2025')!.value).toBe(210_000_000);
    // FY2024 restated in the FY2025 report: latest value kept, original remembered
    expect(get('revenue', 'FY2024')).toMatchObject({ value: 1_050_000_000, restatedFrom: { value: 1_040_000_000 } });
    expect(get('revenue', 'FY2022')!.value).toBe(900_000_000);
    expect(get('gross_debt', 'FY2025')).toMatchObject({ value: 2_300_000_000, derived: true });
    expect(get('gross_debt', 'FY2025')!.concept).toContain('NoncurrentPortionOfNoncurrentBorrowings');
    expect(get('cash', 'FY2025')!.value).toBe(450_000_000);
    expect(get('dna', 'FY2025')!.value).toBe(150_000_025);
    expect(get('eps_diluted', 'FY2025')).toMatchObject({ unit: 'EUR/shares', currency: 'EUR' });
    expect(get('diluted_shares', 'FY2025')!.value).toBe(260_000_000);
    // Never invented: no gross profit in these reports
    expect(norm.missing).toContain('gross_profit');
    expect(norm.facts.some((x) => x.metric === 'gross_profit')).toBe(false);
  });
});

describe('coverage', () => {
  it('maps countries and explains gaps', () => {
    expect(countryOf({ exchange: 'BME' })).toBe('ES');
    expect(countryOf({ country: 'Suiza', exchange: '' })).toBe('CH');
    expect(countryOf({ country: 'de' })).toBe('DE');
    expect(esefCoverageNote('DE')).toMatch(/Alemania/);
    expect(esefCoverageNote('CH')).toMatch(/Suiza/);
    expect(esefCoverageNote('ES')).toBeNull();
    expect(esefCoverageNote('US')).toBeNull();
  });
});
