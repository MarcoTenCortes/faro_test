/**
 * `npm run sandbox`: lo que H18 escribe en la configuración de opencode,
 * comprobado contra un opencode DE VERDAD y AISLADO (docs/PLAN2.md §3.2 y la
 * ficha de H18; la verdad de terreno es docs/plan/anexo-2-A-mcp-automatico.md).
 *
 * Por qué existe y por qué es tan desconfiado. Desde H18 Faro escribe con
 * `PATCH /global/config` en el fichero de configuración GLOBAL de opencode, y
 * eso sólo se puede probar escribiendo de verdad. El 2026-09-25 una sonda que
 * daba por hecho que `OPENCODE_CONFIG_DIR` redirige esa configuración escribió
 * en el opencode.json REAL de Marco: en opencode 1.2.25 esa variable NO
 * redirige la configuración global. De ahí las dos reglas que este script no se
 * salta nunca:
 *  1. se arranca un `opencode serve` PROPIO con el HOME ENTERO redirigido a un
 *     directorio bajo `os.tmpdir()` (`HOME_VARS`), sin ninguna variable
 *     `OPENCODE_*` heredada, en un puerto libre alto (nunca 4096: ése es el de
 *     Marco);
 *  2. ANTES DE ESCRIBIR NADA se pregunta `GET /path` y, si la configuración o el
 *     estado no caen DENTRO de ese HOME aislado, se sale con 1 sin escribir.
 *
 * Qué comprueba, con el cliente REAL (src/opencode/client.js) y la barrera REAL
 * (src/shared/mcp-config.js) y el MCP de juguete `tools/toy-mcp.mjs`:
 *  0. la puerta real: el `command` del juguete NO pasa la barrera sin la opción
 *     de prueba, y no sale ninguna petición;
 *  1. un PATCH con una entrada nueva → «connected» en menos de 2 s, y en disco
 *     con `enabled: true`;
 *  2. la entrada ENTERA reescrita con `enabled: false` y las diez variables a ''
 *     → «disabled», y el token de mentira ya no está en el fichero;
 *  3. un bloque pegado a mano en el fichero → `reloadGlobalConfig()` →
 *     «connected» en menos de 2 s, sin reiniciar opencode;
 *  4. con el fichero roto (error de sintaxis) el PATCH da 500 `ConfigJsonError`,
 *     el fichero no cambia, y SEGURIDAD: ni lo que devuelve el cliente ni su
 *     registro llevan el token de mentira que el fichero sí tiene (y el control:
 *     el cuerpo crudo del mismo PATCH SÍ lo lleva, que es por lo que hace falta
 *     la barrera);
 *  5. un `command` con una ruta con espacios arranca;
 *  6. el directorio de trabajo del serve y el HOME aislado no llevan AGENTS.md
 *     ni CLAUDE.md, y `GET /config` no trae `instructions` (que opencode no meta
 *     «Instructions from:» con un turno de verdad queda para cuando haya
 *     permiso de gasto: aquí no se manda NINGÚN turno de modelo);
 *  7. (H19) quitar las claves con las funciones REALES del panel
 *     (`mcpScrubCandidates` + `scrubMcp`): el juguete y otra entrada del mismo
 *     dominio en UN solo PATCH —las dos AJENAS y marcadas: desde la revisión
 *     adversaria de H19 el nombre guardado no basta para ser «de Faro», hace
 *     falta su `command`, y el del juguete es `node`—, sin datos de más
 *     (`restos` false), las dos «disabled», en disco con `enabled: false` y las
 *     diez variables a '' y sin el token en el fichero; `scrubEffective` lo da
 *     por bueno, `mcpForHost` ya no adopta nada (sin bucle), y volver a guardar
 *     con `configureMcp` y el registro que DE VERDAD deja el panel (el que
 *     devuelve `unlinkRecords`, que conserva `mcpName`) REUTILIZA el esqueleto y
 *     conecta sin la puerta de prueba;
 *  8. (H19) una entrada deshabilitada A MANO con sus URL y su token (la forma que
 *     deja alguien que la apaga en el fichero) no se adopta, y guardar las
 *     claves con `configureMcp` la reutiliza por su nombre de Faro, la
 *     habilita y conecta.
 *
 * La puerta de PRUEBA: el `command` del juguete (`['node', <ruta>]`) no está en
 * la lista blanca de `validMcpCommand`, así que se pasa `allowCommand` a
 * `updateMcpEntries`, que la entrega tal cual a `mcpPatchBody`. Sólo este
 * fichero la pasa: en src/panel/ y src/opencode/ no aparece (pinado en
 * mcp-config.test.js y en sandbox-wiring.test.js).
 *
 * El token de mentira: una cadena aleatoria que se declara UNA vez, se escribe
 * en la entrada y sólo se usa en comparaciones; nada de lo que se imprime lo
 * lleva (lo comprueba `imprime` en tiempo de ejecución, y el test por el
 * fuente). Los registros de opencode van a ficheros dentro del sandbox y no se
 * imprimen, porque un ConfigJsonError mete el fichero entero en ellos.
 *
 * Al acabar, SIEMPRE —también si algo falla o se pulsa Ctrl+C—, mata el árbol
 * de procesos (`taskkill /T /F`: opencode y los MCP que haya lanzado) y borra el
 * directorio (salvo con `--conservar`). Imprime cada caso con sus ms y sale con 1
 * si alguno falla. Está FUERA de `npm run check` y de `test:integration`, como
 * `npm run bench` y `npm run contrast`: arranca un proceso y tarda segundos.
 *
 * Uso: `npm run sandbox [-- --exe <ruta de opencode.exe>] [-- --conservar]`.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OpencodeClient } from '../src/opencode/client.js'
import { MCP_ENV_KEYS } from '../src/shared/mcp-config.js'
import { Logger } from '../src/shared/log.js'
import { buildMcpConfig, configFileCandidates, configureMcp, mcpForHost, mcpScrubCandidates, scrubEffective, scrubMcp, unlinkRecords } from '../src/panel/setup.js'
import { mcpNameForHost } from '../src/shared/config.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const JUGUETE = join(AQUI, 'toy-mcp.mjs')

/**
 * Las variables que deciden dónde está el HOME de un proceso en Windows (y en
 * los XDG que bun y opencode miran): TODAS se redirigen, porque redirigir sólo
 * una —`OPENCODE_CONFIG_DIR`, el 2026-09-25— dejó la configuración global en el
 * HOME real. `TEMP`/`TMP` también, para que ni un temporal de opencode caiga
 * fuera del directorio que se borra al acabar.
 */
