/**
 * Ejecutor de la navegación dentro de la página.
 *
 * Ejecuta UN paso por llamada, no el recorrido entero. Quien lleva la cuenta
 * es el service worker, y la razón es que un paso puede recargar la página
 * entera: si el bucle viviera aquí, moriría a mitad del recorrido. Así, el
 * content script vuelve a arrancar, pregunta «¿había algo pendiente?» y sigue
 * donde estaba.
 */

import { Overlay } from './overlay/overlay.js'
import { resolveAnchor, rangeRect, imagesWithin } from './anchor.js'
import { pageDigest, resolveBlockQuote, digestScope, resolveScopedQuote } from './digest.js'
import { locateStep, isSafeToClick, clickableAncestor, treeToggleFor, isExpanded } from './locators.js'
import { treeContainer, expandersIn, rowFor } from './tree-dom.js'
import {
  waitFor,
  waitForSettle,
  scrollToElement,
  scrollToRect,
  scrollWithinScrollers,
  contentRoot,
  isEditing,
  sleep,
} from './dom-utils.js'

export const STEP_RESULT = {
  CLICKED: 'clicked',
  NAVIGATE: 'navigate', // no se pudo pulsar: que navegue el service worker
  EXPANDED: 'expanded', // se desplegó una rama del árbol; no se navegó
  NOT_FOUND: 'not-found',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  DONE: 'done',
}

export class NavRunner {
  constructor(options = {}) {
    this.overlay = new Overlay()
    this.timing = options.timing || {}
    this.origin = location.origin
    this.cancelled = false
    this.stillMotion = false
    this._resolveWait = null
  }

  setReducedMotion(on) {
    this.stillMotion = !!on
    this.overlay.setReducedMotion(on)
  }

  /** @param {'spotlight'|'marker'} style */
  setHighlightStyle(style) {
    this.overlay.setStyle(style)
  }

  /** Cómo desplazarse: seco si el usuario pidió menos animación. */
  get behavior() {
    return this.stillMotion ? 'auto' : 'smooth'
  }

  cancel(reason = 'user') {
    this.cancelled = true
    this._settle({ status: STEP_RESULT.CANCELLED, reason })
    this.overlay.clearAll()
  }

  /** Resuelve la espera en curso, si la hay. Llamarlo dos veces no hace nada. */
  _settle(value) {
    this._resolveWait?.(value)
  }

  /**
   * Espera a que el usuario decida, o a que venza la pausa automática.
   * Sólo gana la primera resolución: el resto se descarta.
   */
  _await(ms) {
    return new Promise((resolve) => {
      let timer = 0
      const finish = (value) => {
        if (this._resolveWait !== finish) return
        this._resolveWait = null
        clearTimeout(timer)
        resolve(value)
      }
      this._resolveWait = finish
      if (ms) timer = setTimeout(() => finish({ status: 'auto' }), ms)
    })
  }

  /**
   * Ejecuta un paso de la navegación asistida.
   * @param {{step:object, index:number, total:number, isLast:boolean}} msg
   */
  async executeStep({ step, index, total, isLast }) {
    this.cancelled = false
    this.overlay.mount()
    this.overlay.onCancel = () => this.cancel('escape')

    if (isEditing()) {
      this.overlay.toast('Estás editando la página; Faro se aparta para no molestar.')
      return { status: STEP_RESULT.CANCELLED, reason: 'editando' }
    }

    // Si ya estamos donde lleva este paso, no hay nada que pulsar. Ojo: sólo
    // vale para los pasos que NAVEGAN. En uno de desplegar, estar en esa
    // página no significa que su rama del árbol esté abierta.
    if (step.action !== 'expand' && isAlreadyHere(step)) {
      return { status: STEP_RESULT.CLICKED, note: 'ya estábamos aquí' }
    }

    const desplegando = step.action === 'expand'
    const timeout = this.timing.locateTimeoutMs ?? 2500
    const found = await waitFor(() => locateStep(step, document), { timeout })

    if (!found) {
      // Una rama INTERMEDIA que no aparece se salta y ya está. Antes se ofrecía
      // el salto directo, y aceptarlo recargaba la página entera: el árbol se
      // plegaba de golpe y el recorrido se quedaba sin base justo a la mitad.
      // El barrido a ciegas y el respaldo se guardan para el destino, que es el
      // único paso que de verdad tiene que llegar.
      if (desplegando) return { status: STEP_RESULT.SKIPPED, reason: 'esa rama no está en el árbol' }

      const expanded = await this._tryExpandTowards(step)
      if (expanded) {
        const retry = await waitFor(() => locateStep(step, document), { timeout: 1200 })
        if (retry) return this._presentAndClick(retry, { step, index, total, isLast })
      }
      return this._offerFallback(step, index, total)
    }

    if (desplegando) return this._expandStep(found, { step, index, total, isLast })
    return this._presentAndClick(found, { step, index, total, isLast })
  }

