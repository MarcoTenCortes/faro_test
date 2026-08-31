/**
 * Comprobaciones de enlazado entre módulos.
 *
 * Sin compilador ni empaquetador, mover un ayudante de un fichero a otro y
 * olvidar el import no falla hasta que alguien pulsa el botón. Pasó de verdad:
 * `prettyTool` acabó usándose en el indexador estando definido sólo en el
 * panel, y el indexado se quedaba sin progreso.
 *
 * En vez de intentar analizar todo el código —lo que da muchísimo ruido—, esto
 * mira sólo los nombres que EXPORTA el propio proyecto. Si un fichero usa uno
 * de esos nombres sin importarlo ni declararlo, casi seguro que es un olvido.
 */
import { test, eq } from '../harness.js'
import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { listJsFiles } from '../syntax.js'

const ROOT = join(import.meta.dirname, '..', '..')

const files = listJsFiles(ROOT).filter((f) => {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  return rel.startsWith('src/')
})

/** Quita comentarios y literales de texto, que generan falsos positivos. */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

function exportedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const name = (piece.includes(' as ') ? piece.split(' as ')[1] : piece).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

function importedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s*['"]/g)) {
    for (const piece of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = (piece.includes(' as ') ? piece.split(' as ')[1] : piece).replace(/^\*\s*/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

function localNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])

  // Desestructuraciones, incluidas las de un `import()` dinámico:
  //   const [{ NavRunner }, { MSG }] = await Promise.all([...])
  for (const m of src.matchAll(/\b(?:const|let|var)\s*([[{][\s\S]{0,600}?[\]}])\s*=/g)) {
    for (const id of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) names.add(id[1])
  }
  return names
}

// nombre exportado -> ficheros que lo exportan
const exportMap = new Map()
const sources = new Map()
for (const file of files) {
  const clean = stripNoise(readFileSync(file, 'utf8'))
  sources.set(file, clean)
  for (const name of exportedNames(clean)) {
    if (!exportMap.has(name)) exportMap.set(name, [])
    exportMap.get(name).push(file)
  }
}

test('un ayudante del proyecto no se usa sin importarlo', () => {
  const problemas = []

  for (const file of files) {
    const src = sources.get(file)
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    const known = new Set([...importedNames(src), ...localNames(src)])

    for (const [name, owners] of exportMap) {
      if (owners.includes(file) || known.has(name)) continue
      // Usado como función o como valor, nunca como propiedad de algo.
      const used = new RegExp('(^|[^\\w.$])' + name + '\\s*\\(', 'm').test(src)
      if (used) {
        problemas.push(`${rel} usa ${name}() pero no lo importa (está en ${relative(ROOT, owners[0]).replace(/\\/g, '/')})`)
      }
    }
  }

  eq(problemas, [])
})

test('todos los imports apuntan a ficheros que existen', () => {
  const rotos = []
  for (const file of files) {
    const src = sources.get(file)
    for (const m of src.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1])
      if (!existsSync(target)) rotos.push(`${relative(ROOT, file)} importa ${m[1]}, que no existe`)
    }
  }
  eq(rotos, [])
})

test('todo nombre importado de otro módulo del proyecto existe allí', () => {
  const rotos = []
  for (const file of files) {
    const src = sources.get(file)
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[2])
      if (!existsSync(target) || !sources.has(target)) continue
      const disponibles = exportedNames(sources.get(target))
      for (const piece of m[1].split(',')) {
        const name = piece.split(' as ')[0].trim()
        if (!name) continue
        if (!disponibles.has(name)) {
          rotos.push(`${relative(ROOT, file).replace(/\\/g, '/')} importa ${name} de ${m[2]}, que no lo exporta`)
        }
      }
    }
  }
  eq(rotos, [])
})
