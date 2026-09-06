/**
 * De un ancla del plan a un Range real de la página.
 *
 * La escalera de intentos, en orden:
 *   1. Encabezado por su texto (Confluence les pone id, pero el texto es más
 *      estable que el id generado).
 *   2. Cita literal con contexto por delante y por detrás.
 *   3. Coincidencia aproximada, por si la página se reeditó un poco.
 *   4. Rendirse bien: se resalta el contenedor y se dice la verdad.
 *
 * Nunca se inserta nada en el contenido: el resaltado se pinta con la CSS
 * Custom Highlight API sobre Ranges, y los rectángulos van en el shadow DOM.
 */

import { findQuote, bestHeading } from './anchor-match.js'
import { contentRoot } from './dom-utils.js'

/**
 * Aplana el texto del contenedor y guarda de qué nodo salió cada carácter.
 *
 * Con `boundary` se queda sólo con el texto PROPIO del contenedor: los nodos
 * de texto que no cuelgan de ningún elemento para el que `boundary` diga que
 * es un bloque. Es lo que permite leer un párrafo sin la lista que lleva
 * dentro, y es la misma función con la que después se busca la cita en ese
 * párrafo: el texto que vio el modelo y el texto en el que se busca salen del
 * mismo sitio, o no coinciden.
 *
 * Los nodos que sólo tienen espacios también cuentan. Sin ellos, «<a>x</a>
 * <a>y</a>» se leía «xy»: palabras pegadas para el modelo y una cita que no
 * encontraba nada. En las posiciones no cambia nada —el mapa sigue siendo
 * carácter a carácter— y `findQuote` ya colapsa los espacios al comparar.
 *
 * @param {Node} root
 * @param {{boundary?: (el: Element) => boolean}} [opts]
 * @returns {{text: string, nodes: Array<{node: Text, start: number, end: number}>}}
 */
export function buildTextIndex(root, { boundary = null } = {}) {
  const nodes = []
  let text = ''

  const what = boundary ? NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT : NodeFilter.SHOW_TEXT
  const walker = document.createTreeWalker(root, what, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Un bloque anidado se salta ENTERO; lo demás se atraviesa sin devolverlo.
        return node !== root && boundary(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
      }
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT
      if (parent.closest('#faro-overlay-host')) return NodeFilter.FILTER_REJECT
      if (parent.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let node
  while ((node = walker.nextNode())) {
    const start = text.length
    text += node.nodeValue
    nodes.push({ node, start, end: text.length })
  }

  return { text, nodes }
}

/** Convierte posiciones del texto plano en un Range del documento. */
export function rangeFromOffsets(index, start, end) {
  const startPos = locate(index.nodes, start)
  const endPos = locate(index.nodes, end, true)
  if (!startPos || !endPos) return null
  const range = document.createRange()
  try {
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)
  } catch {
    return null
  }
  return range.collapsed ? null : range
}

function locate(nodes, pos, isEnd = false) {
  // Búsqueda binaria: en una página larga hay miles de nodos de texto.
  let lo = 0
  let hi = nodes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const n = nodes[mid]
    if (pos < n.start) hi = mid - 1
    else if (pos > n.end) lo = mid + 1
    else {
      if (pos === n.end && !isEnd && mid + 1 < nodes.length) {
        return { node: nodes[mid + 1].node, offset: 0 }
      }
      return { node: n.node, offset: pos - n.start }
    }
  }
  const last = nodes[nodes.length - 1]
  if (last && pos >= last.end) return { node: last.node, offset: last.node.nodeValue.length }
  return null
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]'

/** Encuentra un encabezado por su texto, tolerando diferencias menores. */
export function findHeadingElement(headingText, root = contentRoot()) {
  const els = Array.from(root.querySelectorAll(HEADING_SELECTOR)).filter(
    (h) => h.textContent && h.textContent.trim()
  )
  if (!els.length) return null
  const idx = bestHeading(els.map((h) => h.textContent), headingText)
  return idx === -1 ? null : els[idx]
}

/**
 * Resuelve un ancla contra la página actual.
 *
 * @param {{kind:string, headingText?:string, exact?:string, prefix?:string, suffix?:string}} anchor
 * @returns {{ok:boolean, strategy:string, ranges?:Range[], element?:Element, message?:string}}
 */
export function resolveAnchor(anchor) {
  const root = contentRoot()
  if (!anchor || anchor.kind === 'none') {
    return { ok: true, strategy: 'page', element: root }
  }

  if (anchor.kind === 'heading') {
    const el = findHeadingElement(anchor.headingText, root)
    if (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      return { ok: true, strategy: 'heading', ranges: [range], element: el }
    }
    // Un encabezado que no aparece todavía puede estar como texto suelto.
    const asQuote = resolveQuote({ exact: anchor.headingText }, root)
    if (asQuote.ok) return { ...asQuote, strategy: 'heading-as-text' }
    return {
      ok: false,
      strategy: 'none',
      element: root,
      message: `No encuentro el apartado «${anchor.headingText}» en esta página.`,
    }
  }

  if (anchor.kind === 'text-quote') return resolveQuote(anchor, root)

  return { ok: true, strategy: 'page', element: root }
}

function resolveQuote(anchor, root) {
  const index = buildTextIndex(root)
  if (!index.text) {
    return { ok: false, strategy: 'none', element: root, message: 'La página no tiene texto que buscar todavía.' }
  }

  const hit = findQuote(index.text, anchor)
  if (!hit) {
    return {
      ok: false,
      strategy: 'none',
      element: root,
      message: 'El fragmento que te mencioné ya no está donde estaba. Te dejo en la página.',
    }
  }

  const range = rangeFromOffsets(index, hit.start, hit.end)
  if (!range) {
    return { ok: false, strategy: 'none', element: root, message: 'No he podido marcar el fragmento exacto.' }
  }

  return {
    ok: true,
    strategy: hit.strategy,
    ranges: [range],
    element: rangeElement(range),
    approximate: hit.strategy === 'fuzzy',
  }
}

function rangeElement(range) {
  const c = range.commonAncestorContainer
  return c.nodeType === Node.ELEMENT_NODE ? c : c.parentElement
}

/** Lo que en una página de Confluence es «una imagen» a efectos de marcarla. */
const MEDIA_SELECTOR = 'img, svg, canvas, figure, [data-media-type], [data-testid*="media" i]'

/**
 * Imágenes y diagramas dentro de lo anclado.
 *
 * Un `Range` no sirve para marcar una imagen: dentro de un `<img>` no hay texto
 * que resaltar. Se devuelven los elementos para rodearlos con un filete fino.
 *
 * Se descartan los iconos —cualquier cosa menor de 24 px— y las imágenes que ya
 * quedan cubiertas por su `<figure>`, para no pintar dos recuadros encajados.
 */
export function imagesWithin(element, limit = 12) {
  if (!element || element.nodeType !== 1) return []
  const out = []

  if (element.matches?.(MEDIA_SELECTOR)) out.push(element)

  for (const m of element.querySelectorAll?.(MEDIA_SELECTOR) || []) {
    if (out.length >= limit) break
    if (out.some((x) => x !== m && x.contains(m))) continue
    const r = m.getBoundingClientRect()
    if (r.width < 24 || r.height < 24) continue
    out.push(m)
  }

  return out.slice(0, limit)
}

/** Rectángulo del viewport que engloba un Range, para el foco. */
export function rangeRect(range) {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) return null
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const right = Math.max(...rects.map((r) => r.right))
  return { top, left, width: right - left, height: bottom - top }
}
