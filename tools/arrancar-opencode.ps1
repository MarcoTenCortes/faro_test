<#
  Faro · arrancar opencode para la extensión (H15).

  Por qué existe: el comando largo de arranque (puerto, --cors con el id de la
  extensión, registros) se copiaba mal de la documentación, y un opencode
  arrancado desde una terminal VIEJA no ve el uv recién instalado: su MCP de
  Atlassian se queda en «failed · Connection closed». Este script relee el PATH
  del registro antes de arrancar, así que eso deja de importar.

  Además arranca opencode en una carpeta PROPIA y VACÍA, con dos variables
  puestas: opencode 1.2.25 busca AGENTS.md, CLAUDE.md o CONTEXT.md subiendo
  desde la carpeta donde se arranca y los mete como «Instructions from:» en el
  system de CADA sesión (texto que llega al modelo sin delimitar y que cuesta
  tokens en cada turno), y carga el opencode.json de proyecto de esa carpeta,
  que puede tapar la entrada del MCP que usa Faro. Arrancado desde el repo de
  Faro, se colaría el CLAUDE.md entero.

  La contraseña del servidor: si no está ya en el entorno, se pide aquí (sin
  que se vea al escribirla) y se deja SÓLO en el entorno de este proceso, que
  es el que hereda opencode. Nunca se escribe en disco ni se imprime.

  Uso:
    powershell -ExecutionPolicy Bypass -File tools\arrancar-opencode.ps1
    powershell -ExecutionPolicy Bypass -File tools\arrancar-opencode.ps1 -Port 4097
    powershell -ExecutionPolicy Bypass -File tools\arrancar-opencode.ps1 -SoloMostrar

  -SoloMostrar  enseña el comando y la carpeta y NO arranca nada ni pide la
                contraseña.
#>
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 4096,
  [switch]$SoloMostrar
)

# El id fijo de la extensión (EXTENSION_ID de src/shared/config.js, derivado de
# la key del manifest); test/unit/instalar.test.js cruza los dos.
$EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

<# Sale con 1 y UNA línea clara. #>
function Fallar([string]$texto) {
  Write-Host "ERROR: $texto" -ForegroundColor Red
  exit 1
}

<#
  Relee el PATH del registro (usuario y máquina) y añade al del proceso lo que
  le falte: una shell abierta antes de instalar uv no lo tiene, y opencode
  hereda este PATH (y con él, el MCP de Atlassian, que necesita uvx).
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
  opencode resuelto a su .cmd/.exe: npm deja además un opencode.ps1 al lado, y
  ése lo bloquea la política de ejecución por defecto.
#>
function Buscar-Programa([string]$nombre) {
  $todos = @(Get-Command $nombre -All -ErrorAction SilentlyContinue)
  foreach ($c in $todos) {
    if ($c.CommandType -eq 'Application' -and $c.Source -match '\.(exe|cmd|bat)$') { return $c.Source }
  }
  return $null
}

<# ¿Hay ya algo escuchando en ese puerto? Sólo una conexión TCP, sin enviar nada. #>
function Puerto-Ocupado([int]$puerto) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $intento = $tcp.BeginConnect('127.0.0.1', $puerto, $null, $null)
    if (-not $intento.AsyncWaitHandle.WaitOne(1000)) { return $false }
    $tcp.EndConnect($intento)
    return $true
  } catch {
    return $false
  } finally {
    $tcp.Close()
  }
}

Actualizar-Path

$opencode = Buscar-Programa 'opencode'
if (-not $opencode) { Fallar 'opencode no está en el PATH. Ejecuta primero: powershell -ExecutionPolicy Bypass -File tools\instalar.ps1' }

$uvx = Get-Command uvx -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1

# La carpeta propia y vacía donde arranca opencode (ver la cabecera).
$carpeta = Join-Path $env:LOCALAPPDATA 'Faro\opencode-cwd'
$origen = "chrome-extension://$EXTENSION_ID"
$argumentos = @('serve', '--port', "$Port", '--cors', $origen, '--print-logs', '--log-level', 'INFO')

if ($SoloMostrar) {
  Write-Host 'Faro · así arrancaría opencode (no arranco nada):' -ForegroundColor Cyan
  Write-Host "  carpeta:   $carpeta"
  Write-Host "  opencode:  $opencode"
  if ($uvx) { Write-Host "  uvx:       $($uvx.Source)" } else { Write-Host '  uvx:       (no está en el PATH: ejecuta tools\instalar.ps1)' -ForegroundColor Yellow }
  Write-Host '  variables: OPENCODE_DISABLE_PROJECT_CONFIG=1  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1'
  Write-Host "  comando:   opencode $($argumentos -join ' ')"
  if (Puerto-Ocupado $Port) { Write-Host "  (ahora mismo ya hay algo escuchando en 127.0.0.1:$Port)" -ForegroundColor Yellow }
  exit 0
}

if (Puerto-Ocupado $Port) { Fallar "Ya hay algo escuchando en 127.0.0.1:$Port. Si es otro opencode, ciérralo antes (o usa -Port)." }
if (-not $uvx) { Write-Host 'Aviso: uvx no está en el PATH, así que el MCP de Atlassian no arrancará. Ejecuta tools\instalar.ps1.' -ForegroundColor Yellow }

# Que opencode no lea ni el opencode.json ni los AGENTS.md/CLAUDE.md de la
# carpeta donde arranca.
$env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'
$env:OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = '1'

if (-not (Test-Path $carpeta)) { $null = New-Item -ItemType Directory -Path $carpeta -Force }
Set-Location -Path $carpeta

if (-not $env:OPENCODE_SERVER_PASSWORD) {
  $segura = Read-Host 'Contraseña del servidor (la misma que en Ajustes del panel; no se guarda)' -AsSecureString
  $puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
  try {
    $env:OPENCODE_SERVER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
  }
  if (-not $env:OPENCODE_SERVER_PASSWORD) { Fallar 'Sin contraseña no arranco: cualquiera que hablara con opencode podría leer tus claves de Atlassian.' }
}

Write-Host "Faro · arrancando opencode en 127.0.0.1:$Port desde $carpeta (Ctrl+C para pararlo)." -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'
& $opencode @argumentos
exit $LASTEXITCODE
