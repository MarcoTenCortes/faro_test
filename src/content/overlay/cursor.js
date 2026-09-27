/**
 * El cursor de «Señalar»: un subrayador azul con la punta abajo a la izquierda.
 *
 * Por qué existe (H23, docs/PLAN2.md §3.6 y anexo 2-F): mientras se señala, el
 * cursor era una cruz de precisión, `crosshair`, que dice «apunta a un píxel»
 * cuando lo que se hace es SUBRAYAR un texto. El subrayador dice lo que pasa
 * al arrastrar, y su punto activo está en la gota de tinta de la punta, que es
 * donde empieza la selección; el respaldo es `text`, el cursor de seleccionar
 * de toda la vida, por si el navegador no quisiera la imagen.
 *
 * Va en una URL `data:` y no en un fichero de la extensión, a propósito: la
 * hoja `#faro-pick-style` se cuelga del `<head>` de la página, y la URL de un
 * recurso de la extensión escrita ahí dejaría a la vista de la página el GUID
 * de sesión que `use_dynamic_url` existe para esconder (S7). Comprobado el
 * 2026-09-27 en los dos sitios reales (sin sesión: login y dashboard): su CSP
 * sólo manda `frame-ancestors`, sin `img-src` ni `default-src`, así que un
 * cursor `data:` no queda bloqueado.
 *
 * El SVG lleva los atributos entre comillas SIMPLES y ni un salto de línea, y
 * de él sólo se codifican los cinco caracteres que romperían la URL o la regla
 * de CSS que la envuelve (`%`, `#`, `<`, `>` y `"`): así `decodeURIComponent`
 * devuelve el SVG byte a byte, y se lee en el código tal como es. Sin filtros
 * (la sombra es un trazo semitransparente), sin `<script>`, sin `<style>` y
 * sin ningún atributo `on…`.
 *
 * Puro: sin DOM, sin `chrome`, sin `fetch`; nada lanza.
 */

/** Chrome admite cursores de hasta 128 px, pero a 32 se ve nítido y no tapa. */
export const CURSOR_SIZE = 32

/** El punto activo: el centro de la gota de tinta bajo la punta. */
export const CURSOR_HOTSPOT = Object.freeze({ x: 5, y: 27 })

/** Un cursor para página clara y otro para página oscura (sólo cambia el cuerpo). */
export const CURSOR_TEMAS = Object.freeze(['claro', 'oscuro'])

/** El cuerpo del subrayador por tema; lo demás es igual en los dos. */
const CUERPO = Object.freeze({ claro: '#3B82F6', oscuro: '#60A5FA' })
const ANILLA = '#1E3A8A'
const PUNTA = '#1D4ED8'
const TINTA = '#2563EB'

/**
 * La silueta del subrayador en su propio marco: el origen es la punta y el eje
 * largo sube por -y; `rotate(45)` lo inclina hacia arriba a la derecha. La
 * comparten el halo blanco y la sombra, para que los dos abracen la misma pieza.
 */
const SILUETA = 'M0 0L-3.6-4.2V-6.7H-4.6V-10.2H-5V-28.4H5V-10.2H4.6V-6.7H3.6V-3.4Z'

/**
 * El SVG del cursor, en una línea y con comillas simples.
 * @param {'claro'|'oscuro'} tema lo que no esté en CURSOR_TEMAS cuenta como 'claro'
 */
export function cursorSvg(tema = 'claro') {
  const t = CURSOR_TEMAS.includes(tema) ? tema : 'claro'
  const n = CURSOR_SIZE
  const { x, y } = CURSOR_HOTSPOT
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${n}' height='${n}' viewBox='0 0 ${n} ${n}'>` +
    // La sombra: la misma silueta, desplazada y casi transparente.
    `<path transform='translate(${x + 1.2} ${y + 1.6}) rotate(45)' d='${SILUETA}' fill='#0F172A' fill-opacity='.24'/>` +
    `<g transform='translate(${x} ${y}) rotate(45)'>` +
    // El halo blanco, que separa la pieza de cualquier fondo.
    `<path d='${SILUETA}' fill='#FFFFFF' stroke='#FFFFFF' stroke-width='2.4' stroke-linejoin='round'/>` +
    `<g stroke='${ANILLA}' stroke-width='.8' stroke-linejoin='round'>` +
    `<path d='M0 0L-3.6-4.2V-7H3.6V-3.4Z' fill='${PUNTA}'/>` +
    `<rect x='-4.6' y='-10.6' width='9.2' height='3.9' rx='1' fill='${ANILLA}'/>` +
    `<rect x='-5' y='-28.4' width='10' height='18.2' rx='2.4' fill='${CUERPO[t]}'/>` +
    `</g>` +
    `<rect x='-2.9' y='-26.6' width='1.8' height='14.6' rx='.9' fill='#FFFFFF' fill-opacity='.45'/>` +
    `</g>` +
    // La gota de tinta bajo la punta: su centro ES el punto activo.
    `<circle cx='${x}' cy='${y}' r='1.6' fill='${TINTA}'/>` +
    `</svg>`
  )
}

/** Lo que va delante del SVG codificado. */
const PREFIJO = 'data:image/svg+xml;utf8,'

/**
 * La URL `data:` del cursor. Sólo se codifican `%`, `#`, `<`, `>` y `"`, y en
 * ese orden (el `%` primero, o se codificaría dos veces lo ya codificado).
 * @param {'claro'|'oscuro'} tema
 */
export function cursorDataUrl(tema = 'claro') {
  const codificado = cursorSvg(tema)
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, '%22')
  return PREFIJO + codificado
}

/**
 * El valor de la propiedad `cursor`: la imagen con su punto activo y, si el
 * navegador no la quiere, el cursor de seleccionar texto.
 * @param {'claro'|'oscuro'} tema
 */
export function cursorRule(tema = 'claro') {
  return `url("${cursorDataUrl(tema)}") ${CURSOR_HOTSPOT.x} ${CURSOR_HOTSPOT.y}, text`
}
