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
 *
 * Desde las páginas base del análisis, aquí vive también la BÚSQUEDA de páginas
 * por título (`searchPages`): la primera petición al sitio cuyo parámetro no es
 * un id numérico sino texto del usuario. Lo que la hace segura: sigue siendo un
 * GET al mismo origen con la sesión del navegador; el texto se limpia, se acota
 * en longitud y en número de términos, y se le quitan las comillas, las barras
 * y los comodines antes de convertirse en CQL; y lo que vuelve son datos, con
 * los mismos filtros que la cadena de antepasados. Comprobado que `~` compara
 * términos analizados: sin el comodín de prefijo en el último término, «Arqui»
 * no encuentra «Arquitectura», que es lo que se espera de un autocompletado.
 *
 * Y desde H7 hay un tercer tipo de lectura: las CONSULTAS DE PLANTILLA FIJA
 * (`viewedCql`, `mineCql`, `idsCql`, y desde H14 `spaceCql`) y el árbol entero
 * de un espacio (`fetchSpacePages`). Su texto no lo escribe nadie de fuera: lo
 * escribe Faro con cláusulas fijas y parámetros validados (un número de días,
 * ids numéricos, una clave de espacio), y ninguna se ejecuta sin pasar por
 * `isTemplateCql` —se comprueba contra las plantillas antes de pedir nada—. Un
 * título leído del DOM NUNCA se convierte en CQL (CLAUDE.md §8.12, §8.19).
 *
 * El GET y la guardia de mismo origen viven en rest-get.js: la misma barrera
 * que usa jira-rest.js, en un solo sitio.
 */

import { getJson, nowMs } from './rest-get.js'
import { validSpaceKey } from '../atlassian/site.js'
import { INDEX_LIMITS } from './config.js'

const ID = /^\d+$/
const MAX_TITLE = 300
const MAX_CHAIN = 50

/**
 * Topes de la búsqueda de páginas por título (`searchPages`). Viven aquí, en
 * el módulo que los aplica; el panel los referencia desde `SOURCE_LIMITS` y un
 * test pina que coinciden.
 */
export const SEARCH_LIMITS = {
  /** Con una letra, el sitio entero. */
  queryMin: 2,
  queryMax: 100,
  /** Palabras del texto que se convierten en términos CQL; el resto se ignora. */
  maxTerms: 6,
  defaultLimit: 8,
  maxLimit: 20,
  /** Resultados que se aceptan de la respuesta, venga como venga. */
  maxResults: 20,
}

/**
 * Topes de las lecturas que añadió H7: las consultas de plantilla fija y el
 * árbol de un espacio. Los de la paginación viven con el módulo que pide; los
 * TOPES DEL ÍNDICE (cuántas páginas y cuántas peticiones como mucho) son los de
 * `INDEX_LIMITS` en config.js, y quien pagina los aplica: un segundo tope propio
 * para lo mismo acabaría diciendo otra cosa.
 */
export const CONFLUENCE_REST_LIMITS = {
  /** Páginas por petición. El servidor puede devolver menos, y se sigue por `size`. */
  pageSize: 100,
  maxPageSize: 200,
  /** Resultados que se aceptan de una consulta de plantilla. */
  maxResults: 30,
  /** Ids que caben en un `id in (…)`. */
  maxIds: 20,
  /** Ventana en días de `mineCql`. */
  daysMax: 30,
  /** Quién modificó una página: sólo el nombre visible, acotado. */
  updatedByChars: 80,
  timeoutMs: 6000,
}

/** Un prefijo del wiki tiene forma de ruta: nada, o segmentos normales. */
const PREFIX = /^(\/[A-Za-z0-9._~-]+)*$/
// Los controles C0, el DEL y los C1 (U+0080-U+009F): el NEL (U+0085) abre línea y
// el `\s` de JavaScript no lo cubre, así que un título o un nombre con un NEL
// dentro salía de aquí en dos líneas (revisión adversaria de H7).
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')
/** Lo que en un literal CQL rompe la cadena (`"`, `\`) o es un comodín (`*`, `?`). */
const CQL_UNSAFE = new RegExp('["\\\\*?]', 'g')

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

// ---------------------------------------------------------------- búsqueda

/**
 * El texto de búsqueda tal y como puede entrar en un literal CQL: sin
 * caracteres de control, sin comillas, barras ni comodines, espacios
 * colapsados y con tope de longitud. Pura.
 */
