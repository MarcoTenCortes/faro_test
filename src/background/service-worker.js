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
import { parseAtlassianUrl, samePage, sameSearch, validProjectKey } from '../atlassian/site.js'
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
 * detrás de cada PING que contesta bien, y `ensureContentScript` detrás de su
 * PING bueno, antes o después de inyectar. Una carga SIN recorrido no los
 * recibe, a propósito. Hasta H27 el motivo era que el primer mensaje arrancaba
 * el content script entero (18 módulos, ~256 KB y un sondeo cada 700 ms);
 * desde H27 SETTINGS y el PING ligero ya no lo arrancan (la página guarda los
 * ajustes hasta el primer mensaje de verdad; sólo arranca el PING con
 * `arrancar` de `ensureContentScript`), y lo que queda es peso y sentido:
 * empujarlos a cada pestaña, o en cada carga, sería una lectura del almacén y
 * un mensaje por página para nada, porque el panel comprueba la pestaña antes
 * de marcar o de señalar y ahí llegan.
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
          if (desdeUnaPestana(sender, sendResponse)) return
          await sendToTab(msg.tabId, { type: MSG.CANCEL, reason: 'panel' })
          await setPlan(msg.tabId, null)
          sendResponse({ ok: true })
          return

        case MSG.REQUEST_HOST_PERMISSION:
          if (desdeUnaPestana(sender, sendResponse)) return
          sendResponse(await requestHostPermission(msg.origin, msg.tabId))
          return

        case MSG.CONTENT_STATUS:
          if (desdeUnaPestana(sender, sendResponse)) return
          sendResponse(await contentStatus(msg.tabId, msg.origin))
          return

        // Los dos avisos del content script apuntan la visita ANTES de seguir
        // con lo suyo: traen el `pageId` de la meta `ajs-page-id`, que es lo
        // único que identifica una página `/display/ESPACIO/Título` de un
        // Confluence Data Center y que `tabs.onUpdated` no puede saber. Va con
        // `.catch` propio para que el diario no pueda tumbar un recorrido. Y
        // desde H28 el aviso entero va a `onContentReady`: con ese `pageId` y
        // su URL se sabe si la página que avisa es la de destino.
        case MSG.CONTENT_READY:
          await recordVisitFor(msg.url || sender.tab?.url, {
            title: sender.tab?.title,
            pageId: msg.pageId,
          }).catch(() => null)
          await onContentReady(sender.tab?.id, msg)
          sendResponse({ ok: true })
          return

        // Y desde la revisión adversaria de H28 (D1), en la fase 'anchor' el de
        // URL cambiada cuenta como el de «lista»: una SPA cambia de vista sin
        // recargar, y si su URL cambia después de que el último clic conteste,
        // no llega ningún CONTENT_READY (ver `onUrlChanged`).
        case MSG.URL_CHANGED:
          await recordVisitFor(msg.url || sender.tab?.url, {
            title: sender.tab?.title,
            pageId: msg.pageId,
          }).catch(() => null)
          await onUrlChanged(sender.tab?.id, msg)
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
 * C5-9). Los cinco mensajes panel → worker (lanzar un recorrido, navegar,
 * cortarlo, asegurar el content script y preguntar por él) son del panel, que
 * no es una pestaña: con esto una página (un content script, o una página de
 * la extensión abierta en una pestaña) no puede mandar al worker a navegar ni
 * a inyectar, ni cortar el recorrido de otra pestaña, ni sondear el permiso de
 * un origen cualquiera o el estado de otra pestaña. Hasta la revisión
 * adversaria de H27 (G8) la guarda estaba en tres de los cinco.
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
 * Pura. ¿Pone ya Chrome el content script por su cuenta en este origen
 * (`esquema://host` o `esquema://host:puerto`)? Es decir: ¿lo casa alguno de
 * `matches`, los patrones de `content_scripts` del manifest? (Revisión
 * adversaria de H27, G7.)
 *
 * Casa por PATRÓN, como Chrome, y no por cadena exacta. Hasta aquí se buscaba
 * el `https://host/*` fabricado entre los `host_permissions`: un
 * `acme.atlassian.net` guardado y concedido por su host no casaba con el
 * comodín de Cloud y se registraba otra vez, y un host propio concedido con
 * puerto no casaba con el patrón fabricado y no se reconciliaba nunca. Y los
 * `host_permissions` no son lo que cubre `content_scripts`: 127.0.0.1 y
 * localhost tienen permiso y ningún script declarado. Un esquema `*` vale para
 * http y https; un host `*.dominio`, para el dominio y sus subdominios (nunca
 * para uno que sólo acabe igual); un patrón sin puerto, para cualquier puerto;
 * y sólo cubre el origen entero un patrón cuya ruta es la entera.
 *
 * @param {string} origin
 * @param {string[]} matches
 * @returns {boolean}
 */
