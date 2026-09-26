/**
 * El cliente HTTP + SSE de opencode (src/opencode/client.js), sin servidor.
 *
 * Se sustituye `globalThis.fetch` por uno de mentira que apunta cada llamada
 * (método, ruta, cabeceras, cuerpo) y, para `/event`, entrega un
 * ReadableStream por el que la prueba empuja los eventos «data: {json}\n\n»
 * tal como los lee `readEventStream`. Cada prueba restaura el `fetch` real y
 * desconecta el cliente al salir: un stream vivo con su reconexión (1 s, 2 s…)
 * dejaría el proceso colgado.
 *
 * El vigilante de `runTurn` mira cada 1000 ms fijos; la prueba de «colgado»
 * acelera `setInterval` para no esperar un segundo (el presupuesto de
 * temporizadores reales es de milisegundos). La cancelación ya no pasa por el
 * vigilante: la señal se escucha y el turno se resuelve en el mismo tick
 * (docs/PLAN.md §2, C6). `describeError` y el parseo del stream ya están
 * probados en turn.test.js.
 * (Plan 2026-09-13, D6: client.js sin test unitario.)
 */
import { test, eq, assert } from '../harness.js'
import { OpencodeClient, OpencodeError, messageParts } from '../../src/opencode/client.js'
import { SAFE_PERMISSIONS } from '../../src/shared/config.js'
import { MCP_TOOL_PATTERNS, permissionFor } from '../../src/shared/permissions.js'

const BASE = 'http://127.0.0.1:4096'
const SID = 'ses_1'
const ev = (type, properties) => ({ type, properties })

/**
 * Un opencode de mentira. `rutas` es {'POST /session/ses_1/prompt_async': cuerpo | (llamada, servidor) => cuerpo}.
 * Un cuerpo `{status, body}` fija el código y el texto crudo de la respuesta.
 */
function servidorFalso(rutas = {}) {
  const enc = new TextEncoder()
  const s = { calls: [], sse: null }
  s.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const llamada = {
      method: init.method || 'GET',
      path: u.pathname,
      params: Object.fromEntries(u.searchParams),
      headers: init.headers || {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }
    s.calls.push(llamada)
    if (llamada.path === '/event') {
      let controller
      const stream = new ReadableStream({
        start(c) {
          controller = c
        },
      })
      s.sse = {
        push: (event) => controller.enqueue(enc.encode('data: ' + JSON.stringify(event) + '\n\n')),
      }
      // Al desconectar, el cliente aborta la señal: el stream muere como lo haría el de verdad.
      init.signal?.addEventListener(
        'abort',
        () => {
          try {
            controller.error(new DOMException('cancelado', 'AbortError'))
          } catch {
            /* ya cerrado */
          }
        },
        { once: true }
      )
      return { ok: true, status: 200, body: stream, text: async () => '' }
    }
    const ruta = rutas[`${llamada.method} ${llamada.path}`] ?? rutas[llamada.path]
    if (ruta === undefined) return respuesta(404, 'sin ruta: ' + llamada.method + ' ' + llamada.path)
    const r = typeof ruta === 'function' ? await ruta(llamada, s) : ruta
    if (r && typeof r === 'object' && 'status' in r && 'body' in r) return respuesta(r.status, r.body)
    return respuesta(200, r === undefined ? '' : JSON.stringify(r))
  }
  return s
}

function respuesta(status, texto) {
  return { ok: status >= 200 && status < 300, status, body: null, text: async () => String(texto ?? '') }
}

/** Ejecuta `fn(client, servidor)` con el fetch falso instalado; restaura el real y desconecta al salir. */
async function conServidor(rutas, fn) {
  const fetchReal = globalThis.fetch
  const s = servidorFalso(rutas)
  globalThis.fetch = s.fetch
  const client = new OpencodeClient({ baseUrl: BASE, password: 'secreta' })
  try {
    await fn(client, s)
  } finally {
    client.disconnect()
    globalThis.fetch = fetchReal
  }
}

/** El vigilante de runTurn usa setInterval(…, 1000): aquí se acelera a 5 ms. */
async function conIntervaloRapido(fn) {
  const real = globalThis.setInterval
  globalThis.setInterval = (cb, ms, ...rest) => real(cb, Math.min(ms, 5), ...rest)
  try {
    return await fn()
  } finally {
    globalThis.setInterval = real
  }
}

function esperar(cond, maxMs = 200) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tic = () => {
      if (cond()) return resolve()
      if (Date.now() - t0 > maxMs) return reject(new Error('esperando de más'))
      setTimeout(tic, 1)
    }
    tic()
  })
}

/** Los eventos de un turno normal, tal como los reconstruye TurnTracker; se cierra con session.idle. */
function turnoNormal(sid = SID) {
  return [
    ev('message.updated', { info: { id: 'msg_u', sessionID: sid, role: 'user' } }),
    ev('message.updated', {
      info: { id: 'msg_a', sessionID: sid, role: 'assistant', model: { providerID: 'opencode', modelID: 'hy3-free' } },
    }),
    ev('message.part.updated', { part: { id: 'prt_1', sessionID: sid, messageID: 'msg_a', type: 'text', text: 'Hola ' } }),
    ev('message.part.delta', { sessionID: sid, messageID: 'msg_a', partID: 'prt_1', field: 'text', delta: 'mundo' }),
    ev('session.idle', { sessionID: sid }),
  ]
}

// ---- request ----------------------------------------------------------------

test('request: Authorization Basic con «opencode:contraseña» en UTF-8, y Content-Type sólo con cuerpo', () =>
  conServidor({ 'GET /x': { ok: 1 }, 'POST /y': { ok: 2 } }, async (client, s) => {
    eq(await client.request('GET', '/x'), { ok: 1 })
    eq(s.calls[0].headers, { Authorization: 'Basic ' + Buffer.from('opencode:secreta', 'utf8').toString('base64') })
    eq(s.calls[0].headers.Authorization, 'Basic b3BlbmNvZGU6c2VjcmV0YQ==')
    await client.request('POST', '/y', { body: { a: 1 } })
    eq(s.calls[1].headers['Content-Type'], 'application/json')
    eq(s.calls[1].body, { a: 1 })
    // Una contraseña con ñ: btoa trabaja en latin1 y hay que codificar UTF-8 a mano.
    const conEnie = new OpencodeClient({ baseUrl: BASE, password: 'contraseña' })
    await conEnie.request('GET', '/x')
    eq(s.calls[2].headers.Authorization, 'Basic ' + Buffer.from('opencode:contraseña', 'utf8').toString('base64'))
    // Sin contraseña no va cabecera.
    const sinClave = new OpencodeClient({ baseUrl: BASE })
    await sinClave.request('GET', '/x')
    eq(s.calls[3].headers, {})
  }))

test('request: la URL sale del baseUrl sin barra final, con `directory` y sólo los params que no son null/undefined', () =>
  conServidor({ '/session/ses_1/message': [] }, async (client, s) => {
    const c = new OpencodeClient({ baseUrl: BASE + '///', password: 'p', directory: '/home/marco/proy' })
    eq(await c.request('GET', '/session/ses_1/message', { params: { limit: 2, nada: undefined, nulo: null, cero: 0 } }), [])
    eq(s.calls[0].path, '/session/ses_1/message')
    eq(s.calls[0].params, { directory: '/home/marco/proy', limit: '2', cero: '0' })
    eq(c.baseUrl, BASE)
  }))

test('request: 401 → «rechazó la contraseña»; otro error → OpencodeError con status y cuerpo; sin servidor → status 0', () =>
  conServidor(
    {
      '/a': { status: 401, body: '' },
      '/b': { status: 500, body: 'peta' },
      '/c': { status: 204, body: '' },
      '/d': { status: 200, body: '' },
      '/e': { status: 200, body: 'texto plano' },
    },
    async (client) => {
      let err = null
      try {
        await client.request('GET', '/a')
      } catch (e) {
        err = e
      }
      assert(err instanceof OpencodeError && err.status === 401 && /contraseña/.test(err.message), String(err))
      err = null
      try {
        await client.request('GET', '/b')
      } catch (e) {
        err = e
      }
      assert(err instanceof OpencodeError && err.status === 500 && err.body === 'peta' && /devolvió 500/.test(err.message), String(err))
      eq(await client.request('GET', '/c'), null, '204 → null')
      eq(await client.request('GET', '/d'), null, 'cuerpo vacío → null')
      eq(await client.request('GET', '/e'), 'texto plano', 'lo que no es JSON se devuelve tal cual')
      // Sin servidor: fetch revienta → OpencodeError con status 0 y «¿está arrancado?».
      globalThis.fetch = async () => {
        throw new TypeError('fetch failed')
      }
      err = null
      try {
        await client.request('GET', '/a')
      } catch (e) {
        err = e
      }
      assert(err instanceof OpencodeError && err.status === 0 && /arrancado/.test(err.message), String(err))
      // Una cancelación se propaga tal cual: no es un fallo de conexión.
      globalThis.fetch = async () => {
        throw new DOMException('cancelado', 'AbortError')
      }
      err = null
      try {
        await client.request('GET', '/a')
      } catch (e) {
        err = e
      }
      eq(err?.name, 'AbortError')
    }
  ))

