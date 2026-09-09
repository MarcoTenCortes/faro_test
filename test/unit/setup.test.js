import { test, eq, assert, throws } from '../harness.js'
import {
  buildMcpConfig,
  siteBaseUrl,
  siteRecords,
  mcpStatusFor,
  configFilePath,
  mcpBlockSnippet,
  fullConfigSnippet,
  readVerification,
  PRODUCTS,
} from '../../src/panel/setup.js'
import { mcpNameForHost } from '../../src/shared/config.js'

const CLOUD = 'https://acme.atlassian.net'

/** Como `throws`, pero exigiendo que el mensaje diga QUÉ falta. */
async function throwsWith(fn, re) {
  try {
    await fn()
  } catch (err) {
    assert(re.test(String(err?.message || err)), `el mensaje «${err?.message}» no cuadra con ${re}`)
    return
  }
  throw new Error('se esperaba una excepción con ' + re)
}

test('mcp: configuración de Cloud con correo y API token, uno por producto', () => {
  const c = buildMcpConfig({
    jira: { url: CLOUD, email: 'yo@acme.com', token: 'tok-jira' },
    confluence: { url: CLOUD, email: 'yo@acme.com', token: 'tok-conf' },
  })
  eq(c.type, 'local')
  eq(c.command, ['uvx', 'mcp-atlassian'])
  eq(c.environment.JIRA_URL, 'https://acme.atlassian.net')
  eq(c.environment.JIRA_USERNAME, 'yo@acme.com')
  eq(c.environment.JIRA_API_TOKEN, 'tok-jira')
  // En Cloud el wiki cuelga de /wiki.
  eq(c.environment.CONFLUENCE_URL, 'https://acme.atlassian.net/wiki')
  eq(c.environment.CONFLUENCE_API_TOKEN, 'tok-conf')
})

test('EL CAMBIO: cada producto lleva su token; el de uno no se copia al otro', () => {
  // Antes se pedía un token y se ponía en los dos productos. Sólo vale en
  // Cloud: en Data Center son dos instalaciones con su token personal cada una.
  const c = buildMcpConfig({
    jira: { url: 'https://jira.simplprogramme.eu', token: 'pat-jira' },
    confluence: { url: 'https://confluence.simplprogramme.eu', token: 'pat-conf' },
    dataCenter: true,
  })
  eq(c.environment.JIRA_URL, 'https://jira.simplprogramme.eu')
  eq(c.environment.JIRA_PERSONAL_TOKEN, 'pat-jira')
  eq(c.environment.CONFLUENCE_URL, 'https://confluence.simplprogramme.eu')
  eq(c.environment.CONFLUENCE_PERSONAL_TOKEN, 'pat-conf')
  assert(!('CONFLUENCE_USERNAME' in c.environment) && !('JIRA_USERNAME' in c.environment), 'en DC no va el correo')
  assert(!Object.values(c.environment).includes('pat-jira') || c.environment.CONFLUENCE_PERSONAL_TOKEN !== 'pat-jira', 'el token de Jira no acaba en Confluence')
})

test('mcp: en Data Center el wiki está donde el usuario diga, sin añadir /wiki', () => {
  const raiz = buildMcpConfig({ confluence: { url: 'https://wiki.interno.corp', token: 'pat' }, dataCenter: true })
  eq(raiz.environment.CONFLUENCE_URL, 'https://wiki.interno.corp')
  const contexto = buildMcpConfig({ confluence: { url: 'https://interno.corp/confluence/', token: 'pat' }, dataCenter: true })
  eq(contexto.environment.CONFLUENCE_URL, 'https://interno.corp/confluence', 'la ruta de contexto se conserva, sin barra final')
})

test('mcp: se puede habilitar sólo uno de los dos productos', () => {
  const soloJira = buildMcpConfig({ jira: { url: CLOUD, email: 'e@e.com', token: 't' } })
  assert('JIRA_URL' in soloJira.environment)
  assert(!('CONFLUENCE_URL' in soloJira.environment))
  const soloConf = buildMcpConfig({ confluence: { url: CLOUD, email: 'e@e.com', token: 't' } })
  assert(!('JIRA_URL' in soloConf.environment))
  assert('CONFLUENCE_URL' in soloConf.environment)
})

test('SEGURIDAD: el MCP se configura en modo sólo lectura', () => {
  const c = buildMcpConfig({ jira: { url: CLOUD, email: 'e@e.com', token: 't' } })
  eq(c.environment.READ_ONLY_MODE, 'true')
})

