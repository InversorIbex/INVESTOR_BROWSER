import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Flag, Info } from 'lucide-react';
import { errorMessage, ib, showToast, useCompanies } from '../lib/ib';
import { useCompanyFigures } from '../lib/figures';
import { TickerChip } from '../components/research';
import { buildFigureTable, formatMoney, formatMultiple, formatPct, periodSortKey, type MetricId } from '../../shared/finance';
import { dcf, DEFAULT_SCENARIOS, multiples, sectorWarning, sensitivity, type DcfScenario, type SectorKind, type ValuationInputs } from '../../shared/valuation';

type FieldKey = keyof ValuationInputs;
interface Field {
  key: FieldKey;
  label: string;
  unit: 'perShare' | 'millions';
  metric?: MetricId;
}
const FIELDS: Field[] = [
  { key: 'price', label: 'Precio por acción', unit: 'perShare' },
  { key: 'shares', label: 'Acciones diluidas', unit: 'millions', metric: 'diluted_shares' },
  { key: 'netIncome', label: 'Beneficio neto', unit: 'millions', metric: 'net_income' },
  { key: 'ebit', label: 'EBIT', unit: 'millions', metric: 'ebit' },
  { key: 'ebitda', label: 'EBITDA', unit: 'millions', metric: 'ebitda' },
  { key: 'fcf', label: 'Flujo de caja libre', unit: 'millions', metric: 'fcf' },
  { key: 'grossDebt', label: 'Deuda bruta', unit: 'millions', metric: 'gross_debt' },
  { key: 'cash', label: 'Caja', unit: 'millions', metric: 'cash' },
  { key: 'dividendPerShare', label: 'Dividendo por acción', unit: 'perShare', metric: 'dividend_per_share' },
];

/** Where each input came from — shown next to it so the result is auditable. */
interface Provenance {
  label: string;
  title?: string;
  kind: 'published' | 'calculated' | 'user' | 'estimate' | 'manual';
}

