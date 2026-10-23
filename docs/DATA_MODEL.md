# Modelo de datos

Base de datos local SQLite (`investor-browser.db`) con migraciones numeradas en `src/main/db.ts` (`PRAGMA user_version`). Nunca se edita una migración publicada: se añade otra.

## v1 — Fase 1 (implementado)

| Tabla | Contenido |
| --- | --- |
| `kv` | Ajustes (`settings`), sesión actual y anterior (`session.current`, `session.previous`), estado de la ventana |
| `bookmarks` | `url`, `title`, `folder`, `created_at` — único por (`url`, `folder`) |
| `history` | `url`, `title`, `visited_at` — visitas repetidas en < 30 s se fusionan |
| `downloads` | Estado de cada descarga; las que estaban en curso al cerrar pasan a `interrupted` |
| `site_permissions` | Decisión `allow`/`deny` por (`origin`, `permission`) |

Los ajustes se validan campo a campo: un valor dañado vuelve a su valor por defecto sin tocar el resto.

## v2 — Fase 2 (implementado; el SQL exacto está en `src/main/db.ts`)

Diferencias con el diseño inicial: el espacio de trabajo se guarda en `companies.saved_tabs` (JSON), el precio manual en `companies.price*`, la tesis en `companies.thesis`, y las cifras viven en `notes` (`kind = 'figure'`, con `CHECK` que exige métrica, periodo, valor y escala). Diseño original:

```sql
CREATE TABLE companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, ticker TEXT, exchange TEXT, country TEXT,
  sector TEXT, ir_url TEXT, cik TEXT, isin TEXT, created_at INTEGER, updated_at INTEGER,
  UNIQUE(ticker, exchange)                 -- distingue homónimos y mercados
);
CREATE TABLE workspaces (id INTEGER PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, tabs_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER);
CREATE TABLE sources (                    -- toda afirmación apunta a una fuente
  id INTEGER PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL, title TEXT, kind TEXT,          -- 'annual_report' | 'filing' | 'presentation' | 'news' | ...
  accessed_at INTEGER NOT NULL, document_date TEXT);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('snippet','figure','note','conclusion','question')),
  body TEXT NOT NULL, quote TEXT, created_at INTEGER, updated_at INTEGER);
```

## v3 — Fase 3 (diseño)

```sql
CREATE TABLE financial_facts (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,            -- 'revenue','operating_income','net_income','cfo','capex','fcf','gross_debt','cash','diluted_shares',...
  period_end TEXT NOT NULL, fiscal_year INTEGER, fiscal_period TEXT,   -- 'FY','Q1'...
  value REAL,                      -- NULL si falta: nunca 0 por defecto
  unit TEXT NOT NULL, currency TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('published','calculated','estimate','user')),
  provider TEXT, source_ref TEXT,  -- p. ej. accession number + etiqueta XBRL
  formula TEXT,                    -- para 'calculated': cómo se obtuvo
  fetched_at INTEGER NOT NULL,
  UNIQUE(company_id, metric, period_end, fiscal_period, origin)
);
CREATE TABLE provider_cache (provider TEXT, key TEXT, body BLOB, fetched_at INTEGER, expires_at INTEGER,
  PRIMARY KEY (provider, key));
```
