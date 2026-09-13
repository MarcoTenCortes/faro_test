/**
 * Los dos niveles de memoria (src/panel/memory.js), con un `chrome.storage`
 * de mentira como el de service-worker.test.js.
 *
 * memory.js no toca `chrome` al importarse: sólo dentro de cada función. Por
 * eso el `chrome` se instala en cada prueba y se retira al salir, para no
 * dejarle nada raro a la siguiente. Lo que se guarda se clona (como hace
 * chrome.storage de verdad), para que ninguna prueba pase por compartir una
 * referencia. (Plan 2026-09-13, D6: puras sin test; el fallo R1 queda
 * documentado como comportamiento de hoy.)
 */
import { test, eq, assert, throws } from '../harness.js'
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
    // Lo que no es texto no revienta: se guarda como texto (vacío si no hay nada).
    // Hoy una entrada vacía se guarda igual; H2 (R1) normaliza lo que se guarda y lo que se lee.
    const m3 = await addEntry(HOST, null)
    eq(m3.entries[0].text, '')
    eq(m3.entries.length, 3)
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

test('R1 (pendiente para H2): memoryToPrompt lanza con una entrada sin fecha', async () => {
  // Hoy `new Date(e.at).toISOString()` revienta con «Invalid time value» si
  // `at` falta o no es una fecha, y como memoryToPrompt corre dentro del
  // runTurn de send(), tumba TODOS los turnos del host mientras la memoria
  // entre sesiones esté activa (plan 2026-09-13, R1; getMemory devuelve lo que
  // haya en el almacén sin normalizar). Esto documenta el comportamiento de
  // hoy. H2 lo invierte: la fecha pasa a ser opcional (la línea sale sin
  // «[fecha]») y getMemory normaliza lo que lee; entonces estos `throws` se
  // cambian por `eq(memoryToPrompt({ entries: [{ text: 'sin fecha' }] }), 'sin fecha')`.
  await throws(() => memoryToPrompt({ entries: [{ text: 'sin fecha' }] }), 'sin `at`')
  await throws(() => memoryToPrompt({ entries: [{ at: 'ayer', text: 'x' }] }), '`at` que no es una fecha')
  await throws(
    () => memoryToPrompt({ entries: [{ at: Date.UTC(2026, 0, 1), text: 'bien' }, { at: NaN, text: 'mal' }] }),
    'una sola entrada mala tira el prompt entero, con las buenas dentro'
  )
  // Ojo: `at: null` NO lanza (new Date(null) es el 1 de enero de 1970): sale con esa fecha.
  eq(memoryToPrompt({ entries: [{ at: null, text: 'nula' }] }), '[1970-01-01] nula')
})

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
