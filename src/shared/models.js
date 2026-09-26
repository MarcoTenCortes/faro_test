/**
 * Elección de modelo. Puro, para poder probarlo.
 *
 * Existe porque un proveedor puede estar configurado en opencode y aun así
 * fallar al usarlo: una sesión OAuth caducada da «Token refresh failed: 401»
 * sólo cuando ya has enviado la pregunta. Cuando eso pasa, lo útil no es un
 * mensaje de error: es poder saltar a otro proveedor de un clic.
 *
 * De H16 (docs/PLAN2.md §3.3 y §8.25, anexo C): lo que un fallo ENSEÑA sobre
 * los modelos, y lo que Faro recuerda de ello. Pasó de verdad con un compañero
 * de Marco: `pickDefaultModel` cogía el primer default del mapa de opencode
 * —`openai/gpt-5.4`, que su plan de ChatGPT no permite—, `verifyCredentials`
 * lo pintaba como un fallo de CLAVES, y «Reintentar con X» alternaba entre dos
 * modelos rotos (`openai/gpt-5.4 ⇄ github-copilot/claude-sonnet-4.6`). opencode
 * no dice qué modelos permite el plan de cada persona (los 43 de Marco dicen
 * `status: 'active'` y `toolcall: true`), pero un rechazo es GRATIS y trae su
 * motivo, y el de Copilot trae además la lista entera de lo que sí vale. De ahí:
 * clasificar el fallo (`classifyModelFailure`), sacar de él todos los veredictos
 * que se puedan (`verdictsForFailure`), recordarlos con caducidad por motivo
 * (`normalizeModelChecks`, `modelVerdict`, `recordVerdicts`) y que ninguna
 * elección automática vuelva a caer en lo que ya falló.
 */

import { sinInvisibles } from '../atlassian/site.js'
import { MODEL_LIMITS } from './config.js'

/**
 * Por qué un modelo no ha podido contestar. El orden es de más a menos
 * definitivo, y cada motivo tiene su caducidad en `MODEL_LIMITS.ttlMs`:
 * - `plan`: el proveedor dice que ese modelo no está en tu plan o no existe
 *   para este integrador (400/403/404 con ese mensaje). No cambia solo.
 * - `credenciales`: la sesión con el proveedor caducó (`opencode auth login`).
 * - `mudo`: aceptó el turno y no dijo nada hasta el plazo del vigilante.
 * - `transitorio`: 429, un 5xx o «overloaded»: dentro de un rato puede valer.
 * - `otro`: cualquier otra cosa, o un error sin mensaje ni código.
 */
export const MODEL_FAILURE_REASONS = Object.freeze(['plan', 'credenciales', 'mudo', 'transitorio', 'otro'])

/** La versión de la forma guardada en `faro:model-checks`. Otra → se tira. */
export const MODEL_CHECKS_VERSION = 1

/**
 * Los cinco separadores de línea (salto, retorno, U+2028, U+2029 y NEL) y el
 * resto de espacios, colapsados a uno. `\s` de JS cubre U+2028 y U+2029 pero NO
 * el NEL (U+0085), que va nombrado aparte y CON ESCAPE, como
 * `ESPACIOS_DEL_ERROR` en setup.js: un mensaje de proveedor que abre línea
 * fingiría dos filas en el Registro y en la pantalla del modelo.
 */
const ESPACIOS_DEL_MENSAJE = new RegExp('[\\s\\u0085]+', 'g')

/** Un instante que `Date` sabe representar (el mismo criterio que `normalizeMemory`). */
const INSTANTE_MAX = 8.64e15

/** Un id de modelo o de proveedor: sin espacios ni invisibles, y acotado. */
const PIEZA = /^[^\s/]{1,120}$/

/**
 * Modelo por defecto: el primero de `defaults` que exista en la lista.
 *
 * Sin `checks`, byte a byte lo de siempre (el primer default que exista, o el
 * primero de la lista). Con `checks` (H16) salta lo que tenga veredicto de fallo
 * vigente: el default de opencode para un proveedor puede ser justo uno que tu
 * plan no permite —el de Copilot lo es—, y elegirlo otra vez sería el fallo del
 * compañero. Si todo lo que hay está marcado, null: mejor preguntar que adivinar.
 */
