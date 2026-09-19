/**
 * Contraste WCAG y escalas de píxeles del CSS, calculados en Node.
 *
 * Por qué existe: la auditoría del 2026-09-13 midió el panel a mano y encontró
 * tres fallos reales de contraste —el texto del botón primario y del `.send`
 * sobre `--gold` en claro a 3,09:1 (docs/PLAN.md §2, A5), el hover y el activo
 * de la insignia y del botón del overlay a 2,76:1 (A8) y los bordes de inputs
 * y del botón fantasma a 1,30-1,44:1 (A4)— pero las cuentas se hicieron en un
 * script del scratchpad y los números acabaron sólo en la prosa del anexo. Un
 * ratio escrito a mano en un documento no protege de nada: al siguiente cambio
 * de color nadie lo recalcula. Esto lo pone al alcance de un test
 * (test/unit/contrast.test.js) y de una herramienta (`npm run contrast`).
 *
 * Es del estilo de test/tdz.js: ayudas puras para las pruebas y para una
 * herramienta del repo, sin DOM, sin `chrome` y sin dependencias. Nada de
 * `src/` lo importa, y por eso vive en test/ y no en src/shared/.
 *
 * El lector de CSS es de recuento de llaves y expresiones regulares, como todo
 * lo que panel-wiring hace con panel.js: no entiende CSS, sólo lo justo. De ahí
 * dos decisiones:
 *  - Se quitan comentarios y `url(...)` ANTES de mirar nada: un `}` o un `;`
 *    dentro de un data URI (el chevron de los selects del redactor va a ser
 *    uno) descolocaría el recuento de llaves y el reparto de declaraciones.
 *  - `cssVarsOf` casa el selector LITERALMENTE (normalizando espacios) y se
 *    queda con el PRIMER bloque que casa. No resuelve especificidad ni cascada:
 *    quien pregunta sabe qué bloque quiere («:root», «:root[data-theme="dark"]»,
 *    «:host(.faro-dark)») y el de un tema redefine sólo colores, así que el
 *    informe funde el oscuro sobre el claro él mismo.
 *
 * Las fórmulas son las de WCAG 2.1: luminancia relativa sRGB y
 * (L1 + 0,05) / (L2 + 0,05). Umbrales: 4,5:1 para texto normal (SC 1.4.3) y
 * 3:1 para componentes de interfaz (SC 1.4.11), que es el que aplica cuando un
 * borde es lo único que dibuja un control.
 */

// ------------------------------------------------------------------- colores

const CANALES = ['r', 'g', 'b']

/** Un número dentro de [0, max], o null si no es un número. */
function limitar(valor, max) {
  const n = typeof valor === 'string' ? Number(valor.trim()) : Number(valor)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(0, n))
}

/**
 * Un color CSS a `{r, g, b, a}` (canales 0-255, alfa 0-1), o null.
 *
 * Reconoce lo que aparece de verdad en panel.css y en el overlay: hex de 3, 4,
 * 6 u 8 dígitos, `rgb()`/`rgba()` con comas o con espacios y barra, porcentajes
 * y la palabra `transparent`. Nada de `hsl()`, nombres de color ni
 * `color-mix()`: si alguno entra en el CSS, esto devuelve null y quien pregunta
 * lo dice en voz alta en vez de inventarse un ratio. Puro.
 */
export function parseColor(value) {
  if (value && typeof value === 'object') return desdeObjeto(value)
  if (typeof value !== 'string') return null

  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex) return desdeHex(hex[1])

  const fn = /^rgba?\(([^)]*)\)$/.exec(v)
  if (!fn) return null

  const partes = fn[1].split(/[\s,/]+/).filter(Boolean)
  if (partes.length < 3) return null

  const canal = (p) => (p.endsWith('%') ? limitar(parseFloat(p) * 2.55, 255) : limitar(p, 255))
  const [r, g, b] = partes.slice(0, 3).map(canal)
  if (r === null || g === null || b === null) return null

  const cuarto = partes[3]
  const alfa =
    cuarto === undefined ? 1 : cuarto.endsWith('%') ? limitar(parseFloat(cuarto) / 100, 1) : limitar(cuarto, 1)

  return { r, g, b, a: alfa === null ? 1 : alfa }
}

