/**
 * Lo que la API REST del propio Jira contesta exacto y en milisegundos. Puro
 * (el `fetch` se inyecta; sin DOM).
 *
 * POR QUÉ EXISTE: en Confluence, leer la cadena de padres de la API sustituyó un
 * turno de modelo de minutos por una petición de milisegundos
 * (confluence-rest.js). En Jira todo lo que es «buscar» seguía pasando por el
 * modelo y por `jira_search` del MCP, cuya salida se queda en la sesión y se
 * reenvía en cada turno (CLAUDE.md §7). Esto es el mismo patrón para Jira, y
 * UNO para las tres áreas que lo necesitan: la lista de una búsqueda (H8), la
 * muestra y el perfil de un proyecto (H9), los enlaces remotos de una incidencia
 * (H10) y lo que viste y lo tuyo (H11). Decisión §8.19 de CLAUDE.md.
 *
 * DE DÓNDE PUEDE VENIR UNA CONSULTA (y de ningún otro sitio, CLAUDE.md §8.12):
 *  1. De una PLANTILLA FIJA de este módulo (`historyJql`, `mineJql`,
 *     `projectJql`, `relatedJql`, `sampleQuery`), cuyos únicos parámetros son
 *     una clave que pasa `validProjectKey`/`validIssueKey` y un número de días
 *     entero dentro de tope. Lo que no valida devuelve null, y sin consulta no
 *     hay petición.
 *  2. De la llamada REAL que el modelo ya hizo a `jira_search` por el MCP (el
 *     `state.input.jql` que `jqlDestination` lee hoy), nunca de su prosa.
 *  3. De un chip construido aquí con valores escapados por `jqlQuote`, o de un
 *     filtro guardado por el propio usuario en su Jira.
 * Un título leído del DOM no se convierte nunca en consulta.
 *
 * LO QUE ESTE MÓDULO GARANTIZA, no quien lo llama:
 *  - Sólo GET, mismo origen, con la sesión del navegador, por el único `getJson`
 *    de rest-get.js; `maxResults` acotado, campos de LISTA BLANCA, tope de
 *    tiempo. La extensión no toca ninguna credencial.
 *  - La consulta viaja como PARÁMETRO codificado de una ruta que se monta aquí:
 *    una línea, sin caracteres de control, con tope (`cleanJql`).
 *  - Lo que vuelve se reconstruye con claves blancas: claves de incidencia
 *    validadas, textos de una línea acotados, fechas a milisegundos o 0, listas
 *    sin repetir y con tope. Nada se pinta ni se guarda tal cual.
 *  - En Jira CLOUD no se pide NADA: `GET /rest/api/2/search` está retirado allí
 *    (410 desde octubre de 2025) y el sustituto es otro. La comprobación está en
 *    UN solo sitio (`sinRestDeJira`) y la usan los tres lectores.
 *
 * DOS DEGRADACIONES, una vez cada una (`searchIssues`), porque la referencia de
 * Jira DC que se pudo leer llegaba truncada en los dos puntos
 * (docs/plan/anexo-A, «APIs externas»):
 *  - un 400 a una consulta que menciona `lastViewed` se reintenta sin ese
 *    `ORDER BY` y sin pedir el campo. Lo decide NUESTRA consulta, no el texto
 *    del servidor: ese texto es dato, viene en el idioma de la instancia y sirve
 *    para explicárselo al usuario, no para decidir.
 *  - un 404 con ruta de contexto se reintenta sin ella, por si `jiraContextPath`
 *    la dedujo de una URL que no la llevaba.
 *
 * QUÉ NO SALE DE AQUÍ A UN PROMPT: `assignee`/`reporter` son los únicos datos de
 * persona que se leen (hacen falta para «asignada a ti»), y `profileFromSample`
 * —lo único de este módulo que acaba delimitado en un `system`— no los mira
 * siquiera.
 *
 * LOS NOMBRES NO SIRVEN PARA PREGUNTAR, LOS IDS SÍ (H14, comprobado en el Jira
 * Data Center real del usuario, con la interfaz en español): Jira TRADUCE al
 * idioma de cada usuario los nombres que trae de serie y los devuelve traducidos
 * tanto en el DOM como en la API —«Task» es «Tarea», «Story» «Historia», «In
 * Progress» «En progreso», «Critical» «Crítica»—, pero JQL **no acepta los
 * traducidos**: `issuetype = "Tarea"` contesta 400 («El valor 'Tarea' no existe
 * para el campo 'issuetype'.») mientras `issuetype = Task` devuelve 2 336, y
 * `status = "En progreso"` igual. Por id funciona SIEMPRE (`issuetype = 10002`).
 * Los nombres a medida (los que puso el equipo: «L0 Requirement», «For PSO
 * Review») no se traducen y sí valen por nombre. Por eso cada fila trae además
 * `typeId`, `statusId` y `priorityId`, el perfil guarda el id de cada tipo y de
 * cada estado, y los chips preguntan por id cuando lo conocen: un nombre
 * traducido no daba cero resultados, daba un error.
 */

import { getJson, nowMs } from './rest-get.js'
import { jiraContextPath, validIssueKey, validProjectKey } from '../atlassian/site.js'

/**
 * Los topes de TODA lectura REST de Jira, en un solo objeto: los tres hitos que
 * lo usan comparten estos números en vez de traer cada uno los suyos.
 */
export const JIRA_REST_LIMITS = {
  /** Resultados que se piden si nadie dice otra cosa, y tope de lo que se acepta. */
  defaultResults: 10,
  maxResults: 30,
  timeoutMs: 6000,
  /** Un valor dentro de un literal de la consulta (un componente, un sprint). */
  quoteMax: 120,
  /** Ventana en días de las plantillas: «los últimos N días». */
  daysMax: 30,
  /** Textos de lo que vuelve. */
  summaryChars: 200,
  fieldChars: 60,
  titleChars: 200,
  urlChars: 500,
  /** Listas de una incidencia (etiquetas, componentes). */
  listMax: 10,
  /** Filtros favoritos y enlaces remotos que se aceptan de una respuesta. */
  filters: 20,
  links: 20,
  /** Búsquedas sugeridas que se ofrecen como mucho. */
  suggestions: 8,
  /**
   * Las últimas consultas ejecutadas que se recuerdan por sitio. Cinco: son
   * chips en el chat vacío, no un historial; con más, las de hace una semana
   * empujarían fuera a las sugeridas de la pantalla de ahora.
   */
  recentJql: 5,
  /** El perfil del proyecto: listas, patrones de nombre y ejemplos por patrón. */
  profileList: 30,
  profilePrefixes: 6,
  profileExamples: 3,
  profileSummaryChars: 120,
  /**
   * Cuántos proyectos con perfil se guardan por host (H22). Veinte: un perfil
   * pesa unos pocos KB y quien trabaja en un Jira toca un puñado de proyectos;
   * al pasarse se conservan los contados más recientemente.
   */
  profileProjects: 20,
}

/**
 * Lo que se acepta de una consulta JQL antes de meterla en una URL. Vivía en
 * planner.js (que ahora la reexporta para no cambiarle los imports a nadie):
 * vive aquí, con el módulo que ejecuta la consulta.
 */
export const JQL_LIMITS = {
  /** Una consulta escrita a mano rara vez pasa de doscientos caracteres; dos mil ya es un volcado. */
  maxChars: 2000,
}