export function cubiertoPorContentScripts(origin, matches) {
  let u
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  const esquema = u.protocol.slice(0, -1)
  const puerto = u.port || (esquema === 'https' ? '443' : '80')
  const host = u.hostname.toLowerCase()
  for (const patron of Array.isArray(matches) ? matches : []) {
    const m = /^(\*|https?):\/\/([^/:]+)(?::(\d+|\*))?\/(.*)$/.exec(String(patron))
    if (!m || m[4] !== '*') continue
    const [, esquemaP, hostP, puertoP] = m
    if (esquemaP === '*' ? esquema !== 'http' && esquema !== 'https' : esquemaP !== esquema) continue
    if (puertoP && puertoP !== '*' && puertoP !== puerto) continue
    const h = hostP.toLowerCase()
    if (h === '*' || h === host) return true
    if (h.startsWith('*.') && (host === h.slice(2) || host.endsWith(h.slice(1)))) return true
  }
  return false
}

/**
 * Los `matches` de `content_scripts` del manifest, todos en una lista: lo que
 * Chrome ya pone solo en cada carga (hoy, sólo Cloud) y que el worker no
 * registra a mano (revisión adversaria de H27, G7).
 */
function matchesDelManifest() {
  return (chrome.runtime.getManifest()?.content_scripts || []).flatMap((c) => (Array.isArray(c?.matches) ? c.matches : []))
}

/**
 * Pura. Los orígenes en los que el worker registra el content script a mano
 * (H27), sin repetidos y en orden alfabético.
 *
 * Se parte de los permisos CONCEDIDOS y no de un patrón fabricado con el host
 * (revisión adversaria de H27, G7): entra cada patrón https concedido (o de
 * esquema `*`) de un solo host cuyo nombre, sin el puerto, sea una clave de
 * `faro:sites` o uno de sus enlazados (`jiraHost`, `confluenceHost`), con su
 * puerto si lo lleva; y sale el que ya cubre `content_scripts`
 * (`cubiertoPorContentScripts`). Sólo https: lo http del manifest (127.0.0.1 y
 * localhost, el banco) lo asegura el «Dar permiso» del panel puerto a puerto,
 * y reconciliarlo aquí lo ensancharía a todos los puertos.
 *
 * La concesión del permiso es el consentimiento: un registro con
 * `configured: false` (tras «Quitar las claves», H19) o sin `configured` (las
 * claves saltadas) sigue siendo un sitio de la persona, y sin su script el
 * subrayado y «Paso a paso» pedirían «Dar permiso» tras cada recarga de la
 * extensión (decisión del orquestador, que relaja docs/PLAN3.md §3.1).
 *
 * @param {{sites?: object, granted?: string[], contentScriptMatches?: string[]}} entrada
 * @returns {string[]} orígenes `https://host` o `https://host:puerto`
 */
