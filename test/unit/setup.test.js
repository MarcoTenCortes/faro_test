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
  // H18: las diez variables van siempre (la fusión del PATCH no quita claves), así
  // que «no va el correo» es que va VACÍO, que mcp-atlassian trata como ausente.
  eq([c.environment.CONFLUENCE_USERNAME, c.environment.JIRA_USERNAME], ['', ''], 'en DC no va el correo')
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
  eq(soloJira.environment.JIRA_URL, CLOUD)
  eq(soloJira.environment.CONFLUENCE_URL, '', 'el que no se habilita va vacío (H18: la clave está, sin valor)')
  const soloConf = buildMcpConfig({ confluence: { url: CLOUD, email: 'e@e.com', token: 't' } })
  eq(soloConf.environment.JIRA_URL, '')
  eq(soloConf.environment.CONFLUENCE_URL, CLOUD + '/wiki')
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
  eq(r, [{ host: 'acme.atlassian.net', patch: { configured: true, mcpName: 'atlassian-acme-atlassian-net', product: 'confluence', cloud: true, verified: true } }])
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
  eq(r[0].patch, { configured: true, mcpName: 'atlassian-confluence-simplprogramme-eu', product: 'confluence', cloud: false, verified: true, jiraHost: 'jira.simplprogramme.eu' })
  eq(r[1].patch, { configured: true, mcpName: 'atlassian-confluence-simplprogramme-eu', product: 'jira', cloud: false, verified: true, confluenceHost: 'confluence.simplprogramme.eu' })

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
  // Revisión adversaria de H15: un plazo por debajo de medio segundo decía «más
  // de 0 s», que es mentira y además absurdo; se redondea hacia arriba a 1 s.
  const cortito = mcpFailureHint(fallo('Operation timed out after 400ms')).text
  assert(/más de 1 s/.test(cortito) && !/más de 0 s/.test(cortito), 'un plazo de 400 ms dice «1 s», nunca «0 s»: ' + cortito)
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

// ---- H16: un fallo del MODELO no dice nada de las claves --------------------
// Pasó con un compañero de Marco: su modelo no estaba en su plan y el panel
// decía «Jira: <error del modelo>» como si el token estuviera mal.

import { verifyCredentials } from '../../src/panel/setup.js'

/** Un cliente de mentira cuyo `runTurn` devuelve lo que se le diga. */
const clienteQueDevuelve = (turno) => ({ runTurn: async () => turno })

test('H16: si el MODELO falla, verifyCredentials lo dice como del modelo, con el error crudo', async () => {
  const CRUDO = {
    name: 'APIError',
    data: { message: "Bad Request: … The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.", statusCode: 400, isRetryable: false },
  }
  const r = await verifyCredentials(clienteQueDevuelve({ ok: false, error: 'El modelo no aceptó la petición', rawError: CRUDO, parts: [], tools: [] }), {
    sessionID: 's',
    model: { providerID: 'openai', modelID: 'gpt-5.4' },
    host: 'jira.simplprogramme.eu',
    product: 'jira',
  })
  eq(r, { ok: false, reason: 'modelo', detail: 'El modelo no aceptó la petición', rawError: CRUDO, stalled: false })
  // Sin error crudo, null: nunca undefined, que se perdería al guardarlo.
  const sin = await verifyCredentials(clienteQueDevuelve({ ok: false, error: 'x', parts: [] }), { sessionID: 's', model: null, host: 'h', product: 'confluence' })
  eq([sin.reason, sin.rawError, sin.stalled], ['modelo', null, false])
})

test('H16: si el modelo se calla, verifyCredentials devuelve stalled, y un fallo de CLAVES sigue siendo de claves', async () => {
  const r = await verifyCredentials(clienteQueDevuelve({ ok: false, stalled: true, parts: [], rawError: null }), {
    sessionID: 's',
    model: null,
    host: 'h',
    product: 'jira',
  })
  eq([r.ok, r.reason, r.stalled, r.rawError], [false, 'modelo', true, null])
  // Un turno que SÍ usó el MCP y recibió un 401 de Atlassian no pasa por aquí.
  const claves = await verifyCredentials(
    clienteQueDevuelve({ ok: true, parts: [{ type: 'tool', tool: 'jira_search', state: { status: 'error', error: '401 Unauthorized' } }] }),
    { sessionID: 's', model: null, host: 'h', product: 'jira' }
  )
  eq(claves.reason, 'credenciales')
  eq('rawError' in claves, false, 'lo del modelo sólo viaja cuando falló el modelo')
})

