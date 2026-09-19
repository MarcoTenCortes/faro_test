/**
 * El overlay no se queda con los Escape de la página.
 *
 * Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2.3 M2): `_onKey`
 * está registrado en `document` en fase de captura y hacía `stopPropagation()`
 * en cuanto `this.onCancel` era una función; el ejecutor lo pone en cada paso,
 * en cada llegada y en cada análisis, y nadie lo volvía a poner a null
 * (`clearAll()` y `clearNotes()` no lo tocaban). Desde la primera marca, ningún
 * Escape llegaba ya a Jira/Confluence: ni al diálogo de edición, ni a los
 * desplegables de AUI, ni a la edición en línea de un campo. Y con marcas
 * puestas, Escape las borraba a espaldas del panel, que seguía creyendo que
 * estaban.
 *
 * La regla, pinada aquí por regex sobre el fuente (como panel.js en
 * panel-wiring.test.js): Escape es de Faro SÓLO mientras hay algo en marcha
 * —el foco de un recorrido, el cartel, la barra de selección, el seguimiento
 * de un elemento— o mientras el único subrayado en pantalla es el de una
 * llegada por cita, que no es de nadie más; las marcas NUMERADAS de un
 * análisis no cuentan, porque el panel las da por puestas y las quita desde
 * «Quitar las marcas» o con la siguiente orden. Y quien lo borra todo pone
 * `onCancel` a null, para que un overlay huérfano (extensión recargada sin
 * recargar la pestaña) tampoco intercepte nada.
 *
 * Y desde H6 (P1, docs/plan/anexo-E-eficiencia.md), cómo se repinta: un solo
 * frame por ráfaga de scroll, la geometría medida UNA vez por observación para
 * las dos capas, y los nodos reutilizados en vez de recreados. Antes cada
 * evento de scroll vaciaba la capa y volvía a crear cada rectángulo, que nace
 * con `opacity: 0` y una transición de .4 s: eso era el parpadeo que se veía
 * en el Jira del usuario.
 */
