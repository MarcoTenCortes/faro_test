import { test, eq, assert } from '../harness.js'
import {
  TurnTracker,
  describeError,
  isProviderAuthError,
  structuredOutputOf,
  toolOutputSize,
  sortMessages,
  dropOrphans,
} from '../../src/opencode/turn.js'
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

// --- H3: lo que costó el turno ------------------------------------------
// Forma comprobada en la base de opencode de esta máquina (1.2.25, 2026-09-19):
// `tokens` es {total, input, output, reasoning, cache:{read, write}} y `cost`
// un número. El grueso son lecturas de caché, que es lo que hacía falta ver.

test('turn: los tokens y el coste salen del mensaje del asistente', () => {
  const t = new TurnTracker(SID)
  eq(t.tokens, null, 'sin nada, null (no un objeto a cero)')
  eq(t.cost, null)
  t.handle(ev('message.updated', {
    info: {
      id: 'm1', sessionID: SID, role: 'assistant',
      tokens: { total: 21841, input: 744, output: 62, reasoning: 0, cache: { read: 21035, write: 0 } },
      cost: 0,
    },
  }))
  eq(t.tokens, { total: 21841, input: 744, output: 62, reasoning: 0, cache: { read: 21035, write: 0 } })
  eq(t.cost, 0, 'un 0 informado es 0, no «sin dato»')
})

test('turn: la misma foto repetida no cuenta dos veces', () => {
  // `message.updated` del MISMO mensaje llega muchas veces mientras llega la
  // respuesta: sumar cada evento multiplicaba los tokens por cuatro.
  const t = new TurnTracker(SID)
  const info = (tokens) => ({ id: 'm1', sessionID: SID, role: 'assistant', tokens, cost: 0.5 })
  t.handle(ev('message.updated', { info: info({ total: 100, input: 90, output: 10, reasoning: 0, cache: { read: 0, write: 0 } }) }))
  t.handle(ev('message.updated', { info: info({ total: 300, input: 90, output: 210, reasoning: 5, cache: { read: 0, write: 0 } }) }))
  eq(t.tokens, { total: 300, input: 90, output: 210, reasoning: 5, cache: { read: 0, write: 0 } }, 'manda la última')
  eq(t.cost, 0.5)
})

test('turn: varios mensajes del asistente en un turno se suman', () => {
  // Un turno se parte en un mensaje por vuelta de herramientas.
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'm1', sessionID: SID, role: 'assistant', tokens: { total: 1000, input: 900, output: 100, reasoning: 0, cache: { read: 0, write: 50 } }, cost: 0.2 },
  }))
  t.handle(ev('message.updated', {
    info: { id: 'm2', sessionID: SID, role: 'assistant', tokens: { total: 2000, input: 1200, output: 300, reasoning: 7, cache: { read: 500, write: 0 } }, cost: 0.3 },
  }))
  eq(t.tokens, { total: 3000, input: 2100, output: 400, reasoning: 7, cache: { read: 500, write: 50 } })
  // 0,2 + 0,3 en coma flotante es 0,5000000000000001: la suma se redondea para
  // que el Registro no enseñe eso.
  eq(t.cost, 0.5)
})

test('turn: los tokens del usuario y de otra sesión no cuentan', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'mu', sessionID: SID, role: 'user', tokens: { total: 9, input: 9, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 9 },
  }))
  eq(t.tokens, null, 'el mensaje del usuario no trae coste del turno')
  eq(t.cost, null)
  t.handle(ev('message.updated', {
    info: { id: 'mx', sessionID: 'ses_otra', role: 'assistant', tokens: { total: 5, input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
  }))
  eq(t.tokens, null, 'ni el de otra sesión')
})

test('turn: sin «total» se deduce; sin tokens pero con coste, sólo el coste', () => {
  // 60 mensajes de la base real (de una versión anterior) no traen `total`;
  // opencode lo informa como input + output + cache.read (4 518 de 4 521).
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'm1', sessionID: SID, role: 'assistant', tokens: { input: 550, output: 69, reasoning: 7, cache: { read: 20488, write: 0 } } },
  }))
  eq(t.tokens.total, 21107, 'input + output + cache.read, como lo informa opencode')
  eq(t.cost, null, 'sin cost, null')

  const u = new TurnTracker(SID)
  u.handle(ev('message.updated', { info: { id: 'm1', sessionID: SID, role: 'assistant', cost: 1.25 } }))
  eq(u.tokens, null)
  eq(u.cost, 1.25)
})

test('turn: tokens con formas raras dan ceros, nunca NaN en el Registro', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'm1', sessionID: SID, role: 'assistant', tokens: { total: 'mucho', input: -5, output: null, reasoning: {}, cache: 'no' }, cost: 'gratis' },
  }))
  eq(t.tokens, { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
  eq(t.cost, null, 'un coste que no es número es «sin dato»')
  const u = new TurnTracker(SID)
  u.handle(ev('message.updated', { info: { id: 'm1', sessionID: SID, role: 'assistant', tokens: 'nada', cost: NaN } }))
  eq(u.tokens, null, 'tokens que no es objeto es como no traer tokens')
  eq(u.cost, null)
})

