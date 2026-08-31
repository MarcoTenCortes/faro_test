/** Ejecuta comprobación de sintaxis y todas las pruebas unitarias. */
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registry } from './harness.js'
import { checkSyntax, listJsFiles } from './syntax.js'
import { findUseBeforeDeclare } from './tdz.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (entry.endsWith('.test.js')) out.push(p)
  }
  return out
}

async function main() {
  console.log(`${BOLD}Faro · comprobaciones${OFF}\n`)

  // ---- 1. sintaxis --------------------------------------------------------
  const syntax = await checkSyntax(ROOT)
  if (syntax.failed.length) {
    console.log(`${RED}✗ sintaxis${OFF}  ${syntax.failed.length} de ${syntax.total} ficheros no parsean`)
    for (const f of syntax.failed) console.log(`   ${RED}${f.file}${OFF}\n     ${f.error.split('\n')[0]}`)
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}✓${OFF} sintaxis    ${DIM}${syntax.total} ficheros JS parsean${OFF}`)

  // ---- 2. uso antes de declarar -------------------------------------------
  // Parsear no ejecuta nada: una zona muerta temporal pasa la comprobación de
  // sintaxis y revienta cuando el usuario pulsa el botón. Pasó de verdad, con
  // un «Cannot access 'pagina' before initialization» en mitad de un análisis.
  const desorden = []
  for (const f of listJsFiles(ROOT)) {
    const rel = f.replace(/\\/g, '/')
    if (!rel.includes('/src/')) continue
    desorden.push(...findUseBeforeDeclare(readFileSync(f, 'utf8'), rel.slice(rel.indexOf('/src/') + 1)))
  }
  if (desorden.length) {
    console.log(`${RED}✗ orden${OFF}      ${desorden.length} uso(s) antes de declarar`)
    for (const p of desorden) {
      console.log(
        `   ${RED}${p.file}${OFF} · ${p.funcion}(): usa «${p.nombre}» en la línea ${p.usoEn}, ` +
          `la declara en la ${p.declEn}`
      )
    }
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}✓${OFF} orden       ${DIM}nada se usa antes de declararse${OFF}`)

  // ---- 3. manifest --------------------------------------------------------
  const { checkManifest } = await import('./manifest.js')
  const man = checkManifest(ROOT)
  if (man.errors.length) {
    console.log(`${RED}✗ manifest${OFF}`)
    for (const e of man.errors) console.log(`   ${RED}${e}${OFF}`)
    process.exitCode = 1
    return
  }
  console.log(`${GREEN}✓${OFF} manifest    ${DIM}MV3 válido · id ${man.id}${OFF}`)

  // ---- 4. unitarias -------------------------------------------------------
  const files = walk(join(HERE, 'unit')).sort()
  for (const f of files) await import(pathToFileURL(f).href)

  let pass = 0
  const failures = []
  for (const t of registry) {
    try {
      await t.fn()
      pass++
    } catch (err) {
      failures.push({ name: t.name, err })
    }
  }

  console.log(
    `${failures.length ? RED + '✗' : GREEN + '✓'}${OFF} unitarias   ${DIM}${pass}/${registry.length} pruebas${OFF}`
  )

  if (failures.length) {
    console.log()
    for (const f of failures) {
      console.log(`  ${RED}✗ ${f.name}${OFF}`)
      console.log(`    ${String(f.err.message).split('\n').join('\n    ')}`)
      if (!(f.err instanceof Error) || f.err.name !== 'AssertionError') {
        const stack = String(f.err.stack || '').split('\n').slice(1, 3).join('\n    ')
        if (stack) console.log(`    ${DIM}${stack}${OFF}`)
      }
    }
    process.exitCode = 1
    return
  }

  console.log(`\n${GREEN}${BOLD}Todo en verde.${OFF}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
