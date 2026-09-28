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
/**
 * Los oyentes de `chrome.tabs.onUpdated`, por lo mismo: el worker los registra
 * al importarse y es con ellos con lo que apunta una visita en el diario de
 * actividad (H11), con el panel cerrado y sin content script.
 */
const ACTUALIZADAS = []
/**
 * Los oyentes de `chrome.runtime.onInstalled` y de `chrome.permissions.onAdded`
 * / `onRemoved`, por lo mismo (H27): con ellos el worker vuelve a registrar el
 * content script de cada host propio concedido, y lo quita cuando el permiso se
 * va. Hasta H27 el mock DESCARTABA el de `onInstalled`, y del de los permisos no
 * había ni el evento.
 */
const INSTALADO = []
const PERMISOS_DADOS = []
const PERMISOS_QUITADOS = []

/**
 * Lo que devuelve `chrome.runtime.getManifest().host_permissions` con el
 * manifest real: son los orígenes que Chrome da al instalar y que el worker
 * NUNCA registra a mano (ya los cubre `content_scripts`).
 */
const HOSTS_DEL_MANIFEST = ['http://127.0.0.1/*', 'http://localhost/*', 'https://*.atlassian.net/*']

/** El error de Chrome al llamar a `permissions.request` sin gesto del usuario. */
const SIN_GESTO = 'This function must be called during a user gesture'

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
    /** Las claves de cada `storage.local.set`: para poder contar que NO se escribe. */
    escrituras: [],
    /**
     * Y las de cada `storage.local.get`. Hace falta para el filtro de
     * `onUpdated`: sin él no se escriben visitas de más —`recordVisit` las funde
     * por su clave—, lo que se hace son LECTURAS de balde (los ajustes y el mapa
     * de sitios) en cada carga de cualquier pestaña, y eso no se ve contando
     * escrituras (revisión adversaria de H11).
     */
    lecturas: [],
    /** Cada `scripting.executeScript`: la pestaña a la que se le puso el content script. */
    inyecciones: [],
    /**
     * Los patrones de origen que `permissions.getAll()` da como concedidos
     * (H27). Como en Chrome, ahí salen también los del manifest: el worker
     * tiene que saber quitarlos él.
     */
    granted: [...HOSTS_DEL_MANIFEST],
    /** Cada script que `scripting.registerContentScripts` dio de alta, en orden (H27). */
    registros: [],
    /** Cada id que `scripting.unregisterContentScripts` dio de baja, en orden (H27). */
    desregistros: [],
    /**
     * Los registrados AHORA, id → script, que es lo que consultan
     * `getRegisteredContentScripts` y los dos errores de Chrome de abajo: sin
     * esto, «registrar dos veces» y «desregistrar lo que no está» no fallarían
     * nunca en el mock y sí en Chrome.
     */
    vivos: new Map(),
    /** Cada `sidePanel.setPanelBehavior`: `onInstalled` lo conserva (H27). */
    comportamiento: [],
  }

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener: (fn) => INSTALADO.push(fn) },
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: async (m) => {
        state.panelMessages.push(m)
      },
      getURL: (p) => 'chrome-extension://test/' + p,
      getManifest: () => ({ manifest_version: 3, host_permissions: [...HOSTS_DEL_MANIFEST] }),
    },
    action: { onClicked: { addListener() {} } },
    sidePanel: {
      setPanelBehavior: async (o) => {
        state.comportamiento.push(o)
      },
      open: async () => {},
    },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener: (fn) => ACTUALIZADAS.push(fn) },
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
        // La pestaña va detrás: con dos pestañas del mismo origen (H27), cada
        // una contesta según tenga o no su content script.
        return state.contentReply(msg, id)
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
        get: async (k) => {
          state.lecturas.push(k)
          return k in state.local ? { [k]: state.local[k] } : {}
        },
        set: async (o) => {
          state.escrituras.push(Object.keys(o))
          Object.assign(state.local, o)
        },
        remove: async (k) => delete state.local[k],
      },
    },
    permissions: {
      contains: async () => true,
      // EL CAMBIO (H27): como en el worker de verdad, que no tiene gesto del
      // usuario: `request` LANZA aunque el permiso ya esté concedido (SUPUESTO
      // leído en Chromium, a verificar en H30). Hasta H27 el mock contestaba
      // `true` y escondía que el «Dar permiso» del worker podía fallar siempre.
      request: async () => {
        throw new Error(SIN_GESTO)
      },
      getAll: async () => ({ permissions: ['sidePanel', 'storage', 'scripting'], origins: [...state.granted] }),
      onAdded: { addListener: (fn) => PERMISOS_DADOS.push(fn) },
      onRemoved: { addListener: (fn) => PERMISOS_QUITADOS.push(fn) },
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids } = {}) => [...state.vivos.values()].filter((s) => !ids || ids.includes(s.id)),
      registerContentScripts: async (scripts) => {
        // Como Chrome: un id que ya está tumba la llamada entera.
        for (const s of scripts) if (state.vivos.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`)
        for (const s of scripts) {
          state.vivos.set(s.id, s)
          state.registros.push(s)
        }
      },
      unregisterContentScripts: async ({ ids } = {}) => {
        // Como Chrome (scripting_utils.cc, RemoveScripts): sin `ids` se van
        // TODOS, y un id que no existe tumba la llamada entera sin quitar ninguno.
        if (!ids) {
          state.desregistros.push('*')
          state.vivos.clear()
          return
        }
        for (const id of ids) if (!state.vivos.has(id)) throw new Error(`Nonexistent script ID '${id}'`)
        for (const id of ids) {
          state.vivos.delete(id)
          state.desregistros.push(id)
        }
      },
      // Las inyecciones, apuntadas: con ellas se sabe que los ajustes salen
      // DETRÁS del content script recién puesto (revisión adversaria de H23).
      executeScript: async (o) => {
        state.inyecciones.push(o)
        return []
      },
    },
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
    /**
     * Dispara `chrome.tabs.onUpdated` como al navegar. El oyente no puede ser
     * `async` (Chrome no espera a nadie ahí), así que apunta la visita en una
     * promesa suelta: hay que dejar correr la cola antes de mirar el almacén.
     */
    async fireTabUpdated(tabId, changeInfo, tab = state.tabs[tabId]) {
      for (const fn of ACTUALIZADAS) fn(tabId, changeInfo, tab)
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    },
    /**
     * Dispara uno de los eventos de H27 (`INSTALADO`, `PERMISOS_DADOS`,
     * `PERMISOS_QUITADOS`) como Chrome: sin esperar a nadie. El worker hace su
     * trabajo en una promesa suelta, así que hay que dejar correr la cola.
     */
    async disparar(oyentes, ...args) {
      for (const fn of oyentes) fn(...args)
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
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
    highlightColor: 'ambar',
    stepDelayMs: 1200,
    password: 'secreta',
  }

  await cambiar({ 'faro:settings': { newValue: rig.state.local['faro:settings'] } })

  const empujados = rig.state.sentWithTab.filter((s) => s.msg.type === MSG.SETTINGS)
  eq(empujados.length, 1, 'un solo empujón')
  eq(empujados[0].tabId, 3, 'a la pestaña ACTIVA, no a la primera de la lista ni a la del recorrido')
  eq(empujados[0].msg.reduceMotion, true)
  eq(empujados[0].msg.highlightStyle, 'marker')
  eq(empujados[0].msg.highlightColor, 'ambar', 'y la tinta que el usuario acaba de elegir')
  eq(empujados[0].msg.timing, { stepPauseMs: 1200 }, 'con la pausa que el usuario acaba de poner')
  // SEGURIDAD: al content script van los ajustes de la página, no la contraseña
  // del servidor (que es lo que vive en la misma clave).
  // EL CAMBIO (H23, docs/PLAN2.md §3.6): la tinta de las marcas es un ajuste de
  // la PÁGINA —la pinta el overlay—, así que viaja con los otros tres; eran
  // cuatro claves hasta H23.
  eq(Object.keys(empujados[0].msg).sort(), ['highlightColor', 'highlightStyle', 'reduceMotion', 'timing', 'type'])
})

test('H23: unos ajustes de antes, sin color del subrayado, empujan el azul', async () => {
  // `pushSettings` lee con `getSettings`, que pasa por `migrateSettings`: una
  // página no recibe nunca un color que no sea uno de los dos.
  const rig = makeChrome()
  await loadWorker(rig)
  for (const guardado of [{ reduceMotion: false }, { highlightColor: 'verde' }]) {
    rig.state.sentWithTab.length = 0
    rig.state.local['faro:settings'] = guardado
    await cambiar({ 'faro:settings': { newValue: guardado } })
    const empujados = rig.state.sentWithTab.filter((s) => s.msg.type === MSG.SETTINGS)
    eq(empujados.map((s) => s.msg.highlightColor), ['azul'], 'azul con ' + JSON.stringify(guardado))
  }
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

// --------------------------------------------------------------------- H11
//
// El diario de actividad. El worker es el ÚNICO escritor de «visto»: apunta con
// el panel cerrado y sin content script, que es lo normal en un Confluence
// propio sin permiso de host. Lo que más se comprueba aquí es lo que NO se
// apunta, porque un diario de lo que alguien abre no puede llenarse solo.

const JIRA = 'https://jira.simplprogramme.eu'
const CONF = 'https://confluence.simplprogramme.eu'
const DIARIO_JIRA = 'faro:actividad:jira.simplprogramme.eu'
const DIARIO_CONF = 'faro:actividad:confluence.simplprogramme.eu'

/** Un worker con los dos sitios configurados y las sugerencias encendidas. */
async function conSitios(sites = null) {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:sites'] = sites || {
    'jira.simplprogramme.eu': { host: 'jira.simplprogramme.eu', configured: true, product: 'jira' },
    'confluence.simplprogramme.eu': { host: 'confluence.simplprogramme.eu', configured: true, product: 'confluence' },
  }
  rig.state.escrituras.length = 0
  rig.state.lecturas.length = 0
  return rig
}

/** Las entradas del diario de un host, o {} si no hay diario. */
const items = (rig, clave) => rig.state.local[clave]?.items || {}

test('H11: al navegar a una incidencia de un sitio configurado se apunta la visita', async () => {
  const rig = await conSitios()
  await rig.fireTabUpdated(1, { url: `${JIRA}/browse/ENG-7` }, { id: 1, title: '[ENG-7] Consent API v2 - Jira' })

  const entradas = items(rig, DIARIO_JIRA)
  eq(Object.keys(entradas), ['jira-issue:ENG-7'])
  eq(entradas['jira-issue:ENG-7'].kind, 'jira-issue')
  eq(entradas['jira-issue:ENG-7'].id, 'ENG-7')
  eq(entradas['jira-issue:ENG-7'].seenCount, 1)
  eq(entradas['jira-issue:ENG-7'].title, 'Consent API v2', 'el título de la pestaña sin la clave ni el « - Jira»')
  eq(rig.state.escrituras, [[DIARIO_JIRA]], 'una escritura, y sólo la del diario')
})

test('H11: SEGURIDAD: ni la consulta ni el fragmento de la URL acaban en el diario', async () => {
  const rig = await conSitios()
  await rig.fireTabUpdated(
    1,
    { url: `${JIRA}/browse/ENG-7?focusedCommentId=99&jwt=ey.SECRETO#comment-99` },
    { id: 1, title: 'X - Jira' }
  )
  const guardado = JSON.stringify(rig.state.local[DIARIO_JIRA])
  eq(items(rig, DIARIO_JIRA)['jira-issue:ENG-7'].path, '/browse/ENG-7')
  assert(!guardado.includes('SECRETO'), 'un token pegado en la barra no se guarda treinta días')
  assert(!guardado.includes('focusedCommentId'))
  assert(!guardado.includes('comment-99'))
  assert(!guardado.includes('https://'), 'ni la URL absoluta: el enlace se reconstruye')
})

