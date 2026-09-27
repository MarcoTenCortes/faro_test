/**
 * El ámbito: la unidad del contexto y del mapa dentro de un host (H21, docs/PLAN2.md §3.4).
 *
 * Por qué existe. Hasta H21 todo era por HOST, y en un Confluence con varios
 * espacios eso rompía tres cosas (anexo 2-D, verificado):
 *
 * - el CONTEXT.md del espacio A se PISABA con el del B: `faro:context:<host>`
 *   era un solo texto, y generar el contexto del segundo espacio borraba el
 *   del primero sin decir nada;
 * - el índice FUNDÍA los espacios y nadie prefería el de la pestaña: el
 *   planificador y las sugerencias veían trescientas páginas de otro espacio
 *   delante de las diez del que el usuario tenía abierto;
 * - y el segundo espacio nunca pedía contexto, porque «ya está indexado» era
 *   una marca del host (`sites[host].onboarded`).
 *
 * Se decidió la opción (iii) del anexo: un contexto POR ÁMBITO («space:KEY»,
 * «project:KEY» o «*», todo el sitio) DENTRO de la misma clave por host, que
 * pasa de ser un texto a ser `{version: 2, scopes: {...}}`. La (ii), una clave
 * por (host, espacio), se descartó porque rompía el olvido derivado de H13
 * (`forgetEverythingFor` llama a cada clave por host con UN argumento y habría
 * borrado `faro:context:<host>:undefined`), la lectura única del arranque (P4)
 * y el paso a paso entre espacios, que hoy funciona porque el índice es uno.
 * Con la (iii) `STORAGE_KEYS` no gana ninguna clave: el olvido, las áreas y el
 * paquete del sitio siguen igual.
 *
 * El índice se queda en UNA clave por host y sin migrar (§8.26): cada página
 * lleva su `spaceKey`, y lo que hace falta de un espacio se FILTRA
 * (`subIndex`), se ORDENA (el `preferSpace` de index-store y sources) o se
 * CUENTA (`countPages`), pero nunca se parte. Si un ámbito tiene mapa no lo
 * dicen sus páginas sino su `indexedAt` (`hasMap`, revisión adversaria de H21).
 *
 * Una sola idea de qué es una clave: `validSpaceKey`/`validProjectKey` de
 * site.js (§9). La regex `SCOPE_KEY` es la lista blanca de la FORMA de la
 * clave de ámbito, y la parte de detrás se revalida siempre con ellas.
 *
 * Puro: sin DOM, sin `chrome`, sin `fetch`. Nada de aquí lanza.
 */

import { validSpaceKey, validProjectKey, isRealSpaceKey } from '../atlassian/site.js'
import { INDEX_LIMITS } from './config.js'

/** La forma del objeto de contextos; el texto suelto de antes de H21 es la «1». */
export const CONTEXTS_VERSION = 2

/**
 * La lista blanca de claves de ámbito. La parte tras `space:` se revalida con
 * `validSpaceKey` y la de `project:` con `validProjectKey`: esta regex no basta
 * sola (acepta cualquier cosa sin espacios detrás de `space:`), y una segunda
 * idea de qué es una clave de espacio acabaría diciendo otra cosa (§9).
 */
export const SCOPE_KEY = /^(\*|space:[^\s]+|project:[A-Z][A-Z0-9_]*)$/

/**
 * Los topes del módulo (uno por módulo, §9): cuántos ámbitos por host, cuántos
 * caracteres de un contexto AL GUARDAR (el prompt ya lo recorta a
 * `CONTEXT_BUDGET`; el almacén no acotaba nada, y un contexto subido a mano de
 * varios MB se leería entero en cada arranque) y cuántas claves se nombran en
 * la línea de «tiene mapa de otros espacios».
 */
export const SCOPE_LIMITS = Object.freeze({ maxScopes: 40, textMax: 60000, keysShown: 6 })

/** ¿Es `v` un instante que `Date` sabe manejar y posterior a 1970? Puro. */
function instanteValido(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isFinite(new Date(v).getTime())
}

/**
 * Una clave de espacio con forma de clave y tal cual viene, o ''. Más estricta
 * que `isRealSpaceKey` a propósito: lo que sale de aquí acaba en una clave de
 * ámbito y, por `stampSpace`, en el `spaceKey` de páginas del índice, que el
 * digest del planificador imprime entre corchetes. Pura.
 */
