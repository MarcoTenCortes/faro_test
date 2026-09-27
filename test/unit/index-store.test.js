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

// ---- H21: varios espacios en el índice de un host -------------------------------
// El índice de un host guarda desde H21 las páginas de varios espacios (cada una
// con su spaceKey). Con `preferSpace`, el planificador ve primero las del espacio
// de la pestaña, sin perder las otras: un destino de otro espacio es legítimo.

const DOS_ESPACIOS = {
  version: 3,
  host: HOST,
  spaces: { ENG: { key: 'ENG', name: 'Ingeniería' }, OPS: { key: 'OPS', name: 'Operaciones' } },
  pages: {
    1: { id: '1', title: 'Guía de APIs', spaceKey: 'ENG' },
    2: { id: '2', title: 'Runbooks', spaceKey: 'OPS' },
    3: { id: '3', title: 'Convenciones', spaceKey: 'ENG' },
    4: { id: '4', title: 'Guardias de runbooks', spaceKey: 'OPS' },
    5: { id: '5', title: 'Suelta', spaceKey: null },
  },
  projects: {},
  issues: {},
}

test('H21: indexDigest con preferSpace pone delante el espacio de la pestaña, estable y sin excluir los otros', () => {
  const lineas = (d) => d.split('\n').filter((l) => /^ {2}\d/.test(l)).map((l) => l.trim().split(' ')[0])
  eq(lineas(indexDigest(DOS_ESPACIOS, { preferSpace: 'OPS' })), ['2', '4', '1', '3', '5'], 'OPS delante en su orden, y las demás detrás')
  eq(lineas(indexDigest(DOS_ESPACIOS, { preferSpace: 'ENG' })), ['1', '3', '2', '4', '5'])
  // La relevancia manda, y el espacio sólo desempata dentro del mismo nivel.
  eq(lineas(indexDigest(DOS_ESPACIOS, { preferSpace: 'OPS', relevantTo: 'guardias de runbooks' })), ['4', '2', '1', '3', '5'])
  // EL CAMBIO: la revisión adversaria de H21 encontró que el espacio preferido
  // iba POR ENCIMA de la relevancia, así que con ≥60 páginas en el espacio de
  // la pestaña una página de OTRO espacio que la respuesta nombra no llegaba al
  // planificador (el pin de antes lo exigía: «con el tope, lo que se queda
  // fuera son las del OTRO espacio»). Ahora, a igual relevancia, el preferido
  // delante; con más relevancia, la de otro espacio delante del preferido.
  eq(lineas(indexDigest(DOS_ESPACIOS, { preferSpace: 'ENG', relevantTo: 'los runbooks' })), ['2', '4', '1', '3', '5'], 'lo relevante de OPS antes que lo irrelevante de ENG')
  // Sin relevancia que decida, el tope deja fuera lo del otro espacio, como antes.
  eq(lineas(indexDigest(DOS_ESPACIOS, { preferSpace: 'OPS', maxPages: 3 })), ['2', '4', '1'])
  assert(indexDigest(DOS_ESPACIOS, { preferSpace: 'OPS', maxPages: 3 }).includes('PÁGINAS (5, se muestran 3)'), 'y cuenta todas')
})

test('H21 revisión: con el tope lleno del espacio de la pestaña, la página de OTRO espacio que la respuesta nombra sigue llegando, y la primera', () => {
  const pages = {}
  for (let i = 1; i <= 80; i++) pages[1000 + i] = { id: String(1000 + i), title: 'Nota operativa ' + i, spaceKey: 'OPS' }
  pages[9999] = { id: '9999', title: 'Arquitectura de la pasarela', spaceKey: 'ENG' }
  const indice = { version: 3, host: HOST, spaces: {}, pages, projects: {}, issues: {} }
  const d = indexDigest(indice, { preferSpace: 'OPS', maxPages: 60, relevantTo: 'La arquitectura de la pasarela está descrita aparte.' })
  const lineas = d.split('\n').filter((l) => /^ {2}\d/.test(l)).map((l) => l.trim().split(' ')[0])
  eq(lineas.length, 60, 'el tope se respeta')
  eq(lineas[0], '9999', 'la relevante de ENG, la primera (y la última del índice)')
  eq(lineas[1], '1001', 'y detrás las de OPS, en su orden')
  assert(d.includes('PÁGINAS (81, se muestran 60)'), 'cuenta todas')
})

test('H21: sin preferSpace (o con uno que no vale) indexDigest es byte a byte el de antes', () => {
  const antes = [
    'ESPACIOS DE CONFLUENCE',
    '  ENG — Ingeniería',
    '  OPS — Operaciones',
    'PÁGINAS (5)',
    '  1 — Guía de APIs [ENG]',
    '  2 — Runbooks [OPS]',
    '  3 — Convenciones [ENG]',
    '  4 — Guardias de runbooks [OPS]',
    '  5 — Suelta',
  ].join('\n')
  eq(indexDigest(DOS_ESPACIOS), antes, 'la salida entera, no un trozo')
  for (const preferSpace of ['', '~', '_', null, undefined, 7, {}]) eq(indexDigest(DOS_ESPACIOS, { preferSpace }), antes, JSON.stringify(preferSpace))
  eq(indexDigest(DOS_ESPACIOS, { preferSpace: 'NADA' }), antes, 'un espacio sin páginas no cambia nada')
  eq(indexDigest(null, { preferSpace: 'ENG' }), '(sin índice)')
})