test('H11: sólo se apunta en los sitios que el usuario ha configurado', async () => {
  // Pasar por un Jira ajeno no es usarlo, y un registro a medias (host conocido
  // pero sin `configured`) tampoco: es lo que deja `siteRecords` antes de
  // verificar las claves.
  const rig = await conSitios({
    'jira.simplprogramme.eu': { host: 'jira.simplprogramme.eu', product: 'jira' },
  })
  await rig.fireTabUpdated(1, { url: `${JIRA}/browse/ENG-7` }, { id: 1, title: 'X - Jira' })
  eq(rig.state.escrituras, [], 'un host sin configured no apunta nada')

  const otro = await conSitios({})
  await otro.fireTabUpdated(1, { url: 'https://jira.ajeno.example/browse/ENG-7' }, { id: 1, title: 'X - Jira' })
  eq(otro.state.escrituras, [], 'y un host que no está en faro:sites, tampoco')
})

test('H11: con cualquiera de los dos interruptores apagado no se apunta NADA', async () => {
  // `todaySuggestions` es el de esta función y `restTools` el maestro de toda
  // lectura REST: quien no quiere que Faro toque la API de su sitio tampoco
  // quiere un diario de lo que abre.
  for (const ajustes of [{ todaySuggestions: false }, { restTools: false }, { restTools: false, todaySuggestions: false }]) {
    const rig = await conSitios()
    rig.state.local['faro:settings'] = ajustes
    rig.state.escrituras.length = 0
    await rig.fireTabUpdated(1, { url: `${JIRA}/browse/ENG-7` }, { id: 1, title: 'X - Jira' })
    eq(rig.state.escrituras, [], JSON.stringify(ajustes))
    eq(DIARIO_JIRA in rig.state.local, false)
  }
})

