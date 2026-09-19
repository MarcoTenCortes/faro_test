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
 * Las parejas NO se declaran aquí: viven en `test/contrast-pairs.js`, que es la
 * misma lista que pina `test/unit/panel-css.test.js`. Hasta la revisión
 * adversaria de H4 había dos copias y ya se habían separado (hallazgo 8): el
 * informe medía `--ink-2` sobre `--surface-2` llamándolo «burbuja del usuario»
 * —que pinta `--ink`— y el test no lo medía. De las cadenas de respaldo por
 * token (`['--hairline-strong', '--line-2']`) y del camino que buscaba el tema
 * oscuro dentro de `@media (prefers-color-scheme: dark) → :root` tampoco queda
 * nada: existían para medir lo mismo antes y después del renombrado de H4, que
 * ya está hecho. Si un token o un bloque de tema no existe, esto falla en voz
 * alta en vez de imprimir un «—» que nadie mira.
 *
 * Umbrales: 4,5:1 para texto normal (WCAG 2.1 SC 1.4.3, «AAA» a partir de 7) y
 * 3:1 para lo que dibuja un control (SC 1.4.11). Sale con 1 si alguna pareja
 * medida baja de su umbral o si falta un token; las parejas marcadas «exenta»
 * se imprimen con su número y no cuentan.
 *
 *   node tools/contrast-report.mjs        (= npm run contrast)
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERLAY_CSS } from '../src/content/overlay/styles.js'
import { contrastRatio, cssVarsOf, parseColor } from '../test/contrast.js'
import { TEXTO, CONTROL, EXENTOS, OVERLAY_REGLAS, OVERLAY_TOKENS, UMBRAL } from '../test/contrast-pairs.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const AAA = 7

// -------------------------------------------------------- parejas declaradas

/** Una fila `[frente, fondo, qué dibuja, tema?]` de contrast-pairs.js, con su tipo. */
function par([fg, bg, que, tema], tipo) {
  return { fg, bg, que, tipo, tema }
}

/** El panel, en orden de lectura: primero lo que lleva letra, luego los bordes. */
const PANEL = [
  ...TEXTO.map((f) => par(f, 'texto')),
  ...CONTROL.map((f) => par(f, 'control')),
  ...EXENTOS.map((f) => par(f, 'exenta')),
]

/** Y el overlay: sus reglas con color+fondo escritos, y los dos textos del cartel. */
const REGLAS = OVERLAY_REGLAS.map(([regla, que]) => ({ regla, que, tipo: 'texto' }))
const TOKENS_OVERLAY = OVERLAY_TOKENS.map((f) => par(f, 'texto'))

// ------------------------------------------------------------------- lectura

const OSCURO = ':root:not([data-theme="light"])'
const OSCURO_FORZADO = ':root[data-theme="dark"]'

/**
 * Los tokens del tema oscuro: el bloque que elige el sistema y, si por lo que
 * sea no estuviera, el que fuerza el espejo del banco (los dos dicen lo mismo y
 * panel-css.test.js lo pina). Un bloque de tema redefine sólo colores, así que
 * el resultado se funde sobre el claro.
 */
function tokensOscuros(css) {
  for (const sel of [OSCURO, OSCURO_FORZADO]) {
    const vars = cssVarsOf(css, sel)
    if (Object.keys(vars).length) return { sel, vars }
  }
  return { sel: '(sin bloque oscuro)', vars: {} }
}

