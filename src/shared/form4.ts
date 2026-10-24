/**
 * SEC Form 4 (Statement of Changes in Beneficial Ownership) parsing and
 * classification. Element names verified against a real filing (Oct 2026):
 * ownershipDocument > issuer, reportingOwner (reportingOwnerId, reportingOwnerRelationship),
 * aff10b5One, nonDerivativeTable/derivativeTable > *Transaction (transactionDate,
 * transactionCoding/transactionCode, transactionAmounts, postTransactionAmounts,
 * ownershipNature), footnotes > footnote[id].
 */
import { child, children, parseXml, path, text, valueOf, type XmlNode } from './miniXml';

export type TxCategory = 'buy' | 'sell' | 'grant' | 'exercise' | 'tax' | 'gift' | 'disposition' | 'other';

export const CODE_INFO: Record<string, { label: string; category: TxCategory }> = {
  P: { label: 'Compra en mercado abierto o privada', category: 'buy' },
  S: { label: 'Venta en mercado abierto o privada', category: 'sell' },
  A: { label: 'Concesión o adjudicación de la empresa', category: 'grant' },
  D: { label: 'Disposición a favor de la empresa', category: 'disposition' },
  F: { label: 'Pago del precio o de impuestos entregando acciones', category: 'tax' },
  M: { label: 'Ejercicio o conversión de derivado exento', category: 'exercise' },
  X: { label: 'Ejercicio de derivado con ganancia', category: 'exercise' },
  C: { label: 'Conversión de derivado', category: 'exercise' },
  O: { label: 'Ejercicio de derivado sin ganancia', category: 'exercise' },
  G: { label: 'Donación', category: 'gift' },
  I: { label: 'Operación discrecional en plan de la empresa', category: 'other' },
  J: { label: 'Otra adquisición o disposición (ver nota)', category: 'other' },
  K: { label: 'Permuta de rentabilidad (equity swap)', category: 'other' },
  L: { label: 'Adquisición pequeña', category: 'other' },
  W: { label: 'Herencia', category: 'other' },
  Z: { label: 'Fideicomiso de voto', category: 'other' },
  U: { label: 'Entrega en una OPA de cambio de control', category: 'other' },
  E: { label: 'Vencimiento de derivado corto', category: 'other' },
  H: { label: 'Vencimiento o cancelación de derivado largo', category: 'other' },
  V: { label: 'Comunicada voluntariamente antes de plazo', category: 'other' },
};

/** Short labels for compact tables; the full description goes in the tooltip. */
export const CATEGORY_SHORT: Record<TxCategory, string> = {
  buy: 'Compra',
  sell: 'Venta',
  grant: 'Concesión',
  exercise: 'Ejercicio',
  tax: 'Retención fiscal',
  gift: 'Donación',
  disposition: 'A la empresa',
  other: 'Otra',
};

export interface InsiderOwner {
  name: string;
  cik: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPercentOwner: boolean;
  isOther: boolean;
}

export interface InsiderTransaction {
  seq: number;
  table: 'nonDerivative' | 'derivative';
  security: string;
  date: string;
  code: string;
  category: TxCategory;
  shares: number | null;
  price: number | null;
  acquiredDisposed: 'A' | 'D' | null;
  sharesAfter: number | null;
  ownership: 'D' | 'I' | null;
  /** Executed under a Rule 10b5-1 trading plan (form checkbox or footnote). */
  plan10b51: boolean;
  planSource: 'checkbox' | 'footnote' | null;
  footnotes: string[];
}

export interface Form4 {
  documentType: string;
  periodOfReport: string | null;
  issuerCik: string | null;
  issuerName: string | null;
  issuerSymbol: string | null;
  owners: InsiderOwner[];
  transactions: InsiderTransaction[];
  footnotes: Record<string, string>;
}

const num = (s: string | null): number | null => {
  if (s === null) return null;
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};
const bool = (s: string | null) => s === '1' || s?.toLowerCase() === 'true';
const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

