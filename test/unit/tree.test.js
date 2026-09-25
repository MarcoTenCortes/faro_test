/**
 * La jerarquia de paginas.
 *
 * Es la raiz de que la navegacion asistida no se pudiera ofrecer: el indice
 * guardaba paginas sueltas, sin `parentId`, asi que no habia camino que
 * ensenar y el plan salia con un unico paso — el destino. La tarjeta entonces
 * solo podia ofrecer «Llevame».
 */
import { test, eq, assert } from '../harness.js'
import { mergeTree, countWithParent } from '../../src/panel/indexer.js'
import { normalizeIndex, ancestryOf } from '../../src/atlassian/index-store.js'
import { validatePlan } from '../../src/nav/validate.js'
import { navOptions } from '../../src/nav/options.js'
import { indexTreePrompt, TREE_SCHEMA, baseSystem } from '../../src/panel/prompts.js'

const HOST = 'confluence.simplprogramme.eu'
const ORIGIN = 'https://confluence.simplprogramme.eu'
const DC = { host: HOST, origin: ORIGIN, cloud: false, wikiPrefix: '' }

const plano = normalizeIndex(
  {
    spaces: [{ key: 'SIMPL', name: 'SIMPL', url: '/spaces/SIMPL' }],
    pages: [
      { id: '1080', title: '1080 - Architecture', url: '/spaces/SIMPL/pages/1080/Arch' },
      { id: '1084', title: 'ACV - Domain 1', url: '/spaces/SIMPL/pages/1084/ACV' },
      { id: '83206087', title: 'ACV Static - Identity Provider Service', url: '/spaces/SIMPL/pages/83206087/ACV+Static', spaceKey: 'SIMPL' },
    ],
  },
  HOST, null, { wikiPrefix: '' }
)

const arbol = normalizeIndex(
  {
    pages: [
      { id: '1080', title: '1080 - Architecture' },
      { id: '1084', title: 'ACV - Domain 1', parentId: '1080' },
      { id: '83206087', title: 'ACV Static - Identity Provider Service', parentId: '1084' },
    ],
  },
  HOST, null, { wikiPrefix: '' }
)

test('EL FALLO: sin jerarquia el plan sale con un unico paso', () => {
  const r = validatePlan(
    { navigate: true, mode: 'assisted', destination: { kind: 'confluence-page', id: '83206087' }, explanation: 'x' },
    { index: plano, origin: ORIGIN, host: HOST }
  )
  assert(r.ok)
  eq(r.plan.steps.map((s) => s.id), ['SIMPL', '83206087'], 'espacio + destino, sin nada en medio')
  eq(countWithParent(plano), 0, 'ninguna pagina sabe quien es su padre')
})

test('con el arbol fundido, el camino aparece entero', () => {
  const conArbol = mergeTree(plano, arbol)
  eq(countWithParent(conArbol), 2)
  eq(ancestryOf(conArbol, '83206087').map((p) => p.id), ['1080', '1084', '83206087'])

  const r = validatePlan(
    { navigate: true, mode: 'assisted', destination: { kind: 'confluence-page', id: '83206087' }, explanation: 'x' },
    { index: conArbol, origin: ORIGIN, host: HOST }
  )
  eq(r.plan.steps.map((s) => s.id), ['SIMPL', '1080', '1084', '83206087'])
  eq(navOptions(r.plan).map((o) => o.mode), ['assisted', 'direct'], 'y ya se puede ofrecer paso a paso')
})

test('mergeTree conserva titulos y rutas que ya teniamos', () => {
  const conArbol = mergeTree(plano, arbol)
  eq(conArbol.pages['83206087'].path, '/spaces/SIMPL/pages/83206087/ACV+Static', 'la ruta buena no se pierde')
  eq(conArbol.pages['83206087'].title, 'ACV Static - Identity Provider Service')
  eq(conArbol.pages['83206087'].parentId, '1084', 'y gana el padre del arbol')
})

