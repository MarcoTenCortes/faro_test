/**
 * Reconstruye un turno del asistente a partir del stream de eventos.
 *
 * opencode emite dos cosas distintas para el mismo texto:
 *   - `message.part.delta`  -> trozo suelto que hay que añadir
 *   - `message.part.updated` -> instantánea completa de la parte
 * Tratamos la instantánea como autoridad y el delta como añadido, así que
 * llegar en cualquier orden acaba en el mismo texto.
 *
 * Sin dependencias del navegador: se puede probar en Node.
 */

export class TurnTracker {
  /**
   * @param {string} sessionID
   * @param {{onUpdate?: Function, onDone?: Function, onError?: Function}} handlers
   */
  constructor(sessionID, handlers = {}) {
    this.sessionID = sessionID
    this.handlers = handlers
    this.reset()
  }

  reset() {
    this.parts = new Map() // partID -> {type, text, tool, status, title}
    this.order = []
    this.roles = new Map() // messageID -> role
    // Lo que costó el turno, POR MENSAJE del asistente (messageID -> {tokens,
    // cost}): un turno se parte en varios mensajes —uno por vuelta de
    // herramientas— y `message.updated` del MISMO mensaje llega muchas veces
    // mientras llega la respuesta. Guardar la última foto de cada mensaje y
    // sumar por mensaje es la única forma de no contar cuatro veces los mismos
    // tokens.
    this.usage = new Map()
    this.assistantMessageID = null
    this.model = null
    // La salida estructurada del turno, si se pidió con `format`: opencode la
    // deja en `info.structured` del mensaje del asistente al terminar.
    this.structured = undefined
    this.done = false
    this.error = null
    this.rawError = null
  }

  /**
   * Texto visible del asistente, con las partes en orden de llegada.
   *
   * Dos mensajes del asistente seguidos —una vuelta de herramientas en
   * medio— no se pegan en la misma línea: una valla ``` que cerraba el
   * primero y un «[1]» que abría el segundo quedaban en una sola línea, y ni
   * la valla ni la marca se reconocían después.
   */
  get text() {
    let out = ''
    let previo = null
    for (const p of this.order.map((id) => this.parts.get(id))) {
      if (!p || p.type !== 'text' || !this._isAssistant(p)) continue
      if (out && previo !== p.messageID && !out.endsWith('\n')) out += '\n'
      out += p.text
      previo = p.messageID
    }
    return out
  }

  /**
   * Partes del ASISTENTE, en orden de llegada.
   *
   * Filtrar por papel no es un detalle: sin esto, el texto de la pregunta del
   * usuario se colaba entre las partes y la comprobacion de credenciales creia
   * que el modelo habia respondido con el propio enunciado.
   */
  get allParts() {
    return this.order
      .map((id) => this.parts.get(id))
      .filter((p) => p && this._isAssistant(p))
  }

  /** Actividad de herramientas, para el indicador «consultando Confluence…». */
  get tools() {
    return this.order
      .map((id) => this.parts.get(id))
      .filter((p) => p && p.type === 'tool' && this._isAssistant(p))
      .map((p) => ({ tool: p.tool, status: p.status, title: p.title }))
  }

  get reasoning() {
    return this.order
      .map((id) => this.parts.get(id))
      .filter((p) => p && p.type === 'reasoning' && this._isAssistant(p))
      .map((p) => p.text)
      .join('')
  }

