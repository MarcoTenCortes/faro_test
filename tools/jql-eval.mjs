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
 * Lo que NO es: un motor de JQL. No hay `NOT`, ni `!=`, ni `IN (…)` con listas
 * de otra cosa que claves, ni rangos de fechas absolutos, ni precedencia real
 * entre `AND` y `OR` más allá de la que dan los paréntesis (se evalúa de
 * izquierda a derecha, y las plantillas van siempre con paréntesis). Si un hito
 * necesita más, se añade la cláusula aquí y su prueba al lado.
 *
 * DESDE H25 SABE DE RELACIONES. La plantilla `linksJql` de jira-rest.js escribe
 * `issuekey in (K1, K2, …)`, así que `key`/`issue`/`issuekey in (…)` admite una
 * LISTA de claves (cada una con forma de clave; vacía o con basura, 400; y una
 * que no está en la fixture, 400 con UN mensaje por clave, como un Data Center:
 * revisión de H25, D01). Y con
 * `fields=issuelinks` cada incidencia trae sus relaciones con la forma de la API
 * v2 —`{id, type:{id, name, inward, outward}, outwardIssue|inwardIssue}`—
 * sacadas del `issueLinks` DIRIGIDO de la fixture: `outwardIssue` en la de
 * `from`, `inwardIssue` en la de `to`. `linkedIssues()` sigue leyendo el `links`
 * plano, que la fixture mantiene coherente con `issueLinks`.
 *
 * DESDE H14 SABE DE IDS, y de que un nombre traducido no vale. En el Jira real
 * del usuario, con la interfaz en español, la API devuelve «Tarea» donde JQL
 * espera «Task» y `issuetype = "Tarea"` contesta 400; por id funciona siempre.
 * Aquí eso se finge con el `catalog` de la fixture: cada tipo, estado y prioridad
 * tiene un `id`, el `name` que acepta una consulta y —si Jira lo traduce— el
 * `display` con el que la API lo devuelve. Entonces `casaIgual` casa por nombre de
 * JQL o por id, y una consulta que pregunte por el nombre TRADUCIDO sale por
 * donde sale en el Jira real: 400 con el mensaje del servidor. Sin `catalog` se
 * comporta como antes de H14, que es lo que dejan las pruebas que no lo pasan.
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

/** La forma de una clave de incidencia en una lista `in (…)` (H25). */
const FORMA_DE_CLAVE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

/** Funciones que existen en esta Jira de mentira. */
const FUNCIONES = new Set(['currentuser', 'issuehistory', 'watchedissues', 'linkedissues'])

/**
 * El orden de `ORDER BY priority`, por el nombre de JQL: en la fixture las
 * prioridades llevan su nombre en inglés y el traducido como `display`, como
 * en el Jira real (`priority = "Crítica"` es un 400 allí; revisión adversaria
 * de H14).
 */
