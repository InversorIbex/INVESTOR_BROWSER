# Modelo de seguridad

El principio: **el contenido web es hostil**. Ninguna página puede alcanzar Node, el sistema de archivos, SQLite ni el puente IPC de la aplicación.

## Fronteras de confianza

| Componente | Confianza | Configuración |
| --- | --- | --- |
| Proceso main | Total | Node completo. Único lugar con acceso a disco, SQLite y red de la app. |
| UI (React) | Alta, restringida | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP estricta, cargada desde `file://`. Solo ve `window.ib`. |
| Pestañas web | Ninguna | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **sin preload**, `webviewTag: false`, partición propia `persist:web`. |

`app.enableSandbox()` fuerza el sandbox de Chromium en todos los procesos de renderizado.

## Reglas implementadas

1. **IPC:** cada canal se valida con un esquema Zod (`src/shared/ipc.ts`) y el proceso main comprueba que el remitente es el `mainFrame` de la UI cargado desde la URL esperada. Las cargas inválidas se rechazan (cubierto por test E2E).
2. **Preload mínimo:** `src/preload/index.ts` expone solo `invoke`, `on` (lista cerrada de eventos) y `platform`. Ningún objeto de Electron sale al mundo de la página.
3. **Esquemas permitidos:** en una pestaña solo `http:`, `https:` y `about:blank`. `javascript:`, `file:`, `data:`, `chrome:`… escritos en la barra se tratan como búsqueda; desde una página se bloquean en `will-navigate`/`will-redirect` (test E2E con `file://`).
4. **Protocolos externos:** solo `mailto:` y `tel:`, y siempre con confirmación del usuario. El resto se rechaza.
5. **Ventanas emergentes:** `target=_blank` y `window.open` sin características → pestaña nueva. Las ventanas emergentes reales (p. ej. «Iniciar sesión con…») se abren como ventanas pequeñas con las mismas restricciones que una pestaña; pueden bloquearse en Ajustes. Ninguna ventana hereda privilegios.
6. **Permisos de sitios:** denegados por defecto. Notificaciones, ubicación, cámara/micrófono, portapapeles, MIDI… se preguntan con un diálogo nativo y la decisión se guarda por origen (revocable en Ajustes). USB/HID/serie/Bluetooth se bloquean siempre.
7. **Certificados:** un certificado inválido bloquea la carga (comportamiento por defecto de Electron, sin `certificate-error` que lo anule). La página de error no ofrece «continuar de todos modos».
8. **`<webview>`** prohibido globalmente (`will-attach-webview`).
9. **La UI nunca navega:** cualquier `will-navigate` de la UI se cancela.
10. **Descargas:** nombres saneados, nunca se sobrescriben archivos, aviso antes de abrir ejecutables.
11. **Registros:** el logger no escribe URLs con parámetros, cookies, cabeceras ni contenido de formularios (`redactUrl`, `logError`).
12. **Base de datos dañada:** no deja la app inutilizable; el usuario decide apartar el archivo (se renombra, no se borra).
13. **Investigación:**
    - La selección para «Guardar en investigación» se obtiene del menú contextual de Chromium (proceso main) o con `executeJavaScriptInIsolatedWorld`: el código corre en un mundo aislado, la página no puede alterar `getSelection` ni ver ese código, y nunca se inyecta nada en el mundo de la página.
    - Citas, notas y tesis se renderizan como texto con React (nunca `innerHTML`). Test E2E con `<script>` y `<img onerror>`.
    - URLs de fuentes, web de inversores y pestañas guardadas: solo `http(s)`, validado en el repositorio (no solo en la UI).
    - Importación JSON: tamaño máximo, esquema Zod campo a campo, transacción atómica y URLs peligrosas descartadas.
    - El distintivo «Fuente oficial» exige HTTPS y dominio exacto o subdominio real (test con `sec.gov.evil.com` y `evilsec.gov`).
    - No se hace ninguna petición de red nueva: los enlaces a EDGAR son solo enlaces.
14. **Datos oficiales (SEC):**
    - Las peticiones salen solo del proceso main, por una sesión de red propia (`sec-data`) sin cookies ni permisos.
    - No hay ninguna petición hasta que el usuario declara su contacto (requisito de la SEC); el contacto solo se envía a `sec.gov`/`data.sec.gov`.
    - Redirecciones aceptadas únicamente dentro de `sec.gov`. Tamaño máximo 80 MB, tiempo máximo 30 s, JSON validado y analizado de forma defensiva.
    - Las URLs de documentos se construyen con CIK y número de registro validados; nombres de archivo con `/` o `..` se descartan.
    - `IB_SEC_BASE_URL` (solo pruebas) se ignora salvo que sea `http://127.0.0.1:<puerto>`.
