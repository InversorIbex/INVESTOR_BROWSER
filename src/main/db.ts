/**
 * Local persistence on top of Node's built-in SQLite (`node:sqlite`).
 * Using the built-in driver means there is no native module to compile for
 * each Electron/OS combination. This file has no Electron imports so it can be
 * unit-tested with plain Node.
 */
import { DatabaseSync } from 'node:sqlite';
import {
  SettingsPatchSchema,
  sanitizeSettings,
  type Bookmark,
  type DownloadItemState,
  type HistoryEntry,
  type PermissionDecision,
  type Settings,
  type SettingsPatch,
  type SitePermission,
} from '../shared/types';

export interface SessionTab {
  url: string;
  title: string;
  pinned: boolean;
  companyId?: number | null;
}
export interface SessionSnapshot {
  tabs: SessionTab[];
  activeIndex: number;
  savedAt: number;
}

/** Ordered list of migrations. Never edit a released migration — append a new one. */
const MIGRATIONS: string[] = [
  /* v1 — Phase 1: browser core */ `
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE bookmarks (
    id         INTEGER PRIMARY KEY,
    url        TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    folder     TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX bookmarks_url_folder ON bookmarks(url, folder);
  CREATE TABLE history (
    id         INTEGER PRIMARY KEY,
    url        TEXT    NOT NULL,
    title      TEXT    NOT NULL DEFAULT '',
    visited_at INTEGER NOT NULL
  );
  CREATE INDEX history_visited ON history(visited_at DESC);
  CREATE INDEX history_url ON history(url);
  CREATE TABLE downloads (
    id             TEXT    PRIMARY KEY,
    url            TEXT    NOT NULL,
    filename       TEXT    NOT NULL,
    save_path      TEXT    NOT NULL,
    total_bytes    INTEGER NOT NULL,
    received_bytes INTEGER NOT NULL,
    status         TEXT    NOT NULL,
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER
  );
  CREATE TABLE site_permissions (
    origin     TEXT    NOT NULL,
    permission TEXT    NOT NULL,
    decision   TEXT    NOT NULL CHECK (decision IN ('allow','deny')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (origin, permission)
  );
  `,
  /* v2 — Phase 2: research workspaces */ `
  CREATE TABLE companies (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    ticker           TEXT,
    exchange         TEXT    NOT NULL DEFAULT '',
    country          TEXT    NOT NULL DEFAULT '',
    sector           TEXT    NOT NULL DEFAULT '',
    sector_kind      TEXT    NOT NULL DEFAULT 'general' CHECK (sector_kind IN ('general','bank','insurer','reit')),
    ir_url           TEXT,
    cik              TEXT,
    color            TEXT    NOT NULL DEFAULT '#5b8cff',
    followed         INTEGER NOT NULL DEFAULT 1,
    thesis           TEXT    NOT NULL DEFAULT '',
    price            REAL,
    price_currency   TEXT,
    price_as_of      TEXT,
    price_source     TEXT,
    saved_tabs       TEXT    NOT NULL DEFAULT '[]',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  -- Same ticker on different exchanges are different companies (homonyms / dual listings).
  CREATE UNIQUE INDEX companies_ticker_exchange ON companies(ticker, exchange) WHERE ticker IS NOT NULL;
  CREATE TABLE sources (
    id          INTEGER PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    url         TEXT    NOT NULL,
    title       TEXT    NOT NULL DEFAULT '',
    accessed_at INTEGER NOT NULL,
    UNIQUE (company_id, url)
  );
  CREATE TABLE notes (
    id          INTEGER PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_id   INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    kind        TEXT    NOT NULL CHECK (kind IN ('snippet','figure','note','conclusion','question')),
    body        TEXT    NOT NULL DEFAULT '',
    quote       TEXT,
    metric      TEXT,
    period      TEXT,
    value       REAL,
    scale       TEXT,
    currency    TEXT,
    origin      TEXT    CHECK (origin IS NULL OR origin IN ('published','user','estimate')),
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    -- A figure must be complete: no half-specified numbers.
    CHECK (kind <> 'figure' OR (metric IS NOT NULL AND period IS NOT NULL AND value IS NOT NULL AND scale IS NOT NULL))
  );
  CREATE INDEX notes_company ON notes(company_id, created_at DESC);
  `,
  /* v3 — Phase 3: official data (SEC EDGAR) */ `
  ALTER TABLE companies ADD COLUMN sec_name TEXT;
  ALTER TABLE companies ADD COLUMN fiscal_year_end TEXT;
  ALTER TABLE companies ADD COLUMN sec_synced_at INTEGER;
  ALTER TABLE companies ADD COLUMN sec_taxonomy TEXT;
  CREATE TABLE http_cache (
    provider   TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (provider, key)
  );
  CREATE TABLE financial_facts (
    id             INTEGER PRIMARY KEY,
    company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider       TEXT    NOT NULL,
    metric         TEXT    NOT NULL,
    period         TEXT    NOT NULL,
    period_start   TEXT,
    period_end     TEXT    NOT NULL,
    value          REAL    NOT NULL,
    unit           TEXT    NOT NULL,
    currency       TEXT,
    concept        TEXT    NOT NULL,
    accn           TEXT    NOT NULL,
    form           TEXT    NOT NULL,
    filed          TEXT    NOT NULL,
    derived        INTEGER NOT NULL DEFAULT 0,
    restated_value REAL,
    restated_accn  TEXT,
    restated_filed TEXT,
    source_url     TEXT    NOT NULL,
    fetched_at     INTEGER NOT NULL,
    UNIQUE (company_id, provider, metric, period)
  );
  CREATE TABLE filings (
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    accn        TEXT    NOT NULL,
    form        TEXT    NOT NULL,
    filing_date TEXT    NOT NULL,
    report_date TEXT,
    description TEXT,
    url         TEXT    NOT NULL,
    PRIMARY KEY (company_id, accn)
  );
  `,
];

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  get schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  }

  private migrate(): void {
    const current = this.schemaVersion;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ---------- key/value ----------
  getJson<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---------- settings ----------
  getSettings(): Settings {
    // Corrupt or outdated values never crash the app: each bad field falls back to its default.
    return sanitizeSettings(this.getJson<unknown>('settings'));
  }

  updateSettings(patch: SettingsPatch): Settings {
    const valid = SettingsPatchSchema.parse(patch);
    const merged = sanitizeSettings({ ...this.getSettings(), ...valid });
    this.setJson('settings', merged);
    return merged;
  }

  // ---------- session ----------
  saveSession(snapshot: SessionSnapshot): void {
    this.setJson('session.current', snapshot);
  }
  loadSession(): SessionSnapshot | null {
    return this.getJson<SessionSnapshot>('session.current');
  }
  /** Called once at startup: keeps the last session available for "Restore previous session". */
  rotateSession(): SessionSnapshot | null {
    const current = this.loadSession();
    if (current && current.tabs.length) this.setJson('session.previous', current);
    return current;
  }
  loadPreviousSession(): SessionSnapshot | null {
    return this.getJson<SessionSnapshot>('session.previous');
  }

  // ---------- bookmarks ----------
  listBookmarks(): Bookmark[] {
    return (
      this.db
        .prepare('SELECT id, url, title, folder, created_at AS createdAt FROM bookmarks ORDER BY folder, created_at DESC')
        .all() as unknown as Bookmark[]
    ).map((b) => ({ ...b }));
  }

  addBookmark(url: string, title: string, folder = '', createdAt = Date.now()): Bookmark {
    this.db
      .prepare(
        `INSERT INTO bookmarks(url, title, folder, created_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(url, folder) DO UPDATE SET title = excluded.title`,
      )
      .run(url, title.slice(0, 1000), folder.slice(0, 300), createdAt);
    const row = this.db
      .prepare('SELECT id, url, title, folder, created_at AS createdAt FROM bookmarks WHERE url = ? AND folder = ?')
      .get(url, folder) as unknown as Bookmark;
    return { ...row };
  }

  updateBookmark(id: number, patch: { title?: string; folder?: string }): void {
    if (patch.title !== undefined) this.db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(patch.title, id);
    if (patch.folder !== undefined)
      this.db.prepare('UPDATE OR IGNORE bookmarks SET folder = ? WHERE id = ?').run(patch.folder, id);
  }

  removeBookmark(id: number): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  removeBookmarksByUrl(url: string): number {
    return Number(this.db.prepare('DELETE FROM bookmarks WHERE url = ?').run(url).changes);
  }

  findBookmarkByUrl(url: string): Bookmark | null {
    const row = this.db
      .prepare('SELECT id, url, title, folder, created_at AS createdAt FROM bookmarks WHERE url = ? LIMIT 1')
      .get(url) as unknown as Bookmark | undefined;
    return row ? { ...row } : null;
  }

  // ---------- history ----------
  /** Records a visit. Repeated visits to the same URL within 30 s are merged. */
  addVisit(url: string, title: string, at = Date.now()): void {
    const last = this.db
      .prepare('SELECT id, url, visited_at AS visitedAt FROM history ORDER BY visited_at DESC, id DESC LIMIT 1')
      .get() as { id: number; url: string; visitedAt: number } | undefined;
    if (last && last.url === url && at - last.visitedAt < 30_000) {
      if (title) this.db.prepare('UPDATE history SET title = ? WHERE id = ?').run(title, last.id);
      return;
    }
    this.db.prepare('INSERT INTO history(url, title, visited_at) VALUES(?, ?, ?)').run(url, title.slice(0, 1000), at);
  }

  updateLatestTitle(url: string, title: string): void {
    this.db
      .prepare(
        'UPDATE history SET title = ? WHERE id = (SELECT id FROM history WHERE url = ? ORDER BY visited_at DESC LIMIT 1)',
      )
      .run(title.slice(0, 1000), url);
  }

  listHistory(query = '', limit = 500): HistoryEntry[] {
    const q = query.trim();
    const rows = q
      ? this.db
          .prepare(
            `SELECT id, url, title, visited_at AS visitedAt FROM history
             WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
             ORDER BY visited_at DESC LIMIT ?`,
          )
          .all(likePattern(q), likePattern(q), limit)
      : this.db
          .prepare('SELECT id, url, title, visited_at AS visitedAt FROM history ORDER BY visited_at DESC LIMIT ?')
          .all(limit);
    return (rows as unknown as HistoryEntry[]).map((r) => ({ ...r }));
  }

  /** Distinct URLs ranked by frequency + recency, for address-bar suggestions. */
  topSites(query: string, limit = 8): { url: string; title: string; visits: number; lastVisit: number }[] {
    const q = query.trim();
    const rows = this.db
      .prepare(
        `SELECT url, MAX(title) AS title, COUNT(*) AS visits, MAX(visited_at) AS lastVisit
         FROM history
         WHERE (? = '' OR url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
         GROUP BY url
         ORDER BY visits DESC, lastVisit DESC
         LIMIT ?`,
      )
      .all(q, likePattern(q), likePattern(q), limit);
    return (rows as unknown as { url: string; title: string; visits: number; lastVisit: number }[]).map((r) => ({
      ...r,
    }));
  }

  removeHistoryEntry(id: number): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id);
  }

  clearHistory(since: number): number {
    return Number(this.db.prepare('DELETE FROM history WHERE visited_at >= ?').run(since).changes);
  }

  // ---------- downloads ----------
  upsertDownload(d: DownloadItemState): void {
    this.db
      .prepare(
        `INSERT INTO downloads(id, url, filename, save_path, total_bytes, received_bytes, status, started_at, ended_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, save_path=excluded.save_path,
           total_bytes=excluded.total_bytes, received_bytes=excluded.received_bytes,
           status=excluded.status, ended_at=excluded.ended_at`,
      )
      .run(d.id, d.url, d.filename, d.savePath, d.totalBytes, d.receivedBytes, d.status, d.startedAt, d.endedAt);
  }

  listDownloads(): DownloadItemState[] {
    return (
      this.db
        .prepare(
          `SELECT id, url, filename, save_path AS savePath, total_bytes AS totalBytes, received_bytes AS receivedBytes,
                  status, started_at AS startedAt, ended_at AS endedAt
           FROM downloads ORDER BY started_at DESC LIMIT 500`,
        )
        .all() as unknown as DownloadItemState[]
    ).map((d) => ({ ...d }));
  }

  removeDownload(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  }

  clearFinishedDownloads(): void {
    this.db.prepare("DELETE FROM downloads WHERE status <> 'progressing' AND status <> 'paused'").run();
  }

  /** Downloads that were in flight when the app quit can never resume: mark them interrupted. */
  markStaleDownloadsInterrupted(): void {
    this.db
      .prepare("UPDATE downloads SET status = 'interrupted' WHERE status IN ('progressing','paused')")
      .run();
  }

  // ---------- provider HTTP cache ----------
  cacheGet(provider: string, key: string): { body: string; fetchedAt: number } | null {
    const row = this.db.prepare('SELECT body, fetched_at AS fetchedAt FROM http_cache WHERE provider = ? AND key = ?').get(provider, key) as
      | { body: string; fetchedAt: number }
      | undefined;
    return row ? { ...row } : null;
  }

  cacheSet(provider: string, key: string, body: string, fetchedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO http_cache(provider, key, body, fetched_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(provider, key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      )
      .run(provider, key, body, fetchedAt);
  }

  cacheStats(provider: string): { entries: number; bytes: number } {
    const r = this.db.prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(body)), 0) AS bytes FROM http_cache WHERE provider = ?').get(provider) as {
      entries: number;
      bytes: number;
    };
    return { entries: Number(r.entries), bytes: Number(r.bytes) };
  }

  cacheClear(provider: string): void {
    this.db.prepare('DELETE FROM http_cache WHERE provider = ?').run(provider);
  }

  // ---------- site permissions ----------
  getPermission(origin: string, permission: string): PermissionDecision | null {
    const row = this.db
      .prepare('SELECT decision FROM site_permissions WHERE origin = ? AND permission = ?')
      .get(origin, permission) as { decision: PermissionDecision } | undefined;
    return row?.decision ?? null;
  }

  setPermission(origin: string, permission: string, decision: PermissionDecision): void {
    this.db
      .prepare(
        `INSERT INTO site_permissions(origin, permission, decision, updated_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(origin, permission) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at`,
      )
      .run(origin, permission, decision, Date.now());
  }

  listPermissions(): SitePermission[] {
    return (
      this.db
        .prepare(
          'SELECT origin, permission, decision, updated_at AS updatedAt FROM site_permissions ORDER BY origin, permission',
        )
        .all() as unknown as SitePermission[]
    ).map((p) => ({ ...p }));
  }

  removePermission(origin: string, permission: string): void {
    this.db.prepare('DELETE FROM site_permissions WHERE origin = ? AND permission = ?').run(origin, permission);
  }
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}
