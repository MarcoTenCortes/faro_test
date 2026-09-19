/**
 * El orquestador del service worker, con un `chrome` de mentira.
 *
 * Es la máquina de estados más delicada del proyecto: lleva la cuenta del
 * recorrido mientras la pestaña navega por debajo. Aquí se comprueba sin
 * Chrome, simulando lo que contestaría el content script en cada paso.
 */
import { test, eq, assert } from '../harness.js'
import { MSG } from '../../src/shared/messages.js'
import { NAV_TIMING } from '../../src/shared/config.js'

// El worker registra sus manejadores UNA vez, al importarse. Por eso la lista
// se comparte entre todos los entornos simulados: lo que cambia en cada prueba
// es el `chrome` global que esos manejadores consultan al ejecutarse.
const LISTENERS = []
/**
 * Los oyentes de `chrome.storage.onChanged`, compartidos por el mismo motivo
 * que LISTENERS: el worker se registra UNA vez, al importarse, así que quien
 * los guarda es el primer `chrome` simulado y los demás tienen que seguir
 * viéndolos.
 */
const CAMBIOS = []

/** Construye un entorno `chrome` simulado y devuelve los mandos. */
function makeChrome() {
  const listeners = LISTENERS
  const state = {
    // La pestaña del recorrido (1) NO es la activa: la activa es otra, y con un
    // id más alto. Así «se empuja a la pestaña activa» no puede pasar por
    // casualidad quedándose con la primera de la lista.
    tabs: {
      1: { id: 1, url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/400/Onboarding', windowId: 9, active: false },
      2: { id: 2, url: 'https://mail.example.com/inbox', windowId: 9, active: false },
      3: { id: 3, url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/200/ADR-014', windowId: 9, active: true },
    },
    session: {},
    local: {},
    sentToTab: [],
    sentWithTab: [],
    contentReply: () => ({ status: 'clicked' }),
    panelMessages: [],
  }

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: async (m) => {
        state.panelMessages.push(m)
      },
      getURL: (p) => 'chrome-extension://test/' + p,
    },
    action: { onClicked: { addListener() {} } },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      onActivated: { addListener() {} },
      get: async (id) => state.tabs[id],
      // Como la de Chrome en lo que aquí importa: si se pide `active`, sólo
      // salen las pestañas activas. Sin esto, «se empuja a la pestaña activa»
      // se habría probado con una lista que las devolvía todas.
      query: async (filtro = {}) =>
        Object.values(state.tabs).filter((t) => (filtro.active === undefined ? true : !!t.active === filtro.active)),
      update: async (id, { url }) => {
        state.tabs[id].url = url
        return state.tabs[id]
      },
      sendMessage: async (id, msg) => {
        state.sentToTab.push(msg)
        // Con destinatario: lo que se manda a la pestaña activa y no a otra
        // sólo se puede comprobar si se apunta a quién iba.
        state.sentWithTab.push({ tabId: id, msg })
        return state.contentReply(msg)
      },
    },
    storage: {
      onChanged: { addListener: (fn) => CAMBIOS.push(fn) },
      session: {
        get: async (k) => (k in state.session ? { [k]: state.session[k] } : {}),
        set: async (o) => Object.assign(state.session, o),
        remove: async (k) => delete state.session[k],
      },
      local: {
        get: async (k) => (k in state.local ? { [k]: state.local[k] } : {}),
        set: async (o) => Object.assign(state.local, o),
        remove: async (k) => delete state.local[k],
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {} },
  }

  return {
    state,
    /** Invoca el manejador de mensajes como haría Chrome. */
    send(message, sender = {}) {
      return new Promise((resolve) => {
        for (const fn of listeners) {
          const handled = fn(message, sender, resolve)
          if (handled) return
        }
        resolve(null)
      })
    },
  }
}

const PLAN = {
  navigate: true,
  mode: 'assisted',
  destination: {
    kind: 'confluence-page',
    id: '200',
    title: 'ADR-014',
    url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/200/ADR-014',
  },
  anchor: { kind: 'text-quote', exact: 'el token expira a los 90 días' },
  explanation: 'Está en el apartado de Decisión.',
  steps: [
    { kind: 'confluence-space', id: 'ENG', title: 'Ingeniería', url: 'https://acme.atlassian.net/wiki/spaces/ENG' },
    {
      kind: 'confluence-page',
      id: '100',
      title: 'Arquitectura',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/100/Arquitectura',
    },
    {
      kind: 'confluence-page',
      id: '200',
      title: 'ADR-014',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/200/ADR-014',
    },
  ],
}

