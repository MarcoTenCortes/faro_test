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
      const [{ NavRunner }, { MSG }, { onUrlChange }, { NAV_TIMING }] = await Promise.all([
        import(url('src/content/runner.js')),
        import(url('src/shared/messages.js')),
        import(url('src/content/dom-utils.js')),
        import(url('src/shared/config.js')),
      ])

      // Los tiempos viven en config.js; aquí sólo se copian, porque
      // MSG.SETTINGS los muta con lo que ajusta el usuario y la constante
      // compartida no debe cambiar por debajo. Nada de esto hace falta antes
      // del import(): el NavRunner se construye después.
      const runner = new NavRunner({ timing: { ...NAV_TIMING } })

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

  // ------------------------------------------------- lecturas REST del sitio
  //
  // Desde H7 el content script contesta también a lo que se lee de la API REST
  // del propio sitio con la sesión del navegador (CLAUDE.md §8.19). Sigue sin
  // saber nada de opencode: recibe una consulta o el `kind` de una plantilla,
  // llama al módulo del producto y devuelve lo que ése ya ha validado. Lo que
  // decide A QUÉ RUTA se pide —la ruta de contexto de Jira, el prefijo del
  // wiki— se deduce aquí de la URL de la pestaña en cada petición, nunca del
  // mensaje, que es lo mismo que ya hacía PAGE_ANCESTORS.

  /**
   * Ventanas por defecto de las plantillas «lo tuyo» y «lo del proyecto» cuando
   * el panel no dice otra cosa (docs/plan/anexo-A, «Leer del sitio»). El TOPE lo
   * pone el constructor de la consulta, que devuelve null si no vale: sin
   * consulta no hay petición.
   */
  const DIAS_POR_DEFECTO = { mine: 7, project: 3 }

  const dias = (v, porDefecto) => (Number.isInteger(v) && v >= 1 ? v : porDefecto)

  /** Un tope de resultados que el panel pide, acotado; sin él, el del módulo. */
  const tope = (v, max) => (Number.isInteger(v) && v >= 1 ? Math.min(v, max) : max)

  /**
   * La forma de un host. El panel PROPONE el del Confluence enlazado (el que
   * guardó `siteRecords`, §4.8) y aquí se vuelve a comprobar antes de usarlo,
   * igual que el prefijo del wiki: no decide a dónde se pide nada —eso sale
   * siempre de `location`—, sólo a qué hosts se admite que apunte un enlace que
   * devuelve la API.
   */
  const HOST = /^[a-z0-9.-]{1,255}$/i
  const hostValido = (v) => (HOST.test(String(v ?? '').trim()) ? String(v).trim().toLowerCase() : '')

  /**
   * El sitio de ESTA pestaña para las lecturas REST de Jira.
   *
   * La ruta de contexto (`/jira`) se deduce de la URL del navegador con
   * `jiraContextPath`: es lo que decide a qué ruta se pide, así que no puede
   * llegar por mensaje. (El prefijo del wiki de Confluence sí se puede proponer,
   * porque un DC bajo `/confluence` sólo lo conoce quien lo observó;
   * `resolveWikiPrefix` lo acepta sólo con forma de ruta.) Para
   * `cloud` vale que lo diga cualquiera de los dos: en Jira Cloud no hay REST de
   * Jira que leer (410) y negarse es el lado seguro.
   */
  async function sitioJira(msg) {
    const { jiraContextPath, parseAtlassianUrl } = await import(url('src/atlassian/site.js'))
    return {
      origin: location.origin,
      jiraPrefix: jiraContextPath(location.pathname),
      cloud: !!msg.cloud || !!parseAtlassianUrl(location.href)?.cloud,
    }
  }

  /**
   * De un `kind` a la plantilla de jira-rest.js que lo escribe. Aquí NO se
   * construye ninguna consulta: sólo se elige entre las fijas, y un `kind` que
   * no esté en la lista no es una consulta.
   */
  function jqlDePlantilla(jira, msg) {
    switch (msg.kind) {
      case 'history':
        return jira.historyJql()
      case 'mine':
        return jira.mineJql(dias(msg.days, DIAS_POR_DEFECTO.mine))
      case 'project':
        return jira.projectJql(msg.projectKey, dias(msg.days, DIAS_POR_DEFECTO.project))
      case 'related':
        return jira.relatedJql(msg.issueKey)
      default:
        return null
    }
  }

  /** Lo mismo para Confluence: `kind` → una de las tres CQL de plantilla. */
  function cqlDePlantilla(conf, msg) {
    switch (msg.kind) {
      case 'viewed':
        return conf.viewedCql(tope(msg.limit, conf.CONFLUENCE_REST_LIMITS.maxResults))
      case 'mine':
        return conf.mineCql(dias(msg.days, DIAS_POR_DEFECTO.mine))
      case 'ids':
        return conf.idsCql(msg.ids)
      default:
        return null
    }
  }

  /** El sitio de ESTA pestaña para las lecturas REST de Confluence. */
  function sitioConfluence(conf, msg) {
    return {
      origin: location.origin,
      wikiPrefix: conf.resolveWikiPrefix({ requested: msg.wikiPrefix, cloud: !!msg.cloud, pathname: location.pathname }),
      cloud: !!msg.cloud,
    }
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

          case MSG.PAGE_DIGEST: {
            // Con `fieldsOnly` sólo se piden los campos de la incidencia, y eso
            // no necesita trocear la página: trocearla cuesta (H3 le puso
            // número) y quien pregunta por el tipo y el estado —las búsquedas
            // sugeridas— no mira ni un bloque. Va ANTES de la guarda de
            // «editando»: leer un campo no depende de que la página esté
            // abierta en el editor.
            if (msg.fieldsOnly) {
              const t0 = performance.now()
              const { jiraIssueFields } = await import(url('src/content/jira-issue.js'))
              sendResponse({ ok: true, issue: jiraIssueFields(), url: location.href, ms: Math.round(performance.now() - t0) })
              return
            }
            // La pagina en bloques numerados, tal como se ve en pantalla: es lo
            // que lee el modelo en el modo Analisis y lo mismo contra lo que
            // despues se resuelven sus observaciones. Leer no toca nada.
            const [{ pageDigest, serializeDigest }, { formatDigest }, { isEditing, waitFor, contentRoot }, { jiraIssueFields }] =
              await Promise.all([
                import(url('src/content/digest.js')),
                import(url('src/shared/digest.js')),
                import(url('src/content/dom-utils.js')),
                import(url('src/content/jira-issue.js')),
              ])
            if (isEditing()) {
              sendResponse({ ok: false, reason: 'editando' })
              return
            }
            await waitFor(() => contentRoot()?.textContent?.trim()?.length > 40, { timeout: 2000 })
            // Cuánto cuesta LEER la página: recorrerla en bloques, serializarla
            // y mirar los campos de la incidencia. Nadie veía ese precio, y sin
            // verlo no se puede decir si un cambio lo mejora o lo empeora; el
            // panel lo apunta detrás de «Página leída en bloques». La espera de
            // arriba queda FUERA a propósito: es la página tardando en
            // pintarse, no lo que cuesta leerla. Medir es lo único que cambia
            // aquí: la respuesta gana `ms` y nada más.
            const t0 = performance.now()
            const digest = pageDigest()
            if (!digest.blocks.length) {
              sendResponse({ ok: false, reason: 'sin-texto' })
              return
            }
            const cuerpo = {
              text: formatDigest(digest.blocks),
              ...serializeDigest(digest),
              title: document.title,
              url: location.href,
              // En una incidencia de Jira, sus campos: el tipo y el estado
              // deciden cómo se analiza. null en cualquier otra página.
              issue: jiraIssueFields(),
            }
            sendResponse({ ok: true, ...cuerpo, ms: Math.round(performance.now() - t0) })
            return
          }

          case MSG.PAGE_ANCESTORS: {
            // De quién cuelga una página, leído de la API REST del propio sitio:
            // un GET al mismo origen, con la sesión del navegador, y sólo con un
            // id numérico validado. Lo que vuelve son datos, y se validan. El
            // prefijo que llega por mensaje se acepta sólo si tiene forma de
            // ruta; si no, se deduce de dónde estamos.
            const { fetchAncestors, resolveWikiPrefix } = await import(url('src/shared/confluence-rest.js'))
            const wikiPrefix = resolveWikiPrefix({
              requested: msg.wikiPrefix,
              cloud: !!msg.cloud,
              pathname: location.pathname,
            })
            sendResponse(
              await fetchAncestors(
                (u, o) => fetch(u, o),
                { origin: location.origin, wikiPrefix, cloud: !!msg.cloud },
                msg.pageId
              )
            )
            return
          }

          case MSG.PAGE_SEARCH: {
            // Páginas del sitio por título, para elegir las páginas base de un
            // análisis. Es la única petición al sitio con texto del usuario
            // dentro: sigue siendo un GET al mismo origen con la sesión del
            // navegador, el texto se limpia y se acota antes de ser CQL, y lo
            // que vuelve son datos validados.
            const { searchPages, resolveWikiPrefix } = await import(url('src/shared/confluence-rest.js'))
            const wikiPrefix = resolveWikiPrefix({
              requested: msg.wikiPrefix,
              cloud: !!msg.cloud,
              pathname: location.pathname,
            })
            sendResponse(
              await searchPages(
                (u, o) => fetch(u, o),
                { origin: location.origin, wikiPrefix, cloud: !!msg.cloud },
                msg.query,
                { limit: msg.limit }
              )
            )
            return
          }

          case MSG.PAGE_LINKS: {
            // Los enlaces que la página o la incidencia tiene EN SU CONTENIDO,
            // para que el panel pueda sugerir páginas base sin preguntarle al
            // modelo (§8.20). Leer el DOM es gratis y no toca nada; lo único
            // que sale a la red es, en una incidencia de Jira Data Center, la
            // lista de enlaces remotos de ESA incidencia, y sólo si el panel no
            // la ha apagado (`remote: false`, que es lo que hace el interruptor
            // `restTools` de los ajustes). Si esa lectura falla, `remote` trae
            // su motivo y lo leído del DOM sigue valiendo: la sección vive de
            // lo demás (§8.14).
            const [{ pageLinks }, { jiraIssueFields, jiraIssueKey }, { digestScope }, { isEditing }] = await Promise.all([
              import(url('src/content/page-links.js')),
              import(url('src/content/jira-issue.js')),
              import(url('src/content/digest.js')),
              import(url('src/content/dom-utils.js')),
            ])
            if (isEditing()) {
              sendResponse({ ok: false, reason: 'editando' })
              return
            }
            // Lo que cuesta LEER la página, como en PAGE_DIGEST: lo que tarde
            // la API va en el `ms` del propio `remote` y no se suma aquí.
            const t0 = performance.now()
            const links = pageLinks({ scope: digestScope() })
            const issueKey = jiraIssueKey(document, location.href)
            const issue = jiraIssueFields()
            const ms = Math.round(performance.now() - t0)

            let remote = null
            if (issueKey && msg.remote !== false) {
              const [jira, sitio] = await Promise.all([import(url('src/shared/jira-rest.js')), sitioJira(msg)])
              // A qué hosts se admite que apunte un enlace remoto: el de esta
              // pestaña y el Confluence que el panel tiene guardado para este
              // sitio. Sin ese filtro, un enlace remoto a OTRA Confluence
              // colaría su `pageId`, y un id se resuelve contra el origen de
              // aquí: sería sugerir otra página con el mismo número.
              const enlazado = hostValido(msg.confluenceHost)
              remote = await jira.fetchRemoteLinks((u, o) => fetch(u, o), sitio, issueKey, {
                hosts: enlazado ? [location.hostname, enlazado] : [location.hostname],
              })
            }
            sendResponse({ ok: true, links, issue, issueKey, remote, title: document.title, url: location.href, ms })
            return
          }

          case MSG.JQL_SEARCH: {
            // Una consulta JQL ejecutada contra la API del propio Jira. De
            // dónde salió esa consulta responde QUIEN LA MANDA (§8.12: la
            // llamada real del MCP, un chip con valores escapados o un filtro
            // del propio usuario); aquí no se puede saber, así que aquí no se
            // decide: este lado garantiza lo suyo —GET, mismo origen, una línea
            // sin controles y con tope, campos de lista blanca, `maxResults`
            // acotado— y nada más. Nunca texto del usuario ni prosa del modelo.
            const [jira, sitio] = await Promise.all([import(url('src/shared/jira-rest.js')), sitioJira(msg)])
            sendResponse(
              await jira.searchIssues((u, o) => fetch(u, o), sitio, msg.jql, { limit: msg.limit, fields: msg.fields })
            )
            return
          }

          case MSG.RECENT_ISSUES: {
            // Lo que has mirado y lo tuyo, con consultas de PLANTILLA FIJA: el
            // panel manda un `kind` y parámetros que se validan (una clave, un
            // número de días), nunca el texto de la consulta. Un `kind` que no
            // esté en la lista no es una consulta y no se pide nada.
            const [jira, sitio] = await Promise.all([import(url('src/shared/jira-rest.js')), sitioJira(msg)])
            const jql = jqlDePlantilla(jira, msg)
            if (!jql) {
              sendResponse({ ok: false, reason: 'consulta no permitida' })
              return
            }
            sendResponse(await jira.searchIssues((u, o) => fetch(u, o), sitio, jql, { limit: msg.limit }))
            return
          }

          case MSG.RECENT_PAGES: {
            // Lo mismo en Confluence: las tres CQL de plantilla (lo que viste,
            // lo tuyo, unos ids concretos). `searchContent` vuelve a comprobar
            // que el CQL salió de una plantilla, así que la lista de `kind` de
            // aquí y la de allí no pueden divergir sin que deje de pedirse.
            const conf = await import(url('src/shared/confluence-rest.js'))
            const cql = cqlDePlantilla(conf, msg)
            if (!cql) {
              sendResponse({ ok: false, reason: 'consulta no permitida' })
              return
            }
            sendResponse(await conf.searchContent((u, o) => fetch(u, o), sitioConfluence(conf, msg), cql, { limit: msg.limit }))
            return
          }

          case MSG.SPACE_PAGES: {
            // El árbol de un espacio, entero y paginado. Los topes (cuántas
            // páginas y cuántas peticiones) son los del ÍNDICE y los pone el
            // módulo: no viajan en el mensaje, para que no haya dos topes para
            // lo mismo diciendo cosas distintas.
            const conf = await import(url('src/shared/confluence-rest.js'))
            sendResponse(
              await conf.fetchSpacePages((u, o) => fetch(u, o), sitioConfluence(conf, msg), msg.spaceKey, { limit: msg.limit })
            )
            return
          }

          case MSG.FAVOURITE_FILTERS: {
            // Los filtros que el propio usuario tiene marcados en su Jira: sus
            // consultas, tal como él las guardó.
            const [jira, sitio] = await Promise.all([import(url('src/shared/jira-rest.js')), sitioJira(msg)])
            sendResponse(await jira.fetchFavouriteFilters((u, o) => fetch(u, o), sitio))
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
