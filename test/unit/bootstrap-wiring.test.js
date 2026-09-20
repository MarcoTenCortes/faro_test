/**
 * Cableado del content script (bootstrap.js), por regex sobre el fuente, como
 * `panel-wiring.test.js` hace con el panel y `runner-wiring.test.js` con el
 * ejecutor.
 *
 * Por qué existe: la revisión adversaria de H7 (2026-09-20) mutó trece barreras
 * del cimiento REST y doce cayeron en alguna prueba. La que no cayó fue ésta:
 * bootstrap.js no tenía NINGUNA prueba, así que se podía cambiar
 * `jqlDePlantilla(jira, msg)` por `msg.jql` en el `case` de las recientes —o leer
 * la ruta de contexto del mensaje en vez de la pestaña— con `npm run check` en
 * verde. Y bootstrap.js es justo donde viven las dos garantías que los módulos
 * puros no pueden dar, porque dependen de quién los llama:
 *  - las lecturas «recientes» se eligen por `kind` entre plantillas FIJAS; el
 *    texto de la consulta nunca viene en el mensaje (§8.12, §8.19);
 *  - el origen y la ruta de contexto de Jira salen de LA PESTAÑA (`location`),
 *    nunca del mensaje.
 * No se puede ejecutar en Node (es un script clásico que cuelga de `chrome` y de
 * `location` al cargarse), así que se comprueba el cableado.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const JS = sinComentarios(readFileSync(join(ROOT, 'src/content/bootstrap.js'), 'utf8'))

function cuenta(src, trozo) {
  return src.split(trozo).length - 1
}

/** El trozo del fuente entre dos marcas, las dos obligatorias y en ese orden. */
function entre(desde, hasta) {
  const a = JS.indexOf(desde)
  assert(a >= 0, `no encuentro «${desde}» en bootstrap.js`)
  const b = JS.indexOf(hasta, a + desde.length)
  assert(b > a, `no encuentro «${hasta}» detrás de «${desde}»`)
  return JS.slice(a, b)
}

test('SEGURIDAD: las lecturas recientes de Jira eligen una plantilla por kind y nunca leen la consulta del mensaje', () => {
  const caso = entre('case MSG.RECENT_ISSUES: {', 'case MSG.RECENT_PAGES: {')
  assert(caso.includes('const jql = jqlDePlantilla(jira, msg)'), 'la consulta sale de jqlDePlantilla')
  assert(caso.includes('if (!jql) {'), 'un kind que no es de la lista no pide nada')
  const rechazo = caso.indexOf("sendResponse({ ok: false, reason: 'consulta no permitida' })")
  const peticion = caso.indexOf('jira.searchIssues(')
  assert(rechazo >= 0 && peticion > rechazo, 'el rechazo va ANTES de pedir nada')
  assert(caso.includes('sitio, jql, {'), 'lo que se ejecuta es la plantilla, no otra cosa')
  assert(!caso.includes('msg.jql'), 'el texto de la consulta no puede venir en el mensaje')

  // El ÚNICO sitio que lee `msg.jql` es JQL_SEARCH, cuya procedencia garantiza
  // quien la manda (§8.12) y que pasa por cleanJql dentro de searchIssues.
  eq(cuenta(JS, 'msg.jql'), 1)
  assert(entre('case MSG.JQL_SEARCH: {', 'case MSG.RECENT_ISSUES: {').includes('msg.jql'))
})

test('SEGURIDAD: las lecturas recientes de Confluence eligen una plantilla por kind; ningún CQL viaja en un mensaje', () => {
  const caso = entre('case MSG.RECENT_PAGES: {', 'case MSG.SPACE_PAGES: {')
  assert(caso.includes('const cql = cqlDePlantilla(conf, msg)'), 'la consulta sale de cqlDePlantilla')
  assert(caso.includes('if (!cql) {'), 'un kind que no es de la lista no pide nada')
  const rechazo = caso.indexOf("sendResponse({ ok: false, reason: 'consulta no permitida' })")
  const peticion = caso.indexOf('conf.searchContent(')
  assert(rechazo >= 0 && peticion > rechazo, 'el rechazo va ANTES de pedir nada')
  assert(caso.includes('sitioConfluence(conf, msg), cql, {'), 'lo que se ejecuta es la plantilla')
  eq(cuenta(JS, 'msg.cql'), 0, 'ningún case lee un CQL del mensaje')
})

