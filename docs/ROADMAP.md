# Hoja de ruta y criterios de aceptación

## Fase 0 — Auditoría y planificación ✅

Entorno, versiones, arquitectura ([ARCHITECTURE.md](ARCHITECTURE.md)), fuentes ([DATA_SOURCES.md](DATA_SOURCES.md)), esquema ([DATA_MODEL.md](DATA_MODEL.md)), riesgos (abajo).

## Fase 1 — Navegador funcional ✅ (v0.1.0)

| Criterio | Estado | Cómo se verifica |
| --- | --- | --- |
| Navegación web real (URL, búsqueda, atrás/adelante, recargar) | ✅ | E2E «navega por páginas reales…» |
| Pestañas: abrir, cerrar, cambiar, reordenar, fijar, reabrir | ✅ | E2E + uso manual |
| `target=_blank` abre pestaña, no ventana | ✅ | E2E |
| Favoritos e importación/exportación HTML | ✅ | Unit (parser) + E2E (persistencia) |
| Historial con búsqueda y borrado | ✅ | Unit + E2E |
| Descargas sin sobrescribir | ✅ | E2E |
| Restauración de sesión y ajustes tras reiniciar | ✅ | E2E «persisten al reiniciar» |
| Temas, tamaño de letra, pestañas vert./horiz., paneles, modo foco | ✅ | E2E (tema, disposición) + revisión visual |
| Buscar en la página | ✅ | E2E |
| Paleta de comandos | ✅ | E2E |
| Seguridad: aislamiento, IPC validado, esquemas bloqueados | ✅ | E2E + unit |
| Instalador Windows | ⚠️ Configurado; compilado en CI (`windows-latest`). **No probado en una máquina Windows real** por el autor de esta versión. Sin firmar. |

## Fase 2 — Research Workspace (siguiente)

Empresas (con ticker + bolsa para distinguir homónimos), espacios de trabajo que guardan y restauran pestañas, cuaderno (fragmento seleccionado → nota con URL, título y fecha de consulta), fuentes, exportación (JSON + Markdown) y copia de seguridad/restauración del archivo de datos. Botón «Guardar en investigación» en la barra.

**Aceptación:** crear empresa, vincular pestañas, guardar 3 tipos de nota con fuente, reiniciar y recuperar todo; exportar e importar en un perfil vacío.

## Fase 3 — Datos SEC EDGAR

Proveedor EDGAR (`companyfacts`, `submissions`) con `User-Agent` configurable por el usuario, límite ≤ 10 req/s, caché, normalización con procedencia, métricas calculadas con fórmula visible. Validación contra 3 informes 10-K reales.

## Fase 4 — Herramientas

Quality Compounder Analyzer, Financial Forensics, Valuation Lab, Cross-Tab Research, Insider Tracker (Form 4), Crash Replay. Todas con métricas descomponibles y limitaciones explícitas.

## Fase 5 — Investment Copilot

Sin IA por defecto. Proveedor externo o local configurado por el usuario; claves en `safeStorage`; vista previa y consentimiento antes de enviar contenido; respuestas separadas en hechos verificados / cálculos / interpretación / lo que falta.

## Fase 6 — Calidad y distribución

Firma de código, actualizaciones firmadas, fuses de Electron, pruebas en Windows 10 y 11 reales.

## Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Instalador sin firma → aviso de SmartScreen | Alto para adopción | Documentado; firma antes de v1.0 |
| `node:sqlite` aún marcado como en evolución por Node | Medio | Encapsulado en `db.ts`; tests de persistencia; driver sustituible |
| Webs que detectan navegadores «no Chrome» | Bajo | UA sin token Electron |
| Variación de etiquetas XBRL | Alto (Fase 3) | Mapa de etiquetas versionado, campos vacíos en vez de ceros, procedencia por cifra |
| Cambios de condiciones de fuentes de datos | Medio | Fecha de verificación por proveedor; degradación a «no disponible» |
| Ventanas emergentes de inicio de sesión que dependen de `window.opener` | Bajo | Se permiten como ventanas sandbox; bloqueables en Ajustes |
| Atajos de teclado en distribuciones donde `Ctrl+\` requiere AltGr (teclado español) | Bajo | Alternativa `F11` |
