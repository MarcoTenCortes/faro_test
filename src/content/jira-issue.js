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
 * Sólo se leen nodos; no se toca nada. Es DOM puro y se comprueba en el banco,
 * salvo una pieza que no lo es y que sí se ejecuta en Node
 * (`statusFromTooltip`, jira-issue.test.js): sacar el nombre del estado del
 * atributo `title` del botón de transiciones, que es HTML escrito por la página.
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
 * De qué parte de la incidencia viene un enlace, para poder decir por qué se
 * sugiere una página («enlazada desde la descripción», «desde un comentario»).
 *
 * Vive aquí, con `ISSUE_CHROME` y con los ids de los campos, porque qué es una
 * incidencia en pantalla se decide en UN sitio (§8.17): `page-links.js` sólo
 * pregunta. El orden importa y lo usa quien lee —un comentario está dentro del
 * módulo de actividad, así que la región más concreta va primero—, y lo que no
 * case con ninguna es «pagina», que es lo que pasa en Confluence entero.
 */
export const ISSUE_LINK_REGIONS = {
  descripcion: '#description-val, #descriptionmodule',
  enlaces: '#linkingmodule',
  comentario: '#issue_actions_container, .action-body',
}

/** Dónde pinta Jira la clave de la incidencia abierta (Data Center). */
const KEY_EL = ['#key-val', '.issue-header-keys a']

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
  // de una incidencia enlazada. Y si ninguno de éstos está —el Jira del
  // usuario no tiene ni uno—, el estado sale del botón de transiciones, que no
  // es un selector más porque su valor no es su texto (`leerEstado`).
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

/** Una cadena en una línea, sin espacios de sobra. */
function linea(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Texto de una línea, como lo ve el usuario. */
function texto(el) {
  return linea(el?.textContent)
}

// ------------------------------------------------------- el estado, aparte

/**
 * El botón de transiciones, que es donde un Jira Data Center moderno pinta el
 * estado. Comprobado en el Jira del usuario (2026-09-21): ahí NO existe
 * `#status-val` ni ninguna pastilla de estado en la cabecera ni en los
 * detalles, y sin esto el estado salía vacío y el análisis se quedaba sin fase.
 *
 *   li#opsbar-opsbar-transitions.aui-buttons.pluggable-ops   (dentro de .ops-cont)
 *     a#opsbar-transitions_more.aui-button.aui-dropdown2-trigger
 *        .opsbar-transitions__status-category_indeterminate
 *        [role=button][aria-haspopup=true][title='<span class="jira-issue-status-tooltip-title">…</span>…']
 *       span.dropdown-text  «DevTeam PBI is ready f...»   ← recortado por Jira
 *
 * Vive dentro de la barra de acciones, o sea que es ISSUE_CHROME: su texto no
 * entra en ningún bloque y nadie lo pulsa (es un disparador de menú, M9). Aquí
 * sólo se lee.
 */
const STATUS_BUTTON = '#opsbar-transitions_more'

/**
 * La categoría del estado tal como Jira la escribe en la clase del control:
 * `opsbar-transitions__status-category_done` en el botón de transiciones y
 * `jira-issue-status-lozenge-done` en la pastilla clásica. Las tres son las de
 * Jira y van en el propio nombre de la clase, así que la lista es esta regex;
 * el panel las vuelve a validar al normalizar (`STATUS_CATEGORIES`).
 *
 * Importa porque el NOMBRE del estado lo traduce Jira y lo pone cada equipo
 * («For PSO Review», «FOR SC TO RESPOND»), y la categoría no: es lo único que
 * dice en qué punto del flujo está una incidencia de un Jira a medida.
 */
const STATUS_CATEGORY_CLASS = /\b(?:opsbar-transitions__status-category|jira-issue-status-lozenge)[_-](new|indeterminate|done)\b/

/** El nombre del estado dentro del `title` del botón, que es HTML. */
const TOOLTIP_TITLE = /<span[^>]*\bclass\s*=\s*["'][^"']*\bjira-issue-status-tooltip-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i

/**
 * Un elemento cuyo contenido NO es texto que nadie lea. Se va con su contenido
 * antes de quitar las etiquetas: si no, el `alert(1)` de un `<script>` escrito
 * en el atributo acabaría dentro del nombre del estado (texto inofensivo, pero
 * un nombre de estado es lo que el usuario LEE, y eso no se lee).
 */
const NO_ES_TEXTO = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/** Las entidades HTML que se ven en ese atributo. Lo que no esté aquí se deja tal cual. */
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(160) }
const ENTIDAD = /&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi

/**
 * Las entidades de una cadena, decodificadas en UNA pasada: así un `&amp;lt;`
 * se queda en «&lt;» y no se decodifica dos veces. Una entidad que no se conoce
 * se deja como está —inventarle un carácter sería peor que enseñarla—, y el
 * nombre de un método del prototipo no es una entidad (`Object.hasOwn`).
 */
function sinEntidades(s) {
  return s.replace(ENTIDAD, (m, ref) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X'
      const n = parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10)
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    const k = ref.toLowerCase()
    return Object.hasOwn(ENTIDADES, k) ? ENTIDADES[k] : m
  })
}

