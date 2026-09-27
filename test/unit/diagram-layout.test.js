/**
 * Dónde va cada nodo de un diagrama del chat (H24): el Sugiyama simplificado de
 * diagram-layout.js, medido sobre su SALIDA —cruces contados sobre la
 * geometría, solapes, marco, determinismo, tiempo— y no sobre sus pasos.
 */
import { test, eq, assert, near } from '../harness.js'
import { LAYOUT_LIMITS, layoutDiagram } from '../../src/panel/diagram-layout.js'
import { readFlowchart } from '../../src/panel/diagram-parse.js'

/** El flujo del anexo E: seis incidencias, siete aristas (una salta tres capas) y un subgrafo. */
const FLUJO = [
  'flowchart TD',
  '  A[ENG-1 Épica: rotación de credenciales] --> B[ENG-7 Definir la API de rotación]',
  '  B --> C[ENG-12 Backend de rotación]:::riesgo & D[OPS-2 Runbook de guardia]',
  '  C -.->|depende de| E{ENG-20 ¿Quién revoca la clave vieja? [3]}:::hueco',
  '  D --> E',
  '  E -->|contradice| F[ENG-3 Tokens de 90 días]:::contradiccion',
  '  A --> F',
  '  subgraph S [Sprint 1]',
  '    C',
  '    D',
  '  end',
].join('\n')

const VACIO = { width: 0, height: 0, nodes: [], edges: [], subgraphs: [] }

function diagrama(src) {
  const d = readFlowchart(src)
  assert(d.ok, JSON.stringify(d.errores))
  return d
}

const conSentido = (src, dir) => src.replace(/^flowchart \w+/, 'flowchart ' + dir)

/** Los ids agrupados por el centro de su nodo a lo largo del flujo (y en TD, x en LR), ordenados. */
function capas(L, eje = 'y') {
  const tam = eje === 'y' ? 'h' : 'w'
  const grupos = new Map()
  for (const n of L.nodes) {
    const c = Math.round((n[eje] + n[tam] / 2) * 2) / 2
    if (!grupos.has(c)) grupos.set(c, [])
    grupos.get(c).push(n.id)
  }
  return [...grupos.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids.sort())
}

const mismo = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Cruces de verdad entre los tramos de aristas distintas (tocarse en un extremo común no cuenta). */
function cruces(L) {
  const tramos = []
  L.edges.forEach((e, i) => {
    for (let k = 0; k < e.points.length - 1; k++) tramos.push([i, e.points[k], e.points[k + 1]])
  })
  let n = 0
  for (let a = 0; a < tramos.length; a++) {
    for (let b = a + 1; b < tramos.length; b++) {
      const [ia, p1, p2] = tramos[a]
      const [ib, q1, q2] = tramos[b]
      if (ia === ib) continue
      if (mismo(p1, q1) || mismo(p1, q2) || mismo(p2, q1) || mismo(p2, q2)) continue
      const o1 = orient(p1, p2, q1)
      const o2 = orient(p1, p2, q2)
      const o3 = orient(q1, q2, p1)
      const o4 = orient(q1, q2, p2)
      if (o1 * o2 < 0 && o3 * o4 < 0) n++
    }
  }
  return n
}

const solapan = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function sinSolapes(L, msg) {
  for (let i = 0; i < L.nodes.length; i++) {
    for (let j = i + 1; j < L.nodes.length; j++) {
      assert(!solapan(L.nodes[i], L.nodes[j]), `${msg}: ${L.nodes[i].id} y ${L.nodes[j].id} se solapan`)
    }
  }
}

