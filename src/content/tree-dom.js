/**
 * Adaptador del árbol de páginas de la barra lateral.
 *
 * Existe porque había TRES lecturas distintas del mismo DOM y no coincidían:
 * el localizador de pasos exigía `[role="treeitem"], li, [class*="tree-item"]`,
 * el barrido de ramas plegadas buscaba dentro de `[role="tree"], nav, aside`, y
 * el lector de estructura ya sabía que el contenedor podía ser
 * `[data-testid="side-navigation"]` — que no casa con ninguno de los otros dos.
 * En un Confluence real eso significaba que la navegación guiada no encontraba
 * ni el contenedor ni las ramas, y se degradaba a un salto seco.
 *
 * Aquí se decide UNA vez qué es el contenedor, qué es una fila, cuál es su
 * control de desplegar y si está abierta. Todo lo demás delega.
 *
 * Dos capas, a propósito:
 *  - Una cascada de selectores conocidos, que es lo rápido y lo exacto.
 *  - Una heurística estructural que sube desde el enlace, para cuando Atlassian
 *    rediseña y ninguno de los selectores casa. Las clases CSS cambian cada
 *    trimestre; que un enlace cuelgue de su fila, no.
 */

/** Contenedores candidatos, del más específico al más laxo. */
const CONTAINER_SELECTORS = [
  '[role="tree"]',
  '[data-testid="side-navigation"]',
  '[data-vc*="page-tree" i]',
  '[data-testid*="page-tree" i]',
  '[data-testid*="space-navigation" i]',
  'nav[aria-label*="ágina" i]',
  'nav[aria-label*="page" i]',
  'aside nav',
  'aside',
]

/** Selectores que identifican la fila de una página dentro del árbol. */
export const ROW_SELECTORS =
  '[role="treeitem"], li, [data-testid*="tree-item" i], [data-testid*="page-tree-item" i], [class*="tree-item" i]'

const PAGE_HREF = /(?:\/pages\/\d+)|(?:[?&]pageId=\d+)/i

