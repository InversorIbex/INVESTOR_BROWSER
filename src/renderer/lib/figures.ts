import { useEffect, useMemo, useState } from 'react';
import { ib, useNotesRevision } from './ib';
import type { FinancialFact, Note } from '../../shared/types';
import type { Figure, MetricId, Scale } from '../../shared/finance';

const fmtRaw = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** Official SEC figures as dossier figures, with full provenance in `detail`. */
export function secFactToFigure(f: FinancialFact): Figure {
  const restatedTxt =
    f.restatedValue !== null ? `\n⚠ Re-expresado: en el ${f.form.startsWith('20') ? '20-F' : '10-K'} presentado el ${f.restatedFiled} era ${fmtRaw(f.restatedValue)} ${f.unit}.` : '';
  return {
    metric: f.metric as MetricId,
    period: f.period,
    value: f.value,
    scale: 'units',
    currency: f.currency,
    origin: 'published',
    sourceUrl: f.sourceUrl,
    sourceTitle: `SEC EDGAR · ${f.form} presentado ${f.filed}`,
    detail: `${f.derived ? 'Suma de componentes: ' : 'Concepto XBRL: '}${f.concept}\nPeriodo: ${f.periodStart ? f.periodStart + ' → ' : 'saldo a '}${f.periodEnd}\nRegistro ${f.accn}${restatedTxt}`,
    restated: f.restatedValue !== null,
    provider: 'sec',
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
