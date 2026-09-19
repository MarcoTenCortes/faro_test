/**
 * El sistema visual del panel, comprobado sobre el CSS como panel-wiring
 * comprueba panel.js sobre su fuente.
 *
 * Por qué existe: la auditoría del 2026-09-13 (docs/PLAN.md §2) midió cuatro
 * fallos de contraste reales en un script del scratchpad y los números acabaron
 * en la prosa de un anexo: el texto del botón primario y del `.send` sobre
 * --gold en claro (3,09:1, A5), el hover y el activo de la insignia del overlay
 * (2,76:1, A8), los bordes de inputs y del botón fantasma (1,30-1,44:1, A4) y
 * el punto de «desconectado» (1,57:1). Un ratio escrito a mano no protege de
 * nada: al siguiente cambio de color nadie lo recalcula. Aquí cada pareja se
 * mide con la fórmula de WCAG 2.1 (test/contrast.js) en los dos temas, así que
 * un color nuevo que no llegue al umbral rompe `npm run check`.
 *
 * Lo que se pina, además del contraste: que los dos bloques oscuros digan lo
 * mismo (uno es el del sistema y el otro el que fuerza el espejo del banco),
 * que el ámbar de relleno del panel sea byte a byte el del overlay —la pastilla
 * [n] del chat y la insignia de la página son la misma marca—, que cada tema
 * declare su `color-scheme`, y que fuera de :root no haya tamaños, espaciados
 * ni radios a ojo.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, eq, assert } from '../harness.js'
import { contrastRatio, cssVarsOf, parseColor, pxLiterals } from '../contrast.js'
import { OVERLAY_CSS } from '../../src/content/overlay/styles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CSS = readFileSync(join(ROOT, 'src', 'panel', 'panel.css'), 'utf8')

/**
 * El CSS sin comentarios, para todo lo que se busca con una expresión regular.
 * Los comentarios de panel.css NOMBRAN lo que ya no se hace («llevaban
 * `outline: none`», «el ocre --gold #8A5A0A»): contar el recuerdo de un fallo
 * como el fallo dejaría los comentarios sin poder explicar nada.
 */
const SIN_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

const CLARO = ':root'
const OSCURO_SISTEMA = ':root:not([data-theme="light"])'
const OSCURO_FORZADO = ':root[data-theme="dark"]'

const claro = cssVarsOf(CSS, CLARO)
const oscuroSistema = cssVarsOf(CSS, OSCURO_SISTEMA)
const oscuroForzado = cssVarsOf(CSS, OSCURO_FORZADO)

/** El tema oscuro tal como se ve: los colores del bloque oscuro sobre el claro. */
const oscuro = { ...claro, ...oscuroSistema }

const TEMAS = [
  ['claro', claro],
  ['oscuro', oscuro],
]

/**
 * Las parejas que dibujan el panel. `texto` pide 4,5:1 (WCAG SC 1.4.3) y
 * `control` 3:1 (SC 1.4.11, el borde que es lo único que dibuja un control).
 * `temas` acota una pareja al tema en el que existe de verdad.
 */
const TEXTO = [
  ['--ink', '--surface', 'cuerpo del chat sobre una tarjeta'],
  ['--ink', '--ground', 'título de pantalla sobre el fondo'],
  ['--ink-2', '--surface', 'prosa del asistente'],
  ['--ink-2', '--gold-bg', 'texto dentro de un chip dorado'],
  ['--muted', '--surface', 'meta y cita de una observación'],
  ['--muted', '--surface-2', 'meta en una fila resaltada'],
  ['--muted', '--ground', 'letra fina de una pantalla'],
  ['--gold', '--surface', 'acento de texto: kicker, enlace'],
  ['--gold', '--gold-bg', 'icono encendido sobre su tinte'],
  ['--on-mark', '--mark', 'texto del botón primario, del .send y de la pastilla [n]'],
  ['--on-mark', '--mark-strong', 'el mismo, con el ratón encima'],
  ['--ok', '--surface', 'línea «ok» del registro'],
  ['--danger', '--surface', 'aviso y error'],
  ['--danger', '--danger-bg', 'fila de error del registro'],
]

const CONTROL = [
  ['--hairline-strong', '--surface', 'borde de input, select y textarea', null],
  ['--hairline-strong', '--ground', 'borde del botón fantasma y punto de estado', null],
  // En claro el relleno ámbar lleva texto encima y es el texto quien identifica
  // el control (2,01 contra el blanco): lo que cuenta es --on-mark sobre --mark.
  ['--mark', '--surface', 'relleno de la pastilla [n] y del faro', ['oscuro']],
]

function ratio(tokens, a, b) {
  const r = contrastRatio(tokens[a], tokens[b])
  assert(r !== null, `no se puede medir ${a} (${tokens[a]}) sobre ${b} (${tokens[b]})`)
  return r
}

function dos(v) {
  return v.toFixed(2).replace('.', ',')
}

