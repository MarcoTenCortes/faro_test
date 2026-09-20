/** Acceso a chrome.storage con valores por defecto y sin sorpresas. */

import { DEFAULT_SETTINGS, STORAGE_KEYS, migrateSettings } from './config.js'
import { INDEX_VERSION } from '../atlassian/index-store.js'
import { normalizeProfile } from './jira-rest.js'

export async function getSettings() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.settings)
  // Los ajustes de una versión anterior se traducen al leerlos y quedan
  // guardados en la forma nueva la próxima vez que se toque cualquier cosa.
  return { ...DEFAULT_SETTINGS, ...migrateSettings(got[STORAGE_KEYS.settings]) }
}

export async function saveSettings(patch) {
  const current = await getSettings()
  const next = { ...current, ...patch }
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next })
  return next
}

/** Estado por sitio: qué modelo usas ahí, si ya está configurado, etc. */
export async function getSites() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.sites)
  return got[STORAGE_KEYS.sites] || {}
}

export async function getSite(host) {
  const sites = await getSites()
  return sites[host] || null
}

export async function saveSite(host, patch) {
  const sites = await getSites()
  const next = { ...(sites[host] || {}), ...patch, host }
  sites[host] = next
  await chrome.storage.local.set({ [STORAGE_KEYS.sites]: sites })
  return next
}

export async function forgetSite(host) {
  const sites = await getSites()
  delete sites[host]
  await chrome.storage.local.set({ [STORAGE_KEYS.sites]: sites })
  // Lo que se aprendió de ese sitio se va con él: el índice, el perfil de su
  // proyecto, el historial de páginas base y el diario de actividad. «Olvidar
  // este sitio» no puede dejar detrás una lista de tipos y estados que el turno
  // siguiente volvería a meter en el prompt, ni un rastro de qué incidencias se
  // analizaron ahí que seguiría sugiriendo páginas al volver, ni un diario de lo
  // que el usuario abrió en un sitio que ha pedido olvidar.
  await chrome.storage.local.remove([
    STORAGE_KEYS.index(host),
    STORAGE_KEYS.profile(host),
    STORAGE_KEYS.sourceHistory(host),
    STORAGE_KEYS.activity(host),
  ])
}

/** El índice de contenido, cacheado en local para que navegar sea inmediato. */
/**
 * @returns {{index: object|null, stale: boolean}} `stale` avisa de que habia
 *          uno guardado pero era de una version anterior y se ha tirado. Sin
 *          ese aviso, el panel se quedaba sin indice y sin navegacion, en
 *          silencio, y no habia forma de saber por que.
 */
export async function getIndex(host) {
  const key = STORAGE_KEYS.index(host)
  const got = await chrome.storage.local.get(key)
  return takeIndex(host, got[key])
}

/**
 * Qué hacer con el índice que acaba de salir del almacén. Lo deciden en un
 * solo sitio `getIndex` y `getSiteBundle`: si cada uno comprobara la versión
 * por su cuenta, uno de los dos acabaría sirviendo un índice viejo.
 *
 * Un indice de una version anterior puede traer rutas que ya sabemos que no
 * funcionan. Mejor quedarse sin indice y reconstruirlo que llevar a alguien a
 * una pagina que no existe.
 */
async function takeIndex(host, index) {
  if (!index) return { index: null, stale: false }
  if (index.version !== INDEX_VERSION) {
    await chrome.storage.local.remove(STORAGE_KEYS.index(host))
    return { index: null, stale: true }
  }
  return { index, stale: false }
}

/**
 * Las claves POR HOST que el paquete del sitio trae ADEMÁS de las de siempre
 * (el mapa de sitios, el índice, el contexto y la memoria).
 *
 * Hoy el perfil del proyecto (H9), el historial de páginas base (H10) y el
 * diario de actividad (H11). Quien añada una pone aquí el NOMBRE de su clave en
 * `STORAGE_KEYS` y su valor sale en `bundle.extras` SIN TOCAR: la forma de cada
 * una la decide su hito con sus propias claves blancas, no este módulo (el
 * perfil, por `normalizeProfile`, que es lo que hace `getProfile`; el historial,
 * por `normalizeHistory`, que vive en `src/panel/source-history.js` y aquí no se
 * puede importar, igual que `normalizeMemory`; el diario, por
 * `pruneActivity`/`normalizeActivity`, que es lo que hace `getActivity`).
 * Añadir el nombre aquí es todo lo que hace falta para que su lectura viaje en
 * la misma petición al almacén.
 *
 * Las PÁGINAS DE REFERENCIA del contexto no tienen clave y por eso no están
 * aquí: docs/PLAN.md §3.2 descartó la lista estructurada del indexador, y el
 * parser de prosa las saca del CONTEXT.md, que ya viaja en este mismo paquete.
 */
export const BUNDLE_EXTRA_KEYS = ['profile', 'sourceHistory', 'activity']

/**
 * Las claves de almacenamiento que lee `getSiteBundle` para un host. Pura.
 *
 * Está fuera para poder mirarlas sin leer nada (y para que su prueba pueda
 * ejercitar el mecanismo de `extra` antes de que exista la primera clave
 * nueva). Un nombre que no esté en `STORAGE_KEYS` se ignora: una clave a medio
 * añadir no puede hacer que el arranque entero se caiga.
 */
