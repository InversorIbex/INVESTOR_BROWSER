/**
 * Phase 4 analysis: Quality Compounder Analyzer and Financial Forensics.
 *
 * Design rules (product spec):
 *  - No opaque score. Every verdict exposes value, threshold, formula, periods and inputs.
 *  - Business quality is reported separately from valuation.
 *  - A forensic signal is a reason to read the notes, never an accusation of fraud.
 *  - Missing data → "no evaluable", never a pass or a fail.
 */
import type { FigureTable, MetricId, ResolvedValue } from './finance';
import { periodSortKey } from './finance';
import type { SectorKind } from './valuation';

export type Verdict = 'strong' | 'ok' | 'weak' | 'na';

export interface Criterion {
  id: string;
  title: string;
  verdict: Verdict;
  /** Main value shown, already formatted for humans (e.g. "12,4 %"). */
  display: string;
  value: number | null;
  rule: string; // thresholds in plain words
  formula: string;
  periods: string[];
  /** Raw inputs used, period → metric → value, for auditability. */
  inputs: { period: string; metric: MetricId; value: number; origin: ResolvedValue['origin'] }[];
  note?: string;
  reason?: string; // why it is 'na'
}

const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const times = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })}×`);
const pp = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} p.p.`;

/** Annual periods in chronological order (FY only: quarters would distort growth). */
export function annualPeriods(table: FigureTable): string[] {
  return [...table.keys()].filter((p) => /^FY\d{4}$/.test(p)).sort((a, b) => periodSortKey(a) - periodSortKey(b));
}

function get(table: FigureTable, period: string, metric: MetricId): ResolvedValue | undefined {
  return table.get(period)?.get(metric);
}

function series(table: FigureTable, periods: string[], metric: MetricId): { period: string; v: ResolvedValue }[] {
  return periods.flatMap((p) => {
    const v = get(table, p, metric);
    return v ? [{ period: p, v }] : [];
  });
}

function input(period: string, metric: MetricId, v: ResolvedValue) {
  return { period, metric, value: v.value, origin: v.origin };
}

export function cagr(first: number, last: number, years: number): number | null {
  if (years <= 0 || first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / years) - 1;
}

function grade(value: number | null, strong: (v: number) => boolean, ok: (v: number) => boolean): Verdict {
  if (value === null || !Number.isFinite(value)) return 'na';
  return strong(value) ? 'strong' : ok(value) ? 'ok' : 'weak';
}

function na(id: string, title: string, rule: string, formula: string, reason: string): Criterion {
  return { id, title, verdict: 'na', display: '—', value: null, rule, formula, periods: [], inputs: [], reason };
}

const yearsBetween = (a: string, b: string) => Number(b.slice(2)) - Number(a.slice(2));

// ---------------------------------------------------------------- ROIC

export interface RoicPoint {
  period: string;
  roic: number | null;
  taxRate: number | null;
  investedCapital: number | null;
  nopat: number | null;
  reason?: string;
}

/**
 * ROIC = NOPAT / capital invertido medio.
 *   NOPAT = beneficio operativo × (1 − tipo efectivo); tipo efectivo = impuesto / BAI, solo si está entre 0 % y 50 %.
 *   Capital invertido = patrimonio neto + deuda bruta − caja (media de inicio y fin si hay ambos).
 * Without a reliable tax rate or with negative invested capital the value is not computed.
 */
