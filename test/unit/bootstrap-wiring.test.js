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
 *
 * Desde H27 (PLAN3 §3.1) también el ARRANQUE: la extensión se cargó por fin en
 * un Chrome de verdad y el content script no arrancaba, contestaba `{ok:false}`
 * a todo —PING incluido— y para el service worker «hay script roto» y «no hay
 * script» eran lo mismo. Dos trozos sí se ejecutan aquí: `onUrlChange` de
 * dom-utils.js, que no toca el DOM al importarse (el sondeo que un huérfano
 * tiene que saber parar), y `bootErrorText`, que se saca del fuente por su
 * línea porque de ella depende que el id de la extensión no viaje al panel.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MSG } from '../../src/shared/messages.js'
import { onUrlChange } from '../../src/content/dom-utils.js'

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
  // EL CAMBIO (H25): de ocho a nueve, con el de las relaciones de un diagrama.
  const propias = cuenta(JS, 'fetch(')
  assert(propias >= 9, 'los nueve lectores REST siguen ahí (siete de H7, el remotelink de H10 y las relaciones de H25)')
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

// --------------------------------------------------------------------- H25
// Las relaciones reales entre las incidencias de un diagrama. jira-rest.js
// garantiza que `linksJql` sólo escribe claves validadas; lo que sólo puede
// garantizar este `case` es que del mensaje no se lee más que la lista de
// claves, que se revalidan AQUÍ antes de nada, y que sin dos no se pide.

test('H25 SEGURIDAD: las relaciones de un diagrama sólo viajan como claves, se revalidan en la pestaña y sin dos válidas no se pide nada', () => {
  const caso = entre('case MSG.ISSUE_LINKS: {', 'case MSG.ANNOTATE:')
  assert(caso.includes("import(url('src/shared/jira-rest.js'))"), 'import perezoso del módulo REST')
  assert(caso.includes('sitioJira(msg)'), 'el sitio se deduce de la pestaña, como en las demás lecturas')
  assert(caso.includes('const pedidas = msg.keys'), 'del mensaje sólo se leen las claves')
  assert(
    caso.includes('const claves = Array.isArray(pedidas) ? pedidas.map((k) => validIssueKey(k)).filter(Boolean) : []'),
    'cada clave pasa validIssueKey en el content script'
  )
  const guarda = caso.indexOf('if (!jira.linksJql(claves)) {')
  const rechazo = caso.indexOf("sendResponse({ ok: false, reason: 'consulta no permitida' })")
  const peticion = caso.indexOf('jira.fetchIssueLinks(')
  assert(guarda >= 0 && rechazo > guarda && peticion > rechazo, 'el rechazo va ANTES de pedir nada')
  assert(
    caso.includes('sendResponse(await jira.fetchIssueLinks((u, o) => fetch(u, o), sitio, claves))'),
    'se piden las claves YA validadas, no las del mensaje'
  )
  // Del mensaje no sale ninguna consulta, ni tope, ni campos: los pone el módulo.
  for (const prohibido of ['msg.jql', 'msg.fields', 'msg.limit', 'msg.issueKey', 'msg.kind']) {
    assert(!caso.includes(prohibido), `${prohibido} no puede llegar a las relaciones`)
  }
  // `msg.keys` se lee UNA vez en todo el fichero, y es aquí.
  eq(cuenta(JS, 'msg.keys'), 1)
  eq(cuenta(caso, 'msg.keys'), 1)
})

