/**
 * Detección de sitio, producto y ubicación a partir de la URL.
 * Funciones puras: es lo que hace que la extensión sepa «dónde estás»
 * sin tocar el DOM, y lo que permite probarlo sin navegador.
 */

/** ¿Es una URL de Jira/Confluence que nos interesa? */
export function isAtlassianUrl(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return true
  } catch {
    return false
  }
}

/**
 * Analiza una URL de Atlassian.
 * @returns {{host:string, origin:string, product:'jira'|'confluence'|'unknown',
 *            spaceKey?:string, pageId?:string, projectKey?:string,
 *            issueKey?:string, boardId?:string, cloud:boolean}|null}
 */
export function parseAtlassianUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null

  const host = u.hostname
  const path = u.pathname
  const cloud = /\.atlassian\.net$/i.test(host)
  const out = { host, origin: u.origin, product: 'unknown', cloud }

  // ---- Confluence -------------------------------------------------------
  // Cloud:  /wiki/spaces/ENG/pages/123456/Titulo
  // DC:     /display/ENG/Titulo   |   /spaces/ENG/pages/123456
  const conf =
    path.match(/\/wiki\/spaces\/([^/]+)(?:\/pages\/(\d+))?/i) ||
    path.match(/^\/spaces\/([^/]+)(?:\/pages\/(\d+))?/i)
  if (conf) {
    out.product = 'confluence'
    // El prefijo se OBSERVA, no se adivina: hay Confluence Cloud con dominio
    // propio (sin .atlassian.net) y Data Center en la raiz. Lo unico fiable es
    // la URL que el usuario tiene delante.
    out.wikiPrefix = /^\/wiki\//i.test(path) ? '/wiki' : ''
    out.spaceKey = decodeURIComponent(conf[1])
    if (conf[2]) out.pageId = conf[2]
    return out
  }
  const display = path.match(/^\/display\/([^/]+)/i)
  if (display) {
    out.product = 'confluence'
    out.wikiPrefix = ''
    out.spaceKey = decodeURIComponent(display[1])
    return out
  }
  // `/wiki` a secas es demasiado genérico para reclamarlo en cualquier dominio:
  // sólo cuenta si el host ya es de Atlassian o si la ruta continúa con algo
  // reconociblemente de Confluence.
  if (/^\/wiki(\/|$)/i.test(path) && (cloud || /^\/wiki\/(spaces|pages|display|label|home)/i.test(path))) {
    out.product = 'confluence'
    out.wikiPrefix = '/wiki'
    const pageOnly = path.match(/\/pages\/(?:viewpage\.action)?\D*(\d+)/i)
    if (pageOnly) out.pageId = pageOnly[1]
    // Un id es un número: `?pageId=abc` no señala ninguna página, y aceptarlo
    // hacía que una URL pegada pasara por válida y fallara más adelante sin
    // motivo claro. La rama de Data Center ya lo exigía.
    const qsPage = u.searchParams.get('pageId')
    if (qsPage && /^\d+$/.test(qsPage)) out.pageId = qsPage
    const qsSpace = u.searchParams.get('spaceKey')
    if (qsSpace) out.spaceKey = qsSpace
    return out
  }

  // ---- Jira -------------------------------------------------------------
  // /browse/ABC-123
  const browse = path.match(/^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/)
  if (browse) {
    out.product = 'jira'
    out.issueKey = browse[1].toUpperCase()
    out.projectKey = out.issueKey.split('-')[0]
    return out
  }
  // /jira/software/projects/ABC/boards/1  |  /jira/core/projects/ABC/...
  const proj = path.match(/\/jira\/[^/]+\/projects\/([^/]+)/i)
  if (proj) {
    out.product = 'jira'
    out.projectKey = decodeURIComponent(proj[1]).toUpperCase()
    const board = path.match(/\/boards\/(\d+)/)
    if (board) out.boardId = board[1]
    const selected = u.searchParams.get('selectedIssue')
    if (selected) out.issueKey = selected.toUpperCase()
    return out
  }
  // /projects/ABC/issues/...  (DC)
  const dcProj = path.match(/^\/projects\/([A-Za-z][A-Za-z0-9_]*)/)
  if (dcProj) {
    out.product = 'jira'
    out.projectKey = dcProj[1].toUpperCase()
    return out
  }
  if (/^\/(jira|secure|issues)(\/|$)/i.test(path)) {
    out.product = 'jira'
    const selected = u.searchParams.get('selectedIssue')
    if (selected) out.issueKey = selected.toUpperCase()
    return out
  }

  // ---- Confluence Server / Data Center ----------------------------------
  // Las rutas heredadas no llevan /wiki delante: /pages/viewpage.action,
  // /dashboard.action, /label/... Sin esto, estando en la portada de un
  // Confluence corporativo no detectábamos nada.
  // `/pages/` sólo cuenta si va seguido de un id numérico o de una acción de
  // Confluence: `/pages/algo` en un dominio cualquiera no es nada.
  const dcConfluence =
    /^\/pages\/\d+/.test(path) ||
    /^\/pages\/[a-z]+\.action/i.test(path) ||
    /^\/(dashboard|login|index|home)\.action/i.test(path) ||
    /^\/label\//i.test(path)

  if (dcConfluence) {
    out.product = 'confluence'
    out.wikiPrefix = ''
    const byPath = path.match(/^\/pages\/(\d+)/)
    if (byPath) out.pageId = byPath[1]
    const qsPage = u.searchParams.get('pageId')
    if (qsPage && /^\d+$/.test(qsPage)) out.pageId = qsPage
    const qsSpace = u.searchParams.get('spaceKey')
    if (qsSpace) out.spaceKey = qsSpace
    return out
  }

  // Portada de un sitio cloud: sabemos el host pero no el producto.
  if (cloud) return out

  // Último recurso: el nombre del host. `confluence.empresa.com` es
  // Confluence aunque la ruta sea `/` y no nos diga nada.
  const guessed = productFromHostname(host)
  if (guessed) {
    out.product = guessed
    return out
  }

  return null
}

