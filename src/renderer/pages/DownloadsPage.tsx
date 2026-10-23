import { Download, FolderOpen, Pause, Play, X, FileText } from 'lucide-react';
import { EmptyState, formatBytes } from '../components/ui';
import { ib, useDownloads } from '../lib/ib';
import type { DownloadItemState } from '../../shared/types';

const STATUS: Record<DownloadItemState['status'], string> = {
  progressing: 'Descargando',
  paused: 'En pausa',
  completed: 'Completada',
  cancelled: 'Cancelada',
  interrupted: 'Interrumpida',
};

export function DownloadsPage() {
  const downloads = useDownloads();
  const act = (id: string, action: 'open' | 'show' | 'cancel' | 'pause' | 'resume' | 'remove') =>
    void ib.invoke('downloads:action', { id, action });
  return (
    <div className="page" data-testid="downloads-page">
      <header className="page-head">
        <h1>Descargas</h1>
        <div className="page-tools">
          <button className="btn" onClick={() => void ib.invoke('downloads:clear')} disabled={!downloads.some((d) => d.status !== 'progressing' && d.status !== 'paused')}>
            Limpiar lista
          </button>
        </div>
      </header>
      {downloads.length === 0 ? (
        <EmptyState icon={<Download size={28} />} title="No hay descargas">
          Los informes anuales, presentaciones y demás archivos que descargues aparecerán aquí.
        </EmptyState>
      ) : (
        <ul className="list">
          {downloads.map((d) => {
            const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : null;
            const live = d.status === 'progressing' || d.status === 'paused';
            return (
              <li key={d.id} className="list-row dl-row" data-testid="download-row" data-status={d.status}>
                <FileText size={18} className="muted" />
                <div className="list-main static">
                  <button className="link-btn ellipsis" disabled={d.status !== 'completed'} onClick={() => act(d.id, 'open')} title={d.savePath}>
                    {d.filename}
                  </button>
                  <span className="list-sub">
                    {STATUS[d.status]} · {live ? `${formatBytes(d.receivedBytes)} de ${formatBytes(d.totalBytes)}` : formatBytes(d.totalBytes || d.receivedBytes)}
                  </span>
                  {live && (
                    <div className="progress">
                      <div className={`progress-bar ${pct === null ? 'indeterminate' : ''}`} style={{ width: pct === null ? '30%' : `${pct}%` }} />
                    </div>
                  )}
                </div>
                {d.status === 'progressing' && (
                  <button className="icon-btn" aria-label="Pausar" onClick={() => act(d.id, 'pause')}>
                    <Pause size={14} />
                  </button>
                )}
                {d.status === 'paused' && (
                  <button className="icon-btn" aria-label="Reanudar" onClick={() => act(d.id, 'resume')}>
                    <Play size={14} />
                  </button>
                )}
                {d.status === 'completed' && (
                  <button className="icon-btn" aria-label="Mostrar en carpeta" onClick={() => act(d.id, 'show')}>
                    <FolderOpen size={14} />
                  </button>
                )}
                <button className="icon-btn" aria-label={live ? 'Cancelar' : 'Quitar de la lista'} onClick={() => act(d.id, live ? 'cancel' : 'remove')}>
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
