/**
 * Valuation maths. Pure functions, no I/O. Every output either has a value with
 * the formula used, or `null` with the reason it cannot be computed.
 */

export interface ValuationInputs {
  price: number | null; // per share
  shares: number | null; // diluted share count (units)
  grossDebt: number | null;
  cash: number | null;
  netIncome: number | null;
  ebit: number | null;
  ebitda: number | null;
  fcf: number | null;
  dividendPerShare: number | null;
}

export type SectorKind = 'general' | 'bank' | 'insurer' | 'reit';

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  kind: 'money' | 'multiple' | 'pct';
  formula: string;
  reason?: string;
  caveat?: string;
}

const has = (...v: (number | null)[]) => v.every((x) => x !== null && Number.isFinite(x));

export function marketCap(i: ValuationInputs): number | null {
  return has(i.price, i.shares) ? i.price! * i.shares! : null;
}

export function enterpriseValue(i: ValuationInputs): number | null {
  const mc = marketCap(i);
  return mc !== null && has(i.grossDebt, i.cash) ? mc + i.grossDebt! - i.cash! : null;
}

export function multiples(i: ValuationInputs, sector: SectorKind = 'general'): Metric[] {
  const mc = marketCap(i);
  const ev = enterpriseValue(i);
  const out: Metric[] = [];
  const missing = (what: string) => `Falta: ${what}`;

  out.push({ id: 'market_cap', label: 'Capitalización', kind: 'money', value: mc, formula: 'Precio × Acciones diluidas', reason: mc === null ? missing('precio y acciones') : undefined });
  out.push({
    id: 'ev',
    label: 'Valor empresa (EV)',
    kind: 'money',
    value: sector === 'bank' || sector === 'insurer' ? null : ev,
    formula: 'Capitalización + Deuda bruta − Caja',
    reason:
      sector === 'bank' || sector === 'insurer'
        ? 'No aplicable: en bancos y aseguradoras la deuda es materia prima del negocio.'
        : ev === null
          ? missing('capitalización, deuda y caja')
          : undefined,
  });

  const ratio = (num: number | null, den: number | null, positiveDen = true): { v: number | null; why?: string } => {
    if (num === null || den === null) return { v: null, why: 'Faltan datos' };
    if (den === 0 || (positiveDen && den < 0)) return { v: null, why: 'Denominador negativo o nulo: el múltiplo no tiene sentido' };
    return { v: num / den };
  };

  const per = ratio(mc, i.netIncome);
  out.push({ id: 'per', label: 'PER', kind: 'multiple', value: per.v, formula: 'Capitalización / Beneficio neto', reason: per.why, caveat: 'Sensible a partidas no recurrentes y a la estructura de capital.' });

  if (sector === 'general') {
    const evEbit = ratio(ev, i.ebit);
    out.push({ id: 'ev_ebit', label: 'EV/EBIT', kind: 'multiple', value: evEbit.v, formula: 'EV / EBIT', reason: evEbit.why, caveat: 'Compara empresas con distinta deuda mejor que el PER.' });
    const evEbitda = ratio(ev, i.ebitda);
    out.push({ id: 'ev_ebitda', label: 'EV/EBITDA', kind: 'multiple', value: evEbitda.v, formula: 'EV / EBITDA', reason: evEbitda.why, caveat: 'Ignora el CAPEX: engañoso en negocios intensivos en capital.' });
  }
  if (sector !== 'bank' && sector !== 'insurer') {
    const pfcf = ratio(mc, i.fcf);
    out.push({ id: 'p_fcf', label: 'Precio / FCL', kind: 'multiple', value: pfcf.v, formula: 'Capitalización / Flujo de caja libre', reason: pfcf.why });
    out.push({
      id: 'fcf_yield',
      label: 'Rentabilidad FCL',
      kind: 'pct',
      value: mc !== null && mc > 0 && i.fcf !== null ? i.fcf / mc : null,
      formula: 'Flujo de caja libre / Capitalización',
      reason: mc === null || i.fcf === null ? 'Faltan datos' : undefined,
    });
  }
  out.push({
    id: 'div_yield',
    label: 'Rentabilidad por dividendo',
    kind: 'pct',
    value: has(i.dividendPerShare, i.price) && i.price! > 0 ? i.dividendPerShare! / i.price! : null,
    formula: 'Dividendo por acción / Precio',
    reason: has(i.dividendPerShare, i.price) ? undefined : 'Faltan datos',
  });
  return out;
}