const HOME_VARS = Object.freeze([
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
])

/**
 * Las variables de opencode que NO pueden heredarse: una contraseña, o una
 * configuración que opencode leería antes o además de la del HOME aislado.
 * Además se borra cualquier otra `OPENCODE_*` del entorno.
 */
const OPENCODE_VARS_BORRADAS = Object.freeze([
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG_CONTENT',
])

/** Puertos que no se tocan nunca: el de Marco y los de las sondas anteriores. */
const PUERTOS_PROHIBIDOS = Object.freeze([4096, 4151, 4157, 4158])

/** El rango en el que se busca un puerto libre. */
const PUERTO_MIN = 4200
const PUERTO_MAX = 4299

/** Lo que se tarda como mucho en ver aparecer un MCP, y cada cuánto se mira. */
const APARECE_MS = 2000
const ESPERA_MAX_MS = 6000
const SONDEO_MS = 50

/** El token de mentira: se declara aquí UNA vez y sólo se compara, nunca se imprime. */
const TOKEN_DE_MENTIRA = 'faro-sandbox-' + randomUUID()

// ------------------------------------------------------------------ salida

let salidaLimpia = true

/** Imprime una línea; si llevara el token de mentira, no sale y el sandbox falla. */
function imprime(texto = '') {
  const linea = String(texto)
  if (linea.includes(TOKEN_DE_MENTIRA)) {
    salidaLimpia = false
    console.log('[una línea con el token de mentira NO se imprime: esto es un fallo del sandbox]')
    return
  }
  console.log(linea)
}

// --------------------------------------------------------------- utilidades

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

/** ¿Cuelga `ruta` de `base`? (sin distinguir mayúsculas, que es como Windows compara). */
function dentroDe(ruta, base) {
  if (typeof ruta !== 'string' || !ruta) return false
  const r = resolve(ruta).toLowerCase()
  const b = resolve(base).toLowerCase()
  return r === b || r.startsWith(b + sep)
}

function sha256(ruta) {
  return createHash('sha256').update(readFileSync(ruta)).digest('hex')
}

/** ¿Hay alguien escuchando en ese puerto? Con un connect: rechazado = libre. */
function puertoOcupado(puerto) {
  return new Promise((ok) => {
    const s = connect({ host: '127.0.0.1', port: puerto })
    const fin = (ocupado) => {
      s.destroy()
      ok(ocupado)
    }
    s.setTimeout(500, () => fin(true))
    s.once('connect', () => fin(true))
    s.once('error', (err) => fin(err?.code !== 'ECONNREFUSED'))
  })
}

