import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Landmark, Loader2, RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { errorMessage, ib, showToast, updateSettings, useNotesRevision, useSettings } from '../lib/ib';
import type { Company, FilingRow, SecSyncResult } from '../../shared/types';
import { metricDef } from '../../shared/finance';
import { relativeDate } from './research';

/** Explicit consent: nothing is sent to the SEC until the user declares a contact here. */
export function SecContactForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const settings = useSettings();
  const [contact, setContact] = useState(settings.secContact);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await updateSettings({ secContact: contact.trim() });
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className={`sec-consent ${compact ? 'compact' : ''}`} data-testid="sec-consent">
      {!compact && (
        <p className="small">
          <ShieldCheck size={13} /> La SEC exige que las herramientas automáticas se identifiquen con un <strong>nombre y un correo</strong>. Solo se enviará a <code>sec.gov</code> y <code>data.sec.gov</code>, junto con
          las consultas que pidas (ticker o CIK). Nada más sale de tu equipo.
        </p>
      )}
      <div className="sec-consent-row">
        <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Ana Pérez ana@ejemplo.com" data-testid="sec-contact" />
        <button className="btn btn-primary" onClick={() => void save()} disabled={!contact.trim()} data-testid="sec-contact-save">
          Guardar contacto
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function SecCard({ company }: { company: Company }) {
  const settings = useSettings();
  const contactOk = /\S+\s+\S+@\S+\.\S+/.test(settings.secContact.trim());
  const [query, setQuery] = useState(company.ticker ?? '');
  const [results, setResults] = useState<{ cik: number; ticker: string; title: string }[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'link' | 'sync' | null>(null);
  const [last, setLast] = useState<SecSyncResult | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setBusy('search');
    try {
      setResults(await ib.invoke('sec:searchTicker', { query }));
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const link = async (cik: number) => {
    setBusy('link');
    try {
      await ib.invoke('sec:link', { companyId: company.id, cik });
      setResults(null);
      await sync(false);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const sync = async (force: boolean) => {
    setBusy('sync');
    try {
      const r = await ib.invoke('sec:sync', { companyId: company.id, force });
      setLast(r);
      showToast(
        r.stale
          ? `Sin conexión con la SEC: se muestran datos guardados del ${new Date(r.fetchedAt).toLocaleDateString('es-ES')}`
          : `SEC: ${r.facts} cifras de ${r.periods.length} ejercicios${r.restated ? ` · ${r.restated} re-expresadas` : ''}`,
        r.stale ? 'error' : 'info',
      );
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card sec-card" data-testid="sec-card">
      <div className="card-head">
        <h2>
          <Landmark size={14} /> Datos oficiales · SEC EDGAR
        </h2>
        {company.cik && contactOk && (
          <button className="btn btn-sm" onClick={() => void sync(true)} disabled={busy !== null} data-testid="sec-sync">
            {busy === 'sync' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {company.secSyncedAt ? 'Actualizar' : 'Importar cifras'}
          </button>
        )}
      </div>

      {!contactOk ? (
        <SecContactForm />
      ) : !company.cik ? (
        <div className="sec-link">
          <p className="muted small">Busca la empresa en el registro de la SEC (emisores de EE. UU. y extranjeros con 20-F/40-F).</p>
          <div className="sec-consent-row">
            <input className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Ticker o nombre" data-testid="sec-query" />
            <button className="btn" onClick={() => void search()} disabled={busy !== null} data-testid="sec-search">
              {busy === 'search' ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Buscar
            </button>
          </div>
          {results && results.length === 0 && <p className="muted small">Sin resultados en la SEC. Puede que no cotice en EE. UU.</p>}
          {results && results.length > 0 && (
            <ul className="sec-results">
              {results.map((r) => (
                <li key={r.cik}>
                  <button className="side-link" onClick={() => void link(r.cik)} disabled={busy !== null} data-testid="sec-result">
                    <span className="mono strong">{r.ticker}</span>
                    <span className="ellipsis">{r.title}</span>
                    <span className="muted small mono">CIK {r.cik}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="sec-info">
          <dl className="sec-facts">
            <dt>Registro</dt>
            <dd>
              {company.secName ?? '—'} · <span className="mono">CIK {company.cik}</span>
            </dd>
            <dt>Cierre fiscal</dt>
            <dd>{company.fiscalYearEnd ? `${company.fiscalYearEnd.slice(2)}/${company.fiscalYearEnd.slice(0, 2)}` : '—'}</dd>
            <dt>Última importación</dt>
            <dd data-testid="sec-synced">{company.secSyncedAt ? `${relativeDate(company.secSyncedAt)} · ${company.secTaxonomy ?? ''}` : 'Nunca'}</dd>
          </dl>
          {last && last.missing.length > 0 && (
            <p className="hint">
              <TriangleAlert size={12} /> Sin dato en XBRL: {last.missing.map((m) => metricDef(m).short).join(', ')}. Se dejan vacíos (nunca a cero); puedes añadirlos desde el informe.
            </p>
          )}
          {last && last.missing.length === 0 && (
            <p className="hint ok">
              <CheckCircle2 size={12} /> Todas las métricas encontradas.
            </p>
          )}
          <p className="hint">Cifras anuales tal como constan en XBRL (10-K, 20-F, 40-F), etiquetadas por el año natural en que termina el ejercicio. Pasa el ratón por una cifra para ver concepto y documento.</p>
        </div>
      )}
    </section>
  );
}

const FORM_GROUPS: { id: string; label: string; match: (f: string) => boolean }[] = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'annual', label: 'Anuales', match: (f) => /^(10-K|20-F|40-F)/.test(f) },
  { id: 'quarterly', label: 'Trimestrales', match: (f) => /^(10-Q|6-K)/.test(f) },
  { id: 'current', label: '8-K', match: (f) => f.startsWith('8-K') },
  { id: 'insiders', label: 'Insiders', match: (f) => /^(3|4|5)(\/A)?$/.test(f) },
  { id: 'proxy', label: 'Junta', match: (f) => /^(DEF 14A|DEFA14A|PRE 14A)/.test(f) },
];

export function FilingsCard({ company }: { company: Company }) {
  const rev = useNotesRevision();
  const [rows, setRows] = useState<FilingRow[]>([]);
  const [group, setGroup] = useState('annual');
  useEffect(() => {
    let alive = true;
    void ib.invoke('sec:filings', { companyId: company.id }).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [company.id, rev, company.cik]);
  if (!company.cik || rows.length === 0) return null;
  const g = FORM_GROUPS.find((x) => x.id === group)!;
  const shown = rows.filter((r) => g.match(r.form)).slice(0, 12);
  return (
    <section className="card" data-testid="filings-card">
      <div className="card-head">
        <h2>Presentaciones en la SEC</h2>
        <div className="chip-filter">
          {FORM_GROUPS.map((x) => (
            <button key={x.id} className={group === x.id ? 'is-on' : ''} onClick={() => setGroup(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">Ninguna de este tipo entre las recientes.</p>
      ) : (
        <ul className="filings">
          {shown.map((f) => (
            <li key={f.accn}>
              <button
                className="filing-row"
                onClick={(e) => void ib.invoke('tabs:create', { url: f.url, companyId: company.id, active: !(e.ctrlKey || e.metaKey) })}
                title={`${f.url}\nRegistro ${f.accn}`}
                data-testid="filing-row"
              >
                <span className="form-badge mono">{f.form}</span>
                <span className="ellipsis">{f.description && f.description !== f.form ? f.description : formLabel(f.form)}</span>
                <span className="muted small mono">{f.reportDate ? `periodo ${f.reportDate}` : ''}</span>
                <span className="mono small">{f.filingDate}</span>
                <ArrowUpRight size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formLabel(form: string): string {
  if (form.startsWith('10-K')) return 'Informe anual';
  if (form.startsWith('10-Q')) return 'Informe trimestral';
  if (form.startsWith('8-K')) return 'Hecho relevante';
  if (form.startsWith('20-F')) return 'Informe anual (emisor extranjero)';
  if (/^4(\/A)?$/.test(form)) return 'Operación de insider';
  if (form.startsWith('DEF 14A')) return 'Convocatoria de junta (proxy)';
  return form;
}