export function cleanSearchText(text) {
  // Los caracteres inseguros se quitan sin dejar hueco: no separan palabras.
  return str(text).replace(CONTROL, ' ').replace(CQL_UNSAFE, '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_LIMITS.queryMax)
}

/** Las palabras que se convierten en términos, con tope; nada si no llega al mínimo. */
function searchTerms(text) {
  const limpio = cleanSearchText(text)
  if (limpio.length < SEARCH_LIMITS.queryMin) return []
  return limpio.split(' ').filter(Boolean).slice(0, SEARCH_LIMITS.maxTerms)
}

/**
 * De lo que escribió el usuario a una consulta CQL por título.
 *
 * Un término por palabra, y SÓLO el último con el comodín de prefijo: `~`
 * compara términos analizados, así que sin `*` «Arqui» no encuentra
 * «Arquitectura». El comodín va por término y no dentro de una frase entre
 * comillas, que no todas las versiones aceptan; y con una sola letra delante
 * no se pone, que sería pedir el sitio entero. Pura.
 *
 * @returns {string|null} null si no queda texto suficiente
 */
export function cqlTitleQuery(text) {
  const terminos = searchTerms(text)
  if (!terminos.length) return null
  const partes = terminos.map((t, i) => {
    const ultimo = i === terminos.length - 1
    return `title~"${t}${ultimo && t.length >= 2 ? '*' : ''}"`
  })
  return 'type=page AND ' + partes.join(' AND ')
}

/**
 * El tope de resultados que se pide, ya validado: llega por mensaje y un
 * `Number('8&expand=body')` es NaN, que en la URL sería `limit=NaN`. Pura.
 */
export function clampLimit(limit) {
  const n = Number(limit)
  return Number.isInteger(n) && n >= 1 && n <= SEARCH_LIMITS.maxLimit ? n : SEARCH_LIMITS.defaultLimit
}

/** v1: vale en Cloud y en Server/Data Center. `expand=space` trae la clave del espacio. */
export function searchPath(text, wikiPrefix = '', limit) {
  const cql = cqlTitleQuery(text)
  if (!cql) return null
  return `${prefix(wikiPrefix)}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${clampLimit(limit)}&expand=space`
}

/** v2: sólo Cloud, y sólo por título EXACTO. Por si algún día retiran la v1. */
export function pagesByTitlePathV2(text, wikiPrefix = '/wiki', limit) {
  const limpio = str(text).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_LIMITS.queryMax)
  if (limpio.length < SEARCH_LIMITS.queryMin) return null
  return `${prefix(wikiPrefix)}/api/v2/pages?title=${encodeURIComponent(limpio)}&limit=${clampLimit(limit)}`
}

/**
 * De la respuesta v1 (`results[]` con `id, type, title, space.key, _links.webui`)
 * a la lista de páginas. Sólo páginas, ids validados, títulos de una línea,
 * rutas relativas al sitio, sin repetir y con tope. null si la respuesta no
 * tiene la forma esperada. Pura.
 * @returns {Array<{id:string, title:string, spaceKey:string|null, url:string}>|null}
 */
export function parseSearchV1(json, wikiPrefix = '') {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) return null
  const out = []
  const seen = new Set()
  for (const r of json.results) {
    if (out.length >= SEARCH_LIMITS.maxResults) break
    if (!r || typeof r !== 'object') continue
    if (r.type != null && str(r.type) !== 'page') continue
    const id = cleanId(r.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: cleanTitle(r.title), spaceKey: cleanTitle(r.space?.key) || null, url: webuiOf(r, wikiPrefix) })
  }
  return out
}

/** Lo mismo desde la v2 de Cloud, que no trae la clave del espacio. Pura. */
export function parseSearchV2(json, wikiPrefix = '/wiki') {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) return null
  const out = []
  const seen = new Set()
  for (const r of json.results) {
    if (out.length >= SEARCH_LIMITS.maxResults) break
    if (!r || typeof r !== 'object') continue
    const id = cleanId(r.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: cleanTitle(r.title), spaceKey: null, url: webuiOf(r, wikiPrefix) })
  }
  return out
}

/**
 * Páginas del sitio cuyo título casa con lo escrito, contra el sitio en el que
 * está el usuario. Misma forma y mismas garantías que `fetchAncestors`.
 *
 * @param {Function} fetchFn `fetch` del contexto que llama
 * @param {{origin:string, wikiPrefix?:string, cloud?:boolean}} site
 * @param {string} text lo que escribió el usuario
 * @returns {Promise<{ok:true, pages:Array, via:'v1'|'v2', ms:number}|{ok:false, reason:string, status?:number}>}
 */
