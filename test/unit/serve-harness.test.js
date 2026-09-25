/**
 * La Jira de mentira del banco: el mini-evaluador de JQL de tools/jql-eval.mjs
 * y la fixture harness/issues.json que sirve tools/serve-harness.js.
 *
 * Por qué existe: el banco del navegador ejercita el camino entero (montar la
 * ruta, pedirla, degradar, validar lo que vuelve), pero su servidor es código
 * como cualquier otro y puede mentir. Si el servidor falso contesta con una
 * forma que el Jira real no devuelve, la autocomprobación pasa en verde y el
 * usuario se encuentra el fallo en su Jira. Aquí se pina lo contrario: que lo
 * que devuelve tiene la forma que `parseSearchIssues` espera, que un 400 trae
 * sus `errorMessages` como los trae Jira, y que la lista blanca de cláusulas es
 * eso, una lista blanca.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenize, parseJql, runJql, casa, horasDe, issueJson, searchResponse, fieldCatalog, fieldValue, CAMPOS_POR_DEFECTO } from '../../tools/jql-eval.mjs'
import {
  parseSearchIssues,
  parseRemoteLinks,
  SEARCH_FIELDS,
  historyJql,
  mineJql,
  projectJql,
  relatedJql,
  sampleQuery,
} from '../../src/shared/jira-rest.js'
import { contentSearch, spaceContent, metaDe, PAGE } from '../../tools/cql-eval.mjs'
import { spaceCql, viewedCql, parseSpaceSearch, parseSpacePages } from '../../src/shared/confluence-rest.js'

const ROOT = join(import.meta.dirname, '..', '..')
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'harness', 'issues.json'), 'utf8'))
const USUARIO = { user: FIXTURE.currentUser.name }

/**
 * Las claves que devuelve una consulta sobre la fixture, en orden. Sin `ctx` va
 * sin catálogo, que es como se comportaba esta Jira de mentira antes de H14: las
 * comprobaciones de siempre preguntan por el nombre de JQL y así siguen valiendo.
 */
function claves(jql, ctx = USUARIO) {
  const r = runJql(FIXTURE.issues, jql, ctx)
  assert(r.ok, 'la consulta tenía que valer: ' + (r.errorMessages || []).join(' · '))
  return r.issues.map((i) => i.key)
}

/** Con el catálogo, que es como lo sirve `searchResponse`. */
const CON_CATALOGO = { user: FIXTURE.currentUser.name, catalog: fieldCatalog(FIXTURE) }

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test('tokenize: palabras, literales entre comillas con escape, operadores y paréntesis', () => {
  const r = tokenize('project = ENG AND status = "In \\"Review\\"" AND updated >= -7d')
  assert(r.ok, 'se puede trocear')
  eq(
    r.tokens.map((t) => t.valor),
    ['project', '=', 'ENG', 'AND', 'status', '=', 'In "Review"', 'AND', 'updated', '>=', '-7d']
  )
  eq(tokenize("a = 'b c'").tokens[2], { tipo: 'texto', valor: 'b c' })
  eq(tokenize('(a)').tokens.map((t) => t.tipo), ['(', 'palabra', ')'])
})

test('tokenize: un literal sin cerrar es un error del servidor, no una excepción', () => {
  const r = tokenize('status = "In Review')
  eq(r.ok, false)
  assert(/falta cerrar el literal/.test(r.errorMessages[0]), r.errorMessages[0])
  eq(tokenize('a = €').ok, false, 'un carácter que no es de JQL tampoco lanza')
})

// ---------------------------------------------------------------------------
// parseJql
// ---------------------------------------------------------------------------

