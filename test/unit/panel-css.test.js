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
 * Las parejas NO se declaran aquí: viven en `test/contrast-pairs.js`, que es
 * también lo que imprime `npm run contrast`. Hasta la revisión adversaria de H4
 * había dos listas y ya se habían separado (hallazgo 8).
 *
 * Lo que se pina, además del contraste: que los dos bloques oscuros digan lo
 * mismo (uno es el del sistema y el otro el que fuerza el espejo del banco),
 * que el ámbar de relleno del panel sea byte a byte el del overlay —la pastilla
 * [n] del chat y la insignia de la página son la misma marca—, que cada tema
 * declare su `color-scheme`, que un token de BORDE no se use como tinta, y que
 * fuera de :root no haya tamaños, espaciados, radios ni duraciones a ojo.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, eq, assert } from '../harness.js'
import { contrastRatio, cssVarsOf, durationLiterals, parseColor, pxLiterals } from '../contrast.js'
import { TEXTO, CONTROL, EXENTOS, UMBRAL } from '../contrast-pairs.js'
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

/** Nombre para el mensaje de error, tokens, y la clave con la que las parejas acotan su tema. */
const TEMAS = [
  ['claro', claro, 'light'],
  ['oscuro', oscuro, 'dark'],
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
  for (const [tema, tokens, clave] of TEMAS) {
    for (const [fg, bg, que, soloEn] of TEXTO) {
      if (soloEn && soloEn !== clave) continue
      const r = ratio(tokens, fg, bg)
      assert(r >= UMBRAL.texto, `${tema}: ${fg} sobre ${bg} da ${dos(r)}:1 y AA pide 4,5 · ${que}`)
    }
  }
})

test('estilo: lo que dibuja un control llega a 3:1 en los dos temas', () => {
  for (const [tema, tokens, clave] of TEMAS) {
    for (const [fg, bg, que, soloEn] of CONTROL) {
      if (soloEn && soloEn !== clave) continue
      const r = ratio(tokens, fg, bg)
      assert(r >= UMBRAL.control, `${tema}: ${fg} sobre ${bg} da ${dos(r)}:1 y SC 1.4.11 pide 3 · ${que}`)
    }
  }
  // Medir el token no basta si el control no lo usa: la tarjeta de elección es un
  // role="button" cuyo único límite es su borde, y en H4 se quedó con --hairline
  // (1,30:1) sin que ninguna pareja lo notara (revisión adversaria de H4).
  const choice = SIN_COMENTARIOS.match(/(?:^|\n)\.choice\s*\{([^}]*)\}/)
  assert(choice, 'panel.css tiene la regla .choice')
  assert(
    /border:\s*1px solid var\(--hairline-strong\)/.test(choice[1]),
    '.choice es un control: su borde en reposo es --hairline-strong, no la hairline decorativa'
  )
})

/** Los tokens que dibujan un BORDE, cuyo umbral es 3 y no el 4,5 del texto. */
const BORDES = ['--hairline', '--hairline-strong', '--gold-line', '--line', '--line-2']

