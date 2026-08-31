/**
 * El contrato entre el modelo y la extensión.
 *
 * Fíjate en lo que NO hay aquí: ni URLs ni selectores CSS. El modelo sólo
 * puede nombrar identificadores que ya existen en el índice. Un modelo
 * alucinado produce un plan que no se resuelve, no una navegación a un sitio
 * equivocado.
 */

export const TARGET_KINDS = ['confluence-page', 'confluence-space', 'jira-issue', 'jira-project']

export const NAVIGATION_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    navigate: {
      type: 'boolean',
      description: 'false si la respuesta no tiene un destino concreto al que llevar al usuario',
    },
    mode: {
      type: 'string',
      enum: ['direct', 'assisted'],
      description: 'direct = un salto; assisted = recorrido paso a paso por la interfaz',
    },
    destination: {
      type: 'object',
      description: 'A dónde hay que llegar. El id debe existir en el índice que se te ha dado.',
      properties: {
        kind: { type: 'string', enum: TARGET_KINDS },
        id: {
          type: 'string',
          description: 'id numérico de página, clave de espacio (ENG), clave de incidencia (ABC-12) o de proyecto',
        },
      },
      required: ['kind', 'id'],
    },
    anchor: {
      type: 'object',
      description: 'La parte concreta de la página que hay que resaltar, si la hay.',
      properties: {
        kind: { type: 'string', enum: ['heading', 'text-quote', 'none'] },
        headingText: { type: 'string', description: 'texto exacto del encabezado, si kind=heading' },
        exact: { type: 'string', description: 'cita literal del documento, si kind=text-quote' },
        prefix: { type: 'string', description: 'hasta 60 caracteres justo antes de la cita' },
        suffix: { type: 'string', description: 'hasta 60 caracteres justo después de la cita' },
      },
      required: ['kind'],
    },
    path: {
      type: 'array',
      description:
        'Sólo para mode=assisted: los saltos intermedios por la interfaz, de más general a más concreto. El último debe ser el destino.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: TARGET_KINDS },
          id: { type: 'string' },
          label: { type: 'string', description: 'qué contarle al usuario en este paso' },
        },
        required: ['kind', 'id'],
      },
    },
    explanation: {
      type: 'string',
      description: 'Una frase para el usuario sobre qué va a ver allí.',
    },
  },
  required: ['navigate', 'mode', 'explanation'],
}

/** Instrucciones que acompañan al esquema. */
export function plannerSystemPrompt() {
  return [
    'Eres el planificador de navegación de Faro, dentro de Jira y Confluence.',
    'Tu única salida es un NavigationPlan que cumpla el esquema.',
    '',
    'Reglas estrictas:',
    '- Sólo puedes usar identificadores que aparezcan en el ÍNDICE que se te da. Si el sitio que quieres nombrar no está, pon navigate=false.',
    '- Nunca inventes URLs, rutas ni selectores CSS. No los pidas ni los emitas.',
    '- Usa mode="assisted" cuando merezca la pena enseñar el camino por la interfaz (el usuario aprende dónde vive la información); usa "direct" cuando sólo quiera llegar.',
    '- En "path", el primer paso es lo más general (espacio o proyecto) y el último es exactamente el destino.',
    '- Rellena "anchor" sólo si estás citando una parte concreta. Si citas texto, "exact" debe ser una frase literal del documento, entre 3 y 300 caracteres.',
    '- "explanation" va en el mismo idioma que la conversación, y en una sola frase.',
  ].join('\n')
}
