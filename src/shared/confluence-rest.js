/**
 * El árbol de páginas, leído de la API REST del propio Confluence.
 *
 * Para guiar por el árbol hace falta saber de quién cuelga el destino. Antes se
 * le pedía al modelo: tenía que llamar al MCP, entender la respuesta y devolver
 * la cadena en un JSON válido. Entre treinta segundos y varios minutos, y con
 * los modelos pequeños ni eso. La cadena la tiene Confluence a una petición de
 * distancia: `GET /rest/api/content/<id>?expand=ancestors` la devuelve entera,
 * en el orden correcto, en milisegundos.
 *
 * Reglas que hacen que esto sea seguro, y que aplica ESTE módulo, no quien lo
 * llama:
 *  - Sólo GET, y sólo al mismo origen en el que ya está el usuario: se comprueba
 *    antes de cada petición. Viaja con la sesión del navegador; la extensión no
 *    toca ninguna credencial.
 *  - La ruta se construye únicamente a partir de un id numérico validado y de
 *    un prefijo con forma de ruta normal.
 *  - Lo que vuelve es información, nunca instrucciones: se validan los ids, se
 *    limpian y recortan los títulos, sólo se aceptan rutas relativas al sitio, y
 *    el resto se ignora.
 *
 * Sin dependencias del navegador: `fetch` se recibe por parámetro, así que corre
 * igual en el content script, en el banco de pruebas y en Node.
 */

const ID = /^\d+$/
const MAX_TITLE = 300
const MAX_CHAIN = 50

/** Un prefijo del wiki tiene forma de ruta: nada, o segmentos normales. */
const PREFIX = /^(\/[A-Za-z0-9._~-]+)*$/
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

// ------------------------------------------------------------------- rutas

/**
 * v1: vale en Cloud y en Server/Data Center. Se piden los antepasados y la
 * portada del espacio, que hace falta para poder quitarla del camino.
 */
export function ancestorsPath(pageId, wikiPrefix = '') {
  const id = cleanId(pageId)
  if (!id) return null
  return `${prefix(wikiPrefix)}/rest/api/content/${id}?expand=ancestors,space.homepage`
}

/** v2: sólo Cloud. Por si algún día retiran la v1. */
export function ancestorsPathV2(pageId, wikiPrefix = '/wiki') {
  const id = cleanId(pageId)
  if (!id) return null
  return `${prefix(wikiPrefix)}/api/v2/pages/${id}/ancestors?limit=${MAX_CHAIN}`
}

export function pagesPathV2(ids, wikiPrefix = '/wiki') {
  const limpios = [...new Set((ids || []).map(cleanId).filter(Boolean))]
  if (!limpios.length) return null
  return `${prefix(wikiPrefix)}/api/v2/pages?id=${limpios.join(',')}&limit=${MAX_CHAIN}`
}

export function spacePathV2(spaceId, wikiPrefix = '/wiki') {
  const id = cleanId(spaceId)
  if (!id) return null
  return `${prefix(wikiPrefix)}/api/v2/spaces/${id}`
}

/**
 * El prefijo del wiki que toca usar.
 *
 * El que se pide, si tiene forma de ruta. Si no, `/wiki` cuando el sitio es
 * Cloud —ahí el wiki cuelga SIEMPRE de /wiki, aunque la pestaña esté en Jira y
 * su ruta no lo diga— o cuando la página ya cuelga de ahí; y nada en el resto.
 */
export function resolveWikiPrefix({ requested, cloud, pathname } = {}) {
  if (typeof requested === 'string') {
    const p = requested.replace(/\/+$/, '')
    if (PREFIX.test(p)) return p
  }
  if (cloud || /^\/wiki(\/|$)/i.test(String(pathname || ''))) return '/wiki'
  return ''
}

function prefix(wikiPrefix) {
  const p = typeof wikiPrefix === 'string' ? wikiPrefix.replace(/\/+$/, '') : ''
  return PREFIX.test(p) ? p : ''
}

