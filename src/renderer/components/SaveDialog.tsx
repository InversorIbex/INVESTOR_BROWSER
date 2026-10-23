import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Link2, Plus, X } from 'lucide-react';
import { errorMessage, ib, openSaveDialog, showToast, useCompanies, useOverlay } from '../lib/ib';
import { CompanyForm, KIND_ICON, TickerChip } from './research';
import { NOTE_KINDS, NOTE_KIND_LABEL, type NoteKind, type SaveDraft } from '../../shared/types';
import { CURRENCIES, METRICS, normalizePeriod, parseFigure, SCALE_LABEL, SCALES, type MetricId, type Scale } from '../../shared/finance';
import { displayUrl } from '../../shared/url';

/**
 * "Save to research". The quote and source come from the main process
 * (context menu parameters or an isolated-world read of the selection),
 * are shown as plain text and can be edited before saving.
 */
export function SaveDialog({ draft }: { draft: SaveDraft }) {
  useOverlay(true);
  const companies = useCompanies();
  const parsed = useMemo(() => (draft.text ? parseFigure(draft.text) : null), [draft.text]);
  const [companyId, setCompanyId] = useState<number | null>(draft.companyId ?? companies[0]?.id ?? null);
  const [creating, setCreating] = useState(companies.length === 0);
  const [kind, setKind] = useState<NoteKind>(draft.kind ?? (draft.text ? 'snippet' : 'note'));
  const [quote, setQuote] = useState(draft.text);
  const [body, setBody] = useState('');
  const [metric, setMetric] = useState<MetricId>('revenue');
  const [period, setPeriod] = useState(`FY${new Date().getFullYear() - 1}`);
  const [value, setValue] = useState(parsed ? String(parsed.value) : '');
  const [scale, setScale] = useState<Scale>(parsed?.scale ?? 'millions');
  const [currency, setCurrency] = useState<string>(parsed?.currency ?? 'USD');
  const [estimate, setEstimate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => openSaveDialog(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Esc closes from anywhere, even before focus has moved into the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        openSaveDialog(null);
      }
    };
    window.addEventListener('keydown', onKey);
    if (!creating) setTimeout(() => bodyRef.current?.focus(), 0);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const periodOk = normalizePeriod(period) !== null;
  const numeric = Number(value.replace(',', '.'));
  const canSave = companyId !== null && (kind !== 'figure' || (value.trim() !== '' && Number.isFinite(numeric) && periodOk)) && (kind === 'figure' || quote.trim() || body.trim() || draft.url);

  const save = async () => {
    if (!canSave || companyId === null) return;
    setError(null);
    try {
      await ib.invoke('notes:add', {
        companyId,
        kind,
        body,
        quote: quote.trim() || null,
        sourceUrl: draft.url,
        sourceTitle: draft.title,
        ...(kind === 'figure'
          ? { metric, period, value: numeric, scale, currency, origin: estimate ? 'estimate' : draft.url ? 'published' : 'user' }
          : {}),
      });
      showToast(`${NOTE_KIND_LABEL[kind]} guardada en ${companies.find((c) => c.id === companyId)?.ticker ?? 'investigación'}`);
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close} data-testid="save-dialog">
      <div
        className="modal"
        role="dialog"
        aria-label="Guardar en investigación"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
        }}
      >
        <header className="modal-head">
          <h2>Guardar en investigación</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={close}>
            <X size={15} />
          </button>
        </header>

        <div className="modal-body">
          {/* Company */}
          {creating ? (
            <div className="subcard">
              <div className="subcard-title">Nueva empresa</div>
              <CompanyForm
                onDone={(c) => {
                  setCompanyId(c.id);
                  setCreating(false);
                }}
                onCancel={companies.length ? () => setCreating(false) : undefined}
              />
            </div>
          ) : (
            <div className="company-picker" role="radiogroup" aria-label="Empresa">
              {companies.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={c.id === companyId}
                  className={`company-pick ${c.id === companyId ? 'is-on' : ''}`}
                  onClick={() => setCompanyId(c.id)}
                  data-testid="pick-company"
                >
                  <TickerChip company={c} size="sm" />
                  <span className="ellipsis">{c.name}</span>
                </button>
              ))}
              <button className="company-pick add" onClick={() => setCreating(true)} data-testid="pick-new-company">
                <Plus size={13} /> Nueva
              </button>
            </div>
          )}

          {/* Kind */}
          <div className="kind-tabs" role="tablist">
            {NOTE_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button key={k} role="tab" aria-selected={k === kind} className={k === kind ? 'is-on' : ''} onClick={() => setKind(k)} data-kind={k}>
                  <Icon size={13} /> {NOTE_KIND_LABEL[k]}
                </button>
              );
            })}
          </div>

          {(kind !== 'figure' || quote) && (
            <label className="field">
              <span>Cita textual de la fuente</span>
              <textarea className="textarea quote-input" value={quote} onChange={(e) => setQuote(e.target.value)} rows={3} placeholder="Selecciona texto en la página o pégalo aquí" data-testid="save-quote" />
            </label>
          )}

          {kind === 'figure' && (
            <div className="figure-grid">
              <label className="field span-2">
                <span>Métrica</span>
                <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as MetricId)} data-testid="figure-metric">
                  {METRICS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Periodo</span>
                <input className={`input mono ${periodOk ? '' : 'is-invalid'}`} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="FY2025, Q3 2026" data-testid="figure-period" />
              </label>
              <label className="field">
                <span>Valor</span>
                <input className="input mono" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" data-testid="figure-value" />
              </label>
              <label className="field">
                <span>Unidad</span>
                <select className="select" value={scale} onChange={(e) => setScale(e.target.value as Scale)} data-testid="figure-scale">
                  {(Object.keys(SCALES) as Scale[]).map((s) => (
                    <option key={s} value={s}>
                      {SCALE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Moneda</span>
                <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {parsed?.ambiguous && (
                <p className="warn span-2">
                  <AlertTriangle size={13} /> «{draft.text.slice(0, 30)}» es ambiguo (¿separador de miles o decimal?). Revisa el valor.
                </p>
              )}
              {metric === 'capex' && <p className="hint span-2">Introduce el CAPEX como número positivo aunque el informe lo muestre entre paréntesis.</p>}
              <label className="check span-2">
                <input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} /> Es una estimación (previsión de la empresa o de analistas), no un dato publicado
              </label>
              {!periodOk && <p className="warn span-2">Periodo no válido. Usa FY2025, Q3 2026, H1 2026, 9M 2026 o TTM2026.</p>}
            </div>
          )}

          <label className="field">
            <span>{kind === 'question' ? 'Pregunta' : kind === 'conclusion' ? 'Conclusión' : 'Tu comentario (opcional)'}</span>
            <textarea ref={bodyRef} className="textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={kind === 'note' || kind === 'conclusion' || kind === 'question' ? 4 : 2} data-testid="save-body" />
          </label>

          <div className="source-line">
            <Link2 size={13} />
            {draft.url ? (
              <span className="ellipsis" title={draft.url}>
                <strong>{draft.title || displayUrl(draft.url)}</strong> · {displayUrl(draft.url)} · consultado hoy
              </span>
            ) : (
              <span className="muted">Sin fuente web: se guardará como nota tuya.</span>
            )}
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small">Ctrl+Enter para guardar</span>
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!canSave || creating} onClick={() => void save()} data-testid="save-submit">
            Guardar
          </button>
        </footer>
      </div>
    </div>
  );
}
