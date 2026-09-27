/**
 * El diagrama «Según Jira»: las relaciones REALES entre las incidencias que el
 * modelo dibujó, como un segundo diagrama debajo del suyo, y la comparación
 * entre los dos.
 *
 * POR QUÉ EXISTE (H25b; docs/PLAN2.md §H25, docs/plan/handoff/h25-contrato.md
 * §2): el diagrama de H24 lo escribe el modelo, y una flecha «ENG-7 → ENG-3»
 * es lo que el modelo CREE que hay, no lo que Jira tiene. Lo que la API da
 * exacto no se le pide al modelo (§8.19): los `issuelinks` de esas incidencias
 * los lee la REST del propio sitio (`fetchIssueLinks`, jira-rest.js) y aquí se
 * convierten en un diagrama con los MISMOS nodos —mismo id y misma etiqueta,
 * para que el ojo los case— y las aristas de Jira, con su tipo («blocks»,
 * «relates to») como etiqueta. Así se ve lo que el modelo dibujó y Jira no
 * tiene, y lo que Jira tiene y el modelo no dibujó.
 *
 * La procedencia (§8.27): las claves son las de los nodos del modelo que Jira
 * DEVOLVIÓ, y Jira sólo recibe las que ya estaban en el índice (cosechadas por
 * M4 de la salida de una herramienta, nunca de la prosa; eso lo decide el
 * panel). Una clave que el modelo escribió y Jira no devolvió no entra en el
 * diagrama: va a `fuera`, por si hay que decirlo. Nada de esto vuelve a un
 * prompt: se pinta y ya (§8.19, §8.20).
 *
 * El `kind` de cada nodo se deja VACÍO a propósito: «riesgo» o «hueco» eran un
 * juicio del modelo, y este diagrama es el de Jira. `ref` y `note` los recalcula
 * `validateDiagram` de la etiqueta, que empieza por la clave: el nodo sigue
 * navegando como en el del modelo.
 *
 * Una flecha del flujo que dibuja el modelo no dice qué sentido de la relación
 * de Jira quiere decir (A → B puede ser «A bloquea a B» o «A depende de B»),
 * así que la comparación va por PARES SIN ORDEN: una flecha A → B del modelo
 * coincide con una relación B → A de Jira; el sentido de Jira se ve en su
 * diagrama (revisión adversaria de H25, D05).
 *
 * Puro: no toca DOM ni chrome; nunca lanza. Un solo import, el de la barrera
 * (`validateDiagram`) y sus topes (`DIAGRAM_LIMITS`), que tienen dueño.
 */
import { validateDiagram, DIAGRAM_LIMITS } from './diagram-parse.js'

