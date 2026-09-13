/**
 * El último turno REAL de una sesión de Faro, leído de una COPIA de la base
 * de datos de opencode.
 *
 * Por qué existe: cuando el panel dice algo raro («Sin marcas», una tarjeta
 * que no sale, un análisis por apartados), lo que hace falta ver es qué
 * contestó el modelo de verdad y con qué sistema se le preguntó, no lo que el
 * panel pintó después de recortar. opencode lo guarda todo en
 * `~/.local/share/opencode/opencode.db` (SQLite en WAL): cada mensaje con su
 * `system`, cada parte con su texto, cada llamada a herramienta con su entrada
 * y su salida (CLAUDE.md §7). Así se destapó (2026-09-09) que gpt-5.6-luna
 * numeraba como lista «1.» con el JSON de anclas perfecto, y que el panel lo
 * tiraba todo (§4.4). Hasta ahora eso se hacía con un script de usar y tirar
 * cada vez; esto lo deja como comando.
 *
 * La original NUNCA se abre ni se toca: se copia el .db (con -wal y -shm, para
 * no leer atrasado) a un directorio temporal, se abre LA COPIA en sólo lectura
 * con node:sqlite y el directorio se borra al acabar, también si algo falla.
 *
 *   node tools/last-turn.mjs                 el último turno de la última sesión de chat
 *   node tools/last-turn.mjs --n 3           los tres últimos turnos
 *   node tools/last-turn.mjs --host jira     la última sesión cuyo host contiene «jira»
 *   node tools/last-turn.mjs --all           también las sesiones desechables (planificador, observaciones…)
 *   node tools/last-turn.mjs --db ruta.db    otra base de datos (una copia guardada, por ejemplo)
 *
 * Necesita Node ≥22.13 (node:sqlite sin bandera); el resto del repo sigue en
 * Node ≥18. Por eso node:sqlite se importa DENTRO de main() y no arriba: las
 * funciones puras (agrupar filas en turnos, resumir partes, formatear) se
 * importan y se prueban en test/unit/last-turn.test.js con filas falsas, en
 * cualquier Node, sin abrir nada. Y se importa dentro de un try: si carga,
 * vale (también en 22.5-22.12 con la bandera, venga por donde venga: puesta
 * en NODE_OPTIONS no aparece entre los argumentos con los que arrancó node,
 * y mirar ahí negaba un import que iba a funcionar); si no, se explica qué
 * Node hace falta.
 *
 * Lo que la revisión de H1 corrigió (2026-09-14): una compactación automática
 * de opencode (un mensaje `user` sin texto, con una sola parte
 * `{type:'compaction', auto, overflow}`, seguido de un asistente con
 * `summary: true` y `agent: 'compaction'` cuyo texto es el resumen; comprobado
 * en una copia de la base de esta máquina, 19 casos) salía como un turno más,
 * «PREGUNTA (sin texto)», y con --n 1 tapaba el último turno real: ahora se
 * anota en el turno anterior. «[texto] N caracteres» contaba la línea
 * «— bloque de anclas —» que este script inserta: ahora cuenta el original.
 * Y --db con un directorio o un fichero que no es SQLite acababa en traza.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { stripSelectionBlock, pageUrlFromSystem, SELECTION_OPEN } from '../src/panel/prompts.js'
import { splitAnchorsBlock } from '../src/panel/notes.js'

export const TURN_LIMITS = {
  outputChars: 400, // de la salida de cada herramienta
  inputChars: 300, // de cada campo de entrada que se enseña
  systemLines: 6, // primeras y últimas líneas del sistema
  sessionsShown: 8, // sesiones candidatas que se listan
  defaultTurns: 1,
  maxTurns: 50,
}

/** Campos de la entrada de una herramienta que merece la pena ver enteros. */
export const INPUT_KEYS = ['jql', 'page_id', 'issue_key', 'query', 'title', 'space_key']

export const DB_NAME = 'opencode.db'
/** SQLite en WAL: sin el -wal la copia se lee atrasada; el -shm lo acompaña. */
export const DB_SUFFIXES = ['', '-wal', '-shm']

export const HELP = [
  'Uso: node tools/last-turn.mjs [--host h] [--n 1] [--all] [--db ruta]',
  '',
  '  --host h   la última sesión cuyo host contiene «h» (por el título o por la',
  '             línea «URL abierta: …» del sistema del último mensaje)',
  '  --n N      cuántos turnos enseñar, de atrás hacia delante (1 por defecto)',
  '  --all      también las sesiones desechables («Faro · planificador»,',
  '             «Faro · observaciones», «Faro · índice de …», «Faro · comprobación»)',
  '  --db ruta  otra base de datos en vez de ~/.local/share/opencode/opencode.db',
  '',
  'Copia la base de datos a un directorio temporal, abre la copia en sólo',
  'lectura y la borra al acabar. La original no se toca.',
].join('\n')