async function puertoLibre() {
  const n = PUERTO_MAX - PUERTO_MIN + 1
  const inicio = Math.floor(Math.random() * n)
  for (let i = 0; i < n; i++) {
    const p = PUERTO_MIN + ((inicio + i) % n)
    if (PUERTOS_PROHIBIDOS.includes(p)) continue
    if (!(await puertoOcupado(p))) return p
  }
  return 0
}

/**
 * El opencode.exe de verdad: `opencode` en Windows es un .ps1/.cmd de npm que
 * lanza el binario de `node_modules/opencode-ai/node_modules/opencode-windows-x64/bin`.
 */
function buscarOpencode(exeDado) {
  if (exeDado) return existsSync(exeDado) ? exeDado : ''
  const r = spawnSync('where.exe', ['opencode'], { encoding: 'utf8', windowsHide: true })
  const lineas = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const l of lineas) {
    if (/\.exe$/i.test(l) && existsSync(l)) return l
    const bin = join(dirname(l), 'node_modules', 'opencode-ai', 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe')
    if (existsSync(bin)) return bin
  }
  return ''
}

/** Mata el árbol de procesos entero (opencode y los MCP que haya lanzado). */
function matarArbol(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* ya no estaba */
    }
  }
}

/** Borra el directorio del sandbox, con reintentos: tras matar el árbol, Windows tarda en soltar los ficheros. */
async function borrar(dir) {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      if (!existsSync(dir)) return true
    } catch {
      /* ficheros todavía abiertos */
    }
    await esperar(300)
  }
  return !existsSync(dir)
}

/** Lee el fichero de configuración como objeto (un .jsonc de opencode puede llevar comentarios). */
function leerConfig(ruta) {
  const texto = readFileSync(ruta, 'utf8')
  try {
    return JSON.parse(texto)
  } catch {
    const sin = texto.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(sin)
  }
}

/** Sondea `GET /mcp` hasta que `nombre` está en `estado`; devuelve los ms, o -1. */
async function esperarEstado(client, nombre, estado, { maxMs = ESPERA_MAX_MS } = {}) {
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    const lista = await client.listMcp().catch(() => null)
    if (lista?.[nombre]?.status === estado) return Math.round(performance.now() - t0)
    await esperar(SONDEO_MS)
  }
  return -1
}

function arranquesDelJuguete(log) {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').split('\n').filter((l) => l.includes(' ARRANQUE '))
}

// ------------------------------------------------------------------ casos

const resultados = []

/** Un caso: su nombre, si pasó, sus ms y el detalle (sin tokens: lo vigila `imprime`). */
function apunta(nombre, ok, ms, detalle) {
  resultados.push({ nombre, ok: !!ok })
  imprime(`${ok ? 'OK  ' : 'FALLA'} ${nombre} · ${ms} ms${detalle ? ' · ' + detalle : ''}`)
}

