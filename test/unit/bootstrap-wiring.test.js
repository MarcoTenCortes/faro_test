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
 * Es un script clásico que cuelga de `chrome` y de `location` al cargarse, así
 * que el cableado se comprueba por regex sobre el fuente.
 *
 * Desde H27 (PLAN3 §3.1) también el ARRANQUE: la extensión se cargó por fin en
 * un Chrome de verdad y el content script no arrancaba, contestaba `{ok:false}`
 * a todo —PING incluido— y para el service worker «hay script roto» y «no hay
 * script» eran lo mismo. Tres trozos sí se ejecutan aquí: `onUrlChange` de
 * dom-utils.js, que no toca el DOM al importarse (el sondeo que un huérfano
 * tiene que saber parar); `bootErrorText`, que se saca del fuente por su
 * línea porque de ella depende que el id de la extensión no viaje al panel; y,
 * desde la revisión adversaria de H27, el OYENTE entero: los pines de texto
 * dejaban vivir mutantes del tope de intentos, del error guardado, de la caché
 * del selector y de la guarda de la segunda instancia, así que el fuente se
 * evalúa con `new Function`, con `import(` cambiado por un importador de
 * mentira y `chrome`, `window`, `document`, `location` y `console` falsos
 * pasados como PARÁMETROS (nunca globales: nada que restaurar).
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MSG } from '../../src/shared/messages.js'
import { NAV_TIMING } from '../../src/shared/config.js'
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

