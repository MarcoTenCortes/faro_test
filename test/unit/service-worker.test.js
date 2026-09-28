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
 * manifest real: los orígenes que Chrome da al instalar. No es lo mismo que lo
 * que cubre `content_scripts` (revisión adversaria de H27, G7): 127.0.0.1 y
 * localhost tienen permiso pero ningún script declarado, y el de cada puerto lo
 * registra el «Dar permiso» del panel.
 */
const HOSTS_DEL_MANIFEST = ['http://127.0.0.1/*', 'http://localhost/*', 'https://*.atlassian.net/*']
/** Los `matches` de `content_scripts` del manifest real: lo único que el worker nunca registra a mano. */
const MATCHES_DEL_MANIFEST = ['https://*.atlassian.net/*']
// El patrón que casa con cualquier host https, aquí arriba y no en su prueba:
// lleva dentro un asterisco seguido de una barra, y dead-exports.test.js (que
// quita los comentarios con una regex) lo tomaría por el final de uno y se
// comería lo que hubiera detrás de la última barra y asterisco anteriores,
// `loaded.cubiertoPorContentScripts` incluido.
const CUALQUIER_HTTPS = 'https://*/*'

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
      getManifest: () => ({
        manifest_version: 3,
        host_permissions: [...HOSTS_DEL_MANIFEST],
        content_scripts: [{ matches: [...MATCHES_DEL_MANIFEST], js: ['src/content/bootstrap.js'] }],
      }),
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

/** El margen de los dos vigilantes mientras dura una prueba: 30 ms, no 9 ni 12 s. */
const MARGEN_MS = 30

/**
 * Acorta `NAV_TIMING.stepStallMs` y `NAV_TIMING.anchorStallMs` mientras corre
 * `fn` y, al salir, cancela el recorrido y espera a que venza lo que quedara
 * armado.
 *
 * Pasó de verdad (revisión de H1): las dos pruebas que pasan por la rama
 * «Permiso hay, así que se le da un margen» de `runCurrentStep` dejaban armados
 * dos `setTimeout` de 9 s (`watchStalledStep`) que mantenían vivo el proceso:
 * las unitarias acababan a los 6,6 s y `npm run check` tardaba 15,5 s.
 * `NAV_TIMING` es un objeto exportado mutable y los vigilantes leen su valor
 * por defecto AL LLAMAR, así que basta con cambiarlo antes y restaurarlo en
 * `finally`. Se espera a que venza para que ningún temporizador se dispare
 * durante la prueba siguiente, que ya habrá cambiado el `chrome` global.
 *
 * Desde H28 (docs/PLAN3.md §3.2) también el del salto, `watchStalledAnchor`:
 * cada salto por URL (el directo y el último paso que llega por URL) arma uno
 * de 12 s, y toda prueba que navega pasa por aquí. Las de un worker recién
 * despertado también: `NAV_TIMING` es el mismo objeto para todas las
 * instancias, y lo que arme una lo encuentra al vencer en su propio mapa.
 */
async function conMargenCorto(rig, fn) {
  const original = NAV_TIMING.stepStallMs
  const originalAncla = NAV_TIMING.anchorStallMs
  NAV_TIMING.stepStallMs = MARGEN_MS
  NAV_TIMING.anchorStallMs = MARGEN_MS
  try {
    await fn()
  } finally {
    NAV_TIMING.stepStallMs = original
    NAV_TIMING.anchorStallMs = originalAncla
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

  // Llegar por URL arma el vigilante del salto (H28): con el margen corto.
  await conMargenCorto(rig, async () => {
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
    // EL CAMBIO (H28, docs/PLAN3.md §3.2): como un salto directo, espera el
    // aviso de su página, y si no llega se abandona con motivo. Hasta H28 se
    // quedaba esperando para siempre.
    eq(rig.state.session['faro:plans']?.['1']?.phase, 'anchor', 'esperando el aviso del destino')
    await esperar(MARGEN_MS + 20)
    eq(
      rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED).map((m) => m.result),
      [{ error: 'La página de destino no ha avisado de que cargó. Recárgala y vuelve a intentarlo.' }]
    )
  })
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

  // El salto arma su vigilante (H28): con el margen corto.
  await conMargenCorto(rig, async () => {
    const directo = { ...PLAN, mode: 'direct', steps: [] }
    const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })
    eq(res.navigating, true, 'debe navegar, no anclar todavía')
    eq(rig.state.tabs[1].url, directo.destination.url)
    eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 0, 'aún no')

    // La página nueva avisa de que está lista: ahora sí toca anclar.
    await rig.send({ type: MSG.CONTENT_READY, url: directo.destination.url }, { tab: { id: 1 } })
    eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1, 'debe anclar al estar lista')
  })
})

