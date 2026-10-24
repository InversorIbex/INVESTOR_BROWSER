# Publicar en Microsoft Store (firma sin coste)

**Por qué la Store:** un instalador `.exe` sin firmar muestra el aviso de SmartScreen. Los certificados de firma cuestan entre 120 € y 300 € al año, y desde 2024 ni siquiera los EV quitan el aviso de inmediato. En cambio, **Microsoft firma los paquetes que certifica la Store**: quien instala desde allí no ve ningún aviso. Desde septiembre de 2025, el registro de desarrollador individual es **gratuito**.

Este documento explica lo que tiene que hacer **el titular del proyecto con su propia cuenta**. Ni el código ni la CI pueden hacerlo por él.

> Estado: preparado, todavía **no publicado**. El paquete para la Store se compila en CI, pero hasta que se haga el envío y Microsoft lo certifique la app **no está firmada** y no debe presentarse como firmada.

## Qué está preparado en el repositorio

| Pieza | Dónde |
| --- | --- |
| Destino `appx` de electron-builder (nombre, idiomas es-ES/en-US, logotipos) | `package.json` › `build.appx`, `build/appx/*.png` |
| Comprobación en cada CI de que el paquete se compila (con identidad ficticia, no se publica) | `.github/workflows/ci.yml` |
| Paquete real en cada release, si están configuradas las variables de identidad | `.github/workflows/release.yml` |
| *Fuses* de Electron y prueba de humo de la app empaquetada | `package.json` › `build.electronFuses`, `scripts/smoke-packaged.mjs` |
| Política de privacidad (exigida por la Store para apps Win32, política 10.5.1) | [`PRIVACY.md`](../PRIVACY.md) |

El paquete **no se firma** a propósito: electron-builder lo genera sin firma (*Windows Store only build*) y Microsoft lo firma al certificarlo. No hace falta ningún certificado ni ningún secreto.

## Paso 1 · Crear la cuenta de desarrollador (gratis)

1. Ve a <https://storedeveloper.microsoft.com> y elige **cuenta individual**.
2. Inicia sesión con tu cuenta personal de Microsoft.
3. Completa la verificación de identidad: documento oficial y selfi. No se pide tarjeta de crédito.

## Paso 2 · Reservar el nombre

1. En **Partner Center › Apps y juegos › Nuevo producto**, elige **Aplicación MSIX o PWA**.
2. Reserva **Investor Browser**.
   - Si el nombre está ocupado, reserva otro.
   - Cámbialo después en `src/shared/brand.ts`, en `productName` y en `build.appx.displayName` de `package.json`.
   - La marca está centralizada para que este cambio sea sencillo.

## Paso 3 · Copiar la identidad del producto

En **Partner Center › (tu app) › Administración de productos › Identidad del producto** aparecen tres valores:

| Partner Center | Variable de GitHub | Ejemplo (no usar) |
| --- | --- | --- |
| `Package/Identity/Name` | `MSSTORE_IDENTITY_NAME` | `12345NombreEditor.InvestorBrowser` |
| `Package/Identity/Publisher` | `MSSTORE_PUBLISHER` | `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX` |
| `Package/Properties/PublisherDisplayName` | `MSSTORE_PUBLISHER_DISPLAY_NAME` | `Tu nombre de editor` |

Guárdalos en GitHub: **Settings › Secrets and variables › Actions › pestaña *Variables* › New repository variable**.

Son **variables, no secretos**: Microsoft los muestra públicamente en la ficha de la Store y no dan acceso a nada.

## Paso 4 · Generar el paquete

En GitHub ve a **Actions › Release (Windows installer) › Run workflow**. El flujo reconstruye la versión actual y añade a la release el archivo `Investor-Browser-<versión>-x64-store.appx`.

En las versiones siguientes, basta con subir `version` en `package.json`.

> El `.appx` **no se instala con doble clic** porque no está firmado. Solo sirve para subirlo a Partner Center.

## Paso 5 · Hacer el envío

En **Partner Center › (tu app) › Iniciar envío**:

