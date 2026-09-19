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

// --- fundir sin borrar el árbol -------------------------------------------
// Pasó de verdad: el camino se leía de la API, y en la pregunta siguiente lo
// que devolvían las herramientas —la misma página, sin padre— lo pisaba.

import { mergeIndexKeepingTree, isPlaceholderTitle } from '../../src/atlassian/index-store.js'

const CON_ARBOL = normalizeIndex(
  {
    pages: [
      { id: '3002', title: 'TCV - Domain 1 - Static Views', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/3002/TCVStatic' },
      { id: '98830281', title: 'TCV Static - Identity Provider Service', spaceKey: 'SIMPL', parentId: '3002', url: '/spaces/SIMPL/pages/98830281/TCVIdP' },
    ],
  },
  'confluence.simplprogramme.eu',
  null,
  { wikiPrefix: '' }
)

test('mergeIndexKeepingTree: lo nuevo no borra el padre ni el espacio que no sabe', () => {
  const suelta = normalizeIndex(
    { pages: [{ id: '98830281', title: 'TCV Static - Identity Provider Service', url: '/pages/viewpage.action?pageId=98830281' }] },
    'confluence.simplprogramme.eu',
    null,
    { wikiPrefix: '' }
  )
  const m = mergeIndexKeepingTree(CON_ARBOL, suelta)
  eq(m.pages['98830281'].parentId, '3002', 'el padre se conserva')
  eq(m.pages['98830281'].spaceKey, 'SIMPL', 'y el espacio')
  eq(m.pages['98830281'].path, '/spaces/SIMPL/pages/98830281/TCVIdP', 'y la ruta con nombre gana a la fabricada por id')
  eq(ancestryOf(m, '98830281').map((p) => p.id), ['3002', '98830281'])

  // La fila actual de un Data Center abierto por viewpage.action llega sin
  // nombre y, si se pierde la query, sin id: tampoco gana.
  const sinId = normalizeIndex({ pages: [{ id: '98830281', title: 'TCV', url: '/pages/viewpage.action' }] }, 'confluence.simplprogramme.eu', null, { wikiPrefix: '' })
  eq(mergeIndexKeepingTree(CON_ARBOL, sinId).pages['98830281'].path, '/spaces/SIMPL/pages/98830281/TCVIdP')
})

test('ancestryOf: admite árboles de más de ocho niveles', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ id: String(7000 + i), title: 'N' + i, url: '/p/' + i, parentId: i ? String(7000 + i - 1) : undefined }))
  const idx = normalizeIndex({ pages }, HOST)
  eq(ancestryOf(idx, '7011').length, 12, 'la cadena entera, no los ocho de abajo')
})

test('mergeIndexKeepingTree: un marcador «Página N» no pisa un título de verdad, pero un título nuevo sí', () => {
  const marcador = normalizeIndex({ pages: [{ id: '3002', title: 'Página 3002' }] }, 'confluence.simplprogramme.eu', null, { wikiPrefix: '' })
  eq(mergeIndexKeepingTree(CON_ARBOL, marcador).pages['3002'].title, 'TCV - Domain 1 - Static Views')
  const mejor = normalizeIndex({ pages: [{ id: '3002', title: 'TCV - Domain 1 - Static Views (v2)' }] }, 'confluence.simplprogramme.eu', null, { wikiPrefix: '' })
  eq(mergeIndexKeepingTree(CON_ARBOL, mejor).pages['3002'].title, 'TCV - Domain 1 - Static Views (v2)')
  assert(isPlaceholderTitle('Página 12') && !isPlaceholderTitle('Página de inicio'))
})

test('mergeIndexKeepingTree: un padre nuevo sí sustituye al viejo, y una página nueva entra entera', () => {
  const nuevo = normalizeIndex(
    { pages: [{ id: '98830281', title: 'TCV', parentId: '3001' }, { id: '7', title: 'Nueva', parentId: '3002' }] },
    'confluence.simplprogramme.eu',
    null,
    { wikiPrefix: '' }
  )
  const m = mergeIndexKeepingTree(CON_ARBOL, nuevo)
  eq(m.pages['98830281'].parentId, '3001')
  eq(m.pages['7'].parentId, '3002')
  eq(m.pages['7'].title, 'Nueva')
})

