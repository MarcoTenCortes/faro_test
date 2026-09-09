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
 * Y una Skill puede hablar distinto según el PRODUCTO en el que está el
 * usuario (`ctx.product`). Buscar en Confluence es localizar una página en un
 * árbol y enseñar el camino; buscar en Jira es escribir una consulta JQL y
 * nombrar claves de incidencia, porque en Jira no hay árbol que recorrer. Sin
 * producto, o en Confluence, cada Skill dice lo de siempre, letra a letra.
 *
 * Funciones puras: se pueden leer y comprobar sin arrancar nada.
 */

import { anchorsBlockRules } from './notes.js'
import { sourcesBlock, hasSources } from './sources.js'

export const DEFAULT_SKILL = 'general'

/**
 * Para qué sirve la herramienta cuando la página ya va en bloques: lo que no
 * está en pantalla. Una sola lista por producto, que usan la cabecera del
 * prompt y el modo: dos listas distintas eran dos órdenes distintas, y en
 * Jira «comentarios» a secas mandaba releer por el MCP lo que ya iba en los
 * bloques, y citar de ese texto en vez de los bloques ¶.
 */
export const MISSING_FROM_BLOCKS = {
  confluence: 'comentarios, adjuntos, otras páginas',
  jira: 'comentarios plegados, adjuntos, incidencias enlazadas, páginas de Confluence',
}

/**
 * Lo que se le dice al modelo sobre qué trabaja.
 *
 * Con `digest`, la página ya va en el prompt en bloques numerados: no hace
 * falta pedirle que la lea con la herramienta, y leerla dos veces —la de la
 * pantalla y la del MCP, que no coinciden letra a letra— sólo confunde.
 */
function sobreQue({ digest = false, exclusive = false, product = '' } = {}) {
  // Con alcance exclusivo no se le invita a leer «otras páginas»: la única
  // invitación válida es la del ALCANCE, y decir aquí lo contrario es pedirle
  // a un modelo pequeño que elija entre dos órdenes.
  const falta = product === 'jira' ? MISSING_FROM_BLOCKS.jira : MISSING_FROM_BLOCKS.confluence
  return [
    'Sobre qué trabajas:',
    '- Si el usuario te ha pasado un fragmento seleccionado de la página, trabaja SOBRE ESE FRAGMENTO. Es lo que ha señalado con el ratón, y es lo que le importa.',
    digest
      ? '- Si no hay selección, trabaja sobre la página o la incidencia que tiene abierta ahora mismo: su texto va más abajo, en bloques numerados ¶, tal como se ve en pantalla. No hace falta leerla con la herramienta; ' +
        (exclusive
          ? 'úsala sólo para lo que permita el ALCANCE de más abajo.'
          : `úsala sólo para lo que no esté ahí (${falta}).`)
      : '- Si no hay selección, trabaja sobre la página o la incidencia que tiene abierta ahora mismo, cuyo identificador se te ha dado arriba. Léela con la herramienta correspondiente antes de responder' +
        (exclusive ? ', y nada más que lo que permita el ALCANCE de más abajo.' : '.'),
    '- No le pidas que te diga cuál es: ya lo sabes.',
  ].join('\n')
}

/**
 * Búsqueda en Confluence: dónde vive una página, con su id, para que la
 * extensión pueda enseñar el camino por el árbol.
 */
function busquedaConfluence() {
  return [
    'MODO BÚSQUEDA.',
    'Tu trabajo es localizar DÓNDE está la información, no explicarla entera.',
    '- Busca de verdad con las herramientas del MCP antes de contestar. Prueba más de una formulación si la primera no da nada.',
    '- Contesta en pocas líneas: qué has encontrado y dónde está, nombrando el título exacto de cada página con su id numérico entre paréntesis, y la clave de cada incidencia.',
    '- Si hay varias candidatas, ordénalas de más probable a menos y di por qué.',
    '- Si no existe, dilo claramente. Inventarse una ubicación es peor que no encontrarla.',
    '- Termina SIEMPRE con una línea aparte, exactamente así: «Destino: título exacto (id 123456)» con la candidata más probable, o «Destino: ninguno» si no hay ninguna. La extensión lee esa línea para llevar al usuario; sin ella tiene que volver a preguntarte.',
  ].join('\n')
}

