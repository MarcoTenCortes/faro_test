/**
 * Qué cierra Escape en el panel (src/panel/screens.js).
 *
 * Esc no cerraba Ajustes, Memoria, Registro ni el velo «Trabajando…», y en
 * Páginas base sólo con el foco en el campo (docs/PLAN.md §2.5 A3, reproducido
 * en la auditoría del 2026-09-13). El mapa es puro; el manejador de teclado del
 * panel lo usa desde el documento entero.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESCAPE_CLOSES, ESCAPE_DISMISSES } from '../../src/panel/screens.js'

const ROOT = join(import.meta.dirname, '..', '..')
const HTML = readFileSync(join(ROOT, 'src/panel/panel.html'), 'utf8')
const htmlIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
const pantallas = new Set([...HTML.matchAll(/class="screen hidden" id="([^"]+)"/g)].map((m) => m[1]))

test('ESCAPE_CLOSES: sólo las pantallas de consulta, cada una con su botón de cerrar', () => {
  eq(Object.keys(ESCAPE_CLOSES).sort(), ['screen-log', 'screen-memory', 'screen-sources'])
  eq(ESCAPE_CLOSES['screen-memory'], 'btn-memory-close')
  eq(ESCAPE_CLOSES['screen-log'], 'btn-log-close')
  eq(ESCAPE_CLOSES['screen-sources'], 'btn-sources-close')
})

test('ESCAPE_DISMISSES: Ajustes se cierra sin pulsar su botón, porque «Listo» guarda', () => {
  // El «Listo» de Ajustes GUARDA todos los campos —la contraseña y la URL del
  // servidor incluidas— y rearranca el panel: un Escape distraído aplicaba
  // unos ajustes a medio escribir (revisión adversaria de H2, 2026-09-14).
  eq([...ESCAPE_DISMISSES], ['screen-settings'])
  assert(pantallas.has('screen-settings'), 'es una pantalla del panel')
  assert(!('screen-settings' in ESCAPE_CLOSES), 'y no está en el mapa de los botones: Escape no lo pulsa')
  assert(Object.isFrozen(ESCAPE_DISMISSES))
})

test('ESCAPE_CLOSES: cada pantalla y cada botón existen en panel.html', () => {
  for (const [screen, btn] of Object.entries(ESCAPE_CLOSES)) {
    assert(pantallas.has(screen), 'no es una pantalla del panel: ' + screen)
    assert(htmlIds.has(btn), 'no existe el botón: ' + btn)
    // El botón está DENTRO de su pantalla: cerrar otra sería cerrar a ciegas.
    const desde = HTML.indexOf(`id="${screen}"`)
    const hasta = HTML.indexOf('</section>', desde)
    assert(HTML.slice(desde, hasta).includes(`id="${btn}"`), `${btn} no está dentro de ${screen}`)
  }
})

test('ESCAPE_CLOSES: conectar, claves y contexto quedan fuera a propósito (cerrarlas es decidir algo), y el mapa no se puede tocar', () => {
  for (const id of ['screen-connect', 'screen-setup', 'screen-context']) {
    assert(pantallas.has(id), 'la pantalla existe: ' + id)
    assert(!(id in ESCAPE_CLOSES), 'Escape no debe cerrar ' + id)
    assert(!ESCAPE_DISMISSES.includes(id), 'ni descartar ' + id)
  }
  assert(Object.isFrozen(ESCAPE_CLOSES))
})
