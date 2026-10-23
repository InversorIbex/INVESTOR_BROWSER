import { app, dialog, shell, type BrowserWindow, type DownloadItem, type Session } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Store } from './db';
import type { DownloadItemState } from '../shared/types';
import { logError } from './log';

/** Avoid overwriting: "report.pdf" → "report (1).pdf". */
export function uniquePath(dir: string, filename: string, exists: (p: string) => boolean = existsSync): string {
  const safe = sanitizeFilename(filename) || 'descarga';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; exists(candidate) && i < 1000; i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
}

export class DownloadManager {
  private live = new Map<string, { item: DownloadItem; state: DownloadItemState }>();
  private counter = 0;
  private lastEmit = 0;

  constructor(
    private readonly store: Store,
    private readonly opts: {
      win(): BrowserWindow | null;
      askLocation(): boolean;
      changed(list: DownloadItemState[]): void;
      downloadsDir?: string;
    },
  ) {
    store.markStaleDownloadsInterrupted();
  }

  attach(ses: Session): void {
    ses.on('will-download', (_event, item) => this.track(item));
  }

  list(): DownloadItemState[] {
    const persisted = this.store.listDownloads();
    const liveById = new Map([...this.live.values()].map((l) => [l.state.id, l.state]));
    return persisted.map((p) => liveById.get(p.id) ?? p);
  }

  private track(item: DownloadItem): void {
    const id = `d${Date.now().toString(36)}${(++this.counter).toString(36)}`;
    const dir = this.opts.downloadsDir ?? app.getPath('downloads');
    const target = uniquePath(dir, item.getFilename());
    if (this.opts.askLocation()) {
      // Native "Save as" dialog; the path the user picks is used.
      item.setSaveDialogOptions({ defaultPath: target, title: 'Guardar descarga' });
    } else {
      item.setSavePath(target);
    }
    const state: DownloadItemState = {
      id,
      url: item.getURL(),
      filename: path.basename(item.getSavePath() || target),
      savePath: item.getSavePath() || target,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      status: 'progressing',
      startedAt: Date.now(),
      endedAt: null,
    };
    this.live.set(id, { item, state });
    this.persist(state);
    this.emit(true);

    item.on('updated', (_e, s) => {
      state.receivedBytes = item.getReceivedBytes();
      state.totalBytes = item.getTotalBytes();
      if (item.getSavePath()) {
        state.savePath = item.getSavePath();
        state.filename = path.basename(state.savePath);
      }
      state.status = s === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      this.emit(false);
    });
    item.once('done', (_e, s) => {
      state.receivedBytes = item.getReceivedBytes();
      state.status = s === 'completed' ? 'completed' : s === 'cancelled' ? 'cancelled' : 'interrupted';
      state.endedAt = Date.now();
      if (item.getSavePath()) {
        state.savePath = item.getSavePath();
        state.filename = path.basename(state.savePath);
      }
      this.persist(state);
      this.live.delete(id);
      this.emit(true);
      if (s === 'completed') this.opts.win()?.flashFrame(false);
    });
  }

  async action(id: string, action: 'open' | 'show' | 'cancel' | 'pause' | 'resume' | 'remove'): Promise<void> {
    const live = this.live.get(id)?.item;
    const state = this.list().find((d) => d.id === id);
    if (!state) return;
    switch (action) {
      case 'pause':
        live?.pause();
        break;
      case 'resume':
        if (live?.canResume()) live.resume();
        break;
      case 'cancel':
        live?.cancel();
        break;
      case 'show':
        if (existsSync(state.savePath)) shell.showItemInFolder(state.savePath);
        break;
      case 'open': {
        if (state.status !== 'completed' || !existsSync(state.savePath)) return;
        if (isExecutable(state.filename)) {
          const win = this.opts.win();
          const opts = {
            type: 'warning' as const,
            buttons: ['Abrir de todos modos', 'Cancelar'],
            defaultId: 1,
            cancelId: 1,
            message: `«${state.filename}» es un programa ejecutable.`,
            detail: 'Ábrelo solo si confías plenamente en su origen.',
          };
          const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
          if (response !== 0) return;
        }
        const err = await shell.openPath(state.savePath);
        if (err) logError('download.open', err);
        break;
      }
      case 'remove':
        if (live) live.cancel();
        this.store.removeDownload(id);
        break;
    }
    this.emit(true);
  }

  clearFinished(): void {
    this.store.clearFinishedDownloads();
    this.emit(true);
  }

  private persist(s: DownloadItemState): void {
    try {
      this.store.upsertDownload(s);
    } catch (err) {
      logError('download.persist', err);
    }
  }

  private emit(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 250) return; // throttle progress updates
    this.lastEmit = now;
    for (const { state } of this.live.values()) this.persist(state);
    this.opts.changed(this.list());
  }
}

function isExecutable(name: string): boolean {
  return /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|appimage|sh|dmg|pkg|app)$/i.test(name);
}
