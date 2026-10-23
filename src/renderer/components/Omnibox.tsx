import { useEffect, useRef, useState } from 'react';
import { AppWindow, Bookmark as BookmarkIcon, Clock, Globe, Lock, Search, TriangleAlert, LayoutGrid } from 'lucide-react';
import { ib, useActiveTab, useOverlay } from '../lib/ib';
import { displayUrl, isInternalUrl, NEW_TAB_URL, securityStateOf } from '../../shared/url';
import type { Suggestion } from '../../shared/types';

export function Omnibox({ focusRequest }: { focusRequest: number }) {
  const tab = useActiveTab();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [sel, setSel] = useState(0);
  const reqId = useRef(0);

  const url = tab?.error?.url ?? tab?.url ?? '';
  const shownUrl = url === NEW_TAB_URL ? '' : url;

  // Reflect the active tab's URL whenever the user is not editing.
  useEffect(() => {
    if (!focused) setText(shownUrl);
  }, [shownUrl, focused, tab?.id]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusRequest]);

  const open = focused && items.length > 0 && text.trim().length > 0;
  useOverlay(open);

  const query = (value: string) => {
    setText(value);
    setSel(0);
    const id = ++reqId.current;
    if (!value.trim()) {
      setItems([]);
      return;
    }
    void ib.invoke('suggest', { query: value }).then((s) => {
      if (id === reqId.current) setItems(s);
    });
  };

  const go = (s?: Suggestion) => {
    const pick = s ?? (open ? items[sel] : undefined);
    if (pick?.kind === 'tab' && pick.tabId) void ib.invoke('tabs:activate', { id: pick.tabId });
    else void ib.invoke('tabs:navigate', { id: tab?.id, input: pick ? pick.url : text });
    setItems([]);
    inputRef.current?.blur();
  };

  const sec = tab?.error ? 'unknown' : securityStateOf(url);
  const SecIcon = !shownUrl || focused ? Search : tab?.error ? TriangleAlert : sec === 'secure' ? Lock : sec === 'local' ? Globe : sec === 'internal' ? AppWindow : TriangleAlert;
  const secLabel = tab?.error ? 'La página no se pudo cargar' : sec === 'local' ? 'Conexión local a este equipo (sin cifrar)' : sec === 'secure' ? 'Conexión segura (HTTPS)' : sec === 'insecure' ? 'Conexión no segura (HTTP)' : sec === 'internal' ? 'Página interna' : 'Buscar o escribir dirección';

  return (
    <div className={`omnibox ${focused ? 'is-focused' : ''} ${open ? 'is-open' : ''}`}>
      <span className={`omni-sec sec-${focused ? 'search' : sec}`} title={secLabel} data-testid="security-indicator" data-state={sec}>
        <SecIcon size={14} />
      </span>
      <input
        ref={inputRef}
        className="omni-input"
        data-testid="address-bar"
        spellCheck={false}
        placeholder="Buscar o escribir una dirección"
        value={focused ? text : displayUrlForBar(shownUrl)}
        onChange={(e) => query(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          setText(shownUrl);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          setItems([]);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape') {
            if (open) setItems([]);
            else {
              setText(shownUrl);
              e.currentTarget.blur();
            }
          } else if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            setSel((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            setSel((i) => Math.max(i - 1, 0));
          }
        }}
      />
      {tab?.zoom && Math.abs(tab.zoom - 1) > 0.001 ? (
        <span className="omni-chip" title="Nivel de zoom">{Math.round(tab.zoom * 100)}%</span>
      ) : null}
      {open && (
        <ul className="omni-list" role="listbox" data-testid="suggestions">
          {items.map((s, i) => (
            <li
              key={`${s.kind}-${s.url}-${i}`}
              role="option"
              aria-selected={i === sel}
              className={`omni-item ${i === sel ? 'is-sel' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
              onMouseEnter={() => setSel(i)}
            >
              <SuggestionIcon kind={s.kind} />
              <span className="omni-item-title">{s.kind === 'search' ? s.title : s.title || displayUrl(s.url)}</span>
              <span className="omni-item-sub">
                {s.kind === 'search' ? 'Buscar' : s.kind === 'tab' ? 'Cambiar a pestaña' : displayUrl(s.url)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function displayUrlForBar(url: string): string {
  if (!url) return '';
  return isInternalUrl(url) ? url : displayUrl(url);
}

function SuggestionIcon({ kind }: { kind: Suggestion['kind'] }) {
  const size = 14;
  if (kind === 'search') return <Search size={size} className="muted" />;
  if (kind === 'bookmark') return <BookmarkIcon size={size} className="accent" />;
  if (kind === 'history') return <Clock size={size} className="muted" />;
  if (kind === 'tab') return <LayoutGrid size={size} className="muted" />;
  return <Globe size={size} className="muted" />;
}
