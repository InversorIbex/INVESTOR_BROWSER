import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, CircleSlash, Info, Loader2, RefreshCw, TriangleAlert, Users } from 'lucide-react';
import { errorMessage, ib, showToast, useNotesRevision, useSettings } from '../lib/ib';
import type { Company, InsiderRow, InsiderSyncResult } from '../../shared/types';
import { metricDef, type FigureTable, type MetricId } from '../../shared/finance';
import { forensicsReport, qualityReport, roicSeries, type Criterion, type Signal, type Verdict } from '../../shared/analysis';
import { multiples } from '../../shared/valuation';
import { CATEGORY_SHORT, CODE_INFO, summarizeInsiders } from '../../shared/form4';
import { priceIn, statementCurrency, useFx } from '../lib/figures';
import { formatAsOf } from '../../shared/market';

const VERDICT: Record<Verdict, { label: string; icon: typeof CheckCircle2 }> = {
  strong: { label: 'Fuerte', icon: CheckCircle2 },
  ok: { label: 'Aceptable', icon: CircleDashed },
  weak: { label: 'Débil', icon: TriangleAlert },
  na: { label: 'No evaluable', icon: CircleSlash },
};

const money = (v: number) => `${(v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: Math.abs(v) < 1e7 ? 1 : 0 })} M`;
const fmtPct = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`);

// ---------------------------------------------------------------- Quality

export function QualityView({ company, table }: { company: Company; table: FigureTable }) {
  const report = useMemo(() => qualityReport(table, company.sectorKind), [table, company.sectorKind]);
  const roic = useMemo(() => roicSeries(table), [table]);
  const lastFy = report.years.at(-1);
  const shares = lastFy ? table.get(lastFy)?.get('diluted_shares')?.value ?? null : null;
  const g = (metric: MetricId) => (lastFy ? table.get(lastFy)?.get(metric)?.value ?? null : null);
  const stmtCur = statementCurrency(table, lastFy);
  const fx = useFx(!!company.price && !!company.priceCurrency && !!stmtCur && company.priceCurrency !== stmtCur);
  const px = priceIn(company, stmtCur, fx);
  const mult = multiples(
    { price: px.value, shares, grossDebt: g('gross_debt'), cash: g('cash'), netIncome: g('net_income'), ebit: g('ebit') ?? g('operating_income'), ebitda: g('ebitda'), fcf: g('fcf'), dividendPerShare: g('dividend_per_share') },
    company.sectorKind,
  );
  const fcfYield = mult.find((m) => m.id === 'fcf_yield');
  const per = mult.find((m) => m.id === 'per');

  if (!report.years.length)
    return (
      <section className="card">
        <h2>Quality Compounder</h2>
        <p className="muted small">Necesita cifras anuales (FY). Impórtalas desde la SEC o añádelas desde los informes.</p>
      </section>
    );

  return (
    <div data-testid="quality-view">
      <section className="card">
        <div className="card-head">
          <h2>Calidad del negocio</h2>
          <span className="score-pill" data-testid="quality-summary">
            {report.strong} de {report.evaluable} criterios fuertes
            {report.criteria.length - report.evaluable > 0 && <span className="muted"> · {report.criteria.length - report.evaluable} no evaluables</span>}
          </span>
        </div>
        <p className="disclaimer-inline">
          <Info size={13} />
          <span>
            No es una puntuación única: cada criterio se evalúa por separado con su regla y sus datos ({report.years[0]}–{lastFy}). Calidad no es lo mismo que una buena inversión a cualquier precio.
          </span>
        </p>
        {report.sectorWarning && (
          <p className="warn">
            <TriangleAlert size={13} /> {report.sectorWarning}
          </p>
        )}
        <div className="criteria">
          {report.criteria.map((c) => (
            <CriterionCard key={c.id} c={c} />
          ))}
        </div>
      </section>

      {roic.some((r) => r.roic !== null) && (
        <section className="card">
          <h2>ROIC por ejercicio</h2>
          <div className="table-wrap">
            <table className="fin-table" data-testid="roic-table">
              <thead>
                <tr>
                  <th />
                  {roic.map((r) => (
                    <th key={r.period} className="mono">
                      {r.period}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>ROIC</th>
                  {roic.map((r) => (
                    <td key={r.period} className="mono" title={r.reason ?? ''}>
                      {fmtPct(r.roic)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Tipo impositivo efectivo</th>
                  {roic.map((r) => (
                    <td key={r.period} className="mono">
                      {fmtPct(r.taxRate)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>NOPAT</th>
                  {roic.map((r) => (
                    <td key={r.period} className="mono">
                      {r.nopat === null ? '—' : money(r.nopat)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Capital invertido medio</th>
                  {roic.map((r) => (
                    <td key={r.period} className="mono">
                      {r.investedCapital === null ? '—' : money(r.investedCapital)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">Los ejercicios sin dato indican el motivo al pasar el ratón. No se estiman tipos impositivos ni capital.</p>
        </section>
      )}

      <section className="card">
        <h2>Precio frente a calidad (separado)</h2>
        {company.price === null ? (
          <p className="muted small">Añade el precio en el dossier (cotización automática, capturada o manual) para ver rentabilidad de FCL y PER. La calidad no depende del precio.</p>
        ) : (
          <div className="kpis compact">
            <div className="kpi">
              <div className="kpi-label">Rentabilidad FCL</div>
              <div className="kpi-value mono">{fmtPct(fcfYield?.value ?? null)}</div>
              <div className="kpi-sub">{fcfYield?.value === null ? fcfYield?.reason : `FCL ${lastFy} / capitalización`}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">PER</div>
              <div className="kpi-value mono">{per?.value == null ? '—' : `${per.value.toLocaleString('es-ES', { maximumFractionDigits: 1 })}×`}</div>
              <div className="kpi-sub">{per?.value === null ? per?.reason : `Precio a ${formatAsOf(company.priceAsOf)}`}</div>
            </div>
          </div>
        )}
        {px.note && <p className="hint">{px.note}</p>}
      </section>
    </div>
  );
}

function CriterionCard({ c }: { c: Criterion }) {
  const [open, setOpen] = useState(false);
  const V = VERDICT[c.verdict];
  return (
    <div className={`criterion v-${c.verdict}`} data-testid="criterion" data-id={c.id} data-verdict={c.verdict}>
      <div className="crit-head">
        <span className={`verdict v-${c.verdict}`}>
          <V.icon size={12} /> {V.label}
        </span>
        <span className="crit-title">{c.title}</span>
        <span className="crit-value mono">{c.display}</span>
      </div>
      {c.verdict === 'na' ? (
        <div className="crit-meta muted">{c.reason}</div>
      ) : (
        <div className="crit-meta">
          <span>{c.rule}</span>
        </div>
      )}
      {c.verdict !== 'na' && (
        <button className="link-btn small crit-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Cómo se calcula
        </button>
      )}
      {open && (
        <div className="crit-detail">
          <div>
            <strong>Fórmula:</strong> {c.formula}
          </div>
          <div>
            <strong>Ejercicios:</strong> {c.periods.join(', ')}
          </div>
          {c.inputs.length > 0 && (
            <ul className="crit-inputs">
              {c.inputs.map((i, k) => (
                <li key={k} className="mono">
                  {i.period} · {metricDef(i.metric).short}: {metricDef(i.metric).kind === 'count' ? (i.value / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M acc.' : money(i.value)}{' '}
                  <span className={`origin origin-${i.origin}`}>{{ published: 'publicado', calculated: 'cálculo', user: 'tuyo', estimate: 'estimación' }[i.origin]}</span>
                </li>
              ))}
            </ul>
          )}
          {c.note && <div className="muted">{c.note}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Forensics

export function ForensicsView({ table, restated }: { table: FigureTable; restated: { period: string; metric: string }[] }) {
  const report = useMemo(() => forensicsReport(table, restated), [table, restated]);
  const order: Record<Signal['status'], number> = { triggered: 0, clear: 1, na: 2 };
  const sorted = [...report.signals].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div data-testid="forensics-view">
      <section className="card">
        <div className="card-head">
          <h2>Financial Forensics</h2>
          <span className={`score-pill ${report.triggered ? 'warn' : ''}`} data-testid="forensics-summary">
            {report.triggered} señal(es) a revisar de {report.signals.length}
          </span>
        </div>
        <p className="disclaimer-inline">
          <Info size={13} />
          <span>
            Una señal indica <strong>dónde leer con más atención</strong> (notas del informe, explicación de la dirección). No es una acusación de fraude ni de mala gestión: cada una explica sus limitaciones.
          </span>
        </p>
        <ul className="signals">
          {sorted.map((s) => (
            <li key={s.id} className={`signal s-${s.status}`} data-testid="signal" data-id={s.id} data-status={s.status}>
              <div className="sig-head">
                <span className={`sig-status s-${s.status}`}>{s.status === 'triggered' ? 'Revisar' : s.status === 'clear' ? 'Sin señal' : 'No evaluable'}</span>
                <span className="sig-title">{s.title}</span>
              </div>
              <div className="sig-detail mono">{s.detail}</div>
              {s.status !== 'na' && (
                <div className="sig-text">
                  <span>
                    <strong>Por qué importa:</strong> {s.why}
                  </span>
                  <span className="muted">
                    <strong>Limitación:</strong> {s.limitation}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Lo que estos datos no pueden detectar</h2>
        <ul className="not-covered">
          {report.notCovered.map((n) => (
            <li key={n.title}>
              <strong>{n.title}.</strong> <span className="muted">{n.how}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Insiders

export function InsidersView({ company }: { company: Company }) {
  const settings = useSettings();
  const rev = useNotesRevision();
  const [rows, setRows] = useState<InsiderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<InsiderSyncResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [months, setMonths] = useState(12);

  useEffect(() => {
    let alive = true;
    void ib.invoke('sec:insiders', { companyId: company.id }).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [company.id, rev]);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await ib.invoke('sec:insidersSync', { companyId: company.id, limit: 30 });
      setLast(r);
      showToast(`Form 4: ${r.parsed} procesados, ${r.transactions} operaciones${r.errors ? `, ${r.errors} no legibles` : ''}`);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const summary = useMemo(() => summarizeInsiders(rows, today, months), [rows, today, months]);
  const visible = rows.filter((r) => showAll || (r.table === 'nonDerivative' && (r.category === 'buy' || r.category === 'sell')));

  if (!company.cik)
    return (
      <section className="card" data-testid="insiders-view">
        <h2>Insider Tracker</h2>
        <p className="muted small">Vincula la empresa con la SEC (panel lateral «Datos oficiales») para leer sus Form 4. Solo existen para emisores con acciones registradas en EE. UU.</p>
      </section>
    );

  return (
    <div data-testid="insiders-view">
      <section className="card">
        <div className="card-head">
          <h2>
            <Users size={14} /> Operaciones de insiders (Form 4)
          </h2>
          <button className="btn btn-sm" onClick={() => void sync()} disabled={busy || !settings.secContact.trim()} data-testid="insiders-sync">
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {rows.length ? 'Cargar más / actualizar' : 'Cargar Form 4 recientes'}
          </button>
        </div>
        <p className="disclaimer-inline">
          <Info size={13} />
          <span>
            Una venta no es necesariamente bajista (impuestos, diversificación, planes 10b5-1 programados con meses de antelación) y una compra no garantiza nada. Las concesiones, ejercicios y retenciones fiscales no son decisiones de mercado.
          </span>
        </p>
        {last && (
          <p className="hint" data-testid="insiders-progress">
            {last.available} Form 4 en las presentaciones recientes · {last.remaining > 0 ? `${last.remaining} pendientes (pulsa de nuevo para seguir)` : 'todos procesados'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="segmented insider-period" role="radiogroup" data-testid="insider-period">
            {(
              [
                [12, 'Últimos 12 meses'],
                [24, 'Últimos 24 meses'],
                [1200, 'Todo lo cargado'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} role="radio" aria-checked={months === m} className={months === m ? 'is-on' : ''} onClick={() => setMonths(m)} data-months={m}>
                {label}
              </button>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="insider-kpis" data-testid="insider-summary">
            <SummaryTile tone="pos" label="Compras discrecionales" main={`${summary.buys.count}`} sub={`${summary.buys.insiders} insider(s) · ${usd(summary.buys.value)}`} />
            <SummaryTile tone="neg" label="Ventas discrecionales" main={`${summary.discretionarySells.count}`} sub={`${summary.discretionarySells.insiders} insider(s) · ${usd(summary.discretionarySells.value)}`} />
            <SummaryTile tone="muted" label="Ventas con plan 10b5-1" main={`${summary.planSells.count}`} sub={usd(summary.planSells.value)} />
            <SummaryTile tone="muted" label="Retenciones fiscales" main={`${summary.taxWithholding.count}`} sub={`${shares(summary.taxWithholding.shares)} acciones`} />
            <SummaryTile tone="muted" label="Concesiones" main={`${summary.grants.count}`} sub={`${shares(summary.grants.shares)} acciones`} />
          </div>
        )}
        {rows.length > 0 && (
          <p className="hint">
            Periodo: {months >= 1200 ? `todo lo cargado (hasta ${summary.until})` : `${summary.since} → ${summary.until}`}. Importes = acciones × precio comunicado en el Form 4. {summary.notes.join(' ')}
          </p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Detalle</h2>
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="insiders-all" /> Incluir concesiones, ejercicios, retenciones y derivados
            </label>
          </div>
          <div className="table-wrap">
            <table className="fin-table insider-table" data-testid="insider-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Insider</th>
                  <th>Operación</th>
                  <th className="num">Acciones</th>
                  <th className="num">Precio</th>
                  <th className="num">Importe</th>
                  <th className="num" title="Acciones en propiedad tras la operación">Tras op.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 200).map((r) => (
                  <tr key={`${r.accn}-${r.seq}`} data-testid="insider-row" data-code={r.code}>
                    <td className="mono">{r.date}</td>
                    <td>
                      <div className="ellipsis insider-name">{r.ownerName}</div>
                      <div className="muted small ellipsis">{r.role}</div>
                    </td>
                    <td title={`${r.code}: ${CODE_INFO[r.code]?.label ?? r.code}${r.footnotes ? '\n' + r.footnotes : ''}`}>
                      <span className={`cat cat-${r.category}`}>{r.code}</span> {CATEGORY_SHORT[r.category]}
                      {r.plan10b51 && (
                        <span className="plan-badge" title={r.planSource === 'checkbox' ? 'Casilla 10b5-1 marcada en el formulario' : 'Plan 10b5-1 indicado en una nota al pie'}>
                          10b5-1
                        </span>
                      )}
                      {r.table === 'derivative' && <span className="muted small"> · derivado</span>}
                    </td>
                    <td className={`num mono ${r.acquiredDisposed === 'D' ? 'neg-num' : ''}`}>
                      {r.shares === null ? '—' : `${r.acquiredDisposed === 'D' ? '−' : '+'}${shares(r.shares)}`}
                    </td>
                    <td className="num mono">{r.price === null ? '—' : r.price.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
                    <td className="num mono">{r.shares !== null && r.price ? usd(r.shares * r.price) : '—'}</td>
                    <td className="num mono">{r.sharesAfter === null ? '—' : shares(r.sharesAfter)}</td>
                    <td>
                      <button className="icon-btn" title="Ver el Form 4 en la SEC" onClick={() => void ib.invoke('tabs:create', { url: r.url, companyId: company.id })}>
                        <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && <p className="muted small">No hay compras ni ventas de mercado en los Form 4 cargados.</p>}
        </section>
      )}
    </div>
  );
}

function SummaryTile({ label, main, sub, tone }: { label: string; main: string; sub: string; tone: 'pos' | 'neg' | 'muted' }) {
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">{main}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

const usd = (v: number) => (v > 0 ? `${v >= 1e6 ? (v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' M' : v.toLocaleString('es-ES', { maximumFractionDigits: 0 })} USD` : '—');
const shares = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 0 });