test('mergeTree admite paginas que solo estaban en el arbol', () => {
  const soloArbol = normalizeIndex({ pages: [{ id: '999', title: 'Nueva', parentId: '1080' }] }, HOST, null, { wikiPrefix: '' })
  const r = mergeTree(plano, soloArbol)
  assert(r.pages['999'], 'debe entrar')
  eq(r.pages['999'].parentId, '1080')
})

test('el prompt del arbol pide el padre y nombra la herramienta', () => {
  const p = indexTreePrompt({ kind: 'space', key: 'SIMPL' })
  assert(/padre/i.test(p), 'tiene que pedir el padre')
  assert(p.includes('SIMPL'), 'y acotar al espacio')
  assert(/space_page_tree|arbol de paginas|árbol de páginas/i.test(p), 'y decir con que herramienta')
  assert(/no te inventes/i.test(p), 'y prohibir inventarse relaciones')
})

test('el esquema del arbol exige id y titulo, y admite el padre', () => {
  const props = TREE_SCHEMA.properties.pages.items.properties
  assert(props.id && props.title && props.parentId)
  eq(TREE_SCHEMA.properties.pages.items.required, ['id', 'title'])
})

// Los antepasados de una pagina suelta ya no se le piden al modelo: se leen de
// la API REST del propio Confluence. Eso vive en test/unit/confluence-rest.test.js
// y en test/unit/planner.test.js.

test('el modelo tiene prohibido improvisar recorridos', () => {
  // Vino de una conversacion real: el modelo se puso a escribir «1. abre la
  // barra lateral, 2. despliega...» en vez de dejar que lo hiciera la tarjeta.
  const s = baseSystem({ site: { product: 'confluence', host: HOST } })
  assert(/no escribas recorridos|NO escribas recorridos/i.test(s), 'debe prohibirlo explicitamente')
  assert(/tarjeta/i.test(s), 'y explicar que de eso se encarga la tarjeta')
  assert(/Paso a paso/i.test(s), 'nombrando los botones que si existen')
})

// --- desplegar en vez de navegar -----------------------------------------
// Lo que pidio el usuario: «que a traves del menu del arbol de la izquierda
// vaya abriendo los que son necesarios hasta llegar al adecuado». Ocho cargas
// de pagina seguidas no es guiar por el arbol.

import { markActions } from '../../src/nav/validate.js'

test('EL CAMBIO: solo el ultimo paso navega; los demas despliegan', () => {
  const pasos = markActions([
    { kind: 'confluence-space', id: 'SIMPL' },
    { kind: 'confluence-page', id: '1080' },
    { kind: 'confluence-page', id: '1084' },
    { kind: 'confluence-page', id: '83206087' },
  ])
  eq(pasos.map((p) => p.action), ['open', 'expand', 'expand', 'open'])
})

test('un recorrido de un solo paso abre, no despliega', () => {
  eq(markActions([{ kind: 'confluence-page', id: '1' }]).map((p) => p.action), ['open'])
})

test('el espacio se abre: no es una rama del arbol', () => {
  const pasos = markActions([
    { kind: 'confluence-space', id: 'SIMPL' },
    { kind: 'confluence-page', id: '9' },
  ])
  eq(pasos[0].action, 'open')
})

test('el plan completo marca las acciones', () => {
  const conArbol = mergeTree(plano, arbol)
  const r = validatePlan(
    { navigate: true, mode: 'assisted', destination: { kind: 'confluence-page', id: '83206087' }, explanation: 'x' },
    { index: conArbol, origin: ORIGIN, host: HOST }
  )
  const acciones = r.plan.steps.map((s) => s.action)
  eq(acciones[acciones.length - 1], 'open', 'el destino se abre')
  assert(acciones.slice(1, -1).every((a) => a === 'expand'), 'los intermedios se despliegan: ' + acciones.join(','))
})