/** Importa el worker una sola vez por proceso, con el chrome ya montado. */
let loaded = null
async function loadWorker(rig) {
  if (!loaded) loaded = await import('../../src/background/service-worker.js?probe=1')
  // El worker guarda el recorrido en memoria entre pruebas: se limpia antes de
  // empezar, igual que haría cerrar la pestaña.
  await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
  rig.state.sentToTab.length = 0
  rig.state.sentWithTab.length = 0
  rig.state.panelMessages.length = 0
  return rig
}

/** Dispara `chrome.storage.onChanged` como lo haría Chrome al escribir el panel. */
async function cambiar(changes, area = 'local') {
  for (const fn of CAMBIOS) await fn(changes, area)
  // El oyente hace su trabajo en una promesa suelta (no puede ser async: Chrome
  // no espera a nadie ahí), así que hay que dejar correr la cola de microtareas.
  await new Promise((r) => setTimeout(r, 0))
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

/** El margen del vigilante de pasos mientras dura una prueba: 30 ms, no 9 s. */
const MARGEN_MS = 30

/**
 * Acorta `NAV_TIMING.stepStallMs` mientras corre `fn` y, al salir, cancela el
 * recorrido y espera a que venza lo que quedara armado.
 *
 * Pasó de verdad (revisión de H1): las dos pruebas que pasan por la rama
 * «Permiso hay, así que se le da un margen» de `runCurrentStep` dejaban armados
 * dos `setTimeout` de 9 s (`watchStalledStep`) que mantenían vivo el proceso:
 * las unitarias acababan a los 6,6 s y `npm run check` tardaba 15,5 s.
 * `NAV_TIMING` es un objeto exportado mutable y `watchStalledStep` lee su valor
 * por defecto AL LLAMAR, así que basta con cambiarlo antes y restaurarlo en
 * `finally`. Se espera a que venza para que ningún temporizador se dispare
 * durante la prueba siguiente, que ya habrá cambiado el `chrome` global.
 */
async function conMargenCorto(rig, fn) {
  const original = NAV_TIMING.stepStallMs
  NAV_TIMING.stepStallMs = MARGEN_MS
  try {
    await fn()
  } finally {
    NAV_TIMING.stepStallMs = original
    await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
    await esperar(MARGEN_MS + 20)
  }
}

test('sw: la asistida recorre los tres pasos y termina anclando', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
  assert(res?.ok, 'debería arrancar: ' + JSON.stringify(res))

  const steps = rig.state.sentToTab.filter((m) => m.type === MSG.STEP)
  eq(steps.length, 3, 'deberían enviarse tres pasos')
  eq(steps.map((s) => s.step.id), ['ENG', '100', '200'])
  eq(steps[2].isLast, true)

  const anchors = rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR)
  eq(anchors.length, 1, 'debe anclar al final')
  eq(anchors[0].anchor.exact, 'el token expira a los 90 días')
  eq(anchors[0].explanation, 'Está en el apartado de Decisión.')
})

test('sw: si el DESTINO no se puede pulsar, se degrada a salto por URL', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  let n = 0
  rig.state.contentReply = (msg) => {
    if (msg.type !== MSG.STEP) return { status: 'done' }
    n++
    return n === 3 ? { status: 'navigate', reason: 'no localizado' } : { status: 'clicked' }
  }

  await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
  eq(
    rig.state.tabs[1].url,
    'https://acme.atlassian.net/wiki/spaces/ENG/pages/200/ADR-014',
    'el destino sí puede llegar por URL'
  )
})