test('H11: sin `changeInfo.url` no se lee ni se escribe nada', async () => {
  // `onUpdated` dispara varias veces por carga (status, favicon, título) y lo que
  // interesa es la navegación, una vez. Lo que el filtro ahorra NO son entradas
  // de más —`recordVisit` funde los avisos de la misma navegación por su clave—:
  // son los ajustes y el mapa de sitios leídos otra vez en cada carga de
  // CUALQUIER pestaña. Contando sólo escrituras esto daba verde con el filtro
  // borrado, así que el mock cuenta también las lecturas (revisión adversaria de
  // H11).
  const rig = await conSitios()
  await rig.fireTabUpdated(1, { status: 'loading' }, { id: 1, url: `${JIRA}/browse/ENG-7`, title: 'X - Jira' })
  await rig.fireTabUpdated(1, { title: 'X - Jira' }, { id: 1, url: `${JIRA}/browse/ENG-7` })
  await rig.fireTabUpdated(1, {}, { id: 1, url: `${JIRA}/browse/ENG-7` })
  eq(rig.state.escrituras, [])
  eq(rig.state.lecturas, [], 'tres avisos sin URL nueva no tocan el almacén ni para leerlo')

  // Y con URL, lo de siempre: se lee lo que hace falta y se apunta una vez.
  await rig.fireTabUpdated(1, { url: `${JIRA}/browse/ENG-7` }, { id: 1, title: 'X - Jira' })
  assert(rig.state.lecturas.length > 0, 'con una navegación de verdad sí se lee')
  eq(rig.state.escrituras, [[DIARIO_JIRA]])
})

test('H11: lo que no es una incidencia ni una página no se apunta', async () => {
  const rig = await conSitios()
  for (const url of [`${JIRA}/secure/Dashboard.jspa`, `${CONF}/spaces/ENG/overview`, 'https://mail.example.com/x']) {
    await rig.fireTabUpdated(1, { url }, { id: 1, title: 'algo' })
  }
  eq(rig.state.escrituras, [])
})

test('H11: una página de un Data Center sólo se apunta con el `pageId` del content script', async () => {
  // `/display/ESPACIO/Título` no lleva el id por ninguna parte, y el worker no
  // puede mirar el DOM: por eso `CONTENT_READY` y `URL_CHANGED` lo traen de la
  // meta `ajs-page-id`.
  const rig = await conSitios()
  await rig.fireTabUpdated(4, { url: `${CONF}/display/ENG/Guia` }, { id: 4, title: 'Guía - Confluence' })
  eq(rig.state.escrituras, [], 'sin id no hay nada que apuntar')

  await rig.send(
    { type: MSG.CONTENT_READY, url: `${CONF}/display/ENG/Guia`, pageId: '3003' },
    { tab: { id: 4, title: 'Guía - Confluence' } }
  )
  const entradas = items(rig, DIARIO_CONF)
  eq(Object.keys(entradas), ['confluence-page:3003'])
  eq(entradas['confluence-page:3003'].title, 'Guía')
  eq(entradas['confluence-page:3003'].path, '/display/ENG/Guia')
})

