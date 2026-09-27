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
 * interpreta. Lo que en Mermaid navega o ejecuta algo —`click`, `href` y
 * `callback` (§8.3: el modelo no emite URLs ni acciones) y las directivas
 * `%%{…}%%`— se RECHAZA con su motivo y su línea. Las líneas de PRESENTACIÓN
 * —`classDef`, `style` y `linkStyle`— se IGNORAN, sin aplicarlas y sin error
 * (H26). Hasta H26 también se rechazaban, y en el turno real del 2026-09-27
 * («Dibujar el flujo» con github-copilot/gpt-5.6-luna y el `system` del panel)
 * el modelo escribió un nodo `:::riesgo` y, por costumbre, debajo
 * `classDef riesgo fill:#fdd,stroke:#c00`: esa línea tumbaba el diagrama
 * ENTERO y el panel enseñaba el código. Ignorarlas es tan seguro como
 * rechazarlas: de ellas no sale nada —ni a un nodo, ni a una clase CSS, ni a un
 * atributo; la vista sólo conoce las cinco clases de `NOTE_KINDS`, por
 * `:::kind` o por `class A kind`— y el diagrama se lee igual que si no
 * estuvieran. Una etiqueta `<img onerror=…>` o `javascript:` es un
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

/** Lo que en Mermaid navega o ejecuta: se rechaza con su línea (§8.3). */
const PROHIBIDAS = /^(click|href|callback)(?=\s|$)/i

/**
 * Lo que en Mermaid sólo pinta con CSS del modelo: la sentencia entera se
 * IGNORA sin aplicarla (H26: un `classDef` junto a su `:::riesgo` tumbaba el
 * diagrama del turno real). Decide la primera palabra, como en `PROHIBIDAS`;
 * `styleA --> B` es una arista de un nodo llamado así.
 */
const PRESENTACION = /^(classDef|style|linkStyle)(?=\s|$)/i

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
 *
 * El salto `<br/>` de Mermaid es un espacio, y las entidades `#quot;` y `#35;`
 * se deshacen (revisión adversaria de H24, D06): los modelos escriben
 * `ENG-1<br/>Épica`, y con el `<br/>` literal la primera palabra ya no era una
 * clave y el nodo no se podía pulsar. Se deshacen DESPUÉS de quitar invisibles
 * (un `<br>` con un espacio de anchura cero en medio también es un salto) y en
 * bucle hasta que no quede ninguno (`<br<br>>` deja otro `<br>`), con otro
 * `unaLinea` al final para juntar los espacios: si no, la copia se volvería a
 * leer distinta. `#quot;` pasa a `'` y no a `"` por lo mismo que la comilla
 * doble de arriba.
 */
