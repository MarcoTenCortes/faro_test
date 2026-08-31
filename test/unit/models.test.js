import { test, eq, assert } from '../harness.js'
import { pickDefaultModel, pickAlternativeModel, modelKey, parseModelKey } from '../../src/shared/models.js'

const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.4', providerName: 'openai', name: 'gpt-5.4', free: false },
  { providerID: 'github-copilot', modelID: 'claude-sonnet-4.6', providerName: 'github-copilot', name: 'claude-sonnet-4.6', free: false },
  { providerID: 'github-copilot', modelID: 'claude-haiku-4.5', providerName: 'github-copilot', name: 'claude-haiku-4.5', free: false },
  { providerID: 'opencode', modelID: 'hy3-free', providerName: 'opencode', name: 'hy3-free', free: true },
  { providerID: 'opencode', modelID: 'big-pickle', providerName: 'opencode', name: 'big-pickle', free: false },
]

const DEFAULTS = { openai: 'gpt-5.4', 'github-copilot': 'claude-sonnet-4.6', opencode: 'big-pickle' }

test('modelo por defecto: el primero de defaults que exista', () => {
  eq(pickDefaultModel(MODELS, DEFAULTS).modelID, 'gpt-5.4')
  eq(pickDefaultModel(MODELS, { inexistente: 'x' }).modelID, 'gpt-5.4')
  eq(pickDefaultModel([], DEFAULTS), null)
})

test('alternativa: cambia de PROVEEDOR, no solo de modelo', () => {
  // El caso real: la sesion OAuth de openai caduco.
  const alt = pickAlternativeModel(MODELS, DEFAULTS, 'openai')
  assert(alt, 'deberia haber alternativa')
  assert(alt.providerID !== 'openai', 'no vale otro modelo del mismo proveedor caido')
  eq(alt.modelID, 'claude-sonnet-4.6')
})

test('alternativa: respeta el orden de defaults', () => {
  const alt = pickAlternativeModel(MODELS, DEFAULTS, 'github-copilot')
  eq(alt.providerID, 'openai')
})

test('alternativa: si ningun defaults sirve, prefiere lo gratuito', () => {
  const alt = pickAlternativeModel(MODELS, { openai: 'gpt-5.4' }, 'openai')
  eq(alt.free, true)
  eq(alt.modelID, 'hy3-free')
})

test('alternativa: con un solo proveedor no hay salida', () => {
  const solo = MODELS.filter((m) => m.providerID === 'openai')
  eq(pickAlternativeModel(solo, DEFAULTS, 'openai'), null)
  eq(pickAlternativeModel([], DEFAULTS, 'openai'), null)
})

test('claves de modelo: ida y vuelta', () => {
  eq(modelKey({ providerID: 'a', modelID: 'b' }), 'a/b')
  eq(parseModelKey('a/b'), { providerID: 'a', modelID: 'b' })
  // Hay modelos con barra en el id.
  eq(parseModelKey('openrouter/meta/llama-3'), { providerID: 'openrouter', modelID: 'meta/llama-3' })
  eq(parseModelKey('sin-barra'), null)
  eq(parseModelKey(''), null)
  eq(modelKey(null), '')
})

// --- modelo del planificador ---------------------------------------------
// El planificador solo extrae un destino de un texto ya escrito. Con el modelo
// grande de la conversacion se hacia esperar varios segundos justo despues de
// cada respuesta, que es cuando mas se nota.

import { pickPlannerModel } from '../../src/shared/models.js'

test('el planificador prefiere un modelo rapido del MISMO proveedor', () => {
  const r = pickPlannerModel(MODELS, { providerID: 'github-copilot', modelID: 'claude-sonnet-4.6' })
  eq(r, { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' })
})

test('no cambia de proveedor por su cuenta', () => {
  const soloLento = [{ providerID: 'openai', modelID: 'gpt-5.4', providerName: 'openai', name: 'gpt-5.4' }, ...MODELS.filter(m => m.providerID === 'opencode')]
  const r = pickPlannerModel(soloLento, { providerID: 'openai', modelID: 'gpt-5.4' })
  eq(r, { providerID: 'openai', modelID: 'gpt-5.4' }, 'antes que saltar a otro proveedor, se queda como esta')
})

test('si ya usas uno rapido, no lo toca', () => {
  const actual = { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' }
  eq(pickPlannerModel(MODELS, actual), actual)
})

test('sin modelo no inventa nada', () => {
  eq(pickPlannerModel(MODELS, null), null)
})
