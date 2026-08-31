/**
 * Elección de modelo. Puro, para poder probarlo.
 *
 * Existe porque un proveedor puede estar configurado en opencode y aun así
 * fallar al usarlo: una sesión OAuth caducada da «Token refresh failed: 401»
 * sólo cuando ya has enviado la pregunta. Cuando eso pasa, lo útil no es un
 * mensaje de error: es poder saltar a otro proveedor de un clic.
 */

/** Modelo por defecto: el primero de `defaults` que exista en la lista. */
export function pickDefaultModel(models, defaults) {
  for (const [providerID, modelID] of Object.entries(defaults || {})) {
    const hit = models.find((m) => m.providerID === providerID && m.modelID === modelID)
    if (hit) return hit
  }
  return models[0] || null
}

/**
 * Alternativa cuando el proveedor actual no responde: se cambia de proveedor,
 * no sólo de modelo, porque el problema es de credenciales del proveedor.
 */
export function pickAlternativeModel(models, defaults, currentProviderID) {
  const others = (models || []).filter((m) => m.providerID !== currentProviderID)
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
 */
export function pickPlannerModel(models, current) {
  if (!current) return current || null
  if (RAPIDOS.test(current.modelID)) return current

  const mismos = (models || []).filter((m) => m.providerID === current.providerID && RAPIDOS.test(m.modelID))
  if (!mismos.length) return current

  // El de nombre mas corto suele ser el modelo base, no una variante rara.
  mismos.sort((a, b) => a.modelID.length - b.modelID.length)
  return { providerID: mismos[0].providerID, modelID: mismos[0].modelID }
}