function claveDeEspacio(k) {
  return typeof k === 'string' && validSpaceKey(k) === k && isRealSpaceKey(k) ? k : ''
}

/** ¿Es `key` una clave de ámbito válida, con su parte de detrás revalidada? Pura. */
function claveValida(key) {
  if (typeof key !== 'string' || !SCOPE_KEY.test(key)) return false
  if (key === '*') return true
  if (key.startsWith('space:')) return !!claveDeEspacio(key.slice('space:'.length))
  if (key.startsWith('project:')) {
    const k = key.slice('project:'.length)
    return validProjectKey(k) === k
  }
  return false
}

/** Un objeto normal (no una lista, no null). Puro. */
function esObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * El texto de un ámbito, recortado y acotado, o '' si no hay nada. El `trim`
 * va a los dos lados del corte para que normalizar dos veces dé lo mismo: sin
 * el segundo, un corte que cae en un espacio dejaría un texto que la vuelta
 * siguiente recortaría otra vez. Pura.
 */
function textoDe(v) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, SCOPE_LIMITS.textMax).trim()
}

/**
 * La clave de ámbito de un sitio: `space:KEY` en un Confluence con clave de
 * espacio válida, `project:KEY` en un Jira con clave de proyecto válida, y
 * `'*'` en cualquier otro caso (sin sitio, sin producto, clave rara). Pura,
 * determinista, nunca lanza.
 */
export function scopeKeyOf(site) {
  if (!esObjeto(site)) return '*'
  if (site.product === 'confluence' && typeof site.spaceKey === 'string') {
    const k = validSpaceKey(site.spaceKey)
    return k && claveDeEspacio(k) ? 'space:' + k : '*'
  }
  if (site.product === 'jira' && typeof site.projectKey === 'string') {
    const k = validProjectKey(site.projectKey)
    return k ? 'project:' + k : '*'
  }
  return '*'
}

/**
 * La clave de ámbito de un `scope` del índice (`{kind: 'space', key}`,
 * `{kind: 'project', key}`); lo demás —`confluence-site`, `jira-site`, nada—
 * es `'*'`. Es lo que usa la migración del texto de antes de H21. Pura.
 */
export function scopeKeyFromScope(scope) {
  if (!esObjeto(scope) || typeof scope.key !== 'string') return '*'
  if (scope.kind === 'space') {
    const k = validSpaceKey(scope.key)
    return k && claveDeEspacio(k) ? 'space:' + k : '*'
  }
  if (scope.kind === 'project') {
    const k = validProjectKey(scope.key)
    return k ? 'project:' + k : '*'
  }
  return '*'
}

/**
 * Cómo se llama un ámbito en la interfaz: «el espacio X», «el proyecto X» o
 * «todo el sitio». Nunca entra en un prompt. Una clave que no valida se
 * enseña como «todo el sitio», que es a lo que cae. Pura.
 */
export function scopeLabel(key) {
  if (!claveValida(key) || key === '*') return 'todo el sitio'
  if (key.startsWith('space:')) return 'el espacio ' + key.slice('space:'.length)
  return 'el proyecto ' + key.slice('project:'.length)
}

/** Unos contextos sin ningún ámbito. Pura. */
export function emptyContexts() {
  return { version: CONTEXTS_VERSION, scopes: {} }
}

/**
 * Reconstruye los contextos de un host con lo que valga de `raw`. Pura,
 * idempotente, nunca lanza.
 *
 * - Un TEXTO (lo que se guardaba antes de H21) migra como UN ámbito con
 *   `legacy: true`: bajo `legacyScope` con su `indexedAt` SÓLO si la clave
 *   revalida, no es `'*'` y `legacyIndexedAt` es un instante válido; en
 *   cualquier otro caso bajo `'*'` y con `indexedAt` null. Quien llama decide
 *   `legacyScope` con prudencia (docs/PLAN2.md §3.4) y aquí se exige otra vez:
 *   ante cualquier duda, `'*'`, que se enseña en todos los espacios, o sea lo
 *   de hoy.
 * - Un objeto de otra versión no se interpreta: vacío.
 * - Uno de la versión 2: sólo las claves PROPIAS de `scopes` que casan
 *   `SCOPE_KEY` y revalidan (así `__proto__`, `constructor` y `toString`, que
 *   llegan como propias por `JSON.parse`, se caen), con texto no vacío, `at`
 *   instante válido o `now`, `indexedAt` instante válido o null y `legacy`
 *   booleano de verdad. Tope `SCOPE_LIMITS.maxScopes` conservando los más
 *   recientes por `at`, en el orden en que estaban.
 */
