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
import {
  pickDefaultModel,
  pickRetryModel,
  pickPlannerModel,
  modelKey,
  parseModelKey,
  classifyModelFailure,
  verdictsForFailure,
  modelVerdict,
  modelsFingerprint,
  recommendModel,
  resolveModel,
  usableModels,
} from '../shared/models.js'
import {
  parseAtlassianUrl,
  canonicalPagePath,
  cleanTabTitle,
  describeLocation,
  defaultScope,
  locationParts,
  samePage,
  validIssueKey,
  validProjectKey,
  validSpaceKey,
  isRealSpaceKey,
  wikiPrefix as wikiPrefixOf,
} from '../atlassian/site.js'
// El ámbito —el espacio o el proyecto de la pestaña— dentro de un host (H21,
// docs/PLAN2.md §3.4): el contexto y el mapa son suyos, y todo lo que decide qué
// ámbito toca, qué contexto le va y si tiene mapa vive en ese módulo puro.
import {
  emptyContexts,
  normalizeContexts,
  contextFor,
  contextScopeFor,
  withContext,
  withoutContext,
  scopeKeyOf,
  scopeKeyFromScope,
  scopeLabel,
  scopeKeys,
  pagesOfSpace,
  withoutSpace,
  stampSpace,
  hasMap,
  otherScopesWithMap,
  countPages,
  spaceOverflow,
  normalizeLinkedSpaces,
  withLinkedSpace,
  linkedSpacesFor,
} from '../shared/scopes.js'
import { mergeIndex, mergeIndexKeepingTree, indexSize, normalizeIndex, ancestryOf, isPlaceholderTitle } from '../atlassian/index-store.js'
import {
  CORS_ORIGIN,
  DEFAULT_SETTINGS,
  INDEX_LIMITS,
  MCP_RELOAD_LIMITS,
  OPENCODE_VERIFIED_VERSION,
  PROFILE_LIMITS,
  RESTORE_LIMITS,
  SESSION_LIMITS,
  mcpNameForHost,
} from '../shared/config.js'
import { MSG } from '../shared/messages.js'
import {
  JIRA_REST_LIMITS,
  SAMPLE_FIELDS,
  emptyProfiles,
  normalizeProfiles,
  withProfile,
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
  getIndex, saveIndex, getProfiles, saveProfiles, getSessionId, setSessionId, clearSessionId,
  getSessionWeight, setSessionWeight, clearSessionWeight,
  getModelChecks, recordModelChecks, clearModelChecks,
} from '../shared/storage.js'
import { renderMarkdown } from './markdown.js'
// Los diagramas del chat (H24): un ```mermaid cerrado se lee con un parser
// propio, se coloca y se pinta en SVG sin innerHTML (`drawCodeBlock`).
import { readFlowchart, toMermaid, offerDiagramKeys, DIAGRAM_LIMITS } from './diagram-parse.js'
import { layoutDiagram } from './diagram-layout.js'
import { diagramNode, textMeasurer } from './diagram-view.js'
import { jiraDiagram, resumenJira, clavesDelIndice } from './diagram-links.js'
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
  adoptionRecords,
  mcpForHost,
  chosenMcpName,
  mcpFailureHint,
  buildMcpConfig,
  mcpEntriesForHost,
  uvxAbsoluteCommand,
  keysUnverified,
  mcpScrubCandidates,
  scrubMcp,
  scrubEffective,
  unlinkRecords,
  scrubConfirmText,
  PRODUCTS,
} from './setup.js'
import { buildContext, harvestIndex, harvestFromSearch, indexFromSpacePages, countWithParent, knownProjectsFor } from './indexer.js'
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
import { restFailureDue, jqlFailText, linksFailText, failReason, sinAccesoMotivo } from './rest-notice.js'
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
  // Los contextos del HOST por ámbito (H21, §8.26): `{version: 2, scopes}` de
  // scopes.js, o `emptyContexts()`. Todos los del host están en memoria a la vez
  // —cambiar de espacio no cuesta ninguna lectura del almacén—, y de aquí salen
  // los dos de abajo, que son DERIVADOS: `contextMd` es el texto que toca al
  // ámbito de la pestaña (el suyo, o el de todo el sitio) y `contextScope` la
  // clave de ese texto ('' sin contexto). Nadie los escribe a mano: los
  // recalcula `applyScope()`, salvo el vaciado a '' al cambiar de host.
  contexts: emptyContexts(),
  contextMd: '',
  contextScope: '',
  // Con qué regla migró el arranque el contexto de antes de H21 en ESTE host
  // (`{legacyScope, legacyIndexedAt}`, o null): las relecturas del indexado, del
  // contexto subido y del olvido la repiten, porque si la reparación del
  // arranque no se pudo escribir, lo guardado sigue siendo el texto viejo y
  // `getContexts` lo repararía bajo «*» contra lo que el arranque decidió
  // (revisión adversaria de H21, B9). Es del host: se vacía con él.
  contextLegacy: null,
  memory: { entries: [] },
  sessionID: null,
  model: null,
  models: [],
  // Lo que Faro recuerda de qué modelos contestan y cuáles no (H16, §8.25): el
  // objeto normalizado de `faro:model-checks` o null. Es GLOBAL —de la persona y
  // de su opencode, no de un sitio—, así que el cambio de host no lo toca; lo
  // vacía el cambio de servidor en Ajustes y lo relee cada arranque con la lista
  // de modelos delante, porque sin ella no se sabe si sigue valiendo (un
  // `opencode auth login` cambia la lista y deja viejo todo lo apuntado).
  modelChecks: null,
  // El modelo que la configuración de opencode dice por defecto (`config.model`
  // de GET /config), SÓLO ese campo y ya validado como {providerID, modelID}, o
  // null si no hay; `undefined` es «todavía no se ha preguntado» (H17). La
  // configuración entera lleva las claves de los MCP en claro y no se guarda en
  // ningún sitio: de ella sólo sale esto. Lo pone `checkMcp`, que ya la lee, y
  // si la pantalla «Elige el modelo» se abre antes (el primer uso), la propia
  // pantalla la pide. Como `modelChecks`, es del SERVIDOR y no del sitio: lo
  // vacía el cambio de servidor en Ajustes, no el de host.
  configModel: undefined,
  // La pantalla «Elige el modelo» abierta: {modo, motivo, marcado, elegido,
  // keepContext, pregunta} o null. `marcado` es la clave con la que se abrió y
  // `elegido` la que el usuario ha tocado; sin ninguna de las dos se
  // preselecciona (`modelScreenChoice`).
  modelScreen: null,
  // La sonda de «Comprobar» en vuelo, para cancelarla si se tira el cliente.
  modelProbeAbort: null,
  // El modelo que la persona eligió A SABIENDAS con un fallo apuntado (su clave,
  // o ''): durante esta sesión del panel el arranque no lo vuelve a apartar.
  modelAceptado: '',
  skill: DEFAULT_SKILL,
  pendingPick: null,
  picking: false,
  // Las páginas base del análisis y su alcance, por sitio. Se cargan con el
  // sitio y se vacían al cambiar de host: el chip no puede enseñar las del
  // sitio anterior.
  sources: emptySources(),
  mcpConnected: false,
  // La comprobación del MCP de este sitio, que desde P5 (H14) NO bloquea el
  // arranque: una promesa que resuelve a si está conectado, nunca rechaza y la
  // pone `bootForSite` en su paso 3. `send()` la captura al mandar y le pregunta
  // al terminar el turno, porque mientras está en vuelo `mcpConnected` todavía
  // dice «false» y el aviso «Páginas base sin leer» saldría mintiendo.
  mcpCheck: null,
  // Lo que la comprobación decidió y todavía no se ha podido ENSEÑAR: {host,
  // status} o null (revisión adversaria de H14). Con la pestaña en el correo no
  // hay pantalla de claves que abrir (`showSetupScreen` lee `state.site`), y con
  // la pantalla de contexto delante el chat se va a vaciar (`restoreConversation`)
  // y un aviso colgado ahí se perdería: se guarda y lo enseña `showMcpPending`
  // cuando el panel vuelve al sitio o cuando el chat se repinta.
  mcpPending: null,
  // Desde Jira, el contexto del Confluence enlazado: {host, ctxs, index,
  // wikiPrefix, contextMd, contextScope, otherScopes, via} o null. El prefijo es
  // el observado al visitarlo, si se visitó: hace falta para preguntarle a su API
  // desde aquí. `ctxs` son TODOS los contextos de ese Confluence, ya
  // normalizados; los otros cuatro los deriva `applyLinkedScope` por proyecto
  // (H22): `contextMd` el texto que viaja, `contextScope` de qué ámbito es (para
  // que la cabecera del bloque lo diga), `otherScopes` las claves de los demás
  // espacios con contexto y `via` por qué regla se eligió.
  linkedContext: null,
  // Desde Jira, lo elegido en Ajustes para cada proyecto: qué espacio del
  // Confluence enlazado lo documenta (`sites[host].linkedSpaces`, proyecto →
  // espacio o «*»), ya normalizado. Manda sobre las reglas de `linkedSpacesFor`.
  linkedSpaces: {},
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
  // La pestaña del último «Llévame» lanzado desde este panel, hasta que llegue
  // su PLAN_FINISHED (revisión adversaria de H28, D7). `navRun` sólo existe en
  // un recorrido paso a paso, y con el filtro por pestaña de `onRuntimeMessage`
  // el final de un salto directo se perdía si el panel ya miraba otra pestaña:
  // ni «Navegación detenida» ni «Sin resaltar». Es un campo aparte y no un
  // `navRun` sin «Parar» porque un «Llévame» en otra tarjeta pisaría el
  // recorrido en marcha y dejaría su «Parar» huérfano. Sólo memoria.
  saltoTabId: null,
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
  // La comprobación de las claves en vuelo (`finishSetup`): son uno o dos
  // turnos, y `buildClient` la cancela al cambiar de sitio (revisión adversaria
  // de H16).
  setupAbort: null,
  // Lo que cancela el botón del velo «Trabajando…», si hay algo que cancelar:
  // sin esto, el Cancelar de «Guardando lo aprendido» no cancelaba nada.
  busyAbort: null,
  pendingMcp: null,
  snippets: null,
  mcpWait: null,
  // La versión de opencode, leída de `GET /global/health` en cada arranque
  // (H18): la recarga en caliente de su configuración está verificada SÓLO en
  // `OPENCODE_VERIFIED_VERSION`, y con otra el texto de espera lo dice. '' si no
  // se sabe (y entonces no se dice nada: no se puede afirmar lo que no se ve).
  opencodeVersion: '',
  // La pantalla de claves abierta desde «Cambiar las claves» (H18): el
  // consentimiento para escribir en opencode se pide SIEMPRE, aunque ya se diera
  // una vez, porque la guarda «opencode se está reconfigurando» es local a este
  // panel y no ve otras ventanas de Chrome ni la TUI conectadas al mismo opencode.
  setupConfirmar: false,
  // «Quitar las claves de este sitio» (H19): lo que la confirmación enseña y
  // el usuario va a confirmar —{host, propias, ajenas, noQuitables,
  // hostsEnlazados, carpeta, ajenasApagadas, conRestos} (`planQuitar`), todo
  // NOMBRES y hosts, nunca una entrada con su environment— o null. Es de ESTA
  // vez: Ajustes lo tira al abrirse y el cambio de sitio también, porque la
  // lista era de lo que opencode tenía entonces.
  removeKeysPlan: null,
  // El testigo de `prepareRemoveKeys` (revisión adversaria de H19): {} mientras
  // lee y mientras su confirmación está abierta, o null. Una lectura cuyo
  // testigo ya no es éste no pinta nada; lo suelta `hideRemoveKeysConfirm`.
  removeKeysPrep: null,
  // El aviso «claves sin comprobar» colgado del chat, para no colgarlo dos veces
  // y quitarlo en cuanto la primera verificación las dé por buenas (H18).
  avisoSinComprobar: null,
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
  // Lo que la extensión contó de una muestra de CADA proyecto de este Jira
  // (`normalizeProfiles`, H22: `{version, byProject: {KEY: perfil}}`): los
  // nombres EXACTOS de tipo, estado, componente y etiqueta, y cómo se nombran
  // los tickets aquí. De ahí salen los chips de estado y el bloque DATOS DEL
  // PROYECTO del prompt de Búsqueda, siempre por `currentProfile`, que da el del
  // proyecto que hay delante. Se carga con el paquete del sitio, se vuelve a
  // contar cuando envejece y `refreshTab` lo vacía al cambiar de host.
  profiles: emptyProfiles(),
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
  // «Dibujar el flujo» (H24): `{host}` o null. El botón manda su pregunta
  // (decisión 17) y, antes, apunta aquí que es para dibujar, con el host
  // donde se pulsó; `send()` lo consume como la precarga, y `offerNotes` sabe
  // así que una respuesta que es un diagrama no es un análisis que marcar.
  // Sólo memoria.
  pendingDiagram: null,
  // La intención de «Analizar» que dejó una fila de «hoy»: se navega y, cuando
  // la pestaña llega a esa página, se fija la Skill Análisis y se deja la
  // pregunta ESCRITA en el cuadro, sin mandarla (§8.20: Faro nunca manda una
  // pregunta por su cuenta). `{host, kind, id, question, at}` o null; la
  // consume `refreshTab` y caduca sola a los `TODAY_LIMITS.intentMs`.
  pendingIntent: null,
  // Por qué el content script de la pestaña no sirve (H27, PLAN3 §3.1):
  // `{host, tabId, error}` o null. Con el permiso dado, un script que está y no
  // arranca (G1: un import denegado) se confundía con «no hay script» y el panel
  // pedía un permiso que ya tenía. Lo apunta `noteContentProblem` cuando el
  // service worker dice que el script está vivo y roto, o que tras inyectarlo
  // nadie contesta; lo vacía `ensureContentAccess` en cuanto la pestaña contesta
  // bien o lo que falta es el permiso, así que dice lo último que se vio. Va con
  // su pestaña y su host: `showPermissionNotice` sólo lo cambia por el aviso de
  // recargar cuando es de la que hay delante. Sólo memoria.
  contentProblem: null,
  // Por qué no se pudo leer el camino de una página (H28, PLAN3 §3.2):
  // `{host, id, motivo}` o null. `learnAncestry` lo apunta cuando falla —sin
  // acceso a la pestaña o con la API sin contestar—, lo repone en la tregua
  // con el motivo que guardó el fallo, y lo vacía cuando lee el camino o ya lo
  // tenía. Sin él, la tarjeta que se queda en «Llévame» porque el camino no
  // llegó era idéntica a la de una página que cuelga de la portada (cero ramas,
  // que es diseño), y el porqué sólo estaba en el Registro. `offerNavigation`
  // lo vacía al empezar a planificar, para que sea de ESTA planificación (la
  // revisión adversaria de H28, D9, vio una nota de un fallo en Guiada colgada
  // de la tarjeta de Rápida, que no lee el camino), y lo cuelga de la tarjeta
  // si es del mismo destino y host. Sólo memoria.
  ancestryNote: null,
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
  // Y la comprobación de las claves, que son uno o dos turnos de modelo: con el
  // cliente cerrado su turno acababa «colgado», `finishSetup` apuntaba un
  // «mudo» falso de un día y cerraba las pantallas del sitio NUEVO (revisión
  // adversaria de H16). Con la señal abortada, `verifyCredentials` vuelve con
  // `reason 'cancelado'` y `finishSetup` se va sin tocar nada.
  if (state.setupAbort) {
    state.setupAbort.abort()
    state.setupAbort = null
  }
  // Y la sonda de «Comprobar» (H17): con el cliente tirado no dice nada del
  // modelo, y su veredicto sería del servidor de antes.
  if (state.modelProbeAbort) {
    state.modelProbeAbort.abort()
    state.modelProbeAbort = null
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
    // Y «Dibujar el flujo» (H24), por lo mismo: era sobre la respuesta de aquí.
    state.pendingDiagram = null
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
  // Otro ÁMBITO del mismo host (H21, docs/PLAN2.md §3.4): otro espacio de este
  // Confluence u otro proyecto de este Jira. No hay arranque —el host es el
  // mismo—, pero el contexto que toca es otro. Se calcula AQUÍ, antes de
  // reasignar `state.site`, y sólo en el camino sin cambio de host (con él,
  // `bootForSite` lo recalcula todo). Y SIN leer nada del almacén: todos los
  // contextos del host ya están en `state.contexts`.
  const changedScope = !changedHost && !!site && !!state.site && scopeKeyOf(site) !== scopeKeyOf(state.site)
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
    // Los contextos por ámbito son del HOST: se vacían todos, y con ellos los
    // dos derivados (el único sitio, con el olvido, donde se escriben a mano).
    state.contexts = emptyContexts()
    state.contextMd = ''
    state.contextScope = ''
    state.contextLegacy = null
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
    state.profiles = emptyProfiles()
    // Y lo elegido en Ajustes para el Confluence enlazado de ESTE Jira: lo
    // recarga `bootForSite` del registro del sitio nuevo.
    state.linkedSpaces = {}
    // Y si el MCP está conectado, que es de ESTE sitio: lo vuelve a comprobar el
    // arranque del nuevo, en segundo plano (P5). Hasta que conteste no se sabe,
    // y quien pregunte por él se lleva el lado prudente.
    state.mcpConnected = false
    state.mcpCheck = null
    state.mcpPending = null
    // Y la confirmación de «Quitar las claves» (H19): su lista era del sitio de
    // antes, y confirmarla aquí quitaría lo que ya no se está mirando.
    hideRemoveKeysConfirm()
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

  // El ámbito cambió dentro del mismo host: el contexto que toca es el del
  // ámbito nuevo, sin ninguna lectura (están todos en `state.contexts`). Y al
  // VOLVER de fuera de Atlassian también, aunque `changedScope` no lo vea —con
  // la pestaña en el correo `state.site` era null y no hay con qué comparar—:
  // se pudo salir desde un espacio y volver a otro. Recalcular es barato y
  // siempre da lo mismo para el mismo ámbito.
  if (changedScope || (volviaDeFuera && !changedHost)) applyScope()
  // Con Ajustes abierto, el selector del enlazado, la lista de ámbitos y la
  // línea de «Este sitio» se repintan: la pantalla no se queda con el proyecto
  // (ni el ámbito) de antes, que era el que el selector guardaba (revisión
  // adversaria de H22, G02).
  if ((changedScope || (volviaDeFuera && !changedHost)) && !$('screen-settings').classList.contains('hidden')) { paintLinkedSpaceSetting(); paintScopeList(); paintSettingsSiteInfo() }
  // Y si el chat está vacío, su estado vacío es del ámbito de antes (la línea
  // «aún no tiene mapa», las páginas del espacio): se repinta, SIN volver a
  // anunciar «Listo para escuchar» (A2), que cambiar de espacio no es abrir el
  // panel. La nueva ocupa el SITIO de la vieja: quitarla y colgar la nueva al
  // final dejaba arriba los avisos que colgaban debajo de ella (revisión
  // adversaria de H21, B12).
  if (changedScope && !state.streaming) {
    const vacio = el.chat.querySelector('.empty')
    if (vacio) showWelcome({ announce: false, replace: vacio })
  }

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
  // El MCP acabó de cargar mientras la pestaña estaba fuera, o un arranque se
  // pidió sin sitio delante: el arranque que no se pudo hacer se hace ahora.
  // DELANTE de la rama del perfil (revisión adversaria de H15): en un Jira sin el
  // perfil de ese proyecto, esa rama se ponía primero y se tragaba el arranque,
  // que no se hacía nunca —un fallo de antes de H15—. Arrancar ya cuenta el
  // perfil (`refreshProfileSoon` al final de `bootForSite`).
  else if (state.bootPending === site.host) await bootForSite()
  // Otro PROYECTO del mismo Jira: no hay arranque. Desde H22 los perfiles se
  // guardan POR PROYECTO (`state.profiles.byProject`), así que volver a uno ya
  // contado encuentra el suyo en `currentProfile(site)` y no se recuenta nada;
  // sólo se cuenta el de un proyecto que todavía no tiene, en segundo plano y
  // con las mismas condiciones del arranque (permiso ya concedido, restTools,
  // Data Center). `refreshTab` corre en cada cambio de pestaña y de URL, así que
  // se pregunta UNA vez SEGUIDA por proyecto (`state.profileAsked`, el último
  // proyecto pedido): volver al mismo sin pasar por otro sin perfil no vuelve a
  // pedir; alternar entre dos proyectos sin perfil con la API fallando pide una
  // vez por salto (límite asumido). Una API que no contesta no puede convertirse
  // en una petición por cada clic.
  else if (site.product === 'jira' && site.projectKey && !currentProfile(site) && state.profileAsked !== `${site.host}:${site.projectKey}`) {
    refreshProfileSoon(state.bootToken)
  }
  // Volver de fuera al MISMO sitio no rearranca nada —el cliente, el índice y
  // la sesión siguen siendo suyos—, pero el chat se había quedado con el «Abre
  // Jira o Confluence»: se vuelve a pintar y ya.
  else if (volviaDeFuera && !state.streaming) await restoreConversation()

  // Y, ya con el sitio puesto, la intención de «Analizar» que dejó una fila de
  // «Qué mirar hoy» si hemos llegado a la página que la esperaba. Va lo ÚLTIMO
  // a propósito: `bootForSite` fija la Skill guardada del sitio, y hacerlo
  // antes sería que la pisara justo la que el usuario acaba de pedir.
  await consumePendingIntent(site)
  // Y lo que la comprobación del MCP decidió mientras la pestaña estaba fuera:
  // ahora hay sitio, así que se puede enseñar. Detrás de la intención: si ésta
  // dejó una pregunta en el cuadro, la pantalla no se abre sola y se avisa.
  showMcpPending()
}

