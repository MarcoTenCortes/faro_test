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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, eq, assert } from '../harness.js'
import { listJsFiles } from '../syntax.js'
import { STORAGE_AREAS, STORAGE_KEYS } from '../../src/shared/config.js'
import { INDEX_VERSION } from '../../src/atlassian/index-store.js'
import { PROFILE_VERSION } from '../../src/shared/jira-rest.js'
import {
  getIndex,
  getSite,
  getSiteBundle,
  getProfile,
  saveProfile,
  forgetEverythingFor,
  FORGET_KEEPS,
  bundleKeys,
  BUNDLE_EXTRA_KEYS,
  getSessionWeight,
  setSessionWeight,
  clearSessionWeight,
} from '../../src/shared/storage.js'

const HOST = 'confluence.simplprogramme.eu'
const OTRO = 'jira.simplprogramme.eu'

/** Los nombres de `STORAGE_KEYS` que son una clave POR HOST. */
const PORHOST = Object.keys(STORAGE_KEYS).filter((n) => typeof STORAGE_KEYS[n] === 'function')

/**
 * Ejecuta `fn` con un `chrome.storage` simulado y lo retira al salir. Devuelve el
 * almacén de `local` y el diario de llamadas: `gets` lleva el argumento de cada
 * lectura (cadena o lista) y `removed` lo que se haya borrado.
 *
 * Desde H13 instala TAMBIÉN `storage.session`, que es donde viven la sesión, su
 * peso, la caché de «hoy» y la marca de borrado del diario: sin ella el olvido
 * de un sitio no se podía probar entero desde aquí, y por eso la mitad de él
 * estaba escrita a mano en el manejador del botón del panel. `fn` recibe
 * `(diario, local, session)`.
 */
async function conChrome(inicial, fn) {
  const previo = globalThis.chrome
  const local = { ...inicial }
  const session = {}
  const clon = (v) => JSON.parse(JSON.stringify(v))
  const diario = { gets: [], removed: [], sets: [], sessionGets: [], sessionRemoved: [], sessionSets: [] }
  const area = (almacen, reg) => ({
    get: async (k) => {
      diario[reg.gets].push(k)
      const claves = Array.isArray(k) ? k : [k]
      const out = {}
      for (const clave of claves) if (clave in almacen) out[clave] = clon(almacen[clave])
      return out
    },
    set: async (o) => {
      diario[reg.sets].push(Object.keys(o))
      for (const [k, v] of Object.entries(o)) almacen[k] = clon(v)
    },
    remove: async (k) => {
      diario[reg.removed].push(k)
      // `remove` acepta una clave o una lista, y `forgetEverythingFor` borra
      // todas las de un área de golpe.
      for (const clave of Array.isArray(k) ? k : [k]) delete almacen[clave]
    },
  })
  globalThis.chrome = {
    storage: {
      local: area(local, { gets: 'gets', sets: 'sets', removed: 'removed' }),
      // El diario de `session` va aparte: mezclarlo con el de `local` haría que
      // «la lectura del paquete es UNA» dejara de poder contarse.
      session: area(session, { gets: 'sessionGets', sets: 'sessionSets', removed: 'sessionRemoved' }),
    },
  }
  try {
    await fn(diario, local, session)
  } finally {
    if (previo === undefined) delete globalThis.chrome
    else globalThis.chrome = previo
  }
}

const SITIO = { host: HOST, configured: true, product: 'confluence', skill: 'analisis', model: 'x/y', onboarded: true }
const INDICE = { version: INDEX_VERSION, host: HOST, pages: {}, spaces: {}, projects: {}, issues: {} }

// ---- las claves que se leen -------------------------------------------------

test('bundle: las claves del paquete son las cuatro de siempre más el perfil, el historial y la actividad, sin repetir', () => {
  eq(bundleKeys(HOST), [
    'faro:sites',
    `faro:index:${HOST}`,
    `faro:context:${HOST}`,
    `faro:memory:${HOST}`,
    `faro:profile:${HOST}`,
    `faro:source-history:${HOST}`,
    `faro:actividad:${HOST}`,
  ])
  eq(new Set(bundleKeys(HOST)).size, 7, 'ninguna clave se pide dos veces')
})

