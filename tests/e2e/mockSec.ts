import { createServer, type Server } from 'node:http';
import { companyFacts, companyTickers, FIXTURE_CIK_PADDED, form4Files, submissions } from '../fixtures/sec';

export interface Hit {
  path: string;
  ua: string;
  at: number;
}

/** Local stand-in for www.sec.gov + data.sec.gov serving responses in the real formats. */
export function startMockSec(): Promise<{ server: Server; base: string; hits: Hit[] }> {
  const hits: Hit[] = [];
  const routes: Record<string, { type: string; body: string }> = {
    '/files/company_tickers.json': { type: 'application/json', body: JSON.stringify(companyTickers) },
    [`/submissions/CIK${FIXTURE_CIK_PADDED}.json`]: { type: 'application/json', body: JSON.stringify(submissions) },
    [`/api/xbrl/companyfacts/CIK${FIXTURE_CIK_PADDED}.json`]: { type: 'application/json', body: JSON.stringify(companyFacts) },
  };
  for (const [p, xml] of Object.entries(form4Files)) routes[`/Archives/edgar/data/1999999/${p}`] = { type: 'application/xml', body: xml };
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]!;
    hits.push({ path, ua: String(req.headers['user-agent'] ?? ''), at: Date.now() });
    // The real SEC rejects requests without a declared contact.
    if (!/@/.test(String(req.headers['user-agent'] ?? ''))) {
      res.writeHead(403).end('Undeclared Automated Tool');
      return;
    }
    const r = routes[path];
    if (!r) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': r.type }).end(r.body);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, hits });
    }),
  );
}
