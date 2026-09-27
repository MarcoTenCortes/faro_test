/**
 * La regla que decide si el fallo de una lectura REST se le dice al usuario.
 *
 * La revisión adversaria de H8 mutó esta regla cuando vivía dentro de panel.js
 * —la tregua devolviendo siempre false, la clave sin el motivo, el primer aviso
 * tragado— y las 1069 pruebas siguieron en verde: un fallo SILENCIOSO de la
 * contraparte visible de §8.14. Aquí se ejecuta de verdad.
 */
import { test, eq, assert } from '../harness.js'
import { REST_REASON_ALWAYS, restFailureDue, jqlFailText, linksFailText } from '../../src/panel/rest-notice.js'

const HOST = 'jira.simplprogramme.eu'

test('SEGURIDAD §8.14: el PRIMER aviso de cada motivo sale siempre', () => {
  for (const motivo of ['sesion', 'red', 'cloud', 'permiso', 'forma', 'api', 'sin respuesta']) {
    eq(restFailureDue(new Set(), motivo, HOST, 'ses_1'), true, motivo)
  }
  // También sin sesión todavía (el chat vacío desde el que se pulsa un chip).
  eq(restFailureDue(new Set(), 'sesion', HOST, null), true)
  eq(restFailureDue(new Set(), 'sesion', HOST, undefined), true)
})

test('la tregua: lo que no cambia por reintentar se dice una vez por host, sesión y motivo', () => {
  const avisado = new Set()
  eq(restFailureDue(avisado, 'sesion', HOST, 'ses_1'), true)
  eq(restFailureDue(avisado, 'sesion', HOST, 'ses_1'), false, 'la segunda vez ya se dijo')
  eq(restFailureDue(avisado, 'sesion', HOST, 'ses_1'), false)
  // Otro MOTIVO es otro aviso: que la sesión no valga no tapa que luego no haya red.
  eq(restFailureDue(avisado, 'red', HOST, 'ses_1'), true)
  eq(restFailureDue(avisado, 'red', HOST, 'ses_1'), false)
  // Otra SESIÓN y otro HOST vuelven a avisar.
  eq(restFailureDue(avisado, 'sesion', HOST, 'ses_2'), true)
  eq(restFailureDue(avisado, 'sesion', 'jira.otro.example', 'ses_1'), true)
  eq(avisado.size, 4, 'una clave por host · sesión · motivo, y nada más')
})

test('un 400 habla de ESA consulta: se dice cada vez y no gasta tregua', () => {
  eq([...REST_REASON_ALWAYS], ['jql'])
  assert(Object.isFrozen(REST_REASON_ALWAYS))
  const avisado = new Set()
  for (let i = 0; i < 3; i++) eq(restFailureDue(avisado, 'jql', HOST, 'ses_1'), true, 'vuelta ' + i)
  eq(avisado.size, 0)
})

test('sin dónde apuntar se avisa: el lado seguro del error es decirlo', () => {
  for (const raro of [null, undefined, [], {}, 'no soy un Set']) eq(restFailureDue(raro, 'sesion', HOST, 'ses_1'), true)
  // Un motivo raro no lanza y lleva su propia tregua.
  const avisado = new Set()
  eq(restFailureDue(avisado, null, HOST, 'ses_1'), true)
  eq(restFailureDue(avisado, undefined, HOST, 'ses_1'), false, 'null y undefined son el mismo motivo vacío')
})

test('jqlFailText: el motivo en palabras del usuario, con lo que dijo el SERVIDOR cuando lo dijo', () => {
  eq(
    jqlFailText({ ok: false, reason: 'jql', status: 400, messages: ["Field 'foo' does not exist.", 'Otra cosa'] }, HOST),
    "Jira no acepta esta consulta: Field 'foo' does not exist. · Otra cosa."
  )
  eq(jqlFailText({ ok: false, reason: 'jql' }, HOST), 'Jira no acepta esta consulta: la ha rechazado sin decir por qué.')
  eq(jqlFailText({ ok: false, reason: 'jql', messages: [null, 7, ''] }, HOST), 'Jira no acepta esta consulta: la ha rechazado sin decir por qué.')
  // El de la sesión dice QUÉ HACER, y en qué sitio.
  eq(jqlFailText({ ok: false, reason: 'sesion', status: 401 }, HOST), `Tu sesión de ${HOST} no vale para su API: recarga la pestaña y vuelve a entrar.`)
  eq(jqlFailText({ ok: false, reason: 'red', detail: 'sin respuesta en 6000 ms' }, HOST), 'No he podido hablar con la API de Jira: sin respuesta en 6000 ms.')
  eq(jqlFailText({ ok: false, reason: 'red' }, HOST), 'No he podido hablar con la API de Jira: sin respuesta.')
  // Un content script viejo (o una pestaña que no contesta) devuelve null.
  eq(jqlFailText(null, HOST), 'La pestaña no ha contestado.')
  eq(jqlFailText(undefined, HOST), 'La pestaña no ha contestado.')
  eq(jqlFailText({ ok: false, reason: 'forma', detail: 'la respuesta no tiene issues' }, HOST), 'No he podido leer la lista (la respuesta no tiene issues).')
  eq(jqlFailText({ ok: false }, HOST), 'No he podido leer la lista (sin motivo).')
})

