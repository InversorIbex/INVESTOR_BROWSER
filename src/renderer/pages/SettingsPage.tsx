import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Kbd, Toggle } from '../components/ui';
import { ib, runCommand, showToast, updateSettings, useSettings } from '../lib/ib';
import { SecContactForm } from '../components/SecPanel';
import type { QuotesStatus, SecStatus } from '../../shared/types';
import { formatBytes } from '../components/ui';
import { SEARCH_ENGINES, NEW_TAB_URL, normalizeInput } from '../../shared/url';
import { COMMANDS, COMMAND_IDS } from '../../shared/commands';
import type { AppInfo, SitePermission } from '../../shared/types';
import { BRAND } from '../../shared/brand';

const PERMISSION_LABEL: Record<string, string> = {
  notifications: 'Notificaciones',
  geolocation: 'Ubicación',
  media: 'Cámara / micrófono',
  'clipboard-read': 'Leer portapapeles',
  midi: 'MIDI',
  midiSysex: 'MIDI (control)',
  idleDetection: 'Detección de inactividad',
  'window-management': 'Gestión de ventanas',
};

export function SettingsPage() {
  const s = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [perms, setPerms] = useState<SitePermission[]>([]);
  const [home, setHome] = useState(s.homePage === NEW_TAB_URL ? '' : s.homePage);
  useEffect(() => {
    void ib.invoke('app:info').then(setInfo);
    void ib.invoke('permissions:list').then(setPerms);
  }, []);

  const set = (patch: Parameters<typeof updateSettings>[0]) => void updateSettings(patch);

  return (
    <div className="page settings" data-testid="settings-page">
      <header className="page-head">
        <h1>Ajustes</h1>
      </header>

      <Section title="Apariencia">
        <Row label="Tema">
          <Segmented
            value={s.theme}
            options={[
              ['dark', 'Oscuro'],
              ['terminal', 'Terminal'],
              ['light', 'Claro'],
              ['system', 'Sistema'],
            ]}
            onChange={(theme) => set({ theme })}
            testId="theme"
          />
        </Row>
        <Row label="Tamaño de letra de la interfaz" hint={`${s.fontSize}px`}>
          <input type="range" min={11} max={18} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} aria-label="Tamaño de letra" />
        </Row>
        <Row label="Pestañas">
          <Segmented
            value={s.tabLayout}
            options={[
              ['vertical', 'Verticales'],
              ['horizontal', 'Horizontales'],
            ]}
            onChange={(tabLayout) => set({ tabLayout })}
            testId="tab-layout"
          />
        </Row>
        <Row label="Mostrar panel lateral">
          <Toggle checked={s.sidebarVisible} onChange={(v) => set({ sidebarVisible: v })} label="Panel lateral" />
        </Row>
        <Row label="Botones de la barra de herramientas">
          <div className="chips">
            {(
              [
                ['home', 'Inicio'],
                ['bookmarkStar', 'Favorito'],
                ['downloads', 'Descargas'],
                ['palette', 'Comandos'],
                ['rightPanel', 'Panel de contexto'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="chip-check">
                <input type="checkbox" checked={s.toolbar[key]} onChange={(e) => set({ toolbar: { ...s.toolbar, [key]: e.target.checked } })} />
                {label}
              </label>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Navegación">
        <Row label="Buscador">
          <select className="select" value={s.searchEngine} onChange={(e) => set({ searchEngine: e.target.value })} data-testid="search-engine">
            {SEARCH_ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Página de inicio" hint="Vacío = nueva pestaña">
          <input
            className="input"
            value={home}
            placeholder="https://…"
            onChange={(e) => setHome(e.target.value)}
            onBlur={() => {
              const n = home.trim() ? normalizeInput(home, s.searchEngine) : null;
              const url = n && n.kind !== 'search' ? n.url : NEW_TAB_URL;
              if (home.trim() && !n?.url) showToast('Dirección no válida', 'error');
              set({ homePage: url });
            }}
          />
        </Row>
        <Row label="Restaurar pestañas al iniciar">
          <Toggle checked={s.restoreSession} onChange={(v) => set({ restoreSession: v })} label="Restaurar sesión" testId="restore-session" />
        </Row>
        <Row label="Bloquear ventanas emergentes" hint="Los enlaces normales siguen abriéndose en pestañas">
          <Toggle checked={s.blockPopupWindows} onChange={(v) => set({ blockPopupWindows: v })} label="Bloquear ventanas emergentes" />
        </Row>
        <Row label="Preguntar dónde guardar cada descarga">
          <Toggle checked={s.askDownloadLocation} onChange={(v) => set({ askDownloadLocation: v })} label="Preguntar ubicación de descarga" />
        </Row>
      </Section>

      <DataSourcesSection />

      <Section title="Privacidad y datos">
        <p className="section-note">
          Todo se guarda solo en este equipo. {BRAND.name} no envía telemetría ni sincroniza datos con ningún servidor.
        </p>
        <Row label="Guardar historial de navegación">
          <Toggle checked={s.historyEnabled} onChange={(v) => set({ historyEnabled: v })} label="Guardar historial" testId="history-enabled" />
        </Row>
        <Row label="Datos de navegación">
          <div className="btn-row">
            <button className="btn" onClick={() => runCommand('open.history')}>
              Gestionar historial
            </button>
            <button className="btn" onClick={() => void ib.invoke('data:clear', { what: 'cache' })}>
              Vaciar caché
            </button>
            <button className="btn btn-danger" onClick={() => void ib.invoke('data:clear', { what: 'siteData' })}>
              Borrar cookies y datos de sitios
            </button>
          </div>
        </Row>
        <Row label="Favoritos">
          <div className="btn-row">
            <button className="btn" onClick={() => runCommand('bookmarks.import')}>
              Importar HTML
            </button>
            <button className="btn" onClick={() => runCommand('bookmarks.export')}>
              Exportar HTML
            </button>
          </div>
        </Row>
        <Row label="Investigación">
          <div className="btn-row">
            <button className="btn" onClick={() => runCommand('research.export')}>
              Exportar Markdown
            </button>
            <button className="btn" onClick={() => runCommand('research.exportJson')}>
              Exportar JSON
            </button>
            <button className="btn" onClick={() => runCommand('research.import')}>
              Importar JSON
            </button>
          </div>
        </Row>
        <Row label="Copia de seguridad completa" hint="Un archivo .db con todo: ajustes, favoritos, historial e investigación">
          <button className="btn" onClick={() => runCommand('data.backup')} data-testid="backup">
            Crear copia…
          </button>
        </Row>
        <Row label="Sesión">
          <button className="btn" onClick={() => runCommand('session.restore')}>
            Restaurar sesión anterior
          </button>
        </Row>
        <div className="subsection">
          <h3>Permisos de sitios</h3>
          {perms.length === 0 ? (
            <p className="muted small">Ningún sitio tiene permisos guardados. Los sitios te preguntarán antes de usar ubicación, cámara, notificaciones, etc.</p>
          ) : (
            <ul className="list compact">
              {perms.map((p) => (
                <li key={`${p.origin}-${p.permission}`} className="list-row">
                  <span className="list-main static">
                    <span className="ellipsis">{p.origin}</span>
                    <span className="list-sub">{PERMISSION_LABEL[p.permission] ?? p.permission}</span>
                  </span>
                  <span className={`tag ${p.decision === 'allow' ? 'tag-pos' : 'tag-neg'}`}>{p.decision === 'allow' ? 'Permitido' : 'Bloqueado'}</span>
                  <button
                    className="icon-btn"
                    aria-label="Revocar"
                    onClick={() =>
                      void ib.invoke('permissions:remove', { origin: p.origin, permission: p.permission }).then(() => ib.invoke('permissions:list').then(setPerms))
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Atajos de teclado">
        <div className="shortcuts">
          {COMMAND_IDS.filter((id) => COMMANDS[id].keys.length).map((id) => (
            <div key={id} className="shortcut-row">
              <span>{COMMANDS[id].title}</span>
              <span className="shortcut-keys">
                {COMMANDS[id].keys.slice(0, 2).map((k) => (
                  <Kbd key={k} accel={k} />
                ))}
              </span>
            </div>
          ))}
          <div className="shortcut-row">
            <span>Ir a la pestaña 1–8 / última</span>
            <span className="shortcut-keys">
              <Kbd accel="Mod+1…9" />
            </span>
          </div>
        </div>
      </Section>

      <Section title="Acerca de">
        {info && (
          <dl className="about">
            <dt>Versión</dt>
            <dd>{info.version}</dd>
            <dt>Motor</dt>
            <dd>
              Chromium {info.chrome} · Electron {info.electron} · Node {info.node}
            </dd>
            <dt>Plataforma</dt>
            <dd>{info.platform}</dd>
            <dt>Datos locales</dt>
            <dd className="mono small">{info.dbPath}</dd>
          </dl>
        )}
        <p className="section-note">
          Software libre bajo licencia Apache-2.0. Las fuentes de datos financieros tienen sus propias condiciones de uso; consulta docs/DATA_SOURCES.md.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        {label}
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: [T, string][]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="segmented" role="radiogroup" data-testid={testId}>
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)} data-value={v}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DataSourcesSection() {
  const settings = useSettings();
  const [status, setStatus] = useState<SecStatus | null>(null);
  const load = () => void ib.invoke('sec:status').then(setStatus);
  useEffect(load, [settings.secContact]);
  return (
    <Section title="Fuentes de datos">
      <div className="subsection">
        <h3>SEC EDGAR (EE. UU.) · gratuita, sin clave</h3>
        <p className="section-note">
          Cifras XBRL de informes 10-K, 20-F y 40-F, y lista de presentaciones. Máximo 8 consultas por segundo (la SEC permite 10), con caché local: informes 12 h, presentaciones 6 h, lista de tickers 7 días.
          Solo se consulta cuando tú lo pides desde el dossier de una empresa.
        </p>
        <SecContactForm compact={false} onSaved={load} />
        {status && (
          <dl className="about">
            <dt>Estado</dt>
            <dd>{status.contactSet ? 'Configurada' : 'Sin contacto: no se hará ninguna consulta'}</dd>
            <dt>Consultas en esta sesión</dt>
            <dd>{status.requestsMade}</dd>
            <dt>Caché</dt>
            <dd>
              {status.cacheEntries} respuesta(s) · {formatBytes(status.cacheBytes)}{' '}
              <button className="link-btn small" onClick={() => void ib.invoke('sec:clearCache').then(load)}>
                Vaciar
              </button>
            </dd>
            {status.lastError && (
              <>
                <dt>Último error</dt>
                <dd className="warn-text">{status.lastError}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      <div className="subsection">
        <h3>Cuentas europeas (ESEF) · gratuita, sin clave</h3>
        <p className="section-note">
          Informes anuales oficiales de cotizadas de la UE y Reino Unido desde filings.xbrl.org (XBRL International). Usa el mismo contacto que la SEC. Alemania y Suiza no tienen fuente automática: ver el dossier de cada empresa.
        </p>
      </div>
      <QuotesSettings />
      <div className="subsection">
        <h3>Próximamente</h3>
        <p className="section-note">FRED (macro, requiere tu clave gratuita), Treasury Fiscal Data y Eurostat. Ver docs/DATA_SOURCES.md.</p>
      </div>
    </Section>
  );
}

const PROVIDERS: { id: 'finnhub' | 'eodhd'; name: string; what: string; signup: string }[] = [
  { id: 'finnhub', name: 'Finnhub', what: 'Acciones de EE. UU. · plan gratuito ~60 consultas/minuto', signup: 'https://finnhub.io/register' },
  { id: 'eodhd', name: 'EODHD', what: 'Cualquier bolsa (Madrid, París, Xetra, SIX, Milán, Londres…) · retraso de 15 min · plan gratuito 20 consultas/día', signup: 'https://eodhd.com/register' },
];

function QuotesSettings() {
  const settings = useSettings();
  const [status, setStatus] = useState<QuotesStatus | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const load = () => void ib.invoke('quotes:status').then(setStatus);
  useEffect(load, []);
  const save = async (id: 'finnhub' | 'eodhd') => {
    setBusy(id);
    setMsg((m) => ({ ...m, [id]: '' }));
    try {
      const r = await ib.invoke('quotes:setKey', { provider: id, key: keys[id] ?? '' });
      setStatus(r.status);
      setKeys((k) => ({ ...k, [id]: '' }));
      setMsg((m) => ({ ...m, [id]: r.message }));
    } catch (err) {
      setMsg((m) => ({ ...m, [id]: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="subsection" data-testid="quotes-settings">
      <h3>Cotizaciones con retraso · con tu clave gratuita</h3>
      <p className="section-note">
        No existe una fuente gratuita, sin clave y con permiso de uso automático para cotizaciones de EE. UU. y Europa. Date de alta gratis en uno o ambos proveedores y pega aquí tu clave. Se prueba con una consulta, se
        guarda <strong>cifrada por el sistema operativo</strong> y nunca se muestra, se registra ni se exporta. Los precios se marcan siempre como retrasados, con su proveedor y la hora del dato. También puedes seleccionar
        un precio en cualquier web y usar <em>clic derecho › Usar como cotización</em>.
      </p>
      {status && !status.canStore.ok && <p className="warn-text small">{status.canStore.reason}</p>}
      {PROVIDERS.map((p) => {
        const st = status?.[p.id];
        return (
          <div key={p.id} className="settings-row" data-testid={`key-${p.id}`}>
            <div className="settings-label">
              {p.name}
              <span className="settings-hint">{p.what}</span>
            </div>
            <div className="settings-control" style={{ flex: '1 1 320px' }}>
              {st?.configured ? (
                <div className="key-row">
                  <span className="mono small" data-testid={`key-${p.id}-status`}>
                    {st.readable ? `Configurada ····${st.last4 ?? ''}` : 'Guardada pero ilegible en este equipo: vuelve a introducirla'}
                  </span>
                  <button className="btn btn-sm" onClick={() => void ib.invoke('quotes:deleteKey', { provider: p.id }).then(setStatus)}>
                    Borrar clave
                  </button>
                </div>
              ) : (
                <div className="key-row">
                  <input
                    className="input mono"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keys[p.id] ?? ''}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                    placeholder={`Clave de ${p.name}`}
                    data-testid={`key-${p.id}-input`}
                  />
                  <button className="btn btn-primary btn-sm" disabled={busy !== null || !(keys[p.id] ?? '').trim() || !status?.canStore.ok} onClick={() => void save(p.id)} data-testid={`key-${p.id}-save`}>
                    {busy === p.id ? 'Probando…' : 'Probar y guardar'}
                  </button>
                  <button className="link-btn small" onClick={() => void ib.invoke('tabs:create', { url: p.signup })}>
                    Crear cuenta gratuita
                  </button>
                </div>
              )}
              {msg[p.id] && (
                <div className="small" data-testid={`key-${p.id}-msg`}>
                  {msg[p.id]}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <Row label="Actualizar solas" hint="Al abrir la app y cada 30 minutos, solo si hay alguna clave">
        <Toggle checked={settings.quotesAuto} onChange={(v) => void updateSettings({ quotesAuto: v })} label="Actualizar cotizaciones automáticamente" testId="quotes-auto" />
      </Row>
      <Row label="Cupo diario de EODHD" hint="Nunca se supera. Las empresas seguidas van primero">
        <div>
          <input
            className="input mono input-xs"
            type="number"
            min={1}
            max={100000}
            value={settings.eodhdDailyLimit}
            onChange={(e) => {
              const v = Math.max(1, Math.min(100000, Math.round(Number(e.target.value) || 1)));
              void updateSettings({ eodhdDailyLimit: v }).then(load);
            }}
            aria-label="Consultas diarias máximas a EODHD"
            data-testid="eodhd-limit"
          />
          {status && (
            <div className="small muted" data-testid="eodhd-used">
              Hoy: {status.eodhdUsed} de {status.eodhdLimit}
              <div className="quota-bar">
                <span style={{ width: `${Math.min(100, (status.eodhdUsed / Math.max(1, status.eodhdLimit)) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </Row>
    </div>
  );
}
