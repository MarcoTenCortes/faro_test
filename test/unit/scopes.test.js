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
  linkedContextFor,
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

test('H21: hasMap — un indexado válido, o páginas de ese espacio; y nada más', () => {
  const idx = indice()
  const c = { version: 2, scopes: { 'project:SIMPL': ambito('p', { indexedAt: AYER }), 'space:DOC': ambito('d', { indexedAt: AYER }), 'space:WIKI': ambito('w'), '*': ambito('t') } }
  eq(hasMap(c, null, 'space:DOC'), true, 'con indexado aunque no haya índice')
  eq(hasMap(emptyContexts(), idx, 'space:ENG'), true, 'con páginas del espacio aunque no haya contexto')
  eq(hasMap(c, idx, 'space:WIKI'), false, 'contexto sin indexado y sin páginas: sin mapa')
  eq(hasMap(c, idx, 'project:SIMPL'), true)
  eq(hasMap(emptyContexts(), idx, 'project:SIMPL'), false, 'un proyecto sólo por su indexado')
  eq(hasMap(c, idx, '*'), false, 'todo el sitio sólo por su indexado, aunque haya páginas')
  eq(hasMap(emptyContexts(), idx, 'space:A"B'), false)
  eq(hasMap(null, null, 'space:ENG'), false)
})

test('H21: otherScopesWithMap da los OTROS espacios con mapa, de los contextos y del índice', () => {
  const c = { version: 2, scopes: { 'space:DOC': ambito('d', { indexedAt: AYER }), 'space:WIKI': ambito('w'), 'project:SIMPL': ambito('p', { indexedAt: AYER }) } }
  eq(otherScopesWithMap(c, indice(), 'space:ENG'), ['space:DOC', 'space:OPS'], 'sin el de ahora, sin proyectos y sin el que no tiene mapa')
  eq(otherScopesWithMap(c, indice(), 'space:DCPIAS'), ['space:DOC', 'space:ENG', 'space:OPS'])
  eq(otherScopesWithMap(null, null, '*'), [])
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

// ---- desde Jira ---------------------------------------------------------------

test('H21: linkedContextFor — el de todo el sitio manda, uno solo vale, dos no', () => {
  eq(linkedContextFor({ version: 2, scopes: { 'space:ENG': ambito('eng'), '*': ambito('todo') } }), { key: '*', text: 'todo' })
  eq(linkedContextFor({ version: 2, scopes: { 'space:ENG': ambito('eng') } }), { key: 'space:ENG', text: 'eng' })
  eq(linkedContextFor({ version: 2, scopes: { 'space:ENG': ambito('eng'), 'space:OPS': ambito('ops') } }), { key: '', text: '' }, 'nunca se elige uno de dos')
  eq(linkedContextFor({ version: 2, scopes: { 'project:SIMPL': ambito('p') } }), { key: '', text: '' }, 'un proyecto no es un Confluence')
  eq(linkedContextFor(emptyContexts()), { key: '', text: '' })
  eq(linkedContextFor('texto viejo'), { key: '*', text: 'texto viejo' }, 'un texto de antes de H21 es de todo el sitio')
})

test('H21: scopes.js no toca document, window ni chrome, y no hace peticiones', () => {
  const fuente = readFileSync(new URL('../../src/shared/scopes.js', import.meta.url), 'utf8')
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const prohibido of ['document', 'window', 'chrome', 'fetch(']) assert(!codigo.includes(prohibido), prohibido)
})
