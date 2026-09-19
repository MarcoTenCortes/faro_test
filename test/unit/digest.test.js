/**
 * El texto de la página en bloques numerados.
 *
 * Lo que hay que proteger: que los bloques se enseñan al modelo con una forma
 * fija y estable, que la «pista» con la que después se reconoce un bloque sale
 * del texto que leyó la extensión, y que reconocer un bloque es comparar texto,
 * no fiarse del número. Si la página se desplaza un párrafo entre que se leyó y
 * se marcó, la marca tiene que seguir cayendo donde estaba el texto.
 *
 * La mitad pura (`src/shared/digest.js`) se ejecuta aquí. La otra mitad
 * (`src/content/digest.js`) necesita DOM, así que de ella se pina el cableado
 * por regex sobre el fuente, como hacen runner-wiring y overlay-wiring: que el
 * ÁMBITO de lectura se calcule una vez y se reparta (P7 de H6).
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// --- P7 (H6): el ámbito de lectura, calculado una vez y repartido ----------
// Por regex sobre `src/content/digest.js`, que necesita DOM para ejecutarse.

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const CONTENT = sinComentarios(readFileSync(join(ROOT, 'src/content/digest.js'), 'utf8'))

/** El cuerpo de una función de nivel superior: de su firma al «}» de la columna 0. */
function funcion(firma) {
  const ini = CONTENT.indexOf(firma)
  assert(ini >= 0, `src/content/digest.js no tiene «${firma}»`)
  const fin = CONTENT.indexOf('\n}\n', ini)
  assert(fin > ini, `no se encuentra el cierre de «${firma}»`)
  return CONTENT.slice(ini, fin)
}

const cuenta = (src, trozo) => src.split(trozo).length - 1

test('P7: resolveBlockQuote acepta el ámbito ya calculado y lo usa en los tres sitios que lo pedían', () => {
  const fn = funcion('export function resolveBlockQuote(')
  assert(
    fn.includes('export function resolveBlockQuote(anchor, { digest = null, scope = null } = {})'),
    'el ámbito entra por opciones, con valor por defecto para quien no lo pase'
  )
  eq(cuenta(fn, 'digestScope()'), 1, 'como mucho una llamada, y sólo si no llegó el ámbito')
  // Y el que llega es el que se usa. Sin este pin, cambiar la inicialización a
  // `let ambito = null` dejaba las 943 pruebas en verde con el ámbito recibido
  // tirado a la basura: cada observación volvía a calcularlo, que es justo lo
  // que P7 quitó (revisión adversaria de H6).
  assert(fn.includes('let ambito = scope'), 'la variable perezosa arranca con el ámbito RECIBIDO, no vacía')
  assert(/const elAmbito = \(\) =>/.test(fn), 'y perezosa: con `digest` y `scope` dados no se calcula nada')
  assert(fn.includes('pageDigest({ scope: elAmbito() })'), 'leer la página usa ese ámbito')
  assert(fn.includes('blockBoundary(elAmbito())'), 'la frontera del texto del bloque, también')
  assert(fn.includes('resolveScopedQuote(exact, { scope: elAmbito() })'), 'y el peldaño global')
})

test('P7: el índice de texto de una raíz se memoriza en el ámbito, no se reconstruye por observación', () => {
  const fn = funcion('export function resolveScopedQuote(')
  assert(fn.includes('rootIndex(scope, r.el)'), 'la cita suelta pide el índice memorizado')
  assert(!fn.includes('buildTextIndex('), 'y no lo construye ella')
  const memo = funcion('function rootIndex(')
  assert(memo.includes('scope._indices.get(root)'), 'el índice se busca en el ámbito, que dura lo que una pasada de marcado')
  assert(memo.includes('scope._indices.set(root, index)'), 'y se guarda ahí: si no, memorizar no memoriza nada')
  assert(memo.includes('buildTextIndex('), 'y se construye una sola vez por raíz')
})
