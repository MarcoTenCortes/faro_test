import { test, eq, assert } from '../harness.js'
import { startTiming, timingLine, LABEL_MAX } from '../../src/shared/timing.js'

/** Reloj de mentira: devuelve los valores en orden y se queda en el último. */
function reloj(valores) {
  let i = 0
  return () => valores[Math.min(i++, valores.length - 1)]
}

/**
 * Separador de línea (U+2028), separador de párrafo (U+2029) y NEL (U+0085).
 * Se construyen con `fromCharCode` para no dejar caracteres invisibles en el
 * fuente de la prueba.
 */
const [LS, PS, NEL] = [0x2028, 0x2029, 0x0085].map((c) => String.fromCharCode(c))

test('timing: las fases salen en orden y miden desde la marca anterior', () => {
  // Arranque en 0, health a 1 ms, modelos a 62 ms, done a 182 ms: es el
  // ejemplo del anexo E («182 ms · health 1 ms · modelos 61 ms»).
  const t = startTiming(reloj([0, 1, 62, 182]))
  eq(t.mark('health'), 1, 'mark devuelve los ms de su fase')
  eq(t.mark('modelos'), 61, 'la segunda fase mide desde la primera, no desde el arranque')
  eq(t.done(), {
    total: 182,
    phases: [
      { label: 'health', ms: 1 },
      { label: 'modelos', ms: 61 },
    ],
  })
})

test('timing: done() da el total desde el arranque, no la suma de las fases', () => {
  // Lo que pasa entre la última marca y done() no es de ninguna fase: el total
  // es el que manda en «Arranque del panel».
  const t = startTiming(reloj([1000, 1010, 1500]))
  t.mark('health')
  const r = t.done()
  eq(r.total, 500)
  eq(r.phases, [{ label: 'health', ms: 10 }])
  assert(r.phases[0].ms < r.total, 'la suma de fases puede ser menor que el total')
})

test('timing: sin fases, done() sólo da el total; llamarlo dos veces no rompe', () => {
  const t = startTiming(reloj([0, 40, 90]))
  eq(t.done(), { total: 40, phases: [] })
  eq(t.done(), { total: 90, phases: [] }, 'vuelve a leer el reloj, no se congela')
})

test('timing: la foto es una copia; marcar después no la cambia', () => {
  const t = startTiming(reloj([0, 10, 20, 30]))
  t.mark('health')
  const foto = t.done()
  t.mark('modelos')
  eq(foto.phases.length, 1, 'la foto de antes sigue con una sola fase')
})

test('timing: un reloj que va hacia atrás no da fases ni totales negativos', () => {
  const t = startTiming(reloj([1000, 900, 800]))
  const ms = t.mark('health')
  eq(ms, 0)
  eq(t.done().total, 0)
})

test('timing: sin reloj inyectado usa Date.now y no falla', () => {
  const t = startTiming()
  t.mark('health')
  const r = t.done()
  assert(Number.isFinite(r.total) && r.total >= 0, `total raro: ${r.total}`)
  eq(r.phases.length, 1)
  assert(Number.isFinite(r.phases[0].ms) && r.phases[0].ms >= 0, 'ms raro')
  // Un `now` que no es función tampoco tumba nada.
  const u = startTiming('ayer')
  assert(Number.isFinite(u.done().total), 'con un reloj inválido cae en Date.now')
})

test('timingLine: el total primero y cada fase detrás', () => {
  const t = startTiming(reloj([0, 1, 62, 182]))
  t.mark('health')
  t.mark('modelos')
  eq(timingLine(t.done()), '182 ms · health 1 ms · modelos 61 ms')
})

test('timingLine: milisegundos, segundos y minutos según el tamaño', () => {
  // El GET /mcp en frío mide segundos (2 811-13 768 ms medidos en la
  // auditoría): en la línea del Registro tiene que leerse como segundos.
  eq(timingLine({ total: 14200, phases: [{ label: 'MCP', ms: 13768 }] }), '14,2 s · MCP 13,8 s')
  eq(timingLine({ total: 999, phases: [] }), '999 ms')
  eq(timingLine({ total: 1000, phases: [] }), '1,0 s')
  eq(timingLine({ total: 72000, phases: [] }), '1 min 12 s')
})

