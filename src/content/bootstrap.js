/**
 * Punto de entrada del content script.
 *
 * Va declarado en el manifest como script clásico, porque los content scripts
 * no admiten `import` estático. Carga el resto por import dinámico desde
 * `web_accessible_resources`, que sí funciona y evita tener que empaquetar.
 *
 * Este fichero no habla nunca con opencode ni conoce la contraseña del
 * servidor: sólo recibe órdenes ya validadas y contesta si pudo cumplirlas.
 * Vive dentro de una página que no controlamos, así que cuanto menos sepa,
 * mejor.
 */

;(() => {
  if (window.__faroBooted) return
  window.__faroBooted = true

  const url = (p) => chrome.runtime.getURL(p)
  let ready = null

  async function boot() {
    if (ready) return ready
    ready = (async () => {
      const [{ NavRunner }, { MSG }, { onUrlChange }] = await Promise.all([
        import(url('src/content/runner.js')),
        import(url('src/shared/messages.js')),
        import(url('src/content/dom-utils.js')),
      ])

      const runner = new NavRunner({
        timing: { locateTimeoutMs: 2500, stepPauseMs: 1600, settleQuietMs: 220, settleMaxMs: 6000 },
      })

      onUrlChange((href) => {
        chrome.runtime.sendMessage({ type: MSG.URL_CHANGED, url: href }).catch(() => {})
      })

      // Pulsar el número de una observación no navega: avisa al panel para que
      // marque esa fila del análisis. Los dos sentidos, chat → página y
      // página → chat, con el mismo número.
      runner.overlay.onNote = (n) => {
        chrome.runtime.sendMessage({ type: MSG.NOTE_CLICKED, n }).catch(() => {})
      }

      // El selector de página se carga la primera vez que se usa: la mayoría de
      // las visitas no lo tocan, y el content script cuanto más ligero mejor.
      let picker = null
      const getPicker = async () => {
        if (!picker) {
          const { Picker } = await import(url('src/content/picker.js'))
          picker = new Picker(runner.overlay)
        }
        return picker
      }

      return { runner, MSG, getPicker }
    })()
    return ready
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('faro:')) return undefined

    ;(async () => {
      try {
        const { runner, MSG, getPicker } = await boot()

        switch (msg.type) {
          case MSG.PING:
            sendResponse({ ok: true, url: location.href, title: document.title })
            return

          case MSG.SETTINGS:
            runner.setReducedMotion(!!msg.reduceMotion)
            if (msg.highlightStyle) runner.setHighlightStyle(msg.highlightStyle)
            if (msg.timing) Object.assign(runner.timing, msg.timing)
            sendResponse({ ok: true })
            return

          case MSG.STEP:
            sendResponse(await runner.executeStep(msg))
            return

          case MSG.ANCHOR:
            sendResponse(await runner.applyAnchor(msg))
            return

          case MSG.CANCEL:
            runner.cancel(msg.reason || 'sw')
            sendResponse({ ok: true })
            return

          case MSG.CLEAR:
            runner.clear()
            sendResponse({ ok: true })
            return

          case MSG.TREE_SNAPSHOT: {
            // Leer la estructura del arbol es gratis y no toca nada.
            const { snapshotTree } = await import(url('src/content/tree-scan.js'))
            sendResponse({ ok: true, ...snapshotTree() })
            return
          }

          case MSG.TREE_DEBUG: {
            // Diagnostico: que estructura ve Faro en ESTA barra lateral. Es lo
            // que permite ajustar los selectores con datos en vez de a ojo.
            const { describeTree } = await import(url('src/content/tree-dom.js'))
            sendResponse({ ok: true, report: describeTree(document) })
            return
          }

          case MSG.PICK_START: {
            // Se contesta ya: elegir puede llevarle al usuario todo el tiempo
            // que quiera, y dejar el mensaje abierto lo tumbaria por tiempo.
            const p = await getPicker()
            sendResponse({ ok: true })
            const pick = await p.start()
            chrome.runtime
              .sendMessage({ type: MSG.PICK_RESULT, pick: pick || null, url: location.href })
              .catch(() => {})
            return
          }

          case MSG.PICK_CANCEL: {
            const p = await getPicker()
            p.cancel()
            sendResponse({ ok: true })
            return
          }

          case MSG.PAGE_TEXT: {
            // El texto de la pagina, para que el modelo cite de lo mismo que
            // luego se va a buscar aqui. Leer no toca nada.
            const { readablePageText } = await import(url('src/content/anchor.js'))
            sendResponse({
              ok: true,
              ...readablePageText(msg.max || 30000),
              title: document.title,
              url: location.href,
            })
            return
          }

          case MSG.ANNOTATE:
            sendResponse(await runner.applyNotes(msg))
            return

          case MSG.FOCUS_NOTE:
            sendResponse(await runner.focusNote(msg))
            return

          case MSG.CLEAR_NOTES:
            runner.clearNotes()
            sendResponse({ ok: true })
            return

          default:
            sendResponse({ ok: false, error: 'mensaje desconocido' })
        }
      } catch (err) {
        console.error('[faro] fallo en el content script', err)
        sendResponse({ ok: false, error: String(err?.message || err) })
      }
    })()

    return true // respuesta asíncrona
  })

  // Avisa de que esta pestaña ya puede recibir pasos. Es lo que permite
  // retomar un recorrido después de una recarga completa.
  const announce = () => {
    import(url('src/shared/messages.js'))
      .then(({ MSG }) =>
        chrome.runtime.sendMessage({ type: MSG.CONTENT_READY, url: location.href }).catch(() => {})
      )
      .catch(() => {})
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') announce()
  else document.addEventListener('DOMContentLoaded', announce, { once: true })
})()
