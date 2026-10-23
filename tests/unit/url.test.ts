import { describe, expect, it } from 'vitest';
import { classifyUrl, displayUrl, isSafeWebUrl, normalizeInput, parseInternal, parseInternalRoute, redactUrl, securityStateOf } from '../../src/shared/url';

describe('normalizeInput', () => {
  it('keeps explicit http(s) URLs', () => {
    expect(normalizeInput('https://www.sec.gov/edgar')).toEqual({ kind: 'url', url: 'https://www.sec.gov/edgar' });
    expect(normalizeInput('http://example.com')).toEqual({ kind: 'url', url: 'http://example.com/' });
  });

  it('adds https:// to bare domains', () => {
    expect(normalizeInput('sec.gov')).toEqual({ kind: 'url', url: 'https://sec.gov/' });
    expect(normalizeInput('investor.microsoft.com/annual-reports')).toEqual({
      kind: 'url',
      url: 'https://investor.microsoft.com/annual-reports',
    });
  });

  it('uses http:// for localhost and IPs', () => {
    expect(normalizeInput('localhost:3000').url).toBe('http://localhost:3000/');
    expect(normalizeInput('127.0.0.1:8080/x').url).toBe('http://127.0.0.1:8080/x');
  });

  it('treats free text and tickers as searches', () => {
    const r = normalizeInput('MSFT 10-K 2025', 'duckduckgo');
    expect(r.kind).toBe('search');
    expect(r.url).toBe('https://duckduckgo.com/?q=MSFT%2010-K%202025');
    expect(normalizeInput('NVO').kind).toBe('search');
  });

  it('uses the configured search engine', () => {
    expect(normalizeInput('free cash flow', 'google').url).toBe('https://www.google.com/search?q=free%20cash%20flow');
  });

  it('never navigates to dangerous schemes', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>x</script>', 'chrome://settings', 'vbscript:msgbox']) {
      expect(normalizeInput(bad).kind, bad).toBe('search');
    }
  });

  it('recognises internal pages only from the allow-list', () => {
    expect(normalizeInput('ib://history')).toEqual({ kind: 'internal', url: 'ib://history' });
    expect(normalizeInput('ib://evil').kind).toBe('search');
    expect(normalizeInput('').kind).toBe('internal');
  });
});

describe('url safety', () => {
  it('isSafeWebUrl allows only http, https and about:blank', () => {
    expect(isSafeWebUrl('https://a.com')).toBe(true);
    expect(isSafeWebUrl('http://a.com')).toBe(true);
    expect(isSafeWebUrl('about:blank')).toBe(true);
    expect(isSafeWebUrl('file:///c:/x')).toBe(false);
    expect(isSafeWebUrl('javascript:void(0)')).toBe(false);
    expect(isSafeWebUrl('ib://settings')).toBe(false);
  });

  it('classifyUrl separates external protocols', () => {
    expect(classifyUrl('mailto:ir@example.com')).toBe('mailto');
    expect(classifyUrl('tel:+34900000000')).toBe('tel');
    expect(classifyUrl('ms-settings:privacy')).toBe('blocked');
    expect(classifyUrl('ib://downloads')).toBe('internal');
  });

  it('parseInternal rejects lookalikes', () => {
    expect(parseInternal('ib://settings')).toBe('settings');
    expect(parseInternal('ib://settings/../x')).toBeNull();
    expect(parseInternal('ib://settings/3')).toBeNull();
  });

  it('internal routes with ids', () => {
    expect(parseInternalRoute('ib://company/12')).toEqual({ page: 'company', id: 12 });
    expect(parseInternalRoute('ib://company')).toBeNull(); // id required
    expect(parseInternalRoute('ib://valuation')).toEqual({ page: 'valuation', id: null });
    expect(parseInternalRoute('ib://valuation/3')).toEqual({ page: 'valuation', id: 3 });
    expect(parseInternalRoute('ib://company/1;drop')).toBeNull();
    expect(normalizeInput('ib://company/7')).toEqual({ kind: 'internal', url: 'ib://company/7' });
  });

  it('redactUrl removes query strings and fragments before logging', () => {
    expect(redactUrl('https://bank.com/login?token=SECRET#frag')).toBe('https://bank.com/login');
    expect(redactUrl('not a url')).toBe('[invalid-url]');
  });

  it('securityStateOf', () => {
    expect(securityStateOf('https://x.com')).toBe('secure');
    expect(securityStateOf('http://x.com')).toBe('insecure');
    expect(securityStateOf('http://localhost:1234')).toBe('local');
    expect(securityStateOf('ib://newtab')).toBe('internal');
  });

  it('displayUrl', () => {
    expect(displayUrl('https://www.sec.gov/')).toBe('sec.gov');
    expect(displayUrl('https://www.sec.gov/cgi-bin/browse?x=1')).toBe('sec.gov/cgi-bin/browse?x=1');
  });
});
