/** Ejecuta comprobación de sintaxis y todas las pruebas unitarias. */
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registry } from './harness.js'
import { checkSyntax, listJsFiles } from './syntax.js'
import { findUseBeforeDeclare } from './tdz.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
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
  // Cuántas registra cada fichero: la §10 de docs/PINES.md (hasta el
  // 2026-09-27, de CLAUDE.md) dice «`x.test.js` (…; N
  // pruebas» de los de H1 y el paso «docs» lo compara (sólo el total se
  // quedaba atrás sin que nada avisara: la revisión de H1 encontró un 22 que
  // registraba 24).
  const files = walk(join(HERE, 'unit')).sort()
  const porFichero = {}
  for (const f of files) {
    const antes = registry.length
    await import(pathToFileURL(f).href)
    porFichero[basename(f)] = registry.length - antes
  }

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

  // ---- 5. docs ------------------------------------------------------------
  // La documentación es el mapa para una sesión nueva y se quedaba atrás sin
  // que nada avisara (docs/PLAN.md §2.7 D2: 35 títulos del registro sin
  // documentar y el número de pruebas del README a mano). El número de pruebas
  // (el total, en README y CLAUDE.md §2, y el de cada fichero que declara la
  // §10 de docs/PINES.md) es estricto; títulos,
  // mensajes y ficheros son error según `STRICT` de tools/check-docs.mjs, y un
  // mensaje con receptor y sin emisor sólo avisa. Sólo corre si las unitarias
  // pasan: `registry.length` es el número que tienen que decir README y CLAUDE.md.
  const { checkDocs, formatReport } = await import('../tools/check-docs.mjs')
  const docs = checkDocs(ROOT, { tests: registry.length, porFichero })
  const paint = (text, kind) => `${kind === 'error' ? RED : YELLOW}${text}${OFF}`
  if (docs.errors.length) {
    console.log(`${RED}✗ docs${OFF}       ${DIM}${docs.errors.length} error(es) · ${docs.warnings.length} aviso(s)${OFF}`)
    for (const line of formatReport(docs, paint)) console.log(`   ${line}`)
    process.exitCode = 1
    return
  }
  console.log(
    `${GREEN}✓${OFF} docs        ${DIM}README y CLAUDE.md dicen ${registry.length} pruebas y docs/PINES.md las de cada fichero` +
      (docs.warnings.length ? ` · ${docs.warnings.length} aviso(s)` : '') +
      `${OFF}`
  )
  for (const line of formatReport(docs, paint)) console.log(`   ${line}`)

  console.log(`\n${GREEN}${BOLD}Todo en verde.${OFF}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
