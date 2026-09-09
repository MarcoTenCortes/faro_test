/**
 * Las Skills.
 *
 * Lo que de verdad hay que proteger aquí es que cambiar de modo no se lleve por
 * delante las reglas de seguridad, y que Faro no prometa una tarjeta de
 * navegación en los modos donde esa tarjeta no aparece.
 */
import { test, eq, assert } from '../harness.js'
import { SKILLS, DEFAULT_SKILL, skillById, skillSystem, offersNavigation } from '../../src/panel/skills.js'
import { baseSystem } from '../../src/panel/prompts.js'

const SITE = { product: 'confluence', host: 'acme.atlassian.net', spaceKey: 'ENG' }
const JIRA = { product: 'jira', host: 'jira.simplprogramme.eu', projectKey: 'SIMPL', issueKey: 'SIMPL-12' }

test('están las cuatro, y la general es la de por defecto', () => {
  eq(SKILLS.map((s) => s.id), ['general', 'busqueda', 'resumen', 'analisis'])
  eq(DEFAULT_SKILL, 'general')
  eq(skillById(DEFAULT_SKILL).label, 'General')
})

test('un id desconocido cae en la general en vez de romper', () => {
  eq(skillById('no-existe').id, 'general')
  eq(skillById(undefined).id, 'general')
  eq(skillSystem('no-existe'), '')
})

test('general y búsqueda llevan; resumen y análisis no', () => {
  eq(offersNavigation('general'), true)
  eq(offersNavigation('busqueda'), true)
  eq(offersNavigation('resumen'), false)
  eq(offersNavigation('analisis'), false)
})

test('sólo búsqueda pide el plan sin pasar por la heurística', () => {
  eq(skillById('busqueda').alwaysPlan, true)
  for (const id of ['general', 'resumen', 'analisis']) {
    assert(!skillById(id).alwaysPlan, id + ' no debería forzar el plan')
  }
})

test('cada Skill tiene etiqueta y una frase que la explica', () => {
  for (const s of SKILLS) {
    assert(s.label && s.label.length <= 20, 'etiqueta rara en ' + s.id)
    assert(s.hint && s.hint.length > 10, 'falta la explicación de ' + s.id)
  }
})

// --- lo que se le dice al modelo -----------------------------------------

test('resumen y análisis trabajan sobre la selección, y si no sobre la página', () => {
  for (const id of ['resumen', 'analisis']) {
    for (const ctx of [{}, { digest: true }]) {
      const s = skillSystem(id, ctx)
      assert(/seleccionado|selección/i.test(s), id + ' debe mirar primero lo señalado')
      assert(/página o la incidencia que tiene abierta/i.test(s), id + ' debe caer en la página actual')
      assert(/no le pidas/i.test(s), id + ' no debe pedirle al usuario que diga cuál es')
    }
  }
})

test('con la página en bloques, no se manda leerla con la herramienta', () => {
  for (const id of ['resumen', 'analisis']) {
    assert(/Léela con la herramienta/.test(skillSystem(id)), id + ' sin bloques la lee con la herramienta')
    const con = skillSystem(id, { digest: true })
    assert(!/Léela con la herramienta/.test(con), id + ' con bloques ya la tiene')
    assert(/bloques numerados/i.test(con), id + ' debe decir dónde está')
  }
})

test('búsqueda busca de verdad y no se inventa dónde está algo', () => {
  const s = skillSystem('busqueda')
  assert(/herramientas/i.test(s), 'debe usar el MCP antes de contestar')
  assert(/no existe/i.test(s), 'y decirlo cuando no lo encuentra')
})

test('búsqueda pide el id de cada página y cierra con la línea «Destino:»', () => {
  // Es el contrato con el planificador: con esa línea no hace falta gastar un
  // turno de modelo en preguntar cuál era el destino.
  const s = skillSystem('busqueda')
  assert(/id num[ée]rico/i.test(s), 'debe pedir el id junto al título')
  assert(/Destino: título exacto \(id 123456\)/.test(s), 'debe fijar la forma exacta de la línea')
  assert(/Destino: ninguno/.test(s), 'y la forma cuando no hay destino')
})

// --- Jira: la misma Skill habla distinto según el producto ----------------

