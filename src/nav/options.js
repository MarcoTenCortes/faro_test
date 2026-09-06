/**
 * Qué botones ofrece la tarjeta de navegación.
 *
 * Existe como función aparte porque aquí estuvo un fallo real: cuando el
 * modelo recomendaba «direct», el plan salía sin pasos y la tarjeta sólo podía
 * ofrecer «Llévame». Elegir entre ir de golpe o que te enseñen el camino es
 * del usuario, no del modelo.
 *
 * Por eso manda el ajuste, no la recomendación del plan:
 *  - `guided`: siempre que haya camino, «Paso a paso» va destacado y «Llévame»
 *    al lado. Sin camino, sólo queda ir de golpe.
 *  - `quick`: sólo «Llévame», siempre. Es el modo para quien no quiere esperar
 *    ni recorrer nada.
 *
 * Pura, para poder comprobarla sin navegador.
 */

/**
 * @param {{steps?:Array}} plan
 * @param {{navMode?:'guided'|'quick'}} settings
 * @returns {Array<{mode:'direct'|'assisted', label:string, kind:'primary'|'ghost'}>}
 */
export function navOptions(plan, { navMode = 'guided' } = {}) {
  const directa = { mode: 'direct', label: 'Llévame', kind: 'ghost' }
  const asistida = { mode: 'assisted', label: 'Paso a paso', kind: 'ghost' }

  // Sin al menos dos paradas no hay recorrido que enseñar: enseñar un único
  // paso que ya es el destino sería teatro.
  const cabeAsistida = (plan?.steps?.length || 0) > 1
  if (navMode === 'quick' || !cabeAsistida) return [{ ...directa, kind: 'primary' }]

  return [{ ...asistida, kind: 'primary' }, directa]
}
