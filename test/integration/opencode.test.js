/**
 * Prueba de integración contra un opencode de verdad.
 *
 * Arranca su propio servidor con contraseña y con `--cors` apuntando al id de
 * esta extensión, y ejercita EXACTAMENTE el mismo cliente que usa el panel.
 * Si esto pasa, el camino crítico funciona: autenticación, CORS, modelos,
 * sesiones, streaming por SSE y salida estructurada con el esquema real de
 * navegación.
 *
 *   node test/integration/opencode.test.js
 *
 * Variables opcionales:
 *   FARO_TEST_MODEL=proveedor/modelo   modelo a usar (por defecto, uno gratuito)
 *   FARO_TEST_PORT=4123                puerto
 */

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { OpencodeClient } from '../../src/opencode/client.js'
import { TurnTracker } from '../../src/opencode/turn.js'
import { NAVIGATION_PLAN_SCHEMA, plannerSystemPrompt } from '../../src/nav/schema.js'
import { validatePlan } from '../../src/nav/validate.js'
import { normalizeIndex } from '../../src/atlassian/index-store.js'
import { CORS_ORIGIN } from '../../src/shared/config.js'

/** Un PNG de 1×1 transparente: lo mínimo para comprobar el formato. */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const PORT = Number(process.env.FARO_TEST_PORT || 4123)
const PASSWORD = 'faro-test-' + PORT
const PREFERRED = process.env.FARO_TEST_MODEL || ''

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

let passed = 0
const failures = []

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    passed++
    console.log(`${GREEN}✓${OFF} ${name} ${DIM}${Date.now() - t0}ms${note ? ' · ' + note : ''}${OFF}`)
  } catch (err) {
    failures.push({ name, err })
    console.log(`${RED}✗ ${name}${OFF}\n    ${String(err?.message || err).split('\n')[0]}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'falló la comprobación')
}

// ------------------------------------------------------------------ servidor

let server = null

async function startServer() {
  const cmd = process.platform === 'win32' ? 'opencode.cmd' : 'opencode'
  server = spawn(
    cmd,
    ['serve', '--port', String(PORT), '--hostname', '127.0.0.1', '--cors', CORS_ORIGIN],
    {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: PASSWORD },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  )

  let log = ''
  server.stdout.on('data', (d) => (log += d))
  server.stderr.on('data', (d) => (log += d))

  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/global/health`)
      if (r.status === 401 || r.ok) return
    } catch {
      /* todavía no está */
    }
    await delay(400)
  }
  throw new Error('el servidor no arrancó a tiempo:\n' + log)
}

function stopServer() {
  if (!server) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/f', '/t'], { windowsHide: true })
    else server.kill('SIGTERM')
  } catch {
    /* ya estaba muerto */
  }
}

// --------------------------------------------------------------------- suite

