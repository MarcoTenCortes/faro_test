/**
 * Pruebas de tools/check-docs.mjs: la deriva docs ↔ código como paso 5 de
 * `npm run check`. Las puras se prueban con fixtures de texto pequeñas; la
 * prueba de humo del final lee el repo de verdad para comprobar que el paso
 * entero corre y que el número de pruebas del README es coherente consigo mismo.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STRICT,
  MSG_SIN_EMISOR_HASTA,
  pendingSenders,
  stripComments,
  readmeTestCount,
  logTitles,
  logTitleSites,
  documentedTitles,
  msgConstants,
  msgHandlers,
  msgInDocs,
  sectionOf,
  mapBlock,
  srcFilesInMap,
  docTestCounts,
  testCountMismatches,
  checkDocs,
  formatReport,
} from '../../tools/check-docs.mjs'

const ROOT = join(import.meta.dirname, '..', '..')

// ---------------------------------------------------------------------------
// STRICT
// ---------------------------------------------------------------------------

test('check-docs: STRICT gobierna títulos, mensajes y ficheros con un booleano cada uno', () => {
  eq(Object.keys(STRICT).sort(), ['files', 'msgs', 'titles'])
  for (const v of Object.values(STRICT)) assert(typeof v === 'boolean', 'cada entrada de STRICT es true o false')
})

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

const FUENTE = [
  "import { log } from '../shared/log.js'",
  '// log.error(\'En comentario de línea\')',
  '/* log.warn(\'En comentario',
  "   de bloque\') */",
  "const url = 'https://x.y/z' // log.ok('Tras la url, comentado')",
  "log.warn('Sin marcas', 'la razón')",
  'log.ok("Con dobles", detalle)',
  'log.info(`Plantilla ${x}`, y)',
  'log.error(titulo, detalle)',
  'log.info(',
  "  'Marcas conservadas',",
  "  `${n} marcas · 'seguimiento'`",
  ')',
  "log.warn('Sin marcas', 'otra razón')",
  "log.ok('Con \\'escape\\'', 1)",
  "log.debug('Depuración', 2)",
].join('\n')

test('stripComments quita los comentarios y conserva cada salto de línea', () => {
  const limpio = stripComments(FUENTE)
  eq(limpio.split('\n').length, FUENTE.split('\n').length, 'mismo número de líneas')
  assert(!limpio.includes('En comentario'), 'los comentarios de línea y de bloque desaparecen')
  assert(limpio.includes("'https://x.y/z'"), 'un // dentro de una cadena no es comentario')
  assert(!limpio.includes('Tras la url'), 'el comentario tras la cadena sí se quita')
  eq(stripComments('a\r\nb'), 'a\nb', 'CRLF se normaliza')
  eq(stripComments(null), '', 'sin texto, cadena vacía')
})

// ---------------------------------------------------------------------------
// readmeTestCount
// ---------------------------------------------------------------------------

test('readmeTestCount lee el N de «N pruebas unitarias»', () => {
  eq(readmeTestCount('… 540 pruebas unitarias'), 540)
  eq(readmeTestCount('npm run check              # sintaxis + orden + manifest + 549 pruebas unitarias'), 549)
  eq(readmeTestCount(''), null)
  eq(readmeTestCount('- README línea «npm run check … N pruebas unitarias»: actualizar el número.'), null, 'una N literal no es un número')
})

test('readmeTestCount prefiere la línea de npm run check a cualquier otra mención', () => {
  const md = ['Antes había 12 pruebas unitarias.', '```bash', 'npm run check   # sintaxis + 540 pruebas unitarias', '```', 'Hoy 999 pruebas unitarias más.'].join(
    '\n'
  )
  eq(readmeTestCount(md), 540)
  eq(readmeTestCount('Hoy 12 pruebas unitarias y luego 13 pruebas unitarias'), 12, 'sin esa línea, la primera aparición')
})

// ---------------------------------------------------------------------------
// logTitles / logTitleSites
// ---------------------------------------------------------------------------

test('logTitles saca los títulos literales de log.(ok|info|warn|error) y no los de comentarios ni plantillas', () => {
  eq(logTitles(FUENTE), ['Sin marcas', 'Con dobles', 'Marcas conservadas', "Con 'escape'"])
})

