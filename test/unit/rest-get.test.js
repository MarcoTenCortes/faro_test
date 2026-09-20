/**
 * La única puerta por la que Faro lee una API REST.
 *
 * Es la barrera que hace admisible leer el sitio del usuario con su sesión: sólo
 * GET, sólo al origen que se le da, con tope de tiempo, y sin lanzar nunca. Aquí
 * se comprueba que muerde desde el módulo NUEVO (antes vivía dentro de
 * confluence-rest.js, cuyo test sigue en verde sin tocarse) y que `errorBody` no
 * cambia nada del comportamiento de antes: sin él, el resultado de un error es
 * exactamente el mismo objeto y no se lee el cuerpo.
 *
 * Todo sin red: `fetch` se sustituye por una función que apunta lo que le piden.
 */
import { test, eq, assert } from '../harness.js'
import { getJson, sameOrigin, errorMessagesOf, nowMs, REST_ERROR_LIMITS } from '../../src/shared/rest-get.js'

const BASE = 'https://confluence.simplprogramme.eu'

/** Un `fetch` que apunta cada llamada y contesta lo que se le diga. */
function espia(respuesta) {
  const calls = []
  const fn = async (url, opts) => {
    calls.push({ url, opts })
    const r = typeof respuesta === 'function' ? respuesta(url, opts) : respuesta
    if (r instanceof Error) throw r
    return r
  }
  return { fn, calls }
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })
const texto = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body })

// --------------------------------------------------------------- mismo origen

test('SEGURIDAD: getJson no sale del origen que se le da, y no llega a llamar a fetch', async () => {
  for (const url of [
    'https://evil.example/rest/api/content/1',
    'https://confluence.simplprogramme.eu.evil.example/rest/api/content/1',
    'http://confluence.simplprogramme.eu/rest/api/content/1', // otro esquema es otro origen
    'https://confluence.simplprogramme.eu:8443/rest/api/content/1',
    'https://confluence.simplprogramme.eu@evil.example/x',
    '//evil.example/x',
    '/rest/api/content/1', // relativa: no se puede comprobar su origen
  ]) {
    const { fn, calls } = espia(json({ id: '1' }))
    const r = await getJson(fn, url, { timeoutMs: 50, credentials: 'same-origin', base: BASE })
    eq(r, { ok: false, status: 0, reason: 'la petición saldría del sitio' }, url)
    eq(calls.length, 0, `${url}: no se pide nada`)
  }
})

test('getJson: una ruta vacía o nula no pide nada', async () => {
  for (const url of ['', null, undefined]) {
    const { fn, calls } = espia(json({}))
    eq(await getJson(fn, url, { timeoutMs: 50, credentials: 'same-origin', base: BASE }), {
      ok: false,
      status: 0,
      reason: 'ruta inválida',
    })
    eq(calls.length, 0)
  }
})

test('sameOrigin: el origen exacto, y lo que no se puede parsear no cuenta', () => {
  eq(sameOrigin(BASE + '/rest/api/content/1', BASE), true)
  eq(sameOrigin(BASE + '/rest/api/content/1', BASE + '/wiki/'), true, 'la base con ruta es el mismo origen')
  eq(sameOrigin('https://evil.example/x', BASE), false)
  eq(sameOrigin(BASE, 'no soy una url'), false)
  eq(sameOrigin('no soy una url', BASE), false)
  eq(sameOrigin(null, BASE), false)
})

// ------------------------------------------------------------------ el GET

test('getJson: siempre GET, con Accept JSON, la sesión que se le pase y señal de aborto', async () => {
  const { fn, calls } = espia(json({ id: '98830281' }))
  const r = await getJson(fn, BASE + '/rest/api/content/98830281', { timeoutMs: 50, credentials: 'include', base: BASE })
  eq(r.ok, true)
  eq(r.status, 200)
  eq(r.json, { id: '98830281' })
  eq(calls.length, 1)
  eq(calls[0].opts.method, 'GET')
  eq(calls[0].opts.headers, { Accept: 'application/json' })
  eq(calls[0].opts.credentials, 'include')
  assert(calls[0].opts.signal, 'lleva la señal del AbortController')
})

test('getJson: un 401 o un 403 traen su status y el motivo, sin leer el cuerpo', async () => {
  let leido = 0
  for (const status of [401, 403, 404, 500]) {
    const { fn } = espia({ ok: false, status, text: async () => { leido++; return '{}' } })
    eq(await getJson(fn, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE }), {
      ok: false,
      status,
      reason: `la API respondió ${status}`,
    })
  }
  eq(leido, 0, 'sin errorBody no se lee el cuerpo de un error')
})

test('getJson: una respuesta sin status es «sin respuesta»', async () => {
  const { fn } = espia(null)
  eq(await getJson(fn, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE }), {
    ok: false,
    status: 0,
    reason: 'sin respuesta',
  })
})

test('getJson: la página de login de un SSO no es JSON, y eso es lo que se dice', async () => {
  const { fn } = espia(texto('<!DOCTYPE html><html><body>Log in</body></html>'))
  eq(await getJson(fn, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE }), {
    ok: false,
    status: 200,
    reason: 'la respuesta no es JSON',
  })
})

