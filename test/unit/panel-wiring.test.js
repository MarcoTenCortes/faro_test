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

const ROOT = join(import.meta.dirname, '..', '..')
const HTML = readFileSync(join(ROOT, 'src/panel/panel.html'), 'utf8')
const JS = readFileSync(join(ROOT, 'src/panel/panel.js'), 'utf8')
const CSS = readFileSync(join(ROOT, 'src/panel/panel.css'), 'utf8')

const htmlIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))

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
  const faltan = necesarias.filter((c) => !new RegExp('\\.' + c + '\\b').test(CSS))
  eq(faltan, [], 'clases usadas en JS sin estilo')
})

test('estilo: el panel define ambos temas con variables', () => {
  assert(/prefers-color-scheme:\s*dark/.test(CSS), 'falta el tema oscuro')
  const varsClaras = new Set([...CSS.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]))
  assert(varsClaras.has('gold') && varsClaras.has('ink') && varsClaras.has('ground'), 'faltan tokens base')
  // El fondo del body debe salir de un token, no heredarse del anfitrión.
  assert(/body\s*\{[^}]*background:\s*var\(--ground\)/s.test(CSS), 'el body debe pintar su propio fondo')
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
  assert(/mcpConnected: mcpAlPedir/.test(envio), 'si había MCP se captura al mandar')

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
    assert(new RegExp('\\.' + c + '\\b').test(CSS), 'clase sin estilo: ' + c)
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
  assert(/\.product-keys\b/.test(CSS), 'clase sin estilo: product-keys')

  const claves = JS.slice(JS.indexOf('async function saveKeys'), JS.indexOf('async function showManualStep'))
  assert(/setup-\$\{product\}-token/.test(claves), 'cada producto lee su token')
  assert(!/'setup-token'|'setup-email'/.test(claves), 'y no hay un token para los dos')
  assert(/configureMcp\(state\.client, \{ host: state\.site\.host, jira, confluence, dataCenter \}\)/.test(claves), 'las claves viajan por producto')
  assert(/hostOf\(env\.JIRA_URL\)/.test(claves) && /hostOf\(env\.CONFLUENCE_URL\)/.test(claves), 'los hosts salen de la configuración construida, no del campo')

  // Se comprueban los dos tokens, y el otro host queda enlazado.
  const fin = JS.slice(JS.indexOf('async function finishSetup'), JS.indexOf('function paintSnippet'))
  assert(/for \(const product of PRODUCTS\.filter/.test(fin), 'una comprobación por producto habilitado')
  assert(/verifyCredentials\(state\.client, \{[^}]*product,/.test(fin))
  assert(/siteRecords\(\{/.test(fin) && /for \(const \{ host, patch \} of registros\) await saveSite\(host, patch\)/.test(fin), 'los registros de cada host salen de siteRecords')
  assert(/'Sitio enlazado'/.test(fin), 'y queda en el registro')

  // Al arrancar, el MCP se busca por el nombre guardado (el de la pareja) y
  // desde Jira se carga el contexto del Confluence enlazado.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function ensureContentAccess'))
  // El nombre guardado cuenta por detrás de lo que opencode tiene de verdad
  // (`chosenMcpName`: opencode → lo apuntado → el nombre por host).
  assert(/mcpStatusFor\(mcp, state\.site\.host, chosenMcpName\(config, saved, state\.site\.host, \{ status: mcp \}\)\)/.test(arranque), 'el nombre guardado cuenta')
  assert(arranque.indexOf('let saved = await getSite') < arranque.indexOf('mcpStatusFor(mcp'), 'y se lee antes')
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
  assert(/const found = mcpForHost\(config, state\.site\.host, \{ status: mcp \}\)/.test(arranque), 'y se busca el MCP que lleva este dominio, mirando su estado')
  assert(/if \(found && found\.connected && \(/.test(arranque), 'sólo se adopta lo que está conectado: apuntar uno caído pisaba lo que funcionaba')
  assert(/saved\?\.jiraHost !== found\.jiraHost/.test(arranque) && /saved\?\.confluenceHost !== found\.confluenceHost/.test(arranque), 'y también cuando el MCP ya apuntado trae un host nuevo')
  assert(/siteRecords\(\{[^}]*mcpName: found\.name/.test(arranque), 'el que se encuentra se apunta, con el otro host enlazado')
  assert(/chosenMcpName\(config, saved, state\.site\.host, \{ status: mcp \}\)/.test(arranque), 'y se comprueba con ese nombre')
  assert(arranque.indexOf('const found = mcpForHost') < arranque.indexOf('showSetupScreen()'), 'antes de pedir claves')
  assert(/'MCP reconocido'/.test(arranque) && /'MCP sin conectar'/.test(arranque))
  assert(/«\$\{status\.name\}» está registrado pero en/.test(arranque), 'la pantalla de claves dice QUÉ bloque está caído')
  // SEGURIDAD: la configuración trae las claves en claro. Ni al estado ni al registro.
  assert(!/state\.\w+ = config\b/.test(arranque) && !/log\.\w+\([^)]*\bconfig\b/.test(arranque) && !/environment/.test(arranque), 'la configuración no se guarda ni se registra')
  const estado = JS.slice(JS.indexOf('async function paintState'), JS.indexOf('async function treeDebug'))
  assert(/chosenMcpName\(config, await getSite\(state\.site\.host\), state\.site\.host, \{ status: list \}\)/.test(estado), 'el registro mira el mismo MCP')
  const cliente = readFileSync(join(ROOT, 'src/opencode/client.js'), 'utf8')
  assert(/config\(\) \{\s*return this\.request\('GET', '\/config'\)/.test(cliente), 'el cliente lee /config')
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
  assert(/const \{ index \} = await getIndex\(host\)/.test(enlazado), 'el índice del Confluence enlazado se carga con su contexto')
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
  assert(/offerNavigation\(answer, bubble, skill, turn\.parts\)/.test(envio), 'las partes del turno llegan a la navegación')
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
  assert(/from: enlazado \? 'linked' : 'confluence'/.test(porId))
  const alta = JS.slice(JS.indexOf('async function addSource('), JS.indexOf('async function removeSource'))
  assert(/if \(from === 'confluence'\) await mergePagesIntoIndex/.test(alta), 'y tampoco al elegir una sugerencia suya')
  const enlazado = JS.slice(JS.indexOf('async function loadLinkedContext'), JS.indexOf('async function ensureContentAccess'))
  assert(/await getSite\(host\)/.test(enlazado) && /wikiPrefix/.test(enlazado), 'el prefijo del wiki enlazado, si se observó')
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
  assert(/async function restoreConversation\(testigo = state\.bootToken\)/.test(restaurar))
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
  assert(/site: state\.site/.test(claves), 'el sitio viaja con la configuración pendiente')
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
  assert(/const sesionAlPedir = state\.sessionID/.test(envio) && envio.indexOf('const sesionAlPedir') < envio.indexOf('runTurn('), 'la sesión se captura al mandar')
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
  assert(/#app\s*\{/.test(CSS), '#app tiene su sitio en el CSS (el cuerpo es una columna flex)')

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
  assert(/id="announcer"[^>]*class="sr-only"/.test(HTML) && /\.sr-only\s*\{/.test(CSS), 'sólo para el lector de pantalla')
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
  // El `GET /mcp` tarda entre 2,8 y 13,8 s la PRIMERA vez tras arrancar
  // opencode (auditoría del 2026-09-13 contra un servidor desechable) y
  // `bootForSite` lo espera antes de enseñar el chat. Nadie lo veía: sin el
  // número en el registro, sacarlo del camino (H6) sería a ciegas.
  const arranque = JS.slice(JS.indexOf('async function bootForSite'), JS.indexOf('async function loadLinkedContext'))
  assert(/const cron = startTiming\(\)/.test(arranque), 'el arranque se cronometra desde el principio')
  assert(/'Arranque del panel'/.test(arranque), 'y se registra al acabar')
  assert(/state\.timing\.boot = timingLine\(cron\.done\(\)\)/.test(arranque), 'con la línea que también enseña el Registro')
  for (const fase of ['health', 'modelos', 'MCP', 'almacenamiento', 'restaurar']) {
    assert(arranque.includes(`cron.mark('${fase}')`), `falta la fase ${fase}`)
  }
  // La fase «MCP» son las DOS peticiones y nada más: si se marcara después de
  // adoptar el MCP y guardar los sitios, el número dejaría de ser el del GET.
  const mcp = arranque.indexOf("cron.mark('MCP')")
  assert(arranque.lastIndexOf('client.listMcp()', mcp) > -1, 'la marca va después de pedir /mcp y /config')
  assert(mcp < arranque.indexOf('siteRecords({'), 'y antes de adoptar el MCP y escribir en storage')
  // El arranque tiene cuatro salidas y las cortas son justo las que enseñan lo
  // que cuesta el MCP: la pantalla de claves y la de contexto también miden.
  eq(arranque.split('medir()').length - 1, 4, 'medir() se define y se llama en las tres salidas que llegan a medir algo')
  const claves = arranque.slice(arranque.indexOf('if (!status.connected && !saved?.skippedKeys) {'))
  assert(claves.indexOf('medir()') < claves.indexOf('return'), 'la salida por la pantalla de claves mide antes de volver')
  // SEGURIDAD: de la configuración de opencode no sale nada al registro; una
  // línea de tiempos son etiquetas de Faro y números.
  assert(!/log\.\w+\([^)]*\bconfig\b/.test(arranque), 'la configuración no se registra')
})

test('H3: «Respuesta recibida» dice lo que costó el turno, y el Registro guarda sus tiempos', () => {
  // Qué se decide con esto: si las salidas de herramientas que la sesión
  // arrastra justifican «YA LEÍDAS» (H12) y si el sistema de un Análisis de
  // Jira —23-27 000 caracteres— merece tocarse. Medir, no cambiar nada.
  const envio = JS.slice(JS.indexOf('async function send('), JS.indexOf('function paintTurn('))
  assert(/const cron = startTiming\(\)/.test(envio), 'el turno se cronometra')
  for (const fase of ['página', 'sesión', 'primer texto', 'fin', 'índice', 'marcas']) {
    assert(envio.includes(`cron.mark('${fase}')`), `falta la fase ${fase}`)
  }
  // La primera palabra se marca UNA vez y sin tocar lo que se pinta.
  assert(/if \(!primerTexto && t\.text\) \{/.test(envio), 'la primera palabra del modelo se detecta en el primer onUpdate con texto')
  assert(/paintTurn\(t, toolsBox, body\)/.test(envio), 'y el pintado sigue siendo el de antes')
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
  assert(/timing: \{ boot: '', turn: '' \}/.test(JS), 'los dos tiempos viven en el estado, no en disco')

  // Y el Registro los enseña, con lo que ocupa el almacenamiento: un «va lento»
  // o un «no guarda» deja de ser una impresión.
  const estado = JS.slice(JS.indexOf('async function paintState'), JS.indexOf('async function treeDebug'))
  assert(/add\('tiempos \(arranque\)'/.test(estado) && /add\('tiempos \(último turno\)'/.test(estado), 'las dos filas de tiempos')
  assert(/getBytesInUse/.test(estado), 'y cuánto se lleva gastado de la cuota')
  assert(/bytes > 8 \* 1024 \* 1024 \? 'bad' : ''/.test(estado), 'con aviso antes de que storage.set empiece a fallar')
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
  eq(marcas.split('ms: transcurrido()').length - 1, 3, 'las tres salidas de applyNotes llevan ms')
})
