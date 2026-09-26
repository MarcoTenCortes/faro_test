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
  mcpForHost,
  chosenMcpName,
  PRODUCTS,
  mcpFailureHint,
} from '../../src/panel/setup.js'
import { mcpNameForHost, MCP_ATLASSIAN_VERSION } from '../../src/shared/config.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  // H15: la versión va fijada también en lo que Faro escribe (docs/PLAN2.md
  // §8.4), la misma que instala tools/instalar.ps1.
  eq(c.command, ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION])
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
  // R3 (auditoría del 2026-09-13): el enlace corto que da «Compartir» en un
  // Confluence Data Center (/x/AbCd) se colaba como ruta de contexto y el MCP
  // se configuraba contra una dirección que no existe.
  eq(siteBaseUrl('https://confluence.x.eu/x/AbCdEf'), 'https://confluence.x.eu', 'el enlace corto de Compartir no es ruta de contexto')
  eq(siteBaseUrl('https://x.eu/confluence/x/AbCd'), 'https://x.eu/confluence', 'y detrás de una ruta de contexto, ídem')
  // Límite asumido: un contexto que se llame «/x» no se distingue del enlace
  // corto (Confluence sirve sus enlaces cortos en /x/…, así que un contexto con
  // ese nombre chocaría con ellos: no se da en la práctica).
  eq(siteBaseUrl('https://x.eu/x/x/AbCd'), 'https://x.eu', 'límite asumido: un contexto llamado /x se recorta con el enlace corto')
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

// --- el MCP que ya existe en opencode para este dominio ----------------------
// Pasó de verdad: el MCP se configuró desde Jira con las dos direcciones, la
// anotación de Faro no llegó a escribirse, y al abrir Confluence pedía claves
// para un MCP que ya estaba conectado.

const CONFIG = {
  mcp: {
    'atlassian-jira-simplprogramme-eu': {
      type: 'local',
      environment: { JIRA_URL: 'https://jira.simplprogramme.eu', JIRA_PERSONAL_TOKEN: 'secreto-jira', CONFLUENCE_URL: 'https://confluence.simplprogramme.eu', CONFLUENCE_PERSONAL_TOKEN: 'secreto-conf', READ_ONLY_MODE: 'true' },
    },
    otro: { type: 'local', command: ['x'] },
  },
}

test('EL CAMBIO: el MCP se reconoce por el dominio que lleva en JIRA_URL o CONFLUENCE_URL, venga de donde venga', () => {
  const desdeConfluence = mcpForHost(CONFIG, 'confluence.simplprogramme.eu')
  eq(desdeConfluence, { name: 'atlassian-jira-simplprogramme-eu', jiraHost: 'jira.simplprogramme.eu', confluenceHost: 'confluence.simplprogramme.eu', products: 2, connected: false })
  eq(mcpForHost(CONFIG, 'jira.simplprogramme.eu').name, 'atlassian-jira-simplprogramme-eu')
  eq(mcpForHost(CONFIG, 'Confluence.SimplProgramme.EU').name, 'atlassian-jira-simplprogramme-eu', 'sin distinguir mayúsculas')
  eq(mcpForHost(CONFIG, 'otro.host'), null)
  eq(mcpForHost({ mcp: {} }, 'jira.simplprogramme.eu'), null)
  eq(mcpForHost(null, 'jira.simplprogramme.eu'), null)
  eq(mcpForHost(CONFIG, ''), null)
  // Una ruta de contexto o el /wiki de Cloud no estorban: se compara el host.
  const cloud = { mcp: { a: { environment: { JIRA_URL: 'https://acme.atlassian.net', CONFLUENCE_URL: 'https://acme.atlassian.net/wiki' } } } }
  eq(mcpForHost(cloud, 'acme.atlassian.net'), { name: 'a', jiraHost: 'acme.atlassian.net', confluenceHost: 'acme.atlassian.net', products: 2, connected: false })
  eq(mcpForHost({ mcp: { b: { environment: { CONFLUENCE_URL: 'https://x.eu/confluence' } } } }, 'x.eu'), { name: 'b', jiraHost: '', confluenceHost: 'x.eu', products: 1, connected: false })
})

