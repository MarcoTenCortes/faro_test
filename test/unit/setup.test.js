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
  adoptionRecords,
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
  // Revisión adversaria de H18: con su environment (para conservar el producto que no se trae) y `standard` false (docker).
  eq(chooseWriteTarget({ config: CONFIG_H18, saved: null, host: 'jira.x.eu' }), {
    name: 'mio-a-mano',
    reuse: true,
    knownCommand: CONFIG_H18.mcp['mio-a-mano'].command,
    standard: false,
    keep: { type: 'local', timeout: 120000, environment: CONFIG_H18.mcp['mio-a-mano'].environment },
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
  eq(chooseWriteTarget({ config: soloAjena, saved: null, host: 'jira.x.eu' }), { name: FARO, reuse: false, knownCommand: null, standard: true, keep: null })
  // (4) Ninguna: el mcpName guardado si tiene forma de nombre; si no, el de Faro por host.
  eq(chooseWriteTarget({ config: null, saved: { mcpName: 'atlassian-guardado' }, host: 'jira.x.eu' }).name, 'atlassian-guardado')
  for (const malo of ['con espacio', 'a/b', '__proto__', 'x'.repeat(65), '', 7, null]) {
    eq(chooseWriteTarget({ config: null, saved: { mcpName: malo }, host: 'jira.x.eu' }).name, FARO, 'un nombre guardado sin forma no se usa: ' + malo)
  }
  eq(chooseWriteTarget({ host: 'jira.x.eu' }), { name: FARO, reuse: false, knownCommand: null, standard: true, keep: null })
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
function clienteDeEscritura({ config = {}, respuesta = { ok: true, status: 200, kind: '' } } = {}) {
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
  eq(r, { ok: true, status: 200, kind: '', name: FARO, block: buildMcpConfig(DC), reuse: false, standard: true })
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
  eq((await configureMcp(nueva, { host: 'jira.x.eu', ...DC, config: {}, command: abs })).block.command, abs)
  const propia = clienteDeEscritura()
  eq((await configureMcp(propia, { host: 'jira.x.eu', ...DC, config: CONFIG_H18, command: abs })).block.command, CONFIG_H18.mcp['mio-a-mano'].command, 'en una reutilizada no se toca su command')
  // Lo que la barrera no deja pasar no sale: ni una petición.
  const mal = clienteDeEscritura()
  const m = await configureMcp(mal, { host: 'jira.x.eu', ...DC, config: {}, command: ['C:\\a&b\\uvx.exe', 'mcp-atlassian'] })
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
  // La misma regla que keysUnverified: sólo un false EXPLÍCITO deja sin verificar (revisión adversaria de H18).
  for (const noFalse of [null, 'false', 0]) eq(siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: FARO, verified: noFalse })[0].patch.verified, true, 'sin false explícito: ' + JSON.stringify(noFalse))
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

// ---------------------------------------------------------------------------
// Revisión adversaria de H18: lo que la escritura pisaba sin querer.
// ---------------------------------------------------------------------------

const V18 = 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION
const UVX_ABS = ['C:\\Users\\marco\\.local\\bin\\uvx.exe', V18]
const DOCKER = ['docker', 'run', '-i', '--rm', 'ghcr.io/sooperset/mcp-atlassian:0.23.1']

/** Las diez variables de una entrada que Faro escribió con los DOS productos de un Data Center. */
function entornoCompartido(cambios = {}) {
  return {
    JIRA_URL: 'https://jira.x.eu',
    JIRA_PERSONAL_TOKEN: 'pat-jira-viejo',
    JIRA_USERNAME: '',
    JIRA_API_TOKEN: '',
    CONFLUENCE_URL: 'https://confluence.x.eu',
    CONFLUENCE_PERSONAL_TOKEN: 'pat-conf-viejo',
    CONFLUENCE_USERNAME: '',
    CONFLUENCE_API_TOKEN: '',
    READ_ONLY_MODE: 'true',
    TOOLSETS: 'all',
    ...cambios,
  }
}

/** La entrada COMPARTIDA por Jira y Confluence, con el mcpName del host desde el que se configuró. */
function configCompartida(entorno = entornoCompartido()) {
  return { mcp: { [FARO]: { type: 'local', command: ['uvx', V18], environment: entorno, enabled: true, timeout: 60000 } } }
}

const SOLO_CONFLUENCE = { confluence: { url: 'https://confluence.x.eu', token: 'pat-conf-nuevo' }, dataCenter: true }
const JIRA_CLAVES = ['JIRA_URL', 'JIRA_PERSONAL_TOKEN', 'JIRA_USERNAME', 'JIRA_API_TOKEN']
const trozo = (env, claves) => Object.fromEntries(claves.map((k) => [k, env[k]]))

test('Revisión H18: en una entrada COMPARTIDA, cambiar las claves de un producto conserva las del otro', async () => {
  // Desde el Confluence enlazado de un Data Center: la pantalla sólo trae Confluence.
  const config = configCompartida()
  const target = chooseWriteTarget({ config, saved: { mcpName: FARO }, host: 'confluence.x.eu' })
  eq([target.name, target.reuse, target.standard], [FARO, true, true], 'se reutiliza la compartida')
  const escrita = mcpWritePatch({ block: buildMcpConfig(SOLO_CONFLUENCE), target })
  eq(trozo(escrita.environment, JIRA_CLAVES), trozo(entornoCompartido(), JIRA_CLAVES), 'Jira, byte a byte como estaba')
  eq(escrita.environment.CONFLUENCE_PERSONAL_TOKEN, 'pat-conf-nuevo', 'y Confluence, lo nuevo')
  eq([escrita.environment.READ_ONLY_MODE, escrita.environment.TOOLSETS], ['true', 'all'], 'READ_ONLY_MODE y TOOLSETS, del bloque')
  eq(Object.keys(escrita.environment), [...MCP_ENV_KEYS], 'las diez, ni una más')
  // Lo mismo por configureMcp: lo que llega al PATCH lleva el Jira de antes.
  const c = clienteDeEscritura()
  await configureMcp(c, { host: 'confluence.x.eu', ...SOLO_CONFLUENCE, saved: { mcpName: FARO }, config })
  eq(trozo(c.llamadas[0][1][FARO].environment, JIRA_CLAVES), trozo(entornoCompartido(), JIRA_CLAVES), 'el PATCH no vacía el MCP de Jira')

  // Con los DOS productos en el formulario se sobrescriben los dos.
  const ambos = mcpWritePatch({ block: buildMcpConfig({ ...DC, jira: { url: 'https://jira.x.eu', token: 'pat-jira-nuevo' } }), target })
  eq([ambos.environment.JIRA_PERSONAL_TOKEN, ambos.environment.CONFLUENCE_PERSONAL_TOKEN], ['pat-jira-nuevo', 'pat-conf'])
  // El formulario SÍ trae Jira, en Cloud: sus cuatro son las del bloque, con el PAT viejo en ''.
  const nube = buildMcpConfig({ jira: { url: 'https://jira.x.eu', email: 'yo@x.eu', token: 'tok-j' } })
  const aNube = mcpWritePatch({ block: nube, target })
  eq(trozo(aNube.environment, JIRA_CLAVES), { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: '', JIRA_USERNAME: 'yo@x.eu', JIRA_API_TOKEN: 'tok-j' }, 'lo que se trae no se mezcla con lo de antes')
  eq(aNube.environment.CONFLUENCE_PERSONAL_TOKEN, 'pat-conf-viejo', 'y el Confluence que no se trae se conserva')

  // Sólo se copian las cuatro del producto: lo que falte o no sea cadena queda en '', y una variable de más no entra.
  const raro = configCompartida(entornoCompartido({ JIRA_USERNAME: 7, OTRA: 'x' }))
  delete raro.mcp[FARO].environment.JIRA_API_TOKEN
  const r = mcpWritePatch({ block: buildMcpConfig(SOLO_CONFLUENCE), target: chooseWriteTarget({ config: raro, saved: { mcpName: FARO }, host: 'confluence.x.eu' }) })
  eq(trozo(r.environment, JIRA_CLAVES), { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'pat-jira-viejo', JIRA_USERNAME: '', JIRA_API_TOKEN: '' })
  eq(Object.keys(r.environment), [...MCP_ENV_KEYS])
  // Sin JIRA_URL en la entrada no hay Jira que conservar.
  const sinJira = mcpWritePatch({ block: buildMcpConfig(SOLO_CONFLUENCE), target: chooseWriteTarget({ config: configCompartida(entornoCompartido({ JIRA_URL: '' })), saved: { mcpName: FARO }, host: 'confluence.x.eu' }) })
  eq(sinJira.environment.JIRA_PERSONAL_TOKEN, '', 'sin dirección, nada de su token')
})

test('SEGURIDAD revisión H18: en una entrada NUEVA no se conserva nada, y un valor conservado sucio invalida la entrada', async () => {
  // Nueva: aunque alguien le pase un environment viejo, el bloque tal cual.
  const block = buildMcpConfig(SOLO_CONFLUENCE)
  const falsa = { name: FARO, reuse: false, knownCommand: null, standard: true, keep: { type: 'local', timeout: null, environment: entornoCompartido() } }
  eq(mcpWritePatch({ block, target: falsa }), block, 'una entrada nueva no hereda nada')
  const nueva = chooseWriteTarget({ config: { mcp: {} }, host: 'jira.x.eu' })
  eq(nueva.keep, null, 'y chooseWriteTarget no lleva environment en una nueva')
  // Un valor conservado con un salto, un NEL o un RLO: la barrera tira la entrada entera (kind entrada, sin PATCH).
  for (const sucio of ['pat\nmalo', 'pat' + String.fromCharCode(0x85) + 'malo', 'pat' + String.fromCharCode(0x202e) + 'malo']) {
    const config = configCompartida(entornoCompartido({ JIRA_PERSONAL_TOKEN: sucio }))
    const target = chooseWriteTarget({ config, saved: { mcpName: FARO }, host: 'confluence.x.eu' })
    eq(mcpWritePatch({ block, target }), null, 'SEGURIDAD: un valor conservado sucio no se escribe')
    const c = clienteDeEscritura()
    const res = await configureMcp(c, { host: 'confluence.x.eu', ...SOLO_CONFLUENCE, saved: { mcpName: FARO }, config })
    eq([res.ok, res.kind, c.llamadas.length], [false, 'entrada', 0])
    assert(!JSON.stringify(res.block).includes('pat-jira-viejo'), 'y el respaldo manual lleva sólo lo construido')
  }
})

test('Revisión H18: una entrada que ya existe con el nombre elegido se reutiliza aunque no lleve el dominio, y su command no se pisa', async () => {
  // El nombre guardado existe, apunta a otro dominio y lleva docker: se reutiliza con su command.
  const apuntada = { mcp: { apuntado: { type: 'local', command: DOCKER, environment: { JIRA_URL: 'https://jira.viejo.eu', JIRA_PERSONAL_TOKEN: 'secreto-v' }, enabled: false, timeout: 90000 } } }
  const t = chooseWriteTarget({ config: apuntada, saved: { mcpName: 'apuntado' }, host: 'jira.x.eu' })
  eq([t.name, t.reuse, t.knownCommand, t.standard], ['apuntado', true, DOCKER, false])
  eq(mcpWritePatch({ block: buildMcpConfig(DC), target: t, command: UVX_ABS }).command, DOCKER, 'el command del reintento no pisa uno del usuario')
  const c = clienteDeEscritura()
  const res = await configureMcp(c, { host: 'jira.x.eu', ...DC, saved: { mcpName: 'apuntado' }, config: apuntada, command: UVX_ABS })
  eq([res.name, res.reuse, res.standard, res.block.command, res.block.enabled], ['apuntado', true, false, DOCKER, true], 'se conserva docker y se habilita')
  eq(c.llamadas[0][2], { known: { apuntado: DOCKER } })
  // Sin nombre guardado, el de Faro por host, deshabilitado y sin el dominio, con el command de Faro: se reutiliza y es «estándar».
  for (const estandar of [['uvx', 'mcp-atlassian'], ['uvx', V18]]) {
    const deFaro = { mcp: { [FARO]: { type: 'local', command: estandar, environment: {}, enabled: false, timeout: 30000 } } }
    const f = chooseWriteTarget({ config: deFaro, host: 'jira.x.eu' })
    eq([f.reuse, f.standard], [true, true], 'standard con ' + JSON.stringify(estandar))
    const c2 = clienteDeEscritura()
    const r2 = await configureMcp(c2, { host: 'jira.x.eu', ...DC, config: deFaro, command: UVX_ABS })
    eq([r2.reuse, r2.standard, r2.block.command], [true, true, UVX_ABS], 'en la de Faro, el reintento SÍ escribe la ruta absoluta')
    eq(mcpWritePatch({ block: buildMcpConfig(DC), target: f }).command, estandar, 'sin reintento, el suyo')
  }
  // Ni otra versión ni una ruta absoluta ya escrita son «estándar».
  for (const otro of [['uvx', 'mcp-atlassian@0.1.0'], UVX_ABS, DOCKER]) {
    eq(chooseWriteTarget({ config: { mcp: { [FARO]: { type: 'local', command: otro, environment: {}, enabled: true } } }, host: 'jira.x.eu' }).standard, false, 'no estándar: ' + JSON.stringify(otro))
  }
  // Un nombre del prototipo no «existe»: nueva.
  for (const proto of ['toString', 'constructor', 'hasOwnProperty']) {
    eq(chooseWriteTarget({ config: { mcp: {} }, saved: { mcpName: proto }, host: 'jira.x.eu' }).reuse, false, 'SEGURIDAD: ' + proto + ' no es una entrada')
  }
  // …ni una heredada: sólo cuenta una entrada PROPIA (Object.hasOwn).
  const heredada = { mcp: Object.create({ apuntado: apuntada.mcp.apuntado }) }
  eq(chooseWriteTarget({ config: heredada, saved: { mcpName: 'apuntado' }, host: 'jira.x.eu' }).reuse, false, 'SEGURIDAD: una entrada del prototipo no existe')
  // Una deshabilitada AJENA (otro nombre) sigue sin reutilizarse.
  eq(chooseWriteTarget({ config: { mcp: { ajena: CONFIG_H18.mcp.ajena } }, saved: { mcpName: 'mio' }, host: 'jira.x.eu' }), {
    name: 'mio',
    reuse: false,
    knownCommand: null,
    standard: true,
    keep: null,
  })
  // Claves exactas de los dos resultados.
  eq(Object.keys(t), ['name', 'reuse', 'knownCommand', 'standard', 'keep'])
  eq(Object.keys(t.keep), ['type', 'timeout', 'environment'])
  eq(Object.keys(res), ['ok', 'status', 'kind', 'name', 'block', 'reuse', 'standard'])
})

test('SEGURIDAD revisión H18: sin la configuración de opencode no se escribe nada', async () => {
  // config: null dado, o client.config() que falla: kind 'config', ni una llamada a updateMcpEntries.
  const dado = clienteDeEscritura()
  const r = await configureMcp(dado, { host: 'jira.x.eu', ...DC, saved: { mcpName: 'guardado-bien' }, config: null, command: UVX_ABS })
  eq(r, { ok: false, status: 0, kind: 'config', name: 'guardado-bien', block: buildMcpConfig(DC), reuse: false, standard: true })
  eq(dado.llamadas, [], 'sin petición ninguna')
  const caido = clienteDeEscritura()
  caido.config = async () => {
    caido.llamadas.push(['config'])
    throw new Error('opencode caído')
  }
  const r2 = await configureMcp(caido, { host: 'jira.x.eu', ...DC })
  eq([r2.ok, r2.kind, r2.name, r2.reuse], [false, 'config', FARO, false])
  eq(caido.llamadas.map((l) => l[0]), ['config'], 'lee, falla, y no escribe')
  for (const raro of ['texto', 7, [], true]) {
    const c = clienteDeEscritura()
    eq((await configureMcp(c, { host: 'jira.x.eu', ...DC, config: raro })).kind, 'config', 'sin forma de configuración: ' + JSON.stringify(raro))
    eq(c.llamadas.length, 0)
  }
})

test('Revisión H18: adoptionRecords decide verified POR HOST, no uno para todos', () => {
  const registros = siteRecords({ host: 'confluence.x.eu', product: 'confluence', mcpName: FARO, jiraHost: 'jira.x.eu', confluenceHost: 'confluence.x.eu' })
  const deJ = (patch) => adoptionRecords({ registros, sites: patch, mcpName: FARO }).map((r) => [r.host, r.patch.verified])
  // J verificado + C nuevo (se adopta desde el Confluence enlazado): J true, C false.
  eq(deJ({ 'jira.x.eu': { configured: true, mcpName: FARO, product: 'jira', verified: true } }), [['confluence.x.eu', false], ['jira.x.eu', true]])
  // C configurado y verificado + enlace nuevo J: C true, J false.
  eq(deJ({ 'confluence.x.eu': { configured: true, mcpName: FARO, product: 'confluence', verified: true } }), [['confluence.x.eu', true], ['jira.x.eu', false]])
  // La migración: un registro guardado de HOY, sin verified, cuenta como verificado.
  eq(deJ({ 'jira.x.eu': { configured: true, mcpName: FARO, product: 'jira', cloud: false, onboarded: true } }), [['confluence.x.eu', false], ['jira.x.eu', true]])
  // Sin nada guardado, todos false; y lo ya marcado sin comprobar, otro MCP o sin configurar, false.
  eq(deJ({}), [['confluence.x.eu', false], ['jira.x.eu', false]])
  eq(deJ(null), [['confluence.x.eu', false], ['jira.x.eu', false]])
  for (const previo of [
    { configured: true, mcpName: FARO, verified: false },
    { configured: true, mcpName: 'otro-mcp', verified: true },
    { configured: false, mcpName: FARO, verified: true },
    { mcpName: FARO, verified: true },
    { configured: 'true', mcpName: FARO },
  ]) {
    eq(deJ({ 'jira.x.eu': previo }), [['confluence.x.eu', false], ['jira.x.eu', false]], 'no probado: ' + JSON.stringify(previo))
  }
  eq(adoptionRecords({ registros, sites: { 'jira.x.eu': { configured: true, mcpName: '' } }, mcpName: '' }).map((r) => r.patch.verified), [false, false], 'sin nombre de MCP, nada probado')
  // Claves exactas del patch (verified incluido, en su sitio) y sin mutar lo que recibe.
  const antes = JSON.stringify(registros)
  const sites = { 'jira.x.eu': { configured: true, mcpName: FARO } }
  const antesSites = JSON.stringify(sites)
  const r = adoptionRecords({ registros, sites, mcpName: FARO })
  eq(Object.keys(r[0].patch), ['configured', 'mcpName', 'product', 'cloud', 'verified', 'jiraHost'])
  eq(Object.keys(r[1].patch), ['configured', 'mcpName', 'product', 'cloud', 'verified', 'confluenceHost'])
  eq([JSON.stringify(registros), JSON.stringify(sites)], [antes, antesSites], 'no muta lo que recibe')
  assert(r[0].patch !== registros[0].patch, 'patch nuevo')
  eq(adoptionRecords({ registros: null, sites, mcpName: FARO }), [])
  eq(adoptionRecords(), [])
})

// ---------------------------------------------------------------------------
// H19 (docs/PLAN2.md §3.2 «Borrado», §8 decisión 3): «Quitar las claves de este
// sitio». No hay borrado por la API de opencode: se reescribe la entrada ENTERA
// con enabled false y las diez variables a '', en UN solo PATCH por la barrera.
// ---------------------------------------------------------------------------
import { mcpScrubCandidates, mcpScrubPatch, scrubMcp, scrubEffective, unlinkRecords, scrubConfirmText } from '../../src/panel/setup.js'
import { MCP_ENTRY_KEYS } from '../../src/shared/mcp-config.js'

const CONFIG_H19 = {
  mcp: {
    [FARO]: { type: 'local', command: ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION], environment: buildMcpConfig(DC).environment, enabled: true, timeout: 60000 },
    'docker-atlassian': { type: 'local', command: DOCKER, environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'tok-docker' }, enabled: true },
    'guardado-viejo': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.otro.eu', JIRA_PERSONAL_TOKEN: 'tok-viejo' }, enabled: false, timeout: 30000 },
    'atlassian-remoto': { type: 'remote', url: 'https://mcp.x.eu', environment: { CONFLUENCE_URL: 'https://confluence.x.eu' } },
    'solo-conf': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { CONFLUENCE_URL: 'https://Confluence.X.eu/wiki', CONFLUENCE_PERSONAL_TOKEN: 'tok-conf' }, enabled: true },
    [mcpNameForHost('confluence.x.eu')]: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { CONFLUENCE_URL: 'https://confluence.x.eu' }, enabled: false },
    'de-otro': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.otro.eu', JIRA_PERSONAL_TOKEN: 'tok-otro' }, enabled: true },
  },
}
const SAVED_H19 = { configured: true, mcpName: 'guardado-viejo', product: 'jira', confluenceHost: 'confluence.x.eu', onboarded: true }
const nombres = (lista) => lista.map((c) => c.name)

