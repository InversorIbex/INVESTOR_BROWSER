import { useEffect, useState } from 'react';
import { BookOpen, Landmark, Link2, Lock, Monitor, Plus, TriangleAlert, Unlink, X, Quote } from 'lucide-react';
import { errorMessage, ib, runCommand, showToast, updateSettings, useActiveTab, useCompanies, useCompany, useNotesRevision } from '../lib/ib';
import { CompanyForm, KIND_ICON, TickerChip, relativeDate } from './research';
import { isInternalUrl, parseInternalRoute, securityStateOf, displayUrl } from '../../shared/url';
import { isOnIrSite, officialSourceFor } from '../../shared/sources';
import { NOTE_KIND_LABEL, type Note } from '../../shared/types';
import { formatMoney, metricDef, SCALES, type Scale } from '../../shared/finance';

/**
 * Research panel: what you know about the company behind the current page,
 * and one-click capture into its notebook. Everything shown is local data.
 */
export function RightPanel({ width }: { width: number }) {
  const tab = useActiveTab();
  const companies = useCompanies();
  const route = tab ? parseInternalRoute(tab.url) : null;
  const linkedId = tab?.companyId ?? (route?.page === 'company' ? route.id : null);
  const company = useCompany(linkedId);
  const rev = useNotesRevision();
  const [notes, setNotes] = useState<Note[]>([]);
  const [creating, setCreating] = useState(false);
  const [quick, setQuick] = useState('');
  const url = tab?.error?.url ?? tab?.url ?? '';
  const web = !!tab && !isInternalUrl(url);
  const official = web ? officialSourceFor(url) : null;
  const irMatch = web && !company ? companies.find((c) => isOnIrSite(url, c.irUrl)) : undefined;
  const sec = securityStateOf(url);

  useEffect(() => {
    if (!company) return setNotes([]);
    let alive = true;
    void ib.invoke('notes:list', { companyId: company.id }).then((n) => alive && setNotes(n));
    return () => {
      alive = false;
    };
  }, [company?.id, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = (companyId: number | null) => tab && void ib.invoke('tabs:setCompany', { id: tab.id, companyId });
  const pageNotes = notes.filter((n) => n.sourceUrl === url);
  const recent = notes.filter((n) => n.sourceUrl !== url).slice(0, 6);

  const addQuick = async () => {
    if (!company || !quick.trim()) return;
    try {
      await ib.invoke('notes:add', { companyId: company.id, kind: 'note', body: quick, sourceUrl: web && !tab?.error ? url : null, sourceTitle: web ? tab?.title ?? null : null });
      setQuick('');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  };

  return (
    <aside className="rightpanel" style={{ width }} data-testid="right-panel">
      <div className="rp-head">
        <span className="rp-title">
          <BookOpen size={13} /> Investigación
        </span>
        <button className="icon-btn" aria-label="Cerrar panel" onClick={() => void updateSettings({ rightPanelVisible: false })}>
          <X size={14} />
        </button>
      </div>
      <div className="rp-body">
        {web && (
          <div className="rp-source">
            <div className="rp-page-title ellipsis2">{tab?.title}</div>
            <div className="rp-badges">
              {official && (
                <span className="badge-official" data-testid="rp-official">
                  <Landmark size={11} /> Fuente oficial · {official}
                </span>
              )}
              <span className={`badge-sec sec-${sec}`}>
                {sec === 'secure' ? <Lock size={11} /> : sec === 'local' ? <Monitor size={11} /> : <TriangleAlert size={11} />}
                {sec === 'secure' ? 'HTTPS' : sec === 'local' ? 'Local' : 'Sin cifrar'}
              </span>
            </div>
          </div>
        )}

        {company ? (
          <>
            <div className="rp-company" style={{ ['--chip' as string]: company.color }}>
              <TickerChip company={company} />
              <div className="rp-company-name">
                <button className="link-btn" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${company.id}` })} data-testid="rp-open-dossier">
                  {company.name}
                </button>
                <span className="muted small">
                  {company.noteCount} notas · {company.openQuestions} preguntas abiertas
                </span>
              </div>
              {tab?.companyId && route?.page !== 'company' && (
                <button className="icon-btn" title="Desvincular esta pestaña" onClick={() => link(null)}>
                  <Unlink size={13} />
                </button>
              )}
            </div>

            {web && (
              <div className="rp-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void ib.invoke('research:captureSelection')} data-testid="rp-save-selection">
                  <Quote size={13} /> Guardar selección
                </button>
                <span className="muted small">o clic derecho sobre el texto · Ctrl+Shift+S</span>
              </div>
            )}
            <div className="quick-note compact">
              <input className="input" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addQuick()} placeholder={web ? 'Nota rápida sobre esta página…' : 'Nota rápida…'} data-testid="rp-quick-note" />
            </div>

            {pageNotes.length > 0 && (
              <>
                <div className="side-label">De esta página · {pageNotes.length}</div>
                <MiniNotes notes={pageNotes.slice(0, 5)} />
                {pageNotes.length > 5 && (
                  <button className="link-btn small more-link" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${company.id}` })}>
                    Ver las {pageNotes.length} en el dossier
                  </button>
                )}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div className="side-label">Recientes</div>
                <MiniNotes notes={recent} />
              </>
            )}
          </>
        ) : web ? (
          <div className="rp-link">
            {irMatch ? (
              <div className="rp-suggest">
                Estás en la web de inversores de <TickerChip company={irMatch} size="sm" />
                <button className="btn btn-primary btn-sm" onClick={() => link(irMatch.id)} data-testid="rp-link-suggested">
                  <Link2 size={13} /> Vincular pestaña
                </button>
              </div>
            ) : (
              <p className="muted small">Vincula esta pestaña a una empresa para agrupar tus fuentes y guardar lo que leas.</p>
            )}
            {creating ? (
              <CompanyForm
                onDone={(c) => {
                  setCreating(false);
                  link(c.id);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <div className="company-picker">
                {companies.map((c) => (
                  <button key={c.id} className="company-pick" onClick={() => link(c.id)} data-testid="rp-link-company">
                    <TickerChip company={c} size="sm" />
                    <span className="ellipsis">{c.name}</span>
                  </button>
                ))}
                <button className="company-pick add" onClick={() => setCreating(true)}>
                  <Plus size={13} /> Nueva empresa
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rp-empty">
            <p className="muted small">Abre una web o un informe para trabajar con él aquí.</p>
            <button className="btn btn-sm" onClick={() => runCommand('open.research')}>
              Ver mis empresas
            </button>
          </div>
        )}

        {web && (
          <div className="rp-url" title={url}>
            {displayUrl(url)}
          </div>
        )}
      </div>
    </aside>
  );
}

function MiniNotes({ notes }: { notes: Note[] }) {
  return (
    <ul className="mini-notes">
      {notes.map((n) => {
        const Icon = KIND_ICON[n.kind];
        return (
          <li key={n.id} className={`mini-note tl-${n.kind}`}>
            <Icon size={12} />
            <div>
              <div className="mini-text">
                {n.kind === 'figure'
                  ? `${metricDef(n.metric ?? 'other').short} ${n.period}: ${formatMoney((n.value ?? 0) * SCALES[(n.scale as Scale) ?? 'units'], n.metric === 'diluted_shares' ? null : n.currency)}`
                  : n.quote || n.body}
              </div>
              <div className="muted small">
                {NOTE_KIND_LABEL[n.kind]} · {relativeDate(n.createdAt)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
