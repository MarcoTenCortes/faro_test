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
 * (nodos ficticios que no se dibujan) que entran y salen de su capa en vertical,
 * por su hueco, y un extremo más fino que su capa sale de ella igual: ningún
 * tramo cruza a un nodo ajeno. El orden dentro de cada capa baja los cruces por
 * baricentro; los de un subgrafo van SIEMPRE juntos, los subgrafos en un mismo
 * orden en todas las capas, y cada caja tiene su franja de su primera a su
 * última capa, donde no entra nadie ajeno ni otro subgrafo. Dos aristas entre
 * los mismos nodos van en paralelo con un codo a `edgeSep`, y el hueco entre
 * capas crece para que ninguna etiqueta quede bajo un nodo (revisión adversaria
 * de H24, D11 y D12); las etiquetas de aristas distintas que se pisan en un
 * mismo hueco se apartan a lo ancho de la capa (revisión adversaria de H25,
 * D07). `LR`/`RL`/`BT` son `TD` transpuesto o en espejo. Si
 * con grafos densos se queda corto, el plan B es `dagre` SIN cambiar esta forma
 * de salida (docs/PLAN2.md §3.5): se anota, no se hace.
 *
 * La anchura del texto se INYECTA (`measure`): en el panel es `canvas.measureText`
 * con la fuente real del chat (diagram-view.js), en Node la estimación de
 * `charW` por carácter. Así las pruebas corren sin DOM y el panel no adivina.
 *
 * Forma de la salida: `x`/`y` de un nodo y de un subgrafo son su esquina
 * SUPERIOR IZQUIERDA; los `points` de una arista van del borde de `from` al
 * borde de `to` (la punta de la flecha no queda debajo del nodo), en las cuatro
 * direcciones; `labelAt` es el CENTRO de la etiqueta de la arista, siempre en un
 * tramo de hueco entre capas (o junto a su lazo en un autoenlace), nunca en el
 * vertical de una capa. `width`/`height` lo cubren todo con un margen de `padX`
 * en los cuatro lados: nada se sale del viewBox.
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
  /** Separación entre dos aristas que unen los mismos dos nodos (revisión adversaria de H24, D12). */
  edgeSep: 16,
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
  // Los de un mismo subgrafo, juntos en su capa SIEMPRE, y los subgrafos en el
  // MISMO orden en todas: si no, la caja que envuelve a los suyos taparía a quien
  // no lo es (revisión adversaria de H24, D11: antes se agrupaba «si no añade
  // cruces» y B, de fuera, quedaba dentro de la caja de A y C).
  const listados = (Array.isArray(diagram.subgraphs) ? diagram.subgraphs : [])
    .map((s) => (s && typeof s.id === 'string' ? s.id : ''))
    .filter(Boolean)
  const subDe = (id) => (listados.includes(nodo.get(id).sub) ? nodo.get(id).sub : '')
  const ordenSub = new Map()
  listados
    .map((s, i) => {
      const ps = reales.filter((n) => subDe(n.id) === s).map((n) => pos.get(n.id))
      return [s, ps.length ? media(ps) : NaN, i]
    })
    .filter(([, m]) => Number.isFinite(m))
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .forEach(([s], k) => ordenSub.set(s, k))
  const enOrden = (unidades) => {
    const huecos = []
    unidades.forEach((u, i) => u.s && huecos.push(i))
    const bloques = huecos.map((i) => unidades[i]).sort((a, b) => ordenSub.get(a.s) - ordenSub.get(b.s))
    huecos.forEach((i, k) => (unidades[i] = bloques[k]))
    return unidades
  }
  // Una capa en bloques: cada suelto es uno, los de un subgrafo otro (en su orden
  // de `peso`, la media del bloque), y los bloques de subgrafo en `ordenSub`.
  const agrupar = (capa, peso) => {
    const unidades = []
    const deSub = new Map()
    for (const id of capa) {
      const s = subDe(id)
      if (!s) unidades.push({ clave: peso(id), ids: [id], s: '' })
      else if (deSub.has(s)) deSub.get(s).ids.push(id)
      else {
        const u = { clave: 0, ids: [id], s }
        deSub.set(s, u)
        unidades.push(u)
      }
    }
    for (const u of deSub.values()) {
      u.ids.sort((a, b) => peso(a) - peso(b) || pos.get(a) - pos.get(b))
      u.clave = media(u.ids.map(peso))
    }
    unidades.sort((a, b) => a.clave - b.clave || pos.get(a.ids[0]) - pos.get(b.ids[0]))
    const orden = enOrden(unidades).flatMap((u) => u.ids)
    capa.splice(0, capa.length, ...orden)
    capa.forEach((id, i) => pos.set(id, i))
  }
  if (ordenSub.size) {
    for (const c of capas) agrupar(c, (id) => pos.get(id))
    // El baricentro otra vez, ya por bloques: se queda el que menos cruza.
    mejor = capas.map((c) => c.slice())
    menosCruces = contarCruces(capas, abajo, pos)
    const porBloques = (capa, vecinos) => {
      const bc = new Map(
        capa.map((id) => {
          const vs = vecinos.get(id)
          return [id, vs.length ? media(vs.map((v) => pos.get(v))) : pos.get(id)]
        })
      )
      agrupar(capa, (id) => bc.get(id))
    }
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let r = 1; r < nCapas; r++) porBloques(capas[r], arriba)
      apuntar()
      for (let r = nCapas - 2; r >= 0; r--) porBloques(capas[r], abajo)
      apuntar()
    }
    capas = mejor
  }
  fijar()

  // 6. Coordenadas abstractas: `a` a lo ancho de la capa, `r` a lo largo del flujo.
  // Lo que un autoenlace ocupa más allá del borde de su nodo empuja al vecino:
  // en TD/BT su etiqueta, escrita a la derecha del lazo; y cada lazo de más,
  // uno por fuera del otro (en LR/RL a un renglón, para que sus etiquetas no se
  // pisen). Revisión adversaria de H24, D12: la etiqueta del lazo quedaba bajo el vecino.
  const lazos = new Map()
  for (const e of aristas) {
    if (e.from !== e.to) continue
    const v = lazos.get(e.from) || { n: 0, w: 0 }
    v.n++
    if (typeof e.label === 'string' && e.label) v.w = Math.max(v.w, medir(e.label))
    lazos.set(e.from, v)
  }
  const pasoLazo = horizontal ? L.lineH : L.gapX / 2
  const lazo = new Map(
    [...lazos].map(([id, v]) => [id, (v.n - 1) * pasoLazo + (!horizontal && v.w ? L.padY + v.w : 0)])
  )
  const ea0 = (id) => (horizontal ? nodo.get(id).h : nodo.get(id).w)
  const er = (id) => (horizontal ? nodo.get(id).w : nodo.get(id).h)
  // `ea` para separar vecinos: la anchura del nodo más lo que ocupa la etiqueta de su lazo.
  const ea = (id) => ea0(id) + 2 * (lazo.get(id) || 0)
  // La franja de la cadena por la que va la etiqueta de una arista: entre ids[j] e ids[j+1].
  const tramoEtiqueta = (ids) => Math.floor((ids.length - 2) / 2)
  // Los dos extremos sin orden: A→B y B→A son el mismo par (antes de `hueco`, o TDZ).
  const par = (e) => (e.from < e.to ? e.from + '\n' + e.to : e.to + '\n' + e.from)
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
  // Las franjas: la caja de un subgrafo va de su primera capa a la última, y en
  // TODAS ellas nadie ajeno ni otro subgrafo entra en su franja (con subPad a
  // cada lado y lineH del título, que en LR/RL cae a lo ancho). Sólo se empuja
  // hacia `a` creciente: el orden de cada capa se conserva, y como el orden de
  // los subgrafos es el mismo en todas, la relajación converge (revisión
  // adversaria de H24, D11: dos subgrafos se solapaban y una capa sin miembros
  // dejaba a un ajeno dentro de la caja).
  if (ordenSub.size) {
    const extIni = L.subPad + (horizontal ? L.lineH : 0)
    const franja = new Map()
    for (const n of reales) {
      const s = subDe(n.id)
      if (!s) continue
      const r = rango.get(n.id)
      const lo = A.get(n.id) - ea(n.id) / 2
      const hi = A.get(n.id) + ea(n.id) / 2
      const f = franja.get(s)
      if (!f) franja.set(s, { r0: r, r1: r, lo, hi })
      else Object.assign(f, { r0: Math.min(f.r0, r), r1: Math.max(f.r1, r), lo: Math.min(f.lo, lo), hi: Math.max(f.hi, hi) })
    }
    const clave = (u) => (u.s ? 's:' + u.s : 'n:' + u.id)
    const centro = (u) => (u.s ? (franja.get(u.s).lo + franja.get(u.s).hi) / 2 : A.get(u.id))
    const filas = capas.map((c, r) => {
      const fila = []
      for (const id of c) {
        const s = subDe(id)
        if (!s) fila.push({ id, s: '' })
        else if (!fila.some((u) => u.s === s)) fila.push({ id: '', s })
      }
      // Un marcador en cada capa del subgrafo aunque no tenga miembros en ella.
      for (const [s, f] of franja) {
        if (r < f.r0 || r > f.r1 || fila.some((u) => u.s === s)) continue
        const m = (f.lo + f.hi) / 2
        let k = 0
        while (k < fila.length && centro(fila[k]) < m) k++
        fila.splice(k, 0, { id: '', s })
      }
      return enOrden(fila)
    })
    const izq = new Map()
    const ancho = new Map()
    for (const fila of filas) {
      for (const u of fila) {
        const k = clave(u)
        if (izq.has(k)) continue
        const f = u.s ? franja.get(u.s) : null
        izq.set(k, f ? f.lo - extIni : A.get(u.id) - ea(u.id) / 2)
        ancho.set(k, f ? f.hi - f.lo + extIni + L.subPad : ea(u.id))
      }
    }
    const antes = new Map(izq)
    let cambio = true
    for (let it = 0; cambio && it <= izq.size; it++) {
      cambio = false
      for (const fila of filas) {
        for (let k = 1; k < fila.length; k++) {
          const a = clave(fila[k - 1])
          const b = clave(fila[k])
          const min = izq.get(a) + ancho.get(a) + L.gapX
          if (izq.get(b) < min - 1e-9) {
            izq.set(b, min)
            cambio = true
          }
        }
      }
    }
    for (const [k, v] of izq) {
      const d = v - antes.get(k)
      if (!d) continue
      const ids = k.startsWith('n:') ? [k.slice(2)] : reales.filter((n) => subDe(n.id) === k.slice(2)).map((n) => n.id)
      for (const id of ids) A.set(id, A.get(id) + d)
    }
  }
  // En LR/RL la etiqueta, horizontal, cruza el hueco entre capas: el hueco la
  // cabe. En TD/BT, las etiquetas de las directas entre los mismos dos nodos van
  // una bajo otra: el hueco las cabe todas (revisión adversaria de H24, D12).
  const hueco = Array.from({ length: nCapas }, () => L.gapY)
  const apiladas = new Map()
  aristas.forEach((e, i) => {
    if (horizontal || e.from === e.to || typeof e.label !== 'string' || !e.label) return
    const ids = cadenas.get(i)
    if (ids.length > 2) return
    const k = par(e)
    apiladas.set(k, (apiladas.get(k) || 0) + 1)
    const r = rango.get(ids[0])
    hueco[r] = Math.max(hueco[r], apiladas.get(k) * L.lineH + L.padY)
  })
  if (horizontal) {
    aristas.forEach((e, i) => {
      if (e.from === e.to || typeof e.label !== 'string' || !e.label) return
      const ids = cadenas.get(i)
      const r = rango.get(ids[tramoEtiqueta(ids)])
      hueco[r] = Math.max(hueco[r], medir(e.label) + 2 * L.padX)
    })
    // La etiqueta de un autoenlace va encima del lazo, centrada en su capa: si
    // es más ancha que la capa, los huecos de los dos lados la caben (revisión
    // adversaria de H24, D12: «revisar el contrato de la API» tapaba al vecino).
    aristas.forEach((e) => {
      if (e.from !== e.to || typeof e.label !== 'string' || !e.label) return
      const r = rango.get(e.from)
      const sobra = medir(e.label) / 2 + L.padX - Math.max(L.nodeH, ...capas[r].map(er)) / 2
      if (sobra <= 0) return
      hueco[r] = Math.max(hueco[r], sobra)
      if (r > 0) hueco[r - 1] = Math.max(hueco[r - 1], sobra)
    })
  }
  const R = []
  const G = []
  // Lo que ocupa de verdad el nodo más grueso de cada capa: un nodo más fino
  // que él tiene franja libre a sus lados, y por ahí no debe cruzar en diagonal.
  const GN = []
  let inicio = 0
  capas.forEach((c, r) => {
    const grosor = Math.max(L.nodeH, ...c.map(er))
    R.push(inicio + grosor / 2)
    G.push(grosor)
    GN.push(Math.max(0, ...c.map(er)))
    inicio += grosor + hueco[r]
  })
  const centroAbs = (id) => [A.get(id), R[rango.get(id)]]
  const aFinal = ([a, r]) =>
    dir === 'TD' ? [a, r] : dir === 'BT' ? [a, -r] : dir === 'LR' ? [r, a] : [-r, a]

  // 7. Nodos, aristas y subgrafos en coordenadas finales (antes del margen).
  const nodes = reales.map((n) => {
    const [cx, cy] = aFinal(centroAbs(n.id))
    return { id: n.id, x: cx - n.w / 2, y: cy - n.h / 2, w: n.w, h: n.h, lines: n.lines }
  })
  const caja = new Map(nodes.map((n) => [n.id, n]))
  // Las aristas DIRECTAS (sin ficticios) que unen los mismos dos nodos, en
  // cualquier sentido, saldrían idénticas: van en paralelo, a `edgeSep` una de
  // otra, y sus etiquetas escalonadas. Las que tienen ficticios ya van por
  // puntos distintos (y desplazarlas las haría cruzarse). Revisión adversaria de H24, D12.
  const grupo = new Map()
  aristas.forEach((e, i) => {
    if (e.from !== e.to && cadenas.get(i).length > 2) {
      grupo.set(String(i), [i])
      return
    }
    const k = par(e)
    if (!grupo.has(k)) grupo.set(k, [])
    grupo.get(k).push(i)
  })
  const edges = aristas.map((e, i) => {
    const hermanas = grupo.get(grupo.has(String(i)) ? String(i) : par(e))
    const m = hermanas.length
    const orden = hermanas.indexOf(i)
    const conEtiqueta = hermanas.filter((j) => typeof aristas[j].label === 'string' && aristas[j].label)
    const desplaza = (orden - (m - 1) / 2) * L.edgeSep
    const escalon = (conEtiqueta.indexOf(i) - (conEtiqueta.length - 1) / 2) * L.lineH
    let abs
    let en = null
    if (e.from === e.to) {
      const [a, r] = centroAbs(e.from)
      const borde = a + ea0(e.from) / 2
      const q = er(e.from) / 4
      const fuera = borde + L.gapX / 2 + orden * pasoLazo
      abs = [
        [borde, r - q],
        [fuera, r - q],
        [fuera, r + q],
        [borde, r + q],
      ]
      en = horizontal ? [fuera, r] : [fuera + L.padY + medir(e.label || '') / 2, r + escalon]
    } else {
      const ids = cadenas.get(i)
      const t = tramoEtiqueta(ids)
      abs = []
      let sale = 0
      ids.forEach((id, k) => {
        const [a, r] = centroAbs(id)
        // Un extremo más fino que el nodo más grueso de su capa sale de la franja
        // de la capa en vertical: en diagonal desde su borde cruzaba al vecino
        // grueso (revisión adversaria de H24, D12, al juntarla con D11: un nodo
        // de 64 px junto a uno de 176 en LR).
        const banda = GN[rango.get(id)] / 2
        const holgura = banda - er(id) / 2 > 0.05
        if (k === 0) {
          abs.push([a, r + er(id) / 2])
          if (holgura) abs.push([a, r + banda])
        } else if (k === ids.length - 1) {
          if (holgura) abs.push([a, r - banda])
          abs.push([a, r - er(id) / 2])
        } else {
          // Un ficticio es una franja: entra y sale de su capa en vertical, por su
          // hueco (en su centro, la arista larga cruzaba en diagonal a los vecinos).
          const g = G[rango.get(id)] / 2
          abs.push([a, r - g], [a, r + g])
        }
        if (k === t) sale = abs.length - 1
      })
      // La etiqueta, siempre en un tramo de hueco (de la salida de la capa de
      // ids[t] a la entrada de la de ids[t+1]): nunca en el vertical de una capa.
      en = [(abs[sale][0] + abs[sale + 1][0]) / 2, (abs[sale][1] + abs[sale + 1][1]) / 2]
      // Dos directas entre los mismos nodos: la misma salida y la misma llegada,
      // y un codo en medio del hueco, a `desplaza` a lo ancho de la capa.
      if (m > 1) {
        en = [en[0] + desplaza, en[1]]
        abs.splice(sale + 1, 0, en.slice())
      }
      // Escalonadas a lo alto del texto: en TD a lo largo del flujo, en LR/RL a lo ancho.
      if (horizontal) en[0] += escalon
      else en[1] += escalon
      if (invertida.has(i)) abs.reverse()
    }
    const points = abs.map((p) => {
      const [x, y] = aFinal(p)
      return { x, y }
    })
    let labelAt = null
    if (typeof e.label === 'string' && e.label) {
      const [x, y] = aFinal(en)
      labelAt = { x, y }
    }
    return { from: e.from, to: e.to, points, labelAt, label: typeof e.label === 'string' ? e.label : '' }
  })
  // Las etiquetas de aristas DISTINTAS que caen en el mismo hueco y se pisan
  // (dos paralelas y otra que salta capa desde el mismo nodo: el diagrama «Según
  // Jira» de H25 etiqueta todas sus aristas; revisión adversaria de H25, D07):
  // se separan a lo ancho de la capa, que en el hueco no tiene nodos, sin tocar
  // su posición a lo largo del flujo, así que ninguna entra en un nodo. Es una
  // relajación SIMÉTRICA (cada una de un par que se toca se aparta la mitad), y
  // acaba por el tope de vueltas, no por monotonía; los lazos van en la franja
  // de su capa y no entran. El coste, medido: el 1,9 % de las etiquetas queda a
  // más de lineH de su arista (como mucho 48 px).
  const ejeA = horizontal ? 'y' : 'x'
  const ejeR = horizontal ? 'x' : 'y'
  const mitadA = (e) => (horizontal ? L.lineH : medir(e.label)) / 2
  const mitadR = (e) => (horizontal ? medir(e.label) : L.lineH) / 2
  const rotuladas = edges.filter((e) => e.labelAt && e.from !== e.to)
  for (let vuelta = 0; vuelta <= 4 * rotuladas.length + 8; vuelta++) {
    rotuladas.sort((p, q) => p.labelAt[ejeA] - q.labelAt[ejeA])
    let cambio = false
    for (let j = 1; j < rotuladas.length; j++) {
      const q = rotuladas[j]
      for (let k = 0; k < j; k++) {
        const p = rotuladas[k]
        if (Math.abs(p.labelAt[ejeR] - q.labelAt[ejeR]) >= mitadR(p) + mitadR(q)) continue
        const min = p.labelAt[ejeA] + mitadA(p) + mitadA(q) + 2
        if (q.labelAt[ejeA] < min - 1e-9) {
          const d = min - q.labelAt[ejeA]
          q.labelAt[ejeA] += d / 2
          p.labelAt[ejeA] -= d / 2
          cambio = true
        }
      }
    }
    if (!cambio) break
  }
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
