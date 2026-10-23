import { ArrowLeft, ArrowRight, BookmarkPlus, Command, Download, House, PanelLeft, PanelRight, RotateCw, Star, X } from 'lucide-react';
import { Omnibox } from './Omnibox';
import { IconButton } from './ui';
import { ib, isMac, runCommand, useActiveTab, useBookmarks, useDownloads, usePopups, useSettings, useToasts, updateSettings } from '../lib/ib';
import { displayUrl, isSafeWebUrl } from '../../shared/url';

export function TopBar({ addressRequest }: { addressRequest: number }) {
  const tab = useActiveTab();
  const settings = useSettings();
  const bookmarks = useBookmarks();
  const downloads = useDownloads();
  const popups = usePopups();
  const toasts = useToasts();
  const tb = settings.toolbar;

  const isWeb = !!tab && isSafeWebUrl(tab.url) && !tab.error;
  const bookmarked = !!tab && bookmarks.some((b) => b.url === tab.url);
  const active = downloads.filter((d) => d.status === 'progressing' || d.status === 'paused');
  const progress =
    active.length && active.every((d) => d.totalBytes > 0)
      ? active.reduce((s, d) => s + d.receivedBytes, 0) / active.reduce((s, d) => s + d.totalBytes, 0)
      : null;

  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <IconButton
          label={settings.sidebarVisible ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
          onClick={() => void updateSettings({ sidebarVisible: !settings.sidebarVisible })}
        >
          <PanelLeft size={16} />
        </IconButton>
        <span className="topbar-sep" />
        <IconButton label="Atrás (Alt+←)" disabled={!tab?.canGoBack} onClick={() => runCommand('nav.back')} testId="nav-back">
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton label="Adelante (Alt+→)" disabled={!tab?.canGoForward} onClick={() => runCommand('nav.forward')} testId="nav-forward">
          <ArrowRight size={16} />
        </IconButton>
        {tab?.loading ? (
          <IconButton label="Detener" onClick={() => runCommand('nav.stop')} testId="nav-stop">
            <X size={16} />
          </IconButton>
        ) : (
          <IconButton label="Recargar (Ctrl+R)" disabled={!tab || !(isSafeWebUrl(tab.url) || tab.error)} onClick={() => runCommand('nav.reload')} testId="nav-reload">
            <RotateCw size={15} />
          </IconButton>
        )}
        {tb.home && (
          <IconButton label="Inicio" onClick={() => runCommand('nav.home')}>
            <House size={15} />
          </IconButton>
        )}
      </div>

      <div className="topbar-center">
        <Omnibox focusRequest={addressRequest} />
        {tb.bookmarkStar && (
          <IconButton
            label={bookmarked ? 'Quitar de favoritos (Ctrl+D)' : 'Añadir a favoritos (Ctrl+D)'}
            disabled={!isWeb}
            active={bookmarked}
            onClick={() => runCommand('page.bookmark')}
            testId="bookmark-star"
          >
            <Star size={15} fill={bookmarked ? 'currentColor' : 'none'} />
          </IconButton>
        )}
        <IconButton label="Guardar en investigación (Ctrl+Shift+S)" disabled={!isWeb} onClick={() => runCommand('research.save')} testId="save-research">
          <BookmarkPlus size={15} />
        </IconButton>
      </div>

      <div className="topbar-right">
        <div className="status-slot" aria-live="polite">
          {popups.map((p) => (
            <span key={p.id} className="pill pill-warn" data-testid="popup-notice">
              Ventana emergente bloqueada · {displayUrl(p.url).slice(0, 40)}
              <button className="pill-btn" onClick={() => void ib.invoke('popups:open', { id: p.id })}>
                Abrir en pestaña
              </button>
              <button className="pill-x" aria-label="Descartar" onClick={() => void ib.invoke('popups:dismiss', { id: p.id })}>
                <X size={12} />
              </button>
            </span>
          ))}
          {toasts.map((t) => (
            <span key={t.id} className={`pill ${t.kind === 'error' ? 'pill-error' : ''}`} data-testid="toast">
              {t.message}
            </span>
          ))}
        </div>
        {tb.downloads && (active.length > 0 || downloads.length > 0) && (
          <IconButton label="Descargas (Ctrl+J)" onClick={() => runCommand('open.downloads')} className="dl-btn" testId="downloads-btn">
            <Download size={15} />
            {progress !== null && (
              <svg className="dl-ring" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10" pathLength={100} strokeDasharray={`${Math.round(progress * 100)} 100`} />
              </svg>
            )}
            {active.length > 0 && <span className="badge">{active.length}</span>}
          </IconButton>
        )}
        {tb.palette && (
          <button className="palette-btn" onClick={() => runCommand('ui.palette')} title="Paleta de comandos" data-testid="palette-btn">
            {isMac ? <Command size={13} /> : <span>Ctrl</span>}
            <span>K</span>
          </button>
        )}
        {tb.rightPanel && (
          <IconButton
            label="Panel de investigación (Ctrl+.)"
            active={settings.rightPanelVisible}
            onClick={() => void updateSettings({ rightPanelVisible: !settings.rightPanelVisible })}
          >
            <PanelRight size={16} />
          </IconButton>
        )}
      </div>
    </header>
  );
}
