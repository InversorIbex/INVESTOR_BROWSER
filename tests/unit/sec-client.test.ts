import { describe, expect, it } from 'vitest';
import { isValidContact, resolveBaseUrls, SecClient, SecError, type HttpFetch } from '../../src/main/sec';

function memCache() {
  const m = new Map<string, { body: string; fetchedAt: number }>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, body: string, fetchedAt: number) => void m.set(k, { body, fetchedAt }), m };
}

function stub(responder: (url: string) => { status: number; body: string }) {
  const calls: { url: string; ua: string; at: number }[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, ua: init.headers['User-Agent']!, at: Date.now() });
    const r = responder(url);
    return { status: r.status, text: async () => r.body, headers: { get: () => null } };
  };
  return { fetch, calls };
}

const ok = () => ({ status: 200, body: '{"ok":true}' });

describe('SecClient', () => {
  it('never contacts the SEC without a valid contact', async () => {
    const s = stub(ok);
    const c = new SecClient({ fetch: s.fetch, cache: memCache(), contact: () => '', appVersion: '0.3.0' });
    await expect(c.tickers()).rejects.toMatchObject({ code: 'no-contact' });
    expect(s.calls).toHaveLength(0);
  });

  it('identifies itself with the user contact and uses the official hosts', async () => {
    const s = stub(ok);
    const c = new SecClient({ fetch: s.fetch, cache: memCache(), contact: () => 'Ana Pérez ana@example.com', appVersion: '0.3.0' });
    await c.companyFacts(320193);
    await c.submissions('320193');
    expect(s.calls.map((x) => x.url)).toEqual([
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
      'https://data.sec.gov/submissions/CIK0000320193.json',
    ]);
    expect(s.calls[0]!.ua).toBe('InvestorBrowser/0.3.0 Ana Perez ana@example.com'); // accents transliterated for the HTTP header
  });

  it('stays under 10 requests per second', async () => {
    const s = stub(ok);
    const c = new SecClient({ fetch: s.fetch, cache: memCache(), contact: () => 'A B a@b.co', appVersion: '1', minIntervalMs: 125 });
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => c.submissions(n, true)));
    const gaps = s.calls.slice(1).map((x, i) => x.at - s.calls[i]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(115);
  });

  it('caches by TTL and serves stale data only when the SEC is unreachable', async () => {
    let fail = false;
    let now = 1_000_000;
    const s = stub(() => (fail ? { status: 503, body: '' } : ok()));
    const cache = memCache();
    const c = new SecClient({ fetch: s.fetch, cache, contact: () => 'A B a@b.co', appVersion: '1', now: () => now, minIntervalMs: 0 });
    expect((await c.tickers()).fromCache).toBe(false);
    expect((await c.tickers()).fromCache).toBe(true);
    expect(s.calls).toHaveLength(1);
    now += 8 * 86400e3; // past TTL
    fail = true;
    const r = await c.tickers();
    expect(r).toMatchObject({ fromCache: true, stale: true, fetchedAt: 1_000_000 });
  });

  it('maps HTTP errors to clear messages', async () => {
    for (const [status, code] of [
      [403, 'forbidden'],
      [404, 'not-found'],
      [429, 'rate-limited'],
      [500, 'network'],
    ] as const) {
      const c = new SecClient({ fetch: stub(() => ({ status, body: '' })).fetch, cache: memCache(), contact: () => 'A B a@b.co', appVersion: '1', minIntervalMs: 0 });
      await expect(c.tickers()).rejects.toBeInstanceOf(SecError);
      await expect(c.tickers(true)).rejects.toMatchObject({ code });
    }
  });

  it('rejects non-JSON and oversized responses', async () => {
    const c1 = new SecClient({ fetch: stub(() => ({ status: 200, body: '<html>' })).fetch, cache: memCache(), contact: () => 'A B a@b.co', appVersion: '1', minIntervalMs: 0 });
    await expect(c1.tickers()).rejects.toMatchObject({ code: 'bad-data' });
    const c2 = new SecClient({ fetch: stub(() => ({ status: 200, body: 'x'.repeat(100) })).fetch, cache: memCache(), contact: () => 'A B a@b.co', appVersion: '1', minIntervalMs: 0, maxBytes: 10 });
    await expect(c2.tickers()).rejects.toMatchObject({ code: 'too-large' });
  });

  it('only a loopback server can replace the SEC hosts', () => {
    expect(resolveBaseUrls('http://127.0.0.1:5555')).toEqual({ www: 'http://127.0.0.1:5555', data: 'http://127.0.0.1:5555' });
    expect(resolveBaseUrls('https://evil.example')).toEqual({ www: 'https://www.sec.gov', data: 'https://data.sec.gov' });
    expect(resolveBaseUrls('http://127.0.0.1:5555@evil.com')).toEqual({ www: 'https://www.sec.gov', data: 'https://data.sec.gov' });
  });

  it('validates contacts', () => {
    expect(isValidContact('Ana Pérez ana@example.com')).toBe(true);
    expect(isValidContact('ana@example.com')).toBe(false); // the SEC asks for a name too
    expect(isValidContact('Ana\nX ana@example.com')).toBe(false);
  });
});