  /**
   * Tokens del turno entero, sumando los mensajes del asistente que lo
   * componen, o `null` si opencode no informó de ninguno.
   *
   * Forma: `{total, input, output, reasoning, cache:{read, write}}`, la misma
   * que trae opencode (el orden de claves importa: los tests comparan con
   * `eq`, que es JSON). Sirve para que «Respuesta recibida» diga lo que de
   * verdad se le mandó al modelo: en las sesiones reales de esta máquina el
   * grueso son lecturas de caché (21 035 de 21 841 en un turno), que es
   * justo el número que dice si merece la pena tocar el `system` o no.
   */
  get tokens() {
    let hay = false
    const acc = { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    for (const u of this.usage.values()) {
      if (!u.tokens) continue
      hay = true
      acc.total += u.tokens.total
      acc.input += u.tokens.input
      acc.output += u.tokens.output
      acc.reasoning += u.tokens.reasoning
      acc.cache.read += u.tokens.cache.read
      acc.cache.write += u.tokens.cache.write
    }
    return hay ? acc : null
  }

  /**
   * Coste del turno en la moneda del proveedor, sumado igual, o `null` si
   * ninguno lo informó. Un 0 es un 0 de verdad (los modelos de `github-copilot`
   * y los `-free` lo dan a cero: 4 605 mensajes de asistente en la base de esta
   * máquina, todos a 0), y por eso «sin dato» es `null` y no 0.
   *
   * La suma se redondea a la millonésima: sumando dos costes en coma flotante,
   * 0,2 + 0,3 sale 0,5000000000000001 y eso acabaría tal cual en el Registro.
   */
  get cost() {
    let hay = false
    let total = 0
    for (const u of this.usage.values()) {
      if (u.cost === null) continue
      hay = true
      total += u.cost
    }
    return hay ? Math.round(total * 1e6) / 1e6 : null
  }

  _isAssistant(part) {
    if (!part.messageID) return true
    const role = this.roles.get(part.messageID)
    return role === undefined ? true : role === 'assistant'
  }

  _touch(partID) {
    if (!this.parts.has(partID)) {
      this.parts.set(partID, { type: 'text', text: '' })
      this.order.push(partID)
    }
    return this.parts.get(partID)
  }

  _notify() {
    this.handlers.onUpdate?.(this)
  }

  /**
   * Procesa un evento del stream. Ignora lo que no sea de esta sesión.
   * @returns {boolean} true si el evento cambió algo.
   */
  handle(event) {
    const type = event?.type
    const p = event?.properties || {}

    const sid = p.sessionID || p.info?.sessionID || p.part?.sessionID
    if (sid && sid !== this.sessionID) return false

    switch (type) {
      case 'message.updated': {
        const info = p.info
        if (!info) return false
        this.roles.set(info.id, info.role)
        if (info.role === 'assistant') {
          this.assistantMessageID = info.id
          // Lo que costó: la última foto de ESTE mensaje manda (llegan varias).
          const uso = usageOf(info)
          if (uso) this.usage.set(info.id, uso)
        }
        // El modelo del turno hace falta para poder nombrar al proveedor si
        // falla su autenticación: el evento de error no lo trae.
        if (info.model) this.model = info.model
        if (info.role === 'assistant' && info.structured !== undefined) this.structured = info.structured
        return true
      }

      case 'message.part.updated': {
        const part = p.part
        if (!part?.id) return false
        const entry = this._touch(part.id)
        entry.messageID = part.messageID
        entry.type = part.type || entry.type
        if (typeof part.text === 'string') entry.text = part.text
        if (part.type === 'tool') {
          entry.tool = part.tool
          entry.status = part.state?.status
          entry.title = part.state?.title
          entry.state = part.state
        }
        this._notify()
        return true
      }

      case 'message.part.delta': {
        if (!p.partID) return false
        const entry = this._touch(p.partID)
        entry.messageID = p.messageID
        if (p.field === 'text' || p.field === 'reasoning') {
          const razonando = p.field === 'reasoning'
          if (razonando) entry.type = 'reasoning'
          entry.text = (entry.text || '') + (p.delta || '')
          // El razonamiento se guarda, pero no pide repintar: no se pinta en
          // ninguna parte (`get text()` sólo junta las partes de texto) y quien
          // escucha esto reconstruye la burbuja entera por aviso (H6 P2). El
          // evento sigue devolviendo `true` y el vigilante de `runTurn` lo cuenta
          // como señal de vida por su cuenta: un modelo que razona un minuto no
          // puede morir por «colgado».
          if (!razonando) this._notify()
          return true
        }
        return false
      }

      case 'message.part.removed': {
        if (!p.partID) return false
        this.parts.delete(p.partID)
        this.order = this.order.filter((id) => id !== p.partID)
        this._notify()
        return true
      }

      case 'session.error': {
        this.error = describeError(p.error, { providerID: this.model?.providerID })
        this.rawError = p.error
        this.done = true
        this.handlers.onError?.(this.error, this)
        return true
      }

      case 'session.idle': {
        if (this.done) return false
        this.done = true
        this.handlers.onDone?.(this)
        return true
      }

      default:
        return false
    }
  }
}

/** Un número no negativo, o 0. */
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Lo que costó un mensaje del asistente: `{tokens, cost}`, o null si no informó
 * de ninguno de los dos.
 *
 * FORMA COMPROBADA (opencode 1.2.25, base de datos de esta máquina el
 * 2026-09-19, 3 598 mensajes de asistente con tokens): `info.tokens` es
 * `{total, input, output, reasoning, cache:{read, write}}` y `info.cost` un
 * número. En 60 de esos mensajes —de una versión anterior— no viene `total`:
 * para ésos se deduce como `input + output + cache.read`, que es lo que
 * opencode informa en 4 518 de los 4 521 mensajes que SÍ lo traen (los tres
 * restantes son rarezas del proveedor; el razonamiento va dentro de `output`,
 * no aparte). Se reconstruye con claves blancas, como todo lo que llega de
 * fuera: un `tokens` con formas raras da ceros, nunca NaN en el Registro.
 */
function usageOf(info) {
  const t = info?.tokens
  let tokens = null
  if (t && typeof t === 'object') {
    const input = num(t.input)
    const output = num(t.output)
    const reasoning = num(t.reasoning)
    const cache = { read: num(t.cache?.read), write: num(t.cache?.write) }
    const total = num(t.total) || input + output + cache.read
    tokens = { total, input, output, reasoning, cache }
  }
  const cost = typeof info?.cost === 'number' && Number.isFinite(info.cost) ? info.cost : null
  return tokens || cost !== null ? { tokens, cost } : null
}

/**
 * Cuánto texto de herramientas arrastra un turno, en caracteres.
 *
 * Las salidas de herramientas se quedan en el historial de la sesión y se
 * reenvían en los turnos siguientes (§7), acotadas por la poda de opencode:
 * este número es lo que hace visible ese arrastre en «Respuesta recibida · N
 * herramientas (310 KB)». Cuenta lo que de verdad ocupa: el `state.output` de
 * texto de las partes `tool` completadas Y el `state.error` de las FALLIDAS, que
 * también se queda en el historial (un `jira_search` con un JQL malo devuelve
 * kilobytes de traza). Lo cuentan las dos porque la línea del registro pega
 * estos KB a un recuento de herramientas que incluye las fallidas: si no, el
 * número hablaba de menos herramientas de las que decía. Pura.
 *
 * @param {Array<{type?:string, state?:object}>} parts
 * @returns {number}
 */
export function toolOutputSize(parts) {
  let total = 0
  for (const p of Array.isArray(parts) ? parts : []) {
    if (!p || p.type !== 'tool') continue
    if (p.state?.status === 'completed' && typeof p.state.output === 'string') total += p.state.output.length
    else if (p.state?.status === 'error' && typeof p.state.error === 'string') total += p.state.error.length
  }
  return total
}

/**
 * Los mensajes de una sesión en orden de creación, ascendente y estable.
 *
 * `GET /session/:id/message?limit=N` devuelve los ÚLTIMOS N, pero su ORDEN no
 * se pudo confirmar en las cadenas del binario de opencode 1.2.25 (un juez de
 * la auditoría encontró un `reverse()` y el otro no), así que el panel ordena y
 * el orden real deja de importar. Un mensaje sin `info.time.created` conserva
 * su sitio: hereda la clave del anterior en vez de irse al principio, porque
 * sin dato lo menos destructivo es no moverlo. Pura.
 *
 * @param {Array<{info?:{time?:{created?:number}}}>} messages
 * @returns {Array<object>}
 */
export function sortMessages(messages) {
  const lista = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m === 'object')
  let ultima = 0
  const conClave = lista.map((m, i) => {
    const t = Number(m.info?.time?.created)
    if (Number.isFinite(t)) ultima = t
    return { m, i, clave: Number.isFinite(t) ? t : ultima }
  })
  conClave.sort((a, b) => a.clave - b.clave || a.i - b.i)
  return conClave.map((x) => x.m)
}

