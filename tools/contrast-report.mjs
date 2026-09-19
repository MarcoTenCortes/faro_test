/**
 * `npm run contrast`: qué contraste tiene de verdad el CSS de hoy.
 *
 * Por qué existe: la auditoría del 2026-09-13 midió el panel a mano, encontró
 * tres fallos reales —el texto del botón primario y del `.send` sobre `--gold`
 * en claro a 3,09:1 (docs/PLAN.md §2, A5), el hover y el activo de la insignia
 * y del botón del overlay a 2,76:1 (A8) y los bordes de inputs y del botón
 * fantasma a 1,30-1,44:1 (A4)— y dejó los números en la prosa de un anexo.
 * Aquí se recalculan leyendo los ficheros, así que dejan de ser una afirmación
 * y pasan a ser una medida repetible: cada vez que alguien toca un color, esto
 * dice si la pareja sigue cumpliendo.
 *
 * Qué hace y qué no: INFORMA. No escribe panel.css, no genera tokens, no toca
 * nada. La idea de un generador que escribiera el CSS entre marcadores se
 * descartó (anexo D, descartado 1): tres ficheros de código con zonas generadas
 * en un repo «sin build» y un template literal JS editado por regex. Lo que sí
 * hay es este informe y, desde H4, un test que pina cada pareja.
 *
 * Las parejas se declaran AQUÍ, en las dos tablas de abajo, con el nombre del
 * token y qué dibuja cada una. Cada nombre lleva su cadena de respaldo
 * (`['--hairline-strong', '--line-2']`) para que el informe siga midiendo lo
 * mismo antes y después de que H4 renombre los tokens: si el token nuevo no
 * está todavía, se mide el viejo y se dice qué nombre se usó.
 *
 * Umbrales: 4,5:1 para texto normal (WCAG 2.1 SC 1.4.3, «AAA» a partir de 7) y
 * 3:1 para lo que dibuja un control (SC 1.4.11). Sale con 1 si alguna pareja
 * medida baja de su umbral; las parejas marcadas «exenta» se imprimen con su
 * número y no cuentan, y las que necesitan un token que aún no existe se
 * imprimen como «—».
 *
 *   node tools/contrast-report.mjs        (= npm run contrast)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERLAY_CSS } from '../src/content/overlay/styles.js'
import { contrastRatio, cssVarsOf, parseColor } from '../test/contrast.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/** Los umbrales de WCAG 2.1, por tipo de pareja. */
const UMBRAL = { texto: 4.5, control: 3 }
const AAA = 7

// -------------------------------------------------------- parejas declaradas

/**
 * El panel. Cada pareja: el color de delante, el de detrás, si es texto (4,5) o
 * lo que dibuja un control (3), y qué se está mirando en la pantalla.
 *
 * Los respaldos cuentan la historia del cambio: hoy el relleno del primario es
 * `--gold` (el ocre de texto, 3,09 con su propio texto) y en H4 pasa a ser
 * `--mark` (el ámbar de la página, 9,11); hoy el borde de un input es `--line`,
 * la misma hairline decorativa que separa filas, y en H4 se desdobla en
 * `--hairline` (decorativa, exenta) y `--hairline-strong` (≥3:1).
 */
