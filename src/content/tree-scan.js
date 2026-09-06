/**
 * Lee la estructura del árbol de páginas directamente del DOM.
 *
 * Es la idea de guardar «cómo es la estructura» y usarla de referencia, pero
 * quedándose con los datos en vez de con el HTML: guardar marcado sería pesado,
 * frágil y quedaría obsoleto al primer rediseño; guardar «la página 1084 cuelga
 * de la 1083» no caduca nunca.
 *
 * Ventajas frente a preguntárselo al modelo:
 *  - Es gratis y tarda milisegundos.
 *  - Es exacto: no se puede inventar una relación que el árbol no muestra.
 *  - Refleja lo que el usuario ve, que es por donde va a navegar.
 *
 * Límite honesto: sólo ve las ramas que están desplegadas. Por eso complementa
 * al árbol que trae el MCP, no lo sustituye — y se va completando con el uso.
 */

import { treeContainer, rowFor, ROW_SELECTORS } from './tree-dom.js'

const PAGE_ID = /(?:\/pages\/(\d+))|(?:[?&]pageId=(\d+))/

/** Saca el id de página de un href, si lo lleva. */
export function pageIdFromHref(href) {
  const m = PAGE_ID.exec(String(href || ''))
  return m ? m[1] || m[2] : null
}

/**
 * Recorre la barra lateral y devuelve las relaciones padre-hijo que ve.
 * @returns {{pages: Array<{id,title,parentId,url}>, scanned: number}}
 */
export function snapshotTree(root = document) {
  const contenedor = treeContainer(root)
  const rowOf = (el) => rowFor(el, contenedor)

  if (!contenedor) return { pages: [], scanned: 0 }

  const enlaces = contenedor.querySelectorAll('a[href]')
  const porFila = new Map() // fila -> {id, title, url}
  const orden = []

  for (const a of enlaces) {
    const id = pageIdFromHref(a.getAttribute('href'))
    if (!id) continue
    const fila = rowOf(a)
    if (!fila || porFila.has(fila)) continue
    const title = (a.innerText || a.textContent || '').trim().slice(0, 200)
    porFila.set(fila, { id, title, url: a.getAttribute('href') })
    orden.push(fila)
  }

  // La fila de la pagina ACTUAL no suele ser un enlace: Confluence la pinta en
  // negrita y sin href. Es justo la que mas interesa registrar, asi que se
  // recupera de la URL.
  const idActual = pageIdFromHref(location.pathname + location.search)
  if (idActual) {
    for (const fila of contenedor.querySelectorAll(ROW_SELECTORS)) {
      if (porFila.has(fila)) continue
      if (fila.querySelector('a[href]')) continue
      const marcada =
        fila.matches('[aria-current], [aria-selected="true"], .current') ||
        !!fila.querySelector('[aria-current], .current')
      if (!marcada) continue
      const title = (fila.innerText || fila.textContent || '').trim().slice(0, 200)
      porFila.set(fila, { id: idActual, title, url: location.pathname + location.search })
      orden.push(fila)
      break
    }
  }

  const pages = []
  for (const fila of orden) {
    const propia = porFila.get(fila)
    // El padre es la fila-con-enlace más cercana por encima en el árbol.
    let parentId = null
    let cursor = fila.parentElement
    while (cursor && cursor !== contenedor) {
      const posible = rowOf(cursor)
      if (posible && porFila.has(posible) && posible !== fila) {
        parentId = porFila.get(posible).id
        break
      }
      cursor = cursor.parentElement
    }
    pages.push({ ...propia, parentId })
  }

  return { pages, scanned: orden.length }
}
