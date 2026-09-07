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
import { suggestsAnotherModel } from '../opencode/turn.js'
import { pickDefaultModel, pickAlternativeModel, pickPlannerModel, modelKey, parseModelKey } from '../shared/models.js'
import { parseAtlassianUrl, describeLocation, defaultScope, samePage, wikiPrefix as wikiPrefixOf } from '../atlassian/site.js'
import { mergeIndex, mergeIndexKeepingTree, indexSize, normalizeIndex, ancestryOf } from '../atlassian/index-store.js'
import { CORS_ORIGIN, DEFAULT_SETTINGS, mcpNameForHost } from '../shared/config.js'
import { MSG } from '../shared/messages.js'
import { navOptions } from '../nav/options.js'
import {
  getSettings, saveSettings, getSite, saveSite, forgetSite,
  getIndex, saveIndex, getSessionId, setSessionId, clearSessionId,
} from '../shared/storage.js'
import { renderMarkdown } from './markdown.js'
import { SKILLS, DEFAULT_SKILL, skillById } from './skills.js'
import { pickLabel } from '../content/pick-payload.js'
import { prettyTool, clockTime } from '../shared/format.js'
import { log } from '../shared/log.js'
import {
  configureMcp,
  mcpStatusFor,
  verifyCredentials,
  waitForMcpReady,
  configFilePath,
  mcpBlockSnippet,
  fullConfigSnippet,
} from './setup.js'
import { buildContext, harvestIndex, countWithParent } from './indexer.js'
import { planNavigation, shouldPlan, currentPageId } from './planner.js'
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
} from './sources.js'
import {
  collectNotes,
  numberedIn,
  validateNotes,
  splitAnchorsBlock,
  titleFromProse,
  surplusNumbers,
} from './notes.js'
import { baseSystem, selectionBlock, stripSelectionBlock, pageUrlFromSystem, PAGE_OPEN } from './prompts.js'
import * as memory from './memory.js'

// ------------------------------------------------------------------ estado

const $ = (id) => document.getElementById(id)

