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

// ---------------------------------------------------------------------------
// «¿Merece la pena ofrecer otro modelo?» (plan 2026-09-13, D6: puras sin test).
//
// La función vive en src/opencode/turn.js, junto a describeError, porque
// decide sobre el error crudo del turno (`turn.rawError`); se prueba aquí
// porque gobierna la elección de modelo del panel: `pickAlternativeModel`
// sólo se ofrece cuando ésta dice que sí.
// ---------------------------------------------------------------------------
import { suggestsAnotherModel } from '../../src/opencode/turn.js'

test('suggestsAnotherModel: credenciales caducadas y errores del proveedor → sí', () => {
  eq(suggestsAnotherModel({ name: 'ProviderAuthError' }), true)
  eq(suggestsAnotherModel({ type: 'ProviderAuthError' }), true, 'también con `type` en vez de `name`')
  // El caso que motivó el módulo: el OAuth caducado llega como UnknownError con el motivo dentro.
  eq(suggestsAnotherModel({ name: 'UnknownError', data: { message: 'Error: Token refresh failed: 401' } }), true)
  eq(suggestsAnotherModel({ name: 'UnknownError', message: 'Unauthorized' }), true, 'el mensaje puede venir en `message` a secas')
  eq(suggestsAnotherModel({ name: 'APIError', data: { message: 'Bad Request' } }), true, 'un APIError siempre es del proveedor')
  eq(suggestsAnotherModel({ name: 'UnknownError', data: { message: 'upstream connect error 502' } }), true)
  eq(suggestsAnotherModel({ name: 'UnknownError', data: { message: 'Rate limit exceeded' } }), true)
  eq(suggestsAnotherModel({ name: 'UnknownError', data: { message: 'invalid_request_error' } }), true)
})

test('suggestsAnotherModel: lo que no es culpa del proveedor → no', () => {
  eq(suggestsAnotherModel({ name: 'MessageAbortedError' }), false, 'cancelar no es un fallo')
  eq(suggestsAnotherModel({ name: 'ContextOverflowError', data: { message: 'context too long' } }), false)
  eq(suggestsAnotherModel({ name: 'MessageOutputLengthError' }), false)
  // El formato es cosa del turno interno (planificador, pasadas), no del proveedor:
  // ni siquiera con «bad request» en el mensaje.
  eq(suggestsAnotherModel({ name: 'StructuredOutputError', data: { message: 'bad request' } }), false)
  eq(suggestsAnotherModel({ name: 'UnknownError', data: { message: 'algo raro' } }), false)
  eq(suggestsAnotherModel(null), false)
  eq(suggestsAnotherModel(undefined), false)
  eq(suggestsAnotherModel({}), false)
})

// ===========================================================================
// H16 (docs/PLAN2.md §3.3 y §8.25): lo que un fallo enseña sobre los modelos, y
// lo que Faro recuerda de ello. Todo con los rechazos REALES del opencode de
// Marco (test/fixtures/models/rechazos.json) y su GET /config/providers
// (providers.json): el de Copilot, capturado entero con la sonda del anexo C.
// ===========================================================================
import { readFileSync } from 'node:fs'
import { OpencodeClient } from '../../src/opencode/client.js'
import { MODEL_LIMITS } from '../../src/shared/config.js'
import {
  MODEL_FAILURE_REASONS,
  MODEL_CHECKS_VERSION,
  classifyModelFailure,
  availableFromError,
  verdictsForFailure,
  normalizeModelChecks,
  modelVerdict,
  recordVerdicts,
  modelsFingerprint,
  recommendModel,
  resolveModel,
  usableModels,
} from '../../src/shared/models.js'

const fixture = (nombre) => JSON.parse(readFileSync(new URL('../fixtures/models/' + nombre, import.meta.url), 'utf8'))
const RECHAZOS = Object.fromEntries(fixture('rechazos.json').rechazos.map((r) => [r.model, r.rawError]))
const OPENAI = RECHAZOS['openai/gpt-5.4']
const COPILOT = RECHAZOS['github-copilot/claude-sonnet-4.6']
const FREE_TIER = RECHAZOS['opencode/big-pickle']

/**
 * La lista de modelos de Marco tal como la da `client.models()` DE VERDAD: se le
 * pasa la fixture con las variantes devueltas a la forma de opencode (la fixture
 * sólo guarda sus nombres).
 */
