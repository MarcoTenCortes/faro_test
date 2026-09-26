/**
 * Configuración del servidor MCP de Atlassian dentro de opencode.
 *
 * Las claves no se guardan nunca en el navegador: van en el `environment` del
 * servidor MCP, que opencode escribe en su propia configuración en disco. La
 * extensión sólo recuerda «este host ya está configurado».
 *
 * Jira y Confluence llevan CADA UNO su dirección y su token. Antes se pedía un
 * token y se copiaba en los dos productos con la misma dirección, y eso sólo
 * es verdad en Cloud: en Server/Data Center son dos instalaciones distintas,
 * en hosts distintos, con un token personal cada una. Un solo servidor MCP
 * sirve a los dos productos; si viven en hosts distintos, el otro host queda
 * ENLAZADO a éste (`siteRecords`): comparte el MCP y, desde Jira, el contexto
 * del Confluence de su pareja.
 *
 * `buildMcpConfig`, `siteBaseUrl` y `siteRecords` son puras y están cubiertas
 * por pruebas, porque un error aquí significa mandar credenciales a donde no
 * toca, o pedirlas dos veces.
 */

import { mcpNameForHost, MCP_ATLASSIAN_VERSION } from '../shared/config.js'
import { sinInvisibles } from '../atlassian/site.js'
import { MCP_ENV_KEYS, validMcpEntry, validMcpName, validMcpCommand } from '../shared/mcp-config.js'

/** Los dos productos, en el orden en que se enseñan y se comprueban. */
export const PRODUCTS = ['jira', 'confluence']

const LABEL = { jira: 'Jira', confluence: 'Confluence' }
const PREFIX = { jira: 'JIRA', confluence: 'CONFLUENCE' }

/**
 * @typedef {{url:string, email?:string, token:string}} ProductKeys
 *
 * @param {{jira?: ProductKeys|null, confluence?: ProductKeys|null, dataCenter?: boolean}} opts
 *        Las claves de cada producto habilitado; null o ausente si no se
 *        habilita. `dataCenter` vale para los dos: token personal, sin correo.
 */
export function buildMcpConfig({ jira = null, confluence = null, dataCenter = false } = {}) {
  if (!jira && !confluence) throw new Error('Hay que habilitar al menos Jira o Confluence.')

  // Las DIEZ variables siempre, '' en las que no se usan (H18): desde que Faro
  // escribe con `PATCH /global/config`, que FUSIONA y no quita claves, escribir
  // sólo las de ahora dejaría en el fichero, tras un cambio de Cloud a Data
  // Center, el USERNAME/API_TOKEN de antes; y la barrera (`validMcpEntry`) exige
  // exactamente estas diez. mcp-atlassian trata '' como ausente (anexo 2-A).
  const environment = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, '']))
  if (jira) Object.assign(environment, productEnv('jira', jira, dataCenter))
  if (confluence) Object.assign(environment, productEnv('confluence', confluence, dataCenter))

  // Sólo lectura: Faro no necesita escribir en Jira ni en Confluence, y no
  // habilitar la escritura es la forma más simple de que no pueda.
  environment.READ_ONLY_MODE = 'true'
  // Todas las herramientas, dicho a propósito. mcp-atlassian 0.23.1 avisa al
  // arrancar de que en una versión futura su valor por defecto pasará a seis
  // grupos («core toolsets»), y eso quitaría herramientas que Faro usa sin que
  // nada fallara: el modelo, simplemente, dejaría de tenerlas. «all» es el valor
  // que su propio aviso recomienda para conservar el comportamiento de hoy
  // (leído en utils/toolsets.py de 0.23.1, H15, 2026-09-26).
  environment.TOOLSETS = 'all'

  return {
    type: 'local',
    // La versión fijada, la misma que instala tools/instalar.ps1 (docs/PLAN2.md
    // §8.4): uvx no actualiza solo, y sin fijarla cada compañero se quedaba con
    // la del día de su primer arranque. Se sube a mano, en UN sitio.
    command: ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION],
    environment,
    enabled: true,
    // Es el plazo de ARRANQUE (opencode lo usa para `client.connect`, no para
    // cada llamada): medido en H15, 8-12 s con la caché de uv caliente y 7-10 s
    // en frío con una red rápida; la primera vez uvx descarga unos 107 paquetes
    // (y Python si no lo hay), y detrás de un proxy corporativo tarda más. Con
    // 30 s el primer arranque de un compañero vencía. Pasado el plazo el proceso
    // sigue vivo (opencode no lo mata): lo que se pierde es la conexión.
    timeout: 60000,
  }
}