test('sw: si ya estamos en el destino, ancla sin recargar', async () => {
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.tabs[1].url = PLAN.destination.url
  rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? { anchored: true, strategy: 'cita' } : { ok: true })

  const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, steps: [] } })
  eq(res.navigating, false)
  eq(rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR).length, 1)
  // EL CAMBIO (H28, docs/PLAN3.md §3.2): el panel se entera de cómo acabó, como
  // al llegar. Hasta H28 esta rama devolvía el resultado en la respuesta, que el
  // panel no lee, y ni un «Fragmento resaltado» ni un «Sin resaltar» salían.
  eq(
    rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED),
    [{ type: MSG.PLAN_FINISHED, tabId: 1, result: { anchored: true, strategy: 'cita' } }]
  )
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
  // EL CAMBIO (revisión adversaria de H28, D7): el final ya salió con el
  // motivo, y el panel no lo repite como «Navegación fallida».
  eq(res.avisado, true, 'y sabe que ya se le avisó')

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
  // El salto de abajo arma su vigilante (H28): con el margen corto, que al
  // salir cancela el recorrido y espera a que venza.
  await conMargenCorto(rig, async () => {
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
    }
  })
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
  // Y los dos PING piden arrancar (revisión adversaria de H27, G1): el ligero
  // sólo prueba que hay un oyente, y lo contesta bien un script cuyo arranque
  // va a fallar.
  eq(
    rig.state.sentWithTab.filter((s) => s.msg.type === MSG.PING).map((s) => s.msg),
    [
      { type: MSG.PING, arrancar: true },
      { type: MSG.PING, arrancar: true },
    ],
    'los dos PING de asegurar piden arrancar'
  )
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
  // el import que falló (whatwg/html#6768), y reinyectar en el mismo mundo no
  // hace nada: `window.__faroBooted` deja la segunda instancia en nada. Lo que
  // hace falta es DECIRLO, con el motivo que da el propio content script.
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
  // el índice): sin serializar por origen y pestaña, cada uno registraba e
  // inyectaba el suyo y la pestaña acababa con dos content scripts compitiendo.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg, tabId) =>
    msg.type === MSG.PING && rig.state.inyecciones.some((o) => o.target.tabId === tabId) ? { ok: true } : null
  const pide = (tabId) => rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId })

  eq(await Promise.all([pide(3), pide(1), pide(3)]), [{ ok: true }, { ok: true }, { ok: true }])
  eq(rig.state.registros.map((s) => s.id), [CONF_ID], 'un registro')
  // La del medio es otra pestaña del mismo origen (otro panel, en otra
  // ventana): compartir la respuesta de la 3 la dejaría sin script diciéndole
  // «ok», y esperar a la 3 la colgaría con ella si la 3 no contesta (revisión
  // adversaria de H27, G9). La misma pestaña comparte; OTRA del mismo origen ni
  // comparte ni espera. Con la 1 en medio, una entrada de la 1 que pisara la de
  // la 3 haría inyectar la 3 dos veces.
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
  // de la persona. Lo que ya cubre `content_scripts` del manifest real
  // (`*.atlassian.net`) no, aunque esté concedido por su host exacto.
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
  // permiso pero no es un sitio de nadie. `acme.atlassian.net`, guardado y
  // concedido por su host, lo cubre ya `content_scripts` (revisión adversaria
  // de H27, G7: hasta aquí se comparaba con `host_permissions` por cadena
  // exacta, y hacía falta un manifest inventado para que algo casara).
  rig.state.granted.push(
    'https://confluence.simplprogramme.eu/*',
    'https://jira.simplprogramme.eu/*',
    'https://wiki.quitado.example/*',
    'https://ajeno.example/*',
    'https://acme.atlassian.net/*'
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
  // enlazados, sólo con el permiso concedido y nunca lo que ya cubre
  // `content_scripts`, sin repetidos y en orden. Congelados: ordenar la lista
  // de entrada en su sitio lanzaría.
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
  const contentScriptMatches = Object.freeze(['https://manifiesto.example/*', 'http://localhost/*'])

  const guardado = globalThis.chrome
  delete globalThis.chrome
  try {
    eq(loaded.originsToRegister({ sites, granted, contentScriptMatches }), [
      'https://a.example',
      'https://jira.enlazado.example',
      'https://quitado.example',
      'https://wiki.b.example',
    ])
    eq(loaded.originsToRegister({}), [], 'sin nada, nada')
    eq(loaded.originsToRegister({ sites: null, granted: null, contentScriptMatches: null }), [], 'y con nulos tampoco lanza')
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

test('H27: los cinco mensajes del panel desde una pestaña se rechazan', async () => {
  // Lanzar un recorrido, navegar, cortarlo, asegurar el content script y
  // preguntar por él son cosas del panel, que no es una pestaña: un mensaje con
  // `sender.tab` (un content script, o cualquier página de la extensión abierta
  // en una pestaña) no puede mandar al worker a navegar ni a inyectar, ni
  // cortar el recorrido de otra pestaña, ni sondear el permiso de un origen
  // cualquiera o el estado de otra pestaña (revisión adversaria de H27, G8:
  // CANCEL_PLAN y CONTENT_STATUS se habían quedado sin la guarda).
  const rig = makeChrome()
  await loadWorker(rig)
  const partida = rig.state.tabs[1].url
  const desdeUnaPestana = { tab: { id: 1, url: partida } }
  for (const msg of [
    { type: MSG.START_PLAN, tabId: 1, plan: PLAN },
    { type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, steps: [] } },
    { type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 1 },
    { type: MSG.CANCEL_PLAN, tabId: 1 },
    { type: MSG.CONTENT_STATUS, tabId: 1, origin: CONF_ORIGEN },
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
  // El salto arma su vigilante (H28), y el de esta instancia vence en su propio
  // mapa: con el margen corto, dentro de la prueba.
  await conMargenCorto(rig, async () => {
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
})

// ------------------------------------------------- revisión adversaria de H27
//
// Sobre 7c729e4 (docs/plan/handoff/h27-rev-decisiones.md, D1 y D6-D10). Todo
// con comentarios de línea: desde aquí hasta el final no puede haber ni un
// comentario de bloque ni una cadena con un asterisco seguido de barra.
// dead-exports.test.js quita los comentarios con una regex, toma el «/*» de un
// patrón como «'https://x/*'» por el principio de uno, y lo cerraría ahí
// comiéndose los `loaded.originsToRegister` y `loaded.cubiertoPorContentScripts`
// que hay en medio: las dos exportaciones se quedarían sin importador.

// Un worker recién despertado: otra instancia del módulo (con otro `?probe=`)
// sobre el `chrome` que ya esté montado, con su `hydrating` a null, y sus
// oyentes quitados al acabar para que las demás pruebas sigan con la primera.
// `fn` recibe `manda(msg)`, que habla con el oyente de mensajes de ESA
// instancia sin `sender.tab`, como el panel.
async function conWorkerDespierto(sufijo, fn) {
  const listas = [LISTENERS, CAMBIOS, ACTUALIZADAS, INSTALADO, PERMISOS_DADOS, PERMISOS_QUITADOS]
  const cuantos = listas.map((l) => l.length)
  try {
    await import('../../src/background/service-worker.js?probe=' + sufijo)
    const despierto = LISTENERS[LISTENERS.length - 1]
    await fn((msg) => new Promise((r) => despierto(msg, {}, r)))
  } finally {
    listas.forEach((l, i) => (l.length = cuantos[i]))
  }
}

test('H27 revisión: tras inyectar, el PING pide arrancar y un arranque roto da kind roto, no «Listo»', async () => {
  // El PING ligero lo contesta bien un content script aunque su arranque vaya
  // a fallar: antes de arrancar sólo ha cargado una hoja, messages.js. Con él,
  // un script recién inyectado que no arranca pasaba los dos PING de
  // `asegurarAhora` y el panel decía «Listo» sin poder marcar nada, que es lo
  // que H27 vino a quitar (revisión adversaria de H27, G1). Aquí la pestaña
  // contesta como bootstrap.js: bien al PING ligero, roto al que pide arrancar.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  const comoBootstrap = (msg) => (msg.arrancar ? { ok: false, alive: true, booted: false, error: 'x' } : { ok: true, booted: false })
  rig.state.contentReply = (msg) => (msg.type === MSG.PING && rig.state.inyecciones.length ? comoBootstrap(msg) : null)

  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), { ok: false, kind: 'roto', error: 'x' })
  eq(rig.state.inyecciones.map((o) => o.target), [{ tabId: 3 }])
  eq(
    rig.state.sentWithTab.map((s) => s.msg),
    [
      { type: MSG.PING, arrancar: true },
      { type: MSG.PING, arrancar: true },
    ],
    'los dos PING piden arrancar, y ningún SETTINGS'
  )

  // Y el de antes de inyectar también: un script que ya estaba en la página y
  // no había arrancado (el de `content_scripts` en Cloud, o uno de antes) se
  // arranca ahora, y si no puede, es roto sin reinyectar.
  rig.state.inyecciones.length = 0
  rig.state.sentWithTab.length = 0
  rig.state.contentReply = (msg) => (msg.type === MSG.PING ? comoBootstrap(msg) : null)
  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), { ok: false, kind: 'roto', error: 'x' })
  eq([rig.state.inyecciones, rig.state.sentWithTab.map((s) => s.msg)], [[], [{ type: MSG.PING, arrancar: true }]])

  // El PING de comprobar sigue siendo el ligero (lo que ganó H11): un
  // CONTENT_STATUS no arranca nada.
  rig.state.sentWithTab.length = 0
  eq(await rig.send({ type: MSG.CONTENT_STATUS, tabId: 3, origin: CONF_ORIGEN }), { granted: true, ready: true, alive: true, error: '' })
  eq(rig.state.sentWithTab.map((s) => s.msg).filter((m) => m.type === MSG.PING), [{ type: MSG.PING }], 'el PING de CONTENT_STATUS, sin arrancar')
})

test('H27: sin pestaña, REQUEST_HOST_PERMISSION sólo registra y da ok', async () => {
  // Es lo que pide el panel para el Confluence enlazado desde un Jira DC: no
  // hay pestaña suya en la que inyectar, así que se registra para cuando el
  // usuario lo abra y nada más. El mock contesta bien a todo: un PING que se
  // colara hacia la pestaña `null` saldría en `sentWithTab`.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = () => ({ ok: true })
  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: null }), { ok: true })
  eq(rig.state.registros.map((s) => s.id), [CONF_ID])
  eq([rig.state.sentWithTab, rig.state.inyecciones], [[], []], 'ni un mensaje ni una inyección')
})

test('H27: si Chrome no deja registrar el script, kind registro y no se toca la pestaña', async () => {
  // Registrar va primero: si Chrome no lo deja, se dice con su motivo y no se
  // pregunta a la pestaña ni se inyecta nada en ella.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = () => null
  const registra = globalThis.chrome.scripting.registerContentScripts
  globalThis.chrome.scripting.registerContentScripts = async () => {
    throw new Error('cuota de scripts llena')
  }
  try {
    eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), {
      ok: false,
      kind: 'registro',
      error: 'no se pudo registrar el script: cuota de scripts llena',
    })
    eq([rig.state.sentWithTab, rig.state.inyecciones], [[], []], 'ni un PING ni una inyección')
  } finally {
    globalThis.chrome.scripting.registerContentScripts = registra
  }
})

test('H27: si la inyección falla, kind inyeccion sin segundo PING ni SETTINGS', async () => {
  // Chrome no deja inyectar en cualquier pestaña (una página de error, una del
  // navegador, una que se está cerrando): se dice con su motivo, sin preguntar
  // a un script que no se ha puesto ni empujarle los ajustes.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.local['faro:settings'] = AJUSTES_AMBAR
  rig.state.contentReply = () => null
  const inyecta = globalThis.chrome.scripting.executeScript
  globalThis.chrome.scripting.executeScript = async () => {
    throw new Error('Cannot access contents of the page')
  }
  try {
    eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId: 3 }), {
      ok: false,
      kind: 'inyeccion',
      error: 'no se pudo inyectar: Cannot access contents of the page',
    })
    eq(rig.state.sentWithTab.map((s) => s.msg.type), ['faro:ping'], 'el PING de antes y nada más')
  } finally {
    globalThis.chrome.scripting.executeScript = inyecta
  }
})

test('H27: si la lectura del recorrido guardado falla, la siguiente llamada vuelve a leer', async () => {
  // La hidratación guarda su PROMESA (H27, C5-10). Si esa lectura falla, la
  // promesa rechazada no puede quedarse ahí: el worker contestaría con el mismo
  // error a todo lo que tocara un recorrido hasta volver a dormirse. Hace falta
  // un worker recién despertado, que no haya leído todavía.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.session['faro:plans'] = { 7: { plan: PLAN, index: 1, phase: 'steps' } }
  const lee = globalThis.chrome.storage.session.get
  let fallos = 1
  globalThis.chrome.storage.session.get = async (k) => {
    if (fallos-- > 0) throw new Error('almacén de sesión caído')
    return lee(k)
  }
  const errores = []
  const error = console.error
  console.error = (...args) => errores.push(args.map(String).join(' '))
  // El segundo salto arma su vigilante (H28): con el margen corto.
  await conMargenCorto(rig, async () => {
    try {
      await conWorkerDespierto('reintento', async (manda) => {
        const directo = { ...PLAN, mode: 'direct', steps: [] }
        const primero = await manda({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })
        eq(primero, { ok: false, error: 'almacén de sesión caído' }, 'el primero falla')
        const segundo = await manda({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })
        eq(segundo, { ok: true, navigating: true }, 'y el segundo vuelve a leer y guarda')
        eq(Object.keys(rig.state.session['faro:plans']).sort(), ['1', '7'], 'sin perder el que ya estaba guardado')
      })
      eq(errores.length, 1, 'el fallo se apunta en la consola, una vez: ' + JSON.stringify(errores))
    } finally {
      console.error = error
      globalThis.chrome.storage.session.get = lee
    }
  })
})

