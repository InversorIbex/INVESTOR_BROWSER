/**
 * Import/export in the "Netscape Bookmark File" format understood by Chrome,
 * Edge, Firefox, Brave and Safari.
 */
import { isSafeWebUrl } from './url';

export interface PortableBookmark {
  url: string;
  title: string;
  folder: string; // '' for root, nested folders joined with ' / '
  addedAt: number; // epoch ms
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Parse a bookmarks HTML file. Unsafe URLs (javascript:, file:, …) are dropped. */
export function parseBookmarksHtml(html: string): { bookmarks: PortableBookmark[]; skipped: number } {
  const bookmarks: PortableBookmark[] = [];
  let skipped = 0;
  const folderStack: string[] = [];
  let pendingFolder: string | null = null;
  const token = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<DT><A\s+([^>]*)>([\s\S]*?)<\/A>/gi;
  let m: RegExpExecArray | null;
  let depth = 0;
  while ((m = token.exec(html))) {
    const t = m[0];
    if (m[1] !== undefined) {
      pendingFolder = decodeEntities(m[1].trim());
    } else if (/^<DL/i.test(t)) {
      depth++;
      // The outermost <DL> is the root list, not a folder.
      if (depth > 1) folderStack.push(pendingFolder ?? 'Carpeta');
      pendingFolder = null;
    } else if (/^<\/DL/i.test(t)) {
      if (depth > 1) folderStack.pop();
      depth = Math.max(0, depth - 1);
    } else if (m[2] !== undefined) {
      const attrs = m[2];
      const href = /HREF="([^"]*)"/i.exec(attrs)?.[1];
      const added = /ADD_DATE="(\d+)"/i.exec(attrs)?.[1];
      const url = href ? decodeEntities(href) : '';
      if (!url || !isSafeWebUrl(url) || url === 'about:blank') {
        skipped++;
        continue;
      }
      const title = decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, '').trim()) || url;
      bookmarks.push({
        url,
        title,
        folder: folderStack.join(' / '),
        addedAt: added ? Number(added) * 1000 : Date.now(),
      });
    }
  }
  return { bookmarks, skipped };
}

export function serializeBookmarksHtml(items: PortableBookmark[], rootTitle = 'Bookmarks'): string {
  const byFolder = new Map<string, PortableBookmark[]>();
  for (const b of items) {
    const list = byFolder.get(b.folder) ?? [];
    list.push(b);
    byFolder.set(b.folder, list);
  }
  const link = (b: PortableBookmark, indent: string) =>
    `${indent}<DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${Math.floor(b.addedAt / 1000)}">${escapeHtml(b.title)}</A>\n`;
  let out =
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<!-- This is an automatically generated file. -->\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    `<TITLE>${escapeHtml(rootTitle)}</TITLE>\n<H1>${escapeHtml(rootTitle)}</H1>\n<DL><p>\n`;
  for (const b of byFolder.get('') ?? []) out += link(b, '    ');
  const folders = [...byFolder.keys()].filter((f) => f !== '').sort();
  for (const folder of folders) {
    // Nested folder paths are flattened into one level named "A / B" — lossless for our own re-import.
    out += `    <DT><H3>${escapeHtml(folder)}</H3>\n    <DL><p>\n`;
    for (const b of byFolder.get(folder)!) out += link(b, '        ');
    out += '    </DL><p>\n';
  }
  out += '</DL><p>\n';
  return out;
}
