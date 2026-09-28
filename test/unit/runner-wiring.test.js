/**
 * Cableado del ejecutor de la página (runner.js), por regex sobre el fuente,
 * como `panel-wiring.test.js` hace con el panel.
 *
 * Lo que se pina viene de la auditoría del 2026-09-13 (docs/PLAN.md §2):
 *  - M2: el manejador de Escape (`overlay.onCancel`) se instala al EMPEZAR un
 *    paso o un anclaje, nunca se vuelve a instalar tras limpiar, y `applyNotes`
 *    no instala ninguno (borraba las marcas sin que el panel se enterase).
 *    Soltarlo es cosa del overlay: `clearAll()` y `clearNotes()` lo ponen a
 *    null (`hideCard()` no: el barrido sigue con el foco puesto y Escape tiene
 *    que poder cancelarlo; lo pina overlay-wiring.test.js). El ejecutor no lo
 *    toca por su cuenta. Y cancelar tiene que CORTAR el paso: la guarda de
 *    `this.cancelled` no estaba ni tras abrir una rama, ni al destellar, ni
 *    dentro de la ronda del barrido, así que el paso volvía EXPANDED y el
 *    service worker lanzaba el siguiente (revisión adversaria de H2,
 *    2026-09-14).
 *  - M8: `applyNotes` y `focusNote` exigen lo mismo para dar una marca por
 *    puesta: `visibleResolution(resolved)`, que pide caja visible.
 *  - P7 (H6, docs/plan/anexo-E-eficiencia.md): el ÁMBITO de lectura (qué es
 *    contenido y qué interfaz) se calcula una vez por pasada y se pasa; antes
 *    lo recalculaban `pageDigest()`, `blockBoundary()` y el peldaño global,
 *    hasta tres veces por observación y doce observaciones por análisis.
 *  - H23 (docs/PLAN2.md §3.6): el color del subrayado llega de `MSG.SETTINGS`
 *    (bootstrap.js) al overlay por `setHighlightColor`, que sólo delega.
 *  - Revisión adversaria de H27 (2026-09-28, reproducido en Chromium): cancelar
 *    mientras el paso buscaba el enlace o se desplazaba no cortaba nada; al
 *    volver de la espera encendía el foco (montando otra vez el overlay que el
 *    huérfano acababa de destruir), sacaba la tarjeta y pulsaba. Lo mismo con
 *    «Parar» del panel. La guarda va detrás de cada espera y antes de pintar.
 * Estas no se pueden ejecutar en Node (necesitan el DOM), así que se comprueba
 * el cableado; `visibleResolution` sí, con Ranges de mentira.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { visibleResolution } from '../../src/content/runner.js'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const JS = sinComentarios(readFileSync(join(ROOT, 'src/content/runner.js'), 'utf8'))

/** El cuerpo de un método de NavRunner: desde su cabecera hasta la siguiente. */
function metodo(nombre) {
  const inicio = JS.indexOf(`  async ${nombre}(`)
  assert(inicio >= 0, `no encuentro el método ${nombre}`)
  const resto = JS.slice(inicio + 2)
  const fin = resto.search(/\n  (?:async )?[A-Za-z_$][\w$]*\(.*\) \{\n|\n  get [A-Za-z_$][\w$]*\(\) \{\n/)
  return fin >= 0 ? resto.slice(0, fin) : resto
}

function cuenta(src, trozo) {
  return src.split(trozo).length - 1
}

test('M2: el manejador de Escape se instala al empezar un paso y un anclaje, y sólo ahí', () => {
  eq(cuenta(JS, 'this.overlay.onCancel ='), 2, 'dos instalaciones en todo el ejecutor')

  const paso = metodo('executeStep')
  eq(cuenta(paso, 'this.overlay.onCancel ='), 1)
  assert(paso.includes("this.overlay.onCancel = () => this.cancel('escape')"), 'Escape cancela el paso')
  assert(paso.indexOf('this.overlay.mount()') < paso.indexOf('this.overlay.onCancel ='), 'tras montar el overlay')
  assert(!/clearAll\(\)[\s\S]*this\.overlay\.onCancel =/.test(paso), 'nunca se reinstala tras un clear')

  const ancla = metodo('applyAnchor')
  eq(cuenta(ancla, 'this.overlay.onCancel ='), 1)
  assert(ancla.includes('this.overlay.onCancel = () => this.overlay.clearAll()'), 'Escape quita el resaltado')
  assert(ancla.indexOf('this.overlay.mount()') < ancla.indexOf('this.overlay.onCancel ='), 'tras montar el overlay')
})

test('M2: applyNotes y focusNote no instalan ningún manejador de Escape', () => {
  // Escape borraba las marcas en silencio: el panel seguía creyendo que
  // estaban (`state.notes`) y `focusNote` contestaba «esa marca ya no está».
  assert(!metodo('applyNotes').includes('onCancel'), 'applyNotes no toca onCancel')
  assert(!metodo('focusNote').includes('onCancel'), 'focusNote no toca onCancel')
})

test('M2: soltar el manejador es cosa del overlay; el ejecutor nunca lo pone a null por su cuenta', () => {
  // Contrato: `clearAll()` y `clearNotes()` del overlay ponen `onCancel = null`
  // (overlay-wiring.test.js). Si el ejecutor lo hiciera además, dos sitios
  // decidirían lo mismo y volverían a desincronizarse.
  assert(!/onCancel\s*=\s*null/.test(JS), 'ningún «onCancel = null» en runner.js')
  const cancelar = JS.slice(JS.indexOf('  cancel(reason'), JS.indexOf('  _settle('))
  assert(cancelar.includes('this.overlay.clearAll()'), 'cancelar limpia el overlay, que es quien suelta el manejador')
})

test('M2: si el usuario cancela durante el barrido del árbol, el paso acaba cancelado y no ofrece el salto', () => {
  const paso = metodo('executeStep')
  const barrido = paso.indexOf('await this._tryExpandTowards(step)')
  assert(barrido >= 0)
  const despues = paso.slice(barrido)
  const guarda = despues.indexOf('if (this.cancelled) return { status: STEP_RESULT.CANCELLED')
  assert(guarda >= 0, 'tras el barrido se mira si se canceló')
  assert(guarda < despues.indexOf('this._offerFallback('), 'y antes de ofrecer «Llévame»')
})

test('M2: Escape a mitad de un paso de desplegar lo cancela: al abrir la rama, al destellar y dentro del barrido', () => {
  // Revisión adversaria de H2 (2026-09-14): la guarda sólo estaba tras el
  // barrido. En `_expandStep` el Escape se tragaba (`stopPropagation`) y no
  // cancelaba nada: el paso volvía EXPANDED y el service worker lanzaba el
  // siguiente. Y dentro de una ronda del barrido —hasta ocho clics— se seguía
  // pulsando y el foco se volvía a encender con `onCancel` ya a null, o sea sin
  // forma de pararlo.
  const CANCELA = "if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }"

  const expandir = metodo('_expandStep')
  const abrir = expandir.indexOf('await this._abrirRama(toggle)')
  assert(abrir >= 0, '_expandStep abre la rama')
  assert(expandir.slice(abrir).includes(CANCELA), 'tras abrir la rama se mira si se canceló')
  eq(cuenta(expandir, 'await this._flash('), 2, 'los dos destellos: sin control de desplegar y rama ya abierta')
  // EL CAMBIO (revisión adversaria de H27): de tres a cuatro, con la de antes
  // del foco (la pina la prueba de H27 de abajo).
  eq(cuenta(expandir, CANCELA), 4, 'una guarda antes del foco, una tras cada destello y otra tras abrir la rama')

  const flash = metodo('_flash')
  const guarda = flash.indexOf('if (this.cancelled) return')
  assert(guarda >= 0, '_flash mira si ya se canceló')
  assert(guarda < flash.indexOf('this.overlay.spotlight('), 'y no pinta el foco después de un Escape')
  assert(guarda < flash.indexOf('this.overlay.showCard('), 'ni el cartel')

  const barrido = metodo('_tryExpandTowards')
  const bucle = barrido.indexOf('for (const btn of candidatos.slice(0, 8)) {')
  assert(bucle >= 0, 'el bucle interior del barrido')
  const ronda = barrido.slice(bucle)
  const corta = ronda.indexOf('if (this.cancelled) return false')
  assert(corta >= 0, 'dentro de la ronda se mira si se canceló')
  assert(corta < ronda.indexOf('btn.click()'), 'antes de pulsar nada')
  assert(corta < ronda.indexOf('this.overlay.spotlight('), 'y antes de volver a encender el foco')
})

test('H27 revisión: un paso cancelado mientras busca o se desplaza no enciende el foco ni pulsa', () => {
  // Visto en Chromium con el ejecutor del banco: `destroy()` del huérfano (o
  // «Parar» del panel, CANCEL_PLAN → MSG.CANCEL) mientras `waitFor` buscaba el
  // enlace; al volver, el paso montaba otra vez el overlay, sacaba la tarjeta y
  // pulsaba (`{status:'clicked'}`). Cancelar sólo resolvía la espera de la
  // tarjeta, y ninguna otra espera miraba `this.cancelled` al volver. Cada
  // guarda va JUSTO detrás de su espera: entre una y otra no hay nada que pinte.
  const CANCELA = "if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }"
  const lineasDe = (nombre) =>
    metodo(nombre)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  /** Dónde va la línea siguiente a la primera que empieza por `empieza`. */
  const tras = (ls, empieza) => {
    const i = ls.findIndex((l) => l.startsWith(empieza))
    assert(i >= 0, `no encuentro «${empieza}»`)
    return i + 1
  }

  const paso = lineasDe('executeStep')
  const encontrado = tras(paso, 'const found = await waitFor(')
  eq(paso[encontrado], CANCELA, 'encontrado el enlace, se mira antes de presentarlo o de desplegarlo')
  assert(encontrado < paso.indexOf('if (desplegando) return this._expandStep(found, { step, index, total, isLast })'), 'antes de desplegar')
  assert(encontrado < paso.indexOf('return this._presentAndClick(found, { step, index, total, isLast })'), 'y antes de presentarlo')
  eq(paso[tras(paso, 'const retry = await waitFor(')], CANCELA, 'y otra vez al volver a buscar tras el barrido')

  for (const [nombre, foco] of [
    ['_presentAndClick', 'this.overlay.spotlight(rect)'],
    ['_expandStep', 'this.overlay.spotlight(rect, { padding: 6 })'],
  ]) {
    const ls = lineasDe(nombre)
    const guarda = tras(ls, 'await sleep(this.timing.scrollSettleMs ?? NAV_TIMING.scrollSettleMs)')
    eq(ls[guarda], CANCELA, `${nombre}: tras desplazarse`)
    assert(guarda < ls.indexOf(foco), `${nombre}: antes de encender el foco`)
  }
  const presentar = lineasDe('_presentAndClick')
  assert(tras(presentar, 'await sleep(') < presentar.indexOf('target.click()'), 'y antes de pulsar')

  // Al abrir la rama: cada tecla y el último recurso, sólo sin cancelar.
  const rama = lineasDe('_abrirRama')
  const teclas = tras(rama, "for (const key of ['ArrowRight', 'Enter']) {")
  eq(rama[teclas], 'if (this.cancelled) return false', 'antes de cada tecla')
  assert(teclas < rama.indexOf("fila.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))"), 'antes de despachar la tecla')
  const ultimo = rama.lastIndexOf('control.click()')
  assert(ultimo > teclas, 'el último recurso va detrás del teclado')
  eq(rama[ultimo - 1], 'if (this.cancelled) return false', 'y antes del último recurso')
})

test('M8: applyNotes y focusNote comparten la guardia de caja visible', () => {
  eq(cuenta(JS, 'export function visibleResolution('), 1)
  const guardia = JS.slice(JS.indexOf('export function visibleResolution('))
  const cuerpo = guardia.slice(0, guardia.indexOf('\n}\n'))
  assert(cuerpo.includes('rangeRect('), 'la guardia mira la caja')
  assert(cuerpo.includes('.ok') && cuerpo.includes('ranges'), 'y que la resolución salió bien con algún Range')

  const marcas = metodo('applyNotes')
  assert(marcas.includes('if (!visibleResolution(resolved))'), 'applyNotes usa la guardia')
  assert(!marcas.includes('rangeRect('), 'y no la repite a mano')

  const foco = metodo('focusNote')
  assert(foco.includes('if (!visibleResolution(resolved))'), 'focusNote usa la MISMA guardia')
  assert(!foco.includes('rangeRect('), 'y no la repite a mano')
  const tras = foco.slice(foco.indexOf('if (!visibleResolution(resolved))'))
  assert(tras.includes("return { ok: false, reason: 'esa marca ya no está en la página' }"), 'sin caja, se dice')
  assert(tras.indexOf("reason: 'esa marca ya no está en la página'") < tras.indexOf('nota.ranges = resolved.ranges'), 'antes de adoptar el Range')
})

// --- P7: el ámbito de lectura, una vez por pasada --------------------------

test('P7: applyNotes calcula el ámbito UNA vez y lo pasa a la lectura y a cada observación', () => {
  const marcas = metodo('applyNotes')
  assert(marcas.includes('const scope = digestScope()'), 'applyNotes calcula el ámbito')
  eq(cuenta(marcas, 'digestScope()'), 1, 'una sola vez para toda la pasada')
  assert(marcas.includes('pageDigest({ scope })'), 'la página se lee con ese ámbito')
  assert(marcas.includes('resolveNote(nota, digest, scope)'), 'y cada observación se resuelve con él')
})

test('P7: el ámbito se calcula DENTRO de lo que mide el reloj de H3', () => {
  // El `ms` que sale detrás de «Análisis marcado» sirve para comparar la misma
  // página antes y después de tocarla: si el trabajo que se ahorra quedara
  // fuera del tramo medido, el número no diría nada. (Dónde empieza y dónde
  // acaba el reloj lo pina panel-wiring.test.js, que es de quien es el número.)
  const marcas = metodo('applyNotes')
  const reloj = marcas.indexOf('const t0 = performance.now()')
  const ambito = marcas.indexOf('const scope = digestScope()')
  const para = marcas.indexOf('const ms = transcurrido()')
  assert(reloj >= 0 && ambito > reloj, 'calcular el ámbito es trabajo de marcar: cuenta')
  assert(para > ambito, 'y sigue dentro del tramo que se mide')
})

test('P7: resolveNote reparte el ámbito que recibe, y focusNote también lo calcula una sola vez', () => {
  const fn = JS.slice(JS.indexOf('function resolveNote('), JS.indexOf('export function visibleResolution('))
  assert(
    fn.includes('function resolveNote(nota, digest, scope = digestScope())'),
    'el ámbito llega por parámetro, con valor por defecto para quien no lo pase'
  )
  assert(fn.includes('resolveBlockQuote(nota.anchor, { digest, scope })'), 'la escalera del bloque lo recibe')
  assert(fn.includes('resolveScopedQuote(nota.anchor, { scope })'), 'y la cita suelta también')
  eq(cuenta(fn, 'digestScope()'), 1, 'sólo el valor por defecto: ya no lo calcula por observación')

  const foco = metodo('focusNote')
  assert(foco.includes('resolveNote(nota, pageDigest({ scope }), scope)'), 'focusNote lee y resuelve con el mismo ámbito')
  eq(cuenta(foco, 'digestScope()'), 1)
})

// --- visibleResolution con Ranges de mentira ------------------------------

const caja = { top: 10, left: 10, right: 60, bottom: 30, width: 50, height: 20 }
const sinCaja = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
const range = (rects) => ({ getClientRects: () => rects })

test('visibleResolution: ok, con algún Range y con caja en el primero', () => {
  eq(visibleResolution({ ok: true, ranges: [range([caja])] }), true)
  eq(visibleResolution({ ok: true, ranges: [range([sinCaja, caja])] }), true, 'basta con una caja con tamaño')
})

test('visibleResolution: un Range sin cajas no se ve, y una resolución fallida tampoco', () => {
  eq(visibleResolution({ ok: true, ranges: [range([sinCaja])] }), false, 'texto oculto: cajas de 0×0')
  eq(visibleResolution({ ok: true, ranges: [range([])] }), false, 'sin cajas')
  eq(visibleResolution({ ok: true, ranges: [] }), false, 'sin Ranges')
  eq(visibleResolution({ ok: true }), false)
  eq(visibleResolution({ ok: false, ranges: [range([caja])] }), false, 'fallida aunque traiga Range')
  eq(visibleResolution(null), false)
  eq(visibleResolution(undefined), false)
})

// --- H23: la tinta del subrayado ----------------------------------------------

test('H23: el color del subrayado llega de MSG.SETTINGS al overlay por el ejecutor, que no lo decide', () => {
  // El panel lo guarda, el service worker lo empuja (service-worker.test.js
  // pina las claves del mensaje) y aquí se pina el último tramo: sin estas dos
  // líneas el ajuste se guardaba y la página seguía en azul.
  const ini = JS.indexOf('  setHighlightColor(color) {')
  assert(ini >= 0, 'el ejecutor tiene setHighlightColor(color)')
  const fin = JS.indexOf('\n  }\n', ini)
  eq(JS.slice(ini, fin).trim(), 'setHighlightColor(color) {\n    this.overlay.setTint(color)', 'delega en el overlay, que normaliza el color')

  const boot = readFileSync(join(ROOT, 'src/content/bootstrap.js'), 'utf8')
  const caso = boot.slice(boot.indexOf('case MSG.SETTINGS:'), boot.indexOf('case MSG.STEP:'))
  assert(caso.length > 0, 'bootstrap.js atiende MSG.SETTINGS')
  const estilo = caso.indexOf('if (msg.highlightStyle) runner.setHighlightStyle(msg.highlightStyle)')
  const color = caso.indexOf('if (msg.highlightColor) runner.setHighlightColor(msg.highlightColor)')
  assert(estilo >= 0 && color > estilo, 'el color, detrás del estilo y sólo si viene')
  // EL CAMBIO (H27): SETTINGS se contesta también sin haber arrancado (se guarda
  // en `pendientes` y se aplica al arrancar, lo pina bootstrap-wiring.test.js),
  // así que la primera respuesta del trozo es la de esa rama; la del ejecutor
  // arrancado es la que va DETRÁS del color.
  assert(color >= 0 && caso.indexOf('sendResponse({ ok: true })', color) > color, 'antes de contestar')
})
