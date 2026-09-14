/**
 * Los dos niveles de memoria (src/panel/memory.js), con un `chrome.storage`
 * de mentira como el de service-worker.test.js.
 *
 * memory.js no toca `chrome` al importarse: sólo dentro de cada función. Por
 * eso el `chrome` se instala en cada prueba y se retira al salir, para no
 * dejarle nada raro a la siguiente. Lo que se guarda se clona (como hace
 * chrome.storage de verdad), para que ninguna prueba pase por compartir una
 * referencia. (Plan 2026-09-13, D6: puras sin test. H2, R1: una entrada sin
 * fecha válida ya no tira el prompt —la fecha es opcional— y lo que sale del
 * almacén pasa por `normalizeMemory` con claves blancas.)
 */
import { test, eq, assert } from '../harness.js'
import { STORAGE_KEYS } from '../../src/shared/config.js'
import { memorySummaryPrompt } from '../../src/panel/prompts.js'
import {
  getContextMd,
  saveContextMd,
  getMemory,
  saveMemory,
  clearMemory,
  addEntry,
  removeEntry,
  normalizeMemory,
  memoryToPrompt,
  summarizeSession,
  worthRemembering,
} from '../../src/panel/memory.js'

const HOST = 'confluence.x.eu'

/** Ejecuta `fn` con un chrome.storage.local simulado (le pasa el almacén) y lo retira al salir. */
async function conChrome(fn) {
  const previo = globalThis.chrome
  const local = {}
  const clon = (v) => JSON.parse(JSON.stringify(v))
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k in local ? { [k]: clon(local[k]) } : {}),
        set: async (o) => {
          for (const [k, v] of Object.entries(o)) local[k] = clon(v)
        },
        remove: async (k) => {
          delete local[k]
        },
      },
    },
  }
  try {
    await fn(local)
  } finally {
    if (previo === undefined) delete globalThis.chrome
    else globalThis.chrome = previo
  }
}

// ---- CONTEXT.md del sitio ---------------------------------------------------

test('memoria: getContextMd sin nada guardado devuelve cadena vacía', () =>
  conChrome(async () => {
    eq(await getContextMd(HOST), '')
  }))

test('memoria: saveContextMd guarda bajo faro:context:<host> y getContextMd lo recupera, por host', () =>
  conChrome(async (local) => {
    await saveContextMd(HOST, '# Contexto\n\nEspacio ENG.')
    eq(await getContextMd(HOST), '# Contexto\n\nEspacio ENG.')
    eq(Object.keys(local), [STORAGE_KEYS.context(HOST)])
    eq(STORAGE_KEYS.context(HOST), 'faro:context:confluence.x.eu')
    eq(await getContextMd('jira.x.eu'), '', 'otro host no ve el contexto de éste')
    // Lo que no es texto se guarda como texto; null/undefined, como vacío.
    await saveContextMd(HOST, null)
    eq(await getContextMd(HOST), '')
    await saveContextMd(HOST, 123)
    eq(await getContextMd(HOST), '123')
  }))

// ---- memoria entre sesiones -------------------------------------------------

test('memoria: getMemory sin nada devuelve {entries: []}; clearMemory borra la clave', () =>
  conChrome(async (local) => {
    eq(await getMemory(HOST), { entries: [] })
    await saveMemory(HOST, { entries: [{ at: 1, text: 'a' }] })
    eq(Object.keys(local), [STORAGE_KEYS.memory(HOST)])
    eq(STORAGE_KEYS.memory(HOST), 'faro:memory:confluence.x.eu')
    eq(await getMemory(HOST), { entries: [{ at: 1, text: 'a' }] })
    eq(await getMemory('jira.x.eu'), { entries: [] }, 'la memoria es por host')
    await clearMemory(HOST)
    eq(Object.keys(local), [])
    eq(await getMemory(HOST), { entries: [] })
  }))

