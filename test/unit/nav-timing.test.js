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
  // Lo que se pina es que NAV_TIMING venga de config.js por import estático;
  // que el service worker traiga además otras constantes del mismo módulo no
  // es asunto de este test (H6 le añadió STORAGE_KEYS).
  assert(
    /^import \{[^}]*\bNAV_TIMING\b[^}]*\} from '\.\.\/shared\/config\.js'$/m.test(sw),
    'import estático de config.js'
  )
  assert(/function watchStalledStep\(tabId, index, ms = NAV_TIMING\.stepStallMs\)/.test(sw))
  assert(!/\b9000\b/.test(sw), 'el 9000 ya no va suelto')
})

test('H28: el service worker abandona un salto sin aviso a los NAV_TIMING.anchorStallMs, no a un número suelto', () => {
  // Hasta H28 un salto por URL cuya página no avisaba de que cargó se quedaba
  // esperando para siempre (docs/PLAN3.md §3.2). Su margen vive donde los
  // demás, y el service worker lo lee AL LLAMAR: es lo que deja a
  // service-worker.test.js acortarlo sin temporizadores de 12 s vivos.
  const sw = read('src/background/service-worker.js')
  assert(/function watchStalledAnchor\(tabId, ms = NAV_TIMING\.anchorStallMs\)/.test(sw), 'el vigilante del salto lee NAV_TIMING.anchorStallMs')
  assert(!/\b12000\b/.test(sw), 'el 12000 vive en config.js')
  assert(NAV_TIMING.anchorStallMs > NAV_TIMING.stepStallMs, 'una carga entera de página se espera más que un paso en el árbol')
})

test('H28 rev: la pausa tras un clic es NAV_TIMING.afterClickMs, no un 420 suelto', () => {
  // Revisión adversaria de H28 (D1): el service worker esperaba 420 ms fijos
  // tras cada clic antes de seguir, y ningún pin lo vigilaba. Ese margen sólo
  // cubre a una SPA que cambia de vista sin recargar; la recarga de verdad del
  // último clic (un Data Center) la termina el aviso de la página de destino.
  const sw = read('src/background/service-worker.js')
  assert(/await new Promise\(\(r\) => setTimeout\(r, NAV_TIMING\.afterClickMs\)\)/.test(sw), 'advanceAfterNavigation lee NAV_TIMING.afterClickMs al llamar')
  assert(!/\b420\b/.test(sw), 'el 420 vive en config.js')
  assert(NAV_TIMING.afterClickMs < NAV_TIMING.stepStallMs, 'el respiro de después de un clic es mucho menos que abandonar un paso')
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