export function normalizeContexts(raw, { legacyScope = '*', legacyIndexedAt = null, now = Date.now() } = {}) {
  const ahora = instanteValido(now) ? now : Date.now()
  if (typeof raw === 'string') {
    const text = textoDe(raw)
    if (!text) return emptyContexts()
    // SÓLO bajo un ámbito concreto si además se sabe CUÁNDO se indexó: un texto
    // sin fecha de indexado puede ser un contexto subido a mano, que no cambia
    // `index.scope` (docs/PLAN2.md §3.4), y entonces el ámbito del índice no
    // dice de qué es. En cualquier duda, `'*'` y sin `indexedAt`: se enseña en
    // todos los espacios, que es lo de antes de H21, y no finge un mapa.
    const seguro = claveValida(legacyScope) && legacyScope !== '*' && instanteValido(legacyIndexedAt)
    return {
      version: CONTEXTS_VERSION,
      scopes: {
        [seguro ? legacyScope : '*']: { text, at: ahora, indexedAt: seguro ? legacyIndexedAt : null, legacy: true },
      },
    }
  }
  if (!esObjeto(raw) || raw.version !== CONTEXTS_VERSION || !esObjeto(raw.scopes)) return emptyContexts()

  const entradas = []
  for (const key of Object.keys(raw.scopes)) {
    if (!Object.hasOwn(raw.scopes, key) || !claveValida(key)) continue
    const e = raw.scopes[key]
    if (!esObjeto(e)) continue
    const text = textoDe(e.text)
    if (!text) continue
    entradas.push({
      key,
      value: {
        text,
        // Un instante del futuro (un reloj adelantado y luego corregido) se trae
        // a ahora, como en normalizeActivity y normalizeModelChecks: si no, con el
        // tope lleno de ámbitos del futuro, el recién escrito (at = ahora) sería
        // el que tirara el tope (revisión adversaria de H21).
        at: instanteValido(e.at) ? Math.min(e.at, ahora) : ahora,
        indexedAt: instanteValido(e.indexedAt) ? Math.min(e.indexedAt, ahora) : null,
        legacy: e.legacy === true,
      },
    })
  }

  let quedan = entradas
  if (entradas.length > SCOPE_LIMITS.maxScopes) {
    // Los más recientes; a igual `at`, el que estaba antes. Después se devuelven
    // en el orden original, para que normalizar dos veces dé el mismo objeto.
    const elegidos = new Set(
      entradas
        .map((x, i) => ({ i, at: x.value.at }))
        .sort((a, b) => b.at - a.at || a.i - b.i)
        .slice(0, SCOPE_LIMITS.maxScopes)
        .map((x) => x.i)
    )
    quedan = entradas.filter((_, i) => elegidos.has(i))
  }

  const scopes = {}
  for (const { key, value } of quedan) scopes[key] = value
  return { version: CONTEXTS_VERSION, scopes }
}

/**
 * El texto de un ámbito propio de `ctxs`, o '' si no lo hay. La clave tiene que
 * ser un ámbito de verdad: `ctxs` puede venir sin normalizar, y por `JSON.parse`
 * un `__proto__` llega como clave PROPIA. Pura.
 */
function textoPropio(ctxs, key) {
  const s = esObjeto(ctxs) && esObjeto(ctxs.scopes) ? ctxs.scopes : null
  if (!s || !claveValida(key) || !Object.hasOwn(s, key)) return ''
  const t = s[key]?.text
  return typeof t === 'string' && t.trim() ? t : ''
}

/**
 * El contexto que toca a un ámbito: el suyo si lo hay, si no el del `fallback`
 * (`'*'`, lo de todo el sitio), y si no ''. Pura.
 */
export function contextFor(ctxs, key, { fallback = '*' } = {}) {
  return textoPropio(ctxs, key) || textoPropio(ctxs, fallback) || ''
}

