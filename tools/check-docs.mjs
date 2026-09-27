/**
 * Deriva entre la documentación y el código: paso 5 «docs» de `npm run check`.
 *
 * Por qué existe: CLAUDE.md, README.md y docs/INSTALL.md son el mapa del
 * proyecto para cualquier sesión nueva, y se quedaban atrás sin que nada
 * avisara. Pasó de verdad (auditoría del 2026-09-13, docs/PLAN.md §2.7 D2):
 * §9 daba por «documentados en INSTALL» ocho títulos del registro que no
 * estaban, `src/` emitía 60 títulos distintos y 35 no aparecían en ningún
 * documento, y el número de pruebas del README dependía de que alguien se
 * acordara de cambiarlo a mano.
 *
 * Compara cuatro cosas leyendo los ficheros reales:
 *   1. «N pruebas unitarias» en README.md y CLAUDE.md §2 === las que hay, y
 *      cada «`x.test.js` (…; N pruebas» de la sección §10 de docs/PINES.md ===
 *      las que registra ese fichero («N pruebas más» son las añadidas en un
 *      hito y no se pueden comprobar: se saltan). Siempre ERROR (§10 ya lo
 *      exigía a mano). Lo del fichero lo destapó la revisión de H1: sólo se
 *      vigilaba el total y §10 ya decía 22 de un fichero que registraba 24.
 *      §10 («Lo que los tests pinan») vivió en CLAUDE.md hasta el 2026-09-27,
 *      cuando se movió byte a byte a docs/PINES.md para que CLAUDE.md fuera un
 *      mapa corto (se inyecta entero en cada sesión); conserva su encabezado
 *      «## 10.» y allí no lleva ninguna «## 11.» detrás.
 *   2. Cada título de `log.(ok|info|warn|error)('Título', …)` de src/ aparece
 *      entre «» en docs/INSTALL.md o en CLAUDE.md.
 *   3. Cada constante de MSG tiene RECEPTOR (`case MSG.X` en bootstrap.js o
 *      service-worker.js; `=== MSG.X` o `case MSG.X` en panel.js o
 *      service-worker.js) y se nombra en CLAUDE.md §5. Quien la manda
 *      (`{ type: MSG.X }`, `sendMessage(MSG.X`) es EMISOR, no receptor: la
 *      revisión de H1 encontró que se daba por atendido cualquier mensaje que
 *      APARECIERA en el SW o en el panel, así que quitar el `case` de
 *      bootstrap.js de un mensaje panel → content no se notaba, y una
 *      constante nueva mandada por el panel sin receptor pasaba. Un mensaje
 *      con receptor y sin emisor es AVISO (código que espera algo que nadie
 *      manda: o se cablea o se borra), salvo los de `MSG_SIN_EMISOR_HASTA`,
 *      que son NOTA con el hito que los va a cablear —y ERROR en cuanto
 *      alguien los manda, para que esa lista sólo pueda encoger.
 *   4. Cada .js de src/ está en el bloque de código del mapa de CLAUDE.md §3.
 * Las tres últimas son AVISO mientras `STRICT` diga false: se pasan a error
 * después de sembrar los documentos (docs/PLAN.md, hito H1, paso 2).
 *
 * Las funciones que reciben texto y devuelven datos son puras y se prueban en
 * test/unit/check-docs.test.js con fixtures pequeñas.
 * `checkDocs(root, {tests, porFichero})` es la única que toca el disco. Suelto
 * (`node tools/check-docs.mjs`) cuenta las pruebas cargando test/unit/*.test.js
 * como hace test/run.js (el total y las de cada fichero), imprime el informe
 * entero y sale con código 1 si hay errores.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Qué comprobaciones son error y cuáles sólo aviso. En true desde el
 * 2026-09-13 (cierre de H1), con los 37 títulos que faltaban ya sembrados en
 * docs/INSTALL.md y CLAUDE.md §9; con false, la comprobación vuelve a ser un
 * aviso amarillo con lista.
 */