export function roicSeries(table: FigureTable): RoicPoint[] {
  const periods = annualPeriods(table);
  const ic = (p: string): number | null => {
    const e = get(table, p, 'equity');
    const d = get(table, p, 'gross_debt');
    const c = get(table, p, 'cash');
    if (!e || !d || !c) return null;
    return e.value + d.value - c.value;
  };
  return periods.map((p, i) => {
    const op = get(table, p, 'operating_income') ?? get(table, p, 'ebit');
    const tax = get(table, p, 'income_tax');
    const pre = get(table, p, 'pretax_income');
    if (!op) return { period: p, roic: null, taxRate: null, investedCapital: null, nopat: null, reason: 'Falta el beneficio operativo' };
    const rate = tax && pre && pre.value > 0 ? tax.value / pre.value : null;
    if (rate === null || rate < 0 || rate > 0.5)
      return { period: p, roic: null, taxRate: rate, investedCapital: null, nopat: null, reason: 'Tipo impositivo efectivo no disponible o anómalo' };
    const end = ic(p);
    const start = i > 0 ? ic(periods[i - 1]!) : null;
    const capital = end !== null && start !== null ? (end + start) / 2 : end;
    if (capital === null) return { period: p, roic: null, taxRate: rate, investedCapital: null, nopat: null, reason: 'Falta patrimonio, deuda o caja' };
    if (capital <= 0) return { period: p, roic: null, taxRate: rate, investedCapital: capital, nopat: null, reason: 'Capital invertido negativo o nulo: el ROIC no es interpretable' };
    const nopat = op.value * (1 - rate);
    return { period: p, roic: nopat / capital, taxRate: rate, investedCapital: capital, nopat };
  });
}

// ---------------------------------------------------------------- Quality Compounder

export interface QualityReport {
  criteria: Criterion[];
  strong: number;
  evaluable: number;
  years: string[];
  sectorWarning: string | null;
}

