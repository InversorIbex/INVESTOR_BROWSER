import { createServer, type Server } from 'node:http';
import { entitySearch, filingsList, FIXTURE_LEI, reports } from '../fixtures/esef';
import type { Hit } from './mockSec';

/** Local stand-in for filings.xbrl.org serving responses in the real formats. */
export function startMockEsef(): Promise<{ server: Server; base: string; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const path = url.split('?')[0]!;
    hits.push({ path: url, ua: String(req.headers['user-agent'] ?? ''), at: Date.now() });
    let body: unknown = null;
    if (path === '/api/entities' && decodeURIComponent(url).toLowerCase().includes('fixture')) body = entitySearch;
    else if (path === '/api/entities') body = { data: [], meta: { count: 0 } };
    else if (path === `/api/entities/${FIXTURE_LEI}/filings`) body = filingsList;
    else body = reports[path] ?? null;
    if (body === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, hits });
    }),
  );
}