test('H11: los dos avisos de la misma navegación cuentan UNA visita', async () => {
  // El worker apunta al confirmarse la navegación y el content script al estar
  // lista la página: es la misma visita, y `recordVisit` la funde por su clave.
  const rig = await conSitios()
  await rig.fireTabUpdated(1, { url: `${JIRA}/browse/ENG-7` }, { id: 1, title: 'Página anterior - Jira' })
  await rig.send(
    { type: MSG.CONTENT_READY, url: `${JIRA}/browse/ENG-7` },
    { tab: { id: 1, title: '[ENG-7] Consent API v2 - Jira' } }
  )
  await rig.send({ type: MSG.URL_CHANGED, url: `${JIRA}/browse/ENG-7` }, { tab: { id: 1, title: '[ENG-7] Consent API v2 - Jira' } })

  const entradas = items(rig, DIARIO_JIRA)
  eq(entradas['jira-issue:ENG-7'].seenCount, 1)
  eq(
    entradas['jira-issue:ENG-7'].title,
    'Consent API v2',
    'y el título se queda con el bueno: al confirmarse la navegación la pestaña todavía llevaba el de antes'
  )
})

test('H11: el diario no puede tumbar un recorrido', async () => {
  // `CONTENT_READY` es lo que retoma un paso tras una recarga, y apuntar la
  // visita va ANTES: si el almacén falla ahí, el recorrido tiene que seguir.
  const rig = await conSitios()
  const bueno = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async () => {
    throw new Error('almacén lleno')
  }
  try {
    const res = await rig.send(
      { type: MSG.CONTENT_READY, url: `${JIRA}/browse/ENG-7` },
      { tab: { id: 1, title: 'X - Jira' } }
    )
    eq(res, { ok: true }, 'la pestaña sigue avisando de que está lista')
  } finally {
    globalThis.chrome.storage.local.get = bueno
  }
})

// ------------------------------------------------------- revisión de H23
//
// La tinta no llegaba a una pestaña sin recorrido: `onContentReady` sale antes
// de `pushSettings` si no hay un recorrido en marcha, y el `onChanged` sólo
// empuja a la pestaña ACTIVA, así que un «Analizar» pintaba en azul aunque se
// hubiera elegido ámbar (A1). Los ajustes van por la puerta que el panel cruza
// siempre antes de marcar o señalar, `CONTENT_STATUS`, y tras inyectar el
// content script; una carga sin recorrido sigue sin recibirlos, a propósito.

/** Los ajustes de la página que no son los de fábrica, y la contraseña al lado. */
const AJUSTES_AMBAR = {
  reduceMotion: true,
  highlightStyle: 'marker',
  highlightColor: 'ambar',
  stepDelayMs: 1200,
  password: 'secreta',
}

test('H23 revisión: la pestaña que el panel comprueba recibe los ajustes de la página, con o sin recorrido', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: true } : null)
  // El almacén tarda: si el SW no esperara a los ajustes, el panel tendría la
  // respuesta —y mandaría su ANNOTATE— antes de que salieran.
  const bueno = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async (k) => {
    await esperar(5)
    return bueno(k)
  }
  try {
    // Sin recorrido: la pestaña 3 no tiene ninguno en marcha.
    // EL CAMBIO (H27): la respuesta dice además si hay alguien al otro lado
    // (`alive`) y, si está roto, por qué (`error`): siempre las cuatro claves.
    const res = await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: 'https://acme.atlassian.net' })
    eq(res, { granted: true, ready: true, alive: true, error: '' })
    eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping', 'faro:settings'], 'primero el PING y, si contesta, los ajustes, ANTES de contestar')
    const empujados = rig.state.sentWithTab.filter((s) => s.msg.type === MSG.SETTINGS)
    eq(empujados.length, 1, 'un solo SETTINGS')
    eq(empujados[0].tabId, 3, 'a la pestaña comprobada')
    eq(empujados[0].msg.highlightColor, 'ambar', 'con la tinta elegida')
    eq(empujados[0].msg.highlightStyle, 'marker')
    eq(empujados[0].msg.reduceMotion, true)
    // SEGURIDAD: lo mismo que en el empuje de H6: la contraseña no viaja.
    eq(Object.keys(empujados[0].msg).sort(), ['highlightColor', 'highlightStyle', 'reduceMotion', 'timing', 'type'])

    // Con un recorrido a medias (el salto directo espera a que la pestaña avise):
    // la comprobación empuja igual, y no retoma ni ancla nada.
    const directo = { ...PLAN, mode: 'direct', steps: [] }
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })
    rig.state.sentWithTab.length = 0
    await rig.send({ type: MSG.CONTENT_STATUS, tabId: 1, origin: 'https://acme.atlassian.net' })
    eq(rig.state.sentWithTab.map((s) => [s.tabId, s.msg.type]), [[1, 'faro:ping'], [1, 'faro:settings']])
  } finally {
    globalThis.chrome.storage.local.get = bueno
    await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
  }
})

test('H23 revisión: la pestaña que el panel comprueba y no contesta no recibe ajustes', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = () => null // sin content script

  const res = await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: 'https://acme.atlassian.net' })
  // EL CAMBIO (H27): muda es `alive: false`, que no es lo mismo que rota.
  eq(res, { granted: true, ready: false, alive: false, error: '' })
  eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping'], 'sólo el PING: a una pestaña muda no se le empuja nada')
})