export function sectorWarning(sector: SectorKind): string | null {
  switch (sector) {
    case 'bank':
      return 'Bancos: EV, EV/EBIT, EV/EBITDA y el flujo de caja libre no son significativos. Usa PER, precio/valor contable tangible y ROE.';
    case 'insurer':
      return 'Aseguradoras: el flujo de caja y la deuda no se interpretan como en una industrial. Usa PER, precio/valor contable y ratio combinado.';
    case 'reit':
      return 'REITs/SOCIMIs: el beneficio neto está distorsionado por amortizaciones. Prefiere FFO/AFFO y descuento sobre NAV (introdúcelos como cifras propias).';
    default:
      return null;
  }
}

// ---------------------------------------------------------------- DCF

export interface DcfScenario {
  name: string;
  growth: number; // annual FCF growth during explicit years, e.g. 0.06
  terminalGrowth: number; // e.g. 0.02
  discountRate: number; // e.g. 0.09
}

export interface DcfInputs {
  fcf0: number; // last annual FCF (base units)
  years: number; // explicit projection years, 1..15
  netDebt: number; // gross debt − cash (negative = net cash)
  shares: number;
}

export interface DcfResult {
  ok: boolean;
  error?: string;
  projected: { year: number; fcf: number; pv: number }[];
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  terminalShare: number; // share of EV coming from the terminal value
}

export function dcf(inp: DcfInputs, s: DcfScenario): DcfResult {
  const empty: DcfResult = { ok: false, projected: [], terminalValue: 0, pvTerminal: 0, enterpriseValue: 0, equityValue: 0, perShare: 0, terminalShare: 0 };
  if (!(inp.fcf0 > 0)) return { ...empty, error: 'El DCF por flujos requiere un FCL base positivo.' };
  if (!(inp.shares > 0)) return { ...empty, error: 'Faltan las acciones diluidas.' };
  if (!(inp.years >= 1 && inp.years <= 15)) return { ...empty, error: 'Los años explícitos deben estar entre 1 y 15.' };
  if (s.discountRate <= s.terminalGrowth) return { ...empty, error: 'La tasa de descuento debe ser mayor que el crecimiento terminal.' };
  if (s.discountRate <= 0 || s.discountRate > 0.5) return { ...empty, error: 'Tasa de descuento fuera de rango (0–50 %).' };

  const projected: DcfResult['projected'] = [];
  let fcf = inp.fcf0;
  let pvSum = 0;
  for (let y = 1; y <= inp.years; y++) {
    fcf *= 1 + s.growth;
    const pv = fcf / (1 + s.discountRate) ** y;
    projected.push({ year: y, fcf, pv });
    pvSum += pv;
  }
  const terminalValue = (fcf * (1 + s.terminalGrowth)) / (s.discountRate - s.terminalGrowth);
  const pvTerminal = terminalValue / (1 + s.discountRate) ** inp.years;
  const enterpriseValue = pvSum + pvTerminal;
  const equityValue = enterpriseValue - inp.netDebt;
  return {
    ok: true,
    projected,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    perShare: equityValue / inp.shares,
    terminalShare: pvTerminal / enterpriseValue,
  };
}

/** Value per share for every (discount rate × growth) combination. */
export function sensitivity(inp: DcfInputs, base: DcfScenario, rates: number[], growths: number[]): (number | null)[][] {
  return rates.map((r) => growths.map((g) => {
    const res = dcf(inp, { ...base, discountRate: r, growth: g });
    return res.ok ? res.perShare : null;
  }));
}

export const DEFAULT_SCENARIOS: DcfScenario[] = [
  { name: 'Pesimista', growth: 0.02, terminalGrowth: 0.015, discountRate: 0.1 },
  { name: 'Base', growth: 0.06, terminalGrowth: 0.02, discountRate: 0.09 },
  { name: 'Optimista', growth: 0.1, terminalGrowth: 0.025, discountRate: 0.08 },
];
