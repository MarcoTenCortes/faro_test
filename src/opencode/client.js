/**
 * Cliente HTTP + SSE del servidor headless de opencode.
 *
 * Sólo usa `fetch`, así que este fichero corre igual en el panel lateral,
 * en el service worker y en Node (por eso las pruebas de integración pueden
 * ejercitar exactamente el mismo código que la extensión).
 *
 * Autenticación: `Authorization: Basic base64("opencode:" + password)`.
 * Comprobado contra opencode 1.2.25; sin cabecera responde 401 y el preflight
 * CORS devuelve `Access-Control-Allow-Headers: content-type,authorization`.
 *
 * El stream de eventos NO puede ir por `EventSource`, porque EventSource no
 * admite cabeceras y por tanto no puede autenticarse. Va por `fetch` con
 * lectura incremental del cuerpo.
 */

import { TurnTracker, structuredOutputOf } from './turn.js'
import { SAFE_PERMISSIONS } from '../shared/config.js'

export class OpencodeError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message)
    this.name = 'OpencodeError'
    this.status = status
    this.body = body
  }
}

function b64(str) {
  if (typeof btoa === 'function') {
    // btoa trabaja sobre latin1: hay que codificar UTF-8 a mano.
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
  }
  return Buffer.from(str, 'utf8').toString('base64')
}

/**
 * A qué parte del plazo de «colgado» se avisa de que no llegan señales.
 *
 * La mitad: con los 90 s del chat son 45 s callado, que es cuando el usuario ya
 * se está preguntando si esto sigue vivo. Avisar antes sería ruido (un modelo
 * que lee tres páginas con el MCP tarda eso en escribir la primera palabra) y
 * avisar después no daría tiempo a nada: a los 90 s el turno ya está muerto.
 * El aviso no cambia el plazo ni aborta nada; sólo se dice.
 */
const STALL_WARN_AT = 0.5

export class OpencodeClient {
  /**
   * @param {{baseUrl?: string, password?: string, directory?: string}} opts
   */
  constructor({ baseUrl = 'http://127.0.0.1:4096', password = '', directory = '', logger = null } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.password = password
    this.directory = directory
    // Opcional a proposito: en Node las pruebas no quieren ruido.
    this.logger = logger
    this._listeners = new Map()
    this._streamAbort = null
    this._connected = false
    this._reconnectDelay = 1000
    // `disconnect()` es definitivo: un cliente cerrado no vuelve a abrir el stream.
    this._closed = false
    // Sesiones con un turno abandonado por la señal y sin abortar en el servidor (ver deleteSession).
    this._abandoned = new Set()
  }

  setDirectory(dir) {
    this.directory = dir || ''
  }

  headers(extra) {
    const h = { ...(extra || {}) }
    if (this.password) h['Authorization'] = 'Basic ' + b64('opencode:' + this.password)
    return h
  }

