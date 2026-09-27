/**
 * El historial de análisis con páginas base: qué páginas eligió el usuario para
 * analizar QUÉ clase de trabajo, en este sitio.
 *
 * La pantalla de páginas base se abre vacía, y en un sitio real el usuario
 * vuelve a buscar la misma guía en cada ticket de API: la señal más fiable de
 * qué página hace falta para un ticket no está en ninguna API, está en lo que
 * esa misma persona eligió las veces anteriores (docs/PLAN.md §3.2). Aquí se
 * guarda eso y nada más: una entrada por incidencia o página analizada, con la
 * familia y la fase que ya leía la extensión de los campos en pantalla, los
 * componentes y etiquetas, las palabras del título y las páginas base que
 * ELIGIÓ. Nunca la respuesta del modelo, nunca texto de la página.
 *
 * Por qué con identidad (`issueKey` o `pageId`): sin ella, analizar tres veces
 * el mismo ticket contaría como tres usos de la misma guía y la inflaría hasta
 * lo más alto de las sugerencias. Una entrada por identidad, y la nueva
 * sustituye a la vieja. Una entrada sin identidad no se puede deduplicar, así
 * que no se guarda.
 *
 * Por qué en `chrome.storage.local` (`faro:source-history:<host>`) y no en
 * `sites[host]` ni en cookies: es un rastro local de qué incidencias analizó el
 * usuario —claves, ids y títulos, nunca texto—, tiene su propio tamaño y su
 * propia caducidad, y tiene que poder borrarse solo («Olvidar el historial»)
 * sin llevarse el modelo ni el MCP del sitio. Y NO APORTA TEXTO a ningún prompt:
 * de aquí salen puntos y un motivo escrito por la extensión (CLAUDE.md §8.20)
 * y, desde H22, UNA cosa más, que es una elección y no un contenido: por la
 * regla (b) de `linkedSpacesFor` (docs/PLAN2.md §3.4), el espacio de las páginas
 * base que usaron los análisis de un proyecto elige QUÉ contexto del Confluence
 * enlazado viaja desde ese proyecto (`applyLinkedScope` del panel). Lo que viaja
 * es ese contexto, escrito por el indexador o subido por el usuario; ni una
 * clave, ni un título, ni una palabra de esta lista llega al modelo.
 *
 * La lógica es pura —lo que entra del almacenamiento se reconstruye con claves
 * blancas y el reloj se inyecta—, y al final del fichero viven las tres
 * funciones que tocan `chrome.storage`, como en `memory.js`: `normalizeHistory`
 * es del panel, y `src/shared/storage.js` NO puede importar de `src/panel/`
 * (misma razón por la que `getSiteBundle` entrega `memoryRaw` sin normalizar).
 * Guardar y normalizar tienen que vivir juntos para que no se pueda persistir
 * nada sin reconstruir (CLAUDE.md §9). De `shared/storage.js` sí son la clave
 * (`STORAGE_KEYS.sourceHistory`), el borrado de «Olvidar este sitio» y que el
 * valor CRUDO viaje en el paquete del arranque (`BUNDLE_EXTRA_KEYS`).
 */

import { STORAGE_KEYS } from '../shared/config.js'
import { clean } from '../nav/validate.js'
import { isRealSpaceKey, validIssueKey, validProjectKey } from '../atlassian/site.js'
import { issueProfile, ISSUE_FAMILIES, ISSUE_PHASES } from './issue-profile.js'
import { DEFAULT_SOURCE_MODE, foldText, normalizePage, SOURCE_LIMITS, SOURCE_MODES } from './sources.js'

/** La versión de lo guardado. Un historial de otra versión se tira: se rellena solo. */
export const HISTORY_VERSION = 1

/** Un día en milisegundos. Lo comparte `source-suggest.js` para el decaimiento. */
export const DAY_MS = 24 * 60 * 60 * 1000

export const HISTORY_LIMITS = {
  /**
   * Entradas que se conservan. Sesenta análisis son meses de trabajo en un
   * sitio; más no mejora la sugerencia y sí engorda una clave que se lee
   * entera al arrancar el panel (≈20 KB por host con el tope de abajo).
   */
  maxEntries: 60,
  /** Y su caducidad: lo que se usó hace tres meses ya no dice qué toca hoy. */
  maxAgeDays: 90,
  /** Componentes o etiquetas que se guardan de una incidencia. */
  listMax: 10,
  /** Palabras del título que se guardan. */
  wordsMax: 8,
  /** Y cuánto tiene que medir una palabra para valer: «de», «API» no distinguen nada. */
  wordMin: 4,
  /** Un componente o una etiqueta son cortos; más largo es otra cosa. */
  tagMax: 40,
  /** El host va dentro del objeto además de en la clave, para poder mirarlo. */
  hostMax: 255,
}