test('getJson: el tope de tiempo aborta de verdad y lo dice; un fetch que revienta no lanza', async () => {
  // El fetch se queda esperando y sólo se resuelve cuando la señal aborta: es
  // el AbortController real de getJson el que lo corta.
  const fn = (url, opts) =>
    new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('abortada'), { name: 'AbortError' })))
    })
  const r = await getJson(fn, BASE + '/x', { timeoutMs: 5, credentials: 'same-origin', base: BASE })
  eq(r, { ok: false, status: 0, reason: 'sin respuesta en 5 ms' })

  const { fn: rota } = espia(new Error('Failed to fetch'))
  eq(await getJson(rota, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE }), {
    ok: false,
    status: 0,
    reason: 'Failed to fetch',
  })
})

// ---------------------------------------------------------------- errorBody

test('errorBody: un 400 de Jira trae sus errorMessages limpiados, y sin la opción el resultado es el de siempre', async () => {
  const cuerpo = { errorMessages: ["Field 'lastViewed' does not exist or this field cannot be viewed"], errors: {} }
  const respuesta = () => ({ ok: false, status: 400, text: async () => JSON.stringify(cuerpo) })

  const { fn } = espia(respuesta)
  const con = await getJson(fn, BASE + '/rest/api/2/search?jql=x', { timeoutMs: 50, credentials: 'same-origin', base: BASE, errorBody: true })
  eq(con, {
    ok: false,
    status: 400,
    reason: 'la API respondió 400',
    errors: ["Field 'lastViewed' does not exist or this field cannot be viewed"],
  })

  const { fn: fn2 } = espia(respuesta)
  const sin = await getJson(fn2, BASE + '/rest/api/2/search?jql=x', { timeoutMs: 50, credentials: 'same-origin', base: BASE })
  eq(sin, { ok: false, status: 400, reason: 'la API respondió 400' }, 'ni una clave más que antes')
  eq('errors' in sin, false)
})

test('errorBody: un cuerpo que no es JSON, o sin mensajes, no añade la clave ni cambia el motivo', async () => {
  for (const cuerpo of ['<html>login</html>', '{}', '{"errorMessages":[]}', '{"errorMessages":"no es lista"}', 'null']) {
    const { fn } = espia({ ok: false, status: 400, text: async () => cuerpo })
    const r = await getJson(fn, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE, errorBody: true })
    eq(r, { ok: false, status: 400, reason: 'la API respondió 400' }, cuerpo)
  }
  // Y si `text()` revienta, el fallo sigue siendo el del status, no una excepción.
  const { fn } = espia({ ok: false, status: 400, text: async () => { throw new Error('cortado') } })
  eq(await getJson(fn, BASE + '/x', { timeoutMs: 50, credentials: 'same-origin', base: BASE, errorBody: true }), {
    ok: false,
    status: 400,
    reason: 'la API respondió 400',
  })
})

test('errorMessagesOf: mensajes del servidor en una línea, sin repetir, con tope de tres y de 200', () => {
  eq(errorMessagesOf({ errorMessages: ['uno', 'dos'] }), ['uno', 'dos'])
  eq(errorMessagesOf({ errors: { jql: 'mal el campo', otro: 'y esto' } }), ['mal el campo', 'y esto'])
  eq(errorMessagesOf({ errorMessages: ['uno'], errors: { a: 'dos' } }), ['uno', 'dos'], 'los dos sitios, en ese orden')
  eq(errorMessagesOf({ errorMessages: ['uno', 'uno'] }), ['uno'], 'sin repetir')
  eq(errorMessagesOf({ errorMessages: ['a', 'b', 'c', 'd', 'e'] }), ['a', 'b', 'c'])
  eq(REST_ERROR_LIMITS, { messages: 3, chars: 200 })

  const largo = errorMessagesOf({ errorMessages: ['x'.repeat(500)] })
  eq(largo[0].length, 200)

  // SEGURIDAD: es texto del servidor. Una línea, sin controles: de aquí sale a
  // un aviso del chat y al Registro, donde un salto fingiría otra fila.
  // El nulo se compone con `String.fromCharCode`: un carácter invisible CRUDO
  // dentro del fuente no se puede leer ni revisar, y cualquier editor que
  // «limpie» el fichero se lo lleva sin que se note (lección de H5).
  const conNulo = ['dos', String.fromCharCode(10), 'líneas', String.fromCharCode(9), 'y', String.fromCharCode(0), 'un nulo'].join('')
  eq(errorMessagesOf({ errorMessages: [conNulo] }), ['dos líneas y un nulo'])
  eq(errorMessagesOf({ errorMessages: ['   '] }), [], 'un mensaje vacío no es un mensaje')
  for (const raro of [null, undefined, 'cadena', 7, [], { errors: ['no es objeto de campos'] }, { errorMessages: [7, {}] }]) {
    eq(errorMessagesOf(raro), [], JSON.stringify(raro))
  }
})

test('nowMs: un reloj que avanza y no da negativos', () => {
  const a = nowMs()
  const b = nowMs()
  assert(typeof a === 'number' && Number.isFinite(a), 'un número')
  assert(b >= a, 'monótono: nunca hacia atrás')
  assert(Math.round(nowMs() - a) >= 0, 'la resta de dos medidas no es negativa')
})