test('H19: mcpScrubCandidates — propias por nombre, ajenas por dominio, el host enlazado también, y las que no se pueden quitar aparte', () => {
  const r = mcpScrubCandidates({ config: CONFIG_H19, saved: SAVED_H19, host: 'JIRA.x.eu' })
  eq(Object.keys(r), ['propias', 'ajenas', 'noQuitables'], 'claves exactas y en su orden')
  // Propia: la del nombre guardado (aunque ya no lleve el dominio) y la del nombre de Faro de CUALQUIER host mirado (el enlazado también).
  eq(nombres(r.propias), [FARO, 'guardado-viejo', mcpNameForHost('confluence.x.eu')], 'propias, en el orden de la configuración')
  // Ajena: lleva uno de los hosts mirados y no es de Faro; «solo-conf» entra por el host ENLAZADO, con mayúsculas y /wiki.
  eq(nombres(r.ajenas), ['docker-atlassian', 'solo-conf'])
  // No se puede deshabilitar una remota: se lista para decirlo y no sale en las otras dos.
  eq(nombres(r.noQuitables), ['atlassian-remoto'])
  // Otro dominio, fuera.
  assert(![...r.propias, ...r.ajenas, ...r.noQuitables].some((c) => c.name === 'de-otro'), 'una entrada de otro dominio no es candidata')
  // Cada candidata con sus claves EXACTAS y SIN environment: los tokens no salen de aquí.
  // Revisión de H19: `restos` es la ÚLTIMA clave (un booleano: ¿guarda datos que Faro no sabe vaciar?).
  for (const c of [...r.propias, ...r.ajenas, ...r.noQuitables]) eq(Object.keys(c), ['name', 'enabled', 'command', 'type', 'timeout', 'jiraHost', 'confluenceHost', 'restos'], 'claves exactas de ' + c.name)
  const json = JSON.stringify(r)
  for (const t of ['pat-jira', 'pat-conf', 'tok-docker', 'tok-viejo', 'tok-conf', 'environment']) assert(!json.includes(t), 'SEGURIDAD: «' + t + '» no sale en las candidatas')
  eq(r.propias[0], { name: FARO, enabled: true, command: ['uvx', 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION], type: 'local', timeout: 60000, jiraHost: 'jira.x.eu', confluenceHost: 'confluence.x.eu', restos: false })
  eq(r.propias[1].enabled, false, 'una deshabilitada también es candidata: puede llevar tokens en disco')
  // Sin el host enlazado guardado, «solo-conf» y la de Faro del enlazado no son candidatas.
  const sinEnlace = mcpScrubCandidates({ config: CONFIG_H19, saved: { mcpName: 'guardado-viejo' }, host: 'jira.x.eu' })
  eq([nombres(sinEnlace.propias), nombres(sinEnlace.ajenas), nombres(sinEnlace.noQuitables)], [[FARO, 'guardado-viejo'], ['docker-atlassian'], []])
  // Sin nombre guardado, la del nombre viejo (que no lleva el dominio) tampoco.
  eq(nombres(mcpScrubCandidates({ config: CONFIG_H19, saved: null, host: 'jira.x.eu' }).propias), [FARO])
  // Un nombre guardado sin forma de nombre no cuenta (revisión de H19, A7: con una entrada que SÍ se llama así y
  // no lleva el dominio; sin ella la aserción era vacua): no sale en ninguna de las tres listas.
  const conDeOtro = { mcp: { ...CONFIG_H19.mcp, 'de otro': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.otro.eu', JIRA_PERSONAL_TOKEN: 'tok-otro' }, enabled: true } } }
  const deOtro = mcpScrubCandidates({ config: conDeOtro, saved: { mcpName: 'de otro' }, host: 'jira.x.eu' })
  eq(nombres(deOtro.propias), [FARO])
  assert(![...deOtro.propias, ...deOtro.ajenas, ...deOtro.noQuitables].some((c) => c.name === 'de otro'), 'A7: un nombre guardado sin forma no hace candidata a su entrada, ni en noQuitables')
  // El prototipo: una entrada heredada no existe, y un «__proto__» propio (de un JSON) no es un nombre que se pueda escribir.
  const heredada = { mcp: Object.create({ heredada: CONFIG_H19.mcp[FARO] }) }
  eq(mcpScrubCandidates({ config: heredada, saved: { mcpName: 'heredada' }, host: 'jira.x.eu' }), { propias: [], ajenas: [], noQuitables: [] }, 'lo heredado, fuera')
  const conProto = JSON.parse('{"mcp":{"__proto__":{"type":"local","command":["uvx","mcp-atlassian"],"environment":{"JIRA_URL":"https://jira.x.eu"},"enabled":true}}}')
  const p = mcpScrubCandidates({ config: conProto, saved: null, host: 'jira.x.eu' })
  eq([p.propias.length, p.ajenas.length, nombres(p.noQuitables)], [0, 0, ['__proto__']], 'un __proto__ propio no se manda: se lista')
  // Basura: nunca lanza, todo vacío.
  // A7 (revisión de H19): `config.mcp` como LISTA con una entrada del dominio dentro; sin la guarda `plano(config.mcp)`
  // salía una candidata llamada «0».
  const comoLista = { mcp: [{ type: 'local', command: ['uvx', 'mcp-atlassian'], enabled: true, environment: { JIRA_URL: 'https://jira.x.eu' } }] }
  for (const config of [null, undefined, 'x', 7, [], {}, { mcp: null }, { mcp: [] }, { mcp: 'x' }, comoLista]) {
    eq(mcpScrubCandidates({ config, saved: SAVED_H19, host: 'jira.x.eu' }), { propias: [], ajenas: [], noQuitables: [] }, 'basura: ' + JSON.stringify(config))
  }
  eq(mcpScrubCandidates(), { propias: [], ajenas: [], noQuitables: [] })
  eq(mcpScrubCandidates({ config: CONFIG_H19, saved: 'x', host: '' }), { propias: [], ajenas: [], noQuitables: [] }, 'sin hosts ni nombre, nada')
  // Determinista, y sin tocar lo que recibe.
  const antes = JSON.stringify(CONFIG_H19)
  eq(mcpScrubCandidates({ config: CONFIG_H19, saved: SAVED_H19, host: 'jira.x.eu' }), mcpScrubCandidates({ config: CONFIG_H19, saved: SAVED_H19, host: 'jira.x.eu' }))
  eq(JSON.stringify(CONFIG_H19), antes, 'no muta la configuración')
})

test('SEGURIDAD H19: mcpScrubPatch escribe la entrada ENTERA deshabilitada y sin secretos, nunca {enabled:false} a secas', () => {
  const { propias, ajenas, noQuitables } = mcpScrubCandidates({ config: CONFIG_H19, saved: SAVED_H19, host: 'jira.x.eu' })
  const vacias = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, '']))
  for (const c of [...propias, ...ajenas]) {
    const e = mcpScrubPatch(c)
    assert(e, 'se puede deshabilitar ' + c.name)
    eq(Object.keys(e).sort(), [...MCP_ENTRY_KEYS], 'la entrada ENTERA, con sus cinco claves: ' + c.name)
    eq(e.environment, vacias, 'las diez variables, a vacío: ' + c.name)
    eq(e.enabled, false, 'deshabilitada: ' + c.name)
    eq(e.type, 'local')
    eq(e.command, c.command, 'su command, byte a byte: ' + c.name)
    eq(validMcpEntry(c.name, e, { knownCommand: c.command }), e, 'pasa la barrera tal cual: ' + c.name)
    for (const t of ['pat-jira', 'pat-conf', 'tok-docker', 'tok-viejo', 'tok-conf', 'jira.x.eu']) assert(!JSON.stringify(e).includes(t), 'SEGURIDAD: sin «' + t + '»')
    // Idempotente: deshabilitar lo ya deshabilitado da lo mismo.
    eq(mcpScrubPatch({ name: c.name, enabled: false, command: e.command, type: 'local', timeout: e.timeout, jiraHost: '', confluenceHost: '' }), e, 'idempotente: ' + c.name)
  }
  eq(mcpScrubPatch(propias[0]).timeout, 60000)
  eq(mcpScrubPatch(propias[1]).timeout, 30000, 'el plazo de la entrada se conserva')
  eq(mcpScrubPatch(ajenas[0]).timeout, 60000, 'sin plazo, 60 000')
  eq(mcpScrubPatch(ajenas[0]).command, DOCKER, 'el command de docker del usuario, conservado (knownCommand)')
  for (const t of [999, 600001, 1.5, '60000', null]) eq(mcpScrubPatch({ ...propias[0], timeout: t }).timeout, 60000, 'un plazo fuera de rango, 60 000: ' + t)
  for (const t of [1000, 600000]) eq(mcpScrubPatch({ ...propias[0], timeout: t }).timeout, t, 'los bordes valen')
  // Lo que no se puede deshabilitar: null, sin lanzar.
  eq(mcpScrubPatch(noQuitables[0]), null, 'una remota, no')
  const salto = String.fromCharCode(10)
  for (const raro of [
    null, undefined, 'x', 7, [], {},
    { ...propias[0], type: 'remote' },
    { ...propias[0], type: '' },
    { ...propias[0], command: null },
    { ...propias[0], command: [] },
    { ...propias[0], command: ['uvx', 'mcp' + salto + 'atlassian'] },
    { ...propias[0], name: '__proto__' },
    { ...propias[0], name: 'a b' },
    { ...propias[0], name: 7 },
  ]) {
    eq(mcpScrubPatch(raro), null, 'basura: ' + JSON.stringify(raro))
  }
  // Y nunca otra cosa que enabled false y variables vacías, venga lo que venga en la candidata.
  const trampa = mcpScrubPatch({ ...propias[0], enabled: true, environment: { JIRA_PERSONAL_TOKEN: 'pat-jira' } })
  eq([trampa.enabled, trampa.environment], [false, vacias], 'lo que diga la candidata no entra en la entrada')
})

