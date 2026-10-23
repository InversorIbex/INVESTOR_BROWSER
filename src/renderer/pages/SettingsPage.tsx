import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Kbd, Toggle } from '../components/ui';
import { ib, runCommand, showToast, updateSettings, useSettings } from '../lib/ib';
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
