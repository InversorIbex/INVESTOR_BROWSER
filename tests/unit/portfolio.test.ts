import { describe, expect, it } from 'vitest';
import { fifo, impliedFx, parseDate, parseNumber, parseOpsCsv, valuePosition, type PortfolioOp } from '../../src/shared/portfolio';

const op = (o: Partial<PortfolioOp>): PortfolioOp => ({ companyId: 1, date: '2025-01-01', side: 'buy', qty: 10, price: 10, currency: 'EUR', feeEur: 0, fxPerEur: 1, ...o });

describe('FIFO (checked by hand)', () => {
  it('average cost includes fees; sales consume the oldest lots', () => {
    const p = fifo([
      op({ date: '2024-01-10', qty: 100, price: 10, feeEur: 10 }), // 10.10/acc
      op({ date: '2024-06-10', qty: 100, price: 20, feeEur: 10 }), // 20.10/acc
      op({ date: '2025-03-01', side: 'sell', qty: 150, price: 30, feeEur: 15 }),
    ]);
    // Sale: proceeds 4500 − 15 = 4485; cost FIFO = 100·10.10 + 50·20.10 = 2015 → gain 2470
    expect(p.realizedTotal).toBeCloseTo(2470, 6);
    expect(p.realizedByYear['2025']).toBeCloseTo(2470, 6);
    expect(p.shares).toBe(50);
    expect(p.avgCost).toBeCloseTo(20.1, 9);
    expect(p.costEur).toBeCloseTo(1005, 6);
    expect(p.warning).toBeNull();
  });

  it('orders by date regardless of entry order and flags oversold positions', () => {
    const p = fifo([op({ date: '2025-02-01', side: 'sell', qty: 5 }), op({ date: '2025-01-01', qty: 3 })]);
    expect(p.shares).toBe(0);
    expect(p.warning).toMatch(/más acciones/);
  });

  it('splits an unrealised gain into price effect and currency effect', () => {
    // Bought 10 @ 100 USD when 1 EUR = 1.25 USD → cost 800 €. Now 120 USD and 1 EUR = 1.10 USD.
    const p = fifo([op({ qty: 10, price: 100, currency: 'USD', fxPerEur: 1.25 })]);
    const v = valuePosition(p, 120, 1.1)!;
    expect(v.costEur).toBeCloseTo(800, 9);
    expect(v.valueEur).toBeCloseTo(1090.909090909, 6);
    expect(v.priceEffectEur).toBeCloseTo(181.818181818, 6); // 10·20/1.10
    expect(v.fxEffectEur).toBeCloseTo(109.090909091, 6); // dollar strengthened
    expect(v.pnlEur).toBeCloseTo(v.priceEffectEur + v.fxEffectEur, 9);
    expect(valuePosition(p, null, 1.1)).toBeNull();
    expect(valuePosition(p, 120, null)).toBeNull();
  });
});

describe('broker CSV', () => {
  it('reads Spanish formats, sides, fees and totals', () => {
    const csv = 'fecha;ticker;tipo;acciones;precio;comision;total_eur\n14/03/2023;ITX;compra;40;24,10;3,50;967,50\n02/05/2024;PEP;compra;10;171,20;5;1590,30\nmal;;;';
    const { rows, errors } = parseOpsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ticker: 'ITX', date: '2023-03-14', side: 'buy', qty: 40, price: 24.1, feeEur: 3.5, totalEur: 967.5 });
    expect(errors).toHaveLength(1);
    // PEP: 1590.30 − 5 = 1585.30 € paid for 1712 USD → 1.0799… USD per EUR
    expect(impliedFx(rows[1]!)).toBeCloseTo(1712 / 1585.3, 9);
  });
  it('rejects files without the required columns', () => {
    expect(parseOpsCsv('a,b\n1,2').errors[0]).toMatch(/ticker/);
  });
  it('parses numbers and dates', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('24,10 €')).toBe(24.1);
    expect(parseNumber('')).toBeNull();
    expect(parseDate('2/5/24')).toBe('2024-05-02');
    expect(parseDate('2024-05-02')).toBe('2024-05-02');
    expect(parseDate('mayo')).toBeNull();
  });
});
