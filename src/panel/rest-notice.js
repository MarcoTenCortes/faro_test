/**
 * Cuándo se le DICE al usuario que una lectura REST no salió, y con qué palabras.
 *
 * POR QUÉ EXISTE: la tarjeta de una búsqueda de Jira comprueba su lista contra la
 * API del propio sitio (H8). Si la API no contesta, la tarjeta de siempre sigue
 * entera y debajo sale UN aviso con el motivo —todo fallo silencioso tiene
 * contraparte visible (CLAUDE.md §8.14)—, pero «tu sesión no vale para la API»
 * debajo de CADA respuesta es ruido: se dice una vez por host y sesión, como la
 * tregua de `learnAncestry`. La revisión adversaria de H8 encontró que esa regla
 * vivía dentro de panel.js, donde sólo se prueba por regex, y que cuatro
 * mutaciones que BORRABAN el aviso (la tregua devolviendo siempre false, la clave
 * sin motivo, el primer aviso tragado…) dejaban las 1069 pruebas en verde. Lo que
 * el panel decide con una regla vive en un módulo puro con su prueba (§9), como
 * `screens.js`, `chat-scroll.js` o `links.js`.
 *
 * Puro: no toca DOM ni chrome; el conjunto de lo ya avisado entra por parámetro.
 */

/**
 * Los motivos de fallo cuyo aviso SÍ merece repetirse.
 *
 * Un 400 habla de ESA consulta y trae el mensaje del servidor: verlo cada vez es
 * el único modo de saber qué cláusula no acepta esta instancia. Todo lo demás
 * —la sesión no vale, esto es Cloud, no hubo red— diría lo mismo debajo de cada
 * respuesta, así que se dice una vez por host y sesión.
 */
export const REST_REASON_ALWAYS = Object.freeze(['jql'])

/**
 * ¿Toca decir este fallo, o ya se dijo? Marca al preguntar: quien pregunta es
 * quien va a pintar el aviso.
 *
 * @param {Set<string>} warned lo ya avisado (del estado del panel); se MUTA
 * @param {string} reason el código del fallo (`'sesion'`, `'red'`, `'cloud'`…)
 * @param {string} host el sitio del que era la lectura
 * @param {string|null} sessionID la sesión con la que se pidió (puede no haber)
 * @returns {boolean} true la PRIMERA vez de cada host · sesión · motivo, y
 *          siempre para los de `REST_REASON_ALWAYS`
 */
export function restFailureDue(warned, reason, host, sessionID) {
  const motivo = String(reason || '')
  if (REST_REASON_ALWAYS.includes(motivo)) return true
  // Sin dónde apuntar no hay tregua que llevar: se avisa, que es el lado seguro.
  if (!(warned instanceof Set)) return true
  const clave = `${host || ''}:${sessionID || ''}:${motivo}`
  if (warned.has(clave)) return false
  warned.add(clave)
  return true
}

/**
 * Por qué no se pudo leer la lista, en palabras del usuario.
 *
 * El `reason` que devuelve `jira-rest.js` es un CÓDIGO y `messages` son los
 * mensajes del SERVIDOR (acotados por `REST_ERROR_LIMITS`): se enseñan, no se
 * interpretan.
 */
export function jqlFailText(r, host) {
  const reason = String(r?.reason || '')
  const delServidor = (Array.isArray(r?.messages) ? r.messages : []).filter((m) => typeof m === 'string' && m).join(' · ')
  if (reason === 'jql') return `Jira no acepta esta consulta: ${delServidor || 'la ha rechazado sin decir por qué'}.`
  if (reason === 'sesion') return `Tu sesión de ${host} no vale para su API: recarga la pestaña y vuelve a entrar.`
  if (reason === 'red') return 'No he podido hablar con la API de Jira: ' + (r?.detail || 'sin respuesta') + '.'
  if (!r) return 'La pestaña no ha contestado.'
  return `No he podido leer la lista (${r.detail || reason || 'sin motivo'}).`
}
