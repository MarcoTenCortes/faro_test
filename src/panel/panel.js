/**
 * Controlador del panel lateral.
 *
 * Es el único sitio que habla con opencode. El content script no conoce la
 * contraseña del servidor ni ve las respuestas del modelo: sólo recibe planes
 * ya validados. Esa separación es deliberada — el content script vive dentro
 * de una página que no controlamos.
 *
 * El stream de eventos vive aquí y no en el service worker porque en MV3 el
 * worker se duerme a los 30 s de inactividad y cortaría la respuesta a medias.
 */

import { OpencodeClient, OpencodeError } from '../opencode/client.js'
import { suggestsAnotherModel, sortMessages, dropOrphans, toolOutputSize } from '../opencode/turn.js'
import { pickDefaultModel, pickAlternativeModel, pickPlannerModel, modelKey, parseModelKey } from '../shared/models.js'
import {
  parseAtlassianUrl,
  canonicalPagePath,
  cleanTabTitle,
  describeLocation,
  defaultScope,
  locationParts,
  samePage,
  validIssueKey,
  wikiPrefix as wikiPrefixOf,
} from '../atlassian/site.js'
import { mergeIndex, mergeIndexKeepingTree, indexSize, normalizeIndex, ancestryOf, isPlaceholderTitle } from '../atlassian/index-store.js'
import { CORS_ORIGIN, DEFAULT_SETTINGS, INDEX_LIMITS, PROFILE_LIMITS, RESTORE_LIMITS, SESSION_LIMITS, mcpNameForHost } from '../shared/config.js'
import { MSG } from '../shared/messages.js'
import {
  JIRA_REST_LIMITS,
  SAMPLE_FIELDS,
  normalizeProfile,
  profileForProject,
  normalizeRecentJql,
  profileFromSample,
  rememberJql,
  sampleQuery,
} from '../shared/jira-rest.js'
import { navOptions } from '../nav/options.js'
import { validatePlan } from '../nav/validate.js'
import {
  getSettings, saveSettings, getSite, getSites, saveSite, forgetEverythingFor, getSiteBundle,
  getIndex, saveIndex, getProfile, saveProfile, getSessionId, setSessionId, clearSessionId,
  getSessionWeight, setSessionWeight, clearSessionWeight,
} from '../shared/storage.js'
import { renderMarkdown } from './markdown.js'
import { SKILLS, DEFAULT_SKILL, skillById } from './skills.js'
import { pickLabel } from '../content/pick-payload.js'
import { prettyTool, clockTime, formatBytes } from '../shared/format.js'
import { startTiming, timingLine } from '../shared/timing.js'
import { LEVELS, log } from '../shared/log.js'
import {
  configureMcp,
  mcpStatusFor,
  verifyCredentials,
  waitForMcpReady,
  configFilePath,
  mcpBlockSnippet,
  fullConfigSnippet,
  siteRecords,
  mcpForHost,
  chosenMcpName,
  PRODUCTS,
} from './setup.js'
import { buildContext, harvestIndex, harvestFromSearch, indexFromSpacePages, countWithParent } from './indexer.js'
import { planNavigation, shouldPlan, currentPageId, jqlDestination, jqlLink, jqlPlan } from './planner.js'
import {
  SOURCE_LIMITS,
  emptySources,
  normalizeSources,
  addSourcePage,
  removeSourcePage,
  setSourceMode,
  hasSources,
  sourcesLabel,
  sourcesNote,
  sourcesFromSystem,
  suggestFromIndex,
  mergeSuggestions,
  pageRefFromUrl,
  consultedOutside,
  titlesFromTab,
  sourcesSearchTarget,
  linkedSite,
} from './sources.js'
import { SUGGESTION_COUNT, suggestionsFor } from './suggestions.js'
import { searchChips } from './search-chips.js'
import { restFailureDue, jqlFailText } from './rest-notice.js'
import { issueFamily, normalizeIssueFields } from './issue-profile.js'
import {
  clearSourceHistory,
  emptyHistory,
  historyEntry,
  normalizeHistory,
  recordAnalysis,
  saveSourceHistory,
} from './source-history.js'
import { normalizeReferences, referencesFromContext } from './references.js'
import { confluenceLinksIn, reasonText, suggestSources } from './source-suggest.js'
import {
  CONFLUENCE_REST_LIMITS,
  fetchAncestors,
  idsCql,
  mineCql,
  searchContent,
  searchPages,
  viewedCql,
} from '../shared/confluence-rest.js'
// «Qué mirar hoy» (H11): el diario local de actividad y la puntuación pura que
// lo ordena. Ni uno ni otra tocan la red; quien pide y quien pinta es el panel.
import { ACTIVITY_LIMITS, activityKey, preferredFamilies, pruneActivity } from '../atlassian/activity.js'
import {
  clearActivity,
  clearTodayCache,
  dismissActivity,
  getActivity,
  getTodayCache,
  recordActivity,
  saveTodayCache,
} from '../shared/activity-store.js'
import {
  TODAY_LIMITS,
  analyzeQuestion,
  buildCandidates,
  countNew,
  rankToday,
  recentPagesFromActivity,
  todaySummary,
  todayTargets,
} from './today.js'
import {
  collectNotes,
  collectSegmentedNotes,
  numberedIn,
  observationNumbers,
  normalizeNumbering,
  expectedCount,
  saysNothingToSay,
  looksLikeFollowUp,
  questionCitesPoint,
  numberedReminder,
  stripNumberedReminder,
  validateNotes,
  splitAnchorsBlock,
  titleFromProse,
  surplusNumbers,
  NOTE_LIMITS,
} from './notes.js'
import {
  baseSystem,
  selectionBlock,
  stripSelectionBlock,
  pageUrlFromSystem,
  preloadNote,
  preloadFromSystem,
  preloadedApplies,
  PAGE_OPEN,
} from './prompts.js'
import { stuckToBottom } from './chat-scroll.js'
import { ESCAPE_CLOSES, ESCAPE_DISMISSES } from './screens.js'
import { allowedLinkOrigin } from './links.js'
import * as memory from './memory.js'

// ------------------------------------------------------------------ estado

const $ = (id) => document.getElementById(id)

const el = {
  app: $('app'),
  announcer: $('announcer'),
  chat: $('chat'),
  input: $('input'),
  send: $('btn-send'),
  stop: $('btn-stop'),
  model: $('model'),
  skill: $('skill'),
  pick: $('btn-pick'),
  pickChip: $('pick-chip'),
  pickChipText: $('pick-chip-text'),
  sources: $('btn-sources'),
  sourcesCount: $('sources-count'),
  sourcesChip: $('sources-chip'),
  sourcesChipText: $('sources-chip-text'),
  locationChip: $('location-chip'),
  locationKey: $('location-key'),
  locationTitle: $('location-title'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  busy: $('busy'),
  busyTitle: $('busy-title'),
  busyText: $('busy-text'),
}

const state = {
  settings: { ...DEFAULT_SETTINGS },
  client: null,
  site: null,
  // El sitio del PANEL: el último host de Atlassian visto. `state.site` es el
  // de la PESTAÑA y se queda en null en cuanto se mira el correo; el panel
  // sigue siendo de este host hasta que se abra otro sitio de Atlassian.
  lastHost: '',
  tabId: null,
  index: null,
  contextMd: '',
  memory: { entries: [] },
  sessionID: null,
  model: null,
  models: [],
  skill: DEFAULT_SKILL,
  pendingPick: null,
  picking: false,
  // Las páginas base del análisis y su alcance, por sitio. Se cargan con el
  // sitio y se vacían al cambiar de host: el chip no puede enseñar las del
  // sitio anterior.
  sources: emptySources(),
  mcpConnected: false,
  // Desde Jira, el contexto del Confluence enlazado: {host, contextMd, index,
  // wikiPrefix} o null. El prefijo es el observado al visitarlo, si se
  // visitó: hace falta para preguntarle a su API desde aquí.
  linkedContext: null,
  // La búsqueda de páginas base en curso: un testigo para descartar la
  // respuesta tardía de una consulta que el usuario ya ha reescrito.
  sourcesSearch: { token: 0, timer: 0, suggestions: [], active: -1 },
  // Y las páginas base SUGERIDAS de la pantalla abierta (H10): el testigo tiene
  // el mismo trabajo que el de la búsqueda —los enlaces los pide la pestaña y
  // pueden llegar con la pantalla ya cerrada, en otro host o con la lista
  // cambiada—, `list` es lo que está pintado (y lo que añade «Añadir las N») y
  // `links`/`remote` son lo que contestó la pestaña, guardado para poder
  // repintar tras añadir una sin volver a preguntárselo, y `estado` es qué
  // fuentes llegaron: un repintado no puede decir que se leyeron los enlaces
  // cuando la pestaña no contestó.
  // `url` es la página de la que son `links` y `remote`: los enlaces son de UNA
  // página, y la pantalla sigue abierta al pasar a otra del mismo host.
  sourcesSuggest: { token: 0, list: [], links: [], remote: null, url: '', estado: 'listo' },
  // Las páginas de referencia que el CONTEXT.md nombra con su id, calculadas al
  // vuelo: no hay ninguna clave de almacenamiento que las guarde (§ references.js).
  // Se memorizan mientras los dos contextos y el índice sean los MISMOS objetos;
  // reindexar, subir un contexto a mano o cambiar de sitio los reemplaza y se
  // vuelven a leer solas.
  references: { propio: null, enlazado: null, index: null, items: null },
  // Qué páginas base eligió el usuario para analizar qué, en este host. Viaja en
  // el paquete del sitio (`BUNDLE_EXTRA_KEYS`) y se reconstruye al leerlo; es la
  // señal más fuerte de las sugerencias y NUNCA entra en un prompt.
  sourceHistory: emptyHistory(),
  notes: [],
  noteRows: new Map(),
  notesCard: null,
  // Lo que pintó la última tarjeta viva, para poder volver a pintarla si el
  // chat se repinta con las marcas todavía en la página.
  notesResult: null,
  // Testigo del turno en curso: el `finally` de un turno cancelado no puede
  // apagar el estado del siguiente.
  turnToken: null,
  // Testigo del arranque en curso: dos arranques solapados (dos cambios de
  // pestaña seguidos) pintaban la conversación dos veces. Sólo el último manda.
  bootToken: null,
  // Mientras se restaura la conversación no se anuncia nada al lector de
  // pantalla: es historia, no novedad.
  restoring: false,
  // ¿Está el chat pegado al fondo? Se mide en cada scroll, ANTES de que el
  // siguiente trozo de respuesta mueva nada: si el usuario subió a leer, no
  // se le arrastra abajo.
  chatPinned: true,
  // Quién tenía el foco antes de abrir una pantalla: se le devuelve al cerrar.
  focusBefore: null,
  // El recorrido paso a paso en marcha: su tarjeta y su botón «Parar».
  navRun: null,
  defaults: {},
  // Lo que está pasando ahora mismo («pensando…», «paso 2/5») mientras dura un
  // turno o un recorrido, o '' si no pasa nada. Es la ÚNICA fuente de verdad
  // del hueco del chip: lo escribe `setStatus` y lo pinta `paintLocation`, que
  // en cuanto se vacía devuelve el título de la pestaña (decisión 4 de
  // docs/PLAN.md: el texto de estado sigue viéndose, sin una pieza propia).
  statusLine: '',
  streaming: false,
  // Cuántos caracteres de salidas de herramientas lleva arrastrados la sesión
  // abierta de este host, y si ya se ha avisado de que pesa. Es lo que se
  // reenvía al modelo en cada turno (el `system` no se acumula; las salidas sí,
  // hasta donde llega la poda de opencode). El contador se guarda en
  // storage.session junto a la sesión; el aviso no: se da una vez por sesión y
  // por panel abierto, y quien reabre el panel merece que se le vuelva a decir.
  sessionToolChars: 0,
  heavyWarned: false,
  // El índice que ha crecido y todavía no está en disco: `{host, index}`, el
  // objeto aprendido junto al host que lo aprendió. Las tres cosas que hacen
  // crecer el índice en un turno (lo que devolvieron las herramientas, el árbol
  // de la barra lateral, el camino que lee el planificador) lo apuntan aquí y
  // `persistIndex()` escribe UNA vez al final (P3). null cuando no hay nada
  // pendiente.
  indexDirty: null,
  lastQuestion: '',
  tabUrl: '',
  tabTitle: '',
  turns: [],
  indexingAbort: null,
  // Lo que cancela el botón del velo «Trabajando…», si hay algo que cancelar:
  // sin esto, el Cancelar de «Guardando lo aprendido» no cancelaba nada.
  busyAbort: null,
  pendingMcp: null,
  snippets: null,
  mcpWait: null,
  // Un arranque que no se pudo hacer porque la pestaña estaba fuera de
  // Atlassian: el host al que le toca, en cuanto se vuelva a él.
  bootPending: '',
  logOnlyProblems: false,
  logUnsub: null,
  turnAbort: null,
  // Lo que tardó lo último que hizo el panel, ya en una línea: el arranque por
  // fases y el último turno. Sólo se enseña en el Registro y se registra al
  // ocurrir; no se guarda en disco ni entra en ningún prompt. Es el
  // instrumento con el que se decide qué merece la pena tocar: el `GET /mcp`
  // que tarda segundos en frío llevaba ahí desde el principio y nadie lo veía
  // (medido en la auditoría del 2026-09-13 contra un opencode desechable).
  timing: { boot: '', turn: '' },
  // host:id -> { largo } del camino leído de la API en esta sesión, o { fallo }
  // con la hora del último intento que no contestó. Sirve para no volver a
  // pedirlo mientras el índice lo conserve entero, ni esperar en cada
  // respuesta a una API caída.
  ancestryFetched: new Map(),
  // Los avisos de una lectura REST que ya se han dado: `host:sesión:motivo`. Un
  // motivo que no cambia por reintentar —«tu sesión no vale para la API», «esto
  // es Cloud», «no hubo red»— se dice UNA vez por host y sesión; si no, cada
  // respuesta con tarjeta repetiría el mismo aviso debajo. Es la misma idea que
  // la tregua de un minuto de `learnAncestry`, con la sesión como plazo: una
  // sesión nueva vuelve a contarlo. La clave lleva el host, así que volver a un
  // sitio conserva su tregua en vez de repetir lo que ya se dijo allí.
  restWarned: new Set(),
  // Los campos de la incidencia que hay en pantalla, con la URL de la que se
  // leyeron: `{url, fields}` o null. Es lo que hace que los chips de búsqueda
  // sepan de qué épica y de qué componente hablar sin preguntarle nada al
  // modelo. Se llenan con el digest de un Análisis o, si el panel se abre en
  // una incidencia sin analizar, con una lectura corta (`readIssueFieldsQuick`);
  // `refreshTab` los vacía en cuanto la pestaña cambia de página, porque los
  // campos son de ESA incidencia. Nunca se guardan: la pantalla de ahora es la
  // única fuente.
  issueFields: null,
  // Los filtros que el propio usuario tiene marcados como favoritos en su Jira:
  // null mientras no se han pedido, una lista (quizá vacía) cuando ya se
  // preguntó. Se leen una vez por sitio y sólo cuando hay chips que pintar, y
  // viven en memoria: son suyos y están en su Jira, no hace falta una copia.
  favouriteFilters: null,
  // Las últimas consultas que se ejecutaron de verdad en este sitio, ya
  // normalizadas (`normalizeRecentJql`). Se guardan en el registro del sitio,
  // así que sobreviven al panel; es la única memoria de búsquedas que hay.
  recentJql: [],
  // Lo que la extensión contó de una muestra del proyecto de este Jira
  // (`normalizeProfile`): los nombres EXACTOS de tipo, estado, componente y
  // etiqueta, y cómo se nombran los tickets aquí. De ahí salen los chips de
  // estado y el bloque DATOS DEL PROYECTO del prompt de Búsqueda. Se carga con
  // el paquete del sitio, se vuelve a contar cuando envejece y `refreshTab` lo
  // vacía al cambiar de host: es de ESTE proyecto. null en Confluence.
  profile: null,
  // Por qué proyecto se preguntó ya el perfil («host:CLAVE»): la tregua del
  // refresco que dispara `refreshTab` al cambiar de proyecto sin cambiar de host.
  profileAsked: '',
  // «Qué mirar hoy» (H11): lo leído de las API del sitio ya fundido con el
  // diario local, listo para ordenar. Se guardan los CANDIDATOS y no las filas
  // porque la puntuación depende de dónde estés (misma épica, hermana de la
  // página abierta, misma familia) y eso cambia al cambiar de pestaña sin que
  // haya nada que volver a leer: `todayRows()` las ordena al pedirlas.
  // Es del SITIO del panel: `refreshTab` lo vacía al cambiar de host.
  today: emptyToday(),
  // Los resultados que el usuario pidió precargar con «Preguntar sobre estos»
  // (H12): `{jql, total, issues, host}` o null. Acompañan a la SIGUIENTE
  // pregunta y sólo a ésa —`send()` los consume, como lo señalado con el ratón—,
  // y llevan el host con el que se leyeron porque entre el clic y el envío el
  // panel puede haberse ido a otro sitio (§8.22). Nunca se guardan: son los
  // resultados de AHORA, y una lista de ayer no es una precarga, es un engaño.
  pendingPreload: null,
  // La intención de «Analizar» que dejó una fila de «hoy»: se navega y, cuando
  // la pestaña llega a esa página, se fija la Skill Análisis y se deja la
  // pregunta ESCRITA en el cuadro, sin mandarla (§8.20: Faro nunca manda una
  // pregunta por su cuenta). `{host, kind, id, question, at}` o null; la
  // consume `refreshTab` y caduca sola a los `TODAY_LIMITS.intentMs`.
  pendingIntent: null,
}

// -------------------------------------------------------------------- init

init().catch((err) => {
  console.error('[faro]', err)
  showNotice('No he podido arrancar: ' + (err?.message || err), true)
})

async function init() {
  state.settings = await getSettings()
  fillSkills()
  wireEvents()
  applySettingsToUi()

  await refreshTab()

  chrome.tabs.onActivated.addListener(() => refreshTab().catch(console.error))
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tabId && info.url) refreshTab().catch(console.error)
  })
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
}

function buildClient() {
  // Un turno en vuelo se queda sin eventos al cerrar el stream: el vigilante
  // lo daba por colgado a los 90 s, abortaba en el servidor una respuesta que
  // quizá ya había terminado, y el panel del sitio nuevo se quedaba
  // «pensando…» todo ese rato (reproducido en la auditoría del 2026-09-13,
  // docs/PLAN.md §2 C1). Se cancela AQUÍ y no en refreshTab: aquí sólo se
  // llega cuando el panel cambia de SITIO (o cuando se cierra Ajustes), y
  // mirar el correo a mitad de respuesta no es cambiar de sitio.
  if (state.streaming) {
    state.turnAbort?.abort()
    // Y en el servidor: `runTurn` ya no aborta al cancelarse la señal —apunta
    // la sesión en el cliente para que la cierre quien la borre—, y ese
    // cliente es justo el que estamos desechando, así que opencode seguía
    // ejecutando el turno entero (revisión adversaria de H2, 2026-09-14).
    // Como el botón Parar y como «Sesión nueva», sin esperar a que conteste.
    if (state.sessionID) state.client?.abort(state.sessionID).catch(() => {})
    log.info('Turno cancelado', 'has cambiado de sitio, o cerrado Ajustes, a mitad de respuesta')
  }
  // Un indexado en vuelo se queda igual de huérfano: dura minutos, moría solo
  // a los 120 s y hasta entonces dejaba el velo puesto sobre el sitio NUEVO y
  // acababa marcando el anterior como configurado sin haber indexado nada
  // (revisión adversaria de H2, 2026-09-14).
  if (state.indexingAbort) {
    state.indexingAbort.abort()
    hideBusy()
    log.warn('Indexado cancelado', 'has cambiado de sitio a mitad del indexado')
  }
  state.client?.disconnect()
  const client = new OpencodeClient({
    baseUrl: state.settings.serverUrl,
    password: state.settings.password,
    logger: log,
  })
  client.on('faro.stream.open', () => {
    setStatus('ok', 'conectado')
    log.ok('Stream de eventos abierto')
  })
  client.on('faro.stream.closed', () => {
    setStatus('bad', 'sin conexión')
    log.warn('Stream de eventos cerrado', 'reintentando…')
  })
  client.on('faro.stream.error', (p) => log.error('Stream de eventos', p?.error))
  state.client = client
  return client
}

// ------------------------------------------------------- pestaña y arranque

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return

  // Las marcas de un análisis son de la página en la que se hicieron. Si la
  // pestaña activa está en otra —por identidad de página, no por cadena:
  // Confluence reescribe su propia URL sin que nadie se mueva—, se olvidan. Y
  // ANTES de cambiar de pestaña, para que la orden de limpiar vaya a la que
  // tenía las marcas y no a la recién activada.
  if (state.notes.length && !samePage(tab.url || '', state.tabUrl)) forgetNotes()
  // Y los campos leídos de la incidencia son de la incidencia que estaba en
  // pantalla: al cambiar de página dejan de valer, aunque el host sea el mismo.
  // Se comprueba aquí, ANTES de reasignar `state.tabUrl`, por lo mismo que las
  // marcas, y con la misma identidad de página (Confluence reescribe su URL sin
  // que nadie se mueva).
  if (state.issueFields && !samePage(tab.url || '', state.issueFields.url)) state.issueFields = null
  // Y los enlaces de la página, que son de ESA página: la pantalla de páginas
  // base no se cierra al pasar a otra incidencia del mismo host, y los de la
  // anterior puntuaban la de ahora con un motivo —«enlazada desde la
  // descripción»— que era mentira (revisión adversaria de H10). Se sube el
  // testigo para que una respuesta en vuelo tampoco los devuelva.
  // (`state.tabUrl` sigue siendo la de ANTES: se reasigna más abajo.)
  const otraPagina = !samePage(tab.url || '', state.tabUrl || '')
  if (otraPagina) {
    state.sourcesSuggest.token++
    state.sourcesSuggest.links = []
    state.sourcesSuggest.remote = null
    state.sourcesSuggest.url = ''
    // Y lo precargado, que es de un momento: el usuario pidió preguntar sobre
    // una lista y se ha ido a otra página, así que la pregunta que tenía en la
    // cabeza ya no es la misma. La tarjeta sigue en el chat con su botón: volver
    // a pulsarlo lo vuelve a armar con los mismos resultados, sin releer nada.
    // Aquí basta la página, y no hace falta repetirlo en el bloque de cambio de
    // sitio: dos hosts distintos nunca son la misma página (`samePage` compara
    // el origen), y además `send()` descarta lo precargado de otro host con el
    // que capturó al pedir, que es la guarda que de verdad manda (§8.22).
    state.pendingPreload = null
  }
  state.tabId = tab.id

  let site = parseAtlassianUrl(tab.url || '')

  // Un Confluence Data Center tiene rutas que no siempre reconocemos. Si la
  // URL nueva no parsea pero seguimos en el mismo host, se conserva lo que ya
  // sabíamos: perder el sitio a mitad de la configuración dejaba el panel con
  // `state.site` a null y reventaba al guardar las claves.
  if (!site && state.site && hostOf(tab.url) === state.site.host) site = state.site

  // Y si es un host que ya configuraste, se acepta aunque la ruta no diga nada.
  if (!site) {
    const host = hostOf(tab.url)
    const known = host ? await getSite(host) : null
    if (known) {
      site = {
        host,
        origin: originOf(tab.url),
        product: known.product || 'unknown',
        cloud: !!known.cloud,
        ...(typeof known.wikiPrefix === 'string' ? { wikiPrefix: known.wikiPrefix } : {}),
      }
    }
  }

  // El prefijo de Confluence se observa una vez y se recuerda: no todas las
  // paginas del sitio lo revelan (la portada, por ejemplo, no dice nada).
  if (site) {
    const saved = await getSite(site.host)
    if (typeof site.wikiPrefix !== 'string' && typeof saved?.wikiPrefix === 'string') {
      site = { ...site, wikiPrefix: saved.wikiPrefix }
    } else if (typeof site.wikiPrefix === 'string' && saved?.wikiPrefix !== site.wikiPrefix) {
      await saveSite(site.host, { wikiPrefix: site.wikiPrefix, product: site.product, cloud: site.cloud })
      log.info('Prefijo de Confluence detectado', site.wikiPrefix || '(raiz, Data Center)')
    }
  }

  // El sitio del PANEL es el último host de Atlassian visto, no el de la
  // pestaña activa: al mirar el correo `site` queda null, y comparando con
  // `state.site?.host` volver al MISMO host daba «cambio de sitio». Se vaciaban
  // índice, contexto y páginas base, se rearrancaba —y el arranque mata el
  // turno en vuelo— y se tiraba la espera del MCP, justo lo que los arreglos de
  // H2 querían evitar (revisión adversaria de H2, 2026-09-14).
  const changedHost = !!site && site.host !== state.lastHost
  // ¿Veníamos de fuera de Atlassian? Entonces el chat quedó con el «Abre Jira
  // o Confluence» y hay que repintarlo, porque sin cambio de sitio ya no hay
  // arranque que lo restaure.
  const volviaDeFuera = !!site && !state.site
  if (changedHost && state.picking) setPicking(false)
  // Lo que es del sitio no viaja al siguiente: las páginas base, el índice,
  // los caminos leídos y el contexto se vacían hasta que `bootForSite` cargue
  // los del host nuevo. Sin esto, si el sitio nuevo se quedaba en la pantalla
  // de claves, la pantalla de páginas base sugería páginas del sitio anterior
  // y su índice acababa guardado como si fuera de éste. Y la pantalla, si
  // estaba abierta, se cierra: hablaba del otro sitio.
  if (changedHost) {
    // La espera del MCP era de otro sitio de Atlassian: su pantalla se va con
    // el arranque del nuevo, y al volver se vuelve a pedir (o el MCP ya
    // conectado se reconoce solo). Aquí sólo se llega con un sitio distinto:
    // mirar el correo mientras se reinicia opencode no la corta (C5).
    if (state.mcpWait && !state.mcpWait.signal.aborted) {
      state.mcpWait.abort()
      log.warn('Espera del MCP cancelada', `has cambiado a ${site.host} antes de que opencode cargara el MCP de ${state.lastHost || '?'}`)
    }
    if (!$('screen-sources').classList.contains('hidden')) closeSourcesScreen()
    state.sources = emptySources()
    state.index = null
    state.ancestryFetched = new Map()
    state.contextMd = ''
    state.linkedContext = null
    // Los tiempos también son del sitio: hablan del arranque y del último turno
    // de ESE host. Dejados puestos, el Registro del sitio nuevo enseñaba las
    // fases del anterior hasta que hubiera arranque y turno propios.
    state.timing = { boot: '', turn: '' }
    // Y lo que arrastra la conversación, que es de la sesión de ESE host: el
    // arranque del nuevo lo vuelve a leer del almacén al restaurar la suya.
    state.sessionToolChars = 0
    state.heavyWarned = false
    // Y lo que alimenta los chips de búsqueda, que es de ESTE Jira: los filtros
    // favoritos vuelven a quedar por pedir y las últimas consultas y el perfil
    // contado del proyecto los carga `bootForSite` del sitio nuevo.
    state.favouriteFilters = null
    state.recentJql = []
    state.profile = null
    // Y lo que alimenta las páginas base sugeridas, que también es de ESTE
    // host: el historial de análisis (lo recarga `bootForSite` con el paquete
    // del sitio nuevo), las referencias de su contexto y lo que la pestaña
    // contestó de los enlaces. El testigo se sube, para que una respuesta en
    // vuelo de la pestaña anterior no pinte sugerencias del sitio de antes.
    state.sourceHistory = emptyHistory()
    state.references = { propio: null, enlazado: null, index: null, items: null }
    state.sourcesSuggest = { token: state.sourcesSuggest.token + 1, list: [], links: [], remote: null, estado: 'listo' }
    // Y lo que «Qué mirar hoy» leyó, que es de ESTE sitio y de su Confluence
    // enlazado: dejarlo puesto recomendaría en el sitio nuevo lo que cambió en
    // el anterior. Lo vuelve a leer `loadToday` al final del arranque, de su
    // caché de sesión si sigue fresca. `state.pendingIntent` NO se toca: puede
    // apuntar justo al host al que acabamos de llegar (una página del
    // Confluence enlazado se abre en su propia pestaña) y caduca sola.
    state.today = emptyToday()
    // Y la insignia con ellos: el arranque del sitio nuevo tarda segundos en
    // volver a leer, y hasta entonces un «3» de otro host sería mentira.
    paintTodayUi()
    paintSourcesUi()
  }
  state.site = site
  // Sólo con sitio: el panel sigue siendo del último host de Atlassian visto
  // aunque la pestaña activa esté en el correo.
  if (site) state.lastHost = site.host
  state.tabUrl = tab.url || ''
  state.tabTitle = tab.title || ''

  paintLocation(site, tab.title)

  if (!site) {
    // Fuera de Atlassian el panel sólo dice dónde está: no se vacía nada, no
    // se corta ninguna espera y no se rearranca. Mientras llega una respuesta,
    // el chat se queda como está (se sigue viendo llegar); si no, se dice qué
    // hace falta.
    if (!state.streaming) {
      showEmpty({
        title: 'Abre Jira o Confluence',
        text: 'Faro trabaja dentro de un sitio de Atlassian. Ve a una página y vuelve.',
      })
    }
    return
  }

  // Otra página del mismo sitio con la pantalla de páginas base abierta: las
  // sugeridas se vuelven a calcular para la que hay delante. Va suelto y no
  // encadenado con el arranque: es independiente de lo que venga detrás.
  if (!changedHost && otraPagina && !$('screen-sources').classList.contains('hidden')) paintSuggestedSources()
  if (changedHost) await bootForSite()
  // Otro PROYECTO del mismo Jira: no hay arranque, pero el perfil que hay en
  // memoria es del de antes. `currentProfile()` ya no lo deja entrar en ningún
  // sitio; aquí se cuenta el del nuevo, en segundo plano y con las mismas
  // condiciones del arranque (permiso ya concedido, restTools, Data Center).
  // Límite asumido: se guarda UNO por host, así que alternar entre dos proyectos
  // recuenta en cada salto (una petición de la sesión del navegador).
  // `refreshTab` corre en cada cambio de pestaña y de URL, así que se pregunta UNA
  // vez por proyecto (`state.profileAsked`): una API que no contesta no puede
  // convertirse en una petición por cada clic.
  else if (site.product === 'jira' && site.projectKey && !currentProfile(site) && state.profileAsked !== `${site.host}:${site.projectKey}`) {
    refreshProfileSoon(state.bootToken)
  }
  // El MCP acabó de cargar mientras la pestaña estaba fuera: el arranque que
  // `finishSetup` no pudo hacer se hace ahora (bootForSite lo da por hecho).
  else if (state.bootPending === site.host) await bootForSite()
  // Volver de fuera al MISMO sitio no rearranca nada —el cliente, el índice y
  // la sesión siguen siendo suyos—, pero el chat se había quedado con el «Abre
  // Jira o Confluence»: se vuelve a pintar y ya.
  else if (volviaDeFuera && !state.streaming) await restoreConversation()

  // Y, ya con el sitio puesto, la intención de «Analizar» que dejó una fila de
  // «Qué mirar hoy» si hemos llegado a la página que la esperaba. Va lo ÚLTIMO
  // a propósito: `bootForSite` fija la Skill guardada del sitio, y hacerlo
  // antes sería que la pisara justo la que el usuario acaba de pedir.
  await consumePendingIntent(site)
}

/** Arranque completo para un sitio: servidor, claves, contexto. */
async function bootForSite() {
  // Testigo de arranque: dos arranques solapados —dos cambios de pestaña
  // seguidos, un botón pulsado dos veces— corrían a la vez sobre `state.site`
  // en vivo y pintaban la conversación dos veces (reproducido en la auditoría
  // del 2026-09-13, docs/PLAN.md §2 C3). Sólo el último manda: los demás se
  // apagan tras cada await, como el testigo del turno.
  const testigo = {}
  state.bootToken = testigo
  // Si había un arranque pendiente (el MCP cargó con la pestaña fuera de
  // Atlassian), éste lo cumple: no puede volver a dispararse.
  state.bootPending = ''

  // Cuánto cuesta abrir el panel, fase por fase. Hasta H3 nadie lo veía: el
  // `GET /mcp` del paso 3 tarda entre 2,8 y 13,8 s la primera vez tras
  // arrancar opencode (medido en la auditoría del 2026-09-13 contra un
  // servidor desechable) y el chat lo espera entero. Sin el número no se puede
  // decidir si vale la pena sacarlo del camino, así que primero se mide.
  // El arranque tiene cuatro salidas —sin opencode, pantalla de claves,
  // pantalla de contexto y el chat— y justo las cortas son las que enseñan lo
  // que cuesta el MCP: TRES miden, y nunca en un arranque que ya no manda. La de
  // «sin opencode» no mide nada (un arranque verde que no hubo engañaría) y
  // además vacía la fila: si no, «tiempos (arranque)» se quedaba enseñando la
  // línea del arranque ANTERIOR, de otro momento y quizá de otro sitio.
  // El reloj es monótono: `Date.now` salta con el del sistema (NTP, cambio de
  // hora) y una fase podía salir negativa o de horas.
  const cron = startTiming(() => performance.now())
  const medir = () => {
    state.timing.boot = timingLine(cron.done())
    log.ok('Arranque del panel', state.timing.boot)
  }

  const client = buildClient()
  setStatus('busy', 'comprobando…')

  // 1. ¿Está opencode?
  try {
    await client.health()
  } catch (err) {
    if (state.bootToken !== testigo) return
    setStatus('bad', 'sin opencode')
    state.timing.boot = ''
    showScreen('screen-connect', String(err?.message || err))
    return
  }
  if (state.bootToken !== testigo) return
  cron.mark('health')
  client.connect()

  // 2. Todo lo que este sitio tiene guardado, la lista de modelos y la sesión
  // abierta: las tres cosas A LA VEZ, y lo de storage en UNA sola lectura.
  // Antes iban en fila y el mismo `getSite` del mismo host se leía cinco veces
  // —cada uno relee el mapa entero de `faro:sites`—, más el contexto, la
  // memoria, el índice y la sesión por su cuenta: trece lecturas encadenadas
  // detrás de una petición de red (docs/PLAN.md §2.6 P4).
  const [bundle, sessionID, modelos] = await Promise.all([
    getSiteBundle(state.site.host),
    getSessionId(state.site.host),
    // Un rechazo dentro de `Promise.all` se llevaría por delante las otras dos
    // lecturas: sin lista de modelos el panel arranca igual y avisa, que es lo
    // que hacía el try/catch de antes.
    client.models().catch((err) => ({ error: err })),
  ])
  if (state.bootToken !== testigo) return
  // La fase mide lo que el usuario espera de verdad: las tres cosas juntas, o
  // sea lo que tarde la más lenta (la petición). Antes eran dos fases en fila.
  cron.mark('modelos y almacenamiento')

  // El sitio guardado manda desde aquí hasta el final del arranque: sólo se
  // vuelve a leer si adoptamos un MCP y lo reescribimos (paso 3).
  let saved = bundle.site
  setSkill(saved?.skill || DEFAULT_SKILL)
  state.sessionID = sessionID
  state.contextMd = bundle.contextMd
  // La memoria se reconstruye con claves blancas al leerla, como siempre. Lo
  // que aquí NO se hace es repararla en el almacén: esa escritura la sigue
  // haciendo `getMemory`, por donde pasa la pantalla de memoria justo antes de
  // que se pueda borrar una entrada por su `at`, que es para lo que hacía falta.
  state.memory = memory.normalizeMemory(bundle.memoryRaw)
  state.index = bundle.index
  if (bundle.stale) {
    log.warn('Índice descartado', 'era de una versión anterior de Faro; hay que reconstruir el contexto')
  }
  // Se pregunta por la LISTA, no por el error: así una respuesta rara (o un
  // rechazo sin motivo) acaba en el aviso y no en un TypeError que se llevaría
  // el arranque entero, que es justo lo que el try/catch de antes evitaba.
  if (Array.isArray(modelos?.models)) {
    state.models = modelos.models
    state.defaults = modelos.defaults
    fillModels(modelos.models, saved?.model || pickDefaultModel(modelos.models, modelos.defaults))
  } else {
    showNotice('No he podido leer la lista de modelos: ' + (modelos?.error?.message || modelos?.error || 'respuesta vacía'), true)
  }

  // 3. ¿Tiene claves este sitio, y están de verdad conectadas? Se mira lo que
  // opencode tiene de verdad: el MCP que lleve este dominio en JIRA_URL o
  // CONFLUENCE_URL (lo configuró el otro producto, o el usuario a mano) se
  // adopta y se apunta, con el otro host enlazado. Sólo después cuenta el
  // nombre que Faro guardó, y en último lugar el que deriva del host. De la
  // configuración sólo se miran los hosts: las claves van ahí en claro y no
  // pueden acabar en el estado ni en el registro.
  const [mcp, config] = await Promise.all([client.listMcp().catch(() => ({})), client.config().catch(() => null)])
  if (state.bootToken !== testigo) return
  // La fase que se viene a leer: son las DOS peticiones, sin lo que se guarde
  // después. `GET /mcp` en frío es lo que hace que el panel tarde en abrirse.
  cron.mark('MCP')
  const found = mcpForHost(config, state.site.host, { status: mcp })
  // Se adopta sólo lo que está conectado: apuntar un MCP caído pisaba lo que
  // sí funcionaba. Y también cuando el MCP ya apuntado trae un host nuevo —el
  // usuario añadió el otro producto al bloque a mano—: sin esto, el enlace
  // sólo se aprendía si cambiaba el nombre.
  const enlaceNuevo =
    !!found &&
    ((found.jiraHost && found.jiraHost !== state.site.host && saved?.jiraHost !== found.jiraHost) ||
      (found.confluenceHost && found.confluenceHost !== state.site.host && saved?.confluenceHost !== found.confluenceHost))
  if (found && found.connected && (saved?.mcpName !== found.name || !saved?.configured || enlaceNuevo)) {
    const registros = siteRecords({
      host: state.site.host,
      product: state.site.product,
      mcpName: found.name,
      jiraHost: found.jiraHost,
      confluenceHost: found.confluenceHost,
    })
    for (const { host, patch } of registros) await saveSite(host, patch)
    saved = await getSite(state.site.host)
    if (state.bootToken !== testigo) return
    log.ok('MCP reconocido', `${found.name} · ${found.products === 2 ? 'Jira y Confluence' : found.jiraHost ? 'sólo Jira' : 'sólo Confluence'}`)
  } else if (found && !found.connected) {
    log.warn('MCP sin conectar', `${found.name} lleva este dominio pero no está conectado`)
  }
  const status = mcpStatusFor(mcp, state.site.host, chosenMcpName(config, saved, state.site.host, { status: mcp }))

  // Las páginas base de ESTE sitio, y si hay quien pueda leerlas: sin el MCP
  // el modelo no llega a ellas, y la pantalla lo dice.
  state.mcpConnected = !!status.connected
  state.sources = normalizeSources(saved?.analysisSources, { host: state.site.host })
  // Y las últimas búsquedas que se ejecutaron aquí, del mismo registro: se
  // reconstruyen al leer, como las páginas base, porque son consultas que
  // acabarán dentro de una URL.
  state.recentJql = normalizeRecentJql(saved?.recentJql)
  // Y el perfil contado del proyecto, que viaja en el MISMO paquete del sitio
  // (`BUNDLE_EXTRA_KEYS`, H9): no cuesta ninguna lectura más y se reconstruye
  // con claves blancas al leerlo, como todo lo que sale del almacén. Volver a
  // contarlo es una petición con la sesión del usuario y eso NO va aquí: se
  // hace al final, en segundo plano (P4 dejó el arranque en una sola lectura).
  state.profile = normalizeProfile(bundle.extras?.profile)
  // Y el historial de análisis con páginas base, que viaja en ese MISMO paquete
  // (H10): sale crudo de `getSiteBundle` —`shared/storage.js` no puede importar
  // de `src/panel/`, igual que con la memoria— y se reconstruye aquí, con el
  // reloj de ahora, así que lo caducado no llega a entrar en el estado.
  state.sourceHistory = normalizeHistory(bundle.extras?.sourceHistory, { host: state.site.host })
  paintSourcesUi()

  if (!status.connected && !saved?.skippedKeys) {
    hideScreens()
    showSetupScreen()
    if (status.present) {
      $('setup-status').textContent = `El MCP «${status.name}» está registrado pero en «${status.status}». Revisa ese bloque y reinicia opencode, o quítalo si sobra.`
    }
    medir()
    return
  }

  // 4. Desde Jira, el contexto del Confluence enlazado: es de OTRO host, así
  // que no viene en el paquete de éste y hay que ir a por él (y sólo se sabe a
  // cuál después de mirar el MCP). Es lo único que queda por leer.
  // Un arranque más nuevo pone su testigo antes de su primer await: éste
  // siempre va por delante, así que lo que escriba aquí antes de comprobarlo
  // lo pisa el nuevo en su propio paso 4.
  state.linkedContext = await loadLinkedContext(saved)
  if (state.bootToken !== testigo) return
  // Lo que va desde la marca del MCP hasta aquí: adoptarlo si hacía falta
  // (dos escrituras y una relectura, sólo la primera vez), pintar las páginas
  // base y este contexto enlazado, que es lo único que de verdad se lee. Antes
  // no tenía marca propia y esos milisegundos se contaban como «restaurar».
  cron.mark('enlazado')

  // `onboarded` sale de lo leído al empezar (o de la relectura tras adoptar el
  // MCP), y entre esa lectura y aquí hay segundos: el `GET /mcp` en frío tarda
  // de 2,8 a 13,8 s. Antes el comentario decía que durante el arranque nada lo
  // cambia, y no era verdad: «Omitir» de esta misma pantalla lo escribía sin
  // rearrancar y un arranque lento volvía a enseñarla (revisión adversaria de
  // H6). Ahora, quien lo escribe en ese hueco —«Omitir» y el contexto que se
  // sube a mano— apagan este arranque con un testigo nuevo y repintan ellos el
  // chat, así que aquí sólo se llega con un arranque que sigue mandando.
  if (!saved?.onboarded) {
    hideScreens()
    showContextScreen()
    medir()
    return
  }

  hideScreens()
  await restoreConversation(testigo)
  if (state.bootToken !== testigo) return
  cron.mark('restaurar')
  medir()

  // Sin ruido: si falta el permiso, se avisa cuando de verdad hace falta
  // (al ofrecer navegación), no nada más abrir el panel.
  await ensureContentAccess({ announce: false })

  // Y, con el chat ya puesto, volver a contar el perfil del proyecto si el
  // guardado ha envejecido. Va detrás del arranque y sin await a propósito: es
  // una petición a la API del sitio y el chat no puede esperarla (§8.22 y P4 de
  // H6, que dejó el arranque en una sola lectura del almacén).
  refreshProfileSoon(testigo)

  // Y «Qué mirar hoy» (H11), por lo mismo y con el mismo testigo: son hasta
  // seis lecturas a la API del sitio con la sesión del navegador, y el chat no
  // puede esperarlas. Lo que devuelvan llega cuando llegue; si para entonces el
  // panel está en otro sitio, no se pinta nada (§8.22).
  loadTodaySoon(testigo)
}

/**
 * Vuelve a contar el perfil del proyecto, sin que el arranque lo espere.
 *
 * Se llama sin `await` a propósito: lo que devuelva llega al estado cuando
 * llegue, y hasta entonces vale el perfil guardado (o ninguno). Un fallo aquí
 * no puede tumbar el arranque, así que se recoge y se apunta en el Registro.
 */
/**
 * El perfil contado, sólo si es del proyecto que hay delante.
 *
 * `state.profile` es del HOST (así se guarda) y un Jira tiene muchos proyectos:
 * al pasar de SIMPL-12 a OPS-77 en la misma pestaña no hay arranque que lo
 * vacíe, y el de SIMPL entraba en el prompt y en los chips de OPS como «los
 * nombres exactos» (revisión adversaria de H9). Los tres que lo consumen —la
 * petición de `send()`, los chips y el indexador— pasan por aquí.
 */
function currentProfile(site = state.site) {
  return profileForProject(state.profile, site?.projectKey)
}

function refreshProfileSoon(testigo) {
  refreshProfile(testigo).catch((err) => log.info('Perfil del proyecto', 'no se pudo refrescar: ' + String(err?.message || err)))
}

/**
 * ¿Hace falta volver a contar la muestra de este proyecto?
 *
 * Un flujo de trabajo gana estados, componentes o convenciones de nombre cada
 * semanas, no cada hora: con un perfil de este mismo proyecto y más nuevo que
 * `PROFILE_LIMITS.ttlMs` no se pide nada. Y sólo en un Jira Data Center: en
 * Cloud la REST de Jira está retirada (§8.19) y en Confluence no hay proyecto
 * que contar.
 */
async function refreshProfile(testigo) {
  if (!state.settings.restTools) return
  // El sitio y la pestaña con los que se pide, capturados juntos (§8.22): entre
  // esto y la respuesta hay dos await y el usuario puede cambiar de pestaña.
  const sitio = state.site
  const tabId = state.tabId
  if (sitio?.product !== 'jira' || sitio.cloud || tabId == null) return
  const scope = defaultScope(sitio)
  if (scope?.kind !== 'project') return
  const vigente =
    state.profile && state.profile.projectKey === scope.key && Date.now() - state.profile.at < PROFILE_LIMITS.ttlMs
  if (vigente) return
  state.profileAsked = `${sitio.host}:${scope.key}`
  // Con permiso YA concedido y nada más: un refresco en segundo plano no puede
  // abrir un diálogo de permisos que el usuario no ha pedido. Sin permiso, el
  // perfil se cuenta cuando se reconstruye el contexto, que sí es un gesto suyo.
  if (!(await hasHostPermission(sitio.origin))) return
  if (state.bootToken !== testigo) return

  const r = await countProfile(sitio, scope, { tabId })
  if (!r.ok) {
    log.info('Perfil del proyecto', `${sitio.host} · no se pudo contar la muestra · ${r.reason}`)
    return
  }
  // Lo capturado al pedir manda al volver (§8.22): la muestra tarda lo que
  // tarde y el panel puede estar ya en otro sitio, o en otro arranque.
  if (state.bootToken !== testigo || (state.site?.host ?? state.lastHost) !== sitio.host) return
  state.profile = r.profile
}

/**
 * La muestra del proyecto, contada y guardada.
 *
 * Una sola petición con la sesión del navegador: la plantilla fija
 * `sampleQuery` (§8.12) y los campos de la muestra, que NO incluyen personas.
 * El mensaje se manda desde aquí y no desde los dos sitios que necesitan el
 * perfil —el refresco del arranque y la reconstrucción del contexto—, para que
 * la petición y lo que se guarda estén escritos una vez.
 *
 * Escribe bajo el host que se le pasa, nunca bajo el de ahora; quien llama
 * decide si lo que vuelve entra en `state` (§8.22).
 *
 * @returns {Promise<{ok:true, profile:object, ms:number}|{ok:false, reason:string, detail:string}>}
 */
async function countProfile(sitio, scope, { tabId = state.tabId, signal = null } = {}) {
  const jql = sampleQuery(scope?.kind === 'project' ? scope.key : '')
  if (!jql) return { ok: false, reason: 'ámbito', detail: 'aquí no hay un proyecto del que contar una muestra' }

  const r = await chrome.tabs
    .sendMessage(tabId, { type: MSG.JQL_SEARCH, jql, limit: JIRA_REST_LIMITS.maxResults, fields: SAMPLE_FIELDS, cloud: sitio.cloud })
    .catch(() => null)
  if (!r?.ok) return { ok: false, reason: r?.reason || 'sin respuesta', detail: jqlFailText(r, sitio.host) }
  // «Un indexado cancelado no escribe nada» (§4.6) vale también para el perfil:
  // el Cancelar del velo no corta la petición —tarda lo que tarde—, pero lo que
  // vuelva después ya no se guarda ni se registra (revisión adversaria de H9).
  if (signal?.aborted) return { ok: false, reason: 'cancelado', detail: 'Cancelado.' }

  const profile = profileFromSample(r.issues, { projectKey: scope.key })
  await saveProfile(sitio.host, profile)
  log.ok(
    'Perfil del proyecto',
    `${sitio.host} · muestra de ${profile.sampled} incidencias · ${profile.types.length} tipos · ${profile.statuses.length} estados` +
      `${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ''}`
  )
  return { ok: true, profile, ms: r.ms }
}

/**
 * El contexto del Confluence enlazado a este Jira, si lo hay.
 *
 * Se enlazan al configurar las claves con los dos productos en hosts distintos
 * (`siteRecords`). Sólo desde Jira: en Confluence el contexto propio ya es el
 * de Confluence, y en Cloud los dos productos comparten host y contexto.
 */
async function loadLinkedContext(saved) {
  if (state.site?.product !== 'jira' || !saved?.confluenceHost) return null
  const host = saved.confluenceHost
  // Todo lo suyo en UNA lectura, como el sitio propio (P4): el contexto, el
  // índice y el prefijo del wiki iban en tres lecturas encadenadas del almacén
  // —y `getSite` relee el mapa entero de `faro:sites`—, así que el arranque de
  // un Jira con Confluence enlazado nunca tuvo el «un solo await» que P4
  // presumía (revisión adversaria de H6).
  const bundle = await getSiteBundle(host)
  const contextMd = bundle.contextMd
  // Su índice: es donde se buscan las páginas base de un análisis desde Jira,
  // que son páginas de ESE Confluence. Nunca se guarda desde aquí, y su
  // `stale` tampoco se anuncia: el índice de ese host lo reconstruye su panel.
  const index = bundle.index
  // Y el prefijo de su wiki, si se observó al visitarlo: su API cuelga de ahí
  // (`/confluence/rest/api/…` en un Data Center con ruta de contexto).
  const wikiPrefix = typeof bundle.site?.wikiPrefix === 'string' ? bundle.site.wikiPrefix : ''
  // El enlace es un hecho del sitio guardado, no de que ya haya contexto: sin
  // esto, una URL de ese Confluence pegada en las páginas base se rechazaba
  // como «otro sitio» justo antes de indexarlo, que es cuando más falta hace.
  if (contextMd?.trim() || index) {
    log.info(
      'Contexto de Confluence enlazado',
      `${host} · ${contextMd?.length || 0} caracteres · ${index ? indexSize(index) + ' entradas' : 'sin índice'}`
    )
  }
  return { host, contextMd: contextMd || '', index: index || null, wikiPrefix }
}

/**
 * Dónde se buscan las páginas base: en Jira, en el índice del Confluence
 * enlazado (son páginas suyas); en Confluence —o en un Jira Cloud, que
 * comparte host y contexto—, en el del sitio.
 */
function sourcesIndex() {
  if (state.site?.product === 'jira' && state.linkedContext?.index) return state.linkedContext.index
  return state.index
}

/** El host del Confluence enlazado, si estamos en un Jira que lo tiene. */
function linkedHost() {
  return state.site?.product === 'jira' ? state.linkedContext?.host || '' : ''
}

/**
 * Las páginas de referencia que el contexto del sitio nombra con su id: las que
 * un análisis debería tener delante según lo que el indexador escribió.
 *
 * Se leen del CONTEXT.md que el panel ya tiene cargado, no de ninguna clave:
 * docs/PLAN.md §3.2 descartó la lista estructurada del indexador y con ella la
 * clave que la guardaría (`references.js` lo explica). Desde un Jira se miran
 * los DOS contextos —el del propio Jira, que dice dónde está documentado cada
 * cosa en Confluence, y el del Confluence enlazado— porque los dos hablan de
 * páginas de ese mismo Confluence; se funden por id y gana el primero.
 *
 * Memorizado por identidad de los objetos que lo producen: un contexto nuevo es
 * otra cadena, y entonces se vuelve a leer. Sin eso, abrir la pantalla recorría
 * dos veces el contexto entero por cada pasada.
 */
function currentReferences() {
  const propio = state.contextMd || ''
  const enlazado = state.linkedContext?.contextMd || ''
  const index = sourcesIndex()
  const memo = state.references
  if (memo.items && memo.propio === propio && memo.enlazado === enlazado && memo.index === index) return memo.items

  const items = [
    ...Object.values(referencesFromContext(propio, { index }).items),
    ...(enlazado ? Object.values(referencesFromContext(enlazado, { index }).items) : []),
  ]
  const fundidas = normalizeReferences({ items }, { index })
  state.references = { propio, enlazado, index, items: fundidas }
  return fundidas
}

/**
 * A quién se le pregunta por páginas de Confluence desde aquí: al sitio de la
 * pestaña por el content script, o al Confluence enlazado desde el panel
 * (Jira Data Center). null si no hay a quién.
 */
function sourcesTarget() {
  return sourcesSearchTarget(state.site, state.linkedContext)
}

/**
 * ¿Tiene Faro permiso sobre ese origen? Es lo que hace falta para que una
 * página de la extensión —este panel— pueda hacerle un GET a un dominio que
 * no está en el manifest, con las cookies de su sesión.
 */
async function hasHostPermission(origin) {
  const pattern = String(origin || '').replace(/\/+$/, '') + '/*'
  return chrome.permissions.contains({ origins: [pattern] }).catch(() => false)
}

/**
 * Comprueba que Faro puede actuar sobre la pestaña, y si no, lo pide.
 *
 * El manifest sólo declara `*.atlassian.net`. En un Confluence propio el
 * content script no existe, y sin él la navegación asistida y el resaltado no
 * tienen a quién hablarle: se quedaban sin hacer nada, en silencio.
 */
async function ensureContentAccess({ announce = true } = {}) {
  if (!state.site || !state.tabId) return false

  const status = await chrome.runtime
    .sendMessage({ type: MSG.CONTENT_STATUS, tabId: state.tabId, origin: state.site.origin })
    .catch(() => null)

  if (status?.ready) return true

  if (status?.granted) {
    // Permiso hay, pero la pestaña se cargó antes de que el script existiera.
    const r = await chrome.runtime
      .sendMessage({ type: MSG.REQUEST_HOST_PERMISSION, origin: state.site.origin, tabId: state.tabId })
      .catch(() => null)
    if (r?.ok) {
      log.ok('Content script inyectado', state.site.host)
      return true
    }
  }

  if (announce) showPermissionNotice()
  return false
}

/** Aviso accionable: el permiso se pide desde aquí, que es donde hay gesto. */
function showPermissionNotice() {
  clearEmpty()
  if (el.chat.querySelector('.perm-card')) return

  const card = document.createElement('div')
  card.className = 'nav-card perm-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = 'Falta un permiso'

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent = `Actuar dentro de ${state.site.host}`

  const text = document.createElement('div')
  text.className = 'nav-text'
  text.textContent =
    'Puedo consultar y responder, pero para tocar la página —resaltar un fragmento, marcar las observaciones de un análisis o guiarte paso a paso— necesito permiso sobre este dominio. No está en el manifest porque es tuyo, no de Atlassian.'

  const actions = document.createElement('div')
  actions.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.type = 'button'
  btn.textContent = 'Dar permiso'
  btn.addEventListener('click', async () => {
    btn.disabled = true
    const r = await requestHostPermission()
    if (r.denied) {
      btn.disabled = false
      // Hay versiones de Chrome donde `permissions.request` no funciona desde
      // el panel lateral. Si pasa, queda la via manual, que siempre vale.
      card.appendChild(noticeNode(manualPermissionText() + ' Sin permiso sólo puedo llevarte de golpe.', true))
      return
    }
    if (r.ok) {
      card.remove()
      showNotice('Listo. Ya puedo resaltar y guiarte paso a paso en ' + state.site.host + '.')
    } else {
      btn.disabled = false
      card.appendChild(noticeNode('Permiso dado, pero no he podido inyectarme: ' + r.error, true))
    }
  })
  actions.appendChild(btn)

  card.append(kicker, title, text, actions)
  el.chat.appendChild(card)
  announce(`${kicker.textContent}: ${title.textContent}`)
  scrollChat()
}

/**
 * Pide el permiso sobre el dominio del sitio e inyecta el content script.
 *
 * Se pide desde el panel y detrás de un clic: `permissions.request` exige un
 * gesto del usuario, y el gesto no viaja hasta el service worker por
 * sendMessage. Lo usan la tarjeta del chat y la pantalla de páginas base, que
 * tapa al chat y necesita su propio botón.
 *
 * Por defecto, sobre el sitio de la pestaña, inyectando el content script en
 * ella. Con `target`, sobre otro dominio —el Confluence enlazado a este Jira,
 * para poder preguntarle a su API desde el panel—: el service worker registra
 * el content script para cuando el usuario lo abra, y no hay pestaña en la
 * que inyectar nada.
 *
 * @param {{origin:string, host:string, tabId?:number|null}} [target]
 * @returns {Promise<{ok:true}|{ok:false, denied:true}|{ok:false, error:string}>}
 */
async function requestHostPermission(target = null) {
  const origin = target?.origin || state.site.origin
  const host = target?.host || state.site.host
  const tabId = target ? target.tabId ?? null : state.tabId
  const pattern = origin.replace(/\/+$/, '') + '/*'
  const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false)
  if (!granted) {
    log.warn('Permiso de host denegado', host)
    return { ok: false, denied: true }
  }
  const r = await chrome.runtime
    .sendMessage({ type: MSG.REQUEST_HOST_PERMISSION, origin, tabId })
    .catch(() => null)
  if (r?.ok) {
    log.ok('Permiso concedido', host)
    return { ok: true }
  }
  return { ok: false, error: r?.error || 'motivo desconocido' }
}

/**
 * El permiso que le falta a la pantalla de páginas base: el del Confluence
 * enlazado si es a él a quien hay que preguntar, o el del sitio.
 */
async function requestSourcesPermission() {
  const target = sourcesTarget()
  if (target?.via === 'linked') return requestHostPermission({ origin: target.site.origin, host: target.site.host, tabId: null })
  return requestHostPermission()
}

/** @param {string} [origin] otro origen que no sea el del sitio (el Confluence enlazado) */
function manualPermissionText(origin = '') {
  return (
    'No se concedió. Si no llegó a salir el diálogo, dalo a mano: chrome://extensions → Faro → ' +
    'Detalles → Acceso al sitio → «En sitios específicos», y añade ' +
    (origin || state.site.origin) +
    '.'
  )
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * El desplegable de Skills.
 *
 * La lista es fija y vive en `skills.js`: aquí sólo se pinta. Lo que cambia de
 * verdad al elegir una es el bloque de sistema y si debajo de la respuesta
 * aparece la tarjeta «Puedo llevarte».
 */
function fillSkills() {
  el.skill.textContent = ''
  for (const s of SKILLS) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.label
    opt.title = s.hint
    el.skill.appendChild(opt)
  }
  el.skill.value = state.skill
}

function setSkill(id) {
  state.skill = skillById(id).id
  el.skill.value = state.skill
  el.skill.title = skillById(state.skill).hint
  // El botón de páginas base sólo tiene sentido en Análisis.
  paintSourcesUi()
}

function fillModels(models, selected) {
  el.model.textContent = ''
  const byProvider = new Map()
  for (const m of models) {
    if (!byProvider.has(m.providerName)) byProvider.set(m.providerName, [])
    byProvider.get(m.providerName).push(m)
  }
  for (const [provider, list] of byProvider) {
    const group = document.createElement('optgroup')
    group.label = provider
    for (const m of list) {
      const opt = document.createElement('option')
      opt.value = `${m.providerID}/${m.modelID}`
      opt.textContent = m.name + (m.free ? ' · gratis' : '')
      group.appendChild(opt)
    }
    el.model.appendChild(group)
  }
  if (selected) {
    el.model.value = `${selected.providerID}/${selected.modelID}`
    state.model = { providerID: selected.providerID, modelID: selected.modelID }
  }
  if (!el.model.value && models[0]) {
    el.model.value = `${models[0].providerID}/${models[0].modelID}`
    state.model = { providerID: models[0].providerID, modelID: models[0].modelID }
  }
}

// ------------------------------------------------------------------- chat

/**
 * La clase de un botón del chat que sólo tiene sentido con el turno parado.
 *
 * Lo que cuelga de una respuesta se pinta DENTRO del `try` de `send()`, con
 * `state.streaming` todavía en true: el «Sesión nueva» del aviso de
 * conversación pesada nacía con su manejador diciendo «si se está respondiendo,
 * nada» y sin decirlo por ninguna parte, así que durante segundos —o minutos,
 * si `offerNotes` lanza la pasada que trocea— era un botón que no hacía nada
 * (revisión adversaria de H6). Con esta clase nacen desactivados y
 * `setStreaming` los devuelve a la vez que el «Sesión nueva» de la cabecera:
 * un solo sitio decide cuándo vuelven.
 */
const NEEDS_IDLE = 'needs-idle'

/**
 * La fila que corona una conversación recortada.
 *
 * No se pide la sesión entera al abrir el panel (`RESTORE_LIMITS.messages`), así
 * que cuando la ventana viene llena hay que decirlo: lo que falta no se ha
 * perdido, está en opencode, y un botón lo trae. Va DENTRO del chat y no en el
 * marco, para que se vaya con el scroll como el principio de la conversación que
 * es; por eso se crea aquí y no en panel.html, donde sería un segundo elemento
 * con el mismo id en cuanto el chat se repinta.
 */
function olderTurnsRow() {
  const row = document.createElement('div')
  row.className = 'older-turns'

  const texto = document.createElement('span')
  texto.textContent = `Conversación larga: se enseñan los últimos ${RESTORE_LIMITS.messages} mensajes.`

  const btn = document.createElement('button')
  btn.id = 'btn-older-turns'
  btn.className = 'ghost small ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Ver toda la conversación'
  // Con un turno en vuelo, no: `restoreConversation` vacía el chat y la burbuja
  // viva se quedaría fuera del documento, con las consultas plegadas dentro,
  // mientras el turno sigue pintando en el vacío. Nace desactivado si se
  // restauró a mitad de respuesta, y `setStreaming(false)` lo devuelve.
  btn.disabled = state.streaming
  btn.addEventListener('click', () => {
    // Y el clic que llegue justo en el cambio tampoco pasa: callarse aquí
    // sería el botón muerto de antes.
    if (state.streaming) {
      showNotice('Espera a que termine la respuesta.', false, { force: true })
      return
    }
    btn.disabled = true
    // El mismo testigo que el arranque vigente: si mientras se descarga la
    // conversación entera se cambia de sitio, lo que se pinte será del suyo.
    restoreConversation(state.bootToken, { all: true }).catch((err) => {
      // El botón vuelve: si el chat no llegó a repintarse, la fila sigue ahí y
      // se puede reintentar; si se repintó, este botón ya no está en el
      // documento y reactivarlo no se ve.
      btn.disabled = false
      showNotice('No he podido traer el resto de la conversación: ' + (err?.message || err), true)
    })
  })

  row.append(texto, btn)
  return row
}

/**
 * @param {object} [testigo] el testigo del arranque que pide restaurar: si
 *        otro arranque tomó el relevo mientras se leía la sesión, lo suyo lo
 *        pinta él, y vaciar el chat aquí sería vaciar el suyo. Por defecto,
 *        el arranque vigente (reindexar, «Omitir», subir un contexto).
 * @param {{all?: boolean}} [opciones] `all` pide la sesión ENTERA, sin ventana:
 *        es lo que hace el botón «Ver toda la conversación».
 */
async function restoreConversation(testigo = state.bootToken, { all = false } = {}) {
  let messages = null
  let recortada = false
  // El peso de la sesión es de este host, como la sesión misma.
  const host = state.site?.host ?? state.lastHost
  let pesoGuardado = 0
  // Cuántas burbujas hay pintadas AHORA, que es cuando se ha pulsado: con
  // `all` la vista se ancla a la primera de ellas, que es por donde el usuario
  // estaba leyendo. Sin `all` no hace falta: el chat se va al final.
  const previas = all ? el.chat.querySelectorAll('.msg').length : 0
  // Y con qué sesión se piden los mensajes. Traer la conversación entera tarda
  // lo que tarde opencode, y si en ese hueco se abre una sesión nueva —que
  // vacía el chat— pintar lo que ha llegado sería resucitar la que se acaba de
  // cerrar. Si la lectura FALLA, la sesión la olvidamos aquí mismo: ese cambio
  // es nuestro y no cuenta como que sea otra (revisión adversaria de H6).
  const sesion = state.sessionID
  let leyo = true
  if (state.sessionID) {
    try {
      // Sin `limit` esto bajaba la sesión entera —las salidas de herramientas
      // incluidas, megabytes— cada vez que se abre el panel, se vuelve al sitio
      // o se sube un contexto, para pintar sólo el texto (docs/PLAN.md §2.6
      // P6b). Y con ella, lo que la sesión lleva arrastrado, que se guardó
      // aparte para no tener que recontar los mensajes que ya no se piden.
      const [crudos, peso] = await Promise.all([
        state.client.listMessages(state.sessionID, all ? undefined : RESTORE_LIMITS.messages),
        host ? getSessionWeight(host).catch(() => 0) : 0,
      ])
      const lista = Array.isArray(crudos) ? crudos : []
      // La ventana llena es la señal de que puede faltar conversación por
      // arriba: opencode devuelve los ÚLTIMOS N (comprobado en integración).
      recortada = !all && lista.length >= RESTORE_LIMITS.messages
      // El orden se asegura aquí aunque opencode ya los mande ascendentes, y se
      // tiran las respuestas del asistente que quedaron sin su pregunta al
      // cortar: sin eso, el primer turno de la ventana sale descabezado.
      messages = dropOrphans(sortMessages(lista))
      pesoGuardado = peso
    } catch {
      state.sessionID = null
      leyo = false
    }
  }
  // El chat se vacía DESPUÉS de leer la sesión y de comprobar el testigo:
  // dos arranques solapados vaciaban y rellenaban por turnos (C3).
  if (state.bootToken !== testigo) return
  if (leyo && state.sessionID !== sesion) return
  el.chat.textContent = ''
  state.turns = []
  // Lo que la conversación arrastra: lo guardado de la sesión y lo que se ve en
  // la ventana, lo que sea mayor. Lo guardado cuenta la sesión entera (también
  // los mensajes que ya no se piden) y es lo bueno; el recuento de la ventana
  // rescata las sesiones abiertas antes de que esto existiera, y nunca lo baja.
  // El aviso vuelve a quedar por dar: el chat se ha repintado entero —abrir el
  // panel, volver al sitio, reindexar— y el que hubiera se fue con él.
  const deLaVentana = (messages || []).reduce((n, m) => n + toolOutputSize(m.parts), 0)
  state.sessionToolChars = Math.max(pesoGuardado, deLaVentana)
  state.heavyWarned = false
  if (recortada) {
    el.chat.appendChild(olderTurnsRow())
    log.info(
      'Conversación recortada',
      `se piden los últimos ${RESTORE_LIMITS.messages} mensajes · ${formatBytes(deLaVentana)} en salidas de herramientas`
    )
  }
  // Lo restaurado es historia: no se anuncia al lector de pantalla.
  state.restoring = true

  if (messages) {
    try {
      // opencode parte un turno en varios mensajes del asistente —uno por
      // cada vuelta de herramientas—. Se juntan por turno, como hace runTurn
      // en vivo: si no, la prosa numerada y su bloque de anclas podían quedar
      // en burbujas distintas y el bloque perderse.
      let ultimoAnalisis = null
      const burbujas = []
      let turno = null
      let urlDelTurno = ''
      let baseDelTurno = null
      let analisisDelTurno = false
      let preguntaDelTurno = ''
      const cerrarTurno = () => {
        if (!turno) return
        // Un análisis cierra con su bloque JSON de anclas: no es para leerlo.
        // Las marcas no se rehacen solas al restaurar —vivían en la página
        // donde se hicieron—, pero las anclas se guardan para poder volver a
        // ponerlas con un clic.
        const { prose: cruda, anchors } = splitAnchorsBlock(turno.textos.join('\n\n'))
        // La numeración «a su manera» se adapta también aquí —lo guardado es
        // lo que escribió el modelo, no lo que el panel repintó—, pero sólo en
        // los turnos de Análisis (una lista «1.» de Búsqueda o de General no
        // son observaciones) y no en un seguimiento que cita un punto sin
        // traer anclas (sus pasos no son observaciones). Lo encontró la revisión.
        const adaptar = !!cruda && (turno.analisis || !!anchors) && !(questionCitesPoint(turno.pregunta) && !anchors)
        const prose = !cruda ? '' : adaptar ? normalizeNumbering(cruda, { expected: expectedCount(anchors), shortAnswer: NOTE_LIMITS.shortAnswer }).prose : cruda
        if (prose) {
          const bubble = addAssistantMessage(prose)
          state.turns.push({ role: 'assistant', text: prose })
          burbujas.push({ prose, bubble })
          if (anchors && observationNumbers(prose, anchors).numeros.length) {
            ultimoAnalisis = { prose, anchors, bubble, url: turno.url, conBase: turno.conBase }
          }
        }
        turno = null
      }

      for (const m of messages || []) {
        const text = (m.parts || []).filter((p) => p.type === 'text' && p.text && !p.synthetic).map((p) => p.text).join('')

        if (m.info.role === 'user') {
          cerrarTurno()
          urlDelTurno = pageUrlFromSystem(m.info.system)
          // Las páginas base viajaron en el sistema de ese mensaje: la nota
          // de abajo se reconstruye de ahí, con el mismo texto que al mandar.
          baseDelTurno = sourcesFromSystem(m.info.system)
          // Y los resultados precargados también viajaron ahí (H12): la nota de
          // abajo se reconstruye de la misma cabecera que se escribió al mandar.
          const precargadoDelTurno = preloadFromSystem(m.info.system)
          // Y si el turno fue un Análisis: la cabecera del modo va en su sistema.
          analisisDelTurno = String(m.info.system || '').includes('MODO ANÁLISIS.')
          if (!text.trim()) continue
          // En opencode quedó guardado con el fragmento señalado por delante;
          // aquí se enseña sólo la pregunta, y una nota de que iba acompañada.
          // La página en bloques viajó en el sistema de ese mensaje: se dice
          // igual, que estuvo ahí.
          const limpio = stripSelectionBlock(text)
          preguntaDelTurno = limpio
          const conPagina = String(m.info.system || '').includes(PAGE_OPEN)
          // Lo que se analizó era una incidencia si la URL del turno lo dice.
          const productoDelTurno = parseAtlassianUrl(urlDelTurno)?.product || state.site?.product || ''
          addUserMessage(
            limpio,
            [
              limpio === text ? '' : 'con una selección de la página',
              conPagina ? `con el texto de la ${productoDelTurno === 'jira' ? 'incidencia' : 'página'}` : '',
              baseDelTurno ? sourcesNote(baseDelTurno, { product: productoDelTurno }) : '',
              preloadNote(precargadoDelTurno),
            ]
              .filter(Boolean)
              .join(' · ')
          )
          state.turns.push({ role: m.info.role, text: limpio })
          continue
        }

        if (!text.trim()) continue
        if (!turno) {
          turno = {
            textos: [],
            url: urlDelTurno,
            conBase: (baseDelTurno?.count || 0) > 0,
            analisis: analisisDelTurno,
            pregunta: preguntaDelTurno,
          }
        }
        turno.textos.push(text)
      }
      cerrarTurno()

      // Si hay marcas en la página —el chat se repinta al cerrar Ajustes, al
      // reindexar…—, la tarjeta viva se vuelve a pintar bajo la respuesta de
      // la que salieron (o bajo la última, si aquélla ya no está). Si no hay
      // marcas, la atenuada del último análisis con anclas, con su botón.
      // La respuesta se reconoce por su prosa, o por la prosa ORIGINAL si los
      // «[n]» los puso la pasada que trocea (opencode guarda la original):
      // entonces se repinta con la numerada, para que las pastillas vuelvan.
      if (state.notes.length && state.notesResult) {
        const { prose, prosaOriginal, filas, placed, missed, detail, conBase, product } = state.notesResult
        const misma = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim()
        const porProsa = burbujas.find((b) => misma(b.prose, prose))
        const porOriginal = !porProsa && prosaOriginal ? burbujas.find((b) => misma(b.prose, prosaOriginal)) : null
        const dueña = porProsa || porOriginal || burbujas[burbujas.length - 1]
        if (porOriginal) {
          const cuerpo = porOriginal.bubble
          cuerpo.textContent = ''
          cuerpo.append(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, allowHref: linkAllowed }))
        }
        if (dueña) {
          state.noteRows = new Map()
          state.notesCard = attachToBubble(dueña.bubble, notesCard(filas, placed, missed, detail, { conBase, product }))
        }
      } else if (ultimoAnalisis) {
        attachToBubble(ultimoAnalisis.bubble, staleNotesCard(ultimoAnalisis))
      }
    } catch (err) {
      console.error('[faro] restaurando la conversación', err)
    }
  }

  if (!el.chat.children.length) showWelcome()
  state.restoring = false
  if (all) {
    // Se ha pedido ver lo ANTERIOR: irse al fondo devolvería al usuario justo a
    // donde ya estaba, con lo que acaba de traer fuera de la pantalla. La vista
    // se ancla al primer mensaje que ya estaba pintado —el que coronaba el chat
    // al pulsar—, sin animación, y a partir de ahí el chat deja de estar pegado
    // al fondo: lo que llegue luego no lo arrastra (A7).
    const msgs = el.chat.querySelectorAll('.msg')
    const ancla = msgs[msgs.length - previas]
    state.chatPinned = false
    if (ancla) ancla.scrollIntoView({ block: 'start' })
    else scrollChat({ force: true })
    return
  }
  // Un chat recién pintado empieza por el final, esté donde esté el scroll.
  scrollChat({ force: true })
}

function showWelcome() {
  const scope = defaultScope(state.site)
  const wrap = document.createElement('div')
  wrap.className = 'empty'

  const beacon = document.createElement('span')
  beacon.className = 'beacon big live'
  wrap.appendChild(beacon)

  const h = document.createElement('h2')
  h.textContent = state.index
    ? `${indexSize(state.index)} cosas indexadas aquí`
    : 'Listo para escuchar'
  wrap.appendChild(h)

  const p = document.createElement('p')
  p.textContent = scope
    ? `Pregúntame sobre ${scope.label}. Si la respuesta está en algún sitio, te llevo.`
    : 'Pregúntame lo que quieras sobre este sitio.'
  wrap.appendChild(p)

  // «Qué mirar hoy» (H11): hasta `TODAY_LIMITS.emptyRows` filas de lo que ha
  // cambiado desde que lo miraste, entre la explicación y las sugerencias. Nace
  // vacío y oculto: lo llena `paintTodayBlock` con lo que YA se ha leído, y si
  // no hay nada que enseñar el chat vacío queda byte a byte como estaba. Lo
  // pinta `paintSearchChips` al final de esta función, porque comparte
  // presupuesto con las pastillas y necesita saber cuántas hay.
  const hoy = document.createElement('div')
  hoy.className = 'today hidden'
  wrap.appendChild(hoy)

  // Las sugerencias son del producto Y de la Skill: en Análisis no se ofrece
  // buscar nada, y con páginas base se ofrece contrastar con ellas.
  const suggestions = document.createElement('div')
  suggestions.className = 'suggestions'
  for (const s of suggestionsFor(state.site, state.skill, state.sources)) {
    const b = document.createElement('button')
    b.className = 'suggestion'
    b.type = 'button'
    b.textContent = s
    b.addEventListener('click', () => {
      el.input.value = s
      send()
    })
    suggestions.appendChild(b)
  }
  wrap.appendChild(suggestions)

  // Y los chips de búsqueda al instante (H8), debajo: consultas deterministas
  // que no pasan por el modelo. Nace oculto y se llena con lo que YA se sabe,
  // sin pedir nada; lo que falte llega después y repinta sólo esta caja.
  const chips = document.createElement('div')
  chips.className = 'search-chips hidden'
  wrap.appendChild(chips)

  el.chat.appendChild(wrap)
  announce(h.textContent)

  paintSearchChips(chips)
  // Fuera del pintado: leer los campos de la incidencia y los filtros favoritos
  // son dos mensajes a la pestaña, y el chat vacío no puede esperarlos.
  loadSearchChipSources(chips).catch((err) => log.info('Búsquedas al instante', String(err?.message || err)))
}

/**
 * Los chips de «búsquedas al instante» con lo que se sabe AHORA MISMO.
 *
 * Se pinta sólo esta caja y no el estado vacío entero a propósito: repintarlo
 * volvería a anunciar «Listo para escuchar» al lector de pantalla cada vez que
 * llega una fuente nueva (A2, el mismo motivo por el que cambiar de Skill no lo
 * repinta). Sin chips que ofrecer, la caja se queda oculta y el estado vacío
 * queda exactamente como estaba.
 */
function paintSearchChips(box) {
  if (!box?.isConnected) return
  box.textContent = ''
  // El interruptor maestro de las lecturas REST: apagado, ni chips ni nada que
  // los llene. Y en Confluence o en Jira Cloud no hay chips que ofrecer, que lo
  // decide `searchChips` mirando el sitio.
  const chips = state.settings.restTools
    ? searchChips(state.site, {
        // Sólo los campos de la página que hay DELANTE: la misma regla con la que
        // `readIssueFieldsQuick` decide si los que tiene le valen.
        issueFields: state.issueFields && samePage(state.issueFields.url, state.tabUrl) ? state.issueFields.fields : null,
        // Los dos estados más usados salen del perfil contado (H9): con él, el
        // grupo «estado» que H8 dejó hecho en `search-chips.js` ya tiene qué
        // ofrecer. Sin perfil, `suggestedQueries` no saca ninguno y los chips
        // son exactamente los de antes.
        profile: currentProfile(),
        favouriteFilters: state.favouriteFilters || [],
        recentJql: state.recentJql,
      })
    : []
  box.classList.toggle('hidden', !chips.length)
  // El bloque de «Qué mirar hoy» comparte el sitio del chat vacío con estas
  // pastillas: cuantas más haya, menos le queda, y por debajo de su presupuesto
  // se degrada a una línea (decisión 3 de docs/PLAN.md §3.4). Se le pasa cuántas
  // hay AQUÍ, porque cuando llega una fuente nueva sólo se repinta esta caja.
  paintTodayBlock(null, { chips: chips.length })
  if (!chips.length) return

  const fine = document.createElement('div')
  fine.className = 'fine'
  fine.textContent = 'Búsquedas al instante, sin modelo'
  box.appendChild(fine)

  const fila = document.createElement('div')
  fila.className = 'search-chip-row'
  for (const chip of chips) {
    const b = document.createElement('button')
    b.className = 'ghost small search-chip ' + NEEDS_IDLE
    b.type = 'button'
    b.textContent = chip.label
    // La consulta entera, para poder leerla ANTES de pulsar.
    b.title = chip.title
    // El chat vacío desaparece en cuanto empieza un turno, así que aquí casi no
    // se llega con uno en vuelo; se trata igual que los demás botones del chat
    // (H6) para que no haya un botón que parezca vivo y no haga nada.
    b.disabled = state.streaming
    b.addEventListener('click', () => {
      if (state.streaming) {
        showNotice('Espera a que termine la respuesta.', false, { force: true })
        return
      }
      runDirectSearch(chip).catch((err) => log.error('Búsqueda directa', 'no se pudo hacer: ' + String(err?.message || err)))
    })
    fila.appendChild(b)
  }
  box.appendChild(fila)
}

/**
 * Lo que los chips necesitan y todavía no está: los campos de la incidencia
 * abierta y los filtros favoritos del usuario.
 *
 * Se piden UNA vez por página y por sitio, y sólo cuando hay un chat vacío
 * delante (o sea, cuando se van a pintar chips): son dos lecturas de la API del
 * propio Jira con la sesión del navegador, no hace falta hacerlas al arrancar
 * para algo que quizá nadie mire. Al volver se repinta la caja, que puede
 * haberse ido ya (el usuario escribió, o cambió de sitio).
 */
async function loadSearchChipSources(box) {
  if (!state.settings.restTools || state.site?.product !== 'jira' || state.site?.cloud) return
  const host = state.site.host
  await readIssueFieldsQuick()
  if (state.favouriteFilters === null && state.site?.host === host) {
    state.favouriteFilters = []
    const r =
      state.tabId != null && (await ensureContentAccess({ announce: false }))
        ? await chrome.tabs.sendMessage(state.tabId, { type: MSG.FAVOURITE_FILTERS }).catch(() => null)
        : null
    if (r?.ok && Array.isArray(r.filters)) {
      state.favouriteFilters = r.filters
      if (r.filters.length) log.ok('Filtros favoritos', `${r.filters.length} leídos de ${host}`)
    } else if (r && !r.ok) {
      // Sin aviso en el chat: los chips son un extra y quedarse sin los filtros
      // sólo quita chips. Queda en el Registro, con el motivo del servidor.
      log.info('Filtros favoritos', `no se pudieron leer · ${r.reason || 'sin motivo'}`)
    }
  }
  if (state.site?.host !== host) return
  paintSearchChips(box)
}

/**
 * Los campos de la incidencia abierta, sin trocear la página.
 *
 * El Análisis ya los trae con el digest, pero para los chips hace falta saber
 * de qué épica y de qué componente va la incidencia SIN haber analizado nada, y
 * trocear una página cuesta (H3 le puso número). `PAGE_DIGEST {fieldsOnly}` lee
 * los campos y nada más. Se recuerda por URL —también cuando no hay campos, que
 * es lo normal fuera de una incidencia— para no repetir la pregunta en cada
 * chat vacío.
 */
async function readIssueFieldsQuick() {
  if (state.site?.product !== 'jira' || state.tabId == null) return null
  if (state.issueFields && samePage(state.issueFields.url, state.tabUrl)) return state.issueFields.fields
  const desde = state.tabUrl
  if (!(await ensureContentAccess({ announce: false }))) return null
  const r = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PAGE_DIGEST, fieldsOnly: true }).catch(() => null)
  if (!r?.ok) return null
  // Lo que se captura al pedir manda al volver (§8.22): si mientras tanto la
  // pestaña cambió de incidencia, `refreshTab` ya vació `state.issueFields` y
  // esta respuesta es de la ANTERIOR. Escribirla ofrecería «Misma épica» de una
  // incidencia que ya no está delante (revisión adversaria de H8).
  if (!samePage(r.url || desde, state.tabUrl)) return null
  const fields = normalizeIssueFields(r.issue)
  state.issueFields = { url: r.url || state.tabUrl, fields }
  return fields
}

/**
 * Ejecutar un chip: una búsqueda sin modelo y sin sesión.
 *
 * Lo que se ejecuta es la consulta que el chip lleva escrita, construida con
 * plantillas y valores escapados (`suggestedQueries`) o guardada por el propio
 * usuario en su Jira: nunca algo deducido de lo que el usuario escribió
 * (CLAUDE.md §8.12). La tarjeta es la misma que la de una búsqueda del modelo
 * —con su lista y su «Abrir la búsqueda en Jira»—, con otro kicker para que se
 * vea de dónde salió.
 *
 * LÍMITE, y se dice bajo la pregunta: esto no está en la sesión de opencode, así
 * que no sobrevive a repintar el chat. `restoreConversation` pinta los mensajes
 * que opencode guarda, y aquí no ha hablado nadie con opencode. Tampoco entra en
 * `state.turns`: no es un turno, y contarlo como tal haría que la memoria entre
 * sesiones resumiera una conversación que no existe.
 */
async function runDirectSearch(chip) {
  if (!chip?.jql || !state.site || state.streaming) return
  // Lo capturado al pedir es lo que manda al pintar (§8.22): leer la lista
  // tarda hasta seis segundos y el panel puede haberse ido a otro sitio.
  const site = state.site
  const sessionID = state.sessionID
  const tabId = state.tabId
  const destino = jqlLink(chip.jql, { origin: site.origin })
  if (!destino) return

  addUserMessage(chip.label, 'búsqueda directa, sin modelo')
  const card = navCard(jqlPlan(destino, { kicker: 'Búsqueda directa', title: chip.label }))
  card.classList.add('direct')
  attachToBubble(addAssistantMessage(''), card)
  log.ok('Búsqueda directa', `${chip.kind} · ${chip.label} · ${chip.jql}`)

  // Una consulta con una función que no es de Jira no se ejecuta aquí: la abre
  // Jira, que es quien sabe. El botón de la tarjeta ya lleva a ella.
  if (!chip.run) {
    const nota = document.createElement('div')
    nota.className = 'nav-text'
    nota.textContent = 'Esta consulta usa una función que no es de Jira: te la abro allí en vez de ejecutarla yo.'
    card.insertBefore(nota, card.querySelector('.nav-actions'))
    announce(nota.textContent)
    return
  }

  const r = await attachJqlResults(card, destino, { site, sessionID, tabId })
  // La lista APUNTA las incidencias en el índice y dentro de un turno las
  // escribe el `persistIndex()` del final de `send()`; aquí no hay turno, así que
  // se escribe ahora. Sin esto lo aprendido se quedaba sólo en memoria hasta la
  // siguiente pregunta, y se perdía al cerrar el panel. No lanza y sin nada
  // apuntado no hace nada.
  await persistIndex()
  // La misma pregunta que acaba de hacer `attachJqlResults` para pintar la lista:
  // el sitio del PANEL es `state.lastHost` cuando la pestaña está fuera de
  // Atlassian. Con `state.site?.host` a secas la lista se pintaba y la consulta
  // no se recordaba (revisión adversaria de H8).
  if (!r?.ok || (state.site?.host ?? state.lastHost) !== site.host) return
  // Sólo se recuerda lo que se ejecutó de verdad: una consulta que Jira rechaza
  // no merece volver a ofrecerse como «Última: …».
  state.recentJql = rememberJql(state.recentJql, chip.jql, { count: r.total })
  await saveSite(site.host, { recentJql: state.recentJql })
}

/**
 * @param {string} text lo que escribió el usuario
 * @param {string} [nota] qué acompañaba a la pregunta, si acompañaba algo
 */
/**
 * Un mensaje que no es novedad no entra animado.
 *
 * `.msg` entra con un `rise` de 180 ms, que está bien para el mensaje que
 * acabas de mandar y es confeti cuando se repinta la conversación entera
 * (hasta `RESTORE_LIMITS.messages` burbujas a la vez). Se decide por mensaje y
 * no con una clase en el chat: entre que se pondría y se quitaría no hay ningún
 * await, así que el navegador nunca llegaría a ver el chat «restaurando».
 */
function markIfRestored(d) {
  if (state.restoring) d.classList.add('restored')
  return d
}

function addUserMessage(text, nota) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'msg user'
  markIfRestored(d)
  d.textContent = text

  // Si la pregunta llevaba adjunto un trozo de la página, se dice. Mandar
  // contexto sin que se vea sería mandarlo a espaldas de quien pregunta.
  if (nota) {
    const tag = document.createElement('div')
    tag.className = 'fine'
    tag.style.marginTop = '4px'
    tag.textContent = nota
    d.appendChild(tag)
  }

  el.chat.appendChild(d)
  // La pregunta que acabas de mandar sí se ve, estés donde estés.
  scrollChat({ force: true })
  return d
}

function addAssistantMessage(text) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'msg assistant'
  markIfRestored(d)
  d.appendChild(renderMarkdown(text, { onLink: openUrl, onNote: focusNote, allowHref: linkAllowed }))
  el.chat.appendChild(d)
  return d
}

function clearEmpty() {
  el.chat.querySelector('.empty')?.remove()
}

function showEmpty({ title, text }) {
  el.chat.textContent = ''
  const wrap = document.createElement('div')
  wrap.className = 'empty'
  const h = document.createElement('h2')
  h.textContent = title
  const p = document.createElement('p')
  p.textContent = text
  wrap.append(h, p)
  el.chat.appendChild(wrap)
  announce(title)
}

/**
 * Un aviso en el hilo del chat.
 *
 * `force` es para los avisos que contestan a algo que el usuario acaba de
 * hacer (pulsar un enlace que no se abre): sin él, tras A7, el aviso se pinta
 * abajo y no se ve si el usuario había subido a leer, y su clic parece no
 * hacer nada (revisión adversaria de H2, 2026-09-14). Lo que llega solo —un
 * fallo del turno, una tarjeta— sigue sin arrastrar la vista.
 */
function showNotice(text, bad = false, { force = false } = {}) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'notice' + (bad ? ' bad' : '')
  d.textContent = text
  el.chat.appendChild(d)
  announce(text)
  scrollChat({ force })
  return d
}

/** Tope de lo que se anuncia de una vez al lector de pantalla. */
const ANNOUNCE_MAX = 600

/**
 * Anuncia algo al lector de pantalla, por la región viva aparte.
 *
 * El chat entero era `aria-live` y en streaming la burbuja se reconstruye con
 * cada trozo: el lector encolaba la respuesta acumulada decenas de veces, y al
 * restaurar la conversación re-leía el historial (docs/PLAN.md §2.5 A2). Ahora
 * se anuncia lo NUEVO, una vez: un resumen al final del turno, los avisos y
 * lo que se cuelga de una respuesta. Cada anuncio es un nodo nuevo —una
 * región viva anuncia las adiciones— para que dos seguidos no se pisen. Y
 * mientras se restaura la conversación, nada: es historia, no novedad.
 */
function announce(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t || state.restoring || !el.announcer) return
  const p = document.createElement('p')
  p.textContent = t.length > ANNOUNCE_MAX ? t.slice(0, ANNOUNCE_MAX) + '…' : t
  el.announcer.appendChild(p)
  while (el.announcer.children.length > 4) el.announcer.firstChild.remove()
}

/** Lo que se anuncia al terminar un turno: que hay respuesta, cuántas observaciones, y su arranque. */
function answerAnnouncement(answer) {
  const n = numberedIn(answer).length
  const plano = String(answer || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `Respuesta lista${n ? ` · ${n} observaciones` : ''}. ${plano}`
}

/**
 * Baja el chat al final, pero sólo si el usuario ESTABA al final (o con
 * `force`: la pregunta que acaba de mandar, un chat recién restaurado). Lo
 * de «estaba» lo mide el oyente de scroll, antes de que nada mute el DOM.
 */
function scrollChat({ force = false } = {}) {
  if (!force && !state.chatPinned) return
  requestAnimationFrame(() => {
    el.chat.scrollTop = el.chat.scrollHeight
  })
}

// ------------------------------------------------------------------ enviar

async function send() {
  const text = el.input.value.trim()
  if (!text || state.streaming || !state.site) return
  if (!state.client) return

  // Lo señalado en la página acompaña a ESTA pregunta y sólo a ésta: dejarlo
  // pegado a todas las siguientes sería contestar sobre algo que el usuario ya
  // no tiene en la cabeza.
  const pick = state.pendingPick
  clearPick()

  // Y lo mismo con los resultados que el usuario pidió precargar (H12): son la
  // respuesta a ESTA pregunta y sólo a ésta, así que se consumen aquí. Si entre
  // el clic y el envío el panel se fue a otro sitio, no viajan: serían
  // incidencias de otro Jira metidas en el `system` de éste (§8.22).
  const preload = state.pendingPreload
  state.pendingPreload = null
  const preloadAlPedir = preload?.host === state.site.host ? preload : null

  el.input.value = ''
  autoGrow()

  // El modo con el que SE MANDA el turno. Lo que viene después —marcar la
  // página, ofrecer llevarte— se decide con éste, no con el que haya en el
  // desplegable cuando termine; y mientras dura, el desplegable se bloquea.
  const skill = state.skill

  // Igual con las páginas base y con la página abierta: se capturan AHORA.
  // `state.site` cambia con la pestaña, y la comprobación del alcance al
  // terminar tiene que hablar de la página que se analizó, no de la que haya
  // abierta entonces. En un Data Center la URL no lleva id: se busca en el
  // índice, y si no, queda el título de la pestaña.
  const sources = skill === 'analisis' && hasSources(state.sources) ? normalizeSources(state.sources, { host: state.site.host }) : null
  // Lo precargado que DE VERDAD viaja: con alcance exclusivo el prompt no lo
  // lleva (`preloadedApplies`, la misma regla que usa `baseSystem`), y entonces
  // tampoco se dice bajo la pregunta que viajó; se dice que NO, más abajo.
  const preloadDelTurno = preloadAlPedir && preloadedApplies({ site: state.site, skill, sources }) ? preloadAlPedir : null
  const pageIdAlPedir = state.site.pageId || currentPageId(state.index, state.tabUrl) || ''
  // En Jira lo abierto es una incidencia: es lo que el alcance permite leer.
  const issueKeyAlPedir = state.site.issueKey || ''
  const productoAlPedir = state.site.product
  const tituloAlPedir = state.tabTitle
  const tabUrlAlPedir = state.tabUrl
  const mcpAlPedir = state.mcpConnected
  // Y el host: si al terminar el panel está en OTRO sitio, la respuesta no
  // entra en su chat ni en su índice (queda en la sesión de opencode de éste).
  const hostAlPedir = state.site.host
  // Y el sitio entero, para cosechar el índice con el que preguntó y no con el
  // que haya en la pestaña al acabar: `state.site` se queda en null en cuanto
  // se mira el correo, y desde H6 el índice va detrás de `offerNotes` (§8.22).
  const sitioAlPedir = state.site

  // Ocupado desde ya: leer la página en bloques tarda, y en ese hueco un
  // segundo clic abría otro turno y otra sesión. Con testigo, para que el
  // `finally` de un turno cancelado no apague el estado del siguiente.
  const testigo = {}
  state.turnToken = testigo
  // El controlador de ESTE turno, guardado aparte: `state.turnAbort` puede ser
  // ya el del siguiente cuando la cola de éste llegue a usarlo.
  const abort = new AbortController()
  state.turnAbort = abort
  setStreaming(true)

  // Cuánto tarda cada fase del turno (H3): leer la página, abrir la sesión, la
  // primera palabra del modelo, el final, pintar la respuesta, el índice y las
  // marcas. Sólo mide; ninguna decisión cuelga de esto. `done()` es una lectura,
  // no un freno: se pregunta al llegar la respuesta —para la línea del registro—
  // y otra vez al acabar, cuando ya están las fases de después.
  // Monótono, como en el arranque: un salto del reloj del sistema a mitad de
  // turno daría una fase negativa o de horas.
  const cron = startTiming(() => performance.now())
  // La primera palabra es el número que se nota: hasta que llega, el usuario
  // sólo ve los tres puntos.
  let primerTexto = false
  // ¿Llegó a mandarse el turno, y con qué sesión? Lo pregunta el `finally` para
  // decidir si esta línea de tiempos habla de algo: un turno que murió leyendo la
  // página no tiene fases que contar, y uno que acabó con el panel en otro sitio
  // o en otra sesión no es del Registro que se está mirando. Fuera del `try` para
  // que el `finally` los alcance; `hostAlPedir` ya vive fuera.
  let medible = false
  let sesionAlPedir = ''

  try {
    // En el modo Análisis la página viaja en el prompt, troceada en bloques
    // numerados: es lo que el modelo señala y contra lo que después se
    // subraya. Se lee ANTES de mandar nada, y se dice debajo de la pregunta:
    // mandar contexto sin que se vea sería mandarlo a espaldas de quien
    // pregunta.
    const lectura = skill === 'analisis' ? await readPageDigest() : { digest: null, reason: '' }
    const digest = lectura.digest
    // Sólo en Análisis se lee la página: en los demás modos no hay fase que medir.
    if (skill === 'analisis') cron.mark('página')

    // Parar mientras se leía la página: no se manda nada, y la pregunta
    // vuelve al cuadro.
    if (abort.signal.aborted) {
      el.input.value = text
      return
    }

    addUserMessage(
      text,
      [
        pick ? 'con ' + pickLabel(pick).toLowerCase() : '',
        digest
          ? `con el texto de la ${productoAlPedir === 'jira' ? 'incidencia' : 'página'} (${digest.count} bloques${digest.truncated ? ', recortado' : ''})`
          : '',
        sources ? sourcesNote(sources, { product: productoAlPedir }) : '',
        // Lo precargado se dice igual que lo señalado y las páginas base: mandar
        // contexto sin que se vea sería mandarlo a espaldas de quien pregunta.
        preloadNote(preloadDelTurno),
      ]
        .filter(Boolean)
        .join(' · ')
    )
    // Un descarte en silencio sería el fallo de §8.14: el usuario pulsó
    // «Preguntar sobre estos» y la lista no va. Se dice, y por qué.
    if (preloadAlPedir && !preloadDelTurno) {
      log.info('Búsqueda precargada', 'no viaja: el alcance del análisis es exclusivo')
      showNotice('Los resultados de la búsqueda no viajan con esta pregunta: el alcance del análisis es exclusivo.')
    }
    state.lastQuestion = text
    state.turns.push({ role: 'user', text })
    scrollChat()

    if (!state.sessionID) {
      const s = await state.client.createSession({ title: `Faro · ${state.site.host}` })
      state.sessionID = s.id
      await setSessionId(state.site.host, s.id)
    }
    if (abort.signal.aborted) return
    // La sesión de ESTE turno: «Nueva sesión» a mitad la olvida, y entonces
    // la respuesta tampoco entra en el chat (queda en la sesión de opencode).
    sesionAlPedir = state.sessionID
    cron.mark('sesión')

    let bubble = document.createElement('div')
    bubble.className = 'msg assistant'
    const toolsBox = document.createElement('div')
    toolsBox.className = 'tools'
    const body = document.createElement('div')
    const typing = document.createElement('span')
    typing.className = 'typing'
    typing.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
    body.appendChild(typing)
    bubble.append(toolsBox, body)
    el.chat.appendChild(bubble)
    scrollChat()

    // El contexto señalado va delante y la pregunta al final: así lo último
    // que lee el modelo es lo que se le pregunta.
    const bloque = selectionBlock(pick)
    const prompt = bloque ? `${bloque}\n\n${text}` : text
    const files = pick?.image
      ? [{ mime: pick.image.mime, filename: pick.image.filename, url: pick.image.url }]
      : []

    log.info(
      'Turno enviado',
      [
        `${modelKey(state.model)} · ${text.length} caracteres`,
        `skill ${skill}`,
        pick ? pickLabel(pick) : '',
        digest ? `página en ${digest.count} bloques${digest.truncated ? ' (recortada)' : ''}` : '',
        sources ? `${sources.pages.length} páginas base · alcance ${sources.mode === 'exclusive' ? 'exclusivo' : 'abierto'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    )

    // La petición va en una variable para poder decir cuánto pesa su `system`
    // (H3): en un Análisis de Jira son 23-27 000 caracteres que viajan en CADA
    // turno y hasta ahora no se veían en ninguna parte. El objeto es el mismo
    // que antes; nada más cambia.
    const peticion = {
      text: prompt,
      files,
      model: state.model,
      system: baseSystem({
        site: state.site,
        contextMd: state.contextMd,
        memoryMd: state.settings.crossSessionMemory ? memory.memoryToPrompt(state.memory) : '',
        page: { url: state.tabUrl, title: state.tabTitle },
        skill,
        digest,
        // Desde Jira, el contexto del Confluence enlazado; null si no lo hay.
        linkedContext: state.linkedContext,
        // Y lo que la extensión contó del proyecto (H9): sólo lo usa Búsqueda
        // en Jira, y lo decide `baseSystem`, que es quien pone el bloque.
        profile: currentProfile(),
        // Y los resultados que el usuario pidió precargar con un clic (H12).
        preloaded: preloadDelTurno,
        sources,
      }),
    }

    // ¿Está el estado diciendo ahora mismo que el modelo lleva callado? Se
    // enciende con el aviso del vigilante y se apaga en cuanto vuelve a llegar
    // algo: dejarlo puesto sería decir «sin señales» mientras se escribe.
    let silencioso = false

    // Por runTurn y no a mano: trae el vigilante de turnos colgados y junta las
    // partes de TODOS los mensajes del turno, no solo del ultimo.
    medible = true
    const turn = await state.client.runTurn(state.sessionID, peticion, {
      signal: abort.signal,
      stallMs: 90000,
      // A mitad del plazo (45 s de los 90) sin una sola señal del modelo, el
      // estado lo dice donde ya dice «pensando…» (H6 P2): hasta ahora un turno
      // muerto y uno que está leyendo tres páginas con el MCP se veían igual, y
      // el usuario no sabía si esperar o parar. No se cancela nada, no se toca el
      // chat y no entra en el registro: lo que pasa a los 90 s ya se registra.
      onWarn: (ms) => {
        silencioso = true
        setStatus('busy', `pensando… ${Math.round(ms / 1000)} s sin señales del modelo`)
      },
      onUpdate: (t) => {
        if (silencioso) {
          silencioso = false
          setStatus('busy', 'pensando…')
        }
        // La primera palabra del modelo, una sola vez: hasta que llega, el
        // usuario sólo ve los tres puntos. Se mide al LLEGAR el texto, no al
        // pintarlo: lo que se cronometra es el modelo, no el navegador.
        if (!primerTexto && t.text) {
          primerTexto = true
          cron.mark('primer texto')
        }
        paintTurnSoon(t, toolsBox, body)
      },
    })
    cron.mark('fin')
    // El turno ha acabado: lo que quedara pedido para el frame siguiente pintaría
    // una respuesta a medias ENCIMA de lo definitivo —o encima de «Turno
    // cancelado», que es la salida que se toma justo aquí debajo—. Desde este
    // punto hasta el pintado final no hay ningún `await`, así que no vuelve a
    // pedirse ninguno.
    cancelPaintSoon()

    const tracker = { ...turn, rawError: turn.rawError, model: turn.model }

    // El chat ha podido repintarse entero a mitad de turno sin reconstruir el
    // cliente —reindexar, «Omitir», subir un contexto: `restoreConversation`
    // lo vacía—: entonces `body` está fuera del documento y el pintado final
    // iría al vacío (auditoría del 2026-09-13, docs/PLAN.md §2 C7). La burbuja
    // viva es la restaurada de este turno si es lo último del chat; si lo
    // último es la pregunta (aún sin respuesta parcial), una burbuja nueva.
    // Y si el panel ya está en OTRO sitio (o en otra sesión), nada de esto es
    // suyo: se pinta en la burbuja muerta (no se ve) y se sale antes de tocar
    // su chat.
    // Contra el sitio del PANEL, no contra la pestaña: mirar el correo
    // mientras se responde dejaba `state.site` en null y la respuesta se
    // pintaba en una burbuja muerta (revisión adversaria de H2, 2026-09-14).
    const mismoSitio = (state.site?.host ?? state.lastHost) === hostAlPedir && state.sessionID === sesionAlPedir
    const cuerpo = !mismoSitio ? body : body.isConnected ? body : liveBubble(null) || addAssistantMessage('')
    if (!bubble.isConnected) bubble = cuerpo

    if (turn.stalled) {
      log.error('Turno colgado', modelKey(state.model))
      keepToolsFolded(turn, toolsBox)
      cuerpo.textContent = ''
      const aviso = 'El modelo dejó de responder y no ha terminado nunca. No todos los de la lista son fiables.'
      cuerpo.appendChild(errorNode(
        aviso,
        { ...tracker, rawError: { name: 'APIError', data: { message: 'stalled' } } },
        text
      ))
      if (mismoSitio) announce(aviso)
      return
    }

    if (turn.aborted) {
      keepToolsFolded(turn, toolsBox)
      cuerpo.textContent = ''
      cuerpo.appendChild(noticeNode('Turno cancelado.'))
      if (mismoSitio) announce('Turno cancelado.')
      return
    }

    if (!turn.ok) {
      log.error('Turno fallido', turn.error)
      keepToolsFolded(turn, toolsBox)
      cuerpo.textContent = ''
      cuerpo.appendChild(errorNode(turn.error, tracker, text))
      if (mismoSitio) announce('La respuesta falló: ' + turn.error)
      return
    }

    // En el modo Análisis la respuesta cierra con un bloque JSON de anclas que
    // no es para el usuario: se separa de la prosa y va a marcar la página.
    const { prose, anchors } = splitAnchorsBlock(turn.text)
    const answer = prose.trim()
    if (!answer) {
      cuerpo.textContent = ''
      cuerpo.appendChild(noticeNode('El modelo no devolvió texto.', true))
      if (mismoSitio) announce('El modelo no devolvió texto.')
      return
    }

    if (!mismoSitio) {
      log.ok('Respuesta recibida', `${answer.length} caracteres · ${turn.tools.length} herramientas · el panel ya está en otro sitio: queda en la sesión de ${hostAlPedir}`)
      return
    }

    state.turns.push({ role: 'assistant', text: answer })
    paintTurn(turn, toolsBox, cuerpo, true)
    // Lo que costó este turno, en una línea comparable con la del siguiente: la
    // respuesta, cuántas herramientas y cuánto texto devolvieron —salidas de las
    // que salieron bien y trazas de las que fallaron: las dos se quedan en la
    // sesión y viajan al turno de después, y el recuento de herramientas de esta
    // misma línea también cuenta las fallidas—, el reloj por fases y lo que pesa
    // el sistema (en un Análisis de Jira, 23-27 000 caracteres). Los KB van
    // redondeados: aquí interesa el orden de magnitud, no el byte.
    const salidaTools = toolOutputSize(turn.parts)
    const kbTools = salidaTools ? Math.max(1, Math.round(salidaTools / 1024)) : 0
    log.ok(
      'Respuesta recibida',
      `${answer.length} caracteres · ${turn.tools.length} herramientas${kbTools ? ` (${kbTools} KB)` : ''} · ` +
        timingLine(cron.done(), {
          extra: [`sistema ${peticion.system.length} caracteres`, turnCostText(turn)],
        })
    )
    // Una vez, al final: mientras llegaba a trozos el chat estaba «ocupado».
    announce(answerAnnouncement(answer))

    // Con páginas base: si no había quien las leyera, o si en alcance
    // exclusivo el modelo consultó fuera de la lista, se dice bajo la
    // respuesta. Con lo capturado al mandar, no con el estado de ahora.
    warnAboutSources(turn.parts, bubble, {
      sources,
      pageId: pageIdAlPedir,
      issueKey: issueKeyAlPedir,
      product: productoAlPedir,
      title: tituloAlPedir,
      pageUrl: digest?.url || tabUrlAlPedir,
      mcpConnected: mcpAlPedir,
    })

    // Y lo que este turno ha añadido a lo que la sesión arrastra: pasado el
    // umbral se dice una vez, con la salida a mano.
    await trackSessionWeight(salidaTools, bubble)

    // El modelo que acaba de funcionar se recuerda para este sitio: si el
    // proveedor por defecto está caducado, no hay que volver a tropezar.
    if (state.site && state.model) await saveSite(state.site.host, { model: state.model })

    // Y qué páginas base sirvieron para analizar ESTO: es lo único que hace
    // falta para que la próxima incidencia parecida las traiga sugeridas sin
    // gastar un token (§8.20). Con lo capturado al mandar, igual que el aviso
    // de las páginas base de arriba.
    await recordAnalysisTurn({
      skill,
      sources,
      ok: !!turn.ok,
      host: hostAlPedir,
      sessionID: sesionAlPedir,
      issue: digest?.issue || null,
      pageUrl: digest?.url || tabUrlAlPedir,
      summary: tituloAlPedir,
      issueKey: issueKeyAlPedir,
      pageId: pageIdAlPedir,
      site: sitioAlPedir,
      product: productoAlPedir,
      // Para contar cuántas observaciones trajo la respuesta (H11): la prosa
      // ya separada del bloque de anclas y el bloque tal cual, que es lo que
      // `offerNotes` mira unas líneas más abajo.
      answer,
      anchors,
    })

    // Lo que cuesta ENSEÑAR la respuesta: el repintado final, el aviso de las
    // páginas base, apuntar lo que pesa la sesión, guardar el modelo y apuntar
    // el análisis en el historial. Iba dentro de «índice» y los dos números
    // salían sumados bajo una etiqueta que era de otra cosa.
    cron.mark('pintar')

    // En el modo Análisis, subrayar en la página de qué habla cada punto. Va
    // ANTES del índice (H6 P3): la tarjeta de observaciones es lo que el usuario
    // está esperando, y el índice —que nadie ve— puede esperar a que esté puesta.
    // En los demás modos esto no hace nada (`offerNotes` se sale a la primera si
    // la Skill no es Análisis), así que el orden de los demás no cambia: la
    // tarjeta de navegación sigue yendo detrás del índice, que es lo único que
    // necesita crecido (y en Análisis no hay tarjeta: `offersNavigation`).
    // La página de la que salió el texto, tal y como la vio la pestaña; no
    // vale `state.tabUrl`, que el panel refresca solo y cambia por su cuenta.
    await offerNotes(answer, bubble, {
      skill,
      anchors,
      digest,
      digestReason: lectura.reason,
      urlAlPedir: digest?.url || state.tabUrl,
      signal: abort.signal,
      conBase: (sources?.pages.length || 0) > 0,
      product: productoAlPedir,
      question: text,
      parts: turn.parts,
      // Si la numeración se adapta o se pone a posteriori, la burbuja se
      // repinta con la prosa nueva (y la memoria del turno la sigue).
      repaint: (prose) => {
        const ultimo = state.turns[state.turns.length - 1]
        if (ultimo?.role === 'assistant') ultimo.text = prose
        // El chat ha podido repintarse entero a mitad de turno (cerrar
        // Ajustes, reindexar): entonces `body` está fuera del documento y la
        // prosa va a la última burbuja viva, que es la restaurada de este turno.
        const destino = body.isConnected ? body : liveBubble(null)
        if (!destino) return
        destino.textContent = ''
        destino.appendChild(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, allowHref: linkAllowed }))
      },
    })
    // Sólo en Análisis: en los demás modos `offerNotes` no hace nada y la fase
    // sería un cero con etiqueta. Lo que tarda la tarjeta de navegación —con su
    // turno del planificador— se queda en el total y sin etiqueta, antes que
    // debajo de una etiqueta que no es la suya.
    if (skill === 'analisis') cron.mark('marcas')

    // ¿Sigue el panel donde pidió el turno? Entre la respuesta y aquí está
    // `offerNotes`, que puede durar un turno entero del modelo (la pasada que
    // trocea), y en ese hueco el usuario puede haberse ido a otro sitio: los
    // tres que cosechan leían el sitio VIVO, así que lo aprendido aquí se
    // habría cosechado con el sitio de allá y apuntado bajo su host (§8.22,
    // revisión adversaria de H6). La misma pregunta que `mismoSitio`.
    if ((state.site?.host ?? state.lastHost) === hostAlPedir && state.sessionID === sesionAlPedir) {
      // Enriquecer el índice con lo que las herramientas acaban de devolver,
      // con el sitio que preguntó.
      await growIndex(turn.parts, { site: sitioAlPedir })

      // Y con la estructura del árbol que se ve en la barra lateral: es exacta,
      // es gratis, y es justo por donde va a ir la navegación asistida.
      await growTreeFromPage()
    } else {
      log.info('Índice sin ampliar', `el panel ya no está en ${hostAlPedir}: lo que devolvieron las herramientas se queda sin cosechar`)
    }
    cron.mark('índice')

    // Y, si procede, ofrecer llevar al usuario allí (necesita el índice de
    // arriba: el destino sólo vale si está en él).
    await offerNavigation(answer, bubble, skill, turn.parts, { preloaded: !!preloadDelTurno })

    // Y una sola escritura del índice por turno, con todo lo que haya crecido
    // (las herramientas, el árbol, el camino que leyó el planificador). Si el
    // turno se va por el `catch` antes de llegar aquí, lo aprendido espera al
    // siguiente con SU host apuntado: nunca se guarda bajo otro.
    await persistIndex()
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showNotice(err instanceof OpencodeError ? err.message : 'Fallo enviando: ' + err.message, true)
    }
  } finally {
    if (state.turnToken === testigo) {
      state.turnToken = null
      setStreaming(false)
      // El reloj del turno entero, ya con las fases de después de la respuesta,
      // para la fila «tiempos (último turno)» del Registro. Sólo lo apunta el
      // turno que sigue siendo el del panel, que llegó a MANDARSE y que acabó en
      // el mismo sitio y en la misma sesión con la que se pidió: la misma
      // condición que `mismoSitio`. Sin ella, cancelar mientras se leía la página
      // dejaba una línea de fases vacías, y una respuesta que llegó con el panel
      // ya en otro host ponía sus tiempos en el Registro de un sitio ajeno.
      if (medible && (state.site?.host ?? state.lastHost) === hostAlPedir && state.sessionID === sesionAlPedir) {
        state.timing.turn = timingLine(cron.done())
      }
    }
    scrollChat()
  }
}

function paintTurn(tracker, toolsBox, body, final = false) {
  const tools = tracker.tools
  toolsBox.textContent = ''
  if (final && tools.length) {
    // Al terminar, la actividad de herramientas se pliega a una línea sobria.
    toolsBox.appendChild(toolsFold(tools))
  } else {
    for (const t of tools) toolsBox.appendChild(toolRow(t))
  }

  // El bloque JSON de anclas con el que cierra un análisis no se pinta: ni
  // entero al final, ni mientras se escribe a trozos.
  const { prose, pending } = splitAnchorsBlock(tracker.text, { final })
  if (pending) {
    const row = document.createElement('div')
    row.className = 'tool'
    const dot = document.createElement('span')
    dot.className = 'tdot'
    const label = document.createElement('span')
    label.textContent = 'Situando las observaciones en la página…'
    row.append(dot, label)
    toolsBox.appendChild(row)
  }
  if (prose) {
    body.textContent = ''
    body.appendChild(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, allowHref: linkAllowed }))
  }
  // Mientras se reconstruye a trozos, la burbuja está «ocupada» para el
  // lector de pantalla; lo que hay que decir se dice al final (A2).
  body.setAttribute('aria-busy', final ? 'false' : 'true')
  scrollChat()
}

/** Una consulta a Atlassian, como fila: el punto de estado y su título. */
function toolRow(t) {
  const row = document.createElement('div')
  row.className = 'tool' + (t.status === 'completed' ? ' done' : '')
  const dot = document.createElement('span')
  dot.className = 'tdot'
  const label = document.createElement('span')
  label.textContent = t.title || prettyTool(t.tool)
  row.append(dot, label)
  return row
}

/**
 * Las consultas de un turno terminado, plegadas en una línea sobria.
 *
 * Plegadas, no borradas: hasta H5 las filas se tiraban al acabar y con ellas la
 * única forma de saber QUÉ leyó el modelo —y de ver que una consulta falló—, que
 * es lo primero que se mira cuando la respuesta no cuadra (§8.14). Se crea
 * siempre cerrado, y `restoreConversation` no recrea filas de herramientas, así
 * que no hay ningún abierto que sobreviva a repintar el chat.
 *
 * Lo usan el pintado final y, desde H6, las tres salidas de un turno que acaba
 * mal (`keepToolsFolded`): un turno colgado, cancelado o fallido las tiraba, que
 * es justo cuando más falta hacen.
 */
function toolsFold(tools) {
  const filas = tools.map(toolRow)
  const fold = document.createElement('details')
  fold.className = 'tools-fold'
  const summary = document.createElement('summary')
  summary.className = 'tool done'
  const dot = document.createElement('span')
  dot.className = 'tdot'
  const label = document.createElement('span')
  label.textContent = `${tools.length} consulta${tools.length === 1 ? '' : 's'} a Atlassian`
  summary.append(dot, label)
  fold.appendChild(summary)
  for (const row of filas) fold.appendChild(row)
  return fold
}

/**
 * Las consultas de un turno que acaba mal: plegadas igual que las de uno que
 * acaba bien, en vez de tiradas con la caja.
 *
 * Un turno colgado, cancelado o fallido hacía `toolsBox.remove()`, así que el
 * aviso rojo no decía qué había leído el modelo hasta quedarse callado ni cuál de
 * las consultas había fallado: lo que el registro sí guarda y el chat perdía
 * (límite anotado en la revisión de H5, §8.14). Sin ninguna consulta, la caja se
 * va como antes: un hueco vacío no dice nada.
 */
function keepToolsFolded(turn, toolsBox) {
  if (!turn.tools?.length) return toolsBox.remove()
  toolsBox.textContent = ''
  toolsBox.appendChild(toolsFold(turn.tools))
}

/**
 * La página abierta, en bloques numerados, para el modo Análisis.
 *
 * Sin permiso sobre el dominio, o en el editor, no hay bloques: el análisis se
 * hace igual —el modelo lee la página con el MCP— y es `offerNotes` quien dice
 * después por qué no se marca nada. Nunca lanza.
 */
async function readPageDigest() {
  if (!state.site || state.tabId == null) return { digest: null, reason: 'sin pestaña' }
  if (!(await ensureContentAccess({ announce: false }))) return { digest: null, reason: 'permiso' }

  const r = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PAGE_DIGEST }).catch(() => null)
  if (!r?.ok || !r.text) {
    const reason = r?.reason || 'no se pudo leer'
    log.info('Página sin bloques', reason === 'editando' ? 'estás en el editor' : reason)
    return { digest: null, reason }
  }
  // En una incidencia de Jira vienen además sus campos: el tipo y el estado
  // deciden cómo se analiza. Llegan de la página y se reconstruyen aquí con
  // claves blancas y valores de una línea, como todo lo que viene de ella.
  const issue = normalizeIssueFields(r.issue)
  const digest = { ...r, issue }
  // De paso quedan apuntados para los chips de búsqueda: son los mismos campos
  // que `readIssueFieldsQuick` pediría aparte, y aquí ya han llegado.
  state.issueFields = { url: r.url || state.tabUrl, fields: issue }
  log.ok(
    'Página leída en bloques',
    `${r.count} bloques · ${r.chars} caracteres${r.truncated ? ' · recortada' : ''}` +
      (issue ? ` · tipo ${issue.type || '?'} · estado ${issue.status || '?'}` : '') +
      // Lo que costó leerla en la página, si el content script lo dice (desde
      // H3): sirve para comparar una página corta con una larga sin cronómetro.
      // Un content script viejo no lo manda y entonces no se imprime.
      (Number.isFinite(r.ms) ? ` · ${r.ms} ms` : '')
  )
  return { digest, reason: '' }
}

/**
 * Cuelga algo de la respuesta a la que pertenece.
 *
 * Con salvavidas: entre que se pide un turno y llega lo que se cuelga debajo
 * pueden pasar veinte segundos, y en ese rato el chat ha podido repintarse
 * entero —`restoreConversation()` lo vacía— dejando la burbuja fuera del
 * documento. Colgarle nada entonces es colgarlo en el vacío, que es justo el
 * fallo que hacía que un análisis marcara la página y no enseñara su lista.
 */
function attachToBubble(bubble, node) {
  const destino = bubble?.isConnected ? bubble : el.chat
  destino.appendChild(node)
  // Es lo nuevo que hay bajo la respuesta (una tarjeta, un aviso): se anuncia.
  announce(node.textContent)
  scrollChat()
  return node
}

/**
 * Tokens y coste de un turno, si el turno los trae.
 *
 * `TurnTracker` los suma por mensaje del asistente (`tokens` con la forma de
 * opencode —`{total, input, output, reasoning, cache:{read, write}}`— y `cost`
 * ya redondeado) y `runTurn` los saca en su resultado. Si opencode no informó de
 * ninguno vienen a `null` y esto devuelve '': la línea del registro se queda sin
 * ese trozo, antes que inventar un número.
 *
 * `total` se lee tal cual, NO se suma a mano: el total de opencode ya incluye la
 * caché, y sumar los campos lo contaría dos veces. La lectura de caché va aparte
 * cuando la hay porque en las sesiones reales es el grueso del turno, y es el
 * número que dice si merece la pena tocar el `system`.
 *
 * Un coste de 0 es un dato, no «sin dato» (los modelos de `github-copilot` y los
 * `-free` lo dan a cero): sólo se calla si no viene. Se imprime tal cual, con
 * coma decimal, sin redondear nada aquí: el número que se enseña es el que se
 * midió.
 */
function turnCostText(turn) {
  const tk = turn?.tokens || null
  const total = Number(tk?.total) || 0
  const salida = Number(tk?.output) || 0
  const cache = Number(tk?.cache?.read) || 0
  const coste = turn?.cost
  const detalle = [salida ? `salida ${salida}` : '', cache ? `caché ${cache}` : ''].filter(Boolean).join(', ')
  return [
    total ? `tokens ${total}${detalle ? ` (${detalle})` : ''}` : '',
    Number.isFinite(coste) ? `coste ${String(coste).replace('.', ',')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * La burbuja del asistente viva: la dada si sigue en el documento; si no, la
 * última del chat SI es lo último que hay (la respuesta parcial restaurada de
 * este turno). Si lo último es una pregunta, null: la última burbuja sería la
 * respuesta de OTRO turno, y pintar encima la borraría.
 */
function liveBubble(bubble) {
  if (bubble?.isConnected) return bubble
  const msgs = el.chat.querySelectorAll('.msg')
  const ultima = msgs[msgs.length - 1]
  return ultima?.classList.contains('assistant') ? ultima : null
}

/** Cuánto se espera para pintar cuando no hay frames: el panel está oculto. */
const PAINT_HIDDEN_MS = 250

/** El frame pedido y con qué pintarlo, o null si no hay ninguno en cola. */
let pintadoPendiente = null

/**
 * El pintado planificado de un turno: un repintado por frame, no uno por trozo.
 *
 * `paintTurn` reconstruye la burbuja entera —markdown incluido— y el modelo
 * manda deltas mucho más a menudo que la pantalla se refresca (docs/PLAN.md §2,
 * P2): el trabajo de más no se ve, se nota. Aquí se guarda el ÚLTIMO tracker y
 * se pinta una vez por frame; los trozos intermedios se tiran, que es
 * exactamente lo que hacía el navegador con ellos.
 *
 * Con el panel oculto (otra pestaña, panel cerrado) Chrome no reparte frames y
 * el rAF no llegaría nunca: ahí se pinta con un temporizador, para que al volver
 * a mirar la respuesta esté donde tiene que estar y no congelada en la mitad.
 *
 * El pintado DEFINITIVO sigue siendo síncrono, y quien termina el turno cancela
 * lo pendiente antes (`cancelPaintSoon` en `send()`, en cuanto `runTurn`
 * vuelve): un frame que llegara después pintaría una respuesta a medias encima
 * de la definitiva, o encima del aviso de «Turno cancelado».
 */
function paintTurnSoon(tracker, toolsBox, body) {
  // Ya hay un frame pedido: se queda con el tracker más nuevo y no pide otro.
  if (pintadoPendiente) {
    pintadoPendiente.args = [tracker, toolsBox, body]
    return
  }

  const pendiente = { args: [tracker, toolsBox, body], raf: 0, timer: 0 }
  const pintar = () => {
    pintadoPendiente = null
    const [t, caja, cuerpo] = pendiente.args
    // El chat ha podido repintarse entero entre el trozo y el frame
    // (`restoreConversation` lo vacía): entonces esta burbuja está fuera del
    // documento y pintarla no enseña nada. Lo definitivo va a la burbuja viva,
    // que es cosa de `send()` (C7 de H2).
    if (!cuerpo.isConnected) return
    paintTurn(t, caja, cuerpo)
  }

  if (document.hidden) pendiente.timer = setTimeout(pintar, PAINT_HIDDEN_MS)
  else pendiente.raf = requestAnimationFrame(pintar)
  pintadoPendiente = pendiente
}

/** Olvida el frame pedido, si quedaba alguno. Idempotente. */
function cancelPaintSoon() {
  if (!pintadoPendiente) return
  if (pintadoPendiente.raf) cancelAnimationFrame(pintadoPendiente.raf)
  if (pintadoPendiente.timer) clearTimeout(pintadoPendiente.timer)
  pintadoPendiente = null
}

function noticeNode(text, bad) {
  const d = document.createElement('div')
  d.className = 'notice' + (bad ? ' bad' : '')
  d.textContent = text
  return d
}

/**
 * Error de turno con salida.
 *
 * Un mensaje de error a secas deja al usuario atascado. Cuando el fallo es de
 * credenciales del proveedor —una sesión OAuth caducada, por ejemplo— hay una
 * acción concreta que lo desatasca: cambiar de proveedor y reintentar.
 */
function errorNode(message, tracker, question) {
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(message, true))

  if (!suggestsAnotherModel(tracker?.rawError)) return wrap

  const alt = pickAlternativeModel(state.models, state.defaults, tracker?.model?.providerID || state.model?.providerID)
  if (!alt) return wrap

  const row = document.createElement('div')
  row.className = 'nav-actions'
  row.style.marginTop = '8px'

  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.type = 'button'
  btn.textContent = `Reintentar con ${alt.name}`
  btn.addEventListener('click', async () => {
    btn.disabled = true
    state.model = { providerID: alt.providerID, modelID: alt.modelID }
    el.model.value = modelKey(state.model)
    if (state.site) await saveSite(state.site.host, { model: state.model })
    el.input.value = question || state.lastQuestion
    wrap.remove()
    send()
  })

  const hint = document.createElement('span')
  hint.className = 'fine'
  hint.style.alignSelf = 'center'
  hint.textContent = `proveedor ${alt.providerName}`

  row.append(btn, hint)
  wrap.appendChild(row)
  return wrap
}

/**
 * Lo que la conversación lleva arrastrado, turno a turno.
 *
 * El `system` se manda por turno y no se acumula, pero las salidas de las
 * herramientas se quedan en el historial de la sesión y viajan otra vez en cada
 * pregunta siguiente (§7). opencode poda las más antiguas y deja intactos los
 * últimos 40 000 tokens (`PRUNE_PROTECT`, leído del binario en la auditoría del
 * 2026-09-13), así que esto no es una fuga: es un techo. Pasado
 * `SESSION_LIMITS.heavyToolChars` lo barato deja de ser seguir aquí.
 *
 * Se guarda en storage.session para que el número sobreviva a cerrar y abrir el
 * panel sin volver a pedir los mensajes, y se escribe bajo el host con el que se
 * pidió el turno: aquí sólo se llega con la respuesta ya dada por buena para
 * este sitio (`mismoSitio`).
 *
 * Se cuentan CARACTERES y se enseñan como KB, igual que «Respuesta recibida»:
 * con lo que devuelve Atlassian los bytes de verdad son algunos más, y lo que
 * se decide con esto es el orden de magnitud, no el byte.
 */
async function trackSessionWeight(chars, bubble) {
  const host = state.site?.host ?? state.lastHost
  if (!host) return
  state.sessionToolChars += Math.max(0, Number(chars) || 0)
  await setSessionWeight(host, state.sessionToolChars).catch(() => {})
  if (state.heavyWarned || state.sessionToolChars < SESSION_LIMITS.heavyToolChars) return
  state.heavyWarned = true
  log.warn('Conversación pesada', `${formatBytes(state.sessionToolChars)} de consultas a Atlassian se reenvían en cada turno`)
  attachToBubble(bubble, heavySessionNotice())
}

/**
 * El aviso de conversación pesada, con la salida.
 *
 * Dice lo que pasa (el tamaño), que el servidor ya hace su parte —si no, suena a
 * avería— y qué gana empezando de nuevo. Sólo promete el resumen de la sesión si
 * la memoria entre sesiones está activa: prometerlo apagado sería mentir.
 */
function heavySessionNotice() {
  const wrap = document.createElement('div')
  wrap.appendChild(
    noticeNode(
      `Esta conversación arrastra ${formatBytes(state.sessionToolChars)} de consultas a Atlassian. ` +
        'opencode recorta las más antiguas, pero las últimas se reenvían en cada turno: una sesión nueva empieza limpia' +
        (state.settings.crossSessionMemory ? ' y la memoria guarda un resumen de ésta.' : '.')
    )
  )

  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'primary ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Sesión nueva'
  // Este aviso cuelga de la respuesta que destapó el peso, o sea que se pinta
  // con el turno todavía en vuelo: nace desactivado y `setStreaming(false)` lo
  // devuelve al acabar. La guarda de abajo se queda para el clic que llegue
  // justo en el cambio.
  btn.disabled = state.streaming
  btn.addEventListener('click', () => {
    if (state.streaming) return
    btn.disabled = true
    newSession().catch((err) => {
      // Si no se pudo cerrar la sesión, el botón vuelve: el aviso sigue ahí y
      // dejarlo apagado sería quitar la única salida que ofrece.
      btn.disabled = false
      showNotice('No he podido abrir una sesión nueva: ' + (err?.message || err), true)
    })
  })
  row.appendChild(btn)
  wrap.appendChild(row)
  return wrap
}

/**
 * Lo que las herramientas acaban de devolver, al índice.
 *
 * @param {Array} parts partes del turno
 * @param {{site?: object|null}} [opts] el sitio con el que se pidió el turno.
 *        Lo pasa `send()`: `state.site` es null con la pestaña fuera de
 *        Atlassian, y lo que se cosecha es de quien preguntó, no de la pestaña
 *        de ahora (§8.22). Quien no lo pase —una llamada suelta— sigue con el
 *        de ahora, como siempre.
 */
async function growIndex(parts, { site = state.site } = {}) {
  if (!site) return
  // harvestIndex blanquea toda URL absoluta de otro host antes de mirar nada
  // (S6, auditoría del 2026-09-13): el Confluence enlazado de un Jira DC es el
  // único host ajeno que cuenta como propio (sus páginas siguen fuera por
  // producto, pero una incidencia citada dentro de una URL suya sí entra).
  const { index, added } = harvestIndex(parts || [], {
    site,
    index: state.index,
    allowedHosts: linkedHost() ? [linkedHost()] : [],
  })
  if (added > 0) {
    state.index = index
    markIndexDirty(index, site.host)
    log.ok('Índice ampliado', `+${added} · total ${indexSize(index)}`)
  }
}

/**
 * Lee el árbol de la barra lateral y guarda las relaciones padre-hijo.
 *
 * Complementa al árbol del MCP: sólo ve lo desplegado, pero lo que ve es
 * exacto y no cuesta nada. Con el uso se va completando solo.
 */
async function growTreeFromPage() {
  if (!state.site || !state.tabId) return
  const snap = await chrome.tabs
    .sendMessage(state.tabId, { type: MSG.TREE_SNAPSHOT })
    .catch(() => null)
  if (!snap?.pages?.length) return

  const conPadre = snap.pages.filter((p) => p.parentId)
  if (!conPadre.length) return

  const arbol = normalizeIndex({ pages: snap.pages, updated: Date.now() }, state.site.host, state.index?.scope, {
    cloud: state.site.cloud,
    wikiPrefix: state.site.wikiPrefix,
  })
  const antes = countWithParent(state.index || { pages: {} })
  // La barra lateral no sabe el espacio de cada fila ni ve las ramas plegadas:
  // lo que ya se sabía de padres y espacios se conserva.
  const merged = mergeIndexKeepingTree(state.index, arbol)
  const ganados = countWithParent(merged) - antes
  if (ganados <= 0 && indexSize(merged) === indexSize(state.index)) return

  state.index = merged
  markIndexDirty(merged)
  if (ganados > 0) log.ok('Árbol leído de la página', `+${ganados} relaciones · ${snap.scanned} filas`)
}

/**
 * Apunta que el índice ha crecido, SIN escribirlo.
 *
 * Hasta H6 cada trozo que crecía escribía el índice entero en `chrome.storage`:
 * lo que devolvieron las herramientas, el árbol de la barra lateral y el camino
 * que leyó el planificador eran tres o cuatro serializaciones de hasta 43 KB por
 * turno para dejar lo mismo en disco (docs/PLAN.md §2.6, P3). Ahora se apunta y
 * `persistIndex()` escribe una vez al final del turno.
 *
 * Se guarda el HOST junto al índice porque entre aprender y guardar puede pasar
 * un turno del planificador o una segunda pasada de notas, y en ese hueco el
 * panel puede haberse ido a otro sitio (C2 de H2): lo aprendido se guarda bajo el
 * host que lo aprendió, nunca bajo el de ahora.
 *
 * @param {object} index el índice aprendido
 * @param {string} [host] quién lo aprendió, cuando quien llama lo sabe mejor
 *        que el estado de ahora (`growIndex` con el sitio capturado al mandar);
 *        si no, el del panel.
 */
function markIndexDirty(index, host = state.site?.host ?? state.lastHost) {
  if (!host || !index) return
  state.indexDirty = { host, index }
}

/**
 * La única escritura del índice de un turno: lo que se haya apuntado, bajo el
 * host que lo aprendió. Sin nada apuntado no toca el disco ni el registro.
 *
 * No lanza: se llama desde el camino de salida de un turno que ya ha respondido,
 * y quedarse sin cuota de almacenamiento no puede tapar la respuesta. Lo que no
 * se pudo guardar se dice en el registro y sigue en memoria, así que el turno
 * siguiente lo intenta otra vez.
 */
async function persistIndex() {
  const pendiente = state.indexDirty
  state.indexDirty = null
  if (!pendiente) return
  const { host, index } = pendiente
  // Qué objeto se escribe. El HOST no se discute: sale de lo apuntado, pase lo
  // que pase. El objeto sí: entre apuntar y guardar pasan minutos (P3), y si en
  // ese hueco termina un `generateContext` de ESTE mismo host, `state.index` es
  // ya el índice recién construido —que incluye lo apuntado, porque
  // `generateContext` lo funde— y escribir el viejo lo pisaría entero. Si el
  // panel sigue aquí, manda lo que el panel tiene ahora, que nunca es más viejo
  // que el apunte; si ya está en otro sitio, `state.index` es de aquél y lo
  // único que vale es lo apuntado (revisión adversaria de H6).
  const sigueAqui = (state.site?.host ?? state.lastHost) === host
  const aGuardar = sigueAqui && state.index ? state.index : index
  try {
    await saveIndex(host, aGuardar)
  } catch (err) {
    // Vuelve a quedar apuntado —salvo que algo más nuevo lo esté ya— para que el
    // turno siguiente lo intente otra vez.
    state.indexDirty = state.indexDirty || pendiente
    log.error('Índice sin guardar', `${host} · ${err?.message || err}`)
    return
  }
  log.ok(
    'Índice guardado',
    `${Object.keys(aGuardar.pages || {}).length} páginas · ${Object.keys(aGuardar.issues || {}).length} incidencias · ` +
      `total ${indexSize(aGuardar)} · ${host}`
  )
}

/**
 * La contraparte visible de las páginas base.
 *
 * Dos cosas que, si no se dicen, parecen que Faro se ha olvidado de ellas: que
 * sin el MCP conectado el modelo no ha podido leer las páginas base (el chip
 * prometía que iban), y que en alcance exclusivo —que sólo se pide por prompt,
 * porque los permisos de sesión de opencode son persistentes— el modelo se
 * salió de la lista. Todo con lo capturado al mandar el turno, no con el
 * estado de ahora: la pestaña ha podido cambiar mientras el modelo pensaba.
 *
 * @param {Array} parts partes del turno
 * @param {{sources: object|null, pageId?: string, issueKey?: string, product?: string, title?: string, pageUrl?: string, mcpConnected?: boolean}} extra
 *        las páginas base con las que se mandó; la página abierta entonces (id,
 *        o en Jira la clave de la incidencia, título de la pestaña y URL); el
 *        producto; y si había MCP entonces
 */
function warnAboutSources(parts, bubble, { sources, pageId = '', issueKey = '', product = '', title = '', pageUrl = '', mcpConnected = true } = {}) {
  if (!sources) return
  const abierta = product === 'jira' ? 'la incidencia abierta' : 'la página abierta'

  if (sources.pages.length && !mcpConnected) {
    log.warn('Páginas base sin leer', 'este sitio no tiene el MCP conectado')
    attachToBubble(
      bubble,
      noticeNode(
        `Las páginas base no se han podido leer: este sitio no tiene el MCP conectado, así que el análisis sale sólo de ${abierta}. Configúralo en Ajustes → Cambiar las claves.`,
        true
      )
    )
  }

  if (sources.mode !== 'exclusive') return
  // El título de la pestaña lleva el sufijo de Confluence («… - Espacio -
  // Confluence») y el modelo lee por título exacto: valen sus variantes. En
  // Jira, leer la incidencia abierta —sus comentarios, su historial— es leer
  // lo que el usuario tiene delante.
  const fuera = consultedOutside(parts, {
    allowed: [pageId, ...sources.pages.map((p) => p.id)],
    allowedTitles: [...titlesFromTab(title), ...sources.pages.map((p) => p.title)],
    allowedIssues: issueKey ? [issueKey] : [],
    pageUrl,
  })
  if (!fuera.length) return

  log.warn('Fuera del alcance', fuera.join(' · '))
  attachToBubble(
    bubble,
    noticeNode(
      `El alcance era sólo ${abierta}${sources.pages.length ? ' y las páginas base' : ''}, pero el modelo consultó además ${fuera.join(', ')}. ` +
        'Tenlo en cuenta al leer la respuesta: el alcance se le pide, no se le impone, y otro modelo suele respetarlo mejor.'
    )
  )
}

// ------------------------------------------------------------- navegación

/**
 * @param {Array} [parts] las partes del turno: en Jira, si el modelo buscó con
 *        `jira_search`, el destino es esa búsqueda (la lista de tickets vive
 *        en el buscador), y no hace falta índice.
 */
async function offerNavigation(answer, bubble, skillId = state.skill, parts = [], { preloaded = false } = {}) {
  const skill = skillById(skillId)

  // Resumir o analizar lo que ya tienes delante no es ir a ningún sitio, y una
  // tarjeta que ofrece un viaje ahí sólo estorba.
  if (!skill.offersNavigation) return

  // La búsqueda de Jira como destino no necesita mapa: la consulta viene de la
  // llamada real a la herramienta y la URL se construye contra este origen.
  if (state.site?.product === 'jira') {
    const busqueda = jqlDestination(parts, { origin: state.site.origin })
    if (busqueda) {
      log.ok('Búsqueda de Jira como destino', `${busqueda.count} resultado(s) · ${busqueda.jql}`)
      const card = navCard(jqlPlan(busqueda))
      attachToBubble(bubble, card)
      // Y la lista de verdad DENTRO de la tarjeta, leída de la API del propio
      // Jira con la sesión del navegador: la consulta es la MISMA que el modelo
      // acaba de ejecutar por el MCP, y leerla otra vez cuesta milisegundos y
      // cero tokens (§8.19). Se capturan el sitio y la sesión de AHORA porque
      // esa lectura tarda hasta seis segundos y al volver el panel puede estar
      // en otro sitio (§8.22). Se espera aquí a propósito: lo que la lista funde
      // en el índice tiene que estar apuntado antes de `persistIndex()`, que es
      // la única escritura del turno (P3 de H6).
      const sitio = state.site
      const lista = await attachJqlResults(card, busqueda, { site: sitio, sessionID: state.sessionID, tabId: state.tabId })
      // La consulta que el modelo ejecutó DE VERDAD por el MCP es la primera
      // procedencia admitida (§8.19), y la fuente más rica del chip «Última: …»:
      // se apunta igual que la de un chip, y sólo si devolvió una lista. Que
      // `attachJqlResults` devuelva `ok` ya dice que el panel seguía en ese sitio
      // y en esa sesión: su guarda es lo último que hace antes de pintar, sin
      // ningún await detrás (revisión adversaria de H8: sólo la recordaban los
      // chips, contra lo que decían el plan y el JSDoc de `rememberJql`).
      if (lista?.ok) {
        state.recentJql = rememberJql(state.recentJql, busqueda.jql, { count: lista.total })
        await saveSite(sitio.host, { recentJql: state.recentJql })
      }
      return
    }
    // La pregunta era sobre una lista que el usuario ya tenía delante y el
    // modelo —como se le pide— no ha vuelto a buscar: no hay búsqueda que abrir,
    // y tampoco destino que planificar. Sin esta salida, Búsqueda (que planifica
    // siempre) gastaba el turno del planificador para no llevar a ningún sitio
    // (revisión adversaria de H12).
    if (preloaded) {
      log.info('Sin navegación', 'la pregunta era sobre una lista ya leída')
      return
    }
  }

  if (!state.index || !indexSize(state.index)) {
    // Antes esto se salía en silencio: el modelo decía «usa la tarjeta de
    // abajo» y no había ninguna tarjeta. Sin mapa no hay navegación posible,
    // pero al menos ahora se dice y se ofrece arreglarlo.
    log.warn('Sin navegación', 'no hay índice de este sitio')
    if (shouldPlan(answer, { pages: { x: { title: 'x' } } })) attachToBubble(bubble, sinMapaCard())
    return
  }

  const { plan, reason, source } = await planNavigation(state.client, {
    model: state.model,
    plannerModel: pickPlannerModel(state.models, state.model),
    question: state.lastQuestion,
    answer,
    index: state.index,
    origin: state.site.origin,
    host: state.site.host,
    site: state.site,
    // Dónde está el usuario ahora mismo: sirve para no meter en el recorrido
    // un salto al espacio en el que ya estamos.
    here: state.tabUrl,
    force: skill.alwaysPlan,
    // En modo rápido no se lee el árbol: no se va a ofrecer «Paso a paso».
    navMode: state.settings.navMode,
    learnAncestry,
    // El camino que el planificador lee de la API entra en el índice de
    // memoria y se guarda con el resto al final del turno (P3).
    onIndex: (enriquecido) => {
      state.index = enriquecido
      markIndexDirty(enriquecido)
    },
  })

  if (!plan) {
    if (reason) log.info('Sin navegación', reason)
    return
  }

  if (source === 'respuesta') {
    log.ok('Destino leído de la respuesta', `${plan.destination.title} · sin preguntar al modelo`)
  }
  attachToBubble(bubble, navCard(plan))
}

/**
 * Los antepasados de una página, leídos de la API REST del propio Confluence.
 *
 * Es lo que permite ofrecer «Paso a paso» sin esperar: una petición GET al
 * mismo origen en el que está el usuario, con su sesión, que devuelve la cadena
 * entera en milisegundos. La hace el content script, porque vive en ese origen;
 * el panel sólo pide y funde. Antes esto era un turno de modelo con llamadas al
 * MCP: entre treinta segundos y varios minutos, y con los modelos pequeños ni
 * eso.
 *
 * Se lee una vez por página y sesión del panel, y el resultado se queda en el
 * índice. Si el índice deja de conocer el camino entero —lo que descubre una
 * consulta se funde encima—, se vuelve a leer: la caché no manda sobre el
 * índice. Si no se puede —sin content script, sin sesión, API caída— se
 * devuelve null y el planificador lleva de golpe, sin inventar nada.
 */
async function learnAncestry(destination) {
  if (!state.site || !state.tabId) return null
  const id = String(destination?.id || '')
  if (!/^\d+$/.test(id)) return null

  const clave = `${state.site.host}:${id}`
  const conocido = ancestryOf(state.index, id, 50).length
  const previo = state.ancestryFetched.get(clave)
  if (previo?.largo === conocido) return null
  // Una API que no contesta no se vuelve a esperar en cada respuesta: un
  // minuto de tregua, y luego se reintenta.
  if (previo?.fallo && Date.now() - previo.fallo < 60000) return null

  // Sin content script no hay quien lea el árbol, y tampoco quien lo recorra:
  // el camino no hace falta, porque no se va a poder ofrecer.
  if (!(await ensureContentAccess({ announce: false }))) {
    log.warn('Sin camino', 'no puedo leer el árbol sin acceso a la pestaña; te llevaré de golpe')
    return null
  }

  const t0 = Date.now()
  const r = await chrome.tabs
    .sendMessage(state.tabId, {
      type: MSG.PAGE_ANCESTORS,
      pageId: id,
      // El prefijo que toca, no el observado a secas: en Cloud es /wiki
      // aunque la pestaña esté en Jira y su ruta no lo diga.
      wikiPrefix: wikiPrefixOf(state.site),
      cloud: state.site.cloud,
    })
    .catch(() => null)

  if (!r?.ok || !Array.isArray(r.pages) || !r.pages.length) {
    state.ancestryFetched.set(clave, { fallo: Date.now() })
    log.warn('Sin camino', `${r?.reason || 'la pestaña no contestó'} · te llevaré de golpe`)
    return null
  }

  state.ancestryFetched.set(clave, { largo: r.pages.length })
  log.ok('Camino leído de Confluence', `${r.pages.length - 1} rama(s) · API ${r.via} · ${r.ms ?? Date.now() - t0} ms`)
  return r.pages
}

/**
 * La lista de una búsqueda de Jira, dentro de la tarjeta que lleva a ella.
 *
 * POR QUÉ EXISTE: la tarjeta decía «Los 37 resultados de la búsqueda en Jira» y
 * para ver cuáles había que irse a Jira. La misma consulta que el modelo acaba de
 * ejecutar por el MCP se puede ejecutar aquí contra la API del propio sitio, con
 * la sesión del navegador: 100-400 ms, cero tokens, y lo que se lee es de AHORA
 * (docs/PLAN.md §3.3, decisión §8.19).
 *
 * La consulta NO se inventa ni se deduce: es la del `input` de la llamada real a
 * `jira_search` que `jqlDestination` ya lee (§8.12), y el content script es quien
 * monta la ruta contra el origen de SU pestaña. Aquí no hay ninguna URL.
 *
 * La tarjeta de siempre NUNCA desaparece: la lista es un añadido, y si la API no
 * contesta se queda la tarjeta con un aviso debajo diciendo por qué (§8.14). El
 * aviso va DENTRO de la tarjeta y no colgado de la burbuja porque es de ella: si
 * el chat se repinta, se van juntos, y así una búsqueda directa —que no tiene
 * burbuja propia todavía— usa el mismo camino.
 *
 * @param {HTMLElement} card la tarjeta de `navCard(jqlPlan(busqueda))`
 * @param {{jql:string}} busqueda lo que devolvió `jqlDestination`
 * @param {{site?:object|null, sessionID?:string|null, tabId?:number|null}} capturado
 *        el sitio, la sesión y la pestaña con los que se PIDE: es lo que manda al
 *        pintar, porque entre una cosa y otra el panel puede haberse ido (§8.22)
 * @returns {Promise<object|null>} lo que contestó la API, o null si no se pudo
 *        leer (o si no se pintó nada porque el panel ya estaba en otro sitio).
 *        Lo mira una búsqueda directa, que sólo apunta como «última» la consulta
 *        que de verdad devolvió una lista.
 */
async function attachJqlResults(card, busqueda, { site = state.site, sessionID = state.sessionID, tabId = state.tabId } = {}) {
  if (!card || !site || site.product !== 'jira') return null
  // El interruptor maestro de las lecturas REST. Apagado no es un fallo —lo
  // eligió el usuario en Ajustes—, así que no hay nada que avisar.
  if (!state.settings.restTools) return null
  const jql = String(busqueda?.jql || '')
  if (!jql) return null

  const estado = document.createElement('div')
  estado.className = 'nav-text result-status'
  estado.textContent = 'Comprobando la lista en Jira…'
  card.insertBefore(estado, card.querySelector('.nav-actions'))

  const fallo = (reason, texto) => {
    estado.remove()
    log.warn('Lista de Jira no disponible', `${reason} · ${texto}`)
    if (restFailureDue(state.restWarned, reason, site.host, sessionID)) {
      const aviso = texto + ' La tarjeta te lleva igual.'
      card.appendChild(noticeNode(aviso))
      // Cuelga de la tarjeta y no pasa por `attachToBubble`, así que se anuncia
      // aquí: sin esto un lector de pantalla no se enteraba de que no hay lista
      // (A2; `runPlan` anuncia el suyo justo al lado).
      announce(aviso)
    }
  }

  // En Jira Cloud `GET /rest/api/2/search` está retirado (410 desde octubre de
  // 2025) y allí todo va por el MCP: se dice una vez y no se pide nada.
  if (site.cloud) {
    fallo('cloud', 'En Jira Cloud no puedo consultar la API con tu sesión: la lista la tiene el buscador de Jira.')
    return null
  }
  // Quien hace la petición es el content script, porque vive en el origen del
  // sitio; sin él no hay lista, igual que no hay camino ni marcas.
  if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
    fallo('permiso', `No puedo leer la lista sin permiso sobre ${site.host}.`)
    return null
  }

  const r = await chrome.tabs
    .sendMessage(tabId, { type: MSG.JQL_SEARCH, jql, limit: JIRA_REST_LIMITS.defaultResults, cloud: site.cloud })
    .catch(() => null)

  // Si el chat se repintó entero mientras llegaba la lista, la tarjeta ya no
  // está en el documento y no hay dónde pintar (C7); y si el panel se fue a otro
  // sitio o abrió otra sesión, esto no se pinta NI se cosecha (§8.22).
  if (!card.isConnected) return null
  // «Otra sesión» es que la que había ya no sea la de ahora. Si al pedir no había
  // ninguna —un chip pulsado en el chat vacío— y mientras tanto el usuario
  // escribe, `send()` CREA la sesión sin vaciar el chat: la tarjeta sigue a la
  // vista y en el mismo sitio, y tirar la lista ahí era un fallo silencioso con
  // un registro que decía algo falso (revisión adversaria de H8). «Sesión
  // nueva» sí vacía el chat, y eso lo cubre `card.isConnected`.
  if ((state.site?.host ?? state.lastHost) !== site.host || (sessionID && state.sessionID !== sessionID)) {
    estado.remove()
    log.info('Lista de Jira no disponible', `el panel ya no está en ${site.host} con esa sesión`)
    return null
  }

  if (!r?.ok) {
    fallo(r?.reason || 'sin respuesta', jqlFailText(r, site.host))
    return null
  }

  const issues = Array.isArray(r.issues) ? r.issues : []
  // Al índice ANTES de pintar las filas: una fila no navega por su cuenta, su
  // clave pasa por `validatePlan` como cualquier destino (§8.3) y para eso tiene
  // que estar en el índice. Se APUNTA y `persistIndex()` lo escribe con el resto
  // al final del turno, bajo el host que lo aprendió (P3 de H6).
  const { index, added } = harvestFromSearch(issues, { site, index: state.index })
  if (added > 0) {
    state.index = index
    markIndexDirty(index, site.host)
    log.ok('Índice ampliado', `+${added} · total ${indexSize(index)}`)
  }

  const total = Number.isInteger(r.total) ? r.total : issues.length
  estado.textContent = issues.length
    ? `${issues.length} de ${total}, leídos ahora mismo de Jira`
    : 'Jira no devuelve ningún resultado para esta consulta ahora mismo.'
  log.ok(
    'Lista de Jira leída',
    `${issues.length} de ${total}${r.via === 'updated' ? ' · sin ordenar por lo último visto' : ''}` +
      `${r.prefix ? ' · vía ' + r.prefix : ''}${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ''} · ${jql}`
  )
  if (issues.length) {
    card.insertBefore(jqlResultsList(issues, { site, card }), card.querySelector('.nav-actions'))
    // Y el botón que deja preguntar SOBRE esta lista sin que el modelo vuelva a
    // buscarla (H12): sólo con filas, porque sin ellas no habría nada que
    // precargar, y dentro de las acciones de la tarjeta, al lado de «Abrir la
    // búsqueda en Jira», que es la otra cosa que se puede hacer con ella.
    card.querySelector('.nav-actions')?.appendChild(preloadButton(issues, { site, jql, total }))
  }
  // Con el total ya comprobado: quien lo apunte como «última búsqueda» no tiene
  // que volver a preguntarse si el servidor mandó un número.
  return { ...r, total }
}

/**
 * La pregunta que se deja ESCRITA en el cuadro al precargar una lista.
 *
 * Sin claves, sin la consulta y sin el host: la escribe el usuario al pulsar
 * enviar, y lo que se le ofrezca escrito acaba en un prompt (es la misma regla
 * que `analyzeQuestion` de «qué mirar hoy», §8.20).
 */
const PRELOAD_QUESTION = '¿Qué tienen en común estas incidencias?'

/**
 * «Preguntar sobre estos»: el botón que precarga la lista en el turno siguiente.
 *
 * NO manda nada (§8.20): apunta los resultados, escribe la pregunta en el cuadro
 * y deja el foco ahí. Quien pregunta es el usuario, y puede reescribirla o
 * borrarla; lo único que ha cambiado es que el turno siguiente llevará la lista
 * en su `system` y el modelo no tendrá que volver a pedírsela a Jira.
 *
 * El host viaja con lo apuntado: si el panel se va a otro sitio entre el clic y
 * el envío, `send()` lo descarta (§8.22). Y lleva `NEEDS_IDLE` como los demás
 * botones que cuelgan del chat: la tarjeta se pinta con `state.streaming`
 * todavía en true, y un botón que parece vivo y no hace nada es peor que uno
 * desactivado (revisión adversaria de H6).
 */
function preloadButton(issues, { site, jql, total }) {
  const b = document.createElement('button')
  b.className = 'ghost small ' + NEEDS_IDLE
  b.type = 'button'
  b.textContent = 'Preguntar sobre estos'
  b.title = 'Mete estos resultados en la siguiente pregunta, para no volver a buscarlos'
  b.disabled = state.streaming
  b.addEventListener('click', () => {
    if (state.streaming) {
      showNotice('Espera a que termine la respuesta.', false, { force: true })
      return
    }
    state.pendingPreload = { jql, total, issues, host: site.host }
    const nota = preloadNote(state.pendingPreload)
    log.ok('Búsqueda precargada', `${nota} · ${jql}`)
    el.input.value = PRELOAD_QUESTION
    autoGrow()
    el.input.focus()
    // Lo que va a viajar con la pregunta se dice en voz alta: es la misma
    // promesa que la nota de debajo, que todavía no existe porque nadie ha
    // mandado nada (A2).
    announce(`${PRELOAD_QUESTION} — ${nota}. Puedes cambiarla antes de enviar.`)
  })
  return b
}

/**
 * Las filas de la lista: clave, de qué va, y en qué estado y de quién es.
 *
 * Todo con `textContent`: el resumen y el estado son texto de Jira, escrito por
 * quien creó el ticket (§8.12). Cada fila es un `<button>`, no un enlace: no hay
 * URL hasta que `validatePlan` la reconstruye contra el origen del sitio.
 */
function jqlResultsList(issues, { site, card }) {
  const list = document.createElement('div')
  list.className = 'result-list'
  for (const issue of issues) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'result-row'

    const clave = document.createElement('span')
    clave.className = 'result-key'
    clave.textContent = issue.key

    const body = document.createElement('span')
    body.className = 'result-body'
    const title = document.createElement('span')
    title.className = 'result-title'
    title.textContent = issue.summary || issue.key
    body.appendChild(title)
    // Del asignado sólo el nombre visible: es lo único que hace falta para
    // reconocer de quién es, y es lo único que `parseSearchIssues` deja pasar.
    const detalle = [issue.status, issue.assignee?.displayName || issue.assignee?.name].filter(Boolean).join(' · ')
    if (detalle) {
      const meta = document.createElement('span')
      meta.className = 'result-meta'
      meta.textContent = detalle
      body.appendChild(meta)
    }

    row.append(clave, body)
    row.addEventListener('click', () => openIssueFromResults(issue.key, { site, card }))
    list.appendChild(row)
  }
  return list
}

/**
 * Abrir la incidencia de una fila.
 *
 * Una fila NO navega por su cuenta y la URL no se concatena aquí: la clave ya
 * está en el índice (la fundió `harvestFromSearch`) y el destino pasa por
 * `validatePlan`, que es quien comprueba que está en el índice, que su URL es de
 * este origen y que el producto casa con el sitio (§8.3). De ahí sale el mismo
 * plan `jira-issue` de un salto que produce el planificador, y lo lanza el mismo
 * `runPlan` con `NAVIGATE_DIRECT`.
 */
async function openIssueFromResults(key, { site, card }) {
  const r = validatePlan(
    { navigate: true, mode: 'direct', destination: { kind: 'jira-issue', id: key } },
    { index: state.index, origin: site.origin, host: site.host, here: state.tabUrl, site }
  )
  if (!r.ok || !r.plan?.navigate) {
    const motivo = r.reason || 'el plan no vale'
    log.warn('Navegación fallida', `${key} · ${motivo}`)
    const aviso = `No puedo abrir ${key}: ${motivo}`
    card.appendChild(noticeNode(aviso, true))
    announce(aviso)
    return
  }
  await runPlan(r.plan, 'direct', card)
  // `runPlan` apaga los botones de la tarjeta mientras lanza el viaje, y un
  // salto directo no tiene «Parar» ni `PLAN_FINISHED` que los vuelva a encender:
  // la lista se quedaba muerta después de abrir UNA incidencia, y mirar la
  // siguiente de la lista es justo lo que se hace después. Desde H12 vuelve
  // también «Preguntar sobre estos», que cuelga de esta misma tarjeta y no es un
  // viaje: abrir una fila y luego querer preguntar por la lista es la secuencia
  // normal, y el clic de la fila la había dejado muerta. Lo que lleva
  // `NEEDS_IDLE` sólo vuelve si no se está respondiendo (H6). Las acciones de
  // viaje de la tarjeta («Abrir la búsqueda en Jira») siguen la regla de siempre.
  for (const b of card.querySelectorAll('.result-row, .' + NEEDS_IDLE)) {
    b.disabled = b.classList.contains(NEEDS_IDLE) ? state.streaming : false
  }
}

/**
 * Subraya en la página los puntos del análisis y los numera.
 *
 * El modelo ya ha numerado sus observaciones en la respuesta y la ha cerrado
 * con un bloque JSON que dice, de cada número, en qué bloque ¶ de la página
 * cae y qué trozo literal. Aquí ese JSON se valida contra los bloques que se le
 * enseñaron y se manda a la página, donde un script —no el modelo— decide qué
 * subrayar. Es lo que hace que «el punto 3» del chat signifique algo.
 *
 * Si la respuesta numera pero no trae el bloque —un modelo que se salta esa
 * parte del formato—, una segunda pasada lo pide aparte. Cuesta un turno, así
 * que es la excepción, no la regla.
 *
 * @param {string} answer la prosa, ya sin el bloque de anclas
 * @param {{skill?:string, anchors?:object|null, digest?:object|null, urlAlPedir?:string, signal?:AbortSignal}} extra
 *        `skill` es el modo con el que se mandó el turno; `anchors` el bloque
 *        JSON tal cual vino; `digest` la página en bloques que se le enseñó al
 *        modelo; `urlAlPedir` la página de la que salió ese texto, tal y como
 *        la vio la pestaña; `signal` lo que para la segunda pasada si el
 *        usuario pulsa parar.
 */
async function offerNotes(
  answer,
  bubble,
  {
    skill = state.skill,
    anchors = null,
    digest = null,
    digestReason = '',
    urlAlPedir = '',
    signal = null,
    conBase = false,
    product = '',
    question = '',
    parts = [],
    repaint = null,
  } = {}
) {
  // De qué se habla en los avisos y en la tarjeta: en Jira lo abierto es una
  // incidencia, y «esta página» ahí significa una página de Confluence.
  const abierta = product === 'jira' ? 'esta incidencia' : 'esta página'
  if (skill !== 'analisis') return
  if (!state.site || !state.tabId || !state.client) return
  if (signal?.aborted) return

  // Peldaño 1, gratis: el modelo numeró «a su manera» —una lista «1.»,
  // «**1.**», «Observación 1:», encabezados «### 1.», o la respuesta entera
  // dentro de una valla— y se reescribe como «[n]» para que las pastillas, la
  // tarjeta y las anclas funcionen igual que si hubiera obedecido. Pasó de
  // verdad (gpt-5.6-luna, 2026-09-09): ocho observaciones como lista «1.»
  // bajo un apartado «Observaciones», con el bloque JSON perfecto, y la
  // extensión lo tiraba todo por no ver «[1]».
  // Con dos frenos: la frase «Sin observaciones.» se mira en la respuesta
  // ORIGINAL (una viñeta «- Sin observaciones.» no es una observación), y un
  // seguimiento que cita un punto («amplía el punto 3») con marcas previas no
  // se adapta: su lista «1. 2. 3.» son pasos, no un análisis nuevo. Y el
  // bloque JSON, si numera desde 1, dice cuántas observaciones hay: una lista
  // que cuente menos no es la de las observaciones.
  const original = answer
  const sinNada = saysNothingToSay(original)
  const seguimientoCitado = state.notes.length > 0 && questionCitesPoint(question || state.lastQuestion)
  // El freno de «respuesta corta» se mide sobre lo que LLEGÓ, antes de
  // adaptar nada, y `normalizeNumbering` recibe el mismo tope para no
  // convertir una viñeta suelta de una respuesta corta en «[1]» (docs/PLAN.md
  // §2.3 M5: «No he podido leer la incidencia: - El MCP devolvió 401» se
  // tomaba por un análisis nuevo y gastaba una pasada más contra el modelo).
  const respuestaCorta = original.length < NOTE_LIMITS.shortAnswer
  const adaptada = normalizeNumbering(answer, { expected: expectedCount(anchors), shortAnswer: NOTE_LIMITS.shortAnswer })
  if (!sinNada && !seguimientoCitado && adaptada.prose !== answer) {
    answer = adaptada.prose
    repaint?.(answer)
    if (adaptada.style !== 'brackets') log.info('Numeración adaptada', `${adaptada.numbers.length} observaciones venían como «${adaptada.style}»`)
  } else if (seguimientoCitado && adaptada.style && adaptada.style !== 'brackets') {
    log.info('Marcas conservadas', `la pregunta cita un punto y la lista «${adaptada.style}» de la respuesta son pasos, no observaciones`)
  }

  // Peldaño 2: los números del análisis son los de la prosa y, si no los
  // hay, los del bloque JSON (desde 1): el modelo escribió y situó las
  // observaciones, y sólo se saltó los corchetes.
  const { numeros, origen } = observationNumbers(answer, anchors)
  if (origen === 'json') log.info('Numeración del JSON', `la prosa no lleva [n]; valen los ${numeros.length} números del bloque de anclas, si sus bloques sirven`)

  // «No hay nada que decir» es un resultado, no un fallo: la frase fija que
  // pide el prompt. Se dice en neutro y no se ofrece repetir nada; con marcas
  // previas, se dice que se quedan.
  const cierraSinNada = !numeros.length && sinNada
  if (cierraSinNada) {
    log.info('Sin observaciones', state.notes.length ? 'nada nuevo que observar; las marcas que hay se quedan' : 'el modelo no ha encontrado nada que observar')
    attachToBubble(
      bubble,
      noticeNode(
        state.notes.length
          ? `El análisis no ha encontrado nada nuevo que observar en ${abierta}; las marcas de antes se quedan.`
          : `El análisis no ha encontrado nada que observar en ${abierta}, así que no hay nada que subrayar.`
      )
    )
    return
  }

  // Un análisis nuevo numera desde el 1. Lo demás es una respuesta de
  // seguimiento —«amplía el punto 3»—, traiga o no anclas: las marcas que hay
  // se conservan, sus pastillas siguen llevando a ellas, y no se gasta una
  // segunda pasada en buscarle sitio a un punto que ya lo tiene. Pero una
  // respuesta larga sin ningún número, que no cite ningún punto, es un
  // análisis nuevo sin numerar, no un seguimiento (también cuando viene de
  // «Pedirlo numerado»: el recordatorio no cuenta como pregunta).
  const analisisNuevo = numeros[0] === 1
  if (!analisisNuevo && state.notes.length) {
    if (numeros.length || looksLikeFollowUp(question || state.lastQuestion, answer)) {
      log.info(
        'Marcas conservadas',
        numeros.length ? 'la respuesta cita observaciones sueltas; las marcas que hay se quedan' : 'la respuesta no numera nada; las marcas que hay se quedan'
      )
      return
    }
  }

  // Sin números en ningún sitio: o no es un análisis (una consulta falló, o
  // la respuesta es corta: «no he podido leer la incidencia»), y se ofrece
  // pedirlo de nuevo; o es un análisis en prosa corrida, que se trocea más
  // abajo, cuando ya se sabe que se puede marcar.
  if (!numeros.length) {
    const herramientaRota = (parts || []).some((p) => p?.type === 'tool' && p.state?.status === 'error')
    if (herramientaRota || respuestaCorta) {
      log.info('Sin marcas', herramientaRota ? 'una consulta falló y la respuesta no numera nada' : 'la respuesta es corta y no numera nada')
      attachToBubble(
        bubble,
        withRetryNumbered(
          noticeNode(
            `La respuesta no parece un análisis${herramientaRota ? ' (una consulta falló)' : ''}: no hay observaciones que subrayar en ${abierta}.`
          ),
          question
        )
      )
      return
    }
    log.info('Sin bloque de anclas', 'la respuesta no numera nada; se troceará aparte')
  }

  // Números sueltos sin un análisis del que vengan: no hay nada que marcar, y
  // se dice, porque desde fuera parecería que Faro se ha olvidado.
  if (numeros.length && !analisisNuevo) {
    log.info('Sin marcas', 'la respuesta cita observaciones sueltas y no hay un análisis del que vengan')
    attachToBubble(
      bubble,
      noticeNode('La respuesta cita observaciones sueltas, sin un análisis numerado desde el 1 del que vengan: no hay nada que subrayar.')
    )
    return
  }

  // Marcar la página necesita el content script; consultar, no. Y si falta el
  // permiso hay que PEDIRLO, no apuntarlo en el registro y callarse: un análisis
  // que promete ocho observaciones y no subraya ninguna, sin decir por qué, es
  // el peor de los resultados.
  if (!(await ensureContentAccess({ announce: false }))) {
    log.warn('Sin marcas', 'falta permiso en ' + state.site.host)
    showPermissionNotice()
    return
  }

  // Sin la página en bloques, el modelo no tenía a qué apuntar: se leyó la
  // página con el MCP y no hay contra qué resolver sus anclas. En el editor
  // es a propósito, y se dice tal cual.
  if (!digest?.blocks?.length) {
    const editando = digestReason === 'editando'
    log.warn('Sin marcas', editando ? 'estás en el editor' : 'no he podido leer la página en bloques')
    attachToBubble(
      bubble,
      noticeNode(
        editando
          ? 'Estás en el editor: no marco nada para no interferir.'
          : `No he podido leer el texto de ${abierta}, así que el análisis se queda sin marcar. Recarga la pestaña y vuelve a pedirlo.`,
        !editando
      )
    )
    return
  }

  // Lo normal: las anclas venían en la respuesta. Sólo pasan los números que
  // de verdad aparecen en ella, y cada bloque se comprueba contra la lista que
  // se le enseñó al modelo.
  let filasNumeros = numeros
  let notes = anchors ? validateNotes(anchors, { allowed: numeros, blocks: digest.blocks }) : []
  if (anchors) {
    const sobran = surplusNumbers(anchors, numeros)
    if (sobran.length) log.warn('Marcas sobrantes', `el bloque JSON trae ${sobran.join(', ')} y la respuesta no`)
  }
  if (notes.some((x) => x.anchor)) {
    log.ok('Anclas en la respuesta', `${notes.filter((x) => x.anchor).length} de ${numeros.length} observaciones`)
  } else if (!numeros.length || origen === 'json') {
    // Peldaño 3: sin números en la prosa —ni en el JSON, o con un JSON cuyos
    // bloques no sirven—, una pasada que trocea la respuesta en
    // observaciones —con las primeras palabras de cada una, para poner el
    // «[n]» delante— y las sitúa. La prosa se renumera por posición y se
    // repinta. Si tampoco así, queda pedirlo numerado.
    const seg = await segmentedPassNotes(answer, digest, signal)
    if (signal?.aborted) return
    if (!seg.inserted.length || !seg.notes.some((x) => x.anchor)) {
      log.info('Sin marcas', seg.inserted.length ? 'ninguna observación apunta a un bloque del texto' : 'la respuesta no numera nada y no he sabido trocearla')
      attachToBubble(
        bubble,
        withRetryNumbered(
          noticeNode(`No he sabido separar la respuesta en observaciones que apunten a un pasaje de ${abierta}.`),
          question
        )
      )
      return
    }
    answer = seg.prose
    repaint?.(answer)
    filasNumeros = [...seg.inserted, ...seg.missing]
    notes = seg.notes
  } else {
    log.info('Sin bloque de anclas', anchors ? 'venía, pero sin ningún bloque utilizable' : 'la respuesta no lo traía; se pide aparte')
    notes = await secondPassNotes(answer, digest, signal)
    if (signal?.aborted) return
    if (!notes.some((x) => x.anchor)) {
      log.info('Sin marcas', 'ninguna observación apunta a un bloque del texto')
      attachToBubble(
        bubble,
        withRetryNumbered(
          noticeNode(
            `No he sabido situar en ${abierta} ninguna de las observaciones: se marcan sólo las que apuntan a un bloque del texto.`
          ),
          question
        )
      )
      return
    }
  }

  // Mientras se preparaban, el usuario ha podido irse a otra página: marcarla
  // sería marcar cualquier cosa. Se compara por IDENTIDAD de página y no por
  // cadena, porque Confluence reescribe su propia URL sin que nadie se mueva.
  const ahora = await chrome.tabs.get(state.tabId).catch(() => null)
  if (ahora?.url && !samePage(ahora.url, urlAlPedir)) {
    log.warn('Sin marcas', 'la pestaña cambió de página mientras se preparaban')
    attachToBubble(bubble, noticeNode(`Has cambiado de ${product === 'jira' ? 'incidencia' : 'página'}, así que no he marcado nada.`))
    return
  }

  // A la página sólo van las que tienen ancla. La tarjeta, en cambio, lista
  // TODOS los números de la respuesta: las que el JSON no trajo, en gris y con
  // la frase que las abre, para que la lista sea la del chat y no la del JSON.
  const anclables = notes.filter((x) => x.anchor)
  const filas = filasNumeros.map(
    (n) => notes.find((x) => x.n === n) || { n, title: titleFromProse(answer, n), kind: '', anchor: null }
  )

  const res = await chrome.tabs
    .sendMessage(state.tabId, { type: MSG.ANNOTATE, notes: anclables })
    .catch(() => null)

  if (res?.reason === 'editando') {
    log.warn('Sin marcas', 'estás en el editor')
    attachToBubble(bubble, noticeNode('Estás en el editor: no marco nada para no interferir.'))
    return
  }

  const placed = res?.placed || []
  const missed = res?.missed || anclables.map((x) => x.n)
  const detail = res?.detail || []

  forgetNotes({ keepPage: true })
  state.notes = anclables
  // Con la prosa de la que salieron: al repintar el chat, la tarjeta viva
  // vuelve bajo esa respuesta y no bajo otra. Y con si llevaba páginas base:
  // cambia lo que se dice de una observación sin pasaje.
  // Y con la prosa tal como la escribió el modelo: lo que opencode guarda es
  // eso, y al repintar el chat la tarjeta viva tiene que volver a su burbuja.
  state.notesResult = { prose: answer, prosaOriginal: original, filas, placed, missed, detail, conBase, product }
  state.notesCard = attachToBubble(bubble, notesCard(filas, placed, missed, detail, { conBase, product }))

  log.ok(
    'Análisis marcado',
    `${placed.length} de ${filasNumeros.length} marcadas` +
      (detail.length ? ' · ' + detail.map((d) => `${d.n}:${d.strategy}`).join(' ') : '') +
      // Lo que costó resolver y pintar las marcas DENTRO de la página, medido
      // allí (desde H3); el reloj del panel incluye además ir y venir por
      // mensajes. Si el content script no lo manda, no se imprime.
      (Number.isFinite(res?.ms) ? ` · ${res.ms} ms en la página` : '')
  )
  if (missed.length) log.warn('Sin anclar', 'observaciones ' + missed.join(', '))
}

/**
 * Cómo se lee cada `kind` de `NOTE_KINDS` (notes.js).
 *
 * Al modelo se le piden sin tilde —van en el `enum` de un esquema JSON— y al
 * usuario se le enseñan escritas: la única que cambia es «contradicción». Lo
 * que no esté aquí no se pinta (un kind vacío es lo normal: el modelo no está
 * obligado a clasificar).
 */
const KIND_LABELS = {
  dato: 'dato',
  supuesto: 'supuesto',
  hueco: 'hueco',
  contradiccion: 'contradicción',
  riesgo: 'riesgo',
}

/**
 * La lista numerada, para poder saltar de una observación a su subrayado.
 *
 * Con páginas base, una observación sin pasaje no habla necesariamente «de la
 * página en general»: lo normal es que hable de una página base, que no se
 * subraya porque sólo se marca la abierta. La fila lo dice así.
 *
 * @param {{conBase?: boolean, product?: string}} [opts] si el turno llevaba
 *        páginas base, y el producto: en Jira lo marcado es una incidencia, y
 *        «esta página» ahí significa una página de Confluence
 */
function notesCard(notes, placed, missed, detail = [], { conBase = false, product = '' } = {}) {
  const enJira = product === 'jira'
  const abierta = enJira ? 'esta incidencia' : 'esta página'
  const card = document.createElement('div')
  card.className = 'nav-card notes-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = enJira ? 'Marcado en la incidencia' : 'Marcado en la página'
  card.appendChild(kicker)

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent =
    placed.length === 1 ? 'Una observación subrayada' : `${placed.length} observaciones subrayadas`
  card.appendChild(title)

  const sinAncla = notes.filter((x) => !x.anchor).length
  const avisos = []
  if (missed.length) {
    avisos.push(
      missed.length === 1
        ? `Una no la he sabido situar en ${abierta}; la dejo sin marcar antes que marcarla mal.`
        : `${missed.length} no las he sabido situar en ${abierta}; las dejo sin marcar antes que marcarlas mal.`
    )
  }
  if (sinAncla) {
    avisos.push(
      conBase
        ? sinAncla === 1
          ? `Una no apunta a un pasaje de ${abierta}: habla de ella en general o de una página base.`
          : `${sinAncla} no apuntan a un pasaje de ${abierta}: hablan de ella en general o de una página base.`
        : sinAncla === 1
          ? `Una habla de ${abierta} en general y no tiene pasaje que marcar.`
          : `${sinAncla} hablan de ${abierta} en general y no tienen pasaje que marcar.`
    )
  }
  if (avisos.length) {
    const text = document.createElement('div')
    text.className = 'nav-text'
    text.textContent = avisos.join(' ')
    card.appendChild(text)
  }

  const list = document.createElement('div')
  list.className = 'note-list'

  for (const nota of notes) {
    const puesta = placed.includes(nota.n)

    const row = document.createElement('button')
    row.className = 'note-row' + (puesta ? '' : ' missing') + (nota.anchor ? '' : ' unanchored')
    row.type = 'button'
    row.disabled = !puesta

    const num = document.createElement('span')
    num.className = 'note-num'
    num.textContent = String(nota.n)

    const cuerpo = document.createElement('span')
    cuerpo.className = 'note-body'

    const titulo = document.createElement('span')
    titulo.className = 'note-title'
    titulo.textContent = nota.title

    const cita = document.createElement('span')
    cita.className = 'note-quote'
    cita.textContent = puesta
      ? quoteLabel(nota, detail.find((d) => d.n === nota.n))
      : nota.anchor
        ? 'no la he encontrado en la página'
        : conBase
          ? 'no apunta a un pasaje de esta página (habla de ella en general o de una página base)'
          : 'habla de la página en general; no hay pasaje que marcar'

    // De qué clase es la observación. El modelo ya lo dice y `validateNotes` ya
    // lo valida contra `NOTE_KINDS`; hasta ahora la tarjeta lo tiraba, y un dato
    // no se lee igual que un riesgo. Etiqueta de texto, sin color: un solo
    // acento en el panel (docs/PLAN.md §3.4).
    const meta = document.createElement('span')
    meta.className = 'note-meta'
    const etiqueta = KIND_LABELS[nota.kind]
    if (etiqueta) {
      const clase = document.createElement('span')
      clase.className = 'note-kind'
      clase.textContent = etiqueta
      meta.appendChild(clase)
    }
    meta.appendChild(cita)

    cuerpo.append(titulo, meta)
    row.append(num, cuerpo)

    if (puesta) row.addEventListener('click', () => focusNote(nota.n))
    list.appendChild(row)
    state.noteRows.set(nota.n, row)
  }

  card.appendChild(list)

  const actions = document.createElement('div')
  actions.className = 'nav-actions'
  const quitar = document.createElement('button')
  quitar.className = 'ghost small'
  quitar.type = 'button'
  quitar.textContent = 'Quitar las marcas'
  quitar.addEventListener('click', () => clearNotes())
  actions.appendChild(quitar)

  // El análisis acaba casi siempre en un comentario de la incidencia o de la
  // página: la prosa numerada al portapapeles, tal como se lee en el chat.
  // La prosa se captura AQUÍ, al pintar: quien llama acaba de dejarla en
  // `state.notesResult` (los tres sitios lo hacen), y si después llega otro
  // análisis, esta tarjeta —que sigue en el chat— copia lo que ella enseña y no
  // lo último que haya pasado. Sin prosa no se ofrece el botón: uno que no
  // hace nada al pulsarlo es el fallo silencioso de siempre.
  const prosa = state.notesResult?.prose || ''
  if (prosa) {
    const copiar = document.createElement('button')
    copiar.className = 'ghost small'
    copiar.type = 'button'
    copiar.textContent = 'Copiar observaciones'
    copiar.addEventListener('click', () => copyNotes(prosa, copiar))
    actions.appendChild(copiar)
  }

  card.appendChild(actions)

  return card
}

/**
 * Las observaciones al portapapeles: el Markdown tal cual, con sus «[n]».
 *
 * Es lo que se ve en el chat —incluida la numeración que Faro haya adaptado—,
 * no una versión limpia: al pegarlo en un comentario, los números tienen que
 * seguir casando con las marcas de la página. Si el portapapeles falla, lo dice
 * el propio botón («No se pudo»), que es la contraparte visible (§8.14).
 */
async function copyNotes(prosa, boton) {
  if (!prosa) return
  const copiado = await copyToClipboard(prosa, boton)
  if (copiado) log.ok('Observaciones copiadas', `${prosa.length} caracteres`)
  announce(copiado ? 'Observaciones copiadas' : 'No se pudo copiar las observaciones')
}

/**
 * Qué se marcó de verdad, para la fila de la tarjeta: la cita, el bloque
 * entero si la cita no estaba tal cual, y un aviso si fue por aproximación.
 */
function quoteLabel(nota, info) {
  const a = nota.anchor || {}
  if (info?.strategy?.endsWith('+whole')) return `bloque entero: «${String(a.hint || '').slice(0, 110)}»`
  const texto = `«${String(a.exact || a.hint || '').slice(0, 110)}»`
  return info?.approximate ? texto + ' · aproximada' : texto
}

/**
 * Un aviso con el botón «Pedirlo numerado»: la misma pregunta vuelve al
 * modelo con el recordatorio de formato delante. Es el último recurso cuando
 * ni la numeración «a su manera», ni el JSON, ni la pasada que trocea han
 * dado nada: el usuario no acepta un análisis sin subrayar, y repetirlo bien
 * pedido es lo que queda.
 */
function withRetryNumbered(node, question = '') {
  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.type = 'button'
  btn.textContent = 'Pedirlo numerado'
  btn.addEventListener('click', () => {
    if (state.streaming) return
    // El botón promete marcas: el turno va en Análisis aunque el desplegable
    // haya cambiado, con la misma secuencia que el propio desplegable.
    if (state.skill !== 'analisis') {
      setSkill('analisis')
      log.info('Skill', skillById(state.skill).label)
      if (state.site) saveSite(state.site.host, { skill: state.skill }).catch(() => null)
    }
    el.input.value = numberedReminder(question || state.lastQuestion)
    autoGrow()
    send()
  })
  row.appendChild(btn)
  node.appendChild(row)
  return node
}

/**
 * La pasada que trocea: para una respuesta sin ningún número, en una sesión
 * desechable como la segunda pasada. Devuelve también la prosa con los «[n]»
 * puestos por posición. Nunca lanza; si algo falla, lo apunta.
 */
async function segmentedPassNotes(answer, digest, signal = null) {
  const nada = { notes: [], prose: answer, inserted: [], missing: [] }
  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · observaciones' })
  } catch (err) {
    log.warn('Pasada que trocea', 'no se pudo abrir la sesión: ' + (err?.message || err))
    return nada
  }
  try {
    const r = await collectSegmentedNotes(state.client, {
      sessionID: session.id,
      model: state.model,
      // Sin el recordatorio de «Pedirlo numerado» delante: no es la pregunta.
      question: stripNumberedReminder(state.lastQuestion),
      answer,
      digest,
      signal,
    })
    if (r.reason) log.info('Pasada que trocea', r.reason)
    else log.ok('Pasada que trocea', `${r.inserted.length} observaciones numeradas en la respuesta · ${r.notes.filter((x) => x.anchor).length} situadas`)
    return r
  } finally {
    state.client.deleteSession(session.id).catch(() => {})
  }
}

/**
 * La segunda pasada: pide las anclas aparte, en una sesión desechable —igual
 * que el planificador: el chat no tiene por qué llenarse del JSON—. Sólo se
 * llega aquí cuando la respuesta numeró observaciones y no trajo el bloque.
 * Devuelve una lista vacía si algo falla, y lo apunta.
 */
async function secondPassNotes(answer, digest, signal = null) {
  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · observaciones' })
  } catch (err) {
    log.warn('Segunda pasada', 'no se pudo abrir la sesión: ' + (err?.message || err))
    return []
  }
  try {
    const { notes, reason } = await collectNotes(state.client, {
      sessionID: session.id,
      model: state.model,
      question: stripNumberedReminder(state.lastQuestion),
      answer,
      digest,
      signal,
    })
    if (reason) log.info('Segunda pasada', reason)
    else log.ok('Segunda pasada', `${notes.length} observaciones situadas`)
    return notes
  } finally {
    state.client.deleteSession(session.id).catch(() => {})
  }
}

/**
 * La tarjeta de un análisis anterior, al restaurar la conversación.
 *
 * Las marcas vivían en la página donde se hicieron, así que no se rehacen
 * solas: hacerlo al abrir el panel desplazaría una página por la que el
 * usuario quizá sólo pasa. Pero las anclas siguen en la respuesta guardada, y
 * con un botón se vuelven a poner —si se sigue en la misma página.
 */
function staleNotesCard({ prose, anchors, bubble, url = '', conBase = false }) {
  const numeros = observationNumbers(prose, anchors).numeros
  const notes = validateNotes(anchors, { allowed: numeros })
  const filas = numeros.map(
    (n) => notes.find((x) => x.n === n) || { n, title: titleFromProse(prose, n), kind: '', anchor: null }
  )

  const card = document.createElement('div')
  card.className = 'nav-card notes-card stale'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = 'Análisis anterior'
  card.appendChild(kicker)

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent = 'Las marcas eran de la página donde se hizo'
  card.appendChild(title)

  const list = document.createElement('div')
  list.className = 'note-list'
  for (const nota of filas) {
    const row = document.createElement('button')
    row.className = 'note-row missing'
    row.type = 'button'
    row.disabled = true
    const num = document.createElement('span')
    num.className = 'note-num'
    num.textContent = String(nota.n)
    const cuerpo = document.createElement('span')
    cuerpo.className = 'note-body'
    const titulo = document.createElement('span')
    titulo.className = 'note-title'
    titulo.textContent = nota.title
    cuerpo.appendChild(titulo)
    row.append(num, cuerpo)
    list.appendChild(row)
  }
  card.appendChild(list)

  const actions = document.createElement('div')
  actions.className = 'nav-actions'
  const volver = document.createElement('button')
  volver.className = 'primary'
  volver.type = 'button'
  volver.textContent = 'Volver a marcar en esta página'
  volver.addEventListener('click', async () => {
    volver.disabled = true
    try {
      await remarkFromAnchors({ prose, anchors, bubble, card, url, conBase })
    } finally {
      volver.disabled = false
    }
  })
  actions.appendChild(volver)
  card.appendChild(actions)

  return card
}

/**
 * Vuelve a marcar un análisis guardado sobre la página de ahora. Nunca solo:
 * siempre detrás de un clic. Si la página no es la misma, lo dice y no toca
 * nada: se compara con la página que llevaba el mensaje guardado y, además,
 * los bloques de ahora no son los que vio el modelo, así que un bloque sólo
 * vale si su cita está de verdad dentro (`strict`). Sin eso, cualquier página
 * con bastantes párrafos acababa con «bloques enteros» de otra.
 */
async function remarkFromAnchors({ prose, anchors, bubble, card, url = '', conBase = false }) {
  if (!state.site || state.tabId == null) return
  if (!(await ensureContentAccess({ announce: true }))) return

  const { digest, reason } = await readPageDigest()
  if (!digest) {
    showNotice(
      reason === 'editando'
        ? 'Estás en el editor: no marco nada para no interferir.'
        : 'No he podido leer esta página en bloques, así que no he marcado nada.',
      true
    )
    return
  }
  if (url && digest.url && !samePage(digest.url, url)) {
    showNotice('Esas marcas eran de otra página: no he marcado nada.', true)
    return
  }

  const numeros = observationNumbers(prose, anchors).numeros
  const notes = validateNotes(anchors, { allowed: numeros, blocks: digest.blocks, strict: true })
  const anclables = notes.filter((x) => x.anchor)
  if (!anclables.length) {
    showNotice('Esas observaciones no apuntan a ningún bloque de esta página.', true)
    return
  }

  const res = await chrome.tabs
    .sendMessage(state.tabId, { type: MSG.ANNOTATE, notes: anclables })
    .catch(() => null)
  const placed = res?.placed || []
  if (!placed.length) {
    showNotice(
      res?.reason === 'editando'
        ? 'Estás en el editor: no marco nada para no interferir.'
        : 'Esas marcas eran de otra página, o el texto ha cambiado: no he marcado nada.',
      true
    )
    return
  }

  const filas = numeros.map(
    (n) => notes.find((x) => x.n === n) || { n, title: titleFromProse(prose, n), kind: '', anchor: null }
  )
  forgetNotes({ keepPage: true })
  state.notes = anclables
  const product = state.site?.product || ''
  state.notesResult = { prose, filas, placed, missed: res?.missed || [], detail: res?.detail || [], conBase, product }
  card.remove()
  state.notesCard = attachToBubble(bubble, notesCard(filas, placed, res?.missed || [], res?.detail || [], { conBase, product }))
  log.ok(
    'Análisis marcado de nuevo',
    `${placed.length} de ${anclables.length} marcadas` +
      // Volver a marcar al restaurar es uno de los caminos que interesa medir, y
      // la respuesta trae los ms igual que la primera vez (H3).
      (Number.isFinite(res?.ms) ? ` · ${res.ms} ms en la página` : '')
  )
}

/** Lleva a una observación concreta y la destaca, en la página y en el chat. */
async function focusNote(n) {
  if (!state.tabId) return
  const res = await chrome.tabs.sendMessage(state.tabId, { type: MSG.FOCUS_NOTE, n }).catch(() => null)
  if (!res?.ok) {
    showNotice(res?.reason || 'Esa marca ya no está en la página.', true)
    return
  }
  markNoteRow(n)
}

function markNoteRow(n) {
  for (const [num, row] of state.noteRows) row.classList.toggle('active', num === n)
}

/** Quita las marcas de la página y las da por terminadas aquí. */
async function clearNotes() {
  if (state.tabId != null) {
    await chrome.tabs.sendMessage(state.tabId, { type: MSG.CLEAR_NOTES }).catch(() => {})
  }
  forgetNotes()
}

/**
 * Olvida las marcas en el panel. Con `keepPage` no se toca la página: es lo que
 * hace falta cuando lo que viene es otro análisis, que va a marcarla él.
 */
function forgetNotes({ keepPage = false } = {}) {
  state.notes = []
  state.noteRows = new Map()
  state.notesResult = null
  if (state.notesCard) {
    // La tarjeta anterior se queda de recuerdo, pero ya no lleva a ningún sitio.
    state.notesCard.classList.add('stale')
    state.notesCard.querySelectorAll('button').forEach((b) => (b.disabled = true))
    state.notesCard = null
  }
  if (!keepPage && state.tabId != null) {
    chrome.tabs.sendMessage(state.tabId, { type: MSG.CLEAR_NOTES }).catch(() => {})
  }
}

/** Sin índice no hay navegación: se dice, y se ofrece construirlo. */
function sinMapaCard() {
  const card = document.createElement('div')
  card.className = 'nav-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = 'Aún no puedo llevarte'

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent = 'Me falta el mapa de este sitio'

  const text = document.createElement('div')
  text.className = 'nav-text'
  text.textContent =
    'Para llevarte a una página necesito su identificador y el árbol al que pertenece. Construir el contexto tarda un par de minutos y se hace una sola vez.'

  const actions = document.createElement('div')
  actions.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.type = 'button'
  btn.textContent = 'Construir el mapa'
  btn.addEventListener('click', () => {
    card.remove()
    generateContext()
  })
  actions.appendChild(btn)

  card.append(kicker, title, text, actions)
  return card
}

function navCard(plan) {
  const card = document.createElement('div')
  card.className = 'nav-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  // Casi siempre la tarjeta ofrece llevarte a algún sitio. Una búsqueda directa
  // trae el suyo («Búsqueda directa»): no la pidió el modelo y decir «Puedo
  // llevarte» sería atribuirle a un turno algo que no ha pasado.
  kicker.textContent = plan.kicker || 'Puedo llevarte'
  card.appendChild(kicker)

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent = plan.destination.title
  card.appendChild(title)

  if (plan.explanation) {
    const text = document.createElement('div')
    text.className = 'nav-text'
    text.textContent = plan.explanation
    card.appendChild(text)
  }

  if (plan.steps?.length > 1) {
    const steps = document.createElement('div')
    steps.className = 'nav-steps'
    plan.steps.forEach((s, i) => {
      if (i) {
        const sep = document.createElement('b')
        sep.textContent = '›'
        steps.appendChild(sep)
      }
      const chip = document.createElement('span')
      chip.textContent = s.label || s.title
      steps.appendChild(chip)
    })
    card.appendChild(steps)
  }

  const actions = document.createElement('div')
  actions.className = 'nav-actions'

  for (const opt of navOptions(plan, state.settings)) {
    const b = document.createElement('button')
    b.className = opt.kind
    b.type = 'button'
    b.textContent = opt.label
    b.addEventListener('click', () => runPlan(plan, opt.mode, card))
    actions.appendChild(b)
  }

  card.appendChild(actions)
  return card
}

async function runPlan(plan, mode, card) {
  const type = mode === 'assisted' && plan.steps?.length > 1 ? MSG.START_PLAN : MSG.NAVIGATE_DIRECT

  // La asistida y el resaltado necesitan el content script; el salto directo
  // no. Por eso el permiso se pide justo aquí, y sólo cuando hace falta.
  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    showPermissionNotice()
    if (mode === 'assisted') {
      log.warn('Asistida bloqueada', 'falta permiso en ' + state.site.host)
      return
    }
  }

  card.querySelectorAll('button').forEach((b) => (b.disabled = true))

  // Un recorrido paso a paso dura varios segundos por rama y se puede parar
  // desde aquí: el service worker atendía CANCEL_PLAN y nadie lo mandaba. El
  // botón vive mientras dura el recorrido y se va con PLAN_FINISHED.
  const tabId = state.tabId
  if (type === MSG.START_PLAN) {
    const stop = document.createElement('button')
    stop.className = 'ghost small'
    stop.type = 'button'
    stop.textContent = 'Parar'
    stop.addEventListener('click', async () => {
      stop.disabled = true
      await chrome.runtime.sendMessage({ type: MSG.CANCEL_PLAN, tabId }).catch(() => null)
      // El service worker avisa con PLAN_FINISHED si había un paso en curso;
      // entre pasos (esperando la recarga) sólo borra el plan: se cierra aquí.
      finishNavRun({ cancelled: true })
    })
    card.querySelector('.nav-actions')?.appendChild(stop)
    state.navRun = { card, stop, tabId }
  }

  const res = await chrome.runtime.sendMessage({ type, tabId, plan }).catch((e) => ({
    ok: false,
    error: String(e?.message || e),
  }))

  if (res?.ok) {
    log.ok('Navegación lanzada', `${mode} · ${plan.destination.title} · ${plan.destination.url}`)
  } else {
    log.error('Navegación fallida', res?.error || 'sin respuesta')
    finishNavRun()
    const aviso = 'No he podido navegar: ' + (res?.error || 'sin respuesta')
    card.appendChild(noticeNode(aviso, true))
    announce(aviso)
  }
}

/**
 * El recorrido en marcha ha terminado (o se ha parado): su botón «Parar» se
 * va y la tarjeta vuelve a ofrecer el viaje. Idempotente: puede llegar por el
 * botón y por PLAN_FINISHED.
 */
function finishNavRun({ cancelled = false } = {}) {
  const run = state.navRun
  if (!run) return
  state.navRun = null
  run.stop.remove()
  // Parado a medias, la tarjeta vuelve a ofrecer el viaje; terminado, se
  // queda como estaba (ya estás allí).
  if (cancelled) {
    run.card.querySelectorAll('button').forEach((b) => (b.disabled = false))
    log.info('Navegación cancelada', 'desde la tarjeta')
    setStatus(state.client?.connected ? 'ok' : 'bad', state.client?.connected ? 'conectado' : 'sin conexión')
  }
}

/**
 * Señalar en la página: el usuario subraya un texto o pulsa una imagen, y eso
 * pasa a ser el contexto de la siguiente pregunta.
 *
 * Necesita el content script, así que el permiso se comprueba aquí y no al
 * abrir el panel: pedirlo antes de que haga falta es pedirlo por si acaso.
 */
async function togglePick() {
  if (state.picking) return stopPick()
  if (!state.site || !state.tabId) return

  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    showPermissionNotice()
    return
  }

  const r = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PICK_START }).catch(() => null)
  if (!r?.ok) {
    showNotice('No he podido activar la selección en esta pestaña. Recárgala y vuelve a intentarlo.', true)
    return
  }
  setPicking(true)
}

async function stopPick() {
  setPicking(false)
  if (state.tabId != null) {
    await chrome.tabs.sendMessage(state.tabId, { type: MSG.PICK_CANCEL }).catch(() => {})
  }
}

function setPicking(on) {
  state.picking = !!on
  el.pick.classList.toggle('picking', !!on)
  el.pick.title = on ? 'Cancelar la selección' : 'Señalar texto o una imagen de la página'
}

function clearPick() {
  state.pendingPick = null
  paintPickChip()
}

function paintPickChip() {
  const pick = state.pendingPick
  el.pickChip.classList.toggle('hidden', !pick)
  if (!pick) return
  el.pickChipText.textContent =
    pickLabel(pick) + (pick.kind === 'image' && !pick.image ? ' · sin adjuntar' : '')
}

// ------------------------------------------- páginas base del análisis

/**
 * El botón junto a la Skill y el chip sobre el cuadro de texto.
 *
 * El botón sólo existe en Análisis. Se enciende cuando hay algo elegido —hay
 * páginas, o el alcance es exclusivo— y la insignia cuenta las páginas: en
 * exclusivo sin páginas no hay «0» que enseñar, lo dice el título. El chip
 * repite lo mismo en una frase: lo que va a acompañar a la siguiente pregunta
 * se ve siempre, que mandarlo a escondidas sería mandarlo a espaldas de quien
 * pregunta.
 */
function paintSourcesUi() {
  const analisis = state.skill === 'analisis'
  const s = state.sources
  const n = s.pages.length
  const activo = hasSources(s)
  const product = state.site?.product || ''

  el.sources.classList.toggle('hidden', !analisis)
  el.sources.classList.toggle('on', analisis && activo)
  el.sources.title = activo ? sourcesLabel(s, { product }) : 'Páginas base del análisis'
  el.sourcesCount.textContent = n ? String(n) : ''
  el.sourcesCount.classList.toggle('hidden', !n)

  const label = analisis ? sourcesLabel(s, { product }) : ''
  el.sourcesChip.classList.toggle('hidden', !label)
  el.sourcesChipText.textContent = label
}

async function showSourcesScreen() {
  if (!state.site) return
  const s = state.sources
  $('sources-mode-exclusive').checked = s.mode === 'exclusive'
  $('sources-mode-open').checked = s.mode !== 'exclusive'
  $('sources-query').value = ''
  $('sources-mcp').classList.toggle('hidden', state.mcpConnected)
  $('sources-perm').classList.add('hidden')
  setSourcesStatus('')
  clearSourceSuggestions()
  paintSourceList()
  // Las sugeridas: la primera pasada es local y se pinta ya; la segunda le pide
  // los enlaces a la pestaña y repinta cuando lleguen. Sin `await`: lo que queda
  // de esta función es el estado de los permisos y no puede esperar a una
  // pestaña que quizá no conteste (§8.14).
  paintSuggestedSources().catch(console.error)
  showScreen('screen-sources')
  $('sources-query').focus()

  // Las páginas base son de Confluence: desde Jira, según el despliegue, se
  // buscan en el sitio de la pestaña (Cloud comparte host) o en el Confluence
  // ENLAZADO, desde el panel y con permiso sobre ese dominio (Data Center: su
  // API vive en su origen, no en el de esta pestaña). Sin enlace, queda el
  // índice y pegar el id. Pasó de verdad: desde Jira no encontraba ninguna
  // página de Confluence porque sólo miraba un índice que aún no existía.
  if (state.site.product === 'jira' && !state.site.cloud) {
    const target = sourcesTarget()
    const n = Object.keys(sourcesIndex()?.pages || {}).length
    if (!target) {
      setSourcesStatus(
        'Las páginas base son de Confluence; este Jira no tiene ningún Confluence enlazado, así que no puedo buscarlas ni comprobar una URL: pega el id numérico de la página.'
      )
      return
    }
    const host = target.site.host
    if (await hasHostPermission(target.site.origin)) {
      setSourcesStatus(
        `Las páginas base son del Confluence enlazado (${host}): busco en su índice (${n} páginas) y en su API, con tu sesión, y acepto sus URL o su id.`
      )
      return
    }
    $('sources-perm').classList.remove('hidden')
    $('sources-perm-text').textContent = `Sin permiso sobre ${host} sólo busco en su índice.`
    setSourcesStatus(
      n
        ? `Las páginas base son del Confluence enlazado (${host}). Sin permiso sobre ese dominio sólo busco en su índice (${n} páginas); con él, también en su API, con tu sesión. Sus URL y su id valen igual.`
        : `Las páginas base son del Confluence enlazado (${host}). No tengo nada indexado de él y sin permiso sobre ese dominio no puedo preguntarle: dame permiso, o pega la URL o el id de la página.`
    )
    return
  }
  if (state.site.product === 'jira') setSourcesStatus('Las páginas base son páginas de Confluence de este mismo sitio.')

  // Sin permiso sobre el dominio no hay content script, y sin él no se puede
  // preguntar a Confluence: queda el índice, y se ofrece el permiso AQUÍ,
  // porque la tarjeta del chat queda tapada por esta pantalla.
  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    $('sources-perm').classList.remove('hidden')
    $('sources-perm-text').textContent = `Sin permiso sobre ${state.site.host} sólo busco en lo que ya tengo indexado.`
    const n = Object.keys(state.index?.pages || {}).length
    setSourcesStatus(
      n
        ? `Sin permiso sobre ${state.site.host} sólo busco en lo que ya tengo indexado (${n} páginas).`
        : `Todavía no tengo nada indexado de este sitio y no puedo preguntarle a Confluence sin permiso: pega la URL de la página, o dame permiso.`
    )
  }
}

function setSourcesStatus(text) {
  $('sources-status').textContent = text || ''
}

/** Las páginas elegidas, con su × para quitarlas. */
function paintSourceList() {
  const list = $('sources-list')
  list.textContent = ''
  for (const p of state.sources.pages) {
    const row = document.createElement('div')
    row.className = 'source-row'

    const title = document.createElement('span')
    title.className = 'source-title'
    title.textContent = p.title
    title.title = p.title

    const meta = document.createElement('span')
    meta.className = 'source-meta'
    meta.textContent = [p.spaceKey, `id ${p.id}`].filter(Boolean).join(' · ')

    const x = document.createElement('button')
    x.className = 'source-x'
    x.type = 'button'
    x.title = 'Quitar esta página'
    x.setAttribute('aria-label', `Quitar «${p.title}»`)
    x.textContent = '×'
    x.addEventListener('click', () => removeSource(p.id).catch(console.error))

    row.append(title, meta, x)
    list.appendChild(row)
  }
}

// ------------------------------------------------ páginas base sugeridas

/**
 * Apunta qué páginas base sirvieron para analizar esta incidencia o esta
 * página, que es lo único que hace falta para proponerlas la próxima vez.
 *
 * Nada de esto llama al modelo ni viaja a ningún prompt (§8.20): se guarda lo
 * que el usuario ELIGIÓ —ids, títulos, la clave, la familia y la fase que la
 * extensión ya leía de los campos— en una clave local por host, borrable desde
 * la propia pantalla. Se llama con lo capturado al mandar, como el aviso de las
 * páginas base, y sólo apunta un análisis que salió bien.
 *
 * El gancho es UNO y se comparte (H11 lo amplía en vez de añadir otro): de un
 * turno terminado salen DOS apuntes, y no piden lo mismo.
 *  - El DIARIO local (`activity.js`): que analizaste esto, cuándo, con cuántas
 *    observaciones y de qué familia. Se apunta SIEMPRE que el análisis salió
 *    bien, con páginas base o sin ellas: «lo analizaste el lunes con 6
 *    observaciones y ha cambiado» es la razón más fuerte de «Qué mirar hoy», y
 *    la mayoría de los análisis no llevan páginas base.
 *  - El HISTORIAL de páginas base (H10): qué páginas sirvieron para analizar
 *    esto. Un turno sin páginas base no dice nada que sugerir, así que ése sí
 *    se salta.
 */
async function recordAnalysisTurn({
  skill,
  sources,
  ok = false,
  host = '',
  sessionID = null,
  issue = null,
  pageUrl = '',
  summary = '',
  issueKey = '',
  pageId = '',
  site = null,
  product = '',
  answer = '',
  anchors = null,
} = {}) {
  if (skill !== 'analisis' || !ok || !host) return
  // §8.22: entre la pregunta y aquí está `offerNotes`, que puede durar un turno
  // entero del modelo. El historial es de un HOST y sus entradas de una
  // incidencia: apuntarlo con el panel ya en otro sitio sería sugerir allí lo
  // que se eligió aquí, y bajo la clave equivocada. El diario se guarda por
  // host y por clave de ítem, así que escribirlo de todas formas sería
  // correcto; se deja fuera igual, para que del turno haya UNA sola regla de
  // «esto ya no es mío» y el Registro diga la verdad con una sola línea.
  if ((state.site?.host ?? state.lastHost) !== host || state.sessionID !== sessionID) {
    log.info('Historial de páginas base', `sin apuntar (ni el diario): el panel ya no está en ${host}`)
    return
  }

  // El diario, primero y para cualquier Análisis: es lo que el usuario verá
  // mañana en «Qué mirar hoy».
  await noteAnalyzed({ host, issueKey, pageId, product, issue, summary, site, answer, anchors })

  // Y el historial de páginas base, sólo si las hubo.
  if (!sources?.pages?.length) return

  // Los campos de la incidencia: los del digest de este turno si lo hubo y, si
  // no, los que se leyeron de la pantalla, cruzados con la página del turno.
  // `state.issueFields` es de UNA página y se guarda con su URL justo para
  // esto (lección de H8: lo que se guarda por host se cruza donde se consume).
  const campos = issue || (state.issueFields && samePage(state.issueFields.url, pageUrl) ? state.issueFields.fields : null)
  const entrada = historyEntry({
    sources,
    issue: campos,
    summary: cleanTabTitle(summary, site),
    issueKey,
    pageId,
    projectKey: site?.projectKey || '',
    spaceKey: site?.spaceKey || '',
    product,
  })
  // Sin identidad (ni clave ni id de página) no hay entrada: no se podría
  // deduplicar, y analizar tres veces lo mismo contaría como tres usos.
  if (!entrada) return

  // Se escribe primero y se recoge después lo que quedó GUARDADO: así el estado
  // del panel es lo que hay en disco y no una versión optimista que habría que
  // deshacer. Una cuota llena no puede llevarse la respuesta por delante: el
  // historial es un extra, y lo que se pierde es una sugerencia futura.
  let guardado = null
  try {
    guardado = await saveSourceHistory(host, recordAnalysis(state.sourceHistory, entrada, { host }))
  } catch (err) {
    log.warn('Historial de páginas base', 'no se pudo guardar · ' + String(err?.message || err))
    return
  }
  // Y sólo entra en el estado si el panel sigue en ese host: escribir en disco
  // tarda, y el de otro sitio no es éste (§8.22).
  if ((state.site?.host ?? state.lastHost) === host) state.sourceHistory = guardado
  log.ok(
    'Historial de páginas base',
    `${entrada.issueKey || 'página ' + entrada.pageId} · ${entrada.family || 'sin familia'} · ` +
      `${entrada.pages.length} página(s) base · ${guardado.entries.length} entradas`
  )
}

/**
 * Las páginas base que Faro propone AHORA, con los enlaces que la pestaña haya
 * contestado ya. Devuelve también los enlaces resueltos porque es lo que se
 * registra: cuántos llevaban a una página que se puede añadir.
 */
function computeSuggested() {
  const site = state.site
  if (!site) return { list: [], enlaces: [] }
  const index = sourcesIndex()
  const enlazado = linkedHost()
  // Cruzados por página donde se consumen, como los campos de la incidencia: lo
  // leído de otra página no cuenta para ésta.
  const deAqui = !!state.sourcesSuggest.url && samePage(state.sourcesSuggest.url, state.tabUrl)
  const enlaces = confluenceLinksIn(deAqui ? state.sourcesSuggest.links : [], deAqui ? state.sourcesSuggest.remote : null, {
    site,
    linkedHost: enlazado,
    index,
  })
  const list = suggestSources({
    index,
    references: currentReferences(),
    history: state.sourceHistory,
    links: enlaces,
    // Los campos de la pantalla de AHORA, cruzados por página como en los chips.
    issue: state.issueFields && samePage(state.issueFields.url, state.tabUrl) ? state.issueFields.fields : null,
    summary: cleanTabTitle(state.tabTitle, site),
    projectKey: site.projectKey || '',
    spaceKey: site.spaceKey || '',
    pageId: site.pageId || currentPageId(state.index, state.tabUrl) || '',
    issueKey: site.issueKey || '',
    exclude: state.sources.pages.map((p) => p.id),
    product: site.product,
    // Desde un Jira Data Center las páginas son del Confluence ENLAZADO: su
    // ruta no es de este sitio y se vacía (§4.8).
    linked: !!enlazado,
  })
  return { list, enlaces }
}

/**
 * La sección «Sugeridas», en dos pasadas.
 *
 * La primera es LOCAL y se pinta en el acto: el índice, el contexto, el
 * historial y los campos que ya se habían leído de la pantalla. La segunda le
 * pide a la pestaña los enlaces de la página o de la incidencia y repinta. Con
 * testigo, como la búsqueda: una respuesta que llega con la pantalla cerrada, en
 * otro host o después de otra pasada no pinta nada (§8.22).
 *
 * Si la pestaña no contesta —o no hay permiso sobre el dominio, o la API de los
 * enlaces remotos falla— la sección vive de lo demás y el texto de arriba lo
 * dice (§8.14). Ninguna de las dos pasadas gasta un token.
 */
async function paintSuggestedSources() {
  if (!state.site) return
  const token = ++state.sourcesSuggest.token
  const host = state.site.host
  const pagina = state.tabUrl
  state.sourcesSuggest.links = []
  state.sourcesSuggest.remote = null
  state.sourcesSuggest.url = ''

  const conPestana = state.tabId != null
  paintSuggestedList(computeSuggested().list, { estado: conPestana ? 'esperando' : 'sin-pestana' })
  if (!conPestana) return

  const puede = await ensureContentAccess({ announce: false })
  if (token !== state.sourcesSuggest.token || state.site?.host !== host) return
  if (!puede) {
    paintSuggestedList(computeSuggested().list, { estado: 'sin-pestana' })
    return
  }

  const r = await chrome.tabs
    .sendMessage(state.tabId, {
      type: MSG.PAGE_LINKS,
      // El interruptor maestro de las lecturas REST manda sobre la única que
      // hay aquí: los enlaces remotos de la incidencia. Apagado, el content
      // script no pide nada y los enlaces del DOM siguen llegando igual (no son
      // una lectura REST).
      remote: !!state.settings.restTools,
      // El Confluence que el panel tiene guardado para este Jira: sirve para
      // que el content script no admita un enlace remoto a OTRA Confluence.
      confluenceHost: linkedHost(),
      cloud: !!state.site.cloud,
    })
    .catch(() => null)
  if (token !== state.sourcesSuggest.token || state.site?.host !== host) return

  if (!r?.ok) {
    log.warn('Enlaces de la página', r?.reason || 'la pestaña no contestó')
    paintSuggestedList(computeSuggested().list, { estado: 'sin-enlaces' })
    return
  }

  // Lo que se captura al pedir manda al volver (§8.22): si la pestaña ya está en
  // otra página, estos enlaces son de la anterior y no se guardan.
  if (!samePage(r.url || pagina, state.tabUrl)) return
  state.sourcesSuggest.links = Array.isArray(r.links) ? r.links : []
  state.sourcesSuggest.remote = r.remote || null
  state.sourcesSuggest.url = r.url || pagina
  // Los campos vienen con los enlaces y son de la pantalla de ahora: se guardan
  // como los de `readIssueFieldsQuick`, con su URL, para que la puntuación por
  // familia no dependa de haber analizado antes.
  if (r.issue && samePage(r.url || state.tabUrl, state.tabUrl)) {
    state.issueFields = { url: r.url || state.tabUrl, fields: normalizeIssueFields(r.issue) }
  }

  const { list, enlaces } = computeSuggested()
  paintSuggestedList(list, { estado: 'listo' })
  const remotos = !r.issueKey
    ? 'no es una incidencia'
    : !state.settings.restTools
      ? 'apagados en Ajustes'
      : r.remote?.ok
        ? String(r.remote.links.length)
        : r.remote?.reason || 'sin respuesta'
  log.info(
    'Enlaces de la página',
    `${state.sourcesSuggest.links.length} leídos · ${enlaces.length} a Confluence · remotos: ${remotos}` +
      (Number.isFinite(r.ms) ? ` · ${r.ms} ms` : '')
  )
}

/**
 * De dónde salen las sugerencias, dicho arriba de la lista. Lo escribe la
 * extensión y nombra la fuente que falta cuando falta: sin permiso sobre el
 * dominio no hay enlaces que leer, y quien mira la sección tiene que saber que
 * lo que ve es sólo la mitad.
 */
function suggestedHint(estado) {
  const enJira = state.site?.product === 'jira'
  const cosa = enJira ? 'esta incidencia' : 'esta página'
  if (estado === 'sin-pestana') {
    return `Sin permiso sobre ${state.site?.host || 'este dominio'} no leo los enlaces de ${cosa}: sugiero con el contexto del sitio y lo que usaste antes.`
  }
  if (estado === 'sin-enlaces') {
    return `No he podido leer los enlaces de ${cosa}: sugiero con el contexto del sitio y lo que usaste antes.`
  }
  const campos = state.issueFields && samePage(state.issueFields.url, state.tabUrl) ? state.issueFields.fields : null
  const base =
    enJira && campos?.type
      ? `Por esta incidencia (tipo «${campos.type}»), el contexto del sitio y lo que usaste antes.`
      : enJira
        ? 'Por lo que enlaza esta incidencia, el contexto del sitio y lo que usaste antes.'
        : 'Por los enlaces de esta página, el contexto del sitio y lo que usaste antes.'
  return estado === 'esperando' ? base + ' Mirando los enlaces…' : base
}

/**
 * Las filas de «Sugeridas»: título, de dónde es y por qué se propone.
 *
 * Cada fila es un botón con su propio nombre («Añadir «X»»), no una opción de
 * una lista: no hay campo que las gobierne y pulsarlas es una acción. El motivo
 * lo escribe la extensión (`reasonText`), nunca el modelo ni la página.
 */
function paintSuggestedList(list, { estado = state.sourcesSuggest.estado } = {}) {
  state.sourcesSuggest.list = list
  state.sourcesSuggest.estado = estado
  const box = $('sources-suggested-list')
  box.textContent = ''
  const enlazado = linkedHost()

  for (const s of list) {
    const motivo = reasonText(s.reasons)
    const row = document.createElement('button')
    row.className = 'suggest-row suggested'
    row.type = 'button'
    // El nombre del botón lleva el motivo: sin él, quien usa lector de pantalla
    // oiría «Añadir «Guía de API», botón» y se quedaría sin lo único que
    // permite aceptarla o descartarla (§8.20).
    row.setAttribute('aria-label', motivo ? `Añadir «${s.title}» · ${motivo}` : `Añadir «${s.title}»`)

    const title = document.createElement('span')
    title.className = 'suggest-title'
    title.textContent = s.title

    const meta = document.createElement('span')
    meta.className = 'suggest-meta'
    meta.textContent = [s.spaceKey, `id ${s.id}`, enlazado ? `desde ${enlazado}` : ''].filter(Boolean).join(' · ')

    row.append(title, meta)
    if (motivo) {
      const why = document.createElement('span')
      why.className = 'suggest-why'
      why.textContent = motivo
      why.title = motivo
      row.appendChild(why)
    }
    row.addEventListener('click', () => chooseSuggestion(s).catch(console.error))
    box.appendChild(row)
  }

  $('sources-suggested-hint').textContent = list.length ? suggestedHint(estado) : ''
  // «Añadir las N» sólo con dos o más y con hueco para dos: para una sola ya
  // está su fila, y sin hueco el botón prometería algo que el tope no deja.
  const hueco = SOURCE_LIMITS.maxPages - state.sources.pages.length
  const todas = $('btn-sources-add-suggested')
  todas.textContent = `Añadir las ${Math.min(list.length, hueco)}`
  todas.classList.toggle('hidden', list.length < 2 || hueco < 2)
  // Y «Olvidar el historial» sólo si hay historial que olvidar.
  $('btn-sources-forget').classList.toggle('hidden', !state.sourceHistory.entries.length)
  refreshSuggestedVisibility()
}

/**
 * La sección se esconde mientras se escribe en el campo: la lista de la
 * búsqueda sale justo debajo del campo, y dos listas apiladas en 320 px no se
 * leen. Al vaciar el campo vuelve, sin recalcular nada.
 */
function refreshSuggestedVisibility() {
  const escribiendo = $('sources-query').value.trim().length >= SOURCE_LIMITS.queryMin
  $('sources-suggested').classList.toggle('hidden', escribiendo || !state.sourcesSuggest.list.length)
}

/** Repinta «Sugeridas» con las páginas base de ahora, sin volver a preguntarle a la pestaña. */
function repaintSuggested() {
  if (!state.site || $('screen-sources').classList.contains('hidden')) return
  paintSuggestedList(computeSuggested().list)
}

/** «Añadir las N»: en orden de puntuación y hasta donde llegue el tope de siempre. */
async function addSuggested() {
  const lista = [...state.sourcesSuggest.list]
  if (!lista.length) return
  const antes = state.sources.pages.length
  for (const s of lista) {
    if (state.sources.pages.length >= SOURCE_LIMITS.maxPages) break
    await chooseSuggestion(s)
  }
  const n = state.sources.pages.length - antes
  const texto = n ? `Añadidas ${n} ${n === 1 ? 'página base' : 'páginas base'}.` : 'No he podido añadir ninguna.'
  setSourcesStatus(texto)
  announce(texto)
  $('sources-query').focus()
}

/** «Olvidar el historial»: se va la clave de este host y con ella esa fuente. */
async function forgetSourceHistory() {
  if (!state.site) return
  const n = state.sourceHistory.entries.length
  await clearSourceHistory(state.site.host)
  state.sourceHistory = emptyHistory()
  log.info('Historial de páginas base', `borrado · ${n} entradas de ${state.site.host}`)
  repaintSuggested()
  const texto = 'Historial borrado: las sugerencias ya no se apoyan en análisis anteriores.'
  setSourcesStatus(texto)
  announce(texto)
}

/**
 * Lo que escribe el usuario en el campo único. Una URL o un id no se buscan:
 * se resuelven, o se explica por qué no valen. Lo demás es una búsqueda: al
 * instante en el índice y, tras una pausa, en Confluence.
 */
function onSourcesInput() {
  clearTimeout(state.sourcesSearch.timer)
  state.sourcesSearch.token++
  const text = $('sources-query').value
  // Con algo escrito, las sugeridas se apartan: quien busca ya sabe qué quiere.
  refreshSuggestedVisibility()
  // La pestaña ha podido salir de Atlassian con la pantalla abierta.
  if (!state.site) {
    clearSourceSuggestions()
    setSourcesStatus('Abre una página de Confluence y vuelve.')
    return
  }

  // Desde Jira, una URL del Confluence enlazado vale igual que una de aquí.
  const ref = pageRefFromUrl(text, state.site, { linkedHost: linkedHost() })
  const indice = sourcesIndex()
  if (ref.ok) {
    paintSuggestions([{ id: ref.id, title: `Añadir la página ${ref.id}`, path: ref.path, spaceKey: null, source: 'add' }])
    setSourcesStatus(indice?.pages?.[ref.id] ? `Es «${indice.pages[ref.id].title}».` : 'Intro para añadirla; el título se lee de Confluence.')
    return
  }
  if (ref.reason !== 'no-es-url') {
    clearSourceSuggestions()
    setSourcesStatus(refReasonText(ref.reason, text))
    return
  }

  const q = text.trim()
  if (q.length < SOURCE_LIMITS.queryMin) {
    clearSourceSuggestions()
    setSourcesStatus('')
    return
  }

  const exclude = state.sources.pages.map((p) => p.id)
  const local = suggestFromIndex(indice, q, { limit: SOURCE_LIMITS.suggestions, exclude })
  paintSuggestions(local)
  setSourcesStatus(local.length ? '' : 'Nada en el índice con ese título.')
  // Sin nadie a quien preguntar (un Jira Data Center sin Confluence enlazado)
  // queda lo del índice.
  if (!sourcesTarget()) return
  state.sourcesSearch.timer = setTimeout(
    () => searchSourcesRemote(q, local, exclude).catch(console.error),
    SOURCE_LIMITS.searchDebounceMs
  )
}

function refReasonText(reason, text) {
  if (reason === 'otro-sitio') {
    const host = hostOf(text.trim())
    const enlazado = linkedHost()
    return enlazado
      ? `Esa página es de ${host || 'otro sitio'}: desde este Jira sólo valen páginas del Confluence enlazado (${enlazado}).`
      : `Esa página es de ${host || 'otro sitio'} y estás en ${state.site?.host || 'otro'}: sólo valen páginas de este sitio.`
  }
  if (reason === 'jira') return 'Eso es una incidencia de Jira, no una página de Confluence.'
  return 'Esa dirección no lleva el id de la página (las de tipo /display/ESPACIO/Título no lo llevan). Ábrela y copia la URL con /pages/<número>, o pega el número.'
}

/**
 * La búsqueda en Confluence, con la sesión del navegador: en el sitio de la
 * pestaña desde el content script, o en el Confluence enlazado desde el
 * propio panel (un Jira Data Center: su API está en otro origen, y el panel,
 * que es una página de la extensión, puede pedírselo con permiso sobre ese
 * dominio; el content script de Jira no). Mismo módulo y mismas garantías en
 * los dos casos. Con testigo: si el usuario ha seguido escribiendo, la
 * respuesta llega tarde y se tira. Lo que vuelve se funde con lo del índice.
 */
async function searchSourcesRemote(q, local, exclude) {
  const token = state.sourcesSearch.token
  if (!state.site) return
  const target = sourcesTarget()
  if (!target) return

  let r = null
  if (target.via === 'linked') {
    // Sin permiso sobre ese dominio Chrome no deja ni intentarlo: se ofrece.
    if (!(await hasHostPermission(target.site.origin))) {
      $('sources-perm').classList.remove('hidden')
      return
    }
    if (token !== state.sourcesSearch.token) return
    setSourcesStatus(`Buscando en ${target.site.host}…`)
    // `include`: es otro origen, y sin eso no viajan las cookies de su sesión.
    r = await searchPages((u, o) => fetch(u, o), target.site, q, {
      limit: SOURCE_LIMITS.suggestions,
      credentials: 'include',
    }).catch((err) => ({ ok: false, reason: String(err?.message || err) }))
  } else {
    if (state.tabId == null) return
    if (!(await ensureContentAccess({ announce: false }))) return
    if (token !== state.sourcesSearch.token) return
    setSourcesStatus('Buscando en Confluence…')
    r = await chrome.tabs
      .sendMessage(state.tabId, {
        type: MSG.PAGE_SEARCH,
        query: q,
        wikiPrefix: wikiPrefixOf(state.site),
        cloud: state.site.cloud,
        limit: SOURCE_LIMITS.suggestions,
      })
      .catch(() => null)
  }
  if (token !== state.sourcesSearch.token) return

  const donde = target.via === 'linked' ? target.site.host : ''
  if (!r?.ok) {
    log.warn('Búsqueda de páginas', `${donde ? donde + ' · ' : ''}${r?.reason || 'la pestaña no contestó'}`)
    setSourcesStatus(searchFailText(r, donde) + (local.length ? ' Mientras, sólo busco en lo indexado.' : ''))
    return
  }

  // Las páginas del Confluence enlazado no tienen ruta relativa a ESTE sitio:
  // como una URL suya pegada, van sin ruta, y se marcan como suyas para que
  // no acaben fundidas en el índice de este Jira.
  const paginas = target.via === 'linked' ? r.pages.map((p) => ({ ...p, url: '' })) : r.pages
  const merged = mergeSuggestions(local, paginas, { limit: SOURCE_LIMITS.suggestions, exclude, host: state.site.host }).map((s) =>
    s.source === 'confluence' && target.via === 'linked' ? { ...s, source: 'linked' } : s
  )
  paintSuggestions(merged)
  setSourcesStatus(merged.length ? '' : 'Nada con ese título. Prueba con otra palabra o pega su URL.')
  log.debug('Búsqueda de páginas', `«${q}» · ${r.pages.length} de ${donde || 'Confluence'} · API ${r.via} · ${r.ms} ms`)
}

/** @param {string} [host] el Confluence enlazado, si se le preguntó a él y no al sitio de la pestaña */
function searchFailText(r, host = '') {
  const status = Number(r?.status) || 0
  if (status === 401 || status === 403 || /JSON/.test(String(r?.reason || ''))) {
    return host
      ? `Tu sesión de ${host} no vale para su API: ábrelo en otra pestaña, entra, y vuelve a intentarlo.`
      : 'Tu sesión de Confluence no vale para su API: recarga la pestaña y vuelve a entrar.'
  }
  return `No he podido preguntarle a ${host || 'Confluence'}: ` + (r?.reason || 'la pestaña no contestó') + '.'
}

/** La lista de sugerencias bajo el campo, como un listbox con teclado. */
function paintSuggestions(list) {
  const box = $('sources-suggest')
  const input = $('sources-query')
  box.textContent = ''
  state.sourcesSearch.suggestions = list
  state.sourcesSearch.active = -1
  input.removeAttribute('aria-activedescendant')

  list.forEach((s, i) => {
    const row = document.createElement('button')
    row.className = 'suggest-row' + (s.source === 'add' ? ' add' : '')
    row.type = 'button'
    row.id = 'sources-opt-' + i
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', 'false')

    const title = document.createElement('span')
    title.className = 'suggest-title'
    title.textContent = s.title

    const meta = document.createElement('span')
    meta.className = 'suggest-meta'
    meta.textContent =
      s.source === 'add'
        ? 'por su id'
        : [
            s.spaceKey,
            `id ${s.id}`,
            s.source === 'confluence' ? 'desde Confluence' : s.source === 'linked' ? `desde ${linkedHost() || 'el Confluence enlazado'}` : 'en el índice',
          ]
            .filter(Boolean)
            .join(' · ')

    row.append(title, meta)
    row.addEventListener('click', () => chooseSuggestion(s).catch(console.error))
    box.appendChild(row)
  })

  box.classList.toggle('hidden', !list.length)
  input.setAttribute('aria-expanded', list.length ? 'true' : 'false')
}

function clearSourceSuggestions() {
  paintSuggestions([])
}

function moveSuggestion(delta) {
  const { suggestions } = state.sourcesSearch
  if (!suggestions.length) return
  const n = suggestions.length
  // Sin nada resaltado, ↓ va a la primera y ↑ a la última: partir de -1 hacia
  // arriba caía en la penúltima.
  const from = state.sourcesSearch.active < 0 && delta < 0 ? 0 : state.sourcesSearch.active
  const next = ((from + delta) % n + n) % n
  state.sourcesSearch.active = next
  const rows = $('sources-suggest').querySelectorAll('.suggest-row')
  rows.forEach((row, i) => {
    row.classList.toggle('active', i === next)
    row.setAttribute('aria-selected', i === next ? 'true' : 'false')
  })
  $('sources-query').setAttribute('aria-activedescendant', 'sources-opt-' + next)
  rows[next]?.scrollIntoView({ block: 'nearest' })
}

/**
 * Teclado del campo: ↑/↓ recorren, Intro elige la resaltada (o la primera),
 * Esc quita las sugerencias; sin ellas, cierra el Escape del documento, como
 * en cualquier otra pantalla.
 */
function onSourcesKeydown(ev) {
  const { suggestions, active } = state.sourcesSearch
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    if (!suggestions.length) return
    ev.preventDefault()
    moveSuggestion(ev.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (ev.key === 'Enter') {
    ev.preventDefault()
    const elegida = suggestions[active >= 0 ? active : 0]
    if (elegida) chooseSuggestion(elegida).catch(console.error)
    return
  }
  // Con sugerencias, Escape sólo las vacía (y no llega al documento, que
  // cerraría la pantalla). Sin ellas, cierra el keydown del documento (A3).
  if (ev.key === 'Escape' && suggestions.length) {
    ev.preventDefault()
    ev.stopPropagation()
    clearSourceSuggestions()
  }
}

async function chooseSuggestion(s) {
  if (s.source === 'add') return addSourceById(s.id, s.path)
  // Una sugerida cuyo título es un marcador («Página 98830281»: un enlace sin
  // texto, o un enlace remoto sin título, a una página que el índice no conoce)
  // se añade leyendo su título por el camino de siempre, que es lo que decía el
  // plan: si no, el prompt del Análisis nombraba la página base como «Página N»
  // (revisión adversaria de H10). El motivo se conserva para el registro.
  if (s.source === 'suggested' && isPlaceholderTitle(s.title)) {
    return addSourceById(s.id, s.path, { suggested: true, reason: reasonText(s.reasons) })
  }
  // Una sugerida trae además POR QUÉ se propuso, y eso se apunta al añadirla:
  // en el registro queda por qué acabó ahí una página que Faro propuso.
  return addSource(
    { id: s.id, title: s.title, path: s.path, spaceKey: s.spaceKey },
    { from: s.source, reason: s.source === 'suggested' ? reasonText(s.reasons) : '' }
  )
}

/**
 * Una página por su id (URL pegada o número suelto): el título sale del
 * índice si la conoce y, si no, de la API del sitio —la misma petición que
 * lee el camino, que devuelve la propia página al final de la cadena—. Sin
 * quien la lea, se añade por su id, que es lo que el modelo necesita, y se
 * dice. Un 404 no se añade: no hay página.
 */
async function addSourceById(id, path = '', { suggested = false, reason = '' } = {}) {
  // De dónde dice el registro que salió: una sugerida lo sigue siendo aunque su
  // título haya habido que leerlo.
  const desde = (from) => (suggested ? { from: 'suggested', reason } : { from })
  if (!state.site) return
  // En Jira, el índice que sabe de páginas es el del Confluence enlazado.
  const conocida = sourcesIndex()?.pages?.[id]
  if (conocida) {
    return addSource({ id, title: conocida.title, path: conocida.path || path, spaceKey: conocida.spaceKey }, desde('index'))
  }

  // Desde un Jira Data Center la página es del Confluence enlazado, y se le
  // pregunta a él desde el panel. Sin enlace no hay a quién preguntar: se
  // añade por su id, que es lo que la pantalla prometió.
  const target = sourcesTarget()
  if (!target) {
    log.warn('Página base sin título', `${id} · sin Confluence al que preguntar`)
    await addSource({ id, title: '', path }, desde('id'))
    setSourcesStatus(`Añadida por su id ${id}: desde este Jira no puedo leer su título.`)
    return
  }
  const enlazado = target.via === 'linked'
  const donde = enlazado ? target.site.host : 'Confluence'

  // La comprobación tarda: si mientras tanto la pestaña se va a otro sitio,
  // lo que vuelva no es de aquí.
  const host = state.site.host
  setSourcesStatus(`Comprobando la página ${id} en ${donde}…`)
  const r = await fetchPageChain(id)
  if (state.site?.host !== host) return
  if (r.ok && r.pages?.length) {
    const propia = r.pages[r.pages.length - 1]
    // Lo que se aprende del sitio propio se queda en su índice. Lo del
    // Confluence enlazado no: es otro origen, y su índice es suyo (nunca se
    // guarda desde Jira); la página va sin ruta, como una URL suya pegada.
    if (!enlazado) await mergePagesIntoIndex(r.pages)
    return addSource(
      { id, title: propia.title, path: enlazado ? '' : propia.url || path, spaceKey: propia.spaceKey },
      desde(enlazado ? 'linked' : 'confluence')
    )
  }
  if (r.status === 404) {
    log.warn('Página base', `id ${id} · ${donde} · la API respondió 404`)
    setSourcesStatus(`${donde} no encuentra ninguna página con el id ${id}.`)
    return
  }
  if (r.needsPermission) $('sources-perm').classList.remove('hidden')
  log.warn('Página base sin título', `${id} · ${r.reason}`)
  await addSource({ id, title: '', path }, desde('id'))
  setSourcesStatus(`Añadida por su id ${id}: no he podido leer su título (${r.reason}).`)
}

/**
 * La cadena de una página por la API de Confluence: la del sitio, vía content
 * script; o la del Confluence enlazado, desde el panel (con permiso sobre su
 * dominio y las cookies de su sesión). Nunca lanza.
 */
async function fetchPageChain(id) {
  if (!state.site) return { ok: false, reason: 'sin sitio' }
  const target = sourcesTarget()
  if (!target) return { ok: false, reason: 'sin Confluence al que preguntar' }
  if (target.via === 'linked') {
    if (!(await hasHostPermission(target.site.origin))) {
      return { ok: false, reason: `sin permiso sobre ${target.site.host}`, needsPermission: true }
    }
    return fetchAncestors((u, o) => fetch(u, o), target.site, id, { credentials: 'include' }).catch((err) => ({
      ok: false,
      reason: String(err?.message || err),
    }))
  }
  if (state.tabId == null) return { ok: false, reason: 'sin pestaña' }
  if (!(await ensureContentAccess({ announce: false }))) return { ok: false, reason: 'sin acceso a la pestaña' }
  const r = await chrome.tabs
    .sendMessage(state.tabId, {
      type: MSG.PAGE_ANCESTORS,
      pageId: id,
      wikiPrefix: wikiPrefixOf(state.site),
      cloud: state.site.cloud,
    })
    .catch(() => null)
  return r || { ok: false, reason: 'la pestaña no contestó' }
}

/** Lo que la API o el usuario descubren se queda en el índice, sin pisar el árbol que ya se sabía. */
async function mergePagesIntoIndex(pages) {
  if (!state.site || !pages?.length) return
  const fresh = normalizeIndex({ pages, updated: Date.now() }, state.site.host, state.index?.scope, {
    cloud: state.site.cloud,
    wikiPrefix: state.site.wikiPrefix,
  })
  state.index = mergeIndexKeepingTree(state.index, fresh)
  await saveIndex(state.site.host, state.index)
}

async function addSource(page, { from = 'index', reason = '' } = {}) {
  if (!state.site) return
  const r = addSourcePage(state.sources, page, { host: state.site.host })
  if (!r.added) {
    setSourcesStatus(
      r.reason === 'tope'
        ? `Como mucho ${SOURCE_LIMITS.maxPages} páginas base: quita alguna para añadir otra.`
        : r.reason === 'duplicada'
          ? 'Esa página ya está en la lista.'
          : 'Eso no es una página de Confluence de este sitio.'
    )
    return
  }
  state.sources = r.sources
  await saveSite(state.site.host, { analysisSources: state.sources })
  // Lo que devolvió la API del sitio se queda en su índice; lo del Confluence
  // enlazado (`linked`) no: es de otro origen y su índice nunca se guarda desde Jira.
  if (from === 'confluence') await mergePagesIntoIndex([page])

  const añadida = state.sources.pages[state.sources.pages.length - 1]
  const origen = {
    index: 'del índice',
    confluence: 'de Confluence',
    linked: `de ${linkedHost() || 'el Confluence enlazado'}`,
    suggested: 'sugerida',
  }
  log.ok(
    'Página base añadida',
    `${añadida.title} (id ${añadida.id}) · ${origen[from] || 'por su id'}` + (from === 'suggested' && reason ? `: ${reason}` : '')
  )
  // Y en el diario local (H11): elegir una página como base es lo más fuerte
  // que el usuario dice de ella, y «página base de tus análisis, modificada» es
  // una de las tres señales grandes de «Qué mirar hoy». Se apunta bajo el host
  // de la PÁGINA —desde un Jira Data Center las páginas base son del Confluence
  // ENLAZADO—, que es donde su pestaña la verá (§8.22: lo guardado por host se
  // consume por host). No se espera a que salga bien: el diario es un extra y
  // no puede llevarse por delante una página que ya está añadida.
  await noteActivity(linkedHost() || state.site.host, {
    event: 'source',
    kind: 'confluence-page',
    id: añadida.id,
    title: añadida.title,
    path: añadida.path || '',
  })
  // Una sugerida se añade desde una fila que desaparece al instante: sin decirlo
  // en voz alta, quien usa lector de pantalla no sabe qué ha pasado.
  if (from === 'suggested') announce(`Añadida «${añadida.title}».`)
  // La búsqueda que estuviera en marcha era de lo que había en el campo, que
  // se vacía ahora: si llegara después, volvería a pintar la lista —con la
  // página recién añadida dentro— bajo un campo vacío.
  clearTimeout(state.sourcesSearch.timer)
  state.sourcesSearch.token++
  $('sources-query').value = ''
  clearSourceSuggestions()
  setSourcesStatus(`Añadida «${añadida.title}».`)
  paintSourceList()
  paintSourcesUi()
  // Y las sugeridas, que acaban de perder una y tienen un hueco menos: se
  // vuelven a puntuar con `exclude` al día, sin preguntarle nada a la pestaña.
  repaintSuggested()
  $('sources-query').focus()
}

async function removeSource(id) {
  if (!state.site) return
  const antes = state.sources.pages.find((p) => p.id === String(id))
  state.sources = removeSourcePage(state.sources, id)
  paintSourceList()
  paintSourcesUi()
  // Quitar una devuelve su hueco, y con él la página a la lista de sugeridas si
  // sigue puntuando: dejarlo sin repintar enseñaría «Añadir las 2» con sitio
  // para cuatro.
  repaintSuggested()
  await saveSite(state.site.host, { analysisSources: state.sources })
  log.info('Página base quitada', antes ? `${antes.title} (id ${antes.id})` : String(id))
}

async function setSourcesMode(mode) {
  if (!state.site) return
  state.sources = setSourceMode(state.sources, mode)
  await saveSite(state.site.host, { analysisSources: state.sources })
  log.info('Alcance del análisis', state.sources.mode === 'exclusive' ? 'sólo la página abierta y las páginas base' : 'las páginas base y las que decida el modelo')
  paintSourcesUi()
}

function closeSourcesScreen() {
  clearTimeout(state.sourcesSearch.timer)
  state.sourcesSearch.token++
  // Y lo de las sugeridas: la pestaña puede seguir contestando sus enlaces, y
  // eso ya no tiene pantalla donde pintarse. Al volver a abrir se recalculan.
  state.sourcesSuggest = { token: state.sourcesSuggest.token + 1, list: [], links: [], remote: null, estado: 'listo' }
  hideScreens()
  paintSourcesUi()
  el.input.focus()
}

function onRuntimeMessage(msg) {
  if (msg?.type === MSG.NOTE_CLICKED) {
    // Han pulsado el número en la página: se marca la fila del chat y se sube
    // hasta ella. Los dos sentidos, con el mismo número.
    markNoteRow(msg.n)
    // Un `behavior: 'smooth'` explícito manda sobre el `scroll-behavior` del
    // CSS, así que «Reducir animaciones» no llegaría hasta aquí si no se
    // preguntase (A9).
    const suave = state.settings.reduceMotion ? 'auto' : 'smooth'
    state.noteRows.get(msg.n)?.scrollIntoView({ block: 'nearest', behavior: suave })
    return
  }

  if (msg?.type === MSG.PICK_RESULT) {
    setPicking(false)
    if (!msg.pick) {
      log.info('Selección cancelada')
      return
    }
    state.pendingPick = msg.pick
    paintPickChip()
    log.ok('Señalado en la página', pickLabel(msg.pick))
    el.input.focus()
    return
  }

  if (msg?.type === MSG.PLAN_PROGRESS) {
    setStatus('busy', `paso ${msg.index + 1}/${msg.total}`)
  } else if (msg?.type === MSG.PLAN_FINISHED) {
    setStatus('ok', 'conectado')
    // La tarjeta del recorrido vuelve en sí (si se paró desde ella, ya lo hizo
    // el botón y esto no repite el registro).
    const parada = !!state.navRun && !!msg.result?.cancelled
    finishNavRun()
    if (msg.result?.needsPermission) {
      log.error('Navegación detenida', 'sin permiso de host')
      showPermissionNotice()
    } else if (msg.result?.error) {
      log.error('Navegación detenida', msg.result.error)
      showNotice(msg.result.error, true)
    } else if (msg.result?.anchored) log.ok('Fragmento resaltado', msg.result.strategy)
    else if (msg.result?.cancelled) log.info('Navegación cancelada', parada ? 'desde la tarjeta' : 'desde la página')
    else if (msg.result?.message) log.warn('Sin resaltar', msg.result.message)
    if (msg.result?.anchored === false && msg.result?.message) showNotice(msg.result.message)
  }
}

/**
 * Abre un enlace del chat en una pestaña nueva, si es de un origen conocido.
 *
 * Los enlaces los escribe el modelo, y el modelo repite lo que lee: un enlace
 * a un dominio que imite el login de Atlassian, copiado de una página
 * inyectada, se abría igual (docs/PLAN.md §2.1 S5). Sólo se abren el sitio de
 * la pestaña, el Confluence enlazado a este Jira y la lista fija de la
 * extensión (`links.js`); lo demás se dice, con su host, y no se abre.
 */
function openUrl(href) {
  const { origin, linkedOrigin } = linkCtx()
  if (!allowedLinkOrigin(href, { origin, linkedOrigin })) {
    const host = hostOf(href) || String(href || '').slice(0, 80)
    log.warn('Enlace fuera del sitio', host)
    // El aviso es la ÚNICA respuesta al clic: hay que verlo. Tras A7 el chat
    // sólo baja solo si el usuario estaba pegado al fondo, así que un aviso
    // sin `force` se pintaba fuera de la vista de quien había subido a leer y
    // el enlace parecía muerto (revisión adversaria de H2, 2026-09-14). Éste
    // se fuerza porque lo ha pedido él, con un clic, ahora mismo.
    showNotice(
      `Enlace fuera del sitio: ${host}. No lo abro: sólo abro enlaces de este sitio${linkedOrigin ? ' y de su Confluence enlazado' : ''}. Si lo necesitas, cópialo a mano.`,
      false,
      { force: true }
    )
    return
  }
  chrome.tabs.create({ url: href }).catch(() => {})
}

/** Los dos orígenes contra los que se mide un enlace: el sitio de la pestaña y el Confluence enlazado a este Jira. */
function linkCtx() {
  return { origin: state.site?.origin || '', linkedOrigin: linkedSite(state.linkedContext)?.origin || '' }
}

/**
 * La misma regla que `openUrl`, un momento antes: al PINTAR.
 *
 * `renderMarkdown` ponía `href` + `target="_blank"` en todos los enlaces, y un
 * `href` se abre sin pasar por el manejador: clic central, «Abrir en pestaña
 * nueva» del menú contextual, arrastrarlo. La comprobación de `openUrl` se
 * esquivaba entera (revisión adversaria de H2, 2026-09-14, sobre S5). Lo que
 * no se abriría no se pinta como enlace: se ve su URL y se copia a mano.
 */
function linkAllowed(href) {
  return allowedLinkOrigin(href, linkCtx())
}

// ------------------------------------------------------------- pantallas

/**
 * Abre una pantalla a pantalla completa.
 *
 * Lo de detrás —cabecera, chat, redactor— queda INERTE y el foco entra en la
 * pantalla: sin esto, Tab recorría siete controles tapados (Intro en una
 * sugerencia mandaba un turno con Ajustes abierto) y sólo al octavo llegaba a
 * la pantalla (docs/PLAN.md §2.5 A1, reproducido en la auditoría del
 * 2026-09-13). Quién tenía el foco se recuerda para devolvérselo al cerrar;
 * si se abre una pantalla encima de otra, se recuerda el de ANTES de la
 * primera, que es a donde hay que volver.
 */
function showScreen(id, extra) {
  const habia = document.querySelector('.screen:not(.hidden)')
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'))
  const screen = $(id)
  screen?.classList.remove('hidden')

  if (id === 'screen-connect') {
    $('connect-cmd').textContent = connectCommand()
    $('server-url').value = state.settings.serverUrl
    $('server-pass').value = state.settings.password
    $('connect-error').textContent = extra ? String(extra).slice(0, 160) : ''
  }

  if (!habia) state.focusBefore = document.activeElement
  el.app.inert = true
  // El título visible de la pantalla (el primero que no esté oculto: la de
  // claves tiene dos partes), enfocable sólo por programa.
  const titulo = [...(screen?.querySelectorAll('h1') || [])].find((h) => !h.closest('.hidden'))
  if (titulo) {
    titulo.tabIndex = -1
    titulo.focus()
  }
}

/** Cierra las pantallas; lo de detrás vuelve a estar vivo y el foco, a quien lo tenía (o al cuadro). */
function hideScreens() {
  const habia = document.querySelector('.screen:not(.hidden)')
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'))
  el.app.inert = false
  if (!habia) return
  devolverFoco()
}

/**
 * El foco vuelve a quien lo tenía antes de que se tapara el panel, o al
 * cuadro. Lo comparten las pantallas y el velo «Trabajando…»: los dos apagan
 * lo de debajo, y los dos tienen que devolverlo al destaparlo.
 */
function devolverFoco() {
  const antes = state.focusBefore
  state.focusBefore = null
  const vale = antes && antes !== document.body && antes.isConnected && !antes.closest('.screen') && !antes.closest('.hidden')
  if (vale) antes.focus()
  else el.input.focus()
}

/**
 * Escape en Ajustes: cerrar sin guardar.
 *
 * Su «Listo» no cierra y ya está: GUARDA todos los campos —la contraseña y la
 * URL del servidor incluidas— y rearranca el panel, lo que de paso cancela el
 * turno en vuelo. Con Escape mapeado a ese botón, un Escape distraído aplicaba
 * unos ajustes a medio escribir (revisión adversaria de H2, 2026-09-14).
 * `showSettingsScreen` rellena todos los campos desde `state.settings` cada vez
 * que se abre, así que lo tecleado y no guardado se pierde: eso es cerrar.
 */
function closeSettingsWithoutSaving() {
  hideScreens()
}

function connectCommand() {
  const port = portOf(state.settings.serverUrl)
  // `--print-logs --log-level INFO` hace que el servidor imprima cada llamada
  // con su metodo, ruta, estado y duracion, y los errores. Sin eso, cuando
  // algo falla del lado de opencode no hay nada que mirar.
  return `opencode serve --port ${port} --cors ${CORS_ORIGIN} --print-logs --log-level INFO`
}

function portOf(url) {
  try {
    return new URL(url).port || '4096'
  } catch {
    return '4096'
  }
}

/**
 * La pantalla de claves: un bloque por producto, cada uno con su dirección y
 * su token. En Cloud los dos comparten host, así que las dos direcciones van
 * rellenas con éste; en Server/Data Center sólo la del producto en el que
 * estás, y el otro queda sin marcar hasta que el usuario diga dónde vive.
 */
function showSetupScreen() {
  state.mcpWait?.abort()
  const site = state.site
  $('setup-host').textContent = site.host
  $('setup-dc-field').classList.toggle('hidden', !!site.cloud)
  $('setup-dc').checked = !site.cloud

  $('setup-jira').checked = !!site.cloud || site.product !== 'confluence'
  $('setup-confluence').checked = !!site.cloud || site.product !== 'jira'
  $('setup-jira-url').value = site.cloud || site.product === 'jira' ? site.origin : ''
  $('setup-confluence-url').value = site.cloud || site.product === 'confluence' ? site.origin : ''
  // Los tokens nunca se quedan en el formulario de una vez para otra.
  $('setup-jira-token').value = ''
  $('setup-confluence-token').value = ''
  paintSetupProducts()

  $('setup-status').textContent = ''
  $('setup-manual').classList.add('hidden')
  $('setup-main').classList.remove('hidden')
  showScreen('screen-setup')
}

/** Qué campos se ven: los de cada producto marcado, y el correo sólo en Cloud. */
function paintSetupProducts() {
  const dc = $('setup-dc').checked
  for (const product of PRODUCTS) {
    const on = $(`setup-${product}`).checked
    $(`setup-${product}-block`).classList.toggle('off', !on)
    $(`setup-${product}-fields`).classList.toggle('hidden', !on)
    $(`setup-${product}-email-field`).classList.toggle('hidden', dc)
  }
}

/** Cuánto tiempo dice el botón «Copiado» antes de volver a su texto. */
const COPY_FEEDBACK_MS = 1400

/**
 * El texto propio de cada botón de copiar, mientras dice «Copiado».
 *
 * Por botón y no en una variable suelta porque hay varios (el comando, la ruta,
 * el bloque de configuración, el registro, las observaciones de cada tarjeta) y
 * cada uno vuelve a lo suyo. Un WeakMap para que la entrada se vaya con el botón:
 * la tarjeta de un análisis se pinta con `createElement` y desaparece al
 * repintarse el chat.
 */
const textoDeCopiar = new WeakMap()

/**
 * Copia y lo dice en el propio botón.
 *
 * `button` puede ser el id de uno del HTML (los «Copiar» del comando, la ruta,
 * el snippet y el registro) o el botón ya creado: la tarjeta de análisis se
 * pinta con `createElement` y no tiene id, y darle uno la haría irrepetible.
 *
 * El texto de siempre se guarda UNA vez por botón: en un segundo clic dentro de
 * los 1400 ms lo que hay escrito ya es «Copiado», y guardar eso como original
 * dejaba el botón diciendo «Copiado» para siempre (límite anotado en la revisión
 * de H5). El temporizador pendiente también se cancela, o el primero restauraría
 * el texto a mitad del segundo aviso.
 *
 * @returns {Promise<boolean>} si de verdad se copió: quien llama no debe
 *          apuntar en el registro un «copiado» que no ha pasado.
 */
async function copyToClipboard(text, button) {
  const btn = typeof button === 'string' ? $(button) : button || null
  if (btn && !textoDeCopiar.has(btn)) textoDeCopiar.set(btn, { original: btn.textContent, timer: 0 })
  const marca = btn ? textoDeCopiar.get(btn) : null
  if (marca?.timer) clearTimeout(marca.timer)
  let ok = true
  try {
    await navigator.clipboard.writeText(text)
    if (btn) btn.textContent = 'Copiado'
  } catch {
    ok = false
    if (btn) btn.textContent = 'No se pudo'
  }
  if (btn) {
    marca.timer = setTimeout(() => {
      btn.textContent = marca.original
      textoDeCopiar.delete(btn)
    }, COPY_FEEDBACK_MS)
  }
  return ok
}

/**
 * ¿Lo que se va a indexar lo puede leer la extensión de la API del sitio?
 *
 * El mismo criterio con el que `restIndexFor` decide: por la API sólo se lee el
 * árbol de UN espacio de Confluence o la muestra de UN proyecto de un Jira Data
 * Center, y sólo con las lecturas REST encendidas. La pantalla de contexto lo
 * pregunta aquí para no prometer «exacto y en segundos» en un ámbito —todo el
 * sitio— que luego va por las tres fases del modelo (revisión adversaria de H9).
 */
function readsByApi(site, scope) {
  if (!state.settings.restTools || !site) return false
  if (site.product === 'confluence') return scope?.kind === 'space' && !!scope.key
  if (site.product === 'jira') return !site.cloud && scope?.kind === 'project'
  return false
}

function showContextScreen() {
  const scope = defaultScope(state.site)
  $('context-scope').textContent = scope?.label || state.site.host
  $('context-status').textContent = ''
  // Lo que se recorre no es lo mismo en un proyecto de Jira que en un espacio
  // de Confluence: en Jira no hay árbol, hay tipos, estados y nombres. Y desde
  // H9 tampoco es lo mismo con las lecturas REST encendidas que sin ellas: con
  // ellas, el árbol y la muestra los lee la extensión de la API y el modelo
  // sólo escribe la prosa. La pantalla dice lo que de verdad va a pasar.
  const porLaApi = readsByApi(state.site, scope)
  $('context-generate-text').textContent =
    state.site?.product === 'jira'
      ? (porLaApi
          ? 'Cuenta una muestra de tickets con tu sesión —tipos, estados y convenciones de nombre exactos, sin gastar tokens— y el modelo escribe con ellos el documento; además busca en Confluence si están documentadas. '
          : 'Recorre los tipos de incidencia, los estados del flujo y una muestra de tickets para sacar las convenciones de nombre; y busca en Confluence si están documentadas. ') +
        'Con tope, progreso visible y botón de cancelar.'
      : (porLaApi
          ? 'Lee el árbol del espacio de la API de Confluence con tu sesión —exacto y en segundos, sin gastar tokens— y el modelo escribe con él el documento. '
          : 'Recorre el árbol, los títulos y las etiquetas. ') + 'Con tope, progreso visible y botón de cancelar.'
  showScreen('screen-context')
}

async function showMemoryScreen() {
  $('mem-enabled').checked = !!state.settings.crossSessionMemory
  const body = $('memory-body')
  body.textContent = ''
  state.memory = await memory.getMemory(state.site?.host || '')
  for (const entry of state.memory.entries) {
    const row = document.createElement('div')
    row.style.marginBottom = '12px'
    const when = document.createElement('div')
    when.className = 'fine'
    when.textContent = new Date(entry.at).toLocaleString()
    const text = document.createElement('div')
    text.textContent = entry.text
    const drop = document.createElement('button')
    drop.className = 'ghost small'
    drop.type = 'button'
    drop.textContent = 'Borrar'
    drop.style.marginTop = '4px'
    drop.addEventListener('click', async () => {
      state.memory = await memory.removeEntry(state.site.host, entry.at)
      showMemoryScreen()
    })
    row.append(when, text, drop)
    body.appendChild(row)
  }
  showScreen('screen-memory')
}

/**
 * Pantalla de registro: qué le hemos pedido a opencode y qué contestó.
 * Se refresca sola mientras esté abierta.
 */
function showLogScreen() {
  paintLog()
  paintState()
  state.logUnsub?.()
  state.logUnsub = log.subscribe((entry) => {
    if ($('screen-log').classList.contains('hidden')) return
    // Una línea nueva se mete arriba y nada más se toca (H6 P8): repintar las
    // 200 filas por cada línea es lo que hacía que, con el Registro abierto
    // durante un turno con herramientas, la pantalla fuera dando tirones.
    // `log.clear()` avisa SIN entrada, y eso sí es un repintado: la lista se
    // queda vacía.
    if (entry) appendLogRow(entry)
    else paintLog()
  })
  showScreen('screen-log')
}

/** Cuántas líneas del registro se enseñan, la más nueva arriba. */
const LOG_ROWS = 200

function paintLog() {
  const box = $('log-body')
  box.textContent = ''
  const entries = state.logOnlyProblems ? log.filter('warn') : log.entries
  for (const e of entries.slice(-LOG_ROWS).reverse()) box.appendChild(logRow(e))
  $('btn-log-all').classList.toggle('on', !state.logOnlyProblems)
  $('btn-log-problems').classList.toggle('on', !!state.logOnlyProblems)
}

/**
 * Una entrada nueva, arriba, sin reconstruir la lista.
 *
 * El filtro se aplica aquí igual que en `paintLog` —y con la misma tabla de
 * niveles, `LEVELS` de log.js, para que «sólo problemas» signifique lo mismo en
 * los dos sitios— y la lista se recorta por abajo de DOS maneras: por el tope
 * de filas de la pantalla y por las entradas que el registro ya ha olvidado.
 *
 * La segunda hacía falta: el tope de 200 filas no se dispara nunca con «sólo
 * problemas» puesto —unos pocos avisos entre seiscientas entradas siguen siendo
 * unas pocas filas—, mientras el Logger sí va tirando las viejas por delante
 * (su tope son 400). A partir de ahí la pantalla enseñaba líneas que
 * `paintLog()` ya no pintaría (revisión adversaria de H6). Por eso cada fila
 * lleva el id de su entrada: los ids crecen y no se reutilizan, así que la de
 * abajo —la más vieja— sobra en cuanto su id queda por detrás del primero que
 * el registro conserva.
 */
function appendLogRow(e) {
  const box = $('log-body')
  // La poda por entrada olvidada va PRIMERO y sin mirar el filtro: con «sólo
  // problemas» puesto, una entrada que no se pinta empuja igual el tope del
  // registro, y si sólo se podara al pintar la lista se quedaría atrás hasta el
  // siguiente aviso.
  const vivas = log.oldestId
  while (box.lastElementChild && Number(box.lastElementChild.dataset.id) < vivas) box.lastElementChild.remove()
  if (state.logOnlyProblems && (LEVELS[e.level] ?? 0) < LEVELS.warn) return
  box.prepend(logRow(e))
  while (box.childElementCount > LOG_ROWS) box.lastElementChild.remove()
}

/** Una línea del registro: la hora, el título y su detalle. */
function logRow(e) {
  const row = document.createElement('div')
  row.className = 'logrow ' + e.level
  // Qué entrada es: lo mira `appendLogRow` para quitar las filas cuya entrada
  // el registro ya ha olvidado. Un número, nunca texto del modelo.
  row.dataset.id = e.id

  const t = document.createElement('span')
  t.className = 't'
  t.textContent = clockTime(e.at)

  const m = document.createElement('span')
  m.className = 'm'
  m.textContent = e.message
  if (e.detail) {
    const d = document.createElement('span')
    d.className = 'd'
    d.textContent = ' — ' + e.detail
    m.appendChild(d)
  }

  row.append(t, m)
  return row
}

/** Estado actual, en crudo: sirve para pegarlo cuando algo va mal. */
async function paintState() {
  const box = $('log-state')
  box.textContent = ''
  const add = (k, v, kind) => {
    const row = document.createElement('div')
    row.className = 'state-row'
    const kk = document.createElement('span')
    kk.className = 'k'
    kk.textContent = k
    const vv = document.createElement('span')
    vv.className = 'v' + (kind ? ' ' + kind : '')
    vv.textContent = v
    row.append(kk, vv)
    box.appendChild(row)
  }

  add('servidor', state.settings.serverUrl, state.client?.connected ? 'ok' : 'bad')
  add('sitio', state.site ? `${state.site.host} · ${state.site.product}${state.site.cloud ? ' · cloud' : ' · data center'}` : '(ninguno)')
  add('página', state.site?.pageId || state.site?.issueKey || '(ninguna)')
  add('modelo', state.model ? modelKey(state.model) : '(ninguno)')
  add('sesión', state.sessionID || '(sin sesión)')
  add('índice', state.index ? `${indexSize(state.index)} entradas` : '(sin índice)')
  add('contexto', state.contextMd ? `${state.contextMd.length} caracteres` : '(sin contexto)')
  if (state.linkedContext) add('Confluence enlazado', `${state.linkedContext.host} · ${state.linkedContext.contextMd.length} caracteres`)
  add('memoria', state.settings.crossSessionMemory ? `activa · ${state.memory?.entries?.length || 0} entradas` : 'desactivada')

  // El diario local y lo que se ha sacado de él (H11). Cuentas y motivos, nunca
  // títulos ni ids: esta pantalla se mira con el panel abierto delante de otra
  // gente, y el diario es del usuario (§8.20).
  const diario = state.site ? await getActivity(state.site.host).catch(() => null) : null
  const cuentas = activityCounts(diario)
  add(
    'actividad',
    todayEnabled()
      ? `${cuentas.entradas} entradas · ${cuentas.analisis} análisis · ${cuentas.base} páginas base · ${cuentas.descartes} descartes`
      : '(apagada)'
  )
  add(
    'sugerencias',
    !todayEnabled()
      ? '(apagadas)'
      : state.today.fetchedAt
        ? `${todaySummary({ items: todayRows(), errors: state.today.errors })} · leídas a las ${clockTime(state.today.fetchedAt)}`
        : '(sin leer)'
  )

  // Lo que tardó lo último que hizo el panel (H3): pegado aquí, un «va lento»
  // deja de ser una impresión. Se miden en `bootForSite` y en `send()`.
  add('tiempos (arranque)', state.timing.boot || '(sin medir)')
  add('tiempos (último turno)', state.timing.turn || '(sin medir)')

  // Y cuánto de la cuota de chrome.storage.local llevamos gastada: el índice de
  // un sitio grande, su contexto y su memoria caben de sobra, pero nadie lo veía
  // hasta que `storage.set` empezara a fallar. Se avisa a partir de 8 MB, con
  // margen para que quepa un índice más.
  try {
    const bytes = await chrome.storage.local.getBytesInUse(null)
    const cuota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024
    // En la misma unidad que la cuota en cuanto pasa de 1 MB: en KB («8598 KB de
    // 10 MB») no se ve de un vistazo cuánto queda, y el espejo del panel ya lo
    // enseñaba en MB.
    add(
      'almacenamiento',
      `${formatBytes(bytes)} de ${Math.round(cuota / (1024 * 1024))} MB`,
      bytes > 8 * 1024 * 1024 ? 'bad' : ''
    )
  } catch (err) {
    add('almacenamiento', 'no se pudo medir: ' + err.message)
  }

  if (state.client && state.site) {
    try {
      const [list, config] = await Promise.all([state.client.listMcp(), state.client.config().catch(() => null)])
      const s = mcpStatusFor(list, state.site.host, chosenMcpName(config, await getSite(state.site.host), state.site.host, { status: list }))
      add('MCP', s.present ? `${s.name} · ${s.status}` : '(no registrado)', s.connected ? 'ok' : 'bad')
    } catch (err) {
      add('MCP', 'no se pudo consultar: ' + err.message, 'bad')
    }
  }
}

/**
 * Diagnóstico del árbol: qué estructura ve Faro en ESTA barra lateral.
 *
 * La navegación guiada depende del DOM de Atlassian, que cambia sin avisar y no
 * es igual en Cloud que en Data Center. Cuando no despliega, esto dice con qué
 * se ha encontrado, para poder ajustar los selectores con datos y no a ojo.
 */
async function treeDebug() {
  const status = $('settings-status')

  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    status.textContent = 'Necesito permiso sobre este dominio para leer su barra lateral.'
    return
  }

  const r = await chrome.tabs.sendMessage(state.tabId, { type: MSG.TREE_DEBUG }).catch(() => null)
  if (!r?.ok || !r.report) {
    status.textContent = 'No he podido leer la barra lateral de esta pestaña.'
    return
  }

  log.info('Diagnóstico del árbol', state.site?.host || '')
  // Cada línea como «debug»: así el filtro «Solo problemas» no se llena de esto.
  for (const linea of r.report.split('\n')) log.debug(linea || ' ')

  await copyToClipboard(r.report, 'btn-tree-debug')
  status.textContent = 'Copiado al portapapeles y volcado al Registro.'
}

async function showSettingsScreen() {
  $('set-nav-guided').checked = state.settings.navMode !== 'quick'
  $('set-nav-quick').checked = state.settings.navMode === 'quick'
  $('set-motion').checked = state.settings.reduceMotion
  $('set-hl-marker').checked = state.settings.highlightStyle === 'marker'
  $('set-hl-spotlight').checked = state.settings.highlightStyle !== 'marker'
  $('set-delay').value = state.settings.stepDelayMs
  $('delay-value').textContent = state.settings.stepDelayMs
  $('set-rest-tools').checked = state.settings.restTools
  $('set-today').checked = state.settings.todaySuggestions
  paintTodaySetting()
  $('set-url').value = state.settings.serverUrl
  $('set-pass').value = state.settings.password
  $('settings-status').textContent = ''
  $('settings-site-info').textContent = state.site
    ? `${state.site.host} · ${state.index ? indexSize(state.index) + ' entradas indexadas' : 'sin índice'} · ${state.contextMd ? 'con contexto' : 'sin contexto'}`
    : 'sin sitio'
  showScreen('screen-settings')
  // La pantalla se abre YA y la lista se rellena detrás: son dos lecturas del
  // almacén y abrir Ajustes no tiene por qué esperarlas.
  await paintPrivacy()
}

/** Cuántos de los OTROS sitios con datos se nombran antes de contar el resto. */
const OTHER_HOSTS_SHOWN = 4

/**
 * «Qué guarda Faro de mí»: una fila por cosa guardada de ESTE sitio, con su
 * medida y sin una línea de su contenido (H13).
 *
 * Por qué existe: lo que Faro guarda estaba repartido entre tres pantallas —el
 * Registro decía el índice y el contexto, la de Memoria los resúmenes, la de
 * páginas base las elegidas— y de dos cosas (el perfil del proyecto y el
 * historial de análisis) no hablaba ninguna. La promesa de §8.20 es que lo que
 * Faro apunta del usuario «se ve y se borra»; esto es el «se ve», y el botón de
 * abajo el «se borra».
 *
 * Se lee del ALMACÉN, no de `state`: la pregunta es «qué GUARDA Faro», y el panel
 * puede tener en memoria un índice que todavía no ha escrito (`state.indexDirty`,
 * P3) o haberse quedado con lo de antes de un borrado. Leerlo de disco es además
 * lo que hace que la pantalla se compruebe a sí misma: tras «Olvidar este sitio»
 * todo lo de ese sitio dice «(nada)» (el espacio usado sigue con su número: cuenta
 * el almacén entero). Son dos lecturas: el paquete del sitio —que
 * trae de una vez el índice, el contexto, la memoria, el perfil, el historial y
 * el diario— y el mapa de sitios, para la línea de los OTROS hosts con datos
 * (`getSiteBundle` lee ese mapa y se queda sólo con este host, porque sus claves
 * son exactas: §6).
 *
 * Cuentas y medidas, nunca contenido: ni un título de página, ni una clave de
 * incidencia, ni una línea del contexto. Es la misma regla que el Registro
 * (§8.20): esta pantalla se mira con el panel abierto delante de otra gente. La
 * única excepción es la CLAVE DEL PROYECTO del perfil, a propósito: se guarda uno
 * por host y un Jira tiene muchos proyectos, así que sin ella no se sabe de cuál
 * es lo guardado (revisión adversaria de H9) y además ya está en la cabecera. Y
 * nada de esto entra en ningún prompt.
 *
 * El sitio es el de la PESTAÑA (`state.site`), como en `settings-site-info` y en
 * el Registro, y no el último que el panel recuerde: el botón de abajo también lo
 * es, así que enseñar la lista de un host que ese botón no puede borrar sería
 * ofrecer un borrado que no va a pasar.
 */
async function paintPrivacy() {
  const box = $('privacy-list')
  const otros = $('privacy-others')
  box.textContent = ''
  otros.classList.add('hidden')
  const add = (k, v) => {
    const row = document.createElement('li')
    const kk = document.createElement('span')
    kk.className = 'k'
    kk.textContent = k
    const vv = document.createElement('span')
    vv.className = 'v'
    vv.textContent = v
    row.append(kk, vv)
    box.appendChild(row)
  }

  const host = state.site?.host || ''
  if (!host) {
    add('este sitio', 'no estás en Jira ni en Confluence')
    return
  }

  let bundle = null
  let sitios = {}
  try {
    ;[bundle, sitios] = await Promise.all([getSiteBundle(host), getSites()])
  } catch (err) {
    // La contraparte visible de §8.14 va en la propia lista: si no se pudo leer,
    // lo peor sería una lista vacía que parecería «no guardo nada de ti».
    add('lo guardado', 'no se pudo leer: ' + err.message)
    return
  }
  // §8.22: el host se captura al pedir y se comprueba al volver. Entre las dos
  // cosas la pestaña puede haberse ido a otro sitio, y entonces estas cuentas
  // serían de un host que ya no es el de la cabecera.
  if (state.site?.host !== host) return

  const paginas = Object.keys(bundle.index?.pages || {}).length
  const incidencias = Object.keys(bundle.index?.issues || {}).length
  add('índice de navegación', bundle.index ? `${paginas} páginas · ${incidencias} incidencias` : '(nada)')
  add('contexto del sitio', bundle.contextMd ? `${bundle.contextMd.length} caracteres` : '(nada)')

  const resumenes = memory.normalizeMemory(bundle.memoryRaw).entries.length
  // Apagar la memoria no borra lo que ya hay: la pregunta de esta pantalla es
  // «qué GUARDA Faro», y contestar «(desactivada)» con doce resúmenes en disco era
  // contestar a otra cosa (revisión adversaria de H13). Primero lo que hay; que
  // está apagada se dice detrás, y sin nada guardado es «(nada)», esté como esté.
  add(
    'memoria entre sesiones',
    resumenes ? `${resumenes} resúmenes${state.settings.crossSessionMemory ? '' : ' · desactivada'}` : '(nada)'
  )

  // El perfil se guarda por HOST y un Jira tiene muchos proyectos, así que se
  // dice de CUÁL es: el de otro proyecto no es el que entra en el prompt de aquí
  // (revisión adversaria de H9), y verlo con su clave es lo que lo explica.
  const perfil = normalizeProfile(bundle.extras?.profile)
  add(
    'perfil del proyecto',
    perfil ? `${perfil.projectKey} · muestra de ${perfil.sampled} · ${hace(perfil.at)}` : '(nada)'
  )

  const analisis = normalizeHistory(bundle.extras?.sourceHistory, { host }).entries.length
  add('historial de páginas base', analisis ? `${analisis} análisis` : '(nada)')

  const cuentas = activityCounts(pruneActivity(bundle.extras?.activity, { host }))
  add(
    'diario de actividad',
    cuentas.entradas || cuentas.descartes
      ? `${cuentas.entradas} entradas · ${cuentas.descartes} descartes${todayEnabled() ? '' : ' · apagado'}`
      : '(nada)'
  )

  // Estas dos viven dentro del registro del sitio, no en una clave propia, así
  // que salen del paquete igual que las de arriba.
  const consultas = normalizeRecentJql(bundle.site?.recentJql).length
  add('últimas búsquedas', consultas ? `${consultas} consultas` : '(nada)')
  const elegidas = normalizeSources(bundle.site?.analysisSources, { host }).pages.length
  add('páginas base elegidas', elegidas ? `${elegidas} páginas` : '(nada)')

  try {
    const bytes = await chrome.storage.local.getBytesInUse(null)
    const cuota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024
    add('espacio usado', `${formatBytes(bytes)} de ${Math.round(cuota / (1024 * 1024))} MB · todos los sitios`)
  } catch (err) {
    add('espacio usado', 'no se pudo medir: ' + err.message)
  }

  // Y los OTROS hosts de los que Faro tiene algo guardado. Sin botones a
  // propósito: borrar otro sitio se hace desde ese sitio, que es donde se ve qué
  // se va a perder. Los hosts son los que el propio usuario configuró aquí. Se
  // nombran unos pocos y se cuenta el resto: a 320 px una lista de veinte hosts
  // es una pantalla entera de texto que nadie lee.
  const demas = Object.keys(sitios)
    .filter((h) => h && h !== host)
    .sort()
  if (demas.length) {
    const nombra = demas.slice(0, OTHER_HOSTS_SHOWN)
    const resto = demas.length - nombra.length
    otros.textContent =
      `Otros sitios con datos guardados: ${nombra.join(', ')}${resto ? ` y ${resto} más` : ''}. ` +
      'Para borrar uno, ábrelo y usa su «Olvidar este sitio».'
    otros.classList.remove('hidden')
  }
}

/**
 * Cuánto hace que se contó algo, en palabras y por TIEMPO TRANSCURRIDO, como el
 * porqué de «qué mirar hoy»: un nombre de día depende de la zona horaria.
 *
 * Sin un instante utilizable no se inventa ninguno («sin fecha»), por lo mismo
 * que `memoryToPrompt` no imprime una fecha que no tiene: `normalizeProfile` deja
 * `at` en 0 cuando lo guardado no valía, y eso saldría como «hace 20 700 días».
 */
function hace(at) {
  if (!Number.isFinite(at) || at <= 0) return 'sin fecha'
  const dias = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000))
  if (dias <= 0) return 'contado hoy'
  if (dias === 1) return 'contado ayer'
  return `contado hace ${dias} días`
}

// ------------------------------------------------------------------ acción

/**
 * Cómo está opencode: el faro de la cabecera lo dibuja, su `title` lo cuenta y
 * `#status-text` (sr-only) lo dice al lector de pantalla.
 *
 * El texto ya no tiene hueco propio —la cabecera lo necesitaba para las
 * acciones—, pero no se pierde: mientras dura un turno o un recorrido (`busy`)
 * se enseña en el chip de ubicación, que es donde el usuario ya está mirando, y
 * al acabar el chip vuelve a decir dónde está (decisión 4 de docs/PLAN.md §3.4).
 * Un `bad` no se queda ahí a propósito: taparía la ubicación durante horas, y de
 * eso ya avisan el faro en rojo, su tooltip y la pantalla de conexión.
 */
function setStatus(kind, text) {
  el.statusDot.className = 'beacon ' + kind
  el.statusDot.title = `opencode: ${text}`
  el.statusText.textContent = text
  state.statusLine = kind === 'busy' ? text : ''
  paintLocation(state.site, state.tabTitle)
}

/**
 * El chip de la cabecera: la clave de dónde estás y el título de la pestaña.
 *
 * Las dos piezas las decide `locationParts` (site.js, pura y probada), que
 * reconstruye la clave con las validadoras: lo que se pinta aquí sale de la URL
 * de una pestaña y del título que escribió quien creara la página. El título es
 * lo que cede con elipsis al estrecharse el panel; la clave, no (A6).
 */
function paintLocation(site, tabTitle = '') {
  const { key, title } = locationParts(site, tabTitle)
  el.locationKey.textContent = key
  el.locationKey.classList.toggle('hidden', !key)
  el.locationTitle.textContent = state.statusLine || title
  // El tooltip dice la ubicación ENTERA, con lo que la clave corta deja fuera
  // (el id de la página) y sin recortar el título.
  el.locationChip.title = site ? [describeLocation(site), title].filter(Boolean).join(' · ') : 'Fuera de Atlassian'
}

function setStreaming(on) {
  state.streaming = on
  el.send.classList.toggle('hidden', on)
  el.stop.classList.toggle('hidden', !on)
  el.input.disabled = false
  // El modo se decide al mandar: cambiarlo a mitad de turno dejaría lo que
  // viene después —marcar, ofrecer llevarte— hablando de otro modo.
  el.skill.disabled = on
  // Ni sesión nueva encima de un turno en vuelo: primero Parar (C4).
  $('btn-new-session').disabled = on
  // Y lo mismo los botones que cuelgan del chat y piden el turno parado (el
  // «Sesión nueva» del aviso de conversación pesada, «Ver toda la
  // conversación»): nacen desactivados dentro del turno que los pintó y vuelven
  // aquí, con el de la cabecera.
  for (const b of el.chat.querySelectorAll('.' + NEEDS_IDLE)) b.disabled = on
  // Y los de «Qué mirar hoy», que viven en SU pantalla y no en el chat: el
  // «Analizar» de una fila fija la Skill y escribe en el cuadro, que es
  // exactamente lo que no puede pasar a mitad de turno. Sin esta segunda
  // pasada nacerían desactivados y ahí se quedarían, porque la de arriba sólo
  // recorre el chat.
  for (const b of $('screen-today').querySelectorAll('.' + NEEDS_IDLE)) b.disabled = on
  // El lector de pantalla: mientras llega la respuesta a trozos, el chat está
  // «ocupado»; lo que hay que decir se dice una vez al final (A2).
  el.chat.setAttribute('aria-busy', on ? 'true' : 'false')
  setStatus(on ? 'busy' : state.client?.connected ? 'ok' : 'bad', on ? 'pensando…' : state.client?.connected ? 'conectado' : 'sin conexión')
}

/**
 * El velo «Trabajando…».
 *
 * Tapa el panel, así que también lo apaga: `hideScreens()` acaba de meter el
 * foco en el cuadro justo antes de que esto lo tape, y sin `inert` se seguía
 * tabulando por lo de debajo —y mandando turnos a ciegas— con el velo puesto.
 * Y sólo enseña su Cancelar si hay algo que cancelar: el de «Guardando lo
 * aprendido» no cancelaba nada (revisión adversaria de H2, 2026-09-14).
 *
 * @param {{abort?: AbortController|null}} opts qué cancela el botón.
 */
function showBusy(title, text, { abort = null } = {}) {
  el.busyTitle.textContent = title
  el.busyText.textContent = text || ''
  state.busyAbort = abort
  const cancelar = $('btn-busy-cancel')
  cancelar.hidden = !abort
  el.busy.classList.remove('hidden')
  if (!state.focusBefore) state.focusBefore = document.activeElement
  el.app.inert = true
  if (abort) cancelar.focus()
}

function hideBusy() {
  const estaba = !el.busy.classList.contains('hidden')
  el.busy.classList.add('hidden')
  state.busyAbort = null
  // Quitar un velo que no estaba puesto no devuelve ningún foco: a `hideBusy`
  // se llama por si acaso desde varios sitios (buildClient, el catch del
  // indexado) y no puede robarle el foco a nadie.
  if (!estaba) return
  // Si hay una pantalla abierta, su `inert` y su foco mandan: el velo se
  // levantó encima de ella y no puede devolver nada.
  if (document.querySelector('.screen:not(.hidden)')) return
  el.app.inert = false
  devolverFoco()
}

function autoGrow() {
  el.input.style.height = 'auto'
  el.input.style.height = Math.min(160, el.input.scrollHeight) + 'px'
}

function applySettingsToUi() {
  // La memoria entre sesiones se enciende y se apaga en SU pantalla; en la
  // cabecera sólo se ve si está activa, en el botón que la abre. Antes había
  // además una pastilla en el redactor que hacía las dos cosas: dos controles
  // para un ajuste, y el que se veía siempre era el que ocupaba la fila donde
  // se escribe.
  // El estado NO puede vivir sólo en la clase `.on` y en el `title`: el botón
  // lleva `aria-label`, que tapa al `title`, así que un lector de pantalla oía
  // «Memoria» encendida y apagada (regresión de H5, que se llevó la pastilla
  // «Memoria activa» donde antes se leía). No es `aria-pressed`: este botón
  // ABRE la pantalla, no conmuta el ajuste. Lo que cambia es su NOMBRE.
  const boton = $('btn-memory')
  const nombre = state.settings.crossSessionMemory
    ? 'Memoria entre sesiones: activa'
    : 'Memoria entre sesiones: desactivada'
  boton.classList.toggle('on', !!state.settings.crossSessionMemory)
  boton.title = nombre
  boton.setAttribute('aria-label', nombre)
  // «Reducir animaciones» se leía y se guardaba desde H0, pero sólo lo aplicaba
  // el overlay sobre la página: el panel seguía deslizando burbujas y latiendo
  // (auditoría del 2026-09-13, docs/PLAN.md §2, A9). La clase es la misma que
  // usa el overlay, y el CSS le cuelga lo mismo que a prefers-reduced-motion.
  document.documentElement.classList.toggle('faro-still', !!state.settings.reduceMotion)
  // Y si el chat vacío está delante, sus chips siguen al interruptor de las
  // lecturas REST: apagarlo dejaba unos botones que ya no harían nada, y
  // encenderlo obligaba a cambiar de sitio para verlos.
  const chips = el.chat.querySelector('.empty .search-chips')
  if (chips) {
    paintSearchChips(chips)
    loadSearchChipSources(chips).catch(() => {})
  }
  // Y «Qué mirar hoy», que cuelga de los mismos interruptores: apagarlos tiene
  // que llevarse la insignia y el bloque del chat vacío en el acto, y no al
  // cambiar de sitio. Lo que ya se leyó sigue en `state.today` por si se vuelve
  // a encender; lo que no se hace es enseñarlo.
  paintTodayUi()
}

// ------------------------------------------------------------------ eventos

function wireEvents() {
  el.input.addEventListener('input', autoGrow)
  el.input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      send()
    }
  })

  // ¿Está el usuario pegado al fondo del chat? Se mide en cada scroll —el
  // suyo y el del propio panel—, ANTES de que el siguiente trozo de respuesta
  // mueva nada: es lo que decide si se le sigue al final (A7).
  el.chat.addEventListener('scroll', () => {
    state.chatPinned = stuckToBottom(el.chat)
  })

  // Escape, desde cualquier sitio del panel: primero el velo «Trabajando…»
  // (su Cancelar, si es que cancela algo), luego la pantalla abierta. Ajustes
  // se cierra SIN pulsar su «Listo», que guarda y rearranca; las demás de
  // consulta, por su botón. Las de conexión, claves y contexto no: cerrarlas
  // es decidir algo (A3).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return
    if (!el.busy.classList.contains('hidden')) {
      // Un velo sin abortador (resumir la sesión) no se va con Escape: su
      // botón está oculto justamente porque no hay nada que cancelar.
      if ($('btn-busy-cancel').hidden) return
      ev.preventDefault()
      $('btn-busy-cancel').click()
      return
    }
    const abierta = document.querySelector('.screen:not(.hidden)')
    if (!abierta) return
    if (ESCAPE_DISMISSES.includes(abierta.id)) {
      ev.preventDefault()
      closeSettingsWithoutSaving()
      return
    }
    const btn = ESCAPE_CLOSES[abierta.id]
    if (!btn) return
    ev.preventDefault()
    $(btn).click()
  })
  el.send.addEventListener('click', send)
  el.stop.addEventListener('click', async () => {
    state.turnAbort?.abort()
    if (state.sessionID) await state.client?.abort(state.sessionID).catch(() => {})
    log.info('Turno cancelado por el usuario')
    setStreaming(false)
  })

  el.model.addEventListener('change', async () => {
    const parsed = parseModelKey(el.model.value)
    if (!parsed) return
    state.model = parsed
    log.info('Modelo cambiado', modelKey(parsed))
    if (state.site) await saveSite(state.site.host, { model: state.model })
  })

  el.skill.addEventListener('change', async () => {
    setSkill(el.skill.value)
    log.info('Skill', skillById(state.skill).label)
    if (state.site) await saveSite(state.site.host, { skill: state.skill })
  })

  el.pick.addEventListener('click', () => togglePick().catch(console.error))
  $('btn-pick-clear').addEventListener('click', () => clearPick())

  // --- páginas base del análisis
  el.sources.addEventListener('click', () => showSourcesScreen().catch(console.error))
  el.sourcesChip.addEventListener('click', () => showSourcesScreen().catch(console.error))
  $('sources-query').addEventListener('input', onSourcesInput)
  $('sources-query').addEventListener('keydown', onSourcesKeydown)
  $('sources-mode-exclusive').addEventListener('change', () => setSourcesMode('exclusive').catch(console.error))
  $('sources-mode-open').addEventListener('change', () => setSourcesMode('open').catch(console.error))
  $('btn-sources-close').addEventListener('click', () => closeSourcesScreen())
  $('btn-sources-clear').addEventListener('click', async () => {
    state.sources = { ...state.sources, pages: [] }
    await saveSite(state.site.host, { analysisSources: state.sources })
    log.info('Páginas base quitadas', 'el alcance se queda como estaba')
    paintSourceList()
    paintSourcesUi()
    setSourcesStatus('')
  })
  $('btn-sources-add-suggested').addEventListener('click', () => addSuggested().catch(console.error))
  $('btn-sources-forget').addEventListener('click', () => forgetSourceHistory().catch(console.error))
  $('btn-sources-permission').addEventListener('click', async () => {
    const btn = $('btn-sources-permission')
    btn.disabled = true
    // El del Confluence enlazado si es a él a quien hay que preguntar.
    const target = sourcesTarget()
    const r = await requestSourcesPermission()
    btn.disabled = false
    if (r.ok) {
      $('sources-perm').classList.add('hidden')
      setSourcesStatus(`Listo. Ya puedo buscar en ${target?.via === 'linked' ? target.site.host : 'Confluence'}.`)
      onSourcesInput()
    } else {
      setSourcesStatus(
        r.denied
          ? manualPermissionText(target?.via === 'linked' ? target.site.origin : '')
          : 'Permiso dado, pero no he podido inyectarme: ' + r.error
      )
    }
  })

  // --- qué mirar hoy
  $('btn-today').addEventListener('click', () => showTodayScreen().catch(console.error))
  $('btn-today-close').addEventListener('click', () => hideScreens())
  $('btn-today-refresh').addEventListener('click', () => refreshToday().catch(console.error))
  $('btn-today-forget').addEventListener('click', () => forgetTodayActivity().catch(console.error))
  $('today-off').addEventListener('change', () => setTodayOff($('today-off').checked).catch(console.error))
  $('btn-today-permission').addEventListener('click', () => askTodayPermission().catch(console.error))

  $('btn-new-session').addEventListener('click', newSession)
  $('btn-memory').addEventListener('click', () => showMemoryScreen())
  $('btn-settings').addEventListener('click', () => showSettingsScreen())
  $('btn-log').addEventListener('click', () => showLogScreen())

  // --- registro
  $('btn-log-all').addEventListener('click', () => { state.logOnlyProblems = false; paintLog() })
  $('btn-log-problems').addEventListener('click', () => { state.logOnlyProblems = true; paintLog() })
  $('btn-log-copy').addEventListener('click', () => copyToClipboard(log.toText(), 'btn-log-copy'))
  $('btn-log-clear').addEventListener('click', () => { log.clear(); paintLog() })
  $('btn-log-refresh').addEventListener('click', () => paintState())
  $('btn-log-close').addEventListener('click', () => {
    state.logUnsub?.()
    state.logUnsub = null
    hideScreens()
  })

  // --- pantalla de conexión
  $('btn-retry').addEventListener('click', async () => {
    state.settings = await saveSettings({
      serverUrl: $('server-url').value.trim() || DEFAULT_SETTINGS.serverUrl,
      password: $('server-pass').value,
    })
    await bootForSite()
  })
  $('btn-copy-cmd').addEventListener('click', () => copyToClipboard(connectCommand(), 'btn-copy-cmd'))

  // --- pantalla de claves
  $('btn-setup-save').addEventListener('click', saveKeys)
  for (const id of ['setup-jira', 'setup-confluence', 'setup-dc']) {
    $(id).addEventListener('change', paintSetupProducts)
  }
  $('btn-setup-skip').addEventListener('click', async () => {
    hideScreens()
    await saveSite(state.site.host, { onboarded: true, skippedKeys: true })
    // Con las claves saltadas el arranque ya no se para en esta pantalla:
    // carga el índice, el contexto y la sesión de ESTE sitio. Sin esto se
    // seguía trabajando con los del sitio anterior.
    await bootForSite()
    showNotice('Sin claves configuradas: puedo charlar, pero no consultar Jira ni Confluence.')
  })
  $('link-token').addEventListener('click', () => openUrl('https://id.atlassian.com/manage-profile/security/api-tokens'))

  // --- paso manual del MCP
  $('btn-snippet-full').addEventListener('click', () => {
    if (state.snippets) state.snippets.mode = 'full'
    paintSnippet()
  })
  $('btn-snippet-block').addEventListener('click', () => {
    if (state.snippets) state.snippets.mode = 'block'
    paintSnippet()
  })
  $('btn-copy-snippet').addEventListener('click', () => copyToClipboard($('setup-snippet').textContent, 'btn-copy-snippet'))
  $('btn-copy-path').addEventListener('click', () => copyToClipboard($('setup-config-path').textContent, 'btn-copy-path'))
  $('btn-setup-back').addEventListener('click', () => {
    state.mcpWait?.abort()
    $('setup-manual').classList.add('hidden')
    $('setup-main').classList.remove('hidden')
    // La flecha con la que se vuelve está DENTRO de la parte que se acaba de
    // esconder, así que el foco se quedaría en el aire (en el <body>): va al
    // título de la parte que aparece, como hace `showScreen` al abrir.
    const titulo = $('setup-title')
    titulo.tabIndex = -1
    titulo.focus()
  })
  $('btn-setup-later').addEventListener('click', async () => {
    state.mcpWait?.abort()
    hideScreens()
    await saveSite(state.site.host, { onboarded: true, skippedKeys: true })
    await bootForSite()
    showNotice('Sin MCP conectado: puedo charlar, pero no consultar Jira ni Confluence.')
  })

  // --- pantalla de contexto
  // Envuelto a propósito: pasar el manejador directo colaría el objeto Event
  // como opciones de generateContext.
  $('choice-generate').addEventListener('click', () => generateContext())
  $('choice-upload').addEventListener('click', () => $('context-file').click())
  $('choice-skip').addEventListener('click', async () => {
    await saveSite(state.site.host, { onboarded: true })
    // Y el arranque que siga en marcha deja de mandar: decide la pantalla de
    // contexto con el `onboarded` que leyó al EMPEZAR (P4) y el `GET /mcp` en
    // frío tarda segundos, así que un arranque lento volvía a enseñar la
    // pantalla recién saltada. Un testigo nuevo lo apaga en su siguiente await;
    // rearrancar también, pero pintaría el chat dos veces.
    state.bootToken = {}
    hideScreens()
    await restoreConversation()
  })
  $('context-file').addEventListener('change', uploadContext)
  for (const id of ['choice-generate', 'choice-upload', 'choice-skip']) {
    $(id).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        $(id).click()
      }
    })
  }

  // --- ajustes
  $('set-delay').addEventListener('input', () => ($('delay-value').textContent = $('set-delay').value))
  // La casilla de «Qué mirar hoy» cuelga de la de las lecturas REST: en cuanto
  // se apaga la de arriba, ésta se desactiva y dice por qué, sin esperar a que
  // se guarde nada.
  $('set-rest-tools').addEventListener('change', paintTodaySetting)
  $('btn-settings-close').addEventListener('click', async () => {
    const antes = state.settings
    state.settings = await saveSettings({
      navMode: $('set-nav-quick').checked ? 'quick' : 'guided',
      reduceMotion: $('set-motion').checked,
      highlightStyle: $('set-hl-marker').checked ? 'marker' : 'spotlight',
      stepDelayMs: Number($('set-delay').value),
      // El interruptor de las lecturas REST no toca al cliente de opencode, así
      // que se aplica en caliente como el resto: la próxima tarjeta de búsqueda
      // ya lee la lista, o deja de leerla, sin rearrancar nada.
      restTools: $('set-rest-tools').checked,
      // Cuelga del de arriba y se guarda igual: desactivada, la casilla conserva
      // lo que el usuario eligió, así que apagar y volver a encender las
      // lecturas REST no le cambia esta preferencia por detrás.
      todaySuggestions: $('set-today').checked,
      serverUrl: $('set-url').value.trim() || DEFAULT_SETTINGS.serverUrl,
      password: $('set-pass').value,
    })
    // Rearrancar es tirar el cliente —lo que CANCELA el turno en vuelo (C1)— y
    // volver a descargar la conversación entera. Eso sólo hace falta si cambió
    // con quién se habla: la dirección del servidor o la contraseña. Lo demás
    // (el modo de navegación, la pausa entre pasos, el subrayado, «Reducir
    // animaciones») se aplica en caliente: la UI del panel aquí mismo, y la
    // página por el service worker, que ve el cambio de `faro:settings` con
    // `chrome.storage.onChanged` y le empuja los ajustes. Hasta H6, cerrar
    // Ajustes a mitad de respuesta mataba el turno (pendiente de §4.4).
    const clientChanged = state.settings.serverUrl !== antes.serverUrl || state.settings.password !== antes.password
    applySettingsToUi()
    hideScreens()
    if (clientChanged) {
      await bootForSite()
      return
    }
    log.info('Ajustes aplicados', 'sin rearrancar: el servidor y la contraseña no han cambiado')
  })
  $('btn-reindex').addEventListener('click', async () => {
    hideScreens()
    await generateContext()
  })
  $('btn-edit-keys').addEventListener('click', () => showSetupScreen())
  $('btn-tree-debug').addEventListener('click', () => treeDebug().catch(console.error))
  $('btn-forget').addEventListener('click', async () => {
    if (!state.site) return
    const host = state.site.host
    // TODO lo guardado de este host, en una sola llamada: el registro del sitio,
    // el índice, el contexto, la memoria, el perfil, el historial de páginas
    // base, el diario de actividad, la sesión, lo que pesaba y la caché de «hoy»
    // (H13). Las claves las deriva `forgetEverythingFor` de `STORAGE_KEYS` y
    // `STORAGE_AREAS`, así que una clave nueva por host se va con ella sin tocar
    // este manejador; hasta H13 eran siete llamadas escritas aquí a mano y dos
    // —el contexto y la memoria— se habrían quedado detrás con cualquier otro
    // llamante. Ahí dentro va también la marca de borrado del diario, sin la cual
    // una escritura del service worker que ya había leído lo devolvía unos
    // milisegundos después (revisión adversaria de H11).
    // El Confluence enlazado, ANTES de vaciar nada: desde un Jira, las páginas
    // base y los análisis de páginas se apuntan en el diario de AQUEL host, y el
    // usuario no abre nunca su panel para borrarlo. «Borrar mi actividad» ya se
    // lo llevaba; que el botón más ancho dejara lo que el estrecho borra era
    // prometer un olvido a medias (revisión adversaria de H13). Sólo su diario y
    // su caché de «hoy»: lo demás de aquel sitio es de aquel sitio.
    const enlazado = linkedSite(state.linkedContext)
    await forgetEverythingFor(host)
    if (enlazado && enlazado.host !== host) {
      await clearActivity(enlazado.host)
      await clearTodayCache(enlazado.host)
    }
    // Y lo que el panel tenga en memoria de este sitio: lo de arriba borra el
    // almacén, pero un `state` que siga cargado lo vuelve a escribir en el turno
    // siguiente —o lo mete en su prompt— como si no se hubiera olvidado nada.
    state.sessionToolChars = 0
    state.heavyWarned = false
    state.index = null
    // Lo que estuviera apuntado para guardar: olvidar el sitio no puede dejar
    // un índice pendiente que el turno siguiente vuelva a escribir (P3).
    state.indexDirty = null
    state.ancestryFetched = new Map()
    state.contextMd = ''
    state.memory = { entries: [] }
    state.sessionID = null
    state.sources = emptySources()
    state.recentJql = []
    state.favouriteFilters = null
    state.profile = null
    // Lo precargado: `bootForSite` repinta el chat y se lleva la tarjeta con la
    // lista, así que dejarlo armado lo metería en la primera pregunta tras
    // olvidar, con unos resultados que ya no se ven (revisión adversaria de H12;
    // el mismo motivo que en `newSession`).
    state.pendingPreload = null
    state.sourceHistory = emptyHistory()
    state.references = { propio: null, enlazado: null, index: null, items: null }
    state.today = emptyToday()
    paintSourcesUi()
    // Se dice en voz alta: es la acción más destructiva del panel y su efecto
    // —que la pantalla se repinte con todo a cero— no se oye por sí solo (A2).
    announce(`Olvidado todo lo guardado de ${host}.`)
    hideScreens()
    await bootForSite()
  })

  // --- memoria
  $('mem-enabled').addEventListener('change', async () => {
    state.settings = await saveSettings({ crossSessionMemory: $('mem-enabled').checked })
    applySettingsToUi()
  })
  $('btn-memory-close').addEventListener('click', () => {
    hideScreens()
  })
  $('btn-memory-clear').addEventListener('click', async () => {
    await memory.clearMemory(state.site.host)
    state.memory = { entries: [] }
    showMemoryScreen()
  })

  $('btn-busy-cancel').addEventListener('click', () => {
    // Lo que trajo el velo, sea lo que sea (hoy, el indexado). Sin esto, el
    // Cancelar de «Guardando lo aprendido» quitaba el velo y dejaba el resumen
    // corriendo por detrás.
    state.busyAbort?.abort()
    hideBusy()
  })
}

// --------------------------------------------------------------- acciones

async function saveKeys() {
  const status = $('setup-status')

  if (!state.site?.host) {
    status.textContent = 'He perdido de vista el sitio. Abre una página de Jira o Confluence y vuelve a intentarlo.'
    return
  }

  // Cada producto con lo suyo: dirección, correo (sólo en Cloud) y token. Lo
  // que falte lo dice `buildMcpConfig` con el nombre del producto.
  const dataCenter = $('setup-dc').checked
  const keysOf = (product) =>
    $(`setup-${product}`).checked
      ? {
          url: $(`setup-${product}-url`).value.trim(),
          email: $(`setup-${product}-email`).value.trim(),
          token: $(`setup-${product}-token`).value,
        }
      : null
  const jira = keysOf('jira')
  const confluence = keysOf('confluence')

  status.textContent = 'Preparando la configuración…'

  let result
  try {
    result = await configureMcp(state.client, { host: state.site.host, jira, confluence, dataCenter })
  } catch (err) {
    status.textContent = 'No he podido configurarlo: ' + (err?.message || err)
    return
  }

  // Los hosts de cada producto salen de la configuración que se acaba de
  // construir —ya normalizada—, no de lo que se escribió en el campo.
  const env = result.config.environment
  // Con el sitio con el que se pidieron: el paso manual espera hasta 15 min y
  // la pestaña activa entonces puede ser otra (C5).
  state.pendingMcp = {
    ...result,
    site: state.site,
    products: {
      jira: jira ? hostOf(env.JIRA_URL) : '',
      confluence: confluence ? hostOf(env.CONFLUENCE_URL) : '',
    },
  }

  if (result.ready) {
    await finishSetup()
    return
  }

  // opencode sólo carga los MCP al arrancar, así que toca el paso manual.
  await showManualStep(result)
}

/**
 * Paso manual: enseñar dónde va la configuración, dejarla copiada, y esperar
 * a que opencode la cargue. En cuanto aparece conectada, sigue solo.
 */
async function showManualStep(result) {
  const paths = await state.client.paths().catch(() => null)
  const path = configFilePath(paths)

  state.snippets = {
    full: fullConfigSnippet(result.name, result.config),
    block: mcpBlockSnippet(result.name, result.config),
    mode: 'full',
  }

  $('setup-config-path').textContent = path
  paintSnippet()
  $('setup-main').classList.add('hidden')
  $('setup-manual').classList.remove('hidden')
  // El botón que se acaba de pulsar («Conectar y comprobar») queda escondido con
  // su mitad de la pantalla, así que el foco iría al <body>: va al título de la
  // mitad que aparece, como al abrir una pantalla y como al volver con la flecha.
  const titulo = $('setup-manual').querySelector('h1')
  if (titulo) {
    titulo.tabIndex = -1
    titulo.focus()
  }

  const waiting = $('setup-waiting')
  waiting.classList.remove('done')
  $('setup-waiting-text').textContent = 'Esperando a que opencode cargue el MCP…'

  state.mcpWait?.abort()
  const controller = new AbortController()
  state.mcpWait = controller

  // El host con el que se pidieron las claves, no el de la pestaña de ahora:
  // ya ha habido un await (paths) y la espera dura hasta 15 min.
  const site = state.pendingMcp?.site || state.site
  const status = await waitForMcpReady(state.client, site.host, {
    timeoutMs: 15 * 60 * 1000,
    signal: controller.signal,
    onTick: (s, left) => {
      $('setup-waiting-text').textContent =
        s.present && s.status
          ? `El MCP está en «${s.status}»…`
          : `Esperando a que opencode cargue el MCP… (${Math.round(left / 1000)} s)`
    },
  })
  if (state.mcpWait === controller) state.mcpWait = null

  if (controller.signal.aborted) return

  if (!status.connected) {
    $('setup-waiting-text').textContent = 'Sigo sin verlo. Comprueba que pegaste el bloque y reiniciaste opencode.'
    return
  }

  waiting.classList.add('done')
  $('setup-waiting-text').textContent = 'MCP conectado. Comprobando las claves…'
  await finishSetup()
}

/**
 * Con el MCP ya disponible, se comprueba que cada token sirve de verdad: son
 * dos productos y dos tokens, así que se comprueban los dos. Y se recuerda
 * qué host usa este MCP: si el otro producto vive en otro host, queda
 * enlazado a éste y no volverá a pedir claves.
 */
async function finishSetup() {
  // El sitio con el que se pidieron las claves (`saveKeys` lo guardó con la
  // configuración pendiente): tras esperar al MCP, la pestaña activa puede
  // ser otra, o ninguna de Atlassian (auditoría del 2026-09-13, docs/PLAN.md
  // §2 C5: TypeError con una pestaña fuera, o los registros de A en B).
  const { name, products, site } = state.pendingMcp || {}
  const status = $('setup-status')
  const waitingText = $('setup-waiting-text')
  const say = (t) => {
    status.textContent = t
    waitingText.textContent = t
  }

  if (!site?.host) {
    say('He perdido de vista el sitio para el que se pidieron las claves. Vuelve a Ajustes → Cambiar las claves.')
    return
  }

  say('Comprobando que las claves valen…')

  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · comprobación' })
    const detalles = []
    for (const product of PRODUCTS.filter((p) => products?.[p])) {
      const etiqueta = product === 'jira' ? 'Jira' : 'Confluence'
      say(`Comprobando las claves de ${etiqueta}…`)
      const check = await verifyCredentials(state.client, {
        sessionID: session.id,
        model: state.model,
        host: site.host,
        product,
      })

      if (!check.ok) {
        say(
          check.reason === 'sin-herramientas'
            ? 'El MCP aparece conectado pero el modelo no ve sus herramientas. Prueba a reiniciar opencode.'
            : `${etiqueta}: ${check.detail}`
        )
        return
      }
      detalles.push(`${etiqueta}: ${check.detail}`)
    }

    say('Conectado. ' + detalles.join(' · '))
    log.ok('MCP verificado', detalles.join(' · '))

    const registros = siteRecords({
      host: site.host,
      product: site.product,
      mcpName: name || mcpNameForHost(site.host),
      jiraHost: products?.jira || '',
      confluenceHost: products?.confluence || '',
    })
    for (const { host, patch } of registros) await saveSite(host, patch)
    for (const { host } of registros.slice(1)) {
      log.ok('Sitio enlazado', `${host} comparte el MCP de ${site.host}; no pedirá claves`)
    }
    // Se rearranca sólo si la pestaña sigue en ese sitio: si está en otro, el
    // registro ya está guardado y el arranque de aquél lo reconocerá al volver.
    // Y si está fuera de Atlassian, el arranque queda PENDIENTE: volver al
    // mismo host ya no rearranca por su cuenta (revisión adversaria de H2,
    // 2026-09-14), y sin esto el MCP recién cargado no se reconocería.
    if (state.site?.host === site.host) setTimeout(() => bootForSite(), 800)
    else if (!state.site && state.lastHost === site.host) state.bootPending = site.host
  } catch (err) {
    say('No he podido comprobarlo: ' + (err?.message || err))
  } finally {
    if (session) state.client.deleteSession(session.id).catch(() => {})
  }
}

function paintSnippet() {
  const s = state.snippets
  if (!s) return
  $('setup-snippet').textContent = s.mode === 'full' ? s.full : s.block
  $('btn-snippet-full').classList.toggle('on', s.mode === 'full')
  $('btn-snippet-block').classList.toggle('on', s.mode === 'block')
}

/**
 * Lo que se puede leer de la API del propio sitio antes de gastar un turno.
 *
 * POR QUÉ EXISTE: levantar el mapa de un espacio eran TRES turnos del modelo
 * —explorar y escribir la prosa, volcar el índice y levantar el árbol—, minutos
 * de espera y una jerarquía que el modelo se inventaba a trozos. El árbol lo
 * dice exacto la lista paginada de Confluence (`fetchSpacePages`), y en Jira lo
 * que hacía falta no es un árbol sino los nombres de verdad del proyecto, que
 * salen de contar una muestra (`profileFromSample`). Las dos cosas van con la
 * sesión del navegador, cuestan milisegundos y cero tokens (§8.19).
 *
 * REGLA DE ORO: esto sólo ADELANTA trabajo. Si la API no contesta, si el
 * usuario apagó las lecturas REST, si falta el permiso o si esto es Jira Cloud,
 * se devuelve lo que se sepa y el camino de siempre sigue entero: `buildContext`
 * con sus tres fases por el modelo. Lo único que cambia es que se dice —en el
 * velo mientras pasa y en el Registro para después—.
 *
 * @param {object} scope el ámbito que se va a indexar (`defaultScope`)
 * @param {{sitio:object, report?:Function, tabId?:number|null}} opts el sitio
 *        CAPTURADO al empezar, nunca el de la pestaña de ahora (§8.22)
 * @returns {Promise<{index:object|null, profile:object|null, aviso:string}>}
 */
async function restIndexFor(scope, { sitio, report = () => {}, tabId = state.tabId, signal = null } = {}) {
  // El perfil que ya hubiera contado sigue valiendo aunque hoy no se pueda
  // contar otro: es un conteo, no una lectura de ahora mismo.
  // Y sólo el de ESTE proyecto: el perfil se guarda por host y un Jira tiene
  // muchos. Con el panel ya en otro sitio, el de este host se lee del almacén.
  const delHost = !sitio ? null : (state.site?.host ?? state.lastHost) === sitio.host ? state.profile : await getProfile(sitio.host)
  const guardado = profileForProject(delHost, sitio?.projectKey)
  const nada = { index: null, profile: guardado, aviso: '' }
  // El interruptor maestro. Apagado no es un fallo —lo eligió el usuario en
  // Ajustes—, así que no se avisa de nada ni se apunta nada: el indexado va por
  // las tres fases de siempre, que es exactamente lo que la casilla promete.
  if (!state.settings.restTools || !sitio) return nada

  const host = sitio.host
  const falla = (motivo, texto) => {
    log.warn('Índice por la API no disponible', `${host} · ${motivo} · ${texto}`)
    report(texto + ' Lo recorro con el modelo, como siempre.')
    return { ...nada, aviso: texto }
  }

  if (sitio.product === 'confluence') {
    if (scope?.kind !== 'space' || !scope.key) {
      return falla('ámbito', 'Por la API sólo puedo leer el árbol de UN espacio, y aquí el ámbito es todo Confluence.')
    }
    if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
      return falla('permiso', `No puedo leer el árbol sin permiso sobre ${host}.`)
    }
    // `scope.label` ya trae su artículo («el espacio ENG», «todo Confluence»): con
    // «de» delante salía «el árbol de el espacio ENG».
    report(`Leyendo ${scope.label} en la API de Confluence: el árbol de páginas…`)
    // Quien pide es el content script, que vive en el origen del sitio; los
    // topes (páginas y peticiones) los pone el módulo y no viajan en el mensaje.
    if (signal?.aborted) return nada
    const r = await chrome.tabs
      .sendMessage(tabId, { type: MSG.SPACE_PAGES, spaceKey: scope.key, wikiPrefix: wikiPrefixOf(sitio), cloud: sitio.cloud })
      .catch(() => null)
    // Cancelado mientras se leía: ni aviso, ni registro, ni índice.
    if (signal?.aborted) return nada
    if (!r?.ok) {
      return falla(r?.reason || 'sin respuesta', `No he podido leer el árbol de ${host} por su API: ${r?.reason || 'la pestaña no contestó'}.`)
    }
    const index = indexFromSpacePages(r.pages, { site: sitio, scope, homeId: r.homeId })
    if (!index) return falla('vacío', `La API de ${host} no devuelve ninguna página en ${scope.label}.`)
    log.ok(
      'Índice leído de la API',
      `${host} · ${indexSize(index)} entradas · ${r.requests} petición(es)${r.truncated ? ` · recortado en ${INDEX_LIMITS.maxPages}` : ''}` +
        `${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ''}`
    )
    return { index, profile: guardado, aviso: '' }
  }

  if (sitio.product === 'jira') {
    // En Jira Cloud `GET /rest/api/2/search` está retirado (410) y allí todo va
    // por el MCP: el rechazo vive en jira-rest.js, pero pedirlo para nada sería
    // una petición y un aviso más confuso que este.
    if (sitio.cloud) {
      return falla('cloud', 'En Jira Cloud no puedo consultar la API con tu sesión.')
    }
    if (scope?.kind !== 'project') {
      return falla('ámbito', 'Por la API sólo puedo contar la muestra de UN proyecto, y aquí el ámbito es todo Jira.')
    }
    if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
      return falla('permiso', `No puedo contar la muestra sin permiso sobre ${host}.`)
    }
    report(`Contando ${scope.label} en la API de Jira: una muestra de sus tickets…`)
    if (signal?.aborted) return nada
    const r = await countProfile(sitio, scope, { tabId, signal })
    if (signal?.aborted || r.reason === 'cancelado') return nada
    if (!r.ok) return falla(r.reason, r.detail)
    // El perfil se guarda bajo el host con el que se pidió (lo hace
    // `countProfile`); en el estado sólo entra si el panel sigue ahí (§8.22).
    if ((state.site?.host ?? state.lastHost) === host) state.profile = r.profile
    return { index: null, profile: r.profile, aviso: '' }
  }

  return nada
}

/**
 * @param {{keepContext?: boolean}} opts keepContext respeta el documento que
 *        trajo el usuario y se queda sólo con el índice de navegación.
 */
async function generateContext({ keepContext = false } = {}) {
  // El sitio que se indexa se captura al empezar: el indexado dura minutos y
  // `state.site` cambia con la pestaña. Todo lo que se escriba —también si
  // falla— va bajo ESTE host; si al terminar el usuario está en otro sitio, se
  // guarda en segundo plano y no se toca ni el estado ni el chat de aquél.
  // Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2 C2): el
  // contexto de un Jira se guardaba como CONTEXT.md del Confluence abierto
  // entonces, y ese Confluence quedaba «onboarded» sin haber elegido nada.
  const sitio = state.site
  if (!sitio) return
  const host = state.site.host
  const scope = defaultScope(sitio)
  const controller = new AbortController()
  state.indexingAbort = controller
  hideScreens()
  showBusy(
    keepContext ? 'Construyendo el índice' : 'Levantando el mapa',
    `Recorriendo ${scope?.label || 'esta zona'}…`,
    { abort: controller }
  )

  const report = (t) => (el.busyText.textContent = t)

  try {
    // Lo que la API del propio sitio da exacto, antes de gastar un turno: el
    // árbol del espacio (Confluence) o la muestra contada del proyecto (Jira
    // Data Center). Si no se puede, `rest.index` viene null y `buildContext`
    // hace exactamente lo de siempre; el motivo va en el velo y en el Registro.
    const rest = await restIndexFor(scope, { sitio, report, signal: controller.signal })
    if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError')

    const { contextMd, index } = await buildContext(state.client, {
      scope,
      site: sitio,
      model: state.model,
      // Desde Jira, el indexador sabe qué Confluence hay enlazado y qué
      // cuenta su contexto: es donde buscar si los tickets están documentados.
      linkedContext: state.linkedContext,
      // Con el árbol ya leído, las fases 2 y 3 no se le piden al modelo; con
      // el perfil contado, tampoco la muestra de Jira (los dos van al prompt).
      restIndex: rest.index,
      profile: rest.profile,
      signal: controller.signal,
      onProgress: report,
    })

    // ¿Sigue el panel en el sitio que se indexó? Si no, el índice se funde con
    // el GUARDADO de aquel host, no con el de la pestaña de ahora. Se pregunta
    // EN CADA USO, no una vez: entre las escrituras de aquí abajo hay tres
    // await de almacenamiento, y en ese hueco el usuario puede cambiar de
    // sitio; con una sola foto, el índice de A acababa en el estado de B
    // (revisión adversaria de H2, 2026-09-14). Y vale el sitio del PANEL: con
    // la pestaña en el correo, `state.site` es null y esto sigue siendo suyo.
    const sigueAqui = () => (state.site?.host ?? state.lastHost) === host
    if (!keepContext) {
      await memory.saveContextMd(host, contextMd)
      if (sigueAqui()) state.contextMd = contextMd
    }
    const previo = sigueAqui() ? state.index : (await getIndex(host)).index
    // Y lo que un turno dejara APUNTADO de este host y todavía sin escribir:
    // desde H6 (P3) `markIndexDirty` apunta y `persistIndex` escribe minutos
    // después, así que esa escritura tardía caería encima de lo que se acaba de
    // construir y se lo llevaría entero. Fundiéndolo aquí y soltando el apunte,
    // el turno siguiente ya no tiene nada viejo que escribir (revisión
    // adversaria de H6).
    const apuntado = state.indexDirty?.host === host ? state.indexDirty.index : null
    const base = apuntado && apuntado !== previo ? mergeIndex(previo, apuntado) : previo
    // `mergeIndex` y no `mergeIndexKeepingTree`: lo que se acaba de construir es
    // la fuente de verdad —y desde H9, cuando viene de la API, lo es del todo—,
    // así que su entrada gana entera. Con la que conserva el árbol, un
    // `parentId: null` DELIBERADO (las hijas de la portada, que no es una rama
    // que se despliegue) recuperaría el padre viejo por el `??` y el recorrido
    // volvería a empezar por un peldaño que no se puede abrir. Las páginas que
    // el índice nuevo no menciona se conservan igual: nada se borra.
    const fundido = mergeIndex(base, index)
    await saveIndex(host, fundido)
    // El apunte se suelta DESPUÉS de guardar —si la escritura falla, lo que
    // había apuntado sigue haciendo falta— y sólo si sigue siendo el mismo: en
    // el hueco del `await` puede haber terminado un turno y apuntado otro más
    // nuevo, que no es éste y no se puede tirar.
    if (apuntado && state.indexDirty?.index === apuntado) state.indexDirty = null
    await saveSite(host, { onboarded: true, indexedAt: Date.now() })

    hideBusy()
    if (!sigueAqui()) {
      log.info('Contexto construido en segundo plano', `${host} · ${indexSize(fundido)} entradas · ${contextMd.length} caracteres · el panel ya está en otro sitio`)
      return
    }
    state.index = fundido
    // Lo que el indexador diga de los padres puede venir de un modelo: el
    // camino de cada destino se vuelve a leer de la API la próxima vez.
    state.ancestryFetched = new Map()
    log.ok('Contexto construido', `${indexSize(state.index)} entradas · ${contextMd.length} caracteres`)
    // El chat sólo se repinta si el panel está enseñando ese sitio: con la
    // pestaña fuera de Atlassian, lo que se ve es el «Abre Jira o Confluence»,
    // y al volver se repinta solo (refreshTab).
    if (!state.site) return
    await restoreConversation()
    // El motivo por el que la API no sirvió sobrevive al velo: el contexto está
    // listo igual, pero un fallo silencioso tiene contraparte visible (§8.14) y
    // la línea del velo se la lleva el siguiente paso en cuanto pasa.
    showNotice(`Contexto listo: ${indexSize(state.index)} entradas indexadas.` + (rest.aviso ? ' ' + rest.aviso : ''))
  } catch (err) {
    hideBusy()
    const sigueAqui = () => (state.site?.host ?? state.lastHost) === host
    // Cancelado (el botón del velo, o un cambio de sitio que se llevó el
    // cliente) no es fallado: no se ha aprendido nada, así que el sitio NO
    // queda por configurado —su pantalla de contexto volverá a salir— y el
    // chat no se llena de un fallo que no lo es (revisión adversaria de H2,
    // 2026-09-14). Fuera del `signal` no hay más marca que el nombre.
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      log.info('Indexado cancelado', `${host} · sin índice: la pantalla de contexto volverá a salir`)
      if (sigueAqui() && state.site) showNotice('Indexado cancelado. Puedes retomarlo desde ajustes.')
      return
    }
    log.error('Indexado fallido', `${host} · ${err?.message || String(err)}`)
    if (sigueAqui() && state.site) showNotice('El indexado falló: ' + (err?.message || err), true)
    await saveSite(host, { onboarded: true })
    if (sigueAqui() && state.site) await restoreConversation()
  } finally {
    state.indexingAbort = null
  }
}

async function uploadContext(ev) {
  const file = ev.target.files?.[0]
  if (!file) return
  const text = await file.text()
  state.contextMd = text
  await memory.saveContextMd(state.site.host, text)
  await saveSite(state.site.host, { onboarded: true })
  // Escribe el mismo `onboarded` que «Omitir», así que apaga igual el arranque
  // que podría volver a enseñar la pantalla de contexto encima de esto.
  state.bootToken = {}

  hideScreens()
  await restoreConversation()
  showNotice('Contexto cargado desde ' + file.name + '.')

  // El índice hace falta igual —sin él no hay navegación—, pero el documento
  // que acabas de traer no se toca.
  generateContext({ keepContext: true }).catch(() => {})
}

async function newSession() {
  if (!state.site) return

  // Con un turno en vuelo, se cancela —su `finally` apaga el streaming— y se
  // aborta en el servidor ANTES de resumir la sesión: si no, la respuesta
  // caía en una burbuja desconectada, sus tarjetas bajo la bienvenida, y
  // Parar ya no podía abortar nada (auditoría del 2026-09-13, docs/PLAN.md
  // §2 C4). El botón además se desactiva mientras se responde (setStreaming).
  if (state.streaming) {
    state.turnAbort?.abort()
    if (state.sessionID) await state.client?.abort(state.sessionID).catch(() => {})
    log.info('Turno cancelado', 'has abierto una sesión nueva a mitad de respuesta')
  }

  // Si la memoria entre sesiones está activa, se resume antes de cerrar.
  if (state.settings.crossSessionMemory && state.sessionID && memory.worthRemembering(state.turns)) {
    showBusy('Guardando lo aprendido', 'Resumiendo la sesión…')
    const summary = await memory.summarizeSession(state.client, {
      sessionID: state.sessionID,
      model: state.model,
    })
    if (summary) state.memory = await memory.addEntry(state.site.host, summary)
    hideBusy()
  }

  await clearSessionId(state.site.host)
  // Y con ella, lo que arrastraba: la sesión nueva empieza sin nada que
  // reenviar, que es justo lo que se ofrece al avisar de una pesada.
  await clearSessionWeight(state.site.host)
  state.sessionToolChars = 0
  state.heavyWarned = false
  // Y lo precargado: el chat se vacía, así que la tarjeta con la lista y su
  // botón se van con él. Dejarlo puesto metería en la primera pregunta de la
  // sesión nueva unos resultados que ya no se ven por ninguna parte.
  state.pendingPreload = null
  forgetNotes()
  log.ok('Sesión nueva', state.settings.crossSessionMemory ? 'la anterior quedó resumida' : '')
  state.sessionID = null
  state.turns = []
  el.chat.textContent = ''
  showWelcome()
}

// ------------------------------------------------------- qué mirar hoy (H11)

/**
 * «Qué mirar hoy»: qué merece tu atención en este sitio, ordenado y explicado.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO EN UN MÓDULO: lo que se puede decidir con una regla ya
 * está fuera —`today.js` puntúa y escribe los motivos, `activity.js` guarda el
 * diario, `jira-rest.js` y `confluence-rest.js` montan las consultas—. Lo que
 * queda en el panel es lo único que no se puede sacar de él: a quién se le
 * pregunta (la pestaña o el Confluence enlazado), cuándo se puede preguntar
 * (los dos interruptores, el permiso, la caché) y qué se hace con una fila
 * (navegar por el índice y `validatePlan`, o abrir pestaña nueva).
 *
 * LAS TRES REGLAS QUE NO SE NEGOCIAN (CLAUDE.md §8.19 y §8.20):
 *  1. NINGUNA recomendación llama al modelo ni gasta un token. De aquí no sale
 *     ni un `runTurn` ni una sesión: se leen listas por REST con la sesión del
 *     navegador, se suman puntos enteros y se ordena.
 *  2. Faro NUNCA manda una pregunta por su cuenta. «Analizar» navega, fija la
 *     Skill y DEJA la pregunta escrita en el cuadro (`pendingIntent`).
 *  3. Con `restTools` o `todaySuggestions` apagados no sale NI UNA lectura y no
 *     se apunta NADA: ni aquí ni en el service worker, que aplica las mismas
 *     dos condiciones antes de apuntar una visita.
 */

/** El estado vacío de «hoy». Es del SITIO: cambiar de host lo devuelve a esto. */
function emptyToday() {
  return {
    // El host del PANEL con el que se leyó, para no pintar lo de otro sitio.
    host: '',
    // Cuándo se leyó de verdad (o cuándo se guardó la caché que se está usando).
    fetchedAt: 0,
    // Lo leído fundido con el diario, SIN ordenar: `todayRows()` lo ordena al
    // pedirlo, porque la puntuación depende de dónde estés ahora mismo.
    candidates: [],
    // Las familias que más analizas, del diario de este host.
    preferred: [],
    // Todos los fallos de lectura, para el Registro y para poder decir por qué
    // la lista viene corta.
    errors: [],
    // Y los que toca DECIR: `restFailureDue` deja pasar uno por host, sesión y
    // motivo, que es la misma tregua de la lista de una búsqueda (H8).
    notices: [],
    // Cuándo miró el usuario la lista por última vez: es lo que hace que la
    // insignia cuente lo NUEVO y no lo que hay. Lo escribe `markTodaySeen` al
    // abrir la pantalla, en `sites[host].todaySeenAt`, y lo vuelve a leer
    // `loadToday` normalizado; aquí empieza en 0, que es «nunca la miró» y hace
    // que cuenten todas.
    seenAt: 0,
    loading: false,
  }
}

/**
 * Como `refreshProfileSoon`: se lanza y no se espera; un fallo no tumba nada.
 *
 * Pinte lo que pinte la lectura —o no pinte nada, porque el sitio está apagado
 * o no hay a quién preguntar—, al acabar se repinta lo que se ve: la insignia
 * del botón y, si el chat está vacío, su bloque. Sin ese repintado la lista
 * llegaría al estado y no a la pantalla.
 */
function loadTodaySoon(testigo) {
  loadToday({ testigo })
    .catch((err) => log.info('Qué mirar hoy no disponible', String(err?.message || err)))
    .finally(() => paintTodayUi())
}

/**
 * Lee lo que ha cambiado en este sitio y lo deja puntuado en `state.today`.
 *
 * Nunca en el camino crítico del arranque (H6 P4): se llama sin `await` al
 * final de `bootForSite`, con el testigo de ESE arranque y con el host
 * capturado. Entre la primera lectura y la última hay seis peticiones, y si
 * para entonces el panel está en otro sitio no se pinta nada (§8.22).
 *
 * @param {{force?: boolean, testigo?: object|null}} opts `force` salta la caché
 *        de sesión (es lo que hará el «Actualizar» de la pantalla).
 */
async function loadToday({ force = false, testigo = state.bootToken } = {}) {
  const sitio = state.site
  if (!sitio) return
  const host = sitio.host
  const tabId = state.tabId
  // La tregua de los avisos es por host, sesión y motivo: la sesión con la que
  // se pide es la que manda al volver, como en la lista de una búsqueda.
  const sessionID = state.sessionID

  // Los dos interruptores, y en este orden: `restTools` es el maestro de toda
  // lectura REST nueva y `todaySuggestions` el de esta función. Apagado
  // cualquiera de los dos no sale ni una petición ni se toca el diario.
  if (!state.settings.restTools || !state.settings.todaySuggestions) return
  if (state.today.loading && !force) return

  const saved = await getSite(host)
  // El interruptor por sitio. Se normaliza al leer: lo que no sea `true` no lo
  // escribió Faro y no apaga nada (misma regla que `migrateSettings`).
  if (saved?.todayOff === true) return
  if (state.bootToken !== testigo || (state.site?.host ?? state.lastHost) !== host) return

  const hoy = state.today
  // Cuándo se miró la lista por última vez en ESTE sitio, para que la insignia
  // cuente lo nuevo y no lo que hay. Se normaliza al leer: lo que no sea un
  // instante no lo escribió `markTodaySeen` y cuenta como «nunca». Va DETRÁS de
  // la guarda y sobre `hoy`, como todo lo demás: escribirlo antes metía la fecha
  // de un sitio en el estado de otro (revisión adversaria de H11).
  hoy.seenAt = todaySeenAt(saved)
  hoy.loading = true
  try {
    const t0 = performance.now()
    const enlazado = linkedSite(state.linkedContext)
    // El registro del Confluence enlazado, sólo para su `todayOff`: «No sugerir
    // nada en este sitio» se pone desde el panel de ESE host, y sin leerlo aquí
    // no apagaba nada de lo que se le pregunta desde el Jira que lo enlaza.
    const guardadoEnlazado = enlazado && enlazado.host !== host ? await getSite(enlazado.host) : null

    // Las páginas del diario por las que se pregunta «¿ha cambiado alguna?».
    // Son las del host de CONFLUENCE al que se va a preguntar, que es el de la
    // pestaña si estamos en Confluence y el enlazado si estamos en Jira: en
    // ningún caso hay dos objetivos de Confluence a la vez. Este diario sólo
    // sirve para montar esos ids; el que se cruza con lo leído se lee al final.
    const hostPaginas = sitio.product === 'confluence' ? host : enlazado?.host || ''
    const paraIds = hostPaginas ? await getActivity(hostPaginas) : null
    const ids = paraIds ? recentPagesFromActivity(paraIds).map((p) => p.id) : []

    const { targets, skipped } = todayTargets(sitio, saved, {
      linked: state.linkedContext,
      linkedSaved: guardadoEnlazado,
      pageIds: ids,
    })
    if (!targets.length) {
      // Sin nadie a quien preguntar no es un fallo: en Jira Cloud no hay REST
      // que leer y desde Confluence todavía no se consulta el Jira enlazado.
      // Se dice una vez en el Registro y se acabó (§8.14).
      log.info(
        'Qué mirar hoy no disponible',
        skipped.map((s) => `${s.host || s.product}: ${s.reason}`).join(' · ') || `${host}: no hay a quién preguntar`
      )
      return
    }
    // Y si hay objetivos pero alguno se ha quedado fuera, también se dice: una
    // lista corta sin explicación se lee como «aquí no hay nada» (§8.14).
    if (skipped.length) {
      log.info('Qué mirar hoy no disponible', skipped.map((s) => `${s.host || s.product}: ${s.reason}`).join(' · '))
    }

    let reads = null
    let fallos = []
    let deCache = false
    let fetchedAt = Date.now()
    if (!force) {
      const cache = await getTodayCache(host)
      if (cache && Date.now() - cache.fetchedAt < TODAY_LIMITS.cacheMs && Array.isArray(cache.reads)) {
        reads = cache.reads
        fallos = Array.isArray(cache.errors) ? cache.errors : []
        fetchedAt = cache.fetchedAt
        deCache = true
      }
    }

    if (!reads) {
      // Todos los objetivos a la vez y ninguno se lleva a los demás: lo que
      // conteste Confluence sirve aunque Jira esté caído, y al revés.
      const tandas = await Promise.allSettled(targets.map((t) => fetchTodayTarget(t, { sitio, ids, tabId })))
      reads = []
      for (const res of tandas) {
        if (res.status !== 'fulfilled') continue
        reads.push(...res.value.reads)
        fallos.push(...res.value.errors)
      }
      fetchedAt = Date.now()
      // La caché va bajo el host del PANEL y guarda lo LEÍDO, no lo ordenado:
      // la puntuación se rehace al pintar porque depende de dónde estés.
      await saveTodayCache(host, { fetchedAt, reads, errors: fallos }).catch(() => {})
    }
    const ms = Math.round(performance.now() - t0)

    // Entre la primera lectura y aquí hay segundos: si el panel se fue a otro
    // sitio, o el arranque ya no manda, esto no es suyo y no se pinta (§8.22).
    // Lo leído no se pierde: quedó en la caché de sesión de SU host.
    if (state.bootToken !== testigo || (state.site?.host ?? state.lastHost) !== host) {
      log.info('Qué mirar hoy no disponible', `lo leído de ${host} llegó con el panel en otro sitio`)
      return
    }

    const now = Date.now()
    // Los diarios, LEÍDOS AHORA: el del sitio de la pestaña y, si lo hay, el del
    // Confluence enlazado. Son DOS diarios distintos y cada candidato se cruza
    // con el suyo (§8.22). Se leen aquí y no antes de las peticiones porque entre
    // una cosa y otra hay segundos, y en ese hueco el usuario puede haber
    // descartado una fila con la «×»: con la copia de antes, su descarte se
    // deshacía solo en cuanto llegaba la lectura (revisión adversaria de H11).
    const diarios = { [host]: await getActivity(host) }
    if (enlazado && enlazado.host !== host) diarios[enlazado.host] = await getActivity(enlazado.host)
    hoy.host = host
    hoy.fetchedAt = fetchedAt
    hoy.candidates = buildCandidates({ reads, activity: diarios, here: todayHere(), now })
    hoy.preferred = preferredFamilies(diarios[host], { now })
    hoy.errors = fallos
    // Un motivo que no cambia por reintentar se dice UNA vez por host, sesión y
    // motivo: la misma tregua que la lista de una búsqueda (rest-notice.js).
    hoy.notices = fallos.filter((e) => restFailureDue(state.restWarned, e.reason, e.host, sessionID)).map(todayFailText)

    if (!reads.length) {
      log.warn(
        'Qué mirar hoy no disponible',
        fallos.map((e) => `${e.host} ${e.kind}: ${e.reason}`).join(' · ') || 'ninguna lectura devolvió nada'
      )
      return
    }
    log.ok(
      'Qué mirar hoy',
      `${todaySummary({ items: todayRows(), errors: fallos })} · ${hoy.candidates.length} candidatos · ` +
        `de ${targets.map((t) => t.host).join(' y ')}${deCache ? ' · de la caché' : ` · ${ms} ms`}`
    )
  } finally {
    hoy.loading = false
  }
}

/**
 * Las lecturas de un objetivo, todas a la vez. Nunca lanza.
 *
 * Un `kind` que falle no se lleva a los otros tres: se apunta su motivo y el
 * resto de la lista sigue. Devuelve `{reads, errors}` con la forma que espera
 * `buildCandidates` (`{product, host, kind, items}`).
 */
async function fetchTodayTarget(target, { sitio, ids = [], tabId = state.tabId } = {}) {
  const reads = []
  const errors = []
  const hechas = await Promise.allSettled(target.kinds.map((kind) => readToday(target, kind, { sitio, ids, tabId })))
  target.kinds.forEach((kind, i) => {
    const res = hechas[i]
    const r =
      res.status === 'fulfilled'
        ? res.value
        : { ok: false, reason: 'red', detail: String(res.reason?.message || res.reason) }
    if (!r?.ok) {
      errors.push({
        product: target.product,
        host: target.host,
        kind,
        reason: r?.reason || 'sin respuesta',
        detail: r?.detail || '',
        // Los del SERVIDOR, tal cual los leyó `errorBody`: se enseñan, no se
        // interpretan (§6).
        messages: Array.isArray(r?.messages) ? r.messages : [],
      })
      return
    }
    const items = target.product === 'jira' ? r.issues : r.pages
    reads.push({ product: target.product, host: target.host, kind, items: Array.isArray(items) ? items : [] })
  })
  return { reads, errors }
}

/**
 * UNA lectura: un `kind` de un objetivo. Nunca lanza.
 *
 * Lo que viaja es el `kind` y sus parámetros VALIDADOS (una clave de proyecto,
 * una clave de incidencia, unos días, unos ids), nunca el texto de una consulta:
 * la JQL y el CQL los escriben las plantillas fijas de `jira-rest.js` y
 * `confluence-rest.js` (§8.12, §8.19). Por eso el content script elige por
 * `kind` y un `kind` que no esté en su lista no pide nada.
 *
 * Dos caminos, y sólo dos:
 *  - `tab`: el producto de la PESTAÑA, por el content script, que vive en el
 *    origen del sitio y deduce de `location` la ruta a la que se pide.
 *  - `linked`: el Confluence ENLAZADO a este Jira Data Center, desde el panel
 *    con `credentials: 'include'`, que es lo ya admitido en §4.8 para las
 *    páginas base. Y sólo con el permiso YA concedido: una carga en segundo
 *    plano no puede abrir un diálogo de permisos que el usuario no ha pedido
 *    (la misma regla que `refreshProfile`).
 */
async function readToday(target, kind, { sitio, ids = [], tabId = state.tabId } = {}) {
  if (target.via === 'linked') {
    if (!(await hasHostPermission(target.site.origin))) {
      return { ok: false, reason: 'permiso', detail: `sin permiso sobre ${target.site.host}` }
    }
    const cql =
      kind === 'viewed'
        ? viewedCql(CONFLUENCE_REST_LIMITS.maxResults)
        : kind === 'mine'
          ? mineCql(TODAY_LIMITS.daysMine)
          : idsCql(ids)
    // `searchContent` lo vuelve a comprobar contra las plantillas antes de pedir
    // nada; esto sólo evita una petición que ya se sabe que no vale.
    if (!cql) return { ok: false, reason: 'consulta no permitida' }
    return searchContent((u, o) => fetch(u, o), target.site, cql, { credentials: 'include' }).catch((err) => ({
      ok: false,
      reason: 'red',
      detail: String(err?.message || err),
    }))
  }

  if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
    return { ok: false, reason: 'permiso', detail: `sin permiso sobre ${target.host}` }
  }
  const msg =
    target.product === 'jira'
      ? {
          type: MSG.RECENT_ISSUES,
          kind,
          limit: JIRA_REST_LIMITS.defaultResults,
          cloud: !!sitio.cloud,
          ...(kind === 'mine' ? { days: TODAY_LIMITS.daysMine } : {}),
          ...(kind === 'project' ? { projectKey: sitio.projectKey, days: TODAY_LIMITS.daysProject } : {}),
          ...(kind === 'related' ? { issueKey: sitio.issueKey } : {}),
        }
      : {
          type: MSG.RECENT_PAGES,
          kind,
          limit: CONFLUENCE_REST_LIMITS.maxResults,
          // El prefijo del wiki es lo ÚNICO que el panel propone, porque un Data
          // Center bajo `/confluence` sólo lo conoce quien lo observó;
          // `resolveWikiPrefix` lo acepta sólo con forma de ruta y siempre
          // colgando del origen de la pestaña.
          wikiPrefix: wikiPrefixOf(sitio),
          cloud: !!sitio.cloud,
          ...(kind === 'mine' ? { days: TODAY_LIMITS.daysMine } : {}),
          ...(kind === 'ids' ? { ids } : {}),
        }
  return (await chrome.tabs.sendMessage(tabId, msg).catch(() => null)) || { ok: false, reason: 'sin respuesta' }
}

/**
 * Por qué se quedó corta la lista, en palabras del usuario.
 *
 * De Jira lo dice `jqlFailText` (rest-notice.js), que es el mismo texto que sale
 * bajo la tarjeta de una búsqueda: dos formas de contar el mismo 401 acabarían
 * diciendo cosas distintas. De Confluence no había ninguno —hasta H11 el panel
 * no leía su API más que para las páginas base— y sus motivos son PROSA, no
 * códigos (§6), así que se enseñan tal cual.
 */
function todayFailText(e) {
  if (e?.product === 'jira') return jqlFailText(e, e.host)
  if (e?.reason === 'permiso') return `No puedo leer lo último de ${e.host} sin permiso sobre ese dominio.`
  return `No he podido leer lo último de Confluence en ${e?.host}: ${e?.detail || e?.reason || 'sin motivo'}.`
}

/**
 * Dónde está el usuario AHORA, para puntuar contra ello (misma épica, misma
 * familia, hermana de la página abierta, la propia página abierta fuera).
 *
 * Los campos de la incidencia se cruzan POR PÁGINA, como en los chips: los que
 * se leyeron de otra incidencia dirían que ésta es «de la misma familia» sin
 * serlo (lección de H8).
 */
function todayHere() {
  const site = state.site
  if (!site) return null
  const titulo = cleanTabTitle(state.tabTitle, site)
  const campos = state.issueFields && samePage(state.issueFields.url, state.tabUrl) ? state.issueFields.fields : null
  return {
    host: site.host,
    issueKey: site.issueKey || '',
    projectKey: site.projectKey || '',
    spaceKey: site.spaceKey || '',
    pageId: site.pageId || currentPageId(state.index, state.tabUrl) || '',
    title: titulo,
    family: campos ? issueFamily(campos, { summary: titulo }) : '',
  }
}

/**
 * Las filas de «hoy», ordenadas contra la página que hay delante AHORA.
 *
 * Se ordena al pedirlas y no al leerlas: cambiar de incidencia dentro del mismo
 * Jira cambia qué es «de la misma épica» o «enlazada con», y eso no vale una
 * petición. Ordenar unas decenas de candidatos es aritmética entera.
 *
 * El índice que se pasa es el de CONFLUENCE (`sourcesIndex()`: el del sitio, o
 * el del enlazado desde un Jira), que es el único que sabe de padres y por
 * tanto el único con el que `rankToday` puede decir «hermana de la abierta».
 */
function todayRows({ limit = TODAY_LIMITS.maxItems } = {}) {
  const filas = rankToday(state.today.candidates, {
    here: todayHere(),
    index: sourcesIndex(),
    preferred: state.today.preferred,
    now: Date.now(),
  })
  return Number.isInteger(limit) && limit > 0 ? filas.slice(0, limit) : filas
}

/** Cuántas filas han cambiado desde que se miró la lista: el número de la insignia. */
function todayCount() {
  return countNew(todayRows(), state.today.seenAt)
}

/**
 * La lista se acaba de mirar: la insignia vuelve a contar desde aquí.
 *
 * Se guarda en el registro del sitio (`todaySeenAt`), como `skill` o `model`:
 * si viviera sólo en memoria, cerrar el panel volvería a contar como novedad
 * todo lo que ya se había mirado, y la insignia dejaría de significar nada. Un
 * fallo al guardarlo no puede tumbar la pantalla que se está abriendo: se
 * queda en memoria hasta la próxima.
 */
async function markTodaySeen() {
  state.today.seenAt = Date.now()
  const host = state.site?.host ?? state.lastHost
  if (host) await saveSite(host, { todaySeenAt: state.today.seenAt }).catch(() => {})
}

/** Lo guardado, normalizado: sólo un instante positivo cuenta como «ya la miraste». */
function todaySeenAt(saved) {
  const at = Number(saved?.todaySeenAt)
  return Number.isFinite(at) && at > 0 ? at : 0
}

/**
 * Abrir una fila.
 *
 * Dos caminos, y la diferencia no es un detalle (docs/PLAN.md §3.1):
 *  - HOST PROPIO: la fila NO navega por su cuenta y aquí no se concatena
 *    ninguna URL. Lo que se conoce se funde primero en el índice y el destino
 *    pasa por `validatePlan`, que comprueba que está en el índice, que su URL
 *    es de este origen y que el producto casa (§8.3); de ahí sale el mismo plan
 *    de un salto que produce el planificador y lo lanza el mismo `runPlan`.
 *  - HOST ENLAZADO: es OTRO origen, así que se abre en pestaña NUEVA con
 *    `openUrl` —que sólo abre orígenes conocidos, y el del Confluence enlazado
 *    lo es— y nunca con `NAVIGATE_DIRECT`, que se llevaría de sitio la pestaña
 *    en la que el usuario está trabajando.
 *
 * @param {object} item una fila de `todayRows()`
 * @param {{card?: HTMLElement|null}} opts dónde colgar el fallo, si hay dónde
 * @returns {Promise<boolean>} si de verdad se lanzó el viaje
 */
async function openTodayItem(item, { card = null } = {}) {
  const site = state.site
  if (!item || !site) return false

  const enlazado = linkedSite(state.linkedContext)
  if (enlazado && item.host === enlazado.host) {
    // El id se valida aquí aunque venga de nuestro propio módulo: de esto sale
    // una URL, y una URL se monta sólo con lo que ha pasado una validadora.
    if (item.kind !== 'confluence-page' || !/^\d{1,19}$/.test(String(item.id))) return false
    openUrl(enlazado.origin + canonicalPagePath(enlazado, item.id))
    return true
  }
  if (item.host !== site.host) return false

  await learnTodayItem(item, site)
  const r = validatePlan(
    { navigate: true, mode: 'direct', destination: { kind: item.kind, id: item.id } },
    { index: state.index, origin: site.origin, host: site.host, here: state.tabUrl, site }
  )
  if (!r.ok || !r.plan?.navigate) {
    const motivo = r.reason || 'el plan no vale'
    log.warn('Navegación fallida', `${item.id} · ${motivo}`)
    const aviso = `No puedo abrir ${item.id}: ${motivo}`
    if (card) card.appendChild(noticeNode(aviso, true))
    else showNotice(aviso, true, { force: true })
    announce(aviso)
    return false
  }

  // `runPlan` cuelga lo que falle de la tarjeta que se le da. La lista de «hoy»
  // no es una burbuja del chat, así que sin tarjeta se le da una caja suelta y
  // lo que escriba ahí se repite en el chat, que es el sitio que siempre está
  // (§8.14: todo fallo silencioso tiene contraparte visible).
  const caja = card || document.createElement('div')
  await runPlan(r.plan, 'direct', caja)
  if (!card && caja.textContent) showNotice(caja.textContent, true, { force: true })
  // Un salto directo no tiene «Parar» ni `PLAN_FINISHED` que vuelva a encender
  // los botones que `runPlan` apagó, y mirar la siguiente fila es justo lo que
  // se hace después (la misma cola que dejó `openIssueFromResults`).
  if (card) for (const b of card.querySelectorAll('button')) b.disabled = false
  return true
}

/**
 * Lo que se va a abrir, en el índice.
 *
 * Sin esto `validatePlan` rechaza el destino, que es exactamente lo que tiene
 * que hacer: el índice es la lista de lo que Faro sabe que existe en este
 * sitio. Se funde con las MISMAS funciones que usan la lista de una búsqueda
 * (`harvestFromSearch`) y la pantalla de páginas base (`mergePagesIntoIndex`),
 * para que no haya una tercera forma de meter algo en el índice.
 *
 * Se escribe en disco aquí mismo y no por `markIndexDirty`: esto es un clic del
 * usuario fuera de un turno, y `persistIndex()` sólo corre al final de uno.
 */
async function learnTodayItem(item, site) {
  if (item.kind === 'jira-issue') {
    const { index, added } = harvestFromSearch([{ key: item.id, summary: item.title }], { site, index: state.index })
    if (!added) return
    state.index = index
    await saveIndex(site.host, index).catch((err) => log.warn('Índice sin guardar', String(err?.message || err)))
    log.ok('Índice ampliado', `+${added} · total ${indexSize(index)}`)
    return
  }
  if (state.index?.pages?.[item.id]) return
  await mergePagesIntoIndex([{ id: item.id, title: item.title }])
}

/**
 * «Analizar»: navega hasta la fila y deja la pregunta PREPARADA.
 *
 * No manda nada (§8.20). La intención se apunta ANTES de navegar a propósito:
 * `refreshTab` puede correr en cuanto la pestaña cambie, y apuntarla después
 * sería llegar tarde a la página a la que se acaba de ir. Si el viaje no sale,
 * la intención se tira.
 */
async function analyzeTodayItem(item) {
  if (!item?.host) return false
  const diario = await getActivity(item.host)
  state.pendingIntent = {
    host: item.host,
    kind: item.kind,
    id: item.id,
    question: analyzeQuestion(item, diario),
    at: Date.now(),
  }
  const abierto = await openTodayItem(item)
  if (!abierto) state.pendingIntent = null
  return abierto
}

/**
 * ¿Hemos llegado a la página que esperaba una pregunta? Entonces se fija la
 * Skill y se escribe en el cuadro. La llama `refreshTab`, la última.
 */
async function consumePendingIntent(site) {
  const intent = state.pendingIntent
  if (!intent) return
  // Caduca sola: dos minutos son de sobra para que cargue una página y poco
  // para que el usuario se haya ido a otra cosa. Sin esto, una pregunta
  // preparada aparecería media hora después en un sitio donde ya no viene a
  // cuento, encima de lo que el usuario estuviera escribiendo.
  if (Date.now() - intent.at > TODAY_LIMITS.intentMs) {
    state.pendingIntent = null
    return
  }
  if (!site || site.host !== intent.host) return
  // Host Y identificador, como `esLoAbierto` de today.js: aquí no hay URLs que
  // comparar, y una clave que es prefijo de otra no es la misma página (M3).
  const aqui =
    intent.kind === 'jira-issue'
      ? validIssueKey(site.issueKey) === intent.id
      : String(site.pageId || currentPageId(state.index, state.tabUrl) || '') === intent.id
  if (!aqui) return

  state.pendingIntent = null
  // La Skill se fija de verdad y se guarda, como en «Pedirlo numerado»: el
  // desplegable podía estar en otra cosa y el turno habría salido en otro modo.
  setSkill('analisis')
  await saveSite(site.host, { skill: 'analisis' }).catch(() => {})
  el.input.value = intent.question
  autoGrow()
  el.input.focus()
  // Que la pregunta está escrita y que la manda ÉL hay que decirlo: un cuadro
  // que se rellena solo, sin voz, es magia (A2).
  announce('Pregunta de Análisis preparada en el cuadro. La mandas tú cuando quieras.')
  log.info('Qué mirar hoy', 'pregunta de Análisis preparada en el cuadro, sin mandar')
}

/**
 * «Ya lo he visto»: esa fila deja de recomendarse hasta que cambie.
 *
 * Se guarda cuándo se descartó, nunca antes del cambio que el usuario tenía
 * delante, que es lo que hace que vuelva sola en cuanto alguien la toca DESPUÉS
 * (`dismissItem`). Y se escribe por `dismissActivity`, que está DENTRO de la cola
 * del diario: hasta la revisión adversaria de H11 esto hacía su propio
 * lee-funde-escribe con `getActivity` + `saveActivity`, así que un descarte a la
 * vez que el apunte de un análisis se perdía, y uno en vuelo durante «Borrar mi
 * actividad» devolvía el diario recién borrado.
 */
async function dismissTodayItem(item) {
  const host = String(item?.host || '')
  const clave = activityKey(item?.kind, item?.id)
  if (!host || !clave) return false
  await dismissActivity(host, clave, item.updatedAt)
  // Y fuera de los candidatos que hay en memoria, para que la lista se repinte
  // sin él sin tener que volver a leer nada.
  state.today.candidates = state.today.candidates.filter(
    (c) => !(c.host === host && activityKey(c.kind, c.id) === clave)
  )
  return true
}

/**
 * «Borrar mi actividad»: el diario de este sitio se va entero, y con él su
 * caché de «hoy».
 *
 * También el del Confluence ENLAZADO, cuando lo hay: sus páginas salen en esta
 * misma lista y desde un Jira el usuario no abre nunca el panel de aquel host,
 * así que dejarlo sería prometer un borrado a medias.
 */
async function clearMyActivity() {
  const host = state.site?.host ?? state.lastHost
  if (!host) return false
  const enlazado = linkedSite(state.linkedContext)
  await clearActivity(host)
  await clearTodayCache(host)
  if (enlazado && enlazado.host !== host) {
    await clearActivity(enlazado.host)
    await clearTodayCache(enlazado.host)
  }
  state.today = emptyToday()
  log.ok('Qué mirar hoy', `actividad borrada en ${host}${enlazado && enlazado.host !== host ? ` y ${enlazado.host}` : ''}`)
  announce('Actividad borrada.')
  return true
}

/**
 * Apunta en el diario lo que SÓLO el panel sabe. Nunca lanza.
 *
 * Las tres condiciones son las MISMAS que aplica el service worker antes de
 * apuntar una visita, y por eso se preguntan aquí y no en el módulo: los dos
 * interruptores y que el host esté configurado. Un sitio por el que se pasa sin
 * haberlo configurado no es un sitio que se use, y el diario es de los que se
 * usan (§8.20).
 */
async function noteActivity(host, evento) {
  if (!host || !state.settings.restTools || !state.settings.todaySuggestions) return null
  const saved = await getSite(host)
  if (!saved?.configured) return null
  return recordActivity(host, evento).catch((err) => {
    log.info('Qué mirar hoy no disponible', `no he podido apuntar la actividad de ${host} · ${String(err?.message || err)}`)
    return null
  })
}

/**
 * Que acabas de analizar esto, cuándo, con cuántas observaciones y de qué
 * familia: la razón más fuerte que puede tener una fila de «hoy».
 *
 * La ruta no viaja: la apuntó la VISITA, que es quien sabe de qué URL vino, y
 * el único escritor de lo visto es el service worker.
 */
async function noteAnalyzed({ host, issueKey, pageId, product, issue, summary, site, answer, anchors }) {
  const kind = product === 'jira' ? 'jira-issue' : 'confluence-page'
  const id = product === 'jira' ? issueKey : pageId
  if (!activityKey(kind, id)) return null
  const titulo = cleanTabTitle(summary, site)
  return noteActivity(host, {
    event: 'analyzed',
    kind,
    id,
    title: titulo,
    notes: observationCount(answer, anchors),
    // La familia sólo de una incidencia, y decidida con la MISMA función que
    // elige qué pedirle al modelo (`issue-profile.js`): el diario guarda su
    // forma, no su lista, para no meter el panel en el service worker.
    family: product === 'jira' && issue ? issueFamily(issue, { summary: titulo }) : '',
  })
}

/**
 * Cuántas observaciones trajo la respuesta.
 *
 * La misma escalera que `offerNotes`: la prosa numerada —adaptada si el modelo
 * numeró «a su manera»— y, si ahí no hay números, los del bloque de anclas. Se
 * vuelve a calcular aquí en vez de esperar a `offerNotes` porque el gancho del
 * turno va antes que las marcas: son funciones puras sobre un texto que ya está
 * en memoria (bajo 5 ms en `npm run bench`), y lo que se apunta es cuántas
 * observaciones TUVO el análisis, no cuántas se pudieron subrayar — que una cita
 * no case es cosa de la página, no de lo que el modelo dijo.
 *
 * Límite asumido: una respuesta que no numera en ningún sitio y que sólo
 * `collectSegmentedNotes` acaba troceando se apunta con 0. Es el camino de
 * último recurso y el único que no se puede saber sin gastar otro turno.
 */
function observationCount(answer, anchors) {
  const adaptada = normalizeNumbering(answer, { expected: expectedCount(anchors), shortAnswer: NOTE_LIMITS.shortAnswer })
  return observationNumbers(adaptada.prose, anchors).numeros.length
}

// ------------------------------------------ qué mirar hoy: lo que se ve (H11)

/**
 * La interfaz de «Qué mirar hoy»: la insignia de la cabecera, el bloque del
 * chat vacío y la pantalla con la lista entera.
 *
 * Tres cosas que no cambian según dónde se pinte:
 *  1. Cada fila dice POR QUÉ está ahí, en español, y ese texto lo escribió
 *     `today.js`, no el modelo. Una recomendación que no se puede juzgar de un
 *     vistazo es una bandeja más (§8.20).
 *  2. Nada se abre ni se pregunta solo. «Abrir» navega por el índice y
 *     `validatePlan`; «Analizar» además deja la pregunta ESCRITA en el cuadro y
 *     cierra la pantalla, porque una pregunta que no se ve no se puede corregir
 *     antes de mandarla —y la manda el usuario—.
 *  3. Todo se construye con `createElement`/`textContent`: los títulos son
 *     texto de Jira y de Confluence, escrito por quien creó la página (§8.12).
 */

/**
 * El presupuesto del chat vacío, en LÍNEAS de lo que va debajo del párrafo.
 *
 * Ahí caben tres cosas a la vez: las filas de «hoy», las tres sugerencias que
 * van al modelo y las pastillas de búsqueda al instante de H8. A 320 px cada
 * una ocupa su línea y las pastillas van de dos en dos, así que el bloque
 * entero sólo cabe mientras la suma no pase de `lines`; por encima, «hoy» se
 * degrada a UNA línea que abre la pantalla (decisión 3 de docs/PLAN.md §3.4).
 *
 * De dónde salen los números: tres sugerencias (`SUGGESTION_COUNT`) + tres
 * filas con su rótulo y su «Ver todo» son 8, y con dos pastillas y su rótulo,
 * 10; las cuatro pastillas que puede llegar a ofrecer H8 lo pasan, y ahí se
 * degrada. Es aritmética, no una medida: queda por confirmar a 320 px en el
 * espejo del banco, que es lo único que mide de verdad (`faroPreview.check()`).
 */
const EMPTY_LIMITS = {
  lines: 10,
  chipsPerLine: 2,
}

/** Los tres grupos de la pantalla, en el orden en que se leen. */
const TODAY_GROUPS = ['cambio', 'tuyo', 'proyecto']

/** ¿Está encendido lo de «hoy»? Los dos interruptores, como en `loadToday`. */
function todayEnabled() {
  return !!(state.settings.restTools && state.settings.todaySuggestions)
}

/**
 * ¿Caben las filas de «hoy» en el chat vacío con lo que ya hay debajo?
 *
 * El criterio no MIDE nada: cuenta piezas, que es lo único que se puede decidir
 * sin tener el panel delante (y el panel puede estar oculto cuando se pinta).
 */
function emptyFits(rows, chips) {
  // El rótulo y el «Ver todo» que acompañan a las filas.
  const deHoy = rows > 0 ? rows + 2 : 0
  // Y el rótulo de las pastillas, más las líneas que ocupen envolviendo.
  const dePastillas = chips > 0 ? 1 + Math.ceil(chips / EMPTY_LIMITS.chipsPerLine) : 0
  return deHoy + SUGGESTION_COUNT + dePastillas <= EMPTY_LIMITS.lines
}

/** Lo que se ve de «hoy», de una vez: la insignia, el chat vacío y la pantalla si está abierta. */
function paintTodayUi() {
  paintTodayBadge()
  paintTodayBlock()
  if (!$('screen-today').classList.contains('hidden')) paintToday().catch(console.error)
}

/**
 * La insignia del botón de la cabecera.
 *
 * El número va `aria-hidden` y quien lo dice es el NOMBRE del botón, que cambia
 * con él: un `aria-label` fijo taparía al `title` y un lector de pantalla oiría
 * «Qué mirar hoy» con tres novedades y con ninguna (la lección de `#btn-memory`
 * en la revisión de H5). Y el botón se enciende cuando hay algo: con la
 * insignia sola, a 320 px, un número de 10 px es todo lo que avisa.
 */
function paintTodayBadge() {
  const n = todayEnabled() ? todayCount() : 0
  const insignia = $('today-count')
  insignia.textContent = n ? String(n) : ''
  insignia.classList.toggle('hidden', !n)
  const boton = $('btn-today')
  const nombre = n ? `Qué mirar hoy: ${n} ${n === 1 ? 'novedad' : 'novedades'}` : 'Qué mirar hoy'
  boton.title = nombre
  boton.setAttribute('aria-label', nombre)
  boton.classList.toggle('on', n > 0)
}

/**
 * El bloque del chat vacío: hasta `TODAY_LIMITS.emptyRows` filas y «Ver todo».
 *
 * Se repinta SÓLO esta caja, nunca el estado vacío entero: repintarlo volvería
 * a anunciar «Listo para escuchar» al lector de pantalla cada vez que llega una
 * lectura (A2, el mismo motivo por el que los chips se pintan aparte). Sin
 * filas que enseñar, la caja se queda vacía y oculta y el chat vacío es byte a
 * byte el de siempre.
 *
 * @param {HTMLElement|null} box la caja, si quien llama ya la tiene
 * @param {{chips?: number|null}} opts cuántas pastillas hay debajo; si no se
 *        dice, se cuentan las que estén pintadas
 */
function paintTodayBlock(box = null, { chips = null } = {}) {
  const caja = box || el.chat.querySelector('.empty .today')
  if (!caja?.isConnected) return
  caja.textContent = ''
  const todas = todayEnabled() ? todayRows() : []
  caja.classList.toggle('hidden', !todas.length)
  if (!todas.length) return

  const filas = todas.slice(0, TODAY_LIMITS.emptyRows)
  const pastillas = Number.isInteger(chips) ? chips : el.chat.querySelectorAll('.empty .search-chip').length
  if (!emptyFits(filas.length, pastillas)) {
    // No cabe: una línea, y lo demás en su pantalla. Quien abre el panel para
    // preguntar algo no puede encontrarse media pantalla de recomendaciones.
    caja.appendChild(todayMoreButton(`Qué mirar hoy (${todas.length})`))
    return
  }

  const kicker = document.createElement('div')
  kicker.className = 'today-kicker'
  kicker.textContent = 'Qué mirar hoy'
  caja.appendChild(kicker)
  for (const item of filas) caja.appendChild(todayRowNode(item, { compact: true }))
  if (todas.length > filas.length) caja.appendChild(todayMoreButton(`Ver todo (${todas.length})`))
}

/** «Ver todo (8)» / «Qué mirar hoy (8)»: lo único que hace es abrir la pantalla. */
function todayMoreButton(texto) {
  const b = document.createElement('button')
  b.className = 'today-more'
  b.type = 'button'
  b.textContent = texto
  b.addEventListener('click', () => showTodayScreen().catch(console.error))
  return b
}

/**
 * Una fila, en sus dos formas.
 *
 * Compacta (chat vacío): la fila ENTERA es el botón que la abre. A 320 px no
 * caben tres acciones, y lo que se quiere desde ahí es ir.
 * Completa (pantalla): «Abrir», «Analizar» y la × de «Ya lo he visto», cada una
 * con el título del ítem en su nombre accesible: sin eso, un lector de pantalla
 * lee ocho filas de «Abrir, botón» seguidas.
 */
function todayRowNode(item, { compact = false, desde = 0 } = {}) {
  const nuevo = desde > 0 && item.updatedAt > desde
  const row = document.createElement(compact ? 'button' : 'div')
  row.className = 'today-row' + (compact ? ' compact' : '') + (nuevo ? ' new' : '')
  if (compact) row.type = 'button'

  // Un `span` y no un `div`: en la forma compacta la fila ES un `<button>`, y
  // dentro de un botón sólo cabe contenido de texto (lo mismo que hacen las
  // filas de una búsqueda y las páginas base sugeridas).
  const main = document.createElement('span')
  main.className = 'today-main'

  const kind = document.createElement('span')
  kind.className = 'today-kind'
  kind.textContent = item.kind === 'jira-issue' ? item.id : 'Confluence'

  const title = document.createElement('span')
  title.className = 'today-title'
  title.textContent = item.title
  // El título entero y de qué host es: la fila lo recorta con elipsis, y desde
  // un Jira la mitad de las filas pueden ser del Confluence enlazado.
  title.title = `${item.title} · ${item.host}`

  main.append(kind, title)
  if (item.why) {
    const why = document.createElement('span')
    why.className = 'today-why'
    why.textContent = item.why
    why.title = item.why
    main.appendChild(why)
  }
  row.appendChild(main)

  if (compact) {
    row.setAttribute('aria-label', [`Abrir «${item.title}»`, item.why].filter(Boolean).join(' · '))
    row.addEventListener('click', () => openTodayItem(item).catch(console.error))
    return row
  }

  const acciones = document.createElement('div')
  acciones.className = 'today-actions'

  const abrir = document.createElement('button')
  abrir.className = 'ghost small'
  abrir.type = 'button'
  abrir.textContent = 'Abrir'
  abrir.setAttribute('aria-label', `Abrir «${item.title}»`)
  abrir.addEventListener('click', () => openTodayItem(item, { card: row }).catch(console.error))

  // «Analizar» fija la Skill y escribe en el cuadro: con un turno en vuelo eso
  // dejaría lo que viene después hablando de otro modo, así que lleva el mismo
  // gancho que los botones del chat (H6) y `setStreaming` los devuelve.
  const analizar = document.createElement('button')
  analizar.className = 'ghost small ' + NEEDS_IDLE
  analizar.type = 'button'
  analizar.textContent = 'Analizar'
  analizar.setAttribute('aria-label', `Analizar «${item.title}»`)
  analizar.disabled = state.streaming
  analizar.addEventListener('click', () => analyzeFromToday(item).catch(console.error))

  const x = document.createElement('button')
  x.className = 'today-x'
  x.type = 'button'
  x.title = 'Ya lo he visto'
  x.setAttribute('aria-label', `Ya lo he visto: «${item.title}»`)
  x.textContent = '×'
  x.addEventListener('click', () => forgetTodayRow(item).catch(console.error))

  acciones.append(abrir, analizar, x)
  row.appendChild(acciones)
  return row
}

/**
 * La pantalla: se abre con la lista de AHORA y pone al día «cuándo la miré».
 *
 * Lo nuevo se marca contra la última vez que se miró, así que esa fecha se
 * captura ANTES de ponerla al día: si no, abrir la pantalla borraría justo la
 * marca que dice qué hay que mirar.
 */
async function showTodayScreen() {
  const host = state.site?.host ?? state.lastHost
  const saved = host ? await getSite(host) : null
  // El interruptor por sitio, normalizado al leer: lo que no sea `true` no lo
  // escribió Faro (la misma regla que aplica `loadToday`).
  $('today-off').checked = saved?.todayOff === true
  const desde = state.today.seenAt
  await markTodaySeen()
  await paintToday({ desde })
  showScreen('screen-today')
  paintTodayBadge()
}

/** La lista entera, por grupos, con lo que haya que decir encima. */
async function paintToday({ desde = 0 } = {}) {
  const lista = $('today-list')
  lista.textContent = ''
  const filas = todayEnabled() ? todayRows() : []

  // Por qué la lista viene corta, si es que viene corta: lo que decidió la
  // tregua de `rest-notice.js`, que es la misma de la lista de una búsqueda.
  for (const aviso of state.today.notices) lista.appendChild(noticeNode(aviso, true))

  for (const grupo of TODAY_GROUPS) {
    const suyas = filas.filter((f) => f.group === grupo)
    if (!suyas.length) continue
    const h = document.createElement('h2')
    h.className = 'today-group'
    h.textContent = todayGroupTitle(grupo)
    lista.appendChild(h)
    for (const item of suyas) lista.appendChild(todayRowNode(item, { desde }))
  }

  setTodayStatus(todayStatusText(filas))
  await paintTodayPermission()
  await paintTodayActivity()
}

/** El rótulo de cada grupo. El ámbito sale del sitio, ya validado por `parseAtlassianUrl`. */
function todayGroupTitle(grupo) {
  if (grupo === 'cambio') return 'Cambió desde que lo miraste'
  if (grupo === 'tuyo') return 'Lo tuyo'
  const ambito = state.site?.projectKey || state.site?.spaceKey || ''
  return ambito ? `Nuevo en ${ambito}` : 'Nuevo por aquí'
}

function setTodayStatus(texto) {
  $('today-status').textContent = texto || ''
}

/**
 * La línea de estado: qué hay, de cuándo es, o por qué no hay nada.
 *
 * Los dos interruptores y el de este sitio se dicen por su nombre: una pantalla
 * vacía sin explicación se lee como «aquí no hay nada», que es justo lo
 * contrario de lo que pasa (§8.14).
 */
function todayStatusText(filas) {
  if (!state.settings.restTools) return 'Apagado en Ajustes: «Consultar la API de Jira y Confluence con mi sesión».'
  if (!state.settings.todaySuggestions) return 'Apagado en Ajustes: «Qué mirar hoy».'
  if (!(state.site?.host ?? state.lastHost)) return 'Abre una página de Jira o de Confluence y vuelve.'
  if ($('today-off').checked) return 'Apagado en este sitio: quita la casilla de abajo para volver a mirar.'
  if (state.today.loading) return 'Mirando qué ha cambiado…'
  if (!filas.length) {
    return state.today.fetchedAt
      ? `Nada que mirar ahora mismo · leído a las ${clockTime(state.today.fetchedAt)}`
      : 'Todavía no he mirado nada en este sitio.'
  }
  return `${filas.length} ${filas.length === 1 ? 'cosa' : 'cosas'} que mirar · leído a las ${clockTime(state.today.fetchedAt)}`
}

/**
 * El permiso que falta, si falta: el del sitio de la pestaña o el del
 * Confluence enlazado, que es a quien se le pregunta desde el panel.
 *
 * En `*.atlassian.net` no falta nunca (lo declara el manifest); en un sitio
 * propio, sin él no hay content script que pregunte ni cookies que mandar.
 */
async function todayMissingPermission() {
  const site = state.site
  if (site && !(await hasHostPermission(site.origin))) return { origin: site.origin, host: site.host, tabId: state.tabId }
  const enlazado = linkedSite(state.linkedContext)
  if (enlazado && !(await hasHostPermission(enlazado.origin))) {
    return { origin: enlazado.origin, host: enlazado.host, tabId: null }
  }
  return null
}

async function paintTodayPermission() {
  const fila = $('today-perm')
  const falta = todayEnabled() ? await todayMissingPermission() : null
  fila.classList.toggle('hidden', !falta)
  if (falta) $('today-perm-text').textContent = `Sin permiso sobre ${falta.host} no puedo mirar qué ha cambiado ahí.`
}

/** «Dar permiso» desde aquí: la tarjeta del chat queda tapada por esta pantalla. */
async function askTodayPermission() {
  const falta = await todayMissingPermission()
  if (!falta) return
  const btn = $('btn-today-permission')
  btn.disabled = true
  const r = await requestHostPermission(falta)
  btn.disabled = false
  if (r.ok) {
    setTodayStatus(`Listo. Ya puedo mirar qué ha cambiado en ${falta.host}.`)
    await refreshToday()
    return
  }
  setTodayStatus(r.denied ? manualPermissionText(falta.origin) : 'Permiso dado, pero no he podido preguntar: ' + r.error)
}

/**
 * Qué se guarda y dónde, con las cuentas de este sitio.
 *
 * Es la promesa de §8.20 escrita donde se ve: el diario es del usuario, vive en
 * su navegador, no entra en ningún prompt y se borra de un botón. Los números
 * son del host que hay delante; el del Confluence enlazado se borra con él.
 */
async function paintTodayActivity() {
  const host = state.site?.host ?? state.lastHost
  const diario = host ? await getActivity(host) : null
  const { entradas, analisis, base, descartes } = activityCounts(diario)
  $('today-activity-text').textContent =
    `El diario son ids, claves y títulos —nunca la dirección entera ni lo que pone la página— de lo que abres, ` +
    `analizas o usas como página base aquí: ${entradas} ${entradas === 1 ? 'entrada' : 'entradas'}, ` +
    `${analisis} ${analisis === 1 ? 'análisis' : 'análisis'}, ${base} ${base === 1 ? 'página base' : 'páginas base'} y ` +
    `${descartes} ${descartes === 1 ? 'descarte' : 'descartes'}. ` +
    `Se guarda en este navegador, ${ACTIVITY_LIMITS.maxAgeDays} días como mucho, no sale de aquí y no entra en nada de ` +
    `lo que se le manda al modelo. Borrarlo no borra nada en Jira ni en Confluence.`
}

/**
 * Las cuentas del diario: números, nunca títulos ni ids (§8.20).
 *
 * Los descartes cuentan porque son datos guardados: un «ya lo he visto» es una
 * clave más en el disco de su navegador, y decir «0 entradas» de un diario que
 * tiene doce descartes dentro sería la promesa a medias que encontró la revisión
 * adversaria de H11.
 */
function activityCounts(activity) {
  const items = Object.values(activity?.items || {})
  return {
    entradas: items.length,
    analisis: items.filter((i) => i?.analyzedAt).length,
    base: items.filter((i) => i?.sourceAt).length,
    descartes: Object.keys(activity?.dismissed || {}).length,
  }
}

/**
 * «Analizar» desde una fila: navega, deja la pregunta escrita y cierra.
 *
 * Cerrar no es cosmético: la pregunta se escribe en el cuadro del chat, que
 * está DEBAJO de esta pantalla, y con `#app` inerte el foco ni siquiera
 * llegaría. Quien no quiere mandarla la borra; nadie la manda por él (§8.20).
 */
async function analyzeFromToday(item) {
  if (state.streaming) {
    showNotice('Espera a que termine la respuesta.', false, { force: true })
    return
  }
  const abierto = await analyzeTodayItem(item)
  if (!abierto) {
    setTodayStatus('No he podido abrir esa fila; lo que ha pasado está en el chat.')
    return
  }
  hideScreens()
}

/** «Ya lo he visto»: fuera de la lista hasta que vuelva a cambiar. */
async function forgetTodayRow(item) {
  if (!(await dismissTodayItem(item))) return
  // En el Registro, sólo de qué host: un título ahí lo lee cualquiera que mire
  // la pantalla de estado con el panel abierto (§8.20).
  log.info('Qué mirar hoy', `una fila descartada en ${item.host}`)
  announce(`Quitada de la lista: ${item.title}.`)
  await paintToday()
  paintTodayBadge()
}

/** «Actualizar»: se salta la caché de sesión y vuelve a preguntar. */
async function refreshToday() {
  const btn = $('btn-today-refresh')
  btn.disabled = true
  setTodayStatus('Mirando qué ha cambiado…')
  try {
    await loadToday({ force: true })
  } finally {
    btn.disabled = false
  }
  await paintToday()
  paintTodayBadge()
}

/** «Borrar mi actividad»: el diario de este sitio y el del enlazado, y su caché. */
async function forgetTodayActivity() {
  if (!(await clearMyActivity())) return
  await paintToday()
  paintTodayBadge()
  paintTodayBlock()
}

/**
 * «No sugerir nada en este sitio».
 *
 * Es por SITIO y no un ajuste global: un Confluence de referencia que no cambia
 * nunca se calla sin apagar las recomendaciones del Jira donde se trabaja.
 * Apagarlo tira lo leído; encenderlo vuelve a preguntar en el acto, porque si
 * no habría que cambiar de pestaña para ver algo.
 */
async function setTodayOff(off) {
  const host = state.site?.host ?? state.lastHost
  if (!host) return
  await saveSite(host, { todayOff: !!off })
  log.info('Qué mirar hoy', `${off ? 'apagado' : 'encendido'} en ${host}`)
  if (off) {
    state.today = emptyToday()
    announce('No volveré a sugerir nada en este sitio.')
    await paintToday()
    paintTodayUi()
    return
  }
  announce('Vuelvo a mirar qué cambia en este sitio.')
  await refreshToday()
  paintTodayBlock()
}

/**
 * La casilla de «Qué mirar hoy» en Ajustes cuelga de la de las lecturas REST.
 *
 * Desactivada conserva lo que el usuario eligió (un `input` desactivado no
 * pierde su `checked`), así que apagar y encender el interruptor maestro no le
 * cambia esta preferencia por detrás; lo que hace es decir por qué no se puede
 * marcar, en vez de dejar una casilla que no haría nada.
 */
function paintTodaySetting() {
  const maestro = $('set-rest-tools').checked
  $('set-today').disabled = !maestro
  $('set-today-hint').classList.toggle('hidden', maestro)
}