  /**
   * Paso de DESPLEGAR: abre una rama del árbol lateral sin salir de la página.
   *
   * Es lo que de verdad significa «guiar por el árbol»: no abrir ocho páginas
   * seguidas, sino ir desplegando las ramas de la izquierda hasta dejar el
   * destino a la vista. Sólo el último paso navega.
   */
  async _expandStep(found, { step, index, total, isLast }) {
    const fila = clickableAncestor(found.element)
    const toggle = treeToggleFor(found.element) || treeToggleFor(fila)

    // Sin control de desplegar no hay rama que abrir: se resalta y se sigue.
    if (!toggle) {
      await this._flash(fila, { step, index, total, texto: 'Esta rama ya está a la vista.' })
      return { status: STEP_RESULT.EXPANDED, note: 'sin control de desplegar' }
    }

    if (toggle.expanded) {
      // Corta a propósito: con siete niveles, siete carteles de un segundo son
      // medio minuto mirando cómo Faro confirma lo que ya estaba hecho.
      await this._flash(toggle.row || toggle.toggle, { step, index, total, breve: true })
      return { status: STEP_RESULT.EXPANDED, note: 'ya estaba abierta' }
    }

    // El árbol tiene su propio scroll: sin esto la rama se abre por debajo del
    // borde visible y parece que no ha pasado nada.
    await this._traerALaVista(toggle.row || toggle.toggle)
    await sleep(this.timing.scrollSettleMs ?? 340)

    const marca = toggle.row || toggle.toggle
    const rect = marca.getBoundingClientRect()
    this.overlay.spotlight(rect, { padding: 6 })
    this.overlay.follow(marca, { padding: 6 })

    const pause = this.timing.expandPauseMs ?? Math.round((this.timing.stepPauseMs ?? 1600) * 0.6)
    const decision = await this._presentCard({
      step,
      index,
      total,
      rect,
      isLast,
      pause,
      accion: 'expand',
    })
    this.overlay.unfollow()

    if (decision.status === STEP_RESULT.CANCELLED) {
      this.overlay.clearAll()
      return decision
    }
    if (decision.status === STEP_RESULT.SKIPPED) {
      this.overlay.hideSpot()
      return { status: STEP_RESULT.SKIPPED }
    }

    this.overlay.hideCard()
    const abierto = await this._abrirRama(toggle)
    this.overlay.hideSpot()

    return abierto
      ? { status: STEP_RESULT.EXPANDED }
      : { status: STEP_RESULT.EXPANDED, note: 'no he podido desplegarla' }
  }

