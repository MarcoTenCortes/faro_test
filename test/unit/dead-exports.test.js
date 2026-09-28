/**
 * Exportaciones que nadie usa.
 *
 * Hermano de undefined-refs.test.js, que vigila lo contrario (usar un nombre
 * sin importarlo). Sin empaquetador nadie avisa de que una función exportada
 * se quedó sin llamadas, y el mapa de CLAUDE.md §3 la sigue listando como si
 * existiera de verdad. Pasó de verdad (auditoría de 2026-09-13, docs/PLAN.md
 * D4): diez exportaciones muertas —`HIGHLIGHT_STYLES`, `sendToRuntime`,
 * `isVisible`, `FILES`/`workspaceForHost`, `isAtlassianUrl`, `expanderFor`,
 * `incrementalIndexPrompt`, `humanDuration`— más `NAV_TIMING`, que nadie
 * importaba; quien buscaba el estilo de resaltado en `HIGHLIGHT_STYLES` y
 * añadía uno no cambiaba nada, porque el panel compara con literales.
 *
 * Y pasó de verdad una segunda vez (revisión adversaria de H1, 2026-09-14):
 * la primera versión de esta prueba buscaba el nombre como PALABRA en todos
 * los ficheros, incluido este mismo, que escribe cada nombre de la lista de
 * deuda entre comillas: la regla «muerta» no podía marcar nunca una
 * exportación listada, cualquier mención en un test por regex sobre el fuente
 * (`panel-wiring.test.js`) contaba como uso, y la reexportación muerta de
 * `hasVisibleChildRows` en locators.js se salvaba porque tree-dom.js la usa
 * por dentro. Ahora «importada fuera» quiere decir IMPORTADA DE VERDAD y del
 * módulo que la exporta:
 *   import { a, b as c } from '…'        · import * as X from '…' + X.a
 *   export { a } from '…'
 *   const { a } = await import('…')      · X = await import('…') + X.a
 *   import('…').then(({ a }) => …)
 *   const [{ a }, { b }] = await Promise.all([import('…'), import('…')])
 * (los `import()` del content script llevan `url('src/…')`; los del banco,
 * `/src/…`), y los .html del banco cuentan sólo por lo que importan sus
 * `<script type="module">`. Este fichero queda fuera del corpus.
 *
 * Dos reglas, de más a menos grave:
 *  1. MUERTA: se exporta y no la importa nadie (src/, harness/ —incluidos los
 *     .html del banco—, tools/, test/) ni se usa dentro de su fichero más
 *     allá de declararla (un `import` + `export { x }` de paso no es un uso).
 *     Ninguna se tolera.
 *  2. EXPORTADA SIN QUE NADIE LA IMPORTE: viva dentro de su fichero, pero el
 *     `export` no lo usa nadie. Son deuda (o pierden el export, o ganan un
 *     test que las importe); van en una lista explícita para que no crezcan
 *     sin verlo. Que alguien empiece a importar una no rompe nada: sólo hace
 *     que sobre en la lista.
 * Lo que se exporta legítimamente sin que nadie lo importe iría en la LISTA
 * BLANCA con su motivo, que otra prueba obliga a mantener corta.
 *
 * Límite asumido: una función que sólo se llama a sí misma cuenta como viva.
 */
import { test, eq } from '../harness.js'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, posix } from 'node:path'
import { listJsFiles } from '../syntax.js'

const ROOT = join(import.meta.dirname, '..', '..')
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/')

/** Este fichero: nombra cada exportación de la lista y no importa ninguna. */
const PROPIO = 'test/unit/dead-exports.test.js'

/**
 * Lista blanca: fichero → nombres que se exportan sin que nadie los importe y
 * está bien así (puntos de entrada, lo que un módulo exporta sólo para el
 * banco…). Cada entrada lleva su motivo; si el nombre deja de estar muerto, la
 * prueba de abajo pide quitarlo.
 */