const PROV = fixture('providers.json')
const { models: REALES, defaults: DEFAULTS_REALES } = await OpencodeClient.prototype.models.call({
  providers: async () => ({
    default: PROV.default,
    providers: PROV.providers.map((p) => ({
      ...p,
      models: Object.fromEntries(
        Object.entries(p.models).map(([id, m]) => [id, { ...m, variants: Object.fromEntries(m.variants.map((v) => [v, {}])) }])
      ),
    })),
  }),
})
const CLAVE = (m) => m.providerID + '/' + m.modelID
const AHORA = Date.UTC(2026, 8, 26, 10, 0, 0)
const SERVER = 'http://127.0.0.1:4096'
const HUELLA = modelsFingerprint(REALES)
/** Un mapa de veredictos de fallo `plan` recientes para esas claves. */
const marcados = (...claves) =>
  Object.fromEntries(claves.map((k) => [k, { ok: false, reason: 'plan', message: 'no está en tu plan', at: AHORA - 60_000 }]))

test('H16: la fixture es la de verdad: 43 modelos en tres proveedores, y la lista de Copilot entera', () => {
  eq(REALES.length, 43)
  eq(DEFAULTS_REALES, { openai: 'gpt-5.4', 'github-copilot': 'claude-sonnet-4.6', opencode: 'big-pickle' })
  eq(availableFromError(COPILOT).length, 57, 'la lista ENTERA de «Available models», no un trozo')
})

test('H16: los tres rechazos REALES son «plan», y cada otro motivo se reconoce', () => {
  eq([...MODEL_FAILURE_REASONS], ['plan', 'credenciales', 'mudo', 'transitorio', 'otro'])
  eq(classifyModelFailure(OPENAI), 'plan', '400 «not supported when using Codex with a ChatGPT account»')
  eq(classifyModelFailure(COPILOT), 'plan', '400 «not available for integrator opencode»')
  eq(classifyModelFailure(FREE_TIER), 'plan', '403 «free tier can only be used from within OpenCode»')
  eq(classifyModelFailure({ name: 'ProviderAuthError', data: { message: 'x' } }), 'credenciales')
  eq(classifyModelFailure({ name: 'UnknownError', data: { message: 'Error: Token refresh failed: 401' } }), 'credenciales', 'el OAuth caducado de verdad')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'nope', statusCode: 401 } }), 'credenciales')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'not available', statusCode: 401 } }), 'credenciales', 'un 401 es de credenciales aunque diga «not available»')
  eq(classifyModelFailure(COPILOT, { stalled: true }), 'mudo', 'callarse manda sobre lo que traiga')
  eq(classifyModelFailure(null, { stalled: true }), 'mudo')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'Too Many Requests', statusCode: 429 } }), 'transitorio')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'Bad Gateway', statusCode: 502 } }), 'transitorio')
  eq(classifyModelFailure({ name: 'UnknownError', data: { message: 'model is overloaded' } }), 'transitorio')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'Service Unavailable', statusCode: 503 } }), 'transitorio', 'un «unavailable» de un 503 no es un modelo que no existe')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'not available' } }), 'otro', 'el «plan» exige su código: sin él no se sabe')
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'Bad Request', statusCode: 400 } }), 'otro')
  for (const basura of [null, undefined, 'basura', 42, {}, [], { data: 'x' }, { data: { statusCode: '400', message: 7 } }]) {
    eq(classifyModelFailure(basura), 'otro', 'sin mensaje ni código: ' + JSON.stringify(basura))
  }
})

test('H16: availableFromError lee la lista de Copilot, y sin lista no inventa ninguna', () => {
  const ids = availableFromError(COPILOT)
  assert(ids.includes('gpt-4.1') && ids.includes('gpt-5.6-luna') && ids.includes('gpt-5.2'), 'el primero, uno de en medio y el último')
  assert(!ids.includes('claude-sonnet-4.6'), 'el que se pidió no está: por eso lo rechazó')
  eq(new Set(ids).size, ids.length, 'sin repetir')
  eq(availableFromError(OPENAI), null)
  eq(availableFromError(FREE_TIER), null)
  eq(availableFromError({ data: { message: 'Available models: [a, "b" ,c]' } }), ['a', 'b', 'c'], 'con comas o comillas también')
  eq(availableFromError({ data: { message: 'Available models: []' } }), null, 'una lista vacía no dice «no vale ninguno»')
  for (const basura of [null, undefined, 'Available models: [a]', {}, { data: { message: 7 } }]) eq(availableFromError(basura), null)
})