export async function searchPages(fetchFn, site, text, { limit, timeoutMs = 6000, credentials = 'same-origin' } = {}) {
  const t0 = Date.now()
  const base = String(site?.origin || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/@]+$/i.test(base)) return { ok: false, reason: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin fetch' }

  const wiki = site?.cloud ? '/wiki' : prefix(site?.wikiPrefix)
  const ruta = searchPath(text, wiki, limit)
  // Con menos de dos letras no se pregunta nada: sería pedir el sitio entero.
  if (!ruta) return { ok: false, reason: 'texto demasiado corto' }
  const opts = { timeoutMs, credentials, base }

  const v1 = await getJson(fetchFn, base + ruta, opts)
  if (v1.ok) {
    const pages = parseSearchV1(v1.json, wiki)
    if (pages) return { ok: true, pages, via: 'v1', ms: Date.now() - t0 }
    return { ok: false, reason: 'la respuesta de la API no tiene la forma esperada', status: v1.status }
  }

  // En Cloud la v1 puede estar retirada; la v2 sólo sabe buscar por título
  // exacto, que es menos, pero es algo. Un 401 o un 403 no se reintentan.
  const esCloud = !!site?.cloud || wiki === '/wiki'
  if (esCloud && v1.status && v1.status !== 401 && v1.status !== 403) {
    const rutaV2 = pagesByTitlePathV2(text, '/wiki', limit)
    const v2 = rutaV2 ? await getJson(fetchFn, base + rutaV2, opts) : { ok: false }
    if (v2.ok) {
      const pages = parseSearchV2(v2.json, '/wiki')
      if (pages) return { ok: true, pages, via: 'v2', ms: Date.now() - t0 }
    }
  }

  return { ok: false, reason: v1.reason, status: v1.status }
}

// ------------------------------------------- consultas de plantilla fija

/**
 * Las CQL que Faro sabe escribir, y las ÚNICAS que `searchContent` ejecuta.
 *
 * Son literales con un hueco: un número de páginas, un número de días, una lista
 * de ids numéricos, una clave de espacio. Nada de lo que escribe el usuario, ni
 * el modelo, ni el DOM entra en ellas (para el texto del usuario está
 * `cqlTitleQuery`, que es otra cosa y tiene sus propios límites). `mineCql`
 * ordena por `lastmodified` con `startOfDay()`, que es la función que la
 * referencia de campos de Data Center lista para ese campo, y usa `watcher`,
 * que en Confluence SÍ está en esa referencia (docs/plan/anexo-A, «APIs
 * externas»).
 *
 * La del árbol de un espacio (`spaceCql`) no está aquí porque lleva dentro la
 * clave, y la forma de una clave la decide `validSpaceKey`: copiarla en una
 * regex más sería tener dos ideas de lo mismo (§9). Se reconoce haciendo que la
 * plantilla la reproduzca ENTERA (ver `isTemplateCql`).
 */
const CQL_PLANTILLAS = [
  /^type = page AND id in recentlyViewedContent\(\d{1,3}\)$/,
  /^type = page AND \(contributor = currentUser\(\) OR watcher = currentUser\(\) OR mention = currentUser\(\) OR favourite = currentUser\(\)\) AND lastmodified >= startOfDay\("-\d{1,2}d"\) ORDER BY lastmodified DESC$/,
  /^type = page AND id in \(\d{1,19}(?:,\d{1,19})*\)$/,
]

/** Los `expand` que se admiten. Uno que no esté aquí se ignora. */
const EXPAND_BLANCOS = ['space', 'version', 'history.lastUpdated', 'ancestors', 'space.homepage']

/** Un número entero dentro de un rango, o 0. */
function entre(v, min, max) {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : 0
}

/** Las últimas páginas que ESTE usuario ha visto. Pura; null si el tope no vale. */
export function viewedCql(limit) {
  const n = entre(limit, 1, CONFLUENCE_REST_LIMITS.maxResults)
  return n ? `type = page AND id in recentlyViewedContent(${n})` : null
}

/** Las páginas tuyas —escritas, seguidas, mencionadas o marcadas— de los últimos días. Pura. */
export function mineCql(days) {
  const d = entre(days, 1, CONFLUENCE_REST_LIMITS.daysMax)
  if (!d) return null
  return (
    'type = page AND (contributor = currentUser() OR watcher = currentUser() OR mention = currentUser()' +
    ` OR favourite = currentUser()) AND lastmodified >= startOfDay("-${d}d") ORDER BY lastmodified DESC`
  )
}

