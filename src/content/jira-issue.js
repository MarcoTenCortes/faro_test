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

import { validIssueKey } from '../atlassian/site.js'

/** La vista de incidencia, si la página lo es. Data Center primero; Cloud sin verificar. */
const VIEW = ['#issue-content', '.issue-view', '[data-testid="issue.views.issue-details.issue-layout.container-left"]']

/**
 * El título de la incidencia, que se lee como h1. En un Jira 9 DC real el
 * `#summary-val` no siempre está donde se espera (pasó de verdad: el título
 * salía como el h2 de un módulo); por eso valen también el bloque del
 * encabezado y su h1.
 */
const SUMMARY = [
  '#summary-val',
  '#issue_header_summary',
  '#stalker h1',
  '.issue-header-content h1',
  '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
]

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

// ------------------------------------------------------------- los campos

/**
 * Los campos de la incidencia, por el id que llevan en Data Center (el
 * `<span id="type-val" class="value">` de siempre) y, si no lo llevan, por su
 * etiqueta en pantalla, en español o en inglés. Sólo los que cambian cómo se
 * analiza un ticket: el tipo y el estado sobre todo, y lo que sitúa el
 * trabajo (prioridad, resolución, personas, épica, sprint, versiones,
 * componentes, etiquetas). No se leen para marcarlos —para eso están los
 * bloques— sino para decirle al modelo qué es la incidencia; por eso valen
 * también los de una pestaña de campos que no esté a la vista.
 */
const FIELD_IDS = {
  type: ['#type-val'],
  // El estado no siempre está en la lista de detalles (pasó de verdad: un
  // Jira 9 DC lo tenía sólo como pastilla en la cabecera, y el modelo se iba
  // a buscarlo con la herramienta). La pastilla de estado tiene una clase
  // propia; se acota a la cabecera y al módulo de detalles para no coger la
  // de una incidencia enlazada.
  status: [
    '#status-val',
    '#issue-header .jira-issue-status-lozenge',
    '.issue-header-content .jira-issue-status-lozenge',
    '.status-view .jira-issue-status-lozenge',
    '#details-module .jira-issue-status-lozenge',
  ],
  priority: ['#priority-val'],
  resolution: ['#resolution-val'],
  assignee: ['#assignee-val'],
  reporter: ['#reporter-val'],
  fixVersions: ['#fixfor-val'],
  affectsVersions: ['#versions-val'],
  components: ['#components-val'],
}

