/**
 * La capa visible de Faro sobre la página.
 *
 * Vive entera en un Shadow DOM cerrado colgado de <html>, así que no puede
 * romper el maquetado de Atlassian ni ser rota por él. La única excepción es
 * la hoja de `::highlight()`, que por especificación tiene que ir en el
 * documento; se inyecta en <head> y nunca dentro del contenido.
 *
 * Escape es de Faro SÓLO mientras hay algo en marcha (el foco de un
 * recorrido, el cartel, la barra de selección, el seguimiento de un elemento)
 * o mientras el único subrayado en pantalla es el de una llegada por cita: lo
 * decide `interceptsEscape()`. Las marcas numeradas de un análisis y los
 * filetes de las imágenes no cuentan, y quien lo borra todo (`clearAll`,
 * `clearNotes`) suelta el cancelador. Reproducido en la auditoría del
 * 2026-09-13 (docs/PLAN.md §2.3 M2): desde la primera marca, ningún Escape
 * llegaba ya a Jira/Confluence.
 *
 * Cómo se repinta, desde H6 (P1, docs/plan/anexo-E-eficiencia.md): una ráfaga
 * de scroll se junta en UN frame (`_scheduleRefresh`), la geometría de cada
 * observación se mide una sola vez para las dos capas (`_measureGroups`) y los
 * nodos se reutilizan (`_syncNodes`) en vez de recrearse. Antes cada evento de
 * scroll —y llegan decenas por gesto, uno por cada contenedor que se
 * desplaza— vaciaba la capa y volvía a crear cada rectángulo, que nace con
 * `opacity: 0` y una transición de .4 s (styles.js): las marcas PARPADEABAN al
 * desplazarse, que es lo que se veía en el Jira del usuario. Y la caja de
 * recorte, que cuesta un `getComputedStyle` por cada antepasado, se buscaba
 * dos veces por observación y por frame.
 *
 * Qué pinta cada capa, desde H23 (forma A, docs/PLAN2.md §3.6): el RELLENO de
 * una marca es un `::highlight()` del documento, debajo del texto, con dos
 * nombres —`faro-quote` para todas y `faro-quote-activa` para la que estás
 * mirando—; el overlay dibuja encima sólo el TRAZO de cada línea (un
 * `.quote-rect` transparente con su `::after`) y las insignias, que suben a
 * superíndice para no tapar la palabra siguiente. El color es la tinta que
 * elige el usuario (`setTint`), azul o ámbar.
 */

import { OVERLAY_CSS, highlightCss, PICK_CSS } from './styles.js'
import { rectsOf, clipRects } from './rects.js'

const HOST_ID = 'faro-overlay-host'
const HIGHLIGHT_NAME = 'faro-quote'
// La observación activa, en su propio highlight y con prioridad 1. Sus Range
// NO están también en el de todas: comprobado el 2026-09-27 en Chrome, dos
// highlights traslúcidos sobre la misma letra pintan los DOS fondos, uno encima
// del otro, y en el tema oscuro la activa apilada dejaba el texto por debajo de
// 4,5:1 (3,88 en azul y 3,31 en ámbar, medido con test/contrast.js).
const HIGHLIGHT_ACTIVE_NAME = 'faro-quote-activa'
const SVG_NS = 'http://www.w3.org/2000/svg'

export class Overlay {
  constructor() {
    this.host = null
    this.root = null
    this.el = {}
    this.followTarget = null
    this.followRaf = 0
    this.quoteRanges = []
    this.outlineTargets = []
    this.notes = []
    this.activeNote = 0
    this.onCancel = null
    this.onNote = null
    this.stillMotion = false
    this.style = 'spotlight'
    // La tinta de las marcas (el ajuste «Color del subrayado», H23).
    this.tint = 'azul'
    // Lo que se va a pintar, con lo caro de cada observación ya buscado una
    // vez: la caja que la recorta y si cae dentro de un bloque de código.
    this._groups = []
    // Un repintado por frame como mucho, aunque lleguen cuarenta scrolls.
    this._refreshRaf = 0
    // Cuántos nodos se crean, se reutilizan y se quitan: es lo que mide la
    // comprobación 41 del banco para saber que las marcas no se recrean.
    this.stats = nuevasStats()
    this._onKey = this._onKey.bind(this)
    this._onViewportChange = this._onViewportChange.bind(this)
  }

  /** Pone los contadores a cero antes de medir algo (el banco). */
  resetStats() {
    this.stats = nuevasStats()
  }

  // ------------------------------------------------------------- montaje

