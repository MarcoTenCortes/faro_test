<#
  Faro · instalar lo que el MCP de Atlassian necesita en Windows (H15).

  Por qué existe: el bloque MCP de Faro arranca `uvx mcp-atlassian`, y sin uvx
  en el PATH del opencode arrancado el MCP se queda en «failed · Connection
  closed» a los 40 ms sin decir por qué (la causa sólo sale en la ventana de
  opencode). Pasó de verdad: un compañero se quedó quince minutos mirando
  «está en failed». Este script deja uv instalado, precalienta mcp-atlassian a
  la versión FIJADA del repo y comprueba Node y opencode, sin pedir admin.

  Es idempotente: lo que ya está, se deja. Nunca escribe la configuración de
  opencode (el BOM que añade PowerShell 5.1 la rompe al arrancar), nunca toca
  tokens ni la contraseña, y nunca instala Node. Si algo falla, sale con 1 y
  una línea que dice qué.

  Uso (un zip descargado lleva marca web, por eso el Bypass):
    powershell -ExecutionPolicy Bypass -File tools\instalar.ps1
    powershell -ExecutionPolicy Bypass -File tools\instalar.ps1 -SoloComprobar
    powershell -ExecutionPolicy Bypass -File tools\instalar.ps1 -Si

  -SoloComprobar  no instala nada ni pregunta: comprueba e informa, y sale con
                  1 si falta algo.
  -Si             acepta sin preguntar (instalar opencode con npm si falta).

  PowerShell 5.1: nada de && ni || entre comandos, ni ternarios.
#>
param(
  [switch]$SoloComprobar,
  [switch]$Si
)

# La MISMA versión que MCP_ATLASSIAN_VERSION de src/shared/config.js: es la
# que Faro escribe en el command del MCP, y test/unit/instalar.test.js cruza
# las dos. Se sube a mano, en los dos sitios a la vez.
$MCP_ATLASSIAN_VERSION = '0.23.1'

# El id fijo de la extensión (EXTENSION_ID de src/shared/config.js), para el
# comando de arranque con --cors que se enseña al final.
$EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'
$PUERTO = 4096

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$faltas = New-Object System.Collections.Generic.List[string]

function Bien([string]$texto) { Write-Host "  [ok] $texto" -ForegroundColor Green }
function Nota([string]$texto) { Write-Host "       $texto" -ForegroundColor Gray }
function Aviso([string]$texto) { Write-Host "  [!]  $texto" -ForegroundColor Yellow }
function Mal([string]$texto) { Write-Host "  [x]  $texto" -ForegroundColor Red }
function Titulo([string]$texto) { Write-Host ''; Write-Host $texto -ForegroundColor Cyan }

<#
  Sale con 1 y UNA línea clara. Es la única salida por error del script.
#>
function Fallar([string]$texto) {
  Write-Host ''
  Write-Host "ERROR: $texto" -ForegroundColor Red
  exit 1
}

<#
  Relee el PATH del registro (usuario y máquina) y añade al del proceso lo que
  le falte, sin quitarle nada ni cambiarle el orden. Hace falta porque el
  instalador de uv escribe el PATH del USUARIO en el registro, y una shell que
  ya estaba abierta no lo ve: sin esto, los pasos siguientes no encontrarían
  el uv recién instalado.
