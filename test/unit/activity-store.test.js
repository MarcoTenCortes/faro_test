/**
 * El diario y la caché de «hoy» contra un `chrome.storage` de mentira
 * (src/shared/activity-store.js), como en memory.test.js y storage.test.js.
 *
 * Lo que se comprueba aquí no es la forma del diario —de eso va
 * activity.test.js— sino lo que sólo se ve tocando el almacén: que por aquí no
 * pasa nada sin normalizar, que un host sin nada guardado no deja una clave
 * vacía, que el diario de un host no es el de otro, y que dos eventos seguidos
 * del MISMO contexto no se pisan (la cola), que es la mitad de lo que hace
 * inofensiva la carrera entre el service worker y el panel.
 */
import { test, eq, assert } from '../harness.js'
import { STORAGE_KEYS } from '../../src/shared/config.js'
import {
  CLEAR_GRACE_MS,
  clearActivity,
  clearTodayCache,
  dismissActivity,
  getActivity,
  getTodayCache,
  recordActivity,
  saveActivity,
  saveTodayCache,
} from '../../src/shared/activity-store.js'

const HOST = 'jira.simplprogramme.eu'
const OTRO = 'confluence.simplprogramme.eu'
const CLAVE = STORAGE_KEYS.activity(HOST)
const AHORA = Date.UTC(2026, 8, 20, 9, 0, 0)
const DIA = 24 * 60 * 60 * 1000

/**
 * Ejecuta `fn` con `chrome.storage.local` y `.session` simulados y los retira al
 * salir. `diario` apunta cada lectura, escritura y borrado, porque hay cosas
 * —«leer no escribe», «esto no deja la clave puesta»— que sólo se ven contando.
 */
async function conChrome(inicial, fn) {
  const previo = globalThis.chrome
  const local = { ...(inicial?.local || {}) }
  const session = { ...(inicial?.session || {}) }
  const clon = (v) => JSON.parse(JSON.stringify(v))
  const diario = { gets: [], sets: [], removed: [], sessionSets: [], sessionRemoved: [] }
  const area = (almacen, pon, quita) => ({
    get: async (k) => {
      const claves = Array.isArray(k) ? k : [k]
      const out = {}
      for (const clave of claves) if (clave in almacen) out[clave] = clon(almacen[clave])
      return out
    },
    set: async (o) => {
      pon(Object.keys(o))
      for (const [k, v] of Object.entries(o)) almacen[k] = clon(v)
    },
    remove: async (k) => {
      quita(k)
      for (const clave of Array.isArray(k) ? k : [k]) delete almacen[clave]
    },
  })
  globalThis.chrome = {
    storage: {
      local: {
        ...area(
          local,
          (k) => diario.sets.push(k),
          (k) => diario.removed.push(k)
        ),
        get: async (k) => {
          diario.gets.push(k)
          const claves = Array.isArray(k) ? k : [k]
          const out = {}
          for (const clave of claves) if (clave in local) out[clave] = clon(local[clave])
          return out
        },
      },
      session: area(
        session,
        (k) => diario.sessionSets.push(k),
        (k) => diario.sessionRemoved.push(k)
      ),
    },
  }
  try {
    await fn(diario, local, session)
  } finally {
    if (previo === undefined) delete globalThis.chrome
    else globalThis.chrome = previo
  }
}

const VISITA = { event: 'seen', kind: 'jira-issue', id: 'ENG-7', title: 'Consent API v2', path: '/browse/ENG-7' }

// ------------------------------------------------------------------- leer

test('almacén: sin nada guardado el diario está vacío y leer no escribe', async () => {
  await conChrome({}, async (diario) => {
    const a = await getActivity(HOST, { now: AHORA })
    eq(a, { version: 1, host: HOST, items: {}, dismissed: {} })
    eq(diario.gets, [CLAVE], 'una sola lectura, y de su clave')
    eq(diario.sets, [], 'leer no escribe')
    eq(diario.removed, [], 'ni borra')
  })
})