function cleanId(v) {
  const id = String(v ?? '').trim()
  return ID.test(id) ? id : ''
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** Un título es texto de una línea: sin caracteres de control ni espacios de más. */
function cleanTitle(v) {
  return str(v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
}

// ------------------------------------------------------------------ parseo

/**
 * De la respuesta v1 a la cadena raíz → página, ya enlazada por `parentId`.
 *
 * La portada del espacio se quita del camino a propósito: en la barra lateral no
 * es una rama que se despliegue, es el enlace de arriba del todo. Dejarla sería
 * un paso que no hace nada. Sólo se conserva si es el propio destino.
 *
 * @returns {Array<{id,title,parentId,url,spaceKey}>|null} null si la respuesta
 *          no tiene la forma esperada.
 */
export function parseAncestorsV1(json, wikiPrefix = '') {
  if (!json || typeof json !== 'object') return null
  const id = cleanId(json.id)
  if (!id) return null

  const spaceKey = cleanTitle(json.space?.key) || null
  const homeId = homepageIdV1(json.space)

  const chain = []
  const ancestors = Array.isArray(json.ancestors) ? json.ancestors.slice(0, MAX_CHAIN) : []
  for (const a of ancestors) {
    const aid = cleanId(a?.id)
    if (!aid || aid === id || chain.some((p) => p.id === aid)) continue
    chain.push(entry(a, aid, wikiPrefix))
  }
  chain.push(entry(json, id, wikiPrefix))

  return finish(chain, homeId, spaceKey)
}

/**
 * Lo mismo a partir de la API v2 de Cloud, que reparte la información en tres
 * respuestas: los ids de los antepasados, las páginas con su `parentId`, y el
 * espacio con su portada. El orden se reconstruye por `parentId`, así que da
 * igual en qué orden vengan los antepasados que sean páginas.
 */
export function parseAncestorsV2({ ancestors, pages, space } = {}, pageId, wikiPrefix = '/wiki') {
  const id = cleanId(pageId)
  if (!id) return null

  const byId = new Map()
  for (const p of Array.isArray(pages?.results) ? pages.results.slice(0, MAX_CHAIN) : []) {
    const pid = cleanId(p?.id)
    if (!pid) continue
    byId.set(pid, { ...entry(p, pid, wikiPrefix), parentId: cleanId(p?.parentId) || null })
  }
  // Los antepasados que no vengan en la lista de páginas —carpetas, pizarras,
  // bases de datos, que la v2 no trata como páginas— siguen valiendo como
  // eslabones: se enlazan por su posición en la lista, que la API devuelve de
  // arriba abajo. Sin título ni ruta, pero sin cortar la cadena por ellos.
  let anterior = null
  for (const a of Array.isArray(ancestors?.results) ? ancestors.results.slice(0, MAX_CHAIN) : []) {
    const aid = cleanId(a?.id)
    if (!aid) continue
    if (!byId.has(aid)) byId.set(aid, { ...entry(a, aid, wikiPrefix), parentId: anterior })
    anterior = aid
  }
  if (!byId.has(id)) return null

  const chain = []
  const seen = new Set()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id) && chain.length < MAX_CHAIN) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : null
  }

  const homeId = cleanId(space?.homepageId) || null
  const spaceKey = cleanTitle(space?.key) || null
  return finish(chain, homeId, spaceKey)
}

function finish(chain, homeId, spaceKey) {
  if (homeId && chain.length > 1 && chain[0].id === homeId) chain.shift()
  return chain.map((p, i) => ({
    id: p.id,
    title: p.title,
    url: p.url,
    parentId: i ? chain[i - 1].id : null,
    spaceKey,
  }))
}

function entry(node, id, wikiPrefix) {
  return {
    id,
    title: cleanTitle(node?.title),
    url: webuiOf(node, wikiPrefix),
  }
}

/**
 * La ruta de la página tal y como la enlaza la barra lateral.
 *
 * `_links.webui` viene relativa a la base del wiki: `/spaces/ENG/pages/1/T` en
 * Cloud (base `/wiki`) y `/display/ENG/T` en Data Center (base `/`). Se le pone
 * delante el prefijo observado en el navegador. Sólo se aceptan rutas relativas
 * al sitio: un esquema, un `//host` o una URL absoluta se descartan, y el índice
 * fabrica entonces la ruta canónica por id, que siempre existe.
 */
function webuiOf(node, wikiPrefix) {
  const webui = str(node?._links?.webui).replace(CONTROL, '')
  if (!webui.startsWith('/') || webui.startsWith('//')) return ''
  const p = prefix(wikiPrefix)
  if (p && (webui === p || webui.startsWith(p + '/'))) return webui
  return p + webui
}

/** La portada del espacio, venga expandida o sólo como enlace. */
function homepageIdV1(space) {
  if (!space || typeof space !== 'object') return null
  const expandida = cleanId(space.homepage?.id)
  if (expandida) return expandida
  const enlace = str(space._expandable?.homepage)
  const m = /\/content\/(\d+)\s*$/.exec(enlace)
  return m ? m[1] : null
}

// ------------------------------------------------------------------- fetch

