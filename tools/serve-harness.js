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
import { contentSearch, contentWithAncestors, spaceContent } from './cql-eval.mjs'

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
// árbol de un espacio. Todo eso vive en tools/cql-eval.mjs, que SÍ se puede
// importar desde una prueba de Node; aquí sólo se enchufa a su ruta, porque
// este fichero abre un servidor al importarlo y nada de lo que tuviera dentro
// se podría ejecutar sin levantarlo (H14, el mismo motivo que jql-eval.mjs).

// ------------------------------------------------- la API REST de la Jira falsa
//
// Lo que Faro lee de Jira desde H7: una consulta JQL ejecutada con la sesión
// (`/rest/api/2/search`), los filtros favoritos del usuario y los enlaces
// remotos de una incidencia. Las incidencias salen de harness/issues.json y el
// filtrado lo hace el mini-evaluador de tools/jql-eval.mjs, que contesta 400 con
// `errorMessages` a lo que no entiende, como el Jira real.
//
// Desde H14 contesta también con el ID de cada tipo, estado y prioridad y con el
// nombre TRADUCIDO que ve el usuario (el `catalog` de la fixture), y rechaza con
// un 400 la consulta que pregunte por ese nombre traducido: es lo que hace el Jira
// del usuario, y lo que obliga a que los chips pregunten por id.

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

/**
 * Los enlaces remotos de una incidencia, con la URL de la página resuelta contra
 * este servidor. `PAGINA_<id>` se convierte en la dirección que devuelve un Jira
 * Data Center de verdad (H14, observado): `/pages/viewpage.action?pageId=<id>`,
 * sin el título por ninguna parte. Va por id y no por una URL escrita aquí para
 * que cambiar a qué página apunta la fixture no obligue a tocar el servidor.
 */
function remoteLinks(key, host) {
  const base = `http://${host}`
  return (FIXTURE.remoteLinks?.[key] || []).map((l) => {
    const m = /^PAGINA_(\d+)$/.exec(String(l.object?.url || ''))
    return { ...l, object: { ...l.object, url: m ? `${base}/wiki/pages/viewpage.action?pageId=${m[1]}` : l.object.url } }
  })
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
    return {
      status: 200,
      body: contentSearch(cql, { start: url.searchParams.get('start'), limit: url.searchParams.get('limit') }),
    }
  }

  if (resto === '/rest/api/content') {
    return {
      status: 200,
      body: spaceContent({
        spaceKey: url.searchParams.get('spaceKey'),
        start: url.searchParams.get('start'),
        limit: url.searchParams.get('limit'),
      }),
    }
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
