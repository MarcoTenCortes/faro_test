/**
 * El mini-evaluador de JQL del banco de pruebas: la Jira de mentira que sirve
 * `tools/serve-harness.js` en `GET /rest/api/2/search`.
 *
 * POR QUÉ EXISTE: desde H7 la extensión ejecuta consultas contra la API del
 * propio Jira (src/shared/jira-rest.js). Sin un servidor que conteste como Jira
 * —incluido el 400 con sus `errorMessages`— el camino entero (montar la ruta,
 * pedirla, degradar, validar lo que vuelve) sólo se podría probar en el Jira
 * real del usuario. Con esto, el banco del navegador lo recorre entero y estas
 * funciones, que son puras, se prueban además en Node
 * (test/unit/serve-harness.test.js).
 *
 * Es de MENTIRA a propósito y de LISTA BLANCA: sólo entiende las cláusulas que
 * las plantillas de jira-rest.js y los chips de H8 pueden escribir. Cualquier
 * otra cosa —un campo que no está, una función que no existe, un paréntesis sin
 * cerrar— sale por donde saldría en Jira: 400 con un mensaje del servidor. Eso
 * es justo lo que hace falta probar, porque el panel enseña ese mensaje tal cual
 * y nunca decide por su cuenta qué está mal en una consulta.
 *
 * Lo que NO es: un motor de JQL. No hay `NOT`, ni `!=`, ni `IN (…)` con listas,
 * ni rangos de fechas absolutos, ni precedencia real entre `AND` y `OR` más allá
 * de la que dan los paréntesis (se evalúa de izquierda a derecha, y las
 * plantillas van siempre con paréntesis). Si un hito necesita más, se añade la
 * cláusula aquí y su prueba al lado.
 */

/** Campos que se pueden comparar con `=`, y de qué parte de la incidencia salen. */
const CAMPOS_IGUALDAD = new Set([
  'project',
  'status',
  'issuetype',
  'type',
  'component',
  'labels',
  'resolution',
  'priority',
  'sprint',
  'parent',
  'epic link',
  'assignee',
  'reporter',
  'key',
])

/** Campos por los que se puede ordenar. */
const CAMPOS_ORDEN = new Set(['updated', 'lastviewed', 'created', 'key', 'priority'])

/** Funciones que existen en esta Jira de mentira. */
const FUNCIONES = new Set(['currentuser', 'issuehistory', 'watchedissues', 'linkedissues'])

const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Crítica']

/** El error tal como lo devuelve Jira: una lista de mensajes en `errorMessages`. */
function error(mensaje) {
  return { ok: false, errorMessages: [mensaje] }
}

// --------------------------------------------------------------- tokenizador

/**
 * Trocea una consulta en símbolos: palabras, literales entre comillas (simples o
 * dobles, con `\"` dentro), paréntesis, comas y operadores de comparación. Pura.
 *
 * @returns {{ok:true, tokens:Array}|{ok:false, errorMessages:string[]}}
 */
export function tokenize(jql) {
  const src = String(jql ?? '')
  const tokens = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ tipo: c, valor: c })
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let valor = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          valor += src[j + 1]
          j += 2
          continue
        }
        valor += src[j]
        j++
      }
      if (j >= src.length) return error(`Error in the JQL Query: falta cerrar el literal ${c}.`)
      tokens.push({ tipo: 'texto', valor })
      i = j + 1
      continue
    }
    const op = ['>=', '<=', '!=', '=', '>', '<', '~'].find((o) => src.startsWith(o, i))
    if (op) {
      tokens.push({ tipo: 'op', valor: op })
      i += op.length
      continue
    }
    const palabra = /^[A-Za-z0-9_.\-+]+/.exec(src.slice(i))
    if (!palabra) return error(`Error in the JQL Query: carácter inesperado «${c}».`)
    tokens.push({ tipo: 'palabra', valor: palabra[0] })
    i += palabra[0].length
  }
  return { ok: true, tokens }
}

