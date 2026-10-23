import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Favicon } from './ui';
import { ib, runCommand, useBrowser } from '../lib/ib';

/** Horizontal tab layout (Settings › Apariencia › Pestañas horizontales). */
export function TabStrip() {
  const { tabs, activeTabId } = useBrowser();
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="tabstrip" data-testid="tabstrip">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`hstrip-tab ${t.id === activeTabId ? 'is-active' : ''} ${t.pinned ? 'is-pinned' : ''}`}
          data-testid="tab"
          data-active={t.id === activeTabId}
          title={t.title}
          draggable
          onDragStart={() => setDragId(t.id)}
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) void ib.invoke('tabs:move', { id: dragId, index: i });
            setDragId(null);
          }}
          onClick={() => void ib.invoke('tabs:activate', { id: t.id })}
          onAuxClick={(e) => e.button === 1 && void ib.invoke('tabs:close', { id: t.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            void ib.invoke('tabs:contextMenu', { id: t.id });
          }}
        >
          <Favicon src={t.favicon} url={t.url} loading={t.loading} size={14} />
          {!t.pinned && <span className="ellipsis">{t.title || 'Sin título'}</span>}
          {!t.pinned && (
            <button
              className="tab-close"
              aria-label="Cerrar pestaña"
              onClick={(e) => {
                e.stopPropagation();
                void ib.invoke('tabs:close', { id: t.id });
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button className="hstrip-new" aria-label="Nueva pestaña" onClick={() => runCommand('tab.new')}>
        <Plus size={15} />
      </button>
    </div>
  );
}