test('mcpForHost: con varios, el que tiene los dos productos; en igualdad, el primero', () => {
  const dos = {
    mcp: {
      'solo-confluence': { environment: { CONFLUENCE_URL: 'https://confluence.x.eu', CONFLUENCE_PERSONAL_TOKEN: 'a' } },
      'los-dos': { environment: { JIRA_URL: 'https://jira.x.eu', CONFLUENCE_URL: 'https://confluence.x.eu', JIRA_PERSONAL_TOKEN: 'b', CONFLUENCE_PERSONAL_TOKEN: 'c' } },
      'los-dos-tambien': { environment: { JIRA_URL: 'https://jira.x.eu', CONFLUENCE_URL: 'https://confluence.x.eu' } },
      'solo-jira': { environment: { JIRA_URL: 'https://jira.x.eu' } },
    },
  }
  eq(mcpForHost(dos, 'confluence.x.eu').name, 'los-dos', 'el de los dos productos gana al que iba antes')
  eq(mcpForHost(dos, 'jira.x.eu').name, 'los-dos', 'y en igualdad, el primero')
  const iguales = { mcp: { primero: { environment: { JIRA_URL: 'https://j.eu' } }, segundo: { environment: { JIRA_URL: 'https://j.eu' } } } }
  eq(mcpForHost(iguales, 'j.eu').name, 'primero')
})

test('SEGURIDAD: de la configuración sólo salen los hosts; las claves no llegan a ningún sitio', () => {
  const r = mcpForHost(CONFIG, 'jira.simplprogramme.eu')
  eq(Object.keys(r).sort(), ['confluenceHost', 'connected', 'jiraHost', 'name', 'products'])
  assert(!JSON.stringify(r).includes('secreto'), 'ningún token en el resultado')
  // Una URL rara en el environment no revienta ni cuela nada.
  eq(mcpForHost({ mcp: { x: { environment: { JIRA_URL: 'javascript:alert(1)', CONFLUENCE_URL: 42 } } } }, 'j.eu'), null)
})

test('chosenMcpName: lo que opencode tiene, luego lo apuntado, luego el nombre por host', () => {
  eq(chosenMcpName(CONFIG, { mcpName: 'apuntado' }, 'confluence.simplprogramme.eu'), 'atlassian-jira-simplprogramme-eu', 'lo de opencode manda')
  eq(chosenMcpName(null, { mcpName: 'apuntado' }, 'confluence.simplprogramme.eu'), 'apuntado', 'sin configuración, lo apuntado')
  eq(chosenMcpName(CONFIG, { mcpName: 'apuntado' }, 'otro.eu'), 'apuntado', 'sin coincidencia, lo apuntado')
  eq(chosenMcpName(null, null, 'confluence.simplprogramme.eu'), 'atlassian-confluence-simplprogramme-eu', 'y si no, el de siempre')
})

test('EL FALLO: el MCP conectado gana al caído aunque tenga menos productos, y uno deshabilitado no cuenta', () => {
  // Lo encontró la revisión: el bloque viejo con los dos productos, caído,
  // ganaba al recién verificado con uno, y el panel volvía a la pantalla de
  // claves en cada arranque. Sin salida desde el panel.
  const config = {
    mcp: {
      'atlassian-jira-x-eu': { environment: { JIRA_URL: 'https://jira.x.eu', CONFLUENCE_URL: 'https://confluence.x.eu' } },
      'atlassian-confluence-x-eu': { environment: { CONFLUENCE_URL: 'https://confluence.x.eu' } },
    },
  }
  const estados = { 'atlassian-jira-x-eu': { status: 'failed' }, 'atlassian-confluence-x-eu': { status: 'connected' } }
  const r = mcpForHost(config, 'confluence.x.eu', { status: estados })
  eq(r.name, 'atlassian-confluence-x-eu', 'el conectado, aunque tenga un producto')
  eq(r.connected, true)
  // Sin la lista de estados, la regla de siempre: los dos productos.
  eq(mcpForHost(config, 'confluence.x.eu').name, 'atlassian-jira-x-eu')
  // Con los dos conectados, otra vez los dos productos; en igualdad, el primero.
  const ambos = { 'atlassian-jira-x-eu': { status: 'connected' }, 'atlassian-confluence-x-eu': { status: 'connected' } }
  eq(mcpForHost(config, 'confluence.x.eu', { status: ambos }).name, 'atlassian-jira-x-eu')
  // Ninguno conectado: se devuelve el mejor por productos, pero marcado como no conectado.
  const ninguno = { 'atlassian-jira-x-eu': { status: 'failed' }, 'atlassian-confluence-x-eu': { status: 'failed' } }
  eq(mcpForHost(config, 'confluence.x.eu', { status: ninguno }), { name: 'atlassian-jira-x-eu', jiraHost: 'jira.x.eu', confluenceHost: 'confluence.x.eu', products: 2, connected: false })

  // `enabled: false`: opencode lo conserva en la configuración y lo devuelve como «disabled». No cuenta.
  const deshabilitado = {
    mcp: {
      viejo: { enabled: false, environment: { JIRA_URL: 'https://jira.x.eu', CONFLUENCE_URL: 'https://confluence.x.eu' } },
      nuevo: { environment: { CONFLUENCE_URL: 'https://confluence.x.eu' } },
    },
  }
  eq(mcpForHost(deshabilitado, 'confluence.x.eu').name, 'nuevo')
  eq(mcpForHost({ mcp: { viejo: deshabilitado.mcp.viejo } }, 'confluence.x.eu'), null)
  // Y chosenMcpName pasa los estados.
  eq(chosenMcpName(config, { mcpName: 'apuntado' }, 'confluence.x.eu', { status: estados }), 'atlassian-confluence-x-eu')
})

