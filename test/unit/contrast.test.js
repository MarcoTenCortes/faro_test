import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, eq, assert, near } from '../harness.js'
import {
  parseColor,
  blendOver,
  relativeLuminance,
  contrastRatio,
  cssVarsOf,
  pxLiterals,
  durationLiterals,
} from '../contrast.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Tolerancia de los ratios: se comparan con dos decimales, como se escriben. */
const DOS = 0.005

test('contraste: negro sobre blanco es 21 y da igual cuál es el texto', () => {
  near(contrastRatio('#000', '#fff'), 21, 0.01, 'el extremo de la escala')
  near(contrastRatio('#fff', '#000'), 21, 0.01, 'simétrico')
  near(contrastRatio('#888', '#888'), 1, 0.001, 'un color contra sí mismo es 1')
})

test('contraste: EL CAMBIO: el texto del primario sobre el dorado de antes se quedaba en 3,09', () => {
  // Los cuatro números de la auditoría del 2026-09-13 (docs/PLAN.md §2, A5 y
  // A8). El primario claro ponía #1B1405 sobre --gold #8A5A0A (3,09, por debajo
  // del 4,5 de AA) y el hover de la insignia del overlay ponía #FFF7E8 sobre
  // #C98A22 (2,76). Con el dorado desdoblado, el mismo texto sobre --mark
  // #E9AC4A da 9,11 y sobre --mark-strong #C98A22 da 6,22.
  near(contrastRatio('#1B1405', '#E9AC4A'), 9.11, DOS, 'on-mark sobre mark')
  near(contrastRatio('#1B1405', '#8A5A0A'), 3.09, DOS, 'lo que fallaba en claro')
  near(contrastRatio('#FFF7E8', '#C98A22'), 2.76, DOS, 'el hover del overlay de antes')
  near(contrastRatio('#1B1405', '#C98A22'), 6.22, DOS, 'el hover del overlay arreglado')
})

test('contraste: parseColor lee hex de 3, 6 y 8 dígitos, rgb/rgba y transparent', () => {
  eq(parseColor('rgba(255,255,255,.16)'), { r: 255, g: 255, b: 255, a: 0.16 })
  eq(parseColor('#E9AC4A'), { r: 233, g: 172, b: 74, a: 1 })
  eq(parseColor('  #FFF  '), { r: 255, g: 255, b: 255, a: 1 }, 'con espacios y en tres dígitos')
  eq(parseColor('#1b1a2280'), { r: 27, g: 26, b: 34, a: 128 / 255 }, 'el cuarto par es el alfa')
  eq(parseColor('rgb(19 18 24 / 50%)'), { r: 19, g: 18, b: 24, a: 0.5 }, 'la forma con espacios y barra')
  eq(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 })
  eq(parseColor('rgba(300, -5, 24, 9)'), { r: 255, g: 0, b: 24, a: 1 }, 'los canales se acotan')
})

test('contraste: lo que no se reconoce es null, nunca un ratio inventado', () => {
  // Si algún día entra un hsl() o un color-mix() en el CSS, el informe tiene
  // que decir «no lo sé» en voz alta y no pintar un número que no ha medido.
  for (const raro of ['hsl(40 80% 60%)', 'color-mix(in srgb, red, blue)', 'goldenrod', '#12345', '', null, 7, {}]) {
    eq(parseColor(raro), null, `no reconocido: ${JSON.stringify(raro)}`)
  }
  eq(contrastRatio('hsl(40 80% 60%)', '#fff'), null, 'sin color no hay ratio')
  eq(blendOver('goldenrod', 0.5, '#fff'), null)
})

test('contraste: blendOver compone una hairline traslúcida sobre su fondo', () => {
  // La hairline suave del tema oscuro se declara rgba(255,255,255,.08): el
  // color que se ve es el de la mezcla con --surface #1B1A22.
  eq(blendOver('#FFFFFF', 0.08, '#1B1A22'), '#2D2C34')
  eq(blendOver('rgba(255,255,255,.08)', null, '#1B1A22'), '#2D2C34', 'sin alfa se usa el del propio color')
  eq(blendOver('#FFFFFF', 0, '#1B1A22'), '#1B1A22', 'a cero no se ve')
  eq(blendOver('#FFFFFF', 1, '#1B1A22'), '#FFFFFF', 'a uno tapa')
})

