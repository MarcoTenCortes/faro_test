/**
 * Utilidades de página para sobrevivir a una SPA.
 *
 * Jira y Confluence no recargan: cambian la URL con pushState y remontan
 * trozos del árbol. Nada de lo que hace Faro puede asumir que la página ya
 * está lista sólo porque haya disparado `load`.
 */

import { isScrollable } from './tree-dom.js'
import { STICKY_CACHE_MS } from '../shared/config.js'

/** Selectores del contenedor de contenido, del más específico al más laxo. */
const CONTENT_ROOTS = [
  '[data-testid="page-content"]',
  '#content .wiki-content',
  '.ak-renderer-document',
  '[data-test-id="ak-renderer-document"]',
  '#main-content',
  'main [role="main"]',
  '[role="main"]',
  'main',
]

export function contentRoot() {
  for (const sel of CONTENT_ROOTS) {
    const el = document.querySelector(sel)
    if (el && el.textContent && el.textContent.trim().length > 40) return el
  }
  return document.body
}

/** Lo último que midió `stickyOffset`, con cuándo y con qué ventana. */
let sticky = { at: -Infinity, ancho: 0, alto: 0, valor: 0 }

/**
 * Alto de las cabeceras pegajosas que hay ahora mismo arriba.
 *
 * Sin esto, `scrollIntoView` deja el objetivo escondido debajo de la barra de
 * Confluence. Es el fallo más habitual de las extensiones que resaltan cosas,
 * así que se mide de verdad en vez de codificar un número.
 *
 * Medirlo cuesta: hasta 400 elementos con un `getComputedStyle` cada uno, y un
 * solo desplazamiento lo pide dos veces (`scrollToElement` y, dentro de él,
 * `scrollToRect`). La medida vale `STICKY_CACHE_MS`, que es mucho menos de lo
 * que tarda la cabecera en cambiar de sitio, y se descarta en cuanto cambia el
 * tamaño de la ventana —que es cuando de verdad cambia la barra— sin necesidad
 * de un oyente de `resize`: este módulo no puede tocar `window` al importarse,
 * porque lo importan los tests en Node. Reloj monótono (`performance.now`).
 *
 * Límite asumido: una barra que aparece o se esconde al desplazarse puede
 * quedar hasta `STICKY_CACHE_MS` desactualizada, y el destino queda unos pocos
 * píxeles más alto o más bajo de lo ideal; `scrollToRect` ya deja 24 px de
 * holgura y nadie vuelve a leer este número para decidir nada.
 */
export function stickyOffset() {
  const ahora = performance.now()
  const ancho = window.innerWidth
  const alto = window.innerHeight
  if (ahora - sticky.at < STICKY_CACHE_MS && sticky.ancho === ancho && sticky.alto === alto) return sticky.valor

  let max = 0
  const candidates = document.querySelectorAll('header, nav, div, [role="banner"], [data-testid*="header" i]')
  let checked = 0
  for (const el of candidates) {
    if (checked++ > 400) break
    const style = getComputedStyle(el)
    if (style.position !== 'fixed' && style.position !== 'sticky') continue
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.top <= 2 && r.height > 8 && r.height < 200 && r.width > ancho * 0.5) {
      max = Math.max(max, r.bottom)
    }
  }
  sticky = { at: ahora, ancho, alto, valor: Math.min(max, 200) }
  return sticky.valor
}

/**
 * Desplaza dejando el objetivo por debajo de la cabecera pegajosa.
 *
 * Comprueba que el desplazamiento ha ocurrido de verdad. Hay más sitios de los
 * que parece donde `behavior: 'smooth'` no hace nada —una hoja de estilos que
 * fuerza `scroll-behavior`, un contenedor que se come el scroll, un navegador
 * sin composición— y quedarse sin desplazar sin enterarse es peor que dar un
 * salto seco.
 */
export async function scrollToRect(rect, { extra = 24, behavior = 'smooth' } = {}) {
  const offset = stickyOffset() + extra
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const target = Math.max(0, Math.min(window.scrollY + rect.top - offset, max))

  if (Math.abs(window.scrollY - target) < 4) return true

  window.scrollTo({ top: target, behavior })
  if (behavior !== 'smooth') return true

  await sleep(340)
  if (Math.abs(window.scrollY - target) > 24) {
    window.scrollTo({ top: target, behavior: 'auto' })
    await sleep(40)
  }
  return Math.abs(window.scrollY - target) <= 24
}

/**
 * Desplaza los contenedores con scroll propio que envuelven al elemento.
 *
 * La barra lateral de Confluence tiene su propio scroll. Mover sólo la ventana
 * deja el objetivo fuera de la vista aunque la página esté bien colocada: es
 * justo lo que hacía que el recorrido guiado pareciera que no hacía nada,
 * porque las ramas se abrían por debajo del borde visible del árbol.
 */
