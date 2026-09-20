/**
 * Todo lo que el content script carga está entre los recursos accesibles
 * desde la web, y sólo eso hace falta exponer.
 *
 * bootstrap.js es un script clásico: trae el resto por
 * `import(chrome.runtime.getURL('src/…'))`, y esa carga sólo funciona si la
 * ruta casa con algún patrón de `web_accessible_resources` del manifest; los
 * `import` estáticos de esos módulos (runner.js → overlay/overlay.js →
 * styles.js, shared/digest.js → content/anchor-match.js…) también, porque
 * Chrome los pide por URL uno a uno. Un módulo nuevo importado desde una
 * carpeta no expuesta no falla en Node ni en el banco (que importa por ruta
 * relativa): falla en Chrome, en silencio, cuando el panel manda el primer
 * mensaje. En la auditoría de 2026-09-13 (docs/PLAN.md S7) se decidió exponer
 * además `src/atlassian/*.js` y `src/nav/*.js` (los módulos REST de H7 los
 * importarán desde el content script) y, por seguridad, `use_dynamic_url`
 * (pinado en test/manifest.js, que corre como paso 3 de `npm run check`; aquí
 * se comprueba que esa barrera muerde). Esta prueba vigila que lo alcanzable
 * siga bajo rutas expuestas, hoy y cuando H7 añada módulos.
 *
 * El glob es el simple: `*` casa UN segmento sin `/` (Chrome es más laxo; si
 * casa aquí, casa allí). Por eso `src/content/*.js` no cubre `overlay/`.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative, posix } from 'node:path'
import { tmpdir } from 'node:os'
import { listJsFiles } from '../syntax.js'
import { checkManifest } from '../manifest.js'

const ROOT = join(import.meta.dirname, '..', '..')
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/')
const leerDelRepo = (ruta) => (existsSync(join(ROOT, ruta)) ? readFileSync(join(ROOT, ruta), 'utf8') : null)

// ---------------------------------------------------------------------------
// Puro sobre el texto: qué carga bootstrap.js, qué importa cada módulo, qué
// patrón casa. Probado con ficheros inventados más abajo.
// ---------------------------------------------------------------------------

/** Quita comentarios: un import citado en un comentario no se carga. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
}

/** Un patrón de `resources` como regex: `*` = un segmento sin `/`. */
function globARegex(patron) {
  const escapado = String(patron)
    .split('*')
    .map((trozo) => trozo.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp('^' + escapado + '$')
}

/** Si la ruta (relativa a la raíz, con barras) la expone algún patrón. */
function expuesta(ruta, patrones) {
  return patrones.some((p) => globARegex(p).test(ruta))
}

/** Lo que bootstrap.js pide por `import(url('src/…'))`, sin repetir y en orden. */
function cargasDeBootstrap(src) {
  const out = []
  for (const m of sinComentarios(src).matchAll(/url\(\s*['"](src\/[^'"]+)['"]\s*\)/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/**
 * Los módulos del repo que importa un fichero, resueltos contra su ruta:
 * `import … from './x.js'` (una o varias líneas, con alias, `* as`, sólo
 * efectos), `export … from './x.js'` y `import('./x.js')` con literal. Lo
 * que no es relativo (`node:`, `https:`, paquetes) no es un fichero nuestro
 * y no cuenta. Sin repetir y en orden de aparición.
 */
function importsDe(src, desde) {
  const texto = sinComentarios(src)
  const specs = []
  for (const m of texto.matchAll(/\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specs.push(m[1])
  for (const m of texto.matchAll(/\bexport\s+(?:\*|\{[^{}]*\})\s*(?:as\s+[\w$]+\s+)?from\s+['"]([^'"]+)['"]/g)) specs.push(m[1])
  for (const m of texto.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1])
  const out = []
  for (const spec of specs) {
    const limpio = spec.replace(/[?#].*$/, '')
    if (!/^\.\.?\//.test(limpio)) continue
    const ruta = posix.normalize(posix.join(posix.dirname(desde), limpio))
    if (!out.includes(ruta)) out.push(ruta)
  }
  return out
}

/**
 * Cierre transitivo desde unas entradas: `ficheros` (ordenados) es todo lo
 * que Chrome acabaría pidiendo por URL, `faltan` lo que alguien importa y no
 * existe (con quién lo pide). `leer(ruta)` da el texto o null si no existe.
 */
function alcanzables(entradas, leer) {
  const vistos = new Set()
  const faltan = []
  const cola = entradas.map((ruta) => ({ ruta, desde: null }))
  while (cola.length) {
    const { ruta, desde } = cola.shift()
    if (vistos.has(ruta)) continue
    const texto = leer(ruta)
    if (texto == null) {
      faltan.push(desde ? `${ruta} (lo importa ${desde})` : `${ruta} (entrada)`)
      continue
    }
    vistos.add(ruta)
    for (const hijo of importsDe(texto, ruta)) cola.push({ ruta: hijo, desde: ruta })
  }
  return { ficheros: [...vistos].sort(), faltan }
}

// ---------------------------------------------------------------------------
// El repo real.
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const patrones = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])
const contentScripts = (manifest.content_scripts || []).flatMap((cs) => cs.js || [])
const entradas = contentScripts.flatMap((cs) => cargasDeBootstrap(leerDelRepo(cs) || ''))
const alcance = alcanzables(entradas, leerDelRepo)

test('el content script del manifest es bootstrap.js y carga sus módulos por url(\'src/…\'): runner, messages, config, picker…', () => {
  eq(contentScripts, ['src/content/bootstrap.js'])
  for (const esperado of [
    'src/content/runner.js',
    'src/shared/messages.js',
    'src/shared/config.js',
    'src/content/picker.js',
    'src/shared/confluence-rest.js',
    // H7: el content script es quien pide a la API del sitio, así que carga
    // también el módulo REST de Jira y site.js (de donde saca la ruta de
    // contexto de ESTA pestaña).
    'src/shared/jira-rest.js',
    'src/atlassian/site.js',
  ]) {
    assert(entradas.includes(esperado), `bootstrap.js ya no carga ${esperado} con url('src/…'): ¿cambió la forma del import()?`)
  }
})

test('todo lo que alcanza el content script existe y casa con algún patrón de web_accessible_resources', () => {
  eq(alcance.faltan, [], 'importado y sin fichero')
  // Que el recorrido sea transitivo de verdad: estos no los carga bootstrap.js,
  // llegan por los imports estáticos de otros. Desde H7, también el cimiento
  // REST: confluence-rest.js importa `getJson` de shared/rest-get.js y
  // `validSpaceKey` de atlassian/site.js, así que Chrome los pide por URL y
  // tienen que estar expuestos aunque bootstrap.js no los nombre.
  for (const hondo of [
    'src/content/overlay/styles.js',
    'src/content/anchor-match.js',
    'src/content/pick-payload.js',
    'src/shared/rest-get.js',
    'src/atlassian/site.js',
  ]) {
    assert(alcance.ficheros.includes(hondo), `${hondo} debería alcanzarse por imports transitivos`)
  }
  const fuera = alcance.ficheros.filter((f) => !expuesta(f, patrones))
  eq(fuera, [], 'lo carga el content script pero ningún patrón del manifest lo expone: Chrome lo bloquearía')
})

test('SEGURIDAD DEL TEST: sin src/shared/*.js quedarían fuera config.js, messages.js y confluence-rest.js (la prueba muerde)', () => {
  const sinShared = patrones.filter((p) => p !== 'src/shared/*.js')
  assert(sinShared.length === patrones.length - 1, 'el manifest expone src/shared/*.js con ese patrón exacto')
  const fuera = alcance.ficheros.filter((f) => !expuesta(f, sinShared))
  for (const f of ['src/shared/config.js', 'src/shared/messages.js', 'src/shared/confluence-rest.js', 'src/shared/rest-get.js', 'src/shared/jira-rest.js']) {
    assert(fuera.includes(f), `${f} tendría que quedar fuera sin src/shared/*.js`)
  }
  // Y sin src/atlassian/*.js (el patrón que H2 dejó puesto pensando en H7)
  // quedaría fuera site.js, que ahora llega por confluence-rest.js.
  const sinAtlassian = patrones.filter((p) => p !== 'src/atlassian/*.js')
  assert(
    alcance.ficheros.filter((f) => !expuesta(f, sinAtlassian)).includes('src/atlassian/site.js'),
    'site.js tendría que quedar fuera sin src/atlassian/*.js'
  )
})

test('el manifest expone src/atlassian/*.js y src/nav/*.js (los módulos REST de H7 se importarán desde el content script), y cada patrón casa con algún fichero real', () => {
  for (const p of ['src/content/*.js', 'src/content/overlay/*.js', 'src/shared/*.js', 'src/atlassian/*.js', 'src/nav/*.js']) {
    assert(patrones.includes(p), `falta el patrón ${p} en web_accessible_resources`)
  }
  const reales = listJsFiles(ROOT).map(rel)
  const vacios = patrones.filter((p) => !reales.some((f) => globARegex(p).test(f)))
  eq(vacios, [], 'patrones que no casan con ningún fichero del repo (¿errata?)')
  // Y nada del panel, del service worker ni de opencode: la página no los necesita.
  const deMas = reales.filter((f) => /^src\/(panel|background|opencode)\//.test(f) && expuesta(f, patrones))
  eq(deMas, [], 'expuesto sin que el content script lo cargue')
})

// ---------------------------------------------------------------------------
// La regla en sí, con ficheros inventados.
// ---------------------------------------------------------------------------

test('el glob simple: * es un segmento sin /, y src/content/*.js no cubre overlay/', () => {
  eq(expuesta('src/shared/config.js', ['src/shared/*.js']), true)
  eq(expuesta('src/content/overlay/overlay.js', ['src/content/*.js']), false)
  eq(expuesta('src/content/overlay/overlay.js', ['src/content/overlay/*.js']), true)
  eq(expuesta('src/shared/config.mjs', ['src/shared/*.js']), false)
  eq(expuesta('src/shared/config.js', ['src/shared/*.json']), false)
  eq(expuesta('src/shared/config.js', []), false)
  eq(expuesta('src/shared/x.js', ['src/shared/*']), true)
  eq(expuesta('srcXshared/x.js', ['src/shared/*.js']), false)
  eq(expuesta('src/sharedXx.js', ['src/shared/*.js']), false)
  // El punto es literal, no «cualquier carácter».
  eq(expuesta('src/shared/configxjs', ['src/shared/*.js']), false)
})

test('cargasDeBootstrap: sólo los url(\'src/…\') de verdad, sin repetir y fuera de comentarios', () => {
  const src = [
    "const url = (p) => chrome.runtime.getURL(p)",
    "// import(url('src/content/no.js'))",
    "/* import(url('src/content/tampoco.js')) */",
    "const [{ A }, { B }] = await Promise.all([import(url('src/content/a.js')), import(url(\"src/shared/b.js\"))])",
    "import(url('src/content/a.js')).then(() => {})",
    "const p = url( 'src/content/c.js' )",
    "chrome.runtime.getURL('src/assets/icon.png')",
  ].join('\n')
  eq(cargasDeBootstrap(src), ['src/content/a.js', 'src/shared/b.js', 'src/content/c.js'])
})

test('importsDe: estáticos (una y varias líneas, alias, * as, sólo efectos), export … from, import() literal; nada de node:, https: ni paquetes', () => {
  const src = [
    "import { a, b as c } from './uno.js'",
    "import D from '../dos.js'",
    'import {',
    '  x,',
    '  y,',
    "} from './sub/tres.js'",
    "import * as N from './cuatro.js'",
    "import './cinco.js'",
    "import { z } from './uno.js' // repetido",
    "export { q } from './seis.js'",
    "export * from './siete.js'",
    "export * as S from './ocho.js'",
    "const m = await import('./nueve.js')",
    "import('./diez.js?probe=1').then(() => {})",
    "import { readFileSync } from 'node:fs'",
    "import x from 'https://cdn/x.js'",
    "import y from 'paquete'",
    "// import { no } from './comentado.js'",
    "/* import { no } from './comentado2.js' */",
    "const s = 'import { no } from ./cadena.js'",
  ].join('\n')
  eq(importsDe(src, 'src/content/mod.js'), [
    'src/content/uno.js',
    'src/dos.js',
    'src/content/sub/tres.js',
    'src/content/cuatro.js',
    'src/content/cinco.js',
    'src/content/seis.js',
    'src/content/siete.js',
    'src/content/ocho.js',
    'src/content/nueve.js',
    'src/content/diez.js',
  ])
  eq(importsDe("import { a } from '../shared/config.js'", 'src/content/runner.js'), ['src/shared/config.js'])
  eq(importsDe("import { n } from '../content/anchor-match.js'", 'src/shared/digest.js'), ['src/content/anchor-match.js'])
  eq(importsDe('', 'src/a.js'), [])
})

test('alcanzables sigue los imports transitivos, no repite, y apunta lo que no existe con quién lo pide', () => {
  const disco = new Map([
    ['src/content/a.js', "import { b } from './b.js'\nimport { s } from '../shared/s.js'"],
    ['src/content/b.js', "import { c } from './sub/c.js'\nimport { a } from './a.js'"],
    ['src/content/sub/c.js', "import { s } from '../../shared/s.js'"],
    ['src/shared/s.js', "import { f } from '../nav/falta.js'"],
    ['src/content/suelto.js', 'export const nada = 1'],
  ])
  const leer = (ruta) => (disco.has(ruta) ? disco.get(ruta) : null)
  eq(alcanzables(['src/content/a.js', 'src/content/a.js'], leer), {
    ficheros: ['src/content/a.js', 'src/content/b.js', 'src/content/sub/c.js', 'src/shared/s.js'],
    faltan: ['src/nav/falta.js (lo importa src/shared/s.js)'],
  })
  eq(alcanzables(['src/content/inexistente.js'], leer), { ficheros: [], faltan: ['src/content/inexistente.js (entrada)'] })
  eq(alcanzables([], leer), { ficheros: [], faltan: [] })
})

test('SEGURIDAD: checkManifest rechaza una entrada de web_accessible_resources sin use_dynamic_url y acepta la que lo lleva', () => {
  // Un manifest mínimo con la key REAL (para que el id derivado sea el de config.js)
  // en un directorio temporal: lo único que varía es use_dynamic_url.
  const minimo = (war) => ({
    manifest_version: 3,
    name: 'x',
    version: '1.0.0',
    description: 'x',
    permissions: ['sidePanel', 'storage', 'tabs', 'scripting'],
    host_permissions: ['http://127.0.0.1/*'],
    web_accessible_resources: war,
    key: manifest.key,
  })
  const dir = mkdtempSync(join(tmpdir(), 'faro-war-'))
  try {
    const errores = (war) => {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(minimo(war)))
      return checkManifest(dir).errors
    }
    const sin = errores([{ resources: ['src/content/*.js'], matches: ['https://*/*'] }])
    eq(sin.length, 1)
    assert(/SEGURIDAD.*use_dynamic_url/.test(sin[0]), sin[0])
    const falso = errores([{ resources: ['src/content/*.js'], matches: ['https://*/*'], use_dynamic_url: false }])
    eq(falso.length, 1)
    const segunda = errores([
      { resources: ['src/content/*.js'], matches: ['https://*/*'], use_dynamic_url: true },
      { resources: ['src/shared/*.js'], matches: ['https://*/*'] },
    ])
    eq(segunda.length, 1)
    assert(/\[1\]/.test(segunda[0]), 'señala la entrada que falla')
    eq(errores([{ resources: ['src/content/*.js'], matches: ['https://*/*'], use_dynamic_url: true }]), [])
    eq(errores([]), ['falta web_accessible_resources: el content script carga sus módulos por import()'])
    const vacia = errores([{ resources: [], matches: ['https://*/*'], use_dynamic_url: true }])
    eq(vacia.length, 1)
    assert(/resources.*matches/.test(vacia[0]), vacia[0])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('el manifest real pasa checkManifest y lleva use_dynamic_url en todas sus entradas', () => {
  eq(checkManifest(ROOT).errors, [])
  assert(manifest.web_accessible_resources.every((w) => w.use_dynamic_url === true))
})
