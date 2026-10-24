# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [0.6.0] — 2026-10-24

### Añadido
- **Empresas europeas automáticas (ESEF)**: cuentas anuales oficiales desde filings.xbrl.org, con búsqueda por nombre o LEI, re-expresiones, visor oficial y avisos de cobertura. Alemania y Suiza no tienen fuente automática.
- **Cotizaciones retrasadas** con clave gratuita propia:
  - Finnhub (EE. UU.) y EODHD (cualquier bolsa, 15 min), con claves cifradas por el sistema y cupo diario que nunca se supera;
  - captura de precio desde cualquier web (clic derecho);
  - tipos de cambio del BCE y conversión de divisa en calidad, comparación y valoración.
- **Cartera y seguimiento** (`ib://portfolio`):
  - FIFO, comisiones y efecto divisa;
  - ganancias realizadas por año, foto diaria, evolución y reparto;
  - precio objetivo en la lista de seguimiento;
  - importación JSON y CSV del bróker, y exportación.
- **Screener** (`ib://screener`): métricas oficiales con procedencia, 8 estrategias, filtros por rango, puntuaciones percentiles, mapa calidad/precio e importación masiva de cifras oficiales.
- **Calendario bursátil** (`ib://calendar`): resultados y dividendos confirmados o estimados (siempre etiquetados), fechas propias y exportación `.ics`.
- Métrica D&A (para EBITDA) y deuda bruta IFRS por componentes.

### Corregido
- La tabla de ROIC ya no queda tapada por el panel lateral: se desplaza dentro de su tarjeta.

## [0.5.0] — 2026-10-24

### Añadido — Fase 6 (primera parte): endurecimiento y distribución
- **Electron *fuses*** en el ejecutable distribuido:
  - `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS` y `--inspect` se ignoran;
  - solo se carga código desde `app.asar`, con validación de integridad en Windows;
  - cookies cifradas en disco.
- **Prueba de humo de la app empaquetada** (`scripts/smoke-packaged.mjs`), en CI de Linux y Windows y antes de cada release. Arranca el ejecutable real con variables hostiles y comprueba que la UI carga desde `app.asar` y que el IPC responde.
- **Paquete para Microsoft Store** (`npm run dist:store`, destino `appx`) con logotipos propios. La CI lo compila con una identidad de prueba en cada cambio. La release lo genera con la identidad real cuando se configuran las variables `MSSTORE_*`. Guía paso a paso en [docs/MICROSOFT_STORE.md](docs/MICROSOFT_STORE.md).

### Cambiado
- Las notas de la release y el README explican el aviso «Sin confirmar» del navegador y el de SmartScreen.
- `actions/upload-artifact` v5.

### Sin cambios
- **Nada está firmado todavía.** El `.exe` de GitHub sigue sin firma. La firma llegará cuando Microsoft certifique el envío a la Store.

## [0.4.0] — 2026-10-24

### Añadido — Fase 4: herramientas de análisis
- **Quality Compounder Analyzer** (pestaña «Calidad» del dossier): siete criterios independientes (crecimiento, margen y tendencia, conversión en FCL, ROIC, endeudamiento, dilución, estabilidad). Cada uno muestra veredicto, valor, regla, fórmula, ejercicios y las cifras usadas con su origen. **Sin puntuación opaca**: «X de Y criterios fuertes» y los no evaluables se cuentan aparte. La valoración se muestra **separada** de la calidad.
- **ROIC por ejercicio** con NOPAT, tipo impositivo efectivo y capital invertido medio. No se estima nada que falte.
- **Financial Forensics** (pestaña «Forense»), con diez señales:
  - beneficio que sube con caja que baja;
  - conversión en caja baja de forma persistente;
  - devengos (Sloan);
  - cuentas por cobrar o inventarios que crecen más que las ventas;
  - aumento de deuda;
  - dilución;
  - deterioro de márgenes;
  - SBC elevado;
  - cifras re-expresadas.

  Cada señal indica la métrica, los periodos, por qué importa y sus limitaciones, y nunca habla de fraude. También enumera lo que XBRL no puede detectar (políticas contables, ajustes no recurrentes, opinión del auditor).
- **Insider Tracker** (pestaña «Insiders»):
  - lee los **Form 4** del archivo de EDGAR;
  - distingue compras y ventas discrecionales, ventas con **plan 10b5-1** (por la casilla del formulario o por la nota al pie en formularios antiguos), concesiones, ejercicios, retenciones fiscales y derivados;
  - resumen para 12 meses, 24 meses o todo lo cargado, con detalle por operación y enlace al formulario.
- **Comparar empresas** (`ib://compare`, paleta «Comparar empresas»): hasta cinco empresas lado a lado con márgenes, crecimiento, ROIC, conversión, apalancamiento, dilución, calidad, señales forenses y rentabilidad de FCL.
  - Avisa si los ejercicios, los cierres fiscales o las monedas no coinciden.
  - Lo que no tiene procedencia aparece como «Pendiente».
- Nuevas métricas XBRL (US-GAAP e IFRS): cuentas por cobrar, inventarios, activo total, patrimonio neto, SBC, impuesto sobre beneficios y beneficio antes de impuestos. En el dossier aparecen bajo «Ver balance y detalle».
- **Crash Replay** aparece como **pendiente**: requiere cotizaciones históricas con una licencia gratuita que lo permita.

### Seguridad
- Lector XML propio y mínimo para los Form 4. No procesa DOCTYPE ni entidades propias, así que no hay expansión de entidades ni XXE. Tiene límites de tamaño, profundidad y nodos, y lo prueban documentos hostiles.
- Los Form 4 se descargan con el mismo cliente SEC: contacto declarado, como máximo 8 peticiones por segundo y nombres de archivo validados. Se guardan en caché un año, porque los documentos presentados no cambian.
- Un Form 4 de otro emisor se rechaza.
- Los enlaces a la versión legible del Form 4 (`xslF345X05/…`) se aceptan solo con un patrón estricto.

### Corregido
- La comparación y el dossier podían mostrar un número distinto de señales forenses (no se pasaban las re-expresiones).
- «0 señales» con datos insuficientes ahora es «Pendiente».

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
