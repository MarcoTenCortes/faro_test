/**
 * Los dos scripts de PowerShell de H15 (tools/instalar.ps1 y
 * tools/arrancar-opencode.ps1) dicen lo que prometen.
 *
 * Existen porque un compañero sin uvx se quedó quince minutos mirando «el MCP
 * está en failed» (docs/PLAN2.md §3.1): el instalador deja uv y la versión
 * FIJADA de mcp-atlassian, y el arranque lanza opencode con el PATH releído
 * del registro, en una carpeta propia y sin leer los AGENTS.md/CLAUDE.md de
 * donde se arranque. No se pueden ejecutar en Node (ni deben: instalan cosas y
 * arrancan un servidor), así que se leen como texto y se pinan por regex, como
 * bootstrap.js o panel.js. Lo que se pina es lo que, si se rompe, rompe en
 * silencio en la máquina de otro: una versión distinta de la que escribe Faro,
 * un PATH viejo, una escritura en la configuración de opencode (el BOM de
 * PowerShell 5.1 la deja sin arrancar), la contraseña en disco, un «npx
 * mcp-atlassian» (en npm ese nombre es de OTRO autor y ejecutaría su código
 * con los tokens), un fichero sin BOM (PowerShell 5.1 lo lee como ANSI) o una
 * sintaxis que sólo entiende PowerShell 7.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MCP_ATLASSIAN_VERSION, EXTENSION_ID } from '../../src/shared/config.js'

const ROOT = join(import.meta.dirname, '..', '..')
const leer = (ruta) => readFileSync(join(ROOT, ruta), 'utf8')

const INSTALAR_CRUDO = leer('tools/instalar.ps1')
const ARRANCAR_CRUDO = leer('tools/arrancar-opencode.ps1')

/**
 * El fuente de PowerShell sin comentarios: fuera los bloques `<# … #>` y las
 * líneas que empiezan por `#`. Los scripts no llevan comentarios detrás de
 * código, así que con eso basta; lo que un comentario diga no cuenta como lo
 * que el script hace.
 */
