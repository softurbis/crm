<# : Diagnostico de la PC para Urbis Control (esta parte la lee cmd; el resto es PowerShell)
@echo off
title Diagnostico de la PC - Urbis Control
set "URBIS_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:URBIS_SELF,[Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>

# ============================================================
# DIAGNÓSTICO DE LA PC — URBIS CONTROL
# ------------------------------------------------------------
# Para cuando el panel anda lento en UNA computadora y en otra no.
# El servidor y la base son los mismos para todos: si una PC demora más,
# la diferencia está en esa PC, su internet o su navegador.
#
# Qué hace (no necesita ser administrador, no instala nada):
#  1. Mide el equipo: RAM libre, disco, días sin reiniciar, batería y
#     modo de energía, y una prueba de cálculo para comparar procesadores.
#  2. Mira qué programas están comiendo procesador y red en este momento.
#  3. Antivirus (muchos revisan cada página y cada archivo que se sube).
#  4. Navegadores: versión, extensiones, aceleración por hardware, tamaño
#     de la caché.
#  5. Internet: Wi-Fi, VPN/proxy, ping, tiempo hasta el panel, la API y el
#     servidor de archivos, y velocidad de bajada y de SUBIDA.
#  6. Deja un informe .txt en el Escritorio para mandarlo por WhatsApp.
#  7. AL FINAL, y solo si la persona dice que sí: limpia la caché de
#     Chrome/Edge, temporales viejos y el DNS. NO cierra sesiones ni borra
#     contraseñas, historial ni favoritos.
#
# Correrlo en la PC lenta Y en una PC que anda bien, y comparar los dos.
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$PANEL  = 'https://panel.urbisgroupinmobiliaria.com/'
$API    = 'https://api.urbisgroupinmobiliaria.com/auth/v1/health'
$WORKER = 'https://damp-fog-7d03.equipodetrabajourbis.workers.dev/'
$INV    = [Globalization.CultureInfo]::InvariantCulture
$AUTO   = $env:URBIS_AUTOTEST -eq '1'      # prueba sin preguntas (solo para revisar el script)

