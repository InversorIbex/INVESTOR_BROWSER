import { createServer, type Server } from 'node:http';
import type { Hit } from './mockSec';

export const ECB_CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-23,1.0812,A
EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-10-23,0.8421,A
EXR.D.DKK.EUR.SP00.A,D,DKK,EUR,SP00,A,2026-10-23,7.4602,A`;

export const KEYS = { finnhub: 'fh_TESTKEY_123456', eodhd: 'eo.TESTKEY.654321' };

/** Local stand-in for Finnhub, EODHD and the ECB, in their documented formats. */
export function startMockMarket(): Promise<{ server: Server; base: string; hits: (Hit & { token: string | null })[] }> {
  const hits: (Hit & { token: string | null })[] = [];
  const ts = Math.floor(Date.parse('2026-10-23T15:20:00Z') / 1000);
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const headerToken = String(req.headers['x-finnhub-token'] ?? '') || null;
    hits.push({ path: req.url ?? '', ua: String(req.headers['user-agent'] ?? ''), at: Date.now(), token: headerToken ?? u.searchParams.get('api_token') });
    const json = (b: unknown, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(b));
    if (u.pathname === '/api/v1/quote') {
      if (headerToken !== KEYS.finnhub) return json({ error: 'Invalid API key' }, 401);
      const s = u.searchParams.get('symbol');
      return json(s === 'AAPL' ? { c: 231.4, d: 1.2, dp: 0.52, h: 232, l: 229, o: 230, pc: 230.2, t: ts } : { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    }
    if (u.pathname.startsWith('/api/real-time/')) {
      if (u.searchParams.get('api_token') !== KEYS.eodhd) return json({ error: 'Unauthenticated' }, 401);
      const syms = [decodeURIComponent(u.pathname.split('/').pop()!), ...(u.searchParams.get('s')?.split(',').filter(Boolean) ?? [])];
      const rows = syms.map((code) => ({ code, timestamp: ts, gmtoffset: 0, open: 50, high: 51, low: 49, close: code === 'AAPL.US' ? 231.4 : code === 'NOVO-B.CO' ? 402.5 : 51.36, volume: 1000, previousClose: 50.12, change: 1.24, change_p: 2.474 }));
      return json(rows.length === 1 ? rows[0] : rows);
    }
    const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
    if (u.pathname === '/api/v1/calendar/earnings') {
      if (headerToken !== KEYS.finnhub) return json({ error: 'Invalid API key' }, 401);
      return json({ earningsCalendar: [{ date: day(5), epsActual: null, epsEstimate: 1.62, hour: 'amc', quarter: 4, revenueActual: null, revenueEstimate: 1, symbol: 'AAPL', year: 2026 }, { date: day(9), hour: 'bmo', symbol: 'MSFT', quarter: 1, year: 2027 }] });
    }
    if (u.pathname.startsWith('/api/div/')) {
      if (u.searchParams.get('api_token') !== KEYS.eodhd) return json({ error: 'Unauthenticated' }, 401);
      if (!u.pathname.endsWith('ITX.MC')) return json([]);
      return json([-275, -184, -92, 8].map((n) => ({ date: day(n), declarationDate: day(n - 20), recordDate: day(n + 1), paymentDate: day(n + 2), period: 'Quarterly', value: 0.77, unadjustedValue: 0.77, currency: 'EUR' })));
    }
    if (u.pathname.startsWith('/service/data/EXR/')) return res.writeHead(200, { 'Content-Type': 'text/csv' }).end(ECB_CSV);
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, hits });
    }),
  );
}