/** Un cliente de mentira con diario: SÓLO updateMcpEntries (si scrubMcp llamara a otra cosa, reventaría). */
function clienteDeQuitar({ respuesta = { ok: true, status: 200, kind: '' } } = {}) {
  const llamadas = []
  return {
    llamadas,
    async updateMcpEntries(entradas, barrera) {
      llamadas.push([JSON.parse(JSON.stringify(entradas)), JSON.parse(JSON.stringify(barrera))])
      return respuesta
    },
  }
}

test('H19: scrubMcp manda UN PATCH con todas las candidatas, con known, y sin petición si alguna no vale', async () => {
  const { propias, ajenas, noQuitables } = mcpScrubCandidates({ config: CONFIG_H19, saved: SAVED_H19, host: 'jira.x.eu' })
  const candidatas = [propias[0], ajenas[0]]
  const c = clienteDeQuitar()
  const r = await scrubMcp(c, { candidatas })
  eq(r, { ok: true, status: 200, kind: '', names: [FARO, 'docker-atlassian'] })
  eq(Object.keys(r), ['ok', 'status', 'kind', 'names'], 'claves exactas y en su orden')
  eq(c.llamadas.length, 1, 'UN solo PATCH para todas')
  eq(c.llamadas[0][0], { [FARO]: mcpScrubPatch(propias[0]), 'docker-atlassian': mcpScrubPatch(ajenas[0]) }, 'las entradas enteras, deshabilitadas')
  eq(c.llamadas[0][1], { known: { [FARO]: propias[0].command, 'docker-atlassian': DOCKER } }, 'con el command de cada una como conocido')
  assert(!JSON.stringify(c.llamadas).includes('tok-docker') && !JSON.stringify(c.llamadas).includes('pat-jira'), 'SEGURIDAD: ningún token viaja al quitar')
  // Una candidata que no se puede deshabilitar tira la petición entera: ni una llamada.
  const mal = clienteDeQuitar()
  eq(await scrubMcp(mal, { candidatas: [propias[0], noQuitables[0]] }), { ok: false, status: 0, kind: 'entrada', names: ['atlassian-remoto'] })
  eq(mal.llamadas.length, 0, 'sin petición')
  // Sin candidatas, tampoco.
  const nada = clienteDeQuitar()
  eq(await scrubMcp(nada, { candidatas: [] }), { ok: false, status: 0, kind: 'entrada', names: [] })
  eq(await scrubMcp(nada), { ok: false, status: 0, kind: 'entrada', names: [] })
  eq(await scrubMcp(nada, { candidatas: 'x' }), { ok: false, status: 0, kind: 'entrada', names: [] })
  eq(nada.llamadas.length, 0)
  // Lo que diga opencode, tal cual y sin cuerpo.
  const roto = clienteDeQuitar({ respuesta: { ok: false, status: 500, kind: 'ConfigJsonError' } })
  eq(await scrubMcp(roto, { candidatas }), { ok: false, status: 500, kind: 'ConfigJsonError', names: [FARO, 'docker-atlassian'] })
  const mudo = clienteDeQuitar({ respuesta: null })
  eq(await scrubMcp(mudo, { candidatas }), { ok: false, status: 0, kind: '', names: [FARO, 'docker-atlassian'] })
  // En el código: sólo la puerta de las entradas; ni recargar, ni conectar.
  const fuente = sinComentarios(readFileSync(join(import.meta.dirname, '..', '..', 'src/panel/setup.js'), 'utf8'))
  const cuerpo = fuente.slice(fuente.indexOf('export async function scrubMcp('), fuente.indexOf('\n}\n', fuente.indexOf('export async function scrubMcp(')))
  assert(cuerpo.length > 50, 'scrubMcp existe')
  eq(cuerpo.split('client.updateMcpEntries(').length - 1, 1, 'una sola llamada a la puerta')
  assert(!/reloadGlobalConfig|connectMcp|addMcp|client\.request\(/.test(cuerpo), 'ni recargar, ni conectar, ni un PATCH por otro lado')
})

test('H19: scrubEffective — pendiente lo que sigue habilitado o con alguna variable, no lo que ya no está', () => {
  const vacias = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, '']))
  const config = {
    mcp: {
      limpia: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: vacias, enabled: false },
      habilitada: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: vacias, enabled: true },
      sinEnabled: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: vacias },
      conToken: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { ...vacias, CONFLUENCE_PERSONAL_TOKEN: 'x' }, enabled: false },
      conUrl: { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { ...vacias, JIRA_URL: 'https://jira.x.eu' }, enabled: false },
      sinEnv: { type: 'local', command: ['uvx', 'mcp-atlassian'], enabled: false },
    },
  }
  eq(scrubEffective(config, ['limpia', 'habilitada', 'sinEnabled', 'conToken', 'conUrl', 'sinEnv', 'yaNoEsta']), { ok: false, pendientes: ['habilitada', 'sinEnabled', 'conToken', 'conUrl'] })
  eq(scrubEffective(config, ['limpia', 'sinEnv', 'yaNoEsta']), { ok: true, pendientes: [] }, 'lo que ya no está no tiene tokens cargados')
  eq(Object.keys(scrubEffective(config, ['limpia'])), ['ok', 'pendientes'])
  // Sin configuración legible, nada se da por quitado.
  for (const ilegible of [null, undefined, 'x', [], 7]) eq(scrubEffective(ilegible, ['a', 'b']), { ok: false, pendientes: ['a', 'b'] }, 'ilegible: ' + JSON.stringify(ilegible))
  eq(scrubEffective({}, ['a']), { ok: true, pendientes: [] }, 'sin mcp cargado, nada pendiente')
  eq(scrubEffective(config, 'x'), { ok: true, pendientes: [] })
  eq(scrubEffective(JSON.parse('{"mcp":{}}'), ['toString', 'constructor']), { ok: true, pendientes: [] }, 'el prototipo no es una entrada')
})

