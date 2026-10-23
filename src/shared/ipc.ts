/**
 * The complete IPC contract between the trusted UI (renderer) and the main process.
 * Every request is validated in main with these schemas before it is acted upon.
 * Web pages loaded in tabs have NO preload and cannot reach any of these channels.
 */
import { z } from 'zod';
import { COMMAND_IDS, type CommandId } from './commands';
import { SettingsPatchSchema } from './types';
import type {
  AppInfo,
  Bookmark,
  BrowserSnapshot,
  DownloadItemState,
  HistoryEntry,
  PopupNotice,
  Settings,
  SitePermission,
  Suggestion,
} from './types';

const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().max(max);
const UrlText = Text(8192);

export const RequestSchemas = {
  'state:get': z.undefined(),
  'tabs:create': z.object({ url: UrlText.optional(), active: z.boolean().optional() }).strict(),
  'tabs:close': z.object({ id: Id }).strict(),
  'tabs:activate': z.object({ id: Id }).strict(),
  'tabs:navigate': z.object({ id: Id.optional(), input: UrlText }).strict(),
  'tabs:move': z.object({ id: Id, index: z.number().int().min(0).max(10_000) }).strict(),
  'tabs:pin': z.object({ id: Id, pinned: z.boolean() }).strict(),
  'tabs:contextMenu': z.object({ id: Id }).strict(),
  'tabs:find': z.object({ query: Text(1000), forward: z.boolean().optional(), step: z.boolean().optional() }).strict(),
  'tabs:stopFind': z.undefined(),
  'command:run': z.object({ id: z.enum(COMMAND_IDS as [CommandId, ...CommandId[]]) }).strict(),
  'ui:contentBounds': z
    .object({
      x: z.number().finite().min(0).max(100_000),
      y: z.number().finite().min(0).max(100_000),
      width: z.number().finite().min(0).max(100_000),
      height: z.number().finite().min(0).max(100_000),
    })
    .strict(),
  'ui:overlay': z.object({ open: z.boolean(), snapshot: z.boolean().optional() }).strict(),
  'settings:get': z.undefined(),
  'settings:update': SettingsPatchSchema,
  'bookmarks:list': z.undefined(),
  'bookmarks:add': z.object({ url: UrlText, title: Text(1000), folder: Text(300).optional() }).strict(),
  'bookmarks:update': z
    .object({ id: z.number().int().positive(), title: Text(1000).optional(), folder: Text(300).optional() })
    .strict(),
  'bookmarks:remove': z.object({ id: z.number().int().positive() }).strict(),
  'history:list': z.object({ query: Text(500).optional(), limit: z.number().int().min(1).max(2000).optional() }).strict(),
  'history:remove': z.object({ id: z.number().int().positive() }).strict(),
  'history:clear': z.object({ range: z.enum(['hour', 'day', 'week', 'all']) }).strict(),
  suggest: z.object({ query: Text(2000) }).strict(),
  'downloads:list': z.undefined(),
  'downloads:action': z
    .object({ id: Id, action: z.enum(['open', 'show', 'cancel', 'pause', 'resume', 'remove']) })
    .strict(),
  'downloads:clear': z.undefined(),
  'permissions:list': z.undefined(),
  'permissions:remove': z.object({ origin: Text(2048), permission: Text(64) }).strict(),
  'popups:open': z.object({ id: Id }).strict(),
  'popups:dismiss': z.object({ id: Id }).strict(),
  'app:info': z.undefined(),
  'data:clear': z.object({ what: z.enum(['cache', 'siteData']) }).strict(),
} as const;

export type RequestChannel = keyof typeof RequestSchemas;
export type RequestArg<C extends RequestChannel> = z.input<(typeof RequestSchemas)[C]>;

export interface ResponseMap {
  'state:get': BrowserSnapshot;
  'tabs:create': string;
  'tabs:close': void;
  'tabs:activate': void;
  'tabs:navigate': void;
  'tabs:move': void;
  'tabs:pin': void;
  'tabs:contextMenu': void;
  'tabs:find': void;
  'tabs:stopFind': void;
  'command:run': void;
  'ui:contentBounds': void;
  'ui:overlay': string | null;
  'settings:get': Settings;
  'settings:update': Settings;
  'bookmarks:list': Bookmark[];
  'bookmarks:add': Bookmark;
  'bookmarks:update': void;
  'bookmarks:remove': void;
  'history:list': HistoryEntry[];
  'history:remove': void;
  'history:clear': number;
  suggest: Suggestion[];
  'downloads:list': DownloadItemState[];
  'downloads:action': void;
  'downloads:clear': void;
  'permissions:list': SitePermission[];
  'permissions:remove': void;
  'popups:open': void;
  'popups:dismiss': void;
  'app:info': AppInfo;
  'data:clear': void;
}

export interface EventMap {
  state: BrowserSnapshot;
  settings: Settings;
  bookmarks: Bookmark[];
  downloads: DownloadItemState[];
  command: CommandId;
  popup: PopupNotice[];
  resolvedTheme: 'dark' | 'light';
  toast: { message: string; kind: 'info' | 'error' };
}
export type EventChannel = keyof EventMap;
export const EVENT_CHANNELS: readonly EventChannel[] = [
  'state',
  'settings',
  'bookmarks',
  'downloads',
  'command',
  'popup',
  'resolvedTheme',
  'toast',
];

/** Shape of `window.ib` exposed by the preload to the trusted UI only. */
export interface IbApi {
  invoke<C extends RequestChannel>(channel: C, arg?: RequestArg<C>): Promise<ResponseMap[C]>;
  on<E extends EventChannel>(channel: E, listener: (payload: EventMap[E]) => void): () => void;
  platform: string;
}
