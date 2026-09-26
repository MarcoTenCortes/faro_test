/**
 * La Confluence de mentira del banco: qué páginas hay, de quién cuelga cada una
 * y qué contesta a cada lectura que Faro sabe hacer contra la API del sitio.
 *
 * Por qué vive aquí y no dentro de `tools/serve-harness.js`, que es quien la
 * sirve: ese fichero abre un servidor al importarlo, así que nada de lo que
 * tuviera dentro se podía ejecutar desde una prueba de Node. Es el mismo motivo
 * por el que el evaluador de JQL vive en `jql-eval.mjs` desde H7: si el banco
 * miente —si contesta con una forma que el Confluence real no devuelve—, la
 * autocomprobación pasa en verde y el fallo aparece en el sitio del usuario.
 *
 * Lo que finge, en el orden en que Faro lo pide:
 *  - `GET /rest/api/content/<id>?expand=ancestors,space.homepage` (la cadena de
 *    antepasados de una página).
 *  - `GET /rest/api/content?spaceKey=…&expand=ancestors,space.homepage` (la
 *    LISTA, en orden ascendente de id como la de verdad: desde H14 sólo se usa
 *    para leer la portada y como camino de respaldo).
 *  - `GET /rest/api/content/search?cql=…`, que atiende tres cosas distintas: el
 *    árbol de un espacio ordenado por fecha (H14), las consultas de plantilla de
 *    H7 (lo que viste, lo tuyo, unos ids) y la búsqueda por título.
 *
 * El árbol es el mismo que pintan las dos barras laterales del banco, con una
 * portada de espacio (la 1) por encima de todo, como en el Confluence real,
 * para poder comprobar que se quita del camino.
 *
 * Desde H21 hay un SEGUNDO espacio, OPS («Operaciones», portada 5000), con un
 * árbol propio pequeño. Hace falta porque el hito es justo eso: un host con
 * varios espacios indexados, cada uno con su mapa, fundidos en un índice. Con
 * un solo espacio no se puede comprobar que el subíndice de uno no lleve páginas
 * del otro, ni que el paso a paso desde ENG hasta una página de OPS empiece por
 * «Espacio OPS». OPS vive en tablas PROPIAS (`PARENT_OPS`, `PAGE_OPS`) y no
 * dentro de `PARENT`/`PAGE`: ésas son de ENG, las pruebas y el tramo 47 cuentan
 * sus páginas con `Object.keys(PAGE).length`, y lo que ENG contesta tiene que
 * seguir siendo byte a byte lo de antes (comprobado con un script contra el
 * fichero de HEAD al cerrar H21: 128 casos). OPS sale en las tres respuestas que
 * son POR ESPACIO (la cadena de una página, la lista y el árbol por fecha); en
 * las plantillas de H7 y en la búsqueda por título NO, a propósito: no son por
 * espacio, y meter páginas nuevas ahí cambiaría lo que contestan a los tramos
 * que ya existían («Runbook*» casaría también con «Runbooks»).
 *
 * Lo público es lo que usan el servidor y las pruebas: las tablas de los dos
 * árboles, `spaceOf`, `metaDe` (para poder comprobar el orden sin copiarlo aquí)
 * y las tres respuestas. Lo demás es de dentro.
 */

/** hijo -> padre */
export const PARENT = {
  100: '1', 300: '1', 400: '1', 1080: '1',
  200: '100', 201: '100', 301: '300',
  1081: '1080', 1082: '1081', 1083: '1082', 1084: '1083', 1085: '1084', 1086: '1085',
  2001: '1081', 2002: '2001', 2003: '2002',
  3001: '1081', 3002: '3001', 3003: '3002',
}