/** Arranque completo para un sitio: servidor, claves, contexto. */
async function bootForSite() {
  // Sin sitio delante no hay arranque posible: todo lo de abajo lee
  // `state.site.host`. Pasó en la revisión adversaria de H15: «Reintentar»
  // compara con `lastHost`, así que irse al correo durante los ~12 s de
  // `connectMcp` no contaba como cambio de sitio y, al volver conectado y sin
  // turno, `bootForSite()` reventaba en `getSiteBundle(state.site.host)` —sin
  // catch— con la cabecera clavada en «comprobando…». Vale para cualquier
  // llamante: el arranque queda PENDIENTE para el sitio del panel y `refreshTab`
  // lo hace al volver, como el de `finishSetup` (C5). Va ANTES del testigo: un
  // arranque que no puede empezar no tiene por qué apagar el que hubiera.
  if (!state.site) {
    if (state.lastHost) state.bootPending = state.lastHost
    return
  }
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
  // Y un resultado del MCP sin enseñar es del arranque anterior: éste lanza su
  // propia comprobación y lo que diga ésa es lo que vale.
  state.mcpPending = null

  // Cuánto cuesta abrir el panel, fase por fase. Hasta H3 nadie lo veía: el
  // `GET /mcp` del paso 3 tarda entre 2,8 y 14,5 s la primera vez tras arrancar
  // opencode (medido en la auditoría del 2026-09-13 contra un servidor
  // desechable y el 2026-09-21 contra el opencode del usuario) y el chat lo
  // esperaba entero. Ese número es el que decidió sacarlo del camino en H14, así
  // que desde entonces sólo lo espera —y sólo entonces hay fase «MCP»— el sitio
  // que todavía no está configurado; el resto lo comprueba en segundo plano y lo
  // registra aparte.
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
  // La versión de opencode (H18), SIN esperarla: es el mismo `GET /global/health`
  // de arriba otra vez, pero el chat no tiene por qué pagar su ida y vuelta. Sólo
  // se usa en el texto de espera de la pantalla de claves, y se apunta sólo si
  // el cliente sigue siendo éste cuando conteste (§8.22: es del servidor).
  client
    .version()
    .then((v) => {
      if (state.client === client) state.opencodeVersion = v
    })
    .catch(() => {})

  // 2. Todo lo que este sitio tiene guardado, la lista de modelos y la sesión
  // abierta: las tres cosas A LA VEZ, y lo de storage en UNA sola lectura.
  // El host se captura aquí para la reparación del contexto de más abajo
  // (§8.22): tras el await, con la pestaña en el correo, `state.site` es null.
  const hostArranque = state.site.host
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
  // Los contextos del host, por ámbito (H21). Lo guardado sale CRUDO del
  // paquete: puede ser el texto de antes de H21, y ése migra bajo el ámbito del
  // índice sólo si se puede afirmar que es suyo (`legacyScopeOf`); si no, bajo
  // «*», que se enseña en todos los espacios, o sea como hasta hoy.
  // La regla se guarda: las relecturas de este host la repiten (revisión
  // adversaria de H21, B9).
  state.contextLegacy = { legacyScope: legacyScopeOf(bundle, saved), legacyIndexedAt: saved?.indexedAt }
  state.contexts = normalizeContexts(bundle.contextRaw, state.contextLegacy)
  applyScope()
  // La migración se REPARA una vez, como la memoria: el texto viejo se escribe
  // ya con su forma nueva y el arranque siguiente no vuelve a decidir nada. Con
  // el host capturado antes de leer y el testigo al volver (§8.22). Si no se
  // puede escribir, lo normalizado vale igual en memoria y se reintenta en el
  // próximo arranque: sólo se pierde la reparación. La clave y los caracteres se
  // calculan ANTES del await, de lo recién normalizado, y el registro va en
  // cuanto vuelve la escritura, DELANTE del testigo: la escritura ya está hecha
  // y el arranque siguiente ve un v2 y no vuelve a migrar, así que saltárselo
  // era no registrarlo nunca (revisión adversaria de H21, C11). Y si el texto
  // viejo pasaba del tope de un ámbito, se dice que se recortó (A6).
  if (typeof bundle.contextRaw === 'string' && bundle.contextRaw.trim()) {
    const [clave = '*'] = scopeKeys(state.contexts)
    const largo = state.contexts.scopes[clave]?.text.length || 0
    const original = bundle.contextRaw.trim().length
    const reparado = await memory.saveContexts(hostArranque, state.contexts).then(
      () => true,
      () => false
    )
    if (reparado && original > largo) {
      log.warn('Contexto migrado', `${hostArranque} · ${clave} · ${largo} de ${original} caracteres (recortado a textMax)`)
    } else if (reparado) {
      log.info('Contexto migrado', `${hostArranque} · ${clave} · ${largo} caracteres`)
    }
    if (state.bootToken !== testigo) return
  }
  // La memoria se reconstruye con claves blancas al leerla, como siempre. Lo
  // que aquí NO se hace es repararla en el almacén: esa escritura la sigue
  // haciendo `getMemory`, por donde pasa la pantalla de memoria justo antes de
  // que se pueda borrar una entrada por su `at`, que es para lo que hacía falta.
  state.memory = memory.normalizeMemory(bundle.memoryRaw)
  state.index = bundle.index
  if (bundle.stale) {
    log.warn('Índice descartado', 'era de una versión anterior de Faro; hay que reconstruir el contexto')
  }
  // ¿Es la primera vez en este sitio? Ni configurado ni con las claves saltadas a
  // propósito. Se decide AQUÍ, antes del modelo, porque desde H17 manda dos
  // cosas del primer uso (docs/PLAN2.md §3.3, la máquina de estados): sin modelo
  // resuelto se elige ANTES de lanzar nada más (paso 1), y el MCP se espera sólo
  // entonces (paso 3). Sólo depende de lo guardado, que ya está leído.
  const primeraVez = !saved?.configured && !saved?.skippedKeys
  // Se pregunta por la LISTA, no por el error: así una respuesta rara (o un
  // rechazo sin motivo) acaba en el aviso y no en un TypeError que se llevaría
  // el arranque entero, que es justo lo que el try/catch de antes evitaba.
  // Lo que haya que decir del modelo de esta vez (su modelo apartado, o todos
  // marcados) se enseña tras restaurar la conversación, que vacía el chat: desde
  // H17 es el MOTIVO de la pantalla «Elige el modelo», o el de su aviso.
  let avisoModelo = ''
  if (Array.isArray(modelos?.models)) {
    state.models = modelos.models
    state.defaults = modelos.defaults
    // El modelo es de la PERSONA, no del sitio (H16, §8.25). Hasta aquí cada
    // host guardaba el suyo en `saved.model` y, sin él, se elegía solo el primer
    // predeterminado del mapa de opencode —en la máquina del compañero,
    // `openai/gpt-5.4`, que su plan rechaza—, y el fallo acababa culpando a las
    // claves. Ahora: lo que la persona eligió (`settings.model`) si sigue en la
    // lista y no tiene un fallo apuntado; si no, el del sitio UNA vez, como
    // migración; y nada más: `resolveModel` nunca elige solo.
    // Lo apuntado de cada modelo se lee aquí y no en el `Promise.all` de arriba
    // porque su huella SON los modelos de la lista: sin ella no se sabe si esos
    // veredictos son de este opencode. Una lectura local más, detrás de la red.
    const ahora = Date.now()
    const checks = await getModelChecks({
      server: state.settings.serverUrl,
      fingerprint: modelsFingerprint(modelos.models),
      now: ahora,
    }).catch(() => null)
    if (state.bootToken !== testigo) return
    state.modelChecks = checks
    const resuelto = resolveModel(modelos.models, {
      settingsModel: state.settings.model,
      savedModel: saved?.model,
      checks,
      now: ahora,
    })
    let elegido = resuelto.model
    // Quien marca a sabiendas un modelo con un fallo apuntado sale de la
    // pantalla «Elige el modelo» con él (H17): el veredicto es información, no
    // un candado. Sin esto, el rearranque de `useModel` lo volvía a apartar y la
    // pantalla del primer uso salía otra vez, en bucle. Sólo en memoria y sólo
    // para ESE modelo: al reabrir el panel, si el fallo sigue apuntado, se vuelve
    // a decir.
    const aceptado =
      state.modelAceptado && modelKey(state.settings.model) === state.modelAceptado
        ? modelos.models.find((m) => modelKey(m) === state.modelAceptado) || null
        : null
    if (aceptado && resuelto.source !== 'settings') elegido = aceptado
    // El modelo de la PERSONA se aparta esta vez —ya no está en la lista de
    // opencode, o tiene un fallo apuntado que todavía vale—, y eso se DICE
    // (§8.14): hasta la revisión adversaria de H16 se preseleccionaba otro en
    // silencio, y el turno salía con un modelo que nadie había elegido sin que
    // el Registro ni el chat lo contaran. El motivo se decide aquí y el aviso
    // se pinta tras restaurar la conversación, que vacía el chat. H17 convierte
    // este aviso en la pantalla «Elige el modelo» con «Elegir otro modelo».
    let apartado = null
    if (state.settings.model && resuelto.source !== 'settings' && !aceptado) {
      const suyo = modelKey(state.settings.model)
      const veredicto = modelVerdict(checks, state.settings.model, ahora)
      const enLaLista = modelos.models.some((m) => modelKey(m) === suyo)
      apartado =
        enLaLista && veredicto && !veredicto.ok
          ? { nombre: nombreModelo(state.settings.model), motivo: `tiene un fallo reciente (${motivoModelo(veredicto.reason)})` }
          : { nombre: suyo, motivo: 'ya no está en la lista de tu opencode' }
      log.warn(
        'Modelo no disponible',
        enLaLista && veredicto && !veredicto.ok
          ? `${suyo}: fallo apuntado (${veredicto.reason}) · se preselecciona otro esta vez`
          : `${suyo}: no está en la lista`
      )
    }
    // La migración se escribe UNA vez, y sólo cuando la persona todavía no tiene
    // modelo propio: `resolveModel` también cae en el del sitio cuando el de la
    // persona tiene un fallo apuntado, y escribirlo ahí sería cambiarle la
    // elección por detrás en cada arranque. En ese caso vale como preselección
    // de esta vez y `settings.model` se queda como está (H17 le enseña la
    // pantalla). Desde aquí manda `settings.model`; `saved.model` se deja como
    // está —borrarlo sería otra escritura por sitio para nada— y ya nadie lo
    // escribe.
    // Y se decide con los ajustes RELEÍDOS, no con los de `init()`: con dos
    // ventanas abiertas, la segunda pisaba el `settings.model` que la primera
    // acababa de migrar o elegir (revisión adversaria de H16). Si ya hay uno
    // guardado, manda ése, resuelto con la misma regla.
    if (resuelto.migrate && elegido && !state.settings.model) {
      const model = { providerID: elegido.providerID, modelID: elegido.modelID }
      const guardados = await getSettings()
      if (state.bootToken !== testigo) return
      if (!guardados.model) {
        state.settings = await saveSettings({ model })
      } else {
        state.settings = guardados
        elegido =
          resolveModel(modelos.models, { settingsModel: guardados.model, savedModel: saved?.model, checks, now: ahora }).model ||
          elegido
      }
      if (state.bootToken !== testigo) return
    }
    // H17, paso 1 de la máquina del primer uso (docs/PLAN2.md §3.3): sin modelo
    // resuelto —nada guardado, o el de la persona apartado por un fallo vigente o
    // porque ya no está en la lista—, la pantalla «Elige el modelo» va AQUÍ,
    // antes de las páginas base, del MCP y de todo lo demás. Pasó de verdad: Faro
    // elegía solo el primer predeterminado del mapa de opencode, el plan del
    // compañero lo rechazaba y el fallo acababa culpando a las claves. Y antes
    // de `checkMcp` a propósito: una comprobación de 14 s no corre bajo una
    // pantalla que puede tardar minutos, y su resultado tardío no abre la de
    // claves encima (por eso se sueltan `mcpCheck` y `mcpPending`: de ESTE
    // arranque no queda ninguna comprobación que pueda pintar). La salida es un
    // rearranque de verdad desde `useModel`, que ya encuentra el modelo.
    const sinModelo = !elegido || !!apartado
    if (primeraVez && sinModelo) {
      fillModels(modelos.models, elegido)
      state.mcpCheck = null
      state.mcpPending = null
      showModelScreen({
        modo: 'primera-vez',
        motivo: apartado ? `Tu modelo, «${apartado.nombre}», ${apartado.motivo}.` : '',
        marcado: elegido,
      }).catch(console.error)
      medir()
      return
    }
    if (!elegido) {
      // Sin modelo resuelto en un sitio que YA está en marcha no se para el
      // chat: se PRESELECCIONA el que tenga más papeletas —el último que
      // contestó, o un predeterminado de proveedor sin fallo apuntado— y NO se
      // guarda como elección de la persona (quien ya estaba configurado no ve
      // ninguna pantalla nueva; la del primer uso va justo arriba).
      elegido =
        recommendModel(modelos.models, { configModel: null, defaults: modelos.defaults, checks, now: ahora }) ||
        pickDefaultModel(modelos.models, modelos.defaults, { checks, now: ahora })
    }
    // Con TODOS los de la lista marcados —pasó con sólo el proveedor `opencode`,
    // cuyo 403 del nivel gratuito marca sus siete modelos una semana— los dos
    // respaldos de arriba dan null, el desplegable enseñaba su primera opción y
    // el turno se mandaba con otra cosa (el default de opencode, o el de antes).
    // No hay nada mejor que elegir: el predeterminado SIN veredictos, para que
    // el desplegable y `state.model` digan lo mismo, y se dice (revisión
    // adversaria de H16).
    let todosMarcados = false
    if (!elegido) {
      elegido = pickDefaultModel(modelos.models, modelos.defaults)
      if (elegido) {
        todosMarcados = true
        log.warn('Modelo no disponible', `todos los modelos de la lista tienen un fallo apuntado · se usa ${modelKey(elegido)}`)
      }
    }
    fillModels(modelos.models, elegido)
    // Desde H17 esto es el motivo de la pantalla «Elige el modelo» (o de su aviso,
    // si la pantalla taparía algo): la pantalla ofrece la lista entera,
    // «Comprobar» para volver a probar el que falló —un ok apuntado manda sobre
    // el fallo— y la flecha para seguir con el que Faro usa esta vez.
    if (todosMarcados) {
      avisoModelo =
        `Todos los modelos de tu lista tienen un fallo reciente; esta vez Faro usa «${nombreModelo(state.model)}». ` +
        'Elige uno, pulsa «Comprobar» para volver a probarlo, o «Olvidar los veredictos» en Ajustes.'
    } else if (apartado && state.model) {
      avisoModelo =
        `Tu modelo, «${apartado.nombre}», ${apartado.motivo}; esta vez Faro usa «${nombreModelo(state.model)}»: ` +
        'elige otro si no te vale, o pulsa «Comprobar» para volver a probar el tuyo.'
    }
  } else {
    showNotice('No he podido leer la lista de modelos: ' + (modelos?.error?.message || modelos?.error || 'respuesta vacía'), true)
    // Sin lista no se decide nada del modelo (P4): quien ya tiene uno guardado
    // sigue con él sin validarlo, y quien ya estaba configurado no ve ninguna
    // pantalla nueva. Sólo sin NINGÚN modelo guardado no hay con qué contestar:
    // la pantalla «Elige el modelo» en su modo vacío, con «Reintentar» (H17). La
    // lista vieja del panel no vale para elegir —es de otro momento, quizá de
    // otro opencode—, así que se vacía y la pantalla lo dice.
    if (!state.settings.model && !saved?.model) {
      state.models = []
      state.mcpCheck = null
      state.mcpPending = null
      showModelScreen({ modo: 'primera-vez', motivo: 'No he podido leer la lista de modelos de tu opencode.' }).catch(console.error)
      medir()
      return
    }
  }

  // Las páginas base de ESTE sitio. Salen del paquete que ya está leído, así
  // que van ANTES del MCP —que desde H14 no se espera— y no después: el chip
  // las enseña con el chat, sin depender de una comprobación que puede tardar
  // catorce segundos. Que haya quien pueda LEERLAS es otra cosa, y eso lo dice
  // el MCP cuando conteste (`paintSourcesMcp` en la pantalla).
  state.sources = normalizeSources(saved?.analysisSources, { host: state.site.host })
  // Y las últimas búsquedas que se ejecutaron aquí, del mismo registro: se
  // reconstruyen al leer, como las páginas base, porque son consultas que
  // acabarán dentro de una URL.
  state.recentJql = normalizeRecentJql(saved?.recentJql)
  // Y los perfiles contados de los proyectos, que viajan en el MISMO paquete
  // del sitio (`BUNDLE_EXTRA_KEYS`, H9): no cuestan ninguna lectura más y se
  // reconstruyen con claves blancas al leerlos, como todo lo que sale del
  // almacén; el perfil suelto de antes de H22 migra bajo su proyecto. Volver a
  // contar es una petición con la sesión del usuario y eso NO va aquí: se hace
  // al final, en segundo plano (P4 dejó el arranque en una sola lectura).
  state.profiles = normalizeProfiles(bundle.extras?.profile)
  // Y lo elegido en Ajustes para el Confluence enlazado, del mismo registro del
  // sitio (H22): proyecto → espacio, reconstruido con claves blancas al leer.
  state.linkedSpaces = normalizeLinkedSpaces(bundle.site?.linkedSpaces)
  // Y el historial de análisis con páginas base, que viaja en ese MISMO paquete
  // (H10): sale crudo de `getSiteBundle` —`shared/storage.js` no puede importar
  // de `src/panel/`, igual que con la memoria— y se reconstruye aquí, con el
  // reloj de ahora, así que lo caducado no llega a entrar en el estado.
  state.sourceHistory = normalizeHistory(bundle.extras?.sourceHistory, { host: state.site.host })
  paintSourcesUi()

  // 3. ¿Tiene claves este sitio, y están de verdad conectadas? Saberlo cuesta un
  // `GET /mcp` que EN FRÍO tarda 14,5 s en la máquina del usuario (14 463 ms
  // medidos el 2026-09-21 contra su opencode 1.2.25; 2 ms en caliente), y hasta
  // H14 el chat esperaba esos catorce segundos cada vez que se reiniciaba
  // opencode. Desde P5 la comprobación va en SEGUNDO PLANO (`checkMcp`): el chat
  // se pinta sin ella y lo que decida llega después.
  // La espera sólo el sitio que todavía no está en marcha —ni configurado ni con
  // las claves saltadas a propósito—: ahí no hay conversación que pintar, sin MCP
  // no se puede hacer nada y la pantalla de claves es justo lo primero que hay
  // que ver. El caso diario, el sitio ya configurado, no espera nada. (`primeraVez`
  // se decide más arriba, antes del modelo, desde H17.)
  const comprobacion = checkMcp(client, testigo, saved)
  // Lo que `send()` captura al mandar: siempre un booleano y nunca un rechazo,
  // porque de esto depende un aviso que el usuario lee («Páginas base sin leer»).
  state.mcpCheck = comprobacion.then(
    (r) => !!r.connected,
    () => false
  )
  if (primeraVez) {
    const r = await comprobacion
    if (state.bootToken !== testigo) return
    // La ÚNICA salida que espera al MCP, así que es la única con esa fase. Aquí
    // la fase cubre la comprobación ENTERA —las dos peticiones y, si el MCP se
    // adopta, escribir los registros—, porque es lo que este arranque esperó;
    // lo que tardaron sólo las peticiones lo dice «MCP comprobado», que la
    // comprobación registra con su propio reloj.
    cron.mark('MCP')
    saved = r.saved
    if (faltanClaves(r)) {
      // Se apunta y se enseña por el mismo camino que el resultado tardío: en
      // los catorce segundos la pestaña puede haberse ido al correo, y entonces
      // no hay pantalla que abrir hasta que vuelva (revisión adversaria de H14).
      state.mcpPending = { host: r.host, status: r.status }
      showMcpPending()
      medir()
      return
    }
  } else {
    // Se dice donde el usuario ya está mirando (decisión 4 de H5): el faro en
    // «ocupado» y el hueco del título de la pestaña con el motivo, hasta que
    // `onMcpResult` lo devuelva.
    setStatus('busy', COMPROBANDO_MCP)
    mcpResultSoon(comprobacion, state.mcpCheck)
  }

  // 4. Desde Jira, el contexto del Confluence enlazado: es de OTRO host, así
  // que no viene en el paquete de éste y hay que ir a por él. Con el registro
  // que hay AHORA: si la comprobación del MCP acaba adoptando uno que trae un
  // host enlazado nuevo, lo vuelve a leer ella (`onMcpResult`), porque aquí ya
  // no se la espera.
  // Un arranque más nuevo pone su testigo antes de su primer await: éste
  // siempre va por delante, así que lo que escriba aquí antes de comprobarlo
  // lo pisa el nuevo en su propio paso 4.
  state.linkedContext = await loadLinkedContext(saved)
  if (state.bootToken !== testigo) return
  // Lo que cuesta ese contexto enlazado, que es de otro host y es lo único que
  // de verdad queda por leer. Antes no tenía marca propia y esos milisegundos
  // se contaban como «restaurar».
  cron.mark('enlazado')

  // `onboarded` sale de lo leído al empezar (o de la relectura tras adoptar el
  // MCP), y entre esa lectura y aquí hay un hueco. Antes el comentario decía
  // que durante el arranque nada lo cambia, y no era verdad: «Omitir» de esta
  // misma pantalla lo escribía sin rearrancar y un arranque lento volvía a
  // enseñarla (revisión adversaria de H6). Ahora, quien lo escribe en ese hueco
  // —«Omitir» y el contexto que se sube a mano— apagan este arranque con un
  // testigo nuevo y repintan ellos el chat, así que aquí sólo se llega con un
  // arranque que sigue mandando.
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
  // Aquí y no en el paso 3: `restoreConversation` vacía el chat y se llevaba
  // cualquier aviso anterior. Con el testigo ya comprobado justo arriba.
  // Desde H17 el motivo abre la pantalla «Elige el modelo» —con la flecha a la
  // vista: el chat ya vive con la preselección, así que de aquí SÍ se sale sin
  // elegir— o, si la pantalla taparía algo (un turno, algo escrito, otra
  // pantalla), un aviso en el chat con «Elegir otro modelo», como el del MCP.
  if (avisoModelo) {
    if (puedeAbrirPantalla()) showModelScreen({ modo: 'ajustes', motivo: avisoModelo, marcado: state.model }).catch(console.error)
    else attachModelNotice(avisoModelo, { marcado: state.model, modo: 'ajustes' })
  }

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
 * El perfil contado del proyecto que hay delante, o null.
 *
 * Un Jira tiene muchos proyectos y desde H22 se guarda un perfil por cada uno
 * (`state.profiles.byProject`): al pasar de SIMPL-12 a OPS-77 en la misma
 * pestaña, el de SIMPL no puede entrar en el prompt ni en los chips de OPS como
 * «los nombres exactos» (revisión adversaria de H9). Los tres que lo consumen
 * —la petición de `send()`, los chips y el indexador— pasan por aquí.
 */
function currentProfile(site = state.site) {
  return profileForProject(state.profiles, site?.projectKey)
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
  const p = currentProfile(sitio)
  const vigente = !!p && Date.now() - p.at < PROFILE_LIMITS.ttlMs
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
  state.profiles = r.profiles
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
 * decide si lo que vuelve entra en `state` (§8.22). Y desde H22 FUNDE: el
 * perfil de este proyecto entra en el contenedor de TODOS los del host, releído
 * del almacén justo antes de escribir (como los contextos, H21), así que dos
 * recuentos de proyectos distintos no se pisan y la copia que el panel tenga en
 * memoria no se lleva lo que otra ventana contó en el hueco.
 *
 * @returns {Promise<{ok:true, profile:object, profiles:object, ms:number}|{ok:false, reason:string, detail:string}>}
 */
async function countProfile(sitio, scope, { tabId = state.tabId, signal = null } = {}) {
  const jql = sampleQuery(scope?.kind === 'project' ? scope.key : '')
  if (!jql) return { ok: false, reason: 'ámbito', detail: 'aquí no hay un proyecto del que contar una muestra' }

  const r = await chrome.tabs
    .sendMessage(tabId, { type: MSG.JQL_SEARCH, jql, limit: JIRA_REST_LIMITS.maxResults, fields: SAMPLE_FIELDS, cloud: sitio.cloud })
    .catch(() => null)
  if (!r?.ok) return { ok: false, reason: failReason(r, 'sin respuesta'), detail: jqlFailText(r, sitio.host) }
  // «Un indexado cancelado no escribe nada» (§4.6) vale también para el perfil:
  // el Cancelar del velo no corta la petición —tarda lo que tarde—, pero lo que
  // vuelva después ya no se guarda ni se registra (revisión adversaria de H9).
  if (signal?.aborted) return { ok: false, reason: 'cancelado', detail: 'Cancelado.' }

  const profile = profileFromSample(r.issues, { projectKey: scope.key })
  const actuales = await getProfiles(sitio.host)
  const nuevos = withProfile(actuales, profile)
  await saveProfiles(sitio.host, nuevos)
  log.ok(
    'Perfil del proyecto',
    `${sitio.host} · muestra de ${profile.sampled} incidencias · ${profile.types.length} tipos · ${profile.statuses.length} estados` +
      `${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ''}`
  )
  return { ok: true, profile, profiles: nuevos, ms: r.ms }
}

// ------------------------------------------------------- el MCP, en segundo plano

/** Lo que el chip de la cabecera dice mientras se comprueba el MCP (P5, H14). */
const COMPROBANDO_MCP = 'comprobando MCP…'

/**
 * La cabecera devuelve el hueco al título de la pestaña cuando la comprobación
 * del MCP deja de estar en marcha: porque terminó (`onMcpResult`) o porque se
 * invalidó (`saveKeys` y «Ya lo he pegado» ponen `state.mcpCheck = null`, y su
 * resultado ya no llegará a pintar nada). Sólo si ese texto sigue siendo el
 * nuestro: con un turno en vuelo ahí manda «pensando…», y quien lo puso es
 * quien lo quita (revisión adversaria de H18).
 */
function soltarComprobandoMcp() {
  if (state.statusLine === COMPROBANDO_MCP) {
    setStatus(state.client?.connected ? 'ok' : 'bad', state.client?.connected ? 'conectado' : 'sin conexión')
  }
}

/**
 * ¿Está de verdad conectado el MCP de Atlassian de este sitio?
 *
 * Era el paso 3 del arranque y desde H14 es su propia función, porque ya NO va
 * en el camino crítico (P5 del anexo E): `GET /mcp` tarda 14 463 ms la primera
 * vez tras arrancar opencode —medido el 2026-09-21 contra el opencode 1.2.25 del
 * usuario; 2 ms en caliente— y el chat lo esperaba entero. Ahora el chat se pinta
 * sin esperarla y esto llega cuando llegue.
 *
 * Se mira lo que opencode tiene de verdad: el MCP que lleve este dominio en
 * JIRA_URL o CONFLUENCE_URL (lo configuró el otro producto, o el usuario a mano)
 * se adopta y se apunta, con el otro host enlazado. Sólo después cuenta el
 * nombre que Faro guardó, y en último lugar el que deriva del host. De la
 * configuración sólo se miran los hosts: las claves van ahí en claro y no pueden
 * acabar en el estado ni en el registro.
 *
 * Devuelve `{connected, status, saved, enlaceNuevo}` y NO decide qué se le
 * enseña al usuario: eso no se pinta igual desde el arranque que catorce
 * segundos después, y lo decide quien llama (`showMcpSetup` / `attachMcpNotice`).
 *
 * @param {object} client el cliente con el que se pregunta, pasado a propósito:
 *        `state.client` puede ser ya otro cuando esto conteste.
 */
async function checkMcp(client, testigo, previo) {
  // El host y el producto con los que se comprueba, capturados ANTES del primer
  // await: entre pedir y contestar hay hasta catorce segundos y la pestaña puede
  // irse al correo, que deja `state.site` en null sin tocar el testigo del
  // arranque (§8.22). Todo lo de abajo habla de ESTE host, siempre.
  const host = state.site.host
  const product = state.site.product
  let saved = previo

  // Lo que tardan las DOS peticiones, con su propio reloj: la fase «MCP» del
  // arranque ya sólo existe cuando se las espera, así que esto se registra con su
  // línea propia en cuanto se sabe.
  const cron = startTiming(() => performance.now())
  const [mcp, config] = await Promise.all([client.listMcp().catch(() => ({})), client.config().catch(() => null)])
  cron.mark('MCP')
  // De la configuración, además de los hosts, UN campo (H17): el modelo que
  // opencode tiene por defecto, que «Elige el modelo» enseña como «el de tu
  // configuración» y `recommendModel` usa para preseleccionar. Validado y en su
  // forma, nunca el objeto entero; y sólo si el cliente sigue siendo el que
  // preguntó (§8.22): es del servidor, no del sitio.
  if (config && state.client === client) state.configModel = configModelOf(config)

  const found = mcpForHost(config, host, { status: mcp })
  // Se adopta sólo lo que está conectado: apuntar un MCP caído pisaba lo que
  // sí funcionaba. Y también cuando el MCP ya apuntado trae un host nuevo —el
  // usuario añadió el otro producto al bloque a mano—: sin esto, el enlace
  // sólo se aprendía si cambiaba el nombre.
  const enlaceNuevo =
    !!found &&
    ((found.jiraHost && found.jiraHost !== host && saved?.jiraHost !== found.jiraHost) ||
      (found.confluenceHost && found.confluenceHost !== host && saved?.confluenceHost !== found.confluenceHost))
  if (found && found.connected && (saved?.mcpName !== found.name || !saved?.configured || enlaceNuevo)) {
    // Esto se escribe aunque el panel ya esté en otro sitio: va bajo el host que
    // lo aprendió, como el índice y el contexto de §4.6, y es lo que hace que al
    // volver el MCP ya esté reconocido.
    //
    // Adoptar NO es verificar (H18, docs/PLAN2.md §3.2): un MCP que opencode ya
    // tiene conectado con este dominio —la recarga a mitad del primer uso, tras
    // escribirlo `saveKeys` y antes de que `finishSetup` lo comprobara, o uno
    // pegado a mano— no ha pasado ningún turno con sus tokens, y el primer
    // fallo saldría como una fila de herramienta fallida en mitad de un
    // análisis. Queda `verified: false` y el chat lo dice hasta la primera
    // verificación buena. Lo ya verificado se CONSERVA host a host, no sólo el
    // del que pregunta (revisión adversaria de H18): `adoptionRecords` mira el
    // registro guardado de CADA host —el enlazado incluido— y sólo deja
    // `verified: true` donde ese host ya tenía comprobado el MISMO MCP; con el
    // `mismoYaProbado` de antes, el host de la pestaña decidía por todos, y un
    // enlace nuevo borraba la verificación del otro o heredaba la de éste.
    const registros = adoptionRecords({
      registros: siteRecords({
        host,
        product,
        mcpName: found.name,
        jiraHost: found.jiraHost,
        confluenceHost: found.confluenceHost,
        verified: false,
      }),
      sites: await getSites(),
      mcpName: found.name,
    })
    for (const registro of registros) await saveSite(registro.host, registro.patch)
    saved = await getSite(host)
    log.ok('MCP reconocido', `${found.name} · ${found.products === 2 ? 'Jira y Confluence' : found.jiraHost ? 'sólo Jira' : 'sólo Confluence'}`)
    // `keysUnverified` y no `.verified` a mano: es la única lectura de ese campo
    // en el panel (la migración de los registros de antes de H18 vive ahí).
    const sinProbar = registros.filter((registro) => keysUnverified(registro.patch)).map((registro) => registro.host)
    if (sinProbar.length) log.warn('Claves sin comprobar', `${sinProbar.join(', ')} · ${found.name}: adoptado sin probar ningún token`)
  } else if (found && !found.connected) {
    log.warn('MCP sin conectar', `${found.name} lleva este dominio pero no está conectado`)
  }
  const status = mcpStatusFor(mcp, host, chosenMcpName(config, saved, host, { status: mcp }))

  // En el ESTADO del panel sólo se escribe si el panel sigue siendo de este
  // sitio: el resultado se devuelve igual —el turno que capturó esta promesa al
  // mandar lo está esperando—, pero `state.mcpConnected` es del sitio que hay
  // delante (§8.22). Mirar el correo no cuenta como irse: el panel sigue siendo
  // de este host (`state.lastHost`), igual que para el turno en vuelo.
  if (state.bootToken === testigo && (state.site?.host ?? state.lastHost) === host) {
    state.mcpConnected = !!status.connected
  }

  // Y lo que ha costado saberlo, con su estado: es el número que justificó P5 y
  // el que dice que el MCP de este sitio está caído sin tener que preguntárselo.
  const comoEsta = status.connected ? 'conectado' : status.present ? `registrado pero en «${status.status}»` : 'no está en opencode'
  const linea = timingLine(cron.done(), { extra: `${status.name || 'sin nombre'}: ${comoEsta}` })
  if (status.connected) log.ok('MCP comprobado', linea)
  else log.warn('MCP comprobado', linea)

  // Con el host: quien lo enseñe tarde tiene que saber DE QUÉ sitio habla, y
  // `state.site` puede ser null para entonces (la pestaña en el correo).
  return { connected: !!status.connected, status, saved, enlaceNuevo, host }
}

/**
 * El resultado del MCP cuando llega tarde, sin que nada lo espere.
 *
 * Se lanza sin `await`, como `refreshProfileSoon` y `loadTodaySoon`: el chat ya
 * está puesto y un fallo aquí no puede tumbarlo.
 */
function mcpResultSoon(comprobacion, vigente) {
  comprobacion
    .then((r) => onMcpResult(r, vigente))
    .catch((err) => log.warn('MCP comprobado', 'no se pudo terminar: ' + String(err?.message || err)))
}

/**
 * El MCP ya está comprobado y el chat llevaba rato puesto.
 *
 * Aquí está la decisión que P5 no tenía tomada: hasta H14 la pantalla de claves
 * salía ANTES del chat, y ahora puede llegar catorce segundos después, con el
 * usuario escribiendo o esperando una respuesta. Una pantalla deja `#app`
 * inerte, se lleva el foco y tapa lo que esté llegando, así que sólo se abre si
 * no hay nada en marcha; si lo hay, se dice en el chat con un botón que la abre
 * cuando el usuario quiera. Encolarla para «cuando acabe el turno» se descartó:
 * sería una pantalla que aparece sola minutos después, mientras se lee la
 * respuesta, y al llegar tendría que volver a preguntarse justo esto mismo.
 */
async function onMcpResult(r, vigente) {
  // La cabecera devuelve el hueco al título de la pestaña ANTES de mirar si esta
  // comprobación sigue valiendo: una comprobación invalidada (`saveKeys` y «Ya
  // lo he pegado» ponen `state.mcpCheck = null`) también ha terminado, y si la
  // cabecera se soltaba detrás de la guarda se quedaba clavada en «comprobando
  // MCP…» (revisión adversaria de H18).
  soltarComprobandoMcp()
  // Lo que manda aquí no es el testigo del arranque sino que ESTA comprobación
  // siga siendo la del panel: `state.mcpCheck` lo pone cada arranque nuevo y lo
  // vacía el cambio de host, que es justo cuando un resultado viejo no debe
  // pintar nada. Con el testigo, «Omitir» y «Subir un contexto» —que lo cambian
  // para apagar la pantalla de contexto sin rearrancar— dejaban huérfana la
  // comprobación en vuelo: ni pantalla, ni aviso, y la cabecera clavada en
  // «comprobando MCP…» (revisión adversaria de H14).
  if (state.mcpCheck !== vigente) return
  if (faltanClaves(r)) {
    // Se apunta y se enseña si se puede YA; si no —la pestaña en el correo, o
    // la pantalla de contexto delante—, lo enseña quien vuelva a poder.
    state.mcpPending = { host: r.host, status: r.status }
    showMcpPending()
  }
  // Un MCP adoptado sin comprobar (H18): se dice ya, en el chat que está puesto.
  if (keysUnverified(r.saved)) avisarClavesSinComprobar({ anunciar: true }).catch(() => {})
  // Y si la adopción ha traído un host enlazado que no estaba cuando se leyó el
  // contexto, se lee ahora: desde un Jira, el CONTEXT.md del Confluence enlazado
  // es lo que dice qué páginas mirar (§4.7). Sólo pasa la primera vez que se
  // reconoce ese enlace; lo demás de `saved` no cambia al adoptar un MCP.
  if (r.enlaceNuevo) {
    const enlazado = await loadLinkedContext(r.saved)
    // Sólo si de verdad hay algo: esto viene a RELLENAR un enlace que no se
    // sabía, y `loadLinkedContext` devuelve null con la pestaña fuera de
    // Atlassian (mira `state.site`), así que asignarlo a secas podría borrar el
    // contexto que el arranque sí había cargado.
    if (state.mcpCheck === vigente && enlazado) state.linkedContext = enlazado
  }
}

/**
 * Enseña lo que la comprobación del MCP dejó pendiente, si ya se puede.
 *
 * Dos cosas lo dejan esperando (revisión adversaria de H14): que el panel no
 * tenga el sitio delante —con la pestaña en el correo `state.site` es null y
 * `showSetupScreen` reventaba con él— y que el chat esté a punto de vaciarse
 * —la pantalla de contexto delante, o el velo de «Trabajando…»: los dos acaban
 * en `restoreConversation`, que se lleva cualquier aviso colgado del chat—. Lo
 * llaman `onMcpResult`, el final de `refreshTab` (al volver al sitio) y el
 * final de `restoreConversation` (con el chat ya repintado). Lo que era de OTRO
 * sitio se tira: `refreshTab` ya lo vacía al cambiar de host.
 */
function showMcpPending() {
  const pendiente = state.mcpPending
  if (!pendiente) return
  if ((state.site?.host ?? state.lastHost) !== pendiente.host) {
    state.mcpPending = null
    return
  }
  if (!state.site) return
  if (!$('screen-context').classList.contains('hidden') || !el.busy.classList.contains('hidden')) return
  state.mcpPending = null
  if (puedeAbrirPantalla()) showMcpSetup(pendiente.status)
  else attachMcpNotice(pendiente.status)
}

/** ¿Hay que pedirle las claves a este sitio? El MCP no está y no se saltaron. */
function faltanClaves(r) {
  return !r.connected && !r.saved?.skippedKeys
}

/**
 * ¿Se puede abrir una pantalla encima de lo que el usuario está haciendo?
 *
 * No mientras se responde (taparía la respuesta y `#app` queda inerte), ni con
 * otra pantalla o el velo de «Trabajando…» abiertos (los dos mandan sobre el
 * foco), ni con algo escrito y sin mandar en el cuadro (se perdería el foco a
 * mitad de una frase).
 */
function puedeAbrirPantalla() {
  if (state.streaming) return false
  if (document.querySelector('.screen:not(.hidden)')) return false
  if (!el.busy.classList.contains('hidden')) return false
  return !el.input.value.trim()
}

/**
 * Lo que se dice de una entrada deshabilitada y sin claves, que es lo que deja
 * «Quitar las claves» (H19). En UN sitio (revisión adversaria de H19): la dicen
 * la pantalla de claves (`showMcpSetup`) y, cuando esa pantalla taparía algo, el
 * aviso del chat (`attachMcpNotice`), que hasta entonces decía «no está
 * conectado (disabled)… Puedes revisarlo» de algo que el usuario acababa de
 * quitar a propósito. El espejo del banco copia esta frase letra a letra
 * (pinado).
 */
function fraseMcpDeshabilitado(name) {
  return `El MCP «${name}» está deshabilitado y sin claves en opencode (es lo que deja «Quitar las claves»): al guardar, Faro lo vuelve a escribir con las nuevas.`
}

/**
 * La pantalla de claves con el motivo: el MISMO texto desde el arranque que
 * desde la comprobación tardía, escrito en un solo sitio para que no puedan
 * acabar diciendo cosas distintas.
 */
function showMcpSetup(status) {
  // Sin el sitio delante no hay pantalla que rellenar: `showSetupScreen` lee
  // `state.site`, que con la pestaña en el correo es null, y reventaba con un
  // TypeError que se tragaba `mcpResultSoon` (revisión adversaria de H14). Desde
  // el botón del aviso se dice qué hacer; el resultado tardío ni llega aquí, se
  // queda en `state.mcpPending` hasta que `refreshTab` vuelva al sitio.
  if (!state.site) {
    showNotice('Vuelve a una pestaña del sitio para cambiar sus claves.', true, { force: true })
    return
  }
  hideScreens()
  showSetupScreen()
  // Una entrada deshabilitada es lo que deja «Quitar las claves» (H19): no está
  // caída, está apagada a propósito y sin claves, y guardar las nuevas la
  // reutiliza (`chooseWriteTarget`, porque es el esqueleto de Faro). Decir
  // «revisa ese bloque y reinicia opencode» ahí mandaría a arreglar algo que no
  // está roto. La frase vive en `fraseMcpDeshabilitado`, que comparte con el
  // aviso del chat.
  if (status.present && status.status === 'disabled') {
    $('setup-status').textContent = fraseMcpDeshabilitado(status.name)
  } else if (status.present) {
    $('setup-status').textContent = `El MCP «${status.name}» está registrado pero en «${status.status}». Revisa ese bloque y reinicia opencode, o quítalo si sobra.`
  }
  paintSetupMcpHint(status)
}

/**
 * El texto del consejo que hay pintado en la pantalla de claves, o null: lo
 * vacía `showSetupScreen` junto con la caja (revisión adversaria de H15).
 */
let setupHintPintado = null

/**
 * El consejo del MCP caído en la pantalla de claves, DETRÁS de la frase de
 * arriba (que sigue escrita una sola vez): por qué suele pasar, el comando para
 * arreglarlo y «Reintentar» (H15, docs/PLAN2.md §3.1). Sin consejo —conectado,
 * ausente, o un estado que no es «failed»— la caja se vacía y se esconde.
 *
 * Desde H18 lo pinta también la espera de `saveKeys` tras escribir el MCP
 * (`espera`: su testigo, `state.mcpWait`). Mientras esa espera vive,
 * «Reintentar» es como el del paso manual —`manual`: la espera lo ve conectado
 * y sigue ella con `finishSetup`—; rearrancar el panel a la vez adoptaría el MCP
 * sin comprobar las claves. Vencida o sin espera, lo de siempre.
 */
function paintSetupMcpHint(status, { host = '', espera = null } = {}) {
  const caja = $('setup-mcp-hint')
  const consejo = mcpFailureHint(status)
  // Lo que hace el paso manual (revisión adversaria de H15): el mismo consejo
  // no se recrea. Vaciar la caja siempre se llevaba el «Reintentar» que el
  // usuario acababa de pulsar y el foco caía al <body> —lo que H5 corrigió en
  // las dos mitades de esta pantalla—; `retryMcp` ya ha reactivado el botón.
  if (consejo && consejo.text === setupHintPintado && caja.childElementCount) return
  // Medido ANTES de vaciar: después ya no hay nada dentro que tenga el foco.
  const teniaFoco = caja.contains(document.activeElement)
  caja.textContent = ''
  setupHintPintado = consejo ? consejo.text : null
  caja.classList.toggle('hidden', !consejo)
  if (!consejo) return
  caja.appendChild(
    mcpHintNode(consejo, {
      onRetry: (boton) =>
        retryMcp(status.name, {
          boton,
          host,
          manual: !!espera && state.mcpWait === espera,
          repintar: (s) => paintSetupMcpHint(s, { host, espera }),
          // Conectado con un turno en vuelo: la pantalla se cierra y se dice en
          // el chat; sin turno, `retryMcp` rearranca el panel y ya no hace falta.
          avisar: () => {
            hideScreens()
            showNotice(MCP_RECUPERADO, false, { force: true })
          },
        }),
    })
  )
  // Si el foco estaba en la caja (en el «Reintentar» de antes), pasa al nuevo.
  const nuevo = [...caja.querySelectorAll('button')].find((b) => b.textContent === 'Reintentar')
  if (teniaFoco) nuevo?.focus()
}

/**
 * El aviso en el chat cuando no se puede abrir la pantalla: la contraparte
 * visible de «MCP comprobado» sin conexión (§8.14), con la salida a mano y sin
 * robarle el foco a nadie. El botón NO lleva `NEEDS_IDLE`: no necesita el turno
 * parado —abrir las claves a mitad de una respuesta es cosa del usuario, y la
 * respuesta sigue llegando debajo—, lo que no puede es abrirse sola.
 *
 * Una entrada deshabilitada (lo que deja «Quitar las claves») no está caída: el
 * aviso dice lo mismo que la pantalla de claves (`fraseMcpDeshabilitado`) y a
 * qué botón ir, sin «no está conectado» ni «revísalo» (revisión adversaria de
 * H19: tras quitarlas con algo escrito en el cuadro salía el genérico).
 */
function attachMcpNotice(status) {
  const texto =
    status.present && status.status === 'disabled'
      ? fraseMcpDeshabilitado(status.name) + ' Pulsa «Cambiar las claves» para volver a ponerlas.'
      : `He comprobado el MCP de Atlassian de este sitio y no está conectado${status.present ? ` (${status.status})` : ''}: ` +
        'el modelo no podrá leer Jira ni Confluence. Puedes revisarlo cuando termines.'
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(texto, true))
  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'ghost small'
  btn.type = 'button'
  btn.textContent = 'Cambiar las claves'
  btn.addEventListener('click', () => showMcpSetup(status))
  row.appendChild(btn)
  // H15: si el MCP está en «failed», por qué y «Reintentar» al lado de «Cambiar
  // las claves». Sin el comando para copiar: en el chat va el motivo, y el
  // comando lo enseña la pantalla de claves, a un clic, sin alargar un aviso que
  // llega solo y se queda debajo de la conversación.
  const consejo = mcpFailureHint(status)
  if (consejo) {
    const nodo = mcpHintNode(consejo, {
      copiar: false,
      fila: row,
      onRetry: (boton) =>
        retryMcp(status.name, {
          boton,
          repintar: (s) => {
            const nuevo = mcpFailureHint(s)
            if (nuevo) nodo.querySelector('p').textContent = nuevo.text
          },
          avisar: () => {
            wrap.replaceChildren(noticeNode(MCP_RECUPERADO, false))
            announce(MCP_RECUPERADO)
          },
        }),
    })
    wrap.appendChild(nodo)
  }
  wrap.appendChild(row)
  // SIN `clearEmpty()`, a diferencia de los demás avisos: éste llega solo,
  // catorce segundos después de abrir el panel, y con el chat vacío se llevaba
  // la bienvenida entera —las sugerencias, los chips y «Qué mirar hoy»— en
  // cuanto hubiera algo escrito en el cuadro o una pantalla abierta encima
  // (revisión adversaria de H14). Va debajo del estado vacío, y la primera
  // pregunta se lo lleva a él como siempre y deja el aviso.
  el.chat.appendChild(wrap)
  announce(texto)
  scrollChat()
  return wrap
}

/**
 * Lo que diga la comprobación del MCP de este sitio, esperándola si sigue en
 * vuelo (P5).
 *
 * Sin ninguna en marcha —el hueco de un cambio de sitio, antes de que el
 * arranque nuevo llegue a su paso 3— vale lo que el estado sepa, que es el lado
 * prudente: avisar de que las páginas base no se han podido leer.
 */
function currentMcpCheck() {
  return state.mcpCheck || Promise.resolve(state.mcpConnected)
}

/**
 * Vuelve a comprobar el MCP de este sitio sin rearrancar el panel, como hace el
 * arranque en su paso 5 (revisión adversaria de H19). La llama `removeKeys` en
 * las dos salidas en las que el PATCH SÍ se aplicó —opencode rearrancó todos sus
 * MCP— pero el sitio no se da por desconfigurado (no se pudo releer la
 * configuración, o una de proyecto delante sigue cargando el MCP con claves): sin
 * esto el panel se quedaba con `mcpConnected` en false y sin comprobación, y el
 * siguiente Análisis con páginas base avisaba de «sin MCP» con el MCP conectado.
 *
 * Con el cliente CAPTURADO por quien llama (§8.22) y el testigo del arranque
 * vigente. Sin el sitio delante no hace nada: `checkMcp` lee `state.site.host`, y
 * con la pestaña en el correo reventaría; ahí el estado se queda como lo dejó la
 * invalidación hasta el siguiente arranque. La cabecera dice «comprobando MCP…»
 * salvo con un turno en vuelo, donde manda «pensando…» (quien lo pone lo quita:
 * `soltarComprobandoMcp`).
 */
function relanzarComprobacionMcp(cliente, saved) {
  if (!state.site?.host) return
  const c = checkMcp(cliente, state.bootToken, saved)
  state.mcpCheck = c.then((x) => !!x.connected, () => false)
  if (!state.streaming) setStatus('busy', COMPROBANDO_MCP)
  mcpResultSoon(c, state.mcpCheck)
}

/** Lo que se dice cuando «Reintentar» conecta el MCP con un turno en vuelo. */
const MCP_RECUPERADO = 'MCP conectado: la próxima pregunta ya podrá leer Jira y Confluence.'

/**
 * El consejo de un MCP caído, pintado (H15, docs/PLAN2.md §3.1).
 *
 * UNA sola pieza para los tres sitios que lo enseñan —la pantalla de claves, la
 * espera del paso manual y el aviso del chat—, para que no acaben diciendo cosas
 * distintas. Recibe lo que devuelve `mcpFailureHint` (el texto ya viene en una
 * línea, sin invisibles y acotado). Todo con `createElement` y `textContent`, y
 * sin ningún enlace (S5): la ayuda es texto y un comando para copiar, que es lo
 * único que Faro puede darle a quien tiene que arreglarlo en su terminal.
 *
 * @param {{text: string, copy: string, retry: boolean}} consejo
 * @param {{onRetry?: (boton: HTMLButtonElement) => void, copiar?: boolean, fila?: HTMLElement|null}} opts
 *        `fila`: la `.nav-actions` en la que va «Reintentar» si ya hay una (la
 *        del aviso del chat, junto a «Cambiar las claves»); sin ella, la suya.
 */
function mcpHintNode(consejo, { onRetry = null, copiar = true, fila = null } = {}) {
  const nodo = document.createElement('div')
  const texto = document.createElement('p')
  texto.className = 'fine'
  texto.textContent = consejo.text
  nodo.appendChild(texto)
  if (copiar && consejo.copy) {
    const cmd = document.createElement('div')
    cmd.className = 'cmd'
    const code = document.createElement('code')
    code.textContent = consejo.copy
    const copia = document.createElement('button')
    copia.className = 'ghost small'
    copia.type = 'button'
    copia.textContent = 'Copiar'
    copia.addEventListener('click', () => copyToClipboard(consejo.copy, copia))
    cmd.append(code, copia)
    nodo.appendChild(cmd)
  }
  if (consejo.retry && onRetry) {
    const reintentar = document.createElement('button')
    reintentar.className = 'ghost small'
    reintentar.type = 'button'
    reintentar.textContent = 'Reintentar'
    reintentar.addEventListener('click', () => onRetry(reintentar))
    let destino = fila
    if (!destino) {
      destino = document.createElement('div')
      destino.className = 'nav-actions'
      nodo.appendChild(destino)
    }
    destino.appendChild(reintentar)
  }
  return nodo
}

/**
 * «Reintentar»: vuelve a arrancar el MCP sin reiniciar opencode (H15).
 *
 * `POST /mcp/{name}/connect` arranca otra vez un MCP en «failed»; en opencode
 * 1.2.25 BLOQUEA unos 12 s y devuelve `true` aunque falle, así que el resultado
 * se lee DESPUÉS en `GET /mcp` (anexo-2-B). Mientras, el botón queda desactivado
 * —que es también lo que impide el doble clic— y dice que está en ello.
 *
 * El host se captura ANTES del primer await (§8.22): en esos doce segundos la
 * pestaña puede irse a otro sitio, y entonces sólo se registra y no se toca ni
 * el estado ni la pantalla. Qué pasa al conectar: desde el paso manual, NADA
 * —su espera (`waitForMcpReady`) lo ve en la vuelta siguiente y sigue sola con
 * `finishSetup`, y si la espera ya venció lo sigue el propio botón (revisión
 * adversaria de H15, en `showManualStep`)—; desde la pantalla de claves o el chat, sin turno en vuelo se
 * rearranca el panel (lo que hace «Guardar y volver» al cambiar el servidor: el
 * arranque reconoce y adopta el MCP), y con un turno en vuelo se da por
 * conectado para la pregunta siguiente y se dice (`avisar`). Si no conectó, se
 * vuelve a pintar el consejo con el error de ahora (`repintar`).
 *
 * Del MCP se registran el nombre, el estado y los ms; nunca un cuerpo de la
 * configuración, que lleva las claves en claro (§7).
 */
async function retryMcp(name, { boton, host: hostDado = '', manual = false, repintar = null, avisar = null } = {}) {
  const host = hostDado || (state.site?.host ?? state.lastHost)
  const client = state.client
  if (!name || !host || !client || !boton || boton.disabled) return null
  const texto = boton.textContent
  boton.disabled = true
  boton.textContent = 'Reintentando…'
  const t0 = performance.now()
  await client.connectMcp(name).catch(() => {})
  const list = await client.listMcp().catch(() => ({}))
  const status = mcpStatusFor(list, host, name)
  const ms = Math.round(performance.now() - t0)
  const como = status.connected ? 'conectado' : status.present ? `en «${status.status}»` : 'no está en opencode'
  if (status.connected) log.ok('MCP reintentado', `${name}: ${como} · ${ms} ms`)
  else log.warn('MCP reintentado', `${name}: ${como} · ${ms} ms`)

  if ((state.site?.host ?? state.lastHost) !== host || state.client !== client) return status
  boton.disabled = false
  boton.textContent = texto
  // El resultado se DICE (A2, revisión adversaria de H15): el botón vuelve a su
  // texto y nada más cambia a la vista, así que con un lector de pantalla un
  // reintento fallido era silencio. Con el motivo, que es el mismo consejo que
  // se pinta.
  if (!status.connected) {
    repintar?.(status)
    const consejo = mcpFailureHint(status)
    const cabeza = status.present ? `El MCP sigue en «${status.status}»` : 'El MCP no está en opencode'
    announce(consejo ? `${cabeza}: ${consejo.text}` : `${cabeza}.`)
    return status
  }
  // El éxito sólo se anuncia aquí: sin turno en vuelo se rearranca el panel (y
  // eso se ve), y con turno los dos `avisar` —el de la pantalla de claves, por
  // `showNotice`, y el del chat— ya lo anuncian; duplicarlo sería oírlo dos veces.
  if (manual) {
    announce(MCP_RECUPERADO)
    return status
  }
  if (!state.streaming) {
    await bootForSite()
    return status
  }
  state.mcpConnected = true
  state.mcpCheck = Promise.resolve(true)
  state.mcpPending = null
  avisar?.()
  return status
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
  // Sus contextos, que desde H21 son por ámbito (los espacios de ese
  // Confluence). Se guardan TODOS en `ctxs` y viaja UNO, que elige por proyecto
  // `applyLinkedScope` (H22). Se normalizan aquí con la misma regla de migración
  // que el sitio propio, pero NO se escribe nada de ese host: la reparación la
  // hace su propio panel al arrancar.
  const ctxs = normalizeContexts(bundle.contextRaw, {
    legacyScope: legacyScopeOf(bundle, bundle.site),
    legacyIndexedAt: bundle.site?.indexedAt,
  })
  // Su índice: es donde se buscan las páginas base de un análisis desde Jira,
  // que son páginas de ESE Confluence, y de donde sale el espacio de cada página
  // que el contexto del proyecto cita o que el historial usó. Nunca se guarda
  // desde aquí, y su `stale` tampoco se anuncia: lo reconstruye su panel.
  const index = bundle.index || null
  // Y el prefijo de su wiki, si se observó al visitarlo: su API cuelga de ahí
  // (`/confluence/rest/api/…` en un Data Center con ruta de contexto).
  const wikiPrefix = typeof bundle.site?.wikiPrefix === 'string' ? bundle.site.wikiPrefix : ''
  const enlazado = applyLinkedScope({ host, ctxs, index, wikiPrefix, contextMd: '', contextScope: '', otherScopes: [], via: '' })
  const { contextMd, contextScope: key, via } = enlazado
  // El enlace es un hecho del sitio guardado, no de que ya haya contexto: sin
  // esto, una URL de ese Confluence pegada en las páginas base se rechazaba
  // como «otro sitio» justo antes de indexarlo, que es cuando más falta hace.
  if (contextMd?.trim() || index) {
    log.info(
      'Contexto de Confluence enlazado',
      `${host} · ${contextMd?.length || 0} caracteres · ${key ? (key === '*' ? '*' : scopeLabel(key).replace(/^el /, '')) : 'sin contexto'}${via ? ' ' + VIA_ENLAZADO[via] : ''} · ${index ? indexSize(index) + ' entradas' : 'sin índice'}`
    )
  }
  return enlazado
}

/**
 * Por qué se eligió el contexto del Confluence enlazado que viaja, en palabras
 * del Registro (el `via` de `linkedSpacesFor`).
 */
const VIA_ENLAZADO = Object.freeze({
  manual: 'a mano',
  contexto: 'por el contexto',
  historial: 'por el historial',
  unico: 'por ser el único con contexto',
  heredado: 'heredado',
})

/**
 * Las dos señales con las que las reglas (a) y (b) de `linkedSpacesFor` eligen
 * el espacio del Confluence enlazado para un proyecto (H22), en listas de
 * claves de espacio con repeticiones (cada elemento es una página):
 *
 * - `citadas`, el espacio de cada página que el CONTEXT.md del PROYECTO cita con
 *   su id (`referencesFromContext`); el espacio sale del índice del enlazado,
 *   porque una referencia no lo lleva;
 * - `usadas`, el de cada página base que el historial de ESE proyecto usó: la
 *   suya si la guardó, y si no la del índice del enlazado.
 *
 * Del contexto del proyecto sólo salen ids y del historial sólo claves: ninguno
 * aporta texto a ningún prompt. Síncrona y sin leer el almacén.
 */
function linkedSignals(enlazado, proyecto) {
  const paginas = enlazado?.index?.pages || {}
  const espacioDe = (id) => (Object.hasOwn(paginas, id) ? paginas[id]?.spaceKey || '' : '')
  const propio = proyecto ? contextFor(state.contexts, 'project:' + proyecto, { fallback: '' }) : ''
  const citadas = Object.keys(referencesFromContext(propio, { index: enlazado?.index || null }).items)
    .map(espacioDe)
    .filter(Boolean)
  const usadas = []
  for (const entrada of proyecto ? state.sourceHistory?.entries || [] : []) {
    if (entrada.projectKey !== proyecto) continue
    for (const pagina of entrada.pages || []) {
      const espacio = pagina.spaceKey || espacioDe(pagina.id)
      if (espacio) usadas.push(espacio)
    }
  }
  return { citadas, usadas }
}

/**
 * Qué contexto del Confluence enlazado viaja desde el proyecto de la pestaña
 * (H22, docs/PLAN2.md §3.4): rellena `contextMd`, `contextScope`, `otherScopes`
 * y `via` del enlazado con lo que decida `linkedSpacesFor` —lo elegido en
 * Ajustes manda; si no, las reglas (a) contexto del proyecto, (b) historial,
 * (c) el único con contexto, y el de todo el sitio—. SÍNCRONA y sin leer el
 * almacén: todo lo que necesita ya está en memoria, así que cambiar de proyecto
 * (`applyScope`) lo recalcula al instante. La llaman el final de
 * `loadLinkedContext`, `applyScope`, el selector de Ajustes y, desde la revisión
 * adversaria de H22 (G10), «Olvidar el historial» y el apunte de un análisis
 * nuevo en el historial. Sin un sitio de
 * Jira o sin enlazado, no hace nada. Devuelve el mismo objeto.
 */
function applyLinkedScope(enlazado = state.linkedContext) {
  if (state.site?.product !== 'jira' || !enlazado) return enlazado
  const proyecto = validProjectKey(state.site.projectKey)
  const manual = proyecto && Object.hasOwn(state.linkedSpaces, proyecto) ? state.linkedSpaces[proyecto] : ''
  const { citadas, usadas } = linkedSignals(enlazado, proyecto)
  const r = linkedSpacesFor(enlazado.ctxs, { manual, citadas, usadas })
  enlazado.contextMd = r.text
  enlazado.contextScope = r.key
  enlazado.otherScopes = r.otras
  enlazado.via = r.via
  return enlazado
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
 *
 * Desde H27 (PLAN3 §3.1) distingue un caso que antes se confundía con «no hay
 * script»: el script que está y no arranca. Visto el 2026-09-28 al cargar Faro
 * en Chrome (G1, G2): el arranque roto contestaba `{ok:false}` al PING, esto
 * pedía REQUEST_HOST_PERMISSION con el permiso ya dado, el service worker
 * reinyectaba en el mismo mundo sin volver a preguntar y decía «ok», y se
 * apuntaba «Content script inyectado» con la acción fallando detrás. Ahora el
 * SW dice `alive` y `error` y, tras inyectar, `kind`; con el script vivo y roto
 * ni se pide permiso ni se reinyecta: se apunta el motivo (`noteContentProblem`)
 * y se dice (`showContentProblem`). Sigue devolviendo un booleano: diecinueve
 * llamadas sólo quieren saber si pueden hablar con la pestaña.
 *
 * Desde H28 (revisión adversaria de H27, D2) la pestaña y el sitio se capturan
 * ANTES del primer await (§8.22): el problema se apuntaba con los de DESPUÉS, y
 * cambiar de pestaña mientras el service worker contestaba dejaba el motivo de
 * una pestaña apuntado a nombre de otra. Si al volver la pestaña ya no es la
 * misma, se devuelve false sin apuntar ni avisar nada: lo que se sabe es de
 * una pestaña que ya no está delante.
 */
async function ensureContentAccess({ announce = true } = {}) {
  if (!state.site || !state.tabId) return false
  const tabId = state.tabId
  const site = state.site

  const status = await chrome.runtime
    .sendMessage({ type: MSG.CONTENT_STATUS, tabId, origin: site.origin })
    .catch(() => null)
  if (state.tabId !== tabId) return false

  if (status?.ready) {
    state.contentProblem = null
    return true
  }

  // Vivo y roto: contesta, pero no arranca. El permiso estaba (el script llegó
  // a la pestaña) y reinyectar no cambia nada en el mismo mundo, donde
  // `__faroBooted` ya está puesto.
  if (status?.alive && status?.error) {
    noteContentProblem(status.error, { tabId, host: site.host })
    if (announce) showContentProblem()
    return false
  }

  if (status?.granted) {
    // Permiso hay, pero la pestaña se cargó antes de que el script existiera.
    const r = await chrome.runtime
      .sendMessage({ type: MSG.REQUEST_HOST_PERMISSION, origin: site.origin, tabId })
      .catch(() => null)
    if (state.tabId !== tabId) return false
    if (r?.ok) {
      state.contentProblem = null
      log.ok('Content script inyectado', site.host)
      return true
    }
    // El SW ya no dice «ok» sin un PING bueno detrás (H27): «roto» es un script
    // que estaba y no arranca; «huerfano», que tras inyectarlo nadie contesta.
    // Ninguno de los dos se arregla con permiso: se dice el motivo.
    if (r && r.ok === false && (r.kind === 'roto' || r.kind === 'huerfano')) {
      noteContentProblem(r.error, { tabId, host: site.host })
      if (announce) showContentProblem()
      return false
    }
  }

  // Lo que falta es el permiso (o nadie contesta en el service worker). Lo
  // apuntado de antes deja de valer: si no, `showPermissionNotice` cambiaría la
  // tarjeta por un aviso viejo.
  state.contentProblem = null
  if (announce) showPermissionNotice()
  return false
}

/** Aviso accionable: el permiso se pide desde aquí, que es donde hay gesto. */
function showPermissionNotice() {
  // Sin sitio no hay dominio al que pedirle nada (revisión adversaria de H28,
  // D5): con la pestaña cambiada a una que no es de Atlassian mientras se
  // comprobaba el script, `state.site` es null y leer su `host` reventaba con
  // un TypeError que `send()` enseñaba como «Fallo enviando», saltándose el
  // resto del turno. Quien llama ya dice que se cambió de pestaña.
  if (!state.site) return
  // H27 (PLAN3 §3.1): quien llama tras un `ensureContentAccess` en falso
  // (offerNotes, runPlan, togglePick, con `announce: false`) no sabe si faltaba
  // el permiso o el script está roto: el booleano no lo dice. Con el script de
  // ESTA pestaña roto, la tarjeta pediría un permiso que ya está dado, y es lo
  // que se vio el 2026-09-28; se dice el motivo en su lugar.
  if (state.contentProblem?.tabId === state.tabId && state.contentProblem?.host === state.site?.host) {
    showContentProblem()
    return
  }
  clearEmpty()
  // Una tarjeta por chat, pero no un silencio (H28, PLAN3 §3.2): la segunda
  // acción que choca con el mismo permiso volvía por aquí sin decir nada, y la
  // tarjeta de antes podía estar muy arriba, fuera de la vista.
  if (el.chat.querySelector('.perm-card')) {
    showNotice('Sigue faltando el permiso sobre ' + state.site.host + ': pulsa «Dar permiso» en la tarjeta.', true)
    return
  }

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
 * Apunta por qué el content script de esta pestaña no sirve (H27, PLAN3 §3.1).
 *
 * El motivo llega del service worker, que lo tiene del propio script (su
 * `bootErrorText`, sin el id de la extensión) o lo pone él («no contesta»). Se
 * registra UNA vez por pestaña y motivo: `ensureContentAccess` corre en casi
 * cada acción, y un registro que repite lo mismo en cada clic esconde lo demás.
 *
 * La pestaña y el host son los que `ensureContentAccess` capturó al preguntar
 * (H28, revisión adversaria de H27, D2), no los de ahora: el motivo es de la
 * pestaña que lo dijo.
 */
function noteContentProblem(error, { tabId, host }) {
  const texto = String(error || 'el content script no arranca')
  if (state.contentProblem?.tabId !== tabId || state.contentProblem?.error !== texto) {
    log.error('Content script roto', host + ' · ' + texto)
  }
  state.contentProblem = { host, tabId, error: texto }
}

/**
 * Lo que ve la persona cuando el content script no arranca (H27): el motivo y
 * qué hacer. No es la tarjeta de «Falta un permiso», porque el permiso está;
 * y «recarga» va primero por la pestaña, que da un script nuevo, y luego por
 * la extensión, que es lo que queda si el fallo es suyo.
 */
function showContentProblem() {
  showNotice('Faro no ha podido arrancar en esta pestaña: ' + (state.contentProblem?.error || 'motivo desconocido') + '. Recarga la pestaña y, si sigue igual, la extensión.', true)
}

/**
 * Pide el permiso sobre el dominio del sitio e inyecta el content script.
 *
 * Se pide desde el panel y detrás de un clic: `permissions.request` exige un
 * gesto del usuario, y el diálogo se abre aquí, sin ningún `await` delante.
 * El gesto SÍ viaja al service worker con el mensaje, pero sólo mientras dura
 * la activación (unos 5 s) y sólo en la parte síncrona de su oyente; y al SW
 * le llegan muchas peticiones sin clic detrás (al abrir el panel, al acabar un
 * turno), donde `request` falla aunque el permiso ya esté dado, porque
 * Chromium mira el gesto antes. Por eso desde H27 (PLAN3 §3.1, G3: leído en
 * Chromium, se mide en H30) el SW ya no llama a `request`, sólo a `contains`,
 * y registra e inyecta. Lo usan la tarjeta del chat y la pantalla de páginas
 * base, que tapa al chat y necesita su propio botón.
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

/**
 * Lo que se añade al nombre de un modelo con un fallo apuntado y vigente (H16).
 *
 * Sólo texto, a propósito: la lista entera con los no disponibles plegados y su
 * motivo es la pantalla «Elige el modelo» de H17. Hasta entonces, el desplegable
 * del redactor es el único sitio donde se elige, y elegir a ciegas el modelo que
 * acaba de fallar era justo el bucle `gpt-5.4 ⇄ claude-sonnet-4.6` del compañero.
 */
const NO_DISPONIBLE = ' · no disponible'

/** ¿Tiene este modelo un fallo apuntado que todavía vale? */
function modelFailing(model, now = Date.now()) {
  const veredicto = modelVerdict(state.modelChecks, modelKey(model), now)
  return !!veredicto && !veredicto.ok
}

/** El texto de una opción del desplegable: el nombre y lo que se sabe de él. */
function modelOptionText(m, now) {
  return m.name + (m.free ? ' · gratis' : '') + (modelFailing(m, now) ? NO_DISPONIBLE : '')
}

/**
 * Vuelve a escribir los textos del desplegable con los veredictos de ahora, sin
 * reconstruirlo: tras apuntar un fallo (o un acierto, o tras olvidarlos) lo que
 * cambia es el sufijo, y rehacer las opciones movería la selección de sitio.
 */
function paintModelVerdicts() {
  const ahora = Date.now()
  for (const opt of el.model.querySelectorAll('option')) {
    const m = state.models.find((x) => modelKey(x) === opt.value)
    if (m) opt.textContent = modelOptionText(m, ahora)
  }
}

function fillModels(models, selected) {
  el.model.textContent = ''
  const ahora = Date.now()
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
      opt.textContent = modelOptionText(m, ahora)
      group.appendChild(opt)
    }
    el.model.appendChild(group)
  }
  // Un modelo que NO está en la lista no se asigna (H16). Antes se escribía en
  // `state.model` aunque el `<select>` no pudiera enseñarlo: el desplegable
  // decía uno y el turno se mandaba con otro que opencode ya no tiene, y el
  // fallo que volvía no explicaba nada. Se cae al respaldo, que salta lo que ya
  // se sabe que no contesta. Es una DEFENSA y no registra nada: el único que
  // llama es `bootForSite`, que sólo pasa modelos de la lista, y el «no está en
  // la lista» del modelo de la persona lo dice él, con su aviso (revisión
  // adversaria de H16: el registro de aquí era inalcanzable).
  const enLista = selected ? models.find((m) => modelKey(m) === modelKey(selected)) : null
  const elegido = enLista || pickDefaultModel(models, state.defaults, { checks: state.modelChecks, now: ahora })
  if (elegido) {
    el.model.value = modelKey(elegido)
    state.model = { providerID: elegido.providerID, modelID: elegido.modelID }
  } else {
    // Sin nada que elegir (la lista vacía), el desplegable NO enseña una opción
    // que nadie eligió y el turno no se manda con el modelo de antes: los dos
    // dicen lo mismo, nada (revisión adversaria de H16).
    el.model.selectedIndex = -1
    state.model = null
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
          cuerpo.append(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, onCodeBlock: drawCodeBlock, allowHref: linkAllowed }))
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
  // Con el chat ya repintado, lo que el MCP dejó pendiente mientras la pantalla
  // de contexto (o el velo) lo tapaba: un aviso colgado antes de esto se habría
  // ido con el `textContent = ''` de arriba.
  showMcpPending()
  // Y, por lo mismo, el recordatorio de unas claves adoptadas sin comprobar
  // (H18): se vuelve a colgar en cada repintado hasta la primera verificación
  // buena. Sin anunciarlo: repintar el chat no anuncia nada.
  avisarClavesSinComprobar().catch(() => {})
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

/**
 * El chat vacío.
 *
 * `announce: false` (H21) repinta sin volver a decir «Listo para escuchar» al
 * lector de pantalla: cambiar de espacio con el chat vacío lo repinta —la línea
 * del mapa y las páginas son del espacio— y eso no es abrir el panel (A2).
 *
 * `replace`, un `.empty` que ya está en el chat: la bienvenida nueva ocupa su
 * SITIO. Colgarla al final dejaba encima los avisos que había debajo de la vieja
 * (revisión adversaria de H21, B12).
 */
function showWelcome({ announce: anunciar = true, replace = null } = {}) {
  const scope = defaultScope(state.site)
  const wrap = document.createElement('div')
  wrap.className = 'empty'

  const beacon = document.createElement('span')
  beacon.className = 'beacon big live'
  wrap.appendChild(beacon)

  // El espacio de la pestaña, en Confluence y con clave de verdad (H21). El
  // mapa es por espacio: el título cuenta las páginas de ÉSTE cuando las tiene,
  // y lo de siempre si no —o sin espacio, byte a byte lo de antes—. Si el
  // espacio NO tiene mapa, el título no cuenta nada: «N cosas indexadas aquí»
  // encima de ««X» aún no tiene mapa» se contradecían (revisión adversaria de
  // H21, B10). La condición se calcula UNA vez, para el título y para la línea.
  const espacio = state.site?.product === 'confluence' && isRealSpaceKey(state.site.spaceKey) ? state.site.spaceKey : ''
  const sinMapa = !!espacio && !hasMap(state.contexts, state.index, scopeKeyOf(state.site))
  const deEspacio = espacio ? pagesOfSpace(state.index, espacio).length : 0
  const h = document.createElement('h2')
  h.textContent = sinMapa
    ? 'Listo para escuchar'
    : deEspacio
      ? `${deEspacio} páginas de «${espacio}» en el mapa`
      : state.index
        ? `${indexSize(state.index)} cosas indexadas aquí`
        : 'Listo para escuchar'
  wrap.appendChild(h)

  const p = document.createElement('p')
  p.textContent = scope
    ? `Pregúntame sobre ${scope.label}. Si la respuesta está en algún sitio, te llevo.`
    : 'Pregúntame lo que quieras sobre este sitio.'
  wrap.appendChild(p)

  // Un espacio SIN mapa propio (H21): entrar en él no abre la pantalla de
  // contexto —el sitio ya pasó la primera configuración—, pero se dice en UNA
  // línea con su botón. «Construir» son minutos de turnos de modelo, así que
  // con uno del chat en vuelo nace apagado y `setStreaming` lo enciende (H6).
  if (sinMapa) {
    const linea = document.createElement('div')
    linea.className = 'no-map'
    const texto = document.createElement('span')
    texto.textContent = `«${espacio}» aún no tiene mapa`
    const construir = document.createElement('button')
    construir.className = 'ghost small ' + NEEDS_IDLE
    construir.type = 'button'
    construir.textContent = 'Construir'
    construir.setAttribute('aria-label', `Construir el mapa de «${espacio}»`)
    construir.disabled = state.streaming
    construir.addEventListener('click', () => {
      if (state.streaming) return
      generateContext().catch(console.error)
    })
    linea.append(texto, construir)
    wrap.appendChild(linea)
  }

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

  if (replace?.isConnected) replace.replaceWith(wrap)
  else el.chat.appendChild(wrap)
  if (anunciar) announce(h.textContent)

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
      log.info('Filtros favoritos', `no se pudieron leer · ${failReason(r, 'sin motivo')}`)
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
  d.appendChild(renderMarkdown(text, { onLink: openUrl, onNote: focusNote, onCodeBlock: drawCodeBlock, allowHref: linkAllowed }))
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

/**
 * Lo que se anuncia al terminar un turno: que hay respuesta, cuántas observaciones, y su arranque.
 *
 * El código no se lee en voz alta: desde H24 una respuesta puede traer un
 * diagrama Mermaid, y leerle al lector de pantalla «flowchart LR A --> B» no
 * dice nada (el diagrama tiene su propio título y su lista). Por eso fuera las
 * vallas ``` y ~~~ cerradas, y una que quede abierta hasta el final.
 */
function answerAnnouncement(answer) {
  const n = numberedIn(answer).length
  const plano = String(answer || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/(```|~~~)[\s\S]*$/, ' ')
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
  // Y «Dibujar el flujo» (H24), igual: la pregunta que mandó el botón es
  // ESTA, y sólo cuenta en el sitio donde se pulsó (§8.22). La pregunta INTACTA
  // cuenta sola aunque el armado ya se consumiera (vuelve con «Reintentar con X»
  // y «Elegir otro modelo»), y una pregunta que ya no pide Mermaid no cuenta
  // aunque se pulsara el botón («Preguntar sobre estos» encima): al cerrar H24
  // se miraba sólo el armado (revisión adversaria de H24, D02).
  const diagrama = state.pendingDiagram
  state.pendingDiagram = null
  const diagramaAlPedir = text === DIAGRAM_QUESTION || (!!diagrama && diagrama.host === state.site.host && /mermaid/i.test(text))
  // Y la oferta de dibujar sólo vive bajo la ÚLTIMA respuesta: la pregunta dice
  // «tu última respuesta», y con una pregunta nueva la de antes deja de serlo;
  // al cerrar H24 el botón de una respuesta vieja dibujaba la última. Se quita
  // SIEMPRE, ofrezca o no la nueva (revisión adversaria de H24, D03).
  for (const f of el.chat.querySelectorAll('.dg-offer')) f.remove()

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
  // El MCP no es un booleano que se pueda leer al mandar: desde P5 (H14) su
  // comprobación puede seguir en vuelo, así que se captura la PROMESA y se le
  // pregunta al TERMINAR el turno —decenas de segundos, contra los quince que
  // tarda ella como mucho—. Con `state.mcpConnected` de ahora, un turno mandado
  // nada más abrir el panel acabaría con un «Páginas base sin leer» mentiroso.
  // Esa espera no tiene plazo a propósito: un plazo que venciera diría «no hay
  // MCP» sin saberlo, que es justo el aviso falso que esto evita. Y sólo se
  // llega aquí con un turno que ha respondido, o sea con opencode contestando.
  const mcpCheckAlPedir = currentMcpCheck()
  // Y el host: si al terminar el panel está en OTRO sitio, la respuesta no
  // entra en su chat ni en su índice (queda en la sesión de opencode de éste).
  const hostAlPedir = state.site.host
  // Y el sitio entero, para cosechar el índice con el que preguntó y no con el
  // que haya en la pestaña al acabar: `state.site` se queda en null en cuanto
  // se mira el correo, y desde H6 el índice va detrás de `offerNotes` (§8.22).
  const sitioAlPedir = state.site
  // Y la pestaña (H28, PLAN3 §3.2): las marcas son de la página que se analizó,
  // y `offerNotes` salía MUDA si al terminar el panel miraba otra pestaña o
  // ninguna; ahora lo compara con ésta y lo dice.
  const tabIdAlPedir = state.tabId

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
    // vuelve al cuadro, y con ella su armado de «Dibujar el flujo»: se consumió
    // arriba y, sin devolverlo, el reenvío salía sin él (revisión adversaria de
    // H24, D02).
    if (abort.signal.aborted) {
      el.input.value = text
      state.pendingDiagram = diagrama
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
        // Y que la pregunta es la de «Dibujar el flujo» (H24): se dice como lo
        // demás que el panel sabe del turno y el usuario no escribió.
        diagramaAlPedir ? 'dibujar el flujo' : '',
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
        // De qué ámbito es el contexto de arriba (H21): con un espacio o un
        // proyecto, la cabecera del bloque lo dice; con el de todo el sitio, la
        // de siempre.
        contextScope: state.contextScope,
        // Y, en un espacio sin contexto propio ni de todo el sitio, qué otros
        // espacios de este host tienen mapa: una línea de Faro, sólo claves.
        otherScopes: otherScopesWithMap(state.contexts, state.index, scopeKeyOf(state.site)).map((k) => k.slice('space:'.length)),
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

    // Un fallo por MODELO se apunta gratis antes de pintar nada (H16): así el
    // aviso de abajo ya no ofrece «Reintentar con» un modelo que acaba de fallar
    // ni uno de un proveedor que ya se sabe cerrado. Esperarlo aquí no deja
    // pintar nada encima: el frame pendiente ya se canceló y `runTurn` soltó su
    // `onUpdate` al terminar. El modelo es el que DE VERDAD se mandó —el de la
    // petición—, no el del desplegable de ahora.
    if (turn.stalled) {
      log.error('Turno colgado', modelKey(state.model))
      await noteModelFailure({ model: turn.model || peticion.model, rawError: turn.rawError, stalled: true })
      keepToolsFolded(turn, toolsBox)
      cuerpo.textContent = ''
      const aviso = 'El modelo dejó de responder y no ha terminado nunca. No todos los de la lista son fiables.'
      cuerpo.appendChild(errorNode(
        aviso,
        { ...tracker, rawError: { name: 'APIError', data: { message: 'stalled' } } },
        text,
        { stalled: true }
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
      // Sólo lo que es del proveedor —un rechazo por plan, credenciales caducadas,
      // un 5xx— dice algo del MODELO. Una conversación que ya no cabe en el
      // contexto o una respuesta cortada por largo son de ESTA conversación, y
      // apuntarlas dejaría el modelo «no disponible» una hora para nada: es la
      // misma frontera que ya decide si se ofrece otro (`suggestsAnotherModel`).
      if (suggestsAnotherModel(turn.rawError)) {
        await noteModelFailure({ model: turn.model || peticion.model, rawError: turn.rawError, stalled: false })
      }
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
      // Un turno que acaba «bien» sin una palabra es un modelo MUDO (docs/PLAN2.md
      // §3.3: «stalled o sin texto»), y hasta la revisión adversaria de H16 esta
      // rama no lo apuntaba, así que la preselección y «Reintentar con…» podían
      // volver a caer en él. Sólo si de verdad no hubo nada: una respuesta que
      // trae sólo el bloque de anclas —o sólo herramientas, que no son texto—
      // sí contestó, y marcarla «no contesta» un día sería mentir.
      if (!turn.text?.trim() && !anchors && !turn.tools?.length) {
        await noteModelFailure({ model: turn.model || peticion.model, stalled: true })
      }
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

    // «Dibujar el flujo» (H24): una respuesta de Jira que cita tres incidencias o
    // más ofrece dibujarlas, y el botón manda su pregunta fija (decisión 17).
    // No con una respuesta que ya trae su diagrama. Ya se sabe que el panel
    // sigue en el sitio que preguntó: la salida de `!mismoSitio` va arriba.
    // Sólo cuentan las claves de un proyecto conocido —el de la pestaña, los del
    // índice, los que devolvió Jira en este turno y los de los perfiles—, la
    // lección M4 del indexador: al cerrar H24 «UTF-8, ISO-8601 y SHA-256»
    // ofrecían dibujar (revisión adversaria de H24, D01). La valla se mira sin
    // mayúsculas, como `drawCodeBlock` (D18). La fila lleva `dg-offer` para que
    // el envío siguiente la retire (D03).
    const proyectosDelTurno = [
      ...knownProjectsFor(turn.parts, { site: sitioAlPedir, index: state.index, allowedHosts: linkedHost() ? [linkedHost()] : [] }),
      ...Object.keys(state.profiles?.byProject || {}),
    ]
    if (productoAlPedir === 'jira' && offerDiagramKeys(answer, proyectosDelTurno).length >= DIAGRAM_LIMITS.offerMinKeys && !/^\s*(```|~~~)\s*mermaid/im.test(answer)) {
      const fila = document.createElement('div')
      fila.className = 'nav-actions dg-offer'
      fila.appendChild(diagramButton())
      attachToBubble(bubble, fila)
    }

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
      mcpConnected: await mcpCheckAlPedir,
    })

    // Y lo que este turno ha añadido a lo que la sesión arrastra: pasado el
    // umbral se dice una vez, con la salida a mano.
    await trackSessionWeight(salidaTools, bubble)

    // El modelo que acaba de contestar queda apuntado como que FUNCIONA, gratis
    // (H16): es lo que `recommendModel` preselecciona y lo único con lo que
    // «Reintentar con…» se atreve a ofrecer otro. Ya no se escribe en el
    // registro del sitio (`saved.model`): el modelo es de la persona (§8.25), y
    // lo que la persona eligió lo escribe el desplegable en `settings.model`.
    await noteModelOk(peticion.model)

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
    // páginas base, apuntar lo que pesa la sesión, apuntar que el modelo
    // contestó y apuntar el análisis en el historial. Iba dentro de «índice» y los dos números
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
      // Una respuesta a «Dibujar el flujo» no es un análisis que marcar (H24).
      esDiagrama: diagramaAlPedir,
      // La pestaña y el sitio con los que se pidió (H28): marcar otra sería
      // marcar cualquier cosa, y callarlo, el fallo de §8.14.
      tabIdAlPedir,
      sitioAlPedir,
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
        destino.appendChild(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, onCodeBlock: drawCodeBlock, allowHref: linkAllowed }))
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
    // arriba: el destino sólo vale si está en él). Una respuesta a «Dibujar el
    // flujo» no procede: `diagramaAlPedir` es lo capturado al pedir, como en
    // `offerNotes` (decisión 18).
    await offerNavigation(answer, bubble, skill, turn.parts, { preloaded: !!preloadDelTurno, diagrama: diagramaAlPedir })

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
    body.appendChild(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote, onCodeBlock: drawCodeBlock, allowHref: linkAllowed }))
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
 *
 * Las tres salidas sin bloques quedan en el Registro con su motivo (H28, PLAN3
 * §3.2): la de sin pestaña y la de sin acceso se iban calladas, y la del acceso
 * decía «permiso» también con el content script roto; y un script roto contesta
 * `{ok:false, error}`, que se registraba como «no se pudo leer».
 */