// ------------------------------------------------------------------- parser

/**
 * De una consulta a `{filtro, orden}`: el filtro es un árbol de cláusulas y
 * `orden` un `{campo, dir}` o null. Pura.
 *
 * @returns {{ok:true, filtro:object|null, orden:object|null}|{ok:false, errorMessages:string[]}}
 */
export function parseJql(jql) {
  const t = tokenize(jql)
  if (!t.ok) return t
  const tokens = t.tokens
  let i = 0

  const mira = () => tokens[i] || null
  const esPalabra = (v) => mira()?.tipo === 'palabra' && mira().valor.toLowerCase() === v

  function valor() {
    const tok = mira()
    if (!tok) return error('Error in the JQL Query: falta un valor.')
    if (tok.tipo === 'texto') {
      i++
      return { ok: true, nodo: { clase: 'literal', valor: tok.valor } }
    }
    if (tok.tipo !== 'palabra') return error(`Error in the JQL Query: «${tok.valor}» no es un valor.`)
    const nombre = tok.valor
    i++
    if (mira()?.tipo === '(') return funcion(nombre)
    return { ok: true, nodo: { clase: 'literal', valor: nombre } }
  }

  /** `nombre(arg?)`: la lista de funciones es blanca, como en Jira. */
  function funcion(nombre) {
    const clave = nombre.toLowerCase()
    if (!FUNCIONES.has(clave)) return error(`Unable to find JQL function '${nombre}()'.`)
    i++ // (
    const args = []
    while (mira() && mira().tipo !== ')') {
      const tok = mira()
      if (tok.tipo === ',') {
        i++
        continue
      }
      if (tok.tipo !== 'palabra' && tok.tipo !== 'texto') return error(`Error in the JQL Query: argumento inesperado en ${nombre}().`)
      args.push(tok.valor)
      i++
    }
    if (!mira()) return error(`Error in the JQL Query: falta cerrar ${nombre}(.`)
    i++ // )
    return { ok: true, nodo: { clase: 'funcion', nombre: clave, args } }
  }

  function clausula() {
    const tok = mira()
    if (!tok || tok.tipo === ')') return error('Error in the JQL Query: falta una condición.')
    if (tok.tipo !== 'palabra' && tok.tipo !== 'texto') return error(`Error in the JQL Query: «${tok.valor}» no es un campo.`)
    const campo = tok.valor
    const clave = campo.toLowerCase()
    i++
    const siguiente = mira()
    if (siguiente?.tipo === 'palabra' && siguiente.valor.toLowerCase() === 'in') {
      i++
      const v = valor()
      if (!v.ok) return v
      if (v.nodo.clase !== 'funcion') return error(`Error in the JQL Query: «${campo} in» sólo admite una función en esta Jira de pruebas.`)
      if (clave !== 'issuekey' && clave !== 'issue' && clave !== 'key') {
        return error(`Field '${campo}' does not exist or you do not have permission to view it.`)
      }
      return { ok: true, nodo: { clase: 'en', campo: clave, funcion: v.nodo } }
    }
    if (siguiente?.tipo !== 'op') return error(`Error in the JQL Query: falta un operador detrás de «${campo}».`)
    const op = siguiente.valor
    i++
    const v = valor()
    if (!v.ok) return v
    if (clave === 'updated' || clave === 'created' || clave === 'lastviewed') {
      return { ok: true, nodo: { clase: 'fecha', campo: clave, op, valor: v.nodo.valor } }
    }
    if (!CAMPOS_IGUALDAD.has(clave)) return error(`Field '${campo}' does not exist or you do not have permission to view it.`)
    if (op !== '=') return error(`Error in the JQL Query: el operador «${op}» no está admitido en esta Jira de pruebas.`)
    return { ok: true, nodo: { clase: 'igual', campo: clave, valor: v.nodo } }
  }

  function termino() {
    if (mira()?.tipo === '(') {
      i++
      const dentro = expresion()
      if (!dentro.ok) return dentro
      if (mira()?.tipo !== ')') return error('Error in the JQL Query: falta cerrar un paréntesis.')
      i++
      return dentro
    }
    return clausula()
  }

  function expresion() {
    const primero = termino()
    if (!primero.ok) return primero
    let nodo = primero.nodo
    while (mira()?.tipo === 'palabra' && ['and', 'or'].includes(mira().valor.toLowerCase())) {
      const op = mira().valor.toLowerCase()
      i++
      const otro = termino()
      if (!otro.ok) return otro
      nodo = { clase: op, izq: nodo, der: otro.nodo }
    }
    return { ok: true, nodo }
  }

  let filtro = null
  if (mira() && !esPalabra('order')) {
    const e = expresion()
    if (!e.ok) return e
    filtro = e.nodo
  }

  let orden = null
  if (esPalabra('order')) {
    i++
    if (!esPalabra('by')) return error('Error in the JQL Query: se esperaba «ORDER BY».')
    i++
    const campo = mira()
    if (!campo || (campo.tipo !== 'palabra' && campo.tipo !== 'texto')) return error('Error in the JQL Query: falta el campo de «ORDER BY».')
    const clave = campo.valor.toLowerCase()
    if (!CAMPOS_ORDEN.has(clave)) return error(`Field '${campo.valor}' does not exist or you do not have permission to view it.`)
    i++
    let dir = 'desc'
    if (mira()?.tipo === 'palabra' && ['asc', 'desc'].includes(mira().valor.toLowerCase())) {
      dir = mira().valor.toLowerCase()
      i++
    }
    orden = { campo: clave, dir }
  }

  if (mira()) return error(`Error in the JQL Query: sobra «${mira().valor}» al final.`)
  return { ok: true, filtro, orden }
}