export const PAGE = {
  1: ['Ingeniería', 'Ingenieria'],
  100: ['Arquitectura', 'Arquitectura'],
  200: ['ADR-014 Rotación de tokens de servicio', 'ADR-014'],
  201: ['ADR-015 Colas de eventos', 'ADR-015'],
  300: ['Operación', 'Operacion'],
  301: ['Runbook de guardia', 'Runbook'],
  400: ['Onboarding', 'Onboarding'],
  1080: ['1080 - Architecture', 'Architecture'],
  1081: ['1081 - D1.3.x', 'D13x'],
  1082: ['Simpl-Open Application Architecture', 'AppArch'],
  1083: ['Application Components Views', 'Components'],
  1084: ['ACV - Domain 1 - Access Control & Trust', 'ACVDomain1'],
  1085: ['ACV - Domain 1 - Static Views', 'StaticViews'],
  1086: ['ACV Static - Identity Provider Service', 'ACV+Static+-+Identity+Provider+Service'],
  2001: ['Simpl-Open Application Architecture', 'AppArch'],
  2002: ['ACV - Domain 1 - Static Views', 'ACVStatic'],
  2003: ['ACV Static - Identity Provider Service', 'ACV+Static+-+Identity+Provider+Service'],
  3001: ['Simpl-Open Technology Architecture', 'TechArch'],
  3002: ['TCV - Domain 1 - Static Views', 'TCVStatic'],
  3003: ['TCV Static - Identity Provider Service', 'TCV+Static+-+Identity+Provider+Service'],
}

/**
 * El segundo espacio (H21): hijo -> padre. La portada 5000 está por encima de
 * todo, como la 1 en ENG, para que se compruebe igual que se quita del camino.
 */
export const PARENT_OPS = {
  5001: '5000', 5010: '5000',
  5002: '5001', 5003: '5001',
  5011: '5010',
}

export const PAGE_OPS = {
  5000: ['Operaciones', 'Operaciones'],
  5001: ['Runbooks', 'Runbooks'],
  5002: ['Guardias', 'Guardias'],
  5003: ['Incidentes', 'Incidentes'],
  5010: ['Métricas', 'Metricas'],
  5011: ['SLO', 'SLO'],
}

/**
 * Los espacios que hay, cada uno con su nombre, su portada y sus dos tablas.
 * Es lo único que decide qué contesta cada respuesta por espacio: una clave que
 * no esté aquí no tiene páginas (como un espacio que no existe en el sitio).
 */
const ESPACIOS = {
  ENG: { name: 'Ingeniería', home: '1', pages: PAGE, parents: PARENT },
  OPS: { name: 'Operaciones', home: '5000', pages: PAGE_OPS, parents: PARENT_OPS },
}

/** El espacio de una clave, o null: con `Object.hasOwn`, porque la clave llega de una URL. */
function espacio(clave) {
  return typeof clave === 'string' && Object.hasOwn(ESPACIOS, clave) ? ESPACIOS[clave] : null
}

/**
 * De qué espacio es una página: 'ENG', 'OPS' o null si no existe. Con
 * `Object.hasOwn`, porque el id llega de una URL y `PAGE.constructor` existe.
 */
export function spaceOf(id) {
  const k = String(id)
  for (const [clave, e] of Object.entries(ESPACIOS)) if (Object.hasOwn(e.pages, k)) return clave
  return null
}

/**
 * Cuándo y quién tocó cada página, para las consultas que preguntan «qué ha
 * cambiado» y para ordenar el árbol del espacio. Horas hacia atrás, como la
 * fixture de incidencias: lo que se compara son ids y nombres, no instantes.
 * Las dos de OPS (H21) están para que su orden por fecha NO sea el de sus ids:
 * si lo fuera, un servidor que ordenara por id pasaría por uno que ordena por
 * fecha.
 */
const PAGE_META = {
  200: { horas: 26, quien: 'Marta Ruiz', version: 7 },
  1086: { horas: 5, quien: 'Marta Ruiz', version: 2 },
  2003: { horas: 2, quien: 'Ana Pérez', version: 3 },
  3003: { horas: 50, quien: 'Luis Gómez', version: 12 },
  5011: { horas: 3, quien: 'Luis Gómez', version: 4 },
  5002: { horas: 8, quien: 'Ana Pérez', version: 2 },
}

/** Lo que devuelve `recentlyViewedContent(N)`: lo último que «viste», en ese orden. */
const VISTAS_RECIENTES = ['2003', '3003', '200', '1086', '100']
/** Lo que devuelve la plantilla «lo tuyo» de Confluence. */
const MIAS = ['3003', '1086', '200']

export function metaDe(id) {
  return PAGE_META[id] || { horas: (Number(id) % 97) + 1, quien: 'Ana Pérez', version: 1 }
}

function cuando(horas) {
  return new Date(Date.now() - horas * 3600000).toISOString().replace('Z', '+0000')
}