async function main() {
  const args = process.argv.slice(2)
  const conservar = args.includes('--conservar')
  const iExe = args.indexOf('--exe')
  const exe = buscarOpencode(iExe >= 0 ? args[iExe + 1] : '')
  if (!exe) {
    imprime('ERROR: no encuentro opencode.exe (where.exe opencode, o pásalo con --exe <ruta>).')
    return 1
  }

  const BASE = join(tmpdir(), 'faro-sandbox-' + process.pid)
  const HOME = join(BASE, 'home')
  const TRABAJO = join(BASE, 'work')
  const LOG_JUGUETE = join(BASE, 'toy-mcp.log')
  for (const d of [HOME, TRABAJO, join(HOME, '.config'), join(HOME, '.local', 'share'), join(HOME, '.local', 'state'), join(HOME, '.cache'), join(HOME, 'AppData', 'Roaming'), join(HOME, 'AppData', 'Local'), join(HOME, 'Temp')]) {
    mkdirSync(d, { recursive: true })
  }

  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.toUpperCase().startsWith('OPENCODE_')) delete env[k]
  for (const k of OPENCODE_VARS_BORRADAS) delete env[k]
  const destino = {
    USERPROFILE: HOME,
    HOME,
    HOMEDRIVE: HOME.slice(0, 2),
    HOMEPATH: HOME.slice(2),
    XDG_CONFIG_HOME: join(HOME, '.config'),
    XDG_DATA_HOME: join(HOME, '.local', 'share'),
    XDG_STATE_HOME: join(HOME, '.local', 'state'),
    XDG_CACHE_HOME: join(HOME, '.cache'),
    APPDATA: join(HOME, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(HOME, 'AppData', 'Local'),
    TEMP: join(HOME, 'Temp'),
    TMP: join(HOME, 'Temp'),
  }
  for (const k of HOME_VARS) env[k] = destino[k]
  env.FARO_TOY_LOG = LOG_JUGUETE

  const puerto = await puertoLibre()
  if (!puerto || PUERTOS_PROHIBIDOS.includes(puerto)) {
    imprime(`ERROR: ningún puerto libre entre ${PUERTO_MIN} y ${PUERTO_MAX}.`)
    await borrar(BASE)
    return 1
  }

  imprime(`sandbox: ${BASE}`)
  imprime(`opencode: ${exe}`)
  imprime(`puerto: ${puerto}`)

  const salida = join(BASE, 'opencode.out.log')
  const errores = join(BASE, 'opencode.err.log')
  let hijo = null
  let terminado = false
  const limpiar = async () => {
    if (terminado) return
    terminado = true
    matarArbol(hijo?.pid)
    if (conservar) imprime(`(conservado: ${BASE})`)
    else if (!(await borrar(BASE))) imprime(`AVISO: no he podido borrar ${BASE}`)
  }
  const alInterrumpir = () => {
    limpiar().finally(() => process.exit(1))
  }
  process.once('SIGINT', alInterrumpir)

  try {
    const fdOut = openSync(salida, 'a')
    const fdErr = openSync(errores, 'a')
    hijo = spawn(exe, ['serve', '--port', String(puerto), '--print-logs', '--log-level', 'INFO'], {
      cwd: TRABAJO,
      env,
      stdio: ['ignore', fdOut, fdErr],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    closeSync(fdOut)
    closeSync(fdErr)
    let salioYa = false
    hijo.once('exit', () => {
      salioYa = true
    })

    const logger = new Logger({ limit: 1000 })
    const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:' + puerto, password: '', logger })

    // Que conteste.
    const t0 = performance.now()
    let version = ''
    while (performance.now() - t0 < 30000 && !salioYa) {
      version = await client.version().catch(() => '')
      if (version) break
      await esperar(200)
    }
    if (!version || salioYa) {
      imprime('ERROR: el opencode aislado no ha arrancado (mira --conservar y sus logs).')
      return 1
    }
    imprime(`versión: ${version} · arrancado en ${Math.round(performance.now() - t0)} ms`)

    // LA GUARDA: antes de escribir nada, la configuración y el estado tienen que caer DENTRO del HOME aislado.
    const rutas = await client.paths().catch(() => null)
    const aislado =
      !!rutas && dentroDe(rutas.config, HOME) && dentroDe(rutas.state, HOME) && (!rutas.home || dentroDe(rutas.home, HOME))
    if (!aislado) {
      imprime('ERROR: GET /path no cae dentro del HOME aislado; no escribo NADA.')
      imprime(`  config: ${rutas?.config || '(nada)'} · state: ${rutas?.state || '(nada)'}`)
      return 1
    }
    imprime(`aislado: config=${rutas.config}`)
    const DIR_CONFIG = rutas.config

    const JUGUETE_ESPACIOS = join(BASE, 'con espacios', 'toy-mcp.mjs')
    const allowCommand = (cmd) => cmd.length === 2 && cmd[0] === 'node' && (cmd[1] === JUGUETE || cmd[1] === JUGUETE_ESPACIOS)

    /** Una entrada con la forma REAL de Faro (buildMcpConfig) y el command del juguete. */
    const entrada = (command, { enabled = true, vacia = false } = {}) => {
      const bloque = buildMcpConfig({ jira: { url: 'https://jira.ejemplo.invalid', token: TOKEN_DE_MENTIRA }, dataCenter: true })
      const environment = vacia ? Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, ''])) : bloque.environment
      return { type: 'local', command, environment, enabled, timeout: 60000 }
    }
    const NOMBRE = 'faro-sandbox'
    const ficheroConfig = () => join(DIR_CONFIG, configFileCandidates(existsSync(DIR_CONFIG) ? readdirSync(DIR_CONFIG) : [])[0])

    // 0. La puerta real: sin la opción de prueba, el command del juguete no pasa y no sale ninguna petición.
    {
      const antes = logger.entries.length
      const t = performance.now()
      const r = await client.updateMcpEntries({ [NOMBRE]: entrada(['node', JUGUETE]) })
      const peticiones = logger.entries.slice(antes).filter((e) => e.message.startsWith('PATCH ')).length
      apunta(
        '0 la barrera rechaza un command fuera de la lista blanca, sin petición',
        r.ok === false && r.status === 0 && r.kind === 'entrada' && peticiones === 0,
        Math.round(performance.now() - t),
        `kind=${r.kind} · peticiones PATCH=${peticiones}`
      )
    }

    // 1. PATCH → connected en menos de 2 s, y en disco con enabled true.
    {
      const t = performance.now()
      const r = await client.updateMcpEntries({ [NOMBRE]: entrada(['node', JUGUETE]) }, { allowCommand })
      const msPatch = Math.round(performance.now() - t)
      const ms = r.ok ? await esperarEstado(client, NOMBRE, 'connected') : -1
      const fichero = ficheroConfig()
      const hay = existsSync(fichero)
      const cfg = hay ? leerConfig(fichero) : null
      const enDisco = cfg?.mcp?.[NOMBRE]?.enabled === true
      const conToken = hay && readFileSync(fichero, 'utf8').includes(TOKEN_DE_MENTIRA)
      const arranques = arranquesDelJuguete(LOG_JUGUETE).length
      apunta(
        '1 PATCH con una entrada nueva: connected y en disco con enabled true',
        r.ok && ms >= 0 && ms < APARECE_MS && enDisco && conToken && arranques >= 1,
        ms,
        `PATCH ${r.status} en ${msPatch} ms · fichero ${hay ? fichero.split(sep).pop() : '(no existe)'} · enabled=${enDisco} · arranques del juguete=${arranques}`
      )
    }

    // 2. La entrada ENTERA con enabled false y las diez variables a '' → disabled, sin el token en disco.
    {
      const t = performance.now()
      const r = await client.updateMcpEntries({ [NOMBRE]: entrada(['node', JUGUETE], { enabled: false, vacia: true }) }, { allowCommand })
      const ms = r.ok ? await esperarEstado(client, NOMBRE, 'disabled') : -1
      const fichero = ficheroConfig()
      const texto = existsSync(fichero) ? readFileSync(fichero, 'utf8') : ''
      const cfg = texto ? leerConfig(fichero) : null
      const sinToken = !!texto && !texto.includes(TOKEN_DE_MENTIRA)
      const env2 = cfg?.mcp?.[NOMBRE]?.environment || {}
      const todasVacias = MCP_ENV_KEYS.every((k) => env2[k] === '')
      apunta(
        '2 la entrada entera con enabled false y las variables a vacío: disabled y sin token en disco',
        r.ok && ms >= 0 && cfg?.mcp?.[NOMBRE]?.enabled === false && sinToken && todasVacias,
        ms,
        `PATCH ${r.status} · enabled=${cfg?.mcp?.[NOMBRE]?.enabled} · token en disco=${!sinToken} · las diez vacías=${todasVacias}`
      )
    }

    // 3. Un bloque pegado a mano → reloadGlobalConfig() → connected en menos de 2 s.
    {
      const fichero = ficheroConfig()
      const cfg = leerConfig(fichero)
      cfg.mcp = cfg.mcp || {}
      cfg.mcp['pegado-a-mano'] = { type: 'local', command: ['node', JUGUETE], enabled: true }
      writeFileSync(fichero, JSON.stringify(cfg, null, 4))
      await esperar(300)
      const antes = await client.listMcp().catch(() => null)
      const ausenteAntes = !antes?.['pegado-a-mano']
      let conArgumento = false
      try {
        client.reloadGlobalConfig({ mcp: {} })
      } catch (err) {
        conArgumento = err instanceof TypeError
      }
      const t = performance.now()
      const r = await client.reloadGlobalConfig()
      const ms = r.ok ? await esperarEstado(client, 'pegado-a-mano', 'connected') : -1
      apunta(
        '3 un bloque pegado a mano se carga con reloadGlobalConfig, sin reiniciar',
        r.ok && ms >= 0 && ms < APARECE_MS && ausenteAntes && conArgumento,
        ms,
        `PATCH {} ${r.status} en ${Math.round(performance.now() - t)} ms en total · ausente antes de recargar=${ausenteAntes} · con argumento: TypeError=${conArgumento}`
      )
    }

    // 4. Fichero roto → 500 ConfigJsonError, fichero intacto, y ni la respuesta ni el registro llevan el token.
    {
      const fichero = ficheroConfig()
      const bueno = readFileSync(fichero, 'utf8')
      const cfg = leerConfig(fichero)
      cfg.mcp['con-token'] = entrada(['node', JUGUETE])
      const valido = JSON.stringify(cfg, null, 2)
      const roto = valido.replace(/}\s*$/, '')
      writeFileSync(fichero, roto)
      const tokenEnFichero = readFileSync(fichero, 'utf8').includes(TOKEN_DE_MENTIRA)
      const hashAntes = sha256(fichero)
      const t = performance.now()
      const r = await client.updateMcpEntries({ 'faro-sandbox-2': entrada(['node', JUGUETE]) }, { allowCommand })
      const ms = Math.round(performance.now() - t)
      const intacto = sha256(fichero) === hashAntes
      const enRespuesta = JSON.stringify(r).includes(TOKEN_DE_MENTIRA)
      const enRegistro = JSON.stringify(logger.entries).includes(TOKEN_DE_MENTIRA)
      // Control: el MISMO PATCH en crudo, sin el cliente, SÍ trae el fichero con el token en su cuerpo.
      const crudo = await fetch(`http://127.0.0.1:${puerto}/global/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcp: {} }),
      })
      const cuerpoCrudo = await crudo.text()
      const controlLleva = cuerpoCrudo.includes(TOKEN_DE_MENTIRA)
      const intactoTrasControl = sha256(fichero) === hashAntes
      writeFileSync(fichero, bueno)
      const recarga = await client.reloadGlobalConfig()
      apunta(
        '4 SEGURIDAD: con el fichero roto, 500 ConfigJsonError, fichero intacto y el token fuera de lo que el cliente devuelve y registra',
        tokenEnFichero && r.ok === false && r.status === 500 && r.kind === 'ConfigJsonError' && intacto && intactoTrasControl && !enRespuesta && !enRegistro && controlLleva && recarga.ok,
        ms,
        `status=${r.status} kind=${r.kind} · fichero intacto=${intacto && intactoTrasControl} · token en la respuesta=${enRespuesta} · en el registro=${enRegistro} · control (cuerpo crudo ${crudo.status} lleva el token)=${controlLleva} · restaurado y recargado=${recarga.ok}`
      )
    }

    // 5. Una ruta con espacios en el command arranca.
    {
      mkdirSync(dirname(JUGUETE_ESPACIOS), { recursive: true })
      copyFileSync(JUGUETE, JUGUETE_ESPACIOS)
      const arranquesAntes = arranquesDelJuguete(LOG_JUGUETE).filter((l) => l.includes('con espacios')).length
      const t = performance.now()
      const r = await client.updateMcpEntries({ 'faro-espacios': entrada(['node', JUGUETE_ESPACIOS]) }, { allowCommand })
      const ms = r.ok ? await esperarEstado(client, 'faro-espacios', 'connected') : -1
      const arranques = arranquesDelJuguete(LOG_JUGUETE).filter((l) => l.includes('con espacios')).length
      apunta(
        '5 un command con una ruta con espacios arranca',
        r.ok && ms >= 0 && ms < APARECE_MS && arranques > arranquesAntes,
        ms,
        `PATCH ${r.status} en ${Math.round(performance.now() - t)} ms en total · arranques desde «con espacios»=${arranques}`
      )
    }

    // 6. Ni AGENTS.md ni CLAUDE.md en el cwd del serve ni en el HOME aislado, y GET /config sin instructions.
    {
      const t = performance.now()
      const sitios = [TRABAJO, HOME, join(HOME, '.config', 'opencode'), DIR_CONFIG]
      const encontrados = []
      for (const d of sitios) for (const f of ['AGENTS.md', 'CLAUDE.md']) if (existsSync(join(d, f))) encontrados.push(join(d, f))
      const cfg = await client.config().catch(() => null)
      const instrucciones = cfg && Object.hasOwn(cfg, 'instructions') ? cfg.instructions : undefined
      const sinInstrucciones = !!cfg && (instrucciones === undefined || (Array.isArray(instrucciones) && instrucciones.length === 0))
      apunta(
        '6 sin AGENTS.md ni CLAUDE.md en el cwd ni en el HOME, y GET /config sin instructions',
        encontrados.length === 0 && sinInstrucciones,
        Math.round(performance.now() - t),
        `ficheros=${encontrados.length} · instructions=${instrucciones === undefined ? '(ausente)' : Array.isArray(instrucciones) ? instrucciones.length + ' entradas' : typeof instrucciones} · (con un turno real: pendiente de permiso de gasto)`
      )
    }

    // 7. (H19) Quitar con el módulo REAL: un solo PATCH, disabled y sin claves en disco; volver a guardar reutiliza el esqueleto.
    {
      const HOST7 = 'jira.ejemplo.invalid'
      // (a) NOMBRE otra vez habilitado y con el token (el caso 2 lo dejó deshabilitado), como en el caso 1.
      const rehabilitar = await client.updateMcpEntries({ [NOMBRE]: entrada(['node', JUGUETE]) }, { allowCommand })
      const conectadaAntes = rehabilitar.ok ? await esperarEstado(client, NOMBRE, 'connected') : -1
      // (b) Las candidatas, con la MISMA función que usa el panel. Desde la revisión adversaria de H19 el
      // nombre guardado no basta para ser «de Faro»: hace falta además su command, y el del juguete es
      // `node`, así que NOMBRE es AJENA aunque sea el nombre guardado (como una docker adoptada en H18);
      // «faro-espacios» (caso 5), ajena por el dominio; «pegado-a-mano» (sin environment), fuera. Ninguna
      // guarda datos que Faro no sepa vaciar (`restos`). Las dos ajenas van MARCADAS, como con la casilla.
      const cands = mcpScrubCandidates({ config: await client.config(), saved: { mcpName: NOMBRE }, host: HOST7 })
      const nombresDe = (lista) => lista.map((c) => c.name)
      const todas = [...nombresDe(cands.propias), ...nombresDe(cands.ajenas), ...nombresDe(cands.noQuitables)]
      const bienElegidas =
        nombresDe(cands.ajenas).includes(NOMBRE) &&
        !nombresDe(cands.propias).includes(NOMBRE) &&
        nombresDe(cands.ajenas).includes('faro-espacios') &&
        !todas.includes('pegado-a-mano') &&
        [...cands.propias, ...cands.ajenas].every((c) => c.restos === false)
      // (c) UN solo PATCH para las dos, contado en el registro del cliente.
      const antes = logger.entries.length
      const t = performance.now()
      const r = await scrubMcp(client, { candidatas: [...cands.propias, ...cands.ajenas] })
      const msPatch = Math.round(performance.now() - t)
      const peticiones = logger.entries.slice(antes).filter((e) => e.message.startsWith('PATCH ')).length
      // (d) Las dos «disabled»; en disco, enabled false y las diez vacías en CADA una; el token, ni en esas
      // entradas ni en el fichero entero (las dos que lo llevaban se limpian a la vez: por eso la ajena va marcada).
      const msDisabled = r.ok ? await esperarEstado(client, NOMBRE, 'disabled') : -1
      const msEspacios = r.ok ? await esperarEstado(client, 'faro-espacios', 'disabled') : -1
      const fichero = ficheroConfig()
      const texto = existsSync(fichero) ? readFileSync(fichero, 'utf8') : ''
      const cfg = texto ? leerConfig(fichero) : null
      const limpias = r.names.length === 2 && r.names.every((n) => cfg?.mcp?.[n]?.enabled === false && MCP_ENV_KEYS.every((k) => cfg.mcp[n].environment?.[k] === ''))
      const tokenEnEntradas = r.names.some((n) => JSON.stringify(cfg?.mcp?.[n] ?? {}).includes(TOKEN_DE_MENTIRA))
      const tokenEnFichero = !texto || texto.includes(TOKEN_DE_MENTIRA)
      const efectiva = scrubEffective(await client.config().catch(() => null), r.names)
      // (e) Sin bucle: ya no hay nada que adoptar para ese dominio.
      const adoptada = mcpForHost(await client.config().catch(() => null), HOST7)
      // (f) Volver a guardar las claves con el registro que DE VERDAD deja el panel: el que devuelve
      // unlinkRecords con los nombres quitados (revisión adversaria de H19: conserva mcpName, y es ese nombre
      // lo que hace que configureMcp reutilice el esqueleto, que ya no lleva ningún dominio), conservando
      // el command del juguete por `known`, SIN la puerta de prueba.
      const registro7 = { host: HOST7, configured: true, mcpName: NOMBRE }
      const desmarcados = unlinkRecords({ sites: { [HOST7]: registro7 }, names: r.names, host: HOST7, linked: [] })
      const claves7 = { url: 'https://' + HOST7, token: TOKEN_DE_MENTIRA }
      const t2 = performance.now()
      const vuelta = await configureMcp(client, { host: HOST7, jira: claves7, dataCenter: true, saved: { ...registro7, ...desmarcados[0].patch }, config: await client.config() })
      const msVuelta = vuelta.ok ? await esperarEstado(client, NOMBRE, 'connected') : -1
      const msVueltaTotal = Math.round(performance.now() - t2)
      apunta(
        '7 quitar con el módulo real: un solo PATCH, disabled y sin claves en disco; volver a guardar reutiliza el esqueleto',
        rehabilitar.ok &&
          conectadaAntes >= 0 &&
          bienElegidas &&
          r.ok &&
          peticiones === 1 &&
          msDisabled >= 0 &&
          msEspacios >= 0 &&
          limpias &&
          !tokenEnEntradas &&
          !tokenEnFichero &&
          efectiva.ok &&
          adoptada === null &&
          desmarcados.length === 1 &&
          vuelta.ok &&
          vuelta.name === NOMBRE &&
          vuelta.reuse === true &&
          msVuelta >= 0,
        msPatch,
        `candidatas: propias=${nombresDe(cands.propias).join(',') || '(ninguna)'} ajenas=${nombresDe(cands.ajenas).join(',')} (las dos ajenas: el juguete no lleva el command de Faro; marcadas) · restos=${[...cands.propias, ...cands.ajenas].some((c) => c.restos)} · peticiones PATCH=${peticiones} · disabled a los ${msDisabled} ms (faro-espacios ${msEspacios} ms) · enabled false y las diez vacías en las dos=${limpias} · token en esas entradas=${tokenEnEntradas} · en el fichero=${tokenEnFichero} · scrubEffective ok=${efectiva.ok} · mcpForHost tras quitar=${adoptada ? adoptada.name : 'null'} · registro desmarcado con mcpName=${desmarcados[0] ? ('mcpName' in desmarcados[0].patch ? '(borrado)' : 'conservado') : '(sin registro)'} · volver a guardar: ${vuelta.name} reuse=${vuelta.reuse} connected a los ${msVuelta} ms (${msVueltaTotal} ms en total)`
      )
    }

    // 8. (H19) Deshabilitada A MANO con sus URL → no se adopta → guardar las claves la reutiliza y conecta.
    // Otro host a propósito: tras el caso 7 la entrada de NOMBRE vuelve a estar habilitada con el dominio
    // de los demás casos, y con ése mcpForHost la adoptaría y configureMcp la reutilizaría a ELLA.
    {
      const HOST8 = 'jira-caso8.ejemplo.invalid'
      const NOMBRE8 = mcpNameForHost(HOST8)
      const claves8 = { url: 'https://' + HOST8, token: TOKEN_DE_MENTIRA }
      const fichero = ficheroConfig()
      const cfg = leerConfig(fichero)
      cfg.mcp = cfg.mcp || {}
      cfg.mcp[NOMBRE8] = { type: 'local', command: ['node', JUGUETE], enabled: false, environment: buildMcpConfig({ jira: claves8, dataCenter: true }).environment }
      writeFileSync(fichero, JSON.stringify(cfg, null, 4))
      const recarga = await client.reloadGlobalConfig()
      const msDisabled = recarga.ok ? await esperarEstado(client, NOMBRE8, 'disabled') : -1
      const configAntes = await client.config().catch(() => null)
      const adoptada = mcpForHost(configAntes, HOST8)
      const t = performance.now()
      const r = await configureMcp(client, { host: HOST8, jira: claves8, dataCenter: true, saved: null, config: configAntes })
      const ms = r.ok ? await esperarEstado(client, NOMBRE8, 'connected') : -1
      const cfgDespues = leerConfig(ficheroConfig())
      const enDisco = cfgDespues?.mcp?.[NOMBRE8]?.enabled === true
      apunta(
        '8 deshabilitada a mano con sus URL: no se adopta, y guardar las claves la reutiliza y conecta',
        recarga.ok && msDisabled >= 0 && configAntes !== null && adoptada === null && r.ok && r.name === NOMBRE8 && r.reuse === true && ms >= 0 && enDisco,
        ms,
        `disabled tras recargar a los ${msDisabled} ms · mcpForHost antes=${adoptada ? adoptada.name : 'null'} · configureMcp ${r.status} ${r.name} reuse=${r.reuse} en ${Math.round(performance.now() - t)} ms en total · en disco enabled=${cfgDespues?.mcp?.[NOMBRE8]?.enabled}`
      )
    }

    const fallos = resultados.filter((r) => !r.ok).length
    imprime('')
    imprime(`${resultados.length - fallos}/${resultados.length} casos en verde${fallos ? ` · ${fallos} en rojo` : ''}`)
    return fallos || !salidaLimpia ? 1 : 0
  } catch (err) {
    // El mensaje de un error del cliente nunca lleva cuerpos; aun así pasa por `imprime`.
    imprime('ERROR: ' + (err?.message || String(err)))
    return 1
  } finally {
    process.removeListener('SIGINT', alInterrumpir)
    await limpiar()
  }
}

// Sólo se ejecuta como script: importarlo (sandbox-wiring.test.js no lo hace, lo lee como texto) no arranca nada.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (codigo) => process.exit(codigo),
    (err) => {
      imprime('ERROR: ' + (err?.message || String(err)))
      process.exit(1)
    }
  )
}
