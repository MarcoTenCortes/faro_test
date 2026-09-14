/**
 * El overlay no se queda con los Escape de la página.
 *
 * Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2.3 M2): `_onKey`
 * está registrado en `document` en fase de captura y hacía `stopPropagation()`
 * en cuanto `this.onCancel` era una función; el ejecutor lo pone en cada paso,
 * en cada llegada y en cada análisis, y nadie lo volvía a poner a null
 * (`clearAll()` y `clearNotes()` no lo tocaban). Desde la primera marca, ningún
 * Escape llegaba ya a Jira/Confluence: ni al diálogo de edición, ni a los
 * desplegables de AUI, ni a la edición en línea de un campo. Y con marcas
 * puestas, Escape las borraba a espaldas del panel, que seguía creyendo que
 * estaban.
 *
 * La regla, pinada aquí por regex sobre el fuente (como panel.js en
 * panel-wiring.test.js): Escape es de Faro SÓLO mientras hay algo en marcha
 * —el foco de un recorrido, el cartel, la barra de selección, el seguimiento
 * de un elemento— o mientras el único subrayado en pantalla es el de una
 * llegada por cita, que no es de nadie más; las marcas NUMERADAS de un
 * análisis no cuentan, porque el panel las da por puestas y las quita desde
 * «Quitar las marcas» o con la siguiente orden. Y quien lo borra todo pone
 * `onCancel` a null, para que un overlay huérfano (extensión recargada sin
 * recargar la pestaña) tampoco intercepte nada.
 */
import { test, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const overlay = readFileSync(join(ROOT, 'src/content/overlay/overlay.js'), 'utf8')

/**
 * El cuerpo de un método de la clase: de su firma (con dos espacios de
 * sangría) hasta la primera línea que sea exactamente «  }». Los bloques de
 * dentro van más sangrados, así que esa línea es la que cierra el método.
 */
function cuerpo(firma) {
  const ini = overlay.indexOf('\n  ' + firma)
  assert(ini >= 0, `overlay.js no tiene el método «${firma}»`)
  const fin = overlay.indexOf('\n  }\n', ini)
  assert(fin > ini, `no se encuentra el cierre de «${firma}»`)
  return overlay.slice(ini, fin)
}

test('overlay: clearAll() y clearNotes() ponen onCancel a null', () => {
  assert(cuerpo('clearAll() {').includes('this.onCancel = null'), 'clearAll() no suelta onCancel')
  assert(cuerpo('clearNotes() {').includes('this.onCancel = null'), 'clearNotes() no suelta onCancel')
})

test('overlay: _onKey sólo intercepta Escape, y sólo si hay algo de Faro en marcha, no por tener onCancel', () => {
  const k = cuerpo('_onKey(ev) {')
  assert(k.includes("ev.key !== 'Escape'") || k.includes("ev.key === 'Escape'"), '_onKey no mira que la tecla sea Escape')
  assert(/typeof this\.onCancel !== 'function'/.test(k), '_onKey comprueba que onCancel es una función')
  assert(k.includes('this.interceptsEscape()'), '_onKey decide con interceptsEscape(), no sólo con onCancel')
  const guarda = k.indexOf('this.interceptsEscape()')
  const para = k.indexOf('ev.stopPropagation()')
  assert(para > guarda, 'stopPropagation() va DESPUÉS de la guarda: sin nada en marcha, el Escape sigue su camino')
  assert(k.indexOf("this.onCancel('escape')") > para, 'onCancel se llama tras parar la propagación')
})

test('overlay: interceptsEscape() mira el foco, el cartel, la barra de selección y el seguimiento; las marcas numeradas no cuentan', () => {
  const g = cuerpo('interceptsEscape() {')
  for (const parte of ['this.el.spot', 'this.el.card', 'this.el.pickBar', 'this.followTarget']) {
    assert(g.includes(parte), `interceptsEscape() no mira ${parte}`)
  }
  assert(/classList\.contains\('on'\)/.test(g), 'lo encendido se reconoce por la clase «on», como lo pinta el propio overlay')
  // La decisión: un análisis con sus marcas NUMERADAS puestas no hace que Faro
  // se quede con el Escape. Esas marcas son del panel; borrarlas a sus
  // espaldas lo dejaba con `state.notes` viejo y «esa marca ya no está» en
  // cada pulsación.
  for (const marca of ['this.outlineTargets']) {
    assert(!g.includes(marca), `interceptsEscape() cuenta ${marca}: los filetes no hacen que Faro se quede con el Escape`)
  }
  // Pero el subrayado de una LLEGADA por cita (applyAnchor, sin números) sí
  // cuenta mientras no haya marcas numeradas: el panel no guarda estado de esa
  // marca —sólo registra «Fragmento resaltado»—, así que quitarla con Escape
  // no lo desincroniza, y sin esto el usuario se quedaba sin ningún control
  // para borrarla, porque en ese camino el foco se apaga antes de subrayar
  // (revisión adversaria de H2, 2026-09-14).
  assert(
    /this\.quoteRanges\.length && !this\.notes\.length/.test(g),
    'el subrayado de una llegada cuenta sólo mientras no haya marcas numeradas'
  )
})

test('overlay: hideCard() no suelta onCancel (el recorrido sigue con el foco puesto) y el listener es de captura y se quita en destroy()', () => {
  // Tras esconder el cartel el ejecutor sigue desplegando la rama con el foco
  // puesto y mira `this.cancelled` en cada vuelta: Escape tiene que poder
  // cancelarlo ahí. La guarda de interceptsEscape() ya deja pasar el Escape
  // cuando el foco se apaga; soltar onCancel aquí sólo quitaría esa vía.
  assert(!cuerpo('hideCard() {').includes('this.onCancel'), 'hideCard() no debe tocar onCancel')
  assert(overlay.includes("document.addEventListener('keydown', this._onKey, true)"), 'el listener va en captura sobre document')
  assert(cuerpo('destroy() {').includes("document.removeEventListener('keydown', this._onKey, true)"), 'destroy() lo quita')
  assert(cuerpo('destroy() {').includes('this.clearAll()'), 'destroy() limpia (y con ello suelta onCancel)')
})