// ------------------------------------------------------------------ argumentos

/** Pura. Devuelve `{host, n, all, db, help, errors}`; con errores no se arranca. */
export function parseArgs(argv) {
  const out = { host: '', n: TURN_LIMITS.defaultTurns, all: false, db: '', help: false, errors: [] }
  const args = Array.isArray(argv) ? [...argv] : []
  while (args.length) {
    const arg = String(args.shift())
    const igual = arg.indexOf('=')
    const flag = igual > 0 ? arg.slice(0, igual) : arg
    const pegado = igual > 0 ? arg.slice(igual + 1) : undefined
    const valor = () => (pegado !== undefined ? pegado : args.shift())
    switch (flag) {
      case '--host': {
        out.host = String(valor() ?? '')
          .trim()
          .toLowerCase()
        if (!out.host) out.errors.push('--host necesita un host (por ejemplo --host jira)')
        break
      }
      case '--n': {
        const v = valor()
        const n = Number(v)
        if (!/^\d+$/.test(String(v ?? '')) || n < 1) out.errors.push(`--n necesita un entero ≥ 1 (llegó «${v ?? ''}»)`)
        else out.n = Math.min(n, TURN_LIMITS.maxTurns)
        break
      }
      case '--all':
        out.all = true
        break
      case '--db': {
        out.db = String(valor() ?? '').trim()
        if (!out.db) out.errors.push('--db necesita una ruta')
        break
      }
      case '--help':
      case '-h':
        out.help = true
        break
      default:
        out.errors.push(`Opción desconocida: ${arg}`)
    }
  }
  return out
}

/**
 * Qué Node hace falta. node:sqlite llegó en 22.5 tras `--experimental-sqlite`
 * y sin bandera desde 22.13 (y 23.4). Pura.
 * @returns {'ok'|'flag'|'no'}
 */
export function sqliteSupport(version) {
  const m = String(version || '').match(/^v?(\d+)\.(\d+)/)
  if (!m) return 'no'
  const major = Number(m[1])
  const minor = Number(m[2])
  if (major >= 24) return 'ok'
  if (major === 23) return minor >= 4 ? 'ok' : 'flag'
  if (major === 22) return minor >= 13 ? 'ok' : minor >= 5 ? 'flag' : 'no'
  return 'no'
}

/** Dónde puede vivir la base de datos, por orden de preferencia. Pura. */
export function dbCandidates(env = {}, home = '') {
  const out = []
  if (env.XDG_DATA_HOME) out.push(join(env.XDG_DATA_HOME, 'opencode', DB_NAME))
  if (home) out.push(join(home, '.local', 'share', 'opencode', DB_NAME))
  if (env.LOCALAPPDATA) out.push(join(env.LOCALAPPDATA, 'opencode', DB_NAME))
  if (env.APPDATA) out.push(join(env.APPDATA, 'opencode', DB_NAME))
  return out
}

/**
 * El mensaje para cuando lo que hay en `--db` no es una base de datos de
 * opencode: un fichero que no es SQLite («file is not a database», que es
 * como node:sqlite cuenta SQLITE_NOTADB) o una base de otra aplicación («no
 * such table: session»). Con cualquier otro error devuelve '' y el que llama
 * deja salir la traza (permisos, disco, un bug: eso sí hay que verlo). Pura.
 */
export function dbErrorText(err, ruta = '') {
  const mensaje = String((err && typeof err === 'object' ? err.message : err) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/file is not a database|no such table: (?:session|message|part)\b/i.test(mensaje)) return ''
  return `«${ruta}» no es una base de datos de opencode (${mensaje}).`
}

// ------------------------------------------------------------------- sesiones

// Un host lleva al menos un punto (jira.x.eu) o un puerto (127.0.0.1:5175,
// localhost:5175): sin eso, «planificador» u «observaciones» pasarían por host.
const HOST_RE = /^[a-z0-9-]+(?:(?:\.[a-z0-9-]+)+(?::\d+)?|:\d+)$/i

/** El host de un título «Faro · <host>», o '' si el título no es de un chat. Pura. */
export function hostFromTitle(title) {
  const m = String(title || '').match(/^Faro · (.+)$/)
  const resto = m ? m[1].trim() : ''
  return HOST_RE.test(resto) ? resto.toLowerCase() : ''
}

