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
 * CUENTA (`hasMap`), pero nunca se parte.
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
        at: instanteValido(e.at) ? e.at : ahora,
        indexedAt: instanteValido(e.indexedAt) ? e.indexedAt : null,
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
  return normalizeContexts({ version: CONTEXTS_VERSION, scopes: { ...base.scopes, [key]: entrada } }, { now })
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
 * ¿Tiene mapa este ámbito? UN solo criterio, en UN sitio: un `indexedAt`
 * válido en su contexto, o —sólo para un espacio— páginas de ese espacio en el
 * índice (el mapa lo da el árbol de la API, que siempre trae espacio; lo que
 * se cosecha de las herramientas entra sin espacio y no cuenta). Pura.
 */
export function hasMap(ctxs, index, key) {
  const s = esObjeto(ctxs) && esObjeto(ctxs.scopes) ? ctxs.scopes : null
  if (s && claveValida(key) && Object.hasOwn(s, key) && instanteValido(s[key]?.indexedAt)) return true
  if (typeof key === 'string' && key.startsWith('space:') && claveValida(key)) {
    return pagesOfSpace(index, key.slice('space:'.length)).length > 0
  }
  return false
}

/**
 * Las claves de OTROS espacios con mapa, ordenadas: los ámbitos `space:` de los
 * contextos y los espacios con páginas en el índice, menos `key`. Es lo que
 * alimenta la línea «Este sitio tiene mapa de otros espacios». Pura.
 */
export function otherScopesWithMap(ctxs, index, key) {
  const candidatas = new Set(scopeKeys(ctxs).filter((k) => k.startsWith('space:')))
  for (const p of paginas(index)) {
    const k = claveDeEspacio(p.spaceKey)
    if (k) candidatas.add('space:' + k)
  }
  return ordenadas([...candidatas].filter((k) => k !== key && hasMap(ctxs, index, k)))
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
 * ¿Podría indexar `spaceKey` por la API pasar del tope TOTAL de páginas del
 * host? Lo que queda sin ese espacio más lo que un espacio puede traer
 * (`maxPages`), contra `maxTotal`. Se pregunta ANTES de leer nada: al
 * alcanzarse se para con aviso, sin desalojar ningún espacio solo (§3.4,
 * decisión 9). Pura.
 */
export function spaceOverflow(index, spaceKey, { maxPages = INDEX_LIMITS.maxPages, maxTotal = INDEX_LIMITS.maxPagesTotal } = {}) {
  return countPages(index).pages - pagesOfSpace(index, spaceKey).length + maxPages > maxTotal
}

/**
 * El contexto del Confluence ENLAZADO que viaja desde un Jira: el de todo el
 * sitio (`'*'`) si existe; si no, el ÚNICO espacio con texto si sólo hay uno
 * (regla (c) de docs/PLAN2.md §3.4, la única que no necesita saber el
 * proyecto); si no, nada. Nunca el reparto a partes iguales: con dos espacios
 * no se elige ninguno. H22 lo sustituye por `linkedSpacesFor`, que elige con
 * el ámbito del proyecto (las reglas (a) y (b) y el selector de Ajustes). Pura.
 * @returns {{key: string, text: string}}
 */
export function linkedContextFor(ctxs) {
  const base = normalizeContexts(ctxs)
  if (Object.hasOwn(base.scopes, '*')) return { key: '*', text: base.scopes['*'].text }
  const espacios = Object.keys(base.scopes).filter((k) => k.startsWith('space:'))
  if (espacios.length === 1) return { key: espacios[0], text: base.scopes[espacios[0]].text }
  return { key: '', text: '' }
}
