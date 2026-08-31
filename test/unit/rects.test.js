/**
 * Los rectángulos que se pintan sobre lo marcado.
 *
 * Vino de una captura del usuario: marcar cuatro líneas de un YAML dentro de un
 * bloque de código salía a manchas, con barras blancas escalonadas asomando por
 * la izquierda del bloque. `getClientRects()` no daba una caja por línea, daba
 * DIECISIETE —una por cada `<span>` de color, varias repetidas— y el amarillo se
 * apilaba encima de sí mismo.
 */
import { test, eq, assert } from '../harness.js'
import { mergeRects, clipRects } from '../../src/content/overlay/rects.js'

const caja = (top, left, width, height = 19) => ({ top, left, width, height })

test('EL CASO REAL: diecisiete cajas de un bloque de código quedan en cinco líneas', () => {
  // Copiado tal cual de lo que devolvió Chrome sobre el YAML del banco.
  const crudo = [
    caja(234, 333, 34), caja(234, 367, 7),
    caja(256, 319, 41), caja(256, 360, 28), caja(256, 360, 28), caja(256, 388, 14),
    caja(256, 402, 103), caja(256, 402, 103),
    caja(279, 319, 41), caja(279, 360, 28), caja(279, 360, 28), caja(279, 388, 7),
    caja(301, 319, 55), caja(301, 374, 34), caja(301, 374, 34), caja(301, 408, 7),
    caja(323, 319, 69),
  ]

  const r = mergeRects(crudo)
  eq(r.length, 5, 'una barra por línea')
  eq(r.map((x) => x.top), [234, 256, 279, 301, 323])
  eq(r[1], caja(256, 319, 186), 'la línea larga se funde entera')
})

test('un rectángulo repetido no se pinta dos veces', () => {
  eq(mergeRects([caja(10, 20, 50), caja(10, 20, 50)]), [caja(10, 20, 50)])
})

test('un rectángulo dentro de otro desaparece dentro de él', () => {
  eq(mergeRects([caja(10, 20, 100), caja(10, 40, 20)]), [caja(10, 20, 100)])
})

test('dos trozos separados en la misma línea siguen siendo dos', () => {
  // Entre «uno» y «dos» hay medio párrafo: son dos marcas, no una barra larga.
  const r = mergeRects([caja(10, 20, 30), caja(10, 200, 30)])
  eq(r.length, 2)
  eq(r.map((x) => x.left), [20, 200])
})

test('el hueco entre dos palabras no parte la marca', () => {
  eq(mergeRects([caja(10, 20, 30), caja(10, 52, 30)]), [caja(10, 20, 62)], 'dos píxeles de hueco se cosen')
})

test('líneas distintas no se funden aunque se solapen en horizontal', () => {
  const r = mergeRects([caja(10, 20, 100), caja(32, 20, 100)])
  eq(r.length, 2)
})

test('una diferencia de un píxel entre líneas sigue siendo la misma línea', () => {
  // Pasa con superíndices y con tipografías mezcladas dentro de un renglón.
  eq(mergeRects([caja(10, 20, 30), caja(11, 50, 30)]).length, 1)
})

test('lo que no se ve no se pinta', () => {
  eq(mergeRects([caja(10, 20, 0), caja(10, 20, 30, 0)]), [])
  eq(mergeRects([]), [])
  eq(mergeRects(null), [])
  eq(mergeRects([null, undefined]), [])
})

test('salen en orden de lectura', () => {
  const r = mergeRects([caja(50, 200, 10), caja(10, 300, 10), caja(50, 20, 10), caja(10, 20, 10)])
  eq(r.map((x) => [x.top, x.left]), [
    [10, 20],
    [10, 300],
    [50, 20],
    [50, 200],
  ])
})

test('un solo rectángulo pasa tal cual', () => {
  eq(mergeRects([caja(10, 20, 30)]), [caja(10, 20, 30)])
})

test('valores raros no revientan la fusión', () => {
  const r = mergeRects([{ top: 'x', left: null, width: 30, height: 19 }])
  eq(r.length, 1)
  assert(Number.isFinite(r[0].top) && Number.isFinite(r[0].left), 'se normalizan a números')
})

// --- recortados a su contenedor -----------------------------------------
// Los rectángulos llevan coordenadas de viewport y son position:fixed, así que
// no los recorta nadie. Un bloque de código con scroll horizontal recorta su
// texto; si la marca no se recorta igual, se pinta fuera del bloque.

const bloque = { top: 100, left: 300, width: 200, height: 120 }

test("clipRects: lo que se sale del bloque se corta", () => {
  eq(clipRects([caja(110, 250, 200)], bloque), [caja(110, 300, 150)], "asomaba por la izquierda")
  eq(clipRects([caja(110, 400, 200)], bloque), [caja(110, 400, 100)], "y por la derecha")
})

test("clipRects: lo que queda fuera del todo no se pinta", () => {
  eq(clipRects([caja(110, 100, 50)], bloque), [])
  eq(clipRects([caja(400, 320, 50)], bloque), [], "por debajo del bloque")
})

test("clipRects: lo que cabe entero no se toca", () => {
  eq(clipRects([caja(110, 320, 100)], bloque), [caja(110, 320, 100)])
})

test("clipRects: sin contenedor que recorte, todo pasa", () => {
  const dentro = [caja(110, 250, 200)]
  eq(clipRects(dentro, null), dentro)
  eq(clipRects(null, bloque), [])
})

test("clipRects: un recorte que deja una astilla no se pinta", () => {
  eq(clipRects([caja(110, 299, 1)], bloque), [], "menos de un pixel visible")
})
