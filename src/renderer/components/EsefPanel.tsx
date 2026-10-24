import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Globe2, Loader2, RefreshCw, Search, TriangleAlert, Unlink } from 'lucide-react';
import { errorMessage, ib, showToast, useNotesRevision, useSettings } from '../lib/ib';
import type { Company, EsefFilingRow, EsefSyncResult } from '../../shared/types';
import { metricDef } from '../../shared/finance';
import { countryOf, esefCoverageNote } from '../../shared/esef';
import { SecContactForm } from './SecPanel';
import { relativeDate } from './research';

/** European official annual reports (ESEF) via filings.xbrl.org. */
export function EsefCard({ company }: { company: Company }) {
  const settings = useSettings();
  const rev = useNotesRevision();
  const contactOk = /\S+\s+\S+@\S+\.\S+/.test(settings.secContact.trim());
  const [query, setQuery] = useState(company.name);
  const [results, setResults] = useState<{ lei: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'link' | 'sync' | 'unlink' | null>(null);
  const [last, setLast] = useState<EsefSyncResult | null>(null);
  const [filings, setFilings] = useState<EsefFilingRow[]>([]);
  const coverage = esefCoverageNote(countryOf(company));

  useEffect(() => {
    let alive = true;
    if (company.lei) void ib.invoke('esef:filings', { companyId: company.id }).then((r) => alive && setFilings(r));
    else setFilings([]);
    return () => {
      alive = false;
    };
  }, [company.id, company.lei, rev]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy('search');
    try {
      setResults(await ib.invoke('esef:search', { query }));
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const sync = async (force: boolean) => {
    setBusy('sync');
    try {
      const r = await ib.invoke('esef:sync', { companyId: company.id, force });
      setLast(r);
      showToast(
        r.stale
          ? `Sin conexión con filings.xbrl.org: datos guardados del ${new Date(r.fetchedAt).toLocaleDateString('es-ES')}`
          : `ESEF: ${r.facts} cifras de ${r.periods.length} ejercicios (${r.filings} informes)${r.restated ? ` · ${r.restated} re-expresadas` : ''}`,
        r.stale ? 'error' : 'info',
      );
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const link = async (r: { lei: string; name: string }) => {
    setBusy('link');
    try {
      await ib.invoke('esef:link', { companyId: company.id, lei: r.lei, name: r.name });
      setResults(null);
    } catch (err) {
      showToast(errorMessage(err), 'error');
      setBusy(null);
      return;
    }
    await sync(false);
  };
  const unlink = async () => {
    setBusy('unlink');
    try {
      await ib.invoke('esef:unlink', { companyId: company.id });
      setLast(null);
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const used = filings.filter((f) => f.used);
  return (
    <section className="card sec-card" data-testid="esef-card">
      <div className="card-head">
        <h2>
          <Globe2 size={14} /> Datos oficiales · Europa (ESEF)
        </h2>
        {company.lei && contactOk && (
          <button className="btn btn-sm" onClick={() => void sync(true)} disabled={busy !== null} data-testid="esef-sync">
            {busy === 'sync' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {company.esefSyncedAt ? 'Actualizar' : 'Importar cifras'}
          </button>
        )}
      </div>

      {coverage && !company.lei && (
        <p className="hint" data-testid="esef-coverage">
          <TriangleAlert size={12} /> {coverage}
        </p>
      )}

      {!contactOk ? (
        <SecContactForm />
      ) : !company.lei ? (
        <div className="sec-link">
          <p className="muted small">
            Cuentas anuales oficiales en formato ESEF de cotizadas de la UE y Reino Unido (España, Francia, Italia, Países Bajos, Dinamarca…), desde el repositorio público de XBRL International. Busca por nombre o pega el
            LEI.
          </p>
          <div className="sec-consent-row">
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="Nombre de la sociedad o LEI"
              data-testid="esef-query"
            />
            <button className="btn" onClick={() => void search()} disabled={busy !== null} data-testid="esef-search">
              {busy === 'search' ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Buscar
            </button>
          </div>
          {results && results.length === 0 && <p className="muted small">Sin resultados. Prueba con la razón social (p. ej. «Industria de Diseño Textil») o con el LEI.</p>}
          {results && results.length > 0 && (
            <ul className="sec-results">
              {results.map((r) => (
                <li key={r.lei}>
                  <button className="side-link" onClick={() => void link(r)} disabled={busy !== null} data-testid="esef-result">
                    <span className="ellipsis strong">{r.name}</span>
                    <span className="muted small mono">LEI {r.lei}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="sec-info">
          <dl className="sec-facts">
            <dt>Entidad</dt>
            <dd>
              {company.esefName ?? '—'} · <span className="mono small">LEI {company.lei}</span>
            </dd>
            <dt>Última importación</dt>
            <dd data-testid="esef-synced">{company.esefSyncedAt ? relativeDate(company.esefSyncedAt) : 'Nunca'}</dd>
          </dl>
          {last && last.missing.length > 0 && (
            <p className="hint">
              <TriangleAlert size={12} /> Sin dato en el informe: {last.missing.map((m) => metricDef(m).short).join(', ')}. Se dejan vacíos (nunca a cero).
            </p>
          )}
          {last && last.missing.length === 0 && (
            <p className="hint ok">
              <CheckCircle2 size={12} /> Todas las métricas encontradas.
            </p>
          )}
          {used.length > 0 && (
            <ul className="filings" data-testid="esef-filings">
              {used.map((f) => (
                <li key={f.fxoId}>
                  <button
                    className="filing-row"
                    disabled={!f.viewerUrl}
                    onClick={(e) => f.viewerUrl && void ib.invoke('tabs:create', { url: f.viewerUrl, companyId: company.id, active: !(e.ctrlKey || e.metaKey) })}
                    title={`${f.viewerUrl ?? ''}\n${f.fxoId}`}
                  >
                    <span className="form-badge mono">ESEF</span>
                    <span className="ellipsis">Informe anual {f.periodEnd.slice(0, 4)}</span>
                    <span className="muted small mono">{f.published ? `publ. ${f.published}` : `cierre ${f.periodEnd}`}</span>
                    <ArrowUpRight size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Cifras anuales consolidadas (sin desgloses por segmento) tal como constan en el informe ESEF; se abren en el visor oficial. filings.xbrl.org incorpora los informes con cierto retraso respecto a su
            publicación: la fecha de cada uno está arriba.
          </p>
          <button className="btn btn-sm btn-ghost" onClick={() => void unlink()} disabled={busy !== null} data-testid="esef-unlink">
            <Unlink size={12} /> Desvincular
          </button>
        </div>
      )}
    </section>
  );
}