test('H25: todo mensaje empieza por «faro:», que es lo único que el content script escucha, y ninguno repite valor', () => {
  // Nadie más pina los valores de MSG: un ISSUE_LINKS sin el prefijo lo tiraría
  // el filtro del listener sin decir nada, y el panel sólo vería un `null`.
  assert(JS.includes("!msg.type.startsWith('faro:')"), 'el filtro del listener')
  const valores = Object.values(MSG)
  for (const [nombre, valor] of Object.entries(MSG)) assert(/^faro:[a-z-]+$/.test(valor), `${nombre} = ${valor}`)
  eq(new Set(valores).size, valores.length, 'dos mensajes con el mismo valor se confundirían')
  eq(MSG.ISSUE_LINKS, 'faro:issue-links')
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

// --------------------------------------------------------------------- H27
// La extensión se cargó por fin en el Chrome de Marco (2026-09-28, PLAN3 §3.1)
// y el content script no arrancaba: con `use_dynamic_url` cargaban las hojas y
// fallaba todo lo que importa algo. Lo que se vio además, y es lo que se pina
// aquí, es que el fallo no se veía: el arranque entero colgaba del PRIMER
// mensaje, PING incluido, y un arranque roto contestaba `{ok:false}` a todo,
// así que «hay script roto» y «no hay script» eran lo mismo para el service
// worker y el panel. Y un content script huérfano (la extensión recargada sin
// recargar la pestaña) seguía sondeando la URL cada 700 ms para siempre.

/** Las líneas de código de un trozo, sin sangría y sin las vacías que dejan los comentarios. */
const lineas = (trozo) =>
  trozo
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** El cuerpo de `boot()`, hasta las lecturas REST que lo siguen en el fichero. */
const cuerpoDeBoot = () => entre('function boot() {', 'const DIAS_POR_DEFECTO = ')

/** Las cuatro llamadas con las que MSG.SETTINGS llega al ejecutor. */
const AJUSTES_AL_EJECUTOR = [
  'runner.setReducedMotion(!!msg.reduceMotion)',
  'if (msg.highlightStyle) runner.setHighlightStyle(msg.highlightStyle)',
  'if (msg.highlightColor) runner.setHighlightColor(msg.highlightColor)',
  'if (msg.timing) Object.assign(runner.timing, msg.timing)',
]

test('H27: PING y SETTINGS se contestan antes de boot() y no lo arrancan', () => {
  // El service worker manda PING y SETTINGS en CADA pestaña en cuanto se abre el
  // panel (`contentStatus` y `pushSettings`): si arrancaran el content script,
  // cada pestaña cargaría runner.js y el overlay sin que nadie fuera a usarlos
  // (el peso que H11 quitó del aviso), y un arranque roto se tragaría el PING.
  const antes = entre('chrome.runtime.onMessage.addListener(', 'const { runner, getPicker } = await boot()')
  const mensajes = antes.indexOf("const { MSG } = await import(url('src/shared/messages.js'))")
  const ping = antes.indexOf('case MSG.PING:')
  const ajustes = antes.indexOf('case MSG.SETTINGS: {')
  assert(mensajes >= 0 && ping > mensajes && ajustes > ping, 'MSG se importa solo (es una hoja) y PING y SETTINGS van en el primer switch')
  assert(!antes.includes('boot('), 'ni PING ni SETTINGS arrancan nada')
  assert(!antes.includes('getPicker'), 'antes de arrancar no hay selector')
  eq(
    antes.indexOf('runner'),
    antes.indexOf('const { runner } = arrancado') + 'const { '.length,
    'antes de boot() sólo se toca el ejecutor que ya arrancó'
  )
  // Y en el switch de siempre ya no están: un segundo `case` sería código muerto.
  eq(cuenta(JS, 'case MSG.PING:'), 1)
  eq(cuenta(JS, 'case MSG.SETTINGS:'), 1)

  // Las tres respuestas del PING: roto (vivo, con su error), o sano y si arrancó.
  eq(lineas(entre('case MSG.PING:', 'case MSG.SETTINGS: {')), [
    'case MSG.PING:',
    'if (bootError && !arrancado) {',
    'sendResponse({ ok: false, alive: true, booted: false, error: bootErrorText(bootError) })',
    'return',
    '}',
    'sendResponse({ ok: true, url: location.href, title: document.title, booted: !!arrancado })',
    'return',
  ])
})

test('H27: SETTINGS antes de arrancar se guarda y se aplica al arrancar', () => {
  // Sin arrancar, los ajustes se guardan y se contesta igual; lo primero del
  // `case` es esa rama, para que nada toque un ejecutor que no existe.
  const caso = lineas(entre('case MSG.SETTINGS: {', 'const { runner, getPicker } = await boot()'))
  eq(caso.slice(0, 6), ['case MSG.SETTINGS: {', 'if (!arrancado) {', 'pendientes.settings = msg', 'sendResponse({ ok: true })', 'return', '}'])
  const i = caso.indexOf('const { runner } = arrancado')
  assert(i > 0, 'con el ejecutor arrancado, se aplica al momento')
  eq(caso.slice(i + 1, i + 6), [...AJUSTES_AL_EJECUTOR, 'sendResponse({ ok: true })'])
  eq(cuenta(JS, 'pendientes.settings = msg'), 1)
  assert(JS.indexOf('const pendientes = { settings: null }') < JS.indexOf('function boot() {'), 'lo pendiente vive en el IIFE')

  // Y al arrancar se aplica con las MISMAS cuatro llamadas, byte a byte: si una
  // cambia en un sitio y no en el otro, unos ajustes se aplicarían distinto
  // según llegaran antes o después de arrancar.
  const boot = cuerpoDeBoot()
  const listo = boot.indexOf('arrancado = { runner, getPicker }')
  const aplica = boot.indexOf('if (pendientes.settings) {')
  assert(listo >= 0 && aplica > listo, 'se aplica dentro de boot(), con el ejecutor ya hecho')
  eq(lineas(entre('if (pendientes.settings) {', 'return arrancado')), [
    'if (pendientes.settings) {',
    'const msg = pendientes.settings',
    'pendientes.settings = null',
    ...AJUSTES_AL_EJECUTOR,
    '}',
  ])
})

test('H27: dos intentos de arranque como mucho', () => {
  // Chromium guarda en su mapa de módulos el import fallido (whatwg/html#6768):
  // dentro de la misma página reintentar no arregla un módulo denegado y sólo
  // multiplica los errores. Un segundo intento cubre un fallo pasajero; el
  // tercero ya no se hace.
  for (const decl of ['let ready = null', 'let arrancado = null', 'let bootError = null', 'let bootAttempts = 0']) {
    const en = JS.indexOf(decl)
    assert(en >= 0 && en < JS.indexOf('function boot() {'), `«${decl}» en el IIFE, antes de boot()`)
  }
  const boot = cuerpoDeBoot()
  let desde = -1
  for (const paso of [
    'if (arrancado) return ready',
    'if (ready) return ready',
    'if (bootAttempts >= 2) return Promise.reject(bootError)',
    'bootAttempts++',
    'ready = (async () => {',
  ]) {
    const en = boot.indexOf(paso)
    assert(en > desde, `«${paso}» falta o no va en su orden`)
    desde = en
  }
  const tope = boot.slice(boot.indexOf('if (bootAttempts >= 2)'), boot.indexOf('bootAttempts++'))
  assert(!tope.includes('console.'), 'pasado el tope no se vuelve a escribir el error')
  // El intento fallido suelta su promesa (así puede haber otro), guarda el
  // error para el PING y lo escribe UNA vez.
  eq(lineas(boot.slice(boot.indexOf('} catch (err) {'))).slice(0, 6), [
    '} catch (err) {',
    'bootError = err',
    'ready = null',
    "console.error('[faro] no se pudo arrancar el content script', err)",
    'throw err',
    '}',
  ])
  eq(cuenta(JS, "console.error('[faro] no se pudo arrancar"), 1)
  eq(cuenta(JS, 'bootAttempts++'), 1)
})

test('H27: el error del PING no lleva el GUID', () => {
  // Lo que contesta el content script acaba en el registro del panel, y
  // «Copiar registro» lo saca de ahí: la URL de un módulo lleva el id de la
  // extensión (o el GUID de sesión), que no tiene por qué viajar.
  const linea = JS.split('\n').find((l) => l.trim().startsWith('const bootErrorText = '))
  assert(linea, 'bootErrorText vive en el IIFE')
  eq(
    linea.trim(),
    String.raw`const bootErrorText = (err) => String(err?.message || err).replace(/chrome-extension:\/\/[^/]+\//g, '').slice(0, 300)`
  )
  const bootErrorText = new Function('return ' + linea.trim().slice('const bootErrorText = '.length))()
  const id = 'ickohiffpicdfeameogbihbcanbjibmk'
  const guid = '0f8e2b1c-3d4a-4b5c-9e6f-7a8b9c0d1e2f'
  eq(
    bootErrorText(new TypeError(`Failed to fetch dynamically imported module: chrome-extension://${id}/src/content/runner.js`)),
    'Failed to fetch dynamically imported module: src/content/runner.js'
  )
  eq(bootErrorText(`chrome-extension://${guid}/src/content/dom-utils.js y chrome-extension://invalid/src/shared/config.js`), 'src/content/dom-utils.js y src/shared/config.js')
  eq(bootErrorText(new Error('x'.repeat(1000))).length, 300, 'con tope')

  // Sale por ahí TODO error que contesta el content script: el del PING roto y
  // el del `catch` del oyente; el texto crudo no se lee en ningún otro sitio.
  eq(cuenta(JS, 'String(err?.message || err)'), 1)
  assert(JS.includes('error: bootErrorText(bootError)'), 'el PING roto')
  assert(JS.includes('sendResponse({ ok: false, error: bootErrorText(err) })'), 'y cualquier otro fallo')
})

test('H27: el huérfano se apaga solo', () => {
  // Recargar la extensión sin recargar la pestaña deja el content script viejo
  // vivo y sin extensión detrás: su sondeo seguía cada 700 ms, sus marcas
  // pintadas y cada aviso que intentaba mandar reventaba. Se detecta él mismo
  // (`chrome.runtime.id` desaparece) y se apaga ENTERO: el sondeo, el overlay
  // con sus marcas y el selector.
  assert(JS.includes('const contextoVivo = () => !!chrome.runtime?.id'), 'vivo = la extensión sigue teniendo id')
  const boot = cuerpoDeBoot()
  for (const decl of ['let picker = null', 'let parar = null', 'let apagado = false']) {
    assert(boot.indexOf(decl) >= 0 && boot.indexOf(decl) < boot.indexOf('const apagar = () => {'), decl)
  }
  eq(lineas(entre('const apagar = () => {', 'const sigueVivo = () => {')), [
    'const apagar = () => {',
    'if (apagado) return',
    'apagado = true',
    'parar?.()',
    'runner.overlay.destroy()',
    'if (picker) picker.cancel()',
    '}',
  ])
  // El sondeo pregunta en cada vuelta; la primera vez que no, apaga todo (y no
  // sólo el sondeo: las marcas del huérfano seguirían pintadas).
  eq(lineas(entre('const sigueVivo = () => {', 'parar = onUrlChange(')), [
    'const sigueVivo = () => {',
    'if (contextoVivo()) return true',
    'apagar()',
    'return false',
    '}',
  ])
  // Los dos oyentes que mandan algo a la extensión: miran antes y, si mandar
  // revienta, se apagan.
  eq(lineas(entre('parar = onUrlChange(', 'runner.overlay.onNote = (n) => {')), [
    'parar = onUrlChange(',
    '(href) => {',
    'try {',
    'if (!contextoVivo()) {',
    'apagar()',
    'return',
    '}',
    'chrome.runtime.sendMessage({ type: MSG.URL_CHANGED, url: href, pageId: pageIdFromDom() }).catch(() => {})',
    '} catch {',
    'apagar()',
    '}',
    '},',
    '{ sigueVivo }',
    ')',
  ])
  eq(lineas(entre('runner.overlay.onNote = (n) => {', 'const getPicker = async () => {')), [
    'runner.overlay.onNote = (n) => {',
    'try {',
    'if (!contextoVivo()) {',
    'apagar()',
    'return',
    '}',
    'chrome.runtime.sendMessage({ type: MSG.NOTE_CLICKED, n }).catch(() => {})',
    '} catch {',
    'apagar()',
    '}',
    '}',
  ])
  // Un «Señalar» a medias cuando la extensión se va: `apagar` cancela el
  // selector y su resultado ya no tiene a quién ir.
  const pick = entre('case MSG.PICK_START: {', 'case MSG.PICK_CANCEL: {')
  const elegido = pick.indexOf('const pick = await p.start()')
  const guarda = pick.indexOf('if (!contextoVivo()) return')
  assert(elegido >= 0 && guarda > elegido && pick.indexOf('type: MSG.PICK_RESULT') > guarda, 'no se manda el resultado desde un huérfano')
})

test('H27: limpiarRestos corre antes de new NavRunner', () => {
  // Lo que un huérfano dejó en el DOM COMPARTIDO: su host (overlay.js crearía
  // otro con el mismo id) y las clases de «Señalar» en <html>. Los <style> de
  // id fijo no: overlay.js los reutiliza por id y los reescribe.
  eq(lineas(entre('function limpiarRestos() {', 'function boot() {')), [
    'function limpiarRestos() {',
    "for (const h of document.querySelectorAll('#faro-overlay-host')) h.remove()",
    "document.documentElement.classList.remove('faro-picking', 'faro-picking-dark')",
    '}',
  ])
  const boot = cuerpoDeBoot()
  const modulos = boot.indexOf('await Promise.all([')
  const limpia = boot.indexOf('limpiarRestos()')
  const nuevo = boot.indexOf('new NavRunner(')
  assert(modulos >= 0 && limpia > modulos && nuevo > limpia, 'se limpia al arrancar, antes de que exista el overlay propio')
  eq(cuenta(JS, 'limpiarRestos()'), 2, 'se declara y se llama una vez')
})

test('H27: un aviso de carga que no sale deja rastro en la consola', () => {
  // El aviso de cada carga se tragaba su propio fallo: si no cargaba ni la
  // hoja de los mensajes, nadie lo veía (§8.14). El mensaje no cambia (§5).
  const aviso = entre('const announce = () => {', "if (document.readyState === 'complete'")
  assert(aviso.includes(".catch((err) => console.warn('[faro] aviso de carga sin mandar', err))"), 'el fallo del aviso se escribe')
  eq(cuenta(aviso, '.catch(() => {})'), 1, 'el único silencio es el de un sendMessage sin nadie al otro lado')
})

test('H27: onUrlChange se para cuando sigueVivo dice que no, y sin sigueVivo no mira nada', () => {
  const antes = {
    location: globalThis.location,
    history: globalThis.history,
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }
  const oyentes = new Map()
  let quitados = []
  let sondeo = null
  let parados = 0
  globalThis.location = { href: 'https://c.example/a' }
  globalThis.history = {} // sin pushState que envolver
  globalThis.window = {
    addEventListener: (tipo, fn) => oyentes.set(tipo, fn),
    removeEventListener: (tipo, fn) => {
      if (oyentes.get(tipo) === fn) quitados.push(tipo)
    },
  }
  globalThis.setInterval = (fn) => {
    sondeo = fn
    return 42
  }
  globalThis.clearInterval = (id) => {
    if (id === 42) parados++
  }
  try {
    let vivo = true
    let preguntas = 0
    const vistos = []
    const parar = onUrlChange((href, from) => vistos.push([href, from]), {
      sigueVivo: () => {
        preguntas++
        return vivo
      },
    })
    eq(typeof parar, 'function', 'sigue devolviendo con qué pararlo')
    location.href = 'https://c.example/b'
    sondeo()
    eq(vistos, [['https://c.example/b', 'https://c.example/a']], 'vivo, avisa como siempre')
    eq(preguntas, 1, 'y pregunta en cada vuelta')

    vivo = false
    location.href = 'https://c.example/c'
    sondeo()
    eq(vistos.length, 1, 'muerto, no avisa de nada')
    eq(parados, 1, 'el sondeo se para solo')
    eq(quitados.sort(), ['hashchange', 'popstate'], 'y suelta los dos oyentes')
    oyentes.get('popstate')()
    eq(vistos.length, 1, 'un evento que ya estuviera en cola tampoco avisa')

    // Sin `sigueVivo`, como antes de H27: no se para por su cuenta.
    quitados = []
    parados = 0
    const otros = []
    onUrlChange((href) => otros.push(href))
    for (const h of ['d', 'e', 'f']) {
      location.href = 'https://c.example/' + h
      sondeo()
    }
    eq(otros, ['https://c.example/d', 'https://c.example/e', 'https://c.example/f'])
    eq(parados, 0)
    eq(quitados, [])
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete globalThis[k]
      else globalThis[k] = v
    }
  }

  // dom-utils.js lo importan las pruebas en Node y el banco, donde no hay API de
  // extensión: cómo se sabe si se sigue vivo lo dice quien llama.
  const fuente = sinComentarios(readFileSync(join(ROOT, 'src/content/dom-utils.js'), 'utf8'))
  assert(!/\bchrome\b/.test(fuente), 'dom-utils.js no nombra la API de la extensión')
  assert(fuente.includes('export function onUrlChange(callback, opciones = {}) {'), 'el segundo parámetro es opcional')
})