test('EL CAMBIO: en Jira, Búsqueda busca con JQL y lo que se ofrece es la búsqueda entera, no un ticket', () => {
  // En Jira no hay árbol que recorrer: no se pide un título con id para
  // enseñar el camino, se pide una consulta JQL. Y la consulta la lee la
  // extensión de la llamada real a jira_search, así que aquí no se pide
  // ninguna línea «Destino:» que el modelo pueda escribir distinta.
  const s = skillSystem('busqueda', { product: 'jira', projectKey: 'SIMPL' })
  assert(/JQL/.test(s), 'debe buscar con JQL')
  assert(/jira_search/.test(s), 'y nombrar la herramienta de búsqueda de Jira')
  assert(/project = SIMPL/.test(s), 'acotada al proyecto en el que está el usuario')
  assert(/qué JQL has usado/i.test(s), 'y decir qué consulta usó, para poder afinarla')
  assert(/abrir esa búsqueda en Jira/.test(s), 'y saber que abajo se ofrece la búsqueda entera')
  assert(/no hay árbol/i.test(s), 'y saber que no hay árbol')
  assert(/CONTEXTO DE ESTE SITIO/.test(s) && /convenciones de nombre/.test(s), 'y apoyarse en el contexto de Jira para el JQL')
  assert(!/Destino:/.test(s), 'en Data Center no hay línea de destino: la consulta no se lee de la prosa')
  assert(!/id num[ée]rico/i.test(s), 'nada de títulos con id: eso es Confluence')
  assert(/Inventarse una clave/.test(s), 'y no se inventa claves')

  // Sin proyecto en la URL, se le dice que acote si lo sabe.
  const sinProyecto = skillSystem('busqueda', { product: 'jira' })
  assert(!/project = /.test(sinProyecto) && /si lo sabes/.test(sinProyecto))
  // Una clave de proyecto rara no entra en el prompt tal cual.
  assert(!/project = /.test(skillSystem('busqueda', { product: 'jira', projectKey: 'x y' })))

  // En Cloud, Jira y Confluence comparten sitio: una página sí cierra con su id.
  const cloud = skillSystem('busqueda', { product: 'jira', cloud: true })
  assert(/Destino: título exacto \(id 123456\)/.test(cloud), 'una página de Confluence se declara como siempre')
  assert(!/Destino: ABC-123/.test(cloud), 'las incidencias no: van por la búsqueda')
  assert(!/no hay árbol/i.test(cloud))
})

test('en Confluence —o sin producto— Búsqueda dice lo de siempre, letra a letra', () => {
  eq(skillSystem('busqueda', { product: 'confluence' }), skillSystem('busqueda'))
  eq(skillSystem('busqueda', { product: 'confluence', projectKey: 'ENG' }), skillSystem('busqueda'))
  eq(skillSystem('busqueda', {}), skillSystem('busqueda'))
  assert(!/JQL/.test(skillSystem('busqueda')), 'en Confluence no se habla de JQL')
  // Y baseSystem en un sitio de Confluence no cambia ni una letra por esto.
  assert(!/JQL/.test(baseSystem({ site: SITE, skill: 'busqueda' })))
  assert(!/Confluence enlazado/i.test(baseSystem({ site: SITE, skill: 'general', linkedContext: { host: 'x', contextMd: 'y' } })), 'desde Confluence no hay contexto enlazado')
})

