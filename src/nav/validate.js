/**
 * Validación del plan de navegación.
 *
 * Esta es la barrera de seguridad de toda la extensión. Todo lo que sale del
 * modelo pasa por aquí antes de tocar la página, y nada llega al content
 * script sin haber sido resuelto contra el índice y contra el origen real de
 * la pestaña. Funciones puras.
 */

import { resolveTarget, ancestryOf } from '../atlassian/index-store.js'
import { TARGET_KINDS } from './schema.js'

export const ANCHOR_LIMITS = {
  exactMin: 3,
  exactMax: 300,
  affixMax: 80,
  headingMax: 200,
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')
const WHITESPACE = new RegExp('\\s+', 'g')

/** Quita caracteres de control y normaliza espacios. */
export function clean(value, max) {
  if (typeof value !== 'string') return ''
  const stripped = value.replace(CONTROL_CHARS, ' ').replace(WHITESPACE, ' ').trim()
  return max ? stripped.slice(0, max) : stripped
}

/**
 * @param {object} raw plan tal cual lo devolvió el modelo
 * @param {{index: object, origin: string, host: string, here?: string}} ctx
 *        `here` es la URL o la ruta que el usuario tiene abierta ahora mismo.
 *        Sirve para no meter en el recorrido un salto al espacio en el que ya
 *        estamos, que sólo consigue recargar la página y plegar el árbol.
 * @returns {{ok: boolean, reason?: string, plan?: object}}
 */
export function validatePlan(raw, ctx) {
  if (!raw || typeof raw !== 'object') return fail('El plan no es un objeto.')
  const { index, origin, here } = ctx || {}
  if (!origin) return fail('Falta el origen de la pestaña.')

  if (raw.navigate === false) {
    return { ok: true, plan: { navigate: false, explanation: clean(raw.explanation, 400) } }
  }

  if (!index) return fail('Todavía no hay índice para este sitio.')

  const mode = raw.mode === 'assisted' ? 'assisted' : 'direct'

  const destination = resolveTarget(index, origin, raw.destination || {})
  if (!destination) {
    return fail(
      raw.destination?.id
        ? `El destino «${clean(String(raw.destination.id), 60)}» no está en el índice de este sitio.`
        : 'El plan no trae destino.'
    )
  }
  if (!sameOrigin(destination.url, origin)) return fail('El destino apunta fuera del sitio actual.')

  const anchor = validateAnchor(raw.anchor)

  // El camino se calcula SIEMPRE, diga el modelo lo que diga. `mode` es sólo
  // la recomendación; quien elige entre ir directo o paso a paso es el usuario,
  // y para poder ofrecerle las dos cosas hacen falta los pasos.
  //
  // Para una página de Confluence el camino es su rama del ÁRBOL, y punto. El
  // `path` del modelo no cuenta aquí, y esto viene de un fallo real: ante «¿esta
  // ACV tiene su TCV?» el modelo devolvía un camino de dos saltos —la página de
  // origen y la de destino— que son ramas hermanas del árbol, no un recorrido.
  // La navegación guiada se quedaba sin nada que desplegar y acababa en un salto
  // seco. Quién cuelga de quién lo sabe el índice; el modelo no puede saberlo.
  let steps = treeSteps(index, origin, destination, here)
  if (destination.kind !== 'confluence-page') {
    const delModelo = resolveSteps(raw.path, index, origin)
    if (delModelo.length > steps.length) steps = delModelo
  }
  // El último paso siempre es el destino, aunque el modelo lo olvidara.
  const last = steps[steps.length - 1]
  if (!last || last.id !== destination.id) steps.push({ ...destination, label: destination.title })
  steps = markActions(dedupeSteps(steps).filter((s) => sameOrigin(s.url, origin)))

  return {
    ok: true,
    plan: {
      navigate: true,
      // Lo que Faro sugiere por defecto; ambas opciones se ofrecen igual.
      mode: mode === 'assisted' && steps.length > 1 ? 'assisted' : 'direct',
      destination,
      anchor,
      steps,
      explanation: clean(raw.explanation, 400),
    },
  }
}

function fail(reason) {
  return { ok: false, reason }
}

export function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === new URL(origin).origin
  } catch {
    return false
  }
}

