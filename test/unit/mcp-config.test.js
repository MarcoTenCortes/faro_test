/**
 * La barrera de lo que Faro puede escribir en la configuración de opencode
 * (src/shared/mcp-config.js, H18, docs/PLAN2.md §3.2 y §8.24).
 *
 * Desde H18 Faro escribe con PATCH /global/config en el mismo fichero donde
 * viven `agent`, `permission`, `plugin` y `command`: todo lo que no sea una
 * entrada MCP de Atlassian con la forma exacta tiene que quedarse fuera, y eso
 * se EJECUTA aquí con entradas hostiles, no se lee.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  MCP_ENTRY_KEYS,
  MCP_ENV_KEYS,
  UVX_ABS_PATH,
  validMcpCommand,
  validMcpName,
  validMcpEntry,
  mcpPatchBody,
} from '../../src/shared/mcp-config.js'
import { MCP_ATLASSIAN_VERSION } from '../../src/shared/config.js'

const ROOT = join(import.meta.dirname, '..', '..')
const V = 'mcp-atlassian@' + MCP_ATLASSIAN_VERSION
const NEL = String.fromCharCode(0x85)
const LS = String.fromCharCode(0x2028)
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)
const NUL = String.fromCharCode(0)

/** Una entrada buena, como la escribe Faro en Data Center. */
function entrada(cambios = {}) {
  const environment = Object.fromEntries(MCP_ENV_KEYS.map((k) => [k, '']))
  Object.assign(environment, {
    JIRA_URL: 'https://jira.x.eu',
    JIRA_PERSONAL_TOKEN: 'pat-de-mentira',
    READ_ONLY_MODE: 'true',
    TOOLSETS: 'all',
  })
  return { type: 'local', command: ['uvx', V], environment, enabled: true, timeout: 60000, ...cambios }
}

test('H18: las claves de una entrada y del environment son las exactas, y no se pueden tocar', () => {
  eq([...MCP_ENTRY_KEYS], ['command', 'enabled', 'environment', 'timeout', 'type'])
  eq([...MCP_ENV_KEYS], [
    'JIRA_URL',
    'JIRA_PERSONAL_TOKEN',
    'JIRA_USERNAME',
    'JIRA_API_TOKEN',
    'CONFLUENCE_URL',
    'CONFLUENCE_PERSONAL_TOKEN',
    'CONFLUENCE_USERNAME',
    'CONFLUENCE_API_TOKEN',
    'READ_ONLY_MODE',
    'TOOLSETS',
  ])
  assert(Object.isFrozen(MCP_ENTRY_KEYS) && Object.isFrozen(MCP_ENV_KEYS), 'congeladas')
  assert(UVX_ABS_PATH.test('C:\\Users\\marco\\.local\\bin\\uvx.exe'))
})

test('SEGURIDAD H18: validMcpCommand — la lista blanca, la ruta absoluta de uvx sin metacaracteres, y lo conocido byte a byte', () => {
  const abs = 'C:\\Users\\marco\\.local\\bin\\uvx.exe'
  for (const bueno of [
    ['uvx', 'mcp-atlassian'],
    ['uvx', V],
    [abs, V],
    [abs, 'mcp-atlassian'],
    ['C:\\Users\\Marco Tenorio\\.local\\bin\\uvx.exe', V],
    ['D:\\herramientas (x86)\\uv\\uvx.exe', V],
  ]) {
    assert(validMcpCommand(bueno), 'vale: ' + JSON.stringify(bueno))
  }
  for (const malo of [
    ['uvx', 'mcp-atlassian@0.1.0'],
    ['uvx', 'mcp-atlassian@latest'],
    ['uvx'],
    ['uvx', 'mcp-atlassian', '--transport', 'sse'],
    ['npx', 'mcp-atlassian'],
    ['cmd', '/c', 'uvx mcp-atlassian'],
    ['C:\\Users\\a&b\\uvx.exe', V],
    ['C:\\Users\\a^b\\uvx.exe', V],
    ['C:\\Users\\a|b\\uvx.exe', V],
    ['C:\\Users\\a<b\\uvx.exe', V],
    ['C:\\Users\\a>b\\uvx.exe', V],
    ['C:\\Users\\a"b\\uvx.exe', V],
    ['C:\\Users\\%USERNAME%\\uvx.exe', V],
    ['C:\\Users\\marco\\..\\otro\\uvx.exe', V],
    ['C:\\Users\\.\\uvx.exe', V],
    ['uvx.exe', V],
    ['.\\bin\\uvx.exe', V],
    ['C:uvx.exe', V],
    ['\\\\servidor\\c$\\uvx.exe', V],
    ['C:/Users/marco/uvx.exe', V],
    ['C:\\Users\\marco\\uvx.exe.bat', V],
    ['C:\\Users\\marco\\uvx.exe ', V],
    ['C:\\Users\\ma\nrco\\uvx.exe', V],
    ['C:\\Users\\ma' + NEL + 'rco\\uvx.exe', V],
    ['C:\\Users\\ma' + RLO + 'rco\\uvx.exe', V],
    ['uvx', 'mcp-atlassian' + NUL],
    'uvx mcp-atlassian',
    ['uvx', 7],
    [],
    null,
  ]) {
    eq(validMcpCommand(malo), false, 'no vale: ' + JSON.stringify(malo))
  }
  // Lo que el usuario ya tiene escrito para ESE nombre se conserva, byte a byte y nada más.
  const docker = ['docker', 'run', '-i', '--rm', 'ghcr.io/sooperset/mcp-atlassian:0.23.1']
  assert(validMcpCommand(docker, { known: docker }), 'el conocido vale')
  assert(validMcpCommand(['uvx', 'mcp-atlassian@0.1.0'], { known: ['uvx', 'mcp-atlassian@0.1.0'] }), 'otra versión, sólo si ya estaba así')
  eq(validMcpCommand(docker, { known: ['docker', 'run'] }), false, 'uno parecido no')
  eq(validMcpCommand(docker, { known: 'docker run -i --rm ghcr.io/sooperset/mcp-atlassian:0.23.1' }), false, 'lo conocido tiene que ser una lista')
  eq(validMcpCommand(docker), false, 'sin conocido, docker no está en la lista blanca')
})

