import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Bookmark as BookmarkIcon, Clock, CornerDownLeft, LayoutGrid, Search, Terminal } from 'lucide-react';
import { Favicon, Kbd } from './ui';
import { ib, runCommand, useBookmarks, useBrowser, useCompanies, useOverlay } from '../lib/ib';
import { COMMANDS, COMMAND_IDS, type CommandId } from '../../shared/commands';
import { fuzzyScore, rankBy } from '../../shared/fuzzy';
import { displayUrl, isInternalUrl } from '../../shared/url';
import type { Suggestion } from '../../shared/types';

type Item =
  | { type: 'command'; id: CommandId; title: string; group: string; keys: readonly string[] }
  | { type: 'tab'; tabId: string; title: string; url: string; favicon: string | null }
  | { type: 'link'; kind: Suggestion['kind']; title: string; url: string };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  useOverlay(true);
  const { tabs, activeTabId } = useBrowser();
  const bookmarks = useBookmarks();
  const companies = useCompanies();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    if (!q.trim()) setRemote([]);
    else void ib.invoke('suggest', { query: q }).then((s) => alive && setRemote(s));
    return () => {
      alive = false;
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const commands: Item[] = COMMAND_IDS.filter((id) => id !== 'ui.palette').map((id) => ({
      type: 'command',
      id,
      title: COMMANDS[id].title,
      group: COMMANDS[id].group,
      keys: COMMANDS[id].keys,
    }));
    const openTabs: Item[] = tabs
      .filter((t) => t.id !== activeTabId)
      .map((t) => ({ type: 'tab', tabId: t.id, title: t.title || 'Sin título', url: t.url, favicon: t.favicon }));
    const companyItems: Item[] = companies.map((c) => ({ type: 'link', kind: 'company', title: `${c.ticker ? c.ticker + ' — ' : ''}${c.name}`, url: `ib://company/${c.id}` }));
    if (!q.trim()) return [...companyItems.slice(0, 5), ...openTabs.slice(0, 6), ...commands];
    const rankedCompanies = rankBy(companyItems, q.replace(/^\$/, ''), (c) => (c as { title: string }).title, 4);

    const rankedCmds = rankBy(commands, q, (c) => `${c.title} ${(c as { group: string }).group}`, 8);
    const rankedTabs = rankBy(openTabs, q, (t) => `${t.title} ${displayUrl((t as { url: string }).url)}`, 5);
    const nav = remote.filter((s) => s.kind === 'search' || s.kind === 'url').slice(0, 1);
    const links = remote.filter((s) => s.kind === 'bookmark' || s.kind === 'history');
    const bm = rankBy(bookmarks, q, (b) => `${b.title} ${b.url}`, 4)
      .filter((b) => !links.some((l) => l.url === b.url))
      .map((b) => ({ kind: 'bookmark' as const, url: b.url, title: b.title }));
    const navItems = nav.map<Item>((s) => ({ type: 'link', kind: s.kind, title: s.title, url: s.url }));
    const linkItems = [...bm, ...links].slice(0, 6).map<Item>((s) => ({ type: 'link', kind: s.kind, title: s.title, url: s.url }));
    // A strong command match (prefix or word start) wins over "search the web for…";
    // an explicit URL always comes first.
    const best = rankedCmds[0] ? fuzzyScore(q, (rankedCmds[0] as { title: string }).title) : 0;
    const commandFirst = best >= 600 && nav[0]?.kind !== 'url';
    return commandFirst
      ? [...rankedCompanies, ...rankedCmds, ...rankedTabs, ...navItems, ...linkItems]
      : [...rankedCompanies, ...navItems, ...rankedTabs, ...rankedCmds, ...linkItems];
  }, [q, tabs, activeTabId, bookmarks, remote, companies]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const execute = (item: Item | undefined, newTab = false) => {
    if (!item) return;
    onClose();
    if (item.type === 'command') {
      // Let the overlay close first so commands that focus the page work.
      setTimeout(() => runCommand(item.id), 0);
    } else if (item.type === 'tab') {
      void ib.invoke('tabs:activate', { id: item.tabId });
    } else if (newTab) {
      void ib.invoke('tabs:create', { url: item.url });
    } else {
      void ib.invoke('tabs:navigate', { input: item.url });
    }
  };

  let lastGroup = '';
  return (
    <div className="palette-backdrop" onMouseDown={onClose} data-testid="palette">
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Paleta de comandos">
        <div className="palette-input">
          <Search size={16} className="muted" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Escribe un comando, una pestaña, una web o una búsqueda…"
            data-testid="palette-input"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                execute(items[sel], e.ctrlKey || e.metaKey);
              }
            }}
          />
          <Kbd accel="Esc" />
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">Sin resultados</div>}
          {items.map((item, i) => {
            const group =
              item.type === 'command' ? item.group : item.type === 'tab' ? 'Pestañas abiertas' : item.kind === 'company' ? 'Empresas' : item.kind === 'search' || item.kind === 'url' ? 'Ir' : 'Favoritos e historial';
            const header = group !== lastGroup ? <div className="palette-group">{group}</div> : null;
            lastGroup = group;
            return (
              <div key={`${item.type}-${i}`}>
                {header}
                <div
                  className={`palette-item ${i === sel ? 'is-sel' : ''}`}
                  data-testid="palette-item"
                  onMouseMove={() => setSel(i)}
                  onClick={() => execute(item)}
                >
                  <PaletteIcon item={item} />
                  <span className="ellipsis">{item.title}</span>
                  {item.type !== 'command' && !isInternalUrl(item.url) && <span className="palette-sub ellipsis">{displayUrl(item.url)}</span>}
                  <span className="sb-flex" />
                  {item.type === 'command' && item.keys[0] && <Kbd accel={item.keys[0]} />}
                  {i === sel && <CornerDownLeft size={13} className="muted" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaletteIcon({ item }: { item: Item }) {
  if (item.type === 'command') return <Terminal size={14} className="muted" />;
  if (item.type === 'tab') return item.favicon ? <Favicon src={item.favicon} url={item.url} size={14} /> : <LayoutGrid size={14} className="muted" />;
  if (item.kind === 'search') return <Search size={14} className="muted" />;
  if (item.kind === 'company') return <BookOpen size={14} className="accent" />;
  if (item.kind === 'bookmark') return <BookmarkIcon size={14} className="accent" />;
  if (item.kind === 'history') return <Clock size={14} className="muted" />;
  return <ArrowRight size={14} className="muted" />;
}