export function validateAnchor(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = raw.kind

  if (kind === 'heading') {
    const headingText = clean(raw.headingText || raw.exact, ANCHOR_LIMITS.headingMax)
    if (!headingText) return null
    return { kind: 'heading', headingText }
  }

  if (kind === 'text-quote') {
    const exact = clean(raw.exact, ANCHOR_LIMITS.exactMax)
    if (exact.length < ANCHOR_LIMITS.exactMin) return null
    return {
      kind: 'text-quote',
      exact,
      prefix: clean(raw.prefix, ANCHOR_LIMITS.affixMax),
      suffix: clean(raw.suffix, ANCHOR_LIMITS.affixMax),
    }
  }

  return null
}

function resolveSteps(path, index, origin) {
  if (!Array.isArray(path)) return []
  const steps = []
  for (const item of path.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    if (item.kind && !TARGET_KINDS.includes(item.kind)) continue
    const target = resolveTarget(index, origin, item)
    if (!target) continue // un paso que no está en el índice se descarta, no rompe el plan
    steps.push({ ...target, label: clean(item.label, 120) || target.title })
  }
  return steps
}

/**
 * El camino tal y como existe de verdad: la rama del árbol de páginas.
 *
 * Es la fuente de verdad de la navegación guiada. Guiar por el árbol consiste
 * en desplegar la cadena de padres del destino, así que los pasos SON esa
 * cadena; cualquier otra cosa es un recorrido inventado.
 */
export function treeSteps(index, origin, destination, here = '') {
  const steps = []

  if (destination.kind === 'confluence-page') {
    const page = index.pages?.[destination.id]
    // El salto al espacio sólo hace falta si venimos de fuera. Estando ya
    // dentro, abrir su portada es una carga de página entera que además pliega
    // el árbol: justo lo que el recorrido necesita conservar.
    if (page?.spaceKey && !inSpace(here, page.spaceKey)) {
      const space = resolveTarget(index, origin, { kind: 'confluence-space', id: page.spaceKey })
      if (space) steps.push({ ...space, label: `Espacio ${space.title}` })
    }
    for (const ancestor of ancestryOf(index, destination.id)) {
      const t = resolveTarget(index, origin, { kind: 'confluence-page', id: ancestor.id })
      if (t) steps.push({ ...t, label: t.title })
    }
  } else if (destination.kind === 'jira-issue') {
    const issue = index.issues?.[destination.id]
    if (issue?.projectKey) {
      const project = resolveTarget(index, origin, { kind: 'jira-project', id: issue.projectKey })
      if (project) steps.push({ ...project, label: `Proyecto ${project.title}` })
    }
  }

  return steps
}

/**
 * ¿La ubicación actual está dentro de este espacio de Confluence?
 * Acepta URL completa o ruta suelta, y las dos formas: `/spaces/KEY` de Cloud y
 * `/display/KEY` de Data Center. Pura.
 */
export function inSpace(here, spaceKey) {
  if (!here || !spaceKey) return false

  let path = String(here)
  try {
    const u = new URL(path)
    path = u.pathname + (u.search || '')
  } catch {
    /* ya venía como ruta */
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    /* con codificación rara, se compara tal cual */
  }

  const p = path.toLowerCase().replace(/\/+$/, '')
  const k = String(spaceKey).toLowerCase()
  for (const base of [`/spaces/${k}`, `/display/${k}`]) {
    if (p === base || p.includes(base + '/') || p.includes(base + '?')) return true
  }
  return p.includes(`spacekey=${k}`)
}

/**
 * Qué hay que HACER en cada paso.
 *
 * La navegación asistida por un árbol de páginas no consiste en abrir ocho
 * páginas seguidas: consiste en ir desplegando las ramas de la izquierda hasta
 * que la página destino queda a la vista, y entonces abrir esa. Sólo el último
 * paso navega; los anteriores despliegan.
 */
export function markActions(steps) {
  return steps.map((s, i) => ({
    ...s,
    action: i === steps.length - 1 ? 'open' : s.kind === 'confluence-page' ? 'expand' : 'open',
  }))
}

function dedupeSteps(steps) {
  const seen = new Set()
  const out = []
  for (const s of steps) {
    const k = s.kind + ':' + s.id
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}