  mount() {
    if (this.host && this.host.isConnected) return
    const host = document.createElement('div')
    host.id = HOST_ID
    // Un contenedor propio, fuera del <body>, para que un re-render de React
    // no se lo lleve por delante.
    document.documentElement.appendChild(host)

    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    root.appendChild(style)

    const spot = div('spot')
    const ring = document.createElementNS(SVG_NS, 'svg')
    ring.setAttribute('class', 'ring')
    const ringRect = document.createElementNS(SVG_NS, 'rect')
    ringRect.setAttribute('pathLength', '100')
    ringRect.setAttribute('rx', '10')
    ring.appendChild(ringRect)

    const quoteLayer = div('quote-layer')
    const noteLayer = div('note-layer')
    const outlineLayer = div('outline-layer')
    const pickHover = div('pick-hover')
    const card = div('card')
    const toast = div('toast')
    const pickBar = div('pick-bar')

    root.append(spot, ring, quoteLayer, noteLayer, outlineLayer, pickHover, card, toast, pickBar)

    this.host = host
    this.root = root
    this.el = { spot, ring, ringRect, quoteLayer, noteLayer, outlineLayer, pickHover, card, toast, pickBar }

    this._applyColorScheme()
    this._applyStyle()
    this._applyTint()
    this._injectHighlightStyle()

    document.addEventListener('keydown', this._onKey, true)
    window.addEventListener('scroll', this._onViewportChange, { passive: true, capture: true })
    window.addEventListener('resize', this._onViewportChange, { passive: true })
  }

  destroy() {
    this.clearAll()
    this.setPicking(false)
    cancelAnimationFrame(this._refreshRaf)
    this._refreshRaf = 0
    document.removeEventListener('keydown', this._onKey, true)
    window.removeEventListener('scroll', this._onViewportChange, true)
    window.removeEventListener('resize', this._onViewportChange)
    this.host?.remove()
    this.host = null
    this.root = null
    this.el = {}
  }

  clearAll() {
    this.hideSpot()
    this.hideCard()
    this.clearHighlight()
    this.clearOutlines()
    this.hidePickHover()
    this.hidePickBar()
    this.hideToast()
    this.unfollow()
    // Sin nada en marcha no hay nada que cancelar: quien lo borra todo suelta
    // también el cancelador, o un overlay huérfano (extensión recargada sin
    // recargar la pestaña) seguiría creyendo que tiene algo entre manos.
    this.onCancel = null
  }

  setReducedMotion(on) {
    this.stillMotion = !!on
    this.host?.classList.toggle('faro-still', !!on)
  }

  /** @param {'spotlight'|'marker'} style */
  setStyle(style) {
    this.style = style === 'marker' ? 'marker' : 'spotlight'
    this._applyStyle()
  }

  _applyStyle() {
    this.host?.classList.toggle('faro-marker', this.style === 'marker')
  }

  /**
   * La tinta de las marcas. Llega de los ajustes (`MSG.SETTINGS`) y puede
   * llegar antes de que haya overlay montado: se guarda, y `mount()` la aplica.
   * @param {'azul'|'ambar'} color lo que no sea 'ambar' cuenta como azul
   */
  setTint(color) {
    this.tint = color === 'ambar' ? 'ambar' : 'azul'
    this._applyTint()
  }

  /**
   * La tinta vive en dos sitios, porque el relleno está en el documento y no ve
   * las variables del host: una clase en el host (el trazo y los velos) y la
   * hoja `#faro-highlight-style` (el relleno), que sobrevive a `destroy()` y
   * por eso se reescribe aunque la haya dejado otro overlay.
   */
  _applyTint() {
    this.host?.classList.toggle('faro-tinta-ambar', this.tint === 'ambar')
    const hoja = document.getElementById('faro-highlight-style')
    const texto = highlightCss(this.tint)
    if (hoja && hoja.textContent !== texto) hoja.textContent = texto
  }