test('timingLine: extra se pega al final, una cadena o varias', () => {
  const t = { total: 120, phases: [{ label: 'restaurar', ms: 100 }] }
  eq(timingLine(t, { extra: '12 KB' }), '120 ms · restaurar 100 ms · 12 KB')
  eq(timingLine(t, { extra: ['12 KB', '60 mensajes'] }), '120 ms · restaurar 100 ms · 12 KB · 60 mensajes')
  eq(timingLine(t, { extra: '' }), '120 ms · restaurar 100 ms', 'lo vacío no deja un separador colgando')
  eq(timingLine(t, { extra: [null, undefined, '  '] }), '120 ms · restaurar 100 ms')
  eq(timingLine(t), '120 ms · restaurar 100 ms', 'sin opciones')
  // SEGURIDAD: extra también se aplana (conserva el «·»: puede venir ya con
  // sus propios separadores, pero no puede abrir una línea nueva).
  eq(timingLine(t, { extra: `12 KB${NEL}· 60 mensajes` }), '120 ms · restaurar 100 ms · 12 KB · 60 mensajes')
  eq(timingLine(t, { extra: 'sistema\n26 400 caracteres' }), '120 ms · restaurar 100 ms · sistema 26 400 caracteres')
})

test('timingLine: una foto rara no lanza', () => {
  eq(timingLine(null), '')
  eq(timingLine(undefined), '')
  eq(timingLine('ayer'), '')
  eq(timingLine({}), '0 ms', 'sin total, cero')
  eq(timingLine({ total: 'x', phases: 'x' }), '0 ms')
  eq(timingLine({ total: 5, phases: [null, 7, { label: 'a' }] }), '5 ms · a 0 ms', 'las fases sin forma se caen')
  eq(timingLine(null, { extra: 'sólo esto' }), 'sólo esto')
})

test('SEGURIDAD: una etiqueta con saltos se aplana a una línea', () => {
  // Una etiqueta la escribe Faro, pero algún día podría llevar un host o el id
  // de una Skill: una sola fase no puede convertirse en dos líneas del
  // Registro ni fingir más fases con el separador «·».
  const t = startTiming(reloj([0, 10, 20]))
  t.mark('MCP\nGET /mcp')
  t.mark(`a${LS}b${PS}c${NEL}d`)
  const r = t.done()
  eq(r.phases[0].label, 'MCP GET /mcp')
  eq(r.phases[1].label, 'a b c d', 'U+2028, U+2029 y el NEL también abren línea')
  const linea = timingLine(r)
  eq(linea.includes('\n'), false, 'la línea es una línea')
  eq([LS, PS, NEL].some((c) => linea.includes(c)), false, 'ni separadores Unicode')
  eq(linea, '20 ms · MCP GET /mcp 10 ms · a b c d 10 ms')
})

test('SEGURIDAD: una etiqueta no puede fingir otra fase con «·» ni crecer sin fin', () => {
  const t = startTiming(reloj([0, 10, 20]))
  t.mark('health · 999 ms · contraseña')
  t.mark('x'.repeat(200))
  const r = t.done()
  eq(r.phases[0].label, 'health 999 ms contraseña', 'el «·» se va: la línea la separa timingLine')
  eq(r.phases[1].label.length, LABEL_MAX)
  eq(timingLine(r).split(' · ').length, 3, 'total + dos fases, ni una más')
})

test('SEGURIDAD: en la línea sólo hay etiquetas y números', () => {
  // Nada de cuerpos, URLs, claves ni contraseñas: el módulo no los recibe, y
  // lo único que sale de una fase es su etiqueta y sus milisegundos.
  const t = startTiming(reloj([0, 5, 9]))
  t.mark('')
  t.mark(null)
  const r = t.done()
  eq(r.phases.map((p) => p.label), ['fase', 'fase'], 'una etiqueta vacía no deja la línea empezando por un espacio')
  eq(timingLine(r), '9 ms · fase 5 ms · fase 4 ms')
  eq(Object.keys(r).sort(), ['phases', 'total'])
  eq(Object.keys(r.phases[0]).sort(), ['label', 'ms'])
})
