/**
 * La página en bloques numerados, leída del DOM; y de un bloque a un Range.
 *
 * Es la otra mitad de `src/shared/digest.js`. Aquí se recorre el contenido de
 * la página y se convierte en una lista de bloques —párrafo, encabezado,
 * viñeta, celda, código— con su texto tal como se ve en pantalla. Esa lista es
 * lo que se le enseña al modelo, y también lo que se vuelve a construir cuando
 * llega su JSON: «¶12» se resuelve contra la página de AHORA, no contra una
 * copia guardada. Confluence repinta su contenido cuando quiere; una lista en
 * memoria sería una lista de nodos muertos.
 *
 * La escalera para marcar una observación, en orden:
 *   1. El bloque, comprobado por su texto (`matchBlock`): el número es sólo
 *      una preferencia.
 *   2. La cita literal dentro de ese bloque; si la página cambió un poco, la
 *      coincidencia aproximada, pero SIEMPRE dentro del bloque.
 *   3. El bloque entero, si la cita no aparece: el modelo señaló ese párrafo,
 *      y ese párrafo es lo que se marca.
 *   4. La cita en toda la página, si el bloque ya no existe.
 *   5. Nada. Una observación sin sitio se queda sin marcar.
 *
 * Nunca se inserta nada en el contenido: sólo se leen nodos y se devuelven
 * Ranges, que el overlay pinta desde fuera.
 */

import { buildTextIndex, rangeFromOffsets, resolveAnchor } from './anchor.js'
import { findQuote } from './anchor-match.js'
import { contentRoot } from './dom-utils.js'
import { jiraIssueScope } from './jira-issue.js'
import { DIGEST_LIMITS, squash, matchBlock } from '../shared/digest.js'

/** Lo que en una página es «un bloque» a efectos de leerla y de marcarla. */
const BLOCK_TAGS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'DT', 'DD',
  'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'UL', 'OL', 'TABLE', 'THEAD',
  'TBODY', 'TFOOT', 'TR', 'CAPTION', 'FIGURE', 'DETAILS', 'SUMMARY', 'FORM', 'FIELDSET', 'ADDRESS', 'HR',
])
const BLOCK_ROLES = new Set([
  'heading', 'listitem', 'list', 'cell', 'gridcell', 'columnheader', 'rowheader', 'row', 'rowgroup',
  'region', 'article', 'table', 'grid',
])
/** Lo que no tiene texto que leer, o cuyo texto no es contenido. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'INPUT', 'SELECT',
  'TEXTAREA',
])

/** ¿Este elemento es un bloque? Sirve de frontera al leer el texto propio. */
export function isBlock(el) {
  if (!el || el.nodeType !== 1) return false
  return BLOCK_TAGS.has(el.tagName) || BLOCK_ROLES.has(el.getAttribute('role') || '')
}

/**
 * ¿Está oculto? Lo que no se ve no se le enseña al modelo: no se podría
 * subrayar y le haría hablar de cosas que el usuario no tiene delante.
 */
function hidden(el) {
  if (el.getAttribute('aria-hidden') === 'true') return true
  if (el.closest('#faro-overlay-host')) return true
  // Una caja de verdad, no una de 1×1 ni una desplazada fuera de la pantalla:
  // así es como AUI esconde el texto para lectores («left: -9999px», el
  // `clip` de 1×1), y ese texto no lo tiene el usuario delante. Si el modelo
  // lo cita, la marca cae en x=-9999 y no se ve nada.
  if (visibleRects(el).length) return false
  // `display: contents` no tiene cajas propias, pero sus hijos sí.
  return getComputedStyle(el).display !== 'contents'
}

/**
 * Las cajas de un elemento que ocupan sitio de verdad en el DOCUMENTO.
 *
 * Nunca respecto a la ventana: un bloque que está más abajo del scroll se ve
 * perfectamente, y filtrarlo haría que la misma página diera bloques distintos
 * según dónde estuviera mirando el usuario. Lo que se descarta es lo que no
 * tiene tamaño (el `clip` de 1×1 de AUI) y lo que está fuera del documento por
 * la izquierda o por arriba (`left: -9999px`), que es como se esconde el texto
 * para lectores de pantalla.
 *
 * Y «el documento» cuenta TODOS los desplazamientos, no sólo el de la ventana:
 * en la vista de incidencia de un Jira Data Center el que hace scroll es un
 * panel interno (§4.4), y corregir sólo por `window.scrollY` daba por ocultos
 * los bloques que quedaban por encima del borde del panel. Reproducido en la
 * auditoría del 2026-09-13 (docs/PLAN.md §2.3 M1): con el panel desplazado,
 * 33 bloques pasaban a 6 y luego a 0 —sin título, sin campos, sin
 * descripción—, y `applyNotes`, que relee la página con el panel donde esté,
 * no casaba las observaciones de arriba. El truco de AUI sigue cayendo: su
 * sitio en el documento sigue siendo negativo o nulo por mucho scroll que sume.
 */
function visibleRects(el) {
  const { x, y } = scrollOffset(el)
  return Array.from(el.getClientRects()).filter(
    (r) => r.width > 1 && r.height > 1 && r.right + x > 0 && r.bottom + y > 0
  )
}

