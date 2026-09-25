/**
 * Qué es una incidencia de Jira en pantalla: lo único de ahí que se puede
 * ejecutar en Node, y el cableado del resto.
 *
 * `jira-issue.js` necesita DOM y hasta H14 no tenía prueba propia: lo suyo se
 * pinaba por regex desde panel-wiring.test.js y se ejercía en el banco. H14 le
 * añade una pieza que NO es DOM y que sí se puede ejecutar aquí: sacar el
 * nombre del estado del atributo `title` del botón de transiciones, que es
 * HTML escrito por la página.
 *
 * Por qué existe esa pieza (observado en el Jira Data Center del usuario,
 * 2026-09-21): en ese Jira no hay `#status-val` ni ninguna pastilla de estado en
 * la cabecera. El estado vive en el botón de transiciones, su texto visible
 * viene RECORTADO por Jira («DevTeam PBI is ready f...») y el nombre entero
 * está dentro del `title`, en un `<span class="jira-issue-status-tooltip-title">`.
 *
 * Por qué se saca con una regex y no con `innerHTML` ni con `DOMParser`: de ese
 * atributo sólo se quiere TEXTO, y aquí no se construye ningún nodo con él —ni
 * uno inerte—, así que no hay nada donde pueda vivir un `onerror`; y así la
 * barrera se puede ejecutar en Node contra entradas hostiles, que es lo que
 * hace esta prueba. Lo que salga pasa además por `clean()` en el panel
 * (`normalizeIssueFields`), como cualquier otro valor de la pantalla.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusFromTooltip } from '../../src/content/jira-issue.js'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const JS = sinComentarios(readFileSync(join(ROOT, 'src/content/jira-issue.js'), 'utf8'))

/** El trozo del fuente entre dos marcas de CÓDIGO, las dos obligatorias y en ese orden. */
function entre(desde, hasta) {
  const a = JS.indexOf(desde)
  assert(a >= 0, `no encuentro «${desde}» en jira-issue.js`)
  const b = JS.indexOf(hasta, a + desde.length)
  assert(b > a, `no encuentro «${hasta}» detrás de «${desde}»`)
  return JS.slice(a, b)
}

/** El `title` tal como lo escribe el Jira real, con su descripción detrás. */
const TITLE_REAL =
  '<span class="jira-issue-status-tooltip-title">DevTeam PBI is ready for Implementation check</span>' +
  '<br><span class="jira-issue-status-tooltip-desc">El equipo ha aceptado el PBI</span>'

// ------------------------------------------------- el nombre entero del estado

test('H14 real: el nombre del estado sale del title del botón, entero y sin marcado', () => {
  eq(statusFromTooltip(TITLE_REAL), 'DevTeam PBI is ready for Implementation check')
  // Sin la descripción detrás, y con el atributo escrito con comillas simples
  // o con más clases en el span (que es como lo pinta cada versión).
  eq(statusFromTooltip("<span class='jira-issue-status-tooltip-title'>For PSO Review</span>"), 'For PSO Review')
  eq(statusFromTooltip('<span class="aui-x jira-issue-status-tooltip-title x">QA PASSED</span>'), 'QA PASSED')
  // Las entidades que Jira escribe ahí se decodifican: el nombre es lo que el
  // usuario lee, no lo que hay en el atributo.
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">Won&#39;t Do &amp; Closed</span>'), "Won't Do & Closed")
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">A &lt;b&gt; B &quot;C&quot;</span>'), 'A <b> B "C"')
  // Un espacio duro es un espacio: el nombre sale de una línea y sin espacios
  // de sobra, como cualquier otro valor leído de la pantalla.
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">A&nbsp;B</span>'), 'A B')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">  En\n  curso  </span>'), 'En curso')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">&#x51;A</span>'), 'QA')
  // Y una entidad ya escapada NO se decodifica dos veces: `&amp;lt;` es «&lt;».
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">&amp;lt;</span>'), '&lt;')
  // Una entidad que no se conoce se queda tal cual: inventarle un carácter
  // sería peor que enseñarla.
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">a&copy;b&constructor;c</span>'), 'a&copy;b&constructor;c')
  // Y una numérica que no es un carácter tampoco puede reventar la lectura de la
  // incidencia ENTERA: `String.fromCodePoint` lanza fuera de rango, y de aquí
  // cuelgan el digest y los enlaces de la página.
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">a&#1114112;b</span>'), 'a&#1114112;b')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">a&#x110000;b</span>'), 'a&#x110000;b')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">a&#0;b</span>'), 'a&#0;b')
})

