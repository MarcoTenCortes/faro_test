import { test, eq, assert } from '../harness.js'
import {
  emptyIndex,
  toSafePath,
  normalizeIndex,
  mergeIndex,
  resolveTarget,
  ancestryOf,
  indexDigest,
  indexSize,
} from '../../src/atlassian/index-store.js'

const HOST = 'acme.atlassian.net'
const ORIGIN = 'https://acme.atlassian.net'

test('toSafePath: acepta rutas y URLs del mismo host', () => {
  eq(toSafePath('/wiki/spaces/ENG', HOST), '/wiki/spaces/ENG')
  eq(toSafePath('https://acme.atlassian.net/wiki/spaces/ENG?x=1#y', HOST), '/wiki/spaces/ENG?x=1#y')
  eq(toSafePath('wiki/spaces/ENG', HOST), '/wiki/spaces/ENG')
})

test('toSafePath: rechaza cualquier salto de origen', () => {
  eq(toSafePath('https://malicioso.example/robar', HOST), null)
  eq(toSafePath('//malicioso.example/robar', HOST), null)
  eq(toSafePath('javascript:alert(1)', HOST), null)
  eq(toSafePath('data:text/html,<script>', HOST), null)
  eq(toSafePath('', HOST), null)
  eq(toSafePath(null, HOST), null)
})

test('normalizeIndex: acepta tanto mapas como listas', () => {
  const asList = normalizeIndex(
    { pages: [{ id: '11', title: 'A', url: '/wiki/spaces/E/pages/11/A', spaceKey: 'E' }] },
    HOST
  )
  const asMap = normalizeIndex(
    { pages: { 11: { title: 'A', url: '/wiki/spaces/E/pages/11/A', spaceKey: 'E' } } },
    HOST
  )
  eq(Object.keys(asList.pages), ['11'])
  eq(Object.keys(asMap.pages), ['11'])
  eq(asMap.pages['11'].title, 'A')
})

test('normalizeIndex: descarta entradas de otro host', () => {
  const idx = normalizeIndex(
    {
      pages: [
        { id: '11', title: 'Buena', url: '/wiki/spaces/E/pages/11/A' },
        { id: '12', title: 'Mala', url: 'https://malicioso.example/wiki/pages/12' },
      ],
    },
    HOST
  )
  eq(Object.keys(idx.pages), ['11'])
})

test('normalizeIndex: descarta ids con forma inválida', () => {
  const idx = normalizeIndex(
    {
      pages: [{ id: 'no-numerico', title: 'X', url: '/a' }],
      issues: [{ key: 'no-una-clave', url: '/browse/x' }, { key: 'ok-1', url: '/browse/OK-1' }],
    },
    HOST
  )
  eq(Object.keys(idx.pages), [])
  eq(Object.keys(idx.issues), ['OK-1'])
})

test('resolveTarget: reconstruye la URL contra el origen actual', () => {
  const idx = normalizeIndex({ pages: [{ id: '77', title: 'ADR', url: '/wiki/spaces/E/pages/77/ADR' }] }, HOST)
  const t = resolveTarget(idx, ORIGIN, { kind: 'confluence-page', id: '77' })
  eq(t.url, 'https://acme.atlassian.net/wiki/spaces/E/pages/77/ADR')
  eq(t.title, 'ADR')
})

test('resolveTarget: un id que no está en el índice no se resuelve', () => {
  const idx = emptyIndex(HOST)
  eq(resolveTarget(idx, ORIGIN, { kind: 'confluence-page', id: '999' }), null)
})

test('resolveTarget: deduce el tipo por la forma del identificador', () => {
  const idx = normalizeIndex(
    {
      pages: [{ id: '5', title: 'P', url: '/wiki/spaces/E/pages/5/P' }],
      issues: [{ key: 'AB-2', title: 'I', url: '/browse/AB-2' }],
      spaces: [{ key: 'ENG', name: 'Ingeniería', url: '/wiki/spaces/ENG' }],
    },
    HOST
  )
  eq(resolveTarget(idx, ORIGIN, { id: '5' }).kind, 'confluence-page')
  eq(resolveTarget(idx, ORIGIN, { id: 'ab-2' }).kind, 'jira-issue')
  eq(resolveTarget(idx, ORIGIN, { id: 'ENG' }).kind, 'confluence-space')
})

