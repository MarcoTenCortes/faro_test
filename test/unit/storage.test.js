/**
 * El almacén del panel (src/shared/storage.js), con un `chrome.storage` de
 * mentira como el de memory.test.js.
 *
 * Lo que se comprueba aquí es sobre todo `getSiteBundle`, que es el arreglo de
 * H6-P4: el arranque encadenaba trece lecturas —cinco de ellas el mismo
 * `getSite` del mismo host— y ahora son UNA. La prueba cuenta las llamadas al
 * almacén, no sólo el resultado: si mañana alguien parte el paquete en dos
 * lecturas, el resultado seguiría siendo el mismo y la mejora se habría ido
 * sin que nada fallara.
 *
 * storage.js no toca `chrome` al importarse: sólo dentro de cada función. Por
 * eso el `chrome` se instala en cada prueba y se retira al salir. Lo guardado
 * se clona, como hace chrome.storage de verdad.
 */
import { test, eq, assert } from '../harness.js'
import { STORAGE_KEYS } from '../../src/shared/config.js'
import { INDEX_VERSION } from '../../src/atlassian/index-store.js'
import {
  getIndex,
  getSite,
  getSiteBundle,
  bundleKeys,
  BUNDLE_EXTRA_KEYS,
  getSessionWeight,
  setSessionWeight,
  clearSessionWeight,
} from '../../src/shared/storage.js'

const HOST = 'confluence.simplprogramme.eu'
const OTRO = 'jira.simplprogramme.eu'

/**
 * Ejecuta `fn` con un `chrome.storage.local` simulado y lo retira al salir.
 * Devuelve el almacén y el diario de llamadas: `gets` lleva el argumento de
 * cada lectura (cadena o lista) y `removed` lo que se haya borrado.
 */
async function conChrome(inicial, fn) {
  const previo = globalThis.chrome
  const local = { ...inicial }
  const clon = (v) => JSON.parse(JSON.stringify(v))
  const diario = { gets: [], removed: [], sets: [] }
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => {
          diario.gets.push(k)
          const claves = Array.isArray(k) ? k : [k]
          const out = {}
          for (const clave of claves) if (clave in local) out[clave] = clon(local[clave])
          return out
        },
        set: async (o) => {
          diario.sets.push(Object.keys(o))
          for (const [k, v] of Object.entries(o)) local[k] = clon(v)
        },
        remove: async (k) => {
          diario.removed.push(k)
          delete local[k]
        },
      },
    },
  }
  try {
    await fn(diario, local)
  } finally {
    if (previo === undefined) delete globalThis.chrome
    else globalThis.chrome = previo
  }
}

const SITIO = { host: HOST, configured: true, product: 'confluence', skill: 'analisis', model: 'x/y', onboarded: true }
const INDICE = { version: INDEX_VERSION, host: HOST, pages: {}, spaces: {}, projects: {}, issues: {} }

// ---- las claves que se leen -------------------------------------------------

test('bundle: las claves del paquete son las cuatro de siempre, sin repetir', () => {
  eq(bundleKeys(HOST), [
    'faro:sites',
    `faro:index:${HOST}`,
    `faro:context:${HOST}`,
    `faro:memory:${HOST}`,
  ])
  eq(new Set(bundleKeys(HOST)).size, 4, 'ninguna clave se pide dos veces')
})

test('bundle: las claves previstas de H9-H11 entran por su nombre, y una que no existe se ignora', () => {
  // Hoy no hay ninguna, así que el mecanismo se ejercita con una clave que sí
  // existe (`session`): sin esto, la lista vacía dejaría el camino sin probar y
  // el hito que añada la primera se encontraría con que no funciona.
  eq(bundleKeys(HOST, ['session']), [
    'faro:sites',
    `faro:index:${HOST}`,
    `faro:context:${HOST}`,
    `faro:memory:${HOST}`,
    `faro:session:${HOST}`,
  ])
  eq(bundleKeys(HOST, ['noExisteTodavia']).length, 4, 'un nombre que no está en STORAGE_KEYS no rompe el arranque')
  eq(bundleKeys(HOST, null).length, 4, 'ni una lista que no es lista')
  // La regla para quien añada la suya: el nombre tiene que existir y tiene que
  // ser por host (STORAGE_KEYS.sites es una cadena, no vale).
  assert(Array.isArray(BUNDLE_EXTRA_KEYS), 'BUNDLE_EXTRA_KEYS es una lista')
  eq(BUNDLE_EXTRA_KEYS, [], 'hoy ninguna: H9 (perfil), H10 (historial y referencias) y H11 (actividad) las añaden')
  for (const name of BUNDLE_EXTRA_KEYS) {
    eq(typeof STORAGE_KEYS[name], 'function', `STORAGE_KEYS.${name} tiene que ser una clave por host`)
  }
})

