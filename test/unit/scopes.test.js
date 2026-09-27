/**
 * El ámbito (src/shared/scopes.js, H21): la unidad del contexto y del mapa
 * dentro de un host.
 *
 * Lo que se comprueba aquí es lo que decide qué CONTEXT.md ve el modelo y de
 * qué espacio es cada página del índice: la clave de ámbito (una clave rara
 * nunca es un ámbito, cae en `'*'`), la migración PRUDENTE del texto de antes
 * de H21 (bajo un espacio sólo si se sabe cuándo se indexó), las claves blancas
 * de lo guardado, que ninguna función mute lo que recibe, y los bordes de
 * `hasMap` y `spaceOverflow`. Todo puro: sin `chrome` ni DOM.
 */
import { readFileSync } from 'node:fs'
import { test, eq, assert } from '../harness.js'
import { INDEX_LIMITS } from '../../src/shared/config.js'
import {
  CONTEXTS_VERSION,
  SCOPE_KEY,
  SCOPE_LIMITS,
  scopeKeyOf,
  scopeKeyFromScope,
  scopeLabel,
  emptyContexts,
  normalizeContexts,
  contextFor,
  contextScopeFor,
  withContext,
  withoutContext,
  scopesWithMap,
  scopeKeys,
  pagesOfSpace,
  subIndex,
  withoutSpace,
  stampSpace,
  hasMap,
  otherScopesWithMap,
  countPages,
  spaceOverflow,
  normalizeLinkedSpaces,
  withLinkedSpace,
  linkedSpacesFor,
} from '../../src/shared/scopes.js'

const AHORA = Date.UTC(2026, 8, 26, 10, 0, 0)
const AYER = AHORA - 86400000
const SALTO = String.fromCharCode(10)
const NEL = String.fromCharCode(0x85)
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)
const LS = String.fromCharCode(0x2028)

/** Congela un objeto entero: si una función lo muta en modo estricto, lanza. */
function congelar(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) congelar(v)
    Object.freeze(o)
  }
  return o
}

const ambito = (text, { at = AYER, indexedAt = null, legacy = false } = {}) => ({ text, at, indexedAt, legacy })

/** Un índice con páginas de dos espacios y alguna sin espacio. */
function indice() {
  return {
    version: 3,
    host: 'confluence.x.eu',
    scope: { kind: 'space', key: 'ENG', label: 'el espacio ENG' },
    updated: 5,
    spaces: { ENG: { key: 'ENG', name: 'Ingeniería' }, OPS: { key: 'OPS', name: 'Operaciones' } },
    pages: {
      1: { id: '1', title: 'Portada ENG', spaceKey: 'ENG', parentId: null, path: '/spaces/ENG' },
      2: { id: '2', title: 'Guía', spaceKey: 'ENG', parentId: '1', path: '/pages/2' },
      5000: { id: '5000', title: 'Operaciones', spaceKey: 'OPS', parentId: null, path: '/spaces/OPS' },
      9: { id: '9', title: 'Cosechada', spaceKey: null, parentId: null, path: '/pages/9' },
    },
    projects: { SIMPL: { key: 'SIMPL', name: 'SIMPL' } },
    issues: { 'SIMPL-1': { key: 'SIMPL-1', title: 'x' } },
  }
}

// ---- las constantes -----------------------------------------------------------

test('H21: la versión, los topes y la forma de una clave de ámbito', () => {
  eq(CONTEXTS_VERSION, 2)
  eq(SCOPE_LIMITS, { maxScopes: 40, textMax: 60000, keysShown: 6 })
  assert(Object.isFrozen(SCOPE_LIMITS), 'los topes no se tocan en caliente')
  for (const k of ['*', 'space:ENG', 'space:~ana', 'project:SIMPL', 'project:A_1']) assert(SCOPE_KEY.test(k), k)
  for (const k of ['', '**', 'space:', 'space:A B', 'project:simpl', 'project:1A', 'otro:X', ' *']) assert(!SCOPE_KEY.test(k), k)
  eq(emptyContexts(), { version: 2, scopes: {} })
})

// ---- de un sitio a su ámbito ------------------------------------------------

test('H21: scopeKeyOf da el espacio en Confluence, el proyecto en Jira y «*» en lo demás', () => {
  eq(scopeKeyOf({ product: 'confluence', spaceKey: 'ENG' }), 'space:ENG')
  eq(scopeKeyOf({ product: 'confluence', spaceKey: '~ana' }), 'space:~ana', 'un espacio personal es un espacio')
  eq(scopeKeyOf({ product: 'jira', projectKey: 'SIMPL' }), 'project:SIMPL')
  eq(scopeKeyOf({ product: 'jira', projectKey: 'simpl' }), 'project:SIMPL', 'la clave de proyecto va en mayúsculas')
  eq(scopeKeyOf({ product: 'confluence' }), '*', 'Confluence sin espacio: todo el sitio')
  eq(scopeKeyOf({ product: 'jira' }), '*', 'Jira sin proyecto: todo el sitio')
  eq(scopeKeyOf({ product: 'confluence', projectKey: 'SIMPL' }), '*', 'un proyecto no es un espacio')
  eq(scopeKeyOf({ product: 'jira', spaceKey: 'ENG' }), '*', 'ni al revés')
  for (const s of [null, undefined, {}, 'space:ENG', [], { product: 'otro', spaceKey: 'ENG' }]) eq(scopeKeyOf(s), '*', JSON.stringify(s))
})