/**
 * La CLAVE del ámbito cuyo texto devolvería `contextFor` (`key`, `fallback` o
 * ''): con ella el panel sabe si lo que va al prompt es propio o heredado, y
 * qué cabecera ponerle. Pura.
 */
export function contextScopeFor(ctxs, key, { fallback = '*' } = {}) {
  if (textoPropio(ctxs, key)) return key
  if (textoPropio(ctxs, fallback)) return fallback
  return ''
}

/**
 * Unos contextos NUEVOS con el ámbito `key` puesto o sustituido. No muta.
 *
 * `text` vacío o que no es texto conserva el que hubiera (es lo que hace un
 * indexado con `keepContext`); `indexedAt` sin dar (`undefined`) conserva el de
 * antes, y dado se pone. `at` es ahora y `legacy` deja de serlo: lo ha escrito
 * esta versión. Una clave que no valida devuelve los contextos normalizados
 * sin cambios. Pasa por `normalizeContexts` al final, así que el tope de
 * ámbitos manda también al escribir. Pura.
 */
export function withContext(ctxs, key, { text, indexedAt = undefined, now = Date.now() } = {}) {
  const base = normalizeContexts(ctxs, { now })
  if (!claveValida(key)) return base
  const previo = Object.hasOwn(base.scopes, key) ? base.scopes[key] : null
  const nuevo = typeof text === 'string' && text.trim() ? text : previo?.text || ''
  const entrada = {
    text: nuevo,
    at: now,
    indexedAt: indexedAt === undefined ? previo?.indexedAt ?? null : indexedAt,
    legacy: false,
  }
  const scopes = { ...base.scopes, [key]: entrada }
  const claves = Object.keys(scopes)
  if (claves.length > SCOPE_LIMITS.maxScopes) {
    // Lo recién escrito no lo tira el tope: se cae el más viejo de los DEMÁS.
    // Sin esto, con 40 ámbitos de un `at` igual al de ahora (uno del futuro
    // se trae a ahora al normalizar), el desempate por posición tiraba justo
    // el nuevo, que va el último (revisión adversaria de H21).
    const otras = claves
      .filter((k) => k !== key)
      .map((k, i) => ({ k, i, at: scopes[k].at }))
      .sort((a, b) => b.at - a.at || a.i - b.i)
    for (const { k } of otras.slice(SCOPE_LIMITS.maxScopes - 1)) delete scopes[k]
  }
  return normalizeContexts({ version: CONTEXTS_VERSION, scopes }, { now })
}

/** Unos contextos nuevos sin el ámbito `key`. No muta. Pura. */
export function withoutContext(ctxs, key) {
  const base = normalizeContexts(ctxs)
  const scopes = {}
  for (const k of Object.keys(base.scopes)) if (k !== key) scopes[k] = base.scopes[k]
  return { version: CONTEXTS_VERSION, scopes }
}

/** Orden estable y en español de unas claves de ámbito. */
function ordenadas(claves) {
  return [...claves].sort((a, b) => a.localeCompare(b, 'es'))
}

/** Las claves de ámbito con un mapa construido (`indexedAt` válido), ordenadas. Pura. */
export function scopesWithMap(ctxs) {
  const base = normalizeContexts(ctxs)
  return ordenadas(Object.keys(base.scopes).filter((k) => instanteValido(base.scopes[k].indexedAt)))
}

/** Todas las claves de ámbito, tengan mapa o no, ordenadas. Pura. */
export function scopeKeys(ctxs) {
  return ordenadas(Object.keys(normalizeContexts(ctxs).scopes))
}

/** Las páginas del índice como lista, sin lo que no es una página. */
function paginas(index) {
  const p = esObjeto(index) && esObjeto(index.pages) ? index.pages : null
  return p ? Object.values(p).filter(esObjeto) : []
}

/**
 * Las páginas del índice cuyo `spaceKey` es EXACTAMENTE `spaceKey`. `[]` sin
 * índice o con una clave que no lo es. Pura.
 */
export function pagesOfSpace(index, spaceKey) {
  const k = claveDeEspacio(spaceKey)
  if (!k) return []
  return paginas(index).filter((p) => p.spaceKey === k)
}

/**
 * El índice de UN espacio: una copia superficial con `pages` filtrado a ese
 * espacio (los mismos objetos de página). Espacios, proyectos, incidencias,
 * host, ámbito, versión y fecha, intactos. null sin índice. Pura.
 */