function footnoteIds(n: XmlNode): string[] {
  const ids: string[] = [];
  const walk = (x: XmlNode) => {
    if (x.name === 'footnoteId' && x.attrs.id) ids.push(x.attrs.id);
    x.children.forEach(walk);
  };
  walk(n);
  return [...new Set(ids)];
}

export function parseForm4(xml: string): Form4 {
  const doc = parseXml(xml);
  if (doc.name !== 'ownershipDocument') throw new Error('No es un documento de propiedad de la SEC');
  const documentType = text(child(doc, 'documentType')) ?? '';
  const footnotes: Record<string, string> = {};
  for (const f of children(child(doc, 'footnotes'), 'footnote')) if (f.attrs.id) footnotes[f.attrs.id] = (text(f) ?? '').slice(0, 2000);

  const owners: InsiderOwner[] = children(doc, 'reportingOwner').map((o) => {
    const rel = child(o, 'reportingOwnerRelationship');
    return {
      name: (text(path(o, 'reportingOwnerId', 'rptOwnerName')) ?? 'Desconocido').slice(0, 200),
      cik: text(path(o, 'reportingOwnerId', 'rptOwnerCik')),
      isDirector: bool(text(child(rel, 'isDirector'))),
      isOfficer: bool(text(child(rel, 'isOfficer'))),
      officerTitle: text(child(rel, 'officerTitle'))?.slice(0, 120) ?? null,
      isTenPercentOwner: bool(text(child(rel, 'isTenPercentOwner'))),
      isOther: bool(text(child(rel, 'isOther'))),
    };
  });

  const docPlan = bool(text(child(doc, 'aff10b5One')));
  const transactions: InsiderTransaction[] = [];
  let seq = 0;
  for (const [tableName, rowName, kind] of [
    ['nonDerivativeTable', 'nonDerivativeTransaction', 'nonDerivative'],
    ['derivativeTable', 'derivativeTransaction', 'derivative'],
  ] as const) {
    for (const t of children(child(doc, tableName), rowName)) {
      const code = (text(path(t, 'transactionCoding', 'transactionCode')) ?? '').toUpperCase().slice(0, 2);
      const notes = footnoteIds(t);
      const footnotePlan = notes.some((id) => /10b5-?1/i.test(footnotes[id] ?? ''));
      const ad = valueOf(t, 'transactionAmounts', 'transactionAcquiredDisposedCode');
      const own = valueOf(t, 'ownershipNature', 'directOrIndirectOwnership');
      const plan = (docPlan || footnotePlan) && (code === 'S' || code === 'P');
      transactions.push({
        seq: seq++,
        table: kind,
        security: (valueOf(t, 'securityTitle') ?? '').slice(0, 200),
        date: date(valueOf(t, 'transactionDate')) ?? date(text(child(doc, 'periodOfReport'))) ?? '',
        code,
        category: CODE_INFO[code]?.category ?? 'other',
        shares: num(valueOf(t, 'transactionAmounts', 'transactionShares')),
        price: num(valueOf(t, 'transactionAmounts', 'transactionPricePerShare')),
        acquiredDisposed: ad === 'A' || ad === 'D' ? ad : null,
        sharesAfter: num(valueOf(t, 'postTransactionAmounts', 'sharesOwnedFollowingTransaction')),
        ownership: own === 'D' || own === 'I' ? own : null,
        plan10b51: plan,
        planSource: plan ? (docPlan ? 'checkbox' : 'footnote') : null,
        footnotes: notes,
      });
    }
  }

  return {
    documentType,
    periodOfReport: date(text(child(doc, 'periodOfReport'))),
    issuerCik: text(path(doc, 'issuer', 'issuerCik')),
    issuerName: text(path(doc, 'issuer', 'issuerName')),
    issuerSymbol: text(path(doc, 'issuer', 'issuerTradingSymbol')),
    owners,
    transactions,
    footnotes,
  };
}

