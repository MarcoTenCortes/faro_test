/**
 * Servidor estático para el banco de pruebas.
 *
 * Hace falta porque los módulos ES no se cargan desde file://, y porque el
 * banco navega con pushState a rutas como /wiki/spaces/ENG/pages/200/... que
 * tienen que devolver el index.
 *
 *   node tools/serve-harness.js [puerto]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, extname, normalize, sep } from 'node:path'
import { searchResponse } from './jql-eval.mjs'

const ROOT = join(import.meta.dirname, '..')
const PORT = Number(process.argv[2] || 5175)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// ------------------------------------------- la API REST de la Confluence falsa
//
// Lo que Faro lee de ella: los antepasados de una página, la búsqueda por
// título, las consultas de plantilla (lo que viste, lo tuyo, unos ids) y el
// árbol entero de un espacio paginado. Es el mismo árbol que pintan las dos
// barras laterales del banco, con una portada de espacio (la 1) por encima de
// todo, como en el Confluence real, para poder comprobar que se quita del
// camino.

/** hijo -> padre */
const PARENT = {
  100: '1', 300: '1', 400: '1', 1080: '1',
  200: '100', 201: '100', 301: '300',
  1081: '1080', 1082: '1081', 1083: '1082', 1084: '1083', 1085: '1084', 1086: '1085',
  2001: '1081', 2002: '2001', 2003: '2002',
  3001: '1081', 3002: '3001', 3003: '3002',
}

const PAGE = {
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

/** Una página con la forma de la API v1: `_links.webui` relativa a /wiki. */
function pageNode(id) {
  const [title, slug] = PAGE[id]
  return { id: String(id), type: 'page', status: 'current', title, _links: { webui: `/spaces/ENG/pages/${id}/${slug}` } }
}

/** `GET /rest/api/content/<id>?expand=ancestors,space.homepage`, o null si no existe. */
function contentWithAncestors(id) {
  if (!PAGE[id]) return null
  const ancestors = []
  const seen = new Set()
  let cur = PARENT[id]
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    ancestors.unshift(pageNode(cur))
    cur = PARENT[cur]
  }
  return {
    ...pageNode(id),
    ancestors,
    space: { key: 'ENG', name: 'Ingeniería', homepage: pageNode(1) },
  }
}

/**
 * `GET /wiki/rest/api/content/search?cql=…`, como busca CQL de verdad, para
 * que la autocomprobación detecte que sin comodín no hay prefijo: cada
 * `title~"…"` es un término; sin `*` tiene que coincidir con una palabra ENTERA
 * del título (sin mayúsculas ni acentos) y con `*` al final, con el principio
 * de una palabra. Todos los términos tienen que cumplirse.
 */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')
function fold(s) {
  return String(s).normalize('NFD').replace(DIACRITICS, '').toLowerCase()
}

/**
 * Cuándo y quién tocó cada página, para las consultas de plantilla que preguntan
 * «qué ha cambiado». Horas hacia atrás, como la fixture de incidencias: lo que
 * se compara son ids y nombres, no instantes.
 */
const PAGE_META = {
  200: { horas: 26, quien: 'Marta Ruiz', version: 7 },
  1086: { horas: 5, quien: 'Marta Ruiz', version: 2 },
  2003: { horas: 2, quien: 'Ana Pérez', version: 3 },
  3003: { horas: 50, quien: 'Luis Gómez', version: 12 },
}

/** Lo que devuelve `recentlyViewedContent(N)`: lo último que «viste», en ese orden. */
const VISTAS_RECIENTES = ['2003', '3003', '200', '1086', '100']
/** Lo que devuelve la plantilla «lo tuyo» de Confluence. */
const MIAS = ['3003', '1086', '200']

function metaDe(id) {
  return PAGE_META[id] || { horas: (Number(id) % 97) + 1, quien: 'Ana Pérez', version: 1 }
}

function cuando(horas) {
  return new Date(Date.now() - horas * 3600000).toISOString().replace('Z', '+0000')
}

