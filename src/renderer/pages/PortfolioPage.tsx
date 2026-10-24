import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Briefcase, Download, Eye, Plus, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react';
import { errorMessage, ib, runCommand, setPortfolio, showToast, useCompanies, usePortfolio } from '../lib/ib';
import { useFx, useManyCompanyFigures } from '../lib/figures';
import { TickerChip } from '../components/research';
import { EmptyState } from '../components/ui';
import type { Company, FxRatesInfo, PortfolioData } from '../../shared/types';
import { fifo, valuePosition, type PortfolioOp, type Position, type Valuation } from '../../shared/portfolio';
import { convert, EXCHANGES, exchangeCurrency, formatAsOf, normalizeQuoteCurrency, priceBadge } from '../../shared/market';
import { countryOf } from '../../shared/esef';
import { buildFigureTable, periodSortKey, type Figure } from '../../shared/finance';

// ---------------------------------------------------------------- formatting

const nf = (d: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${nf(d).format(v)} €`);
const seur = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${eur(v, d)}`);
const pct = (v: number | null | undefined, d = 1, sign = false) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${sign && v > 0 ? '+' : ''}${nf(d).format(v * 100)} %`);
const money = (v: number | null | undefined, cur: string | null, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${nf(d).format(v)} ${cur ?? ''}`.trim());
const shares = (v: number) => nf(Math.abs(v % 1) > 1e-9 ? 4 : 0).format(v);
const cls = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.005 ? '' : v > 0 ? 'pos' : 'neg');
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return null;
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(v) ? v : null;
};

/** Quote currency of a company (London in GBP, as prices are stored). */
function quoteCurrency(c: Company): string {
  if (c.priceCurrency) return c.priceCurrency;
  const raw = exchangeCurrency(c.exchange, c.quoteSymbol);
  return raw === 'GBX' ? 'GBP' : (raw ?? 'EUR');
}
const fxPerEur = (cur: string, fx: FxRatesInfo | null) => (cur === 'EUR' ? 1 : (fx?.perEur[cur] ?? null));

function zoneOf(c: Company): 'España' | 'Europa' | 'EE. UU.' | 'Otros' {
  const cc = countryOf(c);
  if (cc === 'ES') return 'España';
  if (cc === 'US') return 'EE. UU.';
  if (cc && ['DE', 'FR', 'IT', 'NL', 'BE', 'PT', 'FI', 'DK', 'SE', 'NO', 'GB', 'CH', 'AT', 'IE', 'LU'].includes(cc)) return 'Europa';
  return 'Otros';
}
const ZONE_COLOR: Record<string, string> = { España: 'var(--accent)', Europa: 'var(--warn)', 'EE. UU.': 'var(--pos)', Otros: 'var(--muted)' };

interface Row {
  c: Company;
  ops: PortfolioOp[];
  pos: Position;
  cur: string;
  v: Valuation | null;
  weight: number | null;
  dps: { value: number; currency: string | null; period: string } | null;
  divYield: number | null;
}

// ---------------------------------------------------------------- page