/** Raw XML file of a Form 4 from the `primaryDocument` in submissions ("xslF345X05/doc4.xml" → "doc4.xml"). */
export function rawForm4File(primaryDocument: string | null): string | null {
  if (!primaryDocument) return null;
  const base = primaryDocument.split('/').pop() ?? '';
  return /^[\w.\-]{1,120}\.xml$/i.test(base) ? base : null;
}

export function ownerRole(o: Pick<InsiderOwner, 'isDirector' | 'isOfficer' | 'officerTitle' | 'isTenPercentOwner' | 'isOther'>): string {
  const r: string[] = [];
  if (o.isOfficer) r.push(o.officerTitle || 'Directivo');
  if (o.isDirector) r.push('Consejero');
  if (o.isTenPercentOwner) r.push('Accionista ≥10 %');
  if (o.isOther && !r.length) r.push('Otro');
  return r.join(' · ') || '—';
}

// ---------------------------------------------------------------- summary

export interface StoredInsiderTx {
  accn: string;
  filed: string;
  ownerName: string;
  role: string;
  date: string;
  code: string;
  category: TxCategory;
  table: 'nonDerivative' | 'derivative';
  shares: number | null;
  price: number | null;
  plan10b51: boolean;
}

export interface InsiderSummary {
  since: string;
  until: string;
  buys: { count: number; insiders: number; value: number };
  discretionarySells: { count: number; insiders: number; value: number };
  planSells: { count: number; value: number };
  taxWithholding: { count: number; shares: number };
  grants: { count: number; shares: number };
  exercises: { count: number; shares: number };
  notes: string[];
}

/** 12-month activity summary; amounts in the security's currency (shares × reported price). */
export function summarizeInsiders(txs: StoredInsiderTx[], until: string, months = 12): InsiderSummary {
  const end = new Date(until + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  const since = start.toISOString().slice(0, 10);
  const inRange = txs.filter((t) => t.table === 'nonDerivative' && t.date >= since && t.date <= until);
  const val = (t: StoredInsiderTx) => (t.shares !== null && t.price !== null && t.price > 0 ? t.shares * t.price : 0);
  const buys = inRange.filter((t) => t.category === 'buy');
  const sells = inRange.filter((t) => t.category === 'sell' && !t.plan10b51);
  const plan = inRange.filter((t) => t.category === 'sell' && t.plan10b51);
  const sum = (l: StoredInsiderTx[], f: (t: StoredInsiderTx) => number) => l.reduce((s, t) => s + f(t), 0);
  const notes: string[] = [];
  const buyers = new Set(buys.map((t) => t.ownerName));
  if (buyers.size >= 3) notes.push(`${buyers.size} insiders distintos compraron en mercado en el periodo (compras agrupadas).`);
  if (plan.length && !sells.length) notes.push('Todas las ventas se hicieron bajo planes 10b5-1 programados de antemano.');
  if (!inRange.length) notes.push('Sin operaciones en acciones ordinarias en el periodo con los Form 4 cargados.');
  return {
    since,
    until,
    buys: { count: buys.length, insiders: buyers.size, value: sum(buys, val) },
    discretionarySells: { count: sells.length, insiders: new Set(sells.map((t) => t.ownerName)).size, value: sum(sells, val) },
    planSells: { count: plan.length, value: sum(plan, val) },
    taxWithholding: { count: inRange.filter((t) => t.category === 'tax').length, shares: sum(inRange.filter((t) => t.category === 'tax'), (t) => t.shares ?? 0) },
    grants: { count: inRange.filter((t) => t.category === 'grant').length, shares: sum(inRange.filter((t) => t.category === 'grant'), (t) => t.shares ?? 0) },
    exercises: { count: inRange.filter((t) => t.category === 'exercise').length, shares: sum(inRange.filter((t) => t.category === 'exercise'), (t) => t.shares ?? 0) },
    notes,
  };
}