test('logTitleSites da la línea del literal, también cuando el título va en la línea siguiente', () => {
  eq(logTitleSites(FUENTE), [
    { title: 'Sin marcas', line: 6 },
    { title: 'Con dobles', line: 7 },
    { title: 'Marcas conservadas', line: 11 },
    { title: 'Sin marcas', line: 14 },
    { title: "Con 'escape'", line: 15 },
  ])
  eq(logTitleSites(''), [])
  eq(logTitles(undefined), [])
})

test('logTitles: un título en una plantilla o en una variable no cuenta, log.debug tampoco', () => {
  eq(logTitles("log.info(`Plantilla ${x}`)\nlog.error(t)\nlog.debug('Depuración')"), [])
})

// ---------------------------------------------------------------------------
// documentedTitles
// ---------------------------------------------------------------------------

test('documentedTitles reconoce «Título» en INSTALL y CLAUDE, plegando saltos de línea y sin repetir', () => {
  const md = [
    'En el **registro** queda «Sin marcas» con la razón, o',
    '«Sin anclar»; «Numeración',
    '   adaptada» cuenta cómo se recuperó. Y otra vez «Sin marcas».',
    'Si dice «El MCP «nombre» está registrado pero en «failed»», ese bloque falla.',
  ].join('\n')
  eq(documentedTitles(md), ['Sin marcas', 'Sin anclar', 'Numeración adaptada', 'nombre', 'failed'])
  eq(documentedTitles(''), [])
  eq(documentedTitles(null), [])
})

// ---------------------------------------------------------------------------
// msgConstants / msgHandlers / msgInDocs
// ---------------------------------------------------------------------------

const MESSAGES = [
  '/** Tipos de mensaje. */',
  'export const MSG = {',
  '  // panel -> service worker',
  "  START_PLAN: 'faro:start-plan',",
  "  PAGE_DIGEST: 'faro:page-digest',",
  "  // OLVIDADO: 'faro:olvidado',",
  "  SIN_NADIE: 'faro:sin-nadie',",
  "  SOLO_ATENDIDO: 'faro:solo-atendido',",
  '}',
  'export async function sendToTab(tabId, message) {}',
].join('\n')

const BOOTSTRAP = [
  'switch (msg.type) {',
  '  case MSG.PAGE_DIGEST: {',
  '    return { ok: true }',
  '  }',
  '  case MSG.SOLO_ATENDIDO:',
  '    return { ok: true }',
  '  // case MSG.SIN_NADIE: comentado, no cuenta',
  '  default:',
  '}',
].join('\n')

const SW = "chrome.runtime.onMessage.addListener((msg) => { if (msg.type === MSG.START_PLAN) start() })"
const PANEL = "await chrome.tabs.sendMessage(tabId, { type: MSG.PAGE_DIGEST }).catch(() => null)"

test('msgConstants lista las claves de MSG en orden, sin las comentadas', () => {
  eq(msgConstants(MESSAGES), ['START_PLAN', 'PAGE_DIGEST', 'SIN_NADIE', 'SOLO_ATENDIDO'])
  eq(msgConstants('export const OTRA = {}'), [])
  eq(msgConstants(''), [])
})

test('msgHandlers distingue receptor de emisor: quien manda `{ type: MSG.X }` no lo atiende', () => {
  eq(msgHandlers({ messagesJs: MESSAGES, bootstrapJs: BOOTSTRAP, swJs: SW, panelJs: PANEL }), [
    { name: 'START_PLAN', handled: true, sent: false, where: ['service-worker'] },
    { name: 'PAGE_DIGEST', handled: true, sent: true, where: ['bootstrap'] },
    { name: 'SIN_NADIE', handled: false, sent: false, where: [] },
    { name: 'SOLO_ATENDIDO', handled: true, sent: false, where: ['bootstrap'] },
  ])
})

test('msgHandlers: bootstrap sin `case` y el panel mandándolo con sendToTab → sin receptor, con emisor', () => {
  // La revisión de H1: quitar el `case` de bootstrap.js de un mensaje
  // panel → content no se notaba porque «aparecer en panel.js» contaba como
  // manejador. Ahora el panel que lo manda es emisor, y sin `case` no hay
  // receptor.
  const r = msgHandlers({
    messagesJs: MESSAGES,
    bootstrapJs: 'switch (msg.type) { default: }',
    swJs: '',
    panelJs: 'await sendToTab(1, { type: MSG.PAGE_DIGEST })',
  })
  eq(r[1], { name: 'PAGE_DIGEST', handled: false, sent: true, where: [] })
})