async function readPageDigest() {
  if (!state.site || state.tabId == null) {
    log.info('Página sin bloques', 'sin pestaña')
    return { digest: null, reason: 'sin pestaña' }
  }
  const tabId = state.tabId
  const host = state.site.host
  // Una pestaña que cambió mientras se comprobaba el script no es un permiso
  // que falte (revisión adversaria de H28, D5): `ensureContentAccess` devuelve
  // false sin decir por qué, y el Registro decía «falta permiso».
  if (!(await ensureContentAccess({ announce: false }))) {
    log.info('Página sin bloques', state.tabId !== tabId ? 'has cambiado de pestaña' : sinAccesoMotivo(state.contentProblem, { tabId, host }) || 'falta permiso')
    return { digest: null, reason: 'permiso' }
  }

  const r = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PAGE_DIGEST }).catch(() => null)
  if (!r?.ok || !r.text) {
    const reason = failReason(r, 'no se pudo leer')
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
function errorNode(message, tracker, question, { stalled = false } = {}) {
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(message, true))

  const row = document.createElement('div')
  row.className = 'nav-actions'
  row.style.marginTop = '8px'
  wrap.appendChild(row)

  // «Elegir otro modelo», SIEMPRE (H17, docs/PLAN2.md §3.3): abre la pantalla
  // con el modelo que falló marcado y el motivo arriba, y al elegir la pregunta
  // vuelve al cuadro SIN mandarse (§8.20: Faro nunca manda nada por su cuenta).
  // También cuando el error no es del proveedor —un contexto desbordado se
  // arregla a veces con un modelo de ventana más grande—. `NEEDS_IDLE`: el aviso
  // se pinta con el turno todavía «en vuelo» y `setStreaming(false)` lo enciende.
  const fallido = tracker?.model || state.model
  const elegir = document.createElement('button')
  elegir.className = 'ghost small ' + NEEDS_IDLE
  elegir.type = 'button'
  elegir.textContent = 'Elegir otro modelo'
  elegir.disabled = state.streaming
  elegir.addEventListener('click', () => {
    if (state.streaming) return
    showModelScreen({
      modo: 'error',
      motivo: `El modelo «${nombreModelo(fallido)}» no ha podido contestar: ${String(message || '').slice(0, 200)}`,
      marcado: fallido,
      pregunta: question || state.lastQuestion,
    }).catch(console.error)
  })
  row.appendChild(elegir)

  if (!suggestsAnotherModel(tracker?.rawError)) return wrap

  // Sólo se OFRECE lo que se sabe que contesta: el modelo con un veredicto ok
  // vigente más reciente, distinto del que acaba de fallar (H16). Sin
  // veredictos, el de otro proveedor era a ciegas, y con dos predeterminados
  // rechazados por el plan el botón alternaba entre ellos para siempre
  // (`gpt-5.4 ⇄ claude-sonnet-4.6`, el bucle del compañero, verificado con los
  // ids reales en el anexo C). Hasta la revisión adversaria de H16 se elegía a
  // ciegas con `pickAlternativeModel` y DESPUÉS se exigía el ok, así que con
  // otro modelo que sí contestaba no salía ningún botón: ahora se elige ya
  // entre los que tienen ok (`pickRetryModel`). Con las credenciales del
  // proveedor caducadas hay que cambiar de PROVEEDOR —cualquier modelo suyo
  // fallará igual—; en los demás casos basta otro modelo. Sin ninguno así, sólo
  // queda «Elegir otro modelo» (H17), que abre la pantalla con el que falló
  // marcado y su motivo.
  const ahora = Date.now()
  const alt = pickRetryModel(state.models, modelKey(tracker?.model || state.model), {
    checks: state.modelChecks,
    now: ahora,
    otherProvider: classifyModelFailure(tracker?.rawError, { stalled }) === 'credenciales',
  })
  if (!alt) return wrap

  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.type = 'button'
  btn.textContent = `Reintentar con ${alt.name}`
  btn.addEventListener('click', async () => {
    btn.disabled = true
    state.model = { providerID: alt.providerID, modelID: alt.modelID }
    el.model.value = modelKey(state.model)
    // Es una elección de la persona, como la del desplegable: va a sus ajustes
    // (§8.25), no al registro de este sitio.
    state.settings = await saveSettings({ model: state.model })
    el.input.value = question || state.lastQuestion
    wrap.remove()
    send()
  })

  const hint = document.createElement('span')
  hint.className = 'fine'
  hint.style.alignSelf = 'center'
  hint.textContent = `proveedor ${alt.providerName}`

  // Delante de «Elegir otro modelo»: es la salida de un clic, con un modelo que
  // ya se sabe que contesta.
  row.prepend(btn, hint)
  return wrap
}

// ------------------------------------------------ veredictos de modelos (H16)

/**
 * El motivo de un fallo por modelo en palabras del usuario, para el aviso.
 *
 * Los códigos son los de `MODEL_FAILURE_REASONS` (models.js); el mensaje EXACTO
 * del proveedor va al Registro y al veredicto, y aquí sólo lo que hay que hacer.
 * Con `Object.hasOwn`, como en suggestions.js: un código que no está no puede
 * sacar nada del prototipo.
 */
const MOTIVO_MODELO = Object.freeze({
  plan: 'no está disponible con tu plan',
  credenciales: 'las credenciales del proveedor no valen; se renuevan con «opencode auth login»',
  mudo: 'no contesta',
  transitorio: 'el proveedor no responde ahora mismo',
  otro: 'el proveedor devolvió un error',
})

function motivoModelo(reason) {
  return Object.hasOwn(MOTIVO_MODELO, reason) ? MOTIVO_MODELO[reason] : MOTIVO_MODELO.otro
}

/** El nombre con el que el desplegable enseña un modelo, o su clave si no está. */
function nombreModelo(model) {
  const key = modelKey(model)
  return state.models.find((m) => modelKey(m) === key)?.name || key || 'sin modelo'
}

/**
 * Con qué opencode y con qué lista valen los veredictos: el servidor y la huella
 * de los modelos conectados. Se captura ANTES de leer o escribir (§8.22): lo que
 * se aprendió hablando con un servidor no se puede guardar bajo el de después.
 */
function modelChecksCtx() {
  return { server: state.settings.serverUrl, fingerprint: modelsFingerprint(state.models), now: Date.now() }
}

/**
 * Apunta —gratis— que un modelo acaba de fallar, y lo dice en el Registro.
 *
 * POR QUÉ EXISTE: el compañero tenía un modelo que su plan rechazaba y Faro lo
 * contaba como fallo de claves, dejaba el sitio a medias y, al pulsar
 * «Reintentar con…», saltaba a otro que su plan también rechazaba. El rechazo
 * trae casi siempre el motivo (y Copilot, la lista entera de lo que sí vale), así
 * que se clasifica sin gastar nada (`verdictsForFailure`) y se recuerda con su
 * caducidad en `faro:model-checks`, para que ni la preselección ni «Reintentar
 * con» vuelvan a caer en él. Lo usan las tres cosas que pueden fallar por modelo:
 * un turno, la verificación de las claves y el indexado.
 *
 * Nunca lanza: un almacén lleno no puede tapar el aviso que está a punto de salir.
 * Devuelve `{key, reason, message}` del modelo que falló, para que quien llama
 * diga el motivo en su aviso, o null si no hay modelo que apuntar.
 */