test('EL CAMBIO: un paso INTERMEDIO nunca navega, se salta', async () => {
  // Pasó de verdad: un paso intermedio que no se localizaba acababa en una
  // carga de página completa. Eso pliega el árbol lateral entero, y los pasos
  // que quedaban se quedaban sin nada que desplegar — la navegación guiada
  // terminaba siendo el salto seco que precisamente quería evitar.
  const rig = makeChrome()
  await loadWorker(rig)
  const partida = rig.state.tabs[1].url

  let n = 0
  rig.state.contentReply = (msg) => {
    if (msg.type !== MSG.STEP) return { status: 'done' }
    n++
    return n === 2 ? { status: 'navigate', reason: 'no localizado' } : { status: 'clicked' }
  }

  await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })

  eq(rig.state.tabs[1].url, partida, 'la pestaña no debe haberse recargado')
  const steps = rig.state.sentToTab.filter((m) => m.type === MSG.STEP)
  eq(steps.map((s) => s.step.id), ['ENG', '100', '200'], 'el recorrido sigue hasta el final')
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1, 'y ancla igual')
})

test('sw: cancelar detiene el recorrido en seco', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  rig.state.contentReply = (msg) =>
    msg.type === MSG.STEP ? { status: 'cancelled', reason: 'user' } : { status: 'done' }

  await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
  const steps = rig.state.sentToTab.filter((m) => m.type === MSG.STEP)
  eq(steps.length, 1, 'no debe seguir tras la cancelación')
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 0, 'no debe anclar')
})

test('sw: un paso saltado no rompe el recorrido', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  let n = 0
  rig.state.contentReply = (msg) => {
    if (msg.type !== MSG.STEP) return { status: 'done' }
    n++
    return n === 1 ? { status: 'skipped' } : { status: 'clicked' }
  }

  await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.STEP).length, 3)
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1)
})

test('sw: la navegación directa salta y ancla al avisar la pestaña', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  const directo = { ...PLAN, mode: 'direct', steps: [] }
  const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })
  eq(res.navigating, true, 'debe navegar, no anclar todavía')
  eq(rig.state.tabs[1].url, directo.destination.url)
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 0, 'aún no')

  // La página nueva avisa de que está lista: ahora sí toca anclar.
  await rig.send({ type: MSG.CONTENT_READY, url: directo.destination.url }, { tab: { id: 1 } })
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1, 'debe anclar al estar lista')
})

test('sw: si ya estamos en el destino, ancla sin recargar', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.tabs[1].url = PLAN.destination.url

  const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, steps: [] } })
  eq(res.navigating, false)
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1)
})

test('sw: el estado del recorrido se guarda para sobrevivir a una recarga', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  await conMargenCorto(rig, async () => {
    rig.state.contentReply = () => null // la pestaña no contesta: está recargando
    await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })

    const saved = rig.state.session['faro:plans']
    assert(saved, 'debe quedar guardado en storage.session')
    eq(saved['1'].index, 0, 'debe recordar por qué paso iba')
  })
})

test('sw: el panel recibe el progreso', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })

  const progress = rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_PROGRESS)
  eq(progress.length, 3)
  eq(progress[0].total, 3)
  const finished = rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED)
  eq(finished.length, 1)
})

// --- el content script que no existe --------------------------------------
// El fallo real: en un Confluence propio el content script no esta inyectado
// (el manifest solo declara *.atlassian.net), la pestana no contestaba, y el
// service worker devolvia {ok:true, waiting:true}. Resultado: pulsabas «Paso a
// paso» y no pasaba absolutamente nada, sin un solo mensaje.

test('sw: sin permiso de host, la asistida se queja en vez de callarse', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  rig.state.contentReply = () => null // no hay content script
  globalThis.chrome.permissions.contains = async () => false

  const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })

  eq(res.ok, false)
  eq(res.needsPermission, true)
  assert(/permiso/i.test(res.error), 'el motivo debe hablar del permiso: ' + res.error)

  const avisos = rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED)
  eq(avisos.length, 1, 'el panel tiene que enterarse')
  eq(avisos[0].result.needsPermission, true)

  // Y no debe quedarse un recorrido a medias esperando para siempre.
  eq(rig.state.session['faro:plans']?.['1'], undefined)

  globalThis.chrome.permissions.contains = async () => true
})

test('sw: con permiso pero recargando, espera en vez de abortar', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  await conMargenCorto(rig, async () => {
    rig.state.contentReply = () => null
    globalThis.chrome.permissions.contains = async () => true

    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(res.ok, true)
    eq(res.waiting, true)
    assert(rig.state.session['faro:plans']?.['1'], 'el recorrido se conserva para retomarlo')
  })
})