export function pickDefaultModel(models, defaults, { checks = null, now = Date.now() } = {}) {
  const lista = models || []
  const vale = (m) => !checks || !falloVigente(checks, m, now)
  for (const [providerID, modelID] of Object.entries(defaults || {})) {
    const hit = lista.find((m) => m.providerID === providerID && m.modelID === modelID)
    if (hit && vale(hit)) return hit
  }
  if (!checks) return lista[0] || null
  return lista.find(vale) || null
}

/**
 * Alternativa cuando el proveedor actual no responde: se cambia de proveedor,
 * no sólo de modelo, porque el problema es de credenciales del proveedor.
 *
 * Con `checks` (H16) no propone nada con veredicto de fallo vigente: era el
 * bucle «Reintentar con X» entre `openai/gpt-5.4` y
 * `github-copilot/claude-sonnet-4.6`, los dos defaults de sus proveedores y los
 * dos rotos para Marco. Sin `checks`, lo de siempre.
 */
export function pickAlternativeModel(models, defaults, currentProviderID, { checks = null, now = Date.now() } = {}) {
  const others = (models || []).filter(
    (m) => m.providerID !== currentProviderID && (!checks || !falloVigente(checks, m, now))
  )
  if (!others.length) return null

  // Primero, el modelo por defecto de otro proveedor: es el que el usuario ya
  // tenía elegido en opencode.
  for (const [providerID, modelID] of Object.entries(defaults || {})) {
    if (providerID === currentProviderID) continue
    const hit = others.find((m) => m.providerID === providerID && m.modelID === modelID)
    if (hit) return hit
  }

  // Si no, uno gratuito antes que uno de pago.
  return others.find((m) => m.free) || others[0]
}

export function modelKey(model) {
  return model ? `${model.providerID}/${model.modelID}` : ''
}

export function parseModelKey(key) {
  const [providerID, ...rest] = String(key || '').split('/')
  const modelID = rest.join('/')
  return providerID && modelID ? { providerID, modelID } : null
}

/** Modelos que suelen ser mucho mas rapidos, por su nombre. */
const RAPIDOS = /(mini|nano|haiku|flash|lite|small|turbo|instant|lightning|spark)/i

/**
 * Modelo para el planificador de navegacion.
 *
 * El planificador no conversa ni usa herramientas: solo extrae un destino de
 * un texto que ya esta escrito. Con el modelo grande de la conversacion se
 * hacia esperar varios segundos despues de cada respuesta, que es justo cuando
 * mas se nota. Se prefiere uno rapido del MISMO proveedor, para no cambiar de
 * credenciales ni de fiabilidad sin avisar.
 *
 * Con `checks` (H16) no elige un rápido que ya falló: con `openai/gpt-5.3-codex`
 * caía en `gpt-5.3-codex-spark` sin mirar si funcionaba, y un planificador roto
 * sólo se ve como «Sin navegación». Si no queda ningún rápido sano, el de la
 * conversación, que es el que acaba de contestar.
 */
export function pickPlannerModel(models, current, { checks = null, now = Date.now() } = {}) {
  if (!current) return current || null
  if (RAPIDOS.test(current.modelID)) return current

  const mismos = (models || []).filter(
    (m) =>
      m.providerID === current.providerID &&
      RAPIDOS.test(m.modelID) &&
      (!checks || !falloVigente(checks, m, now))
  )
  if (!mismos.length) return current

  // El de nombre mas corto suele ser el modelo base, no una variante rara.
  mismos.sort((a, b) => a.modelID.length - b.modelID.length)
  return { providerID: mismos[0].providerID, modelID: mismos[0].modelID }
}

// ------------------------------------------------------------ H16: fallos

