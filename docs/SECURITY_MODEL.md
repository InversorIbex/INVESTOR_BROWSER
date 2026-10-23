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
13. **User-Agent:** se elimina el token `Electron/x.y` para que las webs traten la app como Chrome. No afecta a la seguridad.

## Excepciones documentadas

| Excepción | Justificación |
| --- | --- |
| CSP de la UI permite `img-src https:` | Para mostrar favicons de las webs abiertas. Una imagen no puede ejecutar código; el resto de recursos remotos están prohibidos. |
| CSP de la UI permite `style-src 'unsafe-inline'` | Estilos en línea de React (anchos dinámicos). No hay `script-src` en línea. |
| `--no-sandbox` | **Nunca en la app.** Chromium no admite su sandbox como `root`; las pruebas deben ejecutarse con un usuario normal. |

## Pendiente antes de distribución pública

- **Firma de código** (Authenticode en Windows, notarización en macOS).
- **Actualizaciones automáticas firmadas** (`electron-updater` con verificación de firma y canal HTTPS). Hoy la publicación está desactivada (`--publish never`) y la app no se autoactualiza.
- **Fuses de Electron** (`runAsNode` off, `enableNodeOptionsEnvironmentVariable` off, `onlyLoadAppFromAsar` on, integridad del asar).
- Revisión externa del modelo de amenazas.