function sinComentarios(src) {
  return src
    .replace(/<#[\s\S]*?#>/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
}

const INSTALAR = sinComentarios(INSTALAR_CRUDO)
const ARRANCAR = sinComentarios(ARRANCAR_CRUDO)
const SCRIPTS = [
  ['tools/instalar.ps1', INSTALAR],
  ['tools/arrancar-opencode.ps1', ARRANCAR],
]

/** El trozo de código que va de `desde` a `hasta`; las dos marcas tienen que existir. */
function entre(src, desde, hasta) {
  const a = src.indexOf(desde)
  assert(a >= 0, `no encuentro «${desde}»`)
  const b = src.indexOf(hasta, a + desde.length)
  assert(b > a, `no encuentro «${hasta}» detrás de «${desde}»`)
  return src.slice(a, b)
}

test('H15: la versión de mcp-atlassian del instalador es la MISMA que escribe Faro', () => {
  const asignaciones = [...INSTALAR.matchAll(/^\$MCP_ATLASSIAN_VERSION\s*=\s*'([^']*)'\s*$/gm)]
  eq(asignaciones.length, 1, 'una sola constante de versión en el script')
  eq(asignaciones[0][1], MCP_ATLASSIAN_VERSION, 'la de src/shared/config.js: se suben las dos a la vez')
  assert(
    INSTALAR.includes(`Ejecutar $uv @('tool', 'install', "mcp-atlassian==$MCP_ATLASSIAN_VERSION")`),
    'uv tool install mcp-atlassian== con la variable de versión, no con otra cadena',
  )
  assert(
    INSTALAR.includes(`Ejecutar $uv @('tool', 'install', '--native-tls', "mcp-atlassian==$MCP_ATLASSIAN_VERSION")`),
    'el reintento por certificados instala la misma versión',
  )
  assert(INSTALAR.includes('uv tool install mcp-atlassian==$MCP_ATLASSIAN_VERSION'), 'y lo dice con esas palabras')
  assert(INSTALAR.includes(`@("mcp-atlassian@$MCP_ATLASSIAN_VERSION", '--version')`), 'la comprobación con uvx pide esa misma versión')
  assert(!/mcp-atlassian[=@]=?\d/.test(INSTALAR), 'ninguna versión escrita a mano fuera de la constante')
})

test('H15: los dos scripts releen el PATH del registro (usuario y máquina) antes de buscar nada', () => {
  for (const [nombre, src] of SCRIPTS) {
    const funcion = entre(src, 'function Actualizar-Path {', '\n}')
    assert(funcion.includes("[Environment]::GetEnvironmentVariable('Path', 'User')"), `${nombre}: el PATH del usuario`)
    assert(funcion.includes("[Environment]::GetEnvironmentVariable('Path', 'Machine')"), `${nombre}: el PATH de la máquina`)
    assert(funcion.includes('$env:Path = '), `${nombre}: y lo deja en el PATH del proceso`)
    assert(/^Actualizar-Path$/m.test(src), `${nombre}: se llama al empezar, fuera de cualquier función`)
  }
  assert(INSTALAR.indexOf('\nActualizar-Path\n') < INSTALAR.indexOf('$uvx = Buscar-Uvx'), 'antes de buscar uvx')
  assert(ARRANCAR.indexOf('\nActualizar-Path\n') < ARRANCAR.indexOf("$opencode = Buscar-Programa 'opencode'"), 'antes de buscar opencode')
  const tras = (marca) => {
    const i = INSTALAR.indexOf(marca)
    assert(i >= 0, `no encuentro «${marca}»`)
    return INSTALAR.slice(i, i + 200).includes('Actualizar-Path')
  }
  assert(tras("'irm https://astral.sh/uv/install.ps1 | iex')"), 'tras el instalador oficial se vuelve a leer, para ver el uv recién instalado')
  assert(tras("'--accept-package-agreements')"), 'y tras winget')
  assert(tras("EjecutarVisible $npm @('i', '-g', 'opencode-ai')"), 'y tras instalar opencode con npm')
})

test('H15 SEGURIDAD: ninguno de los dos escribe la configuración de opencode ni la contraseña', () => {
  for (const [nombre, src] of SCRIPTS) {
    for (const linea of src.split('\n')) {
      assert(
        !/(Set-Content|Out-File|Add-Content|WriteAllText|WriteAllLines|WriteAllBytes)/i.test(linea) || !/opencode/i.test(linea),
        `${nombre}: escribe algo de opencode: ${linea.trim()}`,
      )
      assert(!/>\s*["']?[^\s|&]*opencode/i.test(linea), `${nombre}: redirige a un fichero de opencode: ${linea.trim()}`)
      assert(
        !/Write-(Host|Output|Verbose|Information|Warning)|\becho\b/i.test(linea) || !/OPENCODE_SERVER_PASSWORD/i.test(linea),
        `${nombre}: la contraseña (o su nombre) acaba en pantalla: ${linea.trim()}`,
      )
    }
    assert(!/\bsetx\b/i.test(src), `${nombre}: ningún setx`)
    assert(!/SetEnvironmentVariable/i.test(src), `${nombre}: nada escrito en las variables del usuario ni de la máquina`)
    assert(!/opencode\.json/i.test(src), `${nombre}: ni siquiera nombra opencode.json`)
  }
  assert(!/OPENCODE_SERVER_PASSWORD/.test(INSTALAR), 'el instalador no toca la contraseña')
  const pedir = entre(ARRANCAR, 'if (-not $env:OPENCODE_SERVER_PASSWORD) {', "Write-Host \"Faro · arrancando")
  assert(pedir.includes('Read-Host') && pedir.includes('-AsSecureString'), 'se pide sin que se vea al escribirla')
  assert(pedir.includes('ZeroFreeBSTR'), 'y la copia en claro de la memoria se borra')
  eq(ARRANCAR.split('$env:OPENCODE_SERVER_PASSWORD =').length - 1, 1, 'se escribe UNA vez, y sólo en el entorno del proceso')
})

test('H15 SEGURIDAD: ni rastro de «npx mcp-atlassian», que en npm es de otro autor', () => {
  for (const [nombre, crudo] of [['tools/instalar.ps1', INSTALAR_CRUDO], ['tools/arrancar-opencode.ps1', ARRANCAR_CRUDO]]) {
    assert(!/npx\s+(-\S+\s+)*mcp-atlassian/i.test(crudo), `${nombre}: ni en el código ni en los comentarios`)
  }
})

test('H15: con un opencode ya escuchando, el instalador avisa en ROJO de arrancarlo desde una terminal nueva', () => {
  const bloque = entre(INSTALAR, 'if (Opencode-Escuchando $PUERTO) {', "Titulo 'Resumen'")
  const avisos = bloque.split('\n').filter((l) => l.includes('desde una terminal NUEVA: el opencode que está abierto no ve uvx'))
  eq(avisos.length, 2, 'las dos formas del aviso (uv recién instalado, o de antes)')
  for (const a of avisos) assert(a.includes('-ForegroundColor Red'), `en rojo: ${a.trim()}`)
  const salud = entre(INSTALAR, 'function Opencode-Escuchando', '\n}')
  assert(salud.includes('Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/global/health" -UseBasicParsing -TimeoutSec'), 'el GET de salud, con tope de tiempo')
  assert(!/-Method\s+(Post|Put|Patch|Delete)/i.test(INSTALAR + ARRANCAR), 'nunca una escritura a opencode')
})

test('H15: los dos .ps1 llevan BOM, porque PowerShell 5.1 lee un .ps1 sin él como ANSI', () => {
  eq(INSTALAR_CRUDO.charCodeAt(0), 0xfeff, 'tools/instalar.ps1')
  eq(ARRANCAR_CRUDO.charCodeAt(0), 0xfeff, 'tools/arrancar-opencode.ps1')
  const bytes = readFileSync(join(ROOT, 'tools/instalar.ps1'))
  eq([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], 'y es el de UTF-8')
})

test('H15: sólo sintaxis de PowerShell 5.1 (ni && ni ||, ni ??, ni ternario, ni ?.)', () => {
  for (const [nombre, src] of SCRIPTS) {
    assert(!src.includes('&&'), `${nombre}: && no existe en PowerShell 5.1`)
    assert(!src.includes('||'), `${nombre}: || tampoco`)
    assert(!src.includes('??'), `${nombre}: ni el ?? de PowerShell 7`)
    assert(!/\s\?\s/.test(src), `${nombre}: ni el ternario «a ? b : c»`)
    assert(!/\S\?\.[A-Za-z]/.test(src), `${nombre}: ni el ?. de PowerShell 7`)
    assert(src.includes("$ErrorActionPreference = 'Stop'"), `${nombre}: los fallos se paran, no se siguen`)
  }
})

test('H15: arrancar-opencode.ps1 arranca en una carpeta propia, sin leer la configuración ni las instrucciones de donde se lance', () => {
  const lanzar = ARRANCAR.indexOf('& $opencode @argumentos')
  assert(lanzar > 0, 'lanza opencode con los argumentos montados')
  for (const variable of ["$env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'", "$env:OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = '1'"]) {
    const i = ARRANCAR.indexOf(variable)
    assert(i > 0 && i < lanzar, `${variable}, antes de lanzar`)
  }
  assert(ARRANCAR.includes("$carpeta = Join-Path $env:LOCALAPPDATA 'Faro\\opencode-cwd'"), 'la carpeta es de Faro, no la del repo')
  const entrar = ARRANCAR.indexOf('Set-Location -Path $carpeta')
  assert(entrar > 0 && entrar < lanzar, 'y se entra en ella antes de lanzar')
  const id = [...ARRANCAR.matchAll(/^\$EXTENSION_ID\s*=\s*'([^']*)'\s*$/gm)]
  eq(id.length, 1)
  eq(id[0][1], EXTENSION_ID, 'el id de la extensión es el de src/shared/config.js')
  assert(ARRANCAR.includes('$origen = "chrome-extension://$EXTENSION_ID"'), 'el origen del --cors sale de ese id')
  assert(
    ARRANCAR.includes("$argumentos = @('serve', '--port', \"$Port\", '--cors', $origen, '--print-logs', '--log-level', 'INFO')"),
    'el comando de siempre, con --cors',
  )
  assert(ARRANCAR.includes('[int]$Port = 4096'), '-Port, 4096 por defecto')
  eq(INSTALAR.match(/^\$EXTENSION_ID\s*=\s*'([^']*)'/m)?.[1], EXTENSION_ID, 'el instalador enseña el mismo id')
})

test('H15: -SoloMostrar no lanza nada ni pide la contraseña', () => {
  assert(ARRANCAR.includes('[switch]$SoloMostrar'))
  const mostrar = entre(ARRANCAR, 'if ($SoloMostrar) {', '\n}')
  assert(/\n\s*exit 0$/.test(mostrar), 'sale ahí mismo')
  for (const prohibido of ['& $opencode', 'Read-Host', 'New-Item', 'Set-Location', '$env:OPENCODE_']) {
    assert(!mostrar.includes(prohibido), `-SoloMostrar no hace «${prohibido}»`)
  }
  const i = ARRANCAR.indexOf('if ($SoloMostrar) {')
  for (const despues of ['Read-Host', 'New-Item', 'Set-Location', '& $opencode @argumentos']) {
    assert(ARRANCAR.indexOf(despues) > i, `«${despues}» va detrás de la salida de -SoloMostrar`)
  }
  assert(ARRANCAR.includes('Ejecuta primero: powershell -ExecutionPolicy Bypass -File tools\\instalar.ps1'), 'sin opencode, manda al instalador')
})

test('H15: -SoloComprobar no instala nada, y opencode sólo se ofrece con Node detrás y sin instalar Node', () => {
  assert(INSTALAR.includes('[switch]$SoloComprobar'))
  assert(INSTALAR.includes('[switch]$Si'))
  eq(INSTALAR.split('Read-Host').length - 1, 1, 'una sola pregunta en todo el script')
  const opencode = entre(INSTALAR, 'if (-not $opencodeVersion) {', 'if ($opencodeVersion) {')
  const solo = opencode.indexOf('if ($SoloComprobar) {')
  const conNode = opencode.indexOf('} elseif ($nodeMayor -ge 18) {')
  const npm = opencode.indexOf("EjecutarVisible $npm @('i', '-g', 'opencode-ai')")
  const pregunta = opencode.indexOf('Read-Host')
  assert(solo >= 0 && solo < conNode, '-SoloComprobar se mira primero')
  assert(conNode < pregunta && pregunta < npm, 'npm i -g opencode-ai sólo con Node 18 o más y tras preguntar')
  assert(opencode.includes('$aceptar = $Si') && opencode.indexOf('$aceptar = $Si') < pregunta, '-Si responde sin preguntar')
  eq(INSTALAR.split("@('i', '-g', 'opencode-ai')").length - 1, 1, 'y no se instala desde ningún otro sitio')
  assert(!/(winget|choco|scoop|msiexec)[^\n]*(node|OpenJS)/i.test(INSTALAR_CRUDO), 'nunca instala Node')
  // Lo que instala algo va siempre detrás de un «no es -SoloComprobar»: las
  // dos marcas tienen que EXISTIR (un indexOf de -1 también es «antes»).
  const antesQue = (src, guarda, accion, msg) => {
    const g = src.indexOf(guarda)
    const a = src.indexOf(accion)
    assert(g >= 0 && a >= 0 && g < a, msg)
  }
  const uvBloque = entre(INSTALAR, 'if (-not $uvx) {', '$uv = $null')
  antesQue(uvBloque, "} elseif ($SoloComprobar) {\n    Mal 'uv no está instalado.'", 'irm https://astral.sh/uv/install.ps1 | iex', 'sin uv y con -SoloComprobar, no se instala')
  const herramienta = entre(INSTALAR, '$instalado = $false', "Titulo '3.")
  antesQue(herramienta, "if ($SoloComprobar) {\n    $lista = Ejecutar $uv @('tool', 'list')", "@('tool', 'install'", 'con -SoloComprobar se mira «uv tool list» en vez de instalar')
  assert(INSTALAR.includes("if ($SoloComprobar) { $argsUvx = @('--offline') + $argsUvx }"), 'y uvx va sin red')
  assert(/if \(\$faltas\.Count -gt 0\) \{[^}]*exit 1/.test(INSTALAR), 'si falta algo, sale con 1')
})

test('H15: uv se instala con el instalador oficial y, si falla, con winget; detrás de un proxy dice qué fijar', () => {
  const oficial = INSTALAR.indexOf("'irm https://astral.sh/uv/install.ps1 | iex'")
  const winget = INSTALAR.indexOf("@('install', '--id', 'astral-sh.uv', '-e', '--accept-source-agreements', '--accept-package-agreements')")
  assert(oficial > 0 && winget > oficial, 'primero el oficial, winget de respaldo')
  assert(INSTALAR.includes("$uvxLocal = Join-Path $HOME '.local\\bin\\uvx.exe'"), 'antes de instalar se mira donde lo deja el oficial')
  for (const variable of ['UV_NATIVE_TLS=1', 'SSL_CERT_FILE', 'HTTPS_PROXY']) {
    assert(INSTALAR.includes(variable), `el consejo del proxy nombra ${variable}`)
  }
  assert(!/UV_NO_MODIFY_PATH/.test(INSTALAR_CRUDO), 'no se le quita al instalador de uv que ponga el PATH')
  assert(INSTALAR.includes("Ejecutar $uv @('tool', 'dir', '--bin')"), 'mcp-atlassian --version desde el bin de uv tool')
})