test('memoria: addEntry pone la entrada nueva la primera, con fecha de ahora y el texto recortado, y la persiste', () =>
  conChrome(async () => {
    const antes = Date.now()
    const m1 = await addEntry(HOST, '  Buscaba el ADR de rotación.  ')
    eq(m1.entries.length, 1)
    eq(m1.entries[0].text, 'Buscaba el ADR de rotación.')
    eq(Object.keys(m1.entries[0]), ['at', 'text'])
    assert(
      Number.isFinite(m1.entries[0].at) && m1.entries[0].at >= antes && m1.entries[0].at <= Date.now(),
      '`at` es Date.now() (es la clave con la que removeEntry la borra)'
    )
    const m2 = await addEntry(HOST, 'Segunda sesión.')
    eq(m2.entries.map((e) => e.text), ['Segunda sesión.', 'Buscaba el ADR de rotación.'])
    eq((await getMemory(HOST)).entries.map((e) => e.text), ['Segunda sesión.', 'Buscaba el ADR de rotación.'])
    // Lo que no es texto no revienta, y un texto vacío no se guarda: la memoria
    // queda como estaba (H2, R1: antes se guardaba una entrada con text '').
    const m3 = await addEntry(HOST, null)
    eq(m3.entries.map((e) => e.text), ['Segunda sesión.', 'Buscaba el ADR de rotación.'])
    const m4 = await addEntry(HOST, '   \n ')
    eq(m4.entries.length, 2)
    eq((await getMemory(HOST)).entries.length, 2, 'y en el almacén tampoco entra')
  }))

test('memoria: addEntry no guarda más de 40 entradas: la que estaba al final se cae', () =>
  conChrome(async () => {
    const viejas = Array.from({ length: 40 }, (_, i) => ({ at: 1000 + i, text: 'vieja ' + i }))
    await saveMemory(HOST, { entries: viejas })
    const m = await addEntry(HOST, 'nueva')
    eq(m.entries.length, 40)
    eq(m.entries[0].text, 'nueva')
    eq(m.entries[1].text, 'vieja 0')
    eq(m.entries[39].text, 'vieja 38', 'la última de antes («vieja 39») se cae')
    eq((await getMemory(HOST)).entries.length, 40, 'y así queda guardado')
  }))

test('memoria: removeEntry quita la entrada con esa fecha y deja las demás', () =>
  conChrome(async () => {
    await saveMemory(HOST, { entries: [{ at: 3, text: 'c' }, { at: 2, text: 'b' }, { at: 1, text: 'a' }] })
    const m = await removeEntry(HOST, 2)
    eq(m.entries, [{ at: 3, text: 'c' }, { at: 1, text: 'a' }])
    eq(await getMemory(HOST), { entries: [{ at: 3, text: 'c' }, { at: 1, text: 'a' }] })
    // Una fecha que no está no toca nada. La comparación es estricta: '3' no es 3.
    eq((await removeEntry(HOST, 99)).entries.length, 2)
    eq((await removeEntry(HOST, '3')).entries.length, 2)
  }))

// ---- lo que entra en el prompt ----------------------------------------------

test('memoryToPrompt: cada entrada como «[AAAA-MM-DD] texto», separadas por línea en blanco, en el orden guardado', () => {
  const m = {
    entries: [
      { at: Date.UTC(2026, 8, 13, 10, 0, 0), text: 'Buscaba el ADR.' },
      { at: Date.UTC(2023, 10, 14), text: 'ok' },
    ],
  }
  eq(memoryToPrompt(m), '[2026-09-13] Buscaba el ADR.\n\n[2023-11-14] ok')
  eq(memoryToPrompt(null), '')
  eq(memoryToPrompt(undefined), '')
  eq(memoryToPrompt({}), '')
  eq(memoryToPrompt({ entries: [] }), '')
  eq(memoryToPrompt({ entries: null }), '')
})