14b. **Cuentas europeas (ESEF):** mismas reglas que la SEC.
    - Sesión de red propia (`esef-data`) sin cookies; solo se aceptan respuestas de `filings.xbrl.org`.
    - Sin contacto declarado no hay peticiones.
    - Máximo 2 peticiones por segundo y 80 MB por informe.
    - Las URLs de informes y visores se aceptan solo si son rutas del propio servicio.
    - El filtro de búsqueda se construye con un nombre saneado o un LEI validado.
    - El xBRL-JSON se analiza como datos: solo hechos numéricos `ifrs-full` sin dimensiones.
    - `IB_ESEF_BASE_URL` (solo pruebas) se ignora salvo que sea `http://127.0.0.1:<puerto>`.
15. **Form 4 (XML):** lector propio (`src/shared/miniXml.ts`) que ignora DOCTYPE y entidades definidas por el documento (sin XXE ni «billion laughs»), con límites de 5 MB, 64 niveles y 100 000 nodos. Los nombres de archivo se validan y un formulario de otro emisor se rechaza.
16. **User-Agent:** se elimina el token `Electron/x.y` para que las webs traten la app como Chrome. No afecta a la seguridad.

17. ***Fuses* de Electron** (`package.json` › `build.electronFuses`), aplicados al ejecutable distribuido:

    | Fuse | Valor | Efecto |
    | --- | --- | --- |
    | `runAsNode` | off | `ELECTRON_RUN_AS_NODE` no convierte la app en un intérprete de Node |
    | `enableNodeOptionsEnvironmentVariable` | off | Se ignoran `NODE_OPTIONS` y `NODE_EXTRA_CA_CERTS` |
    | `enableNodeCliInspectArguments` | off | Se ignoran `--inspect`, `--inspect-brk` y `SIGUSR1` |
    | `onlyLoadAppFromAsar` | on | Solo se carga el código de `app.asar` |
    | `enableEmbeddedAsarIntegrityValidation` | on | Integridad de `app.asar` comprobada al cargar (Windows y macOS) |
    | `enableCookieEncryption` | on | Cookies cifradas en disco con las claves del sistema (transición irreversible: no desactivar) |
    | `grantFileProtocolExtraPrivileges` | **on** | Ver excepciones: la UI se carga hoy desde `file://` dentro de `app.asar` |

    `scripts/smoke-packaged.mjs` arranca el ejecutable empaquetado con `ELECTRON_RUN_AS_NODE=1` y `NODE_OPTIONS` hostil y comprueba que la UI carga desde `app.asar` y responde por IPC. Se ejecuta en CI en Linux y Windows. Se comprobó que **falla** si se desactivan los *fuses*: la app termina con código 9.

    Las pruebas E2E usan Electron sin empaquetar, porque Playwright necesita `--inspect`.

## Excepciones documentadas

| Excepción | Justificación |
| --- | --- |
| CSP de la UI permite `img-src https:` | Para mostrar favicons de las webs abiertas. Una imagen no puede ejecutar código; el resto de recursos remotos están prohibidos. |
| CSP de la UI permite `style-src 'unsafe-inline'` | Estilos en línea de React (anchos dinámicos). No hay `script-src` en línea. |
| Fuse `grantFileProtocolExtraPrivileges` activado | Probado: con el fuse desactivado, la UI empaquetada no carga desde `app.asar` (`ERR_FILE_NOT_FOUND`). Las páginas web no pueden navegar a `file:` (regla 3), así que el privilegio solo afecta a la UI propia. **Mejora prevista:** servir la UI desde un protocolo propio (`app://`) y desactivar el fuse. |
| `--no-sandbox` | **Nunca en la app.** Chromium no admite su sandbox como `root`; las pruebas deben ejecutarse con un usuario normal. |

## Pendiente antes de distribución pública

- **Firma de código.**
  - Windows: vía Microsoft Store, preparada en [MICROSOFT_STORE.md](MICROSOFT_STORE.md) y pendiente del envío. El `.exe` de GitHub sigue sin firmar.
  - macOS: notarización.
- **Actualizaciones.**
  - En la Store, las gestiona Microsoft.
  - El `.exe` no se autoactualiza: la publicación está desactivada con `--publish never`.
- **UI desde un protocolo propio** (`app://`) para poder desactivar `grantFileProtocolExtraPrivileges`.
- Revisión externa del modelo de amenazas.