$R = New-Object System.Collections.Generic.List[string]
$Alertas = New-Object System.Collections.Generic.List[string]
function L([string]$t = '') { $R.Add($t); Write-Host $t }
function T([string]$t) { L ''; L ('== ' + $t + ' ' + ('=' * [Math]::Max(3, 62 - $t.Length))) }
function Alerta([string]$t) { $Alertas.Add($t); $R.Add('  (!) ' + $t); Write-Host ('  (!) ' + $t) -ForegroundColor Yellow }
function MB($b) { [Math]::Round([double]$b / 1MB, 1) }
function Med($xs) { $s = @($xs | Where-Object { $_ -ne $null } | Sort-Object); if (!$s.Count) { return $null }; $s[[int][Math]::Floor($s.Count / 2)] }
function Tam($p) { if (Test-Path -LiteralPath $p) { [double](Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum } else { 0 } }
function Num($s) { [double]::Parse(([string]$s).Trim().Replace(',', '.'), $INV) }

Clear-Host
Write-Host ''
Write-Host '  DIAGNÓSTICO DE LA PC - URBIS CONTROL' -ForegroundColor Cyan
Write-Host '  Tarda 1 a 2 minutos. No cierres esta ventana.' -ForegroundColor Cyan
L ('Fecha: ' + (Get-Date -Format 'dd/MM/yyyy HH:mm') + '   Equipo: ' + $env:COMPUTERNAME + '   Usuario: ' + $env:USERNAME)

# ------------------------------------------------------------ EQUIPO
T 'EQUIPO'
$cs  = Get-CimInstance Win32_ComputerSystem
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
L ('Modelo: ' + $cs.Manufacturer + ' ' + $cs.Model)
L ('Windows: ' + $os.Caption + ' (' + $os.Version + ')')
L ('Procesador: ' + ([string]$cpu.Name).Trim() + ' - ' + $cpu.NumberOfLogicalProcessors + ' hilos')
$ramTot = [double]$os.TotalVisibleMemorySize * 1KB
$ramLib = [double]$os.FreePhysicalMemory * 1KB
$pctLib = if ($ramTot) { [Math]::Round(100 * $ramLib / $ramTot) } else { 0 }
L ('Memoria RAM: ' + [Math]::Round($ramTot / 1GB, 1) + ' GB, libre ' + [Math]::Round($ramLib / 1GB, 1) + ' GB (' + $pctLib + '%)')
if ($ramTot -and $pctLib -lt 15) { Alerta 'La memoria RAM está casi llena: cerrar programas y pestañas que no se usan.' }
if ($os.LastBootUpTime) {
  $dias = [Math]::Round(((Get-Date) - $os.LastBootUpTime).TotalDays, 1)
  L ('Encendida sin reiniciar: ' + $dias + ' días')
  if ($dias -gt 7) { Alerta ('La PC no se reinicia hace ' + $dias + ' días: hacer Inicio > Reiniciar (apagar o cerrar la tapa NO cuenta).') }
}
$disco = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if ($disco.Size) {
  $pctDisco = [Math]::Round(100 * $disco.FreeSpace / $disco.Size)
  L ('Disco C: libre ' + [Math]::Round($disco.FreeSpace / 1GB, 1) + ' GB de ' + [Math]::Round($disco.Size / 1GB) + ' GB (' + $pctDisco + '%)')
  if ($pctDisco -lt 10) { Alerta 'El disco C: está casi lleno.' }
}
$tipoDisco = (Get-PhysicalDisk | Select-Object -First 1).MediaType
if ($tipoDisco) { L ('Tipo de disco: ' + $tipoDisco) }

# ------------------------------------------------------------ ENERGÍA
T 'ENERGÍA'
$bat = Get-CimInstance Win32_Battery | Select-Object -First 1
$enBateria = $false
if ($bat) {
  $enBateria = $bat.BatteryStatus -eq 1
  L ('Batería: ' + $bat.EstimatedChargeRemaining + '% - ' + $(if ($enBateria) { 'DESENCHUFADA (usando batería)' } else { 'enchufada' }))
  if ($enBateria) { Alerta 'La laptop está usando batería: Windows y el navegador bajan la velocidad para ahorrar. Trabajar con el cargador puesto.' }
} else { L 'Batería: no tiene (PC de escritorio)' }
$plan = ((powercfg /getactivescheme) -join ' ').Trim()
if ($plan) { L ('Plan de energía: ' + $plan) }
$modos = @{
  '961cc777-2547-4f9d-8174-7d86181b8a7a' = 'Mejor eficiencia energética'
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f' = 'Mejor eficiencia energética'
  '00000000-0000-0000-0000-000000000000' = 'Equilibrado'
  'ded574b5-45a0-4f42-8737-46345c09c238' = 'Mejor rendimiento'
}
$ov = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
foreach ($par in @(@('enchufada', $ov.ActiveOverlayAcPowerScheme), @('con batería', $ov.ActiveOverlayDcPowerScheme))) {
  if (!$par[1]) { continue }
  $nombre = $modos[[string]$par[1]]; if (!$nombre) { $nombre = [string]$par[1] }
  L ('Modo de energía ' + $par[0] + ': ' + $nombre)
}
$modoAhora = $modos[[string]$(if ($enBateria) { $ov.ActiveOverlayDcPowerScheme } else { $ov.ActiveOverlayAcPowerScheme })]
if ($bat -and $modoAhora -eq 'Mejor eficiencia energética') { Alerta 'Modo de energía en "Mejor eficiencia energética": en laptop frena el procesador. Probar "Equilibrado" o "Mejor rendimiento" (Configuración > Sistema > Energía y batería > Modo de energía).' }
try {
  $null = [Windows.System.Power.PowerManager,Windows.System.Power,ContentType=WindowsRuntime]
  $ahorro = [string][Windows.System.Power.PowerManager]::EnergySaverStatus
  L ('Ahorro de energía de Windows: ' + $(if ($ahorro -eq 'On') { 'ACTIVADO' } elseif ($ahorro -eq 'Off') { 'apagado (se prende solo con poca batería)' } else { 'desactivado' }))
  if ($ahorro -eq 'On') { Alerta 'El "Ahorro de energía" de Windows está ACTIVADO: frena el procesador y la red. Apagarlo (Configuración > Sistema > Energía y batería).' }
} catch {}

# ------------------------------------------------------------ PROCESADOR
T 'VELOCIDAD DEL PROCESADOR'
$buf = New-Object byte[] (32MB)
(New-Object Random 7).NextBytes($buf)
$sha = [Security.Cryptography.SHA256]::Create()
$null = $sha.ComputeHash($buf)                       # la primera calienta
$tiemposCpu = for ($i = 0; $i -lt 3; $i++) { $sw = [Diagnostics.Stopwatch]::StartNew(); $null = $sha.ComputeHash($buf); $sw.ElapsedMilliseconds }
$buf = $null
L ('Prueba de cálculo: ' + (Med $tiemposCpu) + ' ms  (MENOS es mejor: comparar con la otra PC)')

# ------------------------------------------------------------ QUÉ ESTÁ CONSUMIENDO
T 'PROGRAMAS QUE MÁS CONSUMEN AHORA (3 segundos)'
$redes = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' }
function BytesRed { $b = 0; $s = 0; foreach ($n in $redes) { try { $st = $n.GetIPv4Statistics(); $b += $st.BytesReceived; $s += $st.BytesSent } catch {} }; @($b, $s) }
$cpuAntes = @{}; foreach ($p in Get-Process) { if ($p.CPU -ne $null) { $cpuAntes[$p.Id] = $p.CPU } }
$red0 = BytesRed; $sw = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds 3
$red1 = BytesRed; $seg = $sw.Elapsed.TotalSeconds
$nucleos = [Environment]::ProcessorCount
$procs = foreach ($p in Get-Process) {
  if ($p.CPU -ne $null -and $cpuAntes.ContainsKey($p.Id)) {
    [pscustomobject]@{ Nombre = $p.ProcessName; CPU = 100 * ($p.CPU - $cpuAntes[$p.Id]) / $seg / $nucleos; MB = $p.WorkingSet64 / 1MB }
  }
}
$grupos = $procs | Group-Object Nombre | ForEach-Object {
  [pscustomobject]@{ Nombre = $_.Name; N = $_.Count
    CPU = [Math]::Round(($_.Group | Measure-Object CPU -Sum).Sum)
    MB  = [Math]::Round(($_.Group | Measure-Object MB -Sum).Sum) }
}
$cpuOcupado = [Math]::Round(($grupos | Measure-Object CPU -Sum).Sum)
L ('Procesador ocupado ahora: ~' + $cpuOcupado + '%')
$grupos | Where-Object { $_.Nombre -ne 'Idle' } | Sort-Object @{ Expression = 'CPU'; Descending = $true }, @{ Expression = 'MB'; Descending = $true } | Select-Object -First 10 | ForEach-Object {
  L ('  ' + $_.Nombre.PadRight(26) + ' CPU ' + ([string]$_.CPU + '%').PadLeft(4) + '   RAM ' + ([string]$_.MB + ' MB').PadLeft(8) + $(if ($_.N -gt 1) { '   (' + $_.N + ' procesos)' } else { '' }))
}
if ($cpuOcupado -gt 50) { Alerta ('El procesador está ocupado al ' + $cpuOcupado + '% sin que nadie use el panel: ver arriba qué programa es.') }
$bajando = [Math]::Round(($red1[0] - $red0[0]) * 8 / $seg / 1e6, 2); $subiendo = [Math]::Round(($red1[1] - $red0[1]) * 8 / $seg / 1e6, 2)
L ('Uso de la red ahora: bajando ' + $bajando + ' Mbps, subiendo ' + $subiendo + ' Mbps')
$sincro = Get-Process | Where-Object { $_.ProcessName -match '^(OneDrive|GoogleDriveFS|Dropbox|iCloudDrive|MEGAsync|uTorrent|qbittorrent|BitTorrent|Steam|EpicGamesLauncher|Teams|ms-teams|Zoom)$' } | Select-Object -ExpandProperty ProcessName -Unique
if ($sincro) { L ('Programas que suben o bajan cosas en segundo plano: ' + ($sincro -join ', ')) }
if ($subiendo -gt 1 -or $bajando -gt 15) { Alerta 'Algo ya está usando internet en este momento (sincronización, actualizaciones, videos): le quita velocidad al panel, sobre todo al SUBIR archivos.' }

# ------------------------------------------------------------ ANTIVIRUS
T 'ANTIVIRUS'
$avs = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct
if (!$avs) { L 'No se pudo leer (o no hay antivirus registrado).' }
foreach ($av in $avs) {
  $hex = '{0:x6}' -f [int]$av.productState
  $on = $hex.Substring(2, 2) -in @('10', '11')
  L ('  ' + $av.displayName + ' - ' + $(if ($on) { 'ACTIVO' } else { 'apagado' }))
  if ($on -and $av.displayName -notmatch 'Defender|Windows') { Alerta ('Antivirus de terceros activo: ' + $av.displayName + '. Muchos revisan cada página y cada archivo que se sube. Probar agregando panel.urbisgroupinmobiliaria.com y api.urbisgroupinmobiliaria.com a sus excepciones (o apagar su "protección web" 10 minutos y comparar).') }
}
# ¿alguien abre las conexiones seguras para revisarlas? (antivirus o red de la oficina)
try {
  $req = [Net.HttpWebRequest]::Create($PANEL); $req.Timeout = 15000; $req.Method = 'HEAD'
  $resp = $req.GetResponse(); $resp.Close()
  $emisor = $req.ServicePoint.Certificate.Issuer
  L ('Certificado del panel firmado por: ' + $emisor)
  if ($emisor -notmatch 'Google Trust|Let.s Encrypt|Cloudflare|DigiCert|Sectigo|GlobalSign|ZeroSSL|Baltimore') { Alerta ('Las conexiones seguras las está abriendo otro programa (' + $emisor + '): es la "inspección HTTPS" de un antivirus o de la red. Revisa todo lo que entra y sale y frena el panel.') }
} catch { L ('No se pudo leer el certificado del panel: ' + $_.Exception.Message) }

# ------------------------------------------------------------ NAVEGADORES
T 'NAVEGADORES'
$pred = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice').ProgId
if ($pred) { L ('Navegador predeterminado: ' + $pred) }
$navs = @(
  @{ N = 'Chrome'; Proc = 'chrome'; Datos = "$env:LOCALAPPDATA\Google\Chrome\User Data"
     Exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
  @{ N = 'Edge'; Proc = 'msedge'; Datos = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
     Exe = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
)
function NombreExtension($dir) {
  $ver = Get-ChildItem -LiteralPath $dir -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if (!$ver) { return $null }
  try { $m = Get-Content -LiteralPath (Join-Path $ver.FullName 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return (Split-Path $dir -Leaf) }
  $n = [string]$m.name
  if ($n -like '__MSG_*') {
    $clave = $n -replace '^__MSG_(.+)__$', '$1'
    foreach ($loc in @('es', 'es_419', $m.default_locale, 'en', 'en_US')) {
      if (!$loc) { continue }
      $f = Join-Path $ver.FullName "_locales\$loc\messages.json"
      if (Test-Path -LiteralPath $f) {
        try {
          $msgs = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
          $p = $msgs.PSObject.Properties | Where-Object { $_.Name -ieq $clave } | Select-Object -First 1
          if ($p) { $n = [string]$p.Value.message; break }
        } catch {}
      }
    }
  }
  if (!$n -or $n -like '__MSG_*') { $n = Split-Path $dir -Leaf }
  $n
}
foreach ($nv in $navs) {
  $exe = $nv.Exe | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (!$exe) { continue }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  $abiertos = @(Get-Process $nv.Proc)
  $ramNav = [Math]::Round(($abiertos | Measure-Object WorkingSet64 -Sum).Sum / 1MB)
  L ($nv.N + ' ' + $version + $(if ($abiertos.Count) { ' - abierto: ' + $abiertos.Count + ' procesos, ' + $ramNav + ' MB de RAM' } else { ' - cerrado' }))
  if (!(Test-Path -LiteralPath $nv.Datos)) { continue }
  $estado = $null
  try { $estado = Get-Content -LiteralPath (Join-Path $nv.Datos 'Local State') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  if ($estado) {
    if ($estado.hardware_acceleration_mode -and $estado.hardware_acceleration_mode.enabled -eq $false) { Alerta ($nv.N + ' tiene APAGADA la aceleración por hardware: todo se dibuja con el procesador. Prenderla en Configuración > Sistema.') }
    $pt = $estado.performance_tuning
    if ($pt) {
      if ($pt.high_efficiency_mode.state -ge 1) { L ('  Ahorro de memoria: ACTIVADO (duerme las pestañas que no se miran; al volver al panel, la pestaña se recarga entera)') }
      $bs = $pt.battery_saver_mode.state
      if ($bs -ne $null) { L ('  Ahorro de energía del navegador: ' + $(switch ([int]$bs) { 0 { 'apagado' } 1 { 'solo con batería baja' } 2 { 'siempre que esté desenchufada' } 3 { 'SIEMPRE prendido' } default { 'estado ' + $bs } })) }
      if ($enBateria -and [int]$bs -ge 2) { Alerta ($nv.N + ' tiene el ahorro de energía prendido mientras la laptop usa batería: frena las páginas.') }
    }
  }
  $perfiles = Get-ChildItem -LiteralPath $nv.Datos -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'Preferences') }
  foreach ($pf in $perfiles) {
    $nombrePerfil = $pf.Name
    try { $np = $estado.profile.info_cache.($pf.Name).name; if ($np) { $nombrePerfil = $pf.Name + ' "' + $np + '"' } } catch {}
    $cache = 0; foreach ($c in 'Cache', 'Code Cache', 'GPUCache') { $cache += Tam (Join-Path $pf.FullName $c) }
    $extDir = Join-Path $pf.FullName 'Extensions'
    $exts = @()
    if (Test-Path -LiteralPath $extDir) { $exts = @(Get-ChildItem -LiteralPath $extDir -Directory | ForEach-Object { NombreExtension $_.FullName } | Where-Object { $_ }) }
    # las que vienen con el navegador no cuentan: no se pueden quitar y no pesan
    $propias = @($exts | Where-Object { $_ -notmatch 'Documentos de Google sin conexi|Google Docs Offline|aplicaciones de Drive|Drive \(|Chrome Web Store Payments|pagos de Chrome Web Store|Edge relevant text changes' })
    L ('  Perfil ' + $nombrePerfil + ': caché ' + (MB $cache) + ' MB, ' + $propias.Count + ' extensiones agregadas')
    foreach ($e in $propias) { L ('     - ' + $e) }
    if ($propias.Count -gt 6) { Alerta ($nv.N + ' (' + $nombrePerfil + ') tiene ' + $propias.Count + ' extensiones agregadas: cada una corre en todas las páginas. Quitar las que no se usan.') }
  }
}

# ------------------------------------------------------------ INTERNET
T 'CONEXIÓN A INTERNET'
foreach ($a in (Get-NetAdapter | Where-Object Status -eq 'Up')) { L ('Conectado por: ' + $a.Name + ' - ' + $a.InterfaceDescription + ' - ' + $a.LinkSpeed) }
$vpn = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'VPN|TAP-|WireGuard|Fortinet|AnyConnect|OpenVPN|Hamachi|ZeroTier|Tailscale|Radmin' }
if ($vpn) { Alerta ('Hay una VPN conectada (' + (($vpn | ForEach-Object { $_.InterfaceDescription }) -join ', ') + '): todo da una vuelta más larga.') }
# netsh escribe en UTF-8 o en la página de códigos vieja según la PC: se lee en UTF-8 y,
# si salen caracteres rotos, de nuevo como venía (en la PC de Cami salía "recepci├│n")
$encAntes = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $wifi = netsh wlan show interfaces } finally { [Console]::OutputEncoding = $encAntes }
if ((($wifi -join "`n").IndexOf([char]0xFFFD)) -ge 0) { $wifi = netsh wlan show interfaces }
$wifi = $wifi | ForEach-Object { ([string]$_).Replace([char]0xA0, ' ') }
$lineasWifi = $wifi | Where-Object { $_ -match 'SSID|Se\S{1,3}al|Signal|radio|Banda|Band|Canal|Channel|recep|Receive|transm|Transmit' -and $_ -notmatch 'BSSID|AP BSSID' }
foreach ($x in $lineasWifi) { L ('  ' + $x.Trim()) }
$lineaSenal = $wifi | Where-Object { $_ -match '(Se\S{1,3}al|Signal)\s*:' } | Select-Object -First 1
if ($lineaSenal -and ($lineaSenal -match '(\d+)\s*%')) {
  $senal = [int]$matches[1]
  if ($senal -lt 60) { Alerta ('La señal Wi-Fi es débil (' + $senal + '%): acercarse al router o conectar cable de red.') }
}
if (($lineasWifi -join ' ') -match '2[,.]4\s*GHz') { Alerta 'Está en el Wi-Fi de 2,4 GHz (más lento y con más interferencia): si llega la misma red en "5G", conectarse a esa.' }
$ie = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if ($ie.ProxyEnable -eq 1 -or $ie.AutoConfigURL) { Alerta ('Hay un proxy configurado (' + $ie.ProxyServer + ' ' + $ie.AutoConfigURL + '): todo pasa por otra máquina.') }
$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ } | Select-Object -Unique)
if ($dns.Count) { L ('Servidores DNS: ' + ($dns -join ', ')) }