test('SEGURIDAD: una clave rara nunca es un ámbito: cae en «*»', () => {
  const raras = ['A"B', '~', '_', 'EN' + SALTO + 'G', 'EN' + RLO + 'G', 'EN' + NEL + 'G', 'EN' + ZWSP + 'G', 'x'.repeat(300), 'A B', 'A/B', 123, {}]
  for (const k of raras) {
    eq(scopeKeyOf({ product: 'confluence', spaceKey: k }), '*', 'espacio ' + JSON.stringify(k))
    eq(scopeKeyFromScope({ kind: 'space', key: k }), '*', 'ámbito del índice ' + JSON.stringify(k))
  }
  for (const k of ['SIM PL', '1ABC', 'A"B', 'S' + SALTO + 'X', 'X'.repeat(30), 7]) {
    eq(scopeKeyOf({ product: 'jira', projectKey: k }), '*', 'proyecto ' + JSON.stringify(k))
    eq(scopeKeyFromScope({ kind: 'project', key: k }), '*', 'proyecto del índice ' + JSON.stringify(k))
  }
})

test('H21: scopeKeyFromScope lee el ámbito del índice, y scopeLabel lo nombra para la interfaz', () => {
  eq(scopeKeyFromScope({ kind: 'space', key: 'ENG', label: 'x' }), 'space:ENG')
  eq(scopeKeyFromScope({ kind: 'project', key: 'SIMPL' }), 'project:SIMPL')
  eq(scopeKeyFromScope({ kind: 'confluence-site', key: '*' }), '*')
  eq(scopeKeyFromScope({ kind: 'jira-site', key: '*' }), '*')
  eq(scopeKeyFromScope(null), '*')
  eq(scopeLabel('space:ENG'), 'el espacio ENG')
  eq(scopeLabel('project:SIMPL'), 'el proyecto SIMPL')
  eq(scopeLabel('*'), 'todo el sitio')
  eq(scopeLabel('space:A"B'), 'todo el sitio', 'una clave que no vale se enseña como a lo que cae')
  eq(scopeLabel(undefined), 'todo el sitio')
})

// ---- la migración del texto de antes de H21 --------------------------------

test('H21: el texto de antes migra bajo el ámbito del índice SÓLO si se sabe cuándo se indexó', () => {
  const ok = normalizeContexts('  # ENG  ', { legacyScope: 'space:ENG', legacyIndexedAt: AYER, now: AHORA })
  eq(ok, { version: 2, scopes: { 'space:ENG': { text: '# ENG', at: AHORA, indexedAt: AYER, legacy: true } } })
  // SEGURIDAD de la migración: sin fecha de indexado el ámbito del índice no dice
  // de qué es el texto (un contexto subido a mano no cambia index.scope).
  for (const indexedAt of [null, undefined, 0, -1, NaN, Infinity, 1e20, '1700000000000', true]) {
    eq(
      normalizeContexts('# x', { legacyScope: 'space:ENG', legacyIndexedAt: indexedAt, now: AHORA }),
      { version: 2, scopes: { '*': { text: '# x', at: AHORA, indexedAt: null, legacy: true } } },
      'sin un instante válido va a «*»: ' + String(indexedAt)
    )
  }
  for (const legacyScope of ['space:A"B', 'space:', 'otro', '', null, 'project:simpl', '*', 'space:EN' + SALTO + 'G']) {
    eq(
      normalizeContexts('# x', { legacyScope, legacyIndexedAt: AYER, now: AHORA }),
      { version: 2, scopes: { '*': { text: '# x', at: AHORA, indexedAt: null, legacy: true } } },
      'un ámbito que no vale va a «*» y sin mapa: ' + JSON.stringify(legacyScope)
    )
  }
  eq(normalizeContexts('# x', { now: AHORA }).scopes['*'].indexedAt, null, 'sin nada que diga el ámbito: «*»')
  eq(normalizeContexts('   ', { legacyScope: 'space:ENG', legacyIndexedAt: AYER }), emptyContexts(), 'un texto vacío no es un contexto')
  eq(normalizeContexts('', {}), emptyContexts())
})

test('H21: normalizar dos veces da lo mismo, y el texto se acota al guardar', () => {
  const largo = ' ' + 'a'.repeat(SCOPE_LIMITS.textMax - 1) + ' b' + 'c'.repeat(50)
  const una = normalizeContexts(largo, { legacyScope: 'space:ENG', legacyIndexedAt: AYER, now: AHORA })
  eq(una.scopes['space:ENG'].text.length <= SCOPE_LIMITS.textMax, true, 'acotado a textMax')
  eq(normalizeContexts(una, { now: AHORA + 5 }), una, 'idempotente, y el `at` ya guardado no se cambia')
  eq(normalizeContexts(normalizeContexts(una)), una)
})

// ---- lo que ya es un objeto -------------------------------------------------