/** El color de un token, o null si ese token no existe o no se reconoce. */
function resolver(nombre, tokens) {
  const valor = tokens[nombre]
  return valor !== undefined && parseColor(valor) ? { nombre, color: valor } : null
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

/** Una fila de la tabla: ratio, veredicto y por qué. Un color que falta es un fallo. */
function medir(par, fg, bg) {
  const umbral = UMBRAL[par.tipo] ?? 0
  if (!fg || !bg) {
    const falta = [!fg ? par.fg : '', !bg ? par.bg : ''].filter(Boolean).join(' y ')
    return { falta: `no existe ${falta}`, umbral }
  }
  const ratio = contrastRatio(fg.color, bg.color)
  if (ratio === null) return { falta: 'algún color no se reconoce', umbral }
  const cumple = par.tipo === 'exenta' || ratio >= umbral
  const nivel = par.tipo === 'exenta' ? 'exenta' : !cumple ? 'falla' : par.tipo === 'texto' && ratio >= AAA ? 'AAA' : 'AA'
  return { ratio, nivel, cumple, fg, bg, umbral }
}

function seccion(titulo, fuente, filas) {
  const fallos = []
  const cuerpo = []

  for (const f of filas) {
    if (f.falta) {
      cuerpo.push([{ t: '—', color: RED }, { t: 'falta', color: RED }, f.pareja, { t: f.falta, color: RED }, f.que])
      fallos.push(`${titulo} · ${f.pareja} (${f.falta}) · ${f.que}`)
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

/** `tema` es la clave con la que una pareja se acota a un tema: 'light' o 'dark'. */
function filasDeTokens(pares, tokens, tema) {
  return pares
    .filter((p) => !p.tema || p.tema === tema)
    .map((p) => {
      const fg = resolver(p.fg, tokens)
      const bg = resolver(p.bg, tokens)
      return { ...medir(p, fg, bg), pareja: `${p.fg} sobre ${p.bg}`, que: p.que }
    })
}

function filasDeReglas(css, pares, tokens) {
  return pares.map((p) => {
    const texto = valorDeRegla(css, p.regla, 'color', tokens)
    const fondo = valorDeRegla(css, p.regla, 'background', tokens)
    const fg = texto && parseColor(texto) ? { nombre: 'color', color: texto } : null
    const bg = fondo && parseColor(fondo) ? { nombre: 'background', color: fondo } : null
    return {
      ...medir({ ...p, fg: `el color de ${p.regla}`, bg: `el background de ${p.regla}` }, fg, bg),
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
      `control ≥ ${numero(UMBRAL.control)}:1 (SC 1.4.11) · parejas de test/contrast-pairs.js${OFF}`
  )

  const fallos = [
    ...seccion('PANEL · CLARO', 'src/panel/panel.css → :root', filasDeTokens(PANEL, claro, 'light')),
    ...seccion(
      'PANEL · OSCURO',
      `src/panel/panel.css → ${oscuro.sel}`,
      filasDeTokens(PANEL, { ...claro, ...oscuro.vars }, 'dark')
    ),
  ]

  const overlayClaro = cssVarsOf(OVERLAY_CSS, ':host')
  const overlayOscuro = { ...overlayClaro, ...cssVarsOf(OVERLAY_CSS, ':host(.faro-dark)') }
  fallos.push(
    ...seccion('OVERLAY · CLARO', 'src/content/overlay/styles.js → :host', [
      ...filasDeReglas(OVERLAY_CSS, REGLAS, overlayClaro),
      ...filasDeTokens(TOKENS_OVERLAY, overlayClaro, 'light'),
    ]),
    ...seccion('OVERLAY · OSCURO', 'src/content/overlay/styles.js → :host(.faro-dark)', [
      ...filasDeReglas(OVERLAY_CSS, REGLAS, overlayOscuro),
      ...filasDeTokens(TOKENS_OVERLAY, overlayOscuro, 'dark'),
    ])
  )

  console.log(
    `\n${DIM}El ámbar de relleno lleva texto encima, así que su pareja que cuenta es el texto (--on-mark), no su\n` +
      `borde sobre el fondo; por eso «relleno de la pastilla» sólo se mide en oscuro (anexo D). El overlay no se\n` +
      `mide más allá de sus rellenos con texto: no se rediseña y sus neutros siguen al tema de la PÁGINA, no al\n` +
      `del panel (anexo D, descartado 2). «exenta» es un borde que NO llega a ${numero(UMBRAL.control)}:1 y no tiene por qué:\n` +
      `ninguno de los tres es lo único que identifica su control, y el test comprueba que siguen por debajo.${OFF}`
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