function dentro(L, msg, d = null) {
  // El margen de padX en los cuatro lados, como promete la cabecera del módulo:
  // todo entre padX y width − padX, y lo de más a la izquierda/arriba justo en padX
  // (revisión adversaria de H24, D09: con `x >= 0` vivía un margen 0 o de más).
  const { padX } = LAYOUT_LIMITS
  const xs = []
  const ys = []
  const cabe = (x, y, que) => {
    xs.push(x)
    ys.push(y)
    assert(
      x >= padX - 0.11 && y >= padX - 0.11 && x <= L.width - padX + 0.11 && y <= L.height - padX + 0.11,
      `${msg}: ${que} (${x}, ${y}) fuera del margen de ${L.width}×${L.height}`
    )
  }
  for (const n of L.nodes) {
    cabe(n.x, n.y, n.id)
    cabe(n.x + n.w, n.y + n.h, n.id)
  }
  for (const s of L.subgraphs) {
    cabe(s.x, s.y, 'subgrafo ' + s.id)
    cabe(s.x + s.w, s.y + s.h, 'subgrafo ' + s.id)
  }
  for (const e of L.edges) {
    for (const p of e.points) cabe(p.x, p.y, `${e.from}→${e.to}`)
    if (e.labelAt) cabe(e.labelAt.x, e.labelAt.y, 'etiqueta')
  }
  // La etiqueta entera, no sólo su centro: medida con la estimación por defecto.
  L.edges.forEach((e, i) => {
    if (!d || !e.labelAt) return
    const mitad = (d.edges[i].label.length * LAYOUT_LIMITS.charW) / 2
    cabe(e.labelAt.x - mitad, e.labelAt.y - LAYOUT_LIMITS.lineH / 2, 'etiqueta ' + d.edges[i].label)
    cabe(e.labelAt.x + mitad, e.labelAt.y + LAYOUT_LIMITS.lineH / 2, 'etiqueta ' + d.edges[i].label)
  })
  near(Math.min(...xs), padX, 0.11, `${msg}: margen izquierdo`)
  near(Math.min(...ys), padX, 0.11, `${msg}: margen de arriba`)
  const sobraX = L.width - padX - Math.max(...xs)
  const sobraY = L.height - padX - Math.max(...ys)
  assert(sobraX > -0.11 && sobraX < 1.11, `${msg}: margen derecho ${sobraX + padX}`)
  assert(sobraY > -0.11 && sobraY < 1.11, `${msg}: margen de abajo ${sobraY + padX}`)
}

function enBorde(p, n) {
  const e = 0.11
  const enX = p.x >= n.x - e && p.x <= n.x + n.w + e
  const enY = p.y >= n.y - e && p.y <= n.y + n.h + e
  return (
    (enY && (Math.abs(p.x - n.x) < e || Math.abs(p.x - n.x - n.w) < e)) ||
    (enX && (Math.abs(p.y - n.y) < e || Math.abs(p.y - n.y - n.h) < e))
  )
}

test('layout: LAYOUT_LIMITS, congelado y con sus valores', () => {
  eq(LAYOUT_LIMITS, {
    nodeMinW: 64,
    nodeMaxW: 180,
    nodeH: 36,
    lineH: 16,
    padX: 12,
    padY: 8,
    gapX: 28,
    gapY: 40,
    subPad: 12,
    maxLines: 3,
    charW: 6.6,
    edgeSep: 16,
  })
  assert(Object.isFrozen(LAYOUT_LIMITS))
})

test('layout: claves EXACTAS de la salida, y nodos y aristas en el orden del diagrama', () => {
  const d = diagrama(FLUJO)
  const L = layoutDiagram(d)
  eq(Object.keys(L), ['width', 'height', 'nodes', 'edges', 'subgraphs'])
  for (const n of L.nodes) eq(Object.keys(n), ['id', 'x', 'y', 'w', 'h', 'lines'])
  for (const e of L.edges) {
    eq(Object.keys(e), ['from', 'to', 'points', 'labelAt'])
    for (const p of e.points) eq(Object.keys(p), ['x', 'y'])
  }
  for (const s of L.subgraphs) eq(Object.keys(s), ['id', 'x', 'y', 'w', 'h'])
  eq(L.nodes.map((n) => n.id), d.nodes.map((n) => n.id))
  eq(L.edges.map((e) => [e.from, e.to]), d.edges.map((e) => [e.from, e.to]))
  eq(L.subgraphs.map((s) => s.id), ['S'])
  eq(L.edges.map((e) => e.labelAt === null), d.edges.map((e) => !e.label), 'labelAt sólo con etiqueta')
})

