/** Validación del manifest: lo que Chrome rechazaría al cargar la extensión. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function idFromKey(keyB64) {
  const der = Buffer.from(keyB64, 'base64')
  const hash = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return hash.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)])
}

export function checkManifest(root) {
  const errors = []
  const p = join(root, 'manifest.json')
  if (!existsSync(p)) return { errors: ['falta manifest.json'], id: null }

  let m
  try {
    m = JSON.parse(readFileSync(p, 'utf8'))
  } catch (err) {
    return { errors: ['manifest.json no es JSON válido: ' + err.message], id: null }
  }

  if (m.manifest_version !== 3) errors.push('manifest_version debe ser 3')
  for (const field of ['name', 'version', 'description']) {
    if (!m[field]) errors.push(`falta el campo ${field}`)
  }
  if (!/^\d+(\.\d+){0,3}$/.test(m.version || '')) errors.push('version con formato inválido')

  // Todos los ficheros referenciados deben existir.
  const refs = []
  if (m.background?.service_worker) refs.push(m.background.service_worker)
  if (m.side_panel?.default_path) refs.push(m.side_panel.default_path)
  for (const cs of m.content_scripts || []) refs.push(...(cs.js || []), ...(cs.css || []))
  for (const icon of Object.values(m.icons || {})) refs.push(icon)
  for (const icon of Object.values(m.action?.default_icon || {})) refs.push(icon)

  for (const ref of refs) {
    if (!existsSync(join(root, ref))) errors.push(`referenciado en el manifest pero no existe: ${ref}`)
  }

  if (m.background && m.background.type !== 'module') {
    errors.push('el service worker debe declarar "type": "module" (usamos import)')
  }

  const perms = new Set(m.permissions || [])
  for (const need of ['sidePanel', 'storage', 'tabs', 'scripting']) {
    if (!perms.has(need)) errors.push(`falta el permiso ${need}`)
  }

  const hosts = m.host_permissions || []
  if (!hosts.some((h) => h.includes('127.0.0.1'))) {
    errors.push('host_permissions debe incluir 127.0.0.1 para hablar con opencode')
  }

  let id = null
  if (!m.key) {
    errors.push('falta "key": sin ella el id cambia y --cors deja de valer')
  } else {
    try {
      id = idFromKey(m.key)
    } catch {
      errors.push('"key" no es base64 válido')
    }
  }

  // El id calculado tiene que coincidir con el que usa el código.
  if (id) {
    const cfg = readFileSync(join(root, 'src/shared/config.js'), 'utf8')
    const match = cfg.match(/EXTENSION_ID = '([a-p]{32})'/)
    if (!match) errors.push('no encuentro EXTENSION_ID en src/shared/config.js')
    else if (match[1] !== id) {
      errors.push(`EXTENSION_ID (${match[1]}) no coincide con el id derivado de la key (${id})`)
    }
  }

  return { errors, id }
}