export async function scrollWithinScrollers(el, { behavior = 'smooth', margin = 24 } = {}) {
  if (!el) return false

  // De dentro afuera, y sin tope corto: la vista de incidencia de un Jira
  // Data Center anida el contenido a más de doce niveles.
  const cajas = []
  let cur = el.parentElement
  for (let i = 0; cur && i < 40; i++) {
    if (isScrollable(cur)) cajas.push(cur)
    cur = cur.parentElement
  }

  let movido = false
  const suaves = []
  cajas.forEach((caja, k) => {
    const r = el.getBoundingClientRect()
    const b = caja.getBoundingClientRect()
    // Si ya está holgadamente dentro, no se toca: moverlo por moverlo marea.
    if (r.top >= b.top + margin && r.bottom <= b.bottom - margin) return

    const delta = r.top + r.height / 2 - (b.top + b.height / 2)
    const max = Math.max(0, caja.scrollHeight - caja.clientHeight)
    const destino = Math.max(0, Math.min(caja.scrollTop + delta, max))
    if (Math.abs(destino - caja.scrollTop) < 4) return

    // Los contenedores interiores se mueven de golpe: el siguiente —el de
    // fuera— mide dónde ha QUEDADO el elemento, y con un desplazamiento suave
    // a medias medía dónde estaba y se pasaba de largo (pasó de verdad con la
    // incidencia de un Jira dentro de un panel con scroll propio). Sólo el de
    // más afuera va suave, y se comprueba que llegó.
    const suave = behavior === 'smooth' && k === cajas.length - 1
    try {
      caja.scrollTo({ top: destino, behavior: suave ? 'smooth' : 'auto' })
    } catch {
      caja.scrollTop = destino
    }
    if (suave) suaves.push({ caja, destino })
    movido = true
  })

  if (suaves.length) {
    await sleep(320)
    for (const { caja, destino } of suaves) if (Math.abs(caja.scrollTop - destino) > 24) caja.scrollTop = destino
    await sleep(40)
  } else if (movido) {
    await sleep(40)
  }
  return movido
}

export async function scrollToElement(el, opts) {
  // Primero el scroll propio del árbol; luego el de la ventana. Al revés, la
  // ventana se coloca sobre una posición que el scroller interno va a cambiar.
  const dentro = await scrollWithinScrollers(el, opts)

  const r = el.getBoundingClientRect()
  // Si ya está cómodamente visible, no se mueve la página: dar un salto
  // innecesario desorienta más que ayuda.
  const top = stickyOffset() + 12
  if (r.top >= top && r.bottom <= window.innerHeight - 12) return dentro
  await scrollToRect(r, opts)
  return true
}

/** Espera a que el DOM deje de cambiar durante `quietMs`. */
export function waitForSettle({ quietMs = 220, maxMs = 6000, root = document.body } = {}) {
  return new Promise((resolve) => {
    if (!root) return resolve('sin-raiz')
    let quiet
    const started = Date.now()

    const done = (reason) => {
      clearTimeout(quiet)
      clearTimeout(hard)
      observer.disconnect()
      resolve(reason)
    }

    const bump = () => {
      clearTimeout(quiet)
      quiet = setTimeout(() => done('quieto'), quietMs)
    }

    const observer = new MutationObserver(bump)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    const hard = setTimeout(() => done('tope'), Math.max(quietMs, maxMs - (Date.now() - started)))
    bump()
  })
}

/** Reintenta `fn` hasta que devuelva algo con valor, o se agote el tiempo. */
export async function waitFor(fn, { timeout = 2500, interval = 90 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      const v = fn()
      if (v) return v
    } catch {
      /* la página puede estar a medio montar */
    }
    if (Date.now() >= deadline) return null
    await sleep(interval)
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * ¿Estamos en el editor de Confluence?
 * Si lo estamos, Faro se aparta: tocar nada mientras se edita es pedir
 * problemas, y resaltar sobre un editor controlado no funciona de forma fiable.
 */
export function isEditing() {
  if (/\/edit(-v2)?\//.test(location.pathname)) return true
  // El editor de comentarios de una incidencia no es editar la incidencia:
  // escribir un comentario mientras se analiza es el uso normal en Jira, y
  // además ese módulo no se lee (SKIP_MODULES). Se mira cualquier editor
  // abierto, no sólo el primero: el de comentarios suele ir el último.
  for (const ce of document.querySelectorAll('[contenteditable="true"]')) {
    if (ce.closest(COMMENT_EDITORS)) continue
    if (ce.getBoundingClientRect().height > 120) return true
  }
  return false
}

/** Dónde vive el editor de comentarios: Jira Data Center, Jira Cloud, Confluence. */
const COMMENT_EDITORS = '#addcomment, #footer-comment-button, [data-testid*="comment" i], .quick-comment-container, #comments-section'

/**
 * Avisa cuando cambia la URL, incluidos los cambios por pushState que no
 * disparan ningún evento estándar.
 */
export function onUrlChange(callback) {
  let last = location.href
  const check = () => {
    if (location.href !== last) {
      const from = last
      last = location.href
      callback(location.href, from)
    }
  }

  const wrap = (name) => {
    const original = history[name]
    if (!original || original.__faroWrapped) return
    const patched = function (...args) {
      const r = original.apply(this, args)
      queueMicrotask(check)
      return r
    }
    patched.__faroWrapped = true
    history[name] = patched
  }
  wrap('pushState')
  wrap('replaceState')

  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)
  const poll = setInterval(check, 700) // red de seguridad para routers raros

  return () => {
    window.removeEventListener('popstate', check)
    window.removeEventListener('hashchange', check)
    clearInterval(poll)
  }
}