// Revisión adversaria de H16: si a mitad de la comprobación el panel cambia de
// sitio, `bootForSite` → `buildClient` desconecta el cliente, el turno se queda
// sin eventos y `runTurn` devolvía `stalled` a los 60 s, que se traducía a
// reason 'modelo' → un veredicto «mudo» FALSO de un día a un modelo que
// funciona. Con la señal, el turno vuelve `aborted` y eso es «cancelado», no
// del modelo (y cierra lo anotado desde H2: verifyCredentials no miraba
// `turn.aborted`, y con un cliente cerrado caía en «sin herramientas»).
test('H16 revisión: una comprobación cancelada es «cancelado», nunca un fallo del modelo, y la señal llega al turno', async () => {
  const abortador = new AbortController()
  let opciones = null
  const cliente = {
    runTurn: async (_id, _peticion, opts) => {
      opciones = opts
      return { ok: false, aborted: true, parts: [], text: '', tools: [] }
    },
  }
  const r = await verifyCredentials(cliente, { sessionID: 's', model: null, host: 'h', product: 'jira', signal: abortador.signal })
  eq(r, { ok: false, reason: 'cancelado', detail: 'la comprobación se canceló antes de terminar' })
  assert(opciones && opciones.signal === abortador.signal, 'la señal de quien llama llega a runTurn')
  eq([opciones.stallMs, opciones.maxMs], [60000, 180000], 'y los plazos de siempre')
  // Aunque venga además `stalled` (el vigilante abortó y la señal también), manda cancelar.
  const ambos = await verifyCredentials(clienteQueDevuelve({ ok: false, aborted: true, stalled: true, parts: [] }), {
    sessionID: 's',
    model: null,
    host: 'h',
    product: 'confluence',
  })
  eq(ambos.reason, 'cancelado', 'cancelado manda sobre colgado: no es culpa del modelo')
  // El cliente cerrado de H2 (`closed: true`) tampoco es «sin herramientas».
  const cerrado = await verifyCredentials(clienteQueDevuelve({ ok: false, aborted: true, closed: true, parts: [], text: '', tools: [] }), {
    sessionID: 's',
    model: null,
    host: 'h',
    product: 'jira',
  })
  eq(cerrado.reason, 'cancelado')
  // Sin señal, `signal` viaja como undefined: runTurn sigue como siempre.
  await verifyCredentials(cliente, { sessionID: 's', model: null, host: 'h', product: 'jira' })
  eq('signal' in opciones && opciones.signal === undefined, true)
})

// ---------------------------------------------------------------------------
// H18 (docs/PLAN2.md §3.2): Faro escribe el MCP en la configuración de opencode
// con PATCH /global/config. Lo que decide QUÉ se escribe es puro y vive aquí.
// ---------------------------------------------------------------------------
import {
  mcpEntriesForHost,
  chooseWriteTarget,
  mcpWritePatch,
  uvxAbsoluteCommand,
  configFileCandidates,
  configureMcp,
  keysUnverified,
} from '../../src/panel/setup.js'
import { MCP_ENV_KEYS, validMcpEntry } from '../../src/shared/mcp-config.js'

const DC = { jira: { url: 'https://jira.x.eu', token: 'pat-jira' }, confluence: { url: 'https://confluence.x.eu', token: 'pat-conf' }, dataCenter: true }
const FARO = mcpNameForHost('jira.x.eu')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

