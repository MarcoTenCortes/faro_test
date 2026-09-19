/**
 * Los documentos frente al código: AGENTS.md, §10 de CLAUDE.md y la
 * numeración del selfcheck del banco.
 *
 * Por qué existe. CLAUDE.md es el mapa del proyecto y su §10 dice, fragmento
 * a fragmento, qué pinan los tests; nadie comprobaba que esos fragmentos
 * siguieran existiendo. La auditoría del plan (docs/plan/anexo-hallazgos.md;
 * filas D1 y D5 de docs/PLAN.md) encontró AGENTS.md congelado en el commit
 * 7833bab (464 pruebas, ni una palabra de Jira), pines de §10 que ya no eran
 * los del test («mcpStatusFor(mcp, state.site.host, saved?.mcpName)»,
 * «normalizeNumbering(cruda).prose») y un «selfcheck 36» que en el banco no
 * llevaba número. Esto lee los documentos y el código y falla cuando se
 * separan.
 *
 * Qué se comprueba de §10 (de «## 10.» hasta «## 11.»): cada fragmento entre
 * acentos graves tiene que aparecer en el código o en los tests: los .js de
 * src/, panel.html, panel.css, los .js de test/ (menos este fichero, que
 * citaría lo que busca), los .js y .html de harness/, los .js y .mjs de
 * tools/ y manifest.json. En los dos lados se normaliza CRLF → LF, varios
 * espacios → uno y «salto + espacios» → «salto»; un «\n» escrito en el
 * fragmento vale por un salto.
 *
 * Qué se salta, y por qué:
 * - fragmentos con puntos suspensivos («…» o «...»): son resúmenes;
 * - nombres de fichero o rutas (*.js, *.mjs, *.md, *.html, *.css, *.json);
 * - regex descritas en prosa (empiezan y acaban por «/»);
 * - listas de claves descritas (empiezan por «['»);
 * - esquemas con un hueco «<…>» («setup-<p>-token»).
 *
 * Cómo se busca lo demás:
 * - un identificador suelto (letras, cifras, «_», «$») se busca como palabra
 *   entera;
 * - «#x» (x empieza por letra: «#1234» es un ejemplo de prosa) se busca como
 *   id="x" en panel.html y «.x» como selector en panel.css;
 * - «nombre valor» («source 'jql'», «steps ['SIMPL-12']») describe un
 *   `eq(x.nombre, valor)`: vale una línea del corpus con el nombre como
 *   palabra y el valor;
 * - todo lo demás, literal. Relajaciones documentadas, en este orden: si no
 *   aparece con los espacios normalizados, vale QUITANDO todos los espacios
 *   (§10 escribe «{product:'jira'}» donde el código, formateado, dice
 *   «{ product: 'jira' }»); y vale sobre el corpus SIN barras de escape
 *   (los tests pinan panel.js por regex: «numberedIn\(prose\)» es el
 *   «numberedIn(prose)» que §10 cita, y «'\\[1\\] a'» es «'\[1\] a'»).
 *   Cambian la forma, no los nombres: un pin renombrado o con otros
 *   argumentos sigue cayendo.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const ESTE_FICHERO = 'test/unit/docs.test.js'

/** Lee un fichero del repo con los saltos normalizados a LF. */
function leer(rel) {
  return readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n')
}

function recorrer(dir, acepta, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) recorrer(p, acepta, out)
    else if (acepta(entry)) out.push(p)
  }
  return out
}

/** Los ficheros contra los que se comprueba §10, como rutas relativas con «/». */
export function ficherosDelCorpus() {
  const files = [
    ...recorrer(join(ROOT, 'src'), (n) => n.endsWith('.js')),
    join(ROOT, 'src', 'panel', 'panel.html'),
    join(ROOT, 'src', 'panel', 'panel.css'),
    ...recorrer(join(ROOT, 'test'), (n) => n.endsWith('.js')),
    ...recorrer(join(ROOT, 'harness'), (n) => /\.(js|html)$/.test(n)),
    ...recorrer(join(ROOT, 'tools'), (n) => /\.m?js$/.test(n)),
    join(ROOT, 'manifest.json'),
  ]
  const rel = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))
  return [...new Set(rel)].filter((r) => r !== ESTE_FICHERO)
}

