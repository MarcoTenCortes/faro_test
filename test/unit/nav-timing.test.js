/**
 * Los tiempos de la navegación salen de NAV_TIMING, no de números copiados.
 *
 * Pasó de verdad (auditoría de 2026-09-13, docs/PLAN.md D3): CLAUDE.md decía
 * que los tiempos vivían en `NAV_TIMING` (config.js), pero nadie lo importaba:
 * bootstrap.js construía el NavRunner con un literal, runner.js repetía los
 * mismos números como `?? 2500`, `?? 1600`…, el service worker vigilaba un
 * paso atascado con un `9000` suelto y `highlightHoldMs` no lo leía nadie.
 * Subir `stepPauseMs` en config.js no cambiaba nada.
 *
 * bootstrap.js es un script clásico (no admite `import` estático): trae
 * NAV_TIMING por el mismo `import()` dinámico con el que carga el resto, y como
 * el NavRunner se construye DESPUÉS de esos imports, ningún tiempo hace falta
 * antes de poder importar (si algún día lo hiciera, se toleraría aquí con su
 * motivo). Se prueba por regex sobre el fuente, como panel.js en
 * panel-wiring.test.js.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listJsFiles } from '../syntax.js'
import { NAV_TIMING } from '../../src/shared/config.js'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Los números que estaban copiados a mano y ahora sólo viven en NAV_TIMING. */
const COPIADOS = [2500, 1600, 220, 6000, 340, 15000, 40, 9000]

test('NAV_TIMING: números positivos, y los que estaban copiados siguen ahí', () => {
  for (const [k, v] of Object.entries(NAV_TIMING)) {
    assert(Number.isFinite(v) && v > 0, `NAV_TIMING.${k} no es un número positivo`)
  }
  const valores = new Set(Object.values(NAV_TIMING))
  for (const v of COPIADOS) assert(valores.has(v), `el ${v} que estaba copiado ya no está en NAV_TIMING`)
  assert(!('highlightHoldMs' in NAV_TIMING), 'highlightHoldMs no lo usaba nadie: fuera')
})

test('bootstrap.js trae NAV_TIMING por import() y construye el NavRunner con una copia, sin literales', () => {
  const b = read('src/content/bootstrap.js')
  assert(/import\(url\('src\/shared\/config\.js'\)\)/.test(b), 'config.js se carga por import() dinámico, como el resto')
  assert(/timing:\s*\{\s*\.\.\.NAV_TIMING\s*\}/.test(b), 'timing: { ...NAV_TIMING } (una copia: MSG.SETTINGS la muta)')
  assert(!/(locateTimeoutMs|stepPauseMs|settleQuietMs|settleMaxMs)\s*:/.test(b), 'ninguna clave de tiempo escrita a mano')
  for (const v of COPIADOS) {
    assert(!new RegExp('Ms:\\s*' + v + '\\b').test(b), `bootstrap.js lleva el ${v} copiado`)
  }
})

test('runner.js: cada caída de un tiempo (this.timing.x ?? …) va a NAV_TIMING, nunca a un número', () => {
  const r = read('src/content/runner.js')
  assert(/^import \{ NAV_TIMING \} from '\.\.\/shared\/config\.js'$/m.test(r), 'import estático de config.js')
  const caidas = [...r.matchAll(/this\.timing\.\w+\s*\?\?\s*([^\s),]+)/g)].map((m) => m[1])
  assert(caidas.length >= 9, `se esperaban las caídas de tiempo del runner; hay ${caidas.length}`)
  const malas = caidas.filter((c) => !/^NAV_TIMING\.\w+$/.test(c) && !/^Math\.round\(/.test(c))
  eq(malas, [], 'caídas que no salen de NAV_TIMING')
  for (const v of COPIADOS) assert(!new RegExp('\\?\\?\\s*' + v + '\\b').test(r), `runner.js sigue con ?? ${v}`)
  assert(!/\?\?\s*\d/.test(r), 'ningún ?? con un número detrás')
})

test('el service worker abandona un paso atascado a los NAV_TIMING.stepStallMs, no a un 9000 suelto', () => {
  const sw = read('src/background/service-worker.js')
  assert(/^import \{ NAV_TIMING \} from '\.\.\/shared\/config\.js'$/m.test(sw), 'import estático de config.js')
  assert(/function watchStalledStep\(tabId, index, ms = NAV_TIMING\.stepStallMs\)/.test(sw))
  assert(!/\b9000\b/.test(sw), 'el 9000 ya no va suelto')
})

test('cada clave de NAV_TIMING la lee algún fuente de src/ además de config.js', () => {
  const fuentes = listJsFiles(join(ROOT, 'src'))
    .filter((f) => relative(ROOT, f).replace(/\\/g, '/') !== 'src/shared/config.js')
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  const sinUso = Object.keys(NAV_TIMING).filter((k) => !new RegExp('NAV_TIMING\\.' + k + '\\b').test(fuentes))
  eq(sinUso, [], 'claves de NAV_TIMING que nadie lee (como pasó con highlightHoldMs)')
})

test('config.js sigue siendo puro: importarlo no toca chrome, document ni window', () => {
  // runner.js y el service worker lo importan estáticamente; el test del SW
  // corre con un `chrome` de mentira y los content scripts en cualquier página.
  const c = read('src/shared/config.js')
  assert(!/\b(chrome|document|window)\s*\./.test(c), 'config.js no puede depender del navegador')
})