test('SEGURIDAD: normalizeContexts reconstruye con claves blancas y tira lo que no es un ámbito', () => {
  const crudo = JSON.parse(
    JSON.stringify({
      version: 2,
      extra: 'fuera',
      scopes: {
        'space:ENG': { text: 'uno', at: AYER, indexedAt: AYER, legacy: true, onclick: 'x' },
        'space:A"B': { text: 'raro', at: AYER },
        'project:simpl': { text: 'minúsculas', at: AYER },
        'project:SIMPL': { text: 'dos', at: 'ayer', indexedAt: -5, legacy: 'sí' },
        ['space:EN' + RLO + 'G']: { text: 'al revés', at: AYER },
        ['space:EN' + LS + 'G']: { text: 'salto', at: AYER },
        'space:~': { text: 'virgulilla', at: AYER },
        otro: { text: 'otro', at: AYER },
        '*': { text: '   ', at: AYER },
        'space:OPS': { text: 17, at: AYER },
        'space:DOC': 'no es un objeto',
      },
    })
  )
  // __proto__, constructor y toString llegan como claves PROPIAS por JSON.parse.
  const conPrototipo = JSON.parse('{"version":2,"scopes":{"__proto__":{"text":"p"},"constructor":{"text":"c"},"toString":{"text":"t"},"space:ENG":{"text":"uno","at":1}}}')
  const r = normalizeContexts(crudo, { now: AHORA })
  eq(Object.keys(r), ['version', 'scopes'])
  eq(Object.keys(r.scopes), ['space:ENG', 'project:SIMPL'], 'sólo las claves que casan y revalidan, con texto, en su orden')
  eq(Object.keys(r.scopes['space:ENG']).sort(), ['at', 'indexedAt', 'legacy', 'text'], 'claves exactas del ámbito')
  eq(r.scopes['project:SIMPL'], { text: 'dos', at: AHORA, indexedAt: null, legacy: false }, 'lo que no vale se repone, no se copia')
  eq(Object.keys(normalizeContexts(conPrototipo).scopes), ['space:ENG'], '__proto__, constructor y toString no entran')
  eq(Object.getPrototypeOf(normalizeContexts(conPrototipo).scopes), Object.prototype, 'y el prototipo no se toca')
})

test('H21: otra versión, una lista o basura dan unos contextos vacíos, sin lanzar', () => {
  for (const raw of [null, undefined, 0, 7, true, [], {}, { version: 1, scopes: { '*': { text: 'x' } } }, { version: '2', scopes: {} }, { version: 2 }, { version: 2, scopes: [{ text: 'x' }] }, { version: 2, scopes: 'x' }]) {
    eq(normalizeContexts(raw), emptyContexts(), JSON.stringify(raw))
  }
})

test('H21: el tope de ámbitos conserva los más recientes, en su orden', () => {
  const scopes = {}
  for (let i = 0; i < SCOPE_LIMITS.maxScopes + 3; i++) scopes['space:E' + i] = ambito('t' + i, { at: AYER + i })
  // El más reciente de todos, al principio: tiene que quedarse, y en su sitio.
  const conPrimero = { 'space:NUEVO': ambito('n', { at: AHORA }), ...scopes }
  const r = normalizeContexts({ version: 2, scopes: conPrimero })
  const claves = Object.keys(r.scopes)
  eq(claves.length, SCOPE_LIMITS.maxScopes)
  eq(claves[0], 'space:NUEVO', 'el más reciente se queda, en su posición')
  assert(!claves.includes('space:E0') && !claves.includes('space:E3') && claves.includes('space:E4'), 'se van los cuatro más viejos: ' + claves.slice(0, 3))
  eq(normalizeContexts(r), r, 'y otra vuelta no cambia nada')
})

// ---- leer y escribir un ámbito ---------------------------------------------

test('H21: contextFor y contextScopeFor dan el propio, si no el heredado, si no nada', () => {
  const c = { version: 2, scopes: { '*': ambito('todo'), 'space:ENG': ambito('eng') } }
  eq(contextFor(c, 'space:ENG'), 'eng')
  eq(contextScopeFor(c, 'space:ENG'), 'space:ENG')
  eq(contextFor(c, 'space:OPS'), 'todo', 'sin propio, el de todo el sitio')
  eq(contextScopeFor(c, 'space:OPS'), '*')
  eq(contextFor(c, 'space:OPS', { fallback: 'space:ENG' }), 'eng', 'el respaldo lo elige quien llama')
  const sinTodo = { version: 2, scopes: { 'space:ENG': ambito('eng') } }
  eq(contextFor(sinTodo, 'space:OPS'), '')
  eq(contextScopeFor(sinTodo, 'space:OPS'), '')
  eq(contextFor(null, 'space:ENG'), '')
  eq(contextScopeFor('texto', '*'), '')
  eq(contextFor(JSON.parse('{"version":2,"scopes":{"__proto__":{"text":"p"}}}'), '__proto__'), '', 'hasOwn, no el prototipo')
})

test('H21: withContext no muta, pone el ámbito y conserva lo que no se le da', () => {
  const base = congelar({ version: 2, scopes: { 'space:ENG': ambito('eng', { indexedAt: AYER }), '*': ambito('todo') } })
  const copia = JSON.stringify(base)
  const nuevo = withContext(base, 'space:OPS', { text: 'ops', indexedAt: AHORA, now: AHORA })
  eq(JSON.stringify(base), copia, 'lo que recibe no cambia')
  eq(Object.keys(nuevo.scopes), ['space:ENG', '*', 'space:OPS'])
  eq(nuevo.scopes['space:OPS'], { text: 'ops', at: AHORA, indexedAt: AHORA, legacy: false })
  // keepContext: sin texto se conserva el del ámbito, y el indexado se estampa.
  const reindexado = withContext(base, 'space:ENG', { text: undefined, indexedAt: AHORA, now: AHORA })
  eq(reindexado.scopes['space:ENG'], { text: 'eng', at: AHORA, indexedAt: AHORA, legacy: false })
  eq(Object.keys(reindexado.scopes), ['space:ENG', '*'], 'sustituye en su sitio')
  // Sin indexedAt (undefined), el de antes se queda: subir un contexto no borra el mapa.
  eq(withContext(base, 'space:ENG', { text: 'nuevo', now: AHORA }).scopes['space:ENG'], { text: 'nuevo', at: AHORA, indexedAt: AYER, legacy: false })
  eq(withContext(base, 'space:ENG', { text: '', now: AHORA }).scopes['space:ENG'].text, 'eng', 'un texto vacío no borra el que había')
  eq(withContext(base, 'space:A"B', { text: 'x', now: AHORA }), normalizeContexts(base), 'una clave que no vale no escribe nada')
  eq(withContext(base, 'space:NADA', { text: undefined, now: AHORA }), normalizeContexts(base), 'sin texto y sin nada previo no hay ámbito que crear')
})

