/** Constantes y valores por defecto. Sin dependencias del navegador. */

export const EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'
export const CORS_ORIGIN = `chrome-extension://${EXTENSION_ID}`

export const DEFAULT_SERVER = 'http://127.0.0.1:4096'

/** Nombre del servidor MCP en opencode para un host dado. */
export function mcpNameForHost(host) {
  return 'atlassian-' + String(host).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

/**
 * Cómo lleva Faro al usuario a un sitio.
 *
 * `guided`: intenta siempre enseñar el camino. Lee de quién cuelga el destino
 * y ofrece «Paso a paso» destacado; si no conoce el camino, lleva de golpe.
 * `quick`: lleva directamente, siempre. No se lee el árbol ni se espera nada.
 */
export const NAV_MODES = ['guided', 'quick']

/**
 * Tiempos de la navegación asistida. Es el ÚNICO sitio donde viven: el content
 * script (bootstrap.js) construye el NavRunner con una copia, runner.js cae en
 * estos valores cuando el panel no manda otros, y el service worker abandona
 * un paso atascado a los `stepStallMs`. Pasó de verdad (auditoría de
 * 2026-09-13): los mismos números estaban copiados a mano en esos tres
 * ficheros y cambiarlos aquí no cambiaba nada; nav-timing.test.js lo vigila.
 */
export const NAV_TIMING = {
  locateTimeoutMs: 2500, // cuánto se espera a que aparezca el enlace o la rama de un paso
  scrollSettleMs: 340, // reposo tras traer una fila del árbol a la vista
  stepPauseMs: 1600, // pausa con la tarjeta puesta antes de pulsar (el ajuste «stepDelayMs» del usuario)
  expandBudgetMs: 15000, // tope del barrido a ciegas por el árbol hacia el destino…
  maxExpandClicks: 40, // …y su tope de clics
  settleQuietMs: 220, // la página se da por quieta tras este silencio de mutaciones…
  settleMaxMs: 6000, // …o, como mucho, tras este tiempo
  stepStallMs: 9000, // el service worker abandona un paso cuya pestaña no avisa en este tiempo
}

export const DEFAULT_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: '',
  crossSessionMemory: false,
  navMode: 'guided',
  stepDelayMs: NAV_TIMING.stepPauseMs,
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

export const STORAGE_KEYS = {
  settings: 'faro:settings',
  sites: 'faro:sites',
  index: (host) => `faro:index:${host}`,
  session: (host) => `faro:session:${host}`,
  context: (host) => `faro:context:${host}`,
  memory: (host) => `faro:memory:${host}`,
}

/**
 * Permisos con los que Faro abre TODAS sus sesiones de opencode: una regla
 * que deniega todo y sólo el MCP de Atlassian permitido. Viven en
 * permissions.js (puro, con la simulación de cómo los evalúa opencode 1.2.25
 * para poder probarlos en Node y el porqué entero); se reexportan desde aquí
 * para que nadie cambie sus imports.
 *
 * Comprobado contra opencode 1.2.25: el `permission` de la sesión se respeta
 * (va DETRÁS de las reglas del agente y manda sobre ellas). El campo `tools`
 * del mensaje (marcado como obsoleto) también: lo convierte en reglas de
 * permiso de la sesión, persistentes. Faro simplemente no lo manda.
 */
export { SAFE_PERMISSIONS } from './permissions.js'
