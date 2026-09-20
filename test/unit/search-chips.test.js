/**
 * Los chips de «búsquedas al instante» del chat vacío.
 *
 * Lo que hay que proteger: que sólo salen donde se pueden ejecutar (Jira Data
 * Center, nunca Confluence ni Cloud); que los cuatro que se enseñan no son
 * siempre los de la pantalla, porque entonces los filtros del usuario y sus
 * últimas búsquedas no aparecerían jamás; que una consulta con una función que
 * no es de Jira se ofrece pero NO se ejecuta aquí; y que nada de esto lanza con
 * lo que puede llegar del estado del panel, que es lo que hay en la pantalla de
 * ahora y lo que hubiera guardado un registro de otra versión.
 */
import { test, eq, assert } from '../harness.js'
import { SEARCH_CHIP_COUNT, searchChips, usesUnknownFunction } from '../../src/panel/search-chips.js'

const JIRA = { product: 'jira', cloud: false, host: 'jira.simplprogramme.eu', projectKey: 'ENG', issueKey: 'ENG-7' }
/** Los campos tal como los deja `normalizeIssueFields` en una incidencia abierta. */
const CAMPOS = {
  type: 'Tarea',
  status: 'En curso',
  epic: 'Rotación de credenciales',
  epicKey: 'ENG-1',
  sprint: 'S37 Infra',
  components: ['Auth'],
  labels: ['seguridad'],
}
const FILTROS = [{ id: '10100', name: 'Mis API en revisión', jql: 'project = ENG AND status = "In Review"' }]
const ULTIMAS = [{ jql: 'project = ENG AND text ~ "kafka"', at: 1, count: 4 }]

const etiquetas = (chips) => chips.map((c) => c.label)
const clases = (chips) => chips.map((c) => c.kind)

// --- dónde salen y dónde no ------------------------------------------------

test('los chips sólo salen donde se pueden ejecutar: Jira Data Center', () => {
  assert(searchChips(JIRA, { issueFields: CAMPOS }).length > 0)
  // En Confluence no hay nada que consultar con una JQL.
  eq(searchChips({ product: 'confluence', host: 'c.eu' }, { issueFields: CAMPOS }), [])
  // Y en Jira Cloud `GET /rest/api/2/search` está retirado: un chip que no se
  // puede ejecutar es un botón muerto (CLAUDE.md §8.19).
  eq(searchChips({ ...JIRA, cloud: true }, { issueFields: CAMPOS }), [])
  eq(searchChips(null), [])
  eq(searchChips(undefined, undefined), [])
})

test('sin nada delante quedan los que no dependen de la pantalla', () => {
  // Sólo con el proyecto: lo tuyo. Es lo que ve alguien que abre el panel en el
  // tablero de un proyecto, sin ninguna incidencia.
  eq(etiquetas(searchChips({ ...JIRA, issueKey: '' }, {})), ['Mis abiertas de ENG'])
  // Con una incidencia abierta y sin haber leído sus campos, lo que se sabe de
  // ella es su clave.
  eq(etiquetas(searchChips(JIRA, {})), ['Enlazadas a ENG-7', 'Mis abiertas de ENG'])
  // Y sin proyecto ni incidencia, nada que ofrecer: inventar una consulta sería
  // justo lo que este camino evita.
  eq(searchChips({ product: 'jira', host: 'j.eu' }, {}), [])
})

// --- cuáles de todos -------------------------------------------------------

test('EL CAMBIO: se reparte uno por fuente, para que los filtros y las últimas lleguen a verse', () => {
  const chips = searchChips(JIRA, { issueFields: CAMPOS, favouriteFilters: FILTROS, recentJql: ULTIMAS })
  eq(chips.length, SEARCH_CHIP_COUNT)
  eq(SEARCH_CHIP_COUNT, 4, 'el presupuesto del estado vacío: tres sugerencias y una línea de chips')
  // Con una incidencia abierta, `suggestedQueries` pone delante SEIS consultas
  // de la pantalla (épica, sprint, componente, etiqueta, enlazadas, tipo): coger
  // las cuatro primeras dejaría fuera para siempre lo del propio usuario.
  eq(clases(chips), ['epica', 'mias', 'filtro', 'ultima'])
  eq(etiquetas(chips), ['Misma épica ENG-1', 'Mis abiertas de ENG', 'Filtro: Mis API en revisión', 'Última: project = ENG AND text ~ "kafka"'])
  // Con menos fuentes se rellena con lo que haya, en el orden en que venía.
  eq(clases(searchChips(JIRA, { issueFields: CAMPOS })), ['epica', 'mias', 'sprint', 'componente'])
  // Determinista: las mismas fuentes dan los mismos chips en el mismo orden.
  eq(searchChips(JIRA, { issueFields: CAMPOS, favouriteFilters: FILTROS, recentJql: ULTIMAS }), chips)
})