test('H9: el perfil viaja en el paquete, y una clave que no existe se ignora', () => {
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
  eq(BUNDLE_EXTRA_KEYS, ['profile', 'sourceHistory', 'activity'], 'la de H9, la de H10 y la de H11')
  for (const name of BUNDLE_EXTRA_KEYS) {
    eq(typeof STORAGE_KEYS[name], 'function', `STORAGE_KEYS.${name} tiene que ser una clave por host`)
  }
  // Las páginas de referencia del contexto NO tienen clave: docs/PLAN.md §3.2
  // descartó la lista estructurada del indexador y el parser de prosa las saca
  // del CONTEXT.md, que ya viaja en este mismo paquete. Una clave que nadie
  // escribe sería una promesa falsa.
  eq('references' in STORAGE_KEYS, false, 'las referencias se calculan al vuelo, no se guardan')
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
      eq(bundle.extras, { profile: null, sourceHistory: null, activity: null })
      eq(diario.sets, [], 'leer no escribe nada')
    }
  )
})

test('bundle: sin nada guardado no hay sitio, ni índice, ni contexto, ni memoria', async () => {
  await conChrome({}, async (diario) => {
    const bundle = await getSiteBundle(HOST)
    eq(bundle, { site: null, index: null, stale: false, contextMd: '', memoryRaw: null, extras: { profile: null, sourceHistory: null, activity: null } })
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
      extras: { profile: null, sourceHistory: null, activity: null },
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
  // Lo que H9 estrenó con `profile` y lo que H10 y H11 repetirán con las suyas:
  // una lectura, el valor CRUDO en `extras` y su hito normalizándolo (aquí no se
  // decide la forma de nada). Se ejercita con `session` para probar el mecanismo
  // por separado de la lista de por defecto.
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

// ---- el perfil del proyecto (H9) --------------------------------------------

const PERFIL = {
  version: PROFILE_VERSION,
  projectKey: 'SIMPL',
  sampled: 40,
  at: 1757664000000,
  // Tipos y estados con su id desde H14: es lo único que una JQL acepta cuando
  // Jira devuelve el nombre traducido al idioma del usuario.
  types: [{ name: 'Story', count: 30, id: '10001' }],
  statuses: [{ name: 'Done', count: 12, category: 'done', id: '6' }],
  components: [],
  labels: [],
  prefixes: [],
}
const CLAVE_PERFIL = `faro:profile:${HOST}`

test('H9: el perfil entra y sale por normalizeProfile, y el de otra versión no se sirve', async () => {
  // De aquí sale texto que entra DELIMITADO en un `system` (profileBlock), así
  // que lo guardado se reconstruye con claves blancas al leerlo: un perfil
  // editado a mano no puede colar una clave de más ni un tipo raro.
  await conChrome({ [CLAVE_PERFIL]: PERFIL }, async (diario) => {
    eq(await getProfile(HOST), PERFIL)
    eq(diario.gets, [CLAVE_PERFIL], 'se pide exactamente su clave')
    eq(await getProfile(OTRO), null, 'el perfil es de ESTE host')
    eq(diario.sets, [], 'leer no escribe')
  })
  await conChrome({ [CLAVE_PERFIL]: { ...PERFIL, onclick: 'x', types: [{ name: 'Story', count: 30, id: '10001', extra: 1 }] } }, async () => {
    const p = await getProfile(HOST)
    eq(Object.keys(p).sort(), ['at', 'components', 'labels', 'prefixes', 'projectKey', 'sampled', 'statuses', 'types', 'version'])
    eq(p.types, [{ name: 'Story', count: 30, id: '10001' }], 'y cada entrada también')
  })
  // Otra versión: null, y se vuelve a contar. NO se borra del almacén, a
  // diferencia del índice: un índice viejo lleva a un 404 y hay que tirarlo en
  // el acto; un perfil es un conteo que se escribe encima.
  await conChrome({ [CLAVE_PERFIL]: { ...PERFIL, version: PROFILE_VERSION + 1 } }, async (diario, local) => {
    eq(await getProfile(HOST), null)
    eq(diario.removed, [], 'leer no borra')
    assert(CLAVE_PERFIL in local)
  })
  for (const malo of [null, 'abc', 7, [], {}]) {
    await conChrome({ [CLAVE_PERFIL]: malo }, async () => {
      eq(await getProfile(HOST), null, JSON.stringify(malo) ?? String(malo))
    })
  }
})

test('H9: guardar el perfil lo normaliza antes, y guardar nada quita la clave', async () => {
  await conChrome({}, async (diario, local) => {
    const guardado = await saveProfile(HOST, { ...PERFIL, onclick: 'x' })
    eq(guardado, PERFIL, 'devuelve lo que quedó guardado')
    eq(local[CLAVE_PERFIL], PERFIL, 'y en el almacén no hay ni una clave de más')
    eq(diario.sets, [[CLAVE_PERFIL]], 'una sola escritura, bajo la clave del host')
    eq(await getProfile(HOST), PERFIL, 'leerlo devuelve lo mismo')
  })
  await conChrome({ [CLAVE_PERFIL]: PERFIL }, async (diario, local) => {
    eq(await saveProfile(HOST, { version: PROFILE_VERSION + 1 }), null)
    eq(CLAVE_PERFIL in local, false, 'un perfil que no vale no se queda guardado')
    eq(diario.removed, [CLAVE_PERFIL])
    eq(diario.sets, [], 'y no se escribe nada')
  })
})

// ---- «Olvidar este sitio»: una sola puerta y ninguna clave suelta (H13) ------

/**
 * El pin del hito: toda clave POR HOST tiene que decir en qué área vive, y el
 * olvido tiene que llevárselas TODAS salvo las que estén en `FORGET_KEEPS` con su
 * motivo escrito.
 *
 * Es lo que impide que la deuda vuelva. Hasta H13 la lista de lo que se borra
 * estaba escrita a mano en dos sitios —cuatro claves en `forgetSite` y seis
 * llamadas más en el manejador del botón del panel— y el contexto y la memoria
 * del sitio no estaban en la primera: cualquier llamante que no fuera ese botón
 * dejaba detrás el CONTEXT.md y los resúmenes de un sitio que el usuario pidió
 * olvidar. Ahora las claves se DERIVAN, y una que se añada mañana hace fallar
 * esta prueba hasta que diga dónde vive.
 */
test('H13 revisión: el área declarada de cada clave por host es la que USA el código', () => {
  // EL CAMBIO: la prueba del olvido siembra el almacén con la MISMA tabla que
  // comprueba, así que un área mal puesta le era invisible: con `memory: 'session'`
  // el olvido borraba de session, los resúmenes seguían en local para siempre, y
  // las 1282 en verde (revisión adversaria de H13). Aquí la tabla se cruza con
  // el código: cada línea de src/ que escribe, lee o borra `STORAGE_KEYS.<x>(`
  // dice en qué área lo hace, y tiene que ser la declarada.
  const usos = new Map()
  for (const fichero of listJsFiles(fileURLToPath(new URL('../../src/', import.meta.url)))) {
    const lineas = readFileSync(fichero, 'utf8').split('\n')
    lineas.forEach((linea, i) => {
      const area = linea.match(/chrome\.storage\.(local|session)\.(?:get|set|remove)\(/)
      if (!area) return
      for (const m of linea.matchAll(/STORAGE_KEYS\.(\w+)\(/g)) {
        if (!usos.has(m[1])) usos.set(m[1], [])
        usos.get(m[1]).push({ area: area[1], donde: fichero.split(/[\\/]/).slice(-2).join('/') + ':' + (i + 1) })
      }
    })
  }
  for (const [nombre, clave] of Object.entries(STORAGE_KEYS)) {
    if (typeof clave !== 'function') continue
    const vistos = usos.get(nombre) || []
    assert(vistos.length > 0, nombre + ': ninguna línea de src/ la usa junto a su área (si se escribe de otra forma, este pin hay que enseñárselo)')
    for (const u of vistos) eq(u.area, STORAGE_AREAS[nombre], `${nombre} se usa en storage.${u.area} (${u.donde}) y está declarada en ${STORAGE_AREAS[nombre]}`)
  }
})

test('H13: toda clave por host dice en qué área vive, y el olvido no puede dejarse ninguna', () => {
  for (const nombre of Object.keys(STORAGE_KEYS)) {
    const area = Object.hasOwn(STORAGE_AREAS, nombre) ? STORAGE_AREAS[nombre] : ''
    assert(
      area === 'local' || area === 'session',
      `STORAGE_KEYS.${nombre} no dice en qué área de chrome.storage vive: ponlo en STORAGE_AREAS`
    )
  }
  assert(PORHOST.length >= 10, 'esperaba al menos diez claves por host, hay ' + PORHOST.length)
  // Y las conservadas son claves de verdad, por host, y con su motivo escrito: un
  // nombre suelto ahí dentro sería una clave que sobrevive a un olvido y nadie
  // sabría por qué.
  for (const [nombre, motivo] of Object.entries(FORGET_KEEPS)) {
    assert(PORHOST.includes(nombre), `FORGET_KEEPS nombra ${nombre}, que no es una clave por host`)
    assert(typeof motivo === 'string' && motivo.length > 40, `FORGET_KEEPS.${nombre} no dice POR QUÉ se conserva`)
  }
})

test('H13: «Olvidar este sitio» deja ese host como si Faro no lo hubiera visto nunca', async () => {
  // Todas las claves por host de los dos áreas, llenas, más las del OTRO host
  // para comprobar que no se las lleva de paso.
  const inicial = { 'faro:sites': { [HOST]: SITIO, [OTRO]: { host: OTRO } } }
  const enSesion = []
  for (const nombre of PORHOST) {
    const valor = { marca: nombre }
    if (STORAGE_AREAS[nombre] === 'local') {
      inicial[STORAGE_KEYS[nombre](HOST)] = valor
      inicial[STORAGE_KEYS[nombre](OTRO)] = valor
    } else enSesion.push(nombre)
  }
  // El índice, con su versión: si no, `takeIndex` lo tiraría al leerlo y el
  // «se borró» de abajo saldría verde por el camino equivocado.
  inicial[`faro:index:${HOST}`] = INDICE

  await conChrome(inicial, async (diario, local, session) => {
    for (const nombre of enSesion) {
      session[STORAGE_KEYS[nombre](HOST)] = { marca: nombre }
      session[STORAGE_KEYS[nombre](OTRO)] = { marca: nombre }
    }
    const antes = Date.now()
    await forgetEverythingFor(HOST)

    eq(HOST in local['faro:sites'], false, 'el registro del sitio se va')
    eq(OTRO in local['faro:sites'], true, 'y el del otro host se queda')
    for (const nombre of PORHOST) {
      if (Object.hasOwn(FORGET_KEEPS, nombre)) continue
      const donde = STORAGE_AREAS[nombre] === 'local' ? local : session
      eq(STORAGE_KEYS[nombre](HOST) in donde, false, `${nombre} sigue guardado tras olvidar el sitio`)
      assert(STORAGE_KEYS[nombre](OTRO) in donde, `${nombre} del otro host no se toca`)
    }

    // Y la marca de borrado del diario se QUEDA, porque la deja este mismo
    // olvido: es lo único que impide que una escritura del service worker que ya
    // había leído devuelva el diario entero unos milisegundos después.
    const marca = session[STORAGE_KEYS.activityCleared(HOST)]
    assert(Number.isFinite(marca) && marca >= antes, 'el olvido deja la marca de borrado del diario: ' + marca)
    eq(STORAGE_KEYS.activity(HOST) in local, false, 'y el diario, borrado')
  })
})

test('H13: el olvido es de ESE host, y de un sitio del que no hay nada guardado no falla', async () => {
  await conChrome({}, async (diario, local, session) => {
    await forgetEverythingFor(HOST)
    eq(local['faro:sites'], {}, 'sin nada guardado queda el mapa vacío, no una excepción')
    // La marca del diario se pone igual: el borrado es el mismo, haya o no
    // diario, y una escritura en vuelo tiene que verla de todas formas.
    assert(STORAGE_KEYS.activityCleared(HOST) in session)
  })
})

test('H11: el diario de actividad viaja en el paquete del arranque, crudo', async () => {
  // Como el perfil y el historial: una sola lectura, y la forma la decide quien
  // lo usa (`getActivity` lo pasa por `pruneActivity`). Aquí sale TAL CUAL.
  const guardado = { version: 1, host: HOST, items: { 'jira-issue:ENG-7': { raro: 1 } }, dismissed: {} }
  await conChrome({ [`faro:actividad:${HOST}`]: guardado }, async (diario) => {
    const bundle = await getSiteBundle(HOST)
    eq(diario.gets.length, 1, 'sin una lectura más que antes')
    eq(bundle.extras.activity, guardado, 'sin normalizar: aquí no se decide la forma de nada')
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
