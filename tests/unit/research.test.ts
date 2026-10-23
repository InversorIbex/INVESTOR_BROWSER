import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/db';
import { ResearchRepo, ValidationError } from '../../src/main/research';

let dir: string;
let store: Store;
let repo: ResearchRepo;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ib-research-'));
  store = new Store(path.join(dir, 'r.db'));
  repo = new ResearchRepo(store.db);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('companies', () => {
  it('migrates to v2', () => expect(store.schemaVersion).toBe(2));

  it('creates, normalises and distinguishes homonyms by exchange', () => {
    const a = repo.saveCompany({ name: 'Novo Nordisk', ticker: 'nvo', exchange: 'nyse' });
    expect(a).toMatchObject({ ticker: 'NVO', exchange: 'NYSE', followed: true, sectorKind: 'general' });
    const b = repo.saveCompany({ name: 'Novo Nordisk B', ticker: 'NVO', exchange: 'CPH' });
    expect(b.id).not.toBe(a.id);
    expect(() => repo.saveCompany({ name: 'dup', ticker: 'NVO', exchange: 'NYSE' })).toThrow(/Ya existe/);
  });

  it('rejects unsafe IR urls and invalid tickers', () => {
    expect(() => repo.saveCompany({ name: 'X', irUrl: 'javascript:alert(1)' })).toThrow(ValidationError);
    expect(() => repo.saveCompany({ name: 'X', ticker: 'A B C' })).toThrow(/Ticker/);
    expect(() => repo.saveCompany({ name: '' })).toThrow();
  });

  it('updates keep untouched fields; price is manual and clearable', () => {
    const c = repo.saveCompany({ name: 'Microsoft', ticker: 'MSFT', irUrl: 'https://www.microsoft.com/investor', thesis: 'Nube' });
    repo.saveCompany({ id: c.id, name: 'Microsoft Corp.', ticker: 'MSFT' });
    expect(repo.getCompany(c.id)).toMatchObject({ name: 'Microsoft Corp.', thesis: 'Nube', color: c.color });
    repo.setPrice(c.id, { price: 420.5, currency: 'USD', asOf: '2026-10-20', source: 'Cierre según mi bróker' });
    expect(repo.getCompany(c.id)).toMatchObject({ price: 420.5, priceCurrency: 'USD', priceAsOf: '2026-10-20' });
    repo.setPrice(c.id, { price: null });
    expect(repo.getCompany(c.id)).toMatchObject({ price: null, priceSource: null });
  });

  it('partial updates (e.g. thesis only) never wipe other fields (regression)', () => {
    const c = repo.saveCompany({ name: 'Inditex', ticker: 'ITX', exchange: 'BME', country: 'España', sector: 'Moda', sectorKind: 'general', irUrl: 'https://www.inditex.com/' });
    repo.saveCompany({ id: c.id, name: 'Inditex', thesis: 'Tesis' } as never);
    expect(repo.getCompany(c.id)).toMatchObject({ exchange: 'BME', country: 'España', sector: 'Moda', irUrl: 'https://www.inditex.com/', ticker: 'ITX', thesis: 'Tesis' });
  });

  it('saved tabs drop unsafe urls', () => {
    const c = repo.saveCompany({ name: 'A' });
    repo.setSavedTabs(c.id, [{ url: 'https://a.com/', title: 'A' }, { url: 'file:///etc/passwd', title: 'x' }]);
    expect(repo.getCompany(c.id)!.savedTabs).toEqual([{ url: 'https://a.com/', title: 'A' }]);
  });
});