/** Lo que un `rawError` de opencode trae dentro, venga con la forma que venga. */
function camposDelError(rawError) {
  if (!rawError || typeof rawError !== 'object') return { name: '', message: '', statusCode: 0 }
  const data = rawError.data && typeof rawError.data === 'object' ? rawError.data : {}
  const name = typeof rawError.name === 'string' ? rawError.name : typeof rawError.type === 'string' ? rawError.type : ''
  const message =
    typeof data.message === 'string' ? data.message : typeof rawError.message === 'string' ? rawError.message : ''
  const codigo = data.statusCode ?? rawError.statusCode
  const statusCode = Number.isInteger(codigo) && codigo >= 100 && codigo <= 599 ? codigo : 0
  return { name, message, statusCode }
}

/**
 * Por qué ha fallado un modelo, en una de `MODEL_FAILURE_REASONS`. Pura.
 *
 * Probada con los tres rechazos REALES que se midieron contra el opencode de
 * Marco (test/fixtures/models/rechazos.json): el 400 de openai «not supported
 * when using Codex with a ChatGPT account», el 400 de Copilot «not available for
 * integrator opencode» y el 403 de opencode «free tier can only be used from
 * within OpenCode». Los tres son `plan`: ninguno se arregla esperando ni
 * volviendo a entrar, y ninguno es culpa de las claves de Atlassian.
 *
 * El orden importa: un 401 es de credenciales aunque diga «not available», y el
 * «plan» exige su código (400/403/404) para que un «unavailable» de un 503 no se
 * tome por un modelo que no existe.
 */
export function classifyModelFailure(rawError, { stalled = false } = {}) {
  if (stalled) return 'mudo'
  const { name, message, statusCode } = camposDelError(rawError)
  if (name === 'ProviderAuthError' || statusCode === 401 || /unauthori|token refresh/i.test(message)) {
    return 'credenciales'
  }
  if (
    (statusCode === 400 || statusCode === 403 || statusCode === 404) &&
    /not supported|not available|free tier|does not exist|unknown model|not found/i.test(message)
  ) {
    return 'plan'
  }
  if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /rate limit|overloaded|temporar|unavailable/i.test(message)) {
    return 'transitorio'
  }
  return 'otro'
}

/**
 * Los ids que el propio proveedor dice que SÍ puedes usar, o null. Pura.
 *
 * Sólo Copilot lo hace, y en texto libre: «The requested model is not available
 * for integrator "opencode". Available models: [gpt-4.1 claude-fable-5.1 …]».
 * Es gratis —viene en el rechazo— y dice de golpe qué modelos de ese proveedor
 * no valen (en la máquina de Marco, 3 de 32). Si GitHub cambia el formato, esto
 * devuelve null y sólo se pierde la ventaja: nada más depende de ello.
 *
 * Una lista vacía es null, no `[]`: «no vale ninguno» marcaría el proveedor
 * entero por un mensaje que no se ha entendido.
 */
