/**
 * Qué botones ofrece la tarjeta «Puedo llevarte».
 *
 * Lo que manda es el ajuste del usuario, no la recomendación del modelo:
 * `guided` destaca «Paso a paso» siempre que haya camino, `quick` sólo ofrece
 * «Llévame». Antes había una casilla que sólo cambiaba cuál iba destacado.
 */
import { test, eq } from '../harness.js'
import { navOptions } from '../../src/nav/options.js'

const conCamino = { mode: 'direct', steps: [{ id: 'ENG' }, { id: '100' }, { id: '200' }] }
const sinCamino = { mode: 'direct', steps: [{ id: '200' }] }

test('guiada: con camino, «Paso a paso» destacado y «Llévame» al lado', () => {
  const opts = navOptions(conCamino, { navMode: 'guided' })
  eq(opts.map((o) => o.mode), ['assisted', 'direct'])
  eq(opts[0].kind, 'primary', 'la asistida va destacada')
  eq(opts[1].kind, 'ghost')
})

test('guiada: aunque el modelo recomendara ir de golpe, se ofrece el camino', () => {
  // El plan dice «direct»; el usuario pidió que se intente siempre la guiada.
  eq(navOptions({ ...conCamino, mode: 'direct' }, { navMode: 'guided' })[0].mode, 'assisted')
  eq(navOptions({ ...conCamino, mode: 'assisted' }, { navMode: 'guided' })[0].mode, 'assisted')
})

test('guiada sin camino: sólo cabe ir de golpe', () => {
  eq(navOptions(sinCamino, { navMode: 'guided' }).map((o) => o.mode), ['direct'])
  eq(navOptions({ mode: 'assisted', steps: [] }, { navMode: 'guided' }).map((o) => o.mode), ['direct'])
})

test('rápida: sólo «Llévame», haya camino o no, diga el modelo lo que diga', () => {
  eq(navOptions(conCamino, { navMode: 'quick' }).map((o) => o.mode), ['direct'])
  eq(navOptions({ ...conCamino, mode: 'assisted' }, { navMode: 'quick' }).map((o) => o.mode), ['direct'])
  eq(navOptions(sinCamino, { navMode: 'quick' }).map((o) => o.mode), ['direct'])
  eq(navOptions(conCamino, { navMode: 'quick' })[0].kind, 'primary')
})

test('sin ajustes se comporta como guiada', () => {
  eq(navOptions(conCamino).map((o) => o.mode), ['assisted', 'direct'])
  eq(navOptions(conCamino, {}).map((o) => o.mode), ['assisted', 'direct'])
})

test('un plan nulo no rompe: sólo la directa', () => {
  eq(navOptions(null).map((o) => o.mode), ['direct'])
  eq(navOptions(undefined, { navMode: 'quick' }).map((o) => o.mode), ['direct'])
})

test('siempre hay exactamente una opción destacada', () => {
  for (const plan of [conCamino, sinCamino, { ...conCamino, mode: 'assisted' }, null]) {
    for (const settings of [{}, { navMode: 'guided' }, { navMode: 'quick' }]) {
      const opts = navOptions(plan, settings)
      eq(opts.filter((o) => o.kind === 'primary').length, 1, JSON.stringify({ plan: plan?.mode, settings }))
    }
  }
})