  /**
   * Abre una rama y COMPRUEBA que se abrió.
   *
   * Pulsar y dar por hecho no vale: si el control no reacciona al clic, el
   * recorrido sigue como si nada y el usuario acaba desplegando a mano. Se
   * intenta el clic, y si no, el teclado, que es como manda ARIA para un árbol.
   */
  async _abrirRama(toggle) {
    const control = toggle.toggle

    // Pulsar la fila entera es lo último que se prueba: suele navegar en vez
    // de desplegar. El chevron propio es seguro.
    if (!toggle.isRow) {
      const safe = isSafeToClick(control, this.origin)
      if (safe.ok) {
        control.click()
        if (await this._esperaDespliegue(control)) return true
      }
    }

    // Teclado: en un árbol ARIA, la flecha derecha despliega la fila con foco.
    try {
      const fila = toggle.row || control
      fila.focus?.({ preventScroll: true })
      for (const key of ['ArrowRight', 'Enter']) {
        fila.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        if (await this._esperaDespliegue(control)) return true
      }
    } catch {
      /* si el navegador no deja, se prueba lo siguiente */
    }

    // Último recurso: pulsar la propia fila.
    if (toggle.isRow) {
      control.click()
      if (await this._esperaDespliegue(control)) return true
    }

    return false
  }

  async _esperaDespliegue(control, ms = 1800) {
    const hasta = Date.now() + ms
    while (Date.now() < hasta) {
      if (isExpanded(control)) {
        await waitForSettle({ quietMs: 150, maxMs: 2000 })
        return true
      }
      await sleep(90)
    }
    return false
  }