export function qualityReport(table: FigureTable, sector: SectorKind = 'general'): QualityReport {
  const periods = annualPeriods(table);
  const last = periods[periods.length - 1];
  const criteria: Criterion[] = [];
  const financial = sector === 'bank' || sector === 'insurer';

  // 1. Revenue growth
  {
    const s = series(table, periods, 'revenue');
    const id = 'growth';
    const title = 'Crecimiento de ingresos';
    const rule = 'Fuerte ≥ 8 % anual · Aceptable ≥ 3 %';
    const formula = 'Tasa anual compuesta (CAGR) entre el primer y el último ejercicio disponibles';
    if (s.length < 3) criteria.push(na(id, title, rule, formula, 'Se necesitan al menos 3 ejercicios de ingresos'));
    else {
      const first = s[0]!;
      const lastS = s[s.length - 1]!;
      const v = cagr(first.v.value, lastS.v.value, yearsBetween(first.period, lastS.period));
      criteria.push({
        id,
        title,
        verdict: grade(v, (x) => x >= 0.08, (x) => x >= 0.03),
        display: pct(v),
        value: v,
        rule,
        formula,
        periods: [first.period, lastS.period],
        inputs: [input(first.period, 'revenue', first.v), input(lastS.period, 'revenue', lastS.v)],
      });
    }
  }

  // 2. Operating margin level and trend
  {
    const id = 'margin';
    const title = 'Margen operativo';
    const rule = 'Fuerte ≥ 15 % y sin caer más de 2 p.p. · Aceptable ≥ 8 %';
    const formula = 'Beneficio operativo / Ingresos (último ejercicio); tendencia frente al primero';
    const m = periods.flatMap((p) => {
      const op = get(table, p, 'operating_income') ?? get(table, p, 'ebit');
      const rev = get(table, p, 'revenue');
      return op && rev && rev.value > 0 ? [{ p, v: op.value / rev.value, op, rev }] : [];
    });
    if (m.length < 2) criteria.push(na(id, title, rule, formula, 'Se necesitan al menos 2 ejercicios con ingresos y beneficio operativo'));
    else {
      const a = m[0]!;
      const b = m[m.length - 1]!;
      const trend = b.v - a.v;
      const verdict: Verdict = b.v >= 0.15 && trend > -0.02 ? 'strong' : b.v >= 0.08 ? 'ok' : 'weak';
      criteria.push({
        id,
        title,
        verdict,
        display: `${pct(b.v)} (${pp(trend)} desde ${a.p})`,
        value: b.v,
        rule,
        formula,
        periods: m.map((x) => x.p),
        inputs: m.flatMap((x) => [input(x.p, 'operating_income', x.op), input(x.p, 'revenue', x.rev)]),
      });
    }
  }

  // 3. FCF conversion
  if (financial) criteria.push(na('fcf_conversion', 'Conversión en flujo de caja libre', '', '', 'No aplicable a bancos ni aseguradoras'));
  else {
    const id = 'fcf_conversion';
    const title = 'Conversión en flujo de caja libre';
    const rule = 'Fuerte ≥ 90 % · Aceptable ≥ 70 % (suma de todos los ejercicios)';
    const formula = 'Σ FCL / Σ Beneficio neto, con años de beneficio positivo';
    const rows = periods.flatMap((p) => {
      const f = get(table, p, 'fcf');
      const n = get(table, p, 'net_income');
      return f && n && n.value > 0 ? [{ p, f, n }] : [];
    });
    if (rows.length < 2) criteria.push(na(id, title, rule, formula, 'Se necesitan al menos 2 ejercicios con FCL y beneficio positivo'));
    else {
      const v = rows.reduce((s, r) => s + r.f.value, 0) / rows.reduce((s, r) => s + r.n.value, 0);
      criteria.push({
        id,
        title,
        verdict: grade(v, (x) => x >= 0.9, (x) => x >= 0.7),
        display: pct(v, 0),
        value: v,
        rule,
        formula,
        periods: rows.map((r) => r.p),
        inputs: rows.flatMap((r) => [input(r.p, 'fcf', r.f), input(r.p, 'net_income', r.n)]),
      });
    }
  }

  // 4. ROIC
  if (financial) criteria.push(na('roic', 'Rentabilidad sobre el capital invertido (ROIC)', '', '', 'No aplicable a bancos ni aseguradoras: usa ROE y valor contable tangible'));
  else {
    const id = 'roic';
    const title = 'Rentabilidad sobre el capital invertido (ROIC)';
    const rule = 'Fuerte ≥ 15 % · Aceptable ≥ 10 % (media de los ejercicios calculables)';
    const formula = 'NOPAT / capital invertido medio · NOPAT = B. operativo × (1 − impuesto/BAI) · Capital = patrimonio + deuda − caja';
    const pts = roicSeries(table).filter((x) => x.roic !== null);
    if (!pts.length) {
      const why = roicSeries(table).at(-1)?.reason ?? 'Faltan datos';
      criteria.push(na(id, title, rule, formula, why));
    } else {
      const avg = pts.reduce((s, x) => s + x.roic!, 0) / pts.length;
      criteria.push({
        id,
        title,
        verdict: grade(avg, (x) => x >= 0.15, (x) => x >= 0.1),
        display: `${pct(avg)} medio · ${pct(pts.at(-1)!.roic)} en ${pts.at(-1)!.period}`,
        value: avg,
        rule,
        formula,
        periods: pts.map((x) => x.period),
        inputs: [],
        note: 'No ajusta fondo de comercio, arrendamientos ni partidas no recurrentes. El fondo de comercio de adquisiciones puede reducir el ROIC aparente.',
      });
    }
  }

  // 5. Leverage
  if (financial) criteria.push(na('leverage', 'Endeudamiento', '', '', 'No aplicable a bancos ni aseguradoras'));
  else {
    const id = 'leverage';
    const title = 'Endeudamiento';
    const rule = 'Fuerte: caja neta o ≤ 1× · Aceptable ≤ 3× · Débil > 3× o beneficio operativo negativo';
    const formula = 'Deuda neta / Beneficio operativo del último ejercicio';
    const nd = last ? get(table, last, 'net_debt') : undefined;
    const op = last ? (get(table, last, 'operating_income') ?? get(table, last, 'ebit')) : undefined;
    if (!last || !nd || !op) criteria.push(na(id, title, rule, formula, 'Falta deuda, caja o beneficio operativo del último ejercicio'));
    else {
      const v = op.value > 0 ? nd.value / op.value : null;
      const verdict: Verdict = nd.value <= 0 ? 'strong' : v === null ? 'weak' : v <= 1 ? 'strong' : v <= 3 ? 'ok' : 'weak';
      criteria.push({
        id,
        title,
        verdict,
        display: nd.value <= 0 ? 'Caja neta' : v === null ? 'B. operativo negativo' : times(v),
        value: v,
        rule,
        formula,
        periods: [last],
        inputs: [input(last, 'net_debt', nd), input(last, 'operating_income', op)],
        note: 'Deuda financiera según XBRL o tus cifras. No incluye arrendamientos operativos salvo que los añadas.',
      });
    }
  }

  // 6. Dilution
  {
    const id = 'dilution';
    const title = 'Dilución del accionista';
    const rule = 'Fuerte ≤ 0 % anual (recompras) · Aceptable ≤ 2 %';
    const formula = 'Variación anual compuesta de las acciones diluidas medias';
    const s = series(table, periods, 'diluted_shares');
    if (s.length < 2) criteria.push(na(id, title, rule, formula, 'Se necesitan al menos 2 ejercicios de acciones diluidas'));
    else {
      const a = s[0]!;
      const b = s[s.length - 1]!;
      const v = cagr(a.v.value, b.v.value, yearsBetween(a.period, b.period));
      criteria.push({
        id,
        title,
        verdict: grade(v, (x) => x <= 0, (x) => x <= 0.02),
        display: pct(v),
        value: v,
        rule,
        formula,
        periods: [a.period, b.period],
        inputs: [input(a.period, 'diluted_shares', a.v), input(b.period, 'diluted_shares', b.v)],
      });
    }
  }

  // 7. Stability
  {
    const id = 'stability';
    const title = 'Estabilidad del negocio';
    const rule = 'Fuerte: ningún año de caída de ingresos y margen estable (desv. ≤ 3 p.p.) · Aceptable: como mucho 1 caída';
    const formula = 'Años con ingresos inferiores al anterior · desviación típica del margen operativo';
    const s = series(table, periods, 'revenue');
    const margins = periods.flatMap((p) => {
      const op = get(table, p, 'operating_income') ?? get(table, p, 'ebit');
      const rev = get(table, p, 'revenue');
      return op && rev && rev.value > 0 ? [op.value / rev.value] : [];
    });
    if (s.length < 3 || margins.length < 3) criteria.push(na(id, title, rule, formula, 'Se necesitan al menos 3 ejercicios'));
    else {
      const declines = s.slice(1).filter((x, i) => x.v.value < s[i]!.v.value).length;
      const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
      const sd = Math.sqrt(margins.reduce((a, b) => a + (b - mean) ** 2, 0) / margins.length);
      const verdict: Verdict = declines === 0 && sd <= 0.03 ? 'strong' : declines <= 1 ? 'ok' : 'weak';
      criteria.push({
        id,
        title,
        verdict,
        display: `${declines} caída(s) · desv. margen ${(sd * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} p.p.`,
        value: declines,
        rule,
        formula,
        periods: s.map((x) => x.period),
        inputs: [],
      });
    }
  }

  const evaluable = criteria.filter((c) => c.verdict !== 'na').length;
  return {
    criteria,
    strong: criteria.filter((c) => c.verdict === 'strong').length,
    evaluable,
    years: periods,
    sectorWarning: financial
      ? 'Bancos y aseguradoras: varios criterios no aplican. Analiza ROE, solvencia (CET1), calidad crediticia o ratio combinado en sus informes.'
      : sector === 'reit'
        ? 'REIT/SOCIMI: el beneficio está distorsionado por amortizaciones; complementa con FFO/AFFO.'
        : null,
  };
}

