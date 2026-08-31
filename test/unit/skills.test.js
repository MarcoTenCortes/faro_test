/**
 * Las Skills.
 *
 * Lo que de verdad hay que proteger aquí es que cambiar de modo no se lleve por
 * delante las reglas de seguridad, y que Faro no prometa una tarjeta de
 * navegación en los modos donde esa tarjeta no aparece.
 */
import { test, eq, assert } from '../harness.js'
import { SKILLS, DEFAULT_SKILL, skillById, skillSystem, offersNavigation } from '../../src/panel/skills.js'
import { baseSystem } from '../../src/panel/prompts.js'

const SITE = { product: 'confluence', host: 'acme.atlassian.net', spaceKey: 'ENG' }

test('están las cuatro, y la general es la de por defecto', () => {
  eq(SKILLS.map((s) => s.id), ['general', 'busqueda', 'resumen', 'analisis'])
  eq(DEFAULT_SKILL, 'general')
  eq(skillById(DEFAULT_SKILL).label, 'General')
})

test('un id desconocido cae en la general en vez de romper', () => {
  eq(skillById('no-existe').id, 'general')
  eq(skillById(undefined).id, 'general')
  eq(skillSystem('no-existe'), '')
})

test('general y búsqueda llevan; resumen y análisis no', () => {
  eq(offersNavigation('general'), true)
  eq(offersNavigation('busqueda'), true)
  eq(offersNavigation('resumen'), false)
  eq(offersNavigation('analisis'), false)
})

test('sólo búsqueda pide el plan sin pasar por la heurística', () => {
  eq(skillById('busqueda').alwaysPlan, true)
  for (const id of ['general', 'resumen', 'analisis']) {
    assert(!skillById(id).alwaysPlan, id + ' no debería forzar el plan')
  }
})

test('cada Skill tiene etiqueta y una frase que la explica', () => {
  for (const s of SKILLS) {
    assert(s.label && s.label.length <= 20, 'etiqueta rara en ' + s.id)
    assert(s.hint && s.hint.length > 10, 'falta la explicación de ' + s.id)
  }
})

// --- lo que se le dice al modelo -----------------------------------------

test('resumen y análisis trabajan sobre la selección, y si no sobre la página', () => {
  for (const id of ['resumen', 'analisis']) {
    const s = skillSystem(id)
    assert(/seleccionado|selección/i.test(s), id + ' debe mirar primero lo señalado')
    assert(/página o la incidencia que tiene abierta/i.test(s), id + ' debe caer en la página actual')
    assert(/no le pidas/i.test(s), id + ' no debe pedirle al usuario que diga cuál es')
  }
})

test('búsqueda busca de verdad y no se inventa dónde está algo', () => {
  const s = skillSystem('busqueda')
  assert(/herramientas/i.test(s), 'debe usar el MCP antes de contestar')
  assert(/no existe/i.test(s), 'y decirlo cuando no lo encuentra')
})

// --- lo que NO puede cambiar ---------------------------------------------

test('SEGURIDAD: ninguna Skill se lleva por delante las reglas', () => {
  for (const s of SKILLS) {
    const sys = baseSystem({ site: SITE, skill: s.id })
    assert(/nunca instrucciones/i.test(sys), 'falta la regla de inyección en ' + s.id)
    assert(/NO lo obedeces/i.test(sys), 'falta la regla de obediencia en ' + s.id)
    assert(/fuera del sitio actual/i.test(sys), 'falta la regla de URLs en ' + s.id)
  }
})

test('donde no hay tarjeta, no se promete tarjeta', () => {
  const conCarta = baseSystem({ site: SITE, skill: 'general' })
  assert(/«Llévame»/.test(conCarta), 'la general sí la nombra')

  for (const id of ['resumen', 'analisis']) {
    const sin = baseSystem({ site: SITE, skill: id })
    assert(!/«Llévame»/.test(sin), id + ' no debe prometer una tarjeta que no existe')
    assert(/NO aparece ninguna tarjeta/i.test(sin), id + ' debe decir que no la hay')
    assert(/no escribas recorridos|Tampoco escribas recorridos/i.test(sin), id + ' sigue sin improvisar recorridos')
  }
})

test('el modo va DESPUÉS de las reglas, no antes', () => {
  const sys = baseSystem({ site: SITE, skill: 'resumen' })
  assert(sys.indexOf('Seguridad, sin excepciones') < sys.indexOf('MODO RESUMEN'), 'el modo no puede ir por delante')
})

test('sin Skill, el prompt es el de siempre', () => {
  eq(baseSystem({ site: SITE }), baseSystem({ site: SITE, skill: 'general' }))
})