export function originsToRegister({ sites, granted, contentScriptMatches } = {}) {
  const hosts = new Set()
  for (const [host, registro] of Object.entries(sites && typeof sites === 'object' ? sites : {})) {
    hosts.add(host.toLowerCase())
    for (const enlazado of [registro?.jiraHost, registro?.confluenceHost]) {
      if (typeof enlazado === 'string' && enlazado) hosts.add(enlazado.toLowerCase())
    }
  }
  const out = []
  for (const patron of Array.isArray(granted) ? granted : []) {
    const m = /^(\*|https):\/\/([^/]+)\/\*$/.exec(String(patron))
    if (!m || m[2].includes('*')) continue
    const origen = originOf('https://' + m[2])
    if (!origen || !hosts.has(new URL(origen).hostname)) continue
    if (cubiertoPorContentScripts(origen, contentScriptMatches) || out.includes(origen)) continue
    out.push(origen)
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
    contentScriptMatches: matchesDelManifest(),
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
 * panel (y dos pestañas del mismo origen se aseguran a la vez: ver
 * `asegurando`), los dos pueden ver el id libre, y el segundo en registrar se
 * lo lleva con el script ya puesto, que es lo que se quería.
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
 * Lo que se está asegurando ahora, por origen Y pestaña: clave → promesa (H27).
 *
 * Sin gesto ni `request`, el panel asegura el script desde varios sitios a la
 * vez al abrirse (el arranque, los chips, los campos de la incidencia, «hoy»,
 * el índice), y cada uno registraba e inyectaba el suyo: la pestaña acababa con
 * dos content scripts compitiendo. Dos llamadas a la vez para la misma pestaña
 * comparten la promesa. Una para OTRA pestaña del mismo origen (otro panel, en
 * otra ventana) ni la comparte, porque le diría «ok» sin haberle puesto nada,
 * ni la espera: hasta la revisión adversaria de H27 (G9) esperaba su turno, y
 * una pestaña que no contestaba al PING (`sendMessage` no tiene plazo) dejaba
 * colgada a la otra. Esperar no hacía falta: lo único que comparten, el
 * registro, ya aguanta la carrera (el segundo se lleva un «Duplicate script
 * ID», que es un éxito), y la inyección es de cada pestaña.
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
 *
 * Los PING de aquí piden ARRANCAR (`arrancar: true`, revisión adversaria de
 * H27, G1), y los de `contentStatus` y `watchStalledStep` no: un PING ligero
 * sólo prueba que hay un oyente, y lo contesta bien un content script cuyo
 * arranque va a fallar (antes de arrancar sólo ha cargado una hoja,
 * messages.js). Con él, un script recién inyectado que no arrancaba pasaba los
 * dos PING y el «Listo» volvía a ser falso. Así `{ ok: true }` quiere decir
 * que el content script ha ARRANCADO.
 */
function ensureContentScript(origin, tabId) {
  const clave = (originOf(origin) || String(origin)) + ' ' + (tabId ?? '')
  const enCurso = asegurando.get(clave)
  if (enCurso) return enCurso
  const promesa = asegurarAhora(origin, tabId)
  asegurando.set(clave, promesa)
  promesa.catch(() => null).finally(() => { if (asegurando.get(clave) === promesa) asegurando.delete(clave) })
  return promesa
}

/**
 * El cuerpo de `ensureContentScript`. No espera a nadie: otra pestaña del
 * mismo origen asegura la suya a la vez, y lo único que comparten, el
 * registro, ya es idempotente (ver `asegurando`).
 */
async function asegurarAhora(origin, tabId) {
  // Lo que ya cubre `content_scripts` (Cloud) no se registra otra vez: Chrome
  // lo pone solo en cada carga, y un script dinámico encima lo duplicaría
  // (revisión adversaria de H27, G7). Lo que sí puede hacer falta es ponerlo en
  // una pestaña que ya estaba abierta al instalar, y eso va abajo.
  try {
    if (!cubiertoPorContentScripts(originOf(origin), matchesDelManifest())) await registrarScript(origin)
  } catch (err) {
    return { ok: false, kind: 'registro', error: 'no se pudo registrar el script: ' + (err?.message || err) }
  }
  if (tabId == null) return { ok: true }

  // ¿Ya hay alguien? Uno que arranca bien sólo necesita los ajustes; uno que
  // contesta roto NO se reinyecta: Chrome guarda en su mapa de módulos el import
  // que falló (whatwg/html#6768), y reinyectar en el mismo mundo no hace nada:
  // `window.__faroBooted` deja la segunda instancia en nada. Uno que estaba y no
  // había arrancado (el de `content_scripts`, o el de una carga sin mensajes)
  // arranca ahora, con este PING.
  const antes = await sendToTab(tabId, { type: MSG.PING, arrancar: true })
  if (antes != null) return trasElPing(tabId, antes)

  // Nadie: la pestaña abierta no lo tiene todavía y se inyecta ahora mismo.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/bootstrap.js'] })
  } catch (err) {
    return { ok: false, kind: 'inyeccion', error: 'no se pudo inyectar: ' + (err?.message || err) }
  }
  // Y se comprueba que el recién puesto ARRANCA: sin este segundo PING, una
  // inyección «buena» que no arranca nada era un «Listo» falso; y con uno
  // ligero también, porque ése lo contesta antes de intentar arrancar.
  const despues = await sendToTab(tabId, { type: MSG.PING, arrancar: true })
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
 *
 * Y el motivo es el de verdad (H28, docs/PLAN3.md §3.2): una pestaña que
 * contesta al PING, pero roto (el content script vivo cuyo arranque falló, que
 * desde H27 lo dice con su `error`), no es una que «no responde». Hasta H28 se
 * decía eso, y recargar la pestaña no arregla lo mismo que lo que de verdad
 * falla.
 */
function watchStalledStep(tabId, index, ms = NAV_TIMING.stepStallMs) {
  setTimeout(async () => {
    const state = await getPlan(tabId)
    if (!state || state.index !== index || state.phase !== 'steps') return
    const alive = await sendToTab(tabId, { type: MSG.PING })
    if (alive?.ok) return runCurrentStep(tabId)

    await setPlan(tabId, null)
    const error =
      alive && alive.ok === false
        ? 'El script de Faro en la página no arranca: ' + (alive.error || 'sin motivo') + '. Recarga la pestaña y vuelve a intentarlo.'
        : 'La página no responde. Recárgala y vuelve a intentarlo.'
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error } })
  }, ms)
}