// ---- una sola lectura -------------------------------------------------------

test('bundle: todo lo del sitio sale de UNA lectura, con claves exactas', async () => {
  await conChrome(
    {
      'faro:sites': { [HOST]: SITIO, [OTRO]: { host: OTRO } },
      [`faro:index:${HOST}`]: INDICE,
      [`faro:context:${HOST}`]: '# Contexto',
      [`faro:memory:${HOST}`]: { entries: [{ at: 1, text: 'algo' }] },
    },
    async (diario) => {
      const bundle = await getSiteBundle(HOST)
      eq(diario.gets.length, 1, 'una sola petición al almacén')
      eq(diario.gets[0], bundleKeys(HOST), 'y con las claves del paquete')
      eq(Object.keys(bundle).sort(), ['contextMd', 'extras', 'index', 'memoryRaw', 'site', 'stale'])
      eq(bundle.site, SITIO)
      eq(bundle.index, INDICE)
      eq(bundle.stale, false)
      eq(bundle.contextMd, '# Contexto')
      eq(bundle.memoryRaw, { entries: [{ at: 1, text: 'algo' }] }, 'la memoria sale tal cual: la normaliza quien la usa')
      eq(bundle.extras, {})
      eq(diario.sets, [], 'leer no escribe nada')
    }
  )
})

test('bundle: sin nada guardado no hay sitio, ni índice, ni contexto, ni memoria', async () => {
  await conChrome({}, async (diario) => {
    const bundle = await getSiteBundle(HOST)
    eq(bundle, { site: null, index: null, stale: false, contextMd: '', memoryRaw: null, extras: {} })
    eq(diario.removed, [], 'y no se borra nada')
  })
})

test('bundle: el sitio es el de ESTE host, no el mapa entero', async () => {
  await conChrome({ 'faro:sites': { [OTRO]: { host: OTRO, configured: true } } }, async () => {
    eq(await getSiteBundle(HOST), {
      site: null,
      index: null,
      stale: false,
      contextMd: '',
      memoryRaw: null,
      extras: {},
    })
    const bundle = await getSiteBundle(OTRO)
    eq(bundle.site, { host: OTRO, configured: true })
  })
})

test('bundle: un índice de una versión anterior se tira y se avisa, igual que en getIndex', async () => {
  const viejo = { version: 1, host: HOST, pages: { 1: { title: 'x' } } }
  await conChrome({ [`faro:index:${HOST}`]: viejo }, async (diario, local) => {
    const bundle = await getSiteBundle(HOST)
    eq(bundle.index, null, 'no se sirve un índice con rutas que ya no funcionan')
    eq(bundle.stale, true, 'y el panel puede decir por qué se quedó sin él')
    eq(diario.removed, [`faro:index:${HOST}`], 'se borra del almacén')
    assert(!(`faro:index:${HOST}` in local), 'de verdad')
  })
  // La misma decisión en los dos caminos: si cada uno comprobara la versión por
  // su cuenta, uno acabaría sirviendo lo que el otro descarta.
  await conChrome({ [`faro:index:${HOST}`]: viejo }, async (diario) => {
    eq(await getIndex(HOST), { index: null, stale: true })
    eq(diario.removed, [`faro:index:${HOST}`])
  })
  await conChrome({ [`faro:index:${HOST}`]: INDICE }, async () => {
    eq((await getIndex(HOST)).index, INDICE, 'y el de la versión de ahora se sirve entero')
  })
})

test('bundle: una clave prevista viaja en la MISMA lectura y su valor sale sin tocar', async () => {
  // El día que H9 añada `profile` a BUNDLE_EXTRA_KEYS, esto es lo que tiene que
  // pasar: una lectura, el valor crudo en `extras` y su hito normalizándolo.
  const guardado = { version: 1, projectKey: 'SIMPL', raro: { onclick: 'x' } }
  await conChrome({ [`faro:session:${HOST}`]: guardado }, async (diario) => {
    const bundle = await getSiteBundle(HOST, { extra: ['session'] })
    eq(diario.gets.length, 1, 'sigue siendo una sola lectura')
    eq(diario.gets[0].length, 5, 'con la clave nueva dentro')
    eq(bundle.extras, { session: guardado }, 'tal cual está guardado: aquí no se decide su forma')
    eq(Object.keys(bundle).sort(), ['contextMd', 'extras', 'index', 'memoryRaw', 'site', 'stale'], 'y el paquete no gana claves sueltas')
  })
  await conChrome({}, async () => {
    const bundle = await getSiteBundle(HOST, { extra: ['session'] })
    eq(bundle.extras, { session: null }, 'sin nada guardado, la clave prevista es null, no undefined')
  })
})