/** Unas páginas concretas por id. Pura; null sin ningún id numérico. */
export function idsCql(ids) {
  const limpios = []
  for (const raw of Array.isArray(ids) ? ids : []) {
    if (limpios.length >= CONFLUENCE_REST_LIMITS.maxIds) break
    const id = cleanId(raw)
    if (id && !limpios.includes(id)) limpios.push(id)
  }
  return limpios.length ? `type = page AND id in (${limpios.join(',')})` : null
}

/** ¿Este CQL lo escribió una de las plantillas de este módulo? Pura. */
export function isTemplateCql(cql) {
  const q = str(cql)
  if (CQL_PLANTILLAS.some((re) => re.test(q))) return true
  // La del árbol de un espacio se comprueba a la inversa: se lee la clave de la
  // propia consulta y se exige que `spaceCql` —que la valida con
  // `validSpaceKey`— devuelva EXACTAMENTE lo mismo. Con `[^"]*` una comilla ni
  // llega a leerse como clave, y con la vuelta entera tampoco cuela nada que
  // `validSpaceKey` no admita.
  const m = /^type = page AND space = "([^"]*)" ORDER BY lastmodified DESC$/.exec(q)
  return !!m && spaceCql(m[1]) === q
}

/**
 * La ruta de una consulta de plantilla. Pura.
 *
 * El `expand` se filtra contra la lista blanca: `body.storage` traería el cuerpo
 * entero de cada página, que ni hace falta ni se quiere arrastrar.
 */
export function contentSearchPath(cql, { wikiPrefix = '', expand = [], limit } = {}) {
  if (!isTemplateCql(cql)) return null
  const expands = [...new Set((Array.isArray(expand) ? expand : []).map(str).filter((e) => EXPAND_BLANCOS.includes(e)))]
  const n = entre(limit, 1, CONFLUENCE_REST_LIMITS.maxResults) || CONFLUENCE_REST_LIMITS.maxResults
  return (
    `${prefix(wikiPrefix)}/rest/api/content/search?cql=${encodeURIComponent(str(cql))}&limit=${n}` +
    (expands.length ? `&expand=${expands.join(',')}` : '')
  )
}

/** Quién tocó una página por última vez: sólo el nombre visible, acotado. */
function quien(node) {
  return str(node?.displayName).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, CONFLUENCE_REST_LIMITS.updatedByChars)
}

/**
 * Lo mismo que `parseSearchV1` más CUÁNDO se modificó la página y quién: es lo
 * que permite decir «cambió después de que la vieras» sin preguntárselo a nadie.
 * `version.when` si viene expandida; si no, `history.lastUpdated.when`. Pura.
 *
 * @returns {Array<{id,title,spaceKey,url,updatedAt,updatedBy,version}>|null}
 */
export function parseRecentV1(json, wikiPrefix = '') {
  const base = parseSearchV1(json, wikiPrefix)
  if (!base) return null
  const porId = new Map()
  for (const r of json.results) {
    const id = cleanId(r?.id)
    if (id && !porId.has(id)) porId.set(id, r)
  }
  return base.map((p) => {
    const r = porId.get(p.id) || {}
    const cuando = str(r.version?.when) || str(r.history?.lastUpdated?.when)
    const t = Date.parse(cuando)
    return {
      ...p,
      updatedAt: Number.isFinite(t) ? t : 0,
      updatedBy: quien(r.version?.by) || quien(r.history?.lastUpdated?.by),
      version: entre(r.version?.number, 1, 1e9),
    }
  })
}

/**
 * Páginas del sitio que casan con una consulta de PLANTILLA, contra el sitio en
 * el que está el usuario. Mismas garantías que `searchPages`, y una más: si el
 * CQL no lo escribió una plantilla de este módulo, no se pide nada.
 *
 * @returns {Promise<{ok:true, pages:Array, via:'v1', ms:number}|{ok:false, reason:string, status?:number}>}
 */