export function availableFromError(rawError) {
  const { message } = camposDelError(rawError)
  const m = /Available models:\s*\[([^\]]*)\]/i.exec(message)
  if (!m) return null
  const ids = []
  for (const trozo of m[1].split(/[\s,]+/)) {
    const id = trozo.replace(/^["']+|["']+$/g, '')
    if (id && PIEZA.test(id) && sinInvisibles(id) === id && !ids.includes(id)) ids.push(id)
  }
  return ids.length ? ids : null
}

/** El mensaje del proveedor en UNA línea, sin invisibles y acotado. */
function unaLinea(texto) {
  if (typeof texto !== 'string') return ''
  return sinInvisibles(texto).replace(ESPACIOS_DEL_MENSAJE, ' ').trim().slice(0, MODEL_LIMITS.messageMax).trim()
}

/** La clave `prov/model` de un objeto de modelo o de una cadena, validada, o ''. */
function claveValida(model) {
  const partes = typeof model === 'string' ? parseModelKey(model) : model && typeof model === 'object' ? model : null
  if (!partes || typeof partes.providerID !== 'string' || typeof partes.modelID !== 'string') return ''
  const { providerID, modelID } = partes
  if (!PIEZA.test(providerID)) return ''
  // El id del modelo puede llevar barras (openrouter/meta/llama-3), pero no
  // espacios, invisibles ni trozos vacíos.
  if (!modelID || modelID.length > 120 || /\s/.test(modelID) || modelID.split('/').some((t) => !t)) return ''
  const clave = `${providerID}/${modelID}`
  return sinInvisibles(clave) === clave ? clave : ''
}

/**
 * Todo lo que un fallo enseña, como veredictos listos para guardar. Pura.
 *
 * Siempre el del modelo que falló. Y dos más que son gratis:
 * - un 403 «free tier can only be used from within OpenCode» es del PROVEEDOR
 *   entero: marca todos sus modelos de la lista (no se codifica fijo que los
 *   `opencode/*` no valgan: con una clave de opencode Zen sí valdrían);
 * - la lista «Available models: […]» de Copilot marca como `plan` los de ese
 *   proveedor que NO están en ella. Los que sí están no reciben nada: estar en
 *   la lista del integrador no demuestra que contesten.
 *
 * @returns {Array<{key:string, ok:false, reason:string, message:string, at:number}>}
 */
export function verdictsForFailure({ model, rawError = null, stalled = false, models = [], now = Date.now() } = {}) {
  const key = claveValida(model)
  if (!key) return []
  const providerID = key.slice(0, key.indexOf('/'))
  const reason = classifyModelFailure(rawError, { stalled })
  const message = unaLinea(camposDelError(rawError).message)
  const at = instante(now) || Date.now()
  const out = [{ key, ok: false, reason, message, at }]
  const vistos = new Set([key])
  const marcar = (k, motivo) => {
    if (!k || vistos.has(k)) return
    vistos.add(k)
    out.push({ key: k, ok: false, reason: motivo, message, at })
  }
  const delProveedor = (Array.isArray(models) ? models : []).filter((m) => m && m.providerID === providerID)

  if (reason === 'plan' && /free tier/i.test(camposDelError(rawError).message)) {
    for (const m of delProveedor) marcar(claveValida(m), 'plan')
  }
  const disponibles = availableFromError(rawError)
  if (disponibles) {
    for (const m of delProveedor) if (!disponibles.includes(m.modelID)) marcar(claveValida(m), 'plan')
  }
  return out
}

// ------------------------------------------------------ H16: veredictos

/** Un número de milisegundos que `Date` sabe representar, o 0. */
function instante(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= INSTANTE_MAX ? value : 0
}

/** Los veredictos de dentro, se le pase el objeto guardado entero o sólo su mapa. */
function mapaDe(checks) {
  if (!checks || typeof checks !== 'object') return null
  if (checks.checks && typeof checks.checks === 'object' && !Array.isArray(checks.checks)) return checks.checks
  return checks
}

/**
 * Una entrada reconstruida con claves blancas, o null. `ok` tiene que ser un
 * booleano (sin él no se sabe qué dice) y `at` un instante (sin él no se puede
 * decidir si caducó); uno del futuro se trae a `now`, que si no no caducaría.
 */
function entradaLimpia(raw, now) {
  if (!raw || typeof raw !== 'object' || typeof raw.ok !== 'boolean') return null
  let at = instante(raw.at)
  if (!at) return null
  if (now && at > now) at = now
  const reason = raw.ok ? 'ok' : MODEL_FAILURE_REASONS.includes(raw.reason) ? raw.reason : 'otro'
  return { ok: raw.ok, reason, message: unaLinea(raw.message), at }
}

/**
 * `faro:model-checks` en su forma: lo que Faro sabe de cada modelo. Pura.
 *
 * Es de la PERSONA y del opencode con el que se habló: con otro `server`, otra
 * `version` o otra `fingerprint` (otros proveedores conectados: un
 * `opencode auth login` la cambia) lo guardado ya no dice nada y se empieza de
 * cero, con el `server` y la `fingerprint` que se le dan. Idempotente y sin
 * lanzar con basura; una clave `__proto__` no tiene barra y no pasa
 * `claveValida`, y lo guardado se recorre con `Object.keys` + `Object.hasOwn`.
 * Tope `MODEL_LIMITS.maxEntries`, conservando las más recientes.
 */
export function normalizeModelChecks(raw, { server = '', fingerprint = '', now = Date.now() } = {}) {
  const srv = typeof server === 'string' ? server : ''
  const huella = typeof fingerprint === 'string' ? fingerprint : ''
  const base = { version: MODEL_CHECKS_VERSION, server: srv, fingerprint: huella, checks: {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  if (raw.version !== MODEL_CHECKS_VERSION || raw.server !== srv || raw.fingerprint !== huella) return base
  const dentro = raw.checks && typeof raw.checks === 'object' && !Array.isArray(raw.checks) ? raw.checks : {}
  const reloj = instante(now) || Date.now()
  const filas = []
  for (const k of Object.keys(dentro)) {
    if (!Object.hasOwn(dentro, k)) continue
    const key = claveValida(k)
    if (!key || key !== k) continue
    const e = entradaLimpia(dentro[k], reloj)
    if (e) filas.push([key, e])
  }
  // Las más recientes primero, y en empate por clave: así el orden guardado no
  // depende del orden en que llegaron, y normalizar dos veces da lo mismo.
  filas.sort((a, b) => b[1].at - a[1].at || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [key, e] of filas.slice(0, MODEL_LIMITS.maxEntries)) base.checks[key] = e
  return base
}

/**
 * El veredicto VIGENTE de un modelo, o null (sin entrada, o caducada). Pura.
 *
 * Cada motivo caduca a su ritmo (`MODEL_LIMITS.ttlMs`): un «no está en tu plan»
 * vale una semana, un 429 quince minutos. Vale hasta cumplir su TTL justo, y un
 * milisegundo después ya no. Acepta el objeto guardado entero o sólo su mapa
 * `checks`, y la clave como cadena o como objeto de modelo.
 */
export function modelVerdict(checks, key, now = Date.now()) {
  const mapa = mapaDe(checks)
  const k = claveValida(key)
  if (!mapa || !k || !Object.hasOwn(mapa, k)) return null
  const e = entradaLimpia(mapa[k], 0)
  if (!e) return null
  const ttl = MODEL_LIMITS.ttlMs[e.reason]
  if (!Number.isFinite(ttl) || now - e.at > ttl) return null
  return e
}

/** ¿Tiene este modelo un veredicto de FALLO que todavía vale? */
function falloVigente(checks, model, now) {
  const v = modelVerdict(checks, model, now)
  return !!v && !v.ok
}

/**
 * Funde veredictos nuevos en lo guardado, sin tocar lo que recibe. Pura.
 *
 * La entrada de `at` más reciente gana (en empate, la nueva: es lo último que se
 * ha visto). Acepta el objeto guardado entero —y devuelve otro igual con el mapa
 * nuevo— o sólo el mapa. El tope y la caducidad los aplica `normalizeModelChecks`
 * al guardar.
 */
export function recordVerdicts(checks, verdicts) {
  const entero = checks && typeof checks === 'object' && checks.checks && typeof checks.checks === 'object'
  const antes = mapaDe(checks) || {}
  const mapa = {}
  for (const k of Object.keys(antes)) if (Object.hasOwn(antes, k) && claveValida(k) === k) mapa[k] = antes[k]
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    const key = claveValida(v?.key)
    const e = key && entradaLimpia(v, 0)
    if (!e) continue
    const previa = Object.hasOwn(mapa, key) ? entradaLimpia(mapa[key], 0) : null
    if (previa && previa.at > e.at) continue
    mapa[key] = e
  }
  return entero ? { ...checks, checks: mapa } : mapa
}

/**
 * La huella de los modelos conectados: cambia si cambian los proveedores o sus
 * modelos (un `opencode auth login`, un proveedor nuevo). Pura y determinista:
 * las claves ordenadas, un djb2 de 32 bits en hexadecimal y cuántas son. No es
 * criptográfica ni tiene por qué: sólo decide si lo guardado habla de lo mismo.
 */
export function modelsFingerprint(models) {
  const claves = [...new Set((Array.isArray(models) ? models : []).map(claveValida).filter(Boolean))].sort()
  let h = 5381
  const texto = claves.join('\n')
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0
  return `${claves.length}-${h.toString(16).padStart(8, '0')}`
}

/** El modelo de la lista que corresponde a `model` (objeto o 'prov/model'), o null. */
function enLista(models, model) {
  const k = claveValida(model)
  if (!k) return null
  return (models || []).find((m) => m && claveValida(m) === k) || null
}

/**
 * Lo que tiene sentido elegir de oficio: ni retirado ni sin herramientas. Faro
 * necesita herramientas para el MCP; un modelo sin ellas no puede ni comprobar
 * las claves. Sin esos campos (la lista de antes de H16), vale todo.
 */
function utilizable(m) {
  return m.toolcall !== false && m.status !== 'deprecated'
}

/**
 * Qué modelo PRESELECCIONAR en la pantalla de elegir (H17). Pura, y sólo
 * preselecciona: el modelo lo elige la persona (§8.25). En este orden:
 * 1. el que tenga el veredicto `ok` más reciente (ya se sabe que contesta);
 * 2. `config.model` de opencode, si está en la lista y no ha fallado;
 * 3. el primer default de proveedor (en el orden de `defaults`) sin fallo;
 * 4. nada.
 * Nunca un modelo con veredicto de fallo vigente. En los pasos 2 y 3 salta
 * además lo retirado o sin herramientas (`utilizable`): un default de opencode
 * puede serlo, y proponerlo sería proponer algo que no va a poder comprobar.
 */
export function recommendModel(models, { configModel = null, defaults = {}, checks = null, now = Date.now() } = {}) {
  const lista = (Array.isArray(models) ? models : []).filter((m) => m && claveValida(m))
  let mejor = null
  for (const m of lista) {
    const v = checks ? modelVerdict(checks, m, now) : null
    if (v?.ok && (!mejor || v.at > mejor.at)) mejor = { m, at: v.at }
  }
  if (mejor) return mejor.m

  const sano = (m) => m && utilizable(m) && !(checks && falloVigente(checks, m, now))
  const deConfig = enLista(lista, configModel)
  if (sano(deConfig)) return deConfig

  for (const [providerID, modelID] of Object.entries(defaults || {})) {
    const hit = enLista(lista, { providerID, modelID })
    if (sano(hit)) return hit
  }
  return null
}

/**
 * Con qué modelo arranca el panel (H16). Pura, y NUNCA elige sola (§8.25):
 * - `settingsModel` (el de la persona) si está en la lista y no ha fallado;
 * - si no, el `saved.model` del sitio, que es de antes de H16: si vale, el
 *   panel lo copia UNA vez a `settings.model` (`migrate`), y a partir de ahí
 *   sale por la primera rama;
 * - si no, `{model: null}`: sin modelo resuelto el panel pregunta.
 * Sin lista de modelos no se decide nada (lo que haga el panel con un modelo
 * guardado sin poder validarlo es cosa suya: aquí no hay con qué comparar).
 */
export function resolveModel(models, { settingsModel = null, savedModel = null, checks = null, now = Date.now() } = {}) {
  const sano = (m) => m && !(checks && falloVigente(checks, m, now))
  const deAjustes = enLista(models, settingsModel)
  if (sano(deAjustes)) return { model: deAjustes, source: 'settings', migrate: false }
  const delSitio = enLista(models, savedModel)
  if (sano(delSitio)) return { model: delSitio, source: 'migracion', migrate: true }
  return { model: null, source: '', migrate: false }
}

/**
 * La lista con cada modelo MARCADO si no sirve a Faro, sin borrar ninguno. Pura.
 *
 * `deprecated` (opencode lo va a retirar) o `sin-herramientas` (`toolcall:
 * false`: no puede usar el MCP). Se marcan y no se quitan porque la pantalla
 * los enseña plegados con su motivo, y porque si no quedara nada, esconderlos
 * dejaría a la persona sin saber por qué. Devuelve copias: no toca la lista.
 */
export function usableModels(models) {
  return (Array.isArray(models) ? models : []).map((m) => {
    const unusableReason = m?.status === 'deprecated' ? 'deprecated' : m?.toolcall === false ? 'sin-herramientas' : ''
    return { ...m, usable: !unusableReason, unusableReason }
  })
}
