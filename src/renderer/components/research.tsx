/** Small building blocks shared by the research views. */
import { useState } from 'react';
import { CircleDot, Calculator, PencilLine, CircleHelp, Quote, Flag } from 'lucide-react';
import type { Company, NoteKind } from '../../shared/types';
import { SECTOR_KINDS } from '../../shared/types';
import { errorMessage, ib } from '../lib/ib';

export function TickerChip({ company, size = 'md' }: { company: Pick<Company, 'ticker' | 'name' | 'color'>; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`ticker-chip ticker-${size}`} style={{ ['--chip' as string]: company.color }} title={company.name}>
      {company.ticker ?? company.name.slice(0, 4).toUpperCase()}
    </span>
  );
}

export function OriginBadge({ origin, title }: { origin: 'published' | 'calculated' | 'user' | 'estimate' | null; title?: string }) {
  if (!origin) return null;
  const label = { published: 'Publicado', calculated: 'Cálculo propio', user: 'Introducido por ti', estimate: 'Estimación' }[origin];
  return (
    <span className={`origin origin-${origin}`} title={title ?? label}>
      {label}
    </span>
  );
}

export const KIND_ICON: Record<NoteKind, typeof Quote> = {
  snippet: Quote,
  figure: Calculator,
  note: PencilLine,
  conclusion: Flag,
  question: CircleHelp,
};
export { CircleDot };

const SECTOR_LABEL: Record<(typeof SECTOR_KINDS)[number], string> = {
  general: 'General (industrial, tecnología, consumo…)',
  bank: 'Banco',
  insurer: 'Aseguradora',
  reit: 'REIT / SOCIMI',
};

/** Create or edit a company. All validation is repeated in main. */
export function CompanyForm({ initial, onDone, onCancel }: { initial?: Partial<Company>; onDone: (c: Company) => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? '',
    ticker: initial?.ticker ?? '',
    exchange: initial?.exchange ?? '',
    country: initial?.country ?? '',
    sector: initial?.sector ?? '',
    sectorKind: initial?.sectorKind ?? 'general',
    irUrl: initial?.irUrl ?? '',
    cik: initial?.cik ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await ib.invoke('companies:save', {
        ...(initial?.id ? { id: initial.id } : {}),
        name: f.name,
        ticker: f.ticker.trim() || null,
        exchange: f.exchange,
        country: f.country,
        sector: f.sector,
        sectorKind: f.sectorKind as Company['sectorKind'],
        irUrl: f.irUrl.trim() ? (/^https?:\/\//i.test(f.irUrl.trim()) ? f.irUrl.trim() : `https://${f.irUrl.trim()}`) : null,
        cik: f.cik.trim() || null,
      });
      onDone(c);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="company-form" onSubmit={submit} data-testid="company-form">
      <div className="form-grid">
        <label className="field span-2">
          <span>Nombre *</span>
          <input className="input" value={f.name} onChange={set('name')} required autoFocus placeholder="Microsoft Corporation" data-testid="company-name" />
        </label>
        <label className="field">
          <span>Ticker</span>
          <input className="input mono" value={f.ticker} onChange={set('ticker')} placeholder="MSFT" maxLength={10} data-testid="company-ticker" />
        </label>
        <label className="field">
          <span>Bolsa</span>
          <input className="input mono" value={f.exchange} onChange={set('exchange')} placeholder="NASDAQ, BME, CPH…" />
        </label>
        <label className="field">
          <span>País</span>
          <input className="input" value={f.country} onChange={set('country')} placeholder="EE. UU." />
        </label>
        <label className="field">
          <span>Sector</span>
          <input className="input" value={f.sector} onChange={set('sector')} placeholder="Software" />
        </label>
        <label className="field span-2">
          <span>Tipo de negocio (adapta los múltiplos)</span>
          <select className="select" value={f.sectorKind} onChange={set('sectorKind')}>
            {SECTOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {SECTOR_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>Web de relaciones con inversores</span>
          <input className="input" value={f.irUrl} onChange={set('irUrl')} placeholder="https://www.microsoft.com/investor" data-testid="company-ir" />
        </label>
        <label className="field span-2">
          <span>CIK de la SEC (opcional, solo emisores en EE. UU.)</span>
          <input className="input mono" value={f.cik} onChange={set('cik')} placeholder="789019" inputMode="numeric" />
        </label>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !f.name.trim()} data-testid="company-submit">
          {initial?.id ? 'Guardar cambios' : 'Crear empresa'}
        </button>
      </div>
    </form>
  );
}

export function relativeDate(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400e3);
  if (days < 1 && d.toDateString() === new Date().toDateString()) return `hoy ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 2) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