/**
 * De qué tipo es una sesión por su título: el chat del panel se titula
 * «Faro · <host>»; las que Faro crea y borra para un turno interno llevan otra
 * cosa detrás («planificador», «observaciones», «índice de …»). Pura.
 * @returns {'chat'|'desechable'|''}
 */
export function sessionKind(title) {
  const t = String(title || '')
  if (!/^Faro\b/.test(t)) return ''
  return hostFromTitle(t) ? 'chat' : 'desechable'
}

/** El `system` de un mensaje, que opencode guarda como texto o como lista. Pura. */
export function systemText(system) {
  if (Array.isArray(system)) return system.map((s) => String(s ?? '')).join('\n')
  return typeof system === 'string' ? system : ''
}

/** El host de la línea «URL abierta: …» del sistema, o ''. Pura. */
export function hostFromSystem(system) {
  const url = pageUrlFromSystem(systemText(system))
  if (!url) return ''
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Elige la sesión: las de chat (o todas con `all`), de la más reciente a la
 * más antigua, y con `host` sólo las que lo lleven en el título o en el
 * sistema de su último mensaje de usuario (`hostOf`, que se consulta sólo si
 * el título no basta: es una consulta por sesión). Pura.
 */
export function pickSession(sessions, { host = '', all = false, hostOf = () => '' } = {}) {
  const filtro = String(host || '')
    .trim()
    .toLowerCase()
  const candidatas = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => {
      const kind = sessionKind(s.title)
      return all ? kind !== '' : kind === 'chat'
    })
    .sort((a, b) => Number(b.time_updated || 0) - Number(a.time_updated || 0))
  const casa = (s) => {
    if (!filtro) return true
    if (hostFromTitle(s.title).includes(filtro)) return true
    return String(hostOf(s) || '')
      .toLowerCase()
      .includes(filtro)
  }
  const chosen = candidatas.find(casa) || null
  return { chosen, candidates: candidatas }
}

// --------------------------------------------------------------------- turnos

/** El JSON de la columna `data`, ya sea texto o un objeto; `{}` si no vale. Pura. */
export function parseData(data) {
  if (data && typeof data === 'object') return data
  try {
    const o = JSON.parse(String(data ?? ''))
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function tiempoDe(row, d) {
  return Number(d?.time?.created) || Number(row?.time_created) || 0
}

function ordenadas(rows, tiempo) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, i) => ({ row, d: parseData(row.data), i }))
    .sort((a, b) => tiempo(a.row, a.d) - tiempo(b.row, b.d) || String(a.row.id).localeCompare(String(b.row.id)) || a.i - b.i)
}

/**
 * Un mensaje `user` que no es una pregunta: opencode lo crea al compactar la
 * sesión, con una parte `compaction` y ninguna text/file (en la base de esta
 * máquina, los 19 que hay son exactamente así, y ninguno mezcla). Un mensaje
 * sin ninguna parte NO cuenta: es una pregunta de la que no se guardó nada, y
 * sigue abriendo turno. Pura.
 */
export function isCompactionUser(message) {
  const m = message || {}
  if (m.role !== 'user') return false
  const partes = Array.isArray(m.parts) ? m.parts : []
  return partes.some((p) => p?.type === 'compaction') && !partes.some((p) => p?.type === 'text' || p?.type === 'file')
}

/**
 * El mensaje del asistente que sigue a una compactación: su texto es el
 * resumen con el que opencode sustituye el historial. `summary` tiene que ser
 * EXACTAMENTE `true`: un mensaje de usuario normal lleva `summary: {diffs: []}`,
 * que es otra cosa. Pura.
 */
export function isCompactionSummary(message) {
  const m = message || {}
  if (m.role !== 'assistant') return false
  const d = m.data || {}
  return d.summary === true || d.agent === 'compaction'
}

/**
 * Agrupa filas de `message` y `part` en turnos: cada mensaje del usuario abre
 * uno y se lleva todos los del asistente hasta el siguiente. opencode parte un
 * turno en varios mensajes del asistente (uno por vuelta de herramientas, §7):
 * por eso se agrupa así y no por mensaje. Orden por `time.created` del JSON
 * (la columna `time_created` como respaldo) y, en empate, por id. Pura.
 *
 * Una compactación (`isCompactionUser`) NO abre turno: se anota en el turno en
 * curso (`compactions`) con el asistente que trae el resumen
 * (`isCompactionSummary`); lo que el asistente diga después del resumen sigue
 * siendo del turno, porque opencode compacta también a mitad de uno (por
 * desbordamiento) y luego lo continúa.
 *
 * @param {Array<{id, time_created?, data}>} messages
 * @param {Array<{id, message_id, time_created?, data}>} parts
 * @returns {Array<{user: object|null, assistant: object[], compactions: Array<{user: object, assistant: object[]}>}>}
 */
