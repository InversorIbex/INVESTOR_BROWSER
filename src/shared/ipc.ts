/**
 * The complete IPC contract between the trusted UI (renderer) and the main process.
 * Every request is validated in main with these schemas before it is acted upon.
 * Web pages loaded in tabs have NO preload and cannot reach any of these channels.
 */
import { z } from 'zod';
import { COMMAND_IDS, type CommandId } from './commands';
import { SettingsPatchSchema, NOTE_KINDS, SECTOR_KINDS } from './types';
import { METRIC_IDS, SCALES, type Scale } from './finance';
import type {
  InsiderRow,
  InsiderSyncResult,
  FilingRow,
  FinancialFact,
  SecStatus,
  SecSyncResult,
  Company,
  Note,
  SaveDraft,
  Source,
  AppInfo,
  Bookmark,
  BrowserSnapshot,
  DownloadItemState,
  HistoryEntry,
  PopupNotice,
  Settings,
  SitePermission,
  Suggestion,
  EsefFilingRow,
  EsefSyncResult,
  QuotesStatus,
  FxRatesInfo,
} from './types';

const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().max(max);
const UrlText = Text(8192);
const PosInt = z.number().int().positive().max(2_147_483_647);
const Finite = z.number().finite();

export const CompanyInputSchema = z
  .object({
    id: PosInt.optional(),
    name: z.string().trim().min(1).max(200),
    ticker: z.string().max(12).nullable().optional(),
    exchange: Text(40).optional(),
    country: Text(60).optional(),
    sector: Text(80).optional(),
    sectorKind: z.enum(SECTOR_KINDS).optional(),
    irUrl: UrlText.nullable().optional(),
    cik: z.string().regex(/^\d{1,10}$/).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    followed: z.boolean().optional(),
    thesis: Text(50_000).optional(),
  })
  .strict();
export type CompanyInput = z.infer<typeof CompanyInputSchema>;

export const NoteInputSchema = z
  .object({
    companyId: PosInt,
    kind: z.enum(NOTE_KINDS),
    body: Text(20_000).default(''),
    quote: Text(20_000).nullable().optional(),
    sourceUrl: UrlText.nullable().optional(),
    sourceTitle: Text(1000).nullable().optional(),
    metric: z.enum(METRIC_IDS).nullable().optional(),
    period: Text(20).nullable().optional(),
    value: Finite.nullable().optional(),
    scale: z.enum(Object.keys(SCALES) as [Scale, ...Scale[]]).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    origin: z.enum(['published', 'user', 'estimate']).nullable().optional(),
  })
  .strict();
export type NoteInput = z.input<typeof NoteInputSchema>;

