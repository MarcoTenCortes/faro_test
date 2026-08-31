import { test, eq, assert } from '../harness.js'
import { normalize, findQuote, similarity, levenshtein, bestHeading } from '../../src/content/anchor-match.js'

test('normalize: colapsa espacios y mantiene el mapa de posiciones', () => {
  const r = normalize('  Hola\n\n  mundo  ')
  eq(r.text, 'hola mundo')
  eq(r.map.length, r.text.length)
  eq(r.map[0], 2) // la 'H' original
})

test('normalize: unifica comillas y guiones tipográficos', () => {
  eq(normalize('“hola” — ‘mundo’').text, '"hola" - \'mundo\'')
})

test('findQuote: encuentra la cita y devuelve posiciones del texto original', () => {
  const html = 'Por política de seguridad el token expira a los 90 días y debe rotarse.'
  const r = findQuote(html, { exact: 'el token expira a los 90 días' })
  assert(r, 'debería encontrarla')
  eq(html.slice(r.start, r.end), 'el token expira a los 90 días')
  eq(r.strategy, 'quote')
})

test('findQuote: el contexto desambigua entre apariciones repetidas', () => {
  const text = 'Primera vez: revisar el acceso. Segunda vez: revisar el acceso al fin.'
  const r = findQuote(text, { exact: 'revisar el acceso', prefix: 'Segunda vez: ' })
  assert(r)
  assert(r.start > 30, 'debe elegir la segunda aparición, no la primera')
})

test('findQuote: aguanta que el texto se haya reeditado un poco', () => {
  const text = 'El token de servicio expira a los 90 dias naturales y debe rotarse desde el panel.'
  const r = findQuote(text, { exact: 'El token expira a los 90 días naturales' })
  assert(r, 'la coincidencia aproximada debería salvarla')
  eq(r.strategy, 'fuzzy')
  assert(r.score >= 0.72)
})

test('findQuote: si de verdad no está, devuelve null', () => {
  const text = 'Esto habla de otra cosa completamente distinta.'
  eq(findQuote(text, { exact: 'rotación de credenciales de servicio cada noventa días' }), null)
})

test('findQuote: tolera espacios y saltos de línea repartidos', () => {
  const text = 'El   token\n\texpira   a los\n90 días.'
  const r = findQuote(text, { exact: 'El token expira a los 90 días' })
  assert(r, 'los espacios no deben impedir la coincidencia')
  eq(text.slice(r.start, r.end).replace(/\s+/g, ' '), 'El token expira a los 90 días')
})

test('findQuote: entradas vacías no revientan', () => {
  eq(findQuote('', { exact: 'x' }), null)
  eq(findQuote('hola', { exact: '' }), null)
  eq(findQuote('hola', null), null)
})

test('levenshtein y similarity', () => {
  eq(levenshtein('casa', 'casa'), 0)
  eq(levenshtein('casa', 'cosa'), 1)
  eq(levenshtein('', 'abc'), 3)
  eq(similarity('casa', 'casa'), 1)
  assert(similarity('casa', 'cosa') > 0.7)
  eq(similarity('abc', ''), 0)
})

test('bestHeading: encuentra el encabezado aunque no sea idéntico', () => {
  const headings = ['Introducción', 'Rotación de credenciales', 'Anexo']
  eq(bestHeading(headings, 'Rotación de credenciales'), 1)
  eq(bestHeading(headings, 'rotacion de credenciales'), 1)
  eq(bestHeading(headings, 'Presupuesto trimestral'), -1)
})

test('rendimiento: una página larga se resuelve rápido', () => {
  const filler = 'Contenido de relleno para simular una página larga de Confluence. '
  const text = filler.repeat(2000) + 'La frase que buscamos está justo aquí al final.'
  const t0 = Date.now()
  const r = findQuote(text, { exact: 'La frase que buscamos está justo aquí al final.' })
  const ms = Date.now() - t0
  assert(r, 'debe encontrarla')
  assert(ms < 400, `tardó ${ms}ms, demasiado para hacerlo en cada navegación`)
})