// ---- rutas ------------------------------------------------------------------

test('rutas: health, createSession con SAFE_PERMISSIONS, promptAsync, listMcp y abort', () =>
  conServidor(
    {
      'GET /global/health': { healthy: true, version: '1.2.25' },
      'POST /session': { id: SID },
      'POST /session/ses_1/prompt_async': { id: 'msg_1' },
      'GET /mcp': { 'atlassian-x': { status: 'connected' } },
      'POST /session/ses_1/abort': {},
    },
    async (client, s) => {
      eq(await client.health(), { healthy: true, version: '1.2.25' })
      eq([s.calls[0].method, s.calls[0].path], ['GET', '/global/health'])

      eq(await client.createSession({ title: 'Faro · confluence.x.eu' }), { id: SID })
      eq([s.calls[1].method, s.calls[1].path], ['POST', '/session'])
      eq(s.calls[1].body, { title: 'Faro · confluence.x.eu', permission: SAFE_PERMISSIONS })
      // SEGURIDAD: la sesión nace sin nada más que el MCP de Atlassian (§8.13): la primera
      // regla deniega todo, en cualquier ruta, y las demás sólo permiten el MCP.
      const reglas = s.calls[1].body.permission
      eq(reglas[0], { permission: '*', pattern: '**', action: 'deny' })
      assert(reglas.slice(1).every((p) => p.action === 'allow' && p.pattern === '**' && MCP_TOOL_PATTERNS.includes(p.permission)), 'sólo el MCP')
      for (const p of ['bash', 'read', 'write', 'edit', 'apply_patch', 'glob', 'grep', 'webfetch', 'websearch', 'codesearch', 'skill', 'task', 'lsp', 'todowrite']) {
        eq(permissionFor(reglas, p), 'deny', 'se deniega ' + p)
      }
      eq(permissionFor(reglas, 'atlassian-x_jira_search'), 'allow')
      eq(permissionFor(reglas, 'atlassian-x_confluence_get_page'), 'allow')

      eq(await client.promptAsync(SID, { text: 'hola' }), { id: 'msg_1' })
      eq([s.calls[2].method, s.calls[2].path], ['POST', '/session/ses_1/prompt_async'])
      eq(s.calls[2].body, { parts: [{ type: 'text', text: 'hola' }] }, 'sin modelo ni sistema no viajan claves vacías')
      const modelo = { providerID: 'opencode', modelID: 'hy3-free' }
      await client.promptAsync(SID, {
        text: '¿Qué es esto?',
        model: modelo,
        system: 'SISTEMA',
        files: [{ url: 'data:image/png;base64,AAAA', mime: 'image/png', filename: 'foto.png' }, { nombre: 'sin url' }],
      })
      eq(s.calls[3].body, {
        model: modelo,
        system: 'SISTEMA',
        parts: [
          { type: 'text', text: '¿Qué es esto?' },
          { type: 'file', mime: 'image/png', filename: 'foto.png', url: 'data:image/png;base64,AAAA' },
        ],
      })

      eq(await client.listMcp(), { 'atlassian-x': { status: 'connected' } })
      eq([s.calls[4].method, s.calls[4].path], ['GET', '/mcp'])
      await client.abort(SID)
      eq([s.calls[5].method, s.calls[5].path, s.calls[5].body], ['POST', '/session/ses_1/abort', {}])
    }
  ))

test('messageParts: el texto primero y detrás los ficheros con url; sin url no hay parte', () => {
  eq(messageParts('hola'), [{ type: 'text', text: 'hola' }])
  eq(messageParts('hola', [{ url: 'data:image/png;base64,AA' }]), [
    { type: 'text', text: 'hola' },
    { type: 'file', mime: 'image/png', filename: 'adjunto', url: 'data:image/png;base64,AA' },
  ])
  eq(messageParts('hola', [null, {}, { url: 7 }]), [{ type: 'text', text: 'hola' }])
})

test('models: lista plana ordenada por proveedor y nombre, con la marca «free» por el sufijo del id', () =>
  conServidor(
    {
      'GET /config/providers': {
        providers: [
          { id: 'opencode', name: 'OpenCode', models: { 'hy3-free': { name: 'HY3' }, 'big-pickle': {} } },
          // EL CAMBIO (H16): en opencode 1.2.25 el razonamiento está en
          // `capabilities.reasoning`, no en `m.reasoning` —que no existe—, así que
          // esta prueba pinaba el fallo: se leía siempre false. El `reasoning` de
          // fuera ya no cuenta.
          { id: 'github-copilot', models: { 'claude-sonnet-4.6': { reasoning: false, capabilities: { reasoning: true } } } },
        ],
        default: { opencode: 'hy3-free' },
      },
    },
    async (client) => {
      const r = await client.models()
      eq(r.defaults, { opencode: 'hy3-free' })
      eq(
        r.models.map((m) => m.providerID + '/' + m.modelID),
        ['github-copilot/claude-sonnet-4.6', 'opencode/big-pickle', 'opencode/hy3-free']
      )
      eq(r.models[2], {
        providerID: 'opencode',
        modelID: 'hy3-free',
        providerName: 'OpenCode',
        name: 'HY3',
        free: true,
        reasoning: false,
        isDefault: true,
        toolcall: true,
        status: 'active',
        variants: [],
      })
      eq(r.models[0].reasoning, true)
      eq(r.models[0].providerName, 'github-copilot', 'sin nombre, el id')
      eq(r.models[1].free, false)
    }
  ))

// ---- el stream de eventos ---------------------------------------------------

test('SSE: /event va por fetch con Accept: text/event-stream y la cabecera de autenticación; ready() espera a que abra', () =>
  conServidor({}, async (client, s) => {
    eq(client.connected, false)
    eq(await client.ready(), true)
    eq(client.connected, true)
    const abierto = s.calls.find((c) => c.path === '/event')
    eq(abierto.headers.Accept, 'text/event-stream')
    assert(abierto.headers.Authorization?.startsWith('Basic '), 'EventSource no admite cabeceras: por eso va por fetch')
    // Idempotente: otro ready() no abre otro stream.
    eq(await client.ready(), true)
    eq(s.calls.filter((c) => c.path === '/event').length, 1)
    // Los eventos llegan a los oyentes por tipo (properties, event) y al comodín (event), en ese orden.
    const vistos = []
    client.on('session.idle', (p, e) => vistos.push(['idle', p.sessionID, e.type]))
    client.on('*', (e) => vistos.push(['*', e.type]))
    s.sse.push(ev('session.idle', { sessionID: 'ses_9' }))
    await esperar(() => vistos.length >= 2)
    eq(vistos, [['idle', 'ses_9', 'session.idle'], ['*', 'session.idle']])
    // Al desconectar, `connected` vuelve a false.
    client.disconnect()
    eq(client.connected, false)
  }))

// ---- runTurn ----------------------------------------------------------------

test('runTurn: un turno normal — abre el stream, manda prompt_async, reconstruye el texto y acaba con session.idle', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        const eventos = turnoNormal()
        const idle = eventos.pop()
        for (const e of eventos) s.sse.push(e)
        // Lo de otra sesión no entra en este turno.
        s.sse.push(ev('message.part.delta', { sessionID: 'ses_otra', messageID: 'm', partID: 'p', field: 'text', delta: 'AJENO' }))
        s.sse.push(idle)
        return { id: 'msg_1' }
      },
    },
    async (client, s) => {
      const pintados = []
      const modelo = { providerID: 'opencode', modelID: 'hy3-free' }
      const r = await client.runTurn(SID, { text: 'hola', model: modelo, system: 'SISTEMA' }, { onUpdate: (t) => pintados.push(t.text) })
      eq(r.ok, true)
      eq(r.text, 'Hola mundo')
      eq(r.model, modelo)
      eq(r.parts.length, 1)
      eq(r.parts[0].type, 'text')
      eq(r.tools, [])
      eq(r.structured, undefined)
      eq(r.rawError, null)
      eq(r.stalled, undefined)
      eq(r.aborted, undefined)
      eq(pintados, ['Hola ', 'Hola mundo'], 'onUpdate por cada parte y cada delta, con el texto acumulado')
      // Primero el stream (para no perder los primeros eventos), después prompt_async; ningún abort.
      eq(s.calls.map((c) => c.method + ' ' + c.path), ['GET /event', 'POST /session/ses_1/prompt_async'])
      eq(s.calls[1].body, { model: modelo, system: 'SISTEMA', parts: [{ type: 'text', text: 'hola' }] })
      assert(!r.text.includes('AJENO'))
    }
  ))

