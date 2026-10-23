# Arquitectura

## Visión general

```
┌──────────────────────────── BrowserWindow ────────────────────────────┐
│  UI de confianza (React, file://, sandbox, preload → window.ib)        │
│  ┌──────────┐ ┌───────────────────────────────────────────┐ ┌───────┐ │
│  │ Sidebar  │ │  .viewport  ← el renderer informa sus      │ │Panel  │ │
│  │ pestañas │ │             coordenadas al proceso main    │ │context│ │
│  │ favoritos│ │  ┌─────────────────────────────────────┐   │ │       │ │
│  │          │ │  │ WebContentsView (una por pestaña)   │   │ │       │ │
│  │          │ │  │ sandbox · sin preload · persist:web │   │ │       │ │
│  └──────────┘ │  └─────────────────────────────────────┘   │ └───────┘ │
└───────────────────────────────────────────────────────────────────────┘
           ▲ ipcRenderer.invoke('ib:*')  (validado con Zod)
           │ webContents.send('ib:*')    (estado, ajustes, eventos)
┌──────────┴──────────────── Proceso principal (Node) ───────────────────┐
│ index.ts   ventana, IPC, comandos, atajos, sesión                       │
│ tabs.ts    TabManager: vistas, navegación, errores, menús contextuales │
│ security.ts políticas globales y de la sesión web (permisos, UA…)      │
│ downloads.ts gestor de descargas                                        │
│ db.ts      SQLite (node:sqlite) con migraciones                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Decisiones

| Decisión | Alternativas | Motivo |
| --- | --- | --- |
| **Electron 44** (Chromium 152, Node 24) | Electron 45.0.0 (recién publicado), Tauri | Línea estable con parches acumulados. Tauri usa el WebView del sistema (WebView2 en Windows): menos control sobre pestañas, sesiones y descargas. |
| **`WebContentsView`** por pestaña | `<webview>` (desaconsejado), `BrowserView` (obsoleto) | API actual recomendada. Cada pestaña es un proceso aislado y la UI nunca comparte proceso con la web. |
| **`node:sqlite`** integrado | `better-sqlite3` | Sin módulos nativos: no hay que recompilar para cada versión de Electron/Windows; un riesgo menos en la cadena de compilación. Es «experimental» en Node 22 y estable en el Node 24 de Electron 44. El acceso está encapsulado en `db.ts` por si hubiera que cambiar de driver. |
| **esbuild** (main/preload) + **Vite** (UI) | electron-vite, webpack | Dos herramientas pequeñas y conocidas, sin capa de integración extra. |
| **Zod** para IPC y ajustes | Validación manual | Esquemas únicos compartidos por proceso main y UI. |
| **Páginas internas `ib://`** renderizadas por la UI | Protocolo personalizado servido a una vista web | Historial, favoritos y ajustes nunca se cargan en un proceso web; no hay superficie de ataque desde páginas. |
| Atajos con `before-input-event` | Aceleradores de menú | Funcionan igual con el foco en la UI o en una página, en todas las plataformas, sin barra de menús visible. |

### Superposiciones sobre páginas nativas

Una `WebContentsView` se dibuja **encima** del HTML de la UI. Para que la paleta de comandos o las sugerencias de la barra de direcciones se vean por encima de la página, la UI pide al proceso main una captura (`capturePage`) de la pestaña activa, la muestra atenuada y oculta la vista nativa mientras dure la superposición (`useOverlay` en `src/renderer/lib/ib.ts`). Los menús contextuales usan menús nativos, que no tienen este problema.

### Flujo de estado

El proceso main es la **fuente de verdad** de pestañas, ajustes, favoritos y descargas. La UI llama a acciones (`ib.invoke`) y recibe instantáneas (`state`, `settings`, …). Los cambios se agrupan en un único envío por iteración del bucle de eventos y la sesión se guarda con un retardo de 600 ms (y siempre al cerrar), de modo que un cierre inesperado pierde como mucho medio segundo.

### Carga diferida al restaurar

Al restaurar una sesión solo se carga la pestaña activa. El resto se crea sin `WebContents` y carga al activarse por primera vez: arranque rápido aunque haya muchas pestañas.

## Estructura del repositorio

```
src/
  shared/    código puro (sin Electron): URLs, comandos y atajos, IPC, tipos, favoritos HTML, búsqueda difusa
  main/      proceso principal
  preload/   puente mínimo para la UI (window.ib)
  renderer/  UI en React: components/, pages/ (páginas ib://), lib/ib.ts (estado), styles/
tests/
  unit/      Vitest — lógica pura y SQLite
  e2e/       Playwright + Electron real contra un servidor HTTP local
scripts/     build-main.mjs, dev.mjs, make-icons.py
build/       iconos del instalador
docs/        esta documentación
```

## Cómo se ampliará (fases 2–5)

- **Investigación (Fase 2):** nuevas tablas mediante una migración v2 en `db.ts` (ver [DATA_MODEL.md](DATA_MODEL.md)), nuevos canales IPC en `shared/ipc.ts` y páginas `ib://research/...`. Las pestañas ganan un `companyId` opcional.
- **Datos (Fase 3):** interfaz `DataProvider` en el proceso main (nunca en la UI ni en páginas), con caché en SQLite, límite de frecuencia por proveedor y procedencia en cada cifra. Ver [DATA_SOURCES.md](DATA_SOURCES.md).
- **Copilot (Fase 5):** proveedor intercambiable en el proceso main, claves guardadas con `safeStorage` (DPAPI en Windows), confirmación explícita antes de enviar contenido.

## Licencia

Se propone **Apache-2.0** frente a MIT (equivalente pero sin concesión de patentes) y GPL-3.0 (obligaría a cualquier distribución derivada a ser GPL, lo que dificulta integraciones con herramientas propias). Apache-2.0 permite que terceros contribuyan y reutilicen el código, exige conservar avisos y marcar cambios, e incluye una licencia de patentes explícita con cláusula de terminación en caso de litigio. Electron es MIT y Chromium tiene licencias BSD y otras compatibles; sus textos se distribuyen con el binario (`LICENSES.chromium.html`).