async function noteModelFailure({ model, rawError = null, stalled = false } = {}) {
  const elegido = parseModelKey(modelKey(model))
  if (!elegido) return null
  const key = modelKey(elegido)
  const ctx = modelChecksCtx()
  const verdicts = verdictsForFailure({ model: elegido, rawError, stalled, models: state.models, now: ctx.now })
  const propio = verdicts.find((v) => v.key === key)
  const fallo = {
    key,
    reason: propio?.reason || classifyModelFailure(rawError, { stalled }),
    message: propio?.message || '',
  }
  log.warn(
    'Modelo no disponible',
    `${key}: ${fallo.reason}` + (stalled ? ' · colgado' : fallo.message ? ' · ' + fallo.message.slice(0, 120) : '')
  )
  try {
    const guardado = await recordModelChecks(verdicts, ctx)
    // Global, pero de UN servidor: si en el hueco se cambió el de Ajustes, lo
    // guardado es de aquel y el arranque que ya viene relee lo suyo.
    if (state.settings.serverUrl === ctx.server) {
      state.modelChecks = guardado
      paintModelVerdicts()
    }
  } catch (err) {
    console.error('[faro] veredicto sin guardar', err)
  }
  return fallo
}

/**
 * Apunta que un modelo acaba de contestar bien: el veredicto que vale 7 días y
 * con el que `recommendModel` preselecciona y «Reintentar con…» se atreve. Es
 * gratis —el turno ya se hizo— y sustituye a la escritura de `saved.model` que se
 * hacía aquí después de cada turno (§8.25).
 */
async function noteModelOk(model) {
  const key = modelKey(parseModelKey(modelKey(model)))
  if (!key) return
  const ctx = modelChecksCtx()
  try {
    const guardado = await recordModelChecks([{ key, ok: true, reason: 'ok', message: '', at: ctx.now }], ctx)
    if (state.settings.serverUrl === ctx.server) {
      state.modelChecks = guardado
      paintModelVerdicts()
    }
  } catch (err) {
    console.error('[faro] veredicto sin guardar', err)
  }
}

// ------------------------------------------------ «Elige el modelo» (H17)

/**
 * El modelo que la configuración de opencode dice por defecto (`config.model`),
 * validado y en su forma, o null.
 *
 * De GET /config sólo sale ESTO: la configuración entera lleva los `environment`
 * de los MCP con las claves en claro, y no puede acabar en el estado ni en el
 * Registro (§7). Lo que se guarda es `{providerID, modelID}` reconstruido por
 * `parseModelKey`, y sólo se usa para compararlo con la lista: ni se pinta tal
 * cual ni viaja a ningún sitio.
 */
function configModelOf(config) {
  const clave = typeof config?.model === 'string' ? config.model.trim() : ''
  if (!clave || clave.length > 240 || /\s/.test(clave)) return null
  return parseModelKey(clave)
}