test('H21: withoutContext quita un ámbito sin tocar los demás ni lo que recibe', () => {
  const base = congelar({ version: 2, scopes: { 'space:ENG': ambito('eng'), 'space:OPS': ambito('ops') } })
  eq(Object.keys(withoutContext(base, 'space:ENG').scopes), ['space:OPS'])
  eq(Object.keys(withoutContext(base, 'space:NADA').scopes), ['space:ENG', 'space:OPS'])
  eq(Object.keys(base.scopes), ['space:ENG', 'space:OPS'])
})

test('H21: scopesWithMap sólo cuenta un indexado válido; scopeKeys las da todas, ordenadas', () => {
  const c = {
    version: 2,
    scopes: { 'space:OPS': ambito('o', { indexedAt: AYER }), 'space:ENG': ambito('e'), '*': ambito('t', { indexedAt: AYER }), 'project:SIMPL': ambito('p', { indexedAt: 'ayer' }) },
  }
  eq(scopesWithMap(c), ['*', 'space:OPS'])
  eq(scopeKeys(c), ['*', 'project:SIMPL', 'space:ENG', 'space:OPS'])
  eq(scopesWithMap(null), [])
})

// ---- el índice de un host con varios espacios ------------------------------

test('H21: pagesOfSpace, subIndex y withoutSpace filtran páginas sin tocar lo demás ni mutar', () => {
  const idx = congelar(indice())
  eq(pagesOfSpace(idx, 'ENG').map((p) => p.id), ['1', '2'])
  eq(pagesOfSpace(idx, 'OPS').map((p) => p.id), ['5000'])
  for (const raro of ['', '~', 'A"B', null, 7, 'eng']) eq(pagesOfSpace(idx, raro), [], 'clave rara o que no es exacta: ' + JSON.stringify(raro))
  eq(pagesOfSpace(null, 'ENG'), [])

  const sub = subIndex(idx, 'OPS')
  eq(Object.keys(sub.pages), ['5000'])
  assert(sub.pages['5000'] === idx.pages['5000'], 'los mismos objetos de página')
  assert(sub.spaces === idx.spaces && sub.projects === idx.projects && sub.issues === idx.issues, 'espacios, proyectos e incidencias intactos')
  eq([sub.version, sub.host, sub.scope, sub.updated], [3, 'confluence.x.eu', idx.scope, 5])
  eq(Object.keys(subIndex(idx, 'A"B').pages), [], 'clave rara: ninguna página')
  eq(subIndex(null, 'ENG'), null)

  const sin = withoutSpace(idx, 'ENG')
  eq(Object.keys(sin.pages).sort(), ['5000', '9'])
  eq(Object.keys(sin.spaces), ['OPS'], 'y su entrada en spaces')
  assert(sin.projects === idx.projects && sin.issues === idx.issues)
  eq(Object.keys(withoutSpace(idx, 'A"B').pages).length, 4, 'una clave rara no quita nada')
  eq(withoutSpace(null, 'ENG'), null)
  eq(Object.keys(idx.pages).length, 4, 'el original no cambia')
})

test('H21: stampSpace sólo rellena las páginas sin espacio, y con una clave rara no hace nada', () => {
  const idx = congelar(indice())
  const est = stampSpace(idx, 'ENG')
  eq(est.pages['9'].spaceKey, 'ENG', 'la cosechada sin espacio recibe el de la pestaña')
  eq(est.pages['5000'].spaceKey, 'OPS', 'una página con espacio no se pisa')
  assert(est.pages['1'] === idx.pages['1'], 'la que ya tenía espacio es el mismo objeto')
  eq(idx.pages['9'].spaceKey, null, 'sin mutar')
  for (const vacio of ['', undefined]) {
    const i = { ...indice(), pages: { 3: { id: '3', title: 'x', spaceKey: vacio } } }
    eq(stampSpace(i, 'OPS').pages['3'].spaceKey, 'OPS', 'también con ' + JSON.stringify(vacio))
  }
  for (const raro of ['', '~', '_', 'A B', null, 'EN' + SALTO + 'G']) assert(stampSpace(idx, raro) === idx, 'el MISMO objeto con ' + JSON.stringify(raro))
  eq(stampSpace(null, 'ENG'), null)
})

