/** Acceso a chrome.storage con valores por defecto y sin sorpresas. */

import { DEFAULT_SETTINGS, STORAGE_AREAS, STORAGE_KEYS, migrateSettings } from './config.js'
import { INDEX_VERSION } from '../atlassian/index-store.js'
import { normalizeProfile } from './jira-rest.js'
import { MODEL_CHECKS_VERSION, normalizeModelChecks, recordVerdicts } from './models.js'
// El diario tiene su propia puerta de borrado (deja una marca y va por su cola),
// y «Olvidar este sitio» pasa por ella: mira `forgetEverythingFor`. shared →
// shared, sin ciclo (activity-store.js sólo importa config.js y activity.js).
import { clearActivity } from './activity-store.js'

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

/**
 * Las claves POR HOST que «Olvidar este sitio» CONSERVA, con su motivo (H13).
 *
 * Es la ÚNICA puerta por la que una clave por host puede sobrevivir a un olvido:
 * `storage.test.js` recorre `STORAGE_KEYS` entera y exige que el olvido se lleve
 * todas las que son función de un host salvo las de aquí. El motivo no es
 * decorativo —la prueba exige que esté escrito—: sin él nadie puede saber dentro
 * de un año si conservarla sigue teniendo sentido.
 */
export const FORGET_KEEPS = {
  activityCleared:
    'No es un dato del sitio: es la MARCA de que su diario se acaba de borrar. ' +
    'La deja este mismo olvido (`clearActivity`) y la releen los dos escritores ' +
    'del diario justo antes de guardar, para que una visita que el service worker ' +
    'ya había leído no devuelva el diario entero unos milisegundos después ' +
    '(revisión adversaria de H11). Borrarla aquí sería deshacer el borrado.',
}

/** El área declarada de una clave, o '' si no dice dónde vive. */
function areaDe(name) {
  const area = Object.hasOwn(STORAGE_AREAS, name) ? STORAGE_AREAS[name] : ''
  return area === 'local' || area === 'session' ? area : ''
}

/**
 * Las claves POR HOST de un área que un olvido se lleva: las de `STORAGE_KEYS`
 * que son función de un host, viven ahí y no están conservadas.
 *
 * Derivadas, nunca escritas a mano: eso es lo que hace que una clave nueva no se
 * pueda quedar sin borrar. `Object.hasOwn` y no `in`, porque una clave que se
 * llamara «constructor» o «toString» sobreviviría por el prototipo (la lección
 * de `suggestionsFor` en H5).
 */
function hostKeys(host, area) {
  const out = []
  for (const [name, make] of Object.entries(STORAGE_KEYS)) {
    if (typeof make !== 'function') continue
    if (Object.hasOwn(FORGET_KEEPS, name)) continue
    if (areaDe(name) === area) out.push(make(host))
  }
  return out
}

/**
 * «Olvidar este sitio»: dejar ese host como si Faro no lo hubiera visto nunca.
 *
 * UNA sola puerta, y ésta (H13). Hasta aquí el borrado estaba repartido entre
 * `forgetSite` —que se llevaba cuatro claves de `local`— y el manejador del
 * botón del panel, que añadía a mano la memoria, el contexto, la sesión, lo que
 * pesaba, la caché de «hoy» y la marca de borrado del diario: siete llamadas en
 * el orden correcto que había que acordarse de escribir, y dos de ellas —el
 * CONTEXT.md y los resúmenes— no estaban en `forgetSite`, así que cualquier otro
 * llamante habría dejado detrás la prosa de un sitio que el usuario pidió
 * olvidar. Ahora el botón llama a esto y nada más.
 *
 * Las claves no se escriben aquí: se derivan de `STORAGE_KEYS` y de
 * `STORAGE_AREAS`, así que una clave nueva por host se borra sola en cuanto dice
 * en qué área vive. Lo único que sobrevive es lo que esté en `FORGET_KEEPS` con
 * su motivo. `remove` con una clave que no está es un no-op, así que no hace
 * falta saber cuáles tenía este host.
 *
 * El diario va PRIMERO y por su propia puerta: quitar su clave a secas no impide
 * que una escritura del service worker que ya había leído lo devuelva unos
 * milisegundos después. `clearActivity` deja la marca que ese escritor relee
 * antes de guardar y va dentro de la cola del diario, así que además serializa
 * el borrado con lo que el panel tuviera pendiente de apuntar.
 */