/**
 * Versión del perfil guardado: si cambia la forma, lo viejo se descarta.
 *
 * 2 desde H14: cada tipo y cada estado llevan su `id`, que es lo único que una
 * consulta JQL acepta cuando el nombre viene traducido (mira la cabecera). Un
 * perfil de la versión 1 no tiene esos ids y con él el modelo escribiría un
 * `status = "En progreso"` que es un 400, así que `normalizeProfile` lo descarta
 * y se vuelve a contar: es una petición con la sesión del navegador, no un turno
 * de modelo.
 */
export const PROFILE_VERSION = 2

/**
 * Versión del CONTENEDOR de perfiles de un host (H22): `{ version, byProject }`,
 * un perfil (de la versión `PROFILE_VERSION`) por proyecto. Hasta H22 la clave
 * `faro:profile:<host>` guardaba UN perfil suelto, y alternar entre dos
 * proyectos del mismo Jira volvía a contar la muestra en cada salto; ese perfil
 * suelto migra al leerlo, bajo su `projectKey` (`normalizeProfiles`).
 */
export const PROFILES_VERSION = 1

/**
 * Los campos que se pueden pedir. Lista blanca: un nombre que no esté aquí se
 * ignora, así que ni un mensaje ni un hito futuro pueden pedir «todo»
 * (`fields=*all` arrastra el cuerpo entero de cada incidencia).
 */
export const JIRA_FIELDS = [
  'summary',
  'issuetype',
  'status',
  'priority',
  'resolution',
  'updated',
  'created',
  'lastViewed',
  'assignee',
  'reporter',
  'labels',
  'components',
  'parent',
]

/** Lo que se pide de una búsqueda normal: lo que la lista y el ranking necesitan. */
export const SEARCH_FIELDS = [
  'summary',
  'issuetype',
  'status',
  'priority',
  'updated',
  'lastViewed',
  'assignee',
  'reporter',
  'labels',
  'components',
]

/**
 * Lo que se pide de la MUESTRA de un proyecto. Sin `assignee`, `reporter` ni
 * `lastViewed`: el perfil no lleva personas, así que tampoco se traen.
 */
export const SAMPLE_FIELDS = ['summary', 'issuetype', 'status', 'priority', 'labels', 'components']

/** Las categorías de estado que Jira define; cualquier otra cosa no es una categoría. */
const STATUS_CATEGORIES = ['new', 'indeterminate', 'done', 'undefined']

// Los controles C0, el DEL y los C1 (U+0080-U+009F). Los C1 entran por el NEL
// (U+0085), que abre línea y que el `\s` de JavaScript NO cubre: sin él, una
// consulta con un NEL dentro seguía siendo «dos líneas» en el Registro después de
// pasar por `cleanJql` (revisión adversaria de H7). U+2028 y U+2029 sí los colapsa `\s`.
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')
const DIGITS = /^\d+$/
/**
 * Un id de valor de campo (el de un tipo, un estado o una prioridad). Los de Jira
 * son números cortos —de una a cinco cifras: «1», «3», «10002»—; el tope está
 * para que de aquí no salga nunca algo que no quepa en una consulta.
 */
const FIELD_ID = /^\d{1,19}$/
/**
 * El `pageId` con el que un enlace remoto señala una página de Confluence: en el
 * `globalId` («appId=9a1b&pageId=98830281», y también un «pageId=…» a secas) o
 * dentro de la URL del objeto («?pageId=…», «/pages/98830281/Título»). El
 * carácter de delante tiene que ser un separador o el principio, para que un
 * `otherpageId=5` no cuele.
 */