test('H21: hasMap — un indexado válido, y nada más', () => {
  const idx = indice()
  const c = { version: 2, scopes: { 'project:SIMPL': ambito('p', { indexedAt: AYER }), 'space:DOC': ambito('d', { indexedAt: AYER }), 'space:WIKI': ambito('w'), '*': ambito('t') } }
  eq(hasMap(c, null, 'space:DOC'), true, 'con indexado aunque no haya índice')
  // EL CAMBIO: la revisión adversaria de H21 encontró que las páginas del
  // índice daban mapa a un espacio que nadie había construido (las cosechadas
  // de las herramientas llegan con /spaces/KEY/pages/N y las filas de la barra
  // lateral se estampan con el espacio de la pestaña). Criterio único de
  // docs/PLAN2.md §3.4: el `indexedAt` del ámbito. Las páginas no cuentan.
  eq(hasMap(emptyContexts(), idx, 'space:ENG'), false, 'páginas del espacio sin contexto indexado: sin mapa')
  eq(hasMap(c, idx, 'space:WIKI'), false, 'contexto sin indexado y sin páginas: sin mapa')
  eq(hasMap(c, idx, 'project:SIMPL'), true)
  eq(hasMap(emptyContexts(), idx, 'project:SIMPL'), false, 'un proyecto sólo por su indexado')
  eq(hasMap(c, idx, '*'), false, 'todo el sitio sólo por su indexado, aunque haya páginas')
  eq(hasMap(emptyContexts(), idx, 'space:A"B'), false)
  eq(hasMap(null, null, 'space:ENG'), false)
})

test('H21: otherScopesWithMap da los OTROS espacios con mapa, sólo de los contextos con indexado', () => {
  const c = { version: 2, scopes: { 'space:DOC': ambito('d', { indexedAt: AYER }), 'space:ENG': ambito('e', { indexedAt: AYER }), 'space:WIKI': ambito('w'), 'project:SIMPL': ambito('p', { indexedAt: AYER }) } }
  // EL CAMBIO (revisión adversaria de H21): OPS tiene páginas en el índice y
  // ningún contexto indexado, así que ya no sale: las páginas no dan mapa.
  eq(otherScopesWithMap(c, indice(), 'space:ENG'), ['space:DOC'], 'sin el de ahora, sin proyectos, sin el que no tiene mapa y sin los de sólo páginas')
  eq(otherScopesWithMap(c, indice(), 'space:DCPIAS'), ['space:DOC', 'space:ENG'])
  eq(otherScopesWithMap(c, null, 'space:DCPIAS'), ['space:DOC', 'space:ENG'], 'el índice no cambia nada: se ignora')
  eq(otherScopesWithMap(null, null, '*'), [])
})

test('H21 revisión: una página cosechada no da mapa a su espacio, y un espacio tiene mapa sólo por su indexado', () => {
  // La forma real de lo cosechado: una URL /spaces/OPS/pages/N de una
  // herramienta llega al índice CON su spaceKey (harvestIndex, PAGE_URL).
  const cosechada = { version: 3, host: 'confluence.x.eu', spaces: {}, pages: { 7001: { id: '7001', title: 'Runbook', spaceKey: 'OPS', parentId: null, path: '/spaces/OPS/pages/7001/Runbook' } }, projects: {}, issues: {} }
  eq(hasMap(emptyContexts(), cosechada, 'space:OPS'), false, 'una cosechada sola no da mapa')
  eq(otherScopesWithMap(emptyContexts(), cosechada, 'space:ENG'), [], 'ni mete OPS en la línea de otros espacios')
  // Y al revés: el indexado da mapa aunque el índice no tenga ni una página suya.
  const soloIndexado = withContext(emptyContexts(), 'space:OPS', { text: 'ops', indexedAt: AYER, now: AHORA })
  const vacio = { version: 3, host: 'confluence.x.eu', spaces: {}, pages: {}, projects: {}, issues: {} }
  eq(hasMap(soloIndexado, vacio, 'space:OPS'), true, 'con su indexado y sin páginas')
  eq(otherScopesWithMap(soloIndexado, null, 'space:ENG'), ['space:OPS'])
})

test('H21: countPages y spaceOverflow en el borde exacto del tope total', () => {
  eq(countPages(indice()), { pages: 4, spaces: 2 })
  eq(countPages(null), { pages: 0, spaces: 0 })
  const conN = (n, espacio = 'ENG') => {
    const pages = {}
    for (let i = 0; i < n; i++) pages[i + 1] = { id: String(i + 1), spaceKey: espacio }
    return { pages }
  }
  const opt = { maxPages: 300, maxTotal: 1500 }
  eq(spaceOverflow(conN(1200), 'OPS', opt), false, '1 200 + 300 = 1 500: cabe justo')
  eq(spaceOverflow(conN(1201), 'OPS', opt), true, 'una más, ya no')
  eq(spaceOverflow(conN(1500), 'ENG', opt), false, 'reindexar el MISMO espacio no cuenta sus páginas dos veces')
  eq(spaceOverflow(conN(1200), 'OPS'), false, 'con los topes de INDEX_LIMITS')
  eq(spaceOverflow(conN(INDEX_LIMITS.maxPagesTotal - INDEX_LIMITS.maxPages + 1), 'OPS'), true)
  eq(spaceOverflow(null, 'ENG'), false)
})

