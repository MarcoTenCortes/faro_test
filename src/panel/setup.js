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

  const environment = {}
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
 * @param {{host:string, product:string, mcpName:string, jiraHost?:string, confluenceHost?:string}} input
 * @returns {Array<{host:string, patch:object}>} el del host actual primero
 */
export function siteRecords({ host, product, mcpName, jiraHost = '', confluenceHost = '' }) {
  const h = String(host || '').toLowerCase()
  const j = String(jiraHost || '').toLowerCase()
  const c = String(confluenceHost || '').toLowerCase()

  const record = (target, prod) => {
    const patch = { configured: true, mcpName, product: prod, cloud: isCloudHost(target) }
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
 * Intenta registrar el MCP en caliente.
 *
 * Ojo: en opencode 1.2.25 `POST /mcp` responde 200 pero no tiene ningún
 * efecto — ni escribe configuración, ni expone herramientas, ni aparece en
 * `GET /mcp`. Se sigue intentando por si una versión futura lo implementa,
 * pero el camino que funciona de verdad es escribir el bloque `mcp` en
 * `opencode.json` y reiniciar el servidor. Por eso esto devuelve `ready`
 * en vez de dar por hecho que quedó configurado.
 */
export async function configureMcp(client, { host, jira, confluence, dataCenter }) {
  const name = mcpNameForHost(host)
  const config = buildMcpConfig({ jira, confluence, dataCenter })

  await client.addMcp(name, config).catch(() => {})
  await client.connectMcp(name).catch(() => {})

  // Margen corto: si el registro en caliente funcionase, se notaría enseguida.
  const status = await waitForMcpReady(client, host, { timeoutMs: 8000, intervalMs: 1000 })
  return { name, config, status, ready: status.connected }
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

/** Ruta del fichero de configuración global de opencode. */
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
