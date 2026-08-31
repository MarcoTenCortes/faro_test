/**
 * Registro de lo que hace el backend.
 *
 * Hasta ahora, cuando algo fallaba en opencode o en el MCP, el panel enseñaba
 * una línea roja y nada más. Esto guarda cada llamada con su resultado y su
 * duración, para poder mirar qué pasó de verdad.
 *
 * Nunca se registran cuerpos de petición: por ahí pasan las claves de
 * Atlassian. Sólo método, ruta, estado y tiempo.
 */

export const LEVELS = { debug: 0, info: 1, ok: 2, warn: 3, error: 4 }

export class Logger {
  constructor({ limit = 400 } = {}) {
    this.limit = limit
    this.entries = []
    this.listeners = new Set()
    this.seq = 0
  }

  add(level, message, detail) {
    const entry = {
      id: ++this.seq,
      at: Date.now(),
      level,
      message: String(message ?? ''),
      detail: detail == null ? '' : String(detail),
    }
    this.entries.push(entry)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
    for (const fn of this.listeners) {
      try {
        fn(entry, this)
      } catch {
        /* un oyente roto no debe tumbar el registro */
      }
    }
    return entry
  }

  debug(m, d) { return this.add('debug', m, d) }
  info(m, d) { return this.add('info', m, d) }
  ok(m, d) { return this.add('ok', m, d) }
  warn(m, d) { return this.add('warn', m, d) }
  error(m, d) { return this.add('error', m, d) }

  /** Mide una operación y la registra con su duración y su resultado. */
  async track(message, fn, { detail } = {}) {
    const t0 = Date.now()
    try {
      const value = await fn()
      this.ok(message, join(detail, ms(Date.now() - t0)))
      return value
    } catch (err) {
      this.error(message, join(String(err?.message || err), ms(Date.now() - t0)))
      throw err
    }
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  clear() {
    this.entries = []
    for (const fn of this.listeners) {
      try {
        fn(null, this)
      } catch {
        /* igual que arriba */
      }
    }
  }

  /** Sólo lo que iguala o supera el nivel dado. */
  filter(minLevel = 'debug') {
    const min = LEVELS[minLevel] ?? 0
    return this.entries.filter((e) => (LEVELS[e.level] ?? 0) >= min)
  }

  /** Texto plano, para pegarlo en un correo o en un ticket. */
  toText() {
    return this.entries
      .map((e) => `${new Date(e.at).toISOString()} [${e.level.padEnd(5)}] ${e.message}${e.detail ? ' — ' + e.detail : ''}`)
      .join('\n')
  }
}

function ms(n) {
  return n < 1000 ? n + ' ms' : (n / 1000).toFixed(1).replace('.', ',') + ' s'
}

function join(...parts) {
  return parts.filter(Boolean).join(' · ')
}

/** Registro compartido por todo el panel. */
export const log = new Logger()