test('layout: el flujo del anexo, 0 cruces y sus cinco capas (la arista larga pasa por puntos intermedios)', () => {
  const L = layoutDiagram(diagrama(FLUJO))
  eq(capas(L), [['A'], ['B'], ['C', 'D'], ['E'], ['F']])
  eq(cruces(L), 0)
  const larga = L.edges[6]
  eq([larga.from, larga.to, larga.points.length], ['A', 'F', 8], 'A→F salta tres capas: entra y sale de cada una')
  // El subgrafo es la caja de sus dos nodos más subPad, y lineH arriba para el título.
  const [c, dd] = ['C', 'D'].map((id) => L.nodes.find((x) => x.id === id))
  const x0 = Math.min(c.x, dd.x)
  const y0 = Math.min(c.y, dd.y)
  const x1 = Math.max(c.x + c.w, dd.x + dd.w)
  const y1 = Math.max(c.y + c.h, dd.y + dd.h)
  const { subPad, lineH } = LAYOUT_LIMITS
  const s = L.subgraphs[0]
  eq(s.id, 'S')
  near(s.x, x0 - subPad, 0.11, 'x')
  near(s.y, y0 - subPad - lineH, 0.11, 'y')
  near(s.w, x1 - x0 + 2 * subPad, 0.11, 'w')
  near(s.h, y1 - y0 + 2 * subPad + lineH, 0.11, 'h')
})

test('layout: los nodos de un subgrafo quedan juntos en su capa', () => {
  const L = layoutDiagram(diagrama('flowchart TD\n  R --> A & X & B\n  subgraph S\n  A\n  B\n  end'))
  eq(cruces(L), 0)
  const x = L.nodes.find((n) => n.id === 'X')
  assert(!solapan(L.subgraphs[0], x), 'X, que no es de S, queda fuera de su caja')
})

const SIN_CRUCE = 'flowchart TD\n  C --> F\n  E --> F\n  A --> G\n  subgraph S\n  A\n  C\n  G\n  end'

// Revisión adversaria de H24, D11: la caja envolvía a quien no era suyo y dos cajas se solapaban.
test('layout: la caja de un subgrafo no tapa a nadie que no sea suyo ni a otro subgrafo (TD, LR, RL y BT)', () => {
  const casos = [
    // B no es de «Equipo», pero sus capas van de A a C: antes quedaba dentro de la caja.
    'flowchart TD\n  A --> B --> C\n  subgraph S [Equipo]\n  A\n  C\n  end',
    // Dos subgrafos cruzados: antes sus cajas se solapaban 42 px.
    'flowchart TD\n  A --> B\n  C --> D\n  A --> D\n  C --> B\n  subgraph S1\n  A\n  B\n  end\n  subgraph S2\n  C\n  D\n  end',
    // En LR/RL el título cae a lo ancho de la capa: dos vecinos de una capa se pisaban.
    'flowchart TD\n  R --> A & B\n  subgraph S1\n  A\n  end\n  subgraph S2\n  B\n  end',
    // El baricentro pone S1 a la izquierda en una capa y a la derecha en la otra: un orden para todas.
    'flowchart TD\n  A --> C\n  B --> D\n  subgraph S1\n  A\n  D\n  end\n  subgraph S2\n  B\n  C\n  end',
    'flowchart TD\n  B --> D\n  A --> F\n  A --> E\n  C --> F\n  subgraph S1\n  B\n  E\n  end\n  subgraph S2\n  A\n  D\n  end',
    // E no es de S y quedaba entre C y A; juntarlos sin volver a ordenar cruza E → F con C → F.
    SIN_CRUCE,
    // B empuja la franja de S en la capa de abajo, y S a D en la de arriba: la relajación
    // sigue hasta que nada cambie (con una sola pasada D quedaba dentro de la caja).
    'flowchart TD\n  A --> B\n  A --> C\n  subgraph S\n  A\n  C\n  end\n  D',
  ]
  // Entre una caja y un nodo que no es suyo queda al menos subPad (ni tocarse).
  const m = LAYOUT_LIMITS.subPad
  const aparte = (a, b) => !solapan({ x: a.x - m, y: a.y - m, w: a.w + 2 * m, h: a.h + 2 * m }, b)
  for (const src of casos) {
    for (const dir of ['TD', 'LR', 'RL', 'BT']) {
      const d = diagrama(conSentido(src, dir))
      const L = layoutDiagram(d)
      const de = new Map(d.nodes.map((n) => [n.id, n.sub]))
      eq(L.subgraphs.length, d.subgraphs.length, `${dir}: una caja por subgrafo`)
      for (const s of L.subgraphs) {
        for (const n of L.nodes) {
          if (de.get(n.id) !== s.id) assert(aparte(s, n), `${dir}: la caja de ${s.id} tapa a ${n.id}, que no es suyo`)
        }
      }
      for (let i = 0; i < L.subgraphs.length; i++) {
        for (let j = i + 1; j < L.subgraphs.length; j++) {
          assert(!solapan(L.subgraphs[i], L.subgraphs[j]), `${dir}: ${L.subgraphs[i].id} y ${L.subgraphs[j].id} se solapan`)
        }
      }
      sinSolapes(L, dir)
      dentro(L, dir, d)
      if (src === SIN_CRUCE) eq(cruces(L), 0, `${dir}: los subgrafos juntos se vuelven a ordenar por baricentro`)
    }
  }
})