// H3 (medir): el tracker ya sumaba lo que costó el turno, pero `runTurn` no lo
// sacaba en su resultado y «Respuesta recibida» se quedaba sin ese trozo.
test('runTurn: saca en el resultado lo que costó el turno, y de un mismo mensaje manda la última foto', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        for (const e of turnoNormal()) {
          // `message.updated` del MISMO mensaje llega muchas veces, y cada foto
          // trae el gasto ACUMULADO hasta ese momento: manda la última, no la
          // suma. Sumando por evento, un turno de 21 841 tokens se registraba como
          // 30 000 y pico y el número del Registro no valía para nada.
          if (e.properties?.info?.role === 'assistant') {
            s.sse.push(e)
            s.sse.push(
              ev('message.updated', {
                info: {
                  id: 'msg_a',
                  sessionID: SID,
                  role: 'assistant',
                  tokens: { total: 8000, input: 780, output: 200, reasoning: 0, cache: { read: 7020, write: 0 } },
                  cost: 0.004,
                },
              })
            )
            s.sse.push(
              ev('message.updated', {
                info: {
                  id: 'msg_a',
                  sessionID: SID,
                  role: 'assistant',
                  tokens: { total: 21841, input: 780, output: 806, reasoning: 0, cache: { read: 21035, write: 0 } },
                  cost: 0.011,
                },
              })
            )
          } else s.sse.push(e)
        }
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      const r = await client.runTurn(SID, { text: 'hola' })
      eq(r.tokens, { total: 21841, input: 780, output: 806, reasoning: 0, cache: { read: 21035, write: 0 } }, 'la segunda foto, no las dos sumadas')
      eq(r.cost, 0.011, 'y el coste tampoco se suma consigo mismo')
    }
  ))

test('runTurn: sin tokens ni coste en los mensajes, los dos vienen a null (no a cero)', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        for (const e of turnoNormal()) s.sse.push(e)
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      const r = await client.runTurn(SID, { text: 'hola' })
      eq(r.tokens, null, 'sin dato es null, para que el panel no pinte un cero inventado')
      eq(r.cost, null)
    }
  ))

test('runTurn: una pregunta o un permiso del agente se rechazan solos (nadie va a contestarlos)', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(ev('question.asked', { sessionID: SID, id: 'q_1' }))
        s.sse.push(ev('permission.asked', { sessionID: SID, id: 'p_1' }))
        s.sse.push(ev('question.asked', { sessionID: 'ses_otra', id: 'q_ajena' }))
        for (const e of turnoNormal()) s.sse.push(e)
        return { id: 'msg_1' }
      },
      'POST /question/q_1/reject': {},
      'POST /permission/p_1/reply': {},
    },
    async (client, s) => {
      const r = await client.runTurn(SID, { text: 'hola' })
      eq(r.ok, true)
      const rutas = s.calls.map((c) => c.method + ' ' + c.path)
      assert(rutas.includes('POST /question/q_1/reject'), rutas.join(', '))
      assert(rutas.includes('POST /permission/p_1/reply'), rutas.join(', '))
      eq(s.calls.find((c) => c.path === '/permission/p_1/reply').body, { response: 'reject' })
      assert(!rutas.some((x) => x.includes('q_ajena')), 'lo de otra sesión no es asunto de este turno')
    }
  ))

test('runTurn: session.error cierra el turno con ok:false, el error descrito y el crudo; no se aborta nada', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(
          ev('message.updated', {
            info: { id: 'msg_a', sessionID: SID, role: 'assistant', model: { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' } },
          })
        )
        s.sse.push(ev('session.error', { sessionID: SID, error: { name: 'UnknownError', data: { message: 'Error: Token refresh failed: 401' } } }))
        return { id: 'msg_1' }
      },
    },
    async (client, s) => {
      const r = await client.runTurn(SID, { text: 'hola' })
      eq(r.ok, false)
      assert(/github-copilot/.test(r.error) && /caducado/.test(r.error), 'nombra al proveedor del turno: ' + r.error)
      eq(r.rawError, { name: 'UnknownError', data: { message: 'Error: Token refresh failed: 401' } })
      eq(r.model, { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' })
      assert(!s.calls.some((c) => c.path.endsWith('/abort')), 'el servidor ya lo dio por terminado')
    }
  ))

test('runTurn: si prompt_async falla, el error sale al que llama', () =>
  conServidor({ 'POST /session/ses_1/prompt_async': { status: 500, body: 'sin modelo' } }, async (client) => {
    let err = null
    try {
      await client.runTurn(SID, { text: 'hola' })
    } catch (e) {
      err = e
    }
    assert(err instanceof OpencodeError && err.status === 500, String(err))
  }))

test('runTurn: sin contenido durante stallMs el vigilante lo da por colgado y aborta el turno en el servidor', () =>
  conIntervaloRapido(() =>
    conServidor(
      {
        'POST /session/ses_1/prompt_async': (ll, s) => {
          // Un «busy» repetido no es señal de vida: sólo lo que produce contenido.
          s.sse.push(ev('session.status', { sessionID: SID, status: 'busy' }))
          return { id: 'msg_1' }
        },
        'POST /session/ses_1/abort': {},
      },
      async (client, s) => {
        const t0 = Date.now()
        const r = await client.runTurn(SID, { text: 'hola' }, { stallMs: 20 })
        eq(r.ok, false)
        eq(r.stalled, true)
        eq(r.text, '')
        assert(s.calls.some((c) => c.method === 'POST' && c.path === '/session/ses_1/abort'), 'que el servidor deje de gastar')
        assert(Date.now() - t0 < 1000, 'no espera el segundo del vigilante real')
      }
    )
  ))

// --- H6 P2: razonar es estar vivo, y el silencio se dice ---------------------

test('runTurn: un modelo que sólo razona sigue vivo para el vigilante, y su razonamiento no pide repintar', () =>
  conIntervaloRapido(() =>
    conServidor(
      {
        'POST /session/ses_1/prompt_async': (ll, s) => {
          // Doce trozos de razonamiento en 60 ms, con el plazo de colgado en 80:
          // sin contarlos como señal de vida, el turno moriría por el camino.
          let n = 0
          const tic = setInterval(() => {
            s.sse.push(ev('message.part.delta', { sessionID: SID, messageID: 'msg_a', partID: 'prt_r', field: 'reasoning', delta: 'pienso ' }))
            if (++n < 12) return
            clearInterval(tic)
            s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'Ya está' } }))
            s.sse.push(ev('session.idle', { sessionID: SID }))
          }, 5)
          return { id: 'msg_1' }
        },
        'POST /session/ses_1/abort': {},
      },
      async (client, s) => {
        const pintados = []
        let avisos = 0
        const r = await client.runTurn(
          SID,
          { text: 'hola' },
          { stallMs: 80, onUpdate: (t) => pintados.push(t.text), onWarn: () => avisos++ }
        )
        eq(r.ok, true)
        eq(r.stalled, undefined, 'el razonamiento cuenta como señal de vida')
        eq(r.text, 'Ya está')
        eq(pintados, ['Ya está'], 'y sólo el texto pidió repintar (H6 P2)')
        eq(avisos, 0, 'ni se avisa de silencio mientras razona')
        eq(s.calls.filter((c) => c.path.endsWith('/abort')).length, 0)
      }
    )
  ))

test('runTurn: a mitad del plazo sin señales avisa UNA vez, y sigue esperando hasta el final', () =>
  conIntervaloRapido(() =>
    conServidor(
      { 'POST /session/ses_1/prompt_async': { id: 'msg_1' }, 'POST /session/ses_1/abort': {} },
      async (client) => {
        // El vigilante mira cada 5 ms aquí, y entre el aviso (100 ms) y el
        // colgado (200 ms) da muchas vueltas: «una vez» es una comprobación de
        // verdad y no un accidente del reloj. El plazo va holgado a propósito —en
        // Windows `Date.now()` avanza a saltos de ~16 ms— para que el hueco entre
        // el aviso y el final quepa siempre.
        const avisos = []
        const r = await client.runTurn(SID, { text: 'hola' }, { stallMs: 200, onWarn: (ms) => avisos.push(ms) })
        eq(r.stalled, true, 'el aviso no sustituye al plazo: el turno sigue muriendo a los 200 ms')
        eq(avisos.length, 1, 'un aviso por turno, no uno por vuelta del vigilante')
        assert(avisos[0] >= 100, 'y con los ms que lleva callado: ' + avisos[0])
      }
    )
  ))