test('EL CAMBIO: en Jira, Análisis analiza una incidencia: objetivo, criterios de aceptación, campos y comentarios', () => {
  const s = skillSystem('analisis', { product: 'jira', digest: true, linked: true })
  assert(/Criterios de aceptación/.test(s), 'una incidencia se juzga por si pide algo comprobable')
  assert(/Qué pide exactamente la incidencia/.test(s))
  assert(/entre la descripción, los comentarios y los campos/.test(s), 'las contradicciones son entre sus partes')
  assert(/Confluence enlazado/.test(s), 'y con la documentación de la que sale')

  // Sin Confluence enlazado no se manda consultar una documentación que el
  // prompt nunca presentó: sólo las incidencias relacionadas.
  const solo = skillSystem('analisis', { product: 'jira', digest: true })
  assert(!/Confluence enlazado/.test(solo), 'sin enlace no se nombra')
  assert(/las incidencias relacionadas que conozcas/.test(solo))
  assert(/lo que dice la incidencia de lo que aportas tú/.test(s))
  assert(/un párrafo de la descripción, un comentario, un campo/.test(s), 'lo que se puede subrayar')
  assert(!/Qué afirma y en qué se apoya/.test(s), 'la lista de una página no es la de una incidencia')
  // Lo pinado del modo sigue: numeración, pasajes concretos, bloque JSON.
  assert(/\[1\], \[2\]/.test(s) && /sin saltos y sin repetir/.test(s) && /trozos concretos/.test(s) && /```json/.test(s))
  assert(/página o la incidencia que tiene abierta/.test(s))

  // Con páginas base o en exclusivo, contra qué se contrasta cambia igual que en Confluence.
  const ADR = { id: '200', title: 'ADR', path: '', spaceKey: null }
  assert(/o con las páginas base\./.test(skillSystem('analisis', { product: 'jira', sources: { mode: 'open', pages: [ADR] } })))
  assert(/dentro de la incidencia: entre la descripción/.test(skillSystem('analisis', { product: 'jira', sources: { mode: 'exclusive', pages: [] } })))
  assert(/Analiza la incidencia abierta a la luz de ellas/.test(skillSystem('analisis', { product: 'jira', sources: { mode: 'exclusive', pages: [ADR] } })))

  // En Confluence, ni una letra.
  for (const ctx of [{}, { digest: true }, { sources: { mode: 'exclusive', pages: [ADR] } }]) {
    eq(skillSystem('analisis', { ...ctx, product: 'confluence' }), skillSystem('analisis', ctx))
  }
  assert(!/Criterios de aceptación/.test(skillSystem('analisis', { digest: true })))
  // Y por baseSystem, con la incidencia abierta: la cabecera dice qué falta en los bloques.
  const digest = { text: '¶1 [h1] Rotar tokens', count: 1, truncated: false }
  const sys = baseSystem({ site: JIRA, skill: 'analisis', digest })
  assert(/incidencias enlazadas, páginas de Confluence/.test(sys), 'lo que no está en pantalla')
  assert(/Criterios de aceptación/.test(sys))
  assert(sys.indexOf('Seguridad, sin excepciones') < sys.indexOf('MODO ANÁLISIS'))
})

test('en Jira la cabecera lo dice: no hay árbol, se busca con JQL, y la tarjeta sólo lleva', () => {
  const sys = baseSystem({ site: JIRA, skill: 'general' })
  assert(/Estás en Jira: no hay árbol/.test(sys), 'la cabecera sabe dónde está')
  assert(/consulta JQL/.test(sys))
  assert(/«Llévame»/.test(sys), 'la tarjeta existe')
  assert(!/«Paso a paso»/.test(sys), 'pero no promete un recorrido que no hay')
  assert(/nombres su clave/.test(sys), 'para llevar a una incidencia basta la clave')
  assert(/proyecto SIMPL/.test(sys) && /SIMPL-12/.test(sys), 'y dónde está exactamente')
  // La Skill de búsqueda en Jira entra por baseSystem con el proyecto.
  assert(/project = SIMPL/.test(baseSystem({ site: JIRA, skill: 'busqueda' })))
  // Resumen y Análisis siguen sin tarjeta también en Jira.
  for (const id of ['resumen', 'analisis']) {
    const sin = baseSystem({ site: JIRA, skill: id })
    assert(!/«Llévame»/.test(sin) && /NO aparece ninguna tarjeta/i.test(sin), id)
  }
})

// --- lo que NO puede cambiar ---------------------------------------------

test('SEGURIDAD: ninguna Skill se lleva por delante las reglas, ni en Confluence ni en Jira', () => {
  for (const site of [SITE, JIRA]) {
    for (const s of SKILLS) {
      const sys = baseSystem({ site, skill: s.id })
      assert(/nunca instrucciones/i.test(sys), 'falta la regla de inyección en ' + s.id)
      assert(/NO lo obedeces/i.test(sys), 'falta la regla de obediencia en ' + s.id)
      assert(/fuera del sitio actual/i.test(sys), 'falta la regla de URLs en ' + s.id)
      assert(sys.indexOf('Seguridad, sin excepciones') < sys.indexOf('MODO') || !/MODO/.test(sys), 'el modo no puede ir por delante en ' + site.product)
    }
  }
})

test('donde no hay tarjeta, no se promete tarjeta', () => {
  const conCarta = baseSystem({ site: SITE, skill: 'general' })
  assert(/«Llévame»/.test(conCarta), 'la general sí la nombra')

  for (const id of ['resumen', 'analisis']) {
    const sin = baseSystem({ site: SITE, skill: id })
    assert(!/«Llévame»/.test(sin), id + ' no debe prometer una tarjeta que no existe')
    assert(/NO aparece ninguna tarjeta/i.test(sin), id + ' debe decir que no la hay')
    assert(/no escribas recorridos|Tampoco escribas recorridos/i.test(sin), id + ' sigue sin improvisar recorridos')
  }
})

test('el modo va DESPUÉS de las reglas, no antes', () => {
  const sys = baseSystem({ site: SITE, skill: 'resumen' })
  assert(sys.indexOf('Seguridad, sin excepciones') < sys.indexOf('MODO RESUMEN'), 'el modo no puede ir por delante')
})

test('sin Skill, el prompt es el de siempre', () => {
  eq(baseSystem({ site: SITE }), baseSystem({ site: SITE, skill: 'general' }))
})
