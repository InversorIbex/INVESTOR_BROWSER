import { describe, expect, it } from 'vitest';
import { convert, exchangeCurrency, normalizeQuoteCurrency, parseEcbCsv, parseEodhdQuotes, parseFinnhubQuote, providerSymbol } from '../../src/shared/market';
import { MarketService } from '../../src/main/market';
import { Secrets, type Cipher } from '../../src/main/secrets';

export const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-23,1.0812,A
EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-10-23,0.8421,A
EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-10-23,0.9377,A
EXR.D.DKK.EUR.SP00.A,D,DKK,EUR,SP00,A,2026-10-23,7.4602,A`;

describe('symbols and currencies', () => {
  it('maps exchanges to provider symbols', () => {
    expect(providerSymbol({ ticker: 'AAPL', exchange: 'NASDAQ' }, 'finnhub')).toBe('AAPL');
    expect(providerSymbol({ ticker: 'BRK.B', exchange: 'NYSE' }, 'finnhub')).toBe('BRK.B');
    expect(providerSymbol({ ticker: 'BRK.B', exchange: 'NYSE' }, 'eodhd')).toBe('BRK-B.US');
    expect(providerSymbol({ ticker: 'ITX', exchange: 'BME' }, 'finnhub')).toBeNull();
    expect(providerSymbol({ ticker: 'ITX', exchange: 'BME' }, 'eodhd')).toBe('ITX.MC');
    expect(providerSymbol({ ticker: 'NESN', exchange: 'SWX' }, 'eodhd')).toBe('NESN.SW');
    expect(providerSymbol({ ticker: 'X', exchange: 'UNKNOWN' }, 'eodhd')).toBeNull();
    // Overrides (EODHD style) win; a 1-letter suffix is a share class, not an exchange
    expect(providerSymbol({ ticker: 'NOVO B', exchange: 'CPH', quoteSymbol: 'novo-b.co' }, 'eodhd')).toBe('NOVO-B.CO');
    expect(providerSymbol({ ticker: 'NOVO B', exchange: 'CPH', quoteSymbol: 'NOVO-B.CO' }, 'finnhub')).toBeNull();
    expect(providerSymbol({ ticker: null, exchange: '', quoteSymbol: 'MSFT' }, 'finnhub')).toBe('MSFT');
    expect(providerSymbol({ ticker: null, exchange: '', quoteSymbol: 'MSFT' }, 'eodhd')).toBe('MSFT.US');
    expect(providerSymbol({ ticker: null, exchange: '', quoteSymbol: '../evil' }, 'eodhd')).toBeNull();
  });
  it('knows quote currencies and converts pence', () => {
    expect(exchangeCurrency('LON')).toBe('GBX');
    expect(exchangeCurrency('', 'DGE.LSE')).toBe('GBX');
    expect(exchangeCurrency('', 'NESN.SW')).toBe('CHF');
    expect(normalizeQuoteCurrency(2450, 'GBX')).toEqual({ price: 24.5, currency: 'GBP' });
    expect(normalizeQuoteCurrency(10, 'EUR')).toEqual({ price: 10, currency: 'EUR' });
  });
});

describe('provider responses', () => {
  it('Finnhub: unknown symbols come back as zeros → null, never 0', () => {
    expect(parseFinnhubQuote('AAPL', { c: 231.4, d: 1.2, dp: 0.52, h: 232, l: 229, o: 230, pc: 230.2, t: 1792800000 })).toEqual({
      symbol: 'AAPL',
      price: 231.4,
      prevClose: 230.2,
      changePct: 0.52,
      asOf: 1792800000000,
    });
    expect(parseFinnhubQuote('ZZZZ', { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 })).toBeNull();
  });
  it('EODHD: single, multiple and "NA" answers', () => {
    const one = { code: 'ITX.MC', timestamp: 1792800000, gmtoffset: 0, open: 50, high: 51, low: 49, close: 50.5, volume: 1, previousClose: 50, change: 0.5, change_p: 1 };
    expect(parseEodhdQuotes(one)).toHaveLength(1);
    expect(parseEodhdQuotes([one, { ...one, code: 'BAD.MC', close: 'NA', timestamp: 'NA' }])).toHaveLength(1);
  });
  it('ECB CSV → units per euro, and cross conversion', () => {
    const fx = parseEcbCsv(ECB_CSV)!;
    expect(fx.date).toBe('2026-10-23');
    expect(fx.perEur.USD).toBe(1.0812);
    expect(convert(100, 'EUR', 'USD', fx)).toBeCloseTo(108.12, 6);
    expect(convert(108.12, 'USD', 'EUR', fx)).toBeCloseTo(100, 6);
    expect(convert(74.602, 'DKK', 'USD', fx)).toBeCloseTo(10.812, 6);
    expect(convert(2450, 'GBX', 'GBP', fx)).toBeCloseTo(24.5, 9);
    expect(convert(10, 'USD', 'JPY', fx)).toBeNull(); // missing rate → null, never guessed
    expect(convert(10, 'USD', 'USD', null)).toBe(10);
    expect(parseEcbCsv('nonsense')).toBeNull();
  });
});

function memoryKv() {
  const m = new Map<string, unknown>();
  return { getJson: <T,>(k: string) => (m.has(k) ? (m.get(k) as T) : null), setJson: (k: string, v: unknown) => void m.set(k, v), m };
}
const fakeCipher = (backend = 'dpapi'): Cipher => ({
  isEncryptionAvailable: () => true,
  backend: () => backend,
  encryptString: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decryptString: (b) => [...b.toString('utf8')].reverse().join(''),
});

describe('Secrets', () => {
  it('stores only ciphertext and never returns the key to callers other than main', () => {
    const kv = memoryKv();
    const s = new Secrets(kv, fakeCipher());
    s.set('finnhub', 'abcd1234efgh');
    expect(JSON.stringify([...kv.m.values()])).not.toContain('abcd1234efgh');
    expect(s.describe('finnhub')).toEqual({ configured: true, last4: 'efgh', readable: true });
    expect(new Secrets(kv, fakeCipher()).get('finnhub')).toBe('abcd1234efgh');
    s.delete('finnhub');
    expect(s.describe('finnhub').configured).toBe(false);
  });
  it('refuses weak storage (Linux without keyring) and malformed keys', () => {
    expect(() => new Secrets(memoryKv(), fakeCipher('basic_text')).set('eodhd', 'abcd1234efgh')).toThrow(/almacén seguro/);
    expect(() => new Secrets(memoryKv(), fakeCipher()).set('eodhd', 'short')).toThrow();
    expect(() => new Secrets(memoryKv(), fakeCipher()).set('eodhd', 'abc def ghi jkl')).toThrow();
  });
});

describe('MarketService', () => {
  function setup(opts: { limit?: number; eodhdStatus?: number } = {}) {
    const kv = memoryKv();
    const secrets = new Secrets(kv, fakeCipher());
    secrets.set('finnhub', 'FINNHUBKEY123');
    secrets.set('eodhd', 'EODHDKEY12345');
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const ok = (body: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const svc = new MarketService({
      appVersion: '1.0.0',
      kv,
      secrets,
      eodhdDailyLimit: () => opts.limit ?? 20,
      cache: { get: () => null, set: () => undefined },
      now: () => Date.parse('2026-10-24T10:00:00Z'),
      fetch: {
        finnhub: async (url, init) => {
          calls.push({ url, headers: init.headers });
          const sym = new URL(url).searchParams.get('symbol');
          return ok(sym === 'AAPL' ? { c: 231.4, d: 1, dp: 0.5, h: 0, l: 0, o: 0, pc: 230, t: 1792800000 } : { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
        },
        eodhd: async (url, init) => {
          calls.push({ url, headers: init.headers });
          if (opts.eodhdStatus) return ok('You exceeded your daily API requests limit', opts.eodhdStatus);
          const u = new URL(url);
          const syms = [decodeURIComponent(u.pathname.split('/').pop()!), ...(u.searchParams.get('s')?.split(',') ?? [])];
          return ok(syms.map((code) => ({ code, timestamp: 1792800000, close: code === 'DGE.LSE' ? 2450 : 50, previousClose: 49, change_p: 2 })));
        },
        ecb: async () => ok(ECB_CSV),
      },
    });
    return { svc, calls, kv };
  }
  const t = (companyId: number, ticker: string, exchange: string, quoteSymbol: string | null = null) => ({ companyId, ticker, exchange, quoteSymbol, priceFetchedAt: null });

  it('uses Finnhub for US shares (key in a header) and EODHD for the rest, in one batch', async () => {
    const { svc, calls } = setup();
    const r = await svc.refresh([t(1, 'AAPL', 'NASDAQ'), t(2, 'ITX', 'BME'), t(3, 'DGE', 'LON'), t(4, 'ZZZZ', 'NYSE')]);
    const byId = new Map(r.map((x) => [x.companyId, x]));
    expect(byId.get(1)).toMatchObject({ ok: true, provider: 'finnhub', price: 231.4, currency: 'USD' });
    expect(byId.get(2)).toMatchObject({ ok: true, provider: 'eodhd', symbol: 'ITX.MC', price: 50, currency: 'EUR' });
    expect(byId.get(3)).toMatchObject({ ok: true, price: 24.5, currency: 'GBP' }); // pence → pounds
    expect(byId.get(4)).toMatchObject({ ok: true, provider: 'eodhd', symbol: 'ZZZZ.US' }); // not on Finnhub → EODHD
    const fh = calls.filter((c) => c.url.includes('finnhub') || c.url.includes('/api/v1/'));
    for (const c of fh) {
      expect(c.url).not.toContain('FINNHUBKEY123');
      expect(c.headers['X-Finnhub-Token']).toBe('FINNHUBKEY123');
    }
    expect(calls.filter((c) => c.url.includes('/api/real-time/'))).toHaveLength(1);
    expect(svc.quotaUsed()).toBe(3);
  });

  it('never goes over the daily EODHD quota and says so', async () => {
    const { svc, calls } = setup({ limit: 2 });
    const r = await svc.refresh([t(1, 'ITX', 'BME'), t(2, 'SAN', 'BME'), t(3, 'IBE', 'BME')]);
    expect(r.filter((x) => x.ok)).toHaveLength(2);
    expect(r.find((x) => !x.ok)!.error).toMatch(/Cupo diario/);
    expect(svc.quotaLeft()).toBe(0);
    const again = await svc.refresh([t(4, 'REP', 'BME')]);
    expect(again[0]!.ok).toBe(false);
    expect(calls.filter((c) => c.url.includes('/api/real-time/'))).toHaveLength(1);
  });

  it('a provider "limit exceeded" answer exhausts the local quota', async () => {
    const { svc } = setup({ eodhdStatus: 402 });
    const r = await svc.refresh([t(1, 'ITX', 'BME')]);
    expect(r[0]).toMatchObject({ ok: false });
    expect(svc.quotaLeft()).toBe(0);
  });

  it('skips prices fetched less than 15 minutes ago unless forced', async () => {
    const { svc, calls } = setup();
    const fresh = { ...t(1, 'AAPL', 'NASDAQ'), priceFetchedAt: Date.parse('2026-10-24T09:50:00Z') };
    expect(await svc.refresh([fresh])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await svc.refresh([fresh], true))[0]!.ok).toBe(true);
  });

  it('reads ECB reference rates', async () => {
    const { svc } = setup();
    const r = await svc.fxRates();
    expect(r.rates.perEur.CHF).toBe(0.9377);
  });
});
