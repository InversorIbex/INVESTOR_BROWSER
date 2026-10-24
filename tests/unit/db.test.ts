import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/db';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { uniquePath, sanitizeFilename } from '../../src/main/downloads';

let dir: string;
let store: Store;
const dbPath = () => path.join(dir, 'test.db');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ib-db-'));
  store = new Store(dbPath());
});
afterEach(() => {
  try {
    store.close();
  } catch {
    /* closed in test */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('Store', () => {
  it('migrates to the latest schema version', () => {
    expect(store.schemaVersion).toBe(3);
  });

  it('returns defaults and persists settings across reopen', () => {
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    store.updateSettings({ theme: 'light', tabLayout: 'horizontal' });
    store.close();
    store = new Store(dbPath());
    expect(store.getSettings()).toMatchObject({ theme: 'light', tabLayout: 'horizontal', restoreSession: true });
  });

  it('a partial update never resets other settings (regression)', () => {
    store.updateSettings({ theme: 'light' });
    store.updateSettings({ tabLayout: 'horizontal' });
    store.updateSettings({ toolbar: { ...DEFAULT_SETTINGS.toolbar, home: true } });
    expect(store.getSettings()).toMatchObject({ theme: 'light', tabLayout: 'horizontal', toolbar: { home: true, palette: true } });
  });

  it('rejects unknown setting keys', () => {
    expect(() => store.updateSettings({ evil: true } as never)).toThrow();
  });

  it('keeps valid fields when some stored fields are corrupt', () => {
    store.setJson('settings', { theme: 'light', fontSize: 'big' });
    expect(store.getSettings()).toMatchObject({ theme: 'light', fontSize: DEFAULT_SETTINGS.fontSize });
  });

  it('rejects invalid settings values', () => {
    expect(() => store.updateSettings({ fontSize: 400 })).toThrow();
    expect(store.getSettings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('survives corrupted settings JSON', () => {
    store.setJson('settings', { theme: 'neon', fontSize: 'big' });
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('bookmarks: add is idempotent per url+folder, update, remove', () => {
    const a = store.addBookmark('https://sec.gov/', 'SEC');
    const b = store.addBookmark('https://sec.gov/', 'SEC EDGAR');
    expect(b.id).toBe(a.id);
    expect(store.listBookmarks()).toHaveLength(1);
    expect(store.listBookmarks()[0]!.title).toBe('SEC EDGAR');
    store.updateBookmark(a.id, { folder: 'Reguladores' });
    expect(store.findBookmarkByUrl('https://sec.gov/')!.folder).toBe('Reguladores');
    store.removeBookmark(a.id);
    expect(store.listBookmarks()).toHaveLength(0);
  });

  it('history: records, merges quick repeats, searches safely and clears by range', () => {
    const now = Date.now();
    store.addVisit('https://a.com/', 'A', now - 3 * 3600e3);
    store.addVisit('https://b.com/100%_done', 'B', now - 1000);
    store.addVisit('https://b.com/100%_done', 'B again', now); // merged
    expect(store.listHistory()).toHaveLength(2);
    expect(store.listHistory('100%_')).toHaveLength(1); // LIKE wildcards escaped
    expect(store.listHistory('%')).toHaveLength(1);
    store.updateLatestTitle('https://a.com/', 'A title');
    expect(store.listHistory('a.com')[0]!.title).toBe('A title');
    expect(store.topSites('')[0]).toBeDefined();
    expect(store.clearHistory(now - 3600e3)).toBe(1);
    expect(store.listHistory()).toHaveLength(1);
    expect(store.clearHistory(0)).toBe(1);
  });

  it('session: saves, rotates to previous and reloads', () => {
    store.saveSession({ tabs: [{ url: 'https://a.com/', title: 'A', pinned: true }], activeIndex: 0, savedAt: 1 });
    store.close();
    store = new Store(dbPath());
    expect(store.rotateSession()!.tabs[0]!.pinned).toBe(true);
    store.saveSession({ tabs: [], activeIndex: 0, savedAt: 2 });
    expect(store.loadPreviousSession()!.tabs).toHaveLength(1);
  });

  it('downloads: in-flight downloads become interrupted after restart', () => {
    store.upsertDownload({
      id: 'd1',
      url: 'https://x.com/10k.pdf',
      filename: '10k.pdf',
      savePath: '/tmp/10k.pdf',
      totalBytes: 100,
      receivedBytes: 10,
      status: 'progressing',
      startedAt: 1,
      endedAt: null,
    });
    store.markStaleDownloadsInterrupted();
    expect(store.listDownloads()[0]!.status).toBe('interrupted');
    store.clearFinishedDownloads();
    expect(store.listDownloads()).toHaveLength(0);
  });

  it('site permissions', () => {
    store.setPermission('https://maps.example', 'geolocation', 'deny');
    expect(store.getPermission('https://maps.example', 'geolocation')).toBe('deny');
    store.setPermission('https://maps.example', 'geolocation', 'allow');
    expect(store.listPermissions()).toHaveLength(1);
    store.removePermission('https://maps.example', 'geolocation');
    expect(store.getPermission('https://maps.example', 'geolocation')).toBeNull();
  });
});

describe('download file names', () => {
  it('never overwrites and strips path tricks', () => {
    const existing = new Set(['/d/report.pdf', '/d/report (1).pdf']);
    expect(uniquePath('/d', 'report.pdf', (p) => existing.has(p))).toBe(path.join('/d', 'report (2).pdf'));
    expect(sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFilename('a:b*c?.pdf')).toBe('a_b_c_.pdf');
    expect(uniquePath('/d', '', () => false)).toBe(path.join('/d', 'descarga'));
  });
});