L ''
L 'Ping (10 intentos):'
function Ping10($dest, $nombre, [bool]$alertar) {
  $pg = New-Object System.Net.NetworkInformation.Ping
  $t = New-Object System.Collections.Generic.List[double]; $perdidos = 0
  for ($i = 0; $i -lt 10; $i++) {
    # OJO: aquí NO usar $r: PowerShell no distingue mayúsculas y taparía el informe ($R)
    try { $rp = $pg.Send($dest, 2000); if ($rp.Status -eq 'Success') { $t.Add($rp.RoundtripTime) } else { $perdidos++ } } catch { $perdidos++ }
    Start-Sleep -Milliseconds 150
  }
  if (!$t.Count) { L ('  ' + $nombre.PadRight(28) + ' no responde' + $(if (!$alertar) { ' (normal: ese servidor no contesta ping)' } else { '' })); if ($alertar) { Alerta ('No hay respuesta de ' + $nombre + ': internet cortado o bloqueado.') }; return }
  $prom = [Math]::Round(($t | Measure-Object -Average).Average); $max = ($t | Measure-Object -Maximum).Maximum; $min = ($t | Measure-Object -Minimum).Minimum
  L ('  ' + $nombre.PadRight(28) + ' promedio ' + ([string]$prom + ' ms').PadLeft(7) + '   mín ' + $min + '   máx ' + $max + '   perdidos ' + $perdidos + '/10')
  if ($alertar -and $perdidos -ge 2) { Alerta ('Se pierden paquetes hacia ' + $nombre + ' (' + $perdidos + ' de 10): la conexión es inestable. Revisar el Wi-Fi o el router.') }
  if ($alertar -and $dest -eq '1.1.1.1' -and $prom -gt 60) { Alerta ('El ping hacia ' + $nombre + ' es alto (' + $prom + ' ms): debería estar por debajo de 40 ms. Wi-Fi débil o red congestionada.') }
  if ($alertar -and ($max - $min) -gt 150) { Alerta ('El ping hacia ' + $nombre + ' salta mucho (' + $min + ' a ' + $max + ' ms): conexión inestable.') }
}
Ping10 '1.1.1.1' 'Cloudflare (1.1.1.1)' $true
Ping10 '8.8.8.8' 'Google (8.8.8.8)' $true
Ping10 'api.urbisgroupinmobiliaria.com' 'Servidor del panel (API)' $false

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (!$curl) { L 'Esta Windows no trae curl.exe: no se pueden medir los tiempos ni la velocidad.' }
else {
  L ''
  L 'Tiempo hasta cada servidor (mediana de 5, conexión nueva cada vez):'
  function Tiempos($url, $nombre) {
    $ida = @(); $tls = @(); $tot = @()
    for ($i = 0; $i -lt 5; $i++) {
      $o = & curl.exe -s -o NUL --max-time 20 -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_total}' $url
      if ($o) { $v = @(([string]$o).Trim() -split '\s+' | ForEach-Object { Num $_ }); if ($v.Count -eq 4 -and $v[3] -gt 0) { $ida += ($v[1] - $v[0]) * 1000; $tls += ($v[2] - $v[1]) * 1000; $tot += $v[3] * 1000 } }
    }
    if (!$tot.Count) { L ('  ' + $nombre.PadRight(28) + ' NO RESPONDE'); Alerta ('No se pudo llegar a ' + $nombre + ' (' + $url + ').'); return $null }
    $m = @([Math]::Round((Med $ida)), [Math]::Round((Med $tls)), [Math]::Round((Med $tot)))
    L ('  ' + $nombre.PadRight(28) + ' ida y vuelta ' + ([string]$m[0] + ' ms').PadLeft(7) + '   conexión segura ' + ([string]$m[1] + ' ms').PadLeft(7) + '   total ' + ([string]$m[2] + ' ms').PadLeft(7))
    $m
  }
  $tPanel = Tiempos $PANEL 'Panel (pantallas)'
  $tApi = Tiempos $API 'API (datos, en EE.UU.)'
  $tArch = Tiempos $WORKER 'Subida de archivos'
  if ($tApi -and $tApi[0] -gt 250) { Alerta ('La ida y vuelta hasta el servidor de datos es de ' + $tApi[0] + ' ms (lo normal desde Perú es ~130-180 ms). Cada clic del panel hace varias: se nota.') }

  L ''
  L 'Velocidad de internet (servidores de Cloudflare, los mismos que reciben los archivos):'
  $o = & curl.exe -s -o NUL --max-time 40 -w '%{speed_download} %{time_total}' 'https://speed.cloudflare.com/__down?bytes=10000000'
  $bajada = $null
  if ($o) { $bajada = [Math]::Round((Num (([string]$o).Trim() -split '\s+')[0]) * 8 / 1e6, 1) }
  $tmp = Join-Path $env:TEMP ('urbis-prueba-subida-' + $PID + '.bin')
  $b = New-Object byte[] (2MB); (New-Object Random).NextBytes($b); [IO.File]::WriteAllBytes($tmp, $b); $b = $null
  $o = & curl.exe -s -o NUL --max-time 60 -X POST -H 'Content-Type: application/octet-stream' --data-binary ('@' + $tmp) -w '%{speed_upload} %{time_total}' 'https://speed.cloudflare.com/__up'
  Remove-Item -LiteralPath $tmp -Force
  $subida = $null
  if ($o) { $subida = [Math]::Round((Num (([string]$o).Trim() -split '\s+')[0]) * 8 / 1e6, 1) }
  L ('  Bajada: ' + $(if ($bajada) { [string]$bajada + ' Mbps' } else { 'no se pudo medir' }))
  L ('  Subida: ' + $(if ($subida) { [string]$subida + ' Mbps' } else { 'no se pudo medir' }))
  if ($subida) {
    $seg300 = [Math]::Round(0.3 * 8 / $subida, 1); $seg3 = [Math]::Round(3 * 8 / $subida, 1)
    L ('  => subir un voucher de 300 KB tarda ~' + $seg300 + ' s; una foto de 3 MB, ~' + $seg3 + ' s (más lo que tarde el servidor)')
  }
  if ($bajada -and $bajada -lt 10) { Alerta ('La bajada es lenta (' + $bajada + ' Mbps).') }
  if ($subida -and $subida -lt 2) { Alerta ('La SUBIDA es lenta (' + $subida + ' Mbps): por eso tardan los vouchers y comprobantes.') }
}

