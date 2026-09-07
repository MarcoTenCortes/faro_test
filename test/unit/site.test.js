import { test, eq, assert } from '../harness.js'
import { samePage } from '../../src/atlassian/site.js'
import { parseAtlassianUrl, describeLocation, defaultScope, wikiBase, productFromHostname } from '../../src/atlassian/site.js'

test('site: página de Confluence Cloud', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/1234567/ADR-014+Rotacion')
  eq(s.product, 'confluence')
  eq(s.spaceKey, 'ENG')
  eq(s.pageId, '1234567')
  eq(s.host, 'acme.atlassian.net')
  eq(s.cloud, true)
})

test('site: espacio de Confluence sin página', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/wiki/spaces/ENG/overview')
  eq(s.product, 'confluence')
  eq(s.spaceKey, 'ENG')
  eq(s.pageId, undefined)
})

test('site: Confluence Data Center con /display', () => {
  const s = parseAtlassianUrl('https://wiki.interno.corp/display/ARCH/Vista+general')
  eq(s.product, 'confluence')
  eq(s.spaceKey, 'ARCH')
  eq(s.cloud, false)
  eq(s.host, 'wiki.interno.corp')
})

test('site: Confluence con pageId en query', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=98765')
  eq(s.product, 'confluence')
  eq(s.pageId, '98765')
  // Un id es un número: `?pageId=abc` no señala ninguna página, ni en Cloud ni en Data Center.
  eq(parseAtlassianUrl('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=abc').pageId, undefined)
  eq(parseAtlassianUrl('https://confluence.acme.eu/pages/viewpage.action?pageId=abc').pageId, undefined)
})

test('site: incidencia de Jira por /browse', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/browse/SIMPL-4821')
  eq(s.product, 'jira')
  eq(s.issueKey, 'SIMPL-4821')
  eq(s.projectKey, 'SIMPL')
})

test('site: tablero de Jira', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/jira/software/projects/ENG/boards/42')
  eq(s.product, 'jira')
  eq(s.projectKey, 'ENG')
  eq(s.boardId, '42')
})

test('site: Jira con incidencia seleccionada en query', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/jira/software/projects/ENG/boards/42?selectedIssue=eng-9')
  eq(s.issueKey, 'ENG-9')
})

test('site: portada de un sitio cloud sin producto claro', () => {
  const s = parseAtlassianUrl('https://acme.atlassian.net/')
  eq(s.product, 'unknown')
  eq(s.host, 'acme.atlassian.net')
})

test('site: una web cualquiera no es un sitio Atlassian', () => {
  eq(parseAtlassianUrl('https://ejemplo.com/wiki'), null)
  eq(parseAtlassianUrl('no-es-una-url'), null)
  eq(parseAtlassianUrl('javascript:alert(1)'), null)
})

test('site: descripción legible de la ubicación', () => {
  const conf = parseAtlassianUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/1/X')
  assert(describeLocation(conf).includes('ENG'))
  const jira = parseAtlassianUrl('https://acme.atlassian.net/browse/AB-1')
  eq(describeLocation(jira), 'Jira · AB-1')
})

test('site: ámbito por defecto del indexador', () => {
  const conf = parseAtlassianUrl('https://acme.atlassian.net/wiki/spaces/ENG/overview')
  eq(defaultScope(conf).kind, 'space')
  eq(defaultScope(conf).key, 'ENG')
  const jira = parseAtlassianUrl('https://acme.atlassian.net/browse/AB-1')
  eq(defaultScope(jira).kind, 'project')
})

test('site: base del wiki cambia entre Cloud y Data Center', () => {
  eq(wikiBase({ cloud: true, origin: 'https://acme.atlassian.net' }), 'https://acme.atlassian.net/wiki')
  eq(wikiBase({ cloud: false, origin: 'https://wiki.interno.corp' }), 'https://wiki.interno.corp')
})

// --- Confluence Server / Data Center -------------------------------------
// Estos casos vienen de un fallo real: en confluence.simplprogramme.eu el
// parser devolvía null, el panel se quedaba sin `state.site`, y al guardar las
// claves reventaba con «Cannot read properties of null (reading 'host')».

test('DC: la ruta heredada /pages/viewpage.action', () => {
  const s = parseAtlassianUrl('https://confluence.simplprogramme.eu/pages/viewpage.action?pageId=123456')
  assert(s, 'no debería ser null')
  eq(s.product, 'confluence')
  eq(s.pageId, '123456')
  eq(s.host, 'confluence.simplprogramme.eu')
  eq(s.cloud, false)
})

