/**
 * La vista de un diagrama (H24): de la forma validada y su layout a un
 * `<figure>` con un SVG accesible, la lista equivalente y «Copiar como Mermaid».
 *
 * Todo lo que pinta la vista lo escribió un modelo que acaba de leer Jira y
 * Confluence: una etiqueta puede traer `<img onerror>` o `javascript:`. Por eso
 * la vista sólo usa una lista blanca EXACTA de la API del DOM (la del contrato,
 * docs/plan/handoff/h24-contrato.md §1.3), y este `document` mínimo simula
 * ESA lista y nada más: tocar `innerHTML`, `outerHTML` o `insertAdjacentHTML`
 * LANZA, asignar una propiedad que no sea `textContent`/`className` LANZA, y
 * `className` en un elemento SVG también (en Chrome es un `SVGAnimatedString`
 * de sólo lectura: asignarlo en un módulo, que es estricto, lanza de verdad).
 *
 * El diagrama y el layout se construyen A MANO con las formas exactas del
 * contrato (§1.1 y §1.2): la vista no depende de cómo se lee ni de cómo se
 * coloca, y estas pruebas tampoco, salvo la última, que cruza la vista con un
 * layout REAL (los renglones dentro de su caja: la revisión adversaria de H24,
 * D17, quitó el `lineH` que la vista copiaba). Los nodos Y los subgrafos del layout llevan
 * `x`/`y` en la ESQUINA de arriba a la izquierda, como dice `diagram-layout.js`
 * (la prueba de concepto del anexo 2-E los llevaba en el centro, y al cerrar
 * H24 la vista todavía lo creía: cada nodo salía medio ancho a la izquierda de
 * sus aristas; la vista deriva el centro y estos pines lo demuestran).
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diagramNode, textMeasurer } from '../../src/panel/diagram-view.js'
import { LAYOUT_LIMITS, layoutDiagram } from '../../src/panel/diagram-layout.js'
import { NOTE_KINDS } from '../../src/panel/notes.js'

const ROOT = join(import.meta.dirname, '..', '..')
const FUENTE = readFileSync(join(ROOT, 'src', 'panel', 'diagram-view.js'), 'utf8').replace(/\r\n/g, '\n')
const SVG_NS = 'http://www.w3.org/2000/svg'

/** El fuente sin comentarios: lo que se busca son USOS, no explicaciones. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

// --- El document mínimo -------------------------------------------------------

/** Lo único que se puede ASIGNAR a un elemento (el resto va por setAttribute). */
const ASIGNABLES = new Set(['textContent', 'className'])
/** Lo que LANZA con sólo leerlo: marcado en cadena, lo que §9 prohíbe. */
const PROHIBIDAS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML'])
const PADRE = Symbol('padre')