test('almacén: lo guardado se reconstruye al leer, y lo caducado no sale', async () => {
  await conChrome(
    {
      local: {
        [CLAVE]: {
          version: 1,
          host: HOST,
          items: {
            'jira-issue:ENG-7': { kind: 'jira-issue', id: 'ENG-7', seenAt: AHORA - DIA, seenCount: 2, onclick: 'alert(1)' },
            'jira-issue:ENG-9': { kind: 'jira-issue', id: 'ENG-9', seenAt: AHORA - 40 * DIA, seenCount: 1 },
            'no-es-una-clave': { seenAt: AHORA },
          },
          dismissed: {},
        },
      },
    },
    async (diario) => {
      const a = await getActivity(HOST, { now: AHORA })
      eq(Object.keys(a.items), ['jira-issue:ENG-7'], 'lo de hace 40 días y lo que no es una entrada se quedan fuera')
      assert(!('onclick' in a.items['jira-issue:ENG-7']), 'y las claves que no son suyas tampoco salen')
      eq(diario.sets, [], 'pero leer sigue sin escribir: se limpia en la primera escritura')
    }
  )
})

// ---------------------------------------------------------------- escribir

test('almacén: apuntar una visita guarda el diario normalizado bajo su host', async () => {
  await conChrome({}, async (diario, local) => {
    const a = await recordActivity(HOST, VISITA, { now: AHORA })
    eq(a.items['jira-issue:ENG-7'].seenCount, 1)
    eq(diario.sets, [[CLAVE]], 'una escritura, y de su clave')
    eq(local[CLAVE].items['jira-issue:ENG-7'].title, 'Consent API v2')
    eq(local[CLAVE].version, 1)
    // Lo que se guarda es exactamente lo que se lee: nada pasa sin normalizar.
    eq(await getActivity(HOST, { now: AHORA }), a)
  })
})

test('almacén: el diario de un host no es el de otro', async () => {
  await conChrome({}, async (diario, local) => {
    await recordActivity(HOST, VISITA, { now: AHORA })
    await recordActivity(OTRO, { event: 'source', kind: 'confluence-page', id: '3003' }, { now: AHORA })
    eq(Object.keys(local).sort(), [STORAGE_KEYS.activity(OTRO), CLAVE].sort())
    eq(Object.keys(local[CLAVE].items), ['jira-issue:ENG-7'])
    eq(Object.keys(local[STORAGE_KEYS.activity(OTRO)].items), ['confluence-page:3003'])
  })
})

test('SEGURIDAD: por guardar no pasa nada sin reconstruir', async () => {
  // `saveActivity` es la única puerta de escritura, así que es donde tiene que
  // morder: un diario con una clave que no es una entrada, un `onclick`, una
  // ruta absoluta o algo de hace cuarenta días no puede quedarse guardado
  // porque quien llamó no lo hubiera limpiado antes.
  await conChrome({}, async (diario, local) => {
    const guardado = await saveActivity(
      HOST,
      {
        version: 1,
        host: HOST,
        items: {
          'jira-issue:ENG-7': {
            seenAt: AHORA,
            seenCount: 1,
            title: 'Consent API v2',
            path: 'https://jira.simplprogramme.eu/browse/ENG-7?jwt=SECRETO',
            onclick: 'alert(1)',
          },
          'jira-issue:ENG-9': { seenAt: AHORA - 40 * DIA, seenCount: 1 },
          'esto no es una clave': { seenAt: AHORA },
        },
        dismissed: {},
      },
      { now: AHORA }
    )
    eq(Object.keys(guardado.items), ['jira-issue:ENG-7'])
    eq(Object.keys(local[CLAVE].items), ['jira-issue:ENG-7'], 'y en el almacén, lo mismo')
    const item = local[CLAVE].items['jira-issue:ENG-7']
    eq(item.path, '', 'una ruta absoluta no sobrevive a la escritura')
    assert(!('onclick' in item))
    assert(!JSON.stringify(local[CLAVE]).includes('SECRETO'))
  })
})

