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
 *
 * Y desde H23 (forma A, docs/PLAN2.md §3.6), qué se pinta y dónde: el relleno
 * de una marca en dos `::highlight()` del documento, debajo del texto (la
 * activa en el suyo, con prioridad 1 y fuera del de todas: dos rellenos
 * traslúcidos apilados se suman), el trazo en el overlay, las insignias en
 * superíndice, la tinta a elegir, y el cursor subrayador con la selección azul
 * SÓLO mientras se señala. Lo que no necesita un navegador de verdad se
 * EJECUTA aquí, con un `CSS.highlights`, un `Highlight` y un DOM de mentira
 * instalados dentro de cada prueba y retirados al salir.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OVERLAY_CSS, PICK_CSS, highlightCss } from '../../src/content/overlay/styles.js'
import { cursorRule } from '../../src/content/overlay/cursor.js'
import { Overlay } from '../../src/content/overlay/overlay.js'

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

const PINTAN = ['_paintQuoteRects(sweep, medidas) {', '_paintNoteBadges(animate, medidas, ancho) {', '_paintOutlines(animate) {']

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

  // La poda: desde que las capas no se vacían, este bucle es lo ÚNICO que
  // borra una marca de la pantalla. Borrarlo dejaba las 943 pruebas en verde
  // con los rectángulos y las insignias de la pasada anterior encima del texto
  // (revisión adversaria de H6).
  assert(sync.includes('while (hijos.length > items.length)'), 'lo que sobra se quita por el final')
  assert(sync.includes('layer.lastElementChild.remove()'), 'del documento, no sólo de la cuenta')
  assert(sync.includes('this.stats.removed++'), 'y se cuenta, que es como lo mira el banco')
})

test('P1: la clase «on» se pone al instante salvo en el primer pintado con barrido', () => {
  // El rectángulo nace con `opacity: 0` y una transición de .4 s (styles.js):
  // encenderlo dentro de un requestAnimationFrame en CADA scroll lo hacía
  // aparecer desde cero una y otra vez. Eso era el parpadeo.
  const rects = cuerpo('_paintQuoteRects(sweep, medidas) {')
  assert(/if \(nuevo && sweep\)/.test(rects), 'sólo un nodo nuevo de un pintado con barrido espera a un frame')
  assert(rects.includes("nodo.classList.add('on')"), 'los demás se encienden al instante')
  const badges = cuerpo('_paintNoteBadges(animate, medidas, ancho) {')
  assert(/if \(nuevo && animate\)/.test(badges), 'las insignias, igual')
})

test('P1: la geometría de cada observación se mide UNA vez para las dos capas', () => {
  const prep = cuerpo('_prepareGroups() {')
  assert(prep.includes('clipElementFor('), 'la caja de recorte se busca al anotar, no en cada frame')
  assert(prep.includes('inCode('), 'y si la marca va sobre código, también')

  const med = cuerpo('_measureGroups() {')
  assert(med.includes('rectsOf(') && med.includes('clipRects('), 'medir es leer las cajas de los Range y recortarlas')
  assert(med.includes('!g.clipEl.isConnected'), 'un contenedor de recorte que ya no está en la página se vuelve a buscar')

  for (const firma of ['_paintQuoteRects(sweep, medidas) {', '_paintNoteBadges(animate, medidas, ancho) {']) {
    const c = cuerpo(firma)
    for (const caro of ['rectsOf(', 'clipRects(', 'clipElementFor(', 'inCode(']) {
      assert(!c.includes(caro), `«${firma}» no vuelve a medir con ${caro}: recibe las medidas`)
    }
  }
  const rep = cuerpo('_repaint(sweep) {')
  assert(rep.includes('const medidas = this._measureGroups()'), '_repaint mide una vez…')
  assert(rep.includes('this._paintQuoteRects(sweep, medidas)') && rep.includes('this._paintNoteBadges(sweep, medidas, ancho)'), '…y se la pasa a las dos capas')
})

// --- H23: el subrayado (forma A) -------------------------------------------

/** El CSS sin comentarios: los comentarios de styles.js NOMBRAN lo que ya no se hace. */
const OVERLAY_SIN = OVERLAY_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Un bloque con llaves equilibradas, desde su cabecera (incluida) hasta su cierre. */
function bloque(css, cabecera) {
  const ini = css.indexOf(cabecera)
  assert(ini >= 0, `el CSS no tiene «${cabecera}»`)
  let nivel = 0
  for (let i = css.indexOf('{', ini); i < css.length; i++) {
    if (css[i] === '{') nivel++
    else if (css[i] === '}' && --nivel === 0) return css.slice(ini, i + 1)
  }
  assert(false, `«${cabecera}» no se cierra`)
}

/** Una función de módulo de overlay.js, desde su firma hasta la llave de la columna 0. */
function funcion(firma) {
  const ini = overlay.indexOf('\n' + firma)
  assert(ini >= 0, `overlay.js no tiene la función «${firma}»`)
  const fin = overlay.indexOf('\n}\n', ini)
  assert(fin > ini, `no se encuentra el cierre de «${firma}»`)
  return overlay.slice(ini, fin)
}