test('parseJql analiza las plantillas de jira-rest.js: filtro y ORDER BY', () => {
  const r = parseJql(historyJql())
  assert(r.ok, 'la plantilla de «lo que has mirado» se entiende')
  eq(r.orden, { campo: 'lastviewed', dir: 'desc' })
  eq(r.filtro.clase, 'en')
  eq(r.filtro.funcion.nombre, 'issuehistory')
  for (const jql of [mineJql(7), projectJql('ENG', 3), relatedJql('ENG-7'), sampleQuery('ENG')]) {
    assert(parseJql(jql).ok, 'la plantilla se entiende: ' + jql)
  }
  eq(parseJql('project = ENG').orden, null, 'sin ORDER BY no hay orden')
  eq(parseJql('ORDER BY updated ASC').filtro, null, 'sólo ORDER BY es una consulta sin filtro')
})

test('parseJql: campo, función u operador que esta Jira no tiene → el mensaje que devolvería el servidor', () => {
  eq(parseJql('foo = 1').errorMessages, ["Field 'foo' does not exist or you do not have permission to view it."])
  eq(parseJql('issuekey in loQueSea()').errorMessages, ["Unable to find JQL function 'loQueSea()'."])
  assert(/does not exist/.test(parseJql('project = ENG ORDER BY fecha').errorMessages[0]), 'ni para ordenar')
  assert(/no está admitido/.test(parseJql('status != Done').errorMessages[0]), 'los operadores son lista blanca')
  assert(/falta cerrar un paréntesis/.test(parseJql('(project = ENG').errorMessages[0]))
  assert(/sobra/.test(parseJql('project = ENG ENG').errorMessages[0]))
  assert(/falta un operador/.test(parseJql('project').errorMessages[0]))
})

test('parseJql: «campo in función()» sólo vale sobre issuekey o issue', () => {
  assert(parseJql('issuekey in watchedIssues()').ok)
  assert(parseJql('issue in linkedIssues(ENG-7)').ok)
  const r = parseJql('project in watchedIssues()')
  eq(r.ok, false)
  assert(/Field 'project' does not exist/.test(r.errorMessages[0]), r.errorMessages[0])
  assert(/sólo admite una función/.test(parseJql('issuekey in ENG-7').errorMessages[0]))
})

// ---------------------------------------------------------------------------
// runJql sobre la fixture
// ---------------------------------------------------------------------------

test('la fixture del banco tiene dos proyectos, claves únicas y la ENG-7 del banco', () => {
  const keys = FIXTURE.issues.map((i) => i.key)
  eq(keys.length, 40)
  eq(new Set(keys).size, 40, 'ninguna clave repetida')
  assert(keys.includes('ENG-7'), 'la incidencia del fixture «issue:ENG-7» del banco está en la lista')
  eq(new Set(keys.map((k) => k.split('-')[0])), new Set(['ENG', 'OPS']))
  for (const i of FIXTURE.issues) {
    assert(typeof i.updatedHoursAgo === 'number', `${i.key} dice cuántas horas hace que cambió`)
    assert(i.lastViewedHoursAgo === null || typeof i.lastViewedHoursAgo === 'number', `${i.key}: lastViewed es número o nada`)
    assert(['new', 'indeterminate', 'done'].includes(i.statusCategory), `${i.key}: categoría de estado de las de Jira`)
  }
})

test('runJql: las plantillas devuelven lo suyo y en su orden', () => {
  eq(claves(historyJql()), ['ENG-7', 'OPS-2', 'ENG-12', 'ENG-3', 'ENG-20'], 'lo que has mirado, lo último primero')
  eq(claves(relatedJql('ENG-7')), ['ENG-3', 'ENG-12'], 'linkedIssues es simétrico y no se devuelve a sí misma')
  eq(claves(relatedJql('eng-7')), ['ENG-3', 'ENG-12'], 'sin distinguir mayúsculas')
  eq(claves(projectJql('OPS', 30)).length, 11, 'del proyecto y de los últimos 30 días: todas menos la de hace 900 horas')
  eq(claves(sampleQuery('ENG')).length, 28)
  const mias = claves(mineJql(7))
  assert(mias.includes('ENG-12') && mias.includes('ENG-7') && mias.includes('OPS-4'), 'asignadas, informadas y seguidas')
  assert(!mias.includes('ENG-15'), 'lo tuyo de hace semanas queda fuera de la ventana')
})

