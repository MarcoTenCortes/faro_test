/**
 * Modo de selección: el usuario señala con el ratón qué quiere preguntar.
 *
 * Subrayar un párrafo o pulsar una imagen, y eso —y sólo eso— pasa a ser el
 * contexto de la siguiente pregunta. Sirve para lo que un chatbot dentro de una
 * página tiene que saber hacer: «explícame ESTO», sin tener que describir
 * primero de qué estás hablando.
 *
 * Dos reglas que no se rompen:
 *  - No se toca el DOM del contenido. El cursor va por una clase en <html> y la
 *    barra de confirmación vive en el Shadow DOM del overlay.
 *  - Mientras dura la selección, los clics de la página se anulan. Si no,
 *    pulsar una imagen dentro de un enlace navegaría a otro sitio y se acabó.
 */

import { buildTextPick, buildImagePick, PICK_LIMITS } from './pick-payload.js'

const MEDIA = 'img, svg, canvas, figure, [data-media-type]'
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]'
const BLOQUES = 'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, figure, div'

export class Picker {
  constructor(overlay) {
    this.overlay = overlay
    this.active = false
    this.pick = null
    this.hoverEl = null
    this._resolve = null

    this._onMove = this._onMove.bind(this)
    this._onUp = this._onUp.bind(this)
    this._onClick = this._onClick.bind(this)
    this._onDown = this._onDown.bind(this)
    this._onDrag = this._onDrag.bind(this)
    this._onKey = this._onKey.bind(this)
  }

  /**
   * Arranca el modo de selección.
   * @returns {Promise<object|null>} el contexto elegido, o null si se canceló
   */
  start() {
    if (this.active) this.cancel()
    this.active = true
    this.pick = null

    this.overlay.mount()
    this.overlay.setPicking(true)
    // Escape lo atiende el propio selector mientras dura: si lo dejáramos en
    // manos del overlay, cancelaría el recorrido de navegación en vez de esto.
    this._cancelPrevio = this.overlay.onCancel
    this.overlay.onCancel = () => this.cancel()
    this._paintBar()

    document.addEventListener('mousemove', this._onMove, true)
    document.addEventListener('mouseup', this._onUp, true)
    document.addEventListener('click', this._onClick, true)
    document.addEventListener('mousedown', this._onDown, true)
    document.addEventListener('dragstart', this._onDrag, true)
    document.addEventListener('keydown', this._onKey, true)

    return new Promise((resolve) => {
      this._resolve = resolve
    })
  }

  cancel() {
    this._finish(null)
  }

  _finish(pick) {
    if (!this.active) return
    this.active = false

    document.removeEventListener('mousemove', this._onMove, true)
    document.removeEventListener('mouseup', this._onUp, true)
    document.removeEventListener('click', this._onClick, true)
    document.removeEventListener('mousedown', this._onDown, true)
    document.removeEventListener('dragstart', this._onDrag, true)
    document.removeEventListener('keydown', this._onKey, true)

    this.overlay.onCancel = this._cancelPrevio || null
    this.overlay.setPicking(false)
    this.overlay.hidePickHover()
    this.overlay.hidePickBar()
    this.overlay.clearOutlines()
    this.hoverEl = null

    const resolve = this._resolve
    this._resolve = null
    resolve?.(pick)
  }

  // ------------------------------------------------------------- la barra

  _paintBar() {
    const acciones = [
      {
        label: 'Cancelar',
        onClick: () => this.cancel(),
      },
    ]

    if (this.pick) {
      acciones.unshift({
        label: 'Usar esto',
        kind: 'primary',
        onClick: () => this._finish(this.pick),
      })
    }

    this.overlay.pickBar({
      text: this.pick ? resumen(this.pick) : 'Subraya un texto o pulsa una imagen.',
      hint: this.pick ? 'Vuelve a subrayar para cambiarlo' : 'Esc para salir',
      actions: acciones,
    })
  }

  // ------------------------------------------------------------- eventos

  _mio(ev) {
    return !!ev.target?.closest?.('#faro-overlay-host')
  }

