/**
 * Service worker: el director de orquesta de la navegación.
 *
 * Lleva la cuenta del recorrido paso a paso porque el content script no
 * puede: un paso puede recargar la página entera y llevárselo por delante.
 * Aquí el estado sobrevive, y cuando la pestaña vuelve a estar lista se le
 * manda el paso siguiente.
 *
 * En MV3 este worker se duerme, así que el estado también se guarda en
 * `storage.session` y se rehidrata al despertar.
 */

import { MSG, sendToTab } from '../shared/messages.js'
import { getSettings, getSites } from '../shared/storage.js'
import { NAV_TIMING, STORAGE_KEYS } from '../shared/config.js'
import { parseAtlassianUrl } from '../atlassian/site.js'
import { visitFromUrl } from '../atlassian/activity.js'
import { recordActivity } from '../shared/activity-store.js'

const PLANS_KEY = 'faro:plans'

/** tabId -> {plan, index, phase} */
let plans = new Map()
let hydrated = false

async function hydrate() {
  if (hydrated) return
  hydrated = true
  const got = await chrome.storage.session.get(PLANS_KEY)
  const raw = got[PLANS_KEY]
  if (raw) plans = new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]))
}

async function persist() {
  const obj = {}
  for (const [k, v] of plans) obj[k] = v
  await chrome.storage.session.set({ [PLANS_KEY]: obj })
}

async function setPlan(tabId, state) {
  await hydrate()
  if (state) plans.set(tabId, state)
  else plans.delete(tabId)
  await persist()
}

async function getPlan(tabId) {
  await hydrate()
  return plans.get(tabId) || null
}

// ------------------------------------------------------------- ciclo de vida

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.action?.onClicked.addListener(async (tab) => {
  if (tab?.windowId != null) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId })
    } catch {
      /* si el comportamiento automático ya lo abrió, no pasa nada */
    }
  }
})

chrome.tabs.onRemoved.addListener((tabId) => setPlan(tabId, null))

/**
 * El diario de actividad: aquí es donde se apunta lo que el usuario abre.
 *
 * El worker es el ÚNICO escritor de «visto» (docs/PLAN.md §3.1): funciona con
 * el panel cerrado y sin content script —que es lo normal en un Confluence
 * propio sin permiso de host—, y tener un solo escritor evita que la misma
 * visita se cuente dos veces desde dos sitios con dos relojes distintos.
 *
 * Sólo con `changeInfo.url`: `onUpdated` dispara varias veces por carga
 * (`status`, `favIconUrl`, `title`…) y lo que interesa es la navegación, una
 * vez. Lo que el filtro ahorra no son entradas de más —`recordVisit` funde por su
 * clave los dos avisos de la misma navegación, y ahí está `dedupeMs` para eso—:
 * son los ajustes y el mapa de sitios LEÍDOS otra vez en cada uno de los cuatro o
 * cinco avisos de cada carga de cualquier pestaña. Lo primero es
 * `parseAtlassianUrl`, que es puro y barato: una pestaña de cualquier otra web
 * sale de aquí sin tocar el almacén.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo?.url) return
  recordVisitFor(changeInfo.url, { title: tab?.title }).catch(() => {})
})

/**
 * Apunta una visita si es de un sitio configurado y las sugerencias están
 * encendidas. Nunca lanza: el diario no puede romper una navegación.
 *
 * `restTools` es el interruptor maestro de toda lectura nueva y
 * `todaySuggestions` el de esta función: con cualquiera de los dos apagado no
 * se apunta NADA, porque quien no quiere que Faro consulte la API de su sitio
 * tampoco quiere un diario de lo que abre (CLAUDE.md §8.20).
 *
 * Sólo hosts con `configured: true`: pasar por un Jira ajeno no es usarlo.
 */