test('cada chip lleva su consulta, ya escrita y entrecomillada, y la enseña en su title', () => {
  const chips = searchChips(JIRA, { issueFields: CAMPOS })
  eq(Object.keys(chips[0]).sort(), ['jql', 'kind', 'label', 'run', 'title'])
  // La épica, SÓLO por su clave: con el nombre («Rotación de credenciales») la
  // consulta no encuentra nada en Data Center.
  eq(chips[0].jql, "project = ENG AND 'Epic Link' = ENG-1")
  assert(!chips.some((c) => c.jql.includes('Rotación')), 'el nombre de la épica no entra en ninguna consulta')
  // Y sin clave no se ofrece: el campo no siempre enlaza a la épica.
  const sinClave = searchChips(JIRA, { issueFields: { ...CAMPOS, epicKey: '' } })
  assert(!clases(sinClave).includes('epica'), clases(sinClave).join(' · '))
  eq(clases(sinClave), ['sprint', 'mias', 'componente', 'etiqueta'], 'el hueco lo ocupa lo siguiente de la pantalla')
  // Un valor de la pantalla entra entrecomillado: lo escribió quien creó el
  // ticket y no puede añadir una cláusula (§8.12).
  const comilla = searchChips(JIRA, { issueFields: { components: ['API" OR project = OTRO'] } })
  assert(comilla.some((c) => c.jql.includes('component = "API\\" OR project = OTRO"')), comilla.map((c) => c.jql).join(' | '))
  // El `title` del botón es la consulta entera: se puede leer antes de pulsar.
  for (const c of chips) eq(c.title, c.jql)
})

// --- lo que no se ejecuta aquí ---------------------------------------------

test('SEGURIDAD: una consulta con una función que no es de Jira se ofrece, pero no la ejecuta Faro', () => {
  const plugin = [{ id: '1', name: 'ScriptRunner', jql: 'issueFunction in linkedIssuesOf("project = ENG")' }]
  const chip = searchChips(JIRA, { favouriteFilters: plugin }).find((c) => c.kind === 'filtro')
  eq(chip.run, false, 'no se ejecuta contra /rest/api/2/search: la abre Jira, que es quien sabe')
  assert(/la abro en Jira/.test(chip.title), chip.title)
  // Las de Faro y las funciones de serie de Jira sí se ejecutan.
  for (const c of searchChips(JIRA, { issueFields: CAMPOS, recentJql: ULTIMAS })) eq(c.run, true, c.jql)
  eq(usesUnknownFunction('issue in linkedIssues(ENG-7)'), false)
  eq(usesUnknownFunction('assignee = currentUser() AND resolution = Unresolved'), false)
  eq(usesUnknownFunction('issuekey in issueHistory() ORDER BY lastViewed DESC'), false)
  eq(usesUnknownFunction('sprint in openSprints() AND updated >= startOfWeek()'), false)
  eq(usesUnknownFunction('assignee in membersOf("jira-users")'), false)
  // Las palabras de la propia consulta no son funciones aunque lleven paréntesis
  // detrás: sin esto, ninguna consulta con un grupo se ejecutaría.
  eq(usesUnknownFunction('project = ENG AND (status = "En curso" OR status = Abierta)'), false)
  eq(usesUnknownFunction('project = ENG AND status not in (Cerrada, Resuelta)'), false)
  // Y lo que no conocemos, aunque lleve un espacio antes del paréntesis.
  eq(usesUnknownFunction('issueFunction in linkedIssuesOf("project = ENG")'), true)
  eq(usesUnknownFunction('project = ENG AND updated > loQueSea ()'), true)
  eq(usesUnknownFunction(''), false)
  eq(usesUnknownFunction(null), false)
})

// --- nada de esto puede lanzar ---------------------------------------------

test('SEGURIDAD: con basura en el estado no lanza y no ofrece nada raro', () => {
  const basura = [null, undefined, 7, 'x', {}, [], { jql: 12 }, { name: null }]
  for (const a of basura) {
    for (const b of basura) {
      const chips = searchChips(JIRA, { issueFields: a, favouriteFilters: b, recentJql: b, profile: a })
      assert(Array.isArray(chips) && chips.length <= SEARCH_CHIP_COUNT)
      for (const c of chips) {
        assert(typeof c.jql === 'string' && c.jql.length > 0 && !/[\n\r]/.test(c.jql), JSON.stringify(c))
        assert(typeof c.label === 'string' && c.label.length > 0)
      }
    }
  }
  // Un sitio de un registro guardado a mano tampoco.
  for (const site of [{ product: 'jira' }, { product: 'jira', projectKey: 'no es clave' }, { product: 'jira', issueKey: 12 }]) {
    assert(Array.isArray(searchChips(site, { issueFields: CAMPOS })))
  }
})
