import { test, eq } from '../harness.js'
import { navOptions } from '../../src/nav/options.js'

const conCamino = { mode: 'direct', steps: [{ id: 'ENG' }, { id: '100' }, { id: '200' }] }
const sinCamino = { mode: 'direct', steps: [{ id: '200' }] }

test('EL FALLO: un plan directo con camino ofrece TAMBIEN paso a paso', () => {
  const opts = navOptions(conCamino)
  eq(opts.map((o) => o.mode), ['direct', 'assisted'])
  eq(opts[0].kind, 'primary', 'la recomendada va destacada')
  eq(opts[1].kind, 'ghost')
})

test('un plan asistido destaca el paso a paso, pero deja ir de golpe', () => {
  const opts = navOptions({ ...conCamino, mode: 'assisted' })
  eq(opts.map((o) => o.mode), ['assisted', 'direct'])
  eq(opts[0].kind, 'primary')
})

test('el ajuste del usuario manda sobre la recomendacion del modelo', () => {
  const opts = navOptions(conCamino, { assistedByDefault: true })
  eq(opts[0].mode, 'assisted')
  eq(opts[0].kind, 'primary')
  eq(opts.length, 2, 'la directa sigue estando')
})

test('sin camino solo cabe la directa', () => {
  eq(navOptions(sinCamino).map((o) => o.mode), ['direct'])
  eq(navOptions({ mode: 'assisted', steps: [] }).map((o) => o.mode), ['direct'])
  eq(navOptions(null).map((o) => o.mode), ['direct'])
})

test('siempre hay exactamente una opcion destacada', () => {
  for (const plan of [conCamino, sinCamino, { ...conCamino, mode: 'assisted' }]) {
    for (const settings of [{}, { assistedByDefault: true }]) {
      const opts = navOptions(plan, settings)
      eq(opts.filter((o) => o.kind === 'primary').length, 1, JSON.stringify({ plan: plan.mode, settings }))
    }
  }
})