test('H27: dos setPlan seguidos hacen UNA lectura del almacén de sesión', async () => {
  // Rehidratar es cosa del primer mensaje después de despertar. Volver a leer
  // en cada `setPlan` sería una lectura del almacén por cada paso de cada
  // recorrido, para nada: lo que hay guardado es lo que el worker ya tiene.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.session['faro:plans'] = { 7: { plan: PLAN, index: 1, phase: 'steps' } }
  const lee = globalThis.chrome.storage.session.get
  let lecturas = 0
  globalThis.chrome.storage.session.get = async (k) => {
    lecturas++
    return lee(k)
  }
  // Los dos saltos arman su vigilante (H28): con el margen corto.
  await conMargenCorto(rig, async () => {
    try {
      await conWorkerDespierto('dos-seguidos', async (manda) => {
        const directo = { ...PLAN, mode: 'direct', steps: [] }
        eq((await manda({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: directo })).ok, true, 'el primero')
        eq((await manda({ type: MSG.NAVIGATE_DIRECT, tabId: 2, plan: directo })).ok, true, 'el segundo')
      })
      eq(lecturas, 1, 'una lectura al despertar, y ninguna más')
      eq(Object.keys(rig.state.session['faro:plans']).sort(), ['1', '2', '7'])
    } finally {
      globalThis.chrome.storage.session.get = lee
    }
  })
})

test('H27 revisión: un host de Cloud abierto antes de instalar se inyecta pero no se registra', async () => {
  // `*.atlassian.net` ya lo cubre `content_scripts`: Chrome lo pone solo en
  // cada carga, y un script dinámico encima lo duplicaría. Lo que sí hace falta
  // es inyectarlo en la pestaña que ya estaba abierta al instalar, que no lo
  // tiene (revisión adversaria de H27, G7: hasta aquí se registraba igual).
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg) => (msg.type === MSG.PING && rig.state.inyecciones.length ? { ok: true } : null)
  eq(await rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: 'https://acme.atlassian.net', tabId: 3 }), { ok: true })
  eq(rig.state.registros, [], 'ningún script dinámico')
  eq(rig.state.inyecciones.map((o) => o.target.tabId), [3], 'y sí la inyección en la pestaña abierta')
})

test('H27 revisión: cubiertoPorContentScripts es pura', async () => {
  // Qué cubre ya `content_scripts`, casando por PATRÓN como Chrome y no por
  // cadena exacta (revisión adversaria de H27, G7): hasta aquí se buscaba el
  // `https://host/*` fabricado entre los `host_permissions`, y ni
  // `acme.atlassian.net` casaba con el comodín, ni un origen con puerto con
  // nada. Sin chrome.
  const rig = makeChrome()
  await loadWorker(rig)
  const cubierto = (origen, patrones) => loaded.cubiertoPorContentScripts(origen, patrones)
  const CLOUD = Object.freeze([...MATCHES_DEL_MANIFEST])
  const guardado = globalThis.chrome
  delete globalThis.chrome
  try {
    // El comodín de subdominio: el dominio y sus subdominios, y nada que sólo
    // acabe igual; y el esquema del patrón, que no es `*`.
    eq(
      [
        'https://acme.atlassian.net',
        'https://a.b.atlassian.net',
        'https://atlassian.net',
        'https://evilatlassian.net',
        'https://atlassian.net.evil.example',
        'http://acme.atlassian.net',
      ].map((o) => cubierto(o, CLOUD)),
      [true, true, true, false, false, false]
    )
    // El host exacto, y el puerto: un patrón sin puerto vale para todos (como
    // en Chrome); con puerto, sólo para ése.
    eq(
      [
        cubierto('https://wiki.example', ['https://wiki.example/*']),
        cubierto('https://otra.wiki.example', ['https://wiki.example/*']),
        cubierto('https://WIKI.example', ['https://wiki.example/*']),
        cubierto('https://wiki.example:8443', ['https://wiki.example/*']),
        cubierto('https://wiki.example:8443', ['https://wiki.example:8443/*']),
        cubierto('https://wiki.example', ['https://wiki.example:8443/*']),
        cubierto('http://127.0.0.1:5175', ['http://127.0.0.1/*']),
      ],
      [true, false, true, true, true, false, true]
    )
    // `*://` vale para http y https; el host comodín, para cualquiera; un
    // patrón que no abarca la ruta entera no cubre el origen; y lo que no es
    // un origen o no es una lista no cubre nada, sin lanzar.
    eq(
      [
        cubierto('http://acme.atlassian.net', ['*://*.atlassian.net/*']),
        cubierto('https://cualquiera.example', [CUALQUIER_HTTPS]),
        cubierto('https://wiki.example', ['https://wiki.example/wiki/*']),
        cubierto('https://wiki.example', []),
        cubierto('no es un origen', CLOUD),
        cubierto('https://wiki.example', null),
      ],
      [true, true, false, false, false, false]
    )
  } finally {
    globalThis.chrome = guardado
  }
})

test('H27 revisión: originsToRegister casa patrones, conserva el puerto y deja fuera lo que cubre content_scripts', async () => {
  // Se parte de lo CONCEDIDO y no de un patrón fabricado con el host
  // (revisión adversaria de H27, G7): así un Confluence propio en otro puerto
  // conserva el suyo, y lo que ya cubre `content_scripts` sale aunque el
  // permiso sea el de su host exacto. Sólo https: el banco (http, en
  // 127.0.0.1) lo asegura el panel puerto a puerto, y reconciliarlo aquí lo
  // ensancharía a todos. Una clave guardada con mayúsculas es el mismo host.
  const rig = makeChrome()
  await loadWorker(rig)
  const sites = {
    'Wiki.B.Example': { configured: true, jiraHost: 'jira.puerto.example' },
    'acme.atlassian.net': { configured: true, cloud: true },
    'comodin.example': { configured: true },
    '127.0.0.1': { configured: true },
  }
  const granted = [
    'https://wiki.b.example/*',
    'https://jira.puerto.example:8443/*',
    'https://acme.atlassian.net/*',
    '*://comodin.example/*',
    'http://127.0.0.1/*',
    'https://*.atlassian.net/*',
    'https://no-es-un-sitio.example/*',
  ]
  const guardado = globalThis.chrome
  delete globalThis.chrome
  try {
    eq(loaded.originsToRegister({ sites, granted, contentScriptMatches: MATCHES_DEL_MANIFEST }), [
      'https://comodin.example',
      'https://jira.puerto.example:8443',
      'https://wiki.b.example',
    ])
    // Sin `content_scripts` que lo cubra, el de Cloud concedido por su host entra.
    eq(loaded.originsToRegister({ sites, granted }).includes('https://acme.atlassian.net'), true)
  } finally {
    globalThis.chrome = guardado
  }
})

test('H27: una pestaña que no contesta no deja colgada a otra del mismo origen', async () => {
  // `sendMessage` no tiene plazo: una pestaña que no contesta al PING (colgada
  // en un script de la página, o a medio cerrar) dejaba esperando a cualquier
  // otra del mismo origen que llegara detrás, porque la cola era por origen
  // (revisión adversaria de H27, G9). No hace falta: el registro ya aguanta la
  // carrera («Duplicate script ID») y la inyección es de cada pestaña.
  const rig = makeChrome()
  await loadWorker(rig)
  let soltar = null
  const colgada = new Promise((r) => (soltar = r))
  rig.state.contentReply = (msg, tabId) => {
    if (msg.type !== MSG.PING) return null
    if (tabId === 3) return colgada
    return rig.state.inyecciones.some((o) => o.target.tabId === tabId) ? { ok: true } : null
  }
  const pide = (tabId) => rig.send({ type: MSG.REQUEST_HOST_PERMISSION, origin: CONF_ORIGEN, tabId })
  const plazo = esperar(50).then(() => 'colgado')
  const tercera = pide(3)
  try {
    eq(await Promise.race([pide(1), plazo]), { ok: true }, 'la 1 no espera a la 3')
    eq(rig.state.inyecciones.map((o) => o.target.tabId), [1], 'y se inyecta la suya')
    eq(rig.state.registros.map((s) => s.id), [CONF_ID], 'con un solo registro')
  } finally {
    // Se suelta la 3: el worker se importa una vez por proceso, y una promesa
    // colgada en `asegurando` se quedaría ahí para las pruebas siguientes.
    soltar({ ok: true })
    await tercera
    await esperar(0)
  }
})

