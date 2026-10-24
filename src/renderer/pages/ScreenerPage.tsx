import { useMemo, useRef, useState } from 'react';
import { Info, ListFilter, Loader2, RefreshCw, Square, X } from 'lucide-react';
import { errorMessage, ib, showToast, useCompanies, usePortfolio } from '../lib/ib';
import { priceIn, statementCurrency, useFx, useManyCompanyFigures } from '../lib/figures';
import { TickerChip } from '../components/research';
import { EmptyState } from '../components/ui';
import type { Company } from '../../shared/types';
import { buildFigureTable } from '../../shared/finance';
import { annualPeriods } from '../../shared/analysis';
import { convert, isUsExchange } from '../../shared/market';
import { countryOf } from '../../shared/esef';
import { passes, PRESETS, SCREEN_METRIC, SCREEN_METRICS, scoreUniverse, screenMetrics, VIEWS, type Cell, type Preset, type ScreenKey } from '../../shared/screener';

const nf = (d: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
export function fmtCell(key: ScreenKey, c: Cell | undefined): string {
  if (!c || c.value === null) return '—';
  const f = SCREEN_METRIC[key].fmt;
  const v = c.value;
  if (f === 'pct') return `${nf(1).format(v * 100)} %`;
  if (f === 'x') return `${nf(1).format(v)}×`;
  if (f === 'money') return nf(0).format(v);
  if (f === 'score' || f === 'count') return nf(0).format(v);
  return nf(2).format(v);
}

/** Parse a threshold typed by the user: percentages in %, multiples as numbers. */
function parseBound(key: ScreenKey, raw: string): number | undefined {
  const t = raw.trim().replace(',', '.');
  if (!t) return undefined;
  const v = Number(t);
  if (!Number.isFinite(v)) return undefined;
  return SCREEN_METRIC[key].fmt === 'pct' ? v / 100 : v;
}

interface Row {
  c: Company;
  m: Record<ScreenKey, Cell>;
  zone: string;
  official: boolean;
  lastFy: string | null;
}

export function ScreenerPage() {
  const companies = useCompanies();
  const pf = usePortfolio();
  const [universe, setUniverse] = useState<'all' | 'portfolio' | 'watch'>('all');
  const ids = useMemo(() => {
    const hold = new Set(pf.holdings.map((h) => h.companyId));
    const watch = new Set(pf.watchlist.map((w) => w.companyId));
    return companies.filter((c) => (universe === 'all' ? true : universe === 'portfolio' ? hold.has(c.id) : watch.has(c.id))).map((c) => c.id);
  }, [companies, pf, universe]);
  const figures = useManyCompanyFigures(ids);
  const fx = useFx(true);

  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState<Preset['f']>({});
  const [q, setQ] = useState('');
  const [zone, setZone] = useState('');
  const [view, setView] = useState('Resumen');
  const [sort, setSort] = useState<{ k: ScreenKey | 'name'; dir: 1 | -1 }>({ k: 'score_quality', dir: -1 });
  const [axes, setAxes] = useState<{ x: ScreenKey; y: ScreenKey }>({ x: 'per', y: 'roic' });

  const rows: Row[] = useMemo(() => {
    const out = ids.flatMap((id) => {
      const c = companies.find((x) => x.id === id);
      if (!c) return [];
      const figs = figures.get(id) ?? [];
      const table = buildFigureTable(figs);
      const lastFy = annualPeriods(table).at(-1) ?? null;
      const px = priceIn(c, statementCurrency(table, lastFy), fx);
      const eur = c.price !== null && c.priceCurrency ? convert(c.price, c.priceCurrency, 'EUR', fx) : null;
      const m = screenMetrics({ table, sector: c.sectorKind, priceInStatements: px.value, priceNote: px.note ?? (c.price === null ? 'Sin precio' : null), priceInEur: eur, changePct: c.priceChangePct });
      const cc = countryOf(c);
      const zoneName = cc === 'ES' ? 'España' : cc === 'US' ? 'EE. UU.' : cc ? 'Europa' : 'Sin país';
      return [{ c, m, zone: zoneName, official: figs.some((f) => f.provider === 'sec' || f.provider === 'esef'), lastFy }];
    });
    scoreUniverse(out.map((r) => r.m));
    return out;
  }, [ids, companies, figures, fx]);

  const activePreset = PRESETS.find((p) => p.id === preset) ?? null;
  const filters: Preset['f'] = { ...(activePreset?.f ?? {}), ...custom };
  const shown = rows
    .filter((r) => !q || `${r.c.ticker ?? ''} ${r.c.name}`.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !zone || r.zone === zone)
    .filter((r) => passes(r.m, filters))
    .sort((a, b) => {
      if (sort.k === 'name') return sort.dir * (a.c.ticker ?? a.c.name).localeCompare(b.c.ticker ?? b.c.name, 'es');
      const va = a.m[sort.k].value;
      const vb = b.m[sort.k].value;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sort.dir * (va - vb);
    });
  const cols = VIEWS[view] ?? VIEWS.Resumen!;
  const withOfficial = rows.filter((r) => r.official).length;
  const withPrice = rows.filter((r) => r.c.price !== null).length;

  if (!companies.length)
    return (
      <div className="page">
        <EmptyState icon={<ListFilter size={28} />} title="Aún no hay empresas que filtrar">
          El screener trabaja sobre tus empresas: créalas en Investigación o importa tu cartera, e importa sus cifras oficiales.
        </EmptyState>
      </div>
    );

  return (
    <div className="page screener" data-testid="screener-page">
      <header className="page-head wide">
        <h1>
          <ListFilter size={18} /> Screener
        </h1>
        <div className="page-tools">
          <select className="input input-sm" value={universe} onChange={(e) => setUniverse(e.target.value as typeof universe)} aria-label="Universo" data-testid="scr-universe">
            <option value="all">Todas mis empresas ({companies.length})</option>
            <option value="portfolio">Solo cartera ({pf.holdings.length})</option>
            <option value="watch">Solo seguimiento ({pf.watchlist.length})</option>
          </select>
          <BulkSync companies={rows.map((r) => r.c)} />
        </div>
      </header>

      <section className="wide scr-coverage small muted" data-testid="scr-coverage">
        <Info size={12} /> {rows.length} empresas · {withOfficial} con cifras oficiales (SEC o ESEF) · {withPrice} con precio. Las métricas se calculan con el último ejercicio anual de cada una; pasa el ratón por
        una cifra para ver de dónde sale. Las puntuaciones son percentiles dentro de este universo.
      </section>

      <section className="card wide">
        <div className="side-label">Estrategias rápidas</div>
        <div className="chip-filter scr-presets" data-testid="scr-presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'is-on' : ''} onClick={() => setPreset(preset === p.id ? null : p.id)} title={p.note} data-id={p.id}>
              {p.label}
            </button>
          ))}
        </div>
        {activePreset && <p className="hint">{activePreset.note} Una empresa sin el dato no pasa el filtro.</p>}
        <div className="scr-filters">
          <input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ticker o nombre" aria-label="Buscar" data-testid="scr-search" />
          <select className="input input-sm" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zona">
            <option value="">Todas las zonas</option>
            {['España', 'Europa', 'EE. UU.', 'Sin país'].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <RangeFilter onAdd={(k, min, max) => setCustom((c) => ({ ...c, [k]: [min, max] }))} />
          {Object.entries(custom).map(([k, [min, max] = [undefined, undefined]]) => (
            <span key={k} className="tag scr-chip">
              {SCREEN_METRIC[k as ScreenKey].label} {min !== undefined ? `≥ ${fmtCell(k as ScreenKey, { value: min, note: '' })}` : ''} {max !== undefined ? `≤ ${fmtCell(k as ScreenKey, { value: max, note: '' })}` : ''}
              <button
                className="icon-btn icon-btn-xs"
                aria-label="Quitar filtro"
                onClick={() =>
                  setCustom((c) => {
                    const n = { ...c };
                    delete n[k as ScreenKey];
                    return n;
                  })
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      </section>

      <nav className="dossier-tabs wide" role="tablist">
        {Object.keys(VIEWS).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)} data-view={v}>
            {v}
          </button>
        ))}
        <span className="scr-count muted small mono" data-testid="scr-count">
          {shown.length} de {rows.length}
        </span>
      </nav>

      <section className="wide">
        <div className="table-wrap card">
          <table className="fin-table scr-table" data-testid="scr-table">
            <thead>
              <tr>
                <th className="l">
                  <button className="th-sort" onClick={() => setSort((s) => ({ k: 'name', dir: s.k === 'name' ? ((-s.dir) as 1 | -1) : 1 }))}>
                    Empresa
                  </button>
                </th>
                {cols.map((k) => (
                  <th key={k} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    <button className="th-sort" onClick={() => setSort((s) => ({ k, dir: s.k === k ? ((-s.dir) as 1 | -1) : SCREEN_METRIC[k].better === 'low' ? 1 : -1 }))}>
                      {SCREEN_METRIC[k].label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.c.id} className="scr-row" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${r.c.id}` })} data-testid="scr-row" data-ticker={r.c.ticker ?? ''}>
                  <td className="l">
                    <span className="pf-co">
                      <TickerChip company={r.c} size="sm" />
                      <span className="ellipsis">{r.c.name}</span>
                      {r.lastFy && <span className="tag-mini">{r.lastFy}</span>}
                    </span>
                  </td>
                  {cols.map((k) => (
                    <td key={k} className={`mono ${r.m[k].value === null ? 'muted' : ''}`} title={r.m[k].note} data-key={k}>
                      {fmtCell(k, r.m[k])}
                    </td>
                  ))}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="muted">
                    Ninguna empresa cumple los filtros (las que no tienen el dato no pasan).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card wide">
        <div className="card-head">
          <h2>Mapa calidad / precio</h2>
          <div className="scr-axes">
            <label className="small muted">
              Eje X{' '}
              <select className="input input-sm" value={axes.x} onChange={(e) => setAxes((a) => ({ ...a, x: e.target.value as ScreenKey }))}>
                {SCREEN_METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted">
              Eje Y{' '}
              <select className="input input-sm" value={axes.y} onChange={(e) => setAxes((a) => ({ ...a, y: e.target.value as ScreenKey }))}>
                {SCREEN_METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <Scatter rows={shown} x={axes.x} y={axes.y} />
      </section>
      <p className="hint wide scr-foot">
        Datos: cuentas oficiales (SEC EDGAR, ESEF) y tus cifras del cuaderno; precio retrasado, capturado o manual, convertido con tipos del BCE cuando la moneda no coincide. Sin datos de consenso, RSI ni beta: no hay fuente
        gratuita que lo permita. No es asesoramiento financiero.
      </p>
    </div>
  );
}

function RangeFilter({ onAdd }: { onAdd: (k: ScreenKey, min: number | undefined, max: number | undefined) => void }) {
  const [k, setK] = useState<ScreenKey>('roic');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const pctHint = SCREEN_METRIC[k].fmt === 'pct' ? ' (%)' : '';
  return (
    <span className="scr-range">
      <select className="input input-sm" value={k} onChange={(e) => setK(e.target.value as ScreenKey)} aria-label="Métrica" data-testid="scr-range-metric">
        {SCREEN_METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <input className="input input-sm mono input-xs" value={min} onChange={(e) => setMin(e.target.value)} placeholder={`mín${pctHint}`} aria-label="Mínimo" data-testid="scr-range-min" />
      <input className="input input-sm mono input-xs" value={max} onChange={(e) => setMax(e.target.value)} placeholder={`máx${pctHint}`} aria-label="Máximo" data-testid="scr-range-max" />
      <button
        className="btn btn-sm"
        onClick={() => {
          const a = parseBound(k, min);
          const b = parseBound(k, max);
          if (a === undefined && b === undefined) return;
          onAdd(k, a, b);
          setMin('');
          setMax('');
        }}
        data-testid="scr-range-add"
      >
        Añadir filtro
      </button>
    </span>
  );
}

const ZONE_COLOR: Record<string, string> = { España: 'var(--accent)', Europa: 'var(--warn)', 'EE. UU.': 'var(--pos)', 'Sin país': 'var(--muted)' };

function Scatter({ rows, x, y }: { rows: Row[]; x: ScreenKey; y: ScreenKey }) {
  const pts = rows.filter((r) => r.m[x].value !== null && r.m[y].value !== null);
  const [hover, setHover] = useState<Row | null>(null);
  if (pts.length < 2) return <p className="muted small">Hacen falta al menos dos empresas con ambos datos.</p>;
  const W = 760;
  const H = 360;
  const mg = { t: 12, r: 16, b: 36, l: 56 };
  const xs = pts.map((p) => p.m[x].value!);
  const ys = pts.map((p) => p.m[y].value!);
  const pad = (a: number, b: number) => (b - a || Math.abs(a) || 1) * 0.08;
  const [x0, x1] = [Math.min(...xs) - pad(Math.min(...xs), Math.max(...xs)), Math.max(...xs) + pad(Math.min(...xs), Math.max(...xs))];
  const [y0, y1] = [Math.min(...ys) - pad(Math.min(...ys), Math.max(...ys)), Math.max(...ys) + pad(Math.min(...ys), Math.max(...ys))];
  const X = (v: number) => mg.l + ((v - x0) / (x1 - x0)) * (W - mg.l - mg.r);
  const Y = (v: number) => mg.t + (1 - (v - y0) / (y1 - y0)) * (H - mg.t - mg.b);
  const ticks = (a: number, b: number) => [0, 1, 2, 3, 4].map((i) => a + ((b - a) * i) / 4);
  return (
    <div className="scr-scatter" data-testid="scr-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${SCREEN_METRIC[x].label} frente a ${SCREEN_METRIC[y].label}`}>
        {ticks(y0, y1).map((v, i) => (
          <g key={`y${i}`}>
            <line x1={mg.l} x2={W - mg.r} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
            <text x={mg.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
              {fmtCell(y, { value: v, note: '' })}
            </text>
          </g>
        ))}
        {ticks(x0, x1).map((v, i) => (
          <text key={`x${i}`} x={X(v)} y={H - mg.b + 16} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
            {fmtCell(x, { value: v, note: '' })}
          </text>
        ))}
        <text x={(mg.l + W - mg.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--text-2)">
          {SCREEN_METRIC[x].label}
        </text>
        <text x={12} y={(mg.t + H - mg.b) / 2} textAnchor="middle" fontSize="11" fill="var(--text-2)" transform={`rotate(-90 12 ${(mg.t + H - mg.b) / 2})`}>
          {SCREEN_METRIC[y].label}
        </text>
        {pts.map((p) => (
          <g key={p.c.id} className="scr-dot" onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${p.c.id}` })}>
            <circle cx={X(p.m[x].value!)} cy={Y(p.m[y].value!)} r={hover === p ? 7 : 5} fill={ZONE_COLOR[p.zone] ?? 'var(--muted)'} fillOpacity="0.85" stroke="var(--bg)" />
            <text x={X(p.m[x].value!) + 8} y={Y(p.m[y].value!) + 4} fontSize="10" fill="var(--text-2)" fontFamily="var(--mono)">
              {p.c.ticker ?? ''}
            </text>
          </g>
        ))}
      </svg>
      <div className="small mono muted">{hover ? `${hover.c.ticker ?? hover.c.name} · ${SCREEN_METRIC[x].label} ${fmtCell(x, hover.m[x])} · ${SCREEN_METRIC[y].label} ${fmtCell(y, hover.m[y])}` : ' '}</div>
      <div className="mixlegend small">
        {Object.entries(ZONE_COLOR).map(([z, c]) => (
          <span key={z}>
            <i style={{ background: c }} />
            {z}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Import official figures for many companies, one after another (each client keeps
 * its own rate limit). US companies without a CIK are linked only on an exact
 * ticker match; European ones need their LEI linked once in the dossier.
 */
function BulkSync({ companies }: { companies: Company[] }) {
  const [state, setState] = useState<{ done: number; total: number; current: string; ok: number; skipped: string[] } | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const cancel = useRef(false);
  const run = async () => {
    cancel.current = false;
    const list = companies;
    const skipped: string[] = [];
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancel.current) break;
      const c = list[i]!;
      setState({ done: i, total: list.length, current: c.ticker ?? c.name, ok, skipped });
      try {
        if (c.cik) {
          await ib.invoke('sec:sync', { companyId: c.id });
          ok++;
        } else if (c.lei) {
          await ib.invoke('esef:sync', { companyId: c.id });
          ok++;
        } else if (c.ticker && isUsExchange(c.exchange)) {
          const hits = await ib.invoke('sec:searchTicker', { query: c.ticker });
          const exact = hits.find((h) => h.ticker.toUpperCase() === c.ticker!.toUpperCase());
          if (exact) {
            await ib.invoke('sec:link', { companyId: c.id, cik: exact.cik });
            await ib.invoke('sec:sync', { companyId: c.id });
            ok++;
          } else skipped.push(`${c.ticker}: no aparece en la SEC`);
        } else skipped.push(`${c.ticker ?? c.name}: vincula su LEI (ESEF) o su CIK en el dossier`);
      } catch (err) {
        skipped.push(`${c.ticker ?? c.name}: ${errorMessage(err)}`);
        if (/contacto|contact/i.test(errorMessage(err))) break; // no consent yet: stop and say so
      }
    }
    setState(null);
    setReport(skipped.length ? skipped : null);
    showToast(`Cifras oficiales: ${ok} empresa(s) actualizadas${skipped.length ? ` · ${skipped.length} sin fuente automática` : ''}`, ok ? 'info' : 'error');
  };
  if (state)
    return (
      <span className="scr-progress small" data-testid="scr-progress">
        <Loader2 size={13} className="spin" /> {state.done}/{state.total} · {state.current}
        <button className="btn btn-sm" onClick={() => (cancel.current = true)}>
          <Square size={11} /> Parar
        </button>
      </span>
    );
  return (
    <>
      {report && (
        <details className="scr-report small" open data-testid="scr-report">
          <summary>{report.length} sin fuente automática</summary>
          <ul>
            {report.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <button className="link-btn small" onClick={() => setReport(null)}>
            Cerrar
          </button>
        </details>
      )}
      <button className="btn btn-sm" onClick={() => void run()} title="Importa o actualiza las cuentas oficiales (SEC / ESEF) de las empresas del universo" data-testid="scr-sync">
        <RefreshCw size={13} /> Cifras oficiales
      </button>
      <button
        className="btn btn-sm"
        onClick={() =>
          void ib
            .invoke('quotes:refresh', { companyIds: companies.map((c) => c.id) })
            .then((r) => showToast(`Cotizaciones: ${r.updated} actualizadas${r.failed.length ? ` · ${r.failed.length} sin dato` : ''}`))
            .catch((err) => showToast(errorMessage(err), 'error'))
        }
      >
        <RefreshCw size={13} /> Cotizaciones
      </button>
    </>
  );
}