test('runTurn: un onWarn que revienta no se lleva el turno por delante', () =>
  conIntervaloRapido(() =>
    conServidor(
      {
        'POST /session/ses_1/prompt_async': (ll, s) => {
          // Calla lo bastante para que salte el aviso (a los 100 ms) y contesta
          // antes del plazo (200 ms).
          setTimeout(() => {
            for (const e of turnoNormal()) s.sse.push(e)
          }, 140)
          return { id: 'msg_1' }
        },
        'POST /session/ses_1/abort': {},
      },
      async (client) => {
        // El cliente escribe el fallo por consola: aquí se calla, o `npm run
        // check` enseñaría una traza en cada ejecución como si algo fuera mal.
        const errorReal = console.error
        console.error = () => {}
        let avisado = 0
        try {
          const r = await client.runTurn(SID, { text: 'hola' }, {
            stallMs: 200,
            onWarn: () => {
              avisado++
              throw new Error('el panel se rompió')
            },
          })
          eq(avisado, 1, 'el aviso llegó (si no, esta prueba no comprueba nada)')
          eq(r.ok, true)
          eq(r.text, 'Hola mundo')
        } finally {
          console.error = errorReal
        }
      }
    )
  ))

// Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2, C6): el vigilante
// sondeaba la señal cada 1 s y al despertar mandaba POST abort; Parar + otra
// pregunta en menos de un segundo, en la MISMA sesión, abortaba el turno nuevo.
test('runTurn: un turno abortado por la señal se resuelve en el mismo tick y no aborta la sesión por su cuenta', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'Empiezo…' } }))
        return { id: 'msg_1' }
      },
      'POST /session/ses_1/abort': {},
    },
    async (client, s) => {
      const ctrl = new AbortController()
      let t0 = 0
      const r = await client.runTurn(
        SID,
        { text: 'hola' },
        {
          stallMs: 5000,
          signal: ctrl.signal,
          onUpdate: () => {
            t0 = Date.now()
            ctrl.abort()
          },
        }
      )
      assert(t0 > 0 && Date.now() - t0 < 50, 'sin esperar al vigilante de 1 s: ' + (Date.now() - t0) + ' ms')
      eq(r.ok, false)
      eq(r.aborted, true)
      eq(r.stalled, undefined)
      eq(r.text, 'Empiezo…', 'lo que ya había llegado se conserva')
      eq(s.calls.filter((c) => c.path.endsWith('/abort')).length, 0, 'quien abortó la señal ya abortó la sesión (el botón Parar)')
      eq(s.calls.map((c) => c.method + ' ' + c.path), ['GET /event', 'POST /session/ses_1/prompt_async'])
    }
  ))

test('runTurn: una señal ya cancelada no manda el prompt (correría sin nadie que lo parara)', () =>
  conServidor({ 'POST /session/ses_1/prompt_async': { id: 'msg_1' } }, async (client, s) => {
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await client.runTurn(SID, { text: 'hola' }, { signal: ctrl.signal })
    eq(r.ok, false)
    eq(r.aborted, true)
    eq(r.text, '')
    eq(s.calls.map((c) => c.method + ' ' + c.path), ['GET /event'], 'ni prompt_async ni abort')
  }))

// Comprobado en el binario de opencode 1.2.25: `DELETE /session/:id` → `Session.remove`
// sólo borra filas; no cancela el turno en marcha. El indexador, el planificador y las
// pasadas de notas cancelan por señal y cierran con `deleteSession`: sin esto, el modelo
// seguiría gastando en una sesión que ya no existe.
test('deleteSession: tras un turno abandonado por la señal aborta antes de borrar; sin turno abandonado, sólo borra', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'Empiezo…' } }))
        return { id: 'msg_1' }
      },
      'POST /session/ses_1/abort': {},
      'DELETE /session/ses_1': true,
      'DELETE /session/ses_2': true,
    },
    async (client, s) => {
      const rutas = () => s.calls.filter((c) => c.path !== '/event').map((c) => c.method + ' ' + c.path)
      const ctrl = new AbortController()
      await client.runTurn(SID, { text: 'hola' }, { signal: ctrl.signal, onUpdate: () => ctrl.abort() })
      eq(rutas(), ['POST /session/ses_1/prompt_async'])
      await client.deleteSession(SID)
      eq(rutas(), ['POST /session/ses_1/prompt_async', 'POST /session/ses_1/abort', 'DELETE /session/ses_1'])
      // Una segunda vez ya no hay nada abandonado.
      await client.deleteSession(SID)
      eq(rutas().slice(3), ['DELETE /session/ses_1'])
      // Una sesión sin turno abandonado: sólo el DELETE.
      await client.deleteSession('ses_2')
      eq(rutas().slice(4), ['DELETE /session/ses_2'])
    }
  ))

test('deleteSession: un turno nuevo en la misma sesión levanta la marca (Parar + otra pregunta no abortan el turno nuevo)', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        if (s.calls.filter((c) => c.path.endsWith('/prompt_async')).length === 1) {
          s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'Primero…' } }))
        } else {
          for (const e of turnoNormal()) s.sse.push(e)
        }
        return { id: 'msg_1' }
      },
      'POST /session/ses_1/abort': {},
      'DELETE /session/ses_1': true,
    },
    async (client, s) => {
      const ctrl = new AbortController()
      const r1 = await client.runTurn(SID, { text: 'hola' }, { signal: ctrl.signal, onUpdate: () => ctrl.abort() })
      eq(r1.aborted, true)
      const r2 = await client.runTurn(SID, { text: 'otra' })
      eq(r2.ok, true)
      eq(r2.text, 'Hola mundo')
      await client.deleteSession(SID)
      const rutas = s.calls.filter((c) => c.path !== '/event').map((c) => c.method + ' ' + c.path)
      eq(rutas, ['POST /session/ses_1/prompt_async', 'POST /session/ses_1/prompt_async', 'DELETE /session/ses_1'], 'ningún abort en ningún momento')
    }
  ))

// Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2, C3): dos arranques
// solapados; el primero hacía `connect()` sobre un cliente que el segundo acababa
// de desconectar, y ese stream zombi reconectaba para siempre.
test('SEGURIDAD: un cliente desconectado no vuelve a abrir el stream (disconnect es definitivo)', () =>
  conServidor({}, async (client) => {
    let bombas = 0
    client._pump = async () => {
      bombas++
    }
    client.connect()
    eq(bombas, 1)
    client.disconnect()
    client.connect()
    eq(bombas, 1, 'connect() tras disconnect() no abre nada')
    eq(client._streamAbort, null)
    eq(client.connected, false)
    const t0 = Date.now()
    eq(await client.ready(), false, 'un cliente cerrado no está listo')
    assert(Date.now() - t0 < 100, 'y no espera los 8 s del plazo')
    eq(bombas, 1)
  }))

// Revisión adversaria de H2 (2026-09-14): `runTurn` hacía `await this.ready()` y
// TIRABA el valor. Con el cliente cerrado (C3) el stream no vuelve a abrirse nunca,
// así que se mandaba un `prompt_async` del que no iba a llegar ni un evento: el
// modelo trabajaba de verdad en el servidor y el turno sólo moría al agotar
// `stallMs` (120 s en el indexador). Un cliente cerrado no manda nada.
test('SEGURIDAD: un cliente cerrado no manda prompt_async (el turno correría sin que llegara ni un evento)', () =>
  conServidor({ 'POST /session/ses_1/prompt_async': { id: 'msg_1' }, 'POST /session/ses_1/abort': {} }, async (client, s) => {
    client.disconnect()
    const t0 = Date.now()
    const r = await client.runTurn(SID, { text: 'hola' }, { stallMs: 20 })
    eq(r, { ok: false, aborted: true, closed: true, parts: [], text: '', tools: [] })
    eq(s.calls.length, 0, 'ni /event, ni prompt_async, ni abort: no hay nada que abortar')
    assert(Date.now() - t0 < 100, 'y no espera ni al plazo de ready() ni al vigilante')
    // promptStructured pasa por runTurn: un turno `aborted` es «Cancelado.», que es
    // como el panel trata cerrar los ajustes a mitad de indexado.
    let err = null
    try {
      await client.promptStructured(SID, { text: 'plan', schema: {} })
    } catch (e) {
      err = e
    }
    assert(err instanceof OpencodeError && /Cancelado/.test(err.message), String(err))
    eq(s.calls.length, 0)
  }))

// R4 (docs/PLAN.md §2): mandaba `{model}` y el esquema de POST /session/:id/summarize
// en /doc de opencode 1.2.25 exige `providerID` y `modelID` (400 seguro). Sin uso en el panel hoy.
test('summarize: el cuerpo es {providerID, modelID}, como exige el esquema de /doc; sin modelo no se manda nada', () =>
  conServidor({ 'POST /session/ses_1/summarize': true }, async (client, s) => {
    const modelo = { providerID: 'opencode', modelID: 'hy3-free', name: 'HY3', free: true }
    eq(await client.summarize(SID, modelo), true)
    eq([s.calls[0].method, s.calls[0].path], ['POST', '/session/ses_1/summarize'])
    eq(s.calls[0].body, { providerID: 'opencode', modelID: 'hy3-free' }, 'sólo lo que pide el esquema: ni «model» ni el resto del objeto')
    let err = null
    try {
      await client.summarize(SID, { providerID: 'opencode' })
    } catch (e) {
      err = e
    }
    assert(err instanceof OpencodeError && /providerID|modelID/.test(err.message), String(err))
    err = null
    try {
      await client.summarize(SID)
    } catch (e) {
      err = e
    }
    assert(err instanceof OpencodeError, String(err))
    eq(s.calls.length, 1, 'el servidor contestaría 400: no se le pregunta')
  }))

