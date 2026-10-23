import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { TabStrip } from './components/TabStrip';
import { ContentArea } from './components/ContentArea';
import { CommandPalette } from './components/CommandPalette';
import { RightPanel } from './components/RightPanel';
import { showToast, updateSettings, useCommandListener, useResolvedTheme, useSettings } from './lib/ib';
import type { CommandId } from '../shared/commands';

export function App() {
  const settings = useSettings();
  const systemTheme = useResolvedTheme();
  // Explicit choices come straight from settings; only "system" depends on the OS.
  const theme = settings.theme === 'system' ? systemTheme : settings.theme;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [findRequest, setFindRequest] = useState(0);
  const [addressRequest, setAddressRequest] = useState(0);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.platform = window.ib.platform;
    document.documentElement.style.setProperty('--ui-font-size', `${settings.fontSize}px`);
  }, [theme, settings.fontSize]);

  const onCommand = useCallback((id: CommandId) => {
    if (id === 'ui.palette') setPaletteOpen((o) => !o);
    if (id === 'ui.find') setFindRequest((n) => n + 1);
    if (id === 'ui.focusAddress') {
      if (focusModeRef.current) setFocusMode(false);
      setAddressRequest((n) => n + 1);
    }
    if (id === 'ui.focusMode') {
      setFocusMode((f) => {
        if (!f) showToast('Modo foco activado · F11 o Ctrl+\\ para salir');
        return !f;
      });
    }
  }, []);
  useCommandListener(onCommand);

  const vertical = settings.tabLayout === 'vertical';
  const showSidebar = !focusMode && settings.sidebarVisible;
  const showRight = !focusMode && settings.rightPanelVisible;

  return (
    <div className={`app ${focusMode ? 'is-focus' : ''}`}>
      {!focusMode && <TopBar addressRequest={addressRequest} />}
      <div className="body">
        {showSidebar && (
          <Sidebar
            width={settings.sidebarWidth}
            showTabs={vertical}
            onResize={(w) => void updateSettings({ sidebarWidth: w })}
          />
        )}
        <main className="main-col">
          {!focusMode && (!vertical || !showSidebar) && <TabStrip />}
          <ContentArea findRequest={findRequest} />
        </main>
        {showRight && <RightPanel width={settings.rightPanelWidth} />}
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
