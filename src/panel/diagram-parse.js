/**
 * Un diagrama de flujo del chat: del texto Mermaid que escribe el modelo a una
 * forma interna validada, y de vuelta a Mermaid.
 *
 * POR QUÉ EXISTE (H24; docs/PLAN2.md §3.5 y docs/plan/anexo-2-E-diagramas.md):
 * el equipo pidió ver el flujo entre las incidencias de una respuesta —quién
 * depende de quién y dónde está lo que falla— y no leerlo en prosa. Mermaid de
 * verdad pesa 3,57 MB, devuelve el SVG como CADENA pensada para `innerHTML`
 * (§9 lo prohíbe), lleva 19 `innerHTML` y DOMPurify dentro y tiene CVE de XSS en
 * 2025 y 2026; los MCP de Excalidraw no pintan en el panel. Pero los modelos
 * escriben Mermaid `flowchart` con soltura, así que Faro lee un SUBCONJUNTO de
 * ese lenguaje con un parser propio y lo pinta él (diagram-layout.js y
 * diagram-view.js).
 *
 * Todo lo que llega aquí es contenido del modelo (§8.12): se lee, nunca se
 * interpreta. Lo que en Mermaid ejecuta o carga algo —`click`, `href`,
 * `callback`, `style`, `classDef`, `linkStyle`, las directivas `%%{…}%%`— se
 * RECHAZA con su motivo; una etiqueta `<img onerror=…>` o `javascript:` es un
 * texto de una línea como cualquier otro; la forma interna se reconstruye con
 * claves blancas (`validateDiagram`); `ref` sale sólo de `validIssueKey` y
 * `kind` sólo de `NOTE_KINDS`. Un nodo no navega por sí mismo: la navegación la
 * decide el panel AL HACER CLIC, por `validatePlan` (§8.3).
 *
 * Puro: no toca DOM ni chrome; nunca lanza (lo que no se entiende es un
 * `ok: false` con el motivo en español, y el panel enseña el código de siempre).
 */
import { validIssueKey, unaLinea } from '../atlassian/site.js'
import { NOTE_KINDS, NOTE_LIMITS } from './notes.js'

export const DIAGRAM_LIMITS = Object.freeze({
  srcMax: 6000,
  nodes: 30,
  edges: 60,
  labelMax: 80,
  edgeLabelMax: 40,
  idMax: 32,
  subgraphs: 6,
  offerMinKeys: 3,
})

/** Las formas de nodo que se dibujan; cualquier otra de Mermaid se queda en `rect`. */
export const DIAGRAM_SHAPES = Object.freeze([
  'rect',
  'round',
  'stadium',
  'subroutine',
  'cylinder',
  'circle',
  'diamond',
  'hexagon',
])

const DIRECCIONES = ['TD', 'LR', 'RL', 'BT']
const ESTILOS = ['solid', 'dotted', 'thick']
const PUNTAS = ['arrow', 'none', 'cross', 'circle']

/**
 * Un id: letras, cifras y «_», con guiones SÓLO entre dos de ellos. Así `ENG-1`
 * es un id (los modelos escriben las claves tal cual, aunque Mermaid lo
 * desaconseje) y en `A-->B` el id se para antes de la flecha.
 */
const ID = '[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*'
const ID_EXACTO = new RegExp('^' + ID + '$')
const RE_ID = new RegExp(ID, 'y')

/**
 * Palabras que no pueden ser un id: las que abren una sentencia. Un nodo
 * llamado `click` saldría en «Copiar como Mermaid» como `click --> B`, que al
 * volver a leerlo es un `click`; sin esta lista la ida y vuelta no sería exacta.
 */
const RESERVADAS = [
  'end',
  'subgraph',
  'direction',
  'class',
  'classdef',
  'click',
  'href',
  'callback',
  'style',
  'linkstyle',
  'graph',
  'flowchart',
]

