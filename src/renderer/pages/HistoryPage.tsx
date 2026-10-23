import { useEffect, useMemo, useState } from 'react';
import { Clock, Search, Trash2, X } from 'lucide-react';
import { EmptyState, LetterAvatar } from '../components/ui';
import { ib, showToast, useSettings } from '../lib/ib';
import { displayUrl, hostOf } from '../../shared/url';
import type { HistoryEntry } from '../../shared/types';

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function HistoryPage() {
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void ib.invoke('history:list', { query: q, limit: 1000 }).then((r) => alive && setItems(r));
    }, 80);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, version]);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const h of items) {
      const key = dayLabel(h.visitedAt);
      map.set(key, [...(map.get(key) ?? []), h]);
    }
    return [...map.entries()];
  }, [items]);

  const clear = async (range: 'hour' | 'day' | 'week' | 'all') => {
    const n = await ib.invoke('history:clear', { range });
    showToast(`${n} entradas eliminadas del historial`);
    setVersion((v) => v + 1);
  };

  return (
    <div className="page" data-testid="history-page">
      <header className="page-head">
        <h1>Historial</h1>
        <div className="page-tools">
          <label className="search-field">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el historial" data-testid="history-search" />
          </label>
          <select
            className="select"
            value=""
            onChange={(e) => e.target.value && void clear(e.target.value as 'hour')}
            aria-label="Borrar historial"
            data-testid="history-clear"
          >
            <option value="">Borrar…</option>
            <option value="hour">Última hora</option>
            <option value="day">Últimas 24 horas</option>
            <option value="week">Últimos 7 días</option>
            <option value="all">Todo el historial</option>
          </select>
        </div>
      </header>
      {!settings.historyEnabled && <div className="notice">El historial está desactivado en Ajustes › Privacidad. No se guardan visitas nuevas.</div>}
      {items.length === 0 ? (
        <EmptyState icon={<Clock size={28} />} title={q ? 'Sin coincidencias' : 'El historial está vacío'} />
      ) : (
        groups.map(([day, list]) => (
          <section key={day} className="list-group">
            <h2 className="list-group-title">{day}</h2>
            <ul className="list">
              {list.map((h) => (
                <li key={h.id} className="list-row" data-testid="history-row">
                  <span className="list-time">{timeFmt.format(h.visitedAt)}</span>
                  <LetterAvatar url={h.url} size={16} />
                  <button
                    className="list-main"
                    onClick={(e) =>
                      e.ctrlKey || e.metaKey ? void ib.invoke('tabs:create', { url: h.url, active: false }) : void ib.invoke('tabs:navigate', { input: h.url })
                    }
                    title={h.url}
                  >
                    <span className="ellipsis">{h.title || displayUrl(h.url)}</span>
                    <span className="list-sub ellipsis">{hostOf(h.url)}</span>
                  </button>
                  <button
                    className="icon-btn row-action"
                    aria-label="Eliminar del historial"
                    onClick={() => void ib.invoke('history:remove', { id: h.id }).then(() => setVersion((v) => v + 1))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {items.length > 0 && (
        <p className="page-foot muted">
          <Trash2 size={12} /> El historial solo se guarda en este equipo.
        </p>
      )}
    </div>
  );
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yest.toDateString()) return 'Ayer';
  const s = dayFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
