/**
 * Preload for the trusted browser UI ONLY. Web pages in tabs get no preload at all.
 * Exposes a single, narrow `window.ib` object; no Node or Electron objects leak.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { EventChannel, IbApi, RequestChannel } from '../shared/ipc';

// Duplicated (not imported) so the preload bundle stays tiny and self-contained.
const EVENTS: readonly EventChannel[] = ['state', 'settings', 'bookmarks', 'downloads', 'command', 'popup', 'resolvedTheme', 'toast', 'companies', 'notesChanged', 'saveDraft', 'portfolio'];

const api: IbApi = {
  invoke: ((channel: RequestChannel, arg?: unknown) => ipcRenderer.invoke(`ib:${channel}`, arg)) as IbApi['invoke'],
  on: ((channel: EventChannel, listener: (payload: unknown) => void) => {
    if (!EVENTS.includes(channel)) throw new Error(`Unknown event ${channel}`);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(`ib:${channel}`, wrapped);
    return () => ipcRenderer.removeListener(`ib:${channel}`, wrapped);
  }) as IbApi['on'],
  platform: process.platform,
};

contextBridge.exposeInMainWorld('ib', api);