export const STRICT = { titles: true, msgs: true, files: true }

/**
 * Mensajes que nacen con RECEPTOR y sin EMISOR a propósito, con el hito que los
 * va a cablear al lado.
 *
 * Por qué existe: un mensaje sin emisor es un aviso porque casi siempre es
 * código que espera algo que nadie manda (o se cablea o se borra). Pero H7 es el
 * cimiento REST y va SIN interfaz: el content script ya sabe contestar a las
 * lecturas del sitio y quien las pedirá —la lista de la tarjeta, los chips, el
 * índice por API, «qué mirar hoy»— llega en H8-H11. Sin esta lista, el paso
 * «docs» avisaría de cinco mensajes durante cuatro hitos y el aviso dejaría de
 * significar nada; con ella, cada uno dice a qué hito espera.
 *
 * Sólo puede ENCOGER, y el propio paso lo vigila: en cuanto alguien manda uno de
 * estos mensajes, tenerlo aquí es un ERROR que pide borrarlo (si no, la lista
 * taparía para siempre el aviso que la justifica). Un nombre que ya no está en
 * MSG, igual.
 */
export const MSG_SIN_EMISOR_HASTA = {
  // VACÍA: los cinco que sembró H7 ya están cableados, y así es como esta lista
  // encoge hasta desaparecer. JQL_SEARCH y FAVOURITE_FILTERS salieron en H8 (la
  // lista de la tarjeta de búsqueda manda el primero desde `attachJqlResults` y
  // los chips del chat vacío el segundo desde `loadSearchChipSources`);
  // SPACE_PAGES en H9 (lo manda `restIndexFor` para leer el árbol del espacio de
  // la API antes de gastar un turno del modelo); y RECENT_ISSUES y RECENT_PAGES
  // en H11 (los manda `readToday`, que es quien pregunta «qué ha cambiado desde
  // que lo miraste»). Todos en src/panel/panel.js.
  //
  // Sigue aquí, vacía y con su mecanismo probado, porque el hito que vuelva a
  // sembrar un receptor sin emisor tiene que poder escribir su nombre y su hito
  // sin inventarse nada: sin la lista, el paso «docs» avisaría de un mensaje
  // huérfano durante hitos enteros y el aviso dejaría de significar algo.
}

/** Ficheros que se leen. Rutas relativas a la raíz del repo, siempre con «/». */
export const DOC_FILES = {
  readme: 'README.md',
  claude: 'CLAUDE.md',
  // La sección §10 «Lo que los tests pinan», movida aquí desde CLAUDE.md.
  pines: 'docs/PINES.md',
  install: 'docs/INSTALL.md',
  messages: 'src/shared/messages.js',
  bootstrap: 'src/content/bootstrap.js',
  serviceWorker: 'src/background/service-worker.js',
  panel: 'src/panel/panel.js',
}

// ---------------------------------------------------------------------------
// Puras: texto → datos
// ---------------------------------------------------------------------------

function nl(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n')
}

/**
 * Quita comentarios `//` y `/* *​/` de un fuente JS conservando los saltos de
 * línea (los números de línea del informe tienen que ser los del fichero).
 * Sabe de cadenas ('…', "…", `…`) para no cortar en un `//` de una URL; una
 * cadena con comilla simple o doble no cruza líneas, así una regex con comilla
 * (`/'/`) sólo puede confundirlo hasta el final de esa línea. Pura.
 */
export function stripComments(js) {
  const src = nl(js)
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c) {
          j++
          break
        }
        if (src[j] === '\n' && c !== '`') break
        j++
      }
      out += src.slice(i, j)
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

const TEST_COUNT = /(\d+) pruebas unitarias/

/**
 * El N de «N pruebas unitarias». Prefiere la línea de `npm run check` (la que
 * §10 manda actualizar); si no la hay, la primera aparición. null si no está.
 * Pura.
 */