const el = {
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
  locationText: $('location-text'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  memoryToggle: $('btn-memory-toggle'),
  memoryLabel: $('memory-label'),
  busy: $('busy'),
  busyTitle: $('busy-title'),
  busyText: $('busy-text'),
}

const state = {
  settings: { ...DEFAULT_SETTINGS },
  client: null,
  site: null,
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
  // La búsqueda de páginas base en curso: un testigo para descartar la
  // respuesta tardía de una consulta que el usuario ya ha reescrito.
  sourcesSearch: { token: 0, timer: 0, suggestions: [], active: -1 },
  notes: [],
  noteRows: new Map(),
  notesCard: null,
  // Lo que pintó la última tarjeta viva, para poder volver a pintarla si el
  // chat se repinta con las marcas todavía en la página.
  notesResult: null,
  // Testigo del turno en curso: el `finally` de un turno cancelado no puede
  // apagar el estado del siguiente.
  turnToken: null,
  defaults: {},
  tracker: null,
  streaming: false,
  lastQuestion: '',
  tabUrl: '',
  tabTitle: '',
  turns: [],
  indexingAbort: null,
  pendingMcp: null,
  snippets: null,
  mcpWait: null,
  logOnlyProblems: false,
  logUnsub: null,
  turnAbort: null,
  // host:id -> { largo } del camino leído de la API en esta sesión, o { fallo }
  // con la hora del último intento que no contestó. Sirve para no volver a
  // pedirlo mientras el índice lo conserve entero, ni esperar en cada
  // respuesta a una API caída.
  ancestryFetched: new Map(),
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
  client.on('*', (event) => state.tracker?.handle(event))
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

  const changedHost = site?.host !== state.site?.host
  if (changedHost && state.picking) setPicking(false)
  // Lo que es del sitio no viaja al siguiente: las páginas base, el índice,
  // los caminos leídos y el contexto se vacían hasta que `bootForSite` cargue
  // los del host nuevo. Sin esto, si el sitio nuevo se quedaba en la pantalla
  // de claves, la pantalla de páginas base sugería páginas del sitio anterior
  // y su índice acababa guardado como si fuera de éste. Y la pantalla, si
  // estaba abierta, se cierra: hablaba del otro sitio.
  if (changedHost) {
    if (!$('screen-sources').classList.contains('hidden')) closeSourcesScreen()
    state.sources = emptySources()
    state.index = null
    state.ancestryFetched = new Map()
    state.contextMd = ''
    paintSourcesUi()
  }
  state.site = site
  state.tabUrl = tab.url || ''
  state.tabTitle = tab.title || ''

  el.locationText.textContent = site ? describeLocation(site) : 'Fuera de Atlassian'

  if (!site) {
    showEmpty({
      title: 'Abre Jira o Confluence',
      text: 'Faro trabaja dentro de un sitio de Atlassian. Ve a una página y vuelve.',
    })
    return
  }

  if (changedHost) await bootForSite()
}

/** Arranque completo para un sitio: servidor, claves, contexto. */
async function bootForSite() {
  const client = buildClient()
  setStatus('busy', 'comprobando…')

  // 1. ¿Está opencode?
  try {
    await client.health()
  } catch (err) {
    setStatus('bad', 'sin opencode')
    showScreen('screen-connect', String(err?.message || err))
    return
  }
  client.connect()

  // 2. Modelos y modo de trabajo, tal y como los dejaste en este sitio.
  setSkill((await getSite(state.site.host))?.skill || DEFAULT_SKILL)

  try {
    const { models, defaults } = await client.models()
    state.models = models
    const stored = await getSite(state.site.host)
    state.defaults = defaults
    fillModels(models, stored?.model || pickDefaultModel(models, defaults))
  } catch (err) {
    showNotice('No he podido leer la lista de modelos: ' + err.message, true)
  }

  // 3. ¿Tiene claves este sitio, y están de verdad conectadas?
  const mcp = await client.listMcp().catch(() => ({}))
  const status = mcpStatusFor(mcp, state.site.host)
  const saved = await getSite(state.site.host)

  // Las páginas base de ESTE sitio, y si hay quien pueda leerlas: sin el MCP
  // el modelo no llega a ellas, y la pantalla lo dice.
  state.mcpConnected = !!status.connected
  state.sources = normalizeSources(saved?.analysisSources, { host: state.site.host })
  paintSourcesUi()

  if (!status.connected && !saved?.skippedKeys) {
    hideScreens()
    showSetupScreen()
    if (status.present) {
      $('setup-status').textContent = `El MCP está registrado pero en «${status.status}». Revisa el bloque y reinicia opencode.`
    }
    return
  }

  // 4. Contexto y memoria.
  state.contextMd = await memory.getContextMd(state.site.host)
  state.memory = await memory.getMemory(state.site.host)
  const guardado = await getIndex(state.site.host)
  state.index = guardado.index
  if (guardado.stale) {
    log.warn('Índice descartado', 'era de una versión anterior de Faro; hay que reconstruir el contexto')
  }
  state.sessionID = await getSessionId(state.site.host)

  const site = await getSite(state.site.host)
  if (!site?.onboarded) {
    hideScreens()
    showContextScreen()
    return
  }

  hideScreens()
  await restoreConversation()

  // Sin ruido: si falta el permiso, se avisa cuando de verdad hace falta
  // (al ofrecer navegación), no nada más abrir el panel.
  await ensureContentAccess({ announce: false })
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
 * @returns {Promise<{ok:true}|{ok:false, denied:true}|{ok:false, error:string}>}
 */
async function requestHostPermission() {
  const pattern = state.site.origin.replace(/\/+$/, '') + '/*'
  const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false)
  if (!granted) {
    log.warn('Permiso de host denegado', state.site.host)
    return { ok: false, denied: true }
  }
  const r = await chrome.runtime
    .sendMessage({ type: MSG.REQUEST_HOST_PERMISSION, origin: state.site.origin, tabId: state.tabId })
    .catch(() => null)
  if (r?.ok) {
    log.ok('Permiso concedido', state.site.host)
    return { ok: true }
  }
  return { ok: false, error: r?.error || 'motivo desconocido' }
}

function manualPermissionText() {
  return (
    'No se concedió. Si no llegó a salir el diálogo, dalo a mano: chrome://extensions → Faro → ' +
    'Detalles → Acceso al sitio → «En sitios específicos», y añade ' +
    state.site.origin +
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

async function restoreConversation() {
  el.chat.textContent = ''
  state.turns = []

  if (state.sessionID) {
    try {
      const messages = await state.client.listMessages(state.sessionID)

      // opencode parte un turno en varios mensajes del asistente —uno por
      // cada vuelta de herramientas—. Se juntan por turno, como hace runTurn
      // en vivo: si no, la prosa numerada y su bloque de anclas podían quedar
      // en burbujas distintas y el bloque perderse.
      let ultimoAnalisis = null
      const burbujas = []
      let turno = null
      let urlDelTurno = ''
      let baseDelTurno = null
      const cerrarTurno = () => {
        if (!turno) return
        // Un análisis cierra con su bloque JSON de anclas: no es para leerlo.
        // Las marcas no se rehacen solas al restaurar —vivían en la página
        // donde se hicieron—, pero las anclas se guardan para poder volver a
        // ponerlas con un clic.
        const { prose, anchors } = splitAnchorsBlock(turno.textos.join('\n\n'))
        if (prose) {
          const bubble = addAssistantMessage(prose)
          state.turns.push({ role: 'assistant', text: prose })
          burbujas.push({ prose, bubble })
          if (anchors && numberedIn(prose).length) {
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
          if (!text.trim()) continue
          // En opencode quedó guardado con el fragmento señalado por delante;
          // aquí se enseña sólo la pregunta, y una nota de que iba acompañada.
          // La página en bloques viajó en el sistema de ese mensaje: se dice
          // igual, que estuvo ahí.
          const limpio = stripSelectionBlock(text)
          const conPagina = String(m.info.system || '').includes(PAGE_OPEN)
          addUserMessage(
            limpio,
            [
              limpio === text ? '' : 'con una selección de la página',
              conPagina ? 'con el texto de la página' : '',
              baseDelTurno ? sourcesNote(baseDelTurno) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          )
          state.turns.push({ role: m.info.role, text: limpio })
          continue
        }

        if (!text.trim()) continue
        if (!turno) turno = { textos: [], url: urlDelTurno, conBase: (baseDelTurno?.count || 0) > 0 }
        turno.textos.push(text)
      }
      cerrarTurno()

      // Si hay marcas en la página —el chat se repinta al cerrar Ajustes, al
      // reindexar…—, la tarjeta viva se vuelve a pintar bajo la respuesta de
      // la que salieron (o bajo la última, si aquélla ya no está). Si no hay
      // marcas, la atenuada del último análisis con anclas, con su botón.
      if (state.notes.length && state.notesResult) {
        const { prose, filas, placed, missed, detail, conBase } = state.notesResult
        const misma = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim()
        const dueña = burbujas.find((b) => misma(b.prose, prose)) || burbujas[burbujas.length - 1]
        if (dueña) {
          state.noteRows = new Map()
          state.notesCard = attachToBubble(dueña.bubble, notesCard(filas, placed, missed, detail, { conBase }))
        }
      } else if (ultimoAnalisis) {
        attachToBubble(ultimoAnalisis.bubble, staleNotesCard(ultimoAnalisis))
      }
    } catch {
      state.sessionID = null
    }
  }

  if (!el.chat.children.length) showWelcome()
  scrollChat()
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

  const suggestions = document.createElement('div')
  suggestions.className = 'suggestions'
  for (const s of suggestionsFor(state.site)) {
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
  el.chat.appendChild(wrap)
}

function suggestionsFor(site) {
  if (site?.product === 'confluence') {
    return [
      '¿De qué trata este espacio?',
      '¿Dónde está documentado el proceso de despliegue?',
      'Resume la página en la que estoy',
    ]
  }
  return [
    '¿En qué está trabajando el equipo este sprint?',
    '¿Qué convenciones sigue este proyecto para los tickets?',
    'Enséñame las incidencias abiertas más antiguas',
  ]
}

/**
 * @param {string} text lo que escribió el usuario
 * @param {string} [nota] qué acompañaba a la pregunta, si acompañaba algo
 */
function addUserMessage(text, nota) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'msg user'
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
  return d
}

function addAssistantMessage(text) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'msg assistant'
  d.appendChild(renderMarkdown(text, { onLink: openUrl, onNote: focusNote }))
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
}

function showNotice(text, bad = false) {
  clearEmpty()
  const d = document.createElement('div')
  d.className = 'notice' + (bad ? ' bad' : '')
  d.textContent = text
  el.chat.appendChild(d)
  scrollChat()
  return d
}

function scrollChat() {
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
  const pageIdAlPedir = state.site.pageId || currentPageId(state.index, state.tabUrl) || ''
  const tituloAlPedir = state.tabTitle
  const tabUrlAlPedir = state.tabUrl
  const mcpAlPedir = state.mcpConnected

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

  try {
    // En el modo Análisis la página viaja en el prompt, troceada en bloques
    // numerados: es lo que el modelo señala y contra lo que después se
    // subraya. Se lee ANTES de mandar nada, y se dice debajo de la pregunta:
    // mandar contexto sin que se vea sería mandarlo a espaldas de quien
    // pregunta.
    const lectura = skill === 'analisis' ? await readPageDigest() : { digest: null, reason: '' }
    const digest = lectura.digest

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
        digest ? `con el texto de la página (${digest.count} bloques${digest.truncated ? ', recortado' : ''})` : '',
        sources ? sourcesNote(sources) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    )
    state.lastQuestion = text
    state.turns.push({ role: 'user', text })
    scrollChat()

    if (!state.sessionID) {
      const s = await state.client.createSession({ title: `Faro · ${state.site.host}` })
      state.sessionID = s.id
      await setSessionId(state.site.host, s.id)
    }
    if (abort.signal.aborted) return

    const bubble = document.createElement('div')
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

    // Por runTurn y no a mano: trae el vigilante de turnos colgados y junta las
    // partes de TODOS los mensajes del turno, no solo del ultimo.
    const turn = await state.client.runTurn(
      state.sessionID,
      {
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
          sources,
        }),
      },
      {
        signal: abort.signal,
        stallMs: 90000,
        onUpdate: (t) => paintTurn(t, toolsBox, body),
      }
    )

    const tracker = { ...turn, rawError: turn.rawError, model: turn.model }

    if (turn.stalled) {
      log.error('Turno colgado', modelKey(state.model))
      toolsBox.remove()
      body.textContent = ''
      body.appendChild(errorNode(
        'El modelo dejó de responder y no ha terminado nunca. No todos los de la lista son fiables.',
        { ...tracker, rawError: { name: 'APIError', data: { message: 'stalled' } } },
        text
      ))
      return
    }

    if (turn.aborted) {
      toolsBox.remove()
      body.textContent = ''
      body.appendChild(noticeNode('Turno cancelado.'))
      return
    }

    if (!turn.ok) {
      log.error('Turno fallido', turn.error)
      toolsBox.remove()
      body.textContent = ''
      body.appendChild(errorNode(turn.error, tracker, text))
      return
    }

    // En el modo Análisis la respuesta cierra con un bloque JSON de anclas que
    // no es para el usuario: se separa de la prosa y va a marcar la página.
    const { prose, anchors } = splitAnchorsBlock(turn.text)
    const answer = prose.trim()
    if (!answer) {
      body.textContent = ''
      body.appendChild(noticeNode('El modelo no devolvió texto.', true))
      return
    }

    state.turns.push({ role: 'assistant', text: answer })
    paintTurn(turn, toolsBox, body, true)
    log.ok('Respuesta recibida', `${answer.length} caracteres · ${turn.tools.length} herramientas`)

    // Con páginas base: si no había quien las leyera, o si en alcance
    // exclusivo el modelo consultó fuera de la lista, se dice bajo la
    // respuesta. Con lo capturado al mandar, no con el estado de ahora.
    warnAboutSources(turn.parts, bubble, {
      sources,
      pageId: pageIdAlPedir,
      title: tituloAlPedir,
      pageUrl: digest?.url || tabUrlAlPedir,
      mcpConnected: mcpAlPedir,
    })

    // El modelo que acaba de funcionar se recuerda para este sitio: si el
    // proveedor por defecto está caducado, no hay que volver a tropezar.
    if (state.site && state.model) await saveSite(state.site.host, { model: state.model })

    // Enriquecer el índice con lo que las herramientas acaban de devolver.
    await growIndex(turn.parts)

    // Y con la estructura del árbol que se ve en la barra lateral: es exacta,
    // es gratis, y es justo por donde va a ir la navegación asistida.
    await growTreeFromPage()

    // Y, si procede, ofrecer llevar al usuario allí.
    await offerNavigation(answer, bubble, skill)

    // O, en el modo Análisis, subrayar en la página de qué habla cada punto.
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
    })
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showNotice(err instanceof OpencodeError ? err.message : 'Fallo enviando: ' + err.message, true)
    }
  } finally {
    // Sin esto, un fallo a mitad de turno dejaría un tracker huérfano
    // recibiendo eventos de la sesión para siempre.
    state.tracker = null
    if (state.turnToken === testigo) {
      state.turnToken = null
      setStreaming(false)
    }
    scrollChat()
  }
}