/** Una página con `version` e `history.lastUpdated`, como cuando se pide `expand=version,history.lastUpdated`. */
function pageConVersion(id) {
  const meta = metaDe(id)
  const sello = { when: cuando(meta.horas), by: { displayName: meta.quien } }
  return {
    ...pageNode(id),
    space: { key: 'ENG', name: 'Ingeniería' },
    version: { ...sello, number: meta.version },
    history: { lastUpdated: sello },
  }
}

/**
 * Las tres CQL de PLANTILLA que `confluence-rest.js` sabe escribir (lo que
 * viste, lo tuyo, unos ids sueltos). Se miran ANTES que `title~`, y cualquier
 * otra cosa sigue por la búsqueda por título de siempre. null si no es una
 * plantilla.
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

/**
 * `GET /rest/api/content?spaceKey=ENG&type=page&expand=ancestors,space.homepage&start&limit`:
 * el árbol entero del espacio, paginado como lo pagina Confluence (`size` y
 * `_links.next`), con la cadena de antepasados de cada página dentro de la LISTA.
 */
function spaceContent(url) {
  if (url.searchParams.get('spaceKey') !== 'ENG') return { results: [], start: 0, limit: 0, size: 0 }
  const todas = Object.keys(PAGE).map(Number).sort((a, b) => a - b).map(String)
  const start = Math.max(0, Number(url.searchParams.get('start')) || 0)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 25))
  const trozo = todas.slice(start, start + limit)
  const quedan = start + trozo.length < todas.length
  // `contentWithAncestors` ya trae la cadena de antepasados y el `space` con su
  // portada: es lo mismo que Confluence devuelve en la LISTA cuando se le pide
  // `expand=ancestors,space.homepage`.
  const body = {
    results: trozo.map((id) => contentWithAncestors(id)),
    start,
    limit,
    size: trozo.length,
    _links: { base: '/wiki', context: '' },
  }
  if (quedan) body._links.next = `/rest/api/content?spaceKey=ENG&type=page&start=${start + trozo.length}&limit=${limit}`
  return body
}

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

// ------------------------------------------------- la API REST de la Jira falsa
//
// Lo que Faro lee de Jira desde H7: una consulta JQL ejecutada con la sesión
// (`/rest/api/2/search`), los filtros favoritos del usuario y los enlaces
// remotos de una incidencia. Las incidencias salen de harness/issues.json y el
// filtrado lo hace el mini-evaluador de tools/jql-eval.mjs, que contesta 400 con
// `errorMessages` a lo que no entiende, como el Jira real.

const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'harness', 'issues.json'), 'utf8'))

/**
 * Las «rutas de contexto» de mentira con las que el banco prueba las dos
 * degradaciones de `searchIssues` sin poder tocar ni la URL ni las cabeceras que
 * monta `getJson`: lo único que el que llama elige es el prefijo.
 *  · `/sinsesion` → 401 en cualquier ruta de API (sesión que no vale).
 *  · `/sinvista`  → 400 a la consulta que mencione `lastViewed`, como una
 *    instancia que no tiene ese campo; sin esa mención contesta bien, que es lo
 *    que permite ver la degradación completa.
 * Cualquier OTRO segmento delante de `/rest/api/` es un 404: es la ruta de
 * contexto equivocada, y con ella se prueba el reintento en la raíz.
 */
const MODOS = new Set(['sinsesion', 'sinvista'])

/** `{modo, resto}` con `resto` empezando en `/rest/api/…`, o null si no es API. */
function rutaDeApi(path) {
  let resto = path
  let modo = ''
  let wiki = false
  for (let i = 0; i < 2; i++) {
    const m = /^\/([^/]+)(\/.*)$/.exec(resto)
    if (!m) break
    const seg = m[1].toLowerCase()
    if (!modo && MODOS.has(seg)) {
      modo = seg
      resto = m[2]
      continue
    }
    if (!wiki && seg === 'wiki') {
      wiki = true
      resto = m[2]
      continue
    }
    break
  }
  return resto.startsWith('/rest/api/') ? { modo, resto } : null
}

