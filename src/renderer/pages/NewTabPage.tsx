import { useEffect, useState } from 'react';
import { BookOpen, Calculator, CircleHelp, Landmark, Plus, Search } from 'lucide-react';
import { BrandMark, LetterAvatar } from '../components/ui';
import { ib, runCommand, useBookmarks, useCompanies } from '../lib/ib';
import { TickerChip, relativeDate } from '../components/research';
import { BRAND } from '../../shared/brand';
import { displayUrl, hostOf } from '../../shared/url';
import type { HistoryEntry } from '../../shared/types';

/** Official, free, primary sources. Plain links — no data is fetched from them here. */
const OFFICIAL_SOURCES = [
  { title: 'SEC EDGAR', sub: 'Presentaciones 10-K, 10-Q, 8-K (EE. UU.)', url: 'https://www.sec.gov/edgar/search/' },
  { title: 'FRED', sub: 'Series macroeconómicas (Fed St. Louis)', url: 'https://fred.stlouisfed.org/' },
  { title: 'Treasury Fiscal Data', sub: 'Deuda pública y subastas (EE. UU.)', url: 'https://fiscaldata.treasury.gov/' },
  { title: 'Eurostat', sub: 'Estadísticas oficiales de la UE', url: 'https://ec.europa.eu/eurostat' },
  { title: 'ESMA', sub: 'Autoridad Europea de Valores y Mercados', url: 'https://www.esma.europa.eu/' },
  { title: 'CNMV', sub: 'Registros oficiales del mercado español', url: 'https://www.cnmv.es/' },
];

export function NewTabPage() {
  const bookmarks = useBookmarks();
  const companies = useCompanies();
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    void ib.invoke('history:list', { limit: 60 }).then((h) => {
      const seen = new Set<string>();
      setRecent(h.filter((e) => !seen.has(hostOf(e.url)) && seen.add(hostOf(e.url))).slice(0, 6));
    });
  }, []);

  const open = (url: string, e?: React.MouseEvent) =>
    e && (e.ctrlKey || e.metaKey || e.button === 1)
      ? void ib.invoke('tabs:create', { url, active: false })
      : void ib.invoke('tabs:navigate', { input: url });

  return (
    <div className="page newtab" data-testid="newtab-page">
      <div className="nt-hero">
        <BrandMark size={34} />
        <h1>{BRAND.name}</h1>
        <p className="muted">{BRAND.tagline}</p>
        <form
          className="nt-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) void ib.invoke('tabs:navigate', { input: q });
          }}
        >
          <Search size={16} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar, escribir una dirección o $TICKER" data-testid="newtab-search" />
        </form>
        <div className="nt-actions">
          <button className="nt-action" onClick={() => runCommand('open.research')}>
            <BookOpen size={14} /> Investigación
          </button>
          <button className="nt-action" onClick={() => runCommand('open.valuation')}>
            <Calculator size={14} /> Valoración
          </button>
          <button className="nt-action" onClick={() => runCommand('ui.palette')}>
            <Search size={14} /> Comandos <kbd className="kbd">Ctrl K</kbd>
          </button>
        </div>
      </div>

      <section className="nt-section">
        <h2>
          <BookOpen size={14} /> Tu investigación
        </h2>
        {companies.length === 0 ? (
          <button className="nt-empty" onClick={() => runCommand('open.research')}>
            <Plus size={16} />
            <span>
              <strong>Crea tu primera empresa</strong>
              <span className="muted">Agrupa pestañas, guarda citas y cifras con su fuente y valora con tus propios supuestos.</span>
            </span>
          </button>
        ) : (
          <div className="nt-companies">
            {companies.slice(0, 8).map((c) => (
              <button key={c.id} className="nt-company" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })} data-testid="nt-company">
                <div className="nt-company-top">
                  <TickerChip company={c} />
                  {c.openQuestions > 0 && (
                    <span className="warn-text small">
                      <CircleHelp size={12} /> {c.openQuestions}
                    </span>
                  )}
                </div>
                <span className="nt-company-name ellipsis">{c.name}</span>
                <span className="muted small">
                  {c.noteCount} notas · {relativeDate(c.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {bookmarks.length > 0 && (
        <section className="nt-section">
          <h2>Favoritos</h2>
          <div className="nt-tiles">
            {bookmarks.slice(0, 8).map((b) => (
              <button key={b.id} className="nt-tile" onClick={(e) => open(b.url, e)} onAuxClick={(e) => open(b.url, e)} title={b.url}>
                <LetterAvatar url={b.url} size={28} />
                <span className="ellipsis">{b.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="nt-section">
        <h2>
          <Landmark size={14} /> Fuentes oficiales y gratuitas
        </h2>
        <div className="nt-sources">
          {OFFICIAL_SOURCES.map((s) => (
            <button key={s.url} className="nt-source" onClick={(e) => open(s.url, e)} onAuxClick={(e) => open(s.url, e)}>
              <span className="nt-source-title">{s.title}</span>
              <span className="nt-source-sub">{s.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="nt-section">
          <h2>Visitado recientemente</h2>
          <div className="nt-recent">
            {recent.map((h) => (
              <button key={h.id} className="nt-recent-item" onClick={(e) => open(h.url, e)} onAuxClick={(e) => open(h.url, e)}>
                <LetterAvatar url={h.url} size={16} />
                <span className="ellipsis">{h.title || displayUrl(h.url)}</span>
                <span className="muted ellipsis">{hostOf(h.url)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