function desdeHex(digitos) {
  const n = digitos.length
  if (n === 3 || n === 4) {
    const p = digitos.split('').map((c) => parseInt(c + c, 16))
    return { r: p[0], g: p[1], b: p[2], a: n === 4 ? p[3] / 255 : 1 }
  }
  if (n === 6 || n === 8) {
    const p = [0, 2, 4, 6].map((i) => parseInt(digitos.slice(i, i + 2), 16))
    return { r: p[0], g: p[1], b: p[2], a: n === 8 ? p[3] / 255 : 1 }
  }
  return null
}

function desdeObjeto(color) {
  const out = {}
  for (const k of CANALES) {
    const v = limitar(color[k], 255)
    if (v === null) return null
    out[k] = v
  }
  const alfa = color.a === undefined ? 1 : limitar(color.a, 1)
  out.a = alfa === null ? 1 : alfa
  return out
}

/** `{r, g, b}` a «#RRGGBB» en mayúsculas, como está escrito el CSS. */
function aHex(color) {
  const dos = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()
  return '#' + dos(color.r) + dos(color.g) + dos(color.b)
}

/**
 * El color que se ve al poner `fg` al `alpha` que se diga encima de `bg`.
 *
 * Con `alpha` null o sin pasarlo se usa el alfa del propio `fg`: así una
 * hairline declarada `rgba(255,255,255,.08)` se resuelve sin repetir el número.
 * `bg` se toma como opaco (su alfa se ignora): un fondo traslúcido sobre otro
 * fondo desconocido no tiene color que medir. Devuelve «#RRGGBB» o null. Puro.
 */
export function blendOver(fg, alpha, bg) {
  const frente = parseColor(fg)
  const fondo = parseColor(bg)
  if (!frente || !fondo) return null

  const dado = alpha === undefined || alpha === null ? frente.a : limitar(alpha, 1)
  const k = dado === null ? 1 : dado
  const mezcla = (x, y) => x * k + y * (1 - k)

  return aHex({ r: mezcla(frente.r, fondo.r), g: mezcla(frente.g, fondo.g), b: mezcla(frente.b, fondo.b) })
}

/** Luminancia relativa sRGB (0 negro, 1 blanco), o null. WCAG 2.1. Pura. */
export function relativeLuminance(color) {
  const c = parseColor(color)
  if (!c) return null
  const canal = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b)
}

/**
 * Ratio de contraste entre `a` y `b`, de 1 a 21. Simétrico: da igual cuál es
 * el texto. Null si alguno no se reconoce.
 *
 * Un color traslúcido no tiene contraste propio: se mezcla con lo que hay
 * detrás, que es justo el otro argumento. Por eso, si `a` lleva alfa, se
 * compone sobre `b` antes de medir; así `--hairline` en oscuro
 * (`rgba(255,255,255,.08)`) se compara con `--surface` sin cuentas aparte.
 * Pura.
 */
export function contrastRatio(a, b) {
  const frente = parseColor(a)
  const fondo = parseColor(b)
  if (!frente || !fondo) return null

  const visto = frente.a < 1 ? parseColor(blendOver(frente, frente.a, aHex(fondo))) : frente
  const l1 = relativeLuminance(visto)
  const l2 = relativeLuminance({ ...fondo, a: 1 })
  const [alto, bajo] = l1 >= l2 ? [l1, l2] : [l2, l1]

  return (alto + 0.05) / (bajo + 0.05)
}

// ----------------------------------------------------------------------- CSS

/** Comentarios fuera (conservando los saltos) y `url(...)` reducida a `url()`. */
function limpiar(css) {
  return String(css == null ? '' : css)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, 'url()')
}