export function ValuationPage({ companyId }: { companyId: number | null }) {
  const companies = useCompanies();
  const [selected, setSelected] = useState<number | null>(companyId);
  const company = companies.find((c) => c.id === selected) ?? null;
  const [raw, setRaw] = useState<Record<FieldKey, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, ''])) as Record<FieldKey, string>);
  const [prov, setProv] = useState<Partial<Record<FieldKey, Provenance>>>({});
  const [sector, setSector] = useState<SectorKind>('general');
  const [currency, setCurrency] = useState('USD');
  const [years, setYears] = useState(5);
  const [scenarios, setScenarios] = useState<DcfScenario[]>(DEFAULT_SCENARIOS);
  const { figures } = useCompanyFigures(selected);

  useEffect(() => {
    if (company) setSector(company.sectorKind);
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useMemo(() => buildFigureTable(figures), [figures]);
  const latestFy = useMemo(() => [...table.keys()].filter((p) => p.startsWith('FY')).sort((a, b) => periodSortKey(b) - periodSortKey(a))[0] ?? null, [table]);

  const loadFromCompany = () => {
    if (!company) return;
    const nextRaw = { ...raw };
    const nextProv: Partial<Record<FieldKey, Provenance>> = {};
    const row = latestFy ? table.get(latestFy) : undefined;
    let loaded = 0;
    for (const f of FIELDS) {
      if (f.key === 'price') {
        if (company.price !== null) {
          nextRaw.price = String(company.price);
          nextProv.price = { kind: 'manual', label: `Manual · ${company.priceAsOf ?? 's/f'}`, title: company.priceSource ?? undefined };
          loaded++;
        }
        continue;
      }
      const v = f.metric ? row?.get(f.metric) : undefined;
      if (!v) continue;
      nextRaw[f.key] = String(f.unit === 'millions' ? +(v.value / 1e6).toFixed(4) : v.value);
      nextProv[f.key] = {
        kind: v.origin,
        label: `${latestFy} · ${v.provider === 'sec' ? 'SEC' : v.provider === 'esef' ? 'ESEF' : { published: 'publicado', calculated: 'cálculo', user: 'tuyo', estimate: 'estimación' }[v.origin]}`,
        title: v.origin === 'calculated' ? v.formula : (v.sources[0]?.url ?? undefined),
      };
      if (v.currency) setCurrency(v.currency);
      loaded++;
    }
    setRaw(nextRaw);
    setProv(nextProv);
    showToast(loaded ? `Cargadas ${loaded} cifras de ${company.ticker ?? company.name}${latestFy ? ' (' + latestFy + ')' : ''}` : 'Esta empresa aún no tiene cifras guardadas', loaded ? 'info' : 'error');
  };

  const num = (k: FieldKey): number | null => {
    const s = raw[k].trim().replace(/\s/g, '').replace(',', '.');
    if (!s) return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    const f = FIELDS.find((x) => x.key === k)!;
    return f.unit === 'millions' ? v * 1e6 : v;
  };
  const inputs: ValuationInputs = Object.fromEntries(FIELDS.map((f) => [f.key, num(f.key)])) as unknown as ValuationInputs;
  const mult = multiples(inputs, sector);
  const warning = sectorWarning(sector);
  const netDebt = inputs.grossDebt !== null && inputs.cash !== null ? inputs.grossDebt - inputs.cash : null;
  const dcfInputs = inputs.fcf !== null && inputs.shares !== null && netDebt !== null ? { fcf0: inputs.fcf, years, netDebt, shares: inputs.shares } : null;
  const results = dcfInputs ? scenarios.map((s) => ({ s, r: dcf(dcfInputs, s) })) : [];
  const base = scenarios[1]!;
  const rates = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => +(base.discountRate + d).toFixed(4));
  const growths = [-0.04, -0.02, 0, 0.02, 0.04].map((d) => +(base.growth + d).toFixed(4));
  const grid = dcfInputs ? sensitivity(dcfInputs, base, rates, growths) : null;

  const saveConclusion = async () => {
    if (!company || !results.length) return;
    const lines = results.map(({ s, r }) =>
      r.ok
        ? `${s.name}: ${r.perShare.toFixed(2)} ${currency}/acción (crec. ${formatPct(s.growth)}, terminal ${formatPct(s.terminalGrowth)}, descuento ${formatPct(s.discountRate)})`
        : `${s.name}: no calculable (${r.error})`,
    );
    const body = `Valoración DCF (${new Date().toLocaleDateString('es-ES')}), FCL base ${formatMoney(inputs.fcf, currency)}${inputs.price ? `, precio ${inputs.price} ${currency}` : ''}:\n${lines.join('\n')}\nSupuestos propios; no es una recomendación.`;
    try {
      await ib.invoke('notes:add', { companyId: company.id, kind: 'conclusion', body });
      showToast('Valoración guardada como conclusión');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  const setScenario = (i: number, key: 'growth' | 'terminalGrowth' | 'discountRate', pct: string) => {
    const v = Number(pct.replace(',', '.')) / 100;
    if (!Number.isFinite(v)) return;
    setScenarios((list) => list.map((s, j) => (j === i ? { ...s, [key]: v } : s)));
  };

  return (
    <div className="page valuation" data-testid="valuation-page">
      <header className="page-head">
        <h1>Laboratorio de valoración</h1>
        <div className="page-tools">
          <select className="select" value={selected ?? ''} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)} aria-label="Empresa" data-testid="valuation-company">
            <option value="">Sin empresa (cálculo libre)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ticker ? `${c.ticker} — ` : ''}
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!company} onClick={loadFromCompany} data-testid="load-figures">
            Cargar cifras guardadas
          </button>
        </div>
      </header>

      <p className="disclaimer">
        <Info size={13} /> Resultado de <strong>tus</strong> datos y supuestos. Cada dato muestra su origen. No es una recomendación de inversión.
      </p>

      <div className="val-grid">
        <section className="card">
          <div className="card-head">
            <h2>{company ? <TickerChip company={company} size="sm" /> : null} Datos</h2>
            <span className="muted small">
              Importes en millones de{' '}
              <input className="input input-xs mono inline-input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} aria-label="Moneda" />
            </span>
          </div>
          <div className="val-inputs">
            {FIELDS.map((f) => (
              <label key={f.key} className="val-field">
                <span className="val-label">
                  {f.label}
                  <span className="muted small">{f.unit === 'millions' ? ' (M)' : ` (${currency})`}</span>
                </span>
                <input
                  className="input mono num"
                  value={raw[f.key]}
                  inputMode="decimal"
                  data-testid={`val-${f.key}`}
                  onChange={(e) => {
                    setRaw({ ...raw, [f.key]: e.target.value });
                    setProv({ ...prov, [f.key]: { kind: 'user', label: 'Escrito a mano' } });
                  }}
                />
                {prov[f.key] && (
                  <span className={`origin origin-${prov[f.key]!.kind === 'manual' ? 'user' : prov[f.key]!.kind}`} title={prov[f.key]!.title}>
                    {prov[f.key]!.label}
                  </span>
                )}
              </label>
            ))}
            <label className="val-field">
              <span className="val-label">Tipo de negocio</span>
              <select className="select" value={sector} onChange={(e) => setSector(e.target.value as SectorKind)}>
                <option value="general">General</option>
                <option value="bank">Banco</option>
                <option value="insurer">Aseguradora</option>
                <option value="reit">REIT / SOCIMI</option>
              </select>
            </label>
          </div>
          {warning && (
            <p className="warn">
              <AlertTriangle size={13} /> {warning}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Múltiplos</h2>
          <table className="fin-table metrics-table" data-testid="multiples">
            <tbody>
              {mult.map((m) => (
                <tr key={m.id} data-id={m.id}>
                  <th title={m.formula}>{m.label}</th>
                  <td className="mono num">{m.kind === 'money' ? formatMoney(m.value, currency) : m.kind === 'pct' ? formatPct(m.value) : formatMultiple(m.value)}</td>
                  <td className="muted small">{m.value === null ? m.reason : m.caveat ?? m.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>DCF por flujos de caja libres</h2>
          <label className="muted small">
            Años explícitos{' '}
            <input className="input input-xs mono inline-input" type="number" min={1} max={15} value={years} onChange={(e) => setYears(Math.max(1, Math.min(15, Number(e.target.value) || 5)))} />
          </label>
        </div>
        {!dcfInputs ? (
          <p className="muted small">Necesita flujo de caja libre, acciones diluidas, deuda bruta y caja.</p>
        ) : (
          <>
            <div className="scenarios">
              {results.map(({ s, r }, i) => {
                const upside = r.ok && inputs.price ? r.perShare / inputs.price - 1 : null;
                return (
                  <div key={s.name} className={`scenario sc-${i}`} data-testid="scenario">
                    <div className="sc-name">{s.name}</div>
                    <div className="sc-inputs">
                      {(['growth', 'terminalGrowth', 'discountRate'] as const).map((k) => (
                        <label key={k}>
                          <span>{{ growth: `Crec. años 1–${years}`, terminalGrowth: 'Crec. terminal', discountRate: 'Tasa descuento' }[k]}</span>
                          <span className="pct-input">
                            <input className="input mono num" defaultValue={(s[k] * 100).toFixed(1)} onBlur={(e) => setScenario(i, k, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setScenario(i, k, e.currentTarget.value)} />%
                          </span>
                        </label>
                      ))}
                    </div>
                    {r.ok ? (
                      <>
                        <div className="sc-value mono" data-testid="scenario-value">
                          {r.perShare.toLocaleString('es-ES', { maximumFractionDigits: 2 })} <span className="kpi-unit">{currency}/acción</span>
                        </div>
                        {upside !== null && <div className={`sc-upside mono ${upside >= 0 ? 'pos' : 'neg-num'}`}>{upside >= 0 ? '+' : ''}{formatPct(upside)} vs. precio</div>}
                        <div className={`sc-tv ${r.terminalShare > 0.75 ? 'warn-text' : 'muted'}`} title="Parte del valor que procede del valor terminal">
                          Valor terminal: {formatPct(r.terminalShare, 0)} del total{r.terminalShare > 0.75 ? ' — muy dependiente del largo plazo' : ''}
                        </div>
                      </>
                    ) : (
                      <div className="warn small">{r.error}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {grid && (
              <div className="sens">
                <div className="side-label">Sensibilidad del escenario base · valor por acción ({currency})</div>
                <table className="fin-table sens-table" data-testid="sensitivity">
                  <thead>
                    <tr>
                      <th>Descuento ↓ / Crec. →</th>
                      {growths.map((g) => (
                        <th key={g} className="mono">
                          {formatPct(g)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r, i) => (
                      <tr key={r}>
                        <th className="mono">{formatPct(r)}</th>
                        {grid[i]!.map((v, j) => {
                          const rel = v !== null && inputs.price ? v / inputs.price - 1 : null;
                          const cls = rel === null ? '' : rel > 0.2 ? 'heat-pos2' : rel > 0 ? 'heat-pos1' : rel > -0.2 ? 'heat-neg1' : 'heat-neg2';
                          return (
                            <td key={j} className={`mono num ${cls} ${i === 2 && j === 2 ? 'is-base' : ''}`}>
                              {v === null ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: 1 })}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {inputs.price && <p className="muted small">Colores: verde = por encima del precio introducido; rojo = por debajo.</p>}
              </div>
            )}
            <div className="form-actions">
              <button className="btn" disabled={!company} onClick={() => void saveConclusion()} data-testid="save-valuation">
                <Flag size={13} /> Guardar como conclusión en {company?.ticker ?? 'la empresa'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
