/**
 * src/content/page-id.js: el id de la página de Confluence leído del DOM.
 *
 * Es todo lo que hay en ese módulo, y por eso el módulo existe: lo pide el aviso
 * de «esta pestaña está lista» en cada carga de página, y vivía en dom-utils.js,
 * que arrastra tree-dom.js y config.js (revisión adversaria de H11). Lo demás de
 * dom-utils.js mide cajas, espera a que la página se quede quieta o recorre
 * contenedores con scroll: eso vive en el banco (harness/), porque sin un
 * navegador de verdad no significaría nada. Esto no: es un parser de una línea
 * del que sale un identificador que acaba en una clave de almacenamiento y en una
 * URL, y de esos se responde en Node.
 *
 * El `document` se instala DENTRO de cada prueba y se retira al salir, como en
 * markdown.test.js: page-id.js no toca el DOM al importarse, y estas pruebas
 * corren en el mismo proceso que todas las demás.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pageIdFromDom } from '../../src/content/page-id.js'

const FUENTE = readFileSync(join(import.meta.dirname, '..', '..', 'src/content/page-id.js'), 'utf8')

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

test('H11 revisión: page-id.js no importa NADA, que es el motivo de que exista', () => {
  // Lo que arregló el fichero fue el peso del aviso de cada carga de página: si
  // vuelve a importar algo (dom-utils.js, config.js, site.js), vuelve a arrastrar
  // sus imports estáticos y el aviso vuelve a costar decenas de KB por
  // navegación. Y `pageIdFromDom` sale de AQUÍ y de ningún otro sitio: dejar una
  // reexportación en dom-utils.js sería dejar el import que se quitó.
  eq(FUENTE.match(/^\s*import\b/gm), null, 'page-id.js no puede importar nada: ' + (FUENTE.match(/^\s*import\b.*$/gm) || []).join(' · '))
  eq((FUENTE.match(/^export /gm) || []).length, 1, 'y exporta una sola cosa')
  const domUtils = readFileSync(join(import.meta.dirname, '..', '..', 'src/content/dom-utils.js'), 'utf8')
  assert(!/export function pageIdFromDom|export \{[^}]*pageIdFromDom/.test(domUtils), 'dom-utils.js ya no lo exporta ni lo reexporta')
})

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