const ID = /^\d+$/
const FAMILY_IDS = new Set(ISSUE_FAMILIES.map((f) => f.id))
const PHASE_IDS = new Set(ISSUE_PHASES.map((p) => p.id))
/** Los dos productos que se analizan. Cualquier otra cosa no es un producto. */
const PRODUCTS = ['jira', 'confluence']

// ------------------------------------------------------------ forma canónica

export function emptyHistory() {
  return { version: HISTORY_VERSION, host: '', entries: [] }
}

/**
 * Las palabras con las que se compara un título: plegadas (sin acentos ni
 * mayúsculas), sin repetir, sólo las que distinguen algo y con tope.
 *
 * Vive aquí y no en `source-suggest.js` —donde lo puso el anexo B— porque aquí
 * es donde se PRODUCEN (el campo `words` de cada entrada) y porque
 * `source-suggest.js` ya importa de este módulo: al revés habría un ciclo, y
 * copiarla en los dos sería el «uno por módulo» de CLAUDE.md §9 al revés. Pura.
 */
export function titleWords(text, { min = HISTORY_LIMITS.wordMin, max = HISTORY_LIMITS.wordsMax } = {}) {
  const out = []
  const tope = Number.isInteger(max) && max > 0 ? max : HISTORY_LIMITS.wordsMax
  const minimo = Number.isInteger(min) && min > 0 ? min : HISTORY_LIMITS.wordMin
  for (const w of foldText(clean(text, SOURCE_LIMITS.titleMax)).split(/[^\p{L}\p{N}]+/u)) {
    if (out.length >= tope) break
    if (w.length < minimo || out.includes(w)) continue
    out.push(w)
  }
  return out
}

/** Componentes y etiquetas, plegados para poder compararlos sin pensar. */
function tags(raw) {
  const out = []
  for (const item of Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []) {
    if (out.length >= HISTORY_LIMITS.listMax) break
    const t = foldText(clean(item, HISTORY_LIMITS.tagMax))
    if (!t || out.includes(t)) continue
    out.push(t)
  }
  return out
}

/** Las palabras guardadas, revalidadas como si vinieran de un título. */
function words(raw) {
  const out = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= HISTORY_LIMITS.wordsMax) break
    const w = foldText(clean(item, SOURCE_LIMITS.titleMax))
    if (w.length < HISTORY_LIMITS.wordMin || out.includes(w)) continue
    out.push(w)
  }
  return out
}

/**
 * Las páginas base que se eligieron, en su forma mínima: id, título y espacio.
 *
 * SIN `path`, a diferencia de una página base viva: la ruta es relativa al
 * sitio donde vive la página, y desde un Jira las páginas son del Confluence
 * ENLAZADO, así que guardarla sería guardar una ruta que no es de este host.
 * La URL se reconstruye del índice o del id, como en todo lo demás (§8.3).
 */
function pages(raw) {
  const out = []
  const vistos = new Set()
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= SOURCE_LIMITS.maxPages) break
    const page = normalizePage(item)
    if (!page || vistos.has(page.id)) continue
    vistos.add(page.id)
    out.push({ id: page.id, spaceKey: page.spaceKey, title: page.title })
  }
  return out
}

/**
 * Una entrada del historial en su forma canónica, o null si no lo es.
 *
 * Se cae: la que no trae ninguna página base (no dice nada que sugerir), la que
 * no trae identidad —ni clave de incidencia ni id de página— porque no se
 * podría deduplicar, y la que no trae un instante. Todo lo demás se reconstruye
 * con claves blancas. Un `at` en el futuro (el reloj del sistema se movió) se
 * trae a «ahora»: dejarlo lo pondría el primero para siempre y no caducaría
 * nunca.
 */
function normalizeEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const bruto = Number(raw.at)
  if (!Number.isFinite(bruto) || bruto < 0) return null
  const tope = Number.isFinite(now) ? now : Date.now()
  const at = Math.round(Math.min(bruto, tope))

  const elegidas = pages(raw.pages)
  if (!elegidas.length) return null

  const issueKey = validIssueKey(raw.issueKey)
  const pageIdBruto = String(raw.pageId ?? '').trim()
  const pageId = ID.test(pageIdBruto) ? pageIdBruto : ''
  if (!issueKey && !pageId) return null

  const spaceKey = clean(raw.spaceKey, SOURCE_LIMITS.spaceKeyMax)
  return {
    at,
    components: tags(raw.components),
    family: FAMILY_IDS.has(raw.family) ? raw.family : '',
    issueKey,
    labels: tags(raw.labels),
    mode: SOURCE_MODES.includes(raw.mode) ? raw.mode : DEFAULT_SOURCE_MODE,
    pageId,
    pages: elegidas,
    phase: PHASE_IDS.has(raw.phase) ? raw.phase : '',
    product: PRODUCTS.includes(raw.product) ? raw.product : '',
    projectKey: validProjectKey(raw.projectKey),
    spaceKey: isRealSpaceKey(spaceKey) ? spaceKey : null,
    words: words(raw.words),
  }
}