test('mcp: lo que falta se dice con el nombre del producto, antes de mandar nada', async () => {
  const ok = { url: CLOUD, email: 'e@e.com', token: 't' }
  await throwsWith(() => buildMcpConfig({}), /al menos Jira o Confluence/)
  await throwsWith(() => buildMcpConfig({ jira: null, confluence: null }), /al menos Jira o Confluence/)
  await throwsWith(() => buildMcpConfig({ jira: ok, confluence: { url: '', email: 'e@e.com', token: 't' } }), /dirección de Confluence/)
  await throwsWith(() => buildMcpConfig({ jira: { url: CLOUD, email: 'e@e.com', token: '' } }), /token de Jira/)
  await throwsWith(() => buildMcpConfig({ jira: { url: CLOUD, token: 't' } }), /correo de la cuenta de Jira/)
  await throwsWith(() => buildMcpConfig({ confluence: { url: 'ftp://x', email: 'e@e.com', token: 't' } }), /dirección de Confluence/)
  await throws(() => buildMcpConfig(undefined))
  // En Data Center el correo no hace falta.
  buildMcpConfig({ jira: { url: 'https://jira.x.eu', token: 't' }, dataCenter: true })
})

test('siteBaseUrl: de lo que se pega al sitio, sin la incidencia ni la página', () => {
  eq(siteBaseUrl('https://acme.atlassian.net/browse/ENG-7'), 'https://acme.atlassian.net', 'en Cloud, el origen a secas')
  eq(siteBaseUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/1/T'), 'https://acme.atlassian.net')
  eq(siteBaseUrl('https://jira.x.eu/browse/ENG-7'), 'https://jira.x.eu')
  eq(siteBaseUrl('https://jira.x.eu/projects/ENG/summary'), 'https://jira.x.eu')
  eq(siteBaseUrl('https://confluence.x.eu/display/ENG/Titulo'), 'https://confluence.x.eu')
  eq(siteBaseUrl('https://confluence.x.eu/pages/viewpage.action?pageId=5'), 'https://confluence.x.eu')
  eq(siteBaseUrl('https://x.eu/jira/browse/ENG-7'), 'https://x.eu/jira', 'una ruta de contexto se conserva')
  eq(siteBaseUrl('https://x.eu/wiki/display/ENG/T'), 'https://x.eu/wiki')
  eq(siteBaseUrl(' https://jira.x.eu/ '), 'https://jira.x.eu', 'espacios y barra final fuera')
  eq(siteBaseUrl('jira.x.eu'), '', 'sin protocolo no es una dirección')
  eq(siteBaseUrl('javascript:alert(1)'), '')
  eq(siteBaseUrl(''), '')
  eq(siteBaseUrl(null), '')
})

test('siteRecords: en Cloud los dos productos comparten host y no hay nada que enlazar', () => {
  const r = siteRecords({ host: 'acme.atlassian.net', product: 'confluence', mcpName: 'atlassian-acme-atlassian-net', jiraHost: 'acme.atlassian.net', confluenceHost: 'acme.atlassian.net' })
  eq(r, [{ host: 'acme.atlassian.net', patch: { configured: true, mcpName: 'atlassian-acme-atlassian-net', product: 'confluence', cloud: true } }])
})

test('EL CAMBIO: en Data Center el otro host queda enlazado, con el mismo MCP y la referencia cruzada', () => {
  // Es lo que hace que al abrir el Jira de este Confluence no se vuelvan a
  // pedir claves, y que desde Jira se sepa de qué Confluence tirar.
  const r = siteRecords({
    host: 'confluence.simplprogramme.eu',
    product: 'confluence',
    mcpName: 'atlassian-confluence-simplprogramme-eu',
    jiraHost: 'jira.simplprogramme.eu',
    confluenceHost: 'confluence.simplprogramme.eu',
  })
  eq(r.map((x) => x.host), ['confluence.simplprogramme.eu', 'jira.simplprogramme.eu'])
  eq(r[0].patch, { configured: true, mcpName: 'atlassian-confluence-simplprogramme-eu', product: 'confluence', cloud: false, jiraHost: 'jira.simplprogramme.eu' })
  eq(r[1].patch, { configured: true, mcpName: 'atlassian-confluence-simplprogramme-eu', product: 'jira', cloud: false, confluenceHost: 'confluence.simplprogramme.eu' })

  // Al revés: configurado desde Jira.
  const desdeJira = siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: 'atlassian-jira-x-eu', jiraHost: 'jira.x.eu', confluenceHost: 'confluence.x.eu' })
  eq(desdeJira[1].host, 'confluence.x.eu')
  eq(desdeJira[1].patch.product, 'confluence')
  eq(desdeJira[1].patch.jiraHost, 'jira.x.eu')
  assert(!('confluenceHost' in desdeJira[1].patch), 'un host no se enlaza consigo mismo')

  // Sólo un producto: nada que enlazar.
  eq(siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: 'n', jiraHost: 'jira.x.eu' }).length, 1)
  // Mayúsculas en el host no crean dos registros.
  eq(siteRecords({ host: 'Jira.X.eu', product: 'jira', mcpName: 'n', jiraHost: 'jira.x.eu' }).length, 1)
})

test('mcp: nombre estable y válido por host', () => {
  eq(mcpNameForHost('acme.atlassian.net'), 'atlassian-acme-atlassian-net')
  eq(mcpNameForHost('WIKI.Interno.Corp'), 'atlassian-wiki-interno-corp')
  eq(PRODUCTS, ['jira', 'confluence'])
})

