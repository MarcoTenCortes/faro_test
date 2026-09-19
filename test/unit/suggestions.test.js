/**
 * Las tres sugerencias del chat vacío (src/panel/suggestions.js).
 *
 * EL CAMBIO: antes sólo miraban el producto, así que en Análisis —el modo que
 * NO busca nada— el panel ofrecía «¿En qué está trabajando el equipo este
 * sprint?» (docs/PLAN.md §3.4). Ahora la rama es producto × Skill, y con
 * páginas base la tercera pregunta por ellas.
 */
import { readFileSync } from 'node:fs'
import { test, eq, assert } from '../harness.js'
import { suggestionsFor, SUGGESTION_COUNT } from '../../src/panel/suggestions.js'
import { SKILLS } from '../../src/panel/skills.js'
import { emptySources, addSourcePage } from '../../src/panel/sources.js'

const JIRA = { product: 'jira', host: 'jira.acme.eu' }
const CONFLUENCE = { product: 'confluence', host: 'confluence.acme.eu' }

/** Las páginas base de un sitio, como las guarda el panel. */
function conBase() {
  return addSourcePage(emptySources(), { id: '123456', title: 'Guía de API', path: '/display/ENG/Guia' }).sources
}

test('cada rama (producto × Skill) da exactamente tres sugerencias distintas', () => {
  eq(SUGGESTION_COUNT, 3, 'el tope del estado vacío son tres (docs/PLAN.md §3.4)')
  for (const skill of SKILLS.map((s) => s.id)) {
    for (const site of [JIRA, CONFLUENCE]) {
      const lista = suggestionsFor(site, skill, null)
      eq(lista.length, 3, `${skill} en ${site.product} tiene que dar tres`)
      eq(new Set(lista).size, 3, `${skill} en ${site.product} repite una sugerencia`)
      for (const s of lista) {
        assert(typeof s === 'string' && s.trim().length > 8, 'una sugerencia es una pregunta escrita: ' + s)
      }
    }
  }
})

test('el texto cambia con el producto y con la Skill: ninguna rama es la de otra', () => {
  const vistas = new Map()
  for (const skill of SKILLS.map((s) => s.id)) {
    for (const site of [JIRA, CONFLUENCE]) {
      vistas.set(`${skill}·${site.product}`, suggestionsFor(site, skill, null).join(' | '))
    }
  }
  eq(new Set(vistas.values()).size, vistas.size, 'dos ramas con los mismos tres textos: ' + [...vistas.keys()].join(', '))

  // Y en el producto que toca: en Jira se habla de incidencias, en Confluence
  // de páginas (lo contrario delataba que la rama era la del otro producto).
  assert(suggestionsFor(JIRA, 'analisis').includes('Analiza esta incidencia'))
  assert(suggestionsFor(CONFLUENCE, 'analisis').includes('Analiza esta página a fondo'))
  assert(suggestionsFor(JIRA, 'resumen').includes('Resume esta incidencia'))
  for (const s of suggestionsFor(JIRA, 'general')) assert(!/página/i.test(s), 'en Jira no se ofrece una página: ' + s)
})

test('la Skill general sigue ofreciendo lo de siempre, en los dos productos', () => {
  // Los textos que el panel ya ofrecía (panel.js, antes de H5): cambiarlos no
  // era parte del rediseño.
  eq(suggestionsFor(CONFLUENCE, 'general'), [
    '¿De qué trata este espacio?',
    '¿Dónde está documentado el proceso de despliegue?',
    'Resume la página en la que estoy',
  ])
  eq(suggestionsFor(JIRA, 'general'), [
    '¿En qué está trabajando el equipo este sprint?',
    '¿Qué tipos de tickets hay y cómo se nombran?',
    'Enséñame las incidencias abiertas más antiguas',
  ])
})

test('con páginas base, la tercera de Análisis pregunta por ellas; sin ellas, no se nombran', () => {
  eq(suggestionsFor(JIRA, 'analisis', conBase())[2], '¿Se contradice con las páginas base?')
  eq(suggestionsFor(CONFLUENCE, 'analisis', conBase())[2], 'Compárala con las páginas base')
  // Sustituye a la tercera, no se añade: el tope son tres.
  eq(suggestionsFor(JIRA, 'analisis', conBase()).length, 3)
  eq(suggestionsFor(JIRA, 'analisis', null)[2], '¿Qué supuestos da por hechos?')
  eq(suggestionsFor(CONFLUENCE, 'analisis', null)[2], '¿Qué falta para que esté completa?')
  for (const site of [JIRA, CONFLUENCE]) {
    for (const s of suggestionsFor(site, 'analisis', null)) {
      assert(!/páginas base/i.test(s), 'sin páginas base no se nombran: ' + s)
    }
  }

  // El alcance exclusivo cuenta como «hay páginas base» aunque la lista esté
  // vacía (`hasSources`): el turno va a mirar sólo lo que se le diga.
  const exclusivo = { mode: 'exclusive', pages: [] }
  eq(suggestionsFor(JIRA, 'analisis', exclusivo)[2], '¿Se contradice con las páginas base?')
})

test('y las páginas base sólo cambian Análisis: los demás modos no las nombran', () => {
  for (const skill of ['general', 'busqueda', 'resumen']) {
    for (const site of [JIRA, CONFLUENCE]) {
      eq(suggestionsFor(site, skill, conBase()), suggestionsFor(site, skill, null), `${skill} no depende de las páginas base`)
    }
  }
})

test('nada de esto lanza con lo que puede llegar del estado del panel', () => {
  // `state.site` es null fuera de Atlassian, `state.sources` puede venir a
  // medias de un registro guardado, y la Skill de un sitio viejo puede ser una
  // que ya no exista: la bienvenida se pinta igual.
  for (const site of [null, undefined, {}, { product: '' }, { product: 'JIRA' }, 'jira']) {
    for (const skill of [undefined, null, '', 'analisis', 'inventada', 42]) {
      for (const sources of [null, undefined, {}, [], 'abc', { pages: null }, { pages: [{}] }]) {
        const lista = suggestionsFor(site, skill, sources)
        eq(lista.length, 3, `sin tres sugerencias con site=${JSON.stringify(site)} skill=${skill}`)
      }
    }
  }
  // Sin sitio, las de Jira: es lo que hacía el panel (el fallback de hoy).
  eq(suggestionsFor(null, 'general'), suggestionsFor(JIRA, 'general'))
  eq(suggestionsFor(undefined, 'analisis'), suggestionsFor(JIRA, 'analisis'))
  // Una Skill desconocida cae en general, con la que arranca el panel.
  eq(suggestionsFor(JIRA, 'inventada'), suggestionsFor(JIRA, 'general'))
  // Y la lista que se devuelve es una copia: quien la pinte no puede estropear
  // la siguiente bienvenida.
  const lista = suggestionsFor(JIRA, 'general')
  lista[0] = 'tocada'
  assert(suggestionsFor(JIRA, 'general')[0] !== 'tocada', 'la tabla interna no se toca')
})

test('el módulo no toca el DOM ni chrome al importarse', () => {
  // Es el requisito para probarlo en Node (CLAUDE.md §9): que el import de
  // arriba haya funcionado sin instalar ningún global ya lo demuestra; el
  // fichero se lee además para que nadie lo añada dentro de una función.
  const src = readFileSync(new URL('../../src/panel/suggestions.js', import.meta.url), 'utf8')
  assert(!/\bdocument\b|\bwindow\b|\bchrome\./.test(src), 'suggestions.js tiene que ser puro')
})