// ---------------------------------------------------------------- Financial Forensics

export type SignalStatus = 'triggered' | 'clear' | 'na';

export interface Signal {
  id: string;
  title: string;
  status: SignalStatus;
  detail: string;
  why: string;
  limitation: string;
  periods: string[];
}

export interface ForensicsReport {
  signals: Signal[];
  triggered: number;
  notCovered: { title: string; how: string }[];
}

function growth(a: number, b: number): number | null {
  return a > 0 ? b / a - 1 : null;
}

export function forensicsReport(table: FigureTable, restated: { period: string; metric: string }[] = []): ForensicsReport {
  const periods = annualPeriods(table);
  const L = periods.length;
  const p0 = periods[L - 2];
  const p1 = periods[L - 1];
  const v = (p: string | undefined, m: MetricId) => (p ? get(table, p, m)?.value : undefined);
  const signals: Signal[] = [];
  const add = (s: Signal) => signals.push(s);
  const naSig = (id: string, title: string, why: string, limitation: string, reason: string): Signal => ({ id, title, status: 'na', detail: reason, why, limitation, periods: [] });

  // 1. Profit up, cash down
  {
    const id = 'profit_vs_cash';
    const title = 'El beneficio sube mientras el flujo de caja operativo baja';
    const why = 'Un beneficio que no se convierte en caja puede deberse a ventas a crédito, capitalización de gastos o reconocimiento anticipado de ingresos.';
    const lim = 'Puede ser legítimo por pagos de impuestos, inversión en circulante de un negocio que crece o estacionalidad del cierre.';
    const n0 = v(p0, 'net_income');
    const n1 = v(p1, 'net_income');
    const c0 = v(p0, 'cfo');
    const c1 = v(p1, 'cfo');
    if ([n0, n1, c0, c1].some((x) => x === undefined)) add(naSig(id, title, why, lim, 'Faltan beneficio neto o flujo de caja operativo de los dos últimos ejercicios'));
    else {
      const hit = n1! > n0! && c1! < c0!;
      add({
        id,
        title,
        status: hit ? 'triggered' : 'clear',
        detail: `${p0}→${p1}: beneficio neto ${fmtChange(n0!, n1!)}, flujo de caja operativo ${fmtChange(c0!, c1!)}`,
        why,
        limitation: lim,
        periods: [p0!, p1!],
      });
    }
  }

  // 2. Persistent low cash conversion
  {
    const id = 'cash_conversion';
    const title = 'Conversión en caja persistentemente baja';
    const why = 'Si el flujo de caja operativo queda por debajo del beneficio año tras año, la calidad del beneficio merece revisión.';
    const lim = 'Negocios en fuerte crecimiento con mucho circulante pueden mostrarlo temporalmente.';
    const rows = periods.slice(-3).flatMap((p) => {
      const n = v(p, 'net_income');
      const c = v(p, 'cfo');
      return n !== undefined && c !== undefined && n > 0 ? [{ p, r: c / n }] : [];
    });
    if (rows.length < 2) add(naSig(id, title, why, lim, 'Se necesitan 2–3 ejercicios con beneficio positivo y flujo de caja operativo'));
    else {
      const low = rows.filter((x) => x.r < 0.8);
      add({
        id,
        title,
        status: low.length >= 2 ? 'triggered' : 'clear',
        detail: rows.map((x) => `${x.p}: ${times(x.r, 2)}`).join(' · ') + ' (FCO / beneficio neto; umbral 0,80× en 2 o más años)',
        why,
        limitation: lim,
        periods: rows.map((x) => x.p),
      });
    }
  }

  // 3. Accruals (Sloan)
  {
    const id = 'accruals';
    const title = 'Devengos elevados (ratio de Sloan)';
    const why = 'Una gran diferencia entre beneficio contable y caja, relativa al tamaño del balance, se ha asociado históricamente a beneficios menos persistentes.';
    const lim = 'Indicador estadístico, no prueba de nada. Adquisiciones grandes distorsionan el activo medio.';
    const n = v(p1, 'net_income');
    const c = v(p1, 'cfo');
    const a1 = v(p1, 'total_assets');
    const a0 = v(p0, 'total_assets');
    if (n === undefined || c === undefined || a1 === undefined) add(naSig(id, title, why, lim, 'Faltan beneficio, flujo de caja operativo o activo total del último ejercicio'));
    else {
      const avgA = a0 !== undefined ? (a0 + a1) / 2 : a1;
      const r = (n - c) / avgA;
      add({ id, title, status: r > 0.1 ? 'triggered' : 'clear', detail: `${p1}: (beneficio − FCO) / activo medio = ${pct(r)} (umbral 10 %)`, why, limitation: lim, periods: [p1!] });
    }
  }

  // 4–5. Working capital growing faster than revenue
  for (const [metric, id, title, extra] of [
    ['receivables', 'receivables', 'Las cuentas por cobrar crecen mucho más que las ventas', 'Puede indicar ventas con condiciones de cobro más laxas o ingresos reconocidos antes de tiempo.'],
    ['inventory', 'inventory', 'Los inventarios crecen mucho más que las ventas', 'Puede anticipar demanda más débil, obsolescencia o futuras rebajas de margen.'],
  ] as const) {
    const lim = 'Cambios de mezcla de clientes, adquisiciones o fechas de cierre pueden explicarlo. Compara con los días de cobro/inventario que explica la empresa.';
    const x0 = v(p0, metric);
    const x1 = v(p1, metric);
    const r0 = v(p0, 'revenue');
    const r1 = v(p1, 'revenue');
    if ([x0, x1, r0, r1].some((x) => x === undefined)) add(naSig(id, title, extra, lim, `Faltan ${metric === 'receivables' ? 'cuentas por cobrar' : 'inventarios'} o ingresos de los dos últimos ejercicios`));
    else {
      const gx = growth(x0!, x1!);
      const gr = growth(r0!, r1!);
      const gap = gx !== null && gr !== null ? gx - gr : null;
      add({
        id,
        title,
        status: gap !== null && gap > 0.1 ? 'triggered' : gap === null ? 'na' : 'clear',
        detail: `${p0}→${p1}: ${metric === 'receivables' ? 'cuentas por cobrar' : 'inventarios'} ${pct(gx)} frente a ingresos ${pct(gr)} (umbral: +10 p.p. de diferencia)`,
        why: extra,
        limitation: lim,
        periods: [p0!, p1!],
      });
    }
  }

  // 6. Debt increase
  {
    const id = 'debt';
    const title = 'Aumento relevante de la deuda';
    const why = 'Más deuda sin crecimiento equivalente del negocio aumenta el riesgo financiero.';
    const lim = 'Puede financiar una adquisición o recompras deliberadas; revisa el uso de los fondos.';
    const d0 = v(p0, 'gross_debt');
    const d1 = v(p1, 'gross_debt');
    const r0 = v(p0, 'revenue');
    const r1 = v(p1, 'revenue');
    if ([d0, d1, r0, r1].some((x) => x === undefined)) add(naSig(id, title, why, lim, 'Falta la deuda bruta de los dos últimos ejercicios'));
    else {
      const gd = growth(d0!, d1!);
      const gr = growth(r0!, r1!);
      const hit = gd !== null && gd > 0.25 && (gr === null || gd > gr + 0.1);
      add({ id, title, status: hit ? 'triggered' : 'clear', detail: `${p0}→${p1}: deuda ${pct(gd)} frente a ingresos ${pct(gr)} (umbral: +25 % y por encima de las ventas)`, why, limitation: lim, periods: [p0!, p1!] });
    }
  }

  // 7. Dilution
  {
    const id = 'dilution';
    const title = 'Dilución de los accionistas';
    const why = 'Emitir acciones reduce la parte del negocio que posee cada accionista.';
    const lim = 'Puede deberse a una adquisición pagada con acciones o a la conversión de deuda.';
    const s0 = v(p0, 'diluted_shares');
    const s1 = v(p1, 'diluted_shares');
    if (s0 === undefined || s1 === undefined) add(naSig(id, title, why, lim, 'Faltan acciones diluidas de los dos últimos ejercicios'));
    else {
      const g = growth(s0, s1);
      add({ id, title, status: g !== null && g > 0.03 ? 'triggered' : 'clear', detail: `${p0}→${p1}: acciones diluidas ${pct(g)} (umbral +3 %)`, why, limitation: lim, periods: [p0!, p1!] });
    }
  }

  // 8. Margin deterioration
  {
    const id = 'margins';
    const title = 'Deterioro del margen operativo';
    const why = 'Una caída sostenida del margen puede reflejar más competencia, menor poder de fijación de precios o costes al alza.';
    const lim = 'Inversiones deliberadas (I+D, expansión) o cambios contables de clasificación también lo producen.';
    const ps = periods.slice(-4);
    const m = ps.flatMap((p) => {
      const op = v(p, 'operating_income') ?? v(p, 'ebit');
      const rev = v(p, 'revenue');
      return op !== undefined && rev !== undefined && rev > 0 ? [{ p, m: op / rev }] : [];
    });
    if (m.length < 3) add(naSig(id, title, why, lim, 'Se necesitan 3 ejercicios con margen operativo'));
    else {
      const delta = m[m.length - 1]!.m - m[0]!.m;
      add({ id, title, status: delta <= -0.03 ? 'triggered' : 'clear', detail: `${m[0]!.p}→${m.at(-1)!.p}: ${pct(m[0]!.m)} → ${pct(m.at(-1)!.m)} (${pp(delta)}; umbral −3 p.p.)`, why, limitation: lim, periods: m.map((x) => x.p) });
    }
  }

  // 9. Stock-based compensation
  {
    const id = 'sbc';
    const title = 'Remuneración en acciones elevada';
    const why = 'El SBC es un coste real para el accionista aunque no consuma caja; inflar el FCL con él puede ser engañoso.';
    const lim = 'Habitual y razonable en tecnológicas jóvenes; compáralo con su dilución efectiva y recompras.';
    const sbc = v(p1, 'sbc');
    const rev = v(p1, 'revenue');
    const fcf = v(p1, 'fcf');
    if (sbc === undefined || rev === undefined) add(naSig(id, title, why, lim, 'Falta SBC o ingresos del último ejercicio'));
    else {
      const ofRev = rev > 0 ? sbc / rev : null;
      const ofFcf = fcf !== undefined && fcf > 0 ? sbc / fcf : null;
      const hit = (ofRev !== null && ofRev > 0.1) || (ofFcf !== null && ofFcf > 0.3);
      add({
        id,
        title,
        status: hit ? 'triggered' : 'clear',
        detail: `${p1}: SBC = ${pct(ofRev)} de los ingresos${ofFcf !== null ? ` y ${pct(ofFcf)} del FCL` : ''} (umbrales 10 % / 30 %)`,
        why,
        limitation: lim,
        periods: [p1!],
      });
    }
  }

  // 10. Restatements
  {
    const id = 'restatements';
    const title = 'Cifras re-expresadas en informes posteriores';
    const why = 'Cambiar cifras ya publicadas puede deberse a errores, cambios contables o reclasificaciones; conviene saber cuál.';
    const lim = 'Las reclasificaciones y operaciones discontinuadas son frecuentes y no implican irregularidades.';
    const list = restated.filter((r) => periods.includes(r.period));
    add({
      id,
      title,
      status: list.length ? 'triggered' : 'clear',
      detail: list.length ? `${list.length} cifra(s): ${list.map((r) => `${r.metric} ${r.period}`).join(', ')}` : 'Ninguna cifra cambió entre informes en los datos disponibles',
      why,
      limitation: `${lim} Solo se detecta en cifras importadas de la SEC.`,
      periods: [...new Set(list.map((r) => r.period))],
    });
  }

  return {
    signals,
    triggered: signals.filter((s) => s.status === 'triggered').length,
    notCovered: [
      { title: 'Cambios en políticas contables', how: 'No se puede detectar con XBRL. Revisa la nota «Summary of significant accounting policies» y «Recently adopted accounting pronouncements» del 10-K.' },
      { title: 'Dependencia de ajustes no recurrentes', how: 'Las métricas «ajustadas» no están en XBRL. Compara el beneficio ajustado del comunicado de resultados con el beneficio neto publicado año a año.' },
      { title: 'Opinión del auditor y debilidades de control', how: 'Revisa el informe del auditor y el apartado «Controls and Procedures» (Item 9A) del 10-K.' },
    ],
  };
}

function fmtChange(a: number, b: number): string {
  const g = a !== 0 ? b / Math.abs(a) - Math.sign(a) : null;
  return g === null ? 'sin referencia' : `${g >= 0 ? '+' : ''}${pct(g)}`;
}
