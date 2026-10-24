/**
 * Portfolio repository: holdings, FIFO operations, watchlist and daily snapshots.
 * No Electron imports — unit-tested with plain Node.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PortfolioOp } from '../shared/portfolio';
import type { PortfolioData, WatchItem } from '../shared/types';
import { ValidationError, type ResearchRepo } from './research';
import { EXCHANGES, normalizeQuoteCurrency } from '../shared/market';
import { OpInputSchema, type OpInput } from '../shared/portfolioSchema';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Cur = z.string().regex(/^[A-Z]{3}$/);

export { OpInputSchema, type OpInput };

const Ticker = z.string().trim().min(1).max(12);
export const PortfolioExportSchema = z.object({
  format: z.literal('investor-browser/portfolio'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  holdings: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        ticker: Ticker,
        exchange: z.string().trim().max(12),
        currency: z.string().trim().max(3).optional(),
        shares: z.number().positive().nullable().optional(),
        avgCost: z.number().min(0).nullable().optional(),
        costEur: z.number().min(0).nullable().optional(),
      }),
    )
    .max(2000),
  watchlist: z
    .array(z.object({ name: z.string().trim().min(1).max(200), ticker: Ticker, exchange: z.string().trim().max(12), target: z.number().positive().nullable().optional(), note: z.string().max(5000).nullable().optional() }))
    .max(2000)
    .default([]),
  ops: z
    .array(
      z.object({
        ticker: Ticker,
        exchange: z.string().trim().max(12),
        date: Day.nullable(),
        side: z.enum(['buy', 'sell']),
        qty: z.number().positive(),
        price: z.number().min(0),
        currency: Cur,
        feeEur: z.number().min(0).default(0),
        fxPerEur: z.number().positive(),
        source: z.enum(['manual', 'inicial', 'import']).optional(),
      }),
    )
    .max(50_000)
    .default([]),
});
export type PortfolioExport = z.infer<typeof PortfolioExportSchema>;

export class PortfolioRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly research: ResearchRepo,
  ) {}

  get(): PortfolioData {
    const holdings = this.db.prepare('SELECT company_id AS companyId, added_at AS addedAt FROM portfolio').all() as unknown as PortfolioData['holdings'];
    const ops = (
      this.db
        .prepare(
          `SELECT id, company_id AS companyId, date, side, qty, price, currency, fee_eur AS feeEur, fx_per_eur AS fxPerEur, source, created_at AS createdAt
           FROM portfolio_ops ORDER BY company_id, date, created_at, id`,
        )
        .all() as unknown as PortfolioOp[]
    ).map((o) => ({ ...o }));
    const watchlist = this.db.prepare('SELECT company_id AS companyId, target, note, added_at AS addedAt FROM watchlist').all() as unknown as WatchItem[];
    const snapshots = this.db.prepare('SELECT date, total_eur AS totalEur, cost_eur AS costEur, positions FROM portfolio_snapshots ORDER BY date').all() as unknown as PortfolioData['snapshots'];
    return { holdings: holdings.map((h) => ({ ...h })), ops, watchlist: watchlist.map((w) => ({ ...w })), snapshots: snapshots.map((s) => ({ ...s })) };
  }

  private assertCompany(id: number): void {
    if (!this.research.getCompany(id)) throw new ValidationError('La empresa no existe.');
  }

  add(companyId: number): void {
    this.assertCompany(companyId);
    this.db.prepare('INSERT OR IGNORE INTO portfolio(company_id, added_at) VALUES(?, ?)').run(companyId, Date.now());
  }

  /** Removing from the portfolio keeps the operations: realised gains still count. */
  remove(companyId: number): void {
    this.db.prepare('DELETE FROM portfolio WHERE company_id = ?').run(companyId);
  }

  addOp(raw: OpInput, source: 'manual' | 'inicial' | 'import' = 'manual'): number {
    const o = OpInputSchema.parse(raw);
    this.assertCompany(o.companyId);
    if (o.date && o.date > new Date(Date.now() + 86400e3).toISOString().slice(0, 10)) throw new ValidationError('La fecha de la operación está en el futuro.');
    const fx = o.currency === 'EUR' ? 1 : o.fxPerEur;
    const r = this.db
      .prepare('INSERT INTO portfolio_ops(company_id, date, side, qty, price, currency, fee_eur, fx_per_eur, source, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(o.companyId, o.date, o.side, o.qty, o.price, o.currency, o.feeEur, fx, source, Date.now());
    this.add(o.companyId);
    return Number(r.lastInsertRowid);
  }

  removeOp(id: number): void {
    this.db.prepare('DELETE FROM portfolio_ops WHERE id = ?').run(id);
  }

  setWatch(companyId: number, target: number | null, note: string | null): void {
    this.assertCompany(companyId);
    this.db
      .prepare(
        `INSERT INTO watchlist(company_id, target, note, added_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(company_id) DO UPDATE SET target = excluded.target, note = excluded.note`,
      )
      .run(companyId, target, note?.slice(0, 5000) ?? null, Date.now());
  }

  removeWatch(companyId: number): void {
    this.db.prepare('DELETE FROM watchlist WHERE company_id = ?').run(companyId);
  }

  snapshot(date: string, totalEur: number, costEur: number, positions: number): void {
    if (!Day.safeParse(date).success || !(totalEur >= 0) || !(costEur >= 0)) throw new ValidationError('Foto no válida.');
    this.db
      .prepare(
        `INSERT INTO portfolio_snapshots(date, total_eur, cost_eur, positions) VALUES(?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET total_eur = excluded.total_eur, cost_eur = excluded.cost_eur, positions = excluded.positions`,
      )
      .run(date, totalEur, costEur, positions);
  }

  export(): PortfolioExport {
    const companies = new Map(this.research.listCompanies().map((c) => [c.id, c]));
    const d = this.get();
    const ref = (id: number) => {
      const c = companies.get(id);
      return c?.ticker ? { name: c.name, ticker: c.ticker, exchange: c.exchange } : null;
    };
    return {
      format: 'investor-browser/portfolio',
      version: 1,
      exportedAt: new Date().toISOString(),
      holdings: d.holdings.map((h) => ref(h.companyId)).filter((x): x is NonNullable<typeof x> => !!x),
      watchlist: d.watchlist.flatMap((w) => {
        const r = ref(w.companyId);
        return r ? [{ ...r, target: w.target, note: w.note }] : [];
      }),
      ops: d.ops.flatMap((o) => {
        const r = ref(o.companyId);
        return r ? [{ ticker: r.ticker, exchange: r.exchange, date: o.date, side: o.side, qty: o.qty, price: o.price, currency: o.currency, feeEur: o.feeEur, fxPerEur: o.fxPerEur, source: o.source }] : [];
      }),
    };
  }

  /**
   * Import a portfolio file. Companies are matched by ticker + exchange (created if
   * missing). Operations of an imported ticker REPLACE the ones it had, so importing
   * the same file twice does not duplicate anything. Atomic.
   */
  import(data: unknown, fxPerEurToday: (currency: string) => number | null): { companies: number; holdings: number; ops: number; watchlist: number; warnings: string[] } {
    const p = PortfolioExportSchema.parse(data);
    const warnings: string[] = [];
    let createdCompanies = 0;
    const idFor = (name: string, ticker: string, exchange: string): number => {
      const t = ticker.toUpperCase();
      const ex = exchange.toUpperCase();
      const found = this.research.listCompanies().find((c) => c.ticker === t && c.exchange === ex);
      if (found) return found.id;
      if (ex && !EXCHANGES[ex]) warnings.push(`${t}: bolsa «${ex}» desconocida; no tendrá cotización automática hasta que la corrijas.`);
      createdCompanies++;
      return this.research.saveCompany({ name, ticker: t, exchange: ex }).id;
    };
    let holdings = 0;
    let ops = 0;
    this.db.exec('BEGIN');
    try {
      const replaced = new Set<number>();
      for (const o of p.ops) {
        const id = idFor(o.ticker, o.ticker, o.exchange);
        if (!replaced.has(id)) {
          this.db.prepare('DELETE FROM portfolio_ops WHERE company_id = ?').run(id);
          replaced.add(id);
        }
        this.addOp({ companyId: id, date: o.date, side: o.side, qty: o.qty, price: o.price, currency: o.currency, feeEur: o.feeEur, fxPerEur: o.fxPerEur }, o.source ?? 'import');
        ops++;
      }
      for (const h of p.holdings) {
        const id = idFor(h.name, h.ticker, h.exchange);
        this.add(id);
        holdings++;
        // An opening position given as shares + average cost, when the file has no operations for it.
        if (h.shares && h.avgCost !== null && h.avgCost !== undefined && !replaced.has(id)) {
          const rawCur = (h.currency ?? EXCHANGES[h.exchange.toUpperCase()]?.currency ?? 'EUR').toUpperCase();
          const { price, currency } = normalizeQuoteCurrency(h.avgCost, rawCur);
          const fx = currency === 'EUR' ? 1 : h.costEur ? (h.shares * price) / h.costEur : fxPerEurToday(currency ?? 'EUR');
          if (!fx) {
            warnings.push(`${h.ticker}: sin tipo de cambio para ${currency}; la posición inicial no se ha creado.`);
            continue;
          }
          this.db.prepare('DELETE FROM portfolio_ops WHERE company_id = ?').run(id);
          this.addOp({ companyId: id, date: null, side: 'buy', qty: h.shares, price, currency: currency ?? 'EUR', feeEur: 0, fxPerEur: fx }, 'inicial');
          if (!h.costEur && currency !== 'EUR') warnings.push(`${h.ticker}: coste en euros calculado con el tipo de cambio de hoy (no consta el de compra).`);
          ops++;
        }
      }
      for (const w of p.watchlist) this.setWatch(idFor(w.name, w.ticker, w.exchange), w.target ?? null, w.note ?? null);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { companies: createdCompanies, holdings, ops, watchlist: p.watchlist.length, warnings };
  }
}