test('msgHandlers: `case MSG.X` en el service worker es receptor; `type: MSG.X` en él es emisor', () => {
  const sw = ['switch (msg.type) {', '  case MSG.START_PLAN:', '    sendToTab(1, { type: MSG.PAGE_DIGEST })', '}'].join('\n')
  const r = msgHandlers({ messagesJs: MESSAGES, bootstrapJs: '', swJs: sw, panelJs: '' })
  eq(r[0], { name: 'START_PLAN', handled: true, sent: false, where: ['service-worker'] })
  eq(r[1], { name: 'PAGE_DIGEST', handled: false, sent: true, where: [] })
})

test('msgHandlers: en el panel, `msg?.type === MSG.X` (en cualquier orden) es receptor y no emisor', () => {
  const panel = ['function onRuntimeMessage(msg) {', '  if (msg?.type === MSG.START_PLAN) return', '  if (MSG.PAGE_DIGEST === msg.type) return', '}'].join('\n')
  const r = msgHandlers({ messagesJs: MESSAGES, bootstrapJs: '', swJs: '', panelJs: panel })
  eq(r[0], { name: 'START_PLAN', handled: true, sent: false, where: ['panel'] })
  eq(r[1], { name: 'PAGE_DIGEST', handled: true, sent: false, where: ['panel'] })
})

test('msgHandlers: un `MSG.X` sin `case` en bootstrap no cuenta como manejador allí, pero sí como emisor', () => {
  const r = msgHandlers({ messagesJs: MESSAGES, bootstrapJs: 'send({ type: MSG.START_PLAN })', swJs: '', panelJs: '' })
  eq(r[0], { name: 'START_PLAN', handled: false, sent: true, where: [] })
})

test('msgHandlers reconoce las formas reales de mandar: `type:` en varias líneas, sendMessage(MSG.X y el ternario de runPlan', () => {
  const panel = [
    'chrome.runtime.sendMessage({',
    '  type: MSG.PAGE_DIGEST,',
    '  tabId,',
    '})',
    'const type = asistida ? MSG.START_PLAN : MSG.SIN_NADIE',
    'await chrome.runtime.sendMessage({ type })',
    'port.postMessage(MSG.SOLO_ATENDIDO)',
  ].join('\n')
  const r = msgHandlers({ messagesJs: MESSAGES, bootstrapJs: '', swJs: '', panelJs: panel })
  eq(
    r.map((h) => [h.name, h.sent]),
    [
      ['START_PLAN', true],
      ['PAGE_DIGEST', true],
      ['SIN_NADIE', true],
      ['SOLO_ATENDIDO', true],
    ]
  )
  eq(r.map((h) => h.handled), [false, false, false, false], 'ninguna de esas formas atiende nada')
})

// ---------------------------------------------------------------------------
// MSG_SIN_EMISOR_HASTA / pendingSenders (H7: el cimiento REST nace sin UI)
// ---------------------------------------------------------------------------

/** Un mensaje que espera su hito, tal como lo ve `msgHandlers`: atendido y sin nadie que lo mande. */
const ATENDIDOS = (nombres) => nombres.map((name) => ({ name, handled: true, sent: false, where: ['bootstrap'] }))

test('MSG_SIN_EMISOR_HASTA nombra los mensajes que esperan su hito, y sólo encoge', () => {
  // De los cinco que sembró H7 ya faltan tres: `attachJqlResults` manda
  // JQL_SEARCH y `loadSearchChipSources` FAVOURITE_FILTERS desde H8, y
  // `restIndexFor` manda SPACE_PAGES desde H9. Dejarlos aquí sería ERROR («ya
  // lo manda alguien»). La lista no puede crecer sin que el hito que la toca lo
  // escriba.
  eq(MSG_SIN_EMISOR_HASTA, {
    RECENT_ISSUES: 'H11',
    RECENT_PAGES: 'H11',
  })
  for (const cableado of ['JQL_SEARCH', 'FAVOURITE_FILTERS', 'SPACE_PAGES']) {
    assert(!(cableado in MSG_SIN_EMISOR_HASTA), `ya está cableado: ${cableado} tenía que salir de la lista`)
  }
  for (const hito of Object.values(MSG_SIN_EMISOR_HASTA)) assert(/^H\d+$/.test(hito), 'cada entrada dice a qué hito espera: ' + hito)
})