// ---------------------------------------------------------------------------
// waitForMcpReady (plan 2026-09-13, D6: puras sin test).
//
// No admite reloj inyectado: sondea `client.listMcp()` con `setTimeout` y
// `Date.now()`. Se prueba con un cliente falso e intervalos de milisegundos
// (en total, unas decenas de ms de temporizadores reales).
// ---------------------------------------------------------------------------
import { waitForMcpReady } from '../../src/panel/setup.js'

/** Cliente falso: cada listMcp() devuelve la siguiente respuesta (la última se repite); un Error se lanza. */
function clienteMcp(respuestas) {
  const llamadas = []
  return {
    llamadas,
    listMcp: async () => {
      const r = respuestas[Math.min(llamadas.length, respuestas.length - 1)]
      llamadas.push(Date.now())
      if (r instanceof Error) throw r
      return r
    },
  }
}

test('waitForMcpReady: conectado a la primera → vuelve sin esperar ni avisar', async () => {
  const host = 'confluence.x.eu'
  const nombre = mcpNameForHost(host)
  const client = clienteMcp([{ [nombre]: { status: 'connected' } }])
  const ticks = []
  const t0 = Date.now()
  const r = await waitForMcpReady(client, host, { timeoutMs: 50, intervalMs: 5, onTick: (s, ms) => ticks.push([s, ms]) })
  eq(r.connected, true)
  eq(r.name, nombre)
  eq(r.present, true)
  eq(r.status, 'connected')
  eq(client.llamadas.length, 1)
  eq(ticks, [], 'la vuelta que conecta no avisa')
  assert(Date.now() - t0 < 500, 'no espera ningún intervalo')
})

test('waitForMcpReady: sondea hasta que aparece conectado, avisando en cada vuelta con el plazo que queda', async () => {
  const host = 'confluence.x.eu'
  const nombre = mcpNameForHost(host)
  const client = clienteMcp([{}, { [nombre]: { status: 'failed' } }, { [nombre]: { status: 'connected' } }])
  const ticks = []
  const r = await waitForMcpReady(client, host, {
    timeoutMs: 1000,
    intervalMs: 5,
    onTick: (s, ms) => ticks.push({ present: s.present, status: s.status, ms }),
  })
  eq(r.connected, true)
  eq(client.llamadas.length, 3)
  eq(ticks.length, 2, 'un aviso por vuelta sin conectar')
  eq(ticks[0].present, false, 'el MCP aún no está registrado')
  eq(ticks[1].present, true)
  eq(ticks[1].status, 'failed', 'registrado pero caído: es lo que enseña la pantalla de claves')
  assert(ticks.every((t) => t.ms >= 0 && t.ms <= 1000), 'el plazo restante va en ms y nunca es negativo')
  assert(ticks[1].ms <= ticks[0].ms, 'y decrece')
})

test('waitForMcpReady: al agotar el plazo devuelve el último estado, sin conectar y sin lanzar', async () => {
  const host = 'confluence.x.eu'
  const client = clienteMcp([{ otro: { status: 'connected' } }])
  const ticks = []
  const t0 = Date.now()
  const r = await waitForMcpReady(client, host, { timeoutMs: 25, intervalMs: 5, onTick: () => ticks.push(1) })
  const dur = Date.now() - t0
  eq(r.connected, false)
  eq(r.present, false, 'otro MCP conectado no es el de este host')
  eq(r.name, mcpNameForHost(host))
  eq(r.aborted, undefined)
  assert(client.llamadas.length >= 2 && client.llamadas.length <= 30, 'varias vueltas: ' + client.llamadas.length)
  eq(ticks.length, client.llamadas.length, 'cada vuelta sin conectar avisa, también la última')
  assert(dur >= 20 && dur < 1000, 'respeta el plazo (' + dur + ' ms)')
})

