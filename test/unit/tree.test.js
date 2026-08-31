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
import { indexTreePrompt, ancestryPrompt, TREE_SCHEMA, baseSystem } from '../../src/panel/prompts.js'

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

test('ancestryPrompt exige la cadena entera, no solo la pagina', () => {
  const p = ancestryPrompt('83206087', 'ACV Static')
  assert(p.includes('83206087'))
  assert(/ancestors/i.test(p), 'debe nombrar el campo real de la herramienta')
  assert(/CADENA COMPLETA/i.test(p), 'y pedir la cadena entera')
  assert(/una sola pagina|una sola página/i.test(p), 'y avisar de que una sola pagina no sirve')
  assert(/no inventes/i.test(p))
})

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