test('H23 revisión: la pestaña que el panel comprueba sigue lista aunque el almacén falle', async () => {
  // Empujar los ajustes es un extra: si leerlos falla, el panel tiene que seguir
  // sabiendo que la pestaña está lista (sin el `.catch`, contestaba un error).
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: true } : null)
  const bueno = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async () => {
    throw new Error('almacén lleno')
  }
  try {
    const res = await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: 'https://acme.atlassian.net' })
    eq(res, { granted: true, ready: true, alive: true, error: '' })
  } finally {
    globalThis.chrome.storage.local.get = bueno
  }
})

test('H23 revisión: tras inyectar el content script, los ajustes van detrás', async () => {
  // «Dar permiso» en un host propio: el SW registra el script e inyecta en la
  // pestaña abierta, y el panel marca justo después sin otra comprobación.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? (rig.state.inyecciones.length ? { ok: true } : null) : null)

  const res = await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: 'https://confluence.simplprogramme.eu', tabId: 3 })
  eq(res, { ok: true })
  eq(rig.state.inyecciones.map((o) => o.target), [{ tabId: 3 }], 'se inyecta en la pestaña abierta')
  // EL CAMBIO (H27): tras inyectar se vuelve a hacer PING, y el `ok` y los
  // ajustes sólo salen si ESE contesta bien (hasta H27, `{ ok: true }` sin mirar).
  eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping', 'faro:ping', 'faro:settings'], 'el PING otra vez tras inyectar, y los ajustes detrás')
  const [ajustes] = rig.state.sentWithTab.filter((s) => s.msg.type === MSG.SETTINGS)
  eq([ajustes.tabId, ajustes.msg.highlightColor], [3, 'ambar'])
})

test('H23 revisión: una carga sin recorrido no despierta el content script entero', async () => {
  // Decisión de H11 que la revisión de H23 conserva: el aviso de «lista» sólo
  // apunta la visita. Hasta H27 el motivo era que el content script arrancaba
  // entero con el PRIMER mensaje que recibía (18 módulos y un sondeo cada
  // 700 ms), y un SETTINGS en cada carga lo habría arrancado siempre. Desde H27
  // SETTINGS ya no arranca nada (se guarda hasta el primer mensaje de verdad),
  // pero empujarlo en cada carga de cada pestaña seguiría costando una lectura
  // del almacén y un mensaje por página para nada: los ajustes llegan igual
  // cuando el panel comprueba la pestaña, antes de marcar o señalar.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: true } : null)

  const res = await rig.send({ type: MSG.CONTENT_READY, url: rig.state.tabs[3].url, pageId: '200' }, { tab: { id: 3, title: 'ADR-014' } })
  eq(res, { ok: true })
  eq(rig.state.sentWithTab, [], 'ni un mensaje a la pestaña')
})

// --------------------------------------------------------------------- H27
//
// El content script vuelve a cargar, y cuando no, se ve (docs/PLAN3.md §3.1).
// Visto en el Chrome de Marco el 2026-09-28: un content script que no arranca
// contesta `{ ok: false }` a todo, PING incluido, y para el worker «hay un
// script roto» y «no hay script» eran lo mismo: `ensureContentScript` volvía a
// inyectar, devolvía `{ ok: true }` sin mirar, y el panel decía «Listo. Ya
// puedo resaltar…» y no resaltaba nada. Y el «Dar permiso» del worker llamaba a
// `permissions.request`, que en un worker, sin gesto del usuario, lanza.

const CONF_ORIGEN = 'https://confluence.simplprogramme.eu'
const CONF_ID = 'faro-https---confluence-simplprogramme-eu'
const JIRA_ID = 'faro-https---jira-simplprogramme-eu'

/**
 * Lo que contesta al PING un content script cuyo arranque falló (H27,
 * bootstrap.js): vivo, sin arrancar y con el motivo recortado a la ruta.
 */
const ROTO = {
  ok: false,
  alive: true,
  booted: false,
  error: 'Failed to fetch dynamically imported module: src/content/runner.js',
}

test('H27: con el PING muerto también después de inyectar, REQUEST_HOST_PERMISSION da ok:false y kind huerfano', async () => {
  // Nadie contesta ni antes ni después de inyectar (la pestaña guarda la
  // instancia de antes de recargar la extensión, o la inyección «funciona» y no
  // arranca nada). Hasta H27 esto era `{ ok: true }`.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = () => null

  const res = await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 })
  eq(res, { ok: false, kind: 'huerfano', error: 'el content script no contesta' })
  eq(rig.state.inyecciones.map((o) => o.target), [{ tabId: 3 }], 'se intenta UNA vez')
  eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping', 'faro:ping'], 'y sin un PING bueno no se empujan los ajustes')
})

test('H27: un content script vivo y roto no se reinyecta y da kind roto', async () => {
  // Reinyectar no arregla un arranque roto: Chrome guarda en su mapa de módulos
  // el import que falló (whatwg/html#6768), y una segunda instancia en el mismo
  // mundo sólo añadiría otro oyente compitiendo con el viejo. Lo que hace falta
  // es DECIRLO, con el motivo que da el propio content script.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? ROTO : null)

  const estado = await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: CONF_ORIGEN })
  eq(estado, { granted: true, ready: false, alive: true, error: ROTO.error })
  const res = await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 })
  eq(res, { ok: false, kind: 'roto', error: ROTO.error })
  eq(rig.state.inyecciones, [], 'ni una inyección')
  eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping', 'faro:ping'], 'un PING por consulta y ningún SETTINGS')

  // Sin motivo, uno genérico: un `error` vacío querría decir «no está roto».
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: false } : null)
  eq(await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: CONF_ORIGEN }), {
    granted: true,
    ready: false,
    alive: true,
    error: 'el content script no arranca',
  })

  // Y roto DESPUÉS de inyectar (no había nadie, y el recién puesto no arranca):
  // roto también, no `ok`.
  rig.state.inyecciones.length = 0
  rig.state.sentWithTab.length = 0
  rig.state.contentReply = (msg) => (msg.type === MSG.PING && rig.state.inyecciones.length ? ROTO : null)
  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), { ok: false, kind: 'roto', error: ROTO.error })
  eq(rig.state.inyecciones.map((o) => o.target), [{ tabId: 3 }])
  eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping', 'faro:ping'])
})