  /**
   * Deja un elemento a la vista: primero dentro del árbol, que tiene su propio
   * scroll, y luego dentro de la ventana, por debajo de la cabecera pegajosa.
   */
  async _traerALaVista(el) {
    if (!el) return false
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    } catch {
      /* navegadores viejos */
    }
    return scrollToElement(el, { behavior: this.behavior })
  }

  /**
   * Marca algo un instante, sin pulsarlo: el paso ya estaba cumplido.
   *
   * En modo `breve` sólo destella, sin cartel: un recorrido de siete niveles ya
   * abiertos no puede costar siete segundos de carteles que no dicen nada.
   */
  async _flash(el, { step, index, total, texto, breve = false }) {
    if (!el) return
    await this._traerALaVista(el)
    const rect = el.getBoundingClientRect()
    this.overlay.spotlight(rect, { padding: 6, breathe: false })

    if (!breve) {
      this.overlay.showCard({
        kicker: 'Navegación asistida',
        count: `${index + 1} / ${total}`,
        title: step.label || step.title,
        text: texto,
        near: rect,
        progressMs: 900,
        actions: [],
      })
    }

    await sleep(breve ? 420 : 1000)
    if (!breve) this.overlay.hideCard()
    this.overlay.hideSpot()
  }

  /**
   * Despliega el árbol lateral hasta encontrar el destino.
   *
   * Una sola pasada no basta: en un Confluence real la página puede estar a
   * seis niveles («Architecture → D1.3.x → Application Architecture →
   * Components Views → ACV Domain 1 → Static Views → la página»), y cada nivel
   * sólo aparece después de desplegar el anterior. Así que esto itera:
   * despliega, mira si ya está, y vuelve a empezar con lo que acaba de salir.
   *
   * No va a ciegas: en cada ronda prioriza las ramas cuyo nombre comparte
   * palabras con el destino, que es como lo haría una persona.
   */
  async _tryExpandTowards(step) {
    const t0 = Date.now()
    const budgetMs = this.timing.expandBudgetMs ?? 15000
    const maxClicks = this.timing.maxExpandClicks ?? 40
    const tried = new WeakSet()
    const claves = targetKeywords(step)
    const container = treeContainer()
    let clicks = 0

    // Sin contenedor no hay árbol que abrir. Antes esto ni se miraba: el
    // barrido buscaba ramas en `[role=tree], nav, aside`, y la barra lateral de
    // un Confluence real no está en ninguno de los tres, así que no encontraba
    // nada y el recorrido se rendía sin haber tocado el árbol.
    if (!container) return !!locateStep(step, document)

    for (let ronda = 0; ronda < 10; ronda++) {
      if (this.cancelled) return false
      if (locateStep(step, document)) return true
      if (Date.now() - t0 > budgetMs || clicks >= maxClicks) break

      const candidatos = rankedExpanders(claves, tried, container)
      if (!candidatos.length) break

      let pulsadosEstaRonda = 0
      for (const btn of candidatos.slice(0, 8)) {
        if (clicks >= maxClicks || Date.now() - t0 > budgetMs) break
        if (!isSafeToClick(btn, this.origin).ok) continue

        tried.add(btn)

        // Que se vea lo que pasa. Sólo se mueve la barra lateral: desplazar
        // además la página en cada uno de los cuarenta clics del barrido
        // marearía, y aquí lo que interesa es el árbol.
        await scrollWithinScrollers(btn, { behavior: 'auto' })
        const fila = rowFor(btn, container) || btn
        this.overlay.spotlight(fila.getBoundingClientRect(), {
          padding: 6,
          breathe: false,
          draw: false,
        })

        btn.click()
        clicks++
        pulsadosEstaRonda++
        await sleep(120)

        if (locateStep(step, document)) {
          await waitForSettle({ quietMs: 140, maxMs: 1200 })
          this.overlay.hideSpot()
          return true
        }
      }

      // Si en una ronda entera no se pudo desplegar nada nuevo, no hay más
      // árbol que abrir: insistir sólo gastaría tiempo.
      if (!pulsadosEstaRonda) break
      await waitForSettle({ quietMs: 140, maxMs: 1500 })
    }

    this.overlay.hideSpot()
    return !!locateStep(step, document)
  }

  async _presentAndClick(found, { step, index, total, isLast }) {
    const target = clickableAncestor(found.element)
    // El árbol lateral tiene su propio scroll: sin esto, el objetivo puede
    // quedarse fuera de la vista aunque la ventana esté bien colocada.
    await this._traerALaVista(target)
    await sleep(this.timing.scrollSettleMs ?? 340)

    const rect = target.getBoundingClientRect()
    this.overlay.spotlight(rect)
    this.overlay.follow(target)

    const pause = this.timing.stepPauseMs ?? 1600
    const decision = await this._presentCard({
      step,
      index,
      total,
      rect,
      isLast,
      pause,
      strategy: found.by,
    })

    this.overlay.unfollow()

    if (decision.status === STEP_RESULT.CANCELLED) {
      this.overlay.clearAll()
      return decision
    }
    if (decision.status === STEP_RESULT.SKIPPED) {
      this.overlay.hideSpot()
      return { status: STEP_RESULT.SKIPPED }
    }

    const safe = isSafeToClick(target, this.origin)
    if (!safe.ok) {
      // No es un control de navegación: mejor ir por URL que pulsar a ciegas.
      this.overlay.hideSpot()
      return { status: STEP_RESULT.NAVIGATE, reason: safe.reason }
    }

    target.click()
    this.overlay.hideCard()
    this.overlay.hideSpot()

    await waitForSettle({
      quietMs: this.timing.settleQuietMs ?? 220,
      maxMs: this.timing.settleMaxMs ?? 6000,
    })

    return { status: STEP_RESULT.CLICKED, url: location.href }
  }

  _presentCard({ step, index, total, rect, isLast, pause, strategy, accion }) {
    const desplegando = accion === 'expand'
    const promise = this._await(pause)
    this.overlay.showCard({
      kicker: desplegando ? 'Desplegando el árbol' : isLast ? 'Último paso' : 'Navegación asistida',
      count: `${index + 1} / ${total}`,
      title: step.label || step.title,
      text: desplegando
        ? 'Abro esta rama para llegar a la siguiente.'
        : isLast
          ? 'Aquí es donde está lo que te contaba.'
          : 'Voy a abrir esto para seguir el camino.',
      near: rect,
      progressMs: pause,
      actions: [
        { label: desplegando ? 'Desplegar' : 'Ir', kind: 'primary', onClick: () => this._settle({ status: 'auto' }) },
        { label: 'Saltar', onClick: () => this._settle({ status: STEP_RESULT.SKIPPED }) },
        {
          label: 'Cancelar',
          spacerBefore: true,
          onClick: () => this._settle({ status: STEP_RESULT.CANCELLED, reason: 'user' }),
        },
      ],
    })
    if (strategy && strategy !== 'href') {
      // Transparencia: si tuvimos que recurrir a una pista más frágil, se dice.
      console.debug('[faro] paso localizado por', strategy)
    }
    return promise
  }

  /** Un paso que no aparece no bloquea: se ofrece el salto directo. */
  _offerFallback(step, index, total) {
    // Tras 12 s sin respuesta se degrada solo a navegación directa, que
    // siempre funciona porque es una URL.
    const decision = this._await(12000)
    this.overlay.showCard({
      kicker: 'No encuentro este paso',
      count: `${index + 1} / ${total}`,
      title: step.label || step.title,
      text: 'No veo por dónde se llega desde aquí. ¿Te llevo directamente?',
      actions: [
        {
          label: 'Llévame',
          kind: 'primary',
          onClick: () => this._settle({ status: STEP_RESULT.NAVIGATE, reason: 'no localizado' }),
        },
        {
          label: 'Cancelar',
          spacerBefore: true,
          onClick: () => this._settle({ status: STEP_RESULT.CANCELLED, reason: 'user' }),
        },
      ],
    })
    return decision.then((d) =>
      d.status === 'auto' ? { status: STEP_RESULT.NAVIGATE, reason: 'sin respuesta' } : d
    )
  }

  /**
   * Último tramo: resaltar la parte concreta dentro de la página de destino.
   * @param {{anchor:object, explanation:string, title:string}} msg
   */
  async applyAnchor({ anchor, explanation, title }) {
    this.overlay.mount()
    this.overlay.onCancel = () => {
      this.overlay.clearAll()
    }

    if (isEditing()) {
      this.overlay.toast('Estás en el editor: no resalto nada para no interferir.')
      return { status: STEP_RESULT.DONE, note: 'editando' }
    }

    // La página puede estar todavía montándose tras la navegación.
    await waitForSettle({ quietMs: 220, maxMs: 4000 })
    await waitFor(() => contentRoot()?.textContent?.trim()?.length > 40, { timeout: 3000 })

    const resolved = resolveAnchor(anchor)

    if (!resolved.ok) {
      // Rendirse bien: se enseña la página y se dice la verdad.
      const root = resolved.element || contentRoot()
      if (root) {
        await scrollToElement(root, { behavior: this.behavior })
        await sleep(160)
        this.overlay.spotlight(root.getBoundingClientRect(), { padding: 6, breathe: false, scrim: false })
        setTimeout(() => this.overlay.hideSpot(), 1600)
      }
      this.overlay.toast(resolved.message || 'No he podido localizar el fragmento exacto.')
      return { status: STEP_RESULT.DONE, anchored: false, message: resolved.message }
    }

    if (resolved.ranges?.length) {
      if (await scrollToRange(resolved.ranges[0], { extra: 90, behavior: this.behavior })) await sleep(60)
      // Al llegar NO se oscurece la página. El foco sirve para guiarte por el
      // árbol, donde hay que ver dónde va el siguiente clic; una vez estás
      // delante de lo que buscabas, oscurecer tapa justo lo que has venido a
      // leer. Basta con el subrayado, que ya trae su barrido para llamar la
      // atención, y el filete de las imágenes.
      this.overlay.hideSpot()
      this.overlay.highlightRanges(resolved.ranges)
      // Dentro de un <img> no hay Range que valga: las imágenes de lo anclado
      // se rodean con un filete fino, que es lo único que las marca.
      this.overlay.outlineElements(imagesWithin(resolved.element))

      if (resolved.approximate) {
        this.overlay.toast('El texto ha cambiado un poco desde que lo indexé; te marco lo más parecido.')
      } else if (explanation) {
        this.overlay.toast(explanation, { ms: 6000 })
      }
    } else if (resolved.element) {
      await scrollToElement(resolved.element, { behavior: this.behavior })
      await sleep(120)
      this.overlay.spotlight(resolved.element.getBoundingClientRect(), {
        padding: 8,
        breathe: false,
        scrim: false,
      })
      // Sólo si el ancla apuntaba a algo concreto: cuando lo que se resalta es
      // la página entera, rodear todas sus imágenes es ruido, no una señal.
      if (resolved.strategy !== 'page') this.overlay.outlineElements(imagesWithin(resolved.element))
      setTimeout(() => this.overlay.hideSpot(), 3400)
      if (explanation) this.overlay.toast(explanation, { ms: 6000 })
    }

    return { status: STEP_RESULT.DONE, anchored: true, strategy: resolved.strategy, title }
  }

  /**
   * Marca en la página las observaciones de un análisis.
   *
   * Cada una lleva su número, y el número es el mismo que usa la respuesta del
   * chat: es lo que hace que «el punto 3» signifique algo. Las que no se
   * pueden anclar se devuelven aparte en vez de marcarse en cualquier sitio,
   * que sería peor que no marcarlas.
   *
   * @param {{notes: Array<{n:number, title?:string, anchor:object}>}} msg
   * @returns {{ok:boolean, placed:number[], missed:number[]}}
   */
  async applyNotes({ notes }) {
    this.overlay.mount()
    this.overlay.onCancel = () => this.overlay.clearAll()

    const todas = (notes || []).map((x) => x.n)

    if (isEditing()) {
      this.overlay.toast('Estás en el editor: no marco nada para no interferir.')
      return { ok: false, placed: [], missed: todas, reason: 'editando' }
    }

    await waitFor(() => contentRoot()?.textContent?.trim()?.length > 40, { timeout: 2000 })

    // La página en bloques se lee UNA vez para todas las observaciones, y de la
    // página de ahora: lo que vio el modelo pudo haberse repintado desde entonces.
    const digest = pageDigest()

    const items = []
    const missed = []
    const detail = []
    for (const nota of notes || []) {
      const resolved = resolveNote(nota, digest)
      // Un Range sin cajas no se ve: marcarlo sería decir que la observación
      // está en la página cuando no hay nada que mirar. Pasa con el texto que
      // AUI esconde para lectores y con las pestañas de campos ocultas.
      if (!resolved?.ok || !resolved.ranges?.length || !rangeRect(resolved.ranges[0])) {
        missed.push(nota.n)
        detail.push({ n: nota.n, strategy: 'none' })
        continue
      }
      items.push({ n: nota.n, title: nota.title, anchor: nota.anchor, ranges: resolved.ranges })
      detail.push({ n: nota.n, strategy: resolved.strategy, approximate: !!resolved.approximate })
    }

    this.overlay.clearNotes()
    if (!items.length) return { ok: true, placed: [], missed, detail }

    this.overlay.annotate(items)

    // A la vista de la primera, sin destacarla: al principio todas valen igual.
    if (await scrollToRange(items[0].ranges[0], { extra: 110, behavior: this.behavior })) {
      await sleep(80)
      this.overlay.refreshMarks()
    }

    return { ok: true, placed: items.map((x) => x.n), missed, detail }
  }

  /** Lleva a una observación concreta y la destaca sobre las demás. */
  async focusNote({ n }) {
    const nota = this.overlay.notes.find((x) => x.n === n)
    if (!nota) return { ok: false, reason: 'esa marca ya no está en la página' }

    // Confluence repinta su contenido cuando quiere, y un Range cuyos nodos ya
    // no están en el documento no se ve. Si pasó, se vuelve a resolver la
    // observación contra la página de ahora; si tampoco así, se dice.
    if (nota.anchor && !rangeAlive(nota.ranges[0])) {
      const resolved = resolveNote(nota, pageDigest())
      if (!resolved?.ok || !resolved.ranges?.length) {
        return { ok: false, reason: 'esa marca ya no está en la página' }
      }
      nota.ranges = resolved.ranges
      this.overlay.annotate(this.overlay.notes)
    }

    if (await scrollToRange(nota.ranges[0], { extra: 110, behavior: this.behavior })) await sleep(80)
    this.overlay.focusNote(n)
    return { ok: true }
  }

  clearNotes() {
    this.overlay.clearNotes()
    this.overlay.hideSpot()
  }

  clear() {
    this.overlay.clearAll()
  }
}