export const RequestSchemas = {
  'state:get': z.undefined(),
  'tabs:create': z.object({ url: UrlText.optional(), active: z.boolean().optional(), companyId: z.number().int().positive().optional() }).strict(),
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
  'data:backup': z.undefined(),
  // ---- research ----
  'companies:list': z.undefined(),
  'companies:save': CompanyInputSchema,
  'companies:remove': z.object({ id: PosInt }).strict(),
  'companies:setPrice': z
    .object({
      id: PosInt,
      price: Finite.positive().nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      source: Text(300).nullable().optional(),
    })
    .strict(),
  'tabs:setCompany': z.object({ id: Id, companyId: PosInt.nullable() }).strict(),
  'workspace:open': z.object({ companyId: PosInt }).strict(),
  'workspace:close': z.object({ companyId: PosInt }).strict(),
  'notes:list': z.object({ companyId: PosInt.optional(), query: Text(500).optional() }).strict(),
  'notes:add': NoteInputSchema,
  'notes:update': z
    .object({ id: PosInt, body: Text(20_000).optional(), resolved: z.boolean().optional(), kind: z.enum(NOTE_KINDS).optional() })
    .strict(),
  'notes:remove': z.object({ id: PosInt }).strict(),
  'sources:list': z.object({ companyId: PosInt }).strict(),
  'research:captureSelection': z.undefined(),
  'research:export': z.object({ companyId: PosInt.optional(), format: z.enum(['markdown', 'json']) }).strict(),
  'research:import': z.undefined(),
  // ---- official data: SEC EDGAR ----
  'sec:status': z.undefined(),
  'sec:searchTicker': z.object({ query: z.string().trim().min(1).max(60) }).strict(),
  'sec:link': z.object({ companyId: PosInt, cik: z.number().int().positive().max(9_999_999_999) }).strict(),
  'sec:sync': z.object({ companyId: PosInt, force: z.boolean().optional() }).strict(),
  'sec:facts': z.object({ companyId: PosInt }).strict(),
  'sec:filings': z.object({ companyId: PosInt }).strict(),
  'sec:clearCache': z.undefined(),
  'sec:insidersSync': z.object({ companyId: PosInt, limit: z.number().int().min(1).max(100).optional() }).strict(),
  'sec:insiders': z.object({ companyId: PosInt }).strict(),
  'quotes:status': z.undefined(),
  'quotes:setKey': z.object({ provider: z.enum(['finnhub', 'eodhd']), key: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._\-]+$/) }).strict(),
  'quotes:deleteKey': z.object({ provider: z.enum(['finnhub', 'eodhd']) }).strict(),
  'quotes:refresh': z.object({ companyIds: z.array(PosInt).max(500).optional(), force: z.boolean().optional() }).strict(),
  'quotes:setSymbol': z.object({ companyId: PosInt, symbol: z.string().trim().max(20).regex(/^[A-Za-z0-9][A-Za-z0-9.\-]*$/).nullable() }).strict(),
  'fx:rates': z.object({ force: z.boolean().optional() }).strict().optional(),
  'esef:search': z.object({ query: z.string().trim().min(2).max(80) }).strict(),
  'esef:link': z.object({ companyId: PosInt, lei: z.string().regex(/^[A-Z0-9]{18}[0-9]{2}$/), name: z.string().max(200).optional() }).strict(),
  'esef:unlink': z.object({ companyId: PosInt }).strict(),
  'esef:sync': z.object({ companyId: PosInt, force: z.boolean().optional() }).strict(),
  'esef:filings': z.object({ companyId: PosInt }).strict(),
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
  'data:backup': void;
  'companies:list': Company[];
  'companies:save': Company;
  'companies:remove': void;
  'companies:setPrice': void;
  'tabs:setCompany': void;
  'workspace:open': void;
  'workspace:close': void;
  'notes:list': Note[];
  'notes:add': Note;
  'notes:update': void;
  'notes:remove': void;
  'sources:list': Source[];
  'research:captureSelection': void;
  'research:export': void;
  'research:import': void;
  'sec:status': SecStatus;
  'sec:searchTicker': { cik: number; ticker: string; title: string }[];
  'sec:link': Company;
  'sec:sync': SecSyncResult;
  'sec:facts': FinancialFact[];
  'sec:filings': FilingRow[];
  'sec:clearCache': void;
  'sec:insidersSync': InsiderSyncResult;
  'sec:insiders': InsiderRow[];
  'quotes:status': QuotesStatus;
  'quotes:setKey': { message: string; status: QuotesStatus };
  'quotes:deleteKey': QuotesStatus;
  'quotes:refresh': { updated: number; failed: { companyId: number; error: string }[]; eodhdLeft: number };
  'quotes:setSymbol': void;
  'fx:rates': FxRatesInfo | null;
  'esef:search': { lei: string; name: string }[];
  'esef:link': Company;
  'esef:unlink': void;
  'esef:sync': EsefSyncResult;
  'esef:filings': EsefFilingRow[];
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
  companies: Company[];
  notesChanged: { companyId: number | null };
  saveDraft: SaveDraft;
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
  'companies',
  'notesChanged',
  'saveDraft',
];

/** Shape of `window.ib` exposed by the preload to the trusted UI only. */
export interface IbApi {
  invoke<C extends RequestChannel>(channel: C, arg?: RequestArg<C>): Promise<ResponseMap[C]>;
  on<E extends EventChannel>(channel: E, listener: (payload: EventMap[E]) => void): () => void;
  platform: string;
}