/**
 * El nombre del estado que lleva dentro el `title` del botón de transiciones,
 * o ''. Pura: de una cadena a otra cadena.
 *
 * El texto visible del botón NO vale: Jira lo recorta él («DevTeam PBI is ready
 * f...») y un estado recortado acabaría citado como exacto en el prompt y en una
 * consulta. El nombre entero está en el `title`, que es HTML.
 *
 * Se saca con una regex acotada al primer `span` del tooltip, se le quita
 * cualquier marcado de dentro y se decodifican las entidades, EN ESE ORDEN: así
 * un `&lt;b&gt;` escrito en el nombre queda como el texto «<b>» y no como una
 * etiqueta. Nada de esto construye un nodo —ni `innerHTML`, ni `DOMParser`, ni
 * uno inerte—, que es lo que hace que un `title` hostil no pueda ejecutar ni
 * inyectar nada: de aquí sale una CADENA, y una cadena no tiene `onerror`.
 * Además así la barrera se ejecuta en Node contra entradas hostiles
 * (jira-issue.test.js), que con `DOMParser` no se podría.
 *
 * Lo que devuelve es de una línea y sin espacios de sobra —los duros incluidos—,
 * como cualquier otro valor leído de la pantalla.
 */
export function statusFromTooltip(title) {
  const m = TOOLTIP_TITLE.exec(String(title ?? ''))
  return m ? linea(sinEntidades(m[1].replace(NO_ES_TEXTO, ' ').replace(/<[^>]*>/g, ' '))) : ''
}

/** Jira recorta el texto del botón con puntos suspensivos: eso no es el nombre. */
const RECORTADO = /(?:…|\.\.\.)$/

/** La categoría que declara un control, la suya o la de la pastilla que lleve dentro. */
function categoriaDe(el) {
  if (!el?.getAttribute) return ''
  const dentro = el.querySelector?.('[class*="-category_"], [class*="-lozenge-"]')
  const clases = (el.getAttribute('class') || '') + ' ' + (dentro?.getAttribute('class') || '')
  return STATUS_CATEGORY_CLASS.exec(clases)?.[1] || ''
}

/**
 * El estado y su categoría. Los selectores de siempre primero y en su orden
 * —otras instalaciones sí tienen `#status-val`—, y el botón de transiciones
 * como respaldo. La categoría es la de donde salió el nombre si la declara y,
 * si no, la del botón: habla del mismo estado.
 *
 * @param {Document} doc
 * @param {string} nombre lo que dieron los selectores de siempre, o ''
 * @param {Element|null} el de dónde salió ese nombre
 */
function leerEstado(doc, nombre, el) {
  const boton = doc.querySelector(STATUS_BUTTON)
  let status = nombre
  if (!status && boton) {
    status = statusFromTooltip(boton.getAttribute('title'))
    // Sin `title` queda el texto visible, y sólo si Jira no lo ha recortado.
    if (!status) {
      const visto = texto(boton)
      if (visto && !RECORTADO.test(visto)) status = visto
    }
  }
  return { status, category: (nombre && categoriaDe(el)) || categoriaDe(boton) }
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
 * @returns {{type:string, status:string, statusCategory:string, priority:string, resolution:string, assignee:string, reporter:string, epic:string, epicKey:string, sprint:string, fixVersions:string[], affectsVersions:string[], components:string[], labels:string[]}|null}
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
  let statusEl = null
  for (const [k, re] of Object.entries(FIELD_LABELS)) {
    // Por id, en orden de preferencia (el primero que exista); si no, por etiqueta.
    const porId = (FIELD_IDS[k] || []).map((s) => doc.querySelector(s)).find(Boolean) || null
    const el = porId || pares.find((p) => re.test(p.nombre))?.el || null
    if (k === 'epic') epicEl = el
    if (k === 'status') statusEl = el
    out[k] = LIST_FIELDS.has(k) ? lista(el) : texto(el)
  }
  // El estado, aparte: donde no está en los detalles lo pinta el botón de
  // transiciones, y de ahí sale también su CATEGORÍA, que es lo que no se
  // traduce y lo único que sitúa un estado a medida en su flujo.
  const estado = leerEstado(doc, out.status, statusEl)
  out.status = estado.status
  out.statusCategory = estado.category
  // Y la épica otra vez, esta vez como CLAVE: es lo único con lo que se puede
  // escribir una consulta que la encuentre. No sustituye a `epic` —que es lo
  // que el usuario lee en pantalla— ni entra en el prompt: sirve para construir
  // «Misma épica ENG-1» sin pedirle nada al modelo.
  out.epicKey = claveDeEnlace(epicEl)
  return out
}

/**
 * La clave de la incidencia abierta, o '' si esta página no es una.
 *
 * Primero la de la pantalla (`#key-val`, donde el Data Center la pinta) y, si
 * no está, la del `/browse/…` de la URL, con la MISMA regex con la que se saca
 * la clave del enlace de un campo. Las dos pasan por `validIssueKey`, que es
 * donde se decide qué tiene forma de clave: lo que salga de aquí acaba en la
 * ruta de un GET a la API del propio Jira (`remoteLinksPath`), así que no puede
 * ser lo que ponga el DOM sin más.
 *
 * El `href` se pasa aparte y no se lee de `location` para que esto siga siendo
 * DOM puro y comprobable en el banco con una URL cualquiera.
 *
 * @param {Document} [doc]
 * @param {string} [href] la URL de la pestaña, como respaldo
 */
export function jiraIssueKey(doc = document, href = '') {
  if (!VIEW.some((s) => doc.querySelector(s))) return ''
  for (const sel of KEY_EL) {
    const key = validIssueKey(texto(doc.querySelector(sel)))
    if (key) return key
  }
  const m = BROWSE_KEY.exec(String(href || ''))
  return m ? validIssueKey(m[1]) : ''
}