/**
 * Resuelve una observación según la clase de su ancla.
 *
 * Las del análisis apuntan a un bloque numerado de la página («¶12») y llevan
 * la escalera de `digest.js`; el resto —una cita suelta, un encabezado— siguen
 * el camino de siempre. Sin ancla no hay nada que resolver.
 */
function resolveNote(nota, digest) {
  if (!nota?.anchor) return null
  if (nota.anchor.kind === 'block-quote') return resolveBlockQuote(nota.anchor, { digest })
  // Una cita suelta se busca en el ÁMBITO de lectura cuando lo hay (una
  // incidencia de Jira): en toda la página caería en la barra de acciones o en
  // una pestaña de campos oculta. En Confluence no hay ámbito que acote y
  // sigue siendo la búsqueda de siempre, con su contexto por delante y detrás.
  if (nota.anchor.kind === 'text-quote') {
    const scope = digestScope()
    if (scope.chrome) return resolveScopedQuote(nota.anchor, { scope }) || { ok: false, strategy: 'none' }
  }
  return resolveAnchor(nota.anchor)
}

/** ¿Este Range sigue apuntando a nodos del documento, y se ve? */
function rangeAlive(range) {
  return !!range && !!range.startContainer?.isConnected && !!rangeRect(range)
}

/** El elemento en el que empieza un Range (un nodo de texto no tiene caja de scroll). */
function rangeElement(range) {
  const nodo = range?.startContainer
  if (!nodo) return null
  return nodo.nodeType === 1 ? nodo : nodo.parentElement
}

