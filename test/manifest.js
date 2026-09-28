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

  // EL CAMBIO (H27, docs/PLAN3.md §3.1): hasta aquí se EXIGÍA `use_dynamic_url`
  // (S7, auditoría de 2026-09-13: con la `key` fija, la URL estable
  // `chrome-extension://<id>/…` deja que cualquier web https sepa si Faro está
  // instalado) y con él el content script no cargaba. Medido el 2026-09-28 en
  // el Chrome 153 de Marco: la URL con GUID se sirve redirigiendo a la del id
  // fijo, la base del módulo pasa a ser esa URL de respuesta y sus imports
  // relativos se piden por el id fijo y se deniegan; cargaban las hojas y
  // fallaba todo lo que importa algo. Sin build no hay arreglo a medias (una
  // segunda entrada sin la clave vuelve a exponer lo mismo), así que S7 queda
  // descartada (docs/BITACORA.md §12.4) y la clave, prohibida. Se rechaza sin
  // mirar el código porque este paso corre antes que las unitarias (y en su
  // prueba, sobre un directorio sin src/); la regla contra el cierre real del
  // content script y lo que cada patrón expone los vigila
  // web-accessible.test.js. Lo que se pierde: una web puede comprobar si Faro
  // está instalado; nada de panel/, background/ ni opencode/ queda expuesto.
  const war = m.web_accessible_resources
  if (!Array.isArray(war) || !war.length) {
    errors.push('falta web_accessible_resources: el content script carga sus módulos por import()')
  } else {
    war.forEach((w, i) => {
      if (!Array.isArray(w?.resources) || !w.resources.length || !Array.isArray(w?.matches) || !w.matches.length) {
        errors.push(`web_accessible_resources[${i}] necesita "resources" y "matches" no vacíos`)
      }
      if (w?.use_dynamic_url === true) {
        errors.push(`EL CAMBIO (H27): web_accessible_resources[${i}] no puede llevar "use_dynamic_url": true: Chrome sirve la URL con GUID redirigiendo al id fijo y los imports relativos de los módulos del content script se deniegan (medido el 2026-09-28 en Chrome 153)`)
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