test('H18: el environment va COMPLETO — las diez variables, vacías las que no se usan, y el bloque pasa la barrera', () => {
  const nube = buildMcpConfig({
    jira: { url: CLOUD, email: 'yo@acme.com', token: 'tok-j' },
    confluence: { url: CLOUD, email: 'yo@acme.com', token: 'tok-c' },
  })
  eq(Object.keys(nube.environment), [...MCP_ENV_KEYS], 'claves exactas y en su orden')
  eq(Object.keys(nube.environment), ['JIRA_URL', 'JIRA_PERSONAL_TOKEN', 'JIRA_USERNAME', 'JIRA_API_TOKEN', 'CONFLUENCE_URL', 'CONFLUENCE_PERSONAL_TOKEN', 'CONFLUENCE_USERNAME', 'CONFLUENCE_API_TOKEN', 'READ_ONLY_MODE', 'TOOLSETS'])
  eq([nube.environment.JIRA_PERSONAL_TOKEN, nube.environment.CONFLUENCE_PERSONAL_TOKEN], ['', ''], 'en Cloud el token personal va vacío')
  eq([nube.enabled, nube.type], [true, 'local'])
  // Cloud → Data Center: la fusión del PATCH no quita claves, así que las de Cloud tienen que ir VACÍAS, no ausentes.
  const dc = buildMcpConfig(DC)
  eq(Object.keys(dc.environment), [...MCP_ENV_KEYS])
  eq([dc.environment.JIRA_USERNAME, dc.environment.JIRA_API_TOKEN, dc.environment.CONFLUENCE_USERNAME, dc.environment.CONFLUENCE_API_TOKEN], ['', '', '', ''], 'Cloud→DC deja USERNAME/API_TOKEN en ""')
  eq([dc.environment.JIRA_PERSONAL_TOKEN, dc.environment.CONFLUENCE_PERSONAL_TOKEN], ['pat-jira', 'pat-conf'])
  // Sólo un producto: el otro, con su clave y vacío.
  const soloJira = buildMcpConfig({ jira: { url: 'https://jira.x.eu', token: 'p' }, dataCenter: true })
  eq([soloJira.environment.CONFLUENCE_URL, soloJira.environment.CONFLUENCE_PERSONAL_TOKEN], ['', ''])
  // Lo que construye Faro es exactamente lo que la barrera deja escribir, sin tocar nada.
  eq(validMcpEntry(FARO, dc), dc, 'el bloque de Faro pasa la barrera tal cual')
  eq(validMcpEntry(FARO, nube), nube)
})

const CONFIG_H18 = {
  mcp: {
    'mio-a-mano': {
      type: 'local',
      command: ['docker', 'run', '-i', '--rm', 'ghcr.io/sooperset/mcp-atlassian:0.23.1'],
      environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'secreto-1' },
      enabled: true,
      timeout: 120000,
    },
    [FARO]: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { CONFLUENCE_URL: 'https://confluence.x.eu', CONFLUENCE_PERSONAL_TOKEN: 'secreto-2' }, enabled: false, timeout: 30000 },
    ajena: { type: 'local', command: ['otra-cosa'], environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'secreto-3' }, enabled: false },
    'de-otro-host': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.otro.eu' } },
  },
}

test('H18: mcpEntriesForHost da TODAS las entradas del dominio, habilitadas y deshabilitadas, sin environment ni tokens', () => {
  const r = mcpEntriesForHost(CONFIG_H18, 'jira.x.eu')
  eq(r.map((e) => [e.name, e.enabled]), [['mio-a-mano', true], ['ajena', false]], 'en el orden de la configuración, las dos del dominio')
  eq(Object.keys(r[0]).sort(), ['command', 'enabled', 'name', 'products', 'timeout', 'type'], 'claves exactas')
  eq(r[0], { name: 'mio-a-mano', enabled: true, command: CONFIG_H18.mcp['mio-a-mano'].command, type: 'local', timeout: 120000, products: 1 })
  eq(r[1].timeout, null, 'sin plazo, null')
  assert(!JSON.stringify(mcpEntriesForHost(CONFIG_H18, 'confluence.x.eu')).includes('secreto'), 'SEGURIDAD: ningún token sale de aquí')
  eq(mcpEntriesForHost(CONFIG_H18, 'Confluence.X.eu').map((e) => e.name), [FARO], 'la deshabilitada también, sin distinguir mayúsculas')
  // mcpForHost sigue saltando las deshabilitadas: es lo que evita el bucle al quitar las claves.
  eq(mcpForHost(CONFIG_H18, 'confluence.x.eu'), null)
  for (const raro of [null, {}, { mcp: null }, { mcp: [] }, { mcp: { x: null, y: 7 } }]) eq(mcpEntriesForHost(raro, 'jira.x.eu'), [], 'sin forma: ' + JSON.stringify(raro))
  eq(mcpEntriesForHost(CONFIG_H18, ''), [])
})

