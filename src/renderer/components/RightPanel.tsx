import { ExternalLink, Lock, Monitor, Star, TriangleAlert, X } from 'lucide-react';
import { Favicon } from './ui';
import { runCommand, updateSettings, useActiveTab, useBookmarks } from '../lib/ib';
import { hostOf, isInternalUrl, securityStateOf } from '../../shared/url';

/**
 * Context panel. In Phase 1 it shows verified facts about the current page only.
 * Company context, notes and financial data plug in here in Phases 2–3.
 */
export function RightPanel({ width }: { width: number }) {
  const tab = useActiveTab();
  const bookmarks = useBookmarks();
  const url = tab?.error?.url ?? tab?.url ?? '';
  const internal = isInternalUrl(url);
  const sec = securityStateOf(url);
  const bookmarked = bookmarks.some((b) => b.url === url);

  return (
    <aside className="rightpanel" style={{ width }} data-testid="right-panel">
      <div className="rp-head">
        <span className="rp-title">Contexto</span>
        <button className="icon-btn" aria-label="Cerrar panel" onClick={() => void updateSettings({ rightPanelVisible: false })}>
          <X size={14} />
        </button>
      </div>
      {!tab || internal ? (
        <p className="rp-empty">Abre una página web para ver su información aquí.</p>
      ) : (
        <div className="rp-body">
          <div className="rp-page">
            <Favicon src={tab.favicon} url={url} size={20} />
            <div>
              <div className="rp-page-title">{tab.title}</div>
              <div className="rp-page-host">{hostOf(url)}</div>
            </div>
          </div>
          <dl className="rp-facts">
            <dt>Conexión</dt>
            <dd className={sec === 'secure' || sec === 'local' ? 'pos' : 'neg'}>
              {sec === 'secure' ? <Lock size={12} /> : sec === 'local' ? <Monitor size={12} /> : <TriangleAlert size={12} />}{' '}
              {sec === 'secure' ? 'Cifrada (HTTPS)' : sec === 'local' ? 'Local, en este equipo (HTTP)' : 'No cifrada (HTTP)'}
            </dd>
            <dt>Estado</dt>
            <dd>{tab.error ? `Error: ${tab.error.description}` : tab.loading ? 'Cargando…' : 'Cargada'}</dd>
            <dt>Zoom</dt>
            <dd>{Math.round(tab.zoom * 100)}%</dd>
            <dt>URL</dt>
            <dd className="rp-url">{url}</dd>
          </dl>
          <div className="rp-actions">
            <button className="btn" onClick={() => runCommand('page.bookmark')}>
              <Star size={13} fill={bookmarked ? 'currentColor' : 'none'} /> {bookmarked ? 'En favoritos' : 'Añadir a favoritos'}
            </button>
            <button className="btn" onClick={() => runCommand('page.copyUrl')}>
              <ExternalLink size={13} /> Copiar URL
            </button>
          </div>
          <p className="rp-note">
            Próximas fases: vincular esta página a una empresa, guardar fragmentos con su fuente y ver datos verificados de SEC EDGAR.
          </p>
        </div>
      )}
    </aside>
  );
}