// ---- el peso de la sesión ---------------------------------------------------

/**
 * Como `conChrome`, pero instalando sólo `chrome.storage.session`: el peso de la
 * sesión vive ahí, junto al id de la sesión, y muere con Chrome igual que ella.
 * Aparte para no mezclar su diario con el de las lecturas del paquete.
 */
async function conSesion(inicial, fn) {
  const previo = globalThis.chrome
  const sesion = { ...inicial }
  const diario = { gets: [], sets: [], removed: [] }
  globalThis.chrome = {
    storage: {
      session: {
        get: async (k) => {
          diario.gets.push(k)
          return k in sesion ? { [k]: sesion[k] } : {}
        },
        set: async (o) => {
          diario.sets.push(o)
          Object.assign(sesion, o)
        },
        remove: async (k) => {
          diario.removed.push(k)
          delete sesion[k]
        },
      },
    },
  }
  try {
    await fn(diario, sesion)
  } finally {
    if (previo === undefined) delete globalThis.chrome
    else globalThis.chrome = previo
  }
}

const PESO = `faro:session-weight:${HOST}`

test('peso: sin nada guardado la sesión no arrastra nada, y lo guardado se lee tal cual', async () => {
  await conSesion({}, async (diario) => {
    eq(await getSessionWeight(HOST), 0)
    eq(diario.gets, [PESO], 'y se pide exactamente su clave')
  })
  await conSesion({ [PESO]: 312000 }, async () => {
    eq(await getSessionWeight(HOST), 312000)
    eq(await getSessionWeight(OTRO), 0, 'el peso es de ESTE host')
  })
})

test('peso: se guarda bajo su clave, y borrarlo la quita', async () => {
  await conSesion({}, async (diario, sesion) => {
    await setSessionWeight(HOST, 1200)
    eq(sesion[PESO], 1200)
    eq(diario.sets, [{ [PESO]: 1200 }], 'una sola escritura, con la clave del host')
    await setSessionWeight(OTRO, 7)
    eq(sesion[PESO], 1200, 'y el de otro host no lo pisa')
    await clearSessionWeight(HOST)
    eq(PESO in sesion, false)
    eq(diario.removed, [PESO])
  })
})

test('peso: sólo es un número finito y no negativo; lo demás cuenta como cero', async () => {
  // Es un contador que decide si se enseña un aviso: un NaN guardado dejaría
  // `NaN >= umbral` siempre en falso (el aviso no saldría nunca) y un negativo
  // lo retrasaría. Se limpia al escribir Y al leer, porque storage.session lo
  // puede haber dejado así una versión anterior.
  await conSesion({}, async (diario, sesion) => {
    for (const malo of [NaN, Infinity, -1, '1200', null, undefined, {}, []]) {
      await setSessionWeight(HOST, malo)
      eq(sesion[PESO], 0, `un peso ${JSON.stringify(malo) ?? String(malo)} se guarda como 0`)
    }
    eq(diario.sets.length, 8, 'todas se escriben: el contador no se queda con el valor anterior')
    await setSessionWeight(HOST, 12.7)
    eq(sesion[PESO], 12, 'y se cuentan caracteres enteros')
  })
  for (const malo of ['muchos', { chars: 9 }, null, -5, [], true]) {
    await conSesion({ [PESO]: malo }, async () => {
      eq(await getSessionWeight(HOST), 0, `leer ${JSON.stringify(malo) ?? String(malo)} da 0, no NaN`)
    })
  }
})

test('bundle: lo que devuelve es lo mismo que daban getSite y getIndex por separado', async () => {
  // La prueba de que el cambio es una optimización y no un cambio de contrato.
  await conChrome(
    { 'faro:sites': { [HOST]: SITIO }, [`faro:index:${HOST}`]: INDICE },
    async () => {
      const bundle = await getSiteBundle(HOST)
      eq(bundle.site, await getSite(HOST))
      eq({ index: bundle.index, stale: bundle.stale }, await getIndex(HOST))
    }
  )
})