test('H14: sin el span del nombre no hay nombre que leer', () => {
  eq(statusFromTooltip(''), '')
  eq(statusFromTooltip(null), '')
  eq(statusFromTooltip(undefined), '')
  eq(statusFromTooltip('En curso'), '', 'un title de texto llano no es el tooltip de un estado')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-desc">sólo la descripción</span>'), '')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-titulo">otra clase</span>'), '')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">'), '', 'un span sin cerrar no trae nombre')
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title"></span>'), '')
  eq(statusFromTooltip({}), '')
  eq(statusFromTooltip(12), '')
})

test('SEGURIDAD: de ese atributo sólo sale texto; ningún marcado sobrevive', () => {
  // Es un atributo de la PÁGINA: quien escribe una plantilla de Jira escribe
  // ahí lo que quiera. Nada de esto se parsea como HTML en ninguna parte, así
  // que lo que tiene que quedar es texto plano y de una pieza.
  const hostil =
    '<span class="jira-issue-status-tooltip-title">Abierto<img src=x onerror="alert(1)">' +
    '<script>alert(2)</script><b onclick="x()">ya</b></span>'
  const salida = statusFromTooltip(hostil)
  eq(salida, 'Abierto ya', 'el marcado se va, y el contenido de un <script> no es texto que nadie lea')
  for (const prohibido of ['<', '>', 'onerror', 'onclick', 'script', 'img']) {
    assert(!salida.includes(prohibido), `no debería quedar «${prohibido}» en el nombre del estado`)
  }
  // Un `</span>` escapado dentro del nombre no cierra el span antes de tiempo,
  // y un segundo tooltip detrás no se cuela: se lee el PRIMERO y sólo él.
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">A&lt;/span&gt;B</span>'), 'A</span>B')
  eq(
    statusFromTooltip(
      '<span class="jira-issue-status-tooltip-title">Primero</span><span class="jira-issue-status-tooltip-title">Segundo</span>'
    ),
    'Primero'
  )
  // Y lo que salga es SIEMPRE una cadena: nunca una función del prototipo por
  // una entidad que se llame como un método (la lección de las ramas por nombre).
  assert(typeof statusFromTooltip('<span class="jira-issue-status-tooltip-title">&toString;</span>') === 'string')
  // El módulo no construye ningún nodo con esa cadena: ni innerHTML, ni
  // DOMParser, ni createElement. Si un día hace falta, que sea una decisión.
  for (const prohibido of ['innerHTML', 'DOMParser', 'createElement', 'insertAdjacentHTML', 'outerHTML']) {
    assert(!JS.includes(prohibido), `jira-issue.js no debería usar ${prohibido}`)
  }
})