/**
 * Cuánto hay que sumar a una caja del viewport para tenerla en coordenadas del
 * documento: el scroll de la ventana más el de cada contenedor que envuelve al
 * elemento. Un elemento sin scroll propio suma 0, así que no hace falta mirar
 * su `overflow`; el que desplaza el propio viewport (`document.scrollingElement`)
 * ya va en `window.scrollX/Y` y no se cuenta dos veces. Sin tope de niveles:
 * la incidencia de un Jira DC anida el contenido a más de doce.
 */
function scrollOffset(el) {
  let x = window.scrollX || 0
  let y = window.scrollY || 0
  const viewport = document.scrollingElement
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    if (cur === viewport) continue
    x += cur.scrollLeft || 0
    y += cur.scrollTop || 0
  }
  return { x, y }
}

/**
 * Los bloques que cuelgan directamente de éste, en orden de documento. Lo que
 * sea interfaz según `esInterfaz` se salta con todo lo que lleve dentro.
 */
function nestedBlocks(el, esInterfaz = () => false, out = []) {
  for (const child of el.children) {
    if (SKIP_TAGS.has(child.tagName) || esInterfaz(child)) continue
    if (isBlock(child)) out.push(child)
    else nestedBlocks(child, esInterfaz, out)
  }
  return out
}

/** La etiqueta corta con la que el modelo ve de qué clase es un bloque. */
export function tagLabel(el) {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role') || ''
  if (/^h[1-6]$/.test(tag)) return tag
  if (role === 'heading') {
    const nivel = Number(el.getAttribute('aria-level')) || 2
    return 'h' + Math.min(6, Math.max(1, nivel))
  }
  if (tag === 'li' || role === 'listitem') return 'li'
  if (tag === 'td' || tag === 'th' || /^(cell|gridcell|columnheader|rowheader)$/.test(role)) return 'celda'
  if (tag === 'blockquote') return 'cita'
  if (tag === 'pre') return 'código'
  if (tag === 'figcaption' || tag === 'caption') return 'pie'
  if (tag === 'dt' || tag === 'dd') return 'def'
  if (tag === 'p') return 'p'
  return 'txt'
}

/**
 * Por dónde se lee la página: en una incidencia de Jira, sus puntos de lectura
 * (título, campos, descripción, comentarios) y qué es interfaz; en cualquier
 * otra, el contenedor del contenido de siempre. Es lo único que cambia entre
 * los dos productos: el troceado, la pista y la escalera son los mismos.
 *
 * @returns {{roots: Array<{el: Element, tag?: string}>, chrome: string}}
 */
export function digestScope() {
  return jiraIssueScope() || { roots: [{ el: contentRoot() }], chrome: '' }
}

/**
 * Recorre el contenido y lo deja en bloques numerados.
 *
 * Cada bloque lleva su texto PROPIO —el que no pertenece a un bloque anidado—,
 * de modo que una viñeta con una sublista es dos bloques, no uno repetido. El
 * orden es el del documento. Con tope, y diciendo si se recortó: una página
 * larga no cabe en el contexto de los modelos pequeños.
 *
 * Lo que el ámbito declara como interfaz (`chrome`) no es un bloque ni entra
 * en el texto de ninguno: se trata como frontera, igual que un bloque anidado.
 * Sin ámbito ni raíz, se lee la página con `digestScope()`.
 *
 * @param {{root?: Element, scope?: {roots: Array<{el: Element, tag?: string}>, chrome: string}, limits?: object}} [opts]
 * @returns {{blocks: Array<{id:number, tag:string, text:string, el:Element}>, chars:number, truncated:boolean}}
 */
export function pageDigest({ root = null, scope = null, limits = DIGEST_LIMITS } = {}) {
  const S = scope || (root ? { roots: [{ el: root }], chrome: '' } : digestScope())
  const chrome = String(S.chrome || '')
  const esInterfaz = (el) => !!chrome && el.matches(chrome)
  const frontera = chrome ? (el) => isBlock(el) || esInterfaz(el) : isBlock

  const blocks = []
  let chars = 0
  let truncated = false
  let lleno = false

  const visit = (el, forcedTag = '') => {
    if (lleno) return
    if (SKIP_TAGS.has(el.tagName) || esInterfaz(el) || hidden(el)) return

    const propio = squash(buildTextIndex(el, { boundary: frontera }).text)
    if (propio.length >= limits.blockMin) {
      const texto = propio.length > limits.blockMax ? propio.slice(0, limits.blockMax) + '…' : propio
      // Lo que ocupa la línea entera para el modelo: «¶123 [código] » y el texto.
      const linea = texto.length + 12
      if (blocks.length >= limits.maxBlocks || chars + linea > limits.maxChars) {
        lleno = true
        truncated = true
        return
      }
      blocks.push({ id: blocks.length + 1, tag: forcedTag || tagLabel(el), text: texto, el })
      chars += linea
      if (texto !== propio) truncated = true
    }

    for (const child of nestedBlocks(el, esInterfaz)) {
      if (lleno) break
      visit(child)
    }
  }

  for (const r of S.roots || []) {
    if (lleno) break
    if (r?.el) visit(r.el, r.tag || '')
  }
  return { blocks, chars, truncated }
}