test('pendingSenders: el de la lista es NOTA con su hito y el que no está sigue siendo AVISO', () => {
  const r = pendingSenders([...ATENDIDOS(['JQL_SEARCH']), { name: 'HUERFANO', handled: true, sent: false, where: ['panel', 'service-worker'] }], {
    JQL_SEARCH: 'H8',
  })
  eq(r.errors, [])
  eq(r.notes, ['MSG.JQL_SEARCH: lo atiende bootstrap.js y todavía nadie lo manda (lo cablea H8)'])
  eq(r.warnings.length, 1)
  assert(/^MSG\.HUERFANO: lo atiende panel\.js y service-worker\.js y nadie lo manda/.test(r.warnings[0]), r.warnings[0])
})

test('pendingSenders: un mensaje con emisor no sale por ningún lado, y uno sin receptor tampoco', () => {
  const r = pendingSenders(
    [
      { name: 'START_PLAN', handled: true, sent: true, where: ['service-worker'] },
      { name: 'SIN_NADIE', handled: false, sent: false, where: [] },
    ],
    {}
  )
  eq(r, { notes: [], warnings: [], errors: [] })
  eq(pendingSenders([], {}), { notes: [], warnings: [], errors: [] })
  eq(pendingSenders(null, null), { notes: [], warnings: [], errors: [] }, 'sin datos, nada que decir')
})

test('pendingSenders: la lista sólo puede encoger — un nombre que YA tiene emisor, o que ya no es mensaje, es ERROR', () => {
  // H8 cablea el botón que manda JQL_SEARCH: a partir de ahí, tenerlo en la
  // lista taparía para siempre el aviso que la justifica.
  const cableado = pendingSenders([{ name: 'JQL_SEARCH', handled: true, sent: true, where: ['bootstrap'] }], { JQL_SEARCH: 'H8' })
  eq(cableado.notes, [])
  eq(cableado.warnings, [])
  eq(cableado.errors.length, 1)
  assert(/ya lo manda alguien/.test(cableado.errors[0]) && /bórralo de MSG_SIN_EMISOR_HASTA/.test(cableado.errors[0]), cableado.errors[0])

  const borrado = pendingSenders(ATENDIDOS(['OTRO']), { YA_NO_EXISTE: 'H9' })
  eq(borrado.errors.length, 1)
  assert(/ya no es un mensaje/.test(borrado.errors[0]) && /bórralo de la lista/.test(borrado.errors[0]), borrado.errors[0])
  eq(borrado.warnings.length, 1, 'y el que no está en la lista sigue avisando')
})

test('msgHandlers: los comentarios no cuentan ni como receptor ni como emisor', () => {
  const r = msgHandlers({
    messagesJs: MESSAGES,
    bootstrapJs: '// case MSG.START_PLAN:\n/* sendToTab(1, { type: MSG.PAGE_DIGEST }) */',
    swJs: '// if (msg.type === MSG.START_PLAN)',
    panelJs: '',
  })
  eq(r[0], { name: 'START_PLAN', handled: false, sent: false, where: [] })
  eq(r[1], { name: 'PAGE_DIGEST', handled: false, sent: false, where: [] })
})

const CLAUDE = [
  '# Faro',
  '## 4. Flujos',
  'Se manda `MSG.OTRO_MENSAJE` al content script.',
  '## 5. Mensajería (`src/shared/messages.js`)',
  '- panel → SW: START_PLAN, CANCEL_PLAN.',
  '- panel → content: PAGE_DIGEST (→ `{ok, text}`), PAGE_ANCESTORS/PAGE_SEARCH. En un Jira DC no se mandan.',
  '- El content script sólo acepta tipos que empiezan por `faro:`.',
  '## 6. Contratos',
  'FOO_BAR no es un mensaje.',
].join('\n')

test('msgInDocs devuelve los nombres que nombra §5 y nada de otras secciones', () => {
  eq(msgInDocs(CLAUDE), ['START_PLAN', 'CANCEL_PLAN', 'PAGE_DIGEST', 'PAGE_ANCESTORS', 'PAGE_SEARCH'])
  eq(msgInDocs('## 4. Flujos\nMSG.PAGE_DIGEST'), [], 'sin §5, nada')
  eq(msgInDocs(''), [])
})