// --------------------------------------------------------------------- H28
//
// Lo que consume el content script dice la verdad (docs/PLAN3.md §3.2). Con el
// content script roto (H27) un paso contestaba `{ ok: false, error }` sin
// `status`, `runCurrentStep` caía en el `default` y SALTABA todos los pasos
// hasta anclar en la página equivocada con START_PLAN diciendo `ok`; un salto
// que no llegaba a avisar se quedaba en la fase 'anchor' para siempre, y el
// primer aviso de cualquier página de esa pestaña anclaba ahí el recorrido
// viejo; y «ya estoy» comparaba origen y ruta, que en un Data Center son las
// de TODAS las páginas (`/pages/viewpage.action?pageId=…`). Sigue sin haber
// comentarios de bloque aquí (ver la revisión adversaria de H27, arriba).

// Un Confluence Data Center: todas sus páginas por id comparten ruta.
const DC = 'https://confluence.simplprogramme.eu'
const SALTO_DC = {
  ...PLAN,
  mode: 'direct',
  steps: [],
  destination: { kind: 'confluence-page', id: '200', title: 'ADR-014', url: DC + '/pages/viewpage.action?pageId=200' },
}
// Lo que dice el panel cuando la página de destino no llega a avisar.
const SIN_AVISO = 'La página de destino no ha avisado de que cargó. Recárgala y vuelve a intentarlo.'

const finales = (rig) => rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_FINISHED)
const anclas = (rig) => rig.state.sentToTab.filter((m) => m.type === MSG.ANCHOR)

test('H28: un paso que contesta {ok:false} sin status acaba el recorrido con su motivo', async () => {
  // Todos los resultados legítimos de `executeStep` llevan `status`; un
  // `{ ok: false }` sin él es el `catch` de bootstrap.js: el content script no
  // ha podido ejecutar el paso (su arranque falló, o el paso lanzó). Hasta H28
  // se saltaba y se mandaba el siguiente, que fallaba igual: tres pasos, un
  // ancla en la página de partida y un START_PLAN que decía `ok`.
  const rig = makeChrome()
  await loadWorker(rig)
  rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? { ok: false, error: ROTO.error } : { status: 'done' })
  let saltos = 0
  const actualiza = globalThis.chrome.tabs.update
  globalThis.chrome.tabs.update = async (...args) => {
    saltos++
    return actualiza(...args)
  }
  try {
    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    // EL CAMBIO (revisión adversaria de H28, D7): con `avisado`, porque el final
    // ya salió; el panel lo repetía como «Navegación fallida», con dos avisos.
    eq(res, { ok: false, error: ROTO.error, avisado: true }, 'el panel recibe el motivo y sabe que ya se le avisó')
    eq(rig.state.sentToTab.filter((m) => m.type === MSG.STEP).length, 1, 'un paso, no los tres')
    eq([anclas(rig).length, saltos], [0, 0], 'ni un ancla en la página equivocada ni una navegación')
    eq(finales(rig).map((m) => m.result), [
      { error: 'La página no ha podido ejecutar el paso 1: ' + ROTO.error + '. Recárgala y vuelve a intentarlo.' },
    ])
    eq(rig.state.session['faro:plans']?.['1'], undefined, 'y el recorrido no se queda a medias')
  } finally {
    globalThis.chrome.tabs.update = actualiza
  }
})

test('H28: en el último paso, un {ok:false} navega por URL', async () => {
  // El destino es el único paso que puede llegar por URL (como el `navigate`
  // del último paso): sin content script que lo pulse, llevar a la persona sigue
  // valiendo más que abandonar. Se queda esperando el aviso de la página de
  // destino, en la fase 'anchor', con el motivo en el progreso.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    let n = 0
    rig.state.contentReply = (msg) => {
      if (msg.type !== MSG.STEP) return { status: 'done' }
      n++
      return n < 3 ? { status: 'expanded' } : { ok: false, error: 'x' }
    }
    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(res, { ok: true, navigating: true })
    eq(rig.state.tabs[1].url, PLAN.destination.url, 'al destino, por URL')
    eq([finales(rig), anclas(rig)], [[], []], 'sin acabar ni anclar: falta que la página avise')
    const progreso = rig.state.panelMessages.filter((m) => m.type === MSG.PLAN_PROGRESS)
    eq(progreso.map((m) => [m.index, m.reason || '']), [[0, ''], [1, ''], [2, ''], [2, 'x']], 'el motivo, en el progreso')
    const guardado = rig.state.session['faro:plans']?.['1']
    eq([guardado?.phase, guardado?.index], ['anchor', 3], 'esperando al destino')

    // La página de destino avisa: ahora sí se ancla, y se acaba.
    await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).length], [1, 1])
    eq(rig.state.session['faro:plans']?.['1'], undefined)
  })
})

test('H28: un script roto al vencer el margen abandona con su error', async () => {
  // El PING del vigilante contesta, pero roto (H27: `{ ok: false, alive,
  // error }`). Hasta H28 eso era «La página no responde», que no es verdad: sí
  // responde, y lo que falla es el arranque del content script.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.contentReply = (msg) => (msg.type === MSG.PING ? { ok: false, alive: true, booted: false, error: 'x' } : null)
    const res = await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(res.waiting, true, 'primero espera')
    await esperar(MARGEN_MS + 20)
    eq(finales(rig).map((m) => m.result), [
      { error: 'El script de Faro en la página no arranca: x. Recarga la pestaña y vuelve a intentarlo.' },
    ])
    assert(/no arranca/.test(finales(rig)[0].result.error), 'dice que no arranca, no que no responde')
    eq(rig.state.session['faro:plans']?.['1'], undefined)
  })
})

test('H28: sin aviso de la pestaña de destino, el salto directo se abandona con motivo', async () => {
  // Una página de error, un login o un content script que no carga: nadie
  // manda CONTENT_READY. Hasta H28 el salto se quedaba esperando para siempre
  // y el panel no decía nada.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, mode: 'direct', steps: [] } })
    eq(res, { ok: true, navigating: true })
    eq(finales(rig), [], 'primero espera')
    await esperar(MARGEN_MS + 20)
    eq(finales(rig).map((m) => m.result), [{ error: SIN_AVISO }])
    eq(anclas(rig), [], 'sin anclar nada')
    eq(rig.state.session['faro:plans']?.['1'], undefined, 'y el salto no se queda esperando')
  })
})

test('H28: un aviso desde otra URL no ancla un plan viejo', async () => {
  // En la fase 'anchor' sólo cuenta el aviso de la página de DESTINO: por su
  // `pageId` (la meta `ajs-page-id`, que en un Data Center es lo único que la
  // identifica) o, sin él, por `samePage` con la URL que trae el aviso.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    rig.state.sentToTab.length = 0

    // Otra página (la persona se fue a otra, o el salto acabó en otra).
    await rig.send({ type: MSG.CONTENT_READY, url: DC + '/display/ENG/Onboarding' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'ni ancla ni acaba')
    eq(rig.state.session['faro:plans']?.['1']?.phase, 'anchor', 'sigue esperando al destino')

    // El destino, con una URL que no lleva su id: lo dice su `pageId`. Y si al
    // anclar la página no contesta, se dice (hasta H28 el panel recibía null).
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? null : { ok: true })
    await rig.send({ type: MSG.CONTENT_READY, url: DC + '/display/ENG/ADR-014', pageId: '200' }, { tab: { id: 1 } })
    eq(anclas(rig).length, 1, 'ahora sí ancla')
    eq(finales(rig).map((m) => m.result), [{ ok: false, error: 'la página no ha contestado al anclar' }])
    eq(rig.state.session['faro:plans']?.['1'], undefined)
  })
})

test('H28: “Llévame” entre dos viewpage.action sí navega', async () => {
  // `sameDoc` comparaba origen y ruta: en un Data Center dos páginas por id son
  // la MISMA ruta, y «Llévame» anclaba en la de partida sin moverse. Ahora
  // decide `samePage` (site.js), que compara el id.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.tabs[1].url = DC + '/pages/viewpage.action?pageId=100'
    const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    eq(res, { ok: true, navigating: true })
    eq(rig.state.tabs[1].url, SALTO_DC.destination.url)
    eq(anclas(rig), [], 'no se ancla en la página de partida')

    // Y en la misma página, con otra consulta detrás, sí es «ya estoy»; si al
    // anclar la página no contesta, el panel lo sabe.
    await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
    rig.state.tabs[1].url = DC + '/pages/viewpage.action?pageId=200&focusedCommentId=5'
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? null : { ok: true })
    const aqui = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    eq([aqui.navigating, anclas(rig).length], [false, 1])
    eq(finales(rig).map((m) => m.result), [{ ok: false, error: 'la página no ha contestado al anclar' }])
  })
})

