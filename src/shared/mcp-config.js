/**
 * La ÚNICA barrera de lo que Faro puede escribir en la configuración de
 * opencode (H18, docs/PLAN2.md §3.2 y §8.24). Pura: sin DOM, sin `chrome`,
 * sin `fetch`. La importan el cliente (`updateMcpEntries`, que construye aquí
 * el cuerpo del PATCH) y `setup.js` (`mcpWritePatch`, para saber ANTES de
 * escribir si la entrada vale); la barrera se pone UNA vez (§9) y los dos
 * pasan por las mismas funciones.
 *
 * Por qué hace falta y por qué es tan estrecha. Desde H18 Faro escribe con
 * `PATCH /global/config` en el fichero de configuración global de opencode,
 * que es el mismo fichero donde viven `agent`, `permission`, `plugin` y
 * `command`: una puerta que aceptara cualquier parche sería ejecución de
 * código en la máquina del usuario (un `command` que opencode lanza, un
 * `plugin` que carga, un `permission` que abre `bash`). Por eso no existe
 * ningún `updateGlobalConfig(patch)` genérico: el cuerpo sólo puede llevar la
 * clave `mcp`, cada entrada tiene exactamente las cinco claves de un MCP
 * local, su `command` sale de una lista blanca (o es byte a byte el que el
 * propio usuario ya tiene escrito para ESE nombre) y su `environment` lleva
 * exactamente las diez variables que Faro sabe escribir.
 *
 * Y por qué toda escritura de prueba va a un opencode aislado: el 2026-09-25
 * se comprobó que `OPENCODE_CONFIG_DIR` NO redirige la configuración global en
 * opencode 1.2.25, y una sonda que lo daba por hecho escribió en el fichero
 * REAL de Marco. Desde entonces se redirige el HOME entero y se mira
 * `GET /path` antes de escribir (tools/config-sandbox.mjs).
 */

import { MCP_ATLASSIAN_VERSION } from './config.js'

/** Las claves de una entrada MCP local, exactas y en el orden en que se escriben. */
export const MCP_ENTRY_KEYS = Object.freeze(['command', 'enabled', 'environment', 'timeout', 'type'])

/**
 * Las variables que Faro sabe escribir, TODAS presentes siempre ('' en las que
 * no se usan). La fusión profunda de `PATCH /global/config` no quita claves:
 * escribir sólo las de ahora dejaría, tras un cambio de Cloud a Data Center,
 * el `JIRA_USERNAME`/`JIRA_API_TOKEN` viejos en el fichero. mcp-atlassian
 * trata una variable vacía como ausente (leído en su código, anexo 2-A).
 */
export const MCP_ENV_KEYS = Object.freeze([
  'JIRA_URL',
  'JIRA_PERSONAL_TOKEN',
  'JIRA_USERNAME',
  'JIRA_API_TOKEN',
  'CONFLUENCE_URL',
  'CONFLUENCE_PERSONAL_TOKEN',
  'CONFLUENCE_USERNAME',
  'CONFLUENCE_API_TOKEN',
  'READ_ONLY_MODE',
  'TOOLSETS',
])

/**
 * La ruta absoluta de `uvx.exe` que se admite en un `command`: una unidad, sin
 * `&`, `|`, `<`, `>`, `^`, `"` ni `%`, porque si opencode lanza el proceso por
 * `cmd.exe` en Windows cualquiera de ellos inyectaría (INFERIDO del texto del
 * stderr, no leído en su código: el sandbox prueba también una ruta con
 * espacios, que sí vale). `validMcpCommand` además rechaza «..» y cualquier
 * carácter de control.
 */