/**
 * El vigilante del salto (H28, docs/PLAN3.md §3.2): si la página de destino de
 * un salto por URL no avisa de que cargó en `NAV_TIMING.anchorStallMs`, el
 * salto se abandona con un motivo.
 *
 * Hasta H28 un salto directo, o el último paso que llegaba por URL, se quedaba
 * en la fase 'anchor' para siempre si la página no avisaba (una página de
 * error, un login, un content script que no carga): el panel no decía nada, y
 * el primer aviso de CUALQUIER página de esa pestaña, horas después, anclaba
 * ahí el recorrido viejo.
 *
 * Vigila el recorrido que había al armarlo, no la pestaña: el de un salto
 * viejo que vence cuando ya hay otro en la misma pestaña (dos «Llévame»
 * seguidos) no puede abandonar el nuevo, que todavía está cargando. El mapa ya
 * está hidratado: se arma siempre detrás de un `setPlan`.
 *
 * Y al vencer mira la pestaña (revisión adversaria de H28, D2): si sigue
 * cargando, UNA prórroga del mismo margen (un Data Center lento no es un salto
 * perdido); si ha acabado en OTRA página, lo dice (`enOtraPagina`) y no manda
 * recargar, que no arregla un login ni una incidencia movida. Se vuelve a
 * mirar el recorrido después de leer la pestaña: el aviso del destino puede
 * haberlo terminado mientras tanto, y serían dos finales.
 */
function watchStalledAnchor(tabId, ms = NAV_TIMING.anchorStallMs) {
  const armado = plans.get(tabId)
  const vence = (prorroga) =>
    setTimeout(async () => {
      const state = await getPlan(tabId)
      if (!state || state !== armado || state.phase !== 'anchor') return
      const tab = await chrome.tabs.get(tabId).catch(() => null)
      if (plans.get(tabId) !== armado) return
      if (prorroga && tab?.status === 'loading') return vence(false)
      await setPlan(tabId, null)
      const otra = enOtraPagina(tab?.url, state.plan.destination)
      const error = 'La página de destino no ha avisado de que cargó. Recárgala y vuelve a intentarlo.'
      notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error: otra || error } })
    }, ms)
  vence(true)
}

/**
 * Pura. Si la pestaña de un salto que no avisó ha acabado en OTRA página que
 * la de destino `d`, el motivo que lo dice; si no se puede afirmar, `''`
 * (revisión adversaria de H28, D2).
 *
 * Sólo con una URL que lo prueba: una ruta de login (`/login.action` de un
 * Confluence Data Center, `/login.jsp` de un Jira, `id.atlassian.com/login`),
 * o un id de página o una clave de incidencia que no son los del destino (una
 * incidencia movida, OLD-12 → NEW-34). Un `/display/ESPACIO/Título` de un Data
 * Center no lleva el id, y ahí no se sabe. De la URL sólo sale la ruta (y el
 * host, si es otro): la consulta puede llevar cualquier cosa, un token
 * incluido, y no va al panel.
 */