const PANEL = [
  { fg: ['--ink'], bg: ['--surface'], tipo: 'texto', que: 'cuerpo del chat en una tarjeta' },
  { fg: ['--ink'], bg: ['--ground'], tipo: 'texto', que: 'título de pantalla sobre el fondo' },
  { fg: ['--ink-2'], bg: ['--surface'], tipo: 'texto', que: 'prosa del asistente' },
  { fg: ['--ink-2'], bg: ['--surface-2'], tipo: 'texto', que: 'burbuja del usuario' },
  { fg: ['--ink-2'], bg: ['--gold-bg'], tipo: 'texto', que: 'texto dentro de un chip dorado' },
  { fg: ['--muted'], bg: ['--surface'], tipo: 'texto', que: 'meta y cita de una observación' },
  { fg: ['--muted'], bg: ['--surface-2'], tipo: 'texto', que: 'meta en una fila resaltada' },
  { fg: ['--muted'], bg: ['--ground'], tipo: 'texto', que: 'letra fina de una pantalla' },
  { fg: ['--gold'], bg: ['--surface'], tipo: 'texto', que: 'acento de texto: kicker, enlace' },
  { fg: ['--gold'], bg: ['--gold-bg'], tipo: 'texto', que: 'icono encendido sobre su tinte' },
  {
    fg: ['--on-mark', '#1B1405'],
    bg: ['--mark', '--gold'],
    tipo: 'texto',
    que: 'texto del botón primario y del .send',
  },
  { fg: ['--on-mark', '#1B1405'], bg: ['--mark-strong'], tipo: 'texto', que: 'el mismo, con el ratón encima' },
  { fg: ['--ok', '--teal'], bg: ['--surface'], tipo: 'texto', que: 'línea «ok» del registro' },
  { fg: ['--danger', '--clay'], bg: ['--surface'], tipo: 'texto', que: 'aviso y error' },
  { fg: ['--danger', '--clay'], bg: ['--danger-bg', '--clay-bg'], tipo: 'texto', que: 'fila de error del registro' },
  {
    fg: ['--hairline-strong', '--line'],
    bg: ['--surface'],
    tipo: 'control',
    que: 'borde de input, select y textarea',
  },
  { fg: ['--hairline-strong', '--line-2'], bg: ['--ground'], tipo: 'control', que: 'borde del botón fantasma' },
  {
    fg: ['--mark', '--gold'],
    bg: ['--surface'],
    tipo: 'control',
    temas: ['oscuro'],
    que: 'relleno de la pastilla [n] y del faro',
  },
  {
    fg: ['--hairline', '--line'],
    bg: ['--surface'],
    tipo: 'exenta',
    que: 'filete entre filas: decorativo, no dibuja ningún control',
  },
]

/**
 * El overlay, leído de sus PROPIAS reglas y no de una lista de colores: de cada
 * regla se saca el `color` y el `background` que tiene escritos, porque es justo
 * ahí donde estaba el fallo (un `color: #FFF7E8` sobre el ámbar profundo).
 */
const OVERLAY_REGLAS = [
  { regla: '.btn-primary', tipo: 'texto', que: 'botón del cartel, en reposo' },
  { regla: '.btn-primary:hover', tipo: 'texto', que: 'botón del cartel, con el ratón encima' },
  { regla: '.note-badge', tipo: 'texto', que: 'insignia [n] sobre la página' },
  { regla: '.note-badge:hover', tipo: 'texto', que: 'insignia con el ratón encima' },
  { regla: '.note-badge.active', tipo: 'texto', que: 'insignia de la observación que se está mirando' },
]

/** Y los dos textos del cartel, que sí salen de tokens y cambian con la página. */
const OVERLAY_TOKENS = [
  { fg: ['--faro-ink'], bg: ['--faro-paper'], tipo: 'texto', que: 'texto del cartel' },
  { fg: ['--faro-muted'], bg: ['--faro-paper'], tipo: 'texto', que: 'texto secundario del cartel' },
]

// ------------------------------------------------------------------- lectura

/** Los dos bloques oscuros que puede haber, en orden de preferencia. */
const SELECTORES_OSCUROS = [':root:not([data-theme="light"])', ':root[data-theme="dark"]']

/**
 * Los tokens del tema oscuro, venga como venga: los selectores de H4 primero y,
 * si no están, el `:root` de dentro del `@media (prefers-color-scheme: dark)`
 * que hay hoy. Un bloque de tema redefine sólo colores, así que el resultado se
 * funde sobre el claro.
 */
function tokensOscuros(css) {
  for (const sel of SELECTORES_OSCUROS) {
    const vars = cssVarsOf(css, sel)
    if (Object.keys(vars).length) return { sel, vars }
  }
  const i = css.indexOf('prefers-color-scheme: dark')
  if (i !== -1) {
    const vars = cssVarsOf(css.slice(i), ':root')
    if (Object.keys(vars).length) return { sel: '@media (prefers-color-scheme: dark) → :root', vars }
  }
  return { sel: '(sin bloque oscuro)', vars: {} }
}

/** El primer color de la cadena que exista de verdad; los literales valen tal cual. */
function resolver(cadena, tokens) {
  for (const nombre of cadena) {
    if (!nombre.startsWith('--')) {
      if (parseColor(nombre)) return { nombre, color: nombre }
      continue
    }
    const valor = tokens[nombre]
    if (valor !== undefined && parseColor(valor)) return { nombre, color: valor }
  }
  return null
}

const ESCAPAR = /[.*+?^${}()|[\]\\]/g