/**
 * Una página con la forma de la API v1: `_links.webui` relativa a /wiki y bajo
 * SU espacio (desde H21 hay dos). Sólo se llama con ids que existen.
 */
function pageNode(id) {
  const clave = spaceOf(id)
  const [title, slug] = ESPACIOS[clave].pages[id]
  return { id: String(id), type: 'page', status: 'current', title, _links: { webui: `/spaces/${clave}/pages/${id}/${slug}` } }
}

/**
 * Los antepasados de una página, de la raíz a su padre, como los da la API.
 * Siempre dentro de su espacio: en Confluence una página no cuelga de otra de
 * otro espacio.
 */
function cadenaDe(id) {
  const padres = ESPACIOS[spaceOf(id)].parents
  const ancestors = []
  const seen = new Set()
  let cur = padres[id]
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    ancestors.unshift(pageNode(cur))
    cur = padres[cur]
  }
  return ancestors
}

/**
 * `GET /rest/api/content/<id>?expand=ancestors,space.homepage`, o null si no
 * existe. El `space` es el de la página, con SU portada (H21).
 */
export function contentWithAncestors(id) {
  const clave = spaceOf(id)
  if (!clave) return null
  const e = ESPACIOS[clave]
  return {
    ...pageNode(id),
    ancestors: cadenaDe(id),
    space: { key: clave, name: e.name, homepage: pageNode(e.home) },
  }
}

/** Una página con `version` e `history.lastUpdated`, como con `expand=version,history.lastUpdated`. */
function pageConVersion(id) {
  const clave = spaceOf(id)
  const meta = metaDe(id)
  const sello = { when: cuando(meta.horas), by: { displayName: meta.quien } }
  return {
    ...pageNode(id),
    space: { key: clave, name: ESPACIOS[clave].name },
    version: { ...sello, number: meta.version },
    history: { lastUpdated: sello },
  }
}

/** Todas las páginas de un espacio, de la más recientemente modificada a la más vieja. */
function porFecha(e) {
  return Object.keys(e.pages)
    .map(String)
    .sort((a, b) => metaDe(a).horas - metaDe(b).horas || Number(a) - Number(b))
}

function entero(v, minimo, maximo, porDefecto) {
  const n = Number(v)
  return Number.isInteger(n) && n >= minimo && n <= maximo ? n : porDefecto
}

/**
 * `GET /rest/api/content?spaceKey=ENG&type=page&expand=ancestors,space.homepage`:
 * la LISTA, paginada como la pagina Confluence (`size` y `_links.next`) y en
 * ORDEN ASCENDENTE DE ID, que es justo lo que la hace inservible como árbol en
 * un espacio grande (H14, F8): las que entran son las más viejas. De cualquier
 * espacio de `ESPACIOS` (H21), cada página con SU `space.homepage`; de uno que
 * no exista, una lista vacía como antes.
 */
export function spaceContent({ spaceKey, start, limit } = {}) {
  const e = espacio(spaceKey)
  if (!e) return { results: [], start: 0, limit: 0, size: 0 }
  const todas = Object.keys(e.pages).map(Number).sort((a, b) => a - b).map(String)
  const desde = Math.max(0, entero(start, 0, 100000, 0))
  const cuantas = entero(limit, 1, 200, 25)
  const trozo = todas.slice(desde, desde + cuantas)
  const body = {
    results: trozo.map((id) => contentWithAncestors(id)),
    start: desde,
    limit: cuantas,
    size: trozo.length,
    _links: { base: '/wiki', context: '' },
  }
  if (desde + trozo.length < todas.length) {
    body._links.next = `/rest/api/content?spaceKey=${spaceKey}&type=page&start=${desde + trozo.length}&limit=${cuantas}`
  }
  return body
}

/**
 * El árbol de un espacio por `/rest/api/content/search`, LAS MÁS RECIENTES
 * PRIMERO y con la cadena de antepasados de cada una (H14). null si el CQL no
 * es el de esa plantilla, para que el servidor siga probando las demás.
 *
 * La respuesta lleva `totalSize`, que es lo que permite decir «N de TOTAL», y no
 * lleva `space` en cada resultado: con `expand=ancestors` el Confluence real no
 * lo expande, y el cliente sabe de qué espacio es porque es el que pidió. Desde
 * H21 contesta de cualquier espacio de `ESPACIOS`: `totalSize` es el de ESE
 * espacio, y las cadenas de sus páginas no salen de él.
 */
