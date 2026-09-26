/**
 * Comprobación de cableado del panel.
 *
 * Sin compilador, un id mal escrito en `$('btn-guardar')` no falla hasta que
 * alguien pulsa el botón. Esto cruza los identificadores que usa el JS con los
 * que existen en el HTML, en los dos sentidos.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { NOTE_KINDS } from '../../src/panel/notes.js'
// Los números que el panel NO puede copiarse: el presupuesto del estado vacío
// se reparte entre las sugerencias, las pastillas de H8 y las filas de «hoy»
// (H11), y cada uno lo dice su módulo.
import { SUGGESTION_COUNT } from '../../src/panel/suggestions.js'
import { SEARCH_CHIP_COUNT } from '../../src/panel/search-chips.js'
import { TODAY_LIMITS } from '../../src/panel/today.js'
import { ESCAPE_CLOSES } from '../../src/panel/screens.js'
// H18: la regla de «claves sin comprobar» es UNA y vive en setup.js; el panel
// sólo la llama. Aquí se ejecuta con un registro guardado de HOY (la migración).
import { keysUnverified } from '../../src/panel/setup.js'

const ROOT = join(import.meta.dirname, '..', '..')
const HTML = readFileSync(join(ROOT, 'src/panel/panel.html'), 'utf8')
const JS = readFileSync(join(ROOT, 'src/panel/panel.js'), 'utf8')
const CSS = readFileSync(join(ROOT, 'src/panel/panel.css'), 'utf8')

const htmlIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))

/**
 * El fuente sin comentarios, como en runner-wiring.test.js: cuando lo que se
 * cuenta son LLAMADAS, un nombre citado en una explicación no vale. Pasó: el pin
 * de `medir()` contaba 4 y una de las cuatro era la del comentario de encima
 * (revisión adversaria de H3).
 */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * El CSS sin sus comentarios, y es el que miran TODAS las aserciones de estilo
 * de este fichero. Pasó de verdad (revisión adversaria de H5): el pin «la clave
 * no cede» buscaba `flex: none` dentro del bloque `.loc-key` y lo encontraba…
 * en el comentario que explica por qué la clave NO lleva `flex: none`. El pin
 * daba verde sobre una declaración que dice lo contrario.
 */
const CSS_LIMPIO = sinComentarios(CSS)

function jsIds() {
  const ids = new Set()
  for (const m of JS.matchAll(/\$\('([^']+)'\)/g)) ids.add(m[1])
  for (const m of JS.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(m[1])
  return ids
}

test('cableado: todo id que usa panel.js existe en panel.html', () => {
  const faltan = [...jsIds()].filter((id) => !htmlIds.has(id))
  eq(faltan, [], 'ids usados en JS que no están en el HTML')
})

test('cableado: no hay ids duplicados en el HTML', () => {
  const todos = [...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  const vistos = new Set()
  const dup = todos.filter((id) => (vistos.has(id) ? true : (vistos.add(id), false)))
  eq(dup, [], 'ids repetidos')
})

test('cableado: las pantallas del HTML se muestran desde el JS', () => {
  const pantallas = [...HTML.matchAll(/class="screen hidden" id="([^"]+)"/g)].map((m) => m[1])
  assert(pantallas.length >= 5, 'esperaba al menos cinco pantallas, hay ' + pantallas.length)
  for (const id of pantallas) {
    assert(JS.includes(`'${id}'`), `la pantalla ${id} no se abre desde ninguna parte`)
  }
})

test('cableado: los recursos que enlaza el HTML existen', () => {
  const refs = [
    ...[...HTML.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]),
    ...[...HTML.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]),
  ]
  assert(refs.length >= 2, 'esperaba al menos la hoja de estilos y el script')
  for (const ref of refs) {
    assert(existsSync(join(ROOT, 'src/panel', ref)), 'no existe ' + ref)
  }
})

test('SEGURIDAD: el panel no ejecuta scripts en línea (la CSP de MV3 los prohíbe)', () => {
  assert(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(HTML), 'hay un <script> con código dentro')
  assert(!/\bon(click|change|input|load|submit)=/i.test(HTML), 'hay un manejador de eventos en línea')
})

test('SEGURIDAD: el panel nunca usa innerHTML con texto del modelo', () => {
  assert(!/\.innerHTML\s*=/.test(JS), 'panel.js no debe asignar innerHTML')
  const md = readFileSync(join(ROOT, 'src/panel/markdown.js'), 'utf8')
  assert(!/\.innerHTML\s*=/.test(md), 'markdown.js no debe asignar innerHTML')
  assert(!/insertAdjacentHTML/.test(JS), 'panel.js no debe usar insertAdjacentHTML')
})

test('estilo: las clases que pinta el JS están definidas en el CSS', () => {
  // Sólo las estructurales: las que, si faltan, dejan el panel roto.
  const necesarias = [
    'msg', 'user', 'assistant', 'empty', 'notice', 'tools', 'tool',
    'typing', 'nav-card', 'nav-actions', 'suggestion', 'screen', 'busy',
  ]
  const faltan = necesarias.filter((c) => !new RegExp('\\.' + c + '\\b').test(CSS_LIMPIO))
  eq(faltan, [], 'clases usadas en JS sin estilo')
})

test('estilo: el panel define ambos temas con variables', () => {
  assert(/prefers-color-scheme:\s*dark/.test(CSS_LIMPIO), 'falta el tema oscuro')
  const varsClaras = new Set([...CSS_LIMPIO.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]))
  assert(varsClaras.has('gold') && varsClaras.has('ink') && varsClaras.has('ground'), 'faltan tokens base')
  // El fondo del body debe salir de un token, no heredarse del anfitrión.
  assert(/body\s*\{[^}]*background:\s*var\(--ground\)/s.test(CSS_LIMPIO), 'el body debe pintar su propio fondo')
})

test('estilo: lo que el JS enciende o pinta se ve', () => {
  // Dos clases que panel.js ponía desde siempre y que no existían en el CSS
  // (auditoría del 2026-09-13, docs/PLAN.md §2, A8): la tarjeta de «Dar
  // permiso» salía como una tarjeta de navegación cualquiera y el filtro
  // encendido del Registro no se distinguía del apagado.
  assert(/\.perm-card\b/.test(CSS_LIMPIO), 'clase sin estilo: perm-card')
  assert(/button\.ghost\.on\b/.test(CSS_LIMPIO), 'un filtro encendido tiene que verse encendido')
  assert(/\.beacon\.(ok|bad|busy)\b/.test(CSS_LIMPIO), 'el faro tiene los tres estados listos para H5')

  // Y el ajuste «Reducir animaciones», que se guardaba y sólo llegaba al
  // overlay: el panel seguía animándose (A9).
  const aplica = /function applySettingsToUi\(\)\s*\{[\s\S]*?\n\}/.exec(JS)
  assert(aplica, 'applySettingsToUi sigue existiendo')
  assert(
    /document\.documentElement\.classList\.toggle\('faro-still', !!state\.settings\.reduceMotion\)/.test(aplica[0]),
    'applySettingsToUi cuelga faro-still del <html> del panel'
  )
  assert(/html\.faro-still\b/.test(CSS_LIMPIO), 'y el CSS la atiende')
})

test('el comando que se enseña arranca opencode con registro', () => {
  // Sin --print-logs, cuando algo falla del lado de opencode no hay nada que
  // mirar: el servidor se queda mudo.
  assert(/--print-logs/.test(JS), 'falta --print-logs en el comando')
  assert(/--log-level/.test(JS), 'falta --log-level')
  assert(/--cors/.test(JS), 'y el --cors sigue haciendo falta')
})

test('lo que cuelga de una respuesta sobrevive a que el chat se repinte', () => {
  // Pasó de verdad: entre pedir el turno extra y colgar la tarjeta pasan varios
  // segundos, y en ese rato `restoreConversation()` puede haber vaciado el chat
  // —lo hace con un `textContent = ''`—. La burbuja queda fuera del documento y
  // la tarjeta se cuelga en el vacío: el análisis marcaba la página y no
  // enseñaba su lista, sin decir nada.
  assert(/function attachToBubble/.test(JS), 'debe existir el salvavidas')
  assert(/bubble\?\.isConnected/.test(JS), 'y comprobar que la burbuja sigue en el documento')
  eq(JS.match(/bubble\.appendChild\(/g), null, 'nada se cuelga de la burbuja sin pasar por attachToBubble')
})

test('no se decide si cambiaste de página comparando URLs como cadenas', () => {
  // Confluence reescribe su propia URL —el slug del título, focusedCommentId—
  // sin que el usuario se mueva. Comparar cadenas hacía que Faro creyera que
  // habías navegado y no marcara nada.
  const cuerpo = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/samePage\(/.test(cuerpo), 'hay que comparar por identidad de página')
  assert(!/state\.tabUrl !== urlAlPedir/.test(cuerpo), 'y no por igualdad de cadenas')
})

test('EL CAMBIO: la página va en bloques en el propio turno del análisis, y las anclas vuelven con la respuesta', () => {
  // Antes hacían falta dos turnos: el análisis, y otro con el texto entero de
  // la página para que el modelo volviera a localizar cada número copiando
  // frases de memoria. Ahora la página se lee ANTES de mandar la pregunta, va
  // troceada y numerada en el prompt, y el bloque JSON de anclas viene en la
  // misma respuesta. La segunda pasada queda sólo como red.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/readPageDigest\(\)/.test(envio), 'la página se lee antes de mandar el turno')
  assert(/splitAnchorsBlock\(turn\.text\)/.test(envio), 'y el bloque de anclas se separa de la prosa')
  assert(/digest,\s*\n/.test(envio) || /digest\b/.test(envio), 'y viaja en el sistema del turno')

  const cuerpo = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/validateNotes\(anchors/.test(cuerpo), 'las anclas de la respuesta se validan contra los bloques enseñados')
  assert(/if \(skill !== 'analisis'\) return/.test(cuerpo), 'el modo es el del turno, no el del desplegable al terminar')
  assert(!/state\.skill !== 'analisis'/.test(cuerpo), 'nunca el del desplegable')
  // Una respuesta de seguimiento no borra las marcas, traiga o no anclas: lo
  // que distingue un análisis nuevo es que numera desde el 1.
  assert(/const analisisNuevo = numeros\[0\] === 1/.test(cuerpo), 'un análisis nuevo numera desde el 1')
  assert(/if \(!analisisNuevo && state\.notes\.length\)/.test(cuerpo), 'y un seguimiento conserva las marcas')
  assert(/if \(signal\?\.aborted\) return/.test(cuerpo), 'y un turno cancelado no marca nada')

  // La señal de cancelar es la de ESTE turno, no la que haya en el estado
  // cuando la cola del turno llegue a usarla.
  assert(/const abort = new AbortController\(\)/.test(envio), 'el controlador se guarda aparte')
  assert(/signal: abort\.signal/.test(envio), 'y es el que viaja al turno y a las marcas')
  assert(!/state\.turnAbort\?\.signal/.test(envio), 'nunca el del estado')
  assert(/if \(abort\.signal\.aborted\)/.test(envio), 'parar mientras se lee la página no manda nada')

  // Las marcas se olvidan por identidad de página y ANTES de cambiar de
  // pestaña, para que la orden de limpiar vaya a la que las tenía.
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('let site = parseAtlassianUrl'))
  assert(/samePage\(tab\.url/.test(refresco), 'refreshTab compara por identidad de página')
  assert(refresco.indexOf('forgetNotes()') < refresco.indexOf('state.tabId = tab.id'), 'y olvida antes de cambiar de pestaña')

  // «Volver a marcar» comprueba la página y no se fía de los bloques de ahora.
  const remarcar = JS.slice(JS.indexOf('async function remarkFromAnchors'), JS.indexOf('async function focusNote'))
  assert(/samePage\(digest\.url, url\)/.test(remarcar), 'comprueba que es la misma página')
  assert(/strict: true/.test(remarcar), 'y exige que la cita esté dentro del bloque')
  assert(!/MSG\.PAGE_TEXT/.test(cuerpo), 'ya no se vuelve a leer la página después')
  assert(!/createSession\(/.test(cuerpo), 'ni se abre una sesión aparte salvo como red')
  assert(/secondPassNotes\(/.test(cuerpo), 'la red sigue existiendo')
  assert(!/MSG\.PAGE_TEXT|readablePageText/.test(JS), 'el texto plano de la página ya no se usa')
})

test('lo que se pinta de un turno nunca incluye el bloque de anclas', () => {
  const pintar = JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('async function readPageDigest('))
  assert(/splitAnchorsBlock\(tracker\.text,\s*\{\s*final\s*\}\)/.test(pintar), 'se separa también mientras llega a trozos')
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(/splitAnchorsBlock\(turno\.textos\.join/.test(restaurar), 'y al restaurar una conversación, por turnos enteros')
  assert(/staleNotesCard\(/.test(restaurar), 'que ofrece volver a marcar el último análisis, sin hacerlo solo')
  assert(!/MSG\.ANNOTATE/.test(restaurar), 'restaurar nunca marca la página por su cuenta')

  // Los ayudantes de la tarjeta viven DESPUÉS de notesCard: el trozo que
  // vigilan las pruebas de arriba va de offerNotes a notesCard.
  const tarjeta = JS.indexOf('function notesCard')
  for (const fn of ['async function secondPassNotes', 'function staleNotesCard', 'async function remarkFromAnchors']) {
    assert(JS.indexOf(fn) > tarjeta, fn + ' debe ir después de notesCard')
  }
})

test('el análisis no se cae en silencio cuando no puede marcar', () => {
  // Pasó de verdad: el modelo devolvía ocho observaciones numeradas, no se
  // subrayaba ninguna, y el único rastro era una línea en el registro. En un
  // Confluence propio basta con que falte el permiso del dominio.
  const cuerpo = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/showPermissionNotice\(\)/.test(cuerpo), 'si falta el permiso, hay que pedirlo, no sólo apuntarlo')

  // Cada «Sin marcas» del registro —que significa «no ha pasado nada»— tiene
  // que llevar al lado algo que el usuario vea sin abrir el registro.
  const mudos = cuerpo.split("'Sin marcas'").length - 1
  const visibles = cuerpo.split('noticeNode(').length - 1 + (cuerpo.split('showPermissionNotice()').length - 1)
  assert(mudos > 0, 'se esperaban motivos registrados')
  assert(visibles >= mudos, `${mudos} motivos registrados y sólo ${visibles} visibles`)
})

test('EL CAMBIO: las páginas base del análisis viajan con el turno, se ven y se comprueban', () => {
  // Las páginas base y la página abierta se capturan al MANDAR: `state.site`
  // cambia con la pestaña, y la comprobación del alcance al terminar tiene
  // que hablar de la página que se analizó, no de la que haya abierta entonces.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/const sources = skill === 'analisis'/.test(envio), 'las páginas base se capturan con el modo del turno')
  assert(/const pageIdAlPedir = /.test(envio), 'y la página abierta también')
  assert(envio.indexOf('const pageIdAlPedir') < envio.indexOf('runTurn('), 'antes de mandar nada')
  assert(/sources,\s*\n\s*\}\),/.test(envio), 'viajan en el sistema del turno')
  assert(/sourcesNote\(sources, \{ product: productoAlPedir \}\)/.test(envio), 'y se dicen bajo la pregunta, con el producto del turno')
  assert(/warnAboutSources\(turn\.parts, bubble, \{\s*sources,\s*pageId: pageIdAlPedir/.test(envio), 'la comprobación usa lo capturado')

  // La contraparte visible: sin MCP no se leyeron, y en exclusivo lo que se
  // consultó de más. Nunca con `state.site` de después del turno.
  const aviso = JS.slice(JS.indexOf('function warnAboutSources'), JS.indexOf('// ------------------------------------------------------------- navegación'))
  assert(/consultedOutside\(parts/.test(aviso), 'mira las herramientas del turno')
  assert(/allowedTitles: \[\.\.\.titlesFromTab\(title\)/.test(aviso), 'y admite lecturas por título, con las variantes del título de la pestaña')
  assert(/pageUrl,/.test(aviso), 'y por la URL de la página abierta (Data Center sin id)')
  assert((aviso.match(/noticeNode\(/g) || []).length >= 2, 'los dos avisos se ven')
  assert(/'Fuera del alcance'/.test(aviso) && /'Páginas base sin leer'/.test(aviso), 'y quedan en el registro')
  assert(!/state\.(site|mcpConnected|tabTitle|tabUrl)/.test(aviso), 'nunca el estado de después del turno')
  // Desde H14 lo que se captura es la PROMESA de la comprobación del MCP (P5:
  // ya no bloquea el arranque) y se le pregunta al terminar el turno; el detalle
  // lo pina la prueba de H14.
  assert(/mcpConnected: await mcpCheckAlPedir/.test(envio), 'si había MCP se pregunta al terminar, con lo capturado al mandar')

  // Se cargan con el sitio, antes de cualquier pantalla, y se vacían al
  // cambiar de host —con el índice y el contexto, que también son del sitio—:
  // el chip no puede enseñar las del sitio anterior, ni la pantalla sugerir
  // páginas de otro.
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  const vacia = refresco.indexOf('state.sources = emptySources()')
  assert(vacia >= 0, 'refreshTab vacía las páginas base al cambiar de host')
  assert(vacia < refresco.indexOf('state.site = site'), 'al cambiar de host se vacían antes de cambiar de sitio')
  const cambio = refresco.slice(refresco.indexOf('if (changedHost) {'), refresco.indexOf('state.site = site'))
  assert(/state\.index = null/.test(cambio) && /state\.contextMd = ''/.test(cambio), 'y el índice y el contexto del sitio anterior se van con él')
  assert(/closeSourcesScreen\(\)/.test(cambio), 'y la pantalla de páginas base, si estaba abierta, se cierra')
  // Saltar las claves ya no deja el panel con el índice del sitio anterior.
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  const saltar = eventos.slice(eventos.indexOf("$('btn-setup-skip')"), eventos.indexOf("$('link-token')"))
  assert(/await bootForSite\(\)/.test(saltar), 'saltar las claves vuelve a arrancar el sitio')
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function ensureContentAccess'))
  assert(/state\.sources = normalizeSources\(saved\?\.analysisSources/.test(arranque), 'se cargan de lo guardado por sitio')
  assert(arranque.indexOf('normalizeSources(saved?.analysisSources') < arranque.indexOf('showSetupScreen()'), 'antes de la pantalla de claves')
  assert(/state\.mcpConnected = /.test(arranque), 'y se sabe si hay quien pueda leerlas')

  // La búsqueda: una URL o un id no se mandan al sitio como texto de búsqueda.
  const entrada = JS.slice(JS.indexOf('function onSourcesInput'), JS.indexOf('function refReasonText'))
  assert(/pageRefFromUrl\(/.test(entrada), 'primero se mira si es una referencia')
  assert(!/MSG\.PAGE_SEARCH/.test(entrada), 'y la búsqueda remota va aparte, tras la pausa')
  const remota = JS.slice(JS.indexOf('async function searchSourcesRemote'), JS.indexOf('function searchFailText'))
  assert(/MSG\.PAGE_SEARCH/.test(remota))
  assert(/token !== state\.sourcesSearch\.token/.test(remota), 'una respuesta tardía se tira')
  assert(/mergeSuggestions\(local, paginas, \{[^}]*host: state\.site\.host/.test(remota), 'lo de la API se limpia contra el host')
  // Elegir una sugerencia mata la búsqueda que quedara en marcha: si no, la
  // lista volvía a aparecer bajo el campo vacío con la página recién añadida.
  const alta = JS.slice(JS.indexOf('async function addSource('), JS.indexOf('async function removeSource'))
  assert(/state\.sourcesSearch\.token\+\+/.test(alta) && /clearTimeout\(state\.sourcesSearch\.timer\)/.test(alta), 'añadir cancela la búsqueda pendiente')
  // Sin Confluence al que preguntar (un Jira Data Center sin enlace) se añade por id.
  const porId = JS.slice(JS.indexOf('async function addSourceById'), JS.indexOf('async function fetchPageChain'))
  assert(/const target = sourcesTarget\(\)\s*\n\s*if \(!target\) \{/.test(porId), 'sin a quién preguntar se añade por id sin comprobar')

  // Restaurar la conversación reconstruye la nota desde el sistema guardado.
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(/sourcesFromSystem\(m\.info\.system\)/.test(restaurar))
  assert(/sourcesNote\(baseDelTurno, \{ product: productoDelTurno \}\)/.test(restaurar), 'con el mismo texto que al mandar')

  // Lo que dibuja: botón junto a la Skill, chip y pantalla.
  for (const id of ['btn-sources', 'sources-count', 'sources-chip', 'screen-sources', 'sources-query', 'sources-suggest', 'sources-list', 'sources-mode-exclusive', 'sources-mode-open', 'btn-sources-permission']) {
    assert(htmlIds.has(id), 'falta #' + id)
  }
  assert(HTML.indexOf('id="skill"') < HTML.indexOf('id="btn-sources"'), 'el botón va junto al selector de Skill')
  for (const c of ['suggest', 'suggest-row', 'source-list', 'source-row', 'badge', 'sources-chip']) {
    assert(new RegExp('\\.' + c + '\\b').test(CSS_LIMPIO), 'clase sin estilo: ' + c)
  }
  assert(/showScreen\('screen-sources'\)/.test(JS))
})

test('EL CAMBIO: claves por producto, host enlazado y contexto de Confluence desde Jira', () => {
  // Un bloque por producto en la pantalla de claves: dirección, correo y
  // token de Jira, y los de Confluence. Los campos únicos de antes ya no están.
  for (const p of ['jira', 'confluence']) {
    for (const id of [`setup-${p}`, `setup-${p}-block`, `setup-${p}-fields`, `setup-${p}-url`, `setup-${p}-email`, `setup-${p}-email-field`, `setup-${p}-token`]) {
      assert(htmlIds.has(id), 'falta #' + id)
    }
  }
  assert(!htmlIds.has('setup-token') && !htmlIds.has('setup-email'), 'el token único ya no existe')
  assert(/\.product-keys\b/.test(CSS_LIMPIO), 'clase sin estilo: product-keys')

  const claves = JS.slice(JS.indexOf('async function saveKeys'), JS.indexOf('async function showManualStep'))
  assert(/setup-\$\{product\}-token/.test(claves), 'cada producto lee su token')
  assert(!/'setup-token'|'setup-email'/.test(claves), 'y no hay un token para los dos')
  // Desde H18 con el cliente y el host capturados antes del primer await
  // (§8.22), y con lo que el sitio guardaba y lo que opencode tenía antes de
  // escribir, para decidir bajo qué nombre se escribe (chooseWriteTarget).
  assert(/configureMcp\(cliente, \{ host, jira, confluence, dataCenter, saved, config: configAntes \}\)/.test(claves), 'las claves viajan por producto')
  assert(/hostOf\(env\.JIRA_URL\)/.test(claves) && /hostOf\(env\.CONFLUENCE_URL\)/.test(claves), 'los hosts salen de la configuración construida, no del campo')

  // Se comprueban los dos tokens, y el otro host queda enlazado.
  const fin = JS.slice(JS.indexOf('async function finishSetup'), JS.indexOf('function paintSnippet'))
  assert(/for \(const product of PRODUCTS\.filter/.test(fin), 'una comprobación por producto habilitado')
  // Con el cliente capturado al empezar y su señal, desde la revisión adversaria
  // de H16 (§8.22): un cambio de sitio a mitad reconstruye `state.client`.
  assert(/verifyCredentials\(cliente, \{[^}]*signal: [^}]*product,/.test(fin), 'cada comprobación va con el cliente capturado y la señal de cancelar')
  assert(/siteRecords\(\{/.test(fin) && /for \(const \{ host, patch \} of registros\) await saveSite\(host, patch\)/.test(fin), 'los registros de cada host salen de siteRecords')
  assert(/'Sitio enlazado'/.test(fin), 'y queda en el registro')

  // Al arrancar, el MCP se busca por el nombre guardado (el de la pareja) y
  // desde Jira se carga el contexto del Confluence enlazado.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function ensureContentAccess'))
  // El nombre guardado cuenta por detrás de lo que opencode tiene de verdad
  // (`chosenMcpName`: opencode → lo apuntado → el nombre por host). Desde H14
  // esto vive en `checkMcp`, que está dentro de este trozo, y habla del host
  // CAPTURADO antes de preguntar: entre la pregunta y la respuesta hay hasta
  // catorce segundos y la pestaña puede haberse ido (§8.22).
  assert(/mcpStatusFor\(mcp, host, chosenMcpName\(config, saved, host, \{ status: mcp \}\)\)/.test(arranque), 'el nombre guardado cuenta')
  // Y se lee ANTES. Desde H6 sale del paquete del sitio (`bundle.site`), no de
  // un `getSite` propio; el pin exige que la línea exista, porque escrito como
  // `indexOf(...) < indexOf(...)` un nombre que ya no está da -1 y pasa siempre.
  const leeSitio = arranque.indexOf('let saved = bundle.site')
  assert(leeSitio > 0, 'el sitio guardado sale del paquete de una lectura')
  assert(leeSitio < arranque.indexOf('mcpStatusFor(mcp'), 'y se lee antes')
  assert(/state\.linkedContext = await loadLinkedContext\(saved\)/.test(arranque))
  const enlazado = JS.slice(JS.indexOf('async function loadLinkedContext'), JS.indexOf('async function ensureContentAccess'))
  assert(/product !== 'jira'/.test(enlazado) && /saved\?\.confluenceHost/.test(enlazado), 'sólo desde Jira y sólo si hay pareja')
  assert(/'Contexto de Confluence enlazado'/.test(enlazado))

  // Viaja en el sistema del turno y se vacía al cambiar de host.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/linkedContext: state\.linkedContext,/.test(envio))
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  const cambio = refresco.slice(refresco.indexOf('if (changedHost) {'), refresco.indexOf('state.site = site'))
  assert(/state\.linkedContext = null/.test(cambio))

  // El estado del registro enseña el MISMO MCP que el arranque: el que
  // opencode tiene para este dominio, luego el guardado, luego el del host.
  const estado = JS.slice(JS.indexOf('async function paintState'), JS.indexOf('async function treeDebug'))
  assert(/mcpStatusFor\(list, state\.site\.host, chosenMcpName\(config, await getSite\(state\.site\.host\), state\.site\.host, \{ status: list \}\)\)/.test(estado))
})

test('EL CAMBIO: un MCP que ya existe en opencode para este dominio se adopta, se apunta y enlaza el otro host', () => {
  // Pasó de verdad: configurado desde Jira con las dos direcciones, al abrir
  // Confluence se pedían claves para un MCP que ya estaba conectado.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function ensureContentAccess'))
  assert(/client\.config\(\)\.catch\(\(\) => null\)/.test(arranque), 'se pregunta a opencode qué configuración tiene')
  assert(/const found = mcpForHost\(config, host, \{ status: mcp \}\)/.test(arranque), 'y se busca el MCP que lleva este dominio, mirando su estado')
  assert(/if \(found && found\.connected && \(/.test(arranque), 'sólo se adopta lo que está conectado: apuntar uno caído pisaba lo que funcionaba')
  assert(/saved\?\.jiraHost !== found\.jiraHost/.test(arranque) && /saved\?\.confluenceHost !== found\.confluenceHost/.test(arranque), 'y también cuando el MCP ya apuntado trae un host nuevo')
  assert(/siteRecords\(\{[^}]*mcpName: found\.name/.test(arranque), 'el que se encuentra se apunta, con el otro host enlazado')
  assert(/chosenMcpName\(config, saved, host, \{ status: mcp \}\)/.test(arranque), 'y se comprueba con ese nombre')
  assert(arranque.indexOf('const found = mcpForHost') < arranque.indexOf('showSetupScreen()'), 'antes de pedir claves')
  assert(/'MCP reconocido'/.test(arranque) && /'MCP sin conectar'/.test(arranque))
  assert(/«\$\{status\.name\}» está registrado pero en/.test(arranque), 'la pantalla de claves dice QUÉ bloque está caído')
  // SEGURIDAD: la configuración trae las claves en claro. Ni al estado ni al registro.
  assert(!/state\.\w+ = config\b/.test(arranque) && !/log\.\w+\([^)]*\bconfig\b/.test(arranque) && !/environment/.test(arranque), 'la configuración no se guarda ni se registra')
  const estado = JS.slice(JS.indexOf('async function paintState'), JS.indexOf('async function treeDebug'))
  assert(/chosenMcpName\(config, await getSite\(state\.site\.host\), state\.site\.host, \{ status: list \}\)/.test(estado), 'el registro mira el mismo MCP')
  const cliente = readFileSync(join(ROOT, 'src/opencode/client.js'), 'utf8')
  // Desde H18 `sensitive`: la respuesta trae las claves de todos los MCP en
  // claro, y un error no puede registrarla ni guardarla.
  assert(/config\(\) \{\s*return this\.request\('GET', '\/config', \{ sensitive: true \}\)/.test(cliente), 'el cliente lee /config')
})

test('EL CAMBIO: el análisis en Jira lee la incidencia, permite leerla en el alcance y elige páginas base del Confluence enlazado', () => {
  // Lo abierto en Jira es una incidencia: se captura su clave al mandar, y el
  // alcance exclusivo la deja leer (sus comentarios, su historial). Nunca con
  // el estado de después del turno.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/const issueKeyAlPedir = state\.site\.issueKey \|\| ''/.test(envio), 'la clave se captura al mandar')
  assert(/const productoAlPedir = state\.site\.product/.test(envio), 'y el producto')
  assert(envio.indexOf('const issueKeyAlPedir') < envio.indexOf('runTurn('), 'antes de mandar nada')
  assert(/issueKey: issueKeyAlPedir,\s*\n\s*product: productoAlPedir,/.test(envio), 'viajan a la comprobación del alcance')
  assert(/con el texto de la \$\{productoAlPedir === 'jira' \? 'incidencia' : 'página'\}/.test(envio), 'y la nota bajo la pregunta dice qué era')

  const aviso = JS.slice(JS.indexOf('function warnAboutSources'), JS.indexOf('// ------------------------------------------------------------- navegación'))
  assert(/allowedIssues: issueKey \? \[issueKey\] : \[\]/.test(aviso), 'la incidencia abierta es lista blanca')
  assert(!/state\.(site|mcpConnected|tabTitle|tabUrl|linkedContext)/.test(aviso), 'nunca el estado de después del turno')

  // Las páginas base desde Jira: el índice y el host del Confluence enlazado.
  const enlazado = JS.slice(JS.indexOf('async function loadLinkedContext'), JS.indexOf('async function ensureContentAccess'))
  assert(/const index = bundle\.index/.test(enlazado), 'el índice del Confluence enlazado se carga con su contexto')
  assert(!/saveIndex\(/.test(enlazado), 'y nunca se guarda desde Jira')
  assert(/function sourcesIndex\(\)/.test(JS) && /function linkedHost\(\)/.test(JS))
  const entrada = JS.slice(JS.indexOf('function onSourcesInput'), JS.indexOf('function refReasonText'))
  assert(/pageRefFromUrl\(text, state\.site, \{ linkedHost: linkedHost\(\) \}\)/.test(entrada), 'una URL del Confluence enlazado vale')
  assert(/suggestFromIndex\(indice, q/.test(entrada) && /const indice = sourcesIndex\(\)/.test(entrada), 'las sugerencias salen del índice que toca')
  assert(/if \(!sourcesTarget\(\)\) return/.test(entrada), 'sin nadie a quien preguntar, sólo el índice')
  const porId = JS.slice(JS.indexOf('async function addSourceById'), JS.indexOf('async function fetchPageChain'))
  assert(/sourcesIndex\(\)\?\.pages\?\.\[id\]/.test(porId), 'y el título por id también')

  // Restaurar la conversación dice «incidencia» cuando lo era.
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(/parseAtlassianUrl\(urlDelTurno\)\?\.product/.test(restaurar))
  assert(/sourcesNote\(baseDelTurno, \{ product: productoDelTurno \}\)/.test(restaurar))
})

test('EL CAMBIO: en Jira la tarjeta abre la búsqueda que hizo el modelo, y el indexador sabe qué Confluence hay enlazado', () => {
  // La lista de tickets vive en el buscador de Jira: la tarjeta lleva a la
  // consulta JQL que produjo la lista, leída de la llamada real a jira_search
  // (las partes del turno), y no necesita índice.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/offerNavigation\(answer, bubble, skill, turn\.parts, \{ preloaded: !!preloadDelTurno \}\)/.test(envio), 'las partes del turno llegan a la navegación')
  const nav = JS.slice(JS.indexOf('async function offerNavigation'), JS.indexOf('async function learnAncestry'))
  assert(/jqlDestination\(parts, \{ origin: state\.site\.origin \}\)/.test(nav), 'la URL se construye contra el origen de la pestaña')
  assert(/navCard\(jqlPlan\(busqueda\)\)/.test(nav))
  assert(nav.indexOf('jqlDestination(') < nav.indexOf('indexSize(state.index)'), 'antes de exigir índice: la búsqueda no lo necesita')
  assert(/'Búsqueda de Jira como destino'/.test(nav), 'y queda en el registro')

  // El contexto de un proyecto de Jira se construye sabiendo qué Confluence
  // hay enlazado, para buscar ahí si los tickets están documentados.
  const contexto = JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext'))
  assert(/linkedContext: state\.linkedContext,/.test(contexto))
  assert(htmlIds.has('context-generate-text'), 'la pantalla de contexto dice qué se recorre según el producto')
  const pantalla = JS.slice(JS.indexOf('function showContextScreen'), JS.indexOf('async function showMemoryScreen'))
  assert(/context-generate-text/.test(pantalla) && /tipos de incidencia/.test(pantalla))
})

test('EL CAMBIO: desde un Jira Data Center el panel pregunta al Confluence enlazado, y el análisis sabe qué incidencia es', () => {
  // Las páginas base desde Jira DC: la búsqueda y el título por id van al
  // Confluence enlazado desde el PANEL (su API está en otro origen: el content
  // script de Jira no puede), con permiso sobre ese dominio y las cookies de
  // su sesión; lo que vuelve no se guarda en el índice de este Jira.
  assert(/function sourcesTarget\(\)/.test(JS) && /async function hasHostPermission\(origin\)/.test(JS))
  const remota = JS.slice(JS.indexOf('async function searchSourcesRemote'), JS.indexOf('function searchFailText'))
  assert(/target\.via === 'linked'/.test(remota) && /hasHostPermission\(target\.site\.origin\)/.test(remota), 'sin permiso no se intenta')
  assert(/searchPages\(\(u, o\) => fetch\(u, o\), target\.site, q, \{[^}]*credentials: 'include'/.test(remota), 'la petición la hace el panel, con las cookies de ese origen')
  assert(/MSG\.PAGE_SEARCH/.test(remota), 'y en el sitio de la pestaña sigue yendo por el content script')
  assert(/source: 'linked'/.test(remota), 'lo del Confluence enlazado se marca como suyo')
  const cadena = JS.slice(JS.indexOf('async function fetchPageChain'), JS.indexOf('async function mergePagesIntoIndex'))
  assert(/fetchAncestors\(\(u, o\) => fetch\(u, o\), target\.site, id, \{ credentials: 'include' \}\)/.test(cadena))
  assert(/needsPermission: true/.test(cadena))
  const porId = JS.slice(JS.indexOf('async function addSourceById'), JS.indexOf('async function fetchPageChain'))
  assert(/if \(!enlazado\) await mergePagesIntoIndex\(r\.pages\)/.test(porId), 'el índice del Confluence enlazado nunca se guarda desde Jira')
  assert(/desde\(enlazado \? 'linked' : 'confluence'\)/.test(porId))
  // `desde` sólo cambia el origen cuando la página venía de una SUGERENCIA (H10):
  // sin eso, lo de siempre.
  assert(/const desde = \(from\) => \(suggested \? \{ from: 'suggested', reason \} : \{ from \}\)/.test(porId))
  const alta = JS.slice(JS.indexOf('async function addSource('), JS.indexOf('async function removeSource'))
  assert(/if \(from === 'confluence'\) await mergePagesIntoIndex/.test(alta), 'y tampoco al elegir una sugerencia suya')
  const enlazado = JS.slice(JS.indexOf('async function loadLinkedContext'), JS.indexOf('async function ensureContentAccess'))
  assert(/bundle\.site\?\.wikiPrefix/.test(enlazado) && /wikiPrefix/.test(enlazado), 'el prefijo del wiki enlazado, si se observó')
  // Y todo eso en UNA lectura, como el sitio propio (P4): el contexto, el
  // índice y el prefijo iban en tres lecturas encadenadas del almacén, cada una
  // releyendo su mapa entero (revisión adversaria de H6).
  const enlazadoCodigo = sinComentarios(enlazado)
  assert(/const bundle = await getSiteBundle\(host\)/.test(enlazadoCodigo), 'un solo paquete para el Confluence enlazado')
  eq(enlazadoCodigo.split('await ').length - 1, 1, 'y una sola espera al almacén')
  assert(!/getIndex\(|getSite\(|getContextMd\(/.test(enlazadoCodigo), 'ninguna de las tres lecturas sueltas de antes')
  // El permiso se pide sobre el dominio que toca, desde la pantalla, y sin inyectar en la pestaña de Jira.
  assert(/async function requestSourcesPermission\(\)/.test(JS))
  assert(/requestHostPermission\(\{ origin: target\.site\.origin, host: target\.site\.host, tabId: null \}\)/.test(JS))
  const pantalla = JS.slice(JS.indexOf('async function showSourcesScreen'), JS.indexOf('function setSourcesStatus'))
  assert(/hasHostPermission\(target\.site\.origin\)/.test(pantalla) && /sources-perm-text/.test(pantalla))
  assert(htmlIds.has('sources-perm-text'))

  // El análisis en Jira: los campos de la incidencia llegan con el digest, se
  // reconstruyen con claves blancas y viajan al prompt por el digest.
  const lectura = JS.slice(JS.indexOf('async function readPageDigest'), JS.indexOf('function attachToBubble'))
  assert(/const issue = normalizeIssueFields\(r\.issue\)/.test(lectura))
  assert(/const digest = \{ \.\.\.r, issue \}/.test(lectura))
  const bootstrap = readFileSync(join(ROOT, 'src/content/bootstrap.js'), 'utf8')
  assert(/issue: jiraIssueFields\(\)/.test(bootstrap), 'el content script los manda con el digest')
})

test('EL CAMBIO: un análisis sin «[n]» ya no acaba en «no ha numerado»: se adapta, se lee del JSON, se trocea o se pide numerado', () => {
  // Pasó de verdad (gpt-5.6-luna): ocho observaciones como lista «1.» y el
  // JSON perfecto, y la extensión lo tiraba todo. Ahora, antes de rendirse:
  const cuerpo = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/const adaptada = normalizeNumbering\(answer, \{ expected: expectedCount\(anchors\), shortAnswer: NOTE_LIMITS\.shortAnswer \}\)/.test(cuerpo), 'la numeración «a su manera» se reescribe en local, sin pisar la cuenta del JSON ni adaptar una respuesta corta')
  assert(/adaptada\.prose !== answer/.test(cuerpo) && /repaint\?\.\(answer\)/.test(cuerpo), 'y la burbuja se repinta cuando la prosa cambia (también plegada o desenvuelta)')
  assert(/const sinNada = saysNothingToSay\(original\)/.test(cuerpo), '«Sin observaciones.» se mira en la respuesta original')
  assert(/const seguimientoCitado = state\.notes\.length > 0 && questionCitesPoint\(/.test(cuerpo), 'un seguimiento que cita un punto no se adapta')
  assert(/const \{ numeros, origen \} = observationNumbers\(answer, anchors\)/.test(cuerpo), 'los números del JSON valen si la prosa no los trae')
  assert(cuerpo.indexOf('normalizeNumbering(answer,') < cuerpo.indexOf('const analisisNuevo = numeros[0] === 1'), 'antes de decidir si es un análisis nuevo')
  assert(cuerpo.indexOf("'Sin observaciones'") < cuerpo.indexOf('const analisisNuevo = numeros[0] === 1'), 'y «Sin observaciones.» se dice antes de conservar marcas en silencio')
  assert(/'Sin observaciones'/.test(cuerpo) && /las marcas de antes se quedan/.test(cuerpo), '«Sin observaciones.» es un resultado, no un fallo')
  assert(/looksLikeFollowUp\(/.test(cuerpo), 'una prosa larga sin números con marcas previas no es un seguimiento')
  assert(/NOTE_LIMITS\.shortAnswer/.test(cuerpo) && /status === 'error'/.test(cuerpo), 'una respuesta corta o con una consulta rota no se trocea')
  assert(/\} else if \(!numeros\.length \|\| origen === 'json'\) \{/.test(cuerpo), 'sin números en la prosa —o con un JSON sin bloques que sirvan—, la pasada que trocea')
  assert(/segmentedPassNotes\(answer, digest, signal\)/.test(cuerpo))
  assert(/withRetryNumbered\(/.test(cuerpo), 'y si tampoco, el botón «Pedirlo numerado»')
  assert(!/no ha numerado sus observaciones/.test(cuerpo), 'el aviso de antes ya no existe')
  assert(/filasNumeros/.test(cuerpo), 'la tarjeta lista los números que quedaron en la prosa')
  assert(/prosaOriginal: original/.test(cuerpo), 'y guarda la prosa original para reconocer su burbuja al repintar')

  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/question: text,\s*\n\s*parts: turn\.parts,/.test(envio), 'la pregunta y las partes del turno llegan a las marcas')
  assert(/repaint: \(prose\) => \{/.test(envio) && /renderMarkdown\(prose, \{ onLink: openUrl, onNote: focusNote, allowHref: linkAllowed \}\)/.test(envio))
  assert(/body\.isConnected \? body : liveBubble\(null\)/.test(envio), 'si el chat se repintó a mitad de turno, la prosa va a la burbuja viva')
  assert(/function liveBubble\(bubble\)/.test(JS))

  for (const fn of ['function withRetryNumbered', 'async function segmentedPassNotes']) {
    assert(JS.indexOf(fn) > JS.indexOf('function notesCard'), fn + ' va después de notesCard')
  }
  const reintento = JS.slice(JS.indexOf('function withRetryNumbered'), JS.indexOf('async function segmentedPassNotes'))
  assert(/Pedirlo numerado/.test(reintento) && /numberedReminder\(question \|\| state\.lastQuestion\)/.test(reintento) && /send\(\)/.test(reintento))
  assert(/setSkill\('analisis'\)/.test(reintento), 'el botón fija la Skill que promete')
  const trocea = JS.slice(JS.indexOf('async function segmentedPassNotes'), JS.indexOf('async function secondPassNotes'))
  assert(/collectSegmentedNotes\(state\.client/.test(trocea) && /deleteSession\(session\.id\)/.test(trocea), 'en una sesión desechable, como la segunda pasada')
  assert(/question: stripNumberedReminder\(state\.lastQuestion\)/.test(trocea), 'sin el recordatorio de «Pedirlo numerado» como pregunta')
  const segunda = JS.slice(JS.indexOf('async function secondPassNotes'), JS.indexOf('function staleNotesCard'))
  assert(/question: stripNumberedReminder\(state\.lastQuestion\)/.test(segunda))

  // Al restaurar, la numeración «a su manera» se adapta sólo en los turnos de
  // Análisis, no en un seguimiento que cita un punto, y los números del JSON valen.
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(/const adaptar = !!cruda && \(turno\.analisis \|\| !!anchors\) && !\(questionCitesPoint\(turno\.pregunta\) && !anchors\)/.test(restaurar))
  assert(/normalizeNumbering\(cruda, \{ expected: expectedCount\(anchors\), shortAnswer: NOTE_LIMITS\.shortAnswer \}\)\.prose/.test(restaurar))
  assert(/includes\('MODO ANÁLISIS\.'\)/.test(restaurar), 'un turno fue un Análisis si su sistema llevó la cabecera del modo')
  assert(/observationNumbers\(prose, anchors\)\.numeros\.length/.test(restaurar))
  assert(/prosaOriginal/.test(restaurar), 'la tarjeta viva reconoce su burbuja también por la prosa original')
  assert(!/numberedIn\(prose\)/.test(JS.slice(JS.indexOf('function staleNotesCard'))), 'ni la tarjeta atenuada ni volver a marcar miran sólo la prosa')
})

test('la navegación no se cae en silencio cuando falta el índice', () => {
  // Pasó de verdad: el modelo decía «usa la tarjeta de abajo» y no había
  // tarjeta, porque el índice se habia descartado por cambio de versión.
  assert(/sinMapaCard/.test(JS), 'debe existir la tarjeta de «me falta el mapa»')
  assert(/Sin navegación/.test(JS), 'y el motivo debe quedar en el registro')
  assert(!/console\.debug\('\[faro\] sin navegación/.test(JS), 'ya no basta con un console.debug')
})

// ------------------------------------------------------------------- H2
// Concurrencia y ciclo de vida (docs/PLAN.md §2.2, reproducido en la
// auditoría del 2026-09-13). Cada pin es un trozo literal del código.

test('H2 C1: reconstruir el cliente a mitad de turno cancela el turno en vez de dejarlo colgar 90 s', () => {
  // Cambiar a una pestaña de OTRO host (o cerrar Ajustes) reconstruye el
  // cliente y cierra el stream: el turno en vuelo se quedaba sin eventos, el
  // vigilante lo daba por colgado a los 90 s y abortaba en el servidor una
  // respuesta que quizá ya había terminado. Se cancela aquí y no en
  // refreshTab: quien decide que ha habido cambio de SITIO es `changedHost`,
  // y una pestaña fuera de Atlassian no lo es.
  const cliente = JS.slice(JS.indexOf('function buildClient'), JS.indexOf('async function refreshTab'))
  assert(/state\.turnAbort\?\.abort\(\)/.test(cliente), 'un turno en vuelo se cancela al reconstruir el cliente')
  assert(/'Turno cancelado'/.test(cliente), 'y queda en el registro')
  assert(cliente.indexOf('state.turnAbort?.abort()') < cliente.indexOf('disconnect()'), 'ANTES de cerrar el stream')
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  assert(!/turnAbort/.test(refresco), 'refreshTab no cancela ningún turno por su cuenta: sólo lo hace buildClient, al cambiar de sitio')
})

test('H2 C2: el contexto y el índice se guardan bajo el host que se indexó, no bajo la pestaña de ahora', () => {
  const contexto = JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext'))
  assert(/const host = state\.site\.host/.test(contexto), 'el host se captura al empezar')
  assert(contexto.indexOf('const host') < contexto.indexOf('await buildContext('), 'antes del indexado, que dura minutos')
  assert(!/state\.site\.host/.test(contexto.slice(contexto.indexOf('await buildContext('))), 'SEGURIDAD: tras el indexado nada se guarda bajo el host de la pestaña de ahora')
  assert(/saveContextMd\(host,/.test(contexto) && /saveIndex\(host,/.test(contexto) && /saveSite\(host, \{ onboarded: true \}\)/.test(contexto), 'todas las escrituras, también la del catch, van al host capturado')
  // Si el usuario ya está en otro sitio, se funde con el índice GUARDADO de
  // aquel host y no se toca ni el estado ni el chat de éste.
  assert(/getIndex\(host\)/.test(contexto), 'con el índice guardado de aquel host, no con el de la pestaña')
  assert(/'Contexto construido en segundo plano'/.test(contexto), 'y se dice en el registro')
})

test('H2 C3: dos arranques solapados no pintan la conversación dos veces', () => {
  // Testigo de arranque, como el del turno y el de la búsqueda de páginas
  // base: sólo el último arranque manda, y los demás se apagan tras cada await.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext'))
  assert(/const testigo = \{\}/.test(arranque) && /state\.bootToken = testigo/.test(arranque), 'cada arranque lleva su testigo')
  assert((arranque.match(/state\.bootToken !== testigo/g) || []).length >= 3, 'y se comprueba tras los await')
  assert(/restoreConversation\(testigo\)/.test(arranque), 'restaurar la conversación recibe el testigo')
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  // Desde H6 hay un segundo parámetro («ver toda la conversación»), pero el
  // testigo sigue siendo el PRIMERO y con el mismo valor por defecto.
  assert(/async function restoreConversation\(testigo = state\.bootToken, \{ all = false \} = \{\}\)/.test(restaurar))
  const vacia = restaurar.indexOf("el.chat.textContent = ''")
  assert(vacia > 0, 'restaurar vacía el chat')
  assert(restaurar.indexOf('listMessages(') < vacia, 'pero DESPUÉS de leer la sesión')
  assert(restaurar.indexOf('state.bootToken !== testigo') < vacia, 'y de comprobar que el arranque sigue siendo el suyo')
})

test('H2 C4: «Nueva sesión» a mitad de turno cancela el turno, y el botón no está mientras se responde', () => {
  const nueva = JS.slice(JS.indexOf('async function newSession'))
  assert(/if \(state\.streaming\)/.test(nueva), 'una sesión nueva no se abre encima de un turno en vuelo')
  assert(/state\.turnAbort\?\.abort\(\)/.test(nueva) && /abort\(state\.sessionID\)/.test(nueva), 'se cancela aquí y en el servidor')
  assert(nueva.indexOf('if (state.streaming)') < nueva.indexOf('summarizeSession('), 'antes de resumir la sesión')
  const streaming = JS.slice(JS.indexOf('function setStreaming'), JS.indexOf('function showBusy'))
  assert(/btn-new-session/.test(streaming), 'y el botón se desactiva mientras se responde')
})

test('H2 C5: tras esperar al MCP se usa el sitio con el que se pidieron las claves, no la pestaña de ahora', () => {
  const claves = JS.slice(JS.indexOf('async function saveKeys'), JS.indexOf('async function showManualStep'))
  // Desde H18 el sitio se captura antes del primer await de `saveKeys`, y es el
  // que viaja: entre leer y escribir la pestaña puede ser otra (§8.22).
  assert(/const sitio = state\.site\n/.test(claves) && /site: sitio,/.test(claves), 'el sitio viaja con la configuración pendiente')
  const fin = JS.slice(JS.indexOf('async function finishSetup'), JS.indexOf('function paintSnippet'))
  assert(!/state\.site\.host/.test(fin), 'tras esperar al MCP se usa el sitio con el que se pidieron las claves, no la pestaña de ahora')
  assert(/state\.pendingMcp/.test(fin) && /site\.host/.test(fin))
  assert(/state\.site\?\.host === site\.host/.test(fin), 'y sólo se rearranca si el usuario sigue en ese sitio')
  const manual = JS.slice(JS.indexOf('async function showManualStep'), JS.indexOf('async function finishSetup'))
  assert(!/state\.site\.host/.test(manual), 'la espera tampoco lee la pestaña en vivo')
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  assert(/state\.mcpWait/.test(refresco) && /'Espera del MCP cancelada'/.test(refresco), 'cambiar a otro sitio de Atlassian corta la espera, y se dice')
})

test('H2 C7: el pintado final de un turno busca la burbuja viva si el chat se repintó a mitad', () => {
  // Reindexar, «Omitir» o subir un contexto repintan el chat sin reconstruir
  // el cliente: el turno sobrevive, pero su burbuja queda fuera del documento.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  const antes = envio.slice(0, envio.indexOf('warnAboutSources('))
  assert(/const cuerpo = !mismoSitio \? body : body\.isConnected \? body : liveBubble\(null\) \|\| addAssistantMessage\(''\)/.test(antes), 'el pintado final busca la burbuja viva si el chat se repintó a mitad de turno, y sólo en el mismo sitio')
  assert(/paintTurn\(turn, toolsBox, cuerpo, true\)/.test(antes), 'y pinta ahí')
  assert(/if \(!bubble\.isConnected\) bubble = cuerpo/.test(antes), 'y lo que cuelga de la respuesta va a esa misma burbuja')
  assert(/cuerpo\.appendChild\(errorNode\(/.test(antes) && /cuerpo\.appendChild\(noticeNode\('Turno cancelado\.'\)\)/.test(antes), 'también los errores y la cancelación')
  assert(!/body\.appendChild\(errorNode\(/.test(antes) && !/body\.appendChild\(noticeNode\(/.test(antes), 'nunca en la burbuja de antes del repintado')
  // Y si el panel ya está en OTRO sitio, la respuesta no entra en su chat ni
  // en su índice: queda en la sesión de opencode del sitio que la pidió.
  assert(/const hostAlPedir = state\.site\.host/.test(envio) && envio.indexOf('const hostAlPedir') < envio.indexOf('runTurn('), 'el host se captura al mandar')
  // Contra el sitio del PANEL (el último host de Atlassian visto), no contra
  // la pestaña: mirar el correo a mitad de respuesta no deja el turno sin chat.
  assert(/const mismoSitio = \(state\.site\?\.host \?\? state\.lastHost\) === hostAlPedir && state\.sessionID === sesionAlPedir/.test(antes), 'y se comprueba al terminar, con la sesión (una «Nueva sesión» a mitad también deja el turno sin chat)')
  // Declarada fuera del `try` (el `finally` la pregunta para su línea de tiempos)
  // y asignada al abrir la sesión, siempre antes de mandar.
  assert(
    /sesionAlPedir = state\.sessionID/.test(envio) && envio.indexOf('sesionAlPedir = state.sessionID') < envio.indexOf('runTurn('),
    'la sesión se captura al mandar'
  )
  assert(antes.indexOf('if (!mismoSitio)') < antes.indexOf("state.turns.push({ role: 'assistant'"), 'antes de tocar los turnos de otro sitio')
})

// Accesibilidad y UX (docs/PLAN.md §2.5 A1, A2, A3, A7).

test('H2 A1: abrir una pantalla deja inerte el resto y mueve el foco; cerrarla lo devuelve', () => {
  // Reproducido en la auditoría del 2026-09-13: con Ajustes abierto, Tab
  // recorría siete controles tapados (Intro en una sugerencia mandaba un
  // turno) y «Listo» tiraba el foco al body.
  const app = HTML.indexOf('id="app"')
  assert(app >= 0, 'la cabecera, el chat y el redactor van dentro de #app')
  assert(app < HTML.indexOf('id="chat"') && HTML.indexOf('id="chat"') < HTML.indexOf('id="composer"'), '#app envuelve #chat y #composer')
  assert(HTML.indexOf('id="composer"') < HTML.indexOf('<section class="screen'), 'y las pantallas quedan fuera de #app')
  assert(/<\/footer>\s*<\/div>/.test(HTML), '#app se cierra tras el redactor')
  assert(/#app\s*\{/.test(CSS_LIMPIO), '#app tiene su sitio en el CSS (el cuerpo es una columna flex)')

  const abrir = JS.slice(JS.indexOf('function showScreen'), JS.indexOf('function hideScreens'))
  assert(/\.inert = true/.test(abrir), 'lo de detrás queda inerte')
  assert(/state\.focusBefore = document\.activeElement/.test(abrir), 'se recuerda quién tenía el foco')
  assert(/\.focus\(\)/.test(abrir), 'y el foco entra en la pantalla')
  const cerrar = JS.slice(JS.indexOf('function hideScreens'), JS.indexOf('function connectCommand'))
  assert(/\.inert = false/.test(cerrar), 'al cerrar, lo de detrás vuelve a estar vivo')
  assert(/focusBefore/.test(cerrar) && /el\.input\.focus\(\)/.test(cerrar), 'y el foco vuelve a quien lo tenía, o al cuadro')
})

test('H2 A2: el chat no es una región viva que se reanuncie con cada trozo; hay un anunciador aparte', () => {
  assert(!/id="chat"[^>]*aria-live/.test(HTML), 'SEGURIDAD de lectura: #chat sin aria-live (cada delta reanunciaba la respuesta entera)')
  assert(/id="announcer"[^>]*aria-live="polite"/.test(HTML), 'el anunciador es una región viva aparte')
  assert(/id="announcer"[^>]*class="sr-only"/.test(HTML) && /\.sr-only\s*\{/.test(CSS_LIMPIO), 'sólo para el lector de pantalla')
  const streaming = JS.slice(JS.indexOf('function setStreaming'), JS.indexOf('function showBusy'))
  assert(/aria-busy/.test(streaming), 'mientras llega la respuesta el chat está ocupado')
  const pintar = JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('async function readPageDigest('))
  assert(/aria-busy/.test(pintar), 'y la burbuja también, hasta el pintado final')
  assert(/function announce\(text\)/.test(JS), 'hay un anunciador')
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(envio.indexOf('announce(answerAnnouncement(answer))') > envio.indexOf('splitAnchorsBlock(turn.text)'), 'que se llama al final del turno, con un resumen corto de la respuesta')
  eq((envio.match(/announce\(answerAnnouncement/g) || []).length, 1, 'y UNA sola vez')
  assert(!/announce\(/.test(JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('async function readPageDigest('))), 'nunca por cada trozo')
  // El recorte cierra ANTES de la declaración de `announce`: incluirla hacía
  // pasar la comprobación aunque showNotice dejara de anunciar nada.
  const aviso = JS.slice(JS.indexOf('function showNotice'), JS.indexOf('const ANNOUNCE_MAX'))
  assert(!/function announce/.test(aviso), 'el recorte no llega a la declaración del anunciador')
  assert(/announce\(text\)/.test(aviso), 'y desde los avisos')
  const colgar = JS.slice(JS.indexOf('function attachToBubble'), JS.indexOf('function liveBubble'))
  assert(/announce\(/.test(colgar), 'y desde lo que se cuelga de una respuesta (tarjetas, avisos)')
  // Restaurar la conversación es historia, no novedad: no se anuncia.
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(!/announce\(/.test(restaurar) && /state\.restoring = true/.test(restaurar) && /state\.restoring = false/.test(restaurar))
  const anunciar = JS.slice(JS.indexOf('function announce(text)'), JS.indexOf('function answerAnnouncement'))
  assert(/state\.restoring/.test(anunciar), 'el anunciador calla mientras se restaura')
})

test('H2 A3: Escape cierra las pantallas de consulta y el velo, desde cualquier sitio del panel', () => {
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  assert(/document\.addEventListener\('keydown'/.test(eventos), 'un keydown a nivel de documento')
  const esc = eventos.slice(eventos.indexOf("document.addEventListener('keydown'"))
  assert(/'Escape'/.test(esc) && /btn-busy-cancel/.test(esc) && /ESCAPE_CLOSES\[/.test(esc), 'Escape: primero el velo, luego la pantalla abierta, por el mapa puro')
  assert(esc.indexOf('btn-busy-cancel') < esc.indexOf('ESCAPE_CLOSES['), 'el velo manda sobre la pantalla')
  assert(/import \{ ESCAPE_CLOSES, ESCAPE_DISMISSES \} from '\.\/screens\.js'/.test(JS), 'los mapas viven en screens.js')
  // El campo de páginas base sólo vacía las sugerencias; cerrar es cosa del documento.
  const teclado = JS.slice(JS.indexOf('function onSourcesKeydown'), JS.indexOf('async function chooseSuggestion'))
  assert(!/closeSourcesScreen\(\)/.test(teclado), 'el campo ya no cierra la pantalla por su cuenta')
  assert(/ev\.stopPropagation\(\)/.test(teclado), 'y con sugerencias, Escape sólo las vacía')
})

test('H2 A7: el chat sólo se desplaza al fondo si el usuario estaba pegado a él', () => {
  // Reproducido en la auditoría del 2026-09-13: cada delta hacía
  // scrollTop = scrollHeight aunque el usuario hubiera subido a leer.
  assert(/import \{ stuckToBottom \} from '\.\/chat-scroll\.js'/.test(JS), 'la medida es pura y vive aparte')
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  assert(/el\.chat\.addEventListener\('scroll'/.test(eventos), 'se mide en cada scroll, ANTES de que nada mute el DOM')
  assert(/state\.chatPinned = stuckToBottom\(el\.chat\)/.test(eventos))
  const desplazar = JS.slice(JS.indexOf('function scrollChat'), JS.indexOf('// ------------------------------------------------------------------ enviar'))
  assert(/function scrollChat\(\{ force = false \} = \{\}\)/.test(desplazar) && /if \(!force && !state\.chatPinned\) return/.test(desplazar), 'sin estar pegado, no se mueve nada')
  const pintar = JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('async function readPageDigest('))
  assert(!/scrollChat\(\{ force/.test(pintar), 'pintar un trozo nunca fuerza')
  const colgar = JS.slice(JS.indexOf('function attachToBubble'), JS.indexOf('function liveBubble'))
  assert(!/scrollChat\(\{ force/.test(colgar), 'ni colgar una tarjeta segundos después')
  const pregunta = JS.slice(JS.indexOf('function addUserMessage'), JS.indexOf('function addAssistantMessage'))
  assert(/scrollChat\(\{ force: true \}\)/.test(pregunta), 'la pregunta que acabas de mandar sí se ve')
})

// Seguridad (docs/PLAN.md §2.1 S5), el botón «Parar» del recorrido y el freno de M5.

test('SEGURIDAD H2 S5: openUrl sólo abre orígenes conocidos; lo demás se dice y no se abre', () => {
  // Reproducido en la auditoría del 2026-09-13: un enlace escrito por el
  // modelo —copiado de una página inyectada— se abría en una pestaña nueva.
  assert(/import \{ allowedLinkOrigin \} from '\.\/links\.js'/.test(JS), 'la regla es pura y vive en links.js')
  const abrir = JS.slice(JS.indexOf('function openUrl'), JS.indexOf('// ------------------------------------------------------------- pantallas'))
  assert(/allowedLinkOrigin\(/.test(abrir), 'se comprueba el origen')
  assert(abrir.indexOf('allowedLinkOrigin(') < abrir.indexOf('chrome.tabs.create('), 'ANTES de abrir nada')
  assert(/linkedSite\(state\.linkedContext\)\?\.origin/.test(abrir), 'el Confluence enlazado también vale')
  assert(/state\.site\?\.origin/.test(abrir), 'y el sitio de la pestaña')
  assert(/'Enlace fuera del sitio'/.test(abrir) && /showNotice\(/.test(abrir), 'lo que no se abre se dice, en el chat y en el registro')
  assert(/\breturn\b/.test(abrir.slice(abrir.indexOf('allowedLinkOrigin('), abrir.indexOf('chrome.tabs.create('))), 'y se sale sin abrir')
})

test('SEGURIDAD S5b: lo que openUrl no abriría tampoco se pinta como enlace, y el aviso del clic se ve', () => {
  // Revisión adversaria de H2 (2026-09-14): la regla vivía sólo en openUrl,
  // pero markdown.js ponía href + target=_blank en todo enlace y el clic
  // central o «Abrir en pestaña nueva» la esquivaban. Y el aviso iba por
  // showNotice sin force: tras A7 no se veía si habías subido a leer.
  eq((JS.match(/renderMarkdown\([^)]*allowHref: linkAllowed \}\)/g) || []).length, 4, 'las cuatro llamadas pasan la regla')
  assert(!/renderMarkdown\(\w+, \{ onLink: openUrl, onNote: focusNote \}\)/.test(JS), 'ninguna se queda sin ella')
  assert(/function linkAllowed\(href\)/.test(JS) && /allowedLinkOrigin\(href, linkCtx\(\)\)/.test(JS), 'la misma regla que openUrl, en una función pequeña')
  assert(/function linkCtx\(\)/.test(JS) && /linkedSite\(state\.linkedContext\)\?\.origin/.test(JS), 'con el sitio de la pestaña y el Confluence enlazado')
  const abrir = JS.slice(JS.indexOf('function openUrl'), JS.indexOf('function linkCtx'))
  assert(/force: true/.test(abrir), 'el aviso del enlace bloqueado se fuerza: contesta a un clic')
  const aviso = JS.slice(JS.indexOf('function showNotice'), JS.indexOf('function scrollChat'))
  assert(/function showNotice\(text, bad = false, \{ force = false \} = \{\}\)/.test(aviso) && /scrollChat\(\{ force \}\)/.test(aviso), 'y showNotice sabe forzar, sin cambiar a los demás avisos')
})

test('H2: el recorrido paso a paso se puede parar desde su tarjeta (CANCEL_PLAN por fin tiene emisor)', () => {
  // El service worker atendía MSG.CANCEL_PLAN y nadie lo mandaba: era el único
  // aviso del paso «docs» de npm run check.
  assert(/type: MSG\.CANCEL_PLAN/.test(JS), 'el panel manda CANCEL_PLAN')
  const correr = JS.slice(JS.indexOf('async function runPlan'), JS.indexOf('async function togglePick'))
  assert(/'Parar'/.test(correr) && /ghost small/.test(correr), 'un botón «Parar», discreto, en la tarjeta mientras dura el recorrido')
  assert(/state\.navRun = /.test(correr), 'el recorrido en marcha se recuerda con su tarjeta')
  assert(/const tabId = state\.tabId/.test(correr) && /\{ type: MSG\.CANCEL_PLAN, tabId \}/.test(correr), 'y para la pestaña del recorrido, capturada al lanzarlo: el usuario puede haber cambiado de pestaña')
  const mensajes = JS.slice(JS.indexOf('function onRuntimeMessage'), JS.indexOf('function openUrl'))
  assert(/finishNavRun\(/.test(mensajes) && /'Navegación cancelada'/.test(mensajes), 'al terminar o cancelarse, la tarjeta vuelve en sí y el registro lo dice')
  assert(/function finishNavRun\(/.test(JS))
})

test('SEGURIDAD H2 S6: el índice sólo cosecha URLs de este sitio, y desde Jira también las del Confluence enlazado', () => {
  // harvestIndex blanquea toda URL absoluta de otro host antes de las regex
  // (S6, indexer.js); el panel tiene que decirle que el Confluence enlazado
  // es «propio», porque desde un Jira DC sus páginas y las incidencias citadas
  // dentro de sus URLs son lo que más se consulta. Sin esta línea, S6 dejaba
  // el enlazado fuera del índice.
  const cuerpo = JS.slice(JS.indexOf('async function growIndex'), JS.indexOf('async function growTreeFromPage'))
  assert(/harvestIndex\(parts \|\| \[\], \{[\s\S]*?allowedHosts: linkedHost\(\) \? \[linkedHost\(\)\] : \[\],?[\s\S]*?\}\)/.test(cuerpo), 'growIndex pasa el Confluence enlazado como host permitido')
  assert(!/allowedHosts: \[state\./.test(cuerpo), 'nunca una lista escrita a mano desde el estado: linkedHost() ya decide')
})

test('H2 M5: el freno de respuesta corta se mira sobre la respuesta ORIGINAL, antes de adaptar la numeración', () => {
  // Una viñeta suelta en «No he podido leer la incidencia: - El MCP devolvió
  // 401» se convertía en «[1]» y esquivaba los frenos de respuesta corta y de
  // seguimiento: un turno más contra el modelo y «no he sabido situar…».
  const cuerpo = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/const respuestaCorta = original\.length < NOTE_LIMITS\.shortAnswer/.test(cuerpo), 'se mide sobre la respuesta original')
  assert(cuerpo.indexOf('const respuestaCorta') < cuerpo.indexOf('const adaptada = normalizeNumbering('), 'antes de adaptar nada')
  assert(/if \(herramientaRota \|\| respuestaCorta\)/.test(cuerpo), 'y es lo que frena')
  assert(!/answer\.length < NOTE_LIMITS\.shortAnswer/.test(cuerpo), 'nunca sobre la prosa ya adaptada')
  // Y normalizeNumbering recibe el tope, para no adaptar estilos débiles en
  // una respuesta corta (es notes.js quien decide qué estilo es débil).
  assert(/const adaptada = normalizeNumbering\(answer, \{ expected: expectedCount\(anchors\), shortAnswer: NOTE_LIMITS\.shortAnswer \}\)/.test(cuerpo))
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  assert(/normalizeNumbering\(cruda, \{ expected: expectedCount\(anchors\), shortAnswer: NOTE_LIMITS\.shortAnswer \}\)\.prose/.test(restaurar), 'también al restaurar')
})

// ------------------------------------ revisión adversaria de H2 (2026-09-14)
// Lo que los arreglos de H2 dejaron a medias: cada pin es un trozo literal.

test('H2 C1+C6: reconstruir el cliente aborta el turno TAMBIÉN en el servidor', () => {
  // Desde C6, `runTurn` ya no manda POST /session/:id/abort al cancelarse la
  // señal: apunta la sesión en el cliente para que la cierre quien la borre. Y
  // ese cliente es justo el que buildClient está desechando, así que opencode
  // seguía ejecutando el turno entero (revisión adversaria de H2, 2026-09-14).
  const cliente = JS.slice(JS.indexOf('function buildClient'), JS.indexOf('async function refreshTab'))
  assert(/abort\(state\.sessionID\)/.test(cliente), 'se aborta en el servidor, como en Parar y en «Sesión nueva»')
  assert(/if \(state\.sessionID\)/.test(cliente), 'sólo si hay sesión que abortar')
  assert(cliente.indexOf('abort(state.sessionID)') < cliente.indexOf('disconnect()'), 'ANTES de tirar el cliente que tendría que hacerlo')
  assert(/\.catch\(\(\) => \{\}\)/.test(cliente), 'y sin romper el arranque del sitio nuevo si falla')
})

test('H2 C1+C2: un indexado en vuelo se cancela al cambiar de sitio, y el velo se va con él', () => {
  // «Levantar el mapa» dura minutos. Al cambiar de sitio se quedaba sin
  // cliente: moría a los 120 s, dejaba el velo puesto sobre el sitio NUEVO
  // todo ese rato y marcaba el anterior como configurado sin haber indexado
  // nada (revisión adversaria de H2, 2026-09-14).
  const cliente = JS.slice(JS.indexOf('function buildClient'), JS.indexOf('async function refreshTab'))
  assert(/state\.indexingAbort/.test(cliente), 'el indexado también se cancela al reconstruir el cliente')
  assert(/hideBusy\(\)/.test(cliente), 'y el velo se quita: era del sitio anterior')
  assert(/'Indexado cancelado'/.test(cliente), 'y se dice en el registro')
})

test('H2 C2: un indexado cancelado no deja el sitio por configurado ni pinta un fallo', () => {
  const contexto = JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext'))
  const captura = contexto.slice(contexto.indexOf('} catch (err) {'))
  assert(/AbortError/.test(captura), 'el catch distingue cancelado de fallido')
  assert(captura.indexOf('AbortError') < captura.indexOf('saveSite(host, { onboarded: true })'), 'y decide ANTES de dar el sitio por configurado')
  assert(/log\.info\('Indexado cancelado'/.test(captura), 'cancelar no es fallar: queda como info')
  const cancelado = captura.slice(captura.indexOf('AbortError'), captura.indexOf("log.error('Indexado fallido'"))
  assert(/\breturn\b/.test(cancelado), 'y se sale: la pantalla de contexto volverá a salir')
  assert(!/El indexado falló/.test(cancelado), 'sin pintar sobre el chat un fallo que no lo es')
  assert(!/saveSite\(/.test(cancelado), 'ni escribir nada del sitio')
})

test('H2 C2: «¿sigue el panel en ese sitio?» se pregunta en cada uso, no una vez', () => {
  // Se evaluaba UNA vez y después de tres await de storage se tocaban
  // state.index, state.contextMd y el chat: en ese hueco el índice de A podía
  // entrar en el estado de B (revisión adversaria de H2, 2026-09-14).
  const contexto = JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext'))
  assert(/const sigueAqui = \(\) =>/.test(contexto), 'es una función, no una foto')
  assert(!/const sigueAqui = state\./.test(contexto), 'nunca un booleano tomado una vez')
  assert((contexto.match(/sigueAqui\(\)/g) || []).length >= 5, 'y se llama en cada uso, también en el catch')
  const tras = contexto.slice(contexto.indexOf('const fundido'))
  assert(tras.indexOf('sigueAqui()') < tras.indexOf('state.index = fundido'), 'antes de meter el índice de un sitio en el estado de otro')
  assert(tras.indexOf('sigueAqui()') < tras.indexOf('restoreConversation()'), 'y antes de repintar el chat de otro')
})

test('H2 C7: una pestaña fuera de Atlassian no es un cambio de sitio', () => {
  // Al salir al correo `state.site` queda null, y al VOLVER al MISMO host
  // 'a' !== undefined daba «cambio de sitio»: se vaciaban índice, contexto y
  // páginas base, se rearrancaba —y eso mataba el turno— y se tiraba la espera
  // del MCP (revisión adversaria de H2, 2026-09-14). El sitio del panel es el
  // último host de Atlassian visto, no el de la pestaña de ahora.
  assert(/lastHost: ''/.test(JS), 'el último host visto vive en el estado')
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  assert(/const changedHost = !!site &&/.test(refresco), 'sin sitio no hay cambio de sitio')
  assert(/site\.host !== state\.lastHost/.test(refresco), 'el cambio se mide contra el último host de Atlassian visto')
  assert(/state\.lastHost = site\.host/.test(refresco), 'que sólo se fija cuando hay sitio')
  const fuera = refresco.slice(refresco.lastIndexOf('if (!site) {'), refresco.indexOf('if (changedHost) await bootForSite()'))
  assert(/showEmpty\(/.test(fuera) && /\breturn\b/.test(fuera), 'sin sitio, el panel sólo dice dónde está')
  assert(!/emptySources\(\)/.test(fuera) && !/state\.index = null/.test(fuera) && !/state\.linkedContext = null/.test(fuera), 'no se vacía nada: al volver todo sigue siendo suyo')
  assert(!/mcpWait/.test(fuera) && !/bootForSite\(/.test(fuera), 'ni se corta la espera del MCP ni se rearranca')
  // Y el chat, que showEmpty vacía, se vuelve a pintar al volver: sin cambio
  // de sitio ya no hay arranque que lo restaure.
  assert(/restoreConversation\(\)/.test(refresco), 'al volver de fuera, el chat se repinta')
  assert(/state\.streaming/.test(refresco), 'salvo con una respuesta llegando: ésa no se tira')
})

test('H2 A1: el velo «Trabajando…» apaga el panel de debajo y se queda con el foco', () => {
  // `hideScreens()` mete el foco en el cuadro justo antes de que showBusy lo
  // tape: con el velo puesto se seguía tabulando por lo de debajo y se podía
  // mandar un turno a ciegas (revisión adversaria de H2, 2026-09-14).
  const velo = JS.slice(JS.indexOf('function showBusy'), JS.indexOf('function autoGrow'))
  assert(/el\.app\.inert = true/.test(velo), 'lo de debajo queda inerte, como con una pantalla abierta')
  assert(/btn-busy-cancel/.test(velo) && /\.focus\(\)/.test(velo), 'y el foco entra en Cancelar')
  // Y el velo sabe qué cancela: un Cancelar que no cancela nada no se enseña.
  assert(/function showBusy\(title, text, \{ abort = null \} = \{\}\)/.test(velo), 'el velo recibe su abortador')
  assert(/state\.busyAbort = abort/.test(velo), 'que se guarda para el botón')
  assert(/\.hidden = !abort/.test(velo), 'y sin abortador el botón no está')
  const quitar = velo.slice(velo.indexOf('function hideBusy'))
  assert(/document\.querySelector\('\.screen:not\(\.hidden\)'\)/.test(quitar), 'al quitarlo no se pisa el inert de una pantalla abierta')
  assert(/el\.app\.inert = false/.test(quitar) && /devolverFoco\(\)/.test(quitar), 'y el foco vuelve a quien lo tenía')
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  assert(/state\.busyAbort\?\.abort\(\)/.test(eventos), 'Cancelar aborta lo que trajo el velo')
  const esc = eventos.slice(eventos.indexOf("document.addEventListener('keydown'"), eventos.indexOf('el.send.addEventListener'))
  assert(/\.hidden/.test(esc), 'y Escape no toca un velo sin nada que cancelar')
  const contexto = JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext'))
  assert(/abort: controller/.test(contexto), 'el indexado pasa su abortador')
  const nueva = JS.slice(JS.indexOf('async function newSession'))
  assert(/showBusy\('Guardando lo aprendido'/.test(nueva) && !/abort:/.test(nueva), 'resumir la sesión no ofrece un Cancelar que no cancela nada')
})

test('H2 A3: Escape en Ajustes cierra sin guardar', () => {
  // Su «Listo» GUARDA todo —la contraseña y la URL del servidor incluidas— y
  // rearranca el panel, lo que además cancela el turno en vuelo: un Escape
  // distraído aplicaba unos ajustes a medio escribir (revisión adversaria de
  // H2, 2026-09-14).
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  const esc = eventos.slice(eventos.indexOf("document.addEventListener('keydown'"), eventos.indexOf('el.send.addEventListener'))
  assert(/ESCAPE_DISMISSES\.includes\(/.test(esc), 'las pantallas que se cierran sin pulsar su botón salen del mapa puro')
  assert(/closeSettingsWithoutSaving\(\)/.test(esc), 'y se cierran sin pasar por «Listo»')
  assert(esc.indexOf('ESCAPE_DISMISSES') < esc.indexOf('ESCAPE_CLOSES['), 'antes de mirar el mapa de los botones')
  const cerrar = JS.slice(JS.indexOf('function closeSettingsWithoutSaving'), JS.indexOf('function connectCommand'))
  assert(/hideScreens\(\)/.test(cerrar), 'sólo cierra')
  assert(!/saveSettings\(/.test(cerrar) && !/bootForSite\(/.test(cerrar), 'ni guarda ni rearranca')
  // Y al volver a abrirla, los campos se rellenan otra vez de state.settings:
  // lo tecleado y no guardado se pierde, que es lo que se pide.
  const ajustes = JS.slice(JS.indexOf('async function showSettingsScreen'), JS.indexOf('function setStatus'))
  for (const id of ['set-url', 'set-pass', 'set-delay', 'set-motion', 'set-nav-quick', 'set-hl-marker']) {
    assert(ajustes.includes(`$('${id}')`) && ajustes.includes('state.settings'), `al abrir, ${id} vuelve a salir de state.settings`)
  }
})

test('H3: el arranque dice cuánto tardó cada fase, y la del MCP es la que se viene a leer', () => {
  // El `GET /mcp` tarda entre 2,8 y 14,5 s la PRIMERA vez tras arrancar opencode
  // (auditoría del 2026-09-13 contra un servidor desechable; 14 463 ms el
  // 2026-09-21 contra el del usuario) y `bootForSite` lo esperaba antes de
  // enseñar el chat. Nadie lo veía: sin el número en el registro, sacarlo del
  // camino (H14 P5) habría sido a ciegas.
  // El trozo es el arranque SOLO: desde H14 el MCP es otra función y sus fases
  // son suyas (`currentProfile` es lo primero que viene detrás). Sin recortar
  // aquí, la fase «MCP» de `checkMcp` daría por buena la del arranque.
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('function currentProfile(')))
  // Reloj MONÓTONO: `Date.now` salta con el reloj del sistema (NTP, cambio de
  // hora) y una fase podía salir negativa o de horas. El content script ya medía
  // con `performance.now`; el panel también (revisión adversaria de H3).
  assert(/const cron = startTiming\(\(\) => performance\.now\(\)\)/.test(arranque), 'el arranque se cronometra desde el principio, con reloj monótono')
  assert(/'Arranque del panel'/.test(arranque), 'y se registra al acabar')
  assert(/state\.timing\.boot = timingLine\(cron\.done\(\)\)/.test(arranque), 'con la línea que también enseña el Registro')
  // Las fases dicen lo que miden. Desde H6 el almacenamiento va EN PARALELO con
  // la petición de modelos (una sola lectura para todo el sitio), así que las
  // dos fases de antes son una con su nombre, y lo que queda por leer después
  // del MCP —el contexto del Confluence enlazado, que es de otro host— tiene la
  // suya: sin eso, esos milisegundos se contaban como «restaurar».
  for (const fase of ['health', 'modelos y almacenamiento', 'enlazado', 'restaurar']) {
    assert(arranque.includes(`cron.mark('${fase}')`), `falta la fase ${fase}`)
  }
  assert(!/cron\.mark\('modelos'\)/.test(arranque) && !/cron\.mark\('almacenamiento'\)/.test(arranque), 'y las dos de antes ya no están: una fase no puede llamarse como otra que medía otra cosa')
  // Y la fase «MCP» ya sólo existe en la ÚNICA salida que lo espera: el sitio que
  // todavía no está configurado (H14 P5). En cualquier otro sitio del arranque
  // sería una fase de una espera que ya no hay.
  const espera = arranque.slice(arranque.indexOf('if (primeraVez) {'), arranque.indexOf('} else {', arranque.indexOf('if (primeraVez) {')))
  assert(espera.includes('const r = await comprobacion') && espera.includes("cron.mark('MCP')"), 'la fase MCP vive donde se espera al MCP')
  eq(arranque.split("cron.mark('MCP')").length - 1, 1, 'y en ningún otro sitio del arranque')
  // Lo que se registra en «MCP comprobado» son las DOS peticiones y nada más:
  // dentro de la comprobación, la marca va antes de adoptar el MCP y guardar los
  // sitios, o el número dejaría de ser el del GET. La fase «MCP» del ARRANQUE, en
  // cambio, es lo que ese arranque esperó —la comprobación entera, adopción
  // incluida, que en la primera vez es cuando se adopta—: son dos números y los
  // dos se dicen (revisión adversaria de H14).
  const comprobar = sinComentarios(JS.slice(JS.indexOf('async function checkMcp'), JS.indexOf('function mcpResultSoon')))
  const mcp = comprobar.indexOf("cron.mark('MCP')")
  assert(comprobar.lastIndexOf('client.listMcp()', mcp) > -1, 'la marca va después de pedir /mcp y /config')
  assert(mcp < comprobar.indexOf('siteRecords({'), 'y antes de adoptar el MCP y escribir en storage')
  assert(/'MCP comprobado'/.test(comprobar) && /timingLine\(cron\.done\(\)/.test(comprobar), 'y lo que costó se registra con su propia línea')
  // El arranque tiene cuatro salidas: tres miden —pantalla de claves, pantalla de
  // contexto y el chat, y la de las claves es justo la que enseña lo que cuesta
  // el MCP— y la de «sin opencode» no mide nada. Se cuenta sobre el fuente SIN
  // comentarios: el pin contaba 4 llamadas y una era la del comentario de encima.
  // Desde H17 son CINCO: la pantalla «Elige el modelo» del primer uso es otra
  // salida del arranque (antes de las claves), con su variante de la lista de
  // modelos caída y sin ningún modelo guardado; las dos miden lo que costó
  // llegar hasta ahí, que es lo que se esperó antes de ver la pantalla.
  eq(arranque.split('medir()').length - 1, 5, 'medir() se llama en las cinco salidas que llegan a medir algo')
  const claves = arranque.slice(arranque.indexOf('if (faltanClaves(r)) {'))
  assert(claves.indexOf('medir()') < claves.indexOf('return'), 'la salida por la pantalla de claves mide antes de volver')
  // La salida «sin opencode» no registra un arranque verde que no hubo, y además
  // VACÍA la fila: si no, «tiempos (arranque)» se quedaba con la línea del
  // arranque anterior, que era de otro momento y quizá de otro sitio.
  const sinOpencode = arranque.slice(arranque.indexOf('await client.health()'), arranque.indexOf("cron.mark('health')"))
  assert(/state\.timing\.boot = ''/.test(sinOpencode), 'sin opencode, la fila de tiempos vuelve a «(sin medir)»')
  assert(!sinOpencode.includes('medir()'), 'y no se registra ningún «Arranque del panel»')
  // SEGURIDAD: de la configuración de opencode no sale nada al registro; una
  // línea de tiempos son etiquetas de Faro y números.
  assert(!/log\.\w+\([^)]*\bconfig\b/.test(arranque) && !/log\.\w+\([^)]*\bconfig\b/.test(comprobar), 'la configuración no se registra')
})

test('H6 P4: el arranque lee el sitio de UNA vez y no espera en fila lo que puede ir a la vez', () => {
  // El arranque encadenaba ~13 lecturas de storage detrás de las peticiones a
  // opencode, cinco de ellas el mismo `getSite` del mismo host —y cada una
  // relee el mapa entero de `faro:sites`— (docs/PLAN.md §2.6 P4). Ahora: una
  // lectura multi-clave, y en paralelo con la de modelos y la de la sesión.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext'))
  const codigo = sinComentarios(arranque)
  assert(/const \[bundle, sessionID, modelos\] = await Promise\.all\(\[/.test(codigo), 'las tres cosas se piden juntas')
  assert(/getSiteBundle\(state\.site\.host\)/.test(codigo), 'lo guardado del sitio, en un solo paquete')
  assert(/getSessionId\(state\.site\.host\)/.test(codigo), 'la sesión abierta, a la vez')
  assert(/client\.models\(\)\.catch\(\(err\) => \(\{ error: err \}\)\)/.test(codigo), 'y los modelos, sin poder tumbar a las otras dos si fallan')
  assert(
    /if \(Array\.isArray\(modelos\?\.models\)\) \{/.test(codigo) && /showNotice\('No he podido leer la lista de modelos: /.test(codigo),
    'un fallo de modelos avisa y el arranque sigue, como antes: se pregunta por la lista, no por el error'
  )
  // Lo que antes se leía suelto sale del paquete.
  assert(/state\.contextMd = bundle\.contextMd/.test(codigo), 'el contexto sale del paquete')
  assert(/state\.index = bundle\.index/.test(codigo) && /if \(bundle\.stale\)/.test(codigo), 'el índice también, con su aviso de versión vieja')
  assert(/'Índice descartado'/.test(arranque), 'que sigue siendo el mismo')
  assert(/state\.sessionID = sessionID/.test(codigo), 'y la sesión ya no se pide otra vez más abajo')
  // La memoria se reconstruye con claves blancas al leerla (§9), aunque venga
  // del paquete: `getSiteBundle` la entrega tal cual está guardada.
  assert(/state\.memory = memory\.normalizeMemory\(bundle\.memoryRaw\)/.test(codigo), 'la memoria del paquete se normaliza aquí')
  // Y las lecturas sueltas se han ido de verdad: queda UN `getSite`, el de
  // releer el sitio después de adoptar un MCP y reescribirlo.
  eq(codigo.split('await getSite(').length - 1, 1, 'un solo getSite en el arranque')
  assert(codigo.indexOf('await getSite(') > codigo.indexOf('siteRecords({'), 'y es la relectura de después de adoptar el MCP')
  eq(codigo.split('getSessionId(').length - 1, 1, 'una sola lectura de la sesión')
  assert(!/memory\.getContextMd\(/.test(codigo) && !/memory\.getMemory\(/.test(codigo) && !/await getIndex\(/.test(codigo), 'ni contexto, ni memoria, ni índice por su cuenta')
  // El testigo sigue comprobándose tras CADA await, también tras el nuevo
  // Promise.all: dos arranques solapados no pueden pisarse (C3, §8.22).
  const entre = codigo.slice(
    codigo.indexOf('])', codigo.indexOf('const [bundle, sessionID, modelos]')),
    codigo.indexOf("cron.mark('modelos y almacenamiento')")
  )
  assert(/if \(state\.bootToken !== testigo\) return/.test(entre), 'el testigo se comprueba nada más volver del Promise.all')
  // `onboarded` sale del mismo paquete (o de la relectura), no de otra lectura.
  assert(/if \(!saved\?\.onboarded\) \{/.test(codigo), 'la pantalla de contexto se decide con lo ya leído')
})

test('H6 P6a: cerrar Ajustes sólo rearranca si cambió el servidor o la contraseña', () => {
  // Rearrancar reconstruye el cliente, y eso CANCELA el turno en vuelo (C1) y
  // vuelve a descargar la conversación: cambiar «Reducir animaciones» a mitad
  // de una respuesta te la mataba (pendiente de §4.4 hasta H6).
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  const cerrar = eventos.slice(eventos.indexOf("$('btn-settings-close')"), eventos.indexOf("$('btn-reindex')"))
  const codigo = sinComentarios(cerrar)
  assert(/const antes = state\.settings/.test(codigo), 'se guarda lo que había antes de escribir')
  assert(codigo.indexOf('const antes = state.settings') < codigo.indexOf('await saveSettings('), 'antes de guardar, o se compararía consigo mismo')
  assert(
    /const clientChanged = state\.settings\.serverUrl !== antes\.serverUrl \|\| state\.settings\.password !== antes\.password/.test(codigo),
    'y se compara sólo lo que obliga a reconstruir el cliente'
  )
  assert(/applySettingsToUi\(\)/.test(codigo) && /hideScreens\(\)/.test(codigo), 'lo demás se aplica en caliente')
  assert(/if \(clientChanged\) \{\s*\n\s*await bootForSite\(\)/.test(codigo), 'y sólo entonces se rearranca')
  eq(codigo.split('bootForSite()').length - 1, 1, 'el rearranque vive dentro del if y en ningún otro sitio del manejador')
  assert(/'Ajustes aplicados'/.test(codigo), 'y el que no rearranca lo dice en el registro')
  // La página se entera por el service worker, que ve la escritura de
  // `faro:settings`: el panel no le manda nada por su cuenta.
  const sw = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8')
  assert(/chrome\.storage\.onChanged\.addListener\(\(changes, area\) => \{/.test(sw), 'el worker mira los cambios del almacén')
  assert(/STORAGE_KEYS\.settings in changes/.test(sw) && /area !== 'local'/.test(sw), 'sólo los ajustes, y sólo en local')
  assert(/chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/.test(sw) && /pushSettings\(tab\.id\)/.test(sw), 'y empuja los ajustes a la pestaña activa')
  // Escape sigue cerrando SIN guardar: lo tecleado se pierde, que es lo que A3
  // decidió; este cambio es del botón que SÍ guarda.
  assert(/closeSettingsWithoutSaving\(\)/.test(eventos), 'Escape sigue teniendo su camino propio')
})

test('H3: «Respuesta recibida» dice lo que costó el turno, y el Registro guarda sus tiempos', () => {
  // Qué se decide con esto: si las salidas de herramientas que la sesión
  // arrastra justifican «YA LEÍDAS» (H12) y si el sistema de un Análisis de
  // Jira —23-27 000 caracteres— merece tocarse. Medir, no cambiar nada.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/const cron = startTiming\(\(\) => performance\.now\(\)\)/.test(envio), 'el turno se cronometra con reloj monótono')
  // «pintar» separa lo que cuesta ENSEÑAR la respuesta (repintado final, aviso de
  // páginas base, guardar el modelo) de lo que cuesta el índice: sin ella, los
  // dos números salían juntos bajo la etiqueta «índice» (revisión adversaria de H3).
  for (const fase of ['página', 'sesión', 'primer texto', 'fin', 'pintar', 'índice', 'marcas']) {
    assert(envio.includes(`cron.mark('${fase}')`), `falta la fase ${fase}`)
  }
  assert(
    envio.indexOf("cron.mark('pintar')") < envio.indexOf('await growIndex(turn.parts,'),
    'la marca de «pintar» va antes del índice, que es lo que separa'
  )
  assert(envio.indexOf('await growTreeFromPage()') < envio.indexOf("cron.mark('índice')"), 'y «índice» cierra tras el árbol')
  // La primera palabra se marca UNA vez y sin tocar lo que se pinta. Desde H5 el
  // trozo se pinta por `paintTurnSoon` (un frame), pero la marca sigue midiendo
  // la LLEGADA del texto y no su pintado: va antes, y en el mismo sitio.
  assert(/if \(!primerTexto && t\.text\) \{/.test(envio), 'la primera palabra del modelo se detecta en el primer onUpdate con texto')
  assert(/paintTurnSoon\(t, toolsBox, body\)/.test(envio), 'y el trozo se pinta por el planificador de frames')
  assert(
    envio.indexOf("cron.mark('primer texto')") < envio.indexOf('paintTurnSoon(t, toolsBox, body)'),
    'el reloj mide al llegar el texto, no al pintarlo'
  )
  assert(/toolOutputSize\(turn\.parts\)/.test(envio), 'se mide cuánto texto devolvieron las herramientas')
  assert(/timingLine\(cron\.done\(\), \{/.test(envio), 'y el reloj entra en la línea del registro')
  assert(/sistema \$\{peticion\.system\.length\} caracteres/.test(envio), 'con el peso del sistema, que es lo que viaja en cada turno')
  assert(/turnCostText\(turn\)/.test(envio), 'y los tokens y el coste si el cliente los trae')
  // El sistema se mide por su longitud: al registro no va su texto (lleva el
  // contexto del sitio y la página en bloques).
  eq(envio.match(/peticion\.system(?!\.length)/g), null, 'del sistema sólo se registra cuánto mide')
  // El reloj del turno entero lo apunta el `finally`, y sólo el turno que sigue
  // siendo el del panel: el de un turno abandonado hablaría de otra cosa.
  const fin = envio.slice(envio.indexOf('} finally {'))
  assert(/state\.timing\.turn = timingLine\(cron\.done\(\)\)/.test(fin), 'el turno deja su línea de tiempos')
  assert(fin.indexOf('state.timing.turn') > fin.indexOf('if (state.turnToken === testigo)'), 'sólo el turno vigente')
  // Y sólo si llegó a mandarse y sigue siendo de este sitio y de esta sesión: la
  // misma condición que `mismoSitio`. Un turno que murió leyendo la página, o uno
  // que acabó con el panel en otro host, dejaba en el Registro una línea de fases
  // vacías o de otro sitio (revisión adversaria de H3).
  assert(/let medible = false/.test(envio) && envio.indexOf('let medible = false') < envio.indexOf('try {'), 'el testigo de «llegó a mandarse» vive fuera del try')
  assert(/medible = true/.test(envio) && envio.indexOf('medible = true') < envio.indexOf('runTurn('), 'y se enciende justo antes de mandar')
  assert(
    /if \(medible && \(state\.site\?\.host \?\? state\.lastHost\) === hostAlPedir && state\.sessionID === sesionAlPedir\) \{/.test(fin),
    'la línea del turno se apunta con la misma condición que mismoSitio'
  )
  // Dentro del testigo, pero SIN tocar lo demás del finally: apagar el estado y
  // soltar el testigo siguen dependiendo sólo de él.
  assert(fin.indexOf('setStreaming(false)') < fin.indexOf('if (medible &&'), 'y el resto del finally no cambia')
  assert(/timing: \{ boot: '', turn: '' \}/.test(JS), 'los dos tiempos viven en el estado, no en disco')
  // Los tiempos son del SITIO: al cambiar de host se van con el índice y el
  // contexto, porque hablan de un arranque y de un turno de otro sitio.
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  const cambio = refresco.slice(refresco.indexOf('if (changedHost) {'), refresco.indexOf('state.site = site'))
  assert(/state\.timing = \{ boot: '', turn: '' \}/.test(cambio), 'al cambiar de sitio los tiempos se vacían')

  // Y el Registro los enseña, con lo que ocupa el almacenamiento: un «va lento»
  // o un «no guarda» deja de ser una impresión.
  const estado = JS.slice(JS.indexOf('async function paintState'), JS.indexOf('async function treeDebug'))
  assert(/add\('tiempos \(arranque\)'/.test(estado) && /add\('tiempos \(último turno\)'/.test(estado), 'las dos filas de tiempos')
  assert(/getBytesInUse/.test(estado), 'y cuánto se lleva gastado de la cuota')
  assert(/bytes > 8 \* 1024 \* 1024 \? 'bad' : ''/.test(estado), 'con aviso antes de que storage.set empiece a fallar')
  // En la misma unidad que la cuota, y con el mismo formateador que el espejo del
  // panel enseña («8,4 MB de 10 MB»): escrito siempre en KB, el número no decía si
  // quedaba sitio (revisión adversaria de H3).
  assert(/\$\{formatBytes\(bytes\)\} de \$\{Math\.round\(cuota \/ \(1024 \* 1024\)\)\} MB/.test(estado), 'el tamaño se formatea con formatBytes')
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(espejo.includes("'8,4 MB de 10 MB'"), 'y el espejo enseña exactamente lo que pinta el panel')
  // El espejo es la referencia visual de estas filas: si el turno gana una fase,
  // su línea de ejemplo también, o se está diseñando contra algo que ya no existe.
  const filaTurno = espejo.slice(espejo.indexOf("['tiempos (último turno)'"), espejo.indexOf("['almacenamiento'"))
  for (const fase of ['página', 'sesión', 'primer texto', 'fin', 'pintar', 'índice', 'marcas']) {
    assert(filaTurno.includes(fase + ' '), `la línea de ejemplo del espejo no enseña la fase ${fase}`)
  }
  // Y lo mismo por el otro lado: el arranque cambió de fases en H6 («modelos y
  // almacenamiento» en vez de dos, «enlazado» nueva) y su línea de ejemplo se
  // quedó con las de antes. Sin este pin nadie lo habría notado.
  const filaArranque = espejo.slice(espejo.indexOf("['tiempos (arranque)'"), espejo.indexOf("['tiempos (último turno)'"))
  for (const fase of ['health', 'modelos y almacenamiento', 'MCP', 'enlazado', 'restaurar']) {
    assert(filaArranque.includes(fase + ' '), `la línea de ejemplo del espejo no enseña la fase ${fase}`)
  }
  assert(!/almacenamiento 60 ms|modelos 61 ms/.test(filaArranque), 'ni las fases que el arranque ya no mide')
})

test('H3: lo que tardó leer la página y marcarla lo dice la propia página', () => {
  // El panel mide con sus mensajes de ida y vuelta; el content script mide el
  // trabajo de verdad. Los dos números son distintos y el que sirve para
  // comparar una página corta con una larga es el de dentro.
  const lectura = JS.slice(JS.indexOf('async function readPageDigest'), JS.indexOf('function attachToBubble'))
  assert(/Number\.isFinite\(r\.ms\) \? ` · \$\{r\.ms\} ms` : ''/.test(lectura), '«Página leída en bloques» apunta los ms de la página')
  const notas = JS.slice(JS.indexOf('async function offerNotes'), JS.indexOf('function notesCard'))
  assert(/Number\.isFinite\(res\?\.ms\) \? ` · \$\{res\.ms\} ms en la página` : ''/.test(notas), '«Análisis marcado» también')
  // Los DOS sitios que mandan ANNOTATE reciben los ms, y volver a marcar al
  // restaurar es justo uno de los caminos que interesa medir.
  const remarcar = JS.slice(JS.indexOf('async function remarkFromAnchors'), JS.indexOf('async function focusNote'))
  assert(/Number\.isFinite\(res\?\.ms\)/.test(remarcar), '«Análisis marcado de nuevo» también los apunta')
  eq(JS.match(/MSG\.ANNOTATE/g)?.length, 2, 'y no hay un tercer sitio que marque sin medir')

  // Se pregunta con `Number.isFinite` y no por verdad: un `0` es una medida
  // legítima (una página corta se lee en menos de medio milisegundo) y es justo
  // la que sirve para comparar antes y después; y un content script viejo, que
  // no manda `ms`, no deja un «undefined ms» en el registro.
  assert(!/r\.ms \?/.test(lectura) && !/res\?\.ms \?/.test(notas) && !/res\?\.ms \?/.test(remarcar), 'nunca por verdad: 0 ms es un dato')

  // Y quien lo manda es el content script, en las dos respuestas.
  const bootstrap = readFileSync(join(ROOT, 'src/content/bootstrap.js'), 'utf8')
  assert(
    bootstrap.includes('sendResponse({ ok: true, ...cuerpo, ms: Math.round(performance.now() - t0) })'),
    'PAGE_DIGEST devuelve ms'
  )
  const runner = readFileSync(join(ROOT, 'src/content/runner.js'), 'utf8')
  const marcas = runner.slice(runner.indexOf('  async applyNotes('), runner.indexOf('  async focusNote('))
  assert(marcas.includes('const transcurrido = () => Math.round(performance.now() - t0)'), 'un solo reloj en applyNotes')
  eq(marcas.match(/return \{[^}]*\bms\b/g)?.length, 3, 'las tres salidas de applyNotes llevan ms')
  // El reloj arranca DESPUÉS de esperar a que la página tenga texto —el mismo
  // criterio que PAGE_DIGEST, que deja ese `waitFor` fuera a propósito— y se para
  // en cuanto las marcas están puestas, ANTES del desplazamiento suave hasta la
  // primera: esos 420-820 ms son animación fija, no trabajo de marcar, y tapaban
  // la diferencia entre una página corta y una larga (revisión adversaria de H3).
  assert(marcas.indexOf('await waitFor(') < marcas.indexOf('const t0 = performance.now()'), 'el reloj arranca tras esperar a la página')
  assert(/reason: 'editando', ms: 0/.test(marcas), 'y la salida por el editor, que es antes de esperar, devuelve 0')
  const paraReloj = marcas.indexOf('const ms = transcurrido()')
  assert(paraReloj > marcas.indexOf('this.overlay.annotate(items)'), 'el reloj se para con las marcas ya puestas')
  assert(paraReloj > -1 && paraReloj < marcas.indexOf('scrollToRange('), 'y antes del desplazamiento suave')
})

// Composición de H5 (paso 4 del anexo D; docs/PLAN.md §3.4 y §2.5 A6).

test('H5: la cabecera es el faro, el chip de ubicación y las acciones', () => {
  // El faro ES el estado: era un punto gris aparte (1,57:1 sin conexión) con su
  // texto al lado, y entre los dos se comían el hueco de las acciones.
  assert(/<span class="beacon" id="status-dot"[^>]*>/.test(HTML), '#status-dot es el faro de la marca')
  assert(/id="status-dot"[^>]*aria-hidden="true"/.test(HTML), 'y es decorativo: lo que se lee es #status-text')
  assert(/<span class="sr-only" id="status-text"/.test(HTML), '#status-text sigue existiendo, sólo para el lector de pantalla')
  assert(!/class="status"/.test(HTML) && !/class="dot"/.test(HTML), 'sin el bloque de estado ni su punto')
  assert(!/^\.dot\b/m.test(CSS_LIMPIO) && !/\n\.dot\b/.test(CSS_LIMPIO), 'y el CSS no se queda con la regla del punto que ya no existe')

  // El chip, en dos piezas dentro de #location-text: la clave y el título.
  const chip = HTML.slice(HTML.indexOf('id="location-chip"'), HTML.indexOf('</button>', HTML.indexOf('id="location-chip"')))
  assert(/id="location-text"/.test(chip), 'el envoltorio sigue siendo #location-text')
  assert(chip.indexOf('id="location-key"') < chip.indexOf('id="location-title"'), 'la clave va delante del título')
  assert(/class="loc-key[^"]*" id="location-key"/.test(chip), '#location-key lleva .loc-key')
  assert(/class="loc-title" id="location-title"/.test(chip), '#location-title lleva .loc-title')
  for (const c of ['loc-key', 'loc-title']) assert(new RegExp('\\.' + c + '\\s*\\{').test(CSS_LIMPIO), 'clase sin estilo: ' + c)

  // A6: quien cede es el chip, y dentro del chip el título. Las acciones no se
  // encogen ni se parten en dos filas: hoy son cuatro y con el «Qué mirar hoy»
  // de H11 serán cinco (5 × 28 + 4 × 2 = 148 px de los 320 del panel estrecho).
  assert(/\.top-actions\s*\{[^}]*flex: none/.test(CSS_LIMPIO), 'las acciones de la cabecera no ceden')
  assert(/\.chip\s*\{[^}]*min-width: 0/.test(CSS_LIMPIO), 'el chip sí, hasta la elipsis')
  // Dentro del chip ceden los dos, pero por turnos: el título mil veces antes
  // (`flex-shrink: 1000`) y la clave la última, y cuando cede lo hace con
  // elipsis. Con `flex: none` la clave se cortaba EN SECO contra el borde del
  // chip a 320 px con el quinto botón de H11 («Confluence · El», visto en el
  // espejo al cerrar H5).
  assert(/\.loc-key\s*\{[^}]*flex: 0 1 auto/.test(CSS_LIMPIO), 'la clave cede, pero la última')
  assert(/\.loc-key\s*\{[^}]*text-overflow: ellipsis/.test(CSS_LIMPIO), 'y cuando cede, con elipsis, no en seco')
  assert(/\.loc-title\s*\{[^}]*flex: 0 1000 auto/.test(CSS_LIMPIO), 'el título es el primero en recortarse')
  assert(/\.loc-title\s*\{[^}]*text-overflow: ellipsis/.test(CSS_LIMPIO), 'también con elipsis')

  // Una sola fuente de verdad para el hueco del título: `state.statusLine`, que
  // escribe setStatus y pinta paintLocation (decisión 4 del plan: el texto de
  // estado se sigue viendo mientras dura un turno o un recorrido).
  assert(/\n {2}statusLine: '',/.test(JS), 'el estado en curso vive en el estado del panel')
  const estado = JS.slice(JS.indexOf('function setStatus(kind, text)'), JS.indexOf('function paintLocation'))
  assert(/el\.statusDot\.className = 'beacon ' \+ kind/.test(estado), 'el faro se pinta con beacon + estado')
  assert(/el\.statusDot\.title = /.test(estado) && /el\.statusText\.textContent = text/.test(estado), 'con su tooltip y su texto')
  assert(/state\.statusLine = kind === 'busy' \? text : ''/.test(estado), 'sólo lo que está pasando ahora ocupa el chip')
  assert(/paintLocation\(state\.site, state\.tabTitle\)/.test(estado), 'y se repinta el chip')
  const pintar = JS.slice(JS.indexOf('function paintLocation'), JS.indexOf('function setStreaming'))
  assert(/locationParts\(site, tabTitle\)/.test(pintar), 'las dos piezas las decide la función pura de site.js')
  assert(/el\.locationTitle\.textContent = state\.statusLine \|\| title/.test(pintar), 'y al acabar vuelve el título de la pestaña')
  assert(/classList\.toggle\('hidden', !key\)/.test(pintar), 'sin clave no queda un hueco vacío')

  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  assert(/paintLocation\(site, tab\.title\)/.test(refresco), 'refreshTab pinta la ubicación con el título de la pestaña')
  assert(!/el\.locationText/.test(JS), 'ya nadie escribe el chip de una pieza')
})

test('H5: cada pantalla lleva su cabecera, y el botón de cerrar vive dentro de ella', () => {
  // Los «Listo» estaban al final de una pantalla que se desplaza: había que
  // bajar hasta el fondo para volver. Ahora es una flecha en la cabecera, que se
  // queda arriba; es el MISMO botón (mismo id, mismo manejador), movido.
  eq(
    (HTML.match(/class="screen-inner/g) || []).length,
    (HTML.match(/class="screen-head"/g) || []).length,
    'cada .screen-inner lleva su cabecera'
  )
  for (const cabecera of HTML.match(/<div class="screen-head">[\s\S]*?<\/div>/g) || []) {
    assert(/<h1/.test(cabecera), 'una cabecera de pantalla lleva su h1: ' + cabecera.slice(0, 60))
  }

  const cierres = {
    'screen-settings': ['btn-settings-close', 'Guardar y volver'],
    'screen-memory': ['btn-memory-close', 'Volver al chat'],
    'screen-sources': ['btn-sources-close', 'Volver al chat'],
    // H11 trae la quinta pantalla de consulta y sigue la misma regla: se vuelve
    // por la flecha de su cabecera, con el mismo id que pulsa Escape.
    'screen-today': ['btn-today-close', 'Volver al chat'],
    'screen-log': ['btn-log-close', 'Volver al chat'],
    'setup-manual': ['btn-setup-back', 'Volver a las claves'],
  }
  for (const [pantalla, [btn, etiqueta]] of Object.entries(cierres)) {
    const desde = HTML.indexOf(`id="${pantalla}"`)
    assert(desde > 0, 'no existe ' + pantalla)
    const cabecera = HTML.slice(HTML.indexOf('<div class="screen-head">', desde), HTML.indexOf('</h1>', desde))
    assert(cabecera.includes(`id="${btn}"`), `${btn} tiene que estar en la cabecera de ${pantalla}, antes de su h1`)
    assert(new RegExp(`class="icon-btn back" id="${btn}"`).test(HTML), `${btn} es la flecha de volver`)
    assert(new RegExp(`id="${btn}"[^>]*aria-label="${etiqueta}"`).test(HTML), `${btn} dice qué hace: ${etiqueta}`)
    assert(JS.includes(`$('${btn}').addEventListener`), `${btn} sigue cableado`)
  }
  // Ajustes GUARDA al cerrar (contraseña y dirección del servidor incluidas), y
  // por eso su etiqueta no dice «Volver» a secas y Escape no lo pulsa.
  assert(/id="btn-settings-close"[^>]*title="Guardar y volver"/.test(HTML))

  // Salir de estas tres es decidir algo (conectar, dar las claves, elegir qué
  // hacer con el contexto): su cabecera lleva sólo el título, y «Ahora no» sigue
  // siendo un botón con texto.
  for (const pantalla of ['screen-connect', 'screen-context', 'setup-main']) {
    const desde = HTML.indexOf(`id="${pantalla}"`)
    const cabecera = HTML.slice(HTML.indexOf('<div class="screen-head">', desde), HTML.indexOf('</h1>', desde))
    assert(!/<button/.test(cabecera), `${pantalla} no tiene a dónde volver: su cabecera es sólo el título`)
  }
  assert(/id="btn-setup-skip"[^>]*>Ahora no</.test(HTML), '«Ahora no» se lee, no es un icono')
  assert(/\.screen-head\s*\{[^}]*position: sticky/.test(CSS_LIMPIO), 'la cabecera de una pantalla se queda arriba al desplazar')
  // Y el título sigue siendo lo que enfoca showScreen (A1): el h1 de la parte
  // VISIBLE, que en la pantalla de claves son dos.
  assert(HTML.indexOf('<div class="screen-head">', HTML.indexOf('id="setup-manual"')) > HTML.indexOf('id="setup-manual"'))
  assert(/const titulo = \[\.\.\.\(screen\?\.querySelectorAll\('h1'\) \|\| \[\]\)\]\.find\(\(h\) => !h\.closest\('\.hidden'\)\)/.test(JS))

  // Las dos mitades de la pantalla de claves se turnan sin pasar por
  // `showScreen`, y el botón que las cambia se esconde con la suya: el foco lo
  // mueven ellas, al título de la mitad que aparece, o se quedaba en el <body>.
  const manual = JS.slice(JS.indexOf('async function showManualStep'), JS.indexOf("const waiting = $('setup-waiting')"))
  assert(/querySelector\('h1'\)/.test(manual) && /titulo\.focus\(\)/.test(manual), 'ir al paso manual lleva el foco a su título')
  const volver = JS.slice(JS.indexOf("$('btn-setup-back').addEventListener"), JS.indexOf("$('btn-setup-later').addEventListener"))
  assert(/\$\('setup-title'\)/.test(volver) && /titulo\.focus\(\)/.test(volver), 'y volver con la flecha, al de las claves')
})

test('H5: la memoria entre sesiones se enciende en su pantalla y se ve en su botón', () => {
  // Había dos controles para un ajuste: la casilla de la pantalla de Memoria y
  // una pastilla en el redactor, justo en la fila donde se escribe. Queda la
  // casilla; el botón de la cabecera sólo DICE si está activa.
  assert(!/btn-memory-toggle|memory-label/.test(HTML), 'la pastilla del redactor se fue del HTML')
  assert(!/memoryToggle|memoryLabel/.test(JS), 'y su cableado del JS')
  assert(!/\.pill\b/.test(CSS_LIMPIO), 'y su estilo del CSS: nadie más la usaba')
  const aplica = /function applySettingsToUi\(\)\s*\{[\s\S]*?\n\}/.exec(JS)
  assert(aplica, 'applySettingsToUi sigue existiendo')
  assert(/\$\('btn-memory'\)/.test(aplica[0]), 'el estado va al botón que abre la pantalla')
  assert(/classList\.toggle\('on', !!state\.settings\.crossSessionMemory\)/.test(aplica[0]), 'encendido si la memoria está activa')
  assert(/\.icon-btn\.on\b/.test(CSS_LIMPIO), 'y encendido se ve')

  // Y se LEE. Hasta H5 el estado viajaba en el texto de la pastilla («Memoria
  // activa»); con la pastilla fuera se quedó en la clase `.on` y en el `title`,
  // que un `aria-label` fijo («Memoria») tapa: un lector de pantalla no tenía
  // forma de saber si estaba encendida (revisión adversaria de H5). `#btn-memory`
  // ABRE la pantalla y no conmuta nada, así que su semántica no es
  // `aria-pressed`: lo que cambia es su NOMBRE, y dice lo mismo que el tooltip.
  assert(/setAttribute\('aria-label', nombre\)/.test(aplica[0]), 'el nombre del botón dice el estado')
  assert(/boton\.title = nombre/.test(aplica[0]), 'y el tooltip dice exactamente lo mismo')
  for (const texto of ['Memoria entre sesiones: activa', 'Memoria entre sesiones: desactivada']) {
    assert(aplica[0].includes(texto), 'falta el nombre: ' + texto)
  }
  assert(
    /id="btn-memory"[^>]*aria-label="Memoria entre sesiones: desactivada"/.test(HTML),
    'y el HTML arranca diciendo que está apagada, que es como arranca el ajuste'
  )
  assert(!/id="btn-memory"[^>]*aria-label="Memoria"/.test(HTML), 'nunca un «Memoria» a secas: taparía el title')
  const espejoMemoria = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(
    !/\$\('btn-memory'\)\.title = /.test(espejoMemoria) ||
      /\$\('btn-memory'\)\.setAttribute\('aria-label', 'Memoria entre sesiones: activa'\)/.test(espejoMemoria),
    'el espejo pinta ese botón encendido: tiene que poner el mismo aria-label'
  )
  // Recortado al MANEJADOR, no a `wireEvents` entera: `applySettingsToUi()` se
  // llama también al cerrar Ajustes, así que las dos regex unidas contra el
  // trozo grande daban verde aunque la casilla no repintara nada (revisión
  // adversaria de H5).
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  const desdeCasilla = eventos.slice(eventos.indexOf("$('mem-enabled').addEventListener"))
  assert(desdeCasilla.startsWith("$('mem-enabled').addEventListener"), 'la casilla de la pantalla sigue cableada')
  const casilla = desdeCasilla.slice(0, desdeCasilla.indexOf('\n  })') + 5)
  assert(/saveSettings\(\{ crossSessionMemory:/.test(casilla), 'y guarda el ajuste')
  assert(/applySettingsToUi\(\)/.test(casilla), 'y repinta el botón de la cabecera desde ESE manejador')
})

test('H5: la fila del redactor es una línea, y quien cede es el nombre del modelo', () => {
  // Con la pastilla «Memoria» y su `.grow` fuera, el reparto lo hace flex: el
  // modelo (43 nombres, algunos larguísimos) se encoge; la Skill, que dice cómo
  // va a trabajar Faro, no; los botones tampoco, porque apretados parten su
  // contenido en dos líneas y la barra crece de alto.
  assert(!/class="grow"/.test(HTML.slice(HTML.indexOf('id="composer"'), HTML.indexOf('</footer>'))), 'sin separadores en el redactor')
  assert(/\.model-select\s*\{[^}]*flex: 1 1 auto/.test(CSS_LIMPIO) && /\.model-select\s*\{[^}]*min-width: 0/.test(CSS_LIMPIO))
  assert(/\.skill-select\s*\{[^}]*flex: none/.test(CSS_LIMPIO), 'la Skill no cede')
  assert(/\.composer-meta \.icon-btn\s*\{[^}]*flex: none/.test(CSS_LIMPIO), 'ni los botones')
  assert(!/max-width: (?:46|34)%/.test(CSS_LIMPIO), 'y ya no hacen falta los topes en % que sostenían la fila vieja')
})

// Tarjeta de análisis, estado vacío y herramientas plegadas (pasos 5 y 6 del
// anexo D) + el pintado por frames del anexo E, que toca el mismo `paintTurn`.

test('H5: cada observación dice de qué clase es, y la tarjeta viva se puede copiar', () => {
  const tarjeta = JS.slice(JS.indexOf('function notesCard'), JS.indexOf('async function copyNotes'))

  // El `kind` lo pide el prompt, lo valida `validateNotes` y hasta H5 la tarjeta
  // lo TIRABA: un dato no se lee igual que un riesgo.
  assert(/'note-meta'/.test(tarjeta), 'la clase y la cita comparten una línea')
  assert(/'note-kind'/.test(tarjeta), 'la clase de la observación se pinta')
  assert(/KIND_LABELS\[nota\.kind\]/.test(tarjeta), 'desde nota.kind, por la tabla de etiquetas')
  assert(/if \(etiqueta\) \{/.test(tarjeta), 'un kind vacío no deja una etiqueta vacía')
  const etiquetas = /const KIND_LABELS = \{[\s\S]*?\n\}/.exec(JS)
  assert(etiquetas, 'las etiquetas viven en una tabla')
  for (const kind of NOTE_KINDS) {
    assert(new RegExp('\\b' + kind + ':').test(etiquetas[0]), 'falta la etiqueta de ' + kind)
  }
  assert(/contradiccion: 'contradicción'/.test(etiquetas[0]), 'al usuario se le escribe con tilde; al modelo se le pide sin ella')
  for (const clase of ['note-meta', 'note-kind']) {
    assert(new RegExp('\\.' + clase + '\\s*\\{').test(CSS_LIMPIO), 'clase sin estilo: ' + clase)
  }
  // Una etiqueta, no un color: un solo acento en el panel (decisión del plan).
  assert(/\.note-kind\s*\{[^}]*color: var\(--muted\)/.test(CSS_LIMPIO), '.note-kind no se colorea por tipo')
  assert(!/\.note-kind\.(?:dato|supuesto|hueco|contradiccion|riesgo)/.test(CSS_LIMPIO), 'ni una regla por kind')

  // «Copiar observaciones»: la prosa numerada tal cual, para pegarla en el
  // comentario de la incidencia o de la página.
  assert(/'Copiar observaciones'/.test(tarjeta), 'la tarjeta viva ofrece copiar')
  assert(/copyNotes\(prosa, copiar\)/.test(tarjeta), 'por copyNotes, con su prosa y su propio botón')
  assert(/const prosa = state\.notesResult\?\.prose \|\| ''/.test(tarjeta), 'la prosa se captura al pintar, no al pulsar')
  assert(tarjeta.indexOf('const prosa =') < tarjeta.indexOf("'Copiar observaciones'"), 'antes de crear el botón')
  assert(/if \(prosa\) \{/.test(tarjeta), 'sin prosa no hay botón que no haga nada')
  const copiar = JS.slice(JS.indexOf('async function copyNotes'), JS.indexOf('function quoteLabel'))
  assert(/copyToClipboard\(prosa, boton\)/.test(copiar), 'y pasa el botón, no un id')
  assert(/'Observaciones copiadas'/.test(copiar) && /log\.ok\(/.test(copiar), 'y queda en el registro')
  assert(/if \(copiado\)/.test(copiar), 'sólo si se copió de verdad')
  assert(/announce\(/.test(copiar), 'y se anuncia al lector de pantalla')

  // La tarjeta de un análisis ANTERIOR no ofrece copiar: su prosa no está en
  // `state.notesResult` (la pasada que trocea no se persiste, §4.4).
  const vieja = JS.slice(JS.indexOf('function staleNotesCard'), JS.indexOf('async function remarkFromAnchors'))
  assert(!/Copiar observaciones|copyNotes\(/.test(vieja), 'staleNotesCard no puede copiar lo que no guardó')

  // Y `copyToClipboard` admite las dos formas, porque la tarjeta se pinta con
  // createElement y no tiene id que buscar.
  const portapapeles = JS.slice(JS.indexOf('async function copyToClipboard'), JS.indexOf('function showContextScreen'))
  assert(/typeof button === 'string' \? \$\(button\) : button/.test(portapapeles), 'id o elemento')
  assert(/return ok/.test(portapapeles), 'y dice si se copió')
})

test('H5: el chat vacío sugiere según el producto Y la Skill, y reserva el sitio de lo que viene', () => {
  // Desde H11 el panel importa además `SUGGESTION_COUNT`: el presupuesto del
  // estado vacío se reparte entre estas tres filas, las de «hoy» y los chips, y
  // el número de las sugerencias lo dice su módulo, no una copia en panel.js.
  assert(/import \{ SUGGESTION_COUNT, suggestionsFor \} from '\.\/suggestions\.js'/.test(JS), 'la rama es pura y vive aparte')
  const vacio = JS.slice(JS.indexOf('function showWelcome'), JS.indexOf('function addUserMessage'))
  assert(/suggestionsFor\(state\.site, state\.skill, state\.sources\)/.test(vacio), 'con el sitio, la Skill y las páginas base')
  eq((vacio.match(/'suggestion'/g) || []).length, 1, 'y una sola fábrica de filas')
  assert(!/suggestionsFor\(site\)/.test(JS) && !/function suggestionsFor/.test(JS), 'la lista ya no se escribe dentro del panel')

  // El presupuesto del estado vacío se decide aquí (docs/PLAN.md §3.4): las
  // filas de «hoy» (H8) van entre la explicación y las sugerencias, y los chips
  // (H11) debajo. Vacíos y ocultos hasta que exista quien los llene.
  assert(/'today hidden'/.test(vacio), 'el hueco de «Qué mirar hoy», oculto')
  assert(/'search-chips hidden'/.test(vacio), 'y el de los chips de búsqueda, oculto')
  assert(
    vacio.indexOf("'today hidden'") < vacio.indexOf("'suggestions'") &&
      vacio.indexOf("'suggestions'") < vacio.indexOf("'search-chips hidden'"),
    'en ese orden: hoy, las tres sugerencias, los chips'
  )
})

test('H5: las consultas a Atlassian se pliegan al terminar en vez de borrarse', () => {
  const pintar = JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('async function readPageDigest('))
  assert(/if \(final && tools\.length\) \{/.test(pintar), 'sólo al terminar y sólo si hubo herramientas')
  assert(/createElement\('details'\)/.test(pintar) && /'tools-fold'/.test(pintar), 'las filas se pliegan en un details')
  assert(/createElement\('summary'\)/.test(pintar), 'con el resumen de siempre como summary')
  assert(/consulta\$\{tools\.length === 1 \? '' : 's'\} a Atlassian/.test(pintar), 'que sigue diciendo cuántas fueron')
  assert(/for \(const row of filas\) fold\.appendChild\(row\)/.test(pintar), 'y las filas van dentro, no a la basura')
  assert(!/\.open = true|setAttribute\('open'/.test(pintar), 'siempre cerrado: restaurar el chat no recrea filas que abrir')
  assert(/\.tools-fold\b/.test(CSS_LIMPIO) && /\.tools-fold > summary\b/.test(CSS_LIMPIO), 'con su estilo')
  // Y el pintado sigue sin enseñar el bloque de anclas: el pin de H1 vale igual.
  assert(/splitAnchorsBlock\(tracker\.text,\s*\{\s*final\s*\}\)/.test(pintar), 'el bloque de anclas nunca se pinta')
})

test('H5: la respuesta se repinta una vez por frame, y el pintado final cancela lo pendiente', () => {
  // `paintTurn` reconstruye la burbuja entera por cada delta y el modelo manda
  // muchos más deltas que frames hay (docs/PLAN.md §2, P2).
  const plan = JS.slice(JS.indexOf('function paintTurnSoon('), JS.indexOf('function noticeNode('))
  assert(/requestAnimationFrame\(pintar\)/.test(plan), 'un frame por tanda')
  assert(/if \(pintadoPendiente\) \{/.test(plan) && /pintadoPendiente\.args = /.test(plan), 'y el tracker más nuevo gana')
  assert(/document\.hidden/.test(plan) && /setTimeout\(pintar, PAINT_HIDDEN_MS\)/.test(plan), 'con el panel oculto no hay frames: respaldo por temporizador')
  assert(/cancelAnimationFrame\(/.test(plan) && /clearTimeout\(/.test(plan), 'y lo pendiente se puede cancelar')
  // C7 de H2: entre el trozo y el frame el chat puede haberse repintado entero.
  assert(/if \(!cuerpo\.isConnected\) return/.test(plan), 'un frame no pinta en una burbuja que ya no está en el documento')

  // `paintTurnSoon` se define FUERA de los trozos que vigilan las demás pruebas
  // (anexo-critica.md:171): después de `readPageDigest`, no entre send y paintTurn.
  assert(JS.indexOf('function paintTurnSoon(') > JS.indexOf('async function readPageDigest('), 'fuera de los slices de send y paintTurn')

  // El pintado definitivo es síncrono y va detrás de la cancelación: un frame
  // que llegara después pintaría una respuesta a medias encima de la buena, o
  // encima del aviso de «Turno cancelado».
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/cancelPaintSoon\(\)/.test(envio), 'el turno cancela lo pendiente al acabar')
  assert(
    envio.indexOf('cancelPaintSoon()') > envio.indexOf('onUpdate: (t) => {') &&
      envio.indexOf('cancelPaintSoon()') < envio.indexOf("cuerpo.appendChild(noticeNode('Turno cancelado.'))"),
    'en cuanto runTurn vuelve, antes de cualquier salida del turno'
  )
  assert(envio.indexOf('cancelPaintSoon()') < envio.indexOf('paintTurn(turn, toolsBox, cuerpo, true)'), 'y antes del pintado final')
})

test('H5: el espejo del panel no copia la paleta, fuerza el tema con data-theme y mide lo que enseña', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')

  // EL CAMBIO: hasta H4 el espejo llevaba la paleta clara escrita a mano para
  // poder mirar el tema claro, y se quedó atrás en cuanto panel.css cambió de
  // tokens (su botón «Claro» enseñaba colores que ya no existían). Ahora enlaza
  // el panel.css real y el tema se fuerza con `data-theme`, que es lo único para
  // lo que existe `:root[data-theme="dark"]`.
  // La comprobación se hace contra la LISTA REAL de tokens de panel.css y contra
  // el `--nombre:` a secas, no contra «--ground:#»: el pin viejo sólo miraba dos
  // nombres y sólo en hexadecimal, así que una paleta copiada en `rgb()`, en
  // `hsl()` o con cualquier otro token pasaba de largo (revisión adversaria de
  // H5). Usar los tokens con `var(--x)` sí vale: es justo lo que el espejo hace.
  const estilos = [...espejo.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  const tokens = [...(/:root\s*\{([\s\S]*?)\n\}/.exec(CSS_LIMPIO)?.[1] || '').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
  for (const obligatorio of ['--ground', '--surface', '--surface-2', '--ink', '--ink-2', '--muted', '--hairline', '--hairline-strong', '--gold', '--gold-bg', '--gold-line', '--mark', '--mark-strong', '--on-mark', '--ok', '--danger', '--danger-bg', '--line', '--line-2', '--teal', '--clay', '--clay-bg']) {
    assert(tokens.includes(obligatorio), 'la lista sale del :root de panel.css y ahí falta ' + obligatorio)
  }
  const copiados = tokens.filter((t) => new RegExp(t + '\\s*:').test(estilos))
  eq(copiados, [], 'el espejo no DECLARA ningún token del panel; los usa con var()')
  assert(espejo.includes('href="/src/panel/panel.css"'), 'el espejo enlaza el CSS real del panel')
  assert(espejo.includes('dataset.theme'), 'el tema se fuerza poniendo data-theme')
  assert(/:root\[data-theme="dark"\]/.test(CSS_LIMPIO), 'y panel.css tiene ese bloque para que gane en las dos direcciones')

  // `faroPreview` es la única de las tres verificaciones del rediseño que MIDE
  // algo: lo que hay que comprobar en cada captura, con su nombre, para que la
  // PR diga números y no impresiones.
  assert(espejo.includes('window.faroPreview = {'), 'los mandos del espejo son API')
  const medida = espejo.slice(espejo.indexOf('function check() {'), espejo.indexOf('function pintarMedidas('))
  for (const clave of ['ok', 'overflowX', 'topHeight', 'composerMetaHeight', 'screenHeadsVisible', 'emptyStateRows', 'chipRows', 'chipsClipped', 'emptyFits']) {
    assert(new RegExp('\\b' + clave + '\\b').test(medida), `check() mide ${clave}`)
  }
  // Y los MIDE: devolver un nombre que ya no se calcula deja el resultado con
  // una clave y sin número (y el espejo reventando al mirarla).
  for (const medido of ['chipRows', 'chipsClipped', 'emptyFits']) {
    assert(new RegExp('const ' + medido + ' =').test(medida), `check() calcula ${medido}, no sólo lo devuelve`)
  }
  // El veredicto, condición a condición y contadas: una regex de una sola línea
  // dejó de valer cuando H8 añadió las dos suyas, y lo que hay que impedir es
  // que alguna se caiga o que entre un término que lo ponga verde por su cuenta.
  // El corte es hasta el `return {` a secas: desde H11 el resultado tiene doce
  // claves y no cabe en una línea, y con el corte viejo («return { ok,») el
  // indexOf daba -1, el trozo se comía el objeto devuelto entero y el
  // `!veredicto.includes('chipRows')` de abajo fallaba por donde no era.
  const veredicto = medida.slice(medida.indexOf('const ok ='), medida.indexOf('return {'))
  for (const condicion of [
    'presente',
    '!overflowX',
    'topHeight <= 48',
    'composerMetaHeight <= 36',
    'screenHeadsVisible',
    'emptyStateRows <= 3',
    'chipsClipped === 0',
    'emptyFits',
  ]) {
    assert(veredicto.includes(condicion), `el veredicto tiene que mirar ${condicion}`)
  }
  eq(veredicto.match(/&&/g)?.length, 7, 'y nada más: ocho condiciones y ninguna suelta')
  assert(!veredicto.includes('||'), 'y ninguna se puede saltar con un «o»: un «|| true» dejaría el veredicto verde siempre')
  // `chipRows` es un NÚMERO y no una condición: a 320 px cuatro chips con
  // etiquetas de verdad no caben en una línea (panel.css los envuelve a
  // propósito), así que lo que falla es que el estado vacío no quepa —eso es
  // `emptyFits`— y el número está para ver el coste en la captura.
  assert(!veredicto.includes('chipRows'), 'las filas de chips se imprimen, no se juzgan')

  // Que haya panel es lo PRIMERO: un selector que no casa medía 0 px y 0 ≤ 48,
  // así que el espejo sobre un documento vacío —el fallo que H5 tuvo de
  // verdad— devolvía `ok: true` sin nada que medir (revisión adversaria de H5).
  assert(/\['#app', '\.top', '\.composer-meta'\]\.filter\(\(s\) => !doc\.querySelector\(s\)\)/.test(medida), 'las tres piezas tienen que existir')
  assert(/topHeight < 1 \|\| composerMetaHeight < 1/.test(medida), 'y medir algo: un 0 px no es «cabe de sobra»')
  assert(/const presente = !motivo/.test(medida) && /return \{\s*ok,\s*motivo,/.test(medida), 'y la ausencia sale con su motivo en el resultado')

  // Las dos conversaciones: la de Confluence de siempre y la de Jira, que es la
  // que enseña las ocho observaciones con su clase, la que no se pudo situar, la
  // que habla de la incidencia en general, el aviso rojo y la tarjeta atenuada.
  assert(espejo.includes('SIMPL-1234'), 'la segunda conversación es una incidencia de Jira')
  for (const pieza of [
    'note-kind',
    "' unanchored'",
    "' missing'",
    'Copiar observaciones',
    "'notice' + (malo ? ' bad' : '')",
    'nav-card perm-card',
    'nav-card notes-card stale',
    "'tools-fold'",
    "'today hidden'",
  ]) {
    assert(espejo.includes(pieza), `el espejo enseña ${pieza}`)
  }
  // El quinto botón de la cabecera era un HUECO hasta H11, que lo llenó con
  // «Qué mirar hoy». Desde entonces el espejo no fabrica ningún bulto: el botón
  // viene en panel.html —que es lo que el espejo carga— y lo único que hay que
  // pintarle es su insignia, que es lo que ahora enciende y apaga `setFifth`.
  // Las dos formas del atributo: el `dataset.hueco` con el que se escribía y el
  // `data-hueco` con el que se buscaba.
  assert(!/data-hueco|dataset\.hueco/.test(espejo), 'el espejo ya no fabrica un hueco: el quinto botón es el de verdad')
  assert(htmlIds.has('btn-today'), 'y ese quinto botón es «Qué mirar hoy» (H11)')
  const quinto = espejo.slice(espejo.indexOf('function pintarQuinto()'), espejo.indexOf('function filasDeHoy()'))
  assert(/\$\('today-count'\)/.test(quinto) && /\$\('btn-today'\)/.test(quinto), 'y lo que pinta son la insignia y el botón reales')
})

// Restauración por ventana y peso de la sesión (pasos 4 y 6 del anexo E, P6b).

test('H6 P6b: la conversación se restaura por ventana, y el chat dice cuándo la ha recortado', () => {
  // `listMessages` sin `limit` bajaba la sesión ENTERA cada vez que se abre el
  // panel, se vuelve al sitio o se sube un contexto: 7 mensajes eran 4 890 KB
  // contra un servidor desechable, y de todo eso el chat pinta sólo el texto
  // (docs/PLAN.md §2.6 P6b).
  const restaurar = JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome'))
  const codigo = sinComentarios(restaurar)
  assert(
    /async function restoreConversation\(testigo = state\.bootToken, \{ all = false \} = \{\}\)/.test(codigo),
    'el testigo sigue siendo el PRIMER parámetro: «ver toda la conversación» no puede colarse en su sitio'
  )
  assert(/listMessages\(state\.sessionID, all \? undefined : RESTORE_LIMITS\.messages\)/.test(codigo), 'se piden los últimos N, salvo que se pidan todos')
  // El orden de salida de `?limit=N` se comprobó en integración (ascendente),
  // pero se asegura aquí igual: el panel no puede depender de eso.
  assert(/sortMessages\(/.test(codigo), 'y se ordenan por su hora de creación')
  assert(/dropOrphans\(/.test(codigo), 'y se tiran las respuestas huérfanas del corte')
  assert(/dropOrphans\(sortMessages\(/.test(codigo), 'ordenar primero: cuál es el primer `user` sólo se sabe con la lista en orden')
  assert(
    /import \{ suggestsAnotherModel, sortMessages, dropOrphans, toolOutputSize \} from '\.\.\/opencode\/turn\.js'/.test(JS),
    'las dos puras salen de turn.js, donde tienen su test'
  )

  // La fila de arriba: se pinta DESPUÉS de vaciar el chat y ANTES de los
  // mensajes, o quedaría en medio de la conversación.
  assert(/'Conversación recortada'/.test(codigo), 'y queda en el registro')
  assert(/el\.chat\.appendChild\(olderTurnsRow\(\)\)/.test(codigo), 'la fila va al chat')
  assert(
    codigo.indexOf("el.chat.textContent = ''") < codigo.indexOf('olderTurnsRow()') &&
      codigo.indexOf('olderTurnsRow()') < codigo.indexOf('for (const m of messages'),
    'entre vaciar el chat y pintar los mensajes'
  )
  const fila = JS.slice(JS.indexOf('function olderTurnsRow('), JS.indexOf('async function restoreConversation'))
  // La regla, no el nombre suelto: `.older-turns-loquesea {` también contiene
  // «.older-turns» y dejaría la fila sin estilo con el pin en verde.
  assert(/'older-turns'/.test(fila) && /\.older-turns\s*\{/.test(CSS_LIMPIO), 'con su clase y su estilo')
  assert(/'btn-older-turns'/.test(fila) && /'Ver toda la conversación'/.test(fila), 'y su botón')
  assert(/'ghost small ' \+ NEEDS_IDLE/.test(fila), 'que es secundario: la conversación ya está ahí')
  assert(/restoreConversation\(state\.bootToken, \{ all: true \}\)/.test(fila), 'que vuelve a pedirla entera')
  assert(/RESTORE_LIMITS\.messages/.test(fila), 'y dice cuántos mensajes se están enseñando, sin escribir el número a mano')
  // El botón se crea con el chat, que se vacía en cada restauración: no puede
  // estar además en el HTML, o habría dos con el mismo id.
  assert(!htmlIds.has('btn-older-turns'), 'la fila es del chat, no del marco: su id no se declara en panel.html')
  assert(!/\$\('btn-older-turns'\)/.test(JS), 'ni se busca por id: el manejador se ata al crearlo')

  // Y lo restaurado entra sin animarse: hasta 60 burbujas de golpe, ninguna
  // nueva. Se marca por mensaje y no con una clase en el chat, porque entre
  // ponerla y quitarla no hay ningún await y el navegador no la vería.
  assert(/function markIfRestored\(d\)/.test(JS) && /if \(state\.restoring\) d\.classList\.add\('restored'\)/.test(JS), 'el mensaje restaurado se marca al crearlo')
  for (const fn of ['function addUserMessage(', 'function addAssistantMessage(']) {
    const cuerpoFn = JS.slice(JS.indexOf(fn), JS.indexOf('\n}', JS.indexOf(fn)))
    assert(/markIfRestored\(d\)/.test(cuerpoFn), fn + ' marca la burbuja que crea')
  }
  assert(/\.msg\.restored\s*\{[^}]*animation: none/.test(CSS_LIMPIO), 'y el CSS la deja quieta')
  assert(!/\.chat\.restoring\b/.test(CSS_LIMPIO), 'no por una clase en el chat, que nunca llegaría a verse')

  // Y el espejo la enseña, con el mismo texto y en el mismo sitio: arriba del
  // todo de la conversación larga, antes de la primera pregunta.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(/'older-turns'/.test(espejo) && /'Ver toda la conversación'/.test(espejo), 'el espejo enseña la fila')
  assert(/se enseñan los últimos 60 mensajes\./.test(espejo), 'con el número que hoy dice RESTORE_LIMITS')
  const jira = espejo.slice(espejo.indexOf('function conversacionJira()'), espejo.indexOf('function estadoVacio()'))
  assert(
    jira.indexOf('filaConversacionLarga()') > -1 && jira.indexOf('filaConversacionLarga()') < jira.indexOf('burbujaUsuario('),
    'y va antes de la primera pregunta, no en medio de la conversación'
  )
})

test('H6 P6b: el panel sabe lo que arrastra la conversación y lo dice una vez', () => {
  // Las salidas de las herramientas se quedan en la sesión y viajan en CADA
  // turno siguiente. opencode poda las viejas, pero los últimos 40 000 tokens
  // no se tocan: pasado el umbral, lo barato es empezar una sesión nueva.
  assert(/sessionToolChars: 0/.test(JS) && /heavyWarned: false/.test(JS), 'el contador y el aviso viven en el estado, no en disco')

  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  const codigo = sinComentarios(envio)
  assert(/await trackSessionWeight\(salidaTools, bubble\)/.test(codigo), 'se acumula lo que devolvieron las herramientas de ESTE turno')
  assert(
    codigo.indexOf('trackSessionWeight(') > codigo.indexOf('warnAboutSources(') &&
      codigo.indexOf('trackSessionWeight(') < codigo.indexOf("cron.mark('pintar')"),
    'con lo demás que cuelga de la respuesta, antes de cerrar la fase que lo mide'
  )
  assert(
    codigo.indexOf('const salidaTools = toolOutputSize(turn.parts)') < codigo.indexOf('trackSessionWeight('),
    'el mismo número que registra «Respuesta recibida»'
  )

  const peso = JS.slice(JS.indexOf('async function trackSessionWeight('), JS.indexOf('function heavySessionNotice('))
  const pesoCodigo = sinComentarios(peso)
  assert(/setSessionWeight\(host, state\.sessionToolChars\)/.test(pesoCodigo), 'y se guarda en storage.session, para que sobreviva a cerrar el panel')
  assert(/state\.sessionToolChars < SESSION_LIMITS\.heavyToolChars/.test(pesoCodigo), 'el umbral sale de config.js')
  assert(/if \(state\.heavyWarned \|\|/.test(pesoCodigo), 'y el aviso es uno por sesión, no uno por turno')
  assert(/state\.heavyWarned = true/.test(pesoCodigo))
  assert(/'Conversación pesada'/.test(pesoCodigo) && /log\.warn\(/.test(pesoCodigo), 'queda en el registro')
  assert(/attachToBubble\(bubble, heavySessionNotice\(\)\)/.test(pesoCodigo), 'y cuelga de la respuesta, con el salvavidas de siempre')
  // El peso es de ESTE host: si el panel ya está en otro, no se escribe el suyo.
  assert(/const host = state\.site\?\.host \?\? state\.lastHost/.test(pesoCodigo) && /if \(!host\) return/.test(pesoCodigo))

  const aviso = JS.slice(JS.indexOf('function heavySessionNotice('), JS.indexOf('async function growIndex'))
  assert(/noticeNode\(/.test(aviso) && /formatBytes\(state\.sessionToolChars\)/.test(aviso), 'dice cuánto arrastra, en la misma unidad que el Registro')
  assert(/opencode recorta las más antiguas/.test(aviso), 'y que el servidor ya poda: el aviso no puede sonar a fallo')
  assert(/'nav-actions'/.test(aviso) && /'Sesión nueva'/.test(aviso), 'con la salida a mano')
  assert(/newSession\(\)/.test(aviso), 'que es la misma de la cabecera')
  assert(/state\.settings\.crossSessionMemory/.test(aviso), 'y sólo promete el resumen si la memoria está activa')

  // Cerrar la sesión pone el contador a cero: la siguiente empieza limpia.
  const nueva = JS.slice(JS.indexOf('async function newSession('))
  assert(/clearSessionWeight\(state\.site\.host\)/.test(nueva), 'se borra también del almacén')
  assert(/state\.sessionToolChars = 0/.test(nueva) && /state\.heavyWarned = false/.test(nueva))

  // Y olvidar el sitio lo borra igual: su sesión se cierra ahí mismo y dejar el
  // peso contaría la conversación de antes contra la de después (revisión
  // adversaria de H6). Desde H13 la clave se la lleva `forgetEverythingFor` con
  // las demás de `session` —lo pina storage.test.js recorriendo STORAGE_KEYS—, y
  // aquí lo que queda por comprobar es el contador EN MEMORIA, que ése no lo
  // puede vaciar el almacén.
  const olvidar = sinComentarios(JS.slice(JS.indexOf("$('btn-forget')"), JS.indexOf('// --- memoria')))
  assert(/forgetEverythingFor\(host\)/.test(olvidar), 'olvidar el sitio pasa por la única puerta de borrado')
  assert(/state\.sessionToolChars = 0/.test(olvidar) && /state\.heavyWarned = false/.test(olvidar))
  const areas = readFileSync(join(ROOT, 'src/shared/config.js'), 'utf8')
  assert(/sessionWeight: 'session'/.test(areas), 'y su clave dice que vive en storage.session, que es de dónde se borra')

  // Y al cambiar de sitio, como los tiempos: el peso es de la sesión de ESE host.
  const refresco = JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite'))
  const cambio = refresco.slice(refresco.indexOf('if (changedHost) {'), refresco.indexOf('state.site = site'))
  assert(/state\.sessionToolChars = 0/.test(cambio) && /state\.heavyWarned = false/.test(cambio), 'al cambiar de sitio el contador se vacía')

  // Al restaurar se recupera: lo guardado de la sesión y lo que se ve en la
  // ventana, lo que sea mayor (una sesión anterior a H6 no tiene nada guardado).
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome')))
  assert(/getSessionWeight\(host\)/.test(restaurar), 'el peso guardado vuelve con la conversación')
  assert(/toolOutputSize\(m\.parts\)/.test(restaurar), 'y se recuenta lo que trae la ventana')
  assert(/state\.sessionToolChars = Math\.max\(pesoGuardado, deLaVentana\)/.test(restaurar), 'el contador nunca baja por haber pedido menos mensajes')
  assert(/state\.heavyWarned = false/.test(restaurar), 'y el aviso vuelve a quedar por dar: el que hubiera se fue con el chat repintado')

  // El espejo lo enseña con el mismo texto, colgando de la respuesta como lo
  // cuelga `attachToBubble`: es donde se mira si se lee o si se ignora.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(/opencode recorta las más antiguas/.test(espejo) && /'Sesión nueva'/.test(espejo), 'el espejo enseña el aviso y su botón')
  const jira = espejo.slice(espejo.indexOf('function conversacionJira()'), espejo.indexOf('function estadoVacio()'))
  assert(/b1\.appendChild\(avisoConversacionPesada\(\)\)/.test(jira), 'dentro de la última respuesta, no suelto en el chat')
})

// Turno y registro (resto del paso 5 y paso 10 del anexo E: P2, P3 y P8).

test('H6 P2: el turno dice cuándo el modelo lleva callado, y lo retira en cuanto vuelve a llegar algo', () => {
  // 45 s de silencio y 45 s leyendo tres páginas con el MCP se veían igual
  // («pensando…»), y el usuario no tenía con qué decidir si esperar o parar. El
  // plazo no cambia: a los 90 s pasa lo de siempre.
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  assert(/onWarn: \(ms\) => \{/.test(envio), 'send le pasa un onWarn a runTurn')
  assert(
    /setStatus\('busy', `pensando… \$\{Math\.round\(ms \/ 1000\)\} s sin señales del modelo`\)/.test(envio),
    'que lo dice donde el estado ya dice «pensando…», con los segundos que lleva callado'
  )
  assert(/let silencioso = false/.test(envio), 'y se apunta que el estado está hablando del silencio')
  // En cuanto llega cualquier señal visible, el aviso se retira: dejarlo puesto
  // sería decir «sin señales» mientras se escribe la respuesta.
  const trozo = envio.slice(envio.indexOf('onUpdate: (t) => {'), envio.indexOf('paintTurnSoon(t, toolsBox, body)'))
  assert(/if \(silencioso\) \{\s*silencioso = false\s*setStatus\('busy', 'pensando…'\)/.test(trozo), 'lo primero que hace el trozo siguiente es quitarlo')
  // El aviso no toca el chat ni el registro: lo que pasa a los 90 s ya se
  // registra («Turno colgado»), y un aviso por turno en el registro sería ruido.
  assert(!/sin señales[\s\S]*?(noticeNode|announce)\(/.test(envio.slice(envio.indexOf('onWarn:'), envio.indexOf('onUpdate:'))), 'sin aviso en el chat')
  assert(!/log\.\w+\([^)]*sin señales/.test(envio), 'ni en el registro')
})

test('H6 P3: el índice se escribe UNA vez por turno y bajo el host que lo aprendió', () => {
  // Tres escrituras del índice entero por turno (las herramientas, el árbol de
  // la barra lateral, el camino del planificador) para dejar lo mismo en disco:
  // hasta 43 KB serializados tres veces (docs/PLAN.md §2.6, P3).
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  eq(envio.match(/persistIndex\(\)/g).length, 1, 'una sola escritura, y en un solo sitio del turno')
  assert(!/saveIndex\(/.test(envio), 'el turno no escribe el índice por su cuenta')
  assert(envio.indexOf('await growTreeFromPage()') < envio.indexOf('await persistIndex()'), 'después de todo lo que lo hace crecer')
  assert(envio.indexOf('await offerNavigation(') < envio.indexOf('await persistIndex()'), 'incluido el camino que el planificador lee de la API')

  // Y en Análisis las marcas van ANTES del índice: la tarjeta de observaciones es
  // lo que el usuario está esperando. `offerNotes` no hace nada en los demás
  // modos, así que la tarjeta de navegación sigue yendo detrás del índice, que es
  // lo único que necesita que esté crecido.
  assert(envio.indexOf('await offerNotes(') < envio.indexOf('await growIndex(turn.parts,'), 'las marcas, antes del índice')
  assert(envio.indexOf('await growIndex(turn.parts,') < envio.indexOf('await offerNavigation('), 'la navegación, detrás')
  // Y las fases siguen midiendo lo que dicen: «marcas» es offerNotes y «índice»
  // lo que crece, cada una cerrada donde acaba su trabajo (H3).
  assert(envio.indexOf("cron.mark('marcas')") < envio.indexOf('await growIndex(turn.parts,'), '«marcas» cierra en offerNotes')
  assert(envio.indexOf("cron.mark('pintar')") < envio.indexOf('await offerNotes('), 'y «pintar» sigue cerrando antes')

  // Los tres sitios que hacen crecer el índice sólo lo APUNTAN.
  const cosecha = sinComentarios(JS.slice(JS.indexOf('async function growIndex'), JS.indexOf('async function growTreeFromPage')))
  assert(/markIndexDirty\(index, site\.host\)/.test(cosecha) && !/saveIndex\(/.test(cosecha), 'lo que devolvieron las herramientas se apunta, no se escribe')
  const arbol = sinComentarios(JS.slice(JS.indexOf('async function growTreeFromPage'), JS.indexOf('function markIndexDirty')))
  assert(/markIndexDirty\(merged\)/.test(arbol) && !/saveIndex\(/.test(arbol), 'el árbol de la barra lateral, igual')
  const nav = sinComentarios(JS.slice(JS.indexOf('async function offerNavigation'), JS.indexOf('async function learnAncestry')))
  assert(/onIndex: \(enriquecido\) => \{\s*state\.index = enriquecido\s*markIndexDirty\(enriquecido\)/.test(nav), 'y el camino del planificador')
  assert(!/saveIndex\(/.test(nav), 'que tampoco escribe a mitad de turno')

  // Lo apuntado va con SU host: entre aprender y guardar hay un turno del
  // planificador y una segunda pasada de notas, y en ese hueco el panel puede
  // haberse ido a otro sitio (C2 de H2).
  const apuntar = sinComentarios(JS.slice(JS.indexOf('function markIndexDirty'), JS.indexOf('async function persistIndex')))
  assert(/function markIndexDirty\(index, host = state\.site\?\.host \?\? state\.lastHost\)/.test(apuntar), 'el host se captura al apuntar, o lo pone quien lo sabe')
  assert(/state\.indexDirty = \{ host, index \}/.test(apuntar), 'junto al índice que se aprendió')
  const escribir = sinComentarios(JS.slice(JS.indexOf('async function persistIndex'), JS.indexOf('function warnAboutSources')))
  assert(/const pendiente = state\.indexDirty/.test(escribir) && /state\.indexDirty = null/.test(escribir), 'y se consume al escribir')
  assert(/await saveIndex\(host, aGuardar\)/.test(escribir), 'se guarda bajo el host apuntado')
  assert(!/saveIndex\(state\./.test(escribir), 'nunca bajo el de ahora: es lo único que impide escribir el índice de un sitio en la clave de otro')
  assert(/'Índice guardado'/.test(escribir), 'y queda en el registro, una vez por turno')
  assert(/'Índice sin guardar'/.test(escribir) && /state\.indexDirty = state\.indexDirty \|\| pendiente/.test(escribir), 'un fallo de cuota se dice y se vuelve a apuntar, no tapa la respuesta')
  assert(/indexDirty: null/.test(JS), 'el apunte vive en el estado, no en disco')

  // Y olvidar el sitio olvida también lo apuntado: si no, el turno siguiente
  // volvería a escribir el índice que el usuario acaba de tirar.
  const olvidar = sinComentarios(JS.slice(JS.indexOf("$('btn-forget')"), JS.indexOf('// --- memoria')))
  assert(/state\.index = null/.test(olvidar) && /state\.indexDirty = null/.test(olvidar), 'olvidar el sitio tira el índice y su apunte')
})

test('H6: un turno que acaba mal conserva sus consultas, y copiar dos veces no deja el botón en «Copiado»', () => {
  // Las dos son límites que anotó la revisión de H5 y que son de este trozo.
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  eq(envio.match(/keepToolsFolded\(turn, toolsBox\)/g).length, 3, 'las tres salidas: colgado, cancelado y fallido')
  assert(!/toolsBox\.remove\(\)/.test(envio), 'ninguna tira las filas con la caja: eran la única forma de ver QUÉ consulta falló (§8.14)')

  const guardar = sinComentarios(JS.slice(JS.indexOf('function keepToolsFolded('), JS.indexOf('async function readPageDigest(')))
  assert(/if \(!turn\.tools\?\.length\) return toolsBox\.remove\(\)/.test(guardar), 'sin consultas la caja se va: un hueco vacío no dice nada')
  assert(/toolsBox\.appendChild\(toolsFold\(turn\.tools\)\)/.test(guardar), 'y con consultas, el mismo plegado del final feliz')
  const pintar = sinComentarios(JS.slice(JS.indexOf('function paintTurn('), JS.indexOf('function toolRow(')))
  assert(/toolsBox\.appendChild\(toolsFold\(tools\)\)/.test(pintar), 'que sale de la misma fábrica')
  assert(/for \(const t of tools\) toolsBox\.appendChild\(toolRow\(t\)\)/.test(pintar), 'y las filas en vuelo, de la misma fábrica de filas')

  // Dos clics en «Copiar observaciones» en menos de 1400 ms dejaban el botón
  // diciendo «Copiado» para siempre: el segundo leía «Copiado» como su texto de
  // siempre y lo restauraba.
  const portapapeles = sinComentarios(JS.slice(JS.indexOf('const textoDeCopiar = new WeakMap()'), JS.indexOf('function showContextScreen')))
  assert(
    /if \(btn && !textoDeCopiar\.has\(btn\)\) textoDeCopiar\.set\(btn, \{ original: btn\.textContent, timer: 0 \}\)/.test(portapapeles),
    'el texto propio del botón se guarda UNA vez'
  )
  assert(!/const original = btn\?\.textContent/.test(portapapeles), 'y no se vuelve a leer en el segundo clic')
  assert(/if \(marca\?\.timer\) clearTimeout\(marca\.timer\)/.test(portapapeles), 'el temporizador pendiente se cancela')
  assert(/btn\.textContent = marca\.original/.test(portapapeles) && /textoDeCopiar\.delete\(btn\)/.test(portapapeles), 'y al restaurar se olvida el botón')
  assert(/setTimeout\([\s\S]*?, COPY_FEEDBACK_MS\)/.test(portapapeles), 'con el plazo en una constante, no repetido')
})

test('H6 P8: el Registro mete la línea nueva arriba en vez de repintar las doscientas', () => {
  const abrir = sinComentarios(JS.slice(JS.indexOf('function showLogScreen'), JS.indexOf('const LOG_ROWS')))
  assert(/log\.subscribe\(\(entry\) => \{/.test(abrir), 'la suscripción recibe la entrada nueva')
  assert(/if \(\$\('screen-log'\)\.classList\.contains\('hidden'\)\) return/.test(abrir), 'con la pantalla cerrada no se pinta nada')
  assert(/if \(entry\) appendLogRow\(entry\)\s*else paintLog\(\)/.test(abrir), 'una entrada se inserta; un log.clear() —que avisa SIN entrada— repinta')

  const nueva = sinComentarios(JS.slice(JS.indexOf('function appendLogRow('), JS.indexOf('function logRow(')))
  assert(/box\.prepend\(logRow\(e\)\)/.test(nueva), 'la fila va arriba, que es donde está la más nueva')
  assert(!/textContent = ''/.test(nueva), 'sin vaciar la lista: eso era el repintado que se quita')
  assert(/LEVELS\[e\.level\] \?\? 0\) < LEVELS\.warn/.test(nueva), 'el filtro «sólo problemas» se aplica con la misma tabla de niveles que paintLog')
  assert(/import \{ LEVELS, log \} from '\.\.\/shared\/log\.js'/.test(JS), 'que viene de log.js, donde vive')
  assert(/while \(box\.childElementCount > LOG_ROWS\) box\.lastElementChild\.remove\(\)/.test(nueva), 'y la lista no crece sin fin con el panel abierto horas')

  const entero = sinComentarios(JS.slice(JS.indexOf('function paintLog('), JS.indexOf('function appendLogRow(')))
  assert(/box\.textContent = ''/.test(entero) && /entries\.slice\(-LOG_ROWS\)\.reverse\(\)/.test(entero), 'el repintado entero se queda para abrir la pantalla y cambiar el filtro')
  assert(/box\.appendChild\(logRow\(e\)\)/.test(entero), 'con la misma fábrica de filas que la inserción')
  assert(/state\.logOnlyProblems = false; paintLog\(\)/.test(JS) && /state\.logOnlyProblems = true; paintLog\(\)/.test(JS), 'y los dos botones del filtro repintan entero: son dos listas distintas')

  // Y la lista incremental no se queda con filas que el registro ya olvidó: el
  // tope de 200 filas no se dispara nunca con «sólo problemas» puesto —cinco
  // avisos entre seiscientas entradas siguen siendo cinco filas—, así que a
  // partir de las 400 entradas del Logger la pantalla enseñaba líneas que
  // `paintLog()` ya no pintaría (revisión adversaria de H6).
  assert(/row\.dataset\.id = e\.id/.test(sinComentarios(JS.slice(JS.indexOf('function logRow('), JS.indexOf('async function paintState(')))), 'cada fila lleva el id de su entrada')
  assert(/const vivas = log\.oldestId/.test(nueva), 'y la inserción pregunta cuál es la más vieja que el registro conserva')
  assert(
    /while \(box\.lastElementChild && Number\(box\.lastElementChild\.dataset\.id\) < vivas\) box\.lastElementChild\.remove\(\)/.test(nueva),
    'las filas cuya entrada ya no está en el registro se quitan por abajo'
  )
  assert(
    nueva.indexOf('const vivas = log.oldestId') < nueva.indexOf('state.logOnlyProblems &&'),
    'y esa poda va antes del filtro: una entrada que no se pinta empuja igual el tope del registro'
  )
})

// --- Revisión adversaria de H6: doce hallazgos verificados ------------------

test('H6 revisión: un botón que cuelga del chat y necesita el turno parado nace desactivado y vuelve al acabar', () => {
  // Los dos se pintan DENTRO del turno (`heavySessionNotice` cuelga de la
  // respuesta que destapó el peso), con `state.streaming` todavía en true, y su
  // manejador empieza por «si se está respondiendo, nada»: nacían muertos y sin
  // decirlo, durante segundos o minutos (`offerNotes` puede lanzar una pasada
  // entera del modelo).
  assert(/const NEEDS_IDLE = 'needs-idle'/.test(JS), 'la clase gancho vive en una constante')

  const aviso = sinComentarios(JS.slice(JS.indexOf('function heavySessionNotice('), JS.indexOf('async function growIndex')))
  assert(/btn\.className = 'primary ' \+ NEEDS_IDLE/.test(aviso), 'el «Sesión nueva» del aviso lleva la clase')
  assert(/btn\.disabled = state\.streaming/.test(aviso), 'y nace desactivado si el turno sigue en vuelo')
  assert(/if \(state\.streaming\) return/.test(aviso), 'la guarda del manejador se queda: el botón puede pulsarse en el cambio')

  const fila = sinComentarios(JS.slice(JS.indexOf('function olderTurnsRow('), JS.indexOf('async function restoreConversation')))
  assert(/btn\.className = 'ghost small ' \+ NEEDS_IDLE/.test(fila), '«Ver toda la conversación», igual')
  assert(/btn\.disabled = state\.streaming/.test(fila))

  // Y quien los reactiva es el mismo que reactiva «Sesión nueva» de la cabecera.
  const streaming = sinComentarios(JS.slice(JS.indexOf('function setStreaming('), JS.indexOf('function showBusy(')))
  assert(/\$\('btn-new-session'\)\.disabled = on/.test(streaming), 'el de la cabecera sigue igual')
  assert(
    /for \(const b of el\.chat\.querySelectorAll\('\.' \+ NEEDS_IDLE\)\) b\.disabled = on/.test(streaming),
    'y los del chat se desactivan y se reactivan con él'
  )
})

test('H6 revisión: «Ver toda la conversación» no pisa un turno en vuelo, ni una sesión que ya no es', () => {
  // `restoreConversation` vacía el chat: a mitad de respuesta la burbuja viva
  // se quedaba fuera del documento (con sus consultas plegadas dentro) y el
  // turno seguía pintando en el vacío.
  const fila = sinComentarios(JS.slice(JS.indexOf('function olderTurnsRow('), JS.indexOf('async function restoreConversation')))
  assert(/if \(state\.streaming\) \{/.test(fila), 'el clic que llegue en el cambio tampoco pasa')
  assert(/showNotice\('Espera a que termine la respuesta\.', false, \{ force: true \}\)/.test(fila), 'y se dice, con `force`: el aviso contesta a un clic')
  assert(fila.indexOf('if (state.streaming) {') < fila.indexOf('restoreConversation('), 'antes de pedir nada')

  // Y si mientras se descarga la conversación entera se abre una sesión nueva,
  // lo que ha llegado es la conversación VIEJA: pintarla sería resucitarla.
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome')))
  assert(/const sesion = state\.sessionID/.test(restaurar), 'la sesión se captura antes de pedir los mensajes')
  assert(restaurar.indexOf('const sesion = state.sessionID') < restaurar.indexOf('listMessages('), 'antes del await')
  assert(/if \(leyo && state\.sessionID !== sesion\) return/.test(restaurar), 'y al volver se abandona si ya es otra')
  assert(
    restaurar.indexOf('if (leyo && state.sessionID !== sesion) return') < restaurar.indexOf("el.chat.textContent = ''"),
    'sin tocar el chat: la comprobación va ANTES de vaciarlo'
  )
  assert(/leyo = false/.test(restaurar), 'y una lectura que falla —que olvida la sesión ella misma— no cuenta como cambio')
})

test('H6 revisión: pedir lo anterior no devuelve al usuario al fondo del chat', () => {
  // Con `all` el chat se repinta entero y acababa en `scrollChat({ force: true })`:
  // se pedía ver lo de arriba y la vista saltaba justo a donde ya estaba.
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome')))
  assert(/const previas = all \? el\.chat\.querySelectorAll\('\.msg'\)\.length : 0/.test(restaurar), 'se cuenta lo que había pintado al pulsar')
  assert(restaurar.indexOf('const previas = all') < restaurar.indexOf('listMessages('), 'antes de pedir nada, que es cuando se pulsó')
  assert(/const ancla = msgs\[msgs\.length - previas\]/.test(restaurar), 'y la vista se ancla al primero de ellos')
  assert(/ancla\.scrollIntoView\(\{ block: 'start' \}\)/.test(restaurar), 'sin animación: es una restauración, no un movimiento')
  assert(/state\.chatPinned = false/.test(restaurar), 'y el chat deja de estar pegado al fondo')
  assert(/scrollChat\(\{ force: true \}\)/.test(restaurar), 'sin `all`, como siempre')
})

test('H6 revisión: saltarse la pantalla de contexto apaga el arranque que la estaba decidiendo', () => {
  // `bootForSite` decide la pantalla de contexto con el `onboarded` que leyó al
  // EMPEZAR (P4), y el `GET /mcp` en frío tarda segundos: «Omitir» lo escribía
  // sin rearrancar, y el arranque lento volvía a enseñar la pantalla recién
  // saltada. Un testigo nuevo lo apaga y el chat se pinta UNA sola vez.
  const eventos = JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys'))
  const omitir = sinComentarios(eventos.slice(eventos.indexOf("$('choice-skip')"), eventos.indexOf("$('context-file').addEventListener")))
  assert(/saveSite\(state\.site\.host, \{ onboarded: true \}\)/.test(omitir), 'sigue escribiendo onboarded')
  assert(/state\.bootToken = \{\}/.test(omitir), 'y apaga el arranque en curso con un testigo nuevo')
  assert(omitir.indexOf('state.bootToken = {}') < omitir.indexOf('restoreConversation()'), 'antes de repintar: si no, el arranque viejo repintaría encima')
  assert(!/bootForSite\(\)/.test(omitir), 'y no rearranca: eso pintaría el chat dos veces')

  // Lo mismo el contexto que se sube a mano, que escribe el mismo `onboarded`.
  const subir = sinComentarios(JS.slice(JS.indexOf('async function uploadContext'), JS.indexOf('async function newSession')))
  assert(/state\.bootToken = \{\}/.test(subir), 'subir un contexto también apaga el arranque que lo decidiría al revés')

  // Y el comentario de bootForSite ya no promete que nada lo cambie a mitad.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext'))
  assert(!/durante el arranque no hay nada que lo cambie/.test(arranque), 'el comentario decía algo que no era verdad')
  assert(/apagan este arranque/.test(arranque), 'y ahora dice qué pasa de verdad')
})

test('H6 revisión: lo que se cosecha al final del turno se cosecha con el sitio que preguntó', () => {
  // H6 (P3) movió el índice DETRÁS de `offerNotes`, que puede durar un turno
  // entero del modelo: en ese hueco el panel puede irse a otro sitio, y
  // `growIndex`/`markIndexDirty` leían el sitio VIVO (§8.22).
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  assert(/const sitioAlPedir = state\.site/.test(envio), 'el sitio entero se captura al mandar')
  assert(envio.indexOf('const sitioAlPedir = state.site') < envio.indexOf('runTurn('), 'antes de mandar nada')
  assert(
    /if \(\(state\.site\?\.host \?\? state\.lastHost\) === hostAlPedir && state\.sessionID === sesionAlPedir\) \{/.test(
      envio.slice(envio.indexOf("cron.mark('marcas')"))
    ),
    'y antes de cosechar se vuelve a preguntar si el panel sigue ahí'
  )
  assert(/await growIndex\(turn\.parts, \{ site: sitioAlPedir \}\)/.test(envio), 'la cosecha usa ese sitio')
  assert(/'Índice sin ampliar'/.test(envio), 'y si ya no lo está, se dice y no se cosecha')
  const fuera = envio.slice(envio.indexOf("log.info('Índice sin ampliar'"), envio.indexOf("cron.mark('índice')"))
  assert(!/growIndex\(|growTreeFromPage\(/.test(fuera), 'ni el árbol')
  // El orden y las fases no cambian.
  assert(envio.indexOf('await offerNotes(') < envio.indexOf('await growIndex('), 'las marcas siguen yendo antes')
  assert(envio.indexOf("cron.mark('índice')") < envio.indexOf('await offerNavigation('), 'y la fase cierra donde cerraba')

  const cosecha = sinComentarios(JS.slice(JS.indexOf('async function growIndex'), JS.indexOf('async function growTreeFromPage')))
  assert(/async function growIndex\(parts, \{ site = state\.site \} = \{\}\)/.test(cosecha), 'el sitio entra por opciones, con el de ahora por defecto')
  assert(/if \(!site\) return/.test(cosecha) && /site,\n/.test(cosecha), 'y es el que se le pasa a harvestIndex')
  assert(/markIndexDirty\(index, site\.host\)/.test(cosecha), 'y el apunte va bajo SU host, no bajo el de ahora')
  const apuntar = sinComentarios(JS.slice(JS.indexOf('function markIndexDirty'), JS.indexOf('async function persistIndex')))
  assert(/function markIndexDirty\(index, host = state\.site\?\.host \?\? state\.lastHost\)/.test(apuntar), 'markIndexDirty acepta el host y cae en el de ahora')
})

test('H6 revisión: una escritura tardía del índice no pisa un contexto recién construido', () => {
  // Desde H6 (P3) pasan minutos entre apuntar el índice y escribirlo: si en ese
  // hueco termina un `generateContext` del MISMO host, `persistIndex` escribía
  // el objeto viejo encima del índice recién construido y se perdía ENTERO.
  const contexto = sinComentarios(JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext')))
  assert(/const apuntado = state\.indexDirty\?\.host === host \? state\.indexDirty\.index : null/.test(contexto), 'lo apuntado de ESTE host se recoge')
  assert(/const base = apuntado && apuntado !== previo \? mergeIndex\(previo, apuntado\) : previo/.test(contexto), 'y se funde en lo que se guarda')
  assert(
    /if \(apuntado && state\.indexDirty\?\.index === apuntado\) state\.indexDirty = null/.test(contexto),
    'y se consume —si sigue siendo el mismo— para que no quede nada viejo que escribir después'
  )
  assert(contexto.indexOf('const apuntado =') < contexto.indexOf('await saveIndex(host,'), 'se recoge antes de guardar')
  assert(contexto.indexOf('await saveIndex(host,') < contexto.indexOf('state.indexDirty = null'), 'y se suelta después: una escritura que falla no puede perderlo')

  const escribir = sinComentarios(JS.slice(JS.indexOf('async function persistIndex'), JS.indexOf('function warnAboutSources')))
  assert(/const \{ host, index \} = pendiente/.test(escribir), 'el HOST sigue saliendo de lo apuntado')
  assert(/const sigueAqui = \(state\.site\?\.host \?\? state\.lastHost\) === host/.test(escribir), 'y si el panel sigue en ese host…')
  assert(/const aGuardar = sigueAqui && state\.index \? state\.index : index/.test(escribir), '…manda lo que el panel tiene ahora, que nunca es más viejo')
  assert(/await saveIndex\(host, aGuardar\)/.test(escribir))
  assert(!/saveIndex\(state\./.test(escribir), 'nunca bajo el host de ahora: el host es el apuntado, pase lo que pase')
})

test('H8: la tarjeta de una búsqueda de Jira trae la lista leída de la API, y la de siempre no desaparece', () => {
  // Hasta H8 la tarjeta decía «Los 37 resultados de la búsqueda en Jira» y para
  // ver cuáles había que irse a Jira. La MISMA consulta que el modelo acaba de
  // ejecutar por el MCP se lee de la API del propio sitio: 0 tokens (§8.19).
  const nav = sinComentarios(JS.slice(JS.indexOf('async function offerNavigation'), JS.indexOf('async function learnAncestry')))
  assert(/const card = navCard\(jqlPlan\(busqueda\)\)/.test(nav) && /attachToBubble\(bubble, card\)/.test(nav), 'la tarjeta de siempre se pinta primero')
  assert(
    /const sitio = state\.site\s*const lista = await attachJqlResults\(card, busqueda, \{ site: sitio, sessionID: state\.sessionID, tabId: state\.tabId \}\)/.test(nav),
    'y la lista se le añade con el sitio, la sesión y la pestaña capturados al pedir (§8.22)'
  )
  // Revisión adversaria de H8: la consulta que el modelo ejecutó DE VERDAD también
  // es «última» (antes sólo la recordaban los chips, contra lo que decía el plan),
  // sólo si devolvió una lista y bajo el host capturado al pedir.
  assert(/if \(lista\?\.ok\) \{/.test(nav), 'sólo lo que devolvió una lista')
  assert(/state\.recentJql = rememberJql\(state\.recentJql, busqueda\.jql, \{ count: lista\.total \}\)/.test(nav))
  assert(/await saveSite\(sitio\.host, \{ recentJql: state\.recentJql \}\)/.test(nav), 'bajo el host con el que se pidió, no el de ahora')
  assert(nav.indexOf('await attachJqlResults(') < nav.indexOf('rememberJql('), 'después de la lista, nunca antes')
  assert(
    nav.indexOf('attachToBubble(bubble, card)') < nav.indexOf('await attachJqlResults('),
    'la tarjeta existe antes de que se lea nada: si la API no contesta, ya está puesta'
  )
  // Y se ESPERA dentro del turno: lo que la lista funde en el índice tiene que
  // estar apuntado antes de la única escritura del turno (P3 de H6).
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  assert(envio.indexOf('await offerNavigation(') < envio.indexOf('await persistIndex()'))

  const lista = sinComentarios(JS.slice(JS.indexOf('async function attachJqlResults'), JS.indexOf('function jqlResultsList')))
  assert(lista.length > 200, 'el trozo de attachJqlResults existe')
  assert(/if \(!state\.settings\.restTools\) return/.test(lista), 'el interruptor maestro, y sin aviso: apagarlo no es un fallo')
  assert(/site\.product !== 'jira'/.test(lista), 'sólo en Jira')
  assert(/if \(site\.cloud\) \{/.test(lista), 'en Jira Cloud no hay REST de Jira que leer (410)')
  assert(/await ensureContentAccess\(\{ announce: false \}\)/.test(lista), 'quien pide es el content script, que vive en el origen del sitio')
  // El mensaje ENTERO y no un trozo: el pin viejo sólo prohibía el literal
  // «state.site.origin», y aquí el sitio vive en la variable `site`, así que
  // añadir `origin: site.origin, prefix: site.jiraPrefix` dejaba todo en verde
  // (revisión adversaria de H8). Con la llave cerrada no cabe ninguna clave más.
  assert(
    /\.sendMessage\(tabId, \{ type: MSG\.JQL_SEARCH, jql, limit: JIRA_REST_LIMITS\.defaultResults, cloud: site\.cloud \}\)/.test(lista),
    'la consulta viaja tal cual, con el tope del módulo, y el panel no manda ni el origen ni ninguna ruta: los deduce el content script'
  )
  assert(!/\borigin:/.test(lista) && !/\bjiraPrefix\b/.test(lista) && !/location\./.test(lista), 'ni por otro camino')
  // Lo capturado manda al pintar (§8.22), y el chat puede haberse repintado (C7).
  assert(/if \(!card\.isConnected\) return/.test(lista))
  assert(
    /if \(\(state\.site\?\.host \?\? state\.lastHost\) !== site\.host \|\| \(sessionID && state\.sessionID !== sessionID\)\) \{/.test(lista),
    'si el panel se fue a otro sitio o abrió OTRA sesión, no se pinta ni se cosecha; una sesión que nace mientras llega la lista no es otra (revisión adversaria de H8)'
  )
  assert(
    lista.indexOf('if (!card.isConnected) return') < lista.indexOf('harvestFromSearch('),
    'las dos guardas van antes de cosechar'
  )
  // Al índice antes de pintar las filas, y apuntado (no escrito) como todo lo
  // que crece dentro de un turno.
  assert(/const \{ index, added \} = harvestFromSearch\(issues, \{ site, index: state\.index \}\)/.test(lista))
  assert(/markIndexDirty\(index, site\.host\)/.test(lista) && !/saveIndex\(/.test(lista), 'se apunta bajo el host que lo aprendió; escribe persistIndex')
  assert(lista.indexOf('harvestFromSearch(') < lista.indexOf('jqlResultsList('), 'el índice se funde antes de que haya filas que pulsar')
  // Contraparte visible de cada fallo (§8.14), y la tarjeta sigue entera.
  assert(/noticeNode\(/.test(lista) && /'Lista de Jira no disponible'/.test(lista) && /'Lista de Jira leída'/.test(lista))
  assert(/restFailureDue\(state\.restWarned, reason, site\.host, sessionID\)/.test(lista), 'con tregua por host y sesión para lo que no cambia por reintentar')
  // La REGLA se ejecuta de verdad en rest-notice.test.js; aquí, que el panel la
  // use y no lleve una copia (cuatro mutaciones que borraban el aviso pasaban).
  assert(/import \{ restFailureDue, jqlFailText \} from '\.\/rest-notice\.js'/.test(JS))
  assert(!/function restFailureDue\(/.test(JS) && !/function jqlFailText\(/.test(JS), 'sin copia local de la regla')
  assert(/announce\(aviso\)/.test(lista), 'y el aviso se anuncia: cuelga de la tarjeta, no pasa por attachToBubble (A2)')
  assert(!/card\.remove\(\)/.test(lista), 'la tarjeta de siempre nunca desaparece: la lista es un añadido')
})

test('H8: una fila de la lista no navega por su cuenta — pasa por el índice y por validatePlan', () => {
  // §8.3: el destino se resuelve contra el índice y la URL la reconstruye
  // `resolveTarget` contra el origen de la pestaña. El panel no concatena ninguna.
  const filas = sinComentarios(JS.slice(JS.indexOf('function jqlResultsList'), JS.indexOf('function openIssueFromResults')))
  assert(/createElement\('button'\)/.test(filas), 'cada fila es un botón, no un enlace: no hay URL hasta que validatePlan la da')
  assert(/textContent = issue\.summary/.test(filas), 'el resumen es texto de Jira y entra con textContent')
  assert(/openIssueFromResults\(issue\.key, \{ site, card \}\)/.test(filas))
  for (const clase of ['result-status', 'result-list', 'result-row', 'result-key', 'result-body', 'result-title', 'result-meta']) {
    assert(CSS_LIMPIO.includes('.' + clase), 'clase sin estilo: ' + clase)
  }

  const abrir = sinComentarios(JS.slice(JS.indexOf('function openIssueFromResults'), JS.indexOf('async function offerNotes')))
  assert(
    /validatePlan\(\s*\{ navigate: true, mode: 'direct', destination: \{ kind: 'jira-issue', id: key \} \},/.test(abrir),
    'el destino se valida como cualquier otro'
  )
  assert(/index: state\.index, origin: site\.origin, host: site\.host, here: state\.tabUrl, site/.test(abrir), 'contra el índice y el origen del sitio')
  assert(/await runPlan\(r\.plan, 'direct', card\)/.test(abrir), 'y lo lanza el mismo runPlan: NAVIGATE_DIRECT')
  assert(
    /for \(const b of card\.querySelectorAll\('\.result-row, \.' \+ NEEDS_IDLE\)\) \{\s*b\.disabled = b\.classList\.contains\(NEEDS_IDLE\) \? state\.streaming : false/.test(abrir),
    'y las filas vuelven —un salto directo no tiene PLAN_FINISHED que las encienda, y la lista se quedaba muerta tras abrir una—, y con ellas «Preguntar sobre estos» de H12, que no es un viaje; lo que lleva NEEDS_IDLE sólo si no se está respondiendo (H6)'
  )
  assert(/noticeNode\(/.test(abrir), 'y si el plan no vale, se dice (§8.14)')
  assert(/import \{ validatePlan \} from '\.\.\/nav\/validate\.js'/.test(JS))

  // SEGURIDAD: el panel nunca escribe una ruta de la API ni fabrica un /browse/.
  const JS_LIMPIO = sinComentarios(JS)
  assert(!JS_LIMPIO.includes('/rest/api/'), 'ninguna ruta REST en el panel: las monta el módulo del producto')
  assert(!/'\/browse\/' \+/.test(JS_LIMPIO), 'ninguna URL de incidencia concatenada a mano')
})

test('H12: «Preguntar sobre estos» arma la precarga y deja la pregunta escrita, sin mandar nada', () => {
  // La lista que el usuario ya ve en la tarjeta puede viajar en el `system` del
  // turno siguiente en vez de que el modelo vuelva a pedírsela a Jira (§8.19).
  // Quien pregunta sigue siendo el usuario (§8.20): esto escribe en el cuadro.
  const lista = sinComentarios(JS.slice(JS.indexOf('async function attachJqlResults'), JS.indexOf('const PRELOAD_QUESTION')))
  // El pin viejo usaba una travesía libre entre el `if` y el `appendChild`, que
  // cruzaba la llave de cierre: sacar el botón del `if` dejaba todo en verde
  // (revisión adversaria de H12). Ahora se recorta el CUERPO del `if` —hasta la
  // primera llave de cierre a su sangría— y el botón tiene que estar DENTRO, y
  // una sola vez en toda la función.
  const desdeIf = lista.slice(lista.indexOf('if (issues.length) {'))
  const cuerpoIf = desdeIf.slice(0, desdeIf.indexOf('\n  }'))
  assert(cuerpoIf.length > 50 && cuerpoIf.includes('jqlResultsList(issues'), 'el cuerpo del if existe y es el de la lista')
  assert(
    cuerpoIf.includes("card.querySelector('.nav-actions')?.appendChild(preloadButton(issues, { site, jql, total }))"),
    'el botón sólo con filas, y dentro de las acciones de la tarjeta'
  )
  eq(lista.split('preloadButton(').length - 1, 1, 'y en ningún otro sitio de la función')

  const boton = sinComentarios(JS.slice(JS.indexOf('function preloadButton('), JS.indexOf('function jqlResultsList')))
  assert(boton.length > 200, 'el trozo de preloadButton existe')
  assert(/'Preguntar sobre estos'/.test(boton) && /b\.className = 'ghost small ' \+ NEEDS_IDLE/.test(boton))
  assert(/b\.disabled = state\.streaming/.test(boton) && /if \(state\.streaming\) \{/.test(boton), 'nace desactivado con un turno en vuelo, y el clic del cambio tampoco pasa (H6)')
  assert(/state\.pendingPreload = \{ jql, total, issues, host: site\.host \}/.test(boton), 'con el host con el que se leyó (§8.22)')
  assert(/el\.input\.value = PRELOAD_QUESTION/.test(boton) && /el\.input\.focus\(\)/.test(boton), 'la pregunta queda escrita y con el foco')
  assert(/'Búsqueda precargada'/.test(boton), 'y en el Registro')
  assert(/announce\(/.test(boton), 'y se anuncia: es una promesa de lo que va a viajar (A2)')
  // SEGURIDAD (§8.20): Faro no manda la pregunta por su cuenta, y lo que deja
  // escrito no lleva claves, ni la consulta, ni el host: eso acabaría en un
  // prompt en cuanto el usuario pulse enviar.
  assert(!/\bsend\(\)/.test(boton), 'no manda nada')
  const pregunta = JS.slice(JS.indexOf('const PRELOAD_QUESTION'), JS.indexOf('\n', JS.indexOf('const PRELOAD_QUESTION')))
  for (const prohibido of ['jql', 'host', 'key', 'site', '${']) {
    assert(!pregunta.includes(prohibido), 'la pregunta no lleva ' + prohibido)
  }
  // Y la tarjeta lleva ya dos acciones: a 320 px no caben en una línea.
  assert(/\.nav-actions \{[^}]*flex-wrap: wrap/.test(CSS_LIMPIO), 'las acciones de una tarjeta envuelven')
})

test('H12: lo precargado se consume en el turno siguiente, se dice bajo la pregunta y no viaja a otro sitio', () => {
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  // Se captura y se consume al mandar, como lo señalado con el ratón: acompaña a
  // ESTA pregunta y sólo a ésta.
  assert(/const preload = state\.pendingPreload\s*state\.pendingPreload = null/.test(envio), 'se consume al mandar')
  assert(
    /const preloadAlPedir = preload\?\.host === state\.site\.host \? preload : null/.test(envio),
    'y lo de otro host no viaja: serían incidencias de otro Jira en el system de éste (§8.22)'
  )
  assert(envio.indexOf('state.pendingPreload = null') < envio.indexOf('runTurn('), 'antes de mandar el turno')
  // Y se dice: mandar contexto sin que se vea sería mandarlo a espaldas de quien
  // pregunta, como la página en bloques y las páginas base.
  const nota = envio.slice(envio.indexOf('addUserMessage('), envio.indexOf('state.lastQuestion = text'))
  assert(/preloadNote\(preloadDelTurno\)/.test(nota), 'la nota va bajo la pregunta, y habla de lo que DE VERDAD viaja')
  assert(/import \{\s*baseSystem,\s*selectionBlock,\s*stripSelectionBlock,\s*pageUrlFromSystem,\s*preloadNote,\s*preloadFromSystem,\s*preloadedApplies,\s*PAGE_OPEN,\s*\} from '\.\/prompts\.js'/.test(JS))
  // EL CAMBIO (revisión adversaria de H12): con alcance EXCLUSIVO el bloque no
  // va en el prompt, así que la nota no puede decir que fue; la regla es UNA
  // (`preloadedApplies`, la que usa `baseSystem`), y el descarte se dice (§8.14).
  assert(
    /const preloadDelTurno = preloadAlPedir && preloadedApplies\(\{ site: state\.site, skill, sources \}\) \? preloadAlPedir : null/.test(envio),
    'lo que viaja se decide con la misma regla que el prompt'
  )
  assert(/preloaded: preloadDelTurno,/.test(envio) && !/preloaded: preloadAlPedir,/.test(envio), 'y eso es lo que recibe baseSystem')
  const descarte = nota.slice(nota.indexOf('if (preloadAlPedir && !preloadDelTurno) {'))
  assert(descarte.length > 20 && /'Búsqueda precargada'/.test(descarte) && /showNotice\(/.test(descarte), 'un descarte se registra y se dice')
  // Y sin búsqueda nueva no se planifica: la pregunta era sobre la lista.
  const navH12 = sinComentarios(JS.slice(JS.indexOf('async function offerNavigation'), JS.indexOf('async function learnAncestry')))
  assert(/async function offerNavigation\(answer, bubble, skillId = state\.skill, parts = \[\], \{ preloaded = false \} = \{\}\)/.test(navH12))
  const salida = navH12.indexOf('if (preloaded) {')
  assert(salida > navH12.indexOf('jqlDestination(parts') && salida < navH12.indexOf('planNavigation('), 'tras mirar si hubo búsqueda y ANTES de planificar')
  assert(/'Sin navegación', 'la pregunta era sobre una lista ya leída'/.test(navH12))
  assert(!/preloadedSearchBlock|SEARCH_OPEN/.test(sinComentarios(JS)), 'el bloque lo monta prompts.js, no el panel')

  // Al restaurar, la nota se reconstruye del sistema guardado con la MISMA
  // función: dos textos escritos por separado divergen.
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome')))
  assert(restaurar.length > 200, 'el trozo de restoreConversation existe')
  assert(/const precargadoDelTurno = preloadFromSystem\(m\.info\.system\)/.test(restaurar))
  assert(/preloadNote\(precargadoDelTurno\)/.test(restaurar), 'y se pinta con la misma función que al mandar')

  // Es de un momento: al cambiar de página —y por tanto de host— se olvida, y
  // una sesión nueva vacía el chat, así que la tarjeta con la lista se va con él.
  const pestana = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  const otra = pestana.slice(pestana.indexOf('if (otraPagina) {'), pestana.indexOf('state.tabId = tab.id'))
  assert(/state\.pendingPreload = null/.test(otra), 'al cambiar de página se olvida')
  const nueva = sinComentarios(JS.slice(JS.indexOf('async function newSession'), JS.indexOf('function emptyToday')))
  assert(/state\.pendingPreload = null/.test(nueva), 'y con una sesión nueva')
  // «Olvidar este sitio» repinta el chat igual que una sesión nueva: si no lo
  // suelta, viaja en la primera pregunta tras olvidar (revisión adversaria de H12).
  const olvidarH12 = sinComentarios(JS.slice(JS.indexOf("$('btn-forget').addEventListener"), JS.indexOf("$('mem-enabled').addEventListener")))
  assert(olvidarH12.length > 200 && /state\.pendingPreload = null/.test(olvidarH12), 'y al olvidar el sitio')
  assert(olvidarH12.indexOf('state.pendingPreload = null') < olvidarH12.indexOf('await bootForSite()'), 'antes de repintar')
})

test('H8: la casilla de las lecturas REST se lee y se guarda en Ajustes, y no rearranca el panel', () => {
  assert(htmlIds.has('set-rest-tools'), 'la casilla existe en la pantalla de Ajustes')
  const pantalla = sinComentarios(JS.slice(JS.indexOf('async function showSettingsScreen'), JS.indexOf('function setStatus')))
  assert(/\$\('set-rest-tools'\)\.checked = state\.settings\.restTools/.test(pantalla), 'al abrir refleja lo guardado')
  const cerrar = sinComentarios(JS.slice(JS.indexOf("$('btn-settings-close')"), JS.indexOf("$('btn-reindex')")))
  assert(/restTools: \$\('set-rest-tools'\)\.checked,/.test(cerrar), 'al cerrar se guarda')
  assert(
    /const clientChanged = state\.settings\.serverUrl !== antes\.serverUrl \|\| state\.settings\.password !== antes\.password/.test(cerrar),
    'y no cuenta para rearrancar: no cambia con quién se habla (P6a de H6)'
  )

  // El pin que dejó encargado la revisión adversaria de H7: `restTools` apaga
  // las lecturas NUEVAS, no las de las páginas base ni la del camino, que llevan
  // funcionando desde antes y son comportamiento pinado (docs/PLAN.md §3.3).
  const deAntes = [
    ['async function fetchPageChain', 'async function mergePagesIntoIndex'],
    ['async function searchSourcesRemote', 'function searchFailText'],
    ['async function learnAncestry', 'async function attachJqlResults'],
  ]
  for (const [desde, hasta] of deAntes) {
    const trozo = sinComentarios(JS.slice(JS.indexOf(desde), JS.indexOf(hasta)))
    assert(trozo.length > 200, 'el trozo existe: ' + desde)
    assert(!/restTools/.test(trozo), desde + ' no mira restTools: esa lectura es de antes de H7 y la casilla no la apaga')
  }
})

test('H8: la tarjeta restaurada no vuelve a pedir la lista sola', () => {
  // `restoreConversation` no recrea ninguna tarjeta de navegación (ni las filas
  // de herramientas): lo que pinta es la prosa y, si las marcas siguen en la
  // página, la tarjeta del análisis. Una lista leída «ahora mismo de Jira» al
  // reabrir el panel serían N peticiones por cada tarjeta vieja del historial.
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function showWelcome')))
  assert(!/attachJqlResults\(/.test(restaurar) && !/navCard\(/.test(restaurar), 'al restaurar no se pide ninguna lista')
  assert(!/MSG\.JQL_SEARCH/.test(restaurar))
  // Dos sitios y sólo dos, cada uno con su motivo: la lista de una tarjeta
  // (`attachJqlResults`) y la muestra con la que se cuenta el perfil del
  // proyecto (`countProfile`, H9), que la piden tanto el refresco del arranque
  // como la reconstrucción del contexto y por eso está escrita UNA vez.
  const JS_SIN = sinComentarios(JS)
  eq(JS_SIN.match(/MSG\.JQL_SEARCH/g).length, 2, 'el mensaje se manda desde dos sitios del panel, y cada uno tiene nombre')
  for (const [desde, hasta] of [
    ['async function attachJqlResults', 'function jqlResultsList'],
    ['async function countProfile', 'async function loadLinkedContext'],
  ]) {
    const trozo = JS_SIN.slice(JS_SIN.indexOf(desde), JS_SIN.indexOf(hasta))
    assert(trozo.length > 200 && /MSG\.JQL_SEARCH/.test(trozo), 'aquí se manda la consulta: ' + desde)
  }
})

test('H8: el chat vacío ofrece búsquedas al instante, y pintarlas no vuelve a anunciar nada', () => {
  // Las tres sugerencias van AL MODELO; los chips los ejecuta la extensión. Son
  // dos cosas y viven en dos módulos: el de las sugerencias no se toca.
  assert(/import \{ searchChips \} from '\.\/search-chips\.js'/.test(JS), 'la lista de chips es pura y vive aparte')
  const vacio = sinComentarios(JS.slice(JS.indexOf('function showWelcome'), JS.indexOf('function paintSearchChips')))
  assert(/'search-chips hidden'/.test(vacio), 'la caja nace oculta, como la dejó H5')
  assert(/paintSearchChips\(chips\)/.test(vacio), 'y se llena con lo que YA se sabe, sin pedir nada')
  assert(/loadSearchChipSources\(chips\)/.test(vacio), 'lo que falte llega después')
  assert(vacio.includes('announce(h.textContent)'), 'el estado vacío sigue anunciándose una vez')
  assert(vacio.indexOf('announce(h.textContent)') < vacio.indexOf('paintSearchChips(chips)'), 'los chips no cambian lo que se anuncia')

  const pintar = sinComentarios(JS.slice(JS.indexOf('function paintSearchChips'), JS.indexOf('async function loadSearchChipSources')))
  assert(/if \(!box\?\.isConnected\) return/.test(pintar), 'el chat pudo repintarse entre que se pidió una fuente y llegó')
  assert(/state\.settings\.restTools/.test(pintar), 'el interruptor maestro apaga también los chips')
  assert(
    /searchChips\(state\.site, \{\s*issueFields: state\.issueFields && samePage\(state\.issueFields\.url, state\.tabUrl\) \? state\.issueFields\.fields : null,\s*profile: currentProfile\(\),\s*favouriteFilters: state\.favouriteFilters \|\| \[\],\s*recentJql: state\.recentJql,/.test(
      sinComentarios(pintar)
    ),
    'con los campos de la pantalla, el perfil contado del proyecto (H9), los filtros del usuario y sus últimas búsquedas'
  )
  assert(/box\.classList\.toggle\('hidden', !chips\.length\)/.test(pintar), 'sin chips, la caja se queda oculta')
  // Se repinta SÓLO esta caja: repintar el estado vacío volvería a anunciar
  // «Listo para escuchar» cada vez que llega una fuente (A2, el mismo motivo por
  // el que cambiar de Skill no lo repinta).
  assert(!/showWelcome\(\)/.test(pintar), 'no se repinta el estado vacío entero')
  assert(/b\.className = 'ghost small search-chip ' \+ NEEDS_IDLE/.test(pintar), 'y con un turno en vuelo no se pulsan (H6)')
  assert(
    /b\.disabled = state\.streaming/.test(pintar) && /if \(state\.streaming\) \{/.test(pintar),
    'nace desactivado y el clic que llegue justo en el cambio tampoco pasa'
  )
  assert(/b\.textContent = chip\.label/.test(pintar) && /b\.title = chip\.title/.test(pintar), 'la consulta entera se puede leer antes de pulsar')
  assert(/runDirectSearch\(chip\)/.test(pintar))
  // La REGLA con su llave, no el nombre suelto: `.search-chip-loquesea`
  // contiene `.search-chip` y dejaría el pin en verde con el chip sin estilo
  // (el mismo fallo que la revisión adversaria de H6 encontró en `.older-turns`).
  for (const clase of ['search-chips', 'search-chip-row', 'search-chip']) {
    assert(new RegExp('\\.' + clase + '\\s*\\{').test(CSS_LIMPIO), 'clase sin estilo: ' + clase)
  }
})

test('H8: los filtros favoritos se piden una vez por sitio, y sólo cuando hay chips que pintar', () => {
  const cargar = sinComentarios(JS.slice(JS.indexOf('async function loadSearchChipSources'), JS.indexOf('async function readIssueFieldsQuick')))
  assert(
    /if \(!state\.settings\.restTools \|\| state\.site\?\.product !== 'jira' \|\| state\.site\?\.cloud\) return/.test(cargar),
    'ni con el interruptor apagado, ni en Confluence, ni en Cloud (allí no hay REST de Jira que leer)'
  )
  assert(/await readIssueFieldsQuick\(\)/.test(cargar))
  assert(/state\.favouriteFilters === null/.test(cargar), 'null es «no se ha preguntado»; una lista vacía es «ya se preguntó»')
  assert(cargar.includes('state.favouriteFilters = []'), 'se dan por preguntados aunque la lectura falle')
  assert(
    cargar.indexOf('state.favouriteFilters = []') < cargar.indexOf('type: MSG.FAVOURITE_FILTERS'),
    'y ANTES de preguntar: un sitio que contesta 401 no puede volver a pedirlo en cada chat vacío'
  )
  assert(/await ensureContentAccess\(\{ announce: false \}\)/.test(cargar), 'quien pide es el content script, que vive en el origen del sitio')
  assert(/'Filtros favoritos'/.test(cargar) && !/noticeNode\(/.test(cargar), 'un fallo aquí sólo quita chips: queda en el Registro, no en el chat')
  // §8.22: lo capturado al pedir manda al volver.
  assert(/const host = state\.site\.host/.test(cargar), 'el host con el que se pide')
  assert(cargar.includes('if (state.site?.host !== host) return'), 'y con el que se vuelve: lo leído en otro sitio no se pinta aquí')
  assert(cargar.lastIndexOf('paintSearchChips(box)') > cargar.indexOf('if (state.site?.host !== host) return'), 'y se repinta al final')
  eq(sinComentarios(JS).match(/MSG\.FAVOURITE_FILTERS/g).length, 1, 'se piden desde un solo sitio del panel')
  // Son de ESTE Jira: al cambiar de sitio vuelven a quedar por pedir, y
  // «Olvidar este sitio» se las lleva con el resto de lo suyo.
  const refresh = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/state\.favouriteFilters = null/.test(refresh) && /state\.recentJql = \[\]/.test(refresh))
  const olvidar = sinComentarios(JS.slice(JS.indexOf("$('btn-forget')"), JS.indexOf("$('mem-enabled').addEventListener")))
  assert(/state\.recentJql = \[\]/.test(olvidar) && /state\.favouriteFilters = null/.test(olvidar), 'olvidar el sitio olvida sus búsquedas')

  // Y el interruptor manda en caliente: los chips se repintan al aplicar los
  // ajustes, en los dos sentidos (H6 dejó de rearrancar el panel al cerrarlos).
  const ajustes = sinComentarios(JS.slice(JS.indexOf('function applySettingsToUi'), JS.indexOf('function wireEvents')))
  assert(/el\.chat\.querySelector\('\.empty \.search-chips'\)/.test(ajustes) && /paintSearchChips\(chips\)/.test(ajustes))
})

test('H8: los campos de la incidencia se leen sin trocear la página y se olvidan al cambiar de página', () => {
  const rapida = sinComentarios(JS.slice(JS.indexOf('async function readIssueFieldsQuick'), JS.indexOf('async function runDirectSearch')))
  assert(/type: MSG\.PAGE_DIGEST, fieldsOnly: true/.test(rapida), 'sólo los campos: trocear la página cuesta y aquí no se mira ni un bloque')
  assert(/const fields = normalizeIssueFields\(r\.issue\)/.test(rapida), 'y llegan con claves blancas, como con el digest')
  assert(/state\.issueFields = \{ url: r\.url \|\| state\.tabUrl, fields \}/.test(rapida), 'se recuerdan con la URL de la que salieron')
  // §8.22: la página se captura al pedir y se comprueba al volver; una respuesta
  // tardía no resucita los campos de la incidencia anterior.
  assert(/const desde = state\.tabUrl/.test(rapida) && /if \(!samePage\(r\.url \|\| desde, state\.tabUrl\)\) return null/.test(rapida))
  assert(
    rapida.indexOf('if (!samePage(r.url || desde, state.tabUrl)) return null') < rapida.indexOf('state.issueFields = { url'),
    'la guarda va antes de escribir'
  )
  assert(
    /if \(state\.issueFields && samePage\(state\.issueFields\.url, state\.tabUrl\)\) return state\.issueFields\.fields/.test(rapida),
    'y no se vuelven a pedir para la misma página, ni cuando no había campos que leer'
  )
  // El Análisis ya los trae con el digest: los mismos campos, sin una lectura más.
  const lectura = sinComentarios(JS.slice(JS.indexOf('async function readPageDigest'), JS.indexOf('function attachToBubble')))
  assert(/state\.issueFields = \{ url: r\.url \|\| state\.tabUrl, fields: issue \}/.test(lectura))
  // Y son de la incidencia que había en pantalla: al cambiar de página se van,
  // antes de reasignar la URL, como las marcas de un análisis.
  const refresh = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/if \(state\.issueFields && !samePage\(tab\.url \|\| '', state\.issueFields\.url\)\) state\.issueFields = null/.test(refresh))
  assert(refresh.indexOf('state.issueFields = null') < refresh.indexOf('state.tabUrl = tab.url'), 'antes de reasignar la URL de la pestaña')

  // Y en la página, la clave de la épica sale del ENLACE y pasa por la forma de
  // clave: el texto del campo es el NOMBRE de la épica, y con el nombre la
  // consulta no encuentra nada en Data Center. `jira-issue.js` necesita DOM y no
  // tiene prueba propia en Node: se mira por regex, como bootstrap.js.
  const jiraIssue = sinComentarios(readFileSync(join(ROOT, 'src/content/jira-issue.js'), 'utf8'))
  assert(/import \{ validIssueKey \} from '\.\.\/atlassian\/site\.js'/.test(jiraIssue), 'la forma de una clave se decide en un solo sitio')
  const delEnlace = jiraIssue.slice(jiraIssue.indexOf('function claveDeEnlace'), jiraIssue.indexOf('export function jiraIssueFields'))
  assert(/querySelectorAll\?\.\('a\[href\]'\)/.test(delEnlace) && /validIssueKey\(m\[1\]\)/.test(delEnlace), 'del href, y validada')
  assert(!/textContent/.test(delEnlace), 'nunca del texto del campo, que es el nombre de la épica')
  assert(/out\.epicKey = claveDeEnlace\(epicEl\)/.test(jiraIssue))
})

test('H8: una búsqueda directa no pasa por opencode, y sólo se recuerda si se ejecutó', () => {
  const directa = sinComentarios(JS.slice(JS.indexOf('async function runDirectSearch'), JS.indexOf('function markIfRestored')))
  assert(directa.length > 400, 'el trozo de runDirectSearch existe')
  assert(
    !/createSession\(/.test(directa) && !/runTurn\(/.test(directa) && !/state\.turns\.push/.test(directa),
    'ni sesión, ni turno, ni memoria: aquí no ha hablado nadie con el modelo'
  )
  assert(/addUserMessage\(chip\.label, 'búsqueda directa, sin modelo'\)/.test(directa), 'y se dice bajo la pregunta')
  // §8.22: el sitio, la sesión y la pestaña con los que se pide.
  assert(/const site = state\.site/.test(directa) && /const sessionID = state\.sessionID/.test(directa) && /const tabId = state\.tabId/.test(directa))
  assert(/jqlLink\(chip\.jql, \{ origin: site\.origin \}\)/.test(directa), 'la URL se monta como la de una búsqueda del modelo')
  assert(/navCard\(jqlPlan\(destino, \{ kicker: 'Búsqueda directa', title: chip\.label \}\)\)/.test(directa))
  assert(/card\.classList\.add\('direct'\)/.test(directa) && /\.nav-card\.direct\s*\{/.test(CSS_LIMPIO), 'con su propia tarjeta')
  assert(/attachJqlResults\(card, destino, \{ site, sessionID, tabId \}\)/.test(directa), 'y la MISMA lista que la de un turno')
  // Una consulta con una función que no es de Jira se abre allí, no se ejecuta aquí.
  assert(directa.includes('if (!chip.run) {'), 'lo que no se puede ejecutar aquí se sabe antes de pedir nada')
  assert(directa.indexOf('if (!chip.run) {') < directa.indexOf('attachJqlResults('), 'y se decide antes')
  assert(/nav-text/.test(directa), 'y se dice en la tarjeta por qué (§8.14)')
  // Fuera de un turno nadie llama al `persistIndex()` de `send()`: lo que la
  // lista apunta en el índice se escribe aquí, antes de cualquier salida.
  assert(/await persistIndex\(\)/.test(directa), 'lo que la lista aprende se guarda aunque no haya turno')
  assert(
    directa.indexOf('attachJqlResults(card, destino') < directa.indexOf('await persistIndex()') &&
      directa.indexOf('await persistIndex()') < directa.indexOf('if (!r?.ok || (state.site?.host ?? state.lastHost) !== site.host) return'),
    'después de la lista y antes de salir por una lista que no llegó'
  )
  // Sólo se apunta como «última» lo que devolvió una lista, y bajo el host que
  // la ejecutó.
  assert(/if \(!r\?\.ok \|\| \(state\.site\?\.host \?\? state\.lastHost\) !== site\.host\) return/.test(directa), 'la misma pregunta que hace la lista: el sitio del panel es lastHost con la pestaña fuera')
  assert(/rememberJql\(state\.recentJql, chip\.jql, \{ count: r\.total \}\)/.test(directa))
  assert(/await saveSite\(site\.host, \{ recentJql: state\.recentJql \}\)/.test(directa))
  // El import del módulo, con todo lo que el panel le pide (H9 añadió el perfil
  // y la plantilla de la muestra, y el import pasó a varias líneas).
  const deJira = sinComentarios(JS).slice(sinComentarios(JS).indexOf('import {\n  JIRA_REST_LIMITS,'))
  const nombres = deJira.slice(0, deJira.indexOf("} from '../shared/jira-rest.js'"))
  assert(nombres.length > 0 && nombres.length < 400, 'el import de jira-rest.js está donde se espera')
  for (const nombre of ['JIRA_REST_LIMITS', 'normalizeRecentJql', 'rememberJql']) {
    assert(new RegExp('\\b' + nombre + ',').test(nombres), 'falta en el import de jira-rest.js: ' + nombre)
  }

  // Lo guardado se reconstruye al leerlo, como las páginas base.
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext')))
  assert(/state\.recentJql = normalizeRecentJql\(saved\?\.recentJql\)/.test(arranque))

  // Y el epígrafe de la tarjeta lo pone el plan: una búsqueda directa no la
  // ofreció ningún turno, así que no dice «Puedo llevarte».
  const tarjeta = sinComentarios(JS.slice(JS.indexOf('function navCard('), JS.indexOf('async function runPlan')))
  assert(/kicker\.textContent = plan\.kicker \|\| 'Puedo llevarte'/.test(tarjeta))
})

test('H8: el espejo enseña la lista de la tarjeta, la búsqueda directa, los chips y el aviso de que no hay lista', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')

  // Las tres piezas nuevas se miran en el espejo y en ningún otro sitio: el
  // panel no corre en el banco (`init()` muere en `getSettings`), así que si no
  // están aquí, el rediseño de H8 se acepta sin haberlo visto.
  assert(espejo.includes('data-chat="jira-busqueda"'), 'la conversación de Búsqueda es una opción del espejo')
  assert(espejo.includes('data-chat="empty-jira"'), 'y el chat vacío de un Jira, que es el único que tiene chips')
  const reparto = espejo.slice(espejo.indexOf('function pintarChat()'), espejo.indexOf('// ------------------------------------------------- relleno'))
  assert(/estado\.chat === 'jira-busqueda'/.test(reparto) && /conversacionBusqueda\(\)/.test(reparto), 'y se pintan de verdad')
  assert(/estado\.chat\.startsWith\('empty'\)/.test(reparto), 'los dos vacíos pintan el estado vacío')

  // La tarjeta con lista: las clases son las que pinta `jqlResultsList`, así que
  // un renombrado en el panel deja el espejo enseñando algo que ya no existe.
  const busqueda = espejo.slice(espejo.indexOf('function conversacionBusqueda()'), espejo.indexOf('/** La burbuja que está llegando'))
  assert(busqueda.length > 500, 'el trozo de conversacionBusqueda existe')
  // Sobre las piezas que PINTAN, no sobre el fichero entero: `.result-row` está
  // también en la lista de cajas que se miden a lo ancho, y ahí el nombre
  // seguiría estando aunque nadie lo pintara.
  const piezas = espejo.slice(espejo.indexOf('function tarjetaBusqueda(plan)'), espejo.indexOf('/** La tarjeta de «Falta un permiso»'))
  for (const clase of ['result-status', 'result-list', 'result-row', 'result-key', 'result-body', 'result-title', 'result-meta']) {
    // El literal ENTERO, con su comilla de cierre: `'result-list'` es prefijo de
    // `'result-lista'` y un renombrado se colaría.
    assert(piezas.includes("'" + clase + "'") || piezas.includes(' ' + clase + "'"), 'el espejo no enseña la clase ' + clase)
    assert(CSS_LIMPIO.includes('.' + clase), 'clase sin estilo: ' + clase)
  }
  assert(/leídos ahora mismo de Jira/.test(busqueda), 'con la línea de estado que dice de dónde salió la lista')
  // Las filas de ejemplo llevan las claves EXACTAS de `parseSearchIssues`, y una
  // de las dos está en un estado final: cerrada y viva no se ven igual.
  const filas = espejo.slice(espejo.indexOf('const RESULTADOS ='), espejo.indexOf('const FUENTES_CHIPS ='))
  for (const clave of ['key:', 'summary:', 'status:', 'assignee:']) assert(filas.includes(clave), 'la fila de ejemplo no trae ' + clave)
  assert(/status: 'Cerrada'/.test(filas), 'y una fila en un estado final al lado de una viva')
  assert(/displayName:/.test(filas) && !/emailAddress/.test(filas), 'del asignado sólo el nombre visible, que es lo único que deja pasar el parser')

  // El título de la tarjeta y la URL los escribe el código real: escritos a mano
  // aquí se quedarían atrás en cuanto `jqlPlan` cambie una palabra.
  assert(/import\('\/src\/panel\/planner\.js'\)/.test(espejo), 'el plan sale de planner.js')
  assert(busqueda.includes('jqlPlan({ ...jqlLink(BUSQUEDA_JQL, { origin }), count: 37 })'), 'con la consulta y cuántos resultados hubo')
  assert(!/Los 37 resultados/.test(espejo), 'el título no se copia: lo pone jqlPlan')

  // La búsqueda directa: su propio epígrafe, su filete y la nota bajo la
  // pregunta, que es lo único que avisa de que esto no está en opencode.
  assert(/kicker: 'Búsqueda directa', title: chip\.label/.test(busqueda), 'el epígrafe y el título los pone el plan, como en el panel')
  assert(/directa\.classList\.add\('direct'\)/.test(busqueda) && /\.nav-card\.direct\s*\{/.test(CSS_LIMPIO), 'con su filete dorado')
  assert(/'búsqueda directa, sin modelo'/.test(busqueda) && JS.includes("'búsqueda directa, sin modelo'"), 'y la misma nota que pone el panel')

  // El aviso de que no hay lista: DENTRO de la tarjeta, detrás de los botones, y
  // con el texto de `jqlFailText`. La tarjeta sigue entera (§8.14).
  assert(/sinLista\.appendChild\(\s*aviso\(/.test(busqueda), 'el aviso cuelga de la tarjeta, no del chat')
  for (const trozo of ['no vale para su API', 'La tarjeta te lleva igual.']) {
    assert(busqueda.includes(trozo), 'el espejo no dice «' + trozo + '»')
    assert(JS.includes(trozo), 'y el panel tampoco: los dos textos se han separado')
  }

  // Los chips salen del módulo REAL con las fuentes de ejemplo: cuáles y cuántos
  // los decide `searchChips`, no este fichero, y en Confluence no sale ninguno
  // porque el sitio que se le pasa es el de la conversación.
  assert(/import\('\/src\/panel\/search-chips\.js'\)/.test(espejo), 'los chips salen de search-chips.js')
  assert(/searchChips\(sitio\(\), FUENTES_CHIPS\)/.test(espejo), 'con el sitio de la conversación: en Confluence devuelve una lista vacía')
  const chips = espejo.slice(espejo.indexOf('function pintarChips(box)'), espejo.indexOf('/** La tarjeta de «Falta un permiso»'))
  assert(/'Búsquedas al instante, sin modelo'/.test(chips) && JS.includes("'Búsquedas al instante, sin modelo'"), 'el mismo epígrafe que el panel')
  assert(/box\.classList\.toggle\('hidden', !chips\.length\)/.test(chips), 'sin chips la caja se queda oculta, como en el panel')
  assert(/'ghost small search-chip needs-idle'/.test(chips) && /const NEEDS_IDLE = 'needs-idle'/.test(JS), 'y con la clase gancho de H6')
  assert(/b\.title = chip\.title/.test(chips), 'la consulta entera en el title, para poder leerla antes de pulsar')
  const vacio = espejo.slice(espejo.indexOf('function estadoVacio()'), espejo.indexOf('function conversacionBusqueda()'))
  assert(/pintarChips\(chips\)/.test(vacio), 'el estado vacío los pinta')
  assert(/suggestionsFor\(/.test(vacio) && /'suggestions'/.test(vacio), 'y las tres sugerencias siguen donde estaban')
  assert(vacio.indexOf("'suggestions'") < vacio.indexOf('pintarChips('), 'los chips van debajo de ellas, no en su sitio')

  // Y las dos cajas nuevas se miden a lo ancho como la cabecera y el redactor.
  const cajas = espejo.slice(espejo.indexOf('const CAJAS ='), espejo.indexOf('function check() {'))
  assert(cajas.includes("'.result-row'") && cajas.includes("'.search-chip-row'"), 'las piezas de H8 entran en la medida de desbordamiento')
})

test('H12: el espejo enseña «Preguntar sobre estos» y la nota de lo que viaja precargado', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  const busqueda = espejo.slice(espejo.indexOf('function conversacionBusqueda()'), espejo.indexOf('/** La burbuja que está llegando'))
  assert(busqueda.length > 500, 'el trozo de conversacionBusqueda existe')

  // El botón de H12 cuelga de las MISMAS acciones de la tarjeta que «Abrir la
  // búsqueda en Jira», igual que en el panel, y sólo donde hay filas.
  const poner = espejo.slice(espejo.indexOf('function ponerPreguntar(card)'), espejo.indexOf('/** Los chips de «búsquedas al instante»'))
  assert(poner.length > 100, 'el trozo de ponerPreguntar existe')
  assert(/'Preguntar sobre estos'/.test(poner) && JS.includes("'Preguntar sobre estos'"), 'con el mismo texto que el panel')
  assert(/'ghost small needs-idle'/.test(poner), 'y con la clase gancho de H6, que es como nace en el panel')
  assert(/card\.querySelector\('\.nav-actions'\)\.appendChild/.test(poner), 'dentro de las acciones de la tarjeta')
  assert(/ponerLista\(conLista, RESULTADOS\)\s*ponerPreguntar\(conLista\)/.test(busqueda), 'la tarjeta con lista lo lleva')
  assert(/ponerLista\(directa, RESULTADOS\)\s*ponerPreguntar\(directa\)/.test(busqueda), 'y la búsqueda directa, que es la misma tarjeta')
  assert(!/ponerPreguntar\(sinLista\)/.test(busqueda), 'la que se quedó sin lista no: sin filas no hay nada que precargar')

  // La nota bajo la pregunta la escribe el código real. Copiada a mano aquí
  // diría otro número en cuanto el tope de filas recortara.
  assert(/import\('\/src\/panel\/prompts\.js'\)/.test(espejo) && /\{ preloadNote \}/.test(espejo), 'la nota sale de prompts.js')
  assert(
    /preloadNote\(\{ jql: BUSQUEDA_JQL, total: 37, issues: RESULTADOS \}\)/.test(busqueda),
    'con los mismos resultados y la misma consulta que la tarjeta de arriba enseña'
  )
  assert(!/de una búsqueda previa/.test(espejo), 'el texto de la nota no se copia: lo pone preloadNote')

  // Y la fila de acciones entra en la medida de desbordamiento: con dos botones
  // a 320 px es justo la pieza que puede empujar a lo ancho.
  const cajasH12 = espejo.slice(espejo.indexOf('const CAJAS ='), espejo.indexOf('function check() {'))
  assert(cajasH12.includes("'.nav-actions'"), 'las acciones de una tarjeta se miden a lo ancho')
  assert(/\.nav-actions \{[^}]*flex-wrap: wrap/.test(CSS_LIMPIO), 'y envuelven, que es lo que hace que quepan')
})

test('H9: el mapa se levanta con lo que la API da exacto, y si no puede sigue por el modelo', () => {
  // Levantar el contexto de un espacio eran TRES turnos del modelo; el árbol lo
  // dice la lista paginada de Confluence en milisegundos (§8.19). La regla de
  // oro: esto sólo ADELANTA trabajo, y si no se puede, `buildContext` hace lo de
  // siempre con sus tres fases.
  const rest = sinComentarios(JS.slice(JS.indexOf('async function restIndexFor'), JS.indexOf('async function generateContext')))
  assert(rest.length > 400, 'el trozo de restIndexFor existe')
  assert(
    /if \(!state\.settings\.restTools \|\| !sitio\) return nada/.test(rest),
    'el interruptor maestro, y sin aviso: apagarlo no es un fallo, es lo que la casilla promete'
  )
  assert(!/'Índice por la API no disponible'[\s\S]*restTools/.test(rest), 'apagarlo tampoco se registra como si hubiera fallado algo')

  // Confluence: el árbol de UN espacio, pedido por el content script, que es
  // quien vive en el origen del sitio.
  assert(/if \(scope\?\.kind !== 'space' \|\| !scope\.key\) \{/.test(rest), 'por la API sólo se lee el árbol de un espacio')
  assert(/await ensureContentAccess\(\{ announce: false \}\)/.test(rest), 'y hace falta permiso sobre el sitio')
  assert(
    /\.sendMessage\(tabId, \{ type: MSG\.SPACE_PAGES, spaceKey: scope\.key, wikiPrefix: wikiPrefixOf\(sitio\), cloud: sitio\.cloud \}\)/.test(rest),
    'el mensaje ENTERO: el panel no manda ni el origen ni ninguna ruta de la API, sólo el prefijo del wiki que observó (como PAGE_ANCESTORS)'
  )
  assert(!/\borigin:/.test(rest) && !/location\./.test(rest) && !/maxPages:/.test(rest), 'ni por otro camino, ni un segundo tope por mensaje')
  assert(/indexFromSpacePages\(r\.pages, \{ site: sitio, scope, homeId: r\.homeId \}\)/.test(rest), 'lo que vuelve pasa por las validadoras del índice')
  assert(/'Índice leído de la API'/.test(rest) && /'Índice por la API no disponible'/.test(rest), 'las dos salidas se registran (§8.14)')
  // H14: el árbol son las páginas MÁS RECIENTES del espacio, no todas (F8), así
  // que en un espacio de verdad siempre viene recortado y lo honesto es decir de
  // cuántas; y si vino por el camino de respaldo, que no está ordenado por fecha.
  assert(
    rest.includes('const deCuantas = r.total ? `${r.own} de ${r.total}` : `recortado en ${INDEX_LIMITS.maxPages}`'),
    'se dice cuántas de cuántas cuando la API dice el total'
  )
  assert(rest.includes("r.truncated ? ` · ${deCuantas}` : ''"), 'y sólo cuando se quedó corto')
  assert(rest.includes("r.via === 'lista' ? ' · por la lista, sin ordenar por fecha' : ''"), 'por dónde vino el árbol')

  // Jira: aquí lo que la API da no es un árbol, es la muestra con la que se
  // cuenta el perfil. Y en Cloud no hay REST de Jira que leer (410).
  assert(/if \(sitio\.cloud\) \{/.test(rest), 'en Jira Cloud no se pide nada')
  assert(/if \(scope\?\.kind !== 'project'\) \{/.test(rest), 'y sólo se cuenta la muestra de un proyecto')
  assert(/const r = await countProfile\(sitio, scope, \{ tabId, signal \}\)/.test(rest), 'la muestra la lee countProfile, que es quien manda el mensaje')

  // Revisión adversaria de H9: «un indexado cancelado no escribe nada» (§4.6)
  // vale también para lo que se lee de la API. El Cancelar del velo no corta la
  // petición, pero lo que vuelva después ni se guarda ni entra en el estado.
  assert(/async function restIndexFor\(scope, \{ sitio, report = \(\) => \{\}, tabId = state\.tabId, signal = null \} = \{\}\)/.test(rest))
  assert((rest.match(/if \(signal\?\.aborted\) return nada/g) || []).length >= 3, 'antes de pedir y al volver, en los dos productos')
  assert(/if \(signal\?\.aborted \|\| r\.reason === 'cancelado'\) return nada/.test(rest), 'un perfil cancelado no es un fallo que avisar')
  const contar = sinComentarios(JS.slice(JS.indexOf('async function countProfile'), JS.indexOf('async function loadLinkedContext')))
  assert(contar.length > 300, 'el trozo de countProfile existe')
  assert(/if \(signal\?\.aborted\) return \{ ok: false, reason: 'cancelado'/.test(contar))
  assert(
    contar.indexOf("if (signal?.aborted) return { ok: false, reason: 'cancelado'") < contar.indexOf('await saveProfile(sitio.host, profile)'),
    'la guarda de cancelación va ANTES de guardar el perfil'
  )
  // Y el perfil que acompaña al indexado es el de ESTE proyecto, leído del
  // almacén cuando el panel ya está en otro sitio.
  assert(/const guardado = profileForProject\(delHost, sitio\?\.projectKey\)/.test(rest), 'sólo el perfil del proyecto que se indexa')
  assert(/await getProfile\(sitio\.host\)/.test(rest), 'con el panel en otro sitio, el de ese host sale del almacén')
  assert(
    /if \(\(state\.site\?\.host \?\? state\.lastHost\) === host\) state\.profile = r\.profile/.test(rest),
    'y en el estado sólo entra si el panel sigue en ese sitio (§8.22)'
  )

  // Nunca lanza: cada camino devuelve, y el que falla devuelve el motivo para
  // que quien llama lo pueda enseñar.
  assert(!/throw /.test(rest), 'un fallo de la API no puede tumbar el indexado')
  assert(/return \{ \.\.\.nada, aviso: texto \}/.test(rest), 'el motivo vuelve con el resultado')
  assert(
    rest.includes('const delHost = !sitio ? null : (state.site?.host ?? state.lastHost) === sitio.host ? state.profile : await getProfile(sitio.host)'),
    'y el perfil que ya hubiera contado sigue valiendo'
  )

  // En `generateContext`: antes de gastar el turno, con el sitio CAPTURADO, y
  // lo que salga va a buildContext.
  const contexto = sinComentarios(JS.slice(JS.indexOf('async function generateContext'), JS.indexOf('async function uploadContext')))
  assert(
    /const rest = await restIndexFor\(scope, \{ sitio, report, signal: controller\.signal \}\)/.test(contexto),
    'con el sitio capturado al empezar, no con el de la pestaña de ahora, y con la señal de cancelar'
  )
  assert(contexto.indexOf('await restIndexFor(') < contexto.indexOf('await buildContext('), 'y antes de gastar el turno del modelo')
  assert(/restIndex: rest\.index,/.test(contexto) && /profile: rest\.profile,/.test(contexto), 'lo leído viaja a buildContext')
  assert(
    /if \(controller\.signal\.aborted\) throw new DOMException\('Cancelado', 'AbortError'\)/.test(contexto),
    'y cancelar durante la lectura de la API no sigue abriendo una sesión de indexado'
  )
  // El motivo sobrevive al velo: la línea del velo se la lleva el paso
  // siguiente en cuanto pasa, y el contexto acaba listo igual (§8.14).
  assert(/rest\.aviso \? ' ' \+ rest\.aviso : ''/.test(contexto), 'y si la API no sirvió, se dice también al terminar')

  // La casilla de Ajustes vuelve a prometer el índice, ahora que existe.
  assert(/id="set-rest-tools"[^>]*>[^<]*índice exacto/.test(HTML), 'la casilla dice lo que hace')
  // Y la pantalla de contexto dice lo que de verdad va a pasar: con las
  // lecturas REST apagadas, lo de siempre.
  const pantalla = sinComentarios(JS.slice(JS.indexOf('function showContextScreen'), JS.indexOf('async function showMemoryScreen')))
  // Por `readsByApi`, que mira el interruptor Y el ámbito (revisión adversaria de
  // H9: con «todo Confluence» prometía la API y luego iba por el modelo).
  assert(/const porLaApi = readsByApi\(state\.site, scope\)/.test(pantalla), 'la pantalla depende del interruptor y del ámbito')
  assert(/la API de Confluence/.test(pantalla) && /Recorre el árbol, los títulos y las etiquetas\./.test(pantalla), 'y tiene los dos textos')
})

test('H9: el perfil del proyecto se carga con el sitio y se vuelve a contar fuera del camino crítico', () => {
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext')))
  // Viaja en el MISMO paquete del sitio (`BUNDLE_EXTRA_KEYS`): ni una lectura
  // más en el arranque, que es lo que P4 dejó en una sola (H6).
  assert(/state\.profile = normalizeProfile\(bundle\.extras\?\.profile\)/.test(arranque), 'sale del paquete y se reconstruye al leerlo (§9)')
  assert(!/getProfile\(/.test(arranque), 'sin una segunda lectura del almacén para lo mismo')
  // Y volver a contarlo va DETRÁS del arranque y sin await: es una petición a
  // la API del sitio y el chat no puede esperarla.
  assert(/\n  refreshProfileSoon\(testigo\)/.test(arranque), 'el refresco se lanza al final del arranque')
  assert(!/await refreshProfileSoon\(/.test(arranque), 'y no se espera: el chat ya está puesto')
  assert(
    arranque.indexOf('await ensureContentAccess({ announce: false })') < arranque.indexOf('refreshProfileSoon(testigo)'),
    'después de asegurarse de que hay content script con quien hablar'
  )

  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshProfile('), JS.indexOf('async function countProfile')))
  assert(/if \(!state\.settings\.restTools\) return/.test(refresco), 'el interruptor maestro también aquí')
  assert(/sitio\?\.product !== 'jira' \|\| sitio\.cloud/.test(refresco), 'sólo en un Jira Data Center')
  assert(/Date\.now\(\) - state\.profile\.at < PROFILE_LIMITS\.ttlMs/.test(refresco), 'un perfil reciente no se vuelve a contar')
  assert(/state\.profile\.projectKey === scope\.key/.test(refresco), 'y el que hay tiene que ser de ESTE proyecto')
  assert(
    /if \(!\(await hasHostPermission\(sitio\.origin\)\)\) return/.test(refresco),
    'con permiso YA concedido: un refresco en segundo plano no abre un diálogo de permisos que nadie ha pedido'
  )
  assert((refresco.match(/state\.bootToken !== testigo/g) || []).length >= 2, 'y se comprueba el testigo tras los await')
  assert(/\(state\.site\?\.host \?\? state\.lastHost\) !== sitio\.host\) return/.test(refresco), 'lo capturado al pedir manda al volver (§8.22)')

  // La petición está escrita UNA vez, y es una plantilla fija con la clave
  // validada (§8.12): ni texto del usuario ni prosa del modelo.
  const contar = sinComentarios(JS.slice(JS.indexOf('async function countProfile'), JS.indexOf('async function loadLinkedContext')))
  assert(/const jql = sampleQuery\(scope\?\.kind === 'project' \? scope\.key : ''\)/.test(contar), 'la consulta sale de la plantilla del módulo')
  assert(!/`project = /.test(contar) && !/'project = /.test(contar), 'el panel no escribe ninguna JQL a mano')
  assert(/fields: SAMPLE_FIELDS/.test(contar), 'y los campos son los de la muestra, que NO llevan personas')
  assert(/limit: JIRA_REST_LIMITS\.maxResults/.test(contar), 'con el tope del módulo que ejecuta')
  assert(/profileFromSample\(r\.issues, \{ projectKey: scope\.key \}\)/.test(contar) && /await saveProfile\(sitio\.host, profile\)/.test(contar), 'se cuenta y se guarda bajo el host con el que se pidió')
  assert(!/state\.profile = /.test(contar), 'quien llama decide si entra en el estado, no esto')
  assert(/'Perfil del proyecto'/.test(contar), 'y queda en el Registro')
  assert(/jqlFailText\(r, sitio\.host\)/.test(contar), 'el motivo en palabras sale de rest-notice.js, no de una copia')
})

test('H9: el perfil entra en el prompt y en los chips, y se va con el sitio', () => {
  // Sólo lo usa Búsqueda en Jira, y quien lo decide es `baseSystem`: el panel
  // se limita a pasarlo, como el contexto del Confluence enlazado.
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  const peticion = envio.slice(envio.indexOf('const peticion = {'), envio.indexOf('let silencioso'))
  assert(peticion.length > 200, 'el trozo de la petición existe')
  assert(
    /linkedContext: state\.linkedContext,\s*profile: currentProfile\(\),\s*preloaded: preloadDelTurno,\s*sources,/.test(peticion),
    'el perfil viaja en el system del turno, entre el contexto enlazado y lo precargado (H12), que va antes de las páginas base'
  )
  assert(/import \{\s*baseSystem/.test(JS) && !/profileBlock/.test(sinComentarios(JS)), 'el bloque lo monta prompts.js, no el panel')

  // Es del SITIO: al cambiar de host se vacía, y «Olvidar este sitio» —que
  // borra su clave— no puede dejarlo en memoria para el turno siguiente.
  const pestana = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  const cambio = pestana.slice(pestana.indexOf('if (changedHost) {'), pestana.indexOf('state.site = site'))
  assert(/state\.profile = null/.test(cambio), 'al cambiar de host se vacía, como el índice y las últimas búsquedas')
  const eventos = sinComentarios(JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys')))
  // Hasta el manejador SIGUIENTE y no hasta el final de wireEvents: el corte
  // viejo buscaba un comentario («// --- memoria») en un fuente SIN comentarios,
  // daba -1 y el trozo abarcaba todo lo de detrás, así que el pin seguía verde con
  // el perfil vaciado en otro manejador (revisión adversaria de H9).
  const desdeOlvidar = eventos.indexOf("$('btn-forget')")
  const hastaOlvidar = eventos.indexOf("$('mem-enabled')", desdeOlvidar)
  assert(desdeOlvidar > 0 && hastaOlvidar > desdeOlvidar, 'el manejador de «Olvidar este sitio» se puede recortar')
  const olvidar = eventos.slice(desdeOlvidar, hastaOlvidar)
  assert(/forgetEverythingFor\(host\)/.test(olvidar) && /state\.profile = null/.test(olvidar), 'olvidar el sitio se lleva también lo contado de su proyecto')
})

test('H9 revisión: el perfil sólo vale para el proyecto que hay delante, y la pantalla de contexto no promete la API donde no se usa', () => {
  // El perfil se guarda por HOST y un Jira tiene muchos proyectos: el de SIMPL
  // entraba en la Búsqueda y en los chips de OPS como «los nombres exactos».
  const vigente = sinComentarios(JS.slice(JS.indexOf('function currentProfile'), JS.indexOf('function refreshProfileSoon')))
  assert(/return profileForProject\(state\.profile, site\?\.projectKey\)/.test(vigente), 'el cruce lo hace la pura de jira-rest.js')
  const limpio = sinComentarios(JS)
  assert(!/profile: state\.profile\b/.test(limpio), 'nadie consume state.profile a secas: todos pasan por currentProfile()')
  eq((limpio.match(/profile: currentProfile\(\)/g) || []).length, 2, 'los chips y la petición del turno')

  // Cambiar de proyecto sin cambiar de host no pasa por bootForSite: se cuenta
  // el del nuevo en segundo plano, UNA vez por proyecto.
  const pestana = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(
    /else if \(site\.product === 'jira' && site\.projectKey && !currentProfile\(site\) && state\.profileAsked !== `\$\{site\.host\}:\$\{site\.projectKey\}`\) \{\s*refreshProfileSoon\(state\.bootToken\)/.test(pestana),
    'otro proyecto del mismo Jira vuelve a contar, con tregua por proyecto'
  )
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshProfile('), JS.indexOf('async function countProfile')))
  assert(/state\.profileAsked = `\$\{sitio\.host\}:\$\{scope\.key\}`/.test(refresco), 'la tregua se marca al decidir contar')
  // Los dos índices se exigen > -1 (revisión adversaria de H15): con la
  // primera cadena ausente, -1 < N daba verde sin vigilar nada.
  const vigenteIdx = refresco.indexOf('if (vigente) return')
  const treguaIdx = refresco.indexOf('state.profileAsked =')
  assert(vigenteIdx > -1 && treguaIdx > -1 && vigenteIdx < treguaIdx, 'un perfil vigente no gasta tregua')
  assert(/profileAsked: ''/.test(limpio))

  // La pantalla de contexto pregunta lo mismo que restIndexFor: UN espacio, o UN
  // proyecto de un Jira Data Center, y con las lecturas REST encendidas.
  const porApi = sinComentarios(JS.slice(JS.indexOf('function readsByApi'), JS.indexOf('function showContextScreen')))
  assert(/if \(!state\.settings\.restTools \|\| !site\) return false/.test(porApi))
  assert(/if \(site\.product === 'confluence'\) return scope\?\.kind === 'space' && !!scope\.key/.test(porApi))
  assert(/if \(site\.product === 'jira'\) return !site\.cloud && scope\?\.kind === 'project'/.test(porApi))
  const pantalla = sinComentarios(JS.slice(JS.indexOf('function showContextScreen'), JS.indexOf('async function showMemoryScreen')))
  assert(/const porLaApi = readsByApi\(state\.site, scope\)/.test(pantalla), 'con el ámbito, no sólo con el producto')
})

test('H9: el espejo enseña la pantalla de contexto con el texto nuevo y las dos filas del Registro', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')

  // El panel no corre en el banco (`init()` muere en `getSettings`), así que lo
  // que H9 cambia en la pantalla de contexto sólo se puede mirar aquí: sin esta
  // fila del espejo, el texto nuevo se acepta sin haberlo visto nunca.
  const relleno = espejo.slice(espejo.indexOf("$('context-scope')"), espejo.indexOf("$('delay-value')"))
  assert(relleno.length > 200, 'el trozo de relleno de las pantallas existe')
  assert(/\$\('context-generate-text'\)\.textContent =/.test(relleno), 'el espejo pinta el texto de «Que lo genere Faro»')
  // El texto se COPIA porque `showContextScreen` lo compone en línea; entonces
  // los dos lados tienen que decirlo, o el espejo enseñaría algo que el panel ya
  // no escribe. Por trozos, no la frase entera: los dos la parten en literales,
  // y en sitios distintos.
  for (const trozo of [
    'Lee el árbol del espacio de la API de Confluence con tu sesión',
    'escribe con él el documento.',
    'Con tope, progreso visible y botón de cancelar.',
  ]) {
    assert(relleno.includes(trozo), 'el espejo no dice «' + trozo + '»')
    assert(JS.includes(trozo), 'y el panel tampoco: los dos textos se han separado «' + trozo + '»')
  }
  // Y la casilla de Ajustes encendida, que es de lo que depende ese texto: con
  // ella apagada la pantalla dice lo de siempre, y las dos capturas no cuadrarían.
  assert(/\$\('set-rest-tools'\)\.checked = true/.test(relleno), 'con el interruptor de las lecturas REST encendido, como el texto que enseña')

  // Las dos filas nuevas del Registro: los títulos son los que registra el panel
  // (si se renombra uno, el espejo enseñaría un título que ya no existe).
  const registro = espejo.slice(espejo.indexOf('const logBox ='), espejo.indexOf('const stateBox ='))
  assert(registro.length > 400, 'el trozo del Registro de ejemplo existe')
  for (const titulo of ['Índice leído de la API', 'Perfil del proyecto']) {
    assert(registro.includes("'" + titulo + "'"), 'el Registro del espejo no enseña «' + titulo + '»')
    assert(JS.includes("'" + titulo + "'"), 'y el panel no registra «' + titulo + '»')
  }
  // Con su línea de detalle, que es la que dice cuánto se ahorró: un título sin
  // detalle no enseña nada de lo que H9 hace.
  assert(/entradas · 3 petición\(es\)/.test(registro), 'la fila del índice dice entradas y peticiones')
  assert(/muestra de 30 incidencias · 7 tipos · 6 estados/.test(registro), 'y la del perfil, de cuántas incidencias se contó')
})

test('H10: la pantalla de páginas base propone, y lo que las pinta está cableado', () => {
  // Los ids de la sección nueva, y dónde va: entre el campo (que acaba en
  // #sources-perm) y «Páginas elegidas». Puesta debajo de la lista sería una
  // sugerencia que nadie ve sin desplazarse.
  for (const id of [
    'sources-suggested',
    'sources-suggested-title',
    'sources-suggested-hint',
    'sources-suggested-list',
    'btn-sources-add-suggested',
    'btn-sources-forget',
  ]) {
    assert(htmlIds.has(id), 'falta el id «' + id + '» en panel.html')
  }
  assert(HTML.indexOf('id="sources-perm"') < HTML.indexOf('id="sources-suggested"'), 'la sección va después del campo')
  assert(HTML.indexOf('id="sources-suggested"') < HTML.indexOf('<h2>Páginas elegidas</h2>'), 'y antes de «Páginas elegidas»')
  // La promesa de §8.20 escrita donde se ve: Faro propone, el usuario añade.
  assert(HTML.includes('Nada se añade solo: pulsa una para añadirla.'), 'falta la frase fija')

  // Las clases que pinta el JS existen en el CSS (A8: dos clases pintadas y sin
  // regla se colaron hasta la auditoría del 2026-09-13). Con su llave, no el
  // nombre suelto: renombrar la regla a «.suggest-whyX» dejaba el pin en verde
  // con la fila sin estilo, que es la misma trampa que la de `.older-turns` en H6.
  for (const clase of ['.suggest-list', '.suggest-row.suggested', '.suggest-why', '.suggest-actions']) {
    assert(CSS_LIMPIO.includes(clase + ' {'), 'clase sin regla en el CSS: ' + clase)
  }

  const pantalla = sinComentarios(JS.slice(JS.indexOf('async function showSourcesScreen'), JS.indexOf('function setSourcesStatus')))
  assert(
    pantalla.indexOf('paintSourceList()') < pantalla.indexOf('paintSuggestedSources()'),
    'las sugeridas se pintan después de las elegidas'
  )
  assert(/paintSuggestedSources\(\)\.catch\(/.test(pantalla), 'sin await: lo que queda de la pantalla no espera a la pestaña')

  const pintar = sinComentarios(JS.slice(JS.indexOf('async function paintSuggestedSources'), JS.indexOf('function suggestedHint')))
  assert(/const token = \+\+state\.sourcesSuggest\.token/.test(pintar), 'testigo, como el de la búsqueda')
  assert((pintar.match(/token !== state\.sourcesSuggest\.token/g) || []).length >= 2, 'y se comprueba tras cada await')
  assert((pintar.match(/state\.site\?\.host !== host/g) || []).length >= 2, 'y también el host con el que se empezó (§8.22)')
  assert(/type: MSG\.PAGE_LINKS/.test(pintar), 'los enlaces los pide la pestaña')
  assert(/\.catch\(\(\) => null\)/.test(pintar), 'un sendMessage a la pestaña nunca lanza')
  assert(/remote: !!state\.settings\.restTools/.test(pintar), 'el interruptor de las lecturas REST manda sobre el remotelink')
  assert(/confluenceHost: linkedHost\(\)/.test(pintar), 'y el content script sabe a qué Confluence se admite un enlace remoto')
  // Lo que llegó de la pestaña se registra, y lo que NO llegó también: son las
  // dos mitades de §8.14 y las dos tienen que estar (con una sola, quitar la
  // otra no se notaba).
  assert(/log\.warn\('Enlaces de la página'/.test(pintar), 'si la pestaña no contesta, se dice')
  assert(/log\.info\(\s*'Enlaces de la página',/.test(pintar), 'y lo que llegó, también')
  assert(
    /leídos · \$\{enlaces\.length\} a Confluence · remotos: \$\{remotos\}/.test(pintar),
    'con cuántos enlaces llevaban a una página y qué pasó con los remotos'
  )
  // §8.14: si la pestaña no contesta, la sección vive de lo demás y lo dice.
  assert(/paintSuggestedList\(computeSuggested\(\)\.list, \{ estado: 'sin-enlaces' \}\)/.test(pintar))
  assert(/paintSuggestedList\(computeSuggested\(\)\.list, \{ estado: 'sin-pestana' \}\)/.test(pintar))

  const calcular = sinComentarios(JS.slice(JS.indexOf('function computeSuggested'), JS.indexOf('async function paintSuggestedSources')))
  assert(/suggestSources\(\{/.test(calcular) && /confluenceLinksIn\(/.test(calcular), 'puntúa con los módulos puros')
  assert(/const index = sourcesIndex\(\)/.test(calcular), 'con el índice que toca (el del enlazado desde Jira)')
  assert(/const enlazado = linkedHost\(\)/.test(calcular), 'y con el Confluence enlazado')
  assert(/exclude: state\.sources\.pages\.map/.test(calcular), 'lo ya elegido no se propone')
  // Revisión adversaria de H10: las tres fuentes de §8.20 se podían desconectar
  // en silencio (quitar el historial o las referencias dejaba todo en verde).
  assert(/history: state\.sourceHistory,/.test(calcular), 'el historial llega a la puntuación')
  assert(/references: currentReferences\(\),/.test(calcular), 'las referencias del contexto también')
  assert(/links: enlaces,/.test(calcular), 'y los enlaces de la página')
  // Y los enlaces son de UNA página: se cruzan donde se consumen, como los campos.
  assert(/const deAqui = !!state\.sourcesSuggest\.url && samePage\(state\.sourcesSuggest\.url, state\.tabUrl\)/.test(calcular))
  assert(
    /confluenceLinksIn\(deAqui \? state\.sourcesSuggest\.links : \[\], deAqui \? state\.sourcesSuggest\.remote : null, \{/.test(calcular),
    'los enlaces de otra página no puntúan ésta: el motivo «enlazada desde la descripción» sería mentira'
  )
  assert(/const pagina = state\.tabUrl/.test(pintar), 'la página se captura al pedir (§8.22)')
  assert(/if \(!samePage\(r\.url \|\| pagina, state\.tabUrl\)\) return/.test(pintar), 'y se comprueba al volver')
  assert(/state\.sourcesSuggest\.links = Array\.isArray\(r\.links\) \? r\.links : \[\]/.test(pintar) && /state\.sourcesSuggest\.remote = r\.remote \|\| null/.test(pintar))
  assert(/state\.sourcesSuggest\.url = r\.url \|\| pagina/.test(pintar), 'con la URL de la que son')
  assert(
    pintar.indexOf('if (!samePage(r.url || pagina, state.tabUrl)) return') < pintar.indexOf('state.sourcesSuggest.links = Array.isArray('),
    'la guarda va antes de guardar nada'
  )
  const pestanaH10 = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/const otraPagina = !samePage\(tab\.url \|\| '', state\.tabUrl \|\| ''\)/.test(pestanaH10))
  assert(/if \(otraPagina\) \{\s*state\.sourcesSuggest\.token\+\+\s*state\.sourcesSuggest\.links = \[\]/.test(pestanaH10), 'al cambiar de página se van, y una respuesta en vuelo no los devuelve')
  assert(
    /if \(!changedHost && otraPagina && !\$\('screen-sources'\)\.classList\.contains\('hidden'\)\) paintSuggestedSources\(\)/.test(pestanaH10),
    'y con la pantalla abierta se vuelven a calcular para la página que hay delante'
  )
  assert(/linked: !!enlazado/.test(calcular), 'desde un Jira, las páginas son del enlazado y van sin ruta (§4.8)')
  assert(
    /issue: state\.issueFields && samePage\(state\.issueFields\.url, state\.tabUrl\)/.test(calcular),
    'los campos de la pantalla se cruzan por página, como en los chips'
  )

  const filas = sinComentarios(JS.slice(JS.indexOf('function paintSuggestedList'), JS.indexOf('function refreshSuggestedVisibility')))
  // Revisión adversaria de H10: `#sources-suggested` nace oculta y la ÚNICA línea
  // que la enseña al abrir la pantalla es ésta; sin ella H10 no existía para el
  // usuario y las 1171 pruebas seguían en verde. Lo mismo con el texto de arriba.
  assert(/refreshSuggestedVisibility\(\)\s*\}\s*$/.test(filas.trim()), 'pintar la lista termina enseñando la sección')
  assert(/\$\('sources-suggested-hint'\)\.textContent = list\.length \? suggestedHint\(estado\) : ''/.test(filas), 'y dice de dónde salen (§8.14)')
  // Un repintado (añadir o quitar una página base) conserva QUÉ fuentes
  // llegaron: si volviera a «listo», la sección diría que leyó los enlaces de
  // la página justo después de decir que no pudo.
  assert(
    /function paintSuggestedList\(list, \{ estado = state\.sourcesSuggest\.estado \} = \{\}\)/.test(filas),
    'el estado por defecto es el último de verdad, no «listo»'
  )
  assert(!/innerHTML|insertAdjacentHTML/.test(filas), 'las filas se construyen con createElement')
  assert(/createElement\('button'\)/.test(filas) && /'suggest-row suggested'/.test(filas), 'cada fila es un botón')
  assert(
    /setAttribute\('aria-label', motivo \? `Añadir «\$\{s\.title\}» · \$\{motivo\}` : `Añadir «\$\{s\.title\}»`\)/.test(filas),
    'con su nombre para el lector de pantalla, y con el motivo dentro'
  )
  assert(/reasonText\(s\.reasons\)/.test(filas), 'y el motivo lo escribe la extensión')
  assert(/chooseSuggestion\(s\)/.test(filas), 'pulsar una la añade por el camino de siempre')

  // Escribir en el campo esconde la sección: dos listas apiladas en 320 px.
  const visible = sinComentarios(JS.slice(JS.indexOf('function refreshSuggestedVisibility'), JS.indexOf('function repaintSuggested')))
  assert(/SOURCE_LIMITS\.queryMin/.test(visible), 'el umbral es el de la búsqueda, no un número a mano')
  assert(/\$\('sources-suggested'\)\.classList\.toggle\('hidden'/.test(visible))
  const entrada = sinComentarios(JS.slice(JS.indexOf('function onSourcesInput'), JS.indexOf('function refReasonText')))
  assert(/refreshSuggestedVisibility\(\)/.test(entrada), 'y se aplica en cuanto se escribe')

  // Añadir una sugerida pasa por el addSource de siempre, con su tope y su
  // motivo; y nunca se funde en el índice (`from` no es 'confluence').
  const elegir = sinComentarios(JS.slice(JS.indexOf('async function chooseSuggestion'), JS.indexOf('async function addSourceById')))
  assert(/from: s\.source/.test(elegir) && /reason: s\.source === 'suggested' \? reasonText\(s\.reasons\) : ''/.test(elegir))
  // Una sugerida cuyo título es un marcador («Página N») no entra con ese nombre
  // —el prompt del Análisis nombra las páginas base por su título—: lo lee.
  assert(
    /if \(s\.source === 'suggested' && isPlaceholderTitle\(s\.title\)\) \{\s*return addSourceById\(s\.id, s\.path, \{ suggested: true, reason: reasonText\(s\.reasons\) \}\)/.test(elegir),
    'y conserva el motivo para el registro'
  )
  const alta = sinComentarios(JS.slice(JS.indexOf('async function addSource('), JS.indexOf('async function removeSource')))
  assert(/async function addSource\(page, \{ from = 'index', reason = '' \} = \{\}\)/.test(alta))
  assert(/suggested: 'sugerida'/.test(alta) && /from === 'suggested' && reason/.test(alta), 'el registro dice por qué se propuso')
  assert(/repaintSuggested\(\)/.test(alta), 'y la sección se repinta sin volver a preguntarle a la pestaña')
  assert(/if \(from === 'suggested'\) announce\(/.test(alta), 'y se dice en voz alta: la fila desaparece al instante (A2)')

  // Los dos botones de la sección están conectados.
  assert(/\$\('btn-sources-add-suggested'\)\.addEventListener/.test(JS))
  assert(/\$\('btn-sources-forget'\)\.addEventListener/.test(JS))
  const olvidar = sinComentarios(JS.slice(JS.indexOf('async function forgetSourceHistory'), JS.indexOf('function onSourcesInput')))
  assert(/clearSourceHistory\(state\.site\.host\)/.test(olvidar) && /'Historial de páginas base'/.test(olvidar))
})

test('H10: el historial se apunta al terminar un análisis, y sólo bajo el host que preguntó', () => {
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  // Orden RELATIVO, no adyacencia: entre los dos hay más cosas y H11 colgará
  // aquí lo suyo. Lo que no puede cambiar es que el historial se apunte con la
  // respuesta ya avisada y antes de la pasada de marcas, que dura un turno.
  assert(envio.indexOf('warnAboutSources(') < envio.indexOf('recordAnalysisTurn('), 'después del aviso de las páginas base')
  assert(envio.indexOf('recordAnalysisTurn(') < envio.indexOf('offerNotes('), 'y antes de las marcas')
  // Con lo capturado al mandar (§8.22), no con el estado de ahora.
  const llamada = envio.slice(envio.indexOf('recordAnalysisTurn('), envio.indexOf("cron.mark('pintar')"))
  for (const campo of [
    'host: hostAlPedir',
    'sessionID: sesionAlPedir',
    'issueKey: issueKeyAlPedir',
    'pageId: pageIdAlPedir',
    'site: sitioAlPedir',
    'product: productoAlPedir',
  ]) {
    assert(llamada.includes(campo), 'recordAnalysisTurn no recibe «' + campo + '»')
  }

  const apuntar = sinComentarios(JS.slice(JS.indexOf('async function recordAnalysisTurn'), JS.indexOf('function computeSuggested')))
  // H11 partió esta guarda en dos: el DIARIO se apunta en cualquier Análisis que
  // salga bien (la mayoría no llevan páginas base, y «lo analizaste el lunes con
  // 6 observaciones» es la razón más fuerte de «Qué mirar hoy»), y el historial
  // sigue pidiendo páginas base. Lo que no puede volver es que el historial se
  // escriba sin ellas: por eso el segundo `assert` exige que el `return` siga
  // estando ANTES de `historyEntry(`, que es quien construye la entrada.
  assert(
    /if \(skill !== 'analisis' \|\| !ok \|\| !host\) return/.test(apuntar),
    'sólo un Análisis que salió bien'
  )
  assert(
    apuntar.indexOf('if (!sources?.pages?.length) return') > 0 &&
      apuntar.indexOf('if (!sources?.pages?.length) return') < apuntar.indexOf('historyEntry({'),
    'y el historial, sólo con páginas base'
  )
  assert(
    /\(state\.site\?\.host \?\? state\.lastHost\) !== host \|\| state\.sessionID !== sessionID/.test(apuntar),
    'si el panel ya no está donde preguntó, no se apunta (§8.22)'
  )
  assert(
    /state\.issueFields && samePage\(state\.issueFields\.url, pageUrl\)/.test(apuntar),
    'los campos de la pantalla se cruzan con la página del turno (lección de H8)'
  )
  assert(/historyEntry\(\{/.test(apuntar), 'la entrada la construye el módulo puro')
  assert(
    /saveSourceHistory\(host, recordAnalysis\(state\.sourceHistory, entrada, \{ host \}\)\)/.test(apuntar),
    'se guarda bajo el host que preguntó, y por el normalize de su módulo'
  )
  // El estado sólo recoge lo que quedó guardado, y sólo si el panel sigue ahí:
  // escribir tarda, y una versión optimista habría que deshacerla.
  assert(/catch \(err\)/.test(apuntar) && /'no se pudo guardar · '/.test(apuntar), 'una cuota llena no se lleva la respuesta')
  assert(
    /if \(\(state\.site\?\.host \?\? state\.lastHost\) === host\) state\.sourceHistory = guardado/.test(apuntar),
    'y lo guardado no entra en el estado de otro sitio (§8.22)'
  )

  // Se carga con el paquete del sitio, sin una lectura más (P4 de H6).
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function ensureContentAccess')))
  assert(/state\.sourceHistory = normalizeHistory\(bundle\.extras\?\.sourceHistory, \{ host: state\.site\.host \}\)/.test(arranque))
  // Con `\b`: `forgetSourceHistory(` contiene esas letras y dejaba el pin en
  // rojo sobre un fichero que no lee nada aparte.
  assert(!/\bgetSourceHistory\(/.test(JS), 'y no hace falta una lectura aparte del almacén')

  // Y es del SITIO: cambiar de host lo vacía, y «Olvidar este sitio» también.
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/state\.sourceHistory = emptyHistory\(\)/.test(refresco))
  assert(
    /state\.sourcesSuggest = \{ token: state\.sourcesSuggest\.token \+ 1/.test(refresco),
    'y el testigo sube: lo que llegue tarde es de otro sitio'
  )
  const olvidarSitio = sinComentarios(JS.slice(JS.indexOf("$('btn-forget').addEventListener"), JS.indexOf("$('mem-enabled').addEventListener")))
  assert(/state\.sourceHistory = emptyHistory\(\)/.test(olvidarSitio), 'olvidar el sitio se lleva su historial de la memoria del panel')
  // Y su clave del almacén se la lleva `forgetEverythingFor`, que las deriva de
  // STORAGE_KEYS: lo pina storage.test.js recorriéndolas todas (H13). Aquí basta
  // con que la clave siga declarando dónde vive, que es de lo que sale la lista.
  const areasH10 = readFileSync(join(ROOT, 'src/shared/config.js'), 'utf8')
  assert(/sourceHistory: 'local'/.test(areasH10), 'y su clave dice que vive en storage.local')

  // Cerrar la pantalla sube el testigo: los enlaces que lleguen después no
  // tienen dónde pintarse.
  const cerrar = sinComentarios(JS.slice(JS.indexOf('function closeSourcesScreen'), JS.indexOf('function onRuntimeMessage')))
  assert(/state\.sourcesSuggest = \{ token: state\.sourcesSuggest\.token \+ 1/.test(cerrar))
})

test('H10 SEGURIDAD: sugerir no llama al modelo y el historial no entra en ningún prompt', () => {
  // §8.20: ninguna de las cuatro fuentes gasta un token. En todo lo que pinta o
  // puntúa una sugerencia no puede haber un turno.
  const bloque = sinComentarios(JS.slice(JS.indexOf('async function recordAnalysisTurn'), JS.indexOf('function onSourcesInput')))
  assert(bloque.length > 2000, 'el bloque de las sugeridas existe entero')
  for (const prohibido of ['runTurn(', 'promptStructured(', 'createSession(', 'baseSystem(', 'skillSystem(']) {
    assert(!bloque.includes(prohibido), 'sugerir no puede llamar al modelo: «' + prohibido + '»')
  }
  // Y nada de esto viaja al modelo: la petición del turno no lo lleva.
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  const peticion = envio.slice(envio.indexOf('const peticion = {'), envio.indexOf('runTurn('))
  assert(peticion.length > 200, 'la petición del turno sigue construyéndose en un objeto')
  for (const prohibido of ['sourceHistory', 'sourcesSuggest', 'state.references', 'reasonText', 'suggestSources']) {
    assert(!peticion.includes(prohibido), 'la petición del turno no puede llevar «' + prohibido + '»')
  }
  // Ni ningún prompt lo recibe: los dos ficheros que los escriben no lo nombran.
  for (const fichero of ['src/panel/prompts.js', 'src/panel/skills.js']) {
    const fuente = readFileSync(join(ROOT, fichero), 'utf8')
    assert(
      !/sourceHistory|suggestSources|referencesFromContext/.test(fuente),
      'un prompt no puede saber nada del historial ni de las sugerencias: ' + fichero
    )
  }
})

test('H10: el espejo enseña «Sugeridas» con sus motivos, en Confluence y en Jira', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')

  // El panel no corre en el banco, así que esta sección sólo se puede mirar
  // aquí. Y se calcula con el MÓDULO de verdad: una lista copiada a mano
  // seguiría enseñando los motivos de antes en cuanto cambiara la tabla de puntos.
  assert(espejo.includes("import('/src/panel/source-suggest.js')"), 'el espejo importa el módulo que puntúa')
  const pintar = espejo.slice(espejo.indexOf('function pintarSugeridas'), espejo.indexOf('function pintarSeleccion'))
  assert(pintar.length > 500, 'el espejo pinta las sugeridas')
  assert(/suggestSources\(\{/.test(pintar) && /reasonText\(sug\.reasons\)/.test(pintar), 'con puntuación y motivos de verdad')
  assert(/'suggest-row suggested'/.test(pintar) && /'suggest-why'/.test(pintar), 'y con las clases que pinta el panel')
  assert(/aria-label', motivo \?/.test(pintar), 'y con el mismo nombre accesible, motivo incluido')
  assert(/exclude: elegidas/.test(pintar), 'las ya elegidas salen de la lista, como en el panel')
  // Cambia con la conversación: desde Jira las páginas son del Confluence
  // enlazado y la fila lo dice.
  const base = espejo.slice(espejo.indexOf('function pintarPaginasBase'), espejo.indexOf('function pintarSugeridas'))
  assert(/pintarSugeridas\(\)/.test(base), 'se repinta con la conversación y con las páginas base elegidas')
  assert(/desde \$\{enlazado\}/.test(pintar), 'en Jira la fila dice de qué Confluence es la página')

  // Y el campo queda vacío: con dos letras escritas el panel esconde la
  // sección, así que la captura no puede enseñar las dos listas a la vez.
  assert(/\$\('sources-query'\)\.value = ''/.test(espejo), 'el campo de la vista previa va vacío')
  assert(!/sugerencias\.classList\.remove\('hidden'\)/.test(espejo), 'y el listbox de la búsqueda se queda plegado')
})

// ---------------------------------------------------------------------------
// H11 · «Qué mirar hoy»
// ---------------------------------------------------------------------------

/** Todo el bloque de «hoy», que va al final de panel.js y sin comentarios. */
const HOY = sinComentarios(JS.slice(JS.indexOf('function emptyToday()')))
/** Un trozo del bloque, por sus dos funciones. Sin comentarios, como el resto. */
const hoyEntre = (desde, hasta) => sinComentarios(JS.slice(JS.indexOf(desde), JS.indexOf(hasta)))

test('H11: «Qué mirar hoy» se lee fuera del arranque, con sus dos interruptores y con testigo', () => {
  // `refreshProfileSoon` NO es `async` (lanza y no espera, como `loadTodaySoon`):
  // con «async» delante el corte era -1, el trozo llegaba hasta el final del
  // fichero y el «no lo espera» de abajo se cumplía por vacío — hasta que H11
  // escribió un `await loadToday(` legítimo en «Actualizar», a 300 000 caracteres
  // de aquí, y lo destapó.
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('function refreshProfileSoon')))
  // Fuera del camino crítico (H6 P4): se lanza sin `await` y DESPUÉS de que el
  // chat esté puesto. Con `await` aquí, seis peticiones a la API del sitio se
  // meterían delante de la conversación.
  assert(/\bloadTodaySoon\(testigo\)/.test(arranque), 'el arranque lanza «hoy» con su testigo')
  assert(!/await loadToday\(/.test(arranque), 'y no lo espera')
  assert(
    arranque.includes('await restoreConversation(testigo)') &&
      arranque.indexOf('await restoreConversation(testigo)') < arranque.indexOf('loadTodaySoon(testigo)'),
    'y va después de restaurar la conversación'
  )

  const cargar = hoyEntre('async function loadToday', 'async function fetchTodayTarget')
  assert(cargar.length > 1500, 'el cuerpo de loadToday existe entero')
  // Los dos interruptores, en una sola condición: el maestro de las lecturas
  // REST y el de esta función. Con cualquiera apagado no sale ni una petición.
  assert(
    /if \(!state\.settings\.restTools \|\| !state\.settings\.todaySuggestions\) return/.test(cargar),
    'los dos interruptores paran la lectura entera'
  )
  // Y el de este SITIO, normalizado al leer: lo que no sea `true` no lo escribió
  // Faro y no apaga nada.
  assert(/if \(saved\?\.todayOff === true\) return/.test(cargar), 'y el interruptor por sitio, comparado con true')
  // §8.22: el testigo del arranque y el host capturado, antes y después de las
  // peticiones. Sin la segunda comprobación, lo leído de un sitio se pintaría
  // encima de otro.
  const guardas = cargar.match(/state\.bootToken !== testigo \|\| \(state\.site\?\.host \?\? state\.lastHost\) !== host/g) || []
  assert(guardas.length >= 2, 'el testigo y el host se comprueban antes y después de leer, no una sola vez')
  // La caché de sesión, con el plazo del módulo y no con un número a mano.
  assert(/getTodayCache\(host\)/.test(cargar) && /TODAY_LIMITS\.cacheMs/.test(cargar), 'la caché de sesión con el plazo de TODAY_LIMITS')
  assert(/saveTodayCache\(host, \{ fetchedAt, reads, errors: fallos \}\)/.test(cargar), 'se guarda lo LEÍDO, no lo ordenado')
  assert(/if \(!force\) \{/.test(cargar), 'y «Actualizar» se la salta')
  // Un objetivo caído no se lleva a los demás.
  assert(/Promise\.allSettled\(targets\.map\(/.test(cargar), 'los objetivos van a la vez y ninguno tumba al otro')
  assert(/todayTargets\(sitio, saved, \{\s*linked: state\.linkedContext,/.test(cargar), 'a quién preguntar lo decide el módulo puro')
  assert(/buildCandidates\(\{ reads, activity: diarios, here: todayHere\(\), now \}\)/.test(cargar), 'y los candidatos también')
  // Los dos diarios: el de la pestaña y el del Confluence enlazado. Cada
  // candidato se cruza con el SUYO (§8.22).
  assert(/const diarios = \{ \[host\]: await getActivity\(host\) \}/.test(cargar) && /diarios\[enlazado\.host\] = await getActivity\(enlazado\.host\)/.test(cargar))
  // Y se leen DESPUÉS de las peticiones, no antes: entre una cosa y otra hay
  // segundos, y un descarte hecho en ese hueco se deshacía solo en cuanto llegaba
  // la lectura (revisión adversaria de H11). Los de antes sólo montan los ids del
  // CQL, que hay que tener para preguntar.
  assert(
    cargar.indexOf('Promise.allSettled(targets.map(') < cargar.indexOf('const diarios = { [host]: await getActivity(host) }'),
    'el diario que se cruza con lo leído se lee después de leer, no al empezar'
  )
  assert(/const paraIds = hostPaginas \? await getActivity\(hostPaginas\) : null/.test(cargar), 'y el de los ids es otro, con su nombre')
  assert(/preferredFamilies\(diarios\[host\], \{ now \}\)/.test(cargar), 'las familias también salen del diario fresco')
  // El `todayOff` del Confluence ENLAZADO: se pone desde el panel de ESE host y
  // hay que leerlo aquí, porque la lectura la lanza el Jira que lo enlaza.
  assert(/const guardadoEnlazado = enlazado && enlazado\.host !== host \? await getSite\(enlazado\.host\) : null/.test(cargar))
  assert(/linkedSaved: guardadoEnlazado,/.test(cargar), 'y viaja al módulo, que es quien decide')
  // Los avisos, por la tregua de rest-notice.js y no por una copia local.
  assert(/restFailureDue\(state\.restWarned, e\.reason, e\.host, sessionID\)/.test(cargar), 'un fallo se dice una vez por host, sesión y motivo')
  assert(/'Qué mirar hoy'/.test(cargar) && /'Qué mirar hoy no disponible'/.test(cargar), 'y los dos títulos del Registro')

  // Es del SITIO: cambiar de host lo vacía. La intención de «Analizar» NO, que
  // puede apuntar justo al host al que se acaba de llegar.
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/state\.today = emptyToday\(\)/.test(refresco), 'cambiar de host vacía lo leído')
  assert(!/state\.pendingIntent = null/.test(refresco.slice(0, refresco.indexOf('state.site = site'))), 'y no tira la intención de «Analizar»')
})

test('H11 SEGURIDAD: las lecturas de «hoy» van por plantilla, por su `kind` y sin salir del sitio', () => {
  const leer = hoyEntre('async function readToday', 'function todayFailText')
  assert(leer.length > 800, 'el cuerpo de readToday existe entero')
  // Lo que viaja es un `kind` y sus parámetros validados, NUNCA el texto de una
  // consulta: la JQL la escribe el content script con sus plantillas (§8.12).
  assert(/type: MSG\.RECENT_ISSUES/.test(leer) && /type: MSG\.RECENT_PAGES/.test(leer), 'los dos mensajes de H7, cableados aquí')
  const porPestana = leer.slice(leer.indexOf('const msg ='))
  assert(porPestana.length > 300, 'el mensaje se construye en un objeto')
  for (const prohibido of ['jql', 'cql', 'origin:', 'url:', 'path:', 'host:']) {
    assert(!porPestana.includes(prohibido), 'el mensaje a la pestaña no puede llevar «' + prohibido + '»')
  }
  assert(/kind,/.test(porPestana), 'sólo el `kind` y sus parámetros')
  assert(/projectKey: sitio\.projectKey/.test(porPestana) && /issueKey: sitio\.issueKey/.test(porPestana), 'del sitio CAPTURADO, no del de ahora')
  // El Confluence enlazado: plantillas del módulo, nunca una cadena montada
  // aquí, y sólo con el permiso YA concedido (nada de diálogos en segundo plano).
  assert(/viewedCql\(/.test(leer) && /mineCql\(/.test(leer) && /idsCql\(ids\)/.test(leer), 'el CQL sale de las tres plantillas')
  assert(!/`type ?=/.test(leer) && !/'type = page/.test(leer), 'y no se monta ninguna consulta a mano')
  assert(
    leer.indexOf('hasHostPermission(target.site.origin)') > 0 &&
      leer.indexOf('hasHostPermission(target.site.origin)') < leer.indexOf('searchContent('),
    'sin permiso sobre el dominio enlazado no se pide nada'
  )
  assert(/credentials: 'include'/.test(leer), 'y con las cookies de su sesión, que es lo que ya hacen las páginas base')
  // Un `kind` sin su parámetro sería una consulta que el content script rechaza.
  assert(/if \(!cql\) return \{ ok: false, reason: 'consulta no permitida' \}/.test(leer))

  // Una vez cada uno en todo el panel: dos emisores del mismo mensaje acabarían
  // mandando cosas distintas.
  eq((JS.match(/MSG\.RECENT_ISSUES/g) || []).length, 1, 'MSG.RECENT_ISSUES se manda desde un solo sitio')
  eq((JS.match(/MSG\.RECENT_PAGES/g) || []).length, 1, 'MSG.RECENT_PAGES también')

  // Y nada de todo esto llama al modelo ni gasta un token (§8.20).
  for (const prohibido of ['runTurn(', 'promptStructured(', 'createSession(', 'baseSystem(', 'skillSystem(', 'send()']) {
    assert(!HOY.includes(prohibido), 'recomendar no puede llamar al modelo: «' + prohibido + '»')
  }
  // Ni entra en ningún prompt: ni en la petición del turno ni en los dos
  // ficheros que los escriben.
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  const peticion = envio.slice(envio.indexOf('const peticion = {'), envio.indexOf('runTurn('))
  for (const prohibido of ['state.today', 'activity', 'todayRows', 'buildCandidates']) {
    assert(!peticion.includes(prohibido), 'la petición del turno no puede llevar «' + prohibido + '»')
  }
  for (const fichero of ['src/panel/prompts.js', 'src/panel/skills.js']) {
    const fuente = readFileSync(join(ROOT, fichero), 'utf8')
    assert(!/activity|todayRows|rankToday|analyzeQuestion/.test(fuente), 'un prompt no puede saber nada del diario: ' + fichero)
  }
})

test('H11: abrir una fila pasa por el índice y validatePlan; una del enlazado abre pestaña nueva', () => {
  const abrir = hoyEntre('async function openTodayItem', 'async function learnTodayItem')
  assert(abrir.length > 600, 'el cuerpo de openTodayItem existe entero')
  // El host ENLAZADO es otro origen: pestaña nueva y por `openUrl`, que sólo
  // abre orígenes conocidos. Nunca `NAVIGATE_DIRECT`, que se llevaría de sitio
  // la pestaña en la que el usuario está trabajando.
  assert(/linkedSite\(state\.linkedContext\)/.test(abrir))
  assert(/openUrl\(enlazado\.origin \+ canonicalPagePath\(enlazado, item\.id\)\)/.test(abrir), 'el enlazado se abre con canonicalPagePath')
  assert(/\/\^\\d\{1,19\}\$\//.test(abrir), 'y con el id validado: de aquí sale una URL')
  assert(!/NAVIGATE_DIRECT/.test(abrir), 'el enlazado nunca cambia de sitio la pestaña')
  assert(
    abrir.includes('validatePlan(') && abrir.indexOf('openUrl(enlazado.origin') < abrir.indexOf('validatePlan('),
    'y se sale antes de llegar al plan: su id no está en el índice de este sitio'
  )
  // El host PROPIO: al índice primero y el destino por la barrera de siempre
  // (§8.3). Aquí no se concatena ninguna URL.
  assert(
    abrir.includes('await learnTodayItem(item, site)') &&
      abrir.indexOf('await learnTodayItem(item, site)') < abrir.indexOf('validatePlan('),
    'lo que se abre se funde en el índice ANTES de validar el plan'
  )
  assert(/validatePlan\(\s*\{ navigate: true, mode: 'direct', destination: \{ kind: item\.kind, id: item\.id \} \}/.test(abrir))
  assert(/index: state\.index, origin: site\.origin, host: site\.host, here: state\.tabUrl, site/.test(abrir))
  assert(/runPlan\(r\.plan, 'direct', caja\)/.test(abrir), 'y lo lanza el mismo runPlan de siempre')
  // Todo fallo silencioso tiene contraparte visible (§8.14): sin tarjeta donde
  // colgarlo, al chat.
  assert(/showNotice\(aviso, true, \{ force: true \}\)/.test(abrir) && /announce\(aviso\)/.test(abrir))
  assert(/if \(!card && caja\.textContent\) showNotice\(caja\.textContent, true, \{ force: true \}\)/.test(abrir))

  // Y se funde con las MISMAS funciones que la lista de una búsqueda y la
  // pantalla de páginas base: una tercera forma de meter algo en el índice sería
  // una tercera forma de equivocarse.
  const aprender = hoyEntre('async function learnTodayItem', 'async function analyzeTodayItem')
  assert(/harvestFromSearch\(\[\{ key: item\.id, summary: item\.title \}\], \{ site, index: state\.index \}\)/.test(aprender))
  assert(/mergePagesIntoIndex\(\[\{ id: item\.id, title: item\.title \}\]\)/.test(aprender))
  // Es un clic fuera de un turno, así que se escribe aquí: `persistIndex()` sólo
  // corre al final de uno (P3 de H6).
  assert(/saveIndex\(site\.host, index\)/.test(aprender) && !/markIndexDirty\(/.test(aprender))
})

test('H11: «Analizar» navega y deja la pregunta escrita, y nunca la manda', () => {
  const analizar = hoyEntre('async function analyzeTodayItem', 'async function consumePendingIntent')
  assert(/analyzeQuestion\(item, diario\)/.test(analizar), 'la pregunta la escribe el módulo puro, con el diario de ese host')
  // La intención se apunta ANTES de navegar: `refreshTab` corre en cuanto la
  // pestaña cambia, y apuntarla después sería llegar tarde a la página.
  assert(
    analizar.includes('await openTodayItem(item)') &&
      analizar.indexOf('state.pendingIntent = {') < analizar.indexOf('await openTodayItem(item)'),
    'la intención se apunta antes de navegar'
  )
  assert(/if \(!abierto\) state\.pendingIntent = null/.test(analizar), 'y se tira si el viaje no sale')

  const consumir = hoyEntre('async function consumePendingIntent', 'async function dismissTodayItem')
  assert(/Date\.now\(\) - intent\.at > TODAY_LIMITS\.intentMs/.test(consumir), 'caduca con el plazo del módulo')
  assert(/site\.host !== intent\.host/.test(consumir), 'y sólo en el host que la dejó')
  // Host Y identificador: una clave que es prefijo de otra no es la misma
  // página (M3), y el id se reconstruye con la validadora.
  assert(/validIssueKey\(site\.issueKey\) === intent\.id/.test(consumir))
  assert(/String\(site\.pageId \|\| currentPageId\(state\.index, state\.tabUrl\) \|\| ''\) === intent\.id/.test(consumir))
  // Y ese identificador CIERRA el paso: sin el `return`, llegar a otra página del
  // mismo host escribiría ahí la pregunta y cambiaría la Skill. Lo calculaba y no
  // lo usaba nadie en el pin (revisión adversaria de H11).
  assert(
    consumir.indexOf('if (!aqui) return') >= 0 && consumir.indexOf('if (!aqui) return') < consumir.indexOf("setSkill('analisis')"),
    'lo que no es la página que esperaba la pregunta se va antes de tocar nada'
  )
  assert(/setSkill\('analisis'\)/.test(consumir) && /saveSite\(site\.host, \{ skill: 'analisis' \}\)/.test(consumir), 'la Skill se fija y se guarda')
  assert(/el\.input\.value = intent\.question/.test(consumir) && /el\.input\.focus\(\)/.test(consumir), 'y la pregunta se DEJA en el cuadro')
  assert(/announce\(/.test(consumir), 'y se dice en voz alta: un cuadro que se rellena solo, sin voz, es magia (A2)')
  assert(!/\bsend\(/.test(consumir), 'Faro NUNCA manda una pregunta por su cuenta (§8.20)')

  // Se consume en `refreshTab`, y lo ÚLTIMO: `bootForSite` fija la Skill
  // guardada del sitio y antes la pisaría.
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/await consumePendingIntent\(site\)/.test(refresco))
  assert(
    refresco.includes('await bootForSite()') &&
      refresco.lastIndexOf('await bootForSite()') < refresco.indexOf('await consumePendingIntent(site)'),
    'después de cualquier arranque, que fija la Skill del sitio'
  )
})

test('H11: el panel apunta en el diario sólo lo que sólo él sabe, y se borra con el sitio', () => {
  // El único escritor de «visto» es el service worker (docs/PLAN.md §3.1): el
  // panel no apunta ninguna visita.
  assert(!/'seen'/.test(HOY) && !/event: 'seen'/.test(JS), 'el panel no apunta visitas: de eso hay un solo escritor')

  // Las tres condiciones son las MISMAS que aplica el worker antes de apuntar.
  const apuntarDiario = hoyEntre('async function noteActivity', 'async function noteAnalyzed')
  assert(/!state\.settings\.restTools \|\| !state\.settings\.todaySuggestions/.test(apuntarDiario), 'los dos interruptores')
  assert(/if \(!saved\?\.configured\) return null/.test(apuntarDiario), 'y sólo hosts configurados')
  assert(/recordActivity\(host, evento\)/.test(apuntarDiario) && /\.catch\(/.test(apuntarDiario), 'y el diario no puede tumbar nada')

  // Un análisis: cuándo, con cuántas observaciones y de qué familia.
  const analizado = hoyEntre('async function noteAnalyzed', 'function observationCount')
  assert(/event: 'analyzed'/.test(analizado))
  assert(/notes: observationCount\(answer, anchors\)/.test(analizado), 'las observaciones, contadas de la respuesta')
  assert(/issueFamily\(issue, \{ summary: titulo \}\)/.test(analizado), 'y la familia, con la misma función que elige qué pedirle al modelo')
  assert(!/path:/.test(analizado), 'la ruta la apunta la VISITA, que es quien sabe de qué URL vino')
  const contar = sinComentarios(JS.slice(JS.indexOf('function observationCount')))
  assert(/normalizeNumbering\(answer, \{ expected: expectedCount\(anchors\), shortAnswer: NOTE_LIMITS\.shortAnswer \}\)/.test(contar))
  assert(/observationNumbers\(adaptada\.prose, anchors\)\.numeros\.length/.test(contar), 'la misma escalera que offerNotes')

  // El gancho del turno apunta el diario para CUALQUIER Análisis, también sin
  // páginas base: la mayoría no las llevan.
  const apuntar = sinComentarios(JS.slice(JS.indexOf('async function recordAnalysisTurn'), JS.indexOf('function computeSuggested')))
  assert(
    apuntar.indexOf('await noteAnalyzed({') > 0 && apuntar.indexOf('await noteAnalyzed({') < apuntar.indexOf('if (!sources?.pages?.length) return'),
    'el diario se apunta antes del corte por páginas base'
  )
  const envio = sinComentarios(JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn(')))
  const llamada = envio.slice(envio.indexOf('recordAnalysisTurn('), envio.indexOf("cron.mark('pintar')"))
  assert(/\banswer,/.test(llamada) && /\banchors,/.test(llamada), 'y recibe la prosa y el bloque de anclas para contarlas')

  // Una página base elegida se apunta bajo el host de la PÁGINA: desde un Jira
  // Data Center, el del Confluence enlazado (§8.22).
  const alta = sinComentarios(JS.slice(JS.indexOf('async function addSource('), JS.indexOf('async function removeSource')))
  assert(/noteActivity\(linkedHost\(\) \|\| state\.site\.host, \{/.test(alta) && /event: 'source'/.test(alta))

  // «Ya lo he visto» se escribe por la puerta del diario, que es la que tiene la
  // cola: hasta la revisión adversaria de H11 hacía su propio lee-funde-escribe
  // aquí, así que un descarte a la vez que un análisis se perdía, y uno en vuelo
  // durante «Borrar mi actividad» devolvía el diario recién borrado.
  const descartar = hoyEntre('async function dismissTodayItem', 'async function clearMyActivity')
  assert(/await dismissActivity\(host, clave, item\.updatedAt\)/.test(descartar))
  assert(/activityKey\(item\?\.kind, item\?\.id\)/.test(descartar))
  assert(!/getActivity\(/.test(descartar) && !/dismissItem\(/.test(descartar), 'ni lee ni funde aquí: eso es del almacén')
  eq(sinComentarios(JS).match(/\bsaveActivity\(/g), null, 'y en todo el panel no queda ninguna escritura del diario fuera de la cola')

  // «Borrar mi actividad» se lleva el diario y su caché, también los del
  // Confluence enlazado: sus páginas salen en esta misma lista.
  const borrar = hoyEntre('async function clearMyActivity', 'async function noteActivity')
  assert(/clearActivity\(host\)/.test(borrar) && /clearTodayCache\(host\)/.test(borrar))
  assert(/clearActivity\(enlazado\.host\)/.test(borrar), 'y el del enlazado, que desde Jira nadie más va a borrar')
  assert(/state\.today = emptyToday\(\)/.test(borrar))

  // Y «Olvidar este sitio» también, pero desde H13 por UNA sola puerta: el diario
  // (con su marca de borrado), la caché de «hoy» y todo lo demás de este host se
  // van dentro de `forgetEverythingFor`, que es quien llama a `clearActivity`
  // —ANTES de quitar ninguna clave, porque es esa marca la que el service worker
  // relee antes de guardar: sin ella una visita que ya hubiera leído devolvía el
  // diario entero unos milisegundos después (revisión adversaria de H11)—. Que se
  // lleve TODAS las claves por host lo pina storage.test.js; aquí, que el panel
  // no se quede con el diario en memoria.
  const olvidarSitio = sinComentarios(JS.slice(JS.indexOf("$('btn-forget').addEventListener"), JS.indexOf("$('mem-enabled').addEventListener")))
  assert(/forgetEverythingFor\(host\)/.test(olvidarSitio) && /state\.today = emptyToday\(\)/.test(olvidarSitio))
  assert(
    !/clearActivity\((?!enlazado\.host\))|clearTodayCache\((?!enlazado\.host\))|memory\.clearMemory\(|clearSessionId\(/.test(olvidarSitio),
    'y ninguna clave de ESTE host se borra a mano aquí: eran siete llamadas que había que acordarse de escribir (H13); lo único a mano es el diario del enlazado (revisión de H13)'
  )
  const almacen = readFileSync(join(ROOT, 'src/shared/storage.js'), 'utf8')
  const puerta = sinComentarios(almacen.slice(almacen.indexOf('export async function forgetEverythingFor')))
  assert(
    puerta.indexOf('await clearActivity(host)') >= 0 && puerta.indexOf('await clearActivity(host)') < puerta.indexOf('.remove('),
    'el diario se borra por su puerta y antes que ninguna otra clave'
  )
})

// -------------------------------------- «Qué mirar hoy»: la interfaz (H11, paso 9)

/** El trozo de la interfaz de «hoy», sin comentarios y acotado por CÓDIGO. */
const HOY_UI = sinComentarios(JS.slice(JS.indexOf('const EMPTY_LIMITS = {')))
const uiEntre = (desde, hasta) => sinComentarios(JS.slice(JS.indexOf(desde), JS.indexOf(hasta)))

test('H11: el quinto botón de la cabecera es «Qué mirar hoy», con su insignia y su pantalla', () => {
  // El hueco que H5 dejó anotado. Las acciones no se encogen, así que quien
  // cede a 320 px sigue siendo el chip de ubicación (pinado en el test de H5).
  const acciones = HTML.slice(HTML.indexOf('<div class="top-actions">'), HTML.indexOf('</header>'))
  eq((acciones.match(/class="icon-btn"/g) || []).length, 5, 'cinco botones en la cabecera, ni uno más')
  assert(
    acciones.indexOf('id="btn-new-session"') < acciones.indexOf('id="btn-today"') &&
      acciones.indexOf('id="btn-today"') < acciones.indexOf('id="btn-memory"'),
    '«Qué mirar hoy» va entre «Nueva sesión» y «Memoria»'
  )
  // El número es `aria-hidden` y quien lo dice es el NOMBRE del botón: un
  // `aria-label` fijo tapa al `title`, y un lector de pantalla oiría lo mismo
  // con tres novedades y con ninguna (la regresión de H5 con #btn-memory).
  assert(/id="today-count"/.test(acciones) && /class="badge hidden" id="today-count" aria-hidden="true"/.test(acciones))
  assert(acciones.indexOf('id="today-count"') > acciones.indexOf('id="btn-today"'), 'la insignia vive dentro del botón')

  const insignia = uiEntre('function paintTodayBadge()', 'function paintTodayBlock(')
  assert(/const n = todayEnabled\(\) \? todayCount\(\) : 0/.test(insignia), 'cuenta lo NUEVO, y sólo si está encendido')
  // Y lo que cuenta `todayCount` es lo NUEVO de verdad: nada lo pinaba, así que
  // podía volver a contar las filas que hay (revisión adversaria de H11). Sin
  // esto la insignia no significa nada: enseñaría un 8 fijo todos los días.
  const cuenta = uiEntre('function todayCount()', 'async function markTodaySeen()')
  assert(/return countNew\(todayRows\(\), state\.today\.seenAt\)/.test(cuenta), 'la insignia es lo que ha cambiado desde que se miró')
  assert(/insignia\.classList\.toggle\('hidden', !n\)/.test(insignia), 'sin novedades no queda un hueco vacío')
  assert(/boton\.title = nombre/.test(insignia) && /boton\.setAttribute\('aria-label', nombre\)/.test(insignia), 'el tooltip y el nombre dicen lo mismo')
  for (const texto of ['Qué mirar hoy: ${n} ${n === 1 ? \'novedad\' : \'novedades\'}', "'Qué mirar hoy'"]) {
    assert(insignia.includes(texto), 'falta el nombre del botón: ' + texto)
  }
  assert(/boton\.classList\.toggle\('on', n > 0\)/.test(insignia), 'y con algo que mirar el botón se enciende')

  // La pantalla se abre desde el botón y se cierra con la flecha de su cabecera
  // (el mapa de Escape lo pina screens.test.js).
  assert(/\$\('btn-today'\)\.addEventListener\('click', \(\) => showTodayScreen\(\)/.test(JS))
  assert(/showScreen\('screen-today'\)/.test(JS), 'y es una pantalla como las demás')
  assert(ESCAPE_CLOSES['screen-today'] === 'btn-today-close', 'Escape la cierra por su flecha')
})

test('H11: el chat vacío enseña hasta tres filas, y si no caben se queda en una línea', () => {
  // La caja sigue naciendo vacía y oculta: sin nada que enseñar, el estado
  // vacío es byte a byte el de antes de H11.
  const vacio = sinComentarios(JS.slice(JS.indexOf('function showWelcome'), JS.indexOf('function paintSearchChips')))
  assert(/'today hidden'/.test(vacio), 'la caja de «hoy» nace oculta, como la dejó H5')
  assert(!/paintTodayBlock\(/.test(vacio), 'y no la llena showWelcome: la llenan los chips, que saben cuántos son')

  // El presupuesto se reparte con las pastillas de H8, así que quien las pinta
  // dice cuántas hay. Va ANTES de su salida temprana: sin pastillas también hay
  // que repintar «hoy».
  const chips = sinComentarios(JS.slice(JS.indexOf('function paintSearchChips'), JS.indexOf('async function loadSearchChipSources')))
  assert(/paintTodayBlock\(null, \{ chips: chips\.length \}\)/.test(chips), 'los chips repintan «hoy» con su cuenta')
  assert(
    chips.indexOf('paintTodayBlock(null,') < chips.indexOf('if (!chips.length) return'),
    'y antes de la salida por «no hay chips», o el bloque no se pintaría nunca sin ellos'
  )

  const bloque = uiEntre('function paintTodayBlock(', "function todayMoreButton(")
  assert(/const caja = box \|\| el\.chat\.querySelector\('\.empty \.today'\)/.test(bloque))
  assert(/if \(!caja\?\.isConnected\) return/.test(bloque), 'el chat pudo repintarse entre que se pidió la lista y llegó')
  // Sin candidatos y sin diario, el chat vacío es byte a byte el de antes de
  // H11: la caja se vacía, se esconde y no se le cuelga nada.
  assert(/caja\.textContent = ''/.test(bloque), 'la caja se vacía antes de decidir nada')
  assert(/caja\.classList\.toggle\('hidden', !todas\.length\)/.test(bloque), 'sin filas, la caja se queda oculta y vacía')
  assert(/if \(!todas\.length\) return/.test(bloque), 'y ahí se acaba: ni rótulo, ni «Ver todo», ni una línea')
  assert(/const todas = todayEnabled\(\) \? todayRows\(\) : \[\]/.test(bloque), 'y con los interruptores apagados no hay filas')
  assert(/todas\.slice\(0, TODAY_LIMITS\.emptyRows\)/.test(bloque), 'el tope del estado vacío es el del módulo, no un 3 a mano')
  assert(!/showWelcome\(\)/.test(bloque), 'se repinta sólo esta caja: repintar el estado vacío volvería a anunciarlo (A2)')
  assert(/`Qué mirar hoy \(\$\{todas\.length\}\)`/.test(bloque), 'degradado: una línea con cuántas hay')
  assert(/`Ver todo \(\$\{todas\.length\}\)`/.test(bloque), 'y entero: las filas y «Ver todo»')
  // La degradación la DECIDE `emptyFits`, y la línea vive dentro de esa rama:
  // nada lo pinaba, así que se podía desactivar en verde y el chat vacío se
  // llenaba de recomendaciones (revisión adversaria de H11).
  assert(/if \(!emptyFits\(filas\.length, pastillas\)\) \{/.test(bloque), 'quien decide es emptyFits, con las filas y las pastillas')
  assert(
    bloque.indexOf('if (!emptyFits(filas.length, pastillas)) {') < bloque.indexOf('`Qué mirar hoy (${todas.length})`') &&
      bloque.indexOf('`Qué mirar hoy (${todas.length})`') < bloque.indexOf("kicker.className = 'today-kicker'"),
    'la línea sola es lo único de esa rama, y el rótulo con las filas queda detrás'
  )

  // El criterio no mide nada —el panel puede estar oculto al pintar—: cuenta
  // piezas. Con las cuatro pastillas que puede ofrecer H8 ya no cabe.
  const cabe = uiEntre('function emptyFits(', 'function paintTodayUi()')
  assert(/const deHoy = rows > 0 \? rows \+ 2 : 0/.test(cabe), 'las filas más su rótulo y su «Ver todo»')
  assert(/1 \+ Math\.ceil\(chips \/ EMPTY_LIMITS\.chipsPerLine\)/.test(cabe), 'y las pastillas, que envuelven de dos en dos')
  assert(/deHoy \+ SUGGESTION_COUNT \+ dePastillas <= EMPTY_LIMITS\.lines/.test(cabe), 'contra el presupuesto, con las tres sugerencias dentro')
  const lineas = Number(/lines: (\d+)/.exec(HOY_UI)[1])
  const porLinea = Number(/chipsPerLine: (\d+)/.exec(HOY_UI)[1])
  const entra = (rows, pastillas) =>
    (rows > 0 ? rows + 2 : 0) + SUGGESTION_COUNT + (pastillas > 0 ? 1 + Math.ceil(pastillas / porLinea) : 0) <= lineas
  assert(entra(TODAY_LIMITS.emptyRows, 0), 'en Confluence, sin pastillas, las tres filas caben')
  assert(!entra(TODAY_LIMITS.emptyRows, SEARCH_CHIP_COUNT), 'con todas las pastillas de H8, no: una línea')
})

test('H11: cada fila dice de qué es y por qué, y sus botones también', () => {
  const fila = uiEntre('function todayRowNode(item,', 'async function showTodayScreen()')
  // Todo con textContent: los títulos son texto de Jira y de Confluence (§8.12).
  assert(/title\.textContent = item\.title/.test(fila) && /why\.textContent = item\.why/.test(fila))
  assert(/kind\.textContent = item\.kind === 'jira-issue' \? item\.id : 'Confluence'/.test(fila), 'la clave de la incidencia, o de qué producto es')
  // El porqué lo escribió today.js: aquí no se compone ninguna razón.
  assert(!/reasonText\(/.test(HOY_UI) && !/groupOf\(/.test(HOY_UI), 'el motivo y el grupo vienen hechos de la puntuación')

  // Nombres accesibles con el título dentro: sin eso, un lector de pantalla lee
  // ocho «Abrir, botón» seguidos.
  for (const nombre of ['`Abrir «${item.title}»`', '`Analizar «${item.title}»`', '`Ya lo he visto: «${item.title}»`']) {
    assert(fila.includes(nombre), 'falta el nombre accesible: ' + nombre)
  }
  // Compacta (chat vacío): la fila entera abre. Completa (pantalla): tres acciones.
  assert(/row\.addEventListener\('click', \(\) => openTodayItem\(item\)/.test(fila), 'la fila compacta abre lo suyo')
  assert(/openTodayItem\(item, \{ card: row \}\)/.test(fila), 'y «Abrir» cuelga de la fila lo que falle (§8.14)')
  assert(/x\.addEventListener\('click', \(\) => forgetTodayRow\(item\)/.test(fila))

  // «Analizar» fija la Skill y escribe en el cuadro: con un turno en vuelo, no.
  assert(/analizar\.className = 'ghost small ' \+ NEEDS_IDLE/.test(fila) && /analizar\.disabled = state\.streaming/.test(fila))
  const analizar = uiEntre('async function analyzeFromToday(item)', 'async function forgetTodayRow(item)')
  assert(/if \(state\.streaming\) \{/.test(analizar) && /showNotice\('Espera a que termine la respuesta\.'/.test(analizar))
  assert(/await analyzeTodayItem\(item\)/.test(analizar), 'la intención y el viaje los pone la lógica de C')
  assert(/hideScreens\(\)/.test(analizar), 'y la pantalla se cierra: la pregunta se escribe DEBAJO de ella')
  // Del camino bueno sólo se sale cerrando: un `return` de más ahí dejaría la
  // pregunta escrita bajo una pantalla que la tapa, con `#app` inerte.
  eq(
    (analizar.slice(analizar.indexOf('const abierto =')).match(/\breturn\b/g) || []).length,
    1,
    'el único return es el del fallo'
  )
  assert(!/\bsend\b/.test(analizar), 'Faro nunca la manda por su cuenta (§8.20)')

  // Los NEEDS_IDLE de la pantalla no están en el chat, así que `setStreaming`
  // los recorre aparte: si no, nacerían desactivados y ahí se quedarían.
  const streaming = sinComentarios(JS.slice(JS.indexOf('function setStreaming(on)'), JS.indexOf('function showBusy(')))
  assert(/for \(const b of el\.chat\.querySelectorAll\('\.' \+ NEEDS_IDLE\)\) b\.disabled = on/.test(streaming), 'los del chat, como en H6')
  assert(/for \(const b of \$\('screen-today'\)\.querySelectorAll\('\.' \+ NEEDS_IDLE\)\) b\.disabled = on/.test(streaming), 'y los de la pantalla de «hoy»')

  // La lista, por grupos y con el porqué de que venga corta.
  const pantalla = uiEntre('async function paintToday(', 'function todayGroupTitle(grupo)')
  assert(/const TODAY_GROUPS = \['cambio', 'tuyo', 'proyecto'\]/.test(HOY_UI), 'los tres grupos, en el orden en que se leen')
  assert(/for \(const grupo of TODAY_GROUPS\)/.test(pantalla) && /h\.className = 'today-group'/.test(pantalla))
  assert(/for \(const aviso of state\.today\.notices\) lista\.appendChild\(noticeNode\(aviso, true\)\)/.test(pantalla), 'y los avisos con tregua de rest-notice.js')
  const titulos = uiEntre('function todayGroupTitle(grupo)', 'function setTodayStatus(texto)')
  assert(/'Cambió desde que lo miraste'/.test(titulos) && /'Lo tuyo'/.test(titulos) && /`Nuevo en \$\{ambito\}`/.test(titulos))
  assert(/state\.site\?\.projectKey \|\| state\.site\?\.spaceKey/.test(titulos), 'el ámbito sale del sitio, ya validado por parseAtlassianUrl')

  // Y todo lo que el JS pinta se ve: la REGLA con su llave, no el nombre suelto
  // (`.today-loquesea` contiene `.today` y dejaría el pin en verde).
  for (const clase of ['today', 'today-kicker', 'today-group', 'today-row', 'today-main', 'today-kind', 'today-title', 'today-why', 'today-actions', 'today-more']) {
    assert(new RegExp('\\.' + clase + '[\\s,{]').test(CSS_LIMPIO), 'clase sin estilo: ' + clase)
  }
  assert(/\.today-row\.new\s*\{[^}]*inset 2px 0 0 var\(--mark\)/.test(CSS_LIMPIO), 'lo que ha cambiado desde que miraste lleva el filete de la marca')
})

test('H11: la pantalla dice qué guarda y dónde, y se puede apagar, actualizar y borrar', () => {
  // La promesa de §8.20, escrita donde se ve y con las cuentas de este sitio.
  const diario = uiEntre('async function paintTodayActivity()', 'function activityCounts(activity)')
  assert(/\$\('today-activity-text'\)\.textContent =/.test(diario))
  assert(/ACTIVITY_LIMITS\.maxAgeDays/.test(diario), 'los días los dice el módulo del diario, no un 30 a mano')
  for (const frase of ['no sale de aquí', 'no entra en nada de ', 'Borrarlo no borra nada en Jira ni en Confluence']) {
    assert(diario.includes(frase), 'falta la promesa: ' + frase)
  }
  const cuentas = uiEntre('function activityCounts(activity)', 'async function analyzeFromToday(item)')
  assert(/entradas: items\.length/.test(cuentas) && /i\?\.analyzedAt/.test(cuentas) && /i\?\.sourceAt/.test(cuentas))
  // Y los descartes, que también son datos guardados: decir «0 entradas» de un
  // diario con doce «ya lo he visto» dentro era la promesa a medias que encontró
  // la revisión adversaria de H11.
  assert(/descartes: Object\.keys\(activity\?\.dismissed \|\| \{\}\)\.length/.test(cuentas))
  assert(/\$\{descartes\} \$\{descartes === 1 \? 'descarte' : 'descartes'\}/.test(diario), 'y se dicen en la línea de la pantalla')

  // El interruptor por sitio: se lee normalizado y se guarda en el registro del
  // sitio, como `skill` o `model`.
  const abrir = uiEntre('async function showTodayScreen()', 'async function paintToday(')
  assert(/\$\('today-off'\)\.checked = saved\?\.todayOff === true/.test(abrir), 'normalizado al leer: lo que no sea true no lo escribió Faro')
  const apagar = uiEntre('async function setTodayOff(off)', 'function paintTodaySetting()')
  assert(/saveSite\(host, \{ todayOff: !!off \}\)/.test(apagar) && /state\.today = emptyToday\(\)/.test(apagar))
  assert(/await refreshToday\(\)/.test(apagar), 'y encenderlo vuelve a mirar en el acto')
  // Y la casilla dice QUÉ apaga, porque no apaga lo que uno esperaría: las
  // lecturas y las sugerencias de ese sitio, no el diario, que lo gobiernan los
  // dos interruptores globales (revisión adversaria de H11).
  const casillaSitio = HTML.slice(HTML.indexOf('id="today-off"'), HTML.indexOf('id="btn-today-refresh"'))
  assert(/Faro sigue\s+apuntando lo que abres aquí/.test(casillaSitio), 'la casilla dice que Faro sigue apuntando')
  assert(/apaga «Qué mirar hoy» en Ajustes/.test(casillaSitio), 'y dónde se apaga el apuntado')
  assert(/desde el Jira que lo tenga enlazado/.test(casillaSitio), 'y que también calla al Jira que lo enlaza')

  // La insignia cuenta lo nuevo desde que se MIRÓ la lista, y eso sobrevive a
  // cerrar el panel: si no, cada apertura lo contaría todo como novedad.
  const visto = uiEntre('async function markTodaySeen()', 'function todaySeenAt(saved)')
  assert(/state\.today\.seenAt = Date\.now\(\)/.test(visto) && /saveSite\(host, \{ todaySeenAt: state\.today\.seenAt \}\)/.test(visto))
  const normaliza = uiEntre('function todaySeenAt(saved)', '/**\n * Abrir una fila.')
  assert(/Number\.isFinite\(at\) && at > 0 \? at : 0/.test(normaliza), 'normalizado al leer, como todo lo que viene del almacén')
  const cargar = sinComentarios(JS.slice(JS.indexOf('async function loadToday'), JS.indexOf('async function fetchTodayTarget')))
  assert(/hoy\.seenAt = todaySeenAt\(saved\)/.test(cargar), 'y se recupera con el sitio')
  // Detrás de la guarda del testigo y del host, como las demás asignaciones y
  // sobre `hoy`: escrito antes, la fecha de un sitio acababa en el estado de otro
  // (§8.22, revisión adversaria de H11).
  assert(
    cargar.indexOf('!== host) return') < cargar.indexOf('hoy.seenAt = todaySeenAt(saved)'),
    'la fecha de «ya la miré» no se escribe hasta saber que este arranque y este host siguen siendo los suyos'
  )
  assert(!/state\.today\.seenAt =/.test(cargar), 'y no por `state.today`, que es lo que la escribía antes de saberlo')
  assert(
    abrir.indexOf('const desde = state.today.seenAt') < abrir.indexOf('await markTodaySeen()'),
    'lo nuevo se marca contra la visita ANTERIOR: abrir la pantalla no puede borrar la marca que la explica'
  )

  // «Actualizar» se salta la caché; «Borrar mi actividad» se lleva el diario y
  // su caché (y el del Confluence enlazado), y las dos repintan.
  const actualizar = uiEntre('async function refreshToday()', 'async function forgetTodayActivity()')
  assert(/await loadToday\(\{ force: true \}\)/.test(actualizar) && /btn\.disabled = true/.test(actualizar))
  const borrar = uiEntre('async function forgetTodayActivity()', 'async function setTodayOff(off)')
  assert(/await clearMyActivity\(\)/.test(borrar) && /paintTodayBadge\(\)/.test(borrar))

  // El permiso se pide desde aquí, porque esta pantalla tapa la tarjeta del chat.
  const permiso = uiEntre('async function todayMissingPermission()', 'async function paintTodayActivity()')
  assert(/hasHostPermission\(site\.origin\)/.test(permiso) && /linkedSite\(state\.linkedContext\)/.test(permiso), 'el del sitio o el del Confluence enlazado')
  assert(/requestHostPermission\(falta\)/.test(permiso) && /manualPermissionText\(falta\.origin\)/.test(permiso))
  assert(/fila\.classList\.toggle\('hidden', !falta\)/.test(permiso), 'y la fila sólo sale si de verdad falta')

  // El Registro: cuentas y motivos, nunca títulos ni ids (§8.20).
  const estado = sinComentarios(JS.slice(JS.indexOf('async function paintState()'), JS.indexOf('async function treeDebug')))
  assert(/add\(\s*'actividad',/.test(estado) && /add\(\s*'sugerencias',/.test(estado))
  assert(/todaySummary\(\{ items: todayRows\(\), errors: state\.today\.errors \}\)/.test(estado), 'la línea la escribe la función pura que no imprime títulos')
  const filasEstado = estado.slice(estado.indexOf("add(\n    'actividad',"))
  assert(!/\.title\b/.test(filasEstado) && !/item\.id/.test(filasEstado), 'ni un título ni un id en la pantalla de estado')
})

test('H11: la casilla de Ajustes cuelga del interruptor maestro, y todo se aplica en caliente', () => {
  const ajustes = HTML.slice(HTML.indexOf('id="screen-settings"'), HTML.indexOf('id="screen-memory"'))
  assert(
    ajustes.indexOf('id="set-rest-tools"') < ajustes.indexOf('id="set-today"'),
    'la casilla de «hoy» va debajo de la de las lecturas REST, que es de quien depende'
  )
  assert(htmlIds.has('set-today-hint'), 'y la explicación de por qué no se puede marcar')

  const pantalla = sinComentarios(JS.slice(JS.indexOf('async function showSettingsScreen'), JS.indexOf('function setStatus')))
  assert(/\$\('set-today'\)\.checked = state\.settings\.todaySuggestions/.test(pantalla), 'al abrir refleja lo guardado')
  assert(/paintTodaySetting\(\)/.test(pantalla), 'y si el maestro está apagado, lo dice')
  const cerrar = sinComentarios(JS.slice(JS.indexOf("$('btn-settings-close')"), JS.indexOf("$('btn-reindex')")))
  assert(/todaySuggestions: \$\('set-today'\)\.checked,/.test(cerrar), 'al cerrar se guarda, como restTools')

  // Es lo último del fichero: se corta desde su firma hasta el final.
  const casilla = sinComentarios(JS.slice(JS.indexOf('function paintTodaySetting()')))
  assert(/\$\('set-today'\)\.disabled = !maestro/.test(casilla) && /\$\('set-today-hint'\)\.classList\.toggle\('hidden', maestro\)/.test(casilla))
  const eventos = sinComentarios(JS.slice(JS.indexOf('function wireEvents'), JS.indexOf('async function saveKeys')))
  assert(/\$\('set-rest-tools'\)\.addEventListener\('change', paintTodaySetting\)/.test(eventos), 'y se apaga en cuanto se apaga el de arriba')
  for (const id of ['btn-today-close', 'btn-today-refresh', 'btn-today-forget', 'today-off', 'btn-today-permission']) {
    assert(eventos.includes(`$('${id}').addEventListener`), 'sin cablear: ' + id)
  }

  // En caliente, los dos sentidos: apagar el interruptor se lleva la insignia y
  // el bloque del chat vacío sin cambiar de sitio, y encenderlo los devuelve.
  const aplicar = sinComentarios(JS.slice(JS.indexOf('function applySettingsToUi'), JS.indexOf('function wireEvents')))
  assert(/paintTodayUi\(\)/.test(aplicar))
  const pintarTodo = uiEntre('function paintTodayUi()', 'function paintTodayBadge()')
  assert(/paintTodayBadge\(\)/.test(pintarTodo) && /paintTodayBlock\(\)/.test(pintarTodo))
  assert(/if \(!\$\('screen-today'\)\.classList\.contains\('hidden'\)\) paintToday\(\)/.test(pintarTodo), 'y la pantalla, si está delante')

  // Es del SITIO: cambiar de host vacía la lista y la insignia con ella.
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(
    refresco.indexOf('state.today = emptyToday()') < refresco.indexOf('paintTodayUi()'),
    'primero se vacía lo leído y después se repinta: un «3» de otro host es mentira'
  )
  // Y lo que llega tarde se pinta cuando llega, sin esperar a nadie.
  const soon = uiEntre('function loadTodaySoon(testigo)', '/**\n * Lee lo que ha cambiado')
  assert(/\.finally\(\(\) => paintTodayUi\(\)\)/.test(soon), 'lo leído fuera del arranque acaba en la pantalla')
})

test('H11: el espejo enseña «Qué mirar hoy» en sus tres sitios, y mide si el chat vacío cabe', () => {
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')

  // El panel no corre en el banco, así que la pantalla, el bloque del chat
  // vacío y la insignia sólo se pueden mirar aquí. Y las filas las puntúa el
  // MÓDULO de verdad: una lista copiada a mano seguiría enseñando los motivos
  // de antes en cuanto cambiara la tabla de puntos (la lección de H10).
  assert(/import\('\/src\/panel\/today\.js'\)/.test(espejo) && /import\('\/src\/atlassian\/activity\.js'\)/.test(espejo), 'el espejo importa quien puntúa y el diario')
  const filas = espejo.slice(espejo.indexOf('function filasDeHoy()'), espejo.indexOf('const PRESUPUESTO_VACIO'))
  assert(/buildCandidates\(\{ reads: suyas, activity: DIARIOS_HOY/.test(filas) && /rankToday\(candidatos,/.test(filas), 'con las dos mitades: lo leído y el diario')
  assert(/preferredFamilies\(d, \{ now: AHORA \}\)/.test(filas), 'y con las familias que más se analizan, como el panel')
  // Desde una pestaña de Confluence no se consulta el Jira enlazado (v1), así
  // que esa conversación enseña sólo sus páginas: es lo que decide `todayTargets`.
  assert(/s\.product === 'confluence' \? LECTURAS_HOY\.filter\(\(r\) => r\.product === 'confluence'\) : LECTURAS_HOY/.test(filas), 'desde Confluence, sólo Confluence')
  // Las lecturas de ejemplo llevan las claves de los dos parsers, y hay una
  // cerrada y una página base para ver cada clase de motivo.
  const fixture = espejo.slice(espejo.indexOf('const LECTURAS_HOY ='), espejo.indexOf('const DIARIOS_HOY'))
  for (const clave of ['key:', 'summary:', 'statusCategory:', 'lastViewedAt:', 'updatedAt:', 'updatedBy:']) {
    assert(fixture.includes(clave), 'la lectura de ejemplo no trae ' + clave)
  }
  assert(/statusCategory: 'done'/.test(fixture), 'y una cerrada al lado de una viva')
  const diarios = espejo.slice(espejo.indexOf('const DIARIOS_HOY'), espejo.indexOf('const HOY_VISTO'))
  assert(/event: 'analyzed'/.test(diarios) && /event: 'source'/.test(diarios) && /recordVisit\(/.test(diarios), 'el diario trae lo analizado, lo usado de base y lo visto')

  // El bloque del chat vacío, con el mismo presupuesto que el panel: aquí se
  // copia —panel.js arranca solo y no se puede importar— y este pin es lo que
  // impide que los dos números se separen.
  const presupuesto = espejo.slice(espejo.indexOf('const PRESUPUESTO_VACIO'), espejo.indexOf('/** «Ver todo (8)»'))
  const numero = (fuente, clave) => Number(new RegExp(clave + ': (\\d+)').exec(fuente)?.[1])
  eq(numero(presupuesto, 'lineas'), numero(HOY_UI, 'lines'), 'el espejo y el panel cuentan las mismas líneas de estado vacío')
  eq(numero(presupuesto, 'pastillasPorLinea'), numero(HOY_UI, 'chipsPerLine'), 'y las mismas pastillas por línea')
  assert(/deHoy \+ SUGGESTION_COUNT \+ dePastillas <= PRESUPUESTO_VACIO\.lineas/.test(presupuesto), 'con la misma cuenta que emptyFits')
  const bloque = espejo.slice(espejo.indexOf('function pintarBloqueHoy('), espejo.indexOf('const GRUPOS_HOY'))
  assert(/todas\.slice\(0, TODAY_LIMITS\.emptyRows\)/.test(bloque), 'el tope lo dice el módulo, no un 3 a mano')
  assert(/`Qué mirar hoy \(\$\{todas\.length\}\)`/.test(bloque) && /`Ver todo \(\$\{todas\.length\}\)`/.test(bloque), 'las dos formas: degradada y entera')
  assert(/caja\.classList\.toggle\('hidden', !todas\.length\)/.test(bloque), 'y sin filas la caja se queda vacía y oculta, como en el panel')
  const vacio = espejo.slice(espejo.indexOf('function estadoVacio()'), espejo.indexOf('function conversacionBusqueda()'))
  assert(/pintarBloqueHoy\(hoy, chips\.querySelectorAll\('\.search-chip'\)\.length\)/.test(vacio), 'y se pinta con cuántas pastillas hay debajo')

  // La pantalla: los tres grupos con sus títulos, y una fila con las clases que
  // pinta `todayRowNode`.
  const pantalla = espejo.slice(espejo.indexOf('const GRUPOS_HOY'), espejo.indexOf('// ------------------------------------------------------------- redactor'))
  for (const titulo of ['Cambió desde que lo miraste', 'Lo tuyo', 'Nuevo en ']) {
    assert(pantalla.includes(titulo), 'falta el rótulo de grupo: ' + titulo)
    assert(JS.includes(titulo), 'y el panel ya no lo dice: los dos textos se han separado — ' + titulo)
  }
  const fila = espejo.slice(espejo.indexOf('function filaDeHoy(item,'), espejo.indexOf('function pintarBloqueHoy('))
  for (const clase of ['today-row', 'today-main', 'today-kind', 'today-title', 'today-why', 'today-actions', 'today-x']) {
    assert(fila.includes("'" + clase + "'") || fila.includes(clase + "'"), 'el espejo no enseña la clase ' + clase)
  }
  assert(/' compact'/.test(fila) && /' new'/.test(fila), 'las dos formas de la fila y el filete de lo que ha cambiado')
  assert(fila.includes('`Ya lo he visto: «${item.title}»`'), 'con los nombres accesibles del panel, título incluido')
  // Y la promesa de §8.20 escrita donde se ve, con las mismas palabras que el panel.
  for (const trozo of ['no sale de aquí', 'Borrarlo no borra nada en Jira ni en Confluence', 'ACTIVITY_LIMITS.maxAgeDays']) {
    assert(pantalla.includes(trozo), 'el espejo no dice «' + trozo + '»')
  }

  // Los mandos, y lo que se mide de más en cada captura: cuánto de «hoy» hay
  // delante, que es lo que explica si el estado vacío cabe.
  assert(espejo.includes('data-screen="screen-today"') && espejo.includes('data-today="linea"'), 'la pantalla y las dos formas del bloque son mandos')
  const medida = espejo.slice(espejo.indexOf('const todayRows ='), espejo.indexOf('const falta ='))
  assert(/doc\.querySelectorAll\('\.empty \.today \.today-row'\)\.length/.test(medida) && /\.today-more/.test(medida), 'check() cuenta las filas y ve la línea')
  const cajas = espejo.slice(espejo.indexOf('const CAJAS ='), espejo.indexOf('function check() {'))
  assert(cajas.includes("'.today-row'"), 'y la fila entra en la medida de desbordamiento, como las piezas de H8')
  assert(/setToday\(modo\)/.test(espejo), 'y setToday es API, como los demás mandos')
})

// ----------------------------------- «Qué guarda Faro de mí», en Ajustes (H13)

test('H13: Ajustes dice qué guarda Faro de este sitio, con su medida y sin enseñar contenido', () => {
  // La promesa de §8.20 es que lo que Faro apunta del usuario «se ve y se
  // borra». El «se borra» existía desde H10; el «se ve» estaba repartido entre
  // tres pantallas y de dos cosas —el perfil contado y el historial de análisis—
  // no hablaba ninguna.
  for (const id of ['privacy-title', 'privacy-list', 'privacy-others']) {
    assert(htmlIds.has(id), 'falta en la pantalla de Ajustes: ' + id)
  }
  const ajustes = HTML.slice(HTML.indexOf('id="screen-settings"'), HTML.indexOf('id="screen-memory"'))
  // La lista es una LISTA (un `ul`) con su encabezado: así un lector de pantalla
  // dice cuántas cosas hay guardadas. Ninguna fila es un botón, así que
  // envolverlas no le quita el papel a nada (en H10 las sugeridas SÍ son botones
  // y por eso son un `role="group"`).
  assert(/<ul class="privacy" id="privacy-list" aria-labelledby="privacy-title">/.test(ajustes), 'la lista es un ul con su encabezado')
  // Y el botón que se lo lleva todo vive AHÍ, debajo de la lista de lo que borra.
  assert(ajustes.indexOf('id="privacy-list"') < ajustes.indexOf('id="btn-forget"'), '«Olvidar este sitio» va debajo de la lista')
  // Dónde vive todo y qué NO se guarda, escrito donde se ve (§8.13 y §8.20).
  for (const trozo of [
    'vive en este navegador',
    'sólo están en la configuración de opencode',
    'Lo que NO se guarda aquí',
    'la sesión de opencode',
  ]) {
    assert(ajustes.includes(trozo), 'la pantalla no dice «' + trozo + '»')
  }

  // El CSS de las filas, con su regla (la trampa de `.older-turns` en H6: un
  // nombre renombrado a «.privacy-loquesea» contiene «.privacy» y dejaría el pin
  // en verde con la lista sin estilo).
  for (const regla of ['.privacy {', '.privacy li {', '.privacy .k {', '.privacy .v {']) {
    assert(CSS_LIMPIO.includes(regla), 'clase sin estilo: ' + regla)
  }
  assert(!/\.privacy[^{]*\{[^}]*white-space: nowrap/.test(CSS_LIMPIO), 'nada de nowrap: a 320 px lo que tiene que pasar es que se parta en dos líneas')

  // Lo que se enseña se lee del ALMACÉN y no de `state`: la pregunta es «qué
  // GUARDA Faro», y el panel puede tener en memoria un índice que todavía no ha
  // escrito (`state.indexDirty`, P3) o lo de antes de un borrado. Y es lo que
  // hace que la pantalla se compruebe a sí misma: tras olvidar, todo «(nada)».
  const lista = sinComentarios(JS.slice(JS.indexOf('async function paintPrivacy'), JS.indexOf('function hace(at)')))
  assert(lista.length > 400, 'el trozo de paintPrivacy se puede recortar')
  assert(/await Promise\.all\(\[getSiteBundle\(host\), getSites\(\)\]\)/.test(lista), 'las dos lecturas van a la vez')
  for (const dato of [
    'bundle.index',
    'bundle.contextMd',
    'bundle.memoryRaw',
    'bundle.extras?.profile',
    'bundle.extras?.sourceHistory',
    'bundle.extras?.activity',
    'bundle.site?.recentJql',
    'bundle.site?.analysisSources',
  ]) {
    assert(lista.includes(dato), `la fila no sale del almacén: falta ${dato}`)
  }
  assert(!/state\.index\b|state\.contextMd|state\.memory\b|state\.profile|state\.sourceHistory|state\.today\b|state\.sources\b/.test(lista), 'ninguna fila se pinta de lo que el panel tenga en memoria')
  // Y cada cosa guardada pasa por su normalizadora, como en el arranque: lo que
  // hay en disco se puede haber editado a mano.
  for (const norma of ['memory.normalizeMemory(', 'normalizeProfile(', 'normalizeHistory(', 'pruneActivity(', 'normalizeRecentJql(', 'normalizeSources(']) {
    assert(lista.includes(norma), 'lo guardado se cuenta sin reconstruir: falta ' + norma)
  }
  // §8.22: el host se captura al pedir y se comprueba al volver. Es el de la
  // PESTAÑA, como en el Registro y como el botón de olvidar: enseñar la lista de
  // un host que ese botón no puede borrar sería ofrecer un borrado que no pasa.
  assert(/const host = state\.site\?\.host \|\| ''/.test(lista), 'el host se captura antes de leer')
  assert(/if \(state\.site\?\.host !== host\) return/.test(lista), 'y se comprueba al volver')
  // §8.14: si no se pudo leer, se dice en la propia lista. Una lista vacía
  // parecería «no guardo nada de ti», que es justo lo contrario.
  assert(/no se pudo leer: /.test(lista) && /no se pudo medir: /.test(lista), 'los dos fallos tienen su fila')
  // SEGURIDAD §8.20: cuentas y medidas, nunca contenido. Ni un título de página,
  // ni una clave de incidencia, ni una línea del contexto: esta pantalla se mira
  // con el panel abierto delante de otra gente, igual que el Registro. La única
  // excepción es la CLAVE DEL PROYECTO del perfil, y es a propósito: el perfil se
  // guarda por host y un Jira tiene muchos proyectos, así que sin ella no se sabe
  // de cuál es lo guardado (revisión adversaria de H9), y ya está en la cabecera.
  assert(!/\.title\b/.test(lista) && !/\.entries\[/.test(lista), 'de aquí no sale ningún título ni ninguna entrada de la memoria')
  assert(
    !/(bundle\.\w+|contextMd|memoryRaw|extras)[\w?.]*\.slice\(/.test(lista),
    'ni un trozo de lo guardado: un «primeros 40 caracteres del contexto» es justo lo que esta pantalla no puede enseñar'
  )
  assert(/\.length/.test(lista) && /formatBytes\(bytes\)/.test(lista), 'lo que sale son longitudes y medidas')
  // EL CAMBIO (revisión adversaria de H13): lo de arriba es una lista NEGRA, y
  // cuatro fugas de verdad la pasaban en verde —la JQL guardada
  // (`…[0].jql`), los nombres de estado del proyecto (`perfil.statuses.map(…)`),
  // una clave de incidencia (`Object.keys(….items)[0]`) y el espacio de una
  // página base—. La promesa es de lista BLANCA: lo que cada fila enseña sólo
  // puede salir de estas piezas, que son cuentas, medidas y la clave del proyecto.
  const PERMITIDO = new Set([
    'bundle.index',
    'bundle.contextMd',
    'bundle.contextMd.length',
    'paginas',
    'incidencias',
    'resumenes',
    'state.settings.crossSessionMemory',
    'perfil',
    'perfil.projectKey',
    'perfil.sampled',
    'perfil.at',
    'hace',
    'analisis',
    'cuentas.entradas',
    'cuentas.descartes',
    'todayEnabled',
    'consultas',
    'elegidas',
    'formatBytes',
    'bytes',
    'Math.round',
    'cuota',
    'err.message',
    // H16: las dos filas GLOBALES, de la persona. El modelo elegido se enseña
    // como «proveedor/modelo» (`modelKey`) reconstruido por `parseModelKey`: es
    // el id que opencode da a un modelo, no contenido de ningún sitio, y por eso
    // entra aquí como la clave del proyecto del perfil (§4.11). Los veredictos,
    // sólo su CUENTA: nunca qué modelos ni con qué mensaje del proveedor.
    'elegido',
    'modelKey',
    'veredictos',
  ])
  // Cada `add(` de la función (menos su propia definición), con su segundo
  // argumento recortado por paréntesis balanceados.
  const valores = []
  for (let i = lista.indexOf('add('); i >= 0; i = lista.indexOf('add(', i + 1)) {
    if (/const $/.test(lista.slice(0, i)) || lista.slice(i - 6, i) === 'const ') continue
    let nivel = 0
    let j = i + 3
    let coma = -1
    let enCadena = ''
    for (; j < lista.length; j++) {
      const c = lista[j]
      if (enCadena) {
        if (c === '\\') j++
        else if (c === enCadena) enCadena = ''
        continue
      }
      if (c === "'") enCadena = "'"
      else if (c === '(' || c === '{') nivel++
      else if (c === ')' || c === '}') {
        nivel--
        if (nivel === 0) break
      } else if (c === ',' && nivel === 1 && coma < 0) coma = j
    }
    if (coma > 0) valores.push(lista.slice(coma + 1, j))
  }
  assert(valores.length >= 11, 'se recortan las filas de la lista: ' + valores.length)
  for (const valor of valores) {
    // Fuera las cadenas y el texto fijo de las plantillas: queda sólo lo que se
    // CALCULA. Con una pila, porque dentro de un `${…}` puede haber otra cadena u
    // otra plantilla (`${cond ? '' : ' · apagado'}`).
    let calculado = ''
    const pila = ['codigo']
    for (let k = 0; k < valor.length; k++) {
      const c = valor[k]
      const modo = pila[pila.length - 1]
      if (modo === 'cadena') {
        if (c === '\\') k++
        else if (c === "'") pila.pop()
      } else if (modo === 'plantilla') {
        if (c === '\\') k++
        else if (c === '`') pila.pop()
        else if (c === '$' && valor[k + 1] === '{') {
          pila.push('codigo')
          k++
          calculado += ' '
        }
      } else if (c === "'") pila.push('cadena')
      else if (c === '`') pila.push('plantilla')
      else if (c === '}' && pila.length > 1) {
        pila.pop()
        calculado += ' '
      } else calculado += c
    }
    assert(!calculado.includes('['), 'ninguna fila indexa lo guardado: ' + valor.trim().slice(0, 80))
    const piezas = calculado.match(/[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*/g) || []
    for (const pieza of piezas) {
      assert(PERMITIDO.has(pieza), `la fila enseña algo que no es una cuenta ni una medida: ${pieza} — en «${valor.trim().slice(0, 70)}»`)
    }
  }
  // Y las seis cuentas son de verdad CUENTAS: cada una nace de un `.length`.
  for (const cuenta of ['paginas', 'incidencias', 'resumenes', 'analisis', 'consultas', 'elegidas']) {
    assert(new RegExp('const ' + cuenta + ' = [^\\n]*\\.length\\n').test(lista), cuenta + ' es una longitud')
  }
  // Apagado no es vacío: la fila dice lo que HAY guardado y, detrás, que está
  // apagado. «(desactivada)» con doce resúmenes en disco era contestar a otra
  // pregunta, y hacía falsa la autocomprobación de «tras olvidar, todo (nada)».
  assert(!/\? '\(desactivada\)'/.test(lista) && !/\? '\(apagado\)'/.test(lista), 'ninguna fila contesta «apagado» en vez de lo que hay')
  assert(/' · desactivada'/.test(lista) && /' · apagado'/.test(lista), 'que está apagado se dice DETRÁS de la cuenta')
  // Y la lista se pinta con createElement, como todo el panel.
  assert(/document\.createElement\('li'\)/.test(lista) && !/innerHTML/.test(lista))

  // Se rellena al abrir la pantalla, y después de abrirla: son dos lecturas y
  // Ajustes no tiene por qué esperarlas para aparecer.
  const pantalla = sinComentarios(JS.slice(JS.indexOf('async function showSettingsScreen'), JS.indexOf('async function paintPrivacy')))
  assert(pantalla.indexOf("showScreen('screen-settings')") < pantalla.indexOf('await paintPrivacy()'), 'la pantalla se abre y luego se rellena')

  // El borrado se dice en voz alta: es la acción más destructiva del panel y que
  // la pantalla se repinte con todo a cero no se oye por sí solo (A2).
  const olvidar = sinComentarios(JS.slice(JS.indexOf("$('btn-forget').addEventListener"), JS.indexOf("$('mem-enabled').addEventListener")))
  assert(/announce\(/.test(olvidar), 'olvidar un sitio se anuncia')
  // Desde un Jira, las páginas base y los análisis de páginas se apuntan en el
  // diario del Confluence ENLAZADO, que el usuario no abre nunca para borrarlo:
  // «Borrar mi actividad» ya se lo llevaba, y el botón más ancho no puede dejar lo
  // que borra el estrecho (revisión adversaria de H13). Se captura ANTES de
  // olvidar, y sólo su diario y su caché de «hoy».
  assert(olvidar.indexOf('const enlazado = linkedSite(state.linkedContext)') > 0)
  assert(olvidar.indexOf('const enlazado = linkedSite(state.linkedContext)') < olvidar.indexOf('await forgetEverythingFor(host)'), 'el enlazado se captura antes de olvidar')
  assert(
    /if \(enlazado && enlazado\.host !== host\) \{\s*await clearActivity\(enlazado\.host\)\s*await clearTodayCache\(enlazado\.host\)\s*\}/.test(olvidar),
    'y se va su diario con su caché de «hoy»'
  )
  assert(!/forgetEverythingFor\(enlazado/.test(olvidar), 'pero NO se olvida aquel sitio entero: lo demás es suyo')

  // El espejo enseña la sección con una fila de cada clase, y la fila entra en la
  // medida de desbordamiento a lo ancho, como las piezas de H8 y H11.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(/\$\('privacy-list'\)/.test(espejo) && /\$\('privacy-others'\)/.test(espejo), 'el espejo rellena la lista y la línea de los otros sitios')
  assert(espejo.includes("'espacio usado'") && JS.includes("'espacio usado'"), 'con la misma última fila que el panel: los dos textos se han separado')
  const cajas = espejo.slice(espejo.indexOf('const CAJAS ='), espejo.indexOf('function check() {'))
  assert(cajas.includes("'.privacy li'"), 'y la fila entra en la medida de desbordamiento')
})

test('H14 P5: el chat no espera al MCP, y lo que la comprobación decide llega después sin pisar nada', () => {
  // `GET /mcp` EN FRÍO tarda 14 463 ms en la máquina del usuario (medido el
  // 2026-09-21 contra su opencode 1.2.25; 2 ms en caliente) y hasta H14 el chat
  // esperaba eso entero cada vez que se reiniciaba opencode. Ahora la
  // comprobación va en segundo plano y el arranque sigue sin ella.
  const arranque = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('function currentProfile(')))
  assert(/const primeraVez = !saved\?\.configured && !saved\?\.skippedKeys/.test(arranque), 'sólo el sitio que todavía no está en marcha espera al MCP')
  assert(/const comprobacion = checkMcp\(client, testigo, saved\)/.test(arranque), 'la comprobación se lanza con el cliente, el testigo y lo guardado')
  assert(/state\.mcpCheck = comprobacion\.then\(/.test(arranque), 'y queda a mano para el turno que se mande mientras tanto')
  // NUNCA rechaza: de ella depende el aviso «Páginas base sin leer» y el
  // `await` de la primera vez, y `checkMcp` sí puede rechazar (saveSite con la
  // cuota llena). El pin mira el segundo brazo del `then`, porque quitarlo
  // dejaba las 1315 en verde (revisión adversaria de H14).
  assert(/state\.mcpCheck = comprobacion\.then\(\s*\(r\) => !!r\.connected,\s*\(\) => false\s*\)/.test(arranque), 'con un booleano por cada brazo: nunca rechaza')
  eq(arranque.split('await comprobacion').length - 1, 1, 'se espera UNA vez, y en un solo sitio')
  const espera = arranque.slice(arranque.indexOf('if (primeraVez) {'), arranque.indexOf('} else {', arranque.indexOf('if (primeraVez) {')))
  assert(espera.includes('const r = await comprobacion'), 'y es el camino de la primera vez, donde la pantalla de claves es lo primero que hay que ver')
  assert(/if \(state\.bootToken !== testigo\) return/.test(espera), 'con el testigo comprobado al volver (§8.22)')
  assert(/if \(faltanClaves\(r\)\) \{/.test(espera), 'y ahí sí se pide lo que falta antes de seguir')
  // El camino de todos los días: ni se espera ni se cuela por otro sitio.
  assert(/setStatus\('busy', COMPROBANDO_MCP\)/.test(arranque), 'mientras dura, la cabecera dice qué pasa')
  // El resultado se recoge con la PROMESA que el panel tiene como suya, no con el
  // testigo del arranque: «Omitir» y «Subir un contexto» cambian el testigo sin
  // rearrancar y dejaban la comprobación huérfana (revisión adversaria de H14).
  assert(/mcpResultSoon\(comprobacion, state\.mcpCheck\)/.test(arranque), 'y el resultado se recoge sin esperarlo, atado a la comprobación vigente')
  assert(
    !/await mcpResultSoon\(/.test(arranque) && !/await state\.mcpCheck/.test(arranque) && !/await currentMcpCheck\(/.test(arranque),
    'nada del arranque espera al MCP por otro camino'
  )
  assert(
    arranque.indexOf('mcpResultSoon(comprobacion, state.mcpCheck)') < arranque.indexOf('await restoreConversation(testigo)'),
    'la conversación se pinta después, sin esperarlo'
  )

  // La comprobación habla del host con el que se pidió: entre la pregunta y la
  // respuesta hay hasta catorce segundos y la pestaña puede irse al correo, que
  // deja `state.site` en null sin tocar el testigo del arranque (§8.22).
  const comprobar = sinComentarios(JS.slice(JS.indexOf('async function checkMcp'), JS.indexOf('function mcpResultSoon')))
  assert(comprobar.length > 800, 'el cuerpo de checkMcp existe entero')
  assert(comprobar.indexOf('const host = state.site.host') < comprobar.indexOf('await Promise.all(['), 'el host se captura ANTES de preguntar')
  const tras = comprobar.slice(comprobar.indexOf('await Promise.all(['))
  assert(!/state\.site\.host/.test(tras) && !/state\.site\.product/.test(tras), 'y después nadie vuelve a leerlo de la pestaña')
  assert(/mcpForHost\(config, host, \{ status: mcp \}\)/.test(tras) && /mcpStatusFor\(mcp, host,/.test(tras), 'todo lo de después habla del host capturado')
  // Lo que aprende del MCP se guarda bajo el host que lo aprendió, esté el panel
  // donde esté (§4.6); lo que NO se escribe en otro sitio es el estado del panel.
  assert(/for \(const registro of registros\) await saveSite\(registro\.host, registro\.patch\)/.test(comprobar), 'la adopción se guarda por host')
  eq(
    comprobar.split('state.bootToken').length - 1,
    1,
    'y un solo testigo en toda la comprobación: lo aprendido se guarda pase lo que pase, y del panel sólo se mira si se le puede tocar el estado'
  )
  assert(
    /if \(state\.bootToken === testigo && \(state\.site\?\.host \?\? state\.lastHost\) === host\) \{\s*\n\s*state\.mcpConnected = !!status\.connected/.test(comprobar),
    'y el estado sólo se toca si el panel sigue siendo de este sitio'
  )
  assert(/return \{ connected: !!status\.connected, status, saved, enlaceNuevo, host \}/.test(comprobar), 'el resultado vuelve entero: lo espera el turno que lo capturó')

  // El turno captura la PROMESA y le pregunta al terminar: con el booleano de
  // ahora, un turno mandado nada más abrir el panel acabaría con un «Páginas
  // base sin leer» mentiroso.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/const mcpCheckAlPedir = currentMcpCheck\(\)/.test(envio), 'se captura la comprobación, no su resultado de ahora')
  assert(envio.indexOf('const mcpCheckAlPedir') < envio.indexOf('runTurn('), 'antes de mandar nada')
  assert(/mcpConnected: await mcpCheckAlPedir/.test(envio), 'y se le pregunta al terminar')
  assert(!/mcpConnected: state\.mcpConnected/.test(envio), 'nunca el estado de ahora')

  // Lo que llega tarde no puede taparle el chat a nadie.
  const tarde = sinComentarios(JS.slice(JS.indexOf('async function onMcpResult'), JS.indexOf('function showMcpPending')))
  // Lo que manda es que ESTA comprobación siga siendo la del panel, no el
  // testigo del arranque: «Omitir» y «Subir un contexto» cambian el testigo sin
  // rearrancar (apagan la pantalla de contexto) y con él el resultado se
  // perdía —ni pantalla, ni aviso— y la cabecera se quedaba en «comprobando
  // MCP…» (revisión adversaria de H14). `state.mcpCheck` lo pone cada arranque
  // y lo vacía el cambio de host, que es justo cuando no debe pintar nada.
  assert(/^async function onMcpResult\(r, vigente\)/m.test(tarde), 'el resultado llega con la promesa que el panel tenía como suya')
  assert(/if \(state\.mcpCheck !== vigente\) return/.test(tarde), 'lo de una comprobación que ya no es la del panel no pinta nada')
  assert(!/state\.bootToken/.test(tarde), 'y el testigo del arranque no se mira: apagarlo no es cancelar la comprobación')
  assert(/if \(state\.statusLine === COMPROBANDO_MCP\) \{/.test(tarde), 'la cabecera sólo se devuelve si el texto sigue siendo el suyo')
  assert(/state\.mcpPending = \{ host: r\.host, status: r\.status \}/.test(tarde) && /showMcpPending\(\)/.test(tarde), 'lo que falta se apunta con su host y se enseña si se puede ya')
  assert(!/showMcpSetup\(/.test(tarde) && !/attachMcpNotice\(/.test(tarde), 'y no se pinta desde aquí: sólo por showMcpPending, que sabe cuándo se puede')
  assert(/if \(r\.enlaceNuevo\) \{/.test(tarde) && /await loadLinkedContext\(r\.saved\)/.test(tarde), 'y un host enlazado descubierto tarde se lee al saberlo')
  assert(
    /if \(state\.mcpCheck === vigente && enlazado\) state\.linkedContext = enlazado/.test(tarde),
    'y sólo se escribe si trae algo: esto rellena un enlace que faltaba, no borra el que había'
  )
  // Cuándo se puede enseñar lo pendiente (revisión adversaria de H14): con la
  // pestaña en el correo `state.site` es null y `showSetupScreen` reventaba con
  // él (el TypeError se lo tragaba `mcpResultSoon`: ni pantalla ni aviso, nunca);
  // y con la pantalla de contexto delante —o el velo— el chat se va a vaciar en
  // `restoreConversation` y un aviso colgado ahí se perdía. Se guarda y lo
  // enseñan quienes vuelven a poder: `refreshTab` al volver al sitio y
  // `restoreConversation` con el chat ya repintado.
  const pendiente = sinComentarios(JS.slice(JS.indexOf('function showMcpPending'), JS.indexOf('function faltanClaves')))
  assert(/const pendiente = state\.mcpPending/.test(pendiente) && /if \(!pendiente\) return/.test(pendiente))
  assert(/\(state\.site\?\.host \?\? state\.lastHost\) !== pendiente\.host/.test(pendiente), 'lo de otro sitio se tira')
  assert(/if \(!state\.site\) return/.test(pendiente), 'sin sitio delante se espera, no se revienta')
  assert(/screen-context'\)\.classList\.contains\('hidden'\)/.test(pendiente) && /el\.busy\.classList\.contains\('hidden'\)/.test(pendiente), 'y con el chat a punto de vaciarse, también')
  assert(pendiente.lastIndexOf('state.mcpPending = null') > pendiente.indexOf("screen-context')"), 'se consume sólo cuando se enseña (lo de otro sitio se tira antes)')
  assert(/if \(puedeAbrirPantalla\(\)\) showMcpSetup\(pendiente\.status\)/.test(pendiente), 'la pantalla de claves sólo se abre si no tapa nada')
  assert(/else attachMcpNotice\(pendiente\.status\)/.test(pendiente), 'y si tapa, se dice en el chat con la salida a mano')
  const cola = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  assert(/await consumePendingIntent\(site\)\s*\n\s*showMcpPending\(\)/.test(cola), 'al volver al sitio se enseña, detrás de la intención de «Analizar»')
  const restaurar = sinComentarios(JS.slice(JS.indexOf('async function restoreConversation'), JS.indexOf('function markIfRestored')))
  assert(/state\.restoring = false\s*\n\s*showMcpPending\(\)/.test(restaurar), 'y con el chat repintado, también: un aviso de antes se habría ido')
  assert(/state\.mcpPending = \{ host: r\.host, status: r\.status \}/.test(espera) && /showMcpPending\(\)/.test(espera), 'la primera vez va por el mismo camino: la pestaña puede irse al correo en esos catorce segundos')
  assert(!/showMcpSetup\(r\.status\)/.test(espera), 'y tampoco abre la pantalla a ciegas')
  const cierraBoot = sinComentarios(JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('const cron = startTiming')))
  assert(/state\.mcpPending = null/.test(cierraBoot), 'un arranque nuevo tira lo pendiente del anterior: lanza su propia comprobación')
  const abrir = sinComentarios(JS.slice(JS.indexOf('function showMcpSetup'), JS.indexOf('function attachMcpNotice')))
  assert(/if \(!state\.site\) \{/.test(abrir) && abrir.indexOf('if (!state.site) {') < abrir.indexOf('showSetupScreen()'), 'la pantalla no se rellena sin sitio: se dice qué hacer')
  const devuelve = sinComentarios(JS.slice(JS.indexOf('async function checkMcp'), JS.indexOf('function mcpResultSoon')))
  assert(/return \{ connected: !!status\.connected, status, saved, enlaceNuevo, host \}/.test(devuelve), 'el resultado dice de qué host es')
  const puede = sinComentarios(JS.slice(JS.indexOf('function puedeAbrirPantalla'), JS.indexOf('function showMcpSetup')))
  assert(/if \(state\.streaming\) return false/.test(puede), 'no a mitad de una respuesta')
  assert(/document\.querySelector\('\.screen:not\(\.hidden\)'\)/.test(puede), 'ni encima de otra pantalla')
  assert(/el\.busy\.classList\.contains\('hidden'\)/.test(puede), 'ni encima del velo de «Trabajando…»')
  assert(/return !el\.input\.value\.trim\(\)/.test(puede), 'ni con algo escrito y sin mandar')
  // El motivo de la pantalla de claves se escribe UNA vez: las dos salidas
  // llaman a la misma función, o un día dirían cosas distintas.
  eq(sinComentarios(JS).split('está registrado pero en').length - 1, 1, 'el texto del MCP caído vive en un solo sitio')
  const avisoMcp = sinComentarios(JS.slice(JS.indexOf('function attachMcpNotice'), JS.indexOf('function currentMcpCheck')))
  assert(/noticeNode\(texto, true\)/.test(avisoMcp) && /'Cambiar las claves'/.test(avisoMcp), 'el aviso se ve y lleva la salida a mano')
  assert(/btn\.addEventListener\('click', \(\) => showMcpSetup\(status\)\)/.test(avisoMcp), 'el botón abre la misma pantalla')
  assert(/announce\(texto\)/.test(avisoMcp), 'y se anuncia al lector de pantalla (A2)')
  assert(!/innerHTML/.test(avisoMcp), 'todo con createElement y textContent')
  // Y sin `clearEmpty()`: este aviso llega solo, catorce segundos después, y con
  // algo escrito en el cuadro —o una pantalla abierta encima— se llevaba la
  // bienvenida entera (sugerencias, chips, «Qué mirar hoy»); va debajo de ella
  // (revisión adversaria de H14).
  assert(!/clearEmpty\(\)/.test(avisoMcp), 'el aviso del MCP no se lleva el estado vacío')

  // La pantalla de páginas base no dice «no hay MCP» sin saberlo todavía.
  const pantalla = sinComentarios(JS.slice(JS.indexOf('async function paintSourcesMcp'), JS.indexOf('async function showSourcesScreen')))
  assert(/aviso\.classList\.add\('hidden'\)/.test(pantalla), 'mientras no se sabe, no se dice nada')
  assert(pantalla.indexOf("aviso.classList.add('hidden')") < pantalla.indexOf('await currentMcpCheck()'), 'y eso va antes de esperar')
  assert(/const conectado = await currentMcpCheck\(\)/.test(pantalla), 'se espera a la comprobación')
  assert(/if \(\(state\.site\?\.host \|\| ''\) !== host\) return/.test(pantalla), 'y lo que llegue de otro sitio no pinta aquí (§8.22)')
  const sources = sinComentarios(JS.slice(JS.indexOf('async function showSourcesScreen'), JS.indexOf('function setSourcesStatus')))
  assert(/paintSourcesMcp\(\)\.catch\(console\.error\)/.test(sources), 'la pantalla se abre sin esperar al MCP')
  assert(
    sources.indexOf("showScreen('screen-sources')") < sources.indexOf('paintSourcesMcp()'),
    'y se pinta DESPUÉS de abrirla, para que su guarda de «¿sigue abierta?» signifique eso'
  )
  assert(!/sources-mcp'\)\.classList\.toggle\('hidden', state\.mcpConnected\)/.test(sources), 'y ya no lo lee del estado, que en vuelo dice que no hay')

  // Y es del sitio: cambiar de host lo deja sin comprobar, como el perfil o el
  // índice, y quien pregunte antes de que el arranque nuevo lo ponga se lleva el
  // lado prudente (avisar).
  const refresco = sinComentarios(JS.slice(JS.indexOf('async function refreshTab'), JS.indexOf('async function bootForSite')))
  // Recortado al bloque del CAMBIO DE HOST, no a `refreshTab` entera: moverlos a
  // la rama de «fuera de Atlassian» —mirar el correo— también pasaba el pin de
  // antes, y ahí vaciarlos sería tirar la comprobación del sitio en el que el
  // panel sigue estando (revisión adversaria de H14).
  const cambioDeHost = refresco.slice(refresco.indexOf('if (changedHost) {'), refresco.indexOf('state.site = site'))
  assert(/state\.mcpCheck = null/.test(cambioDeHost) && /state\.mcpConnected = false/.test(cambioDeHost) && /state\.mcpPending = null/.test(cambioDeHost), 'el MCP comprobado no viaja al sitio siguiente')
  const fueraDeAtlassian = refresco.slice(refresco.indexOf('if (!site) {', refresco.indexOf('paintLocation(site, tab.title)')), refresco.indexOf('if (changedHost) await bootForSite()'))
  assert(fueraDeAtlassian.length > 100 && !/mcpCheck|mcpConnected|mcpPending/.test(fueraDeAtlassian), 'y mirar el correo no lo toca: el panel sigue siendo de ese sitio')
  const fallback = sinComentarios(JS.slice(JS.indexOf('function currentMcpCheck'), JS.indexOf('async function loadLinkedContext')))
  assert(/return state\.mcpCheck \|\| Promise\.resolve\(state\.mcpConnected\)/.test(fallback), 'sin comprobación en marcha vale lo que el estado sepa')

  // Lo único que P5 añade a la vista se mira en el espejo, que es donde se mide:
  // el panel no corre en el banco (`init()` muere en `getSettings`).
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(/function avisoMcpSinConectar\(\)/.test(espejo) && /chat\.appendChild\(avisoMcpSinConectar\(\)\)/.test(espejo), 'el espejo enseña el aviso del MCP caído')
  // Sobre la pieza que PINTA, no sobre el fichero: el comentario de encima
  // nombra lo mismo y dejaba el pin en verde con el texto ya separado (la
  // lección de `.older-turns` en la revisión de H6).
  const piezaMcp = espejo.slice(espejo.indexOf('function avisoMcpSinConectar()'), espejo.indexOf('function tarjetaBusqueda(plan)'))
  assert(piezaMcp.length > 300 && piezaMcp.length < 1200, 'el cuerpo de avisoMcpSinConectar está donde se espera')
  for (const trozo of ['no está conectado', 'Cambiar las claves']) {
    assert(piezaMcp.includes(trozo) && JS.includes(trozo), 'el espejo y el panel dicen lo mismo: se han separado en «' + trozo + '»')
  }
})

test('H15: el MCP caído dice por qué y se puede reintentar sin reiniciar opencode', () => {
  // Pasó de verdad (docs/PLAN2.md §3.1): un compañero se quedó quince minutos
  // mirando «El MCP está en «failed»…» sin ninguna pista. El motivo lo dice
  // `mcpFailureHint` (setup.js, con sus pruebas); aquí, que llega a verse en los
  // tres sitios en los que se ve un MCP caído, y que «Reintentar» respeta §8.22.
  const JS_SIN = sinComentarios(JS)
  // Cada recorte comprueba que sus DOS marcas existen y van en orden. Pasó
  // (revisión adversaria de H15): `a.indexOf(x) < a.indexOf(y)` da verde cuando
  // `x` NO existe (-1 < cualquier cosa), y dos pines de esta prueba lo eran
  // —quitar lo que vigilaban dejaba todo en verde—; y un `slice` con una marca
  // que falta se come el fichero entero y cualquier `includes` pasa por vacío.
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  // «x va antes que y», con las dos presentes.
  const antesQue = (src, x, y, msg) => {
    const i = src.indexOf(x)
    const j = src.indexOf(y)
    assert(i >= 0 && j >= 0 && i < j, msg + ` (${x} en ${i}, ${y} en ${j})`)
  }

  // (1) La pantalla de claves: el consejo DETRÁS de la frase de siempre, que
  // sigue escrita una sola vez.
  const claves = corte(JS_SIN, 'function showMcpSetup(', 'function attachMcpNotice(')
  assert(claves.length > 400, 'el trozo de la pantalla de claves existe')
  assert(/const consejo = mcpFailureHint\(status\)/.test(claves), 'la pantalla de claves pregunta a mcpFailureHint')
  // Recortado a `showMcpSetup` SOLA: el nombre de la función que pinta aparece
  // también en su propia declaración, justo debajo.
  const abreClaves = corte(claves, 'function showMcpSetup(', 'function paintSetupMcpHint(')
  const frase = abreClaves.indexOf('está registrado pero en')
  assert(frase > 0 && abreClaves.indexOf('paintSetupMcpHint(status)') > frase, 'el consejo va detrás de la frase del MCP caído')
  assert(/caja\.classList\.toggle\('hidden', !consejo\)/.test(claves), 'sin consejo, la caja se esconde')
  eq(JS_SIN.split('está registrado pero en').length - 1, 1, 'la frase del MCP caído sigue en un solo sitio')
  const pantalla = corte(JS_SIN, 'function showSetupScreen(', 'function paintSetupProducts(')
  assert(/\$\('setup-mcp-hint'\)\.classList\.add\('hidden'\)/.test(pantalla), 'abierta desde Ajustes, la pantalla no arrastra el consejo de otra vez')

  // (2) La espera del paso manual: el consejo en cada vuelta, una vez por error.
  const manual = corte(JS_SIN, 'async function showManualStep(', 'async function finishSetup(')
  assert(/const consejo = mcpFailureHint\(s\)/.test(manual), 'la espera pregunta a mcpFailureHint')
  assert(/pintarConsejo\(s\)/.test(corte(manual, 'onTick:', 'if (status.connected) pintarConsejo(null)')), 'en cada vuelta de la espera')
  assert(/if \(consejo\.text === errorPintado\) return/.test(manual), 'y no se recrea mientras el error sea el mismo')
  assert(/cajaConsejo\.classList\.add\('hidden'\)/.test(manual), 'y se esconde en cuanto deja de estar en «failed»')
  assert(/retryMcp\(s\.name, \{ boton, host: site\.host, manual: true, repintar: pintarConsejo \}\)/.test(manual), 'reintenta con el host de la espera y avisando de que es el paso manual')
  assert(!/bootForSite\(/.test(manual), 'desde el paso manual nunca se rearranca: la espera sigue sola')

  // (3) El aviso del chat: el motivo y «Reintentar» junto a «Cambiar las claves».
  const aviso = corte(JS_SIN, 'function attachMcpNotice(', 'function currentMcpCheck(')
  assert(/const consejo = mcpFailureHint\(status\)/.test(aviso), 'el aviso pregunta a mcpFailureHint')
  assert(/copiar: false,\s*\n\s*fila: row,/.test(aviso), 'en la misma fila que «Cambiar las claves», sin el comando')
  // El consejo se cuelga DENTRO del cuerpo de `if (consejo) {` —recortado hasta
  // su llave, como el botón de precarga de H12—: invertir la condición o quitar
  // el `appendChild` dejaban el pin viejo en verde (revisión adversaria de H15).
  const desdeIfConsejo = corte(aviso, 'if (consejo) {', '\n  }')
  assert(desdeIfConsejo.includes('mcpHintNode(consejo'), 'el cuerpo del if es el del consejo')
  assert(desdeIfConsejo.includes('wrap.appendChild(nodo)'), 'el motivo se cuelga sólo con consejo, dentro de su if')
  antesQue(aviso, 'wrap.appendChild(nodo)', 'wrap.appendChild(row)', 'el motivo va debajo del aviso y encima de los botones')

  // La pieza, UNA para los tres: texto, comando para copiar y «Reintentar»,
  // sin un solo enlace (S5).
  const pieza = corte(JS_SIN, 'function mcpHintNode(', 'async function retryMcp(')
  assert(pieza.length > 300, 'la pieza del consejo existe')
  assert(/texto\.className = 'fine'/.test(pieza) && /cmd\.className = 'cmd'/.test(pieza), 'reutiliza .fine y .cmd, sin clases nuevas')
  assert(/copyToClipboard\(consejo\.copy, copia\)/.test(pieza), 'el comando se copia como el resto de comandos del panel')
  assert(/reintentar\.textContent = 'Reintentar'/.test(pieza), 'y lleva «Reintentar»')
  // Y el botón HACE algo: quitarle el manejador dejaba el pin en verde con un
  // «Reintentar» muerto (revisión adversaria de H15).
  assert(pieza.includes("reintentar.addEventListener('click', () => onRetry(reintentar))"), '«Reintentar» llama a onRetry al pulsarlo')
  assert(!/href/.test(pieza) && !/innerHTML/.test(pieza), 'sin enlaces ni innerHTML: la ayuda es texto y un comando')
  for (const trozo of [claves, manual, aviso]) assert(!/href/.test(trozo), 'ningún cableado del consejo lleva un enlace')

  // «Reintentar»: el host ANTES del primer await, el botón apagado mientras.
  const reintento = corte(JS_SIN, 'async function retryMcp(', 'async function loadLinkedContext(')
  assert(reintento.length > 600, 'el manejador de reintento existe')
  const conectar = reintento.indexOf('await client.connectMcp(name)')
  assert(conectar > 0, 'reintenta con connectMcp')
  const captura = reintento.indexOf('const host = hostDado || (state.site?.host ?? state.lastHost)')
  assert(captura > 0 && captura < conectar, 'el host se captura ANTES de esperar (§8.22)')
  const apaga = reintento.indexOf('boton.disabled = true')
  assert(apaga > 0 && apaga < conectar, 'el botón se apaga antes de esperar: no hay doble clic')
  assert(reintento.indexOf('boton.disabled = false') > conectar, 'y vuelve después')
  assert(reintento.indexOf('await client.listMcp()') > conectar && /mcpStatusFor\(list, host, name\)/.test(reintento), 'el resultado se lee DESPUÉS en GET /mcp: connectMcp dice que sí aunque falle')
  assert(/log\.ok\('MCP reintentado'/.test(reintento) && /log\.warn\('MCP reintentado'/.test(reintento), 'se registra lo que pasó, bien o mal')
  assert(!/log\.\w+\([^)]*(config|environment)/.test(reintento), 'y nunca un cuerpo de configuración')
  const guarda = reintento.indexOf('if ((state.site?.host ?? state.lastHost) !== host || state.client !== client) return status')
  assert(guarda > conectar && guarda < reintento.indexOf('boton.disabled = false'), 'con el panel en otro sitio sólo se registra, no se pinta nada')
  // Con las dos marcas presentes: quitar la salida del paso manual dejaba el pin
  // viejo en verde (-1 < cualquier cosa, revisión adversaria de H15).
  antesQue(reintento, 'if (manual) {', 'await bootForSite()', 'desde el paso manual no se rearranca')
  assert(/if \(manual\) \{\s*\n\s*announce\(MCP_RECUPERADO\)\s*\n\s*return status/.test(reintento), 'la salida del paso manual devuelve sin rearrancar')
  assert(/if \(!state\.streaming\) \{\s*\n\s*await bootForSite\(\)/.test(reintento), 'sin turno en vuelo, el arranque normal adopta el MCP')
  assert(
    /state\.mcpConnected = true\s*\n\s*state\.mcpCheck = Promise\.resolve\(true\)\s*\n\s*state\.mcpPending = null/.test(reintento),
    'con un turno en vuelo, conectado para la pregunta siguiente'
  )

  // El HTML: las dos cajas, escondidas y vacías, cada una en su mitad.
  for (const id of ['setup-mcp-hint', 'setup-manual-hint']) {
    assert(htmlIds.has(id), 'falta #' + id)
    assert(HTML.includes(`<div class="hidden" id="${id}"></div>`), `#${id} nace vacío y escondido`)
  }
  const main = corte(HTML, 'id="setup-main"', 'id="setup-manual"')
  antesQue(main, 'id="setup-status"', 'id="setup-mcp-hint"', 'la caja va debajo de la frase de la pantalla de claves')
  const paso = corte(HTML, 'id="setup-manual"', 'id="btn-setup-later"')
  antesQue(paso, 'id="setup-waiting"', 'id="setup-manual-hint"', 'y la del paso manual, debajo de la espera')
  // La pantalla de conexión: qué mirar si opencode arranca y muere al momento.
  const conexion = corte(HTML, 'id="screen-connect"', 'id="screen-setup"')
  assert(/InvalidSymbol/.test(conexion) && /BOM/.test(conexion), 'el opencode.json con BOM')
  assert(/InvalidEscapeCharacter/.test(conexion), 'y las barras sin escapar dentro del JSON')
  assert(!/href/.test(conexion), 'sin enlaces')

  // El bloque que se pega a mano.
  const SETUP = sinComentarios(readFileSync(join(ROOT, 'src/panel/setup.js'), 'utf8'))
  assert(/timeout: 60000/.test(SETUP) && !/timeout: 30000/.test(SETUP), 'un minuto para arrancar')
  assert(/environment\.TOOLSETS = 'all'/.test(SETUP), 'y todas las herramientas')

  // El espejo pinta el bloque y el consejo con el código de verdad.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(espejo.includes("import('/src/panel/setup.js')"), 'el espejo importa setup.js')
  assert(/fullConfigSnippet\(\s*NOMBRE_MCP,\s*buildMcpConfig\(/.test(espejo), 'el bloque lo monta buildMcpConfig, no una copia')
  assert(!/timeout: 30000/.test(espejo) && !/command: \['uvx'/.test(espejo), 'ni un plazo ni un command copiados a mano')
  assert(/mcpFailureHint\(MCP_CAIDO\)/.test(espejo) && espejo.includes("'MCP error -32000: Connection closed'"), 'el consejo sale del mensaje real')
  for (const caja of ["'#setup-mcp-hint'", "'#setup-manual-hint'"]) {
    assert(corte(espejo, 'const CAJAS = [', 'function check()').includes(caja), 'check() mide ' + caja + ' a lo ancho')
  }
  assert(espejo.includes('Revisa ese bloque y reinicia opencode') && JS.includes('Revisa ese bloque y reinicia opencode'), 'el espejo y el panel dicen lo mismo del MCP caído')
})

test('H15 revisión: Reintentar tras vencer la espera sigue solo, un arranque sin sitio queda pendiente, y la pantalla de claves no pierde el foco', () => {
  const JS_SIN = sinComentarios(JS)
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  const orden = (src, marcas, msg) => {
    const pos = marcas.map((m) => src.indexOf(m))
    assert(pos.every((p) => p >= 0), msg + ': falta alguna marca ' + JSON.stringify(marcas.filter((m, k) => pos[k] < 0)))
    for (let k = 1; k < pos.length; k++) assert(pos[k - 1] < pos[k], msg + `: «${marcas[k - 1]}» tiene que ir antes que «${marcas[k]}»`)
  }

  // (5) El paso manual: pasó en la revisión adversaria de H15. La espera de 15
  // min vence con el MCP en «failed», el «Reintentar» sigue ahí y, al conectar,
  // `retryMcp` devolvía dando por hecho que la espera lo vería: la espera ya no
  // existía, el MCP quedaba conectado en opencode y el panel en «Sigo sin
  // verlo», sin `finishSetup` ni registros del sitio. Ahora, con la espera ya
  // vencida (y no cancelada), el propio botón hace lo que habría hecho ella.
  const manual = corte(JS_SIN, 'async function showManualStep(', 'async function finishSetup(')
  const alReintentar = corte(manual, 'onRetry: async (boton) => {', '\n        },')
  orden(
    alReintentar,
    [
      'retryMcp(s.name, { boton, host: site.host, manual: true, repintar: pintarConsejo })',
      'if (!vencida || state.mcpWait || !r?.connected) return',
      'if ((state.site?.host ?? state.lastHost) !== site.host) return',
      "waiting.classList.add('done')",
      "$('setup-waiting-text').textContent = 'MCP conectado. Comprobando las claves…'",
      'pintarConsejo(null)',
      'await finishSetup()',
    ],
    'Reintentar con la espera vencida sigue solo, y sólo si conectó y el panel sigue en ese sitio'
  )
  // `vencida` sólo la pone la espera al acabar SIN verlo conectado y sin que la
  // cancelaran: con la espera viva es ella quien sigue (y `finishSetup` no puede
  // correr dos veces), y cancelada —el usuario volvió a las claves— no se sigue.
  orden(
    manual,
    ['let vencida = false', 'if (controller.signal.aborted) return', 'if (!status.connected) {', 'vencida = true'],
    'la espera marca que venció sólo cuando acaba sin verlo y sin cancelarla'
  )
  assert(!/bootForSite\(/.test(manual), 'y desde el paso manual nunca se rearranca el panel')

  // (6) Un arranque sin sitio delante: `retryMcp` compara con `lastHost`, así
  // que irse al correo durante los ~12 s de connectMcp no contaba como cambio de
  // sitio y, al volver conectado, `bootForSite()` reventaba en
  // `getSiteBundle(state.site.host)` con la cabecera clavada en «comprobando…».
  // La guarda va ANTES del testigo: un arranque que no puede empezar no apaga
  // el que hubiera en marcha.
  const arranque = corte(JS_SIN, 'async function bootForSite() {', 'const cron = startTiming(')
  orden(
    arranque,
    ['if (!state.site) {', 'if (state.lastHost) state.bootPending = state.lastHost', 'return', 'const testigo = {}'],
    'bootForSite sin sitio deja el arranque pendiente y no toca el testigo'
  )
  // Y en `refreshTab` el arranque pendiente va DELANTE del recuento del perfil:
  // en un Jira sin el perfil de ese proyecto, la rama del perfil se lo tragaba
  // y el arranque no se hacía nunca (un fallo de antes de H15, visto aquí).
  const tab = corte(JS_SIN, 'async function refreshTab(', 'async function bootForSite(')
  orden(
    tab,
    [
      'if (changedHost) await bootForSite()',
      'else if (state.bootPending === site.host) await bootForSite()',
      "else if (site.product === 'jira' && site.projectKey && !currentProfile(site)",
      'else if (volviaDeFuera && !state.streaming) await restoreConversation()',
    ],
    'refreshTab: el arranque pendiente antes que el perfil'
  )

  // (8) La pantalla de claves: repintar el mismo consejo se llevaba el botón
  // que el usuario acababa de pulsar y el foco caía al <body> (lo que H5
  // corrigió en las dos mitades de esa pantalla); ahora hace lo que el paso
  // manual: si el texto es el mismo no toca nada, y si recrea, el foco va al
  // «Reintentar» nuevo.
  assert(/\nlet setupHintPintado = null\n/.test(JS_SIN), 'lo último pintado vive a nivel de módulo')
  const hint = corte(JS_SIN, 'function paintSetupMcpHint(', 'function attachMcpNotice(')
  orden(
    hint,
    [
      'if (consejo && consejo.text === setupHintPintado && caja.childElementCount) return',
      'const teniaFoco = caja.contains(document.activeElement)',
      "caja.textContent = ''",
      'setupHintPintado = consejo ? consejo.text : null',
      'if (teniaFoco) nuevo?.focus()',
    ],
    'el mismo consejo no se recrea, y el foco sigue en el botón al recrear'
  )
  const pantalla = corte(JS_SIN, 'function showSetupScreen(', 'function paintSetupProducts(')
  orden(pantalla, ["$('setup-mcp-hint').textContent = ''", 'setupHintPintado = null'], 'abrir la pantalla olvida lo pintado junto con la caja')

  // Y el resultado de un reintento se DICE (A2): el fallo con el motivo, y el
  // éxito del paso manual, que no rearranca ni cuelga ningún aviso que lo
  // anuncie (los `avisar` de la pantalla y del chat ya lo anuncian).
  const reintento = corte(JS_SIN, 'async function retryMcp(', 'async function loadLinkedContext(')
  const sinConectar = corte(reintento, 'if (!status.connected) {', '\n  }')
  orden(sinConectar, ['repintar?.(status)', 'announce(', 'return status'], 'un reintento fallido se anuncia con su motivo')
  assert(/mcpFailureHint\(status\)/.test(sinConectar), 'y el motivo es el mismo consejo que se pinta')
  eq(reintento.split('announce(').length - 1, 2, 'dos anuncios en retryMcp: el fallo y el éxito del paso manual, sin duplicar los de avisar')
})

test('H16: el modelo es de la persona, y un fallo por modelo no culpa a las claves ni deja un sitio sin contexto', () => {
  // El fallo del compañero (docs/PLAN2.md §3.3, anexo C): su plan rechazaba el
  // modelo que Faro elegía solo, la verificación de las claves lo contaba como
  // «Jira: …», el sitio se quedaba sin configurar, «Reintentar con…» saltaba a
  // otro rechazado, y al indexar el `catch` escribía `onboarded: true` sin
  // contexto. Todo por regex sobre el fuente SIN comentarios, recortado por
  // CÓDIGO y con el orden por posición, como el resto de este fichero.
  const JS_SIN = sinComentarios(JS)
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  // En SECUENCIA: cada marca se busca DESPUÉS de la anterior, porque algunas
  // (el testigo, `return`) aparecen muchas veces y lo que importa es que haya
  // una justo en ese hueco, no la primera del trozo.
  const orden = (src, marcas, msg) => {
    let desde = 0
    for (let k = 0; k < marcas.length; k++) {
      const p = src.indexOf(marcas[k], desde)
      assert(p >= 0, msg + `: falta «${marcas[k]}»` + (k ? ` detrás de «${marcas[k - 1]}»` : ''))
      desde = p + marcas[k].length
    }
  }

  // (1) El arranque RESUELVE el modelo con la lista delante: los veredictos se
  // leen después de la lista (su huella son los modelos), con el testigo al
  // volver, y `resolveModel` decide antes de pintar el desplegable.
  // Hasta el MCP: desde H17 `primeraVez` se decide ANTES del modelo, así que ya
  // no marca el final del paso 3.
  const paso3 = corte(JS_SIN, 'async function bootForSite(', 'const comprobacion = checkMcp(')
  orden(
    paso3,
    [
      'const [bundle, sessionID, modelos] = await Promise.all([',
      'const checks = await getModelChecks({',
      'fingerprint: modelsFingerprint(modelos.models),',
      'if (state.bootToken !== testigo) return',
      'state.modelChecks = checks',
      'const resuelto = resolveModel(modelos.models, {',
      'fillModels(modelos.models, elegido)',
    ],
    'los veredictos se leen con la lista delante y resolveModel va antes de fillModels'
  )
  assert(paso3.includes('settingsModel: state.settings.model,') && paso3.includes('savedModel: saved?.model,'), 'primero lo de la persona, y el del sitio sólo como migración')
  assert(!/saved\?\.model \|\|/.test(paso3), 'el modelo del sitio ya no manda por delante de todo')
  // Dos desde H17, y en caminos que no se cruzan: la salida del primer uso a «Elige
  // el modelo» (que pinta lo que haya y vuelve) y la de siempre.
  eq(paso3.split('fillModels(').length - 1, 2, 'el desplegable se pinta una vez por camino, con el modelo ya resuelto')
  eq(corte(paso3, 'if (primeraVez && sinModelo) {', 'if (!elegido) {').split('fillModels(').length - 1, 1, 'una en la salida a la pantalla del primer uso')
  // Sólo sin modelo propio: `resolveModel` cae en el del sitio también cuando el
  // de la persona tiene un fallo apuntado, y escribir ahí sería cambiarle la
  // elección por detrás en cada arranque.
  const migra = corte(paso3, 'if (resuelto.migrate && elegido && !state.settings.model) {', 'if (!elegido) {')
  assert(/state\.settings = await saveSettings\(\{ model \}\)/.test(migra), 'la migración escribe settings.model')
  assert(!/saveSite\(/.test(migra), 'y no vuelve a tocar saved.model')
  // Revisión adversaria de H16 (C9): se decide con los ajustes RELEÍDOS, no con
  // los de init(); con dos ventanas, la segunda pisaba lo que la primera acababa
  // de escribir. Relectura, testigo, y sólo sin modelo guardado se escribe.
  orden(
    migra,
    [
      'const guardados = await getSettings()',
      'if (state.bootToken !== testigo) return',
      'if (!guardados.model) {',
      'state.settings = await saveSettings({ model })',
      '} else {',
      'state.settings = guardados',
      'resolveModel(modelos.models, { settingsModel: guardados.model, savedModel: saved?.model, checks, now: ahora }).model ||',
      'if (state.bootToken !== testigo) return',
    ],
    'la migración relee los ajustes antes de escribir, y si ya hay modelo manda ése'
  )
  eq(paso3.split('saveSettings(').length - 1, 1, 'una sola escritura de ajustes en el arranque: la de la migración')
  const respaldo = corte(paso3, 'if (!elegido) {', 'fillModels(modelos.models, elegido)')
  orden(
    respaldo,
    ['recommendModel(modelos.models, { configModel: null, defaults: modelos.defaults, checks, now: ahora })', 'pickDefaultModel(modelos.models, modelos.defaults, { checks, now: ahora })'],
    'sin modelo resuelto, se preselecciona saltando lo que falla (H17 pone aquí la pantalla)'
  )
  assert(!/saveSettings\(/.test(respaldo), 'y la preselección NO se guarda como elección de la persona')
  // Revisión adversaria de H16 (C8): con TODOS marcados los dos respaldos dan
  // null; entonces el predeterminado SIN veredictos, dicho en el Registro, antes
  // de pintar el desplegable (que así dice lo mismo que state.model).
  const todos = corte(paso3, 'let todosMarcados = false', 'fillModels(modelos.models, elegido)')
  orden(
    todos,
    [
      'if (!elegido) {',
      'elegido = pickDefaultModel(modelos.models, modelos.defaults)\n',
      'todosMarcados = true',
      "log.warn('Modelo no disponible', `todos los modelos de la lista tienen un fallo apuntado · se usa ${modelKey(elegido)}`)",
    ],
    'todos marcados: el predeterminado sin veredictos, y se registra'
  )
  assert(!/checks/.test(todos), 'sin veredictos: no hay nada mejor que elegir')
  orden(
    paso3,
    ['if (!elegido) {', 'recommendModel(modelos.models,', 'let todosMarcados = false', 'fillModels(modelos.models, elegido)', 'if (todosMarcados) {', 'avisoModelo =', '«Olvidar los veredictos» en Ajustes'],
    'el último respaldo va detrás de los que saltan lo que falla, y deja su aviso preparado'
  )

  // Revisión adversaria de H16 (C7): el modelo de la PERSONA apartado al
  // arrancar se registra justo tras resolver, con su motivo, y se avisa.
  const apartar = corte(paso3, 'const resuelto = resolveModel(modelos.models, {', 'if (resuelto.migrate && elegido && !state.settings.model) {')
  orden(
    apartar,
    [
      'let apartado = null',
      "if (state.settings.model && resuelto.source !== 'settings' && !aceptado) {",
      'const veredicto = modelVerdict(checks, state.settings.model, ahora)',
      "'Modelo no disponible',",
      '`${suyo}: fallo apuntado (${veredicto.reason}) · se preselecciona otro esta vez`',
      '`${suyo}: no está en la lista`',
    ],
    'el modelo de la persona apartado se registra con su motivo'
  )
  assert(/log\.warn\(\s*'Modelo no disponible',/.test(apartar), 'como aviso del Registro')
  orden(
    paso3,
    ['} else if (apartado && state.model) {', 'avisoModelo =', 'elige otro si no te vale, o pulsa «Comprobar» para volver a probar el tuyo.'],
    'y el aviso se prepara con el modelo que de verdad queda'
  )
  // El aviso, DESPUÉS de restaurar la conversación (que vacía el chat) y con
  // el testigo comprobado.
  // Desde H17 el motivo abre la pantalla «Elige el modelo» (con la flecha a la
  // vista: el chat ya vive con la preselección) o, si taparía algo, su aviso con
  // «Elegir otro modelo». Sigue siendo DESPUÉS de restaurar y con el testigo.
  const tras = corte(JS_SIN, '  await restoreConversation(testigo)\n', 'refreshProfileSoon(testigo)')
  orden(
    tras,
    [
      'if (state.bootToken !== testigo) return',
      'medir()',
      'if (avisoModelo) {',
      "if (puedeAbrirPantalla()) showModelScreen({ modo: 'ajustes', motivo: avisoModelo, marcado: state.model })",
      "else attachModelNotice(avisoModelo, { marcado: state.model, modo: 'ajustes' })",
    ],
    'el motivo del modelo sale tras restaurar: pantalla si se puede, aviso si no'
  )
  const antesDeRestaurar = corte(JS_SIN, 'async function bootForSite(', '  await restoreConversation(testigo)\n')
  assert(!/showNotice\(avisoModelo|motivo: avisoModelo|attachModelNotice\(avisoModelo/.test(antesDeRestaurar), 'y no antes: restoreConversation se lo llevaría')
  assert(!/showNotice\(avisoModelo/.test(JS_SIN), 'ya no es un aviso suelto: es el motivo de la pantalla')
  // Sin lista, lo de siempre: el aviso de P4 y ningún ajuste tocado.
  const sinLista = corte(paso3, '} else {', "showNotice('No he podido leer la lista de modelos: ")
  assert(!/saveSettings\(|getModelChecks\(/.test(sinLista), 'sin lista de modelos no se decide nada del modelo')

  // `fillModels` no asigna lo que no está, y marca lo que tiene un fallo vigente.
  const rellenar = corte(JS_SIN, 'function fillModels(', '\n}\n')
  assert(/const enLista = selected \? models\.find\(\(m\) => modelKey\(m\) === modelKey\(selected\)\) : null/.test(rellenar), 'el elegido se busca en la lista')
  assert(!/log\./.test(rellenar), 'fillModels no registra: el «no está en la lista» lo dice bootForSite, que es el único que llama (revisión adversaria de H16)')
  orden(
    rellenar,
    ['if (elegido) {', 'state.model = { providerID: elegido.providerID, modelID: elegido.modelID }', '} else {', 'el.model.selectedIndex = -1', 'state.model = null'],
    'sin nada que elegir, el desplegable y state.model dicen lo mismo: nada'
  )
  assert(/const elegido = enLista \|\| pickDefaultModel\(models, state\.defaults, \{ checks: state\.modelChecks, now: ahora \}\)/.test(rellenar), 'y se cae al respaldo, que salta lo que falla')
  assert(!/state\.model = \{ providerID: selected\./.test(rellenar), 'nunca se asigna el que no está')
  assert(/opt\.textContent = modelOptionText\(m, ahora\)/.test(rellenar), 'cada opción dice lo que se sabe de ella')
  assert(/const NO_DISPONIBLE = ' · no disponible'/.test(JS_SIN), 'con el sufijo de sólo texto')
  const texto = corte(JS_SIN, 'function modelOptionText(', '\n}\n')
  assert(/modelFailing\(m, now\) \? NO_DISPONIBLE : ''/.test(texto), 'que sale sólo con un fallo vigente')

  // (2) El desplegable escribe los ajustes de la PERSONA, y ningún sitio vuelve
  // a guardar un modelo en su registro.
  const cambio = corte(JS_SIN, "el.model.addEventListener('change'", "el.skill.addEventListener('change'")
  assert(/saveSettings\(\{ model: parsed \}\)/.test(cambio), 'el desplegable guarda en settings.model')
  assert(!/saveSite\(/.test(cambio), 'y no en el sitio')
  assert(!/saveSite\([^)\n]*\{ model/.test(JS_SIN), 'SEGURIDAD §8.25: ningún saveSite(…{ model en todo el panel')
  // Y el modelo no viaja a la página: `pushSettings` sigue sin él (sus claves
  // exactas las pina service-worker.test.js; aquí, que ni se nombre).
  // Sobre el fuente CRUDO: el del worker lleva cadenas «'/*'» (patrones de
  // permisos) que `sinComentarios` toma por el principio de un comentario y se
  // comería media función; la de aquí no tiene ningún comentario dentro.
  const sw = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8')
  const empuje = corte(sw, 'async function pushSettings(', '\n}\n')
  assert(!/model/.test(empuje), 'SEGURIDAD: settings.model no viaja a la página')

  // (3) Un turno que falla por el modelo apunta el veredicto ANTES del aviso,
  // con el modelo que se mandó de verdad; el que acaba bien apunta un ok.
  const envio = corte(JS_SIN, 'async function send(', 'function paintTurn(')
  const colgado = corte(envio, 'if (turn.stalled) {', 'if (turn.aborted) {')
  orden(colgado, ['await noteModelFailure({ model: turn.model || peticion.model, rawError: turn.rawError, stalled: true })', 'cuerpo.appendChild(errorNode('], 'un turno colgado se apunta antes del aviso')
  const fallido = corte(envio, 'if (!turn.ok) {', 'splitAnchorsBlock(turn.text)')
  orden(
    fallido,
    ['if (suggestsAnotherModel(turn.rawError)) {', 'await noteModelFailure({ model: turn.model || peticion.model, rawError: turn.rawError, stalled: false })', 'cuerpo.appendChild(errorNode('],
    'un turno fallido por el proveedor se apunta antes del aviso, y uno por la conversación no'
  )
  orden(envio, ['warnAboutSources(', 'await noteModelOk(peticion.model)', "cron.mark('pintar')"], 'un turno bueno apunta que el modelo contesta, donde antes guardaba saved.model')
  // Revisión adversaria de H16 (C10): un turno que acaba sin una palabra es un
  // modelo MUDO (PLAN2 §3.3) y se apunta antes del aviso; uno que trae sólo el
  // bloque de anclas o sólo herramientas sí contestó y no se apunta.
  const sinTexto = corte(envio, 'if (!answer) {', 'if (!mismoSitio) {')
  orden(
    sinTexto,
    [
      'if (!turn.text?.trim() && !anchors && !turn.tools?.length) {',
      'await noteModelFailure({ model: turn.model || peticion.model, stalled: true })',
      "cuerpo.appendChild(noticeNode('El modelo no devolvió texto.', true))",
    ],
    'el turno sin texto se apunta como mudo antes del aviso, salvo sólo anclas o sólo herramientas'
  )
  const apuntar = corte(JS_SIN, 'async function noteModelFailure(', 'async function noteModelOk(')
  orden(
    apuntar,
    ['const ctx = modelChecksCtx()', 'verdictsForFailure({ model: elegido, rawError, stalled, models: state.models, now: ctx.now })', "'Modelo no disponible'", 'await recordModelChecks(verdicts, ctx)', 'if (state.settings.serverUrl === ctx.server) {', 'state.modelChecks = guardado'],
    '§8.22: el servidor se captura antes de escribir y se comprueba al volver'
  )
  assert(/fallo\.message\.slice\(0, 120\)/.test(apuntar) && /' · colgado'/.test(apuntar), 'el registro lleva el motivo y el mensaje acotado, o que se colgó')
  const bien = corte(JS_SIN, 'async function noteModelOk(', '\n}\n')
  assert(/recordModelChecks\(\[\{ key, ok: true, reason: 'ok', message: '', at: ctx\.now \}\], ctx\)/.test(bien), 'el ok se apunta con su forma')

  // «Reintentar con X» sólo si X tiene un veredicto ok vigente.
  const error = corte(JS_SIN, 'function errorNode(', 'const MOTIVO_MODELO')
  // Revisión adversaria de H16 (C4): se elige YA entre los que tienen ok
  // (pickRetryModel), en vez de elegir a ciegas y exigir el ok después, que
  // dejaba sin botón aunque otro modelo contestara. Con credenciales, otro
  // proveedor.
  assert(!/pickAlternativeModel\(/.test(error), 'errorNode ya no elige a ciegas')
  orden(
    error,
    [
      'function errorNode(message, tracker, question, { stalled = false } = {}) {',
      'const alt = pickRetryModel(state.models, modelKey(tracker?.model || state.model), {',
      'checks: state.modelChecks,',
      'now: ahora,',
      "otherProvider: classifyModelFailure(tracker?.rawError, { stalled }) === 'credenciales',",
      'if (!alt) return wrap',
      "document.createElement('button')",
    ],
    'sin un modelo con ok vigente distinto del que falló, ningún botón'
  )
  assert(/text,\n\s*\{ stalled: true \}\n\s*\)\)/.test(colgado), 'el turno colgado le dice a errorNode que fue por callarse')
  assert(/saveSettings\(\{ model: state\.model \}\)/.test(error) && !/saveSite\(/.test(error), 'y la elección va a los ajustes')

  // (4) La verificación: con `reason 'modelo'` no se culpa a las claves, no se
  // escribe ningún registro y `pendingMcp` se conserva para volver a comprobar.
  const fin = corte(JS_SIN, 'async function finishSetup(', 'function paintSnippet(')
  const rama = corte(fin, "if (!check.ok && check.reason === 'modelo') {", 'if (!check.ok) {')
  orden(
    rama,
    ['await noteModelFailure({ model: modelo, rawError: check.rawError, stalled: check.stalled })', 'hideScreens()', 'attachSetupModelNotice(texto)', 'return'],
    'se apunta, se cierra la pantalla y se dice en el chat'
  )
  assert(!/siteRecords\(|saveSite\(/.test(rama), 'sin registros del sitio: sigue sin configurar')
  assert(!/state\.pendingMcp\s*=/.test(rama) && !/state\.pendingMcp\s*=\s*null/.test(fin), 'y la configuración pendiente se conserva')
  const literales = (rama.match(/'[^'\n]*'|`[^`]*`/g) || []).join(' ')
  assert(!/claves/i.test(literales) && !/Jira:|Confluence:|\$\{etiqueta\}/.test(literales), 'el aviso no culpa a las claves ni lleva el producto delante')
  assert(JS_SIN.includes('No se ha llegado a comprobar ningún token: elige otro modelo en el desplegable y pulsa «Volver a comprobar».'), 'con el texto que dice qué hacer')
  orden(fin, ["if (!check.ok && check.reason === 'modelo') {", 'if (!check.ok) {', "check.reason === 'sin-herramientas'", 'siteRecords({'], 'la rama va antes de las de siempre, que no cambian')
  assert(/const modelo = state\.model/.test(fin), 'el modelo se captura al empezar la comprobación')
  assert(/verifyCredentials\(cliente, \{[^}]*model: modelo,[^}]*signal: abortador\.signal,[^}]*product,/.test(fin), 'y es con ése, con el cliente capturado y su señal, con el que se comprueba')
  // Revisión adversaria de H16 (C5, §8.22): un cambio de sitio a mitad cambia el
  // cliente y cancela la comprobación; lo que vuelve entonces no apunta ningún
  // veredicto, no cierra pantallas ni cuelga avisos en el chat del otro sitio.
  orden(
    fin,
    [
      'const modelo = state.model',
      'const cliente = state.client',
      'const abortador = new AbortController()',
      'state.setupAbort = abortador',
      'session = await cliente.createSession(',
      'const check = await verifyCredentials(cliente, {',
      "if (state.client !== cliente || check.reason === 'cancelado') {",
      "log.info('Turno cancelado', 'la comprobación de las claves se canceló al cambiar de sitio')",
      'return',
      "if (!check.ok && check.reason === 'modelo') {",
      '} finally {',
      'cliente.deleteSession(session.id)',
      'if (state.setupAbort === abortador) state.setupAbort = null',
    ],
    'la comprobación va con el cliente capturado y se abandona entera si cambia'
  )
  const guarda = corte(fin, "if (state.client !== cliente || check.reason === 'cancelado') {", "if (!check.ok && check.reason === 'modelo') {")
  assert(!/noteModelFailure|hideScreens|attachSetupModelNotice|say\(|state\.\w+\s*=/.test(guarda), 'la salida por cancelación no apunta, no cierra, no avisa y no toca el estado')
  assert(!/state\.client\.|verifyCredentials\(state\.client/.test(fin), 'ni una llamada con el cliente de AHORA')
  const construir = corte(JS_SIN, 'function buildClient(', 'const client = new OpencodeClient(')
  orden(
    construir,
    ['if (state.indexingAbort) {', 'state.indexingAbort.abort()', 'if (state.setupAbort) {', 'state.setupAbort.abort()', 'state.setupAbort = null', 'state.client?.disconnect()'],
    'buildClient cancela la comprobación de las claves junto al indexado, antes de desconectar'
  )
  assert(/\n  setupAbort: null,\n/.test(JS_SIN), 'y el estado la declara')
  const aviso = corte(JS_SIN, 'function attachSetupModelNotice(', 'async function restIndexFor(')
  assert(/noticeNode\(texto, true\)/.test(aviso) && /'Volver a comprobar'/.test(aviso), 'el aviso y su botón')
  assert(/btn\.className = 'ghost small ' \+ NEEDS_IDLE/.test(aviso) && /btn\.disabled = state\.streaming/.test(aviso), 'un turno de modelo más: no con otro en vuelo')
  orden(aviso, ["showScreen('screen-setup')", 'await finishSetup()'], 'vuelve a comprobar donde se ve lo que pasa')
  assert(!/pendingMcp/.test(aviso) && /announce\(texto\)/.test(aviso), 'con lo pendiente tal cual, y se anuncia')

  // (5) El catch del indexado: por modelo no da el sitio por configurado, y el
  // aviso se pinta DESPUÉS de repintar el chat (el pendiente de H2).
  const indexar = corte(JS_SIN, 'async function generateContext(', 'function attachReindexButton(')
  orden(indexar, ['await restIndexFor(', 'modeloDelIndexado = state.model', 'await buildContext('], 'el modelo del indexado se captura justo antes de lanzarlo, tras la lectura de la API')
  const captura = indexar.slice(indexar.indexOf('} catch (err) {'))
  orden(
    captura,
    ['AbortError', "log.error('Indexado fallido'", 'const porModelo = !!(err?.stalled || err?.rawError)', 'await noteModelFailure(', 'if (!porModelo) await saveSite(host, { onboarded: true })', 'await restoreConversation()', 'showNotice(aviso, true)'],
    'por modelo se apunta y no se da por configurado, y el aviso va detrás del repintado'
  )
  eq(captura.split('saveSite(host, { onboarded: true })').length - 1, 1, 'onboarded sólo en la rama que no es por modelo')
  assert(!/showNotice\(/.test(corte(captura, "log.error('Indexado fallido'", 'await restoreConversation()')), 'ningún aviso antes de repintar: restoreConversation se lo llevaría')
  assert(/vuelve a generar el contexto\./.test(captura) && /attachReindexButton\(\{ keepContext \}\)/.test(captura), 'y dice qué hacer, con el botón a mano')

  // (6) El planificador tampoco cae en lo que ya falló.
  assert(/pickPlannerModel\(state\.models, state\.model, \{ checks: state\.modelChecks, now: Date\.now\(\) \}\)/.test(JS_SIN), 'el planificador salta lo que falla')

  // (7) Lo global se ve y se borra: dos filas al final de «Qué guarda Faro de
  // mí» y su botón, que no toca el modelo elegido.
  const lista = corte(JS_SIN, 'async function paintPrivacy(', 'function hace(at)')
  orden(
    lista,
    ["'páginas base elegidas'", "const elegido = parseModelKey(modelKey(state.settings.model))", "'modelo elegido'", 'await getModelChecks(modelChecksCtx())', 'if (state.site?.host !== host) return', "'veredictos de modelos'", "'espacio usado'"],
    'las dos filas globales van al final, con el host comprobado tras leer'
  )
  assert(/const veredictos = Object\.keys\(guardados\?\.checks \|\| \{\}\)\.length\n/.test(lista), 'los veredictos son una CUENTA')
  assert(/veredictos · todos los sitios/.test(lista), 'y dicen que son de todos los sitios')
  const ajustesHtml = HTML.slice(HTML.indexOf('id="privacy-list"'))
  orden(ajustesHtml, ['id="btn-forget"', 'id="btn-forget-model-checks"'], 'el botón vive junto a «Olvidar este sitio»')
  assert(/<button class="ghost small" id="btn-forget-model-checks" type="button">Olvidar los veredictos<\/button>/.test(HTML), 'ghost small, con su texto')
  const olvidarV = corte(JS_SIN, "$('btn-forget-model-checks').addEventListener", "$('btn-forget').addEventListener")
  orden(olvidarV, ['await clearModelChecks()', 'state.modelChecks = null', "'Veredictos de modelos olvidados'", 'announce(', 'await paintPrivacy()'], 'se borra, se dice y se repinta')
  assert(!/saveSettings\(|state\.model\s*=|settings\.model/.test(olvidarV), 'y el modelo elegido se queda')
  const olvidarSitio = corte(JS_SIN, "$('btn-forget').addEventListener", "$('mem-enabled').addEventListener")
  assert(!/ModelChecks/.test(olvidarSitio), 'olvidar un sitio no toca lo de la persona')
  // Global: el cambio de host no lo vacía; el de servidor, sí.
  assert(!/state\.modelChecks = null/.test(corte(JS_SIN, 'async function refreshTab(', 'async function bootForSite(')), 'no es del sitio: cambiar de host no lo tira')
  const cerrar = corte(JS_SIN, "$('btn-settings-close').addEventListener", "$('btn-reindex')")
  orden(cerrar, ['const clientChanged =', 'if (clientChanged) state.modelChecks = null', 'await bootForSite()'], 'otro servidor, otros veredictos')

  // (9) Los CUERPOS que deciden (revisión adversaria de H16, C6): hasta aquí
  // se miraba que las cadenas estuvieran y en su orden, y 14 de 18 mutaciones
  // de lo que de verdad decide sobrevivían —el contexto sin servidor o sin
  // huella, el arranque sin veredictos, el sufijo que marcaba también los ok,
  // el desplegable sin repintar—. Cada corte, por su firma y hasta su cierre.
  const ctxV = corte(JS_SIN, 'function modelChecksCtx(', '\n}')
  assert(
    ctxV.includes('server: state.settings.serverUrl') && ctxV.includes('fingerprint: modelsFingerprint(state.models)') && ctxV.includes('now: Date.now()'),
    'los veredictos son del servidor de Ajustes y de la lista de ahora'
  )
  const leer = corte(paso3, 'const checks = await getModelChecks({', '}).catch(() => null)\n')
  assert(leer.includes('server: state.settings.serverUrl,') && leer.includes('fingerprint: modelsFingerprint(modelos.models),'), 'el arranque lee los de este servidor y esta lista')
  assert(leer.length < 200, 'y el catch es el de esa lectura, no uno de más abajo: ' + leer.length)
  const resolver = corte(paso3, 'const resuelto = resolveModel(modelos.models, {', '})')
  assert(
    resolver.includes('settingsModel: state.settings.model,') && resolver.includes('savedModel: saved?.model,') && resolver.includes('checks,') && resolver.includes('now: ahora'),
    'resolveModel decide CON los veredictos'
  )
  const falla = corte(JS_SIN, 'function modelFailing(', '\n}')
  orden(falla, ['const veredicto = modelVerdict(state.modelChecks, modelKey(model), now)', 'return !!veredicto && !veredicto.ok'], 'el sufijo sólo con un FALLO vigente')
  const repintar = corte(JS_SIN, 'function paintModelVerdicts(', '\n}')
  orden(
    repintar,
    ["for (const opt of el.model.querySelectorAll('option')) {", 'state.models.find((x) => modelKey(x) === opt.value)', 'opt.textContent = modelOptionText(m, ahora)'],
    'repintar recalcula el texto de cada opción del desplegable'
  )
  orden(
    apuntar,
    ['verdictsForFailure({', 'models: state.models', 'await recordModelChecks(verdicts, ctx)', 'if (state.settings.serverUrl === ctx.server) {', 'state.modelChecks = guardado', 'paintModelVerdicts()'],
    'un fallo apuntado se guarda con su contexto y se ve en el desplegable'
  )
  orden(
    bien,
    ['const ctx = modelChecksCtx()', "ok: true, reason: 'ok'", 'if (state.settings.serverUrl === ctx.server) {', 'state.modelChecks = guardado', 'paintModelVerdicts()'],
    'un acierto también, y con la misma guarda de servidor'
  )
  orden(olvidarV, ['state.modelChecks = null', 'paintModelVerdicts()', 'await paintPrivacy()'], 'olvidar los veredictos quita los sufijos del desplegable')
  const otraVez = corte(JS_SIN, 'function attachReindexButton(', '\n}')
  assert(/btn\.className = 'ghost small ' \+ NEEDS_IDLE/.test(otraVez) && /btn\.disabled = state\.streaming/.test(otraVez) && /if \(state\.streaming\) return/.test(otraVez), '«Generar el contexto otra vez» es un turno más: no con otro en vuelo')
  assert(/const modelo = err\?\.model \|\| modeloDelIndexado/.test(captura), 'el indexado apunta el modelo con el que se lanzó, no el de ahora')
  orden(aviso, ["btn.addEventListener('click', async () => {", 'if (state.streaming) return', 'wrap.remove()'], '«Volver a comprobar» no se lanza con un turno en vuelo')

  // (8) El espejo: las dos filas, delante del espacio usado, y una opción con
  // el mismo sufijo que el panel.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  orden(espejo, ["['modelo elegido',", "['veredictos de modelos',", "['espacio usado',"], 'el espejo enseña las dos filas globales donde el panel')
  assert(espejo.includes("' · no disponible'") && JS.includes("' · no disponible'"), 'y el sufijo del desplegable es el mismo: los dos textos se han separado')
  assert(/NO_DISPONIBLES\.has\(n\) \? ' · no disponible' : ''/.test(espejo), 'con alguna opción marcada')
})

test('H17: el modelo se elige en su pantalla antes de las claves, y todo fallo por modelo vuelve a ella', () => {
  // docs/PLAN2.md §3.3, la máquina del primer uso: sin modelo resuelto, «Elige el
  // modelo» ANTES de lanzar `checkMcp`; y la verificación de las claves, el
  // indexado y un turno que fallan por el modelo vuelven a ella. Todo sobre el
  // fuente SIN comentarios, recortado por CÓDIGO y con cada marca comprobada
  // (la lección de la revisión de H15: un indexOf ausente da verde).
  const JS_SIN = sinComentarios(JS)
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  const orden = (src, marcas, msg) => {
    let desde = 0
    for (let k = 0; k < marcas.length; k++) {
      const p = src.indexOf(marcas[k], desde)
      assert(p >= 0, msg + `: falta «${marcas[k]}»` + (k ? ` detrás de «${marcas[k - 1]}»` : ''))
      desde = p + marcas[k].length
    }
  }

  // (1) El primer uso: la pantalla va ANTES de las páginas base y del MCP, dentro
  // de su guarda, con lo del MCP soltado delante y un `return` detrás.
  const arranque = corte(JS_SIN, 'async function bootForSite(', 'function currentProfile(')
  orden(
    arranque,
    [
      'const primeraVez = !saved?.configured && !saved?.skippedKeys',
      'if (Array.isArray(modelos?.models)) {',
      'const sinModelo = !elegido || !!apartado',
      'if (primeraVez && sinModelo) {',
      'fillModels(modelos.models, elegido)',
      'state.mcpCheck = null',
      'state.mcpPending = null',
      "showModelScreen({\n        modo: 'primera-vez',",
      'marcado: elegido,',
      'medir()',
      'return',
      'if (!elegido) {',
      'paintSourcesUi()',
      'const comprobacion = checkMcp(client, testigo, saved)',
    ],
    'sin modelo en el primer uso, la pantalla antes de todo lo demás'
  )
  eq(arranque.split('const primeraVez =').length - 1, 1, 'la primera vez se decide UNA vez, antes del modelo')
  const guarda = corte(arranque, 'if (primeraVez && sinModelo) {', 'if (!elegido) {')
  assert(!/checkMcp\(|mcpResultSoon\(|await /.test(guarda), 'en esa salida no se lanza ni se espera nada del MCP')
  // La lista de modelos caída (P4): el aviso de siempre, y SÓLO sin ningún modelo
  // guardado, la pantalla en su modo vacío.
  const sinLista = corte(arranque, "showNotice('No he podido leer la lista de modelos: ", 'const comprobacion = checkMcp(')
  orden(
    sinLista,
    ['if (!state.settings.model && !saved?.model) {', 'state.models = []', 'state.mcpCheck = null', 'state.mcpPending = null', "showModelScreen({ modo: 'primera-vez',", 'medir()', 'return'],
    'lista caída y ningún modelo guardado: la pantalla vacía con «Reintentar»'
  )

  // (2) SEGURIDAD de gasto: la sonda sólo existe bajo «Comprobar».
  eq(JS_SIN.split('probeModel(').length - 1, 1, 'una sola llamada a probeModel en todo el panel')
  const sondear = corte(JS_SIN, 'async function runModelProbe(', 'function attachModelNotice(')
  assert(sondear.includes('cliente.probeModel(m, { signal: abortador.signal })'), 'y es la de runModelProbe')
  assert(!/probeModel\(/.test(arranque), 'ninguna sonda en el arranque')
  const usar = corte(JS_SIN, 'async function useModel(', 'async function runModelProbe(')
  assert(!/probeModel\(/.test(usar), 'ni al elegir')

  // (3) Elegir: se guarda como elección de la persona ANTES de decidir qué pasa,
  // y en el modo 'error' la pregunta vuelve al cuadro sin mandarse (§8.20).
  orden(
    usar,
    ['state.settings = await saveSettings({ model })', 'fillModels(state.models, model)', "log.ok('Modelo elegido', `${key} · desde ${s.modo}`)", 'switch (s.modo) {'],
    'se guarda, se pinta y se registra antes del cambio de modo'
  )
  orden(usar, ["case 'primera-vez':", 'hideScreens()', 'await bootForSite()'], 'el primer uso rearranca de verdad')
  orden(usar, ["case 'error':", 'hideScreens()', 'el.input.value = s.pregunta || state.lastQuestion', 'el.input.focus()'], 'el error deja la pregunta escrita')
  assert(!/\bsend\(/.test(usar), 'y nadie la manda')
  orden(usar, ["case 'setup':", "showScreen('screen-setup')", 'await finishSetup()'], 'la verificación se repite sola')
  orden(usar, ["case 'indexado':", 'hideScreens()', 'await generateContext({ keepContext: s.keepContext })'], 'y el indexado, con el mismo keepContext')
  assert(!/pendingMcp/.test(usar), 'lo pendiente del MCP se queda como estaba')

  // (4) Un turno que falla ofrece SIEMPRE «Elegir otro modelo», antes de la
  // salida que sólo decide «Reintentar con X».
  const error = corte(JS_SIN, 'function errorNode(', 'const MOTIVO_MODELO')
  orden(
    error,
    [
      "elegir.className = 'ghost small ' + NEEDS_IDLE",
      "elegir.textContent = 'Elegir otro modelo'",
      'elegir.disabled = state.streaming',
      "modo: 'error',",
      'marcado: fallido,',
      'pregunta: question || state.lastQuestion,',
      'row.appendChild(elegir)',
      'if (!suggestsAnotherModel(tracker?.rawError)) return wrap',
      'if (!alt) return wrap',
      'row.prepend(btn, hint)',
    ],
    '«Elegir otro modelo» va siempre; «Reintentar con X», sólo con un ok'
  )

  // (5) La verificación de las claves que falla por el modelo vuelve a la
  // pantalla, con lo pendiente conservado.
  const fin = corte(JS_SIN, 'async function finishSetup(', 'function paintSnippet(')
  const rama = corte(fin, "if (!check.ok && check.reason === 'modelo') {", 'if (!check.ok) {')
  orden(rama, ['hideScreens()', 'if (puedeAbrirPantalla()) {', "modo: 'setup',", 'marcado: modelo,', '} else {', 'attachSetupModelNotice(texto)', 'return'], 'por el modelo, la pantalla (o el aviso si taparía algo)')
  assert(!/pendingMcp/.test(rama), 'sin tocar lo pendiente del MCP')

  // (6) El indexado que falla por el modelo, también, detrás del aviso de H16.
  // Desde la revisión adversaria de H17 (C6), con la pantalla el aviso de H16 y
  // su botón; sin ella, el aviso con «Elegir otro modelo» UNA vez y el botón.
  const indexar = corte(JS_SIN, 'async function generateContext(', 'function attachReindexButton(')
  const captura = indexar.slice(indexar.indexOf('} catch (err) {'))
  orden(
    captura,
    [
      'const pantalla = porModelo && puedeAbrirPantalla()',
      'if (!porModelo || pantalla) {',
      'showNotice(aviso, true)',
      'if (porModelo) attachReindexButton({ keepContext })',
      "if (pantalla) showModelScreen({ modo: 'indexado', motivo: motivoPantalla, marcado: modelo, keepContext })",
      '} else {',
      "attachModelNotice(aviso, { modo: 'indexado', marcado: modelo, keepContext })",
      'attachReindexButton({ keepContext })',
    ],
    'por el modelo, la pantalla con el mismo keepContext, o su aviso'
  )

  // (7) «Comprobar»: el veredicto que devuelve se apunta, con el servidor
  // capturado antes y comprobado al volver (§8.22).
  orden(
    sondear,
    [
      'const ctx = modelChecksCtx()',
      'state.modelProbeAbort = abortador',
      'cliente.probeModel(',
      'state.settings.serverUrl !== ctx.server',
      "if (!r.ok && r.rawError?.name === 'OpencodeError') {",
      "log.warn('Modelo comprobado', `${key} · sin comprobar · ${detalle}`)",
      'return',
      'if (r.ok) {',
      "await recordModelChecks([{ key, ok: true, reason: 'ok', message: '', at: Date.now() }]",
      "log.ok('Modelo comprobado', `${key} · ${r.ms} ms`)",
      '} else {',
      'const mudo = !!r.stalled || !r.rawError',
      'await noteModelFailure({ model: m, rawError: r.rawError, stalled: mudo })',
      "log.warn('Modelo comprobado', `${key} · ${motivo}` + (fallo?.message ? ' · ' + fallo.message.slice(0, 120) : ''))",
      'setModelStatus(texto)',
    ],
    'la sonda apunta lo que dice y lo registra en las dos ramas'
  )
  const construir = corte(JS_SIN, 'function buildClient(', 'const client = new OpencodeClient(')
  orden(construir, ['if (state.modelProbeAbort) {', 'state.modelProbeAbort.abort()', 'state.client?.disconnect()'], 'tirar el cliente cancela la sonda')

  // (8) La flecha: nace oculta en el HTML y sólo se enseña desde Ajustes o desde
  // un error; Escape no pulsa un botón oculto.
  assert(/<button class="icon-btn back" id="btn-model-close" type="button" title="Volver" aria-label="Volver" hidden>/.test(HTML), 'la flecha nace oculta')
  // Y oculta de verdad: el `display: grid` de `.icon-btn` le gana al `display: none`
  // que el navegador pone a `[hidden]`, y sin esta regla la flecha se veía igual.
  assert(CSS_LIMPIO.includes('.icon-btn.back[hidden] { display: none; }'), 'una flecha con hidden no se ve')
  const asignaciones = [...JS_SIN.matchAll(/\$\('btn-model-close'\)\.hidden = ([^\n]+)/g)].map((m) => m[1])
  eq(asignaciones, ['!cerrable'], 'la flecha se enseña en UN sitio')
  const abrir = corte(JS_SIN, 'async function showModelScreen(', 'function paintModelList(')
  assert(abrir.includes("const cerrable = modo === 'ajustes' || modo === 'error'\n"), 'sólo en los modos de los que se sale sin elegir')
  orden(abrir, ["$('btn-model-close').hidden = !cerrable", "showScreen('screen-model')"], 'antes de abrir la pantalla')
  const eventos = corte(JS, 'function wireEvents', 'async function saveKeys')
  const esc = corte(eventos, "document.addEventListener('keydown'", 'el.send.addEventListener')
  orden(esc, ['const btn = ESCAPE_CLOSES[abierta.id]', 'const boton = $(btn)', "if (!boton || boton.hidden || boton.closest('.hidden')) return", 'ev.preventDefault()', 'boton.click()'], 'Escape mira el botón antes de pulsarlo')
  assert(!/\$\(btn\)\.click\(\)/.test(esc), 'y ya no lo pulsa a ciegas')
  eq(ESCAPE_CLOSES['screen-model'], 'btn-model-close', 'Escape cierra la pantalla por su flecha, cuando se ve')

  // (9) P5 se cruza aquí: un resultado tardío del MCP no abre la pantalla de
  // claves encima de la de modelo, porque `puedeAbrirPantalla` dice que no con
  // CUALQUIER pantalla abierta, y ésta es una.
  const puede = corte(JS_SIN, 'function puedeAbrirPantalla(', 'function showMcpSetup(')
  assert(puede.includes("if (document.querySelector('.screen:not(.hidden)')) return false"), 'otra pantalla abierta: no se abre la de claves')
  assert(/<section class="screen hidden" id="screen-model" aria-labelledby="model-title">/.test(HTML), 'y la del modelo es una pantalla')
  const pendiente = corte(JS_SIN, 'function showMcpPending(', 'function faltanClaves(')
  orden(pendiente, ['if (puedeAbrirPantalla()) showMcpSetup(pendiente.status)', 'else attachMcpNotice(pendiente.status)'], 'lo pendiente del MCP pasa por esa pregunta')

  // (10) El aviso de cuando la pantalla taparía algo abre la pantalla con su modo.
  const aviso = corte(JS_SIN, 'function attachModelNotice(', 'function paintSettingsModelInfo(')
  orden(aviso, ['noticeNode(motivo, true)', "btn.textContent = 'Elegir otro modelo'", 'showModelScreen({ modo, motivo, marcado, keepContext, pregunta })', 'announce(motivo)'], 'el aviso abre la pantalla con su modo')
  assert(!/clearEmpty\(\)/.test(aviso), 'y no se lleva la bienvenida, como el del MCP')

  // (11) La lista: por proveedor, lo que falla plegado y contado, y sólo texto.
  const pintar = corte(JS_SIN, 'function paintModelList(', 'function modelRow(')
  orden(pintar, ['usableModels(state.models)', 'modelVerdict(state.modelChecks, key, ahora)', 'const fuera = !m.usable || (veredicto && !veredicto.ok)', "grupo.className = 'model-group'", '`No disponibles (${cuantos})`'], 'lo que falla, plegado y contado')
  const fila = corte(JS_SIN, 'function modelRow(', 'function paintModelButtons(')
  orden(fila, ["fila.className = 'check model-row' + (veredicto ? (veredicto.ok ? ' ok' : ' bad') : '')", "radio.name = 'model-choice'", 'nombre.textContent = m.name', "etiqueta('predeterminado de opencode')", "etiqueta('el de tu configuración')", 'why.textContent = porQue'], 'cada fila es un label con su radio')
  const porque = corte(JS_SIN, 'function modelWhy(', 'function modelScreenChoice(')
  for (const frase of ['funciona · ', "'no disponible con tu plan'", "'no contesta'", "'credenciales caducadas: opencode auth login'", 'falló ']) {
    assert(porque.includes(frase), 'el veredicto en palabras: ' + frase)
  }
  assert(/const msg = mensajeCorto\(veredicto\.message\)/.test(porque), 'con el mensaje del proveedor acotado')
  const eleccion = corte(JS_SIN, 'function modelScreenChoice(', 'async function showModelScreen(')
  orden(
    eleccion,
    ['s?.elegido', 's?.marcado', 'if (marcado && marcado.usable && !modelFailing(marcado, ahora)) return s.marcado', 'recommendModel(state.models, {', 'configModel: state.configModel || null,', 'm.usable && !modelFailing(m, ahora)'],
    'la preselección: lo tocado, lo marcado si se puede usar, la recomendada y el primero disponible'
  )

  // (12) El modelo de la configuración de opencode: UN campo, validado, lo pone
  // `checkMcp` con el cliente comprobado, lo pide la pantalla si llega antes, y
  // lo vacía el cambio de servidor (no el de host).
  const comprobar = corte(JS_SIN, 'async function checkMcp(', 'function mcpResultSoon(')
  assert(comprobar.includes('if (config && state.client === client) state.configModel = configModelOf(config)'), 'checkMcp guarda sólo ese campo')
  assert(!/state\.\w+ = config\b/.test(JS_SIN), 'la configuración entera no se guarda nunca')
  orden(
    abrir,
    [
      'if (state.configModel !== undefined || !state.client) return',
      'const cliente = state.client',
      'const testigo = state.bootToken',
      'const host = state.site?.host ?? state.lastHost',
      'await cliente.config().catch(() => null)',
      'if (state.client !== cliente || state.bootToken !== testigo',
      'state.configModel = configModelOf(config)',
    ],
    'la pantalla la pide con lo capturado antes (§8.22)'
  )
  const cerrar = corte(JS_SIN, "$('btn-settings-close').addEventListener", "$('btn-reindex')")
  orden(cerrar, ['const clientChanged =', 'if (clientChanged) state.configModel = undefined', 'await bootForSite()'], 'otro servidor, otra configuración')
  assert(!/state\.configModel =/.test(corte(JS_SIN, 'async function refreshTab(', 'async function bootForSite(')), 'no es del sitio')

  // (13) Ajustes: «Cambiar el modelo», con la flecha, y la línea del modelo.
  assert(JS_SIN.includes("$('btn-change-model').addEventListener('click', () => showModelScreen({ modo: 'ajustes', marcado: state.model })"), 'Ajustes abre la pantalla en su modo')
  assert(corte(JS_SIN, 'async function showSettingsScreen(', "showScreen('screen-settings')").includes('paintSettingsModelInfo()'), 'y dice qué modelo es el tuyo')
  orden(HTML, ['id="settings-model-info"', 'id="btn-change-model"', '<h2>Servidor</h2>'], 'en su sección, encima del servidor')

  // (14) Los ids y las clases, con su REGLA (la trampa de `.older-turns` de H6).
  for (const id of [
    'screen-model', 'model-title', 'model-reason', 'model-filter', 'model-list', 'model-unavailable',
    'model-unavailable-summary', 'model-unavailable-list', 'model-status', 'btn-model-use', 'btn-model-check',
    'btn-model-retry', 'btn-model-close', 'model-empty', 'btn-change-model', 'settings-model-info',
  ]) {
    assert(htmlIds.has(id), 'falta el id ' + id)
  }
  assert(/<label for="model-filter">/.test(HTML) && /id="model-filter" type="search"/.test(HTML), 'el filtro tiene su etiqueta')
  assert(/id="model-list" role="group" aria-labelledby="model-title"/.test(HTML), 'la lista es un grupo con nombre')
  assert(/title="Un turno corto con este modelo; con un proveedor de pago cuesta una petición">Comprobar</.test(HTML), '«Comprobar» dice lo que cuesta')
  for (const regla of ['.model-list {', '.model-group {', '.model-group > legend {', '.model-row {', '.model-name {', '.model-tag {', '.model-why {', '.model-row.bad .model-why {', '.model-row.ok .model-why {', '.model-unavailable > summary {']) {
    assert(CSS_LIMPIO.includes(regla), 'clase sin regla: ' + regla)
  }
  assert(/\.model-row\.bad \.model-why \{ color: var\(--danger\); \}/.test(CSS_LIMPIO) && /\.model-row\.ok \.model-why \{ color: var\(--ok\); \}/.test(CSS_LIMPIO), 'el veredicto en rojo o en verde, con los tokens de siempre')

  // (15) El espejo: la pantalla con los módulos y las fixtures de verdad, y el
  // recorrido encadenado del primer uso.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  assert(espejo.includes('data-screen="screen-model"'), 'la pantalla está en el grupo Pantallas')
  assert(espejo.includes("import('/src/shared/models.js')"), 'con models.js de verdad')
  assert(espejo.includes("fetch('/test/fixtures/models/providers.json')") && espejo.includes("fetch('/test/fixtures/models/rechazos.json')"), 'y las dos fixtures reales')
  assert(/const CAJAS = \[[\s\S]*'\.model-row',[\s\S]*'#model-list',[\s\S]*\]/.test(espejo), 'las filas y la lista se miden a lo ancho')
  assert(/ultimoRecorrido/.test(espejo) && /'screen-connect', 'screen-model', 'screen-setup', 'screen-context'/.test(espejo), 'el recorrido encadenado del primer uso')
  assert(espejo.includes("'funciona · '") && espejo.includes("'no disponible con tu plan'") && JS.includes("'no disponible con tu plan'"), 'los mismos textos que el panel')
})

test('H17 revisión: los cuerpos que deciden, no sólo el orden de las cadenas', () => {
  // Revisión adversaria de H17 (C4): la prueba de arriba pinaba presencia y orden
  // de cadenas, y 21 de 24 mutaciones de lo que de verdad decide la pantalla
  // pasaban en verde —la guarda de la sonda, la de la pantalla vigente, lo
  // aceptado a sabiendas, el filtro, el radio, el anuncio—. Aquí cada corte va
  // por su firma hasta su cierre, con sus marcas comprobadas (un indexOf ausente
  // es un pin vacuo: la lección de H15), y se añade lo que los demás hallazgos
  // de esa revisión cambiaron (R1, C3, C5, C6).
  const JS_SIN = sinComentarios(JS)
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  const orden = (src, marcas, msg) => {
    let desde = 0
    for (let k = 0; k < marcas.length; k++) {
      const p = src.indexOf(marcas[k], desde)
      assert(p >= 0, msg + `: falta «${marcas[k]}»` + (k ? ` detrás de «${marcas[k - 1]}»` : ''))
      desde = p + marcas[k].length
    }
  }

  // R1: lo que el usuario toca manda; lo que se pidió marcar (el que acaba de
  // fallar) sólo es la preselección si se puede usar y no tiene un fallo
  // vigente; si no, la recomendada (que con otro modelo con veredicto ok es ÉSE)
  // y después el primero disponible.
  const eleccion = corte(JS_SIN, 'function modelScreenChoice(', '\n}')
  orden(
    eleccion,
    [
      'if (enLista(s?.elegido)) return s.elegido\n',
      'const marcado = enLista(s?.marcado) ? usableModels(state.models).find((m) => modelKey(m) === s.marcado) : null',
      'if (marcado && marcado.usable && !modelFailing(marcado, ahora)) return s.marcado',
      'const rec = recommendModel(state.models, {',
      'checks: state.modelChecks,',
      'if (rec) return modelKey(rec)',
      "const libre = usableModels(state.models).find((m) => m.usable && !modelFailing(m, ahora))",
      "return libre ? modelKey(libre) : ''",
    ],
    'lo tocado, lo pedido si vale, la recomendada con los veredictos y el primero disponible'
  )
  eq(eleccion.split('return s.marcado').length - 1, 1, 'SEGURIDAD: lo pedido sólo vuelve por la guarda del fallo vigente y la usabilidad')
  // Y el que falló queda a la vista: «No disponibles» se despliega también con
  // él dentro aunque no sea el radio marcado.
  const pintar = corte(JS_SIN, 'function paintModelList(', '\nfunction modelRow(')
  orden(
    pintar,
    [
      "const pedido = state.modelScreen?.marcado || ''",
      "if ([...plegada.querySelectorAll('input')].some((r) => r.checked || (pedido && r.value === pedido))) detalles.open = true",
    ],
    'lo marcado y lo que acaba de fallar, desplegados'
  )
  // El filtro, entero: nombre, id y proveedor, sin distinguir mayúsculas.
  assert(pintar.includes("const f = String(filtro || '').trim().toLowerCase()"), 'el filtro se compara en minúsculas')
  assert(
    pintar.includes('if (f && !`${m.name} ${m.modelID} ${m.providerID} ${m.providerName}`.toLowerCase().includes(f)) continue'),
    'el filtro deja fuera lo que no casa por nombre, id ni proveedor'
  )

  // C3: el motivo se anuncia al abrir, y lo que pasa en la pantalla también.
  const abrir = corte(JS_SIN, 'async function showModelScreen(', 'function paintModelList(')
  orden(abrir, ["showScreen('screen-model')", 'if (state.modelScreen.motivo) announce(state.modelScreen.motivo)', 'if (state.configModel !== undefined || !state.client) return'], 'el motivo se dice al abrir (A2)')
  assert(
    abrir.includes('if (state.client !== cliente || state.bootToken !== testigo || (state.site?.host ?? state.lastHost) !== host) return'),
    'la configuración tardía no pinta sobre otro sitio (§8.22)'
  )
  const estado = corte(JS_SIN, 'function setModelStatus(', '\n}')
  orden(estado, ["$('model-status').textContent = texto", 'if (anunciar && texto) announce(texto)'], 'lo que pasa se escribe y se dice')

  // Los botones: sin nada marcado o con una sonda en vuelo, apagados.
  const botones = corte(JS_SIN, 'function paintModelButtons(', '\n}')
  orden(
    botones,
    ['const hay = !!modelScreenChoice()', 'const probando = !!state.modelProbeAbort', "$('btn-model-use').disabled = !hay || probando", "$('btn-model-check').disabled = !hay || probando"],
    '«Usar» y «Comprobar» sólo con algo marcado y sin sonda'
  )

  // useModel: la guarda de la pantalla vigente, la de un turno en vuelo antes de
  // repetir otro turno, y lo aceptado a sabiendas.
  const usar = corte(JS_SIN, 'async function useModel(', 'async function runModelProbe(')
  orden(
    usar,
    [
      "if (!s || $('screen-model').classList.contains('hidden')) return",
      "if ((s.modo === 'setup' || s.modo === 'indexado') && state.streaming) {",
      "setModelStatus('Espera a que termine la respuesta: lo siguiente es otro turno del modelo.')",
      'return',
      'state.settings = await saveSettings({ model })',
      'if (state.modelScreen !== s) return',
      'state.modelScreen = null',
      "state.modelAceptado = modelFailing(m) ? key : ''",
      'fillModels(state.models, model)',
    ],
    'la pantalla vigente, sin repetir turnos con otro en vuelo, y lo aceptado apuntado'
  )
  const arranque = corte(JS_SIN, 'async function bootForSite(', 'function currentProfile(')
  orden(arranque, ['const aceptado =', "if (aceptado && resuelto.source !== 'settings') elegido = aceptado", 'if (primeraVez && sinModelo) {'], 'el arranque no vuelve a apartar lo aceptado')

  // runModelProbe: sin doble clic, suelta su abortador y (C5) repinta la
  // pantalla que esté ABIERTA, no sólo la misma de antes.
  const sondear = corte(JS_SIN, 'async function runModelProbe(', 'function attachModelNotice(')
  orden(sondear, ['const s = state.modelScreen', 'if (!s || state.modelProbeAbort) return', 'state.modelProbeAbort = abortador'], 'una sonda cada vez')
  orden(sondear, ['r = await cliente.probeModel(', '} finally {', 'if (state.modelProbeAbort === abortador) state.modelProbeAbort = null'], 'la sonda suelta su abortador pase lo que pase')
  assert(!sondear.includes('state.modelScreen === s'), 'C5: la sonda no exige la MISMA pantalla para encender los botones')
  orden(
    sondear,
    [
      "const abierta = !$('screen-model').classList.contains('hidden')",
      'if (abierta) {',
      'paintModelButtons()',
      "if (!$('screen-model').classList.contains('hidden')) {",
      'paintModelButtons()',
      "if (!$('screen-model').classList.contains('hidden')) {",
      "paintModelList($('model-filter').value)",
      'setModelStatus(texto)',
    ],
    'los tres repintados van a la pantalla abierta'
  )

  // SEGURIDAD §8.13 (X9/X10): de la configuración de opencode sólo sale su
  // `model`, validado y reconstruido; la configuración entera lleva las claves de
  // los MCP en claro y no se asigna a nada del estado.
  eq(
    corte(JS_SIN, 'function configModelOf(config) {', '\n}'),
    "function configModelOf(config) {\n  const clave = typeof config?.model === 'string' ? config.model.trim() : ''\n  if (!clave || clave.length > 240 || /\\s/.test(clave)) return null\n  return parseModelKey(clave)",
    'SEGURIDAD: configModelOf lee config.model como cadena, lo valida y lo reconstruye, y nada más'
  )
  assert(!/state\.\w+ = config\b/.test(JS_SIN), 'SEGURIDAD: ninguna asignación de la configuración a secas al estado')
  assert(!/state\.\w+ = (?:await )?\w+(?:\?\.|\.)config\(/.test(JS_SIN), 'SEGURIDAD: ni lo que devuelve GET /config, directamente')
  const asignaciones = [...JS_SIN.matchAll(/state\.configModel = ([^\n]+)/g)].map((m) => m[1].trim())
  assert(asignaciones.length >= 3, 'las asignaciones de configModel existen: ' + asignaciones.length)
  for (const a of asignaciones) assert(a === 'configModelOf(config)' || a === 'undefined', 'SEGURIDAD: configModel sólo por configModelOf: ' + a)

  // attachModelNotice (C6 y X11): cuelga del chat y se anuncia, y su botón es
  // un turno parado como «Elegir otro modelo» de errorNode.
  const aviso = corte(JS_SIN, 'function attachModelNotice(', 'function paintSettingsModelInfo(')
  orden(
    aviso,
    [
      "btn.className = 'ghost small ' + NEEDS_IDLE",
      "btn.textContent = 'Elegir otro modelo'",
      'btn.disabled = state.streaming',
      "btn.addEventListener('click', () => {",
      'if (state.streaming) return',
      'showModelScreen({ modo, motivo, marcado, keepContext, pregunta })',
      'wrap.appendChild(row)',
      'el.chat.appendChild(wrap)',
      'announce(motivo)',
    ],
    'el aviso: su botón con NEEDS_IDLE, colgado del chat y anunciado'
  )
  assert(/el\.chat\.appendChild\(wrap\)\s*announce\(motivo\)/.test(aviso), 'el aviso se cuelga del chat y justo después se dice')

  // C6: en el catch del indexado ninguna rama pinta showNotice Y el aviso con su
  // botón a la vez (dos avisos rojos idénticos, dos anuncios).
  const indexar = corte(JS_SIN, 'async function generateContext(', 'function attachReindexButton(')
  const captura = indexar.slice(indexar.indexOf('} catch (err) {'))
  const conPantalla = corte(captura, 'if (!porModelo || pantalla) {', '} else {')
  assert(conPantalla.includes('showNotice(aviso, true)') && !conPantalla.includes('attachModelNotice('), 'con pantalla (o sin modelo): el aviso de siempre y ningún otro')
  const sinPantalla = corte(captura, '} else {\n          attachModelNotice(aviso', '\n        }')
  assert(!sinPantalla.includes('showNotice('), 'C6: sin pantalla, el aviso lo pinta attachModelNotice UNA vez')
  orden(sinPantalla, ["attachModelNotice(aviso, { modo: 'indexado', marcado: modelo, keepContext })", 'attachReindexButton({ keepContext })'], 'el aviso y debajo «Generar el contexto otra vez»')
  eq(captura.split('attachModelNotice(').length - 1, 1, 'el aviso del modelo sale en un solo sitio del catch')

  // errorNode (X14): «Elegir otro modelo» no abre la pantalla con un turno en vuelo.
  const error = corte(JS_SIN, 'function errorNode(', 'const MOTIVO_MODELO')
  assert(/elegir\.addEventListener\('click', \(\) => \{\s*if \(state\.streaming\) return\s*showModelScreen\(\{/.test(error), '«Elegir otro modelo» se guarda de un turno en vuelo')

  // mensajeCorto (X12): 120 de tope, con su elipsis.
  orden(corte(JS_SIN, 'function mensajeCorto(', '\n}'), ['function mensajeCorto(texto, max = 120) {', "return t.length > max ? t.slice(0, max - 1) + '…' : t"], 'el mensaje del proveedor acotado a 120')

  // Los oyentes de la pantalla (X16, X17, X18, X20).
  const eventos = corte(JS_SIN, 'function wireEvents', 'async function saveKeys')
  assert(eventos.includes("$('btn-model-use').addEventListener('click', () => useModel().catch(console.error))"), '«Usar este modelo» elige')
  assert(eventos.includes("$('btn-model-check').addEventListener('click', () => runModelProbe().catch(console.error))"), '«Comprobar» sondea')
  assert(eventos.includes("$('btn-model-retry').addEventListener('click', () => bootForSite().catch(console.error))"), '«Reintentar» del modo vacío rearranca')
  assert(/\$\('btn-model-close'\)\.addEventListener\('click', \(\) => \{\s*state\.modelScreen = null\s*hideScreens\(\)/.test(eventos), 'la flecha suelta la pantalla antes de cerrarla')
  assert(eventos.includes("$('model-filter').addEventListener('input', () => paintModelList($('model-filter').value))"), 'el filtro repinta')
  const radio = corte(eventos, "for (const lista of [$('model-list'), $('model-unavailable-list')]) {", 'paintModelButtons()')
  orden(radio, ["lista.addEventListener('change', (ev) => {", "if (ev.target?.name !== 'model-choice' || !state.modelScreen) return", 'state.modelScreen.elegido = ev.target.value'], 'lo que se toca es lo que se usa')
  assert(eventos.includes("$('btn-change-model').addEventListener('click', () => showModelScreen({ modo: 'ajustes', marcado: state.model }).catch(console.error))"), 'Ajustes abre la pantalla en su modo, con la flecha')

  // El primer uso sigue decidido por la primera vez Y la falta de modelo (X19).
  assert(arranque.includes('    if (primeraVez && sinModelo) {\n'), 'sólo la primera vez y sin modelo')

  // Lo que se ve (X21, X22): la segunda línea parte, y el filtro tiene etiqueta.
  const porQue = CSS_LIMPIO.slice(CSS_LIMPIO.indexOf('.model-why {'))
  assert(CSS_LIMPIO.includes('.model-why {') && /^\.model-why \{[^}]*overflow-wrap: anywhere;[^}]*\}/.test(porQue), '.model-why parte las palabras largas')
  assert(!/^\.model-why \{[^}]*white-space: nowrap/.test(porQue), 'y no se queda en una línea')
  assert(HTML.includes('<label for="model-filter">Buscar un modelo</label>'), 'el filtro tiene su etiqueta')
})

test('H18: las claves se escriben por la API de opencode, con consentimiento, con el panel quieto y sin fugas', () => {
  // docs/PLAN2.md §3.2: hasta H18 `saveKeys` llamaba a `POST /mcp`, que en
  // opencode 1.2.25 sólo arranca el MCP en memoria, y siempre acababa en el paso
  // manual. Ahora escribe por `PATCH /global/config` (las dos puertas cerradas
  // del cliente), espera a que la entrada aparezca y conecte, relee lo que
  // opencode carga y sólo entonces verifica. Todo sobre el fuente SIN
  // comentarios, recortado por CÓDIGO y con cada marca comprobada.
  const JS_SIN = sinComentarios(JS)
  const corte = (src, desde, hasta) => {
    const i = src.indexOf(desde)
    assert(i >= 0, 'falta la marca de inicio del recorte: ' + desde)
    const j = src.indexOf(hasta, i + desde.length)
    assert(j > i, 'falta la marca de final del recorte (o va antes): ' + hasta)
    return src.slice(i, j)
  }
  const orden = (src, marcas, msg) => {
    let desde = 0
    for (const m of marcas) {
      const p = src.indexOf(m, desde)
      assert(p >= 0, msg + ': falta «' + m + '» (o va antes de la anterior)')
      desde = p + m.length
    }
  }
  const claves = corte(JS_SIN, 'async function saveKeys() {', 'async function showManualStep(')
  const guardar = corte(claves, 'async function saveKeys() {', 'async function esperarEntrada(')

  // (1) El consentimiento, antes de escribir, y la carpeta REAL de GET /path.
  orden(
    guardar,
    [
      'const sitio = state.site',
      'const host = sitio.host',
      'const cliente = state.client',
      'if (!consentimientoListo()) {',
      'return',
      'state.settings = await saveSettings({ configWriteConsent: true })',
      'const rutas = await cliente.paths().catch(() => null)',
      'result = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes })',
    ],
    'sitio, host y cliente capturados; sin permiso no se escribe'
  )
  assert(corte(guardar, 'if (!consentimientoListo()) {', '\n  }').includes('return'), 'sin permiso, se vuelve sin escribir')
  const permiso = corte(JS_SIN, 'function consentimientoListo() {', '\n}')
  assert(permiso.includes("if ($('setup-consent-ok').checked) return true"), 'la casilla marcada vale')
  assert(permiso.includes('return !!state.settings.configWriteConsent && !state.setupConfirmar'), 'el permiso ya dado vale, salvo desde «Cambiar las claves»')
  const bloque = corte(JS_SIN, 'async function paintSetupConsent() {', '\n}')
  orden(
    bloque,
    ['const pedir = !state.settings.configWriteConsent || state.setupConfirmar', 'const cliente = state.client', 'await cliente.paths()', 'if (state.client !== cliente', "$('setup-consent-path').textContent = rutas.config"],
    'el bloque enseña la carpeta del servidor que contesta'
  )
  const pantalla = corte(JS_SIN, 'function showSetupScreen(', 'function paintSetupProducts(')
  assert(pantalla.includes('function showSetupScreen({ confirmar = false } = {}) {') && pantalla.includes('state.setupConfirmar = !!confirmar'), 'la pantalla sabe si viene de «Cambiar las claves»')
  assert(pantalla.includes('paintSetupConsent()'), 'y pinta el consentimiento al abrirse')
  assert(JS_SIN.includes("$('btn-edit-keys').addEventListener('click', () => showSetupScreen({ confirmar: true }))"), '«Cambiar las claves» confirma SIEMPRE')
  assert(JS_SIN.includes("$('setup-consent-ok').addEventListener('change', paintSetupSave)"), 'marcar la casilla enciende el botón')

  // (2) La guarda común «opencode se está reconfigurando»: sólo con el panel
  // quieto, y lo que el MCP tenía en marcha se invalida ANTES del PATCH.
  const guarda = corte(JS_SIN, 'function reconfiguring() {', '\n}')
  for (const q of ['if (state.streaming) return', 'if (state.indexingAbort) return', 'if (state.modelProbeAbort) return', 'if (state.setupAbort) return']) {
    assert(guarda.includes(q), 'la guarda mira: ' + q)
  }
  assert(guarda.trim().endsWith("return ''"), 'y con todo quieto deja escribir')
  orden(
    guardar,
    ['const configAntes = await cliente.config()', 'const ocupado = reconfiguring()', 'if (ocupado) {', 'return', 'state.mcpCheck = null', 'state.mcpPending = null', 'state.mcpWait?.abort()', 'state.mcpConnected = false', 'result = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes })'],
    'la guarda justo antes de escribir, y la invalidación antes del PATCH'
  )
  assert(corte(guardar, 'if (ocupado) {', '\n    }').includes('return'), 'con algo en marcha, no se escribe')
  assert(HTML.includes('<button class="primary needs-idle" id="btn-setup-save" type="button">'), 'el botón de guardar pide el turno parado')
  const streaming = corte(JS_SIN, 'function setStreaming(on) {', '\n}')
  orden(streaming, ["for (const b of $('screen-setup').querySelectorAll('.' + NEEDS_IDLE)) b.disabled = on", 'paintSetupSave()'], 'setStreaming apaga la pantalla de claves y repinta el de guardar con el permiso')
  const boton = corte(JS_SIN, 'function paintSetupSave() {', '\n}')
  assert(/disabled = escribiendoClaves \|\| state\.streaming \|\| !consentimientoListo\(\)/.test(boton), 'sin permiso, con un turno o escribiendo, apagado')

  // (3) Nunca POST /mcp: ni addMcp en el panel, y connectMcp SÓLO en retryMcp.
  assert(!/addMcp\(/.test(JS_SIN), 'addMcp no existe en el panel')
  assert(!/connectMcp\(/.test(claves), 'saveKeys no conecta nada a mano')
  eq(JS_SIN.split('connectMcp(').length - 1, 1, 'connectMcp sólo en retryMcp (H15)')
  assert(corte(JS_SIN, 'async function retryMcp(', 'async function loadLinkedContext(').includes('connectMcp('), 'y es retryMcp quien lo tiene')

  // (4) La espera: que APAREZCA, con los plazos de MCP_RELOAD_LIMITS y no con
  // números a mano; después que conecte, con el consejo de H15.
  const aparecer = corte(claves, 'async function esperarEntrada(', 'async function arrancarMcp(')
  orden(
    aparecer,
    ['setTimeout(r, MCP_RELOAD_LIMITS.pollMs)', 'await cliente.listMcp()', 'mcpStatusFor(lista, host, name)', 'if (s.present) return', 'MCP_RELOAD_LIMITS.appearMs'],
    'se sondea hasta que aparece, con los plazos del módulo'
  )
  assert(!/setTimeout\([^)]*\d{3,}/.test(claves), 'ningún plazo escrito a mano')
  orden(
    guardar,
    ['status.textContent = ESTADO_CLAVES.escribiendo', 'configureMcp(cliente,', 'ESTADO_CLAVES.recargando + notaVersion()', 'esperarEntrada(cliente, host, result.name, espera.signal)', 'ESTADO_CLAVES.arrancando', 'arrancarMcp('],
    'los tres estados de la espera, en su orden'
  )
  const arrancar = corte(claves, 'async function arrancarMcp(', 'function entradaEfectiva(')
  assert(arrancar.includes("mcpFailureHint(s)?.kind === 'sin-arranque'") && arrancar.includes('MCP_RELOAD_LIMITS.fastFailMs'), 'la caída al instante es «Connection closed» antes de fastFailMs')
  assert(arrancar.includes('waitForMcpReady(cliente, host, {') && arrancar.includes('intervalMs: MCP_RELOAD_LIMITS.pollMs'), 'y la espera es la de siempre')
  assert(arrancar.includes('paintSetupMcpHint(s, { host, espera })'), 'con el consejo de H15, sin duplicarlo')
  const hint = corte(JS_SIN, 'function paintSetupMcpHint(', 'function attachMcpNotice(')
  assert(hint.includes('manual: !!espera && state.mcpWait === espera'), 'con la espera viva, Reintentar deja que siga ella')

  // (5) El reintento con la ruta absoluta de uvx: sólo una entrada NUEVA que
  // cayó al instante, y si no conecta, vuelta atrás al command estándar.
  assert(guardar.includes('const creada = result.reuse === false'), 'creada = la escribió Faro ahora, no una que ya estaba')
  assert(
    guardar.includes('arrancarMcp({ cliente, host, name: result.name, espera, primero: aparecida.status, vigilarCaida: creada })'),
    'la caída sólo se vigila en una entrada creada'
  )
  const reintentar = corte(guardar, 'if (arranque.caida && creada) {', 'const como = arranque.status.present')
  orden(
    reintentar,
    [
      'const conRuta = uvxAbsoluteCommand(rutas)',
      'if (conRuta) {',
      'configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes, command: conRuta })',
      'if (arranque.status.connected) {',
      '} else {',
      'const vuelta = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes })',
    ],
    'la ruta absoluta (validada por UVX_ABS_PATH dentro de uvxAbsoluteCommand) y la vuelta atrás'
  )
  eq(guardar.split('uvxAbsoluteCommand(').length - 1, 1, 'un solo reintento')

  // (6) La relectura DESPUÉS de conectar: la entrada que opencode carga es la
  // escrita; si no, se dice y no se verifica.
  orden(
    guardar,
    [
      'if (!arranque.status.connected) {',
      'return',
      'const configDespues = await cliente.config()',
      'if (!entradaEfectiva(configDespues, hosts, result.name)) {',
      'hay una configuración de proyecto delante',
      'return',
      'await finishSetup()',
    ],
    'se relee tras conectar, y sólo con la entrada efectiva se verifica'
  )
  const efectiva = corte(claves, 'function entradaEfectiva(', 'async function reloadPastedConfig(')
  assert(
    efectiva.includes('mcpEntriesForHost(config, h).find((e) => e.name === name)') && efectiva.includes('entrada.enabled !== false'),
    'la entrada efectiva: por nombre, entre las del dominio, y habilitada'
  )

  // (7) Las degradaciones: sin escribir, el respaldo manual con el porqué; sin
  // aparecer, «ya está escrito, reinicia opencode».
  orden(
    guardar,
    ['if (!result.ok) {', "log.warn('MCP sin escribir', `${result.status || 0} · ${result.kind || 'sin tipo'}`)", "await showManualStep(result, { motivo: 'sin-escribir', kind: result.kind })"],
    'sin escribir: respaldo manual'
  )
  orden(
    guardar,
    [
      'if (!aparecida) {',
      "log.warn('MCP escrito en opencode',",
      "await showManualStep(result, { motivo: 'no-aparece', ruta })",
      "log.ok('MCP escrito en opencode', `${result.name} · ${ruta} · PATCH ${msPatch} ms · aparece en ${aparecida.ms} ms`)",
    ],
    'sin aparecer: ya está escrito'
  )
  const manual = corte(JS_SIN, 'async function showManualStep(', 'async function finishSetup(')
  assert(manual.includes("async function showManualStep(result, { motivo = '', kind = '', ruta = '' } = {}) {"), 'el paso manual sabe por qué se llega')
  assert(manual.includes('fullConfigSnippet(result.name, result.block)') && manual.includes('mcpBlockSnippet(result.name, result.block)'), 'el bloque de siempre, el que se ha intentado escribir')
  assert(
    manual.includes('porQueNoSeEscribe({ status: result.status, kind })') && manual.includes("$('setup-manual-paste').classList.toggle('hidden', yaEscrito)"),
    'el porqué a la vista, y sin nada que pegar si ya está escrito'
  )
  assert(manual.includes('mcpName: result.name,'), 'la espera busca el nombre con el que se escribió')
  const porQue = corte(claves, 'function porQueNoSeEscribe(', '\n}')
  assert(
    porQue.includes("kind === 'ConfigJsonError'") && porQue.includes('error de sintaxis') && porQue.includes("kind === 'ConfigInvalidError'") && porQue.includes('una clave que opencode no conoce'),
    'el tipo del error en palabras'
  )
  assert(porQue.includes('/^[A-Za-z]{1,40}$/.test(kind)'), 'y un tipo que no conoce sólo si tiene forma de nombre')

  // (8) «Ya lo he pegado»: el PATCH {} fijo, por la misma guarda.
  const recargar = corte(claves, 'async function reloadPastedConfig() {', 'function porQueNoSeEscribe(')
  orden(
    recargar,
    ['const ocupado = reconfiguring()', 'return', 'state.mcpCheck = null', 'state.mcpPending = null', 'state.mcpConnected = false', 'await cliente.reloadGlobalConfig()'],
    'la misma guarda y la misma invalidación antes del PATCH {}'
  )
  assert(!/reloadGlobalConfig\([^)]/.test(JS_SIN), 'reloadGlobalConfig nunca lleva argumentos')
  assert(recargar.includes("log.ok('Configuración recargada'") && recargar.includes("log.warn('Configuración recargada'"), 'se registra, bien o mal')
  assert(JS_SIN.includes("$('btn-setup-reload').addEventListener('click', () => reloadPastedConfig()"), 'el botón está cableado')

  // (9) SEGURIDAD: de la respuesta del PATCH y de GET /config no sale NADA —ni
  // al registro, ni a un anuncio, ni a la pantalla—. Cada variable que las
  // recibe sólo se lee por lo que las puertas devuelven ({ok, status, kind}) o
  // se pasa a una pura que sólo saca hosts y nombres.
  const adoptar = corte(JS_SIN, 'async function comprobarClavesAdoptadas(', '\n}\n')
  const region = claves + adoptar
  const PERMITIDAS = {
    result: ['ok', 'status', 'kind', 'name', 'block', 'reuse'],
    reintento: ['ok'],
    vuelta: ['ok', 'kind', 'status'],
    recarga: ['ok', 'status', 'kind'],
  }
  for (const [nombre, props] of Object.entries(PERMITIDAS)) {
    let lecturas = 0
    for (const m of region.matchAll(new RegExp('(\\.\\.\\.)?\\b' + nombre + '\\b(\\??\\.(\\w+))?', 'g'))) {
      const antes = region.slice(Math.max(0, m.index - 20), m.index)
      const despues = region.slice(m.index + m[0].length, m.index + m[0].length + 4)
      const declara = /(const|let)\s+$/.test(antes) || /^\s*=[^=]/.test(despues)
      // `result` entero sólo va al respaldo manual, que lee de él name, block y
      // status (el bloque que se intentó escribir, no la respuesta).
      const alRespaldo = nombre === 'result' && /showManualStep\($/.test(antes)
      const ok = declara || alRespaldo || (!!m[1] && nombre === 'result') || (!!m[3] && props.includes(m[3]))
      assert(ok, `SEGURIDAD: «${m[0]}» no es una lectura permitida de la respuesta del PATCH`)
      lecturas++
    }
    assert(lecturas > 1, 'la variable ' + nombre + ' existe y se lee')
  }
  eq(region.match(/\bconfigAntes\b/g).length, region.match(/config: configAntes\b/g).length + 1, 'configAntes sólo va a configureMcp (chooseWriteTarget)')
  eq(region.match(/\bconfigDespues\b/g).length, 2, 'configDespues sólo va a entradaEfectiva')
  eq(adoptar.match(/(?<!\.)\bconfig\b/g).length, 2, 'la config de «Comprobar las claves» sólo va a mcpForHost')
  assert(adoptar.includes('const found = mcpForHost(config, host)'), 'de ella sólo salen hosts y nombre')
  for (const linea of region.split('\n')) {
    if (/log\.\w+\(|announce\(|textContent/.test(linea)) {
      assert(!/configAntes|configDespues|\benvironment\b|\.block\b/.test(linea), 'SEGURIDAD: una línea que registra o pinta no lleva configuración: ' + linea.trim())
    }
  }

  // (10) Escribir ≠ verificar, y la adopción sin verificar.
  const comprobar = corte(JS_SIN, 'async function checkMcp(', 'function mcpResultSoon(')
  assert(
    comprobar.includes('const mismoYaProbado = !!saved?.configured && saved?.mcpName === found.name && !keysUnverified(saved)'),
    'sólo lo ya probado del MISMO MCP se conserva'
  )
  orden(
    comprobar,
    ['const registros = siteRecords({', 'verified: mismoYaProbado,', 'for (const registro of registros) await saveSite(registro.host, registro.patch)', "if (!mismoYaProbado) log.warn('Claves sin comprobar'"],
    'la adopción escribe verified y lo dice'
  )
  const fin = corte(JS_SIN, 'async function finishSetup(', 'function paintSnippet(')
  assert(!/configureMcp\(|updateMcpEntries\(|reloadGlobalConfig\(/.test(fin), 'finishSetup verifica y NO escribe en opencode')
  orden(
    fin,
    [
      "if (!check.ok && check.reason === 'modelo') {",
      'const antes = await getSite(site.host)',
      'const registros = siteRecords({',
      'verified: true,',
      'for (const { host, patch } of registros) await saveSite(host, patch)',
      "if (keysUnverified(antes)) log.ok('Claves sin comprobar'",
    ],
    'la primera verificación buena escribe verified: true en todos los registros, detrás de la rama del modelo'
  )
  const aviso = corte(JS_SIN, 'async function avisarClavesSinComprobar(', 'async function comprobarClavesAdoptadas(')
  orden(
    aviso,
    ['const saved = await getSite(host)', 'if (state.site?.host !== host || !keysUnverified(saved)) return', "btn.className = 'ghost small ' + NEEDS_IDLE", "'Comprobar las claves'", 'btn.disabled = state.streaming', 'comprobarClavesAdoptadas(btn)'],
    'el aviso: sólo con verified false explícito, y su botón pide el turno parado'
  )
  orden(
    adoptar,
    ['const sitio = state.site', 'const cliente = state.client', 'await cliente.config()', 'if (!found) {', 'return', 'state.pendingMcp = { name: found.name, site: sitio,', "showScreen('screen-setup')", 'await finishSetup()'],
    '«Comprobar las claves» verifica lo que hay, sin escribir'
  )
  assert(!/configureMcp\(|updateMcpEntries\(|reloadGlobalConfig\(/.test(adoptar), 'sin escribir nada en opencode')
  // La migración: nadie lee `verified` a mano en el panel —un `!saved?.verified`
  // avisaría a todos los registros guardados antes de H18—, sólo keysUnverified.
  assert(!/\.verified\b/.test(JS_SIN), 'el panel no mira verified a mano')
  const DE_HOY = { configured: true, mcpName: 'atlassian-jira-simplprogramme-eu', product: 'jira', cloud: false, confluenceHost: 'confluence.simplprogramme.eu', onboarded: true, skill: 'analisis' }
  eq(keysUnverified(DE_HOY), false, 'un registro guardado hoy, sin verified, NO avisa')
  eq(keysUnverified({ ...DE_HOY, verified: false }), true, 'sólo verified: false explícito avisa')
  eq(keysUnverified({ ...DE_HOY, verified: true }), false, 'y verificado, no')
  const restaurar = corte(JS_SIN, 'async function restoreConversation(', 'function showWelcome(')
  assert(/showMcpPending\(\)\s*\n\s*avisarClavesSinComprobar\(\)/.test(restaurar), 'el recordatorio se vuelve a colgar al repintar el chat, sin anunciar')
  assert(
    corte(JS_SIN, 'async function onMcpResult(', 'function showMcpPending(').includes('if (keysUnverified(r.saved)) avisarClavesSinComprobar({ anunciar: true })'),
    'y la adopción tardía lo dice ya'
  )

  // (11) La versión de opencode, leída sin esperarla, y dicha en la espera.
  const arranque = corte(JS_SIN, 'async function bootForSite() {', 'function refreshProfileSoon(')
  orden(arranque, ["cron.mark('health')", '.version()', 'if (state.client === client) state.opencodeVersion = v'], 'la versión, junto a health y del cliente que preguntó')
  assert(!/await client\.version\(\)/.test(arranque), 'sin que el arranque la espere')
  assert(corte(JS_SIN, 'function notaVersion() {', '\n}').includes('v === OPENCODE_VERIFIED_VERSION'), 'y la espera dice si no es la probada')

  // (12) El HTML: el consentimiento delante del botón, y el respaldo manual.
  for (const id of ['setup-consent', 'setup-consent-path', 'setup-consent-ok', 'btn-setup-reload', 'setup-manual-why', 'setup-manual-paste']) {
    assert(htmlIds.has(id), 'falta #' + id)
  }
  const main = corte(HTML, 'id="setup-main"', 'id="setup-manual"')
  orden(
    main,
    ['<div class="field hidden" id="setup-consent">', 'id="setup-consent-path"', '<label class="check"><input type="checkbox" id="setup-consent-ok">', 'id="btn-setup-save"'],
    'el consentimiento, con su carpeta y su casilla, delante del botón'
  )
  assert(main.includes('si tienes una respuesta a medias en otra ventana conectada') && main.includes('opencode.jsonc'), 'y dice lo que pasa y dónde')
  // La carpeta es una ruta de Windows sin espacios: medido en el espejo al cerrar
  // H18, una de 80 caracteres empujaba el bloque a 347 px en un panel de 320 y
  // `check()` salía en rojo. Se parte, nunca empuja a lo ancho.
  assert(/#setup-consent-path \{[^}]*overflow-wrap: anywhere/.test(CSS_LIMPIO), 'la carpeta del consentimiento se parte en vez de desbordar a 320 px')
  const paso = corte(HTML, 'id="setup-manual"', 'id="btn-setup-later"')
  orden(
    paso,
    ['<p class="fine hidden" id="setup-manual-why"></p>', 'id="setup-manual-paste"', 'id="setup-waiting"', '<button class="ghost needs-idle" id="btn-setup-reload" type="button">Ya lo he pegado</button>'],
    'el porqué arriba, y «Ya lo he pegado» junto a la espera'
  )
  assert(!/href/.test(main) && !/href/.test(paso), 'sin enlaces')

  // (13) El espejo: el consentimiento con una carpeta de mentira, los estados de
  // la espera, el respaldo manual con su porqué y el recordatorio en el chat de
  // Jira, con los MISMOS textos que el panel (panel.js no se puede importar desde
  // el iframe) y con sus cajas medidas a lo ancho.
  const espejo = readFileSync(join(ROOT, 'harness/panel-preview.html'), 'utf8')
  for (const k of ['escribiendo', 'recargando', 'arrancando', 'fallo']) assert(espejo.includes(`data-claves="${k}"`), 'el espejo tiene el estado ' + k)
  for (const t of ['Escribiendo en opencode…', 'Esperando a que opencode recargue…', 'Arrancando el MCP…']) {
    assert(espejo.includes(`'${t}'`) && guardar.length && JS_SIN.includes(`'${t}'`), 'el espejo y el panel dicen lo mismo: ' + t)
  }
  assert(espejo.includes("$('setup-consent').classList.remove('hidden')") && espejo.includes("$('setup-consent-path').textContent = 'C:"), 'el consentimiento, con su carpeta')
  const errorSintaxis = 'La configuración de opencode tiene un error de sintaxis: corrígelo, pega el bloque y pulsa «Ya lo he pegado».'
  assert(espejo.includes('Faro no ha podido escribirlo por ti. ' + errorSintaxis) && JS_SIN.includes(errorSintaxis) && JS_SIN.includes("'Faro no ha podido escribirlo por ti. '"), 'el porqué del respaldo, igual en los dos')
  const recordatorio = 'no se han comprobado todavía: opencode tenía el MCP conectado y Faro lo ha adoptado'
  assert(espejo.includes(recordatorio) && JS_SIN.includes(recordatorio), 'el recordatorio, igual en los dos')
  assert(corte(espejo, 'function avisoClavesSinComprobar() {', '\n  }\n').includes("mk('button', 'ghost small needs-idle', 'Comprobar las claves')"), 'con su botón, que pide el turno parado')
  assert(/chat\.appendChild\(avisoMcpSinConectar\(\)\)\s*\n(\s*\/\/[^\n]*\n)*\s*chat\.appendChild\(avisoClavesSinComprobar\(\)\)/.test(espejo), 'en la conversación de Jira, debajo del aviso del MCP')
  const cajas = corte(espejo, 'const CAJAS = [', 'function check()')
  for (const caja of ["'#setup-consent'", "'#setup-consent .check'", "'#setup-manual-why'"]) assert(cajas.includes(caja), 'check() mide ' + caja + ' a lo ancho')
  assert(/setClaves\(k\) \{/.test(espejo), 'y el mando para ponerlo desde fuera')
})