/**
 * Los antepasados de una página, contra el sitio en el que está el usuario.
 *
 * @param {Function} fetchFn `fetch` del contexto que llama (el content script,
 *        normalmente). Se pasa por parámetro para poder probar esto sin red.
 * @param {{origin:string, wikiPrefix?:string, cloud?:boolean}} site
 * @returns {Promise<{ok:true, pages:Array, via:string, ms:number}|{ok:false, reason:string, status?:number}>}
 */
export async function fetchAncestors(fetchFn, site, pageId, { timeoutMs = 6000, credentials = 'same-origin' } = {}) {
  const t0 = Date.now()
  const id = cleanId(pageId)
  if (!id) return { ok: false, reason: 'id de página inválido' }

  const base = String(site?.origin || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/@]+$/i.test(base)) return { ok: false, reason: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin fetch' }

  // En Cloud el wiki cuelga SIEMPRE de /wiki, diga lo que diga la pestaña
  // (que puede ser la de Jira, en el mismo origen).
  const wiki = site?.cloud ? '/wiki' : prefix(site?.wikiPrefix)
  const opts = { timeoutMs, credentials, base }

  const v1 = await getJson(fetchFn, base + ancestorsPath(id, wiki), opts)
  if (v1.ok) {
    const pages = parseAncestorsV1(v1.json, wiki)
    if (pages) return { ok: true, pages, via: 'v1', ms: Date.now() - t0 }
    return { ok: false, reason: 'la respuesta de la API no tiene la forma esperada', status: v1.status }
  }

  // En Cloud la v1 puede estar retirada; la v2 cuenta lo mismo en tres pasos.
  // Un 401 o un 403 no se reintentan: la sesión no vale, y tampoco valdría ahí.
  const esCloud = !!site?.cloud || wiki === '/wiki'
  if (esCloud && v1.status && v1.status !== 401 && v1.status !== 403) {
    const v2 = await viaV2(fetchFn, base, '/wiki', id, opts)
    if (v2.ok) return { ...v2, ms: Date.now() - t0 }
  }

  return { ok: false, reason: v1.reason, status: v1.status }
}

async function viaV2(fetchFn, base, wiki, id, opts) {
  const ancestors = await getJson(fetchFn, base + ancestorsPathV2(id, wiki), opts)
  if (!ancestors.ok) return { ok: false, reason: ancestors.reason, status: ancestors.status }

  const ids = (Array.isArray(ancestors.json?.results) ? ancestors.json.results : []).map((r) => cleanId(r?.id)).filter(Boolean)
  const pages = await getJson(fetchFn, base + pagesPathV2([...ids, id], wiki), opts)
  if (!pages.ok) return { ok: false, reason: pages.reason, status: pages.status }

  // El espacio sólo hace falta para saber cuál es su portada. Si falla, el
  // camino sigue valiendo: como mucho lleva un paso de más.
  const propia = (Array.isArray(pages.json?.results) ? pages.json.results : []).find((p) => cleanId(p?.id) === id)
  const spaceId = cleanId(propia?.spaceId)
  const space = spaceId ? await getJson(fetchFn, base + spacePathV2(spaceId, wiki), opts) : { ok: false }

  const chain = parseAncestorsV2({ ancestors: ancestors.json, pages: pages.json, space: space.ok ? space.json : null }, id, wiki)
  if (!chain) return { ok: false, reason: 'la respuesta de la API v2 no tiene la forma esperada' }
  return { ok: true, pages: chain, via: 'v2' }
}

function sameOrigin(url, base) {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

/** GET con tope de tiempo, y sólo al sitio. Nunca lanza: devuelve el motivo. */
async function getJson(fetchFn, url, { timeoutMs, credentials, base }) {
  if (!url) return { ok: false, status: 0, reason: 'ruta inválida' }
  // La garantía de mismo origen se comprueba aquí, en el único sitio por el
  // que pasa toda petición, y no se confía en que la ruta se haya montado bien.
  if (!sameOrigin(url, base)) return { ok: false, status: 0, reason: 'la petición saldría del sitio' }

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : 0
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      credentials,
      headers: { Accept: 'application/json' },
      signal: ctrl?.signal,
    })
    if (!res || !res.ok) {
      const status = Number(res?.status) || 0
      return { ok: false, status, reason: status ? `la API respondió ${status}` : 'sin respuesta' }
    }
    const text = await res.text()
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) }
    } catch {
      // Una página de login en vez de JSON: la sesión no vale para la API.
      return { ok: false, status: res.status, reason: 'la respuesta no es JSON' }
    }
  } catch (err) {
    const abortado = err?.name === 'AbortError'
    return { ok: false, status: 0, reason: abortado ? `sin respuesta en ${timeoutMs} ms` : String(err?.message || err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