function enOtraPagina(url, d) {
  let u
  try {
    u = new URL(url)
  } catch {
    return ''
  }
  const login = /\/login(\.action|\.jsp)?\/?$/i.test(u.pathname)
  const aqui = parseAtlassianUrl(u.href)
  // El id de la URL va también como `pageId`: un `/display/…` del destino que
  // el Data Center reescribe a `viewpage.action?pageId=` sigue siendo él.
  const otraPorId = !!(aqui?.pageId || aqui?.issueKey) && !llegaAlDestino({ url: u.href, pageId: aqui.pageId || '' }, d)
  if (!login && !otraPorId) return ''
  const ruta = (u.origin === originOf(d?.url) ? u.pathname : u.host + u.pathname).slice(0, 120)
  const titulo = String(d?.title || '').trim().slice(0, 120)
  return 'La pestaña ha acabado en otra página (' + ruta + '), no en ' + (titulo ? '«' + titulo + '»' : 'la de destino') + '.'
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
 * ámbar. Empujar no arranca nada: desde H27 ni este PING (el ligero, sin
 * `arrancar`: sólo pide arrancar el de `ensureContentScript`) ni SETTINGS
 * arrancan el content script, que guarda los ajustes y los aplica cuando llega
 * el primer mensaje de verdad (hasta H27 era el PING el que lo arrancaba
 * entero, y el SETTINGS iba detrás sin coste). Con el `await`, SETTINGS llega
 * antes que el ANNOTATE que viene detrás; y con el `.catch`, un almacén roto no
 * hace creer al panel que la pestaña no está lista.
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

/**
 * Navegación directa: un salto y, al llegar, el resaltado.
 *
 * «Ya estoy» lo decide `samePage` (site.js), que compara el id de la página o
 * la clave de la incidencia y, sin ninguno de los dos, origen y ruta (H28,
 * docs/PLAN3.md §3.2). Hasta H28 era `sameDoc`, origen y ruta siempre: en un
 * Confluence Data Center todas las páginas por id son
 * `/pages/viewpage.action?pageId=…`, así que dos distintas eran «la misma» y
 * «Llévame» anclaba en la de partida sin moverse. Una búsqueda de Jira no
 * lleva id ni clave y su ruta es la de todas (`/issues/`): se compara por su
 * consulta, `sameSearch` (revisión adversaria de H28, D4). Y esa rama avisa al
 * panel con PLAN_FINISHED, como la de llegar: hasta H28 devolvía el resultado
 * en la respuesta, que el panel no lee.
 *
 * Sin permiso de host en el destino no hay content script que avise ni que
 * resalte (revisión adversaria de H28, D2): se lleva igual, sin recorrido ni
 * vigilante, y si había un fragmento que resaltar se dice en un final sin
 * error, que el panel pinta en ámbar («Sin resaltar»). Sólo `contains`: con el
 * acceso retirado a un host del manifest, su script estático tampoco entra.
 * Hasta aquí el vigilante daba a los 12 s un «no ha avisado… Recárgala» en
 * rojo con la pestaña ya en su sitio.
 *
 * Los ajustes de la página van con `.catch` (H28): son un extra, y un almacén
 * que no se deja leer no puede impedir el salto. Si el salto no sale
 * (`saltarAlDestino` lanza), el error llega al panel en la respuesta y el
 * recorrido ya no queda guardado (revisión adversaria de H28, D8).
 */
async function navigateDirect(tabId, plan) {
  if (!plan?.destination?.url) return { ok: false, error: 'plan sin destino' }
  await pushSettings(tabId).catch(() => null)

  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const alreadyThere =
    plan.destination.kind === 'jira-jql'
      ? sameSearch(tab?.url || '', plan.destination.url)
      : samePage(tab?.url || '', plan.destination.url)

  const origen = originOf(plan.destination.url)
  const avisara = !!origen && (await chrome.permissions.contains({ origins: [patternFor(origen)] }).catch(() => false))
  if (!avisara) {
    await setPlan(tabId, null)
    if (!alreadyThere) await chrome.tabs.update(tabId, { url: plan.destination.url })
    if (plan.anchor) {
      const host = origen ? new URL(origen).host : 'este sitio'
      const message = (alreadyThere ? 'Ya estás en la página' : 'Te he llevado') + ', pero sin permiso en ' + host + ' no puedo resaltar el fragmento.'
      notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { anchored: false, message } })
    }
    return { ok: true, navigating: !alreadyThere, anchored: false }
  }

  if (!alreadyThere) {
    await setPlan(tabId, { plan, index: plan.steps?.length || 0, phase: 'anchor' })
    // El resto lo hace onContentReady cuando la página nueva avise; y si no
    // avisa, el vigilante del salto, que arma `saltarAlDestino`.
    await saltarAlDestino(tabId, plan.destination.url)
    return { ok: true, navigating: true }
  }

  const res = await sendAnchor(tabId, plan)
  await setPlan(tabId, null)
  notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: res ?? { ok: false, error: 'la página no ha contestado al anclar' } })
  return { ok: true, navigating: false, result: res }
}

/**
 * El salto por URL de un recorrido que ya está en la fase 'anchor', y su
 * vigilante detrás (revisión adversaria de H28, D8).
 *
 * Si `tabs.update` lanza («Navigation rejected.», o la pestaña ya no existe),
 * el recorrido se suelta antes de relanzar: hasta aquí se quedaba guardado en
 * 'anchor' SIN vigilante, porque el vigilante se armaba después del `await`, y
 * el primer aviso del destino en esa pestaña, a cualquier hora, lo anclaba.
 * Sólo si sigue siendo el mismo: otro que se haya guardado mientras tanto (otro
 * «Llévame» en la misma pestaña) es de otro, y sigue esperando su aviso. El
 * vigilante se arma con el salto ya en marcha: el de uno que no salió no tiene
 * nada que vigilar.
 */
async function saltarAlDestino(tabId, url) {
  const armado = plans.get(tabId)
  try {
    await chrome.tabs.update(tabId, { url })
  } catch (err) {
    if (plans.get(tabId) === armado) await setPlan(tabId, null)
    throw err
  }
  watchStalledAnchor(tabId)
}

/**
 * Navegación asistida: se manda un paso y se espera a que la pestaña avise.
 * Los ajustes de la página, con `.catch`: como en `navigateDirect` (H28).
 */
