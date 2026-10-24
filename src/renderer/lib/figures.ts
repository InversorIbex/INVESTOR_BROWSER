import { useEffect, useMemo, useState } from 'react';
import { ib, useNotesRevision } from './ib';
import type { Company, FinancialFact, FxRatesInfo, Note } from '../../shared/types';
import { convert } from '../../shared/market';
import type { Figure, FigureTable, MetricId, Scale } from '../../shared/finance';

const fmtRaw = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** Official figures (SEC or European ESEF) as dossier figures, with full provenance in `detail`. */
export function secFactToFigure(f: FinancialFact): Figure {
  const esef = f.provider === 'esef';
  const doc = esef ? 'informe anual ESEF' : f.form.startsWith('20') ? '20-F' : '10-K';
  const restatedTxt = f.restatedValue !== null ? `\n⚠ Re-expresado: en el ${doc} publicado el ${f.restatedFiled} era ${fmtRaw(f.restatedValue)} ${f.unit}.` : '';
  return {
    metric: f.metric as MetricId,
    period: f.period,
    value: f.value,
    scale: 'units',
    currency: f.currency,
    origin: 'published',
    sourceUrl: f.sourceUrl,
    sourceTitle: esef ? `Informe anual oficial (ESEF) · publicado ${f.filed} · vía filings.xbrl.org` : `SEC EDGAR · ${f.form} presentado ${f.filed}`,
    detail: `${f.derived ? 'Suma de componentes: ' : 'Concepto XBRL: '}${f.concept}\nPeriodo: ${f.periodStart ? f.periodStart + ' → ' : 'saldo a '}${f.periodEnd}\n${esef ? 'Informe' : 'Registro'} ${f.accn}${restatedTxt}`,
    restated: f.restatedValue !== null,
    provider: f.provider,
  };
}

export function noteToFigure(n: Note): Figure | null {
  if (n.kind !== 'figure' || !n.metric || !n.period || n.value === null || !n.scale) return null;
  return {
    metric: n.metric as MetricId,
    period: n.period,
    value: n.value,
    scale: n.scale as Scale,
    currency: n.currency,
    origin: n.origin ?? 'user',
    sourceUrl: n.sourceUrl,
    sourceTitle: n.sourceTitle,
    noteId: n.id,
  };
}

/** Figures for several companies at once (comparison view). */
export function useManyCompanyFigures(ids: number[]): Map<number, Figure[]> {
  const rev = useNotesRevision();
  const [data, setData] = useState<Map<number, Figure[]>>(new Map());
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all(
      ids.map(async (id) => {
        const [notes, facts] = await Promise.all([ib.invoke('notes:list', { companyId: id }), ib.invoke('sec:facts', { companyId: id })]);
        return [id, [...facts.map(secFactToFigure), ...notes.map(noteToFigure).filter((f): f is Figure => !!f)]] as [number, Figure[]];
      }),
    ).then((entries) => alive && setData(new Map(entries)));
    return () => {
      alive = false;
    };
  }, [key, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

/**
 * All figures of a company: official SEC data first, then your notebook figures,
 * which win when both exist for the same metric and period (you saved them on purpose).
 */
export function useCompanyFigures(companyId: number | null) {
  const rev = useNotesRevision();
  const [notes, setNotes] = useState<Note[]>([]);
  const [facts, setFacts] = useState<FinancialFact[]>([]);
  useEffect(() => {
    if (!companyId) {
      setNotes([]);
      setFacts([]);
      return;
    }
    let alive = true;
    void ib.invoke('notes:list', { companyId }).then((n) => alive && setNotes(n));
    void ib.invoke('sec:facts', { companyId }).then((f) => alive && setFacts(f));
    return () => {
      alive = false;
    };
  }, [companyId, rev]);
  const figures = useMemo(() => [...facts.map(secFactToFigure), ...notes.map(noteToFigure).filter((f): f is Figure => !!f)], [facts, notes]);
  return { figures, notes, facts };
}

// ---------------------------------------------------------------- price in the statements' currency

let fxPromise: Promise<FxRatesInfo | null> | null = null;
/** ECB reference rates, fetched once per session (and only when a conversion is needed). */
export function useFx(needed: boolean): FxRatesInfo | null {
  const [fx, setFx] = useState<FxRatesInfo | null>(null);
  useEffect(() => {
    if (!needed) return;
    let alive = true;
    fxPromise ??= ib.invoke('fx:rates').catch(() => null);
    void fxPromise.then((r) => {
      if (!r) fxPromise = null; // retry next time
      if (alive) setFx(r);
    });
    return () => {
      alive = false;
    };
  }, [needed]);
  return fx;
}

/** Currency of the statements in a figure table row (ignores per-share units). */
export function statementCurrency(table: FigureTable, period: string | null | undefined): string | null {
  const row = period ? table.get(period) : undefined;
  return row ? ([...row.values()].find((v) => v.currency && !v.currency.includes('/'))?.currency ?? null) : null;
}

/**
 * The company's price expressed in `currency`. Never mixes currencies silently:
 * when a conversion is needed and no ECB rate is available, the price is null.
 */
export function priceIn(company: Company, currency: string | null, fx: FxRatesInfo | null): { value: number | null; note: string | null } {
  if (company.price === null) return { value: null, note: null };
  if (!currency || !company.priceCurrency || currency === company.priceCurrency) return { value: company.price, note: null };
  const v = convert(company.price, company.priceCurrency, currency, fx);
  return v === null
    ? { value: null, note: `Precio en ${company.priceCurrency} y cuentas en ${currency}: falta el tipo de cambio.` }
    : { value: v, note: `Precio convertido de ${company.priceCurrency} a ${currency} (BCE, ${fx?.date ?? ''}).` };
}