/**
 * Búsqueda en Jira: QUÉ incidencias hablan de lo que pregunta el usuario,
 * localizadas con una consulta JQL. No hay árbol que recorrer ni camino que
 * enseñar: lo que se ofrece abajo es la lista entera, en el buscador de Jira,
 * con la consulta que la produjo. Esa consulta la lee la extensión de la
 * llamada real a `jira_search`, no de la prosa: por eso aquí no se pide
 * ninguna línea «Destino:». En Cloud, Jira y Confluence comparten sitio: si lo
 * que busca es una página, se nombra como en Confluence y el cierre lleva su
 * id, que ahí sí hace falta.
 *
 * @param {{projectKey?: string, cloud?: boolean}} ctx el proyecto en el que
 *        está el usuario, si la URL lo dice: es el acotado por defecto de la
 *        consulta; y si el sitio es Cloud.
 */
function busquedaJira({ projectKey = '', cloud = false } = {}) {
  const proyecto = /^[A-Z][A-Z0-9_]*$/.test(String(projectKey || '')) ? String(projectKey) : ''
  return [
    'MODO BÚSQUEDA, en Jira.',
    cloud
      ? 'Tu trabajo es localizar QUÉ incidencias hablan de lo que pregunta el usuario, no explicarlas enteras. Las incidencias se buscan con JQL; si lo que busca es una página de Confluence de este mismo sitio, búscala con las herramientas de Confluence.'
      : 'Tu trabajo es localizar QUÉ incidencias hablan de lo que pregunta el usuario, no explicarlas enteras. En Jira no hay árbol de páginas: se busca con JQL.',
    '- Busca de verdad con la herramienta de búsqueda de Jira del MCP (jira_search) y una consulta JQL antes de contestar. Construye el JQL con lo que dice el usuario: texto (text ~ "…" o summary ~ "…"), estado, tipo, asignado, etiquetas, fechas' +
      (proyecto
        ? `; y acótalo al proyecto en el que está, ${proyecto} (project = ${proyecto}), salvo que pida otra cosa.`
        : '; y acótalo al proyecto en el que está, si lo sabes, salvo que pida otra cosa.') +
      ' Si la primera consulta no da nada, prueba otra con menos filtros u otras palabras.',
    '- Apóyate en el CONTEXTO DE ESTE SITIO de más abajo, si lo hay: ahí están los tipos de incidencia, los estados del flujo y las convenciones de nombre de los tickets (los prefijos y separadores de los resúmenes). Un «issuetype = …», un «status = …» o un «summary ~ "[Backend]"» que salgan de ahí dan con lo que una búsqueda por palabras sueltas no encuentra.',
    '- Di en una línea qué JQL has usado, para que pueda repetirlo o afinarlo. La extensión ofrece abajo abrir esa búsqueda en Jira, con la lista entera.',
    cloud
      ? '- Contesta en pocas líneas: qué has encontrado, nombrando cada incidencia por su clave (ABC-123) y su resumen, con su estado y su asignado si vienen; y cada página de Confluence por su título exacto con su id numérico entre paréntesis.'
      : '- Contesta en pocas líneas: qué has encontrado, nombrando cada incidencia por su clave (ABC-123) y su resumen, con su estado y su asignado si vienen.',
    '- Si hay varias candidatas, ordénalas de más probable a menos y di por qué.',
    '- Si no existe, dilo claramente. Inventarse una clave es peor que no encontrarla.',
    ...(cloud
      ? [
          '- Si la candidata es una página de Confluence, termina con una línea aparte, exactamente así: «Destino: título exacto (id 123456)»; la extensión lee esa línea para llevar al usuario a la página. Con incidencias no hace falta ninguna línea de cierre.',
        ]
      : []),
  ].join('\n')
}

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
    system(ctx = {}) {
      return ctx.product === 'jira' ? busquedaJira({ projectKey: ctx.projectKey, cloud: !!ctx.cloud }) : busquedaConfluence()
    },
  },

  {
    id: 'resumen',
    label: 'Resumen',
    hint: 'Resume la selección o la página abierta.',
    offersNavigation: false,
    alwaysPlan: false,
    system(ctx) {
      return [
        'MODO RESUMEN.',
        sobreQue(ctx),
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
    system(ctx = {}) {
      // Las páginas base y el alcance, si el usuario eligió algo: van justo
      // después de «sobre qué trabajas», que es de lo que hablan. Sin nada
      // elegido, el prompt es el de siempre, letra a letra.
      const enJira = ctx.product === 'jira'
      const base = sourcesBlock(ctx.sources, { digest: !!ctx.digest, product: ctx.product, linked: !!ctx.linked })
      const conPaginasBase = hasSources(ctx.sources) && ctx.sources.pages.length > 0
      const soloEsta = !!base && !conPaginasBase
      const exclusive = !!base && ctx.sources.mode === 'exclusive'

      const out = ['MODO ANÁLISIS.', sobreQue({ digest: !!ctx.digest, exclusive, product: ctx.product })]
      if (base) out.push('', base)
      out.push('', 'Qué tienes que producir:')
      if (enJira) {
        // Una incidencia no se analiza como una página: lo que importa es si
        // pide algo claro, comprobable y coherente con sus campos, sus
        // comentarios y la documentación de la que sale. Del Confluence
        // enlazado sólo se habla si lo hay.
        out.push(
          '- Qué pide exactamente la incidencia y para quién: el objetivo, y en qué se apoya (épica, incidencias enlazadas, documentación).',
          '- Criterios de aceptación: si los hay, si son comprobables; si faltan, qué habría que añadir.',
          '- Supuestos que da por hechos sin justificar, y huecos: entorno, versiones, datos, pasos o dependencias que haría falta saber y no están.',
          conPaginasBase
            ? '- Contradicciones o incoherencias: entre la descripción, los comentarios y los campos (estado, prioridad, versión, asignado), o con las páginas base.'
            : soloEsta
              ? '- Contradicciones o incoherencias dentro de la incidencia: entre la descripción, los comentarios y los campos (estado, prioridad, versión, asignado).'
              : ctx.linked
                ? '- Contradicciones o incoherencias: entre la descripción, los comentarios y los campos (estado, prioridad, versión, asignado), o con la documentación del Confluence enlazado y las incidencias relacionadas que conozcas.'
                : '- Contradicciones o incoherencias: entre la descripción, los comentarios y los campos (estado, prioridad, versión, asignado), o con las incidencias relacionadas que conozcas.',
          '- Riesgos, dependencias y bloqueos que se ven en lo que hay.',
          '',
          'Separa siempre lo que dice la incidencia de lo que aportas tú. Cuando algo sea juicio propio, dilo.'
        )
      } else {
        out.push(
          '- Qué afirma y en qué se apoya.',
          '- Supuestos que da por hechos sin justificar.',
          '- Huecos: lo que haría falta saber y no está.',
          // Contra qué se contrasta depende del alcance: con páginas base, contra
          // ellas; en exclusivo sin páginas, sólo consigo misma.
          conPaginasBase
            ? '- Contradicciones o incoherencias, dentro del texto o con las páginas base.'
            : soloEsta
              ? '- Contradicciones o incoherencias dentro del texto.'
              : '- Contradicciones o incoherencias, dentro del texto o con otras páginas que conozcas del sitio.',
          '- Riesgos y consecuencias de lo que se decide ahí.',
          '',
          'Separa siempre lo que dice la fuente de lo que aportas tú. Cuando algo sea juicio propio, dilo.'
        )
      }
      out.push(
        '',
        'CÓMO NUMERAR, y esto es importante:',
        '- Cada observación empieza por su número entre corchetes: [1], [2], [3]… Numera de corrido, sin saltos y sin repetir.',
        '- Una observación, un pasaje. Si tienes dos cosas que decir sobre el mismo párrafo, son dos observaciones.',
        enJira
          ? '- Habla de trozos concretos del texto, no de la incidencia en general: después se subrayará en la página el fragmento del que habla cada número —un párrafo de la descripción, un comentario, un campo—, y una observación que no apunte a ninguna frase no se podrá marcar.'
          : '- Habla de trozos concretos del texto, no de la página en general: después se subrayará en la página el fragmento del que habla cada número, y una observación que no apunte a ninguna frase no se podrá marcar.',
        '- Como mucho ocho observaciones. Mejor cinco que importen que doce que no.'
      )
      // Sin la página en bloques no hay a qué apuntar: el bloque de anclas
      // sobraría, y la extensión no tendría contra qué resolverlo.
      if (ctx?.digest) out.push('', anchorsBlockRules())
      return out.join('\n')
    },
  },
]

/** La Skill pedida, o la general si el id no existe. */
export function skillById(id) {
  return SKILLS.find((s) => s.id === id) || SKILLS[0]
}

/**
 * El bloque de sistema de una Skill. Cadena vacía si no aporta nada.
 * @param {string} id
 * @param {{digest?: boolean, sources?: object|null, product?: string, projectKey?: string, cloud?: boolean, linked?: boolean}} [ctx]
 *        si la página va en el prompt en bloques ¶; las páginas base del
 *        análisis con su alcance (sólo las mira el modo Análisis); el
 *        producto en el que está el usuario ('jira' | 'confluence'), con su
 *        proyecto y si es Cloud si es Jira (Búsqueda); y si hay un Confluence
 *        enlazado del que hablar (Análisis en Jira)
 */
export function skillSystem(id, ctx = {}) {
  return skillById(id).system(ctx) || ''
}

/** ¿Esta Skill ofrece la tarjeta «Puedo llevarte»? */
export function offersNavigation(id) {
  return !!skillById(id).offersNavigation
}
