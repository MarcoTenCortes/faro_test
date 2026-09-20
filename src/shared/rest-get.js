/**
 * La única puerta por la que Faro lee una API REST de Atlassian. Puro.
 *
 * POR QUÉ EXISTE: la comprobación de «esta petición no sale del sitio» vivía
 * dentro de confluence-rest.js, y desde H7 hay un segundo módulo REST
 * (jira-rest.js) y un tercer tipo de lectura (las consultas de plantilla fija).
 * Una barrera de seguridad copiada en dos ficheros es una barrera que divergirá:
 * alguien arregla una y no la otra. Así que se extrae TAL CUAL —mismo
 * comportamiento, mismos mensajes, mismos códigos— y los dos módulos la
 * importan (docs/PLAN.md §3.3 «Cimiento REST»; decisión §8.19 de CLAUDE.md).
 * No es un incidente observado: es la condición para que jira-rest.js no nazca
 * con su propia copia.
 *
 * Lo que garantiza este módulo, y no quien lo llama:
 *  - Sólo GET, y sólo al origen que se le da como `base`: se comprueba el
 *    origen de la URL YA MONTADA, no la ruta que alguien dijo que montó.
 *  - `Accept: application/json` y un tope de tiempo con AbortController.
 *  - Nunca lanza: devuelve el motivo. Una respuesta que no es JSON (la página
 *    de login de un SSO) es «la respuesta no es JSON», no una excepción.
 *  - Nunca toca credenciales: viaja con la sesión que el navegador ya tiene
 *    (`credentials`), y la extensión no guarda ni lee ningún token.
 *
 * `errorBody` es lo único nuevo respecto a lo que había: con él, una respuesta
 * de error lee su cuerpo para sacar los `errorMessages` que Jira devuelve en un
 * 400 («Field 'lastViewed' does not exist»). Sin él, el resultado es EXACTAMENTE
 * el de antes —ni una petición más, ni una clave más—, que es lo que permite que
 * confluence-rest.test.js siga en verde sin tocarse.
 */

/** Cuántos mensajes de error del servidor se leen, y cuánto de cada uno. */
export const REST_ERROR_LIMITS = { messages: 3, chars: 200 }

// Los controles C0, el DEL y los C1 (U+0080-U+009F): el NEL (U+0085) abre línea y
// el `\s` de JavaScript no lo cubre; un mensaje del servidor es texto ajeno y
// tiene que salir de aquí en UNA línea (revisión adversaria de H7).
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

/**
 * Reloj monótono para los `ms` que devuelven los lectores REST.
 *
 * `Date.now` salta con el reloj del sistema (NTP, cambio de hora) y puede dar
 * una duración negativa o de horas para una petición de 80 ms; `performance.now`
 * no existe en todos los contextos donde corren estos módulos (las pruebas de
 * Node no tienen por qué depender de él). Misma lección que el reloj inyectado
 * de `startTiming` (src/shared/timing.js, H3).
 */
export function nowMs() {
  return typeof performance === 'object' && typeof performance?.now === 'function' ? performance.now() : Date.now()
}

/** ¿Esta URL ya montada apunta al mismo origen que `base`? Pura. */
export function sameOrigin(url, base) {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

/**
 * Los mensajes con los que el servidor explica un error, en una línea y
 * acotados. Sólo se leen los de Atlassian (`errorMessages`, y los valores de
 * `errors` cuando el error es de un campo): son texto del SERVIDOR, así que
 * entran como cualquier otro contenido —una línea, sin controles, con tope— y
 * quien los pinte lo hace con `textContent`. Pura.
 */
export function errorMessagesOf(json) {
  if (!json || typeof json !== 'object') return []
  const crudos = [
    ...(Array.isArray(json.errorMessages) ? json.errorMessages : []),
    ...(json.errors && typeof json.errors === 'object' && !Array.isArray(json.errors) ? Object.values(json.errors) : []),
  ]
  const out = []
  for (const m of crudos) {
    if (typeof m !== 'string') continue
    const limpio = m.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, REST_ERROR_LIMITS.chars)
    if (limpio && !out.includes(limpio)) out.push(limpio)
    if (out.length >= REST_ERROR_LIMITS.messages) break
  }
  return out
}

/**
 * GET con tope de tiempo, y sólo al sitio. Nunca lanza: devuelve el motivo.
 *
 * @param {Function} fetchFn `fetch` del contexto que llama (se inyecta para
 *        poder probar esto sin red)
 * @param {string} url la URL ya montada
 * @param {{timeoutMs:number, credentials:string, base:string, errorBody?:boolean}} opts
 * @returns {Promise<{ok:true, status:number, json:any}|{ok:false, status:number, reason:string, errors?:string[]}>}
 */
export async function getJson(fetchFn, url, { timeoutMs, credentials, base, errorBody = false }) {
  if (!url) return { ok: false, status: 0, reason: 'ruta inválida' }
  // La garantía de mismo origen se comprueba aquí, en el único sitio por el
  // que pasa toda petición, y no se confía en que la ruta se haya montado bien.
  if (!sameOrigin(url, base)) return { ok: false, status: 0, reason: 'la petición saldría del sitio' }

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : 0
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      credentials,
      headers: { Accept: 'application/json' },
      signal: ctrl?.signal,
    })
    if (!res || !res.ok) {
      const status = Number(res?.status) || 0
      const salida = { ok: false, status, reason: status ? `la API respondió ${status}` : 'sin respuesta' }
      // Sólo con `errorBody` se lee el cuerpo de un error: sin él no se hace ni
      // una petición ni una lectura más que antes. Que el cuerpo no sea JSON o
      // que `text()` reviente no puede cambiar el motivo del fallo.
      if (errorBody && res && typeof res.text === 'function') {
        const errors = await leerErrores(res)
        if (errors.length) salida.errors = errors
      }
      return salida
    }
    const text = await res.text()
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) }
    } catch {
      // Una página de login en vez de JSON: la sesión no vale para la API.
      return { ok: false, status: res.status, reason: 'la respuesta no es JSON' }
    }
  } catch (err) {
    const abortado = err?.name === 'AbortError'
    return { ok: false, status: 0, reason: abortado ? `sin respuesta en ${timeoutMs} ms` : String(err?.message || err) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function leerErrores(res) {
  try {
    return errorMessagesOf(JSON.parse(await res.text()))
  } catch {
    return []
  }
}