async function recordVisitFor(url, { title = '', pageId = '' } = {}) {
  const site = parseAtlassianUrl(url)
  if (!site?.host) return null

  const settings = await getSettings()
  if (!settings.restTools || !settings.todaySuggestions) return null

  const sites = await getSites()
  if (!sites[site.host]?.configured) return null

  // La URL se vuelve clase + identificador + ruta relativa, y nada más: ni la
  // consulta ni el fragmento entran en el diario.
  const visit = visitFromUrl(url, { title, pageId })
  if (!visit) return null
  return recordActivity(site.host, { event: 'seen', ...visit })
}

/**
 * Los ajustes que cambian en el panel llegan a la página al momento.
 *
 * `pushSettings` sólo se llamaba al lanzar un recorrido y tras cada recarga
 * (`onContentReady`), así que «Reducir animaciones» y el estilo del subrayado
 * no llegaban al content script hasta que el usuario navegara. Desde H6,
 * además, cerrar Ajustes ya no rearranca el panel, así que tampoco hay un
 * arranque que los empuje de rebote. El worker no ve pulsar «Listo»: lo que ve
 * es la escritura de `faro:settings`, y eso es esto.
 *
 * Sólo a la pestaña activa —es la única que el usuario está mirando, y la
 * siguiente recibirá los suyos al estar lista— y sin esperar respuesta:
 * `sendToTab` ya tolera que ahí no haya content script.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes || !(STORAGE_KEYS.settings in changes)) return
  ;(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id != null) await pushSettings(tab.id)
  })().catch((err) => console.error('[faro] service worker', err))
})

// ------------------------------------------------------------------ mensajes

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined

  ;(async () => {
    try {
      switch (msg.type) {
        case MSG.START_PLAN:
          sendResponse(await startPlan(msg.tabId, msg.plan))
          return

        case MSG.NAVIGATE_DIRECT:
          sendResponse(await navigateDirect(msg.tabId, msg.plan))
          return

        case MSG.CANCEL_PLAN:
          await sendToTab(msg.tabId, { type: MSG.CANCEL, reason: 'panel' })
          await setPlan(msg.tabId, null)
          sendResponse({ ok: true })
          return

        case MSG.REQUEST_HOST_PERMISSION:
          sendResponse(await requestHostPermission(msg.origin, msg.tabId))
          return

        case MSG.CONTENT_STATUS:
          sendResponse(await contentStatus(msg.tabId, msg.origin))
          return

        // Los dos avisos del content script apuntan la visita ANTES de seguir
        // con lo suyo: traen el `pageId` de la meta `ajs-page-id`, que es lo
        // único que identifica una página `/display/ESPACIO/Título` de un
        // Confluence Data Center y que `tabs.onUpdated` no puede saber. Va con
        // `.catch` propio para que el diario no pueda tumbar un recorrido.
        case MSG.CONTENT_READY:
          await recordVisitFor(msg.url || sender.tab?.url, {
            title: sender.tab?.title,
            pageId: msg.pageId,
          }).catch(() => null)
          await onContentReady(sender.tab?.id)
          sendResponse({ ok: true })
          return

        case MSG.URL_CHANGED:
          await recordVisitFor(msg.url || sender.tab?.url, {
            title: sender.tab?.title,
            pageId: msg.pageId,
          }).catch(() => null)
          sendResponse({ ok: true })
          return

        default:
          return
      }
    } catch (err) {
      console.error('[faro] service worker', err)
      sendResponse({ ok: false, error: String(err?.message || err) })
    }
  })()

  return true
})

// -------------------------------------------------------------- información

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Pide permiso para un host que no está en el manifest (Server/Data Center) y,
 * si lo concede, registra ahí el content script.
 */
async function requestHostPermission(origin, tabId) {
  const pattern = origin.replace(/\/+$/, '') + '/*'
  const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false)
  if (!granted) return { ok: false, error: 'permiso denegado' }
  return ensureContentScript(origin, tabId)
}