  _onKey(ev) {
    if (!this.active) return
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      this.cancel()
    }
    if (ev.key === 'Enter' && this.pick) {
      ev.preventDefault()
      ev.stopPropagation()
      this._finish(this.pick)
    }
  }

  _onDrag(ev) {
    if (this.active && !this._mio(ev)) ev.preventDefault()
  }

  _onDown(ev) {
    if (!this.active || this._mio(ev)) return
    // Sólo se bloquea el arranque del gesto sobre una imagen; sobre texto haría
    // imposible seleccionar, que es justo lo que queremos permitir.
    if (mediaBajo(ev.target)) ev.preventDefault()
  }

  _onClick(ev) {
    if (!this.active || this._mio(ev)) return
    // Los clics de la página no llegan a la página: en Confluence casi todo es
    // un enlace, y navegar a mitad de una selección la tira por la borda.
    ev.preventDefault()
    ev.stopPropagation()

    const media = mediaBajo(ev.target)
    if (media) this._elegirImagen(media)
  }

  _onMove(ev) {
    if (!this.active || this._mio(ev)) return
    const media = mediaBajo(ev.target)
    if (media === this.hoverEl) return
    this.hoverEl = media
    if (media) this.overlay.pickHover(media.getBoundingClientRect())
    else this.overlay.hidePickHover()
  }

  _onUp(ev) {
    if (!this.active || this._mio(ev)) return
    // El navegador termina de fijar la selección justo después del mouseup.
    setTimeout(() => this._leerSeleccion(), 0)
  }

  // ------------------------------------------------------------ lo elegido

  _leerSeleccion() {
    if (!this.active) return
    const sel = document.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return

    const texto = sel.toString()
    if (!texto.trim()) return

    const range = sel.getRangeAt(0)
    const { prefix, suffix } = affixes(range, texto)

    const pick = buildTextPick({
      text: texto,
      prefix,
      suffix,
      heading: nearestHeading(range.startContainer),
      pageTitle: document.title,
      url: location.href,
    })
    if (!pick) return

    this.pick = pick
    this.overlay.clearOutlines()
    this._paintBar()
  }

  async _elegirImagen(el) {
    const figura = el.closest?.('figure') || el
    const image = await captureImage(el)

    const pick = buildImagePick({
      alt: el.getAttribute?.('alt') || figura.querySelector?.('img')?.getAttribute('alt') || '',
      imageTitle: el.getAttribute?.('title') || '',
      caption: textoDe(figura.querySelector?.('figcaption')),
      src: el.getAttribute?.('src') || figura.querySelector?.('img')?.getAttribute('src') || '',
      around: alrededorDe(figura),
      heading: nearestHeading(figura),
      pageTitle: document.title,
      url: location.href,
      image,
    })

    if (!pick) return
    this.pick = pick
    this.overlay.outlineElements([figura])
    this._paintBar()
  }
}

// --------------------------------------------------------------- ayudantes

function resumen(pick) {
  if (pick.kind === 'image') {
    const que = pick.alt || pick.caption || pick.filename || 'imagen'
    return `Imagen: ${que}${pick.image ? '' : ' (sólo la descripción)'}`
  }
  const t = pick.text.replace(/\s+/g, ' ')
  return `«${t.slice(0, 90)}${t.length > 90 ? '…' : ''}»`
}

/** El elemento de imagen bajo el puntero, si lo hay. */
export function mediaBajo(target) {
  const el = target?.closest?.(MEDIA)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // Los iconos no son imágenes que nadie quiera preguntar.
  if (r.width < 24 || r.height < 24) return null
  // Con un <figure> gana el <figure>: lleva el pie, que suele ser lo que
  // explica el diagrama.
  return el.closest('figure') || el
}

function textoDe(el) {
  return el ? (el.innerText || el.textContent || '').trim() : ''
}

/** Lo que hay escrito justo alrededor de una figura. */
function alrededorDe(el) {
  const trozos = []
  for (const lado of ['previousElementSibling', 'nextElementSibling']) {
    let cur = el[lado]
    for (let i = 0; cur && i < 3 && trozos.join(' ').length < PICK_LIMITS.aroundMax; i++) {
      const t = textoDe(cur)
      if (t) trozos.push(t)
      cur = cur[lado]
    }
  }
  return trozos.join('\n')
}

