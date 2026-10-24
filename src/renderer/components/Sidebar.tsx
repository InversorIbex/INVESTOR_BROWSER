import { useRef, useState } from 'react';
import { BookOpen, Bookmark as BookmarkIcon, Briefcase, Calculator, CalendarDays, ListFilter, ChevronDown, ChevronRight, Clock, Download, Plus, Settings as Cog, Volume2, VolumeX, X } from 'lucide-react';
import { BrandMark, Favicon } from './ui';
import { ib, runCommand, useBookmarks, useBrowser, useCompanies, useDownloads } from '../lib/ib';
import { TickerChip } from './research';
import type { Company } from '../../shared/types';
import { BRAND } from '../../shared/brand';
import type { TabState } from '../../shared/types';

export function Sidebar({ width, showTabs, onResize }: { width: number; showTabs: boolean; onResize: (w: number) => void }) {
  const { tabs, activeTabId } = useBrowser();
  const bookmarks = useBookmarks();
  const downloads = useDownloads();
  const companies = useCompanies();
  const [coOpen, setCoOpen] = useState(true);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [bmOpen, setBmOpen] = useState(true);
  const pinned = tabs.filter((t) => t.pinned);
  const normal = tabs.filter((t) => !t.pinned);
  const activeDownloads = downloads.filter((d) => d.status === 'progressing').length;
  const w = liveWidth ?? width;

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const start = w;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = start;
    const move = (ev: PointerEvent) => {
      last = Math.max(180, Math.min(420, start + ev.clientX - startX));
      setLiveWidth(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setLiveWidth(null);
      onResize(Math.round(last));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <aside className="sidebar" style={{ width: w }} data-testid="sidebar">
      <div className="sb-brand">
        <BrandMark size={18} />
        <span className="sb-brand-name">{BRAND.name}</span>
      </div>

      {showTabs && (
        <>
          {pinned.length > 0 && (
            <div className="sb-pinned" data-testid="pinned-tabs">
              {pinned.map((t) => (
                <button
                  key={t.id}
                  className={`pin-tile ${t.id === activeTabId ? 'is-active' : ''}`}
                  title={t.title}
                  onClick={() => void ib.invoke('tabs:activate', { id: t.id })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void ib.invoke('tabs:contextMenu', { id: t.id });
                  }}
                >
                  <Favicon src={t.favicon} url={t.url} loading={t.loading} size={16} />
                </button>
              ))}
            </div>
          )}
          <button className="sb-new" onClick={() => runCommand('tab.new')} data-testid="new-tab">
            <Plus size={15} /> Nueva pestaña
          </button>
          <TabList tabs={normal} offset={pinned.length} activeId={activeTabId} companies={companyById} />
        </>
      )}

      {!showTabs && <div className="sb-flex" />}

      <nav className="sb-invest" aria-label="Herramientas de inversión">
        <button className="sb-invest-btn" onClick={() => runCommand('open.portfolio')} title="Cartera y seguimiento (Ctrl+Shift+M)" data-testid="open-portfolio">
          <Briefcase size={14} /> Cartera
        </button>
        <button className="sb-invest-btn" onClick={() => runCommand('open.screener')} title="Screener de empresas" data-testid="open-screener">
          <ListFilter size={14} /> Screener
        </button>
        <button className="sb-invest-btn" onClick={() => runCommand('open.calendar')} title="Calendario de resultados y dividendos" data-testid="open-calendar">
          <CalendarDays size={14} /> Agenda
        </button>
      </nav>

      <div className="sb-section sb-companies" data-testid="sb-companies">
        <div className="sb-section-row">
          <button className="sb-section-head" onClick={() => setCoOpen((o) => !o)}>
            {coOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Empresas
          </button>
          <button className="sb-mini" title="Investigación" onClick={() => runCommand('open.research')}>
            <Plus size={13} />
          </button>
        </div>
        {coOpen &&
          (companies.filter((c) => c.followed).length === 0 ? (
            <button className="sb-link muted" onClick={() => runCommand('open.research')}>
              <BookOpen size={14} /> Crear mi primera empresa
            </button>
          ) : (
            <div className="sb-bookmarks">
              {companies
                .filter((c) => c.followed)
                .slice(0, 15)
                .map((c) => {
                  const openCount = tabs.filter((t) => t.companyId === c.id).length;
                  const active = tabs.find((t) => t.id === activeTabId)?.companyId === c.id;
                  return (
                    <button
                      key={c.id}
                      className={`sb-company ${active ? 'is-active' : ''}`}
                      title={`${c.name}${openCount ? ` · ${openCount} pestaña(s) abierta(s)` : c.savedTabs.length ? ` · ${c.savedTabs.length} guardada(s)` : ''}`}
                      onClick={() => void ib.invoke('workspace:open', { companyId: c.id })}
                      data-testid="sb-company"
                    >
                      <TickerChip company={c} size="sm" />
                      <span className="ellipsis">{c.name}</span>
                      {c.openQuestions > 0 && <span className="q-dot" title={`${c.openQuestions} pregunta(s) abierta(s)`} />}
                      {openCount > 0 && <span className="count">{openCount}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
      </div>

      {bookmarks.length > 0 && (
        <div className="sb-section">
          <button className="sb-section-head" onClick={() => setBmOpen((o) => !o)}>
            {bmOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Favoritos
          </button>
          {bmOpen && (
            <div className="sb-bookmarks">
              {bookmarks.slice(0, 12).map((b) => (
                <button
                  key={b.id}
                  className="sb-link"
                  title={b.url}
                  onClick={(e) =>
                    e.ctrlKey || e.metaKey
                      ? void ib.invoke('tabs:create', { url: b.url, active: false })
                      : void ib.invoke('tabs:navigate', { input: b.url })
                  }
                  onAuxClick={(e) => e.button === 1 && void ib.invoke('tabs:create', { url: b.url, active: false })}
                >
                  <Favicon src={null} url={b.url} size={14} />
                  <span className="ellipsis">{b.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <nav className="sb-footer">
        <button className="sb-foot-btn" title="Investigación (Ctrl+Shift+E)" onClick={() => runCommand('open.research')} data-testid="open-research">
          <BookOpen size={15} />
        </button>
        <button className="sb-foot-btn" title="Laboratorio de valoración" onClick={() => runCommand('open.valuation')} data-testid="open-valuation">
          <Calculator size={15} />
        </button>
        <button className="sb-foot-btn" title="Favoritos" onClick={() => runCommand('open.bookmarks')} data-testid="open-bookmarks">
          <BookmarkIcon size={15} />
        </button>
        <button className="sb-foot-btn" title="Historial (Ctrl+H)" onClick={() => runCommand('open.history')} data-testid="open-history">
          <Clock size={15} />
        </button>
        <button className="sb-foot-btn" title="Descargas (Ctrl+J)" onClick={() => runCommand('open.downloads')}>
          <Download size={15} />
          {activeDownloads > 0 && <span className="badge">{activeDownloads}</span>}
        </button>
        <span className="sb-flex" />
        <button className="sb-foot-btn" title="Ajustes (Ctrl+,)" onClick={() => runCommand('open.settings')} data-testid="open-settings">
          <Cog size={15} />
        </button>
      </nav>
      <div className="sb-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Redimensionar panel" />
    </aside>
  );
}

function TabList({ tabs, offset, activeId, companies }: { tabs: TabState[]; offset: number; activeId: string | null; companies: Map<number, Company> }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <div className="sb-tabs" ref={listRef} data-testid="tab-list">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`tab-row ${t.id === activeId ? 'is-active' : ''} ${overIndex === i && dragId !== t.id ? 'drop-before' : ''} ${t.companyId ? 'has-company' : ''}`}
          style={t.companyId && companies.get(t.companyId) ? ({ ['--chip' as string]: companies.get(t.companyId)!.color } as React.CSSProperties) : undefined}
          data-testid="tab"
          data-active={t.id === activeId}
          draggable
          onDragStart={(e) => {
            setDragId(t.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            setOverIndex(i);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverIndex(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) {
              const from = tabs.findIndex((x) => x.id === dragId);
              const to = from < i ? i - 1 : i;
              void ib.invoke('tabs:move', { id: dragId, index: offset + Math.max(0, to) });
            }
            setDragId(null);
            setOverIndex(null);
          }}
          onClick={() => void ib.invoke('tabs:activate', { id: t.id })}
          onAuxClick={(e) => e.button === 1 && void ib.invoke('tabs:close', { id: t.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            void ib.invoke('tabs:contextMenu', { id: t.id });
          }}
          title={t.title}
        >
          <Favicon src={t.favicon} url={t.url} loading={t.loading} size={15} />
          <span className="tab-title ellipsis">{t.title || 'Sin título'}</span>
          {t.companyId && companies.get(t.companyId) && !t.url.startsWith('ib://company') && (
            <span className="tab-ticker">{companies.get(t.companyId)!.ticker ?? '•'}</span>
          )}
          {(t.audible || t.muted) && (
            <span className="tab-audio" title={t.muted ? 'Silenciada' : 'Reproduciendo audio'}>
              {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </span>
          )}
          <button
            className="tab-close"
            aria-label="Cerrar pestaña"
            data-testid="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              void ib.invoke('tabs:close', { id: t.id });
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