export async function searchContent(
  fetchFn,
  site,
  cql,
  {
    expand = ['space', 'version', 'history.lastUpdated'],
    limit,
    timeoutMs = CONFLUENCE_REST_LIMITS.timeoutMs,
    credentials = 'same-origin',
  } = {}
) {
  const t0 = nowMs()
  const base = String(site?.origin || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/@]+$/i.test(base)) return { ok: false, reason: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin fetch' }
  if (!isTemplateCql(cql)) return { ok: false, reason: 'consulta no permitida' }

  const wiki = site?.cloud ? '/wiki' : prefix(site?.wikiPrefix)
  const r = await getJson(fetchFn, base + contentSearchPath(cql, { wikiPrefix: wiki, expand, limit }), {
    timeoutMs,
    credentials,
    base,
  })
  if (!r.ok) return { ok: false, reason: r.reason, status: r.status }
  const pages = parseRecentV1(r.json, wiki)
  if (!pages) return { ok: false, reason: 'la respuesta de la API no tiene la forma esperada', status: r.status }
  return { ok: true, pages, via: 'v1', ms: Math.round(nowMs() - t0) }
}

// ------------------------------------------------- el árbol de un espacio

/**
 * El CQL con el que se lee el árbol de un espacio: sus páginas, LAS MÁS
 * RECIENTES PRIMERO. Pura; null si la clave no tiene forma de clave.
 *
 * Por qué no vale la lista de `/rest/api/content?spaceKey=…`, que es lo que
 * usaba H9: esa lista devuelve las páginas en orden ASCENDENTE de id, o sea las
 * más VIEJAS primero. En el espacio real del usuario (2 697 páginas) el tope de
 * `INDEX_LIMITS.maxPages` se gastaba entero en las trescientas más antiguas y la
 * página que él tenía abierta ni estaba: un índice «exacto» que no contiene nada
 * de lo que se usa (H14, F8). Ordenando por `lastmodified DESC`, las que entran
 * son las que alguien ha tocado, que son las que se van a buscar.
 *
 * La clave va entre comillas dobles y la valida `validSpaceKey`, que sólo admite
 * `~?[A-Za-z0-9_.@:-]`: ahí dentro no hay comillas ni barras con las que cerrar
 * el literal, ni espacios, ni paréntesis con los que añadir una cláusula
 * (pinado con claves hostiles).
 */
export function spaceCql(spaceKey) {
  const key = validSpaceKey(spaceKey)
  return key ? `type = page AND space = "${key}" ORDER BY lastmodified DESC` : null
}

/**
 * La ruta de una página de resultados del árbol de un espacio. Pura.
 *
 * Lo que puede entrar en ella es una clave de espacio y nada más, y eso lo
 * decide `spaceCql`: aquí NO se vuelve a preguntar `isTemplateCql`, porque sería
 * preguntarle a la plantilla por sí misma —la reconoce reproduciéndola— y una
 * barrera que ninguna prueba puede mover es una barrera que se cae sin que nadie
 * lo note. Lo que sí está pinado es la propiedad: el CQL que acaba en la ruta lo
 * reconoce `isTemplateCql` siempre.
 *
 * `expand=ancestors` es lo que trae la cadena entera de cada resultado:
 * verificado contra el Confluence 9.2 real, 100 resultados y los 100 con sus
 * antepasados. El tamaño de página lo acota este módulo, y el `start` lo lleva
 * quien pagina.
 */
export function spaceSearchPath(spaceKey, wikiPrefix = '', { start, limit } = {}) {
  const cql = spaceCql(spaceKey)
  if (!cql) return null
  const desde = entre(start, 0, 100000) || 0
  const cuantas = entre(limit, 1, CONFLUENCE_REST_LIMITS.maxPageSize) || CONFLUENCE_REST_LIMITS.pageSize
  return (
    `${prefix(wikiPrefix)}/rest/api/content/search?cql=${encodeURIComponent(cql)}` +
    `&expand=ancestors&start=${desde}&limit=${cuantas}`
  )
}

/**
 * De una página de resultados de esa búsqueda a GRUPOS: cada resultado con su
 * cadena de antepasados, de la raíz a él. Pura.
 *
 * Los antepasados entran como páginas del índice, no sólo como un `parentId`:
 * leyendo las más recientes primero, sus padres casi nunca están entre ellas, y
 * sin ellos el árbol sale desmigajado —cada página como su propia raíz— y el
 * paso a paso no tendría por dónde empezar.
 *
 * Vienen agrupados y no en una lista plana porque el tope se aplica por GRUPO:
 * una página incluida sin su cadena entera es una página a la que no se sabe
 * llegar. De cada cadena se conservan los `MAX_CHAIN` antepasados más CERCANOS,
 * así que el padre de un resultado siempre es el de verdad; una página a más de
 * cincuenta de la raíz empezaría su cadena en su antepasado número cincuenta.
 *
 * @returns {{groups:Array<Array<{id,title,parentId,url,spaceKey}>>, size:number,
 *          total:number, next:boolean}|null}
 */
