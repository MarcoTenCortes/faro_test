/**
 * Los dos niveles de memoria.
 *
 * Dentro de una sesión no hay nada que implementar: una sesión de opencode ya
 * es un hilo con historial. Lo que se construye aquí es el nivel de arriba —
 * el resumen de una sesión que sobrevive a la siguiente — y es opcional
 * porque un resumen puede arrastrar cosas que no quieres guardar.
 *
 * Lo que sale del almacén no se cree a ciegas. `memoryToPrompt` hacía
 * `new Date(e.at).toISOString()` sin comprobar nada y, con una entrada sin
 * fecha válida (un almacén editado a mano, una versión anterior del formato),
 * reventaba con «Invalid time value» dentro del `runTurn` de send(): TODOS los
 * turnos del host fallaban con un error genérico mientras la memoria entre
 * sesiones estuviera activa, sin pista de que la culpa era una entrada
 * (reproducido en la auditoría del 2026-09-13, docs/PLAN.md §2.4 R1). Desde
 * entonces la fecha es opcional en el prompt y todo lo que se lee o se guarda
 * pasa por `normalizeMemory`: claves blancas `{at, text}`, texto no vacío y un
 * instante válido (o el de ahora).
 */

import { STORAGE_KEYS } from '../shared/config.js'
import { emptyContexts, normalizeContexts } from '../shared/scopes.js'
import { memorySummaryPrompt } from './prompts.js'

const MAX_ENTRIES = 40
const MAX_CHARS = 12000

/**
 * ¿Es `at` un instante que Date sabe imprimir? Un número finito no basta:
 * Date sólo cubre ±8,64e15 ms, y `new Date(1e20).toISOString()` lanza igual
 * que con NaN. Una fecha como texto o `null` tampoco cuentan: `at` es la
 * clave con la que `removeEntry` borra y se compara estricta. Puro.
 */
function validInstant(at) {
  return typeof at === 'number' && Number.isFinite(new Date(at).getTime())
}

/** «AAAA-MM-DD» de un instante válido, o '' si no lo es (la línea sale sin fecha). Puro. */
function isoDay(at) {
  return validInstant(at) ? new Date(at).toISOString().slice(0, 10) : ''
}

/**
 * El instante de `at`, o null si no hay ninguno que rescatar. Un número válido
 * vale tal cual; una fecha en TEXTO se recupera con `Date.parse` y se guarda ya
 * como número, que es lo que `removeEntry` compara estricta y lo que `isoDay`
 * sabe imprimir. Antes toda `at` que no fuera número se daba por perdida y se
 * sustituía por la de ahora, así que un almacén exportado a JSON y vuelto a
 * importar (o editado a mano) con «2026-09-01T10:00:00Z» perdía la fecha de
 * cada entrada: todas pasaban a ser de hoy (revisión adversaria de H2,
 * 2026-09-14). Lo que `Date` no entiende no se rescata. Puro.
 */
function instantOf(at) {
  if (validInstant(at)) return at
  if (typeof at === 'string') {
    const t = Date.parse(at)
    if (validInstant(t)) return t
  }
  return null
}

/** Una entrada con claves blancas `{at, text}`, o null si no tiene texto. Pura. */
function normalizeEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text || '').trim()
  if (!text) return null
  const at = instantOf(raw.at)
  return { at: at === null ? now : at, text }
}

/**
 * Reconstruye una memoria con lo que valga de `raw`: `entries` lista, cada
 * entrada `{at, text}` con texto no vacío y `at` instante válido, tope
 * MAX_ENTRIES. Una fecha en texto que `Date` entienda se conserva (`instantOf`);
 * a la que no trae fecha se le pone `now − posición` (`now` es
 * Date.now() por defecto): distintas entre sí porque `removeEntry` borra por
 * `at`, y dos reparadas con el mismo instante caerían juntas al borrar una
 * (lo destapó su test). Lo que no tiene forma de memoria queda
 * `{ entries: [] }`. Idempotente. Pura.
 */
export function normalizeMemory(raw, { now = Date.now() } = {}) {
  const lista = Array.isArray(raw?.entries) ? raw.entries : []
  const entries = []
  for (const e of lista) {
    const entry = normalizeEntry(e, now - entries.length)
    if (entry) entries.push(entry)
    if (entries.length >= MAX_ENTRIES) break
  }
  return { entries }
}

/**
 * Los contextos del sitio (los CONTEXT.md), uno por ÁMBITO dentro de la misma
 * clave por host (H21, docs/PLAN2.md §3.4, opción (iii) del anexo 2-D).
 *
 * Hasta H21 `faro:context:<host>` era UN texto y generar el contexto de un
 * segundo espacio pisaba el del primero. Ahora es `{version: 2, scopes}`
 * (`normalizeContexts`, scopes.js), y sigue siendo la misma clave en la misma
 * área: el olvido derivado de H13 se la lleva entera sin tocar nada, y el
 * arranque la sigue leyendo en el paquete del sitio (`contextRaw`).
 *
 * Como `getMemory`: lo guardado que no era ya un objeto v2 normalizado —el
 * texto de antes de H21, o algo editado a mano— se REPARA una vez, escribiendo
 * lo normalizado; sin eso la migración se repetiría en cada lectura con un
 * `at` distinto. Sin nada guardado no se crea la clave, y si la reparación no
 * se puede escribir se lee normalizado igual. `legacyScope`/`legacyIndexedAt`
 * dicen bajo qué ámbito migra un texto viejo, y los decide quien llama con
 * prudencia: ante cualquier duda, `'*'`.
 */