const PRIORIDADES = ['Low', 'Medium', 'High', 'Critical']

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

  /**
   * `(K1, K2, …)` detrás de `issuekey in`: claves con forma de clave separadas
   * por comas, al menos una. Lo demás es un 400, como en Jira, para que una
   * plantilla que escriba otra cosa caiga aquí y no pase en verde.
   */
  function listaDeClaves(campo) {
    i++ // (
    const claves = []
    for (;;) {
      const tok = mira()
      if (!tok) return error('Error in the JQL Query: falta cerrar la lista de claves.')
      if ((tok.tipo !== 'palabra' && tok.tipo !== 'texto') || !FORMA_DE_CLAVE.test(tok.valor)) {
        return error(`Error in the JQL Query: «${tok.valor}» no es una clave de incidencia.`)
      }
      claves.push(tok.valor.toUpperCase())
      i++
      if (mira()?.tipo === ',') {
        i++
        continue
      }
      if (mira()?.tipo === ')') {
        i++
        return { ok: true, nodo: { clase: 'claves', campo, claves } }
      }
      return error('Error in the JQL Query: falta una coma o cerrar la lista de claves.')
    }
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
      const deClave = clave === 'issuekey' || clave === 'issue' || clave === 'key'
      // H25: `issuekey in (K1, K2, …)`, la plantilla de linksJql.
      if (mira()?.tipo === '(') {
        if (!deClave) return error(`Field '${campo}' does not exist or you do not have permission to view it.`)
        return listaDeClaves(clave)
      }
      const v = valor()
      if (!v.ok) return v
      if (v.nodo.clase !== 'funcion') return error(`Error in the JQL Query: «${campo} in» sólo admite una función o una lista de claves en esta Jira de pruebas.`)
      if (!deClave) {
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

/** Los campos cuyos valores tienen id y pueden venir traducidos. */
const CAMPOS_CON_CATALOGO = ['issuetype', 'status', 'priority']

/**
 * El catálogo de valores de campo de la fixture, con lo justo: qué id tiene cada
 * tipo, estado y prioridad, con qué nombre lo acepta JQL (`name`) y con cuál lo
 * devuelve la API (`display`, el traducido si lo hay). Pura.
 *
 * @returns {{issuetype:Array, status:Array, priority:Array}}
 */
export function fieldCatalog(fixture) {
  const out = {}
  for (const campo of CAMPOS_CON_CATALOGO) {
    out[campo] = (fixture?.catalog?.[campo] || [])
      .map((e) => ({ id: String(e?.id ?? ''), name: String(e?.name ?? ''), display: String(e?.display ?? e?.name ?? '') }))
      .filter((e) => e.name)
  }
  return out
}

/** La entrada del catálogo de un valor, buscada por su nombre de JQL. */
function delCatalogo(catalogo, campo, nombre) {
  return (catalogo?.[campo] || []).find((e) => igual(e.name, nombre)) || null
}

/**
 * Cómo devuelve la API un valor de campo: su id y el nombre que VE el usuario
 * (el traducido, si Jira lo traduce). Pura.
 */
export function fieldValue(catalogo, campo, nombre) {
  const e = delCatalogo(catalogo, campo, nombre)
  return { id: e?.id || '', name: e?.display || String(nombre ?? '') }
}

/**
 * ¿Jira rechazaría este valor? El mensaje del servidor, o null. Pura.
 *
 * Sólo se rechaza lo que el Jira real rechaza y H14 vino a arreglar: preguntar
 * por el nombre TRADUCIDO de un valor que Jira trae de serie. Un valor que no
 * existe en ningún sitio sigue dando lista vacía aquí —el Jira real lo rechaza
 * también, pero esta Jira de mentira no sabe qué valores existen «en general» y
 * fingirlo cambiaría lo que ya prueban otras comprobaciones—.
 */
function valorRechazado(catalogo, campo, valor) {
  const lista = catalogo?.[campo]
  const v = String(valor ?? '').trim()
  if (!lista?.length || !v) return null
  if (lista.some((e) => (e.id && igual(e.id, v)) || igual(e.name, v))) return null
  const traducido = lista.find((e) => e.display && !igual(e.display, e.name) && igual(e.display, v))
  // En español porque es lo que contesta la instancia del usuario: el panel
  // enseña el mensaje del servidor tal cual y no interpreta ninguno.
  return traducido ? `El valor '${v}' no existe para el campo '${campo}'.` : null
}

/** El primer valor de la consulta que Jira rechazaría, o null. */
function valorNoAdmitido(nodo, catalogo) {
  if (!nodo || !catalogo) return null
  if (nodo.clase === 'and' || nodo.clase === 'or') {
    return valorNoAdmitido(nodo.izq, catalogo) || valorNoAdmitido(nodo.der, catalogo)
  }
  if (nodo.clase !== 'igual' || nodo.valor?.clase !== 'literal') return null
  const campo = nodo.campo === 'type' ? 'issuetype' : nodo.campo
  if (!CAMPOS_CON_CATALOGO.includes(campo)) return null
  return valorRechazado(catalogo, campo, nodo.valor.valor)
}

/** Casa un valor de campo por su nombre de JQL o por su id. */
function casaValor(ctx, campo, suyo, esperado) {
  if (igual(suyo, esperado)) return true
  const e = delCatalogo(ctx?.catalogo, campo, suyo)
  return !!e?.id && igual(e.id, esperado)
}

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

function casaIgual(issue, campo, esperado, ctx) {
  switch (campo) {
    case 'project':
      return igual(String(issue.key).split('-')[0], esperado)
    case 'key':
      return igual(issue.key, esperado)
    // Los tres que tienen id: por su nombre de JQL o por su id, como en Jira.
    case 'status':
      return casaValor(ctx, 'status', issue.status, esperado)
    case 'issuetype':
    case 'type':
      return casaValor(ctx, 'issuetype', issue.type, esperado)
    case 'priority':
      return casaValor(ctx, 'priority', issue.priority, esperado)
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
    return casaIgual(issue, nodo.campo, esperado, ctx)
  }
  if (nodo.clase === 'fecha') return casaFecha(issue, nodo)
  if (nodo.clase === 'claves') return nodo.claves.includes(String(issue.key).toUpperCase())
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
 * @param {{user?:string, catalog?:object}} ctx quién es `currentUser()` y el
 *        catálogo de valores de campo (`fieldCatalog`), que es lo que permite
 *        preguntar por id y rechazar un nombre traducido; sin él, como antes de H14
 * @returns {{ok:true, issues:Array}|{ok:false, errorMessages:string[]}}
 */
export function runJql(issues, jql, { user = '', catalog = null } = {}) {
  const lista = Array.isArray(issues) ? issues : []
  const p = parseJql(jql)
  if (!p.ok) return p
  // Jira valida los valores contra el campo ANTES de ejecutar nada: un nombre
  // traducido es un 400, no una lista vacía.
  const rechazo = valorNoAdmitido(p.filtro, catalog)
  if (rechazo) return error(rechazo)
  // Y valida las claves de `issuekey in (…)`: una que no existe es un 400 con
  // UN mensaje por clave (visto en el Jira DC de Marco, 2026-09-27).
  const ausentes = clavesAusentes(p.filtro, new Set(lista.map((x) => String(x.key).toUpperCase())))
  if (ausentes.length) return { ok: false, errorMessages: ausentes }
  const clave = buscarLinked(p.filtro)
  const contexto = { user, catalogo: catalog, enlazadas: clave ? enlazadas(lista, clave) : new Set() }
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

/** Los mensajes de Jira por cada clave de una lista `in (…)` que no está. */
function clavesAusentes(nodo, existen) {
  if (!nodo) return []
  if (nodo.clase === 'and' || nodo.clase === 'or') return [...clavesAusentes(nodo.izq, existen), ...clavesAusentes(nodo.der, existen)]
  if (nodo.clase !== 'claves') return []
  return nodo.claves.filter((k) => !existen.has(k)).map((k) => `An issue with key '${k}' does not exist for field '${nodo.campo}'.`)
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
 *
 * El tipo, el estado y la prioridad van con su `id` y con el nombre que VE el
 * usuario, que es lo que hace la API de verdad: si Jira traduce ese valor, el
 * nombre llega traducido y el id es lo único que sirve para volver a preguntar
 * por él (H14). Sin `catalog` el id va vacío y el nombre es el de la fixture.
 *
 * `issuelinks` (H25) sale de `enlaces` = `{tipos, lista, issues}` (el
 * `linkTypes`, el `issueLinks` y las incidencias de la fixture); sin él, pedido,
 * es una lista vacía, que es lo que da Jira a una incidencia sin relaciones.
 */
export function issueJson(issue, campos, { people = {}, now = Date.now(), catalog = null, enlaces = null } = {}) {
  const pedidos = new Set((campos && campos.length ? campos : CAMPOS_POR_DEFECTO).map((c) => String(c).trim()))
  const fields = {}
  const pon = (nombre, valor) => {
    if (pedidos.has(nombre)) fields[nombre] = valor
  }
  const tipo = fieldValue(catalog, 'issuetype', issue.type)
  const estado = fieldValue(catalog, 'status', issue.status)
  const prioridad = fieldValue(catalog, 'priority', issue.priority)
  pon('summary', issue.summary)
  pon('issuetype', { id: tipo.id, name: tipo.name, subtask: false })
  pon('status', { id: estado.id, name: estado.name, statusCategory: { key: issue.statusCategory, name: issue.statusCategory } })
  pon('priority', { id: prioridad.id, name: prioridad.name })
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
  if (pedidos.has('issuelinks')) fields.issuelinks = relacionesDe(issue.key, enlaces, catalog)
  return { id: idDe(issue.key), key: issue.key, fields }
}

/**
 * Las relaciones de una incidencia con la forma de `fields.issuelinks` de la API
 * v2 (H25): donde es `from` la otra va en `outwardIssue`, donde es `to` en
 * `inwardIssue`, en el orden de `issueLinks`. De la otra incidencia viaja lo
 * que da Jira ahí —resumen, estado y tipo—, sin personas. Una relación con un
 * tipo o un extremo que la fixture no tiene no sale (la fixture no la tiene:
 * lo pina serve-harness.test.js).
 */
function relacionesDe(key, enlaces, catalog) {
  const tipos = enlaces?.tipos || {}
  const lista = Array.isArray(enlaces?.lista) ? enlaces.lista : []
  const issues = Array.isArray(enlaces?.issues) ? enlaces.issues : []
  const out = []
  for (const l of lista) {
    const lado = l.from === key ? 'outwardIssue' : l.to === key ? 'inwardIssue' : ''
    if (!lado || !Object.hasOwn(tipos, l.type)) continue
    const otra = issues.find((x) => x.key === (lado === 'outwardIssue' ? l.to : l.from))
    if (!otra) continue
    const t = tipos[l.type]
    const suya = issueJson(otra, ['summary', 'status', 'issuetype'], { catalog })
    out.push({
      id: String(l.id),
      type: { id: String(t.id), name: l.type, inward: t.inward, outward: t.outward },
      [lado]: { id: suya.id, key: suya.key, fields: suya.fields },
    })
  }
  return out
}

/**
 * La respuesta entera de `GET /rest/api/2/search`, o el 400 con sus
 * `errorMessages`. Pura (el reloj se inyecta).
 *
 * @returns {{status:200, body:object}|{status:400, body:{errorMessages:string[], errors:object}}}
 */
export function searchResponse(fixture, { jql, fields, maxResults, startAt, now = Date.now() } = {}) {
  const issues = fixture?.issues || []
  const catalog = fieldCatalog(fixture)
  const r = runJql(issues, jql, { user: fixture?.currentUser?.name || '', catalog })
  if (!r.ok) return { status: 400, body: { errorMessages: r.errorMessages, errors: {} } }
  const tope = Number.isInteger(Number(maxResults)) && Number(maxResults) > 0 ? Math.min(Number(maxResults), 100) : 50
  const desde = Number.isInteger(Number(startAt)) && Number(startAt) > 0 ? Number(startAt) : 0
  const campos = String(fields || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  const enlaces = { tipos: fixture?.linkTypes, lista: fixture?.issueLinks, issues }
  return {
    status: 200,
    body: {
      expand: 'schema,names',
      startAt: desde,
      maxResults: tope,
      total: r.issues.length,
      issues: r.issues.slice(desde, desde + tope).map((issue) => issueJson(issue, campos, { people: fixture?.people, now, catalog, enlaces })),
    },
  }
}