test('memoryToPrompt: se acota a 12 000 caracteres: la primera entrada que no cabe corta la lista (y lo que va detrás)', () => {
  const at = Date.UTC(2026, 0, 2)
  const grande = 'x'.repeat(5000)
  // Cada línea mide 13 («[2026-01-02] ») + 5000: dos caben (10 026), la tercera pasaría de 12 000.
  const tres = { entries: [{ at, text: grande }, { at, text: grande }, { at, text: grande }, { at, text: 'corta' }] }
  const out = memoryToPrompt(tres)
  eq(out.split('\n\n').length, 2)
  eq(out.length, 2 * 5013 + 2)
  assert(!out.includes('corta'), 'la corta iba detrás de la que no cabía: también se queda fuera (es «lo reciente», no «lo que quepa»)')
  // Justo en el límite cabe: la comparación es «mayor que».
  const justa = 'y'.repeat(12000 - 13)
  eq(memoryToPrompt({ entries: [{ at, text: justa }] }).length, 12000)
  eq(memoryToPrompt({ entries: [{ at, text: justa + 'z' }] }), '', 'una sola entrada que no cabe deja el prompt vacío')
})

test('R1: memoryToPrompt no se cae con una entrada sin fecha: la línea sale sin «[fecha] »', () => {
  // Antes `new Date(e.at).toISOString()` reventaba con «Invalid time value» si
  // `at` faltaba o no era una fecha, y como memoryToPrompt corre dentro del
  // runTurn de send(), tumbaba TODOS los turnos del host mientras la memoria
  // entre sesiones estuviera activa (reproducido en la auditoría del
  // 2026-09-13, docs/PLAN.md §2.4 R1). La fecha es opcional: se imprime sólo
  // si `at` es un instante válido; si no, la línea es el texto a secas.
  eq(memoryToPrompt({ entries: [{ text: 'sin fecha' }] }), 'sin fecha', 'sin `at`')
  eq(memoryToPrompt({ entries: [{ at: 'ayer', text: 'x' }] }), 'x', '`at` que no es una fecha')
  eq(
    memoryToPrompt({ entries: [{ at: Date.UTC(2026, 0, 1), text: 'bien' }, { at: NaN, text: 'mal' }] }),
    '[2026-01-01] bien\n\nmal',
    'una entrada mala no tira las buenas'
  )
  // `at: null` tampoco es una fecha (new Date(null) daría el 1 de enero de 1970: eso era inventarla).
  eq(memoryToPrompt({ entries: [{ at: null, text: 'nula' }] }), 'nula')
  // Un número finito fuera del rango de Date (±8,64e15 ms) tampoco: Number.isFinite no basta.
  eq(memoryToPrompt({ entries: [{ at: 1e20, text: 'lejos' }] }), 'lejos')
  eq(memoryToPrompt({ entries: [{ at: '1700000000000', text: 'cadena' }] }), 'cadena', 'una fecha como texto no vale: `at` es un número')
  eq(memoryToPrompt({ entries: [{ at: true, text: 'bool' }] }), 'bool')
})

test('R1: memoryToPrompt salta lo que no es una entrada con texto, y la fecha sólo cuenta en el tope si se imprime', () => {
  const at = Date.UTC(2026, 0, 2)
  eq(
    memoryToPrompt({ entries: [null, 'cadena', 7, { at }, { at, text: '' }, { at, text: '   ' }, { at, text: 'ok' }] }),
    '[2026-01-02] ok'
  )
  eq(memoryToPrompt({ entries: [{ at, text: '  con espacios  ' }] }), '[2026-01-02] con espacios', 'el texto sale recortado')
  eq(memoryToPrompt({ entries: 'abc' }), '', 'entries que no es una lista')
  eq(memoryToPrompt({ entries: { length: 2 } }), '')
  // Sin fecha, la línea mide sólo el texto: una de 12 000 justos cabe (con fecha mediría 12 013 y se quedaría fuera).
  const justa = 'y'.repeat(12000)
  eq(memoryToPrompt({ entries: [{ text: justa }] }).length, 12000)
  eq(memoryToPrompt({ entries: [{ at, text: justa }] }), '')
})

// ---- lo que sale del almacén pasa por normalizeMemory (R1) ------------------