test('SEGURIDAD H18: validMcpName — un nombre, no una ruta ni el prototipo', () => {
  for (const bueno of ['a', 'atlassian-jira-x-eu', 'Mio_2.0', 'x'.repeat(64), 'constructor']) assert(validMcpName(bueno), 'vale: ' + bueno)
  for (const malo of ['', ' a', 'a b', 'a/b', 'a\\b', '__proto__', 'x'.repeat(65), '-a', '.a', '_a', 'á', 'a' + NEL, 7, null, undefined]) {
    eq(validMcpName(malo), false, 'no vale: ' + JSON.stringify(malo))
  }
})

test('SEGURIDAD H18: validMcpEntry reconstruye con claves blancas y tira lo que no es un MCP de Faro', () => {
  const buena = entrada()
  eq(validMcpEntry('atlassian-jira-x-eu', buena), buena, 'la buena, igual')
  eq(Object.keys(validMcpEntry('n', buena)), ['type', 'command', 'environment', 'enabled', 'timeout'])
  eq(Object.keys(validMcpEntry('n', buena).environment), [...MCP_ENV_KEYS])
  // Una clave de más en la entrada: ninguna (agent, permission, plugin… serían código).
  for (const clave of ['agent', 'permission', 'plugin', 'cwd', 'headers', 'url', 'oauth', 'mcp', '__proto__']) {
    const conMas = JSON.parse(JSON.stringify(buena))
    conMas[clave] = { x: 1 }
    if (clave === '__proto__') Object.defineProperty(conMas, '__proto__', { value: { x: 1 }, enumerable: true, configurable: true, writable: true })
    eq(validMcpEntry('n', conMas), null, 'una clave de más: ' + clave)
  }
  for (const falta of MCP_ENTRY_KEYS) {
    const sin = entrada()
    delete sin[falta]
    eq(validMcpEntry('n', sin), null, 'le falta ' + falta)
  }
  eq(validMcpEntry('n', entrada({ type: 'remote' })), null, 'sólo local')
  eq(validMcpEntry('n', entrada({ command: ['node', 'C:\\x\\mcp.mjs'] })), null, 'un command fuera de la lista')
  eq(validMcpEntry('con espacio', buena), null, 'un nombre sin forma')
  // El environment: exactamente las diez.
  eq(validMcpEntry('n', entrada({ environment: { ...buena.environment, OTRA: 'x' } })), null, 'una variable de más')
  const menos = { ...buena.environment }
  delete menos.TOOLSETS
  eq(validMcpEntry('n', entrada({ environment: menos })), null, 'una de menos: van las diez siempre')
  for (const valor of ['a\nb', 'a\rb', 'a' + NEL + 'b', 'a' + LS + 'b', 'a' + RLO + 'b', 'a' + ZWSP + 'b', 'a' + NUL, 'x'.repeat(5000), 7, null, true]) {
    eq(validMcpEntry('n', entrada({ environment: { ...buena.environment, JIRA_PERSONAL_TOKEN: valor } })), null, 'valor sin forma: ' + JSON.stringify(valor).slice(0, 30))
  }
  assert(validMcpEntry('n', entrada({ environment: { ...buena.environment, JIRA_PERSONAL_TOKEN: 'x'.repeat(4096) } })), 'hasta 4096')
  eq(validMcpEntry('n', entrada({ environment: ['x'] })), null)
  for (const enabled of ['true', 1, null]) eq(validMcpEntry('n', entrada({ enabled })), null, 'enabled no booleano: ' + enabled)
  assert(validMcpEntry('n', entrada({ enabled: false })), 'false vale (una entrada deshabilitada)')
  for (const timeout of [999, 600001, 1.5, '60000', NaN, null, -1]) eq(validMcpEntry('n', entrada({ timeout })), null, 'plazo fuera: ' + timeout)
  assert(validMcpEntry('n', entrada({ timeout: 1000 })) && validMcpEntry('n', entrada({ timeout: 600000 })), 'los bordes valen')
  // Idempotente, y lo que devuelve es otro objeto: tocarlo no toca lo que entró.
  const una = validMcpEntry('n', buena)
  eq(validMcpEntry('n', una), una)
  una.command.push('--otra')
  una.environment.JIRA_URL = 'https://evil.example'
  eq(buena.command, ['uvx', V])
  eq(buena.environment.JIRA_URL, 'https://jira.x.eu')
  for (const raro of [null, [], 'x', 7]) eq(validMcpEntry('n', raro), null)
})