test('DC: /pages/<id> sin acción', () => {
  const s = parseAtlassianUrl('https://confluence.simplprogramme.eu/pages/987654/Titulo')
  eq(s.product, 'confluence')
  eq(s.pageId, '987654')
})

test('DC: el escritorio y el login siguen siendo el sitio', () => {
  eq(parseAtlassianUrl('https://confluence.simplprogramme.eu/dashboard.action').product, 'confluence')
  eq(parseAtlassianUrl('https://confluence.simplprogramme.eu/login.action?os_destination=%2Findex.action').product, 'confluence')
})

test('DC: la portada se reconoce por el nombre del host', () => {
  const s = parseAtlassianUrl('https://confluence.simplprogramme.eu/')
  assert(s, 'la raíz de un host llamado confluence.* debe reconocerse')
  eq(s.product, 'confluence')
  eq(s.origin, 'https://confluence.simplprogramme.eu')
})

test('DC: jira.empresa.com y wiki.empresa.com', () => {
  eq(productFromHostname('jira.minsait.com'), 'jira')
  eq(productFromHostname('wiki.interno.corp'), 'confluence')
  eq(productFromHostname('confluence.simplprogramme.eu'), 'confluence')
  eq(productFromHostname('www.ejemplo.com'), null)
  eq(productFromHostname('jiraffe.com'), null)
})

test('DC: espacio y página siguen leyéndose de la query', () => {
  const s = parseAtlassianUrl('https://confluence.simplprogramme.eu/pages/viewpage.action?spaceKey=ARCH&pageId=42')
  eq(s.spaceKey, 'ARCH')
  eq(s.pageId, '42')
})

test('una web cualquiera sigue sin ser Atlassian', () => {
  eq(parseAtlassianUrl('https://ejemplo.com/'), null)
  // /pages/ a secas no basta: hace falta un id numerico o una accion.
  eq(parseAtlassianUrl('https://ejemplo.com/pages/algo'), null)
  eq(parseAtlassianUrl('https://ejemplo.com/blog/pages/estilo'), null)
  // Pero un id numerico si es una senal fuerte de Confluence.
  eq(parseAtlassianUrl('https://ejemplo.com/pages/1234/Titulo').product, 'confluence')
})

// --- ¿seguimos en la misma página? --------------------------------------
// Pasó de verdad: un análisis se preparaba durante quince segundos y al ir a
// marcarlo Faro creía que el usuario se había movido, porque Confluence había
// reescrito su propia URL mientras tanto.

const DC = 'https://confluence.simplprogramme.eu'

test('samePage: la misma página aunque Confluence reescriba su URL', () => {
  eq(samePage(DC + '/spaces/SIMPL/pages/98830281/TCV+Static', DC + '/spaces/SIMPL/pages/98830281/TCV+Static'), true)
  eq(
    samePage(
      DC + '/spaces/SIMPL/pages/98830281/TCV+Static',
      DC + '/spaces/SIMPL/pages/98830281/TCV+Static+-+Identity+Provider+Service?focusedCommentId=42'
    ),
    true,
    'cambia el slug y aparece un parámetro: sigue siendo la misma'
  )
  eq(samePage(DC + '/pages/viewpage.action?pageId=98830281', DC + '/spaces/SIMPL/pages/98830281/X'), true, 'mismo id por otra ruta')
})

test('samePage: páginas distintas son distintas', () => {
  eq(samePage(DC + '/spaces/SIMPL/pages/111/A', DC + '/spaces/SIMPL/pages/222/B'), false)
  eq(samePage(DC + '/spaces/SIMPL/pages/111/A', 'https://otro.atlassian.net/wiki/spaces/SIMPL/pages/111/A'), false, 'otro sitio')
})

test('samePage: incidencias de Jira, por su clave', () => {
  eq(samePage('https://acme.atlassian.net/browse/ENG-7', 'https://acme.atlassian.net/browse/ENG-7?filter=1'), true)
  eq(samePage('https://acme.atlassian.net/browse/ENG-7', 'https://acme.atlassian.net/browse/ENG-70'), false)
})

test('samePage: sin identificador queda la ruta', () => {
  eq(samePage(DC + '/spaces/SIMPL', DC + '/spaces/SIMPL?src=nav'), true)
  eq(samePage(DC + '/spaces/SIMPL', DC + '/spaces/OTRO'), false)
})

test('samePage: lo que no es una URL no casa con nada', () => {
  eq(samePage('', DC + '/spaces/SIMPL'), false)
  eq(samePage(null, null), false)
  eq(samePage('no-es-una-url', 'no-es-una-url'), true, 'idénticas sí, sin mirar más')
})