test('H19: unlinkRecords desmarca por nombre y por host, con el patch exacto, y no toca onboarded ni nada más', () => {
  const sites = {
    'jira.x.eu': { configured: true, mcpName: FARO, product: 'jira', cloud: false, verified: true, confluenceHost: 'confluence.x.eu', onboarded: true, indexedAt: 1758000000000, skill: 'analisis', todaySeenAt: 5 },
    'confluence.x.eu': { configured: true, mcpName: FARO, product: 'confluence', cloud: false, jiraHost: 'jira.x.eu', onboarded: true },
    'enlazado.x.eu': { configured: true, mcpName: 'otro-nombre', product: 'confluence', skippedKeys: true },
    'ajeno.eu': { configured: true, mcpName: 'atlassian-ajeno-eu', product: 'jira', onboarded: true },
    'vacio.eu': { configured: false, mcpName: '' },
  }
  const antes = JSON.stringify(sites)
  // Revisión de H19 (firma nueva): el host de la pestaña, y aparte los enlazados, que sólo se desmarcan si su MCP es el quitado.
  const r = unlinkRecords({ sites, names: [FARO], host: 'JIRA.x.eu', linked: ['ENLAZADO.x.eu'] })
  // Revisión de H19 (D1): el patch CONSERVA mcpName —el esqueleto se reutiliza por él desde cualquier host del MCP—.
  const patch = { configured: false, skippedKeys: false, jiraHost: '', confluenceHost: '' }
  eq(r, [
    { host: 'jira.x.eu', patch },
    { host: 'confluence.x.eu', patch },
  ], 'por nombre los dos del MCP y la pestaña por host (sin distinguir mayúsculas); el enlazado de OTRO MCP y el ajeno, intactos')
  eq(Object.keys(r[0].patch), ['configured', 'skippedKeys', 'jiraHost', 'confluenceHost'], 'claves exactas y en su orden: sin mcpName, que se conserva')
  for (const x of r) for (const k of ['mcpName', 'onboarded', 'indexedAt', 'skill', 'todaySeenAt', 'verified', 'product']) assert(!(k in x.patch), 'no toca ' + k + ': no es «Olvidar este sitio»')
  eq(JSON.stringify(sites), antes, 'no muta lo que recibe')
  assert(r[0].patch !== r[1].patch, 'un patch por registro')
  eq(unlinkRecords({ sites, names: [''] }), [], 'un nombre vacío no casa con un registro sin MCP')
  eq(unlinkRecords({ sites, names: [], host: 'vacio.eu' }).map((x) => x.host), ['vacio.eu'])
  eq(unlinkRecords({ sites, names: [], host: 'enlazado.x.eu' }).map((x) => x.host), ['enlazado.x.eu'], 'el host de la pestaña se desmarca SIEMPRE, apunte a lo que apunte')
  for (const raro of [null, undefined, 'x', [], 7]) eq(unlinkRecords({ sites: raro, names: [FARO], host: 'jira.x.eu' }), [], 'sites sin forma: ' + JSON.stringify(raro))
  eq(unlinkRecords(), [])
  eq(unlinkRecords({ sites, names: 'x', host: 7, linked: 'y' }), [])
})

