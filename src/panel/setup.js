/**
 * Configuración del servidor MCP de Atlassian dentro de opencode.
 *
 * Las claves no se guardan nunca en el navegador: van en el `environment` del
 * servidor MCP, que opencode escribe en su propia configuración en disco. La
 * extensión sólo recuerda «este host ya está configurado».
 *
 * `buildMcpConfig` es pura y está cubierta por pruebas, porque un error aquí
 * significa mandar credenciales a donde no toca.
 */

import { mcpNameForHost } from '../shared/config.js'

/**
 * @param {{origin:string, email:string, token:string, jira:boolean,
 *          confluence:boolean, dataCenter:boolean}} opts
 */
export function buildMcpConfig({ origin, email, token, jira = true, confluence = true, dataCenter = false }) {
  const base = String(origin || '').replace(/\/+$/, '')
  if (!base) throw new Error('Falta la dirección del sitio.')
  if (!token) throw new Error('Falta el API token.')
  if (!dataCenter && !email) throw new Error('Falta el correo de la cuenta.')
  if (!jira && !confluence) throw new Error('Hay que habilitar al menos Jira o Confluence.')

  const cloud = /\.atlassian\.net$/i.test(hostOf(base))
  const environment = {}

  if (jira) {
    environment.JIRA_URL = base
    if (dataCenter) environment.JIRA_PERSONAL_TOKEN = token
    else {
      environment.JIRA_USERNAME = email
      environment.JIRA_API_TOKEN = token
    }
  }

  if (confluence) {
    // En Cloud el wiki cuelga de /wiki; en Data Center está en la raíz.
    environment.CONFLUENCE_URL = cloud ? base + '/wiki' : base
    if (dataCenter) environment.CONFLUENCE_PERSONAL_TOKEN = token
    else {
      environment.CONFLUENCE_USERNAME = email
      environment.CONFLUENCE_API_TOKEN = token
    }
  }

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

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * ¿Está ya configurado y conectado el MCP de este host?
 *
 * `GET /mcp` devuelve `{ "<nombre>": { "status": "connected" } }`. Cualquier
 * estado que no sea exactamente «connected» se trata como no listo: es
 * preferible esperar de más que preguntarle al modelo cuando aún no tiene
 * herramientas.
 */
export function mcpStatusFor(mcpList, host) {
  const name = mcpNameForHost(host)
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
export async function waitForMcpReady(client, host, { timeoutMs = 90000, intervalMs = 1500, onTick, signal } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  for (;;) {
    if (signal?.aborted) return { ...last, connected: false, aborted: true }
    const list = await client.listMcp().catch(() => ({}))
    last = mcpStatusFor(list, host)
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
export async function configureMcp(client, { host, origin, email, token, jira, confluence, dataCenter }) {
  const name = mcpNameForHost(host)
  const config = buildMcpConfig({ origin, email, token, jira, confluence, dataCenter })

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

/** Prueba real contra la API, para no dar por bueno un token que no vale. */
export async function verifyCredentials(client, { sessionID, model, host, jira, confluence }) {
  const tool = jira ? 'jira_get_user_profile' : 'confluence_search'
  const ask = jira
    ? 'Usa la herramienta del MCP de Atlassian para leer mi propio perfil de Jira. Responde SOLO con: OK <mi nombre> o ERROR <motivo breve>.'
    : 'Usa el MCP de Atlassian para buscar en Confluence una sola página cualquiera (límite 1). Responde SOLO con: OK <título encontrado> o ERROR <motivo breve>.'

  // Por `runTurn` y no por `prompt`: opencode reparte el turno en varios
  // mensajes, y la llamada a la herramienta —justo lo que hay que comprobar—
  // se queda en uno que la respuesta del POST no devuelve.
  const turn = await client.runTurn(
    sessionID,
    {
      text: ask,
      model,
      system: `Estás comprobando credenciales del sitio ${host}. Usa la herramienta ${tool} si existe. No inventes nada.`,
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