// --- el vigilante de pasos --------------------------------------------------
// Esperar está bien; esperar para siempre, no. `watchStalledStep` da a la
// pestaña `NAV_TIMING.stepStallMs` para avisar y después decide: si ya contesta
// al PING, retoma el MISMO paso; si sigue muda, abandona con un motivo que el
// panel enseña. Aquí el margen se acorta a 30 ms (`conMargenCorto`): con los
// 9 s reales, además de eternizar la prueba, el temporizador sobrevivía a todas
// las demás y mantenía vivo el proceso.

test('sw: si la pestaña sigue muda al vencer el margen, se abandona el paso con motivo', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  await conMargenCorto(rig, async () => {
    rig.state.contentReply = () => null // ni al paso ni al PING de después
    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(res.waiting, true, 'primero espera')
    eq(rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED).length, 0, 'sin rendirse aún')

    await esperar(MARGEN_MS + 20)

    const avisos = rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED)
    eq(avisos.length, 1, 'el panel tiene que enterarse de que se abandonó')
    assert(/no responde/i.test(avisos[0].result.error), 'con un motivo: ' + avisos[0].result.error)
    eq(rig.state.session['faro:plans']?.['1'], undefined, 'y el recorrido no se queda a medias')
  })
})

test('sw: si al vencer el margen la pestaña ya contesta, se retoma el MISMO paso', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  await conMargenCorto(rig, async () => {
    let pasos = 0
    rig.state.contentReply = (msg) => {
      if (msg.type === MSG.PING) return { ok: true } // la recarga ya terminó
      if (msg.type !== MSG.STEP) return { status: 'done' }
      pasos++
      // El primer paso cayó en plena recarga; al reintentarlo, el usuario para.
      return pasos === 1 ? null : { status: 'cancelled', reason: 'user' }
    }

    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(res.waiting, true)

    await esperar(MARGEN_MS + 20)

    const steps = rig.state.sentToTab.filter((m) => m.type === MSG.STEP)
    eq(steps.map((s) => s.index), [0, 0], 'el mismo paso, dos veces: no se salta ninguno')
    eq(rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED).map((m) => m.result), [{ cancelled: true }])
  })
})

test('H6 P6a: al cambiar los ajustes, el worker los empuja a la pestaña activa', async () => {
  // Hasta H6 el content script no se enteraba de un ajuste nuevo hasta navegar
  // o recargar: `pushSettings` sólo se llamaba al lanzar un recorrido y en
  // `onContentReady`. Y desde H6 cerrar Ajustes ya no rearranca el panel, así
  // que tampoco hay un arranque que los empuje de rebote. Lo que el worker ve
  // del panel es la escritura de `faro:settings`.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = {
    reduceMotion: true,
    highlightStyle: 'marker',
    stepDelayMs: 1200,
    password: 'secreta',
  }

  await cambiar({ 'faro:settings': { newValue: rig.state.local['faro:settings'] } })

  const empujados = rig.state.sentWithTab.filter((s) => s.msg.type === MSG.SETTINGS)
  eq(empujados.length, 1, 'un solo empujón')
  eq(empujados[0].tabId, 3, 'a la pestaña ACTIVA, no a la primera de la lista ni a la del recorrido')
  eq(empujados[0].msg.reduceMotion, true)
  eq(empujados[0].msg.highlightStyle, 'marker')
  eq(empujados[0].msg.timing, { stepPauseMs: 1200 }, 'con la pausa que el usuario acaba de poner')
  // SEGURIDAD: al content script van los ajustes de la página, no la contraseña
  // del servidor (que es lo que vive en la misma clave).
  eq(Object.keys(empujados[0].msg).sort(), ['highlightStyle', 'reduceMotion', 'timing', 'type'])
})

test('H6 P6a: otra clave, u otra zona del almacén, no empujan nada', async () => {
  const rig = makeChrome()
  await loadWorker(rig)

  await cambiar({ 'faro:sites': { newValue: {} } })
  await cambiar({ 'faro:index:acme.atlassian.net': { newValue: {} } })
  // El recorrido en marcha vive en storage.session y cambia en cada paso: si la
  // zona no se mirara, cada paso mandaría además un MSG.SETTINGS.
  await cambiar({ 'faro:settings': { newValue: {} } }, 'session')
  await cambiar(null)

  eq(rig.state.sentToTab.filter((m) => m.type === MSG.SETTINGS).length, 0, 'sólo faro:settings en local')
})
