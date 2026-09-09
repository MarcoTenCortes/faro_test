/**
 * Qué es una incidencia de Jira en pantalla, decidido en un solo sitio.
 *
 * El modo Análisis lee la página en bloques numerados y se los enseña al
 * modelo; en Confluence basta con el contenedor del contenido. Una incidencia
 * de Jira no tiene «un contenedor»: `main` lo envuelve todo, incluida la barra
 * de acciones («Editar», «Añadir comentario», «Asignar»…), las pestañas, el
 * editor de comentarios y los paneles de integraciones. Leerlo entero llenaba
 * los bloques de botones y el modelo hablaba de una interfaz que el usuario no
 * ha escrito. Comprobado contra el Jira Data Center del usuario (Jira 9):
 *
 *   main#main[role=main] > .issue-view
 *     header#stalker.issue-header      → #summary-val (el título), .command-bar, .ops-menus
 *     .issue-body-content
 *       .issue-main-column > .module   → #details-module (#issuedetails li.item «Tipo: Tarea»,
 *                                        pestañas de campos personalizados), #descriptionmodule
 *                                        (#description-val .user-content-block), módulos de
 *                                        plugins (Xray: «Detalles del Test»), #linkingmodule,
 *                                        #activitymodule (#issue_actions_container > .issue-data-block:
 *                                        .action-head con autor y fecha, .action-body con el texto,
 *                                        .action-links con «Anclar/Editar/Borrar»), #addcomment (el editor)
 *       #viewissuesidebar > .module    → #peoplemodule, #datesmodule, el panel Ágil, integraciones
 *
 * Aquí se elige, en orden de lectura: el título como encabezado, y de cada
 * módulo su cabecera («Descripción», «Actividad») como h2 y su contenido, sin
 * el editor de comentarios ni los paneles de integraciones. Y se dice qué es
 * interfaz —botones, barras, pestañas, enlaces de acción—, para que ni sea un
 * bloque ni su texto entre en el bloque de al lado («Contraer el comentario»
 * abría cada comentario). La forma de Cloud NO está comprobada: hay unos
 * selectores de su vista por si acaso, y si no casan se lee como siempre.
 *
 * Sólo se leen nodos; no se toca nada. Es DOM puro: se comprueba en el banco.
 */

/** La vista de incidencia, si la página lo es. Data Center primero; Cloud sin verificar. */
const VIEW = ['#issue-content', '.issue-view', '[data-testid="issue.views.issue-details.issue-layout.container-left"]']

/** El título de la incidencia, que se lee como h1. */
const SUMMARY = ['#summary-val', '#stalker h1', '[data-testid="issue.views.issue-base.foundation.summary.heading"]']

/** Los módulos de la vista de Data Center, columna principal y panel lateral, en orden de documento. */
const MODULES = '.issue-main-column .module, #viewissuesidebar .module'

/**
 * Módulos que no son contenido de la incidencia: el editor de comentarios (y
 * su copia pegajosa), el área de soltar adjuntos, y los paneles de
 * integraciones (Structure, Git, Bamboo, el exportador de Xray). Lo que un
 * plugin pinte como módulo y no esté aquí se lee: puede ser contenido, como
 * los detalles de un test de Xray.
 */
const SKIP_MODULES = /^(addcomment|dnd-metadata|structuremodule|structure-helper-panel|git-issue-webpanel|bamboo-|raven-)/

/**
 * Regiones de la vista de Cloud, por si la de Data Center no está. Los
 * `data-testid` de Cloud cambian sin avisar y no se han comprobado: si no
 * casan, no pasa nada, se lee el contenedor de siempre.
 */
const CLOUD_REGIONS = [
  { sel: '[data-testid="issue.views.issue-base.context.context-items.primary-items"]' },
  { sel: '[data-testid="issue.views.field.rich-text.description"]' },
  { sel: '[data-testid="issue.activity.comments-list"]' },
]

/**
 * Lo que es interfaz y no contenido, esté donde esté dentro de la incidencia:
 * no se trocea y su texto no entra en ningún bloque.
 */
export const ISSUE_CHROME = [
  'button',
  '[role="button"]',
  '[role="toolbar"]',
  '[role="tablist"]',
  '[role="menu"]',
  '[role="menubar"]',
  '.tabs-menu',
  '.aui-toolbar2',
  '.command-bar',
  '.ops-menus',
  '#issue-header-pager',
  '.action-links',
  '.twixi',
  '.toggle-title',
  '.mod-header a',
  '.mod-header .ops',
  '.aui-dropdown2',
  '.issue-drop-zone .issue-drop-zone',
  '.dnd-drop-zone',
].join(', ')

/**
 * Los puntos de lectura de la incidencia abierta, o null si esta página no es
 * una incidencia de Jira.
 *
 * @param {Document} [doc]
 * @returns {{roots: Array<{el: Element, tag?: string}>, chrome: string}|null}
 *          `roots` en orden de lectura; `tag` fuerza la etiqueta del bloque
 *          propio de esa raíz (el título es h1 aunque sea un div).
 */
export function jiraIssueScope(doc = document) {
  const view = VIEW.map((s) => doc.querySelector(s)).find(Boolean)
  if (!view) return null

  const roots = []
  const summary = SUMMARY.map((s) => doc.querySelector(s)).find((el) => el && el.textContent.trim())
  if (summary) roots.push({ el: summary, tag: 'h1' })

  for (const m of doc.querySelectorAll(MODULES)) {
    if (SKIP_MODULES.test(m.id || '')) continue
    // Un módulo dentro de otro (el editor de comentarios trae dos anidados)
    // ya viene con su padre, o se saltó con él.
    if (m.parentElement?.closest('.module')) continue
    const head = m.querySelector(':scope > .mod-header h2, :scope > .mod-header h3, :scope > .mod-header h4')
    if (head && head.textContent.trim()) roots.push({ el: head, tag: 'h2' })
    const body = m.querySelector(':scope > .mod-content')
    if (body) roots.push({ el: body })
  }

  // Sin módulos de Data Center, las regiones de Cloud que haya.
  if (roots.length <= 1) {
    for (const { sel } of CLOUD_REGIONS) {
      const el = doc.querySelector(sel)
      if (el) roots.push({ el })
    }
  }

  // El título solo no es una incidencia legible: sería enseñarle al modelo una
  // página de un bloque, sin descripción ni comentarios que anclar. Si no
  // reconocemos el cuerpo, se lee el contenedor de siempre, como promete la
  // cabecera de este módulo.
  const cuerpo = roots.filter((r) => r.el !== summary)
  return cuerpo.length ? { roots, chrome: ISSUE_CHROME } : null
}