  _applyColorScheme() {
    const attr = document.documentElement.getAttribute('data-color-mode')
    const dark =
      attr === 'dark' ||
      (attr !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    this.host?.classList.toggle('faro-dark', !!dark)
  }

  _injectHighlightStyle() {
    if (!('highlights' in CSS)) return
    if (document.getElementById('faro-highlight-style')) return
    const s = document.createElement('style')
    s.id = 'faro-highlight-style'
    s.textContent = highlightCss(this.tint)
    document.head?.appendChild(s)
  }

  /**
   * ¿Es de Faro el Escape ahora mismo? Mientras hay algo EN MARCHA: el foco de
   * un recorrido, el cartel con sus botones, la barra de selección o el
   * seguimiento de un elemento. Las marcas NUMERADAS de un análisis no cuentan:
   * son del panel, que las da por puestas y las quita desde «Quitar las marcas»
   * o con la siguiente orden; borrarlas con Escape a sus espaldas lo dejaba con
   * `state.notes` viejo y contestando «esa marca ya no está» a cada pulsación.
   * Los filetes de las imágenes tampoco.
   *
   * La excepción es el subrayado de una LLEGADA por cita (`applyAnchor`), que
   * no lleva números: de ése el panel no guarda estado —sólo registra
   * «Fragmento resaltado»—, así que quitarlo con Escape no desincroniza a
   * nadie, y es el único control que tiene el usuario, porque en ese camino el
   * foco se apaga ANTES de subrayar. Sin esta línea, el Escape que antes de H2
   * lo borraba dejó de hacerlo y el subrayado se quedaba hasta la siguiente
   * orden (revisión adversaria de H2, 2026-09-14).
   *
   * Con esta guarda no hace falta que `hideCard()` suelte el cancelador: tras
   * esconder el cartel el ejecutor sigue desplegando la rama con el foco puesto
   * y mira `this.cancelled` después de cada espera —al abrir la rama, al
   * destellar y en cada vuelta del barrido, dentro y fuera de la ronda—, así
   * que ahí Escape corta el paso de verdad; cuando el foco se apaga, la tecla
   * vuelve a la página sola.
   *
   * Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2.3 M2): sin
   * esta guarda, desde la primera marca ningún Escape llegaba ya a la página
   * (ni al diálogo de edición, ni a un desplegable de AUI), porque el
   * cancelador se ponía en cada paso, llegada y análisis y nadie lo soltaba.
   */
  interceptsEscape() {
    const encendido = (el) => !!el?.classList.contains('on')
    return (
      encendido(this.el.spot) ||
      encendido(this.el.card) ||
      encendido(this.el.pickBar) ||
      !!this.followTarget ||
      !!(this.quoteRanges.length && !this.notes.length)
    )
  }

  _onKey(ev) {
    if (ev.key !== 'Escape' || typeof this.onCancel !== 'function' || !this.interceptsEscape()) return
    ev.stopPropagation()
    this.onCancel('escape')
  }

  _onViewportChange() {
    this._scheduleRefresh()
    if (this.followTarget) this._followTick()
  }

  /**
   * Un repintado por frame, no uno por evento.
   *
   * El oyente de `scroll` está en `window` con captura, así que recibe el
   * desplazamiento de la ventana y el de CADA contenedor con scroll propio: en
   * un gesto de rueda llegan decenas, y cada uno medía y repintaba las dos
   * capas enteras. Ahora sólo se apunta que hay que repintar; el frame lo hace
   * una vez con la posición final.
   */
  _scheduleRefresh() {
    if (this._refreshRaf) return
    this._refreshRaf = requestAnimationFrame(() => {
      this._refreshRaf = 0
      this.refreshMarks()
    })
  }

  /**
   * Vuelve a colocar subrayados, insignias y recuadros donde estén ahora.
   *
   * Se llama sola al desplazar la página, pero también hace falta a mano justo
   * después de un desplazamiento propio: mientras el scroll suave termina, lo
   * pintado se queda un instante en la posición vieja. Ese repintado a mano
   * deja sin sentido el frame que estuviera pendiente, así que lo cancela: si
   * no, el mismo frame se pintaría dos veces.
   */
  refreshMarks() {
    cancelAnimationFrame(this._refreshRaf)
    this._refreshRaf = 0
    if (this._groups.length) this._repaint(false)
    if (this.outlineTargets.length) this._paintOutlines(false)
  }

  // ---------------------------------------------------------------- foco

  /**
   * Coloca el foco sobre un rectángulo del viewport.
   *
   * Con `scrim: false` no se oscurece nada: queda un subrayado amarillo con
   * filete. Es lo que se usa al LLEGAR a un destino, donde el oscurecido tapa
   * justo lo que has venido a leer.
   *
   * @param {{top:number,left:number,width:number,height:number}} rect
   */
  spotlight(rect, { draw = true, padding = 8, breathe = true, scrim = true } = {}) {
    this.mount()
    const { spot, ring, ringRect } = this.el
    const r = inflate(rect, padding)

    const first = !spot.classList.contains('on')
    setBox(spot, r)
    setBox(ring, r)
    ring.setAttribute('viewBox', `0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`)
    ringRect.setAttribute('x', '1')
    ringRect.setAttribute('y', '1')
    ringRect.setAttribute('width', String(Math.max(1, r.width - 2)))
    ringRect.setAttribute('height', String(Math.max(1, r.height - 2)))

    spot.classList.add('on')
    ring.classList.add('on')
    spot.classList.toggle('breathe', breathe && !this.stillMotion)
    spot.classList.toggle('flat', !scrim)
    ring.classList.toggle('flat', !scrim)

    if (draw && scrim) {
      // Reinicia la animación de trazado: sin esto, el segundo paso no dibuja.
      ring.classList.remove('draw')
      void ring.getBoundingClientRect()
      ring.classList.add('draw')
    }
    return first
  }

  hideSpot() {
    this.el.spot?.classList.remove('on', 'breathe', 'flat')
    this.el.ring?.classList.remove('on', 'draw', 'flat')
  }

  /** Mantiene el foco pegado a un elemento mientras la página se mueve. */
  follow(element, opts) {
    this.followTarget = element
    this.followOpts = opts
    this._followTick()
  }

  unfollow() {
    this.followTarget = null
    cancelAnimationFrame(this.followRaf)
    this.followRaf = 0
  }

  _followTick() {
    cancelAnimationFrame(this.followRaf)
    this.followRaf = requestAnimationFrame(() => {
      if (!this.followTarget || !this.followTarget.isConnected) return
      const r = this.followTarget.getBoundingClientRect()
      if (r.width || r.height) this.spotlight(r, { draw: false, ...(this.followOpts || {}) })
    })
  }

  // -------------------------------------------------------------- cartel

  /**
   * @param {{kicker?:string, title?:string, text?:string, count?:string,
   *          near?:DOMRect, progressMs?:number,
   *          actions?: Array<{label:string, kind?:'primary'|'ghost', onClick:Function}>}} opts
   */
  showCard(opts = {}) {
    this.mount()
    const { card } = this.el
    card.textContent = ''

    const top = div('card-top')
    top.appendChild(div('beacon'))
    const kicker = div('card-kicker')
    kicker.textContent = opts.kicker || 'Faro'
    top.appendChild(kicker)
    if (opts.count) {
      const c = div('card-count')
      c.textContent = opts.count
      top.appendChild(c)
    }
    card.appendChild(top)

    if (opts.title) {
      const t = div('card-title')
      t.textContent = opts.title
      card.appendChild(t)
    }
    if (opts.text) {
      const p = div('card-text')
      p.textContent = opts.text
      card.appendChild(p)
    }

    const actions = opts.actions || []
    if (actions.length) {
      const row = div('card-actions')
      actions.forEach((a, i) => {
        if (a.spacerBefore) row.appendChild(div('spacer'))
        const b = document.createElement('button')
        b.className = a.kind === 'primary' ? 'btn-primary' : 'btn-ghost'
        b.textContent = a.label
        b.addEventListener('click', (ev) => {
          ev.preventDefault()
          a.onClick?.()
        })
        if (i === 0 && a.kind === 'primary') queueMicrotask(() => b.focus({ preventScroll: true }))
        row.appendChild(b)
      })
      card.appendChild(row)
    }

    if (opts.progressMs) {
      const p = div('progress')
      p.style.setProperty('--faro-step-ms', opts.progressMs + 'ms')
      p.appendChild(document.createElement('i'))
      card.appendChild(p)
      requestAnimationFrame(() => p.classList.add('run'))
    }

    this._placeCard(opts.near)
    requestAnimationFrame(() => card.classList.add('on'))
  }

  hideCard() {
    this.el.card?.classList.remove('on')
  }

  /** Coloca el cartel junto al objetivo, girándolo si no cabe. */
  _placeCard(near) {
    const card = this.el.card
    card.style.visibility = 'hidden'
    card.style.top = '0px'
    card.style.left = '0px'
    const cw = card.offsetWidth || 300
    const ch = card.offsetHeight || 120
    const vw = window.innerWidth
    const vh = window.innerHeight
    const M = 14

    let top
    let left

    if (!near) {
      top = vh - ch - 28
      left = vw - cw - 28
    } else {
      const below = vh - (near.top + near.height)
      const above = near.top
      if (below >= ch + M) top = near.top + near.height + M
      else if (above >= ch + M) top = near.top - ch - M
      else top = clamp(near.top + near.height / 2 - ch / 2, M, vh - ch - M)

      left = clamp(near.left + near.width / 2 - cw / 2, M, vw - cw - M)

      // Si arriba y abajo van justos, se sale a un lado.
      if (below < ch + M && above < ch + M) {
        const right = vw - (near.left + near.width)
        left = right > near.left ? clamp(near.left + near.width + M, M, vw - cw - M) : clamp(near.left - cw - M, M, vw - cw - M)
      }
    }

    card.style.top = Math.round(top) + 'px'
    card.style.left = Math.round(left) + 'px'
    card.style.visibility = ''
  }

  // ------------------------------------------------------ resaltado texto

  /**
   * Resalta uno o varios Range sin tocar el DOM del contenido.
   * @param {Range[]} ranges
   */
  highlightRanges(ranges, { sweep = true } = {}) {
    this.mount()
    // Una cita suelta no lleva números: si venía de un análisis, sus insignias
    // se van con ella.
    this.notes = []
    this.activeNote = 0
    // Antes de la salida de abajo: si no hay nada que subrayar tampoco puede
    // quedar nada preparado, o el siguiente scroll repintaría lo anterior.
    this._groups = []
    this.quoteRanges = ranges.filter(Boolean)
    if (!this.quoteRanges.length) return false

    this._setHighlight(this.quoteRanges)
    this._prepareGroups()
    this._repaint(sweep)
    return true
  }

  /**
   * Varias observaciones numeradas sobre la misma página.
   *
   * Es lo que deja el modo Análisis: cada punto sobre el que tiene algo que
   * decir queda subrayado y con su número detrás, para que el chat y la página
   * hablen del mismo sitio.
   *
   * @param {Array<{n:number, title?:string, ranges:Range[]}>} items
   * @returns {number} cuántas se pudieron marcar
   */
  annotate(items) {
    this.mount()
    const notas = (items || []).filter((x) => x && x.n && x.ranges?.length)
    const todos = notas.flatMap((x) => x.ranges)
    if (!todos.length) {
      this.clearNotes()
      return 0
    }

    this.notes = notas
    this.activeNote = 0
    this.quoteRanges = todos
    this._setHighlight(todos, this._activeRanges())
    this._prepareGroups()
    this._repaint(true)
    return notas.length
  }

  /**
   * Destaca una observación sobre las demás: su relleno pasa al highlight de la
   * activa y su trazo, a la clase `active`.
   */
  focusNote(n) {
    if (!this.notes.some((x) => x.n === n)) return false
    this.activeNote = n
    this._setHighlight(this.quoteRanges, this._activeRanges())
    this._repaint(false)
    return true
  }

  /** Los Range de la observación activa, o ninguno. */
  _activeRanges() {
    const nota = this.activeNote ? this.notes.find((x) => x.n === this.activeNote) : null
    return nota?.ranges || []
  }

  clearNotes() {
    this.notes = []
    this.activeNote = 0
    if (this.el.noteLayer) this.el.noteLayer.textContent = ''
    this.clearHighlight()
    // El análisis que las puso dejó un cancelador que las borraba: sin marcas
    // ya no borra nada, y con él puesto Escape seguía siendo de Faro.
    this.onCancel = null
  }

  clearHighlight() {
    this.quoteRanges = []
    this.notes = []
    this.activeNote = 0
    this._groups = []
    try {
      CSS.highlights?.delete(HIGHLIGHT_NAME)
      CSS.highlights?.delete(HIGHLIGHT_ACTIVE_NAME)
    } catch {
      /* nada que limpiar */
    }
    if (this.el.quoteLayer) this.el.quoteLayer.textContent = ''
    if (this.el.noteLayer) this.el.noteLayer.textContent = ''
  }

  /**
   * El relleno de las marcas, debajo del texto: `faro-quote` con todas menos la
   * activa y `faro-quote-activa` con la activa, con prioridad 1 por si su texto
   * coincide con el de otra observación. Cada Range está en UN highlight: los
   * dos rellenos son traslúcidos y, apilados, se suman.
   *
   * @param {Range[]} ranges todos los de la página
   * @param {Range[]} activos los de la observación activa (ninguno en una cita)
   */
  _setHighlight(ranges, activos = []) {
    if (!('highlights' in CSS) || typeof Highlight !== 'function') return
    try {
      const resto = activos.length ? ranges.filter((r) => !activos.includes(r)) : ranges
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...resto))
      if (activos.length) {
        const activa = new Highlight(...activos)
        activa.priority = 1
        CSS.highlights.set(HIGHLIGHT_ACTIVE_NAME, activa)
      } else {
        CSS.highlights.delete(HIGHLIGHT_ACTIVE_NAME)
      }
    } catch {
      /* si falla, queda el trazo de los rectángulos */
    }
  }

  /**
   * Qué grupos hay que pintar, con lo caro de cada uno buscado UNA vez.
   *
   * Un grupo es una observación numerada; cuando no hay observaciones, el
   * grupo es uno solo y sin número, que es el caso de una cita normal. Lo caro
   * es el elemento que recorta la marca (un `getComputedStyle` por cada
   * antepasado, hasta diez) y si cae dentro de un bloque de código: ni lo uno
   * ni lo otro cambia al desplazar la página, y se buscaba dos veces por
   * observación EN CADA evento de scroll.
   */
  _prepareGroups() {
    const grupos = this.notes.length
      ? this.notes
      : this.quoteRanges.length
        ? [{ n: 0, ranges: this.quoteRanges }]
        : []
    this._groups = grupos.map((g) => ({
      n: g.n || 0,
      title: g.title,
      ranges: g.ranges,
      // Recortados a su contenedor: un bloque de código con scroll propio
      // recorta el texto, así que también tiene que recortar la marca.
      clipEl: clipElementFor(g.ranges),
      // Sobre código la marca se aligera para no tapar la sintaxis.
      enCodigo: inCode(g.ranges),
    }))
  }

  /**
   * Dónde está ahora cada grupo: las cajas ya fundidas por línea y recortadas,
   * y la última, que es donde va la insignia.
   *
   * Se mide una sola vez y sirve para las DOS capas: antes el subrayado y las
   * insignias leían la geometría por separado, o sea dos veces por observación
   * y por frame. La caja de recorte se relee siempre (se mueve con la página),
   * pero el ELEMENTO sólo se vuelve a buscar si desapareció del documento,
   * que es lo que pasa cuando Confluence repinta el párrafo marcado.
   */
  _measureGroups() {
    const out = []
    for (const g of this._groups) {
      if (g.clipEl && !g.clipEl.isConnected) g.clipEl = clipElementFor(g.ranges)
      const caja = g.clipEl ? g.clipEl.getBoundingClientRect() : null
      const rects = clipRects(rectsOf(g.ranges), caja)
      out.push({ n: g.n, title: g.title, enCodigo: g.enCodigo, rects, ultimo: rects[rects.length - 1] || null })
    }
    return out
  }

  /** Mide una vez y pinta las dos capas con esa misma medida. */
  _repaint(sweep) {
    const medidas = this._measureGroups()
    this.stats.paints++
    this._paintQuoteRects(sweep, medidas)
    this._paintNoteBadges(sweep, medidas)
  }

  /**
   * Deja en la capa exactamente un nodo por elemento de `items`, REUTILIZANDO
   * los que ya están: se crea sólo lo que falta y se quita sólo lo que sobra.
   *
   * Vaciar la capa y volver a crearlo todo era lo que hacía parpadear las
   * marcas: un `.quote-rect` recién creado tiene `opacity: 0` y una transición
   * de .4 s, así que cada scroll las apagaba y las volvía a encender. Además,
   * un nodo reutilizado conserva su oyente de clic y no vuelve a componer capa.
   *
   * @param {Element} layer capa del overlay donde viven los nodos
   * @param {Array} items qué hay que pintar, en orden
   * @param {() => Element} crear un nodo vacío de la clase que toque
   * @param {(nodo: Element, item: any, i: number, nuevo: boolean) => void} pintar lo que cambia en cada frame
   */
  _syncNodes(layer, items, crear, pintar) {
    const hijos = layer.children
    for (let i = 0; i < items.length; i++) {
      let nodo = hijos[i]
      const nuevo = !nodo
      if (nuevo) {
        nodo = crear(items[i])
        layer.appendChild(nodo)
        this.stats.created++
      } else {
        this.stats.reused++
      }
      pintar(nodo, items[i], i, nuevo)
    }
    while (hijos.length > items.length) {
      layer.lastElementChild.remove()
      this.stats.removed++
    }
  }

  /**
   * Los trazos, uno por línea de cada observación: un rectángulo transparente
   * con la caja EXACTA de la línea, cuyo `::after` es la pastilla de tinta
   * (styles.js). El relleno no va aquí: es el `::highlight` de debajo.
   *
   * La observación activa lleva el trazo más grueso, y el «se dibuja» sólo
   * corre en el pintado que lo pide (el primero de un análisis o de una
   * llegada): al desplazar la página las marcas se quedan donde están,
   * encendidas.
   */
  _paintQuoteRects(sweep, medidas) {
    const layer = this.el.quoteLayer
    if (!layer) return

    const items = []
    for (const m of medidas) {
      const activa = !!m.n && m.n === this.activeNote
      for (const rect of m.rects) items.push({ rect, activa, enCodigo: m.enCodigo })
    }

    this._syncNodes(
      layer,
      items,
      () => div('quote-rect'),
      (nodo, item, i, nuevo) => {
        setBox(nodo, item.rect)
        nodo.classList.toggle('active', item.activa)
        nodo.classList.toggle('on-code', item.enCodigo)
        // Encender al instante, salvo la aparición del primer pintado: ahí sí
        // se espera un frame para que la transición desde `opacity: 0` se vea.
        if (nuevo && sweep) requestAnimationFrame(() => nodo.classList.add('on'))
        else nodo.classList.add('on')
        // El escalonado va DENTRO de la animación (--faro-retardo): con un
        // setTimeout delante el trazo se veía entero y luego se redibujaba.
        if (sweep && !this.stillMotion) barrer(nodo, 60 + i * 40)
      }
    )
  }

  /**
   * El número de cada observación, detrás del último carácter de su cita y en
   * superíndice. Pasó de verdad (anexo 2-F): centrada en la línea, la insignia
   * tapaba las dos o tres primeras letras de la palabra siguiente. Subida 8 px
   * (el plan decía 6; con Segoe UI 14 px a 6 acababa 0-1 px por debajo de la
   * mitad del carácter siguiente, medido en el banco), su mitad de arriba cae en
   * el hueco sobre la línea;
   * la de abajo todavía puede rozar lo alto de la primera letra que sigue, y
   * cuánto es cosa del banco, que mide cajas de verdad.
   */
  _paintNoteBadges(animate, medidas) {
    const layer = this.el.noteLayer
    if (!layer) return

    const ocupados = []
    const items = []
    for (const m of medidas) {
      if (!m.n || !m.ultimo) continue
      // Pegada al final de la cita, sin salirse de la ventana ni por arriba, y
      // sin pisar a otra insignia: dos citas que acaban a la misma altura ponían
      // sus números uno encima del otro y sólo se leía el de arriba.
      const sitio = libre(
        Math.min(m.ultimo.left + m.ultimo.width + 1, window.innerWidth - 24),
        Math.max(0, m.ultimo.top - 8),
        ocupados
      )
      ocupados.push(sitio)
      items.push({ n: m.n, title: m.title, sitio })
    }

    this._syncNodes(
      layer,
      items,
      () => {
        const b = document.createElement('button')
        b.className = 'note-badge'
        // El oyente se pone al crear y sobrevive a los repintados: el número
        // lo lee del propio nodo, porque el nodo se reutiliza para otra
        // observación cuando una de las de arriba deja de tener caja.
        b.addEventListener('click', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          this.onNote?.(Number(b.dataset.n))
        })
        return b
      },
      (nodo, item, i, nuevo) => {
        const texto = String(item.n)
        if (nodo.dataset.n !== texto) {
          nodo.dataset.n = texto
          nodo.textContent = texto
        }
        const titulo = item.title ? `${item.n} · ${item.title}` : 'Observación ' + item.n
        if (nodo.title !== titulo) nodo.title = titulo
        nodo.classList.toggle('active', item.n === this.activeNote)
        css(nodo, 'left', Math.round(item.sitio.left) + 'px')
        css(nodo, 'top', Math.round(item.sitio.top) + 'px')
        if (nuevo && animate) requestAnimationFrame(() => nodo.classList.add('on'))
        else nodo.classList.add('on')
      }
    )
  }

  // ---------------------------------------------------- recuadro de imagen

  /**
   * Rodea elementos con un filete muy fino, sin tocarlos.
   *
   * Es lo que marca una imagen o un diagrama: el resaltado de texto no sirve
   * ahí, porque dentro de un `<img>` no hay Range que valga.
   *
   * @param {Element[]} elements
   */
  outlineElements(elements) {
    this.mount()
    this.outlineTargets = (elements || []).filter((el) => el && el.isConnected)
    this._paintOutlines(true)
    return this.outlineTargets.length
  }

  clearOutlines() {
    this.outlineTargets = []
    if (this.el.outlineLayer) this.el.outlineLayer.textContent = ''
  }

  _paintOutlines(animate) {
    const layer = this.el.outlineLayer
    if (!layer) return
    const items = []
    for (const el of this.outlineTargets) {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      items.push(inflate(r, 2))
    }
    // Por el mismo camino que las marcas: los filetes también se repintaban en
    // cada scroll, y un filete recreado es un nodo más que componer.
    this._syncNodes(
      layer,
      items,
      () => div('img-outline'),
      (nodo, rect, i, nuevo) => {
        setBox(nodo, rect)
        if (nuevo && animate) requestAnimationFrame(() => nodo.classList.add('on'))
        else nodo.classList.add('on')
      }
    )
  }

  // ------------------------------------------------------ modo selección

  /** Marca por dónde va el ratón mientras el usuario elige una imagen. */
  pickHover(rect) {
    this.mount()
    const h = this.el.pickHover
    if (!h) return
    if (!rect) return this.hidePickHover()
    setBox(h, inflate(rect, 2))
    h.classList.add('on')
  }

  hidePickHover() {
    this.el.pickHover?.classList.remove('on')
  }

  /**
   * Barra del modo de selección: dice qué hay elegido y ofrece confirmarlo.
   * @param {{text:string, hint?:string, actions?:Array}} opts
   */
  pickBar({ text, hint, actions = [] } = {}) {
    this.mount()
    const bar = this.el.pickBar
    bar.textContent = ''

    const beacon = div('beacon')
    bar.appendChild(beacon)

    const t = div('pick-text')
    t.textContent = text || ''
    bar.appendChild(t)

    if (hint) {
      const h = div('pick-hint')
      h.textContent = hint
      bar.appendChild(h)
    }

    for (const a of actions) {
      const b = document.createElement('button')
      b.className = a.kind === 'primary' ? 'btn-primary' : 'btn-ghost'
      b.textContent = a.label
      b.disabled = !!a.disabled
      b.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        a.onClick?.()
      })
      bar.appendChild(b)
    }

    requestAnimationFrame(() => bar.classList.add('on'))
  }

  hidePickBar() {
    this.el.pickBar?.classList.remove('on')
  }

  /**
   * Cursor y selección de «Señalar» sobre la página. Va en <head>, nunca en el
   * contenido. Con la página en tema oscuro (lo que ya decidió
   * `_applyColorScheme` para el host), el subrayador de cuerpo claro: el picker
   * monta el overlay antes de llamar aquí.
   */
  setPicking(on) {
    const html = document.documentElement
    if (on) {
      if (!document.getElementById('faro-pick-style')) {
        const s = document.createElement('style')
        s.id = 'faro-pick-style'
        s.textContent = PICK_CSS
        document.head?.appendChild(s)
      }
      html.classList.add('faro-picking')
      html.classList.toggle('faro-picking-dark', !!this.host?.classList.contains('faro-dark'))
    } else {
      html.classList.remove('faro-picking', 'faro-picking-dark')
    }
  }

  // --------------------------------------------------------------- aviso

  toast(text, { ms = 4200, actions = [] } = {}) {
    this.mount()
    const t = this.el.toast
    t.textContent = ''
    const span = document.createElement('span')
    span.textContent = text
    t.appendChild(span)
    for (const a of actions) {
      const b = document.createElement('button')
      b.className = 'btn-ghost'
      b.style.marginLeft = '10px'
      b.textContent = a.label
      b.addEventListener('click', () => a.onClick?.())
      t.appendChild(b)
    }
    t.classList.add('on')
    clearTimeout(this._toastTimer)
    if (ms) this._toastTimer = setTimeout(() => this.hideToast(), ms)
  }

  hideToast() {
    this.el.toast?.classList.remove('on')
  }
}