// ---------------------------------------------------------------- evaluación

const igual = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

/** Las incidencias enlazadas con una clave, en los dos sentidos. */
function enlazadas(issues, clave) {
  const key = String(clave || '').toUpperCase()
  const suyas = issues.find((x) => x.key === key)?.links || []
  return new Set([...suyas.map((k) => k.toUpperCase()), ...issues.filter((x) => (x.links || []).some((k) => igual(k, key))).map((x) => x.key)])
}

function valorLiteral(nodo, ctx) {
  if (nodo.clase === 'literal') return nodo.valor
  if (nodo.clase === 'funcion' && nodo.nombre === 'currentuser') return ctx.user
  return null
}

function casaIgual(issue, campo, esperado) {
  switch (campo) {
    case 'project':
      return igual(String(issue.key).split('-')[0], esperado)
    case 'key':
      return igual(issue.key, esperado)
    case 'status':
      return igual(issue.status, esperado)
    case 'issuetype':
    case 'type':
      return igual(issue.type, esperado)
    case 'priority':
      return igual(issue.priority, esperado)
    case 'resolution':
      return igual(issue.resolution || 'Unresolved', esperado)
    case 'sprint':
      return igual(issue.sprint, esperado)
    case 'parent':
      return igual(issue.parent, esperado)
    case 'epic link':
      return igual(issue.epic, esperado)
    case 'assignee':
      return igual(issue.assignee, esperado)
    case 'reporter':
      return igual(issue.reporter, esperado)
    case 'component':
      return (issue.components || []).some((c) => igual(c, esperado))
    case 'labels':
      return (issue.labels || []).some((l) => igual(l, esperado))
    default:
      return false
  }
}

/** `-7d` / `-12h`: cuántas horas hacia atrás señala. null si no es una ventana relativa. */
export function horasDe(texto) {
  const m = /^-(\d{1,4})([dhwm])$/i.exec(String(texto || '').trim())
  if (!m) return null
  const n = Number(m[1])
  const factor = { d: 24, h: 1, w: 168, m: 1 / 60 }[m[2].toLowerCase()]
  return n * factor
}