test('H28: un espacio o un proyecto que se abren en su portada sí anclan, y otro no', async () => {
  // Un espacio no tiene una URL fija: `/wiki/spaces/ENG` se abre como
  // `/wiki/spaces/ENG/overview`, `/display/ENG` como `/display/ENG/Home`, y un
  // tablero de Jira lleva su número detrás. Con sólo `samePage` (ids y, sin
  // ellos, la ruta) un salto a un espacio o a un proyecto no llegaba nunca y se
  // abandonaba diciendo que la página no avisó. Ahí cuenta su clave.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    const casos = [
      ['confluence-space', 'ENG', '/wiki/spaces/ENG', '/wiki/spaces/OPS/overview', '/wiki/spaces/ENG/overview'],
      ['jira-project', 'ENG', '/jira/software/projects/ENG/boards', '/jira/software/projects/OPS/boards/2', '/jira/software/projects/ENG/boards/1'],
    ]
    for (const [kind, id, destino, otro, portada] of casos) {
      rig.state.sentToTab.length = 0
      rig.state.panelMessages.length = 0
      rig.state.tabs[1].url = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/400/Onboarding'
      const plan = { ...PLAN, mode: 'direct', steps: [], destination: { kind, id, title: id, url: 'https://acme.atlassian.net' + destino } }
      eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan })).navigating, true, kind)
      await rig.send({ type: MSG.CONTENT_READY, url: 'https://acme.atlassian.net' + otro, pageId: '' }, { tab: { id: 1 } })
      eq([anclas(rig).length, finales(rig).length], [0, 0], kind + ': otro espacio u otro proyecto no es el destino')
      await rig.send({ type: MSG.CONTENT_READY, url: 'https://otra.atlassian.net' + portada, pageId: '' }, { tab: { id: 1 } })
      eq([anclas(rig).length, finales(rig).length], [0, 0], kind + ': ni la misma clave en otro sitio')
      await rig.send({ type: MSG.CONTENT_READY, url: 'https://acme.atlassian.net' + portada, pageId: '' }, { tab: { id: 1 } })
      eq([anclas(rig).length, finales(rig).length], [1, 1], kind + ': su portada sí')
    }
  })
})

test('H28: el vigilante de un salto viejo no corta el siguiente', async () => {
  // Vigila el recorrido que había al armarlo, no la pestaña: dos «Llévame»
  // seguidos en la misma pestaña, y el del primero, al vencer, no puede
  // abandonar el segundo, que todavía está cargando.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, mode: 'direct', steps: [] } })
    await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq(finales(rig).length, 1, 'el primero llegó y ancló')

    // El segundo, con un margen más largo que el que le queda al primero.
    NAV_TIMING.anchorStallMs = MARGEN_MS * 10
    const segundo = { ...SALTO_DC, destination: { ...SALTO_DC.destination, id: '300', url: DC + '/pages/viewpage.action?pageId=300' } }
    eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: segundo })).navigating, true)
    await esperar(MARGEN_MS * 3)
    eq(finales(rig).length, 1, 'el vigilante del primero venció sin tocar el segundo')
    eq(rig.state.session['faro:plans']?.['1']?.plan?.destination?.id, '300', 'que sigue esperando')

    // El suyo sí lo abandona, al vencer (y se espera aquí: no puede quedar armado).
    await esperar(MARGEN_MS * 10)
    eq(finales(rig).map((m) => m.result), [finales(rig)[0].result, { error: SIN_AVISO }])
  })
})

test('H28: un salto que llega mientras vence su vigilante no se da por perdido', async () => {
  // El aviso de la página de destino llega justo antes de vencer el margen y
  // anclar tarda (la página busca la cita): el vigilante vence a mitad. Como el
  // recorrido se suelta ANTES de anclar, no lo abandona con «no ha avisado» un
  // salto que sí llegó, y el panel recibe un final, el bueno.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.contentReply = (msg) =>
      msg.type === MSG.ANCHOR ? esperar(MARGEN_MS * 3).then(() => ({ anchored: true, strategy: 'cita' })) : { ok: true }
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, mode: 'direct', steps: [] } })
    await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq(finales(rig).map((m) => m.result), [{ anchored: true, strategy: 'cita' }])
  })
})

test('H28: un almacén roto no tumba un recorrido: los ajustes de la página son un extra', async () => {
  // `pushSettings` lee los ajustes del almacén. Sin su `.catch`, si esa lectura
  // fallaba no arrancaba el recorrido, ni el salto, ni se retomaba un paso tras
  // una recarga: los ajustes (la tinta, las animaciones, la pausa) pueden llegar
  // después, y el recorrido no puede depender de ellos.
  const rig = makeChrome()
  await loadWorker(rig)
  const bueno = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async () => {
    throw new Error('almacén lleno')
  }
  await conMargenCorto(rig, async () => {
    try {
      rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? { status: 'expanded' } : { ok: true })
      eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).ok, true, 'el recorrido arranca')
      eq(anclas(rig).length, 1)

      eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...PLAN, mode: 'direct', steps: [] } })).navigating, true, 'el salto sale')
      eq(await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } }), { ok: true })
      eq(anclas(rig).length, 2, 'y al llegar ancla')

      // Un paso que cae en plena recarga se retoma al avisar la pestaña.
      rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? null : { ok: true })
      eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).waiting, true)
      rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? { status: 'expanded' } : { ok: true })
      eq(await rig.send({ type: MSG.CONTENT_READY, url: rig.state.tabs[1].url }, { tab: { id: 1 } }), { ok: true })
      eq(anclas(rig).length, 3, 'retomado hasta el final')
    } finally {
      globalThis.chrome.storage.local.get = bueno
    }
  })
})

// ------------------------------------------------- revisión adversaria de H28
//
// Sobre 6afde42 (docs/plan/handoff/h28-rev-decisiones.md, D1, D2, D4, D7 y D8).
// Lo que hace llegar un recorrido a su destino, y lo que dice cuando no llega:
// el último clic de un Data Center (una carga entera, que contesta desde la
// página VIEJA), el salto sin permiso de host, los destinos de Jira que no
// tienen una URL fija y el salto que no sale. Sigue sin haber comentarios de
// bloque aquí (ver la revisión adversaria de H27, arriba).

// Lo que contesta la página al anclar bien.
const ANCLADO = { anchored: true, strategy: 'cita' }
// La página de la pestaña 1 del rig, de donde sale cada recorrido.
const PARTIDA = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/400/Onboarding'

// Un recorrido paso a paso en un Data Center: páginas por `/display/`, que no
// llevan el id en la URL (lo lleva la meta `ajs-page-id`, y con ella el aviso).
const PASOS_DC = {
  ...PLAN,
  destination: { kind: 'confluence-page', id: '200', title: 'ADR-014', url: DC + '/display/ENG/ADR-014' },
  steps: [
    { kind: 'confluence-space', id: 'ENG', title: 'Ingeniería', url: DC + '/display/ENG' },
    { kind: 'confluence-page', id: '100', title: 'Arquitectura', url: DC + '/display/ENG/Arquitectura' },
    { kind: 'confluence-page', id: '200', title: 'ADR-014', url: DC + '/display/ENG/ADR-014' },
  ],
}
const PARTIDA_DC = DC + '/display/ENG/Onboarding'

// Una pestaña que despliega los dos primeros pasos y contesta `ultimo` al
// tercero; a ANCHOR, `ancla` (una función, si tiene que tardar).
function recorrido(rig, ultimo, ancla = ANCLADO) {
  let n = 0
  rig.state.contentReply = (msg) => {
    if (msg.type === MSG.ANCHOR) return typeof ancla === 'function' ? ancla() : ancla
    if (msg.type !== MSG.STEP) return { ok: true }
    n++
    return n < 3 ? { status: 'expanded' } : ultimo
  }
}

// El plan de una búsqueda de Jira, con la forma de `jqlPlan` (planner.js).
function busqueda(jql) {
  const url = JIRA + '/issues/?jql=' + encodeURIComponent(jql)
  const destination = { kind: 'jira-jql', id: jql, title: 'Los 3 resultados de la búsqueda en Jira', path: url.slice(JIRA.length), url }
  return { navigate: true, mode: 'direct', destination, anchor: null, steps: [{ ...destination, label: destination.title, action: 'open' }], explanation: jql }
}

// El `chrome.permissions.contains` del rig, que dice que no, mientras corre `fn`.
async function sinPermiso(fn) {
  const contiene = globalThis.chrome.permissions.contains
  const preguntas = []
  globalThis.chrome.permissions.contains = async (p) => {
    preguntas.push(p)
    return false
  }
  try {
    await fn(preguntas)
  } finally {
    globalThis.chrome.permissions.contains = contiene
  }
}