  url(path, params) {
    const u = new URL(this.baseUrl + path)
    if (this.directory) u.searchParams.set('directory', this.directory)
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    }
    return u.toString()
  }

  async request(method, path, { body, params, signal, raw } = {}) {
    const t0 = Date.now()
    const label = `${method} ${path}`
    let res
    try {
      res = await fetch(this.url(path, params), {
        method,
        signal,
        headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      if (err && err.name === 'AbortError') {
        this.logger?.info(label, 'cancelada')
        throw err
      }
      this.logger?.error(label, 'sin conexion con ' + this.baseUrl)
      throw new OpencodeError(
        'No se puede contactar con opencode en ' + this.baseUrl + '. ¿Está arrancado el servidor?',
        { status: 0 }
      )
    }
    if (res.status === 401) {
      this.logger?.error(label, '401 · contrasena del servidor rechazada')
      throw new OpencodeError('opencode rechazó la contraseña del servidor (401).', { status: 401 })
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.logger?.error(label, res.status + ' ' + String(text).slice(0, 160))
      throw new OpencodeError(`${method} ${path} devolvió ${res.status}`, { status: res.status, body: text })
    }
    this.logger?.debug(label, res.status + ' · ' + (Date.now() - t0) + ' ms')
    if (raw) return res
    if (res.status === 204) return null
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  // ---------------------------------------------------------------- básicos

  health() {
    return this.request('GET', '/global/health')
  }

  paths() {
    return this.request('GET', '/path')
  }

  /**
   * La configuración entera de opencode, tal como la tiene cargada.
   *
   * Ojo: trae el `environment` de cada servidor MCP, con las claves en claro.
   * Se lee para saber qué MCP lleva qué dominio (`mcpForHost`) y nada más: ni
   * se guarda, ni se registra, ni sale del panel.
   */
  config() {
    return this.request('GET', '/config')
  }

  providers() {
    return this.request('GET', '/config/providers')
  }

  /** Lista plana de modelos, lista para pintar en un desplegable. */
  async models() {
    const data = await this.providers()
    const out = []
    for (const p of data?.providers || []) {
      const ids = Object.keys(p.models || {})
      for (const id of ids) {
        const m = p.models[id] || {}
        out.push({
          providerID: p.id,
          modelID: id,
          providerName: p.name || p.id,
          name: m.name || id,
          free: /(^|[-_])free$/.test(id),
          reasoning: !!m.reasoning,
        })
      }
    }
    out.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name))
    return { models: out, defaults: data?.default || {} }
  }

  // --------------------------------------------------------------- sesiones

  /**
   * Crea una sesión. Por defecto va con los permisos recortados: Faro sólo
   * necesita las herramientas MCP de Atlassian, nunca shell ni ficheros.
   */
  createSession({ title, permission = SAFE_PERMISSIONS } = {}) {
    return this.request('POST', '/session', { body: { title, permission } })
  }

  /**
   * Borra una sesión. Si su último turno se abandonó por la señal (`runTurn`
   * devolvió `aborted` sin abortar en el servidor), primero lo aborta.
   *
   * Comprobado en el binario de opencode 1.2.25: `DELETE /session/:id` →
   * `Session.remove` sólo borra filas y publica `session.deleted`; no llama a
   * `SessionPrompt.cancel`. El indexador, el planificador y las pasadas de
   * notas cancelan por señal y cierran con `deleteSession`: sin este abort el
   * modelo seguiría gastando en una sesión que ya no existe. Una sesión sin
   * turno abandonado se borra con una sola petición.
   */
  async deleteSession(id) {
    if (this._abandoned.delete(id)) await this.abort(id).catch(() => {})
    return this.request('DELETE', `/session/${id}`)
  }

  listMessages(id, limit) {
    return this.request('GET', `/session/${id}/message`, { params: { limit } })
  }

  abort(id) {
    return this.request('POST', `/session/${id}/abort`, { body: {} })
  }

  /**
   * Pide a opencode que resuma (compacte) la sesión. El cuerpo es
   * `{providerID, modelID}`: así lo exige el esquema de
   * `POST /session/:id/summarize` en `/doc` de opencode 1.2.25 (`required:
   * ["providerID","modelID"]`, más un `auto` opcional); el `{model}` de antes
   * daba 400 seguro (R4, auditoría del 2026-09-13). Sin uso en el panel hoy.
   * @param {{providerID: string, modelID: string}} model el modelo, tal como lo guarda el panel
   */
  async summarize(id, model = {}) {
    const providerID = model?.providerID
    const modelID = model?.modelID
    if (typeof providerID !== 'string' || !providerID || typeof modelID !== 'string' || !modelID) {
      throw new OpencodeError('summarize necesita providerID y modelID: el esquema de opencode los exige.')
    }
    return this.request('POST', `/session/${id}/summarize`, { body: { providerID, modelID } })
  }

  /**
   * Lanza un turno sin bloquear: la respuesta llega por el stream de eventos.
   * @param {string} id
   * @param {{text: string, model?: object, agent?: string, system?: string,
   *          format?: object, files?: Array}} opts
   */
  promptAsync(id, { text, model, agent, system, format, files } = {}) {
    return this.request('POST', `/session/${id}/prompt_async`, {
      body: {
        model,
        agent,
        system,
        format,
        parts: messageParts(text, files),
      },
    })
  }

  /**
   * Turno bloqueante. Devuelve el mensaje completo del asistente.
   * Se usa para las peticiones internas (plan de navegación, resúmenes), donde
   * no hay que pintar nada mientras se genera.
   */
  prompt(id, { text, model, agent, system, format, files } = {}, signal) {
    return this.request('POST', `/session/${id}/message`, {
      signal,
      body: { model, agent, system, format, parts: messageParts(text, files) },
    })
  }

  /**
   * Ejecuta un turno completo y devuelve TODO lo que produjo.
   *
   * Dos motivos para no usar el `POST /message` bloqueante:
   *
   *  1. opencode parte un turno en VARIOS mensajes de asistente: uno con la
   *     llamada a la herramienta y otro con el texto final. La respuesta del
   *     POST sólo trae el último, así que las partes de herramienta se pierden
   *     — y con ellas la salida estructurada y el enriquecimiento del índice.
   *  2. Hay modelos que no terminan nunca ni devuelven error. Sin un vigilante,
   *     el panel se queda girando para siempre.
   *
   * @returns {{ok:boolean, parts:Array, text:string, tools:Array, error?:string,
   *            stalled?:boolean, aborted?:boolean, model?:object}}
   */
  async runTurn(id, prompt, control = {}) {
    const { stallMs = 90000, maxMs = 15 * 60 * 1000, onUpdate, onWarn, signal } = control

    // Un turno nuevo en esta sesión: lo que se abandonó antes ya no es asunto
    // de nadie (abortarlo ahora se llevaría a ESTE turno).
    this._abandoned.delete(id)

    // Esperar a que el stream este abierto ANTES de mandar nada. Si no, los
    // primeros eventos del turno se pierden y el mensaje del usuario acaba
    // contandose como si fuera del asistente.
    //
    // Y el valor de `ready()` IMPORTA: un cliente cerrado (`disconnect()`, ver
    // C3) no vuelve a abrir el stream nunca, así que mandar el turno sería
    // lanzar al modelo a trabajar de verdad en el servidor sin que llegara ni
    // un evento de vuelta: el turno moría al agotar `stallMs` —120 s en el
    // indexador— y el usuario esperaba dos minutos a un fallo seguro
    // (revisión adversaria de H2, 2026-09-14). No se aborta en el servidor
    // porque no se ha mandado nada: no hay turno que abortar.
    const listo = await this.ready()
    if (!listo && this._closed) return { ok: false, aborted: true, closed: true, parts: [], text: '', tools: [] }

    let touch = Date.now()
    let tracker
    const finished = new Promise((resolve) => {
      tracker = new TurnTracker(id, {
        onUpdate: (t) => {
          touch = Date.now()
          onUpdate?.(t)
        },
        onDone: () => resolve({ ok: true }),
        onError: (error) => resolve({ ok: false, error }),
      })
    })

    // Sólo cuenta como señal de vida lo que produce contenido. Un
    // `session.status: busy` repetido cada pocos segundos mantendría vivo para
    // siempre a un modelo que en realidad no está escribiendo nada.
    const ALIVE = new Set(['message.updated', 'message.part.updated', 'message.part.delta'])
    const off = this.on('*', (event) => {
      const p = event?.properties || {}
      const sid = p.sessionID || p.info?.sessionID || p.part?.sessionID
      if (sid === id && ALIVE.has(event.type)) touch = Date.now()

      // Un turno no puede quedarse esperando a alguien que no está mirando.
      // opencode pregunta («question.asked») o pide permiso, y sin respuesta
      // el turno se queda colgado para siempre: comprobado.
      if (sid === id && event.type === 'question.asked' && p.id) {
        touch = Date.now()
        this.rejectQuestion(p.id).catch(() => {})
      }
      if (sid === id && event.type === 'permission.asked' && p.id) {
        touch = Date.now()
        this.replyPermission(p.id, 'reject').catch(() => {})
      }

      tracker.handle(event)
    })

    const started = Date.now()
    let watchdog
    let onAbort
    // El aviso de «lleva callado» es uno por turno: el vigilante da una vuelta
    // por segundo y, sin este testigo, lo repetiría cuarenta y cinco veces.
    let avisado = false
    const guard = new Promise((resolve) => {
      // La señal se ESCUCHA, no se sondea. Reproducido en la auditoría del
      // 2026-09-13 (docs/PLAN.md §2, C6): con el sondeo de 1 s, Parar y mandar
      // otra pregunta en menos de un segundo hacía que el vigilante del turno
      // viejo despertara con la señal ya cancelada y abortara la sesión…
      // llevándose el turno nuevo, que ya corría en ella.
      onAbort = () => resolve({ ok: false, aborted: true })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      watchdog = setInterval(() => {
        const callado = Date.now() - touch
        if (callado > stallMs) return resolve({ ok: false, stalled: true })
        if (Date.now() - started > maxMs) return resolve({ ok: false, stalled: true, expired: true })
        // A mitad del plazo, y una sola vez por turno: quien escucha lo dice en
        // el estado visible («pensando… 45 s sin señales del modelo»). Un aviso
        // que reviente no puede llevarse el turno: esto corre en un temporizador.
        if (!avisado && callado > stallMs * STALL_WARN_AT) {
          avisado = true
          try {
            onWarn?.(callado)
          } catch (err) {
            console.error('[faro] fallo avisando de un turno callado', err)
          }
        }
      }, 1000)
    })

    try {
      // Una señal ya cancelada no manda nada: el turno correría sin nadie que lo parara.
      const enviado = !signal?.aborted
      if (enviado) await this.promptAsync(id, prompt)
      const outcome = await Promise.race([finished, guard])

      if (outcome.stalled) {
        // Que el servidor deje de gastar en un turno que ya hemos abandonado.
        await this.abort(id).catch(() => {})
      } else if (outcome.aborted && enviado) {
        // Quien abortó la señal ya abortó la sesión (el botón Parar del panel
        // llama a `abort` él mismo) o va a borrarla (las desechables): abortar
        // aquí otra vez era lo que se llevaba el turno siguiente. Se apunta
        // para que `deleteSession` cierre lo que quede.
        this._abandoned.add(id)
      }

      return {
        ...outcome,
        parts: tracker.allParts,
        text: tracker.text,
        tools: tracker.tools,
        model: tracker.model,
        rawError: tracker.rawError,
        // Lo que costó el turno, sumado por mensaje del asistente (H3, medir):
        // `null` los dos cuando opencode no informó de nada, para que el panel
        // no pinte un cero inventado.
        tokens: tracker.tokens,
        cost: tracker.cost,
        // Si el turno pidió `format`, el objeto ya validado por el servidor.
        structured: tracker.structured ?? structuredOutputOf(tracker.allParts),
      }
    } finally {
      clearInterval(watchdog)
      signal?.removeEventListener('abort', onAbort)
      off()
    }
  }

  /**
   * Pide una respuesta que cumpla un JSON Schema y devuelve el objeto ya
   * validado por el servidor. opencode fuerza una herramienta StructuredOutput
   * y marca `metadata.valid`; si no viene válida, esto lanza.
   *
   * Comprobado en el binario de opencode 1.2.25: `retryCount` se acepta pero
   * no se lee nunca. Un turno que termina en prosa sin llamar a la herramienta
   * muere con StructuredOutputError a la primera; el reintento, si hace
   * falta, tiene que hacerlo quien llama.
   */
  async promptStructured(id, { text, model, schema, system, agent, retryCount = 2 }, control) {
    const opts = typeof control === 'object' && control && 'aborted' in control ? { signal: control } : control || {}
    const turn = await this.runTurn(
      id,
      { text, model, agent, system, format: { type: 'json_schema', schema, retryCount } },
      opts
    )

    if (turn.stalled) {
      throw new OpencodeError(
        'El modelo se quedó colgado sin responder. Prueba con otro: no todos son igual de fiables.'
      )
    }
    if (turn.aborted) throw new OpencodeError('Cancelado.')
    if (!turn.ok && turn.error) throw new OpencodeError(turn.error)

    const tool = turn.parts.find((p) => p.type === 'tool' && p.tool === 'StructuredOutput')
    if (!tool) {
      throw new OpencodeError(
        'El modelo no devolvió salida estructurada' + (turn.text ? ': ' + turn.text.slice(0, 200) : '.')
      )
    }
    if (tool.state?.status !== 'completed' || tool.state?.metadata?.valid !== true) {
      throw new OpencodeError('La salida estructurada no pasó la validación del esquema.')
    }
    return tool.state.input
  }

  // ------------------------------------------------------------------- MCP

  listMcp() {
    return this.request('GET', '/mcp')
  }

  addMcp(name, config) {
    return this.request('POST', '/mcp', { body: { name, config } })
  }

  connectMcp(name) {
    return this.request('POST', `/mcp/${encodeURIComponent(name)}/connect`, { body: {} })
  }

  // ------------------------------------------------------------- permisos

  /** Rechaza una pregunta del agente: nadie va a contestarla. */
  rejectQuestion(requestID) {
    return this.request('POST', `/question/${encodeURIComponent(requestID)}/reject`, { body: {} })
  }

  replyPermission(requestID, response) {
    return this.request('POST', `/permission/${encodeURIComponent(requestID)}/reply`, {
      body: { response },
    })
  }

  // -------------------------------------------------------------- eventos

  /** @param {string} type nombre de evento, o '*' para todos. */
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set())
    this._listeners.get(type).add(handler)
    return () => this.off(type, handler)
  }

  off(type, handler) {
    this._listeners.get(type)?.delete(handler)
  }

  _emit(event) {
    for (const h of this._listeners.get(event.type) || []) {
      try {
        h(event.properties ?? {}, event)
      } catch (err) {
        console.error('[faro] fallo en un manejador de', event.type, err)
      }
    }
    for (const h of this._listeners.get('*') || []) {
      try {
        h(event)
      } catch (err) {
        console.error('[faro] fallo en el manejador comodín', err)
      }
    }
  }

  get connected() {
    return this._connected
  }

  /** Resuelve cuando el stream de eventos esta abierto (o al agotarse el plazo). Un cliente cerrado nunca está listo. */
  ready(timeoutMs = 8000) {
    if (this._closed) return Promise.resolve(false)
    this.connect()
    if (this._connected) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer)
        off()
        resolve(value)
      }
      const off = this.on('faro.stream.open', () => done(true))
      const timer = setTimeout(() => done(false), timeoutMs)
    })
  }

  /**
   * Abre el stream de eventos y lo mantiene abierto, reconectando con espera
   * creciente. Idempotente, y nada sobre un cliente cerrado.
   */
  connect() {
    if (this._closed || this._streamAbort) return
    const ctrl = new AbortController()
    this._streamAbort = ctrl
    this._pump(ctrl)
  }

  /**
   * Cierra el stream para siempre. Definitivo a propósito: reproducido en la
   * auditoría del 2026-09-13 (docs/PLAN.md §2, C3), dos arranques del panel
   * solapados; el segundo desconectaba el cliente del primero y el primero,
   * al despertar de `health()`, hacía `connect()` sobre él: como
   * `_streamAbort` ya era null, abría un segundo stream que nadie cerraba
   * jamás y que reconectaba cada 1-15 s. Quien quiera volver a conectar crea
   * un cliente nuevo (`buildClient()` del panel ya lo hace).
   */
  disconnect() {
    this._closed = true
    this._streamAbort?.abort()
    this._streamAbort = null
    this._connected = false
  }

  async _pump(ctrl) {
    while (!ctrl.signal.aborted) {
      try {
        const res = await fetch(this.url('/event'), {
          headers: this.headers({ Accept: 'text/event-stream' }),
          signal: ctrl.signal,
        })
        if (res.status === 401) throw new OpencodeError('401 en el stream de eventos', { status: 401 })
        if (!res.ok || !res.body) throw new OpencodeError('el stream de eventos devolvió ' + res.status)

        this._connected = true
        this._reconnectDelay = 1000
        this._emit({ type: 'faro.stream.open', properties: {} })

        await readEventStream(res.body, (event) => this._emit(event), ctrl.signal)
      } catch (err) {
        if (ctrl.signal.aborted) return
        this._emit({ type: 'faro.stream.error', properties: { error: String(err?.message || err) } })
      }

      if (ctrl.signal.aborted) return
      this._connected = false
      this._emit({ type: 'faro.stream.closed', properties: {} })
      await sleep(this._reconnectDelay, ctrl.signal)
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15000)
    }
  }
}