test('H19: scrubConfirmText dice qué se deshabilita, el host enlazado, que afecta a cualquier cliente, y lo que se queda', () => {
  const carpeta = 'C:\\Users\\m\\.config\\opencode'
  const t = scrubConfirmText({ propias: [FARO], ajenas: ['docker-atlassian'], noQuitables: ['atlassian-remoto'], hostsEnlazados: ['confluence.x.eu'], carpeta })
  // Revisión de H19 (D3): un cuarto texto, `restos`.
  eq(Object.keys(t), ['principal', 'ajenas', 'noQuitables', 'restos'])
  eq(
    t.principal,
    `Se deshabilitarán en la configuración de opencode, sin claves: «${FARO}». También deja sin claves confluence.x.eu, que usa esa misma entrada. Afecta a cualquier cliente de este opencode, la TUI incluida: opencode reinicia sus conexiones y una respuesta a medias en otra ventana se corta. Queda una entrada deshabilitada y sin claves en ${carpeta} (no hay borrado por la API), que Faro reutiliza al volver a guardarlas. Después te volverá a pedir las claves.`
  )
  eq(t.ajenas, 'También «docker-atlassian», que no es de Faro. Si no lo marcas, el sitio la seguirá adoptando y volverá a quedar configurado.')
  eq(t.noQuitables, '«atlassian-remoto» no se puede deshabilitar desde aquí (no es un MCP local de la forma que Faro escribe): quítala a mano.')
  // Dos ajenas: en plural. Dos no quitables, también.
  eq(scrubConfirmText({ propias: [FARO], ajenas: ['a1', 'a2'] }).ajenas, 'También «a1», «a2», que no son de Faro. Si no lo marcas, el sitio las seguirá adoptando y volverá a quedar configurado.')
  eq(scrubConfirmText({ noQuitables: ['r1', 'r2'] }).noQuitables, '«r1», «r2» no se pueden deshabilitar desde aquí (no son MCP locales de la forma que Faro escribe): quítalas a mano.')
  // Sin host enlazado ni carpeta.
  const solo = scrubConfirmText({ propias: [FARO, 'guardado-viejo'] })
  assert(solo.principal.includes(`sin claves: «${FARO}», «guardado-viejo». Afecta`), 'sin enlazado, no se nombra ninguno')
  assert(solo.principal.includes('en la carpeta de configuración de opencode (no hay borrado'), 'sin carpeta, se dice cuál')
  eq([solo.ajenas, solo.noQuitables], ['', ''])
  // Revisión de H19 (D9): sin «(enlazado)», y concordando en número.
  eq(scrubConfirmText({ hostsEnlazados: ['a.eu', 'b.eu'], propias: [FARO] }).principal.includes('deja sin claves a.eu y b.eu, que usan esa misma entrada.'), true)
  // Sólo ajenas: este sitio no tiene nada de Faro.
  eq(scrubConfirmText({ ajenas: ['docker-atlassian'] }).principal, 'Este sitio no tiene ninguna entrada de Faro en opencode; sólo «docker-atlassian», que no es de Faro.')
  // Nada: dicho.
  eq(scrubConfirmText(), { principal: 'Este sitio no tiene claves en la configuración de opencode que quitar.', ajenas: '', noQuitables: '', restos: '' })
  // Revisión de H19 (D4): con algo que no se puede quitar, la principal ya no dice que no hay claves (se contradecía con su propio noQuitables).
  eq(scrubConfirmText({ noQuitables: ['r'] }).principal, 'Este sitio tiene claves en la configuración de opencode que Faro no puede quitar desde aquí.')
  // Nombres raros, omitidos; y todo en UNA línea sin invisibles.
  const nel = String.fromCharCode(0x85)
  const ls = String.fromCharCode(0x2028)
  const rlo = String.fromCharCode(0x202e)
  const zw = String.fromCharCode(0x200b)
  const raro = scrubConfirmText({
    propias: ['__proto__', 'a b', 'x' + ls + 'y', FARO],
    ajenas: ['bien' + rlo, 'docker-atlassian'],
    noQuitables: ['mal' + nel],
    hostsEnlazados: ['conf' + zw + '.x.eu', 'con espacio.eu', 'confluence.x.eu'],
    carpeta: 'C:\\x' + String.fromCharCode(10) + 'y' + nel + 'z' + rlo,
  })
  assert(raro.principal.includes(`sin claves: «${FARO}». También deja sin claves confluence.x.eu, que usa esa misma entrada.`), 'sólo los nombres y hosts con forma: ' + raro.principal)
  eq(raro.ajenas, 'También «docker-atlassian», que no es de Faro. Si no lo marcas, el sitio la seguirá adoptando y volverá a quedar configurado.')
  // Revisión de H19 (D4): el nombre raro NO se imprime, pero se cuenta y se dice.
  eq(raro.noQuitables, 'Hay 1 entrada con un nombre que Faro no puede escribir: quítala a mano en C:\\x y z.', 'el nombre omitido, contado y sin imprimir')
  for (const texto of Object.values(raro)) {
    for (const ch of [String.fromCharCode(10), String.fromCharCode(13), nel, ls, String.fromCharCode(0x2029), rlo, zw]) assert(!texto.includes(ch), 'una línea y sin invisibles: ' + JSON.stringify(texto))
  }
  assert(raro.principal.includes('C:\\x y z (no hay'), 'la carpeta en una línea')
  assert(scrubConfirmText({ propias: [FARO], carpeta: zw + rlo + ' ' }).principal.includes('en la carpeta de configuración de opencode (no hay'), 'una carpeta que sólo son invisibles es no tener carpeta')
  // Candidatas enteras también valen (se lee su nombre).
  eq(scrubConfirmText({ propias: [{ name: FARO }] }).principal, scrubConfirmText({ propias: [FARO] }).principal)
})

