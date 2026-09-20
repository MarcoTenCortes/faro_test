/**
 * Lo poco de src/content/dom-utils.js que se puede probar sin navegador.
 *
 * Casi todo lo que hay ahí mide cajas, espera a que la página se quede quieta o
 * recorre contenedores con scroll: eso vive en el banco (harness/) porque sin un
 * navegador de verdad no significaría nada. `pageIdFromDom` no: es un parser de
 * una línea del que sale un identificador que acaba en una clave de
 * almacenamiento y en una URL, y de esos se responde en Node.
 *
 * El `document` se instala DENTRO de cada prueba y se retira al salir, como en
 * markdown.test.js: dom-utils.js no toca el DOM al importarse, y estas pruebas
 * corren en el mismo proceso que todas las demás.
 */
import { test, eq } from '../harness.js'
import { pageIdFromDom } from '../../src/content/dom-utils.js'

/**
 * Un `document` con lo justo que usa `pageIdFromDom`: `querySelector` del
 * selector de la meta y `getAttribute` sobre lo que devuelva.
 */
function conDocument(content, fn) {
  const antes = globalThis.document
  globalThis.document = {
    querySelector: (sel) =>
      sel === 'meta[name="ajs-page-id"]' && content !== null
        ? { getAttribute: (n) => (n === 'content' ? content : null) }
        : null,
  }
  try {
    return fn()
  } finally {
    if (antes === undefined) delete globalThis.document
    else globalThis.document = antes
  }
}

test('pageIdFromDom: el id de la meta de Confluence Server, o nada', () => {
  // Es lo ÚNICO que identifica una página `/display/ESPACIO/Título` de un Data
  // Center: la URL no lleva el id por ninguna parte.
  conDocument('98830281', () => eq(pageIdFromDom(), '98830281'))
  conDocument(' 3003 ', () => eq(pageIdFromDom(), '3003', 'con espacios alrededor sigue siendo el id'))
  // Sin la meta (Cloud, una incidencia de Jira, el banco fuera de una página).
  conDocument(null, () => eq(pageIdFromDom(), ''))
  conDocument('', () => eq(pageIdFromDom(), ''))
})

test('SEGURIDAD: de la meta sólo sale un número', () => {
  // El contenido de una meta lo escribe la página, y de aquí sale un
  // identificador que se usa para montar una clave de almacenamiento y una URL.
  for (const raro of [
    '../../etc',
    '3003 OR 1=1',
    '3003abc',
    'abc',
    '<img onerror=x>',
    '30 03',
    '-3003',
    '3.0',
    '12345678901234567890',
  ]) {
    conDocument(raro, () => eq(pageIdFromDom(), '', raro))
  }
})
