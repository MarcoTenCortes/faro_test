import { test, eq, assert } from '../harness.js'
import { TurnTracker, describeError, isProviderAuthError, structuredOutputOf } from '../../src/opencode/turn.js'
import { parseEventBlock, readEventStream } from '../../src/opencode/client.js'

const SID = 'ses_abc'

function ev(type, properties) {
  return { type, properties }
}

test('turn: los deltas se van sumando', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'msg_1', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.delta', { sessionID: SID, messageID: 'msg_1', partID: 'prt_1', field: 'text', delta: 'Hola ' }))
  t.handle(ev('message.part.delta', { sessionID: SID, messageID: 'msg_1', partID: 'prt_1', field: 'text', delta: 'mundo' }))
  eq(t.text, 'Hola mundo')
})

test('turn: dos mensajes del asistente no se pegan en la misma línea', () => {
  // Una valla ``` que cerraba el primero y un «[1]» que abría el segundo
  // quedaban en una sola línea, y ni la valla ni la marca se reconocían.
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'msg_1', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_1', type: 'text', text: 'Leo.\n```' } }))
  t.handle(ev('message.updated', { info: { id: 'msg_2', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.updated', { part: { id: 'prt_2', sessionID: SID, messageID: 'msg_2', type: 'text', text: '[1] Primera.' } }))
  eq(t.text, 'Leo.\n```\n[1] Primera.')
  // Dentro del mismo mensaje, los trozos se pegan tal cual; y si ya acaba en salto, no se dobla.
  const u = new TurnTracker(SID)
  u.handle(ev('message.updated', { info: { id: 'msg_1', sessionID: SID, role: 'assistant' } }))
  u.handle(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_1', type: 'text', text: 'Ho' } }))
  u.handle(ev('message.part.updated', { part: { id: 'prt_2', sessionID: SID, messageID: 'msg_1', type: 'text', text: 'la\n' } }))
  u.handle(ev('message.updated', { info: { id: 'msg_2', sessionID: SID, role: 'assistant' } }))
  u.handle(ev('message.part.updated', { part: { id: 'prt_3', sessionID: SID, messageID: 'msg_2', type: 'text', text: 'mundo' } }))
  eq(u.text, 'Hola\nmundo')
})

test('turn: la instantánea manda sobre los deltas', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'msg_1', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.delta', { sessionID: SID, messageID: 'msg_1', partID: 'prt_1', field: 'text', delta: 'Ho' }))
  t.handle(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_1', type: 'text', text: 'Hola mundo' } }))
  eq(t.text, 'Hola mundo')
})

test('turn: el texto del usuario no se cuela en la respuesta', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'msg_u', sessionID: SID, role: 'user' } }))
  t.handle(ev('message.part.updated', { part: { id: 'prt_u', sessionID: SID, messageID: 'msg_u', type: 'text', text: 'mi pregunta' } }))
  t.handle(ev('message.updated', { info: { id: 'msg_a', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.updated', { part: { id: 'prt_a', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'mi respuesta' } }))
  eq(t.text, 'mi respuesta')
})

test('turn: los eventos de otra sesión se ignoran', () => {
  const t = new TurnTracker(SID)
  const changed = t.handle(ev('message.part.updated', { part: { id: 'x', sessionID: 'ses_otra', type: 'text', text: 'ajeno' } }))
  eq(changed, false)
  eq(t.text, '')
})

test('turn: las herramientas se registran aparte del texto', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'm', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.updated', {
    part: {
      id: 'prt_t', sessionID: SID, messageID: 'm', type: 'tool', tool: 'confluence_search',
      state: { status: 'completed', title: 'Buscando en Confluence' },
    },
  }))
  eq(t.tools.length, 1)
  eq(t.tools[0].tool, 'confluence_search')
  eq(t.text, '')
})

test('turn: la salida estructurada se recoge del mensaje del asistente, no del usuario', () => {
  const t = new TurnTracker(SID)
  eq(t.structured, undefined)
  t.handle(ev('message.updated', { info: { id: 'msg_u', sessionID: SID, role: 'user', structured: { colada: true } } }))
  eq(t.structured, undefined, 'lo del usuario no cuenta')
  t.handle(ev('message.updated', { info: { id: 'msg_a', sessionID: SID, role: 'assistant' } }))
  eq(t.structured, undefined, 'sin structured no cambia nada')
  t.handle(ev('message.updated', { info: { id: 'msg_a', sessionID: SID, role: 'assistant', structured: { observations: [] } } }))
  eq(t.structured, { observations: [] })
})

test('structuredOutputOf: sólo la llamada completada y válida a StructuredOutput', () => {
  const ok = { type: 'tool', tool: 'StructuredOutput', state: { status: 'completed', metadata: { valid: true }, input: { a: 1 } } }
  eq(structuredOutputOf([ok]), { a: 1 })
  eq(structuredOutputOf([{ type: 'text', text: 'hola' }, ok]), { a: 1 })
  eq(structuredOutputOf([{ ...ok, state: { ...ok.state, status: 'running' } }]), undefined, 'pendiente no vale')
  eq(structuredOutputOf([{ ...ok, state: { ...ok.state, metadata: { valid: false } } }]), undefined, 'inválida no vale')
  eq(structuredOutputOf([{ ...ok, tool: 'invalid' }]), undefined, 'otra herramienta no vale')
  eq(structuredOutputOf([{ ...ok, state: { ...ok.state, input: 'texto' } }]), undefined, 'tiene que ser un objeto')
  eq(structuredOutputOf(null), undefined)
  eq(structuredOutputOf([]), undefined)
})

