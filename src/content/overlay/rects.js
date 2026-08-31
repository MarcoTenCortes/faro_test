/**
 * De los rectángulos que devuelve el navegador a los que hay que pintar.
 *
 * `Range.getClientRects()` no da «una caja por línea»: da una por cada caja de
 * texto que toca el rango. En un párrafo normal eso coincide, pero dentro de un
 * bloque de código con resaltado de sintaxis cada `<span>` de color es su propia
 * caja — y encima el navegador devuelve duplicados y solapes. Marcar cuatro
 * líneas de YAML producía diecisiete rectángulos, varios repetidos, y el amarillo
 * se apilaba a manchas.
 *
 * Aquí se juntan: se tiran los que no se ven, se agrupan por línea y se funden
 * los que se tocan. Queda una barra por línea, que es lo que un rotulador haría.
 *
 * Módulo puro y sin DOM: sólo objetos con top/left/width/height.
 */

/** Un rectángulo más pequeño que esto no es texto: es ruido de maquetación. */
const MINIMO = 1

/**
 * @param {Array<{top:number,left:number,width:number,height:number}>} rects
 * @param {{gap?:number, tol?:number}} opts
 *        `gap` cuánto hueco entre dos trozos se sigue considerando la misma
 *        marca (el espacio entre palabras); `tol` cuánto pueden diferir dos
 *        líneas en su posición vertical y seguir siendo la misma.
 * @returns {Array<{top:number,left:number,width:number,height:number}>}
 */
export function mergeRects(rects, { gap = 3, tol = 2 } = {}) {
  const limpios = []
  for (const r of rects || []) {
    if (!r) continue
    const width = num(r.width)
    const height = num(r.height)
    if (width < MINIMO || height < MINIMO) continue
    limpios.push({ top: num(r.top), left: num(r.left), width, height })
  }
  if (limpios.length < 2) return limpios

  // Por líneas: misma altura y mismo borde superior, con holgura.
  const lineas = []
  for (const r of limpios) {
    const linea = lineas.find((l) => Math.abs(l.top - r.top) <= tol && Math.abs(l.bottom - bottom(r)) <= tol)
    if (linea) linea.trozos.push(r)
    else lineas.push({ top: r.top, bottom: bottom(r), trozos: [r] })
  }

  const out = []
  for (const linea of lineas) {
    linea.trozos.sort((a, b) => a.left - b.left)
    let cur = null

    for (const r of linea.trozos) {
      if (!cur) {
        cur = { ...r }
        continue
      }
      // Se tocan, se solapan, o uno está dentro del otro: son la misma marca.
      if (r.left <= right(cur) + gap) {
        const derecha = Math.max(right(cur), right(r))
        cur.top = Math.min(cur.top, r.top)
        cur.height = Math.max(bottom(cur), bottom(r)) - cur.top
        cur.width = derecha - cur.left
        continue
      }
      out.push(cur)
      cur = { ...r }
    }

    if (cur) out.push(cur)
  }

  // En orden de lectura: primero por línea, luego de izquierda a derecha.
  return out.sort((a, b) => a.top - b.top || a.left - b.left)
}

/**
 * Recorta a la caja de su contenedor.
 *
 * Los rectángulos son `position: fixed` y llevan coordenadas de viewport, así
 * que no los recorta nadie: si lo marcado vive en un bloque de código con
 * scroll horizontal y el bloque está desplazado, la marca sigue pintándose
 * donde estaba el texto —fuera del bloque, encima del margen de la página—.
 * El navegador recorta el texto; la marca tiene que recortarse igual.
 *
 * @param {Array} rects
 * @param {{top:number,left:number,width:number,height:number}|null} box
 */
export function clipRects(rects, box) {
  if (!box) return rects || []
  const out = []

  for (const r of rects || []) {
    if (!r) continue
    const left = Math.max(num(r.left), num(box.left))
    const top = Math.max(num(r.top), num(box.top))
    const right = Math.min(num(r.left) + num(r.width), num(box.left) + num(box.width))
    const bottom = Math.min(num(r.top) + num(r.height), num(box.top) + num(box.height))
    if (right - left < MINIMO || bottom - top < MINIMO) continue
    out.push({ top, left, width: right - left, height: bottom - top })
  }

  return out
}

/** Todos los rectángulos de una lista de Range, ya fundidos. */
export function rectsOf(ranges, opts) {
  const todos = []
  for (const range of ranges || []) {
    if (!range?.getClientRects) continue
    for (const r of range.getClientRects()) todos.push(r)
  }
  return mergeRects(todos, opts)
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function right(r) {
  return r.left + r.width
}

function bottom(r) {
  return r.top + r.height
}
