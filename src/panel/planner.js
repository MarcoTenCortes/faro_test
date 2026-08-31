/**
 * Del texto de una respuesta a un plan de navegación validado.
 *
 * Pedir un plan cuesta un turno extra de modelo, así que primero se descarta
 * lo obvio con una heurística barata (`shouldPlan`) y sólo se pregunta cuando
 * la respuesta parece apuntar a algún sitio concreto.
 */

import { NAVIGATION_PLAN_SCHEMA, plannerSystemPrompt } from '../nav/schema.js'
import { validatePlan } from '../nav/validate.js'
import { indexDigest } from '../atlassian/index-store.js'
import { plannerPrompt } from './prompts.js'
import { fetchAncestry } from './indexer.js'

const ISSUE_KEY = /\b[A-Z][A-Z0-9_]{1,9}-\d+\b/
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

/**
 * Pide el plan y lo valida. Nunca lanza: si algo va mal, simplemente no se
 * ofrece navegación.
 *
 * @returns {{plan?:object, reason?:string}}
 */
export async function planNavigation(client, { sessionID, model, plannerModel, question, answer, index, origin, host, site, here, force, onIndex }) {
  // `force` lo pone la Skill de búsqueda: ahí llevar al usuario ES la respuesta,
  // así que no se descarta por heurística antes de haberlo intentado.
  if (!force && !shouldPlan(answer, index)) {
    return { reason: 'la respuesta no apunta a ningún sitio del índice' }
  }

  let raw
  try {
    raw = await client.promptStructured(sessionID, {
      // El digest se acota a lo que tiene que ver con la respuesta: con un
      // indice grande, mandarlo entero hacia el turno mucho mas lento.
      text: plannerPrompt({ question, answer, digest: indexDigest(index, { relevantTo: answer, maxPages: 60 }) }),
      model: plannerModel || model,
      system: plannerSystemPrompt(),
      schema: NAVIGATION_PLAN_SCHEMA,
    })
  } catch (err) {
    return { reason: String(err?.message || err) }
  }

  let result = validatePlan(raw, { index, origin, host, here })
  if (!result.ok) return { reason: result.reason }
  if (!result.plan.navigate) return { reason: 'el modelo decidió que no hay destino' }

  // Sin saber quién es el padre del destino no hay rama del árbol que desplegar,
  // y la navegación guiada se queda en un salto seco. Se pregunta por sus
  // antepasados una vez y se guarda, en vez de obligar a reindexar el sitio.
  //
  // La condición mira el `parentId`, no cuántos pasos salieron: contar pasos
  // engañaba, porque un camino inventado por el modelo ya traía dos y la
  // jerarquía real no se llegaba a pedir nunca.
  const destino = result.plan.destination
  const sinPadre = destino.kind === 'confluence-page' && !index?.pages?.[destino.id]?.parentId

  if (site && sinPadre) {
    const { index: enriquecido, added } = await fetchAncestry(client, {
      sessionID,
      model,
      site,
      index,
      pageId: destino.id,
      title: destino.title,
    })
    if (added > 0) {
      onIndex?.(enriquecido)
      const reintento = validatePlan(raw, { index: enriquecido, origin, host, here })
      if (reintento.ok && reintento.plan.navigate) result = reintento
    }
  }

  return { plan: result.plan }
}