test('H16: el 403 del free tier marca de golpe TODOS los opencode/* y ningún otro proveedor', () => {
  const v = verdictsForFailure({ model: 'opencode/big-pickle', rawError: FREE_TIER, models: REALES, now: AHORA })
  const deOpencode = REALES.filter((m) => m.providerID === 'opencode').map(CLAVE)
  eq(v[0].key, 'opencode/big-pickle', 'el que falló, el primero')
  eq(v.map((x) => x.key).sort(), deOpencode.sort(), 'los siete, y sólo ellos')
  assert(v.every((x) => x.ok === false && x.reason === 'plan' && x.at === AHORA), 'todos «plan», del mismo momento')
  eq(Object.keys(v[0]).sort(), ['at', 'key', 'message', 'ok', 'reason'])
  // El 400 de openai es sólo de ese modelo: no dice nada de los demás de openai.
  eq(verdictsForFailure({ model: { providerID: 'openai', modelID: 'gpt-5.4' }, rawError: OPENAI, models: REALES, now: AHORA }).map((x) => x.key), ['openai/gpt-5.4'])
})

test('H16: la lista de Copilot marca EXACTAMENTE los de github-copilot que no están', () => {
  const v = verdictsForFailure({ model: 'github-copilot/claude-sonnet-4.6', rawError: COPILOT, models: REALES, now: AHORA })
  eq(v.map((x) => x.key).sort(), ['github-copilot/claude-sonnet-4.6', 'github-copilot/gpt-5.4-nano', 'github-copilot/mai-code-1-flash-picker'])
  assert(v.every((x) => x.reason === 'plan'), 'no estar en la lista del integrador es no estar en el plan')
  // El mensaje del proveedor, en UNA línea y acotado: el de Copilot mide más de mil caracteres.
  assert(v[0].message.length <= MODEL_LIMITS.messageMax && v[0].message.startsWith('The requested model is not available'), v[0].message)
})

test('SEGURIDAD H16: el mensaje del proveedor sale en una línea, sin invisibles y acotado', () => {
  const NEL = String.fromCharCode(0x85)
  const LS = String.fromCharCode(0x2028)
  const RLO = String.fromCharCode(0x202e)
  const malo = { name: 'APIError', data: { statusCode: 400, message: 'no' + NEL + 'está' + LS + 'en' + RLO + ' tu plan\r\n' + 'x'.repeat(5000) } }
  const [v] = verdictsForFailure({ model: 'openai/gpt-5.4', rawError: malo, models: REALES, now: AHORA })
  for (const c of [NEL, LS, RLO, '\n', '\r']) assert(!v.message.includes(c), 'sin ' + c.charCodeAt(0).toString(16))
  assert(v.message.startsWith('no está en tu plan x'), v.message.slice(0, 40))
  assert(v.message.length <= MODEL_LIMITS.messageMax, 'acotado a messageMax')
  // Callarse no trae mensaje, y un modelo sin forma no da veredictos.
  eq(verdictsForFailure({ model: 'openai/gpt-5.4', stalled: true, models: REALES, now: AHORA })[0].message, '')
  eq(verdictsForFailure({ model: 'openai/gpt-5.4', stalled: true, now: AHORA })[0].reason, 'mudo')
  // Ni una clave con invisibles: un RLO en el id se leería al revés en la pantalla del modelo.
  const conInvisible = 'openai/gpt' + RLO + '-5.4'
  for (const sinForma of [null, '', 'sin-barra', { providerID: 'a b', modelID: 'c' }, 'a/ b', '/x', 'x/', conInvisible, { providerID: 'open' + RLO + 'ai', modelID: 'x' }]) {
    eq(verdictsForFailure({ model: sinForma, rawError: OPENAI, models: REALES, now: AHORA }), [], JSON.stringify(sinForma))
  }
})