/** Qué identifica una entrada: la incidencia, o la página, que se analizó. */
function identityOf(entry) {
  return entry.issueKey || entry.pageId
}

/**
 * Lo guardado (o lo que sea) en la forma canónica: entradas reconstruidas, las
 * caducadas fuera, una sola por identidad y con tope, de la más nueva a la más
 * vieja. Pura.
 *
 * Un `version` distinto se tira entero, como el perfil del proyecto: el
 * historial se rellena solo con el uso y nada se rompe por perderlo. Un objeto
 * SIN `version` sí se acepta —cada entrada se reconstruye de todas formas—
 * para que quien construya uno a mano (una prueba, el banco) no tenga que
 * saberse el número.
 *
 * @param {{host?: string, now?: number}} [ctx] el reloj se inyecta: la
 *        caducidad tiene que dar lo mismo hoy que dentro de un año en una prueba
 */
export function normalizeHistory(raw, { host = '', now = Date.now() } = {}) {
  const out = emptyHistory()
  const t = Number.isFinite(now) ? now : Date.now()
  out.host = clean(host, HISTORY_LIMITS.hostMax) || clean(raw?.host, HISTORY_LIMITS.hostMax)
  if (!raw || typeof raw !== 'object') return out
  if (raw.version !== undefined && raw.version !== HISTORY_VERSION) return out

  const limite = t - HISTORY_LIMITS.maxAgeDays * DAY_MS
  const entradas = (Array.isArray(raw.entries) ? raw.entries : [])
    .map((e) => normalizeEntry(e, t))
    .filter((e) => e && e.at >= limite)
    .sort((a, b) => b.at - a.at)

  const vistos = new Set()
  for (const e of entradas) {
    if (out.entries.length >= HISTORY_LIMITS.maxEntries) break
    const id = identityOf(e)
    if (vistos.has(id)) continue
    vistos.add(id)
    out.entries.push(e)
  }
  return out
}

/**
 * La entrada de un análisis que acaba de terminar, o null si no hay nada que
 * apuntar (sin páginas base elegidas, o sin saber sobre qué se analizaba).
 *
 * La familia y la fase salen de `issueProfile`, que es el mismo sitio donde se
 * deciden para el prompt: si mañana «Ready for QA» deja de ser revisión, deja
 * de serlo en los dos a la vez. Pura.
 *
 * @param {{sources?: object, issue?: object|null, summary?: string,
 *          issueKey?: string, pageId?: string, projectKey?: string,
 *          spaceKey?: string, product?: string, now?: number}} ctx
 */
export function historyEntry({
  sources = null,
  issue = null,
  summary = '',
  issueKey = '',
  pageId = '',
  projectKey = '',
  spaceKey = '',
  product = '',
  now = Date.now(),
} = {}) {
  const { family, phase } = issueProfile(issue, { summary })
  return normalizeEntry(
    {
      at: now,
      components: issue?.components,
      family,
      issueKey,
      labels: issue?.labels,
      mode: sources?.mode,
      pageId,
      pages: sources?.pages,
      phase,
      product,
      projectKey,
      spaceKey,
      words: titleWords(summary),
    },
    now
  )
}

/**
 * Apunta un análisis: la entrada nueva sustituye a la de su misma incidencia o
 * página, y la lista queda purgada y acotada. No muta lo que recibe. Pura.
 */
export function recordAnalysis(history, entry, { host = '', now = Date.now() } = {}) {
  const base = normalizeHistory(history, { host, now })
  const nueva = normalizeEntry(entry, now)
  if (!nueva) return base
  const id = identityOf(nueva)
  return normalizeHistory(
    {
      version: HISTORY_VERSION,
      host: base.host,
      entries: [nueva, ...base.entries.filter((e) => identityOf(e) !== id)],
    },
    { host: base.host, now }
  )
}

// --------------------------------------------------------------- consultas

