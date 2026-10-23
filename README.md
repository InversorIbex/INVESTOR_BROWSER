# Investor Browser

> *Everything an investor needs to research a stock, without leaving the browser.*

Navegador de escritorio de código abierto pensado para inversores fundamentales: navegación web real (Chromium), pestañas, favoritos, historial y descargas, sobre una base preparada para investigación de empresas con datos oficiales y gratuitos.

**Estado: v0.2.0 — navegador funcional + investigación por empresa + laboratorio de valoración.** Los datos automáticos de SEC EDGAR llegan en la Fase 3. Consulta [docs/ROADMAP.md](docs/ROADMAP.md).

*English: Open-source desktop browser for fundamental investors. Phase 1 (a real, secure Chromium-based browser) is complete; research workspaces and official-data tools are next. Docs are in Spanish; code and comments are in English.*

---

## Qué funciona hoy

| Área | Funciones |
| --- | --- |
| **Investigación** | Empresas (ticker + bolsa), espacios de trabajo por empresa, «Guardar en investigación» desde cualquier página o PDF (cita + URL + fecha), cifras con métrica/periodo/unidad, preguntas y conclusiones, tesis, exportar/importar |
| **Dossier** | Cifras por periodo en una unidad, origen de cada dato, FCL y deuda neta con fórmula, márgenes, conversión en caja, precio manual fechado, enlaces a 10-K/10-Q/8-K/Form 4 |
| **Valoración** | Múltiplos con motivos cuando no aplican, ajustes para bancos/aseguradoras/REITs, DCF en 3 escenarios, sensibilidad, peso del valor terminal |
| **Confianza** | Distintivo «Fuente oficial» (reguladores y estadística, solo HTTPS) e «IR · TICKER»; `$TICKER` abre el dossier |
| Navegación | Barra de direcciones con búsqueda (DuckDuckGo, Google, Bing, Brave, Startpage), sugerencias de historial/favoritos/pestañas, atrás/adelante/recargar/detener, zoom, imprimir, buscar en la página, herramientas de desarrollo |
| Pestañas | Verticales (estilo Arc) u horizontales, fijar, duplicar, reordenar arrastrando, silenciar, reabrir cerradas (`Ctrl+Shift+T`), `Ctrl+1…9`, menú contextual |
| Sesión | Restauración automática al iniciar (carga diferida de pestañas en segundo plano) y «Restaurar sesión anterior» |
| Biblioteca | Favoritos con carpetas, importar/exportar HTML (Chrome, Edge, Firefox…), historial agrupado por día con búsqueda y borrado por rango, descargas con progreso, pausa y reanudación |
| Interfaz | Paleta de comandos `Ctrl+K`, temas oscuro, **Terminal**, claro y sistema, tamaño de letra, panel lateral redimensionable, panel de contexto, modo foco (`F11` / `Ctrl+\`), barra configurable |
| Seguridad | Pestañas en sandbox sin acceso a Node ni al puente IPC, IPC validado con esquemas, bloqueo de esquemas peligrosos, permisos por sitio, certificados inválidos bloqueados, sin `<webview>` |
| Privacidad | Todo local (SQLite), sin telemetría, historial desactivable, borrar caché/cookies |

## Requisitos

- Node.js **22.12 o superior** (probado con 22.22) y npm 10.
- Windows 10/11 x64 (objetivo principal), Linux x64 o macOS para desarrollo.
- No se necesita ninguna clave de API ni servicio de pago.

## Instalación para desarrollo

```bash
git clone https://github.com/your-user/investor-browser.git
cd investor-browser
npm install          # descarga Electron (~100 MB)
npm run dev          # Vite + recarga del proceso principal + Electron
```

`npm start` compila y arranca la versión de producción sin servidor de desarrollo.

## Pruebas

```bash
npm run typecheck    # TypeScript estricto
npm test             # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas E2E: lanza Electron real y navega un servidor local
npm run test:all     # todo lo anterior
```

Las pruebas E2E no dependen de Internet: levantan un servidor HTTP local con páginas de prueba. En Linux sin pantalla, ejecútalas con `xvfb-run -a npm run test:e2e`. Chromium **no** admite su sandbox ejecutándose como `root`; usa un usuario normal (ver [CONTRIBUTING.md](CONTRIBUTING.md)).

## Compilar el instalador

```bash
npm run dist:win     # Windows x64 → release/Investor-Browser-Setup-<versión>-x64.exe (NSIS)
npm run dist:linux   # Linux → AppImage
npm run dist:dir     # solo la carpeta desempaquetada, para inspección
```

- El instalador de Windows debe compilarse **en Windows** (o en Linux con `wine`). El flujo de GitHub Actions lo compila en `windows-latest` y lo publica como artefacto.
- **El instalador no está firmado.** Windows SmartScreen mostrará un aviso hasta que el proyecto disponga de un certificado de firma de código. Ver [SECURITY.md](SECURITY.md).
- La desinstalación elimina el programa y los accesos directos, pero **conserva tus datos** (`%APPDATA%\Investor Browser`) para no destruir tu investigación por accidente. Bórralos a mano si quieres una limpieza total.

## Dónde se guardan los datos

| Sistema | Ruta |
| --- | --- |
| Windows | `%APPDATA%\Investor Browser\` |
| Linux | `~/.config/Investor Browser/` |
| macOS | `~/Library/Application Support/Investor Browser/` |

La base de datos es `investor-browser.db` (SQLite). Ajustes › Acerca de muestra la ruta exacta. Para un perfil portátil o de pruebas: `IB_USER_DATA=/ruta/perfil npm start`.

## Cambiar el nombre y la marca

1. `src/shared/brand.ts` — nombre, eslogan, color de acento.
2. `package.json` — `productName` y `build.appId`.
3. `python3 scripts/make-icons.py "#HEXCOLOR"` — regenera `build/icon.png` e `icon.ico` (requiere Pillow).
4. `--accent` en `src/renderer/styles/app.css` si cambias el color.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md) · [Modelo de seguridad](docs/SECURITY_MODEL.md) · [Modelo de datos](docs/DATA_MODEL.md)
- [Fuentes de datos gratuitas](docs/DATA_SOURCES.md) · [Hoja de ruta y criterios de aceptación](docs/ROADMAP.md)
- [Privacidad](PRIVACY.md) · [Seguridad](SECURITY.md) · [Contribuir](CONTRIBUTING.md) · [Cambios](CHANGELOG.md) · [Licencias de terceros](THIRD_PARTY_LICENSES.md)

## Licencia

[Apache-2.0](LICENSE). Permite uso, modificación y distribución (también comercial) siempre que se conserven el aviso de copyright y la licencia, se indiquen los cambios relevantes, e incluye una concesión explícita de patentes de los contribuidores. No concede derechos sobre la marca. Ver la sección «Licencia» de [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#licencia) para el razonamiento.

> Investor Browser es una herramienta de investigación. No es asesoramiento financiero y no ejecuta operaciones bursátiles.