test('mergeIndex: lo nuevo gana y nada se pierde', () => {
  const a = normalizeIndex({ pages: [{ id: '1', title: 'Vieja', url: '/a' }] }, HOST)
  const b = normalizeIndex(
    { pages: [{ id: '1', title: 'Nueva', url: '/a' }, { id: '2', title: 'Otra', url: '/b' }] },
    HOST
  )
  const m = mergeIndex(a, b)
  eq(m.pages['1'].title, 'Nueva')
  eq(m.pages['2'].title, 'Otra')
  eq(indexSize(m), 2)
})

test('ancestryOf: cadena de padres, y sin colgarse en un bucle', () => {
  const idx = normalizeIndex(
    {
      pages: [
        { id: '1', title: 'Raíz', url: '/1' },
        { id: '2', title: 'Media', url: '/2', parentId: '1' },
        { id: '3', title: 'Hoja', url: '/3', parentId: '2' },
      ],
    },
    HOST
  )
  eq(ancestryOf(idx, '3').map((p) => p.id), ['1', '2', '3'])

  const loop = normalizeIndex(
    { pages: [{ id: '1', title: 'A', url: '/1', parentId: '2' }, { id: '2', title: 'B', url: '/2', parentId: '1' }] },
    HOST
  )
  assert(ancestryOf(loop, '1').length <= 8, 'el bucle debe cortarse')
})

test('indexDigest: resumen legible y acotado', () => {
  const pages = Array.from({ length: 500 }, (_, i) => ({ id: String(i + 1), title: 'P' + i, url: '/p/' + i }))
  const idx = normalizeIndex({ pages }, HOST)
  const digest = indexDigest(idx, { maxPages: 10 })
  assert(digest.includes('500'), 'debe decir cuántas hay en total')
  eq(digest.split('\n').filter((l) => l.startsWith('  ')).length, 10)
})

test('un indice de version anterior no se fusiona: se descarta', () => {
  // La v1 podia guardar /wiki/spaces/~/pages/<id>, que en Data Center es un 404.
  const viejo = { version: 1, host: HOST, pages: { 9: { id: '9', title: 'X', path: '/wiki/spaces/~/pages/9' } }, spaces: {}, projects: {}, issues: {} }
  const nuevo = normalizeIndex({ pages: [{ id: '10', title: 'Nueva', url: '/pages/viewpage.action?pageId=10' }] }, HOST)
  const m = mergeIndex(viejo, nuevo)
  assert(!m.pages['9'], 'la entrada rota no debe sobrevivir')
  assert(m.pages['10'], 'la nueva si')
})

test('SEGURIDAD: nada del indice puede apuntar a un espacio inventado', () => {
  const idx = normalizeIndex(
    { spaces: [{ key: '~' }, { key: '_' }, { key: 'SIMPL', name: 'SIMPL' }] },
    HOST,
    null,
    { cloud: false }
  )
  eq(Object.keys(idx.spaces), ['SIMPL'])
})

// --- el prefijo /wiki -----------------------------------------------------
// El modelo devuelve rutas de memoria, y su memoria dice /wiki porque asi es
// Cloud. En el Data Center del usuario eso es un 404. Se corrige con lo que se
// OBSERVA en el navegador, no con lo que se supone.

test('DC: se le quita el /wiki que el modelo se inventa', () => {
  const idx = normalizeIndex(
    { pages: [{ id: '1', title: 'X', url: '/wiki/spaces/SIMPL/pages/1/X' }] },
    'confluence.simplprogramme.eu',
    null,
    { wikiPrefix: '' }
  )
  eq(idx.pages['1'].path, '/spaces/SIMPL/pages/1/X')
})

test('Cloud: se le pone el /wiki que el modelo olvida', () => {
  const idx = normalizeIndex(
    { pages: [{ id: '1', title: 'X', url: '/spaces/ENG/pages/1/X' }] },
    'acme.atlassian.net',
    null,
    { wikiPrefix: '/wiki' }
  )
  eq(idx.pages['1'].path, '/wiki/spaces/ENG/pages/1/X')
})

test('sin saber el prefijo, la ruta no se toca', () => {
  const idx = normalizeIndex(
    { pages: [{ id: '1', title: 'X', url: '/wiki/spaces/ENG/pages/1/X' }] },
    'acme.atlassian.net'
  )
  eq(idx.pages['1'].path, '/wiki/spaces/ENG/pages/1/X')
})

test('la correccion no toca rutas que no son de Confluence', () => {
  const idx = normalizeIndex(
    { issues: [{ key: 'AB-1', title: 'X', url: '/browse/AB-1' }] },
    'jira.corp',
    null,
    { wikiPrefix: '' }
  )
  eq(idx.issues['AB-1'].path, '/browse/AB-1')
})