test('sectionOf corta en el siguiente encabezado de nivel 2', () => {
  eq(sectionOf(CLAUDE, 5).split('\n').length, 4)
  eq(sectionOf(CLAUDE, 6), '## 6. Contratos\nFOO_BAR no es un mensaje.')
  eq(sectionOf(CLAUDE, 9), '')
})

// ---------------------------------------------------------------------------
// mapBlock / srcFilesInMap
// ---------------------------------------------------------------------------

const MAPA = [
  '## 2. Arrancar',
  '```bash',
  'npm run check',
  '```',
  '## 3. Mapa de ficheros',
  '',
  '```',
  'manifest.json                 MV3',
  'src/panel/                    el panel lateral',
  '  panel.js (~2500)            estado, pantallas',
  '  panel.html / panel.css      pantallas',
  '  runner.js (NavRunner)       executeStep',
  '  overlay/overlay.js          Shadow DOM',
  'src/background/service-worker.js  orquestador',
  'src/shared/models.js · log.js · format.js',
  'src/content/                  vive en la página; la forma del árbol se decide en tree-dom.js',
  'harness/                      index.html + harness.js',
  '```',
  '## 4. Flujos',
  '`src/panel/fantasma.js` sólo se nombra aquí, fuera del mapa.',
].join('\n')

test('mapBlock devuelve el bloque de código de §3 y no el de §2', () => {
  assert(mapBlock(MAPA).startsWith('manifest.json'), 'empieza por la primera línea del mapa')
  assert(!mapBlock(MAPA).includes('npm run check'), 'el bloque bash de §2 no es el mapa')
  eq(mapBlock('## 3. Mapa\nsin bloque'), '')
})

test('srcFilesInMap detecta un fichero fuera de §3 y resuelve nombres sueltos contra su directorio', () => {
  const files = [
    'src/panel/panel.js',
    'src/panel/runner.js',
    'src/panel/overlay/overlay.js',
    'src/background/service-worker.js',
    'src/shared/models.js',
    'src/shared/log.js',
    'src/shared/format.js',
    'src/content/tree-dom.js',
    'src/panel/nuevo.js',
    'src/panel/fantasma.js',
    'src/shared/panel.js',
  ]
  eq(srcFilesInMap(MAPA, files), ['src/panel/fantasma.js', 'src/panel/nuevo.js', 'src/shared/panel.js'])
})

test('srcFilesInMap: sin §3 o sin bloque, todo está fuera del mapa', () => {
  eq(srcFilesInMap('# Nada', ['src/b.js', 'src/a.js']), ['src/a.js', 'src/b.js'])
  eq(srcFilesInMap(MAPA, []), [])
  eq(srcFilesInMap(MAPA, ['src\\panel\\panel.js']), [], 'las barras de Windows se normalizan')
})

// ---------------------------------------------------------------------------
// docTestCounts / testCountMismatches
// ---------------------------------------------------------------------------

const DIEZ = [
  '# Faro',
  '## 9. Convenciones',
  '- `viejo.test.js` (H0; 99 pruebas) no está en §10 y no cuenta.',
  '## 10. Lo que los tests pinan',
  '- `a.test.js` (H1; 3 pruebas con fixtures inline): lo que sea.',
  '- `b.test.js` (H1, 2026-09-13; 12 pruebas; `fetch` sustituido, muere al `disconnect()` y sigue): más cosas.',
  '- `c.test.js` (rutas canónicas, H1; 7 pruebas más): añadidas en H1, no se pueden comprobar.',
  '- `d.test.js` (Jira): sin número, no cuenta. `e.test.js`: sin paréntesis, tampoco.',
  '- `f.test.js` (`waitForMcpReady`, H1; 4 pruebas más; cliente falso): tampoco.',
  '- `a.test.js` (otra mención, H1; 3 pruebas): el mismo fichero dos veces se comprueba dos veces.',
  '- README y §2, línea «npm run check … N pruebas unitarias»: una N literal no es un número.',
  '## 11. Cómo añadir cosas',
  '- `z.test.js` (H1; 5 pruebas) fuera de §10 no cuenta.',
].join('\n')

