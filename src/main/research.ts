/**
 * Research repository: companies, sources and notebook entries.
 * No Electron imports — unit-tested with plain Node.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Company, FilingRow, FinancialFact, Note, NoteKind, Source } from '../shared/types';
import { filingIndexUrl, type NormalizeResult, type SubmissionsInfo } from '../shared/xbrl';
import { CompanyInputSchema, NoteInputSchema, type CompanyInput, type NoteInput } from '../shared/ipc';
import { isSafeWebUrl } from '../shared/url';
import { normalizeTicker } from '../shared/sources';
import { normalizePeriod, metricDef, SCALE_LABEL, type Scale } from '../shared/finance';

const COMPANY_COLORS = ['#5b8cff', '#3fb68b', '#e3a13b', '#c46be0', '#f0616d', '#2cb5c9', '#8e9bb0', '#d4b106'];

interface CompanyRow {
  id: number;
  name: string;
  ticker: string | null;
  exchange: string;
  country: string;
  sector: string;
  sector_kind: Company['sectorKind'];
  ir_url: string | null;
  cik: string | null;
  color: string;
  followed: number;
  thesis: string;
  price: number | null;
  price_currency: string | null;
  price_as_of: string | null;
  price_source: string | null;
  saved_tabs: string;
  sec_name: string | null;
  fiscal_year_end: string | null;
  sec_synced_at: number | null;
  sec_taxonomy: string | null;
  created_at: number;
  updated_at: number;
  note_count: number;
  open_questions: number;
}

function toCompany(r: CompanyRow): Company {
  let savedTabs: Company['savedTabs'] = [];
  try {
    const parsed = JSON.parse(r.saved_tabs) as unknown;
    if (Array.isArray(parsed))
      savedTabs = parsed
        .filter((t): t is { url: string; title: string } => !!t && typeof t.url === 'string' && isSafeWebUrl(t.url))
        .map((t) => ({ url: t.url, title: String(t.title ?? '') }));
  } catch {
    /* corrupt json → no saved tabs */
  }
  return {
    id: r.id,
    name: r.name,
    ticker: r.ticker,
    exchange: r.exchange,
    country: r.country,
    sector: r.sector,
    sectorKind: r.sector_kind,
    irUrl: r.ir_url,
    cik: r.cik,
    color: r.color,
    followed: !!r.followed,
    thesis: r.thesis,
    price: r.price,
    priceCurrency: r.price_currency,
    priceAsOf: r.price_as_of,
    priceSource: r.price_source,
    savedTabs,
    secName: r.sec_name,
    fiscalYearEnd: r.fiscal_year_end,
    secSyncedAt: r.sec_synced_at,
    secTaxonomy: r.sec_taxonomy,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    noteCount: Number(r.note_count ?? 0),
    openQuestions: Number(r.open_questions ?? 0),
  };
}

const NOTE_SELECT = `
  SELECT n.id, n.company_id AS companyId, n.kind, n.body, n.quote, n.metric, n.period, n.value, n.scale,
         n.currency, n.origin, n.resolved, n.source_id AS sourceId, s.url AS sourceUrl, s.title AS sourceTitle,
         s.accessed_at AS accessedAt, n.created_at AS createdAt, n.updated_at AS updatedAt
  FROM notes n LEFT JOIN sources s ON s.id = n.source_id`;

export class ValidationError extends Error {}

export class ResearchRepo {
  constructor(private readonly db: DatabaseSync) {}