test('runJql: las cláusulas de los chips (estado, tipo, componente, etiqueta, épica, sprint, sin resolver)', () => {
  eq(claves('project = ENG AND status = "In Review" ORDER BY updated DESC'), ['ENG-7', 'ENG-2', 'ENG-22', 'ENG-14'])
  eq(claves('project = ENG AND issuetype = "API Definition" ORDER BY key ASC').length, 4)
  eq(claves('component = "Operación" ORDER BY key ASC').length, 12)
  eq(claves('labels = federacion'), ['ENG-7'])
  eq(claves("'Epic Link' = ENG-1").length, 18)
  eq(claves('sprint = "Sprint 41" ORDER BY key ASC'), ['ENG-23', 'ENG-3'])
  eq(claves('parent = ENG-2 ORDER BY key ASC'), ['ENG-11', 'ENG-26'])
  assert(!claves('project = OPS AND resolution = Unresolved').includes('OPS-1'), 'lo resuelto no está sin resolver')
})

test('runJql: AND, OR y paréntesis; y una condición que esta Jira no sabe evaluar es 400, no una lista vacía', () => {
  eq(claves('project = ENG AND labels = cache'), ['ENG-12'])
  eq(claves('(labels = cache OR labels = federacion) ORDER BY key ASC'), ['ENG-12', 'ENG-7'])
  eq(claves('project = ENG AND project = OPS'), [], 'una condición imposible es una lista vacía, no un error')
  const raro = runJql(FIXTURE.issues, 'updated >= 2026-01-01', USUARIO)
  eq(raro.ok, false)
  assert(/no sabe evaluar/.test(raro.errorMessages[0]), raro.errorMessages[0])
})

test('horasDe entiende las ventanas relativas y nada más', () => {
  eq(horasDe('-7d'), 168)
  eq(horasDe('-12h'), 12)
  eq(horasDe('-2w'), 336)
  eq(horasDe('7d'), null, 'sin signo no es una ventana hacia atrás')
  eq(horasDe('-7'), null)
  eq(horasDe(''), null)
})

test('casa: una incidencia suelta contra un filtro ya analizado', () => {
  const issue = { key: 'ENG-7', status: 'In Review', type: 'Bug', labels: ['x'], components: [], updatedHoursAgo: 10, history: true }
  const ctx = { user: 'marco', enlazadas: new Set() }
  eq(casa(issue, parseJql('project = ENG').filtro, ctx), true)
  eq(casa(issue, parseJql('project = OPS').filtro, ctx), false)
  eq(casa(issue, parseJql('updated >= -7d').filtro, ctx), true)
  eq(casa(issue, parseJql('updated <= -7d').filtro, ctx), false)
  eq(casa(issue, null, ctx), true, 'sin filtro casa todo')
})

// ---------------------------------------------------------------------------
// La forma de la respuesta: lo que el cliente de verdad va a leer
// ---------------------------------------------------------------------------

test('searchResponse devuelve la forma de Jira y respeta fields, maxResults y startAt', () => {
  const r = searchResponse(FIXTURE, { jql: sampleQuery('ENG'), fields: SEARCH_FIELDS.join(','), maxResults: 3, startAt: 0 })
  eq(r.status, 200)
  eq(Object.keys(r.body).sort(), ['expand', 'issues', 'maxResults', 'startAt', 'total'])
  eq(r.body.total, 28, 'el total es el de la consulta entera, no el de la página')
  eq(r.body.issues.length, 3)
  eq(Object.keys(r.body.issues[0].fields).sort(), [...SEARCH_FIELDS].sort(), 'sólo los campos pedidos')
  const segunda = searchResponse(FIXTURE, { jql: sampleQuery('ENG'), fields: SEARCH_FIELDS.join(','), maxResults: 3, startAt: 3 })
  eq(segunda.body.startAt, 3)
  assert(segunda.body.issues[0].key !== r.body.issues[0].key, 'startAt mueve la ventana')
})

