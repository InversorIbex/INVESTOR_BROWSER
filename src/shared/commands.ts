/**
 * Every user-invokable action has an id. The same ids are used by keyboard
 * shortcuts, the command palette and menus, so there is one code path per action.
 */
export const COMMANDS = {
  'tab.new': { title: 'Nueva pestaña', keys: ['Mod+T'], group: 'Pestañas' },
  'tab.close': { title: 'Cerrar pestaña', keys: ['Mod+W', 'Mod+F4'], group: 'Pestañas' },
  'tab.reopen': { title: 'Reabrir pestaña cerrada', keys: ['Mod+Shift+T'], group: 'Pestañas' },
  'tab.next': { title: 'Pestaña siguiente', keys: ['Ctrl+Tab', 'Mod+PageDown'], group: 'Pestañas' },
  'tab.prev': { title: 'Pestaña anterior', keys: ['Ctrl+Shift+Tab', 'Mod+PageUp'], group: 'Pestañas' },
  'tab.pin': { title: 'Fijar / soltar pestaña', keys: [], group: 'Pestañas' },
  'tab.duplicate': { title: 'Duplicar pestaña', keys: [], group: 'Pestañas' },
  'nav.back': { title: 'Atrás', keys: ['Alt+ArrowLeft'], group: 'Navegación' },
  'nav.forward': { title: 'Adelante', keys: ['Alt+ArrowRight'], group: 'Navegación' },
  'nav.reload': { title: 'Recargar', keys: ['Mod+R', 'F5'], group: 'Navegación' },
  'nav.hardReload': { title: 'Recargar sin caché', keys: ['Mod+Shift+R', 'Ctrl+F5'], group: 'Navegación' },
  'nav.stop': { title: 'Detener carga', keys: [], group: 'Navegación' },
  'nav.home': { title: 'Página de inicio', keys: ['Alt+Home'], group: 'Navegación' },
  'ui.focusAddress': { title: 'Ir a la barra de direcciones', keys: ['Mod+L', 'F6', 'Alt+D'], group: 'Interfaz' },
  'ui.palette': { title: 'Paleta de comandos', keys: ['Mod+K', 'Mod+Shift+P'], group: 'Interfaz' },
  'ui.find': { title: 'Buscar en la página', keys: ['Mod+F'], group: 'Página' },
  'ui.toggleSidebar': { title: 'Mostrar / ocultar panel lateral', keys: ['Mod+B'], group: 'Interfaz' },
  'ui.toggleRightPanel': { title: 'Mostrar / ocultar panel de investigación', keys: ['Mod+.'], group: 'Interfaz' },
  'ui.focusMode': { title: 'Modo foco (ocultar todos los paneles)', keys: ['Mod+\\', 'F11'], group: 'Interfaz' },
  'ui.toggleTabLayout': { title: 'Pestañas verticales / horizontales', keys: [], group: 'Interfaz' },
  'ui.cycleTheme': { title: 'Cambiar tema (oscuro / terminal / claro / sistema)', keys: [], group: 'Interfaz' },
  'page.zoomIn': { title: 'Ampliar', keys: ['Mod+=', 'Mod++', 'Mod+Shift+='], group: 'Página' },
  'page.zoomOut': { title: 'Reducir', keys: ['Mod+-'], group: 'Página' },
  'page.zoomReset': { title: 'Tamaño real', keys: ['Mod+0'], group: 'Página' },
  'page.devtools': { title: 'Herramientas de desarrollo de la página', keys: ['F12', 'Mod+Shift+I'], group: 'Página' },
  'page.print': { title: 'Imprimir', keys: ['Mod+P'], group: 'Página' },
  'page.bookmark': { title: 'Añadir / quitar de favoritos', keys: ['Mod+D'], group: 'Página' },
  'page.copyUrl': { title: 'Copiar URL de la página', keys: [], group: 'Página' },
  'open.history': { title: 'Historial', keys: ['Mod+H'], group: 'Abrir' },
  'open.bookmarks': { title: 'Favoritos', keys: ['Mod+Shift+O'], group: 'Abrir' },
  'open.downloads': { title: 'Descargas', keys: ['Mod+J'], group: 'Abrir' },
  'open.settings': { title: 'Ajustes', keys: ['Mod+,'], group: 'Abrir' },
  'research.save': { title: 'Guardar selección en investigación', keys: ['Mod+Shift+S'], group: 'Investigación' },
  'open.research': { title: 'Empresas e investigación', keys: ['Mod+Shift+E'], group: 'Investigación' },
  'open.valuation': { title: 'Laboratorio de valoración', keys: [], group: 'Investigación' },
  'open.compare': { title: 'Comparar empresas', keys: [], group: 'Investigación' },
  'open.portfolio': { title: 'Cartera y seguimiento', keys: ['Mod+Shift+M'], group: 'Investigación' },
  'open.screener': { title: 'Screener de empresas', keys: [], group: 'Investigación' },
  'open.calendar': { title: 'Calendario bursátil (resultados y dividendos)', keys: [], group: 'Investigación' },
  'portfolio.import': { title: 'Importar cartera (JSON o CSV de tu bróker)', keys: [], group: 'Datos' },
  'portfolio.export': { title: 'Exportar cartera (JSON)', keys: [], group: 'Datos' },
  'quotes.refresh': { title: 'Actualizar cotizaciones', keys: [], group: 'Datos' },
  'research.export': { title: 'Exportar investigación (Markdown)', keys: [], group: 'Investigación' },
  'research.exportJson': { title: 'Exportar investigación (JSON, para copia)', keys: [], group: 'Investigación' },
  'research.import': { title: 'Importar investigación (JSON)', keys: [], group: 'Investigación' },
  'data.backup': { title: 'Copia de seguridad de todos los datos', keys: [], group: 'Datos' },
  'bookmarks.import': { title: 'Importar favoritos (HTML)', keys: [], group: 'Datos' },
  'bookmarks.export': { title: 'Exportar favoritos (HTML)', keys: [], group: 'Datos' },
  'session.restore': { title: 'Restaurar sesión anterior', keys: [], group: 'Datos' },
} as const;