/**
 * Quita los mensajes del asistente que quedan colgando al principio.
 *
 * Al pedir sólo los últimos N mensajes, el corte puede caer a mitad de un turno
 * y dejar arriba respuestas sin su pregunta: `restoreConversation` agrupa por
 * turno (un usuario + sus asistentes), así que un asistente huérfano pintaría
 * una burbuja sin pregunta. Sin ningún mensaje de usuario no hay nada que
 * agrupar y devuelve []. Pura.
 *
 * @param {Array<{info?:{role?:string}}>} messages
 * @returns {Array<object>}
 */
export function dropOrphans(messages) {
  const lista = Array.isArray(messages) ? messages : []
  const desde = lista.findIndex((m) => m?.info?.role === 'user')
  return desde < 0 ? [] : lista.slice(desde)
}

/**
 * La salida estructurada que hay entre las partes de un turno, si la hay.
 *
 * opencode la entrega como una llamada a la herramienta `StructuredOutput` ya
 * validada contra el esquema (`metadata.valid`). Sirve tanto para un turno en
 * vivo como para los mensajes guardados de una sesión, que traen las mismas
 * partes. Una llamada pendiente, fallida o a otra herramienta no cuenta. Pura.
 *
 * @param {Array<{type?:string, tool?:string, state?:object}>} parts
 * @returns {object|undefined}
 */