// ------------------------------------------------------------- utilidades

function div(cls) {
  const d = document.createElement('div')
  d.className = cls
  return d
}

function nuevasStats() {
  return { paints: 0, created: 0, reused: 0, removed: 0 }
}

/**
 * Lo que dura el «se dibuja» del trazo en styles.js (`faro-tinta .45s`), con
 * margen. Es el respaldo para quitar la clase si `animationend` no llega: una
 * marca fuera de la pantalla o con las animaciones apagadas por el sistema no
 * lo dispara. Se suma al retardo de cada caja (barrer), porque la animación
 * empieza tras él. Era 1200 con el barrido blanco de antes (`faro-sweep 1.1s`).
 */
const SWEEP_MS = 600

/**
 * Lanza el «se dibuja» de una marca y lo retira al acabar.
 *
 * Desde H23 el trazo (`.quote-rect::after`) existe siempre y lo que la clase
 * pone es la animación. Cada scroll reutiliza el nodo (P1), así que la clase
 * hay que quitarla a propósito: si se quedara puesta, el siguiente pintado que
 * la volviera a poner no la reiniciaría, y el banco (tramo 26) mira que ninguna
 * marca se quede con la animación colgada.
 *
 * El retardo escalonado (60 + i·40 ms) va en `--faro-retardo`, que el CSS usa
 * como `animation-delay`, y la clase se pone EN EL ACTO. Pasó al revisar el
 * contrato: con la clase puesta tarde por un setTimeout, el trazo (que existe
 * siempre) se veía entero durante el retardo y luego se redibujaba desde
 * scaleX(0). Con `both`, durante el retardo rige el `from` y no se ve.
 */