/**
 * Lo que viaja al panel: los bloques sin sus elementos. Un `Element` no cabe en
 * un mensaje, y el panel no debe conocer el DOM de la página de todos modos.
 */
export function serializeDigest(digest) {
  return {
    blocks: digest.blocks.map(({ id, tag, text }) => ({ id, tag, text })),
    count: digest.blocks.length,
    chars: digest.chars,
    truncated: digest.truncated,
  }
}

/** La frontera con la que se lee el texto propio de un bloque de ESTA página: bloques anidados y, en una incidencia, la interfaz. */
function blockBoundary(scope = digestScope()) {
  const chrome = String(scope.chrome || '')
  return chrome ? (el) => isBlock(el) || el.matches(chrome) : isBlock
}

/**
 * Una cita literal buscada en el ÁMBITO de lectura, raíz por raíz: lo mismo
 * que se le enseñó al modelo, y nada más. Es el último peldaño de la escalera
 * y el que resuelve un ancla `text-quote` de una observación.
 *
 * Sin esto se buscaba en `contentRoot()`, que en una incidencia de Jira es el
 * `main` entero: la cita podía caer en la barra de acciones o en una pestaña
 * de campos oculta, y contarse como marcada sin que se viera nada.
 *
 * @returns {{ok:true, strategy:string, ranges:Range[], element:Element, approximate:boolean}|null}
 */
export function resolveScopedQuote(anchor, { scope = digestScope() } = {}) {
  const busca = typeof anchor === 'string' ? { exact: anchor } : anchor || {}
  if (!busca.exact) return null
  for (const r of scope.roots || []) {
    if (!r?.el) continue
    const index = buildTextIndex(r.el, { boundary: scope.chrome ? (el) => el.matches(scope.chrome) : null })
    if (!index.text) continue
    const hit = findQuote(index.text, busca)
    if (!hit) continue
    const range = rangeFromOffsets(index, hit.start, hit.end)
    if (!range) continue
    return {
      ok: true,
      strategy: hit.strategy,
      ranges: [range],
      element: r.el,
      approximate: hit.strategy === 'fuzzy',
    }
  }
  return null
}

/** Un Range con el texto propio del bloque, del primer carácter al último. */
function wholeBlockRange(index) {
  const start = index.text.search(/\S/)
  if (start === -1) return null
  const end = index.text.replace(/\s+$/, '').length
  return rangeFromOffsets(index, start, end)
}

/**
 * Resuelve una observación «bloque + cita» contra la página de ahora.
 *
 * Misma forma de respuesta que `resolveAnchor`, para que el ejecutor no tenga
 * que distinguirlas. `approximate` avisa de que la marca no es la cita exacta:
 * o es una coincidencia aproximada, o es el bloque entero porque la cita no
 * estaba tal cual.
 *
 * @param {{block:number, hint:string, exact?:string}} anchor
 * @param {{digest?: object}} [opts] los bloques ya leídos, para no recorrer la
 *        página una vez por observación
 * @returns {{ok:boolean, strategy:string, ranges?:Range[], element?:Element, approximate?:boolean, message?:string}}
 */
export function resolveBlockQuote(anchor, { digest = null } = {}) {
  const D = digest || pageDigest()
  const exact = String(anchor?.exact || '')

  const hit = matchBlock(D.blocks, anchor)
  if (hit) {
    const el = D.blocks[hit.index].el
    // El mismo texto que vio el modelo: con la misma frontera (bloques e
    // interfaz) con la que se leyó, o la cita no se encuentra donde estaba.
    const index = buildTextIndex(el, { boundary: blockBoundary() })

    if (exact) {
      const q = findQuote(index.text, { exact })
      if (q) {
        const range = rangeFromOffsets(index, q.start, q.end)
        if (range) {
          const aproximada = q.strategy === 'fuzzy'
          return {
            ok: true,
            strategy: hit.strategy + (aproximada ? '+fuzzy' : '+quote'),
            ranges: [range],
            element: el,
            approximate: aproximada,
          }
        }
      }
    }

    const whole = wholeBlockRange(index)
    if (whole) {
      return { ok: true, strategy: hit.strategy + '+whole', ranges: [whole], element: el, approximate: !!exact }
    }
  }

  // El bloque ya no está: la cita, si tiene sustancia, se busca en el resto
  // del ÁMBITO, no en toda la página. En una incidencia de Jira «toda la
  // página» incluye la barra de acciones y las pestañas de campos ocultas: una
  // cita podía resolverse ahí y contarse como marcada sin que se viera nada.
  if (exact.length >= DIGEST_LIMITS.quoteMinGlobal) {
    const r = resolveScopedQuote(exact)
    if (r?.ok) return { ...r, strategy: 'global+' + r.strategy }
  }

  return {
    ok: false,
    strategy: 'none',
    element: contentRoot(),
    message: 'No encuentro en la página el bloque del que habla esta observación.',
  }
}