/** Las variables de UN producto. Cada dato que falta se dice con su nombre. */
function productEnv(product, keys, dataCenter) {
  const label = LABEL[product]
  const prefix = PREFIX[product]
  const base = siteBaseUrl(keys?.url)
  if (!base) throw new Error(`Falta la dirección de ${label} (https://…).`)
  const token = String(keys?.token || '')
  if (!token) throw new Error(`Falta el API token de ${label}.`)
  const email = String(keys?.email || '').trim()
  if (!dataCenter && !email) throw new Error(`Falta el correo de la cuenta de ${label}.`)

  const env = {}
  // En Cloud el wiki cuelga de /wiki; en Data Center está donde el usuario
  // diga (la raíz, o una ruta de contexto como /confluence o /wiki).
  env[`${prefix}_URL`] = product === 'confluence' && isCloudHost(hostOf(base)) ? base + '/wiki' : base
  if (dataCenter) env[`${prefix}_PERSONAL_TOKEN`] = token
  else {
    env[`${prefix}_USERNAME`] = email
    env[`${prefix}_API_TOKEN`] = token
  }
  return env
}

/**
 * La dirección base de un producto a partir de lo que el usuario escribe.
 *
 * Se acepta una URL cualquiera del sitio —la portada, una incidencia, una
 * página— y se queda en el sitio: en Cloud, el origen a secas (el /wiki lo
 * pone `buildMcpConfig`); en Data Center, el origen más la ruta de contexto si
 * la hay (/jira, /confluence, /wiki), quitando lo que sea claramente una ruta
 * de producto (/browse/…, /display/…, /pages/…, y el enlace corto /x/AbCd que
 * da «Compartir» en Confluence). Cadena vacía si no es una dirección http(s).
 * Pura.
 *
 * El enlace corto entró en la lista por R3 (reproducido en la auditoría del
 * 2026-09-13): con él pegado, CONFLUENCE_URL salía con «/x/AbCdEf» detrás, el
 * MCP arrancaba contra una dirección que no existe y la comprobación fallaba
 * con un 404 que hacía revisar un token que estaba bien. Límite asumido: una
 * ruta de contexto que se llame «/x» no se distingue del enlace corto (y no se
 * da: Confluence sirve sus enlaces cortos justo en /x/…, chocarían).
 */
export function siteBaseUrl(url) {
  let u
  try {
    u = new URL(String(url || '').trim())
  } catch {
    return ''
  }
  if (!/^https?:$/.test(u.protocol)) return ''
  if (isCloudHost(u.hostname)) return u.origin

  const path = u.pathname
    .replace(/\/(browse|secure|issues|projects|spaces|display|pages|label|rest|x|[a-z]+\.action)(\/.*)?$/i, '')
    .replace(/\/+$/, '')
  return u.origin + path
}