export function visible(el) {
  if (!el || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none'
}

/**
 * El contenedor del árbol de páginas.
 *
 * No basta con el primer selector que case: en Confluence hay más de un `nav` y
 * más de un `aside`, y quedarse con el equivocado deja el recorrido sin ramas
 * que abrir. Gana el primero que además CONTENGA árbol de verdad —enlaces a
 * páginas o controles de desplegar—, y sólo si ninguno lo tiene se acepta el
 * primero que casó.
 */
export function treeContainer(root = document) {
  let fallback = null
  for (const sel of CONTAINER_SELECTORS) {
    for (const el of root.querySelectorAll(sel)) {
      if (!fallback) fallback = el
      if (looksLikeTree(el)) return el
    }
  }
  return fallback
}

function looksLikeTree(el) {
  if (!el) return false
  for (const a of el.querySelectorAll('a[href]')) {
    if (PAGE_HREF.test(a.getAttribute('href') || '')) return true
  }
  return !!el.querySelector('[aria-expanded]')
}

/**
 * La fila del árbol a la que pertenece un elemento.
 *
 * Primero por selector conocido. Si no hay ninguno, se sube desde el enlace
 * mientras el primer enlace del ancestro siga siendo el nuestro: en cuanto
 * aparece otro por delante, ese ancestro ya es la fila del padre.
 */
export function rowFor(el, container = null) {
  if (!el?.closest) return null
  const directa = el.closest(ROW_SELECTORS)
  if (directa) return directa
  return structuralRow(el, container || treeContainer())
}

function structuralRow(el, container) {
  const link = el.tagName === 'A' ? el : el.closest?.('a[href]') || el
  let cur = link
  let ultimo = link

  for (let i = 0; i < 8; i++) {
    const parent = cur.parentElement
    if (!parent) break
    if (parent === container || parent === document.body || parent === document.documentElement) break

    // Si por delante de lo nuestro hay otro enlace, este ancestro ya es la fila
    // de otra página, o el cajón del que cuelgan varias hermanas.
    const primero = parent.querySelector('a[href]')
    if (primero && primero !== link && !cur.contains(primero)) break

    cur = parent
    ultimo = cur

    // La fila es lo más pequeño que envuelve al enlace Y a su propio control de
    // desplegar. En cuanto aparece el chevron, hemos llegado: subir más
    // mezclaría esta rama con sus hermanas.
    if (ownToggle(cur, link)) return cur
  }

  // Una hoja no tiene chevron: se devuelve lo más alto que seguía siendo suyo.
  return ultimo
}

/**
 * El control de desplegar que pertenece a ESTA fila y no a una hija.
 *
 * Se distingue por el envoltorio: el chevron de una fila hija cuelga de algo
 * que además contiene el enlace de esa hija. El propio, no.
 */
function ownToggle(row, link) {
  for (const t of row.querySelectorAll('[aria-expanded]')) {
    if (deUnaHija(row, t, link)) continue
    return t
  }
  return null
}

function deUnaHija(row, toggle, link) {
  let cur = toggle.parentElement
  for (let i = 0; cur && cur !== row && i < 8; i++) {
    for (const a of cur.querySelectorAll('a[href]')) {
      if (a !== link) return true
    }
    cur = cur.parentElement
  }
  return false
}

/**
 * El control de desplegar de ESTA fila, esté abierto o cerrado.
 *
 * Hay dos formas en la naturaleza: un chevron aparte, y el `aria-expanded`
 * puesto en la propia fila. La segunda se escapaba —`querySelector` sólo mira
 * descendientes— y el paso se daba por hecho sin desplegar nada.
 *
 * @returns {{toggle: Element, isRow: boolean}|null}
 */
export function toggleFor(row) {
  if (!row) return null

  for (const cand of row.querySelectorAll('[aria-expanded]')) {
    if (cand.matches(ROW_SELECTORS)) continue
    if (!visible(cand)) continue

    const dueño = cand.closest(ROW_SELECTORS)
    if (dueño && dueño !== row) continue // es de una fila hija reconocible

    // Y si no hay filas por selector, vale el mismo criterio estructural: el
    // chevron de una hija cuelga de algo que lleva el enlace de esa hija.
    if (!dueño && deUnaHija(row, cand, row.querySelector('a[href]'))) continue

    return { toggle: cand, isRow: false }
  }

  if (row.matches?.('[aria-expanded]') && visible(row)) return { toggle: row, isRow: true }
  return null
}

/**
 * ¿Cuelgan de esta fila otras filas que se vean ahora mismo?
 *
 * `aria-expanded` puede mentir: hay árboles que lo dejan en `true` con las
 * hijas ocultas. Lo que cuenta es si de verdad se ven filas debajo.
 */
export function hasVisibleChildRows(row) {
  if (!row) return false
  for (const hija of row.querySelectorAll(ROW_SELECTORS)) {
    if (hija === row) continue
    if (visible(hija)) return true
  }
  // Sin filas reconocibles por selector, cuentan los enlaces visibles: el
  // primero es el de la propia fila, del segundo en adelante son hijas.
  let n = 0
  for (const a of row.querySelectorAll('a[href]')) {
    if (visible(a) && ++n > 1) return true
  }
  return false
}

/** ¿Está desplegada de verdad esta fila? */
export function isRowExpanded(row) {
  const t = toggleFor(row)
  if (!t) return false
  return t.toggle.getAttribute('aria-expanded') === 'true' && hasVisibleChildRows(row)
}

/**
 * Todas las ramas plegadas del árbol, en orden de documento.
 * Se devuelve el control, que es lo que hay que pulsar.
 */
export function expandersIn(container = treeContainer(), limit = 300) {
  if (!container) return []
  const out = []
  let i = 0
  for (const btn of container.querySelectorAll('[aria-expanded="false"]')) {
    if (i++ > limit) break
    if (!visible(btn)) continue
    out.push(btn)
  }
  return out
}

/** El scroller propio del árbol, si lo tiene. Es lo que hay que desplazar. */
export function treeScroller(container = treeContainer()) {
  let cur = container
  for (let i = 0; cur && i < 8; i++) {
    if (isScrollable(cur)) return cur
    cur = cur.parentElement
  }
  return null
}

export function isScrollable(el) {
  if (!el || el === document.body || el === document.documentElement) return false
  const s = getComputedStyle(el)
  if (!/(auto|scroll|overlay)/.test(s.overflowY)) return false
  return el.scrollHeight - el.clientHeight > 8
}

/**
 * Volcado en texto de la estructura de la barra lateral.
 *
 * Es el diagnóstico: cuando la navegación guiada no encuentra el árbol de un
 * Confluence concreto, esto dice exactamente con qué se ha encontrado, para
 * poder ajustar los selectores con datos en vez de con suposiciones.
 */
export function describeTree(root = document) {
  const lineas = []
  const container = treeContainer(root)

  lineas.push('# Diagnóstico del árbol de páginas')
  lineas.push('url: ' + location.href)
  lineas.push('')

  lineas.push('## Contenedores candidatos')
  for (const sel of CONTAINER_SELECTORS) {
    const encontrados = root.querySelectorAll(sel)
    if (!encontrados.length) continue
    for (const el of encontrados) {
      lineas.push(`  ${sel} -> ${describeEl(el)}${el === container ? '   <== ELEGIDO' : ''}`)
      lineas.push(`      árbol=${looksLikeTree(el)} scrollable=${isScrollable(el)}`)
    }
  }
  if (!container) {
    lineas.push('  (ninguno) — sin contenedor no hay recorrido posible')
    return lineas.join('\n')
  }

  const scroller = treeScroller(container)
  lineas.push('')
  lineas.push('## Contenedor elegido')
  lineas.push('  ' + describeEl(container))
  lineas.push('  scroller: ' + (scroller ? describeEl(scroller) : '(la ventana)'))
  lineas.push('  enlaces: ' + container.querySelectorAll('a[href]').length)
  lineas.push('  aria-expanded: ' + container.querySelectorAll('[aria-expanded]').length)
  lineas.push('  plegados: ' + container.querySelectorAll('[aria-expanded="false"]').length)
  lineas.push('  filas por selector: ' + container.querySelectorAll(ROW_SELECTORS).length)

  lineas.push('')
  lineas.push('## Primeras filas (tal y como las ve Faro)')
  let n = 0
  for (const a of container.querySelectorAll('a[href]')) {
    if (n++ >= 12) break
    const href = a.getAttribute('href') || ''
    if (!PAGE_HREF.test(href)) continue
    const row = rowFor(a, container)
    const t = toggleFor(row)
    lineas.push(`  «${(a.innerText || a.textContent || '').trim().slice(0, 60)}»`)
    lineas.push(`      href: ${href.slice(0, 120)}`)
    lineas.push(`      fila: ${describeEl(row)}${row?.matches?.(ROW_SELECTORS) ? '' : '   (heurística estructural)'}`)
    lineas.push(
      `      desplegar: ${t ? describeEl(t.toggle) + ` isRow=${t.isRow} abierta=${isRowExpanded(row)}` : '(no tiene)'}`
    )
  }
  if (!n) lineas.push('  (ningún enlace a página dentro del contenedor)')

  return lineas.join('\n')
}

function describeEl(el) {
  if (!el) return '(nada)'
  const attrs = []
  for (const name of ['role', 'data-testid', 'data-vc', 'aria-label', 'aria-expanded', 'class']) {
    const v = el.getAttribute?.(name)
    if (v) attrs.push(`${name}="${String(v).slice(0, 70)}"`)
  }
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>`
}