test('turn: reset olvida los tokens del turno anterior', () => {
  const t = new TurnTracker(SID)
  t.handle(ev('message.updated', {
    info: { id: 'm1', sessionID: SID, role: 'assistant', tokens: { total: 10, input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 1 },
  }))
  t.reset()
  eq(t.tokens, null)
  eq(t.cost, null)
})

// --- H3: peso de las herramientas y orden de los mensajes ----------------

test('toolOutputSize: sólo las salidas de texto de herramientas completadas', () => {
  const parts = [
    { type: 'tool', tool: 'confluence_get_page', state: { status: 'completed', output: 'x'.repeat(1200) } },
    { type: 'tool', tool: 'jira_search', state: { status: 'completed', output: 'abc' } },
    { type: 'tool', tool: 'confluence_search', state: { status: 'running', output: 'x'.repeat(999) } },
    { type: 'tool', tool: 'jira_get_issue', state: { status: 'error', output: 'x'.repeat(999) } },
    { type: 'tool', tool: 'raro', state: { status: 'completed', output: { largo: true } } },
    { type: 'tool', tool: 'sin-estado' },
    { type: 'text', text: 'x'.repeat(500) },
    { type: 'reasoning', text: 'x'.repeat(500) },
    null,
  ]
  eq(toolOutputSize(parts), 1203)
  eq(toolOutputSize([]), 0)
  eq(toolOutputSize(null), 0)
  eq(toolOutputSize(undefined), 0)
  eq(toolOutputSize('no es una lista'), 0)
})

test('toolOutputSize: el texto de una herramienta FALLIDA también se arrastra', () => {
  // Lo que se mide es lo que la sesión reenvía en el turno siguiente, y el error
  // de una herramienta va en el historial igual que su salida: un `jira_search`
  // con un JQL malo devuelve 9 KB de traza y se pegaban al turno de después sin
  // aparecer en «Respuesta recibida» (revisión adversaria de H3). La línea del
  // registro cuenta N herramientas incluyendo las fallidas, así que los KB tienen
  // que hablar de las mismas.
  eq(
    toolOutputSize([
      { type: 'tool', state: { status: 'completed', output: 'x'.repeat(3000) } },
      { type: 'tool', state: { status: 'error', error: 'x'.repeat(9000) } },
    ]),
    12000
  )
  // Un error que no es texto no se puede contar, y la salida de una fallida no es
  // lo que opencode guarda: sin cadena de error, cero.
  eq(toolOutputSize([{ type: 'tool', state: { status: 'error', error: { message: 'roto' } } }]), 0)
  eq(toolOutputSize([{ type: 'tool', state: { status: 'error' } }]), 0)
})

test('sortMessages: por hora de creación, ascendente y estable', () => {
  const m = (id, created, role = 'user') => ({ info: { id, role, time: { created } } })
  const orden = (lista) => sortMessages(lista).map((x) => x.info.id)
  eq(orden([m('c', 3000), m('a', 1000), m('b', 2000)]), ['a', 'b', 'c'])
  // Con la misma hora se conserva el orden de entrada (estable).
  eq(orden([m('x', 1000), m('y', 1000), m('z', 1000)]), ['x', 'y', 'z'])
  eq(orden([]), [])
  eq(sortMessages(null), [])
  eq(sortMessages('nada'), [])
})

test('sortMessages: un mensaje sin hora conserva su sitio, no se va al principio', () => {
  const con = (id, created) => ({ info: { id, role: 'assistant', time: { created } } })
  const sin = (id) => ({ info: { id, role: 'assistant' } })
  const orden = (lista) => sortMessages(lista).map((x) => x.info.id)
  eq(orden([con('a', 1000), sin('b'), con('c', 2000)]), ['a', 'b', 'c'], 'hereda la hora del anterior')
  eq(orden([sin('a'), con('b', 5000), con('c', 3000)]), ['a', 'c', 'b'], 'el primero sin hora se queda delante')
  eq(orden([con('a', 2000), { info: { id: 'b', time: { created: 'ayer' } } }, con('c', 1000)]), ['c', 'a', 'b'])
  // Un objeto sin `info` tampoco tiene hora: hereda la del anterior y no se mueve.
  const raro = { nada: true }
  eq(sortMessages([con('a', 1000), raro, con('c', 2000)])[1], raro)
  eq(sortMessages([null, undefined, con('a', 1)]).length, 1, 'lo que no es un objeto se cae')
})

test('dropOrphans: fuera las respuestas que quedan colgando al principio', () => {
  const u = (id) => ({ info: { id, role: 'user' } })
  const a = (id) => ({ info: { id, role: 'assistant' } })
  const ids = (lista) => dropOrphans(lista).map((x) => x.info.id)
  eq(ids([a('a1'), a('a2'), u('u1'), a('a3')]), ['u1', 'a3'], 'el corte cayó a mitad de un turno')
  eq(ids([u('u1'), a('a1'), u('u2')]), ['u1', 'a1', 'u2'], 'nada que quitar')
  eq(dropOrphans([a('a1'), a('a2')]), [], 'sin ninguna pregunta no hay turno que pintar')
  eq(dropOrphans([]), [])
  eq(dropOrphans(null), [])
  eq(dropOrphans([null, { info: {} }, u('u1')]).length, 1, 'lo de antes del primer usuario se va, tenga forma o no')
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