/**
 * Deja el content script funcionando en un host que no está en el manifest.
 *
 * Hacen falta las dos cosas: registrarlo para las próximas cargas, e
 * inyectarlo en la pestaña que ya está abierta. Sin lo segundo habría que
 * recargar a mano, y sin lo primero se pierde al navegar.
 */
async function ensureContentScript(origin, tabId) {
  const pattern = origin.replace(/\/+$/, '') + '/*'
  const id = 'faro-' + originOf(origin).replace(/[^a-z0-9]/gi, '-')

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => [])
    if (!existing.length) {
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: [pattern],
          js: ['src/content/bootstrap.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ])
    }
  } catch (err) {
    return { ok: false, error: 'no se pudo registrar el script: ' + (err?.message || err) }
  }

  // La pestaña abierta no lo tiene todavía: se inyecta ahora mismo.
  if (tabId != null) {
    const alive = await sendToTab(tabId, { type: MSG.PING })
    if (!alive?.ok) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/bootstrap.js'] })
      } catch (err) {
        return { ok: false, error: 'no se pudo inyectar: ' + (err?.message || err) }
      }
    }
  }

  return { ok: true }
}

/**
 * Si un paso se queda esperando a una pestaña que nunca avisa, se abandona con
 * un motivo. Quedarse callado es lo peor que puede hacer: parece que el botón
 * no funciona.
 */
function watchStalledStep(tabId, index, ms = NAV_TIMING.stepStallMs) {
  setTimeout(async () => {
    const state = await getPlan(tabId)
    if (!state || state.index !== index || state.phase !== 'steps') return
    const alive = await sendToTab(tabId, { type: MSG.PING })
    if (alive?.ok) return runCurrentStep(tabId)

    await setPlan(tabId, null)
    const error = 'La página no responde. Recárgala y vuelve a intentarlo.'
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error } })
  }, ms)
}

/** ¿Puede Faro actuar sobre esta pestaña ahora mismo? */
async function contentStatus(tabId, origin) {
  const granted = origin
    ? await chrome.permissions.contains({ origins: [origin.replace(/\/+$/, '') + '/*'] }).catch(() => false)
    : false
  const ping = tabId != null ? await sendToTab(tabId, { type: MSG.PING }) : null
  return { granted, ready: !!ping?.ok }
}

// --------------------------------------------------------------- navegación

async function pushSettings(tabId) {
  const s = await getSettings()
  await sendToTab(tabId, {
    type: MSG.SETTINGS,
    reduceMotion: s.reduceMotion,
    highlightStyle: s.highlightStyle,
    timing: { stepPauseMs: s.stepDelayMs },
  })
}

/** Navegación directa: un salto y, al llegar, el resaltado. */
async function navigateDirect(tabId, plan) {
  if (!plan?.destination?.url) return { ok: false, error: 'plan sin destino' }
  await pushSettings(tabId)

  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const alreadyThere = tab && sameDoc(tab.url, plan.destination.url)

  if (!alreadyThere) {
    await setPlan(tabId, { plan, index: plan.steps?.length || 0, phase: 'anchor' })
    await chrome.tabs.update(tabId, { url: plan.destination.url })
    // El resto lo hace onContentReady cuando la página nueva avise.
    return { ok: true, navigating: true }
  }

  const res = await sendAnchor(tabId, plan)
  await setPlan(tabId, null)
  return { ok: true, navigating: false, result: res }
}

/** Navegación asistida: se manda un paso y se espera a que la pestaña avise. */
async function startPlan(tabId, plan) {
  if (!plan?.steps?.length) return navigateDirect(tabId, plan)
  await pushSettings(tabId)
  await setPlan(tabId, { plan, index: 0, phase: 'steps' })
  return runCurrentStep(tabId)
}