test('docTestCounts lee de §10 cada «`x.test.js` (…; N pruebas» con su línea y si son «más»', () => {
  eq(docTestCounts(DIEZ), [
    { file: 'a.test.js', count: 3, added: false, line: 5 },
    { file: 'b.test.js', count: 12, added: false, line: 6 },
    { file: 'c.test.js', count: 7, added: true, line: 7 },
    { file: 'f.test.js', count: 4, added: true, line: 9 },
    { file: 'a.test.js', count: 3, added: false, line: 10 },
  ])
  eq(docTestCounts('## 9. Nada\n- `a.test.js` (H1; 3 pruebas)'), [], 'sin §10, nada')
  eq(docTestCounts(''), [])
  eq(docTestCounts(DIEZ.replace(/\n/g, '\r\n'))[1].line, 6, 'CRLF no mueve las líneas')
})

test('testCountMismatches: §10 dice 3 y el fichero registra 2 → un ítem con los dos números', () => {
  const items = testCountMismatches(DIEZ, { 'a.test.js': 2, 'b.test.js': 12, 'c.test.js': 40, 'f.test.js': 40 })
  eq(items.length, 2, 'las dos menciones de a.test.js fallan; b coincide; c y f son «más» y se saltan')
  assert(/a\.test\.js/.test(items[0]) && /dice 3 pruebas/.test(items[0]) && /registra 2/.test(items[0]), items[0])
  assert(/línea 5/.test(items[0]) && /línea 10/.test(items[1]), 'cada ítem dice la línea de CLAUDE.md')
  eq(testCountMismatches(DIEZ, { 'a.test.js': 3, 'b.test.js': 12 }), [], 'con los números reales, nada')
})

test('testCountMismatches: un fichero de §10 que no registra pruebas (renombrado o borrado) también es discrepancia', () => {
  const items = testCountMismatches(DIEZ, { 'a.test.js': 3 })
  eq(items.length, 1)
  assert(/b\.test\.js/.test(items[0]) && /dice 12 pruebas/.test(items[0]) && /no hay ningún fichero/.test(items[0]), items[0])
  eq(testCountMismatches('', { 'a.test.js': 3 }), [], 'sin §10, nada que comparar')
  eq(testCountMismatches(DIEZ, null), [], 'sin recuento por fichero, no se comprueba')
})

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

test('formatReport pinta errores y avisos con sus listas', () => {
  const lines = formatReport(
    { errors: [{ kind: 'tests', title: 'Número', items: ['README.md: dice 1 y hay 2'] }], warnings: [{ kind: 'titles', title: 'Títulos (1)', items: ['«X» · a.js:3'] }] },
    (t, kind) => `${kind}:${t}`
  )
  eq(lines, ['error:✗ Número', '   README.md: dice 1 y hay 2', 'warn:⚠ Títulos (1)', 'warn:   «X» · a.js:3'])
  eq(formatReport({ errors: [], warnings: [] }), [])
})

// ---------------------------------------------------------------------------
// Humo: el repo de verdad
// ---------------------------------------------------------------------------

test('checkDocs sobre el repo: sin errores con el número del README y, mientras no sea estricto, avisa de títulos sin documentar', () => {
  const n = readmeTestCount(readFileSync(join(ROOT, 'README.md'), 'utf8'))
  assert(Number.isInteger(n), 'el README dice cuántas pruebas unitarias hay')
  const r = checkDocs(ROOT, { tests: n })
  eq(Object.keys(r), ['errors', 'warnings', 'notes'], 'el informe lleva además notas informativas (H7: los mensajes que esperan a su hito)')
  eq(r.errors, [], 'con el número del README no hay errores (CLAUDE.md §2 dice lo mismo)')
  for (const w of r.warnings) {
    eq(Object.keys(w), ['kind', 'title', 'items'])
    assert(['titles', 'msgs', 'files'].includes(w.kind), 'los avisos son de títulos, mensajes o ficheros')
    assert(w.items.length > 0, 'un aviso sin lista no se emite')
  }
  const titulos = r.warnings.filter((w) => w.kind === 'titles')
  if (!STRICT.titles) {
    assert(titulos.length === 1 && titulos[0].items.length >= 1, 'hoy faltan títulos por documentar; si ya están todos sembrados, pon STRICT.titles a true y quita esta guarda')
    for (const item of titulos[0].items) assert(/^«[^»]+» · src\/.+\.js:\d+/.test(item), 'cada título trae fichero y línea: ' + item)
  }
})