test('SEGURIDAD: normalizeMemory reconstruye la memoria con claves blancas: entries lista, text no vacío, at instante válido o `now`', () => {
  const now = Date.UTC(2026, 8, 14)
  const raw = {
    version: 9,
    entries: [
      { at: Date.UTC(2026, 0, 1), text: '  bien  ', extra: 'fuera', onclick: 'x' },
      { text: 'sin fecha' },
      { at: 'ayer', text: 'texto' },
      { at: null, text: 'nula' },
      { at: NaN, text: 'nan' },
      { at: 1e20, text: 'lejos' },
      { at: '1700000000000', text: 'cadena' },
      { at: 5, text: '' },
      { at: 6, text: '   ' },
      { at: 7 },
      { at: 8, text: null },
      { at: 9, text: 0 },
      'cadena',
      null,
      42,
      [],
    ],
  }
  // La fecha inventada es `now − posición`: distintas entre sí, porque removeEntry
  // borra por `at` y dos reparadas con el mismo instante caerían juntas.
  eq(normalizeMemory(raw, { now }), {
    entries: [
      { at: Date.UTC(2026, 0, 1), text: 'bien' },
      { at: now - 1, text: 'sin fecha' },
      { at: now - 2, text: 'texto' },
      { at: now - 3, text: 'nula' },
      { at: now - 4, text: 'nan' },
      { at: now - 5, text: 'lejos' },
      { at: now - 6, text: 'cadena' },
    ],
  })
  for (const e of normalizeMemory(raw, { now }).entries) eq(Object.keys(e), ['at', 'text'])
  eq(new Set(normalizeMemory(raw, { now }).entries.map((e) => e.at)).size, 7, 'ningún `at` repetido')
  // `at: 0` es un instante válido (1970): se conserva, no se sustituye.
  eq(normalizeMemory({ entries: [{ at: 0, text: 'cero' }] }, { now }), { entries: [{ at: 0, text: 'cero' }] })
  // Sin `now`, la fecha inventada es Date.now().
  const antes = Date.now()
  const at = normalizeMemory({ entries: [{ text: 'hoy' }] }).entries[0].at
  assert(Number.isFinite(at) && at >= antes && at <= Date.now(), 'sin `now` se pone Date.now()')
  // Lo que no tiene forma de memoria queda vacío, nunca lanza.
  for (const sinForma of [null, undefined, {}, [], 'abc', 7, { entries: null }, { entries: 'abc' }, { entries: {} }, { entries: { length: 3 } }]) {
    eq(normalizeMemory(sinForma, { now }), { entries: [] }, JSON.stringify(sinForma))
  }
  // Tope de 40 entradas, como addEntry: las de más se caen por el final.
  const muchas = { entries: Array.from({ length: 45 }, (_, i) => ({ at: 1000 + i, text: 'e' + i })) }
  eq(normalizeMemory(muchas, { now }).entries.length, 40)
  eq(normalizeMemory(muchas, { now }).entries[39], { at: 1039, text: 'e39' })
  // Idempotente: normalizar lo normalizado no cambia nada.
  const una = normalizeMemory(raw, { now })
  eq(normalizeMemory(una, { now: 1 }), una)
})