// ---- promptStructured -------------------------------------------------------

test('promptStructured: pide format json_schema y devuelve el input validado de StructuredOutput', () =>
  conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SID, role: 'assistant' } }))
        s.sse.push(
          ev('message.part.updated', {
            part: {
              id: 'prt_t',
              sessionID: SID,
              messageID: 'msg_a',
              type: 'tool',
              tool: 'StructuredOutput',
              state: { status: 'completed', input: { navigate: true, destination: { kind: 'confluence-page', id: '400' } }, metadata: { valid: true } },
            },
          })
        )
        s.sse.push(ev('session.idle', { sessionID: SID }))
        return { id: 'msg_1' }
      },
    },
    async (client, s) => {
      const schema = { type: 'object', properties: { navigate: { type: 'boolean' } } }
      const r = await client.promptStructured(SID, { text: 'plan', schema, model: { providerID: 'p', modelID: 'm' }, system: 'S' })
      eq(r, { navigate: true, destination: { kind: 'confluence-page', id: '400' } })
      const body = s.calls.find((c) => c.path.endsWith('/prompt_async')).body
      eq(body.format, { type: 'json_schema', schema, retryCount: 2 }, 'retryCount viaja aunque opencode 1.2.25 no lo lea (§7)')
      eq(body.system, 'S')
      eq(body.model, { providerID: 'p', modelID: 'm' })
      eq(body.parts, [{ type: 'text', text: 'plan' }])
    }
  ))

test('promptStructured: sin StructuredOutput, o sin validar, lanza OpencodeError (el reintento lo hace quien llama)', async () => {
  await conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'Te lo cuento en prosa.' } }))
        s.sse.push(ev('session.idle', { sessionID: SID }))
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      let err = null
      try {
        await client.promptStructured(SID, { text: 'plan', schema: {} })
      } catch (e) {
        err = e
      }
      assert(err instanceof OpencodeError && /no devolvió salida estructurada/.test(err.message), String(err))
      assert(err.message.includes('Te lo cuento'), 'con lo que dijo en prosa, para el registro')
    }
  )
  await conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        s.sse.push(
          ev('message.part.updated', {
            part: {
              id: 'prt_t',
              sessionID: SID,
              messageID: 'msg_a',
              type: 'tool',
              tool: 'StructuredOutput',
              state: { status: 'completed', input: { x: 1 }, metadata: { valid: false } },
            },
          })
        )
        s.sse.push(ev('session.idle', { sessionID: SID }))
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      let err = null
      try {
        await client.promptStructured(SID, { text: 'plan', schema: {} })
      } catch (e) {
        err = e
      }
      assert(err instanceof OpencodeError && /validación del esquema/.test(err.message), String(err))
    }
  )
})

// ---- H16: lo que la lista y los errores dicen del modelo ---------------------

import { readFileSync as leerFixture } from 'node:fs'

/**
 * GET /config/providers de Marco (test/fixtures/models/providers.json), devuelto
 * a la forma que da opencode: la fixture guarda sólo los NOMBRES de las variantes
 * (lo demás de cada variante no hace falta y no se guardó), y opencode las manda
 * como un objeto por nombre.
 */
const PROVIDERS_REALES = (() => {
  const f = JSON.parse(leerFixture(new URL('../fixtures/models/providers.json', import.meta.url), 'utf8'))
  return {
    default: f.default,
    providers: f.providers.map((p) => ({
      ...p,
      models: Object.fromEntries(
        Object.entries(p.models).map(([id, m]) => [id, { ...m, variants: Object.fromEntries(m.variants.map((v) => [v, {}])) }])
      ),
    })),
  }
})()

test('H16: models() dice de cada modelo si es el predeterminado, si tiene herramientas, su estado y sus variantes', () =>
  conServidor(
    {
      'GET /config/providers': {
        providers: [
          ...PROVIDERS_REALES.providers,
          {
            id: 'raro',
            name: 'Raro',
            models: {
              viejo: { name: 'Viejo', status: 'deprecated', capabilities: { toolcall: true, reasoning: false } },
              mudo: { capabilities: { toolcall: false } },
              pelado: {},
              lista: { variants: ['low', 'high'], status: '' },
            },
          },
        ],
        default: PROVIDERS_REALES.default,
      },
    },
    async (client) => {
      const { models, defaults } = await client.models()
      eq(defaults, { openai: 'gpt-5.4', 'github-copilot': 'claude-sonnet-4.6', opencode: 'big-pickle' })
      const reales = models.filter((m) => m.providerID !== 'raro')
      eq(reales.length, 43, 'los 43 modelos de los tres proveedores conectados de Marco')
      eq(
        reales.filter((m) => m.isDefault).map((m) => m.providerID + '/' + m.modelID),
        ['github-copilot/claude-sonnet-4.6', 'openai/gpt-5.4', 'opencode/big-pickle'],
        'uno por proveedor, el de su mapa default'
      )
      assert(reales.every((m) => m.toolcall === true && m.status === 'active' && m.reasoning === true), 'y ninguno dice si tu plan lo permite')
      const gpt54 = reales.find((m) => m.providerID === 'openai' && m.modelID === 'gpt-5.4')
      eq(gpt54.variants, ['none', 'low', 'medium', 'high', 'xhigh'])
      const raro = Object.fromEntries(models.filter((m) => m.providerID === 'raro').map((m) => [m.modelID, m]))
      eq([raro.viejo.status, raro.viejo.toolcall, raro.viejo.reasoning], ['deprecated', true, false])
      eq([raro.mudo.toolcall, raro.mudo.status], [false, 'active'], 'sin herramientas, marcado; sin estado, activo')
      eq([raro.pelado.toolcall, raro.pelado.reasoning, raro.pelado.variants, raro.pelado.isDefault], [true, false, [], false])
      eq([raro.lista.variants, raro.lista.status], [[], 'active'], 'unas variantes que no son un objeto no son variantes')
    }
  ))

test('H16: promptStructured lanza con el error crudo, el modelo y si se calló, en los tres caminos del modelo', async () => {
  const MODELO = { providerID: 'github-copilot', modelID: 'claude-sonnet-4.6' }
  const asistente = (s) => s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SID, role: 'assistant', model: MODELO } }))
  const capturar = async (client, control) => {
    try {
      await client.promptStructured(SID, { text: 'plan', schema: {} }, control)
    } catch (e) {
      return e
    }
    return null
  }
  const CRUDO = { name: 'APIError', data: { message: 'The requested model is not available for integrator "opencode".', statusCode: 400, isRetryable: false } }

  // 1. El proveedor lo rechaza.
  await conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        asistente(s)
        s.sse.push(ev('session.error', { sessionID: SID, error: CRUDO }))
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      const err = await capturar(client)
      assert(err instanceof OpencodeError, String(err))
      eq(err.rawError, CRUDO)
      eq(err.model, MODELO)
      eq(err.stalled, undefined, 'no se calló: contestó con un error')
    }
  )

  // 2. Se calla hasta el plazo del vigilante.
  await conIntervaloRapido(() =>
    conServidor(
      {
        'POST /session/ses_1/prompt_async': (ll, s) => {
          asistente(s)
          return { id: 'msg_1' }
        },
        'POST /session/ses_1/abort': {},
      },
      async (client) => {
        const err = await capturar(client, { stallMs: 20 })
        assert(err instanceof OpencodeError && /colgado/.test(err.message), String(err))
        eq(err.stalled, true)
        eq(err.rawError, null, 'callarse no trae error del proveedor')
        eq(err.model, MODELO)
      }
    )
  )

  // 3. Contesta en prosa en vez de con la salida estructurada.
  await conServidor(
    {
      'POST /session/ses_1/prompt_async': (ll, s) => {
        asistente(s)
        s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SID, messageID: 'msg_a', type: 'text', text: 'En prosa.' } }))
        s.sse.push(ev('session.idle', { sessionID: SID }))
        return { id: 'msg_1' }
      },
    },
    async (client) => {
      const err = await capturar(client)
      assert(err instanceof OpencodeError && /no devolvió salida estructurada/.test(err.message), String(err))
      eq([err.rawError, err.model, err.stalled], [null, MODELO, undefined])
    }
  )
})

// ---- H17: la sonda de «Comprobar» ------------------------------------------
// Un turno corto con ese modelo, en su propia sesión desechable, SÓLO cuando el
// usuario pulsa «Comprobar» (docs/PLAN2.md §3.3). Todo con el servidor falso:
// ninguna prueba manda un turno a un modelo de verdad.

