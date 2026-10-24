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

## Fase 4 — Herramientas ✅ (v0.4.0, salvo Crash Replay)

| Herramienta | Estado | Verificación |
| --- | --- | --- |
| Quality Compounder Analyzer | ✅ 7 criterios descomponibles, calidad separada de valoración | Unit (valores a mano: CAGR, ROIC con capital medio) + E2E |
| Financial Forensics | ✅ 10 señales con métrica, periodo, motivo y limitación; lista de lo no detectable | Unit (casos positivos, negativos y sin datos) + E2E |
| Insider Tracker (Form 4) | ✅ Códigos de operación, 10b5-1 (casilla y nota), derivados, resumen por periodo | Unit (estructura de un Form 4 real) + E2E con archivo EDGAR simulado |
| Cross-Tab Research → «Comparar empresas» | ✅ Con datos con procedencia, avisos de periodos y monedas distintos | E2E |
| Valuation Lab | ✅ (v0.2.0) | — |
| Crash Replay | ⏸️ Pendiente | Requiere cotizaciones históricas con licencia gratuita que permita su uso. No se simula. |

Decisión de diseño: «Cross-Tab Research» no extrae el contenido de las pestañas (el encargo pide no suponer que una página contiene datos estructurados). Compara las cifras con procedencia de las empresas vinculadas a las pestañas abiertas.

Pendiente de verificar en un equipo con acceso a sec.gov: lectura de Form 4 reales de 3 emisores (incluido uno con varios titulares en el mismo formulario).

## Fase 5 — Investment Copilot

Sin IA por defecto. Proveedor externo o local configurado por el usuario; claves en `safeStorage`; vista previa y consentimiento antes de enviar contenido; respuestas separadas en hechos verificados / cálculos / interpretación / lo que falta.

## Fase 6 — Calidad y distribución (en curso, v0.5.0)

| Criterio | Estado | Verificación |
| --- | --- | --- |
| *Fuses* de Electron (runAsNode, NODE_OPTIONS, inspect, solo asar, integridad del asar, cookies cifradas) | ✅ | `@electron/fuses read` sobre el ejecutable. Prueba de humo `scripts/smoke-packaged.mjs` en CI (Linux y Windows), que se comprobó que falla si se quitan los *fuses* |
| Firma en Windows sin coste | 🟡 Preparado | Vía Microsoft Store: paquete `.appx` compilado en CI con identidad de prueba. Falta que el titular cree la cuenta, reserve el nombre y haga el envío ([MICROSOFT_STORE.md](MICROSOFT_STORE.md)). **Hasta la certificación, nada está firmado** |
| Actualizaciones | 🟡 | Las gestiona la Store. El `.exe` de GitHub no se autoactualiza: no hay canal de actualización sin firmar |
| UI desde protocolo propio (`app://`) para desactivar `grantFileProtocolExtraPrivileges` | ⏳ | — |
| Pruebas en Windows 10 y 11 reales | ⏳ | La CI usa Windows Server (`windows-latest`). No se ha probado en equipos Windows 10/11 de escritorio |

Decisión: firmar vía Microsoft Store en lugar de comprar un certificado. Los certificados OV cuestan 150–300 $/año y requieren HSM; los EV ya no quitan SmartScreen al instante; Azure Artifact Signing solo admite particulares de EE. UU./Canadá. El encargo prohíbe costes sin aprobación.

## Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Instalador sin firma → aviso de SmartScreen | Alto para adopción | Distribución firmada vía Microsoft Store ([MICROSOFT_STORE.md](MICROSOFT_STORE.md)); el `.exe` de GitHub sigue documentado como sin firmar |
| Política 10.2.1 de la Store: Chromium ≤ 2 versiones mayores por detrás | Alto (retirada de la Store) | Actualizar Electron en cada versión mayor (≈ 8 semanas) |
| Fuse de integridad del asar mal aplicado → la app no arranca | Alto | Prueba de humo del ejecutable empaquetado en CI de Windows antes de publicar |
| `node:sqlite` aún marcado como en evolución por Node | Medio | Encapsulado en `db.ts`; tests de persistencia; driver sustituible |
| Webs que detectan navegadores «no Chrome» | Bajo | UA sin token Electron |
| Variación de etiquetas XBRL | Alto | Mapa de conceptos por prioridad (`src/shared/xbrl.ts`), conceptos usados visibles en cada cifra, campos vacíos en vez de ceros |
| Periodo mal asignado por usar `fy` | Alto | Periodos derivados solo de fechas; test con comparativas reales `fy ≠ periodo` |
| Cambios de condiciones de fuentes de datos | Medio | Fecha de verificación por proveedor; degradación a «no disponible» |
| Ventanas emergentes de inicio de sesión que dependen de `window.opener` | Bajo | Se permiten como ventanas sandbox; bloqueables en Ajustes |
| Atajos de teclado en distribuciones donde `Ctrl+\` requiere AltGr (teclado español) | Bajo | Alternativa `F11` |
| Enlaces de EDGAR por ticker | Medio | Generados con el formato documentado de `browse-edgar`; **no verificados en vivo** desde el entorno de desarrollo (sin acceso a sec.gov). Si se indica el CIK se usa el CIK. |
| Umbrales de calidad y señales forenses | Medio | Son reglas explícitas y visibles, no verdades; documentadas en `src/shared/analysis.ts` y modificables |
| Form 4 con varios titulares | Bajo | Se guardan todos los nombres y roles juntos; la cantidad es la del formulario |
| Interpretación de cifras copiadas | Medio | Siempre es una sugerencia editable; separadores ambiguos se marcan; nunca se guarda sin confirmación del usuario |