export function PortfolioPage() {
  const companies = useCompanies();
  const data = usePortfolio();
  const fx = useFx(true);
  const [tab, setTab] = useState<'hold' | 'watch'>('hold');
  const [open, setOpen] = useState<number | null>(null);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'value', dir: -1 });
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const holdingIds = data.holdings.map((h) => h.companyId).filter((id) => byId.has(id));
  const figures = useManyCompanyFigures(holdingIds);

  const rows: Row[] = useMemo(() => {
    const list = holdingIds.map((id) => {
      const c = byId.get(id)!;
      const ops = data.ops.filter((o) => o.companyId === id);
      const pos = fifo(ops);
      const cur = ops[0]?.currency ?? quoteCurrency(c);
      const price = c.price === null ? null : c.priceCurrency && c.priceCurrency !== cur ? convert(c.price, c.priceCurrency, cur, fx) : c.price;
      const v = valuePosition(pos, price, fxPerEur(cur, fx));
      const dps = latestDps(figures.get(id) ?? []);
      const dpsInPriceCur = dps && c.price !== null ? (dps.currency && c.priceCurrency && dps.currency !== c.priceCurrency ? convert(dps.value, dps.currency, c.priceCurrency, fx) : dps.value) : null;
      return { c, ops, pos, cur, v, weight: null as number | null, dps, divYield: dpsInPriceCur !== null && c.price ? dpsInPriceCur / c.price : null };
    });
    const total = list.reduce((s, r) => s + (r.v?.valueEur ?? 0), 0);
    for (const r of list) r.weight = total > 0 && r.v ? r.v.valueEur / total : null;
    return list;
  }, [data, byId, fx, figures]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRows = rows.filter((r) => r.pos.shares > 0);
  const valued = openRows.filter((r) => r.v);
  const total = valued.reduce((s, r) => s + r.v!.valueEur, 0);
  const cost = valued.reduce((s, r) => s + r.v!.costEur, 0);
  const pnl = total - cost;
  const fxEffect = valued.filter((r) => r.cur !== 'EUR').reduce((s, r) => s + r.v!.fxEffectEur, 0);
  const year = String(new Date().getFullYear());
  const realizedYear = data.holdings.length || data.ops.length ? sumRealized(data.ops, year) : 0;
  const withDiv = valued.filter((r) => r.divYield !== null);
  const divYield = withDiv.length ? withDiv.reduce((s, r) => s + r.v!.valueEur * r.divYield!, 0) / withDiv.reduce((s, r) => s + r.v!.valueEur, 0) : null;
  const missingPrice = openRows.filter((r) => !r.v);
  const oldest = valued.map((r) => r.c.priceAsOf).filter(Boolean).sort()[0] ?? null;

  // One snapshot a day, only when every open position could be valued (no undercounting).
  const snaps = data.snapshots;
  useEffect(() => {
    if (!openRows.length || missingPrice.length || !fx) return;
    const last = snaps.at(-1);
    if (last && last.date === today() && Math.abs(last.totalEur - total) < 0.5) return;
    void ib.invoke('portfolio:snapshot', { date: today(), totalEur: +total.toFixed(2), costEur: +cost.toFixed(2), positions: openRows.length });
  }, [total, missingPrice.length, openRows.length, fx]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshQuotes = async () => {
    setBusy(true);
    try {
      const r = await ib.invoke('quotes:refresh', { companyIds: holdingIds.concat(data.watchlist.map((w) => w.companyId)), force: true });
      showToast(`Cotizaciones: ${r.updated} actualizadas${r.failed.length ? ` · ${r.failed.length} sin dato` : ''}`, r.failed.length && !r.updated ? 'error' : 'info');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const val = (r: Row): number | string | null =>
      sort.k === 'name' ? (r.c.ticker ?? r.c.name) : sort.k === 'value' ? (r.v?.valueEur ?? null) : sort.k === 'pnl' ? (r.v?.pnlPct ?? null) : sort.k === 'weight' ? r.weight : sort.k === 'div' ? r.divYield : sort.k === 'fx' ? (r.v?.fxEffectEur ?? null) : null;
    const va = val(a);
    const vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return typeof va === 'string' ? sort.dir * va.localeCompare(String(vb), 'es') : sort.dir * (va - (vb as number));
  });
  const th = (k: string, label: string, left = false) => (
    <th className={left ? 'l' : ''} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className="th-sort" onClick={() => setSort((s) => ({ k, dir: s.k === k ? ((-s.dir) as 1 | -1) : k === 'name' ? 1 : -1 }))}>
        {label}
      </button>
    </th>
  );

  return (
    <div className="page portfolio" data-testid="portfolio-page">
      <header className="page-head wide">
        <h1>
          <Briefcase size={18} /> Cartera
        </h1>
        <div className="page-tools">
          <button className="btn btn-sm" onClick={() => void refreshQuotes()} disabled={busy} data-testid="pf-refresh">
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> Cotizaciones
          </button>
          <button className="btn btn-sm" onClick={() => runCommand('portfolio.import')} data-testid="pf-import">
            <Upload size={13} /> Importar
          </button>
          <button className="btn btn-sm" onClick={() => runCommand('portfolio.export')} disabled={!data.holdings.length}>
            <Download size={13} /> Exportar
          </button>
        </div>
      </header>

      <section className="card pf-summary wide" data-testid="pf-summary">
        <div className="kpis">
          <div className="kpi kpi-main">
            <div className="kpi-label">Patrimonio en bolsa</div>
            <div className="kpi-value mono" data-testid="pf-total">
              {valued.length ? eur(total) : '—'}
            </div>
            <div className="kpi-sub">
              {openRows.length ? `${openRows.length} posiciones${missingPrice.length ? ` · ${missingPrice.length} sin precio` : ''}${oldest ? ` · precio más antiguo: ${formatAsOf(oldest)}` : ''}` : 'Añade posiciones para calcularlo'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Plusvalía latente</div>
            <div className={`kpi-value mono ${cls(valued.length ? pnl : null)}`} data-testid="pf-pnl">
              {valued.length ? seur(pnl) : '—'}
            </div>
            <div className="kpi-sub">{valued.length ? `${pct(cost ? pnl / cost : null, 1, true)} sobre coste · efecto divisa ${seur(fxEffect)}` : 'Necesita precio de compra y cotización'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Desde la última foto</div>
            <SnapshotDelta snaps={snaps} />
          </div>
          <div className="kpi">
            <div className="kpi-label">Ganancias realizadas {year}</div>
            <div className={`kpi-value mono ${cls(realizedYear)}`} data-testid="pf-realized">
              {seur(realizedYear)}
            </div>
            <div className="kpi-sub">FIFO, comisiones y divisa incluidas</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Rent. dividendo</div>
            <div className="kpi-value mono">{pct(divYield, 2)}</div>
            <div className="kpi-sub">{withDiv.length ? `${withDiv.length} de ${valued.length} con DPA oficial · ponderada` : 'Sin dividendos por acción oficiales'}</div>
          </div>
        </div>
        <div className="pf-charts">
          <EvolutionChart snaps={snaps} />
          <ZoneMix rows={valued} total={total} />
        </div>
      </section>

      <nav className="dossier-tabs wide" role="tablist">
        <button role="tab" aria-selected={tab === 'hold'} className={tab === 'hold' ? 'is-on' : ''} onClick={() => setTab('hold')} data-testid="pf-tab-hold">
          Cartera <span className="count mono">{openRows.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'watch'} className={tab === 'watch' ? 'is-on' : ''} onClick={() => setTab('watch')} data-testid="pf-tab-watch">
          <Eye size={13} /> Seguimiento <span className="count mono">{data.watchlist.length}</span>
        </button>
      </nav>

      {tab === 'hold' && (
        <section className="wide">
          {rows.length === 0 ? (
            <EmptyState icon={<Briefcase size={28} />} title="Tu cartera está vacía">
              Añade una posición abajo o importa tu cartera (JSON de Investor Browser o CSV de tu bróker con ticker, acciones y precio).
            </EmptyState>
          ) : (
            <div className="table-wrap card">
              <table className="fin-table pf-table" data-testid="pf-table">
                <thead>
                  <tr>
                    {th('name', 'Empresa', true)}
                    <th>Acciones</th>
                    <th>Precio medio</th>
                    <th>Precio</th>
                    {th('value', 'Valor €')}
                    {th('weight', 'Peso')}
                    {th('pnl', 'Plusvalía')}
                    {th('fx', 'Efecto divisa')}
                    {th('div', 'Div.')}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <Fragment key={r.c.id}>
                      <tr className={`pf-row ${open === r.c.id ? 'is-open' : ''} ${r.pos.shares <= 0 ? 'is-closed' : ''}`} onClick={() => setOpen(open === r.c.id ? null : r.c.id)} data-testid="pf-row" data-ticker={r.c.ticker ?? ''}>
                        <td className="l">
                          <span className="pf-co">
                            <TickerChip company={r.c} size="sm" />
                            <span className="ellipsis">{r.c.name}</span>
                            {r.pos.shares <= 0 && r.ops.length > 0 && <span className="tag-mini">vendida</span>}
                          </span>
                        </td>
                        <td className="mono">{r.ops.length ? shares(r.pos.shares) : '—'}</td>
                        <td className="mono">{money(r.pos.avgCost, r.cur)}</td>
                        <td className="mono" title={r.c.price !== null ? `${priceBadge(r.c.priceKind)} · ${formatAsOf(r.c.priceAsOf)} · ${r.c.priceSource ?? ''}` : 'Sin cotización'}>
                          {r.c.price !== null ? money(r.c.price, r.c.priceCurrency) : <span className="muted">sin precio</span>}
                        </td>
                        <td className="mono" data-testid="pf-value">
                          {eur(r.v?.valueEur)}
                        </td>
                        <td className="mono">
                          {r.weight !== null && <span className="pf-bar" style={{ width: `${Math.max(2, r.weight * 60)}px` }} />}
                          {pct(r.weight)}
                        </td>
                        <td className={`mono ${cls(r.v?.pnlEur)}`}>
                          {seur(r.v?.pnlEur)}
                          {r.v && <span className="sub">{pct(r.v.pnlPct, 1, true)}</span>}
                        </td>
                        <td className={`mono ${r.cur === 'EUR' ? 'muted' : cls(r.v?.fxEffectEur)}`}>{r.cur === 'EUR' ? '' : seur(r.v?.fxEffectEur)}</td>
                        <td className="mono" title={r.dps ? `DPA ${r.dps.period}: ${r.dps.value} ${r.dps.currency ?? ''} (oficial)` : 'Sin DPA oficial'}>
                          {pct(r.divYield, 2)}
                        </td>
                      </tr>
                      {open === r.c.id && (
                        <tr className="pf-detail">
                          <td colSpan={9}>
                            <HoldingDetail row={r} fx={fx} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                {valued.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="l">Total</td>
                      <td />
                      <td />
                      <td />
                      <td className="mono">{eur(total)}</td>
                      <td className="mono">100 %</td>
                      <td className={`mono ${cls(pnl)}`}>{seur(pnl)}</td>
                      <td className={`mono ${cls(fxEffect)}`}>{seur(fxEffect)}</td>
                      <td className="mono">{pct(divYield, 2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          {missingPrice.length > 0 && (
            <p className="notice small">
              <TriangleAlert size={13} /> Sin precio: {missingPrice.map((r) => r.c.ticker ?? r.c.name).join(', ')}. Configura una clave gratuita (Ajustes › Fuentes de datos), revisa el símbolo en su dossier o captura el precio desde una web.
            </p>
          )}
          <AddForm mode="hold" companies={companies} fx={fx} />
          <p className="hint">
            Acciones, precio medio y coste se calculan por FIFO a partir de las operaciones, como en el IRPF. Cada operación guarda su tipo de cambio, así que la plusvalía en euros se separa en efecto precio y efecto divisa.
            Los precios son retrasados o capturados, con su hora (pasa el ratón por el precio). No es asesoramiento financiero.
          </p>
        </section>
      )}

      {tab === 'watch' && <Watchlist data={data} byId={byId} companies={companies} fx={fx} />}
    </div>
  );
}

function sumRealized(ops: PortfolioOp[], year: string): number {
  const byCompany = new Map<number, PortfolioOp[]>();
  for (const o of ops) byCompany.set(o.companyId, [...(byCompany.get(o.companyId) ?? []), o]);
  let s = 0;
  for (const list of byCompany.values()) s += fifo(list).realizedByYear[year] ?? 0;
  return s;
}

function latestDps(figs: Figure[]): { value: number; currency: string | null; period: string } | null {
  const t = buildFigureTable(figs);
  const fy = [...t.keys()].filter((p) => p.startsWith('FY')).sort((a, b) => periodSortKey(b) - periodSortKey(a));
  for (const p of fy.slice(0, 2)) {
    const v = t.get(p)?.get('dividend_per_share');
    if (v && v.value > 0) return { value: v.value, currency: v.currency?.split('/')[0] ?? null, period: p };
  }
  return null;
}

// ---------------------------------------------------------------- summary widgets

function SnapshotDelta({ snaps }: { snaps: PortfolioData['snapshots'] }) {
  const s = snaps.filter((x) => x.totalEur > 0);
  const last = s.at(-1);
  const prev = s.length > 1 ? s.at(-2) : undefined;
  if (!last || !prev)
    return (
      <>
        <div className="kpi-value mono">—</div>
        <div className="kpi-sub">Se guarda una foto diaria del patrimonio</div>
      </>
    );
  const d = last.totalEur - prev.totalEur;
  return (
    <>
      <div className={`kpi-value mono ${cls(d)}`}>{seur(d)}</div>
      <div className="kpi-sub">
        {pct(d / prev.totalEur, 2, true)} entre {prev.date} y {last.date}
      </div>
    </>
  );
}

function EvolutionChart({ snaps }: { snaps: PortfolioData['snapshots'] }) {
  const pts = snaps.filter((s) => s.totalEur > 0);
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2)
    return (
      <div className="pf-chart empty muted small" data-testid="pf-chart">
        {pts.length === 1 ? `Primera foto del ${pts[0]!.date}: ${eur(pts[0]!.totalEur)}. La línea aparece desde el segundo día.` : 'La evolución se dibuja con una foto diaria del patrimonio, cuando todas las posiciones tienen precio.'}
      </div>
    );
  const W = 600;
  const H = 150;
  const pad = { l: 6, r: 64, t: 10, b: 20 };
  const xs = pts.map((p) => Date.parse(p.date));
  const ys = pts.map((p) => p.totalEur);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys, ...pts.map((p) => p.costEur));
  let y1 = Math.max(...ys, ...pts.map((p) => p.costEur));
  const m = (y1 - y0 || y1 * 0.02) * 0.12;
  y0 -= m;
  y1 += m;
  const X = (t: number) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]!).toFixed(1)} ${Y(p.totalEur).toFixed(1)}`).join(' ');
  const costLine = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]!).toFixed(1)} ${Y(p.costEur).toFixed(1)}`).join(' ');
  const h = hover !== null ? pts[hover]! : null;
  return (
    <div className="pf-chart" data-testid="pf-chart">
      <div className="side-label">Evolución del patrimonio (EUR) · línea discontinua: coste</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Evolución del patrimonio"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const mx = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          xs.forEach((t, i) => {
            if (Math.abs(X(t) - mx) < Math.abs(X(xs[best]!) - mx)) best = i;
          });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3].map((i) => {
          const v = y0 + ((y1 - y0) * i) / 3;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
              <text x={W - pad.r + 6} y={Y(v) + 4} fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
                {nf(0).format(v / 1000)}k €
              </text>
            </g>
          );
        })}
        <path d={costLine} fill="none" stroke="var(--muted)" strokeDasharray="4 3" strokeWidth="1.2" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {h && <circle cx={X(Date.parse(h.date))} cy={Y(h.totalEur)} r="4" fill="var(--accent)" />}
        <text x={pad.l} y={H - 4} fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
          {pts[0]!.date}
        </text>
        <text x={W - pad.r} y={H - 4} fontSize="10" fill="var(--muted)" fontFamily="var(--mono)" textAnchor="end">
          {pts.at(-1)!.date}
        </text>
      </svg>
      <div className="small mono muted pf-chart-read">{h ? `${h.date} · ${eur(h.totalEur)} · coste ${eur(h.costEur)}` : ' '}</div>
    </div>
  );
}

