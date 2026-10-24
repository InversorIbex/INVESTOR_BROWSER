/**
 * Calendar assembly: confirmed events from providers, estimates from each
 * company's own history, and your manual events. No Electron imports.
 */
import type { DatabaseSync } from 'node:sqlite';
import { dividendEvents, estimatedEarnings, HOUR_LABEL, type CalEvent, type DividendRow, type EarningsRow, type EventType } from '../shared/calendar';
import type { Company, EsefFilingRow, FilingRow } from '../shared/types';
import { providerSymbol } from '../shared/market';
import { ValidationError } from './research';

export interface CompanyCalendarInput {
  company: Company;
  filings: FilingRow[];
  esef: EsefFilingRow[];
  dividends: DividendRow[] | null;
}

const PERIODIC_FORMS = /^(10-Q|10-K|20-F|40-F)(\/A)?$/;

export function buildEvents(inputs: CompanyCalendarInput[], earnings: EarningsRow[], from: string, to: string, earningsFetchedAt: number | null): CalEvent[] {
  const out: CalEvent[] = [];
  const confirmedEarnings = new Map<string, EarningsRow[]>();
  for (const e of earnings) confirmedEarnings.set(e.symbol, [...(confirmedEarnings.get(e.symbol) ?? []), e]);
  const asOf = earningsFetchedAt ? new Date(earningsFetchedAt).toISOString().slice(0, 10) : '';

  for (const { company: c, filings, esef, dividends } of inputs) {
    // Earnings: confirmed by Finnhub (US) or estimated from past filings
    const sym = providerSymbol(c, 'finnhub');
    const conf = (sym ? (confirmedEarnings.get(sym) ?? []) : []).filter((e) => e.date >= from && e.date <= to);
    for (const e of conf)
      out.push({
        id: `earn:${c.id}:${e.date}`,
        companyId: c.id,
        date: e.date,
        type: 'earnings',
        status: 'confirmed',
        source: `Finnhub (calendario de resultados, consultado ${asOf})`,
        detail: [e.quarter && e.year ? `T${e.quarter} ${e.year}` : '', HOUR_LABEL[e.hour] ?? '', e.epsEstimate !== null ? `BPA estimado ${e.epsEstimate}` : ''].filter(Boolean).join(' · ') || undefined,
      });
    if (!conf.length) {
      const sec = filings.filter((f) => PERIODIC_FORMS.test(f.form)).map((f) => f.filingDate);
      const est =
        sec.length >= 2
          ? estimatedEarnings(c.id, sec, from, to, 'presentaciones 10-Q/10-K en la SEC')
          : estimatedEarnings(c.id, esef.map((f) => f.published).filter((d): d is string => !!d), from, to, 'informes anuales ESEF publicados');
      out.push(...est);
    }
    if (dividends?.length) out.push(...dividendEvents(c.id, dividends, from, to, 'EODHD (historial de dividendos)'));
  }
  return out;
}

export class CalendarRepo {
  constructor(private readonly db: DatabaseSync) {}

  list(from: string, to: string): CalEvent[] {
    return (
      this.db.prepare('SELECT id, company_id AS companyId, date, type, note FROM calendar_events WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to) as unknown as {
        id: number;
        companyId: number;
        date: string;
        type: EventType;
        note: string;
      }[]
    ).map((r) => ({ id: `user:${r.id}`, userId: r.id, companyId: r.companyId, date: r.date, type: r.type, status: 'user' as const, source: 'Añadido por ti', detail: r.note || undefined }));
  }

  add(companyId: number, date: string, type: EventType, note: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Fecha no válida.');
    this.db.prepare('INSERT INTO calendar_events(company_id, date, type, note, created_at) VALUES(?, ?, ?, ?, ?)').run(companyId, date, type, note.slice(0, 500), Date.now());
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  }
}
