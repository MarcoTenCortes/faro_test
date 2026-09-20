/**
 * Los enlaces que la página o la incidencia tiene EN SU CONTENIDO.
 *
 * Es la única fuente de sugerencias de páginas base que mira la PANTALLA
 * (docs/plan/anexo-B): si alguien puso en la descripción de un ticket el enlace
 * a una decisión de arquitectura, esa decisión es justo lo que hay que tener
 * delante al analizarlo, y hoy el usuario la busca a mano en cada ticket.
 *
 * Tres reglas, y las tres vienen de decisiones que ya estaban escritas:
 *
 *  - Se lee por el ÁMBITO de lectura de siempre (`digestScope()`, §4.8): los
 *    puntos de lectura de una incidencia de Jira —título, campos, descripción,
 *    comentarios— o el contenedor de contenido en Confluence. Así la fuente
 *    vale en los dos productos sin inventarse un recorrido propio, y en una
 *    página de Confluence los cientos de enlaces del árbol lateral quedan fuera
 *    por construcción, no por una lista de selectores a evitar.
 *  - Lo que el ámbito declara INTERFAZ (`scope.chrome`) no cuenta. Un «Ayuda»
 *    de la barra de acciones o un enlace de un menú no lo puso nadie para quien
 *    lee esta incidencia: lo trae Jira en todas. Misma frontera que usa el
 *    digest para no meter botones en los bloques (§8.17).
 *  - Y lo que no se ve tampoco: el enlace de una pestaña de campos plegada está
 *    en el DOM pero no delante del usuario (`visible`, la misma de tree-dom.js
 *    con la que se decide si una fila del árbol existe).
 *
 * Aquí NO se decide si un enlace lleva a una página que se puede añadir: eso lo
 * hace `confluenceLinksIn` en el panel, que es quien sabe cuál es el sitio y
 * cuál su Confluence enlazado (§8.12). Este módulo sólo LEE: devuelve la URL
 * absoluta, el texto del enlace en una línea y de qué parte de la incidencia
 * viene. No toca nada.
 *
 * Necesita DOM, así que se pina por regex y se ejerce en el banco; lo único
 * puro —qué href es siquiera un enlace— se prueba en Node.
 */

import { digestScope } from './digest.js'
import { ISSUE_LINK_REGIONS } from './jira-issue.js'
import { visible } from './tree-dom.js'

export const LINK_LIMITS = {
  /**
   * Enlaces que se leen. Una página de Confluence con una tabla de índice puede
   * tener cientos; para sugerir cinco no hacen falta más, y el panel acota otra
   * vez por su cuenta (`SUGGEST_LIMITS.linksMax`).
   */
  max: 60,
  /**
   * Lo que puede medir una URL. Más que esto no es un enlace a una página: es
   * un enlace con medio formulario dentro, y recortarlo daría una URL rota que
   * el panel intentaría parsear igual.
   */
  hrefMax: 500,
  /** Y el texto del enlace, que sólo sirve para poner título a una sugerencia. */
  textMax: 120,
}

/**
 * Los caracteres de control (C0 y C1). Se nombran por su categoría Unicode
 * porque escribirlos en una clase de caracteres deja el fuente ilegible, y
 * porque así entra también el NEL (U+0085), que abre línea y que el `\s` de
 * JavaScript no cubre.
 */
const CONTROL = /\p{Cc}/gu

/** El texto de un enlace, en una línea y acotado: es lo que acabará en una fila. */
function unaLinea(txt, max) {
  return String(txt ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * La URL absoluta de un `href`, o '' si eso no lleva a ninguna página.
 *
 * Se cae lo que no es http(s) —`javascript:`, `data:`, `mailto:`, `#` de ancla—
 * y lo que no parsea. Una URL más larga que el tope se DESCARTA en vez de
 * recortarse: media URL no es una URL, y el panel la parsearía igual creyendo
 * que está entera. Pura (`URL` es del lenguaje, no del DOM).
 *
 * @param {string} raw el href tal como está escrito, relativo o absoluto
 * @param {string} base contra qué resolverlo (la URL de la pestaña)
 */
export function linkHref(raw, base) {
  const t = String(raw ?? '').replace(CONTROL, '').trim()
  if (!t || t.startsWith('#')) return ''
  let u = null
  try {
    u = base ? new URL(t, base) : new URL(t)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  return u.href.length > LINK_LIMITS.hrefMax ? '' : u.href
}

/**
 * De qué parte de la incidencia viene un enlace. En una página de Confluence
 * ninguna región casa y todo es «pagina», que es lo que se quiere decir.
 *
 * El orden es el de `ISSUE_LINK_REGIONS` y no da lo mismo: un enlace dentro de
 * un comentario está también dentro del módulo de actividad, así que gana la
 * primera región que lo contenga.
 */
function regionDe(el) {
  for (const [nombre, sel] of Object.entries(ISSUE_LINK_REGIONS)) {
    if (el.closest(sel)) return nombre
  }
  return 'pagina'
}

/**
 * Los enlaces del contenido, en orden de lectura.
 *
 * El mismo enlace repetido en la misma región cuenta una vez: una tabla que
 * repite la misma guía en veinte filas se comería el tope sin aportar nada. El
 * mismo enlace en dos regiones sale dos veces a propósito: cuál de las dos pesa
 * más lo decide el panel, que es quien tiene la tabla de puntos.
 *
 * @param {{scope?: {roots: Array<{el: Element}>, chrome: string}, limits?: object}} [opts]
 * @returns {Array<{href: string, text: string, where: 'descripcion'|'enlaces'|'comentario'|'pagina'}>}
 */
export function pageLinks({ scope = null, limits = LINK_LIMITS } = {}) {
  const S = scope || digestScope()
  const chrome = String(S.chrome || '')
  const base = location.href
  const tope = Number.isInteger(limits?.max) && limits.max > 0 ? limits.max : LINK_LIMITS.max
  const textoMax = Number.isInteger(limits?.textMax) && limits.textMax > 0 ? limits.textMax : LINK_LIMITS.textMax

  const out = []
  const vistos = new Set()
  for (const r of S.roots || []) {
    if (out.length >= tope) break
    const raiz = r?.el
    if (!raiz?.querySelectorAll) continue
    for (const a of raiz.querySelectorAll('a[href]')) {
      if (out.length >= tope) break
      // La interfaz primero: es lo más barato de descartar y lo que más hay.
      if (chrome && a.closest(chrome)) continue
      const href = linkHref(a.getAttribute('href'), base)
      if (!href) continue
      if (!visible(a)) continue
      const where = regionDe(a)
      const clave = where + '\n' + href
      if (vistos.has(clave)) continue
      vistos.add(clave)
      out.push({ href, text: unaLinea(a.textContent, textoMax), where })
    }
  }
  return out
}