test('H18: chooseWriteTarget — reutiliza la habilitada del dominio o el esqueleto de Faro; una ajena deshabilitada, nunca', () => {
  // (1) Habilitada con el dominio: su nombre, y se conservan type, command y timeout.
  eq(chooseWriteTarget({ config: CONFIG_H18, saved: null, host: 'jira.x.eu' }), {
    name: 'mio-a-mano',
    reuse: true,
    knownCommand: CONFIG_H18.mcp['mio-a-mano'].command,
    keep: { type: 'local', timeout: 120000 },
  })
  // (2) Deshabilitada que es el esqueleto de Faro (el mcpName guardado, que un host enlazado comparte): se reutiliza.
  const esqueleto = chooseWriteTarget({ config: CONFIG_H18, saved: { mcpName: FARO }, host: 'confluence.x.eu' })
  eq([esqueleto.name, esqueleto.reuse, esqueleto.knownCommand], [FARO, true, ['uvx', 'mcp-atlassian']])
  eq(chooseWriteTarget({ config: CONFIG_H18, saved: null, host: 'confluence.x.eu' }).reuse, false, 'sin el nombre guardado, ese nombre no es el de Faro para ESTE host')
  // …o el nombre por host, sin nada guardado.
  const porHost = { mcp: { [mcpNameForHost('jira.y.eu')]: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.y.eu' }, enabled: false } } }
  eq(chooseWriteTarget({ config: porHost, saved: null, host: 'jira.y.eu' }).reuse, true)
  const guardado = { mcp: { 'apuntado-por-faro': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.y.eu' }, enabled: false } } }
  eq(chooseWriteTarget({ config: guardado, saved: { mcpName: 'apuntado-por-faro' }, host: 'jira.y.eu' }).reuse, true)
  eq(chooseWriteTarget({ config: guardado, saved: null, host: 'jira.y.eu' }).reuse, false, 'el mismo esqueleto sin su nombre guardado es ajeno')
  // (3) Deshabilitada AJENA con el dominio: no vuelve a arrancar con tokens frescos; se crea una nueva a su lado.
  const soloAjena = { mcp: { ajena: CONFIG_H18.mcp.ajena } }
  eq(chooseWriteTarget({ config: soloAjena, saved: null, host: 'jira.x.eu' }), { name: FARO, reuse: false, knownCommand: null, keep: null })
  // (4) Ninguna: el mcpName guardado si tiene forma de nombre; si no, el de Faro por host.
  eq(chooseWriteTarget({ config: null, saved: { mcpName: 'atlassian-guardado' }, host: 'jira.x.eu' }).name, 'atlassian-guardado')
  for (const malo of ['con espacio', 'a/b', '__proto__', 'x'.repeat(65), '', 7, null]) {
    eq(chooseWriteTarget({ config: null, saved: { mcpName: malo }, host: 'jira.x.eu' }).name, FARO, 'un nombre guardado sin forma no se usa: ' + malo)
  }
  eq(chooseWriteTarget({ host: 'jira.x.eu' }), { name: FARO, reuse: false, knownCommand: null, keep: null })
})

test('H18: mcpWritePatch conserva el command del usuario sólo si es el de GET /config, y rechaza otra clave, otra versión y metacaracteres', () => {
  const block = buildMcpConfig(DC)
  // Nueva: el bloque tal cual.
  const nueva = chooseWriteTarget({ config: null, host: 'jira.x.eu' })
  eq(mcpWritePatch({ name: nueva.name, block, target: nueva }), block)
  // Reutilizada con un command propio (docker): se conserva porque es byte a byte el que ya tiene.
  const reuso = chooseWriteTarget({ config: CONFIG_H18, host: 'jira.x.eu' })
  const escrita = mcpWritePatch({ block, target: reuso })
  eq(escrita.command, CONFIG_H18.mcp['mio-a-mano'].command)
  eq([escrita.type, escrita.timeout, escrita.enabled], ['local', 120000, true], 'su plazo, más largo que el de Faro, se respeta')
  eq(escrita.environment, block.environment, 'se reescribe el environment entero')
  // Si el command conocido no coincide byte a byte con el que se escribiría, no vale.
  eq(mcpWritePatch({ block, target: { ...reuso, knownCommand: ['docker', 'run'] } }).command, ['docker', 'run'], 'lo conocido es lo que se conserva')
  eq(validMcpEntry('mio-a-mano', { ...escrita, command: ['docker', 'run', '-i'] }, { knownCommand: reuso.knownCommand }), null, 'otro command que el conocido: no')
  // Un 30 000 viejo de Faro sube al de H15 (no se BAJA nunca el del usuario).
  const viejo = chooseWriteTarget({ config: CONFIG_H18, saved: { mcpName: FARO }, host: 'confluence.x.eu' })
  eq(mcpWritePatch({ block, target: viejo }).timeout, 60000)
  // Otra clave en el bloque: nada.
  eq(mcpWritePatch({ block: { ...block, agent: { build: {} } }, target: nueva }), null, 'SEGURIDAD: una clave de más no se escribe')
  eq(mcpWritePatch({ block: { ...block, command: ['uvx', 'mcp-atlassian@9.9.9'] }, target: nueva }), null, 'otra versión, no')
  eq(mcpWritePatch({ block: { ...block, command: ['C:\\Users\\a&b\\.local\\bin\\uvx.exe', 'mcp-atlassian'] }, target: nueva }), null, 'SEGURIDAD: metacaracteres en la ruta, no')
  eq(mcpWritePatch({ block: { ...block, command: ['C:\\Users\\Marco Tenorio\\.local\\bin\\uvx.exe', 'mcp-atlassian'] }, target: nueva }).command[0], 'C:\\Users\\Marco Tenorio\\.local\\bin\\uvx.exe', 'una ruta con espacios sí')
  // Una entrada remota o sin command no se puede reutilizar: la barrera la tira.
  const remota = { mcp: { r: { type: 'remote', url: 'https://x', environment: { JIRA_URL: 'https://jira.x.eu' } } } }
  eq(mcpWritePatch({ block, target: chooseWriteTarget({ config: remota, host: 'jira.x.eu' }) }), null)
  eq(mcpWritePatch({ block: null, target: nueva }), null)
  eq(mcpWritePatch({ block, target: { name: 'con espacio', reuse: false } }), null, 'un nombre sin forma, tampoco')
})

test('H18: uvxAbsoluteCommand — de home o del directorio de configuración, y null con metacaracteres', () => {
  const v = 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION
  eq(uvxAbsoluteCommand({ home: 'C:\\Users\\marco', config: '' }), ['C:\\Users\\marco\\.local\\bin\\uvx.exe', v])
  eq(uvxAbsoluteCommand({ home: '', config: 'C:\\Users\\marco\\.config\\opencode' }), ['C:\\Users\\marco\\.local\\bin\\uvx.exe', v], 'sin home, dos niveles por encima de config')
  eq(uvxAbsoluteCommand({ home: 'C:\\Users\\Marco Tenorio\\' }), ['C:\\Users\\Marco Tenorio\\.local\\bin\\uvx.exe', v], 'con espacios y barra final')
  for (const malo of [null, {}, { home: '/home/marco' }, { home: 'C:\\Users\\a&b' }, { home: 'C:\\Users\\a^b' }, { home: 'C:\\Users\\a%b%' }, { config: 'C:\\opencode' }, { home: 'C:\\x\\..\\y' }]) {
    eq(uvxAbsoluteCommand(malo), null, 'sin ruta válida: ' + JSON.stringify(malo))
  }
})

test('H18: configFileCandidates — jsonc antes que json antes que config.json, y opencode.jsonc si no hay ninguno', () => {
  eq(configFileCandidates(['config.json', 'opencode.json', 'opencode.jsonc', 'otro.txt']), ['opencode.jsonc', 'opencode.json', 'config.json'])
  eq(configFileCandidates(['opencode.json', 'package.json'])[0], 'opencode.json')
  eq(configFileCandidates(['config.json']), ['config.json'])
  eq(configFileCandidates([]), ['opencode.jsonc'], 'sin ninguno, opencode crea el .jsonc')
  eq(configFileCandidates(null), ['opencode.jsonc'])
  eq(configFileCandidates([7, null, 'OPENCODE.JSON']), ['opencode.jsonc'], 'sólo los nombres exactos')
})

/** Un cliente falso para configureMcp: SIN addMcp ni connectMcp (si los llamara, reventaría). */
function clienteDeEscritura({ config = null, respuesta = { ok: true, status: 200, kind: '' } } = {}) {
  const llamadas = []
  return {
    llamadas,
    config: async () => {
      llamadas.push(['config'])
      return config
    },
    listMcp: async () => {
      llamadas.push(['listMcp'])
      return {}
    },
    updateMcpEntries: async (entradas, barrera) => {
      llamadas.push(['updateMcpEntries', entradas, barrera])
      return respuesta
    },
  }
}

test('H18: configureMcp escribe con updateMcpEntries, sin addMcp ni connectMcp, y no espera', async () => {
  const c = clienteDeEscritura()
  const r = await configureMcp(c, { host: 'jira.x.eu', ...DC })
  eq(c.llamadas.map((l) => l[0]), ['config', 'updateMcpEntries'], 'lee la configuración, escribe, y nada más: ni una espera')
  eq(r, { ok: true, status: 200, kind: '', name: FARO, block: buildMcpConfig(DC), reuse: false })
  eq(c.llamadas[1][1], { [FARO]: buildMcpConfig(DC) }, 'una entrada, con su nombre')
  eq(c.llamadas[1][2], { known: null })
  // Un 500 de opencode: {ok:false} con su kind, sin lanzar.
  const roto = clienteDeEscritura({ respuesta: { ok: false, status: 500, kind: 'ConfigJsonError' } })
  const f = await configureMcp(roto, { host: 'jira.x.eu', ...DC })
  eq([f.ok, f.status, f.kind, f.name], [false, 500, 'ConfigJsonError', FARO])
  eq(f.block, buildMcpConfig(DC), 'el bloque, para el respaldo manual')
  // Con la configuración dada no la vuelve a leer, y reutiliza la entrada del usuario pasando su command como conocido.
  const reuso = clienteDeEscritura()
  const r2 = await configureMcp(reuso, { host: 'jira.x.eu', ...DC, config: CONFIG_H18 })
  eq(reuso.llamadas.map((l) => l[0]), ['updateMcpEntries'])
  eq([r2.name, r2.reuse], ['mio-a-mano', true])
  eq(reuso.llamadas[0][2], { known: { 'mio-a-mano': CONFIG_H18.mcp['mio-a-mano'].command } })
  // El command del reintento sustituye al estándar SÓLO en una entrada nueva.
  const abs = ['C:\\Users\\marco\\.local\\bin\\uvx.exe', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION]
  const nueva = clienteDeEscritura()
  eq((await configureMcp(nueva, { host: 'jira.x.eu', ...DC, config: null, command: abs })).block.command, abs)
  const propia = clienteDeEscritura()
  eq((await configureMcp(propia, { host: 'jira.x.eu', ...DC, config: CONFIG_H18, command: abs })).block.command, CONFIG_H18.mcp['mio-a-mano'].command, 'en una reutilizada no se toca su command')
  // Lo que la barrera no deja pasar no sale: ni una petición.
  const mal = clienteDeEscritura()
  const m = await configureMcp(mal, { host: 'jira.x.eu', ...DC, config: null, command: ['C:\\a&b\\uvx.exe', 'mcp-atlassian'] })
  eq([m.ok, m.status, m.kind], [false, 0, 'entrada'])
  eq(mal.llamadas.length, 0, 'sin petición')
  // Y en el código: ni addMcp ni connectMcp en setup.js, y el cliente ya no tiene addMcp.
  const fuente = sinComentarios(readFileSync(join(import.meta.dirname, '..', '..', 'src/panel/setup.js'), 'utf8'))
  assert(!/addMcp|connectMcp/.test(fuente), 'setup.js no registra por POST /mcp')
  const cliente = sinComentarios(readFileSync(join(import.meta.dirname, '..', '..', 'src/opencode/client.js'), 'utf8'))
  assert(!/addMcp\s*\(/.test(cliente) && !/'POST', '\/mcp'/.test(cliente), 'y el cliente ya no tiene la puerta de POST /mcp')
})

test('H18: siteRecords lleva verified, y un registro guardado de HOY (sin verified) cuenta como verificado', () => {
  const sin = siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: FARO, jiraHost: 'jira.x.eu', confluenceHost: 'confluence.x.eu', verified: false })
  eq(sin.map((r) => r.patch.verified), [false, false], 'la adopción sin comprobar marca los DOS registros del MCP')
  eq(Object.keys(sin[0].patch), ['configured', 'mcpName', 'product', 'cloud', 'verified', 'confluenceHost'], 'claves exactas y en su orden')
  eq(siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: FARO }).map((r) => r.patch.verified), [true], 'por defecto, verificado')
  // Migración: la forma REAL de un registro guardado antes de H18, sin verified.
  const deHoy = {
    configured: true,
    mcpName: 'atlassian-jira-simplprogramme-eu',
    product: 'jira',
    cloud: false,
    confluenceHost: 'confluence.simplprogramme.eu',
    onboarded: true,
    indexedAt: 1758000000000,
    skill: 'analisis',
    model: { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' },
  }
  eq(keysUnverified(deHoy), false, 'nadie ve «claves sin comprobar» por actualizar')
  eq(keysUnverified({ ...deHoy, verified: true }), false)
  eq(keysUnverified({ ...deHoy, verified: false }), true, 'sólo false EXPLÍCITO avisa')
  for (const raro of [null, undefined, {}, { verified: 'false' }, { verified: 0 }, { verified: null }, 'x']) eq(keysUnverified(raro), false, 'sin false explícito: ' + JSON.stringify(raro))
})
