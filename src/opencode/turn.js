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
    this.assistantMessageID = null
    this.model = null
    // La salida estructurada del turno, si se pidió con `format`: opencode la
    // deja en `info.structured` del mensaje del asistente al terminar.
    this.structured = undefined
    this.done = false
    this.error = null
    this.rawError = null
  }

  /** Texto visible del asistente, con las partes en orden de llegada. */
  get text() {
    return this.order
      .map((id) => this.parts.get(id))
      .filter((p) => p && p.type === 'text' && this._isAssistant(p))
      .map((p) => p.text)
      .join('')
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
        if (info.role === 'assistant') this.assistantMessageID = info.id
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
          if (p.field === 'reasoning') entry.type = 'reasoning'
          entry.text = (entry.text || '') + (p.delta || '')
          this._notify()
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