test('searchResponse: una consulta que no se entiende es 400 con errorMessages, como Jira', () => {
  const r = searchResponse(FIXTURE, { jql: 'foo = 1', maxResults: 5 })
  eq(r.status, 400)
  eq(Object.keys(r.body).sort(), ['errorMessages', 'errors'])
  eq(r.body.errorMessages, ["Field 'foo' does not exist or you do not have permission to view it."])
})

test('issueJson: los campos van con la forma que lee parseSearchIssues, y sin pedirlos no vienen', () => {
  const eng7 = FIXTURE.issues.find((i) => i.key === 'ENG-7')
  const f = issueJson(eng7, SEARCH_FIELDS, { people: FIXTURE.people, now: Date.UTC(2026, 8, 20) }).fields
  eq(f.issuetype.name, 'API Definition')
  eq(f.status.name, 'In Review')
  eq(f.status.statusCategory.key, 'indeterminate')
  eq(f.assignee.displayName, 'Ana Pérez')
  eq(f.components.map((c) => c.name), ['API', 'Backend'])
  assert(/^\d{4}-\d{2}-\d{2}T/.test(f.updated), 'la fecha va en ISO, como la devuelve Jira: ' + f.updated)
  eq(issueJson(eng7, ['summary'], {}).fields, { summary: eng7.summary }, 'sólo lo pedido')
  eq(Object.keys(issueJson(eng7, [], {}).fields).sort(), [...CAMPOS_POR_DEFECTO].sort(), 'sin pedir nada, los de siempre')
  // Sin catálogo (H14) el nombre es el de la fixture y el id va vacío: es lo que
  // devolvería una instancia que no diera los ids, y lo que dejaba esta Jira de
  // mentira antes del hito.
  eq(f.issuetype.id, '')
  eq(f.status.id, '')
})

test('lo que contesta el banco lo entiende el cliente de verdad: searchResponse → parseSearchIssues', () => {
  // Es el contrato entre la Jira falsa y src/shared/jira-rest.js: si el
  // servidor del banco cambia de forma, esta prueba cae en Node y no en el Jira
  // del usuario.
  const r = searchResponse(FIXTURE, { jql: historyJql(), fields: SEARCH_FIELDS.join(','), maxResults: 30 })
  const issues = parseSearchIssues(r.body)
  assert(Array.isArray(issues), 'la respuesta tiene la forma esperada')
  eq(issues.map((i) => i.key), ['ENG-7', 'OPS-2', 'ENG-12', 'ENG-3', 'ENG-20'])
  const eng7 = issues[0]
  eq(eng7.summary, '[API] Definición del endpoint de consentimiento')
  eq(eng7.type, 'API Definition')
  eq(eng7.status, 'In Review')
  eq(eng7.statusCategory, 'indeterminate')
  eq(eng7.assignee, { name: 'ana', displayName: 'Ana Pérez' })
  eq(eng7.components, ['API', 'Backend'])
  assert(eng7.updatedAt > 0 && eng7.lastViewedAt > 0, 'las fechas llegan como número')
})

// ---------------------------------------------------------------------------
// H14: los ids, y que un nombre traducido no vale
// ---------------------------------------------------------------------------

