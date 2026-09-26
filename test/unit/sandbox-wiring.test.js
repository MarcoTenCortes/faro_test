/**
 * Cableado de `tools/config-sandbox.mjs` (`npm run sandbox`, H18), por regex
 * sobre su fuente SIN comentarios, como bootstrap-wiring.test.js hace con el
 * content script.
 *
 * Por qué existe: el sandbox ESCRIBE de verdad en la configuración de un
 * opencode, y la única vez que una sonda de Faro lo hizo sin estas guardas
 * (2026-09-25) escribió en el opencode.json REAL de Marco, porque
 * `OPENCODE_CONFIG_DIR` no redirige la configuración global en opencode 1.2.25.
 * No se puede ejecutar en `npm run check` —arranca un `opencode serve` y tarda
 * segundos—, así que se pina lo que no puede dejar de hacer: redirigir el HOME
 * entero, borrar las `OPENCODE_*` heredadas, preguntar `GET /path` ANTES de
 * cualquier escritura, no tocar el 4096, matar el árbol de procesos en un
 * `finally`, no imprimir nunca el token de mentira, y ser el ÚNICO que pasa la
 * puerta de prueba `allowCommand`.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const CRUDO = readFileSync(join(ROOT, 'tools/config-sandbox.mjs'), 'utf8')
const JS = sinComentarios(CRUDO)
const JUGUETE = sinComentarios(readFileSync(join(ROOT, 'tools/toy-mcp.mjs'), 'utf8'))

function cuenta(src, trozo) {
  return src.split(trozo).length - 1
}

/** La posición de un trozo, que tiene que existir. */
function pos(trozo, src = JS) {
  const i = src.indexOf(trozo)
  assert(i >= 0, `no encuentro «${trozo}» en tools/config-sandbox.mjs`)
  return i
}

/** El trozo entre dos marcas, las dos obligatorias y en ese orden. */
function entre(desde, hasta, src = JS) {
  const a = pos(desde, src)
  const b = src.indexOf(hasta, a + desde.length)
  assert(b > a, `no encuentro «${hasta}» después de «${desde}»`)
  return src.slice(a, b)
}

/** Una lista de cadenas declarada como `const NOMBRE = Object.freeze([ … ])`. */
function listaDeclarada(nombre) {
  const trozo = entre(`const ${nombre} = Object.freeze([`, '])')
  return [...trozo.matchAll(/'([^']*)'|(\d+)/g)].map((m) => m[1] ?? Number(m[2]))
}