// Revisión adversaria de H2 (2026-09-14): `normalizeEntry` daba por perdida toda
// `at` que no fuera un número y le ponía `now`, así que una fecha en TEXTO —lo que
// deja un almacén exportado a JSON y vuelto a importar, o editado a mano— se
// DESTRUÍA: la entrada pasaba a ser «de hoy» para siempre, y con ella el orden y
// la fecha que sale en el prompt. Si `Date` la entiende, se conserva.
test('R1: una fecha en texto que Date entiende se conserva como instante (y sigue siendo un número)', () => {
  const now = Date.UTC(2026, 8, 14)
  eq(normalizeMemory({ entries: [{ at: '2026-09-01T10:00:00Z', text: 'ISO' }] }, { now }), {
    entries: [{ at: Date.UTC(2026, 8, 1, 10, 0, 0), text: 'ISO' }],
  })
  eq(normalizeMemory({ entries: [{ at: '2026-09-01', text: 'día' }] }, { now }), {
    entries: [{ at: Date.UTC(2026, 8, 1), text: 'día' }],
  })
  eq(normalizeMemory({ entries: [{ at: 'Tue, 01 Sep 2026 10:00:00 GMT', text: 'http' }] }, { now }), {
    entries: [{ at: Date.UTC(2026, 8, 1, 10, 0, 0), text: 'http' }],
  })
  // Se rescata como NÚMERO: `at` es la clave con la que «Borrar» compara estricta
  // y la que `memoryToPrompt` imprime (una cadena no pasaría ninguna de las dos).
  const rescatada = normalizeMemory({ entries: [{ at: '2026-09-01T10:00:00Z', text: 'ISO' }] }, { now })
  eq(typeof rescatada.entries[0].at, 'number')
  eq(memoryToPrompt(rescatada), '[2026-09-01] ISO')
  eq(Object.keys(rescatada.entries[0]), ['at', 'text'])
  // Y la posición no la toca: la rescatada conserva la suya y sólo las de verdad
  // sin fecha gastan `now − posición`.
  eq(normalizeMemory({ entries: [{ text: 'sin' }, { at: '2026-09-01T10:00:00Z', text: 'ISO' }] }, { now }), {
    entries: [{ at: now, text: 'sin' }, { at: Date.UTC(2026, 8, 1, 10, 0, 0), text: 'ISO' }],
  })
  // Idempotente: normalizar lo rescatado no vuelve a moverlo.
  eq(normalizeMemory(rescatada, { now: 1 }), rescatada)
})

test('R1: una `at` en texto que no es una fecha sigue cayendo a `now − posición`', () => {
  const now = Date.UTC(2026, 8, 14)
  eq(
    normalizeMemory(
      { entries: [{ at: 'ayer', text: 'a' }, { at: '1700000000000', text: 'b' }, { at: '', text: 'c' }, { at: '   ', text: 'd' }, { at: '2026-13-45', text: 'e' }] },
      { now }
    ),
    {
      entries: [
        { at: now, text: 'a' },
        { at: now - 1, text: 'b' },
        { at: now - 2, text: 'c' },
        { at: now - 3, text: 'd' },
        { at: now - 4, text: 'e' },
      ],
    },
    'un número dentro de una cadena no es una fecha para Date, y una fecha imposible tampoco'
  )
  // Lo que no es ni número ni texto no se rescata; un número válido sigue mandando tal cual.
  eq(
    normalizeMemory({ entries: [{ at: 5, text: 'n' }, { at: true, text: 'b' }, { at: {}, text: 'o' }, { at: [1700000000000], text: 'l' }] }, { now }).entries.map((e) => e.at),
    [5, now - 1, now - 2, now - 3]
  )
})

test('R1: getMemory devuelve lo guardado normalizado y lo repara una sola vez: `at` estable entre lecturas y «Borrar» da con la entrada', () =>
  conChrome(async (local) => {
    const key = STORAGE_KEYS.memory(HOST)
    // Un almacén de antes del arreglo (o editado a mano): sin fecha, con claves de más y basura.
    local[key] = { entries: [{ text: 'sin fecha', extra: 1 }, 'basura', { at: 'ayer', text: 'x' }, { at: 3, text: 'c' }] }
    const antes = Date.now()
    const m1 = await getMemory(HOST)
    eq(m1.entries.map((e) => e.text), ['sin fecha', 'x', 'c'])
    for (const e of m1.entries) eq(Object.keys(e), ['at', 'text'])
    assert(m1.entries[0].at >= antes && m1.entries[0].at <= Date.now(), 'la fecha que falta es la de ahora')
    eq(m1.entries[1].at, m1.entries[0].at - 1, 'y la segunda sin fecha, una distinta')
    eq(m1.entries[2].at, 3, 'la válida se conserva')
    // La reparación se persiste: la segunda lectura da EXACTAMENTE lo mismo (mismo `at`) y no reescribe.
    eq(local[key], m1, 'lo guardado ya es lo normalizado')
    const guardado = JSON.stringify(local[key])
    eq(await getMemory(HOST), m1)
    eq(JSON.stringify(local[key]), guardado)
    // Por eso «Borrar» en la pantalla de memoria (borra por `at`) da con una entrada que no tenía fecha.
    eq((await removeEntry(HOST, m1.entries[0].at)).entries.map((e) => e.text), ['x', 'c'])
    // Lo que no tiene forma de memoria se lee vacío y se repara igual.
    local[key] = 'abc'
    eq(await getMemory(HOST), { entries: [] })
    eq(local[key], { entries: [] })
    // Sin nada guardado no se crea la clave (el almacén no gana claves por leer).
    delete local[key]
    eq(await getMemory(HOST), { entries: [] })
    eq(Object.keys(local), [])
  }))