const PAGE_ID = /(?:^|[?&#])pageId=(\d{1,19})\b|\/pages\/(\d{1,19})(?:\/|$)/i

// ------------------------------------------------------------------ limpieza

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** Texto de una línea, sin controles ni espacios de más, con tope. */
function linea(v, max) {
  return str(v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Una consulta en una línea, sin caracteres de control y con tope. Pura.
 *
 * Es lo mínimo que hace falta para que una consulta quepa en una URL y en una
 * línea del Registro: un salto de línea dentro fingiría otra fila.
 */
export function cleanJql(value) {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, JQL_LIMITS.maxChars)
}

/**
 * Un valor dentro de un literal de la consulta, ya entrecomillado. Pura.
 *
 * Devuelve las comillas puestas a propósito: quien construye un chip no puede
 * olvidarlas. Dentro se escapan la barra y la comilla —en ese orden, o la barra
 * de escape se escaparía a sí misma— y se quitan los controles, así que un
 * componente llamado `API" OR project = OTRO` no cierra el literal.
 */
export function jqlQuote(value) {
  const limpio = linea(value, JIRA_REST_LIMITS.quoteMax)
  return '"' + limpio.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** El tope de resultados ya validado: un `Number('5&x')` es NaN, y en la URL sería `maxResults=NaN`. Pura. */
export function clampResults(limit) {
  const n = Number(limit)
  return Number.isInteger(n) && n >= 1 && n <= JIRA_REST_LIMITS.maxResults ? n : JIRA_REST_LIMITS.defaultResults
}

/** Los campos pedidos que están en la lista blanca, sin repetir; si no queda ninguno, los de siempre. */
function fieldsFor(fields) {
  const lista = (Array.isArray(fields) ? fields : []).map((f) => str(f)).filter((f) => JIRA_FIELDS.includes(f))
  const unicos = [...new Set(lista)]
  return unicos.length ? unicos : SEARCH_FIELDS
}

/**
 * La ruta de contexto, re-validada en la puerta.
 *
 * Quien la manda es el content script (que la deduce con `jiraContextPath` de
 * la URL de SU pestaña), pero llega por mensaje: aquí se comprueba otra vez con
 * la MISMA función —la de una ruta de Jira colgada de ella—, para que las dos
 * no puedan divergir.
 */
function cleanPrefix(prefix) {
  const p = str(prefix).replace(/\/+$/, '')
  if (!p) return ''
  return jiraContextPath(p + '/browse/')
}

/** Los días de una ventana: entero, de 1 a `daysMax`. 0 si no. */
function cleanDays(days) {
  const n = Number(days)
  return Number.isInteger(n) && n >= 1 && n <= JIRA_REST_LIMITS.daysMax ? n : 0
}

// -------------------------------------------------- plantillas fijas de JQL

/** Lo que has mirado en Jira, lo último primero. Pura. */
export function historyJql() {
  return 'issuekey in issueHistory() ORDER BY lastViewed DESC'
}

/**
 * Lo tuyo movido en los últimos días: asignado a ti, informado por ti o que
 * sigues. `watchedIssues()` en vez de `watcher = currentUser()` porque el campo
 * `watcher` no está en la referencia de campos de Data Center y la función sí
 * (docs/plan/anexo-A, «APIs externas»). Pura.
 */
export function mineJql(days) {
  const d = cleanDays(days)
  if (!d) return null
  return `(assignee = currentUser() OR reporter = currentUser() OR issuekey in watchedIssues()) AND updated >= -${d}d ORDER BY updated DESC`
}

/** Lo que se ha movido en un proyecto en los últimos días. Pura. */
export function projectJql(projectKey, days) {
  const key = validProjectKey(projectKey)
  const d = cleanDays(days)
  if (!key || !d) return null
  return `project = ${key} AND updated >= -${d}d ORDER BY updated DESC`
}

/**
 * Lo enlazado con una incidencia. Sin el segundo argumento de `linkedIssues`
 * (el tipo de enlace): sus nombres los pone cada instancia. Pura.
 */
export function relatedJql(issueKey) {
  const key = validIssueKey(issueKey)
  return key ? `issue in linkedIssues(${key})` : null
}

/** La muestra de un proyecto con la que se cuenta su perfil. Pura. */
export function sampleQuery(projectKey) {
  const key = validProjectKey(projectKey)
  return key ? `project = ${key} ORDER BY updated DESC` : null
}

/**
 * La misma consulta sin ordenar por `lastViewed`. Pura.
 *
 * `ORDER BY lastViewed DESC` no se pudo leer literalmente en la referencia de
 * Data Center: si esa instancia no lo acepta, esto es lo que se reintenta. Si no
 * había tal cláusula, la consulta vuelve tal cual (y entonces no se reintenta).
 */
export function withoutLastViewedOrder(jql) {
  const q = cleanJql(jql)
  const sinOrden = q.replace(/\s*ORDER\s+BY\s+lastViewed(?:\s+(?:ASC|DESC))?\s*$/i, '')
  if (sinOrden === q) return q
  return (sinOrden + ' ORDER BY updated DESC').trim()
}

/** ¿La consulta menciona `lastViewed`? Es lo que decide si merece un reintento. */
function mencionaLastViewed(jql) {
  return /lastviewed/i.test(String(jql || ''))
}

// ------------------------------------------------------------------- rutas

/**
 * La ruta de una búsqueda: la consulta como parámetro codificado, campos de
 * lista blanca y tope acotado. Pura.
 *
 * @param {{jiraPrefix?:string, cloud?:boolean}} site
 * @returns {string|null} null si no queda consulta
 */
export function searchPath(site, jql, { limit, fields, prefix } = {}) {
  const consulta = cleanJql(jql)
  if (!consulta) return null
  const p = cleanPrefix(prefix ?? site?.jiraPrefix)
  return (
    `${p}/rest/api/2/search?jql=${encodeURIComponent(consulta)}` +
    `&fields=${fieldsFor(fields).join(',')}&maxResults=${clampResults(limit)}`
  )
}

/** La ruta de los filtros favoritos del propio usuario. Pura. */
export function favouriteFiltersPath(prefix) {
  return `${cleanPrefix(prefix)}/rest/api/2/filter/favourite`
}

/** La ruta de los enlaces remotos de una incidencia. Pura; null sin clave válida. */
export function remoteLinksPath(issueKey, prefix) {
  const key = validIssueKey(issueKey)
  if (!key) return null
  return `${cleanPrefix(prefix)}/rest/api/2/issue/${encodeURIComponent(key)}/remotelink`
}

// ------------------------------------------------------------------ parseo

function nombre(node) {
  if (typeof node === 'string') return linea(node, JIRA_REST_LIMITS.fieldChars)
  return linea(node?.name, JIRA_REST_LIMITS.fieldChars)
}

/**
 * El id de un valor de campo: sólo dígitos, o ''. Pura.
 *
 * SEGURIDAD: un id acaba SIN COMILLAS dentro de una JQL (`status = 10045`), así
 * que pasa por aquí en los TRES sitios por los que puede entrar: al leerlo de la
 * API (`parseSearchIssues`), al leerlo del almacén (`normalizeProfile`) y al
 * escribirlo en la consulta (`porIdONombre`, que es el único que lo mete en una).
 * Un id que no es un número —o una instancia que devuelva ahí cualquier otra
 * cosa— se queda en '' y entonces se pregunta por el nombre entrecomillado, que
 * es lo que se hacía antes de H14.
 */
function fieldId(v) {
  const id = String(v ?? '').trim()
  return FIELD_ID.test(id) ? id : ''
}

/** La categoría de un estado, de la lista que Jira define. '' si es otra cosa. */
function categoria(node) {
  const k = linea(node?.key, JIRA_REST_LIMITS.fieldChars).toLowerCase()
  return STATUS_CATEGORIES.includes(k) ? k : ''
}

/**
 * Una persona, con lo justo para decir «asignada a ti»: el nombre de cuenta
 * (que es lo que se compara con `currentUser()`) y el visible. Nada de correo,
 * avatar ni id: no hacen falta y no se guardan.
 */
function persona(node) {
  if (!node || typeof node !== 'object') return null
  const name = linea(node.name ?? node.accountId, JIRA_REST_LIMITS.fieldChars)
  const displayName = linea(node.displayName, JIRA_REST_LIMITS.fieldChars)
  return name || displayName ? { name, displayName } : null
}

/** Una fecha de Jira a milisegundos, o 0: lo que no se entiende no se inventa. */
function instante(v) {
  const t = Date.parse(str(v))
  return Number.isFinite(t) ? t : 0
}

/** Una lista de etiquetas o de componentes: textos de una línea, sin repetir, con tope. */
function lista(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const item of v) {
    if (out.length >= JIRA_REST_LIMITS.listMax) break
    const n = nombre(item)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * De la respuesta de `/rest/api/2/search` a las incidencias, con claves blancas.
 * Pura.
 *
 * Los campos son la UNIÓN de lo que piden las tres áreas, y ninguno entra sin
 * pasar por su limpiador: la clave por `validIssueKey` (una `key` con un salto
 * de línea o con `javascript:` no es una clave), los textos a una línea
 * acotada, las fechas a número, las listas sin repetir.
 *
 * @returns {Array<object>|null} null si la respuesta no tiene la forma esperada
 */
export function parseSearchIssues(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.issues)) return null
  const out = []
  const vistas = new Set()
  for (const raw of json.issues) {
    if (out.length >= JIRA_REST_LIMITS.maxResults) break
    if (!raw || typeof raw !== 'object') continue
    const key = validIssueKey(raw.key)
    if (!key || vistas.has(key)) continue
    vistas.add(key)
    const f = raw.fields && typeof raw.fields === 'object' ? raw.fields : {}
    out.push({
      key,
      summary: linea(f.summary, JIRA_REST_LIMITS.summaryChars),
      // El nombre es lo que se ENSEÑA (y viene traducido al idioma del usuario);
      // el id es lo único con lo que se puede volver a PREGUNTAR por ese valor en
      // una JQL. Los dos, y cada uno para lo suyo (mira la cabecera).
      type: nombre(f.issuetype),
      typeId: fieldId(f.issuetype?.id),
      status: nombre(f.status),
      statusId: fieldId(f.status?.id),
      statusCategory: categoria(f.status?.statusCategory),
      priority: nombre(f.priority),
      // Nadie ofrece hoy un chip por prioridad: el id está porque la prioridad se
      // traduce igual («Critical» es «Crítica») y sin él no se podría preguntar.
      priorityId: fieldId(f.priority?.id),
      assignee: persona(f.assignee),
      reporter: persona(f.reporter),
      updatedAt: instante(f.updated),
      lastViewedAt: instante(f.lastViewed),
      labels: lista(f.labels),
      components: lista(f.components),
      // La épica no es un campo de serie en Data Center (es un campo
      // personalizado con id distinto en cada instancia): se lee si la
      // respuesta la trae, y si no, el chip «Misma épica» no se ofrece.
      epicKey: validIssueKey(f.epic?.key),
      parentKey: validIssueKey(f.parent?.key),
    })
  }
  return out
}

/** De la respuesta de `/filter/favourite` a los filtros del usuario, con claves blancas. Pura. */
export function parseFilters(json) {
  if (!Array.isArray(json)) return null
  const out = []
  const vistos = new Set()
  for (const raw of json) {
    if (out.length >= JIRA_REST_LIMITS.filters) break
    if (!raw || typeof raw !== 'object') continue
    // El id de un filtro viaja como cadena en la API v2, pero alguna instancia
    // lo devuelve como número: cuenta igual mientras sea un id.
    const id = String(raw.id ?? '').trim()
    const name = linea(raw.name, JIRA_REST_LIMITS.titleChars)
    const jql = cleanJql(raw.jql)
    if (!DIGITS.test(id) || !name || !jql || vistos.has(id)) continue
    vistos.add(id)
    out.push({ id, name, jql })
  }
  return out
}

/**
 * Un título que no nombra la página, sino la CLASE de cosa que es. Pura.
 *
 * Pasó de verdad (Jira Data Center del usuario, 2026-09-21): en los quince
 * enlaces remotos a Confluence que se vieron, `object.title` era literalmente
 * «Page» —el nombre del tipo de enlace, que es lo que Jira pone cuando la
 * aplicación remota no le da un título—, mientras el DOM del módulo de enlaces
 * sí traía el de verdad. Aceptarlo como título hacía que cinco sugerencias se
 * llamaran «Page» y que la página base se añadiera con ese nombre, porque «Page»
 * no es un marcador «Página N» y el camino que lee el título de verdad no
 * saltaba.
 *
 * La lista es CORTA a propósito, y no se alarga sin haber visto el caso: cada
 * palabra que entre aquí es un título de verdad que alguien pierde. Lo que se
 * compara es el texto en una línea, sin mayúsculas y sin espacios de más; «Page
 * One», «Homepage» o «Página de bienvenida» son títulos.
 *
 * Vive en este módulo, y no junto a `isPlaceholderTitle` de index-store.js,
 * porque de aquí sale el dato: jira-rest.js ya lo carga el content script, y
 * arrastrar index-store.js (12 KB) a su cierre por una lista de cuatro palabras
 * sería la regresión que la revisión de H11 arregló con page-id.js.
 */
export function isGenericTitle(title) {
  return TITULOS_GENERICOS.has(linea(title, JIRA_REST_LIMITS.titleChars).toLowerCase())
}

const TITULOS_GENERICOS = new Set(['', 'page', 'wiki page', 'pagina', 'página'])

/**
 * De la respuesta de `/issue/KEY/remotelink` a los enlaces a páginas de
 * Confluence. Pura.
 *
 * Sólo cuentan los que llevan un `pageId` numérico —en el `globalId`
 * (`appId=…&pageId=98830281`) o en la URL del objeto—, porque el id es lo único
 * con lo que se puede resolver una página sin mandar su título a ninguna API
 * (CLAUDE.md §8.12). Con `hosts` se exige además que la URL sea del sitio propio
 * o del Confluence enlazado: un enlace remoto puede apuntar a cualquier parte.
 * Un título genérico (`isGenericTitle`) llega como '': el enlace vale por su id
 * y el título lo busca el panel donde sí está.
 *
 * VERIFICADO en el Jira Data Center del usuario (2026-09-21): 6 de 30
 * incidencias muestreadas tienen enlaces remotos y la forma es exactamente ésta
 * —`globalId` = `appId=<uuid>&pageId=<n>`, `application.type` =
 * «com.atlassian.confluence», `relationship` = «mentioned in», `object.url` =
 * `…/pages/viewpage.action?pageId=<n>`—; los acepta todos, también con `hosts`.
 */
export function parseRemoteLinks(json, { hosts = [] } = {}) {
  if (!Array.isArray(json)) return null
  const permitidos = (Array.isArray(hosts) ? hosts : []).map((h) => str(h).toLowerCase()).filter(Boolean)
  const out = []
  const vistos = new Set()
  for (const raw of json) {
    if (out.length >= JIRA_REST_LIMITS.links) break
    if (!raw || typeof raw !== 'object') continue
    const tipo = linea(raw.application?.type, JIRA_REST_LIMITS.fieldChars).toLowerCase()
    const url = enlace(raw.object?.url)
    const pageId = idDePagina(raw.globalId) || idDePagina(raw.object?.url)
    if (!pageId) continue
    if (tipo && tipo !== 'com.atlassian.confluence') continue
    if (permitidos.length && !permitidos.includes(hostDe(url))) continue
    if (vistos.has(pageId)) continue
    vistos.add(pageId)
    const title = linea(raw.object?.title, JIRA_REST_LIMITS.titleChars)
    out.push({ pageId, title: isGenericTitle(title) ? '' : title, url })
  }
  return out
}

function idDePagina(v) {
  const m = PAGE_ID.exec(str(v))
  return m ? m[1] || m[2] : ''
}

/** Una URL http(s) acotada, o '': lo que no lo sea no se enseña como enlace. */
function enlace(v) {
  const u = str(v).replace(CONTROL, '')
  return /^https?:\/\//i.test(u) ? u.slice(0, JIRA_REST_LIMITS.urlChars) : ''
}

function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------- fetch

/**
 * En Jira Cloud no hay REST de Jira que leer. `GET /rest/api/2/search` está
 * retirado (410 desde octubre de 2025) y el sustituto es otro endpoint con otro
 * cuerpo: allí todo sigue yendo por el MCP. La comprobación está SÓLO aquí, y
 * la usan los tres lectores de este módulo.
 */
function sinRestDeJira(site) {
  if (!site?.cloud) return null
  return { ok: false, reason: 'cloud', detail: 'Jira Cloud retiró GET /rest/api/2/search: en Cloud todo va por el MCP' }
}

/** El origen del sitio, o null si no tiene forma de origen. */
function origenDe(site) {
  const base = String(site?.origin || '').replace(/\/+$/, '')
  return /^https?:\/\/[^/@]+$/i.test(base) ? base : null
}

/** De un fallo de `getJson` al motivo con el que el panel decide qué decir. */
function razonDe(r) {
  if (r.status === 401 || r.status === 403) return 'sesion'
  if (r.status === 400) return 'jql'
  if (r.status === 404) return 'ruta'
  if (!r.status) return 'red'
  return 'api'
}

function fallo(r, extra = {}) {
  return { ok: false, reason: razonDe(r), detail: r.reason, status: r.status, messages: r.errors || [], ...extra }
}

/**
 * Las incidencias de una consulta, contra el Jira en el que está el usuario.
 *
 * @param {Function} fetchFn `fetch` del contexto que llama
 * @param {{origin:string, jiraPrefix?:string, cloud?:boolean}} site
 * @param {string} jql de una plantilla de este módulo, de la llamada real del
 *        MCP, de un chip con valores escapados o de un filtro del propio sitio
 * @returns {Promise<{ok:true, issues:Array, total:number, via:'jql'|'updated', prefix:string, ms:number}
 *          |{ok:false, reason:string, detail?:string, status?:number, messages?:string[]}>}
 */
export async function searchIssues(
  fetchFn,
  site,
  jql,
  { limit, fields, prefix, timeoutMs = JIRA_REST_LIMITS.timeoutMs, credentials = 'same-origin' } = {}
) {
  const t0 = nowMs()
  const enCloud = sinRestDeJira(site)
  if (enCloud) return enCloud
  const base = origenDe(site)
  if (!base) return { ok: false, reason: 'origen', detail: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin-fetch', detail: 'sin fetch' }
  if (!cleanJql(jql)) return { ok: false, reason: 'jql', detail: 'consulta vacía', messages: [] }

  const opts = { timeoutMs, credentials, base, errorBody: true }
  let consulta = cleanJql(jql)
  let campos = fields
  let prefijo = cleanPrefix(prefix ?? site?.jiraPrefix)
  let via = 'jql'
  // Una sola degradación por motivo. La de `lastViewed` necesita bandera propia
  // porque una consulta puede nombrarlo también fuera del `ORDER BY` («lastViewed
  // > -1d ORDER BY lastViewed DESC»): sin ella, quitar el orden no cambiaría que
  // lo menciona y se repetiría la MISMA petición. La del prefijo no la necesita:
  // el reintento lo deja en '', y con prefijo vacío no hay nada que quitar.
  let sinLastViewed = false

  // Como mucho tres peticiones: la buena y una por degradación.
  for (let intento = 0; intento < 3; intento++) {
    const ruta = searchPath(site, consulta, { limit, fields: campos, prefix: prefijo })
    if (!ruta) return { ok: false, reason: 'ruta', detail: 'no se pudo montar la consulta' }
    const r = await getJson(fetchFn, base + ruta, opts)
    if (r.ok) {
      const issues = parseSearchIssues(r.json)
      if (!issues) {
        return { ok: false, reason: 'forma', detail: 'la respuesta de la API no tiene la forma esperada', status: r.status }
      }
      const total = Number.isInteger(r.json?.total) && r.json.total >= 0 ? r.json.total : issues.length
      return { ok: true, issues, total, via, prefix: prefijo, ms: Math.round(nowMs() - t0) }
    }
    // Esta instancia no acepta `lastViewed`: se reintenta sin ordenar por él y
    // sin pedirlo como campo, que es la otra forma de que lo rechace.
    if (r.status === 400 && !sinLastViewed && mencionaLastViewed(consulta)) {
      const otra = withoutLastViewedOrder(consulta)
      sinLastViewed = true
      via = 'updated'
      consulta = otra
      // Se quita de los campos pedidos, y si con eso no queda ninguno se cae en
      // los de siempre SIN él: `fieldsFor([])` devolvería la lista entera, que
      // lo lleva, y el reintento pediría justo lo que la instancia rechaza.
      campos = fieldsFor(campos).filter((f) => f !== 'lastViewed')
      if (!campos.length) campos = SEARCH_FIELDS.filter((f) => f !== 'lastViewed')
      continue
    }
    // La ruta de contexto no era esa: se reintenta en la raíz.
    if (r.status === 404 && prefijo) {
      prefijo = ''
      continue
    }
    return fallo(r)
  }
  return { ok: false, reason: 'api', detail: 'la API no contestó a ninguna de las dos formas de la consulta' }
}

/** Los filtros que el propio usuario tiene marcados como favoritos en su Jira. */
export async function fetchFavouriteFilters(
  fetchFn,
  site,
  { prefix, timeoutMs = JIRA_REST_LIMITS.timeoutMs, credentials = 'same-origin' } = {}
) {
  const t0 = nowMs()
  const enCloud = sinRestDeJira(site)
  if (enCloud) return enCloud
  const base = origenDe(site)
  if (!base) return { ok: false, reason: 'origen', detail: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin-fetch', detail: 'sin fetch' }

  const r = await getJson(fetchFn, base + favouriteFiltersPath(prefix ?? site?.jiraPrefix), {
    timeoutMs,
    credentials,
    base,
    errorBody: true,
  })
  if (!r.ok) return fallo(r)
  const filters = parseFilters(r.json)
  if (!filters) return { ok: false, reason: 'forma', detail: 'la respuesta de la API no tiene la forma esperada', status: r.status }
  return { ok: true, filters, ms: Math.round(nowMs() - t0) }
}

/**
 * Los enlaces remotos a páginas de Confluence de una incidencia.
 *
 * @param {Array<string>} hosts a qué hosts se admite que apunten (el propio y
 *        el del Confluence enlazado, guardados por `siteRecords`; nunca uno que
 *        diga el modelo)
 */
export async function fetchRemoteLinks(
  fetchFn,
  site,
  issueKey,
  { prefix, hosts = [], timeoutMs = JIRA_REST_LIMITS.timeoutMs, credentials = 'same-origin' } = {}
) {
  const t0 = nowMs()
  const enCloud = sinRestDeJira(site)
  if (enCloud) return enCloud
  const base = origenDe(site)
  if (!base) return { ok: false, reason: 'origen', detail: 'origen desconocido' }
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'sin-fetch', detail: 'sin fetch' }
  const ruta = remoteLinksPath(issueKey, prefix ?? site?.jiraPrefix)
  if (!ruta) return { ok: false, reason: 'clave', detail: 'clave de incidencia inválida' }

  const r = await getJson(fetchFn, base + ruta, { timeoutMs, credentials, base, errorBody: true })
  if (!r.ok) return fallo(r)
  const links = parseRemoteLinks(r.json, { hosts })
  if (!links) return { ok: false, reason: 'forma', detail: 'la respuesta de la API no tiene la forma esperada', status: r.status }
  return { ok: true, links, ms: Math.round(nowMs() - t0) }
}

// ----------------------------------------------- perfil de un proyecto

/** Los prefijos de convención de un resumen: «[API] …», «[Backend][Update] …», «PSO | …». */
const PREFIJO_CORCHETES = /^((?:\[[^[\]]{1,40}\]\s*){1,3})/
const PREFIJO_BARRA = /^([^|]{1,40}?)\s*\|/

/**
 * El patrón de nombre con el que empieza un resumen, o ''.
 *
 * Con la barra se exigen como mucho tres palabras delante: «PSO |» es una
 * convención, «Arreglar el formulario de consentimiento |» es una frase que
 * casualmente lleva una barra.
 */
function patronDe(summary) {
  const s = linea(summary, JIRA_REST_LIMITS.profileSummaryChars)
  const corchetes = PREFIJO_CORCHETES.exec(s)
  if (corchetes) return corchetes[1].replace(/\s+/g, '')
  const barra = PREFIJO_BARRA.exec(s)
  const antes = barra ? barra[1].trim() : ''
  if (antes && antes.split(' ').filter(Boolean).length <= 3) return antes + ' |'
  return ''
}

/** Cuenta valores y devuelve `[{name, count}]` de más a menos, con tope. */
function contados(mapa, tope) {
  return [...mapa.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
    .slice(0, tope)
}

function suma(mapa, clave) {
  if (!clave) return
  mapa.set(clave, (mapa.get(clave) || 0) + 1)
}

/**
 * El perfil de un proyecto contado de una muestra: qué tipos hay, qué estados se
 * usan de verdad, qué componentes y etiquetas, y cómo se nombran los tickets.
 * Pura y determinista (el reloj se inyecta).
 *
 * Es lo que el modelo pedía por herramienta para escribir un JQL con los nombres
 * exactos. SIN PERSONAS: ni `assignee` ni `reporter` se miran, porque esto es lo
 * único de este módulo que acaba delimitado dentro de un `system`.
 *
 * Recibe lo que devuelve `parseSearchIssues` (ya limpio), no el JSON del
 * servidor: aquí sólo se cuenta.
 */
export function profileFromSample(issues, { projectKey, now = Date.now() } = {}) {
  const key = validProjectKey(projectKey)
  const muestra = Array.isArray(issues) ? issues : []
  const tipos = new Map()
  const estados = new Map()
  const categorias = new Map()
  const idsTipo = new Map()
  const idsEstado = new Map()
  const componentes = new Map()
  const etiquetas = new Map()
  const patrones = new Map()
  const ejemplos = new Map()

  for (const i of muestra) {
    if (!i || typeof i !== 'object') continue
    const tipo = nombre(i.type)
    suma(tipos, tipo)
    // El id del PRIMER ejemplar que lo traiga, y no el de la primera fila con ese
    // nombre: si la primera viniera sin él, el nombre se quedaría sin id para
    // siempre aunque el resto de la muestra lo diga. Sigue siendo determinista,
    // porque depende sólo del orden de la muestra.
    if (tipo && !idsTipo.has(tipo) && fieldId(i.typeId)) idsTipo.set(tipo, fieldId(i.typeId))
    const estado = nombre(i.status)
    suma(estados, estado)
    if (estado && !idsEstado.has(estado) && fieldId(i.statusId)) idsEstado.set(estado, fieldId(i.statusId))
    if (estado && !categorias.has(estado)) categorias.set(estado, categoria({ key: i.statusCategory }))
    for (const c of lista(i.components)) suma(componentes, c)
    for (const l of lista(i.labels)) suma(etiquetas, l)
    const patron = patronDe(i.summary)
    if (!patron) continue
    suma(patrones, patron)
    const clave = validIssueKey(i.key)
    if (!clave) continue
    if (!ejemplos.has(patron)) ejemplos.set(patron, [])
    const lote = ejemplos.get(patron)
    if (lote.length < JIRA_REST_LIMITS.profileExamples) {
      lote.push({ key: clave, summary: linea(i.summary, JIRA_REST_LIMITS.profileSummaryChars) })
    }
  }

  return {
    version: PROFILE_VERSION,
    projectKey: key,
    sampled: muestra.length,
    at: Number.isFinite(now) ? Math.round(now) : 0,
    // Tipos y estados llevan su id (H14); componentes y etiquetas no: ésos los
    // escribió el equipo, Jira no los traduce y valen por nombre.
    types: contados(tipos, JIRA_REST_LIMITS.profileList).map((t) => ({ ...t, id: idsTipo.get(t.name) || '' })),
    statuses: contados(estados, JIRA_REST_LIMITS.profileList).map((e) => ({
      ...e,
      category: categorias.get(e.name) || '',
      id: idsEstado.get(e.name) || '',
    })),
    components: contados(componentes, JIRA_REST_LIMITS.profileList),
    labels: contados(etiquetas, JIRA_REST_LIMITS.profileList),
    prefixes: contados(patrones, JIRA_REST_LIMITS.profilePrefixes).map((p) => ({
      pattern: p.name,
      count: p.count,
      examples: ejemplos.get(p.name) || [],
    })),
  }
}

function cuenta(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * `[{name, count}]` reconstruido con claves blancas, y con `id` detrás si el
 * valor lo lleva (los tipos, desde H14; los componentes y las etiquetas no).
 */
function normalizeCounted(v, tope, { conId = false } = {}) {
  if (!Array.isArray(v)) return []
  const out = []
  const vistos = new Set()
  for (const item of v) {
    if (out.length >= tope) break
    const name = nombre(item)
    if (!name || vistos.has(name)) continue
    vistos.add(name)
    const fila = { name, count: cuenta(item?.count) }
    // El orden de las claves importa: lo que sale de aquí se compara con lo que
    // sale de `profileFromSample` (`normalizeProfile(perfil) === perfil`).
    if (conId) fila.id = fieldId(item?.id)
    out.push(fila)
  }
  return out
}

/**
 * El perfil del proyecto que hay delante, sacado del contenedor del host. Pura.
 *
 * POR QUÉ EXISTE: un Jira tiene muchos proyectos, y el perfil de SIMPL no son
 * «los nombres EXACTOS: cópialos tal cual» de OPS —un estado que no existe en
 * ese proyecto no da cero resultados, da un 400— (revisión adversaria de H9).
 * Hasta H22 se guardaba UN perfil por host y aquí se cruzaba su `projectKey`;
 * desde H22 se guarda uno POR PROYECTO (`{ version, byProject }`) y aquí se
 * busca el suyo, así que volver a un proyecto ya contado no vuelve a contar.
 * Se busca DONDE SE CONSUME, como `state.issueFields` se cruza con `samePage`.
 *
 * SÓLO acepta el contenedor: un perfil suelto (la forma de antes de H22) no es
 * algo que tenga el panel, porque todo lo que lee pasa por `normalizeProfiles`.
 * La clave se lee con `Object.hasOwn` (por `JSON.parse` un `__proto__` o un
 * `constructor` llegan como claves PROPIAS) y la entrada tiene que decir ser de
 * ese mismo proyecto.
 *
 * @returns el mismo objeto del mapa (sin copiar), o null
 */
export function profileForProject(profiles, projectKey) {
  const key = validProjectKey(projectKey)
  if (!key || !esContenedor(profiles)) return null
  if (!Object.hasOwn(profiles.byProject, key)) return null
  const perfil = profiles.byProject[key]
  if (!perfil || typeof perfil !== 'object') return null
  return validProjectKey(perfil.projectKey) === key ? perfil : null
}

/** ¿Tiene la forma del contenedor de perfiles de H22? Puro. */
function esContenedor(v) {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    v.version === PROFILES_VERSION &&
    !!v.byProject &&
    typeof v.byProject === 'object' &&
    !Array.isArray(v.byProject)
  )
}

/** Un contenedor de perfiles vacío, nuevo cada vez. Puro. */
export function emptyProfiles() {
  return { version: PROFILES_VERSION, byProject: {} }
}

/**
 * Los perfiles de un host, en la forma de H22. Pura, idempotente, nunca lanza y
 * no muta lo que recibe.
 *
 * - El perfil v2 SUELTO que guardaba `faro:profile:<host>` antes de H22 migra
 *   bajo su `projectKey` (sin clave de proyecto válida no se sabe de quién es, y
 *   no migra).
 * - Un contenedor de esta versión: sólo las claves PROPIAS que son clave de
 *   proyecto (por `validProjectKey`, así que llegan en mayúsculas) cuyo valor
 *   pasa `normalizeProfile` y dice ser de ESE proyecto; lo demás se cae. Si dos
 *   claves acaban en la misma mayúscula, gana la de `at` más reciente.
 * - Tope `JIRA_REST_LIMITS.profileProjects`, conservando los contados más
 *   recientemente y en el orden en que estaban. Un `at` del futuro cuenta como
 *   ahora AL ELEGIR (si no, un reloj adelantado lo haría inmortal), pero el dato
 *   no se toca: la antigüedad del perfil la decide quien lo usa.
 * - Otra versión, una lista o basura: vacío.
 */
export function normalizeProfiles(raw, { now = Date.now() } = {}) {
  try {
    const ahora = Number.isFinite(now) ? now : Date.now()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyProfiles()
    if (raw.version === PROFILE_VERSION) {
      const suelto = normalizeProfile(raw)
      if (!suelto || !suelto.projectKey) return emptyProfiles()
      return { version: PROFILES_VERSION, byProject: { [suelto.projectKey]: suelto } }
    }
    if (!esContenedor(raw)) return emptyProfiles()

    const origen = raw.byProject
    const entradas = []
    const dondeEsta = new Map()
    for (const k of Object.keys(origen)) {
      if (!Object.hasOwn(origen, k)) continue
      const key = validProjectKey(k)
      if (!key) continue
      const perfil = normalizeProfile(origen[k])
      if (!perfil || perfil.projectKey !== key) continue
      if (dondeEsta.has(key)) {
        const i = dondeEsta.get(key)
        if (perfil.at > entradas[i].perfil.at) entradas[i] = { key, perfil }
        continue
      }
      dondeEsta.set(key, entradas.length)
      entradas.push({ key, perfil })
    }

    let quedan = entradas
    const tope = JIRA_REST_LIMITS.profileProjects
    if (entradas.length > tope) {
      const elegidos = new Set(
        entradas
          .map((x, i) => ({ i, at: Math.min(x.perfil.at, ahora) }))
          .sort((a, b) => b.at - a.at || a.i - b.i)
          .slice(0, tope)
          .map((x) => x.i)
      )
      quedan = entradas.filter((_, i) => elegidos.has(i))
    }
    const byProject = {}
    for (const { key, perfil } of quedan) byProject[key] = perfil
    return { version: PROFILES_VERSION, byProject }
  } catch {
    return emptyProfiles()
  }
}

/**
 * Un contenedor NUEVO con `perfil` puesto (o sustituido) bajo su proyecto. No
 * muta. Un perfil que no vale (sin proyecto, de otra versión, basura) deja el
 * contenedor como estaba, normalizado. Lo recién contado no lo tira el tope:
 * si hace falta sitio se cae el más viejo de los DEMÁS (la lección de
 * `withContext`, revisión adversaria de H21). Pura.
 */
export function withProfile(profiles, perfil) {
  const base = normalizeProfiles(profiles)
  const nuevo = normalizeProfile(perfil)
  if (!nuevo || !nuevo.projectKey) return base
  const byProject = { ...base.byProject, [nuevo.projectKey]: nuevo }
  const claves = Object.keys(byProject)
  const tope = JIRA_REST_LIMITS.profileProjects
  if (claves.length > tope) {
    const otras = claves
      .filter((k) => k !== nuevo.projectKey)
      .map((k, i) => ({ k, i, at: byProject[k].at }))
      .sort((a, b) => b.at - a.at || a.i - b.i)
    for (const { k } of otras.slice(tope - 1)) delete byProject[k]
  }
  return normalizeProfiles({ version: PROFILES_VERSION, byProject })
}

/**
 * El perfil guardado, en la forma actual. Pura.
 *
 * Lo que sale del almacén se reconstruye con claves blancas como todo lo demás
 * (CLAUDE.md §9): de aquí sale texto que entra delimitado en un `system`, y un
 * perfil editado a mano no puede colar una clave de más. Otra versión → null,
 * para que se vuelva a contar.
 */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== PROFILE_VERSION) return null
  return {
    version: PROFILE_VERSION,
    projectKey: validProjectKey(raw.projectKey),
    sampled: cuenta(raw.sampled),
    at: Number.isFinite(raw.at) ? Math.round(raw.at) : 0,
    types: normalizeCounted(raw.types, JIRA_REST_LIMITS.profileList, { conId: true }),
    statuses: normalizeStatuses(raw.statuses),
    components: normalizeCounted(raw.components, JIRA_REST_LIMITS.profileList),
    labels: normalizeCounted(raw.labels, JIRA_REST_LIMITS.profileList),
    prefixes: normalizePrefixes(raw.prefixes),
  }
}

/**
 * Los estados, que llevan además su categoría. No se puede reutilizar
 * `normalizeCounted` y pegarle la categoría por posición: esa función salta los
 * repetidos y los que no valen, así que los índices dejarían de casar y un
 * estado acabaría con la categoría de otro.
 */
function normalizeStatuses(v) {
  if (!Array.isArray(v)) return []
  const out = []
  const vistos = new Set()
  for (const item of v) {
    if (out.length >= JIRA_REST_LIMITS.profileList) break
    const name = nombre(item)
    if (!name || vistos.has(name)) continue
    vistos.add(name)
    out.push({ name, count: cuenta(item?.count), category: categoria({ key: item?.category }), id: fieldId(item?.id) })
  }
  return out
}

function normalizePrefixes(v) {
  if (!Array.isArray(v)) return []
  const out = []
  const vistos = new Set()
  for (const p of v) {
    if (out.length >= JIRA_REST_LIMITS.profilePrefixes) break
    const pattern = linea(p?.pattern, JIRA_REST_LIMITS.fieldChars)
    if (!pattern || vistos.has(pattern)) continue
    vistos.add(pattern)
    const examples = []
    for (const e of Array.isArray(p?.examples) ? p.examples : []) {
      if (examples.length >= JIRA_REST_LIMITS.profileExamples) break
      const key = validIssueKey(e?.key)
      if (!key) continue
      examples.push({ key, summary: linea(e?.summary, JIRA_REST_LIMITS.profileSummaryChars) })
    }
    out.push({ pattern, count: cuenta(p?.count), examples })
  }
  return out
}

// ------------------------------------------- las últimas que se ejecutaron

/**
 * Las últimas consultas que se ejecutaron de verdad, en su forma canónica. Pura.
 *
 * Se guardan en el registro del sitio (`sites[host].recentJql`), que es un
 * objeto de `chrome.storage` como cualquier otro: lo que salga de ahí puede
 * estar editado a mano o venir de una versión anterior, así que se reconstruye
 * al LEER con claves blancas (CLAUDE.md §9) y cada consulta vuelve a pasar por
 * `cleanJql` antes de que nadie la meta en una URL. Sin repetir (sin distinguir
 * mayúsculas: la misma consulta escrita de dos formas es una) y con tope.
 *
 * @returns {Array<{jql:string, at:number, count:number}>}
 */
export function normalizeRecentJql(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const vistas = new Set()
  for (const item of raw) {
    if (out.length >= JIRA_REST_LIMITS.recentJql) break
    // Una lista de cadenas a secas también vale: es lo que escribiría alguien
    // a mano, y lo único que hace falta de una entrada es su consulta.
    const jql = cleanJql(typeof item === 'string' ? item : item?.jql)
    if (!jql) continue
    const huella = jql.toLowerCase()
    if (vistas.has(huella)) continue
    vistas.add(huella)
    out.push({ jql, at: Number.isFinite(item?.at) ? Math.round(item.at) : 0, count: cuenta(item?.count) })
  }
  return out
}

/**
 * Apunta una consulta que acaba de ejecutarse. Pura (el reloj se inyecta).
 *
 * La más nueva delante, sin repetir y con tope. Sólo se apunta lo que se
 * EJECUTÓ —un chip pulsado, una búsqueda del modelo que devolvió lista—, nunca
 * lo que se escribió: una consulta que Jira rechaza no merece volver a
 * ofrecerse. `count` es cuántos resultados dio, que es lo que distingue una
 * consulta útil de una que no encuentra nada.
 */
export function rememberJql(list, jql, { count = 0, now = Date.now() } = {}) {
  const consulta = cleanJql(jql)
  const previas = normalizeRecentJql(list)
  if (!consulta) return previas
  const huella = consulta.toLowerCase()
  const entrada = { jql: consulta, at: Number.isFinite(now) ? Math.round(now) : 0, count: cuenta(count) }
  return [entrada, ...previas.filter((r) => r.jql.toLowerCase() !== huella)].slice(0, JIRA_REST_LIMITS.recentJql)
}

// ------------------------------------------------- búsquedas sugeridas

/**
 * Los estados que no son de cierre, los más frecuentes primero, con su id.
 *
 * El id sale tal cual del perfil: quien lo mete en la consulta es
 * `porIdONombre`, y es él quien lo valida. Validarlo aquí también sería una
 * segunda barrera que ninguna prueba puede distinguir de la primera.
 */
function estadosAbiertos(profile) {
  return (profile?.statuses || [])
    .filter((s) => s?.name && s.category !== 'done')
    .map((s) => ({ name: nombre(s), id: s.id }))
}

/**
 * El id con el que preguntar por un tipo o un estado en JQL: el que el perfil
 * contó, cruzado por nombre EXACTO (sin distinguir mayúsculas). '' si no lo hay.
 *
 * Hace falta porque el nombre que se lee de la PANTALLA viene solo —el DOM no da
 * el id— y traducido: para escribir `issuetype = 10002` hay que casar ese nombre
 * con el del perfil, que sí trae el id (H14).
 */
function idDelPerfil(lista, valor) {
  const buscado = linea(valor, JIRA_REST_LIMITS.quoteMax).toLowerCase()
  if (!buscado) return ''
  for (const item of Array.isArray(lista) ? lista : []) {
    if (nombre(item).toLowerCase() === buscado) return item?.id
  }
  return ''
}

/**
 * Cómo entra un valor de campo en la consulta: por su id si se conoce (un número
 * sin comillas, que es lo que JQL acepta siempre) y por su nombre entrecomillado
 * si no (que vale mientras el nombre no esté traducido).
 *
 * SEGURIDAD: es el ÚNICO sitio de este módulo que escribe un id dentro de una
 * consulta, y por eso el que lo valida (`fieldId`). Lo que no sea un número cae
 * al nombre, que sí va escapado.
 */
function porIdONombre(id, name) {
  return fieldId(id) || jqlQuote(name)
}

/**
 * Las búsquedas que se pueden ofrecer sin gastar un token, deducidas de lo que
 * ya se sabe. Pura y determinista.
 *
 * Todas llevan `project = KEY` delante cuando se conoce el proyecto, y todo
 * valor que venga de la pantalla (un componente, un sprint, una etiqueta) entra
 * por `jqlQuote`. La épica sólo se ofrece con su CLAVE: en Data Center
 * `'Epic Link'` se busca por clave, y con el NOMBRE de la épica —que es lo que
 * suele leerse del campo— la consulta no encuentra nada
 * (docs/plan/anexo-C, «APIs externas»).
 *
 * El tipo y el estado van por ID cuando el perfil lo trae (`porIdONombre`),
 * porque Jira traduce esos nombres y JQL rechaza los traducidos (mira la
 * cabecera del módulo); la ETIQUETA del chip sigue enseñando el nombre, que es
 * lo que el usuario reconoce.
 *
 * @returns {Array<{jql:string, kind:string, label:string}>} como mucho
 *          `JIRA_REST_LIMITS.suggestions`, sin repetir consulta
 */
export function suggestedQueries({ site = null, issue = null, profile = null, filters = [], recent = [] } = {}) {
  const proyecto = validProjectKey(site?.projectKey) || validProjectKey(profile?.projectKey)
  const abierta = validIssueKey(site?.issueKey)
  const conProyecto = (jql) => (proyecto ? `project = ${proyecto} AND ${jql}` : jql)
  const out = []
  const vistas = new Set()
  const add = (kind, label, jql) => {
    const consulta = cleanJql(jql)
    const etiqueta = linea(label, JIRA_REST_LIMITS.quoteMax)
    if (!consulta || !etiqueta || out.length >= JIRA_REST_LIMITS.suggestions) return
    const huella = consulta.toLowerCase()
    if (vistas.has(huella)) return
    vistas.add(huella)
    out.push({ jql: consulta, kind, label: etiqueta })
  }

  // De la incidencia que se tiene delante.
  const epica = validIssueKey(issue?.epicKey)
  if (epica) add('epica', `Misma épica ${epica}`, conProyecto(`'Epic Link' = ${epica}`))
  const sprint = linea(issue?.sprint, JIRA_REST_LIMITS.quoteMax)
  if (sprint) add('sprint', `Mismo sprint «${sprint}»`, conProyecto(`sprint = ${jqlQuote(sprint)}`))
  const componente = lista(issue?.components)[0]
  if (componente) add('componente', `Mismo componente «${componente}»`, conProyecto(`component = ${jqlQuote(componente)}`))
  const etiqueta = lista(issue?.labels)[0]
  if (etiqueta) add('etiqueta', `Misma etiqueta «${etiqueta}»`, conProyecto(`labels = ${jqlQuote(etiqueta)}`))
  if (abierta) add('enlazadas', `Enlazadas a ${abierta}`, relatedJql(abierta))
  const tipo = linea(issue?.type, JIRA_REST_LIMITS.quoteMax)
  // El tipo sale de la PANTALLA, que sólo da el nombre —y traducido—: el id se
  // busca en el perfil por ese mismo nombre, y sin perfil se pregunta por nombre,
  // que es lo que se hacía hasta H14 y lo que vale si no está traducido.
  if (tipo) {
    const valorTipo = porIdONombre(idDelPerfil(profile?.types, tipo), tipo)
    add('tipo', `Del mismo tipo («${tipo}»), sin resolver`, conProyecto(`issuetype = ${valorTipo} AND resolution = Unresolved`))
  }

  // Lo tuyo, que no necesita saber nada de la pantalla.
  if (proyecto) add('mias', `Mis abiertas de ${proyecto}`, conProyecto('assignee = currentUser() AND resolution = Unresolved'))

  // Del perfil del proyecto: los dos estados no finales más usados. La etiqueta
  // enseña el NOMBRE (es lo que el usuario reconoce, y lo que ve en su Jira) y la
  // consulta va por el ID: con el nombre traducido sería un 400 (H14).
  for (const estado of estadosAbiertos(profile).slice(0, 2)) {
    add('estado', `${proyecto || 'Incidencias'} en «${estado.name}»`, conProyecto(`status = ${porIdONombre(estado.id, estado.name)}`))
  }

  // Filtros del propio usuario: su consulta, tal cual la guardó él.
  for (const f of Array.isArray(filters) ? filters : []) {
    const name = linea(f?.name, JIRA_REST_LIMITS.quoteMax)
    if (name) add('filtro', `Filtro: ${name}`, f?.jql)
  }

  // Las últimas que se ejecutaron de verdad.
  for (const r of Array.isArray(recent) ? recent : []) {
    const jql = cleanJql(typeof r === 'string' ? r : r?.jql)
    if (jql) add('ultima', `Última: ${jql.slice(0, 60)}`, jql)
  }

  return out
}
