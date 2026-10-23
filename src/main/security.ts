/**
 * Process-wide security hardening and the web-content session policy.
 * See docs/SECURITY_MODEL.md for the reasoning behind each rule.
 */
import { app, dialog, session, shell, type BrowserWindow, type Session, type WebContents } from 'electron';
import type { Store } from './db';
import { classifyUrl, originOf } from '../shared/url';
import { WEB_PARTITION } from './tabs';
import { logError } from './log';

/** Permissions a site may request. Everything not listed here is denied silently. */
const ASKABLE: Record<string, string> = {
  notifications: 'mostrar notificaciones',
  geolocation: 'conocer tu ubicación',
  media: 'usar la cámara o el micrófono',
  'clipboard-read': 'leer el portapapeles',
  midi: 'usar dispositivos MIDI',
  midiSysex: 'controlar dispositivos MIDI',
  idleDetection: 'saber si estás inactivo',
  'window-management': 'gestionar tus ventanas',
};
/** Harmless permissions granted without asking. */
const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection']);

export function isTrustedUiUrl(url: string, devServerUrl: string | undefined): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl);
  return url.startsWith('file://') && url.includes('/renderer/index.html');
}

/** Install process-wide guards. Must be called before any window is created. */
export function installGlobalGuards(getUiContents: () => WebContents | null, onNewWebWindowUrl: (url: string) => void): void {
  app.on('web-contents-created', (_e, contents) => {
    // <webview> is never allowed anywhere.
    contents.on('will-attach-webview', (event) => event.preventDefault());

    // Default policy for any webContents not explicitly configured (e.g. allowed popups):
    // links that try to open windows become tabs; everything else is denied.
    contents.setWindowOpenHandler(({ url }) => {
      if (classifyUrl(url) === 'web') onNewWebWindowUrl(url);
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event) => {
      const ui = getUiContents();
      if (ui && contents === ui) {
        // The trusted UI never navigates away from itself.
        event.preventDefault();
        return;
      }
      if (classifyUrl(event.url) !== 'web') event.preventDefault();
    });
  });
}

export interface WebSessionDeps {
  store: Store;
  win(): BrowserWindow | null;
}

export function configureWebSession(deps: WebSessionDeps): Session {
  const ses = session.fromPartition(WEB_PARTITION);

  // Present as plain Chrome so sites don't degrade for an unknown "Electron" UA.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|investor-browser|Investor Browser)\/\S+/gi, ''));
  ses.setSpellCheckerEnabled(false);

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOW.has(permission)) return true;
    const origin = originOf(requestingOrigin);
    if (!origin || !(permission in ASKABLE)) return false;
    return deps.store.getPermission(origin, permission) === 'allow';
  });

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS_ALLOW.has(permission)) return callback(true);

    if (permission === 'openExternal') {
      const url = (details as { externalURL?: string }).externalURL ?? '';
      const kind = classifyUrl(url);
      if (kind !== 'mailto' && kind !== 'tel') return callback(false);
      void confirmExternal(deps.win(), url).then(callback);
      return;
    }

    const origin = originOf(details.requestingUrl ?? wc.getURL());
    const label = ASKABLE[permission];
    if (!origin || !label) return callback(false);

    const saved = deps.store.getPermission(origin, permission);
    if (saved) return callback(saved === 'allow');

    const win = deps.win();
    if (!win) return callback(false);
    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Permitir', 'Bloquear', 'Ahora no'],
        defaultId: 2,
        cancelId: 2,
        title: 'Permiso del sitio',
        message: `${new URL(origin).host} quiere ${label}.`,
        detail: 'Puedes cambiar esta decisión en Ajustes › Permisos de sitios.',
      })
      .then(({ response }) => {
        if (response === 0) deps.store.setPermission(origin, permission, 'allow');
        if (response === 1) deps.store.setPermission(origin, permission, 'deny');
        callback(response === 0);
      })
      .catch((err) => {
        logError('permission', err);
        callback(false);
      });
  });

  // Block device APIs entirely in v1 (USB/HID/serial/bluetooth are not needed by investors).
  ses.setDevicePermissionHandler(() => false);
  ses.on('select-hid-device', (e, _d, cb) => {
    e.preventDefault();
    cb('');
  });
  ses.on('select-serial-port', (e, _p, _wc, cb) => {
    e.preventDefault();
    cb('');
  });
  ses.on('select-usb-device', (e, _d, cb) => {
    e.preventDefault();
    cb();
  });

  return ses;
}

export async function confirmExternal(win: BrowserWindow | null, url: string): Promise<boolean> {
  const kind = classifyUrl(url);
  if (kind !== 'mailto' && kind !== 'tel') return false;
  const opts = {
    type: 'question' as const,
    buttons: ['Abrir', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Abrir aplicación externa',
    message: kind === 'mailto' ? '¿Abrir tu aplicación de correo?' : '¿Abrir tu aplicación de llamadas?',
    detail: url.slice(0, 300),
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response !== 0) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    logError('openExternal', err);
    return false;
  }
}