/**
 * Lo escrito justo antes y después de lo seleccionado.
 * Sirve para dos cosas: darle contexto al modelo, y poder volver a anclar la
 * cita más tarde sin depender de que el texto sea único en la página.
 */
export function affixes(range, texto) {
  const nodo = range.startContainer
  const el = nodo?.nodeType === 1 ? nodo : nodo?.parentElement
  const bloque = el?.closest?.(BLOQUES) || el
  const todo = bloque ? bloque.innerText || bloque.textContent || '' : ''

  const i = todo.indexOf(texto)
  if (i < 0) return { prefix: '', suffix: '' }

  return {
    prefix: todo.slice(Math.max(0, i - PICK_LIMITS.affixMax), i),
    suffix: todo.slice(i + texto.length, i + texto.length + PICK_LIMITS.affixMax),
  }
}

/** El encabezado que manda sobre este punto de la página. */
export function nearestHeading(nodo) {
  let el = nodo?.nodeType === 1 ? nodo : nodo?.parentElement

  for (let i = 0; el && i < 40; i++) {
    if (el.matches?.(HEADINGS)) return textoDe(el)

    let prev = el.previousElementSibling
    for (let j = 0; prev && j < 60; j++) {
      if (prev.matches?.(HEADINGS)) return textoDe(prev)
      const dentro = prev.querySelectorAll?.(HEADINGS)
      if (dentro?.length) return textoDe(dentro[dentro.length - 1])
      prev = prev.previousElementSibling
    }

    el = el.parentElement
  }
  return ''
}

/**
 * La imagen, de verdad, como data URL.
 *
 * Puede fallar por motivos legítimos —una imagen servida desde otro origen
 * contamina el canvas y `toDataURL` lanza—, y cuando falla no pasa nada: queda
 * la descripción. Preferir quedarse sin imagen a quedarse sin selección.
 */
export async function captureImage(el) {
  try {
    if (el.tagName === 'IMG') return fromImg(el)
    if (el.tagName === 'CANVAS') return fromCanvas(el)
    if (el.tagName === 'svg' || el.ownerSVGElement !== undefined) {
      const svg = el.tagName === 'svg' ? el : el.querySelector?.('svg')
      if (svg) return await fromSvg(svg)
    }
    const img = el.querySelector?.('img')
    if (img) return fromImg(img)
    const svg = el.querySelector?.('svg')
    if (svg) return await fromSvg(svg)
    const canvas = el.querySelector?.('canvas')
    if (canvas) return fromCanvas(canvas)
  } catch {
    /* contaminado, sin soporte, o la imagen no había cargado */
  }
  return null
}

function lienzoPara(w, h) {
  const escala = Math.min(1, PICK_LIMITS.imageSide / Math.max(w, h, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * escala))
  canvas.height = Math.max(1, Math.round(h * escala))
  return canvas
}

function exportar(canvas, filename) {
  let url = canvas.toDataURL('image/png')
  if (url.length > PICK_LIMITS.imageBytes) url = canvas.toDataURL('image/jpeg', 0.82)
  if (url.length > PICK_LIMITS.imageBytes * 1.4) return null
  return {
    url,
    filename: filename || 'seleccion.png',
    width: canvas.width,
    height: canvas.height,
  }
}

function fromImg(img) {
  if (!img.naturalWidth || !img.naturalHeight) return null
  const canvas = lienzoPara(img.naturalWidth, img.naturalHeight)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return exportar(canvas, 'seleccion.png')
}

function fromCanvas(el) {
  const canvas = lienzoPara(el.width, el.height)
  canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height)
  return exportar(canvas, 'seleccion.png')
}

/** Un SVG se rasteriza: casi ningún modelo lee SVG, y un PNG lo ve cualquiera. */
function fromSvg(svg) {
  const r = svg.getBoundingClientRect()
  const texto = new XMLSerializer().serializeToString(svg)
  const fuente = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(texto)

  return new Promise((resolve) => {
    const img = new Image()
    const fallo = () => resolve(null)
    img.onerror = fallo
    img.onload = () => {
      try {
        const canvas = lienzoPara(img.width || r.width, img.height || r.height)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(exportar(canvas, 'diagrama.png'))
      } catch {
        fallo()
      }
    }
    setTimeout(fallo, 4000)
    img.src = fuente
  })
}