test('H14: el catálogo cubre todos los valores que usa la fixture, con su id', () => {
  // Si un tipo o un estado de una incidencia no está en el catálogo, la API falsa
  // lo devolvería sin id y el perfil contado aquí no se parecería al del Jira
  // real: el chip volvería a preguntar por el nombre.
  const catalogo = fieldCatalog(FIXTURE)
  eq(Object.keys(catalogo).sort(), ['issuetype', 'priority', 'status'])
  const campos = { issuetype: 'type', status: 'status', priority: 'priority' }
  for (const [campo, propiedad] of Object.entries(campos)) {
    const ids = new Set()
    for (const e of catalogo[campo]) {
      assert(/^\d{1,19}$/.test(e.id), `${campo} «${e.name}» necesita un id numérico: ${JSON.stringify(e)}`)
      assert(!ids.has(e.id), `dos ${campo} con el id ${e.id}`)
      ids.add(e.id)
    }
    for (const issue of FIXTURE.issues) {
      const valor = issue[propiedad]
      assert(
        catalogo[campo].some((e) => e.name.toLowerCase() === String(valor).toLowerCase()),
        `${issue.key}: ${campo} «${valor}» no está en el catálogo`
      )
    }
  }
  // Y al menos un tipo, un estado y una prioridad TRADUCIDOS: sin ellos, el
  // tramo del selfcheck que prueba el 400 no probaría nada. Las prioridades
  // llevaban el nombre en español como nombre de JQL, y la Jira de mentira
  // aceptaba `priority = "Crítica"`, que en el Jira real es un 400 (revisión
  // adversaria de H14).
  for (const campo of ['issuetype', 'status', 'priority']) {
    assert(catalogo[campo].some((e) => e.display && e.display !== e.name), `${campo} necesita un valor traducido`)
  }
  eq(fieldValue(catalogo, 'issuetype', 'Task'), { id: '10002', name: 'Tarea' }, 'la API devuelve el nombre traducido')
  eq(fieldValue(catalogo, 'status', 'In Review'), { id: '10000', name: 'In Review' }, 'y el de siempre si no se traduce')
  eq(fieldValue(catalogo, 'priority', 'Critical'), { id: '1', name: 'Crítica' }, 'la prioridad también viene traducida')
  eq(fieldValue(catalogo, 'status', 'No existe'), { id: '', name: 'No existe' }, 'lo que no está en el catálogo pasa sin id')
  eq(fieldCatalog({}), { issuetype: [], status: [], priority: [] }, 'sin catálogo, listas vacías y nada más')
})