function casaFecha(issue, nodo) {
  const horas = horasDe(nodo.valor)
  if (horas == null) return null
  const campo = nodo.campo === 'lastviewed' ? 'lastViewedHoursAgo' : nodo.campo === 'created' ? 'createdHoursAgo' : 'updatedHoursAgo'
  const suyas = issue[campo]
  if (typeof suyas !== 'number') return false
  switch (nodo.op) {
    case '>=':
      return suyas <= horas
    case '>':
      return suyas < horas
    case '<=':
      return suyas >= horas
    case '<':
      return suyas > horas
    default:
      return null
  }
}

/**
 * ¿Esta incidencia casa con el filtro ya analizado? `null` si la consulta pide
 * algo que esta Jira de mentira no sabe hacer (lo convierte en 400 quien llama).
 * Pura.
 */
export function casa(issue, nodo, ctx) {
  if (!nodo) return true
  if (nodo.clase === 'and' || nodo.clase === 'or') {
    const a = casa(issue, nodo.izq, ctx)
    const b = casa(issue, nodo.der, ctx)
    if (a === null || b === null) return null
    return nodo.clase === 'and' ? a && b : a || b
  }
  if (nodo.clase === 'igual') {
    const esperado = valorLiteral(nodo.valor, ctx)
    if (esperado === null) return null
    return casaIgual(issue, nodo.campo, esperado)
  }
  if (nodo.clase === 'fecha') return casaFecha(issue, nodo)
  if (nodo.clase === 'en') {
    const f = nodo.funcion
    if (f.nombre === 'issuehistory') return !!issue.history
    if (f.nombre === 'watchedissues') return !!issue.watched
    if (f.nombre === 'linkedissues') return ctx.enlazadas.has(issue.key)
    return null
  }
  return null
}

function ordena(issues, orden) {
  if (!orden) return issues
  const clave = (x) => {
    if (orden.campo === 'key') return x.key
    if (orden.campo === 'priority') return PRIORIDADES.indexOf(x.priority)
    const campo = orden.campo === 'lastviewed' ? 'lastViewedHoursAgo' : orden.campo === 'created' ? 'createdHoursAgo' : 'updatedHoursAgo'
    // Más reciente = menos horas hacia atrás. Lo que no tiene fecha va al final
    // en DESC, como en Jira.
    return typeof x[campo] === 'number' ? -x[campo] : -Infinity
  }
  const signo = orden.dir === 'asc' ? -1 : 1
  return [...issues].sort((a, b) => {
    const ka = clave(a)
    const kb = clave(b)
    if (ka === kb) return a.key.localeCompare(b.key, 'en')
    return (ka > kb ? -1 : 1) * signo
  })
}

/**
 * Ejecuta una consulta sobre la fixture. Pura.
 *
 * @param {Array} issues la fixture (harness/issues.json)
 * @param {string} jql
 * @param {{user?:string}} ctx quién es `currentUser()`
 * @returns {{ok:true, issues:Array}|{ok:false, errorMessages:string[]}}
 */
export function runJql(issues, jql, { user = '' } = {}) {
  const lista = Array.isArray(issues) ? issues : []
  const p = parseJql(jql)
  if (!p.ok) return p
  const clave = buscarLinked(p.filtro)
  const contexto = { user, enlazadas: clave ? enlazadas(lista, clave) : new Set() }
  const out = []
  for (const issue of lista) {
    const r = casa(issue, p.filtro, contexto)
    if (r === null) return error('Error in the JQL Query: esta Jira de pruebas no sabe evaluar esa condición.')
    if (r) out.push(issue)
  }
  return { ok: true, issues: ordena(out, p.orden) }
}