test('estilo: cada pareja texto/fondo cumple AA en claro y en oscuro', () => {
  for (const [tema, tokens] of TEMAS) {
    for (const [fg, bg, que] of TEXTO) {
      const r = ratio(tokens, fg, bg)
      assert(r >= 4.5, `${tema}: ${fg} sobre ${bg} da ${dos(r)}:1 y AA pide 4,5 · ${que}`)
    }
  }
})

test('estilo: lo que dibuja un control llega a 3:1 en los dos temas', () => {
  for (const [tema, tokens] of TEMAS) {
    for (const [fg, bg, que, temas] of CONTROL) {
      if (temas && !temas.includes(tema)) continue
      const r = ratio(tokens, fg, bg)
      assert(r >= 3, `${tema}: ${fg} sobre ${bg} da ${dos(r)}:1 y SC 1.4.11 pide 3 · ${que}`)
    }
  }
})

test('estilo: --hairline es decorativa y está exenta a propósito', () => {
  // Separa filas y no dibuja ningún control: por eso puede ser suave. Se mide
  // igualmente para que quede dicho que está por debajo de 3 y que es querido;
  // el borde de un control es --hairline-strong, que sí se pina arriba.
  for (const [tema, tokens] of TEMAS) {
    const r = ratio(tokens, '--hairline', '--surface')
    assert(r < 3, `${tema}: si --hairline llegara a ${dos(r)}:1 ya no sería un filete, sería un borde`)
  }
  assert(/rgba\(255,255,255,\.08\)/.test(oscuroSistema['--hairline']), 'en oscuro la hairline es luz, no un gris')
})

test('estilo: los tres bloques de tokens declaran los mismos nombres y los dos oscuros los mismos valores', () => {
  // Uno lo elige el sistema y el otro lo fuerza el espejo: si se separan, el
  // banco deja de enseñar el panel de verdad.
  assert(Object.keys(claro).length > 20, 'el bloque claro declara la paleta y la escala')
  eq(oscuroForzado, oscuroSistema, 'el oscuro forzado tiene que decir lo mismo que el del sistema')

  const soloOscuro = Object.keys(oscuroSistema).filter((n) => !(n in claro))
  eq(soloOscuro, [], 'ningún token nace en el tema oscuro')

  const colorSinOscuro = Object.keys(claro).filter((n) => parseColor(claro[n]) && !(n in oscuroSistema))
  eq(colorSinOscuro, [], 'ningún color se queda con un solo tema')
})

test('EL CAMBIO: la marca del panel es la marca de la página', () => {
  // La pastilla [n] del chat y la insignia sobre el texto son el mismo ámbar:
  // si alguien cambia uno, esto obliga a cambiar el otro.
  const overlay = cssVarsOf(OVERLAY_CSS, ':host')
  eq(claro['--mark'], overlay['--faro-gold'], '--mark === --faro-gold')
  eq(claro['--mark-strong'], overlay['--faro-gold-deep'], '--mark-strong === --faro-gold-deep')
  eq(oscuroSistema['--mark'], overlay['--faro-gold'], 'el ámbar no cambia con el tema del panel')

  const primario = /\.btn-primary\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{6})/.exec(OVERLAY_CSS)
  assert(primario, 'el botón del overlay declara su color de texto')
  eq(claro['--on-mark'], primario[1], '--on-mark === el texto del botón del overlay')
})

