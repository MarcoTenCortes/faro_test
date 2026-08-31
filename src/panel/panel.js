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
import { parseAtlassianUrl, describeLocation, defaultScope, samePage } from '../atlassian/site.js'
import { mergeIndex, indexSize, normalizeIndex } from '../atlassian/index-store.js'
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
import { buildContext, harvestIndex, mergeTree, countWithParent } from './indexer.js'
import { planNavigation, shouldPlan } from './planner.js'
import { collectNotes, numberedIn } from './notes.js'
import { baseSystem, selectionBlock, stripSelectionBlock } from './prompts.js'
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
  notes: [],
  noteRows: new Map(),
  notesCard: null,
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
  // Las marcas de un análisis son de la página en la que se hicieron. Al
  // cambiar de página dejan de significar nada, aunque la pestaña sea la misma.
  if (state.notes.length && (tab.url || '') !== state.tabUrl) forgetNotes()
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
    const pattern = state.site.origin.replace(/\/+$/, '') + '/*'
    // Se pide AQUÍ: `permissions.request` exige un gesto del usuario, y el
    // gesto no viaja hasta el service worker por sendMessage.
    const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false)
    if (!granted) {
      btn.disabled = false
      // Hay versiones de Chrome donde `permissions.request` no funciona desde
      // el panel lateral. Si pasa, queda la via manual, que siempre vale.
      card.appendChild(
        noticeNode(
          'No se concedió. Si no llegó a salir el diálogo, dalo a mano: chrome://extensions → Faro → ' +
            'Detalles → Acceso al sitio → «En sitios específicos», y añade ' +
            state.site.origin +
            '. Sin permiso sólo puedo llevarte de golpe.',
          true
        )
      )
      log.warn('Permiso de host denegado', state.site.host)
      return
    }
    const r = await chrome.runtime
      .sendMessage({ type: MSG.REQUEST_HOST_PERMISSION, origin: state.site.origin, tabId: state.tabId })
      .catch(() => null)
    if (r?.ok) {
      log.ok('Permiso concedido', state.site.host)
      card.remove()
      showNotice('Listo. Ya puedo resaltar y guiarte paso a paso en ' + state.site.host + '.')
    } else {
      btn.disabled = false
      card.appendChild(noticeNode('Permiso dado, pero no he podido inyectarme: ' + (r?.error || 'motivo desconocido'), true))
    }
  })
  actions.appendChild(btn)

  card.append(kicker, title, text, actions)
  el.chat.appendChild(card)
  scrollChat()
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
      for (const m of messages || []) {
        const text = (m.parts || []).filter((p) => p.type === 'text' && p.text && !p.synthetic).map((p) => p.text).join('')
        if (!text.trim()) continue

        if (m.info.role === 'user') {
          // En opencode quedó guardado con el fragmento señalado por delante;
          // aquí se enseña sólo la pregunta, y una nota de que iba acompañada.
          const limpio = stripSelectionBlock(text)
          addUserMessage(limpio, limpio === text ? '' : 'con una selección de la página')
          state.turns.push({ role: m.info.role, text: limpio })
          continue
        }

        addAssistantMessage(text)
        state.turns.push({ role: m.info.role, text })
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
  addUserMessage(text, pick ? 'con ' + pickLabel(pick).toLowerCase() : '')
  state.lastQuestion = text
  state.turns.push({ role: 'user', text })
  scrollChat()

  setStreaming(true)

  try {
    if (!state.sessionID) {
      const s = await state.client.createSession({ title: `Faro · ${state.site.host}` })
      state.sessionID = s.id
      await setSessionId(state.site.host, s.id)
    }

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
      [`${modelKey(state.model)} · ${text.length} caracteres`, `skill ${state.skill}`, pick ? pickLabel(pick) : '']
        .filter(Boolean)
        .join(' · ')
    )
    state.turnAbort = new AbortController()

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
          skill: state.skill,
        }),
      },
      {
        signal: state.turnAbort.signal,
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

    const answer = turn.text.trim()
    if (!answer) {
      body.textContent = ''
      body.appendChild(noticeNode('El modelo no devolvió texto.', true))
      return
    }

    state.turns.push({ role: 'assistant', text: answer })
    paintTurn(turn, toolsBox, body, true)
    log.ok('Respuesta recibida', `${answer.length} caracteres · ${turn.tools.length} herramientas`)

    // El modelo que acaba de funcionar se recuerda para este sitio: si el
    // proveedor por defecto está caducado, no hay que volver a tropezar.
    if (state.site && state.model) await saveSite(state.site.host, { model: state.model })

    // Enriquecer el índice con lo que las herramientas acaban de devolver.
    await growIndex(turn.parts)

    // Y con la estructura del árbol que se ve en la barra lateral: es exacta,
    // es gratis, y es justo por donde va a ir la navegación asistida.
    await growTreeFromPage()

    // Y, si procede, ofrecer llevar al usuario allí.
    await offerNavigation(answer, bubble)

    // O, en el modo Análisis, subrayar en la página de qué habla cada punto.
    await offerNotes(answer, bubble)
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showNotice(err instanceof OpencodeError ? err.message : 'Fallo enviando: ' + err.message, true)
    }
  } finally {
    // Sin esto, un fallo a mitad de turno dejaría un tracker huérfano
    // recibiendo eventos de la sesión para siempre.
    state.tracker = null
    setStreaming(false)
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

  const text = tracker.text
  if (text) {
    body.textContent = ''
    body.appendChild(renderMarkdown(text, { onLink: openUrl, onNote: focusNote }))
  }
  scrollChat()
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
  const merged = mergeTree(mergeIndex(state.index, arbol), arbol)
  const ganados = countWithParent(merged) - antes
  if (ganados <= 0 && indexSize(merged) === indexSize(state.index)) return

  state.index = merged
  await saveIndex(state.site.host, merged)
  if (ganados > 0) log.ok('Árbol leído de la página', `+${ganados} relaciones · ${snap.scanned} filas`)
}