test('layout: el orden por baricentro deshace el cruce que trae el orden de declaración', () => {
  const src = 'flowchart TD\n  A & B\n  X & Y\n  A --> Y\n  B --> X'
  const L = layoutDiagram(diagrama(src))
  eq(capas(L), [['A', 'B'], ['X', 'Y']])
  eq(cruces(L), 0)
})

test('layout: un ciclo A → B → C → A acaba, y todas sus aristas salen con su from/to', () => {
  const d = diagrama('flowchart TD\n  A --> B --> C --> A\n  C --> C')
  const L = layoutDiagram(d)
  eq(L.edges.map((e) => [e.from, e.to]), [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
    ['C', 'C'],
  ])
  eq(capas(L), [['A'], ['B'], ['C']])
  const caja = (id) => L.nodes.find((n) => n.id === id)
  for (const e of L.edges) {
    assert(e.points.length >= 2, `${e.from}→${e.to} sin puntos`)
    assert(enBorde(e.points[0], caja(e.from)), `${e.from}→${e.to} no sale del borde de ${e.from}`)
    assert(enBorde(e.points[e.points.length - 1], caja(e.to)), `${e.from}→${e.to} no llega al borde de ${e.to}`)
  }
  // La de vuelta sube: sale de C (abajo) y llega a A (arriba).
  const vuelta = L.edges[2]
  assert(vuelta.points[0].y > vuelta.points[vuelta.points.length - 1].y, 'C→A va de abajo arriba')
})

test('layout: LR intercambia los ejes de TD, y RL y BT son su espejo', () => {
  const cadena = 'flowchart TD\n  A --> B --> C --> D --> E\n  B --> X'
  const td = layoutDiagram(diagrama(cadena))
  const lr = layoutDiagram(diagrama(conSentido(cadena, 'LR')))
  assert(td.height > td.width, 'TD es alto')
  assert(lr.width > lr.height, 'LR es ancho')
  assert(lr.width > td.height / 4 && lr.width < td.height * 4, `width LR ${lr.width} y height TD ${td.height}`)
  eq(capas(lr, 'x'), capas(td, 'y'), 'las mismas capas, a lo ancho')
  sinSolapes(lr, 'LR')
  const pos = (L, id) => L.nodes.find((n) => n.id === id)
  const bt = layoutDiagram(diagrama(conSentido(cadena, 'BT')))
  const rl = layoutDiagram(diagrama(conSentido(cadena, 'RL')))
  assert(pos(bt, 'A').y > pos(bt, 'E').y, 'BT: el principio abajo')
  assert(pos(rl, 'A').x > pos(rl, 'E').x, 'RL: el principio a la derecha')
  assert(pos(lr, 'A').x < pos(lr, 'E').x && pos(td, 'A').y < pos(td, 'E').y)
  eq(capas(bt).reverse(), capas(td), 'BT es TD al revés')
  eq(capas(rl, 'x').reverse(), capas(lr, 'x'), 'RL es LR al revés')
})

