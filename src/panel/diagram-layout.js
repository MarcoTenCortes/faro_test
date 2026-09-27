/**
 * Dónde va cada nodo y cada arista de un diagrama del chat.
 *
 * POR QUÉ EXISTE (H24; docs/PLAN2.md §3.5 y docs/plan/anexo-2-E-diagramas.md):
 * Faro pinta él mismo los diagramas Mermaid que escribe el modelo (sin Mermaid,
 * sin viz.js, sin `innerHTML`), y alguien tiene que decidir las coordenadas.
 * Esto es un Sugiyama simplificado, lo justo para un flujo de 6-15 incidencias:
 * los ciclos se rompen por DFS (la arista de vuelta se invierte SÓLO para
 * ordenar las capas: en la salida conserva su `from` y su `to`), las capas salen
 * del camino más largo, una arista que salta capas pasa por puntos intermedios
 * (nodos ficticios que no se dibujan), el orden dentro de cada capa baja los
 * cruces por baricentro, y `LR`/`RL`/`BT` son `TD` transpuesto o en espejo. Si
 * con grafos densos se queda corto, el plan B es `dagre` SIN cambiar esta forma
 * de salida (docs/PLAN2.md §3.5): se anota, no se hace.
 *
 * La anchura del texto se INYECTA (`measure`): en el panel es `canvas.measureText`
 * con la fuente real del chat (diagram-view.js), en Node la estimación de
 * `charW` por carácter. Así las pruebas corren sin DOM y el panel no adivina.
 *
 * Forma de la salida: `x`/`y` de un nodo y de un subgrafo son su esquina
 * SUPERIOR IZQUIERDA; los `points` de una arista van del borde de `from` al
 * borde de `to` (la punta de la flecha no queda debajo del nodo); `labelAt` es
 * el CENTRO de la etiqueta de la arista. `width`/`height` lo cubren todo con un
 * margen de `padX`: nada se sale del viewBox.
 *
 * Puro y determinista: la misma entrada da el mismo JSON; nunca lanza.
 */

export const LAYOUT_LIMITS = Object.freeze({
  nodeMinW: 64,
  nodeMaxW: 180,
  /** El grosor mínimo de una capa: una de nodos de un renglón no queda apretada. */
  nodeH: 36,
  lineH: 16,
  padX: 12,
  padY: 8,
  gapX: 28,
  gapY: 40,
  subPad: 12,
  maxLines: 3,
  charW: 6.6,
})

function vacio() {
  return { width: 0, height: 0, nodes: [], edges: [], subgraphs: [] }
}

/**
 * Coloca un diagrama validado (`readFlowchart`).
 *
 * @param {object} diagram `{ok, direction, nodes, edges, subgraphs}`
 * @param {{measure?: (text: string) => number}} [opciones] la anchura en px de un texto
 * @returns {{width: number, height: number, nodes: object[], edges: object[], subgraphs: object[]}}
 *          `nodes` y `edges` en el MISMO orden que los del diagrama; con `ok: false`
 *          o sin nodos, todo a cero y vacío
 */
export function layoutDiagram(diagram, { measure = (t) => t.length * LAYOUT_LIMITS.charW } = {}) {
  try {
    return colocar(diagram, medidor(measure))
  } catch {
    return vacio()
  }
}

/** Una `measure` que devuelva basura o lance no rompe el dibujo: cae en la estimación. */
function medidor(measure) {
  const estimada = (t) => t.length * LAYOUT_LIMITS.charW
  const f = typeof measure === 'function' ? measure : estimada
  return (t) => {
    let m
    try {
      m = Number(f(t))
    } catch {
      m = NaN
    }
    return Number.isFinite(m) && m >= 0 ? m : estimada(t)
  }
}

/**
 * La etiqueta en renglones que caben en `nodeMaxW - 2·padX`, como mucho
 * `maxLines`; si sobra, el último acaba en «…». Una palabra que no cabe sola se
 * corta por caracteres (una URL, una clave larga).
 */