import { test, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const overlay = sinComentarios(readFileSync(join(ROOT, 'src/content/overlay/overlay.js'), 'utf8'))

/**
 * El cuerpo de un método de la clase: de su firma (con dos espacios de
 * sangría) hasta la primera línea que sea exactamente «  }». Los bloques de
 * dentro van más sangrados, así que esa línea es la que cierra el método.
 */
function cuerpo(firma) {
  const ini = overlay.indexOf('\n  ' + firma)
  assert(ini >= 0, `overlay.js no tiene el método «${firma}»`)
  const fin = overlay.indexOf('\n  }\n', ini)
  assert(fin > ini, `no se encuentra el cierre de «${firma}»`)
  return overlay.slice(ini, fin)
}

test('overlay: clearAll() y clearNotes() ponen onCancel a null', () => {
  assert(cuerpo('clearAll() {').includes('this.onCancel = null'), 'clearAll() no suelta onCancel')
  assert(cuerpo('clearNotes() {').includes('this.onCancel = null'), 'clearNotes() no suelta onCancel')
})

test('overlay: _onKey sólo intercepta Escape, y sólo si hay algo de Faro en marcha, no por tener onCancel', () => {
  const k = cuerpo('_onKey(ev) {')
  assert(k.includes("ev.key !== 'Escape'") || k.includes("ev.key === 'Escape'"), '_onKey no mira que la tecla sea Escape')
  assert(/typeof this\.onCancel !== 'function'/.test(k), '_onKey comprueba que onCancel es una función')
  assert(k.includes('this.interceptsEscape()'), '_onKey decide con interceptsEscape(), no sólo con onCancel')
  const guarda = k.indexOf('this.interceptsEscape()')
  const para = k.indexOf('ev.stopPropagation()')
  assert(para > guarda, 'stopPropagation() va DESPUÉS de la guarda: sin nada en marcha, el Escape sigue su camino')
  assert(k.indexOf("this.onCancel('escape')") > para, 'onCancel se llama tras parar la propagación')
})

test('overlay: interceptsEscape() mira el foco, el cartel, la barra de selección y el seguimiento; las marcas numeradas no cuentan', () => {
  const g = cuerpo('interceptsEscape() {')
  for (const parte of ['this.el.spot', 'this.el.card', 'this.el.pickBar', 'this.followTarget']) {
    assert(g.includes(parte), `interceptsEscape() no mira ${parte}`)
  }
  assert(/classList\.contains\('on'\)/.test(g), 'lo encendido se reconoce por la clase «on», como lo pinta el propio overlay')
  // La decisión: un análisis con sus marcas NUMERADAS puestas no hace que Faro
  // se quede con el Escape. Esas marcas son del panel; borrarlas a sus
  // espaldas lo dejaba con `state.notes` viejo y «esa marca ya no está» en
  // cada pulsación.
  for (const marca of ['this.outlineTargets']) {
    assert(!g.includes(marca), `interceptsEscape() cuenta ${marca}: los filetes no hacen que Faro se quede con el Escape`)
  }
  // Pero el subrayado de una LLEGADA por cita (applyAnchor, sin números) sí
  // cuenta mientras no haya marcas numeradas: el panel no guarda estado de esa
  // marca —sólo registra «Fragmento resaltado»—, así que quitarla con Escape
  // no lo desincroniza, y sin esto el usuario se quedaba sin ningún control
  // para borrarla, porque en ese camino el foco se apaga antes de subrayar
  // (revisión adversaria de H2, 2026-09-14).
  assert(
    /this\.quoteRanges\.length && !this\.notes\.length/.test(g),
    'el subrayado de una llegada cuenta sólo mientras no haya marcas numeradas'
  )
})

test('overlay: hideCard() no suelta onCancel (el recorrido sigue con el foco puesto) y el listener es de captura y se quita en destroy()', () => {
  // Tras esconder el cartel el ejecutor sigue desplegando la rama con el foco
  // puesto y mira `this.cancelled` en cada vuelta: Escape tiene que poder
  // cancelarlo ahí. La guarda de interceptsEscape() ya deja pasar el Escape
  // cuando el foco se apaga; soltar onCancel aquí sólo quitaría esa vía.
  assert(!cuerpo('hideCard() {').includes('this.onCancel'), 'hideCard() no debe tocar onCancel')
  assert(overlay.includes("document.addEventListener('keydown', this._onKey, true)"), 'el listener va en captura sobre document')
  assert(cuerpo('destroy() {').includes("document.removeEventListener('keydown', this._onKey, true)"), 'destroy() lo quita')
  assert(cuerpo('destroy() {').includes('this.clearAll()'), 'destroy() limpia (y con ello suelta onCancel)')
})

// --- P1 (H6): repintar por frames, medir una vez y reutilizar los nodos -----

const PINTAN = ['_paintQuoteRects(sweep, medidas) {', '_paintNoteBadges(animate, medidas) {', '_paintOutlines(animate) {']

test('P1: una ráfaga de scroll se junta en UN frame, y el repintado a mano cancela el pendiente', () => {
  // `scroll` con captura en window llega por cada contenedor que se desplaza y
  // decenas de veces por gesto; cada uno repintaba a pelo las dos capas.
  const v = cuerpo('_onViewportChange() {')
  assert(v.includes('this._scheduleRefresh()'), 'el scroll pide un frame, no repinta')
  assert(!/this\.refreshMarks\(\)/.test(v), '_onViewportChange no llama a refreshMarks() directamente')

  const s = cuerpo('_scheduleRefresh() {')
  assert(s.includes('if (this._refreshRaf) return'), 'un frame pedido a la vez')
  assert(s.includes('requestAnimationFrame('), 'y es un requestAnimationFrame')
  assert(s.includes('this.refreshMarks()'), 'que acaba repintando')

  const r = cuerpo('refreshMarks() {')
  assert(r.includes('cancelAnimationFrame(this._refreshRaf)'), 'el repintado síncrono cancela el frame pendiente')
  assert(cuerpo('destroy() {').includes('cancelAnimationFrame(this._refreshRaf)'), 'destroy() no deja un frame vivo')
})

test('P1: las capas reutilizan sus nodos en vez de vaciarse y volver a crearlos', () => {
  for (const firma of PINTAN) {
    const c = cuerpo(firma)
    assert(c.includes('this._syncNodes('), `«${firma}» pinta con _syncNodes`)
    assert(!/textContent = ''/.test(c), `«${firma}» ya no vacía su capa en cada repintado`)
  }
  const sync = cuerpo('_syncNodes(layer, items, crear, pintar) {')
  assert(sync.includes('this.stats.created++'), '_syncNodes cuenta los nodos que crea')
  assert(sync.includes('this.stats.reused++'), 'y los que reutiliza (es lo que mide el banco)')
  assert(sync.includes('crear(') && sync.includes('pintar('), 'crea sólo lo que falta y pinta todos')
})

test('P1: la clase «on» se pone al instante salvo en el primer pintado con barrido', () => {
  // El rectángulo nace con `opacity: 0` y una transición de .4 s (styles.js):
  // encenderlo dentro de un requestAnimationFrame en CADA scroll lo hacía
  // aparecer desde cero una y otra vez. Eso era el parpadeo.
  const rects = cuerpo('_paintQuoteRects(sweep, medidas) {')
  assert(/if \(nuevo && sweep\)/.test(rects), 'sólo un nodo nuevo de un pintado con barrido espera a un frame')
  assert(rects.includes("nodo.classList.add('on')"), 'los demás se encienden al instante')
  const badges = cuerpo('_paintNoteBadges(animate, medidas) {')
  assert(/if \(nuevo && animate\)/.test(badges), 'las insignias, igual')
})

test('P1: la geometría de cada observación se mide UNA vez para las dos capas', () => {
  const prep = cuerpo('_prepareGroups() {')
  assert(prep.includes('clipElementFor('), 'la caja de recorte se busca al anotar, no en cada frame')
  assert(prep.includes('inCode('), 'y si la marca va sobre código, también')

  const med = cuerpo('_measureGroups() {')
  assert(med.includes('rectsOf(') && med.includes('clipRects('), 'medir es leer las cajas de los Range y recortarlas')
  assert(med.includes('!g.clipEl.isConnected'), 'un contenedor de recorte que ya no está en la página se vuelve a buscar')

  for (const firma of ['_paintQuoteRects(sweep, medidas) {', '_paintNoteBadges(animate, medidas) {']) {
    const c = cuerpo(firma)
    for (const caro of ['rectsOf(', 'clipRects(', 'clipElementFor(', 'inCode(']) {
      assert(!c.includes(caro), `«${firma}» no vuelve a medir con ${caro}: recibe las medidas`)
    }
  }
  const rep = cuerpo('_repaint(sweep) {')
  assert(rep.includes('const medidas = this._measureGroups()'), '_repaint mide una vez…')
  assert(rep.includes('this._paintQuoteRects(sweep, medidas)') && rep.includes('this._paintNoteBadges(sweep, medidas)'), '…y se la pasa a las dos capas')
})
