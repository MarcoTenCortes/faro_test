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

test('la navegación no se cae en silencio cuando falta el índice', () => {
  // Pasó de verdad: el modelo decía «usa la tarjeta de abajo» y no había
  // tarjeta, porque el índice se habia descartado por cambio de versión.
  assert(/sinMapaCard/.test(JS), 'debe existir la tarjeta de «me falta el mapa»')
  assert(/Sin navegación/.test(JS), 'y el motivo debe quedar en el registro')
  assert(!/console\.debug\('\[faro\] sin navegación/.test(JS), 'ya no basta con un console.debug')
})