async function runCurrentStep(tabId) {
  const state = await getPlan(tabId)
  if (!state) return { ok: false, error: 'no hay recorrido en marcha' }

  const { plan, index } = state
  if (index >= plan.steps.length) {
    await setPlan(tabId, { ...state, phase: 'anchor' })
    const res = await sendAnchor(tabId, plan)
    await setPlan(tabId, null)
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: res })
    return { ok: true, finished: true, result: res }
  }

  const step = plan.steps[index]
  notifyPanel({ type: MSG.PLAN_PROGRESS, tabId, index, total: plan.steps.length, step })

  const res = await sendToTab(tabId, {
    type: MSG.STEP,
    step,
    index,
    total: plan.steps.length,
    isLast: index === plan.steps.length - 1,
  })

  if (!res) {
    // La pestaña no contesta, y hay dos motivos muy distintos:
    //
    //  - Está recargando. Entonces hay que esperar: al avisar de que está
    //    lista, retomará este mismo paso.
    //  - Faro no tiene permiso para actuar en este dominio. Es lo que pasa en
    //    los Confluence propios, que no están en el manifest. Antes esto se
    //    quedaba en «esperando» para siempre y no pasaba nada, en silencio.
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    const { granted } = await contentStatus(tabId, originOf(tab?.url || ''))

    if (!granted) {
      await setPlan(tabId, null)
      const error = 'Faro no tiene permiso para actuar en este dominio.'
      notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error, needsPermission: true } })
      return { ok: false, error, needsPermission: true }
    }

    // Permiso hay, así que se le da un margen para que termine de cargar.
    watchStalledStep(tabId, index)
    return { ok: true, waiting: true }
  }

  switch (res.status) {
    case 'expanded':
      // Desplegar una rama no recarga la página: se puede seguir enseguida.
      await setPlan(tabId, { ...state, index: index + 1 })
      return runCurrentStep(tabId)

    case 'clicked':
      await setPlan(tabId, { ...state, index: index + 1 })
      return advanceAfterNavigation(tabId)

    case 'skipped':
      await setPlan(tabId, { ...state, index: index + 1 })
      return runCurrentStep(tabId)

    case 'navigate': {
      await setPlan(tabId, { ...state, index: index + 1 })

      // Sólo el destino puede llegar por URL. Una carga de página a mitad del
      // recorrido pliega el árbol entero y deja sin base a los pasos que
      // quedan — que es exactamente lo que hacía que la navegación guiada
      // acabase siendo un salto seco. Un paso intermedio que no se pudo pulsar
      // se salta y se sigue.
      if (index < plan.steps.length - 1) return runCurrentStep(tabId)

      await chrome.tabs.update(tabId, { url: step.url })
      return { ok: true, navigating: true }
    }

    case 'cancelled':
      await setPlan(tabId, null)
      notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { cancelled: true } })
      return { ok: true, cancelled: true }

    default:
      await setPlan(tabId, { ...state, index: index + 1 })
      return runCurrentStep(tabId)
  }
}

/**
 * Tras un clic, la SPA puede haber cambiado de vista sin recargar. Se da un
 * respiro y se sigue; si hubo recarga de verdad, onContentReady se adelantará.
 */
async function advanceAfterNavigation(tabId) {
  await new Promise((r) => setTimeout(r, 420))
  const state = await getPlan(tabId)
  if (!state) return { ok: true, cancelled: true }
  return runCurrentStep(tabId)
}

async function onContentReady(tabId) {
  if (!tabId) return
  const state = await getPlan(tabId)
  if (!state) return
  await pushSettings(tabId)
  if (state.phase === 'anchor') {
    const res = await sendAnchor(tabId, state.plan)
    await setPlan(tabId, null)
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: res })
    return
  }
  await runCurrentStep(tabId)
}

async function sendAnchor(tabId, plan) {
  return sendToTab(tabId, {
    type: MSG.ANCHOR,
    anchor: plan.anchor || null,
    explanation: plan.explanation || '',
    title: plan.destination?.title || '',
  })
}

function sameDoc(a, b) {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname === ub.pathname
  } catch {
    return false
  }
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}