/** Lo que en Mermaid ejecuta, enlaza o pinta con CSS del modelo. */
const PROHIBIDAS = /^(click|href|callback|style|classDef|linkStyle)(?=\s|$)/i

/**
 * Las formas de Mermaid, las largas antes que las cortas (`((` antes que `(`).
 * `null` como cierre es «`/]` o `\]`» (paralelogramo y trapecio, que aquí son
 * rectángulos, como `>x]`).
 */
const FORMAS = [
  ['(((', ')))', 'rect'],
  ['([', '])', 'stadium'],
  ['((', '))', 'circle'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['[/', null, 'rect'],
  ['[\\', null, 'rect'],
  ['{{', '}}', 'hexagon'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rect'],
]

/** Los delimitadores con los que `toMermaid` escribe cada forma. */
const DELIMITADORES = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
}

/**
 * Las flechas, de la más específica a la más general. Una punta `x`/`o` tiene
 * que ir seguida de un espacio, de `|` o del final: en `A---oficina` la `o` es
 * del id, no una punta.
 */
const PUNTA_XO = '(?=[\\s|]|$)'
const FLECHAS = [
  [/-\.+->/y, 'dotted', 'arrow'],
  [new RegExp('-\\.+-x' + PUNTA_XO, 'y'), 'dotted', 'cross'],
  [new RegExp('-\\.+-o' + PUNTA_XO, 'y'), 'dotted', 'circle'],
  [/-\.+-/y, 'dotted', 'none'],
  [/={2,}>/y, 'thick', 'arrow'],
  [new RegExp('={2,}x' + PUNTA_XO, 'y'), 'thick', 'cross'],
  [new RegExp('={2,}o' + PUNTA_XO, 'y'), 'thick', 'circle'],
  [/={3,}/y, 'thick', 'none'],
  [/-{2,}>/y, 'solid', 'arrow'],
  [new RegExp('-{2,}x' + PUNTA_XO, 'y'), 'solid', 'cross'],
  [new RegExp('-{2,}o' + PUNTA_XO, 'y'), 'solid', 'circle'],
  [/-{3,}/y, 'solid', 'none'],
]

/** `A -- texto --> B` y sus primas `== texto ==>` y `-. texto .->`. */
const FLECHAS_CON_TEXTO = [
  [new RegExp('--\\s+(.+?)\\s+(-{2,}>|-{2,}[xo]' + PUNTA_XO + '|-{3,})', 'y'), 'solid'],
  [new RegExp('==\\s+(.+?)\\s+(={2,}>|={2,}[xo]' + PUNTA_XO + '|={3,})', 'y'), 'thick'],
  [new RegExp('-\\.\\s+(.+?)\\s+(\\.+-+>|\\.+-+[xo]' + PUNTA_XO + '|\\.+-+)', 'y'), 'dotted'],
]

const RE_CLASE = /:::([A-Za-z_][A-Za-z0-9_-]*)/y
const RE_Y = /\s*&\s*/y
const RE_ESPACIOS = /\s*/y
const RE_CABECERA = /^(flowchart|graph)(?:\s+(\S+))?$/i
const RE_SUBGRAFO = /^subgraph(?=\s|$)\s*(.*)$/
const RE_SUBGRAFO_CON_TITULO = new RegExp('^(' + ID + ')\\s*\\[(.*)\\]$')
const RE_DIRECCION = /^direction\s+(\S+)$/
const RE_CLASS = new RegExp('^class\\s+(' + ID + '(?:\\s*,\\s*' + ID + ')*)\\s+([A-Za-z_][A-Za-z0-9_-]*)$')

/** El sentido del dibujo, o '' si no es uno de los cuatro (`TB` es `TD`). */
function direccion(valor) {
  const d = typeof valor === 'string' ? valor.toUpperCase() : ''
  if (d === 'TB') return 'TD'
  return DIRECCIONES.includes(d) ? d : ''
}

function idValido(id) {
  return (
    typeof id === 'string' &&
    id.length <= DIAGRAM_LIMITS.idMax &&
    ID_EXACTO.test(id) &&
    !RESERVADAS.includes(id.toLowerCase())
  )
}

/**
 * Un texto del modelo en una línea, sin invisibles, sin comillas dobles y con
 * tope. La comilla doble pasa a simple porque «Copiar como Mermaid» escribe
 * cada etiqueta entre comillas dobles y Mermaid no admite una dentro: sin esto
 * la copia no se podría pegar ni volver a leer.
 */
function recorte(valor, max) {
  let t = unaLinea(typeof valor === 'string' ? valor : '').replace(/"/g, "'")
  if (t.length > max) {
    t = t.slice(0, max)
    const ultimo = t.charCodeAt(t.length - 1)
    // Media pareja suelta (un emoji cortado por la mitad): fuera.
    if (ultimo >= 0xd800 && ultimo <= 0xdbff) t = t.slice(0, -1)
    t = t.trim()
  }
  return t
}

/** Lo que se enseña de un trozo que no se entiende, recortado como una etiqueta. */
function fragmento(texto) {
  const t = unaLinea(texto)
  return t.length > DIAGRAM_LIMITS.labelMax ? t.slice(0, DIAGRAM_LIMITS.labelMax) + '…' : t
}

function sinComillas(texto) {
  const t = texto.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
}

function leer(re, s, i) {
  re.lastIndex = i
  return re.exec(s)
}

function saltarEspacios(s, i) {
  return i + leer(RE_ESPACIOS, s, i)[0].length
}

/**
 * Parte una línea en sentencias por `;`, pero no dentro de comillas, de
 * corchetes o de una etiqueta `|…|`: `A["uno; dos"]` es UNA sentencia.
 */
function sentencias(linea) {
  const out = []
  let actual = ''
  let comillas = false
  let profundidad = 0
  let tubo = false
  for (const c of linea) {
    if (comillas) {
      if (c === '"') comillas = false
    } else if (c === '"') comillas = true
    else if (c === '[' || c === '(' || c === '{') profundidad++
    else if (c === ']' || c === ')' || c === '}') profundidad = Math.max(0, profundidad - 1)
    else if (c === '|' && profundidad === 0) tubo = !tubo
    else if (c === ';' && profundidad === 0 && !tubo) {
      out.push(actual)
      actual = ''
      continue
    }
    actual += c
  }
  out.push(actual)
  return out.map((x) => x.trim()).filter(Boolean)
}

/** La forma que sigue a un id (sin espacio en medio, como en Mermaid), o null. */
function leerForma(s, j) {
  for (const [abre, cierra, shape] of FORMAS) {
    if (!s.startsWith(abre, j)) continue
    const k = j + abre.length
    const cierres = cierra ? [cierra] : ['/]', '\\]']
    if (s[k] === '"') {
      const fin = s.indexOf('"', k + 1)
      if (fin < 0) return null
      const tras = saltarEspacios(s, fin + 1)
      const c = cierres.find((x) => s.startsWith(x, tras))
      if (!c) return null
      return { label: s.slice(k + 1, fin), shape, j: tras + c.length }
    }
    let fin = -1
    let largo = 0
    for (const x of cierres) {
      const p = s.indexOf(x, k)
      if (p >= 0 && (fin < 0 || p < fin)) {
        fin = p
        largo = x.length
      }
    }
    if (fin < 0) return null
    return { label: s.slice(k, fin), shape, j: fin + largo }
  }
  return { label: undefined, shape: undefined, j }
}

/** Un nodo: id, forma opcional y `:::clase` opcional. */
function leerNodo(s, i) {
  const m = leer(RE_ID, s, i)
  if (!m) return null
  const id = m[0]
  if (!idValido(id)) return { error: `«${fragmento(id)}» no vale como id` }
  const forma = leerForma(s, i + id.length)
  if (!forma) return null
  let j = forma.j
  let cls
  const c = leer(RE_CLASE, s, j)
  if (c) {
    cls = c[1]
    j += c[0].length
  }
  return { id, label: forma.label, shape: forma.shape, cls, j }
}

/** `A`, o `A & B & C`. */
function leerGrupo(s, i) {
  const primero = leerNodo(s, i)
  if (!primero || primero.error) return primero
  const nodos = [primero]
  let j = primero.j
  for (;;) {
    const y = leer(RE_Y, s, j)
    if (!y) break
    const otro = leerNodo(s, j + y[0].length)
    if (!otro || otro.error) return otro
    nodos.push(otro)
    j = otro.j
  }
  return { nodos, j }
}

function puntaDe(cierre) {
  const ultimo = cierre[cierre.length - 1]
  return ultimo === '>' ? 'arrow' : ultimo === 'x' ? 'cross' : ultimo === 'o' ? 'circle' : 'none'
}

/** Una flecha con su etiqueta (`-- texto -->` o `-->|texto|`), o null. */
function leerFlecha(s, i) {
  for (const [re, style] of FLECHAS_CON_TEXTO) {
    const m = leer(re, s, i)
    if (m) return { style, arrow: puntaDe(m[2]), label: sinComillas(m[1]), j: i + m[0].length }
  }
  for (const [re, style, arrow] of FLECHAS) {
    const m = leer(re, s, i)
    if (!m) continue
    let j = i + m[0].length
    let label = ''
    const k = saltarEspacios(s, j)
    if (s[k] === '|') {
      let fin
      if (s[k + 1] === '"') {
        const cierra = s.indexOf('"', k + 2)
        if (cierra < 0) return null
        fin = saltarEspacios(s, cierra + 1)
        if (s[fin] !== '|') return null
        label = s.slice(k + 2, cierra)
      } else {
        fin = s.indexOf('|', k + 1)
        if (fin < 0) return null
        label = s.slice(k + 1, fin)
      }
      j = fin + 1
    }
    return { style, arrow, label, j }
  }
  return null
}

/**
 * Lee un bloque Mermaid `flowchart`/`graph`. Es la LECTURA, sin validar: los
 * nodos llevan `{id, label, shape, kind, sub}` en crudo (`kind` es la clase que
 * escribió el modelo, sea cual sea) y la barrera es `validateDiagram`. Se para
 * en el primer error, que nombra su línea (1-based): el panel sólo enseña uno.
 *
 * @param {string} src el texto de dentro de la valla ```mermaid
 * @returns {{ok: boolean, direction: string, nodes: object[], edges: object[], subgraphs: object[], errores: string[]}}
 */
export function parseFlowchart(src) {
  try {
    return leerFlowchart(src)
  } catch {
    return fallo(['no se ha podido leer el diagrama'])
  }
}

function fallo(errores, direction = 'TD') {
  return { ok: false, direction, nodes: [], edges: [], subgraphs: [], errores }
}

function leerFlowchart(src) {
  if (typeof src !== 'string') return fallo(['no es un flowchart'])
  if (src.length > DIAGRAM_LIMITS.srcMax) {
    return fallo([`demasiado largo: ${src.length} caracteres de tope ${DIAGRAM_LIMITS.srcMax}`])
  }
  const lineas = src.split(/\r\n|\r|\n/)
  let direction = ''
  const nodos = new Map()
  const clases = new Map()
  const aristas = []
  const subgrafos = new Map()
  let abierto = null

  const tocar = (n) => {
    let nodo = nodos.get(n.id)
    if (!nodo) {
      nodo = { id: n.id, label: n.id, shape: 'rect', kind: '', sub: '' }
      nodos.set(n.id, nodo)
    }
    if (n.label !== undefined) {
      nodo.label = n.label
      nodo.shape = n.shape
    }
    if (n.cls !== undefined) clases.set(n.id, n.cls)
    if (abierto && !nodo.sub) nodo.sub = abierto.id
  }

  const sentencia = (s, n) => {
    const prohibida = PROHIBIDAS.exec(s)
    if (prohibida) return `línea ${n}: «${prohibida[1]}» no se admite`
    const sg = RE_SUBGRAFO.exec(s)
    if (sg) {
      if (abierto) return `línea ${n}: un subgrafo dentro de otro no se admite`
      const titulo = sg[1].trim()
      let id = ''
      let label = ''
      const conTitulo = RE_SUBGRAFO_CON_TITULO.exec(titulo)
      if (conTitulo && idValido(conTitulo[1])) {
        id = conTitulo[1]
        label = sinComillas(conTitulo[2])
      } else if (idValido(titulo)) {
        id = titulo
        label = titulo
      } else {
        label = sinComillas(conTitulo ? conTitulo[2] : titulo)
        for (let k = 1; !id; k++) if (!subgrafos.has('sg' + k)) id = 'sg' + k
      }
      if (!subgrafos.has(id)) subgrafos.set(id, { id, label: label || id })
      abierto = subgrafos.get(id)
      return ''
    }
    if (s === 'end') {
      if (!abierto) return `línea ${n}: sobra: «end»`
      abierto = null
      return ''
    }
    const dir = RE_DIRECCION.exec(s)
    if (dir) return abierto && direccion(dir[1]) ? '' : `línea ${n}: sobra: «${fragmento(s)}»`
    const cl = RE_CLASS.exec(s)
    if (cl) {
      for (const id of cl[1].split(',')) clases.set(id.trim(), cl[2])
      return ''
    }
    // Una cadena: grupo (flecha grupo)*
    let grupo = leerGrupo(s, 0)
    if (grupo?.error) return `línea ${n}: ${grupo.error}`
    if (!grupo) return `línea ${n}: sobra: «${fragmento(s)}»`
    grupo.nodos.forEach(tocar)
    let i = grupo.j
    for (;;) {
      const k = saltarEspacios(s, i)
      if (k >= s.length) return ''
      const flecha = leerFlecha(s, k)
      const siguiente = flecha ? leerGrupo(s, saltarEspacios(s, flecha.j)) : null
      if (siguiente?.error) return `línea ${n}: ${siguiente.error}`
      if (!siguiente) return `línea ${n}: sobra: «${fragmento(s.slice(k))}»`
      siguiente.nodos.forEach(tocar)
      for (const a of grupo.nodos) {
        for (const b of siguiente.nodos) {
          aristas.push({ from: a.id, to: b.id, label: flecha.label, style: flecha.style, arrow: flecha.arrow })
        }
      }
      grupo = siguiente
      i = siguiente.j
    }
  }

  for (let li = 0; li < lineas.length; li++) {
    const n = li + 1
    const linea = unaLinea(lineas[li])
    if (!linea) continue
    if (linea.startsWith('%%{')) return fallo([`línea ${n}: las directivas «%%{…}%%» no se admiten`])
    if (linea.startsWith('%%')) continue
    const partes = sentencias(linea)
    let desde = 0
    if (!direction) {
      const cab = RE_CABECERA.exec(partes[0] || '')
      const dir = cab ? (cab[2] === undefined ? 'TD' : direccion(cab[2])) : ''
      if (!dir) return fallo([`línea ${n}: no es un flowchart`])
      direction = dir
      desde = 1
    }
    for (const s of partes.slice(desde)) {
      const error = sentencia(s, n)
      if (error) return fallo([error], direction)
    }
  }
  if (!direction) return fallo(['no es un flowchart'])

  const lista = [...nodos.values()]
  for (const nodo of lista) if (clases.has(nodo.id)) nodo.kind = clases.get(nodo.id)
  const topes = []
  if (lista.length > DIAGRAM_LIMITS.nodes) topes.push(`demasiados nodos: ${lista.length} de tope ${DIAGRAM_LIMITS.nodes}`)
  if (aristas.length > DIAGRAM_LIMITS.edges) {
    topes.push(`demasiadas aristas: ${aristas.length} de tope ${DIAGRAM_LIMITS.edges}`)
  }
  if (subgrafos.size > DIAGRAM_LIMITS.subgraphs) {
    topes.push(`demasiados subgrafos: ${subgrafos.size} de tope ${DIAGRAM_LIMITS.subgraphs}`)
  }
  if (topes.length) return fallo(topes, direction)
  const subgraphs = [...subgrafos.values()].map((s) => ({
    id: s.id,
    label: s.label,
    nodes: lista.filter((x) => x.sub === s.id).map((x) => x.id),
  }))
  return { ok: true, direction, nodes: lista, edges: aristas, subgraphs, errores: [] }
}

/** La primera palabra de la etiqueta, si es una clave de incidencia («ENG-7» o «ENG-7:»). */
function referencia(label) {
  const primera = label.split(' ')[0].replace(/[.,:;]+$/, '')
  const clave = validIssueKey(primera)
  return clave ? { kind: 'jira-issue', id: clave } : null
}

/** El número del primer «[n]» de la etiqueta, si es una observación posible; si no, 0. */
function numeroDeNota(label) {
  const m = /\[(\d+)\]/.exec(label)
  if (!m) return 0
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 1 && n <= NOTE_LIMITS.max ? n : 0
}

/**
 * La barrera: reconstruye el diagrama con claves blancas y en este orden
 * (`{ok, direction, nodes, edges, subgraphs, errores}`), con los topes de
 * `DIAGRAM_LIMITS`. Idempotente: validar lo validado da lo mismo.
 *
 * @param {object} raw lo que devuelve `parseFlowchart`, o cualquier cosa
 * @returns {{ok: boolean, direction: string, nodes: object[], edges: object[], subgraphs: object[], errores: string[]}}
 */
export function validateDiagram(raw) {
  try {
    return validar(raw)
  } catch {
    return fallo(['no se ha podido leer el diagrama'])
  }
}

function validar(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallo(['no es un diagrama'])
  const direction = direccion(raw.direction) || 'TD'
  const previos = (Array.isArray(raw.errores) ? raw.errores : [])
    .filter((e) => typeof e === 'string')
    .map((e) => unaLinea(e))
    .filter(Boolean)
  if (raw.ok === false || previos.length) {
    return fallo(previos.length ? previos : ['no se ha podido leer el diagrama'], direction)
  }
  const nodosCrudos = Array.isArray(raw.nodes) ? raw.nodes : []
  const aristasCrudas = Array.isArray(raw.edges) ? raw.edges : []
  const subgrafosCrudos = Array.isArray(raw.subgraphs) ? raw.subgraphs : []
  const topes = []
  if (nodosCrudos.length > DIAGRAM_LIMITS.nodes) {
    topes.push(`demasiados nodos: ${nodosCrudos.length} de tope ${DIAGRAM_LIMITS.nodes}`)
  }
  if (aristasCrudas.length > DIAGRAM_LIMITS.edges) {
    topes.push(`demasiadas aristas: ${aristasCrudas.length} de tope ${DIAGRAM_LIMITS.edges}`)
  }
  if (subgrafosCrudos.length > DIAGRAM_LIMITS.subgraphs) {
    topes.push(`demasiados subgrafos: ${subgrafosCrudos.length} de tope ${DIAGRAM_LIMITS.subgraphs}`)
  }
  if (topes.length) return fallo(topes, direction)

  const candidatos = []
  for (const s of subgrafosCrudos) {
    if (!s || !idValido(s.id) || candidatos.some((c) => c.id === s.id)) continue
    candidatos.push({ id: s.id, label: recorte(s.label, DIAGRAM_LIMITS.labelMax) || s.id })
  }
  const nodes = []
  for (const n of nodosCrudos) {
    if (!n || !idValido(n.id) || nodes.some((x) => x.id === n.id)) continue
    const label = recorte(n.label, DIAGRAM_LIMITS.labelMax) || n.id
    nodes.push({
      id: n.id,
      label,
      shape: DIAGRAM_SHAPES.includes(n.shape) ? n.shape : 'rect',
      kind: typeof n.kind === 'string' && NOTE_KINDS.includes(n.kind) ? n.kind : '',
      ref: referencia(label),
      note: numeroDeNota(label),
      sub: candidatos.some((c) => c.id === n.sub) ? n.sub : '',
    })
  }
  // Un subgrafo sin nodos no tiene caja que dibujar: fuera.
  const subgraphs = candidatos
    .map((c) => ({ id: c.id, label: c.label, nodes: nodes.filter((x) => x.sub === c.id).map((x) => x.id) }))
    .filter((s) => s.nodes.length)
  const ids = new Set(nodes.map((x) => x.id))
  const edges = []
  for (const e of aristasCrudas) {
    if (!e || !ids.has(e.from) || !ids.has(e.to)) continue
    edges.push({
      from: e.from,
      to: e.to,
      label: recorte(e.label, DIAGRAM_LIMITS.edgeLabelMax),
      style: ESTILOS.includes(e.style) ? e.style : 'solid',
      arrow: PUNTAS.includes(e.arrow) ? e.arrow : 'arrow',
    })
  }
  if (nodes.length < 2) return fallo(['menos de dos nodos'], direction)
  return { ok: true, direction, nodes, edges, subgraphs, errores: [] }
}

/** Lo que llama el panel: leer y validar. */
export function readFlowchart(src) {
  return validateDiagram(parseFlowchart(src))
}

const OPERADORES = {
  solid: { arrow: '-->', none: '---', cross: '--x', circle: '--o' },
  dotted: { arrow: '-.->', none: '-.-', cross: '-.-x', circle: '-.-o' },
  thick: { arrow: '==>', none: '===', cross: '==x', circle: '==o' },
}

/**
 * El diagrama en Mermaid canónico, para «Copiar como Mermaid» (se pega en
 * Confluence, en GitHub o en Excalidraw, que lo importa). Primero todos los
 * nodos en su orden, luego los subgrafos con sus miembros y al final las
 * aristas, todas las etiquetas entre comillas: `readFlowchart(toMermaid(d))` es
 * EXACTAMENTE `d` (pinado).
 *
 * @param {object} diagram un diagrama con `ok: true`
 * @returns {string} el texto, o '' si no es un diagrama válido
 */
export function toMermaid(diagram) {
  const d = validateDiagram(diagram)
  if (!d.ok) return ''
  const out = [`flowchart ${d.direction}`]
  for (const n of d.nodes) {
    const [abre, cierra] = DELIMITADORES[n.shape]
    out.push(`  ${n.id}${abre}"${n.label}"${cierra}${n.kind ? ':::' + n.kind : ''}`)
  }
  for (const s of d.subgraphs) {
    out.push(`  subgraph ${s.id} ["${s.label}"]`)
    for (const id of s.nodes) out.push(`    ${id}`)
    out.push('  end')
  }
  for (const e of d.edges) {
    out.push(`  ${e.from} ${OPERADORES[e.style][e.arrow]}${e.label ? `|"${e.label}"|` : ''} ${e.to}`)
  }
  return out.join('\n')
}

/**
 * Las claves de incidencia DISTINTAS que cita un texto, en orden de aparición.
 * El panel la usa para decidir si ofrece «Dibujar el flujo»; nunca para navegar.
 *
 * @param {string} text la respuesta del modelo
 * @returns {string[]}
 */
export function citedIssueKeys(text) {
  if (typeof text !== 'string') return []
  const out = []
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{0,19}-\d{1,9}\b/g)) {
    const clave = validIssueKey(m[0])
    if (clave && !out.includes(clave)) out.push(clave)
  }
  return out
}