test('H27: PING y SETTINGS se contestan antes de boot() y sólo el PING con arrancar lo arranca', () => {
  // El service worker manda PING y SETTINGS en CADA pestaña en cuanto se abre el
  // panel (`contentStatus` y `pushSettings`): si arrancaran el content script,
  // cada pestaña cargaría runner.js y el overlay sin que nadie fuera a usarlos
  // (el peso que H11 quitó del aviso), y un arranque roto se tragaría el PING.
  const antes = entre('chrome.runtime.onMessage.addListener(', 'const { runner, getPicker } = await boot()')
  const mensajes = antes.indexOf("const { MSG } = await import(url('src/shared/messages.js'))")
  const ping = antes.indexOf('case MSG.PING:')
  const ajustes = antes.indexOf('case MSG.SETTINGS: {')
  assert(mensajes >= 0 && ping > mensajes && ajustes > ping, 'MSG se importa solo (es una hoja) y PING y SETTINGS van en el primer switch')
  // EL CAMBIO (revisión adversaria de H27): el PING que el service worker
  // manda justo DESPUÉS de inyectar pide `arrancar`. Un PING ligero sólo prueba
  // que hay un oyente, y un script recién puesto cuyo arranque iba a fallar lo
  // pasaba: el panel decía «Listo» y apuntaba «Content script inyectado». Es el
  // único `boot(` antes del de siempre, y va dentro del PING; SETTINGS sigue sin
  // arrancar nada.
  eq(cuenta(antes, 'boot('), 1, 'sólo el PING con arrancar arranca')
  const casoPing = entre('case MSG.PING:', 'case MSG.SETTINGS: {')
  assert(casoPing.includes('if (msg.arrancar && !arrancado && !bootError) await boot().catch(() => null)'), 'y es el PING con arrancar')
  assert(!entre('case MSG.SETTINGS: {', 'const { runner, getPicker } = await boot()').includes('boot('), 'SETTINGS no arranca nada')
  assert(!antes.includes('getPicker'), 'antes de arrancar no hay selector')
  eq(
    antes.indexOf('runner'),
    antes.indexOf('const { runner } = arrancado') + 'const { '.length,
    'antes de boot() sólo se toca el ejecutor que ya arrancó'
  )
  // Y en el switch de siempre ya no están: un segundo `case` sería código muerto.
  eq(cuenta(JS, 'case MSG.PING:'), 1)
  eq(cuenta(JS, 'case MSG.SETTINGS:'), 1)

  // El PING: si lo piden, arranca (sin gastar el segundo intento en un script
  // que ya se sabe roto: la guarda `!bootError`), y luego las tres respuestas:
  // roto (vivo, con su error), o sano y si arrancó.
  eq(lineas(casoPing), [
    'case MSG.PING:',
    'if (msg.arrancar && !arrancado && !bootError) await boot().catch(() => null)',
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
  // (`chrome.runtime.id` desaparece) y se apaga ENTERO: el sondeo, el paso en
  // vuelo, el overlay con sus marcas y el selector.
  assert(JS.includes('const contextoVivo = () => !!chrome.runtime?.id'), 'vivo = la extensión sigue teniendo id')
  const boot = cuerpoDeBoot()
  for (const decl of ['let picker = null', 'let parar = null', 'let apagado = false']) {
    assert(boot.indexOf(decl) >= 0 && boot.indexOf(decl) < boot.indexOf('const apagar = () => {'), decl)
  }
  // EL CAMBIO (revisión adversaria de H27, reproducido en Chromium): el paso en
  // vuelo se cancela ANTES de destruir el overlay. `destroy()` no toca la espera
  // del ejecutor: un paso en su pausa acababa en 'auto', pulsaba el enlace y
  // volvía a montar el host que se acababa de quitar.
  eq(lineas(entre('const apagar = () => {', 'const sigueVivo = () => {')), [
    'const apagar = () => {',
    'if (apagado) return',
    'apagado = true',
    'parar?.()',
    "runner.cancel('huerfano')",
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
  // selector y su resultado ya no tiene a quién ir. EL CAMBIO (H28, docs/PLAN3.md
  // §3.2): el `ok` sale con el selector ya ABIERTO —`start()` antes de
  // contestar, y lo elegido se espera después—; hasta H28 salía antes, y un
  // `start()` que lanzaba dejaba al panel en «Señalar» esperando un resultado
  // que no iba a llegar.
  eq(lineas(entre('case MSG.PICK_START: {', 'case MSG.PICK_CANCEL: {')), [
    'case MSG.PICK_START: {',
    'const p = await getPicker()',
    'const promesa = p.start()',
    'sendResponse({ ok: true })',
    'const pick = await promesa',
    'if (!contextoVivo()) return',
    'chrome.runtime',
    '.sendMessage({ type: MSG.PICK_RESULT, pick: pick || null, url: location.href })',
    '.catch(() => {})',
    'return',
    '}',
  ])
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
  const intervalos = []
  globalThis.location = { href: 'https://c.example/a' }
  globalThis.history = {} // sin pushState que envolver
  globalThis.window = {
    addEventListener: (tipo, fn) => oyentes.set(tipo, fn),
    removeEventListener: (tipo, fn) => {
      if (oyentes.get(tipo) === fn) quitados.push(tipo)
    },
  }
  globalThis.setInterval = (fn, ms) => {
    sondeo = fn
    intervalos.push(ms)
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

    // Con la URL QUIETA también. Un huérfano suele estar en una página que no
    // navega, y es ahí donde tiene que darse cuenta: hasta la revisión
    // adversaria de H27 esta prueba cambiaba la URL antes de cada vuelta, y un
    // `check` que no preguntara hasta ver otra URL pasaba en verde con el
    // sondeo de cada 700 ms vivo para siempre.
    quitados = []
    parados = 0
    let quieto = true
    let preguntasQuieto = 0
    onUrlChange(() => vistos.push('quieta'), {
      sigueVivo: () => {
        preguntasQuieto++
        return quieto
      },
    })
    sondeo()
    eq([preguntasQuieto, parados], [1, 0], 'vivo y sin moverse: pregunta y sigue')
    quieto = false
    sondeo()
    eq([preguntasQuieto, parados], [2, 1], 'muerto y sin moverse: el sondeo se para igual')
    eq(quitados.sort(), ['hashchange', 'popstate'])
    eq(vistos.length, 1, 'y no avisa de nada')

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

    // Cada 700 ms, en las tres. En un content script el sondeo es la vía
    // PRINCIPAL (el envoltorio de `pushState` vive en el mundo aislado y la
    // página nunca lo llama) y es también lo que detecta al huérfano: el número
    // lo citan los docs y hasta la revisión de H27 el `setInterval` falso lo
    // tiraba sin mirarlo.
    eq(intervalos, [700, 700, 700], 'el sondeo va cada 700 ms')
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

// ------------------------------------------------ H27, revisión adversaria
// Hasta aquí, del arranque sólo se pinaba el TEXTO. La revisión adversaria de
// H27 escribió mutantes que lo respetaban y rompían lo que promete: el tope de
// intentos vuelto a cero en el `catch` (seis arranques y seis errores con seis
// mensajes), el error del arranque borrado (el PING volvía a decir `ok:true` con
// el script roto, que es el «Listo» falso de H27), el selector sin caché (un
// PICK_CANCEL cancelaba otro selector y el primero se quedaba comiéndose los
// clics), la limpieza que no corría y la guarda de la segunda instancia borrada.
// Aquí el oyente se EJECUTA: bootstrap.js entero, evaluado con `new Function` y
// todo lo de fuera pasado como parámetro.

const FUENTE = readFileSync(join(ROOT, 'src/content/bootstrap.js'), 'utf8')
const ID = 'ickohiffpicdfeameogbihbcanbjibmk'
const PAGINA = { href: 'https://c.example/a', origin: 'https://c.example', pathname: '/a' }
const RUNNER = 'src/content/runner.js'
/** Lo que contesta un arranque sin runner.js: la ruta, sin el id de la extensión. */
const ROTO = 'Failed to fetch dynamically imported module: src/content/runner.js'

/**
 * Carga bootstrap.js como lo haría Chrome en una pestaña. `modulos` es lo que el
 * importador de mentira sirve por ruta (`src/…`); una ruta que no esté se
 * deniega como la denegaba Chrome, con la URL entera de la extensión en el
 * mensaje. `restos` es lo que `querySelectorAll('#faro-overlay-host')` encuentra
 * (lo que dejó un huérfano) y `registro` apunta, en orden, lo que se toca.
 */
function cargar({ window = {}, modulos = {}, restos = [], registro = [] } = {}) {
  const oyentes = []
  const enviados = []
  const importados = []
  const errores = []
  const chrome = {
    runtime: {
      id: ID,
      getURL: (p) => `chrome-extension://${ID}/${p}`,
      onMessage: { addListener: (fn) => oyentes.push(fn) },
      sendMessage: (m) => {
        enviados.push(m)
        return Promise.resolve()
      },
    },
  }
  const document = {
    readyState: 'loading', // el aviso de carga no se prueba aquí: sin él, nada que esperar
    title: 'Página',
    addEventListener: () => {},
    querySelectorAll: (sel) => (sel === '#faro-overlay-host' ? restos : []),
    documentElement: { classList: { remove: (...clases) => registro.push(['quita clases', ...clases]) } },
  }
  const importar = (u) => {
    const ruta = String(u).replace(`chrome-extension://${ID}/`, '')
    importados.push(ruta)
    if (!(ruta in modulos)) return Promise.reject(new TypeError('Failed to fetch dynamically imported module: ' + u))
    return Promise.resolve(modulos[ruta])
  }
  const consola = { error: (...a) => errores.push(String(a[0])), warn: () => {} }
  const cuerpo = FUENTE.replace(/\bimport\(/g, '__imp(')
  new Function('chrome', 'window', 'document', 'location', '__imp', 'console', cuerpo)(
    chrome,
    window,
    document,
    { ...PAGINA },
    importar,
    consola
  )
  /** Manda un mensaje al oyente y espera su respuesta, como `chrome.tabs.sendMessage`. */
  const manda = (msg) =>
    new Promise((resolve) => {
      if (oyentes[0](msg, {}, resolve) !== true) resolve(undefined)
    })
  return {
    oyentes,
    enviados,
    chrome,
    manda,
    veces: (ruta) => importados.filter((r) => r === ruta).length,
    errores: (inicio) => errores.filter((e) => e.startsWith(inicio)).length,
  }
}

/**
 * Los módulos de un arranque sano, de mentira: apuntan en `registro` lo que les
 * piden, y en `estado` qué ejecutor, qué selectores y qué sondeo se crearon.
 */
function modulosSanos(registro) {
  const estado = { runners: [], pickers: [], sondeo: null }
  class NavRunner {
    constructor({ timing }) {
      this.timing = timing
      this.overlay = { destroy: () => registro.push('overlay.destroy'), onNote: null }
      registro.push('new NavRunner')
      estado.runners.push(this)
    }
    setReducedMotion(v) {
      registro.push(['setReducedMotion', v])
    }
    setHighlightStyle(v) {
      registro.push(['setHighlightStyle', v])
    }
    setHighlightColor(v) {
      registro.push(['setHighlightColor', v])
    }
    cancel(motivo) {
      registro.push(['runner.cancel', motivo])
    }
    clearNotes() {
      registro.push('clearNotes')
    }
  }
  // Como el de verdad: `start()` promete lo elegido y `cancel()` lo resuelve a null.
  class Picker {
    constructor() {
      this.active = false
      this._resolve = null
      estado.pickers.push(this)
    }
    start() {
      this.active = true
      return new Promise((resolve) => {
        this._resolve = resolve
      })
    }
    cancel() {
      registro.push('picker.cancel')
      if (!this.active) return
      this.active = false
      const resolve = this._resolve
      this._resolve = null
      resolve(null)
    }
  }
  return {
    estado,
    modulos: {
      'src/shared/messages.js': { MSG },
      [RUNNER]: { NavRunner },
      'src/content/dom-utils.js': {
        onUrlChange: (cb, opciones) => {
          estado.sondeo = { cb, opciones }
          return () => registro.push('parar')
        },
      },
      'src/content/page-id.js': { pageIdFromDom: () => '' },
      'src/shared/config.js': { NAV_TIMING },
      'src/content/picker.js': { Picker },
    },
  }
}

/** Los mismos, con runner.js denegado: lo que se vio en el Chrome de Marco. */
function modulosSinRunner() {
  const { modulos } = modulosSanos([])
  delete modulos[RUNNER]
  return modulos
}

const unaVuelta = () => new Promise((resolve) => setTimeout(resolve, 0))

test('H27: el oyente de bootstrap.js ejecutado: PING dice la verdad, dos intentos como mucho, los ajustes esperan y el selector es uno', async () => {
  const NO_ARRANCA = '[faro] no se pudo arrancar'
  const SANO = { ok: true, url: PAGINA.href, title: 'Página', booted: false }
  const ROTO_VIVO = { ok: false, alive: true, booted: false, error: ROTO }

  // 1. runner.js denegado. Hasta el primer mensaje real nadie sabe que el
  // arranque fallará; desde el tercero, ya no se intenta.
  {
    const c = cargar({ modulos: modulosSinRunner() })
    eq(c.oyentes.length, 1)
    eq(await c.manda({ type: MSG.PING }), SANO, 'sin arrancar, el PING ligero no puede saber que fallará')
    eq(await c.manda({ type: MSG.SETTINGS, reduceMotion: true, highlightColor: 'ambar' }), { ok: true })
    eq(c.veces(RUNNER), 0, 'ni PING ni SETTINGS arrancan')
    for (const type of [MSG.STEP, MSG.ANNOTATE, MSG.PICK_START, MSG.CLEAR_NOTES, MSG.TREE_SNAPSHOT, MSG.PAGE_DIGEST]) {
      eq(await c.manda({ type }), { ok: false, error: ROTO }, `${type} dice qué módulo falló, sin el id`)
    }
    eq(c.veces(RUNNER), 2, 'seis mensajes, dos intentos')
    eq(c.errores(NO_ARRANCA), 2, 'un error por intento, no por mensaje')
    eq(c.errores('[faro] fallo en el content script'), 6, 'y cada mensaje sin atender se dice')
    eq(await c.manda({ type: MSG.PING }), ROTO_VIVO, 'vivo y roto, con el motivo: reinyectar no lo arreglaría')
    eq(await c.manda({ type: MSG.PING, arrancar: true }), ROTO_VIVO, 'pedirle que arranque no cambia nada')
    eq([c.veces(RUNNER), c.errores(NO_ARRANCA)], [2, 2], 'ni otro intento ni otro error')
  }

  // 2. El PING con `arrancar`, el que manda el service worker tras inyectar:
  // con él, un script recién puesto que no arranca lo dice a la primera, y el
  // panel no dice «Listo».
  {
    const c = cargar({ modulos: modulosSinRunner() })
    eq(await c.manda({ type: MSG.PING, arrancar: true }), ROTO_VIVO, 'recién inyectado y roto: lo dice el primer PING')
    eq(await c.manda({ type: MSG.PING, arrancar: true }), ROTO_VIVO)
    eq([c.veces(RUNNER), c.errores(NO_ARRANCA)], [1, 1], 'un script que ya se sabe roto no gasta su segundo intento en un PING')
  }

  // 3. Arranque sano, con los restos de un huérfano en la página.
  const registro = []
  const { modulos, estado } = modulosSanos(registro)
  const c = cargar({ modulos, restos: [{ remove: () => registro.push('quita el host viejo') }], registro })
  eq(await c.manda({ type: MSG.PING }), SANO)
  const ajustes = { type: MSG.SETTINGS, reduceMotion: true, highlightStyle: 'marker', highlightColor: 'ambar', timing: { stepPauseMs: 5 } }
  eq(await c.manda(ajustes), { ok: true })
  eq([c.veces(RUNNER), registro], [0, []], 'los ajustes esperan al arranque sin tocar nada')
  eq(await c.manda({ type: MSG.PING, arrancar: true }), { ...SANO, booted: true }, 'el PING con arrancar arranca')
  eq(
    registro,
    [
      'quita el host viejo',
      ['quita clases', 'faro-picking', 'faro-picking-dark'],
      'new NavRunner',
      ['setReducedMotion', true],
      ['setHighlightStyle', 'marker'],
      ['setHighlightColor', 'ambar'],
    ],
    'limpia lo del huérfano ANTES de crear el ejecutor, y aplica los ajustes pendientes'
  )
  const [runner] = estado.runners
  eq(runner.timing.stepPauseMs, 5, 'los tiempos pendientes también')
  assert(runner.timing !== NAV_TIMING && NAV_TIMING.stepPauseMs !== 5, 'sobre una copia: la constante compartida no cambia')

  registro.length = 0
  eq(await c.manda({ type: MSG.SETTINGS, reduceMotion: false, highlightColor: 'azul' }), { ok: true })
  eq(await c.manda({ type: MSG.CLEAR_NOTES }), { ok: true })
  eq(registro, [['setReducedMotion', false], ['setHighlightColor', 'azul'], 'clearNotes'], 'arrancado, al momento; lo pendiente no se repite')
  eq(c.veces(RUNNER), 1, 'un solo arranque')

  // El selector: PICK_CANCEL cancela el MISMO que abrió PICK_START.
  eq(await c.manda({ type: MSG.PICK_START }), { ok: true })
  eq(await c.manda({ type: MSG.PICK_CANCEL }), { ok: true })
  eq(estado.pickers.length, 1, 'un selector, no uno por mensaje')
  eq(estado.pickers[0].active, false, 'y ninguno se queda eligiendo')
  await unaVuelta()
  const resultados = () => c.enviados.filter((m) => m.type === MSG.PICK_RESULT)
  eq(resultados(), [{ type: MSG.PICK_RESULT, pick: null, url: PAGINA.href }], 'cancelar se contesta al panel')

  // La insignia pulsada llega al panel mientras la extensión sigue ahí.
  runner.overlay.onNote(3)
  eq(c.enviados.filter((m) => m.type === MSG.NOTE_CLICKED), [{ type: MSG.NOTE_CLICKED, n: 3 }])

  // El huérfano: la extensión se va con «Señalar» abierto.
  eq(await c.manda({ type: MSG.PICK_START }), { ok: true })
  eq(estado.pickers.length, 1, 'el mismo selector otra vez')
  const { cb, opciones } = estado.sondeo
  eq(opciones.sigueVivo(), true, 'con la extensión detrás, sigue')
  registro.length = 0
  delete c.chrome.runtime.id
  eq(opciones.sigueVivo(), false)
  eq(
    registro,
    ['parar', ['runner.cancel', 'huerfano'], 'overlay.destroy', 'picker.cancel'],
    'se apaga entero: el sondeo, el paso en vuelo ANTES que el overlay, y el selector abierto'
  )
  await unaVuelta()
  eq(resultados().length, 1, 'lo que elija un huérfano no se manda')
  eq(opciones.sigueVivo(), false)
  cb('https://c.example/b')
  runner.overlay.onNote(4)
  eq(registro.length, 4, 'apagarse es una vez')
  eq(c.enviados.filter((m) => m.type === MSG.URL_CHANGED || m.n === 4), [], 'y un huérfano no avisa de nada')
})

test('H28: PICK_START contesta con el selector ya abierto, y un start() que lanza se contesta con su error', async () => {
  // `Picker.start()` es síncrona hasta su `return new Promise`: monta el
  // overlay, pinta la barra y pone los oyentes. Hasta H28 el `ok` salía ANTES
  // de llamarla, así que si lanzaba (el overlay no se monta en esa página) el
  // `catch` del oyente contestaba tarde —Chrome se queda con la primera
  // respuesta— y el panel se quedaba en «Señalar» esperando un resultado que no
  // iba a llegar (docs/PLAN3.md §3.2). ¿Qué ve el panel? El primer `sendResponse`.
  class PickerRoto {
    start() {
      throw new Error('el overlay no se monta')
    }
    cancel() {}
  }
  const { modulos } = modulosSanos([])
  const c = cargar({ modulos: { ...modulos, 'src/content/picker.js': { Picker: PickerRoto } } })
  eq(await c.manda({ type: MSG.PICK_START }), { ok: false, error: 'el overlay no se monta' }, 'el fallo, no un ok')
  eq(c.errores('[faro] fallo en el content script'), 1, 'y en la consola')
  await unaVuelta()
  eq(c.enviados.filter((m) => m.type === MSG.PICK_RESULT), [], 'sin selector no hay resultado que mandar')
})

test('H27 SEGURIDAD: la guarda de la segunda instancia no se engaña con un elemento de la página', async () => {
  // Un `<div id="__faroBooted">` de la página también se ve como
  // `window.__faroBooted` en el mundo aislado del content script: el getter con
  // nombre de Window devuelve el elemento sin mirar el mundo (Chromium,
  // window_properties.cc). Con una guarda que sólo pidiera «algo verdadero», esa
  // página se quedaba sin Faro, y el consejo del panel —recargar la pestaña y la
  // extensión— no lo arreglaba (revisión adversaria de H27). Un elemento nunca
  // es `true`; una segunda instancia en el mismo mundo sí lo encuentra.
  assert(JS.includes('if (window.__faroBooted === true) return'), 'la guarda compara con true')
  eq(cuenta(JS, 'window.__faroBooted'), 2, 'la guarda y la marca, nada más')

  const ventana = Object.create({ __faroBooted: { tagName: 'DIV', id: '__faroBooted' } })
  const { modulos } = modulosSanos([])
  const primera = cargar({ window: ventana, modulos })
  eq(primera.oyentes.length, 1, 'con el elemento en la página, Faro arranca igual')
  eq(await primera.manda({ type: MSG.PING }), { ok: true, url: PAGINA.href, title: 'Página', booted: false })
  eq(ventana.__faroBooted, true, 'y deja su marca')
  const segunda = cargar({ window: ventana, modulos })
  eq(segunda.oyentes.length, 0, 'una segunda instancia en el mismo mundo se queda en nada')
})
