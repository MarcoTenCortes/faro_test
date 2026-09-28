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
 *
 * Y desde H27 (docs/PLAN3.md §3.1) es quien mantiene el content script en los
 * hosts propios: lo registra al instalarse o al darse un permiso, lo quita al
 * quitarse, y distingue una pestaña sin script de una con el script ROTO. Lo
 * que no hace nunca es pedir un permiso: eso exige el gesto del usuario, que
 * sólo tiene el panel.
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
/**
 * La hidratación en curso (o ya hecha), como PROMESA y no como booleano (H27,
 * C5-10). Con el booleano, el primero lo ponía a `true` antes de leer y un
 * segundo mensaje que llegaba mientras tanto seguía con el mapa vacío: lo que
 * guardaba ahí lo pisaba después la lectura del primero. Ahora todos esperan a
 * la misma lectura; si falla, la siguiente llamada lo vuelve a intentar.
 */
let hydrating = null

async function hydrate() {
  if (!hydrating) {
    hydrating = (async () => {
      const got = await chrome.storage.session.get(PLANS_KEY)
      const raw = got[PLANS_KEY]
      if (raw) plans = new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]))
    })().catch((err) => {
      hydrating = null
      throw err
    })
  }
  return hydrating
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

/**
 * Al instalarse o actualizarse (y recargar una extensión sin empaquetar es una
 * actualización), además del icono que abre el panel, se vuelven a registrar
 * los content scripts de los hosts propios (H27). Una actualización puede
 * llevarse los registros (SUPUESTO leído en Chromium, a verificar en H30), y
 * sin ellos el subrayado y «Paso a paso» de un Confluence propio pedirían «Dar
 * permiso» con el permiso ya dado. Sin `onStartup`: `persistAcrossSessions`
 * ya aguanta el reinicio del navegador.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})
  reconcileContentScripts().catch((err) => console.warn('[faro] service worker', err))
})

/**
 * Un permiso de host dado desde el panel («Dar permiso») o desde Chrome
 * registra ahí el content script; uno quitado lo desregistra (H27).
 *
 * Al darse, el REQUEST_HOST_PERMISSION del panel registra lo mismo a la vez:
 * de los dos, el segundo se lleva un «Duplicate script ID» que cuenta como
 * éxito (`registrarScript`). Al quitarse, un id por llamada: Chrome tumba la
 * llamada ENTERA si un solo id no existe (`RemoveScripts` en
 * scripting_utils.cc), y un aviso puede traer un origen que nunca se registró
 * (el del manifest que la persona retiene, o uno que no es un sitio suyo).
 * Nunca sin `ids`: así los quitaría TODOS.
 */
chrome.permissions.onAdded.addListener(() => {
  reconcileContentScripts().catch((err) => console.warn('[faro] service worker', err))
})

chrome.permissions.onRemoved.addListener((removed) => {
  for (const origin of removed?.origins || []) {
    chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(origin)] }).catch(() => null)
  }
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
 * Sólo a la pestaña activa, que es la única que el usuario está mirando, y sin
 * esperar respuesta: `sendToTab` ya tolera que ahí no haya content script. Las
 * demás los reciben cuando el panel vuelve a ellas: `contentStatus` los empuja
 * detrás de cada PING que contesta bien, y `ensureContentScript` detrás del
 * PING bueno de después de inyectar. Una carga SIN recorrido no los recibe, a
 * propósito. Hasta H27 el motivo era que el primer mensaje arrancaba el content
 * script entero (18 módulos, ~256 KB y un sondeo cada 700 ms); desde H27 PING y
 * SETTINGS ya no lo arrancan (la página guarda los ajustes hasta el primer
 * mensaje de verdad), y lo que queda es peso y sentido: empujarlos a cada
 * pestaña, o en cada carga, sería una lectura del almacén y un mensaje por
 * página para nada, porque el panel comprueba la pestaña antes de marcar o de
 * señalar y ahí llegan.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes || !(STORAGE_KEYS.settings in changes)) return
  ;(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id != null) await pushSettings(tab.id)
  })().catch((err) => console.error('[faro] service worker', err))
})

// ------------------------------------------------------------------ mensajes

/**
 * Los tipos que este worker atiende, que son los `case` de abajo (H27, C5-10).
 *
 * Para cualquier otro, `onMessage` no devuelve `true`: devolverlo promete una
 * respuesta, y con un tipo que no es para el worker (lo que el content script
 * manda al panel, como PICK_RESULT) el canal se quedaba abierto hasta que
 * Chrome lo cerraba con un error.
 *
 * Por NOMBRE y no con una lista de `MSG.X`: tools/check-docs.mjs cuenta un
 * «, MSG.X» como quien MANDA ese mensaje, y una lista así escondería el día en
 * que el panel dejara de mandar uno. Una errata aquí deja el tipo sin atender,
 * y eso lo caza service-worker.test.js.
 */