test('contraste: un color traslúcido se mide sobre lo que hay detrás', () => {
  const mezclado = contrastRatio(blendOver('#FFFFFF', 0.08, '#1B1A22'), '#1B1A22')
  const directo = contrastRatio('rgba(255,255,255,.08)', '#1B1A22')
  near(directo, mezclado, 0.001, 'medir la rgba es medir su mezcla')
  assert(directo < 1.3, 'una hairline suave es decorativa: no llega ni de lejos a 3:1')
})

test('contraste: la luminancia relativa va de 0 a 1', () => {
  near(relativeLuminance('#000000'), 0, 0.0001)
  near(relativeLuminance('#FFFFFF'), 1, 0.0001)
  assert(relativeLuminance('#E9AC4A') > relativeLuminance('#C98A22'), 'el ámbar claro pesa más que el profundo')
  eq(relativeLuminance('no es un color'), null)
})

test('cssVarsOf: resuelve los var(--x) del propio bloque', () => {
  const css = `
    :root {
      --mark: #E9AC4A;
      --on-mark: #1B1405;
      --gold: var(--mark);
      --send-bg: var(--gold);
      --raro: var(--no-existe, #123456);
      --ciclo: var(--ciclo);
    }
  `
  const v = cssVarsOf(css, ':root')
  eq(v['--mark'], '#E9AC4A')
  eq(v['--gold'], '#E9AC4A', 'una vuelta')
  eq(v['--send-bg'], '#E9AC4A', 'y las que hagan falta')
  eq(v['--raro'], '#123456', 'el respaldo de var() cuando el token no está')
  eq(v['--ciclo'], 'var(--ciclo)', 'un ciclo se queda como está, sin colgarse')
})

test('cssVarsOf: el primer bloque que casa literalmente, y {} si no existe', () => {
  // Cada tema es un bloque distinto: el claro en :root, el oscuro dentro de la
  // media query y otra vez en :root[data-theme="dark"]. El selector se casa tal
  // cual (sólo se colapsan los espacios), así que quien pregunta elige tema.
  const css = `
    :root { --ground: #F5F5F8; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { --ground: #131218; }
    }
    :root[data-theme="dark"] { --ground: #131218; }
    :root { --ground: #000000; }
  `
  eq(cssVarsOf(css, ':root'), { '--ground': '#F5F5F8' }, 'el primero, no el último')
  eq(cssVarsOf(css, ':root:not([data-theme="light"])'), { '--ground': '#131218' }, 'dentro de la media query')
  eq(cssVarsOf(css, '  :root[data-theme="dark"]\n'), { '--ground': '#131218' }, 'los espacios no cuentan')
  eq(cssVarsOf(css, ':root[data-theme=dark]'), {}, 'literal: sin comillas no es el mismo selector')
  eq(cssVarsOf(css, '@media (prefers-color-scheme: dark)'), {}, 'el @media no declara variables propias')
  eq(cssVarsOf('', ':root'), {})
})

test('cssVarsOf: los comentarios y los url(data:…) no descolocan el parseo', () => {
  // Un data URI con «;» y con «}» dentro —el chevron de los selects— rompería
  // el recuento de llaves si no se quitara antes de mirar.
  const css = `
    /* --gold: #000000; un comentario no declara nada } */
    :root {
      --gold: #7A4F08; /* 7,12 sobre --surface */
      --chevron: url("data:image/svg+xml;utf8,<svg><path d='M1 1}'/></svg>");
      --ink: #17161D;
    }
  `
  const v = cssVarsOf(css, ':root')
  eq(v['--gold'], '#7A4F08')
  eq(v['--ink'], '#17161D', 'lo de después del data URI sigue llegando')
  eq(v['--chevron'], 'url()', 'la url se reduce, no se interpreta')
})

