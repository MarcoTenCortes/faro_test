/**
 * De dónde salen los pasos de la navegación guiada.
 *
 * El fallo que motivó todo esto: ante «¿esta ACV tiene su TCV correspondiente?»
 * el modelo devolvía un camino de dos saltos —la página en la que estabas y la
 * de destino—, que en el árbol de Confluence son ramas HERMANAS colgando de
 * sitios distintos. La navegación guiada se quedaba sin nada que desplegar y
 * acababa siendo el salto seco que precisamente quería evitar.
 *
 * La regla nueva: en Confluence el camino es la rama del árbol, y el `path` del
 * modelo no pinta nada. Quién cuelga de quién lo sabe el índice.
 */
import { test, eq, assert } from '../harness.js'
import { normalizeIndex } from '../../src/atlassian/index-store.js'
import { validatePlan, treeSteps, inSpace } from '../../src/nav/validate.js'
import { navOptions } from '../../src/nav/options.js'

const HOST = 'confluence.simplprogramme.eu'
const ORIGIN = 'https://confluence.simplprogramme.eu'

/** El árbol real del usuario, con las dos ramas hermanas ACV y TCV. */
const INDEX = normalizeIndex(
  {
    spaces: [{ key: 'SIMPL', name: 'SIMPL', url: '/spaces/SIMPL' }],
    pages: [
      { id: '1080', title: '1080 - Architecture', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/1080/Architecture' },
      { id: '1081', title: '1081 - D1.3.x', spaceKey: 'SIMPL', parentId: '1080', url: '/spaces/SIMPL/pages/1081/D13x' },

      // Rama ACV (donde está el usuario)
      { id: '2001', title: 'Simpl-Open Application Architecture', spaceKey: 'SIMPL', parentId: '1081', url: '/spaces/SIMPL/pages/2001/AppArch' },
      { id: '2002', title: 'ACV - Domain 1 - Static Views', spaceKey: 'SIMPL', parentId: '2001', url: '/spaces/SIMPL/pages/2002/ACVStatic' },
      { id: '2003', title: 'ACV Static - Identity Provider Service', spaceKey: 'SIMPL', parentId: '2002', url: '/spaces/SIMPL/pages/2003/ACVIdP' },

      // Rama TCV (a donde hay que llegar)
      { id: '3001', title: 'Simpl-Open Technology Architecture', spaceKey: 'SIMPL', parentId: '1081', url: '/spaces/SIMPL/pages/3001/TechArch' },
      { id: '3002', title: 'TCV - Domain 1 - Static Views', spaceKey: 'SIMPL', parentId: '3001', url: '/spaces/SIMPL/pages/3002/TCVStatic' },
      { id: '98830281', title: 'TCV Static - Identity Provider Service', spaceKey: 'SIMPL', parentId: '3002', url: '/spaces/SIMPL/pages/98830281/TCVIdP' },
    ],
  },
  HOST,
  null,
  { wikiPrefix: '' }
)

const EN_LA_ACV = ORIGIN + '/spaces/SIMPL/pages/2003/ACVIdP'

/** El camino de dos saltos que devolvía el modelo. */
const PLAN_DEL_MODELO = {
  navigate: true,
  mode: 'assisted',
  destination: { kind: 'confluence-page', id: '98830281' },
  path: [
    { kind: 'confluence-page', id: '2003', label: 'ACV Static - Identity Provider Service (origen)' },
    { kind: 'confluence-page', id: '98830281', label: 'TCV Static - Identity Provider Service (destino)' },
  ],
  explanation: 'Te guío desde la ACV hasta su TCV equivalente.',
}

test('EL FALLO: el camino del modelo eran dos ramas hermanas, no un recorrido', () => {
  const r = validatePlan(PLAN_DEL_MODELO, { index: INDEX, origin: ORIGIN, host: HOST, here: EN_LA_ACV })
  assert(r.ok, r.reason)

  eq(
    r.plan.steps.map((s) => s.id),
    ['1080', '1081', '3001', '3002', '98830281'],
    'debe salir la rama entera del árbol'
  )
  assert(!r.plan.steps.some((s) => s.id === '2003'), 'la página de origen no es un paso del camino')
})

test('sólo el último paso navega; los cinco de arriba despliegan', () => {
  const r = validatePlan(PLAN_DEL_MODELO, { index: INDEX, origin: ORIGIN, host: HOST, here: EN_LA_ACV })
  const acciones = r.plan.steps.map((s) => s.action)
  eq(acciones[acciones.length - 1], 'open')
  assert(acciones.slice(0, -1).every((a) => a === 'expand'), acciones.join(','))
})

test('con un recorrido de verdad ya se puede ofrecer «Paso a paso»', () => {
  const r = validatePlan(PLAN_DEL_MODELO, { index: INDEX, origin: ORIGIN, host: HOST, here: EN_LA_ACV })
  eq(navOptions(r.plan).map((o) => o.mode), ['assisted', 'direct'])
})

// --- el salto al espacio -------------------------------------------------
// Abrir la portada del espacio es una carga de página completa, y eso pliega el
// árbol entero. Estando ya dentro es tirar por la borda lo único que el
// recorrido necesita conservar.

test('estando ya en el espacio, no se salta a su portada', () => {
  const pasos = treeSteps(INDEX, ORIGIN, { kind: 'confluence-page', id: '98830281' }, EN_LA_ACV)
  assert(!pasos.some((s) => s.kind === 'confluence-space'), pasos.map((s) => s.id).join(','))
})

test('viniendo de fuera, el espacio sí es la primera parada', () => {
  const pasos = treeSteps(INDEX, ORIGIN, { kind: 'confluence-page', id: '98830281' }, 'https://otro.example/algo')
  eq(pasos[0].kind, 'confluence-space')
  eq(pasos[0].id, 'SIMPL')
})

test('sin saber dónde estamos, el espacio se conserva', () => {
  const pasos = treeSteps(INDEX, ORIGIN, { kind: 'confluence-page', id: '98830281' })
  eq(pasos[0].id, 'SIMPL')
})

test('inSpace reconoce Cloud, Data Center y el parámetro suelto', () => {
  eq(inSpace('/wiki/spaces/SIMPL/pages/1/X', 'SIMPL'), true)
  eq(inSpace('/spaces/SIMPL', 'SIMPL'), true)
  eq(inSpace('/spaces/SIMPL/', 'SIMPL'), true)
  eq(inSpace('https://x.example/display/SIMPL/Titulo', 'SIMPL'), true)
  eq(inSpace('/pages/viewpage.action?spaceKey=SIMPL&pageId=9', 'SIMPL'), true)
  eq(inSpace('/spaces/SIMPLOTRO/pages/1/X', 'SIMPL'), false, 'no vale un prefijo de otra clave')
  eq(inSpace('/spaces/OTRO/pages/1/X', 'SIMPL'), false)
  eq(inSpace('', 'SIMPL'), false)
  eq(inSpace('/spaces/SIMPL', ''), false)
})

// --- cuando el árbol no se conoce ----------------------------------------

test('sin jerarquía no se inventa un camino: se lleva de golpe', () => {
  const suelta = normalizeIndex(
    { pages: [{ id: '900', title: 'Suelta', url: '/spaces/SIMPL/pages/900/S', spaceKey: 'SIMPL' }] },
    HOST,
    null,
    { wikiPrefix: '' }
  )
  const r = validatePlan(
    {
      navigate: true,
      mode: 'assisted',
      destination: { kind: 'confluence-page', id: '900' },
      path: [
        { kind: 'confluence-page', id: '900', label: 'Inventado' },
        { kind: 'confluence-page', id: '900', label: 'Inventado otra vez' },
      ],
      explanation: 'x',
    },
    { index: suelta, origin: ORIGIN, host: HOST, here: '/spaces/SIMPL/pages/1/X' }
  )
  assert(r.ok, r.reason)
  eq(r.plan.steps.map((s) => s.id), ['900'], 'sólo el destino')
  eq(r.plan.mode, 'direct', 'con un único paso no hay recorrido que enseñar')
})
