# ============================================================
# Compila la app de escritorio: escritorio\dist\UrbisControl.exe
# ------------------------------------------------------------
# No hace falta instalar nada: usa el compilador de C# que ya trae Windows
# (.NET Framework 4.8) y el paquete oficial de Microsoft para WebView2, que
# se baja una sola vez de NuGet a escritorio\paquetes\.
#
#   powershell -ExecutionPolicy Bypass -File escritorio\compilar.ps1
#
# El .exe sale en UN solo archivo (las librerías de WebView2 van adentro).
# Al subir la versión: cambiar VERSION y AssemblyFileVersion en UrbisControl.cs.
# ============================================================
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$VERSION_WEBVIEW2 = '1.0.4370.26'            # la del motor que trae Windows (158.0.4370)

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $csc)) { throw 'No está el compilador de C# de .NET Framework 4.x' }

# 1. el paquete de WebView2 (una sola vez)
$paq = Join-Path $aqui "paquetes\webview2-$VERSION_WEBVIEW2"
if (!(Test-Path (Join-Path $paq 'lib'))) {
  New-Item -ItemType Directory -Force $paq | Out-Null
  $zip = Join-Path $paq 'paquete.zip'
  Write-Host "Bajando Microsoft.Web.WebView2 $VERSION_WEBVIEW2 de NuGet..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$VERSION_WEBVIEW2/microsoft.web.webview2.$VERSION_WEBVIEW2.nupkg" -OutFile $zip
  Expand-Archive $zip -DestinationPath $paq -Force
  Remove-Item $zip
}
$lib = Get-ChildItem (Join-Path $paq 'lib') -Directory | Where-Object { $_.Name -like 'net4*' } | Sort-Object Name -Descending | Select-Object -First 1
if (!$lib) { throw 'El paquete no trae la versión para .NET Framework' }
$core = Join-Path $lib.FullName 'Microsoft.Web.WebView2.Core.dll'
$winforms = Join-Path $lib.FullName 'Microsoft.Web.WebView2.WinForms.dll'
$cargador = Join-Path $paq 'runtimes\win-x64\native\WebView2Loader.dll'
foreach ($f in $core, $winforms, $cargador) { if (!(Test-Path $f)) { throw "Falta $f" } }

# 2. el ícono (desde el del panel: recortado y con esquinas redondeadas)
$ico = Join-Path $aqui 'urbis.ico'
if (!(Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $src = [Drawing.Image]::FromFile((Join-Path $aqui '..\public\icons\icon-512.png'))
  $fondo = ([Drawing.Bitmap]$src).GetPixel(4, 4)
  $marcos = foreach ($s in 16, 24, 32, 48, 64, 128, 256) {
    $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
    $r = [Math]::Max(2, [int]($s * 0.2)); $d = $r * 2; $w = $s - 1
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($w - $d, 0, $d, $d, 270, 90)
    $p.AddArc($w - $d, $w - $d, $d, $d, 0, 90); $p.AddArc(0, $w - $d, $d, $d, 90, 90); $p.CloseFigure()
    $g.FillPath((New-Object Drawing.SolidBrush $fondo), $p)
    $g.SetClip($p)
    # el logo ocupa ~x98-415 / y143-370 del original de 512: se toma el centro
    $g.DrawImage($src, (New-Object Drawing.Rectangle 0, 0, $s, $s), (New-Object Drawing.Rectangle 72, 72, 368, 368), [Drawing.GraphicsUnit]::Pixel)
    $g.ResetClip()
    if ($s -ge 24) { $g.DrawPath((New-Object Drawing.Pen ([Drawing.Color]::FromArgb(70, 59, 77, 50)), 1), $p) }
    $g.Dispose()
    $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    , @($s, $ms.ToArray())
  }
  $src.Dispose()
  $out = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter $out
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$marcos.Count)
  $offset = 6 + 16 * $marcos.Count
  foreach ($m in $marcos) {
    $lado = if ($m[0] -ge 256) { 0 } else { $m[0] }
    $bw.Write([byte]$lado); $bw.Write([byte]$lado); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$m[1].Length); $bw.Write([UInt32]$offset)
    $offset += $m[1].Length
  }
  foreach ($m in $marcos) { $bw.Write([byte[]]$m[1]) }
  $bw.Flush(); [IO.File]::WriteAllBytes($ico, $out.ToArray())
  Write-Host 'Ícono generado: urbis.ico'
}

# 3. compilar
$dist = Join-Path $aqui 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$exe = Join-Path $dist 'UrbisControl.exe'
$fw = Split-Path $csc
& $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output /codepage:65001 `
  "/out:$exe" "/win32icon:$ico" "/win32manifest:$(Join-Path $aqui 'app.manifest')" `
  "/reference:$core" "/reference:$winforms" `
  "/reference:$(Join-Path $fw 'System.Windows.Forms.dll')" "/reference:$(Join-Path $fw 'System.Drawing.dll')" "/reference:$(Join-Path $fw 'System.Web.Extensions.dll')" `
  "/resource:$core,Microsoft.Web.WebView2.Core.dll" "/resource:$winforms,Microsoft.Web.WebView2.WinForms.dll" "/resource:$cargador,WebView2Loader.dll" `
  (Join-Path $aqui 'UrbisControl.cs')
if ($LASTEXITCODE -ne 0) { throw 'No compiló (ver los errores de arriba)' }
$kb = [Math]::Round((Get-Item $exe).Length / 1KB)
Write-Host "Listo: $exe ($kb KB)" -ForegroundColor Green

# 4. publicarla en el panel: public/app/UrbisControl.exe + version.json (la app mira este
#    archivo al abrir y, si hay una versión más nueva, ofrece actualizarse sola)
$version = ([regex]::Match((Get-Content (Join-Path $aqui 'UrbisControl.cs') -Raw), 'public const string VERSION = "([0-9.]+)"')).Groups[1].Value
if (!$version) { throw 'No encontré VERSION en UrbisControl.cs' }
$app = Join-Path (Split-Path $aqui -Parent) 'public\app'
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item $exe (Join-Path $app 'UrbisControl.exe') -Force
$info = [ordered]@{ version = $version; url = '/app/UrbisControl.exe'; fecha = (Get-Date -Format 'yyyy-MM-dd') }
[IO.File]::WriteAllText((Join-Path $app 'version.json'), ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Write-Host "Copiada al panel: public/app/ (versión $version)" -ForegroundColor Green
