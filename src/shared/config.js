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

export const DEFAULT_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: '',
  crossSessionMemory: false,
  assistedByDefault: true,
  stepDelayMs: 1600,
  reduceMotion: false,
  highlightStyle: 'spotlight',
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
 * Comprobado contra opencode 1.2.25: el `permission` de la sesion se respeta;
 * el campo `tools` del mensaje (marcado como obsoleto) se ignora.
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