export function subIndex(index, spaceKey) {
  if (!esObjeto(index)) return null
  const k = claveDeEspacio(spaceKey)
  const fuente = esObjeto(index.pages) ? index.pages : {}
  const pages = {}
  if (k) for (const [id, p] of Object.entries(fuente)) if (esObjeto(p) && p.spaceKey === k) pages[id] = p
  return { ...index, pages }
}

/**
 * El índice SIN un espacio: sin sus páginas ni su entrada en `spaces`. Es lo
 * que deja «Olvidar el mapa de X». Copia superficial; null sin índice. Pura.
 */
export function withoutSpace(index, spaceKey) {
  if (!esObjeto(index)) return null
  const k = claveDeEspacio(spaceKey)
  const pages = {}
  for (const [id, p] of Object.entries(esObjeto(index.pages) ? index.pages : {})) {
    if (!(k && esObjeto(p) && p.spaceKey === k)) pages[id] = p
  }
  const spaces = {}
  for (const [key, s] of Object.entries(esObjeto(index.spaces) ? index.spaces : {})) if (!(k && key === k)) spaces[key] = s
  return { ...index, pages, spaces }
}

/**
 * El índice con cada página SIN espacio estampada con `spaceKey`. Lo aplica el
 * panel al árbol leído de la barra lateral antes de fundirlo: la barra es
 * siempre la del espacio de la pestaña, y sin estampar esas páginas entrarían
 * sin espacio y no contarían para su mapa. Una página que ya tiene espacio no
 * se toca. Con una clave que no lo es, devuelve el MISMO objeto. Pura.
 */
export function stampSpace(index, spaceKey) {
  const k = claveDeEspacio(spaceKey)
  if (!k || !esObjeto(index) || !esObjeto(index.pages)) return index
  const pages = {}
  for (const [id, p] of Object.entries(index.pages)) {
    pages[id] = esObjeto(p) && (p.spaceKey === null || p.spaceKey === undefined || p.spaceKey === '') ? { ...p, spaceKey: k } : p
  }
  return { ...index, pages }
}

/**
 * ¿Tiene mapa este ámbito? UN solo criterio, en UN sitio (docs/PLAN2.md §3.4):
 * un `indexedAt` válido en su contexto, que sólo pone construir el mapa. Las
 * páginas del índice NO cuentan, vengan de donde vengan: la revisión adversaria
 * de H21 encontró que lo cosechado de las herramientas (una URL
 * `/spaces/KEY/pages/N` llega CON su espacio) y las filas de la barra lateral
 * (que el panel estampa con el espacio de la pestaña) daban mapa tras el primer
 * turno a un espacio que nadie había construido, y la tarjeta y la línea de
 * «aún no tiene mapa» no salían nunca. `index` se queda en la firma para no
 * tocar a los llamantes, y se ignora. Pura.
 */
export function hasMap(ctxs, index, key) {
  const s = esObjeto(ctxs) && esObjeto(ctxs.scopes) ? ctxs.scopes : null
  return !!(s && claveValida(key) && Object.hasOwn(s, key) && instanteValido(s[key]?.indexedAt))
}

/**
 * Las claves de OTROS espacios con mapa, ordenadas: los ámbitos `space:` de los
 * contextos con `indexedAt` válido, menos `key`. Es lo que alimenta la línea
 * «Este sitio tiene mapa de otros espacios». `index` se queda en la firma y se
 * ignora: desde la revisión adversaria de H21 las páginas no dan mapa. Pura.
 */
export function otherScopesWithMap(ctxs, index, key) {
  return scopesWithMap(ctxs).filter((k) => k.startsWith('space:') && k !== key)
}

/** Cuántas páginas tiene el índice y de cuántos espacios distintos. Pura. */
export function countPages(index) {
  const lista = paginas(index)
  const espacios = new Set()
  for (const p of lista) {
    const k = claveDeEspacio(p.spaceKey)
    if (k) espacios.add(k)
  }
  return { pages: lista.length, spaces: espacios.size }
}

