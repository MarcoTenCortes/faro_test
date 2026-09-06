/**
 * El texto de la página en bloques numerados, y cómo volver a encontrarlos.
 *
 * Al modelo no se le pide que copie frases de memoria: se le enseña la página
 * tal como se ve en pantalla, troceada en bloques —párrafo, encabezado,
 * viñeta, celda, código— y numerada «¶1, ¶2, ¶3…». Cada observación suya
 * apunta a un número de bloque y, si quiere afinar, a una cita literal dentro
 * de él. Es lo que hace que el subrayado lo decida un script y no el modelo:
 * el JSON dice «¶12», y ¶12 es un elemento concreto del DOM.
 *
 * Aquí vive la parte pura, la que no necesita DOM y se prueba en Node:
 *  - `formatDigest`, la forma en que se le enseñan los bloques al modelo;
 *  - `blockHint`, las primeras letras de un bloque, que la EXTENSIÓN guarda
 *    para comprobar después que el bloque sigue siendo el mismo;
 *  - `matchBlock`, la comprobación: el número del modelo es una preferencia,
 *    el texto manda. Si la página se movió un bloque entre que se leyó y se
 *    marcó, la marca sigue en su sitio.
 *
 * La mitad que toca el DOM —recorrer la página y resolver un bloque a un
 * Range— está en `src/content/digest.js`.
 */

import { normalize } from '../content/anchor-match.js'

export const DIGEST_LIMITS = {
  /** Tope de caracteres del texto que se le enseña al modelo, con prefijos. */
  maxChars: 30000,
  /** Tope de bloques: una página de 400 párrafos ya no cabe en el contexto de nadie. */
  maxBlocks: 400,
  /** Un bloque más largo se recorta: un párrafo de 1500 caracteres ya identifica algo. */
  blockMax: 1500,
  /** Menos de dos caracteres no es un bloque, es un adorno. */
  blockMin: 2,
  /** Cuántas letras del bloque se guardan para reconocerlo después. */
  hintMax: 80,
  /** Una cita sin bloque válido sólo se busca en toda la página si tiene sustancia. */
  quoteMinGlobal: 8,
}

/** Espacios, tabuladores y saltos de línea colapsados a un espacio. Puro. */
export function squash(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Las primeras letras de un bloque, que es lo que hace falta para reconocerlo.
 *
 * Sale del texto que la extensión leyó de la página, nunca de lo que devuelve
 * el modelo: es la comprobación, no puede venir de quien se comprueba.
 */
export function blockHint(text) {
  return squash(text).slice(0, DIGEST_LIMITS.hintMax)
}

/**
 * Cómo se le enseñan los bloques al modelo: una línea por bloque.
 *
 *   ¶1 [h1] ADR-014 Rotación de tokens de servicio
 *   ¶2 [p] Hasta ahora los tokens de servicio no caducaban…
 *
 * @param {Array<{id:number, tag:string, text:string}>} blocks
 */
export function formatDigest(blocks) {
  return (blocks || []).map((b) => `¶${b.id} [${b.tag}] ${b.text}`).join('\n')
}

/**
 * Encuentra el bloque al que se refiere una observación.
 *
 * El número que dio el modelo es sólo una preferencia: lo que identifica el
 * bloque son sus primeras letras, que guardó la extensión. Si en esa posición
 * sigue estando el mismo texto, es él; si no, se busca el bloque con ese
 * texto más cercano a la posición esperada —la página se reeditó o se
 * desplegó algo por encima— y se dice que se movió. Sin texto que comprobar,
 * no hay bloque: marcar «el párrafo 12» sin saber cuál era sería marcar
 * cualquier cosa.
 *
 * @param {Array<{text:string}>} blocks los bloques de la página AHORA
 * @param {{block:number, hint:string}} anchor
 * @returns {{index:number, strategy:'block'|'block-moved'}|null}
 */
export function matchBlock(blocks, anchor) {
  const lista = Array.isArray(blocks) ? blocks : []
  const pista = normalize(String(anchor?.hint ?? '')).text
  if (!pista) return null

  const esperado = Number(anchor?.block) - 1
  const coincide = (b) => !!b && normalize(String(b.text ?? '')).text.startsWith(pista)

  if (Number.isInteger(esperado) && esperado >= 0 && coincide(lista[esperado])) {
    return { index: esperado, strategy: 'block' }
  }

  let mejor = -1
  for (let i = 0; i < lista.length; i++) {
    if (!coincide(lista[i])) continue
    if (mejor === -1 || distancia(i, esperado) < distancia(mejor, esperado)) mejor = i
  }
  return mejor === -1 ? null : { index: mejor, strategy: 'block-moved' }
}

function distancia(i, esperado) {
  return Number.isFinite(esperado) ? Math.abs(i - esperado) : i
}
