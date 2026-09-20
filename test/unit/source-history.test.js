/**
 * El historial de análisis con páginas base (src/panel/source-history.js).
 *
 * EL CAMBIO: la pantalla de páginas base se abría vacía y el usuario repetía la
 * misma búsqueda en cada ticket parecido (docs/PLAN.md §3.2). Lo que se apunta
 * aquí es lo que ELIGIÓ, nunca texto de la página ni la respuesta del modelo, y
 * NUNCA entra en un prompt.
 *
 * Lo que más se vigila: las claves exactas de una entrada y de una página (de
 * aquí salen títulos de Confluence, que los escribe cualquiera), la caducidad y
 * el tope con el reloj inyectado, y que dos análisis de la misma incidencia
 * sean UNA entrada: sin identidad, analizar tres veces el mismo ticket contaba
 * como tres usos de la misma guía y la ponía la primera para siempre.
 *
 * Las tres funciones que tocan `chrome.storage` se prueban con un `chrome` de
 * mentira instalado por prueba y retirado al salir, como en memory.test.js.
 */
import { test, eq, assert } from '../harness.js'
import { STORAGE_KEYS } from '../../src/shared/config.js'
import {
  DAY_MS,
  HISTORY_LIMITS,
  HISTORY_VERSION,
  clearSourceHistory,
  emptyHistory,
  getSourceHistory,
  historyEntry,
  normalizeHistory,
  recordAnalysis,
  saveSourceHistory,
  titleWords,
  usesOf,
} from '../../src/panel/source-history.js'

const HOST = 'jira.simplprogramme.eu'
const AHORA = Date.UTC(2026, 8, 20, 10, 0, 0)
const CLAVE = STORAGE_KEYS.sourceHistory(HOST)

/** Las claves EXACTAS de una entrada y de una página elegida. */
const CLAVES_ENTRADA = [
  'at',
  'components',
  'family',
  'issueKey',
  'labels',
  'mode',
  'pageId',
  'pages',
  'phase',
  'product',
  'projectKey',
  'spaceKey',
  'words',
]
const CLAVES_PAGINA = ['id', 'spaceKey', 'title']

const GUIA = { id: '456789', title: 'Guía de API del programa', spaceKey: 'ENG' }
const RUNBOOK = { id: '456790', title: 'Runbook de guardia', spaceKey: 'ENG' }

/** Un análisis de Jira ya terminado, tal como lo recogería el panel. */
function analisis(clave, ms, pages = [GUIA], extra = {}) {
  return historyEntry({
    sources: { mode: 'open', pages },
    issue: { type: 'API Definition', status: 'In Review', components: ['Auth', 'Auth'], labels: ['api'] },
    summary: '[API Definition] - Consent API v2',
    issueKey: clave,
    projectKey: 'SIMPL',
    product: 'jira',
    now: ms,
    ...extra,
  })
}