/**
 * Lleva una marca a la vista: primero los contenedores con scroll propio que
 * la envuelven, después la ventana.
 *
 * Pasó de verdad: en la vista de incidencia de un Jira Data Center el que hace
 * scroll no es la ventana sino un panel interno, y `scrollToRect` —que sólo
 * mueve la ventana— dejaba las marcas puestas pero fuera de la vista al pulsar
 * cada observación; en Confluence, donde el contenido va con la ventana,
 * funcionaba. Es lo mismo que hace `scrollToElement` para el árbol, aplicado
 * a un Range: la caja se vuelve a medir después de mover los contenedores,
 * porque cambia.
 *
 * @returns {Promise<boolean>} si hubo algo que desplazar
 */
async function scrollToRange(range, { extra = 110, behavior = 'smooth' } = {}) {
  if (!range) return false
  const el = rangeElement(range)
  const dentro = el ? await scrollWithinScrollers(el, { behavior }) : false
  const rect = rangeRect(range)
  if (!rect) return dentro
  const ventana = await scrollToRect(rect, { extra, behavior })
  return dentro || ventana
}

/**
 * ¿La URL actual ya corresponde a este paso?
 *
 * Mira la RUTA además del id. Importa por dos motivos que se dan juntos:
 * el id del índice puede no ser exacto, y Confluence renderiza la página en la
 * que ya estás como texto en negrita, sin enlace. Si no reconocemos que ya
 * hemos llegado, el ejecutor busca un enlace que no existe y anuncia que «no
 * encuentra el paso» estando justo encima.
 */
