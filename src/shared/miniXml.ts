/**
 * Minimal, non-validating XML reader for small, well-known documents (SEC ownership
 * forms). Deliberately limited for safety:
 *  - DOCTYPE declarations are skipped entirely: no custom entities, no external
 *    resources, no entity-expansion attacks.
 *  - Only the five predefined entities and numeric character references are decoded.
 *  - Hard limits on input size, depth and node count.
 * Namespaces prefixes are stripped from element names.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlError extends Error {}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

const localName = (n: string) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

export function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_BYTES) throw new XmlError('Documento XML demasiado grande');
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  let nodes = 0;
  const len = xml.length;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1]!.text += decodeXmlEntities(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1]!.text += decodeXmlEntities(xml.slice(i, lt));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('Comentario sin cerrar');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('CDATA sin cerrar');
      stack[stack.length - 1]!.text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('Instrucción sin cerrar');
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // <!DOCTYPE …> possibly with an internal subset [ … ]: skip it completely.
      let j = lt + 2;
      let depth = 0;
      while (j < len) {
        const ch = xml[j]!;
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end < 0) throw new XmlError('Etiqueta sin cerrar');
      const name = localName(xml.slice(lt + 2, end).trim());
      const top = stack[stack.length - 1]!;
      if (stack.length === 1 || top.name !== name) throw new XmlError(`Cierre inesperado </${name}>`);
      stack.pop();
      i = end + 1;
    } else {
      // Start tag: find its end, respecting quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      while (j < len) {
        const ch = xml[j]!;
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
        j++;
      }
      if (j >= len) throw new XmlError('Etiqueta sin cerrar');
      let body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const m = /^([A-Za-z_][\w.\-:]*)/.exec(body);
      if (!m) throw new XmlError('Nombre de etiqueta no válido');
      const node: XmlNode = { name: localName(m[1]!), attrs: {}, children: [], text: '' };
      const attrRe = /([A-Za-z_][\w.\-:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const rest = body.slice(m[1]!.length);
      while ((a = attrRe.exec(rest))) node.attrs[localName(a[1]!)] = decodeXmlEntities(a[3] ?? a[4] ?? '');
      if (++nodes > MAX_NODES) throw new XmlError('Documento XML con demasiados nodos');
      stack[stack.length - 1]!.children.push(node);
      if (!selfClosing) {
        stack.push(node);
        if (stack.length > MAX_DEPTH) throw new XmlError('Documento XML demasiado profundo');
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError('Documento XML incompleto');
  const top = root.children[0];
  if (!top) throw new XmlError('Documento XML vacío');
  return top;
}

// ---------------- navigation helpers ----------------
export function child(n: XmlNode | undefined, name: string): XmlNode | undefined {
  return n?.children.find((c) => c.name === name);
}
export function children(n: XmlNode | undefined, name: string): XmlNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}
export function path(n: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let cur = n;
  for (const name of names) cur = child(cur, name);
  return cur;
}
export function text(n: XmlNode | undefined): string | null {
  const t = n?.text.trim();
  return t ? t : null;
}
/** SEC ownership forms wrap most values as <field><value>…</value></field>. */
export function valueOf(n: XmlNode | undefined, ...names: string[]): string | null {
  const node = path(n, ...names);
  return text(child(node, 'value')) ?? text(node);
}
