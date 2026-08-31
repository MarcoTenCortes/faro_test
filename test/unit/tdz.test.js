/**
 * La red contra «usar antes de declarar».
 *
 * Existe porque se coló uno: en `offerNotes` una línea leía `pagina.url` dos
 * líneas antes del `const pagina = await …`, y el panel se cayó con «Cannot
 * access 'pagina' before initialization» justo cuando el usuario pidió un
 * análisis. `node --check` no lo ve —parsear no ejecuta—, así que hacía falta
 * esto. Y como un aviso que se ignora no es una red sino ruido, aquí se
 * comprueba también todo lo que NO debe avisar.
 */
import { test, eq, assert } from '../harness.js'
import { findUseBeforeDeclare, stripNoise } from '../tdz.js'

const nombres = (src) => findUseBeforeDeclare(src, 'x.js').map((p) => p.nombre)

test('EL FALLO REAL: leer una constante dos líneas antes de declararla', () => {
  const roto = `
async function offerNotes(answer, bubble) {
  const urlAlPedir = pagina.url || state.tabUrl
  const pagina = await chrome.tabs.sendMessage(state.tabId, { type: MSG.PAGE_TEXT })
  return pagina
}`
  const [p] = findUseBeforeDeclare(roto, 'panel.js')
  eq(p.nombre, 'pagina')
  eq(p.funcion, 'offerNotes')
  assert(p.usoEn < p.declEn, 'se usa antes de declararse')
})

test('el orden correcto no avisa', () => {
  eq(
    nombres(`
function bien() {
  const pagina = leer()
  const url = pagina.url
  return url
}`),
    []
  )
})

// --- lo que NO debe avisar ------------------------------------------------

test('el mismo nombre en dos funciones no es un problema', () => {
  // Esto daba ciento cincuenta falsos positivos con el primer intento.
  eq(
    nombres(`
function una() {
  const got = 1
  return got
}
function otra() {
  const got = 2
  return got
}`),
    []
  )
})

test('una declaración dentro de un bloque anidado es otro ámbito', () => {
  eq(
    nombres(`
function f(algo) {
  if (algo) {
    const dentro = 1
    return dentro
  }
  const dentro = 2
  return dentro
}`),
    []
  )
})

test('un cierre que se llama después puede nombrar lo que viene luego', () => {
  eq(
    nombres(`
function f() {
  const usar = () => tarde
  const tarde = 1
  return usar()
}`),
    []
  )
})

// --- el limpiador ---------------------------------------------------------
// Lo que rompía el primer intento: borrar comentarios ANTES que cadenas hacía
// que el '//' de startsWith('//') se comiera el resto de la línea, y con él la
// comilla de cierre y el paréntesis. A partir de ahí el recuento de llaves ya
// no valía nada, y el aviso salía a doscientas líneas de distancia.

test('una barra doble dentro de una cadena no es un comentario', () => {
  const src = `
function toSafePath(raw) {
  if (raw.startsWith('//')) return null
  const out = raw
  return out
}
function otra() {
  const n = 1
  return n
}`
  eq(nombres(src), [], 'no debe confundirse de función')
  assert(stripNoise(src).includes('return null'), 'lo de después de la cadena sigue ahí')
})

test('una comilla dentro de un comentario no abre una cadena', () => {
  eq(
    nombres(`
function f() {
  // aquí hay una comilla ' suelta y una llave { de adorno
  const a = 1
  return a
}`),
    []
  )
})

test('una llave dentro de una expresión regular no descuadra el recuento', () => {
  eq(
    nombres(`
function f(s) {
  const re = /[{}]/g
  const limpio = s.replace(re, '')
  return limpio
}
function g() {
  const limpio = 2
  return limpio
}`),
    []
  )
})

test('una división no se confunde con una expresión regular', () => {
  eq(
    nombres(`
function f(a, b) {
  const mitad = (a + b) / 2
  const doble = mitad * 2
  return doble
}`),
    []
  )
})

test('el limpiador conserva las posiciones', () => {
  const src = "const a = 'hola' // adiós\nconst b = 2"
  const limpio = stripNoise(src)
  eq(limpio.length, src.length, 'mismo largo')
  eq(limpio.split('\n').length, src.split('\n').length, 'mismas líneas')
  assert(limpio.includes('const a ='), 'el código se queda')
  assert(!limpio.includes('adiós'), 'el comentario no')
  assert(!limpio.includes('hola'), 'la cadena tampoco')
})

test('parámetros con valores por defecto no despistan al recorte de la función', () => {
  const src = `
function f({ maxPages = 120, relevantTo = '' } = {}) {
  const usa = relevantTo
  return usa
}
function g() {
  const usa = 1
  return usa
}`
  eq(nombres(src), [])
})