export type CommandId = keyof typeof COMMANDS;
export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

/** Commands that only the UI process can perform. Main forwards these to the renderer. */
export const UI_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>([
  'ui.focusAddress',
  'ui.palette',
  'ui.find',
]);

export interface KeyInput {
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Normalise an accelerator like "Mod+Shift+T" for a given platform. */
export function matchesAccelerator(accel: string, input: KeyInput, isMac: boolean): boolean {
  const parts = accel.split('+');
  // "Mod++" → last part is '+'
  if (accel.endsWith('++')) parts.splice(parts.length - 2, 2, '+');
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  const wantCtrl = mods.has('Ctrl') || (!isMac && mods.has('Mod'));
  const wantMeta = mods.has('Meta') || (isMac && mods.has('Mod'));
  const wantShift = mods.has('Shift');
  const wantAlt = mods.has('Alt');
  if (input.control !== wantCtrl || input.meta !== wantMeta || input.alt !== wantAlt) return false;
  const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const target = key.length === 1 ? key.toLowerCase() : key;
  // Shift changes the produced character for symbols ("=" → "+"), so we only
  // enforce Shift for non-symbol keys.
  const symbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (!symbol && input.shift !== wantShift) return false;
  if (symbol && wantShift && !input.shift) return false;
  return k === target;
}

export function commandForInput(input: KeyInput, isMac: boolean): CommandId | null {
  for (const id of COMMAND_IDS) {
    for (const accel of COMMANDS[id].keys) {
      if (matchesAccelerator(accel, input, isMac)) return id;
    }
  }
  // Mod+1..9 → switch to tab N (9 = last)
  return null;
}

export function tabIndexForInput(input: KeyInput, isMac: boolean): number | null {
  const mod = isMac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod || input.alt || input.shift) return null;
  if (/^[1-9]$/.test(input.key)) return Number(input.key);
  return null;
}

export function formatAccelerator(accel: string, isMac: boolean): string {
  return accel
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→');
}