function ZoneMix({ rows, total }: { rows: Row[]; total: number }) {
  const zones = new Map<string, number>();
  for (const r of rows) zones.set(zoneOf(r.c), (zones.get(zoneOf(r.c)) ?? 0) + (r.v?.valueEur ?? 0));
  const ccy = new Map<string, number>();
  for (const r of rows) ccy.set(r.cur, (ccy.get(r.cur) ?? 0) + (r.v?.valueEur ?? 0));
  if (!total) return null;
  return (
    <div className="pf-mix" data-testid="pf-mix">
      <div className="side-label">Reparto por zona</div>
      <div className="mixbar">
        {[...zones].map(([z, v]) => (
          <span key={z} style={{ width: `${(v / total) * 100}%`, background: ZONE_COLOR[z] }} title={`${z} ${pct(v / total, 1)}`} />
        ))}
      </div>
      <div className="mixlegend small">
        {[...zones].map(([z, v]) => (
          <span key={z}>
            <i style={{ background: ZONE_COLOR[z] }} />
            {z} {pct(v / total, 0)}
          </span>
        ))}
      </div>
      <div className="side-label">Por divisa</div>
      <div className="mixlegend small mono">
        {[...ccy]
          .sort((a, b) => b[1] - a[1])
          .map(([c, v]) => (
            <span key={c}>
              {c} {pct(v / total, 0)}
            </span>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- holding detail

function HoldingDetail({ row, fx }: { row: Row; fx: FxRatesInfo | null }) {
  const { c, pos, v, cur } = row;
  const [armed, setArmed] = useState<number | 'remove' | null>(null);
  const year = String(new Date().getFullYear());
  const del = async (id: number) => {
    if (armed !== id) {
      setArmed(id);
      setTimeout(() => setArmed(null), 4000);
      return;
    }
    setPortfolio(await ib.invoke('portfolio:removeOp', { id }));
  };
  const removeHolding = async () => {
    if (armed !== 'remove') {
      setArmed('remove');
      setTimeout(() => setArmed(null), 4000);
      return;
    }
    setPortfolio(await ib.invoke('portfolio:remove', { companyId: c.id }));
  };
  const avgFx = v && cur !== 'EUR' && v.costEur > 0 ? pos.lots.reduce((s, l) => s + l.qty * l.unitLocal, 0) / v.costEur : null;
  const items: [string, string, string?, string?][] = [
    ['Acciones', shares(pos.shares)],
    ['Precio medio', money(pos.avgCost, cur), 'FIFO, comisiones incluidas'],
    ['Coste', eur(v?.costEur ?? pos.costEur, 2), 'al tipo de cambio de cada compra'],
    ['Valor', eur(v?.valueEur, 2)],
    ['Plusvalía latente', seur(v?.pnlEur, 2), pct(v?.pnlPct, 2, true), cls(v?.pnlEur)],
    ['Efecto precio', seur(v?.priceEffectEur, 2), 'subida o bajada de la acción', cls(v?.priceEffectEur)],
  ];
  if (cur !== 'EUR') items.push(['Efecto divisa', seur(v?.fxEffectEur, 2), avgFx ? `${cur}/€ compra ${nf(4).format(avgFx)} · hoy ${fx?.perEur[cur] ? nf(4).format(fx.perEur[cur]!) : '—'}` : undefined, cls(v?.fxEffectEur)]);
  items.push(['Realizada', seur(pos.realizedTotal, 2), pos.realizedByYear[year] !== undefined ? `${year}: ${seur(pos.realizedByYear[year], 2)}` : 'total histórico', cls(pos.realizedTotal)]);
  return (
    <div className="pf-detail-body" data-testid="pf-detail">
      <div className="dgrid">
        {items.map(([k, val, sub, tone]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className={`v mono ${tone ?? ''}`}>
              {val}
              {sub && <small>{sub}</small>}
            </div>
          </div>
        ))}
      </div>
      {pos.warning && (
        <p className="notice small">
          <TriangleAlert size={13} /> {pos.warning}
        </p>
      )}
      <OpForm company={c} cur={cur} fx={fx} position={pos} />
      <div className="side-label">Operaciones ({row.ops.length})</div>
      {row.ops.length === 0 ? (
        <p className="muted small">Sin operaciones: registra la compra con la que entraste.</p>
      ) : (
        <table className="fin-table pf-ops">
          <thead>
            <tr>
              <th className="l">Fecha</th>
              <th className="l">Tipo</th>
              <th>Acciones</th>
              <th>Precio</th>
              <th>Comisión</th>
              {cur !== 'EUR' && <th>{cur}/€</th>}
              <th>Total €</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...row.ops].reverse().map((o) => {
              const gross = (o.qty * o.price) / o.fxPerEur;
              return (
                <tr key={o.id} data-testid="pf-op">
                  <td className="l mono">{o.date ?? (o.source === 'inicial' ? 'posición inicial' : 'sin fecha')}</td>
                  <td className="l">
                    <span className={`tag ${o.side === 'buy' ? 'tag-pos' : 'tag-neg'}`}>{o.side === 'buy' ? 'compra' : 'venta'}</span>
                  </td>
                  <td className="mono">{shares(o.qty)}</td>
                  <td className="mono">{money(o.price, o.currency)}</td>
                  <td className="mono">{eur(o.feeEur, 2)}</td>
                  {cur !== 'EUR' && <td className="mono">{nf(4).format(o.fxPerEur)}</td>}
                  <td className="mono">{eur(o.side === 'buy' ? gross + o.feeEur : gross - o.feeEur, 2)}</td>
                  <td>
                    <button className="link-btn small" onClick={() => void del(o.id!)}>
                      {armed === o.id ? '¿Seguro?' : 'Borrar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="pf-detail-foot">
        <button className="btn btn-sm" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })}>
          <ArrowUpRight size={12} /> Dossier
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => void removeHolding()} data-testid="pf-remove">
          {armed === 'remove' ? 'Pulsa otra vez para confirmar' : 'Quitar de la cartera'}
        </button>
        <span className="muted small">Quitarla no borra sus operaciones: las ganancias realizadas siguen contando.</span>
      </div>
    </div>
  );
}

function OpForm({ company, cur, fx, position }: { company: Company; cur: string; fx: FxRatesInfo | null; position: Position | null }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(company.price !== null && (company.priceCurrency ?? cur) === cur ? String(company.price).replace('.', ',') : '');
  const [fee, setFee] = useState('');
  const [rate, setRate] = useState(cur === 'EUR' ? '1' : fx?.perEur[cur] ? String(fx.perEur[cur]).replace('.', ',') : '');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (cur !== 'EUR' && !rate && fx?.perEur[cur]) setRate(String(fx.perEur[cur]).replace('.', ','));
  }, [fx]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = num(qty);
  const p = num(price);
  const f = num(fee) ?? 0;
  const r = cur === 'EUR' ? 1 : num(rate);
  const preview = q && p !== null && r ? (q * p) / r + (side === 'buy' ? f : -f) : null;
  const tooMany = side === 'sell' && q !== null && position && q > position.shares + 1e-9;
  const submit = async () => {
    setMsg('');
    if (!q || q <= 0) return setMsg('Indica cuántas acciones.');
    if (p === null || p < 0) return setMsg('Indica el precio por acción.');
    if (!r || r <= 0) return setMsg(`Indica el tipo de cambio (${cur} por 1 €).`);
    if (tooMany) return setMsg(`Solo tienes ${shares(position!.shares)} acciones.`);
    try {
      setPortfolio(await ib.invoke('portfolio:addOp', { companyId: company.id, date: date || null, side, qty: q, price: p, currency: cur, feeEur: f, fxPerEur: r }));
      setQty('');
      setFee('');
      setMsg(side === 'buy' ? 'Compra registrada.' : 'Venta registrada.');
    } catch (err) {
      setMsg(errorMessage(err));
    }
  };
  return (
    <div className="pf-opform" data-testid="pf-opform">
      <div className="seg" role="group" aria-label="Tipo de operación">
        <button aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>
          Compra
        </button>
        <button aria-pressed={side === 'sell'} className="sell" onClick={() => setSide('sell')} disabled={!position || position.shares <= 0}>
          Venta
        </button>
      </div>
      <label>
        Fecha
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Acciones
        <input className="input mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" data-testid="op-qty" />
      </label>
      <label>
        Precio ({cur})
        <input className="input mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="op-price" />
      </label>
      <label>
        Comisión (€)
        <input className="input mono" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,00" data-testid="op-fee" />
      </label>
      {cur !== 'EUR' && (
        <label title="Tipo de cambio del día de la operación: unidades de la divisa por 1 €. Se propone el de referencia del BCE de hoy; pon el de tu bróker si lo conoces.">
          {cur} por 1 €
          <input className="input mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="op-fx" />
        </label>
      )}
      <button className="btn btn-primary btn-sm" onClick={() => void submit()} data-testid="op-save">
        {side === 'buy' ? 'Registrar compra' : 'Registrar venta'}
      </button>
      {side === 'sell' && position && position.shares > 0 && (
        <button className="link-btn small" onClick={() => setQty(String(position.shares).replace('.', ','))}>
          Vender todas
        </button>
      )}
      <div className="pf-preview small mono">
        {preview !== null && (
          <>
            {side === 'buy' ? 'Pagas' : 'Cobras'} <b>{eur(preview, 2)}</b>
            {cur !== 'EUR' && ` (${money(q! * p!, cur)} a ${rate} ${cur}/€)`}
          </>
        )}
        {tooMany && <span className="neg"> · más acciones de las que tienes</span>}
        {msg && <span className="pf-msg"> {msg}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add position / watch

function AddForm({ mode, companies, fx }: { mode: 'hold' | 'watch'; companies: Company[]; fx: FxRatesInfo | null }) {
  const [companyId, setCompanyId] = useState<number | 'new' | ''>('');
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [exchange, setExchange] = useState('BME');
  const [qty, setQty] = useState('');
  const [avg, setAvg] = useState('');
  const [costEur, setCostEur] = useState('');
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [formOpen, setFormOpen] = useState(mode === 'hold' && companies.length === 0);
  const chosen = typeof companyId === 'number' ? companies.find((c) => c.id === companyId) : null;
  const cur = chosen ? quoteCurrency(chosen) : (normalizeQuoteCurrency(1, EXCHANGES[exchange]?.currency ?? 'EUR').currency ?? 'EUR');

  const submit = async () => {
    setMsg('');
    try {
      let id: number;
      if (companyId === 'new') {
        if (!name.trim() || !ticker.trim()) return setMsg('Indica nombre y ticker.');
        id = (await ib.invoke('companies:save', { name: name.trim(), ticker: ticker.trim().toUpperCase(), exchange })).id;
      } else if (typeof companyId === 'number') id = companyId;
      else return setMsg('Elige una empresa.');
      if (mode === 'watch') {
        setPortfolio(await ib.invoke('watchlist:set', { companyId: id, target: num(target), note: null }));
      } else {
        const q = num(qty);
        const a = num(avg);
        if (q && a !== null) {
          const ce = num(costEur);
          const fxr = cur === 'EUR' ? 1 : ce ? (q * a) / ce : fx?.perEur[cur];
          if (!fxr) return setMsg(`Falta el tipo de cambio de ${cur}: indica el coste total en euros.`);
          setPortfolio(await ib.invoke('portfolio:addOp', { companyId: id, date: null, side: 'buy', qty: q, price: a, currency: cur, feeEur: 0, fxPerEur: fxr }));
        } else setPortfolio(await ib.invoke('portfolio:add', { companyId: id }));
      }
      setCompanyId('');
      setName('');
      setTicker('');
      setQty('');
      setAvg('');
      setCostEur('');
      setTarget('');
      setMsg(mode === 'watch' ? 'Añadida a seguimiento.' : 'Posición añadida.');
    } catch (err) {
      setMsg(errorMessage(err));
    }
  };

  return (
    <details className="card pf-add" data-testid={`pf-add-${mode}`} open={formOpen} onToggle={(e) => setFormOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Plus size={13} /> {mode === 'watch' ? 'Añadir empresa a seguimiento' : 'Añadir posición'}
      </summary>
      <div className="pf-opform">
        <label>
          Empresa
          <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value === 'new' ? 'new' : e.target.value ? Number(e.target.value) : '')} data-testid="add-company">
            <option value="">Elige…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ticker ? `${c.ticker} · ` : ''}
                {c.name}
                {c.exchange ? ` (${c.exchange})` : ''}
              </option>
            ))}
            <option value="new">+ Nueva empresa…</option>
          </select>
        </label>
        {companyId === 'new' && (
          <>
            <label>
              Nombre
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="add-name" />
            </label>
            <label>
              Ticker
              <input className="input mono" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} data-testid="add-ticker" />
            </label>
            <label>
              Bolsa
              <select className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} data-testid="add-exchange">
                {Object.entries(EXCHANGES)
                  .filter(([k]) => !['XETRA', 'SIX', 'LSE', 'NYSEARCA', 'AMEX'].includes(k))
                  .map(([k, e]) => (
                    <option key={k} value={k}>
                      {k} · {e.label}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {mode === 'hold' ? (
          <>
            <label>
              Acciones
              <input className="input mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="opcional" data-testid="add-qty" />
            </label>
            <label>
              Precio medio ({cur})
              <input className="input mono" inputMode="decimal" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="opcional" data-testid="add-avg" />
            </label>
            {cur !== 'EUR' && (
              <label title="Lo que te costó en euros, comisiones incluidas. Fija el tipo de cambio de compra para separar el efecto divisa.">
                Coste total (€)
                <input className="input mono" inputMode="decimal" value={costEur} onChange={(e) => setCostEur(e.target.value)} placeholder="recomendado" data-testid="add-cost-eur" />
              </label>
            )}
          </>
        ) : (
          <label>
            Precio objetivo
            <input className="input mono" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="opcional" data-testid="add-target" />
          </label>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => void submit()} data-testid="add-save">
          Añadir
        </button>
        {msg && <span className="small pf-msg">{msg}</span>}
      </div>
    </details>
  );
}

function Watchlist({ data, byId, companies, fx }: { data: PortfolioData; byId: Map<number, Company>; companies: Company[]; fx: FxRatesInfo | null }) {
  const held = new Set(data.holdings.map((h) => h.companyId));
  const rows = data.watchlist
    .map((w) => ({ w, c: byId.get(w.companyId) }))
    .filter((x): x is { w: (typeof data.watchlist)[number]; c: Company } => !!x.c)
    .map((x) => ({ ...x, dist: x.c.price !== null && x.w.target ? x.c.price / x.w.target - 1 : null }))
    .sort((a, b) => (a.dist ?? 9) - (b.dist ?? 9));
  return (
    <section className="wide">
      {rows.length === 0 ? (
        <EmptyState icon={<Eye size={28} />} title="Nada en seguimiento">
          Añade empresas que quieras comprar a un precio objetivo: verás a qué distancia están.
        </EmptyState>
      ) : (
        <div className="table-wrap card">
          <table className="fin-table pf-table" data-testid="watch-table">
            <thead>
              <tr>
                <th className="l">Empresa</th>
                <th>Precio</th>
                <th>Día</th>
                <th>Objetivo</th>
                <th>Distancia</th>
                <th className="l">Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, c, dist }) => (
                <tr key={c.id} data-testid="watch-row">
                  <td className="l">
                    <button className="link-btn pf-co" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })}>
                      <TickerChip company={c} size="sm" /> <span className="ellipsis">{c.name}</span>
                    </button>
                    {held.has(c.id) && <span className="tag-mini">en cartera</span>}
                  </td>
                  <td className="mono" title={c.price !== null ? `${priceBadge(c.priceKind)} · ${formatAsOf(c.priceAsOf)}` : ''}>
                    {c.price !== null ? money(c.price, c.priceCurrency) : <span className="muted">sin precio</span>}
                  </td>
                  <td className={`mono ${cls(c.priceChangePct)}`}>{c.priceChangePct !== null ? `${c.priceChangePct > 0 ? '+' : ''}${nf(2).format(c.priceChangePct)} %` : ''}</td>
                  <td>
                    <TargetInput w={w} />
                  </td>
                  <td className="mono" data-testid="watch-dist">
                    {dist === null ? '—' : dist <= 0 ? <span className="tag tag-pos">en precio</span> : pct(dist, 1, true)}
                  </td>
                  <td className="l">
                    <NoteInput w={w} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Quitar de seguimiento" onClick={() => void ib.invoke('watchlist:remove', { companyId: c.id }).then(setPortfolio)}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddForm mode="watch" companies={companies} fx={fx} />
    </section>
  );
}

function TargetInput({ w }: { w: PortfolioData['watchlist'][number] }) {
  const [v, setV] = useState(w.target !== null ? String(w.target).replace('.', ',') : '');
  return (
    <input
      className="input mono input-xs pf-cell"
      inputMode="decimal"
      value={v}
      placeholder="—"
      aria-label="Precio objetivo"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = num(v);
        if (n !== w.target) void ib.invoke('watchlist:set', { companyId: w.companyId, target: n && n > 0 ? n : null, note: w.note }).then(setPortfolio);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      data-testid="watch-target"
    />
  );
}

function NoteInput({ w }: { w: PortfolioData['watchlist'][number] }) {
  const [v, setV] = useState(w.note ?? '');
  return (
    <input
      className="input pf-note"
      value={v}
      placeholder="Tesis, catalizador…"
      aria-label="Nota"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (w.note ?? '') && void ib.invoke('watchlist:set', { companyId: w.companyId, target: w.target, note: v.trim() || null }).then(setPortfolio)}
    />
  );
}
