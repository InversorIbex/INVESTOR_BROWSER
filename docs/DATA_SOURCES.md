# Fuentes de datos gratuitas — evaluación (Fase 0)

Restricción del proyecto: **0 € de coste de datos**, sin scraping que incumpla condiciones, sin presentar datos retrasados como tiempo real, sin inventar cifras. Que una fuente sea gratuita **no** implica que se pueda redistribuir: la app descarga datos **en el equipo del usuario** para su uso personal y nunca los republica.

Comprobado el 23/10/2026. Las condiciones cambian: cada proveedor guardará en la app su «fecha de última verificación».

## Fundamentales (prioridad)

| Fuente | Datos | Acceso | Límites y condiciones | Uso previsto |
| --- | --- | --- | --- | --- |
| **SEC EDGAR** (`data.sec.gov`) ✅ implementado | 10-K, 10-Q, 8-K, Form 4, hechos XBRL (`companyfacts`, `companyconcept`, `frames`), `submissions` | Sin clave. JSON | Máx. **10 peticiones/s**; cabecera `User-Agent` con nombre y correo de contacto; descargar solo lo necesario. Fuente: [Accessing EDGAR Data](https://www.sec.gov/os/accessing-edgar-data) | v0.3.0: `company_tickers.json`, `submissions` y `companyfacts`. Ver «Cómo usa la app la SEC». |
| **filings.xbrl.org** (XBRL International) ✅ v0.6.0 | Informes anuales oficiales **ESEF** (UE) y UKSEF en xBRL-JSON | Sin clave. JSON:API + xBRL-JSON | Gratuito; «At present, there are no restrictions on the ways that the data can be used» (oct. 2026). Piden User-Agent con contacto. Cobertura: España (CNMV), Francia, Italia, Países Bajos, Dinamarca, Reino Unido, etc. **Sin Alemania** (no descargable de forma fiable) **ni Suiza** (no está en ESEF). Los informes llegan al repositorio con retraso respecto a su publicación. | Cifras anuales consolidadas con procedencia (visor oficial), re-expresiones entre informes. |
| Informes de empresa (IR) | Informes anuales y trimestrales de cualquier país | Navegación normal + cuaderno manual | Las del propio sitio | Fase 2: guardar fragmentos y cifras con URL y fecha de consulta. Sin extracción automática no verificada. |
| ESMA / registros nacionales (CNMV, etc.) | Información regulada europea | Web pública; algunos registros ofrecen descargas | Variables por país; muchos sin API | Enlaces directos desde la app; integración solo donde haya acceso permitido documentado. |

**Riesgo XBRL:** las etiquetas varían entre empresas y años (`Revenues` vs `RevenueFromContractWithCustomerExcludingAssessedTax`…). El normalizador debe registrar qué etiqueta usó y dejar el campo vacío —nunca a cero— si no hay correspondencia segura.

### Cómo usa la app la SEC (v0.3.0)

- Formatos comprobados con respuestas reales:
  - `company_tickers.json`: `{"0":{"cik_str":…,"ticker":…,"title":…}}`.
  - `submissions`: `cik` con ceros y `filings.recent` en arrays por columnas.
  - `companyconcept`/`companyfacts`: hechos `{start?, end, val, accn, fy, fp, form, filed, frame?}`.
- `fy`/`fp` describen el documento que presenta el dato, no el periodo. Un 10-K de 2009 presenta el saldo de 2008 con `fy: 2009`. Por eso el periodo se calcula con `start`/`end`.
- Un periodo es anual si dura entre 350 y 380 días. El ejercicio se etiqueta por el año natural en que termina, salvo los que terminan en los primeros días de enero, que cuentan como del año anterior.
- Si varios documentos presentan el mismo periodo, gana el más reciente. Si el valor cambió, se marca como re-expresado.
- Los conceptos usados para cada métrica, por orden de preferencia, están en `CONCEPT_MAP` (`src/shared/xbrl.ts`). Se aceptan PR con conceptos adicionales y su justificación.

## Macro

| Fuente | Acceso | Condiciones |
| --- | --- | --- |
| **FRED** (Fed de St. Louis) | Clave gratuita (el usuario la introduce; nunca en el repositorio) | Límite de frecuencia por clave (del orden de 120 peticiones/min según documentación de terceros; verificar en los términos oficiales). Algunas series tienen copyright de terceros: mostrar la nota de copyright de cada serie y no redistribuir. Docs: https://fred.stlouisfed.org/docs/api/fred/ |
| **Treasury Fiscal Data** | API pública sin clave | Datos del Gobierno de EE. UU. |
| **Eurostat** | API pública sin clave | Reutilización permitida con atribución (política de reutilización de la Comisión Europea). |

## Cotizaciones, divisas y calendario (v0.6.0)

No existe una fuente gratuita, sin clave y con permiso de uso automático que cubra EE. UU. y Europa. Implementado:

| Fuente | Qué | Acceso | Límites (plan gratuito, oct. 2026) | Notas |
| --- | --- | --- | --- | --- |
| **Finnhub** | Último precio de acciones de EE. UU.; calendario de resultados | **Clave gratuita del usuario**, enviada en cabecera `X-Finnhub-Token` | ~60 consultas/min | Una llamada al calendario cubre todas las empresas. |
| **EODHD** | Precio retrasado 15 min de cualquier bolsa; historial de dividendos | **Clave gratuita del usuario** (`api_token`; EODHD no ofrece cabecera) | 20 consultas/día (+500 de bienvenida); uso personal | La app lleva la cuenta y **nunca supera el cupo que fijes**. Dividendos: 1 consulta por empresa, guardada 30 días. |
| **BCE** (`data-api.ecb.europa.eu`) | Tipos de cambio de referencia del euro | Sin clave | Publicación diaria | Para convertir precio y cuentas a la misma moneda y valorar la cartera en euros. |
| **Captura manual** | Cualquier web que estés leyendo | Clic derecho sobre el precio › «Usar como cotización» | — | Siempre con confirmación; se guarda la web como fuente y la hora. |

Reglas: cada precio muestra proveedor, hora del dato y cómo se obtuvo («retrasado», «capturado», «manual»); **nunca** se presenta como tiempo real. Las claves se guardan cifradas por el sistema operativo y nunca se muestran, registran ni exportan. Formatos de Finnhub, EODHD y BCE tomados de su documentación: **no verificados en vivo** desde el entorno de desarrollo (sin acceso de red a esos dominios); el análisis es defensivo y un dato no reconocido se descarta, nunca se rellena.

**Descartado:**
- stockanalysis.com: sus condiciones (18/09/2026) prohíben el acceso automático por programas («bots, scripts, scrapers… or any other automated or programmatic methods»).
- Yahoo Finance y similares sin API oficial.
- Twelve Data gratuito: solo EE. UU. y «internal non-display usage only».
- Stooq: condiciones de uso automático no verificadas.

**Calendario:** las fechas confirmadas vienen de Finnhub (resultados de EE. UU.) y EODHD (dividendos). El resto se **estima** con la periodicidad de las presentaciones de la propia empresa (10-Q/10-K o informes ESEF) o de sus dividendos anteriores, y se marca «Estimada» con el motivo.

## Diseño del sistema de proveedores (Fase 3)

```ts
interface DataProvider {
  id: string; name: string;
  dataTypes: ('fundamentals' | 'filings' | 'insiders' | 'macro' | 'prices')[];
  coverage: string;           // p. ej. 'US (SEC registrants)'
  updateFrequency: string;
  limits: { requestsPerSecond?: number; requestsPerDay?: number };
  license: string;            // texto + URL de las condiciones
  requiresKey: boolean;
  status(): Promise<'ok' | 'degraded' | 'unavailable' | 'needs-key'>;
  lastVerified: string;       // fecha de revisión de condiciones
}
```

Cada valor almacenado lleva: proveedor, URL o identificador del documento de origen, periodo fiscal, unidad, moneda, fecha de obtención y **tipo** (`publicado` | `calculado` | `estimación` | `usuario`).
