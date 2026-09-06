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
import { join, extname, normalize, sep } from 'node:path'

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
// Sólo lo que Faro lee de ella: los antepasados de una página. Es el mismo
// árbol que pintan las dos barras laterales del banco, con una portada de
// espacio (la 1) por encima de todo, como en el Confluence real, para poder
// comprobar que se quita del camino.

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let path = decodeURIComponent(url.pathname)

  const rest = /^\/wiki\/rest\/api\/content\/(\d+)$/.exec(path)
  if (rest) {
    const body = contentWithAncestors(rest[1])
    res.writeHead(body ? 200 : 404, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body || { statusCode: 404, message: 'No content found with id: ' + rest[1] }))
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