// ------------------------------------------------------------- navegación

async function offerNavigation(answer, bubble) {
  const skill = skillById(state.skill)

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

  // Sesión aparte y desechable: así el chat no se llena del JSON del
  // planificador ni de sus instrucciones.
  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · planificador' })
  } catch {
    return
  }

  try {
    const { plan, reason } = await planNavigation(state.client, {
      sessionID: session.id,
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
      onIndex: async (enriquecido) => {
        state.index = enriquecido
        await saveIndex(state.site.host, enriquecido)
        log.ok('Jerarquía aprendida', 'ya puedo enseñarte el camino hasta ahí')
      },
    })

    if (!plan) {
      if (reason) log.info('Sin navegación', reason)
      return
    }

    attachToBubble(bubble, navCard(plan))
  } finally {
    state.client.deleteSession(session.id).catch(() => {})
  }
}

/**
 * Subraya en la página los puntos del análisis y los numera.
 *
 * El modelo ya ha numerado sus observaciones en la respuesta; aquí se le pide,
 * en una segunda pasada y con el texto real de la página delante, dónde cae
 * cada número. Es lo que hace que «el punto 3» del chat signifique algo.
 *
 * Cuesta un turno de modelo, así que sólo se hace en el modo Análisis y sólo
 * cuando la respuesta trae números que anclar.
 */
async function offerNotes(answer, bubble) {
  if (state.skill !== 'analisis') return
  if (!state.site || !state.tabId || !state.client) return

  // Sin números no hay nada que anclar. Pasa con los modelos pequeños, que se
  // saltan el formato que se les pide; se dice, porque desde fuera es
  // indistinguible de que Faro no funcione.
  if (!numberedIn(answer).length) {
    log.info('Sin marcas', 'la respuesta no trae observaciones numeradas')
    attachToBubble(
      bubble,
      noticeNode('Este modelo no ha numerado sus observaciones, así que no hay nada que subrayar en la página.')
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

  const pagina = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PAGE_TEXT }).catch(() => null)

  if (!pagina?.ok || !pagina.text) {
    log.warn('Sin marcas', 'no he podido leer el texto de la página')
    attachToBubble(
      bubble,
      noticeNode(
        'No he podido leer el texto de esta página, así que el análisis se queda sin marcar. Recarga la pestaña y vuelve a pedirlo.',
        true
      )
    )
    return
  }

  // La página de la que salió el texto, tal y como la ve la pestaña. No vale
  // `state.tabUrl`: el panel se refresca solo y esa cadena cambia por su cuenta.
  const urlAlPedir = pagina.url || state.tabUrl

  // Sesión aparte y desechable, igual que el planificador: el chat no tiene por
  // qué llenarse del JSON de las citas.
  let session = null
  try {
    session = await state.client.createSession({ title: 'Faro · observaciones' })
  } catch {
    return
  }

  try {
    const { notes, reason } = await collectNotes(state.client, {
      sessionID: session.id,
      model: state.model,
      question: state.lastQuestion,
      answer,
      pageText: pagina.text,
      truncated: pagina.truncated,
    })

    if (!notes.length) {
      if (reason) log.info('Sin marcas', reason)
      attachToBubble(
        bubble,
        noticeNode(
          'No he sabido situar en la página ninguna de las observaciones: se marcan sólo las que puedo citar literalmente del texto.'
        )
      )
      return
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

    const res = await chrome.tabs
      .sendMessage(state.tabId, { type: MSG.ANNOTATE, notes })
      .catch(() => null)

    const placed = res?.placed || []
    const missed = res?.missed || notes.map((x) => x.n)

    forgetNotes({ keepPage: true })
    state.notes = notes
    state.notesCard = attachToBubble(bubble, notesCard(notes, placed, missed))

    log.ok('Análisis marcado', `${placed.length} de ${notes.length} en la página`)
    if (missed.length) log.warn('Sin anclar', 'observaciones ' + missed.join(', '))
  } finally {
    state.client.deleteSession(session.id).catch(() => {})
  }
}

/** La lista numerada, para poder saltar de una observación a su subrayado. */
function notesCard(notes, placed, missed) {
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

  if (missed.length) {
    const text = document.createElement('div')
    text.className = 'nav-text'
    text.textContent =
      missed.length === 1
        ? 'Una no la he sabido situar en la página; la dejo sin marcar antes que marcarla mal.'
        : `${missed.length} no las he sabido situar en la página; las dejo sin marcar antes que marcarlas mal.`
    card.appendChild(text)
  }

  const list = document.createElement('div')
  list.className = 'note-list'

  for (const nota of notes) {
    const puesta = placed.includes(nota.n)

    const row = document.createElement('button')
    row.className = 'note-row' + (puesta ? '' : ' missing')
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
      ? `«${nota.anchor.exact.slice(0, 110)}»`
      : 'no la he encontrado en la página'

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
  $('set-assisted').checked = state.settings.assistedByDefault
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
      assistedByDefault: $('set-assisted').checked,
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
    state.contextMd = ''
    state.sessionID = null
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