export function groupTurns(messages, parts) {
  const porMensaje = new Map()
  for (const { row, d } of ordenadas(parts, (row, d) => Number(row.time_created) || Number(d?.time?.start) || 0)) {
    const lista = porMensaje.get(row.message_id) || []
    lista.push({ id: row.id, ...d })
    porMensaje.set(row.message_id, lista)
  }

  const turnos = []
  let actual = null
  const huerfano = () => {
    actual = { user: null, assistant: [], compactions: [] }
    turnos.push(actual)
  }
  for (const { row, d } of ordenadas(messages, tiempoDe)) {
    const mensaje = { id: row.id, role: d.role || '', time: tiempoDe(row, d), data: d, parts: porMensaje.get(row.id) || [] }
    if (isCompactionUser(mensaje)) {
      if (!actual) huerfano()
      actual.compactions.push({ user: mensaje, assistant: [] })
      continue
    }
    if (mensaje.role === 'user') {
      actual = { user: mensaje, assistant: [], compactions: [] }
      turnos.push(actual)
      continue
    }
    if (!actual) huerfano()
    if (isCompactionSummary(mensaje) && actual.compactions.length) {
      actual.compactions[actual.compactions.length - 1].assistant.push(mensaje)
      continue
    }
    actual.assistant.push(mensaje)
  }
  return turnos
}

/** Cuántas compactaciones hay en una lista de turnos. Pura. */
export function countCompactions(turns) {
  return (Array.isArray(turns) ? turns : []).reduce((n, t) => n + (Array.isArray(t?.compactions) ? t.compactions.length : 0), 0)
}