// ---------------------------------------------------------------------------
// Revisión adversaria de H19: lo que el registro conserva al quitar, qué es «de
// Faro», los datos que Faro no sabe vaciar, los enlazados de otro MCP y los textos.
// ---------------------------------------------------------------------------
const V_FIJADA = 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION

test('Revisión H19: el registro conserva mcpName al quitar, y el esqueleto se reutiliza desde cualquier host', () => {
  // D1: con mcpName '' y las URL vacías, el esqueleto sólo se encontraba por mcpNameForHost(host de la pestaña):
  // desde el host ENLAZADO de un Data Center, o con una entrada adoptada de nombre propio, volver a guardar
  // creaba una entrada nueva y lo dejaba huérfano, y la pantalla de claves no decía la frase «disabled».
  const sites = {
    'jira.x.eu': { configured: true, mcpName: FARO, product: 'jira', cloud: false, verified: true, confluenceHost: 'confluence.x.eu', onboarded: true },
    'confluence.x.eu': { configured: true, mcpName: FARO, product: 'confluence', cloud: false, jiraHost: 'jira.x.eu', onboarded: true },
  }
  const config = { mcp: { [FARO]: { type: 'local', command: ['uvx', V_FIJADA], environment: buildMcpConfig(DC).environment, enabled: true, timeout: 60000 } } }
  const { propias } = mcpScrubCandidates({ config, saved: sites['jira.x.eu'], host: 'jira.x.eu' })
  eq(nombres(propias), [FARO])
  // Lo que queda en el fichero tras el PATCH (la fusión profunda con la entrada entera deshabilitada).
  const esqueleto = { mcp: { [FARO]: mcpScrubPatch(propias[0]) } }
  const desmarcados = unlinkRecords({ sites, names: [FARO], host: 'jira.x.eu', linked: ['confluence.x.eu'] })
  eq(desmarcados.map((x) => x.host), ['jira.x.eu', 'confluence.x.eu'])
  for (const { host, patch } of desmarcados) {
    const saved = { ...sites[host], ...patch }
    eq(saved.mcpName, FARO, 'el registro conserva el nombre: ' + host)
    eq([saved.configured, saved.skippedKeys], [false, false], 'y queda sin configurar: la pantalla de claves por el camino normal')
    eq(keysUnverified(saved), false, 'sin configurar, no avisa de claves sin comprobar: ' + host)
    eq(mcpForHost(esqueleto, host), null, 'el esqueleto deshabilitado no se adopta (sin bucle): ' + host)
    eq(chosenMcpName(esqueleto, saved, host), FARO, 'la pantalla de claves mira el esqueleto y dice «disabled»: ' + host)
    const t = chooseWriteTarget({ config: esqueleto, saved, host })
    eq([t.name, t.reuse, t.knownCommand], [FARO, true, ['uvx', V_FIJADA]], 'volver a guardar desde ' + host + ' reutiliza el esqueleto')
  }
  // El control de que el pin mide algo: con el patch de antes (mcpName ''), desde el enlazado se creaba otra.
  const conElDeAntes = chooseWriteTarget({ config: esqueleto, saved: { ...sites['confluence.x.eu'], mcpName: '' }, host: 'confluence.x.eu' })
  eq([conElDeAntes.name, conElDeAntes.reuse], [mcpNameForHost('confluence.x.eu'), false], 'control: sin el nombre, una entrada nueva')
  // Una entrada ADOPTADA en H18 con docker: se quita (con su casilla, D2) y al volver a guardar se reutiliza con SU command.
  const docker = { mcp: { atlassian: { type: 'local', command: DOCKER, environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'tok-docker' }, enabled: true } } }
  const adoptado = { 'jira.x.eu': { configured: true, mcpName: 'atlassian', product: 'jira', cloud: false } }
  const cd = mcpScrubCandidates({ config: docker, saved: adoptado['jira.x.eu'], host: 'jira.x.eu' })
  eq(nombres(cd.ajenas), ['atlassian'])
  const esqDocker = { mcp: { atlassian: mcpScrubPatch(cd.ajenas[0]) } }
  const [d] = unlinkRecords({ sites: adoptado, names: ['atlassian'], host: 'jira.x.eu', linked: [] })
  const td = chooseWriteTarget({ config: esqDocker, saved: { ...adoptado['jira.x.eu'], ...d.patch }, host: 'jira.x.eu' })
  eq([td.name, td.reuse, td.knownCommand, td.standard], ['atlassian', true, DOCKER, false], 'la docker del usuario se reutiliza con su command, y no se crea otra con uvx')
})