export function parseSpaceSearch(json, { wikiPrefix = '', spaceKey = null } = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) return null
  // Los antepasados de una página están en su mismo espacio, y el espacio es el
  // que se pidió: no hace falta expandir `space` en cada resultado para saberlo.
  const clave = validSpaceKey(spaceKey) || null
  const groups = []
  for (const r of json.results) {
    if (!r || typeof r !== 'object') continue
    if (r.type != null && str(r.type) !== 'page') continue
    const id = cleanId(r.id)
    if (!id) continue
    const cadena = []
    const vistos = new Set([id])
    const ancestros = Array.isArray(r.ancestors) ? r.ancestors.slice(-MAX_CHAIN) : []
    for (const a of ancestros) {
      const aid = cleanId(a?.id)
      if (!aid || vistos.has(aid)) continue
      vistos.add(aid)
      cadena.push(eslabon(a, aid, wikiPrefix, cadena, clave))
    }
    // La clave que se estampa es SIEMPRE una validada: la pedida, y si no la
    // que trae el resultado pasada por `validSpaceKey` (con `cleanTitle` se
    // copiaba `OTRO"KEY` tal cual; revisión adversaria de H14).
    cadena.push(eslabon(r, id, wikiPrefix, cadena, clave || validSpaceKey(r.space?.key) || null))
    groups.push(cadena)
  }
  const size = entre(json.size, 0, 100000) || groups.length
  return { groups, size, total: entre(json.totalSize, 0, 100000000), next: !!str(json._links?.next) }
}

/** Una página de la cadena, colgada de la anterior. Mismas claves que `parseSpacePages`. */
function eslabon(node, id, wikiPrefix, cadena, spaceKey) {
  const base = entry(node, id, wikiPrefix)
  return {
    id: base.id,
    title: base.title,
    parentId: cadena.length ? cadena[cadena.length - 1].id : null,
    url: base.url,
    spaceKey,
  }
}

/**
 * La ruta de una página de resultados del contenido de un espacio. Pura.
 *
 * `expand=ancestors` hace que la lista traiga el árbol con su forma: el último
 * antepasado de cada página es su padre (verificado contra el Confluence 9.2
 * real). `space.homepage` trae la portada, que hay que quitar del camino.
 *
 * Desde H14 esta lista ya no es de donde sale el árbol —devuelve las páginas más
 * VIEJAS primero, ver `spaceCql`—, pero sigue haciendo falta para dos cosas: la
 * PORTADA (con `limit=1` basta) y como camino de respaldo si la instancia no
 * sabe hacer la búsqueda ordenada.
 */
export function spacePagesPath(spaceKey, wikiPrefix = '', { start, limit } = {}) {
  const key = validSpaceKey(spaceKey)
  if (!key) return null
  const desde = entre(start, 0, 100000) || 0
  const cuantas = entre(limit, 1, CONFLUENCE_REST_LIMITS.maxPageSize) || CONFLUENCE_REST_LIMITS.pageSize
  return (
    `${prefix(wikiPrefix)}/rest/api/content?spaceKey=${encodeURIComponent(key)}&type=page&status=current` +
    `&expand=ancestors,space.homepage&start=${desde}&limit=${cuantas}`
  )
}

/**
 * De una página de resultados de `/rest/api/content?spaceKey=…` a las páginas con
 * su padre. Pura.
 *
 * `next` es un BOOLEANO, no la ruta que manda el servidor en `_links.next`: la
 * siguiente petición la monta `spacePagesPath` con el `start` que lleva la
 * cuenta quien pagina. Seguir una URL que viene en la respuesta sería dejar que
 * el servidor decida qué se pide (§8.3).
 *
 * @returns {{pages:Array<{id,title,parentId,url,spaceKey}>, size:number, next:boolean, homeId:string|null}|null}
 */
