/**
 * El diario de actividad y la caché de «qué mirar hoy», en `chrome.storage`.
 *
 * Aquí no hay lógica: la forma, los topes y la caducidad los decide
 * `src/atlassian/activity.js` (puro, con su test). Esto es lo que toca el
 * almacén, y está separado por lo mismo que `memory.js` o `source-history.js`:
 * guardar y normalizar tienen que ir juntos para que no se pueda persistir nada
 * sin reconstruirlo (CLAUDE.md §9), y lo que se puede probar en Node sin
 * `chrome` tiene que poder probarse sin `chrome`.
 *
 * Lo importan el panel y el SERVICE WORKER, así que vive en `src/shared/` y no
 * en `src/panel/`.
 *
 * LA CARRERA SW ↔ PANEL. Los dos escriben la misma clave: el worker apunta las
 * visitas (con el panel cerrado, por `chrome.tabs.onUpdated`) y el panel apunta
 * lo que sólo él sabe (un análisis terminado, una página base elegida).
 * `chrome.storage` no tiene transacciones, así que dos lee-funde-escribe que se
 * crucen podrían perder uno de los dos cambios. Tres cosas lo evitan:
 *
 *  1. CADA ESCRITOR TOCA SÓLO SUS CAMPOS. `recordVisit` nunca escribe
 *     `analyzedAt`/`notes`/`family`/`sourceAt` y `touchActivity` nunca escribe
 *     `seenAt`/`seenCount` (lo pina activity.test.js). Lo peor que puede pasar
 *     en la ventana es perder UNA visita o UN análisis de una entrada, nunca
 *     mezclar dos entradas ni corromper el diario.
 *  2. LA FUSIÓN ES POR CLAVE DE ÍTEM. Se lee, se funde la entrada que cambia y
 *     se escribe; las demás entradas viajan como estaban, así que dos eventos
 *     sobre PÁGINAS distintas no compiten por el mismo campo.
 *  3. CADA CONTEXTO SE SERIALIZA CONSIGO MISMO (`cola`): dos visitas seguidas en
 *     el worker, o un análisis y una página base seguidos en el panel, no se
 *     solapan entre sí. Queda la ventana ENTRE contextos —un análisis en el
 *     panel justo mientras el worker apunta una visita—, que es de milisegundos,
 *     no corrompe nada por (1) y (2), y la arregla el evento siguiente.
 *
 * La caché de «hoy» va en `storage.session` (se vacía al cerrar Chrome, que es
 * justo lo que quiere una caché de «qué ha cambiado»), no tiene esta carrera
 * —la escribe sólo el panel— y por eso se lee y se escribe sin más.
 */

import { STORAGE_KEYS } from './config.js'
import { normalizeActivity, pruneActivity, recordVisit, touchActivity } from '../atlassian/activity.js'

/**
 * Una cola de escrituras por host, para que dos eventos de ESTE contexto no se
 * pisen. Es un encadenado de promesas: cada operación espera a la anterior.
 * Un fallo no rompe la cadena (se encadena el `catch`), o un error dejaría al
 * host sin apuntar nada más en toda la sesión.
 */
const colas = new Map()

function cola(host, fn) {
  const previa = colas.get(host) || Promise.resolve()
  const siguiente = previa.then(fn, fn)
  colas.set(
    host,
    siguiente.then(
      () => {},
      () => {}
    )
  )
  return siguiente
}

/**
 * El diario de un host, reconstruido y sin lo caducado. Leer no escribe: lo
 * caducado se va del almacén en la primera escritura, que es cuando ya hay un
 * motivo para tocar la clave.
 */
export async function getActivity(host, { now = Date.now() } = {}) {
  const key = STORAGE_KEYS.activity(host)
  const got = await chrome.storage.local.get(key)
  return pruneActivity(got[key], { host, now })
}

/**
 * Guarda el diario, y por aquí no pasa nada sin `pruneActivity`: es lo que hace
 * que lo que se lea mañana sea lo que el módulo promete. Sin ninguna entrada se
 * quita la clave, para no dejar un objeto vacío por cada host visitado.
 * Devuelve lo que quedó guardado.
 */
export async function saveActivity(host, activity, { now = Date.now() } = {}) {
  const limpio = pruneActivity(activity, { host, now })
  const vacio = !Object.keys(limpio.items).length && !Object.keys(limpio.dismissed).length
  if (vacio) {
    await chrome.storage.local.remove(STORAGE_KEYS.activity(host))
    return limpio
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.activity(host)]: limpio })
  return limpio
}

/**
 * Apunta un evento: lee, funde y guarda, en una sola operación encolada.
 *
 * `evento` es `{event, kind, id, title?, path?, at?, notes?, family?}`:
 *  - `seen` (service worker): una visita, ya validada por `visitFromUrl`.
 *  - `analyzed` / `source` (panel): lo que sólo el panel sabe.
 *
 * Quien llama decide SI se apunta (ajustes, host configurado); aquí sólo se
 * apunta lo que llegue. Devuelve el diario guardado, o el que hubiera si el
 * evento no valía.
 */
export async function recordActivity(host, evento, { now = Date.now() } = {}) {
  return cola(host, async () => {
    const actual = await getActivity(host, { now })
    const siguiente =
      evento?.event === 'seen'
        ? recordVisit(actual, evento, { host, now })
        : touchActivity(actual, evento, { host, now })
    return saveActivity(host, siguiente, { now })
  })
}

/** «Borrar mi actividad»: se va la clave entera de ese host. */
export async function clearActivity(host) {
  return cola(host, async () => {
    await chrome.storage.local.remove(STORAGE_KEYS.activity(host))
    return normalizeActivity(null, { host })
  })
}

// ------------------------------------------------- la caché de «qué mirar hoy»

/**
 * Lo último que contestaron las API del sitio, tal cual lo dejó el panel.
 *
 * Sólo se comprueba que sea un objeto con un `fetchedAt` utilizable: lo de
 * dentro ya viene validado por `parseSearchIssues`/`parseRecentV1`, y la
 * puntuación se rehace al pintar porque depende de dónde estés y de tu diario.
 * Vive en `storage.session`: abrir el panel cinco veces en una mañana no puede
 * costar cinco tandas de peticiones, y al cerrar Chrome se va sola.
 */
export async function getTodayCache(host) {
  const key = STORAGE_KEYS.today(host)
  const got = await chrome.storage.session.get(key)
  const raw = got[key]
  if (!raw || typeof raw !== 'object') return null
  const fetchedAt = Number(raw.fetchedAt)
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
  return raw
}

export async function saveTodayCache(host, cache) {
  await chrome.storage.session.set({ [STORAGE_KEYS.today(host)]: cache })
}

export async function clearTodayCache(host) {
  await chrome.storage.session.remove(STORAGE_KEYS.today(host))
}