export function isCloudHost(host) {
  return /\.atlassian\.net$/i.test(String(host || ''))
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Qué recordar de cada host tras configurar el MCP.
 *
 * El MCP se registra con el nombre del host desde el que se configuró. Si el
 * otro producto vive en otro host —Jira en `jira.empresa.com`, Confluence en
 * `confluence.empresa.com`—, ese host queda enlazado: mismo `mcpName`, para
 * que al abrirlo no se vuelvan a pedir claves ni se levante un segundo MCP
 * con el mismo token, y la referencia cruzada (`jiraHost`/`confluenceHost`)
 * que es lo que permite compartir el contexto de Confluence desde Jira. En
 * Cloud los dos productos comparten host y no hay nada que enlazar. Pura.
 *
 * `verified` (H18, docs/PLAN2.md §3.2) dice si esas claves se han PROBADO con
 * un turno de verdad: true tras la verificación de `finishSetup`, false cuando
 * `checkMcp` adopta un MCP conectado que nadie ha comprobado (una recarga a
 * mitad del primer uso), y entonces el chat avisa «claves sin comprobar» hasta
 * la primera verificación buena. Leerlo es `keysUnverified`.
 *
 * @param {{host:string, product:string, mcpName:string, jiraHost?:string, confluenceHost?:string, verified?:boolean}} input
 * @returns {Array<{host:string, patch:object}>} el del host actual primero
 */
export function siteRecords({ host, product, mcpName, jiraHost = '', confluenceHost = '', verified = true }) {
  const h = String(host || '').toLowerCase()
  const j = String(jiraHost || '').toLowerCase()
  const c = String(confluenceHost || '').toLowerCase()
  const probadas = verified !== false

  const record = (target, prod) => {
    const patch = { configured: true, mcpName, product: prod, cloud: isCloudHost(target), verified: probadas }
    if (j && j !== target) patch.jiraHost = j
    if (c && c !== target) patch.confluenceHost = c
    return { host: target, patch }
  }

  const out = [record(h, product || 'unknown')]
  if (j && j !== h) out.push(record(j, 'jira'))
  if (c && c !== h && c !== j) out.push(record(c, 'confluence'))
  return out
}

/**
 * ¿Hay que avisar de que las claves de este sitio no se han comprobado? Sólo
 * con `verified: false` EXPLÍCITO (H18). Es la migración: los registros
 * guardados antes de H18 no llevan `verified` y cuentan como verificados,
 * porque nadie tiene que ver «claves sin comprobar» por actualizar Faro. Pura.
 *
 * @param {object|null} saved el registro guardado del sitio (`sites[host]`)
 */
export function keysUnverified(saved) {
  return !!saved && typeof saved === 'object' && saved.verified === false
}

/**
 * El MCP que ya existe en opencode para este dominio, si lo hay.
 *
 * Faro sólo sabía de un MCP por dos vías: el nombre que deriva del host de la
 * pestaña, o el nombre que él mismo apuntó al terminar de configurarlo. Las
 * dos fallan en cuanto el MCP se configuró desde el OTRO producto —desde Jira,
 * con las dos direcciones dentro— y la anotación no llegó a escribirse (la
 * comprobación no terminó en el panel, o el bloque se pegó a mano): al abrir
 * Confluence, Faro pedía claves para un MCP que ya estaba conectado. Pasó de
 * verdad.
 *
 * Ahora se mira lo que opencode tiene de verdad (`GET /config`): de cada MCP,
 * los hosts de `JIRA_URL` y `CONFLUENCE_URL` de su `environment`. Vale el que
 * lleve este dominio en cualquiera de las dos; con varios, el que tenga los dos
 * productos; en igualdad, el primero en el orden de la configuración.
 *
 * Y antes que nada, el que esté CONECTADO. Un bloque viejo caído —o con
 * `enabled: false`, que opencode conserva en la configuración y devuelve como
 * «disabled»— con los dos productos ganaba al recién verificado con uno, y el
 * panel volvía a la pantalla de claves en cada arranque: un bucle sin salida
 * desde el panel. Lo encontró la revisión. Por eso la elección mira la lista
 * de `GET /mcp` cuando se le da, y un MCP deshabilitado no cuenta.
 *
 * Del `environment` sólo salen los hosts. Las claves van ahí en claro y no
 * pueden acabar ni en el estado ni en el registro: el resultado son cinco
 * claves blancas. Pura, cubierta por pruebas.
 *
 * @param {object} config lo que devuelve `GET /config`
 * @param {string} host el host de la pestaña
 * @param {{status?: object|null}} [opts] lo que devuelve `GET /mcp`, si se tiene
 * @returns {{name:string, jiraHost:string, confluenceHost:string, products:number, connected:boolean}|null}
 */
export function mcpForHost(config, host, { status = null } = {}) {
  const buscado = String(host || '').trim().toLowerCase()
  const mcp = config?.mcp
  if (!buscado || !mcp || typeof mcp !== 'object') return null

  let elegido = null
  for (const [name, entry] of Object.entries(mcp)) {
    if (entry?.enabled === false) continue
    const env = entry?.environment
    if (!env || typeof env !== 'object') continue
    const jiraHost = hostOf(String(env.JIRA_URL || '')).toLowerCase()
    const confluenceHost = hostOf(String(env.CONFLUENCE_URL || '')).toLowerCase()
    if (jiraHost !== buscado && confluenceHost !== buscado) continue
    const products = (jiraHost ? 1 : 0) + (confluenceHost ? 1 : 0)
    const connected = status ? mcpStatusFor(status, host, name).connected : false
    // Conectado antes que nada; después, más productos; en igualdad, el primero.
    const mejor =
      !elegido ||
      (connected && !elegido.connected) ||
      (connected === elegido.connected && products > elegido.products)
    if (mejor) elegido = { name, jiraHost, confluenceHost, products, connected }
  }
  return elegido
}

/**
 * Con qué nombre se busca el MCP de este host en `GET /mcp`: el que opencode
 * tiene para este dominio, si lo hay; si no, el que Faro apuntó al
 * configurarlo; y si no, el que deriva del host. Pura.
 */
export function chosenMcpName(config, saved, host, { status = null } = {}) {
  return mcpForHost(config, host, { status })?.name || String(saved?.mcpName || '') || mcpNameForHost(host)
}

/** Los hosts de JIRA_URL y CONFLUENCE_URL de una entrada, en minúsculas ('' si no hay). */
function hostsDe(entry) {
  const env = entry?.environment
  if (!env || typeof env !== 'object') return { jiraHost: '', confluenceHost: '' }
  return {
    jiraHost: hostOf(String(env.JIRA_URL || '')).toLowerCase(),
    confluenceHost: hostOf(String(env.CONFLUENCE_URL || '')).toLowerCase(),
  }
}

/**
 * TODAS las entradas MCP de la configuración que llevan este dominio en
 * `JIRA_URL` o `CONFLUENCE_URL`, habilitadas Y deshabilitadas (H18), en el orden
 * de la configuración. A diferencia de `mcpForHost`, que salta las
 * deshabilitadas a propósito (es lo que evita el bucle al quitar las claves),
 * aquí hacen falta todas: para escribir hay que saber si ya hay un nombre que
 * reutilizar, y para comprobar tras escribir, que la entrada efectiva es la
 * escrita. Cada una con `{name, enabled, command, type, timeout, products}`:
 * SIN `environment` ni tokens, que van ahí en claro. Pura.
 *
 * @param {object} config lo que devuelve `GET /config`
 * @param {string} host
 */
export function mcpEntriesForHost(config, host) {
  const buscado = String(host || '').trim().toLowerCase()
  const mcp = config?.mcp
  if (!buscado || !mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return []
  const out = []
  for (const [name, entry] of Object.entries(mcp)) {
    if (!entry || typeof entry !== 'object') continue
    const { jiraHost, confluenceHost } = hostsDe(entry)
    if (jiraHost !== buscado && confluenceHost !== buscado) continue
    out.push({
      name,
      enabled: entry.enabled !== false,
      command: Array.isArray(entry.command) && entry.command.every((a) => typeof a === 'string') ? [...entry.command] : null,
      type: typeof entry.type === 'string' ? entry.type : '',
      timeout: Number.isInteger(entry.timeout) ? entry.timeout : null,
      products: (jiraHost ? 1 : 0) + (confluenceHost ? 1 : 0),
    })
  }
  return out
}

/**
 * Bajo qué nombre escribe Faro el MCP de este host, y qué conserva (H18,
 * docs/PLAN2.md §3.2). Pura.
 *
 * - Una entrada HABILITADA que ya lleve el dominio se REUTILIZA: su nombre, y
 *   se conservan su `type`, su `command` y su `timeout` (se reescriben el
 *   `environment` y `enabled`). Es la que `mcpForHost` elegiría: con dos, la de
 *   los dos productos; en igualdad, la primera.
 * - Una DESHABILITADA sólo se reutiliza si es el esqueleto de Faro (el nombre
 *   de `mcpNameForHost` o el `mcpName` guardado): una ajena que el usuario
 *   deshabilitó a mano no vuelve a arrancar con tokens frescos; se crea una
 *   nueva a su lado.
 * - Si no, una nueva bajo `saved.mcpName` (si tiene forma de nombre) o
 *   `mcpNameForHost(host)`, con el `command` estándar.
 *
 * `knownCommand` es el `command` que `GET /config` trae para ESE nombre: lo
 * escribió el usuario, y la barrera lo acepta sólo si es byte a byte ése.
 *
 * @returns {{name: string, reuse: boolean, knownCommand: string[]|null, keep: {type: string, timeout: number|null}|null}}
 */
export function chooseWriteTarget({ config = null, saved = null, host = '' } = {}) {
  const entradas = mcpEntriesForHost(config, host)
  const deFaro = mcpNameForHost(host)
  const guardado = validMcpName(saved?.mcpName) ? saved.mcpName : ''
  const conservar = (e) => ({ name: e.name, reuse: true, knownCommand: e.command, keep: { type: e.type, timeout: e.timeout } })

  const elegida = mcpForHost(config, host)
  const habilitada = elegida && entradas.find((e) => e.name === elegida.name && e.enabled)
  if (habilitada) return conservar(habilitada)

  const esqueleto = entradas.find((e) => !e.enabled && (e.name === deFaro || (guardado && e.name === guardado)))
  if (esqueleto) return conservar(esqueleto)

  return { name: guardado || deFaro, reuse: false, knownCommand: null, keep: null }
}

/**
 * La entrada que se va a escribir, ya pasada por la barrera (`validMcpEntry`),
 * o null si no vale. Con un destino reutilizado se conservan su `type`, su
 * `command` (aceptado sólo si pasa la lista blanca o es byte a byte el
 * `knownCommand`) y su `timeout`; con uno nuevo, el bloque tal cual.
 *
 * El `timeout` conservado no BAJA del del bloque: los MCP que Faro escribía
 * antes de H15 llevan 30 000 ms, que el primer arranque de un compañero
 * vencía, y conservar ése dejaría fuera la subida de H15; uno más largo que
 * haya puesto el usuario se respeta (desvío anotado del contrato de H18). Pura.
 *
 * @param {{name?: string, block: object, target: ReturnType<typeof chooseWriteTarget>}} input
 */
export function mcpWritePatch({ name = '', block = null, target = null } = {}) {
  const nombre = name || target?.name || ''
  if (!block || typeof block !== 'object') return null
  let entrada = block
  if (target?.reuse) {
    const plazo = Number.isInteger(target.keep?.timeout) ? Math.max(target.keep.timeout, block.timeout) : block.timeout
    entrada = { ...block, type: target.keep?.type, command: target.knownCommand, timeout: plazo }
  }
  return validMcpEntry(nombre, entrada, { knownCommand: target?.reuse ? target.knownCommand : null })
}

/**
 * El `command` del reintento con la ruta absoluta de uvx (H18): el MCP que Faro
 * acaba de crear falló con «Connection closed» en menos de
 * `MCP_RELOAD_LIMITS.fastFailMs`, que casi siempre es que el opencode en marcha
 * no tiene uvx en su PATH (se arrancó antes de instalar uv). El instalador
 * oficial de uv lo deja en `<home>\.local\bin\uvx.exe`; `home` sale de
 * `client.paths()` o, si no viene, del directorio de configuración subiendo
 * dos niveles (`<home>\.config\opencode`). null si el `command` no pasa la
 * barrera (`validMcpCommand`: `UVX_ABS_PATH`, sin «..»; no es Windows, lleva
 * metacaracteres…), que es la misma que lo vuelve a mirar al escribir. Faro no puede
 * comprobar que el fichero exista: con winget o pip el reintento falla igual y
 * se vuelve atrás. Pura.
 *
 * @param {{home?: string, config?: string}|null} paths
 */
export function uvxAbsoluteCommand(paths) {
  const home = typeof paths?.home === 'string' && paths.home ? paths.home : subirDos(paths?.config)
  if (!home) return null
  const ruta = home.replace(/\\+$/, '') + '\\.local\\bin\\uvx.exe'
  const command = [ruta, 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION]
  return validMcpCommand(command) ? command : null
}

/** El directorio dos niveles por encima (`C:\Users\x\.config\opencode` → `C:\Users\x`), o ''. */
function subirDos(dir) {
  if (typeof dir !== 'string' || !dir.includes('\\')) return ''
  const trozos = dir.replace(/\\+$/, '').split('\\')
  return trozos.length > 3 ? trozos.slice(0, -2).join('\\') : ''
}

/**
 * ¿Está ya configurado y conectado el MCP de este host?
 *
 * `GET /mcp` devuelve `{ "<nombre>": { "status": "connected" } }`. Cualquier
 * estado que no sea exactamente «connected» se trata como no listo: es
 * preferible esperar de más que preguntarle al modelo cuando aún no tiene
 * herramientas.
 *
 * @param {string} [mcpName] el nombre guardado para este host, si lo hay: un
 *        host enlazado usa el MCP de su pareja, no uno con su propio nombre.
 */
export function mcpStatusFor(mcpList, host, mcpName = '') {
  const name = mcpName || mcpNameForHost(host)
  const entry = mcpList?.[name]
  if (!entry) return { name, present: false, connected: false, status: null }
  const status = typeof entry === 'string' ? entry : entry.status || entry.state || null
  return { name, present: true, connected: status === 'connected', status, raw: entry }
}

/**
 * Espera a que el MCP aparezca conectado.
 *
 * Hace falta de verdad: `mcp-atlassian` tarda unos diez segundos en arrancar
 * y exponer sus herramientas. Preguntarle al modelo antes de eso hace que
 * responda sin usar el MCP, y desde fuera parece que las claves no valen.
 */
export async function waitForMcpReady(client, host, { timeoutMs = 90000, intervalMs = 1500, onTick, signal, mcpName = '' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  for (;;) {
    if (signal?.aborted) return { ...last, connected: false, aborted: true }
    const list = await client.listMcp().catch(() => ({}))
    last = mcpStatusFor(list, host, mcpName)
    if (last.connected) return last
    onTick?.(last, Math.max(0, deadline - Date.now()))
    if (Date.now() >= deadline) return last
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/**
 * Escribe el MCP de Atlassian de este host en la configuración de opencode
 * (H18, docs/PLAN2.md §3.2), y NO espera: esperar a que aparezca y conecte es
 * del panel, que es quien pinta la espera.
 *
 * Construye el bloque (`buildMcpConfig`), decide bajo qué nombre y qué se
 * conserva (`chooseWriteTarget`, con la configuración que se le dé o, si no,
 * la que lee él con `client.config()`), lo pasa por la barrera
 * (`mcpWritePatch`) y lo escribe con `client.updateMcpEntries` —el
 * `PATCH /global/config`, que en opencode 1.2.25 escribe el fichero global Y
 * recarga los MCP sin reiniciar (anexo 2-A)—. `command` sustituye al estándar
 * en una entrada NUEVA (el reintento con la ruta absoluta de uvx); en una
 * reutilizada no se toca el suyo.
 *
 * Ya no llama a `addMcp` ni a `connectMcp`: `POST /mcp` no «no hace nada»,
 * como decía este comentario, sino que arranca el MCP SÓLO en memoria —sus
 * herramientas llegan al modelo, pero `GET /mcp` no lo ve, no se escribe nada
 * y muere con la primera recarga—, así que no deja nada configurado.
 *
 * Devuelve `{ok, status, kind, name, block, reuse}`: `block` es la entrada tal
 * como se ha escrito (o, si la barrera no la dejó pasar, el bloque construido,
 * para el respaldo manual) y `kind` el de `updateMcpEntries` ('entrada',
 * 'red', 'ConfigJsonError', 'ConfigInvalidError'…). Los errores de las claves
 * que faltan salen de `buildMcpConfig`, como siempre, antes de escribir nada.
 */
export async function configureMcp(client, { host, jira, confluence, dataCenter, saved = null, config, command = null } = {}) {
  const construido = buildMcpConfig({ jira, confluence, dataCenter })
  const cargada = config === undefined ? await client.config().catch(() => null) : config
  const target = chooseWriteTarget({ config: cargada, saved, host })
  // En una entrada reutilizada `mcpWritePatch` conserva el command suyo: el del
  // reintento sólo llega a escribirse en una nueva.
  const block = Array.isArray(command) ? { ...construido, command: [...command] } : construido
  const entrada = mcpWritePatch({ name: target.name, block, target })
  if (!entrada) return { ok: false, status: 0, kind: 'entrada', name: target.name, block: construido, reuse: target.reuse }

  const known = target.reuse && target.knownCommand ? { [target.name]: target.knownCommand } : null
  const r = await client.updateMcpEntries({ [target.name]: entrada }, { known })
  return { ok: !!r?.ok, status: r?.status ?? 0, kind: r?.kind ?? '', name: target.name, block: entrada, reuse: target.reuse }
}

/**
 * Lo que abre línea o separa, para dejar el error de opencode en UNA línea:
 * `\s` de JavaScript cubre el salto, el retorno, U+2028 y U+2029, pero NO el NEL
 * (U+0085), que va nombrado aparte y CON ESCAPE, como `ESPACIOS` en site.js y
 * `SALTOS` en prompts.js.
 */
const ESPACIOS_DEL_ERROR = new RegExp('[\\s\\u0085]+', 'g')

/** Cuánto del error de opencode entra en el consejo. */
const ERROR_MAX = 200

/** El comando que se ofrece para copiar cuando el MCP no llega ni a arrancar. */
const INSTALAR = 'powershell -ExecutionPolicy Bypass -File tools\\instalar.ps1'

/**
 * Qué decirle a quien tiene el MCP de Atlassian en «failed», o null.
 *
 * Pasó de verdad (H15, docs/PLAN2.md §3.1): un compañero se quedó quince
 * minutos mirando «El MCP está en «failed»…» en el paso manual sin ninguna pista
 * de por qué. opencode 1.2.25 guarda el motivo en el `error` de `GET /mcp`, y los
 * dos que se ven de verdad están medidos (anexo-2-B): «MCP error -32000:
 * Connection closed» —el proceso se cerró nada más empezar, que en Windows es
 * casi siempre que no encuentra `uvx`— y «Operation timed out after 30000ms» —el
 * plazo de ARRANQUE venció, típico de la primera vez, en la que uvx descarga
 * unos 107 paquetes—. Faro NO puede leer el stderr de opencode, así que el texto
 * dice «casi siempre» y manda a mirar la terminal en vez de afirmar la causa.
 *
 * Recibe lo que devuelve `mcpStatusFor`. Sólo un «failed» trae consejo:
 * conectado, ausente, deshabilitado o cualquier cosa que no tenga esa forma →
 * null, sin lanzar. El error de opencode entra en el texto en UNA línea, sin
 * invisibles (el mismo `sinInvisibles` de site.js: una sola lista de caracteres
 * prohibidos) y acotado a `ERROR_MAX`, porque es texto de un proceso ajeno que
 * se pinta en la pantalla de claves y en el chat. Pura, con pruebas.
 *
 * @param {{present?: boolean, status?: string|null, raw?: object|string}} status
 * @returns {{kind: 'sin-arranque'|'lento'|'otro', text: string, retry: boolean, copy: string}|null}
 */
export function mcpFailureHint(status) {
  if (!status || typeof status !== 'object' || !status.present || status.status !== 'failed') return null
  const bruto = typeof status.raw?.error === 'string' ? status.raw.error : ''
  const error = sinInvisibles(bruto).replace(ESPACIOS_DEL_ERROR, ' ').trim().slice(0, ERROR_MAX).trim()

  if (/Connection closed/i.test(error)) {
    return {
      kind: 'sin-arranque',
      text:
        'opencode no ha podido arrancar el MCP de Atlassian: el proceso se cerró nada más empezar. ' +
        'Casi siempre es que no encuentra uvx. Ejecuta tools\\instalar.ps1 desde la carpeta de Faro (o instala uv) ' +
        'y reinicia opencode desde una terminal NUEVA; en la ventana de opencode verás «"uvx" no se reconoce…» si es eso.',
      retry: true,
      copy: INSTALAR,
    }
  }

  const plazo = /timed out after (\d+)\s*ms/i.exec(error)
  if (plazo) {
    const segundos = Math.max(1, Math.round(Number(plazo[1]) / 1000)) // «más de 0 s» con 400 ms (revisión de H15)
    return {
      kind: 'lento',
      text:
        `Ha tardado más de ${segundos} s en arrancar. La primera vez uvx descarga unos 107 paquetes ` +
        '(y Python si no lo tienes) y siguen bajando en segundo plano: pulsa Reintentar en unos segundos.',
      retry: true,
      copy: '',
    }
  }

  return {
    kind: 'otro',
    text: error
      ? `opencode dice que el MCP ha fallado: «${error}». Mira su terminal para ver el detalle.`
      : 'opencode dice que el MCP ha fallado, sin más detalle: mira su terminal.',
    retry: true,
    copy: '',
  }
}

/** Los nombres del fichero global de opencode, en el orden en que los busca. */
const FICHEROS_DE_CONFIG = Object.freeze(['opencode.jsonc', 'opencode.json', 'config.json'])

/**
 * En qué fichero escribe opencode su configuración global, a partir del
 * listado del directorio (H18): opencode 1.2.25 escribe en el PRIMERO que
 * exista de `opencode.jsonc`, `opencode.json` y `config.json`, y si no existe
 * ninguno CREA `opencode.jsonc` (medido, anexo 2-A). Devuelve los que existen,
 * en ese orden —el primero es donde escribe—, o `['opencode.jsonc']`. Pura.
 *
 * Es para quien SÍ puede listar el directorio (tools/config-sandbox.mjs y las
 * pruebas): el panel no puede, opencode no tiene ningún endpoint para eso, así
 * que el panel enseña el directorio de `client.paths().config` y dice
 * «opencode.jsonc si ya existe, si no opencode.json».
 *
 * @param {string[]} listado los nombres de fichero del directorio
 */
export function configFileCandidates(listado) {
  const hay = new Set(Array.isArray(listado) ? listado.filter((n) => typeof n === 'string') : [])
  const existen = FICHEROS_DE_CONFIG.filter((n) => hay.has(n))
  return existen.length ? existen : ['opencode.jsonc']
}

/**
 * Ruta del fichero de configuración global de opencode para el paso MANUAL.
 * Dice `opencode.json` a propósito, aunque opencode, sin ningún fichero, cree
 * `opencode.jsonc` (ver `configFileCandidates`): es el nombre por defecto que
 * alguien que pega el bloque a mano crea o ya tiene, y opencode lo lee igual.
 */
export function configFilePath(paths) {
  const dir = paths?.config || ''
  if (!dir) return 'opencode.json'
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + 'opencode.json'
}

/** El bloque que hay que añadir a un `opencode.json` que ya existe. */
export function mcpBlockSnippet(name, config) {
  return JSON.stringify({ [name]: config }, null, 2)
}

/** Fichero completo, para cuando `opencode.json` todavía no existe. */
export function fullConfigSnippet(name, config) {
  return JSON.stringify(
    { $schema: 'https://opencode.ai/config.json', mcp: { [name]: config } },
    null,
    2
  )
}

/**
 * Prueba real contra la API de UN producto, para no dar por bueno un token
 * que no vale. Con los dos habilitados se llama dos veces: son dos tokens.
 *
 * En Jira se busca una incidencia cualquiera con JQL (`jira_search`, límite
 * 1): es la misma herramienta que usa la Skill de búsqueda, y no necesita
 * saber ningún proyecto. La de perfil de usuario pide un identificador que
 * aquí no se conoce.
 */
export async function verifyCredentials(client, { sessionID, model, host, product, signal = undefined }) {
  const jira = product === 'jira'
  const tool = jira ? 'jira_search' : 'confluence_search'
  const ask = jira
    ? 'Usa la herramienta de búsqueda de Jira del MCP de Atlassian con el JQL «order by created DESC» y límite 1, para comprobar que las claves valen. Responde SOLO con: OK <clave de la incidencia encontrada> o ERROR <motivo breve>.'
    : 'Usa el MCP de Atlassian para buscar en Confluence una sola página cualquiera (límite 1). Responde SOLO con: OK <título encontrado> o ERROR <motivo breve>.'

  // Por `runTurn` y no por `prompt`: opencode reparte el turno en varios
  // mensajes, y la llamada a la herramienta —justo lo que hay que comprobar—
  // se queda en uno que la respuesta del POST no devuelve.
  const turn = await client.runTurn(
    sessionID,
    {
      text: ask,
      model,
      system: `Estás comprobando las credenciales de ${LABEL[product] || 'Atlassian'} del sitio ${host}. Usa la herramienta ${tool} si existe. No inventes nada.`,
    },
    { stallMs: 60000, maxMs: 180000, signal }
  )

  // Cancelada no es del modelo (revisión adversaria de H16): si a mitad de la
  // comprobación el panel cambia de sitio, `buildClient` desconecta el cliente
  // y el turno se quedaba sin eventos hasta que el vigilante daba `stalled` a
  // los 60 s, que se apuntaba como un veredicto «mudo» FALSO de un día a un
  // modelo que funciona. Quien llama pasa su `signal` y el turno vuelve
  // `aborted`. Va ANTES de mirar `stalled`: si el vigilante y la señal
  // coinciden, manda cancelar. Cierra además lo anotado desde H2: con un
  // cliente cerrado (`closed: true`) esto caía en «sin herramientas».
  if (turn.aborted) {
    return { ok: false, reason: 'cancelado', detail: 'la comprobación se canceló antes de terminar' }
  }

  // Un fallo del MODELO no dice nada de las claves (H16, docs/PLAN2.md §3.3):
  // el turno no llegó a usar el MCP. Se devuelve con el error crudo del
  // proveedor y si fue por callarse, para que quien llama lo clasifique
  // (`classifyModelFailure`), apunte el veredicto y NO culpe a las claves. Pasó
  // de verdad: con un modelo que el plan no permitía, el panel decía «Jira:
  // <error del modelo>» como si el token estuviera mal.
  if (turn.stalled) {
    return {
      ok: false,
      reason: 'modelo',
      detail: 'el modelo se quedó colgado. Prueba con otro.',
      rawError: turn.rawError || null,
      stalled: true,
    }
  }
  if (turn.error) {
    return { ok: false, reason: 'modelo', detail: turn.error, rawError: turn.rawError || null, stalled: false }
  }

  return readVerification(turn.parts)
}

/**
 * Interpreta la respuesta de la comprobación.
 *
 * Distinguir el motivo importa: decir «las claves no funcionan» cuando lo que
 * pasa es que el MCP no estaba levantado manda al usuario a revisar un token
 * que está perfectamente bien. Pura, y con pruebas.
 */
export function readVerification(parts) {
  const list = parts || []
  const text = list
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join(' ')
    .trim()

  const tools = list.filter((p) => p.type === 'tool')

  // Un «OK» sin llamada a herramienta no prueba nada: el modelo puede decir
  // que todo va bien sin haber tocado el MCP, y entonces damos por buenas unas
  // claves que nunca se han usado. Se exige la llamada.
  if (/^OK\b/i.test(text) && tools.length) {
    return { ok: true, detail: text.replace(/^OK\s*/i, '').trim() }
  }

  if (!tools.length) {
    return {
      ok: false,
      reason: 'sin-herramientas',
      detail:
        'el modelo no tenía ninguna herramienta del MCP disponible. Casi siempre significa que opencode todavía no ha cargado el servidor MCP.',
    }
  }

  const failed = tools.find((t) => t.state?.status === 'error' || t.state?.error)
  if (failed) {
    const raw = String(failed.state?.error || failed.state?.output || '').slice(0, 240)
    if (/401|403|unauthor|forbidden|invalid token|authentication/i.test(raw)) {
      return { ok: false, reason: 'credenciales', detail: 'Atlassian rechazó el token: ' + raw }
    }
    return { ok: false, reason: 'herramienta', detail: 'la herramienta falló: ' + raw }
  }

  return { ok: false, reason: 'respuesta', detail: text || 'el modelo respondió sin decir OK.' }
}