/** El par sin orden de dos claves, como texto: «ENG-3|ENG-7» para A→B y para B→A. */
function par(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const lista = (v) => (Array.isArray(v) ? v : [])

/**
 * El diagrama de Jira y la comparación con el del modelo.
 *
 * `comparacion` = `{ comunes, soloModelo, soloJira, nodos, fuera, recortada }`:
 * - `comunes`: las relaciones de Jira `[{ from, to, type }]` (claves, en el
 *   sentido de Jira) cuyo par también dibujó el modelo;
 * - `soloModelo`: las aristas del modelo `[{ from, to, label }]` (claves, en el
 *   sentido del modelo) entre dos incidencias del conjunto sin par en Jira;
 * - `soloJira`: las relaciones de Jira `[{ from, to, type }]` sin par en el
 *   modelo;
 * - `nodos`: cuántas incidencias entran (las del modelo que Jira devolvió);
 * - `fuera`: las claves del modelo que Jira NO devolvió (sin índice, sin
 *   permiso o que Jira no reconoce), en el orden del modelo;
 * - `recortada`: la lista de Jira no entró entera (`truncated` de
 *   `fetchIssueLinks`, o el tope de aristas del diagrama): entonces
 *   `soloModelo` va vacío, porque «Jira no lo tiene» no se puede afirmar de lo
 *   que no cupo, y el resumen dice «al menos» (revisión adversaria de H25, D04).
 * `comunes.length + soloJira.length` son las aristas del diagrama.
 *
 * @param {object} modelDiagram el diagrama del modelo (`readFlowchart`)
 * @param {{nodes?: object[], links?: object[], truncated?: boolean}} result lo que devuelve `fetchIssueLinks`
 * @returns {{diagram: object|null, comparacion: object}} `diagram` ya validado (`ok: true`), o null con menos de dos incidencias
 */
export function jiraDiagram(modelDiagram, result) {
  const modelo = validateDiagram(modelDiagram)
  const nodosDelModelo = modelo.ok ? modelo.nodes : []
  const devueltas = new Set(
    lista(result?.nodes)
      .map((n) => n?.key)
      .filter((k) => typeof k === 'string')
  )

  // Las claves del conjunto, en el orden del modelo: el primer nodo de cada una
  // pone el id; un segundo nodo con la misma clave cuenta para la comparación.
  const idDe = new Map()
  const claveDe = new Map()
  const nodos = []
  const fuera = []
  for (const n of nodosDelModelo) {
    if (n.ref?.kind !== 'jira-issue') continue
    const clave = n.ref.id
    if (!devueltas.has(clave)) {
      if (!fuera.includes(clave)) fuera.push(clave)
      continue
    }
    claveDe.set(n.id, clave)
    if (idDe.has(clave)) continue
    idDe.set(clave, n.id)
    nodos.push({ id: n.id, label: n.label, shape: 'rect', kind: '', ref: n.ref, note: 0, sub: '' })
  }

  // Las relaciones de Jira entre dos claves del conjunto, sin repetir la misma
  // (mismo sentido y mismo tipo) y con el tope de aristas: dos relaciones de
  // tipo distinto entre los mismos nodos son dos aristas (el layout las separa).
  // El tope va DETRÁS del dedupe: sólo una relación válida y nueva que no cabe
  // es un recorte, y lo dice `recortada`.
  const aristas = []
  const vistas = new Set()
  let recortada = result?.truncated === true
  for (const link of lista(result?.links)) {
    const from = link?.from
    const to = link?.to
    if (!idDe.has(from) || !idDe.has(to) || from === to) continue
    const type = typeof link.type === 'string' ? link.type : ''
    const firma = `${from}|${to}|${type}`
    if (vistas.has(firma)) continue
    vistas.add(firma)
    if (aristas.length >= DIAGRAM_LIMITS.edges) {
      recortada = true
      continue
    }
    aristas.push({ from: idDe.get(from), to: idDe.get(to), label: type, style: 'solid', arrow: 'arrow' })
  }

  let diagram = null
  if (nodos.length >= 2) {
    const d = validateDiagram({
      ok: true,
      direction: modelo.direction,
      nodes: nodos,
      edges: aristas,
      subgraphs: [],
      errores: [],
    })
    if (d.ok) diagram = d
  }

  // La comparación sale del diagrama YA validado: el tipo que se cuenta es la
  // etiqueta recortada y limpia que se pinta, no la de la respuesta.
  const claveDeId = new Map([...idDe].map(([clave, id]) => [id, clave]))
  const jira = (diagram ? diagram.edges : []).map((e) => ({
    from: claveDeId.get(e.from),
    to: claveDeId.get(e.to),
    type: e.label,
  }))
  const paresDeJira = new Set(jira.map((r) => par(r.from, r.to)))
  const paresDelModelo = new Set()
  const soloModelo = []
  const yaDichas = new Set()
  for (const e of modelo.ok ? modelo.edges : []) {
    const from = claveDe.get(e.from)
    const to = claveDe.get(e.to)
    if (!from || !to || from === to) continue
    const p = par(from, to)
    paresDelModelo.add(p)
    // Con la lista de Jira recortada, «Jira no lo tiene» no se puede afirmar.
    if (recortada || paresDeJira.has(p) || yaDichas.has(`${p}|${e.label}`)) continue
    yaDichas.add(`${p}|${e.label}`)
    soloModelo.push({ from, to, label: e.label })
  }
  const comunes = jira.filter((r) => paresDelModelo.has(par(r.from, r.to)))
  const soloJira = jira.filter((r) => !paresDelModelo.has(par(r.from, r.to)))

  return { diagram, comparacion: { comunes, soloModelo, soloJira, nodos: nodos.length, fuera, recortada } }
}

/**
 * Las claves de un diagrama del modelo que se pueden mandar a Jira: las de sus
 * nodos con `ref` de incidencia que YA están en el índice (cosechadas por M4,
 * nunca de la prosa), sin repetir, en el orden del diagrama y con el tope que
 * pone quien llama (`JIRA_REST_LIMITS.linkKeys`, que tiene dueño: por eso es
 * un parámetro y no un import). Una clave que el modelo escribió y el índice
 * no tiene no sale (§8.27). Pura: la usan el panel (`clavesParaContrastar`) y
 * el tramo 66 del banco, que así ejercita la misma barrera (revisión
 * adversaria de H25, D06).
 *
 * @param {object} diagrama el del modelo (`readFlowchart`)
 * @param {{issues?: object}|null} indice el índice del sitio
 * @param {number} tope cuántas como mucho
 * @returns {string[]}
 */
export function clavesDelIndice(diagrama, indice, tope) {
  const max = Number.isInteger(tope) && tope > 0 ? tope : 0
  const claves = []
  for (const n of lista(diagrama?.nodes)) {
    if (claves.length >= max) break
    const clave = n?.ref?.kind === 'jira-issue' ? n.ref.id : ''
    if (!clave || claves.includes(clave) || !indice?.issues?.[clave]) continue
    claves.push(clave)
  }
  return claves
}

const cuantas = (n, una, varias) => `${n} ${n === 1 ? una : varias}`

/**
 * El resumen de una comparación, para el pie de la figura, el anuncio y el
 * registro: «Según Jira: 3 relaciones entre 4 incidencias · coinciden 2 ·
 * sólo el modelo 1 · sólo Jira 1». «sólo el modelo» y «sólo Jira», sólo si hay.
 * Con la lista de Jira `recortada`, «Según Jira: al menos N relaciones…».
 *
 * @param {object} comparacion la de `jiraDiagram`
 * @returns {string}
 */
export function resumenJira(comparacion) {
  const comunes = lista(comparacion?.comunes).length
  const soloModelo = lista(comparacion?.soloModelo).length
  const soloJira = lista(comparacion?.soloJira).length
  const nodos = Number.isInteger(comparacion?.nodos) && comparacion.nodos > 0 ? comparacion.nodos : 0
  const relaciones = comunes + soloJira
  const entre = cuantas(nodos, 'incidencia', 'incidencias')
  const partes = relaciones
    ? [`Según Jira: ${comparacion?.recortada === true ? 'al menos ' : ''}${cuantas(relaciones, 'relación', 'relaciones')} entre ${entre}`, `coinciden ${comunes}`]
    : [`Según Jira: sin relaciones en Jira entre ${entre}`]
  if (soloModelo) partes.push(`sólo el modelo ${soloModelo}`)
  if (soloJira) partes.push(`sólo Jira ${soloJira}`)
  return partes.join(' · ')
}