async function startPlan(tabId, plan) {
  if (!plan?.steps?.length) return navigateDirect(tabId, plan)
  await pushSettings(tabId).catch(() => null)
  await setPlan(tabId, { plan, index: 0, phase: 'steps' })
  return runCurrentStep(tabId)
}

async function runCurrentStep(tabId) {
  const state = await getPlan(tabId)
  if (!state) return { ok: false, error: 'no hay recorrido en marcha' }

  const { plan, index } = state
  // Todos los pasos dados, y la pestaña en el destino: se ancla. El recorrido
  // se suelta ANTES de anclar, como en `onContentReady` (revisión adversaria de
  // H28, D1): anclar tarda (la página busca la cita), y un aviso del destino
  // que llegara mientras tanto, o el margen de `advanceAfterNavigation` al
  // acabar, lo encontraban vivo y anclaban otra vez: dos ANCHOR y dos finales.
  // Y una página que no contesta al anclar se dice, como en los otros dos
  // sitios que anclan: con `null` el panel no pintaba ni registraba nada.
  if (index >= plan.steps.length) {
    await setPlan(tabId, null)
    const res = await sendAnchor(tabId, plan)
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: res ?? { ok: false, error: 'la página no ha contestado al anclar' } })
    return { ok: true, finished: true, result: res }
  }

  const step = plan.steps[index]
  const esUltimo = index === plan.steps.length - 1
  notifyPanel({ type: MSG.PLAN_PROGRESS, tabId, index, total: plan.steps.length, step })

  const res = await sendToTab(tabId, {
    type: MSG.STEP,
    step,
    index,
    total: plan.steps.length,
    isLast: esUltimo,
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

    // `avisado`: el panel ya tiene su final con el motivo, y no lo repite como
    // «Navegación fallida» (revisión adversaria de H28, D7).
    if (!granted) {
      await setPlan(tabId, null)
      const error = 'Faro no tiene permiso para actuar en este dominio.'
      notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error, needsPermission: true } })
      return { ok: false, error, needsPermission: true, avisado: true }
    }

    // Permiso hay, así que se le da un margen para que termine de cargar.
    watchStalledStep(tabId, index)
    return { ok: true, waiting: true }
  }

  // La pestaña contesta, pero no ha podido ejecutar el paso (H28, docs/PLAN3.md
  // §3.2). Todos los resultados legítimos de `executeStep` llevan `status`; un
  // `{ ok: false }` sin él es el `catch` del content script: su arranque falló
  // (H27) o el paso lanzó. Hasta H28 caía en el `default` y se saltaba: con el
  // script roto se saltaban TODOS, se anclaba en la página de partida y
  // START_PLAN decía `ok`. Ahora se acaba con su motivo; salvo en el destino,
  // que puede llegar por URL como el `navigate` del último paso: llevar a la
  // persona sigue valiendo más que abandonar, y el motivo va en el progreso.
  // Con `avisado`, como la rama del permiso: el final ya salió (D7).
  if (res.ok === false && !res.status) {
    const motivo = String(res.error || 'sin motivo')
    if (esUltimo && step.url) {
      notifyPanel({ type: MSG.PLAN_PROGRESS, tabId, index, total: plan.steps.length, step, reason: motivo })
      return navigateToDestination(tabId, state, step)
    }
    await setPlan(tabId, null)
    const error = 'La página no ha podido ejecutar el paso ' + (index + 1) + ': ' + motivo + '. Recárgala y vuelve a intentarlo.'
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error } })
    return { ok: false, error: motivo, avisado: true }
  }

  switch (res.status) {
    case 'expanded':
      // Desplegar una rama no recarga la página: se puede seguir enseguida.
      await setPlan(tabId, { ...state, index: index + 1 })
      return runCurrentStep(tabId)

    case 'clicked':
      // El último clic lo decide la RESPUESTA de la página que pulsó (revisión
      // adversaria de H28, D1; reproducido en Chromium): en un Data Center
      // pulsar el enlace del árbol es una carga entera, y la página VIEJA se da
      // por quieta antes de morir y contesta con su propia URL. Si esa URL no
      // es el destino, el recorrido espera el aviso del destino en la fase
      // 'anchor', con su vigilante, como un salto por URL; anclar tras el
      // margen mandaba el ANCHOR a la página de partida, o a nadie. Sin `url`
      // («ya estábamos aquí») o con la del destino (una SPA que ya cambió de
      // vista), se sigue como siempre. `res.pageId` es el de la página que
      // contesta: en un Data Center `/display/…` la URL no lo lleva.
      if (esUltimo && res.url && !llegaAlDestino(res, plan.destination)) {
        await setPlan(tabId, { ...state, index: plan.steps.length, phase: 'anchor' })
        watchStalledAnchor(tabId)
        return { ok: true, navigating: true }
      }
      await setPlan(tabId, { ...state, index: index + 1 })
      return advanceAfterNavigation(tabId)

    case 'skipped':
      await setPlan(tabId, { ...state, index: index + 1 })
      return runCurrentStep(tabId)

    case 'navigate': {
      // Sólo el destino puede llegar por URL. Una carga de página a mitad del
      // recorrido pliega el árbol entero y deja sin base a los pasos que
      // quedan — que es exactamente lo que hacía que la navegación guiada
      // acabase siendo un salto seco. Un paso intermedio que no se pudo pulsar
      // se salta y se sigue.
      if (!esUltimo) {
        await setPlan(tabId, { ...state, index: index + 1 })
        return runCurrentStep(tabId)
      }
      return navigateToDestination(tabId, state, step)
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
 * El último paso llega por URL: el `navigate` del destino o, desde H28, el que
 * la pestaña no pudo ejecutar. El recorrido queda en la fase 'anchor', con
 * todos los pasos dados, y el aviso de la página de destino lo termina como
 * termina un salto directo (`onContentReady`), con su vigilante por si no avisa
 * (docs/PLAN3.md §3.2). Hasta H28 se quedaba en la fase 'steps' y anclaba con el
 * primer aviso de cualquier página, o esperaba para siempre.
 *
 * Si el salto no sale, se dice al panel con su PLAN_FINISHED y `avisado`
 * (revisión adversaria de H28, D8): retomado por CONTENT_READY, la respuesta
 * va al content script, que la tira, y el panel se quedaba con «paso 3/3» y su
 * «Parar» sin saber nada.
 */
async function navigateToDestination(tabId, state, step) {
  await setPlan(tabId, { ...state, index: state.plan.steps.length, phase: 'anchor' })
  try {
    await saltarAlDestino(tabId, step.url)
  } catch (err) {
    const error = 'No he podido llevarte al destino: ' + String(err?.message || err)
    notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: { error } })
    return { ok: false, error, avisado: true }
  }
  return { ok: true, navigating: true }
}

