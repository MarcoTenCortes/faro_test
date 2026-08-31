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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let path = decodeURIComponent(url.pathname)

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