const LISTA_BLANCA = {
  // (vacía a propósito: hoy nada de src/ se exporta legítimamente sin que
  // alguien lo importe. Añadir aquí sólo con motivo escrito.)
}

/**
 * Exportaciones que existen para un hito que todavía no ha llegado (H7).
 *
 * `EXPORTADAS_SIN_IMPORTAR` es deuda vieja y sólo puede ENCOGER: meter ahí lo
 * que un hito siguiente va a importar la volvería una lista que crece y deja de
 * significar nada. Esto es lo contrario: una lista corta, con el hito que la va
 * a consumir escrito al lado, que se vacía sola cuando ese hito llega y empieza
 * a importar el nombre.
 *
 * Formato: ruta → `{ hito, nombres }`.
 *
 * HOY ESTÁ VACÍA a propósito: todo lo que H7 exporta lo importa de verdad su
 * prueba (rest-get.test.js, jira-rest.test.js, confluence-rest.test.js,
 * site.test.js, settings.test.js), que es la forma de que una función pura no
 * nazca sin nadie que la ejercite. Si H8-H11 necesitan exportar algo que aún no
 * puede tener importador, va aquí con su hito, no en la lista de deuda.
 */
const PENDIENTES_DE_HITO = {}

/** La misma lista en la forma `ruta → nombres` que usan las comprobaciones. */
const pendientesPlanos = Object.fromEntries(
  Object.entries(PENDIENTES_DE_HITO).map(([ruta, v]) => [ruta, (v && v.nombres) || []])
)

/**
 * Exportadas pero usadas sólo dentro de su propio fichero (2026-09-14, con la
 * regla «importada de verdad»). No están muertas; el `export` sobra o les
 * falta un test que las importe. La lista sólo puede encoger: una exportación
 * nueva sin importador falla.
 */
const EXPORTADAS_SIN_IMPORTAR = {
  'src/atlassian/index-store.js': ['rankByRelevance'],
  'src/content/anchor-match.js': ['findFuzzyTokens', 'findFuzzy'],
  'src/content/anchor.js': ['findHeadingElement'],
  'src/content/digest.js': ['isBlock', 'tagLabel'],
  'src/content/dom-utils.js': ['stickyOffset'],
  'src/content/jira-issue.js': ['ISSUE_CHROME'],
  // `resolveDescriptor` salió en H28: la importa locators.test.js (C3-6).
  'src/content/locators.js': ['visibleText'],
  'src/content/picker.js': ['mediaBajo', 'affixes', 'nearestHeading', 'captureImage'],
  // Sólo la «importaba» la reexportación de paso de locators.js, ya borrada.
  'src/content/tree-scan.js': ['pageIdFromHref'],
  'src/nav/validate.js': ['productOfSite'],
  'src/opencode/turn.js': ['isModelUnavailableError'],
  'src/panel/indexer.js': ['ownProductEntities'],
  'src/panel/prompts.js': ['formatReminder'],
  'src/panel/setup.js': ['isCloudHost'],
  'src/panel/sources.js': ['DEFAULT_SOURCE_MODE'],
  'src/shared/config.js': ['DEFAULT_SERVER'],
  'src/shared/log.js': ['Logger'],
  'src/shared/storage.js': ['getSites'],
}

// ---------------------------------------------------------------------------
// Lectura de un fichero: qué exporta, qué importa y de dónde. Puro sobre el
// texto, para poder probarlo con ficheros inventados.
// ---------------------------------------------------------------------------