export function readmeTestCount(md) {
  const text = nl(md)
  for (const line of text.split('\n')) {
    if (!line.includes('npm run check')) continue
    const m = TEST_COUNT.exec(line)
    if (m) return Number(m[1])
  }
  const m = TEST_COUNT.exec(text)
  return m ? Number(m[1]) : null
}

// log.ok('Título' · log.warn("Título" · log.info(\n  'Título' — sólo literales
// entre comillas simples o dobles; una plantilla o una variable no es un título
// fijo y no se puede documentar.
const LOG_CALL = /\blog\.(?:ok|info|warn|error)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g

/**
 * Cada sitio donde un fuente JS emite un título de registro literal:
 * `[{title, line}]` en orden de aparición, con la línea del literal (la que
 * encuentra un grep). Los comentarios no cuentan. Pura.
 */
export function logTitleSites(js) {
  const clean = stripComments(js)
  const out = []
  for (const m of clean.matchAll(LOG_CALL)) {
    const title = m[2].replace(/\\(.)/g, '$1')
    const at = m.index + m[0].indexOf(m[1])
    const line = clean.slice(0, at).split('\n').length
    out.push({ title, line })
  }
  return out
}

/** Los títulos literales distintos de `log.(ok|info|warn|error)('Título'`, en orden de primera aparición. Pura. */
export function logTitles(js) {
  const seen = new Set()
  const out = []
  for (const { title } of logTitleSites(js)) {
    if (seen.has(title)) continue
    seen.add(title)
    out.push(title)
  }
  return out
}

/**
 * Los «Título» entre comillas angulares de un markdown, sin repetir, con el
 * espacio en blanco plegado (un título partido por un salto de línea en INSTALL
 * es el mismo título). Un «…» con otro «…» dentro sólo aporta el de dentro. Pura.
 */
export function documentedTitles(md) {
  const out = new Set()
  for (const m of nl(md).matchAll(/«([^«»]+)»/g)) {
    const t = m[1].replace(/\s+/g, ' ').trim()
    if (t) out.add(t)
  }
  return [...out]
}