function barrer(nodo, retardo = 0) {
  if (!nodo.isConnected) return
  nodo.style.setProperty('--faro-retardo', retardo + 'ms')
  nodo.addEventListener('animationend', quitarBarrido, { once: true })
  clearTimeout(nodo._faroSweep)
  nodo._faroSweep = setTimeout(() => nodo.classList.remove('sweep'), SWEEP_MS + retardo)
  nodo.classList.add('sweep')
}

function quitarBarrido(ev) {
  ev.currentTarget.classList.remove('sweep')
}

/** Escribe una propiedad de estilo sólo si cambia: repintar no es reescribir. */
function css(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value
}

/**
 * Un hueco de 16x16 (más su anillo) que no pise a los ya puestos. Se aparta a
 * la derecha, sin salirse de la ventana.
 */
function libre(left, top, ocupados) {
  const CHOCA = 19
  let x = left
  for (let i = 0; i < 8; i++) {
    if (!ocupados.some((o) => Math.abs(o.left - x) < CHOCA && Math.abs(o.top - top) < CHOCA)) break
    x += CHOCA
  }
  return { left: Math.min(x, window.innerWidth - 24), top }
}

/**
 * El elemento que recorta lo marcado: el contenedor con scroll o con overflow
 * oculto más cercano. Sin esto, una marca dentro de un bloque de código
 * desplazado en horizontal se pinta fuera del bloque.
 *
 * Devuelve el ELEMENTO y no su caja: buscarlo cuesta un `getComputedStyle` por
 * cada antepasado y no cambia mientras la página no se repinte, así que se
 * busca al anotar y en cada frame sólo se vuelve a leer su caja.
 */
