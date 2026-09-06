/**
 * El texto de la página en bloques numerados.
 *
 * Lo que hay que proteger: que los bloques se enseñan al modelo con una forma
 * fija y estable, que la «pista» con la que después se reconoce un bloque sale
 * del texto que leyó la extensión, y que reconocer un bloque es comparar texto,
 * no fiarse del número. Si la página se desplaza un párrafo entre que se leyó y
 * se marcó, la marca tiene que seguir cayendo donde estaba el texto.
 */
import { test, eq, assert } from '../harness.js'
import { DIGEST_LIMITS, squash, blockHint, formatDigest, matchBlock } from '../../src/shared/digest.js'
import { ANCHOR_LIMITS } from '../../src/nav/validate.js'

const BLOQUES = [
  { id: 1, tag: 'h1', text: 'ADR-014 Rotación de tokens de servicio' },
  { id: 2, tag: 'h2', text: 'Contexto' },
  { id: 3, tag: 'p', text: 'Hasta ahora los tokens de servicio no caducaban.' },
  { id: 4, tag: 'p', text: 'Por política de seguridad el token expira a los 90 días naturales y debe rotarse.' },
  { id: 5, tag: 'código', text: 'apiVersion: networking.k8s.io/v1 kind: Ingress' },
]

// --- la forma en que lo ve el modelo --------------------------------------

test('digest: una línea por bloque, con su número y su tipo', () => {
  const lineas = formatDigest(BLOQUES).split('\n')
  eq(lineas.length, 5)
  eq(lineas[0], '¶1 [h1] ADR-014 Rotación de tokens de servicio')
  eq(lineas[1], '¶2 [h2] Contexto')
  eq(lineas[4], '¶5 [código] apiVersion: networking.k8s.io/v1 kind: Ingress')
  eq(formatDigest([]), '')
  eq(formatDigest(null), '')
})

test('digest: squash colapsa tabuladores y saltos, y recorta por los lados', () => {
  eq(squash('  hola \t\n  mundo  '), 'hola mundo')
  eq(squash(null), '')
  eq(squash('uno\n\n\ndos'), 'uno dos')
})

test('digest: la pista son las primeras letras del bloque, ya limpias', () => {
  eq(blockHint('  Hasta ahora  los tokens\nno caducaban. '), 'Hasta ahora los tokens no caducaban.')
  const larga = blockHint('x'.repeat(500))
  eq(larga.length, DIGEST_LIMITS.hintMax)
  eq(blockHint(''), '')
})

test('digest: los topes son los que documenta el README', () => {
  eq(DIGEST_LIMITS.maxChars, 30000)
  eq(DIGEST_LIMITS.maxBlocks, 400)
  eq(DIGEST_LIMITS.hintMax, 80)
  eq(DIGEST_LIMITS.quoteMinGlobal, 8)
  assert(DIGEST_LIMITS.blockMax > DIGEST_LIMITS.hintMax, 'un bloque recortado sigue teniendo pista entera')
  // La pista pasa por validateAnchor, que la recorta a affixMax: si los dos
  // topes no coinciden, la pista guardada no es la que se comprueba después.
  eq(DIGEST_LIMITS.hintMax, ANCHOR_LIMITS.affixMax)
})

// --- reconocer el bloque -------------------------------------------------

test('matchBlock: el número acierta y el texto lo confirma', () => {
  eq(matchBlock(BLOQUES, { block: 4, hint: blockHint(BLOQUES[3].text) }), { index: 3, strategy: 'block' })
})

test('matchBlock: si la página se desplazó un bloque, manda el texto', () => {
  // Alguien añadió un párrafo por encima: lo que era ¶4 ahora es ¶5.
  const desplazados = [BLOQUES[0], { id: 2, tag: 'p', text: 'Nota añadida hoy.' }, ...BLOQUES.slice(1)].map((b, i) => ({
    ...b,
    id: i + 1,
  }))
  const r = matchBlock(desplazados, { block: 4, hint: blockHint(BLOQUES[3].text) })
  eq(r, { index: 4, strategy: 'block-moved' })
})

test('matchBlock: con dos bloques iguales gana el más cercano al número esperado', () => {
  const repetidos = [
    { id: 1, tag: 'p', text: 'Pendiente.' },
    { id: 2, tag: 'p', text: 'Otra cosa.' },
    { id: 3, tag: 'p', text: 'Pendiente.' },
    { id: 4, tag: 'p', text: 'Pendiente.' },
  ]
  eq(matchBlock(repetidos, { block: 5, hint: 'Pendiente.' }), { index: 3, strategy: 'block-moved' })
  eq(matchBlock(repetidos, { block: 2, hint: 'Pendiente.' }), { index: 0, strategy: 'block-moved' })
})

test('matchBlock: sin pista no hay bloque, y un número solo no vale', () => {
  // El número lo pone el modelo; la pista la pone la extensión. Sin la segunda,
  // marcar «el párrafo 3» sería marcar lo que sea que haya ahí ahora.
  eq(matchBlock(BLOQUES, { block: 3, hint: '' }), null)
  eq(matchBlock(BLOQUES, { block: 3 }), null)
  eq(matchBlock(BLOQUES, null), null)
  eq(matchBlock(null, { block: 1, hint: 'ADR' }), null)
})

test('matchBlock: un texto que ya no está en ninguna parte no encuentra bloque', () => {
  eq(matchBlock(BLOQUES, { block: 2, hint: 'Este párrafo se borró' }), null)
})

test('matchBlock: comillas tipográficas, mayúsculas y espacios no rompen la comprobación', () => {
  const r = matchBlock(BLOQUES, { block: 4, hint: 'POR  POLÍTICA DE SEGURIDAD EL TOKEN' })
  eq(r, { index: 3, strategy: 'block' })
  const tipografico = [{ id: 1, tag: 'p', text: 'Dice «hola» — y sigue' }]
  eq(matchBlock(tipografico, { block: 1, hint: 'Dice "hola" - y sigue' }), { index: 0, strategy: 'block' })
})

test('matchBlock: un número fuera de rango o roto no tumba la búsqueda por texto', () => {
  eq(matchBlock(BLOQUES, { block: 999, hint: 'Contexto' }), { index: 1, strategy: 'block-moved' })
  eq(matchBlock(BLOQUES, { block: 'x', hint: 'Contexto' }), { index: 1, strategy: 'block-moved' })
  eq(matchBlock(BLOQUES, { block: 0, hint: 'Contexto' }), { index: 1, strategy: 'block-moved' })
})