1. **Precios y disponibilidad:** gratis. Elige los mercados.
2. **Propiedades:**
   - Categoría: *Productividad* o *Negocios*.
   - URL de la política de privacidad: `https://github.com/InversorIbex/INVESTOR_BROWSER/blob/main/PRIVACY.md`
   - Sitio web: la página del repositorio.
3. **Clasificación por edades:** responde con sinceridad al cuestionario IARC. Un navegador da **acceso sin restricciones a Internet** y debe declararse así. Es normal que eso suba la clasificación.
4. **Paquetes:** sube el `.appx` de la release.
5. **Descripción de la Store** (es-ES y en-US):
   - Usa el texto del README.
   - Las capturas de `docs/screenshots/` sirven tal cual: miden 1440×900 y la Store exige al menos 1366×768.
   - Indica que **no es asesoramiento financiero** y que **no ejecuta operaciones**.
6. **Opciones de envío › capacidad restringida `runFullTrust`:** la Store pide justificarla. Texto propuesto:
   > Aplicación de escritorio (Electron/Chromium) empaquetada en MSIX. Necesita ejecutarse como proceso de escritorio de confianza completa para usar su motor Chromium, que aísla cada página web en procesos con sandbox. No instala servicios, controladores ni software adicional.
7. Envía. La certificación suele tardar desde unas horas hasta unos días hábiles. Si la rechazan, el informe indica la política concreta.

## Políticas de la Store que afectan a un navegador

Versión 7.20, vigente desde el 22 de octubre de 2026:

- **10.2.1:** un navegador debe usar **Chromium o Gecko** y estar, como mucho, **2 versiones mayores** por detrás de la última versión de ese proyecto.
  - Electron 44 incluye Chromium 152, así que hoy la app cumple.
  - **Mantener Electron actualizado es obligatorio** para seguir en la Store.
  - Cada versión mayor de Electron sale aproximadamente cada 8 semanas.
- **10.2.2:** no se puede descargar y ejecutar código que cambie la funcionalidad. La app no lo hace: la UI va empaquetada y las webs se ejecutan con sandbox, sin privilegios.
- **10.2.9:** el instalador debe ser autónomo, no un descargador. El `.appx` contiene la app completa.
- **10.5.1:** las apps Win32 deben tener política de privacidad. Ver `PRIVACY.md`.
- **10.8.3:** una cuenta individual no puede publicar apps que **pidan información financiera** (cuentas bancarias, claves de API de brókeres, etc.) para su función principal. La app no la pide. **Ojo con la Fase 5 y siguientes:** si algún día se conecta a un bróker, habría que publicar desde una cuenta de empresa.

## Diferencias del paquete de la Store

- **Datos:** Windows guarda los datos de las apps MSIX en una carpeta privada del paquete y **los borra al desinstalar**. En cambio, el instalador `.exe` los conserva.
  - Antes de desinstalar, usa **Ajustes › Privacidad y datos › Investigación › Exportar JSON**, que luego se puede importar.
  - La **copia completa `.db`** se puede crear, pero la app todavía no la restaura.
  - Los datos del `.exe` y los de la Store son independientes. Para pasar tu investigación de uno a otro, exporta el JSON en uno e impórtalo en el otro. Ajustes, favoritos e historial no se traspasan.
- **Actualizaciones:** las gestiona la Store. El `.exe` de GitHub no se actualiza solo.
- **Descargas** y **diálogos de archivo** funcionan igual: la app se ejecuta con confianza completa.

## Mientras tanto: el aviso del `.exe` de GitHub

Al descargar `Investor-Browser-Setup-x.y.z-x64.exe` pueden aparecer dos avisos:

1. **«Sin confirmar» en el navegador (Edge o Chrome).** El navegador retiene la descarga porque el archivo es poco común y no está firmado.
   - Abre el panel de descargas (`Ctrl+J`) y elige **Conservar**. En Edge está en el menú «…» del archivo; si insiste, en **Mostrar más › Conservar de todos modos**.
2. **SmartScreen al abrirlo.** Pulsa **Más información → Ejecutar de todas formas**.

Antes de hacerlo, puedes comprobar que el archivo es el publicado. En PowerShell, ejecuta `Get-FileHash <archivo> -Algorithm SHA256` y compara el resultado con `SHA256SUMS.txt` de la release.