test('H18: allowCommand es una puerta de PRUEBA explícita; el panel y el cliente no la nombran', () => {
  const juguete = entrada({ command: ['node', 'C:\\sandbox\\con espacios\\toy-mcp.mjs'] })
  eq(validMcpEntry('juguete', juguete), null, 'sin la puerta, node no pasa')
  assert(validMcpEntry('juguete', juguete, { allowCommand: (c) => c[0] === 'node' }), 'con ella, sí')
  eq(validMcpEntry('juguete', juguete, { allowCommand: () => 'sí' }), null, 'sólo un true de verdad abre')
  eq(validMcpEntry('juguete', entrada({ command: ['node', 'a\nb'] }), { allowCommand: () => true }), null, 'y ni con ella pasa un argumento con salto')
  assert(mcpPatchBody({ juguete }, { allowCommand: () => true }), 'también por el cuerpo')
  // Pinado: la puerta de prueba no aparece en el código del panel ni del cliente.
  for (const dir of ['src/panel', 'src/opencode']) {
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.js'))) {
      assert(!readFileSync(join(ROOT, dir, f), 'utf8').includes('allowCommand'), `${dir}/${f} nombra allowCommand`)
    }
  }
})

test('SEGURIDAD H18: mcpPatchBody — sólo la clave mcp, cada entrada por la barrera, y null si una no vale', () => {
  const a = entrada()
  const b = entrada({ enabled: false })
  const body = mcpPatchBody({ 'atlassian-a': a, 'atlassian-b': b })
  eq(Object.keys(body), ['mcp'], 'nada más que mcp')
  eq(body, { mcp: { 'atlassian-a': a, 'atlassian-b': b } })
  eq(mcpPatchBody({ 'atlassian-a': a, 'atlassian-b': entrada({ plugin: ['x'] }) }), null, 'una mala tira el cuerpo entero')
  for (const raro of [{}, [], null, 'x', 7]) eq(mcpPatchBody(raro), null, 'sin entradas: ' + JSON.stringify(raro))
  eq(mcpPatchBody(JSON.parse('{"__proto__": ' + JSON.stringify(a) + '}')), null, 'el prototipo no es un nombre')
  assert(mcpPatchBody({ constructor: a }).mcp.constructor.type === 'local', 'un nombre que coincide con una propiedad del prototipo, como clave propia')
  // `known`: el command que GET /config trae para ESE nombre.
  const docker = ['docker', 'run', '-i', 'img']
  const conDocker = entrada({ command: docker })
  eq(mcpPatchBody({ mio: conDocker }), null, 'sin conocido, no')
  eq(mcpPatchBody({ mio: conDocker }, { known: { mio: docker } }).mcp.mio.command, docker)
  eq(mcpPatchBody({ otro: conDocker }, { known: { mio: docker } }), null, 'lo conocido es por nombre')
  eq(mcpPatchBody({ mio: conDocker }, { known: Object.create({ mio: docker }) }), null, 'ni por el prototipo')
  // No toca lo que entra.
  const entra = { 'atlassian-a': entrada() }
  const copia = JSON.stringify(entra)
  mcpPatchBody(entra).mcp['atlassian-a'].environment.JIRA_URL = 'x'
  eq(JSON.stringify(entra), copia)
})