function paintTurn(tracker, toolsBox, body, final = false) {
  const tools = tracker.tools
  toolsBox.textContent = ''
  for (const t of tools) {
    const row = document.createElement('div')
    row.className = 'tool' + (t.status === 'completed' ? ' done' : '')
    const dot = document.createElement('span')
    dot.className = 'tdot'
    const label = document.createElement('span')
    label.textContent = t.title || prettyTool(t.tool)
    row.append(dot, label)
    toolsBox.appendChild(row)
  }
  if (final && tools.length) {
    // Al terminar, la actividad de herramientas se pliega a una línea sobria.
    toolsBox.textContent = ''
    const row = document.createElement('div')
    row.className = 'tool done'
    const dot = document.createElement('span')
    dot.className = 'tdot'
    const label = document.createElement('span')
    label.textContent = `${tools.length} consulta${tools.length === 1 ? '' : 's'} a Atlassian`
    row.append(dot, label)
    toolsBox.appendChild(row)
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
    body.appendChild(renderMarkdown(prose, { onLink: openUrl, onNote: focusNote }))
  }
  scrollChat()
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
  log.ok('Página leída en bloques', `${r.count} bloques · ${r.chars} caracteres${r.truncated ? ' · recortada' : ''}`)
  return { digest: r, reason: '' }
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
  scrollChat()
  return node
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

async function growIndex(parts) {
  if (!state.site) return
  const { index, added } = harvestIndex(parts || [], { site: state.site, index: state.index })
  if (added > 0) {
    state.index = index
    await saveIndex(state.site.host, index)
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
  await saveIndex(state.site.host, merged)
  if (ganados > 0) log.ok('Árbol leído de la página', `+${ganados} relaciones · ${snap.scanned} filas`)
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
 * @param {{sources: object|null, pageId?: string, title?: string, pageUrl?: string, mcpConnected?: boolean}} extra
 *        las páginas base con las que se mandó; la página abierta entonces (id,
 *        título de la pestaña y URL); y si había MCP entonces
 */
function warnAboutSources(parts, bubble, { sources, pageId = '', title = '', pageUrl = '', mcpConnected = true } = {}) {
  if (!sources) return

  if (sources.pages.length && !mcpConnected) {
    log.warn('Páginas base sin leer', 'este sitio no tiene el MCP conectado')
    attachToBubble(
      bubble,
      noticeNode(
        'Las páginas base no se han podido leer: este sitio no tiene el MCP conectado, así que el análisis sale sólo de la página abierta. Configúralo en Ajustes → Cambiar las claves.',
        true
      )
    )
  }

  if (sources.mode !== 'exclusive') return
  // El título de la pestaña lleva el sufijo de Confluence («… - Espacio -
  // Confluence») y el modelo lee por título exacto: valen sus variantes.
  const fuera = consultedOutside(parts, {
    allowed: [pageId, ...sources.pages.map((p) => p.id)],
    allowedTitles: [...titlesFromTab(title), ...sources.pages.map((p) => p.title)],
    pageUrl,
  })
  if (!fuera.length) return

  log.warn('Fuera del alcance', fuera.join(' · '))
  attachToBubble(
    bubble,
    noticeNode(
      `El alcance era sólo la página abierta${sources.pages.length ? ' y las páginas base' : ''}, pero el modelo consultó además ${fuera.join(', ')}. ` +
        'Tenlo en cuenta al leer la respuesta: el alcance se le pide, no se le impone, y otro modelo suele respetarlo mejor.'
    )
  )
}

// ------------------------------------------------------------- navegación

async function offerNavigation(answer, bubble, skillId = state.skill) {
  const skill = skillById(skillId)

  // Resumir o analizar lo que ya tienes delante no es ir a ningún sitio, y una
  // tarjeta que ofrece un viaje ahí sólo estorba.
  if (!skill.offersNavigation) return

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
    onIndex: async (enriquecido) => {
      state.index = enriquecido
      await saveIndex(state.site.host, enriquecido)
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
  { skill = state.skill, anchors = null, digest = null, digestReason = '', urlAlPedir = '', signal = null, conBase = false } = {}
) {
  if (skill !== 'analisis') return
  if (!state.site || !state.tabId || !state.client) return
  if (signal?.aborted) return

  // Un análisis nuevo numera desde el 1. Lo demás es una respuesta de
  // seguimiento —«amplía el punto 3»—, traiga o no anclas: las marcas que hay
  // se conservan, sus pastillas siguen llevando a ellas, y no se gasta una
  // segunda pasada en buscarle sitio a un punto que ya lo tiene.
  const numeros = numberedIn(answer)
  const analisisNuevo = numeros[0] === 1
  if (!analisisNuevo && state.notes.length) {
    log.info(
      'Marcas conservadas',
      numeros.length ? 'la respuesta cita observaciones sueltas; las marcas que hay se quedan' : 'la respuesta no numera nada; las marcas que hay se quedan'
    )
    return
  }

  // Sin números no hay nada que anclar. Pasa con los modelos pequeños, que se
  // saltan el formato que se les pide; se dice, porque desde fuera es
  // indistinguible de que Faro no funcione.
  if (!numeros.length) {
    log.info('Sin marcas', 'la respuesta no trae observaciones numeradas')
    attachToBubble(
      bubble,
      noticeNode('Este modelo no ha numerado sus observaciones, así que no hay nada que subrayar en la página.')
    )
    return
  }

  // Números sueltos sin un análisis del que vengan: no hay nada que marcar, y
  // se dice, porque desde fuera parecería que Faro se ha olvidado.
  if (!analisisNuevo) {
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
          : 'No he podido leer el texto de esta página, así que el análisis se queda sin marcar. Recarga la pestaña y vuelve a pedirlo.',
        !editando
      )
    )
    return
  }

  // Lo normal: las anclas venían en la respuesta. Sólo pasan los números que
  // de verdad aparecen en ella, y cada bloque se comprueba contra la lista que
  // se le enseñó al modelo.
  let notes = anchors ? validateNotes(anchors, { allowed: numeros, blocks: digest.blocks }) : []
  if (anchors) {
    const sobran = surplusNumbers(anchors, numeros)
    if (sobran.length) log.warn('Marcas sobrantes', `el bloque JSON trae ${sobran.join(', ')} y la respuesta no`)
  }
  if (notes.some((x) => x.anchor)) {
    log.ok('Anclas en la respuesta', `${notes.filter((x) => x.anchor).length} de ${numeros.length} observaciones`)
  } else {
    log.info('Sin bloque de anclas', anchors ? 'venía, pero sin ningún bloque utilizable' : 'la respuesta no lo traía; se pide aparte')
    notes = await secondPassNotes(answer, digest, signal)
    if (signal?.aborted) return
    if (!notes.some((x) => x.anchor)) {
      log.info('Sin marcas', 'ninguna observación apunta a un bloque de la página')
      attachToBubble(
        bubble,
        noticeNode(
          'No he sabido situar en la página ninguna de las observaciones: se marcan sólo las que apuntan a un bloque del texto.'
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
    attachToBubble(bubble, noticeNode('Has cambiado de página, así que no he marcado nada.'))
    return
  }

  // A la página sólo van las que tienen ancla. La tarjeta, en cambio, lista
  // TODOS los números de la respuesta: las que el JSON no trajo, en gris y con
  // la frase que las abre, para que la lista sea la del chat y no la del JSON.
  const anclables = notes.filter((x) => x.anchor)
  const filas = numeros.map(
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
  state.notesResult = { prose: answer, filas, placed, missed, detail, conBase }
  state.notesCard = attachToBubble(bubble, notesCard(filas, placed, missed, detail, { conBase }))

  log.ok(
    'Análisis marcado',
    `${placed.length} de ${numeros.length} en la página` +
      (detail.length ? ' · ' + detail.map((d) => `${d.n}:${d.strategy}`).join(' ') : '')
  )
  if (missed.length) log.warn('Sin anclar', 'observaciones ' + missed.join(', '))
}

/**
 * La lista numerada, para poder saltar de una observación a su subrayado.
 *
 * Con páginas base, una observación sin pasaje no habla necesariamente «de la
 * página en general»: lo normal es que hable de una página base, que no se
 * subraya porque sólo se marca la abierta. La fila lo dice así.
 *
 * @param {{conBase?: boolean}} [opts] si el turno llevaba páginas base
 */
function notesCard(notes, placed, missed, detail = [], { conBase = false } = {}) {
  const card = document.createElement('div')
  card.className = 'nav-card notes-card'

  const kicker = document.createElement('div')
  kicker.className = 'nav-kicker'
  kicker.textContent = 'Marcado en la página'
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
        ? 'Una no la he sabido situar en la página; la dejo sin marcar antes que marcarla mal.'
        : `${missed.length} no las he sabido situar en la página; las dejo sin marcar antes que marcarlas mal.`
    )
  }
  if (sinAncla) {
    avisos.push(
      conBase
        ? sinAncla === 1
          ? 'Una no apunta a un pasaje de esta página: habla de ella en general o de una página base.'
          : `${sinAncla} no apuntan a un pasaje de esta página: hablan de ella en general o de una página base.`
        : sinAncla === 1
          ? 'Una habla de la página en general y no tiene pasaje que marcar.'
          : `${sinAncla} hablan de la página en general y no tienen pasaje que marcar.`
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

    cuerpo.append(titulo, cita)
    row.append(num, cuerpo)

    if (puesta) row.addEventListener('click', () => focusNote(nota.n))
    list.appendChild(row)
    state.noteRows.set(nota.n, row)
  }

  card.appendChild(list)

  const actions = document.createElement('div')
  actions.className = 'nav-actions'
  const quitar = document.createElement('button')
  quitar.className = 'ghost'
  quitar.type = 'button'
  quitar.textContent = 'Quitar las marcas'
  quitar.addEventListener('click', () => clearNotes())
  actions.appendChild(quitar)
  card.appendChild(actions)

  return card
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
      question: state.lastQuestion,
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
  const numeros = numberedIn(prose)
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

  const numeros = numberedIn(prose)
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
  state.notesResult = { prose, filas, placed, missed: res?.missed || [], detail: res?.detail || [], conBase }
  card.remove()
  state.notesCard = attachToBubble(bubble, notesCard(filas, placed, res?.missed || [], res?.detail || [], { conBase }))
  log.ok('Análisis marcado de nuevo', `${placed.length} de ${anclables.length} en la página`)
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
  kicker.textContent = 'Puedo llevarte'
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

  const res = await chrome.runtime.sendMessage({ type, tabId: state.tabId, plan }).catch((e) => ({
    ok: false,
    error: String(e?.message || e),
  }))

  if (res?.ok) {
    log.ok('Navegación lanzada', `${mode} · ${plan.destination.title} · ${plan.destination.url}`)
  } else {
    log.error('Navegación fallida', res?.error || 'sin respuesta')
    card.appendChild(noticeNode('No he podido navegar: ' + (res?.error || 'sin respuesta'), true))
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

  el.sources.classList.toggle('hidden', !analisis)
  el.sources.classList.toggle('on', analisis && activo)
  el.sources.title = activo ? sourcesLabel(s) : 'Páginas base del análisis'
  el.sourcesCount.textContent = n ? String(n) : ''
  el.sourcesCount.classList.toggle('hidden', !n)

  const label = analisis ? sourcesLabel(s) : ''
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
  showScreen('screen-sources')
  $('sources-query').focus()

  // Las páginas base son de Confluence: desde Jira, según el despliegue, se
  // pueden buscar (Cloud comparte host) o sólo pegar por id (Data Center).
  if (state.site.product === 'jira') {
    setSourcesStatus(
      state.site.cloud
        ? 'Las páginas base son páginas de Confluence de este mismo sitio.'
        : 'Las páginas base son de Confluence; desde este Jira no puedo buscarlas ni comprobar una URL: pega el id numérico de la página.'
    )
  }

  // Sin permiso sobre el dominio no hay content script, y sin él no se puede
  // preguntar a Confluence: queda el índice, y se ofrece el permiso AQUÍ,
  // porque la tarjeta del chat queda tapada por esta pantalla.
  const puede = await ensureContentAccess({ announce: false })
  if (!puede) {
    $('sources-perm').classList.remove('hidden')
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

/**
 * Lo que escribe el usuario en el campo único. Una URL o un id no se buscan:
 * se resuelven, o se explica por qué no valen. Lo demás es una búsqueda: al
 * instante en el índice y, tras una pausa, en Confluence.
 */
function onSourcesInput() {
  clearTimeout(state.sourcesSearch.timer)
  state.sourcesSearch.token++
  const text = $('sources-query').value
  // La pestaña ha podido salir de Atlassian con la pantalla abierta.
  if (!state.site) {
    clearSourceSuggestions()
    setSourcesStatus('Abre una página de Confluence y vuelve.')
    return
  }

  const ref = pageRefFromUrl(text, state.site)
  if (ref.ok) {
    paintSuggestions([{ id: ref.id, title: `Añadir la página ${ref.id}`, path: ref.path, spaceKey: null, source: 'add' }])
    setSourcesStatus(state.index?.pages?.[ref.id] ? `Es «${state.index.pages[ref.id].title}».` : 'Intro para añadirla; el título se lee de Confluence.')
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
  const local = suggestFromIndex(state.index, q, { limit: SOURCE_LIMITS.suggestions, exclude })
  paintSuggestions(local)
  setSourcesStatus(local.length ? '' : 'Nada en el índice con ese título.')
  state.sourcesSearch.timer = setTimeout(
    () => searchSourcesRemote(q, local, exclude).catch(console.error),
    SOURCE_LIMITS.searchDebounceMs
  )
}

function refReasonText(reason, text) {
  if (reason === 'otro-sitio') {
    const host = hostOf(text.trim())
    return `Esa página es de ${host || 'otro sitio'} y estás en ${state.site?.host || 'otro'}: sólo valen páginas de este sitio.`
  }
  if (reason === 'jira') return 'Eso es una incidencia de Jira, no una página de Confluence.'
  return 'Esa dirección no lleva el id de la página (las de tipo /display/ESPACIO/Título no lo llevan). Ábrela y copia la URL con /pages/<número>, o pega el número.'
}

/**
 * La búsqueda en Confluence, con la sesión del navegador y desde el content
 * script. Con testigo: si el usuario ha seguido escribiendo, la respuesta
 * llega tarde y se tira. Lo que vuelve se funde con lo del índice.
 */
async function searchSourcesRemote(q, local, exclude) {
  const token = state.sourcesSearch.token
  if (!state.site || state.tabId == null) return
  if (!(await ensureContentAccess({ announce: false }))) return
  if (token !== state.sourcesSearch.token) return

  setSourcesStatus('Buscando en Confluence…')
  const r = await chrome.tabs
    .sendMessage(state.tabId, {
      type: MSG.PAGE_SEARCH,
      query: q,
      wikiPrefix: wikiPrefixOf(state.site),
      cloud: state.site.cloud,
      limit: SOURCE_LIMITS.suggestions,
    })
    .catch(() => null)
  if (token !== state.sourcesSearch.token) return

  if (!r?.ok) {
    log.warn('Búsqueda de páginas', r?.reason || 'la pestaña no contestó')
    setSourcesStatus(searchFailText(r) + (local.length ? ' Mientras, sólo busco en lo indexado.' : ''))
    return
  }

  const merged = mergeSuggestions(local, r.pages, { limit: SOURCE_LIMITS.suggestions, exclude, host: state.site.host })
  paintSuggestions(merged)
  setSourcesStatus(merged.length ? '' : 'Nada con ese título. Prueba con otra palabra o pega su URL.')
  log.debug('Búsqueda de páginas', `«${q}» · ${r.pages.length} de Confluence · API ${r.via} · ${r.ms} ms`)
}

function searchFailText(r) {
  const status = Number(r?.status) || 0
  if (status === 401 || status === 403 || /JSON/.test(String(r?.reason || ''))) {
    return 'Tu sesión de Confluence no vale para su API: recarga la pestaña y vuelve a entrar.'
  }
  return 'No he podido preguntarle a Confluence: ' + (r?.reason || 'la pestaña no contestó') + '.'
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
        : [s.spaceKey, `id ${s.id}`, s.source === 'confluence' ? 'desde Confluence' : 'en el índice'].filter(Boolean).join(' · ')

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
 * Esc quita las sugerencias y, si no había, cierra como «Listo».
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
  if (ev.key === 'Escape') {
    ev.preventDefault()
    if (suggestions.length) {
      clearSourceSuggestions()
      return
    }
    closeSourcesScreen()
  }
}

async function chooseSuggestion(s) {
  if (s.source === 'add') return addSourceById(s.id, s.path)
  return addSource({ id: s.id, title: s.title, path: s.path, spaceKey: s.spaceKey }, { from: s.source })
}

/**
 * Una página por su id (URL pegada o número suelto): el título sale del
 * índice si la conoce y, si no, de la API del sitio —la misma petición que
 * lee el camino, que devuelve la propia página al final de la cadena—. Sin
 * quien la lea, se añade por su id, que es lo que el modelo necesita, y se
 * dice. Un 404 no se añade: no hay página.
 */
async function addSourceById(id, path = '') {
  if (!state.site) return
  const conocida = state.index?.pages?.[id]
  if (conocida) {
    return addSource({ id, title: conocida.title, path: conocida.path || path, spaceKey: conocida.spaceKey }, { from: 'index' })
  }

  // Desde un Jira Data Center la API de Confluence no está en este origen:
  // preguntarle daría un 404 que no significa «no hay página». Se añade por
  // su id, que es lo que la pantalla prometió.
  if (state.site.product === 'jira' && !state.site.cloud) {
    log.warn('Página base sin título', `${id} · desde Jira no se puede leer`)
    await addSource({ id, title: '', path }, { from: 'id' })
    setSourcesStatus(`Añadida por su id ${id}: desde este Jira no puedo leer su título.`)
    return
  }

  // La comprobación tarda: si mientras tanto la pestaña se va a otro sitio,
  // lo que vuelva no es de aquí.
  const host = state.site.host
  setSourcesStatus(`Comprobando la página ${id} en Confluence…`)
  const r = await fetchPageChain(id)
  if (state.site?.host !== host) return
  if (r.ok && r.pages?.length) {
    const propia = r.pages[r.pages.length - 1]
    await mergePagesIntoIndex(r.pages)
    return addSource({ id, title: propia.title, path: propia.url || path, spaceKey: propia.spaceKey }, { from: 'confluence' })
  }
  if (r.status === 404) {
    log.warn('Página base', `id ${id} · la API respondió 404`)
    setSourcesStatus(`Confluence no encuentra ninguna página con el id ${id}.`)
    return
  }
  log.warn('Página base sin título', `${id} · ${r.reason}`)
  await addSource({ id, title: '', path }, { from: 'id' })
  setSourcesStatus(`Añadida por su id ${id}: no he podido leer su título (${r.reason}).`)
}

/** La cadena de una página por la API del sitio, vía content script. Nunca lanza. */
async function fetchPageChain(id) {
  if (!state.site || state.tabId == null) return { ok: false, reason: 'sin pestaña' }
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

async function addSource(page, { from = 'index' } = {}) {
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
  if (from === 'confluence') await mergePagesIntoIndex([page])

  const añadida = state.sources.pages[state.sources.pages.length - 1]
  log.ok(
    'Página base añadida',
    `${añadida.title} (id ${añadida.id}) · ${from === 'index' ? 'del índice' : from === 'confluence' ? 'de Confluence' : 'por su id'}`
  )
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
  $('sources-query').focus()
}

async function removeSource(id) {
  if (!state.site) return
  const antes = state.sources.pages.find((p) => p.id === String(id))
  state.sources = removeSourcePage(state.sources, id)
  paintSourceList()
  paintSourcesUi()
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
  hideScreens()
  paintSourcesUi()
  el.input.focus()
}

function onRuntimeMessage(msg) {
  if (msg?.type === MSG.NOTE_CLICKED) {
    // Han pulsado el número en la página: se marca la fila del chat y se sube
    // hasta ella. Los dos sentidos, con el mismo número.
    markNoteRow(msg.n)
    state.noteRows.get(msg.n)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
    if (msg.result?.needsPermission) {
      log.error('Navegación detenida', 'sin permiso de host')
      showPermissionNotice()
    } else if (msg.result?.error) {
      log.error('Navegación detenida', msg.result.error)
      showNotice(msg.result.error, true)
    } else if (msg.result?.anchored) log.ok('Fragmento resaltado', msg.result.strategy)
    else if (msg.result?.cancelled) log.info('Navegación cancelada')
    else if (msg.result?.message) log.warn('Sin resaltar', msg.result.message)
    if (msg.result?.anchored === false && msg.result?.message) showNotice(msg.result.message)
  }
}

function openUrl(href) {
  chrome.tabs.create({ url: href }).catch(() => {})
}

// ------------------------------------------------------------- pantallas

function showScreen(id, extra) {
  hideScreens()
  const screen = $(id)
  screen?.classList.remove('hidden')

  if (id === 'screen-connect') {
    $('connect-cmd').textContent = connectCommand()
    $('server-url').value = state.settings.serverUrl
    $('server-pass').value = state.settings.password
    $('connect-error').textContent = extra ? String(extra).slice(0, 160) : ''
  }
}

function hideScreens() {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'))
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

function showSetupScreen() {
  state.mcpWait?.abort()
  $('setup-host').textContent = state.site.host
  $('setup-dc-field').classList.toggle('hidden', !!state.site.cloud)
  $('setup-dc').checked = !state.site.cloud
  $('setup-status').textContent = ''
  $('setup-manual').classList.add('hidden')
  $('setup-main').classList.remove('hidden')
  showScreen('screen-setup')
}

async function copyToClipboard(text, buttonId) {
  const btn = $(buttonId)
  const original = btn?.textContent
  try {
    await navigator.clipboard.writeText(text)
    if (btn) btn.textContent = 'Copiado'
  } catch {
    if (btn) btn.textContent = 'No se pudo'
  }
  if (btn) setTimeout(() => (btn.textContent = original), 1400)
}

function showContextScreen() {
  const scope = defaultScope(state.site)
  $('context-scope').textContent = scope?.label || state.site.host
  $('context-status').textContent = ''
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
  state.logUnsub = log.subscribe(() => {
    if (!$('screen-log').classList.contains('hidden')) paintLog()
  })
  showScreen('screen-log')
}

function paintLog() {
  const box = $('log-body')
  box.textContent = ''
  const entries = state.logOnlyProblems ? log.filter('warn') : log.entries
  for (const e of entries.slice(-200).reverse()) {
    const row = document.createElement('div')
    row.className = 'logrow ' + e.level

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
    box.appendChild(row)
  }
  $('btn-log-all').classList.toggle('on', !state.logOnlyProblems)
  $('btn-log-problems').classList.toggle('on', !!state.logOnlyProblems)
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
  add('memoria', state.settings.crossSessionMemory ? `activa · ${state.memory?.entries?.length || 0} entradas` : 'desactivada')

  if (state.client && state.site) {
    try {
      const list = await state.client.listMcp()
      const s = mcpStatusFor(list, state.site.host)
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
  $('set-url').value = state.settings.serverUrl
  $('set-pass').value = state.settings.password
  $('settings-status').textContent = ''
  $('settings-site-info').textContent = state.site
    ? `${state.site.host} · ${state.index ? indexSize(state.index) + ' entradas indexadas' : 'sin índice'} · ${state.contextMd ? 'con contexto' : 'sin contexto'}`
    : 'sin sitio'
  showScreen('screen-settings')
}

// ------------------------------------------------------------------ acción

function setStatus(kind, text) {
  el.statusDot.className = 'dot ' + kind
  el.statusText.textContent = text
}

function setStreaming(on) {
  state.streaming = on
  el.send.classList.toggle('hidden', on)
  el.stop.classList.toggle('hidden', !on)
  el.input.disabled = false
  // El modo se decide al mandar: cambiarlo a mitad de turno dejaría lo que
  // viene después —marcar, ofrecer llevarte— hablando de otro modo.
  el.skill.disabled = on
  setStatus(on ? 'busy' : state.client?.connected ? 'ok' : 'bad', on ? 'pensando…' : state.client?.connected ? 'conectado' : 'sin conexión')
}

function showBusy(title, text) {
  el.busyTitle.textContent = title
  el.busyText.textContent = text || ''
  el.busy.classList.remove('hidden')
}

function hideBusy() {
  el.busy.classList.add('hidden')
}

function autoGrow() {
  el.input.style.height = 'auto'
  el.input.style.height = Math.min(160, el.input.scrollHeight) + 'px'
}

function applySettingsToUi() {
  el.memoryToggle.classList.toggle('on', !!state.settings.crossSessionMemory)
  el.memoryLabel.textContent = state.settings.crossSessionMemory ? 'Memoria activa' : 'Memoria'
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
  $('btn-sources-permission').addEventListener('click', async () => {
    const btn = $('btn-sources-permission')
    btn.disabled = true
    const r = await requestHostPermission()
    btn.disabled = false
    if (r.ok) {
      $('sources-perm').classList.add('hidden')
      setSourcesStatus('Listo. Ya puedo buscar en Confluence.')
      onSourcesInput()
    } else {
      setSourcesStatus(r.denied ? manualPermissionText() : 'Permiso dado, pero no he podido inyectarme: ' + r.error)
    }
  })

  el.memoryToggle.addEventListener('click', async () => {
    state.settings = await saveSettings({ crossSessionMemory: !state.settings.crossSessionMemory })
    applySettingsToUi()
  })

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
  $('btn-settings-close').addEventListener('click', async () => {
    state.settings = await saveSettings({
      navMode: $('set-nav-quick').checked ? 'quick' : 'guided',
      reduceMotion: $('set-motion').checked,
      highlightStyle: $('set-hl-marker').checked ? 'marker' : 'spotlight',
      stepDelayMs: Number($('set-delay').value),
      serverUrl: $('set-url').value.trim() || DEFAULT_SETTINGS.serverUrl,
      password: $('set-pass').value,
    })
    applySettingsToUi()
    hideScreens()
    await bootForSite()
  })
  $('btn-reindex').addEventListener('click', async () => {
    hideScreens()
    await generateContext()
  })
  $('btn-edit-keys').addEventListener('click', () => showSetupScreen())
  $('btn-tree-debug').addEventListener('click', () => treeDebug().catch(console.error))
  $('btn-forget').addEventListener('click', async () => {
    if (!state.site) return
    await forgetSite(state.site.host)
    await memory.clearMemory(state.site.host)
    await memory.saveContextMd(state.site.host, '')
    await clearSessionId(state.site.host)
    state.index = null
    state.ancestryFetched = new Map()
    state.contextMd = ''
    state.sessionID = null
    state.sources = emptySources()
    paintSourcesUi()
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
    state.indexingAbort?.abort()
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

  const email = $('setup-email').value.trim()
  const token = $('setup-token').value
  const jira = $('setup-jira').checked
  const confluence = $('setup-confluence').checked
  const dataCenter = $('setup-dc').checked

  status.textContent = 'Preparando la configuración…'

  let result
  try {
    result = await configureMcp(state.client, {
      host: state.site.host,
      origin: state.site.origin,
      email,
      token,
      jira,
      confluence,
      dataCenter,
    })
  } catch (err) {
    status.textContent = 'No he podido configurarlo: ' + (err?.message || err)
    return
  }

  state.pendingMcp = { ...result, jira, confluence }

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

  const waiting = $('setup-waiting')
  waiting.classList.remove('done')
  $('setup-waiting-text').textContent = 'Esperando a que opencode cargue el MCP…'

  state.mcpWait?.abort()
  const controller = new AbortController()
  state.mcpWait = controller

  const status = await waitForMcpReady(state.client, state.site.host, {
    timeoutMs: 15 * 60 * 1000,
    signal: controller.signal,
    onTick: (s, left) => {
      $('setup-waiting-text').textContent =
        s.present && s.status
          ? `El MCP está en «${s.status}»…`
          : `Esperando a que opencode cargue el MCP… (${Math.round(left / 1000)} s)`
    },
  })

  if (controller.signal.aborted) return

  if (!status.connected) {
    $('setup-waiting-text').textContent = 'Sigo sin verlo. Comprueba que pegaste el bloque y reiniciaste opencode.'
    return
  }

  waiting.classList.add('done')
  $('setup-waiting-text').textContent = 'MCP conectado. Comprobando las claves…'
  await finishSetup()
}

/** Con el MCP ya disponible, se comprueba que el token sirve de verdad. */
async function finishSetup() {
  const { jira, confluence, name } = state.pendingMcp || {}
  const status = $('setup-status')
  const waitingText = $('setup-waiting-text')
  const say = (t) => {
    status.textContent = t
    waitingText.textContent = t
  }

  say('Comprobando que las claves valen…')

  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · comprobación' })
    const check = await verifyCredentials(state.client, {
      sessionID: session.id,
      model: state.model,
      host: state.site.host,
      jira,
      confluence,
    })

    if (!check.ok) {
      say(
        check.reason === 'sin-herramientas'
          ? 'El MCP aparece conectado pero el modelo no ve sus herramientas. Prueba a reiniciar opencode.'
          : check.detail
      )
      return
    }

    say('Conectado. ' + check.detail)
    log.ok('MCP verificado', check.detail)
    await saveSite(state.site.host, {
      configured: true,
      mcpName: name || mcpNameForHost(state.site.host),
      product: state.site.product,
      cloud: state.site.cloud,
    })
    setTimeout(() => bootForSite(), 800)
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
 * @param {{keepContext?: boolean}} opts keepContext respeta el documento que
 *        trajo el usuario y se queda sólo con el índice de navegación.
 */
async function generateContext({ keepContext = false } = {}) {
  const scope = defaultScope(state.site)
  const controller = new AbortController()
  state.indexingAbort = controller
  hideScreens()
  showBusy(
    keepContext ? 'Construyendo el índice' : 'Levantando el mapa',
    `Recorriendo ${scope?.label || 'esta zona'}…`
  )

  try {
    const { contextMd, index } = await buildContext(state.client, {
      scope,
      site: state.site,
      model: state.model,
      signal: controller.signal,
      onProgress: (t) => (el.busyText.textContent = t),
    })

    if (!keepContext) {
      state.contextMd = contextMd
      await memory.saveContextMd(state.site.host, contextMd)
    }
    state.index = mergeIndex(state.index, index)
    // Lo que el indexador diga de los padres puede venir de un modelo: el
    // camino de cada destino se vuelve a leer de la API la próxima vez.
    state.ancestryFetched = new Map()
    await saveIndex(state.site.host, state.index)
    await saveSite(state.site.host, { onboarded: true, indexedAt: Date.now() })

    hideBusy()
    log.ok('Contexto construido', `${indexSize(state.index)} entradas · ${contextMd.length} caracteres`)
    await restoreConversation()
    showNotice(`Contexto listo: ${indexSize(state.index)} entradas indexadas.`)
  } catch (err) {
    hideBusy()
    if (err?.name === 'AbortError') {
      showNotice('Indexado cancelado. Puedes retomarlo desde ajustes.')
    } else {
      log.error('Indexado fallido', err?.message || String(err))
      showNotice('El indexado falló: ' + (err?.message || err), true)
    }
    await saveSite(state.site.host, { onboarded: true })
    await restoreConversation()
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

  hideScreens()
  await restoreConversation()
  showNotice('Contexto cargado desde ' + file.name + '.')

  // El índice hace falta igual —sin él no hay navegación—, pero el documento
  // que acabas de traer no se toca.
  generateContext({ keepContext: true }).catch(() => {})
}

async function newSession() {
  if (!state.site) return

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
  forgetNotes()
  log.ok('Sesión nueva', state.settings.crossSessionMemory ? 'la anterior quedó resumida' : '')
  state.sessionID = null
  state.turns = []
  el.chat.textContent = ''
  showWelcome()
}