test('H28 rev: el último clic que recarga (un Data Center) no ancla en la página que pulsó', async () => {
  // Reproducido en Chromium (revisión adversaria de H28, G1): en un Data Center
  // pulsar el enlace del árbol es una carga ENTERA; la página vieja se da por
  // quieta a los ~230 ms con su URL todavía puesta y contesta `clicked` desde
  // ella. El worker esperaba 420 ms y mandaba ANCHOR a la vieja (o a nadie), y
  // el aviso del destino ya no encontraba recorrido. Lo decide la respuesta del
  // clic: la página que contesta con su propia URL no es el destino, y el
  // recorrido espera su aviso en la fase 'anchor', o su vigilante.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.tabs[1].url = PARTIDA_DC
    recorrido(rig, { status: 'clicked', url: PARTIDA_DC, pageId: '400' })
    eq(await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PASOS_DC }), { ok: true, navigating: true })
    eq([anclas(rig), finales(rig)], [[], []], 'ni un ANCHOR a la página de partida')
    const guardado = rig.state.session['faro:plans']?.['1']
    eq([guardado?.phase, guardado?.index], ['anchor', 3], 'esperando el aviso del destino')

    // Avisa otra página: no es el destino.
    await rig.send({ type: MSG.CONTENT_READY, url: DC + '/display/ENG/Otra', pageId: '300' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'otra página no ancla')
    // El destino, con una URL `/display/` sin id: lo dice su `pageId`. Una vez.
    await rig.send({ type: MSG.CONTENT_READY, url: PASOS_DC.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], 'el aviso del destino ancla, una vez')
    eq(rig.state.session['faro:plans']?.['1'], undefined)

    // Y si el destino no avisa (la pestaña llegó y su content script no), el
    // vigilante del salto lo cierra con su motivo.
    rig.state.sentToTab.length = 0
    rig.state.panelMessages.length = 0
    rig.state.tabs[1].url = PARTIDA_DC
    recorrido(rig, { status: 'clicked', url: PARTIDA_DC, pageId: '400' })
    await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PASOS_DC })
    rig.state.tabs[1].url = PASOS_DC.destination.url
    await esperar(MARGEN_MS + 20)
    eq([anclas(rig), finales(rig).map((m) => m.result)], [[], [{ error: SIN_AVISO }]])
  })
})

test('H28 rev: el último clic que ya dejó la pestaña en el destino ancla en el acto, aunque siga cargando', async () => {
  // Lo que ya anclaba sigue anclando, UNA vez: «ya estábamos aquí» (sin
  // `url`) y un `clicked` con la URL del destino (una SPA que ya cambió de
  // vista). Y la guarda contra el arreglo literal del grupo, que miraba
  // `tabs.status` en la rama final: tras document_idle la pestaña sigue en
  // 'loading' hasta el onload, y esperar ahí un aviso que ya había pasado
  // acababa en «no ha avisado» (revisión adversaria de H28, G1: la vieja muere
  // antes de contestar, el aviso del destino reenvía el paso y éste contesta
  // «ya estábamos aquí»). Y la rama final dice si la página no contesta al
  // anclar: hasta aquí el panel recibía un final null y callaba.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.tabs[1].status = 'loading'
    for (const ultimo of [{ status: 'clicked', note: 'ya estábamos aquí' }, { status: 'clicked', url: PLAN.destination.url, pageId: '200' }]) {
      rig.state.sentToTab.length = 0
      rig.state.panelMessages.length = 0
      recorrido(rig, ultimo)
      eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).finished, true, JSON.stringify(ultimo))
      eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], JSON.stringify(ultimo))
    }

    rig.state.sentToTab.length = 0
    rig.state.panelMessages.length = 0
    let n = 0
    rig.state.contentReply = (msg) => {
      if (msg.type === MSG.ANCHOR) return ANCLADO
      if (msg.type !== MSG.STEP) return { ok: true }
      n++
      if (n < 3) return { status: 'expanded' }
      return n === 3 ? null : { status: 'clicked', note: 'ya estábamos aquí' }
    }
    eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).waiting, true, 'la vieja murió antes de contestar')
    await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], 'el paso reenviado contesta «ya estábamos aquí» y ancla')
    await esperar(MARGEN_MS * 2 + 40)
    eq(finales(rig).length, 1, 'y ningún «no ha avisado» detrás')

    rig.state.panelMessages.length = 0
    recorrido(rig, { status: 'clicked', note: 'ya estábamos aquí' }, null)
    await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    eq(finales(rig).map((m) => m.result), [{ ok: false, error: 'la página no ha contestado al anclar' }], 'la página que no contesta al anclar, dicho')
  })
})

test('H28 rev: un aviso del destino dentro del margen de después del clic ancla UNA vez', async () => {
  // El aviso del destino llega mientras el worker espera su margen tras el
  // último clic, y anclar tarda (la página busca la cita): la rama final no
  // soltaba el recorrido antes de anclar, el margen lo encontraba vivo al
  // acabar y anclaba OTRA vez, con dos finales (revisión adversaria de H28, G1,
  // escenario E). Ahora se suelta antes, como en `onContentReady`.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    recorrido(rig, { status: 'clicked', note: 'ya estábamos aquí' }, () => esperar(NAV_TIMING.afterClickMs + 150).then(() => ANCLADO))
    const lanzado = rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })
    await esperar(40)
    await rig.send({ type: MSG.CONTENT_READY, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    await lanzado
    eq(anclas(rig).length, 1, 'un ANCHOR, no dos')
    eq(finales(rig).map((m) => m.result), [ANCLADO], 'y un final')
  })
})

test('H28 rev: en una SPA, el último clic cuya URL cambia después de contestar ancla con URL_CHANGED', async () => {
  // Una SPA (Cloud) cambia de vista sin recargar y sin CONTENT_READY. Si su URL
  // cambia después de que la página se dé por quieta, el clic contesta con la
  // de partida y el recorrido espera en 'anchor': el aviso de URL cambiada
  // cuenta entonces como el de «lista», con la misma regla (sólo el destino).
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    recorrido(rig, { status: 'clicked', url: PARTIDA, pageId: '400' })
    eq(await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN }), { ok: true, navigating: true })
    await rig.send({ type: MSG.URL_CHANGED, url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/300/Otra', pageId: '400' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'otra URL no es el destino')
    await rig.send({ type: MSG.URL_CHANGED, url: PLAN.destination.url, pageId: '400' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], 'el destino sí, aunque la meta del id siga siendo la de antes')
    eq(rig.state.session['faro:plans']?.['1'], undefined)

    // En la fase 'steps' no hace nada, ni con la URL del destino: un paso a
    // medias lo retoma el aviso de una recarga, y anclar ahí se saltaría los
    // que quedan.
    rig.state.sentToTab.length = 0
    rig.state.panelMessages.length = 0
    rig.state.contentReply = (msg) => (msg.type === MSG.STEP ? null : { ok: true })
    eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).waiting, true)
    await rig.send({ type: MSG.URL_CHANGED, url: PLAN.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'un paso a medias no se ancla por un cambio de URL')
    eq(rig.state.session['faro:plans']?.['1']?.phase, 'steps')
  })
})

test('H28 rev: un salto directo sin permiso navega y no avisa de nada', async () => {
  // Sin permiso de host en el destino no hay content script que avise, y el
  // panel manda el salto igual («Sin permiso sólo puedo llevarte de golpe»).
  // Desde H28 todo salto armaba su vigilante y, a los 12 s, salía «La página de
  // destino no ha avisado… Recárgala» en rojo con la pestaña ya en su sitio
  // (revisión adversaria de H28, G2). Ahora navega sin recorrido ni vigilante;
  // con un fragmento que resaltar, lo dice en ámbar: un `anchored: false` con
  // su `message` es lo que el panel pinta como «Sin resaltar».
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    // Un salto anterior de la misma pestaña, todavía esperando su aviso: el
    // nuevo lo sustituye, y el vigilante de aquél no puede acabar éste.
    const anterior = { ...SALTO_DC, destination: { ...SALTO_DC.destination, id: '300', url: DC + '/pages/viewpage.action?pageId=300' } }
    eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: anterior })).navigating, true)
    await sinPermiso(async (preguntas) => {
      rig.state.contentReply = () => null
      rig.state.tabs[1].url = DC + '/pages/viewpage.action?pageId=100'
      const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...SALTO_DC, anchor: null } })
      eq(res, { ok: true, navigating: true, anchored: false })
      eq(rig.state.tabs[1].url, SALTO_DC.destination.url, 'lleva igual')
      eq(preguntas.map((p) => p.origins), [[DC + '/' + '*']], 'por el permiso del origen del destino')
      eq(rig.state.session['faro:plans']?.['1'], undefined, 'sin recorrido esperando un aviso que no puede llegar, ni el de antes')
      await esperar(MARGEN_MS + 20)
      eq([finales(rig), anclas(rig)], [[], []], 'sin fragmento, nada que decir')

      rig.state.tabs[1].url = DC + '/pages/viewpage.action?pageId=100'
      eq(await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC }), { ok: true, navigating: true, anchored: false })
      await esperar(MARGEN_MS + 20)
      eq(finales(rig).map((m) => m.result), [
        { anchored: false, message: 'Te he llevado, pero sin permiso en confluence.simplprogramme.eu no puedo resaltar el fragmento.' },
      ])
      eq(anclas(rig), [], 'ni un ANCHOR a una pestaña sin content script')
    })
  })
})