test('checkDocs sobre el repo: un número de pruebas que no es el del README es error en README.md y CLAUDE.md', () => {
  const n = readmeTestCount(readFileSync(join(ROOT, 'README.md'), 'utf8'))
  const r = checkDocs(ROOT, { tests: n + 1 })
  eq(r.errors.map((e) => e.kind), ['tests'])
  eq(r.errors[0].items.length, 2, 'los dos documentos dicen el número viejo')
  assert(r.errors[0].items[0].startsWith('README.md: dice '), r.errors[0].items[0])
  const sinNumero = checkDocs(ROOT, {})
  eq(sinNumero.errors, [], 'sin `tests`, el número no se comprueba')
})

test('checkDocs sobre el repo: un mensaje con receptor y sin emisor es aviso, nunca error; fuera de MSG_SIN_EMISOR_HASTA hoy no hay ninguno', () => {
  const r = checkDocs(ROOT, {})
  const avisos = r.warnings.filter((w) => w.kind === 'msgs')
  for (const w of avisos) for (const item of w.items) assert(/^MSG\.[A-Z0-9_]+: lo atiende .+ y nadie lo manda/.test(item), item)
  // Hasta H2 el único aviso era CANCEL_PLAN: lo atendía el service worker
  // (service-worker.test.js) y el panel no lo mandaba. Desde H2 el botón
  // «Parar» de la tarjeta de navegación lo manda (`{ type: MSG.CANCEL_PLAN,
  // tabId }` en runPlan), así que no queda ningún mensaje huérfano. Si aparece
  // uno nuevo, esta línea lo dice con su nombre: cablea quien lo manda o bórralo.
  // Los que H7 sembró sin interfaz no cuentan aquí: van en las notas mientras
  // esperan a su hito, y salen de la lista en cuanto alguien los manda (H8 ya
  // se llevó dos).
  eq(avisos, [], 'ningún mensaje con receptor y sin emisor fuera de la lista')
  const notas = r.notes.filter((w) => w.kind === 'msgs')
  eq(notas.length, 1, 'los mensajes que esperan a su hito van juntos en una nota')
  eq(
    notas[0].items.map((item) => item.split(':')[0]).sort(),
    Object.keys(MSG_SIN_EMISOR_HASTA)
      .map((n) => `MSG.${n}`)
      .sort(),
    'y son exactamente los de la lista, ni uno más'
  )
  for (const item of notas[0].items) assert(/ y todavía nadie lo manda \(lo cablea H\d+\)$/.test(item), item)
  // Que un mensaje de la lista ya cableado sea ERROR se prueba arriba con
  // `pendingSenders`; aquí basta con que hoy el repo no tenga ninguno.
  for (const e of r.errors) assert(e.kind !== 'msgs', 'ningún mensaje sin receptor, sin §5 ni cableado con la lista puesta: ' + JSON.stringify(e))
})

test('checkDocs sobre el repo: el recuento por fichero de §10 se compara con `porFichero` y una discrepancia es error', () => {
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  const declarados = docTestCounts(claude).filter((d) => !d.added)
  assert(declarados.length >= 5, '§10 declara el número de pruebas de varios ficheros de H1')
  const porFichero = Object.fromEntries(declarados.map((d) => [d.file, d.count]))
  const bien = checkDocs(ROOT, { porFichero })
  eq(bien.errors.filter((e) => e.kind === 'tests'), [], 'con los números que dice §10, ninguna discrepancia')

  const uno = declarados[0]
  const mal = checkDocs(ROOT, { porFichero: { ...porFichero, [uno.file]: uno.count + 1 } })
  const tests = mal.errors.filter((e) => e.kind === 'tests')
  eq(tests.length, 1)
  eq(tests[0].items.length, declarados.filter((d) => d.file === uno.file).length, 'una línea por mención del fichero')
  assert(tests[0].items[0].includes(uno.file) && tests[0].items[0].includes(`dice ${uno.count} pruebas`) && tests[0].items[0].includes(`registra ${uno.count + 1}`), tests[0].items[0])
})