export const UVX_ABS_PATH = /^[A-Za-z]:\\[^&|<>^"%]+\\uvx\.exe$/

/** Lo más largo que se admite en un valor del `environment` (una URL o un token). */
const VALOR_MAX = 4096

/** El plazo de arranque que se admite, en ms. */
const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 600000

/**
 * Lo que no puede ir en un valor que se escribe en la configuración: los
 * controles C0 y C1, DEL, los separadores de línea U+2028/U+2029 y los
 * invisibles de formato (bidi, ancho cero, BOM). Se construye con escapes en
 * tiempo de ejecución, no con los caracteres escritos en el fuente.
 */
const PROHIBIDO = (() => {
  const esc = (n) => '\\u' + n.toString(16).padStart(4, '0')
  const rangos = [
    [0x0000, 0x001f],
    [0x007f, 0x009f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
  ]
  return new RegExp('[' + rangos.map(([a, b]) => esc(a) + '-' + esc(b)).join('') + ']')
})()

/** Un objeto plano (no una lista, no null). */
function plano(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/** Una cadena de una línea, sin controles ni invisibles y con tope. */
function cadenaLimpia(v, max = VALOR_MAX) {
  return typeof v === 'string' && v.length <= max && !PROHIBIDO.test(v)
}

/**
 * La ruta de uvx.exe, además de casar con `UVX_ABS_PATH`: sin «..» ni «.» ni
 * controles. Se parte por LOS DOS separadores, porque Windows acepta también
 * «/» dentro de una ruta y `UVX_ABS_PATH` lo deja pasar en el medio: partida
 * sólo por «\», «C:\a/../../Windows\uvx.exe» salía con un trozo «a/..» que no
 * era «..» (revisión adversaria de H18).
 */
function rutaUvx(ruta) {
  if (!cadenaLimpia(ruta, 1024) || !UVX_ABS_PATH.test(ruta)) return false
  return !ruta.split(/[\\/]/).some((trozo) => trozo === '..' || trozo === '.')
}

/** El segundo elemento de un `command` de lista blanca: el paquete, con la versión fijada o sin ella. */
function paqueteAtlassian(arg) {
  return arg === 'mcp-atlassian' || arg === 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION
}

/** Una lista de cadenas limpias, no vacía y con tope: lo mínimo para ser un `command`. */
function listaDeCadenas(cmd) {
  return Array.isArray(cmd) && cmd.length > 0 && cmd.length <= 64 && cmd.every((a) => cadenaLimpia(a) && a !== '')
}

/**
 * ¿Puede Faro escribir este `command`? Sólo si es `['uvx', 'mcp-atlassian']`,
 * `['uvx', 'mcp-atlassian@<versión fijada>']`, la ruta absoluta validada de
 * `uvx.exe` con el mismo paquete, o byte a byte (JSON) el `command` que
 * `GET /config` ya trae para ESE nombre (`known`: lo escribió el propio
 * usuario en su fichero, así que conservarlo no es código nuevo). Pura.
 *
 * @param {unknown} command
 * @param {{known?: string[]|null}} [opts]
 */
export function validMcpCommand(command, { known = null } = {}) {
  if (!listaDeCadenas(command)) return false
  if (Array.isArray(known) && listaDeCadenas(known) && JSON.stringify(command) === JSON.stringify(known)) return true
  if (command.length !== 2 || !paqueteAtlassian(command[1])) return false
  return command[0] === 'uvx' || rutaUvx(command[0])
}

/**
 * El nombre de una entrada MCP: alfanumérico al empezar, después letras,
 * números, punto, guion o guion bajo, 64 como mucho. Deja fuera espacios,
 * barras, «__proto__» y cualquier cosa que no sea un nombre. Pura.
 */
export function validMcpName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

/**
 * La entrada RECONSTRUIDA con claves blancas, o null si algo no vale:
 * exactamente `MCP_ENTRY_KEYS`, `type` 'local', un `command` que pase
 * `validMcpCommand` (o, SÓLO si quien llama lo pide de forma explícita,
 * `allowCommand`), un `environment` con exactamente `MCP_ENV_KEYS` y valores
 * de una línea, `enabled` booleano y `timeout` entero entre 1000 y 600 000.
 * Una clave de más no se tira: invalida la entrada, porque quien la mandó
 * esperaba que se escribiera. Idempotente. Pura.
 *
 * `allowCommand` es la puerta de PRUEBA de tools/config-sandbox.mjs, que
 * necesita escribir `['node', <ruta del MCP de juguete>]`: el panel nunca la
 * pasa (pinado).
 *
 * @param {string} name
 * @param {object} entry
 * @param {{knownCommand?: string[]|null, allowCommand?: ((cmd: string[]) => boolean)|null}} [opts]
 */
export function validMcpEntry(name, entry, { knownCommand = null, allowCommand = null } = {}) {
  if (!validMcpName(name) || !plano(entry)) return null
  const claves = Object.keys(entry).sort()
  if (JSON.stringify(claves) !== JSON.stringify(MCP_ENTRY_KEYS)) return null
  if (entry.type !== 'local') return null

  const command = entry.command
  const porPrueba = typeof allowCommand === 'function' && listaDeCadenas(command) && allowCommand([...command]) === true
  if (!porPrueba && !validMcpCommand(command, { known: knownCommand })) return null

  const env = entry.environment
  if (!plano(env)) return null
  if (JSON.stringify(Object.keys(env).sort()) !== JSON.stringify([...MCP_ENV_KEYS].sort())) return null
  const environment = {}
  for (const k of MCP_ENV_KEYS) {
    if (!cadenaLimpia(env[k])) return null
    environment[k] = env[k]
  }

  if (typeof entry.enabled !== 'boolean') return null
  const t = entry.timeout
  if (!Number.isInteger(t) || t < TIMEOUT_MIN || t > TIMEOUT_MAX) return null

  return { type: 'local', command: [...command], environment, enabled: entry.enabled, timeout: t }
}

/**
 * El cuerpo del PATCH: `{ mcp: { nombre: entrada, … } }`, con CADA entrada
 * reconstruida por `validMcpEntry`, o null si alguna no vale o no hay ninguna.
 * Nada más que la clave `mcp` puede salir de aquí. Pura.
 *
 * @param {Record<string, object>} entradas nombre → entrada
 * @param {{known?: Record<string, string[]>|null, allowCommand?: Function|null}} [opts]
 *        `known`: nombre → el `command` que `GET /config` trae para ese nombre.
 */
export function mcpPatchBody(entradas, { known = null, allowCommand = null } = {}) {
  if (!plano(entradas)) return null
  const nombres = Object.keys(entradas)
  if (!nombres.length) return null
  const mcp = {}
  for (const nombre of nombres) {
    const conocido = plano(known) && Object.hasOwn(known, nombre) ? known[nombre] : null
    const entrada = validMcpEntry(nombre, entradas[nombre], { knownCommand: conocido, allowCommand })
    if (!entrada) return null
    mcp[nombre] = entrada
  }
  return { mcp }
}