test('H27: dos REQUEST_HOST_PERMISSION a la vez registran e inyectan UNA vez', async () => {
  // Sin `request` ni gesto, el panel asegura el script desde varios sitios a la
  // vez al abrirse (el arranque, los chips, los campos de la incidencia, «hoy»,
  // el índice): sin serializar por origen, cada uno registraba e inyectaba el
  // suyo y la pestaña acababa con dos content scripts compitiendo.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg, tabId) =>
    msg.type === MSG.PING && rig.state.inyecciones.some((o) => o.target.tabId === tabId) ? { ok: true } : null
  const pide = (tabId) => rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId })

  eq(await Promise.all([pide(3), pide(3), pide(1)]), [{ ok: true }, { ok: true }, { ok: true }])
  eq(rig.state.registros.map((s) => s.id), [CONF_ID], 'un registro')
  // La tercera es otra pestaña del mismo origen (otro panel, en otra ventana):
  // compartir la respuesta de la primera la dejaría sin script diciéndole «ok»,
  // así que espera su turno y se asegura la suya.
  eq(rig.state.inyecciones.map((o) => o.target.tabId), [3, 1], 'una inyección por pestaña, y no dos en la misma')
})

test('H27: SEGURIDAD: el SW nunca llama a permissions.request', async () => {
  // El gesto del clic viaja con el mensaje sólo mientras dura la parte
  // síncrona de su oyente, y `request` lo exige aunque el permiso ya esté dado
  // (los dos, SUPUESTOS leídos en Chromium hasta H30): el diálogo lo abre el
  // panel, con el clic, y el worker sólo COMPRUEBA con `contains`. Hasta H27 lo
  // pedía él y contestaba «permiso denegado» con el permiso concedido.
  const rig = makeChrome()
  await loadWorker(rig)
  let pedidos = 0
  globalThis.chrome.permissions.request = async () => {
    pedidos++
    throw new Error(SIN_GESTO)
  }
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: true } : null)

  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), { ok: true }, 'con el permiso dado, asegura el script')

  rig.state.sentWithTab.length = 0
  rig.state.registros.length = 0
  globalThis.chrome.permissions.contains = async () => false
  eq(
    await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: 'https://wiki.otra.example', tabId: 3 }),
    { ok: false, needsPermission: true, error: 'permiso no concedido' },
    'sin él, lo dice y no lo pide'
  )
  eq([rig.state.registros, rig.state.inyecciones, rig.state.sentWithTab], [[], [], []], 'sin permiso no se registra, ni se inyecta, ni se manda nada')
  eq(pedidos, 0, 'ni una llamada a request')
})

