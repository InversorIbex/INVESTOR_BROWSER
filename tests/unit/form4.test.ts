import { describe, expect, it } from 'vitest';
import { parseXml, XmlError } from '../../src/shared/miniXml';
import { ownerRole, parseForm4, rawForm4File, summarizeInsiders, type StoredInsiderTx } from '../../src/shared/form4';
import { form4DirectorBuy, form4FootnotePlan, form4PlanSale } from '../fixtures/sec';

describe('miniXml', () => {
  it('parses elements, attributes, entities, CDATA and namespaces', () => {
    const n = parseXml('<?xml version="1.0"?><!-- c --><a:root x="1 &amp; 2"><b>T &lt;x&gt; &#233;</b><c><![CDATA[<raw>]]></c><d/></a:root>');
    expect(n.name).toBe('root');
    expect(n.attrs.x).toBe('1 & 2');
    expect(n.children.map((c) => c.name)).toEqual(['b', 'c', 'd']);
    expect(n.children[0]!.text).toBe('T <x> é');
    expect(n.children[1]!.text).toBe('<raw>');
  });

  it('never expands custom or external entities (billion laughs, XXE)', () => {
    const evil = `<?xml version="1.0"?>
      <!DOCTYPE r [ <!ENTITY a "aaaaaaaaaa"> <!ENTITY b "&a;&a;&a;&a;&a;&a;"> <!ENTITY x SYSTEM "file:///etc/passwd"> ]>
      <r>&b;&x;</r>`;
    const n = parseXml(evil);
    expect(n.text).toBe('&b;&x;'); // left untouched, nothing fetched or expanded
  });

  it('rejects malformed or oversized documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('<a>')).toThrow(XmlError);
    expect(() => parseXml('')).toThrow(XmlError);
    expect(() => parseXml('<a>' + '<b>'.repeat(100) + '</b>'.repeat(100) + '</a>')).toThrow(/profundo/);
  });
});

describe('Form 4', () => {
  it('parses a 10b5-1 plan sale (checkbox), grant and tax withholding', () => {
    const f = parseForm4(form4PlanSale);
    expect(f).toMatchObject({ documentType: '4', periodOfReport: '2025-08-29', issuerCik: '0001999999', issuerSymbol: 'FXTC' });
    expect(f.owners[0]).toMatchObject({ name: 'Doe Jane', isOfficer: true, officerTitle: 'Chief Executive Officer', isDirector: false });
    expect(ownerRole(f.owners[0]!)).toBe('Chief Executive Officer');
    expect(f.transactions.map((t) => [t.code, t.category, t.shares, t.price, t.plan10b51])).toEqual([
      ['A', 'grant', 5000, 0, false],
      ['F', 'tax', 1800, 45.1, false],
      ['S', 'sell', 3000, 46, true],
    ]);
    expect(f.transactions[2]).toMatchObject({ planSource: 'checkbox', acquiredDisposed: 'D', sharesAfter: 80200, ownership: 'D', footnotes: ['F2'] });
    expect(f.footnotes.F1).toContain('Restricted stock units');
  });

  it('parses a director open-market purchase and decodes entities in names', () => {
    const f = parseForm4(form4DirectorBuy);
    expect(f.owners[0]).toMatchObject({ name: 'Roe Richard & Family Trust', isDirector: true });
    expect(ownerRole(f.owners[0]!)).toBe('Consejero');
    expect(f.transactions[0]).toMatchObject({ code: 'P', category: 'buy', shares: 2000, price: 44, plan10b51: false, date: '2025-10-14' });
  });

  it('detects 10b5-1 from footnotes (older forms) and reads the derivative table', () => {
    const f = parseForm4(form4FootnotePlan);
    expect(f.owners[0]).toMatchObject({ isOfficer: true, officerTitle: 'Chief Financial Officer' });
    const sale = f.transactions.find((t) => t.code === 'S')!;
    expect(sale).toMatchObject({ plan10b51: true, planSource: 'footnote' });
    expect(f.transactions.find((t) => t.code === 'M' && t.table === 'nonDerivative')!.category).toBe('exercise');
    expect(f.transactions.find((t) => t.table === 'derivative')).toMatchObject({ security: 'Stock Option (right to buy)', acquiredDisposed: 'D' });
  });

  it('rejects documents that are not ownership forms', () => {
    expect(() => parseForm4('<html><body>no</body></html>')).toThrow(/propiedad/);
  });

  it('derives the raw XML file name safely', () => {
    expect(rawForm4File('xslF345X05/wk-form4_1756.xml')).toBe('wk-form4_1756.xml');
    expect(rawForm4File('doc4.xml')).toBe('doc4.xml');
    expect(rawForm4File('xslF345X05/../../evil.xml')).toBe('evil.xml');
    expect(rawForm4File('form4.htm')).toBeNull();
    expect(rawForm4File(null)).toBeNull();
  });
});

describe('insider summary', () => {
  const tx = (o: Partial<StoredInsiderTx>): StoredInsiderTx => ({
    accn: 'x',
    filed: '2025-10-01',
    ownerName: 'A',
    role: '',
    date: '2025-10-01',
    code: 'S',
    category: 'sell',
    table: 'nonDerivative',
    shares: 100,
    price: 10,
    plan10b51: false,
    ...o,
  });

  it('separates discretionary from planned and non-market transactions', () => {
    const s = summarizeInsiders(
      [
        tx({ ownerName: 'A', code: 'P', category: 'buy', shares: 1000, price: 20 }),
        tx({ ownerName: 'B', code: 'P', category: 'buy', shares: 500, price: 21 }),
        tx({ ownerName: 'C', code: 'P', category: 'buy', shares: 100, price: 22 }),
        tx({ ownerName: 'D', code: 'S', plan10b51: true, shares: 300, price: 30 }),
        tx({ ownerName: 'E', code: 'S', shares: 200, price: 30 }),
        tx({ code: 'F', category: 'tax', shares: 50, price: 30 }),
        tx({ code: 'A', category: 'grant', shares: 400, price: 0 }),
        tx({ code: 'S', date: '2024-01-01' }), // outside the 12-month window
        tx({ code: 'M', category: 'exercise', table: 'derivative' }), // derivative rows are not counted twice
      ],
      '2025-10-24',
    );
    expect(s.since).toBe('2024-10-24');
    expect(s.buys).toEqual({ count: 3, insiders: 3, value: 20000 + 10500 + 2200 });
    expect(s.discretionarySells).toEqual({ count: 1, insiders: 1, value: 6000 });
    expect(s.planSells).toEqual({ count: 1, value: 9000 });
    expect(s.taxWithholding).toEqual({ count: 1, shares: 50 });
    expect(s.grants).toEqual({ count: 1, shares: 400 });
    expect(s.exercises.count).toBe(0);
    expect(s.notes[0]).toContain('3 insiders distintos');
  });
});