/** Las claves de `export const MSG = { … }` de messages.js, en orden. Pura. */
export function msgConstants(messagesJs) {
  const clean = stripComments(messagesJs)
  const m = /export\s+const\s+MSG\s*=\s*\{([\s\S]*?)\n\}/.exec(clean)
  if (!m) return []
  return [...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((x) => x[1])
}

// Cómo se ATIENDE un mensaje (formas reales, 2026-09-14): bootstrap.js y
// service-worker.js hacen `switch (msg.type) { case MSG.X: … }`; panel.js
// compara en onRuntimeMessage con `msg?.type === MSG.X`. En bootstrap.js sólo
// vale el `case`: es un switch único y así lo pide CLAUDE.md §11.
const CASE_OF = (name) => new RegExp(`\\bcase\\s+MSG\\.${name}\\b`)
const COMPARE_OF = (name) => new RegExp(`[!=]==\\s*MSG\\.${name}\\b|\\bMSG\\.${name}\\s*[!=]==`)

// Cómo se MANDA: `type: MSG.X` (`{ type: MSG.X }`, también con el `type:` en
// su propia línea), `sendMessage(MSG.X` / `sendToTab(tabId, MSG.X`, y el tipo
// elegido en un ternario o una asignación que viaja después como `{ type }`
// (`const type = asistida ? MSG.START_PLAN : MSG.NAVIGATE_DIRECT` en el
// runPlan del panel). Una comparación (`=== MSG.X`, `(MSG.X === msg.type`) no
// es emisor: la mirada atrás y la de adelante la excluyen.
const SENT_OF = (name) => new RegExp(`(?:(?<![=!<>])[:?=]|[,(])\\s*MSG\\.${name}\\b(?!\\s*[!=]==)`)

/**
 * Por cada constante de MSG, quién la atiende y si alguien la manda:
 * `[{name, handled, sent, where}]` con `where` ⊆ ['bootstrap', 'service-worker',
 * 'panel'] (los RECEPTORES: `case MSG.X` en bootstrap.js o service-worker.js,
 * `=== MSG.X` o `case MSG.X` en panel.js o service-worker.js), `handled` sólo
 * con receptor y `sent` si alguno de los tres la manda (`type: MSG.X`,
 * `sendMessage(MSG.X`, `sendToTab(…, MSG.X`, o elegida en un ternario).
 * Los comentarios no cuentan. Pura.
 */
export function msgHandlers({ messagesJs, bootstrapJs, swJs, panelJs } = {}) {
  const b = stripComments(bootstrapJs)
  const s = stripComments(swJs)
  const p = stripComments(panelJs)
  return msgConstants(messagesJs).map((name) => {
    const where = []
    const caseOf = CASE_OF(name)
    const compareOf = COMPARE_OF(name)
    if (caseOf.test(b)) where.push('bootstrap')
    if (caseOf.test(s) || compareOf.test(s)) where.push('service-worker')
    if (caseOf.test(p) || compareOf.test(p)) where.push('panel')
    const sentOf = SENT_OF(name)
    const sent = sentOf.test(b) || sentOf.test(s) || sentOf.test(p)
    return { name, handled: where.length > 0, sent, where }
  })
}

/** Cómo se llama en el informe cada sitio que puede atender un mensaje. */
const NOMBRE_DE = { bootstrap: 'bootstrap.js', 'service-worker': 'service-worker.js', panel: 'panel.js' }

/**
 * Los mensajes que nadie manda, repartidos en tres: `notes` (los que
 * `pendientes` declara a la espera de un hito), `warnings` (los demás: código
 * que espera algo que nadie manda) y `errors` (los de `pendientes` que ya no
 * esperan a nadie, porque alguien los manda o porque ya no existen). Pura.
 *
 * Que la lista sólo pueda encoger es lo que la separa de una excepción
 * permanente: cablear el emisor en H8 pone el paso «docs» en rojo hasta que el
 * nombre sale de la lista.
 */
export function pendingSenders(handlers, pendientes = MSG_SIN_EMISOR_HASTA) {
  const lista = pendientes && typeof pendientes === 'object' ? pendientes : {}
  const hs = Array.isArray(handlers) ? handlers : []
  const notes = []
  const warnings = []
  const errors = []
  for (const h of hs) {
    if (!h || !h.handled || h.sent) continue
    const donde = (h.where || []).map((w) => NOMBRE_DE[w] || w).join(' y ')
    if (lista[h.name]) {
      notes.push(`MSG.${h.name}: lo atiende ${donde} y todavía nadie lo manda (lo cablea ${lista[h.name]})`)
    } else {
      warnings.push(
        `MSG.${h.name}: lo atiende ${donde} y nadie lo manda (ni «type: MSG.${h.name}» ni «sendMessage(…MSG.${h.name}» en bootstrap.js, service-worker.js o panel.js)`
      )
    }
  }
  const porNombre = new Map(hs.filter((h) => h && h.name).map((h) => [h.name, h]))
  for (const [name, hito] of Object.entries(lista)) {
    const h = porNombre.get(name)
    if (!h) {
      errors.push(`MSG.${name}: está en MSG_SIN_EMISOR_HASTA (${hito}) y ya no es un mensaje: bórralo de la lista en tools/check-docs.mjs`)
    } else if (h.sent) {
      errors.push(`MSG.${name}: ya lo manda alguien, así que ya no espera a ${hito}: bórralo de MSG_SIN_EMISOR_HASTA en tools/check-docs.mjs`)
    }
  }
  return { notes, warnings, errors }
}

/** Las líneas [start, end) de la sección «## N. …» de un markdown (hasta el siguiente «## »), o null. */
function sectionRange(lines, number) {
  const start = lines.findIndex((l) => new RegExp(`^## ${number}\\.`).test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/** El texto de la sección «## N. …» de un markdown (hasta el siguiente «## »), o ''. Pura. */
export function sectionOf(md, number) {
  const lines = nl(md).split('\n')
  const r = sectionRange(lines, number)
  return r ? lines.slice(r.start, r.end).join('\n') : ''
}

// «`x.test.js` (…)» con un nivel de paréntesis anidado dentro (§10 escribe
// «`disconnect()`» o «(H1; 12 pruebas; …)» dentro del paréntesis).
const TEST_ENTRY = /`([\w.-]+\.test\.js)`\s*\(((?:[^()]|\([^()]*\))*)\)/g
// «N pruebas» a secas es el total del fichero; «N pruebas más» son las que
// añadió un hito a un fichero que ya existía, y no se pueden comprobar.
const TEST_ENTRY_COUNT = /\b(\d+) pruebas\b(\s+más)?/

/**
 * Lo que la sección §10 de un markdown (hoy docs/PINES.md) dice de cada
 * fichero de test: por cada «`x.test.js` (…; N pruebas…)» de esa sección,
 * `{file, count, added, line}` con `line` la de ese markdown (1-based) y
 * `added` true si dice «N pruebas más». La sección va de «## 10.» a la
 * siguiente «## » o al final del texto. Un fichero nombrado dos veces sale dos
 * veces; un paréntesis sin «N pruebas» no cuenta. Sólo §10 (lo de fuera son
 * prosa). Pura.
 */
export function docTestCounts(pinesMd) {
  const lines = nl(pinesMd).split('\n')
  const r = sectionRange(lines, 10)
  if (!r) return []
  const out = []
  for (let i = r.start; i < r.end; i++) {
    for (const m of lines[i].matchAll(TEST_ENTRY)) {
      const c = TEST_ENTRY_COUNT.exec(m[2])
      if (!c) continue
      out.push({ file: m[1], count: Number(c[1]), added: !!c[2], line: i + 1 })
    }
  }
  return out
}

/**
 * Las discrepancias entre lo que la §10 de docs/PINES.md dice de cada fichero
 * de test y lo que registra de verdad (`porFichero`: nombre del fichero →
 * pruebas registradas, como lo cuenta test/run.js). Una línea por mención con
 * los dos números; un fichero de §10 que no registra nada (renombrado o
 * borrado) también. Sin `porFichero`, nada. Pura: recibe el TEXTO de PINES.
 * El parámetro conserva su nombre de cuando §10 vivía en CLAUDE.md porque
 * docs/PINES.md cita esta firma tal cual (y docs.test.js la busca en el código).
 */
export function testCountMismatches(claudeMd, porFichero) {
  if (!porFichero || typeof porFichero !== 'object') return []
  const out = []
  for (const { file, count, added, line } of docTestCounts(claudeMd)) {
    if (added) continue
    const real = porFichero[file]
    if (real == null) out.push(`${DOC_FILES.pines} §10 (línea ${line}): «${file}» dice ${count} pruebas y no hay ningún fichero con ese nombre en test/unit/`)
    else if (real !== count) out.push(`${DOC_FILES.pines} §10 (línea ${line}): «${file}» dice ${count} pruebas y registra ${real}`)
  }
  return out
}

/**
 * Los nombres de mensaje que nombra CLAUDE.md §5 (allí van SIN `MSG.`, en
 * listas «panel → SW: START_PLAN, …»): todo lo que parezca una constante en
 * mayúsculas de tres o más caracteres dentro de esa sección. Pura.
 */
export function msgInDocs(claudeMd) {
  const out = new Set()
  for (const m of sectionOf(claudeMd, 5).matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) out.add(m[0])
  return [...out]
}

/** El primer bloque de código (```) de la sección §3 de CLAUDE.md, o ''. Pura. */
export function mapBlock(claudeMd) {
  const m = /```[^\n]*\n([\s\S]*?)\n```/.exec(sectionOf(claudeMd, 3))
  return m ? m[1] : ''
}

const FILE_TOKEN = /[\w][\w.-]*(?:\/[\w][\w.-]*)*\.(?:m?js|css|html|json|md)\b/g

/**
 * Qué rutas de `files` (relativas a la raíz, con «/») NO aparecen en el mapa
 * de ficheros de CLAUDE.md §3. Devuelve las que faltan.
 *
 * Cómo se lee el bloque: una línea cuyo primer token acaba en «/» abre un
 * directorio (`src/panel/`); las líneas de debajo nombran ficheros sueltos
 * (`panel.js (~2500)`, `panel.html / panel.css`, `overlay/overlay.js`) que se
 * resuelven contra ese directorio; una línea que empieza por una ruta completa
 * (`src/shared/models.js · log.js · format.js`) resuelve los nombres que la
 * acompañan contra el directorio de esa ruta. Cualquier nombre de fichero que
 * aparezca como texto en una línea cuenta, también dentro de la descripción.
 * Pura.
 */
export function srcFilesInMap(claudeMd, files) {
  const wanted = (files || []).map((f) => String(f).replace(/\\/g, '/'))
  const roots = new Set(wanted.map((f) => f.split('/')[0]))
  const block = mapBlock(claudeMd)
  if (!block) return [...wanted].sort()

  const isFull = (token) => token.includes('/') && roots.has(token.split('/')[0])
  const seen = new Set()
  let currentDir = ''
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const first = line.split(/\s+/)[0]
    let lineDir = currentDir
    if (first.endsWith('/')) {
      currentDir = first
      lineDir = first
      roots.add(first.split('/')[0])
    } else if (isFull(first)) {
      lineDir = first.slice(0, first.lastIndexOf('/') + 1)
    }
    for (const m of line.matchAll(FILE_TOKEN)) {
      const token = m[0]
      seen.add(isFull(token) ? token : lineDir + token)
    }
  }
  return wanted.filter((f) => !seen.has(f)).sort()
}

// ---------------------------------------------------------------------------
// Con disco: lee el repo y junta el informe
// ---------------------------------------------------------------------------

function walk(dir, keep, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries.sort()) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, keep, out)
    else if (keep(entry)) out.push(p)
  }
  return out
}

