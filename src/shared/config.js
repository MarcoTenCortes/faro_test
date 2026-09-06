/** Constantes y valores por defecto. Sin dependencias del navegador. */

export const EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'
export const CORS_ORIGIN = `chrome-extension://${EXTENSION_ID}`

export const DEFAULT_SERVER = 'http://127.0.0.1:4096'

/** Nombre del servidor MCP en opencode para un host dado. */
export function mcpNameForHost(host) {
  return 'atlassian-' + String(host).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

/** Carpeta de trabajo (cwd de opencode) para un host dado. */
export function workspaceForHost(host, home) {
  const safe = String(host).replace(/[^a-zA-Z0-9.-]+/g, '_')
  const sep = home && home.includes('\\') ? '\\' : '/'
  return [home, '.faro', safe].join(sep)
}

export const FILES = {
  agents: 'AGENTS.md',
  context: 'CONTEXT.md',
  index: 'context.index.json',
  memory: 'MEMORY.md',
}

/**
 * Estilos de resaltado.
 *
 * `spotlight` es el de siempre: oscurece la página menos el hueco del objetivo.
 * `marker` no oscurece nada — subraya el texto en amarillo y rodea las imágenes
 * con un filete muy fino. Para quien quiere seguir viendo la página entera.
 */
export const HIGHLIGHT_STYLES = ['spotlight', 'marker']

/**
 * Cómo lleva Faro al usuario a un sitio.
 *
 * `guided`: intenta siempre enseñar el camino. Lee de quién cuelga el destino
 * y ofrece «Paso a paso» destacado; si no conoce el camino, lleva de golpe.
 * `quick`: lleva directamente, siempre. No se lee el árbol ni se espera nada.
 */
export const NAV_MODES = ['guided', 'quick']

export const DEFAULT_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: '',
  crossSessionMemory: false,
  navMode: 'guided',
  stepDelayMs: 1600,
  reduceMotion: false,
  highlightStyle: 'spotlight',
}

/**
 * Ajustes guardados por una versión anterior, en la forma actual. Pura.
 *
 * Hasta ahora había una casilla, `assistedByDefault`: marcada, la tarjeta
 * destacaba «Paso a paso»; sin marcar, «Llévame», pero seguía ofreciendo las
 * dos. Quien la desmarcó quería menos recorrido, así que pasa al modo rápido;
 * el resto se queda en el guiado, que era y sigue siendo el de por defecto.
 */
export function migrateSettings(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!NAV_MODES.includes(s.navMode)) {
    s.navMode = s.assistedByDefault === false ? 'quick' : DEFAULT_SETTINGS.navMode
  }
  delete s.assistedByDefault
  return s
}

/** Topes del indexador: evitan que «indexar Confluence» se vuelva infinito. */
export const INDEX_LIMITS = {
  maxPages: 300,
  maxDepth: 4,
  maxIssues: 120,
  timeoutMs: 10 * 60 * 1000,
}

/** Tiempos de la navegación asistida. */
export const NAV_TIMING = {
  locateTimeoutMs: 2500,
  settleQuietMs: 220,
  settleMaxMs: 6000,
  stepPauseMs: 1600,
  highlightHoldMs: 5000,
}

export const STORAGE_KEYS = {
  settings: 'faro:settings',
  sites: 'faro:sites',
  index: (host) => `faro:index:${host}`,
  session: (host) => `faro:session:${host}`,
  context: (host) => `faro:context:${host}`,
  memory: (host) => `faro:memory:${host}`,
}

/**
 * Permisos con los que Faro abre TODAS sus sesiones de opencode.
 *
 * Sin esto, el agente por defecto de opencode trae herramientas de shell y de
 * ficheros, y las usa: comprobado, ejecutaba `echo hola` y leia package.json
 * dentro de un turno normal de chat. Faro no necesita nada de eso —solo las
 * herramientas MCP de Atlassian— y dejarlo abierto significaria que un texto
 * escondido en una pagina de Confluence podria acabar ejecutando ordenes en la
 * maquina del usuario.
 *
 * Comprobado contra opencode 1.2.25: el `permission` de la sesion se respeta.
 * El campo `tools` del mensaje (marcado como obsoleto) tambien: lo convierte
 * en reglas de permiso de la sesion. Faro simplemente no lo manda.
 */
export const SAFE_PERMISSIONS = [
  'bash',
  'edit',
  'write',
  'read',
  'patch',
  'glob',
  'grep',
  'list',
  'webfetch',
  'task',
].map((permission) => ({ permission, pattern: '**', action: 'deny' }))
