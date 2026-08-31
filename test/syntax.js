/**
 * Comprobación de sintaxis de todos los .js del proyecto.
 *
 * Sin build no hay compilador que avise de un paréntesis suelto, así que esto
 * hace de red: `node --check` sobre cada fichero. Los content scripts y el
 * panel se parsean como módulo, igual que los carga Chrome.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SKIP = new Set(['node_modules', '.git', 'dist', '.faro'])

export function listJsFiles(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) listJsFiles(root, p, out)
    else if (/\.m?js$/.test(entry)) out.push(p)
  }
  return out
}

export async function checkSyntax(root) {
  const files = listJsFiles(root)
  const failed = []
  await Promise.all(
    files.map(async (file) => {
      try {
        await run(process.execPath, ['--check', file], { windowsHide: true })
      } catch (err) {
        failed.push({ file: relative(root, file), error: String(err.stderr || err.message) })
      }
    })
  )
  return { total: files.length, failed }
}

if (process.argv[1] && process.argv[1].endsWith('syntax.js')) {
  const root = join(import.meta.dirname, '..')
  const r = await checkSyntax(root)
  if (r.failed.length) {
    for (const f of r.failed) console.error(f.file + '\n  ' + f.error.split('\n')[0])
    process.exitCode = 1
  } else {
    console.log(`${r.total} ficheros parsean.`)
  }
}