#>
function Actualizar-Path {
  $usuario = [Environment]::GetEnvironmentVariable('Path', 'User')
  $maquina = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $actual = @($env:Path -split ';' | Where-Object { $_ })
  $vistas = @{}
  foreach ($d in $actual) { $vistas[$d.TrimEnd('\').ToLowerInvariant()] = $true }
  $nuevas = New-Object System.Collections.Generic.List[string]
  foreach ($d in (@($maquina, $usuario) -join ';') -split ';') {
    if (-not $d) { continue }
    $clave = $d.TrimEnd('\').ToLowerInvariant()
    if ($vistas.ContainsKey($clave)) { continue }
    $vistas[$clave] = $true
    $nuevas.Add($d)
  }
  $env:Path = (@($actual) + @($nuevas)) -join ';'
}

<#
  Ejecuta un programa y devuelve su código de salida y su salida (stdout y
  stderr juntas, como texto). En PowerShell 5.1, con ErrorActionPreference en
  Stop, una línea en stderr de un programa nativo se vuelve una excepción: por
  eso aquí se baja a Continue mientras corre.
#>
function Ejecutar([string]$programa, [string[]]$argumentos) {
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $salida = @()
  $codigo = 1
  try {
    $salida = @(& $programa @argumentos 2>&1 | ForEach-Object { "$_" })
    $codigo = $LASTEXITCODE
  } catch {
    $salida = @("$_")
    $codigo = 1
  } finally {
    $ErrorActionPreference = $anterior
  }
  if ($null -eq $codigo) { $codigo = 0 }
  return [pscustomobject]@{ Codigo = $codigo; Salida = $salida }
}

<#
  Igual que Ejecutar, pero dejando que el programa escriba en la consola tal
  cual (las instalaciones enseñan su progreso).
#>
function EjecutarVisible([string]$programa, [string[]]$argumentos) {
  $anterior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $codigo = 1
  try {
    # «| Out-Host», y no el programa a secas: dentro de una función cuyo
    # resultado se asigna, la salida de un programa nativo NO va a la consola,
    # se vuelve parte de lo que devuelve la función. Pasó en la revisión
    # adversaria de H15: $codigo acababa siendo [líneas…, 0], los mensajes
    # decían «(código <toda la salida> 0)» y «$codigo -ne 0» era verdadero con
    # el programa saliendo bien. Out-Host la pinta y $LASTEXITCODE se conserva.
    & $programa @argumentos | Out-Host
    $codigo = $LASTEXITCODE
  } catch {
    Write-Host "$_" -ForegroundColor Red
    $codigo = 1
  } finally {
    $ErrorActionPreference = $anterior
  }
  if ($null -eq $codigo) { $codigo = 0 }
  return [int]$codigo
}

<#
  La última línea con texto de una salida: los --version de Python sacan a
  veces avisos delante.
#>
function UltimaLinea($lineas) {
  $con = @($lineas | Where-Object { "$_".Trim() })
  if ($con.Count -eq 0) { return '' }
  return "$($con[$con.Count - 1])".Trim()
}

<#
  La salida de «uv tool install» sin la lista de paquetes (son 107 líneas
  «+ paquete==versión» que no le dicen nada a nadie). Si uv avisa de que su
  carpeta de ejecutables no está en el PATH, se aclara que da igual: Faro
  arranca mcp-atlassian con uvx, no con ese ejecutable.
#>
function Mostrar-Salida($lineas) {
  foreach ($l in $lineas) {
    if ("$l" -match '^\s*[+-] \S') { continue }
    Nota $l
    if ("$l" -match 'is not on your PATH') { Nota '(Da igual para Faro: el MCP se arranca con uvx, no con ese ejecutable.)' }
  }
}

<# El uvx que resolvería una terminal nueva (el primero del PATH), o $null. #>
function Buscar-Uvx {
  $c = Get-Command uvx -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  return $null
}

<#
  Una orden de npm o de opencode resuelta a su .cmd/.exe: npm deja además un
  opencode.ps1 al lado, y ése lo bloquea la política de ejecución por defecto.
#>
function Buscar-Programa([string]$nombre) {
  $todos = @(Get-Command $nombre -All -ErrorAction SilentlyContinue)
  foreach ($c in $todos) {
    if ($c.CommandType -eq 'Application' -and $c.Source -match '\.(exe|cmd|bat)$') { return $c.Source }
  }
  return $null
}

<#
  ¿Hay algo escuchando en el puerto de opencode? Primero una conexión TCP
  (rápida, y no pasa por ningún proxy) y después el GET de salud que pide el
  plan. Una respuesta HTTP cualquiera, un 401 incluido, cuenta como «hay uno».
#>
function Opencode-Escuchando([int]$puerto) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $intento = $tcp.BeginConnect('127.0.0.1', $puerto, $null, $null)
    if (-not $intento.AsyncWaitHandle.WaitOne(1500)) { return $false }
    $tcp.EndConnect($intento)
  } catch {
    return $false
  } finally {
    $tcp.Close()
  }
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/global/health" -UseBasicParsing -TimeoutSec 3
    return $true
  } catch {
    # Una respuesta HTTP cualquiera (un 401 incluido) o ninguna: el puerto ya
    # está ocupado, y para lo que importa aquí eso es que hay uno.
    return $true
  }
}

$modo = 'instalar'
if ($SoloComprobar) { $modo = 'sólo comprobar' }
Write-Host "Faro · instalador de uv y mcp-atlassian $MCP_ATLASSIAN_VERSION ($modo)" -ForegroundColor Cyan

Actualizar-Path

# ---------------------------------------------------------------------------
# 1. uv y uvx
# ---------------------------------------------------------------------------
Titulo '1. uv (uvx)'
$uvxLocal = Join-Path $HOME '.local\bin\uvx.exe'
$uvx = Buscar-Uvx
$uvRecienInstalado = $false
# ¿Está uvx sólo en ~/.local/bin y fuera del PATH que verá opencode? Se decide
# AQUÍ, antes de tocar el PATH del proceso, y no preguntándole después a
# Buscar-Uvx: la rama de abajo antepone esa carpeta al PATH del proceso y a
# partir de ahí Buscar-Uvx siempre lo encuentra. Pasó en la revisión
# adversaria de H15: por eso nunca se ejecutaba «uv tool update-shell» y
# -SoloComprobar acababa en «Todo listo» tras avisar de que opencode no lo
# encontraría. $pathSinAnteponer es el PATH de antes, para comprobarlo de
# verdad después de arreglarlo.
$uvxFueraDelPath = $false
$pathSinAnteponer = $env:Path

if (-not $uvx) {
  if (Test-Path $uvxLocal) {
    $uvx = $uvxLocal
    $uvxFueraDelPath = $true
    $env:Path = (Split-Path $uvxLocal) + ';' + $env:Path
    Aviso "uvx está en $uvxLocal pero no en tu PATH: opencode no lo encontrará."
  } elseif ($SoloComprobar) {
    Mal 'uv no está instalado.'
    $faltas.Add('uv')
  } else {
    Nota 'uv no está: lo instalo con el instalador oficial de Astral (sin admin).'
    $codigo = EjecutarVisible 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-c', 'irm https://astral.sh/uv/install.ps1 | iex')
    Actualizar-Path
    $uvx = Buscar-Uvx
    if (-not $uvx -and (Test-Path $uvxLocal)) { $uvx = $uvxLocal; $uvxFueraDelPath = $true }
    if (-not $uvx) {
      Aviso "El instalador oficial no ha dejado uvx (código $codigo). Pruebo con winget."
      $winget = Buscar-Programa 'winget'
      if (-not $winget) { Fallar 'No he podido instalar uv: falló el instalador oficial y no hay winget. Instálalo a mano (docs/INSTALL.md, «Antes de nada: uv») y vuelve a ejecutar este script.' }
      $codigo = EjecutarVisible $winget @('install', '--id', 'astral-sh.uv', '-e', '--accept-source-agreements', '--accept-package-agreements')
      Actualizar-Path
      $uvx = Buscar-Uvx
      if (-not $uvx) { Fallar "No he podido instalar uv (winget terminó con código $codigo). Instálalo a mano (docs/INSTALL.md, «Antes de nada: uv») y vuelve a ejecutar este script." }
    }
    $uvRecienInstalado = $true
    Bien "uv instalado: $uvx"
  }
}

$uv = $null
if ($uvx) {
  $uvHermano = Join-Path (Split-Path $uvx) 'uv.exe'
  if (Test-Path $uvHermano) { $uv = $uvHermano } else { $uv = Buscar-Programa 'uv' }
  if (-not $uv) { Fallar "Hay uvx ($uvx) pero no encuentro uv.exe a su lado ni en el PATH. Reinstala uv (docs/INSTALL.md, «Antes de nada: uv»)." }
  $v = Ejecutar $uv @('--version')
  if ($v.Codigo -ne 0) { Fallar "uv no contesta a --version: $(UltimaLinea $v.Salida)" }
  if (-not $uvRecienInstalado) { Bien "uvx: $uvx" }
  Nota "uv: $uv ($(UltimaLinea $v.Salida))"
  $todos = @(Get-Command uvx -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source } | Select-Object -Unique)
  if ($todos.Count -gt 1) {
    Nota "Hay $($todos.Count) uvx en el PATH; opencode usará el primero:"
    foreach ($t in $todos) { Nota "  $t" }
  }

  # uvx sólo en ~/.local/bin y fuera del PATH: el instalador oficial lo añade
  # al PATH del usuario, así que esto es que alguien lo quitó. «uv tool
  # update-shell» es la forma de uv de volver a ponerlo; sólo se usa si esa
  # carpeta es justo la de las herramientas de uv, para no añadir otra.
  if ($uvxFueraDelPath) {
    $binUv = UltimaLinea (Ejecutar $uv @('tool', 'dir', '--bin')).Salida
    $mismaCarpeta = $binUv.TrimEnd('\') -ieq (Split-Path $uvxLocal).TrimEnd('\')
    if ($SoloComprobar -or -not $mismaCarpeta) {
      Aviso "Para que opencode lo vea: `"$uv`" tool update-shell, y abre una terminal nueva."
      $faltas.Add('uvx en el PATH')
    } else {
      $codigo = EjecutarVisible $uv @('tool', 'update-shell')
      # Se comprueba DE VERDAD: con el PATH de antes de anteponer la carpeta y
      # lo que ahora diga el registro, que es lo que verá una terminal nueva.
      $env:Path = $pathSinAnteponer
      Actualizar-Path
      if ($codigo -eq 0 -and (Buscar-Uvx)) {
        Bien 'uvx añadido al PATH de tu usuario.'
      } else {
        Aviso "uv tool update-shell no lo ha dejado en tu PATH (código $codigo). Hazlo a mano: `"$uv`" tool update-shell, y abre una terminal nueva."
        $faltas.Add('uvx en el PATH')
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 2. mcp-atlassian, a la versión fijada
# ---------------------------------------------------------------------------
Titulo "2. mcp-atlassian $MCP_ATLASSIAN_VERSION"
$instalado = $false
if ($uv) {
  if ($SoloComprobar) {
    $lista = Ejecutar $uv @('tool', 'list')
    $patron = '^mcp-atlassian v' + [regex]::Escape($MCP_ATLASSIAN_VERSION) + '\b'
    if (@($lista.Salida | Where-Object { $_ -match $patron }).Count -gt 0) {
      $instalado = $true
      Bien "mcp-atlassian $MCP_ATLASSIAN_VERSION instalado con uv tool."
    } else {
      # No es una falta: lo que opencode ejecuta es «uvx mcp-atlassian@<versión>»,
      # y eso arranca desde la caché de uv sin que la herramienta esté instalada
      # (el paso 3 lo comprueba y sí cuenta como falta si no arranca). Instalarla
      # sólo la fija y la deja precalentada: arranca en 1-2 s en vez de 3-7.
      Aviso "mcp-atlassian $MCP_ATLASSIAN_VERSION no está instalado con uv tool: arranca igual desde la caché de uvx, sólo más despacio (lo instala este script sin -SoloComprobar)."
    }
  } else {
    Nota "uv tool install mcp-atlassian==$MCP_ATLASSIAN_VERSION (la primera vez baja unos 107 paquetes y quizá un Python)…"
    $r = Ejecutar $uv @('tool', 'install', "mcp-atlassian==$MCP_ATLASSIAN_VERSION")
    Mostrar-Salida $r.Salida
    $certificados = 'certificate|certificado|UnknownIssuer|invalid peer|self[- ]signed|tls|ssl'
    if ($r.Codigo -ne 0 -and (($r.Salida -join "`n") -match $certificados)) {
      Aviso 'Ha fallado por los certificados (¿un proxy que inspecciona TLS?). Reintento con --native-tls, que usa los del almacén de Windows.'
      $r = Ejecutar $uv @('tool', 'install', '--native-tls', "mcp-atlassian==$MCP_ATLASSIAN_VERSION")
      Mostrar-Salida $r.Salida
    }
    if ($r.Codigo -ne 0) {
      Aviso 'Detrás de un proxy corporativo: fija UV_NATIVE_TLS=1 (o SSL_CERT_FILE con el certificado de tu empresa) y HTTPS_PROXY con la dirección del proxy, y vuelve a ejecutar este script.'
      Fallar "uv tool install mcp-atlassian==$MCP_ATLASSIAN_VERSION ha fallado: $(UltimaLinea $r.Salida)"
    }
    $instalado = $true
    Bien "mcp-atlassian $MCP_ATLASSIAN_VERSION instalado con uv tool."
  }
}

# ---------------------------------------------------------------------------
# 3. Comprobación: que arranca, y cuánto tarda
# ---------------------------------------------------------------------------
Titulo '3. ¿Arranca mcp-atlassian?'
if ($uv) {
  $binDir = UltimaLinea (Ejecutar $uv @('tool', 'dir', '--bin')).Salida
  $exe = Join-Path $binDir 'mcp-atlassian.exe'
  if (Test-Path $exe) {
    $reloj = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Ejecutar $exe @('--version')
    $reloj.Stop()
    $seg = [math]::Round($reloj.Elapsed.TotalSeconds, 1)
    if ($r.Codigo -eq 0) { Bien "mcp-atlassian --version: $(UltimaLinea $r.Salida) en $seg s ($exe)" }
    else { Mal "mcp-atlassian --version ha fallado: $(UltimaLinea $r.Salida)"; $faltas.Add('mcp-atlassian que arranque') }
  } elseif ($instalado) {
    Mal "No encuentro $exe aunque uv dice que está instalado."
    $faltas.Add('mcp-atlassian que arranque')
  }

  # Lo que de verdad ejecuta opencode: uvx con la versión fijada. Con
  # -SoloComprobar va sin red (--offline): si no está en la caché lo dice, en
  # vez de descargar nada.
  # Ojo en PowerShell: en @('a' + $v, 'b') la coma se agrupa ANTES que el +,
  # y sale una sola cadena «a<v> b»; por eso la versión va interpolada.
  $argsUvx = @("mcp-atlassian@$MCP_ATLASSIAN_VERSION", '--version')
  if ($SoloComprobar) { $argsUvx = @('--offline') + $argsUvx }
  $reloj = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Ejecutar $uvx $argsUvx
  $reloj.Stop()
  $seg = [math]::Round($reloj.Elapsed.TotalSeconds, 1)
  if ($r.Codigo -eq 0) {
    Bien "uvx mcp-atlassian@$MCP_ATLASSIAN_VERSION --version: $(UltimaLinea $r.Salida) en $seg s"
  } elseif ($SoloComprobar -and (($r.Salida -join "`n") -match 'offline|network|cache')) {
    Mal "uvx mcp-atlassian@$MCP_ATLASSIAN_VERSION no está en la caché de uv: la primera vez que arranque descargará unos 107 paquetes."
    $faltas.Add("mcp-atlassian $MCP_ATLASSIAN_VERSION en la caché de uvx")
  } else {
    Mal "uvx mcp-atlassian@$MCP_ATLASSIAN_VERSION --version ha fallado: $(UltimaLinea $r.Salida)"
    $faltas.Add('uvx mcp-atlassian que arranque')
  }
} else {
  Nota 'Sin uv no hay nada que comprobar aquí.'
}

# ---------------------------------------------------------------------------
# 4. Node y opencode
# ---------------------------------------------------------------------------
Titulo '4. Node y opencode'
$node = Buscar-Programa 'node'
$nodeMayor = 0
$nodeVersion = ''
if ($node) {
  $nodeVersion = UltimaLinea (Ejecutar $node @('--version')).Salida
  if ($nodeVersion -match '^v?(\d+)') { $nodeMayor = [int]$Matches[1] }
  Bien "Node $nodeVersion ($node)"
} else {
  Aviso 'Node no está. Este script no lo instala: sólo hace falta si vas a instalar opencode con npm.'
}

$opencode = Buscar-Programa 'opencode'
$opencodeVersion = $null
if ($opencode) {
  $ov = UltimaLinea (Ejecutar $opencode @('--version')).Salida
  if ($ov -match '(\d+\.\d+\.\d+)') { $opencodeVersion = [version]$Matches[1] }
}

if (-not $opencodeVersion) {
  if ($SoloComprobar) {
    Mal 'opencode no está (o no contesta a --version).'
    $faltas.Add('opencode')
  } elseif ($nodeMayor -ge 18) {
    $aceptar = $Si
    if (-not $aceptar) {
      $respuesta = Read-Host '¿Instalo opencode con «npm i -g opencode-ai»? [s/N]'
      $aceptar = $respuesta -match '^(s|si|sí|y|yes)$'
    }
    if ($aceptar) {
      $npm = Buscar-Programa 'npm'
      if (-not $npm) { Fallar 'Hay Node pero no encuentro npm para instalar opencode.' }
      $codigo = EjecutarVisible $npm @('i', '-g', 'opencode-ai')
      Actualizar-Path
      $opencode = Buscar-Programa 'opencode'
      if ($opencode) {
        $ov = UltimaLinea (Ejecutar $opencode @('--version')).Salida
        if ($ov -match '(\d+\.\d+\.\d+)') { $opencodeVersion = [version]$Matches[1] }
      }
      if (-not $opencodeVersion) { Fallar "No he podido instalar opencode con npm (código $codigo)." }
    } else {
      Aviso 'Sin opencode, Faro no tiene con quién hablar. Instálalo con: npm i -g opencode-ai'
      $faltas.Add('opencode')
    }
  } else {
    Mal 'opencode no está, y para instalarlo con npm hace falta Node 18 o más (este script no instala Node).'
    $faltas.Add('opencode')
  }
}

if ($opencodeVersion) {
  if ($opencodeVersion -lt [version]'1.2.0') {
    Mal "opencode $opencodeVersion es viejo: Faro necesita 1.2 o más (npm i -g opencode-ai)."
    $faltas.Add('opencode 1.2 o más')
  } else {
    Bien "opencode $opencodeVersion ($opencode)"
  }
}

if (Opencode-Escuchando $PUERTO) {
  Write-Host ''
  Write-Host "  Ya hay un opencode escuchando en 127.0.0.1:$PUERTO." -ForegroundColor Red
  if ($uvRecienInstalado) {
    Write-Host '  Ciérralo y arráncalo desde una terminal NUEVA: el opencode que está abierto no ve uvx.' -ForegroundColor Red
  } else {
    Write-Host '  Si lo arrancaste antes de instalar uv, ciérralo y arráncalo desde una terminal NUEVA: el opencode que está abierto no ve uvx.' -ForegroundColor Red
  }
  Write-Host '  (El MCP de Atlassian hereda el PATH con el que arrancó opencode.)' -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# 5. Resumen
# ---------------------------------------------------------------------------
Titulo 'Resumen'
if ($uvx) { Nota "uvx:            $uvx" }
if ($uv) { Nota "uv:             $uv" }
Nota "mcp-atlassian:  $MCP_ATLASSIAN_VERSION"
if ($node) { Nota "Node:           $nodeVersion" }
if ($opencode) { Nota "opencode:       $opencodeVersion ($opencode)" }
$arrancar = Join-Path $PSScriptRoot 'arrancar-opencode.ps1'
Write-Host ''
Write-Host 'Para arrancar opencode (desde una terminal NUEVA):' -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$arrancar`""
Nota 'o, a mano, con la contraseña del servidor en el entorno:'
Nota "  opencode serve --port $PUERTO --cors chrome-extension://$EXTENSION_ID --print-logs --log-level INFO"

Write-Host ''
if ($faltas.Count -gt 0) {
  Write-Host ('Falta: ' + ($faltas -join ', ') + '.') -ForegroundColor Red
  exit 1
}
Write-Host 'Todo listo.' -ForegroundColor Green
exit 0
