/**
 * Las tres sugerencias del chat vacío.
 *
 * Vivían dentro de `showWelcome` (panel.js) y sólo miraban el producto: en Jira
 * ofrecían «¿En qué está trabajando el equipo este sprint?» aunque la Skill
 * fuera Análisis, que es justo la que no busca nada y analiza lo que tienes
 * delante. Una sugerencia que no encaja con el modo se paga dos veces: el turno
 * sale mal y el usuario aprende a no pulsarlas.
 *
 * Aquí son una función pura por dos motivos: se prueban en Node (el panel no
 * corre en el banco) y la rama se lee de un golpe —producto × Skill— en vez de
 * repartida en condiciones dentro del pintado.
 *
 * Con páginas base configuradas, la tercera de Análisis pregunta por ellas: es
 * la única que depende del estado y la que el usuario no adivina («compárala
 * con las páginas base» no se le ocurre a nadie que no sepa que existen).
 */

import { hasSources } from './sources.js'

/** Cuántas se pintan: el tope del estado vacío (docs/PLAN.md §3.4). */
export const SUGGESTION_COUNT = 3

/**
 * Por Skill y producto. La clave es el id de la Skill (`skills.js`); lo que no
 * esté en la tabla cae en `general`, que es con lo que arranca el panel.
 *
 * `base` es la tercera de Análisis cuando hay páginas base: sustituye a la de
 * `pages` (no se añade, que el tope son tres).
 */
const POR_SKILL = {
  general: {
    jira: [
      '¿En qué está trabajando el equipo este sprint?',
      '¿Qué tipos de tickets hay y cómo se nombran?',
      'Enséñame las incidencias abiertas más antiguas',
    ],
    confluence: [
      '¿De qué trata este espacio?',
      '¿Dónde está documentado el proceso de despliegue?',
      'Resume la página en la que estoy',
    ],
  },
  busqueda: {
    jira: [
      '¿Qué incidencias mías están sin cerrar?',
      'Busca las incidencias bloqueadas de este proyecto',
      'Enséñame lo que se cerró la semana pasada',
    ],
    confluence: [
      '¿Dónde está la guía de arquitectura?',
      'Busca las páginas que hablan de autenticación',
      'Llévame a la última acta de reunión',
    ],
  },
  resumen: {
    jira: [
      'Resume esta incidencia',
      '¿En qué punto está y qué falta para cerrarla?',
      '¿Qué se ha decidido en los comentarios?',
    ],
    confluence: [
      'Resume esta página en cinco puntos',
      '¿Qué se decide en esta página?',
      '¿Qué tendría que saber antes de leerla entera?',
    ],
  },
  analisis: {
    jira: [
      'Analiza esta incidencia',
      '¿Qué falta para que esté lista?',
      '¿Qué supuestos da por hechos?',
    ],
    confluence: [
      'Analiza esta página a fondo',
      '¿Qué afirma sin apoyarlo?',
      '¿Qué falta para que esté completa?',
    ],
  },
}

/** La tercera de Análisis cuando el turno va a llevar páginas base. */
const CON_BASE = {
  jira: '¿Se contradice con las páginas base?',
  confluence: 'Compárala con las páginas base',
}

/**
 * Qué ofrecer en el chat vacío.
 *
 * @param {{product?: string}|null} [site] el sitio de la pestaña; fuera de
 *        Confluence se ofrece lo de Jira, como hacía el panel
 * @param {string} [skill] el id de la Skill del desplegable
 * @param {object|null} [sources] las páginas base del sitio, para la tercera
 *        de Análisis
 * @returns {string[]} exactamente `SUGGESTION_COUNT` preguntas
 *
 * Pura: no toca DOM ni chrome, y nunca lanza (un `site` de un registro viejo,
 * una Skill que ya no existe o un `sources` a medias caen en la rama de serie).
 */
export function suggestionsFor(site, skill = 'general', sources = null) {
  const producto = site?.product === 'confluence' ? 'confluence' : 'jira'
  // `Object.hasOwn` y no `POR_SKILL[skill] ||`: en un objeto literal, las claves
  // «__proto__», «constructor» y «toString» dan algo VERDADERO que viene del
  // prototipo, y el `[...rama[producto]]` de abajo lanzaba sobre un `undefined`
  // (revisión adversaria de H5). `state.skill` sale de un registro guardado, que
  // se puede editar a mano. `producto` no necesita guarda: es una de las dos
  // cadenas literales de la línea de arriba, nunca lo que llegue de fuera.
  const rama = Object.hasOwn(POR_SKILL, skill) ? POR_SKILL[skill] : POR_SKILL.general
  const lista = [...rama[producto]]
  if (rama === POR_SKILL.analisis && hasSources(sources)) {
    lista[SUGGESTION_COUNT - 1] = CON_BASE[producto]
  }
  return lista.slice(0, SUGGESTION_COUNT)
}
