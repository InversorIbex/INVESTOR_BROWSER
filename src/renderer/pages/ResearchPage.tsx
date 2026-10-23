import { useEffect, useState } from 'react';
import { BookOpen, Download, FolderOpen, Plus, Search, Upload, CircleHelp } from 'lucide-react';
import { ib, runCommand, useCompanies, useNotesRevision } from '../lib/ib';
import { CompanyForm, KIND_ICON, TickerChip, relativeDate } from '../components/research';
import { EmptyState } from '../components/ui';
import { NOTE_KIND_LABEL, type Note } from '../../shared/types';

export function ResearchPage() {
  const companies = useCompanies();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Note[]>([]);
  const rev = useNotesRevision();

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    let alive = true;
    const t = setTimeout(() => void ib.invoke('notes:list', { query: q }).then((n) => alive && setHits(n.slice(0, 50))), 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, rev]);

  const byId = new Map(companies.map((c) => [c.id, c]));

  return (
    <div className="page" data-testid="research-page">
      <header className="page-head">
        <h1>Investigación</h1>
        <div className="page-tools">
          <label className="search-field">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en todas tus notas" data-testid="notes-search" />
          </label>
          <button className="btn" onClick={() => runCommand('research.import')} title="Importar una exportación JSON">
            <Upload size={13} /> Importar
          </button>
          <button className="btn" onClick={() => runCommand('research.export')} disabled={!companies.length}>
            <Download size={13} /> Exportar
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-company">
            <Plus size={14} /> Nueva empresa
          </button>
        </div>
      </header>

      {creating && (
        <section className="card narrow">
          <h2>Nueva empresa</h2>
          <CompanyForm
            onDone={(c) => {
              setCreating(false);
              void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` });
            }}
            onCancel={() => setCreating(false)}
          />
        </section>
      )}

      {q.trim() ? (
        <section className="list-group">
          <h2 className="list-group-title">{hits.length} resultado(s) en tus notas</h2>
          <ul className="list">
            {hits.map((n) => {
              const c = byId.get(n.companyId);
              const Icon = KIND_ICON[n.kind];
              return (
                <li key={n.id} className="list-row">
                  {c && <TickerChip company={c} size="sm" />}
                  <button className="list-main static" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${n.companyId}` })}>
                    <span className="ellipsis">{n.quote || n.body}</span>
                    <span className="list-sub">
                      <Icon size={11} /> {NOTE_KIND_LABEL[n.kind]} · {relativeDate(n.createdAt)}
                      {n.sourceTitle ? ` · ${n.sourceTitle}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : companies.length === 0 && !creating ? (
        <EmptyState icon={<BookOpen size={28} />} title="Empieza tu primera investigación">
          Crea una empresa y vincula a ella las pestañas que abras: informe anual, presentación de resultados, competidores… Al seleccionar texto en cualquier página, usa clic derecho → <em>Guardar en investigación</em> y la cita quedará guardada con su fuente y fecha.
        </EmptyState>
      ) : (
        <div className="company-table" role="table" data-testid="company-table">
          <div className="ct-row ct-head" role="row">
            <span>Empresa</span>
            <span>Bolsa · País</span>
            <span className="num">Precio (manual)</span>
            <span className="num">Notas</span>
            <span className="num">Preguntas</span>
            <span>Actualizada</span>
            <span />
          </div>
          {companies.map((c) => (
            <div key={c.id} className="ct-row" role="row" data-testid="company-row">
              <button className="ct-name" onClick={() => void ib.invoke('tabs:navigate', { input: `ib://company/${c.id}` })}>
                <TickerChip company={c} />
                <span className="ellipsis">{c.name}</span>
              </button>
              <span className="muted ellipsis">{[c.exchange, c.country].filter(Boolean).join(' · ') || '—'}</span>
              <span className="num mono" title={c.price !== null ? `a ${c.priceAsOf ?? 's/f'} · ${c.priceSource ?? 'fuente no indicada'}` : 'Cotización no disponible'}>
                {c.price !== null ? `${c.price.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${c.priceCurrency ?? ''}` : '—'}
              </span>
              <span className="num mono">{c.noteCount}</span>
              <span className={`num mono ${c.openQuestions ? 'warn-text' : 'muted'}`}>
                {c.openQuestions ? (
                  <>
                    <CircleHelp size={12} /> {c.openQuestions}
                  </>
                ) : (
                  '0'
                )}
              </span>
              <span className="muted">{relativeDate(c.updatedAt)}</span>
              <button className="icon-btn" title="Abrir espacio de trabajo" onClick={() => void ib.invoke('workspace:open', { companyId: c.id })}>
                <FolderOpen size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