const ATENDIDOS = new Set(
  ['START_PLAN', 'NAVIGATE_DIRECT', 'CANCEL_PLAN', 'REQUEST_HOST_PERMISSION', 'CONTENT_STATUS', 'CONTENT_READY', 'URL_CHANGED'].map(
    (nombre) => MSG[nombre]
  )
)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined
  if (!ATENDIDOS.has(msg.type)) return undefined

  ;(async () => {
    try {
      switch (msg.type) {
        case MSG.START_PLAN:
          if (desdeUnaPestana(sender, sendResponse)) return
          sendResponse(await startPlan(msg.tabId, msg.plan))
          return

        case MSG.NAVIGATE_DIRECT:
          if (desdeUnaPestana(sender, sendResponse)) return
          sendResponse(await navigateDirect(msg.tabId, msg.plan))
          return

        case MSG.CANCEL_PLAN:
          await sendToTab(msg.tabId, { type: MSG.CANCEL, reason: 'panel' })
          await setPlan(msg.tabId, null)
          sendResponse({ ok: true })
          return

        case MSG.REQUEST_HOST_PERMISSION:
          if (desdeUnaPestana(sender, sendResponse)) return
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

/**
 * ¿Viene de una pestaña? Entonces se contesta que no y el `case` sale (H27,
 * C5-9). Lanzar un recorrido, navegar y asegurar el content script son cosas
 * del panel, que no es una pestaña: con esto una página (un content script, o
 * una página de la extensión abierta en una pestaña) no puede mandar al worker
 * a navegar ni a inyectar.
 */
function desdeUnaPestana(sender, sendResponse) {
  if (!sender?.tab) return false
  sendResponse({ ok: false, error: 'sólo desde el panel' })
  return true
}

// -------------------------------------------------------------- información

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * El id del script registrado de un origen: uno por origen y siempre el mismo,
 * lo registre el «Dar permiso», la reconciliación o lo quite un permiso
 * retirado (H27). Vale con un origen o con un patrón (`https://host/*`).
 */
function scriptIdFor(origin) {
  return 'faro-' + originOf(origin).replace(/[^a-z0-9]/gi, '-')
}

/** El patrón de un origen, para `permissions` y para `matches`: `https://host/*`. */
function patternFor(origin) {
  return origin.replace(/\/+$/, '') + '/*'
}

/**
 * Pura. Los orígenes en los que el worker registra el content script a mano
 * (H27): los hosts de `faro:sites` y sus enlazados (`jiraHost`,
 * `confluenceHost`), cada uno sólo si su `https://host/*` está entre los
 * permisos concedidos y NO entre los del manifest (esos ya los cubre
 * `content_scripts`). Sin repetidos y en orden alfabético.
 *
 * La concesión del permiso es el consentimiento: un registro con
 * `configured: false` (tras «Quitar las claves», H19) o sin `configured` (las
 * claves saltadas) sigue siendo un sitio de la persona, y sin su script el
 * subrayado y «Paso a paso» pedirían «Dar permiso» tras cada recarga de la
 * extensión (decisión del orquestador, que relaja docs/PLAN3.md §3.1).
 *
 * @param {{sites?: object, granted?: string[], manifestOrigins?: string[]}} entrada
 * @returns {string[]} orígenes `https://host`
 */
export function originsToRegister({ sites, granted, manifestOrigins } = {}) {
  const concedidos = new Set(Array.isArray(granted) ? granted : [])
  const delManifest = new Set(Array.isArray(manifestOrigins) ? manifestOrigins : [])
  const hosts = new Set()
  for (const [host, registro] of Object.entries(sites && typeof sites === 'object' ? sites : {})) {
    hosts.add(host.toLowerCase())
    for (const enlazado of [registro?.jiraHost, registro?.confluenceHost]) {
      if (typeof enlazado === 'string' && enlazado) hosts.add(enlazado.toLowerCase())
    }
  }
  const out = []
  for (const host of hosts) {
    const patron = 'https://' + host + '/*'
    if (concedidos.has(patron) && !delManifest.has(patron)) out.push('https://' + host)
  }
  return out.sort()
}

/**
 * Vuelve a registrar el content script en cada origen de `originsToRegister`
 * (H27). Un origen que falla se apunta en la consola y los demás siguen: uno
 * roto no puede dejar sin script a los otros.
 */
async function reconcileContentScripts() {
  const [sites, todos] = await Promise.all([getSites(), chrome.permissions.getAll()])
  const origenes = originsToRegister({
    sites,
    granted: todos?.origins || [],
    manifestOrigins: chrome.runtime.getManifest()?.host_permissions || [],
  })
  for (const origen of origenes) {
    await registrarScript(origen).catch((err) => console.warn('[faro] service worker', err))
  }
}

/**
 * Registra el content script para las próximas cargas de un origen si no lo
 * está ya, con el id de `scriptIdFor`. Lanza si Chrome no lo deja registrar.
 *
 * Un «Duplicate script ID» es un éxito: al dar un permiso corren a la vez la
 * reconciliación de `permissions.onAdded` y el REQUEST_HOST_PERMISSION del
 * panel, los dos pueden ver el id libre, y el segundo en registrar se lo lleva
 * con el script ya puesto, que es lo que se quería.
 */
async function registrarScript(origin) {
  const id = scriptIdFor(origin)
  const existentes = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => [])
  if (existentes?.length) return
  try {
    await chrome.scripting.registerContentScripts([
      {
        id,
        matches: [patternFor(origin)],
        js: ['src/content/bootstrap.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ])
  } catch (err) {
    if (String(err?.message || err).includes('Duplicate script ID')) return
    throw err
  }
}

/**
 * Asegura el content script de un host que no está en el manifest
 * (Server/Data Center): lo que el panel llama «Dar permiso», con el permiso YA
 * dado por el panel (H27).
 *
 * Nunca `chrome.permissions.request`, ni siquiera detrás de un `contains`, por
 * dos hechos SUPUESTOS (leídos en Chromium, a verificar en H30): el gesto del
 * clic viaja con el mensaje sólo mientras dura la parte síncrona del oyente, y
 * cualquier `await` delante lo pierde; y `request` exige el gesto aunque el
 * permiso ya esté concedido. Hasta H27 el worker lo pedía él y contestaba
 * «permiso denegado» con el permiso dado. El diálogo lo abre el panel, con el
 * clic (`requestHostPermission` de panel.js), y aquí sólo se COMPRUEBA.
 *
 * @returns {Promise<{ok:true}|{ok:false, needsPermission:true, error:string}|{ok:false, kind:string, error:string}>}
 */
async function requestHostPermission(origin, tabId) {
  const granted = await chrome.permissions.contains({ origins: [patternFor(origin)] }).catch(() => false)
  if (!granted) return { ok: false, needsPermission: true, error: 'permiso no concedido' }
  return ensureContentScript(origin, tabId)
}

/**
 * Lo que se está asegurando ahora, por origen: `{ tabId, promesa }` (H27).
 *
 * Sin gesto ni `request`, el panel asegura el script desde varios sitios a la
 * vez al abrirse (el arranque, los chips, los campos de la incidencia, «hoy»,
 * el índice), y cada uno registraba e inyectaba el suyo: la pestaña acababa con
 * dos content scripts compitiendo. Dos llamadas a la vez para la misma pestaña
 * comparten la promesa; una para OTRA pestaña del mismo origen (otro panel, en
 * otra ventana) espera su turno y asegura la suya, porque compartir le diría
 * «ok» sin haberle puesto nada.
 */
const asegurando = new Map()

/**
 * Deja el content script funcionando en un host que no está en el manifest.
 *
 * Hacen falta las dos cosas: registrarlo para las próximas cargas, e
 * inyectarlo en la pestaña que ya está abierta. Sin lo segundo habría que
 * recargar a mano, y sin lo primero se pierde al navegar.
 *
 * Y desde H27 dice la verdad de la pestaña (docs/PLAN3.md §3.1): hasta H27
 * devolvía `{ ok: true }` sin mirar, y un content script que no arrancaba (el
 * del GUID de `use_dynamic_url`) hacía decir al panel «Listo. Ya puedo
 * resaltar…» sin resaltar nada. Devuelve `{ ok: true }` o `{ ok: false, kind,
 * error }` con `kind`: `'registro'` (Chrome no deja registrarlo), `'inyeccion'`
 * (no deja inyectarlo), `'roto'` (contesta al PING, pero su arranque falló:
 * `error` es su motivo) o `'huerfano'` (nadie contesta ni después de inyectar).
 */
function ensureContentScript(origin, tabId) {
  const clave = originOf(origin) || String(origin)
  const pestana = tabId ?? null
  const enCurso = asegurando.get(clave)
  if (enCurso && enCurso.tabId === pestana) return enCurso.promesa
  const turno = enCurso ? enCurso.promesa.catch(() => null) : Promise.resolve()
  const promesa = turno.then(() => asegurarAhora(origin, tabId))
  asegurando.set(clave, { tabId: pestana, promesa })
  promesa
    .catch(() => null)
    .finally(() => {
      if (asegurando.get(clave)?.promesa === promesa) asegurando.delete(clave)
    })
  return promesa
}

/** El cuerpo de `ensureContentScript`, ya con el turno de su origen. */
async function asegurarAhora(origin, tabId) {
  try {
    await registrarScript(origin)
  } catch (err) {
    return { ok: false, kind: 'registro', error: 'no se pudo registrar el script: ' + (err?.message || err) }
  }
  if (tabId == null) return { ok: true }

  // ¿Ya hay alguien? Uno que contesta bien sólo necesita los ajustes; uno que
  // contesta roto NO se reinyecta: Chrome guarda en su mapa de módulos el import
  // que falló (whatwg/html#6768), y una segunda instancia en el mismo mundo
  // sólo añadiría otro oyente compitiendo con el viejo.
  const antes = await sendToTab(tabId, { type: MSG.PING })
  if (antes != null) return trasElPing(tabId, antes)

  // Nadie: la pestaña abierta no lo tiene todavía y se inyecta ahora mismo.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/bootstrap.js'] })
  } catch (err) {
    return { ok: false, kind: 'inyeccion', error: 'no se pudo inyectar: ' + (err?.message || err) }
  }
  // Y se comprueba que el recién puesto contesta: sin este segundo PING, una
  // inyección «buena» que no arranca nada era un «Listo» falso.
  const despues = await sendToTab(tabId, { type: MSG.PING })
  if (despues != null) return trasElPing(tabId, despues)
  return { ok: false, kind: 'huerfano', error: 'el content script no contesta' }
}

/**
 * Lo que dice un PING que contestó: listo, con los ajustes de la página detrás,
 * o roto, con el motivo que da el propio content script.
 */
async function trasElPing(tabId, ping) {
  if (!ping.ok) return { ok: false, kind: 'roto', error: String(ping.error || 'el content script no arranca') }
  // El panel marca justo después de «Dar permiso», sin otra comprobación: la
  // tinta y el estilo tienen que estar ya en la página (ver `contentStatus`).
  await pushSettings(tabId).catch(() => null)
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

/**
 * ¿Puede Faro actuar sobre esta pestaña ahora mismo? Y, si contesta, se le
 * empujan los ajustes de la página.
 *
 * Es la puerta que el panel cruza SIEMPRE antes de marcar o de señalar
 * (`ensureContentAccess`). Pasó de verdad (revisión adversaria de H23, A1): la
 * tinta elegida no llegaba a una pestaña sin recorrido —`onContentReady` sale
 * antes de `pushSettings` si no hay uno, y el `onChanged` sólo empuja a la
 * activa—, así que un «Analizar» pintaba en azul aunque se hubiera elegido
 * ámbar. Empujar no arranca nada: desde H27 ni PING ni SETTINGS arrancan el
 * content script, que guarda los ajustes y los aplica cuando llega el primer
 * mensaje de verdad (hasta H27 era el PING el que lo arrancaba entero, y el
 * SETTINGS iba detrás sin coste). Con el `await`, SETTINGS llega antes que el
 * ANNOTATE que viene detrás; y con el `.catch`, un almacén roto no hace creer
 * al panel que la pestaña no está lista.
 *
 * Devuelve `{ granted, ready, alive, error }`, siempre las cuatro (H27): hasta
 * H27 sólo `{ granted, ready }`, y un content script que no arrancaba (contesta
 * `{ ok: false }` a todo, PING incluido) era «no listo» igual que una pestaña
 * sin script, así que el panel pedía un permiso que ya tenía. `alive` es que
 * alguien contesta; `error`, si contesta roto, su motivo (`''` si no).
 */
async function contentStatus(tabId, origin) {
  const granted = origin
    ? await chrome.permissions.contains({ origins: [patternFor(origin)] }).catch(() => false)
    : false
  const ping = tabId != null ? await sendToTab(tabId, { type: MSG.PING }) : null
  const alive = ping != null
  const ready = !!ping?.ok
  const error = ping && ping.ok === false ? String(ping.error || 'el content script no arranca') : ''
  if (ping?.ok) await pushSettings(tabId).catch(() => null)
  return { granted, ready, alive, error }
}

// --------------------------------------------------------------- navegación

async function pushSettings(tabId) {
  const s = await getSettings()
  await sendToTab(tabId, {
    type: MSG.SETTINGS,
    reduceMotion: s.reduceMotion,
    highlightStyle: s.highlightStyle,
    highlightColor: s.highlightColor,
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
