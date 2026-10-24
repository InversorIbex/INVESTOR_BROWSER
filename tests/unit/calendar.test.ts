import { describe, expect, it } from 'vitest';
import { addMonths, dividendEvents, estimatedEarnings, inferFrequency, parseEodhdDividends, parseFinnhubEarnings, project, toIcs } from '../../src/shared/calendar';

describe('dates', () => {
  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
  it('infers quarterly, semiannual and annual patterns; irregular → null', () => {
    expect(inferFrequency(['2025-02-07', '2025-05-09', '2025-08-08', '2025-11-07'])).toBe(3);
    expect(inferFrequency(['2024-06-01', '2024-12-02', '2025-06-03'])).toBe(6);
    expect(inferFrequency(['2023-02-20', '2024-02-21', '2025-02-19'])).toBe(12);
    expect(inferFrequency(['2025-01-01', '2025-02-20'])).toBeNull();
    expect(inferFrequency(['2025-01-01'])).toBeNull();
  });
  it('projects within the window', () => {
    expect(project('2025-11-07', 3, '2026-01-01', '2026-12-31')).toEqual(['2026-02-07', '2026-05-07', '2026-08-07', '2026-11-07']);
  });
});

describe('providers', () => {
  it('Finnhub earnings calendar', () => {
    const rows = parseFinnhubEarnings({
      earningsCalendar: [
        { date: '2026-10-30', epsActual: null, epsEstimate: 1.62, hour: 'amc', quarter: 4, revenueActual: null, revenueEstimate: 1, symbol: 'AAPL', year: 2026 },
        { date: 'bad', symbol: 'X' },
      ],
    });
    expect(rows).toEqual([{ symbol: 'AAPL', date: '2026-10-30', hour: 'amc', epsEstimate: 1.62, quarter: 4, year: 2026 }]);
    expect(parseFinnhubEarnings({})).toEqual([]);
  });
  it('EODHD dividends → confirmed events plus labelled estimates', () => {
    const rows = parseEodhdDividends([
      { date: '2026-05-08', declarationDate: '2026-04-25', recordDate: '2026-05-11', paymentDate: '2026-05-15', period: 'Quarterly', value: 0.26, unadjustedValue: 0.26, currency: 'USD' },
      { date: '2025-11-07', paymentDate: '2025-11-13', value: 0.25, currency: 'USD' },
      { date: '2026-02-06', paymentDate: '2026-02-12', value: 0.25, currency: 'USD' },
      { date: '2026-08-07', paymentDate: '2026-08-13', value: 0.26, currency: 'USD' },
      { date: 'NA', value: 'NA' },
    ]);
    expect(rows.map((r) => r.exDate)).toEqual(['2025-11-07', '2026-02-06', '2026-05-08', '2026-08-07']);
    const ev = dividendEvents(7, rows, '2026-08-01', '2027-03-01', 'EODHD');
    expect(ev.filter((e) => e.status === 'confirmed').map((e) => [e.type, e.date])).toEqual([
      ['exdiv', '2026-08-07'],
      ['payment', '2026-08-13'],
    ]);
    const est = ev.filter((e) => e.status === 'estimated');
    expect(est.map((e) => e.date)).toEqual(['2026-11-07', '2027-02-07']);
    expect(est[0]).toMatchObject({ amount: 0.26, currency: 'USD' });
    expect(est[0]!.source).toMatch(/^Estimada/);
  });
  it('earnings estimated from filing dates', () => {
    const ev = estimatedEarnings(1, ['2025-10-30', '2026-01-29', '2026-04-30', '2026-07-30'], '2026-10-01', '2026-12-31', 'presentaciones 10-Q/10-K');
    expect(ev.map((e) => e.date)).toEqual(['2026-10-30']);
    expect(ev[0]!.status).toBe('estimated');
  });
});

describe('iCalendar', () => {
  it('writes valid all-day events and escapes text', () => {
    const ics = toIcs([{ id: 'div~:1:2026-11-07', companyId: 1, date: '2026-11-07', type: 'exdiv', status: 'estimated', source: 'a; b, c', title: 'PEP ex-dividendo' }], new Date('2026-10-24T10:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261107\r\nDTEND;VALUE=DATE:20261108');
    expect(ics).toContain('SUMMARY:(Estimada) PEP ex-dividendo');
    expect(ics).toContain('DESCRIPTION:a\\; b\\, c');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
});