test('H25: linksFailText — por qué no se contrastó el diagrama con Jira, por motivo', () => {
  eq(linksFailText({ ok: false, reason: 'cloud' }, HOST), 'En Jira Cloud no leo relaciones por la API (todo va por el MCP).')
  eq(linksFailText({ ok: false, reason: 'claves' }, HOST), 'Hacen falta al menos dos incidencias del índice para contrastar.')
  // Jira devolvió menos de dos de las pedidas (revisión de H25, D03): cuántas y cuáles
  // no volvieron, sin culpar al índice; lo que no es una clave no se enseña.
  eq(linksFailText({ reason: 'devueltas', devueltas: 1, pedidas: 3, fuera: ['ENG-12', 'ENG-20'] }, HOST), 'Jira sólo ha devuelto 1 de las 3 incidencias pedidas (sin contrastar: ENG-12, ENG-20): una incidencia movida de proyecto vuelve con otra clave.')
  eq(linksFailText({ reason: 'devueltas', devueltas: 0, pedidas: 2, fuera: [] }, HOST), 'Jira sólo ha devuelto 0 de las 2 incidencias pedidas: una incidencia movida de proyecto vuelve con otra clave.')
  eq(linksFailText({ reason: 'devueltas', devueltas: 1, pedidas: 2, fuera: ['ENG-9', 7, '', null] }, HOST), 'Jira sólo ha devuelto 1 de las 2 incidencias pedidas (sin contrastar: ENG-9): una incidencia movida de proyecto vuelve con otra clave.')
  eq(linksFailText({ ok: false, reason: 'sesion', status: 401 }, HOST), jqlFailText({ ok: false, reason: 'sesion' }, HOST), 'la sesión, con la frase de la lista')
  eq(linksFailText({ ok: false, reason: 'sesion' }, HOST), `Tu sesión de ${HOST} no vale para su API: recarga la pestaña y vuelve a entrar.`)
  eq(linksFailText({ ok: false, reason: 'permiso' }, HOST), 'Sin acceso a la pestaña de Jira.')
  // Sin red, o una pestaña que no contesta (el `.catch(() => null)` del panel).
  eq(linksFailText({ ok: false, reason: 'red' }, HOST), 'No he podido leer las relaciones de Jira (sin respuesta).')
  eq(linksFailText({ ok: false, reason: 'red', detail: 'sin respuesta en 6000 ms' }, HOST), 'No he podido leer las relaciones de Jira (sin respuesta en 6000 ms).')
  eq(linksFailText(null, HOST), 'No he podido leer las relaciones de Jira (sin respuesta).')
  eq(linksFailText(undefined, HOST), 'No he podido leer las relaciones de Jira (sin respuesta).')
  // Un 400 enseña lo que dijo el SERVIDOR: la consulta es la plantilla, no de nadie.
  eq(
    linksFailText({ ok: false, reason: 'jql', messages: ["An issue with key 'ENG-99' does not exist for field 'issuekey'.", 7] }, HOST),
    "Jira no acepta la consulta de relaciones: An issue with key 'ENG-99' does not exist for field 'issuekey'."
  )
  eq(linksFailText({ ok: false, reason: 'jql' }, HOST), 'Jira no acepta la consulta de relaciones: la ha rechazado sin decir por qué.')
  // Lo genérico, con el detalle o el código; el rechazo del content script incluido.
  eq(linksFailText({ ok: false, reason: 'consulta no permitida' }, HOST), 'No he podido leer las relaciones de Jira (consulta no permitida).')
  eq(linksFailText({ ok: false, reason: 'forma', detail: 'la respuesta de la API no tiene la forma esperada' }, HOST), 'No he podido leer las relaciones de Jira (la respuesta de la API no tiene la forma esperada).')
  eq(linksFailText({ ok: false }, HOST), 'No he podido leer las relaciones de Jira (sin motivo).')
})