const SONDA = 'ses_sonda'
const LUNA = { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }

/** Las rutas de una sesión de sonda: crearla, abortarla y borrarla. */
function rutasDeSonda(promptAsync) {
  return {
    'POST /session': { id: SONDA },
    [`POST /session/${SONDA}/prompt_async`]: promptAsync,
    [`POST /session/${SONDA}/abort`]: true,
    [`DELETE /session/${SONDA}`]: true,
  }
}

/** Las llamadas a la sesión de sonda, sin el stream: método y ruta. */
const pasosDeSonda = (s) => s.calls.filter((c) => c.path !== '/event').map((c) => c.method + ' ' + c.path)

test('H17: probeModel — un turno corto en su sesión desechable, con el nivel de razonamiento más barato, y la borra al acabar', async () => {
  const contesta = (ll, s) => {
    s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SONDA, role: 'assistant', model: LUNA } }))
    s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SONDA, messageID: 'msg_a', type: 'text', text: 'ok' } }))
    s.sse.push(ev('session.idle', { sessionID: SONDA }))
    return { id: 'msg_1' }
  }
  await conServidor(rutasDeSonda(contesta), async (client, s) => {
    const r = await client.probeModel({ ...LUNA, variants: ['none', 'low', 'high'] })
    eq(Object.keys(r).sort(), ['model', 'ms', 'ok', 'rawError', 'stalled', 'text'], 'claves exactas')
    eq([r.ok, r.text, r.rawError, r.stalled], [true, 'ok', null, false])
    // `eq` compara por JSON y dentro de una lista un undefined sale como null:
    // la diferencia la ve quien pregunta `r.rawError === null`, así que se pina aparte.
    assert(r.rawError === null, 'null, no undefined')
    eq(r.model, LUNA, 'el modelo que se comprobó, sin las variantes')
    assert(typeof r.ms === 'number' && r.ms >= 0 && Number.isFinite(r.ms), 'ms: ' + r.ms)
    // SEGURIDAD: la sesión de la sonda lleva SAFE_PERMISSIONS (la primera regla lo deniega todo).
    const crear = s.calls.find((c) => c.method === 'POST' && c.path === '/session')
    eq(crear.body, { title: 'Faro · probando modelo', permission: SAFE_PERMISSIONS })
    eq(crear.body.permission[0], { permission: '*', pattern: '**', action: 'deny' })
    const turno = s.calls.find((c) => c.path === `/session/${SONDA}/prompt_async`)
    eq(turno.body, {
      model: LUNA,
      system: 'Es una comprobación de disponibilidad. Contesta sólo «ok». No uses herramientas.',
      variant: 'none',
      parts: [{ type: 'text', text: 'Responde sólo: ok' }],
    })
    // Acabó bien: se borra la sesión y NO se aborta nada.
    eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/prompt_async`, `DELETE /session/${SONDA}`])
  })

  // Sin ninguna variante barata declarada, el cuerpo no lleva la clave `variant`.
  // Los nombres se comparan tal cual: un «NONE» no es el «none» que opencode
  // espera, y mandar uno que el modelo no declara sería pedir algo que no existe.
  for (const variants of [undefined, [], ['medium', 'high'], 'none', ['NONE', 'Low']]) {
    await conServidor(rutasDeSonda(contesta), async (client, s) => {
      const r = await client.probeModel({ ...LUNA, variants })
      eq(r.ok, true)
      const turno = s.calls.find((c) => c.path === `/session/${SONDA}/prompt_async`)
      eq('variant' in turno.body, false, 'sin variante barata no hay variant: ' + JSON.stringify(variants))
    })
  }
  // Y el orden de preferencia es none → minimal → low, nunca una más cara.
  for (const [variants, esperada] of [[['high', 'low', 'minimal'], 'minimal'], [['xhigh', 'low'], 'low']]) {
    await conServidor(rutasDeSonda(contesta), async (client, s) => {
      await client.probeModel({ ...LUNA, variants })
      eq(s.calls.find((c) => c.path === `/session/${SONDA}/prompt_async`).body.variant, esperada)
    })
  }
})

test('H17: probeModel — un rechazo del proveedor es ok:false con el error crudo; no se aborta (ya acabó) y se borra', () =>
  conServidor(
    rutasDeSonda((ll, s) => {
      s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SONDA, role: 'assistant', model: LUNA } }))
      s.sse.push(ev('session.error', { sessionID: SONDA, error: { name: 'APIError', data: { message: 'The requested model is not available for integrator "opencode".', statusCode: 400 } } }))
      return { id: 'msg_1' }
    }),
    async (client, s) => {
      const r = await client.probeModel(LUNA)
      eq([r.ok, r.stalled, r.text], [false, false, ''])
      eq(r.rawError, { name: 'APIError', data: { message: 'The requested model is not available for integrator "opencode".', statusCode: 400 } })
      eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/prompt_async`, `DELETE /session/${SONDA}`], 'quien falló ya acabó: ningún abort')
    }
  ))

test('H17: probeModel — un modelo mudo se da por colgado al plazo, y se aborta ANTES de borrar la sesión', () =>
  conIntervaloRapido(() =>
    conServidor(
      rutasDeSonda((ll, s) => {
        s.sse.push(ev('session.status', { sessionID: SONDA, status: 'busy' }))
        return { id: 'msg_1' }
      }),
      async (client, s) => {
        const t0 = Date.now()
        const r = await client.probeModel(LUNA, { timeoutMs: 20 })
        eq([r.ok, r.stalled, r.rawError, r.text], [false, true, null, ''])
        assert(r.rawError === null, 'null, no undefined')
        const pasos = pasosDeSonda(s)
        const abortar = pasos.indexOf(`POST /session/${SONDA}/abort`)
        const borrar = pasos.indexOf(`DELETE /session/${SONDA}`)
        assert(abortar > -1, 'el turno se aborta: DELETE no lo cancela')
        assert(borrar > -1, 'y la sesión se borra')
        assert(abortar < borrar, 'primero abortar, después borrar: ' + pasos.join(' · '))
        eq(pasos[pasos.length - 1], `DELETE /session/${SONDA}`)
        assert(Date.now() - t0 < 1000, 'el plazo es el que se le da, no el del chat')
      }
    )
  ))