/** Ejecuta `fn` con un `chrome.storage.local` simulado y lo retira al salir. */
async function conChrome(inicial, fn) {
  const previo = globalThis.chrome
  const local = { ...inicial }
  const clon = (v) => JSON.parse(JSON.stringify(v))
  const diario = { gets: [], sets: [], removed: [] }
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
          for (const clave of Array.isArray(k) ? k : [k]) delete local[clave]
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

// ---- la forma de una entrada -----------------------------------------------

test('una entrada del historial tiene claves EXACTAS, y sus páginas también', () => {
  const e = analisis('SIMPL-10', AHORA)
  eq(Object.keys(e).sort(), CLAVES_ENTRADA)
  eq(Object.keys(e.pages[0]).sort(), CLAVES_PAGINA, 'la página va sin `path`: la ruta es del sitio donde vive, no de éste')
  eq(e.family, 'api', 'la familia sale de issueProfile, el mismo sitio que decide el prompt')
  eq(e.phase, 'en-revision')
  eq(e.components, ['auth'], 'plegadas y sin repetir, para poder compararlas luego sin pensar')
  eq(e.labels, ['api'])
  eq(e.words, ['definition', 'consent'], 'palabras del título de cuatro letras para arriba')
  eq(e.mode, 'open')
  eq(e.issueKey, 'SIMPL-10')
  eq(e.projectKey, 'SIMPL')
  eq(e.pageId, '')
  eq(e.spaceKey, null)
})

test('SEGURIDAD: de lo que llega sólo sobrevive lo conocido, de una línea y con tope', () => {
  const sucia = normalizeHistory(
    {
      entries: [
        {
          at: AHORA,
          issueKey: 'SIMPL-10',
          onclick: 'alert(1)',
          family: '__proto__',
          phase: 'inventada',
          mode: 'total',
          product: 'trello',
          components: Array.from({ length: 30 }, (_, i) => `C${i}`),
          labels: ['x'.repeat(200)],
          words: ['de', 'y', 'arquitectura'],
          pages: [
            { id: '456789', title: 'Guía\ncon salto\ty tabulador', spaceKey: 'ENG', path: '/pages/456789', onclick: 'x' },
            { id: 'abc', title: 'sin id numérico' },
            { id: '456789', title: 'repetida' },
            ...Array.from({ length: 10 }, (_, i) => ({ id: String(900000 + i), title: `P${i}` })),
          ],
        },
      ],
    },
    { host: HOST, now: AHORA }
  ).entries[0]

  eq(Object.keys(sucia).sort(), CLAVES_ENTRADA, 'ni una clave de más')
  eq(sucia.family, '', 'una familia que no existe no es una familia')
  eq(sucia.phase, '')
  eq(sucia.product, '')
  eq(sucia.mode, 'open', 'un modo que no existe cae en el de por defecto')
  eq(sucia.components.length, HISTORY_LIMITS.listMax)
  eq(sucia.labels[0].length, HISTORY_LIMITS.tagMax)
  eq(sucia.words, ['arquitectura'], 'las palabras cortas no distinguen nada')
  eq(sucia.pages.length, 6, 'el tope de páginas base manda también aquí')
  eq(sucia.pages[0].title, 'Guía con salto y tabulador', 'un título de Confluence entra en una línea')
  eq(Object.keys(sucia.pages[0]).sort(), CLAVES_PAGINA, 'y sin la ruta que traía')
  assert(!sucia.pages.some((p) => p.id === 'abc'), 'una página sin id numérico no entra')
})

test('sin páginas elegidas o sin identidad no hay nada que apuntar', () => {
  eq(historyEntry({ sources: { mode: 'open', pages: [] }, issueKey: 'SIMPL-1', now: AHORA }), null, 'sin páginas no dice nada')
  eq(historyEntry({ sources: { pages: [GUIA] }, now: AHORA }), null, 'sin clave ni id de página no se podría deduplicar')
  eq(historyEntry({ sources: { pages: [GUIA] }, pageId: '456000', now: AHORA }).pageId, '456000', 'en Confluence la identidad es la página')
  eq(normalizeHistory({ entries: [{ at: AHORA, issueKey: 'SIMPL-1', pages: [GUIA] }, { pages: [GUIA] }] }, { now: AHORA }).entries.length, 1)
})

test('SEGURIDAD: una clave o un id que no lo son se caen, no se suben a mayúsculas', () => {
  // Con `pageId` bueno de base, para que lo que se mire sea la clave y no la
  // entrada entera, que sin identidad ninguna se cae (eso ya se prueba arriba).
  const e = (raw) =>
    normalizeHistory({ entries: [{ at: AHORA, pages: [GUIA], pageId: '456000', ...raw }] }, { now: AHORA }).entries[0]
  eq(e({ issueKey: 'simpl-10' }).issueKey, 'SIMPL-10', 'una clave en minúsculas es la misma clave')
  eq(e({ issueKey: 'SIMPL-10\nOTRA-1' }).issueKey, '', 'con un salto dentro no es una clave')
  eq(e({ issueKey: 'SIMPL 10' }).issueKey, '')
  eq(e({ pageId: '12x', issueKey: 'SIMPL-1' }).pageId, '')
  eq(e({ pageId: ' 456000 ' }).pageId, '456000')
  eq(e({ projectKey: 'no es clave' }).projectKey, '')
  eq(e({ spaceKey: '~' }).spaceKey, null, '«~» a secas es el prefijo de los personales, no un espacio')
  eq(e({ spaceKey: ' ENG ' }).spaceKey, 'ENG')
})

// ---- la lista ---------------------------------------------------------------

test('la lista se purga a los 90 días, con el reloj que se le dé', () => {
  const dentro = analisis('SIMPL-1', AHORA - (HISTORY_LIMITS.maxAgeDays - 1) * DAY_MS)
  const fuera = analisis('SIMPL-2', AHORA - (HISTORY_LIMITS.maxAgeDays + 1) * DAY_MS)
  const h = normalizeHistory({ entries: [dentro, fuera] }, { host: HOST, now: AHORA })
  eq(h.entries.map((e) => e.issueKey), ['SIMPL-1'])
  // El reloj se inyecta: la misma lista, un año más tarde, se queda vacía.
  eq(normalizeHistory({ entries: [dentro, fuera] }, { host: HOST, now: AHORA + 365 * DAY_MS }).entries.length, 0)
})

test('sesenta entradas como mucho, y se quedan las más nuevas, de la más nueva a la más vieja', () => {
  const muchas = Array.from({ length: HISTORY_LIMITS.maxEntries + 12 }, (_, i) => analisis(`SIMPL-${i}`, AHORA - i * 1000))
  const h = normalizeHistory({ entries: [...muchas].reverse() }, { host: HOST, now: AHORA })
  eq(h.entries.length, HISTORY_LIMITS.maxEntries)
  eq(h.entries[0].issueKey, 'SIMPL-0', 'la más nueva primero, venga como venga la lista guardada')
  eq(h.entries[h.entries.length - 1].issueKey, `SIMPL-${HISTORY_LIMITS.maxEntries - 1}`)
})

test('dos análisis de la misma incidencia son UNA entrada: la nueva', () => {
  const vieja = analisis('SIMPL-10', AHORA - 5000, [GUIA])
  const nueva = analisis('SIMPL-10', AHORA, [RUNBOOK])
  const h = normalizeHistory({ entries: [vieja, nueva] }, { host: HOST, now: AHORA })
  eq(h.entries.length, 1)
  eq(h.entries[0].pages[0].id, RUNBOOK.id, 'manda la última vez que se analizó, no la primera')
  // Y por `recordAnalysis`, que es como llega de verdad.
  const paso = recordAnalysis(recordAnalysis(emptyHistory(), vieja, { host: HOST, now: AHORA }), nueva, { host: HOST, now: AHORA })
  eq(paso.entries.length, 1)
  eq(paso.entries[0].pages[0].id, RUNBOOK.id)
})

test('recordAnalysis no muta lo que recibe, y lo que no vale no toca la lista', () => {
  const antes = recordAnalysis(emptyHistory(), analisis('SIMPL-1', AHORA - 1000), { host: HOST, now: AHORA })
  const copia = JSON.parse(JSON.stringify(antes))
  const despues = recordAnalysis(antes, analisis('SIMPL-2', AHORA), { host: HOST, now: AHORA })
  eq(antes, copia, 'la lista de entrada se queda como estaba')
  eq(despues.entries.map((e) => e.issueKey), ['SIMPL-2', 'SIMPL-1'])
  eq(recordAnalysis(antes, null, { host: HOST, now: AHORA }).entries.length, 1, 'una entrada que no vale no borra ni añade nada')
  eq(recordAnalysis(antes, { at: AHORA, pages: [] }, { host: HOST, now: AHORA }).entries.length, 1)
})

test('lo guardado que no tiene forma de historial da un historial vacío, no una excepción', () => {
  for (const malo of [null, undefined, 'abc', 7, [], { entries: 'x' }, { entries: [null, 3, 'x'] }]) {
    const h = normalizeHistory(malo, { host: HOST, now: AHORA })
    eq(h.entries, [], JSON.stringify(malo) ?? String(malo))
    eq(h.version, HISTORY_VERSION)
    eq(h.host, HOST, 'el host lo pone quien lee, que es el dueño de la clave')
  }
  // Otra versión se tira entera: el historial se rellena solo con el uso.
  eq(normalizeHistory({ version: HISTORY_VERSION + 1, entries: [analisis('SIMPL-1', AHORA)] }, { now: AHORA }).entries, [])
  // Un objeto SIN versión sí se acepta: cada entrada se reconstruye igual.
  eq(normalizeHistory({ entries: [analisis('SIMPL-1', AHORA)] }, { now: AHORA }).entries.length, 1)
})

test('un instante que no lo es se cae, y uno del futuro se trae a ahora', () => {
  const e = (at) => normalizeHistory({ entries: [{ at, issueKey: 'SIMPL-1', pages: [GUIA] }] }, { now: AHORA }).entries
  for (const malo of ['ayer', NaN, Infinity, -1, null, undefined, {}]) eq(e(malo).length, 0, String(malo))
  eq(e(1e20)[0].at, AHORA, 'sin esto se quedaría el primero para siempre y no caducaría nunca')
  eq(e(AHORA - 1000)[0].at, AHORA - 1000)
})

// ---- consultas ---------------------------------------------------------------

test('usesOf cuenta por familia y por ámbito, dice la última vez y si fue aquí mismo', () => {
  let h = emptyHistory()
  h = recordAnalysis(h, analisis('SIMPL-1', AHORA - 3000), { host: HOST, now: AHORA })
  h = recordAnalysis(h, analisis('SIMPL-2', AHORA - 2000), { host: HOST, now: AHORA })
  h = recordAnalysis(
    h,
    historyEntry({
      sources: { mode: 'exclusive', pages: [GUIA] },
      issue: { type: 'Bug', status: 'Open', components: ['Pagos'] },
      summary: 'Falla el login',
      issueKey: 'OPS-3',
      projectKey: 'OPS',
      product: 'jira',
      now: AHORA - 1000,
    }),
    { host: HOST, now: AHORA }
  )

  const ordenado = (o) => Object.fromEntries(Object.entries(o).sort())
  const u = usesOf(h, GUIA.id, { here: 'SIMPL-2' })
  eq(u.total, 3)
  eq(ordenado(u.byFamily), { api: 2, bug: 1 })
  eq(ordenado(u.byProject), { OPS: 1, SIMPL: 2 })
  eq([...u.tags].sort(), ['api', 'auth', 'pagos'], 'componentes y etiquetas juntos, plegados y sin repetir')
  eq(u.lastAt, AHORA - 1000)
  eq(u.lastIssueKey, 'OPS-3')
  eq(u.usedHere, true, '«la usaste en ESTA incidencia» es la señal más fuerte que hay')
  eq(usesOf(h, GUIA.id, { here: 'SIMPL-9' }).usedHere, false)
  eq(Object.keys(u).sort(), ['byFamily', 'byProject', 'lastAt', 'lastIssueKey', 'tags', 'total', 'usedHere', 'uses'])
  eq(Object.keys(u.uses[0]).sort(), ['at', 'family', 'issueKey', 'pageId', 'scope', 'tags'])
  // Los usos uno a uno, porque las reglas cruzan dos cosas a la vez y dos
  // recuentos por separado no se pueden cruzar después.
  eq(u.uses.filter((x) => x.family === 'api' && x.scope === 'SIMPL').length, 2)

  eq(usesOf(h, RUNBOOK.id).total, 0, 'una página que nadie eligió no tiene usos')
  eq(usesOf(h, 'abc').total, 0)
  eq(usesOf(null, GUIA.id).total, 0, 'y sin historial tampoco lanza')
})

test('usesOf no se cae con un historial sin normalizar, y una familia «__proto__» se cuenta de verdad', () => {
  const crudo = {
    entries: [
      { at: AHORA, issueKey: 'SIMPL-1', family: '__proto__', pages: [{ id: GUIA.id }] },
      { at: AHORA - 1, issueKey: 'SIMPL-2', pages: [{ id: GUIA.id }] },
    ],
  }
  const u = usesOf(crudo, GUIA.id)
  eq(u.total, 2, 'no lanza aunque falten los campos de lista')
  // El esperado se construye con `fromEntries` a propósito: escrito como
  // `{ __proto__: 1 }` no crearía ninguna propiedad propia (sería `{}`), que es
  // justo la trampa que este caso vigila.
  eq(u.byFamily, Object.fromEntries([['__proto__', 1]]), 'sobre un objeto literal ese número se perdía en silencio')
  eq(u.uses[1].tags, [])
})

test('titleWords pliega, descarta lo corto y acota', () => {
  eq(titleWords('[API Definition] - Consent API v2'), ['definition', 'consent'])
  eq(titleWords('Rotación de tokens de SERVICIO'), ['rotacion', 'tokens', 'servicio'], 'sin acentos ni mayúsculas')
  eq(titleWords('a bb ccc'), [], 'nada por debajo de cuatro letras')
  eq(titleWords('uno uno uno'), [], '«uno» son tres letras')
  eq(titleWords('rojo rojo verde'), ['rojo', 'verde'], 'sin repetir')
  eq(titleWords(Array.from({ length: 20 }, (_, i) => `palabra${i}`).join(' ')).length, HISTORY_LIMITS.wordsMax)
  eq(titleWords(null), [])
})

// ---- el almacén --------------------------------------------------------------

test('el historial se lee ya reconstruido y purgado, y leerlo no escribe nada', async () => {
  const guardado = {
    version: HISTORY_VERSION,
    host: HOST,
    entries: [analisis('SIMPL-1', AHORA - 1000), analisis('SIMPL-2', AHORA - (HISTORY_LIMITS.maxAgeDays + 1) * DAY_MS)],
  }
  await conChrome({ [CLAVE]: guardado }, async (diario) => {
    const h = await getSourceHistory(HOST, { now: AHORA })
    eq(diario.gets, [CLAVE], 'se pide exactamente su clave')
    eq(h.entries.map((e) => e.issueKey), ['SIMPL-1'], 'lo caducado no llega al que llama')
    eq(diario.sets, [], 'leer no escribe')
    eq(diario.removed, [], 'ni borra')
    eq((await getSourceHistory('otro.host', { now: AHORA })).entries, [], 'el historial es de ESTE host')
  })
  await conChrome({}, async () => {
    eq(await getSourceHistory(HOST, { now: AHORA }), { version: HISTORY_VERSION, host: HOST, entries: [] })
  })
})

test('SEGURIDAD: por saveSourceHistory no pasa nada sin normalizar, y sin entradas se quita la clave', async () => {
  await conChrome({}, async (diario, local) => {
    const guardado = await saveSourceHistory(
      HOST,
      { entries: [{ ...analisis('SIMPL-1', AHORA), onclick: 'x', family: 'inventada' }] },
      { now: AHORA }
    )
    eq(diario.sets, [[CLAVE]], 'una sola escritura, bajo la clave del host')
    eq(Object.keys(local[CLAVE].entries[0]).sort(), CLAVES_ENTRADA, 'en el almacén no hay ni una clave de más')
    eq(local[CLAVE].entries[0].family, '', 'ni un valor que no exista')
    eq(guardado, local[CLAVE], 'y devuelve lo que quedó guardado')
  })
  await conChrome({ [CLAVE]: { version: HISTORY_VERSION, host: HOST, entries: [analisis('SIMPL-1', AHORA)] } }, async (diario, local) => {
    eq((await saveSourceHistory(HOST, emptyHistory(), { now: AHORA })).entries, [])
    eq(CLAVE in local, false, 'un historial vacío no deja un objeto por cada host visitado')
    eq(diario.removed, [CLAVE])
    eq(diario.sets, [])
  })
})

test('«Olvidar el historial» se lleva la clave entera de ese host', async () => {
  await conChrome({ [CLAVE]: { version: HISTORY_VERSION, host: HOST, entries: [analisis('SIMPL-1', AHORA)] }, 'faro:source-history:otro': { x: 1 } }, async (diario, local) => {
    await clearSourceHistory(HOST)
    eq(CLAVE in local, false)
    eq('faro:source-history:otro' in local, true, 'el de otro host no se toca')
    eq(diario.removed, [CLAVE])
  })
})
