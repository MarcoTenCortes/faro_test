/**
 * Las instantáneas de los prompts: comprobarlas o regenerarlas.
 *
 *   node tools/prompt-snapshots.mjs            enseña cada escenario y si coincide
 *   node tools/prompt-snapshots.mjs --update   reescribe todos los .txt con el código actual
 *
 * Por qué existe: `test/unit/prompt-snapshots.test.js` falla en cuanto un
 * prompt cambia, y eso es lo que se quiere; pero cuando el cambio es
 * intencionado hace falta una forma de aceptar la nueva línea base sin editar
 * treinta y tantos ficheros a mano. La lista de escenarios es UNA
 * (`test/fixtures/prompts/escenarios.js`): lo que se regenera aquí es
 * exactamente lo que el test compara. Regenerar es aceptar: hay que mirar el
 * `git diff` de los .txt antes de commitear.
 */

import { ESCENARIOS, fixturePath, readFixture, writeFixture, fixtureIdsOnDisk, firstDifference } from '../test/fixtures/prompts/escenarios.js'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const update = process.argv.includes('--update')

function main() {
  console.log(`${BOLD}Faro · instantáneas de prompts${OFF} ${DIM}(${ESCENARIOS.length} escenarios)${OFF}\n`)

  let malos = 0
  for (const esc of ESCENARIOS) {
    const texto = esc.build()
    if (update) {
      const antes = readFixture(esc.id)
      writeFixture(esc.id, texto)
      const estado = antes === null ? 'nueva' : antes === texto ? 'sin cambios' : 'REESCRITA'
      console.log(`  ${estado === 'sin cambios' ? DIM : GREEN}${estado.padEnd(11)}${OFF} ${esc.id}  ${DIM}${esc.que}${OFF}`)
      continue
    }
    const guardado = readFixture(esc.id)
    if (guardado === null) {
      malos++
      console.log(`  ${RED}falta      ${OFF} ${esc.id}  ${DIM}${fixturePath(esc.id)}${OFF}`)
      continue
    }
    const dif = firstDifference(guardado, texto)
    if (!dif) {
      console.log(`  ${GREEN}coincide   ${OFF} ${esc.id}  ${DIM}${esc.que}${OFF}`)
      continue
    }
    malos++
    console.log(`  ${RED}difiere    ${OFF} ${esc.id}  ${DIM}línea ${dif.line}${OFF}`)
    console.log(`     ${DIM}guardado:${OFF} ${dif.esperado}`)
    console.log(`     ${DIM}ahora:   ${OFF} ${dif.obtenido}`)
  }

  // Un .txt sin escenario es una línea base que ya no comprueba nada.
  const ids = new Set(ESCENARIOS.map((e) => e.id))
  const huerfanas = fixtureIdsOnDisk().filter((id) => !ids.has(id))
  for (const id of huerfanas) console.log(`  ${RED}huérfana   ${OFF} ${id}.txt  ${DIM}no hay escenario con ese id: bórrala o añade el escenario${OFF}`)

  if (update) {
    console.log(`\n${GREEN}${ESCENARIOS.length} instantáneas escritas.${OFF} Revisa el git diff de test/fixtures/prompts antes de commitear.`)
    if (huerfanas.length) process.exitCode = 1
    return
  }
  if (malos || huerfanas.length) {
    console.log(`\n${RED}${malos} escenario(s) no coinciden.${OFF} Si el cambio es intencionado: npm run snapshots`)
    process.exitCode = 1
    return
  }
  console.log(`\n${GREEN}Todas coinciden.${OFF}`)
}

main()