test('Revisión H19: una entrada adoptada con otro command es ajena; la de Faro, propia por su command', () => {
  // D2: la adopción de H18 apunta en saved.mcpName la entrada del USUARIO (pegada a mano, docker), así que el nombre
  // guardado ya no basta para ser «de Faro»: hace falta además el command de Faro.
  const env = { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'tok' }
  const clase = (command, saved = { mcpName: 'mio' }) => {
    const r = mcpScrubCandidates({ config: { mcp: { mio: { type: 'local', command, environment: env, enabled: true } } }, saved, host: 'jira.x.eu' })
    return r.propias.length ? 'propia' : r.ajenas.length ? 'ajena' : r.noQuitables.length ? 'noQuitable' : 'nada'
  }
  eq(clase(DOCKER), 'ajena', 'una docker adoptada bajo saved.mcpName: ajena, con su casilla')
  eq(clase(['node', 'C:\\mcp\\atlassian.mjs']), 'ajena', 'una ruta propia, ajena')
  eq(clase(['uvx', V_FIJADA]), 'propia', 'uvx con la versión fijada')
  eq(clase(['uvx', 'mcp-atlassian']), 'propia', 'uvx sin versión (lo de antes de H15)')
  eq(clase(['C:\\Users\\m\\.local\\bin\\uvx.exe', V_FIJADA]), 'propia', 'la ruta absoluta de uvx del reintento de H18')
  eq(clase(['C:\\Users\\m\\.local\\bin\\uvx.exe', 'mcp-atlassian']), 'propia', 'la ruta absoluta sin versión')
  eq(clase(['uvx', 'mcp-atlassian@0.1.0']), 'ajena', 'otra versión no la escribe Faro')
  eq(clase(['C:\\Users\\m\\.local\\bin\\uvx.exe', 'mcp-atlassian@0.1.0']), 'ajena', 'la ruta absoluta con otra versión, tampoco')
  eq(clase(['C:\\a&b\\uvx.exe', V_FIJADA]), 'ajena', 'una ruta que la barrera no acepta como de Faro')
  eq(clase(['C:\\Users\\m\\.local\\bin\\uvx.exe', V_FIJADA, '--x']), 'ajena', 'un argumento de más')
  eq(clase(['UVX', V_FIJADA]), 'ajena', 'las mayúsculas no son el command de Faro')
  // Sin nombre guardado, la del usuario con el command de Faro y OTRO nombre sigue siendo ajena: se mira por dominio.
  eq(clase(['uvx', V_FIJADA], null), 'ajena', 'sin nombre guardado, por dominio: ajena')
  // Por el nombre de Faro de un host mirado, propia sea cual sea su command: es el esqueleto de Faro.
  const deFaro = mcpScrubCandidates({ config: { mcp: { [FARO]: { type: 'local', command: DOCKER, environment: env, enabled: true } } }, saved: null, host: 'jira.x.eu' })
  eq(nombres(deFaro.propias), [FARO], 'el nombre de Faro manda')
})

test('Revisión H19: restos — variables de más o argumentos CLAVE=valor, sin copiar nada', () => {
  // D3: la fusión profunda del PATCH no quita claves, así que lo que la entrada lleve FUERA de las diez variables (o
  // en los argumentos de su command) se queda en disco. Se DICE, sin copiar ni el nombre ni el valor.
  const base = buildMcpConfig(DC).environment
  const img = 'ghcr.io/sooperset/mcp-atlassian:0.23.1'
  const config = {
    mcp: {
      [FARO]: { type: 'local', command: ['uvx', V_FIJADA], environment: { ...base, JIRA_SSL_VERIFY: 'secreto-ssl' }, enabled: true },
      limpia: { type: 'local', command: ['uvx', V_FIJADA], environment: base, enabled: true },
      'de-mas-vacia': { type: 'local', command: ['uvx', V_FIJADA], environment: { ...base, OTRA_VARIABLE: '' }, enabled: true },
      'de-mas-no-cadena': { type: 'local', command: ['uvx', V_FIJADA], environment: { ...base, OTRA_VARIABLE: 7 }, enabled: true },
      'docker-en-linea': { type: 'local', command: ['docker', 'run', '-e', 'JIRA_PERSONAL_TOKEN=tok-en-linea', img], environment: { JIRA_URL: 'https://jira.x.eu' }, enabled: false },
      'docker-por-nombre': { type: 'local', command: ['docker', 'run', '-e', 'JIRA_PERSONAL_TOKEN', img], environment: { JIRA_URL: 'https://jira.x.eu' }, enabled: true },
      'clave-vacia': { type: 'local', command: ['docker', 'run', 'CLAVE=', img], environment: { JIRA_URL: 'https://jira.x.eu' }, enabled: true },
      'guion-delante': { type: 'local', command: ['docker', 'run', '--env=CLAVE', img], environment: { JIRA_URL: 'https://jira.x.eu' }, enabled: true },
      'sin-environment': { type: 'local', command: ['uvx', V_FIJADA], enabled: true },
    },
  }
  const r = mcpScrubCandidates({ config, saved: { mcpName: 'sin-environment' }, host: 'jira.x.eu' })
  const restos = Object.fromEntries([...r.propias, ...r.ajenas, ...r.noQuitables].map((c) => [c.name, c.restos]))
  eq(restos, {
    [FARO]: true,
    'sin-environment': false,
    limpia: false,
    'de-mas-vacia': false,
    'de-mas-no-cadena': false,
    'docker-en-linea': true,
    'docker-por-nombre': false,
    'clave-vacia': false,
    'guion-delante': false,
  }, 'las propias primero (la de Faro y la del nombre guardado con el command de Faro), y las ajenas')
  const conProto = JSON.parse('{"mcp":{"raro":{"type":"local","command":["uvx","mcp-atlassian"],"environment":{"JIRA_URL":"https://jira.x.eu","__proto__":"valor"},"enabled":true}}}')
  eq(mcpScrubCandidates({ config: conProto, saved: null, host: 'jira.x.eu' }).ajenas[0].restos, true, 'una variable «__proto__» también es una variable de más')
  // SEGURIDAD: ni el nombre ni el valor de la variable de más salen en las candidatas ni en los textos.
  const json = JSON.stringify(r)
  for (const t of ['JIRA_SSL_VERIFY', 'secreto-ssl', 'OTRA_VARIABLE']) assert(!json.includes(t), 'SEGURIDAD: «' + t + '» no sale en las candidatas')
  const conRestos = [...r.propias, ...r.ajenas].filter((c) => c.restos)
  const carpeta = 'C:\\Users\\m\\.config\\opencode'
  const t = scrubConfirmText({ propias: r.propias, ajenas: r.ajenas, conRestos, carpeta })
  eq(t.restos, `«${FARO}», «docker-en-linea» guardan además datos que Faro no sabe vaciar (variables de más o argumentos de su comando): quítalos a mano en ${carpeta}.`)
  for (const x of Object.values(t)) for (const s of ['JIRA_SSL_VERIFY', 'secreto-ssl', 'tok-en-linea']) assert(!x.includes(s), 'SEGURIDAD: «' + s + '» no sale en los textos')
  eq(scrubConfirmText({ propias: [FARO], conRestos: [FARO] }).restos, `«${FARO}» guarda además datos que Faro no sabe vaciar (variables de más o argumentos de su comando): quítalos a mano en la carpeta de configuración de opencode.`, 'una, en singular y sin carpeta')
  eq(scrubConfirmText({ propias: [FARO], conRestos: ['a b', null] }).restos, '', 'sin nombres con forma, nada')
  eq(scrubConfirmText({ propias: [FARO] }).restos, '')
})