test('waitForMcpReady: si listMcp falla se toma como lista vacía y se sigue sondeando', async () => {
  const host = 'confluence.x.eu'
  const nombre = mcpNameForHost(host)
  // El estado puede venir como cadena («connected») o como objeto: mcpStatusFor admite los dos.
  const client = clienteMcp([new Error('sin conexión'), { [nombre]: 'connected' }])
  const r = await waitForMcpReady(client, host, { timeoutMs: 1000, intervalMs: 5 })
  eq(r.connected, true)
  eq(client.llamadas.length, 2)
})

test('waitForMcpReady: con la señal ya abortada no pregunta nada', async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  const client = clienteMcp([{}])
  const r = await waitForMcpReady(client, 'confluence.x.eu', { timeoutMs: 50, intervalMs: 5, signal: ctrl.signal })
  eq(r, { connected: false, aborted: true })
  eq(client.llamadas.length, 0)
})

test('waitForMcpReady: abortar a mitad devuelve lo último visto, marcado como abortado', async () => {
  const host = 'confluence.x.eu'
  const nombre = mcpNameForHost(host)
  const ctrl = new AbortController()
  const client = clienteMcp([{ [nombre]: { status: 'failed' } }])
  const r = await waitForMcpReady(client, host, {
    timeoutMs: 1000,
    intervalMs: 5,
    signal: ctrl.signal,
    onTick: () => ctrl.abort(),
  })
  eq(client.llamadas.length, 1, 'tras abortar no se vuelve a preguntar')
  eq(r.name, nombre)
  eq(r.present, true)
  eq(r.status, 'failed')
  eq(r.connected, false)
  eq(r.aborted, true)
})

test('waitForMcpReady: con mcpName se mira ese bloque, no el nombre derivado del host', async () => {
  const host = 'confluence.x.eu'
  const client = clienteMcp([{ 'mi-atlassian': { status: 'connected' }, [mcpNameForHost(host)]: { status: 'failed' } }])
  const r = await waitForMcpReady(client, host, { timeoutMs: 50, intervalMs: 5, mcpName: 'mi-atlassian' })
  eq(r.connected, true)
  eq(r.name, 'mi-atlassian')
})

// ---------------------------------------------------------------------------
// H15 (docs/PLAN2.md §3.1): el bloque que Faro escribe y el consejo cuando el
// MCP de Atlassian no arranca.
// ---------------------------------------------------------------------------

const SETUP_FUENTE = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'panel', 'setup.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

test('H15: el bloque del MCP lleva la versión fijada, todas las herramientas y un minuto para arrancar', () => {
  const c = buildMcpConfig({ jira: { url: 'https://jira.simplprogramme.eu', token: 'pat' }, dataCenter: true })
  eq(c.command, ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION], 'uvx con la versión que el equipo lleva')
  assert(/^\d+\.\d+\.\d+$/.test(MCP_ATLASSIAN_VERSION), 'la versión es una versión de verdad: ' + MCP_ATLASSIAN_VERSION)
  // La versión sale de la constante, no de un literal repetido: si un día se
  // sube en config.js y aquí se queda la vieja, el script y el bloque dirían
  // cosas distintas.
  assert(SETUP_FUENTE.includes("'mcp-atlassian@' + MCP_ATLASSIAN_VERSION"), 'el command se monta con la constante')
  assert(!SETUP_FUENTE.includes(MCP_ATLASSIAN_VERSION), 'y la versión no está escrita a mano en setup.js')
  // mcp-atlassian 0.23.1 avisa de que su valor por defecto pasará a seis
  // grupos de herramientas; «all» es el que conserva todas (utils/toolsets.py).
  eq(c.environment.TOOLSETS, 'all', 'todas las herramientas, también cuando cambie el valor por defecto')
  eq(c.environment.READ_ONLY_MODE, 'true', 'y sigue en sólo lectura')
  // El plazo es de ARRANQUE: 8-12 s en caliente, más la primera vez.
  eq(c.timeout, 60000, 'un minuto para arrancar')
  eq(Object.keys(c).sort(), ['command', 'enabled', 'environment', 'timeout', 'type'], 'y nada más en el bloque')
})