export async function forgetEverythingFor(host) {
  await clearActivity(host)
  const sites = await getSites()
  delete sites[host]
  await chrome.storage.local.set({ [STORAGE_KEYS.sites]: sites })
  for (const area of ['local', 'session']) {
    const claves = hostKeys(host, area)
    if (claves.length) await chrome.storage[area].remove(claves)
  }
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
    // Desde H21 el contexto es por ámbito (`{version: 2, scopes}`, scopes.js) y
    // antes era un texto: sale CRUDO, sea lo que sea, como la memoria. Lo
    // normaliza quien lo usa, porque la migración de un texto viejo necesita
    // saber bajo qué ámbito va (el del índice guardado, si se puede afirmar), y
    // eso lo decide el panel con el índice y el registro del sitio delante.
    contextRaw: got[STORAGE_KEYS.context(host)] ?? null,
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

/**
 * Lo que Faro sabe de cada modelo (H16, `faro:model-checks`): qué contestó y qué
 * falló, con su motivo y su caducidad. Es GLOBAL (el modelo es de la persona,
 * no de un sitio) y entra y sale por `normalizeModelChecks`, como el perfil por
 * `normalizeProfile`: con otro servidor de opencode u otros proveedores
 * conectados (`fingerprint`) lo guardado no dice nada y se lee vacío.
 *
 * `forgetEverythingFor` NO la toca: no es de ningún host. Se borra con su propio
 * botón («Olvidar los veredictos», `clearModelChecks`).
 */
export async function getModelChecks({ server = '', fingerprint = '', now = Date.now() } = {}) {
  const key = STORAGE_KEYS.modelChecks
  const got = await chrome.storage.local.get(key)
  return normalizeModelChecks(got[key], { server, fingerprint, now })
}

/** Guarda ya normalizado —por aquí no pasa nada sin reconstruir— y devuelve lo guardado. */
export async function saveModelChecks(checks, { server = '', fingerprint = '', now = Date.now() } = {}) {
  // Se acepta el objeto guardado entero (y si es de OTRO servidor u otra huella
  // se normaliza a vacío: no se puede guardar lo de otro opencode como de éste)
  // o sólo su mapa de veredictos, que se envuelve con los de ahora.
  const entero = !!checks && typeof checks === 'object' && !Array.isArray(checks) && 'version' in checks
  const raw = entero ? checks : { version: MODEL_CHECKS_VERSION, server, fingerprint, checks }
  const limpio = normalizeModelChecks(raw, { server, fingerprint, now })
  await chrome.storage.local.set({ [STORAGE_KEYS.modelChecks]: limpio })
  return limpio
}

/**
 * Apunta veredictos nuevos: lee, funde con `recordVerdicts` (la entrada más
 * reciente gana) y escribe. Dos fallos seguidos no se pisan porque cada uno
 * relee lo que dejó el anterior. Devuelve lo guardado.
 */
export async function recordModelChecks(verdicts, { server = '', fingerprint = '', now = Date.now() } = {}) {
  const actual = await getModelChecks({ server, fingerprint, now })
  return saveModelChecks(recordVerdicts(actual, verdicts), { server, fingerprint, now })
}

/** «Olvidar los veredictos»: quita la clave entera (no toca el modelo elegido). */
export async function clearModelChecks() {
  await chrome.storage.local.remove(STORAGE_KEYS.modelChecks)
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
