/**
 * Los chips de «búsquedas al instante» del chat vacío: consultas que se pueden
 * ofrecer sin gastar un token y ejecutar sin pasar por el modelo.
 *
 * POR QUÉ EXISTE: en Jira, saber QUÉ buscar es la mitad del trabajo, y hasta
 * aquí el chat vacío ofrecía tres frases fijas («¿Qué incidencias mías están sin
 * cerrar?») que hay que traducir a JQL preguntándole al modelo: segundos, tokens
 * y una consulta que puede no ser la que el usuario tenía en la cabeza. Todo lo
 * que hace falta para escribir esas consultas ya está delante: los campos de la
 * incidencia abierta (`jiraIssueFields`), los filtros que el propio usuario tiene
 * marcados en su Jira y las últimas que ejecutó. `suggestedQueries` (jira-rest.js)
 * las escribe con plantillas y valores escapados por `jqlQuote`; aquí se decide
 * CUÁLES se enseñan y cuáles no se ejecutan solas.
 *
 * Es una capa fina y aparte de `suggestions.js` a propósito: aquello son las
 * tres preguntas en prosa que van AL MODELO, esto son consultas que la extensión
 * ejecuta ella misma. Comparten sitio en el estado vacío y nada más.
 *
 * DOS DECISIONES QUE VIVEN AQUÍ:
 *  1. Cuántos y cuáles. El presupuesto del estado vacío son tres sugerencias más
 *     una línea de chips (docs/PLAN.md §3.4, decisión 3 de H5), así que se
 *     enseñan `SEARCH_CHIP_COUNT` como mucho. Y no los cuatro primeros de la
 *     lista: `suggestedQueries` pone delante todo lo que sale de la pantalla, y
 *     con una incidencia abierta los cuatro primeros serían épica, sprint,
 *     componente y etiqueta —los filtros del usuario y sus últimas búsquedas no
 *     aparecerían nunca—. Se reparte uno por GRUPO y luego se rellena, que es
 *     determinista y da variedad.
 *  2. Qué se ejecuta y qué sólo se abre. Un filtro guardado por el usuario puede
 *     llevar una función de un complemento (ScriptRunner y compañía): es suya y
 *     sólo lee, pero no es de Jira y no tiene por qué contestar a
 *     `GET /rest/api/2/search`. Esos chips se ofrecen igual y se ABREN en Jira,
 *     que sabe ejecutarlas, en vez de intentarlo aquí y enseñar un 400.
 *
 * Puro: se prueba en Node, no toca DOM ni chrome.
 */

import { cleanJql, suggestedQueries } from '../shared/jira-rest.js'

/**
 * Cuántos chips se enseñan. Cuatro y no ocho: el estado vacío ya lleva tres
 * sugerencias, y a 320 px una fila de chips larga empuja el resto fuera de la
 * vista. Lo que no cabe no se esconde detrás de un «más» —otro control
 * compitiendo con el cuadro de escribir—: no se ofrece.
 */
export const SEARCH_CHIP_COUNT = 4

/**
 * Las funciones de JQL que trae Jira de serie (Server/Data Center).
 *
 * No están todas, y no hace falta: esto no valida una consulta, decide si Faro
 * la ejecuta él o la abre en Jira. Una función que no esté aquí —la de un
 * complemento, o una nueva— hace que el chip se abra en Jira en vez de
 * ejecutarse, que es el lado seguro del error.
 */
const FUNCIONES_DE_JIRA = new Set(
  [
    'currentuser',
    'currentlogin',
    'lastlogin',
    'now',
    'startofday',
    'startofweek',
    'startofmonth',
    'startofyear',
    'endofday',
    'endofweek',
    'endofmonth',
    'endofyear',
    'issuehistory',
    'watchedissues',
    'votedissues',
    'linkedissues',
    'membersof',
    'projectsleadbyuser',
    'componentsleadbyuser',
    'projectswhereuserhaspermission',
    'projectswhereuserhasrole',
    'opensprints',
    'closedsprints',
    'futuresprints',
    'earliestunreleasedversion',
    'latestreleasedversion',
    'releasedversions',
    'unreleasedversions',
    'standardissuetypes',
    'subtaskissuetypes',
    'updatedby',
  ]
)

/**
 * Las palabras de la propia consulta, que no son funciones aunque lleven un
 * paréntesis detrás: sin esto, un `AND (a = 1 OR b = 2)` contaría «AND» como
 * función de un complemento y ningún chip con paréntesis se ejecutaría.
 */
const PALABRAS_DE_JQL = new Set([
  'and',
  'or',
  'not',
  'in',
  'is',
  'was',
  'changed',
  'order',
  'by',
  'from',
  'to',
  'on',
  'during',
  'before',
  'after',
  'empty',
  'null',
  'asc',
  'desc',
])

/** Lo que parece una llamada a función dentro de una consulta. */
const LLAMADA = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g