test('H28 rev: «ya estoy» sin permiso no manda ANCHOR ni da error', async () => {
  // La rama «ya estoy» mandaba ANCHOR a una pestaña sin content script y, desde
  // H28, avisaba al panel de «la página no ha contestado al anclar»: no es lo
  // que pasa, lo que falta es el permiso (revisión adversaria de H28, G2).
  const rig = makeChrome()
  await loadWorker(rig)
  await sinPermiso(async () => {
    rig.state.contentReply = () => null
    rig.state.tabs[1].url = SALTO_DC.destination.url
    eq(await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC }), { ok: true, navigating: false, anchored: false })
    eq(anclas(rig), [])
    eq(finales(rig).map((m) => m.result), [
      { anchored: false, message: 'Ya estás en la página, pero sin permiso en confluence.simplprogramme.eu no puedo resaltar el fragmento.' },
    ])
    rig.state.panelMessages.length = 0
    eq(await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: { ...SALTO_DC, anchor: null } }), { ok: true, navigating: false, anchored: false })
    eq([anclas(rig), finales(rig)], [[], []], 'y sin fragmento, nada')
    eq(rig.state.tabs[1].url, SALTO_DC.destination.url, 'sin recargar')
  })
})

test('H28 rev: una pestaña que sigue cargando al vencer el margen tiene UNA prórroga, y el vigilante vuelve a mirar tras leerla', async () => {
  // Un Data Center lento no es un salto perdido: si al vencer el margen la
  // pestaña sigue en 'loading', se espera otro margen igual, y una sola vez
  // (revisión adversaria de H28, G2). El margen, más largo que el corto: las
  // comprobaciones van entre el primer vencimiento y el de la prórroga.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    const margen = MARGEN_MS * 4
    NAV_TIMING.anchorStallMs = margen
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? ANCLADO : { ok: true })
    rig.state.tabs[1].status = 'loading'
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    await esperar(margen * 1.5)
    eq(finales(rig), [], 'cargando todavía: no se abandona')
    eq(rig.state.session['faro:plans']?.['1']?.phase, 'anchor')
    await rig.send({ type: MSG.CONTENT_READY, url: SALTO_DC.destination.url, pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], 'el aviso llega en la prórroga y se ancla')
    await esperar(margen)

    // La prórroga es UNA: sigue cargando y nadie avisa, y a los dos márgenes, el motivo.
    rig.state.sentToTab.length = 0
    rig.state.panelMessages.length = 0
    rig.state.tabs[1].url = PARTIDA
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    await esperar(margen * 3)
    eq(finales(rig).map((m) => m.result), [{ error: SIN_AVISO }])

    // Leer la pestaña tarda (en Chrome es una llamada al navegador), y el aviso
    // del destino puede llegar mientras tanto: el vigilante vuelve a mirar el
    // recorrido al volver, y no añade un «no ha avisado» a un salto que llegó.
    rig.state.sentToTab.length = 0
    rig.state.panelMessages.length = 0
    rig.state.tabs[1].status = 'complete'
    rig.state.tabs[1].url = PARTIDA
    const lee = globalThis.chrome.tabs.get
    globalThis.chrome.tabs.get = async (id) => {
      await esperar(margen)
      return lee(id)
    }
    try {
      await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
      await esperar(margen * 1.5)
      await rig.send({ type: MSG.CONTENT_READY, url: SALTO_DC.destination.url, pageId: '200' }, { tab: { id: 1 } })
      await esperar(margen)
      eq(finales(rig).map((m) => m.result), [ANCLADO], 'un final, el bueno')
    } finally {
      globalThis.chrome.tabs.get = lee
    }
  })
})

test('H28 rev: el salto que acaba en otra página lo dice, sin «Recárgala»', async () => {
  // Un login, una incidencia movida (OLD-12 → NEW-34): la pestaña llegó a otra
  // página, y «no ha avisado de que cargó. Recárgala» aconsejaba lo que no
  // arregla nada (revisión adversaria de H28, G2). Sólo se afirma con una URL
  // que lo prueba —un id o una clave que no son los del destino, o una ruta de
  // login—, y sin su consulta; un `/display/…` de un Data Center no lleva id:
  // ahí no se sabe, y queda el motivo de siempre.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    const incidencia = { ...PLAN, mode: 'direct', steps: [], destination: { kind: 'jira-issue', id: 'OLD-12', title: 'OLD-12', url: JIRA + '/browse/OLD-12' } }
    // Un destino por `/display/` que el Data Center reescribe a
    // `viewpage.action?pageId=` (un título con caracteres raros) sigue siendo él.
    const porDisplay = { ...SALTO_DC, destination: { ...SALTO_DC.destination, url: DC + '/display/ENG/ADR-014' } }
    const casos = [
      [porDisplay, DC + '/pages/viewpage.action?pageId=200', SIN_AVISO],
      [SALTO_DC, DC + '/login.action?os_destination=%2Fpages%2Fviewpage.action%3FpageId%3D200', 'La pestaña ha acabado en otra página (/login.action), no en «ADR-014».'],
      [incidencia, JIRA + '/browse/NEW-34', 'La pestaña ha acabado en otra página (/browse/NEW-34), no en «OLD-12».'],
      [SALTO_DC, 'https://id.atlassian.com/login?continue=x', 'La pestaña ha acabado en otra página (id.atlassian.com/login), no en «ADR-014».'],
      [SALTO_DC, DC + '/pages/viewpage.action?pageId=300', 'La pestaña ha acabado en otra página (/pages/viewpage.action), no en «ADR-014».'],
      [SALTO_DC, DC + '/display/ENG/Otra', SIN_AVISO],
      [SALTO_DC, DC + '/spaces/ENG/pages/200/ADR-014', SIN_AVISO],
      [incidencia, JIRA + '/browse/OLD-12?focusedCommentId=5', SIN_AVISO],
    ]
    for (const [plan, dondeAcaba, motivo] of casos) {
      rig.state.panelMessages.length = 0
      rig.state.tabs[1].url = PARTIDA
      await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan })
      rig.state.tabs[1].url = dondeAcaba
      await esperar(MARGEN_MS + 20)
      eq(finales(rig).map((m) => m.result), [{ error: motivo }], dondeAcaba)
    }
  })
})

test('H28 rev: un proyecto /browse/CLAVE llega por su clave, y un aviso sin clave u otro proyecto no', async () => {
  // Medido en el Jira de Marco (revisión adversaria de H28, G4): `/browse/SIMPL`
  // responde con un 302 a `/projects/SIMPL/summary` o reescribe la URL a
  // `/projects/SIMPL/issues/…`, y `parseAtlassianUrl` no saca clave de
  // `/browse/SIMPL` (sólo de `/browse/X-123`): comparando con la clave de la URL
  // del destino, el salto no llegaba nunca. Cuenta la identidad VALIDADA del
  // destino (`d.id`) y, en un tablero `RapidBoard.jspa`, el `projectKey` de la
  // consulta.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? ANCLADO : { ok: true })
    const proyecto = (id) => ({ ...PLAN, mode: 'direct', steps: [], anchor: null, destination: { kind: 'jira-project', id, title: id || 'Sin clave', url: JIRA + '/browse/SIMPL' } })
    const aviso = async (plan, url) => {
      rig.state.sentToTab.length = 0
      rig.state.panelMessages.length = 0
      rig.state.tabs[1].url = PARTIDA
      eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan })).navigating, true)
      await rig.send({ type: MSG.CONTENT_READY, url, pageId: '' }, { tab: { id: 1 } })
      const hecho = [anclas(rig).length, finales(rig).length]
      await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
      return hecho
    }
    for (const url of [
      JIRA + '/projects/SIMPL/summary',
      JIRA + '/projects/SIMPL/issues/SIMPL-31748?filter=allopenissues',
      JIRA + '/secure/RapidBoard.jspa?rapidView=12&projectKey=SIMPL',
    ]) {
      eq(await aviso(proyecto('SIMPL'), url), [1, 1], url)
    }
    eq(await aviso(proyecto('simpl'), JIRA + '/projects/SIMPL/summary'), [1, 1], 'la clave del destino, en mayúsculas como las de las URL')
    for (const url of [
      JIRA + '/secure/Dashboard.jspa',
      JIRA + '/projects/OPS/summary',
      JIRA + '/secure/RapidBoard.jspa?rapidView=12&projectKey=OPS',
      'https://otro.example/projects/SIMPL/summary',
    ]) {
      eq(await aviso(proyecto('SIMPL'), url), [0, 0], url)
    }
    eq(await aviso(proyecto(''), JIRA + '/secure/Dashboard.jspa'), [0, 0], 'un destino sin clave no llega con un aviso sin clave')
  })
})