/**
 * Deduce el producto del nombre del host, para los despliegues propios que
 * siguen la convención habitual (`confluence.…`, `jira.…`, `wiki.…`).
 */
export function productFromHostname(host) {
  const h = String(host || '').toLowerCase()
  if (/(^|\.)confluence([.-]|$)/.test(h) || /(^|\.)wiki([.-]|$)/.test(h)) return 'confluence'
  if (/(^|\.)jira([.-]|$)/.test(h)) return 'jira'
  return null
}

/** Etiqueta corta para la cabecera del panel. */
export function describeLocation(site) {
  if (!site) return 'Sin sitio detectado'
  if (site.product === 'confluence') {
    if (site.pageId && site.spaceKey) return `Confluence · ${site.spaceKey} · página ${site.pageId}`
    if (site.spaceKey) return `Confluence · espacio ${site.spaceKey}`
    return 'Confluence'
  }
  if (site.product === 'jira') {
    if (site.issueKey) return `Jira · ${site.issueKey}`
    if (site.projectKey) return `Jira · proyecto ${site.projectKey}`
    return 'Jira'
  }
  return site.host
}

/**
 * ¿Estas dos direcciones son la misma página?
 *
 * Comparar las URLs como cadenas no vale: Confluence reescribe la suya sola
 * —añade `focusedCommentId`, normaliza el slug del título, cambia el orden de
 * los parámetros— sin que el usuario se haya movido de sitio. Lo que identifica
 * una página es su id; a falta de id, su ruta. Pura.
 */
export function samePage(a, b) {
  if (!a || !b) return false
  if (a === b) return true

  const A = parseAtlassianUrl(a)
  const B = parseAtlassianUrl(b)
  if (A && B) {
    if (A.host !== B.host) return false
    if (A.pageId || B.pageId) return A.pageId === B.pageId
    if (A.issueKey || B.issueKey) return A.issueKey === B.issueKey
  }

  // Sin identificador que comparar —o con una URL que no reconocemos— queda la
  // ruta, que es lo que cambia de verdad al navegar.
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname === ub.pathname
  } catch {
    return false
  }
}

/** Ámbito por defecto del indexador para la ubicación actual. */
export function defaultScope(site) {
  if (!site) return null
  if (site.product === 'confluence' && site.spaceKey) {
    return { kind: 'space', key: site.spaceKey, label: `el espacio ${site.spaceKey}` }
  }
  if (site.product === 'jira' && site.projectKey) {
    return { kind: 'project', key: site.projectKey, label: `el proyecto ${site.projectKey}` }
  }
  if (site.product === 'confluence') return { kind: 'confluence-site', key: '*', label: 'todo Confluence' }
  if (site.product === 'jira') return { kind: 'jira-site', key: '*', label: 'todo Jira' }
  return null
}

/** URL base del wiki, que en Cloud cuelga de /wiki y en DC no. */
export function wikiBase(site) {
  return site?.cloud ? site.origin + '/wiki' : site?.origin || ''
}

/**
 * Prefijo de Confluence: `/wiki` en Cloud, nada en Server/Data Center.
 *
 * Importa más de lo que parece. Dar por hecho `/wiki` en un Data Center genera
 * enlaces que acaban en «Page Not Found», que es exactamente lo que pasó la
 * primera vez que Faro intentó llevar a alguien a una página.
 */
export function wikiPrefix(site) {
  if (site && typeof site.wikiPrefix === 'string') return site.wikiPrefix
  return site?.cloud ? '/wiki' : ''
}

/**
 * Corrige el prefijo de una ruta de Confluence.
 *
 * El modelo devuelve rutas de memoria, y su memoria dice `/wiki/spaces/...`
 * porque asi es Cloud. En un Data Center eso es un 404. Aqui se le pone o se
 * le quita el prefijo segun lo que hayamos VISTO en el navegador.
 */
export function fixWikiPrefix(path, prefix) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path
  const bare = path.replace(/^\/wiki(?=\/)/i, '')
  if (!/^\/(spaces|display|pages|label)(\/|\?|$)/i.test(bare)) return path
  return (prefix || '') + bare
}

/**
 * Ruta canónica de una página a partir de su id.
 *
 * `viewpage.action?pageId=` funciona en Cloud y en Data Center, y no necesita
 * conocer el espacio ni el título. Es la única forma honesta de construir un
 * enlace cuando sólo tenemos el id.
 */
export function canonicalPagePath(site, pageId) {
  return `${wikiPrefix(site)}/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`
}

export function canonicalSpacePath(site, key) {
  return `${wikiPrefix(site)}/spaces/${encodeURIComponent(key)}`
}

/**
 * `~` a secas no es un espacio: es el prefijo de los espacios personales
 * (`~usuario`). Colarlo en el índice produce URLs que no existen.
 */
export function isRealSpaceKey(key) {
  const k = String(key || '').trim()
  return k.length > 0 && k !== '~' && k !== '_'
}