/**
 * Un nodo del DOM de mentira con lo justo que usa el overlay: clases, estilo,
 * hijos, dataset, y `remove`. `children` es la MISMA lista que se muta, como la
 * HTMLCollection viva que lee `_syncNodes`.
 */
function nodoFalso(tag) {
  const clases = new Set()
  const n = {
    tagName: tag,
    id: '',
    children: [],
    style: {},
    dataset: {},
    textContent: '',
    title: '',
    padre: null,
    classList: {
      add: (...c) => c.forEach((x) => clases.add(x)),
      remove: (...c) => c.forEach((x) => clases.delete(x)),
      toggle(c, on) {
        const v = on === undefined ? !clases.has(c) : !!on
        if (v) clases.add(c)
        else clases.delete(c)
        return v
      },
      contains: (c) => clases.has(c),
    },
    get className() {
      return [...clases].join(' ')
    },
    set className(v) {
      clases.clear()
      for (const x of String(v).split(/\s+/)) if (x) clases.add(x)
    },
    appendChild(h) {
      n.children.push(h)
      h.padre = n
      return h
    },
    get lastElementChild() {
      return n.children[n.children.length - 1] || null
    },
    remove() {
      if (n.padre) n.padre.children.splice(n.padre.children.indexOf(n), 1)
    },
    addEventListener() {},
  }
  return n
}

/**
 * Instala un CSS.highlights, un Highlight, un documento y una ventana de
 * mentira durante `fn`, y lo quita todo al salir (estas pruebas corren en el
 * mismo proceso que las demás).
 */