test('Revisión H19: los enlazados sólo se desmarcan si su MCP se quitó', () => {
  // D9: un host enlazado cuyo registro apunta a OTRO MCP no pierde nada al quitar: se desmarcaba por host, y en su
  // siguiente arranque la adopción salía «sin comprobar» de unas claves que sí estaban comprobadas.
  const sites = {
    'jira.x.eu': { configured: true, mcpName: 'otro-de-la-pestana' },
    'conf-otro.x.eu': { configured: true, mcpName: 'otro-nombre', verified: true },
    'conf-vacio.x.eu': { configured: true, mcpName: '' },
    'conf-quitado.x.eu': { configured: true, mcpName: FARO },
    'conf-sin-nombre.x.eu': { configured: true },
    'lejano.eu': { configured: true, mcpName: FARO },
    'nada.eu': { configured: true, mcpName: 'otro-nombre' },
  }
  // Con mayúsculas: el host se compara sin distinguirlas (los registros se guardan por hostname, en minúsculas).
  const linked = ['CONF-OTRO.x.eu', 'CONF-VACIO.x.eu', 'conf-quitado.x.eu', ' conf-sin-nombre.x.eu ']
  const hosts = (r) => r.map((x) => x.host)
  eq(
    hosts(unlinkRecords({ sites, names: [FARO], host: 'jira.x.eu', linked })),
    ['jira.x.eu', 'conf-vacio.x.eu', 'conf-quitado.x.eu', 'conf-sin-nombre.x.eu', 'lejano.eu'],
    'la pestaña SIEMPRE; el enlazado con mcpName vacío o quitado, sí; el de OTRO MCP, intacto; el de fuera, por nombre'
  )
  eq(hosts(unlinkRecords({ sites, names: [FARO], host: 'jira.x.eu' })), ['jira.x.eu', 'conf-quitado.x.eu', 'lejano.eu'], 'sin enlazados, sólo la pestaña y por nombre')
  eq(hosts(unlinkRecords({ sites, names: ['otro-nombre'], host: 'jira.x.eu', linked: ['conf-otro.x.eu'] })), ['jira.x.eu', 'conf-otro.x.eu', 'nada.eu'], 'si su MCP es el quitado, se desmarca')
  eq(hosts(unlinkRecords({ sites, names: [], linked })), ['conf-vacio.x.eu', 'conf-sin-nombre.x.eu'], 'sin pestaña ni nombres, sólo los enlazados sin MCP')
})

test('Revisión H19: los textos — sólo noQuitables, nombres omitidos contados, ajenas apagadas, plural con varias ajenas, restos', () => {
  const carpeta = 'C:\\Users\\m\\.config\\opencode'
  // D4: con sólo lo que no se puede quitar, la principal no dice «no tiene claves»; y el nombre que no se puede
  // escribir no se imprime, pero se cuenta y se dice.
  const cfg = { mcp: { 'Atlassian Jira': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'tok' }, enabled: true } } }
  const c = mcpScrubCandidates({ config: cfg, saved: null, host: 'jira.x.eu' })
  eq(nombres(c.noQuitables), ['Atlassian Jira'])
  const soloNo = scrubConfirmText({ ...c, carpeta })
  eq(soloNo, {
    principal: 'Este sitio tiene claves en la configuración de opencode que Faro no puede quitar desde aquí.',
    ajenas: '',
    noQuitables: `Hay 1 entrada con un nombre que Faro no puede escribir: quítala a mano en ${carpeta}.`,
    restos: '',
  })
  assert(!JSON.stringify(soloNo).includes('Atlassian Jira'), 'el nombre raro no se imprime')
  eq(
    scrubConfirmText({ noQuitables: ['atlassian-remoto', 'Atlassian Jira', { name: 'a b' }], carpeta }).noQuitables,
    `«atlassian-remoto» no se puede deshabilitar desde aquí (no es un MCP local de la forma que Faro escribe): quítala a mano. Y 2 entradas con un nombre que Faro no puede escribir: quítalas a mano en ${carpeta}.`
  )
  eq(scrubConfirmText({ noQuitables: ['Atlassian Jira'] }).noQuitables, 'Hay 1 entrada con un nombre que Faro no puede escribir: quítala a mano en la carpeta de configuración de opencode.')
  eq(scrubConfirmText({ noQuitables: [null, 7, {}, ''] }), scrubConfirmText(), 'lo que no trae ningún nombre no es una entrada')
  // C9: la principal concuerda con varias ajenas.
  eq(scrubConfirmText({ ajenas: ['a-b', 'c-d'] }).principal, 'Este sitio no tiene ninguna entrada de Faro en opencode; sólo «a-b», «c-d», que no son de Faro.')
  // D10: una ajena ya deshabilitada no «se sigue adoptando» (mcpForHost salta las deshabilitadas): guarda claves en disco.
  const apagada = scrubConfirmText({ propias: [FARO], ajenas: ['apagada'], ajenasApagadas: ['apagada'] })
  eq(apagada.ajenas, 'También «apagada», que no es de Faro: está deshabilitada pero guarda claves en disco; márcala para vaciarla.')
  assert(!apagada.ajenas.includes('seguirá adoptando'), 'una apagada no se sigue adoptando')
  eq(
    scrubConfirmText({ propias: [FARO], ajenas: ['a1', 'a2'], ajenasApagadas: ['a1', 'a2'] }).ajenas,
    'También «a1», «a2», que no son de Faro: están deshabilitadas pero guardan claves en disco; márcalas para vaciarlas.'
  )
  eq(
    scrubConfirmText({ propias: [FARO], ajenas: ['viva', 'apagada'], ajenasApagadas: [{ name: 'apagada' }] }).ajenas,
    'También «viva», que no es de Faro. Si no lo marcas, el sitio la seguirá adoptando y volverá a quedar configurado. También «apagada», que no es de Faro: está deshabilitada pero guarda claves en disco; márcala para vaciarla.'
  )
  eq(scrubConfirmText({ propias: [FARO], ajenasApagadas: ['suelta'] }).ajenas, '', 'una apagada que no está entre las ajenas no se dice')
  // Con las candidatas de verdad: una ajena deshabilitada del dominio.
  const conApagada = { mcp: { 'apagada-a-mano': { type: 'local', command: ['uvx', 'mcp-atlassian'], environment: { JIRA_URL: 'https://jira.x.eu', JIRA_PERSONAL_TOKEN: 'secreto' }, enabled: false } } }
  const ca = mcpScrubCandidates({ config: conApagada, saved: null, host: 'jira.x.eu' })
  eq([nombres(ca.ajenas), ca.ajenas[0].enabled, mcpForHost(conApagada, 'jira.x.eu')], [['apagada-a-mano'], false, null])
  assert(scrubConfirmText({ ajenas: ca.ajenas, ajenasApagadas: ca.ajenas.filter((x) => x.enabled === false) }).ajenas.includes('guarda claves en disco'))
  // D3: los restos, su cuarto texto (el detalle, en su prueba).
  eq(scrubConfirmText({ propias: [FARO], conRestos: [FARO], carpeta }).restos, `«${FARO}» guarda además datos que Faro no sabe vaciar (variables de más o argumentos de su comando): quítalos a mano en ${carpeta}.`)
})

test('H19: keysUnverified sólo avisa en un sitio configurado', () => {
  // EL CAMBIO: tras «Quitar las claves» el registro queda configured false, y su verified viejo no dice nada de unas claves que ya no existen.
  eq(keysUnverified({ configured: true, verified: false }), true, 'configurado y sin comprobar: avisa')
  eq(keysUnverified({ verified: false }), false, 'H19: sin configured true, no avisa (antes sí)')
  eq(keysUnverified({ configured: false, verified: false }), false, 'H19: lo que deja «Quitar las claves», no avisa')
  eq(keysUnverified({ configured: false, mcpName: '', skippedKeys: false, verified: false, onboarded: true }), false, 'el registro real tras quitar')
  eq(keysUnverified({ configured: 'true', verified: false }), false, 'configured en texto no es configurado')
  eq(keysUnverified({ configured: true, verified: true }), false)
  eq(keysUnverified({ configured: true }), false, 'la migración de H18 sigue: sin verified, verificado')
  // Y la adopción sigue decidiendo igual: un host que estaba configurado y sin comprobar no se da por probado.
  const registros = siteRecords({ host: 'jira.x.eu', product: 'jira', mcpName: FARO })
  eq(adoptionRecords({ registros, sites: { 'jira.x.eu': { configured: true, mcpName: FARO, verified: false } }, mcpName: FARO })[0].patch.verified, false)
})
