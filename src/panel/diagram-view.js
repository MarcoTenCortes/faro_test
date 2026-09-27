/**
 * La vista de un diagrama (H24): de la forma validada (`readFlowchart`,
 * diagram-parse.js) y su colocación (`layoutDiagram`, diagram-layout.js) a un
 * `<figure class="dg-wrap">` con un SVG accesible, la lista equivalente
 * plegada («Ver como lista») y «Copiar como Mermaid».
 *
 * Por qué un SVG propio y no Mermaid (anexo 2-E, docs/PLAN2.md §3.5): Mermaid
 * pesa 3,57 MB, devuelve el SVG como CADENA pensada para `innerHTML` —lo que
 * §9 prohíbe—, lleva 19 `innerHTML` y DOMPurify dentro y tiene un historial de
 * XSS en 2025-2026. Todo lo que se pinta aquí lo escribió un modelo que acaba
 * de leer páginas que puede haber escrito cualquiera: una etiqueta puede traer
 * `<img onerror>` o `javascript:`. Por eso esta vista sólo usa una lista blanca
 * EXACTA de la API del DOM —`createElement`, `createElementNS` con el
 * namespace SVG, `createTextNode`, `appendChild`/`append`, `setAttribute`,
 * `textContent`, `className`, `dataset`, `classList.add`, `addEventListener`
 * y `focus`— y ninguna etiqueta llega jamás a un atributo: van como TEXTO.
 * `diagram-view.test.js` lo pina con un `document` mínimo que LANZA si alguien
 * toca `innerHTML` o asigna algo fuera de esa lista.
 *
 * La navegabilidad NO se decide aquí (§8.3): un nodo con `ref` es un botón que
 * llama a `onOpen(ref, figure)`, y es el panel quien valida la clave contra el
 * índice de ESE momento al hacer clic (`validatePlan` + `runPlan('direct')`).
 * Una insignia `[n]` sólo se pinta si esa observación existe (`notes`).
 *
 * Sin imports: recibe todo por parámetros (ni panel.js ni un módulo con
 * estado). DOM, pero no toca `document` al importarse (§9). Las medidas de las
 * figuras van como ATRIBUTOS del SVG, no en el CSS (sólo px de la escala ahí).
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Las medidas de la vista, las que no da el layout. `lineH` y `charW` son las
 * de `LAYOUT_LIMITS` (diagram-layout.js): se repiten aquí porque la vista no
 * importa nada, y lo que las une es que el layout mide con el MISMO
 * `textMeasurer` de aquí (la estimación de 6,6 px/carácter sólo sale sin
 * canvas, en Node).
 */
const VIEW_LIMITS = Object.freeze({
  lineH: 16,
  charW: 6.6,
  rectR: 4,
  roundR: 10,
  subroutineInset: 6,
  cylinderLid: 12,
  subR: 6,
  subLabelX: 6,
  subLabelY: 14,
  noteR: 8,
  titleNodes: 6,
  marker: 8,
})

/** Las formas que la vista sabe dibujar; cualquier otra es un `rect`. */
const FIGURAS = Object.freeze({
  rect: caja,
  round: caja,
  stadium: caja,
  subroutine: cajaDoble,
  cylinder: cilindro,
  circle: elipse,
  diamond: rombo,
  hexagon: hexagono,
})

const ESTILOS = ['solid', 'dotted', 'thick']
const PUNTAS = { arrow: 'arrow', cross: 'cross', circle: 'circle' }

/**
 * El diagrama entero, listo para colgar del chat.
 *
 * @param {object} diagram  la forma de `readFlowchart` (con `ok: true`)
 * @param {object} layout   la de `layoutDiagram` (nodos y subgrafos con `x`/`y` en su esquina superior izquierda)
 * @param {{onOpen?:Function, onNote?:Function, onCopy?:Function, notes?:Set<number>, mermaid?:string, uid?:string}} opts
 *        `onOpen(ref, figure)` al pulsar un nodo con clave; `onNote(n)` al
 *        pulsar su insignia (sólo si `notes.has(n)`); `onCopy(texto, boton)`
 *        con el Mermaid que da quien llama (sin `mermaid`, no hay botón);
 *        `uid` distingue los ids de dos diagramas del mismo chat.
 * @returns {HTMLElement} `<figure class="dg-wrap">`
 */