test('H18 SEGURIDAD: el sandbox redirige el HOME ENTERO, no una variable suelta', () => {
  eq(
    listaDeclarada('HOME_VARS'),
    ['USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'],
    'las variables que deciden dónde está el HOME, todas'
  )
  pos('for (const k of HOME_VARS) env[k] = destino[k]')
  const destino = entre('const destino = {', '\n  }')
  for (const v of listaDeclarada('HOME_VARS')) {
    const linea = destino.split('\n').find((l) => new RegExp('^\\s*' + v + '\\b').test(l))
    assert(linea, `el destino no dice a dónde va ${v}`)
    assert(/\bHOME\b/.test(linea), `${v} no apunta dentro del HOME aislado: ${linea.trim()}`)
  }
  pos("const BASE = join(tmpdir(), 'faro-sandbox-' + process.pid)")
  pos("const HOME = join(BASE, 'home')")
  pos('cwd: TRABAJO,')
  assert(/spawn\(exe, \[[^\]]*\], \{\s*cwd: TRABAJO,\s*env,/.test(JS), 'opencode se lanza con el entorno redirigido y en el directorio de trabajo propio')
})

test('H18 SEGURIDAD: ninguna variable OPENCODE_* llega al opencode aislado', () => {
  eq(
    listaDeclarada('OPENCODE_VARS_BORRADAS'),
    ['OPENCODE_SERVER_PASSWORD', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT'],
    'las cuatro que cambiarían qué configuración lee o exigirían contraseña'
  )
  const borra = entre('const env = { ...process.env }', 'const destino = {')
  assert(borra.includes("if (k.toUpperCase().startsWith('OPENCODE_')) delete env[k]"), 'y cualquier otra OPENCODE_*')
  assert(borra.includes('for (const k of OPENCODE_VARS_BORRADAS) delete env[k]'), 'las cuatro, por su nombre')
  assert(pos('for (const k of OPENCODE_VARS_BORRADAS) delete env[k]') < pos('hijo = spawn('), 'antes de arrancar opencode')
})

test('H18 SEGURIDAD: GET /path se pregunta ANTES de escribir nada, y fuera del HOME no se escribe', () => {
  const guarda = pos('const rutas = await client.paths()')
  const aislado = entre('const aislado =', 'imprime(`aislado:')
  assert(aislado.includes('dentroDe(rutas.config, HOME)'), 'la configuración dentro del HOME aislado')
  assert(aislado.includes('dentroDe(rutas.state, HOME)'), 'y el estado')
  const salida = entre('if (!aislado) {', 'return 1', aislado)
  assert(!/(updateMcpEntries|reloadGlobalConfig|writeFileSync|fetch)\(/.test(salida), 'y sin escribir nada en esa salida')
  // Toda escritura, por el cliente, a mano en el fichero o en crudo, va detrás de la guarda.
  for (const escritura of ['client.updateMcpEntries(', 'client.reloadGlobalConfig(', 'writeFileSync(', 'fetch(`http']) {
    const primera = pos(escritura)
    assert(primera > guarda, `«${escritura}» aparece antes de la guarda de GET /path`)
  }
  assert(pos('const aislado =') < pos('client.updateMcpEntries('), 'la guarda, antes del primer PATCH')
  const dentro = entre('function dentroDe(ruta, base) {', '\n}\n')
  assert(dentro.includes('.toLowerCase()') && dentro.includes('r.startsWith(b + sep)'), 'dentro de, con separador y sin mayúsculas: C:\\x\\home2 no está dentro de C:\\x\\home')
})

test('H18 SEGURIDAD: el sandbox nunca usa el puerto 4096 (ni los de las sondas anteriores)', () => {
  eq(listaDeclarada('PUERTOS_PROHIBIDOS'), [4096, 4151, 4157, 4158])
  pos('const PUERTO_MIN = 4200')
  pos('const PUERTO_MAX = 4299')
  eq(cuenta(JS, '4096'), 1, 'el 4096 sólo aparece en la lista de prohibidos')
  assert(entre('async function puertoLibre() {', '\n}\n').includes('if (PUERTOS_PROHIBIDOS.includes(p)) continue'), 'se salta los prohibidos al buscar')
  assert(JS.includes('if (!puerto || PUERTOS_PROHIBIDOS.includes(puerto)) {'), 'y se comprueba otra vez antes de lanzar')
  pos("'--port', String(puerto)")
})

test('H18: al acabar, el árbol de procesos se mata en un finally y el directorio se borra', () => {
  const fin = entre('} finally {', '\n}\n')
  assert(fin.includes('await limpiar()'), 'el finally limpia, pase lo que pase')
  const limpiar = entre('const limpiar = async () => {', '\n  }\n')
  assert(limpiar.includes('matarArbol(hijo?.pid)'), 'limpiar mata el árbol')
  assert(pos('matarArbol(hijo?.pid)') < pos('await borrar(BASE))'), 'antes de borrar, que Windows no suelta ficheros de un proceso vivo')
  const matar = entre('function matarArbol(pid) {', '\n}\n')
  assert(matar.includes("spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']"), 'taskkill del árbol entero (/T), a la fuerza (/F)')
  assert(JS.includes("process.once('SIGINT', alInterrumpir)"), 'y también con Ctrl+C')
})

test('H18 SEGURIDAD: el token de mentira se declara una vez, sólo se compara y nunca se imprime', () => {
  eq(cuenta(JS, 'const TOKEN_DE_MENTIRA ='), 1, 'una declaración')
  // Cada uso: escribirlo en la entrada (hace falta para probar que se va del disco) o compararlo.
  const usos = JS.split('\n').filter((l) => l.includes('TOKEN_DE_MENTIRA') && !l.includes('const TOKEN_DE_MENTIRA ='))
  assert(usos.length >= 6, 'lo usan los casos 1, 2 y 4 y la salida')
  for (const l of usos) {
    const resto = l.replace(/\.includes\(TOKEN_DE_MENTIRA\)/g, '').replace(/token: TOKEN_DE_MENTIRA\b/g, '')
    assert(!resto.includes('TOKEN_DE_MENTIRA'), `uso que no es una comparación ni la entrada: ${l.trim()}`)
    assert(!/console\.|process\.std(out|err)|imprime\(|apunta\(/.test(l), `una línea que imprime nombra el token: ${l.trim()}`)
  }
  // Toda la salida pasa por `imprime`, que es la única que llama a console.log y comprueba el token antes.
  const imprime = entre('function imprime(texto = \'\') {', '\n}\n')
  eq(cuenta(JS, 'console.'), cuenta(imprime, 'console.'), 'ningún console.* fuera de imprime')
  const mira = pos('if (linea.includes(TOKEN_DE_MENTIRA)) {', imprime)
  assert(mira < pos('console.log(linea)', imprime), 'se mira ANTES de imprimir')
  assert(/if \(linea\.includes\(TOKEN_DE_MENTIRA\)\) \{\s*salidaLimpia = false[\s\S]*?return\s*\}/.test(imprime), 'y si lo lleva, no sale y se apunta el fallo')
  assert(!/process\.std(out|err)\.write/.test(JS), 'ni una escritura directa a la consola')
  assert(JS.includes('return fallos || !salidaLimpia ? 1 : 0'), 'y si alguna línea llevaba el token, el sandbox falla')
  // Los registros de opencode (un ConfigJsonError mete ahí el fichero entero) van a ficheros del sandbox y no se leen.
  assert(!/readFileSync\((salida|errores)\b/.test(JS), 'los logs de opencode no se leen para imprimirlos')
})

test('H18 SEGURIDAD: sólo el sandbox pasa la puerta de prueba allowCommand', () => {
  const ficheros = []
  const recorre = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) recorre(p)
      else if (/\.(m?js|html)$/.test(n)) ficheros.push(p)
    }
  }
  recorre(join(ROOT, 'src'))
  const conPuerta = ficheros.filter((f) => readFileSync(f, 'utf8').includes('allowCommand')).map((f) => relative(ROOT, f).replaceAll('\\', '/'))
  eq(conPuerta, ['src/shared/mcp-config.js'], 'en src/ sólo la barrera, que la define')
  assert(/client\.updateMcpEntries\(\{ \[NOMBRE\]: entrada\(\['node', JUGUETE\]\) \}\)\n/.test(JS), 'el caso 0 prueba la puerta REAL, sin la opción')
  assert(cuenta(JS, ', { allowCommand })') >= 4, 'los demás PATCH la pasan explícita')
  const puerta = entre('const allowCommand = (cmd) =>', '\n')
  assert(puerta.includes("cmd[0] === 'node'") && puerta.includes('cmd[1] === JUGUETE'), 'y sólo abre el command del juguete, no cualquiera')
  pos("from '../src/opencode/client.js'")
  pos("from '../src/shared/mcp-config.js'")
})

test('H18: el MCP de juguete registra dentro del sandbox, no junto al repo', () => {
  assert(JUGUETE.includes('process.env.FARO_TOY_LOG'), 'la ruta del registro la da el sandbox')
  assert(!JUGUETE.includes('import.meta.url'), 'ya no escribe junto a su propio fichero')
  assert(/if \(!LOG\) return/.test(JUGUETE), 'sin la variable no registra nada')
  assert(!/process\.env\.(?!FARO_TOY_LOG)/.test(JUGUETE), 'no lee ninguna otra variable del entorno (ni las del MCP, que llevarían tokens)')
  pos("const LOG_JUGUETE = join(BASE, 'toy-mcp.log')")
  pos('env.FARO_TOY_LOG = LOG_JUGUETE')
})

test('H18: npm run sandbox existe y queda FUERA de npm run check', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  eq(pkg.scripts.sandbox, 'node tools/config-sandbox.mjs')
  for (const s of ['check', 'test', 'test:integration']) assert(!pkg.scripts[s].includes('sandbox'), `${s} no lo lanza`)
  assert(!readFileSync(join(ROOT, 'test/run.js'), 'utf8').includes('config-sandbox'), 'test/run.js no lo ejecuta')
  assert(/if \(process\.argv\[1\] && resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)\) \{/.test(JS), 'importarlo no arranca nada')
})