/** La clave de `linkedIssues(K)` que haya en el filtro, para resolverla una vez. */
function buscarLinked(nodo) {
  if (!nodo) return ''
  if (nodo.clase === 'and' || nodo.clase === 'or') return buscarLinked(nodo.izq) || buscarLinked(nodo.der)
  if (nodo.clase === 'en' && nodo.funcion.nombre === 'linkedissues') return nodo.funcion.args[0] || ''
  return ''
}

// ------------------------------------------------- la respuesta, con su forma

/** Los campos que devuelve `/search` si nadie pide otros. */
export const CAMPOS_POR_DEFECTO = ['summary', 'issuetype', 'status', 'priority', 'updated', 'assignee']

function persona(nombre, people) {
  if (!nombre) return null
  return { name: nombre, displayName: people?.[nombre] || nombre, key: nombre }
}

/** Un id numérico estable para una clave: Jira los da así y nadie los interpreta. */
function idDe(key) {
  let h = 0
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) % 900000
  return String(100000 + h)
}

function iso(horas, ahora) {
  if (typeof horas !== 'number') return null
  return new Date(ahora - horas * 3600000).toISOString().replace('Z', '+0000')
}

/**
 * Una incidencia con la forma que devuelve `GET /rest/api/2/search`, con sólo
 * los campos pedidos. Pura (el reloj se inyecta).
 */
export function issueJson(issue, campos, { people = {}, now = Date.now() } = {}) {
  const pedidos = new Set((campos && campos.length ? campos : CAMPOS_POR_DEFECTO).map((c) => String(c).trim()))
  const fields = {}
  const pon = (nombre, valor) => {
    if (pedidos.has(nombre)) fields[nombre] = valor
  }
  pon('summary', issue.summary)
  pon('issuetype', { name: issue.type, subtask: false })
  pon('status', { name: issue.status, statusCategory: { key: issue.statusCategory, name: issue.statusCategory } })
  pon('priority', { name: issue.priority })
  pon('resolution', issue.resolution ? { name: issue.resolution } : null)
  pon('assignee', persona(issue.assignee, people))
  pon('reporter', persona(issue.reporter, people))
  pon('labels', [...(issue.labels || [])])
  pon(
    'components',
    (issue.components || []).map((name) => ({ name }))
  )
  pon('updated', iso(issue.updatedHoursAgo, now))
  pon('created', iso(issue.createdHoursAgo ?? issue.updatedHoursAgo, now))
  pon('lastViewed', iso(issue.lastViewedHoursAgo, now))
  pon('parent', issue.parent ? { key: issue.parent } : null)
  pon('epic', issue.epic ? { key: issue.epic } : null)
  return { id: idDe(issue.key), key: issue.key, fields }
}

/**
 * La respuesta entera de `GET /rest/api/2/search`, o el 400 con sus
 * `errorMessages`. Pura (el reloj se inyecta).
 *
 * @returns {{status:200, body:object}|{status:400, body:{errorMessages:string[], errors:object}}}
 */
export function searchResponse(fixture, { jql, fields, maxResults, startAt, now = Date.now() } = {}) {
  const issues = fixture?.issues || []
  const r = runJql(issues, jql, { user: fixture?.currentUser?.name || '' })
  if (!r.ok) return { status: 400, body: { errorMessages: r.errorMessages, errors: {} } }
  const tope = Number.isInteger(Number(maxResults)) && Number(maxResults) > 0 ? Math.min(Number(maxResults), 100) : 50
  const desde = Number.isInteger(Number(startAt)) && Number(startAt) > 0 ? Number(startAt) : 0
  const campos = String(fields || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  return {
    status: 200,
    body: {
      expand: 'schema,names',
      startAt: desde,
      maxResults: tope,
      total: r.issues.length,
      issues: r.issues.slice(desde, desde + tope).map((issue) => issueJson(issue, campos, { people: fixture?.people, now })),
    },
  }
}
