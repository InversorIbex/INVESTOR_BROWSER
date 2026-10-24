import { describe, expect, it } from 'vitest';
import { EsefClient } from '../../src/main/esef';
import { ProviderError } from '../../src/main/http';
import { parseFilings, pickAnnualFilings } from '../../src/shared/esef';
import { entitySearch, filingsList, FIXTURE_LEI, reports } from '../fixtures/esef';

function setup(contact = 'Ana Pérez ana@example.com') {
  const calls: { url: string; ua: string }[] = [];
  const cache = new Map<string, { body: string; fetchedAt: number }>();
  const client = new EsefClient({
    contact: () => contact,
    appVersion: '9.9.9',
    cache: { get: (k) => cache.get(k) ?? null, set: (k, body, fetchedAt) => cache.set(k, { body, fetchedAt }) },
    fetch: async (url, init) => {
      calls.push({ url, ua: init.headers['User-Agent']! });
      const path = url.replace('https://filings.xbrl.org', '');
      let body: unknown = null;
      if (path.startsWith('/api/entities?')) body = entitySearch;
      else if (path.startsWith(`/api/entities/${FIXTURE_LEI}/filings`)) body = filingsList;
      else body = reports[path] ?? null;
      return { status: body ? 200 : 404, headers: { get: () => null }, text: async () => JSON.stringify(body) };
    },
  });
  return { client, calls, cache };
}

describe('EsefClient', () => {
  it('sends nothing without a declared contact', async () => {
    const { client, calls } = setup('');
    await expect(client.search('Fixture')).rejects.toMatchObject({ code: 'no-contact' });
    expect(calls).toHaveLength(0);
  });

  it('identifies itself with the contact (ASCII) and uses only the official host', async () => {
    const { client, calls } = setup();
    expect(await client.search('Fixture Europa')).toEqual([{ lei: FIXTURE_LEI, name: 'FIXTURE EUROPA, S.A.' }]);
    expect(calls[0]!.url).toMatch(/^https:\/\/filings\.xbrl\.org\/api\/entities\?filter=/);
    expect(calls[0]!.ua).toBe('InvestorBrowser/9.9.9 Ana Perez ana@example.com');
  });

  it('downloads each report once and keeps only the compact extract', async () => {
    const { client, calls, cache } = setup();
    const list = await client.filings(FIXTURE_LEI);
    const [latest] = pickAnnualFilings(list.data);
    const a = await client.reportFacts(latest!);
    const b = await client.reportFacts(latest!);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(a.facts.length).toBeGreaterThan(20);
    expect(calls.filter((c) => c.url.endsWith('.json') && !c.url.includes('/api/'))).toHaveLength(1);
    const stored = cache.get(`esef:facts:${latest!.fxoId}`)!.body;
    expect(stored.length).toBeLessThan(JSON.stringify(reports[latest!.jsonUrl!.slice('https://filings.xbrl.org'.length)]).length);
  });

  it('refuses report URLs outside filings.xbrl.org', async () => {
    const { client, calls } = setup();
    const [f] = parseFilings(filingsList);
    await expect(client.reportFacts({ ...f!, fxoId: 'other', jsonUrl: 'https://evil.example/r.json' })).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });
});