/** Corta a `max` caracteres y lo dice con «…». Pura. */
export function cut(text, max) {
  const s = String(text ?? '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** «mcp_jira_search» → `{mcp:'mcp', tool:'jira_search'}`; sin prefijo, tal cual. Pura. */
export function splitToolName(name) {
  const s = String(name || '')
  const m = s.match(/^(.*?)_((?:jira|confluence)_[a-z0-9_]+)$/i)
  return m ? { mcp: m[1], tool: m[2] } : { mcp: '', tool: s }
}

function unaLinea(value, max) {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return cut(String(s ?? '').replace(/\r?\n/g, ' ⏎ '), max)
}

/** Los campos de `INPUT_KEYS` que trae la entrada, y el nombre de los demás. Pura. */
export function pickInput(input, limits = TURN_LIMITS) {
  const pairs = []
  const others = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { pairs, others }
  for (const k of Object.keys(input)) {
    if (INPUT_KEYS.includes(k)) pairs.push([k, unaLinea(input[k], limits.inputChars)])
    else others.push(k)
  }
  return { pairs, others }
}

function textoDeSalida(output) {
  if (typeof output === 'string') return output
  if (output == null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function esValla(line) {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  return m ? { char: m[1][0], len: m[1].length, info: m[2].trim() } : null
}

/**
 * Pone una línea «— bloque de anclas (N notas) —» delante del bloque ```json
 * de anclas de una respuesta de Análisis, para verlo de un vistazo entre la
 * prosa. Decide si LO HAY con `splitAnchorsBlock`, la misma función que usa el
 * panel, y lo sitúa buscando la última valla cuyo cuerpo es ese JSON (o el
 * último párrafo si va sin valla). Sin bloque, el texto vuelve intacto. Pura.
 */
export function markAnchorsBlock(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  const { anchors, truncated } = splitAnchorsBlock(src)
  if (!anchors && !truncated) return src
  const n = anchors ? anchors.notes.length : null
  const marca = `— bloque de anclas (${n === null ? 'sin cerrar' : `${n} nota${n === 1 ? '' : 's'}`}) —`

  const lines = src.split('\n')
  let abierta = null
  let elegida = -1
  for (let i = 0; i < lines.length; i++) {
    const f = esValla(lines[i])
    if (!f) continue
    if (!abierta) {
      abierta = { i, char: f.char, len: f.len }
    } else if (f.char === abierta.char && f.len >= abierta.len && f.info === '') {
      const cuerpo = lines.slice(abierta.i + 1, i).join('\n').trim()
      if (cuerpo.startsWith('{') && cuerpo.includes('"notes"')) elegida = abierta.i
      abierta = null
    }
  }
  if (abierta) {
    const cuerpo = lines.slice(abierta.i + 1).join('\n').trim()
    if (cuerpo.startsWith('{') && cuerpo.includes('"notes"')) elegida = abierta.i
  }
  if (elegida < 0) {
    // Sin valla: el JSON va como último párrafo (splitAnchorsBlock también lo admite).
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('{') && (i === 0 || lines[i - 1].trim() === '')) {
        elegida = i
        break
      }
    }
  }
  if (elegida < 0) return src
  lines.splice(elegida, 0, marca)
  return lines.join('\n')
}

/**
 * Una parte en lo que interesa ver: la herramienta con su entrada y 400
 * caracteres de salida, el texto entero con el bloque de anclas marcado (y
 * `chars`, la longitud del texto ORIGINAL: la marca la pone este script, no
 * el modelo), el razonamiento sólo por longitud. `step-start`/`step-finish`
 * no dicen nada → null. Pura.
 */
export function summarizePart(part, limits = TURN_LIMITS) {
  const p = part || {}
  switch (p.type) {
    case 'text':
      return { type: 'text', text: markAnchorsBlock(p.text), chars: String(p.text ?? '').length }
    case 'reasoning':
      return { type: 'reasoning', chars: String(p.text ?? '').length }
    case 'tool': {
      const st = p.state && typeof p.state === 'object' ? p.state : {}
      const { mcp, tool } = splitToolName(p.tool)
      const { pairs, others } = pickInput(st.input, limits)
      const salida = textoDeSalida(st.output)
      const out = {
        type: 'tool',
        tool,
        mcp,
        status: String(st.status || ''),
        input: pairs,
        otherKeys: others,
        output: cut(salida, limits.outputChars),
        outputChars: salida.length,
      }
      if (st.error) out.error = cut(textoDeSalida(st.error), limits.outputChars)
      return out
    }
    case 'file':
      return { type: 'file', mime: String(p.mime || ''), filename: String(p.filename || '') }
    case 'step-start':
    case 'step-finish':
      return null
    default:
      return p.type ? { type: String(p.type) } : null
  }
}

/** Longitud, número de líneas y las primeras y últimas `n` líneas del sistema. Pura. */
export function systemSummary(system, n = TURN_LIMITS.systemLines) {
  const text = systemText(system)
  if (!text) return { chars: 0, lines: 0, head: [], tail: [] }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length <= 2 * n) return { chars: text.length, lines: lines.length, head: lines, tail: [] }
  return { chars: text.length, lines: lines.length, head: lines.slice(0, n), tail: lines.slice(-n) }
}

/** «github-copilot/gpt-5.6-luna» a partir de un mensaje guardado. Pura. */
export function modelLabel(data) {
  const d = data || {}
  const provider = d.providerID || d.model?.providerID || ''
  const model = d.modelID || d.model?.modelID || ''
  return [provider, model].filter(Boolean).join('/')
}

function errorText(err) {
  if (!err) return ''
  if (typeof err === 'string') return cut(err, 300)
  const nombre = err.name || ''
  const mensaje = err.data?.message || err.message || ''
  return cut([nombre, mensaje].filter(Boolean).join(': ') || textoDeSalida(err), 300)
}

/**
 * Una compactación anotada en un turno: si fue automática, si vino por
 * desbordamiento del contexto y cuántos caracteres tiene el resumen (0 si el
 * asistente no dejó texto). El resumen no se enseña: no es del modelo al
 * usuario. Pura.
 */
function describeCompaction(c) {
  const parte = (c?.user?.parts || []).find((p) => p?.type === 'compaction') || {}
  const summaryChars = (c?.assistant || []).reduce((n, m) => n + (m.parts || []).filter((p) => p.type === 'text').reduce((k, p) => k + String(p.text ?? '').length, 0), 0)
  return { auto: parte.auto === true, overflow: parte.overflow === true, summaryChars }
}

/**
 * Un turno agrupado, en lo que se enseña: la pregunta sin el bloque de lo
 * señalado (que el panel pega delante), el resumen del sistema, cada mensaje
 * del asistente con su modelo, duración, tokens y partes, y las
 * compactaciones que opencode hizo tras (o durante) el turno. Pura.
 */
export function describeTurn(turn, limits = TURN_LIMITS) {
  const u = turn?.user || null
  const partesUsuario = u?.parts || []
  const crudo = partesUsuario
    .filter((p) => p.type === 'text')
    .map((p) => String(p.text ?? ''))
    .join('\n')
  const assistant = (turn?.assistant || []).map((m) => {
    const d = m.data || {}
    const creado = Number(d.time?.created) || 0
    const acabado = Number(d.time?.completed) || 0
    const out = {
      id: m.id,
      time: m.time,
      model: modelLabel(d),
      duration: creado && acabado ? acabado - creado : null,
      finish: String(d.finish || ''),
      error: errorText(d.error),
      tokens: d.tokens && typeof d.tokens === 'object' ? { total: Number(d.tokens.total) || 0, input: Number(d.tokens.input) || 0, output: Number(d.tokens.output) || 0 } : null,
      parts: (m.parts || []).map((p) => summarizePart(p, limits)).filter(Boolean),
    }
    return out
  })
  return {
    time: u?.time || assistant[0]?.time || 0,
    question: stripSelectionBlock(crudo),
    senalado: crudo.startsWith(SELECTION_OPEN),
    files: partesUsuario.filter((p) => p.type === 'file').map((p) => ({ mime: String(p.mime || ''), filename: String(p.filename || '') })),
    system: systemSummary(u?.data?.system, limits.systemLines),
    host: hostFromSystem(u?.data?.system),
    model: u ? modelLabel(u.data) : '',
    assistant,
    compactions: (turn?.compactions || []).map(describeCompaction),
  }
}

// -------------------------------------------------------------------- formato

/** 70353 → «70 353». Pura. */
export function formatInt(n) {
  const s = String(Math.trunc(Number(n) || 0))
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Milisegundos → «850 ms» · «4,1 s» · «1 min 12 s». Pura. */
export function formatDuration(ms) {
  const v = Math.max(0, Number(ms) || 0)
  if (v < 1000) return `${Math.round(v)} ms`
  if (v < 60000) return `${(v / 1000).toFixed(1).replace('.', ',')} s`
  const min = Math.floor(v / 60000)
  const s = Math.round((v % 60000) / 1000)
  return `${min} min ${s} s`
}

/** Bytes → «32 KB» · «4,2 MB». Pura. */
export function formatSize(bytes) {
  const b = Math.max(0, Number(bytes) || 0)
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** Fecha y hora locales «2026-09-10 14:02:35», o «sin fecha». Pura salvo la zona horaria. */
export function formatTime(ms) {
  const v = Number(ms) || 0
  if (!v) return 'sin fecha'
  const d = new Date(v)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function citado(text, indent = '  ') {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => `${indent}│ ${l}`)
}

/** Las líneas de una parte ya resumida. Pura. */
export function formatPart(p) {
  switch (p.type) {
    case 'reasoning':
      return [`  [razonamiento] ${formatInt(p.chars)} caracteres`]
    case 'text':
      // `chars` es la longitud del original: `p.text` lleva la marca «— bloque de anclas —» que no es del modelo.
      return [`  [texto] ${formatInt(p.chars)} caracteres`, ...citado(p.text, '    ')]
    case 'tool': {
      const out = [`  [herramienta] ${p.tool || '(sin nombre)'}${p.mcp ? ` (${p.mcp})` : ''} · ${p.status || 'sin estado'}`]
      for (const [k, v] of p.input) out.push(`      ${k}: ${v}`)
      if (p.otherKeys.length) out.push(`      (otros campos de la entrada: ${p.otherKeys.join(', ')})`)
      if (p.error) out.push(`      error: ${p.error}`)
      if (p.outputChars) {
        // `cut` añade «…» al recortar: lo enseñado son todos los caracteres menos ése.
        const recortada = p.outputChars > p.output.length
        out.push(`      salida (${recortada ? `${formatInt(p.output.length - 1)} de ` : ''}${formatInt(p.outputChars)} caracteres):`)
        out.push(...citado(p.output, '      '))
      } else {
        out.push('      (sin salida)')
      }
      return out
    }
    case 'file':
      return [`  [fichero] ${[p.filename, p.mime].filter(Boolean).join(' · ') || 'sin nombre'}`]
    default:
      return [`  [${p.type}]`]
  }
}

/** Las líneas de un turno descrito por `describeTurn`. Pura. */
export function formatTurn(desc, { index = 1, total = 1 } = {}) {
  const out = []
  out.push(`━━━ Turno ${index} de ${total} · ${formatTime(desc.time)}${desc.host ? ` · ${desc.host}` : ''} ━━━`)

  const extras = []
  if (desc.senalado) extras.push('con un fragmento señalado en la página, que aquí se omite')
  if (desc.files.length) extras.push(`adjuntos: ${desc.files.map((f) => f.filename || f.mime || 'fichero').join(', ')}`)
  out.push(`PREGUNTA${extras.length ? ` (${extras.join(' · ')})` : ''}`)
  out.push(...citado(desc.question || '(sin texto)'))

  const s = desc.system
  if (!s.chars) {
    out.push('SISTEMA: ninguno')
  } else {
    out.push(`SISTEMA: ${formatInt(s.chars)} caracteres · ${formatInt(s.lines)} líneas`)
    if (s.tail.length) {
      out.push(`  primeras ${s.head.length} líneas:`)
      out.push(...citado(s.head.join('\n')))
      out.push(`  … (${formatInt(s.lines - s.head.length - s.tail.length)} líneas omitidas)`)
      out.push(`  últimas ${s.tail.length} líneas:`)
      out.push(...citado(s.tail.join('\n')))
    } else {
      out.push(...citado(s.head.join('\n')))
    }
  }

  if (!desc.assistant.length) out.push('ASISTENTE: sin respuesta guardada')
  desc.assistant.forEach((m, i) => {
    const cab = [`ASISTENTE ${i + 1}/${desc.assistant.length}`, m.model || 'modelo desconocido']
    if (m.duration !== null && m.duration !== undefined) cab.push(formatDuration(m.duration))
    if (m.finish) cab.push(`fin: ${m.finish}`)
    if (m.tokens) cab.push(`tokens ${formatInt(m.tokens.total)} (entrada ${formatInt(m.tokens.input)} · salida ${formatInt(m.tokens.output)})`)
    out.push(cab.join(' · '))
    if (m.error) out.push(`  ERROR: ${m.error}`)
    if (!m.parts.length) out.push('  (sin partes)')
    for (const p of m.parts) out.push(...formatPart(p))
  })
  for (const c of desc.compactions || []) {
    const resumen = c.summaryChars ? `resumen de ${formatInt(c.summaryChars)} caracteres` : 'sin resumen guardado'
    out.push(`(compactación ${c.auto ? 'automática ' : ''}de opencode tras este turno: ${resumen}${c.overflow ? ' · por desbordamiento del contexto' : ''})`)
  }
  return out
}

/** La lista de sesiones candidatas, con la elegida marcada. Pura. */
export function formatSessionList(candidates, chosenId, { limit = TURN_LIMITS.sessionsShown, countOf = () => null } = {}) {
  const out = []
  for (const s of candidates.slice(0, limit)) {
    const n = countOf(s)
    out.push(
      `  ${s.id === chosenId ? '▶' : ' '} ${s.id} · ${s.title} · ${formatTime(s.time_updated)}${n === null || n === undefined ? '' : ` · ${formatInt(n)} mensajes`}`
    )
  }
  if (candidates.length > limit) out.push(`    … y ${formatInt(candidates.length - limit)} más`)
  return out
}

// ---------------------------------------------------------------------- main

function copiarBase(origen, dir) {
  const copiados = []
  for (const suf of DB_SUFFIXES) {
    const de = origen + suf
    if (!existsSync(de)) continue
    copyFileSync(de, join(dir, DB_NAME + suf))
    copiados.push({ suffix: suf, bytes: statSync(de).size })
  }
  return copiados
}

/**
 * node:sqlite avisa por consola de que es experimental cada vez que se carga;
 * aquí ese aviso sólo ensucia la salida. Se calla ÉSE y ningún otro.
 */
function silenciarAvisoSqlite() {
  const original = process.emitWarning
  process.emitWarning = function (warning, ...rest) {
    const texto = typeof warning === 'string' ? warning : warning?.message || ''
    if (/SQLite/i.test(texto)) return undefined
    return original.call(process, warning, ...rest)
  }
}

/** Por qué no ha cargado node:sqlite, según el Node que corre. */
function explicarNode(soporte, err) {
  const v = process.versions.node
  if (soporte === 'flag') {
    return [
      `Node ${v} trae node:sqlite sólo tras una bandera. Arranca así:`,
      '  node --experimental-sqlite tools/last-turn.mjs …',
      'Mejor Node ≥22.13, donde va sin bandera y con apertura en sólo lectura garantizada.',
    ].join('\n')
  }
  if (soporte === 'ok') {
    return [`Node ${v} debería traer node:sqlite, pero no se ha podido cargar: ${err?.message || err}`, 'Comprueba que no lo desactive ninguna bandera ni NODE_OPTIONS.'].join('\n')
  }
  return [
    `Node ${v} no trae node:sqlite; este script necesita Node ≥22.13 (22.5-22.12 con --experimental-sqlite).`,
    'El resto del repo sigue funcionando con Node ≥18: sólo esta herramienta pide más.',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }
  if (args.errors.length) {
    for (const e of args.errors) console.error(e)
    console.error('\n' + HELP)
    process.exitCode = 2
    return
  }
  // La puerta la decide el import de verdad, no la versión ni las banderas: con
  // 22.5-22.12 la bandera puede venir en NODE_OPTIONS, que no se ve desde aquí.
  let sqlite
  try {
    silenciarAvisoSqlite()
    sqlite = await import('node:sqlite')
  } catch (err) {
    console.error(explicarNode(sqliteSupport(process.versions.node), err))
    process.exitCode = 1
    return
  }

  const origen = args.db || dbCandidates(process.env, homedir()).find((p) => existsSync(p)) || ''
  if (!origen || !existsSync(origen)) {
    console.error(
      args.db
        ? `No existe la base de datos: ${args.db}`
        : ['No encuentro opencode.db. Miré en:', ...dbCandidates(process.env, homedir()).map((p) => '  ' + p), 'Indica la ruta con --db.'].join('\n')
    )
    process.exitCode = 1
    return
  }
  if (!statSync(origen).isFile()) {
    console.error(`«${origen}» no es un fichero (¿un directorio?): indica la ruta de opencode.db con --db.`)
    process.exitCode = 1
    return
  }

  const dir = join(tmpdir(), `faro-turn-${process.pid}`)
  let db = null
  try {
    mkdirSync(dir, { recursive: true })
    const copiados = copiarBase(origen, dir)

    const out = []
    out.push(
      `Base de datos: ${origen} (${copiados.map((c) => `${c.suffix || '.db'} ${formatSize(c.bytes)}`).join(' + ')}) → copiada a ${dir}, que se borra al acabar`
    )

    // Abrir y la primera consulta: con un fichero que no es SQLite o una base de otra aplicación, aquí es donde revienta.
    let sesiones
    try {
      db = new sqlite.DatabaseSync(join(dir, DB_NAME), { readOnly: true })
      sesiones = db.prepare("SELECT id, title, time_created, time_updated FROM session WHERE title LIKE 'Faro%' ORDER BY time_updated DESC").all()
    } catch (err) {
      const texto = dbErrorText(err, origen)
      if (!texto) throw err
      console.error(texto)
      process.exitCode = 1
      return
    }
    const ultimoSistema = db.prepare(
      "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC LIMIT 1"
    )
    const hostOf = (s) => {
      const fila = ultimoSistema.get(s.id)
      return fila ? hostFromSystem(parseData(fila.data).system) : ''
    }
    const { chosen, candidates } = pickSession(sesiones, { host: args.host, all: args.all, hostOf })
    const desechables = sesiones.filter((s) => sessionKind(s.title) === 'desechable').length
    out.push(
      `Sesiones de Faro: ${formatInt(candidates.length)} ${args.all ? 'en total' : `de chat (más ${formatInt(desechables)} desechables, que salen con --all)`}` +
        (args.host ? ` · filtro de host «${args.host}»` : '')
    )
    if (!chosen) {
      out.push(args.host ? 'Ninguna sesión lleva ese host, ni en el título ni en la línea «URL abierta: …» de su sistema.' : 'No hay ninguna sesión «Faro · …».')
      console.log(out.join('\n'))
      process.exitCode = 1
      return
    }
    const cuenta = db.prepare('SELECT count(*) AS n FROM message WHERE session_id = ?')
    out.push(`Las ${Math.min(candidates.length, TURN_LIMITS.sessionsShown)} más recientes:`)
    out.push(...formatSessionList(candidates, chosen.id, { countOf: (s) => cuenta.get(s.id)?.n ?? null }))

    const mensajes = db.prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id').all(chosen.id)
    const partes = db.prepare('SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id').all(chosen.id)
    const turnos = groupTurns(mensajes, partes)
    const compactaciones = countCompactions(turnos)
    const desde = Math.max(0, turnos.length - args.n)
    out.push(
      `Sesión elegida: ${chosen.id} «${chosen.title}» · ${formatInt(turnos.length)} turno${turnos.length === 1 ? '' : 's'} · ` +
        (compactaciones ? `${formatInt(compactaciones)} compactaci${compactaciones === 1 ? 'ón' : 'ones'} de opencode · ` : '') +
        (turnos.length ? `se enseña${turnos.length - desde === 1 ? ' el último' : `n los ${turnos.length - desde} últimos`}` : 'nada que enseñar')
    )
    out.push('')
    turnos.slice(desde).forEach((t, i) => {
      out.push(...formatTurn(describeTurn(t), { index: desde + i + 1, total: turnos.length }))
      out.push('')
    })
    console.log(out.join('\n'))
  } finally {
    try {
      db?.close()
    } catch {
      /* ya cerrada o nunca abierta */
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

// Sólo arranca si es el módulo principal: importarlo desde un test no abre nada.
const principal = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (principal && principal.toLowerCase() === import.meta.url.toLowerCase()) {
  main().catch((err) => {
    console.error(err?.stack || String(err))
    process.exitCode = 1
  })
}
