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
  // El pagetree clásico de un Confluence Server/Data Center. Comprobado en el
  // Confluence 9.2 del usuario (F9 de la verificación en real, 2026-09-21):
  // ahí NO hay `<aside>`, ni `[role="tree"]`, ni `nav[aria-label*="página"]`,
  // ni un solo `data-testid`, así que ninguno de los de arriba casaba y
  // `describeTree()` contestaba «(ninguno) — sin contenedor no hay recorrido
  // posible»: ni «Paso a paso» ni «Árbol leído de la página». Todo lo demás ya
  // funcionaba con ese contenedor señalado a mano (filas `li`, chevrones
  // `a.plugin_pagetree_childtoggle` sin href útil, `snapshotTree` con padres,
  // un `expand` de verdad), así que lo único que faltaba era reconocerlo.
  // Va DETRÁS de los anteriores y no delante: en Cloud manda el `data-testid`
  // y en el árbol ARIA el `role="tree"`, de modo que lo que se elige donde ya
  // funcionaba no cambia.
  '.plugin_pagetree',
  'nav[aria-label*="ágina" i]',
  'nav[aria-label*="page" i]',
  'aside nav',
  'aside',
  // Y los dos envoltorios de esa misma barra, por si un día el pagetree llega
  // con otra clase. Van LOS ÚLTIMOS a propósito: `[role="complementary"]` es
  // también el panel de «Actividad reciente» o el de etiquetas de un espacio,
  // y sólo se acepta si de verdad contiene árbol (`looksLikeTree`).
  '.ia-secondary-content',
  '[role="complementary"]',
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
 * ¿Este control abre un menú (o cualquier otro emergente) en vez de una rama?
 *
 * Un disparador de menú lleva el mismo `aria-expanded="false"` que el chevron
 * de una rama: el «···» de acciones de cada fila, el menú del espacio, un
 * desplegable AUI. Pulsarlo no despliega nada del árbol: abre «Mover»,
 * «Archivar», «Eliminar» encima de la página mientras el barrido «busca la
 * rama» (auditoría del 2026-09-13, docs/PLAN.md §2 M9). Se reconoce por
 * `aria-haspopup` con cualquier valor que no sea «false» (true, menu, listbox,
 * tree, grid, dialog) o por un `aria-controls` que apunte a un `role="menu"`.
 * Un `aria-controls` hacia el `role="group"` de las hijas, que es lo que lleva
 * el chevron de un árbol ARIA, no cuenta. Pura: sólo mira atributos y el
 * documento del propio elemento.
 */
export function isMenuTrigger(el) {
  if (!el?.getAttribute) return false
  const popup = String(el.getAttribute('aria-haspopup') || '').trim().toLowerCase()
  if (popup && popup !== 'false') return true

  const controls = String(el.getAttribute('aria-controls') || '').trim()
  if (!controls) return false
  const doc = el.ownerDocument
  if (!doc?.getElementById) return false
  for (const id of controls.split(/\s+/)) {
    const target = doc.getElementById(id)
    if (String(target?.getAttribute?.('role') || '').toLowerCase() === 'menu') return true
  }
  return false
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
 * El enlace PROPIO de una fila: el que lleva a su página.
 *
 * `row.querySelector('a[href]')` no sirve: en el pagetree de un Data Center el
 * chevron es también un `<a>` (con `href=""`) y va ANTES del enlace dentro del
 * `<li>` (F9, harness.js `pagetreeRow`). Gana el primer `a[href]` con dirección
 * que tenga forma de página (`PAGE_HREF`) y, si ninguno la tiene (el
 * `/display/ESPACIO/Título` de un DC viejo), el primero con dirección. Un
 * `href="#…"` no es dirección: es un control (el «···» de AUI). Pura sobre el
 * elemento. H28 (PLAN3 §3.2, C3-8).
 *
 * Los enlaces de las filas HIJAS no cuentan: el DC deja las hijas en el DOM al
 * plegar la rama, y con un propio `/display/…` una hija `viewpage.action?
 * pageId=` le ganaba por tener forma de página; el título salía el de la hija y
 * el chevron seguía bloqueado (revisión adversaria de H28, D10, reproducido en
 * Chromium). Se mira el `li` o `treeitem` más cercano al enlace y no
 * `ROW_SELECTORS` entero, cuyo `[class*="tree-item"]` casa también con los
 * envoltorios de la propia fila.
 */
export function rowLink(row) {
  if (!row?.querySelectorAll) return null
  let primero = null
  for (const a of row.querySelectorAll('a[href]')) {
    const href = String(a.getAttribute('href') || '').trim()
    if (!href || href.startsWith('#')) continue
    const hija = a.parentElement?.closest?.('[role="treeitem"], li')
    if (hija && hija !== row && row.contains?.(hija)) continue
    if (PAGE_HREF.test(href)) return a
    if (!primero) primero = a
  }
  return primero
}

/**
 * El título de una fila: el texto de su enlace propio, recortado y SIN plegar
 * (pliega quien compara). `''` si la fila no tiene enlace.
 *
 * Existe para que `isSafeToClick` (locators.js) pueda quitar el título del
 * nombre accesible del chevron y del enlace de la fila antes de buscar
 * acciones prohibidas: el título es contenido, no una acción (§8.12). En el
 * Confluence 9.2 del usuario, «Ampliar elemento 8700 - Contract + Billing»
 * casaba con «billing» y Faro no desplegaba esa rama (PLAN3 §0, H28).
 */
export function rowTitle(row) {
  const a = rowLink(row)
  return a ? String(a.textContent || '').trim() : ''
}

/**
 * El control de desplegar que pertenece a ESTA fila y no a una hija.
 *
 * Se distingue por el envoltorio: el chevron de una fila hija cuelga de algo
 * que además contiene el enlace de esa hija. El propio, no.
 */
function ownToggle(row, link) {
  for (const t of row.querySelectorAll('[aria-expanded]')) {
    if (isMenuTrigger(t)) continue // el «···» de la fila no es su chevron
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
    // El «···» de acciones de la fila lleva aria-expanded y va, a veces, antes
    // que el chevron en el DOM: no es el control de desplegar de nadie.
    if (isMenuTrigger(cand)) continue
    if (!visible(cand)) continue

    const dueño = cand.closest(ROW_SELECTORS)
    if (dueño && dueño !== row) continue // es de una fila hija reconocible

    // Y si no hay filas por selector, vale el mismo criterio estructural: el
    // chevron de una hija cuelga de algo que lleva el enlace de esa hija.
    if (!dueño && deUnaHija(row, cand, row.querySelector('a[href]'))) continue

    return { toggle: cand, isRow: false }
  }

  if (row.matches?.('[aria-expanded]') && !isMenuTrigger(row) && visible(row)) return { toggle: row, isRow: true }
  return null
}

/**
 * ¿Cuelgan de esta fila otras filas que se vean ahora mismo?
 *
 * `aria-expanded` puede mentir: hay árboles que lo dejan en `true` con las
 * hijas ocultas. Lo que cuenta es si de verdad se ven filas debajo.
 */
function hasVisibleChildRows(row) {
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
 * Se devuelve el control, que es lo que hay que pulsar. Los disparadores de
 * menú se quedan fuera: llevan el mismo `aria-expanded="false"`, pero lo que
 * abren no es una rama (`isMenuTrigger`).
 */
export function expandersIn(container = treeContainer(), limit = 300) {
  if (!container) return []
  const out = []
  let i = 0
  for (const btn of container.querySelectorAll('[aria-expanded="false"]')) {
    if (i++ > limit) break
    if (isMenuTrigger(btn)) continue
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