test('EL CAMBIO: el hover del overlay ya no baja de AA', () => {
  // Ponía #FFF7E8 sobre #C98A22: 2,76:1 (A8). Con #1B1405 da 6,22. El crema
  // sigue NOMBRADO en el comentario que cuenta por qué se fue, así que lo que
  // se mira es el CSS sin comentarios: si no, el propio recuerdo del fallo
  // haría fallar el test.
  const sinComentarios = OVERLAY_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert(!/#FFF7E8/i.test(sinComentarios), 'el crema del hover no puede volver')
  for (const regla of ['.btn-primary:hover', '.note-badge:hover', '.note-badge.active']) {
    const m = new RegExp(regla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(sinComentarios)
    assert(m && /color:\s*#1B1405/i.test(m[1]), `${regla} tiene que llevar el texto oscuro`)
  }
})

test('estilo: color-scheme explícito por tema', () => {
  // Con `light dark` el sistema en oscuro pintaba los <select> y <button>
  // nativos oscuros aunque las variables del panel fueran claras.
  assert(!/color-scheme:\s*light\s+dark/.test(SIN_COMENTARIOS), 'no queda ningún color-scheme: light dark')
  const bloque = (sel) => {
    const i = SIN_COMENTARIOS.indexOf(sel)
    assert(i !== -1, 'falta el bloque ' + sel)
    return SIN_COMENTARIOS.slice(i, SIN_COMENTARIOS.indexOf('}', i))
  }
  assert(/color-scheme:\s*light\b/.test(bloque(CLARO + ' {')), 'el bloque claro se declara claro')
  assert(/color-scheme:\s*dark\b/.test(bloque(OSCURO_SISTEMA)), 'el oscuro del sistema se declara oscuro')
  assert(/color-scheme:\s*dark\b/.test(bloque(OSCURO_FORZADO)), 'el oscuro forzado también')
})

// --------------------------------------------------- escala, sombras y motor

/** Los px que declara la escala, más los tres que son bordes y ajustes ópticos. */
const ESCALA = new Set([0, 1, 2])
for (const [nombre, valor] of Object.entries(claro)) {
  if (/^--(text|s\d|r)-?/.test(nombre)) {
    const m = /^(-?\d*\.?\d+)px$/.exec(valor.trim())
    if (m) ESCALA.add(Number(m[1]))
  }
}

/**
 * Lo que no sale de la escala y tiene su razón. Son medidas de una pieza, no
 * de la retícula: la pastilla [n] mide lo mismo en el chat, en la tarjeta y
 * sobre la página (17), los botones de icono y el de enviar son cuadrados de
 * 28 y 32, y las dos cabeceras —la del panel y la de cada pantalla— 44.
 */
const EXCEPCIONES = new Map([
  [17, 'alto de la pastilla [n]'],
  [28, 'lado del botón de icono'],
  [32, 'lado del botón de enviar'],
  [44, 'alto de las cabeceras'],
])

test('estilo: tamaños, espaciado y radios salen de la escala', () => {
  const fuera = pxLiterals(CSS, /font-size|padding|gap|margin|border-radius/).filter(
    (d) => !ESCALA.has(Math.abs(d.px)) && !EXCEPCIONES.has(Math.abs(d.px))
  )
  eq(
    fuera.map((d) => `${d.selector} { ${d.prop}: ${d.px}px }`),
    [],
    'fuera de :root no hay números a ojo: o es un token o es una excepción con nombre'
  )
})

test('estilo: sin sombras en el chrome', () => {
  // Apple: superficies planas y hairlines. La única sombra es la de la tarjeta
  // que flota sobre el velo de «Trabajando…».
  // Una sombra `inset` no es una sombra: es el filete de la marca a la
  // izquierda de una tarjeta o de una fila elegida, y ésas sí se quedan.
  const sombras = [...SIN_COMENTARIOS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /(?:^|;)\s*box-shadow:\s*(?!inset\b)\S/.test(m[2]))
    .map((m) => m[1].trim().split('\n').pop().trim())
  eq(sombras, ['.busy-card'], 'sólo .busy-card lleva sombra; lo demás separa con hairlines')
})

test('estilo: sin transform de hover en listas', () => {
  // Un desplazamiento al pasar el ratón mueve el texto que estás leyendo: el
  // hover es un cambio de fondo. (.suggestion, .note-row y .choice lo hacían.)
  const conTransform = [...SIN_COMENTARIOS.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)]
    .filter((m) => /transform:\s*translate/.test(m[2]))
    .map((m) => m[1].trim())
  eq(conTransform, [], 'ninguna regla :hover desplaza nada')
})

test('estilo: sin pesos raros', () => {
  // 650 y 680 caen a 700 en Segoe: eran un peso imaginario.
  const pesos = [...SIN_COMENTARIOS.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1]))
  eq(
    [...new Set(pesos)].filter((p) => ![400, 600, 700].includes(p)),
    [],
    'sólo 400, 600 y 700'
  )
})

test('estilo: el ajuste «Reducir animaciones» apaga también el panel', () => {
  // Se leía y se guardaba, pero sólo lo aplicaba el overlay (A9). Ahora el
  // panel se cuelga la misma clase que el overlay usa en la página.
  assert(/html\.faro-still\b/.test(SIN_COMENTARIOS), 'falta el bloque html.faro-still')
  assert(/prefers-reduced-motion/.test(SIN_COMENTARIOS), 'y la preferencia del sistema sigue')
  for (const trozo of ['animation-duration', 'animation-iteration-count', 'transition-duration', 'scroll-behavior']) {
    const veces = [...SIN_COMENTARIOS.matchAll(new RegExp(trozo + ':', 'g'))].length
    assert(veces >= 2, `${trozo} tiene que estar en los dos sitios (la media query y faro-still)`)
  }
  const js = readFileSync(join(ROOT, 'src', 'panel', 'panel.js'), 'utf8')
  const aplica = /function applySettingsToUi\(\)\s*\{[\s\S]*?\n\}/.exec(js)
  assert(aplica, 'applySettingsToUi sigue existiendo')
  assert(/classList\.toggle\('faro-still'/.test(aplica[0]), 'el ajuste tiene que llegar al <html> del panel')
})

test('estilo: el foco de los campos no se anula', () => {
  // A4: `outline: none` dejaba el foco a cargo de un borde de 1,3:1. El anillo
  // es del color de la marca y se queda.
  assert(!/outline:\s*(none|0)\b/.test(SIN_COMENTARIOS), 'ninguna regla apaga el outline')
  assert(
    /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--mark\)/.test(SIN_COMENTARIOS),
    'el anillo de foco es --mark'
  )
})