test('H28 rev: «Llévame» de una búsqueda a otra navega, y a la misma en su vista de detalle es «ya estoy»', async () => {
  // Una búsqueda no tiene id ni clave, y `samePage` cae en origen y ruta: con
  // la pestaña en `/issues/?jql=A`, «Llévame» a `?jql=B` daba «ya estoy» y
  // anclaba en la vieja sin moverse (heredado de `sameDoc`; revisión adversaria
  // de H28, G4). Ahora se compara la consulta (`sameSearch`), en cualquier ruta.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    const plan = busqueda('project = OPS')
    for (const [aqui, navega] of [
      [JIRA + '/issues/?jql=' + encodeURIComponent('project = SIMPL'), true],
      [JIRA + '/browse/OPS-9?jql=' + encodeURIComponent('project = OPS'), false],
      [JIRA + '/issues/?jql=project+%3D+OPS&selectedIssue=OPS-9', false],
      [JIRA + '/browse/OPS-9?jql=' + encodeURIComponent('project = SIMPL'), true],
      [JIRA + '/browse/OPS-9', true],
    ]) {
      rig.state.tabs[1].url = aqui
      eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan })).navigating, navega, aqui)
      eq(rig.state.tabs[1].url, navega ? plan.destination.url : aqui, 'la pestaña, donde toca')
      await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
    }
  })
})

test('H28 rev: el aviso de la misma búsqueda en su vista de detalle, o con la incidencia elegida, llega; el de otra no', async () => {
  // Un Data Center reescribe la búsqueda a `/browse/K?jql=…` al abrir la
  // primera incidencia, y Cloud le añade `&selectedIssue=`: con `samePage`, una
  // clave de un lado y ninguna del otro no casaban, y a los 12 s salía «no ha
  // avisado» con la búsqueda abierta (revisión adversaria de H28, G4).
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? { ok: true } : { ok: true })
    const plan = busqueda('project = OPS')
    for (const [url, llega] of [
      [JIRA + '/browse/OPS-9?jql=' + encodeURIComponent('project = OPS'), true],
      [JIRA + '/issues/?jql=' + encodeURIComponent('project = OPS') + '&selectedIssue=OPS-9', true],
      [JIRA + '/browse/SIMPL-9?jql=' + encodeURIComponent('project = SIMPL'), false],
      [JIRA + '/issues/', false],
    ]) {
      rig.state.sentToTab.length = 0
      rig.state.panelMessages.length = 0
      rig.state.tabs[1].url = PARTIDA
      await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan })
      await rig.send({ type: MSG.CONTENT_READY, url, pageId: '' }, { tab: { id: 1 } })
      eq([anclas(rig).length, finales(rig).length], llega ? [1, 1] : [0, 0], url)
      await rig.send({ type: MSG.CANCEL_PLAN, tabId: 1 })
    }
  })
})

test('H28 rev: un salto directo cuyo tabs.update lanza no deja el recorrido esperando', async () => {
  // Si `tabs.update` lanzaba entre guardar la fase 'anchor' y armar el
  // vigilante, el recorrido se quedaba en `faro:plans` sin plazo, y el primer
  // aviso del destino en esa pestaña, a cualquier hora, lo anclaba (revisión
  // adversaria de H28, G8). «Navigation rejected.» es lo que da Chrome cuando
  // su capa de contenido rechaza el salto.
  const rig = makeChrome()
  await loadWorker(rig)
  const actualiza = globalThis.chrome.tabs.update
  const error = console.error
  const errores = []
  console.error = (...args) => errores.push(args.map(String).join(' '))
  globalThis.chrome.tabs.update = async () => {
    throw new Error('Navigation rejected.')
  }
  try {
    await conMargenCorto(rig, async () => {
      rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? ANCLADO : { ok: true })
      const res = await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
      eq(res, { ok: false, error: 'Navigation rejected.' }, 'el panel recibe el motivo, sin `avisado`: no se le mandó ningún final')
      eq(rig.state.session['faro:plans']?.['1'], undefined, 'y el recorrido no se queda esperando')
      globalThis.chrome.tabs.update = actualiza
      await rig.send({ type: MSG.CONTENT_READY, url: DC + '/display/ENG/ADR-014', pageId: '200' }, { tab: { id: 1 } })
      await esperar(MARGEN_MS + 20)
      eq([anclas(rig), finales(rig)], [[], []], 'un aviso posterior del destino no ancla un salto que no salió')
      eq(errores.length, 1, 'el fallo, en la consola una vez: ' + JSON.stringify(errores))

      // Y sólo suelta SU recorrido: si mientras su salto fallaba se lanzó otro
      // en la misma pestaña, el otro sigue esperando su aviso.
      const otro = { ...SALTO_DC, destination: { ...SALTO_DC.destination, id: '300', url: DC + '/pages/viewpage.action?pageId=300' } }
      globalThis.chrome.tabs.update = async (id, cambio) => {
        if (cambio.url !== SALTO_DC.destination.url) return actualiza(id, cambio)
        await esperar(20)
        throw new Error('Navigation rejected.')
      }
      const lento = rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
      await esperar(5)
      eq((await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: otro })).navigating, true)
      eq(await lento, { ok: false, error: 'Navigation rejected.' })
      eq(rig.state.session['faro:plans']?.['1']?.plan?.destination?.id, '300', 'el salto que sí salió')
      globalThis.chrome.tabs.update = actualiza
    })
  } finally {
    globalThis.chrome.tabs.update = actualiza
    console.error = error
  }
})

test('H28 rev: el último paso por URL que no sale se lo dice al panel, también retomado por CONTENT_READY', async () => {
  // Retomado por el aviso de la pestaña, el error de `tabs.update` volvía como
  // respuesta al content script, que la tira: el panel no recibía ningún final
  // y se quedaba con «paso 3/3» y su «Parar» (revisión adversaria de H28, G8).
  // Desde el panel, lo mismo y con `avisado`: ya tiene su final, y no lo repite.
  const rig = makeChrome()
  await loadWorker(rig)
  const actualiza = globalThis.chrome.tabs.update
  globalThis.chrome.tabs.update = async () => {
    throw new Error('Navigation rejected.')
  }
  try {
    await conMargenCorto(rig, async () => {
      const motivo = 'No he podido llevarte al destino: Navigation rejected.'
      recorrido(rig, { status: 'navigate', reason: 'no localizado' })
      eq(await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN }), { ok: false, error: motivo, avisado: true })
      eq(finales(rig).map((m) => m.result), [{ error: motivo }])
      eq(rig.state.session['faro:plans']?.['1'], undefined)

      rig.state.panelMessages.length = 0
      let n = 0
      rig.state.contentReply = (msg) => {
        if (msg.type !== MSG.STEP) return { ok: true }
        n++
        if (n === 1) return null
        return n < 4 ? { status: 'expanded' } : { status: 'navigate', reason: 'no localizado' }
      }
      eq((await rig.send({ type: MSG.START_PLAN, tabId: 1, plan: PLAN })).waiting, true, 'el primer paso cae en plena recarga')
      eq(await rig.send({ type: MSG.CONTENT_READY, url: PARTIDA, pageId: '400' }, { tab: { id: 1 } }), { ok: true }, 'al content script, lo de siempre')
      eq(finales(rig).map((m) => m.result), [{ error: motivo }], 'y el panel se entera')
      eq(rig.state.session['faro:plans']?.['1'], undefined)
    })
  } finally {
    globalThis.chrome.tabs.update = actualiza
  }
})

test('H28 rev: el pageId de otro host no ancla el salto, ni el de otra viewpage.action', async () => {
  // La rama del `pageId` no miraba el host: un aviso de otro sitio con el mismo
  // número anclaba el salto (revisión adversaria de H28, G8). Y un aviso de OTRA
  // `viewpage.action` tampoco llega por la ruta, que es la de todas: es lo que
  // hacía `sameDoc`, y esta prueba lo caza si vuelve delante de `samePage`.
  const rig = makeChrome()
  await loadWorker(rig)
  await conMargenCorto(rig, async () => {
    rig.state.contentReply = (msg) => (msg.type === MSG.ANCHOR ? ANCLADO : { ok: true })
    await rig.send({ type: MSG.NAVIGATE_DIRECT, tabId: 1, plan: SALTO_DC })
    await rig.send({ type: MSG.CONTENT_READY, url: 'https://otro.atlassian.net/wiki/spaces/X/pages/200/Otra', pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'otro host con el mismo pageId')
    await rig.send({ type: MSG.CONTENT_READY, url: DC + '/pages/viewpage.action?pageId=100', pageId: '100' }, { tab: { id: 1 } })
    eq([anclas(rig), finales(rig)], [[], []], 'otra viewpage.action del mismo sitio')
    await rig.send({ type: MSG.CONTENT_READY, url: DC + '/display/ENG/ADR-014', pageId: '200' }, { tab: { id: 1 } })
    eq([anclas(rig).length, finales(rig).map((m) => m.result)], [1, [ANCLADO]], 'el destino, en su sitio')
  })
})