test('turn: session.idle cierra el turno una sola vez', () => {
  let done = 0
  const t = new TurnTracker(SID, { onDone: () => done++ })
  t.handle(ev('session.idle', { sessionID: SID }))
  t.handle(ev('session.idle', { sessionID: SID }))
  eq(done, 1)
})

test('turn: un error de sesión se traduce a algo legible', () => {
  let msg = ''
  const t = new TurnTracker(SID, { onError: (m) => (msg = m) })
  t.handle(ev('session.error', { sessionID: SID, error: { name: 'ContextOverflowError' } }))
  assert(msg.includes('sesión nueva'), msg)
})

test('describeError: nombres conocidos y desconocidos', () => {
  // ProviderAuthError entra por la via de credenciales caducadas.
  assert(/caducado|auth login/i.test(describeError({ name: 'ProviderAuthError' })))
  assert(describeError({ name: 'RaroError', data: { message: 'ups' } }).includes('ups'))
  assert(describeError(null).length > 0)
})

test('SSE: se parsea un bloque data:', () => {
  eq(parseEventBlock('data: {"type":"a","properties":{}}'), { type: 'a', properties: {} })
  eq(parseEventBlock('event: ping\ndata: {"type":"b"}'), { type: 'b' })
  eq(parseEventBlock(': comentario'), null)
  eq(parseEventBlock('data: no-es-json'), null)
})

test('SSE: eventos partidos entre trozos del stream', async () => {
  const chunks = [
    'data: {"type":"uno",',
    '"properties":{"n":1}}\n\ndata: {"type":"dos","properties":{"n":2}}',
    '\n\ndata: {"type":"tres","properties":{"n":3}}\n\n',
  ]
  const body = fakeBody(chunks)
  const seen = []
  await readEventStream(body, (e) => seen.push(e.type))
  eq(seen, ['uno', 'dos', 'tres'])
})

test('SSE: soporta finales de línea CRLF', async () => {
  const body = fakeBody(['data: {"type":"a"}\r\n\r\ndata: {"type":"b"}\r\n\r\n'])
  const seen = []
  await readEventStream(body, (e) => seen.push(e.type))
  eq(seen, ['a', 'b'])
})

function fakeBody(chunks) {
  const enc = new TextEncoder()
  let i = 0
  return {
    getReader() {
      return {
        read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }),
        releaseLock() {},
      }
    },
  }
}

// --- errores de proveedor ------------------------------------------------
// Vienen de un caso real: con la sesión OAuth de ChatGPT caducada, opencode
// devuelve {name:"UnknownError", data:{message:"Error: Token refresh failed:
// 401"}} y el panel enseñaba ese texto crudo, sin decir qué hacer.

test('un fallo de credenciales del proveedor se reconoce aunque venga como UnknownError', () => {
  const err = { name: 'UnknownError', data: { message: 'Error: Token refresh failed: 401' } }
  assert(isProviderAuthError(err), 'debería detectarse')
  const msg = describeError(err, { providerID: 'openai' })
  assert(msg.includes('openai'), 'debe nombrar al proveedor')
  assert(/otro modelo|auth login/i.test(msg), 'debe decir qué hacer')
  assert(!msg.includes('UnknownError'), 'no debe soltar el nombre técnico')
})

test('otras variantes de credenciales caducadas', () => {
  for (const m of ['401 Unauthorized', 'invalid_api_key', 'the token has expired', 'authentication failed']) {
    assert(isProviderAuthError({ name: 'UnknownError', data: { message: m } }), m)
  }
})

test('un error normal no se confunde con uno de credenciales', () => {
  assert(!isProviderAuthError({ name: 'UnknownError', data: { message: 'connection reset by peer' } }))
  assert(!isProviderAuthError(null))
  eq(describeError({ name: 'MessageAbortedError' }), 'Turno cancelado.')
})

test('el turno recuerda el modelo, para poder nombrar al proveedor', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'm1', sessionID: SID, role: 'assistant', model: { providerID: 'openai', modelID: 'gpt-5.4' } },
  }))
  eq(t.model.providerID, 'openai')
  t.handle(ev('session.error', { sessionID: SID, error: { name: 'UnknownError', data: { message: 'Token refresh failed: 401' } } }))
  assert(t.error.includes('openai'), t.error)
})

test('allParts no incluye lo que escribio el usuario', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', { info: { id: 'mu', sessionID: SID, role: 'user' } }))
  t.handle(ev('message.part.updated', { part: { id: 'pu', sessionID: SID, messageID: 'mu', type: 'text', text: 'mi pregunta' } }))
  t.handle(ev('message.updated', { info: { id: 'ma', sessionID: SID, role: 'assistant' } }))
  t.handle(ev('message.part.updated', { part: { id: 'pt', sessionID: SID, messageID: 'ma', type: 'tool', tool: 'confluence_search', state: { status: 'completed' } } }))
  t.handle(ev('message.part.updated', { part: { id: 'pa', sessionID: SID, messageID: 'ma', type: 'text', text: 'OK encontrado' } }))

  const textos = t.allParts.filter((p) => p.type === 'text').map((p) => p.text)
  eq(textos, ['OK encontrado'])
  eq(t.allParts.filter((p) => p.type === 'tool').length, 1)
})