export function structuredOutputOf(parts) {
  for (const p of Array.isArray(parts) ? parts : []) {
    if (!p || p.type !== 'tool' || p.tool !== 'StructuredOutput') continue
    if (p.state?.status !== 'completed' || p.state?.metadata?.valid !== true) continue
    if (p.state.input && typeof p.state.input === 'object') return p.state.input
  }
  return undefined
}

/**
 * Los fallos de autenticación del proveedor llegan como `UnknownError` con el
 * motivo enterrado en el mensaje: `{name:"UnknownError", data:{message:"Error:
 * Token refresh failed: 401"}}`. Sin esto, el panel enseñaba «UnknownError:
 * Error: Token refresh failed: 401», que no le dice a nadie qué hacer.
 */
const AUTH_HINTS = [
  'token refresh failed',
  'unauthorized',
  'invalid_api_key',
  'invalid api key',
  'authentication',
  'expired',
  '401',
  '403',
]

export function isProviderAuthError(error) {
  if (!error) return false
  const name = error.name || error.type || ''
  if (name === 'ProviderAuthError') return true
  const msg = String(error.data?.message || error.message || '').toLowerCase()
  return AUTH_HINTS.some((h) => msg.includes(h))
}

/**
 * @param {object} error
 * @param {{providerID?: string}} [context] el proveedor del turno, para poder
 *        nombrarlo: el error no lo trae.
 */
export function describeError(error, context = {}) {
  if (!error) return 'Error desconocido en opencode.'
  const name = error.name || error.type || 'UnknownError'
  const msg = error.data?.message || error.message || ''

  if (isProviderAuthError(error)) {
    const who = context.providerID ? `«${context.providerID}»` : 'del modelo'
    return (
      `Ha caducado tu sesión con el proveedor ${who}: opencode no ha podido renovar el acceso. ` +
      'Elige otro modelo aquí abajo, o vuelve a autenticarte con `opencode auth login`.'
    )
  }

  if (isModelUnavailableError(error)) {
    const who = context.providerID ? `«${context.providerID}»` : 'el proveedor'
    const detalle = shortUpstream(msg)
    return (
      `El modelo no aceptó la petición: ${who} devolvió un error${detalle ? ` (${detalle})` : ''}. ` +
      'No todos los modelos de la lista son igual de fiables; prueba con otro.'
    )
  }

  const map = {
    MessageAbortedError: 'Turno cancelado.',
    MessageOutputLengthError: 'La respuesta se cortó por longitud máxima.',
    ContextOverflowError: 'La conversación ya no cabe en el contexto del modelo. Empieza una sesión nueva.',
    StructuredOutputError: 'El modelo no consiguió producir una respuesta con el formato pedido.',
  }
  return map[name] || (msg ? `${name}: ${msg}` : name)
}

/**
 * Error del modelo o de su pasarela, no de Faro ni de tus credenciales.
 *
 * Los proveedores gratuitos de la lista fallan a menudo así: «Bad Request»,
 * `invalid_request_error`, un 502 de la nube de turno. Sin distinguirlo, el
 * panel enseñaba «APIError: Bad Request: Bad Request», que no ayuda a nadie.
 */
export function isModelUnavailableError(error) {
  if (!error) return false
  const name = error.name || error.type || ''
  const msg = String(error.data?.message || error.message || '').toLowerCase()
  if (name === 'APIError') return true
  if (name === 'StructuredOutputError') return false
  return /bad request|invalid_request|upstream|502|503|504|rate.?limit|overloaded|service temporarily/.test(msg)
}

/** ¿Merece la pena ofrecer «prueba con otro modelo»? */
export function suggestsAnotherModel(error) {
  return isProviderAuthError(error) || isModelUnavailableError(error)
}

/** Se queda con la parte informativa del mensaje del proveedor. */
function shortUpstream(msg) {
  const m = String(msg || '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!m || /^bad request(: bad request)?$/i.test(m)) return ''
  return m.length > 120 ? m.slice(0, 117) + '…' : m
}
