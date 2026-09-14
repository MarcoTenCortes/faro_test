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
          { id: 'github-copilot', models: { 'claude-sonnet-4.6': { reasoning: true } } },
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
      eq(r.models[2], { providerID: 'opencode', modelID: 'hy3-free', providerName: 'OpenCode', name: 'HY3', free: true, reasoning: false })
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