function conFalsos(fn) {
  const nombres = ['CSS', 'Highlight', 'Range', 'document', 'window', 'requestAnimationFrame']
  const antes = Object.fromEntries(nombres.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const porId = new Map()
  const head = nodoFalso('head')
  const html = nodoFalso('html')
  const registrar = head.appendChild
  head.appendChild = (h) => {
    if (h.id) porId.set(h.id, h)
    return registrar(h)
  }
  const falsos = {
    CSS: { highlights: new Map() },
    Highlight: class {
      constructor(...ranges) {
        this.ranges = ranges
        this.priority = 0
      }
    },
    // Las cuatro constantes con las que `fuera` compara (los valores del DOM):
    // en Node no hay `Range`, y sin ellas la resta lanzaría dentro del `try`.
    Range: { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 },
    document: {
      documentElement: html,
      head,
      getElementById: (id) => porId.get(id) || null,
      createElement: (tag) => nodoFalso(tag),
    },
    window: { innerWidth: 1000 },
    requestAnimationFrame: (cb) => cb(),
  }
  for (const k of nombres) Object.defineProperty(globalThis, k, { value: falsos[k], configurable: true, writable: true })
  try {
    return fn(falsos)
  } finally {
    for (const k of nombres) {
      if (antes[k]) Object.defineProperty(globalThis, k, antes[k])
      else delete globalThis[k]
    }
  }
}

test('H23: la selección azul vive sólo bajo html.faro-picking, y el cursor es el subrayador en los dos temas', () => {
  // Pasó en el anexo 2-F: fuera de «Señalar», la selección de la página no es
  // cosa de Faro; un `::selection` suelto pintaría de azul lo que el usuario
  // seleccione en Jira para copiarlo.
  const reglas = PICK_CSS.split('}').filter((r) => r.includes('::selection'))
  assert(reglas.length >= 1, 'PICK_CSS pinta la selección de «Señalar»')
  for (const r of reglas) {
    for (const sel of r.slice(0, r.indexOf('{')).split(',')) {
      if (sel.includes('::selection')) assert(sel.trim().startsWith('html.faro-picking '), `«${sel.trim()}» no va detrás de html.faro-picking`)
    }
  }
  for (const [nombre, css] of [['OVERLAY_CSS', OVERLAY_CSS], ["highlightCss('azul')", highlightCss('azul')], ["highlightCss('ambar')", highlightCss('ambar')]]) {
    assert(!css.includes('::selection'), `${nombre} no toca la selección`)
  }
  assert(
    PICK_CSS.includes('html.faro-picking ::selection { background-color: rgba(59, 130, 246, .32); color: inherit; text-decoration: underline 2px #2563EB; text-underline-offset: 3px; }'),
    'la selección azul con su subrayado'
  )

  // El subrayador, con su respaldo `text`, y el de cuerpo claro en una página oscura.
  const lineas = PICK_CSS.split('\n')
  assert(lineas.includes(`html.faro-picking, html.faro-picking * { cursor: ${cursorRule('claro')} !important; }`), 'el cursor claro, con !important')
  assert(
    lineas.includes(`html.faro-picking.faro-picking-dark, html.faro-picking.faro-picking-dark * { cursor: ${cursorRule('oscuro')} !important; }`),
    'el oscuro, bajo la clase oscura'
  )
  assert(!/crosshair/.test(PICK_CSS), 'la cruz de precisión se fue: lo que se hace es seleccionar texto')
  // Las imágenes conservan `copy` también en oscuro: la regla del subrayador
  // oscuro tiene dos clases, así que la de las imágenes tiene que repetirlas o
  // le ganaría por especificidad.
  const copia = bloque(PICK_CSS, 'html.faro-picking img')
  assert(/\{ cursor: copy !important; \}$/.test(copia), 'las imágenes, con el cursor de copiar')
  for (const sel of ['html.faro-picking figure *', 'html.faro-picking.faro-picking-dark img', 'html.faro-picking.faro-picking-dark figure *']) {
    assert(copia.includes(sel), `«${sel}» en la regla de copiar`)
  }
  assert(PICK_CSS.includes('html.faro-picking #faro-overlay-host, html.faro-picking #faro-overlay-host * { cursor: default !important; }'), 'y dentro del overlay, el de siempre')
})

test('H23: el trazo de la marca se dibuja, se anula en los DOS apagados sin desaparecer, y no hay mix-blend-mode', () => {
  assert(!/mix-blend-mode/.test(OVERLAY_CSS), 'la mezcla es la forma B (H25): en el host aislado es inerte')

  // El rectángulo ya no lleva relleno: el relleno es el ::highlight de debajo.
  const caja = bloque(OVERLAY_SIN, '.quote-rect {')
  for (const d of ['background: transparent;', 'overflow: hidden;', 'opacity: 0;']) assert(caja.includes(d), `.quote-rect lleva ${d}`)
  assert(!/gradient|box-shadow/.test(caja), 'sin degradado ni trazo inset: el trazo es el ::after')
  // Y ninguna regla del rectángulo (salvo su trazo) vuelve a darle fondo: un
  // `background-color` detrás del `transparent` ponía el relleno otra vez
  // ENCIMA de la letra y todo seguía en verde (revisión adversaria de H23, A5).
  let fondos = 0
  for (const [, sel, c] of OVERLAY_SIN.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sel.includes('.quote-rect') || sel.includes('::after')) continue
    for (const d of c.match(/(?<![-\w])background(-[\w-]+)?\s*:[^;]*;/g) || []) {
      eq(d, 'background: transparent;', sel.trim())
      fondos++
    }
  }
  assert(fondos >= 2, `el rectángulo y el de código declaran su fondo transparente (${fondos})`)
  const trazo = bloque(OVERLAY_SIN, '.quote-rect::after {')
  // EL CAMBIO (revisión adversaria de H23, A3): 2 px y 3 la activa, pegados al
  // fondo de la caja. Con 3 y 4 el trazo tapaba medio descendente, o entero.
  for (const d of ['content: "";', 'bottom: 0;', 'height: 2px;', 'border-radius: 2px;', 'background: var(--faro-tinta);', 'transform-origin: left center;']) {
    assert(trazo.includes(d), `el trazo lleva ${d}`)
  }
  assert(OVERLAY_SIN.includes('.quote-rect.active::after { height: 3px; background: var(--faro-tinta-fuerte); }'), 'la activa, 3 px y la tinta fuerte')
  assert(OVERLAY_SIN.includes('.quote-rect.on-code { background: transparent; }'), 'en código, sólo el trazo')

  // El «se dibuja» sustituye al barrido blanco.
  // EL CAMBIO: con el retardo escalonado DENTRO de la animación (animation-delay),
  // no con un setTimeout delante: durante el retardo rige el `from` (both).
  assert(OVERLAY_SIN.includes('.quote-rect.sweep::after { animation: faro-tinta .45s var(--faro-ease) both; animation-delay: var(--faro-retardo, 0ms); }'), 'el trazo se dibuja en .45 s, tras su retardo')
  assert(OVERLAY_SIN.includes('@keyframes faro-tinta { from { transform: scaleX(0); } to { transform: scaleX(1); } }'), 'de izquierda a derecha')
  assert(!/faro-sweep|rgba\(255, ?255, ?255, ?\.55\)/.test(OVERLAY_SIN), 'el barrido blanco se fue entero')
  assert(!/::after\s*\{\s*content:\s*none/.test(OVERLAY_SIN), 'y ya nadie quita el pseudo: es el trazo')

  // Anulado en los DOS apagados, con `animation: none` y NO con `content: none`,
  // que haría desaparecer el trazo.
  const sistema = bloque(OVERLAY_SIN, '@media (prefers-reduced-motion: reduce) {')
  assert(sistema.includes('.quote-rect.sweep::after { animation: none; }'), 'prefers-reduced-motion lo anula')
  assert(OVERLAY_SIN.includes(':host(.faro-still) .quote-rect.sweep::after { animation: none; }'), '«Reducir animaciones» lo anula')
  assert(!/quote-rect\.sweep::after\s*\{\s*content:\s*none/.test(OVERLAY_SIN), 'ninguno de los dos se lleva el trazo')

  // Alto contraste de Windows.
  const forzado = bloque(OVERLAY_SIN, '@media (forced-colors: active) {')
  for (const d of ['.quote-rect { outline: 2px solid Highlight; outline-offset: 1px; }', '.quote-rect::after { background: Highlight; }', '.note-badge { forced-color-adjust: none; }']) {
    assert(forzado.includes(d), `forced-colors: ${d}`)
  }

  // El respaldo de barrer(), a la medida del «se dibuja» y no del barrido de 1,1 s.
  assert(/\nconst SWEEP_MS = 600\n/.test(overlay), 'SWEEP_MS es 600')
})

test('H23: el relleno va en dos highlights, la activa con prioridad 1 y FUERA del de todas', () => {
  assert(overlay.includes("const HIGHLIGHT_NAME = 'faro-quote'"), 'el de todas')
  assert(overlay.includes("const HIGHLIGHT_ACTIVE_NAME = 'faro-quote-activa'"), 'y el de la activa')
  const pone = cuerpo('_setHighlight(ranges, activos = []) {')
  for (const t of [
    'const resto = activos.length ? ranges.flatMap((r) => (activos.includes(r) ? [] : fuera(r, activos))) : ranges',
    'CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...resto))',
    'activa.priority = 1',
    'CSS.highlights.set(HIGHLIGHT_ACTIVE_NAME, activa)',
    'CSS.highlights.delete(HIGHLIGHT_ACTIVE_NAME)',
  ]) {
    assert(pone.includes(t), `_setHighlight: ${t}`)
  }
  const quita = cuerpo('clearHighlight() {')
  assert(quita.includes('CSS.highlights?.delete(HIGHLIGHT_NAME)') && quita.includes('CSS.highlights?.delete(HIGHLIGHT_ACTIVE_NAME)'), 'clearHighlight borra los dos')
  assert(cuerpo('annotate(items) {').includes('this._setHighlight(todos, this._activeRanges())'), 'annotate con la activa (ninguna al empezar)')
  const foco = cuerpo('focusNote(n) {')
  assert(foco.indexOf('this._setHighlight(this.quoteRanges, this._activeRanges())') > foco.indexOf('this.activeNote = n'), 'focusNote mueve el relleno tras fijar la activa')
  assert(foco.indexOf('this._repaint(false)') > foco.indexOf('this._setHighlight('), 'y repinta el trazo después')
  assert(cuerpo('highlightRanges(ranges, { sweep = true } = {}) {').includes('this._setHighlight(this.quoteRanges)\n'), 'una cita no tiene activa')
  assert(cuerpo('_activeRanges() {').includes('this.notes.find((x) => x.n === this.activeNote)'), 'la activa es la nota con ese número')
  // El relleno se pone al anotar, al destacar y al subrayar una cita, y NADA del
  // camino del scroll lo vuelve a poner: rehacerlo en `_repaint` crearía dos
  // Highlight por frame (revisión adversaria de H23, A5).
  eq((overlay.match(/this\._setHighlight\(/g) || []).length, 3, 'sólo annotate, focusNote y highlightRanges ponen el relleno: nada del camino del scroll')

  // Cada regla del relleno deja la letra de la página como está: un `color`
  // propio dentro de un ::highlight repintaría el texto de Atlassian.
  for (const tinta of ['azul', 'ambar']) {
    const reglas = [...highlightCss(tinta).matchAll(/::highlight\(([\w-]+)\)\s*\{([^}]*)\}/g)]
    eq(reglas.map((r) => r[1]), ['faro-quote', 'faro-quote-activa'], `${tinta}: los dos highlights`)
    for (const [, nombre, c] of reglas) eq(c.match(/(?<![-\w])color\s*:[^;]*;/g), ['color: inherit;'], `${tinta} · ${nombre}: el color, heredado`)
  }

  // Y ejecutado, con un CSS.highlights de mentira.
  conFalsos(({ CSS }) => {
    const [a, b, c] = [{ r: 'a' }, { r: 'b' }, { r: 'c' }]
    const o = new Overlay()
    o.notes = [{ n: 1, ranges: [a] }, { n: 2, ranges: [b, c] }]
    o.quoteRanges = [a, b, c]
    // Los Range de la activa: ninguno sin activa ni con una que no existe (con
    // `this.quoteRanges` de respaldo, la activa se llevaría TODO el relleno).
    eq(o._activeRanges(), [], 'sin activa, ninguno')
    o.activeNote = 9
    eq(o._activeRanges(), [], 'una activa que no existe, ninguno')
    o.activeNote = 2
    eq(o._activeRanges(), [b, c], 'la 2, los suyos')
    o.activeNote = 0
    assert(o.focusNote(2), 'la 2 existe')
    eq(CSS.highlights.get('faro-quote-activa').ranges, [b, c], 'la activa tiene los Range de la 2')
    eq(CSS.highlights.get('faro-quote-activa').priority, 1, 'con prioridad 1')
    eq(CSS.highlights.get('faro-quote').ranges, [a], 'y el de todas, los demás: ningún Range pinta dos rellenos')
    o.focusNote(1)
    eq(CSS.highlights.get('faro-quote').ranges, [b, c], 'cambiar de activa devuelve la 2 al de todas')
    eq(CSS.highlights.get('faro-quote-activa').ranges, [a])
    eq(o.focusNote(9), false, 'una que no existe no cambia nada')
    eq(CSS.highlights.get('faro-quote-activa').ranges, [a])
    o._setHighlight([a, b, c])
    eq(CSS.highlights.get('faro-quote').ranges, [a, b, c], 'sin activa, todas en el de todas')
    assert(!CSS.highlights.has('faro-quote-activa'), 'y el de la activa se va')
    o._setHighlight([a, b], [b])
    o.clearHighlight()
    eq([...CSS.highlights.keys()], [], 'clearHighlight no deja ninguno de los dos')
  })
})

test('H23 revisión: ninguna letra lleva los dos rellenos, aunque dos observaciones la cubran con Range distintos', () => {
  const resta = funcion('function fuera(r, activos) {')
  for (const t of ['Range.START_TO_END, a) <= 0', 'Range.END_TO_START, a) >= 0', 'const antes = t.cloneRange()', 'const despues = t.cloneRange()', 'siguen.push(t)']) {
    assert(resta.includes(t), `fuera: ${t}`)
  }
  assert(cuerpo('_setHighlight(ranges, activos = []) {').includes('ranges.flatMap((r) => (activos.includes(r) ? [] : fuera(r, activos)))'), '_setHighlight resta la activa del resto')

  conFalsos(({ CSS }) => {
    // Un nodo de texto de mentira y Range sobre él con lo que usa `fuera`: los
    // puntos se comparan como en el DOM (START_TO_END = fin de éste contra el
    // principio del otro; END_TO_START = principio de éste contra el fin del otro).
    const TEXTO = 'Alfa beta gamma delta'
    const nodo = {}
    const rango = (ini, fin) => ({
      startContainer: nodo,
      startOffset: ini,
      endContainer: nodo,
      endOffset: fin,
      compareBoundaryPoints(how, s) {
        const [mio, suyo] = [[this.startOffset, s.startOffset], [this.endOffset, s.startOffset], [this.endOffset, s.endOffset], [this.startOffset, s.endOffset]][how]
        return Math.sign(mio - suyo)
      },
      cloneRange() {
        return rango(this.startOffset, this.endOffset)
      },
      setStart(_n, o) {
        this.startOffset = o
      },
      setEnd(_n, o) {
        this.endOffset = o
      },
    })
    const textos = (nombre) => (CSS.highlights.get(nombre)?.ranges || []).map((r) => TEXTO.slice(r.startOffset, r.endOffset))
    const con = (notas, n) => {
      const o = new Overlay()
      o.notes = notas
      o.quoteRanges = notas.flatMap((x) => x.ranges)
      o.activeNote = n
      o._setHighlight(o.quoteRanges, o._activeRanges())
      return o
    }

    // Dos observaciones del mismo bloque con la cita vacía: el bloque entero, dos veces.
    con([{ n: 1, ranges: [rango(0, 21)] }, { n: 2, ranges: [rango(0, 21)] }], 2)
    eq(textos('faro-quote-activa'), ['Alfa beta gamma delta'], 'la activa, entera')
    eq(textos('faro-quote'), [], 'y la otra, con los mismos extremos, no pinta debajo')

    // Una cita dentro del bloque entero de otra, en los dos sentidos.
    const bloque = rango(0, 21)
    const cita = rango(5, 15)
    const o = con([{ n: 1, ranges: [bloque] }, { n: 2, ranges: [cita] }], 2)
    eq(textos('faro-quote-activa'), ['beta gamma'])
    eq(textos('faro-quote'), ['Alfa ', ' delta'], 'el bloque, sin el trozo de la activa')
    eq([bloque.startOffset, bloque.endOffset], [0, 21], 'el Range de la nota no se toca: los trozos son copias')
    o.activeNote = 1
    o._setHighlight(o.quoteRanges, o._activeRanges())
    eq(textos('faro-quote'), [], 'la cita cae dentro del bloque activo')

    // Solapadas de lado, y sin tocarse (el mismo Range, no una copia).
    con([{ n: 1, ranges: [rango(0, 15)] }, { n: 2, ranges: [rango(10, 21)] }], 2)
    eq(textos('faro-quote'), ['Alfa beta '])
    const suelto = rango(0, 4)
    con([{ n: 1, ranges: [suelto] }, { n: 2, ranges: [rango(10, 15)] }], 2)
    assert(CSS.highlights.get('faro-quote').ranges[0] === suelto, 'sin solape, el Range de siempre')

    // Un Range de otro documento lanza WrongDocumentError: se queda entero y la activa cambia igual.
    const ajeno = { compareBoundaryPoints() { throw new Error('WrongDocumentError') } }
    con([{ n: 1, ranges: [ajeno] }, { n: 2, ranges: [rango(10, 15)] }], 2)
    const todas = CSS.highlights.get('faro-quote').ranges
    assert(todas.length === 1 && todas[0] === ajeno, 'el que lanza se queda como estaba')
    eq(textos('faro-quote-activa'), ['gamma'], 'y la activa no se queda en la de antes')
  })
})

test('H23: la tinta se pone en el host y en la hoja del documento, y lo que no es ámbar es azul', () => {
  assert(overlay.includes("this.tint = 'azul'"), 'la tinta nace azul')
  const pone = cuerpo('setTint(color) {')
  assert(pone.includes("this.tint = color === 'ambar' ? 'ambar' : 'azul'") && pone.includes('this._applyTint()'), 'setTint normaliza y aplica')
  const aplica = cuerpo('_applyTint() {')
  assert(aplica.includes("this.host?.classList.toggle('faro-tinta-ambar', this.tint === 'ambar')"), 'la clase del host')
  assert(aplica.includes('highlightCss(this.tint)'), 'y la hoja del relleno')
  const monta = cuerpo('mount() {')
  const [estilo, tinta, hoja] = ['this._applyStyle()', 'this._applyTint()', 'this._injectHighlightStyle()'].map((t) => monta.indexOf(t))
  assert(estilo >= 0 && tinta > estilo && hoja > tinta, 'mount aplica la tinta tras el estilo y antes de crear la hoja')
  assert(cuerpo('_injectHighlightStyle() {').includes('s.textContent = highlightCss(this.tint)'), 'la hoja nace con la tinta de ahora')
  assert(!/\bHIGHLIGHT_CSS\b/.test(overlay), 'overlay.js ya no escribe la hoja fija')

  conFalsos(({ document }) => {
    const o = new Overlay()
    o.setTint('ambar')
    eq(o.tint, 'ambar', 'sin host ni hoja, se guarda y no lanza')
    const hoja = nodoFalso('style')
    hoja.id = 'faro-highlight-style'
    hoja.textContent = highlightCss('azul')
    document.head.appendChild(hoja)
    o.host = nodoFalso('div')
    o.setTint('ambar')
    assert(o.host.classList.contains('faro-tinta-ambar'), 'el host lleva la clase del ámbar')
    eq(hoja.textContent, highlightCss('ambar'), 'y la hoja, el relleno ámbar (aunque la dejara otro overlay)')
    for (const raro of ['azul', 'rojo', '', null, undefined, 'AMBAR', {}]) {
      o.setTint(raro)
      eq(o.tint, 'azul', 'cuenta como azul: ' + JSON.stringify(raro))
      assert(!o.host.classList.contains('faro-tinta-ambar'), 'y la clase se va')
      eq(hoja.textContent, highlightCss('azul'))
    }
  })
})

test('H23: «Señalar» con la página en oscuro pone faro-picking-dark, y apagarlo quita las dos clases', () => {
  const s = cuerpo('setPicking(on) {')
  assert(s.includes("html.classList.toggle('faro-picking-dark', !!this.host?.classList.contains('faro-dark'))"), 'la clase oscura sigue al host')
  assert(s.includes("html.classList.remove('faro-picking', 'faro-picking-dark')"), 'al apagar se van las dos')
  assert(cuerpo('destroy() {').includes('this.setPicking(false)'), 'destroy() no deja ninguna')

  conFalsos(({ document }) => {
    const html = document.documentElement
    // La hoja que dejó una versión de antes de H23 con el mismo id (la cruz):
    // un content script nuevo inyectado sin recargar la pestaña («Dar
    // permiso») se la encuentra puesta (revisión adversaria de H23, A14).
    const vieja = nodoFalso('style')
    vieja.id = 'faro-pick-style'
    vieja.textContent = 'html.faro-picking, html.faro-picking * { cursor: crosshair !important; }'
    document.head.appendChild(vieja)
    const o = new Overlay()
    o.host = nodoFalso('div')
    o.host.classList.add('faro-dark')
    o.setPicking(true)
    assert(html.classList.contains('faro-picking') && html.classList.contains('faro-picking-dark'), 'oscuro: las dos')
    eq(document.head.children.length, 1, 'una vez, y reescrita si es de otra versión')
    eq(document.getElementById('faro-pick-style').textContent, PICK_CSS, 'con la hoja del cursor')
    o.setPicking(false)
    assert(!html.classList.contains('faro-picking') && !html.classList.contains('faro-picking-dark'), 'apagado: ninguna')
    o.host.classList.remove('faro-dark')
    o.setPicking(true)
    assert(html.classList.contains('faro-picking') && !html.classList.contains('faro-picking-dark'), 'claro: sólo la de «Señalar»')
    eq(document.head.children.length, 1, 'la hoja se cuelga una sola vez')
  })
})

test('H23: las insignias van en superíndice detrás de la cita, sin salirse de la ventana ni pisarse', () => {
  const b = cuerpo('_paintNoteBadges(animate, medidas, ancho) {')
  assert(b.includes('Math.min(m.ultimo.left + m.ultimo.width + 1, ancho - 24)'), 'a 1 px del final de la cita')
  // EL CAMBIO (revisión adversaria de H23, A2): 5 px y no 8, con la insignia de
  // 13 px: medido en el banco con Segoe UI 14 px, la de 16 subida 8 tapaba 6-10
  // px de la caja del carácter de la línea de ARRIBA; así su anillo se queda
  // entre 0,88 px por debajo y 0,08 por encima de la línea base de arriba, y su
  // borde de abajo sigue en `top + 8`.
  assert(b.includes('Math.max(0, m.ultimo.top - 5)'), '5 px por encima de la línea, sin salirse por arriba')
  const pastilla = bloque(OVERLAY_SIN, '.note-badge {')
  for (const d of ['min-width: 13px;', 'height: 13px;', 'padding: 0 3px;', 'border-radius: 7px;', 'font-size: 9.5px;', 'line-height: 11px;']) {
    assert(pastilla.includes(d), `la insignia de 13 px lleva ${d}`)
  }
  const l = funcion('function libre(left, top, ocupados, ancho) {')
  assert(l.includes('const CHOCA = 19') && l.includes('Math.min(x, ancho - 24)'), 'libre() sigue apartándolas y las deja dentro')
  // EL CAMBIO (revisión adversaria de H23, A12): el ancho es el de la página SIN
  // la barra de desplazamiento —`window.innerWidth` la incluye (1258 frente a
  // 1243 en el pane) y una cita que acababa en el borde dejaba la insignia
  // debajo de la barra—, y se lee UNA vez por repintado, después de medir y
  // antes de escribir: leído después de pintar, obliga a maquetar cada vez.
  for (const [nombre, c] of [['_paintNoteBadges', b], ['libre', l]]) assert(!/innerWidth/.test(c), `${nombre} no lee window.innerWidth`)
  const rep = cuerpo('_repaint(sweep) {')
  const [mide, lee, escribe] = ['this._measureGroups()', 'document.documentElement.clientWidth', 'this._paintQuoteRects('].map((t) => rep.indexOf(t))
  assert(mide >= 0 && lee > mide && escribe > lee, '_repaint lee el ancho entre medir y escribir')
  eq(rep.split('clientWidth').length - 1, 1, 'una sola vez por repintado')
  const carta = cuerpo('_placeCard(near) {')
  assert(carta.includes('const vw = document.documentElement.clientWidth') && carta.includes('const vh = document.documentElement.clientHeight'), 'el cartel, igual: sin las barras')
  assert(!/inner(Width|Height)/.test(carta), 'y sin window.innerWidth ni innerHeight')

  conFalsos(({ document, window }) => {
    // 1015 con la barra y 1000 sin ella: si alguien vuelve a `innerWidth`, la
    // del borde sale en 991 (bajo la barra) y no en 976.
    document.documentElement.clientWidth = 1000
    window.innerWidth = 1015
    const o = new Overlay()
    o.el = { noteLayer: nodoFalso('div') }
    const linea = (left, top, width = 50) => ({ left, top, width, height: 17 })
    const medidas = [
      { n: 1, title: 'uno', rects: [], ultimo: linea(100, 200) },
      { n: 2, title: '', rects: [], ultimo: linea(100, 200) },
      { n: 3, rects: [], ultimo: linea(990, 3) },
      { n: 4, rects: [], ultimo: null },
    ]
    const esperado = [
      ['1', '151px', '195px'],
      ['2', '170px', '195px'],
      ['3', '976px', '0px'],
    ]
    o._paintNoteBadges(false, medidas, 1000)
    const sitios = () => o.el.noteLayer.children.map((x) => [x.dataset.n, x.style.left, x.style.top])
    eq(sitios(), esperado, 'superíndice; la segunda, apartada; la del borde, dentro; sin cita, sin insignia')
    eq(o.el.noteLayer.children[0].title, '1 · uno')
    eq(o.el.noteLayer.children[1].title, 'Observación 2')

    // Y por el camino de verdad: `_repaint` lee el ancho del <html>.
    o.el = { noteLayer: nodoFalso('div'), quoteLayer: nodoFalso('div') }
    o._measureGroups = () => medidas
    o._repaint(false)
    eq(sitios(), esperado, '_repaint pasa el ancho sin la barra')
  })
})

test('H23: el trazo no se ve entero antes de dibujarse: el retardo va en --faro-retardo y «sweep» se pone en el acto', () => {
  // Pasó al revisar el contrato: con la clase puesta a los 60 + i·40 ms por un
  // setTimeout, el trazo (que desde H23 existe siempre) se veía ENTERO durante
  // ese rato y luego se redibujaba desde scaleX(0). Con el retardo dentro de la
  // animación y `both`, durante el retardo rige el `from` y no se ve.
  const b = funcion('function barrer(nodo, retardo = 0) {')
  for (const t of [
    "nodo.style.setProperty('--faro-retardo', retardo + 'ms')",
    'nodo._faroSweep = setTimeout(() => nodo.classList.remove(\'sweep\'), SWEEP_MS + retardo)',
    "nodo.classList.add('sweep')",
  ]) {
    assert(b.includes(t), `barrer() lleva ${t}`)
  }
  const pinta = cuerpo('_paintQuoteRects(sweep, medidas) {')
  assert(pinta.includes('if (sweep && !this.stillMotion) barrer(nodo, 60 + i * 40)'), 'el escalonado va a barrer(), no a un setTimeout')
  assert(!/setTimeout\(/.test(pinta), 'y en _paintQuoteRects no queda ningún setTimeout delante')

  // Ejecutado: con un setTimeout que sólo apunta, la clase está puesta al
  // volver de pintar, cada caja con SU retardo, y el respaldo a su medida.
  const antes = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')
  const temporizadores = []
  Object.defineProperty(globalThis, 'setTimeout', {
    value: (fn, ms) => temporizadores.push(ms),
    configurable: true,
    writable: true,
  })
  try {
    conFalsos((f) => {
      f.document.createElement = (tag) => {
        const n = nodoFalso(tag)
        n.isConnected = true
        n.style.setProperty = (k, v) => {
          n.style[k] = v
        }
        return n
      }
      const o = new Overlay()
      o.el = { quoteLayer: f.document.createElement('div') }
      const linea = (top) => ({ left: 10, top, width: 80, height: 17 })
      const medidas = [
        { n: 1, rects: [linea(100), linea(120)], enCodigo: false },
        { n: 2, rects: [linea(160)], enCodigo: false },
      ]
      o._paintQuoteRects(true, medidas)
      const cajas = o.el.quoteLayer.children
      eq(cajas.map((c) => [c.classList.contains('sweep'), c.style['--faro-retardo']]), [
        [true, '60ms'],
        [true, '100ms'],
        [true, '140ms'],
      ], 'la clase en el acto, con el retardo escalonado en cada caja')
      eq(temporizadores, [660, 700, 740], 'sólo el respaldo de cada caja: SWEEP_MS + su retardo')

      // Un repintado sin barrido (el scroll) no lo relanza, y con «Reducir
      // animaciones» tampoco se barre.
      for (const c of cajas) c.classList.remove('sweep')
      temporizadores.length = 0
      o._paintQuoteRects(false, medidas)
      o.stillMotion = true
      o._paintQuoteRects(true, medidas)
      assert(cajas.every((c) => !c.classList.contains('sweep')), 'sin barrido pedido, o con las animaciones apagadas, no se barre')
      eq(temporizadores, [], 'y no se arma ningún respaldo')
    })
  } finally {
    Object.defineProperty(globalThis, 'setTimeout', antes)
  }
})

test('H23 revisión: la herramienta de «Señalar» es azul, lo que sigue la tinta la sigue, y la barra cede', () => {
  // Nueve cambios del CSS de H23 que ningún pin vigilaba (revisión adversaria de
  // H23, A5-A11): la barra que no cedía a 364 px, lo que tiene que seguir siendo
  // azul elija el usuario la tinta que elija, y lo que tiene que seguirla.
  const pista = bloque(OVERLAY_SIN, '.pick-hint {')
  assert(pista.includes('flex: 0 1 auto;') && pista.includes('min-width: 0;'), 'la pista cede antes que el texto elegido')
  eq(bloque(OVERLAY_SIN, '@media (max-width: 480px) {'), '@media (max-width: 480px) {\n  .pick-hint { display: none; }\n  .pick-bar { max-width: 96vw; }\n}', 'por debajo de 480 px la pista se va y la barra se ensancha')
  assert(bloque(OVERLAY_SIN, '.pick-bar {').includes('flex-wrap: wrap;'), 'la barra envuelve en vez de salirse')

  // La herramienta, siempre azul: el faro de la barra y el recuadro de una imagen.
  eq(bloque(OVERLAY_SIN, '.pick-bar .beacon {'), '.pick-bar .beacon { border-color: #3B82F6; }')
  eq(bloque(OVERLAY_SIN, '.pick-bar .beacon::after {'), '.pick-bar .beacon::after { background: #3B82F6; }')
  eq(bloque(OVERLAY_SIN, ':host(.faro-dark) .pick-bar .beacon {'), ':host(.faro-dark) .pick-bar .beacon { border-color: #60A5FA; }')
  eq(bloque(OVERLAY_SIN, ':host(.faro-dark) .pick-bar .beacon::after {'), ':host(.faro-dark) .pick-bar .beacon::after { background: #60A5FA; }')
  const encima = bloque(OVERLAY_SIN, '.pick-hover {')
  assert(encima.includes('border: 1px solid #3B82F6;') && encima.includes('background: rgba(59, 130, 246, .10);'), 'el recuadro al pasar por una imagen, azul')

  // Lo que es resultado sigue la tinta, y en esos tres bloques no queda ámbar a
  // mano (la insignia activa y los :host del ámbar sí lo llevan, y son suyos).
  for (const cabecera of ['.img-outline {', '.spot.flat,', '@keyframes faro-marker-breathe {']) {
    const b = bloque(OVERLAY_SIN, cabecera)
    assert(b.includes('var(--faro-tinta'), `${cabecera} sigue la tinta`)
    assert(!b.includes('rgba(233, 172, 74') && !b.includes('--faro-gold'), `${cabecera} sin el ámbar escrito a mano`)
  }

  // La insignia: el anillo del color del papel, y entra creciendo desde .6.
  const insignia = bloque(OVERLAY_SIN, '.note-badge {')
  assert(insignia.includes('box-shadow: 0 0 0 2px var(--faro-paper),') && insignia.includes('transform: scale(.6);'), 'la insignia, con su anillo y pequeña')
  assert(OVERLAY_SIN.includes('.note-badge.on { opacity: 1; transform: scale(1); }'), 'y encendida, a su tamaño')
})