test('H15: el consejo del MCP caído, con los DOS mensajes reales de opencode 1.2.25', () => {
  const fallo = (error) => mcpStatusFor({ x: { status: 'failed', error } }, 'h', 'x')
  // Medido (anexo-2-B): sin uvx en el PATH, el proceso se cierra al empezar.
  const sinArranque = mcpFailureHint(fallo('MCP error -32000: Connection closed'))
  eq(Object.keys(sinArranque).sort(), ['copy', 'kind', 'retry', 'text'], 'claves exactas')
  eq(sinArranque.kind, 'sin-arranque')
  eq(sinArranque.retry, true)
  eq(sinArranque.copy, 'powershell -ExecutionPolicy Bypass -File tools\\instalar.ps1', 'el comando para copiar')
  assert(/Casi siempre es que no encuentra uvx/.test(sinArranque.text), 'dice lo más probable, sin afirmarlo: Faro no ve el stderr')
  assert(/terminal NUEVA/.test(sinArranque.text) && /no se reconoce/.test(sinArranque.text), 'y manda a mirar la terminal de opencode')
  // Medido: el plazo de arranque vencido (con el timeout de antes, 30 s).
  const lento = mcpFailureHint(fallo('Operation timed out after 30000ms'))
  eq(Object.keys(lento).sort(), ['copy', 'kind', 'retry', 'text'])
  eq(lento.kind, 'lento')
  eq(lento.retry, true)
  eq(lento.copy, '')
  assert(/más de 30 s/.test(lento.text), 'dice los segundos del plazo que venció: ' + lento.text)
  assert(/107 paquetes/.test(lento.text) && /Reintentar/.test(lento.text), 'y qué hacer')
  eq(mcpFailureHint(fallo('Operation timed out after 60000 ms')).text.includes('más de 60 s'), true, 'con espacio antes de «ms» también')
  // Cualquier otro fallo: el error de opencode, tal cual pero en una línea.
  const otro = mcpFailureHint(fallo('spawn EACCES'))
  eq(otro.kind, 'otro')
  eq(otro.retry, true)
  eq(otro.copy, '')
  assert(otro.text.includes('spawn EACCES'), 'el error de opencode va dentro')
  const mudo = mcpFailureHint(mcpStatusFor({ x: { status: 'failed' } }, 'h', 'x'))
  eq(mudo.kind, 'otro')
  assert(/sin más detalle/.test(mudo.text) && /terminal/.test(mudo.text), 'sin error, un texto que manda a la terminal')
  eq(mcpFailureHint(fallo({ message: 'objeto' })).text, mudo.text, 'un error que no es cadena cuenta como ninguno')
})

test('H15: sólo un MCP en «failed» trae consejo; lo demás es null y nada lanza', () => {
  eq(mcpFailureHint(mcpStatusFor({ x: { status: 'connected' } }, 'h', 'x')), null, 'conectado')
  eq(mcpFailureHint(mcpStatusFor({}, 'h', 'x')), null, 'ausente')
  eq(mcpFailureHint(mcpStatusFor({ x: { status: 'disabled' } }, 'h', 'x')), null, 'deshabilitado')
  eq(mcpFailureHint(mcpStatusFor({ x: 'failed' }, 'h', 'x'))?.kind, 'otro', 'el estado como cadena también vale')
  for (const basura of [null, undefined, '', 'failed', 7, [], {}, { status: 'failed', present: false }, { raw: { error: 'Connection closed' } }]) {
    eq(mcpFailureHint(basura), null, 'basura: ' + JSON.stringify(basura))
  }
})

test('SEGURIDAD H15: el error de opencode sale en UNA línea, sin invisibles y con tope', () => {
  const NEL = String.fromCharCode(0x85)
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  const RLO = String.fromCharCode(0x202e)
  const ZWSP = String.fromCharCode(0x200b)
  const ESC = String.fromCharCode(0x1b)
  const error = 'primera\nsegunda\r\ntercera' + NEL + 'cuarta' + LS + 'quinta' + PS + 'sexta ' + RLO + 'al revés' + ZWSP + ESC + ' ' + 'x'.repeat(5000)
  const h = mcpFailureHint(mcpStatusFor({ x: { status: 'failed', error } }, 'h', 'x'))
  eq(h.kind, 'otro')
  const prohibidos = new RegExp('[\\r\\n\\u0085\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u0000-\\u001f\\u007f\\ufeff]')
  assert(!prohibidos.test(h.text), 'ni un salto ni un invisible en el consejo')
  assert(h.text.includes('primera segunda tercera cuarta quinta sexta al revés'), 'los saltos pasan a ser espacios: ' + h.text.slice(0, 120))
  // El error se acota a 200 caracteres antes de entrar en la frase.
  const cita = /«(.*)»/.exec(h.text)?.[1] || ''
  assert(cita.startsWith('primera') && cita.length <= 200, 'el error va citado y acotado a 200: ' + cita.length)
  assert(h.text.length < 400, 'y el consejo entero no crece con el error: ' + h.text.length)
})
