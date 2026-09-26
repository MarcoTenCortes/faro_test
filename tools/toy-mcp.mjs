/**
 * Un servidor MCP de JUGUETE (stdio, JSON-RPC 2.0, un mensaje por línea) con
 * una sola herramienta, `faro_ping`. Lo usa `tools/config-sandbox.mjs` (H18)
 * para comprobar contra un opencode de verdad —aislado, con el HOME entero
 * redirigido— que lo que Faro escribe en la configuración aparece, se apaga y
 * se recarga, sin arrancar mcp-atlassian ni tocar ningún Jira: arrancar el MCP
 * real exige uvx, red y claves, y lo que se mide aquí es opencode, no el MCP.
 *
 * Es la sonda del anexo 2-A (docs/plan/anexo-2-A-mcp-automatico.md) con UN
 * cambio: el registro de arranques ya no va junto a este fichero —que vive en el
 * repo— sino a la ruta de `FARO_TOY_LOG`, que el sandbox pone dentro de su
 * directorio temporal (y borra al acabar). Sin esa variable no registra nada.
 * Del entorno no registra ningún valor: sólo el pid, la ruta de este fichero
 * (con ella el sandbox sabe cuál de sus copias arrancó) y los argumentos.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const LOG = process.env.FARO_TOY_LOG || ''

/** Una línea en el registro del sandbox, si lo hay; nunca revienta el servidor. */
function log(mensaje) {
  if (!LOG) return
  try {
    appendFileSync(LOG, `${new Date().toISOString()} pid=${process.pid} ${mensaje}\n`)
  } catch {
    /* un registro que no se puede escribir no tumba el MCP */
  }
}

log('ARRANQUE script=' + JSON.stringify(process.argv[1] || '') + ' argv=' + JSON.stringify(process.argv.slice(2)))

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  log('<- ' + msg.method)
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'faro-prueba', version: '0.0.1' },
      },
    })
  } else if (msg.method === 'notifications/initialized') {
    // nada que contestar
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'faro_ping',
            description: 'Devuelve pong',
            inputSchema: { type: 'object', properties: { texto: { type: 'string' } } },
          },
        ],
      },
    })
  } else if (msg.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'pong ' + (msg.params?.arguments?.texto || '') }] } })
  } else if (msg.method === 'ping') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } })
  }
})

rl.on('close', () => {
  log('stdin cerrado')
  process.exit(0)
})