/**
 * Las partes de un mensaje: el texto, y detrás los ficheros adjuntos.
 *
 * Existe porque el usuario puede señalar una imagen de la página y preguntar
 * por ella. Mandar sólo el `alt` sería mandar casi nada: un diagrama de
 * arquitectura no se describe con tres palabras. La imagen viaja incrustada
 * como data URL, que es lo que opencode acepta sin tocar disco.
 *
 * Pura, para poder comprobarla sin servidor.
 */
export function messageParts(text, files) {
  const parts = [{ type: 'text', text }]
  for (const f of files || []) {
    if (!f?.url || typeof f.url !== 'string') continue
    parts.push({
      type: 'file',
      mime: f.mime || 'image/png',
      filename: f.filename || 'adjunto',
      url: f.url,
    })
  }
  return parts
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}

/**
 * Lee un cuerpo `text/event-stream` y entrega cada evento ya parseado.
 * Exportado aparte para poder probarlo con un stream de mentira.
 */
export async function readEventStream(body, onEvent, signal) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawBlock = buffer.slice(0, idx)
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
        const event = parseEventBlock(rawBlock)
        if (event) onEvent(event)
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* el reader ya estaba liberado */
    }
  }
}

export function parseEventBlock(block) {
  const dataLines = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (!dataLines.length) return null
  try {
    const parsed = JSON.parse(dataLines.join('\n'))
    return parsed && typeof parsed === 'object' && parsed.type ? parsed : null
  } catch {
    return null
  }
}