/** Un selector comparable: espacios y saltos colapsados, sin bordes. */
function normalizarSelector(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Los bloques `selector { … }` del CSS, hijos antes que padres (se apuntan al
 * cerrarse). El prelude de cada bloque empieza tras la llave o el punto y coma
 * anterior, así que un bloque anidado dentro de un `@media` sale con su propio
 * selector y el `@media` con el suyo.
 */
function bloques(css) {
  const limpio = limpiar(css)
  const out = []
  const pila = []
  let inicio = 0

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (c === '{') {
      pila.push({ selector: normalizarSelector(limpio.slice(inicio, i)), desde: i + 1 })
      inicio = i + 1
    } else if (c === '}') {
      const b = pila.pop()
      if (b) out.push({ selector: b.selector, body: limpio.slice(b.desde, i) })
      inicio = i + 1
    } else if (c === ';') {
      inicio = i + 1
    }
  }

  return out
}

/**
 * Las declaraciones del PRIMER nivel de un cuerpo de bloque: lo que hay dentro
 * de un bloque anidado es de ese bloque, no de éste.
 */
function declaraciones(body) {
  const out = []
  let profundidad = 0
  let buf = ''

  const cerrar = () => {
    const i = buf.indexOf(':')
    const prop = i === -1 ? '' : buf.slice(0, i).trim()
    if (prop) out.push({ prop, value: buf.slice(i + 1).trim() })
    buf = ''
  }

  for (const c of body) {
    if (c === '{') {
      profundidad++
      buf = '' // lo acumulado era el selector del bloque anidado
      continue
    }
    if (c === '}') {
      profundidad--
      buf = ''
      continue
    }
    if (profundidad > 0) continue
    if (c === ';') {
      cerrar()
      continue
    }
    buf += c
  }
  cerrar() // la última declaración puede venir sin punto y coma

  return out
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g

/** `var(--x)` sustituida por su valor dentro del mismo mapa, con tope de vueltas. */
function resolverVars(valor, vars, vuelta = 0) {
  if (vuelta > 10 || !valor.includes('var(')) return valor
  const out = valor.replace(VAR, (todo, nombre, respaldo) =>
    nombre in vars ? vars[nombre] : respaldo === undefined ? todo : respaldo.trim()
  )
  return out === valor ? valor : resolverVars(out, vars, vuelta + 1)
}

/**
 * Las variables `--x` declaradas en el primer bloque cuyo selector casa
 * literalmente con `selector`, con los `var(--y)` del propio bloque resueltos.
 * `{}` si ese bloque no existe: quien pregunta decide si eso es un fallo o un
 * token que todavía no se ha escrito. Pura.
 */
export function cssVarsOf(css, selector) {
  const buscado = normalizarSelector(selector)
  const bloque = bloques(css).find((b) => b.selector === buscado)
  if (!bloque) return {}

  const vars = {}
  for (const { prop, value } of declaraciones(bloque.body)) {
    if (prop.startsWith('--')) vars[prop] = value
  }
  for (const nombre of Object.keys(vars)) vars[nombre] = resolverVars(vars[nombre], vars)

  return vars
}

/**
 * Cada literal en px de las propiedades que pida `props`, fuera de los bloques
 * de tokens (`:root`): `[{selector, prop, px}]`, un elemento por número.
 *
 * Sirve para comprobar que tamaños, espaciados y radios salen de la escala y no
 * de un número a ojo. Los bloques `:root` quedan fuera porque son justamente
 * donde se define la escala. Pura.
 */
export function pxLiterals(css, props = /font-size|padding|gap|margin|border-radius/) {
  // Una expresión regular global recuerda dónde iba entre llamadas a `test`, y
  // quien llama la escribe a mano: se copia sin la bandera. Una cadena también
  // vale, para que un `pxLiterals(css, 'height')` de paso no reviente.
  const re =
    props instanceof RegExp ? new RegExp(props.source, props.flags.replace(/g/g, '')) : new RegExp(String(props))
  const out = []

  for (const b of bloques(css)) {
    if (b.selector.includes(':root')) continue
    for (const { prop, value } of declaraciones(b.body)) {
      if (!re.test(prop)) continue
      for (const m of value.matchAll(/(-?\d*\.?\d+)px/g)) {
        out.push({ selector: b.selector, prop, px: Number(m[1]) })
      }
    }
  }

  return out
}