export async function getContexts(host, { legacyScope = '*', legacyIndexedAt = null } = {}) {
  const got = await chrome.storage.local.get(STORAGE_KEYS.context(host))
  const key = STORAGE_KEYS.context(host)
  if (!(key in got)) return emptyContexts()
  const contexts = normalizeContexts(got[key], { legacyScope, legacyIndexedAt })
  if (JSON.stringify(contexts) !== JSON.stringify(got[key])) {
    try {
      await saveContexts(host, contexts)
    } catch {
      /* se lee normalizado igual; sólo se pierde la reparación */
    }
  }
  return contexts
}

/**
 * Nunca se persiste nada que no pase por `normalizeContexts`. Sin ningún
 * ámbito se QUITA la clave, como hace `saveProfile`: guardar un objeto vacío
 * dejaría una clave que «Qué guarda Faro de mí» tendría que explicar.
 */
export async function saveContexts(host, ctxs) {
  const limpio = normalizeContexts(ctxs)
  if (!Object.keys(limpio.scopes).length) {
    await chrome.storage.local.remove(STORAGE_KEYS.context(host))
    return limpio
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.context(host)]: limpio })
  return limpio
}

/**
 * La memoria del host, normalizada. Si lo guardado no lo estaba (de antes de
 * R1, o editado a mano) se reescribe UNA vez: sin eso, una entrada sin fecha
 * recibiría un `at` distinto en cada lectura y «Borrar» en la pantalla de
 * memoria —que borra por `at`— no daría con ella. Sin nada guardado no se
 * crea la clave, y si la reparación no se puede escribir se lee normalizada igual.
 */
export async function getMemory(host) {
  const key = STORAGE_KEYS.memory(host)
  const got = await chrome.storage.local.get(key)
  if (!(key in got)) return { entries: [] }
  const memory = normalizeMemory(got[key])
  if (JSON.stringify(memory) !== JSON.stringify(got[key])) {
    try {
      await saveMemory(host, memory)
    } catch {
      /* se lee normalizada igual; sólo se pierde la reparación */
    }
  }
  return memory
}

/** Nunca se persiste nada que no pase por `normalizeMemory`. */
export async function saveMemory(host, memory) {
  await chrome.storage.local.set({ [STORAGE_KEYS.memory(host)]: normalizeMemory(memory) })
}

export async function clearMemory(host) {
  await chrome.storage.local.remove(STORAGE_KEYS.memory(host))
}

/** Añade la entrada la primera; un texto vacío no se guarda (la memoria queda como estaba). */
export async function addEntry(host, text) {
  const memory = await getMemory(host)
  const limpio = String(text || '').trim()
  if (!limpio) return memory
  memory.entries.unshift({ at: Date.now(), text: limpio })
  memory.entries = memory.entries.slice(0, MAX_ENTRIES)
  await saveMemory(host, memory)
  return memory
}

export async function removeEntry(host, at) {
  const memory = await getMemory(host)
  memory.entries = memory.entries.filter((e) => e.at !== at)
  await saveMemory(host, memory)
  return memory
}

/**
 * Texto que se inyecta en el `system` de cada turno. Acotado a lo reciente.
 * La fecha es opcional: sale «[AAAA-MM-DD] texto» si `at` es un instante
 * válido y el texto a secas si no (nunca se inventa una, nunca se lanza).
 * Lo que no es una entrada con texto se salta. Puro.
 */
export function memoryToPrompt(memory) {
  if (!Array.isArray(memory?.entries)) return ''
  const out = []
  let total = 0
  for (const e of memory.entries) {
    const text = String(e?.text || '').trim()
    if (!text) continue
    const fecha = isoDay(e.at)
    const line = fecha ? `[${fecha}] ${text}` : text
    if (total + line.length > MAX_CHARS) break
    out.push(line)
    total += line.length
  }
  return out.join('\n\n')
}

/**
 * Resume la sesión que se cierra. Usa el propio resumidor de opencode y, si
 * no da texto aprovechable, pide el resumen a mano.
 */
export async function summarizeSession(client, { sessionID, model }) {
  try {
    const msg = await client.prompt(sessionID, { text: memorySummaryPrompt(), model })
    const text = (msg?.parts || [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
      .trim()
    return text.slice(0, 1200)
  } catch {
    return ''
  }
}

/** ¿Ha pasado algo en esta sesión que merezca guardarse? */
export function worthRemembering(turns) {
  return Array.isArray(turns) && turns.filter((t) => t.role === 'user').length >= 1
}