test('pxLiterals: los px de cada propiedad, fuera de los bloques de tokens', () => {
  const css = `
    :root { --text-md: 13.5px; --s3: 12px; }
    .nav-card { padding: 12px 16px; border-radius: 12px; border: 1px solid var(--hairline); }
    .note-num { font-size: 10px; min-width: 17px; }
    .msg.user { margin: 0 0 -1px; font-size: var(--text-md); }
  `
  eq(pxLiterals(css, /font-size|padding|gap|margin|border-radius/), [
    { selector: '.nav-card', prop: 'padding', px: 12 },
    { selector: '.nav-card', prop: 'padding', px: 16 },
    { selector: '.nav-card', prop: 'border-radius', px: 12 },
    { selector: '.note-num', prop: 'font-size', px: 10 },
    { selector: '.msg.user', prop: 'margin', px: -1 },
  ])
  eq(pxLiterals(css, /min-width/), [{ selector: '.note-num', prop: 'min-width', px: 17 }], 'la regex la elige quien llama')
})

test('pxLiterals: lo que hay dentro de url(...) no es un tamaño', () => {
  const css = `.skill-select { background-image: url("data:image/svg+xml;utf8,<svg width='12px'/>"); padding: 8px; }`
  eq(pxLiterals(css, /padding|background-image/), [{ selector: '.skill-select', prop: 'padding', px: 8 }])
})

test('durationLiterals: las duraciones de animation y transition, fuera de los bloques de tokens', () => {
  // Lo que sale de un token (`var(--dur-1)`) no es un literal y no aparece; lo
  // escrito a mano sí, con su selector, para poder decir dónde está.
  const css = `
    :root { --dur-1: 120ms; --dur-2: 240ms; }
    .icon-btn { transition: background var(--dur-1) ease, color 200ms ease; }
    .beacon.busy::after { animation: blink 1.1s ease-in-out infinite; }
    .typing i:nth-child(2) { animation-delay: .16s; }
    .spinner { animation: spin .8s linear infinite; }
    .msg { animation: rise var(--dur-2) var(--ease) both; }
  `
  eq(durationLiterals(css), [
    { selector: '.icon-btn', prop: 'transition', value: '200ms', ms: 200 },
    { selector: '.beacon.busy::after', prop: 'animation', value: '1.1s', ms: 1100 },
    { selector: '.typing i:nth-child(2)', prop: 'animation-delay', value: '.16s', ms: 160 },
    { selector: '.spinner', prop: 'animation', value: '.8s', ms: 800 },
  ])
})

test('durationLiterals: ni un transform de keyframe ni una curva son duraciones', () => {
  // `transform` no contiene «transition», el nombre de un keyframe no lleva
  // número y una cubic-bezier no lleva unidad: si algo de esto colara, la lista
  // de duraciones propias del panel se llenaría de ruido.
  const css = `
    @keyframes bob { 0%, 60%, 100% { opacity: .28; transform: translateY(0); } 30% { transform: translateY(-3px); } }
    .msg { animation: rise 240ms cubic-bezier(.32,.72,0,1) both; }
    .busy-bar i { animation-duration: .001MS !important; }
  `
  eq(durationLiterals(css), [
    { selector: '.msg', prop: 'animation', value: '240ms', ms: 240 },
    { selector: '.busy-bar i', prop: 'animation-duration', value: '.001MS', ms: 0.001 },
  ])
  eq(
    durationLiterals(css, /animation-duration/),
    [{ selector: '.busy-bar i', prop: 'animation-duration', value: '.001MS', ms: 0.001 }],
    'la regex la elige quien llama'
  )
})

test('contraste: humo sobre el panel real: el :root de hoy declara los tokens pinados', () => {
  // panel-wiring pina --gold, --ink y --ground por nombre; aquí se comprueba que
  // el lector los encuentra de verdad en el fichero, no sólo en un CSS de
  // prueba. Los umbrales de cada pareja son de panel-css.test.js y del informe.
  const css = readFileSync(join(ROOT, 'src', 'panel', 'panel.css'), 'utf8')
  const claro = cssVarsOf(css, ':root')
  for (const token of ['--gold', '--ink', '--ground', '--surface']) {
    assert(parseColor(claro[token]), `${token} es un color legible en el bloque claro`)
  }
  assert(contrastRatio(claro['--ink'], claro['--surface']) > 4.5, 'el cuerpo del chat cumple AA en claro')
})