export function parseSpacePages(json, wikiPrefix = '') {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) return null
  const pages = []
  const vistos = new Set()
  let homeId = null
  for (const r of json.results) {
    if (!r || typeof r !== 'object') continue
    if (r.type != null && str(r.type) !== 'page') continue
    const id = cleanId(r.id)
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    if (!homeId) homeId = homepageIdV1(r.space)
    const ancestros = Array.isArray(r.ancestors) ? r.ancestors.slice(-MAX_CHAIN) : []
    let parentId = null
    for (let i = ancestros.length - 1; i >= 0; i--) {
      const aid = cleanId(ancestros[i]?.id)
      if (aid && aid !== id) {
        parentId = aid
        break
      }
    }
    pages.push({
      id,
      title: cleanTitle(r.title),
      parentId,
      url: webuiOf(r, wikiPrefix),
      spaceKey: cleanTitle(r.space?.key) || null,
    })
  }
  const size = entre(json.size, 0, 100000) || pages.length
  return { pages, size, next: !!str(json._links?.next), homeId }
}

/**
 * El árbol de páginas de un espacio, paginado y con tope.
 *
 * Es lo que sustituye las dos fases de modelo del indexador (el volcado del
 * índice y la jerarquía): la API lo dice exacto y en milisegundos. Los topes son
 * los del ÍNDICE (`INDEX_LIMITS.maxPages` y `restMaxRequests`), no unos propios:
 * dos topes para lo mismo acabarían diciendo cosas distintas.
 *
 * Qué entra cuando no cabe todo (H14, F8): las páginas MÁS RECIENTES, cada una
 * con su cadena de antepasados ENTERA. Un espacio de verdad tiene miles de
 * páginas y el tope no da para todas; lo que no se puede es devolver una
 * rebanada arbitraria —las trescientas más viejas— en la que ni está lo que el
 * usuario está mirando. `truncated` dice que se quedó corto, `total` cuántas hay
 * y `own` cuántas de ellas entraron (los antepasados que vinieron de propina no
 * cuentan: no son «lo que se ha leído del espacio»).
 *
 * La guardia de mismo origen se comprueba en CADA petición, porque cada petición
 * es un `getJson` y la comprobación vive dentro.
 *
 * La PORTADA del espacio viene en `homeId`: quitarla del camino es decisión de
 * quien monta el índice (lo hace `finish` para la cadena de antepasados, porque
 * en la barra lateral no es una rama que se despliegue), y aquí no se decide por
 * él. Cuesta una petición a la lista de siempre, que es la que sabe expandirla.
 *
 * @returns {Promise<{ok:true, pages:Array, homeId:string|null, requests:number,
 *          truncated:boolean, total:number, own:number, via:'busqueda'|'lista', ms:number}
 *          |{ok:false, reason:string, status?:number}>}
 */