/**
 * El valor de una propiedad en una regla del overlay, con sus `var()` resueltos.
 * Las reglas del overlay no se anidan, así que basta con leer hasta la primera
 * llave de cierre; el selector se exige al principio de línea o tras una coma
 * para que `.note-badge` no case dentro de `:host(.faro-still) .note-badge`.
 */
function valorDeRegla(css, selector, prop, tokens) {
  const re = new RegExp('(?:^|[\\n,}])\\s*' + selector.replace(ESCAPAR, '\\$&') + '\\s*\\{([^}]*)\\}')
  const bloque = re.exec(css)
  if (!bloque) return null
  const decl = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)').exec(bloque[1])
  if (!decl) return null
  return decl[1].trim().replace(/var\(\s*(--[\w-]+)[^)]*\)/g, (todo, nombre) => tokens[nombre] ?? todo)
}

// -------------------------------------------------------------------- medida

/** Una fila de la tabla: ratio, veredicto y por qué. */
function medir(par, tokens, fg, bg) {
  const umbral = UMBRAL[par.tipo] ?? 0
  if (!fg || !bg) {
    const falta = [!fg ? par.fg.join(' | ') : '', !bg ? par.bg.join(' | ') : ''].filter(Boolean).join(' y ')
    return { salta: `sin ${falta} en este tema` }
  }
  const ratio = contrastRatio(fg.color, bg.color)
  if (ratio === null) return { salta: 'algún color no se reconoce' }
  const cumple = par.tipo === 'exenta' || ratio >= umbral
  const nivel = par.tipo === 'exenta' ? 'exenta' : !cumple ? 'falla' : par.tipo === 'texto' && ratio >= AAA ? 'AAA' : 'AA'
  return { ratio, nivel, cumple, cuenta: par.tipo !== 'exenta', fg, bg, umbral }
}

function seccion(titulo, fuente, filas) {
  const fallos = []
  const cuerpo = []

  for (const f of filas) {
    if (f.salta) {
      cuerpo.push([{ t: '—', dim: true }, { t: '—', dim: true }, f.pareja, { t: f.salta, dim: true }, f.que])
      continue
    }
    const color = f.nivel === 'falla' ? RED : f.nivel === 'exenta' ? DIM : GREEN
    cuerpo.push([
      { t: numero(f.ratio), color },
      { t: f.nivel, color },
      f.pareja,
      { t: `${hex(f.fg.color)} / ${hex(f.bg.color)}`, dim: true },
      f.que,
    ])
    if (f.nivel === 'falla') fallos.push(`${titulo} · ${f.pareja} (${numero(f.ratio)}, pide ${numero(f.umbral)}) · ${f.que}`)
  }

  console.log(`\n${BOLD}${titulo}${OFF} ${DIM}· ${fuente}${OFF}`)
  for (const linea of tabla(['ratio', 'nivel', 'pareja', 'colores', 'qué dibuja'], cuerpo, { derecha: [0] })) {
    console.log(linea)
  }
  return fallos
}

function filasDeTokens(pares, tokens, tema) {
  return pares
    .filter((p) => !p.temas || p.temas.includes(tema))
    .map((p) => {
      const fg = resolver(p.fg, tokens)
      const bg = resolver(p.bg, tokens)
      const nombres = `${(fg || { nombre: p.fg[0] }).nombre} sobre ${(bg || { nombre: p.bg[0] }).nombre}`
      return { ...medir(p, tokens, fg, bg), pareja: nombres, que: p.que }
    })
}

function filasDeReglas(css, pares, tokens) {
  return pares.map((p) => {
    const texto = valorDeRegla(css, p.regla, 'color', tokens)
    const fondo = valorDeRegla(css, p.regla, 'background', tokens)
    const fg = texto && parseColor(texto) ? { nombre: 'color', color: texto } : null
    const bg = fondo && parseColor(fondo) ? { nombre: 'background', color: fondo } : null
    return {
      ...medir(p, tokens, fg, bg),
      pareja: `${p.regla} · color sobre background`,
      que: p.que,
    }
  })
}

// ------------------------------------------------------------------ formateo

/** Dos decimales con coma, como se escriben los ratios en la documentación. */
function numero(v) {
  return v.toFixed(2).replace('.', ',')
}

function hex(valor) {
  const c = parseColor(valor)
  if (!c) return valor
  return c.a < 1 ? valor.replace(/\s+/g, '') : valor.trim().toUpperCase()
}