test('H27: onInstalled registra cada origen concedido de un sitio guardado y ninguno del manifest', async () => {
  // Una actualización (y recargar una extensión sin empaquetar lo es) puede
  // llevarse los scripts registrados, y sin ellos el subrayado y «Paso a paso»
  // de un host propio pedirían «Dar permiso» con el permiso dado. La concesión
  // ES el consentimiento: un sitio guardado sin claves (`configured: false`
  // tras «Quitar las claves», o sin `configured` si se saltaron) sigue siendo
  // de la persona. Lo del manifest no: ya lo cubre `content_scripts`.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:sites'] = {
    'confluence.simplprogramme.eu': {
      host: 'confluence.simplprogramme.eu',
      configured: true,
      product: 'confluence',
      jiraHost: 'jira.simplprogramme.eu',
    },
    'wiki.quitado.example': { host: 'wiki.quitado.example', configured: false, product: 'confluence' },
    'sin-permiso.example': { host: 'sin-permiso.example', configured: true, product: 'jira' },
    'acme.atlassian.net': { host: 'acme.atlassian.net', configured: true, product: 'confluence', cloud: true },
  }
  // El Jira enlazado no es una clave de `faro:sites`, y ajeno.example tiene
  // permiso pero no es un sitio de nadie.
  rig.state.granted.push(
    'https://confluence.simplprogramme.eu/*',
    'https://jira.simplprogramme.eu/*',
    'https://wiki.quitado.example/*',
    'https://ajeno.example/*'
  )

  await rig.disparar(INSTALADO, { reason: 'update' })
  eq(rig.state.registros.map((s) => s.id), [CONF_ID, JIRA_ID, 'faro-https---wiki-quitado-example'])
  eq(rig.state.registros[0], {
    id: CONF_ID,
    matches: ['https://confluence.simplprogramme.eu/*'],
    js: ['src/content/bootstrap.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  })
  eq(rig.state.comportamiento, [{ openPanelOnActionClick: true }], 'y el icono sigue abriendo el panel')

  // Idempotente: otra vuelta no registra nada dos veces.
  await rig.disparar(INSTALADO, { reason: 'install' })
  eq(rig.state.registros.length, 3, 'nada nuevo en la segunda vuelta')

  // Lo que el manifest ya declara no se registra aunque sea un sitio guardado
  // y esté concedido (aquí con un manifest inventado que lo incluye).
  rig.state.vivos.clear()
  rig.state.registros.length = 0
  globalThis.chrome.runtime.getManifest = () => ({ host_permissions: [...HOSTS_DEL_MANIFEST, 'https://jira.simplprogramme.eu/*'] })
  await rig.disparar(INSTALADO, { reason: 'update' })
  eq(rig.state.registros.map((s) => s.id), [CONF_ID, 'faro-https---wiki-quitado-example'])
})

test('H27: un «Duplicate script ID» cuenta como registrado, y un registro que falla no tumba los demás', async () => {
  // Al dar el permiso corren a la vez `permissions.onAdded` (la reconciliación)
  // y el REQUEST_HOST_PERMISSION del panel: los dos pueden ver el id libre y el
  // segundo en registrar se lleva el «Duplicate» de Chrome, que es un éxito.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: true } : null)
  rig.state.vivos.set(CONF_ID, { id: CONF_ID })
  globalThis.chrome.scripting.getRegisteredContentScripts = async () => []
  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), { ok: true })

  // Y en la reconciliación, un origen que no se deja registrar se apunta en la
  // consola y los demás siguen.
  rig.state.local['faro:sites'] = {
    'confluence.simplprogramme.eu': { host: 'confluence.simplprogramme.eu', configured: true, jiraHost: 'jira.simplprogramme.eu' },
    'wiki.quitado.example': { host: 'wiki.quitado.example', configured: false },
  }
  rig.state.granted.push('https://confluence.simplprogramme.eu/*', 'https://jira.simplprogramme.eu/*', 'https://wiki.quitado.example/*')
  const registra = globalThis.chrome.scripting.registerContentScripts
  globalThis.chrome.scripting.registerContentScripts = async (scripts) => {
    if (scripts.some((s) => s.id === JIRA_ID)) throw new Error('cuota de scripts llena')
    return registra(scripts)
  }
  const avisos = []
  const warn = console.warn
  console.warn = (...args) => avisos.push(args.map(String).join(' '))
  try {
    await rig.disparar(INSTALADO, { reason: 'update' })
  } finally {
    console.warn = warn
  }
  eq(rig.state.registros.map((s) => s.id), ['faro-https---wiki-quitado-example'], 'el de detrás del que falla, registrado')
  eq(avisos.length, 1, 'un aviso, el del que falla, y ninguno por el «Duplicate»: ' + JSON.stringify(avisos))
  assert(avisos[0].startsWith('[faro] service worker') && avisos[0].includes('cuota de scripts llena'), avisos[0])
})

test('H27: un permiso añadido registra y uno quitado desregistra', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:sites'] = {
    'confluence.simplprogramme.eu': { host: 'confluence.simplprogramme.eu', configured: true, product: 'confluence' },
  }

  rig.state.granted.push('https://confluence.simplprogramme.eu/*')
  await rig.disparar(PERMISOS_DADOS, { permissions: [], origins: ['https://confluence.simplprogramme.eu/*'] })
  eq([...rig.state.vivos.keys()], [CONF_ID], 'dado el permiso, el script queda registrado')

  // Quitado (desde chrome://extensions, o por el propio Chrome): el script se
  // va con él. Con otro origen en el mismo aviso que nunca se registró: Chrome
  // tumba la llamada ENTERA si un solo id no existe, así que van de uno en uno.
  rig.state.granted = rig.state.granted.filter((o) => o !== 'https://confluence.simplprogramme.eu/*')
  await rig.disparar(PERMISOS_QUITADOS, { permissions: [], origins: ['https://ajeno.example/*', 'https://confluence.simplprogramme.eu/*'] })
  eq(rig.state.desregistros, [CONF_ID])
  eq([...rig.state.vivos.keys()], [], 'y no queda ninguno')

  // Un aviso sin orígenes (se quitó un permiso de API) no toca nada: un
  // `unregisterContentScripts` sin `ids` los quitaría TODOS.
  rig.state.vivos.set('faro-https---otro-example', { id: 'faro-https---otro-example' })
  await rig.disparar(PERMISOS_QUITADOS, { permissions: ['tabs'] })
  eq(rig.state.desregistros, [CONF_ID])
  eq([...rig.state.vivos.keys()], ['faro-https---otro-example'])
})

test('H27: originsToRegister es pura', async () => {
  // La regla de la reconciliación, sin chrome: los hosts de `faro:sites` y sus
  // enlazados, sólo con el permiso concedido y nunca los del manifest, sin
  // repetidos y en orden. Congelados: ordenar la lista de entrada en su sitio
  // lanzaría.
  const rig = makeChrome()
  await loadWorker(rig)
  const congela = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])))
  const sites = congela({
    'wiki.b.example': { configured: true, jiraHost: 'jira.enlazado.example' },
    'a.example': { confluenceHost: 'wiki.b.example' },
    'quitado.example': { configured: false, jiraHost: '' },
    'manifiesto.example': { configured: true },
    'sin-permiso.example': { configured: true },
  })
  const granted = Object.freeze([
    'https://wiki.b.example/*',
    'https://quitado.example/*',
    'https://manifiesto.example/*',
    'https://jira.enlazado.example/*',
    'https://a.example/*',
    'https://otro.example/*',
    'http://localhost/*',
  ])
  const manifestOrigins = Object.freeze(['https://manifiesto.example/*', 'http://localhost/*'])

  const guardado = globalThis.chrome
  delete globalThis.chrome
  try {
    eq(loaded.originsToRegister({ sites, granted, manifestOrigins }), [
      'https://a.example',
      'https://jira.enlazado.example',
      'https://quitado.example',
      'https://wiki.b.example',
    ])
    eq(loaded.originsToRegister({}), [], 'sin nada, nada')
    eq(loaded.originsToRegister({ sites: null, granted: null, manifestOrigins: null }), [], 'y con nulos tampoco lanza')
  } finally {
    globalThis.chrome = guardado
  }
})

