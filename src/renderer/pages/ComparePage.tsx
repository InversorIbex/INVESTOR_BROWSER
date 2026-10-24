import { useMemo, useState } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { ib, useBrowser, useCompanies } from '../lib/ib';
import { useManyCompanyFigures } from '../lib/figures';
import { TickerChip } from '../components/research';
import { EmptyState } from '../components/ui';
import { buildFigureTable, type Figure, type FigureTable, type MetricId } from '../../shared/finance';
import { annualPeriods, forensicsReport, qualityReport, roicSeries } from '../../shared/analysis';
import { multiples } from '../../shared/valuation';
import type { Company } from '../../shared/types';

const MAX = 5;

interface Cell {
  text: string;
  value: number | null;
  title?: string;
}
interface Row {
  id: string;
  label: string;
  better?: 'high' | 'low';
  cells: Cell[];
}

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? null : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`);
const mult = (v: number | null) => (v === null || !Number.isFinite(v) ? null : `${v.toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`);

/**
 * Side-by-side comparison of companies using only data with provenance
 * (SEC filings and your notebook). Nothing is read from page contents.
 */
export function ComparePage() {
  const companies = useCompanies();
  const { tabs } = useBrowser();
  const fromTabs = [...new Set(tabs.map((t) => t.companyId).filter((x): x is number => x !== null))];
  const [selected, setSelected] = useState<number[]>(() => (fromTabs.length >= 2 ? fromTabs : companies.map((c) => c.id)).slice(0, 3));
  const chosen = selected.map((id) => companies.find((c) => c.id === id)).filter((c): c is Company => !!c);
  const figures = useManyCompanyFigures(chosen.map((c) => c.id));

  const tables = useMemo(() => new Map(chosen.map((c) => [c.id, buildFigureTable(figures.get(c.id) ?? [])])), [figures, chosen.map((c) => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX ? s : [...s, id]));

  if (companies.length < 2)
    return (
      <div className="page">
        <EmptyState icon={<Info size={28} />} title="Necesitas al menos dos empresas">
          Crea empresas en Investigación e importa sus cifras de la SEC o añádelas desde sus informes.
        </EmptyState>
      </div>
    );

  const rows = buildRows(chosen, tables, figures);
  const lastPeriods = chosen.map((c) => annualPeriods(tables.get(c.id) ?? new Map()).at(-1) ?? null);
  const fyEnds = chosen.map((c) => c.fiscalYearEnd).filter(Boolean);
  const currencies = new Set(chosen.map((c) => currencyOf(tables.get(c.id))).filter(Boolean));
  const mixedYears = new Set(lastPeriods.filter(Boolean)).size > 1;
  const mixedFye = new Set(fyEnds).size > 1;

  return (
    <div className="page compare" data-testid="compare-page">
      <header className="page-head">
        <h1>Comparar empresas</h1>
        <span className="muted small">Hasta {MAX} empresas · último ejercicio anual disponible de cada una</span>
      </header>

      <div className="compare-picker" data-testid="compare-picker">
        {companies.map((c) => (
          <button key={c.id} className={`company-pick ${selected.includes(c.id) ? 'is-on' : ''}`} onClick={() => toggle(c.id)} data-testid="compare-pick" aria-pressed={selected.includes(c.id)}>
            <TickerChip company={c} size="sm" />
            <span className="ellipsis">{c.name}</span>
          </button>
        ))}
      </div>

      {(mixedYears || mixedFye || currencies.size > 1) && (
        <div className="notice" data-testid="compare-warning">
          <TriangleAlert size={13} />{' '}
          {mixedYears && <>Los últimos ejercicios no coinciden ({lastPeriods.map((p) => p ?? '—').join(' / ')}). </>}
          {mixedFye && <>Los cierres fiscales son distintos ({chosen.map((c) => (c.fiscalYearEnd ? `${c.fiscalYearEnd.slice(2)}/${c.fiscalYearEnd.slice(0, 2)}` : '—')).join(' / ')}): un «FY» no cubre los mismos meses. </>}
          {currencies.size > 1 && <>Monedas distintas ({[...currencies].join(', ')}): compara ratios, no importes. </>}
        </div>
      )}

      {chosen.length < 2 ? (
        <p className="muted">Selecciona al menos dos empresas.</p>
      ) : (
        <div className="table-wrap card">
          <table className="fin-table compare-table" data-testid="compare-table">
            <thead>
              <tr>
                <th />
                {chosen.map((c) => (
                  <th key={c.id}>
                    <button className="link-btn compare-head" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })}>
                      <TickerChip company={c} size="sm" /> <span className="ellipsis">{c.name}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = r.cells.map((c) => c.value).filter((v): v is number => v !== null && Number.isFinite(v));
                const best = r.better && vals.length > 1 ? (r.better === 'high' ? Math.max(...vals) : Math.min(...vals)) : null;
                return (
                  <tr key={r.id} data-row={r.id}>
                    <th>{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`mono ${c.value === null && c.text === 'Pendiente' ? 'pending' : ''} ${best !== null && c.value === best ? 'is-best' : ''}`} title={c.title}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">
            <span className="pending">Pendiente</span> = dato no disponible con procedencia (impórtalo de la SEC o añádelo desde el informe). Se resalta el mejor valor solo en ratios comparables. Pasa el ratón para ver el
            ejercicio y la fórmula.
          </p>
        </div>
      )}
    </div>
  );
}

function currencyOf(t: FigureTable | undefined): string | null {
  if (!t) return null;
  for (const row of t.values()) {
    const c = row.get('revenue')?.currency;
    if (c) return c;
  }
  return null;
}

function buildRows(chosen: Company[], tables: Map<number, FigureTable>, figures: Map<number, Figure[]>): Row[] {
  const ctx = chosen.map((c) => {
    const t = tables.get(c.id) ?? new Map();
    const periods = annualPeriods(t);
    const last = periods.at(-1) ?? null;
    const g = (m: MetricId, p = last) => (p ? t.get(p)?.get(m)?.value ?? null : null);
    // Same inputs as the dossier, so both views always agree.
    const restated = (figures.get(c.id) ?? []).filter((f) => f.restated).map((f) => ({ period: f.period, metric: f.metric }));
    return { c, t, periods, last, g, quality: qualityReport(t, c.sectorKind), forensics: forensicsReport(t, restated) };
  });
  const pend: Cell = { text: 'Pendiente', value: null };
  const cell = (v: number | null, fmt: (v: number | null) => string | null, title?: string): Cell => {
    const text = fmt(v);
    return text === null ? { ...pend, title } : { text, value: v, title };
  };
  const crit = (x: (typeof ctx)[number], id: string) => x.quality.criteria.find((k) => k.id === id);

  return [
    { id: 'period', label: 'Último ejercicio', cells: ctx.map((x) => (x.last ? { text: x.last + (x.c.fiscalYearEnd ? ` (cierre ${x.c.fiscalYearEnd.slice(2)}/${x.c.fiscalYearEnd.slice(0, 2)})` : ''), value: null } : pend)) },
    {
      id: 'revenue',
      label: 'Ingresos (millones)',
      cells: ctx.map((x) => {
        const v = x.g('revenue');
        const cur = currencyOf(x.t);
        return v === null ? pend : { text: `${(v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 0 })}${cur ? ' ' + cur : ''}`, value: null, title: x.last ?? '' };
      }),
    },
    { id: 'growth', label: 'Crecimiento anual de ingresos', better: 'high', cells: ctx.map((x) => cell(crit(x, 'growth')?.value ?? null, pct, crit(x, 'growth')?.periods.join(' → '))) },
    ...(['gross_profit', 'operating_income', 'net_income', 'fcf'] as const).map((m) => ({
      id: `margin_${m}`,
      label: { gross_profit: 'Margen bruto', operating_income: 'Margen operativo', net_income: 'Margen neto', fcf: 'Margen de FCL' }[m],
      better: 'high' as const,
      cells: ctx.map((x) => {
        const num = x.g(m) ?? (m === 'operating_income' ? x.g('ebit') : null);
        const rev = x.g('revenue');
        return cell(num !== null && rev ? num / rev : null, pct, `${x.last ?? ''} · ${m} / ingresos`);
      }),
    })),
    {
      id: 'roic',
      label: 'ROIC (último calculable)',
      better: 'high',
      cells: ctx.map((x) => {
        const r = roicSeries(x.t).filter((p) => p.roic !== null).at(-1);
        return cell(r?.roic ?? null, pct, r ? r.period : roicSeries(x.t).at(-1)?.reason);
      }),
    },
    { id: 'fcf_conversion', label: 'Conversión en FCL', better: 'high', cells: ctx.map((x) => cell(crit(x, 'fcf_conversion')?.value ?? null, pct, crit(x, 'fcf_conversion')?.reason ?? crit(x, 'fcf_conversion')?.formula)) },
    {
      id: 'leverage',
      label: 'Deuda neta / B. operativo',
      better: 'low',
      cells: ctx.map((x) => {
        const nd = x.g('net_debt');
        const op = x.g('operating_income') ?? x.g('ebit');
        if (nd === null || op === null) return pend;
        if (nd <= 0) return { text: 'Caja neta', value: nd / Math.max(op, 1), title: x.last ?? '' };
        return cell(op > 0 ? nd / op : null, mult, x.last ?? '');
      }),
    },
    { id: 'dilution', label: 'Dilución anual', better: 'low', cells: ctx.map((x) => cell(crit(x, 'dilution')?.value ?? null, pct, crit(x, 'dilution')?.periods.join(' → '))) },
    { id: 'quality', label: 'Criterios de calidad fuertes', cells: ctx.map((x) => (x.quality.evaluable ? { text: `${x.quality.strong} / ${x.quality.evaluable}`, value: null, title: 'Ver pestaña Calidad del dossier' } : pend)) },
    {
      id: 'forensics',
      label: 'Señales forenses a revisar',
      cells: ctx.map((x) => {
        // The restatement check is always "evaluable"; it alone is not enough to report "0 signals".
        const evaluable = x.forensics.signals.filter((s) => s.status !== 'na' && s.id !== 'restatements').length;
        return evaluable ? { text: String(x.forensics.triggered), value: null, title: x.forensics.signals.filter((s) => s.status === 'triggered').map((s) => s.title).join('\n') } : pend;
      }),
    },
    {
      id: 'fcf_yield',
      label: 'Rentabilidad FCL (precio manual)',
      better: 'high',
      cells: ctx.map((x) => {
        if (x.c.price === null) return { text: 'Sin precio', value: null };
        const m = multiples({ price: x.c.price, shares: x.g('diluted_shares'), grossDebt: null, cash: null, netIncome: null, ebit: null, ebitda: null, fcf: x.g('fcf'), dividendPerShare: null }, x.c.sectorKind);
        return cell(m.find((k) => k.id === 'fcf_yield')?.value ?? null, pct, `Precio ${x.c.price} a ${x.c.priceAsOf ?? 's/f'} · FCL ${x.last ?? ''}`);
      }),
    },
  ];
}
