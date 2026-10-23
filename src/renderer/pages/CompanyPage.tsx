import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Calculator,
  Check,
  Download,
  FolderClosed,
  FolderOpen,
  Landmark,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { errorMessage, ib, openSaveDialog, showToast, useBrowser, useCompany, useNotesRevision, useSettings } from '../lib/ib';
import { CompanyForm, KIND_ICON, TickerChip, relativeDate } from '../components/research';
import { EmptyState } from '../components/ui';
import { NOTE_KIND_LABEL, type Note, type NoteKind, type Source } from '../../shared/types';
import { buildFigureTable, formatMoney, formatPct, METRICS, periodSortKey, ratiosFor, type Figure, type MetricId, type Scale } from '../../shared/finance';
import { edgarLinks, searchLinks } from '../../shared/sources';
import { displayUrl, searchUrl } from '../../shared/url';
import { marketCap } from '../../shared/valuation';

const open = (url: string, e?: React.MouseEvent) =>
  e && (e.ctrlKey || e.metaKey || e.button === 1) ? void ib.invoke('tabs:create', { url, active: false }) : void ib.invoke('tabs:create', { url });

export function CompanyPage({ id }: { id: number }) {
  const company = useCompany(id);
  const settings = useSettings();
  const rev = useNotesRevision();
  const browser = useBrowser();
  const [notes, setNotes] = useState<Note[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<NoteKind | 'all'>('all');

  useEffect(() => {
    let alive = true;
    void ib.invoke('notes:list', { companyId: id }).then((n) => alive && setNotes(n));
    void ib.invoke('sources:list', { companyId: id }).then((s) => alive && setSources(s));
    return () => {
      alive = false;
    };
  }, [id, rev]);

  const figures: Figure[] = useMemo(
    () =>
      notes
        .filter((n) => n.kind === 'figure' && n.metric && n.period && n.value !== null && n.scale)
        .map((n) => ({
          metric: n.metric as MetricId,
          period: n.period!,
          value: n.value!,
          scale: n.scale as Scale,
          currency: n.currency,
          origin: n.origin ?? 'user',
          sourceUrl: n.sourceUrl,
          sourceTitle: n.sourceTitle,
          noteId: n.id,
        })),
    [notes],
  );
  const table = useMemo(() => buildFigureTable(figures), [figures]);
  const periods = useMemo(() => [...table.keys()].sort((a, b) => periodSortKey(a) - periodSortKey(b)).slice(-6), [table]);

  if (!company) return <EmptyState icon={<BookOpen size={28} />} title="Esta empresa ya no existe" />;

  const openTabs = browser.tabs.filter((t) => t.companyId === id && !t.url.startsWith('ib://'));
  const latestFy = [...periods].reverse().find((p) => p.startsWith('FY'));
  const latestShares = latestFy ? table.get(latestFy)?.get('diluted_shares')?.value ?? null : null;
  const mc = marketCap({ price: company.price, shares: latestShares, grossDebt: null, cash: null, netIncome: null, ebit: null, ebitda: null, fcf: null, dividendPerShare: null });
  const filtered = notes.filter((n) => n.kind !== 'figure' && (filter === 'all' || n.kind === filter));
  const questions = notes.filter((n) => n.kind === 'question' && !n.resolved);
  const conclusions = notes.filter((n) => n.kind === 'conclusion');
  const usLinks = edgarLinks({ ticker: company.ticker, cik: company.cik });
  const webLinks = searchLinks(company.name, company.ticker, (q) => searchUrl(settings.searchEngine, q));

  return (
    <div className="page dossier" data-testid="company-page">
      <header className="dossier-head" style={{ ['--chip' as string]: company.color }}>
        <div className="dossier-id">
          <TickerChip company={company} size="lg" />
          <div>
            <h1 data-testid="dossier-name">{company.name}</h1>
            <div className="dossier-meta">
              {[company.exchange, company.country, company.sector].filter(Boolean).join(' · ') || 'Sin datos de mercado'}
              {company.irUrl && (
                <button className="link-btn inline" onClick={(e) => open(company.irUrl!, e)}>
                  Relaciones con inversores <ArrowUpRight size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="dossier-actions">
          {openTabs.length > 0 ? (
            <button className="btn" onClick={() => void ib.invoke('workspace:close', { companyId: id })} title="Guarda las pestañas de esta empresa y las cierra">
              <FolderClosed size={14} /> Guardar y cerrar espacio ({openTabs.length})
            </button>
          ) : (
            <button className="btn" disabled={!company.savedTabs.length} onClick={() => void ib.invoke('workspace:open', { companyId: id })} data-testid="open-workspace">
              <FolderOpen size={14} /> Abrir espacio{company.savedTabs.length ? ` (${company.savedTabs.length})` : ''}
            </button>
          )}
          <button className="btn" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://valuation/${id}` })} data-testid="to-valuation">
            <Calculator size={14} /> Valorar
          </button>
          <button className="btn" onClick={() => void ib.invoke('research:export', { companyId: id, format: 'markdown' })}>
            <Download size={14} /> Exportar
          </button>
          <button className="icon-btn" aria-label="Editar empresa" onClick={() => setEditing((e) => !e)}>
            <Pencil size={15} />
          </button>
          <button className="icon-btn danger" aria-label="Eliminar empresa" onClick={() => void ib.invoke('companies:remove', { id })}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {editing && (
        <section className="card">
          <CompanyForm initial={company} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </section>
      )}

      {/* KPI strip */}
      <section className="kpis">
        <PriceCard companyId={id} price={company.price} currency={company.priceCurrency} asOf={company.priceAsOf} source={company.priceSource} />
        <div className="kpi">
          <div className="kpi-label">Capitalización</div>
          <div className="kpi-value mono">{mc !== null ? formatMoney(mc, company.priceCurrency) : '—'}</div>
          <div className="kpi-sub">{mc !== null ? `Precio × acciones diluidas ${latestFy}` : 'Necesita precio y acciones diluidas'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Notas</div>
          <div className="kpi-value mono">{notes.length}</div>
          <div className="kpi-sub">{sources.length} fuente(s)</div>
        </div>
        <div className={`kpi ${questions.length ? 'kpi-warn' : ''}`}>
          <div className="kpi-label">Preguntas abiertas</div>
          <div className="kpi-value mono">{questions.length}</div>
          <div className="kpi-sub">{conclusions.length} conclusión(es)</div>
        </div>
      </section>

      <div className="dossier-grid">
        <div className="dossier-main">
          {/* Figures */}
          <section className="card">
            <div className="card-head">
              <h2>Cifras clave</h2>
              <button className="btn btn-sm" onClick={() => openSaveDialog({ text: '', url: null, title: null, companyId: id, kind: 'figure' })} data-testid="add-figure">
                <Plus size={13} /> Añadir cifra
              </button>
            </div>
            {periods.length === 0 ? (
              <p className="muted small">
                Selecciona una cifra en un informe (clic derecho → <em>Guardar como cifra</em>) o añádela a mano. Cada cifra conserva su fuente y su periodo. No se rellenan huecos con ceros.
              </p>
            ) : (
              <FiguresTable table={table} periods={periods} />
            )}
          </section>

          {/* Thesis */}
          <ThesisCard companyId={id} thesis={company.thesis} />

          {/* Notebook */}
          <section className="card">
            <div className="card-head">
              <h2>Cuaderno</h2>
              <div className="chip-filter" role="tablist">
                {(['all', 'snippet', 'note', 'conclusion', 'question'] as const).map((k) => (
                  <button key={k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>
                    {k === 'all' ? 'Todo' : NOTE_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <QuickNote companyId={id} />
            {filtered.length === 0 ? (
              <p className="muted small">Aún no hay entradas{filter !== 'all' ? ' de este tipo' : ''}.</p>
            ) : (
              <ul className="timeline" data-testid="notebook">
                {filtered.map((n) => (
                  <NoteItem key={n.id} note={n} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="dossier-side">
          <section className="card">
            <h2>
              <Landmark size={14} /> Fuentes primarias
            </h2>
            {usLinks.length > 0 ? (
              <>
                <div className="side-label">SEC EDGAR {company.cik ? `· CIK ${company.cik}` : '· por ticker'}</div>
                <ul className="link-list">
                  {usLinks.map((l) => (
                    <li key={l.url}>
                      <button className="side-link" onClick={(e) => open(l.url, e)} onAuxClick={(e) => open(l.url, e)}>
                        {l.label} <ArrowUpRight size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="hint">Solo para emisores registrados en la SEC. Las búsquedas por ticker pueden fallar en valores no estadounidenses.</p>
              </>
            ) : (
              <p className="muted small">Añade ticker o CIK para enlazar sus presentaciones en EDGAR.</p>
            )}
            <div className="side-label">Buscar en la web</div>
            <ul className="link-list">
              {webLinks.map((l) => (
                <li key={l.url}>
                  <button className="side-link" onClick={(e) => open(l.url, e)}>
                    <Search size={12} /> {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {questions.length > 0 && (
            <section className="card">
              <h2>Preguntas pendientes</h2>
              <ul className="checklist">
                {questions.map((q) => (
                  <li key={q.id}>
                    <button className="check-btn" aria-label="Marcar como resuelta" onClick={() => void ib.invoke('notes:update', { id: q.id, resolved: true })}>
                      <span className="checkbox" />
                    </button>
                    <span>{q.body || q.quote}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2>Fuentes consultadas</h2>
            {sources.length === 0 ? (
              <p className="muted small">Las páginas de las que guardes algo aparecerán aquí con su fecha de consulta.</p>
            ) : (
              <ul className="source-list">
                {sources.map((s) => (
                  <li key={s.id}>
                    <button className="side-link" onClick={(e) => open(s.url, e)} title={s.url}>
                      <span className="ellipsis">{s.title || displayUrl(s.url)}</span>
                    </button>
                    <span className="muted small">
                      {relativeDate(s.accessedAt)} · {s.noteCount} nota(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FiguresTable({ table, periods }: { table: ReturnType<typeof buildFigureTable>; periods: string[] }) {
  const metrics = METRICS.filter((m) => m.id !== 'other' && periods.some((p) => table.get(p)?.has(m.id)));
  // Investor convention: one unit for the whole table ("millions of USD") when possible.
  const moneyCurrencies = new Set<string>();
  for (const p of periods)
    for (const m of metrics) {
      const v = table.get(p)?.get(m.id);
      if (v && (m.kind === 'flow' || m.kind === 'stock') && v.currency) moneyCurrencies.add(v.currency);
    }
  const unitCurrency = moneyCurrencies.size === 1 ? [...moneyCurrencies][0]! : null;
  const fmtM = (n: number) => (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: Math.abs(n) < 1e7 ? 1 : 0 });
  const ratioRows = ratiosFor(undefined).map((r) => r.id);
  return (
    <div className="table-wrap">
      <div className="table-caption">{unitCurrency ? `Millones de ${unitCurrency} · acciones en millones` : 'Monedas distintas: cada celda indica la suya'}</div>
      <table className="fin-table" data-testid="figures-table">
        <thead>
          <tr>
            <th />
            {periods.map((p) => (
              <th key={p} className="mono">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <th>{m.short}</th>
              {periods.map((p) => {
                const v = table.get(p)?.get(m.id);
                if (!v) return <td key={p} className="empty-cell">—</td>;
                const tip =
                  v.origin === 'calculated'
                    ? `${v.formula}\nCon cifras de: ${v.sources.map((s) => s.title || s.url || 'nota tuya').join(', ')}`
                    : v.sources[0]?.url
                      ? `Fuente: ${v.sources[0].title || ''} ${v.sources[0].url}`
                      : 'Introducido por ti';
                const display =
                  m.kind === 'count'
                    ? fmtM(v.value)
                    : m.kind === 'per_share'
                      ? `${v.value.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${v.currency ?? ''}`
                      : unitCurrency
                        ? fmtM(v.value)
                        : formatMoney(v.value, v.currency);
                return (
                  <td key={p} className={`mono cell-${v.origin} ${v.value < 0 ? 'neg-num' : ''}`} title={tip} data-metric={m.id} data-period={p}>
                    {display}
                    <span className={`dot dot-${v.origin}`} aria-label={v.origin} />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="sep-row">
            <td colSpan={periods.length + 1} />
          </tr>
          {ratioRows.map((rid) => {
            const label = ratiosFor(undefined).find((r) => r.id === rid)!;
            return (
              <tr key={rid} className="ratio-row">
                <th title={`${label.formula}${label.note ? '\n' + label.note : ''}`}>{label.label}</th>
                {periods.map((p) => {
                  const r = ratiosFor(table.get(p)).find((x) => x.id === rid)!;
                  return (
                    <td key={p} className="mono" title={r.formula}>
                      {rid === 'cash_conversion' ? (r.value === null ? '—' : `${r.value.toFixed(2)}×`) : formatPct(r.value)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="legend">
        <span>
          <span className="dot dot-published" /> Publicado (con fuente)
        </span>
        <span>
          <span className="dot dot-calculated" /> Cálculo propio (pasa el ratón para ver la fórmula)
        </span>
        <span>
          <span className="dot dot-user" /> Introducido por ti
        </span>
        <span>
          <span className="dot dot-estimate" /> Estimación
        </span>
      </div>
    </div>
  );
}

function PriceCard(props: { companyId: number; price: number | null; currency: string | null; asOf: string | null; source: string | null }) {
  const [edit, setEdit] = useState(false);
  const [price, setPrice] = useState(props.price ? String(props.price) : '');
  const [currency, setCurrency] = useState(props.currency ?? 'USD');
  const [asOf, setAsOf] = useState(props.asOf ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(props.source ?? '');
  const save = async () => {
    const v = Number(price.replace(',', '.'));
    try {
      await ib.invoke('companies:setPrice', { id: props.companyId, price: price.trim() ? v : null, currency, asOf, source: source.trim() || null });
      setEdit(false);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };
  if (edit)
    return (
      <div className="kpi kpi-edit">
        <div className="kpi-label">Precio (manual)</div>
        <div className="price-edit">
          <input className="input mono" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus data-testid="price-input" />
          <input className="input mono input-xs" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} aria-label="Moneda" />
        </div>
        <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Fecha del precio" />
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Fuente (p. ej. cierre en mi bróker)" />
        <div className="form-actions">
          <button className="btn btn-sm" onClick={() => setEdit(false)}>
            Cancelar
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void save()} data-testid="price-save">
            Guardar
          </button>
        </div>
      </div>
    );
  return (
    <button className="kpi kpi-btn" onClick={() => setEdit(true)} data-testid="price-card">
      <div className="kpi-label">
        Precio <span className="tag-mini">manual</span>
      </div>
      {props.price !== null ? (
        <>
          <div className="kpi-value mono">
            {props.price.toLocaleString('es-ES', { maximumFractionDigits: 4 })} <span className="kpi-unit">{props.currency}</span>
          </div>
          <div className="kpi-sub" title={props.source ?? ''}>
            a {props.asOf ?? 's/f'} · {props.source || 'fuente no indicada'}
          </div>
        </>
      ) : (
        <>
          <div className="kpi-value muted">Cotización no disponible</div>
          <div className="kpi-sub">Introdúcela a mano con su fecha</div>
        </>
      )}
    </button>
  );
}

function ThesisCard({ companyId, thesis }: { companyId: number; thesis: string }) {
  const [text, setText] = useState(thesis);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const company = useCompany(companyId);
  useEffect(() => {
    if (saved) setText(thesis);
  }, [thesis]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = (value: string) => {
    if (!company) return;
    void ib.invoke('companies:save', { id: company.id, name: company.name, thesis: value }).then(() => setSaved(true));
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Tesis de inversión</h2>
        <span className="muted small">{saved ? 'Guardado' : 'Guardando…'}</span>
      </div>
      <textarea
        className="textarea thesis"
        value={text}
        rows={6}
        data-testid="thesis"
        placeholder={'Por qué este negocio es bueno…\nQué tiene que pasar para que salga bien…\nPrincipales riesgos…\nQué me haría cambiar de opinión…'}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => persist(v), 700);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          if (!saved) persist(text);
        }}
      />
    </section>
  );
}

function QuickNote({ companyId }: { companyId: number }) {
  const [kind, setKind] = useState<'note' | 'question' | 'conclusion'>('note');
  const [body, setBody] = useState('');
  const add = async () => {
    if (!body.trim()) return;
    try {
      await ib.invoke('notes:add', { companyId, kind, body });
      setBody('');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };
  return (
    <div className="quick-note">
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Tipo">
        <option value="note">Nota</option>
        <option value="question">Pregunta</option>
        <option value="conclusion">Conclusión</option>
      </select>
      <input
        className="input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void add()}
        placeholder="Escribe y pulsa Enter…"
        data-testid="quick-note"
      />
    </div>
  );
}

function NoteItem({ note }: { note: Note }) {
  const Icon = KIND_ICON[note.kind];
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  return (
    <li className={`tl-item tl-${note.kind} ${note.resolved ? 'is-resolved' : ''}`} data-testid="note-item">
      <div className="tl-icon">
        <Icon size={13} />
      </div>
      <div className="tl-content">
        <div className="tl-meta">
          <span className="tl-kind">{NOTE_KIND_LABEL[note.kind]}</span>
          <span className="muted">{relativeDate(note.createdAt)}</span>
          {note.kind === 'question' && (
            <button className="link-btn small" onClick={() => void ib.invoke('notes:update', { id: note.id, resolved: !note.resolved })}>
              {note.resolved ? 'Reabrir' : 'Marcar resuelta'}
            </button>
          )}
          <span className="sb-flex" />
          <button className="icon-btn row-action" aria-label="Editar" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
          <button className="icon-btn row-action" aria-label="Eliminar" onClick={() => void ib.invoke('notes:remove', { id: note.id })}>
            <X size={13} />
          </button>
        </div>
        {note.quote && <blockquote className="tl-quote">{note.quote}</blockquote>}
        {editing ? (
          <div className="tl-edit">
            <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={3} autoFocus />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                void ib.invoke('notes:update', { id: note.id, body });
                setEditing(false);
              }}
            >
              <Check size={13} /> Guardar
            </button>
          </div>
        ) : (
          note.body && <p className="tl-body">{note.body}</p>
        )}
        {note.sourceUrl && (
          <button className="tl-source" onClick={(e) => open(note.sourceUrl!, e)} onAuxClick={(e) => open(note.sourceUrl!, e)} title={note.sourceUrl}>
            {note.sourceTitle || displayUrl(note.sourceUrl)} · consultado {relativeDate(note.accessedAt)}
          </button>
        )}
      </div>
    </li>
  );
}

