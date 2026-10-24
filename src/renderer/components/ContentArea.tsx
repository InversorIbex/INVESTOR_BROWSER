import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCw, ShieldAlert, Unplug, X, Ban, Bug } from 'lucide-react';
import { ib, useActiveTab, useOverlayState } from '../lib/ib';
import { parseInternalRoute } from '../../shared/url';
import type { TabError } from '../../shared/types';
import { NewTabPage } from '../pages/NewTabPage';
import { HistoryPage } from '../pages/HistoryPage';
import { BookmarksPage } from '../pages/BookmarksPage';
import { DownloadsPage } from '../pages/DownloadsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { ResearchPage } from '../pages/ResearchPage';
import { CompanyPage } from '../pages/CompanyPage';
import { ValuationPage } from '../pages/ValuationPage';
import { ComparePage } from '../pages/ComparePage';
import { PortfolioPage } from '../pages/PortfolioPage';
import { ScreenerPage } from '../pages/ScreenerPage';

export function ContentArea({ findRequest }: { findRequest: number }) {
  const tab = useActiveTab();
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlay = useOverlayState();
  const [findOpen, setFindOpen] = useState(false);
  const route = tab ? parseInternalRoute(tab.url) : null;
  const internal = route?.page ?? null;

  // Report the viewport rectangle to main so the native page view is placed exactly here.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void ib.invoke('ui:contentBounds', { x: r.left, y: r.top, width: r.width, height: r.height });
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (findRequest && tab && !internal && !tab.error) setFindOpen(true);
  }, [findRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Main clears tab.find when the page navigates or Esc is pressed inside the page.
  useEffect(() => {
    if (!tab?.find && findOpen && document.activeElement?.closest('.findbar') == null) setFindOpen(false);
  }, [tab?.find]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setFindOpen(false), [tab?.id]);

  return (
    <section className="content">
      {findOpen && tab && !internal && <FindBar key={tab.id} onClose={() => setFindOpen(false)} />}
      <div className="viewport" ref={viewportRef} data-testid="viewport">
        {internal === 'newtab' && <NewTabPage />}
        {internal === 'history' && <HistoryPage />}
        {internal === 'bookmarks' && <BookmarksPage />}
        {internal === 'downloads' && <DownloadsPage />}
        {internal === 'settings' && <SettingsPage />}
        {internal === 'research' && <ResearchPage />}
        {internal === 'company' && route?.id && <CompanyPage key={route.id} id={route.id} />}
        {internal === 'valuation' && <ValuationPage key={route?.id ?? 0} companyId={route?.id ?? null} />}
        {internal === 'compare' && <ComparePage />}
        {internal === 'portfolio' && <PortfolioPage />}
        {internal === 'screener' && <ScreenerPage />}
        {!internal && tab?.error && <ErrorPage error={tab.error} />}
        {!internal && !tab?.error && overlay.active && (
          <div className="snapshot" aria-hidden>
            {overlay.snapshot && <img src={overlay.snapshot} alt="" draggable={false} />}
          </div>
        )}
        {!internal && !tab?.error && tab?.loading && <div className="loadbar" />}
      </div>
    </section>
  );
}

function FindBar({ onClose }: { onClose: () => void }) {
  const tab = useActiveTab();
  const [q, setQ] = useState(tab?.find?.query ?? '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const close = () => {
    void ib.invoke('tabs:stopFind');
    onClose();
  };
  const step = (forward: boolean) => q && void ib.invoke('tabs:find', { query: q, forward, step: true });
  const f = tab?.find;
  return (
    <div className="findbar" data-testid="findbar">
      <input
        ref={ref}
        value={q}
        placeholder="Buscar en la página"
        data-testid="find-input"
        onChange={(e) => {
          setQ(e.target.value);
          void ib.invoke('tabs:find', { query: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(!e.shiftKey);
          if (e.key === 'Escape') close();
        }}
      />
      <span className="find-count" data-testid="find-count">
        {q ? (f && f.matches ? `${f.activeMatch}/${f.matches}` : 'Sin resultados') : ''}
      </span>
      <button className="icon-btn" aria-label="Anterior" onClick={() => step(false)}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn" aria-label="Siguiente" onClick={() => step(true)}>
        <ChevronDown size={15} />
      </button>
      <button className="icon-btn" aria-label="Cerrar búsqueda" onClick={close}>
        <X size={15} />
      </button>
    </div>
  );
}

function ErrorPage({ error }: { error: TabError }) {
  const copy = {
    certificate: {
      icon: <ShieldAlert size={36} />,
      title: 'Conexión bloqueada: certificado no válido',
      body: 'El certificado de seguridad de este sitio no es de confianza. Para protegerte, Investor Browser no permite continuar. Comprueba la dirección o inténtalo más tarde.',
    },
    network: {
      icon: <Unplug size={36} />,
      title: 'No se puede acceder a este sitio',
      body: 'Comprueba tu conexión a Internet y que la dirección sea correcta.',
    },
    crashed: {
      icon: <Bug size={36} />,
      title: 'La página ha dejado de funcionar',
      body: 'El proceso de la página se cerró inesperadamente. El resto del navegador no se ha visto afectado.',
    },
    blocked: {
      icon: <Ban size={36} />,
      title: 'Dirección bloqueada',
      body: 'Solo se pueden abrir direcciones http:// y https:// en una pestaña.',
    },
  }[error.kind];
  return (
    <div className="errorpage" data-testid="error-page" data-kind={error.kind}>
      <div className="error-icon">{copy.icon}</div>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <code className="error-code">
        {error.description || 'ERROR'} {error.code ? `(${error.code})` : ''}
      </code>
      <div className="error-url">{error.url}</div>
      {error.kind !== 'blocked' && (
        <button className="btn btn-primary" onClick={() => void ib.invoke('command:run', { id: 'nav.reload' })} data-testid="error-retry">
          <RotateCw size={14} /> Reintentar
        </button>
      )}
    </div>
  );
}