function rel(root, p) {
  return relative(root, p).replace(/\\/g, '/')
}

function readOrNull(root, relPath) {
  try {
    return readFileSync(join(root, relPath), 'utf8')
  } catch {
    return null
  }
}

/**
 * Lee README.md, CLAUDE.md, docs/PINES.md, docs/INSTALL.md y src/**\/*.js de `root` y devuelve
 * `{errors, warnings, notes}`: listas de hallazgos `{kind, title, items}` con
 * `kind` ∈ 'tests' | 'titles' | 'msgs' | 'files' (`notes` es informativo: hoy
 * sólo los mensajes que esperan a su hito). `tests` es el número real de
 * pruebas unitarias y `porFichero` las que registra cada test/unit/x.test.js
 * (`{'x.test.js': N}`); lo que no se pasa no se comprueba. El total se compara
 * con README.md y CLAUDE.md §2; `porFichero`, con la §10 de docs/PINES.md.
 */
export function checkDocs(root, { tests, porFichero } = {}) {
  const errors = []
  const warnings = []
  const notes = []
  const push = (strict, finding) => (strict ? errors : warnings).push(finding)

  const readme = readOrNull(root, DOC_FILES.readme)
  const claude = readOrNull(root, DOC_FILES.claude)
  const pines = readOrNull(root, DOC_FILES.pines)
  const install = readOrNull(root, DOC_FILES.install)
  const srcFiles = walk(join(root, 'src'), (name) => name.endsWith('.js')).map((p) => rel(root, p))

  // 1. Número de pruebas: siempre estricto.
  const cuenta = []
  for (const [name, text] of [
    [DOC_FILES.readme, readme],
    [DOC_FILES.claude, claude],
  ]) {
    if (text == null) {
      cuenta.push(`${name}: no se ha podido leer`)
      continue
    }
    const n = readmeTestCount(text)
    if (n == null) cuenta.push(`${name}: no dice «npm run check … N pruebas unitarias»`)
    else if (Number.isInteger(tests) && n !== tests) cuenta.push(`${name}: dice ${n} pruebas unitarias y hay ${tests}`)
  }
  if (cuenta.length) errors.push({ kind: 'tests', title: 'Número de pruebas unitarias', items: cuenta })

  // 1b. Pruebas por fichero en la §10 de docs/PINES.md: siempre estricto, y
  //     sólo si nos dan el recuento. Sin el fichero no hay con qué comparar, y
  //     eso también es error: sin él, un número desfasado pasaría en silencio.
  const conRecuento = !!porFichero && typeof porFichero === 'object'
  if (conRecuento && pines == null) {
    errors.push({
      kind: 'tests',
      title: `Pruebas por fichero en ${DOC_FILES.pines} §10`,
      items: [`${DOC_FILES.pines}: no se ha podido leer, y es donde §10 dice cuántas pruebas registra cada fichero`],
    })
  }
  const porFicheroMal = pines == null ? [] : testCountMismatches(pines, porFichero)
  if (porFicheroMal.length) {
    errors.push({ kind: 'tests', title: `Pruebas por fichero en ${DOC_FILES.pines} §10 (${porFicheroMal.length})`, items: porFicheroMal })
  }

  // 2. Títulos del registro emitidos en src/ que ningún documento nombra.
  const documented = new Set([...documentedTitles(install), ...documentedTitles(claude)])
  const sitios = new Map() // título → Map(fichero → [líneas])
  for (const file of srcFiles) {
    for (const { title, line } of logTitleSites(readOrNull(root, file))) {
      if (!sitios.has(title)) sitios.set(title, new Map())
      const porFichero = sitios.get(title)
      if (!porFichero.has(file)) porFichero.set(file, [])
      porFichero.get(file).push(line)
    }
  }
  const sinDocumentar = []
  for (const [title, porFichero] of sitios) {
    if (documented.has(title)) continue
    const donde = [...porFichero].map(([file, lines]) => `${file}:${lines.join(', ')}`).join(' · ')
    sinDocumentar.push(`«${title}» · ${donde}`)
  }
  if (sinDocumentar.length) {
    push(STRICT.titles, {
      kind: 'titles',
      title: `Títulos de registro sin documentar en ${DOC_FILES.install} ni ${DOC_FILES.claude} (${sinDocumentar.length})`,
      items: sinDocumentar,
    })
  }

  // 3. Mensajes: con receptor y nombrados en §5 (error si STRICT.msgs); con
  //    receptor y sin emisor (aviso siempre: nadie lo manda, o se cablea o se borra).
  const handlers = msgHandlers({
    messagesJs: readOrNull(root, DOC_FILES.messages),
    bootstrapJs: readOrNull(root, DOC_FILES.bootstrap),
    swJs: readOrNull(root, DOC_FILES.serviceWorker),
    panelJs: readOrNull(root, DOC_FILES.panel),
  })
  const enDocs = new Set(msgInDocs(claude))
  const mensajes = []
  for (const h of handlers) {
    if (!h.handled) {
      mensajes.push(
        `MSG.${h.name}: nadie lo atiende (ni «case MSG.${h.name}» en bootstrap.js o service-worker.js, ni «=== MSG.${h.name}» en panel.js o service-worker.js)`
      )
    }
    if (!enDocs.has(h.name)) mensajes.push(`MSG.${h.name}: no aparece en ${DOC_FILES.claude} §5`)
  }
  if (mensajes.length) {
    push(STRICT.msgs, { kind: 'msgs', title: `Mensajes (MSG) sin receptor o sin mención en §5 (${mensajes.length})`, items: mensajes })
  }
  // Los que nadie manda: aviso, salvo los que esperan a su hito (nota), y error
  // el que ya no espera a nadie y sigue en la lista.
  const emisores = pendingSenders(handlers)
  if (emisores.errors.length) {
    errors.push({ kind: 'msgs', title: `Mensajes (MSG) que ya no esperan a ningún hito (${emisores.errors.length})`, items: emisores.errors })
  }
  if (emisores.warnings.length) {
    warnings.push({ kind: 'msgs', title: `Mensajes (MSG) con receptor y sin emisor (${emisores.warnings.length})`, items: emisores.warnings })
  }
  if (emisores.notes.length) {
    notes.push({ kind: 'msgs', title: `Mensajes (MSG) a la espera de su hito (${emisores.notes.length})`, items: emisores.notes })
  }

  // 4. Ficheros de src/ fuera del mapa §3.
  const fuera = srcFilesInMap(claude, srcFiles)
  if (fuera.length) {
    push(STRICT.files, { kind: 'files', title: `Ficheros de src/ fuera del mapa de ${DOC_FILES.claude} §3 (${fuera.length})`, items: fuera })
  }

  return { errors, warnings, notes }
}