test('H17: probeModel — un modelo que razona sin fin también se corta al plazo, y uno que acaba sin decir nada no cuenta como «ok»', async () => {
  // Razonar es estar vivo para el vigilante (H6 P2): sin el `maxMs` de la sonda,
  // un modelo que sólo piensa tendría a la persona mirando «Comprobando…» quince
  // minutos. Aquí piensa sin parar y la sonda lo corta a su plazo igual.
  await conIntervaloRapido(() =>
    conServidor(
      {
        ...rutasDeSonda((ll, s) => {
          s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SONDA, role: 'assistant', model: LUNA } }))
          s.pensando = setInterval(() => {
            s.sse.push(ev('message.part.delta', { sessionID: SONDA, messageID: 'msg_a', partID: 'prt_r', field: 'reasoning', delta: 'hmm ' }))
          }, 2)
          return { id: 'msg_1' }
        }),
        [`DELETE /session/${SONDA}`]: (ll, s) => {
          clearInterval(s.pensando)
          return true
        },
      },
      async (client, s) => {
        try {
          const t0 = Date.now()
          const r = await client.probeModel(LUNA, { timeoutMs: 40 })
          eq([r.ok, r.stalled, r.text], [false, true, ''])
          assert(Date.now() - t0 < 1000, 'cortado a su plazo aunque no deje de dar señales')
          const pasos = pasosDeSonda(s)
          assert(pasos.indexOf(`POST /session/${SONDA}/abort`) > -1, 'y abortado: ' + pasos.join(' · '))
          eq(pasos[pasos.length - 1], `DELETE /session/${SONDA}`)
        } finally {
          clearInterval(s.pensando)
        }
      }
    )
  )

  // Acabar «bien» sin una palabra (session.idle sin texto) no es contestar.
  await conServidor(
    rutasDeSonda((ll, s) => {
      s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SONDA, role: 'assistant', model: LUNA } }))
      s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SONDA, messageID: 'msg_a', type: 'text', text: '   ' } }))
      s.sse.push(ev('session.idle', { sessionID: SONDA }))
      return { id: 'msg_1' }
    }),
    async (client, s) => {
      const r = await client.probeModel(LUNA)
      eq([r.ok, r.stalled, r.text, r.rawError], [false, false, '', null], 'mudo aunque el turno acabara')
      assert(r.rawError === null, 'null, no undefined')
      eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/prompt_async`, `DELETE /session/${SONDA}`], 'acabó solo: no hay nada que abortar')
    }
  )
})

test('H17: probeModel — cancelada por la señal, aborta ella misma una sola vez y borra', async () => {
  const quieto = () => ({ id: 'msg_1' })
  await conServidor(rutasDeSonda(quieto), async (client, s) => {
    const ctrl = new AbortController()
    const promesa = client.probeModel(LUNA, { signal: ctrl.signal })
    await esperar(() => s.calls.some((c) => c.path === `/session/${SONDA}/prompt_async`))
    ctrl.abort()
    const r = await promesa
    eq([r.ok, r.stalled], [false, false])
    eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/prompt_async`, `POST /session/${SONDA}/abort`, `DELETE /session/${SONDA}`], 'un abort, no dos')
  })

  // Con el cliente ya cerrado, runTurn vuelve con su forma corta, que NO trae
  // `rawError` (revisión adversaria de H2): es el único camino en el que el del
  // turno llega undefined, y la sonda tiene que decir null igual. No se manda
  // ningún turno; la sesión que sí se creó se aborta y se borra.
  await conServidor(rutasDeSonda(quieto), async (client, s) => {
    client.disconnect()
    const r = await client.probeModel(LUNA)
    eq([r.ok, r.stalled, r.text], [false, false, ''])
    assert(r.rawError === null, 'null, no undefined, también con el cliente cerrado')
    eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/abort`, `DELETE /session/${SONDA}`], 'ningún prompt_async con el cliente cerrado')
  })
})

test('H17: probeModel nunca lanza — opencode caído, una sesión que no se crea, un prompt que revienta o un modelo sin forma', async () => {
  // Sin servidor: fetch revienta.
  const fetchReal = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  const suelto = new OpencodeClient({ baseUrl: BASE, password: 'secreta' })
  try {
    const r = await suelto.probeModel(LUNA)
    eq([r.ok, r.stalled, r.text], [false, false, ''])
    eq(r.rawError.name, 'OpencodeError', 'distinguible de un rechazo del proveedor')
    eq(Object.keys(r.rawError).sort(), ['message', 'name', 'status'], 'sin el cuerpo de opencode')
    eq(r.model, LUNA)
  } finally {
    suelto.disconnect()
    globalThis.fetch = fetchReal
  }

  // La sesión no se crea (500): nada que abortar ni borrar.
  await conServidor({ 'POST /session': { status: 500, body: 'no' } }, async (client, s) => {
    const r = await client.probeModel(LUNA)
    eq([r.ok, r.rawError.name, r.rawError.status], [false, 'OpencodeError', 500])
    eq(pasosDeSonda(s), ['POST /session'])
  })

  // La sesión «se crea» pero opencode no devuelve su id: no se manda ningún
  // turno a una ruta sin sesión, ni se aborta ni se borra nada.
  await conServidor({ ...rutasDeSonda(() => ({ id: 'msg_1' })), 'POST /session': {} }, async (client, s) => {
    const r = await client.probeModel(LUNA)
    eq([r.ok, r.rawError.name], [false, 'OpencodeError'])
    eq(pasosDeSonda(s), ['POST /session'], 'sin id no hay turno')
  })

  // El prompt revienta a medias: se aborta por si acaso y se borra.
  await conServidor(rutasDeSonda({ status: 500, body: 'sin modelo' }), async (client, s) => {
    const r = await client.probeModel(LUNA)
    eq([r.ok, r.rawError.status], [false, 500])
    eq(pasosDeSonda(s), ['POST /session', `POST /session/${SONDA}/prompt_async`, `POST /session/${SONDA}/abort`, `DELETE /session/${SONDA}`])
  })

  // El DELETE del final falla (500) tras un turno BUENO: la sonda dice lo que
  // contestó el modelo y no lanza. Borrar es limpieza: si opencode no deja, la
  // persona no tiene por qué ver un error donde su modelo sí contestó.
  await conServidor(
    {
      ...rutasDeSonda((ll, s) => {
        s.sse.push(ev('message.updated', { info: { id: 'msg_a', sessionID: SONDA, role: 'assistant', model: LUNA } }))
        s.sse.push(ev('message.part.updated', { part: { id: 'prt_1', sessionID: SONDA, messageID: 'msg_a', type: 'text', text: 'ok' } }))
        s.sse.push(ev('session.idle', { sessionID: SONDA }))
        return { id: 'msg_1' }
      }),
      [`DELETE /session/${SONDA}`]: { status: 500, body: 'no' },
    },
    async (client, s) => {
      let r = null
      try {
        r = await client.probeModel(LUNA)
      } catch (err) {
        assert(false, 'lanzó con el DELETE en 500: ' + (err?.message || err))
      }
      eq([r.ok, r.text], [true, 'ok'], 'el modelo contestó: un DELETE que falla no lo cambia')
      const pasos = pasosDeSonda(s)
      eq(pasos[pasos.length - 1], `DELETE /session/${SONDA}`, 'y el DELETE se mandó igual: ' + pasos.join(' · '))
    }
  )

  // Cancelada por la señal y el abort del final falla (500): no lanza, y la
  // sesión se intenta borrar igual, detrás del abort.
  await conServidor(
    { ...rutasDeSonda(() => ({ id: 'msg_1' })), [`POST /session/${SONDA}/abort`]: { status: 500, body: 'no' } },
    async (client, s) => {
      const ctrl = new AbortController()
      const promesa = client.probeModel(LUNA, { signal: ctrl.signal })
      await esperar(() => s.calls.some((c) => c.path === `/session/${SONDA}/prompt_async`))
      ctrl.abort()
      let r = null
      try {
        r = await promesa
      } catch (err) {
        assert(false, 'lanzó con el abort en 500: ' + (err?.message || err))
      }
      eq(r.ok, false)
      const pasos = pasosDeSonda(s)
      const abortar = pasos.indexOf(`POST /session/${SONDA}/abort`)
      const borrar = pasos.indexOf(`DELETE /session/${SONDA}`)
      assert(abortar > -1, 'el abort se mandó: ' + pasos.join(' · '))
      assert(borrar > abortar, 'y el DELETE detrás, aunque el abort fallara: ' + pasos.join(' · '))
    }
  )

  // Un modelo sin forma no crea ninguna sesión.
  await conServidor(rutasDeSonda(() => ({})), async (client, s) => {
    for (const malo of [null, undefined, 'github-copilot/gpt-5.6-luna', {}, { providerID: 'x' }]) {
      const r = await client.probeModel(malo)
      eq([r.ok, r.model], [false, null], JSON.stringify(malo))
    }
    eq(pasosDeSonda(s), [], 'ni una petición')
  })
})

// ---- H18: escribir el MCP en la configuración de opencode -------------------
//
// PATCH /global/config escribe el fichero global Y recarga (anexo 2-A). Su
// respuesta buena trae la configuración ENTERA con los tokens de todos los MCP
// en claro, y un 500 ConfigJsonError trae el fichero entero dentro del error:
// nada de eso puede acabar en el registro, en OpencodeError.body ni en lo que
// devuelven las dos puertas.

import { MCP_ENV_KEYS } from '../../src/shared/mcp-config.js'
import { MCP_ATLASSIAN_VERSION } from '../../src/shared/config.js'

const TOKEN = 'FALSO-5678-token-de-mentira'
const CONFIG_CON_TOKENS = { $schema: 'x', mcp: { otro: { type: 'local', command: ['x'], environment: { JIRA_PERSONAL_TOKEN: TOKEN } } } }
const ROTO = JSON.stringify({ name: 'ConfigJsonError', data: { path: 'C:/h/opencode.json', message: '--- JSONC Input --- {"mcp":{"otro":{"environment":{"JIRA_PERSONAL_TOKEN":"' + TOKEN + '"}}' } })

/** Un registro que apunta TODO lo que el cliente le cuenta, en cualquier nivel. */
function registroQueApunta() {
  const lineas = []
  const apunta = (nivel) => (...args) => lineas.push(nivel + ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  return { lineas, logger: { debug: apunta('debug'), info: apunta('info'), warn: apunta('warn'), error: apunta('error') } }
}

/** Una entrada MCP buena, como la escribe Faro. */
function entradaMcp(cambios = {}) {
  const environment = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, '']))
  Object.assign(environment, { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'pat-nuevo', READ_ONLY_MODE: 'true', TOOLSETS: 'all' })
  return { type: 'local', command: ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION], environment, enabled: true, timeout: 60000, ...cambios }
}

async function errorDe(p) {
  try {
    await p
  } catch (e) {
    return e
  }
  return null
}

test('SEGURIDAD H18: con sensitive ni el registro ni OpencodeError.body llevan el cuerpo, tampoco en config()', () =>
  conServidor(
    {
      'GET /config': { status: 500, body: ROTO },
      'GET /roto-400': { status: 400, body: JSON.stringify({ name: 'ConfigInvalidError', data: { issues: [{ message: TOKEN }] } }) },
      'GET /roto-raro': { status: 500, body: JSON.stringify({ name: 'Config<script>' + TOKEN }) },
      'GET /roto-texto': { status: 500, body: 'no es json ' + TOKEN },
      'GET /normal': { status: 500, body: ROTO },
    },
    async (_c, s) => {
      const { lineas, logger } = registroQueApunta()
      const client = new OpencodeClient({ baseUrl: BASE, password: 'secreta', logger })
      const err = await errorDe(client.config())
      assert(err instanceof OpencodeError, 'config() sigue lanzando su error')
      eq([err.status, err.body, err.kind], [500, null, 'ConfigJsonError'], 'sin cuerpo; sólo qué fue')
      eq([s.calls[0].method, s.calls[0].path], ['GET', '/config'])
      const e400 = await errorDe(client.request('GET', '/roto-400', { sensitive: true }))
      eq([e400.status, e400.body, e400.kind], [400, null, 'ConfigInvalidError'])
      eq((await errorDe(client.request('GET', '/roto-raro', { sensitive: true }))).kind, '', 'un name sin forma de identificador no pasa')
      eq((await errorDe(client.request('GET', '/roto-texto', { sensitive: true }))).kind, '', 'sin JSON, sin kind')
      const todo = lineas.join('\n') + JSON.stringify([err, e400]) + String(err.message) + String(e400.message)
      assert(!todo.includes(TOKEN), 'SEGURIDAD: el token no está en nada de lo que el cliente registró ni en los errores')
      assert(lineas.some((l) => l.includes('500 · ConfigJsonError')), 'el registro dice el código y el kind: ' + lineas.join(' | '))
      // Sin sensitive, lo de siempre: el cuerpo se guarda y se registra (por eso config() lo lleva).
      const normal = await errorDe(client.request('GET', '/normal'))
      assert(String(normal.body).includes(TOKEN) && lineas.at(-1).includes('ConfigJsonError'), 'sin sensitive nada cambia')
    }
  ))

test('SEGURIDAD H18: config() va sensitive y su respuesta buena se sigue devolviendo entera (checkMcp la necesita)', () =>
  conServidor({ 'GET /config': CONFIG_CON_TOKENS }, async (client) => {
    eq(await client.config(), CONFIG_CON_TOKENS)
  }))

test('H18: updateMcpEntries — PATCH /global/config con el cuerpo exacto; devuelve {ok, status, kind} y NADA de la respuesta', () =>
  conServidor({ 'PATCH /global/config': CONFIG_CON_TOKENS }, async (_c, s) => {
    const { lineas, logger } = registroQueApunta()
    const client = new OpencodeClient({ baseUrl: BASE, password: 'secreta', logger })
    const e = entradaMcp()
    const r = await client.updateMcpEntries({ 'atlassian-jira-x-eu': e })
    eq(r, { ok: true, status: 200, kind: '' })
    eq(Object.keys(r).sort(), ['kind', 'ok', 'status'], 'claves exactas: nunca la configuración')
    const llamada = s.calls[0]
    eq([llamada.method, llamada.path], ['PATCH', '/global/config'])
    eq(llamada.body, { mcp: { 'atlassian-jira-x-eu': e } }, 'el cuerpo exacto')
    eq(Object.keys(llamada.body), ['mcp'], 'SEGURIDAD: ninguna otra clave raíz que mcp')
    eq(llamada.headers.Authorization, 'Basic b3BlbmNvZGU6c2VjcmV0YQ==')
    eq(llamada.headers['Content-Type'], 'application/json')
    assert(!JSON.stringify(r).includes(TOKEN) && !lineas.join('\n').includes(TOKEN), 'la respuesta, con los tokens de todos los MCP, se tira')
    // Lo conocido por nombre deja conservar el command del usuario; sin ello, la barrera lo tira sin pedir nada.
    const docker = ['docker', 'run', '-i', 'img']
    eq(await client.updateMcpEntries({ mio: entradaMcp({ command: docker }) }, { known: { mio: docker } }), { ok: true, status: 200, kind: '' })
    eq(s.calls[1].body.mcp.mio.command, docker)
    const antes = s.calls.length
    for (const mala of [{ mio: entradaMcp({ command: docker }) }, { mio: entradaMcp({ agent: {} }) }, { 'con espacio': entradaMcp() }, {}, null]) {
      eq(await client.updateMcpEntries(mala), { ok: false, status: 0, kind: 'entrada' }, 'no vale: ' + String(JSON.stringify(mala)).slice(0, 40))
    }
    eq(s.calls.length, antes, 'SEGURIDAD: lo que la barrera no deja pasar no sale en ninguna petición')
  }))

test('SEGURIDAD H18: las dos puertas con un 500 ConfigJsonError, un 400, un 401 o sin red: {ok:false, status, kind}, sin el cuerpo', async () => {
  const casos = [
    [{ status: 500, body: ROTO }, { ok: false, status: 500, kind: 'ConfigJsonError' }],
    [{ status: 400, body: JSON.stringify({ name: 'ConfigInvalidError', data: { message: TOKEN } }) }, { ok: false, status: 400, kind: 'ConfigInvalidError' }],
    [{ status: 400, body: TOKEN }, { ok: false, status: 400, kind: '' }],
    [{ status: 401, body: TOKEN }, { ok: false, status: 401, kind: '' }],
  ]
  for (const [respuestaDelServidor, esperado] of casos) {
    await conServidor({ 'PATCH /global/config': respuestaDelServidor }, async (_c, s) => {
      const { lineas, logger } = registroQueApunta()
      const client = new OpencodeClient({ baseUrl: BASE, password: 'secreta', logger })
      const r = await client.updateMcpEntries({ n: entradaMcp() })
      eq(r, esperado)
      eq(await client.reloadGlobalConfig(), esperado, 'y lo mismo la otra puerta')
      eq(s.calls.length, 2)
      assert(!JSON.stringify(r).includes(TOKEN) && !lineas.join('\n').includes(TOKEN), 'SEGURIDAD: ni un carácter del cuerpo: ' + lineas.join(' | '))
    })
  }
  await conServidor({}, async (client) => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    eq(await client.updateMcpEntries({ n: entradaMcp() }), { ok: false, status: 0, kind: 'red' })
    eq(await client.reloadGlobalConfig(), { ok: false, status: 0, kind: 'red' })
  })
})

test('H18: reloadGlobalConfig manda {} FIJO y no admite nada más; addMcp ya no existe y connectMcp sigue', () =>
  conServidor({ 'PATCH /global/config': CONFIG_CON_TOKENS, 'POST /mcp/atlassian-x/connect': true }, async (client, s) => {
    eq(await client.reloadGlobalConfig(), { ok: true, status: 200, kind: '' })
    eq([s.calls[0].method, s.calls[0].path, s.calls[0].body], ['PATCH', '/global/config', {}])
    for (const arg of [{ mcp: { x: {} } }, {}, undefined, 'x']) {
      let err = null
      try {
        client.reloadGlobalConfig(arg)
      } catch (e) {
        err = e
      }
      assert(err instanceof TypeError, 'con un argumento, TypeError: ' + JSON.stringify(arg))
    }
    eq(s.calls.length, 1, 'y ninguna petición más')
    eq(typeof client.addMcp, 'undefined', 'POST /mcp es sólo memoria: la puerta ya no existe')
    eq(await client.connectMcp('atlassian-x'), true)
    eq([s.calls[1].method, s.calls[1].path, s.calls[1].body], ['POST', '/mcp/atlassian-x/connect', {}])
  }))

test('H18: paths() devuelve SÓLO {config, state, home}; version() la versión o una cadena vacía', () => {
  let ruta = null
  let salud = null
  return conServidor({ 'GET /path': () => ruta, 'GET /global/health': () => salud }, async (client) => {
    ruta = { home: 'C:\\Users\\marco', state: 'C:\\Users\\marco\\.local\\state\\opencode', config: 'C:\\Users\\marco\\.config\\opencode', worktree: '/', directory: 'C:\\proyecto' }
    eq(await client.paths(), { config: 'C:\\Users\\marco\\.config\\opencode', state: 'C:\\Users\\marco\\.local\\state\\opencode', home: 'C:\\Users\\marco' }, 'sin el directorio de trabajo')
    for (const raro of [{}, { config: 7, state: null, home: ['x'] }, 'texto']) {
      ruta = raro
      eq(await client.paths(), { config: '', state: '', home: '' }, 'sin forma: ' + JSON.stringify(raro))
    }
    salud = { healthy: true, version: '1.2.25' }
    eq(await client.version(), '1.2.25')
    salud = { healthy: true, version: ' 1.3.0-beta.2 ' }
    eq(await client.version(), '1.3.0-beta.2')
    for (const raro of [{ healthy: true }, { version: 7 }, { version: 'uno dos' }, { version: '1.2.25\n' + TOKEN }, { version: 'x'.repeat(41) }, null]) {
      salud = raro
      eq(await client.version(), '', 'sin forma de versión: ' + JSON.stringify(raro))
    }
  })
})