function searchBySpace(cql, { start, limit } = {}) {
  const m = /^type = page AND space = "([^"]*)" ORDER BY lastmodified DESC$/.exec(String(cql))
  if (!m) return null
  const e = espacio(m[1])
  const todas = e ? porFecha(e) : []
  const desde = Math.max(0, entero(start, 0, 100000, 0))
  const cuantas = entero(limit, 1, 200, 25)
  const trozo = todas.slice(desde, desde + cuantas)
  const body = {
    results: trozo.map((id) => ({ ...pageNode(id), ancestors: cadenaDe(id) })),
    start: desde,
    limit: cuantas,
    size: trozo.length,
    totalSize: todas.length,
    _links: { base: '/wiki', context: '' },
  }
  if (desde + trozo.length < todas.length) {
    body._links.next = `/rest/api/content/search?cql=${encodeURIComponent(m[0])}&start=${desde + trozo.length}&limit=${cuantas}`
  }
  return body
}

/**
 * Las tres CQL de PLANTILLA de H7 (lo que viste, lo tuyo, unos ids sueltos).
 * null si no es ninguna de ellas. Sólo de ENG (`PAGE`) a propósito: no son por
 * espacio, y contestar también con OPS cambiaría lo que ya contestaban a los
 * tramos de H7 y H11 (H21).
 */
function searchByTemplate(cql, limit) {
  const q = String(cql)
  const n = Math.min(30, Math.max(1, Number(limit) || 30))
  let ids = null
  const vistas = /^type = page AND id in recentlyViewedContent\((\d{1,3})\)$/.exec(q)
  if (vistas) ids = VISTAS_RECIENTES.slice(0, Number(vistas[1]))
  else if (/^type = page AND \(contributor = currentUser\(\)/.test(q)) ids = MIAS
  else {
    const sueltos = /^type = page AND id in \(([\d,]+)\)$/.exec(q)
    if (sueltos) ids = sueltos[1].split(',')
  }
  if (!ids) return null
  const results = ids.filter((id) => PAGE[id]).slice(0, n).map(pageConVersion)
  return { results, start: 0, limit: n, size: results.length }
}

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')
function fold(s) {
  return String(s).normalize('NFD').replace(DIACRITICS, '').toLowerCase()
}

/**
 * La búsqueda por título, como busca CQL de verdad, para que la autocomprobación
 * detecte que sin comodín no hay prefijo: cada `title~"…"` es un término; sin
 * `*` tiene que coincidir con una palabra ENTERA del título (sin mayúsculas ni
 * acentos) y con `*` al final, con el principio de una palabra. Todos los
 * términos tienen que cumplirse. Sólo busca en ENG, por lo mismo que las
 * plantillas: con OPS dentro, «Runbook*» casaría también con «Runbooks» (H21).
 */
function searchByTitle(cql, limit) {
  const terms = [...String(cql).matchAll(/title~"([^"]*)"/g)].map((m) => m[1]).filter(Boolean)
  const n = Math.min(20, Math.max(1, Number(limit) || 8))
  const hits = Object.keys(PAGE)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((id) => {
      const words = fold(PAGE[id][0]).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      return (
        terms.length > 0 &&
        terms.every((t) => {
          const prefijo = t.endsWith('*')
          const term = fold(prefijo ? t.slice(0, -1) : t)
          return term.length > 0 && words.some((w) => (prefijo ? w.startsWith(term) : w === term))
        })
      )
    })
  const results = hits.slice(0, n).map((id) => ({ ...pageNode(id), space: { key: 'ENG', name: 'Ingeniería' } }))
  return { results, start: 0, limit: n, size: results.length }
}

/**
 * Todo lo que contesta `GET /rest/api/content/search?cql=…`: primero el árbol
 * del espacio, luego las plantillas de H7 y, si no es ninguna, la búsqueda por
 * título. El orden importa: son consultas distintas que entran por la misma
 * ruta, y la del espacio es la única que pagina.
 */
export function contentSearch(cql, { start, limit } = {}) {
  return searchBySpace(cql, { start, limit }) || searchByTemplate(cql, limit) || searchByTitle(cql, limit)
}
