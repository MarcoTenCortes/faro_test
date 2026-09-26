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

test('ESCAPE_CLOSES: las cinco pantallas cuya flecha es volver, cada una con su botón de cerrar', () => {
  eq(Object.keys(ESCAPE_CLOSES).sort(), ['screen-log', 'screen-memory', 'screen-model', 'screen-sources', 'screen-today'])
  eq(ESCAPE_CLOSES['screen-memory'], 'btn-memory-close')
  eq(ESCAPE_CLOSES['screen-log'], 'btn-log-close')
  eq(ESCAPE_CLOSES['screen-sources'], 'btn-sources-close')
  // «Qué mirar hoy» (H11) es de consulta como las otras tres: cerrarla es volver
  // al chat y no decide nada. Lo que sí decide —apagar el sitio, borrar el
  // diario— son controles suyos, y Escape no los pulsa.
  eq(ESCAPE_CLOSES['screen-today'], 'btn-today-close')
})

test('H17: la pantalla del modelo se cierra con su flecha, y la cabecera de screens.js ya no dice «sólo las de consulta»', () => {
  // La del modelo (H17) está en el mapa, pero su flecha sólo se ve cuando de ahí
  // se puede salir sin elegir: el panel no pulsa un botón oculto, así que en el
  // primer uso Escape no la cierra. Aquí se pina que el mapa la nombre y que la
  // cabecera del módulo cuente esa verdad en vez de la de antes.
  eq(ESCAPE_CLOSES['screen-model'], 'btn-model-close')
  const FUENTE = readFileSync(join(ROOT, 'src/panel/screens.js'), 'utf8')
  const cabecera = FUENTE.slice(0, FUENTE.indexOf('export const ESCAPE_CLOSES'))
  assert(cabecera.length > 200, 'la cabecera existe')
  assert(!cabecera.includes('Sólo las pantallas de CONSULTA'), 'la cabecera ya no dice que sólo están las de consulta')
  assert(cabecera.includes('la del modelo'), 'nombra la pantalla del modelo')
  assert(cabecera.includes('no pulsa un botón oculto'), 'y dice por qué Escape no la cierra siempre')
  // En el HTML la flecha NACE oculta: sólo el panel la enseña, en los modos de
  // los que se puede salir sin elegir (Ajustes, o un error con el chat vivo).
  const desde = HTML.indexOf('id="screen-model"')
  assert(desde > -1, 'la pantalla del modelo está en panel.html')
  const hasta = HTML.indexOf('</section>', desde)
  assert(hasta > desde, 'y se cierra')
  const flecha = /<button\b[^>]*\bid="btn-model-close"[^>]*>/.exec(HTML.slice(desde, hasta))
  assert(flecha, 'su flecha está dentro de ella')
  assert(/\shidden(?=[\s>=])/.test(flecha[0]), 'y nace oculta: ' + (flecha && flecha[0]))
  assert(Object.isFrozen(ESCAPE_CLOSES))
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