test('SEGURIDAD: el nombre sale en UNA línea también con el NEL, y un atributo hostil no cuelga la página', () => {
  // El NEL (U+0085) abre línea y `\s` no lo cubre: como entidad, `&#133;`
  // acababa dentro del nombre (revisión adversaria de H14). Con escape en el
  // literal, para que se lea.
  const NEL = String.fromCharCode(0x85)
  eq(statusFromTooltip('<span class="jira-issue-status-tooltip-title">In&#133;Progress</span>'), 'In Progress')
  eq(statusFromTooltip(`<span class="jira-issue-status-tooltip-title">In${NEL}Progress</span>`), 'In Progress')
  // Y el atributo lo escribe la página: dos mil `<span class="…"` sin cerrar
  // tardaban 32 s en fallar (cada `<span` se tragaba el resto con `[^>]*` y
  // retrocedía). Ahora una etiqueta acaba en la siguiente y el atributo se
  // acota antes de mirarlo: falla en nada.
  const hostil = '<span class="jira-issue-status-tooltip-title" '.repeat(4000)
  const t0 = performance.now()
  eq(statusFromTooltip(hostil), '')
  assert(performance.now() - t0 < 200, 'un atributo de 180 KB sin cerrar no puede tardar segundos')
  // El tope no se lleva un nombre que quepa: el tooltip real son dos frases.
  const largo = '<span class="jira-issue-status-tooltip-title">QA</span>' + '<br>' + 'x'.repeat(100000)
  eq(statusFromTooltip(largo), 'QA')
  assert(/const TOOLTIP_MAX = \d+/.test(JS) && /String\(title \?\? ''\)\.slice\(0, TOOLTIP_MAX\)/.test(JS), 'el atributo se acota antes de la regex')
  assert(!/<span\[\^>\]\*/.test(JS), 'y los atributos de la etiqueta se leen sin cruzar a la siguiente')
})

// ----------------------------------------------------------- el cableado (DOM)

test('H14: el estado se busca primero donde estaba y después en el botón de transiciones', () => {
  // Otras instalaciones sí tienen `#status-val`: los selectores de antes siguen
  // los primeros y en su orden, y el botón es el respaldo.
  const ids = entre('const FIELD_IDS = {', 'const FIELD_LABELS')
  const status = ids.slice(ids.indexOf('status: ['), ids.indexOf(']', ids.indexOf('status: [')))
  for (const sel of [
    "'#status-val'",
    "'#issue-header .jira-issue-status-lozenge'",
    "'.issue-header-content .jira-issue-status-lozenge'",
    "'.status-view .jira-issue-status-lozenge'",
    "'#details-module .jira-issue-status-lozenge'",
  ]) {
    assert(status.includes(sel), `el selector de antes ${sel} sigue en su sitio`)
  }
  assert(!status.includes('opsbar'), 'el botón no es un selector más: su valor no es su texto')
  const leer = entre('function leerEstado(', 'export function jiraIssueFields')
  assert(leer.includes('if (!status && boton)'), 'el botón sólo se lee si los selectores de antes no dieron nada')
  assert(leer.includes("statusFromTooltip(boton.getAttribute('title'))"), 'el nombre sale del title, que es HTML')
  assert(leer.includes('RECORTADO.test('), 'y el texto visible sólo si Jira no lo ha recortado')
  // La categoría: la de la pastilla que dio el nombre, o la del botón.
  assert(leer.includes('categoriaDe(el)') && leer.includes('categoriaDe(boton)'))
  // Y sale de la CLASE, no de un texto: es lo que no se traduce.
  const cat = entre('function categoriaDe(', 'function leerEstado(')
  assert(cat.includes("el.getAttribute('class')"), 'de la clase del control')
  assert(!cat.includes('textContent'), 'nunca del texto, que Jira traduce')
  assert(/STATUS_CATEGORY_CLASS/.test(cat))
  // El botón es un disparador de menú: sólo se lee, nunca se pulsa.
  assert(!/\.click\(\)/.test(JS), 'jira-issue.js no pulsa nada')
})

test('H14: los campos salen con la categoría del estado, que no es un campo que se enseñe', () => {
  const campos = entre('export function jiraIssueFields(', 'export function jiraIssueKey')
  assert(campos.includes("if (k === 'status') statusEl = el"), 'se recuerda de dónde salió el nombre')
  assert(campos.includes('const estado = leerEstado(doc, out.status, statusEl)'))
  assert(campos.includes('out.status = estado.status') && campos.includes('out.statusCategory = estado.category'))
  assert(campos.includes('out.epicKey = claveDeEnlace(epicEl)'), 'y la épica sigue saliendo del enlace')
})