const SALTOS_Y_ENTIDADES = [[/<br\s*\/?>/gi, ' '], [/#quot;/g, "'"], [/#35;/g, '#']]

function recorte(valor, max) {
  let t = unaLinea(typeof valor === 'string' ? valor : '').replace(/"/g, "'")
  // Cada vuelta acorta el texto o lo deja igual: el bucle termina siempre.
  for (let antes = null; antes !== t; ) {
    antes = t
    for (const [re, por] of SALTOS_Y_ENTIDADES) t = t.replace(re, por)
  }
  t = unaLinea(t)
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

/** La punta de la izquierda de una flecha doble y la que tiene que cerrarla. */
const PUNTA_IZQUIERDA = { '<': 'arrow', x: 'cross', o: 'circle' }

/**
 * Una flecha, simple o de doble punta (revisión adversaria de H24, D07).
 * `A <--> B`, `A <-- texto --> B`, `<-.->`, `<==>`, `o--o` y `x--x` son
 * Mermaid válido y los modelos los escriben (el diagrama del README lleva uno):
 * antes tumbaban el diagrama entero con «sobra». Se leen como una línea SIN
 * punta (`none`), porque dibujar una sola inventaría un sentido que el modelo
 * no dijo, y `PUNTAS` no cambia (`toMermaid` escribe `---` y la ida y vuelta
 * sigue exacta). La punta de la izquierda tiene que casar con la de la derecha
 * (`<--x` no es nada), y una `x`/`o` sólo es punta detrás de un espacio: en
 * `Ao--oB` es del id.
 */
function leerFlecha(s, i) {
  const izquierda = Object.hasOwn(PUNTA_IZQUIERDA, s[i]) ? PUNTA_IZQUIERDA[s[i]] : ''
  if (izquierda && (s[i] === '<' || /\s/.test(s[i - 1] ?? ''))) {
    const f = leerFlechaSimple(s, i + 1)
    if (f && f.arrow === izquierda) return { ...f, arrow: 'none' }
    if (s[i] === '<') return null
  }
  return leerFlechaSimple(s, i)
}

/** Una flecha con su etiqueta (`-- texto -->` o `-->|texto|`), o null. */
function leerFlechaSimple(s, i) {
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
 * Las sentencias `classDef`, `style` y `linkStyle` no dejan rastro en lo leído
 * (H26): se saltan como un comentario.
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

  // Un subgrafo sin id propio («subgraph Lote uno») lleva uno PROVISIONAL, que
  // no es un id válido y no choca con nada; el `sgK` de verdad se le pone al
  // final, saltándose los ids de nodos y subgrafos que escribió el modelo: un
  // `subgraph sg1` explícito ya no reabre el de «Lote uno» ni le mete nodos
  // ajenos (revisión adversaria de H24, D07).
  let provisionales = 0

  const tocar = (n) => {
    // Mermaid une una arista a la CAJA de un subgrafo; aquí no hay aristas a
    // cajas, y sin esto salía un nodo «S» fantasma fuera de la caja (D07). Se
    // rechaza con su línea; nunca se redirige a un nodo de dentro, que sería
    // dibujar una arista que el modelo no escribió.
    if (subgrafos.has(n.id)) return `«${fragmento(n.id)}» es un subgrafo y no puede ser un nodo`
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
    return ''
  }
  const tocarTodos = (miembros, n) => {
    for (const x of miembros) {
      const error = tocar(x)
      if (error) return `línea ${n}: ${error}`
    }
    return ''
  }

  const sentencia = (s, n) => {
    const prohibida = PROHIBIDAS.exec(s)
    if (prohibida) return `línea ${n}: «${prohibida[1]}» no se admite`
    if (PRESENTACION.test(s)) return ''
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
        id = ' ' + ++provisionales
      }
      if (!id.startsWith(' ') && nodos.has(id)) return `línea ${n}: «${fragmento(id)}» es un nodo y no puede ser un subgrafo`
      if (!subgrafos.has(id)) subgrafos.set(id, { id, label: label || (id.startsWith(' ') ? '' : id) })
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
    const e1 = tocarTodos(grupo.nodos, n)
    if (e1) return e1
    let i = grupo.j
    for (;;) {
      const k = saltarEspacios(s, i)
      if (k >= s.length) return ''
      const flecha = leerFlecha(s, k)
      const siguiente = flecha ? leerGrupo(s, saltarEspacios(s, flecha.j)) : null
      if (siguiente?.error) return `línea ${n}: ${siguiente.error}`
      if (!siguiente) return `línea ${n}: sobra: «${fragmento(s.slice(k))}»`
      const e2 = tocarTodos(siguiente.nodos, n)
      if (e2) return e2
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
  // Los ids provisionales toman, en orden de aparición, el primer `sgK` libre
  // DESPUÉS de leer todos los ids explícitos, de nodos y de subgrafos (D07).
  const usados = new Set([...nodos.keys(), ...subgrafos.keys()])
  let k = 0
  for (const s of subgrafos.values()) {
    if (!s.id.startsWith(' ')) continue
    const provisional = s.id
    do k++
    while (usados.has('sg' + k))
    s.id = 'sg' + k
    usados.add(s.id)
    if (!s.label) s.label = s.id
    for (const nodo of lista) if (nodo.sub === provisional) nodo.sub = s.id
  }
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

/*
 * Cada campo se lee UNA vez, en una constante, y se valida y se copia esa
 * constante (revisión adversaria de H24, D16): con dos lecturas, un getter que
 * da 'A' a la primera y otra cosa a la segunda salía de la barrera sin validar,
 * y la barrera dejaba de ser idempotente. Hoy sólo con objetos hechos a mano
 * (el parser da objetos planos), pero la barrera promete «cualquier cosa».
 */
function validar(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallo(['no es un diagrama'])
  const { ok, direction: dir, nodes: rn, edges: re, subgraphs: rs, errores: rerr } = raw
  const direction = direccion(dir) || 'TD'
  const previos = (Array.isArray(rerr) ? rerr : [])
    .filter((e) => typeof e === 'string')
    .map((e) => unaLinea(e))
    .filter(Boolean)
  if (ok === false || previos.length) {
    return fallo(previos.length ? previos : ['no se ha podido leer el diagrama'], direction)
  }
  const nodosCrudos = Array.isArray(rn) ? rn : []
  const aristasCrudas = Array.isArray(re) ? re : []
  const subgrafosCrudos = Array.isArray(rs) ? rs : []
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
    const id = s ? s.id : undefined
    if (!idValido(id) || candidatos.some((c) => c.id === id)) continue
    candidatos.push({ id, label: recorte(s.label, DIAGRAM_LIMITS.labelMax) || id })
  }
  const nodes = []
  for (const n of nodosCrudos) {
    const id = n ? n.id : undefined
    if (!idValido(id) || nodes.some((x) => x.id === id)) continue
    const label = recorte(n.label, DIAGRAM_LIMITS.labelMax) || id
    const { shape, kind, sub } = n
    nodes.push({
      id,
      label,
      shape: DIAGRAM_SHAPES.includes(shape) ? shape : 'rect',
      kind: typeof kind === 'string' && NOTE_KINDS.includes(kind) ? kind : '',
      ref: referencia(label),
      note: numeroDeNota(label),
      sub: candidatos.some((c) => c.id === sub) ? sub : '',
    })
  }
  // Un subgrafo sin nodos no tiene caja que dibujar: fuera.
  const subgraphs = candidatos
    .map((c) => ({ id: c.id, label: c.label, nodes: nodes.filter((x) => x.sub === c.id).map((x) => x.id) }))
    .filter((s) => s.nodes.length)
  const ids = new Set(nodes.map((x) => x.id))
  const edges = []
  for (const e of aristasCrudas) {
    if (!e) continue
    const { from, to, style, arrow } = e
    if (!ids.has(from) || !ids.has(to)) continue
    edges.push({
      from,
      to,
      label: recorte(e.label, DIAGRAM_LIMITS.edgeLabelMax),
      style: ESTILOS.includes(style) ? style : 'solid',
      arrow: PUNTAS.includes(arrow) ? arrow : 'arrow',
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
 * EXACTAMENTE `d` (pinado). La ida y vuelta es exacta sobre lo LEÍDO: las
 * líneas de presentación que se ignoraron al leer (`classDef`, `style`,
 * `linkStyle`, H26) no se reproducen, porque nunca entraron en `d`; la copia
 * sale sin ellas.
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
 * `offerDiagramKeys` la filtra por proyecto para decidir si se ofrece «Dibujar
 * el flujo»; nunca sirve para navegar.
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

/**
 * Las claves que cuentan para ofrecer «Dibujar el flujo»: las de
 * `citedIssueKeys` cuyo proyecto conoce el panel (revisión adversaria de H24,
 * D01). «UTF-8», «ISO-8601» o «SHA-256» tienen forma de clave y no son
 * incidencias, y ofrecían dibujar un flujo que no existe; la cosecha del índice
 * ya las tira por lo mismo (M4, `knownProjects` de indexer.js). Las claves de
 * dentro de un bloque de código siguen contando: las de un ```jql son
 * incidencias. Pura.
 *
 * @param {string} text la respuesta del modelo
 * @param {Set<string>|string[]} projects claves de proyecto conocidas
 * @returns {string[]}
 */
export function offerDiagramKeys(text, projects) {
  const conocidos = new Set(projects instanceof Set || Array.isArray(projects) ? projects : [])
  return citedIssueKeys(text).filter((k) => conocidos.has(k.split('-')[0]))
}