/**
 * Qué se sabe del uso de una página base, para poder puntuarla y explicarla.
 *
 * Devuelve los usos uno a uno además de los recuentos porque las reglas que
 * puntúan CRUZAN dos cosas a la vez («la misma familia Y el mismo proyecto»,
 * «la misma familia Y un componente compartido») y un recuento por familia y
 * otro por proyecto no se pueden cruzar después. Quién puntúa es
 * `source-suggest.js`: aquí sólo se cuenta.
 *
 * El ÁMBITO de un uso es el proyecto en Jira y el espacio en Confluence: para
 * sugerir, lo que importa es «el mismo sitio de trabajo», y en la entrada van
 * por separado porque son dos claves distintas.
 *
 * Tolera un historial sin normalizar (no lanza), pero cuenta lo que haya: quien
 * lo lee del almacén lo pasa antes por `normalizeHistory`. Pura.
 *
 * @param {{here?: string}} [ctx] la incidencia o la página que se tiene delante
 * @returns {{total:number, uses:Array<{at:number, family:string, issueKey:string, pageId:string, scope:string, tags:string[]}>,
 *            byFamily:Object, byProject:Object, tags:string[], lastAt:number, lastIssueKey:string, usedHere:boolean}}
 */
export function usesOf(history, pageId, { here = '' } = {}) {
  const id = String(pageId ?? '').trim()
  const out = { total: 0, uses: [], byFamily: {}, byProject: {}, tags: [], lastAt: 0, lastIssueKey: '', usedHere: false }
  if (!ID.test(id)) return out
  // Los recuentos se llevan en Map y se vuelcan al final: con un historial sin
  // normalizar, una familia «__proto__» asignada sobre un objeto literal no
  // crea ninguna propiedad (el `set` del prototipo se traga el número) y el
  // recuento salía en silencio a cero. `Object.fromEntries` sí la crea como
  // propiedad propia. Misma clase de trampa que la de `suggestionsFor` en H5.
  const porFamilia = new Map()
  const porAmbito = new Map()

  const aquiClave = validIssueKey(here)
  const aquiBruto = String(here ?? '').trim()
  const aquiPagina = ID.test(aquiBruto) ? aquiBruto : ''

  for (const e of Array.isArray(history?.entries) ? history.entries : []) {
    if (!e || typeof e !== 'object') continue
    const elegidas = Array.isArray(e.pages) ? e.pages : []
    if (!elegidas.some((p) => String(p?.id ?? '') === id)) continue

    const scope = e.projectKey || e.spaceKey || ''
    const etiquetas = []
    for (const t of [...(Array.isArray(e.components) ? e.components : []), ...(Array.isArray(e.labels) ? e.labels : [])]) {
      if (typeof t === 'string' && t && !etiquetas.includes(t)) etiquetas.push(t)
    }
    const at = Number.isFinite(e.at) ? e.at : 0
    const clave = typeof e.issueKey === 'string' ? e.issueKey : ''
    const pagina = typeof e.pageId === 'string' ? e.pageId : ''

    out.total++
    out.uses.push({ at, family: typeof e.family === 'string' ? e.family : '', issueKey: clave, pageId: pagina, scope, tags: etiquetas })
    if (e.family) porFamilia.set(e.family, (porFamilia.get(e.family) || 0) + 1)
    if (scope) porAmbito.set(scope, (porAmbito.get(scope) || 0) + 1)
    for (const t of etiquetas) if (!out.tags.includes(t)) out.tags.push(t)
    if (at > out.lastAt) {
      out.lastAt = at
      out.lastIssueKey = clave
    }
    if ((aquiClave && clave.toUpperCase() === aquiClave) || (aquiPagina && pagina === aquiPagina)) out.usedHere = true
  }
  out.byFamily = Object.fromEntries(porFamilia)
  out.byProject = Object.fromEntries(porAmbito)
  return out
}

// ------------------------------------------------------------ almacenamiento

/**
 * El historial guardado de un host, ya reconstruido y purgado. No repara lo
 * guardado (no hace falta: aquí no se borra nada por su `at`, como sí pasaba
 * en la memoria entre sesiones), así que leer no escribe.
 */
export async function getSourceHistory(host, { now = Date.now() } = {}) {
  const key = STORAGE_KEYS.sourceHistory(host)
  const got = await chrome.storage.local.get(key)
  return normalizeHistory(got[key], { host, now })
}

/**
 * Guarda el historial, y por aquí no pasa nada sin `normalizeHistory`: es lo
 * que hace que lo que se lea mañana sea lo que este módulo promete. Devuelve lo
 * que quedó guardado. Sin ninguna entrada se quita la clave, para no dejar un
 * objeto vacío por cada host visitado.
 */
export async function saveSourceHistory(host, history, { now = Date.now() } = {}) {
  const limpio = normalizeHistory(history, { host, now })
  if (!limpio.entries.length) {
    await chrome.storage.local.remove(STORAGE_KEYS.sourceHistory(host))
    return limpio
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.sourceHistory(host)]: limpio })
  return limpio
}

/** «Olvidar el historial»: se va la clave entera de ese host. */
export async function clearSourceHistory(host) {
  await chrome.storage.local.remove(STORAGE_KEYS.sourceHistory(host))
}