export function diagramNode(diagram, layout, { onOpen, onNote, onCopy, notes = new Set(), mermaid = '', uid = 'dg' } = {}) {
  const d = diagram && typeof diagram === 'object' ? diagram : {}
  const l = layout && typeof layout === 'object' ? layout : {}
  const vista = {
    nodes: lista(d.nodes),
    edges: lista(d.edges),
    subgraphs: lista(d.subgraphs),
    uid: String(uid ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'dg',
    notes: notes && typeof notes.has === 'function' ? notes : new Set(),
    onOpen,
    onNote,
  }
  const figure = document.createElement('figure')
  figure.className = 'dg-wrap'
  vista.figure = figure
  figure.appendChild(dibujo(vista, l))
  figure.appendChild(listaEquivalente(vista))
  const texto = typeof mermaid === 'string' ? mermaid : ''
  if (texto) figure.appendChild(acciones(texto, onCopy))
  return figure
}

/**
 * Un medidor de texto con la fuente del panel: un `<canvas>` que nunca se
 * cuelga del documento, `ctx.font = font` y `measureText`. Sin canvas o sin
 * contexto 2d (Node, las pruebas) cae en 6,6 px por carácter, la estimación
 * del layout. El panel y el espejo lo crean una vez y se lo pasan a
 * `layoutDiagram` como `measure`: una sola medida real (§9).
 */
export function textMeasurer(font) {
  const ctx = contexto2d()
  if (!ctx) return (text) => String(text ?? '').length * VIEW_LIMITS.charW
  if (font) ctx.font = font
  return (text) => ctx.measureText(String(text ?? '')).width
}

function contexto2d() {
  try {
    if (typeof document === 'undefined' || !document) return null
    const canvas = document.createElement('canvas')
    return canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------- el SVG

function dibujo(vista, l) {
  const ancho = numero(l.width)
  const alto = numero(l.height)
  const { uid } = vista
  const raiz = svg('svg', {
    class: 'dg-svg',
    role: 'img',
    viewBox: `0 0 ${ancho} ${alto}`,
    width: ancho,
    height: alto,
    'aria-labelledby': `${uid}-t ${uid}-d`,
  })
  const titulo = svg('title', { id: `${uid}-t` })
  titulo.textContent = tituloDe(vista.nodes)
  const desc = svg('desc', { id: `${uid}-d` })
  desc.textContent = `${cuenta(vista.nodes.length, 'nodo', 'nodos')}, ${cuenta(vista.edges.length, 'arista', 'aristas')}`
  raiz.append(titulo, desc)

  const aristas = emparejarAristas(vista.edges, lista(l.edges))
  const puntas = new Set(['arrow'])
  for (const { arista } of aristas) if (PUNTAS[arista.arrow]) puntas.add(PUNTAS[arista.arrow])
  raiz.appendChild(marcadores(uid, puntas))

  // Debajo los subgrafos, luego las aristas, sus etiquetas encima de TODAS las
  // líneas, y los nodos arriba del todo (y en el orden del diagrama, que es el
  // del tabulador).
  const nombres = new Map(vista.subgraphs.map((s) => [s.id, s.label || s.id]))
  for (const s of lista(l.subgraphs)) raiz.appendChild(subgrafo(s, nombres.get(s.id) ?? s.id))
  const etiquetas = []
  for (const { arista, puntos, en } of aristas) {
    const clase = ESTILOS.includes(arista.style) ? arista.style : 'solid'
    const punta = PUNTAS[arista.arrow]
    raiz.appendChild(
      svg('path', {
        class: `dg-edge dg-edge-${clase}`,
        d: puntos.map((p, i) => `${i ? 'L' : 'M'} ${numero(p.x)} ${numero(p.y)}`).join(' '),
        'marker-end': punta ? `url(#${uid}-${punta})` : null,
      })
    )
    if (arista.label && en) {
      const t = svg('text', { class: 'dg-edge-label', x: numero(en.x), y: numero(en.y), 'text-anchor': 'middle', 'dominant-baseline': 'central' })
      t.textContent = String(arista.label)
      etiquetas.push(t)
    }
  }
  for (const t of etiquetas) raiz.appendChild(t)

  const colocados = new Map(lista(l.nodes).map((n) => [n.id, n]))
  for (const nodo of vista.nodes) {
    const sitio = colocados.get(nodo.id)
    if (sitio) raiz.appendChild(nodoSvg(nodo, sitio, ancho, alto, vista))
  }
  return raiz
}

/**
 * Cada arista del diagrama con los puntos que le dio el layout: por posición
 * si coincide `from`/`to`, y si no, la primera libre con los mismos extremos
 * (dos aristas iguales son dos entradas). Una sin puntos no se dibuja (sigue
 * en la lista equivalente).
 */
function emparejarAristas(aristas, colocadas) {
  const usadas = new Set()
  const casa = (a, c) => c && c.from === a.from && c.to === a.to && lista(c.points).length >= 2
  const out = []
  aristas.forEach((arista, i) => {
    const j = casa(arista, colocadas[i]) && !usadas.has(i) ? i : colocadas.findIndex((c, k) => !usadas.has(k) && casa(arista, c))
    if (j < 0) return
    usadas.add(j)
    const c = colocadas[j]
    const en = c.labelAt && typeof c.labelAt === 'object' ? c.labelAt : null
    out.push({ arista, puntos: c.points, en })
  })
  return out
}

function marcadores(uid, puntas) {
  const defs = svg('defs')
  const m = VIEW_LIMITS.marker
  const marcador = (nombre, refX, figura) => {
    const mk = svg('marker', {
      id: `${uid}-${nombre}`,
      viewBox: '0 0 10 10',
      refX,
      refY: 5,
      markerWidth: m,
      markerHeight: m,
      orient: 'auto-start-reverse',
    })
    mk.appendChild(figura)
    defs.appendChild(mk)
  }
  // `context-stroke`: la punta del color de SU arista (Chrome ≥ 124; el
  // mínimo de Faro es 130), sin una clase ni un color escritos aquí.
  marcador('arrow', 9, svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }))
  if (puntas.has('cross')) marcador('cross', 5, svg('path', { d: 'M 1 1 L 9 9 M 9 1 L 1 9', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.5 }))
  if (puntas.has('circle')) marcador('circle', 9, svg('circle', { cx: 5, cy: 5, r: 4, fill: 'context-stroke' }))
  return defs
}

function subgrafo(s, nombre) {
  const g = svg('g', { class: 'dg-sub' })
  const x = numero(s.x)
  const y = numero(s.y)
  g.appendChild(svg('rect', { x, y, width: numero(s.w), height: numero(s.h), rx: VIEW_LIMITS.subR }))
  const t = svg('text', { x: numero(x + VIEW_LIMITS.subLabelX), y: numero(y + VIEW_LIMITS.subLabelY) })
  t.textContent = String(nombre)
  g.appendChild(t)
  return g
}

function nodoSvg(nodo, sitio, ancho, alto, vista) {
  const forma = Object.hasOwn(FIGURAS, nodo.shape) ? nodo.shape : 'rect'
  const kind = typeof nodo.kind === 'string' && /^[a-z]{1,24}$/.test(nodo.kind) ? nodo.kind : ''
  const ref = nodo.ref && nodo.ref.kind === 'jira-issue' && typeof nodo.ref.id === 'string' && nodo.ref.id ? nodo.ref.id : ''
  // El layout da la ESQUINA superior izquierda del nodo (como la de un subgrafo y la de un
  // <rect>); las figuras trabajan con el centro, así que se deriva aquí y en ningún otro sitio.
  // Al cerrar H24 la vista tomaba x/y como el centro y cada nodo salía medio ancho a la
  // izquierda de sus aristas (docs/BITACORA.md §12.5).
  const w = numero(sitio.w)
  const h = numero(sitio.h)
  const caja = { cx: numero(numero(sitio.x) + w / 2), cy: numero(numero(sitio.y) + h / 2), w, h }

  const g = svg('g', { class: ['dg-node', `dg-${forma}`, kind && `dg-${kind}`, ref && 'dg-link'].filter(Boolean).join(' '), 'data-id': nodo.id })
  for (const figura of FIGURAS[forma](caja, forma)) g.appendChild(figura)
  g.appendChild(etiqueta(caja, lista(sitio.lines).length ? lista(sitio.lines) : [nodo.label || nodo.id]))

  if (ref) {
    g.setAttribute('tabindex', '0')
    g.setAttribute('role', 'button')
    g.setAttribute('aria-label', `Abrir ${ref}`)
    g.setAttribute('data-ref', `jira-issue:${ref}`)
    const abrir = () => {
      if (typeof vista.onOpen === 'function') vista.onOpen({ kind: 'jira-issue', id: ref }, vista.figure)
    }
    g.addEventListener('click', abrir)
    g.addEventListener('keydown', (ev) => {
      if (!esPulsar(ev)) return
      ev.preventDefault()
      abrir()
    })
  }

  const n = Number.isInteger(nodo.note) && nodo.note > 0 && vista.notes.has(nodo.note) ? nodo.note : 0
  if (n) {
    g.setAttribute('data-note', String(n))
    g.appendChild(insignia(n, caja, ancho, alto, vista.onNote))
  }
  return g
}

/**
 * La insignia de la observación, en la esquina de arriba a la derecha y
 * dentro del viewBox. Para el evento: pulsarla lleva a la marca, no abre la
 * incidencia del nodo de debajo.
 */
function insignia(n, { cx, cy, w, h }, ancho, alto, onNote) {
  const r = VIEW_LIMITS.noteR
  const x = numero(Math.max(r, Math.min(cx + w / 2, ancho - r)))
  const y = numero(Math.max(r, Math.min(cy - h / 2, alto - r)))
  const g = svg('g', { class: 'dg-note', role: 'button', tabindex: '0', 'aria-label': `Observación ${n}` })
  g.appendChild(svg('circle', { cx: x, cy: y, r }))
  const t = svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
  t.textContent = String(n)
  g.appendChild(t)
  const ir = (ev) => {
    ev.stopPropagation()
    if (typeof onNote === 'function') onNote(n)
  }
  g.addEventListener('click', ir)
  g.addEventListener('keydown', (ev) => {
    if (!esPulsar(ev)) return
    ev.preventDefault()
    ir(ev)
  })
  return g
}

/** Enter o Espacio: lo que activa un `role="button"`. */
function esPulsar(ev) {
  return ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar'
}

function etiqueta({ cx, cy }, renglones) {
  const t = svg('text', { class: 'dg-label', x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
  const arriba = cy - ((renglones.length - 1) * VIEW_LIMITS.lineH) / 2
  renglones.forEach((renglon, i) => {
    const s = svg('tspan', { x: cx, y: numero(arriba + i * VIEW_LIMITS.lineH) })
    s.textContent = String(renglon)
    t.appendChild(s)
  })
  return t
}

// Las figuras: cada una recibe la caja con el centro y devuelve sus piezas.

function caja({ cx, cy, w, h }, forma) {
  const rx = forma === 'stadium' ? h / 2 : forma === 'round' ? VIEW_LIMITS.roundR : VIEW_LIMITS.rectR
  return [svg('rect', { x: numero(cx - w / 2), y: numero(cy - h / 2), width: w, height: h, rx: numero(rx) })]
}

function cajaDoble({ cx, cy, w, h }) {
  const i = VIEW_LIMITS.subroutineInset
  return [
    svg('rect', { x: numero(cx - w / 2), y: numero(cy - h / 2), width: w, height: h }),
    svg('rect', { x: numero(cx - w / 2 + i), y: numero(cy - h / 2), width: numero(Math.max(0, w - 2 * i)), height: h }),
  ]
}

function cilindro({ cx, cy, w, h }) {
  const tapa = VIEW_LIMITS.cylinderLid
  const x = numero(cx - w / 2)
  const y = numero(cy - h / 2)
  return [
    svg('rect', { x, y, width: w, height: h, rx: numero(w / 2), ry: numero(tapa / 2) }),
    svg('rect', { x, y, width: w, height: tapa, rx: numero(w / 2), ry: numero(tapa / 2) }),
  ]
}

function elipse({ cx, cy, w, h }) {
  return [svg('ellipse', { cx, cy, rx: numero(w / 2), ry: numero(h / 2) })]
}

function rombo({ cx, cy, w, h }) {
  return [poligono([[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]])]
}

function hexagono({ cx, cy, w, h }) {
  const d = Math.min(h / 2, w / 4)
  const [iz, de, ar, ab] = [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2]
  return [poligono([[iz + d, ar], [de - d, ar], [de, cy], [de - d, ab], [iz + d, ab], [iz, cy]])]
}

function poligono(puntos) {
  return svg('polygon', { points: puntos.map(([x, y]) => `${numero(x)},${numero(y)}`).join(' ') })
}

// ------------------------------------------------------- la lista y el botón

/** «Ver como lista»: una fila por arista y otra por nodo sin aristas, en texto. */
function listaEquivalente(vista) {
  const nombre = new Map(vista.nodes.map((n) => [n.id, n.label || n.id]))
  const de = (id) => nombre.get(id) ?? String(id ?? '')
  const details = document.createElement('details')
  details.className = 'dg-list'
  const summary = document.createElement('summary')
  summary.textContent = 'Ver como lista'
  const ol = document.createElement('ol')
  const conArista = new Set()
  for (const a of vista.edges) {
    conArista.add(a.from)
    conArista.add(a.to)
    const li = document.createElement('li')
    li.textContent = `${de(a.from)} → ${de(a.to)}` + (a.label ? ` (${a.label})` : '')
    ol.appendChild(li)
  }
  for (const n of vista.nodes) {
    if (conArista.has(n.id)) continue
    const li = document.createElement('li')
    li.textContent = de(n.id)
    ol.appendChild(li)
  }
  details.append(summary, ol)
  return details
}

function acciones(texto, onCopy) {
  const fila = document.createElement('div')
  fila.className = 'dg-actions nav-actions'
  const boton = document.createElement('button')
  boton.setAttribute('type', 'button')
  boton.className = 'ghost small'
  boton.textContent = 'Copiar como Mermaid'
  boton.addEventListener('click', () => {
    if (typeof onCopy === 'function') onCopy(texto, boton)
  })
  fila.appendChild(boton)
  return fila
}

// ---------------------------------------------------------------- utilidades

function svg(tag, atributos = {}) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor !== null && valor !== undefined && valor !== '') el.setAttribute(nombre, String(valor))
  }
  return el
}

/** Un número para un atributo: finito y con un decimal como mucho. */
function numero(valor) {
  const n = Math.round((Number(valor) || 0) * 10) / 10
  return Object.is(n, -0) ? 0 : n
}

function lista(valor) {
  return Array.isArray(valor) ? valor : []
}

function cuenta(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`
}

/** «Flujo entre A, B y C»: las etiquetas de los seis primeros y «y N más». */
function tituloDe(nodos) {
  const etiquetas = nodos.map((n) => String(n.label || n.id || ''))
  const vistas = etiquetas.slice(0, VIEW_LIMITS.titleNodes)
  const resto = etiquetas.length - vistas.length
  if (resto > 0) return `Flujo entre ${vistas.join(', ')} y ${resto} más`
  if (vistas.length < 2) return `Flujo entre ${vistas[0] || ''}`.trim()
  return `Flujo entre ${vistas.slice(0, -1).join(', ')} y ${vistas[vistas.length - 1]}`
}