test('H16: normalizeModelChecks reconstruye con claves blancas y tira lo que no es de este opencode', () => {
  const OPT = { server: SERVER, fingerprint: HUELLA, now: AHORA }
  const vacio = { version: MODEL_CHECKS_VERSION, server: SERVER, fingerprint: HUELLA, checks: {} }
  for (const basura of [null, undefined, 'x', 7, [], {}, { version: 1 }]) eq(normalizeModelChecks(basura, OPT), vacio, JSON.stringify(basura))
  const bueno = { version: 1, server: SERVER, fingerprint: HUELLA, checks: marcados('openai/gpt-5.4') }
  eq(Object.keys(normalizeModelChecks(bueno, OPT)).sort(), ['checks', 'fingerprint', 'server', 'version'])
  eq(Object.keys(normalizeModelChecks(bueno, OPT).checks['openai/gpt-5.4']).sort(), ['at', 'message', 'ok', 'reason'])
  // Otra versión, otro servidor u otros proveedores conectados → vacío, con los de ahora.
  eq(normalizeModelChecks({ ...bueno, version: 2 }, OPT), vacio)
  eq(normalizeModelChecks({ ...bueno, server: 'http://127.0.0.1:4123' }, OPT), vacio)
  eq(normalizeModelChecks({ ...bueno, fingerprint: '44-00000000' }, OPT), vacio)
  const futuro = AHORA + 9_999_999
  // Por JSON.parse, que es como llega de verdad: así «__proto__» es una clave
  // PROPIA del objeto, no el prototipo.
  const sucio = JSON.parse(
    '{"version":1,"server":' + JSON.stringify(SERVER) + ',"fingerprint":' + JSON.stringify(HUELLA) + ',"checks":{' +
      '"__proto__":{"ok":false,"reason":"plan","at":1},' +
      '"openai/gpt-5.4":{"ok":false,"reason":"inventado","message":"a\\nb","at":' + (AHORA - 5) + ',"extra":1},' +
      '"openai/gpt-5.2":{"ok":true,"reason":"plan","at":' + futuro + '},' +
      '"openai/sin-fecha":{"ok":false,"reason":"plan"},' +
      '"openai/gpt-5.3-codex":{"ok":"sí","at":' + AHORA + '},' +
      '"openai/gpt-5.3-codex-spark":{"ok":false,"reason":"mudo","at":"ayer"},' +
      '"con espacio/x y":{"ok":true,"at":' + AHORA + '}}}'
  )
  assert(Object.hasOwn(sucio.checks, '__proto__'), 'la trampa está puesta')
  const n = normalizeModelChecks(sucio, OPT)
  eq(n.checks, {
    'openai/gpt-5.2': { ok: true, reason: 'ok', message: '', at: AHORA },
    'openai/gpt-5.4': { ok: false, reason: 'otro', message: 'a b', at: AHORA - 5 },
  }, '__proto__, sin fecha, ok que no es booleano y claves con espacios fuera; un motivo inventado es «otro»; el futuro se trae a ahora')
  eq(Object.getPrototypeOf(n.checks), Object.prototype, 'y el prototipo sigue siendo el de siempre')
  eq(normalizeModelChecks(n, OPT), n, 'idempotente')
})

test('H16: el tope de veredictos conserva los más recientes', () => {
  const muchos = {}
  for (let i = 0; i < 130; i++) muchos['p/m' + i] = { ok: false, reason: 'plan', message: '', at: AHORA - i * 1000 }
  const n = normalizeModelChecks({ version: 1, server: SERVER, fingerprint: HUELLA, checks: muchos }, { server: SERVER, fingerprint: HUELLA, now: AHORA })
  eq(Object.keys(n.checks).length, MODEL_LIMITS.maxEntries)
  assert('p/m0' in n.checks && 'p/m99' in n.checks && !('p/m100' in n.checks), 'se quedan los 100 más nuevos')
  eq(MODEL_LIMITS.maxEntries, 100)
})

test('H16: cada veredicto caduca a su ritmo, con el reloj que se le dé', () => {
  for (const [reason, ttl] of Object.entries(MODEL_LIMITS.ttlMs)) {
    const ok = reason === 'ok'
    const checks = { 'p/m': { ok, reason, message: '', at: AHORA } }
    assert(modelVerdict(checks, 'p/m', AHORA + ttl), `${reason}: vale hasta cumplir su TTL justo`)
    eq(modelVerdict(checks, 'p/m', AHORA + ttl + 1), null, `${reason}: y un milisegundo después ya no`)
  }
  const guardado = { version: 1, server: SERVER, fingerprint: HUELLA, checks: marcados('openai/gpt-5.4') }
  eq(modelVerdict(guardado, { providerID: 'openai', modelID: 'gpt-5.4' }, AHORA), { ok: false, reason: 'plan', message: 'no está en tu plan', at: AHORA - 60_000 }, 'el objeto entero o su mapa, la clave o el modelo')
  eq(modelVerdict(guardado, 'openai/gpt-5.2', AHORA), null, 'sin entrada, nada')
  for (const basura of [null, {}, 'x', { checks: { 'p/m': { ok: 'no', at: AHORA } } }]) eq(modelVerdict(basura, 'p/m', AHORA), null)
})