test('H14: la API falsa devuelve el nombre traducido con su id, y JQL sólo acepta el id', () => {
  // Es el hallazgo que abre este hito, fingido tal cual: lo que la API DEVUELVE no
  // sirve para volver a preguntar, y el id sí.
  const r = searchResponse(FIXTURE, { jql: 'project = ENG AND issuetype = Task ORDER BY key ASC', fields: SEARCH_FIELDS.join(','), maxResults: 30 })
  eq(r.status, 200)
  const filas = parseSearchIssues(r.body)
  assert(filas.length > 0)
  eq(filas[0].type, 'Tarea', 'la API contesta con el nombre que ve el usuario')
  eq(filas[0].typeId, '10002', 'y con su id')
  assert(
    filas.every((f) => f.typeId === '10002' && /^\d+$/.test(f.statusId) && /^\d+$/.test(f.priorityId)),
    'cada fila trae los tres ids: ' + JSON.stringify(filas[0])
  )

  // Por el nombre traducido —el que la extensión acaba de leer— es un 400 con el
  // mensaje del servidor, que es lo que el panel enseña tal cual.
  const rechazada = searchResponse(FIXTURE, { jql: 'project = ENG AND issuetype = "Tarea"', maxResults: 5 })
  eq(rechazada.status, 400)
  eq(rechazada.body.errorMessages, ["El valor 'Tarea' no existe para el campo 'issuetype'."])
  eq(searchResponse(FIXTURE, { jql: 'status = "En progreso"', maxResults: 5 }).body.errorMessages, ["El valor 'En progreso' no existe para el campo 'status'."])
  // Y la prioridad traducida igual: en el Jira real `priority = "Crítica"` es un
  // 400 (revisión adversaria de H14: la fixture la aceptaba).
  eq(searchResponse(FIXTURE, { jql: 'priority = "Crítica"', maxResults: 5 }).body.errorMessages, ["El valor 'Crítica' no existe para el campo 'priority'."])
  eq(searchResponse(FIXTURE, { jql: 'project = ENG AND status = Listo' }).status, 400, 'también sin comillas')

  // Por id, lo mismo que por el nombre de JQL, exactamente.
  const porId = claves('project = ENG AND issuetype = 10002 ORDER BY key ASC', CON_CATALOGO)
  eq(porId, claves('project = ENG AND issuetype = Task ORDER BY key ASC', CON_CATALOGO), 'el id y el nombre de JQL son la misma consulta')
  assert(porId.length > 0)
  eq(
    claves('project = ENG AND status = 3 ORDER BY key ASC', CON_CATALOGO),
    claves('project = ENG AND status = "In Progress" ORDER BY key ASC', CON_CATALOGO)
  )
  eq(claves('priority = 1 ORDER BY key ASC', CON_CATALOGO), claves('priority = "Critical" ORDER BY key ASC', CON_CATALOGO))
  assert(claves('priority = 1 ORDER BY key ASC', CON_CATALOGO).length > 0, 'y hay incidencias críticas en la fixture')
  // Y `ORDER BY priority` ordena por el nombre de JQL de la fixture, de la más
  // alta a la más baja: con la lista de prioridades todavía en español ninguna
  // casaba y el orden era el de llegada (mutación que sobrevivió en la revisión
  // adversaria de H14).
  const RANGO = { Critical: 3, High: 2, Medium: 1, Low: 0 }
  const porPrioridad = runJql(FIXTURE.issues, 'project = ENG ORDER BY priority DESC', { user: 'marco' }).issues.map((i) => i.priority)
  assert(new Set(porPrioridad).size >= 3, 'la fixture tiene al menos tres prioridades distintas en ENG')
  for (let i = 1; i < porPrioridad.length; i++) {
    assert(RANGO[porPrioridad[i - 1]] >= RANGO[porPrioridad[i]], `«${porPrioridad[i - 1]}» no puede ir detrás de «${porPrioridad[i]}»`)
  }
  eq(porPrioridad[0], 'Critical', 'la más alta primero')
  // Un valor que no existe en ninguna parte sigue dando lista vacía, como hasta
  // ahora: esta Jira de mentira no sabe qué valores existen «en general».
  eq(claves('project = ENG AND status = "Ni existe"', CON_CATALOGO), [])
  // Y sin catálogo se comporta como antes de H14: el nombre de la fixture manda y
  // el id no significa nada.
  eq(runJql(FIXTURE.issues, 'project = ENG AND issuetype = "Tarea"', { user: 'marco' }).issues, [])
  assert(runJql(FIXTURE.issues, 'project = ENG AND issuetype = Task', { user: 'marco' }).issues.length > 0)
})

test('los filtros favoritos y los enlaces remotos de la fixture tienen la forma que se parsea', () => {
  eq(FIXTURE.filters.map((f) => f.id), ['10100', '10200'])
  for (const f of FIXTURE.filters) {
    assert(/^\d+$/.test(f.id) && f.name && f.jql, 'id numérico, nombre y consulta: ' + JSON.stringify(f))
    assert(runJql(FIXTURE.issues, f.jql, USUARIO).ok, 'el filtro guardado se puede ejecutar: ' + f.jql)
  }
  const links = FIXTURE.remoteLinks['ENG-7']
  eq(links.length, 2)
  assert(/pageId=301/.test(links[0].globalId), 'el enlace a Confluence señala la página por id')
  eq(links[0].application.type, 'com.atlassian.confluence')
  eq(links[1].application.type, 'com.atlassian.bitbucket', 'y uno que no es de Confluence, para que se descarte')
  // H14: la fixture tiene la forma REAL, y en el Jira real el título de un enlace
  // remoto a Confluence es «Page» (el nombre del TIPO de enlace). Que lo tenga es
  // lo que hace que el tramo 48 del banco pruebe algo: si alguien lo «arregla»
  // poniendo aquí el título de la página, la comprobación pasa sin comprobar nada.
  eq(links[0].relationship, 'mentioned in')
  eq(links[0].object.title, 'Page')
  // La URL sale vacía porque en la fixture es el marcador `PAGINA_301`, que la
  // monta el servidor al contestar; lo que se comprueba aquí es el título.
  eq(parseRemoteLinks(links), [{ pageId: '301', title: '', url: '' }], 'el título genérico no llega como título')
})