// --- la forma del arbol: un menu no es una rama (M9, auditoria 2026-09-13) --
// `expandersIn` recogia TODOS los `[aria-expanded="false"]` visibles de la
// barra lateral, y el «···» de acciones de cada fila lleva justo eso. Aqui se
// prueba con elementos de mentira: `visible()` necesita `getComputedStyle`,
// que se instala DENTRO de cada prueba y se restaura al salir.

import { isMenuTrigger, expandersIn, toggleFor, treeContainer } from '../../src/content/tree-dom.js'

/** Un control de mentira: lo justo para `visible()`, `matches` y `closest`. */
function control(attrs = {}, { fila = null } = {}) {
  return {
    isConnected: true,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    matches: () => false,
    closest: () => fila,
    ownerDocument: null,
    querySelectorAll: () => [],
  }
}

function conEstilos(fn) {
  const previo = globalThis.getComputedStyle
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' })
  try {
    return fn()
  } finally {
    if (previo === undefined) delete globalThis.getComputedStyle
    else globalThis.getComputedStyle = previo
  }
}

test('isMenuTrigger: aria-haspopup que no sea «false», o aria-controls hacia un role=menu', () => {
  eq(isMenuTrigger(control({ 'aria-haspopup': 'true' })), true)
  eq(isMenuTrigger(control({ 'aria-haspopup': 'menu' })), true)
  eq(isMenuTrigger(control({ 'aria-haspopup': ' Dialog ' })), true, 'sin distinguir mayusculas ni espacios')
  eq(isMenuTrigger(control({ 'aria-haspopup': 'false' })), false)
  eq(isMenuTrigger(control({ 'aria-haspopup': '' })), false)
  eq(isMenuTrigger(control({ 'aria-expanded': 'false' })), false, 'un chevron normal')
  const menu = { getAttribute: (n) => (n === 'role' ? 'menu' : null) }
  const grupo = { getAttribute: (n) => (n === 'role' ? 'group' : null) }
  const doc = { getElementById: (id) => ({ m1: menu, g1: grupo })[id] || null }
  const haciaMenu = control({ 'aria-controls': 'm1' })
  haciaMenu.ownerDocument = doc
  eq(isMenuTrigger(haciaMenu), true)
  const haciaGrupo = control({ 'aria-controls': 'g1' })
  haciaGrupo.ownerDocument = doc
  eq(isMenuTrigger(haciaGrupo), false, 'el grupo de hijas de un arbol ARIA no es un menu')
  const variosIds = control({ 'aria-controls': 'g1 m1' })
  variosIds.ownerDocument = doc
  eq(isMenuTrigger(variosIds), true, 'basta con que uno de los ids sea un menu')
  eq(isMenuTrigger(null), false)
  eq(isMenuTrigger({}), false)
})

test('SEGURIDAD: expandersIn salta los disparadores de menu y se queda con los chevrones', () => {
  conEstilos(() => {
    const chevron = control({ 'aria-expanded': 'false' })
    const menu = control({ 'aria-expanded': 'false', 'aria-haspopup': 'true' })
    const oculto = control({ 'aria-expanded': 'false' })
    oculto.getBoundingClientRect = () => ({ width: 0, height: 0 })
    const container = { querySelectorAll: () => [menu, chevron, oculto] }
    const out = expandersIn(container)
    eq(out.length, 1)
    assert(out[0] === chevron, 'solo el chevron')
  })
  eq(expandersIn(null), [])
})

// --- el contenedor del pagetree clasico (F9, verificacion en real 2026-09-21)
// En el Confluence 9.2 Data Center del usuario `describeTree()` contestaba
// «(ninguno) — sin contenedor no hay recorrido posible»: en esa pagina no hay
// <aside>, ni role=tree, ni nav[aria-label*=pagina], ni un solo data-testid. El
// arbol es el pagetree clasico, y con el contenedor senalado a mano TODO lo
// demas ya funcionaba. `treeContainer` no toca el estilo de nada, asi que estas
// dos pruebas no necesitan `conEstilos`.