async function main() {
  console.log(`Faro · integración con opencode  ${DIM}puerto ${PORT}${OFF}\n`)
  console.log(`${DIM}arrancando servidor…${OFF}`)
  await startServer()

  const client = new OpencodeClient({ baseUrl: `http://127.0.0.1:${PORT}`, password: PASSWORD })
  let model = null
  const created = []

  try {
    await check('la contraseña es obligatoria', async () => {
      const anon = new OpencodeClient({ baseUrl: `http://127.0.0.1:${PORT}` })
      let status = 0
      try {
        await anon.health()
      } catch (err) {
        status = err.status
      }
      assert(status === 401, 'sin contraseña debería dar 401, dio ' + status)
      return 'sin cabecera → 401'
    })

    await check('autenticación Basic opencode:<contraseña>', async () => {
      const h = await client.health()
      assert(h?.healthy === true, 'el servidor no se declara sano')
      return 'opencode ' + h.version
    })

    await check('CORS permite el origen de la extensión', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/global/health`, {
        headers: { Origin: CORS_ORIGIN, Authorization: client.headers().Authorization },
      })
      const allow = res.headers.get('access-control-allow-origin')
      assert(allow === CORS_ORIGIN, `esperaba ${CORS_ORIGIN}, obtuve ${allow}`)

      const pre = await fetch(`http://127.0.0.1:${PORT}/session`, {
        method: 'OPTIONS',
        headers: {
          Origin: CORS_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      })
      const heads = (pre.headers.get('access-control-allow-headers') || '').toLowerCase()
      assert(heads.includes('authorization'), 'el preflight no admite la cabecera Authorization')
      return 'preflight admite authorization'
    })

    await check('CORS bloquea cualquier otro origen', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/global/health`, {
        headers: { Origin: 'https://malicioso.example', Authorization: client.headers().Authorization },
      })
      assert(!res.headers.get('access-control-allow-origin'), 'no debería autorizar a otro origen')
      return 'sin cabecera para orígenes ajenos'
    })

    await check('lista de modelos', async () => {
      const { models, defaults } = await client.models()
      assert(models.length > 0, 'no hay modelos configurados en opencode')
      model = pickModel(models, defaults)
      assert(model, 'no encuentro un modelo utilizable')
      return `${models.length} modelos · usando ${model.providerID}/${model.modelID}`
    })

    await check('crear y borrar sesión', async () => {
      const s = await client.createSession({ title: 'Faro · integración' })
      assert(s?.id?.startsWith('ses_'), 'id de sesión inesperado: ' + s?.id)
      await client.deleteSession(s.id)
      return s.id
    })

    await check('stream de eventos por fetch (EventSource no vale: no lleva cabeceras)', async () => {
      const seen = []
      const off = client.on('*', (e) => seen.push(e.type))
      client.connect()
      const deadline = Date.now() + 15000
      while (Date.now() < deadline && !seen.includes('server.connected')) await delay(200)
      off()
      assert(seen.includes('server.connected'), 'no llegó server.connected; vistos: ' + seen.join(','))
      return seen.length + ' eventos'
    })

    await check('respuesta en streaming reconstruida por TurnTracker', async () => {
      const s = await client.createSession({ title: 'Faro · streaming' })
      created.push(s.id)

      let tracker
      const done = new Promise((resolve, reject) => {
        tracker = new TurnTracker(s.id, {
          onDone: () => resolve('idle'),
          onError: (m) => reject(new Error(m)),
        })
      })
      const off = client.on('*', (e) => tracker.handle(e))

      await client.promptAsync(s.id, {
        text: 'Responde exactamente con esta palabra y nada más: faro',
        model,
      })

      const result = await Promise.race([done, delay(180000).then(() => 'timeout')])
      off()
      assert(result !== 'timeout', 'el turno no terminó en 180 s')
      assert(/faro/i.test(tracker.text), 'texto inesperado: ' + JSON.stringify(tracker.text.slice(0, 120)))
      return JSON.stringify(tracker.text.trim().slice(0, 40))
    })

    await check('salida estructurada con el esquema real de NavigationPlan', async () => {
      const s = await client.createSession({ title: 'Faro · plan' })
      created.push(s.id)

      const index = normalizeIndex(
        {
          spaces: [{ key: 'ENG', name: 'Ingeniería', url: '/wiki/spaces/ENG' }],
          pages: [
            { id: '100', title: 'Arquitectura', url: '/wiki/spaces/ENG/pages/100/Arquitectura', spaceKey: 'ENG' },
            {
              id: '200',
              title: 'ADR-014 Rotación de tokens',
              url: '/wiki/spaces/ENG/pages/200/ADR-014',
              spaceKey: 'ENG',
              parentId: '100',
            },
          ],
        },
        'acme.atlassian.net'
      )

      const raw = await client.promptStructured(s.id, {
        model,
        system: plannerSystemPrompt(),
        schema: NAVIGATION_PLAN_SCHEMA,
        text: [
          'PREGUNTA DEL USUARIO:',
          '¿Dónde está documentada la rotación de tokens?',
          '',
          'TU RESPUESTA:',
          'Está en ADR-014 Rotación de tokens, dentro del espacio de Ingeniería.',
          '',
          'ÍNDICE DEL SITIO (los únicos identificadores que puedes usar):',
          'ESPACIOS DE CONFLUENCE',
          '  ENG — Ingeniería',
          'PÁGINAS (2)',
          '  100 — Arquitectura [ENG]',
          '  200 — ADR-014 Rotación de tokens [ENG]',
          '',
          'Usa mode="assisted" y lleva al usuario a la página 200.',
        ].join('\n'),
      })

      assert(raw && typeof raw === 'object', 'no volvió un objeto')
      const validated = validatePlan(raw, {
        index,
        origin: 'https://acme.atlassian.net',
        host: 'acme.atlassian.net',
      })
      assert(validated.ok, 'el plan no validó: ' + validated.reason)
      assert(validated.plan.navigate, 'el modelo decidió no navegar')
      assert(
        validated.plan.destination.url.startsWith('https://acme.atlassian.net/'),
        'la URL resuelta se sale del sitio: ' + validated.plan.destination.url
      )
      return `${validated.plan.mode} → ${validated.plan.destination.title}`
    })

    await check('un plan con un id inventado se rechaza', async () => {
      const index = normalizeIndex({ pages: [] }, 'acme.atlassian.net')
      const r = validatePlan(
        { navigate: true, mode: 'direct', destination: { kind: 'confluence-page', id: '424242' }, explanation: 'x' },
        { index, origin: 'https://acme.atlassian.net', host: 'acme.atlassian.net' }
      )
      assert(!r.ok, 'debería haberlo rechazado')
      return r.reason
    })

    // Lo que hace falta para que el usuario pueda señalar una imagen de la
    // página y preguntar por ella: que opencode acepte una parte de fichero con
    // la imagen incrustada. Si el formato no fuera ese, el turno moriría con un
    // 400 y no habría forma de saberlo hasta usarlo de verdad.
    await check('acepta una imagen adjunta como parte de fichero', async () => {
      const s = await client.createSession({ title: 'Faro · adjunto' })
      created.push(s.id)
      try {
        await client.promptAsync(s.id, {
          text: 'Responde sólo con la palabra HECHO.',
          model,
          files: [{ mime: 'image/png', filename: 'seleccion.png', url: PNG_1PX }],
        })
        return 'aceptado'
      } finally {
        await client.abort(s.id).catch(() => {})
      }
    })

    await check('listar servidores MCP', async () => {
      const list = await client.listMcp()
      assert(list && typeof list === 'object', 'respuesta inesperada')
      const names = Object.keys(list)
      return names.length ? names.join(', ') : 'ninguno configurado'
    })
  } finally {
    for (const id of created) await client.deleteSession(id).catch(() => {})
    client.disconnect()
    stopServer()
  }

  console.log()
  if (failures.length) {
    console.log(`${RED}${failures.length} fallo(s), ${passed} correcta(s)${OFF}`)
    for (const f of failures) console.log(`\n${RED}${f.name}${OFF}\n${f.err?.stack || f.err}`)
    process.exitCode = 1
  } else {
    console.log(`${GREEN}Integración en verde: ${passed}/${passed}${OFF}`)
  }
}

function pickModel(models, defaults) {
  if (PREFERRED) {
    const [providerID, ...rest] = PREFERRED.split('/')
    const modelID = rest.join('/')
    const hit = models.find((m) => m.providerID === providerID && m.modelID === modelID)
    if (hit) return hit
  }
  // Preferir gratis: la prueba no debería costarle dinero a nadie.
  const free = models.find((m) => m.free)
  if (free) return free
  for (const [providerID, modelID] of Object.entries(defaults || {})) {
    const hit = models.find((m) => m.providerID === providerID && m.modelID === modelID)
    if (hit) return hit
  }
  return models[0]
}

main().catch((err) => {
  console.error(err)
  stopServer()
  process.exitCode = 1
})