describe('notebook', () => {
  it('links notes to deduplicated sources with access dates', () => {
    const c = repo.saveCompany({ name: 'Microsoft', ticker: 'MSFT' });
    repo.addNote({ companyId: c.id, kind: 'snippet', quote: 'Azure grew 40%', sourceUrl: 'https://microsoft.com/ir', sourceTitle: 'IR' }, 1000);
    repo.addNote({ companyId: c.id, kind: 'question', body: '¿Margen de Azure?', sourceUrl: 'https://microsoft.com/ir', sourceTitle: '' }, 2000);
    const sources = repo.listSources(c.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ title: 'IR', accessedAt: 2000, noteCount: 2 });
    expect(repo.getCompany(c.id)).toMatchObject({ noteCount: 2, openQuestions: 1 });
    const q = repo.listNotes(c.id).find((n) => n.kind === 'question')!;
    repo.updateNote(q.id, { resolved: true });
    expect(repo.getCompany(c.id)!.openQuestions).toBe(0);
    expect(repo.listNotes(c.id, 'azure')).toHaveLength(2);
  });

  it('figures must be complete and default to published when they have a source', () => {
    const c = repo.saveCompany({ name: 'M' });
    expect(() => repo.addNote({ companyId: c.id, kind: 'figure', metric: 'revenue', value: 10, scale: 'millions', period: '2025' })).toThrow(/periodo/);
    const f = repo.addNote({ companyId: c.id, kind: 'figure', metric: 'revenue', value: 245122, scale: 'millions', currency: 'USD', period: 'fy2025', sourceUrl: 'https://sec.gov/x' });
    expect(f).toMatchObject({ period: 'FY2025', origin: 'published', sourceUrl: 'https://sec.gov/x' });
    const u = repo.addNote({ companyId: c.id, kind: 'figure', metric: 'cash', value: 5, scale: 'billions', period: 'FY2025' });
    expect(u.origin).toBe('user');
    expect(() => repo.updateNote(f.id, { kind: 'note' })).toThrow();
  });

  it('rejects empty notes and unsafe sources', () => {
    const c = repo.saveCompany({ name: 'M' });
    expect(() => repo.addNote({ companyId: c.id, kind: 'note', body: '  ' })).toThrow(/vacía/);
    expect(() => repo.addNote({ companyId: c.id, kind: 'note', body: 'x', sourceUrl: 'file:///c:/x' })).toThrow();
    expect(() => repo.addNote({ companyId: 999, kind: 'note', body: 'x' })).toThrow(/no existe/);
  });

  it('deleting a company deletes its notes and sources', () => {
    const c = repo.saveCompany({ name: 'M' });
    repo.addNote({ companyId: c.id, kind: 'note', body: 'x', sourceUrl: 'https://a.com/' });
    repo.removeCompany(c.id);
    expect(repo.listNotes()).toHaveLength(0);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM sources').get()).toEqual({ n: 0 });
  });

  it('export → import round-trip into an empty profile', () => {
    const c = repo.saveCompany({ name: 'Inditex', ticker: 'ITX', exchange: 'BME', country: 'España', thesis: 'Moda rápida rentable' });
    repo.addNote({ companyId: c.id, kind: 'figure', metric: 'revenue', value: 38.6, scale: 'billions', currency: 'EUR', period: 'FY2025', sourceUrl: 'https://www.inditex.com/' });
    const q = repo.addNote({ companyId: c.id, kind: 'question', body: '¿Inventarios?' });
    repo.updateNote(q.id, { resolved: true });
    const json = JSON.parse(JSON.stringify(repo.exportJson()));
    const md = repo.exportMarkdown();
    expect(md).toContain('## ITX — Inditex');
    expect(md).toContain('- [x] ¿Inventarios?');

    const dir2 = mkdtempSync(path.join(tmpdir(), 'ib-research2-'));
    const store2 = new Store(path.join(dir2, 'r.db'));
    const repo2 = new ResearchRepo(store2.db);
    expect(repo2.importJson(json)).toEqual({ companies: 1, notes: 2, skipped: 0 });
    const c2 = repo2.listCompanies()[0]!;
    expect(c2).toMatchObject({ ticker: 'ITX', thesis: 'Moda rápida rentable', openQuestions: 0 });
    expect(repo2.listNotes(c2.id).find((n) => n.kind === 'figure')).toMatchObject({ value: 38.6, scale: 'billions', origin: 'published' });
    store2.close();
    rmSync(dir2, { recursive: true, force: true });
  });

  it('import rejects foreign or malicious files', () => {
    expect(() => repo.importJson({ format: 'other', version: 1, companies: [] })).toThrow();
    const r = repo.importJson({
      format: 'investor-browser/research',
      version: 1,
      companies: [{ name: 'X', irUrl: 'javascript:alert(1)', notes: [{ kind: 'note', body: 'ok', sourceUrl: 'file:///etc/passwd' }] }],
    });
    expect(r.companies).toBe(1);
    const c = repo.listCompanies()[0]!;
    expect(c.irUrl).toBeNull();
    expect(repo.listNotes(c.id)[0]!.sourceUrl).toBeNull();
  });
});
