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
import { locateStep, isSafeToClick, llevaAlPaso, clickableAncestor, treeToggleFor, isExpanded } from './locators.js'
import { treeContainer, expandersIn, rowFor } from './tree-dom.js'
import { pageIdFromDom } from './page-id.js'
import { NAV_TIMING } from '../shared/config.js'
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
    // Lo que no llegue de fuera cae en NAV_TIMING (config.js), el único sitio
    // donde viven los tiempos: aquí no hay ningún número copiado.
    this.timing = options.timing || {}
    this.origin = location.origin
    this.cancelled = false
    this.cancelReason = ''
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

  /**
   * La tinta de las marcas, del ajuste «Color del subrayado» (H23): la decide y
   * la normaliza el overlay, como el estilo.
   * @param {'azul'|'ambar'} color
   */
  setHighlightColor(color) {
    this.overlay.setTint(color)
  }

  /** Cómo desplazarse: seco si el usuario pidió menos animación. */
  get behavior() {
    return this.stillMotion ? 'auto' : 'smooth'
  }

  cancel(reason = 'user') {
    this.cancelled = true
    this.cancelReason = reason
    this._settle({ status: STEP_RESULT.CANCELLED, reason })
    // Limpiar el overlay es también soltar el manejador de Escape: es el
    // overlay quien pone `onCancel = null` al limpiar (contrato de M2, abajo
    // en `executeStep`). Aquí no se toca: dos sitios decidiendo lo mismo
    // vuelven a desincronizarse.
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
    this.cancelReason = ''
    this.overlay.mount()
    // Escape cancela ESTE paso mientras dura. El manejador se instala aquí, al
    // empezar, y NUNCA se vuelve a instalar tras limpiar: soltarlo es cosa del
    // overlay, que pone `onCancel = null` en clearAll() y clearNotes() (no en
    // hideCard(): con el cartel escondido el barrido sigue con el foco puesto
    // y tiene que poder cancelarse), y que sólo intercepta la tecla mientras
    // tiene algo EN MARCHA —foco, cartel, barra de selección, seguimiento— o
    // mientras el único subrayado es el de una llegada por cita; las marcas
    // numeradas de un análisis no cuentan. Antes nadie lo soltaba y, desde la
    // primera marca, ningún Escape llegaba ya a los diálogos de Jira ni de
    // Confluence (auditoría del 2026-09-13, docs/PLAN.md §2 M2).
    this.overlay.onCancel = () => this.cancel('escape')

    if (isEditing()) {
      this.overlay.toast('Estás editando la página; Faro se aparta para no molestar.')
      return { status: STEP_RESULT.CANCELLED, reason: 'editando' }
    }

    // Si ya estamos donde lleva este paso, no hay nada que pulsar. Ojo: sólo
    // vale para los pasos que NAVEGAN. En uno de desplegar, estar en esa
    // página no significa que su rama del árbol esté abierta.
    if (step.action !== 'expand' && isAlreadyHere(step)) {
      return { status: STEP_RESULT.CLICKED, note: 'ya estábamos aquí', pageId: pageIdFromDom() }
    }

    const desplegando = step.action === 'expand'
    const timeout = this.timing.locateTimeoutMs ?? NAV_TIMING.locateTimeoutMs
    // Un paso de DESPLEGAR se busca DENTRO del árbol: es una rama, y en el
    // documento entero la primera pista que casaba podía ser un enlace del
    // cuerpo o de la cabecera a esa misma página, que no tiene rama que abrir
    // (H28, PLAN3 §3.2, C3-6). El contenedor se mira en cada sondeo, porque el
    // árbol puede llegar después que la página; sin árbol, el documento.
    const found = await waitFor(() => locateStep(step, step.action === 'expand' ? (treeContainer() || document) : document), { timeout })
    // Cancelado mientras se buscaba el enlace (Escape, «Parar» del panel o el
    // huérfano que se apaga): al volver no se presenta nada. Cancelar sólo
    // resuelve la espera de la tarjeta, y sin esto el paso encendía el foco,
    // volvía a montar el overlay y pulsaba (revisión adversaria de H27, visto en
    // Chromium). Lo mismo tras cada espera de abajo que acaba pintando.
    if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }

    if (!found) {
      // Una rama INTERMEDIA que no aparece se salta y ya está. Antes se ofrecía
      // el salto directo, y aceptarlo recargaba la página entera: el árbol se
      // plegaba de golpe y el recorrido se quedaba sin base justo a la mitad.
      // El barrido a ciegas y el respaldo se guardan para el destino, que es el
      // único paso que de verdad tiene que llegar.
      //
      // Antes de saltarla, UNA mirada al documento entero: `treeContainer()` se
      // queda con el primer candidato que «parece árbol», y un `[role="tree"]`
      // de destacados delante del de páginas dejaba la rama fuera (revisión
      // adversaria de H28, D10, reproducido en Chromium). Lo que salga de ahí
      // sólo vale si su fila tiene control de desplegar: el enlace del cuerpo o
      // de la cabecera a esa misma página, que es lo que motivó buscar dentro
      // del árbol, no tiene rama que abrir. La cancelación ya se miró arriba, y
      // esto no espera nada.
      if (desplegando) {
        const enDoc = locateStep(step, document)
        if (enDoc && treeToggleFor(enDoc.element)) return this._expandStep(enDoc, { step, index, total, isLast })
        return { status: STEP_RESULT.SKIPPED, reason: 'esa rama no está en el árbol' }
      }

      const expanded = await this._tryExpandTowards(step)
      // Escape a mitad del barrido: el paso acaba cancelado. Sin esto se
      // ofrecía «Llévame» justo después de que el usuario dijera que no, y a
      // los 12 s de la tarjeta navegaba solo.
      if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }
      if (expanded) {
        // El mismo sitio que la primera búsqueda (H28): hoy un paso de
        // desplegar no llega aquí —sin encontrarse, se salta arriba—, y si un
        // día llega, que no busque la rama fuera del árbol.
        const retry = await waitFor(() => locateStep(step, step.action === 'expand' ? (treeContainer() || document) : document), { timeout: 1200 })
        if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }
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
   *
   * Cada espera de aquí puede acabar en un Escape, y entonces el paso tiene que
   * volver CANCELLED: mientras se abría la rama o duraba el destello, Escape se
   * tragaba (el overlay hace `stopPropagation`) pero el paso seguía devolviendo
   * EXPANDED, así que el service worker lanzaba el siguiente y el recorrido
   * continuaba después de que el usuario dijera que no (revisión adversaria de
   * H2, 2026-09-14).
   */
  async _expandStep(found, { step, index, total, isLast }) {
    const fila = clickableAncestor(found.element)
    const toggle = treeToggleFor(found.element) || treeToggleFor(fila)

    // Sin control de desplegar no hay rama que abrir: se resalta y se sigue.
    if (!toggle) {
      await this._flash(fila, { step, index, total, texto: 'Esta rama ya está a la vista.' })
      if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }
      return { status: STEP_RESULT.EXPANDED, note: 'sin control de desplegar' }
    }

    if (toggle.expanded) {
      // Corta a propósito: con siete niveles, siete carteles de un segundo son
      // medio minuto mirando cómo Faro confirma lo que ya estaba hecho.
      await this._flash(toggle.row || toggle.toggle, { step, index, total, breve: true })
      if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }
      return { status: STEP_RESULT.EXPANDED, note: 'ya estaba abierta' }
    }

    // El árbol tiene su propio scroll: sin esto la rama se abre por debajo del
    // borde visible y parece que no ha pasado nada.
    await this._traerALaVista(toggle.row || toggle.toggle)
    await sleep(this.timing.scrollSettleMs ?? NAV_TIMING.scrollSettleMs)
    // Cancelado mientras se desplazaba: el foco no se enciende (revisión
    // adversaria de H27; ver `executeStep`).
    if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }

    const marca = toggle.row || toggle.toggle
    const rect = marca.getBoundingClientRect()
    this.overlay.spotlight(rect, { padding: 6 })
    this.overlay.follow(marca, { padding: 6 })

    const pause = this.timing.expandPauseMs ?? Math.round((this.timing.stepPauseMs ?? NAV_TIMING.stepPauseMs) * 0.6)
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
    // Escape mientras se abría la rama: el paso acaba cancelado. Sin esto
    // volvía EXPANDED y el service worker seguía con el paso siguiente.
    if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }
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
        // Cada espera del despliegue puede acabar en una cancelación: tras
        // ella ya no se despliega nada (revisión adversaria de H27).
        if (this.cancelled) return false
        fila.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        if (await this._esperaDespliegue(control)) return true
      }
    } catch {
      /* si el navegador no deja, se prueba lo siguiente */
    }

    // Último recurso: pulsar la propia fila. Nunca tras cancelar: suele navegar.
    // Y nunca sin la barrera, como el chevron de arriba: es la fila que
    // `treeToggleFor` dio por control (`aria-expanded` en la propia fila,
    // `isRow`), y una fila «Delete this page» con aria-expanded se pulsaba
    // (revisión adversaria de H28, D10, reproducido en Chromium). El título de
    // la fila ya no la bloquea (`isSafeToClick` lo quita, H28); lo que quede
    // dentro con cara de acción, un «Create» de hover, sí, y se prefiere así:
    // el teclado ya se probó antes.
    if (toggle.isRow) {
      if (!isSafeToClick(control, this.origin).ok) return false
      if (this.cancelled) return false
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
   *
   * Tras un Escape no se pinta nada: cancelar apaga el overlay y suelta su
   * manejador (`clearAll`), así que volver a encender aquí el foco y el cartel
   * los dejaba puestos y ya sin forma de quitarlos (revisión adversaria de H2,
   * 2026-09-14). Se mira antes de pintar y otra vez tras el desplazamiento, que
   * es donde se va el tiempo.
   */
  async _flash(el, { step, index, total, texto, breve = false }) {
    if (!el) return
    if (this.cancelled) return
    await this._traerALaVista(el)
    if (this.cancelled) return
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
    const budgetMs = this.timing.expandBudgetMs ?? NAV_TIMING.expandBudgetMs
    const maxClicks = this.timing.maxExpandClicks ?? NAV_TIMING.maxExpandClicks
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
        // Cancelar tiene que notarse DENTRO de la ronda: son hasta ocho clics,
        // y el bucle de fuera sólo miraba entre ronda y ronda. Tras el Escape,
        // `cancel()` ya apagó el overlay y soltó su manejador, así que seguir
        // aquí volvía a encender el foco sin nada que pudiera apagarlo, y
        // seguía desplegando ramas que el usuario ya no quería (revisión
        // adversaria de H2, 2026-09-14).
        if (this.cancelled) return false
        if (clicks >= maxClicks || Date.now() - t0 > budgetMs) break
        // Con el contenedor que ya se tiene: sin él la barrera lo vuelve a
        // buscar por cada candidato, y con el DOM cambiando a mitad del barrido
        // podía dar con otro (revisión adversaria de H28, D10).
        if (!isSafeToClick(btn, this.origin, { container }).ok) continue

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
    await sleep(this.timing.scrollSettleMs ?? NAV_TIMING.scrollSettleMs)
    // Cancelado mientras se desplazaba: ni foco, ni tarjeta, ni clic (revisión
    // adversaria de H27; ver `executeStep`).
    if (this.cancelled) return { status: STEP_RESULT.CANCELLED, reason: this.cancelReason || 'user' }

    const rect = target.getBoundingClientRect()
    this.overlay.spotlight(rect)
    this.overlay.follow(target)

    const pause = this.timing.stepPauseMs ?? NAV_TIMING.stepPauseMs
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
    // Un enlace sólo se pulsa si su URL RESUELTA es la del paso: la página no
    // decide adónde lleva el clic (§8.3, §8.12). Las pistas que lo encontraron
    // ordenan, no autorizan: una por nombre ni mira la dirección, y un enlace
    // sembrado en el cuerpo ganaba (revisión adversaria de H28, D3,
    // reproducido en Chromium). Si no lleva al paso, el service worker navega
    // por la URL del índice.
    if (safe.kind === 'enlace' && !llevaAlPaso(step, target.getAttribute('href'), this.origin)) {
      this.overlay.hideSpot()
      return { status: STEP_RESULT.NAVIGATE, reason: 'el enlace de la página no lleva a ese destino' }
    }

    target.click()
    this.overlay.hideCard()
    this.overlay.hideSpot()

    await waitForSettle({
      quietMs: this.timing.settleQuietMs ?? NAV_TIMING.settleQuietMs,
      maxMs: this.timing.settleMaxMs ?? NAV_TIMING.settleMaxMs,
    })

    // Contesta la página que PULSÓ: en un Data Center el clic en el árbol es
    // una carga entera, y la vieja se da por quieta antes de morir, con su URL.
    // En un DC `/display/…` la URL no lleva el id, así que va también el de la
    // página que contesta: con los dos, el service worker sabe si ya está en el
    // destino o tiene que esperar el aviso del destino (revisión adversaria de
    // H28, D1, reproducido en Chromium).
    return { status: STEP_RESULT.CLICKED, url: location.href, pageId: pageIdFromDom() }
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
    // Escape quita lo que deja una llegada, sea el foco (la página entera o el
    // elemento al que se llega sin cita) o el subrayado de la cita, y el
    // overlay suelta el manejador (clearAll pone `onCancel = null`). El
    // subrayado de una llegada no lleva números y el panel no guarda estado de
    // él —sólo registra «Fragmento resaltado»—, así que borrarlo con la tecla
    // no desincroniza a nadie; es más, es el único control que hay, porque en
    // el camino de la cita el foco se apaga antes de subrayar y sin esto el
    // subrayado se quedaba hasta la siguiente orden (revisión adversaria de H2,
    // 2026-09-14; lo decide `interceptsEscape()` del overlay).
    this.overlay.onCancel = () => this.overlay.clearAll()

    if (isEditing()) {
      this.overlay.toast('Estás en el editor: no resalto nada para no interferir.')
      return { status: STEP_RESULT.DONE, note: 'editando' }
    }

    // La página puede estar todavía montándose tras la navegación.
    await waitForSettle({ quietMs: this.timing.settleQuietMs ?? NAV_TIMING.settleQuietMs, maxMs: 4000 })
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
   * El `ms` que devuelve es el trabajo de marcar y nada más: desde que la página
   * tiene texto hasta que las marcas están puestas. Ni la espera a que pinte ni el
   * desplazamiento suave hasta la primera cuentan.
   *
   * @param {{notes: Array<{n:number, title?:string, anchor:object}>}} msg
   * @returns {{ok:boolean, placed:number[], missed:number[], detail?:Array<{n:number, strategy:string, approximate?:boolean}>, reason?:string, ms:number}}
   */
  async applyNotes({ notes }) {
    this.overlay.mount()
    // Aquí NO se instala manejador de Escape: con la tecla, las marcas se
    // borraban sin que el panel se enterase (seguía con `state.notes` y
    // contestaba «esa marca ya no está» al pulsar cada una). Se quitan desde
    // el panel, con «Quitar las marcas» (MSG.CLEAR_NOTES); y el clearNotes()
    // de más abajo suelta el manejador que hubiera dejado un anclaje anterior.

    const todas = (notes || []).map((x) => x.n)

    if (isEditing()) {
      this.overlay.toast('Estás en el editor: no marco nada para no interferir.')
      // Antes de arrancar el reloj: no se ha marcado nada, así que no hay tiempo
      // que contar (0 es la medida, no «no se midió»).
      return { ok: false, placed: [], missed: todas, reason: 'editando', ms: 0 }
    }

    await waitFor(() => contentRoot()?.textContent?.trim()?.length > 40, { timeout: 2000 })

    // Lo que tarda en MARCAR: leer la página en bloques, resolver cada ancla y
    // pintar las marcas. Es el número con el que se compara una página corta con
    // una larga, y el mismo trabajo antes y después de tocarlo. Arranca AQUÍ, tras
    // la espera a que la página tenga texto —hasta 2 s que no son trabajo de Faro,
    // igual que PAGE_DIGEST deja su espera fuera— y se para con las marcas ya
    // puestas, antes del desplazamiento suave hasta la primera (420-820 ms de
    // animación fija que tapaban la diferencia entre una página corta y una
    // larga). Reloj monótono, sin fechas ni nada del contenido: sólo un número que
    // el panel apunta detrás de «Análisis marcado». Aquí no cambia nada más que
    // dónde se lee el reloj; el orden de lo que se hace es el mismo.
    const t0 = performance.now()
    const transcurrido = () => Math.round(performance.now() - t0)

    // Qué es contenido y qué es interfaz se decide UNA vez para toda la pasada.
    // Antes lo recalculaba `pageDigest()` y después cada observación —al leer
    // el texto propio de su bloque y al bajar al peldaño global—, hasta tres
    // veces por observación y doce observaciones por análisis, y en una
    // incidencia de Jira decidirlo cuesta recorrer sus módulos (P7).
    const scope = digestScope()
    // La página en bloques se lee UNA vez para todas las observaciones, y de la
    // página de ahora: lo que vio el modelo pudo haberse repintado desde entonces.
    const digest = pageDigest({ scope })

    const items = []
    const missed = []
    const detail = []
    for (const nota of notes || []) {
      const resolved = resolveNote(nota, digest, scope)
      if (!visibleResolution(resolved)) {
        missed.push(nota.n)
        detail.push({ n: nota.n, strategy: 'none' })
        continue
      }
      items.push({ n: nota.n, title: nota.title, anchor: nota.anchor, ranges: resolved.ranges })
      detail.push({ n: nota.n, strategy: resolved.strategy, approximate: !!resolved.approximate })
    }

    this.overlay.clearNotes()
    if (!items.length) return { ok: true, placed: [], missed, detail, ms: transcurrido() }

    this.overlay.annotate(items)
    // Aquí acaba el trabajo de marcar: lo que viene es un desplazamiento suave y
    // una pausa de 80 ms, tiempo de animación que no depende de la página.
    const ms = transcurrido()

    // A la vista de la primera, sin destacarla: al principio todas valen igual.
    if (await scrollToRange(items[0].ranges[0], { extra: 110, behavior: this.behavior })) {
      await sleep(80)
      this.overlay.refreshMarks()
    }

    return { ok: true, placed: items.map((x) => x.n), missed, detail, ms }
  }

  /** Lleva a una observación concreta y la destaca sobre las demás. */
  async focusNote({ n }) {
    const nota = this.overlay.notes.find((x) => x.n === n)
    if (!nota) return { ok: false, reason: 'esa marca ya no está en la página' }

    // Confluence repinta su contenido cuando quiere, y un Range cuyos nodos ya
    // no están en el documento no se ve. Si pasó, se vuelve a resolver la
    // observación contra la página de ahora; si tampoco así, se dice.
    if (nota.anchor && !rangeAlive(nota.ranges[0])) {
      // Una sola observación, pero el mismo ámbito para leer y para resolver:
      // no tiene sentido decidir dos veces qué es interfaz en esta página.
      const scope = digestScope()
      const resolved = resolveNote(nota, pageDigest({ scope }), scope)
      // La MISMA guardia que al poner las marcas: aceptar aquí cualquier Range
      // contestaba `ok` con la cita caída en una pestaña oculta, sin marca ni
      // desplazamiento, y el panel encendía la fila (M8).
      if (!visibleResolution(resolved)) {
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
 *
 * El ámbito llega ya calculado por quien recorre todas las observaciones; el
 * valor por defecto es para quien resuelva una suelta.
 */
function resolveNote(nota, digest, scope = digestScope()) {
  if (!nota?.anchor) return null
  if (nota.anchor.kind === 'block-quote') return resolveBlockQuote(nota.anchor, { digest, scope })
  // Una cita suelta se busca en el ÁMBITO de lectura cuando lo hay (una
  // incidencia de Jira): en toda la página caería en la barra de acciones o en
  // una pestaña de campos oculta. En Confluence no hay ámbito que acote y
  // sigue siendo la búsqueda de siempre, con su contexto por delante y detrás.
  if (nota.anchor.kind === 'text-quote' && scope.chrome) {
    return resolveScopedQuote(nota.anchor, { scope }) || { ok: false, strategy: 'none' }
  }
  return resolveAnchor(nota.anchor)
}

/**
 * ¿Esta resolución se puede marcar? Tiene que haber salido bien, traer algún
 * Range y que el primero tenga caja: un Range sin cajas no se ve (el texto que
 * AUI esconde para lectores, una pestaña de campos oculta), y marcarlo sería
 * decir que la observación está en la página cuando no hay nada que mirar.
 *
 * Es UNA guardia para los dos sitios que adoptan un Range: poner las marcas
 * (`applyNotes`) y volver a una cuyo Range murió (`focusNote`). La segunda
 * aceptaba cualquier Range y devolvía `ok` sin nada que enseñar (auditoría
 * del 2026-09-13, docs/PLAN.md §2 M8). Pura salvo por `getClientRects()`, que
 * un Range de mentira puede dar: se prueba en Node.
 */
export function visibleResolution(resolved) {
  return !!resolved?.ok && !!resolved.ranges?.length && !!rangeRect(resolved.ranges[0])
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
 *
 * Y el id casa con FRONTERA detrás: `/pages/1234` está dentro de
 * `/pages/12345`, `/browse/ENG-7` dentro de `/browse/ENG-70` y `/projects/ENG`
 * dentro de `/projects/ENGINE`, y darse por llegado ahí dejaba el último paso
 * sin pulsar y el ancla buscándose en la página equivocada (auditoría del
 * 2026-09-13, docs/PLAN.md §2 M3). Es la misma cautela que `hrefDescriptors`
 * tiene con los enlaces. El id viene del plan ya validado, pero se escapa
 * igual: aquí no se confía.
 */
export function isAlreadyHere(step, loc = typeof location !== 'undefined' ? location : null) {
  if (!loc) return false
  const here = loc.pathname + (loc.search || '')

  if (step?.path && samePagePath(step.path, here)) return true

  const id = String(step?.id ?? '')
  if (!id) return false
  const ID = escapeRe(id)
  // Un segmento de la ruta: detrás sólo puede venir «/», «?», «#» o el final.
  const segment = (prefix) => new RegExp(prefix + ID + '(?=[/?#]|$)')
  // Un parámetro de la query: detrás sólo «&», «#» o el final.
  const param = (name) => new RegExp('[?&]' + name + '=' + ID + '(?=[&#]|$)')

  if (step.kind === 'confluence-page') return segment('/pages/').test(here) || param('pageId').test(here)
  if (step.kind === 'jira-issue') return segment('/browse/').test(here) || param('selectedIssue').test(here)
  if (step.kind === 'confluence-space') return segment('/spaces/').test(here) && !here.includes('/pages/')
  if (step.kind === 'jira-project') return segment('/projects/').test(here)
  return false
}

/** Escapa un texto para meterlo tal cual en una expresión regular. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
