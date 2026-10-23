# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

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
