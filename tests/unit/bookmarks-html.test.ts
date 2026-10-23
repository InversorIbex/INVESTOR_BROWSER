import { describe, expect, it } from 'vitest';
import { parseBookmarksHtml, serializeBookmarksHtml } from '../../src/shared/bookmarksHtml';

const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Barra de favoritos</H3>
    <DL><p>
        <DT><A HREF="https://www.sec.gov/edgar/search/" ADD_DATE="1700000001">EDGAR &amp; Full-Text</A>
        <DT><H3>Inversión</H3>
        <DL><p>
            <DT><A HREF="https://fred.stlouisfed.org/" ADD_DATE="1700000002">FRED</A>
            <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://www.cnmv.es/">CNMV</A>
    <DT><A HREF="file:///C:/secret.txt">Local file</A>
</DL><p>`;

describe('bookmarks HTML import', () => {
  it('parses folders, titles, entities and dates', () => {
    const { bookmarks, skipped } = parseBookmarksHtml(CHROME_EXPORT);
    expect(bookmarks).toHaveLength(3);
    expect(bookmarks[0]).toMatchObject({
      url: 'https://www.sec.gov/edgar/search/',
      title: 'EDGAR & Full-Text',
      folder: 'Barra de favoritos',
      addedAt: 1700000001000,
    });
    expect(bookmarks[1]).toMatchObject({ title: 'FRED', folder: 'Barra de favoritos / Inversión' });
    expect(bookmarks[2]).toMatchObject({ title: 'CNMV', folder: '' });
    expect(skipped).toBe(2); // javascript: and file: are dropped
  });

  it('round-trips through export', () => {
    const { bookmarks } = parseBookmarksHtml(CHROME_EXPORT);
    const html = serializeBookmarksHtml(bookmarks);
    const again = parseBookmarksHtml(html).bookmarks;
    expect(again.map((b) => [b.url, b.title, b.folder]).sort()).toEqual(bookmarks.map((b) => [b.url, b.title, b.folder]).sort());
  });

  it('escapes HTML in titles on export', () => {
    const html = serializeBookmarksHtml([{ url: 'https://a.com/?a=1&b=2', title: '<script>x</script>', folder: '', addedAt: 0 }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a=1&amp;b=2');
  });
});