export function bundleKeys(host, extra = BUNDLE_EXTRA_KEYS) {
  const claves = [
    STORAGE_KEYS.sites,
    STORAGE_KEYS.index(host),
    STORAGE_KEYS.context(host),
    STORAGE_KEYS.memory(host),
  ]
  for (const name of extra || []) {
    if (typeof STORAGE_KEYS[name] === 'function') claves.push(STORAGE_KEYS[name](host))
  }
  return claves
}

/**
 * Todo lo que este sitio tiene guardado, en UNA lectura.
 *
 * El arranque del panel encadenaba trece lecturas de `chrome.storage.local`,
 * cinco de ellas el mismo `getSite` del mismo host (y cada `getSite` relee el
 * mapa entero de `faro:sites`), detrás de las peticiones a opencode
 * (docs/PLAN.md §2.6 P4). `chrome.storage.local.get` acepta una lista de
 * claves y contesta con todas de una vez: eso es esto.
 *
 * `memoryRaw` sale TAL CUAL está guardada, sin normalizar: quien la usa la
 * pasa por `normalizeMemory` (y por `getMemory` cuando además hay que reparar
 * lo guardado), que viven en `src/panel/memory.js`, y `shared/` no importa de
 * `panel/`. El índice sí se comprueba aquí, porque la comprobación es de
 * almacenamiento y ya estaba en este módulo.
 */
export async function getSiteBundle(host, { extra = BUNDLE_EXTRA_KEYS } = {}) {
  const got = await chrome.storage.local.get(bundleKeys(host, extra))
  const sites = got[STORAGE_KEYS.sites] || {}
  const { index, stale } = await takeIndex(host, got[STORAGE_KEYS.index(host)])
  const extras = {}
  for (const name of extra || []) {
    if (typeof STORAGE_KEYS[name] === 'function') extras[name] = got[STORAGE_KEYS[name](host)] ?? null
  }
  return {
    site: sites[host] || null,
    index,
    stale,
    contextMd: got[STORAGE_KEYS.context(host)] || '',
    memoryRaw: got[STORAGE_KEYS.memory(host)] ?? null,
    extras,
  }
}

export async function saveIndex(host, index) {
  await chrome.storage.local.set({ [STORAGE_KEYS.index(host)]: index })
}

/**
 * El perfil del proyecto de un Jira: lo que la extensión contó de una muestra
 * (tipos, estados con su categoría, componentes, etiquetas y convenciones de
 * nombre). De aquí sale texto que entra DELIMITADO en un `system`, así que
 * entra y sale por `normalizeProfile`, que lo reconstruye con claves blancas y
 * devuelve null si es de otra versión (CLAUDE.md §9).
 *
 * Un perfil de otra versión NO se borra del almacén al leerlo, a diferencia del
 * índice: el índice viejo trae rutas que llevan a un 404 y por eso se tira en el
 * acto, mientras que un perfil es sólo un conteo que se vuelve a hacer y a
 * escribir encima. Borrarlo sería una escritura dentro de una lectura para nada.
 */
export async function getProfile(host) {
  const key = STORAGE_KEYS.profile(host)
  const got = await chrome.storage.local.get(key)
  return normalizeProfile(got[key])
}

/**
 * Guarda el perfil ya normalizado, o quita la clave si no hay nada que guardar.
 * Como `saveMemory`: por aquí no pasa nada sin reconstruir, para que lo que se
 * lea mañana sea lo que este módulo promete. Devuelve lo que quedó guardado.
 */
export async function saveProfile(host, profile) {
  const limpio = normalizeProfile(profile)
  if (!limpio) {
    await chrome.storage.local.remove(STORAGE_KEYS.profile(host))
    return null
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.profile(host)]: limpio })
  return limpio
}

/** La sesión activa por sitio. En storage.session: se va al cerrar Chrome. */
export async function getSessionId(host) {
  const key = STORAGE_KEYS.session(host)
  const got = await chrome.storage.session.get(key)
  return got[key] || null
}

export async function setSessionId(host, sessionID) {
  await chrome.storage.session.set({ [STORAGE_KEYS.session(host)]: sessionID })
}

export async function clearSessionId(host) {
  await chrome.storage.session.remove(STORAGE_KEYS.session(host))
}

/**
 * Cuántos caracteres de salidas de herramientas arrastra la sesión abierta.
 *
 * Es lo que el turno siguiente vuelve a mandar al modelo (el `system` no se
 * acumula; las salidas de las herramientas sí, acotadas por la poda de
 * opencode), y con ello se decide si el panel avisa de que conviene empezar una
 * sesión nueva. Vive en storage.session junto al id de la sesión para que el
 * aviso sobreviva a cerrar y abrir el panel sin volver a pedir los mensajes, y
 * muera con ella.
 *
 * Un contador, no un dato del modelo: se reconstruye a número entero no negativo
 * al leer Y al escribir. Un NaN guardado dejaría la comparación con el umbral
 * siempre en falso y el aviso no saldría nunca. Tiene que ser un NÚMERO: lo que
 * Faro escribe ahí siempre lo es, así que cualquier otra cosa en esa casilla no
 * es suya y cuenta como cero (el turno siguiente vuelve a escribir el bueno).
 */
function soloCuenta(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

export async function getSessionWeight(host) {
  const key = STORAGE_KEYS.sessionWeight(host)
  const got = await chrome.storage.session.get(key)
  return soloCuenta(got[key])
}

export async function setSessionWeight(host, chars) {
  await chrome.storage.session.set({ [STORAGE_KEYS.sessionWeight(host)]: soloCuenta(chars) })
}

export async function clearSessionWeight(host) {
  await chrome.storage.session.remove(STORAGE_KEYS.sessionWeight(host))
}