function clipElementFor(ranges) {
  for (const range of ranges || []) {
    const c = range?.commonAncestorContainer
    let el = c?.nodeType === 1 ? c : c?.parentElement
    for (let i = 0; el && i < 10; i++) {
      if (el === document.body || el === document.documentElement) break
      const s = getComputedStyle(el)
      if (/auto|scroll|hidden|clip/.test(s.overflowX) || /auto|scroll|hidden|clip/.test(s.overflowY)) {
        return el
      }
      el = el.parentElement
    }
  }
  return null
}

/** ¿Lo marcado cae dentro de un bloque de código? Ahí la marca se aligera. */
function inCode(ranges) {
  for (const range of ranges || []) {
    const c = range?.commonAncestorContainer
    const el = c?.nodeType === 1 ? c : c?.parentElement
    if (el?.closest?.('pre, code, [data-language], .code-block')) return true
  }
  return false
}

function setBox(el, r) {
  css(el, 'top', Math.round(r.top) + 'px')
  css(el, 'left', Math.round(r.left) + 'px')
  css(el, 'width', Math.round(r.width) + 'px')
  css(el, 'height', Math.round(r.height) + 'px')
}

function inflate(r, p) {
  return {
    top: r.top - p,
    left: r.left - p,
    width: r.width + p * 2,
    height: r.height + p * 2,
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
