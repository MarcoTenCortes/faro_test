/**
 * Qué botones ofrece la tarjeta de navegación.
 *
 * Existe como función aparte porque aquí estuvo un fallo real: cuando el
 * modelo recomendaba «direct», el plan salía sin pasos y la tarjeta sólo podía
 * ofrecer «Llévame». Elegir entre ir de golpe o que te enseñen el camino es
 * del usuario, no del modelo.
 *
 * Pura, para poder comprobarla sin navegador.
 */

/**
 * @param {{mode?:string, steps?:Array}} plan
 * @param {{assistedByDefault?:boolean}} settings
 * @returns {Array<{mode:'direct'|'assisted', label:string, kind:'primary'|'ghost'}>}
 */
export function navOptions(plan, { assistedByDefault = false } = {}) {
  const directa = { mode: 'direct', label: 'Llévame', kind: 'ghost' }
  const asistida = { mode: 'assisted', label: 'Paso a paso', kind: 'ghost' }

  // Sin al menos dos paradas no hay recorrido que enseñar: enseñar un único
  // paso que ya es el destino sería teatro.
  const cabeAsistida = (plan?.steps?.length || 0) > 1
  if (!cabeAsistida) return [{ ...directa, kind: 'primary' }]

  // La destacada es la que Faro recomienda; las dos se ofrecen siempre.
  const recomiendaAsistida = plan.mode === 'assisted' || assistedByDefault
  return recomiendaAsistida
    ? [{ ...asistida, kind: 'primary' }, directa]
    : [{ ...directa, kind: 'primary' }, asistida]
}
