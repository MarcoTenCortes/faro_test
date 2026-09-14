/**
 * ¿Está el chat pegado al fondo? (src/panel/chat-scroll.js)
 *
 * El chat se desplazaba al fondo en cada trozo de respuesta aunque el usuario
 * hubiera subido a leer (docs/PLAN.md §2.5 A7, reproducido en la auditoría del
 * 2026-09-13). La medida se toma en cada scroll, ANTES de que el siguiente
 * trozo mueva nada, y es esto lo que decide si se sigue al final.
 */
import { test, eq } from '../harness.js'
import { stuckToBottom, SCROLL_SLACK } from '../../src/panel/chat-scroll.js'

test('stuckToBottom: arriba del todo no está pegado', () => {
  eq(stuckToBottom({ scrollTop: 0, scrollHeight: 2000, clientHeight: 600 }), false)
})

test('stuckToBottom: exactamente al fondo sí', () => {
  eq(stuckToBottom({ scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 }), true)
})

test('stuckToBottom: a menos de la holgura del fondo también (un par de líneas no es «haber subido a leer»)', () => {
  eq(SCROLL_SLACK, 48)
  eq(stuckToBottom({ scrollTop: 1360, scrollHeight: 2000, clientHeight: 600 }), true)
  eq(stuckToBottom({ scrollTop: 1352, scrollHeight: 2000, clientHeight: 600 }), true, 'justo en la holgura')
})

test('stuckToBottom: más lejos que la holgura, no', () => {
  eq(stuckToBottom({ scrollTop: 1300, scrollHeight: 2000, clientHeight: 600 }), false)
  eq(stuckToBottom({ scrollTop: 1351, scrollHeight: 2000, clientHeight: 600 }), false, 'un píxel más allá')
})

test('stuckToBottom: la holgura se puede cambiar, y un chat que cabe entero está pegado', () => {
  eq(stuckToBottom({ scrollTop: 1300, scrollHeight: 2000, clientHeight: 600 }, 100), true)
  eq(stuckToBottom({ scrollTop: 1300, scrollHeight: 2000, clientHeight: 600 }, 0), false)
  eq(stuckToBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 }), true, 'sin nada que desplazar')
})

test('stuckToBottom: sin medidas (o con medidas que no son números) se da por pegado, que es el comportamiento de antes', () => {
  eq(stuckToBottom({}), true)
  eq(stuckToBottom(null), true)
  eq(stuckToBottom({ scrollTop: 'x', scrollHeight: 2000, clientHeight: 600 }), true)
  eq(stuckToBottom({ scrollTop: 0, scrollHeight: NaN, clientHeight: 600 }), true)
})