function documentoMinimo() {
  const creados = []

  const texto = (v) => ({
    tagName: '#text',
    nodeType: 3,
    textContent: String(v),
    _padre: null,
    set [PADRE](p) {
      this._padre = p
    },
  })

  function elemento(tag, ns) {
    const datos = {
      tagName: tag,
      nodeType: 1,
      _ns: ns,
      _attrs: {},
      _hijos: [],
      _padre: null,
      _oyentes: {},
      // Como en el DOM: `dataset.fooBar = v` ES el atributo `data-foo-bar`, así que
      // lo que se escriba ahí lo ven attrs() y la prueba de las etiquetas hostiles
      // (al cerrar H24 era un `{}` suelto y `g.dataset.label = nodo.label` pasaba; D10).
      dataset: new Proxy(
        {},
        {
          get: (_, prop) => datos._attrs['data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())],
          set: (_, prop, valor) => {
            datos._attrs['data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = String(valor)
            return true
          },
        }
      ),
      appendChild(hijo) {
        hijo[PADRE] = proxy
        datos._hijos.push(hijo)
        return hijo
      },
      append(...hijos) {
        for (const h of hijos) datos.appendChild(typeof h === 'string' ? texto(h) : h)
      },
      setAttribute(nombre, valor) {
        datos._attrs[String(nombre)] = String(valor)
      },
      classList: {
        add(...clases) {
          const hay = (datos._attrs.class || '').split(' ').filter(Boolean)
          for (const c of clases) if (!hay.includes(c)) hay.push(c)
          datos._attrs.class = hay.join(' ')
        },
      },
      addEventListener(tipo, fn) {
        ;(datos._oyentes[tipo] ||= []).push(fn)
      },
      focus() {
        datos._enfocado = true
      },
    }
    const proxy = new Proxy(datos, {
      get(obj, prop) {
        if (PROHIBIDAS.has(prop)) throw new Error(`SEGURIDAD: se ha leído ${String(prop)} en <${tag}>`)
        if (prop === 'textContent') return obj._hijos.map((h) => h.textContent).join('')
        if (prop === 'className') return obj._attrs.class || ''
        return obj[prop]
      },
      set(obj, prop, valor) {
        // El padre lo apunta el propio document al colgar un hijo (para que
        // los eventos suban); la vista no puede escribirlo: es un símbolo.
        if (prop === PADRE) {
          obj._padre = valor
          return true
        }
        if (PROHIBIDAS.has(prop)) throw new Error(`SEGURIDAD: se ha escrito ${String(prop)} en <${tag}>`)
        if (!ASIGNABLES.has(prop)) throw new Error(`<${tag}>.${String(prop)} = … no está en la lista blanca del contrato`)
        if (prop === 'className') {
          if (ns === SVG_NS) throw new Error(`<${tag}> es SVG: className es de sólo lectura (setAttribute('class'))`)
          obj._attrs.class = String(valor)
        } else {
          obj._hijos = [texto(valor)]
          obj._hijos[0][PADRE] = proxy
        }
        return true
      },
    })
    creados.push({ tag, ns, via: ns === null ? 'createElement' : 'createElementNS' })
    return proxy
  }

  return {
    creados,
    document: {
      createElement: (tag) => elemento(String(tag).toLowerCase(), null),
      createElementNS: (ns, tag) => elemento(String(tag), ns),
      createTextNode: texto,
    },
  }
}

function conDocument(fn) {
  const antes = globalThis.document
  const doc = documentoMinimo()
  globalThis.document = doc.document
  try {
    return fn(doc)
  } finally {
    if (antes === undefined) delete globalThis.document
    else globalThis.document = antes
  }
}

// --- Ayudas para leer lo pintado ----------------------------------------------

const hijos = (n) => n._hijos || []
const attrs = (n) => n._attrs || {}
const clases = (n) => (attrs(n).class || '').split(' ').filter(Boolean)

/** Forma compacta del árbol: texto → cadena; elemento → { 'tag.clase.clase': hijos }. */
function forma(nodo) {
  if (nodo.tagName === '#text') return nodo.textContent
  return { [[nodo.tagName, ...clases(nodo)].join('.')]: hijos(nodo).map(forma) }
}

function todos(raiz) {
  const out = []
  const visita = (n) => {
    if (n.tagName === '#text') return
    out.push(n)
    hijos(n).forEach(visita)
  }
  visita(raiz)
  return out
}

const buscar = (raiz, pred) => todos(raiz).filter(pred)
const porClase = (raiz, c) => buscar(raiz, (n) => clases(n).includes(c))
const porTag = (raiz, t) => buscar(raiz, (n) => n.tagName === t)

/** Un evento que sube por los padres hasta que alguien lo pare, como el DOM. */
function disparar(objetivo, type, key) {
  const ev = {
    type,
    key,
    target: objetivo,
    defaultPrevented: false,
    parada: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.parada = true
    },
  }
  for (let n = objetivo; n && !ev.parada; n = n._padre) {
    for (const fn of (n._oyentes && n._oyentes[type]) || []) fn(ev)
  }
  return ev
}

// --- Los datos: forma de §1.1 y de §1.2, escritos a mano ------------------------

const ref = (id) => ({ kind: 'jira-issue', id })

const DIAGRAMA = {
  ok: true,
  direction: 'TD',
  nodes: [
    { id: 'ENG-1', label: 'ENG-1 Épica de rotación', shape: 'rect', kind: '', ref: ref('ENG-1'), note: 0, sub: '' },
    { id: 'ENG-7', label: 'ENG-7 Definir la API [1]', shape: 'round', kind: 'riesgo', ref: ref('ENG-7'), note: 1, sub: 'S1' },
    { id: 'ENG-12', label: 'ENG-12 Cliente [2]', shape: 'diamond', kind: 'hueco', ref: ref('ENG-12'), note: 2, sub: 'S1' },
    { id: 'rev', label: 'Revisión [3]', shape: 'circle', kind: '', ref: null, note: 3, sub: '' },
    { id: 'fin', label: 'Fin', shape: 'hexagon', kind: '', ref: null, note: 0, sub: '' },
    { id: 'suelto', label: 'Nodo suelto', shape: 'stadium', kind: '', ref: null, note: 0, sub: '' },
  ],
  edges: [
    { from: 'ENG-1', to: 'ENG-7', label: 'la consume', style: 'solid', arrow: 'arrow' },
    { from: 'ENG-7', to: 'ENG-12', label: '', style: 'dotted', arrow: 'arrow' },
    { from: 'ENG-12', to: 'rev', label: '', style: 'thick', arrow: 'none' },
    { from: 'rev', to: 'fin', label: 'no', style: 'solid', arrow: 'cross' },
  ],
  subgraphs: [{ id: 'S1', label: 'Sprint 1', nodes: ['ENG-7', 'ENG-12'] }],
  errores: [],
}

const LAYOUT = {
  width: 320,
  height: 420,
  nodes: [
    // Esquinas: todos centrados en x = 100 (el suelto en 260), como las aristas de abajo.
    { id: 'ENG-1', x: 15, y: 12, w: 170, h: 36, lines: ['ENG-1 Épica de rotación'] },
    { id: 'ENG-7', x: 25, y: 84, w: 150, h: 52, lines: ['ENG-7 Definir la', 'API [1]'] },
    { id: 'ENG-12', x: 30, y: 182, w: 140, h: 36, lines: ['ENG-12 Cliente [2]'] },
    { id: 'rev', x: 50, y: 262, w: 100, h: 36, lines: ['Revisión [3]'] },
    { id: 'fin', x: 68, y: 352, w: 64, h: 36, lines: ['Fin'] },
    { id: 'suelto', x: 210, y: 12, w: 100, h: 36, lines: ['Nodo suelto'] },
  ],
  edges: [
    { from: 'ENG-1', to: 'ENG-7', points: [{ x: 100, y: 48 }, { x: 100, y: 84 }], labelAt: { x: 100, y: 66 } },
    { from: 'ENG-7', to: 'ENG-12', points: [{ x: 100, y: 136 }, { x: 100, y: 182 }], labelAt: null },
    { from: 'ENG-12', to: 'rev', points: [{ x: 100, y: 218 }, { x: 100.25, y: 262 }], labelAt: null },
    { from: 'rev', to: 'fin', points: [{ x: 100, y: 298 }, { x: 120, y: 330 }, { x: 100, y: 352 }], labelAt: { x: 110, y: 325 } },
  ],
  subgraphs: [{ id: 'S1', x: 12, y: 72, w: 200, h: 150 }],
}

const pintar = (opts = {}, diagrama = DIAGRAMA, layout = LAYOUT) => diagramNode(diagrama, layout, opts)
const svgDe = (fig) => hijos(fig)[0]
const nodoDe = (fig, id) => buscar(fig, (n) => clases(n).includes('dg-node') && attrs(n)['data-id'] === id)[0]
/** La insignia de un nodo: su HERMANA justo detrás (nunca un botón dentro del botón «Abrir KEY»; D14). */
const insigniaDe = (fig, id) => {
  const g = nodoDe(fig, id)
  const hermanos = hijos(g._padre)
  const sig = hermanos[hermanos.indexOf(g) + 1]
  return sig && clases(sig).includes('dg-note') ? sig : undefined
}

// --- Las pruebas ------------------------------------------------------------------

test('SEGURIDAD H24: la vista no tiene innerHTML, outerHTML ni insertAdjacentHTML, y sólo importa LAYOUT_LIMITS', () => {
  const js = sinComentarios(FUENTE)
  eq(js.match(/innerHTML|outerHTML|insertAdjacentHTML/g), null, 'ni en el fuente')
  // `[ \t]` y no `\s`: `\s` se come los saltos de antes y el import saldría con "\n\n" delante.
  eq((js.match(/^[ \t]*import\b.*$/gm) || []).map((l) => l.trim()), ["import { LAYOUT_LIMITS } from './diagram-layout.js'"], 'un solo import, puro y sin estado (ni panel.js ni un módulo con estado)')
  eq(js.match(/\blineH\s*:|\bcharW\s*:/g), null, 'el alto de renglón y los px por carácter no se repiten en la vista (§9)')
  eq(js.match(/\bchrome\.|\bwindow\b|document\.(?!createElement\(|createElementNS\()\w+/g), null, 'del document sólo createElement y createElementNS')
  // Y en lo EJECUTADO: el document mínimo lanza si alguien lo toca, así que
  // pintar el diagrama entero con todas las opciones es la prueba.
  conDocument(() => {
    const fig = pintar({ onOpen() {}, onNote() {}, onCopy() {}, notes: new Set([1, 2, 3]), mermaid: 'flowchart TD\nA --> B', uid: 'dg1' })
    eq(fig.tagName, 'figure')
  })
})

test('H24: el svg es una imagen con título y descripción, y todo lo del svg se crea con el namespace SVG', () => {
  conDocument(({ creados }) => {
    const fig = pintar({ uid: 'dg7' })
    eq(fig.className, 'dg-wrap')
    const svg = svgDe(fig)
    eq(svg.tagName, 'svg')
    eq(attrs(svg), {
      class: 'dg-svg',
      role: 'img',
      viewBox: '0 0 320 420',
      width: '320',
      height: '420',
      'aria-labelledby': 'dg7-t dg7-d',
    })
    const [titulo, desc] = hijos(svg)
    eq([titulo.tagName, attrs(titulo).id, titulo.textContent], [
      'title',
      'dg7-t',
      'Flujo entre ENG-1 Épica de rotación, ENG-7 Definir la API [1], ENG-12 Cliente [2], Revisión [3], Fin y Nodo suelto',
    ])
    eq([desc.tagName, attrs(desc).id, desc.textContent], ['desc', 'dg7-d', '6 nodos, 4 aristas'])
    // Todo lo que cuelga del svg (y él mismo) es SVG; lo de fuera, HTML.
    for (const n of todos(svg)) eq(n._ns, SVG_NS, `<${n.tagName}> dentro del svg sin el namespace SVG`)
    const html = todos(fig).filter((n) => !todos(svg).includes(n))
    eq([...new Set(html.map((n) => n.tagName))], ['figure', 'details', 'summary', 'ol', 'li'])
    for (const n of html) eq(n._ns, null, `<${n.tagName}> es HTML`)
    eq(creados.filter((c) => c.via === 'createElementNS').every((c) => c.ns === SVG_NS), true, 'createElementNS sólo con el SVG')
    // Más de seis nodos: seis etiquetas y «y N más»; una arista, en singular.
    const muchos = Array.from({ length: 9 }, (_, i) => ({ id: 'N' + i, label: 'N' + i, shape: 'rect', kind: '', ref: null, note: 0, sub: '' }))
    const otro = svgDe(
      diagramNode({ ...DIAGRAMA, nodes: muchos, edges: [{ from: 'N0', to: 'N1', label: '', style: 'solid', arrow: 'arrow' }], subgraphs: [] }, { width: 10, height: 10, nodes: [], edges: [], subgraphs: [] })
    )
    eq(hijos(otro)[0].textContent, 'Flujo entre N0, N1, N2, N3, N4, N5 y 3 más')
    eq(hijos(otro)[1].textContent, '9 nodos, 1 arista')
  })
})

test('H24: debajo los subgrafos, luego las aristas y sus etiquetas, y encima los nodos; el guion por CLASE', () => {
  conDocument(() => {
    const svg = svgDe(pintar({ uid: 'dg2' }))
    eq(hijos(svg).map((n) => [n.tagName, ...clases(n)].join('.')), [
      'title',
      'desc',
      'defs',
      'g.dg-sub',
      'path.dg-edge.dg-edge-solid',
      'path.dg-edge.dg-edge-dotted',
      'path.dg-edge.dg-edge-thick',
      'path.dg-edge.dg-edge-solid',
      // Las etiquetas detrás de TODAS las aristas: ninguna línea las tacha.
      'text.dg-edge-label',
      'text.dg-edge-label',
      'g.dg-node.dg-rect.dg-link',
      'g.dg-node.dg-round.dg-riesgo.dg-link',
      'g.dg-node.dg-diamond.dg-hueco.dg-link',
      'g.dg-node.dg-circle',
      'g.dg-node.dg-hexagon',
      'g.dg-node.dg-stadium',
    ])
    // Los marcadores que hacen falta, con el uid: la flecha siempre, la cruz
    // porque una arista la usa, el círculo no.
    const defs = hijos(svg)[2]
    eq(hijos(defs).map((m) => [m.tagName, attrs(m).id]), [['marker', 'dg2-arrow'], ['marker', 'dg2-cross']])
    const aristas = porClase(svg, 'dg-edge')
    eq(aristas.map((p) => attrs(p).d), ['M 100 48 L 100 84', 'M 100 136 L 100 182', 'M 100 218 L 100.3 262', 'M 100 298 L 120 330 L 100 352'])
    eq(aristas.map((p) => attrs(p)['marker-end']), ['url(#dg2-arrow)', 'url(#dg2-arrow)', undefined, 'url(#dg2-cross)'])
    for (const n of todos(svg)) {
      assert(!('stroke-dasharray' in attrs(n)) && !('style' in attrs(n)), `<${n.tagName}> con estilo en línea`)
    }
    eq(porClase(svg, 'dg-edge-label').map((t) => [attrs(t).x, attrs(t).y, t.textContent]), [['100', '66', 'la consume'], ['110', '325', 'no']])
    const sub = porClase(svg, 'dg-sub')[0]
    eq(forma(sub), { 'g.dg-sub': [{ rect: [] }, { text: ['Sprint 1'] }] })
    eq([attrs(hijos(sub)[0]).x, attrs(hijos(sub)[0]).y, attrs(hijos(sub)[0]).width, attrs(hijos(sub)[0]).height], ['12', '72', '200', '150'])
    // La etiqueta del nodo: un tspan por renglón del layout.
    eq(forma(porClase(nodoDe(svg, 'ENG-7'), 'dg-label')[0]), { 'text.dg-label': [{ tspan: ['ENG-7 Definir la'] }, { tspan: ['API [1]'] }] })
    // Un --o pide su marcador, y sólo el que hace falta.
    const conCirculo = svgDe(
      pintar({ uid: 'dg3' }, { ...DIAGRAMA, edges: [{ ...DIAGRAMA.edges[0], arrow: 'circle' }] }, { ...LAYOUT, edges: [LAYOUT.edges[0]] })
    )
    eq(hijos(hijos(conCirculo)[2]).map((m) => attrs(m).id), ['dg3-arrow', 'dg3-circle'])
    eq(attrs(porClase(conCirculo, 'dg-edge')[0])['marker-end'], 'url(#dg3-circle)')
  })
})

test('H24: cada forma con su figura (rx para round/stadium, polygon, ellipse, rect doble)', () => {
  conDocument(() => {
    // Las cuatro últimas son nombres de Object.prototype: FIGURAS[shape] sin hasOwn las daría por figuras (D10).
    const formas = ['rect', 'round', 'stadium', 'subroutine', 'cylinder', 'circle', 'diamond', 'hexagon', 'trapecio', 'constructor', '__proto__', 'toString', 'hasOwnProperty']
    const d = {
      ...DIAGRAMA,
      nodes: formas.map((shape, i) => ({ id: 'F' + i, label: shape, shape, kind: '', ref: null, note: 0, sub: '' })),
      edges: [],
      subgraphs: [],
    }
    const l = {
      width: 1400,
      height: 60,
      nodes: formas.map((_, i) => ({ id: 'F' + i, x: 10 + i * 100, y: 12, w: 80, h: 36, lines: [formas[i]] })),
      edges: [],
      subgraphs: [],
    }
    const svg = svgDe(pintar({}, d, l))
    const figuras = formas.map((_, i) => hijos(nodoDe(svg, 'F' + i)).filter((n) => !clases(n).includes('dg-label')).map((n) => n.tagName))
    eq(figuras, [['rect'], ['rect'], ['rect'], ['rect', 'rect'], ['rect', 'rect'], ['ellipse'], ['polygon'], ['polygon'], ['rect'], ['rect'], ['rect'], ['rect'], ['rect']])
    for (const i of [8, 9, 10, 11, 12]) eq(clases(nodoDe(svg, 'F' + i)), ['dg-node', 'dg-rect'], `una forma desconocida (${formas[i]}) es un rect`)
    const rx = (i) => attrs(hijos(nodoDe(svg, 'F' + i))[0]).rx
    assert(Number(rx(1)) > Number(rx(0)), 'round más redondeado que rect')
    eq(rx(2), '18', 'stadium: rx = la mitad del alto')
    // x, y del layout son la ESQUINA: el <rect> nace ahí y el centro se deriva (x + w/2, y + h/2);
    // una vista que los tomara como el centro pintaría F0 en x = -30 y el rombo en 590.
    eq([attrs(hijos(nodoDe(svg, 'F0'))[0]).x, attrs(hijos(nodoDe(svg, 'F0'))[0]).y, attrs(hijos(nodoDe(svg, 'F0'))[0]).width], ['10', '12', '80'])
    eq(attrs(hijos(nodoDe(svg, 'F6'))[0]).points, '650,12 690,30 650,48 610,30', 'el rombo toca los cuatro lados de su caja')
    eq([attrs(hijos(nodoDe(svg, 'F5'))[0]).cx, attrs(hijos(nodoDe(svg, 'F5'))[0]).rx, attrs(hijos(nodoDe(svg, 'F5'))[0]).ry], ['550', '40', '18'])
  })
})

test('H24: tabindex, role=button, aria-label y data-ref SÓLO en los nodos con ref', () => {
  conDocument(() => {
    const svg = svgDe(pintar({ onOpen() {} }))
    const lectura = DIAGRAMA.nodes.map((n) => {
      const a = attrs(nodoDe(svg, n.id))
      return [n.id, a.tabindex, a.role, a['aria-label'], a['data-ref']]
    })
    eq(lectura, [
      ['ENG-1', '0', 'button', 'Abrir ENG-1', 'jira-issue:ENG-1'],
      // EL CAMBIO (D15): el tipo, en texto; sin `kinds`, el kind tal cual.
      ['ENG-7', '0', 'button', 'Abrir ENG-7 (riesgo)', 'jira-issue:ENG-7'],
      ['ENG-12', '0', 'button', 'Abrir ENG-12 (hueco)', 'jira-issue:ENG-12'],
      ['rev', undefined, undefined, undefined, undefined],
      ['fin', undefined, undefined, undefined, undefined],
      ['suelto', undefined, undefined, undefined, undefined],
    ])
    eq(nodoDe(svg, 'rev')._oyentes, {}, 'un nodo sin ref no escucha nada')
    eq(porClase(svg, 'dg-link').map((n) => attrs(n)['data-id']), ['ENG-1', 'ENG-7', 'ENG-12'])
    // Un ref que no es de una incidencia no es un botón (v1: sólo jira-issue).
    const raro = svgDe(pintar({}, { ...DIAGRAMA, nodes: [{ ...DIAGRAMA.nodes[0], ref: { kind: 'confluence-page', id: '123' } }, ...DIAGRAMA.nodes.slice(1)] }))
    eq(attrs(nodoDe(raro, 'ENG-1')).role, undefined)
  })
})

test('H24: data-note y la insignia SÓLO si esa observación existe (notes.has(n))', () => {
  conDocument(() => {
    const leer = (svg) =>
      DIAGRAMA.nodes.map((n) => {
        const g = nodoDe(svg, n.id)
        const insignia = insigniaDe(svg, n.id)
        return [n.id, attrs(g)['data-note'], insignia ? [attrs(insignia).role, attrs(insignia).tabindex, attrs(insignia)['aria-label'], forma(insignia)] : null]
      })
    eq(leer(svgDe(pintar({ notes: new Set([1, 3, 9]) }))), [
      ['ENG-1', undefined, null],
      ['ENG-7', '1', ['button', '0', 'Observación 1', { 'g.dg-note': [{ circle: [] }, { text: ['1'] }] }]],
      ['ENG-12', undefined, null],
      ['rev', '3', ['button', '0', 'Observación 3', { 'g.dg-note': [{ circle: [] }, { text: ['3'] }] }]],
      ['fin', undefined, null],
      ['suelto', undefined, null],
    ])
    // D14: al cerrar H24 la insignia colgaba del botón del nodo (axe nested-interactive, WCAG 4.1.2).
    const conNotas = svgDe(pintar({ notes: new Set([1, 2, 3]) }))
    eq(
      buscar(conNotas, (b) => attrs(b).role === 'button').flatMap((b) => buscar(b, (d) => d !== b && (attrs(d).role === 'button' || 'tabindex' in attrs(d))).map((d) => attrs(d)['aria-label'])),
      [],
      'ningún botón (ni nada con tabindex) dentro de un botón: nested-interactive'
    )
    eq(porClase(svgDe(pintar()), 'dg-note'), [], 'sin notes (un Set vacío) ninguna insignia')
    eq(porClase(svgDe(pintar({ notes: new Set() })), 'dg-note'), [])
    eq(buscar(svgDe(pintar()), (n) => 'data-note' in attrs(n)), [], 'ni data-note')
  })
})

test('H24: el clic en la insignia llama a onNote(n) y NO abre la incidencia; con Enter (y Espacio), igual', () => {
  conDocument(() => {
    const abiertas = []
    const notas = []
    const fig = pintar({ onOpen: (r) => abiertas.push(r), onNote: (n) => notas.push(n), notes: new Set([1, 2]) })
    const insignia = insigniaDe(fig, 'ENG-7')
    disparar(insignia, 'click')
    const enter = disparar(insignia, 'keydown', 'Enter')
    const espacio = disparar(insignia, 'keydown', ' ')
    eq(notas, [1, 1, 1])
    eq(abiertas, [], 'la insignia es hermana del nodo, no su hija: el nodo no se entera')
    eq([enter.defaultPrevented, espacio.defaultPrevented], [true, true])
    disparar(insignia, 'keydown', 'a')
    eq(notas, [1, 1, 1], 'otra tecla no hace nada')
    eq(abiertas, [], 'y tampoco sube al nodo')
  })
})

test('H24: el clic en un nodo con ref llama a onOpen({kind, id}, figure); Enter y Espacio también', () => {
  conDocument(() => {
    const abiertas = []
    const fig = pintar({ onOpen: (r, figura) => abiertas.push([r, figura === fig]) })
    const g = nodoDe(fig, 'ENG-12')
    disparar(g, 'click')
    // El clic sobre el texto del nodo sube hasta el nodo, como en el DOM.
    disparar(hijos(porClase(g, 'dg-label')[0])[0], 'click')
    const enter = disparar(g, 'keydown', 'Enter')
    const espacio = disparar(g, 'keydown', ' ')
    const otra = disparar(g, 'keydown', 'x')
    eq(abiertas, [
      [{ kind: 'jira-issue', id: 'ENG-12' }, true],
      [{ kind: 'jira-issue', id: 'ENG-12' }, true],
      [{ kind: 'jira-issue', id: 'ENG-12' }, true],
      [{ kind: 'jira-issue', id: 'ENG-12' }, true],
    ])
    eq([enter.defaultPrevented, espacio.defaultPrevented, otra.defaultPrevented], [true, true, false], 'el Espacio no desplaza el chat')
    // Sin onOpen no pasa nada (ni lanza).
    disparar(nodoDe(pintar(), 'ENG-1'), 'click')
  })
})

test('H24: «Ver como lista» tiene una fila por arista y otra por nodo suelto o con tipo, con las etiquetas', () => {
  conDocument(() => {
    const fig = pintar()
    const lista = hijos(fig)[1]
    eq(forma(lista), {
      'details.dg-list': [
        { summary: ['Ver como lista'] },
        {
          ol: [
            { li: ['ENG-1 Épica de rotación → ENG-7 Definir la API [1] (la consume)'] },
            { li: ['ENG-7 Definir la API [1] → ENG-12 Cliente [2]'] },
            { li: ['ENG-12 Cliente [2] → Revisión [3]'] },
            { li: ['Revisión [3] → Fin (no)'] },
            // EL CAMBIO (D15): una fila por nodo con tipo aunque tenga aristas, «Etiqueta: tipo».
            { li: ['ENG-7 Definir la API [1]: riesgo'] },
            { li: ['ENG-12 Cliente [2]: hueco'] },
            { li: ['Nodo suelto'] },
          ],
        },
      ],
    })
  })
})

test('H24: «Copiar como Mermaid» sólo con mermaid, y llama a onCopy(texto, botón)', () => {
  conDocument(() => {
    eq(hijos(pintar()).map((n) => n.tagName), ['svg', 'details'], 'sin mermaid, ni el botón ni su fila')
    const copias = []
    const fig = pintar({ mermaid: 'flowchart TD\nA --> B', onCopy: (texto, boton) => copias.push([texto, boton]) })
    const fila = hijos(fig)[2]
    eq(forma(fila), { 'div.dg-actions.nav-actions': [{ 'button.ghost.small': ['Copiar como Mermaid'] }] })
    const boton = hijos(fila)[0]
    eq(attrs(boton).type, 'button')
    disparar(boton, 'click')
    eq(copias.length, 1)
    eq(copias[0][0], 'flowchart TD\nA --> B')
    assert(copias[0][1] === boton, 'onCopy recibe el botón para decir «Copiado»')
  })
})

test('H24: un uid distinto da ids distintos: dos diagramas en el mismo chat no comparten marcador', () => {
  conDocument(() => {
    const ids = (fig) => buscar(fig, (n) => 'id' in attrs(n)).map((n) => attrs(n).id)
    const refs = (fig) => buscar(fig, (n) => 'marker-end' in attrs(n) || 'aria-labelledby' in attrs(n)).map((n) => attrs(n)['marker-end'] || attrs(n)['aria-labelledby'])
    const a = pintar({ uid: 'dg1' })
    const b = pintar({ uid: 'dg2' })
    eq(ids(a), ['dg1-t', 'dg1-d', 'dg1-arrow', 'dg1-cross'])
    eq(ids(b), ['dg2-t', 'dg2-d', 'dg2-arrow', 'dg2-cross'])
    eq(refs(b), ['dg2-t dg2-d', 'url(#dg2-arrow)', 'url(#dg2-arrow)', 'url(#dg2-cross)'])
    eq(ids(pintar()).slice(0, 2), ['dg-t', 'dg-d'], 'por defecto, dg')
    // SEGURIDAD: un uid con lo que rompería url(#…) o un atributo se limpia.
    eq(ids(pintar({ uid: 'x) url(#y "z' })).slice(0, 1), ['xurlyz-t'])
  })
})

test('SEGURIDAD H24: las etiquetas hostiles salen como TEXTO, nunca en un atributo ni en un href', () => {
  conDocument(() => {
    const hostil = '<img src=x onerror=alert(1)>'
    const js = 'javascript:alert(1)'
    const d = {
      ...DIAGRAMA,
      nodes: [
        { id: 'A', label: hostil, shape: 'rect', kind: '" onmouseover="x', ref: null, note: 0, sub: 'S1' },
        { id: 'B', label: js, shape: 'rect', kind: '__proto__', ref: ref('ENG-1'), note: 0, sub: '' },
      ],
      edges: [{ from: 'A', to: 'B', label: hostil, style: 'solid', arrow: 'arrow' }],
      subgraphs: [{ id: 'S1', label: js, nodes: ['A'] }],
    }
    const l = {
      width: 200,
      height: 200,
      nodes: [
        { id: 'A', x: 0, y: 12, w: 100, h: 36, lines: [hostil] },
        { id: 'B', x: 0, y: 112, w: 100, h: 36, lines: [js] },
      ],
      edges: [{ from: 'A', to: 'B', points: [{ x: 50, y: 48 }, { x: 50, y: 112 }], labelAt: { x: 50, y: 80 } }],
      subgraphs: [{ id: 'S1', x: 0, y: 0, w: 120, h: 80 }],
    }
    const fig = diagramNode(d, l, { onOpen() {}, mermaid: 'flowchart TD' })
    const textos = buscar(fig, () => true).flatMap((n) => hijos(n).filter((h) => h.tagName === '#text').map((h) => h.textContent))
    assert(textos.includes(hostil) && textos.includes(js), 'se leen tal cual, como texto')
    for (const n of todos(fig)) {
      for (const [nombre, valor] of Object.entries(attrs(n))) {
        assert(!/^on|href$/i.test(nombre), `<${n.tagName}> con el atributo ${nombre}`)
        assert(!/onerror|javascript:|<img|onmouseover|__proto__/i.test(valor), `<${n.tagName} ${nombre}="${valor}">`)
      }
    }
    eq(clases(nodoDe(fig, 'A')), ['dg-node', 'dg-rect'], 'un kind con comillas no se cuela en las clases')
    eq(clases(nodoDe(fig, 'B')), ['dg-node', 'dg-rect', 'dg-link'], 'ni __proto__')
    eq(porTag(fig, 'a'), [], 'ningún enlace')
  })
})

test('H24: textMeasurer mide con un canvas fuera del documento y, sin él, cae en 6,6 px por carácter', () => {
  conDocument(() => {
    const medir = textMeasurer('12px sans-serif')
    eq(medir('abcde'), 5 * 6.6, 'el document mínimo no tiene canvas')
    eq(medir(''), 0)
  })
  const antes = globalThis.document
  try {
    delete globalThis.document
    eq(textMeasurer('12px x')('ab'), 2 * 6.6, 'sin document tampoco lanza')
    const lienzos = []
    globalThis.document = {
      createElement(tag) {
        const ctx = { font: '', measureText: (t) => ({ width: t.length * 10 + (ctx.font === '13px Inter' ? 1 : 0) }) }
        const canvas = { tag, getContext: (tipo) => (tipo === '2d' ? ctx : null) }
        lienzos.push(canvas)
        return canvas
      },
    }
    const real = textMeasurer('13px Inter')
    eq([real('abc'), real('')], [31, 1], 'measureText con la fuente puesta')
    eq(lienzos.map((c) => c.tag), ['canvas'], 'un solo canvas por medidor, nunca colgado del documento')
    globalThis.document = { createElement: () => ({ getContext: () => null }) }
    eq(textMeasurer('13px Inter')('abc'), 3 * 6.6, 'sin contexto 2d, la estimación')
  } finally {
    if (antes === undefined) delete globalThis.document
    else globalThis.document = antes
  }
})

// --- Revisión adversaria de H24 (docs/plan/handoff/h24-rev-decisiones.md) ----------

test('H24: la insignia va en la esquina de arriba a la derecha del nodo y nunca sale del viewBox', () => {
  conDocument(() => {
    // El círculo y su número de la insignia (la hermana del nodo, D14), como [cx, cy, r].
    const centro = (fig, id) => {
      const nota = insigniaDe(fig, id)
      const c = porTag(nota, 'circle')[0]
      const t = porTag(nota, 'text')[0]
      eq([attrs(t).x, attrs(t).y], [attrs(c).cx, attrs(c).cy], 'el número en el centro del círculo')
      return [Number(attrs(c).cx), Number(attrs(c).cy), Number(attrs(c).r)]
    }
    // Con LAYOUT: la esquina (x + w, y) de cada nodo con observación.
    const svg = svgDe(pintar({ notes: new Set([1, 3]) }))
    eq(centro(svg, 'ENG-7'), [175, 84, 8], 'ENG-7: x 25 + w 150, y 84')
    eq(centro(svg, 'rev'), [150, 262, 8], 'rev: x 50 + w 100, y 262')
    // Nodos pegados a los bordes de un viewBox de 200 × 100: el círculo entero dentro (r ≤ c ≤ lado − r).
    const nota = (id, n) => ({ id, label: id, shape: 'rect', kind: '', ref: null, note: n, sub: '' })
    const d = { ...DIAGRAMA, nodes: [nota('dcha', 1), nota('izda', 2), nota('abajo', 3)], edges: [], subgraphs: [] }
    const l = {
      width: 200,
      height: 100,
      nodes: [
        { id: 'dcha', x: 120, y: 0, w: 80, h: 36, lines: ['dcha'] },
        { id: 'izda', x: -40, y: 20, w: 44, h: 36, lines: ['izda'] },
        { id: 'abajo', x: 60, y: 97, w: 40, h: 20, lines: ['abajo'] },
      ],
      edges: [],
      subgraphs: [],
    }
    const bordes = svgDe(pintar({ notes: new Set([1, 2, 3]) }, d, l))
    eq(['dcha', 'izda', 'abajo'].map((id) => centro(bordes, id)), [[192, 8, 8], [8, 20, 8], [100, 92, 8]])
  })
})

test('H24: un layout con los nodos y las aristas en otro orden: cada uno se pinta con lo SUYO (por id y por extremos)', () => {
  conDocument(() => {
    const revuelto = { ...LAYOUT, nodes: [...LAYOUT.nodes].reverse(), edges: [...LAYOUT.edges].reverse() }
    const svg = svgDe(pintar({ uid: 'dg4' }, DIAGRAMA, revuelto))
    // Las aristas se pintan en el orden del DIAGRAMA, cada una con sus puntos y su etiqueta.
    eq(porClase(svg, 'dg-edge').map((p) => attrs(p).d), ['M 100 48 L 100 84', 'M 100 136 L 100 182', 'M 100 218 L 100.3 262', 'M 100 298 L 120 330 L 100 352'])
    eq(porClase(svg, 'dg-edge').map((p) => attrs(p)['marker-end']), ['url(#dg4-arrow)', 'url(#dg4-arrow)', undefined, 'url(#dg4-cross)'])
    eq(porClase(svg, 'dg-edge-label').map((t) => [attrs(t).x, attrs(t).y, t.textContent]), [['100', '66', 'la consume'], ['110', '325', 'no']])
    // Y los nodos en el orden del diagrama (el del tabulador), cada uno en su caja.
    eq(porClase(svg, 'dg-node').map((g) => attrs(g)['data-id']), DIAGRAMA.nodes.map((n) => n.id))
    eq(attrs(hijos(nodoDe(svg, 'ENG-1'))[0]).x, '15')
    // Una arista sin pareja en el layout no se dibuja (sigue en la lista).
    const cojo = svgDe(pintar({}, DIAGRAMA, { ...LAYOUT, edges: LAYOUT.edges.slice(1) }))
    eq(porClase(cojo, 'dg-edge').map((p) => attrs(p).d), ['M 100 136 L 100 182', 'M 100 218 L 100.3 262', 'M 100 298 L 120 330 L 100 352'])
  })
})

test('H24: el tipo del nodo se dice en TEXTO —en «Ver como lista» y en el aria-label—, no sólo con un color', () => {
  conDocument(() => {
    const kinds = { dato: 'dato', supuesto: 'supuesto', hueco: 'hueco', contradiccion: 'contradicción', riesgo: 'riesgo' }
    const fig = pintar({ onOpen() {}, kinds })
    const svg = svgDe(fig)
    eq(['ENG-1', 'ENG-7', 'ENG-12'].map((id) => attrs(nodoDe(svg, id))['aria-label']), ['Abrir ENG-1', 'Abrir ENG-7 (riesgo)', 'Abrir ENG-12 (hueco)'])
    eq(
      hijos(hijos(hijos(fig)[1])[1]).map((li) => li.textContent).slice(4),
      ['ENG-7 Definir la API [1]: riesgo', 'ENG-12 Cliente [2]: hueco', 'Nodo suelto'],
      'una fila por nodo con tipo, aunque tenga aristas, y la del suelto'
    )
    // La etiqueta al usuario, con su tilde, la da quien llama (KIND_LABELS del panel); sin ella, el kind tal cual.
    const contra = { ...DIAGRAMA, nodes: DIAGRAMA.nodes.map((n) => (n.id === 'ENG-7' ? { ...n, kind: 'contradiccion' } : n)) }
    eq(attrs(nodoDe(svgDe(pintar({ kinds }, contra)), 'ENG-7'))['aria-label'], 'Abrir ENG-7 (contradicción)')
    eq(attrs(nodoDe(svgDe(pintar({}, contra)), 'ENG-7'))['aria-label'], 'Abrir ENG-7 (contradiccion)')
    // Un kinds con la etiqueta HEREDADA del prototipo no cuela: sólo claves propias con cadena.
    const raro = Object.create({ riesgo: 'HEREDADO' })
    eq(attrs(nodoDe(svgDe(pintar({ kinds: raro })), 'ENG-7'))['aria-label'], 'Abrir ENG-7 (riesgo)')
    // Y una etiqueta de la tabla que no es cadena tampoco: vuelve al kind.
    eq(attrs(nodoDe(svgDe(pintar({ kinds: { riesgo: 7 } })), 'ENG-7'))['aria-label'], 'Abrir ENG-7 (riesgo)', 'una etiqueta que no es cadena cae en el kind')
  })
  // Y en pantalla, los dos tipos rojos y los dos dorados no son la misma regla.
  const css = readFileSync(join(ROOT, 'src', 'panel', 'panel.css'), 'utf8').replace(/\r\n/g, '\n')
  const regla = (k) => (new RegExp('\\n\\.dg-' + k + ' \\{([^}]*)\\}').exec(css) || [])[1]
  eq(regla('contradiccion'), ' fill: var(--danger-bg); stroke: var(--danger); stroke-dasharray: 4 4; ')
  eq(regla('supuesto'), ' fill: var(--gold-bg); stroke: var(--gold); stroke-dasharray: 4 4; ')
  assert(regla('riesgo') && regla('riesgo') !== regla('contradiccion'), 'riesgo y contradicción se distinguen sin el color')
  assert(regla('hueco') && regla('hueco') !== regla('supuesto'), 'hueco y supuesto se distinguen sin el color')
})

const dosNodos = (a, b = {}) => ({
  ok: true,
  direction: 'TD',
  nodes: [
    { id: 'A', label: 'a', shape: 'rect', kind: '', ref: null, note: 0, sub: '', ...a },
    { id: 'B', label: 'b', shape: 'rect', kind: '', ref: null, note: 0, sub: '', ...b },
  ],
  edges: [{ from: 'A', to: 'B', label: '', style: 'solid', arrow: 'arrow' }],
  subgraphs: [],
  errores: [],
})
const dosSitios = (a = {}) => ({
  width: 200,
  height: 200,
  nodes: [{ id: 'A', x: 0, y: 0, w: 100, h: 36, lines: ['a'], ...a }, { id: 'B', x: 0, y: 80, w: 100, h: 36, lines: ['b'] }],
  edges: [],
  subgraphs: [],
})

test('H24: un kind que no es de NOTE_KINDS no da clase, aunque sea una clase de la propia vista', () => {
  conDocument(() => {
    const TIPOS = /const TIPOS = Object\.freeze\((\[[^\]]*\])\)/.exec(sinComentarios(FUENTE))
    assert(TIPOS, 'la vista tiene su lista cerrada TIPOS')
    eq(JSON.parse(TIPOS[1].replace(/'/g, '"')), NOTE_KINDS, 'TIPOS es NOTE_KINDS, en su orden')
    for (const kind of ['label', 'note', 'link', 'edge', 'sub', 'svg', 'node', 'rect']) {
      const fig = diagramNode(dosNodos({ kind }), dosSitios())
      eq(clases(porClase(fig, 'dg-node')[0]), ['dg-node', 'dg-rect'], `kind «${kind}»`)
      eq(hijos(hijos(hijos(fig)[1])[1]).map((li) => li.textContent), ['a → b'], `kind «${kind}»: ni una fila de tipo`)
    }
    for (const kind of NOTE_KINDS) {
      const g = porClase(diagramNode(dosNodos({ kind }), dosSitios()), 'dg-node')[0]
      eq(clases(g), ['dg-node', 'dg-rect', `dg-${kind}`], `kind «${kind}»`)
    }
  })
})

test('H24: un layout con NaN, Infinity o negativos da atributos finitos y medidas ≥ 0', () => {
  conDocument(() => {
    const l = { ...dosSitios({ x: NaN, y: -Infinity, w: -5, h: Infinity }), width: Infinity, height: -5, subgraphs: [{ id: 'S', x: 0, y: 0, w: -1, h: NaN }] }
    const d = { ...dosNodos({ sub: 'S', note: 1 }), subgraphs: [{ id: 'S', label: 'S', nodes: ['A'] }] }
    const fig = diagramNode(d, l, { notes: new Set([1]) })
    const svg = hijos(fig)[0]
    eq(attrs(svg).viewBox, '0 0 0 0')
    eq([attrs(svg).width, attrs(svg).height], ['0', '0'])
    const numericos = ['x', 'y', 'cx', 'cy', 'r', 'rx', 'width', 'height']
    let vistos = 0
    for (const n of todos(fig)) {
      for (const k of numericos) {
        if (!(k in attrs(n))) continue
        vistos++
        const v = Number(attrs(n)[k])
        assert(Number.isFinite(v), `<${n.tagName} ${k}="${attrs(n)[k]}">`)
        if (k === 'width' || k === 'height' || k === 'r') assert(v >= 0, `<${n.tagName} ${k}="${attrs(n)[k]}">`)
      }
    }
    assert(vistos > 10, 'se han mirado los atributos del subgrafo, los nodos y la insignia')
  })
})

test('H24: los renglones de una etiqueta van centrados en la caja, a LAYOUT_LIMITS.lineH uno de otro', () => {
  const L = LAYOUT_LIMITS.lineH
  const d = { ...DIAGRAMA, nodes: [{ id: 'T', label: 'a b c', shape: 'rect', kind: '', ref: null, note: 0, sub: '' }], edges: [], subgraphs: [] }
  const tres = { width: 120, height: 88, nodes: [{ id: 'T', x: 12, y: 12, w: 96, h: 64, lines: ['a', 'b', 'c'] }], edges: [], subgraphs: [] }
  conDocument(() => {
    const ys = porTag(porClase(nodoDe(pintar({}, d, tres), 'T'), 'dg-label')[0], 'tspan').map((s) => Number(attrs(s).y))
    eq(ys, [44 - L, 44, 44 + L], 'tres renglones: el del medio en el centro (cy = 12 + 64/2)')
    const dos = { ...tres, nodes: [{ id: 'T', x: 12, y: 12, w: 96, h: 48, lines: ['a', 'b'] }] }
    const ys2 = porTag(porClase(nodoDe(pintar({}, d, dos), 'T'), 'dg-label')[0], 'tspan').map((s) => Number(attrs(s).y))
    eq(ys2, [36 - L / 2, 36 + L / 2], 'dos renglones: repartidos alrededor del centro')
  })
})

// La última: cruza la vista con un layout REAL (la cabecera lo dice).
test('H24: con un layout REAL, cada renglón cae dentro de su caja con padY arriba y abajo', () => {
  const d = {
    ok: true,
    direction: 'TD',
    nodes: [
      { id: 'A', label: 'una etiqueta bastante larga que el layout parte en tres renglones seguro', shape: 'rect', kind: '', ref: null, note: 0, sub: '' },
      { id: 'B', label: 'B', shape: 'rect', kind: '', ref: null, note: 0, sub: '' },
    ],
    edges: [{ from: 'A', to: 'B', label: '', style: 'solid', arrow: 'arrow' }],
    subgraphs: [],
    errores: [],
  }
  const l = layoutDiagram(d)
  const a = l.nodes.find((n) => n.id === 'A')
  assert(a.lines.length >= 2, 'el caso necesita una etiqueta de varios renglones: ' + JSON.stringify(a.lines))
  conDocument(() => {
    const ys = porTag(porClase(nodoDe(pintar({}, d, l), 'A'), 'dg-label')[0], 'tspan').map((s) => Number(attrs(s).y))
    const L = LAYOUT_LIMITS.lineH
    eq(ys.length, a.lines.length, 'un tspan por renglón del layout')
    eq(ys[0] - L / 2, a.y + LAYOUT_LIMITS.padY, 'el primero, a padY del borde de arriba')
    eq(ys[ys.length - 1] + L / 2, a.y + a.h - LAYOUT_LIMITS.padY, 'el último, a padY del de abajo')
  })
})
