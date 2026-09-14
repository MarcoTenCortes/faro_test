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
 */

import { OVERLAY_CSS, HIGHLIGHT_CSS, PICK_CSS } from './styles.js'
import { rectsOf, clipRects } from './rects.js'

const HOST_ID = 'faro-overlay-host'
const HIGHLIGHT_NAME = 'faro-quote'
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
    this._onKey = this._onKey.bind(this)
    this._onViewportChange = this._onViewportChange.bind(this)
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
    this._injectHighlightStyle()

    document.addEventListener('keydown', this._onKey, true)
    window.addEventListener('scroll', this._onViewportChange, { passive: true, capture: true })
    window.addEventListener('resize', this._onViewportChange, { passive: true })
  }

  destroy() {
    this.clearAll()
    this.setPicking(false)
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
    s.textContent = HIGHLIGHT_CSS
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
    this.refreshMarks()
    if (this.followTarget) this._followTick()
  }

  /**
   * Vuelve a colocar subrayados, insignias y recuadros donde estén ahora.
   *
   * Se llama sola al desplazar la página, pero también hace falta a mano justo
   * después de un desplazamiento propio: mientras el scroll suave termina, lo
   * pintado se queda un instante en la posición vieja.
   */
  refreshMarks() {
    if (this.quoteRanges.length) this._paintQuoteRects(false)
    if (this.notes.length) this._paintNoteBadges(false)
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
    this.quoteRanges = ranges.filter(Boolean)
    if (!this.quoteRanges.length) return false

    this._setHighlight(this.quoteRanges)
    this._paintQuoteRects(sweep)
    this._paintNoteBadges(false)
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
    this._setHighlight(todos)
    this._paintQuoteRects(true)
    this._paintNoteBadges(true)
    return notas.length
  }

  /** Destaca una observación sobre las demás. */
  focusNote(n) {
    if (!this.notes.some((x) => x.n === n)) return false
    this.activeNote = n
    this._paintQuoteRects(false)
    this._paintNoteBadges(false)
    return true
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
    try {
      CSS.highlights?.delete(HIGHLIGHT_NAME)
    } catch {
      /* nada que limpiar */
    }
    if (this.el.quoteLayer) this.el.quoteLayer.textContent = ''
    if (this.el.noteLayer) this.el.noteLayer.textContent = ''
  }

  _setHighlight(ranges) {
    if (!('highlights' in CSS) || typeof Highlight !== 'function') return
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
    } catch {
      /* si falla, quedan los rectángulos de respaldo */
    }
  }

  /**
   * Los rectángulos amarillos.
   *
   * Se pintan por grupos para poder marcar más fuerte la observación activa;
   * cuando no hay observaciones, el grupo es uno solo y sin número, que es el
   * caso de una cita normal.
   */
  _paintQuoteRects(sweep) {
    const layer = this.el.quoteLayer
    if (!layer) return

    const grupos = this.notes.length ? this.notes : [{ n: 0, ranges: this.quoteRanges }]
    layer.textContent = ''
    let i = 0

    for (const grupo of grupos) {
      const activa = grupo.n && grupo.n === this.activeNote
      // Fundidos por línea: el navegador devuelve una caja por cada trozo con
      // estilo propio, y en un bloque de código eso son diecisiete cajas
      // solapadas para cuatro líneas.
      const enCodigo = inCode(grupo.ranges)
      // Y recortados a su contenedor: un bloque de código con scroll propio
      // recorta el texto, así que también tiene que recortar la marca.
      const caja = clipBoxFor(grupo.ranges)

      for (const r of clipRects(rectsOf(grupo.ranges), caja)) {
        const d = div('quote-rect' + (activa ? ' active' : '') + (enCodigo ? ' on-code' : ''))
        setBox(d, r)
        layer.appendChild(d)
        const orden = i++
        requestAnimationFrame(() => {
          d.classList.add('on')
          if (sweep && !this.stillMotion) setTimeout(() => d.classList.add('sweep'), 60 + orden * 40)
        })
      }
    }
  }

  /** El número de cada observación, detrás del último carácter de su cita. */
  _paintNoteBadges(animate) {
    const layer = this.el.noteLayer
    if (!layer) return
    layer.textContent = ''

    const ocupados = []

    for (const nota of this.notes) {
      const rects = clipRects(rectsOf(nota.ranges), clipBoxFor(nota.ranges))
      const ultimo = rects[rects.length - 1]
      if (!ultimo) continue

      const b = document.createElement('button')
      b.className = 'note-badge' + (nota.n === this.activeNote ? ' active' : '')
      b.textContent = String(nota.n)
      b.title = nota.title ? `${nota.n} · ${nota.title}` : 'Observación ' + nota.n
      // Pegado al final de la cita, sin salirse de la ventana, y sin pisar a
      // otra insignia: dos citas que acaban a la misma altura ponían sus números
      // uno encima del otro y sólo se leía el de arriba.
      const sitio = libre(
        Math.min(ultimo.left + ultimo.width + 3, window.innerWidth - 26),
        ultimo.top + ultimo.height / 2 - 8.5,
        ocupados
      )
      ocupados.push(sitio)
      b.style.left = Math.round(sitio.left) + 'px'
      b.style.top = Math.round(sitio.top) + 'px'
      b.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        this.onNote?.(nota.n)
      })

      layer.appendChild(b)
      if (animate) requestAnimationFrame(() => b.classList.add('on'))
      else b.classList.add('on')
    }
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
    layer.textContent = ''
    for (const el of this.outlineTargets) {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      const d = div('img-outline')
      setBox(d, inflate(r, 2))
      layer.appendChild(d)
      if (animate) requestAnimationFrame(() => d.classList.add('on'))
      else d.classList.add('on')
    }
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

  /** Cursor de selección sobre la página. Va en <head>, nunca en el contenido. */
  setPicking(on) {
    if (on) {
      if (!document.getElementById('faro-pick-style')) {
        const s = document.createElement('style')
        s.id = 'faro-pick-style'
        s.textContent = PICK_CSS
        document.head?.appendChild(s)
      }
      document.documentElement.classList.add('faro-picking')
    } else {
      document.documentElement.classList.remove('faro-picking')
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

/** Un hueco de 17x17 que no pise a los ya puestos. Se aparta a la derecha. */
function libre(left, top, ocupados) {
  const CHOCA = 19
  let x = left
  for (let i = 0; i < 8; i++) {
    if (!ocupados.some((o) => Math.abs(o.left - x) < CHOCA && Math.abs(o.top - top) < CHOCA)) break
    x += CHOCA
  }
  return { left: Math.min(x, window.innerWidth - 26), top }
}

/**
 * La caja que recorta lo marcado: el contenedor con scroll o con overflow
 * oculto más cercano. Sin esto, una marca dentro de un bloque de código
 * desplazado en horizontal se pinta fuera del bloque.
 */
function clipBoxFor(ranges) {
  for (const range of ranges || []) {
    const c = range?.commonAncestorContainer
    let el = c?.nodeType === 1 ? c : c?.parentElement
    for (let i = 0; el && i < 10; i++) {
      if (el === document.body || el === document.documentElement) break
      const s = getComputedStyle(el)
      if (/auto|scroll|hidden|clip/.test(s.overflowX) || /auto|scroll|hidden|clip/.test(s.overflowY)) {
        return el.getBoundingClientRect()
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
  el.style.top = Math.round(r.top) + 'px'
  el.style.left = Math.round(r.left) + 'px'
  el.style.width = Math.round(r.width) + 'px'
  el.style.height = Math.round(r.height) + 'px'
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
