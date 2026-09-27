/**
 * Detección de sitio, producto y ubicación a partir de la URL.
 * Funciones puras: es lo que hace que la extensión sepa «dónde estás»
 * sin tocar el DOM, y lo que permite probarlo sin navegador.
 */

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
  //
  // La clave del espacio entra en la segunda línea del prompt del sistema,
  // antes de las reglas de seguridad, como palabra de Faro: sólo vale con la
  // forma de una clave (`validSpaceKey`), igual que `issueKey`/`projectKey`.
  // Y se decodifica con `safeDecode`: un «%» mal codificado —el modelo copia
  // mal una URL, el usuario la pega, la pestaña la lleva— lanzaba `URIError`
  // y tumbaba el turno entero (auditoría del 2026-09-13, docs/PLAN.md §2, S2
  // y R2).
  const conf =
    path.match(/\/wiki\/spaces\/([^/]+)(?:\/pages\/(\d+))?/i) ||
    path.match(/^\/spaces\/([^/]+)(?:\/pages\/(\d+))?/i)
  if (conf) {
    out.product = 'confluence'
    // El prefijo se OBSERVA, no se adivina: hay Confluence Cloud con dominio
    // propio (sin .atlassian.net) y Data Center en la raiz. Lo unico fiable es
    // la URL que el usuario tiene delante.
    out.wikiPrefix = /^\/wiki\//i.test(path) ? '/wiki' : ''
    const espacio = validSpaceKey(safeDecode(conf[1]))
    if (espacio) out.spaceKey = espacio
    if (conf[2]) out.pageId = conf[2]
    return out
  }
  const display = path.match(/^\/display\/([^/]+)/i)
  if (display) {
    out.product = 'confluence'
    out.wikiPrefix = ''
    const espacio = validSpaceKey(safeDecode(display[1]))
    if (espacio) out.spaceKey = espacio
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
    const qsSpace = validSpaceKey(u.searchParams.get('spaceKey'))
    if (qsSpace) out.spaceKey = qsSpace
    return out
  }

  // ---- Jira -------------------------------------------------------------
  // Las claves entran en el prompt del sistema como palabras de Faro: sólo
  // valen con la forma de una clave. Un `?selectedIssue=` o un proyecto con
  // cualquier otra cosa (un enlace de una página de Confluence puede llevar lo
  // que quiera) se descarta, no se sube a mayúsculas.
  const claveDeConsulta = validIssueKey(u.searchParams.get('selectedIssue'))
  // Un Jira Data Center puede servirse desde una ruta de contexto
  // (`/jira/browse/ENG-7`). Sin esto, ahí no se reconocía ni la incidencia
  // abierta ni el proyecto, y la extensión creía estar en «Jira» a secas
  // (docs/PLAN.md §4, fila H7). `jiraPrefix` sale en el sitio para que el panel
  // lo observe, como `wikiPrefix` en Confluence.
  const ctx = jiraContextPath(path)
  const jiraPath = ctx ? path.slice(ctx.length) : path
  // /browse/ABC-123  |  <ctx>/browse/ABC-123
  const browse = jiraPath.match(/^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/)
  if (browse) {
    out.product = 'jira'
    out.jiraPrefix = ctx
    const clave = validIssueKey(browse[1])
    if (clave) {
      out.issueKey = clave
      out.projectKey = clave.split('-')[0]
    }
    return out
  }
  // /jira/software/projects/ABC/boards/1  |  /jira/core/projects/ABC/...
  // Es la forma de Cloud, que no tiene ruta de contexto: se mira la ruta entera.
  const proj = path.match(/\/jira\/[^/]+\/projects\/([^/]+)/i)
  if (proj) {
    out.product = 'jira'
    out.jiraPrefix = ctx
    const proyecto = validProjectKey(safeDecode(proj[1]))
    if (proyecto) out.projectKey = proyecto
    const board = path.match(/\/boards\/(\d+)/)
    if (board) out.boardId = board[1]
    if (claveDeConsulta) out.issueKey = claveDeConsulta
    return out
  }
  // /projects/ABC/issues/ABC-7  |  /projects/ABC/summary  |  <ctx>/projects/… (DC)
  const dcProj = jiraPath.match(/^\/projects\/([A-Za-z][A-Za-z0-9_]*)(?:\/issues\/([A-Za-z][A-Za-z0-9_]*-\d+))?/)
  if (dcProj) {
    out.product = 'jira'
    out.jiraPrefix = ctx
    const proyecto = validProjectKey(dcProj[1])
    if (proyecto) out.projectKey = proyecto
    const clave = validIssueKey(dcProj[2]) || claveDeConsulta
    if (clave) out.issueKey = clave
    return out
  }
  if (/^\/(jira|secure|issues)(\/|$)/i.test(path)) {
    out.product = 'jira'
    out.jiraPrefix = ctx
    if (claveDeConsulta) out.issueKey = claveDeConsulta
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
    const qsSpace = validSpaceKey(u.searchParams.get('spaceKey'))
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
 * Un segmento de ruta de contexto. Letras, cifras, `_`, `~` y `-`: NI puntos
 * (así que ni «.» ni «..» pasan, y `/index.html/browse/X-1` tampoco) ni `%`
 * (nada codificado), ni barras (por eso es UN segmento y no dos). El nombre de
 * un contexto de servlet es una palabra: `/jira`, `/jira-dc`.
 */
const CTX_SEGMENT = /^[A-Za-z0-9_~-]{1,40}$/

/**
 * Las rutas de primer nivel de un Jira. Si una de ellas va DETRÁS de un
 * segmento, ese segmento es la ruta de contexto y no parte de la ruta.
 */
const JIRA_ROUTES = /^\/(browse|projects|issues|secure|rest|plugins)(\/|$)/i

/**
 * ¿Esta ruta es de las que sirve Jira? Pura.
 *
 * La misma lista con la que se reconoce una ruta de contexto, detrás de una
 * función para que no haya que copiarla (§9). La pide `page-links.js`: un
 * enlace del contenido de una incidencia a `/browse/…`, `/secure/…` o
 * `/rest/…` del propio sitio no es una página que nadie haya elegido —lo pone
 * Jira en todas—, y en una épica real esos enlaces se comían el tope de
 * enlaces que se leen antes de llegar a los comentarios.
 *
 * Es la ruta SIN la de contexto: quien la tenga se la quita antes
 * (`jiraContextPath`), como hace `jira-rest.js` para montar la suya.
 */
export function isJiraRoute(pathname) {
  return JIRA_ROUTES.test(String(pathname || ''))
}

/**
 * La ruta de contexto de un Jira Data Center, deducida de la URL de la pestaña:
 * `''` o UN segmento («/jira»). Pura.
 *
 * Un Data Center puede vivir bajo una ruta de contexto, y entonces TODO cuelga
 * de ella: la incidencia (`/jira/browse/ENG-7`) y también su API
 * (`/jira/rest/api/2/search`). Pedir la API sin el prefijo es un 404 en
 * silencio, que es lo que motiva esta función (docs/plan/anexo-C, «Riesgos»);
 * plausible, no observado: el Jira del usuario se sirve en la raíz (CLAUDE.md
 * §12, PASO 0), así que aquí devuelve ''.
 *
 * Se deduce igual que `resolveWikiPrefix` deduce el de Confluence: de lo que se
 * VE en el navegador, nunca de lo que diga el modelo. Y sólo un segmento: con
 * `/x/y/browse/K-1` devuelve '', porque dos segmentos no son una ruta de
 * contexto de Jira y adivinar cuál es el prefijo sería inventar.
 *
 * El caso ambiguo se resuelve a favor de no inventar: `/jira` a secas puede ser
 * el contexto de un DC o la ruta de Cloud, y sin nada detrás que lo diga
 * devuelve '' (la degradación de `searchIssues` ante un 404 va en la otra
 * dirección: del prefijo a la raíz).
 */
export function jiraContextPath(pathname) {
  const p = String(pathname || '')
  if (!p.startsWith('/')) return ''
  const corte = p.indexOf('/', 1)
  if (corte < 0) return ''
  const seg = p.slice(1, corte)
  if (!CTX_SEGMENT.test(seg)) return ''
  return JIRA_ROUTES.test(p.slice(corte)) ? '/' + seg : ''
}

/** Una clave de incidencia con forma de clave («ABC-123»), en mayúsculas, o ''. Pura. */
export function validIssueKey(value) {
  const k = String(value || '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/.test(k) ? k : ''
}

/** Una clave de proyecto con forma de clave («ABC»), en mayúsculas, o ''. Pura. */
export function validProjectKey(value) {
  const k = String(value || '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,19}$/.test(k) ? k : ''
}

/**
 * Una clave de espacio con forma de clave («ENG», «~ana»), tal cual, o ''. Pura.
 *
 * Confluence sólo admite letras, cifras y unos pocos signos, y los espacios
 * personales llevan «~» delante. Todo lo demás —un salto de línea, un espacio,
 * un «%» suelto, trescientos caracteres— no es una clave: sale de la URL de la
 * pestaña, que puede haber puesto un enlace de una página o de un correo, y
 * acaba en la cabecera del prompt del sistema como palabra de Faro (auditoría
 * del 2026-09-13, docs/PLAN.md §2, S2). Complementa a `isRealSpaceKey`, que
 * sólo descarta «~» y «_» a secas: aquí se exige además la forma.
 */
export function validSpaceKey(value) {
  const k = String(value || '').trim()
  return /^~?[A-Za-z0-9_.@:-]{1,255}$/.test(k) && isRealSpaceKey(k) ? k : ''
}

/** Decodifica lo que puede: un «%» mal codificado devuelve el texto tal cual, nunca lanza. Pura. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return String(s || '')
  }
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
 * Cuánto cabe en el chip de la cabecera.
 *
 * El título de una pestaña lo escribe el sitio —y en Confluence, quien creara la
 * página—, así que entra acotado y en una línea, como todo lo que viene de
 * fuera: un título de mil caracteres con un salto dentro rompía la cabecera en
 * dos filas y empujaba los botones.
 */
export const LOCATION_LIMITS = { key: 40, title: 120 }

/**
 * Lo que abre línea, para colapsarlo en un espacio.
 *
 * `\s` de JavaScript cubre U+2028 (separador de línea) y U+2029 (de párrafo),
 * pero NO el NEL (U+0085), que también abre línea: va nombrado aparte y CON
 * ESCAPE, igual que en prompts.js (revisión adversaria de H2, 2026-09-14).
 * Escrito crudo dentro de la clase —como estuvo hasta la revisión adversaria de
 * H5— la regex llevaba dentro un carácter invisible: no se podía leer ni
 * revisar, y cualquier editor que «limpie» el fichero se la lleva sin que se
 * note.
 */
const ESPACIOS = new RegExp('[\\s\\u0085]+', 'g')

/**
 * Lo que no es texto y no se ve. Se BORRA, no se colapsa: los controles C0 que
 * no son espacio ni salto (U+0000-U+0008 y U+000E-U+001F; el tabulador, el
 * salto, la tabulación vertical, el avance de página y el retorno se quedan
 * para que los colapse `ESPACIOS`), el DEL (U+007F), el espacio de ancho cero
 * y las marcas de dirección (U+200B-U+200F), los embebidos y el OVERRIDE bidi
 * (U+202A-U+202E), los unidores invisibles (U+2060-U+2064), los aislantes
 * (U+2066-U+2069) y el BOM (U+FEFF).
 *
 * El título de una pestaña lo escribe quien creó la página, y de aquí sale al
 * chip de la cabecera, a su `title` y a la línea «Título de la pestaña: …»
 * del prompt. Con un U+202E (RLO) dentro, lo que sigue se LEE AL REVÉS: el chip
 * dice estar en una página que no es la que se tiene delante, y ni el usuario ni
 * el modelo tienen forma de notarlo. Un ESC o un SOH tampoco se ven y ensucian
 * el tooltip (revisión adversaria de H5, 2026-09-19). Se borran ANTES de
 * colapsar: al revés, un invisible entre dos espacios dejaría dos espacios
 * seguidos.
 */
const INVISIBLES = new RegExp(
  '[\\u0000-\\u0008\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]',
  'g'
)

/**
 * El texto sin esos caracteres. Se exporta para que la línea «Título de la
 * pestaña: …» de `currentPageBlock` (prompts.js) no copie la regex: una lista
 * de caracteres prohibidos repartida en dos sitios es una lista que se queda a
 * medias en cuanto alguien añade uno. Pura.
 */
export function sinInvisibles(text) {
  return String(text ?? '').replace(INVISIBLES, '')
}

/**
 * Una línea, sin invisibles y sin espacios en los bordes. Pura.
 *
 * Se exporta desde H24 para las etiquetas de un diagrama (diagram-parse.js):
 * lo que escribe el modelo dentro de un nodo acaba en el SVG del chat, y un
 * RLO o un NEL ahí hacen lo mismo que en el chip de la cabecera. Una tercera
 * copia de `ESPACIOS` sería una lista que se queda a medias el día que alguien
 * añada un carácter a ésta.
 */
export function unaLinea(text) {
  return sinInvisibles(text).replace(ESPACIOS, ' ').trim()
}

/**
 * El «- Jira» / «- Confluence» con el que el producto firma el título de la
 * pestaña. Las regex son las de `baseSystem` tal cual (`\s+-\s+`), aunque sobre
 * un texto ya colapsado a una línea bastaría un espacio: lo que se extrajo aquí
 * tiene que seguir dando el mismo prompt byte a byte.
 */
const TAB_SUFFIX = {
  jira: /\s+-\s+Jira$/i,
  confluence: /\s+-\s+Confluence$/i,
  any: /\s+-\s+(?:Jira|Confluence)$/i,
}

/**
 * El título de la pestaña, limpio: en una línea, sin la clave que Jira le pone
 * delante («[SIMPL-12] Consent API v2 - Jira») ni el nombre del producto que va
 * detrás, y con tope.
 *
 * Vivía dentro de `baseSystem` (prompts.js), que lo necesita para saber cómo se
 * llama la incidencia abierta: ahí está el prefijo de convención («[API
 * Definition] - …») con el que `issueFamily` decide de qué familia es. Desde H5
 * lo necesita también la cabecera del panel, que enseña dónde estás, así que la
 * limpieza vive aquí una sola vez y las dos la llaman. El sufijo se quita por
 * PRODUCTO: en un sitio de Jira sólo «- Jira», en uno de Confluence sólo
 * «- Confluence», y sin saber el producto cualquiera de los dos. Pura.
 */
export function cleanTabTitle(title, site = null) {
  const sinClave = unaLinea(title).replace(/^\[[A-Z][A-Z0-9_]*-\d+\]\s*/, '')
  const sufijo = TAB_SUFFIX[site?.product] || TAB_SUFFIX.any
  return sinClave.replace(sufijo, '').trim().slice(0, LOCATION_LIMITS.title)
}

/**
 * Dónde estás, en las dos piezas que pinta el chip de la cabecera: la CLAVE
 * (lo MÁS CORTO que identifica el sitio: «SIMPL-1234», «ENG») y el TÍTULO de
 * la pestaña, que es lo que cede con elipsis cuando el panel se estrecha
 * (docs/PLAN.md §2.5 A6: el chip cede, la Skill no).
 *
 * La clave se RECONSTRUYE con las validadoras en vez de copiarse: `site` suele
 * venir de `parseAtlassianUrl`, que ya valida, pero también puede salir de un
 * registro guardado hace meses o editado a mano, y lo que la cabecera pinta
 * tiene que ser una línea acotada igual que lo que va a un prompt. Fuera de
 * Atlassian no se enseña el título de la pestaña: el correo de alguien no es
 * asunto de Faro. Pura.
 *
 * @returns {{key:string, title:string}}
 */
export function locationParts(site, tabTitle = '') {
  if (!site) return { key: '', title: 'Fuera de Atlassian' }
  const title = cleanTabTitle(tabTitle, site)

  // La clave es lo MÁS CORTO que identifica el sitio, sin el nombre del producto
  // delante: a 320 px con cinco botones al chip le quedan ~80 px, y «Confluence ·
  // ENG» (87 px) no cabía ni sola —se cortaba en seco y el título desaparecía—,
  // mientras que «ENG» o «SIMPL-1234» sí. El producto ya lo dice la página que
  // se tiene delante, y la ubicación entera (producto, espacio, id de página)
  // sigue en el `title` del chip, que pinta `describeLocation`.
  let key = ''
  if (site.product === 'confluence') {
    key = validSpaceKey(site.spaceKey) || 'Confluence'
  } else if (site.product === 'jira') {
    key = validIssueKey(site.issueKey) || validProjectKey(site.projectKey) || 'Jira'
  } else {
    key = unaLinea(site.host)
  }

  return { key: key.slice(0, LOCATION_LIMITS.key), title }
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