/**
 * Cuenta las pruebas unitarias como hace test/run.js: carga test/harness.js y
 * cada test/unit/*.test.js (registrarlas no las ejecuta) midiendo cuántas
 * registra cada fichero. `{total, porFichero: {'x.test.js': N}}`. Sólo para el
 * modo suelto: importar test/run.js ejecutaría su `main()`.
 */
export async function countUnitTests(root) {
  const { registry } = await import(pathToFileURL(join(root, 'test', 'harness.js')).href)
  const files = walk(join(root, 'test', 'unit'), (name) => name.endsWith('.test.js'))
  const porFichero = {}
  for (const f of files) {
    const antes = registry.length
    await import(pathToFileURL(f).href)
    porFichero[basename(f)] = registry.length - antes
  }
  return { total: registry.length, porFichero }
}

/**
 * Líneas del informe para la consola. `paint(text, kind)` colorea
 * ('error' | 'warn' | 'note'); sin él, texto plano. Un informe sin `notes` (los
 * que se construyen a mano en un test) se imprime igual que antes.
 */
export function formatReport({ errors, warnings, notes }, paint = (t) => t) {
  const out = []
  for (const e of errors) {
    out.push(paint(`✗ ${e.title}`, 'error'))
    for (const item of e.items) out.push(`   ${item}`)
  }
  for (const w of warnings) {
    out.push(paint(`⚠ ${w.title}`, 'warn'))
    for (const item of w.items) out.push(paint(`   ${item}`, 'warn'))
  }
  for (const n of notes || []) {
    out.push(paint(`· ${n.title}`, 'note'))
    for (const item of n.items) out.push(paint(`   ${item}`, 'note'))
  }
  return out
}