test('H16: recordVerdicts no toca lo que recibe, y la entrada más reciente gana', () => {
  const antes = { version: 1, server: SERVER, fingerprint: HUELLA, checks: { 'a/b': { ok: true, reason: 'ok', message: '', at: AHORA } } }
  const copia = JSON.stringify(antes)
  const r = recordVerdicts(antes, [
    { key: 'a/b', ok: false, reason: 'mudo', message: '', at: AHORA - 1 },
    { key: 'c/d', ok: false, reason: 'plan', message: 'x', at: AHORA },
    { key: 'sin barra', ok: false, reason: 'plan', at: AHORA },
  ])
  eq(JSON.stringify(antes), copia, 'no muta')
  assert(r !== antes && r.checks !== antes.checks, 'un objeto nuevo')
  eq(r.checks['a/b'].ok, true, 'uno más viejo no pisa lo que ya se sabía')
  eq(r.checks['c/d'], { ok: false, reason: 'plan', message: 'x', at: AHORA })
  eq(Object.keys(r.checks).sort(), ['a/b', 'c/d'])
  eq(recordVerdicts(r, [{ key: 'a/b', ok: false, reason: 'plan', message: '', at: AHORA }]).checks['a/b'].reason, 'plan', 'en empate, lo último visto')
  eq(recordVerdicts({}, [{ key: 'a/b', ok: true, at: AHORA }]), { 'a/b': { ok: true, reason: 'ok', message: '', at: AHORA } }, 'con sólo el mapa, devuelve un mapa')
})

test('H16: la huella de los modelos es determinista y cambia con la lista', () => {
  eq(modelsFingerprint(REALES), HUELLA)
  assert(/^43-[0-9a-f]{8}$/.test(HUELLA), HUELLA)
  eq(modelsFingerprint([...REALES].reverse()), HUELLA, 'el orden de la lista no cuenta')
  eq(modelsFingerprint([...REALES, REALES[0]]), HUELLA, 'ni un repetido')
  assert(modelsFingerprint(REALES.slice(1)) !== HUELLA, 'un modelo menos es otra huella')
  eq(modelsFingerprint(null), modelsFingerprint([]))
})