test('SEGURIDAD: las dos funciones de plantilla sólo eligen entre las fijas, y lo demás es null', () => {
  const jql = entre('function jqlDePlantilla(jira, msg) {', 'function cqlDePlantilla(conf, msg) {')
  for (const fija of ['jira.historyJql()', 'jira.mineJql(', 'jira.projectJql(msg.projectKey,', 'jira.relatedJql(msg.issueKey)']) {
    assert(jql.includes(fija), 'falta la plantilla ' + fija)
  }
  assert(/default:\s*return null/.test(jql), 'un kind desconocido no es una consulta')
  assert(!jql.includes('`') && !/['"]\s*\+/.test(jql), 'aquí no se CONSTRUYE ninguna consulta: sólo se elige')

  const cql = entre('function cqlDePlantilla(conf, msg) {', 'function sitioConfluence(conf, msg) {')
  for (const fija of ['conf.viewedCql(', 'conf.mineCql(', 'conf.idsCql(msg.ids)']) {
    assert(cql.includes(fija), 'falta la plantilla ' + fija)
  }
  assert(/default:\s*return null/.test(cql), 'un kind desconocido no es una consulta')
  assert(!cql.includes('`') && !/['"]\s*\+/.test(cql), 'aquí no se CONSTRUYE ninguna consulta: sólo se elige')
})

test('SEGURIDAD: el origen y la ruta de contexto salen de la pestaña, nunca del mensaje', () => {
  const jira = entre('async function sitioJira(msg) {', 'function jqlDePlantilla(jira, msg) {')
  assert(jira.includes('origin: location.origin'), 'el origen de Jira es el de la pestaña')
  assert(jira.includes('jiraPrefix: jiraContextPath(location.pathname)'), 'la ruta de contexto se OBSERVA')

  const conf = entre('function sitioConfluence(conf, msg) {', 'chrome.runtime.onMessage.addListener(')
  assert(conf.includes('origin: location.origin'), 'el origen de Confluence es el de la pestaña')
  // El prefijo del wiki SÍ lo puede proponer el panel (el que observó y guardó,
  // como PAGE_ANCESTORS y PAGE_SEARCH desde siempre): `resolveWikiPrefix` sólo
  // lo acepta con forma de ruta y siempre cuelga del origen de la pestaña.
  assert(
    conf.includes('conf.resolveWikiPrefix({ requested: msg.wikiPrefix, cloud: !!msg.cloud, pathname: location.pathname })'),
    'el prefijo del wiki pasa por resolveWikiPrefix'
  )

  for (const prohibido of ['msg.origin', 'msg.jiraPrefix', 'msg.url', 'msg.path', 'msg.host']) {
    eq(cuenta(JS, prohibido), 0, `${prohibido} no puede decidir a dónde se pide`)
  }
})

test('SEGURIDAD: toda petición del content script sale por el fetch que se le pasa a un módulo REST', () => {
  // Ningún `fetch('…')` propio: la única forma es la flecha que se entrega a
  // getJson, que es quien comprueba el origen de la URL ya montada.
  const propias = cuenta(JS, 'fetch(')
  assert(propias >= 8, 'los ocho lectores REST siguen ahí (siete de H7 y el remotelink de H10)')
  eq(cuenta(JS, '(u, o) => fetch(u, o)'), propias, 'un fetch que no es la flecha de un lector REST')
})

// --------------------------------------------------------------------- H10
// Los enlaces de la página. Es el único `case` que junta las dos mitades —leer
// el DOM y, en una incidencia, pedir a la API— y las dos garantías que no
// pueden dar los módulos puros están aquí: de QUÉ incidencia se piden los
// enlaces remotos lo dice la pantalla, y a qué hosts se admite que apunten lo
// dice el registro del sitio, nunca el enlace que vuelve.

test('SEGURIDAD: los enlaces se leen del ámbito de la PESTAÑA y la clave de la incidencia sale de la pantalla', () => {
  const caso = entre('case MSG.PAGE_LINKS: {', 'case MSG.JQL_SEARCH: {')
  assert(caso.includes('pageLinks({ scope: digestScope() })'), 'se lee por el ámbito de siempre')
  assert(caso.includes('jiraIssueKey(document, location.href)'), 'la clave la decide la pantalla, no el mensaje')
  assert(!caso.includes('msg.issueKey'), 'el panel no puede decir de qué incidencia se piden los enlaces remotos')
  assert(!caso.includes('msg.links') && !caso.includes('msg.scope'), 'aquí no llega nada que ya esté leído')
  // Y el content script sigue sin tocar la página: lee y contesta.
  for (const prohibido of ['setAttribute(', 'appendChild(', '.click()', 'innerHTML']) {
    assert(!caso.includes(prohibido), `el case de los enlaces no debería usar ${prohibido}`)
  }
})

test('SEGURIDAD: el remotelink sólo se pide con una incidencia delante, sólo si el panel no lo apagó, y filtrado por host', () => {
  const caso = entre('case MSG.PAGE_LINKS: {', 'case MSG.JQL_SEARCH: {')
  assert(caso.includes('if (issueKey && msg.remote !== false) {'), 'sin incidencia o con restTools apagado no hay petición')
  const guarda = caso.indexOf('if (issueKey && msg.remote !== false) {')
  const peticion = caso.indexOf('jira.fetchRemoteLinks(')
  assert(guarda >= 0 && peticion > guarda, 'la guarda va ANTES de pedir nada')
  assert(caso.includes('sitioJira(msg)'), 'el sitio se deduce de la pestaña, como en las demás lecturas')
  assert(caso.includes('const enlazado = hostValido(msg.confluenceHost)'), 'el host enlazado que propone el panel se valida')
  assert(
    caso.includes('hosts: enlazado ? [location.hostname, enlazado] : [location.hostname]'),
    'un enlace remoto sólo puede apuntar al sitio o a su Confluence enlazado'
  )
  // El enlace del DOM no depende de la API: si la petición falla, `remote` trae
  // su motivo y lo leído sigue yendo en la respuesta (§8.14).
  assert(caso.includes('let remote = null'), 'sin incidencia, remote es null y no un fallo')
  assert(/sendResponse\(\{ ok: true, links, issue, issueKey, remote,/.test(caso), 'la respuesta lleva las dos mitades')
})

test('el árbol de un espacio no acepta topes por mensaje: los pone el módulo', () => {
  const caso = entre('case MSG.SPACE_PAGES: {', 'case MSG.FAVOURITE_FILTERS: {')
  assert(caso.includes('msg.spaceKey, { limit: msg.limit })'), 'sólo viaja el tamaño de página, que el módulo acota')
  for (const tope of ['maxPages', 'maxRequests', 'timeoutMs']) {
    assert(!caso.includes(tope), `${tope} no viaja en el mensaje`)
  }
})

// --------------------------------------------------------------------- H11
// El diario de «Qué mirar hoy» lo apunta el service worker, que NO puede leer el
// DOM: en un Confluence Data Center una página `/display/ESPACIO/Título` sólo se
// identifica por su `<meta name="ajs-page-id">`, así que el id tiene que viajar
// en los dos avisos del content script. El SW prueba que apunta el `pageId` que
// RECIBE; que el content script lo MANDE no lo vigilaba nadie (lo dejó anotado
// quien construyó el diario): estas tres líneas se podían borrar en verde.

test('H11: los dos avisos del content script llevan el pageId leído de la página', () => {
  assert(JS.includes("import(url('src/content/page-id.js'))"), 'el id lo da page-id.js, que no importa nada')
  assert(JS.includes('{ pageIdFromDom }'), 'se carga con lo demás al arrancar')
  assert(
    JS.includes('chrome.runtime.sendMessage({ type: MSG.URL_CHANGED, url: href, pageId: pageIdFromDom() })'),
    'cada cambio de URL dice qué página es'
  )
  const aviso = entre('const announce = () => {', "if (document.readyState === 'complete'")
  assert(aviso.includes('type: MSG.CONTENT_READY, url: location.href, pageId: pageIdFromDom()'), 'y el aviso de que la pestaña está lista, también')
  // Sólo el id: ni el título ni nada del contenido viajan en estos avisos.
  assert(!/document\.title|textContent|innerText/.test(aviso), 'del DOM sólo sale el id de la página')
  // Y el aviso NO se trae dom-utils.js, que es lo que hacía hasta la revisión
  // adversaria de H11: son 11 KB más tree-dom.js y config.js por sus imports
  // estáticos —unos 37 KB— pedidos, parseados y ejecutados en CADA carga de
  // página para hacer un `querySelector`. El arranque sí lo carga, porque de ahí
  // sale `onUrlChange`, pero el arranque ocurre cuando llega el primer mensaje.
  assert(!aviso.includes('dom-utils.js'), 'el aviso de cada carga no puede arrastrar dom-utils.js')
  assert(aviso.includes("import(url('src/content/page-id.js'))"), 'sólo los mensajes y el id')
})