test('H27: un tipo que el SW no atiende no deja el canal abierto', async () => {
  // Devolver `true` en `onMessage` promete una respuesta. Con un tipo que el
  // worker no atiende (lo que el content script manda al panel, como
  // PICK_RESULT), el canal se quedaba abierto y quien mandaba esperaba a que
  // Chrome lo cerrara con un error.
  const rig = makeChrome()
  await loadWorker(rig)
  const aTiempo = (msg, sender) => Promise.race([rig.send(msg, sender), esperar(50).then(() => 'colgado')])
  for (const type of [MSG.PICK_RESULT, MSG.NOTE_CLICKED, MSG.PLAN_PROGRESS, 'faro:inventado']) {
    eq(await aTiempo({ type }), null, type)
  }

  // Y los siete que sí atiende siguen contestando: la lista va por nombre, y
  // una errata dejaría uno mudo sin que ninguna otra prueba lo notara (el
  // CANCEL_PLAN de `loadWorker` ni mira la respuesta).
  const pestana = { tab: { id: 1 } }
  for (const [msg, sender] of [
    [{ type: MSG.START_PLAN }, pestana],
    [{ type: MSG.NAVIGATE_DIRECT }, pestana],
    [{ type: MSG.REQUEST_HOST_PERMISSION }, pestana],
    [{ type: MSG.CANCEL_PLAN, tabId: 99 }],
    [{ type: MSG.CONTENT_STATUS }],
    [{ type: MSG.CONTENT_READY, url: '' }, { tab: {} }],
    [{ type: MSG.URL_CHANGED, url: '' }, { tab: {} }],
  ]) {
    const res = await aTiempo(msg, sender)
    assert(res && typeof res === 'object', `${msg.type} contesta: ${JSON.stringify(res)}`)
  }
})

test('H27: START_PLAN desde una pestaña se rechaza', async () => {
  // Lanzar un recorrido, navegar y asegurar el content script son cosas del
  // panel, que no es una pestaña: un mensaje con `sender.tab` (un content
  // script, o cualquier página de la extensión abierta en una pestaña) no
  // puede mandar al worker a navegar ni a inyectar.
  const rig = makeChrome()
  await loadWorker(rig)
  const partida = rig.state.tabs[1].url
  const desdeUnaPestana = { tab: { id: 1, url: partida } }
  for (const msg of [
    { type: MSG.START_PLAN, tabId: 1, plan: PLAN },
    { type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, steps: [] } },
    { type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 1 },
  ]) {
    eq(await rig.send(msg, desdeUnaPestana), { ok: false, error: 'sólo desde el panel' }, msg.type)
  }
  eq(rig.state.sentWithTab, [], 'nada sale hacia la pestaña')
  eq([rig.state.tabs[1].url, rig.state.inyecciones, rig.state.registros], [partida, [], []], 'ni navega, ni inyecta, ni registra')
  eq(rig.state.session['faro:plans']?.['1'], undefined, 'ni guarda un recorrido')

  // El mismo mensaje desde el panel, sin `sender.tab`, sigue valiendo (con
  // ramas que se despliegan, para no esperar la pausa de después de un clic).
  rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? { status: 'expanded' } : { ok: true })
  eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).ok, true)
})

test('H27: dos mensajes al despertar esperan a la MISMA lectura del recorrido guardado', async () => {
  // El worker se duerme y, al despertar, rehidrata `faro:plans` de
  // `storage.session`. Hasta H27 un booleano daba la hidratación por hecha
  // ANTES de leer: un segundo mensaje que llegaba mientras tanto guardaba sobre
  // el mapa vacío y se llevaba por delante el recorrido guardado. Hace falta un
  // worker recién despertado, así que se importa otra instancia y sus oyentes
  // se quitan al acabar (las demás pruebas siguen con la primera).
  const rig = makeChrome()
  await loadWorker(rig)
  const listas = [LISTENERS, CAMBIOS, ACTUALIZADAS, INSTALADO, PERMISOS_DADOS, PERMISOS_QUITADOS]
  const cuantos = listas.map((l) => l.length)
  rig.state.session['faro:plans'] = { 7: { plan: PLAN, index: 1, phase: 'steps' } }
  const lee = globalThis.chrome.storage.session.get
  globalThis.chrome.storage.session.get = async (k) => {
    await esperar(10) // la lectura tarda: es la ventana en la que entra el segundo
    return lee(k)
  }
  try {
    await import('../../src/background/service-worker.js?probe=despierto')
    const despierto = LISTENERS[LISTENERS.length - 1]
    const manda = (msg) => new Promise((r) => despierto(msg, {}, r))
    const directo = { ...PLAN, mode: 'direct', steps: [] }
    await Promise.all([manda({ type: MSG.CANCEL_PLAN, tabId: 9 }), manda({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })])
    eq(Object.keys(rig.state.session['faro:plans']).sort(), ['1', '7'], 'el recorrido que ya estaba guardado Y el nuevo')
  } finally {
    listas.forEach((l, i) => (l.length = cuantos[i]))
  }
})