/**
 * Tras un clic que no dejó la pestaña en otra página, se da un respiro
 * (`NAV_TIMING.afterClickMs`) y se sigue: es lo que tarda una SPA en cambiar
 * de vista sin recargar. Una recarga de verdad no se espera aquí: la del
 * último clic la termina el aviso del destino en la fase 'anchor' (ver el
 * `clicked` de `runCurrentStep`), y la de un paso intermedio la retoma
 * `onContentReady` con el paso que no llegó a contestar. Hasta la revisión
 * adversaria de H28 (D1) el comentario decía que una recarga «se adelantaría»
 * a este respiro, y cualquiera más lenta que él anclaba en la página vieja.
 */
async function advanceAfterNavigation(tabId) {
  await new Promise((r) => setTimeout(r, NAV_TIMING.afterClickMs))
  const state = await getPlan(tabId)
  if (!state) return { ok: true, cancelled: true }
  return runCurrentStep(tabId)
}

/**
 * Una pestaña avisa de que ha cargado (CONTENT_READY): si tiene un recorrido,
 * sigue.
 *
 * En la fase 'anchor' (un salto por URL esperando a su página) sólo cuenta el
 * aviso de la página de DESTINO (H28, docs/PLAN3.md §3.2): hasta H28 valía el
 * de cualquiera, y un salto que no llegaba anclaba en la primera página que
 * avisara, aunque fuera otra y horas después. Otro aviso no hace nada: si el
 * destino no llega, el vigilante del salto lo dice.
 *
 * El recorrido se suelta ANTES de anclar: si el vigilante venciera mientras
 * tanto, no puede abandonar con «no ha avisado» un salto que sí llegó. Y los
 * ajustes de la página, con `.catch`: son un extra, y un almacén que no se
 * deja leer no puede dejar un recorrido sin terminar.
 */
async function onContentReady(tabId, msg) {
  if (!tabId) return
  const state = await getPlan(tabId)
  if (!state) return
  if (state.phase === 'anchor') return anclarSiLlega(tabId, state, msg)
  await pushSettings(tabId).catch(() => null)
  await runCurrentStep(tabId)
}

