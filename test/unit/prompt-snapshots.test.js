/**
 * Instantáneas de los prompts completos.
 *
 * Por qué existe: cada área pina «sin X, byte a byte igual» por pares
 * —Búsqueda en Confluence igual que sin producto, `baseSystem` sin `sources`
 * igual que con `sources` vacío, Análisis en Confluence igual aunque llegue
 * `issue`— y eso protege cada rama por separado, pero una interacción CRUZADA
 * no la ve nadie: un cambio en `sobreQue` con alcance exclusivo desde Jira
 * con la incidencia en bloques y el Confluence enlazado sólo se nota leyendo
 * el prompt entero que sale de `send()`. Aquí se construyen esas
 * combinaciones con datos fijos (`test/fixtures/prompts/escenarios.js`, la
 * MISMA lista que usa `tools/prompt-snapshots.mjs`) y se comparan byte a byte
 * con lo guardado en `test/fixtures/prompts/<id>.txt`. Si algo difiere, el
 * fallo enseña la primera línea distinta con su número. Si el cambio es
 * intencionado, se regenera la línea base con `npm run snapshots` y se revisa
 * el diff de los .txt: regenerar es aceptar.
 *
 * Los fixtures se guardan con LF y se leen normalizando CRLF: el repo vive en
 * Windows con autocrlf y una instantánea no puede depender de eso.
 *
 * Los escenarios «largos» (`RECORTES`) existen porque los contextos de los
 * demás miden unos 500 caracteres frente a los 12 000 / 4 000 / 6 000 de
 * `CONTEXT_BUDGET` con página en bloques: ningún `.slice` de `baseSystem`
 * recortaba nada en ninguna instantánea, y un cambio del presupuesto o del
 * corte no se habría visto. Aquí se comprueba además que cada texto largo
 * SIGUE pasando de su presupuesto: si alguien lo sube por encima del texto,
 * el escenario dejaría de recortar en silencio.
 */
import { test, eq, assert, AssertionError } from '../harness.js'
import { CONTEXT_BUDGET } from '../../src/panel/prompts.js'
import { ESCENARIOS, RECORTES, readFixture, fixtureIdsOnDisk, firstDifference } from '../fixtures/prompts/escenarios.js'

const AYUDA = 'si el cambio es intencionado: npm run snapshots'

for (const esc of ESCENARIOS) {
  test(`instantánea «${esc.id}»: el prompt es byte a byte el guardado`, () => {
    const guardado = readFixture(esc.id)
    if (guardado === null) {
      throw new AssertionError(`falta test/fixtures/prompts/${esc.id}.txt · ${AYUDA}`)
    }
    const dif = firstDifference(guardado, esc.build())
    if (dif) {
      throw new AssertionError(
        `${esc.id}: difiere en la línea ${dif.line}\n` +
          `     guardado: ${dif.esperado}\n` +
          `     ahora:    ${dif.obtenido}\n` +
          `     ${AYUDA}`
      )
    }
  })
}

test('instantáneas: cada escenario da el mismo texto dos veces seguidas (nada depende de la hora)', () => {
  for (const esc of ESCENARIOS) eq(esc.build(), esc.build(), esc.id)
})

test('instantáneas: los ids son únicos, con forma de kebab, y no hay .txt huérfanos ni sin escenario', () => {
  const ids = ESCENARIOS.map((e) => e.id)
  eq(ids.length, new Set(ids).size, 'ids repetidos')
  for (const id of ids) assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id), `id con forma rara: ${id}`)
  eq(fixtureIdsOnDisk(), [...ids].sort(), 'los .txt de test/fixtures/prompts no son exactamente los escenarios')
})

test('instantáneas largas: cada texto largo pasa del presupuesto que ejercita y el prompt lo lleva cortado justo ahí', () => {
  eq(
    [...new Set(RECORTES.map((r) => r.budget))].sort(),
    ['contextWithDigest', 'linkedWithDigest', 'memoryWithDigest'],
    'los tres recortes con página en bloques tienen un escenario que los enseña'
  )
  for (const r of RECORTES) {
    const tope = CONTEXT_BUDGET[r.budget]
    assert(Number.isInteger(tope) && tope > 0, `CONTEXT_BUDGET.${r.budget} existe`)
    assert(
      r.texto.length > tope,
      `${r.id}: el texto de ${r.budget} mide ${r.texto.length} y el presupuesto es ${tope}: ya no recorta nada; agranda el texto en escenarios.js`
    )
    eq(r.texto, r.texto.trim(), `${r.id}: el texto va sin espacios en los bordes (baseSystem recorta tras trim)`)
    const prompt = ESCENARIOS.find((e) => e.id === r.id).build()
    const cabe = r.texto.slice(0, tope)
    const p = prompt.indexOf(cabe)
    assert(p >= 0, `${r.id}: el prompt lleva los ${tope} primeros caracteres de ${r.budget}`)
    assert(
      prompt.slice(p + tope).startsWith('\n--- FIN'),
      `${r.id}: tras el carácter ${tope} de ${r.budget} viene el cierre del bloque, no más texto`
    )
  }
})

test('firstDifference: null si son iguales; si no, la primera línea distinta numerada desde 1', () => {
  eq(firstDifference('a\nb', 'a\nb'), null)
  eq(firstDifference('a\nb\nc', 'a\nB\nc'), { line: 2, esperado: 'b', obtenido: 'B' })
  eq(firstDifference('a\nb', 'a\nb\nc'), { line: 3, esperado: '<fin del fichero>', obtenido: 'c' })
  eq(firstDifference('a\nb\nc', 'a\nb'), { line: 3, esperado: 'c', obtenido: '<fin del texto>' })
})