/** Cuánto hace de algo, por TIEMPO TRANSCURRIDO (como el porqué de «hoy»). */
function haceCuanto(ms) {
  const min = Math.floor(Math.max(0, Number(ms) || 0) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

/** El mensaje del proveedor acotado para una fila: el de Copilot trae la lista entera. */
function mensajeCorto(texto, max = 120) {
  const t = String(texto || '')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/**
 * Lo que se sabe de un modelo, en palabras, para su fila: por qué no se puede
 * usar (retirado, sin herramientas) o qué dijo la última vez (el veredicto
 * vigente). Sin nada que decir, ''. El mensaje del proveedor ya viene en una
 * línea y sin invisibles (`normalizeModelChecks`) y aquí se acota otra vez para
 * la fila: a 320 px, mil caracteres de «Available models» no se leen.
 */
function modelWhy(m, veredicto, ahora) {
  if (!m.usable) {
    return m.unusableReason === 'deprecated'
      ? 'opencode lo va a retirar'
      : 'sin herramientas: no podría leer Jira ni Confluence'
  }
  if (!veredicto) return ''
  if (veredicto.ok) return `funciona · ${haceCuanto(ahora - veredicto.at)}`
  const msg = mensajeCorto(veredicto.message)
  switch (veredicto.reason) {
    case 'plan':
      return 'no disponible con tu plan' + (msg ? ': ' + msg : '')
    case 'mudo':
      return 'no contesta'
    case 'credenciales':
      return 'credenciales caducadas: opencode auth login'
    default:
      return `falló ${haceCuanto(ahora - veredicto.at)}` + (msg ? ': ' + msg : '')
  }
}

/**
 * Qué modelo está marcado en la pantalla: lo que el usuario ha tocado; si no, el
 * que se pidió marcar al abrirla (el de ahora, desde Ajustes) SÓLO si se puede
 * usar; si no, la preselección de `recommendModel` —el último que contestó, el
 * de la configuración de opencode, un predeterminado sin fallo—, y si no, el
 * primero DISPONIBLE (utilizable y sin fallo vigente). Con todos marcados, nada:
 * la pantalla no elige por nadie un modelo que se sabe que falla.
 *
 * Revisión adversaria de H17 (R1), un DESVÍO razonado de docs/PLAN2.md §3.3,
 * que dice «abre la pantalla con el fallido marcado»: en los modos 'error',
 * 'setup' e 'indexado' lo que se pide marcar es el modelo que ACABA de fallar, y
 * marcarlo dejaba «Usar este modelo» apuntando a repetir el fallo —con la flecha
 * oculta en dos de ellos, la acción por defecto era la única salida—. Así que un
 * `marcado` con un fallo VIGENTE, o retirado o sin herramientas, no es la
 * preselección: queda a la vista, desplegado en «No disponibles» con su motivo
 * (`paintModelList`), y se sigue pudiendo elegir tocándolo, que es lo único que
 * manda sobre todo lo demás.
 */
function modelScreenChoice(ahora = Date.now()) {
  const s = state.modelScreen
  const enLista = (key) => (key && state.models.some((m) => modelKey(m) === key) ? key : '')
  if (enLista(s?.elegido)) return s.elegido
  const marcado = enLista(s?.marcado) ? usableModels(state.models).find((m) => modelKey(m) === s.marcado) : null
  if (marcado && marcado.usable && !modelFailing(marcado, ahora)) return s.marcado
  const rec = recommendModel(state.models, {
    configModel: state.configModel || null,
    defaults: state.defaults,
    checks: state.modelChecks,
    now: ahora,
  })
  if (rec) return modelKey(rec)
  const libre = usableModels(state.models).find((m) => m.usable && !modelFailing(m, ahora))
  return libre ? modelKey(libre) : ''
}

/**
 * «Elige el modelo» (H17, docs/PLAN2.md §3.3).
 *
 * POR QUÉ EXISTE: Faro elegía solo el primer predeterminado del mapa de opencode
 * —en la máquina del compañero de Marco, `openai/gpt-5.4`, que su plan
 * rechaza—, la verificación de las claves fallaba por el MODELO y el aviso
 * culpaba a las claves. El modelo es de la persona (§8.25) y se elige aquí:
 * antes de las claves en el primer uso, y otra vez cuando uno falla.
 *
 * Cinco modos, que deciden de dónde se sale y qué pasa al elegir (`useModel`):
 * 'primera-vez' (rearranque), 'ajustes' (volver), 'error' (la pregunta vuelve
 * al cuadro SIN mandarse), 'setup' (se repite SÓLO la verificación de las
 * claves) e 'indexado' (se repite el indexado). La flecha de volver sólo se ve
 * en 'ajustes' y 'error': en los otros tres no se sale sin elegir, y el
 * manejador de Escape no pulsa un botón oculto.
 *
 * Ninguna sonda al abrir ni al elegir (decisión 6 de PLAN2 §8): en el primer uso
 * la verificación de las claves ya es un turno real con ese modelo. La sonda es
 * «Comprobar», a mano y avisando de que cuesta una petición.
 *
 * En el primer uso la pantalla se abre ANTES de `checkMcp`, así que la
 * configuración de opencode todavía no se ha leído: se pide aquí, con el
 * cliente, el testigo y el host capturados antes del await (§8.22), y la lista
 * se repinta al llegar. Nunca lanza por eso: sin configuración no hay etiqueta.
 */
async function showModelScreen({ modo = 'ajustes', motivo = '', marcado = null, keepContext = false, pregunta = '' } = {}) {
  state.modelScreen = {
    modo,
    motivo: String(motivo || ''),
    marcado: modelKey(marcado) || '',
    elegido: '',
    keepContext: !!keepContext,
    pregunta: String(pregunta || ''),
  }
  const razon = $('model-reason')
  razon.textContent = state.modelScreen.motivo
  razon.classList.toggle('hidden', !state.modelScreen.motivo)
  $('model-filter').value = ''
  $('model-status').textContent = ''
  $('model-unavailable').open = false
  // De aquí sólo se sale sin elegir desde Ajustes o desde el error de un turno:
  // el chat ya vive con un modelo. En el primer uso, en la verificación de las
  // claves y en el indexado, no hay con qué seguir si no se elige.
  const cerrable = modo === 'ajustes' || modo === 'error'
  $('btn-model-close').hidden = !cerrable
  paintModelList('')
  showScreen('screen-model')
  // El motivo se DICE (A2, revisión adversaria de H17, C3): `showScreen` sólo
  // enfoca el título y `#model-reason` es un párrafo sin `aria-live`, así que un
  // lector de pantalla abría la pantalla sin saber por qué. Hasta H16 ese mismo
  // motivo salía con `showNotice` o `attachSetupModelNotice`, que lo anunciaban.
  if (state.modelScreen.motivo) announce(state.modelScreen.motivo)

  if (state.configModel !== undefined || !state.client) return
  const cliente = state.client
  const testigo = state.bootToken
  const host = state.site?.host ?? state.lastHost
  const abierta = state.modelScreen
  const config = await cliente.config().catch(() => null)
  if (state.client !== cliente || state.bootToken !== testigo || (state.site?.host ?? state.lastHost) !== host) return
  if (state.configModel === undefined) state.configModel = configModelOf(config)
  if (state.modelScreen === abierta && !$('screen-model').classList.contains('hidden')) paintModelList($('model-filter').value)
}

/**
 * La lista de la pantalla: un `fieldset` por proveedor, en el orden de
 * `state.models`, y una fila por modelo (un `label` con su radio). Lo que tiene
 * un fallo vigente, y lo retirado o sin herramientas, va DENTRO de «No
 * disponibles (N)», plegado —la lista entera, decisión 7 de PLAN2 §8: los siete
 * `opencode/*` caen ahí de golpe con el primer 403—, y sigue siendo elegible. El
 * filtro casa por nombre, id y proveedor sin distinguir mayúsculas y un grupo
 * que se queda sin filas no se pinta. Todo con `textContent`: el nombre y el
 * mensaje del proveedor son datos, no marcado.
 */
function paintModelList(filtro = '') {
  const lista = $('model-list')
  const plegada = $('model-unavailable-list')
  const detalles = $('model-unavailable')
  lista.textContent = ''
  plegada.textContent = ''
  // Sin proveedores conectados no hay lista que pintar: sólo el modo vacío, con
  // lo que hay que hacer y «Reintentar».
  const vacia = !state.models.length
  $('model-empty').classList.toggle('hidden', !vacia)
  lista.classList.toggle('hidden', vacia)
  $('model-filter').closest('.field').classList.toggle('hidden', vacia)
  $('btn-model-use').closest('.row').classList.toggle('hidden', vacia)
  detalles.classList.toggle('hidden', vacia)
  if (vacia) {
    paintModelButtons()
    return
  }

  const ahora = Date.now()
  const eleccion = modelScreenChoice(ahora)
  const deConfig = state.configModel ? modelKey(state.configModel) : ''
  const f = String(filtro || '').trim().toLowerCase()
  const disponibles = new Map()
  const noDisponibles = new Map()
  for (const m of usableModels(state.models)) {
    const key = modelKey(m)
    if (f && !`${m.name} ${m.modelID} ${m.providerID} ${m.providerName}`.toLowerCase().includes(f)) continue
    const veredicto = modelVerdict(state.modelChecks, key, ahora)
    const fuera = !m.usable || (veredicto && !veredicto.ok)
    const grupos = fuera ? noDisponibles : disponibles
    if (!grupos.has(m.providerName)) grupos.set(m.providerName, [])
    grupos.get(m.providerName).push(modelRow(m, veredicto, { key, eleccion, deConfig, ahora }))
  }
  const pintar = (caja, grupos) => {
    for (const [proveedor, filas] of grupos) {
      const grupo = document.createElement('fieldset')
      grupo.className = 'model-group'
      const titulo = document.createElement('legend')
      titulo.textContent = proveedor
      grupo.append(titulo, ...filas)
      caja.appendChild(grupo)
    }
  }
  pintar(lista, disponibles)
  pintar(plegada, noDisponibles)
  const cuantos = [...noDisponibles.values()].reduce((n, filas) => n + filas.length, 0)
  $('model-unavailable-summary').textContent = `No disponibles (${cuantos})`
  detalles.classList.toggle('hidden', !cuantos)
  // Se despliega si lo marcado está plegado —un radio marcado que no se ve es
  // una elección que nadie ve— y también si está ahí el modelo que se pidió
  // marcar al abrir aunque NO sea el radio marcado (revisión adversaria de H17,
  // R1): es el que acaba de fallar, `modelScreenChoice` ya no lo preselecciona, y
  // tiene que quedar A LA VISTA con su motivo, no escondido bajo un «(N)».
  const pedido = state.modelScreen?.marcado || ''
  if ([...plegada.querySelectorAll('input')].some((r) => r.checked || (pedido && r.value === pedido))) detalles.open = true
  if (!disponibles.size && !cuantos) {
    const nada = document.createElement('p')
    nada.className = 'fine'
    nada.textContent = 'Ningún modelo casa con ese filtro.'
    lista.appendChild(nada)
  }
  paintModelButtons()
}

/** Una fila: el radio, el nombre, sus etiquetas y lo que se sabe de él. */
function modelRow(m, veredicto, { key, eleccion, deConfig, ahora }) {
  const fila = document.createElement('label')
  fila.className = 'check model-row' + (veredicto ? (veredicto.ok ? ' ok' : ' bad') : '')
  const radio = document.createElement('input')
  radio.type = 'radio'
  radio.name = 'model-choice'
  radio.value = key
  radio.checked = key === eleccion
  const nombre = document.createElement('span')
  nombre.className = 'model-name'
  nombre.textContent = m.name
  fila.append(radio, nombre)
  const etiqueta = (texto) => {
    const t = document.createElement('span')
    t.className = 'model-tag'
    t.textContent = texto
    fila.appendChild(t)
  }
  if (m.isDefault) etiqueta('predeterminado de opencode')
  if (key === deConfig) etiqueta('el de tu configuración')
  const porQue = modelWhy(m, veredicto, ahora)
  if (porQue) {
    const why = document.createElement('span')
    why.className = 'model-why'
    why.textContent = porQue
    fila.appendChild(why)
  }
  return fila
}

/** «Usar este modelo» y «Comprobar» sólo con algo marcado y ninguna sonda en vuelo. */
function paintModelButtons() {
  const hay = !!modelScreenChoice()
  const probando = !!state.modelProbeAbort
  $('btn-model-use').disabled = !hay || probando
  $('btn-model-check').disabled = !hay || probando
}

/** Lo que pasa en la pantalla, escrito y dicho al lector de pantalla (A2). */
function setModelStatus(texto, { anunciar = true } = {}) {
  $('model-status').textContent = texto
  if (anunciar && texto) announce(texto)
}

/**
 * «Usar este modelo»: se guarda como elección de la PERSONA (§8.25) y después
 * pasa lo que toque por modo. Ninguna sonda aquí (decisión 6 de PLAN2 §8), y
 * ninguna pregunta se manda sola: en el modo 'error' la que falló vuelve al
 * cuadro y la manda el usuario (§8.20).
 */
async function useModel() {
  const s = state.modelScreen
  if (!s || $('screen-model').classList.contains('hidden')) return
  const key = modelScreenChoice()
  const m = state.models.find((x) => modelKey(x) === key)
  if (!m) {
    setModelStatus('Marca un modelo de la lista.')
    return
  }
  // Repetir la verificación de las claves o el indexado es otro turno del
  // modelo: con uno del chat en vuelo, no.
  if ((s.modo === 'setup' || s.modo === 'indexado') && state.streaming) {
    setModelStatus('Espera a que termine la respuesta: lo siguiente es otro turno del modelo.')
    return
  }
  const model = { providerID: m.providerID, modelID: m.modelID }
  $('btn-model-use').disabled = true
  state.settings = await saveSettings({ model })
  if (state.modelScreen !== s) return
  state.modelScreen = null
  // Elegido A SABIENDAS con un fallo apuntado: el arranque no lo vuelve a
  // apartar en esta sesión del panel (el veredicto es información, no un candado).
  state.modelAceptado = modelFailing(m) ? key : ''
  fillModels(state.models, model)
  paintSettingsModelInfo()
  log.ok('Modelo elegido', `${key} · desde ${s.modo}`)
  switch (s.modo) {
    case 'primera-vez':
      // Un rearranque de VERDAD, con testigo nuevo: es lo que hace que `checkMcp`
      // corra ya con modelo, y que las claves se comprueben con él.
      hideScreens()
      await bootForSite()
      break
    case 'error':
      hideScreens()
      el.input.value = s.pregunta || state.lastQuestion
      autoGrow()
      el.input.focus()
      break
    case 'setup':
      // Sólo la verificación: `pendingMcp` sigue con lo que se pidió, y nada se
      // vuelve a escribir en opencode. Su pantalla dice lo que va pasando.
      showScreen('screen-setup')
      await finishSetup()
      break
    case 'indexado':
      hideScreens()
      await generateContext({ keepContext: s.keepContext })
      break
    default:
      hideScreens()
  }
}

/**
 * «Comprobar»: UN turno corto con el modelo marcado (`client.probeModel`), a mano
 * y avisando de que con un proveedor de pago cuesta una petición. Es la ÚNICA
 * sonda de todo el panel: ni el arranque ni «Usar este modelo» la lanzan.
 *
 * Lo que diga se apunta como cualquier otro veredicto: un ok manda sobre el fallo
 * de antes (es la salida del bucle «mi modelo tiene un fallo apuntado y la
 * pantalla vuelve a salir») y un fallo pasa por `noteModelFailure`, que lo
 * clasifica gratis. §8.22: el servidor y el cliente se capturan antes, y si
 * cambian —o `buildClient` cancela la sonda— no se escribe nada.
 */
async function runModelProbe() {
  const s = state.modelScreen
  if (!s || state.modelProbeAbort) return
  const key = modelScreenChoice()
  const m = state.models.find((x) => modelKey(x) === key)
  const cliente = state.client
  if (!m || !cliente) {
    setModelStatus('Marca un modelo de la lista.')
    return
  }
  const ctx = modelChecksCtx()
  const abortador = new AbortController()
  state.modelProbeAbort = abortador
  paintModelButtons()
  setModelStatus(`Comprobando «${m.name}»…`)
  let r = null
  try {
    r = await cliente.probeModel(m, { signal: abortador.signal })
  } catch (err) {
    // `probeModel` no lanza: si algo revienta es de Faro y no dice nada del modelo.
    console.error('[faro] sonda', err)
  } finally {
    if (state.modelProbeAbort === abortador) state.modelProbeAbort = null
  }
  // Se repinta la pantalla que esté ABIERTA, sea la misma de antes o no
  // (revisión adversaria de H17, C5): cerrarla con la flecha y volver a abrirla
  // durante la sonda crea otro `state.modelScreen`, que se pintaba con los dos
  // botones desactivados —la sonda seguía en vuelo— y, al acabar, nadie los
  // encendía. Cerrar NO cancela la sonda a propósito: es una petición ya
  // pagada y su veredicto es global, vale para la pantalla que se abra después.
  const abierta = !$('screen-model').classList.contains('hidden')
  if (abortador.signal.aborted || state.client !== cliente || state.settings.serverUrl !== ctx.server || !r) {
    if (abierta) {
      paintModelButtons()
      setModelStatus(r ? 'Comprobación cancelada.' : 'No he podido hacer la comprobación.')
    }
    return
  }
  let texto
  // Un fallo de opencode o de Faro (sin sesión, sin red) no dice nada del
  // MODELO: no se apunta como suyo, que lo dejaría «no disponible» una hora por
  // algo que no es del proveedor. Se dice y se registra, y nada más.
  if (!r.ok && r.rawError?.name === 'OpencodeError') {
    const detalle = mensajeCorto(r.rawError.message)
    log.warn('Modelo comprobado', `${key} · sin comprobar · ${detalle}`)
    if (!$('screen-model').classList.contains('hidden')) {
      paintModelButtons()
      setModelStatus('No he podido hacer la comprobación: ' + detalle)
    }
    return
  }
  if (r.ok) {
    try {
      const guardado = await recordModelChecks([{ key, ok: true, reason: 'ok', message: '', at: Date.now() }], { ...ctx, now: Date.now() })
      if (state.settings.serverUrl === ctx.server) {
        state.modelChecks = guardado
        paintModelVerdicts()
      }
    } catch (err) {
      console.error('[faro] veredicto sin guardar', err)
    }
    log.ok('Modelo comprobado', `${key} · ${r.ms} ms`)
    texto = `«${m.name}» contesta (${r.ms} ms).`
  } else {
    // Sin error del proveedor y sin texto, el modelo se ha callado: es «mudo»
    // (docs/PLAN2.md §3.3: «stalled o sin texto»), como en un turno del chat.
    const mudo = !!r.stalled || !r.rawError
    const fallo = await noteModelFailure({ model: m, rawError: r.rawError, stalled: mudo })
    const motivo = fallo?.reason || classifyModelFailure(r.rawError, { stalled: mudo })
    log.warn('Modelo comprobado', `${key} · ${motivo}` + (fallo?.message ? ' · ' + fallo.message.slice(0, 120) : ''))
    texto = `«${m.name}» no ha contestado: ${motivoModelo(motivo)}.`
  }
  if (!$('screen-model').classList.contains('hidden')) {
    paintModelList($('model-filter').value)
    setModelStatus(texto)
  }
}

/**
 * El aviso en el chat cuando la pantalla «Elige el modelo» taparía algo (un turno
 * en vuelo, algo escrito, otra pantalla): el motivo y «Elegir otro modelo», que
 * la abre cuando el usuario quiera. El patrón de `attachMcpNotice`, y como él sin
 * `clearEmpty()`: llega solo, tras restaurar la conversación, y no se lleva la
 * bienvenida.
 */
function attachModelNotice(motivo, { marcado = null, modo = 'ajustes', keepContext = false, pregunta = '' } = {}) {
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(motivo, true))
  const row = document.createElement('div')
  row.className = 'nav-actions'
  // `NEEDS_IDLE`, como «Elegir otro modelo» de `errorNode` (revisión adversaria
  // de H17, C6): este aviso sale justo cuando la pantalla taparía algo —un turno
  // en vuelo, casi siempre—, y abrirla durante ese turno en el modo 'indexado'
  // o 'setup' dejaba una pantalla sin flecha encima de una respuesta a medias.
  const btn = document.createElement('button')
  btn.className = 'ghost small ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Elegir otro modelo'
  btn.disabled = state.streaming
  btn.addEventListener('click', () => {
    if (state.streaming) return
    showModelScreen({ modo, motivo, marcado, keepContext, pregunta }).catch(console.error)
  })
  row.appendChild(btn)
  wrap.appendChild(row)
  el.chat.appendChild(wrap)
  announce(motivo)
  scrollChat()
  return wrap
}

/** La línea de Ajustes que dice qué modelo es el tuyo. */
function paintSettingsModelInfo() {
  const suyo = state.settings.model
  $('settings-model-info').textContent = suyo
    ? `Usas «${nombreModelo(suyo)}» (${modelKey(parseModelKey(modelKey(suyo)))}) en todos los sitios.`
    : 'Todavía no has elegido modelo: esta vez Faro usa el que tenga más papeletas.'
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

  // La barra lateral es SIEMPRE la del espacio de la pestaña, y sus filas llegan
  // sin espacio: sin estamparlas, esas páginas no entrarían en su subíndice, ni
  // contarían para el tope al construir, ni se podrían olvidar con «Olvidar el
  // mapa» (H21). Para el MAPA no cuentan: desde la revisión adversaria de H21,
  // `hasMap` es sólo el `indexedAt` del ámbito. Con una clave que no lo es,
  // `stampSpace` deja el índice como estaba, que es lo de antes.
  const arbol = stampSpace(
    normalizeIndex({ pages: snap.pages, updated: Date.now() }, state.site.host, state.index?.scope, {
      cloud: state.site.cloud,
      wikiPrefix: state.site.wikiPrefix,
    }),
    state.site.spaceKey
  )
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
  // Y se escribe ENCIMA de lo que hay en el almacén, releído justo antes: otra
  // ventana del mismo host pudo guardar un espacio entretanto, y escribir la
  // copia de memoria a secas se lo llevaba (revisión adversaria de H21, B5). Es
  // una lectura más por turno; la escritura sigue siendo UNA (P3).
  let escrito = aGuardar
  try {
    const enDisco = (await getIndex(host)).index
    escrito = mergeIndex(enDisco, aGuardar)
    await saveIndex(host, escrito)
  } catch (err) {
    // Vuelve a quedar apuntado —salvo que algo más nuevo lo esté ya— para que el
    // turno siguiente lo intente otra vez.
    state.indexDirty = state.indexDirty || pendiente
    log.error('Índice sin guardar', `${host} · ${err?.message || err}`)
    return
  }
  log.ok(
    'Índice guardado',
    `${Object.keys(escrito.pages || {}).length} páginas · ${Object.keys(escrito.issues || {}).length} incidencias · ` +
      `total ${indexSize(escrito)} · ${host}`
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
async function offerNavigation(answer, bubble, skillId = state.skill, parts = [], { preloaded = false, diagrama = false } = {}) {
  // Una respuesta a «Dibujar el flujo» es un mapa de lo que ya se ha contado, no
  // un sitio al que ir. Va llena de claves: en General con mapa (y en Búsqueda
  // cuando la respuesta no nombra el destino) `shouldPlan` decía que sí y el
  // planificador gastaba un segundo turno de pago para una tarjeta «Llévame» que
  // sobra; sin mapa salía «Me falta el mapa», con una `jira_search` en el turno
  // la tarjeta de esa búsqueda, y en Análisis y Resumen nada (decisión 18,
  // 2026-09-28; PLAN3 §3.3; el matiz, de la revisión de H29, D5). Es la primera
  // salida, delante del modo y de la búsqueda de Jira, y con registro: una salida
  // muda no se ve (§8.14). Por ir delante del modo, el registro sale también en
  // Análisis y Resumen, que nunca ofrecen tarjeta, y a propósito: dice por qué no
  // la hay en el modo en que más se pulsa el botón.
  if (diagrama) {
    log.info('Sin navegación', 'una respuesta a «Dibujar el flujo» no es un sitio al que llevar')
    return
  }
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

  // La nota del camino es de ESTA planificación (revisión adversaria de H28,
  // D9): en Rápida `learnAncestry` no se llama, y la nota de un fallo de antes
  // sobre el mismo destino se colgaba de la tarjeta culpando al script roto de
  // un salto único que era por diseño. La tregua de `learnAncestry` la repone
  // con su motivo, así que un segundo intento sobre la misma página no la pierde.
  state.ancestryNote = null
  const { plan, reason, source } = await planNavigation(state.client, {
    model: state.model,
    // El rápido del mismo proveedor, saltando lo que ya falló (H16): sin eso el
    // planificador caía en `gpt-5.3-codex-spark`, que el plan de Copilot rechaza.
    plannerModel: pickPlannerModel(state.models, state.model, { checks: state.modelChecks, now: Date.now() }),
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
    // En un espacio SIN mapa propio (H21): no hay plan porque el árbol de este
    // espacio no está en el índice, y eso se dice con la tarjeta que ofrece
    // construirlo, en vez de un «sin navegación» mudo. Sólo detrás del
    // planificador, sólo en Confluence y sólo si la respuesta apuntaba a algún
    // sitio (como la tarjeta de sin índice): la guarda de arriba sigue mirando
    // el índice ENTERO, así que un destino de OTRO espacio del índice sigue
    // dando su tarjeta con el paso a paso, que empieza por «Espacio X». En Jira
    // no cambia nada.
    if (
      state.site?.product === 'confluence' &&
      isRealSpaceKey(state.site.spaceKey) &&
      !hasMap(state.contexts, state.index, scopeKeyOf(state.site)) &&
      (skill.alwaysPlan || shouldPlan(answer, { pages: { x: { title: 'x' } } }))
    ) {
      log.info('Sin navegación', 'este espacio no tiene mapa')
      attachToBubble(bubble, sinMapaCard({ espacio: state.site.spaceKey }))
      return
    }
    if (reason) log.info('Sin navegación', reason)
    return
  }

  if (source === 'respuesta') {
    log.ok('Destino leído de la respuesta', `${plan.destination.title} · sin preguntar al modelo`)
  }
  const card = navCard(plan)
  // Una página con un solo paso lleva sólo «Llévame» (H28, PLAN3 §3.2). Si es
  // porque el camino no se pudo leer, se dice en la tarjeta y con su motivo: se
  // veía igual que la de una página que cuelga de la portada, que no tiene
  // ramas y es así a propósito. Sólo con la nota de ESTE destino y este sitio,
  // apuntada en esta planificación (se vacía antes de planificar, D9).
  // Antes de colgarla, para que el aviso entre en lo que se anuncia.
  const nota = state.ancestryNote
  if (
    plan.destination.kind === 'confluence-page' &&
    (plan.steps?.length || 0) <= 1 &&
    nota?.id === plan.destination.id &&
    nota?.host === (state.site?.host ?? state.lastHost)
  ) {
    card.appendChild(noticeNode('No he podido leer el camino (' + nota.motivo + '): sólo puedo llevarte de golpe.', true))
  }
  attachToBubble(bubble, card)
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
 *
 * Y desde H28 (PLAN3 §3.2) el porqué de ese «de golpe» no se queda sólo en el
 * Registro: cada fallo apunta `state.ancestryNote` con el destino y el motivo,
 * y `offerNavigation` lo cuelga de la tarjeta. La tregua no es un null sin
 * más desde la revisión adversaria de H28 (D9): es el fallo de hace menos de
 * un minuto, y repone la nota con el motivo que éste guardó. Los null que no
 * son un fallo (sin pestaña, un id que no es de página) no la tocan; leer el
 * camino, o tenerlo ya, la vacía.
 */
async function learnAncestry(destination) {
  if (!state.site || !state.tabId) return null
  const id = String(destination?.id || '')
  if (!/^\d+$/.test(id)) return null

  const host = state.site.host
  const tabId = state.tabId
  const clave = `${host}:${id}`
  const conocido = ancestryOf(state.index, id, 50).length
  const previo = state.ancestryFetched.get(clave)
  if (previo?.largo === conocido) {
    state.ancestryNote = null
    return null
  }
  // Una API que no contesta no se vuelve a esperar en cada respuesta: un
  // minuto de tregua, y luego se reintenta. La tregua repone la nota con el
  // motivo que guardó el fallo (revisión adversaria de H28, D9): la nota se
  // vacía al empezar cada planificación, y sin esto el segundo intento sobre la
  // misma página —o el de después de leer bien otra— daba un solo «Llévame» sin
  // aviso, como si fuera diseño.
  if (previo?.fallo && Date.now() - previo.fallo < 60000) {
    state.ancestryNote = { host, id, motivo: previo.motivo || 'la API no contestó hace un momento' }
    return null
  }

  // Sin content script no hay quien lea el árbol, y tampoco quien lo recorra:
  // el camino no hace falta, porque no se va a poder ofrecer. Sin tregua: el
  // acceso se arregla recargando, y eso tiene que valer al momento. Una pestaña
  // que cambió mientras se comprobaba el script tampoco es un permiso que falte
  // (D5): se dice que se cambió de pestaña.
  if (!(await ensureContentAccess({ announce: false }))) {
    const motivo = state.tabId !== tabId ? 'has cambiado de pestaña' : sinAccesoMotivo(state.contentProblem, { tabId, host }) || 'sin acceso a la pestaña'
    state.ancestryNote = { host, id, motivo }
    log.warn('Sin camino', `no puedo leer el árbol (${motivo}); te llevaré de golpe`)
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
    const motivo = failReason(r, 'la pestaña no contestó')
    state.ancestryNote = { host, id, motivo }
    log.warn('Sin camino', `${motivo} · te llevaré de golpe`)
    // Con su motivo, para que la tregua pueda reponer la nota (D9).
    state.ancestryFetched.set(clave, { fallo: Date.now(), motivo })
    return null
  }

  state.ancestryFetched.set(clave, { largo: r.pages.length })
  state.ancestryNote = null
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
  // Con el permiso dado y el script sin arrancar, «sin permiso» era mentira
  // (H28, revisión adversaria de H27, D2): se dice lo que pasa y qué hacer.
  // Y con la pestaña cambiada mientras se comprobaba el script, tampoco
  // (revisión adversaria de H28, D5): el aviso decía «sin permiso» en la
  // tarjeta con el permiso dado.
  if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
    if (tabId != null && state.tabId !== tabId) {
      fallo('pestaña', 'No he leído la lista: has cambiado de pestaña.')
      return null
    }
    const roto = sinAccesoMotivo(state.contentProblem, { tabId, host: site.host })
    fallo('permiso', roto ? `No puedo leer la lista (${roto}): recarga la pestaña.` : `No puedo leer la lista sin permiso sobre ${site.host}.`)
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
    fallo(failReason(r, 'sin respuesta'), jqlFailText(r, site.host))
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

// ------------------------------------------------------------ diagramas (H24)

/**
 * La pregunta que manda «Dibujar el flujo» (decisión 17, H29).
 *
 * Sin claves, sin host y sin título (§8.20, la misma regla que
 * `PRELOAD_QUESTION`): «tu última respuesta» ya está en la sesión, y lo que
 * escribe el botón es exactamente esta constante (lo armado viaja con ella,
 * como en cualquier envío: revisión de H29, D2). Pide lo que el parser sabe
 * leer (`readFlowchart`): un `flowchart` en su valla, la clave como primera
 * palabra de cada etiqueta —de ahí sale el nodo que navega— y las clases de
 * `NOTE_KINDS`.
 *
 * H26: pide también «sin classDef, style, click, href ni URL». En el turno real
 * del 2026-09-27 (github-copilot/gpt-5.6-luna) el modelo puso un `classDef`
 * debajo de su `:::riesgo`, por costumbre. El parser ya ignora las líneas de
 * presentación, pero rechaza `click` y `href` (§8.3), y con ellos el
 * diagrama entero: mejor que el modelo no los escriba. No dice «enlaces»
 * (revisión adversaria de H26): en Mermaid un «link» es una arista, y un modelo
 * que lo leyera así dibujaría el flujo sin flechas.
 */
const DIAGRAM_QUESTION = 'Dibuja el flujo entre las incidencias de tu última respuesta como un diagrama Mermaid «flowchart LR» dentro de un bloque ```mermaid: como mucho 15 nodos, cada nodo con la clave de la incidencia como primera palabra de su etiqueta y después su resumen corto; :::riesgo, :::hueco o :::contradiccion en lo que falle, y el número [n] de la observación que lo respalde; sin classDef, style, click, href ni URL. Sólo el diagrama y una frase.'

/**
 * «Dibujar el flujo»: el botón que cuelga de una respuesta de Jira que cita tres
 * incidencias o más (H24).
 *
 * MANDA su pregunta al pulsarlo (decisión 17, H29). En H24 sólo la dejaba
 * escrita, como «Preguntar sobre estos», por una regla heredada de §8.20 sin
 * motivo propio; el 2026-09-28 Marco pidió que no fuera «copiar y pegar un
 * prompt en el input del chat» sino que lo hiciera directamente, como ya hacen
 * las sugerencias del chat vacío, «Reintentar con X» y «Pedirlo numerado». Su
 * texto es sólo `DIAGRAM_QUESTION`, y sale una vez: apunta con el host del
 * momento que el turno es para dibujar (`state.pendingDiagram`, que consume
 * `send()`) ANTES de mandar, o el armado quedaría vivo para la pregunta
 * siguiente; y escribe la pregunta antes de `send()`, o mandaría el borrador.
 * Lo que esté armado —lo señalado en la página, la imagen señalada como
 * adjunto, lo precargado con «Preguntar sobre estos» y, en Análisis, la
 * incidencia en bloques y las páginas base— viaja con ella, como con cualquier
 * envío, y la nota bajo la pregunta lo dice (revisión de H29, D2).
 *
 * El foco va al cuadro ANTES de `send()`: la fila del botón desaparece al
 * mandar, y si `send()` sale pronto la pregunta se queda escrita con el foco
 * ahí, como antes (el Registro dice «pedido desde el botón» sin «Turno
 * enviado»). Con el botón a la vista, la salida pronta que se da es la de sin
 * sitio: se preguntó en Jira y la pestaña pasó a una fuera de Atlassian
 * mientras llegaba la respuesta (la oferta se pinta con lo capturado al pedir).
 * Era muda —el botón prometía mandar y no pasaba nada— y ahora lo dice con
 * `showNotice`, que ya anuncia (revisión de H29, D1); `!state.client` no se da
 * aquí: sin cliente no hubo turno que pintara el botón. Al mandar, sin
 * `announce`, como Intro y los otros tres botones que mandan: el lector oye el
 * foco en el cuadro, ya vacío, y la respuesta se anuncia al terminar (A2); a la
 * vista, la fila se va y sale la burbuja con su nota.
 *
 * Un doble clic no abre dos turnos: `send()` retira la fila del botón, vacía el
 * cuadro y se pone ocupado (`setStreaming(true)`) antes de su primer `await`,
 * así que el segundo clic no encuentra el botón y un Enter encuentra el cuadro
 * vacío; y `setStreaming` no deshabilita el cuadro, así que el foco pedido se
 * queda. Por lo mismo, justo detrás de `send()` `state.streaming` ya dice si
 * salió, y el aviso se apoya en eso. Lo pina la prueba H24 de panel-wiring
 * contra el `send()` y el `setStreaming` reales (revisión de H29, D3). La
 * viñeta en el prompt de Análisis se descartó a propósito (docs/PLAN2.md
 * §8.10): las 40 instantáneas no cambian. `NEEDS_IDLE`, como los demás botones
 * del chat: nace con el turno todavía en vuelo.
 */
function diagramButton() {
  const b = document.createElement('button')
  b.className = 'ghost small ' + NEEDS_IDLE
  b.type = 'button'
  b.textContent = 'Dibujar el flujo'
  b.title = 'Manda la pregunta que pide el diagrama'
  b.disabled = state.streaming
  b.addEventListener('click', () => {
    if (state.streaming) return
    state.pendingDiagram = { host: state.site?.host || '' }
    log.info('Diagrama', 'pedido desde el botón')
    el.input.value = DIAGRAM_QUESTION
    autoGrow()
    el.input.focus()
    send()
    if (!state.streaming && !state.site) showNotice('No lo he mandado: esta pestaña no es de Jira. Vuelve a la de Jira y pulsa Intro; la pregunta queda en el cuadro.', true)
  })
  return b
}

/**
 * Los textos de diagrama ya apuntados en el Registro en esta sesión: `paintTurn`
 * repinta la burbuja entera en cada trozo del streaming, y cada diagrama se dibuja
 * muchas veces; se apunta una. Un conjunto y no «el último»: con dos diagramas en
 * la misma respuesta cada repintado alternaba A→B y apuntaba los dos (19
 * registros donde van 2, con el Registro topado en 400; revisión adversaria de
 * H24, D04). Se vacía con el chat (`newSession`, «Olvidar este sitio»); reabrir
 * el panel (`restoreConversation`) no, a propósito: no vuelve a apuntar lo que
 * ya estaba. Sin tope: guarda bloques cerrados, copia de lo que ya hay en el chat.
 */
const diagramasRegistrados = new Set()
/** Los `uid` de los diagramas: dos en el mismo chat no comparten `marker` ni título. */
let contadorDiagramas = 0
/** El medidor de texto con la fuente del chat, creado una vez (`medirTextoDelPanel`). */
let medidorDelPanel = null

/**
 * El `onCodeBlock` de las cuatro llamadas a `renderMarkdown`: la ÚNICA función
 * del panel que dibuja un diagrama (H24).
 *
 * Sólo un ```mermaid con la valla CERRADA: mientras llega a trozos se ve el
 * código, y un diagrama a medias no se dibuja. Todo lo que hay dentro lo
 * escribió el modelo (§8.12): lo lee `readFlowchart`, con claves blancas, y lo
 * pinta `diagramNode` sin innerHTML. Lo que no se entiende deja el bloque de
 * código de siempre con el motivo DEBAJO (§8.14: un fallo silencioso no). Un
 * nodo con clave no navega por su cuenta: `abrirNodoDelDiagrama` valida al hacer
 * clic (§8.3). Las insignias [n], sólo de las observaciones que hay (`state.notes`).
 * La valla se mira sin mayúsculas: un ```Mermaid no se dibujaba, no avisaba y
 * sacaba el botón (revisión adversaria de H24, D18). El tipo de cada nodo se dice
 * con las etiquetas de la tarjeta (`KIND_LABELS`, con su tilde), no sólo con el
 * color (D15). Desde H25, en Jira DC y con dos claves del índice o más, la fila
 * de acciones gana «Contrastar con Jira» (`linksButton`): el botón no es un
 * registro, así que el de «Diagrama» no cambia.
 */
function drawCodeBlock(block, pre) {
  if (block.lang.toLowerCase() !== 'mermaid' || !block.closed) return null
  const t0 = performance.now()
  const d = readFlowchart(block.text)
  const nuevo = !diagramasRegistrados.has(block.text)
  diagramasRegistrados.add(block.text)
  if (!d.ok) {
    if (nuevo) log.info('Diagrama', 'no dibujado · ' + d.errores[0])
    const caja = document.createElement('div')
    caja.className = 'dg-fallback'
    caja.append(pre, noticeNode('No he podido dibujarlo: ' + d.errores[0]))
    return caja
  }
  const layout = layoutDiagram(d, { measure: medirTextoDelPanel() })
  const figure = diagramNode(d, layout, {
    onOpen: abrirNodoDelDiagrama,
    onNote: focusNote,
    onCopy: copiarMermaid,
    notes: new Set(state.notes.map((n) => n.n)),
    mermaid: toMermaid(d),
    uid: 'dg' + (++contadorDiagramas),
    kinds: KIND_LABELS,
  })
  const boton = linksButton(d, figure)
  if (boton) figure.querySelector('.dg-actions')?.appendChild(boton)
  if (nuevo) log.ok('Diagrama', `${d.nodes.length} nodos · ${d.edges.length} aristas · ${d.nodes.filter((n) => n.ref).length} con clave · ${Math.round(performance.now() - t0)} ms`)
  return figure
}

/**
 * La anchura de un texto con la fuente REAL del chat, para que el layout parta
 * las etiquetas como las va a pintar el navegador (§9: una sola medida). Se
 * crea una vez por panel: la fuente no cambia con el tema.
 */
function medirTextoDelPanel() {
  if (!medidorDelPanel) medidorDelPanel = textMeasurer(getComputedStyle(el.chat).font || '12px sans-serif')
  return medidorDelPanel
}

/**
 * Un nodo del diagrama con clave de incidencia, pulsado: el MISMO camino que una
 * fila de la lista de Jira (`openIssueFromResults`: `validatePlan` contra el
 * índice de ahora, el aviso en la figura si no está, `runPlan('direct')`). Ni
 * una URL aquí. `runPlan` apaga todos los botones de la tarjeta —aquí, la
 * figura— y un salto directo no los vuelve a encender: «Copiar como Mermaid» se
 * quedaba muerto tras abrir un nodo. Menos el que tiene una lectura en vuelo
 * (`dataset.leyendo`, «Contrastar con Jira»): encenderlo dejaba mandar una
 * segunda petición con la primera sin volver (revisión de H25, D08).
 */
async function abrirNodoDelDiagrama(ref, figure) {
  if (ref?.kind !== 'jira-issue' || !state.site) return
  await openIssueFromResults(ref.id, { site: state.site, card: figure })
  for (const b of figure.querySelectorAll('.dg-actions button')) b.disabled = b.dataset.leyendo === '1'
}

/** «Copiar como Mermaid»: al portapapeles, y al Registro sólo si de verdad se copió. */
async function copiarMermaid(texto, boton) {
  if (!(await copyToClipboard(texto, boton))) return
  log.ok('Diagrama', `Mermaid copiado · ${texto.length} caracteres`)
  announce('Diagrama copiado como Mermaid.')
}

/**
 * Las claves de un diagrama que se pueden contrastar con Jira (H25b): las de
 * los nodos con `ref` de incidencia que YA están en el índice —cosechadas por
 * M4 de la salida de una herramienta o de una lectura REST, nunca de la prosa—,
 * sin repetir, en el orden del diagrama y con el tope de una consulta
 * (`JIRA_REST_LIMITS.linkKeys`). Una clave que el modelo escribió y el índice
 * no tiene no sale del panel: nada del diagrama se vuelve consulta (§8.27).
 * Pura: el índice se pasa, no se lee del estado. La regla es `clavesDelIndice`
 * de diagram-links.js, la MISMA que usa el tramo 66 del banco (antes el banco
 * filtraba por su cuenta y su comprobación de SEGURIDAD no vigilaba nada del
 * panel: revisión de H25, D06); el tope, que tiene dueño, lo pone aquí.
 */
function clavesParaContrastar(diagrama, indice) {
  return clavesDelIndice(diagrama, indice, JIRA_REST_LIMITS.linkKeys)
}

/**
 * «Contrastar con Jira», en la fila de acciones de un diagrama (H25b): sólo en
 * un Jira Data Center —en Cloud no hay REST de Jira (`sinRestDeJira`)—, con las
 * lecturas REST encendidas (`restTools`, el interruptor maestro) y con dos
 * claves del índice o más, porque un grafo necesita dos. Las claves NO se
 * guardan en el botón: se recalculan al hacer clic con el índice de ESE
 * momento, como un nodo que navega.
 */
function linksButton(diagrama, figura) {
  if (state.site?.product !== 'jira' || state.site.cloud || !state.settings.restTools) return null
  if (clavesParaContrastar(diagrama, state.index).length < 2) return null
  const boton = document.createElement('button')
  boton.className = 'ghost small'
  boton.type = 'button'
  boton.textContent = 'Contrastar con Jira'
  boton.title = 'Lee las relaciones reales de estas incidencias por la API de Jira y las dibuja debajo'
  boton.addEventListener('click', () => contrastarConJira(diagrama, figura, boton))
  return boton
}

/**
 * Las filas de la lista de diferencias de «Según Jira»: lo que el modelo dibujó
 * y Jira no tiene, lo que Jira tiene y el modelo no dibujó, «Coinciden todas»
 * si no hay ninguna de las dos, y las claves que no se pudieron contrastar.
 * Pura. El espejo (harness/panel-preview.html) lleva una copia letra a letra,
 * pinada en panel-wiring.test.js: las frases no pueden decir cosas distintas.
 */
function filasDeLaComparacion(comparacion) {
  const filas = [
    ...comparacion.soloModelo.map((a) => `El modelo dibujó ${a.from} → ${a.to}${a.label ? ` (${a.label})` : ''} y Jira no lo tiene`),
    ...comparacion.soloJira.map((r) => `Jira tiene ${r.from} ${r.type || '→'} ${r.to} y el modelo no lo dibujó`),
  ]
  if (!filas.length) filas.push('Coinciden todas')
  const fuera = comparacion.fuera
  if (fuera.length === 1) filas.push(`Sin contrastar: ${fuera[0]} (no está en el índice o Jira no la ha devuelto)`)
  if (fuera.length > 1) filas.push(`Sin contrastar: ${fuera.join(', ')} (no están en el índice o Jira no las ha devuelto)`)
  return filas
}

/**
 * El aviso de «Contrastar con Jira» en su figura (revisión de H25, D02): UNO
 * por figura —el de antes se quita, así tres clics con el mismo 400 no apilan
 * tres avisos iguales— y anunciado siempre (A2), porque responde a un clic del
 * usuario. NO pasa por la tregua de `restFailureDue`: su clave es host·sesión·
 * motivo y la gastan también `readToday` (que corre sola al arrancar) y la
 * lista de Jira, así que con una sesión caducada el PRIMER clic se quedaba
 * mudo (§8.14). La clase `dg-aviso` es sólo una marca: quita el suyo y deja
 * el aviso ajeno de la figura (el de `openIssueFromResults` al abrir un nodo).
 */
function avisoEnLaFigura(figura, texto, bad = false) {
  figura.querySelector(':scope > .dg-aviso')?.remove()
  const aviso = noticeNode(texto, bad)
  aviso.classList.add('dg-aviso')
  figura.appendChild(aviso)
  announce(texto)
}

/**
 * Lee las relaciones REALES de Jira entre las incidencias de un diagrama y las
 * dibuja como un segundo diagrama, «Según Jira», debajo del del modelo, con lo
 * que coincide y lo que no (H25b; §8.19, §8.27).
 *
 * El dibujo del modelo es lo que CREE que hay; las `issuelinks` son lo que hay,
 * y lo que la API da exacto no se le pide al modelo. La petición la hace el
 * content script con la sesión del navegador, y el mensaje lleva SÓLO claves
 * del índice —ni JQL, ni origen, ni URL, ni ruta, ni host—: la consulta es la
 * plantilla fija `linksJql` de jira-rest.js, y el content script vuelve a
 * validar cada clave. Lo leído se PINTA y no va a ningún prompt (§8.19,
 * §8.20), ni se guarda: la figura no se restaura al reabrir el panel.
 *
 * Se captura al pedir (§8.22): sitio, host, sesión, pestaña e índice, antes del
 * primer await; al volver, si la figura ya no está (el chat se repintó) o el
 * panel está en otro sitio u otra sesión, no se pinta nada. El botón nació con
 * el sitio de ENTONCES: con las lecturas apagadas después en Ajustes, o la
 * pestaña fuera de un Jira DC, no sale ninguna petición. Cada fallo se ve
 * (§8.14) y queda en el Registro: uno por figura, sustituido y anunciado
 * (`avisoEnLaFigura`), sin la tregua de la lista y de «hoy», porque el clic es
 * del usuario (D02). Si Jira devuelve menos de dos de las pedidas, se dice
 * cuántas y cuáles no volvieron ('devueltas', D03) y la figura «Según Jira»
 * de antes se conserva, como con cualquier fallo. Mientras la lectura vuela,
 * el botón lleva `dataset.leyendo` y otro clic no pide nada (D08).
 */
async function contrastarConJira(diagrama, figura, boton) {
  if (boton.dataset.leyendo) return
  const sitio = state.site
  const host = sitio?.host || state.lastHost
  const sessionID = state.sessionID
  const tabId = state.tabId
  const indice = state.index
  const t0 = performance.now()
  const avisar = (fallo) => {
    const texto = linksFailText(fallo, host)
    log.warn('Relaciones de Jira', `${failReason(fallo, 'sin respuesta')} · ${texto}`)
    avisoEnLaFigura(figura, texto, true)
  }
  if (!sitio || sitio.product !== 'jira' || sitio.cloud || !state.settings.restTools) {
    const detail = state.settings.restTools ? 'la pestaña no es de un Jira Data Center' : 'las lecturas por la API están apagadas en Ajustes'
    avisar(sitio?.cloud ? { reason: 'cloud' } : { reason: 'apagado', detail })
    return
  }
  const claves = clavesParaContrastar(diagrama, indice)
  if (claves.length < 2) {
    avisar({ reason: 'claves' })
    return
  }
  boton.disabled = true
  boton.dataset.leyendo = '1'
  const acceso = tabId != null && (await ensureContentAccess({ announce: false }))
  // Sin acceso porque la pestaña cambió mientras se comprobaba el script no es
  // «permiso» en el Registro (revisión adversaria de H28, D5): se dice.
  const r = acceso
    ? await chrome.tabs.sendMessage(tabId, { type: MSG.ISSUE_LINKS, keys: claves, cloud: sitio.cloud }).catch(() => null)
    : state.tabId !== tabId
      ? { ok: false, reason: 'pestaña', detail: 'has cambiado de pestaña' }
      : { ok: false, reason: 'permiso' }
  delete boton.dataset.leyendo
  boton.disabled = false
  if (!figura.isConnected || (state.site?.host ?? state.lastHost) !== host || state.sessionID !== sessionID) {
    log.info('Relaciones de Jira', `lo leído de ${host} llegó con el diagrama repintado o el panel en otro sitio`)
    return
  }
  if (!r?.ok) {
    avisar(r)
    return
  }
  const { diagram, comparacion } = jiraDiagram(diagrama, r)
  if (!diagram) {
    avisar({ reason: 'devueltas', devueltas: comparacion.nodos, pedidas: claves.length, fuera: comparacion.fuera.filter((k) => claves.includes(k)) })
    return
  }
  if (figura.nextElementSibling?.classList.contains('dg-jira')) figura.nextElementSibling.remove()
  const resumen = resumenJira(comparacion)
  const layout = layoutDiagram(diagram, { measure: medirTextoDelPanel() })
  const figuraJira = diagramNode(diagram, layout, {
    onOpen: abrirNodoDelDiagrama,
    onCopy: copiarMermaid,
    mermaid: toMermaid(diagram),
    uid: 'dg' + (++contadorDiagramas),
    kinds: KIND_LABELS,
  })
  figuraJira.classList.add('dg-jira')
  const pie = document.createElement('figcaption')
  pie.className = 'dg-caption'
  pie.textContent = resumen
  figuraJira.prepend(pie)
  const diferencias = document.createElement('ul')
  diferencias.className = 'dg-diff'
  for (const texto of filasDeLaComparacion(comparacion)) {
    const fila = document.createElement('li')
    fila.textContent = texto
    diferencias.appendChild(fila)
  }
  figuraJira.appendChild(diferencias)
  figura.querySelector(':scope > .dg-aviso')?.remove()
  figura.after(figuraJira)
  announce(resumen)
  log.ok('Relaciones de Jira', `${resumen} · ${Math.round(performance.now() - t0)} ms`)
}

/**
 * Lo que se dice cuando las marcas de un análisis ya no tienen dónde ir porque
 * el panel mira otra pestaña u otro sitio que los de la pregunta (H28, §8.14).
 *
 * UNA vez y no copiado: `offerNotes` llega aquí por dos sitios (revisión
 * adversaria de H28, D5), la guarda de antes de medir la respuesta y la de
 * después de comprobar el script, porque la pestaña también puede cambiar
 * mientras el service worker contesta; y ahí se leía como «falta permiso».
 * Fuera del trozo `offerNotes`→`notesCard` que cuentan las pruebas de §8.14:
 * el «Sin marcas» y su aviso van juntos aquí.
 */
function avisarCambioDePestana(bubble) {
  log.info('Sin marcas', 'has cambiado de pestaña o de sitio: no marco nada')
  attachToBubble(bubble, noticeNode('Has cambiado de pestaña o de sitio: no he marcado nada. Vuelve a la página y pide el análisis otra vez.', true))
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
    esDiagrama = false,
    tabIdAlPedir = null,
    sitioAlPedir = null,
  } = {}
) {
  // De qué se habla en los avisos y en la tarjeta: en Jira lo abierto es una
  // incidencia, y «esta página» ahí significa una página de Confluence.
  const abierta = product === 'jira' ? 'esta incidencia' : 'esta página'
  if (skill !== 'analisis') return
  // La pregunta era «Dibujar el flujo» (H24): la respuesta es un diagrama, no un
  // análisis, y sin esto la escalera acabaría en la pasada que trocea —un turno
  // de pago— para buscar observaciones que no hay. Sin aviso en el chat porque
  // lo visible es el diagrama dibujado; y con el título «Diagrama» y no «Sin
  // marcas», que en este panel siempre lleva su aviso al lado (§8.14).
  if (esDiagrama) {
    log.info('Diagrama', 'sin marcas: la pregunta era dibujar el flujo')
    return
  }
  // Las marcas son de la pestaña y el sitio con los que se pidió (H28, PLAN3
  // §3.2, §8.22). Esta salida era MUDA: un análisis de ocho observaciones que no
  // subraya nada porque el usuario se fue a otra pestaña mientras contestaba el
  // modelo, sin una palabra en el chat. Ahora se registra y se dice. Sin sitio en
  // la pestaña (se fue de Atlassian en la misma) también es haberse ido.
  if (!state.site || state.tabId !== tabIdAlPedir || state.site.host !== sitioAlPedir?.host || !state.client) {
    avisarCambioDePestana(bubble)
    return
  }
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
  // Con el content script roto no falta ningún permiso (revisión adversaria de
  // H27, D2): el Registro dice el motivo, y el aviso lo cambia ya
  // `showPermissionNotice`. Con la pestaña y el sitio que ya se comprobaron
  // arriba, que son los que miró `ensureContentAccess` al empezar.
  // Y si la pestaña cambió mientras el service worker contestaba, no falta
  // ningún permiso (revisión adversaria de H28, D5): se registraba «falta
  // permiso» y, con la pestaña nueva fuera de Atlassian, la tarjeta reventaba.
  if (!(await ensureContentAccess({ announce: false }))) {
    if (state.tabId !== tabIdAlPedir || state.site?.host !== sitioAlPedir?.host) {
      avisarCambioDePestana(bubble)
      return
    }
    log.warn('Sin marcas', sinAccesoMotivo(state.contentProblem, { tabId: tabIdAlPedir, host: sitioAlPedir.host }) || 'falta permiso en ' + sitioAlPedir.host)
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

  // Una respuesta que no es un «sí» (H28, PLAN3 §3.2): la del editor es a
  // propósito y se dice como siempre; cualquier otra —nadie contestó, o un
  // content script roto con su `error`— pintaba una tarjeta con TODAS las
  // observaciones «no la he encontrado en la página» y registraba «Análisis
  // marcado · 0 de 8», como si las anclas fueran malas. Ahora se dice que la
  // página no contestó, con el motivo, y no se pinta tarjeta ni se registra nada.
  if (!res || res.ok === false) {
    if (res?.reason === 'editando') {
      log.warn('Sin marcas', 'estás en el editor')
      attachToBubble(bubble, noticeNode('Estás en el editor: no marco nada para no interferir.'))
      return
    }
    const motivo = failReason(res, 'la pestaña no contestó')
    log.warn('Sin marcas', 'la página no contestó al marcar: ' + motivo)
    attachToBubble(bubble, noticeNode('No he podido marcar la página (' + motivo + '). Recarga la pestaña y vuelve a pedirlo.', true))
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
  // Como al marcar la primera vez (H28): una página que no contesta, o que
  // contesta con su error, no es «esas marcas eran de otra página».
  if ((!res || res.ok === false) && res?.reason !== 'editando') {
    const motivo = failReason(res, 'la pestaña no contestó')
    log.warn('Sin marcas', 'la página no contestó al marcar de nuevo: ' + motivo)
    showNotice('No he podido marcar la página (' + motivo + '). Recarga la pestaña y vuelve a intentarlo.', true)
    return
  }
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
    // Con el motivo de un content script roto también (H28), no sólo el suyo.
    showNotice(failReason(res, 'Esa marca ya no está en la página.'), true)
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

/**
 * Sin índice no hay navegación: se dice, y se ofrece construirlo.
 *
 * Con `espacio` (H21) es la de un espacio SIN mapa propio en un sitio que sí
 * tiene índice: el mapa se construye una vez por espacio, y la tarjeta lo dice.
 * Sin él, la de siempre, letra a letra.
 */
function sinMapaCard({ espacio = '' } = {}) {
  const card = document.createElement('div')
  card.className = 'nav-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = 'Aún no puedo llevarte'

  const title = document.createElement('div')
  title.className = 'nav-title'
  title.textContent = espacio ? 'Me falta el mapa de este espacio' : 'Me falta el mapa de este sitio'

  const text = document.createElement('div')
  text.className = 'nav-text'
  text.textContent = espacio
    ? `Para llevarte a una página de «${espacio}» necesito su árbol. Construirlo tarda un par de minutos y se hace una vez por espacio.`
    : 'Para llevarte a una página necesito su identificador y el árbol al que pertenece. Construir el contexto tarda un par de minutos y se hace una sola vez.'

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

  // La pestaña del viaje, capturada ANTES de preguntar por el content script
  // (H28, §8.22): es la que se comprobó, la que lleva el recorrido y la que
  // explica el motivo si no se puede. Y su host (revisión adversaria de H28,
  // D5): el de después del await podía ser null, con la pestaña ya fuera de
  // Atlassian, y el registro de abajo reventaba.
  const tabId = state.tabId
  const host = state.site?.host

  // La asistida y el resaltado necesitan el content script; el salto directo
  // no. Por eso el permiso se pide justo aquí, y sólo cuando hace falta. Con
  // el script roto no es el permiso lo que falta (D2): el Registro lo dice.
  // Con la pestaña cambiada mientras se comprobaba, tampoco (D5): ni tarjeta del
  // permiso ni «falta permiso»; la asistida lo dice en su tarjeta y el salto
  // directo sigue hacia la pestaña capturada, que no necesita el script.
  const puede = await ensureContentAccess({ announce: false })
  if (!puede && state.tabId !== tabId) {
    if (mode === 'assisted') {
      const aviso = 'Has cambiado de pestaña: vuelve a ella y pulsa otra vez.'
      card.appendChild(noticeNode(aviso, true))
      announce(aviso)
      log.warn('Asistida bloqueada', 'has cambiado de pestaña')
      return
    }
  } else if (!puede) {
    showPermissionNotice()
    if (mode === 'assisted') {
      log.warn('Asistida bloqueada', sinAccesoMotivo(state.contentProblem, { tabId, host }) || 'falta permiso en ' + host)
      return
    }
  }

  card.querySelectorAll('button').forEach((b) => (b.disabled = true))

  // Un recorrido paso a paso dura varios segundos por rama y se puede parar
  // desde aquí: el service worker atendía CANCEL_PLAN y nadie lo mandaba. El
  // botón vive mientras dura el recorrido y se va con PLAN_FINISHED.
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
  // El final de un «Llévame» también es de este panel aunque ya mire otra
  // pestaña (revisión adversaria de H28, D7): sin esto, `onRuntimeMessage` lo
  // descartaba y no se decía ni «Navegación detenida» ni «Sin resaltar».
  if (type === MSG.NAVIGATE_DIRECT) state.saltoTabId = tabId

  const res = await chrome.runtime.sendMessage({ type, tabId, plan }).catch((e) => ({
    ok: false,
    error: String(e?.message || e),
  }))

  // `avisado`: el service worker ya mandó el PLAN_FINISHED con el motivo, y lo
  // pinta `onRuntimeMessage` (D7). Decirlo aquí también eran dos errores en el
  // Registro, dos avisos y dos anuncios del mismo fallo, llegara antes uno u otro.
  if (res?.ok) {
    log.ok('Navegación lanzada', `${mode} · ${plan.destination.title} · ${plan.destination.url}`)
  } else if (!res?.avisado) {
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
 *
 * `reabrir` es un final con error o sin permiso (revisión adversaria de H28,
 * D7): el aviso dice «vuelve a intentarlo» y la tarjeta se quedaba sin
 * «Llévame» ni «Paso a paso», porque sólo `cancelled` devolvía los botones.
 */
function finishNavRun({ cancelled = false, reabrir = false } = {}) {
  const run = state.navRun
  if (!run) return
  state.navRun = null
  run.stop.remove()
  // Parado a medias o acabado mal, la tarjeta vuelve a ofrecer el viaje;
  // terminado bien, se queda como estaba (ya estás allí). «Navegación
  // cancelada» sólo lo registra la parada.
  if (cancelled || reabrir) run.card.querySelectorAll('button').forEach((b) => (b.disabled = false))
  if (cancelled) {
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
  // La pestaña en la que se pulsó (H28, revisión adversaria de H27, D2): la que
  // `ensureContentAccess` comprueba es la que recibe el PICK_START, y no la que
  // haya delante cuando la comprobación vuelva (§8.22).
  const tabId = state.tabId

  // Con la pestaña cambiada mientras se comprobaba el script no falta ningún
  // permiso (revisión adversaria de H28, D5): la tarjeta del permiso era la de
  // la pestaña nueva, o un TypeError si ésta no es de Atlassian. Se dice.
  const puede = await ensureContentAccess({ announce: false })
  if (!puede && state.tabId !== tabId) {
    log.info('Señalar sin activar', 'has cambiado de pestaña')
    showNotice('Has cambiado de pestaña: vuelve a ella y pulsa otra vez.', true)
    return
  }
  if (!puede) {
    showPermissionNotice()
    return
  }

  // H27 (PLAN3 §3.1, B4): un solo aviso con «Recárgala» valía para todo y no
  // explicaba nada. `null` es que nadie contestó: la pestaña navegó o se cerró
  // entre la comprobación y el clic, y recargar sí ayuda. No es el huérfano de
  // una extensión recargada: ése no contesta al PING y `ensureContentAccess` ya
  // reinyectó antes de llegar aquí (revisión adversaria de H27, D10).
  // `ok: false` es un script que contesta y dice por qué no arranca, y lo que
  // hay que enseñar es ese motivo.
  const r = await chrome.tabs.sendMessage(tabId, { type: MSG.PICK_START }).catch(() => null)
  if (r == null) {
    log.warn('Señalar sin activar', 'la pestaña no contesta')
    showNotice('No he podido hablar con esta pestaña. Recárgala y vuelve a intentarlo.', true)
    return
  }
  if (!r.ok) {
    const motivo = r.error || 'motivo desconocido'
    log.warn('Señalar sin activar', motivo)
    showNotice('No he podido activar la selección: ' + motivo + '.', true)
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

/**
 * El aviso de «este sitio no tiene el MCP conectado», cuando se sepa.
 *
 * Desde P5 (H14) el arranque no espera a la comprobación, así que la pantalla
 * puede abrirse con ella en vuelo: se esconde el aviso —decir que no hay MCP sin
 * saberlo es peor que tardar un segundo en decirlo— y se pinta al resolverse.
 * Con el host capturado: la pantalla sigue abierta al cambiar de pestaña dentro
 * del mismo sitio, pero una respuesta de OTRO host no pinta aquí (§8.22).
 */
async function paintSourcesMcp() {
  const aviso = $('sources-mcp')
  aviso.classList.add('hidden')
  const host = state.site?.host || ''
  const conectado = await currentMcpCheck()
  if ($('screen-sources').classList.contains('hidden')) return
  if ((state.site?.host || '') !== host) return
  aviso.classList.toggle('hidden', conectado)
}

async function showSourcesScreen() {
  if (!state.site) return
  const s = state.sources
  $('sources-mode-exclusive').checked = s.mode === 'exclusive'
  $('sources-mode-open').checked = s.mode !== 'exclusive'
  $('sources-query').value = ''
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
  // Y el MCP, que puede seguir comprobándose (P5): esta pantalla no puede decir
  // «no hay MCP» sin saberlo todavía, ni callárselo si no lo hay, así que se
  // pinta en cuanto se sepa y sin que lo demás espere (§8.14: si no llegara
  // nunca, el aviso no sale y la pantalla funciona igual). DESPUÉS de abrirla,
  // para que su guarda de «¿sigue abierta?» signifique eso y no dependa de en
  // qué orden se vacíe la cola de microtareas.
  paintSourcesMcp().catch(console.error)

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
  const tabId = state.tabId
  const host = state.site.host
  const puede = await ensureContentAccess({ announce: false })
  // Con la pestaña cambiada mientras se comprobaba el script (revisión
  // adversaria de H28, D5), tampoco: no se sabe nada del permiso, y leer
  // `state.site.host` con la pestaña fuera de Atlassian reventaba.
  if (!puede && state.tabId !== tabId) {
    setSourcesStatus('Has cambiado de pestaña: vuelve a ella y abre otra vez esta pantalla para buscar en Confluence.')
    return
  }
  // Con el permiso dado y el script sin arrancar (H28, revisión adversaria de
  // H27, D2), el botón pediría un permiso que ya está: no se enseña, y se dice
  // el motivo, qué hacer y lo que queda, que es el índice.
  const roto = puede ? '' : sinAccesoMotivo(state.contentProblem, { tabId, host })
  if (roto) {
    const n = Object.keys(state.index?.pages || {}).length
    setSourcesStatus(
      n
        ? `No puedo preguntarle a Confluence (${roto}). Recarga la pestaña; mientras, sólo busco en lo que ya tengo indexado (${n} páginas).`
        : `No puedo preguntarle a Confluence (${roto}). Recarga la pestaña; mientras, pega la URL o el id de la página.`
    )
    return
  }
  if (!puede) {
    $('sources-perm').classList.remove('hidden')
    $('sources-perm-text').textContent = `Sin permiso sobre ${host} sólo busco en lo que ya tengo indexado.`
    const n = Object.keys(state.index?.pages || {}).length
    setSourcesStatus(
      n
        ? `Sin permiso sobre ${host} sólo busco en lo que ya tengo indexado (${n} páginas).`
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
  // tarda, y el de otro sitio no es éste (§8.22). Y con él se vuelve a elegir
  // el enlazado: la entrada nueva puede cambiar lo que dice la regla (b)
  // (revisión adversaria de H22, G10).
  if ((state.site?.host ?? state.lastHost) === host) {
    state.sourceHistory = guardado
    applyLinkedScope()
  }
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
    log.warn('Enlaces de la página', failReason(r, 'la pestaña no contestó'))
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
    // Con el content script de esta pestaña roto no es el permiso (H28,
    // revisión adversaria de H27, D2): se dice el motivo y qué hacer.
    const roto = sinAccesoMotivo(state.contentProblem, { tabId: state.tabId, host: state.site?.host })
    if (roto) return `No leo los enlaces de ${cosa} (${roto}): recarga la pestaña. Mientras, sugiero con el contexto del sitio y lo que usaste antes.`
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
  // Sin historial, la regla (b) de `linkedSpacesFor` ya no tiene de dónde
  // elegir: se vuelve a elegir el enlazado ahora, sin leer nada (revisión
  // adversaria de H22, G10).
  applyLinkedScope()
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
  // El espacio de la pestaña DELANTE, sin excluir los demás (H21): una página
  // base de otro espacio es legítima, pero a igual puntuación la del espacio en
  // el que se está suele ser la que se busca. Desde un Jira no hay espacio y el
  // orden es el de siempre.
  const local = suggestFromIndex(indice, q, {
    limit: SOURCE_LIMITS.suggestions,
    exclude,
    preferSpace: state.site?.product === 'confluence' ? state.site.spaceKey || '' : '',
  })
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
    log.warn('Búsqueda de páginas', `${donde ? donde + ' · ' : ''}${failReason(r, 'la pestaña no contestó')}`)
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
  return `No he podido preguntarle a ${host || 'Confluence'}: ` + failReason(r, 'la pestaña no contestó') + '.'
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
  // `fetchPageChain` devuelve la respuesta de la pestaña tal cual, y la de un
  // content script roto trae `error` y no `reason`: salía «(undefined)» (H28).
  const motivo = failReason(r, 'sin motivo')
  log.warn('Página base sin título', `${id} · ${motivo}`)
  await addSource({ id, title: '', path }, desde('id'))
  setSourcesStatus(`Añadida por su id ${id}: no he podido leer su título (${motivo}).`)
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
  // La pestaña de la pregunta, para no llamar «sin acceso» a un cambio de
  // pestaña mientras se comprobaba el script (revisión adversaria de H28, D5).
  const tabId = state.tabId
  if (!(await ensureContentAccess({ announce: false }))) {
    return { ok: false, reason: state.tabId !== tabId ? 'has cambiado de pestaña' : 'sin acceso a la pestaña' }
  }
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

/**
 * Lo que llega de la página y del service worker.
 *
 * Un mensaje de runtime llega a TODAS las páginas de la extensión, y con dos
 * ventanas hay dos paneles (H28, PLAN3 §3.2): el segundo pintaba «Navegación
 * detenida» por un recorrido que no era suyo y se quedaba lo señalado en otra
 * pestaña. Lo de la página (NOTE_CLICKED, PICK_RESULT) sólo se atiende si viene
 * de la pestaña de este panel (`sender.tab`; sin pestaña, como hasta ahora); lo
 * del recorrido (PLAN_PROGRESS, PLAN_FINISHED), si su `tabId` es la de este
 * panel o la de un recorrido o un salto que lanzó él (`state.navRun`,
 * `state.saltoTabId`), que siguen siendo suyos aunque se haya cambiado de
 * pestaña. Hasta la revisión adversaria de H28 (D7) sólo lo era el paso a
 * paso: el final de un «Llévame» se perdía al cambiar de pestaña.
 *
 * Y el `reason` de PLAN_PROGRESS (D7): un paso que la página no pudo ejecutar
 * y el service worker sigue por URL; se decía sólo «paso N/M» en el estado y el
 * motivo no llegaba ni al Registro (§8.14).
 */
function onRuntimeMessage(msg, sender) {
  if (msg?.type === MSG.NOTE_CLICKED) {
    if (sender?.tab?.id != null && sender.tab.id !== state.tabId) return
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
    if (sender?.tab?.id != null && sender.tab.id !== state.tabId) return
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

  const deOtroRecorrido = msg?.tabId != null && msg.tabId !== state.tabId && msg.tabId !== state.navRun?.tabId && msg.tabId !== state.saltoTabId
  if (msg?.type === MSG.PLAN_PROGRESS) {
    if (deOtroRecorrido) return
    setStatus('busy', `paso ${msg.index + 1}/${msg.total}`)
    if (msg.reason) log.warn('Asistida bloqueada', 'paso ' + (msg.index + 1) + ': ' + failReason({ error: msg.reason }, 'sin motivo') + ' · sigo por URL')
  } else if (msg?.type === MSG.PLAN_FINISHED) {
    if (deOtroRecorrido) return
    if (msg.tabId === state.saltoTabId) state.saltoTabId = null
    setStatus('ok', 'conectado')
    // La tarjeta del recorrido vuelve en sí (si se paró desde ella, ya lo hizo
    // el botón y esto no repite el registro); con un error o sin permiso, con
    // sus botones de vuelta (D7), porque el aviso dice «vuelve a intentarlo».
    const parada = !!state.navRun && !!msg.result?.cancelled
    finishNavRun({ reabrir: !!(msg.result?.error || msg.result?.needsPermission) })
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
function showSetupScreen({ confirmar = false } = {}) {
  state.mcpWait?.abort()
  const site = state.site
  // Desde «Cambiar las claves» el permiso para escribir en opencode se vuelve a
  // pedir aunque ya se diera (H18): reescribir las claves reinicia las
  // conexiones de ese opencode para TODAS sus ventanas, que este panel no ve.
  state.setupConfirmar = !!confirmar
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
  // El consejo del MCP caído es de quien lo pinta (`showMcpSetup`): abierta
  // desde Ajustes, la pantalla no arrastra el de una vez anterior.
  $('setup-mcp-hint').textContent = ''
  setupHintPintado = null
  $('setup-mcp-hint').classList.add('hidden')
  $('setup-manual').classList.add('hidden')
  $('setup-main').classList.remove('hidden')
  showScreen('screen-setup')
  paintSetupConsent().catch(() => {})
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
  // El contexto es por ámbito (H21): el que va al prompt ahora, con su clave
  // (la del espacio o el proyecto, o «*» si es el de todo el sitio), y cuántos
  // más tiene guardados este host. Claves y cuentas, nunca el texto.
  const otrosAmbitos = scopeKeys(state.contexts).filter((k) => k !== state.contextScope).length
  add(
    'contexto',
    (state.contextMd ? `${state.contextScope || '*'}: ${state.contextMd.length} caracteres` : '(sin contexto)') +
      (otrosAmbitos ? ` · otros: ${otrosAmbitos}` : '')
  )
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

  const tabId = state.tabId
  const host = state.site?.host
  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    // Con la pestaña cambiada mientras se comprobaba, tampoco (revisión
    // adversaria de H28, D5): se dice, y el botón vuelve a valer en la pestaña.
    if (state.tabId !== tabId) {
      status.textContent = 'Has cambiado de pestaña: vuelve a ella y pulsa otra vez.'
      return
    }
    // Con el script roto no es el permiso (H28, revisión adversaria de H27, D2).
    const roto = sinAccesoMotivo(state.contentProblem, { tabId, host })
    status.textContent = roto
      ? `No puedo leer la barra lateral (${roto}). Recarga la pestaña.`
      : 'Necesito permiso sobre este dominio para leer su barra lateral.'
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

/**
 * La línea de «Este sitio» en Ajustes: host, cuántas entradas indexadas y si hay
 * contexto. En su propia función porque la escriben dos: abrir Ajustes y
 * «Olvidar el mapa», que cambia las dos cosas con la pantalla abierta y la
 * dejaba diciendo lo de antes (revisión adversaria de H21, B11).
 */
function paintSettingsSiteInfo() {
  $('settings-site-info').textContent = state.site
    ? `${state.site.host} · ${state.index ? indexSize(state.index) + ' entradas indexadas' : 'sin índice'} · ${state.contextMd ? 'con contexto' : 'sin contexto'}`
    : 'sin sitio'
}

/**
 * Qué espacio elegiría «Automático» y por qué, para la primera opción del
 * selector de Ajustes (H22): «hoy DCPIAS, por el contexto». El `via` de
 * `linkedSpacesFor` en palabras; sin espacio, «todo el sitio» o «ninguno». Pura.
 */
function linkedChoiceText(r) {
  if (!r?.key) return 'ninguno'
  if (r.key === '*') return 'todo el sitio'
  const espacio = r.key.slice('space:'.length)
  if (r.via === 'contexto') return `${espacio}, por el contexto`
  if (r.via === 'historial') return `${espacio}, por el historial`
  return `${espacio}, el único con contexto`
}

/**
 * Lo que dice el selector debajo: qué contexto del Confluence enlazado viaja
 * AHORA desde este proyecto, y si lo elegido a mano todavía no tiene contexto.
 * Nunca el texto: sólo de qué ámbito es. Pura.
 */
function linkedHintText(enlazado, elegido) {
  const clave = enlazado?.contextScope || ''
  const falta =
    elegido && elegido !== '*' && clave !== 'space:' + elegido ? ` «${elegido}» todavía no tiene contexto.` : ''
  if (!clave) return 'No viaja ningún contexto del Confluence enlazado.' + falta
  const de = clave === '*' ? 'de todo el sitio' : `del espacio «${clave.slice('space:'.length)}»`
  return `Viaja el contexto ${de} de ${enlazado.host}.` + falta
}

/**
 * El selector de Ajustes «El proyecto «KEY» se documenta en el espacio…» (H22):
 * la elección manual que manda sobre las reglas de `linkedSpacesFor`. Sólo en un
 * Jira con Confluence enlazado y con un proyecto delante. Las opciones son
 * «Automático» —que dice qué elegiría hoy y por qué—, «Todo el sitio» y cada
 * espacio del enlazado con contexto propio, todas con `createElement`; y si lo
 * elegido ya no tiene contexto, se enseña igual para que no parezca otra cosa.
 * Sin leer nada: todo sale de lo que el panel tiene en memoria.
 */
function paintLinkedSpaceSetting() {
  const campo = $('set-linked-space-field')
  const enlazado = state.linkedContext
  const proyecto = state.site?.product === 'jira' ? validProjectKey(state.site.projectKey) : ''
  campo.classList.toggle('hidden', !enlazado || !proyecto)
  if (!enlazado || !proyecto) return
  $('set-linked-space-label').textContent = `El proyecto «${proyecto}» se documenta en el espacio`
  const elegido = Object.hasOwn(state.linkedSpaces, proyecto) ? state.linkedSpaces[proyecto] : ''
  const auto = linkedSpacesFor(enlazado.ctxs, linkedSignals(enlazado, proyecto))
  const espacios = scopeKeys(enlazado.ctxs)
    .filter((k) => k.startsWith('space:'))
    .map((k) => k.slice('space:'.length))
  const select = $('set-linked-space')
  select.dataset.proyecto = proyecto
  select.textContent = ''
  const opcion = (valor, texto) => {
    const o = document.createElement('option')
    o.value = valor
    o.textContent = texto
    o.selected = valor === elegido
    select.appendChild(o)
  }
  opcion('', `Automático (hoy ${linkedChoiceText(auto)})`)
  opcion('*', 'Todo el sitio')
  for (const espacio of espacios) opcion(espacio, espacio)
  if (elegido && elegido !== '*' && !espacios.includes(elegido)) opcion(elegido, `${elegido} (sin contexto)`)
  $('set-linked-space-hint').textContent = linkedHintText(enlazado, elegido)
}

/**
 * Al cambiar el selector: el mapa entero del sitio (proyecto → espacio) se
 * escribe con la entrada nueva —`withLinkedSpace`, que lo normaliza y quita la
 * entrada con «Automático»—, y sólo si el panel sigue en ese host entra en el
 * estado y se vuelve a elegir qué contexto viaja (§8.22). Se registra y se dice.
 * El proyecto es el que el selector PINTÓ (`dataset.proyecto`), no el de
 * `state.site`: con Ajustes abierto y otra pestaña de otro proyecto, guardaba la
 * elección bajo el proyecto equivocado (revisión adversaria de H22, G02). Y la
 * base es el mapa RELEÍDO del almacén justo antes de escribir, no el de memoria,
 * que otro panel pudo cambiar (G11); host y proyecto se comprueban tras cada
 * `await`.
 */
async function onLinkedSpaceChange(ev) {
  const host = state.site?.host || ''
  const proyecto = ev.target.dataset.proyecto || ''
  const valor = ev.target.value
  if (state.site?.product !== 'jira' || validProjectKey(state.site?.projectKey) !== proyecto) {
    paintLinkedSpaceSetting()
    return
  }
  if (!host || !proyecto || !state.linkedContext) return
  const guardado = normalizeLinkedSpaces((await getSite(host))?.linkedSpaces)
  if ((state.site?.host ?? state.lastHost) !== host || validProjectKey(state.site?.projectKey) !== proyecto) return
  const mapa = withLinkedSpace(guardado, proyecto, valor)
  await saveSite(host, { linkedSpaces: mapa })
  if ((state.site?.host ?? state.lastHost) !== host || validProjectKey(state.site?.projectKey) !== proyecto) return
  state.linkedSpaces = mapa
  applyLinkedScope()
  paintLinkedSpaceSetting()
  log.info('Espacio enlazado', `${host} · ${proyecto} → ${mapa[proyecto] || 'automático'}`)
  announce(`${proyecto}: ${$('set-linked-space-hint').textContent}`)
}

async function showSettingsScreen() {
  $('set-nav-guided').checked = state.settings.navMode !== 'quick'
  $('set-nav-quick').checked = state.settings.navMode === 'quick'
  $('set-motion').checked = state.settings.reduceMotion
  $('set-hl-marker').checked = state.settings.highlightStyle === 'marker'
  $('set-hl-spotlight').checked = state.settings.highlightStyle !== 'marker'
  $('set-color-ambar').checked = state.settings.highlightColor === 'ambar'
  $('set-color-azul').checked = state.settings.highlightColor !== 'ambar'
  $('set-delay').value = state.settings.stepDelayMs
  $('delay-value').textContent = state.settings.stepDelayMs
  $('set-rest-tools').checked = state.settings.restTools
  $('set-today').checked = state.settings.todaySuggestions
  paintTodaySetting()
  paintSettingsModelInfo()
  $('set-url').value = state.settings.serverUrl
  $('set-pass').value = state.settings.password
  $('settings-status').textContent = ''
  // La confirmación de «Quitar las claves» es de la vez que se pidió (H19): la
  // lista era lo que opencode tenía entonces, y reabrir Ajustes no la trae.
  hideRemoveKeysConfirm()
  paintSettingsSiteInfo()
  // Desde un Jira con Confluence enlazado, qué espacio documenta este proyecto
  // (H22): también de lo que el panel tiene en memoria.
  paintLinkedSpaceSetting()
  // Los mapas y contextos de este sitio, ámbito a ámbito (H21): de lo que el
  // panel tiene en memoria, sin leer nada, así que va antes de abrir.
  paintScopeList()
  showScreen('screen-settings')
  // La pantalla se abre YA y la lista se rellena detrás: son dos lecturas del
  // almacén y abrir Ajustes no tiene por qué esperarlas.
  await paintPrivacy()
}

/** Cuántos de los OTROS sitios con datos se nombran antes de contar el resto. */
const OTHER_HOSTS_SHOWN = 4

/**
 * Las claves de unos ámbitos, para decir en «Qué guarda Faro de mí» DE QUÉ son
 * los contextos guardados (H21): «SIMPL, DCPIAS y 2 más». Cada una RECONSTRUIDA
 * por su validadora (`validSpaceKey`, `validProjectKey`) y no copiada; «*» es
 * «todo el sitio»; lo que no valide no se nombra. Como mucho
 * `OTHER_HOSTS_SHOWN`, igual que los otros hosts. Nunca el texto. Pura.
 */
function nombresDeAmbitos(claves) {
  const nombres = []
  for (const clave of claves) {
    if (clave === '*') nombres.push('todo el sitio')
    else if (clave.startsWith('space:')) {
      const k = validSpaceKey(clave.slice('space:'.length))
      if (k) nombres.push(k)
    } else if (clave.startsWith('project:')) {
      const k = validProjectKey(clave.slice('project:'.length))
      if (k) nombres.push(k)
    }
  }
  const nombra = nombres.slice(0, OTHER_HOSTS_SHOWN)
  const resto = nombres.length - nombra.length
  return nombra.join(', ') + (resto ? ` y ${resto} más` : '')
}

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
  // De cuántos espacios son esas páginas (H21): el mapa es por espacio. En Jira
  // no hay espacios, y «0 páginas en 0 espacios» delante de las incidencias no
  // decía nada (revisión adversaria de H21, B14).
  const espacios = countPages(bundle.index).spaces
  const enJira = state.site?.product === 'jira'
  add(
    'índice de navegación',
    !bundle.index ? '(nada)' : enJira ? `${incidencias} incidencias` : `${paginas} páginas en ${espacios} espacios · ${incidencias} incidencias`
  )
  // El contexto es por ámbito (H21): cuántos hay y DE QUÉ son. Las claves se
  // enseñan —igual que la del proyecto del perfil, §4.11: dicen de qué es lo
  // guardado, no qué guarda— reconstruidas por las validadoras y nunca el texto.
  // Lo guardado sale CRUDO del paquete y se normaliza aquí; un texto de antes de
  // H21 que todavía no se haya reparado cuenta como un ámbito, el que se decida.
  const contextos = normalizeContexts(bundle.contextRaw, {
    legacyScope: legacyScopeOf(bundle, bundle.site),
    legacyIndexedAt: bundle.site?.indexedAt,
  })
  const ambitos = scopeKeys(contextos).length
  const claves = nombresDeAmbitos(scopeKeys(contextos))
  add('contexto del sitio', ambitos ? `${ambitos} ámbitos con contexto (${claves})` : '(nada)')

  const resumenes = memory.normalizeMemory(bundle.memoryRaw).entries.length
  // Apagar la memoria no borra lo que ya hay: la pregunta de esta pantalla es
  // «qué GUARDA Faro», y contestar «(desactivada)» con doce resúmenes en disco era
  // contestar a otra cosa (revisión adversaria de H13). Primero lo que hay; que
  // está apagada se dice detrás, y sin nada guardado es «(nada)», esté como esté.
  add(
    'memoria entre sesiones',
    resumenes ? `${resumenes} resúmenes${state.settings.crossSessionMemory ? '' : ' · desactivada'}` : '(nada)'
  )

  // Los perfiles se guardan POR PROYECTO dentro del host (H22), así que se dice
  // cuántos y DE CUÁLES —las claves, reconstruidas por `validProjectKey` en
  // `nombresDeAmbitos`: dicen de qué es lo guardado, no qué guarda— y, del
  // proyecto que hay delante, de cuántas incidencias es su muestra y cuándo se
  // contó. El suelto de antes de H22 cuenta como uno, el de su proyecto.
  const perfiles = normalizeProfiles(bundle.extras?.profile)
  const proyectos = Object.keys(perfiles.byProject).length
  const clavesProyectos = nombresDeAmbitos(Object.keys(perfiles.byProject).map((k) => 'project:' + k))
  const proyecto = validProjectKey(state.site?.projectKey)
  const delActual = profileForProject(perfiles, proyecto)
  add(
    'perfiles de proyectos',
    proyectos
      ? `${proyectos} proyectos con perfil (${clavesProyectos})` +
          (delActual ? ` · el de ${proyecto}: muestra de ${delActual.sampled} · ${hace(delActual.at)}` : '')
      : '(nada)'
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

  // Y lo que Faro guarda de la PERSONA, no del sitio (H16, §8.25): el modelo que
  // eligió y lo que recuerda de qué modelos contestan. Van al final, junto al
  // espacio usado, porque son globales: «Olvidar este sitio» no se los lleva, y
  // los veredictos tienen su propio botón debajo. El modelo se enseña como
  // «proveedor/modelo» y reconstruido por `parseModelKey`: es el id que opencode
  // da a un modelo, no contenido de ningún sitio, igual que la clave del proyecto
  // del perfil. Los veredictos, sólo su cuenta, y leídos del ALMACÉN como todo lo
  // de esta lista, con el servidor y la lista de modelos de ahora: lo apuntado
  // con otro opencode ya no vale y se escribe encima en el primer veredicto.
  const elegido = parseModelKey(modelKey(state.settings.model))
  add('modelo elegido', elegido ? modelKey(elegido) : '(ninguno)')
  try {
    const guardados = await getModelChecks(modelChecksCtx())
    if (state.site?.host !== host) return
    const veredictos = Object.keys(guardados?.checks || {}).length
    add('veredictos de modelos', veredictos ? `${veredictos} veredictos · todos los sitios` : '(nada)')
  } catch (err) {
    add('veredictos de modelos', 'no se pudo leer: ' + err.message)
  }

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
  // Y los de la pantalla de claves (H18): escribir en opencode —guardar las
  // claves, «Ya lo he pegado»— abortaría el turno. El de guardar lo repinta
  // `paintSetupSave`, que además lo deja apagado sin el permiso para escribir.
  for (const b of $('screen-setup').querySelectorAll('.' + NEEDS_IDLE)) b.disabled = on
  paintSetupSave()
  // Y el «Quitar» de Ajustes (H19): quitar las claves también es un PATCH que
  // aborta el turno. Al volver lo repinta `paintRemoveKeysGo`, que además lo
  // deja apagado cuando no hay nada que quitar o ya se está quitando.
  for (const b of $('screen-settings').querySelectorAll('.' + NEEDS_IDLE)) b.disabled = on
  paintRemoveKeysGo()
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
    // Un botón que falta o está oculto NO se pulsa (H17): la flecha de «Elige el
    // modelo» nace oculta en el primer uso, en la verificación de las claves y
    // en el indexado —de ahí no se sale sin elegir—, y `click()` sobre un botón
    // oculto lo pulsa igual. Escape es el atajo de un botón que se ve.
    const boton = $(btn)
    if (!boton || boton.hidden || boton.closest('.hidden')) return
    ev.preventDefault()
    boton.click()
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
    // A los ajustes de la PERSONA y nunca al registro del sitio (H16, §8.25):
    // el segundo sitio no vuelve a preguntar, y cambiar aquí vale para todos.
    // No viaja a la página: `pushSettings` del service worker manda sólo lo
    // suyo, con claves exactas pinadas.
    state.settings = await saveSettings({ model: parsed })
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

  // --- elige el modelo (H17)
  $('btn-model-use').addEventListener('click', () => useModel().catch(console.error))
  $('btn-model-check').addEventListener('click', () => runModelProbe().catch(console.error))
  $('btn-model-retry').addEventListener('click', () => bootForSite().catch(console.error))
  // La flecha sólo se ve en los modos de los que se puede salir sin elegir
  // (Ajustes, el error de un turno): cerrar es volver con el modelo de antes.
  $('btn-model-close').addEventListener('click', () => {
    state.modelScreen = null
    hideScreens()
  })
  $('model-filter').addEventListener('input', () => paintModelList($('model-filter').value))
  // Un solo oyente para las dos listas (la de los disponibles y la plegada):
  // lo que el usuario marca es lo que se usa o se comprueba.
  for (const lista of [$('model-list'), $('model-unavailable-list')]) {
    lista.addEventListener('change', (ev) => {
      if (ev.target?.name !== 'model-choice' || !state.modelScreen) return
      state.modelScreen.elegido = ev.target.value
      paintModelButtons()
    })
  }
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
  $('setup-consent-ok').addEventListener('change', paintSetupSave)
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
  $('btn-setup-reload').addEventListener('click', () => reloadPastedConfig().catch(console.error))
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
  // El espacio que documenta este proyecto (H22) se guarda al cambiarlo, no al
  // cerrar Ajustes: es del registro del sitio, no de los ajustes de la persona.
  $('set-linked-space').addEventListener('change', (ev) =>
    onLinkedSpaceChange(ev).catch((err) => ($('settings-status').textContent = 'No he podido guardar el espacio: ' + err.message))
  )
  $('btn-settings-close').addEventListener('click', async () => {
    const antes = state.settings
    state.settings = await saveSettings({
      navMode: $('set-nav-quick').checked ? 'quick' : 'guided',
      reduceMotion: $('set-motion').checked,
      highlightStyle: $('set-hl-marker').checked ? 'marker' : 'spotlight',
      highlightColor: $('set-color-ambar').checked ? 'ambar' : 'azul',
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
    // animaciones» y, desde H23, el color del subrayado) se aplica en caliente:
    // la UI del panel aquí mismo, y la página por el service worker, que ve el
    // cambio de `faro:settings` con `chrome.storage.onChanged` y le empuja los
    // ajustes. Hasta H6, cerrar Ajustes a mitad de respuesta mataba el turno
    // (pendiente de §4.4).
    const clientChanged = state.settings.serverUrl !== antes.serverUrl || state.settings.password !== antes.password
    // Los veredictos de modelos son de UN opencode (H16): con otro servidor no
    // dicen nada, y el arranque de abajo relee los que tocan con su lista.
    if (clientChanged) state.modelChecks = null
    // Y el modelo de la configuración de opencode (H17), por lo mismo: es de
    // aquel servidor; `undefined` hace que se vuelva a preguntar.
    if (clientChanged) state.configModel = undefined
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
  $('btn-edit-keys').addEventListener('click', () => showSetupScreen({ confirmar: true }))
  // H19: «Quitar las claves de este sitio» primero ENSEÑA qué se va a
  // deshabilitar (sólo lee) y sólo «Quitar» escribe.
  $('btn-remove-keys').addEventListener('click', () => prepareRemoveKeys().catch(console.error))
  $('btn-remove-keys-go').addEventListener('click', () => removeKeys().catch(console.error))
  $('btn-remove-keys-cancel').addEventListener('click', hideRemoveKeysConfirm)
  // La casilla de las entradas ajenas decide si «Quitar» tiene algo que quitar
  // cuando no hay ninguna de Faro (revisión adversaria de H19).
  $('remove-keys-foreign').addEventListener('change', paintRemoveKeysGo)
  // Desde Ajustes, con la flecha a la vista: aquí se viene a mirar y quizá a
  // cambiar, y volver sin elegir deja el modelo como estaba.
  $('btn-change-model').addEventListener('click', () => showModelScreen({ modo: 'ajustes', marcado: state.model }).catch(console.error))
  $('btn-tree-debug').addEventListener('click', () => treeDebug().catch(console.error))
  // Lo que Faro recuerda de qué modelos contestan y cuáles no (H16): se ve en
  // «Qué guarda Faro de mí» y se borra aquí (§8.20). Es de la persona y no de un
  // sitio, así que «Olvidar este sitio» no lo toca y necesita su propio botón.
  // El modelo ELEGIDO se queda: olvidar lo aprendido no es cambiar de elección.
  $('btn-forget-model-checks').addEventListener('click', async () => {
    try {
      await clearModelChecks()
    } catch (err) {
      $('settings-status').textContent = 'No he podido olvidar los veredictos: ' + (err?.message || err)
      return
    }
    state.modelChecks = null
    log.info('Veredictos de modelos olvidados', 'el modelo elegido se conserva')
    // A2: el efecto —una fila que pasa a «(nada)»— no se oye por sí solo.
    announce('Olvidado lo que Faro recordaba de qué modelos contestan.')
    paintModelVerdicts()
    await paintPrivacy()
  })
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
    // Los contextos de TODOS los ámbitos del host se van con el sitio (la clave
    // es una por host), y con ellos los dos derivados.
    state.contexts = emptyContexts()
    state.contextMd = ''
    state.contextScope = ''
    state.contextLegacy = null
    state.memory = { entries: [] }
    state.sessionID = null
    state.sources = emptySources()
    state.recentJql = []
    state.favouriteFilters = null
    // Los perfiles de todos sus proyectos se van con la clave del host, y con
    // ellos la tregua del recuento: si no, el proyecto que ya se había pedido no
    // se volvería a contar hasta recargar el panel.
    state.profiles = emptyProfiles()
    state.profileAsked = ''
    // Y lo elegido en Ajustes para el Confluence enlazado, que vivía en el
    // registro del sitio que se acaba de olvidar.
    state.linkedSpaces = {}
    // Lo precargado: `bootForSite` repinta el chat y se lleva la tarjeta con la
    // lista, así que dejarlo armado lo metería en la primera pregunta tras
    // olvidar, con unos resultados que ya no se ven (revisión adversaria de H12;
    // el mismo motivo que en `newSession`).
    state.pendingPreload = null
    // Y «Dibujar el flujo» (H24), por lo mismo, con los diagramas ya apuntados
    // (revisión adversaria de H24, D04).
    state.pendingDiagram = null
    diagramasRegistrados.clear()
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

/**
 * ¿Qué impide ahora mismo que Faro reconfigure opencode? El motivo, o '' con el
 * panel quieto (H18, la guarda común «opencode se está reconfigurando»,
 * docs/PLAN2.md §3.2 y §4).
 *
 * POR QUÉ: cada `PATCH /global/config` —escribir el MCP, o el `{}` de «Ya lo he
 * pegado»— hace que opencode deseche TODAS sus instancias (medido en 1.2.25,
 * anexo 2-A): aborta los turnos en vuelo de ese proceso, cierra el stream de
 * eventos y rearranca todos los MCP. Un turno del chat, un indexado, la sonda
 * de «Comprobar» o la comprobación de las claves a medias se cortarían sin
 * decir por qué. Así que sólo con el panel quieto; lo que no ve —otras ventanas
 * de Chrome, la TUI— lo cubre el consentimiento, que en «Cambiar las claves» se
 * pide siempre.
 */
function reconfiguring() {
  if (state.streaming) return 'Espera a que termine la respuesta: escribir en opencode la cortaría.'
  if (state.indexingAbort) return 'Espera a que termine el indexado: escribir en opencode lo cortaría.'
  if (state.modelProbeAbort) return 'Espera a que termine la comprobación del modelo: escribir en opencode la cortaría.'
  if (state.setupAbort) return 'Espera a que termine la comprobación de las claves: escribir en opencode la cortaría.'
  return ''
}

/**
 * ¿Hay permiso para escribir en la configuración de opencode? La casilla del
 * bloque de consentimiento marcada, o el permiso ya dado (`configWriteConsent`)
 * cuando la pantalla NO se abrió desde «Cambiar las claves», que pregunta
 * siempre (H18).
 */
function consentimientoListo() {
  if ($('setup-consent-ok').checked) return true
  return !!state.settings.configWriteConsent && !state.setupConfirmar
}

/**
 * El botón de guardar las claves: apagado sin permiso para escribir y con un
 * turno en vuelo (lleva `NEEDS_IDLE`, y `setStreaming` lo repinta por aquí para
 * no encenderlo sin el permiso). Lo demás que impide escribir (un indexado, la
 * sonda) lo dice `reconfiguring()` al pulsarlo.
 */
function paintSetupSave() {
  $('btn-setup-save').disabled = escribiendoClaves || state.streaming || !consentimientoListo()
}

/**
 * El bloque de consentimiento de la pantalla de claves (H18): a la vista la
 * primera vez y SIEMPRE desde «Cambiar las claves», con la carpeta REAL donde
 * opencode tiene su configuración (`GET /path`). El panel no puede listar esa
 * carpeta —opencode no tiene ningún endpoint para eso—, así que el nombre del
 * fichero lo dice el texto fijo del HTML («el primero que exista de
 * opencode.jsonc, opencode.json y config.json»). Cliente capturado antes del
 * await (§8.22): la ruta es de ESE servidor.
 */
async function paintSetupConsent() {
  const pedir = !state.settings.configWriteConsent || state.setupConfirmar
  $('setup-consent').classList.toggle('hidden', !pedir)
  $('setup-consent-ok').checked = false
  $('setup-consent-path').textContent = 'la carpeta de configuración de opencode'
  paintSetupSave()
  if (!pedir) return
  const cliente = state.client
  if (!cliente) return
  const rutas = await cliente.paths().catch(() => null)
  if (state.client !== cliente || !rutas?.config) return
  $('setup-consent-path').textContent = rutas.config
}

/** Mientras `saveKeys` escribe y espera: un segundo clic no escribe dos veces. */
let escribiendoClaves = false

/** Lo que dice la pantalla de claves mientras escribe y espera (H18; el espejo dice lo mismo). */
const ESTADO_CLAVES = Object.freeze({
  escribiendo: 'Escribiendo en opencode…',
  recargando: 'Esperando a que opencode recargue…',
  arrancando: 'Arrancando el MCP…',
})

/**
 * La nota de la versión (H18): la recarga en caliente de la configuración sólo
 * está verificada en `OPENCODE_VERIFIED_VERSION`. Con otra versión se dice en el
 * texto de espera en vez de prometer que el MCP aparecerá; sin versión conocida,
 * nada (no se afirma lo que no se ve).
 */
function notaVersion() {
  const v = state.opencodeVersion
  if (!v || v === OPENCODE_VERIFIED_VERSION) return ''
  return ` Esta versión de opencode (${v}) no es la probada (${OPENCODE_VERIFIED_VERSION}): si el MCP no aparece, reinícialo.`
}

/**
 * Guardar las claves: ESCRIBIR el MCP en la configuración de opencode y esperar
 * a que opencode lo cargue (H18, docs/PLAN2.md §3.2). Verificar los tokens es de
 * `finishSetup`, que va detrás y no escribe nada: así volver a la pantalla del
 * modelo tras un fallo por modelo repite SÓLO la verificación, sin otro PATCH
 * que abortaría turnos y rearrancaría todos los MCP (escribir ≠ verificar).
 *
 * POR QUÉ: hasta H18 esto llamaba a `POST /mcp`, que en opencode 1.2.25 arranca
 * el MCP sólo EN MEMORIA —`GET /mcp` no lo ve, no se escribe nada y muere con la
 * primera recarga—, así que siempre acababa en el paso manual: pegar un bloque
 * con los tokens en un fichero y reiniciar opencode, que es justo donde se
 * atascaron los compañeros. `PATCH /global/config` escribe el fichero Y recarga
 * en caliente (anexo 2-A); el paso manual se queda como RESPALDO.
 *
 * En orden: permiso (la primera vez, y siempre desde «Cambiar las claves»);
 * sitio, cliente y host capturados antes del primer await (§8.22); la guarda
 * común con el panel quieto; lo que el MCP tenía pendiente se invalida ANTES de
 * escribir —si no, P5 (H14) podría abrir la pantalla de claves con un resultado
 * viejo justo después—; escribir; esperar a que la entrada APAREZCA; esperar a
 * que conecte con el consejo de H15; un reintento con la ruta absoluta de uvx
 * sólo si la entrada es NUEVA y cayó al instante; releer la configuración para
 * comprobar que la que opencode carga es la escrita; y `finishSetup`.
 */
async function saveKeys() {
  const status = $('setup-status')
  // Un desenlace TERMINAL se escribe y se anuncia (A2): el usuario acaba de
  // pulsar un botón y el resultado llega segundos después en un texto que un
  // lector de pantalla no leería solo. Los estados de paso («Escribiendo…»,
  // «Arrancando el MCP…») van a secas: anunciar cada vuelta sería ruido
  // (revisión adversaria de H18).
  const decir = (texto) => {
    status.textContent = texto
    announce(texto)
  }

  if (!state.site?.host) {
    decir('He perdido de vista el sitio. Abre una página de Jira o Confluence y vuelve a intentarlo.')
    return
  }
  if (escribiendoClaves) return

  // El sitio, el host y el cliente con los que se escribe, ANTES del primer
  // await (§8.22): la espera dura segundos y la pestaña puede irse a otro sitio.
  const sitio = state.site
  const host = sitio.host
  const cliente = state.client

  // Cada producto con lo suyo: dirección, correo (sólo en Cloud) y token. Lo
  // que falte lo dice `buildMcpConfig` con el nombre del producto, y se dice
  // ANTES de tocar nada de opencode ni del estado.
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
  try {
    buildMcpConfig({ jira, confluence, dataCenter })
  } catch (err) {
    decir('No he podido configurarlo: ' + (err?.message || err))
    return
  }

  // (1) El permiso para escribir en la configuración de opencode.
  if (!consentimientoListo()) {
    decir('Marca la casilla de arriba: Faro necesita tu permiso para escribir en la configuración de opencode.')
    return
  }

  escribiendoClaves = true
  paintSetupSave()
  status.textContent = 'Preparando la configuración…'
  try {
    if (!state.settings.configWriteConsent) state.settings = await saveSettings({ configWriteConsent: true })
    const saved = await getSite(host).catch(() => null)
    // La carpeta donde opencode tiene su configuración, para decir DÓNDE se ha
    // escrito y para la ruta absoluta de uvx del reintento.
    const rutas = await cliente.paths().catch(() => null)
    // Lo que opencode tiene AHORA, para decidir bajo qué nombre escribir y qué
    // conservar (`chooseWriteTarget`, dentro de `configureMcp`). Lleva los tokens
    // de todos los MCP en claro: de aquí no sale nada más que esa decisión.
    const configAntes = await cliente.config().catch(() => null)
    if (state.client !== cliente || (state.site?.host ?? state.lastHost) !== host) return

    // (2) La guarda común, justo antes de escribir: entre las lecturas de arriba
    // ha podido empezar un turno.
    const ocupado = reconfiguring()
    if (ocupado) {
      decir(ocupado)
      return
    }
    // Lo que el MCP de este panel tenía en marcha deja de valer: la comprobación
    // del arranque y su resultado sin enseñar hablan del MCP de ANTES, y una
    // espera vieja vería el nuevo por su cuenta. Y con la comprobación se suelta
    // la cabecera que decía «comprobando MCP…»: su resultado ya no pintará nada.
    state.mcpCheck = null
    soltarComprobandoMcp()
    state.mcpPending = null
    state.mcpWait?.abort()
    state.mcpConnected = false
    // El testigo de ESTA escritura: cambiar a otro sitio (`refreshTab`), volver a
    // abrir la pantalla o la flecha del paso manual la abortan, como a cualquier
    // espera del MCP.
    const espera = new AbortController()
    state.mcpWait = espera
    const sigue = () => !espera.signal.aborted && state.client === cliente && (state.site?.host ?? state.lastHost) === host
    const ruta = rutas?.config || 'la carpeta de configuración de opencode'

    status.textContent = ESTADO_CLAVES.escribiendo
    const t0 = performance.now()
    let result
    try {
      result = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes })
    } catch (err) {
      decir('No he podido configurarlo: ' + (err?.message || err))
      return
    }
    const msPatch = Math.round(performance.now() - t0)

    // Los hosts de cada producto salen de la configuración que se acaba de
    // construir —ya normalizada—, no de lo que se escribió en el campo. Con el
    // sitio con el que se pidieron: la espera y la verificación duran y la
    // pestaña activa entonces puede ser otra (C5).
    const env = result.block?.environment || {}
    state.pendingMcp = {
      ...result,
      site: sitio,
      products: {
        jira: jira ? hostOf(env.JIRA_URL) : '',
        confluence: confluence ? hostOf(env.CONFLUENCE_URL) : '',
      },
    }

    // (6) No se ha podido escribir: el respaldo manual, con el porqué.
    if (!result.ok) {
      log.warn('MCP sin escribir', `${result.status || 0} · ${result.kind || 'sin tipo'}`)
      if (!sigue()) return
      await showManualStep(result, { motivo: 'sin-escribir', kind: result.kind })
      return
    }

    // (4) Que APAREZCA en `GET /mcp`. No un sleep: la recarga es asíncrona y un
    // GET inmediato puede contestarlo todavía la instancia vieja.
    status.textContent = ESTADO_CLAVES.recargando + notaVersion()
    const aparecida = await esperarEntrada(cliente, host, result.name, espera.signal)
    if (!sigue()) {
      log.info('MCP escrito en opencode', `${result.name} · ${ruta} · PATCH ${msPatch} ms · espera cancelada`)
      return
    }
    if (!aparecida) {
      log.warn('MCP escrito en opencode', `${result.name} · ${ruta} · PATCH ${msPatch} ms · no aparece en ${MCP_RELOAD_LIMITS.appearMs / 1000} s`)
      await showManualStep(result, { motivo: 'no-aparece', ruta })
      return
    }
    log.ok('MCP escrito en opencode', `${result.name} · ${ruta} · PATCH ${msPatch} ms · aparece en ${aparecida.ms} ms`)

    // (4) Que CONECTE, con el consejo de H15 si cae. Vigila la caída al instante
    // una entrada que Faro acaba de CREAR, o una reutilizada cuyo `command` es el
    // estándar de Faro (`result.standard`, revisión adversaria de H18: la de un
    // primer intento que se quedó a medias se reutiliza, y sin esto el segundo
    // «Conectar y comprobar» ya no reintentaba). Con un `command` que puso el
    // usuario (docker, una ruta propia, una entrada ajena) no se toca nada.
    const creada = result.reuse === false || result.standard === true
    status.textContent = ESTADO_CLAVES.arrancando
    let arranque = await arrancarMcp({ cliente, host, name: result.name, espera, primero: aparecida.status, vigilarCaida: creada })
    if (!sigue()) return

    // (5) Cayó con «Connection closed» en menos de `fastFailMs`: casi siempre es
    // que el opencode en marcha no tiene uvx en su PATH (se arrancó antes de
    // instalar uv). UN reintento con la ruta absoluta del instalador oficial, y
    // si tampoco, se devuelve el `command` estándar y sale el consejo de H15.
    if (arranque.caida && creada) {
      const conRuta = uvxAbsoluteCommand(rutas)
      if (conRuta) {
        // La vuelta atrás NO depende del sitio ni de la espera: la entrada es del
        // SERVIDOR, y si el usuario se va a otro sitio o vuelve a las claves a
        // mitad, la ruta absoluta se quedaría escrita para siempre —y el
        // siguiente «Conectar y comprobar» la conservaría al reutilizar la
        // entrada— (revisión adversaria de H18). Por eso va en un `finally`, con
        // el cliente CAPTURADO: `request()` no depende del stream, así que vale
        // aunque `buildClient` haya creado otro. Entre `rutaEscrita = true` y el
        // `finally` no hay ningún `return`: lo que ya no sigue sólo se salta.
        let rutaEscrita = false
        try {
          status.textContent = 'opencode no encuentra uvx: pruebo con la ruta completa…'
          const reintento = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes, command: conRuta })
          if (reintento.ok) {
            rutaEscrita = true
            await new Promise((r) => setTimeout(r, MCP_RELOAD_LIMITS.pollMs))
            if (sigue()) {
              status.textContent = ESTADO_CLAVES.arrancando
              arranque = await arrancarMcp({ cliente, host, name: result.name, espera, primero: null, vigilarCaida: true })
            }
            if (arranque.status.connected) log.ok('MCP escrito en opencode', `${result.name} · arranca con la ruta completa de uvx`)
          }
        } finally {
          if (rutaEscrita && !arranque?.status?.connected) {
            // Vuelta atrás: el `command` estándar, que es el que vale en cuanto
            // opencode se arranque desde una terminal que ve uvx.
            const vuelta = await configureMcp(cliente, { host, jira, confluence, dataCenter, saved, config: configAntes })
            log.warn('MCP escrito en opencode', `${result.name} · tampoco con la ruta completa de uvx · command ${vuelta.ok ? 'devuelto a uvx' : 'sin devolver: ' + (vuelta.kind || vuelta.status)}`)
          }
        }
        if (!sigue()) return
      }
    }

    if (!arranque.status.connected) {
      // Sin conectar: el consejo de H15 se queda con su «Reintentar», que ahora
      // —sin espera viva— rearranca el panel si conecta, y el arranque adopta el
      // MCP con las claves sin comprobar (y lo dice).
      if (state.mcpWait === espera) state.mcpWait = null
      const como = arranque.status.present ? `sigue en «${arranque.status.status}»` : 'no aparece en opencode'
      decir(`Escrito en ${ruta}, pero el MCP «${result.name}» ${como}.`)
      paintSetupMcpHint(arranque.status, { host })
      return
    }
    paintSetupMcpHint(arranque.status, { host })

    // Releer lo que opencode CARGA: una configuración de proyecto en el
    // directorio donde se arrancó el servidor taparía la escrita (con
    // tools/arrancar-opencode.ps1 no pasa; arrancado a mano, sí puede).
    const configDespues = await cliente.config().catch(() => null)
    if (!sigue()) return
    const hosts = [host, state.pendingMcp.products.jira, state.pendingMcp.products.confluence]
    if (!entradaEfectiva(configDespues, hosts, result.name)) {
      if (state.mcpWait === espera) state.mcpWait = null
      log.warn('MCP escrito en opencode', `${result.name} · la configuración que opencode carga no es la escrita`)
      decir(
        `La configuración que opencode carga no es la que se ha escrito: hay una configuración de proyecto delante. ` +
          `Faro escribió en ${ruta}; arranca opencode desde otra carpeta (tools\\arrancar-opencode.ps1 usa una propia) y vuelve a intentarlo.`
      )
      return
    }

    // Escrito, cargado y conectado: ahora sí, a comprobar los tokens.
    if (state.mcpWait === espera) state.mcpWait = null
    await finishSetup()
  } finally {
    escribiendoClaves = false
    paintSetupSave()
  }
}

/**
 * Sondea `GET /mcp` cada `pollMs` hasta que aparezca la entrada `name` (tope
 * `appearMs`). Devuelve `{status, ms}` con el estado con el que apareció, o null
 * si no apareció o se canceló. Espera `pollMs` ANTES de la primera pregunta: un
 * GET justo después del PATCH puede contestarlo la instancia vieja, y en una
 * entrada reutilizada eso sería «ya está» con los tokens de antes.
 */
async function esperarEntrada(cliente, host, name, signal) {
  const t0 = performance.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, MCP_RELOAD_LIMITS.pollMs))
    if (signal.aborted) return null
    const lista = await cliente.listMcp().catch(() => ({}))
    if (signal.aborted) return null
    const s = mcpStatusFor(lista, host, name)
    const ms = Math.round(performance.now() - t0)
    if (s.present) return { status: s, ms }
    if (ms >= MCP_RELOAD_LIMITS.appearMs) return null
  }
}

/**
 * Espera a que el MCP recién aparecido conecte (`waitForMcpReady`, 90 s),
 * pintando en la pantalla de claves el estado real y el consejo de H15.
 *
 * Con `vigilarCaida`, si cae con «Connection closed» (`mcpFailureHint` →
 * `sin-arranque`) antes de `MCP_RELOAD_LIMITS.fastFailMs` desde que apareció,
 * corta la espera y devuelve `caida: true`: es el caso del reintento con la
 * ruta absoluta de uvx. `primero` es el estado con el que apareció, que ya
 * puede ser ése. Devuelve `{status, caida}`.
 */
async function arrancarMcp({ cliente, host, name, espera, primero, vigilarCaida }) {
  const desde = performance.now()
  const cayoYa = (s) => vigilarCaida && mcpFailureHint(s)?.kind === 'sin-arranque' && performance.now() - desde < MCP_RELOAD_LIMITS.fastFailMs
  if (primero?.connected) return { status: primero, caida: false }
  if (primero && cayoYa(primero)) return { status: primero, caida: true }
  const ronda = new AbortController()
  const cortar = () => ronda.abort()
  espera.signal.addEventListener('abort', cortar)
  let caida = false
  const status = await waitForMcpReady(cliente, host, {
    mcpName: name,
    intervalMs: MCP_RELOAD_LIMITS.pollMs,
    signal: ronda.signal,
    onTick: (s) => {
      if (cayoYa(s)) {
        caida = true
        ronda.abort()
        return
      }
      if (espera.signal.aborted) return
      $('setup-status').textContent = s.present && s.status ? `El MCP está en «${s.status}»…` : ESTADO_CLAVES.arrancando
      paintSetupMcpHint(s, { host, espera })
    },
  })
  espera.signal.removeEventListener('abort', cortar)
  return { status, caida }
}

/**
 * ¿La entrada que opencode CARGA es la escrita? Busca `name` entre las que
 * llevan alguno de estos dominios (`mcpEntriesForHost`, sin tokens) y exige que
 * esté habilitada. De la configuración no sale nada más.
 */
function entradaEfectiva(config, hosts, name) {
  for (const h of hosts) {
    if (!h) continue
    const entrada = mcpEntriesForHost(config, h).find((e) => e.name === name)
    if (entrada) return entrada.enabled !== false ? entrada : null
  }
  return null
}

/**
 * «Ya lo he pegado» (H18): que opencode relea su configuración global sin
 * reiniciar. Es el `PATCH /global/config` con el cuerpo `{}` FIJO
 * (`reloadGlobalConfig`, sin argumentos), verificado en 1.2.25: lo pegado a mano
 * aparece en ~200 ms. Es otro PATCH, así que pasa por la misma guarda común y
 * deja de fiarse de lo que el MCP tuviera pendiente; la espera del paso manual
 * sigue viva, que es la que lo verá conectado.
 */
async function reloadPastedConfig() {
  const boton = $('btn-setup-reload')
  const porQue = $('setup-manual-why')
  const cliente = state.client
  if (!cliente || boton.disabled) return
  const ocupado = reconfiguring()
  if (ocupado) {
    porQue.textContent = ocupado
    porQue.classList.remove('hidden')
    return
  }
  state.mcpCheck = null
  soltarComprobandoMcp()
  state.mcpPending = null
  state.mcpConnected = false
  boton.disabled = true
  const t0 = performance.now()
  const recarga = await cliente.reloadGlobalConfig().catch(() => ({ ok: false, status: 0, kind: 'red' }))
  const ms = Math.round(performance.now() - t0)
  boton.disabled = state.streaming
  if (recarga.ok) log.ok('Configuración recargada', `${ms} ms`)
  else log.warn('Configuración recargada', `${recarga.status || 0} · ${recarga.kind || 'sin tipo'} · ${ms} ms`)
  if (state.client !== cliente) return
  if (recarga.ok) {
    $('setup-waiting-text').textContent = 'opencode ha releído su configuración: esperando al MCP…'
    return
  }
  porQue.textContent = porQueNoSeEscribe({ status: recarga.status, kind: recarga.kind })
  porQue.classList.remove('hidden')
  announce(porQue.textContent)
}

/**
 * Por qué opencode no ha aceptado la escritura, en palabras (H18). Sólo el TIPO
 * del error (`kind`, el `name` del JSON de opencode) y su código: el cuerpo, que
 * con un fichero roto trae el fichero ENTERO con los tokens, no llega nunca aquí.
 */
function porQueNoSeEscribe({ status = 0, kind = '' } = {}) {
  if (kind === 'ConfigJsonError') return 'La configuración de opencode tiene un error de sintaxis: corrígelo, pega el bloque y pulsa «Ya lo he pegado».'
  if (kind === 'ConfigInvalidError') return 'La configuración de opencode tiene una clave que opencode no conoce: quítala, pega el bloque y pulsa «Ya lo he pegado».'
  if (kind === 'entrada') return 'Faro no ha podido montar una entrada válida con estos datos: pégala a mano y pulsa «Ya lo he pegado».'
  // La configuración que había que leer para decidir qué conservar no llegó
  // (revisión adversaria de H18): `configureMcp` no escribe a ciegas, porque
  // sin ella no sabe qué entrada ni qué producto se llevaría por delante.
  if (kind === 'config') return 'No he podido leer la configuración de opencode, y sin saber qué hay no escribo: reinténtalo, o pega el bloque a mano.'
  if (kind === 'red' || !status) return 'opencode no ha contestado: comprueba que sigue en marcha, pega el bloque y pulsa «Ya lo he pegado».'
  const tipo = /^[A-Za-z]{1,40}$/.test(kind) ? ` (${kind})` : ''
  return `opencode ha contestado ${status}${tipo}: pega el bloque a mano y pulsa «Ya lo he pegado».`
}

/*
 * «Quitar las claves de este sitio» (H19, docs/PLAN2.md §3.2 viñeta «Borrado»,
 * §8 decisión 3; anexo 2-A B1).
 *
 * POR QUÉ EXISTE: desde H18 Faro ESCRIBE las claves de Atlassian en la
 * configuración de opencode, así que tiene que poder quitarlas: hasta aquí la
 * única salida era abrir el fichero a mano, y «Olvidar este sitio» borraba lo
 * que Faro guarda en el navegador pero dejaba los tokens en opencode, con el MCP
 * conectado y el sitio volviendo a adoptarse en el arranque siguiente.
 *
 * CÓMO: opencode 1.2.25 no tiene borrado por la API (`{mcp:{nombre:null}}` es un
 * 400 y `{mcp:{}}` fusiona sin borrar, §7), así que se reescribe cada entrada
 * ENTERA con `enabled: false` y sus diez variables a '' —lo decide `setup.js`
 * (`mcpScrubPatch`, por la barrera de `mcp-config.js`)—, todas en UN PATCH
 * (`scrubMcp`: cada PATCH reinicia TODOS los MCP de ese opencode, y dos seguidos
 * serían dos cortes). Queda un esqueleto deshabilitado y sin claves que Faro
 * reutiliza al volver a guardarlas, y no hay bucle: `mcpForHost` salta las
 * deshabilitadas, así que el arranque no lo adopta.
 *
 * EN DOS PASOS, y el primero sólo LEE: «Quitar las claves de este sitio» enseña
 * qué se va a deshabilitar con lo que opencode tiene de verdad (las entradas de
 * Faro, el host enlazado que se queda también sin claves, las que no son de
 * Faro con su casilla, y las que no se pueden quitar desde aquí), y sólo
 * «Quitar» escribe. Al escribir se vuelve a leer: si la lista cambió entretanto,
 * se repinta y no se escribe nada (el usuario confirmó OTRA lista).
 *
 * CON LAS MISMAS BARRERAS QUE `saveKeys` (§8.22 y §8.24): sitio, host y cliente
 * capturados antes del primer await; la guarda común `reconfiguring()` justo
 * antes de escribir; la relectura de lo que opencode CARGA antes de tocar el
 * almacén (una configuración de proyecto delante taparía la escrita, y dar el
 * sitio por desconfigurado con el MCP todavía cargado lo haría volver a
 * adoptarse); y nunca un cuerpo de configuración en el registro, en un anuncio
 * ni en pantalla.
 *
 * LO PENDIENTE DEL MCP, SÓLO CUANDO DE VERDAD CAMBIA (revisión adversaria de
 * H19): un PATCH rechazado no toca nada en opencode —el MCP sigue conectado—, y
 * dar el MCP por desconectado ahí dejaba el siguiente Análisis con páginas base
 * avisando de «sin MCP» hasta el próximo arranque. Así que delante del PATCH
 * sólo se corta la espera de unas claves a medio guardar; lo demás se invalida
 * DETRÁS de un PATCH aceptado (que rearranca todos los MCP de ese opencode), y
 * donde el PATCH se aplicó pero el sitio no se da por desconfigurado (sin
 * releer, o con una configuración de proyecto delante) se vuelve a comprobar el
 * MCP con `relanzarComprobacionMcp`, en vez de dejarlo en «no conectado».
 *
 * NO ES «OLVIDAR ESTE SITIO»: sólo se desmarcan los registros del MCP
 * (`unlinkRecords`: configured, skippedKeys y los enlaces; `mcpName` se CONSERVA
 * desde la revisión adversaria de H19, para que volver a guardar reutilice el
 * esqueleto desde cualquier host del MCP y la pantalla de claves diga que está
 * deshabilitado). El índice, el contexto, la memoria, el diario y lo demás del
 * sitio se quedan: quitar las claves es para cambiarlas o dejar de usar ese
 * sitio un tiempo, no para que Faro lo olvide.
 */

/** Mientras `removeKeys` escribe: un segundo clic no escribe dos veces (H19). */
let quitandoClaves = false

/** Lo que se dice sin una configuración legible: sin saber qué hay, no se quita nada. */
const SIN_CONFIG_QUITAR = 'No he podido leer la configuración de opencode, y sin saber qué hay no quito nada: reinténtalo.'

/** ¿Es la configuración de opencode un objeto plano? Sin eso no se decide nada. */
function configPlana(config) {
  return !!config && typeof config === 'object' && !Array.isArray(config)
}

/**
 * Los hosts que el registro de ESTE sitio tiene enlazados al mismo MCP: el de
 * Jira y el de Confluence, distintos de éste, sin vacíos ni repetidos. Se
 * quedan sin claves con él (la entrada es compartida), así que se dicen y se
 * desmarcan también.
 */
function enlazadosDe(saved, host) {
  const out = []
  for (const h of [saved?.jiraHost, saved?.confluenceHost]) {
    if (typeof h === 'string' && h && h !== host && !out.includes(h)) out.push(h)
  }
  return out
}

/**
 * Los hosts enlazados que se quedan de verdad sin claves al quitar las de este
 * sitio (revisión adversaria de H19): los que el registro de ESTE sitio tiene
 * enlazados (`enlazadosDe`) más los que llevan las entradas PROPIAS que se van
 * a deshabilitar en `JIRA_URL`/`CONFLUENCE_URL` —una entrada con los dos
 * productos deja sin claves también al tercero que no estaba apuntado aquí—,
 * sin este host, sin vacíos ni repetidos. Y de esa unión, sólo los hosts cuyo
 * registro guardado no apunta a ningún MCP (`mcpName` '') o apunta a una de las
 * candidatas: un enlazado con SU propio MCP no pierde nada, y desmarcarlo hacía
 * que su siguiente arranque adoptara ese MCP como «sin comprobar» con unas
 * claves que sí estaban comprobadas. `prepareRemoveKeys` y `removeKeys` lo
 * calculan con esta MISMA función, así que el texto que se confirma, el
 * recálculo y los registros que se desmarcan dicen lo mismo.
 */
function hostsEnlazadosDe({ saved, host, propias, ajenas, sites }) {
  const nombres = [...propias, ...ajenas].map((c) => c.name)
  const hosts = enlazadosDe(saved, host)
  for (const c of propias) {
    for (const h of [c.jiraHost, c.confluenceHost]) {
      if (typeof h === 'string' && h && h !== host && !hosts.includes(h)) hosts.push(h)
    }
  }
  const registros = sites && typeof sites === 'object' ? sites : {}
  return hosts.filter((h) => {
    const apuntado = Object.hasOwn(registros, h) && typeof registros[h]?.mcpName === 'string' ? registros[h].mcpName : ''
    return apuntado === '' || nombres.includes(apuntado)
  })
}

/**
 * El plan que la confirmación enseña, montado en UN sitio para preparar y para
 * el recálculo de `removeKeys`: todo NOMBRES y hosts, nunca una entrada con su
 * environment. De la revisión adversaria de H19, además: `ajenasApagadas` (las
 * ajenas ya deshabilitadas: guardan claves en disco pero `mcpForHost` no las
 * adopta, y el texto lo dice así) y `conRestos` (las que guardan datos que Faro
 * no sabe vaciar: `restos` es un booleano de setup.js, nunca qué guardan).
 */
function planQuitar({ host, propias, ajenas, noQuitables, hostsEnlazados, carpeta }) {
  return {
    host,
    propias: propias.map((c) => c.name),
    ajenas: ajenas.map((c) => c.name),
    noQuitables: noQuitables.map((c) => c.name),
    hostsEnlazados,
    carpeta,
    ajenasApagadas: ajenas.filter((c) => c.enabled === false).map((c) => c.name),
    conRestos: [...propias, ...ajenas].filter((c) => c.restos === true).map((c) => c.name),
  }
}

/** ¿Dos listas de nombres (o de candidatas) son el mismo conjunto? */
function mismosNombres(a, b) {
  const nombres = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map((x) => (typeof x === 'string' ? x : x?.name)))].sort()
  return JSON.stringify(nombres(a)) === JSON.stringify(nombres(b))
}

/**
 * Por qué opencode no ha aceptado el borrado, en palabras (H19). La MISMA
 * clasificación que `porQueNoSeEscribe` —sólo el tipo del error y su código,
 * nunca el cuerpo—, pero sin sus remedios: aquí no hay ningún bloque que pegar
 * ni «Ya lo he pegado» que pulsar, y copiar esos textos mandaría a hacer algo
 * que no existe. El remedio lo dice quien llama: quitarlas a mano.
 */
function porQueNoSeQuita({ status = 0, kind = '' } = {}) {
  if (kind === 'ConfigJsonError') return 'su fichero tiene un error de sintaxis'
  if (kind === 'ConfigInvalidError') return 'su fichero tiene una clave que opencode no conoce'
  if (kind === 'entrada') return 'Faro no ha podido montar una entrada válida'
  if (kind === 'config') return 'no he podido leer la configuración'
  if (kind === 'red' || !status) return 'opencode no ha contestado'
  const tipo = /^[A-Za-z]{1,40}$/.test(kind) ? ` (${kind})` : ''
  return `opencode ha contestado ${status}${tipo}`
}

/**
 * El botón «Quitar»: apagado con un turno en vuelo (lleva `NEEDS_IDLE` y
 * `setStreaming` lo repinta por aquí), mientras se quita, y sin nada que quitar.
 * «Nada que quitar» mira la casilla (revisión adversaria de H19): con sólo
 * entradas ajenas, sin marcarla no hay nada, y el botón activo contestaba «No
 * hay nada que quitar.» justo después de una confirmación que las nombraba. La
 * casilla lo repinta al cambiar (su oyente `change`, en `wireEvents`).
 */
function paintRemoveKeysGo() {
  const plan = state.removeKeysPlan
  $('btn-remove-keys-go').disabled = quitandoClaves || state.streaming || !plan || (!plan.propias.length && !(plan.ajenas.length && $('remove-keys-foreign').checked))
}

/**
 * Esconde la confirmación y tira su plan: la próxima vez se vuelve a leer. Y
 * suelta el testigo de `prepareRemoveKeys`, así que una lectura todavía en
 * vuelo ya no pinta nada al volver (revisión adversaria de H19): la llaman
 * «Cancelar», abrir Ajustes y el cambio de sitio.
 */
function hideRemoveKeysConfirm() {
  state.removeKeysPlan = null
  state.removeKeysPrep = null
  $('remove-keys-confirm').classList.add('hidden')
  $('remove-keys-foreign').checked = false
}

/**
 * La confirmación en línea, con los textos que escribe `scrubConfirmText`
 * (setup.js: el espejo del banco los importa, así que dicen lo mismo por
 * construcción). La casilla de las ajenas nace desmarcada: deshabilitar una
 * entrada que no es de Faro tiene que ser una decisión, no un defecto. Aparece
 * bajo el botón sin que el foco se mueva solo, así que se anuncia (A2), y el
 * foco va a lo que hay que decidir: a «Quitar» si hay algo de Faro que quitar;
 * sin propias pero con ajenas, a su casilla (sin marcarla, «Quitar» nace
 * apagado); y si no hay nada, o con un turno en vuelo, a «Cancelar». Desde la
 * revisión adversaria de H19 pinta además el cuarto texto, lo que Faro no sabe
 * vaciar (`#remove-keys-leftovers`).
 */
function paintRemoveKeysConfirm(carpeta) {
  const plan = state.removeKeysPlan
  if (!plan) return
  const t = scrubConfirmText({ ...plan, carpeta })
  $('remove-keys-text').textContent = t.principal
  $('remove-keys-foreign-field').classList.toggle('hidden', !plan.ajenas.length)
  $('remove-keys-foreign').checked = false
  $('remove-keys-foreign-text').textContent = t.ajenas
  $('remove-keys-unremovable').textContent = t.noQuitables
  $('remove-keys-unremovable').classList.toggle('hidden', !t.noQuitables)
  $('remove-keys-leftovers').textContent = t.restos
  $('remove-keys-leftovers').classList.toggle('hidden', !t.restos)
  paintRemoveKeysGo()
  $('remove-keys-confirm').classList.remove('hidden')
  announce(t.principal)
  const foco = state.streaming || (!plan.propias.length && !plan.ajenas.length) ? 'btn-remove-keys-cancel' : plan.propias.length ? 'btn-remove-keys-go' : 'remove-keys-foreign'
  $(foco).focus()
}

/**
 * Primer paso de «Quitar las claves de este sitio»: SÓLO lee lo que opencode
 * tiene para este sitio y lo enseña. No escribe nada, ni en opencode ni en el
 * almacén. Sitio, host y cliente capturados antes del primer await (§8.22): la
 * lista es de ESE sitio y de ESE servidor.
 *
 * Con un testigo por llamada (`state.removeKeysPrep`, revisión adversaria de
 * H19): sin él, «Cancelar» o cerrar Ajustes mientras volvían las lecturas no
 * servían de nada —la confirmación reaparecía y se anunciaba, también en el
 * chat con Ajustes cerrado—, y dos clics la anunciaban dos veces. Un clic con
 * una preparación en vuelo, o con la confirmación ya abierta, no hace nada; al
 * volver, sólo pinta si el testigo sigue siendo el suyo, nadie está quitando, el
 * cliente y el sitio son los mismos y Ajustes sigue abierto. La salida que pinta
 * deja el testigo puesto hasta `hideRemoveKeysConfirm`; las demás lo sueltan.
 */
async function prepareRemoveKeys() {
  const decir = (texto) => {
    $('settings-status').textContent = texto
    announce(texto)
  }
  if (state.removeKeysPrep) return
  if (!state.site?.host) {
    decir('Abre una página de Jira o Confluence del sitio cuyas claves quieres quitar.')
    return
  }
  if (quitandoClaves) return
  const sitio = state.site
  const host = sitio.host
  const cliente = state.client
  if (!cliente) {
    decir('Faro no está conectado a opencode: arráncalo y vuelve a intentarlo.')
    return
  }
  const testigo = {}
  state.removeKeysPrep = testigo
  const saved = await getSite(host).catch(() => null)
  // Los registros de todos los sitios, UNA vez: deciden qué hosts enlazados se
  // quedan de verdad sin claves (`hostsEnlazadosDe`).
  const sites = await getSites().catch(() => null)
  // La carpeta, para decir DÓNDE queda el esqueleto; y la configuración, con los
  // tokens de todos los MCP en claro: de ella sólo salen nombres y hosts.
  const rutas = await cliente.paths().catch(() => null)
  const config = await cliente.config().catch(() => null)
  if (state.removeKeysPrep !== testigo || quitandoClaves || state.client !== cliente || (state.site?.host ?? state.lastHost) !== host || $('screen-settings').classList.contains('hidden')) {
    if (state.removeKeysPrep === testigo) state.removeKeysPrep = null
    return
  }
  if (!configPlana(config)) {
    state.removeKeysPrep = null
    decir(SIN_CONFIG_QUITAR)
    log.warn('Claves quitadas', 'sin quitar · configuración ilegible')
    return
  }
  const { propias, ajenas, noQuitables } = mcpScrubCandidates({ config, saved, host })
  const hostsEnlazados = hostsEnlazadosDe({ saved, host, propias, ajenas, sites })
  state.removeKeysPlan = planQuitar({ host, propias, ajenas, noQuitables, hostsEnlazados, carpeta: rutas?.config || '' })
  $('settings-status').textContent = ''
  paintRemoveKeysConfirm(rutas?.config || '')
}

/**
 * Segundo paso: «Quitar». Relee, comprueba que la lista es la que se confirmó,
 * escribe UN PATCH con el panel quieto, relee lo que opencode carga y sólo
 * entonces desmarca los registros del sitio y rearranca el panel, que llega a
 * la pantalla de claves por el camino normal (configured y skippedKeys a
 * false: `primeraVez`) o, si esa pantalla taparía algo —algo escrito en el
 * cuadro—, a su aviso en el chat con «Cambiar las claves». Los desenlaces
 * terminales se escriben y se anuncian (`decir`, A2); el estado de paso
 * («Quitando…») va a secas.
 */
async function removeKeys() {
  const decir = (texto) => {
    $('settings-status').textContent = texto
    announce(texto)
  }
  const plan = state.removeKeysPlan
  if (!plan || quitandoClaves) return
  if (!state.site?.host || state.site.host !== plan.host) {
    decir('He perdido de vista el sitio. Abre una página de Jira o Confluence y vuelve a intentarlo.')
    return
  }
  // Lo que decide, ANTES del primer await (§8.22): el sitio, el cliente y lo que
  // el usuario tenía marcado al pulsar. La casilla de las ajenas se lee aquí y no
  // después de las lecturas, porque lo que se confirmó es lo que se veía al clic.
  const sitio = state.site
  const host = sitio.host
  const cliente = state.client
  const conAjenas = $('remove-keys-foreign').checked
  quitandoClaves = true
  paintRemoveKeysGo()
  let hecho = false
  try {
    const saved = await getSite(host).catch(() => null)
    const sites = await getSites().catch(() => null)
    const config = await cliente.config().catch(() => null)
    if (state.client !== cliente || (state.site?.host ?? state.lastHost) !== host) return
    if (!configPlana(config)) {
      decir(SIN_CONFIG_QUITAR)
      log.warn('Claves quitadas', 'sin quitar · configuración ilegible')
      return
    }
    // La lista se RECALCULA con lo que opencode tiene ahora: entre abrirla y
    // pulsar «Quitar» ha podido cambiar (otra ventana, la TUI, un fichero
    // editado a mano). Si ya no es la que se confirmó —tampoco el host enlazado,
    // que el texto nombraba—, se repinta y no se escribe nada.
    const { propias, ajenas, noQuitables } = mcpScrubCandidates({ config, saved, host })
    const hostsEnlazados = hostsEnlazadosDe({ saved, host, propias, ajenas, sites })
    if (!mismosNombres(propias, plan.propias) || !mismosNombres(ajenas, plan.ajenas) || !mismosNombres(hostsEnlazados, plan.hostsEnlazados)) {
      state.removeKeysPlan = planQuitar({ host, propias, ajenas, noQuitables, hostsEnlazados, carpeta: plan.carpeta })
      paintRemoveKeysConfirm(plan.carpeta)
      decir('La configuración de opencode ha cambiado desde que abriste esta lista: revísala y vuelve a pulsar «Quitar».')
      return
    }
    const candidatas = [...propias, ...(conAjenas ? ajenas : [])]
    // Una red: con sólo ajenas y la casilla sin marcar «Quitar» nace apagado
    // (`paintRemoveKeysGo`), pero si el clic llega justo en el cambio se dice
    // qué falta en vez de un «nada que quitar» que contradice la confirmación.
    if (!candidatas.length && ajenas.length) {
      decir(`Marca la casilla para quitar ${ajenas.map((c) => `«${c.name}»`).join(', ')}: no hay ninguna entrada de Faro que quitar.`)
      return
    }
    if (!candidatas.length) {
      decir('No hay nada que quitar.')
      return
    }
    // La guarda común, justo antes de escribir (§8.24): el PATCH aborta los
    // turnos en vuelo de ese opencode y rearranca todos sus MCP.
    const ocupado = reconfiguring()
    if (ocupado) {
      decir(ocupado)
      return
    }
    // Delante del PATCH, sólo lo que caduca pase lo que pase: la espera de unas
    // claves a medio guardar, y las claves pendientes de verificar. Lo demás del
    // MCP de este panel (su comprobación, «conectado») sigue siendo verdad si
    // opencode rechaza la escritura, así que se invalida DETRÁS de un PATCH
    // aceptado (revisión adversaria de H19).
    state.mcpWait?.abort()
    state.pendingMcp = null
    $('settings-status').textContent = 'Quitando las claves de opencode…'
    const nombres = candidatas.map((c) => c.name).join(', ')
    const t0 = performance.now()
    const r = await scrubMcp(cliente, { candidatas })
    const msPatch = Math.round(performance.now() - t0)
    if (state.client !== cliente || (state.site?.host ?? state.lastHost) !== host) {
      log.info('Claves quitadas', `${nombres} · espera cancelada`)
      return
    }
    if (!r.ok) {
      log.warn('Claves quitadas', `sin quitar · ${r.status || 0} · ${r.kind || 'sin tipo'}`)
      decir(
        `opencode no ha aceptado la escritura: ${porQueNoSeQuita({ status: r.status, kind: r.kind })}. Las claves siguen ahí. ` +
          `Para quitarlas a mano, en ${plan.carpeta || 'la carpeta de configuración de opencode'} pon "enabled": false en ${candidatas.map((c) => `«${c.name}»`).join(', ')} y vacía sus variables.`
      )
      return
    }
    // Aceptado: opencode ha rearrancado todos sus MCP (§7), y lo que el MCP de
    // este panel tenía en marcha deja de valer, con las MISMAS líneas que
    // `saveKeys` (la cabecera se suelta si decía «comprobando MCP…»).
    state.mcpCheck = null
    soltarComprobandoMcp()
    state.mcpPending = null
    state.mcpConnected = false
    // La relectura, ANTES de tocar el almacén: lo que opencode CARGA tiene que
    // ser lo escrito. Sin esto, con una configuración de proyecto delante el
    // sitio quedaría desmarcado con el MCP todavía cargado y con claves, y el
    // arranque siguiente lo volvería a adoptar.
    const despues = await cliente.config().catch(() => null)
    if (state.client !== cliente || (state.site?.host ?? state.lastHost) !== host) {
      log.info('Claves quitadas', `${nombres} · espera cancelada`)
      return
    }
    if (!configPlana(despues)) {
      // Desvío razonado del contrato: `scrubEffective` sin configuración da
      // todo por pendiente, y decir «hay una configuración de proyecto delante»
      // sería inventar la causa. Se dice lo que se sabe. La confirmación sigue
      // abierta, así que el remedio es su «Quitar». Y el MCP se vuelve a
      // comprobar: el PATCH se aplicó y no se sabe cómo ha quedado.
      log.warn('Claves quitadas', `${r.names.join(', ')} · sin releer la configuración`)
      decir('opencode ha aceptado la escritura, pero no he podido releer su configuración para comprobarla: Faro no da el sitio por desconfigurado. Vuelve a pulsar «Quitar».')
      relanzarComprobacionMcp(cliente, saved)
      return
    }
    const ef = scrubEffective(despues, r.names)
    if (!ef.ok) {
      log.warn('Claves quitadas', `${r.names.join(', ')} · la configuración que opencode carga no es la escrita: ${ef.pendientes.join(', ')}`)
      decir(
        `opencode ha aceptado la escritura, pero lo que carga no es lo escrito (${ef.pendientes.join(', ')} sigue con claves): hay una configuración de proyecto delante. ` +
          'Faro no da el sitio por desconfigurado; arranca opencode desde otra carpeta (tools\\arrancar-opencode.ps1 usa una propia) y vuelve a intentarlo.'
      )
      // El MCP sigue cargado con sus claves: se vuelve a comprobar en vez de
      // dejar el panel diciendo que no está conectado.
      relanzarComprobacionMcp(cliente, saved)
      return
    }
    // Sólo ahora, los registros: el de este host siempre, los de sus enlazados
    // que apuntan a lo quitado (o a nada) y los demás del MCP quitado, con el
    // patch exacto de `unlinkRecords` (nada de índice, contexto, memoria ni
    // diario: esto no es «Olvidar este sitio»; y `mcpName` se conserva).
    const registros = unlinkRecords({ sites: await getSites(), names: r.names, host, linked: plan.hostsEnlazados })
    for (const { host: h, patch } of registros) await saveSite(h, patch)
    log.ok('Claves quitadas', `${r.names.join(', ')} · deshabilitadas sin claves · PATCH ${msPatch} ms · registros: ${registros.map((x) => x.host).join(', ') || 'ninguno'}`)
    // Lo que la fusión profunda del PATCH deja en disco (variables de más o
    // argumentos del comando): la confirmación ya lo decía, y el registro lo
    // apunta de las que de verdad se mandaron. Sólo NOMBRES: qué guardan, no.
    const conRestos = candidatas.filter((c) => c.restos === true).map((c) => c.name)
    if (conRestos.length) {
      log.warn('Claves quitadas', `${conRestos.join(', ')} · guarda${conRestos.length === 1 ? '' : 'n'} datos que Faro no sabe vaciar (variables de más o argumentos del comando)`)
    }
    // Las ajenas sin marcar: las habilitadas se seguirán adoptando; las ya
    // deshabilitadas no (`mcpForHost` las salta), pero guardan claves en disco.
    const sinMarcar = conAjenas ? [] : ajenas
    const vivasSinMarcar = sinMarcar.filter((c) => c.enabled !== false).map((c) => c.name)
    const apagadasSinMarcar = sinMarcar.filter((c) => c.enabled === false).map((c) => c.name)
    if (vivasSinMarcar.length) {
      const varias = vivasSinMarcar.length > 1
      log.info('Claves quitadas', `${vivasSinMarcar.join(', ')} se queda${varias ? 'n' : ''} habilitada${varias ? 's' : ''}: el sitio la${varias ? 's' : ''} seguirá adoptando`)
    }
    if (apagadasSinMarcar.length) {
      const varias = apagadasSinMarcar.length > 1
      log.info('Claves quitadas', `${apagadasSinMarcar.join(', ')} sigue${varias ? 'n' : ''} deshabilitada${varias ? 's' : ''} con claves en disco`)
    }
    hideRemoveKeysConfirm()
    announce('Claves quitadas de opencode. Faro te las volverá a pedir.')
    hideScreens()
    hecho = true
  } finally {
    quitandoClaves = false
    paintRemoveKeysGo()
  }
  if (!hecho) return
  // El rearranque llega a la pantalla de claves por el camino normal (o a su
  // aviso en el chat, con la frase de la entrada deshabilitada, si la pantalla
  // taparía algo): `primeraVez` (configured y skippedKeys a false), y sin bucle
  // porque `mcpForHost` salta la entrada deshabilitada.
  await bootForSite()
}

/**
 * Paso manual: enseñar dónde va la configuración, dejarla copiada, y esperar
 * a que opencode la cargue. En cuanto aparece conectada, sigue solo.
 *
 * Desde H18 es el RESPALDO de `saveKeys`, que escribe por la API: se llega aquí
 * cuando opencode no ha aceptado la escritura (`motivo: 'sin-escribir'`, con el
 * `kind` del error: sintaxis rota, una clave que no conoce…), y entonces el
 * bloque de siempre se pega a mano y «Ya lo he pegado» hace que opencode lo
 * relea sin reiniciar; o cuando se escribió pero opencode no lo ha cargado en
 * `appearMs` (`motivo: 'no-aparece'`: una versión que no recarga en caliente),
 * y entonces no hay nada que pegar —ya está escrito—: se dice dónde y que hay
 * que reiniciar opencode, sin el bloque a la vista, y se espera igual.
 */
async function showManualStep(result, { motivo = '', kind = '', ruta = '' } = {}) {
  const paths = await state.client.paths().catch(() => null)
  const path = configFilePath(paths)

  state.snippets = {
    full: fullConfigSnippet(result.name, result.block),
    block: mcpBlockSnippet(result.name, result.block),
    mode: 'full',
  }

  $('setup-config-path').textContent = path
  paintSnippet()
  // Por qué se ha llegado aquí, y qué parte del paso hace falta.
  const yaEscrito = motivo === 'no-aparece'
  const porQue = $('setup-manual-why')
  porQue.textContent =
    motivo === 'sin-escribir'
      ? 'Faro no ha podido escribirlo por ti. ' + porQueNoSeEscribe({ status: result.status, kind })
      : yaEscrito
        ? `Ya está escrito en ${ruta || path}, pero opencode no lo ha cargado en ${MCP_RELOAD_LIMITS.appearMs / 1000} s: ` +
          'reinícialo con el mismo comando y Faro seguirá solo.' +
          notaVersion()
        : ''
  porQue.classList.toggle('hidden', !porQue.textContent)
  // Es el desenlace de «Conectar y comprobar» cuando no se pudo escribir o
  // opencode no lo cargó: se anuncia como los demás de `saveKeys` (A2).
  if (porQue.textContent) announce(porQue.textContent)
  $('setup-manual-paste').classList.toggle('hidden', yaEscrito)
  $('btn-setup-reload').classList.toggle('hidden', yaEscrito)
  $('btn-setup-reload').disabled = state.streaming
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

  // H15: con el MCP en «failed», por qué y «Reintentar», debajo de la espera.
  // Es la pantalla en la que un compañero se quedó quince minutos mirando «está
  // en failed» sin ninguna pista (docs/PLAN2.md §3.1). La espera pregunta cada
  // 1,5 s: el consejo se pinta UNA vez por error distinto —recrearlo en cada
  // vuelta se llevaría el botón a mitad de un clic— y se esconde en cuanto deja
  // de estar en «failed». «Reintentar» desde aquí nunca rearranca el panel: la
  // propia espera lo ve conectado en su vuelta siguiente y sigue sola.
  //
  // Salvo que la espera ya no exista. Pasó en la revisión adversaria de H15: los
  // quince minutos vencían con el MCP en «failed», el «Reintentar» seguía a la
  // vista y, al conectar, `retryMcp` volvía dando por hecho que la espera lo
  // vería: el MCP quedaba conectado en opencode, el Registro decía «MCP
  // reintentado · conectado» y el panel se quedaba en «Sigo sin verlo», sin
  // `finishSetup` ni registros del sitio. `vencida` la pone la espera SÓLO al
  // acabar sin verlo y sin que la cancelaran; entonces es el botón quien hace lo
  // que habría hecho ella. Con la espera viva sigue ella (así `finishSetup` no
  // puede correr dos veces), y cancelada —el usuario volvió a las claves, o se
  // fue a otro sitio— no se sigue. `manual: true` siempre: desde aquí nunca se
  // rearranca el panel, lo siga la espera o lo siga el botón.
  let vencida = false
  const cajaConsejo = $('setup-manual-hint')
  let errorPintado = null
  const pintarConsejo = (s) => {
    const consejo = mcpFailureHint(s)
    if (!consejo) {
      errorPintado = null
      cajaConsejo.textContent = ''
      cajaConsejo.classList.add('hidden')
      return
    }
    if (consejo.text === errorPintado) return
    errorPintado = consejo.text
    cajaConsejo.replaceChildren(
      mcpHintNode(consejo, {
        onRetry: async (boton) => {
          const r = await retryMcp(s.name, { boton, host: site.host, manual: true, repintar: pintarConsejo })
          // `state.mcpWait`: si hay una espera en marcha —ésta, o la de un paso
          // manual nuevo—, es ella la que lo verá.
          if (!vencida || state.mcpWait || !r?.connected) return
          if ((state.site?.host ?? state.lastHost) !== site.host) return
          waiting.classList.add('done')
          $('setup-waiting-text').textContent = 'MCP conectado. Comprobando las claves…'
          pintarConsejo(null)
          await finishSetup()
        },
      })
    )
    cajaConsejo.classList.remove('hidden')
  }
  pintarConsejo(null)

  const status = await waitForMcpReady(state.client, site.host, {
    timeoutMs: 15 * 60 * 1000,
    // El nombre con el que se ha escrito (H18): puede ser el de una entrada que
    // ya existía para este dominio, que no tiene por qué seguir la forma de Faro.
    mcpName: result.name,
    signal: controller.signal,
    onTick: (s, left) => {
      $('setup-waiting-text').textContent =
        s.present && s.status
          ? `El MCP está en «${s.status}»…`
          : `Esperando a que opencode cargue el MCP… (${Math.round(left / 1000)} s)`
      pintarConsejo(s)
    },
  })
  if (status.connected) pintarConsejo(null)
  if (state.mcpWait === controller) state.mcpWait = null

  if (controller.signal.aborted) return

  if (!status.connected) {
    vencida = true
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

  // El modelo con el que se comprueba, capturado al empezar (§8.22): son uno o
  // dos turnos, y el desplegable del redactor se puede tocar mientras tanto.
  const modelo = state.model
  // Y el CLIENTE, por lo mismo (§8.22): cambiar de sitio a mitad reconstruye el
  // cliente (`buildClient`) y cancela esta comprobación con `state.setupAbort`.
  // Sin capturarlo, lo que volvía de un turno cortado se leía como un modelo
  // «mudo», se apuntaba un día y se cerraban las pantallas del sitio NUEVO con
  // el aviso colgado en su chat (revisión adversaria de H16).
  const cliente = state.client
  const abortador = new AbortController()
  state.setupAbort = abortador
  const cancelada = () => state.client !== cliente || abortador.signal.aborted

  let session = null
  try {
    session = await cliente.createSession({ title: 'Faro · comprobación' })
    const detalles = []
    for (const product of PRODUCTS.filter((p) => products?.[p])) {
      const etiqueta = product === 'jira' ? 'Jira' : 'Confluence'
      say(`Comprobando las claves de ${etiqueta}…`)
      const check = await verifyCredentials(cliente, {
        sessionID: session.id,
        model: modelo,
        host: site.host,
        signal: abortador.signal,
        product,
      })

      // Lo que vuelve con el cliente ya cambiado no dice nada ni del modelo ni
      // de las claves: se registra y se va, sin apuntar ningún veredicto, sin
      // cerrar pantallas y sin tocar el estado, que ya es de otro sitio.
      if (state.client !== cliente || check.reason === 'cancelado') {
        log.info('Turno cancelado', 'la comprobación de las claves se canceló al cambiar de sitio')
        return
      }

      if (!check.ok && check.reason === 'modelo') {
        // El MODELO no contestó, así que ningún token se ha llegado a probar
        // (H16). Era justo el fallo del compañero: su plan rechazaba el modelo,
        // el aviso decía «Jira: …» como si la clave estuviera mal, y el sitio se
        // quedaba sin configurar sin saber por qué. Ahora no se culpa a las
        // claves: se apunta el veredicto gratis, se cierra la pantalla —el sitio
        // sigue SIN configurar, no se escribe ningún registro— y `pendingMcp` se
        // CONSERVA, porque «Volver a comprobar» sólo repite esta verificación con
        // el modelo que se elija en el desplegable, sin volver a escribir nada en
        // opencode. H17 cambia el aviso por la pantalla «Elige el modelo».
        const fallo = await noteModelFailure({ model: modelo, rawError: check.rawError, stalled: check.stalled })
        const texto =
          `El modelo «${nombreModelo(modelo)}» no ha podido contestar (${motivoModelo(fallo?.reason)}). ` +
          'No se ha llegado a comprobar ningún token: elige otro modelo en el desplegable y pulsa «Volver a comprobar».'
        say(texto)
        hideScreens()
        // Desde H17, el paso 4 de la máquina del primer uso: se vuelve a «Elige
        // el modelo» con el que falló marcado, y al elegir se repite SÓLO esta
        // verificación —`pendingMcp` sigue ahí, sin volver a escribir nada en
        // opencode—. El aviso con «Volver a comprobar» queda para cuando la
        // pantalla taparía algo (un turno en vuelo, algo escrito en el cuadro).
        if (puedeAbrirPantalla()) {
          showModelScreen({
            modo: 'setup',
            motivo:
              `El modelo «${nombreModelo(modelo)}» no ha podido contestar (${motivoModelo(fallo?.reason)}). ` +
              'No se ha llegado a comprobar ningún token: elige otro y se repetirá la comprobación.',
            marcado: modelo,
          }).catch(console.error)
        } else {
          attachSetupModelNotice(texto)
        }
        return
      }

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

    // Si eran unas claves adoptadas sin comprobar (H18), esta es la primera
    // verificación buena: se dice, y el recordatorio del chat se va.
    const antes = await getSite(site.host).catch(() => null)
    const registros = siteRecords({
      host: site.host,
      product: site.product,
      mcpName: name || mcpNameForHost(site.host),
      jiraHost: products?.jira || '',
      confluenceHost: products?.confluence || '',
      verified: true,
    })
    for (const { host, patch } of registros) await saveSite(host, patch)
    if (keysUnverified(antes)) log.ok('Claves sin comprobar', `${site.host}: comprobadas · ${detalles.join(' · ')}`)
    state.avisoSinComprobar?.remove()
    state.avisoSinComprobar = null
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
    // Lo mismo si lo que revienta es un turno cortado por el cambio de sitio:
    // el texto iría a la pantalla de claves, que ya puede ser la del otro.
    if (cancelada()) {
      log.info('Turno cancelado', 'la comprobación de las claves se canceló al cambiar de sitio')
      return
    }
    say('No he podido comprobarlo: ' + (err?.message || err))
  } finally {
    if (session) cliente.deleteSession(session.id).catch(() => {})
    if (state.setupAbort === abortador) state.setupAbort = null
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
 * El recordatorio «claves sin comprobar» (H18, docs/PLAN2.md §3.2): el sitio de
 * la pestaña tiene un MCP que `checkMcp` ADOPTÓ conectado —la recarga a mitad
 * del primer uso, o un bloque pegado a mano— sin que ningún turno haya probado
 * sus tokens, y queda `verified: false` hasta la primera verificación buena.
 * Sin esto el sitio quedaba `configured` y el primer token malo salía como una
 * fila de herramienta fallida en mitad de un análisis.
 *
 * Lee el registro del ALMACÉN, no de lo que el arranque leyó (la adopción lo
 * reescribe después), y sólo avisa con `verified: false` EXPLÍCITO
 * (`keysUnverified`): los registros guardados antes de H18 no lo llevan y nadie
 * tiene que ver este aviso por actualizar Faro. Una vez por chat (se vuelve a
 * colgar en cada repintado, desde `restoreConversation`) y nunca con el chat a
 * punto de vaciarse. El botón pide el turno parado (`NEEDS_IDLE`): verificar
 * son uno o dos turnos de modelo.
 */
async function avisarClavesSinComprobar({ anunciar = false } = {}) {
  const host = state.site?.host
  if (!host) return
  const saved = await getSite(host).catch(() => null)
  if (state.site?.host !== host || !keysUnverified(saved)) return
  if (state.avisoSinComprobar?.isConnected) return
  if (!$('screen-context').classList.contains('hidden') || !el.busy.classList.contains('hidden')) return
  const texto =
    `Las claves de ${host} no se han comprobado todavía: opencode tenía el MCP conectado y Faro lo ha adoptado ` +
    'sin probar ningún token. Si una consulta a Jira o a Confluence falla, empieza por aquí.'
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(texto, true))
  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'ghost small ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Comprobar las claves'
  btn.disabled = state.streaming
  btn.addEventListener('click', () => {
    if (state.streaming) return
    comprobarClavesAdoptadas(btn).catch(console.error)
  })
  row.appendChild(btn)
  wrap.appendChild(row)
  el.chat.appendChild(wrap)
  state.avisoSinComprobar = wrap
  if (anunciar) announce(texto)
  scrollChat()
}

/**
 * «Comprobar las claves» del recordatorio: la MISMA verificación de siempre
 * (`finishSetup`), sin escribir nada en opencode —las claves ya están ahí—.
 * Como tras una recarga no queda ningún `pendingMcp`, se reconstruye de lo que
 * opencode tiene de verdad para este dominio (`mcpForHost`: sólo los hosts y el
 * nombre, nunca el `environment`), con el sitio, el cliente y el host
 * capturados antes del primer await (§8.22). Sin un MCP que lleve el dominio no
 * hay nada que verificar, y se dice: escribir `verified: true` sin haber probado
 * un solo token sería mentir.
 */
async function comprobarClavesAdoptadas(boton) {
  const sitio = state.site
  const host = sitio?.host
  const cliente = state.client
  if (!host || !cliente) return
  boton.disabled = true
  const config = await cliente.config().catch(() => null)
  if (state.site?.host !== host || state.client !== cliente) return
  const found = mcpForHost(config, host)
  if (!found) {
    boton.disabled = state.streaming
    showNotice('No encuentro en opencode ningún MCP con este dominio: vuelve a poner las claves desde Ajustes.', true, { force: true })
    return
  }
  state.pendingMcp = { name: found.name, site: sitio, products: { jira: found.jiraHost, confluence: found.confluenceHost } }
  state.avisoSinComprobar?.remove()
  state.avisoSinComprobar = null
  $('setup-host').textContent = host
  $('setup-manual').classList.add('hidden')
  $('setup-main').classList.remove('hidden')
  showScreen('screen-setup')
  await finishSetup()
}

/**
 * El aviso de que la comprobación de las claves no llegó a hacerse porque el
 * MODELO no contestó (H16), con la única salida que tiene sentido: elegir otro
 * en el desplegable del redactor —que en el chat sí se puede usar— y repetir la
 * verificación.
 *
 * «Volver a comprobar» llama a `finishSetup()` otra vez con el `pendingMcp` que
 * se conservó: no vuelve a escribir la configuración ni a esperar al MCP, sólo
 * comprueba. Antes vuelve a enseñar la pantalla de claves, que es donde
 * `finishSetup` dice lo que va pasando («Comprobando las claves de Jira…») y,
 * si ahora fallara una clave de verdad, por qué: sin ella, ese texto se
 * escribiría en una pantalla cerrada. Si vuelve a fallar el modelo, la pantalla
 * se cierra otra vez y sale un aviso nuevo.
 *
 * `NEEDS_IDLE`, como los botones que cuelgan de una respuesta: es un turno de
 * modelo más, y con otro en vuelo no se lanza.
 */
function attachSetupModelNotice(texto) {
  const wrap = document.createElement('div')
  wrap.appendChild(noticeNode(texto, true))
  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'ghost small ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Volver a comprobar'
  btn.disabled = state.streaming
  btn.addEventListener('click', async () => {
    if (state.streaming) return
    btn.disabled = true
    wrap.remove()
    showScreen('screen-setup')
    await finishSetup()
  })
  row.appendChild(btn)
  wrap.appendChild(row)
  el.chat.appendChild(wrap)
  announce(texto)
  scrollChat({ force: true })
  return wrap
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
  // Y sólo el de ESTE proyecto: desde H22 se guarda uno por proyecto dentro del
  // host. Con el panel ya en otro sitio, los de este host se leen del almacén.
  const delHost = !sitio ? null : (state.site?.host ?? state.lastHost) === sitio.host ? state.profiles : await getProfiles(sitio.host)
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
    // Con el script roto no es el permiso (H28, revisión adversaria de H27, D2).
    // Ni con la pestaña cambiada mientras se comprobaba (revisión de H28, D5).
    if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
      if (tabId != null && state.tabId !== tabId) return falla('pestaña', `No he leído el árbol de ${host}: has cambiado de pestaña.`)
      const roto = sinAccesoMotivo(state.contentProblem, { tabId, host })
      return falla('permiso', roto ? `No puedo leer el árbol de ${host} (${roto}): recarga la pestaña.` : `No puedo leer el árbol sin permiso sobre ${host}.`)
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
      return falla(failReason(r, 'sin respuesta'), `No he podido leer el árbol de ${host} por su API: ${failReason(r, 'la pestaña no contestó')}.`)
    }
    const index = indexFromSpacePages(r.pages, { site: sitio, scope, homeId: r.homeId })
    if (!index) return falla('vacío', `La API de ${host} no devuelve ninguna página en ${scope.label}.`)
    // Cuántas de cuántas, no sólo cuántas: desde H14 el árbol son las páginas más
    // RECIENTES del espacio (F8), así que en un espacio grande siempre viene
    // recortado y lo honesto es decir de cuántas. Si la API no dice el total
    // —pasa por el camino de respaldo—, se dice en qué tope se paró.
    const deCuantas = r.total ? `${r.own} de ${r.total}` : `recortado en ${INDEX_LIMITS.maxPages}`
    log.ok(
      'Índice leído de la API',
      `${host} · ${indexSize(index)} entradas · ${r.requests} petición(es)${r.truncated ? ` · ${deCuantas}` : ''}` +
        `${r.via === 'lista' ? ' · por la lista, sin ordenar por fecha' : ''}${Number.isFinite(r.ms) ? ` · ${r.ms} ms` : ''}`
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
      if (tabId != null && state.tabId !== tabId) return falla('pestaña', `No he contado la muestra de ${host}: has cambiado de pestaña.`)
      const roto = sinAccesoMotivo(state.contentProblem, { tabId, host })
      return falla('permiso', roto ? `No puedo contar la muestra de ${host} (${roto}): recarga la pestaña.` : `No puedo contar la muestra sin permiso sobre ${host}.`)
    }
    report(`Contando ${scope.label} en la API de Jira: una muestra de sus tickets…`)
    if (signal?.aborted) return nada
    const r = await countProfile(sitio, scope, { tabId, signal })
    if (signal?.aborted || r.reason === 'cancelado') return nada
    if (!r.ok) return falla(r.reason, r.detail)
    // El perfil se guarda bajo el host con el que se pidió (lo hace
    // `countProfile`); en el estado sólo entra si el panel sigue ahí (§8.22).
    if ((state.site?.host ?? state.lastHost) === host) state.profiles = r.profiles
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
  // Y el ÁMBITO (H21): el espacio o el proyecto de la pestaña al empezar. El
  // contexto que salga de aquí es SUYO, se quede el usuario donde se quede.
  const scopeKey = scopeKeyOf(sitio)
  // Y el contexto del Confluence enlazado que viaja desde este proyecto, también
  // AHORA (§8.22): entre `restIndexFor` y `buildContext` pasan segundos, y
  // cambiar de proyecto reasigna `contextMd`/`contextScope` del objeto
  // compartido. Copia superficial: `applyLinkedScope` sólo reasigna claves de
  // primer nivel (revisión adversaria de H22, G03).
  const enlazado = sitio.product === 'jira' && state.linkedContext ? { ...state.linkedContext } : null
  const controller = new AbortController()
  state.indexingAbort = controller
  hideScreens()
  showBusy(
    keepContext ? 'Construyendo el índice' : 'Levantando el mapa',
    `Recorriendo ${scope?.label || 'esta zona'}…`,
    { abort: controller }
  )

  const report = (t) => (el.busyText.textContent = t)
  // Fuera del `try` para que el `catch` lo alcance.
  let modeloDelIndexado = state.model

  try {
    // El índice del host tiene un tope TOTAL (H21, decisión 9 de docs/PLAN2.md
    // §8): con varios espacios mapeados, `persistIndex` escribe el objeto entero
    // en cada turno. Al alcanzarse se PARA con un aviso, ANTES de leer nada, y
    // no se desaloja ningún espacio solo: sería justo lo contrario de «que se
    // guarde un árbol u otro». El usuario elige cuál olvidar en Ajustes.
    if (sitio.product === 'confluence' && scopeKey.startsWith('space:') && spaceOverflow(state.index, sitio.spaceKey)) {
      hideBusy()
      const { pages, spaces } = countPages(state.index)
      log.warn('Mapa lleno', `${host} · ${pages} páginas de ${spaces} espacios · tope ${INDEX_LIMITS.maxPagesTotal} · sin indexar ${scopeKey}`)
      showNotice(
        `El mapa de este sitio ya tiene ${pages} páginas de ${spaces} espacios (tope ${INDEX_LIMITS.maxPagesTotal}). ` +
          `Olvida el mapa de alguno desde Ajustes para indexar el espacio ${sitio.spaceKey}.`,
        true
      )
      return
    }
    // Lo que la API del propio sitio da exacto, antes de gastar un turno: el
    // árbol del espacio (Confluence) o la muestra contada del proyecto (Jira
    // Data Center). Si no se puede, `rest.index` viene null y `buildContext`
    // hace exactamente lo de siempre; el motivo va en el velo y en el Registro.
    const rest = await restIndexFor(scope, { sitio, report, signal: controller.signal })
    if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError')

    // El modelo con el que se indexa, para poder nombrarlo si es él el que falla
    // (H16): el error de la fase de prosa no lo trae y el desplegable puede
    // cambiar en los minutos que dura esto.
    modeloDelIndexado = state.model
    const { contextMd, index } = await buildContext(state.client, {
      scope,
      site: sitio,
      model: state.model,
      // Desde Jira, el indexador sabe qué Confluence hay enlazado y qué
      // cuenta su contexto: es donde buscar si los tickets están documentados.
      // El capturado al empezar, no el de ahora.
      linkedContext: enlazado,
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
    // El contexto va bajo el host Y el ámbito capturados al empezar (H21,
    // §8.22), y la clave es UNA por host con todos los ámbitos dentro: se lee,
    // se funde el de este ámbito y se escribe, RELEYENDO justo antes de escribir.
    // Otro indexado del mismo host que terminara en estos minutos (otro espacio,
    // desde otra pestaña) habría escrito su ámbito, y escribir la copia de
    // cuando se empezó se lo llevaría: con la relectura, la ventana es de
    // milisegundos, como la del diario (§4.10). Con `keepContext` se conserva el
    // texto de este ámbito —el que subió el usuario— y sólo se estampa que tiene
    // mapa (`indexedAt`); pero sólo si este ámbito TIENE texto propio: si la
    // pestaña cambió de espacio entre la subida y el indexado (o «Generar el
    // contexto otra vez» se pulsa desde otro espacio), el ámbito de ahora no lo
    // tiene, `withContext` no crearía nada y se tiraban el contexto generado y su
    // `indexedAt`, con el turno de modelo ya gastado (revisión adversaria de H21,
    // B8/A4): se guarda lo generado. La relectura migra con la MISMA regla que el
    // arranque (B9).
    const actuales = await memory.getContexts(host, contextLegacyFor(host))
    const propio = Object.hasOwn(actuales.scopes || {}, scopeKey)
    const nuevos = withContext(actuales, scopeKey, { text: keepContext && propio ? undefined : contextMd, indexedAt: Date.now() })
    await memory.saveContexts(host, nuevos)
    if (sigueAqui()) {
      state.contexts = nuevos
      applyScope()
    }
    // El índice también se funde sobre lo RELEÍDO del almacén, no sobre la copia
    // de memoria: con dos ventanas del mismo host indexando dos espacios, escribir
    // `state.index` de antes se llevaba las páginas que la otra acababa de guardar
    // y su espacio quedaba con `indexedAt` y sin árbol (revisión adversaria de
    // H21, B5). Lo de este panel va encima, porque es lo más nuevo que conoce.
    const enDisco = (await getIndex(host)).index
    const previo = sigueAqui() && state.index ? mergeIndex(enDisco, state.index) : enDisco
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
    // ¿Falló por el MODELO? (H16, dueño de este `catch`.) `buildContext` y
    // `promptStructured` le cuelgan al error lo que devolvió el proveedor
    // (`rawError`) o que se quedó colgado (`stalled`); un fallo de Faro, de la
    // API o del almacén no lleva ninguna de las dos cosas. Por modelo, el sitio
    // NO se da por configurado: hasta aquí se escribía `onboarded: true` también
    // en este caso y el sitio se quedaba sin contexto para siempre, sin volver a
    // ofrecer la pantalla de contexto (el otro fallo del compañero, anexo C).
    const porModelo = !!(err?.stalled || err?.rawError)
    let aviso = 'El indexado falló: ' + (err?.message || err)
    const modelo = err?.model || modeloDelIndexado
    let motivoPantalla = ''
    if (porModelo) {
      const fallo = await noteModelFailure({ model: modelo, rawError: err?.rawError || null, stalled: !!err?.stalled })
      aviso =
        `El indexado falló por el modelo «${nombreModelo(modelo)}» (${motivoModelo(fallo?.reason)}): ` +
        'elige otro modelo en el desplegable y vuelve a generar el contexto.'
      // En la pantalla el motivo no habla del desplegable: la lista está debajo.
      motivoPantalla =
        `El indexado falló por el modelo «${nombreModelo(modelo)}» (${motivoModelo(fallo?.reason)}): ` +
        'elige otro y se volverá a generar el contexto.'
    }
    if (!porModelo) await saveSite(host, { onboarded: true })
    // El aviso va DESPUÉS de repintar el chat: `restoreConversation` lo vacía, y
    // con el aviso delante se lo llevaba antes de que nadie lo viera (el
    // pendiente que quedó anotado en la revisión de H2; lo cierra H16).
    if (sigueAqui() && state.site) {
      await restoreConversation()
      if (sigueAqui() && state.site) {
        // H17, paso 5 de la máquina del primer uso: por modelo se vuelve a «Elige
        // el modelo», y al elegir se repite el indexado con el mismo
        // `keepContext`, detrás del aviso y del botón, que se quedan. Si la
        // pantalla taparía algo, el aviso lo pinta `attachModelNotice` UNA vez,
        // con su «Elegir otro modelo» y «Generar el contexto otra vez» debajo:
        // hasta la revisión adversaria de H17 (C6) salían dos avisos rojos
        // idénticos, `showNotice` y el suyo, y el lector de pantalla oía dos.
        const pantalla = porModelo && puedeAbrirPantalla()
        if (!porModelo || pantalla) {
          showNotice(aviso, true)
          if (porModelo) attachReindexButton({ keepContext })
          if (pantalla) showModelScreen({ modo: 'indexado', motivo: motivoPantalla, marcado: modelo, keepContext }).catch(console.error)
        } else {
          attachModelNotice(aviso, { modo: 'indexado', marcado: modelo, keepContext })
          attachReindexButton({ keepContext })
        }
      }
    }
  } finally {
    state.indexingAbort = null
  }
}

/**
 * «Generar el contexto otra vez», debajo del aviso de un indexado que falló por
 * el modelo (H16). Sin él, la única forma de reintentar era Ajustes →
 * «Reconstruir el contexto», que nadie encuentra justo después de un fallo; el
 * sitio además ya no queda `onboarded`, así que la pantalla de contexto volvería
 * a salir en el próximo arranque. Con el mismo `keepContext` que el indexado que
 * falló: tras subir un contexto a mano, reintentar sólo reconstruye el índice y
 * no se lleva el documento. `NEEDS_IDLE`: son turnos de modelo, y con uno del
 * chat en vuelo no se lanza. H17 lo acompaña con la pantalla «Elige el modelo».
 */
function attachReindexButton({ keepContext = false } = {}) {
  const row = document.createElement('div')
  row.className = 'nav-actions'
  const btn = document.createElement('button')
  btn.className = 'ghost small ' + NEEDS_IDLE
  btn.type = 'button'
  btn.textContent = 'Generar el contexto otra vez'
  btn.disabled = state.streaming
  btn.addEventListener('click', async () => {
    if (state.streaming) return
    row.remove()
    await generateContext({ keepContext })
  })
  row.appendChild(btn)
  el.chat.appendChild(row)
  scrollChat({ force: true })
}

async function uploadContext(ev) {
  const file = ev.target.files?.[0]
  if (!file) return
  // El host y el ámbito se capturan ANTES del primer await (§8.22): leer el
  // fichero es asíncrono y la pestaña puede cambiar mientras.
  const host = state.site.host
  const scopeKey = scopeKeyOf(state.site)
  const text = await file.text()
  // El documento es del ÁMBITO de la pestaña (H21): subirlo en el espacio B no
  // pisa el contexto del A. Leer-fundir-escribir con relectura, como el
  // indexado: los demás ámbitos del host se conservan tal cual, y un texto viejo
  // sin reparar migra con la regla del arranque (revisión adversaria de H21, B9).
  const actuales = await memory.getContexts(host, contextLegacyFor(host))
  const nuevos = await memory.saveContexts(host, withContext(actuales, scopeKey, { text }))
  if ((state.site?.host ?? state.lastHost) === host) {
    state.contexts = nuevos
    applyScope()
  }
  await saveSite(host, { onboarded: true })
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

// ------------------------------------------------------- ámbitos (H21)

/**
 * Recalcula lo que depende del ÁMBITO de la pestaña (H21, docs/PLAN2.md §3.4).
 *
 * `state.contexts` guarda los contextos de TODO el host por ámbito; lo que va al
 * prompt, a las referencias y a la cabecera es el del espacio o el proyecto que
 * hay delante —el suyo, o el de todo el sitio si no tiene—. Es la ÚNICA función
 * que asigna `state.contextMd` (salvo el vaciado a '' al cambiar de host o al
 * olvidar el sitio): si cada llamante lo calculara a su manera, un camino
 * acabaría metiendo en el prompt el contexto del espacio de antes. Sin ninguna
 * lectura del almacén, así que cambiar de espacio es instantáneo.
 *
 * Sube el testigo de las sugeridas y vacía la memo de las referencias: las dos
 * se calcularon con el contexto de antes, y una respuesta en vuelo de la pestaña
 * no puede pintar sugerencias de otro espacio. Y desde H22, en un Jira, vuelve a
 * elegir qué contexto del Confluence enlazado viaja (`applyLinkedScope`), que es
 * por PROYECTO: también sin leer nada.
 */
function applyScope() {
  const clave = scopeKeyOf(state.site)
  state.contextMd = contextFor(state.contexts, clave)
  state.contextScope = contextScopeFor(state.contexts, clave)
  state.sourcesSuggest.token++
  state.references = { propio: null, enlazado: null, index: null, items: null }
  applyLinkedScope()
}

/**
 * Con qué regla releen los contextos el indexado, el contexto subido y el
 * olvido: la que decidió el arranque de ESTE host (`state.contextLegacy`), y
 * ninguna —o sea «*»— si el panel ya es de otro sitio, porque esa regla no es
 * suya. Sin ella, un texto de antes de H21 cuya reparación falló en el arranque
 * lo reparaba la primera relectura bajo «*», contra lo que el arranque tenía en
 * memoria (revisión adversaria de H21, B9).
 */
function contextLegacyFor(host) {
  return (state.site?.host ?? state.lastHost) === host ? state.contextLegacy || {} : {}
}

/**
 * Bajo qué ámbito migra el contexto de antes de H21, que era UN texto por host.
 *
 * Sólo bajo el del índice guardado cuando se puede afirmar que es suyo: hay
 * índice de esta versión (uno viejo se descarta y no dice nada), su ámbito es UN
 * espacio o UN proyecto con clave válida, y el sitio dice cuándo se indexó. En
 * cualquier otra duda —el índice de todo el sitio, un sitio sin indexar— va a
 * «*», que se enseña en todos los espacios: el comportamiento de antes.
 * `normalizeContexts` lo vuelve a exigir por su lado. Pura.
 *
 * Un CONTEXT.md subido a mano ANTES de H21 NO cae en «*»: `uploadContext`
 * siempre reindexó después con `keepContext`, que fija `index.scope` en el
 * espacio de la pestaña y escribe `indexedAt`, así que migra bajo ese espacio
 * —la inferencia razonable: se subió estando ahí— y no se puede distinguir de
 * uno generado. Por eso `paintScopeList` marca ese ámbito como «migrado del
 * contexto de antes de H21»: el usuario ve adónde fue a parar y puede subirlo
 * otra vez desde otra página (revisión adversaria de H21, B4/C1/A5; hasta ahí
 * este comentario decía lo contrario).
 */
function legacyScopeOf(bundle, saved) {
  const scope = bundle?.index?.scope
  if (!bundle?.index || bundle.stale || !scope) return '*'
  if (scope.kind !== 'space' && scope.kind !== 'project') return '*'
  const indexado = saved?.indexedAt
  if (typeof indexado !== 'number' || !Number.isFinite(indexado) || indexado <= 0) return '*'
  return scopeKeyFromScope(scope)
}

/**
 * «Mapas y contextos de este sitio», en Ajustes: una fila por ámbito con lo que
 * Faro tiene de él y un «Olvidar el mapa» (H21).
 *
 * Los ámbitos son los que tienen contexto y, en Confluence, además los espacios
 * con páginas en el índice, que «Olvidar el mapa» se lleva. En Jira NO se lista
 * un proyecto por sus incidencias cosechadas: el olvido no las quita, y la fila
 * volvía con un «Olvidado el mapa» que no había pasado (revisión adversaria de
 * H21, B14/C3). Se pinta de lo que el panel tiene en memoria —son los mismos
 * objetos que el olvido modifica— y con un solo ámbito se pinta igual: es la
 * vista de lo que hay. Cuentas y claves, nunca contenido (§8.20): la clave dice
 * DE QUÉ es lo guardado. Un ámbito que vino del contexto de antes de H21 lo
 * dice, para que se vea adónde fue a parar (B4).
 */
function paintScopeList() {
  const box = $('scope-list')
  box.textContent = ''
  if (!state.site) return
  const claves = new Set(scopeKeys(state.contexts))
  if (state.site.product === 'confluence') {
    for (const p of Object.values(state.index?.pages || {})) {
      const clave = scopeKeyOf({ product: 'confluence', spaceKey: p?.spaceKey })
      if (clave !== '*') claves.add(clave)
    }
  }
  const ordenadas = [...claves].sort((a, b) => a.localeCompare(b, 'es'))
  if (!ordenadas.length) {
    const vacio = document.createElement('li')
    const k = document.createElement('span')
    k.className = 'k'
    k.textContent = 'este sitio'
    const v = document.createElement('span')
    v.className = 'v'
    v.textContent = 'sin mapa ni contexto todavía'
    vacio.append(k, v)
    box.appendChild(vacio)
    return
  }
  for (const clave of ordenadas) {
    const entrada = Object.hasOwn(state.contexts.scopes, clave) ? state.contexts.scopes[clave] : null
    const partes = []
    if (clave.startsWith('space:')) partes.push(`${pagesOfSpace(state.index, clave.slice('space:'.length)).length} páginas`)
    if (entrada) partes.push(`contexto ${entrada.text.length} caracteres`)
    if (entrada?.indexedAt) {
      partes.push('mapa del ' + new Date(entrada.indexedAt).toLocaleDateString('es', { day: 'numeric', month: 'short' }))
    } else {
      partes.push(hasMap(state.contexts, state.index, clave) ? 'con mapa' : 'sin mapa')
    }
    if (entrada?.legacy) partes.push('migrado del contexto de antes de H21')

    const fila = document.createElement('li')
    const k = document.createElement('span')
    k.className = 'k'
    k.textContent = scopeLabel(clave)
    const v = document.createElement('span')
    v.className = 'v'
    v.textContent = partes.join(' · ')
    const olvidar = document.createElement('button')
    olvidar.className = 'ghost small ' + NEEDS_IDLE
    olvidar.type = 'button'
    olvidar.textContent = 'Olvidar el mapa'
    olvidar.setAttribute('aria-label', ('Olvidar el mapa de ' + scopeLabel(clave)).replace(' de el ', ' del '))
    olvidar.disabled = state.streaming
    olvidar.addEventListener('click', () => {
      if (state.streaming) return
      forgetScope(clave).catch(console.error)
    })
    fila.append(k, v, olvidar)
    box.appendChild(fila)
  }
}

/**
 * «Olvidar el mapa de X»: las páginas de ese espacio, su entrada de espacios,
 * su `indexedAt` y su contexto (H21). Es lo que libera sitio cuando el mapa
 * llega a su tope total («Mapa lleno»), y lo único que toca: los demás ámbitos
 * del host se quedan como estaban.
 *
 * El host se captura antes del primer await y se comprueba al volver (§8.22)
 * con el sitio del PANEL, como el indexado: con la pestaña en el correo el
 * olvido sigue siendo de este host, y si no se aplicaba en memoria, al volver
 * `applyScope` devolvía al prompt el texto recién olvidado (revisión adversaria
 * de H21, B3). El contexto se relee antes de escribir —leer-fundir-escribir,
 * como el indexado, y con la regla de migración del arranque (B9)—: si otro
 * indexado del mismo host escribió su ámbito entretanto, la copia de memoria se
 * lo llevaría. El Registro va en cuanto la escritura vuelve, DELANTE de la
 * guarda: el olvido ya está hecho (C11). Si no había nada que quitar se dice
 * así, no «Olvidado» (B14). Y se repinta lo que depende de ello (B11).
 */
async function forgetScope(key) {
  const host = state.site?.host || ''
  if (!host || state.streaming) return
  const etiqueta = scopeLabel(key)
  const espacio = key.startsWith('space:') ? key.slice('space:'.length) : ''
  const paginas = espacio ? pagesOfSpace(state.index, espacio).length : 0
  const caracteres = contextFor(state.contexts, key, { fallback: '' }).length
  let guardados = null
  let nada = false
  try {
    if (espacio && state.index) {
      state.index = withoutSpace(state.index, espacio)
      // Un índice apuntado y todavía sin escribir (P3) de este host llevaría el
      // espacio de vuelta en la escritura del final del turno o al fundirlo un
      // indexado: se apunta el de ahora, que ya no lo tiene.
      if (state.indexDirty?.host === host) state.indexDirty = { host, index: state.index }
      await saveIndex(host, state.index)
    }
    const actuales = await memory.getContexts(host, contextLegacyFor(host))
    nada = !paginas && !Object.hasOwn(actuales.scopes || {}, key)
    guardados = await memory.saveContexts(host, withoutContext(actuales, key))
  } catch (err) {
    // §8.14: un olvido que no se pudo escribir no puede parecer hecho.
    log.warn('Mapa olvidado', `${host} · ${key} · no se pudo escribir: ${err?.message || err}`)
    announce('No he podido olvidar ese mapa.')
    paintScopeList()
    return
  }
  log.info('Mapa olvidado', `${host} · ${key} · ` + (nada ? 'nada que olvidar' : `${paginas} páginas · ${caracteres} caracteres`))
  if ((state.site?.host ?? state.lastHost) !== host) return
  state.contexts = guardados
  applyScope()
  announce((nada ? `No había nada que olvidar de ${etiqueta}.` : `Olvidado el mapa de ${etiqueta}.`).replace(' de el ', ' del '))
  paintScopeList()
  paintSettingsSiteInfo()
  paintPrivacy().catch(() => {})
  const vacio = state.site ? el.chat.querySelector('.empty') : null
  if (vacio) showWelcome({ announce: false, replace: vacio })
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
  // Y «Dibujar el flujo» (H24): la respuesta que había que dibujar se va con el chat.
  state.pendingDiagram = null
  // Y los diagramas ya apuntados: en la sesión nueva, el mismo se vuelve a apuntar
  // (revisión adversaria de H24, D04).
  diagramasRegistrados.clear()
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
        // Con el motivo de un content script roto también (H28), no «sin respuesta».
        reason: failReason(r, 'sin respuesta'),
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

  // Con el script roto no es el permiso (H28, revisión adversaria de H27, D2):
  // el motivo va en `detail`, que es lo que enseña `todayFailText`. Con la
  // pestaña cambiada mientras se comprobaba, tampoco (revisión de H28, D5).
  if (tabId == null || !(await ensureContentAccess({ announce: false }))) {
    if (tabId != null && state.tabId !== tabId) return { ok: false, reason: 'pestaña', detail: 'has cambiado de pestaña' }
    const roto = sinAccesoMotivo(state.contentProblem, { tabId, host: target.host })
    return { ok: false, reason: 'permiso', detail: roto || `sin permiso sobre ${target.host}` }
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
  // El `detail` dice qué falta: el permiso, o un content script que no arranca
  // (H28, D2), que con «sin permiso sobre ese dominio» se hacía pasar por lo otro.
  if (e?.reason === 'permiso') return `No puedo leer lo último de ${e.host}: ${e.detail || 'sin permiso sobre ese dominio'}.`
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
 * Desde H21 la línea «X aún no tiene mapa» de un espacio sin mapa cuenta como
 * una línea más: con ella y las tres filas se llega justo a 9.
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
function emptyFits(rows, chips, noMap = false) {
  // El rótulo y el «Ver todo» que acompañan a las filas.
  const deHoy = rows > 0 ? rows + 2 : 0
  // La línea «X aún no tiene mapa» de un espacio sin mapa propio (H21), que va
  // entre la explicación y las filas: una línea más, como una fila.
  const deMapa = noMap ? 1 : 0
  // Y el rótulo de las pastillas, más las líneas que ocupen envolviendo.
  const dePastillas = chips > 0 ? 1 + Math.ceil(chips / EMPTY_LIMITS.chipsPerLine) : 0
  return deHoy + deMapa + SUGGESTION_COUNT + dePastillas <= EMPTY_LIMITS.lines
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
  // La línea del espacio sin mapa (H21) ya está pintada cuando se llega aquí:
  // `showWelcome` la cuelga antes de pedir los chips.
  const sinMapa = !!el.chat.querySelector('.empty .no-map')
  if (!emptyFits(filas.length, pastillas, sinMapa)) {
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