/** Un contenedor de mentira: lo justo para `looksLikeTree`. */
function caja(nombre, { paginas = [], expandibles = false } = {}) {
  return {
    nombre,
    querySelectorAll: (sel) =>
      sel === 'a[href]' ? paginas.map((href) => ({ getAttribute: () => href })) : [],
    querySelector: (sel) => (sel === '[aria-expanded]' && expandibles ? { nombre: 'chevron' } : null),
  }
}

/** Una raiz que contesta a cada selector con lo que se le diga, y nada mas. */
function raiz(porSelector) {
  return { querySelectorAll: (sel) => porSelector[sel] || [] }
}

const PAGETREE_REAL = '/spaces/SIMPL/pages/44171766/Architecture+Topics?src=contextnavpagetreemode'

test('F9: el pagetree de un Data Center se reconoce, y no le quita el sitio a las dos barras que ya funcionaban', () => {
  const pagetree = caja('.plugin_pagetree', { paginas: [PAGETREE_REAL], expandibles: true })

  // Lo que pasaba en real: el pagetree es lo UNICO que hay.
  eq(treeContainer(raiz({ '.plugin_pagetree': [pagetree] })), pagetree, 'sin el, describeTree decia «(ninguno)»')

  // Y lo que no puede cambiar: donde hay un arbol ARIA o el contenedor de Cloud,
  // siguen mandando ellos (el banco lo pina en los tramos 15 y 16).
  const aria = caja('[role="tree"]', { paginas: ['/wiki/spaces/ENG/pages/100/Arquitectura'], expandibles: true })
  eq(
    treeContainer(raiz({ '[role="tree"]': [aria], '.plugin_pagetree': [pagetree] })),
    aria,
    'el arbol ARIA es lo primero de la cascada'
  )
  const cloud = caja('[data-testid="side-navigation"]', { paginas: ['/wiki/spaces/ENG/pages/1080/Architecture'] })
  eq(
    treeContainer(raiz({ '[data-testid="side-navigation"]': [cloud], '.plugin_pagetree': [pagetree] })),
    cloud,
    'y el contenedor de Cloud va antes que el pagetree'
  )
})

test('un [role="complementary"] que no parece un arbol no le gana al que si', () => {
  const pagetree = caja('.plugin_pagetree', { paginas: [PAGETREE_REAL], expandibles: true })
  const ajeno = caja('ajeno')
  const conArbol = caja('con arbol', { paginas: [PAGETREE_REAL] })

  // Dentro del mismo selector, gana el que contiene arbol de verdad.
  eq(
    treeContainer(raiz({ '[role="complementary"]': [ajeno, conArbol] })),
    conArbol,
    'el panel de «Actividad reciente» no es el arbol de paginas'
  )

  // Y el pagetree, que es el selector exacto, gana a los dos envoltorios.
  eq(
    treeContainer(
      raiz({ '.plugin_pagetree': [pagetree], '.ia-secondary-content': [conArbol], '[role="complementary"]': [ajeno] })
    ),
    pagetree
  )

  // Sin ningun candidato con arbol se devuelve el primero que caso, que es lo
  // que `describeTree` ensena para poder ajustar los selectores con datos.
  eq(treeContainer(raiz({ '[role="complementary"]': [ajeno] })), ajeno)
  eq(treeContainer(raiz({})), null)
})

test('toggleFor no toma el «···» de la fila por su control de desplegar', () => {
  conEstilos(() => {
    const fila = control({})
    const menu = control({ 'aria-expanded': 'false', 'aria-haspopup': 'true' }, { fila })
    const chevron = control({ 'aria-expanded': 'false' }, { fila })
    fila.querySelectorAll = () => [menu, chevron]
    const t = toggleFor(fila)
    assert(t && t.toggle === chevron, 'el chevron, aunque el menu vaya antes en el DOM')
    eq(t.isRow, false)

    // Una fila que solo tiene el menu no tiene control de desplegar.
    fila.querySelectorAll = () => [menu]
    eq(toggleFor(fila), null)
  })
})