/** Pura: CRLF → LF, varios espacios → uno, «salto + espacios» → «salto». */
export function normalizar(texto) {
  return texto.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n /g, '\n')
}

/** Pura: la sección «## 10.» de un CLAUDE.md, hasta «## 11.»; '' si no está. */
export function seccion10(md) {
  const ini = md.indexOf('\n## 10.')
  if (ini < 0) return ''
  const fin = md.indexOf('\n## 11.', ini + 1)
  return md.slice(ini, fin < 0 ? undefined : fin)
}

/**
 * Pura: los fragmentos entre acentos graves de una sección, en orden y sin
 * repetir. Las vallas «```json» que §10 cita se quitan antes: un acento grave
 * triple no abre ningún fragmento.
 */
export function fragmentosDe(seccion) {
  const sinVallas = seccion.replace(/```[\w-]*/g, ' ')
  const out = []
  for (const m of sinVallas.matchAll(/`([^`\n]+)`/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Pura: por qué NO se comprueba un fragmento, o '' si se comprueba. */
export function motivoParaSaltar(f) {
  if (/…|\.\.\./.test(f)) return 'puntos suspensivos'
  if (/^[\w./-]+\.(m?js|md|html|css|json)$/.test(f)) return 'fichero'
  if (f.length > 1 && f.startsWith('/') && f.endsWith('/')) return 'regex'
  if (f.startsWith("['")) return 'lista de claves'
  if (/<[^<>\s]+>/.test(f)) return 'esquema con hueco'
  return ''
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const palabraEntera = (nombre) => new RegExp('(?<![\\w$])' + escapar(nombre) + '(?![\\w$])')

/**
 * Pura: cómo aparece un fragmento en el corpus: 'id' o 'clase' (en
 * panel.html / panel.css), 'palabra' (identificador suelto, entero),
 * 'nombre-valor' (las dos mitades en una misma línea), 'literal' (con los
 * espacios normalizados), 'sin-espacios' (sólo quitando todos los espacios),
 * 'sin-escapes' (sobre el corpus sin barras de escape) o '' si no aparece.
 * `corpus` es lo que devuelve `corpusDe(...)`.
 */
export function buscar(fragmento, corpus) {
  if (/^#[A-Za-z][\w-]*$/.test(fragmento)) return corpus.html.includes(`id="${fragmento.slice(1)}"`) ? 'id' : ''
  if (/^\.[A-Za-z][\w-]*$/.test(fragmento)) return new RegExp(escapar(fragmento) + '(?![\\w-])').test(corpus.css) ? 'clase' : ''
  if (/^[A-Za-z_$][\w$]*$/.test(fragmento)) return palabraEntera(fragmento).test(corpus.texto) ? 'palabra' : ''
  const par = fragmento.match(/^([A-Za-z_$][\w$]*) (['"\[].*)$/)
  if (par) {
    const nombre = palabraEntera(par[1])
    const valor = par[2].replace(/\s+/g, '')
    return corpus.lineas.some((l) => nombre.test(l) && l.replace(/\s+/g, '').includes(valor)) ? 'nombre-valor' : ''
  }
  const literal = normalizar(fragmento.replace(/\\n/g, '\n'))
  if (corpus.texto.includes(literal)) return 'literal'
  const compacto = literal.replace(/\s+/g, '')
  if (corpus.sinEspacios.includes(compacto)) return 'sin-espacios'
  if (corpus.sinEscapes.includes(literal) || corpus.sinEscapes.replace(/\s+/g, '').includes(compacto)) return 'sin-escapes'
  return ''
}

/** Pura: el corpus con sus variantes, a partir del texto ya concatenado. */
export function corpusDe(texto, { html = '', css = '' } = {}) {
  const normal = normalizar(texto)
  return {
    texto: normal,
    lineas: normal.split('\n'),
    sinEspacios: normal.replace(/\s+/g, ''),
    sinEscapes: normal.replace(/\\(.)/g, '$1'),
    html,
    css,
  }
}

/** El corpus real del repo, leído una vez por ejecución. */
export function corpusDelRepo() {
  return corpusDe(ficherosDelCorpus().map((r) => leer(r)).join('\n'), {
    html: leer('src/panel/panel.html'),
    css: leer('src/panel/panel.css'),
  })
}

/**
 * Pura: los tramos numerados «// N. …» del selfcheck del banco, en el orden
 * en que aparecen, con cuántas comprobaciones `ok(` hace cada uno. Un número
 * puede llevar letra (14b, 28b): variantes de una comprobación, no huecos.
 */
export function tramosDelSelfcheck(js) {
  const ini = js.indexOf('async selfcheck()')
  if (ini < 0) return []
  const fin = js.indexOf('return { passed, total: results.length, results }', ini)
  const cuerpo = js.slice(ini, fin < 0 ? undefined : fin)
  const marcas = [...cuerpo.matchAll(/^[ \t]*\/\/ (\d+[a-z]?)\. /gm)]
  return marcas.map((m, i) => {
    const tramo = cuerpo.slice(m.index, i + 1 < marcas.length ? marcas[i + 1].index : undefined)
    return { n: m[1], comprobaciones: (tramo.match(/\bok\(/g) || []).length }
  })
}

// ---------------------------------------------------------------------------
// Las puras, sobre texto inventado.

test('docs: fragmentosDe saca lo que va entre acentos graves y no tropieza con ```json', () => {
  eq(fragmentosDe('a `x` b ```json y `y`, `x` otra vez y ``` suelto'), ['x', 'y'])
  eq(fragmentosDe('sin nada'), [])
})

test('docs: normalizar deja un espacio y quita la sangría tras el salto', () => {
  eq(normalizar('a   b\r\n    c\t d\n'), 'a b\nc d\n')
})

test('docs: seccion10 corta de «## 10.» a «## 11.»', () => {
  eq(seccion10('x\n## 9. a\n## 10. b\nuno\n## 11. c\ndos'), '\n## 10. b\nuno')
  eq(seccion10('sin secciones'), '')
})

test('docs: motivoParaSaltar reconoce lo que no se comprueba', () => {
  eq(motivoParaSaltar('a … b'), 'puntos suspensivos')
  eq(motivoParaSaltar('foo(...)'), 'puntos suspensivos')
  eq(motivoParaSaltar('panel-wiring.test.js'), 'fichero')
  eq(motivoParaSaltar('test/tdz.js'), 'fichero')
  eq(motivoParaSaltar('/ya estás/'), 'regex')
  eq(motivoParaSaltar("['a','b']"), 'lista de claves')
  eq(motivoParaSaltar('setup-<p>-token'), 'esquema con hueco')
  eq(motivoParaSaltar('/wiki'), '')
  eq(motivoParaSaltar('mcpStatusFor(mcp'), '')
})

test('docs: buscar distingue palabra entera, id, clase, nombre-valor, literal, sin espacios y sin escapes', () => {
  const corpus = corpusDe(
    "const foo = bar(1)\n  mcpStatusFor(list, { status: mcp })\nfoobar\n  eq(plan.source, 'jql')\n  assert(/numberedIn\\(prose\\)/.test(x))\n  eq(n('\\\\[1\\\\] a'), 1)\n  'Ver el ticket #1234 ahora.'\n",
    { html: '<div id="skill">', css: '.badge{} .badge-x{}' }
  )
  eq(buscar('foo', corpus), 'palabra')
  eq(buscar('foobarbaz', corpus), '')
  eq(buscar('bar', corpus), 'palabra')
  eq(buscar('#skill', corpus), 'id')
  eq(buscar('#otro', corpus), '')
  eq(buscar('#1234', corpus), 'literal', 'un «#» seguido de cifras no es un id: es prosa')
  eq(buscar('.badge', corpus), 'clase')
  eq(buscar('.badg', corpus), '')
  eq(buscar("source 'jql'", corpus), 'nombre-valor')
  eq(buscar("source 'respuesta'", corpus), '', 'el valor tiene que estar en la misma línea que el nombre')
  eq(buscar("mode 'jql'", corpus), '', 'y el nombre también')
  eq(buscar('bar(1)', corpus), 'literal')
  eq(buscar('mcpStatusFor(list, {status: mcp})', corpus), 'sin-espacios')
  eq(buscar('mcpStatusFor(list, saved?.mcpName)', corpus), '', 'otros argumentos: no vale')
  eq(buscar('bar(1)\\n mcpStatusFor(list', corpus), 'literal', 'un «\\n» escrito vale por un salto')
  eq(buscar('numberedIn(prose)', corpus), 'sin-escapes', 'lo que el test pina por regex')
  eq(buscar("'\\[1\\] a'", corpus), 'sin-escapes', 'y lo que escribe con la barra doblada')
  eq(buscar('numberedIn(prosa)', corpus), '')
})

test('docs: tramosDelSelfcheck lee «// N. …» y cuenta sus ok(', () => {
  const js = ['  async selfcheck() {', '    // 1. Uno', '    ok(1)', '    // 2b. Dos bis', '    ok(2)', '    ok(3)', '    // 3. Tres sin nada', '    return { passed, total: results.length, results }', '    // 9. Fuera'].join('\n')
  eq(tramosDelSelfcheck(js), [
    { n: '1', comprobaciones: 1 },
    { n: '2b', comprobaciones: 2 },
    { n: '3', comprobaciones: 0 },
  ])
  eq(tramosDelSelfcheck('sin selfcheck'), [])
})

// ---------------------------------------------------------------------------
// Los documentos de verdad.

test('AGENTS.md no se queda atrás de CLAUDE.md', () => {
  const a = leer('AGENTS.md')
  const c = leer('CLAUDE.md')
  assert(a === c || /Lee CLAUDE\.md/.test(a), 'AGENTS.md es una copia exacta de CLAUDE.md o un puntero que dice «Lee CLAUDE.md»')
  if (a !== c) {
    assert(a.trim().split('\n').length <= 6 && !/^## /m.test(a), 'el puntero es corto y no lleva secciones: nada que pueda quedarse atrás')
  }
})

test('§10 de CLAUDE.md no contradice al código', () => {
  const s10 = seccion10(leer('CLAUDE.md'))
  assert(s10.length > 1000, 'CLAUDE.md tiene una sección «## 10.» seguida de «## 11.»')
  const fragmentos = fragmentosDe(s10)
  assert(fragmentos.length > 100, `§10 cita fragmentos entre acentos graves (${fragmentos.length})`)
  const corpus = corpusDelRepo()
  const faltan = []
  let comprobados = 0
  for (const f of fragmentos) {
    if (motivoParaSaltar(f)) continue
    comprobados++
    if (!buscar(f, corpus)) faltan.push(f)
  }
  assert(comprobados > 50, `las reglas de exclusión no se lo comen todo (${comprobados} comprobados)`)
  assert(
    faltan.length === 0,
    `${faltan.length} fragmento(s) de §10 no aparecen en el código ni en los tests (CLAUDE.md va por delante o por detrás):\n     ` +
      faltan.map((f) => '`' + f + '`').join('\n     ')
  )
})

test('el selfcheck del banco numera 1..N sin huecos', () => {
  const tramos = tramosDelSelfcheck(leer('harness/harness.js'))
  const enteros = tramos.map((t) => t.n).filter((n) => /^\d+$/.test(n)).map(Number)
  const max = Math.max(0, ...enteros)
  assert(max >= 40, `llega al menos al 40 (llega al ${max}; el 39 y el 40 son de H2: digest sin scroll interno y Escape)`)
  const huecos = []
  const repetidos = []
  for (let i = 1; i <= max; i++) {
    const veces = enteros.filter((n) => n === i).length
    if (veces === 0) huecos.push(i)
    if (veces > 1) repetidos.push(i)
  }
  eq(huecos, [], 'números sin comprobación: CLAUDE.md los cita por número')
  eq(repetidos, [], 'números repetidos')
  assert(tramos.some((t) => t.n === '28b'), 'la búsqueda de páginas por título es la 28b')
  const vacios = tramos.filter((t) => t.comprobaciones === 0).map((t) => t.n)
  eq(vacios, [], 'cada tramo numerado hace al menos un ok(')
})
