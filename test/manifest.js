/**
 * Validación del manifest: lo que Chrome rechazaría al cargar la extensión.
 *
 * El id se compara con el EXTENSION_ID de verdad (importado de config.js, que
 * no toca el navegador al cargarse), no con una regex sobre su fuente: así el
 * único importador de esa constante fuera de config.js es real y
 * dead-exports.test.js no la toma por deuda.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { EXTENSION_ID } from '../src/shared/config.js'

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

  // SEGURIDAD (auditoría de 2026-09-13, docs/PLAN.md S7): con la `key` fija,
  // un recurso accesible desde la web por su URL estable
  // `chrome-extension://<id>/…` deja que cualquier página https compruebe si
  // Faro está instalado (y con él un opencode local y el MCP de Atlassian).
  // Con `use_dynamic_url` el content script sigue cargando sus módulos por
  // `chrome.runtime.getURL()`, pero la URL con el id fijo deja de resolverse
  // desde la página. Lo que cada patrón expone lo vigila web-accessible.test.js.
  const war = m.web_accessible_resources
  if (!Array.isArray(war) || !war.length) {
    errors.push('falta web_accessible_resources: el content script carga sus módulos por import()')
  } else {
    war.forEach((w, i) => {
      if (!Array.isArray(w?.resources) || !w.resources.length || !Array.isArray(w?.matches) || !w.matches.length) {
        errors.push(`web_accessible_resources[${i}] necesita "resources" y "matches" no vacíos`)
      }
      if (w?.use_dynamic_url !== true) {
        errors.push(`SEGURIDAD: web_accessible_resources[${i}] tiene que llevar "use_dynamic_url": true (sin él, con el id fijo cualquier web detecta Faro)`)
      }
    })
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
    if (!/^[a-p]{32}$/.test(EXTENSION_ID)) errors.push('EXTENSION_ID de src/shared/config.js no tiene forma de id de extensión')
    else if (EXTENSION_ID !== id) {
      errors.push(`EXTENSION_ID (${EXTENSION_ID}) no coincide con el id derivado de la key (${id})`)
    }
  }

  return { errors, id }
}