// ----------------------------------- la Confluence de mentira del banco (H14)
//
// Vive en tools/cql-eval.mjs justo para poder ejercitarla desde aquí: mientras
// estuvo dentro de tools/serve-harness.js, que abre un servidor al importarlo, el
// banco podía contestar con una forma que el Confluence real no devuelve y la
// autocomprobación pasaba en verde.

test('H14: el árbol del espacio se sirve por fecha, con antepasados y con totalSize', () => {
  const cql = spaceCql('ENG')
  const p1 = contentSearch(cql, { start: 0, limit: 5 })
  eq(p1.results.length, 5)
  eq(p1.size, 5)
  eq(p1.totalSize, Object.keys(PAGE).length, 'cuántas hay en el espacio, no cuántas vinieron')
  assert(!!p1._links.next, 'y dice que hay más')
  // Las más recientes primero: es lo que H14 vino a arreglar, porque la lista las
  // da en orden ascendente de id, o sea las más viejas (F8).
  const horas = p1.results.map((r) => metaDe(r.id).horas)
  eq(horas, [...horas].sort((a, b) => a - b), 'ordenadas por lastmodified DESC')
  // Cada resultado trae su cadena ENTERA, que es lo que permite que el árbol no
  // salga desmigajado aunque los padres no estén entre las recientes.
  const profunda = contentSearch(cql, { start: 0, limit: 20 }).results.find((r) => r.id === '1086')
  eq(profunda.ancestors.map((a) => a.id), ['1', '1080', '1081', '1082', '1083', '1084', '1085'])
  assert(!('space' in profunda), 'con expand=ancestors el Confluence real no expande el espacio')
  // Se pagina con el `start` que manda el cliente, y los trozos no se solapan.
  const p2 = contentSearch(cql, { start: 5, limit: 5 })
  eq(p2.start, 5)
  eq(p2.results.filter((r) => p1.results.some((x) => x.id === r.id)), [])
  eq(contentSearch(spaceCql('OTRO'), { limit: 5 }).results, [], 'de otro espacio no hay nada')
  // Y por la misma ruta siguen contestando las consultas de H7.
  eq(contentSearch(viewedCql(3), {}).results.length, 3, 'lo que viste')
  assert(contentSearch('type=page AND title~"Arqui*"', {}).results.length > 0, 'y la búsqueda por título')
})

test('H14: lo que contesta el banco lo entiende parseSpaceSearch, y la lista sigue dando la portada', () => {
  const p = parseSpaceSearch(contentSearch(spaceCql('ENG'), { start: 0, limit: 6 }), { wikiPrefix: '/wiki', spaceKey: 'ENG' })
  eq(p.groups.length, 6)
  eq(p.total, Object.keys(PAGE).length)
  eq(p.next, true)
  for (const grupo of p.groups) {
    eq(grupo[0].parentId, null, 'cada cadena empieza en una raíz')
    for (let i = 1; i < grupo.length; i++) eq(grupo[i].parentId, grupo[i - 1].id, 'y cada eslabón cuelga del anterior')
    for (const pagina of grupo) {
      eq(pagina.spaceKey, 'ENG')
      assert(pagina.url.startsWith('/wiki/spaces/ENG/pages/'), pagina.url)
    }
  }
  // La portada sigue saliendo de la LISTA de siempre, que es la que sabe
  // expandirla, y con una sola página basta.
  const lista = spaceContent({ spaceKey: 'ENG', start: 0, limit: 1 })
  eq(lista.results.length, 1)
  eq(parseSpacePages(lista, '/wiki').homeId, '1')
})