test('mcpStatusFor: distingue no configurado de configurado', () => {
  const name = mcpNameForHost('acme.atlassian.net')
  eq(mcpStatusFor({}, 'acme.atlassian.net').present, false)
  eq(mcpStatusFor({ [name]: { status: 'connected' } }, 'acme.atlassian.net').connected, true)
  eq(mcpStatusFor({ [name]: { status: 'failed' } }, 'acme.atlassian.net').present, true)
  eq(mcpStatusFor({ [name]: { status: 'failed' } }, 'acme.atlassian.net').connected, false)
})

test('mcpStatusFor: un host enlazado mira el MCP de su pareja, por el nombre guardado', () => {
  const pareja = mcpNameForHost('confluence.simplprogramme.eu')
  const lista = { [pareja]: { status: 'connected' } }
  eq(mcpStatusFor(lista, 'jira.simplprogramme.eu').present, false, 'con su propio nombre no está')
  const s = mcpStatusFor(lista, 'jira.simplprogramme.eu', pareja)
  eq(s.connected, true)
  eq(s.name, pareja)
  eq(mcpStatusFor(lista, 'jira.simplprogramme.eu', '').present, false, 'un nombre vacío es como no darlo')
})

// --- estado real del MCP -------------------------------------------------
// `GET /mcp` de opencode 1.2.25 responde { "<nombre>": { "status": "..." } }.
// Verificado contra un servidor real.

test('mcpStatusFor: la forma real que devuelve opencode', () => {
  const name = mcpNameForHost('confluence.simplprogramme.eu')
  const s = mcpStatusFor({ [name]: { status: 'connected' } }, 'confluence.simplprogramme.eu')
  eq(s.connected, true)
  eq(s.present, true)
  eq(s.status, 'connected')
})

test('mcpStatusFor: cualquier estado que no sea connected no vale', () => {
  const name = mcpNameForHost('acme.atlassian.net')
  for (const estado of ['connecting', 'failed', 'error', 'disabled', 'pending']) {
    const s = mcpStatusFor({ [name]: { status: estado } }, 'acme.atlassian.net')
    eq(s.connected, false, `«${estado}» no debe darse por bueno`)
    eq(s.present, true)
  }
})

test('configFilePath: sale de GET /path', () => {
  eq(configFilePath({ config: 'C:\\Users\\marco\\.config\\opencode' }), 'C:\\Users\\marco\\.config\\opencode\\opencode.json')
  eq(configFilePath({ config: '/home/x/.config/opencode' }), '/home/x/.config/opencode/opencode.json')
  eq(configFilePath(null), 'opencode.json')
})

test('los fragmentos para pegar son JSON válido y llevan las claves', () => {
  const config = buildMcpConfig({ confluence: { url: 'https://confluence.simplprogramme.eu', token: 'pat' }, dataCenter: true })
  const bloque = JSON.parse(mcpBlockSnippet('atlassian-x', config))
  eq(Object.keys(bloque), ['atlassian-x'])
  eq(bloque['atlassian-x'].environment.CONFLUENCE_PERSONAL_TOKEN, 'pat')

  const entero = JSON.parse(fullConfigSnippet('atlassian-x', config))
  eq(Object.keys(entero.mcp), ['atlassian-x'])
  assert(entero.$schema.includes('opencode'), 'el fichero entero debe llevar $schema')
})

// --- interpretación de la comprobación -----------------------------------
// Vino de un diagnóstico falso: decíamos «las claves no funcionan» cuando el
// MCP todavía no había arrancado (tarda unos diez segundos).

test('verificación: OK se reconoce', () => {
  const r = readVerification([{ type: 'tool', state: { status: 'completed' } }, { type: 'text', text: 'OK Marco Tenorio' }])
  eq(r.ok, true)
  eq(r.detail, 'Marco Tenorio')
})

test('verificación: sin herramientas NO se culpa a las claves', () => {
  const r = readVerification([{ type: 'text', text: 'No tengo acceso a Confluence.' }])
  eq(r.ok, false)
  eq(r.reason, 'sin-herramientas')
  assert(r.detail.includes('MCP'), 'debe señalar al MCP, no al token')
  assert(!/token|clave/i.test(r.detail), 'no debe insinuar que el token está mal')
})

test('verificación: un 401 de Atlassian sí es cosa de las claves', () => {
  const r = readVerification([
    { type: 'tool', state: { status: 'error', error: 'HTTP 401 Unauthorized' } },
  ])
  eq(r.ok, false)
  eq(r.reason, 'credenciales')
})

test('verificación: otro fallo de herramienta se reporta tal cual', () => {
  const r = readVerification([{ type: 'tool', state: { status: 'error', error: 'connection refused' } }])
  eq(r.reason, 'herramienta')
  assert(r.detail.includes('connection refused'))
})

test('verificación: entrada vacía no revienta', () => {
  eq(readVerification(null).ok, false)
  eq(readVerification([]).reason, 'sin-herramientas')
})