test('R1: saveMemory nunca persiste nada que no pase por normalizeMemory', () =>
  conChrome(async (local) => {
    const key = STORAGE_KEYS.memory(HOST)
    await saveMemory(HOST, { version: 2, entries: [{ text: '  a  ', extra: 1 }, { at: 5, text: '' }, { at: 6, text: 'b' }] })
    eq(local[key].entries.map((e) => e.text), ['a', 'b'])
    for (const e of local[key].entries) eq(Object.keys(e), ['at', 'text'])
    eq(Object.keys(local[key]), ['entries'])
    assert(Number.isFinite(local[key].entries[0].at), 'la entrada sin fecha la gana al guardarse')
    await saveMemory(HOST, null)
    eq(local[key], { entries: [] })
  }))

test('worthRemembering: sólo si el usuario preguntó algo', () => {
  eq(worthRemembering([{ role: 'user', text: 'hola' }]), true)
  eq(worthRemembering([{ role: 'assistant', text: 'hola' }, { role: 'user', text: '¿y?' }]), true)
  eq(worthRemembering([{ role: 'assistant', text: 'sola' }]), false, 'una respuesta sin pregunta no es una sesión')
  eq(worthRemembering([]), false)
  eq(worthRemembering(null), false)
  eq(worthRemembering(undefined), false)
  eq(worthRemembering('user'), false, 'sólo una lista de turnos')
})

// ---- el resumen al cerrar la sesión ----------------------------------------

test('summarizeSession: pide el resumen con memorySummaryPrompt() y devuelve el texto del asistente, recortado a 1200', async () => {
  const llamadas = []
  const client = {
    prompt: async (sessionID, opts) => {
      llamadas.push({ sessionID, opts })
      return {
        parts: [
          { type: 'tool', tool: 'confluence_search', text: 'NO ENTRA' },
          { type: 'text', text: '  Buscaba el ADR de rotación.' },
          { type: 'text', text: '' },
          { type: 'text', text: 'Quedó a medias la sección 3.  ' },
        ],
      }
    },
  }
  const modelo = { providerID: 'opencode', modelID: 'hy3-free' }
  const r = await summarizeSession(client, { sessionID: 'ses_1', model: modelo })
  eq(r, 'Buscaba el ADR de rotación.\nQuedó a medias la sección 3.')
  eq(llamadas.length, 1)
  eq(llamadas[0].sessionID, 'ses_1')
  eq(llamadas[0].opts, { text: memorySummaryPrompt(), model: modelo })
  assert(/No copies contenido sensible/.test(llamadas[0].opts.text), 'el prompt pide no arrastrar datos sensibles')
  // Tope de 1200 caracteres.
  client.prompt = async () => ({ parts: [{ type: 'text', text: 'z'.repeat(5000) }] })
  eq((await summarizeSession(client, { sessionID: 'ses_1', model: modelo })).length, 1200)
})

test('summarizeSession: si opencode falla o no da texto, devuelve cadena vacía (nunca lanza)', async () => {
  eq(
    await summarizeSession(
      {
        prompt: async () => {
          throw new Error('boom')
        },
      },
      { sessionID: 'ses_1' }
    ),
    ''
  )
  eq(await summarizeSession({ prompt: async () => null }, { sessionID: 'ses_1' }), '')
  eq(await summarizeSession({ prompt: async () => ({ parts: [] }) }, { sessionID: 'ses_1' }), '')
  eq(await summarizeSession({ prompt: async () => ({ parts: [{ type: 'tool', text: 'x' }] }) }, { sessionID: 'ses_1' }), '')
  eq(await summarizeSession({}, { sessionID: 'ses_1' }), '', 'sin método prompt tampoco')
})
