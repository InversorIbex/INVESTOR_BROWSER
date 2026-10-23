# Fuentes de datos gratuitas — evaluación (Fase 0)

Restricción del proyecto: **0 € de coste de datos**, sin scraping que incumpla condiciones, sin presentar datos retrasados como tiempo real, sin inventar cifras. Que una fuente sea gratuita **no** implica que se pueda redistribuir: la app descarga datos **en el equipo del usuario** para su uso personal y nunca los republica.

Comprobado el 23/10/2026. Las condiciones cambian: cada proveedor guardará en la app su «fecha de última verificación».

## Fundamentales (prioridad)

| Fuente | Datos | Acceso | Límites y condiciones | Uso previsto |
| --- | --- | --- | --- | --- |
| **SEC EDGAR** (`data.sec.gov`) | 10-K, 10-Q, 8-K, Form 4, hechos XBRL (`companyfacts`, `companyconcept`, `frames`), `submissions` | Sin clave. JSON | Máx. **10 peticiones/s**; cabecera `User-Agent` con nombre y correo de contacto; descargar solo lo necesario. Fuente: [Accessing EDGAR Data](https://www.sec.gov/os/accessing-edgar-data) | **Fase 3, primer proveedor.** Datos normalizados con referencia al formulario (`accn`), periodo fiscal y unidad. |
| Informes de empresa (IR) | Informes anuales y trimestrales de cualquier país | Navegación normal + cuaderno manual | Las del propio sitio | Fase 2: guardar fragmentos y cifras con URL y fecha de consulta. Sin extracción automática no verificada. |
| ESMA / registros nacionales (CNMV, etc.) | Información regulada europea | Web pública; algunos registros ofrecen descargas | Variables por país; muchos sin API | Enlaces directos desde la app; integración solo donde haya acceso permitido documentado. |

**Riesgo XBRL:** las etiquetas varían entre empresas y años (`Revenues` vs `RevenueFromContractWithCustomerExcludingAssessedTax`…). El normalizador debe registrar qué etiqueta usó y dejar el campo vacío —nunca a cero— si no hay correspondencia segura.

## Macro

| Fuente | Acceso | Condiciones |
| --- | --- | --- |
| **FRED** (Fed de St. Louis) | Clave gratuita (el usuario la introduce; nunca en el repositorio) | Límite de frecuencia por clave (del orden de 120 peticiones/min según documentación de terceros; verificar en los términos oficiales). Algunas series tienen copyright de terceros: mostrar la nota de copyright de cada serie y no redistribuir. Docs: https://fred.stlouisfed.org/docs/api/fred/ |
| **Treasury Fiscal Data** | API pública sin clave | Datos del Gobierno de EE. UU. |
| **Eurostat** | API pública sin clave | Reutilización permitida con atribución (política de reutilización de la Comisión Europea). |

## Cotizaciones

No existe una fuente gratuita, fiable y sin restricciones de cotizaciones en tiempo real. Decisión:

1. **Por defecto: «Cotización no disponible» + entrada manual** (con fecha y fuente que indique el usuario). Nunca se rellena un precio.
2. **Opcional, con clave propia del usuario:** proveedores con nivel gratuito y API documentada (p. ej. Alpha Vantage: 25 peticiones/día y 5/min con clave gratuita según [Macroption](https://www.macroption.com/alpha-vantage-api-limits/) — insuficiente para uso intensivo). Cada precio mostrará fuente, moneda, fecha/hora y la etiqueta «retrasado/histórico».
3. **Descartado:** Yahoo Finance y similares sin API oficial (sus condiciones no permiten el acceso automatizado), y cualquier scraping de páginas de cotización.

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