test('H21 revisión: el tope total cuenta sólo lo que se puede olvidar, y reconstruir un espacio no crece', () => {
  // Lo que no lleva espacio (cosechado de las herramientas, una clave que no
  // valida) no lo quita ningún «Olvidar el mapa de X»: contarlo dejaba un
  // «Mapa lleno» sin salida. Borde de la revisión adversaria de H21.
  const opt = { maxPages: 300, maxTotal: 1500 }
  const pages = {}
  let n = 0
  for (const esp of ['A', 'B', 'C', 'D', 'E']) for (let i = 0; i < 300; i++) pages[++n] = { id: String(n), spaceKey: esp }
  pages[++n] = { id: String(n), spaceKey: null }
  eq(spaceOverflow({ pages }, 'A', opt), false, '5×300 más UNA sin espacio: reindexar A no da lleno')
  eq(spaceOverflow({ pages }, 'F', opt), true, 'un sexto espacio sí: 1 500 olvidables + 300')
  const sinEspacio = {}
  for (let i = 1; i <= 1201; i++) sinEspacio[i] = { id: String(i), spaceKey: i % 2 ? null : '_' }
  eq(spaceOverflow({ pages: sinEspacio }, 'OPS', opt), false, '1 201 sin espacio (o con «_») no bloquean nada')
  // countPages sigue contando todas las páginas, pero sólo los espacios de verdad.
  eq(countPages({ pages: { 1: { spaceKey: '_' }, 2: { spaceKey: '~' }, 3: { spaceKey: 'ENG' }, 4: { spaceKey: 'eng"x' } } }), { pages: 4, spaces: 1 }, 'una clave rara no es un espacio')
})

test('H21 revisión: un at o un indexedAt del futuro se traen a ahora, y un ámbito recién escrito no lo tira el tope', () => {
  const futuro = AHORA + 1e9
  const r = normalizeContexts({ version: 2, scopes: { 'space:ENG': ambito('e', { at: futuro, indexedAt: futuro }) } }, { now: AHORA })
  eq(r.scopes['space:ENG'].at, AHORA, 'el at futuro, ahora')
  eq(r.scopes['space:ENG'].indexedAt, AHORA, 'el indexedAt futuro, ahora')
  eq(normalizeContexts(r, { now: AHORA }), r, 'idempotente')
  // Con 40 ámbitos de at futuro (un reloj adelantado y luego corregido), el
  // tope tiraba justo el contexto recién escrito.
  const llenos = {}
  for (let i = 0; i < SCOPE_LIMITS.maxScopes; i++) llenos['space:F' + i] = ambito('f' + i, { at: futuro })
  const conNuevo = withContext({ version: 2, scopes: llenos }, 'space:NUEVO', { text: 'nuevo', now: AHORA })
  assert(Object.hasOwn(conNuevo.scopes, 'space:NUEVO'), 'el recién escrito se queda')
  eq(Object.keys(conNuevo.scopes).length, SCOPE_LIMITS.maxScopes)
})

test('H21 revisión: a igual at, el tope se queda con los que estaban antes; y withContext deja de marcar legacy', () => {
  const scopes = {}
  for (let i = 0; i <= SCOPE_LIMITS.maxScopes; i++) scopes['space:E' + i] = ambito('t' + i, { at: AYER })
  const claves = Object.keys(normalizeContexts({ version: 2, scopes }).scopes)
  eq(claves.length, SCOPE_LIMITS.maxScopes)
  eq(claves[claves.length - 1], 'space:E' + (SCOPE_LIMITS.maxScopes - 1), 'se cae el último, no el primero')
  assert(claves.includes('space:E0') && !claves.includes('space:E' + SCOPE_LIMITS.maxScopes), 'el primero se queda')
  const viejo = { version: 2, scopes: { '*': ambito('viejo', { legacy: true }) } }
  eq(withContext(viejo, '*', { text: 'nuevo', now: AHORA }).scopes['*'].legacy, false, 'lo escrito ahora no es de antes de H21')
  eq(withContext(viejo, '*', { text: undefined, indexedAt: AHORA, now: AHORA }).scopes['*'].legacy, false, 'tampoco al estampar sólo el indexado')
})

// ---- desde Jira ---------------------------------------------------------------

// EL CAMBIO (H22): `linkedContextFor` (el `'*'`, o el único espacio con
// contexto; con dos, ninguno) se BORRA. En su sitio, `linkedSpacesFor` elige UN
// espacio del Confluence enlazado por proyecto, con las reglas de docs/PLAN2.md
// §3.4 y la elección manual de Ajustes delante (la decisión del orquestador:
// una elección explícita del usuario no la pisa una heurística).

/** Los contextos de un Confluence enlazado con ENG, OPS y, si se pide, todo el sitio. */
const enlazado = ({ todo = true } = {}) =>
  congelar({
    version: 2,
    scopes: {
      'space:ENG': ambito('eng'),
      'space:OPS': ambito('ops'),
      ...(todo ? { '*': ambito('todo') } : {}),
      'project:SIMPL': ambito('del proyecto'),
    },
  })

test('H22: linkedSpacesFor — sin nada que decida: el único espacio, el heredado o ninguno, con las claves de los demás', () => {
  const r = linkedSpacesFor({ version: 2, scopes: { 'space:ENG': ambito('eng'), '*': ambito('todo') } })
  eq(Object.keys(r), ['key', 'text', 'via', 'otras'], 'claves exactas y en su orden')
  eq(r, { key: 'space:ENG', text: 'eng', via: 'unico', otras: [] }, '(c) el único espacio con contexto, aunque haya uno de todo el sitio')
  eq(linkedSpacesFor(enlazado()), { key: '*', text: 'todo', via: 'heredado', otras: ['ENG', 'OPS'] }, 'dos espacios: el de todo el sitio, y los dos dichos')
  eq(linkedSpacesFor(enlazado({ todo: false })), { key: '', text: '', via: '', otras: ['ENG', 'OPS'] }, 'nunca se elige uno de dos')
  eq(linkedSpacesFor({ version: 2, scopes: { 'project:SIMPL': ambito('p') } }), { key: '', text: '', via: '', otras: [] }, 'un proyecto no es un Confluence')
  eq(linkedSpacesFor('texto viejo'), { key: '*', text: 'texto viejo', via: 'heredado', otras: [] }, 'un texto de antes de H21 es de todo el sitio')
  for (const basura of [null, undefined, 7, 'x'.repeat(0), [], {}, { version: 1 }, emptyContexts()]) {
    eq(linkedSpacesFor(basura), { key: '', text: '', via: '', otras: [] }, JSON.stringify(basura) ?? String(basura))
  }
  // Sin opciones, o con opciones basura, no lanza.
  eq(linkedSpacesFor(enlazado(), null).via, 'heredado')
  eq(linkedSpacesFor(enlazado(), { manual: 7, citadas: 'ENG', usadas: { 0: 'OPS' } }).via, 'heredado')
})