test('estilo: un token de borde no es tinta', () => {
  // `.md-list li::marker` pintaba el número de una lista ordenada con
  // --hairline-strong: 3,04:1 en claro y 3,52 en oscuro, cuando docs/INSTALL.md
  // promete 4,5 a TODO el texto (hallazgo 1 de la revisión adversaria de H4). El
  // marcador de una lista es texto, no un filete, y ahora es --muted.
  // Se miran sólo las declaraciones `color:`: `border-color`, `accent-color` y
  // `scrollbar-color` sí son superficie y pueden llevar un token de borde.
  const tinta = [...SIN_COMENTARIOS.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap((m) =>
    [...m[2].matchAll(/(?:^|[;{\s])color\s*:\s*([^;}]*)/g)].map((d) => ({
      selector: m[1].trim().split('\n').pop().trim(),
      valor: d[1].trim(),
    }))
  )
  assert(tinta.length > 20, 'el panel pinta texto en muchos sitios: si esto es 0, la regex no está leyendo nada')
  eq(
    tinta.filter((t) => BORDES.some((b) => t.valor.includes(`var(${b})`))).map((t) => `${t.selector} { color: ${t.valor} }`),
    [],
    'un token de borde no vale como color de texto: su umbral es 3, no el 4,5 que pide AA'
  )
})

test('estilo: las exenciones de borde están medidas y por debajo de 3', () => {
  // Una exención no es una promesa, es una medida: se comprueba que sigue POR
  // DEBAJO de 3 en los dos temas, así que el día que alguien refuerce uno de
  // estos bordes el test obliga a moverlo a CONTROL en vez de dejarlo en la
  // lista de excusas. Ninguno de los tres es lo único que identifica su
  // control: --hairline separa filas y enmarca tarjetas que no lo son, y
  // --gold-line enmarca el chip de lo señalado, el de páginas base y los
  // botones encendidos, que se reconocen por su TEXTO --ink-2 o por su icono
  // --gold sobre --gold-bg. La tarjeta `.choice`, que SÍ es un control
  // (role="button") y cuyo único borde era --hairline (1,30), pasó a
  // --hairline-strong en la revisión adversaria de H4 (hallazgo 5).
  for (const [tema, tokens] of TEMAS) {
    for (const [fg, bg, que] of EXENTOS) {
      const r = ratio(tokens, fg, bg)
      assert(
        r < UMBRAL.control,
        `${tema}: ${fg} sobre ${bg} ya da ${dos(r)}:1 · ${que} · si llega a 3 es un borde de verdad: llévalo a CONTROL`
      )
    }
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

/**
 * Los px que declara la escala, más el 0, el 1 y el 2 (un filete, un anillo y
 * un ajuste óptico no son pasos de la retícula).
 *
 * `--r-pill` (999px) queda FUERA a propósito: no es un radio, es «redondea del
 * todo», y sólo vale escrito como `var(--r-pill)`. Colándose en la escala hacía
 * que un `padding: 999px` pasara la comprobación (hallazgo 2 de la revisión
 * adversaria de H4).
 */
const ESCALA = new Set([0, 1, 2])
for (const [nombre, valor] of Object.entries(claro)) {
  if (nombre === '--r-pill') continue
  if (/^--(text|s\d|r)-?/.test(nombre)) {
    const m = /^(-?\d*\.?\d+)px$/.exec(valor.trim())
    if (m) ESCALA.add(Number(m[1]))
  }
}

/** Las propiedades que miden una PIEZA, no la retícula. */
const TAMANOS = /^(?:width|height|min-width|min-height|max-width|max-height)$/

/**
 * Lo que no sale de la escala y tiene su razón: la medida de una pieza concreta.
 * Hasta la revisión adversaria de H4 esta lista era INERTE —se comprobaba contra
 * font-size|padding|gap|margin|border-radius, y 17, 28, 32 y 44 no aparecen
 * nunca en esas propiedades: viven en width y height—, así que la mitad del
 * fichero no la miraba nadie. Ahora se comprueba en las dos direcciones: ningún
 * tamaño sin motivo, y ningún motivo sin tamaño.
 *
 * «heredado de antes de H4» es un valor a ojo que cabría en la escala y que H4
 * no cambia porque no se puede mirar en el navegador desde aquí: queda apuntado
 * para quien tenga el panel delante.
 */
const EXCEPCIONES = new Map([
  [3, 'grosor de la barra de «Trabajando…»: un filete que se mueve, no un paso de la retícula'],
  [5, 'diámetro del punto de una fila de herramienta y del de una pastilla — heredado de antes de H4: los demás puntos miden 6'],
  [9, 'ancho de la barra de desplazamiento del chat: 3 de pulgar más el aire de su borde de 3 por lado'],
  [13, 'lado del spinner que espera al MCP — heredado de antes de H4'],
  [
    14,
    'lado del faro de la cabecera, alto de los puntos de «pensando», lado de una casilla y mínimo de la insignia — heredado de antes de H4',
  ],
  [17, 'alto de la pastilla [n], el mismo en el chat, en la tarjeta y sobre la página'],
  [26, 'lado del faro grande del estado vacío — heredado de antes de H4'],
  [28, 'lado del botón de icono'],
  [32, 'lado del botón de enviar, y alto reservado al texto del velo para que la tarjeta no salte al cambiarlo'],
  [34, 'ancho mínimo de los dos <select> del redactor: lo que cabe sin comerse su flecha'],
  [44, 'alto de las cabeceras: la del panel y la de cada pantalla'],
  [92, 'ancho de la columna de claves del Registro, para que los valores queden alineados'],
  [160, 'cuánto crece el redactor antes de desplazarse'],
  [230, 'alto del bloque de configuración del MCP'],
  [260, 'alto de la lista de sugerencias'],
  [300, 'alto del registro'],
  [320, 'alto de la memoria guardada, y ancho de la tarjeta del velo'],
  [520, 'ancho de lectura de una pantalla'],
])

test('estilo: tamaños, espaciado y radios salen de la escala', () => {
  const fuera = pxLiterals(CSS, /font-size|padding|gap|margin|border-radius/).filter(
    (d) => !ESCALA.has(Math.abs(d.px))
  )
  eq(
    fuera.map((d) => `${d.selector} { ${d.prop}: ${d.px}px }`),
    [],
    'fuera de :root la retícula no tiene números a ojo: o es un token o es 0, 1 o 2'
  )
})

test('estilo: cada tamaño de pieza está en la escala o es una excepción con motivo', () => {
  const medidas = pxLiterals(CSS, TAMANOS)
  assert(medidas.length > 20, 'el panel mide muchas piezas: si esto es 0, la regex no está leyendo nada')

  const fuera = medidas.filter((d) => !ESCALA.has(Math.abs(d.px)) && !EXCEPCIONES.has(Math.abs(d.px)))
  eq(
    fuera.map((d) => `${d.selector} { ${d.prop}: ${d.px}px }`),
    [],
    'una medida que no sale de la escala necesita una entrada en EXCEPCIONES con su motivo'
  )

  const medidos = new Set(medidas.map((d) => Math.abs(d.px)))
  eq(
    [...EXCEPCIONES.keys()].filter((px) => !medidos.has(px)),
    [],
    'una excepción que ya no mide nada deja de ser una excepción: bórrala (si no, la lista se vuelve inerte)'
  )
})

/**
 * Las duraciones que NO son tokens: cada animación de espera tiene su propio
 * ritmo y no hay ningún paso de escala que las una. Se declaran con su motivo, y
 * el test comprueba también que cada una siga existiendo.
 */
const DURACIONES_PROPIAS = new Map([
  ['1.1s', 'el latido del faro y del punto de estado, y el rebote de los puntos de «pensando»'],
  ['2.4s', 'la onda del faro del estado vacío: lenta a propósito, para que acompañe y no llame'],
  ['.16s', 'el desfase del segundo punto de «pensando»'],
  ['.32s', 'el del tercero'],
  ['1.4s', 'el barrido de la barra de «Trabajando…», que no mide progreso: sólo dice que algo sigue'],
  ['.8s', 'la vuelta del spinner que espera al MCP'],
  [
    '.001ms',
    'el apagado de «Reducir animaciones»: casi cero y no cero, para que animationend y transitionend sigan disparándose y nada se quede a medio pintar',
  ],
])

test('estilo: cada duración es un token o una animación de espera declarada', () => {
  const medidas = durationLiterals(CSS)
  const clave = (d) => d.value.toLowerCase()

  eq(
    medidas.filter((d) => !DURACIONES_PROPIAS.has(clave(d))).map((d) => `${d.selector} { ${d.prop}: … ${d.value} }`),
    [],
    'una duración nueva es var(--dur-1)/var(--dur-2) o una espera con su motivo en DURACIONES_PROPIAS'
  )

  const usadas = new Set(medidas.map(clave))
  eq(
    [...DURACIONES_PROPIAS.keys()].filter((v) => !usadas.has(v)),
    [],
    'una duración propia que ya no está en el CSS sobra de la lista'
  )

  // Y que los tokens de movimiento los pida alguien: si nadie los usa, «fuera
  // de :root no hay duraciones a ojo» se cumpliría por vacío.
  for (const dur of ['--dur-1', '--dur-2']) {
    assert(SIN_COMENTARIOS.includes(`var(${dur})`), `${dur} tiene que usarlo alguien`)
  }
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

/** El cuerpo balanceado del bloque que abre justo después de `marcador`, o ''. */
function bloqueTras(css, marcador) {
  const i = css.indexOf(marcador)
  if (i === -1) return ''
  const abre = css.indexOf('{', i + marcador.length)
  if (abre === -1) return ''
  let n = 0
  for (let j = abre; j < css.length; j++) {
    if (css[j] === '{') n++
    else if (css[j] === '}' && --n === 0) return css.slice(abre + 1, j)
  }
  return ''
}

/** Lo que tiene que declarar cada uno de los dos apagados de movimiento. */
const QUIETO = ['animation-duration', 'animation-iteration-count', 'transition-duration', 'scroll-behavior']

test('estilo: el ajuste «Reducir animaciones» apaga también el panel', () => {
  // Se leía y se guardaba, pero sólo lo aplicaba el overlay (A9). Ahora el
  // panel se cuelga la misma clase que el overlay usa en la página.
  // Contar apariciones en TODO el fichero —lo que se hacía hasta la revisión
  // adversaria de H4 (hallazgo 3)— no comprueba nada: cuatro declaraciones
  // repartidas donde fuera sumaban «al menos dos veces» aunque uno de los dos
  // bloques estuviera vacío. Se mira CADA bloque por separado.
  const media = bloqueTras(SIN_COMENTARIOS, '@media (prefers-reduced-motion: reduce)')
  assert(media.trim(), 'falta el bloque @media (prefers-reduced-motion: reduce)')

  const faroStill = [...SIN_COMENTARIOS.matchAll(/([^{}]*html\.faro-still[^{}]*)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }))
  assert(faroStill.length, 'falta el bloque html.faro-still')

  for (const [donde, cuerpo] of [
    ['la media query del sistema', media],
    ['html.faro-still', faroStill.map((r) => r.body).join(';')],
  ]) {
    for (const prop of QUIETO) {
      assert(new RegExp('(?:^|[;{\\s])' + prop + '\\s*:').test(cuerpo), `${donde} no declara ${prop}`)
    }
  }

  // Y la barra de «Trabajando…», que sólo dice algo mientras se mueve, se queda
  // llena en vez de vacía. En los DOS sitios.
  const enMedia = /\.busy-bar i\s*\{([^}]*)\}/.exec(media)
  const enStill = faroStill.find((r) => r.selector.includes('.busy-bar i'))
  for (const [donde, cuerpo] of [
    ['la media query del sistema', enMedia && enMedia[1]],
    ['html.faro-still', enStill && enStill.body],
  ]) {
    assert(cuerpo, `${donde} no lleva su regla de .busy-bar i`)
    assert(/animation:\s*none/.test(cuerpo), `${donde}: la barra tiene que parar`)
    assert(/width:\s*100%/.test(cuerpo), `${donde}: y quedarse llena, no vacía`)
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
