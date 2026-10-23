import { useState, type ReactNode } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { hostOf } from '../../shared/url';
import { formatAccelerator } from '../../shared/commands';
import { isMac } from '../lib/ib';

export function IconButton(props: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${props.active ? 'is-active' : ''} ${props.className ?? ''}`}
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

const PALETTE = ['#5B8CFF', '#3FB68B', '#E3A13B', '#C46BE0', '#F0616D', '#2CB5C9', '#8E9BB0'];
export function letterColor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function LetterAvatar({ url, size = 16 }: { url: string; size?: number }) {
  const host = hostOf(url) || '?';
  return (
    <span
      className="letter-avatar"
      style={{ width: size, height: size, background: letterColor(host), fontSize: Math.round(size * 0.6) }}
      aria-hidden
    >
      {host[0]!.toUpperCase()}
    </span>
  );
}

export function Favicon({ src, url, loading, size = 16 }: { src: string | null; url: string; loading?: boolean; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (loading) return <Loader2 className="spin favicon" size={size} aria-label="Cargando" />;
  if (url.startsWith('ib://')) return <BrandMark size={size} />;
  if (src && failed !== src)
    return <img className="favicon" src={src} width={size} height={size} alt="" onError={() => setFailed(src)} draggable={false} />;
  if (!hostOf(url)) return <Globe className="favicon muted" size={size} />;
  return <LetterAvatar url={url} size={size} />;
}

export function Kbd({ accel }: { accel: string }) {
  return <kbd className="kbd">{formatAccelerator(accel, isMac)}</kbd>;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function BrandMark({ size = 20 }: { size?: number }) {
  // Simple, replaceable mark: an ascending line inside a rounded square.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="brand-mark">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M7 21.5 L13 15.5 L17.5 19 L25 10.5" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="10.5" r="2.2" fill="#fff" />
    </svg>
  );
}
