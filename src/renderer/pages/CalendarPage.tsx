import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, X } from 'lucide-react';
import { errorMessage, ib, showToast, useCompanies, usePortfolio } from '../lib/ib';
import { TickerChip } from '../components/research';
import { EmptyState } from '../components/ui';
import { EVENT_LABEL, STATUS_LABEL, type CalEvent, type EventType } from '../../shared/calendar';
import type { Company } from '../../shared/types';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3));
const monthStart = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 1)));
const monthEnd = (y: number, m: number) => iso(new Date(Date.UTC(y, m + 1, 0)));
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const TYPE_CLASS: Record<EventType, string> = { earnings: 'ev-earn', exdiv: 'ev-div', payment: 'ev-pay', meeting: 'ev-meet', other: 'ev-other' };

export function CalendarPage() {
  const companies = useCompanies();
  const pf = usePortfolio();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [data, setData] = useState<{ events: CalEvent[]; earningsAt: number | null; withDividends: number; scope: number } | null>(null);
  const [types, setTypes] = useState<Set<EventType>>(new Set(['earnings', 'exdiv', 'payment', 'meeting', 'other']));
  const [onlyHoldings, setOnlyHoldings] = useState(false);
  const [hideEstimated, setHideEstimated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Window: the visible month plus the next 60 days for the agenda and KPIs
  const from = monthStart(ym.y, ym.m) < todayIso() ? monthStart(ym.y, ym.m) : todayIso();
  const to = [monthEnd(ym.y, ym.m), addDays(todayIso(), 60)].sort().at(-1)!;
  const load = useCallback(() => {
    void ib
      .invoke('calendar:get', { from, to })
      .then(setData)
      .catch((err) => showToast(errorMessage(err), 'error'));
  }, [from, to]);
  useEffect(load, [load, companies.length, pf.holdings.length, pf.watchlist.length]);

  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const held = useMemo(() => new Set(pf.holdings.map((h) => h.companyId)), [pf.holdings]);
  const events = (data?.events ?? []).filter((e) => types.has(e.type) && (!onlyHoldings || held.has(e.companyId)) && (!hideEstimated || e.status !== 'estimated') && byId.has(e.companyId));
  const t = todayIso();
  const within = (n: number) => events.filter((e) => e.date >= t && e.date <= addDays(t, n));
  const exdiv30 = within(30).filter((e) => e.type === 'exdiv');

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await ib.invoke('calendar:refresh', { from, to });
      const parts = [
        r.finnhub ? `${r.earnings} fechas de resultados (EE. UU.)` : 'sin clave de Finnhub: resultados estimados',
        r.eodhd ? `${r.dividends} historiales de dividendos` : 'sin clave de EODHD: sin dividendos',
        r.pending ? `${r.pending} pendientes por cupo diario` : '',
      ].filter(Boolean);
      showToast(`Calendario: ${parts.join(' · ')}`);
      load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!companies.length)
    return (
      <div className="page">
        <EmptyState icon={<CalendarDays size={28} />} title="Sin empresas que seguir">
          El calendario muestra resultados y dividendos de tu cartera, tu lista de seguimiento y las empresas que sigues.
        </EmptyState>
      </div>
    );

  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Number(monthEnd(ym.y, ym.m).slice(8));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(ym.y, ym.m, i + 1))))];
  const agenda = selected ? events.filter((e) => e.date === selected) : events.filter((e) => e.date >= t && e.date <= addDays(t, 60));

  return (
    <div className="page calendar" data-testid="calendar-page">
      <header className="page-head wide">
        <h1>
          <CalendarDays size={18} /> Calendario bursátil
        </h1>
        <div className="page-tools">
          <button className="btn btn-sm" onClick={() => void refresh()} disabled={busy} data-testid="cal-refresh">
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> Actualizar
          </button>
          <button className="btn btn-sm" onClick={() => void ib.invoke('calendar:exportIcs', { from: t, to: addDays(t, 365) })}>
            <Download size={13} /> Exportar .ics
          </button>
        </div>
      </header>

      <section className="kpis wide" data-testid="cal-kpis">
        <div className="kpi">
          <div className="kpi-label">Resultados 7 días</div>
          <div className="kpi-value mono">{within(7).filter((e) => e.type === 'earnings').length}</div>
          <div className="kpi-sub">30 días: {within(30).filter((e) => e.type === 'earnings').length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ex-dividendo 30 días</div>
          <div className="kpi-value mono">{exdiv30.length}</div>
          <div className="kpi-sub">{exdiv30.filter((e) => e.status === 'confirmed').length} confirmados</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cobertura</div>
          <div className="kpi-value mono">{data ? `${data.withDividends}/${data.scope}` : '—'}</div>
          <div className="kpi-sub">con historial de dividendos · resultados: {data?.earningsAt ? `Finnhub ${new Date(data.earningsAt).toLocaleDateString('es-ES')}` : 'solo estimados'}</div>
        </div>
      </section>

      <section className="card wide cal-controls">
        <div className="chip-filter">
          {(Object.keys(EVENT_LABEL) as EventType[]).map((k) => (
            <button
              key={k}
              className={`${types.has(k) ? 'is-on' : ''} ${TYPE_CLASS[k]}`}
              onClick={() =>
                setTypes((s) => {
                  const n = new Set(s);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
            >
              <i className="ev-dot" /> {EVENT_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="small">
          <input type="checkbox" checked={onlyHoldings} onChange={(e) => setOnlyHoldings(e.target.checked)} /> Solo cartera
        </label>
        <label className="small">
          <input type="checkbox" checked={hideEstimated} onChange={(e) => setHideEstimated(e.target.checked)} data-testid="cal-hide-est" /> Ocultar estimadas
        </label>
      </section>

      <div className="cal-layout wide">
        <section className="card cal-month" data-testid="cal-month">
          <div className="card-head">
            <button className="icon-btn" aria-label="Mes anterior" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>
              <ChevronLeft size={15} />
            </button>
            <h2 data-testid="cal-month-title">
              {MONTHS[ym.m]} {ym.y}
            </h2>
            <button className="icon-btn" aria-label="Mes siguiente" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="cal-grid">
            {DOW.map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const evs = events.filter((e) => e.date === d);
              return (
                <button key={d} className={`cal-day ${d === t ? 'is-today' : ''} ${selected === d ? 'is-sel' : ''} ${evs.length ? 'has-ev' : ''}`} onClick={() => setSelected(selected === d ? null : d)} data-date={d}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-dots">
                    {evs.slice(0, 4).map((e) => (
                      <i key={e.id} className={`ev-dot ${TYPE_CLASS[e.type]} ${e.status === 'estimated' ? 'is-est' : ''}`} title={`${byId.get(e.companyId)?.ticker ?? ''} · ${EVENT_LABEL[e.type]}`} />
                    ))}
                    {evs.length > 4 && <small>+{evs.length - 4}</small>}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hint">Punto relleno: confirmado o tuyo · punto hueco: estimado a partir del historial de la empresa.</p>
        </section>

        <section className="card cal-agenda">
          <div className="card-head">
            <h2>{selected ? fmtDay(selected) : 'Próximos 60 días'}</h2>
            {selected && (
              <button className="link-btn small" onClick={() => setSelected(null)}>
                Ver agenda
              </button>
            )}
          </div>
          {agenda.length === 0 ? (
            <p className="muted small">Nada en estas fechas con los filtros actuales.</p>
          ) : (
            <ul className="cal-list" data-testid="cal-list">
              {agenda.map((e) => (
                <AgendaItem key={e.id} e={e} c={byId.get(e.companyId)!} onRemoved={load} />
              ))}
            </ul>
          )}
          <AddEvent companies={companies} onAdded={load} defaultDate={selected ?? t} />
        </section>
      </div>
      <p className="hint wide">
        Resultados de EE. UU. confirmados con Finnhub (tu clave gratuita); el resto se estima con la periodicidad de las presentaciones de cada empresa (10-Q/10-K o informes ESEF) y se marca como «Estimada». Dividendos
        de EODHD (1 consulta por empresa, guardada 30 días; primero la cartera). Puedes añadir tus propias fechas (juntas, resultados anunciados por la empresa…).
      </p>
    </div>
  );
}

function AgendaItem({ e, c, onRemoved }: { e: CalEvent; c: Company; onRemoved: () => void }) {
  return (
    <li className={`cal-item ${e.status}`} data-testid="cal-item" data-type={e.type} data-status={e.status}>
      <span className="cal-date mono">{fmtDay(e.date)}</span>
      <i className={`ev-dot ${TYPE_CLASS[e.type]} ${e.status === 'estimated' ? 'is-est' : ''}`} />
      <button className="link-btn cal-co" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })}>
        <TickerChip company={c} size="sm" />
      </button>
      <span className="cal-what">
        <strong>{EVENT_LABEL[e.type]}</strong>
        {e.amount ? <span className="mono"> · {e.amount.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {e.currency ?? ''}</span> : null}
        {e.detail && <span className="muted"> · {e.detail}</span>}
      </span>
      <span className={`tag ${e.status === 'confirmed' ? 'tag-pos' : e.status === 'user' ? '' : 'tag-warn'}`} title={e.source}>
        {STATUS_LABEL[e.status]}
      </span>
      {e.userId && (
        <button className="icon-btn icon-btn-xs" aria-label="Borrar" onClick={() => void ib.invoke('calendar:remove', { id: e.userId! }).then(onRemoved)}>
          <X size={11} />
        </button>
      )}
    </li>
  );
}

function AddEvent({ companies, onAdded, defaultDate }: { companies: Company[]; onAdded: () => void; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [date, setDate] = useState(defaultDate);
  const [type, setType] = useState<EventType>('earnings');
  const [note, setNote] = useState('');
  useEffect(() => setDate(defaultDate), [defaultDate]);
  if (!open)
    return (
      <button className="link-btn small cal-add-btn" onClick={() => setOpen(true)} data-testid="cal-add-open">
        <Plus size={12} /> Añadir fecha propia
      </button>
    );
  return (
    <div className="pf-opform cal-add">
      <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')} aria-label="Empresa" data-testid="cal-add-company">
        <option value="">Empresa…</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.ticker ?? c.name}
          </option>
        ))}
      </select>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" data-testid="cal-add-date" />
      <select className="input" value={type} onChange={(e) => setType(e.target.value as EventType)} aria-label="Tipo">
        {(Object.keys(EVENT_LABEL) as EventType[]).map((k) => (
          <option key={k} value={k}>
            {EVENT_LABEL[k]}
          </option>
        ))}
      </select>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />
      <button
        className="btn btn-primary btn-sm"
        disabled={!companyId || !date}
        onClick={() =>
          void ib
            .invoke('calendar:add', { companyId: companyId as number, date, type, note })
            .then(() => {
              setOpen(false);
              setNote('');
              onAdded();
            })
            .catch((err) => showToast(errorMessage(err), 'error'))
        }
        data-testid="cal-add-save"
      >
        Añadir
      </button>
    </div>
  );
}