export async function fetchSpacePages(
  fetchFn,
  site,
  spaceKey,
  {
    limit = CONFLUENCE_REST_LIMITS.pageSize,
    maxPages = INDEX_LIMITS.maxPages,
    maxRequests = INDEX_LIMITS.restMaxRequests,
    timeoutMs = CONFLUENCE_REST_LIMITS.timeoutMs,
    credentials = 'same-origin',
  } = {}
) {
  const t0 = nowMs()
  const base = String(site?.origin || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/@]+$/i.test(base)) return { ok: false, reason: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin fetch' }
  if (!validSpaceKey(spaceKey)) return { ok: false, reason: 'clave de espacio inválida' }

  const wiki = site?.cloud ? '/wiki' : prefix(site?.wikiPrefix)
  const opts = { timeoutMs, credentials, base }
  // Un tope que no sea un número (una opción a medio pasar) vale 1 petición, no
  // ninguna y tampoco infinitas: `Math.max(1, undefined)` es NaN, y con NaN el
  // bucle no se ejecutaría y esto devolvería un árbol vacío como si el espacio
  // no tuviera páginas.
  const tope = Number.isInteger(maxRequests) && maxRequests >= 1 ? maxRequests : 1
  // Y lo mismo con el tope de PÁGINAS: con NaN, `pages.length >= NaN` es siempre
  // falso y `slice(0, NaN)` es `[]`, así que se gastaban todas las peticiones
  // para devolver un árbol vacío con `ok: true` (revisión adversaria de H7). Un
  // tope que no vale es el del índice, que es el que tiene dueño.
  const topePaginas = Number.isInteger(maxPages) && maxPages >= 1 ? maxPages : INDEX_LIMITS.maxPages

  const pages = []
  const vistos = new Set()
  /** Páginas del espacio que entraron; los antepasados de propina no cuentan. */
  const propias = new Set()
  let requests = 0
  let total = 0
  let corto = false

  /**
   * Un grupo entra ENTERO o no entra: una página sin su cadena es una página a
   * la que Faro no sabría llevar. Devuelve si cupo.
   */
  const meter = (grupo) => {
    const nuevos = grupo.filter((p) => !vistos.has(p.id))
    if (pages.length + nuevos.length > topePaginas) return false
    for (const p of nuevos) {
      vistos.add(p.id)
      pages.push(p)
    }
    propias.add(grupo[grupo.length - 1].id)
    return true
  }

  // La portada, con una petición a la lista de siempre (`limit=1`): hace falta
  // su id para que sus hijas no cuelguen de ella (§4.6) y la búsqueda no la
  // distingue de cualquier otra página. Si falla, o si no cabe en el tope de
  // peticiones, el árbol vale igual: como mucho el recorrido lleva un peldaño de
  // más. La página que traiga esa petición NO se guarda: es la más vieja del
  // espacio, y aquí se leen las más recientes.
  let homeId = null
  if (tope >= 2) {
    const r = await getJson(fetchFn, base + spacePagesPath(spaceKey, wiki, { start: 0, limit: 1 }), opts)
    requests++
    if (r.ok) homeId = parseSpacePages(r.json, wiki)?.homeId || null
  }

  let via = 'busqueda'
  let fallo = null
  let hayMas = false
  let start = 0
  while (requests < tope) {
    const r = await getJson(fetchFn, base + spaceSearchPath(spaceKey, wiki, { start, limit }), opts)
    requests++
    const parsed = r.ok ? parseSpaceSearch(r.json, { wikiPrefix: wiki, spaceKey }) : null
    if (!parsed) {
      fallo = r.ok ? { reason: 'la respuesta de la API no tiene la forma esperada', status: r.status } : r
      break
    }
    if (parsed.total) total = parsed.total
    const antes = propias.size
    hayMas = parsed.next
    for (const grupo of parsed.groups) {
      if (!meter(grupo)) {
        corto = true
        break
      }
    }
    // Sin `next`, con una página vacía, o sin una sola página nueva —un servidor
    // que ignore el `start` devolvería siempre la misma—, el recorrido se acaba:
    // seguir sería gastar el tope entero para nada.
    if (corto || !parsed.next || !parsed.groups.length || propias.size === antes) break
    start += parsed.size || parsed.groups.length
  }

  if (fallo) {
    // Una instancia que no acepte este ORDER BY o este `expand` contesta 400, o
    // algo que no tiene la forma esperada. Antes que dejar al usuario sin índice
    // se degrada UNA vez al camino de antes —la lista ascendente, que devuelve
    // una rebanada arbitraria pero cierta— y se dice por dónde vino. SÓLO por
    // forma: con un 5xx, un 404, sin red o sin respuesta se devuelve el fallo,
    // porque la lista daría `ok: true` con las páginas MÁS VIEJAS por un 503
    // pasajero —justo lo que F8 vino a quitar— y el índice exacto acabaría
    // sustituido por esa rebanada (revisión adversaria de H14); el indexado
    // sigue entonces por el modelo, con su aviso. Una sesión que no vale tampoco
    // se reintenta: no valdría allí. Y si ya se había leído algo, tampoco: sería
    // empezar de cero a mitad de camino.
    const porForma = fallo.status === 400 || (fallo.status >= 200 && fallo.status < 300)
    if (pages.length || !porForma) {
      return { ok: false, reason: fallo.reason, status: fallo.status }
    }
    via = 'lista'
    total = 0
    hayMas = false
    start = 0
    while (requests < tope) {
      const r = await getJson(fetchFn, base + spacePagesPath(spaceKey, wiki, { start, limit }), opts)
      requests++
      if (!r.ok) return { ok: false, reason: r.reason, status: r.status }
      const parsed = parseSpacePages(r.json, wiki)
      if (!parsed) return { ok: false, reason: 'la respuesta de la API no tiene la forma esperada', status: r.status }
      if (!homeId) homeId = parsed.homeId
      const antes = propias.size
      hayMas = parsed.next
      for (const p of parsed.pages) {
        if (!meter([p])) {
          corto = true
          break
        }
      }
      if (corto || !parsed.next || !parsed.pages.length || propias.size === antes) break
      start += parsed.size || parsed.pages.length
    }
  }

  // Recortado es lo que el servidor dice que hay frente a lo que entró; y si no
  // lo dice (la lista no trae `totalSize`), haber parado por un tope con el
  // servidor diciendo que quedaban más.
  const truncated = total ? total > propias.size : corto || hayMas
  return {
    ok: true,
    pages,
    homeId,
    requests,
    truncated,
    total,
    own: propias.size,
    via,
    ms: Math.round(nowMs() - t0),
  }
}