export function isAlreadyHere(step, loc = typeof location !== 'undefined' ? location : null) {
  if (!loc) return false
  const here = loc.pathname + (loc.search || '')

  if (step?.path && samePagePath(step.path, here)) return true

  const id = String(step?.id ?? '')
  if (!id) return false
  if (step.kind === 'confluence-page') {
    return here.includes(`/pages/${id}`) || here.includes(`pageId=${id}`)
  }
  if (step.kind === 'jira-issue') return here.includes(`/browse/${id}`) || here.includes(`selectedIssue=${id}`)
  if (step.kind === 'confluence-space') return here.includes(`/spaces/${id}/`) && !here.includes('/pages/')
  if (step.kind === 'jira-project') return here.includes(`/projects/${id}`)
  return false
}

/**
 * Palabras con las que reconocer las ramas que llevan al destino.
 * Salen del título y del slug de la ruta, que es donde vive el título real.
 * Pura, para poder comprobarla.
 */
export function targetKeywords(step) {
  const trozos = [step?.title, step?.label]
  if (step?.path) {
    try {
      trozos.push(decodeURIComponent(step.path.split('?')[0]))
    } catch {
      trozos.push(step.path)
    }
  }
  const palabras = new Set()
  for (const t of trozos) {
    for (const w of String(t || '').split(/[^\p{L}\p{N}]+/u)) {
      const limpio = w.toLowerCase()
      // Las de menos de tres letras y los números sueltos no distinguen nada.
      if (limpio.length >= 3 && !/^\d+$/.test(limpio)) palabras.add(limpio)
    }
  }
  return palabras
}