/**
 * Tabla de anchos fijos. Los anchos se miden sobre el texto pelado y el color se
 * pone DESPUÉS de rellenar: si no, los códigos de escape cuentan como
 * caracteres y las columnas bailan.
 */
function tabla(cabeceras, filas, { derecha = [] } = {}) {
  const celda = (c) => (typeof c === 'object' && c !== null ? c : { t: String(c) })
  const texto = (c) => celda(c).t
  const anchos = cabeceras.map((h, i) => Math.max(h.length, ...filas.map((f) => texto(f[i]).length)))

  const linea = (celdas, cabecera) =>
    '    ' +
    celdas
      .map((raw, i) => {
        const c = celda(raw)
        const pad = derecha.includes(i) ? c.t.padStart(anchos[i]) : c.t.padEnd(anchos[i])
        const tinte = cabecera ? DIM : c.color || (c.dim ? DIM : '')
        return tinte ? tinte + pad + OFF : pad
      })
      .join('  ')
      .replace(/\s+$/, '')

  return [linea(cabeceras, true), ...filas.map((f) => linea(f, false))]
}

// ---------------------------------------------------------------- principal

function main() {
  const panelCss = readFileSync(join(ROOT, 'src', 'panel', 'panel.css'), 'utf8')
  const claro = cssVarsOf(panelCss, ':root')
  const oscuro = tokensOscuros(panelCss)

  console.log(
    `${BOLD}Faro · contraste${OFF} ${DIM}(npm run contrast) · texto ≥ ${numero(UMBRAL.texto)}:1 (WCAG SC 1.4.3) · ` +
      `control ≥ ${numero(UMBRAL.control)}:1 (SC 1.4.11)${OFF}`
  )

  const fallos = [
    ...seccion('PANEL · CLARO', 'src/panel/panel.css → :root', filasDeTokens(PANEL, claro, 'claro')),
    ...seccion(
      'PANEL · OSCURO',
      `src/panel/panel.css → ${oscuro.sel}`,
      filasDeTokens(PANEL, { ...claro, ...oscuro.vars }, 'oscuro')
    ),
  ]

  const overlayClaro = cssVarsOf(OVERLAY_CSS, ':host')
  const overlayOscuro = { ...overlayClaro, ...cssVarsOf(OVERLAY_CSS, ':host(.faro-dark)') }
  fallos.push(
    ...seccion('OVERLAY · CLARO', 'src/content/overlay/styles.js → :host', [
      ...filasDeReglas(OVERLAY_CSS, OVERLAY_REGLAS, overlayClaro),
      ...filasDeTokens(OVERLAY_TOKENS, overlayClaro, 'claro'),
    ]),
    ...seccion('OVERLAY · OSCURO', 'src/content/overlay/styles.js → :host(.faro-dark)', [
      ...filasDeReglas(OVERLAY_CSS, OVERLAY_REGLAS, overlayOscuro),
      ...filasDeTokens(OVERLAY_TOKENS, overlayOscuro, 'oscuro'),
    ])
  )

  console.log(
    `\n${DIM}El ámbar de relleno lleva texto encima, así que su pareja que cuenta es el texto (--on-mark), no su\n` +
      `borde sobre el fondo; por eso «relleno de la pastilla» sólo se mide en oscuro (anexo D). El overlay no se\n` +
      `mide más allá de sus rellenos con texto: no se rediseña y sus neutros siguen al tema de la PÁGINA, no al\n` +
      `del panel (anexo D, descartado 2). Hoy --line hace dos papeles —filete decorativo y borde de control—: H4\n` +
      `los separa en --hairline (exenta) y --hairline-strong (≥ ${numero(UMBRAL.control)}:1).${OFF}`
  )

  if (fallos.length) {
    console.log(`\n${RED}✗ ${fallos.length} pareja(s) por debajo de su umbral${OFF}`)
    for (const f of fallos) console.log(`   ${RED}${f}${OFF}`)
    console.log(`\n${DIM}Este informe no genera nada: dice qué mide el CSS de hoy.${OFF}`)
    process.exitCode = 1
    return
  }

  console.log(`\n${GREEN}✓${OFF} todas las parejas declaradas cumplen su umbral en los dos temas`)
  console.log(`${DIM}Este informe no genera nada: dice qué mide el CSS de hoy.${OFF}`)
}

main()
