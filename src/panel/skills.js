/**
 * Las Skills: en qué modo trabaja Faro.
 *
 * No cambian las herramientas que tiene el modelo —siguen siendo las del MCP de
 * Atlassian y nada más—, sino qué se espera de él y qué hace la extensión
 * después. Dos cosas cambian de verdad:
 *
 *  - `offersNavigation`: si debajo de la respuesta aparece la tarjeta «Puedo
 *    llevarte». Resumir o analizar lo que ya tienes delante no es ir a ningún
 *    sitio, y ofrecer un viaje ahí es ruido.
 *  - `alwaysPlan`: si se pide el plan de navegación sin pasar por la heurística
 *    barata. En búsqueda, llevar al usuario ES la respuesta, así que no se
 *    descarta antes de haberlo intentado.
 *
 * Funciones puras: se pueden leer y comprobar sin arrancar nada.
 */

export const DEFAULT_SKILL = 'general'

/** Lo que se le dice al modelo cuando hay algo seleccionado en la página. */
const SOBRE_QUE = [
  'Sobre qué trabajas:',
  '- Si el usuario te ha pasado un fragmento seleccionado de la página, trabaja SOBRE ESE FRAGMENTO. Es lo que ha señalado con el ratón, y es lo que le importa.',
  '- Si no hay selección, trabaja sobre la página o la incidencia que tiene abierta ahora mismo, cuyo identificador se te ha dado arriba. Léela con la herramienta correspondiente antes de responder.',
  '- No le pidas que te diga cuál es: ya lo sabes.',
].join('\n')

export const SKILLS = [
  {
    id: 'general',
    label: 'General',
    hint: 'Responde y, si hay dónde, te lleva.',
    offersNavigation: true,
    alwaysPlan: false,
    system() {
      return ''
    },
  },

  {
    id: 'busqueda',
    label: 'Búsqueda',
    hint: 'Encontrar dónde vive la información.',
    offersNavigation: true,
    alwaysPlan: true,
    system() {
      return [
        'MODO BÚSQUEDA.',
        'Tu trabajo es localizar DÓNDE está la información, no explicarla entera.',
        '- Busca de verdad con las herramientas del MCP antes de contestar. Prueba más de una formulación si la primera no da nada.',
        '- Contesta en pocas líneas: qué has encontrado y dónde está, nombrando el título exacto de cada página y la clave de cada incidencia.',
        '- Si hay varias candidatas, ordénalas de más probable a menos y di por qué.',
        '- Si no existe, dilo claramente. Inventarse una ubicación es peor que no encontrarla.',
      ].join('\n')
    },
  },

  {
    id: 'resumen',
    label: 'Resumen',
    hint: 'Resume la selección o la página abierta.',
    offersNavigation: false,
    alwaysPlan: false,
    system() {
      return [
        'MODO RESUMEN.',
        SOBRE_QUE,
        '',
        'Cómo resumir:',
        '- Empieza por una frase que diga de qué va. Después, lo esencial en viñetas cortas.',
        '- Conserva los datos concretos: nombres de componentes, versiones, decisiones, cifras. Un resumen que los pierde no sirve.',
        '- Marca lo que la fuente deja sin decidir o pendiente, si lo hay.',
        '- No añadas nada que no esté en el texto, y no opines.',
      ].join('\n')
    },
  },

  {
    id: 'analisis',
    label: 'Análisis',
    hint: 'Analiza a fondo la selección o la página.',
    offersNavigation: false,
    alwaysPlan: false,
    system() {
      return [
        'MODO ANÁLISIS.',
        SOBRE_QUE,
        '',
        'Qué tienes que producir:',
        '- Qué afirma y en qué se apoya.',
        '- Supuestos que da por hechos sin justificar.',
        '- Huecos: lo que haría falta saber y no está.',
        '- Contradicciones o incoherencias, dentro del texto o con otras páginas que conozcas del sitio.',
        '- Riesgos y consecuencias de lo que se decide ahí.',
        '',
        'Separa siempre lo que dice la fuente de lo que aportas tú. Cuando algo sea juicio propio, dilo.',
        '',
        'CÓMO NUMERAR, y esto es importante:',
        '- Cada observación empieza por su número entre corchetes: [1], [2], [3]… Numera de corrido, sin saltos y sin repetir.',
        '- Una observación, un pasaje. Si tienes dos cosas que decir sobre el mismo párrafo, son dos observaciones.',
        '- Habla de trozos concretos del texto, no de la página en general: después se subrayará en la página el fragmento del que habla cada número, y una observación que no apunte a ninguna frase no se podrá marcar.',
        '- Como mucho ocho observaciones. Mejor cinco que importen que doce que no.',
      ].join('\n')
    },
  },
]

/** La Skill pedida, o la general si el id no existe. */
export function skillById(id) {
  return SKILLS.find((s) => s.id === id) || SKILLS[0]
}

/** El bloque de sistema de una Skill. Cadena vacía si no aporta nada. */
export function skillSystem(id) {
  return skillById(id).system() || ''
}

/** ¿Esta Skill ofrece la tarjeta «Puedo llevarte»? */
export function offersNavigation(id) {
  return !!skillById(id).offersNavigation
}