// Revisión adversaria de H24, D09: `enBorde` sólo se miraba en TD, donde er === h,
// y un error de ejes en LR/RL (la punta de la flecha dentro del nodo) no lo veía nadie.
test('layout: en las cuatro direcciones cada arista sale del borde de from y llega al de to', () => {
  const grafos = [FLUJO, 'flowchart TD\n  A --> B --> C --> A\n  C --> C', 'flowchart TD\n  A --> B --> C --> D --> E\n  B --> X']
  for (const src of grafos) {
    for (const dir of ['TD', 'LR', 'RL', 'BT']) {
      const L = layoutDiagram(diagrama(conSentido(src, dir)))
      const caja = (id) => L.nodes.find((n) => n.id === id)
      for (const e of L.edges) {
        const [p, q] = [e.points[0], e.points[e.points.length - 1]]
        assert(enBorde(p, caja(e.from)), `${dir}: ${e.from}→${e.to} no sale del borde de ${e.from} (${p.x}, ${p.y})`)
        assert(enBorde(q, caja(e.to)), `${dir}: ${e.from}→${e.to} no llega al borde de ${e.to} (${q.x}, ${q.y})`)
      }
    }
  }
})

// Revisión adversaria de H24, D09 (con la forma de D12: dos puntos por ficticio).
test('layout: el grosor de una capa es nodeH como mínimo y la etiqueta va en el tramo del medio', () => {
  const { nodeH, gapY } = LAYOUT_LIMITS
  const L = layoutDiagram(diagrama('flowchart TD\n  A --> B --> C --> D\n  A -->|salta| D'))
  const y = (id) => L.nodes.find((n) => n.id === id).y
  for (const n of L.nodes) eq(n.lines.length, 1, n.id)
  for (const [a, b] of [['A', 'B'], ['B', 'C'], ['C', 'D']]) near(y(b) - y(a), nodeH + gapY, 0.11, `${a}→${b}: una capa de un renglón mide nodeH`)
  const larga = L.edges[3]
  eq([larga.from, larga.to, larga.points.length], ['A', 'D', 6], 'A→D salta dos capas: cinco tramos')
  const [p, q] = [larga.points[2], larga.points[3]]
  near(larga.labelAt.x, (p.x + q.x) / 2, 0.11, 'labelAt.x en el tramo del medio')
  near(larga.labelAt.y, (p.y + q.y) / 2, 0.11, 'labelAt.y en el tramo del medio')
})

test('layout: ningún par de nodos se solapa (tampoco los de una capa ancha)', () => {
  const ancho = 'flowchart TD\n  R --> A & B & C & D & E & F & G\n  A & B & C & D --> Z\n  G --> Z'
  const grafos = [FLUJO, ancho, conSentido(ancho, 'LR'), 'flowchart TD\n  A --> B --> C --> A\n  A --> C']
  for (const src of grafos) sinSolapes(layoutDiagram(diagrama(src)), src.slice(0, 30))
  const L = layoutDiagram(diagrama(ancho))
  const capa = L.nodes.filter((n) => 'ABCDEFG'.includes(n.id)).sort((a, b) => a.x - b.x)
  for (let k = 1; k < capa.length; k++) {
    assert(capa[k].x - (capa[k - 1].x + capa[k - 1].w) >= LAYOUT_LIMITS.gapX - 0.11, 'con su hueco')
  }
})

test('layout: width y height cubren todos los nodos, los puntos, los subgrafos y las etiquetas', () => {
  for (const dir of ['TD', 'LR', 'RL', 'BT']) {
    const d = diagrama(conSentido(FLUJO, dir))
    const L = layoutDiagram(d)
    assert(L.width > 0 && L.height > 0)
    dentro(L, dir, d)
  }
  const bucle = diagrama('flowchart TD\n  A --> A\n  A -->|una etiqueta bastante larga| B')
  dentro(layoutDiagram(bucle), 'bucle', bucle)
})