  // ---------------- companies ----------------
  listCompanies(): Company[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM notes n WHERE n.company_id = c.id) AS note_count,
           (SELECT COUNT(*) FROM notes n WHERE n.company_id = c.id AND n.kind = 'question' AND n.resolved = 0) AS open_questions
         FROM companies c ORDER BY c.followed DESC, COALESCE(c.ticker, c.name) COLLATE NOCASE`,
      )
      .all() as unknown as CompanyRow[];
    return rows.map(toCompany);
  }

  getCompany(id: number): Company | null {
    return this.listCompanies().find((c) => c.id === id) ?? null;
  }

  findByTicker(ticker: string): Company[] {
    const t = normalizeTicker(ticker);
    return t ? this.listCompanies().filter((c) => c.ticker === t) : [];
  }

  saveCompany(raw: CompanyInput): Company {
    const parsed = CompanyInputSchema.parse(raw);
    // Updates are patches: fields not sent keep their stored value.
    let input = parsed;
    if (parsed.id) {
      const existing = this.getCompany(parsed.id);
      if (!existing) throw new ValidationError('La empresa no existe.');
      const defined = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));
      input = {
        name: existing.name,
        ticker: existing.ticker,
        exchange: existing.exchange,
        country: existing.country,
        sector: existing.sector,
        sectorKind: existing.sectorKind,
        irUrl: existing.irUrl,
        cik: existing.cik,
        color: existing.color,
        followed: existing.followed,
        thesis: existing.thesis,
        ...defined,
      } as CompanyInput;
    }
    const ticker = input.ticker ? normalizeTicker(input.ticker) : null;
    if (input.ticker && !ticker) throw new ValidationError('Ticker no válido (letras, números, punto o guion; máx. 10).');
    if (input.irUrl && !isSafeWebUrl(input.irUrl)) throw new ValidationError('La URL de relaciones con inversores debe empezar por https:// o http://');
    const now = Date.now();
    const fields = {
      name: input.name.trim(),
      ticker,
      exchange: (input.exchange ?? '').trim().toUpperCase(),
      country: (input.country ?? '').trim(),
      sector: (input.sector ?? '').trim(),
      sector_kind: input.sectorKind ?? 'general',
      ir_url: input.irUrl?.trim() || null,
      cik: input.cik?.trim() || null,
      followed: input.followed === undefined ? 1 : Number(input.followed),
    };
    try {
      if (input.id) {
        const existing = this.getCompany(input.id);
        if (!existing) throw new ValidationError('La empresa no existe.');
        this.db
          .prepare(
            `UPDATE companies SET name=?, ticker=?, exchange=?, country=?, sector=?, sector_kind=?, ir_url=?, cik=?,
               color=?, followed=?, thesis=?, updated_at=? WHERE id=?`,
          )
          .run(
            fields.name,
            fields.ticker,
            fields.exchange,
            fields.country,
            fields.sector,
            fields.sector_kind,
            fields.ir_url,
            fields.cik,
            input.color ?? existing.color,
            input.followed === undefined ? Number(existing.followed) : fields.followed,
            input.thesis ?? existing.thesis,
            now,
            input.id,
          );
        return this.getCompany(input.id)!;
      }
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number }).n;
      const res = this.db
        .prepare(
          `INSERT INTO companies(name, ticker, exchange, country, sector, sector_kind, ir_url, cik, color, followed, thesis, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          fields.name,
          fields.ticker,
          fields.exchange,
          fields.country,
          fields.sector,
          fields.sector_kind,
          fields.ir_url,
          fields.cik,
          input.color ?? COMPANY_COLORS[Number(count) % COMPANY_COLORS.length]!,
          fields.followed,
          input.thesis ?? '',
          now,
          now,
        );
      return this.getCompany(Number(res.lastInsertRowid))!;
    } catch (err) {
      if (err instanceof Error && /UNIQUE/.test(err.message))
        throw new ValidationError(`Ya existe una empresa con el ticker ${fields.ticker}${fields.exchange ? ' en ' + fields.exchange : ''}.`);
      throw err;
    }
  }

  removeCompany(id: number): void {
    this.db.prepare('DELETE FROM companies WHERE id = ?').run(id);
  }

  setPrice(id: number, p: { price: number | null; currency?: string | null; asOf?: string | null; source?: string | null }): void {
    this.db
      .prepare('UPDATE companies SET price=?, price_currency=?, price_as_of=?, price_source=?, updated_at=? WHERE id=?')
      .run(p.price, p.price === null ? null : (p.currency ?? null), p.price === null ? null : (p.asOf ?? null), p.price === null ? null : (p.source ?? null), Date.now(), id);
  }

  setSavedTabs(id: number, tabs: { url: string; title: string }[]): void {
    const safe = tabs.filter((t) => isSafeWebUrl(t.url)).slice(0, 100);
    this.db.prepare('UPDATE companies SET saved_tabs=?, updated_at=? WHERE id=?').run(JSON.stringify(safe), Date.now(), id);
  }

  // ---------------- official data (SEC) ----------------
  /** Link a company to its SEC registration; fills only fields the user left empty. */
  linkSec(companyId: number, info: SubmissionsInfo): Company {
    const c = this.getCompany(companyId);
    if (!c) throw new ValidationError('La empresa no existe.');
    const cik = String(Number(info.cik));
    if (!/^\d{1,10}$/.test(cik)) throw new ValidationError('CIK no válido.');
    this.db
      .prepare(
        `UPDATE companies SET cik = ?, sec_name = ?, fiscal_year_end = ?,
           exchange = CASE WHEN exchange = '' THEN ? ELSE exchange END,
           sector = CASE WHEN sector = '' THEN ? ELSE sector END,
           country = CASE WHEN country = '' AND ? <> '' THEN 'EE. UU.' ELSE country END,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        cik,
        info.name || null,
        info.fiscalYearEnd,
        (info.exchanges[0] ?? '').toUpperCase().slice(0, 40),
        (info.sicDescription ?? '').slice(0, 80),
        info.stateOfIncorporation && /^[A-Z]{2}$/.test(info.stateOfIncorporation) ? 'us' : '',
        Date.now(),
        companyId,
      );
    this.saveFilings(companyId, info);
    return this.getCompany(companyId)!;
  }

  saveFilings(companyId: number, info: SubmissionsInfo): void {
    const ins = this.db.prepare(
      `INSERT INTO filings(company_id, accn, form, filing_date, report_date, description, url) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(company_id, accn) DO UPDATE SET form=excluded.form, filing_date=excluded.filing_date,
         report_date=excluded.report_date, description=excluded.description, url=excluded.url`,
    );
    this.db.exec('BEGIN');
    try {
      for (const f of info.filings) {
        if (!f.url.startsWith('https://www.sec.gov/Archives/edgar/data/')) continue;
        ins.run(companyId, f.accn, f.form, f.filingDate, f.reportDate, f.description, f.url);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listFilings(companyId: number, limit = 200): FilingRow[] {
    return (
      this.db
        .prepare(
          `SELECT accn, form, filing_date AS filingDate, report_date AS reportDate, description, url
           FROM filings WHERE company_id = ? ORDER BY filing_date DESC, accn DESC LIMIT ?`,
        )
        .all(companyId, limit) as unknown as FilingRow[]
    ).map((f) => ({ ...f }));
  }

  /** Replace the SEC figures of a company atomically with a fresh normalisation. */
  saveSecFacts(companyId: number, cik: string | number, result: NormalizeResult, fetchedAt: number): void {
    const ins = this.db.prepare(
      `INSERT INTO financial_facts(company_id, provider, metric, period, period_start, period_end, value, unit, currency, concept,
         accn, form, filed, derived, restated_value, restated_accn, restated_filed, source_url, fetched_at)
       VALUES(?, 'sec', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      this.db.prepare("DELETE FROM financial_facts WHERE company_id = ? AND provider = 'sec'").run(companyId);
      for (const f of result.facts) {
        ins.run(
          companyId,
          f.metric,
          f.period,
          f.periodStart,
          f.periodEnd,
          f.value,
          f.unit,
          f.currency,
          f.concept,
          f.accn,
          f.form,
          f.filed,
          Number(f.derived),
          f.restatedFrom?.value ?? null,
          f.restatedFrom?.accn ?? null,
          f.restatedFrom?.filed ?? null,
          filingIndexUrl(cik, f.accn),
          fetchedAt,
        );
      }
      this.db
        .prepare('UPDATE companies SET sec_synced_at = ?, sec_taxonomy = ?, sec_name = COALESCE(?, sec_name), updated_at = ? WHERE id = ?')
        .run(fetchedAt, result.taxonomy, result.entityName, Date.now(), companyId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listFacts(companyId: number): FinancialFact[] {
    return (
      this.db
        .prepare(
          `SELECT id, company_id AS companyId, provider, metric, period, period_start AS periodStart, period_end AS periodEnd, value, unit,
                  currency, concept, accn, form, filed, derived, restated_value AS restatedValue, restated_accn AS restatedAccn,
                  restated_filed AS restatedFiled, source_url AS sourceUrl, fetched_at AS fetchedAt
           FROM financial_facts WHERE company_id = ? ORDER BY period_end, metric`,
        )
        .all(companyId) as unknown as FinancialFact[]
    ).map((f) => ({ ...f, derived: !!f.derived }));
  }

  // ---------------- sources ----------------
  private upsertSource(companyId: number, url: string, title: string, accessedAt = Date.now()): number {
    if (!isSafeWebUrl(url) || url === 'about:blank') throw new ValidationError('Solo se pueden guardar fuentes http(s).');
    this.db
      .prepare(
        `INSERT INTO sources(company_id, url, title, accessed_at) VALUES(?,?,?,?)
         ON CONFLICT(company_id, url) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
                                                     accessed_at = excluded.accessed_at`,
      )
      .run(companyId, url, title.slice(0, 1000), accessedAt);
    return (this.db.prepare('SELECT id FROM sources WHERE company_id=? AND url=?').get(companyId, url) as { id: number }).id;
  }

  listSources(companyId: number): Source[] {
    return (
      this.db
        .prepare(
          `SELECT s.id, s.company_id AS companyId, s.url, s.title, s.accessed_at AS accessedAt,
                  (SELECT COUNT(*) FROM notes n WHERE n.source_id = s.id) AS noteCount
           FROM sources s WHERE s.company_id = ? ORDER BY s.accessed_at DESC`,
        )
        .all(companyId) as unknown as Source[]
    ).map((s) => ({ ...s }));
  }

  // ---------------- notes ----------------
  addNote(raw: NoteInput, now = Date.now()): Note {
    const n = NoteInputSchema.parse(raw);
    if (!this.getCompany(n.companyId)) throw new ValidationError('La empresa no existe.');
    let period: string | null = null;
    if (n.kind === 'figure') {
      period = n.period ? normalizePeriod(n.period) : null;
      if (!n.metric || n.value === null || n.value === undefined || !n.scale || !period)
        throw new ValidationError('Una cifra necesita métrica, valor, escala y un periodo válido (p. ej. FY2025 o Q3 2026).');
    } else if (!n.body.trim() && !n.quote?.trim() && !n.sourceUrl) {
      throw new ValidationError('La nota está vacía.');
    }
    const sourceId = n.sourceUrl ? this.upsertSource(n.companyId, n.sourceUrl, n.sourceTitle ?? '', now) : null;
    const isFigure = n.kind === 'figure';
    const res = this.db
      .prepare(
        `INSERT INTO notes(company_id, source_id, kind, body, quote, metric, period, value, scale, currency, origin, resolved, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      )
      .run(
        n.companyId,
        sourceId,
        n.kind,
        n.body.trim(),
        n.quote?.trim() || null,
        isFigure ? n.metric! : null,
        period,
        isFigure ? n.value! : null,
        isFigure ? n.scale! : null,
        isFigure ? (n.currency ?? null) : null,
        // A figure saved from a page is "published" by that source unless the user says otherwise.
        isFigure ? (n.origin ?? (sourceId ? 'published' : 'user')) : null,
        now,
        now,
      );
    this.touch(n.companyId);
    return this.getNote(Number(res.lastInsertRowid))!;
  }

  getNote(id: number): Note | null {
    const row = this.db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id) as unknown as Note | undefined;
    return row ? fixNote(row) : null;
  }

  listNotes(companyId?: number, query = ''): Note[] {
    const q = query.trim();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (companyId) {
      where.push('n.company_id = ?');
      args.push(companyId);
    }
    if (q) {
      where.push("(n.body LIKE ? ESCAPE '\\' OR n.quote LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      args.push(like, like, like);
    }
    const sql = `${NOTE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.created_at DESC, n.id DESC LIMIT 2000`;
    return (this.db.prepare(sql).all(...args) as unknown as Note[]).map(fixNote);
  }

  updateNote(id: number, patch: { body?: string; resolved?: boolean; kind?: NoteKind }): number | null {
    const note = this.getNote(id);
    if (!note) return null;
    if (patch.kind && (patch.kind === 'figure') !== (note.kind === 'figure')) throw new ValidationError('No se puede convertir una cifra en texto ni al revés.');
    this.db
      .prepare('UPDATE notes SET body = COALESCE(?, body), resolved = COALESCE(?, resolved), kind = COALESCE(?, kind), updated_at = ? WHERE id = ?')
      .run(patch.body ?? null, patch.resolved === undefined ? null : Number(patch.resolved), patch.kind ?? null, Date.now(), id);
    this.touch(note.companyId);
    return note.companyId;
  }

  removeNote(id: number): number | null {
    const note = this.getNote(id);
    if (!note) return null;
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return note.companyId;
  }

  private touch(companyId: number): void {
    this.db.prepare('UPDATE companies SET updated_at = ? WHERE id = ?').run(Date.now(), companyId);
  }

  // ---------------- export / import ----------------
  exportJson(companyId?: number): ResearchExport {
    const companies = this.listCompanies().filter((c) => !companyId || c.id === companyId);
    return {
      format: 'investor-browser/research',
      version: 1,
      exportedAt: new Date().toISOString(),
      companies: companies.map((c) => ({
        name: c.name,
        ticker: c.ticker,
        exchange: c.exchange,
        country: c.country,
        sector: c.sector,
        sectorKind: c.sectorKind,
        irUrl: c.irUrl,
        cik: c.cik,
        color: c.color,
        thesis: c.thesis,
        price: c.price === null ? null : { value: c.price, currency: c.priceCurrency, asOf: c.priceAsOf, source: c.priceSource },
        notes: this.listNotes(c.id).map((n) => ({
          kind: n.kind,
          body: n.body,
          quote: n.quote,
          metric: n.metric,
          period: n.period,
          value: n.value,
          scale: n.scale,
          currency: n.currency,
          origin: n.origin,
          resolved: n.resolved,
          sourceUrl: n.sourceUrl,
          sourceTitle: n.sourceTitle,
          accessedAt: n.accessedAt,
          createdAt: n.createdAt,
        })),
      })),
    };
  }

  exportMarkdown(companyId?: number): string {
    const fmtDate = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '');
    let md = `# Investigación — exportado ${new Date().toISOString().slice(0, 10)}\n\n`;
    for (const c of this.listCompanies().filter((x) => !companyId || x.id === companyId)) {
      md += `## ${c.ticker ? `${c.ticker} — ` : ''}${c.name}\n\n`;
      const meta = [c.exchange, c.country, c.sector].filter(Boolean).join(' · ');
      if (meta) md += `${meta}\n\n`;
      if (c.irUrl) md += `Relaciones con inversores: ${c.irUrl}\n\n`;
      if (c.price !== null) md += `Precio introducido manualmente: ${c.price} ${c.priceCurrency ?? ''} (a ${c.priceAsOf ?? 's/f'}; fuente: ${c.priceSource || 'no indicada'})\n\n`;
      if (c.thesis.trim()) md += `### Tesis\n\n${c.thesis.trim()}\n\n`;
      const notes = this.listNotes(c.id);
      const figures = notes.filter((n) => n.kind === 'figure');
      if (figures.length) {
        md += `### Cifras\n\n| Métrica | Periodo | Valor | Origen | Fuente |\n| --- | --- | --- | --- | --- |\n`;
        for (const f of figures)
          md += `| ${metricDef(f.metric ?? 'other').label} | ${f.period} | ${f.value} ${SCALE_LABEL[(f.scale as Scale) ?? 'units']} ${f.currency ?? ''} | ${f.origin} | ${f.sourceUrl ?? '—'} |\n`;
        md += '\n';
      }
      for (const kind of ['conclusion', 'question', 'snippet', 'note'] as const) {
        const list = notes.filter((n) => n.kind === kind);
        if (!list.length) continue;
        md += `### ${{ conclusion: 'Conclusiones', question: 'Preguntas', snippet: 'Fragmentos', note: 'Notas' }[kind]}\n\n`;
        for (const n of list) {
          if (n.quote) md += `> ${n.quote.replace(/\n/g, '\n> ')}\n\n`;
          if (n.body) md += `${kind === 'question' ? (n.resolved ? '- [x] ' : '- [ ] ') : ''}${n.body}\n\n`;
          if (n.sourceUrl) md += `Fuente: [${(n.sourceTitle || n.sourceUrl).replace(/[[\]]/g, '')}](${n.sourceUrl}) — consultado ${fmtDate(n.accessedAt)}\n\n`;
        }
      }
    }
    return md;
  }

  /** Import a previous export. Companies are matched by ticker+exchange, else created. */
  importJson(data: unknown): { companies: number; notes: number; skipped: number } {
    const parsed = ResearchExportSchema.parse(data);
    let companies = 0;
    let notes = 0;
    let skipped = 0;
    this.db.exec('BEGIN');
    try {
      for (const c of parsed.companies) {
        const ticker = c.ticker ? normalizeTicker(c.ticker) : null;
        let target = ticker ? this.listCompanies().find((x) => x.ticker === ticker && x.exchange === (c.exchange ?? '').toUpperCase()) : undefined;
        if (!target) {
          target = this.saveCompany({
            name: c.name,
            ticker,
            exchange: c.exchange ?? '',
            country: c.country ?? '',
            sector: c.sector ?? '',
            sectorKind: c.sectorKind ?? 'general',
            irUrl: c.irUrl && isSafeWebUrl(c.irUrl) ? c.irUrl : null,
            cik: c.cik ?? null,
            color: c.color,
            thesis: c.thesis ?? '',
          });
          companies++;
        }
        for (const n of c.notes) {
          try {
            const added = this.addNote(
              {
                companyId: target.id,
                kind: n.kind,
                body: n.body ?? '',
                quote: n.quote ?? null,
                metric: (n.metric as never) ?? null,
                period: n.period ?? null,
                value: n.value ?? null,
                scale: (n.scale as never) ?? null,
                currency: n.currency ?? null,
                origin: n.origin ?? null,
                sourceUrl: n.sourceUrl && isSafeWebUrl(n.sourceUrl) ? n.sourceUrl : null,
                sourceTitle: n.sourceTitle ?? null,
              },
              n.createdAt ?? Date.now(),
            );
            if (n.resolved) this.updateNote(added.id, { resolved: true });
            notes++;
          } catch {
            skipped++;
          }
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { companies, notes, skipped };
  }
}

function fixNote(n: Note): Note {
  return { ...n, resolved: !!n.resolved };
}

const ExportNoteSchema = z.object({
  kind: z.enum(['snippet', 'figure', 'note', 'conclusion', 'question']),
  body: z.string().max(20_000).nullable().optional(),
  quote: z.string().max(20_000).nullable().optional(),
  metric: z.string().max(40).nullable().optional(),
  period: z.string().max(20).nullable().optional(),
  value: z.number().finite().nullable().optional(),
  scale: z.string().max(20).nullable().optional(),
  currency: z.string().max(3).nullable().optional(),
  origin: z.enum(['published', 'user', 'estimate']).nullable().optional(),
  resolved: z.boolean().optional(),
  sourceUrl: z.string().max(8192).nullable().optional(),
  sourceTitle: z.string().max(1000).nullable().optional(),
  accessedAt: z.number().nullable().optional(),
  createdAt: z.number().optional(),
});
export const ResearchExportSchema = z.object({
  format: z.literal('investor-browser/research'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  companies: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        ticker: z.string().max(12).nullable().optional(),
        exchange: z.string().max(40).optional(),
        country: z.string().max(60).optional(),
        sector: z.string().max(80).optional(),
        sectorKind: z.enum(['general', 'bank', 'insurer', 'reit']).optional(),
        irUrl: z.string().max(8192).nullable().optional(),
        cik: z.string().regex(/^\d{1,10}$/).nullable().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        thesis: z.string().max(50_000).optional(),
        price: z.unknown().optional(),
        notes: z.array(ExportNoteSchema).max(20_000),
      }),
    )
    .max(2000),
});
export type ResearchExport = z.infer<typeof ResearchExportSchema>;