/** Quita comentarios: un nombre citado sólo en un comentario no es un uso. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
}

/** De un .html sólo cuenta lo que hay dentro de sus `<script type="module">`. */
function scriptsModulo(html) {
  return [...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join('\n')
}

function exportadas(src) {
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  // También `export { a } from '…'`: un módulo que reexporta lo que nadie le
  // pide tiene una exportación muerta (locators.js con hasVisibleChildRows).
  for (const m of src.matchAll(/export\s*\{([^{}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const name = (piece.includes(' as ') ? piece.split(' as ')[1] : piece).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * A qué fichero del repo (ruta relativa con barras) apunta un especificador
 * de import visto desde `desde`. `node:…`, `https:…` → null. Sin tocar disco:
 * un especificador que no lleve a nada simplemente no casa con ningún módulo.
 */
function moduloDe(spec, desde) {
  const limpio = String(spec || '').replace(/[?#].*$/, '')
  if (!limpio || /^[a-z][a-z0-9+.-]*:/i.test(limpio)) return null
  if (limpio.startsWith('/')) return posix.normalize(limpio.slice(1))
  if (limpio.startsWith('.')) return posix.normalize(posix.join(posix.dirname(desde), limpio))
  return posix.normalize(limpio) // `url('src/…')` del content script
}

/** Los nombres ORIGINALES de `{ a, b as c, d: e }` (lo que exporta el módulo). */
function nombresDeLlaves(interior) {
  const out = []
  for (const piece of interior.split(',')) {
    const name = piece.trim().split(/\s+as\s+|\s*:\s*/)[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name)
  }
  return out
}

/** `'…'` o `url('…')`: lo que va dentro de un `import(…)` en este repo. */
const SPEC = `(?:url\\(\\s*)?['"]([^'"]+)['"]`

/**
 * Qué importa un fichero y de qué módulo: `porModulo` (ruta → nombres) y
 * `espacios` (alias → ruta, para `import * as X` y `const X = await import`).
 */
function importaciones(texto, desde) {
  const porModulo = new Map()
  const espacios = []
  const add = (modulo, names) => {
    if (!modulo || !names.length) return
    if (!porModulo.has(modulo)) porModulo.set(modulo, new Set())
    for (const n of names) porModulo.get(modulo).add(n)
  }
  // import { a, b as c } from '…' · import * as X from '…' · import D, { a } from '…'
  for (const m of texto.matchAll(/import\s+([^'"()]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const modulo = moduloDe(m[2], desde)
    const llaves = m[1].match(/\{([^{}]*)\}/)
    if (llaves) add(modulo, nombresDeLlaves(llaves[1]))
    const ns = m[1].match(/\*\s*as\s+([A-Za-z_$][\w$]*)/)
    if (ns && modulo) espacios.push({ alias: ns[1], modulo })
  }
  // export { a, b as c } from '…'
  for (const m of texto.matchAll(/export\s*\{([^{}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    add(moduloDe(m[2], desde), nombresDeLlaves(m[1]))
  }
  // const { a, b: c } = await import('…')
  for (const m of texto.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*await\\s+import\\(\\s*${SPEC}`, 'g'))) {
    add(moduloDe(m[2], desde), nombresDeLlaves(m[1]))
  }
  // const X = await import('…') · X = await import('…')  → después X.a
  for (const m of texto.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+import\\(\\s*${SPEC}`, 'g'))) {
    const modulo = moduloDe(m[2], desde)
    if (modulo) espacios.push({ alias: m[1], modulo })
  }
  // import('…').then(({ a, b }) => …)
  for (const m of texto.matchAll(new RegExp(`import\\(\\s*${SPEC}\\s*\\)?\\s*\\)\\s*\\.then\\(\\s*\\(?\\s*\\{([^{}]*)\\}`, 'g'))) {
    add(moduloDe(m[1], desde), nombresDeLlaves(m[2]))
  }
  // const [{ a }, { b }] = await Promise.all([import('…'), import('…')]): por posición
  for (const m of texto.matchAll(/\[((?:\s*\{[^{}]*\}\s*,?)+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    const patrones = [...m[1].matchAll(/\{([^{}]*)\}/g)].map((x) => nombresDeLlaves(x[1]))
    const specs = [...m[2].matchAll(new RegExp(`import\\(\\s*${SPEC}`, 'g'))].map((x) => x[1])
    patrones.forEach((names, i) => add(moduloDe(specs[i], desde), names))
  }
  return { porModulo, espacios }
}

/** Un fichero del corpus a partir de su ruta relativa y su texto crudo. */
function fichero(ruta, crudo) {
  const texto = sinComentarios(ruta.endsWith('.html') ? scriptsModulo(crudo) : crudo)
  return { rel: ruta, texto, imp: importaciones(texto, ruta) }
}

/** El nombre como identificador: ni parte de otro ni propiedad (`x.name`); `...name` sí. */
function palabraEntera(name, flags = '') {
  return new RegExp('(?<![\\w$])(?<!(?<!\\.)\\.)' + name.replace(/\$/g, '\\$') + '(?![\\w$])', flags)
}

/** Quién importa `name` DEL módulo `propio` (rutas de los ficheros). */
function importadores(name, propio, ficheros) {
  const out = []
  for (const f of ficheros) {
    if (f.rel === propio) continue
    if (f.imp.porModulo.get(propio)?.has(name)) out.push(f.rel)
    else if (f.imp.espacios.some((e) => e.modulo === propio && new RegExp('(^|[^\\w$])' + e.alias + '\\.' + name + '(?![\\w$])').test(f.texto))) {
      out.push(f.rel)
    }
  }
  return out
}

/** Sin sus `import … from` ni sus `export { … }`: pasar de largo no es usar. */
function sinDeclaraciones(texto) {
  return texto
    .replace(/import\s+[^'"()]+?\s+from\s*['"][^'"]+['"]/g, ' ')
    .replace(/export\s*\{[^{}]*\}(\s*from\s*['"][^'"]+['"])?/g, ' ')
}

/** Usada dentro de su fichero: aparece más veces que en su declaración. */
function usadaDentro(name, texto) {
  const t = sinDeclaraciones(texto)
  const veces = (t.match(palabraEntera(name, 'g')) || []).length
  const declarada = new RegExp('(function\\s*\\*?\\s*|class\\s+|const\\s+|let\\s+|var\\s+)' + name + '(?![\\w$])').test(t)
  return veces > (declarada ? 1 : 0)
}

/**
 * Clasifica las exportaciones de los ficheros de src/ del corpus, sin mirar
 * ninguna lista: `muertas` (nadie las importa ni se usan dentro) y
 * `sinImportar` (nadie las importa; incluye las muertas). Cada una «ruta exporta nombre».
 */
function clasificar(ficheros) {
  const muertas = []
  const sinImportar = []
  for (const f of ficheros.filter((x) => x.rel.startsWith('src/'))) {
    for (const name of exportadas(f.texto)) {
      if (importadores(name, f.rel, ficheros).length) continue
      sinImportar.push(`${f.rel} exporta ${name}`)
      if (!usadaDentro(name, f.texto)) muertas.push(`${f.rel} exporta ${name}`)
    }
  }
  return { muertas, sinImportar }
}

// ---------------------------------------------------------------------------
// El corpus real: src/, harness/ (.js y .html), tools/ y test/, menos este fichero.
// ---------------------------------------------------------------------------

const htmlDelBanco = readdirSync(join(ROOT, 'harness'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => join(ROOT, 'harness', f))

const ficheros = [...listJsFiles(ROOT), ...htmlDelBanco]
  .map((file) => ({ file, rel: rel(file) }))
  .filter(({ rel }) => /^(src|harness|tools|test)\//.test(rel) && rel !== PROPIO)
  .map(({ file, rel }) => fichero(rel, readFileSync(file, 'utf8')))

const fuentes = ficheros.filter((f) => f.rel.startsWith('src/'))

const enLista = (lista, ruta, name) => (lista[ruta] || []).includes(name)

test('ninguna exportación de src/ está muerta: la importa alguien o, al menos, se usa dentro de su fichero', () => {
  const { muertas } = clasificar(ficheros)
  const sinBlanca = muertas.filter((linea) => {
    const [ruta, name] = linea.split(' exporta ')
    return !enLista(LISTA_BLANCA, ruta, name)
  })
  eq(sinBlanca.map((l) => `${l} y nadie lo usa`), [])
})

test('toda exportación de src/ la importa alguien de verdad, salvo las apuntadas como deuda o en la lista blanca', () => {
  const { sinImportar } = clasificar(ficheros)
  const nuevas = sinImportar.filter((linea) => {
    const [ruta, name] = linea.split(' exporta ')
    return (
      !enLista(LISTA_BLANCA, ruta, name) &&
      !enLista(EXPORTADAS_SIN_IMPORTAR, ruta, name) &&
      !enLista(pendientesPlanos, ruta, name)
    )
  })
  eq(nuevas.map((l) => `${l} y nadie lo importa: impórtalo desde un test, quita el export o apúntalo`), [])
})

test('lo que espera a un hito va en su lista, con el hito escrito, y hoy no espera nada (H7)', () => {
  // La forma importa: sin el hito al lado, esta lista sería otra lista de deuda.
  const malFormadas = []
  for (const [ruta, v] of Object.entries(PENDIENTES_DE_HITO)) {
    if (!v || !/^H\d{1,2}$/.test(String(v.hito || ''))) malFormadas.push(`${ruta} no dice qué hito lo va a importar`)
    if (!Array.isArray(v?.nombres) || !v.nombres.length) malFormadas.push(`${ruta} no nombra ninguna exportación`)
  }
  eq(malFormadas, [])
  // Y la comprobación que de verdad importa: todo lo que H7 exporta tiene ya
  // quien lo importe (su prueba), así que la lista está vacía.
  eq(Object.keys(PENDIENTES_DE_HITO), [], 'nada de H7 se exporta sin que alguien lo importe de verdad')
})

test('las listas sólo nombran exportaciones que existen, y la lista blanca sólo las que de verdad nadie importa', () => {
  const sobran = []
  for (const [lista, estricta] of [
    [LISTA_BLANCA, true],
    [EXPORTADAS_SIN_IMPORTAR, false],
    [pendientesPlanos, true],
  ]) {
    for (const [ruta, nombres] of Object.entries(lista)) {
      const f = fuentes.find((x) => x.rel === ruta)
      if (!f) {
        sobran.push(`${ruta} no existe en src/`)
        continue
      }
      const exp = exportadas(f.texto)
      for (const name of nombres) {
        if (!exp.has(name)) sobran.push(`${ruta} ya no exporta ${name}`)
        else if (estricta && importadores(name, ruta, ficheros).length) sobran.push(`${ruta}: ${name} ya se importa; quítalo de la lista blanca`)
      }
    }
  }
  eq(sobran, [])
})

// ---------------------------------------------------------------------------
// La regla en sí, con ficheros inventados.
// ---------------------------------------------------------------------------

test('moduloDe resuelve el especificador contra el fichero que importa, con las tres formas del repo', () => {
  eq(moduloDe('../../src/panel/notes.js', 'test/unit/notes.test.js'), 'src/panel/notes.js')
  eq(moduloDe('./tree-dom.js', 'src/content/locators.js'), 'src/content/tree-dom.js')
  eq(moduloDe('../src/content/runner.js', 'harness/harness.js'), 'src/content/runner.js')
  eq(moduloDe('/src/content/locators.js', 'harness/harness.js'), 'src/content/locators.js')
  eq(moduloDe('src/shared/config.js', 'src/content/bootstrap.js'), 'src/shared/config.js')
  eq(moduloDe('../../src/background/service-worker.js?probe=1', 'test/unit/sw.test.js'), 'src/background/service-worker.js')
  eq(moduloDe('node:fs', 'test/unit/x.test.js'), null)
  eq(moduloDe('https://cdn/x.js', 'harness/index.html'), null)
  eq(moduloDe('', 'src/a.js'), null)
})

test('sólo cuenta importar de verdad y del módulo que exporta: cada forma del repo, y ni la palabra en un test ni este fichero', () => {
  const corpus = [
    fichero(
      'src/x/mod.js',
      [
        "import { ayuda } from './otro.js'",
        'export function estatica() {}',
        'export function porEspacio() {}',
        'export function dinamica() {}',
        'export function enParalelo() {}',
        'export function porThen() {}',
        'export function reexportada() {}',
        'export const CONSTANTE = 1',
        'export function auxiliar() {}',
        'function local() { return auxiliar() }',
        'export function muerta() {}',
        'export function citada() {}',
        'export { ayuda }',
      ].join('\n')
    ),
    fichero('src/x/otro.js', 'export function ayuda() {}'),
    // El mismo nombre exportado por OTRO módulo: importar `estatica` de mod.js no lo salva.
    fichero('src/y/mod.js', 'export function estatica() {}'),
    fichero(
      'src/x/usa.js',
      ["import { estatica as e } from './mod.js'", "import * as M from './mod.js'", 'e(); M.porEspacio()'].join('\n')
    ),
    fichero(
      'src/content/boot.js',
      [
        'const url = (p) => p',
        'async function boot() {',
        '  const [{ enParalelo }, { MSG }] = await Promise.all([',
        "    import(url('src/x/mod.js')),",
        "    import(url('src/shared/messages.js')),",
        '  ])',
        "  import(url('src/x/mod.js')).then(({ porThen }) => porThen())",
        '}',
      ].join('\n')
    ),
    fichero('src/x/indice.js', "export { reexportada } from './mod.js'"),
    fichero(
      'harness/preview.html',
      [
        '<p>muerta citada</p>',
        "<script>const { muerta } = { muerta: 1 }</script>",
        "<script type=\"module\">const { dinamica } = await import('/src/x/mod.js'); dinamica()</script>",
      ].join('\n')
    ),
    fichero(
      'test/unit/mod.test.js',
      [
        "const { CONSTANTE: C } = await import('../../src/x/mod.js')",
        "assert(/citada\\(/.test(fuente) && src.includes('muerta'), 'la palabra en un test no es un uso')",
      ].join('\n')
    ),
    // Este mismo fichero (nombra cada exportación de la lista) no cuenta como importador.
    fichero(PROPIO, "import { muerta, citada, auxiliar } from '../../src/x/mod.js'"),
  ].filter((f) => f.rel !== PROPIO)

  eq(importadores('estatica', 'src/x/mod.js', corpus), ['src/x/usa.js'])
  eq(importadores('porEspacio', 'src/x/mod.js', corpus), ['src/x/usa.js'])
  eq(importadores('enParalelo', 'src/x/mod.js', corpus), ['src/content/boot.js'])
  eq(importadores('porThen', 'src/x/mod.js', corpus), ['src/content/boot.js'])
  eq(importadores('reexportada', 'src/x/mod.js', corpus), ['src/x/indice.js'])
  eq(importadores('dinamica', 'src/x/mod.js', corpus), ['harness/preview.html'])
  eq(importadores('CONSTANTE', 'src/x/mod.js', corpus), ['test/unit/mod.test.js'])
  eq(importadores('estatica', 'src/y/mod.js', corpus), [])
  eq(importadores('ayuda', 'src/x/otro.js', corpus), ['src/x/mod.js'])

  // `ayuda` en mod.js y `reexportada` en indice.js: importar y reexportar de
  // paso no es usar, y nadie las pide a ESE módulo.
  eq(clasificar(corpus), {
    muertas: [
      'src/x/mod.js exporta muerta',
      'src/x/mod.js exporta citada',
      'src/x/mod.js exporta ayuda',
      'src/y/mod.js exporta estatica',
      'src/x/indice.js exporta reexportada',
    ],
    sinImportar: [
      'src/x/mod.js exporta auxiliar',
      'src/x/mod.js exporta muerta',
      'src/x/mod.js exporta citada',
      'src/x/mod.js exporta ayuda',
      'src/y/mod.js exporta estatica',
      'src/x/indice.js exporta reexportada',
    ],
  })
})