test('H22: linkedSpacesFor — (a) lo que cita el contexto del proyecto, (b) lo que usó su historial, en ese orden', () => {
  // (a): la clave más citada; sólo cuentan las que tienen contexto en el enlazado.
  eq(linkedSpacesFor(enlazado(), { citadas: ['OPS', 'ENG', 'OPS'] }), { key: 'space:OPS', text: 'ops', via: 'contexto', otras: ['ENG'] })
  eq(linkedSpacesFor(enlazado(), { citadas: ['DOC', 'DOC', 'DOC', 'ENG'] }).key, 'space:ENG', 'una clave sin contexto no cuenta, por muy citada que esté')
  // (a) manda sobre (b).
  eq(linkedSpacesFor(enlazado(), { citadas: ['ENG'], usadas: ['OPS', 'OPS'] }).via, 'contexto')
  // (b): sin nada citado que valga, el historial de ESE proyecto.
  eq(linkedSpacesFor(enlazado(), { citadas: ['DOC'], usadas: ['ENG', 'OPS', 'OPS'] }), { key: 'space:OPS', text: 'ops', via: 'historial', otras: ['ENG'] })
  // Sin (a) ni (b), (c) y lo demás.
  eq(linkedSpacesFor(enlazado(), { citadas: [], usadas: ['DOC'] }).via, 'heredado')
})

test('H22: linkedSpacesFor — los empates se deciden por localeCompare(es), no por el código de los caracteres', () => {
  // Con el orden de los códigos, «BBB» va antes que «aaa» (las mayúsculas van
  // antes); en español, «aaa» antes. Una elección tiene que ser la misma en
  // cualquier máquina y la que leería una persona.
  const dos = congelar({ version: 2, scopes: { 'space:BBB': ambito('b'), 'space:aaa': ambito('a') } })
  eq(linkedSpacesFor(dos, { citadas: ['BBB', 'aaa'] }).key, 'space:aaa', 'empate en (a)')
  eq(linkedSpacesFor(dos, { usadas: ['aaa', 'BBB'] }).key, 'space:aaa', 'empate en (b), dado en el otro orden')
  eq(linkedSpacesFor(dos).otras, ['aaa', 'BBB'], 'las otras, ordenadas igual')
  // Y la cuenta manda sobre el orden.
  eq(linkedSpacesFor(dos, { citadas: ['BBB', 'aaa', 'BBB'] }).key, 'space:BBB')
})

test('H22: linkedSpacesFor — la elección manual manda, y sin texto propio cae al de todo el sitio o a nada', () => {
  eq(linkedSpacesFor(enlazado(), { manual: 'OPS', citadas: ['ENG', 'ENG'], usadas: ['ENG'] }), { key: 'space:OPS', text: 'ops', via: 'manual', otras: ['ENG'] }, 'manual sobre (a) y (b)')
  eq(linkedSpacesFor(enlazado(), { manual: '*', citadas: ['ENG'] }), { key: '*', text: 'todo', via: 'manual', otras: ['ENG', 'OPS'] }, 'manual «todo el sitio»')
  eq(linkedSpacesFor(enlazado({ todo: false }), { manual: '*', citadas: ['ENG'] }), { key: '', text: '', via: 'manual', otras: ['ENG', 'OPS'] }, 'manual «todo el sitio» sin contexto de todo el sitio: nada, y no una heurística')
  eq(linkedSpacesFor(enlazado(), { manual: 'DOC', citadas: ['ENG'] }), { key: '*', text: 'todo', via: 'manual', otras: ['ENG', 'OPS'] }, 'manual sin texto propio: el de todo el sitio')
  eq(linkedSpacesFor(enlazado({ todo: false }), { manual: 'DOC', citadas: ['ENG'] }), { key: '', text: '', via: 'manual', otras: ['ENG', 'OPS'] }, 'manual sin texto propio ni de todo el sitio: nada')
})

