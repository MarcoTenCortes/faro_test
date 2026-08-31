/**
 * «Ya estoy aquí» y localización por ruta.
 *
 * Caso real: la asistida decia «No encuentro este paso» estando el usuario
 * justo en la pagina de destino. Confluence pinta la pagina actual en el arbol
 * como texto en negrita, SIN enlace, asi que no hay nada que pulsar; y como el
 * id del indice no coincidia con el de la URL, tampoco se reconocia que ya
 * habiamos llegado.
 */
import { test, eq, assert } from '../harness.js'
import { isAlreadyHere, samePagePath } from '../../src/content/runner.js'
import { hrefDescriptors, locatorPlan } from '../../src/content/locators.js'

const loc = (pathname, search = '') => ({ pathname, search })

test('samePagePath: el id de pagina manda sobre el slug', () => {
  eq(samePagePath('/spaces/SIMPL/pages/83206087', '/spaces/SIMPL/pages/83206087/ACV+Static'), true)
  eq(samePagePath('/spaces/SIMPL/pages/83206087/Otro+Titulo', '/spaces/SIMPL/pages/83206087/ACV+Static'), true)
  eq(samePagePath('/pages/viewpage.action?pageId=83206087', '/spaces/SIMPL/pages/83206087/ACV'), true)
})

test('samePagePath: paginas distintas no se confunden', () => {
  eq(samePagePath('/spaces/SIMPL/pages/111/A', '/spaces/SIMPL/pages/222/B'), false)
  eq(samePagePath('', '/spaces/X/pages/1'), false)
  eq(samePagePath('/a', ''), false)
})

test('samePagePath: sin id, vale que una sea prefijo de segmento de la otra', () => {
  eq(samePagePath('/display/SIMPL/ACV+Static', '/display/SIMPL/ACV+Static'), true)
  eq(samePagePath('/spaces/SIMPL', '/spaces/SIMPL/overview'), true)
  eq(samePagePath('/a/b', '/a/bcd'), false, 'prefijo de texto no basta: tiene que ser de segmento')
})

test('estar DENTRO de un espacio no es estar EN el espacio', () => {
  // Si se confunden, el primer paso del recorrido se da por hecho y la
  // asistida no se mueve.
  eq(samePagePath('/wiki/spaces/ENG', '/wiki/spaces/ENG/pages/400/Onboarding'), false)
  eq(isAlreadyHere({ kind: 'confluence-space', id: 'ENG', path: '/wiki/spaces/ENG' },
    loc('/wiki/spaces/ENG/pages/400/Onboarding')), false)
})

test('EL FALLO: se reconoce la pagina actual aunque el id del indice no cuadre', () => {
  const step = {
    kind: 'confluence-page',
    id: '98830281', // el que guardo el indice, equivocado
    path: '/spaces/SIMPL/pages/83206087/ACV+Static+-+Identity+Provider+Service',
    title: 'ACV Static - Identity Provider Service',
  }
  const aqui = loc('/spaces/SIMPL/pages/83206087/ACV+Static+-+Identity+Provider+Service')
  eq(isAlreadyHere(step, aqui), true, 'por ruta deberia reconocerlo')
})

test('sigue funcionando por id cuando el id es el bueno', () => {
  const step = { kind: 'confluence-page', id: '83206087' }
  eq(isAlreadyHere(step, loc('/spaces/SIMPL/pages/83206087/Algo')), true)
  eq(isAlreadyHere(step, loc('/pages/viewpage.action', '?pageId=83206087')), true)
  eq(isAlreadyHere(step, loc('/spaces/SIMPL/pages/999/Otra')), false)
})

test('incidencias y proyectos de Jira', () => {
  eq(isAlreadyHere({ kind: 'jira-issue', id: 'ENG-7' }, loc('/browse/ENG-7')), true)
  eq(isAlreadyHere({ kind: 'jira-issue', id: 'ENG-7' }, loc('/jira/x', '?selectedIssue=ENG-7')), true)
  eq(isAlreadyHere({ kind: 'jira-project', id: 'ENG' }, loc('/projects/ENG/issues')), true)
})

test('sin ubicacion no se inventa nada', () => {
  eq(isAlreadyHere({ kind: 'confluence-page', id: '1' }, null), false)
  eq(isAlreadyHere(null, loc('/x')), false)
})

test('el localizador busca TAMBIEN por la ruta, no solo por el id', () => {
  const step = {
    kind: 'confluence-page',
    id: '98830281',
    path: '/spaces/SIMPL/pages/83206087/ACV+Static+-+Identity+Provider+Service',
  }
  const d = hrefDescriptors(step)
  eq(d[0], { by: 'href-end', value: '/spaces/SIMPL/pages/83206087/ACV+Static+-+Identity+Provider+Service' })
  assert(d.some((x) => x.value === '/pages/98830281/'), 'y sigue probando por id despues')
})

test('la ruta se limpia de query y de ancla antes de comparar', () => {
  const d = hrefDescriptors({ kind: 'confluence-page', id: '5', path: '/spaces/X/pages/5/T?src=nav#seccion' })
  eq(d[0].value, '/spaces/X/pages/5/T')
})

test('se prueban el titulo Y la etiqueta larga del modelo', () => {
  const plan = locatorPlan({
    kind: 'confluence-page',
    id: '5',
    title: 'ACV Static - Identity Provider Service',
    label: 'Su ACV correspondiente: ACV Static - Identity Provider Service (vista de componentes)',
  })
  const nombres = plan.filter((p) => p.by === 'text-link').map((p) => p.name)
  eq(nombres.length, 2, 'los dos nombres')
  eq(nombres[0], 'ACV Static - Identity Provider Service', 'el titulo primero, que es lo que pone el arbol')
})

test('si titulo y etiqueta coinciden, no se duplica', () => {
  const plan = locatorPlan({ kind: 'confluence-page', id: '5', title: 'X', label: 'X' })
  eq(plan.filter((p) => p.by === 'text-link').length, 1)
})

// --- desplegar el arbol hacia un destino profundo -------------------------
// Caso real: la pagina esta a seis niveles («Architecture → D1.3.x →
// Application Architecture → Components Views → ACV Domain 1 → Static Views»)
// y toda la rama esta plegada. Una sola pasada no llega.

import { targetKeywords, branchScore } from '../../src/content/runner.js'

test('las palabras clave salen del titulo Y del slug de la ruta', () => {
  const claves = targetKeywords({
    title: 'ACV Static - Identity Provider Service',
    path: '/spaces/SIMPL/pages/83206087/ACV+Static+-+Identity+Provider+Service',
  })
  for (const w of ['acv', 'static', 'identity', 'provider', 'service', 'simpl']) {
    assert(claves.has(w), 'falta ' + w)
  }
  assert(!claves.has('83206087'), 'los numeros sueltos no distinguen nada')
  assert(!claves.has('de'), 'las palabras cortas tampoco')
})

test('una rama se prioriza por las palabras que comparte con el destino', () => {
  const claves = targetKeywords({ title: 'ACV Static - Identity Provider Service' })
  const acv = branchScore('ACV - Domain 1 - Access Control & Trust - Static Views', claves)
  const otra = branchScore('1020 - Memos & Meeting Notes', claves)
  assert(acv > otra, `la rama del ACV deberia puntuar mas: ${acv} vs ${otra}`)
  eq(otra, 0)
})

test('branchScore no revienta con entradas vacias', () => {
  eq(branchScore('', new Set(['a'])), 0)
  eq(branchScore('hola', new Set()), 0)
  eq(branchScore(null, null), 0)
})
