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

import { mcpNameForHost } from '../shared/config.js'

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

  return {
    type: 'local',
    command: ['uvx', 'mcp-atlassian'],
    environment,
    enabled: true,
    timeout: 30000,
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
 * de producto (/browse/…, /display/…, /pages/…). Cadena vacía si no es una
 * dirección http(s). Pura.
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
    .replace(/\/(browse|secure|issues|projects|spaces|display|pages|label|rest|[a-z]+\.action)(\/.*)?$/i, '')
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
export async function verifyCredentials(client, { sessionID, model, host, product }) {
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
    { stallMs: 60000, maxMs: 180000 }
  )

  if (turn.stalled) {
    return { ok: false, reason: 'modelo', detail: 'el modelo se quedó colgado. Prueba con otro.' }
  }
  if (turn.error) return { ok: false, reason: 'modelo', detail: turn.error }

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
