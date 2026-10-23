import { useMemo, useState } from 'react';
import { Bookmark as BookmarkIcon, Download, Pencil, Search, Upload, X, Check } from 'lucide-react';
import { EmptyState, LetterAvatar } from '../components/ui';
import { ib, runCommand, useBookmarks } from '../lib/ib';
import { displayUrl } from '../../shared/url';
import { rankBy } from '../../shared/fuzzy';
import type { Bookmark } from '../../shared/types';

export function BookmarksPage() {
  const bookmarks = useBookmarks();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => (q ? rankBy(bookmarks, q, (b) => `${b.title} ${b.url} ${b.folder}`, 1000) : bookmarks), [q, bookmarks]);
  const groups = useMemo(() => {
    const map = new Map<string, Bookmark[]>();
    for (const b of filtered) map.set(b.folder, [...(map.get(b.folder) ?? []), b]);
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [filtered]);

  return (
    <div className="page" data-testid="bookmarks-page">
      <header className="page-head">
        <h1>Favoritos</h1>
        <div className="page-tools">
          <label className="search-field">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en favoritos" />
          </label>
          <button className="btn" onClick={() => runCommand('bookmarks.import')}>
            <Upload size={13} /> Importar
          </button>
          <button className="btn" onClick={() => runCommand('bookmarks.export')} disabled={!bookmarks.length}>
            <Download size={13} /> Exportar
          </button>
        </div>
      </header>
      {filtered.length === 0 ? (
        <EmptyState icon={<BookmarkIcon size={28} />} title={q ? 'Sin coincidencias' : 'Aún no tienes favoritos'}>
          Pulsa la estrella de la barra de direcciones o Ctrl+D. También puedes importar un archivo HTML exportado desde Chrome, Edge o Firefox.
        </EmptyState>
      ) : (
        groups.map(([folder, list]) => (
          <section key={folder || '_root'} className="list-group">
            <h2 className="list-group-title">{folder || 'Sin carpeta'}</h2>
            <ul className="list">
              {list.map((b) => (
                <BookmarkRow key={b.id} b={b} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function BookmarkRow({ b }: { b: Bookmark }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(b.title);
  const [folder, setFolder] = useState(b.folder);
  const save = () => {
    void ib.invoke('bookmarks:update', { id: b.id, title: title.trim() || b.title, folder: folder.trim() });
    setEditing(false);
  };
  if (editing)
    return (
      <li className="list-row is-editing">
        <LetterAvatar url={b.url} size={16} />
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
        <input className="input input-sm" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Carpeta" aria-label="Carpeta" onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button className="icon-btn" aria-label="Guardar" onClick={save}>
          <Check size={14} />
        </button>
      </li>
    );
  return (
    <li className="list-row" data-testid="bookmark-row">
      <LetterAvatar url={b.url} size={16} />
      <button
        className="list-main"
        title={b.url}
        onClick={(e) => (e.ctrlKey || e.metaKey ? void ib.invoke('tabs:create', { url: b.url, active: false }) : void ib.invoke('tabs:navigate', { input: b.url }))}
      >
        <span className="ellipsis">{b.title}</span>
        <span className="list-sub ellipsis">{displayUrl(b.url)}</span>
      </button>
      <button className="icon-btn row-action" aria-label="Editar" onClick={() => setEditing(true)}>
        <Pencil size={13} />
      </button>
      <button className="icon-btn row-action" aria-label="Eliminar favorito" onClick={() => void ib.invoke('bookmarks:remove', { id: b.id })}>
        <X size={14} />
      </button>
    </li>
  );
}
