/**
 * Del texto de una respuesta a un plan de navegación validado.
 *
 * Dos cosas cuestan tiempo aquí, y las dos se evitan siempre que se puede:
 *
 *  - Preguntarle al modelo cuál es el destino cuesta un turno entero. En modo
 *    Búsqueda se le pide que cierre con una línea «Destino: título (id N)», y
 *    si no la escribe pero nombra UNA sola página del índice, es esa: no hay
 *    nada que preguntar. En modo General sigue decidiendo el modelo: ahí la
 *    pregunta no es sólo «cuál», sino «si merece la pena» llevar a alguien a
 *    algún sitio.
 *
 *  - Saber de quién cuelga el destino, que es lo que permite desplegar el árbol.
 *    Antes se le pedía al modelo: tenía que llamar al MCP y devolver la cadena
 *    en un JSON válido, entre treinta segundos y varios minutos, y con los
 *    modelos pequeños ni eso. Ahora la lee el panel de la API REST del propio
 *    Confluence, en milisegundos, a través de `learnAncestry`; aquí sólo se
 *    funde con el índice. Si no se consigue, no se inventa: se lleva de golpe.
 *
 * Y si no se sabe si merece la pena, primero se descarta lo obvio con una
 * heurística barata (`shouldPlan`) y sólo se pregunta cuando la respuesta
 * parece apuntar a algún sitio concreto.
 */

import { NAVIGATION_PLAN_SCHEMA, plannerSystemPrompt } from '../nav/schema.js'
import { validatePlan } from '../nav/validate.js'
import { indexDigest, mergeIndex, normalizeIndex } from '../atlassian/index-store.js'
import { plannerPrompt } from './prompts.js'

