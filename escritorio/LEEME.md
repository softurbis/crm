# Urbis Control — app de escritorio (Windows)

Es **el mismo panel** (`panel.urbisgroupinmobiliaria.com`) en su propia ventana, con el motor
WebView2 de Edge que ya trae Windows 10/11. Usa los mismos datos y los mismos permisos.
Lo que se publica en el panel aparece en la app solo, sin reinstalar. **La web en el navegador
sigue funcionando igual: es el respaldo.**

## Instalar en una PC
1. Pasar `dist\UrbisControl.exe` (un solo archivo, ~1 MB) por WhatsApp o USB.
2. Abrirlo. Si sale **"Windows protegió su PC"**: *Más información* → *Ejecutar de todas formas*
   (pasa porque la app no tiene certificado de firma; es solo la primera vez).
3. Pregunta si se instala → **Sí**. Crea "Urbis Control" en el Escritorio y en Inicio.
4. La primera vez pide la contraseña del panel (la sesión es aparte de la de Chrome).

**Con AVG/Avast:** si la bloquea o la "analiza", agregar una excepción en AVG
(Menú → Configuración → General → Excepciones) para
`%LOCALAPPDATA%\Programs\Urbis Control\UrbisControl.exe`.

## Qué tiene además del navegador
- **Pantalla de bienvenida** al abrir (logo, barra de carga y "By: Ing. César O'Higgins"): se ve
  12 s (desde la 1.2.1, pedido del dueño) con una barra que se llena y mensajes que cambian,
  mientras el panel carga escondido detrás (`Bienvenida.DURACION_MS`; si el panel tarda más de
  30 s, se muestra igual). Se dibuja a mano en `class Bienvenida`.
- Barra de título oscura, del color del panel (Windows 11).
- Recuerda el tamaño y la posición de la ventana (la primera vez abre maximizada).
- Los enlaces a otros sitios (WhatsApp, Google…) se abren en el navegador; imprimir y ver
  vouchers se queda en la app.
- **Clic derecho → "Abrir esta página en el navegador"**: el respaldo a un clic.
- Sin internet muestra una pantalla en español con *Reintentar* y *Abrir en el navegador*.
- Puede guardar la contraseña (como Chrome). F12 abre las herramientas para medir velocidad.

## Desinstalar
Configuración → Aplicaciones → Aplicaciones instaladas → *Urbis Control* → Desinstalar.
Borra el programa, los accesos directos y la sesión guardada.

## Compilar (no hay que instalar nada)
```powershell
powershell -ExecutionPolicy Bypass -File escritorio\compilar.ps1
```
Usa el compilador de C# de .NET Framework 4.8 (viene con Windows) y baja una vez el paquete
oficial `Microsoft.Web.WebView2` de NuGet a `escritorio\paquetes\`. Sale `escritorio\dist\UrbisControl.exe`
con todo adentro. El código está en `UrbisControl.cs` (C# 5: nada de `$""`, `?.` ni `nameof`).

## Avisos de Windows, ícono del reloj y abrir al prender la PC (v1.2)
- El panel le avisa a la app lo pendiente que SUBE (gastos por firmar/pagar, cartas, reclamos,
  prospectos): `src/lib/appEscritorio.js` + el efecto de avisos en `Layout.jsx`. La app lo muestra
  como aviso de Windows si la ventana no está a la vista; al tocarlo, abre esa pantalla.
- Ícono junto al reloj: abrir, **Abrir al prender la PC** (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` con `--minimizada`), salir.
- Una sola copia abierta: abrirla otra vez trae al frente la que ya está.

## Sacar una versión nueva (se actualiza sola desde la 1.2)
Solo hace falta si cambia la app en sí; los cambios del panel llegan solos.
1. Subir `VERSION`, `AssemblyVersion` y `AssemblyFileVersion` en `UrbisControl.cs`.
2. `compilar.ps1`: además del `.exe`, deja `public/app/UrbisControl.exe` y `public/app/version.json`.
3. Publicar el panel (push a main). Cada app 1.2 o más nueva, al abrirse, mira
   `https://panel…/app/version.json`: si hay una más nueva, avisa; al aceptar baja el `.exe`, se
   cierra y la nueva se instala sola (`--actualizar`).
- Quien tenga la **1.1.0** la actualiza una sola vez a mano (abrir el .exe nuevo → "¿Actualizar?").
- Desde el panel en Windows se baja con el botón **💻 App** del pie del menú.

## Argumentos
`--minimizada` (como al prender la PC) · `--actualizar` (la usa la versión vieja al bajar la nueva) ·
`--sin-instalar` (abre sin ofrecer instalar) · `--instalar` (instala sin preguntar) ·
`--desinstalar [--silencioso]` · `--url=https://panel.urbisgroupinmobiliaria.com/<página>`

El panel la reconoce por `UrbisEscritorio/<versión>` al final del `navigator.userAgent`.