/** La etiqueta del campo tal como Jira la pinta («Tipo:», «Issue Type:»), sin los dos puntos. */
const FIELD_LABELS = {
  type: /^(tipo|tipo de incidencia|type|issue type)$/i,
  status: /^(estado|status)$/i,
  priority: /^(prioridad|priority)$/i,
  resolution: /^(resoluci[oó]n|resolution)$/i,
  assignee: /^(persona asignada|asignad[oa] a|responsable|assignee)$/i,
  reporter: /^(informador|informante|reporter)$/i,
  epic: /^(epic link|enlace de [eé]pica|[eé]pica|epic|epic name|parent|padre)$/i,
  sprint: /^sprint$/i,
  fixVersions: /^(versi[oó]n(?:es)? correctora(?:s)?|versi[oó]n(?:es)? de correcci[oó]n|fix version\/?s?|fix versions?)$/i,
  affectsVersions: /^(versi[oó]n(?:es)? afectada(?:s)?|affects version\/?s?|affected versions?)$/i,
  components: /^(componente\/?s|componentes?|components?)$/i,
  labels: /^(etiquetas?|labels?)$/i,
}
const LIST_FIELDS = new Set(['fixVersions', 'affectsVersions', 'components', 'labels'])
/** La clave que lleva dentro un enlace a una incidencia («/browse/ENG-7», «/jira/browse/ENG-7?src=x»). */
const BROWSE_KEY = /\/browse\/([^/?#]+)/
/** Lo que escribió un usuario: la descripción, los comentarios y la actividad. Un campo nunca sale de ahí. */
const USER_CONTENT = '#description-val, .user-content-block, .action-body, .activity-comment, #issue_actions_container'

/** Texto de una línea, como lo ve el usuario. */
function texto(el) {
  return String(el?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Un valor que es una lista (etiquetas, versiones, componentes): sus elementos; si no, el texto entero, separado por comas. */
function lista(el) {
  if (!el) return []
  const items = el.querySelectorAll('li, .lozenge, a')
  const partes = items.length ? [...items].map(texto).filter(Boolean) : texto(el).split(/\s*,\s*/)
  return [...new Set(partes.map((s) => s.replace(/,$/, '').trim()).filter(Boolean))]
}

/**
 * La clave de incidencia que lleva el ENLACE de un campo, o ''.
 *
 * Sólo del `href`, nunca del texto: el campo de la épica enseña su NOMBRE
 * («Rotación de credenciales»), y en Data Center `'Epic Link' = nombre` no
 * encuentra nada —hay que buscar por clave, y por nombre hace falta un
 * complemento (docs/plan/anexo-C, «APIs externas»)—. Lo que salga de aquí acaba
 * dentro de una consulta JQL, así que pasa por `validIssueKey`, que es donde se
 * decide qué tiene forma de clave; si el campo no enlaza a ninguna, no hay
 * clave, y quien la pida se queda sin ella (el chip «Misma épica» no se ofrece).
 */
function claveDeEnlace(el) {
  for (const a of el?.querySelectorAll?.('a[href]') || []) {
    const m = BROWSE_KEY.exec(a.getAttribute('href') || '')
    const key = m ? validIssueKey(m[1]) : ''
    if (key) return key
  }
  return ''
}

/**
 * Los campos de la incidencia abierta, o null si esta página no es una.
 *
 * @param {Document} [doc]
 * @returns {{type:string, status:string, priority:string, resolution:string, assignee:string, reporter:string, epic:string, epicKey:string, sprint:string, fixVersions:string[], affectsVersions:string[], components:string[], labels:string[]}|null}
 */
export function jiraIssueFields(doc = document) {
  if (!VIEW.some((s) => doc.querySelector(s))) return null

  // Los pares etiqueta → valor que Jira pinta en los módulos: el `li.item`
  // de la lista de detalles («Tipo: Tarea») y los `dt`/`dd` del panel lateral
  // («Persona asignada:» / «Sin asignar»). Nunca lo que escribió un usuario:
  // un <dl> en la descripción o en un comentario podría fabricar un «Estado:»
  // y cambiar la fase del análisis (lo encontró la revisión).
  const pares = []
  for (const item of doc.querySelectorAll('#issuedetails li.item, .property-list li.item')) {
    if (item.closest(USER_CONTENT)) continue
    const nombre = item.querySelector('.name')
    const valorEl = item.querySelector('.value')
    if (nombre && valorEl) pares.push({ nombre: texto(nombre).replace(/:$/, ''), el: valorEl })
  }
  for (const dt of doc.querySelectorAll('#viewissuesidebar dt, .issue-view dt')) {
    if (dt.closest(USER_CONTENT)) continue
    const dd = dt.nextElementSibling
    if (dd && dd.tagName === 'DD') pares.push({ nombre: texto(dt).replace(/:$/, ''), el: dd })
  }

  const out = {}
  let epicEl = null
  for (const [k, re] of Object.entries(FIELD_LABELS)) {
    // Por id, en orden de preferencia (el primero que exista); si no, por etiqueta.
    const porId = (FIELD_IDS[k] || []).map((s) => doc.querySelector(s)).find(Boolean) || null
    const el = porId || pares.find((p) => re.test(p.nombre))?.el || null
    if (k === 'epic') epicEl = el
    out[k] = LIST_FIELDS.has(k) ? lista(el) : texto(el)
  }
  // Y la épica otra vez, esta vez como CLAVE: es lo único con lo que se puede
  // escribir una consulta que la encuentre. No sustituye a `epic` —que es lo
  // que el usuario lee en pantalla— ni entra en el prompt: sirve para construir
  // «Misma épica ENG-1» sin pedirle nada al modelo.
  out.epicKey = claveDeEnlace(epicEl)
  return out
}