test('H16: recommendModel preselecciona en su orden, y nunca algo que ya falló', () => {
  const opt = (extra) => ({ defaults: DEFAULTS_REALES, now: AHORA, ...extra })
  const luna = { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }
  // 1. El último que contestó.
  const conOk = {
    ...marcados('openai/gpt-5.4'),
    'github-copilot/gpt-5-mini': { ok: true, reason: 'ok', message: '', at: AHORA - 5000 },
    'github-copilot/gpt-5.6-luna': { ok: true, reason: 'ok', message: '', at: AHORA - 1000 },
  }
  eq(CLAVE(recommendModel(REALES, opt({ checks: conOk, configModel: 'openai/gpt-5.2' }))), 'github-copilot/gpt-5.6-luna')
  // 2. El de la configuración de opencode, como objeto o como cadena.
  eq(CLAVE(recommendModel(REALES, opt({ configModel: luna }))), 'github-copilot/gpt-5.6-luna')
  eq(CLAVE(recommendModel(REALES, opt({ configModel: 'openai/gpt-5.2' }))), 'openai/gpt-5.2')
  // 3. El primer default sin fallo: gpt-5.4 y claude-sonnet-4.6 están marcados.
  const rotos = marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6')
  eq(CLAVE(recommendModel(REALES, opt({ checks: rotos, configModel: 'github-copilot/claude-sonnet-4.6' }))), 'opencode/big-pickle')
  eq(CLAVE(recommendModel(REALES, opt({}))), 'openai/gpt-5.4', 'sin nada que lo impida, el primer default')
  // 4. Nada.
  eq(recommendModel(REALES, opt({ checks: marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6', 'opencode/big-pickle') })), null)
  eq(recommendModel([], opt({})), null)
  // Y un default sin herramientas no se propone.
  const sinHerr = REALES.map((m) => (CLAVE(m) === 'openai/gpt-5.4' ? { ...m, toolcall: false } : m))
  eq(CLAVE(recommendModel(sinHerr, opt({}))), 'github-copilot/claude-sonnet-4.6')
})

test('H16: resolveModel — manda el de la persona, el del sitio se migra una vez, y sin nada NO elige solo', () => {
  const luna = { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }
  const r1 = resolveModel(REALES, { settingsModel: luna, savedModel: 'openai/gpt-5.2', now: AHORA })
  eq([CLAVE(r1.model), r1.source, r1.migrate], ['github-copilot/gpt-5.6-luna', 'settings', false])
  assert(REALES.includes(r1.model), 'el objeto de la lista, no el que se le dio')
  const r2 = resolveModel(REALES, { settingsModel: null, savedModel: { providerID: 'openai', modelID: 'gpt-5.2' }, now: AHORA })
  eq([CLAVE(r2.model), r2.source, r2.migrate], ['openai/gpt-5.2', 'migracion', true])
  // Tras migrar, el panel lo copia a settings.model: la vez siguiente sale por la primera rama.
  const r3 = resolveModel(REALES, { settingsModel: { providerID: 'openai', modelID: 'gpt-5.2' }, savedModel: 'openai/gpt-5.2', now: AHORA })
  eq([r3.source, r3.migrate], ['settings', false], 'una sola vez')
  const nada = { model: null, source: '', migrate: false }
  eq(resolveModel(REALES, { now: AHORA }), nada, 'sin nada guardado, pregunta')
  eq(resolveModel(REALES, { settingsModel: { providerID: 'openai', modelID: 'ya-no-existe' }, now: AHORA }), nada)
  eq(resolveModel(REALES, { settingsModel: 'openai/gpt-5.4', checks: marcados('openai/gpt-5.4'), now: AHORA }), nada, 'con veredicto de fallo vigente, tampoco')
  eq(resolveModel([], { settingsModel: luna }), nada, 'sin lista no hay con qué comparar')
  // Revisión adversaria de H16: `sano(delSitio)` es la ÚNICA barrera que impide
  // MIGRAR a settings.model un modelo del sitio que ya falló (el gpt-5.4 del
  // compañero, guardado en `saved.model` desde antes de H16).
  eq(resolveModel(REALES, { settingsModel: null, savedModel: 'openai/gpt-5.4', checks: marcados('openai/gpt-5.4'), now: AHORA }), nada, 'el del sitio con fallo vigente no se migra')
  eq(
    resolveModel(REALES, { settingsModel: 'github-copilot/claude-sonnet-4.6', savedModel: 'openai/gpt-5.4', checks: marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6'), now: AHORA }),
    nada,
    'los dos rotos: pregunta'
  )
})

test('H16: EL BUCLE ROTO — «Reintentar con X» ya no alterna entre gpt-5.4 y claude-sonnet-4.6', () => {
  // Hoy, sin veredictos, alterna entre los dos defaults rotos (anexo C, ejecutado).
  eq(CLAVE(pickAlternativeModel(REALES, DEFAULTS_REALES, 'openai')), 'github-copilot/claude-sonnet-4.6')
  eq(CLAVE(pickAlternativeModel(REALES, DEFAULTS_REALES, 'github-copilot')), 'openai/gpt-5.4')
  const rotos = { checks: marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6'), now: AHORA }
  const trasOpenai = pickAlternativeModel(REALES, DEFAULTS_REALES, 'openai', rotos)
  const trasCopilot = pickAlternativeModel(REALES, DEFAULTS_REALES, 'github-copilot', rotos)
  for (const alt of [trasOpenai, trasCopilot]) {
    assert(!['openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6'].includes(CLAVE(alt)), 'ninguno de los dos rotos: ' + CLAVE(alt))
  }
  // Con los veredictos que dan los tres rechazos reales, ni siquiera un opencode/*.
  const todo = [
    ...verdictsForFailure({ model: 'openai/gpt-5.4', rawError: OPENAI, models: REALES, now: AHORA }),
    ...verdictsForFailure({ model: 'github-copilot/claude-sonnet-4.6', rawError: COPILOT, models: REALES, now: AHORA }),
    ...verdictsForFailure({ model: 'opencode/big-pickle', rawError: FREE_TIER, models: REALES, now: AHORA }),
  ]
  const checks = recordVerdicts({}, todo)
  const alt = pickAlternativeModel(REALES, DEFAULTS_REALES, 'openai', { checks, now: AHORA })
  eq(alt.providerID, 'github-copilot')
  eq(modelVerdict(checks, alt, AHORA), null, 'y de lo que no se sabe nada malo')
})

test('H16: el planificador no cae en gpt-5.3-codex-spark si ya falló', () => {
  const codex = { providerID: 'openai', modelID: 'gpt-5.3-codex' }
  eq(pickPlannerModel(REALES, codex), { providerID: 'openai', modelID: 'gpt-5.3-codex-spark' }, 'hoy, sin mirar si funciona')
  eq(pickPlannerModel(REALES, codex, { checks: marcados('openai/gpt-5.3-codex-spark'), now: AHORA }), codex, 'marcado: se queda con el de la conversación')
  const luna = { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }
  eq(pickPlannerModel(REALES, luna), { providerID: 'github-copilot', modelID: 'gpt-5-mini' })
  eq(pickPlannerModel(REALES, luna, { checks: marcados('github-copilot/gpt-5-mini'), now: AHORA }), { providerID: 'github-copilot', modelID: 'gpt-5.4-mini' }, 'el siguiente rápido sano')
})

test('H16: pickDefaultModel salta lo marcado, y con todo marcado no elige', () => {
  eq(CLAVE(pickDefaultModel(REALES, DEFAULTS_REALES, { checks: marcados('openai/gpt-5.4'), now: AHORA })), 'github-copilot/claude-sonnet-4.6')
  eq(CLAVE(pickDefaultModel(REALES, DEFAULTS_REALES, { checks: marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6', 'opencode/big-pickle'), now: AHORA })), CLAVE(REALES[0]))
  eq(pickDefaultModel(REALES.slice(0, 2), {}, { checks: marcados(...REALES.slice(0, 2).map(CLAVE)), now: AHORA }), null)
  // Un veredicto caducado ya no cuenta.
  eq(CLAVE(pickDefaultModel(REALES, DEFAULTS_REALES, { checks: marcados('openai/gpt-5.4'), now: AHORA + MODEL_LIMITS.ttlMs.plan })), 'openai/gpt-5.4')
})

test('H16: sin veredictos, las tres elecciones dan byte a byte lo de siempre', () => {
  for (const [lista, defaults] of [[REALES, DEFAULTS_REALES], [MODELS, DEFAULTS], [[], {}]]) {
    eq(pickDefaultModel(lista, defaults, {}), pickDefaultModel(lista, defaults))
    eq(pickDefaultModel(lista, defaults, { checks: {}, now: AHORA }), pickDefaultModel(lista, defaults), 'un mapa vacío tampoco cambia nada')
    for (const p of ['openai', 'github-copilot', 'opencode']) {
      eq(pickAlternativeModel(lista, defaults, p, { checks: {} }), pickAlternativeModel(lista, defaults, p))
    }
    for (const m of lista) eq(pickPlannerModel(lista, m, { checks: {} }), pickPlannerModel(lista, m))
  }
})

test('H16: usableModels marca lo retirado y lo que no tiene herramientas, sin borrar nada', () => {
  const lista = [
    { providerID: 'a', modelID: 'bien', toolcall: true, status: 'active' },
    { providerID: 'a', modelID: 'viejo', toolcall: true, status: 'deprecated' },
    { providerID: 'a', modelID: 'mudo', toolcall: false, status: 'active' },
    { providerID: 'a', modelID: 'antiguo' },
  ]
  const copia = JSON.stringify(lista)
  const r = usableModels(lista)
  eq(r.map((m) => [m.modelID, m.usable, m.unusableReason]), [
    ['bien', true, ''],
    ['viejo', false, 'deprecated'],
    ['mudo', false, 'sin-herramientas'],
    ['antiguo', true, ''],
  ])
  eq(JSON.stringify(lista), copia, 'copias: la lista no se toca')
  eq(usableModels(REALES).length, 43, 'los 43 de Marco son utilizables: opencode no marca lo que el plan no permite')
  eq(usableModels(null), [])
})

test('H16 revisión: los bordes de la clasificación que ninguna prueba fijaba', () => {
  // Un 404 «model not found» es un modelo que no existe para ti: «plan».
  eq(classifyModelFailure({ name: 'APIError', data: { message: 'model not found', statusCode: 404 } }), 'plan', 'el 404 también es «plan»')
  // El 403 del free tier con el turno COLGADO es «mudo», y entonces NO marca al
  // proveedor entero: el veredicto de proveedor exige que el motivo sea «plan».
  const colgado = verdictsForFailure({ model: 'opencode/big-pickle', rawError: FREE_TIER, stalled: true, models: REALES, now: AHORA })
  eq(colgado.map((v) => [v.key, v.reason]), [['opencode/big-pickle', 'mudo']], 'sólo el que falló, y «mudo»')
  // Un id de modelo con un trozo vacío no es una clave.
  for (const trozoVacio of ['a/b//c', 'openai/gpt-5.4/', { providerID: 'openai', modelID: 'meta//x' }]) {
    eq(verdictsForFailure({ model: trozoVacio, rawError: OPENAI, models: REALES, now: AHORA }), [], JSON.stringify(trozoVacio))
  }
})

// Revisión adversaria de H16: «Reintentar con X» elegía la alternativa a
// ciegas (pickAlternativeModel) y DESPUÉS exigía que tuviera veredicto ok; con
// los dos defaults rechazados y gpt-5.6-luna funcionando —el caso del
// compañero— la alternativa ciega era un default sin veredicto y no salía NUNCA
// el botón. pickRetryModel elige directamente entre lo que YA se sabe que contesta.
import { pickRetryModel } from '../../src/shared/models.js'

test('H16 revisión: pickRetryModel propone lo que ya contestó, nunca el que falló', () => {
  const ok = (at) => ({ ok: true, reason: 'ok', message: '', at })
  const checks = {
    ...marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6'),
    'github-copilot/gpt-5-mini': ok(AHORA - 9000),
    'github-copilot/gpt-5.6-luna': ok(AHORA - 1000),
    'openai/gpt-5.2': ok(AHORA - 5000),
  }
  const opt = { checks, now: AHORA }
  // El caso del compañero: falla gpt-5.4 y sale luna, el ok más reciente (y de otro proveedor).
  eq(CLAVE(pickRetryModel(REALES, 'openai/gpt-5.4', opt)), 'github-copilot/gpt-5.6-luna')
  // Otro proveedor se prefiere aunque haya un ok más reciente del mismo.
  eq(CLAVE(pickRetryModel(REALES, { providerID: 'github-copilot', modelID: 'claude-sonnet-4.6' }, opt)), 'openai/gpt-5.2', 'otro proveedor antes que uno más reciente del mismo')
  // Sin otro proveedor con ok, uno del mismo; con otherProvider: true, nada.
  const soloCopilot = { 'github-copilot/gpt-5-mini': ok(AHORA - 9000), 'github-copilot/gpt-5.6-luna': ok(AHORA - 1000) }
  eq(CLAVE(pickRetryModel(REALES, 'github-copilot/claude-sonnet-4.6', { checks: soloCopilot, now: AHORA })), 'github-copilot/gpt-5.6-luna')
  eq(pickRetryModel(REALES, 'github-copilot/claude-sonnet-4.6', { checks: soloCopilot, now: AHORA, otherProvider: true }), null, 'otherProvider exige otro proveedor')
  // El que falló, nunca: aunque sea el único ok.
  eq(pickRetryModel(REALES, 'github-copilot/gpt-5.6-luna', { checks: { 'github-copilot/gpt-5.6-luna': ok(AHORA) }, now: AHORA }), null, 'nunca el que falló')
  // Sin ningún ok, sin checks, o con el ok caducado: nada.
  eq(pickRetryModel(REALES, 'openai/gpt-5.4', { checks: marcados('openai/gpt-5.4', 'github-copilot/claude-sonnet-4.6'), now: AHORA }), null, 'sin ok no hay a qué reintentar: un veredicto de fallo no es un «sí»')
  eq(pickRetryModel(REALES, 'openai/gpt-5.4'), null, 'sin veredictos no hay con qué atreverse')
  eq(pickRetryModel(REALES, 'openai/gpt-5.4', { checks: {}, now: AHORA }), null)
  const caducado = { 'github-copilot/gpt-5.6-luna': ok(AHORA - MODEL_LIMITS.ttlMs.ok - 1) }
  eq(pickRetryModel(REALES, 'openai/gpt-5.4', { checks: caducado, now: AHORA }), null, 'un ok caducado ya no vale')
  // Lo que devuelve es el objeto de la lista; y un ok de algo que no está en la lista no cuenta.
  assert(REALES.includes(pickRetryModel(REALES, 'openai/gpt-5.4', opt)), 'el objeto de la lista')
  eq(pickRetryModel(REALES, 'openai/gpt-5.4', { checks: { 'otro/que-no-esta': ok(AHORA) }, now: AHORA }), null)
  for (const basura of [null, undefined, 'x', [null, 7, {}]]) eq(pickRetryModel(basura, 'openai/gpt-5.4', opt), null, JSON.stringify(basura))
})