# ------------------------------------------------------------ ARCHIVOS
T 'ARCHIVOS'
$escritorio = [Environment]::GetFolderPath('Desktop'); $documentos = [Environment]::GetFolderPath('MyDocuments')
$descargas = [Environment]::ExpandEnvironmentVariables([string](Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}')
L ('Escritorio: ' + $escritorio); L ('Documentos: ' + $documentos); if ($descargas) { L ('Descargas: ' + $descargas) }
if ((($escritorio + $documentos + $descargas) -match 'OneDrive') -and (Get-Process OneDrive)) {
  Alerta 'Escritorio/Documentos están en OneDrive: si el voucher está "solo en la nube" (ícono de nube), Windows primero lo DESCARGA y recién ahí el panel lo sube. Clic derecho en la carpeta > "Mantener siempre en este dispositivo".'
}

# ------------------------------------------------------------ RESUMEN
T 'RESUMEN'
if ($Alertas.Count) { L ('Se encontraron ' + $Alertas.Count + ' cosas para revisar:'); $k = 0; foreach ($a in $Alertas) { $k++; L ('  ' + $k + '. ' + $a) } }
else { L 'No se encontró nada raro en esta PC. Comparar con el informe de la otra PC.' }

# ------------------------------------------------------------ LIMPIEZA (opcional)
$limpiar = $false
if (!$AUTO) {
  Write-Host ''
  Write-Host 'LIMPIEZA OPCIONAL' -ForegroundColor Cyan
  Write-Host 'Borra la caché de Chrome/Edge, los temporales de más de 7 días y la caché de DNS.'
  Write-Host 'NO cierra sesiones ni borra contraseñas, historial ni favoritos.'
  Write-Host 'Ojo: casi nunca es la causa de la lentitud, pero no hace daño.'
  $limpiar = (Read-Host '¿Limpiar ahora? (S/N)') -match '^\s*[sS]'
}
if ($limpiar) {
  T 'LIMPIEZA'
  foreach ($nv in $navs) {
    if (!(Test-Path -LiteralPath $nv.Datos)) { continue }
    if (Get-Process $nv.Proc) {
      Write-Host ('Cierra TODAS las ventanas de ' + $nv.N + ' y presiona Enter...') -ForegroundColor Yellow
      $null = Read-Host
      if (Get-Process $nv.Proc) {
        $forzar = (Read-Host ($nv.N + ' sigue abierto (a veces se queda al lado del reloj). ¿Lo cierro yo? Lo que no esté guardado se pierde. (S/N)')) -match '^\s*[sS]'
        if ($forzar) { Stop-Process -Name $nv.Proc -Force; Start-Sleep -Seconds 2 }
      }
      if (Get-Process $nv.Proc) { L ('  ' + $nv.N + ': sigue abierto, no se limpió.'); continue }
    }
    $carpetas = @()
    foreach ($pf in (Get-ChildItem -LiteralPath $nv.Datos -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'Preferences') })) {
      foreach ($c in 'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache') { $carpetas += (Join-Path $pf.FullName $c) }
    }
    foreach ($c in 'ShaderCache', 'GrShaderCache', 'GraphiteDawnCache') { $carpetas += (Join-Path $nv.Datos $c) }
    $libre = 0
    foreach ($c in $carpetas) { if (Test-Path -LiteralPath $c) { $libre += Tam $c; Remove-Item -LiteralPath $c -Recurse -Force } }
    L ('  ' + $nv.N + ': caché borrada (' + (MB $libre) + ' MB)')
  }
  $t0 = Tam $env:TEMP
  Get-ChildItem -LiteralPath $env:TEMP -Force | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force
  L ('  Temporales de Windows: ' + (MB ($t0 - (Tam $env:TEMP))) + ' MB liberados')
  ipconfig /flushdns | Out-Null
  L '  Caché de DNS limpiada.'
}

# ------------------------------------------------------------ INFORME
$archivo = Join-Path ([Environment]::GetFolderPath('Desktop')) ('Diagnostico-Urbis-' + $env:COMPUTERNAME + '-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.txt')
$texto = @('DIAGNÓSTICO DE LA PC - URBIS CONTROL') + $R
try {
  [IO.File]::WriteAllLines($archivo, [string[]]$texto, (New-Object Text.UTF8Encoding $true))
  Write-Host ''
  Write-Host ('Listo. El informe quedó en el Escritorio: ' + (Split-Path $archivo -Leaf)) -ForegroundColor Green
  Write-Host 'Mándalo por WhatsApp a quien te lo pidió.' -ForegroundColor Green
  if (!$AUTO) { Start-Process notepad.exe -ArgumentList ('"' + $archivo + '"') }
} catch { Write-Host ('No se pudo guardar el informe: ' + $_.Exception.Message) -ForegroundColor Red }
