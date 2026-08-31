/** Acceso a chrome.storage con valores por defecto y sin sorpresas. */

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './config.js'
import { INDEX_VERSION } from '../atlassian/index-store.js'

export async function getSettings() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(got[STORAGE_KEYS.settings] || {}) }
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
  await chrome.storage.local.remove(STORAGE_KEYS.index(host))
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
  const index = got[key]
  if (!index) return { index: null, stale: false }

  // Un indice de una version anterior puede traer rutas que ya sabemos que no
  // funcionan. Mejor quedarse sin indice y reconstruirlo que llevar a alguien
  // a una pagina que no existe.
  if (index.version !== INDEX_VERSION) {
    await chrome.storage.local.remove(key)
    return { index: null, stale: true }
  }
  return { index, stale: false }
}

export async function saveIndex(host, index) {
  await chrome.storage.local.set({ [STORAGE_KEYS.index(host)]: index })
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
