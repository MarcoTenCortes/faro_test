import { test, eq, assert, throws } from '../harness.js'
import {
  buildMcpConfig,
  mcpStatusFor,
  configFilePath,
  mcpBlockSnippet,
  fullConfigSnippet,
  readVerification,
} from '../../src/panel/setup.js'
import { mcpNameForHost } from '../../src/shared/config.js'

test('mcp: configuración de Cloud con correo y API token', () => {
  const c = buildMcpConfig({
    origin: 'https://acme.atlassian.net',
    email: 'yo@acme.com',
    token: 'tok123',
  })
  eq(c.type, 'local')
  eq(c.command, ['uvx', 'mcp-atlassian'])
  eq(c.environment.JIRA_URL, 'https://acme.atlassian.net')
  eq(c.environment.JIRA_USERNAME, 'yo@acme.com')
  eq(c.environment.JIRA_API_TOKEN, 'tok123')
  // En Cloud el wiki cuelga de /wiki.
  eq(c.environment.CONFLUENCE_URL, 'https://acme.atlassian.net/wiki')
})

test('mcp: en Data Center el wiki está en la raíz y el token es personal', () => {
  const c = buildMcpConfig({
    origin: 'https://wiki.interno.corp',
    token: 'pat456',
    dataCenter: true,
  })
  eq(c.environment.CONFLUENCE_URL, 'https://wiki.interno.corp')
  eq(c.environment.CONFLUENCE_PERSONAL_TOKEN, 'pat456')
  eq(c.environment.JIRA_PERSONAL_TOKEN, 'pat456')
  assert(!('CONFLUENCE_USERNAME' in c.environment), 'en DC no va el correo')
})

test('mcp: se puede habilitar sólo uno de los dos productos', () => {
  const soloJira = buildMcpConfig({ origin: 'https://a.atlassian.net', email: 'e@e.com', token: 't', confluence: false })
  assert('JIRA_URL' in soloJira.environment)
  assert(!('CONFLUENCE_URL' in soloJira.environment))
})

test('SEGURIDAD: el MCP se configura en modo sólo lectura', () => {
  const c = buildMcpConfig({ origin: 'https://a.atlassian.net', email: 'e@e.com', token: 't' })
  eq(c.environment.READ_ONLY_MODE, 'true')
})

test('mcp: falta de datos se detecta antes de mandar nada', async () => {
  await throws(() => buildMcpConfig({ origin: '', token: 't', email: 'e@e.com' }))
  await throws(() => buildMcpConfig({ origin: 'https://a.atlassian.net', email: 'e@e.com' }))
  await throws(() => buildMcpConfig({ origin: 'https://a.atlassian.net', token: 't' }))
  await throws(() =>
    buildMcpConfig({ origin: 'https://a.atlassian.net', email: 'e@e.com', token: 't', jira: false, confluence: false })
  )
})

test('mcp: nombre estable y válido por host', () => {
  eq(mcpNameForHost('acme.atlassian.net'), 'atlassian-acme-atlassian-net')
  eq(mcpNameForHost('WIKI.Interno.Corp'), 'atlassian-wiki-interno-corp')
})

test('mcpStatusFor: distingue no configurado de configurado', () => {
  const name = mcpNameForHost('acme.atlassian.net')
  eq(mcpStatusFor({}, 'acme.atlassian.net').present, false)
  eq(mcpStatusFor({ [name]: { status: 'connected' } }, 'acme.atlassian.net').connected, true)
  eq(mcpStatusFor({ [name]: { status: 'failed' } }, 'acme.atlassian.net').present, true)
  eq(mcpStatusFor({ [name]: { status: 'failed' } }, 'acme.atlassian.net').connected, false)
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
  const config = buildMcpConfig({ origin: 'https://confluence.simplprogramme.eu', token: 'pat', dataCenter: true, jira: false })
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