/**
 * Una SPA cambia de vista sin recargar (URL_CHANGED): en la fase 'anchor', su
 * aviso cuenta como el de «lista», con la misma regla (revisión adversaria de
 * H28, D1). Es el último clic de Cloud cuya URL cambia después de que la
 * página se dé por quieta: el clic contesta con la de partida y el recorrido
 * espera al destino, que no manda CONTENT_READY porque no recarga. En la fase
 * 'steps' no hace nada, como siempre: un paso lo retoma el aviso de una recarga.
 *
 * Sólo lo manda un content script que ya ARRANCÓ (el sondeo de la URL vive en
 * su `boot()`), es decir, el de la página donde corrieron los pasos: el de una
 * página recién cargada por un salto todavía no arrancó y avisa con
 * CONTENT_READY.
 */
async function onUrlChanged(tabId, msg) {
  if (!tabId) return
  const state = await getPlan(tabId)
  if (state?.phase === 'anchor') await anclarSiLlega(tabId, state, msg)
}

/**
 * La fase 'anchor' termina con el aviso de la página de DESTINO: si `msg`
 * viene de ella, se ancla y se avisa al panel; si no, nada (el vigilante del
 * salto dirá lo que pase). El recorrido se suelta ANTES de anclar (ver
 * `onContentReady`).
 */
async function anclarSiLlega(tabId, state, msg) {
  if (!llegaAlDestino(msg, state.plan.destination)) return
  await setPlan(tabId, null)
  await pushSettings(tabId).catch(() => null)
  const res = await sendAnchor(tabId, state.plan)
  notifyPanel({ type: MSG.PLAN_FINISHED, tabId, result: res ?? { ok: false, error: 'la página no ha contestado al anclar' } })
}

/**
 * Pura. ¿El aviso de «lista» (`{ url, pageId }`, bootstrap.js) viene de la
 * página de destino `d` del recorrido? (H28, docs/PLAN3.md §3.2)
 *
 * Siempre en el MISMO origen que el destino, también por `pageId` (revisión
 * adversaria de H28, D8): un aviso de otro sitio con el mismo número anclaba.
 * Por el `pageId` que el content script lee de la meta `ajs-page-id` —en un
 * Confluence Data Center la URL `/display/ESPACIO/Título` no lo lleva— y, sin
 * él, por `samePage` (site.js), que compara el id o la clave y, a falta de
 * ellos, la ruta. Nunca por origen y ruta a secas delante (el `sameDoc` de
 * antes): en un Data Center todas las páginas por id son `/pages/viewpage.action`.
 *
 * Una búsqueda de Jira, por su consulta (`sameSearch`, D4): un Data Center la
 * reescribe a su vista de detalle (`/browse/K-1?jql=…`) y Cloud le añade
 * `&selectedIssue=`.
 *
 * Un espacio o un proyecto no tienen una URL fija: `/wiki/spaces/ENG` se abre
 * como `/wiki/spaces/ENG/overview`, `/display/ENG` como `/display/ENG/Home`, y
 * un tablero lleva su número detrás. Ahí cuenta su clave, y la que se compara
 * es la identidad VALIDADA del destino (`d.id`), no la de su URL (D4): el
 * enlace canónico de un proyecto de Data Center, `/browse/SIMPL`, no da clave
 * (sólo `/browse/X-123` la da) y redirige a `/projects/SIMPL/summary` o
 * `/projects/SIMPL/issues/…` (medido en el Jira de Marco), así que con la de su
 * URL no llegaba nunca. Un tablero `RapidBoard.jspa` lleva el proyecto en la
 * consulta, `?projectKey=`. El origen se compara entero y no por
 * `parseAtlassianUrl`, que no reconoce un Jira propio cuyo host no dice «jira»
 * en `/browse/CLAVE`.
 */
function llegaAlDestino(msg, d) {
  if (!d) return false
  if (!msg?.url || !d.url) return false
  if (d.kind === 'jira-jql') return sameSearch(msg.url, d.url)
  const aqui = parseAtlassianUrl(msg.url)
  const mismoHost = !!originOf(msg.url) && originOf(msg.url) === originOf(d.url)
  if (d.kind === 'confluence-page' && mismoHost && msg.pageId && d.id && String(msg.pageId) === String(d.id)) return true
  if (samePage(msg.url, d.url)) return true
  const clave = d.kind === 'confluence-space' ? 'spaceKey' : d.kind === 'jira-project' ? 'projectKey' : ''
  if (!clave) return false
  const esperada = clave === 'projectKey' ? String(d.id || '').toUpperCase() : String(d.id || '')
  let suya = aqui?.[clave] || ''
  if (clave === 'projectKey' && !suya && mismoHost) suya = validProjectKey(new URL(msg.url).searchParams.get('projectKey'))
  return !!(mismoHost && esperada && suya === esperada)
}

async function sendAnchor(tabId, plan) {
  return sendToTab(tabId, {
    type: MSG.ANCHOR,
    anchor: plan.anchor || null,
    explanation: plan.explanation || '',
    title: plan.destination?.title || '',
  })
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}