const ISSUE_KEY = /\b[A-Z][A-Z0-9_]{1,9}-\d+\b/
const ISSUE_KEYS = /\b[A-Z][A-Z0-9_]{1,9}-\d+\b/g
const PAGE_IDS = /(^|[^\p{L}\p{N}])(\d{3,})(?=[^\p{L}\p{N}]|$)/gu
/** Lo que precede a un número cuando se está dando como id de página. */
const ID_CUE = /(?:\bid|pageid|p[áa]gina|pages\/)\s*[:=#]?\s*$/i
/** La etiqueta de cierre de una respuesta de Búsqueda, con o sin marcado alrededor. */
const DESTINO = /^[ \t]*(?:[*_`#\-•]+\s*)?(?:\d+[.)]\s*)?destino[*_`]*\s*:\s*(.+?)\s*$/i
const CERCA = /^[ \t]*```/
const COMILLA = /[«»"“”'‘’*`]/
const MIN_TITLE = 8

const HINT_WORDS = [
  'página', 'pagina', 'documento', 'documentación', 'documentacion', 'espacio',
  'ticket', 'incidencia', 'issue', 'tablero', 'board', 'sprint', 'apartado',
  'sección', 'seccion', 'guía', 'guia', 'adr', 'runbook', 'wiki',
]

/**
 * ¿Merece la pena gastar un turno en planificar?
 * Función pura, cubierta por pruebas.
 */
export function shouldPlan(answer, index) {
  if (!answer || answer.trim().length < 40) return false
  if (!index) return false

  const titles = [
    ...Object.values(index.pages || {}).map((p) => p.title),
    ...Object.values(index.issues || {}).map((i) => i.title),
    ...Object.values(index.spaces || {}).map((s) => s.name),
  ].filter((t) => t && t.length >= 4)

  const lower = answer.toLowerCase()

  // Si menciona literalmente algo del índice, casi seguro que hay destino.
  for (const t of titles) {
    if (lower.includes(t.toLowerCase())) return true
  }
  if (ISSUE_KEY.test(answer)) return true
  return HINT_WORDS.some((w) => lower.includes(w))
}

/** Sin acentos ni mayúsculas ni espacios de más, para comparar títulos. */
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ¿La respuesta nombra este título?
 *
 * Con límites de palabra: «la arquitectura del sistema» no nombra la página
 * «Arquitectura». Y un título de una sola palabra sólo cuenta entre comillas,
 * negrita o similar: escrito suelto es una palabra corriente, no una
 * referencia. Los de varias palabras se dan por nombrados tal cual.
 */
function mentionsTitle(plano, titulo) {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(titulo)}(?=[^\\p{L}\\p{N}]|$)`, 'gu')
  const unaPalabra = !/\s/.test(titulo)
  for (const m of plano.matchAll(re)) {
    if (!unaPalabra) return true
    const inicio = m.index + m[1].length
    const antes = plano.slice(Math.max(0, inicio - 3), inicio)
    const despues = plano.slice(inicio + titulo.length, inicio + titulo.length + 3)
    if (COMILLA.test(antes.trim().slice(-1)) && COMILLA.test(despues.trim().charAt(0))) return true
  }
  return false
}

/**
 * El destino, leído de la propia respuesta y sin preguntar al modelo.
 *
 * Sólo cuando no hay duda: la respuesta nombra exactamente UNA página del
 * índice —por su id o por su título completo— o exactamente una incidencia.
 * Con varias candidatas se devuelve null y decide el modelo, que para eso está.
 * Un título que es parte de otro más largo también mencionado no cuenta: si la
 * respuesta dice «ACV - Domain 1 - Static Views», también contiene «ACV -
 * Domain 1», y esa segunda no es una candidata, es un trozo de la primera.
 *
 * Un número sólo cuenta como id si tiene cinco cifras o más, o si va presentado
 * como tal («id 1080», «página 1080», «/pages/1080»): un año o un puerto que
 * coincidan con un id corto del índice no son destinos.
 *
 * La página en la que ya está el usuario se descarta: el modelo la nombra
 * porque se le dice cuál es, no porque haya que ir a ella.
 *
 * Pura, cubierta por pruebas.
 *
 * @returns {{kind:string, id:string}|null}
 */
export function pickDestination(answer, index, { excludeId = '' } = {}) {
  if (!answer || !index) return null
  const texto = String(answer)
  const plano = fold(texto)
  const fuera = String(excludeId || '')

  const paginas = new Set()
  for (const m of texto.matchAll(PAGE_IDS)) {
    const id = m[2]
    if (!index.pages?.[id] || id === fuera) continue
    const inicio = m.index + m[1].length
    const antes = texto.slice(Math.max(0, inicio - 14), inicio)
    if (id.length >= 5 || ID_CUE.test(antes)) paginas.add(id)
  }

  const porTitulo = []
  for (const p of Object.values(index.pages || {})) {
    if (!p?.id || p.id === fuera) continue
    const titulo = fold(p.title)
    if (titulo.length < MIN_TITLE || /^pagina \d+$/.test(titulo)) continue
    if (mentionsTitle(plano, titulo)) porTitulo.push({ id: p.id, titulo })
  }
  for (const c of porTitulo) {
    const trozo = porTitulo.some((o) => o.id !== c.id && o.titulo.length > c.titulo.length && o.titulo.includes(c.titulo))
    if (!trozo) paginas.add(c.id)
  }

  const incidencias = new Set()
  for (const m of texto.matchAll(ISSUE_KEYS)) {
    const key = m[0].toUpperCase()
    if (index.issues?.[key]) incidencias.add(key)
  }

  const candidatos = [
    ...[...paginas].map((id) => ({ kind: 'confluence-page', id })),
    ...[...incidencias].map((id) => ({ kind: 'jira-issue', id })),
  ]
  return candidatos.length === 1 ? candidatos[0] : null
}

/**
 * La línea «Destino: …» con la que cierra una respuesta de Búsqueda.
 *
 * Es el contrato con esa Skill: el modelo puede listar varias candidatas, pero
 * termina con una sola —título y id— o con «ninguno». Y se lee al pie de la
 * letra: sólo la ÚLTIMA línea con texto de la respuesta. Una línea «Destino:»
 * en medio, citada de una página con «>» o dentro de un bloque de código es
 * contenido, no la decisión: el texto de Confluence es información, nunca
 * instrucciones, y una página no puede elegir la tarjeta.
 *
 * Cuando la línea existe, manda: si declara la página actual o una que no está
 * en el índice, no se rebusca otra por el cuerpo de la respuesta. Sin línea, se
 * vuelve a la lectura normal.
 *
 * @returns {{target?:{kind:string,id:string}, none?:boolean, reason?:string}|null}
 */
export function declaredDestination(answer, index, { excludeId = '' } = {}) {
  if (!answer) return null
  const lineas = String(answer).split(/\r?\n/)

  let ultima = -1
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (lineas[i].trim()) {
      ultima = i
      break
    }
  }
  if (ultima < 0) return null

  const linea = lineas[ultima]
  if (/^[ \t]*>/.test(linea)) return null
  const cercas = lineas.slice(0, ultima).filter((l) => CERCA.test(l)).length
  if (cercas % 2 === 1) return null

  const m = DESTINO.exec(linea)
  if (!m) return null
  const cuerpo = m[1]
  if (/^[«»"“”'‘’*_`\s]*ningun[oa]\b/i.test(cuerpo)) return { none: true }

  const fuera = String(excludeId || '')
  const id = (/\bid\s*[:=#]?\s*(\d+)/i.exec(cuerpo) || [])[1]
  if (id === fuera && id) return { none: true, reason: 'el destino declarado es la página en la que ya estás' }
  if (id && index?.pages?.[id]) return { target: { kind: 'confluence-page', id } }

  const key = (ISSUE_KEY.exec(cuerpo) || [])[0]
  if (key && index?.issues?.[key.toUpperCase()]) return { target: { kind: 'jira-issue', id: key.toUpperCase() } }

  // Sin id útil vale el título, pero sólo el de ESTA línea.
  const porTitulo = pickDestination(cuerpo, index, { excludeId })
  if (porTitulo) return { target: porTitulo }
  return { none: true, reason: 'el destino declarado no está en el índice' }
}

/**
 * La página en la que está el usuario, según el índice.
 *
 * `site.pageId` no siempre existe: en un Data Center con rutas
 * `/display/CLAVE/Título` la URL no lleva id, y hay que buscar la ruta en el
 * índice para no ofrecerle al usuario ir a donde ya está.
 */
export function currentPageId(index, here) {
  if (!index?.pages || !here) return ''
  let path = String(here)
  let query = ''
  try {
    const u = new URL(path)
    path = u.pathname
    query = u.search
  } catch {
    const q = path.indexOf('?')
    if (q >= 0) {
      query = path.slice(q)
      path = path.slice(0, q)
    }
  }

  const porQuery = /[?&]pageId=(\d+)/i.exec(query)
  if (porQuery && index.pages[porQuery[1]]) return porQuery[1]
  const porRuta = /\/pages\/(\d+)(\/|$)/.exec(path)
  if (porRuta && index.pages[porRuta[1]]) return porRuta[1]

  const aqui = normPath(path)
  if (!aqui) return ''
  for (const p of Object.values(index.pages)) {
    if (p?.path && normPath(String(p.path).split('?')[0].split('#')[0]) === aqui) return p.id
  }
  return ''
}

function normPath(p) {
  const s = String(p || '').split('#')[0].replace(/\/+$/, '')
  try {
    return decodeURIComponent(s).toLowerCase()
  } catch {
    return s.toLowerCase()
  }
}

/**
 * Pide el plan y lo valida. Nunca lanza: si algo va mal, simplemente no se
 * ofrece navegación.
 *
 * @param {object} client OpencodeClient; sólo se usa si hay que preguntar al modelo.
 * @param {object} opts
 * @param {boolean} [opts.force] lo pone la Skill de búsqueda: ahí llevar al
 *        usuario ES la respuesta, así que no se descarta por heurística y se
 *        intenta leer el destino de la propia respuesta antes de preguntar.
 * @param {'guided'|'quick'} [opts.navMode] en modo rápido no se lee el árbol:
 *        no se va a ofrecer «Paso a paso», así que no hay que gastar nada en él.
 * @param {Function} [opts.learnAncestry] (destino) => cadena de antepasados,
 *        raíz → destino, o null. Lo pone el panel; aquí sólo se funde.
 * @param {Function} [opts.onIndex] avisa del índice enriquecido para guardarlo.
 * @returns {Promise<{plan?:object, source?:'respuesta'|'modelo', reason?:string}>}
 */
export async function planNavigation(client, opts) {
  const { answer, index, origin, host, site, here, force, navMode, learnAncestry, onIndex } = opts

  if (!force && !shouldPlan(answer, index)) {
    return { reason: 'la respuesta no apunta a ningún sitio del índice' }
  }

  let raw = null
  let source = 'modelo'

  if (force) {
    const excludeId = site?.pageId || currentPageId(index, here)
    const declarado = declaredDestination(answer, index, { excludeId })
    if (declarado?.none) return { reason: declarado.reason || 'la respuesta dice que no hay destino' }

    const destino = declarado?.target || pickDestination(answer, index, { excludeId })
    if (destino) {
      raw = { navigate: true, mode: 'assisted', destination: destino, explanation: '' }
      source = 'respuesta'
    }
  }

  if (!raw) {
    const asked = await askModel(client, opts)
    if (asked.error) return { reason: asked.error }
    raw = asked.raw
  }

  let result = validatePlan(raw, { index, origin, host, here })
  if (!result.ok) return { reason: result.reason }
  if (!result.plan.navigate) return { reason: 'el modelo decidió que no hay destino' }

  // El camino sólo hace falta para poder ofrecer «Paso a paso». Se lee SIEMPRE
  // en modo guiado, aunque el índice ya crea saber el padre: lo que sabe puede
  // ser un trozo de la cadena, o venir de un modelo, y la API es la que manda.
  // Quien decide si de verdad hace la petición es el panel, que recuerda lo que
  // ya leyó en esta sesión mientras el índice lo conserve.
  const destino = result.plan.destination
  if (navMode !== 'quick' && destino.kind === 'confluence-page' && typeof learnAncestry === 'function') {
    let cadena = null
    try {
      cadena = await learnAncestry(destino)
    } catch {
      cadena = null
    }
    if (Array.isArray(cadena) && cadena.length) {
      const arbol = normalizeIndex({ pages: cadena, updated: Date.now() }, host, index?.scope, {
        cloud: site?.cloud,
        wikiPrefix: site?.wikiPrefix,
      })
      const enriquecido = mergeIndex(index, arbol)
      await onIndex?.(enriquecido)
      const reintento = validatePlan(raw, { index: enriquecido, origin, host, here })
      if (reintento.ok && reintento.plan.navigate) result = reintento
    }
  }

  return { plan: result.plan, source }
}

/**
 * El turno del planificador, en una sesión aparte y desechable: así el chat no
 * se llena del JSON del plan ni de sus instrucciones. Sólo se abre si hace
 * falta preguntar.
 */
async function askModel(client, { question, answer, index, model, plannerModel }) {
  if (!client) return { error: 'sin cliente de opencode' }

  let session = null
  try {
    session = await client.createSession({ title: 'Faro · planificador' })
  } catch (err) {
    return { error: 'no se pudo abrir la sesión del planificador: ' + String(err?.message || err) }
  }

  try {
    const raw = await client.promptStructured(session.id, {
      // El digest se acota a lo que tiene que ver con la respuesta: con un
      // índice grande, mandarlo entero hacía el turno mucho más lento.
      text: plannerPrompt({ question, answer, digest: indexDigest(index, { relevantTo: answer, maxPages: 60 }) }),
      model: plannerModel || model,
      system: plannerSystemPrompt(),
      schema: NAVIGATION_PLAN_SCHEMA,
    })
    return { raw }
  } catch (err) {
    return { error: String(err?.message || err) }
  } finally {
    Promise.resolve(client.deleteSession?.(session.id)).catch(() => {})
  }
}