/**
 * ¿Podría CONSTRUIR el mapa de `spaceKey` por la API pasar del tope total?
 * Lo que queda de OTROS espacios más lo que un espacio puede traer
 * (`maxPages`), contra `maxTotal`. Es una PUERTA al construir, no un tope del
 * índice entero: lo que llega por la barra lateral o por las herramientas no
 * pasa por aquí. Se pregunta ANTES de leer nada: al alcanzarse se para con
 * aviso, sin desalojar ningún espacio solo (§3.4, decisión 9).
 *
 * Desde la revisión adversaria de H21 «lo que queda» cuenta SÓLO páginas con
 * un espacio de verdad distinto de éste, porque es lo único que el usuario
 * puede liberar con «Olvidar el mapa de X»: las que no llevan espacio (o una
 * clave que no valida) no las quita ninguno, y contarlas dejaba un «Mapa
 * lleno» sin salida. Y las del propio espacio no cuentan: reconstruirlo no lo
 * hace crecer, lo sustituye. Pura.
 */
export function spaceOverflow(index, spaceKey, { maxPages = INDEX_LIMITS.maxPages, maxTotal = INDEX_LIMITS.maxPagesTotal } = {}) {
  const este = claveDeEspacio(spaceKey)
  let otros = 0
  for (const p of paginas(index)) {
    const k = claveDeEspacio(p.spaceKey)
    if (k && k !== este) otros++
  }
  return otros + maxPages > maxTotal
}

// ---- desde Jira: qué espacio del Confluence enlazado viaja (H22) --------------
//
// POR QUÉ EXISTE. Desde un Jira viaja UN contexto del Confluence enlazado, nunca
// el reparto a partes iguales (cinco resúmenes truncados de páginas que no
// vienen al caso). H21 lo elegía sin saber el proyecto (`linkedContextFor`: el
// de todo el sitio, o el único espacio con contexto; con dos, ninguno), y en el
// Confluence de Marco, con varios espacios, eso era casi siempre «ninguno».
// H22 elige POR PROYECTO, con las reglas de docs/PLAN2.md §3.4 y, delante de
// todas, la elección manual de Ajustes («Este proyecto se documenta en el
// espacio…»): una elección explícita del usuario no la pisa una heurística
// (decisión del orquestador sobre «respaldo»).

/**
 * El mapa proyecto → espacio que guarda `sites[host].linkedSpaces`, con claves
 * blancas: sólo claves PROPIAS (`JSON.parse` trae `__proto__` como propia) que
 * sean clave de proyecto (por `validProjectKey`, así que en mayúsculas) y
 * valores que sean `'*'` (todo el sitio) o una clave de espacio EXACTA. Tope
 * `SCOPE_LIMITS.maxScopes`, por orden de clave (el mismo orden en que sale),
 * así que normalizar dos veces da lo mismo. Si dos claves acaban en la misma
 * mayúscula, gana la que ya lo estaba. Pura, nunca lanza, no muta.
 * @returns {Record<string, string>}
 */
export function normalizeLinkedSpaces(raw) {
  try {
    if (!esObjeto(raw)) return {}
    const elegidos = new Map()
    for (const k of Object.keys(raw)) {
      if (!Object.hasOwn(raw, k)) continue
      const proyecto = validProjectKey(k)
      if (!proyecto) continue
      const v = raw[k]
      const espacio = v === '*' ? '*' : claveDeEspacio(v)
      if (!espacio) continue
      if (elegidos.has(proyecto) && k !== proyecto) continue
      elegidos.set(proyecto, espacio)
    }
    const out = {}
    for (const k of ordenadas([...elegidos.keys()]).slice(0, SCOPE_LIMITS.maxScopes)) out[k] = elegidos.get(k)
    return out
  } catch {
    return {}
  }
}

/**
 * Un mapa NUEVO, normalizado, con el espacio de `projectKey` puesto; un
 * `spaceKey` vacío («automático») o que no vale QUITA la entrada, y un proyecto
 * que no vale devuelve el mapa como estaba. No muta. Pura.
 */
export function withLinkedSpace(map, projectKey, spaceKey) {
  const base = normalizeLinkedSpaces(map)
  const proyecto = validProjectKey(projectKey)
  if (!proyecto) return base
  const out = { ...base }
  const espacio = spaceKey === '*' ? '*' : claveDeEspacio(spaceKey)
  if (espacio) out[proyecto] = espacio
  else delete out[proyecto]
  return normalizeLinkedSpaces(out)
}

