/**
 * ¿Está el chat pegado al fondo?
 *
 * El chat se desplazaba al fondo en cada trozo de respuesta —varias veces por
 * segundo en streaming— aunque el usuario hubiera subido con la rueda a leer
 * la primera observación; y otra vez al colgar la tarjeta de marcas veinte
 * segundos después de terminar (docs/PLAN.md §2.5 A7, reproducido en la
 * auditoría del 2026-09-13). La regla ahora es la de cualquier chat: se sigue
 * al final sólo si el usuario ESTABA al final. Y se mide en cada scroll, antes
 * de que nada mute el DOM: después de añadir un trozo el chat ya no está «al
 * fondo» aunque el usuario no se haya movido.
 *
 * Pura: recibe las tres medidas (o el propio elemento, que las tiene como
 * propiedades) y devuelve un booleano. Sin DOM.
 */

/** Píxeles de holgura: un par de líneas por encima del fondo no es «haber subido a leer». */
export const SCROLL_SLACK = 48

/**
 * @param {{scrollTop?: number, scrollHeight?: number, clientHeight?: number}|null} box
 *        las medidas del contenedor con scroll (vale el elemento)
 * @param {number} [slack] holgura en píxeles
 * @returns {boolean} true si el fondo está a `slack` píxeles o menos; también
 *          sin medidas válidas (sin DOM que medir, el comportamiento de antes:
 *          seguir al final)
 */
export function stuckToBottom(box, slack = SCROLL_SLACK) {
  const top = Number(box?.scrollTop)
  const height = Number(box?.scrollHeight)
  const client = Number(box?.clientHeight)
  if (![top, height, client].every(Number.isFinite)) return true
  return height - top - client <= slack
}