/** Cuántas palabras del destino aparecen en el nombre de una rama. */
export function branchScore(nombre, claves) {
  if (!nombre || !claves?.size) return 0
  let n = 0
  for (const w of String(nombre).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 3 && claves.has(w)) n++
  }
  return n
}

/**
 * Ramas plegadas del árbol, las más prometedoras primero.
 * El contenedor lo decide `tree-dom.js`, que es el único que sabe qué forma
 * tiene la barra lateral en cada versión de Confluence.
 */
function rankedExpanders(claves, tried, container) {
  const out = []
  let i = 0
  for (const btn of expandersIn(container)) {
    if (i++ > 300) break
    if (tried.has(btn)) continue

    const fila = rowFor(btn, container)
    const nombre = fila ? (fila.innerText || fila.textContent || '').slice(0, 160) : ''
    out.push({ btn, score: branchScore(nombre, claves), orden: i })
  }
  // A igual puntuación, el orden del árbol: se abre de arriba abajo, como
  // haría una persona.
  out.sort((a, b) => b.score - a.score || a.orden - b.orden)
  return out.map((x) => x.btn)
}

/** Dos rutas apuntan a la misma página, aunque cambie el slug del título. */
export function samePagePath(a, b) {
  const norm = (p) => {
    try {
      return decodeURIComponent(String(p || '').split('#')[0]).replace(/\/+$/, '').toLowerCase()
    } catch {
      return String(p || '').split('#')[0].replace(/\/+$/, '').toLowerCase()
    }
  }
  const A = norm(a)
  const B = norm(b)
  if (!A || !B) return false
  if (A === B) return true

  // El id de la página manda sobre el resto de la ruta.
  const pageId = (p) => (p.match(/\/pages\/(\d+)/) || p.match(/pageid=(\d+)/) || [])[1] || null
  const ia = pageId(A)
  const ib = pageId(B)
  if (ia && ib) return ia === ib

  // Sin id, vale que una sea prefijo de segmento de la otra: `/spaces/X`
  // contra `/spaces/X/overview`. Pero NO si la larga es una pagina: estar
  // dentro de un espacio no es estar en la portada del espacio, y confundirlo
  // hacia que el primer paso del recorrido se diera por hecho sin moverse.
  const short = A.length < B.length ? A : B
  const long = A.length < B.length ? B : A
  if (long.includes('/pages/') && !short.includes('/pages/')) return false
  return short.length > 8 && long.startsWith(short + '/')
}