/**
 * La clave más repetida de una lista entre las `permitidas`, con los empates
 * decididos por `localeCompare('es')`; '' si ninguna cuenta. Cada elemento es
 * una página citada o usada, así que las repeticiones SON la señal. Pura.
 */
function masRepetida(lista, permitidas) {
  const cuentas = new Map()
  for (const v of Array.isArray(lista) ? lista : []) {
    const k = claveDeEspacio(v)
    if (!k || !permitidas.has(k)) continue
    cuentas.set(k, (cuentas.get(k) || 0) + 1)
  }
  let mejor = ''
  for (const k of ordenadas([...cuentas.keys()])) if (!mejor || cuentas.get(k) > cuentas.get(mejor)) mejor = k
  return mejor
}

/**
 * El espacio del Confluence ENLAZADO cuyo contexto viaja desde un Jira, por
 * proyecto (H22, docs/PLAN2.md §3.4). En este orden:
 *
 * 1. **manual**, lo elegido en Ajustes para este proyecto (`'*'` o una clave de
 *    espacio): si ese ámbito tiene texto propio, ése; si no, el de todo el
 *    sitio si existe; y si tampoco, ninguno. Con `via: 'manual'` en los tres
 *    casos, porque lo eligió el usuario aunque no haya nada que llevar. Un
 *    `manual` sin forma de clave se ignora.
 * 2. **(a)** el espacio más citado por el CONTEXT.md del proyecto (`citadas`:
 *    una clave por página citada con id), `via: 'contexto'`;
 * 3. **(b)** el más usado como página base en análisis de ESE proyecto
 *    (`usadas`), `via: 'historial'`: el historial sólo elige la CLAVE, nunca
 *    aporta texto;
 * 4. **(c)** el ÚNICO espacio con contexto, `via: 'unico'`;
 * 5. el de todo el sitio (`'*'`), `via: 'heredado'`;
 * 6. y si no, ninguno: `{ key: '', text: '', via: '' }`.
 *
 * En (a) y (b) sólo cuentan las claves que el enlazado TIENE con contexto: la
 * clave sale SIEMPRE de los contextos, nunca de lo que se le pase (ni la
 * elección manual ni una lista pueden meter una clave que no existe). `key` es
 * una clave de ÁMBITO (`space:KEY`, `'*'` o ''), la que el prompt usa para decir
 * de qué espacio es; `otras` son las claves de los DEMÁS espacios con contexto,
 * SIN el «space:» delante (como las lee `linkedScopesLine` de prompts.js y como
 * deja el panel las del propio sitio), ordenadas, SIEMPRE, también con `key`
 * `'*'` o ''. Pura, determinista, nunca lanza.
 * @returns {{key: string, text: string, via: string, otras: string[]}}
 */
export function linkedSpacesFor(ctxsEnlazado, opciones = {}) {
  try {
    const { manual = '', citadas = [], usadas = [] } = esObjeto(opciones) ? opciones : {}
    const base = normalizeContexts(ctxsEnlazado)
    const espacios = ordenadas(
      Object.keys(base.scopes)
        .filter((k) => k.startsWith('space:'))
        .map((k) => k.slice('space:'.length))
    )
    const conTexto = new Set(espacios)
    const texto = (key) => (key && Object.hasOwn(base.scopes, key) ? base.scopes[key].text : '')
    const hayTodo = Object.hasOwn(base.scopes, '*')
    const salida = (key, via) => ({
      key,
      text: texto(key),
      via,
      otras: espacios.filter((k) => 'space:' + k !== key),
    })

    const elegido = manual === '*' ? '*' : claveDeEspacio(manual)
    if (elegido) {
      if (elegido === '*') return salida(hayTodo ? '*' : '', 'manual')
      if (conTexto.has(elegido)) return salida('space:' + elegido, 'manual')
      return salida(hayTodo ? '*' : '', 'manual')
    }
    const citado = masRepetida(citadas, conTexto)
    if (citado) return salida('space:' + citado, 'contexto')
    const usado = masRepetida(usadas, conTexto)
    if (usado) return salida('space:' + usado, 'historial')
    if (espacios.length === 1) return salida('space:' + espacios[0], 'unico')
    if (hayTodo) return salida('*', 'heredado')
    return salida('', '')
  } catch {
    return { key: '', text: '', via: '', otras: [] }
  }
}