function partir(texto, medir) {
  const L = LAYOUT_LIMITS
  const cabe = L.nodeMaxW - 2 * L.padX
  const lineas = []
  let actual = ''
  for (const palabra of String(texto).split(' ').filter(Boolean)) {
    const junto = actual ? actual + ' ' + palabra : palabra
    if (medir(junto) <= cabe) {
      actual = junto
      continue
    }
    if (actual) lineas.push(actual)
    actual = ''
    if (medir(palabra) <= cabe) {
      actual = palabra
      continue
    }
    for (const c of palabra) {
      if (actual && medir(actual + c) > cabe) {
        lineas.push(actual)
        actual = c
      } else actual += c
    }
  }
  if (actual) lineas.push(actual)
  if (!lineas.length) lineas.push('')
  if (lineas.length <= L.maxLines) return lineas
  const cortadas = lineas.slice(0, L.maxLines)
  let ultima = cortadas[L.maxLines - 1]
  while (ultima && medir(ultima + '…') > cabe) ultima = Array.from(ultima).slice(0, -1).join('').trimEnd()
  cortadas[L.maxLines - 1] = ultima + '…'
  return cortadas
}

/** Cruces entre capas consecutivas con el orden de `pos`. */
function contarCruces(capas, abajo, pos) {
  let total = 0
  for (let r = 0; r < capas.length - 1; r++) {
    const segs = []
    for (const u of capas[r]) for (const v of abajo.get(u)) segs.push([pos.get(u), pos.get(v)])
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        if ((segs[a][0] - segs[b][0]) * (segs[a][1] - segs[b][1]) < 0) total++
      }
    }
  }
  return total
}

const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const decima = (v) => Math.round(v * 10) / 10