test('almacén: guardar un diario vacío quita la clave en vez de dejar un objeto', async () => {
  await conChrome({ local: { [CLAVE]: { version: 1, host: HOST, items: {}, dismissed: {} } } }, async (diario, local) => {
    await saveActivity(HOST, { version: 1, host: HOST, items: {}, dismissed: {} }, { now: AHORA })
    eq(CLAVE in local, false, 'un host visitado sin nada que apuntar no deja basura')
    eq(diario.removed, [CLAVE])
    eq(diario.sets, [])
  })
})

test('almacén: un evento que no vale no escribe un diario con basura', async () => {
  await conChrome({}, async (diario, local) => {
    await recordActivity(HOST, { event: 'seen', kind: 'jira-issue', id: 'ENG' }, { now: AHORA })
    eq(CLAVE in local, false, 'una clave que no vale no crea ninguna entrada')
    await recordActivity(HOST, { event: 'loquesea', kind: 'jira-issue', id: 'ENG-7' }, { now: AHORA })
    eq(CLAVE in local, false, 'ni un evento que no existe')
  })
})

test('almacén: el panel y el worker escriben campos distintos de la misma entrada', async () => {
  await conChrome({}, async (diario, local) => {
    await recordActivity(HOST, VISITA, { now: AHORA })
    await recordActivity(
      HOST,
      { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', notes: 6, family: 'api' },
      { now: AHORA + DIA }
    )
    const item = local[CLAVE].items['jira-issue:ENG-7']
    eq(item.seenCount, 1, 'el análisis no se lleva la visita')
    eq(item.seenAt, AHORA)
    eq(item.analyzedCount, 1)
    eq(item.notes, 6)
    eq(item.family, 'api')
  })
})

test('almacén: dos eventos seguidos del mismo contexto no se pisan (la cola)', async () => {
  // Sin cola, dos lee-funde-escribe solapados dejarían sólo el último: los dos
  // leen el mismo diario vacío y el segundo escribe encima del primero.
  await conChrome({}, async (diario, local) => {
    await Promise.all([
      recordActivity(HOST, VISITA, { now: AHORA }),
      recordActivity(HOST, { event: 'seen', kind: 'confluence-page', id: '3003', title: 'Guía' }, { now: AHORA }),
      recordActivity(HOST, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', notes: 2 }, { now: AHORA }),
    ])
    const items = local[CLAVE].items
    eq(Object.keys(items).sort(), ['confluence-page:3003', 'jira-issue:ENG-7'], 'no se pierde ninguna entrada')
    eq(items['jira-issue:ENG-7'].seenCount, 1, 'ni el campo de un escritor')
    eq(items['jira-issue:ENG-7'].analyzedCount, 1, 'ni el del otro')
  })
})

test('almacén: un descarte y un análisis a la vez no se pisan (la cola, también para «Ya lo he visto»)', async () => {
  // EL CAMBIO (revisión adversaria de H11): «Ya lo he visto» hacía su propio
  // lee-funde-escribe en el panel (`getActivity` + `saveActivity` sueltos), fuera
  // de esta cola, así que con un análisis terminando a la vez se perdía uno de
  // los dos. Ahora entra por `dismissActivity`, que va DENTRO de `cola`.
  await conChrome({}, async (diario, local) => {
    await Promise.all([
      dismissActivity(HOST, 'jira-issue:ENG-7', AHORA - DIA, { now: AHORA }),
      recordActivity(HOST, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-9', notes: 4 }, { now: AHORA }),
    ])
    eq(local[CLAVE].dismissed, { 'jira-issue:ENG-7': AHORA }, 'el descarte sigue ahí')
    eq(Object.keys(local[CLAVE].items), ['jira-issue:ENG-9'], 'y el análisis del otro evento también')
    eq(local[CLAVE].items['jira-issue:ENG-9'].analyzedCount, 1)
  })
})

test('almacén: cuando caduca el último descarte, la clave del host se va', async () => {
  // Un «ya lo he visto» era lo único que podía dejar la clave puesta para
  // siempre: `dismissed` no caducaba, así que `saveActivity` nunca la veía vacía
  // y el diario de un host seguía guardado con 0 entradas dentro (§8.20).
  const viejo = { version: 1, host: HOST, items: {}, dismissed: { 'confluence-page:9': AHORA - 40 * DIA } }
  await conChrome({ local: { [CLAVE]: viejo } }, async (diario, local) => {
    eq(await getActivity(HOST, { now: AHORA }), { version: 1, host: HOST, items: {}, dismissed: {} }, 'al leer ya no sale')
    await recordActivity(HOST, { event: 'seen', kind: 'jira-issue', id: 'ENG' }, { now: AHORA })
    eq(CLAVE in local, false, 'y la primera escritura se lleva la clave')
    eq(diario.removed, [CLAVE])
  })
})

/**
 * Los dos escritores del diario viven en contextos distintos (el service worker
 * y el panel) con su propia cola, y eso no se puede simular con un solo módulo
 * cargado: la cola los serializaría. Con una consulta en el especificador, Node
 * carga OTRA instancia del módulo, con su `colas` propia, sobre el mismo
 * `chrome.storage` — que es exactamente la situación de verdad.
 */
async function otroContexto() {
  return import('../../src/shared/activity-store.js?contexto=worker')
}

test('SEGURIDAD: una escritura del otro contexto no devuelve un diario recién borrado', async () => {
  // EL CAMBIO (revisión adversaria de H11): el worker lee el diario, el usuario
  // pulsa «Borrar mi actividad» (o «Olvidar este sitio») y el worker guarda lo
  // que había leído unos milisegundos después. La clave volvía ENTERA, con todo
  // lo que el usuario acababa de pedir que se fuera.
  const worker = await otroContexto()
  const antes = {
    version: 1,
    host: HOST,
    items: {
      'jira-issue:ENG-7': { kind: 'jira-issue', id: 'ENG-7', seenAt: AHORA - DIA, seenCount: 5, title: 'Consent API v2' },
      'jira-issue:ENG-9': { kind: 'jira-issue', id: 'ENG-9', seenAt: AHORA - DIA, seenCount: 3, title: 'Otra' },
    },
    dismissed: { 'confluence-page:3003': AHORA - DIA },
  }
  for (const [nombre, escribir] of [
    ['una visita', () => worker.recordActivity(HOST, VISITA, { now: AHORA })],
    ['un descarte', () => worker.dismissActivity(HOST, 'jira-issue:ENG-7', AHORA - DIA, { now: AHORA })],
  ]) {
    await conChrome({ local: { [CLAVE]: antes } }, async (diario, local) => {
      // La lectura del otro contexto se queda esperando justo después de leer:
      // es el hueco en el que el usuario pulsa el botón.
      const leer = globalThis.chrome.storage.local.get
      let soltar
      const puerta = new Promise((r) => (soltar = r))
      let primera = true
      globalThis.chrome.storage.local.get = async (k) => {
        const got = await leer(k)
        if (primera && String(k).includes('actividad')) {
          primera = false
          await puerta
        }
        return got
      }

      const enVuelo = escribir()
      await Promise.resolve()
      await clearActivity(HOST)
      eq(CLAVE in local, false, nombre + ': el borrado se lleva la clave')
      soltar()
      await enVuelo

      const guardado = local[CLAVE] || { items: {}, dismissed: {} }
      assert(!('jira-issue:ENG-9' in guardado.items), nombre + ': lo borrado no vuelve — ' + JSON.stringify(guardado))
      assert(!('confluence-page:3003' in guardado.dismissed), nombre + ': ni los descartes de antes')
      if (nombre === 'una visita') {
        // La visita de AHORA sí es legítima: pasó después del borrado.
        eq(Object.keys(guardado.items), ['jira-issue:ENG-7'])
        eq(guardado.items['jira-issue:ENG-7'].seenCount, 1, 'y empieza a contar de cero, no de cinco')
      } else {
        eq(Object.keys(guardado.items), [], 'un descarte no resucita ninguna entrada')
        eq(guardado.dismissed, { 'jira-issue:ENG-7': AHORA })
      }
    })
  }
})

test('SEGURIDAD: la marca de borrado se pone ANTES de quitar la clave', async () => {
  // Entre las dos cosas cabe una escritura del otro contexto, y lo que decide si
  // ve el borrado es el orden: con la marca detrás, esa escritura lee «aquí no se
  // ha borrado nada» y funde sobre el diario que todavía está en el almacén.
  const worker = await otroContexto()
  const antes = {
    version: 1,
    host: HOST,
    items: { 'jira-issue:ENG-9': { kind: 'jira-issue', id: 'ENG-9', seenAt: AHORA - DIA, seenCount: 3 } },
    dismissed: {},
  }
  await conChrome({ local: { [CLAVE]: antes } }, async (diario, local) => {
    // El borrado se queda a medias: la marca ya está puesta (o no, según el
    // orden) y la clave todavía no se ha ido.
    const quitar = globalThis.chrome.storage.local.remove
    let soltar
    const puerta = new Promise((r) => (soltar = r))
    let primera = true
    globalThis.chrome.storage.local.remove = async (k) => {
      if (primera && String(k).includes('actividad')) {
        primera = false
        await puerta
      }
      return quitar(k)
    }

    const borrando = clearActivity(HOST)
    try {
      await Promise.resolve()
      // Y en ese hueco, el worker guarda la visita que había leído antes.
      const guardado = await worker.recordActivity(HOST, VISITA, { now: AHORA })
      assert(!('jira-issue:ENG-9' in guardado.items), 'lo de antes del borrado no se refunde: ' + JSON.stringify(guardado.items))
      eq(guardado.items['jira-issue:ENG-7'].seenCount, 1)
    } finally {
      // Siempre, y aunque la prueba falle: la cola de este host es del módulo, y
      // dejarla con un borrado a medias colgaría todas las pruebas de después.
      soltar()
      await borrando
    }
    eq(CLAVE in local, false, 'y el borrado acaba llevándose la clave')
  })
})

test('SEGURIDAD: el margen de la marca no depende de que el reloj no avance, y una marca vieja no borra nada', async () => {
  // EL CAMBIO: la prueba de arriba pasaba casi siempre y falló una vez. La
  // escritura que empieza entre «poner la marca» y «quitar la clave» nace DESPUÉS
  // de la marca; con `marca >= t0` a secas sólo se salvaba si `Date.now()` no
  // había avanzado entre los dos (en Windows salta de 16 en 16 ms). Aquí el reloj
  // avanza a propósito.
  const worker = await otroContexto()
  eq(CLEAR_GRACE_MS, 1000)
  const antes = {
    version: 1,
    host: HOST,
    items: { 'jira-issue:ENG-9': { kind: 'jira-issue', id: 'ENG-9', seenAt: AHORA - DIA, seenCount: 3 } },
    dismissed: {},
  }
  const relojDeVerdad = Date.now
  const MARCA = STORAGE_KEYS.activityCleared(HOST)
  try {
    // (1) La marca se puso hace 40 ms y la clave TODAVÍA está: lo leído es lo que
    // se está borrando, y no se refunde.
    let ahora = 1_800_000_000_000
    Date.now = () => ahora
    await conChrome({ local: { [CLAVE]: antes }, session: { [MARCA]: ahora - 40 } }, async () => {
      const guardado = await worker.recordActivity(HOST, VISITA, { now: AHORA })
      eq(Object.keys(guardado.items), ['jira-issue:ENG-7'], 'a medio borrar: sólo la visita de ahora')
    })
    await conChrome({ local: { [CLAVE]: antes }, session: { [MARCA]: ahora - 40 } }, async () => {
      const descartado = await worker.dismissActivity(HOST, 'jira-issue:ENG-7', AHORA - DIA, { now: AHORA })
      eq(Object.keys(descartado.items), [], 'y un descarte tampoco refunde lo de antes')
    })
    // (2) Una marca de hace un minuto es historia: el diario que hay es de
    // DESPUÉS de aquel borrado y se funde como siempre.
    await conChrome({ local: { [CLAVE]: antes }, session: { [MARCA]: ahora - 60_000 } }, async () => {
      const guardado = await worker.recordActivity(HOST, VISITA, { now: AHORA })
      eq(Object.keys(guardado.items).sort(), ['jira-issue:ENG-7', 'jira-issue:ENG-9'], 'una marca vieja no borra nada')
      eq(guardado.items['jira-issue:ENG-9'].seenCount, 3)
    })
    // (3) Justo en el borde del margen: dentro cuenta, un milisegundo fuera no.
    await conChrome({ local: { [CLAVE]: antes }, session: { [MARCA]: ahora - CLEAR_GRACE_MS } }, async () => {
      const guardado = await worker.recordActivity(HOST, VISITA, { now: AHORA })
      eq(Object.keys(guardado.items), ['jira-issue:ENG-7'], 'en el borde todavía es «durante el borrado»')
    })
    await conChrome({ local: { [CLAVE]: antes }, session: { [MARCA]: ahora - CLEAR_GRACE_MS - 1 } }, async () => {
      const guardado = await worker.recordActivity(HOST, VISITA, { now: AHORA })
      eq(Object.keys(guardado.items).length, 2, 'un milisegundo fuera del margen ya no')
    })
  } finally {
    Date.now = relojDeVerdad
  }
})

test('almacén: «Borrar mi actividad» se lleva la clave entera de ese host', async () => {
  await conChrome({}, async (diario, local) => {
    await recordActivity(HOST, VISITA, { now: AHORA })
    await recordActivity(OTRO, { event: 'seen', kind: 'confluence-page', id: '3003' }, { now: AHORA })
    await clearActivity(HOST)
    eq(CLAVE in local, false)
    assert(STORAGE_KEYS.activity(OTRO) in local, 'y no toca el de otro sitio')
    eq(await getActivity(HOST, { now: AHORA }), { version: 1, host: HOST, items: {}, dismissed: {} })
  })
})

// ------------------------------------------------------ la caché de «hoy»

test('caché: lo que contestaron las API vive en storage.session, no en local', async () => {
  await conChrome({}, async (diario, local, session) => {
    const cache = { fetchedAt: AHORA, remote: { jira: [{ key: 'ENG-7' }], confluence: [] }, errors: [] }
    await saveTodayCache(HOST, cache)
    eq(diario.sessionSets, [[STORAGE_KEYS.today(HOST)]])
    eq(Object.keys(local), [], 'nada de esto ocupa el almacén de verdad: se va al cerrar Chrome')
    eq(await getTodayCache(HOST), cache)

    await clearTodayCache(HOST)
    eq(diario.sessionRemoved, [STORAGE_KEYS.today(HOST)])
    eq(await getTodayCache(HOST), null)
  })
})

test('caché: sin una fecha utilizable no hay caché, y así se vuelve a preguntar', async () => {
  await conChrome(
    {
      session: {
        [STORAGE_KEYS.today(HOST)]: { remote: {} },
        [STORAGE_KEYS.today(OTRO)]: 'no es un objeto',
      },
    },
    async () => {
      eq(await getTodayCache(HOST), null, 'sin fetchedAt no se sabe si está caducada')
      eq(await getTodayCache(OTRO), null)
    }
  )
})