/**
 * ¿La consulta llama a algo que no es de Jira? Pura.
 *
 * Se mira la consulta ENTERA, venga de donde venga: las plantillas de Faro sólo
 * usan `currentUser()`, `issueHistory()`, `watchedIssues()` y `linkedIssues()`,
 * así que un chip propio nunca sale marcado; lo que puede traer cualquier cosa
 * es un filtro del usuario o una consulta que el modelo ejecutó de verdad.
 */
export function usesUnknownFunction(jql) {
  const consulta = cleanJql(jql)
  if (!consulta) return false
  for (const [, nombre] of consulta.matchAll(LLAMADA)) {
    const n = nombre.toLowerCase()
    if (PALABRAS_DE_JQL.has(n) || FUNCIONES_DE_JIRA.has(n)) continue
    return true
  }
  return false
}

/**
 * De qué fuente sale cada clase de chip, en el orden en que se reparten. El
 * primer grupo es todo lo que sale de la pantalla: de ahí se coge UNO, porque
 * si no se lo comen todo.
 */
const GRUPOS = [
  ['epica', 'sprint', 'componente', 'etiqueta', 'enlazadas', 'tipo'],
  ['mias'],
  ['filtro'],
  ['ultima'],
  // Los estados más usados salen del perfil del proyecto, que todavía no existe
  // (lo cuenta H9): el hueco está hecho para que entren sin tocar el reparto.
  ['estado'],
]

/**
 * La misma consulta no se ofrece dos veces aunque venga de dos fuentes: un
 * filtro guardado y la última búsqueda suelen ser la misma cosa, y dos chips
 * iguales no dicen nada distinto. Manda el primero, que es el de la fuente más
 * cercana a la pantalla.
 */
function quitarRepetidas(lista) {
  const vistas = new Set()
  return lista.filter((s) => {
    const huella = String(s?.jql || '').toLowerCase()
    if (!huella || vistas.has(huella)) return false
    vistas.add(huella)
    return true
  })
}

/** Uno por grupo y después los que quepan, en el orden en que venían. */
function repartidas(lista, tope) {
  const elegidas = []
  for (const grupo of GRUPOS) {
    const uno = lista.find((s) => grupo.includes(s.kind) && !elegidas.includes(s))
    if (uno && elegidas.length < tope) elegidas.push(uno)
  }
  for (const s of lista) {
    if (elegidas.length >= tope) break
    if (!elegidas.includes(s)) elegidas.push(s)
  }
  return elegidas.slice(0, tope)
}

/**
 * Qué buscar sin escribir nada, en el chat vacío de un Jira Data Center.
 *
 * @param {{product?:string, cloud?:boolean, projectKey?:string, issueKey?:string}|null} site
 *        el sitio de la pestaña; en Confluence no hay chips, y en Jira Cloud
 *        tampoco: allí `GET /rest/api/2/search` está retirado y no habría con
 *        qué ejecutarlos (CLAUDE.md §8.19)
 * @param {object} fuentes lo que ya se sabe: los campos de la incidencia abierta
 *        (`normalizeIssueFields`), el perfil del proyecto (H9), los filtros
 *        favoritos leídos de la API y las últimas consultas del registro del
 *        sitio (`normalizeRecentJql`)
 * @returns {Array<{kind:string, label:string, jql:string, title:string, run:boolean}>}
 *          como mucho `SEARCH_CHIP_COUNT`; `run` en false es «esto lo abre
 *          Jira, no lo ejecuto yo»
 *
 * Pura y determinista: con las mismas fuentes da los mismos chips en el mismo
 * orden, y nunca lanza (todo lo que llega pasa por `suggestedQueries`, que
 * valida claves y entrecomilla valores).
 */
export function searchChips(site, { issueFields = null, profile = null, favouriteFilters = [], recentJql = [] } = {}) {
  if (site?.product !== 'jira' || site?.cloud) return []
  // Cada fuente se pregunta por SEPARADO, y no todas de una: `suggestedQueries`
  // ofrece ocho como mucho, y con una incidencia abierta esas ocho se las comen
  // las de la pantalla y «mis abiertas» —los filtros del usuario y sus últimas
  // búsquedas no llegarían nunca a la lista de la que aquí se reparte—. El tope
  // del módulo sigue valiendo dentro de cada llamada; el de los chips es
  // `SEARCH_CHIP_COUNT`. Sin `site` en las dos últimas: con él repetirían las
  // consultas de la pantalla que ya trae la primera.
  const candidatas = quitarRepetidas([
    ...suggestedQueries({ site, issue: issueFields, profile }),
    ...suggestedQueries({ filters: favouriteFilters }),
    ...suggestedQueries({ recent: recentJql }),
  ])
  return repartidas(candidatas, SEARCH_CHIP_COUNT).map((s) => {
    const run = !usesUnknownFunction(s.jql)
    return {
      kind: s.kind,
      label: s.label,
      jql: s.jql,
      // El `title` del botón es la consulta entera: un chip dice «Mis abiertas
      // de ENG» y quien quiera saber qué va a ejecutar tiene derecho a leerlo
      // antes de pulsar, no después.
      title: run ? s.jql : `${s.jql} · la abro en Jira: usa una función que no es de Jira`,
      run,
    }
  })
}
