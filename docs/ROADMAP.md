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

## Fase 2 — Research Workspace ✅ (v0.2.0)

| Criterio | Estado | Verificación |
| --- | --- | --- |
| Crear empresa (homónimos por bolsa) | ✅ | Unit + E2E «flujo de investigación» |
| Vincular pestañas, heredar en enlaces, guardar/abrir espacio | ✅ | E2E |
| Guardar selección con URL, título y fecha | ✅ | E2E (mundo aislado + menú contextual + atajo) |
| Cifras con métrica, periodo y unidad; derivadas con fórmula | ✅ | Unit + E2E |
| Persistencia tras reiniciar | ✅ | E2E |
| Exportar e importar en perfil vacío | ✅ | Unit (ida y vuelta) |
| Contenido hostil mostrado como texto | ✅ | E2E |

## Fase 4 (adelantada en parte) — Valuation Lab ✅ básico

Múltiplos, DCF con escenarios y sensibilidad, adaptación sectorial; DCF contrastado con cálculo a mano en tests. Pendiente: comparación histórica de múltiplos (necesita cotizaciones históricas legítimas).

## Fase 3 — Datos SEC EDGAR ✅ (v0.3.0)

| Criterio | Estado | Verificación |
| --- | --- | --- |
| Proveedor gratuito sin clave (`company_tickers`, `submissions`, `companyfacts`) | ✅ | Formatos verificados contra respuestas reales de la SEC (oct. 2026) |
| User-Agent con contacto; ninguna petición sin él | ✅ | Unit + E2E (servidor simulado registra cabeceras) |
| ≤ 10 peticiones/s | ✅ | Unit + E2E (intervalo medido en el servidor ≥ 100 ms) |
| Caché, copia fechada sin conexión, errores claros | ✅ | Unit + E2E (servidor apagado) |
| Datos normalizados con procedencia y fecha | ✅ | Unit (fixture con trampas reales) + E2E |
| No rellenar huecos con ceros | ✅ | Unit + E2E |
| Validación contra 10-K reales en vivo | ⚠️ Pendiente | El entorno de desarrollo no tiene acceso de red a sec.gov. Comprobar en un equipo real con 3 empresas (p. ej. MSFT, KO, NVO) frente a sus 10-K/20-F. |

Pendiente para fases posteriores: cifras trimestrales y TTM, segmentos, notas de deuda (arrendamientos), Form 4 estructurado (Insider Tracker).

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
| Variación de etiquetas XBRL | Alto | Mapa de conceptos por prioridad (`src/shared/xbrl.ts`), conceptos usados visibles en cada cifra, campos vacíos en vez de ceros |
| Periodo mal asignado por usar `fy` | Alto | Periodos derivados solo de fechas; test con comparativas reales `fy ≠ periodo` |
| Cambios de condiciones de fuentes de datos | Medio | Fecha de verificación por proveedor; degradación a «no disponible» |
| Ventanas emergentes de inicio de sesión que dependen de `window.opener` | Bajo | Se permiten como ventanas sandbox; bloqueables en Ajustes |
| Atajos de teclado en distribuciones donde `Ctrl+\` requiere AltGr (teclado español) | Bajo | Alternativa `F11` |
| Enlaces de EDGAR por ticker | Medio | Generados con el formato documentado de `browse-edgar`; **no verificados en vivo** desde el entorno de desarrollo (sin acceso a sec.gov). Si se indica el CIK se usa el CIK. |
| Interpretación de cifras copiadas | Medio | Siempre es una sugerencia editable; separadores ambiguos se marcan; nunca se guarda sin confirmación del usuario |