test('layout: determinista (la misma entrada da el mismo JSON)', () => {
  const d = diagrama(FLUJO)
  eq(layoutDiagram(d), layoutDiagram(d))
  eq(layoutDiagram(diagrama(FLUJO)), layoutDiagram(d), 'también leyendo otra vez')
  const denso = 'flowchart LR\n' + Array.from({ length: 20 }, (_, i) => `  N${i} --> N${(i * 7 + 3) % 20} & N${(i * 3 + 1) % 20}`).join('\n')
  eq(layoutDiagram(diagrama(denso)), layoutDiagram(diagrama(denso)))
})

test('layout: 30 nodos en cadena en menos de 50 ms', () => {
  const cadena = diagrama('flowchart TD\n' + Array.from({ length: 29 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n'))
  eq(cadena.nodes.length, 30)
  const t0 = performance.now()
  const L = layoutDiagram(cadena)
  const ms = performance.now() - t0
  eq(L.nodes.length, 30)
  assert(ms < 50, `tardó ${ms.toFixed(1)} ms`)
})

test('layout: la medida inyectada cambia w y lines; h = renglones · lineH + 2 · padY', () => {
  const d = diagrama('flowchart TD\n  A[ENG-7 Definir la API de rotación] --> B[x]')
  const normal = layoutDiagram(d).nodes[0]
  const ancha = layoutDiagram(d, { measure: (t) => t.length * 12 }).nodes[0]
  const nula = layoutDiagram(d, { measure: () => 0 }).nodes[0]
  assert(ancha.lines.length > normal.lines.length, `${JSON.stringify(ancha.lines)} frente a ${JSON.stringify(normal.lines)}`)
  eq(nula.lines, ['ENG-7 Definir la API de rotación'], 'si todo cabe, un renglón')
  eq(nula.w, LAYOUT_LIMITS.nodeMinW)
  eq(ancha.w, LAYOUT_LIMITS.nodeMaxW)
  assert(normal.w !== nula.w)
  for (const n of [normal, ancha, nula]) eq(n.h, n.lines.length * LAYOUT_LIMITS.lineH + 2 * LAYOUT_LIMITS.padY)
  eq(layoutDiagram(d).nodes[1].w, LAYOUT_LIMITS.nodeMinW, 'nunca por debajo de nodeMinW')
  // Una medida que falla cae en la estimación de charW por carácter.
  eq(layoutDiagram(d, { measure: () => NaN }), layoutDiagram(d))
  eq(layoutDiagram(d, { measure: () => -5 }), layoutDiagram(d), 'una medida negativa también se estima')
  eq(layoutDiagram(d, { measure: () => { throw new Error('sin canvas') } }), layoutDiagram(d))
  eq(layoutDiagram(d, { measure: 'no es una función' }), layoutDiagram(d))
})

test('layout: como mucho maxLines renglones, y el último con «…» si no cabe', () => {
  const largo = 'palabra '.repeat(10).trim()
  const n = layoutDiagram(diagrama(`flowchart TD\n  A[${largo}] --> B[${'X'.repeat(70)}]`)).nodes
  eq(n[0].lines.length, LAYOUT_LIMITS.maxLines)
  assert(n[0].lines[2].endsWith('…'), JSON.stringify(n[0].lines))
  eq(n[0].h, LAYOUT_LIMITS.maxLines * LAYOUT_LIMITS.lineH + 2 * LAYOUT_LIMITS.padY)
  eq(n[1].lines.join('').replace('…', ''), 'X'.repeat(n[1].lines.join('').length - 1), 'una palabra larga se corta por caracteres')
  for (const x of n) {
    assert(x.w <= LAYOUT_LIMITS.nodeMaxW)
    for (const l of x.lines) assert(l.length * LAYOUT_LIMITS.charW <= LAYOUT_LIMITS.nodeMaxW - 2 * LAYOUT_LIMITS.padX, l)
  }
})

test('layout: con ok:false o sin nodos, todo vacío; nunca lanza', () => {
  eq(layoutDiagram(readFlowchart('sequenceDiagram\n  A->>B: x')), VACIO)
  eq(layoutDiagram({ ok: true, direction: 'TD', nodes: [], edges: [], subgraphs: [] }), VACIO)
  eq(layoutDiagram({ ok: false, direction: 'TD', nodes: [{ id: 'A' }, { id: 'B' }], edges: [], subgraphs: [] }), VACIO, 'ok:false aunque traiga nodos')
  for (const x of [null, undefined, 42, 'flowchart TD', [], { ok: true }, { ok: true, nodes: [null, 3] }]) eq(layoutDiagram(x), VACIO)
  const trampa = new Proxy({}, { get() { throw new Error('trampa') } })
  eq(layoutDiagram(trampa), VACIO)
  // Aristas a nodos que no están, o sin nodos válidos: no rompe.
  const raro = layoutDiagram({ ok: true, direction: 'XX', nodes: [{ id: 'A', label: 'a' }, { id: 'B' }], edges: [{ from: 'A', to: 'Q' }, { from: 'A', to: 'B' }] })
  eq(raro.nodes.map((n) => n.id), ['A', 'B'])
  eq(raro.edges.map((e) => [e.from, e.to]), [['A', 'B']])
})

/** Un tramo corta el rectángulo del nodo encogido 1 px (Liang-Barsky): pasa POR DENTRO, no roza el borde. */
function cortaNodo(p, q, n) {
  const [x0, x1, y0, y1] = [n.x + 1, n.x + n.w - 1, n.y + 1, n.y + n.h - 1]
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (pp === 0) {
      if (qq < 0) return false
      continue
    }
    const r = qq / pp
    if (pp < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t0 < t1
}

/** La caja de cada etiqueta (medida con la estimación por defecto), centrada en su labelAt. */
function cajasDeEtiqueta(d, L) {
  const out = []
  L.edges.forEach((e, i) => {
    if (!e.labelAt) return
    const w = d.edges[i].label.length * LAYOUT_LIMITS.charW
    out.push({ i, label: d.edges[i].label, x: e.labelAt.x - w / 2, y: e.labelAt.y - LAYOUT_LIMITS.lineH / 2, w, h: LAYOUT_LIMITS.lineH })
  })
  return out
}

/** La distancia de un punto a la polilínea más cercana de sus tramos. */
function distanciaAPolilinea(p, puntos) {
  let mejor = Infinity
  for (let k = 1; k < puntos.length; k++) {
    const a = puntos[k - 1]
    const b = puntos[k]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    mejor = Math.min(mejor, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return mejor
}

const LARGAS = ['flowchart TD', '  A --> B --> C --> D', '  A --> D', '  A --> E', '  E --> F --> D', '  B --> G'].join('\n')
/** B, fino, comparte capa con T, grueso: en LR/RL la diagonal de B→Z salía por la franja de T. */
const GRUESO = 'flowchart TD\n  A[palabra palabra] --> Z\n  T[palabra palabra palabra palabra] --> Z\n  T --> Z\n  B --> Z'

test('layout: ningún tramo de una arista pasa por dentro de un nodo que no sea su from o su to', () => {
  for (const src of [LARGAS, FLUJO, GRUESO]) {
    for (const dir of ['TD', 'BT', 'LR', 'RL']) {
      const d = diagrama(conSentido(src, dir))
      const L = layoutDiagram(d)
      eq(L.edges.length, d.edges.length, 'todas las aristas salen')
      for (const e of L.edges) {
        for (let k = 0; k < e.points.length - 1; k++) {
          for (const n of L.nodes) {
            if (n.id === e.from || n.id === e.to) continue
            assert(!cortaNodo(e.points[k], e.points[k + 1], n), `${dir}: ${e.from}→${e.to} pasa por dentro de ${n.id}`)
          }
        }
      }
    }
  }
})

test('layout: dos aristas entre los mismos nodos no se superponen, tampoco en sentidos opuestos', () => {
  for (const src of ['flowchart TD\n  A -->|sí| B\n  A -->|no| B', 'flowchart TD\n  A --> B\n  B --> A', 'flowchart TD\n  A -->|sí| B\n  A -->|no| B\n  A -->|quizá| B']) {
    for (const dir of ['TD', 'BT', 'LR', 'RL']) {
      const d = diagrama(conSentido(src, dir))
      const L = layoutDiagram(d)
      eq(L.edges.length, d.edges.length, 'todas las aristas salen')
      const caja = new Map(L.nodes.map((n) => [n.id, n]))
      const vistas = L.edges.map((e) => JSON.stringify(e.from === 'A' ? e.points : [...e.points].reverse()))
      eq(new Set(vistas).size, L.edges.length, `${dir}: ${src.split('\n').slice(1).join(' · ')}: dos aristas con los mismos puntos`)
      for (const e of L.edges) {
        assert(enBorde(e.points[0], caja.get(e.from)), `${dir}: ${e.from}→${e.to} sale del borde`)
        assert(enBorde(e.points[e.points.length - 1], caja.get(e.to)), `${dir}: ${e.from}→${e.to} llega al borde`)
      }
      const cajas = cajasDeEtiqueta(d, L)
      for (let a = 0; a < cajas.length; a++) {
        for (let b = a + 1; b < cajas.length; b++) {
          assert(!solapan(cajas[a], cajas[b]), `${dir}: «${cajas[a].label}» y «${cajas[b].label}» se pisan`)
        }
      }
    }
  }
})

test('layout: ninguna etiqueta de arista queda debajo de un nodo ni de otra etiqueta', () => {
  const casos = [
    'flowchart TD\n  A -->|depende de| B',
    FLUJO,
    'flowchart TD\n  A -->|revisar el contrato de la API| B',
    'flowchart TD\n  A --> B --> C\n  A --> X --> C\n  A -->|salta una capa| C',
    'flowchart TD\n  A -->|sí| B\n  A -->|no| B\n  A -->|quizá| B',
    'flowchart TD\n  X --> A\n  X --> B\n  A -->|otra vez| A',
    'flowchart TD\n  X --> A\n  X --> B\n  A -->|otra vez| A\n  A -->|y otra| A',
    // En LR/RL la etiqueta de un lazo, más ancha que su capa, tapaba a X en la capa de antes.
    'flowchart TD\n  X --> A --> C\n  X --> B\n  A -->|revisar el contrato de la API| A',
    // H25 (D07): «Según Jira» etiqueta TODAS sus aristas: un par paralelo y otra que salta capa desde el mismo nodo.
    'flowchart TD\n  A -->|blocks| B\n  B -->|relates to| A\n  B -->|blocks| C\n  A -->|blocks| C',
    // Y tres que llegan al mismo nodo: una sola vuelta de la relajación no basta.
    'flowchart TD\n  D -->|relates to| B\n  A -->|relates to| B\n  C -->|relates to| B',
    // Y un ciclo con un par paralelo: empujar sólo una de las dos la aleja más de 3·lineH de su arista.
    'flowchart TD\n  B -->|duplicates| A\n  C -->|blocks| B\n  C -->|relates to| B\n  A -->|relates to| C',
  ]
  for (const src of casos) {
    for (const dir of ['TD', 'BT', 'LR', 'RL']) {
      const d = diagrama(conSentido(src, dir))
      const L = layoutDiagram(d)
      eq(L.edges.length, d.edges.length, 'todas las aristas salen')
      const cajas = cajasDeEtiqueta(d, L)
      eq(cajas.length, d.edges.filter((e) => e.label).length, 'todas las etiquetas salen')
      cajas.forEach((c, k) => {
        for (const n of L.nodes) assert(!solapan(c, n), `${dir}: «${c.label}» queda debajo de ${n.id}`)
        for (const o of cajas.slice(k + 1)) assert(!solapan(c, o), `${dir}: «${c.label}» y «${o.label}» se pisan`)
        // Apartarla no la despega de su arista: el coste de D07 (revisión de H25),
        // vigilado. Un lazo lleva la etiqueta en la franja de su capa y no se aparta.
        const e = L.edges[c.i]
        const lejos = e.from === e.to ? 0 : distanciaAPolilinea(e.labelAt, e.points)
        assert(lejos <= 3 * LAYOUT_LIMITS.lineH, `${dir}: «${c.label}» queda a ${lejos} px de su arista`)
      })
    }
  }
})
