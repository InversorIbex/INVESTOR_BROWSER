# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [0.3.0] — 2026-10-23

### Añadido — Fase 3: datos oficiales de SEC EDGAR
- **Vincular empresa con la SEC** por ticker o nombre (`company_tickers.json`): rellena CIK, nombre registrado, cierre fiscal y, solo si estaban vacíos, bolsa y sector.
- **Importar cifras XBRL** (`companyfacts`) de los últimos 10 ejercicios anuales: ingresos, beneficio bruto, operativo y neto, flujo de caja operativo, CAPEX, caja, deuda, acciones diluidas, BPA y dividendo por acción. US-GAAP e **IFRS** (emisores extranjeros con 20-F/40-F, en su moneda).
- **Procedencia completa en cada cifra**: documento, fecha de presentación, concepto XBRL, periodo exacto y número de registro, con enlace al documento en EDGAR.
- **Detección de re-expresiones**: si un informe posterior cambió la cifra de un ejercicio, se marca con ⚠ y se muestra el valor original.
- **Presentaciones en la SEC** (`submissions`): anuales, trimestrales, 8-K, insiders y juntas, abiertas en pestañas vinculadas a la empresa.
- El laboratorio de valoración carga las cifras oficiales indicando «SEC» como origen.
- **Ajustes › Fuentes de datos**: contacto para la SEC, estado, consultas realizadas y caché.

### Diseño de datos
- Los periodos se derivan de las fechas `start`/`end`; **nunca** del campo `fy`, que corresponde al documento que presenta el dato (trampa verificada con respuestas reales).
- Solo informes anuales (10-K, 20-F, 40-F y enmiendas); los trimestrales y saldos intermedios no se mezclan.
- Se usa el valor del informe más reciente; los huecos se quedan vacíos, nunca a cero; la deuda solo se suma desde componentes cuando no hay total etiquetado, y se indica.
- Tus cifras del cuaderno tienen prioridad sobre las oficiales del mismo periodo.

### Seguridad y acceso justo
- **Ninguna petición sin tu contacto** declarado (nombre y correo), como exige la SEC. Se envía solo a `sec.gov`/`data.sec.gov`.
- Máximo **8 peticiones/s** medidas desde el final de la anterior (límite de la SEC: 10/s), cola serie, tiempo máximo de 30 s y tamaño máximo de 80 MB.
- Caché en SQLite (tickers 7 días, presentaciones 6 h, cifras 12 h) y copia fechada si la SEC no responde.
- Sesión de red propia sin cookies; redirecciones solo dentro de `sec.gov`; URLs de documentos validadas.

### Corregido
- `npm run build` muestra «Ejecuta primero npm install» en lugar de un error críptico si faltan dependencias.
- Con dos paneles abiertos, los filtros de presentaciones provocaban desplazamiento horizontal.

## [0.2.0] — 2026-10-23

### Añadido — Fase 2 (investigación) y primera herramienta de la Fase 4
- **Empresas** con ticker + bolsa (los homónimos en distintas bolsas son empresas distintas), país, sector, tipo de negocio, web de inversores y CIK.
- **Espacios de trabajo**: pestañas vinculadas a una empresa (color y ticker en la barra lateral), «Guardar y cerrar espacio» y «Abrir espacio». Los enlaces abiertos desde una pestaña de empresa heredan la empresa.
- **Cuaderno con procedencia**: clic derecho → «Guardar en investigación…» o `Ctrl+Shift+S`. Cada cita guarda URL, título y fecha de consulta. Tipos: fragmento, cifra, nota, conclusión y pregunta (con resolución).
- **Cifras**: «Guardar como cifra…» interpreta números de informes (`$245,122 million`, `1.234,5 M€`, `(12,345)`…), avisa si el separador es ambiguo y exige métrica, periodo y unidad.
- **Dossier de empresa** (`ib://company/N`): cifras clave por periodo en una sola unidad, puntos de origen (publicado / cálculo propio / tuyo / estimación), FCL y deuda neta derivados con fórmula visible, márgenes y conversión en caja, precio manual con fecha y fuente, tesis con autoguardado, preguntas pendientes, fuentes consultadas y enlaces a EDGAR (10-K, 10-Q, 8-K, Form 4, 20-F).
- **Laboratorio de valoración** (`ib://valuation`): múltiplos con fórmula y motivo cuando no aplican, adaptación a bancos, aseguradoras y REITs, DCF con tres escenarios, peso del valor terminal y tabla de sensibilidad. Carga cifras guardadas indicando su origen y puede guardar el resultado como conclusión.
- **Señales de confianza** en la barra de direcciones: «Fuente oficial» (SEC, CNMV, ESMA, BCE, Banco de España, FRED…, solo HTTPS y dominio exacto) e «IR · TICKER» en la web de inversores de tus empresas.
- `$TICKER` en la barra de direcciones abre el dossier; las empresas aparecen en sugerencias y en la paleta.
- **Panel de investigación** (`Ctrl+.`): empresa de la pestaña, guardar selección, nota rápida, notas de esta página; sugiere vincular cuando estás en su web IR.
- **Tema Terminal** (negro y ámbar, denso) y tema oscuro grafito refinado.
- Exportar investigación a Markdown y JSON, importar JSON validado y copia de seguridad completa de la base de datos.

### Corregido
- `Esc` no cerraba el diálogo de guardado si se abría con el teclado.
- Una actualización parcial de empresa podía borrar campos no enviados (prevenido antes de publicar; test de regresión).

### Seguridad
- La selección se lee desde un **mundo JavaScript aislado**: la página no puede falsearla ni recibe código.
- Citas y notas se muestran siempre como texto (test E2E con `<script>` e `<img onerror>`).
- Fuentes, webs de inversores y pestañas guardadas solo admiten `http(s)`; la importación valida cada campo y descarta URLs peligrosas.
- `Ctrl+Shift+V` no se usa para no robar «pegar sin formato».

## [0.1.0] — 2026-10-23

### Añadido — Fase 1: navegador funcional
- Navegación real con Chromium (Electron 44) y una `WebContentsView` aislada por pestaña.
- Barra de direcciones con búsqueda configurable y sugerencias (historial, favoritos, pestañas abiertas).
- Pestañas verticales u horizontales: fijar, duplicar, reordenar, silenciar, reabrir cerradas, `Ctrl+1…9`.
- Restauración de sesión con carga diferida; «Restaurar sesión anterior».
- Favoritos con carpetas e importación/exportación HTML; historial por días; gestor de descargas.
- Paleta de comandos (`Ctrl+K`), buscar en la página, zoom, modo foco, panel de contexto.
- Temas oscuro/claro/sistema, tamaño de letra, barra de herramientas configurable.
- Permisos de sitios con decisión guardada y revocable.
- SQLite local integrado (`node:sqlite`) con migraciones y recuperación ante base de datos dañada.
- Pruebas unitarias (Vitest) y E2E con Electron real (Playwright).

### Seguridad
- Sandbox en todos los renderizadores, sin Node en UI ni pestañas, IPC validado con Zod y comprobación de remitente.
- Bloqueo de `file:`, `javascript:` y otros esquemas; protocolos externos solo con confirmación.
- Sin telemetría.
