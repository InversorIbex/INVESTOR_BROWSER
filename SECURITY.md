# Política de seguridad

## Versiones con soporte

| Versión | Soporte |
| --- | --- |
| 0.1.x | ✅ correcciones de seguridad |

## Informar de una vulnerabilidad

**No abras un issue público.** Usa «Report a vulnerability» (GitHub Security Advisories) en este repositorio. Incluye pasos para reproducir, versión, sistema operativo e impacto. Responderemos en un plazo de 7 días.

Especialmente relevante: cualquier forma de que una página web acceda a `window.ib`, a Node, al sistema de archivos o a la base de datos; evasión del bloqueo de esquemas (`file:`, `javascript:`…); omisión de la validación IPC; fugas de datos personales a terceros.

## Estado actual

- Los binarios **no están firmados** y la aplicación **no se actualiza automáticamente**. Descarga versiones solo desde las *Releases* oficiales y comprueba la suma SHA-256 publicada.
- Electron se mantiene en una línea con soporte; actualizaremos con cada parche de seguridad de Chromium.

El diseño completo está en [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