// ---------------------------------------------------------------------------
// Modo suelto: node tools/check-docs.mjs
// ---------------------------------------------------------------------------

// Sin `await` de nivel superior a propósito: test/unit/check-docs.test.js
// importa este módulo, y este módulo importa ese test al contar las pruebas;
// con un `await` aquí arriba el ciclo se quedaba esperando a sí mismo (Node
// avisa de «unsettled top-level await» y sale con 13). Pasó de verdad al
// escribir el test.
async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { total: tests, porFichero } = await countUnitTests(root)
  const report = checkDocs(root, { tests, porFichero })
  const colores = { error: '\x1b[31m', warn: '\x1b[33m', note: '\x1b[36m' }
  const paint = (text, kind) => (process.stdout.isTTY && colores[kind] ? `${colores[kind]}${text}\x1b[0m` : text)
  console.log(`Faro · docs ↔ código (${tests} pruebas unitarias cargadas de ${Object.keys(porFichero).length} ficheros)\n`)
  const lines = formatReport(report, paint)
  if (lines.length) console.log(lines.join('\n'))
  console.log(
    `\n${report.errors.length} error(es) · ${report.warnings.length} aviso(s) · ${report.notes.length} nota(s)` +
      (report.errors.length
        ? ''
        : ` · número de pruebas al día: el total en ${DOC_FILES.readme} y ${DOC_FILES.claude} §2, el de cada fichero en ${DOC_FILES.pines} §10`)
  )
  process.exitCode = report.errors.length ? 1 : 0
}

if (process.argv[1] && /[\\/]check-docs\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
