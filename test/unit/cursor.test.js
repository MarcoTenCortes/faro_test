/**
 * src/content/overlay/cursor.js: el subrayador azul que hace de cursor al señalar.
 *
 * Por qué se prueba aquí y no sólo en el banco (H23, docs/PLAN2.md §3.6): el
 * SVG acaba escrito, dentro de una URL `data:`, en una hoja que se cuelga del
 * `<head>` de la página. Lo que se pina es que esa cadena no pueda llevar nada
 * ejecutable ni romper la regla de CSS que la envuelve (un `"` crudo cerraría
 * el `url("…")`; un `#` sin codificar corta la URL en un fragmento), que quepa
 * de sobra en lo que un navegador acepta, y que el punto activo sea de verdad
 * la gota de tinta de la punta y no una esquina cualquiera. Que se VEA bien, a
 * 32 px y al 150 % de escala de Windows, sólo lo dice un navegador.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CURSOR_SIZE,
  CURSOR_HOTSPOT,
  CURSOR_TEMAS,
  cursorSvg,
  cursorDataUrl,
  cursorRule,
} from '../../src/content/overlay/cursor.js'

const FUENTE = readFileSync(join(import.meta.dirname, '..', '..', 'src/content/overlay/cursor.js'), 'utf8')
const PREFIJO = 'data:image/svg+xml;utf8,'
const TEMAS = ['claro', 'oscuro']

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

test('H23: el cursor es un SVG de 32×32, y su punto activo es el centro de la gota de tinta', () => {
  eq(CURSOR_SIZE, 32, 'a 32 px Chrome lo pinta sin escalar')
  eq(CURSOR_HOTSPOT, { x: 5, y: 27 })
  assert(Object.isFrozen(CURSOR_HOTSPOT), 'el punto activo no se toca desde fuera')
  eq([...CURSOR_TEMAS], ['claro', 'oscuro'])
  assert(Object.isFrozen(CURSOR_TEMAS), 'ni la lista de temas')
  const { x, y } = CURSOR_HOTSPOT
  assert(x >= 0 && x < CURSOR_SIZE && y >= 0 && y < CURSOR_SIZE, 'el punto activo cae dentro de la imagen')
  for (const tema of TEMAS) {
    const svg = cursorSvg(tema)
    assert(
      svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>"),
      `${tema}: 32×32 y su viewBox`
    )
    assert(svg.endsWith('</svg>'), `${tema}: el SVG se cierra`)
    // El punto activo ES el centro de la gota: si alguien mueve una cosa sin la
    // otra, la selección empieza a unos píxeles de donde el usuario ve la tinta.
    const gota = /<circle cx='([\d.]+)' cy='([\d.]+)' r='1\.6' fill='#2563EB'\/>/.exec(svg)
    assert(gota, `${tema}: la gota de tinta es un círculo de r 1,6 en #2563EB`)
    eq([Number(gota[1]), Number(gota[2])], [x, y], `${tema}: su centro es el punto activo`)
    eq(svg.match(/<circle/g).length, 1, `${tema}: una sola gota`)
  }
})

test('H23: el subrayador lleva su cuerpo por tema, la anilla marino, la punta biselada, el halo blanco y una sombra sin filtros', () => {
  const claro = cursorSvg('claro')
  const oscuro = cursorSvg('oscuro')
  assert(claro.includes("fill='#3B82F6'") && !claro.includes('#60A5FA'), 'el cuerpo claro es #3B82F6')
  assert(oscuro.includes("fill='#60A5FA'") && !oscuro.includes('#3B82F6'), 'el cuerpo oscuro es #60A5FA')
  for (const [tema, svg] of [['claro', claro], ['oscuro', oscuro]]) {
    assert(svg.includes("fill='#1E3A8A'"), `${tema}: la anilla marino`)
    assert(svg.includes("fill='#1D4ED8'"), `${tema}: la punta biselada`)
    assert(svg.includes("stroke='#FFFFFF'"), `${tema}: el halo blanco que lo separa de cualquier fondo`)
    assert(/<path [^>]*fill-opacity='\.\d+'/.test(svg), `${tema}: la sombra es un trazado semitransparente`)
    assert(!/filter|<fe[A-Z]/.test(svg), `${tema}: sin filtros`)
    assert(/rotate\(45\)/.test(svg), `${tema}: inclinado 45°`)
  }
  assert(claro !== oscuro, 'los dos temas son dos cursores distintos')
})

test('SEGURIDAD H23: el SVG no lleva nada ejecutable, ni comillas dobles, ni un salto de línea', () => {
  for (const tema of TEMAS) {
    const svg = cursorSvg(tema)
    assert(!/<script/i.test(svg), `${tema}: sin <script>`)
    assert(!/<style/i.test(svg), `${tema}: sin <style>`)
    assert(!/on[a-z]+\s*=/i.test(svg), `${tema}: sin ningún atributo on…`)
    assert(!/javascript:|href|<image|<foreignObject|<use/i.test(svg), `${tema}: sin enlaces, imágenes ni objetos de fuera`)
    assert(!/chrome/i.test(svg), `${tema}: sin nada de la extensión`)
    assert(!/[\r\n\t]/.test(svg), `${tema}: en una línea`)
    assert(!svg.includes('"'), `${tema}: los atributos van con comillas SIMPLES`)
    assert(!svg.includes('`') && !svg.includes('${'), `${tema}: nada que rompa la plantilla de PICK_CSS`)
  }
})

test('H23: la URL data: sólo codifica % # < > y ", cabe en 2 KB y se decodifica al SVG byte a byte', () => {
  for (const tema of TEMAS) {
    const svg = cursorSvg(tema)
    const url = cursorDataUrl(tema)
    assert(url.startsWith(PREFIJO), `${tema}: empieza por ${PREFIJO}`)
    assert(url.length <= 2048, `${tema}: ${url.length} caracteres, y el tope es 2048`)
    const cuerpo = url.slice(PREFIJO.length)
    assert(!/[#<>"]/.test(cuerpo), `${tema}: ni un # < > " crudo en la URL`)
    eq(decodeURIComponent(cuerpo), svg, `${tema}: decodificada es el SVG, byte a byte`)
    // Sólo esos cinco, y cada uno una vez: tantos «%» en la URL como caracteres
    // de los cinco había en el SVG (un «%2523» sería el # codificado dos veces).
    eq((cuerpo.match(/%/g) || []).length, (svg.match(/[%#<>"]/g) || []).length, `${tema}: nada más se codifica`)
    assert(!cuerpo.includes('%2523'), `${tema}: ningún # codificado dos veces`)
    assert(cuerpo.includes(' ') && cuerpo.includes("'"), `${tema}: los espacios y las comillas simples se quedan como están`)
  }
})

test('H23: cursorRule envuelve la URL entre comillas dobles, con el punto activo y el respaldo text', () => {
  for (const tema of TEMAS) {
    const regla = cursorRule(tema)
    eq(regla, `url("${cursorDataUrl(tema)}") 5 27, text`, tema)
    assert(regla.endsWith(') 5 27, text'), `${tema}: acaba en «5 27, text»`)
    eq(regla.match(/"/g).length, 2, `${tema}: dos comillas dobles, las del url("…")`)
  }
})

test('H23: un tema que no está en la lista cuenta como claro', () => {
  const claro = cursorSvg('claro')
  eq(cursorSvg(), claro, 'sin tema, claro')
  for (const raro of ['otro', '', 'Oscuro', 'oscuro ', 'CLARO', null, 0, 1, {}, [], ['oscuro'], Symbol('oscuro')]) {
    const nombre = typeof raro === 'symbol' ? 'Symbol' : JSON.stringify(raro)
    eq(cursorSvg(raro), claro, 'cursorSvg ' + nombre)
    eq(cursorDataUrl(raro), cursorDataUrl('claro'), 'cursorDataUrl ' + nombre)
    eq(cursorRule(raro), cursorRule('claro'), 'cursorRule ' + nombre)
  }
})

test('H23: cursor.js es puro: sin DOM, sin chrome, sin fetch, y no nombra ninguna URL de la extensión', () => {
  const codigo = sinComentarios(FUENTE)
  for (const prohibido of ['document.', 'window.', 'chrome.', 'fetch(', 'import ']) {
    assert(!codigo.includes(prohibido), `cursor.js no usa ${prohibido}`)
  }
  assert(!/chrome\.runtime\.getURL|chrome-extension:\/\//.test(FUENTE), 'ni siquiera en un comentario')
})