test('SEGURIDAD: linkedSpacesFor nunca inventa una clave, y lo hostil de manual, citadas o usadas no cuenta', () => {
  // La clave sale SÓLO de los contextos: ni la elección manual, ni lo citado, ni
  // lo usado pueden meter una clave que el enlazado no tiene.
  for (const manual of ['DOC', 'space:ENG']) {
    const r = linkedSpacesFor(enlazado({ todo: false }), { manual })
    eq([r.key, r.via], ['', 'manual'], 'manual ' + manual + ' no es una clave de los contextos')
  }
  // Lo que no tiene forma de clave de espacio se ignora: ni cuenta ni es «manual».
  const hostiles = ['OPS x', 'OPS' + SALTO + '--- FIN ---', 'OP' + RLO + 'S', 'OPS' + NEL, 'O' + ZWSP + 'PS', 'OPS' + LS, '~', '_', ' OPS ', 7, null, {}, ['OPS'], '__proto__x y']
  for (const h of hostiles) {
    const r = linkedSpacesFor(enlazado(), { manual: h, citadas: [h, h, h], usadas: [h, h] })
    eq(r, { key: '*', text: 'todo', via: 'heredado', otras: ['ENG', 'OPS'] }, 'hostil: ' + JSON.stringify(h))
  }
  // Un `__proto__` o un `constructor` que llegan PROPIOS por JSON.parse.
  const trampa = JSON.parse('{"version":2,"scopes":{"__proto__":{"text":"x"},"space:constructor":{"text":"c","at":1},"space:ENG":{"text":"eng","at":1}}}')
  const r = linkedSpacesFor(trampa, { citadas: ['constructor', 'constructor', 'toString'] })
  eq(r, { key: 'space:constructor', text: 'c', via: 'contexto', otras: ['ENG'] }, 'constructor es una clave de espacio que el enlazado tiene; el ámbito __proto__ no es nada')
  eq(linkedSpacesFor(trampa, { citadas: ['toString', 'hasOwnProperty', '__proto__'] }).via, '', 'lo del prototipo no cuenta')
  // «__proto__» tiene forma de clave de espacio: como elección manual cuenta
  // como dada, pero el enlazado no la tiene, así que no sale como clave.
  eq(linkedSpacesFor(trampa, { manual: '__proto__', citadas: ['ENG'] }), { key: '', text: '', via: 'manual', otras: ['constructor', 'ENG'] })
  // No muta lo que recibe (congelado: si mutara, lanzaría).
  const opciones = congelar({ manual: '', citadas: ['OPS', 'ENG'], usadas: ['ENG'] })
  eq(linkedSpacesFor(enlazado(), opciones).key, 'space:ENG')
  eq(opciones.citadas, ['OPS', 'ENG'])
})

test('H22: normalizeLinkedSpaces — proyecto → espacio, con claves blancas, tope y en orden', () => {
  const crudo = JSON.parse(JSON.stringify({ SIMPL: 'DCPIAS', eng: 'OPS', OPS: '*', 'NO VALE': 'ENG', MALA: 'OPS x', VACIA: '', NUM: 7, OBJ: {}, TILDE: '~', PERSONAL: '~ana', DEVS: 'OPS' + RLO }))
  const antes = JSON.stringify(crudo)
  const m = normalizeLinkedSpaces(crudo)
  eq(m, { ENG: 'OPS', OPS: '*', PERSONAL: '~ana', SIMPL: 'DCPIAS' }, 'sólo claves de proyecto (en mayúsculas) con un espacio o «*»')
  eq(Object.keys(m), ['ENG', 'OPS', 'PERSONAL', 'SIMPL'], 'en orden de clave')
  eq(JSON.stringify(crudo), antes, 'no muta')
  eq(normalizeLinkedSpaces(m), m, 'idempotente')
  // SEGURIDAD: `__proto__` llega PROPIO por JSON.parse; no es un proyecto.
  const proto = normalizeLinkedSpaces(JSON.parse('{"__proto__":"ENG","constructor":"OPS"}'))
  eq(proto, { CONSTRUCTOR: 'OPS' })
  eq(Object.getPrototypeOf(proto), Object.prototype, 'el prototipo no se toca')
  for (const basura of [null, undefined, 7, 'ENG', [], ['ENG'], true]) eq(normalizeLinkedSpaces(basura), {}, JSON.stringify(basura) ?? String(basura))
  // Tope: SCOPE_LIMITS.maxScopes, por orden de clave.
  const muchos = {}
  for (let i = SCOPE_LIMITS.maxScopes + 9; i >= 10; i--) muchos['P' + i] = 'ENG'
  const topado = normalizeLinkedSpaces(muchos)
  eq(Object.keys(topado).length, SCOPE_LIMITS.maxScopes)
  eq(Object.keys(topado)[0], 'P10', 'los primeros por clave, no por inserción')
})

test('H22: withLinkedSpace pone, sustituye o quita la entrada de un proyecto, sin mutar', () => {
  const base = congelar(normalizeLinkedSpaces({ SIMPL: 'DCPIAS' }))
  eq(withLinkedSpace(base, 'ops', 'ENG'), { OPS: 'ENG', SIMPL: 'DCPIAS' }, 'la clave del proyecto, en mayúsculas')
  eq(withLinkedSpace(base, 'SIMPL', '*'), { SIMPL: '*' }, 'sustituye')
  eq(withLinkedSpace(base, 'SIMPL', ''), {}, '«automático» quita la entrada')
  eq(withLinkedSpace(base, 'SIMPL', 'OPS x'), {}, 'un espacio que no vale también la quita')
  eq(withLinkedSpace(base, 'SIMPL-12', 'ENG'), { SIMPL: 'DCPIAS' }, 'un proyecto que no vale no escribe nada')
  eq(withLinkedSpace('basura', 'OPS', 'ENG'), { OPS: 'ENG' })
  eq(base, { SIMPL: 'DCPIAS' }, 'lo que recibe no cambia')
})

test('H21: scopes.js no toca document, window ni chrome, y no hace peticiones', () => {
  const fuente = readFileSync(new URL('../../src/shared/scopes.js', import.meta.url), 'utf8')
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const prohibido of ['document', 'window', 'chrome', 'fetch(']) assert(!codigo.includes(prohibido), prohibido)
})