test('mergeIndexKeepingTree: sin base, o con una de otra version, es como mergeIndex', () => {
  const nuevo = normalizeIndex({ pages: [{ id: '1', title: 'X', url: '/p/1' }] }, HOST)
  eq(Object.keys(mergeIndexKeepingTree(null, nuevo).pages), ['1'])
  const viejo = { version: 1, host: HOST, pages: { 1: { id: '1', title: 'Vieja', parentId: '9', path: '/wiki/spaces/~/pages/1' } }, spaces: {}, projects: {}, issues: {} }
  eq(mergeIndexKeepingTree(viejo, nuevo).pages['1'].parentId, null, 'de un indice descartado no se rescata nada')
})

// --- copia superficial (H6 P3) ---------------------------------------------
// Fundir clonaba el índice ENTERO por JSON en cada llamada, y desde H6 se funde
// una vez por turno con lo que haya crecido: con 2 000 páginas eso era copiar
// 2 000 objetos para cambiar tres. Las entradas son inmutables —nadie las
// modifica en su sitio, todo el que las cambia construye otra (`normalizeIndex`,
// `mergeIndexKeepingTree`)—, así que compartirlas es seguro y lo único que hay
// que copiar de verdad son los cuatro cubos.

test('mergeIndex: copia superficial — las entradas que nadie toca se comparten, y la base no se toca', () => {
  const a = normalizeIndex({ updated: 10, pages: [{ id: '1', title: 'Vieja', url: '/a' }], spaces: [{ key: 'ENG', name: 'Ing' }] }, HOST)
  const b = normalizeIndex({ updated: 20, pages: [{ id: '2', title: 'Otra', url: '/b' }] }, HOST)
  const m = mergeIndex(a, b)

  // La entrada que el índice nuevo no menciona es LA MISMA, no una copia: es lo
  // que hace que fundir no cueste proporcional al tamaño del índice.
  assert(m.pages['1'] === a.pages['1'], 'la página que nadie toca no se clona')
  assert(m.spaces['ENG'] === a.spaces['ENG'], 'ni el espacio')
  assert(m.pages['2'] === b.pages['2'], 'y la nueva entra tal cual')

  // Pero los CUBOS sí son propios: escribir en el resultado no puede tocar la
  // base, que es el índice que el panel sigue teniendo en `state.index`.
  for (const cubo of ['spaces', 'pages', 'projects', 'issues']) {
    assert(m[cubo] !== a[cubo], `el cubo ${cubo} se copia`)
  }
  m.pages['3'] = { id: '3', title: 'Colada', spaceKey: null, parentId: null, path: '/c' }
  delete m.pages['1']
  eq(Object.keys(a.pages), ['1'], 'la base sigue como estaba')
  eq(a.updated, 10, 'y su fecha también')
  eq(m.updated, 20, 'la del resultado es la más nueva de las dos')
})

test('mergeIndexKeepingTree: fundir dos veces lo mismo da lo mismo (una escritura por turno)', () => {
  // H6 P3: el índice se funde en memoria varias veces durante un turno
  // (`growIndex`, el árbol de la barra lateral, el camino del planificador) y se
  // guarda UNA vez al final. Si fundir no fuera idempotente, el índice guardado
  // dependería de cuántas veces se hubiera fundido antes.
  const suelta = normalizeIndex(
    { updated: 99, pages: [{ id: '98830281', title: 'TCV Static - Identity Provider Service', url: '/pages/viewpage.action?pageId=98830281' }] },
    'confluence.simplprogramme.eu',
    null,
    { wikiPrefix: '' }
  )
  const una = mergeIndexKeepingTree(CON_ARBOL, suelta)
  const dos = mergeIndexKeepingTree(una, suelta)
  eq(dos, una, 'el segundo funde no cambia nada')
  eq(mergeIndexKeepingTree(dos, suelta), una, 'ni el tercero')

  // Y la base de la que se partió sigue intacta después de las tres.
  eq(CON_ARBOL.pages['98830281'].path, '/spaces/SIMPL/pages/98830281/TCVIdP')
  eq(Object.keys(CON_ARBOL.pages).sort(), ['3002', '98830281'])
})