function colocar(diagram, medir) {
  if (!diagram || diagram.ok !== true || !Array.isArray(diagram.nodes) || !diagram.nodes.length) return vacio()
  const L = LAYOUT_LIMITS
  const dir = ['TD', 'LR', 'RL', 'BT'].includes(diagram.direction) ? diagram.direction : 'TD'
  const horizontal = dir === 'LR' || dir === 'RL'

  // 1. Tamaño de cada nodo real.
  const nodo = new Map()
  const reales = []
  for (const n of diagram.nodes) {
    if (!n || typeof n.id !== 'string' || nodo.has(n.id)) continue
    const lines = partir(typeof n.label === 'string' && n.label ? n.label : n.id, medir)
    const ancho = Math.max(0, ...lines.map((l) => medir(l)))
    const w = Math.min(L.nodeMaxW, Math.max(L.nodeMinW, Math.ceil(ancho + 2 * L.padX)))
    const h = lines.length * L.lineH + 2 * L.padY
    const info = { id: n.id, w, h, lines, sub: typeof n.sub === 'string' ? n.sub : '', ficticio: false }
    nodo.set(n.id, info)
    reales.push(info)
  }
  if (!reales.length) return vacio()
  const aristas = (Array.isArray(diagram.edges) ? diagram.edges : []).filter(
    (e) => e && nodo.has(e.from) && nodo.has(e.to)
  )

  // 2. Ciclos rotos por DFS (iterativo): la arista que vuelve a la pila se invierte.
  const salientes = new Map(reales.map((n) => [n.id, []]))
  aristas.forEach((e, i) => {
    if (e.from !== e.to) salientes.get(e.from).push(i)
  })
  const estado = new Map()
  const invertida = new Set()
  for (const raiz of reales) {
    if (estado.get(raiz.id)) continue
    estado.set(raiz.id, 1)
    const pila = [[raiz.id, 0]]
    while (pila.length) {
      const cima = pila[pila.length - 1]
      const lista = salientes.get(cima[0])
      if (cima[1] < lista.length) {
        const i = lista[cima[1]++]
        const v = aristas[i].to
        if (estado.get(v) === 1) invertida.add(i)
        else if (!estado.get(v)) {
          estado.set(v, 1)
          pila.push([v, 0])
        }
      } else {
        estado.set(cima[0], 2)
        pila.pop()
      }
    }
  }
  const dag = []
  aristas.forEach((e, i) => {
    if (e.from === e.to) return
    dag.push(invertida.has(i) ? { i, a: e.to, b: e.from } : { i, a: e.from, b: e.to })
  })

  // 3. Capas por el camino más largo (Kahn, en el orden de los nodos).
  const entrantes = new Map(reales.map((n) => [n.id, 0]))
  const sucesores = new Map(reales.map((n) => [n.id, []]))
  for (const d of dag) {
    entrantes.set(d.b, entrantes.get(d.b) + 1)
    sucesores.get(d.a).push(d.b)
  }
  const rango = new Map(reales.map((n) => [n.id, 0]))
  const cola = reales.filter((n) => !entrantes.get(n.id)).map((n) => n.id)
  for (let k = 0; k < cola.length; k++) {
    const u = cola[k]
    for (const v of sucesores.get(u)) {
      rango.set(v, Math.max(rango.get(v), rango.get(u) + 1))
      entrantes.set(v, entrantes.get(v) - 1)
      if (!entrantes.get(v)) cola.push(v)
    }
  }

  // 4. Ficticios: una arista que salta capas pasa por un punto en cada una.
  const cadenas = new Map()
  const arriba = new Map(reales.map((n) => [n.id, []]))
  const abajo = new Map(reales.map((n) => [n.id, []]))
  const ficticios = []
  for (const d of dag) {
    const ids = [d.a]
    for (let r = rango.get(d.a) + 1; r < rango.get(d.b); r++) {
      const id = `~${d.i}~${r}`
      nodo.set(id, { id, w: 0, h: 0, lines: [], sub: '', ficticio: true })
      rango.set(id, r)
      arriba.set(id, [])
      abajo.set(id, [])
      ficticios.push(id)
      ids.push(id)
    }
    ids.push(d.b)
    for (let k = 0; k < ids.length - 1; k++) {
      abajo.get(ids[k]).push(ids[k + 1])
      arriba.get(ids[k + 1]).push(ids[k])
    }
    cadenas.set(d.i, ids)
  }
  const nCapas = Math.max(...reales.map((n) => rango.get(n.id))) + 1
  let capas = Array.from({ length: nCapas }, () => [])
  for (const n of reales) capas[rango.get(n.id)].push(n.id)
  for (const id of ficticios) capas[rango.get(id)].push(id)

  // 5. Orden por baricentro: dos pasadas abajo/arriba, y se queda el mejor.
  const pos = new Map()
  const fijar = () => capas.forEach((c) => c.forEach((id, i) => pos.set(id, i)))
  fijar()
  const ordenar = (capa, vecinos) => {
    const bc = new Map(
      capa.map((id) => {
        const vs = vecinos.get(id)
        return [id, vs.length ? media(vs.map((v) => pos.get(v))) : pos.get(id)]
      })
    )
    capa.sort((a, b) => bc.get(a) - bc.get(b) || pos.get(a) - pos.get(b))
    capa.forEach((id, i) => pos.set(id, i))
  }
  let mejor = capas.map((c) => c.slice())
  let menosCruces = contarCruces(capas, abajo, pos)
  const apuntar = () => {
    const c = contarCruces(capas, abajo, pos)
    if (c < menosCruces) {
      menosCruces = c
      mejor = capas.map((x) => x.slice())
    }
  }
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let r = 1; r < nCapas; r++) ordenar(capas[r], arriba)
    apuntar()
    for (let r = nCapas - 2; r >= 0; r--) ordenar(capas[r], abajo)
    apuntar()
  }
  capas = mejor
  fijar()
  // Los de un mismo subgrafo, juntos en su capa, si no añade cruces.
  const agrupadas = capas.map((c) => {
    const out = []
    for (const id of c) {
      if (out.includes(id)) continue
      const sub = nodo.get(id).sub
      if (sub) out.push(...c.filter((x) => nodo.get(x).sub === sub))
      else out.push(id)
    }
    return out
  })
  const posAgrupada = new Map()
  agrupadas.forEach((c) => c.forEach((id, i) => posAgrupada.set(id, i)))
  if (contarCruces(agrupadas, abajo, posAgrupada) <= menosCruces) {
    capas = agrupadas
    fijar()
  }

  // 6. Coordenadas abstractas: `a` a lo ancho de la capa, `r` a lo largo del flujo.
  const ea = (id) => (horizontal ? nodo.get(id).h : nodo.get(id).w)
  const er = (id) => (horizontal ? nodo.get(id).w : nodo.get(id).h)
  const A = new Map()
  for (const c of capas) {
    let x = 0
    for (const id of c) {
      A.set(id, x + ea(id) / 2)
      x += ea(id) + L.gapX
    }
  }
  for (let it = 0; it < 4; it++) {
    const bajando = it % 2 === 0
    const orden = []
    if (bajando) for (let r = 1; r < nCapas; r++) orden.push(r)
    else for (let r = nCapas - 2; r >= 0; r--) orden.push(r)
    for (const r of orden) {
      const c = capas[r]
      for (const id of c) {
        const vs = (bajando ? arriba : abajo).get(id)
        if (vs.length) A.set(id, media(vs.map((v) => A.get(v))))
      }
      for (let k = 1; k < c.length; k++) {
        const min = A.get(c[k - 1]) + ea(c[k - 1]) / 2 + L.gapX + ea(c[k]) / 2
        if (A.get(c[k]) < min) A.set(c[k], min)
      }
    }
  }
  const R = []
  let inicio = 0
  for (const c of capas) {
    const grosor = Math.max(L.nodeH, ...c.map(er))
    R.push(inicio + grosor / 2)
    inicio += grosor + L.gapY
  }
  const centroAbs = (id) => [A.get(id), R[rango.get(id)]]
  const aFinal = ([a, r]) =>
    dir === 'TD' ? [a, r] : dir === 'BT' ? [a, -r] : dir === 'LR' ? [r, a] : [-r, a]

  // 7. Nodos, aristas y subgrafos en coordenadas finales (antes del margen).
  const nodes = reales.map((n) => {
    const [cx, cy] = aFinal(centroAbs(n.id))
    return { id: n.id, x: cx - n.w / 2, y: cy - n.h / 2, w: n.w, h: n.h, lines: n.lines }
  })
  const caja = new Map(nodes.map((n) => [n.id, n]))
  const edges = aristas.map((e, i) => {
    let abs
    if (e.from === e.to) {
      const [a, r] = centroAbs(e.from)
      const borde = a + ea(e.from) / 2
      const q = er(e.from) / 4
      abs = [
        [borde, r - q],
        [borde + L.gapX / 2, r - q],
        [borde + L.gapX / 2, r + q],
        [borde, r + q],
      ]
    } else {
      const ids = cadenas.get(i)
      abs = ids.map((id, k) => {
        const [a, r] = centroAbs(id)
        if (k === 0) return [a, r + er(id) / 2]
        if (k === ids.length - 1) return [a, r - er(id) / 2]
        return [a, r]
      })
      if (invertida.has(i)) abs.reverse()
    }
    const points = abs.map((p) => {
      const [x, y] = aFinal(p)
      return { x, y }
    })
    let labelAt = null
    if (typeof e.label === 'string' && e.label) {
      const k = Math.floor((points.length - 1) / 2)
      labelAt = { x: (points[k].x + points[k + 1].x) / 2, y: (points[k].y + points[k + 1].y) / 2 }
    }
    return { from: e.from, to: e.to, points, labelAt, label: typeof e.label === 'string' ? e.label : '' }
  })
  const subgraphs = []
  for (const s of Array.isArray(diagram.subgraphs) ? diagram.subgraphs : []) {
    if (!s || typeof s.id !== 'string') continue
    const miembros = nodes.filter((n) => nodo.get(n.id).sub === s.id)
    if (!miembros.length) continue
    const x0 = Math.min(...miembros.map((n) => n.x))
    const y0 = Math.min(...miembros.map((n) => n.y))
    const x1 = Math.max(...miembros.map((n) => n.x + n.w))
    const y1 = Math.max(...miembros.map((n) => n.y + n.h))
    subgraphs.push({
      id: s.id,
      x: x0 - L.subPad,
      y: y0 - L.subPad - L.lineH,
      w: x1 - x0 + 2 * L.subPad,
      h: y1 - y0 + 2 * L.subPad + L.lineH,
    })
  }

  // 8. El marco: todo dentro, con `padX` de margen, y a décimas de px.
  const xs = []
  const ys = []
  for (const b of [...nodes, ...subgraphs]) {
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
  }
  for (const e of edges) {
    for (const p of e.points) {
      xs.push(p.x)
      ys.push(p.y)
    }
    if (e.labelAt) {
      const mitad = medir(e.label) / 2
      xs.push(e.labelAt.x - mitad, e.labelAt.x + mitad)
      ys.push(e.labelAt.y - L.lineH / 2, e.labelAt.y + L.lineH / 2)
    }
  }
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const dx = L.padX - minX
  const dy = L.padX - minY
  const px = (v) => decima(v + dx)
  const py = (v) => decima(v + dy)
  return {
    width: Math.ceil(Math.max(...xs) - minX + 2 * L.padX),
    height: Math.ceil(Math.max(...ys) - minY + 2 * L.padX),
    nodes: nodes.map((n) => ({ id: n.id, x: px(n.x), y: py(n.y), w: n.w, h: n.h, lines: n.lines })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      points: e.points.map((p) => ({ x: px(p.x), y: py(p.y) })),
      labelAt: e.labelAt ? { x: px(e.labelAt.x), y: py(e.labelAt.y) } : null,
    })),
    subgraphs: subgraphs.map((s) => ({ id: s.id, x: px(s.x), y: py(s.y), w: decima(s.w), h: decima(s.h) })),
  }
}