/** Los enlaces remotos de una incidencia, con la URL de la página resuelta contra este servidor. */
function remoteLinks(key, host) {
  const base = `http://${host}`
  return (FIXTURE.remoteLinks?.[key] || []).map((l) => ({
    ...l,
    object: { ...l.object, url: l.object.url === 'PAGINA_200' ? `${base}/wiki/spaces/ENG/pages/200/ADR-014` : l.object.url },
  }))
}

/** Contesta una ruta de API, o null si esa ruta no existe aquí. */
function contestarApi({ modo, resto }, url, req) {
  if (modo === 'sinsesion') {
    return { status: 401, body: { errorMessages: ['Client must be authenticated to access this resource.'], errors: {} } }
  }

  if (resto === '/rest/api/2/search') {
    const jql = url.searchParams.get('jql') || ''
    if (modo === 'sinvista' && /lastviewed/i.test(jql)) {
      return {
        status: 400,
        body: { errorMessages: ["Field 'lastViewed' does not exist or you do not have permission to view it."], errors: {} },
      }
    }
    return searchResponse(FIXTURE, {
      jql,
      fields: url.searchParams.get('fields'),
      maxResults: url.searchParams.get('maxResults'),
      startAt: url.searchParams.get('startAt'),
    })
  }

  if (resto === '/rest/api/2/filter/favourite') {
    return { status: 200, body: (FIXTURE.filters || []).map((f) => ({ ...f, favourite: true, self: `http://${req.headers.host}${resto}` })) }
  }

  const remoto = /^\/rest\/api\/2\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)\/remotelink$/.exec(resto)
  if (remoto) {
    const key = remoto[1].toUpperCase()
    if (!(FIXTURE.issues || []).some((x) => x.key === key)) {
      return { status: 404, body: { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} } }
    }
    return { status: 200, body: remoteLinks(key, req.headers.host) }
  }

  if (resto === '/rest/api/content/search') {
    const cql = url.searchParams.get('cql') || ''
    const limit = url.searchParams.get('limit')
    return { status: 200, body: searchByTemplate(cql, limit) || searchByTitle(cql, limit) }
  }

  if (resto === '/rest/api/content') {
    return { status: 200, body: spaceContent(url) }
  }

  const contenido = /^\/rest\/api\/content\/(\d+)$/.exec(resto)
  if (contenido) {
    const body = contentWithAncestors(contenido[1])
    return body
      ? { status: 200, body }
      : { status: 404, body: { statusCode: 404, message: 'No content found with id: ' + contenido[1] } }
  }

  return null
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let path = decodeURIComponent(url.pathname)

  const api = rutaDeApi(path)
  const respuesta = api ? contestarApi(api, url, req) : null
  if (respuesta) {
    res.writeHead(respuesta.status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(respuesta.body))
    return
  }
  // Una ruta de API que este servidor no sirve —o colgada de un prefijo que no
  // es suyo, que es la ruta de contexto equivocada— contesta como Jira: 404 con
  // cuerpo, no la página de «no encontrado» del servidor de ficheros.
  if (api || /\/rest\/api\//.test(path)) {
    res.writeHead(404, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ errorMessages: ['No existe esa ruta de contexto en este banco de pruebas'], errors: {} }))
    return
  }

  if (path === '/') path = '/harness/index.html'
  // Las rutas de la Confluence simulada devuelven el index: es una SPA.
  if (path.startsWith('/wiki/')) path = '/harness/index.html'
  if (path.startsWith('/browse/')) path = '/harness/index.html'
  // Los recursos del banco se piden relativos a él, y en una ruta profunda de
  // la Confluence simulada eso es `/wiki/spaces/.../harness.js`. Sin esto, al
  // entrar por un enlace directo se le servía el index como si fuera el script.
  if (/\/harness\.(js|css)$/.test(path)) path = '/harness/' + path.split('/').pop()

  const target = normalize(join(ROOT, path))
  if (!target.startsWith(ROOT + sep)) {
    res.writeHead(403).end('fuera del proyecto')
    return
  }

  try {
    const info = await stat(target)
    if (info.isDirectory()) throw new Error('es un directorio')
    const body = await readFile(target)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('no encontrado: ' + path)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`banco de pruebas en http://127.0.0.1:${PORT}/`)
})
