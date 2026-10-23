# Contribuir

¡Gracias! Reglas del proyecto, en orden de prioridad:

1. **Seguridad antes que funciones.** Nunca desactives `sandbox`, `contextIsolation` ni la validación IPC para «arreglar» algo. Lee [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
2. **Datos honestos.** Nada de cifras inventadas, valores por defecto a cero ni datos retrasados presentados como actuales. Toda cifra lleva procedencia.
3. **Coste cero.** Ninguna función obligatoria puede requerir una API de pago.
4. **Pequeño y mantenible.** Justifica cada dependencia nueva.

## Puesta en marcha

```bash
npm install
npm run dev
```

## Antes de abrir un PR

```bash
npm run typecheck && npm test && npm run test:e2e
```

- Lógica nueva y pura → `src/shared/` con prueba unitaria en `tests/unit/`.
- Comportamiento del navegador → prueba E2E en `tests/e2e/` contra el servidor local (sin Internet).
- Canal IPC nuevo → esquema en `src/shared/ipc.ts`; tipo de respuesta en `ResponseMap`.
- Cambio de esquema SQLite → **nueva** migración al final de `MIGRATIONS` en `src/main/db.ts`.

### E2E en Linux

Chromium no permite su sandbox ejecutándose como `root` y la app no lo desactiva. Ejecuta las pruebas con un usuario normal:

```bash
xvfb-run -a npm run test:e2e
```

En Ubuntu 24.04+ puede hacer falta permitir *user namespaces* sin privilegios: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.

## Estilo

TypeScript estricto. Comentarios de código en inglés; textos de interfaz y documentación en español. Mensajes de commit en imperativo.
