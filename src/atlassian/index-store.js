/**
 * El índice de contenido: la fuente de verdad de la navegación.
 *
 * Regla de oro: aquí sólo se guardan RUTAS, nunca URLs absolutas. La URL final
 * se reconstruye siempre contra el origen de la pestaña actual, así que un
 * plan de navegación no puede sacarte del sitio en el que estás aunque el
 * modelo lo intente.
 *
 * Funciones puras.
 */

// v2: la v1 podia contener rutas fabricadas del tipo `/wiki/spaces/~/pages/<id>`
// que en Server/Data Center llevan a «Page Not Found». Subir la version hace
// que esos indices se descarten en vez de arrastrar enlaces rotos.
import { fixWikiPrefix } from './site.js'

// v3: ademas de lo de la v2, ahora el prefijo /wiki se corrige segun lo que se
// observa en el navegador, no segun lo que el modelo se imagine.
export const INDEX_VERSION = 3

export function emptyIndex(host, scope) {
  return {
    version: INDEX_VERSION,
    host: host || '',
    scope: scope || null,
    updated: 0,
    spaces: {},
    pages: {},
    projects: {},
    issues: {},
  }
}

/**
 * Convierte cualquier URL o ruta en una ruta relativa segura para `host`.
 * Devuelve null si apunta a otro sitio, lo cual descarta la entrada entera.
 */
export function toSafePath(value, host) {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let u
    try {
      u = new URL(raw)
    } catch {
      return null
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (host && u.hostname.toLowerCase() !== String(host).toLowerCase()) return null
    return u.pathname + u.search + u.hash
  }

  // Rutas protocolo-relativas (//otro-host/...) son un salto de origen encubierto.
  if (raw.startsWith('//')) return null
  if (!raw.startsWith('/')) return '/' + raw
  return raw
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Normaliza lo que devuelve el indexador (que es un modelo, así que puede
 * traer cualquier cosa) a la forma canónica del índice.
 */
export function normalizeIndex(raw, host, scope, opts = {}) {
  const out = emptyIndex(host, scope)
  // El prefijo /wiki solo existe en Confluence Cloud. Darlo por hecho en un
  // Data Center produce enlaces rotos.
  // El prefijo observado manda sobre cualquier suposicion. Y si NO lo sabemos,
  // no se toca nada: corregir a ciegas rompe las rutas de Cloud.
  const known = typeof opts.wikiPrefix === 'string' || typeof opts.cloud === 'boolean'
  const wiki = typeof opts.wikiPrefix === 'string' ? opts.wikiPrefix : opts.cloud ? '/wiki' : ''
  const fix = (path) => (known && path ? fixWikiPrefix(path, wiki) : path)
  if (!raw || typeof raw !== 'object') return out

  out.updated = Number(raw.updated) || Date.now()
  if (raw.scope) out.scope = raw.scope

  for (const s of asArray(raw.spaces)) {
    const key = str(s.key || s.spaceKey || s.id)
    // `~` a secas es el prefijo de los espacios personales, no un espacio.
    if (!key || key === '~' || key === '_') continue
    const path = fix(toSafePath(s.url || s.path || `${wiki}/spaces/${key}`, host))
    if (!path) continue
    out.spaces[key] = { key, name: str(s.name || s.title) || key, path }
  }

  for (const p of asArray(raw.pages)) {
    const id = str(p.id || p.pageId)
    if (!/^\d+$/.test(id)) continue
    const path = fix(toSafePath(p.url || p.path || `${wiki}/pages/viewpage.action?pageId=${id}`, host))
    if (!path) continue
    const spaceKey = str(p.spaceKey || p.space)
    out.pages[id] = {
      id,
      title: str(p.title) || `Página ${id}`,
      spaceKey: spaceKey && spaceKey !== '~' ? spaceKey : null,
      parentId: /^\d+$/.test(str(p.parentId)) ? str(p.parentId) : null,
      path,
    }
  }

  for (const pr of asArray(raw.projects)) {
    const key = str(pr.key || pr.projectKey || pr.id).toUpperCase()
    if (!key) continue
    const path = toSafePath(pr.url || pr.path || `/jira/software/projects/${key}/boards`, host)
    if (!path) continue
    out.projects[key] = { key, name: str(pr.name) || key, path }
  }

  for (const is of asArray(raw.issues)) {
    const key = str(is.key || is.issueKey || is.id).toUpperCase()
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) continue
    const path = toSafePath(is.url || is.path || `/browse/${key}`, host)
    if (!path) continue
    out.issues[key] = {
      key,
      title: str(is.summary || is.title) || key,
      projectKey: key.split('-')[0],
      path,
    }
  }

  return out
}

/** Acepta tanto `{id: {...}}` como `[{...}]`, porque el modelo usa ambas. */
function asArray(v) {
  if (!v) return []
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object')
  if (typeof v === 'object') {
    return Object.entries(v).map(([k, val]) =>
      val && typeof val === 'object' ? { key: k, id: k, ...val } : null
    ).filter(Boolean)
  }
  return []
}

/** Une un índice nuevo sobre otro existente. Lo nuevo gana; nada se borra. */
export function mergeIndex(base, incoming) {
  const out = base && base.version === INDEX_VERSION ? conCubosPropios(base) : emptyIndex(incoming?.host, incoming?.scope)
  out.host = incoming?.host || out.host
  out.scope = incoming?.scope || out.scope
  out.updated = Math.max(out.updated || 0, incoming?.updated || Date.now())
  for (const bucket of ['spaces', 'pages', 'projects', 'issues']) {
    Object.assign(out[bucket], incoming?.[bucket] || {})
  }
  return out
}

/**
 * Como `mergeIndex`, pero sin que lo nuevo borre lo que no sabe.
 *
 * Lo que descubre una conversación o un vistazo a la barra lateral trae páginas
 * sin padre, sin espacio y a veces con un título de relleno o una ruta
 * fabricada por id. Fundirlo a lo bruto pisaba el árbol que ya se había leído
 * de la API: pasó de verdad, y la tarjeta volvía a quedarse sin «Paso a paso»
 * en la pregunta siguiente. Aquí el padre, el espacio, un título de verdad y
 * una ruta con nombre sólo se sustituyen por otros del mismo tipo. Pura.
 */
export function mergeIndexKeepingTree(base, incoming) {
  const out = mergeIndex(base, incoming)
  if (!base || base.version !== INDEX_VERSION) return out

  for (const [id, nueva] of Object.entries(incoming?.pages || {})) {
    const previa = base.pages?.[id]
    if (!previa) continue
    out.pages[id] = {
      ...nueva,
      parentId: nueva.parentId ?? previa.parentId ?? null,
      spaceKey: nueva.spaceKey ?? previa.spaceKey ?? null,
      title: isPlaceholderTitle(nueva.title) && previa.title && !isPlaceholderTitle(previa.title) ? previa.title : nueva.title,
      path: isCanonicalPath(nueva.path) && previa.path && !isCanonicalPath(previa.path) ? previa.path : nueva.path,
    }
  }
  return out
}

/** «Página 123»: lo que se pone cuando sólo se conoce el id. */
export function isPlaceholderTitle(title) {
  return /^Página \d+$/.test(String(title || ''))
}

/**
 * La ruta fabricada por id, que vale pero no lleva el nombre de la página. Sin
 * el id —la fila actual de un Data Center abierto por viewpage.action— vale
 * aún menos: nunca gana a una ruta con nombre.
 */
function isCanonicalPath(path) {
  return /\/pages\/viewpage\.action(\?|$)/i.test(String(path || ''))
}

/**
 * El mismo índice con los cuatro cubos propios y las entradas COMPARTIDAS.
 *
 * Fundir clonaba el índice entero por JSON (`JSON.parse(JSON.stringify(base))`),
 * y desde H6 el índice se funde varias veces por turno —lo que devolvieron las
 * herramientas, el árbol de la barra lateral, el camino del planificador— para
 * guardarse una sola vez al final: con 2 000 páginas eso era reconstruir 2 000
 * objetos para cambiar tres. Basta copiar los cubos, porque una entrada nunca se
 * modifica en su sitio: quien la cambia construye otra (`normalizeIndex`,
 * `mergeIndexKeepingTree`) y la deja en el cubo del resultado. Así escribir en el
 * índice fundido no toca el que el panel sigue teniendo en memoria.
 */
function conCubosPropios(index) {
  return {
    ...index,
    spaces: { ...(index.spaces || {}) },
    pages: { ...(index.pages || {}) },
    projects: { ...(index.projects || {}) },
    issues: { ...(index.issues || {}) },
  }
}

export function indexSize(index) {
  if (!index) return 0
  return ['spaces', 'pages', 'projects', 'issues'].reduce(
    (n, b) => n + Object.keys(index[b] || {}).length,
    0
  )
}

/**
 * Resuelve un destino del plan contra el índice.
 * @returns {{kind:string, id:string, title:string, path:string, url:string}|null}
 */
export function resolveTarget(index, origin, target) {
  if (!index || !target) return null
  const id = String(target.id ?? '').trim()
  if (!id) return null

  let entry = null
  let kind = target.kind

  switch (target.kind) {
    case 'confluence-page':
      entry = index.pages?.[id]
      break
    case 'confluence-space':
      entry = index.spaces?.[id] || index.spaces?.[id.toUpperCase()]
      break
    case 'jira-issue':
      entry = index.issues?.[id.toUpperCase()]
      break
    case 'jira-project':
      entry = index.projects?.[id.toUpperCase()]
      break
    default: {
      // Sin tipo declarado, se busca por forma del identificador.
      if (/^\d+$/.test(id) && index.pages?.[id]) {
        entry = index.pages[id]
        kind = 'confluence-page'
      } else if (index.issues?.[id.toUpperCase()]) {
        entry = index.issues[id.toUpperCase()]
        kind = 'jira-issue'
      } else if (index.spaces?.[id]) {
        entry = index.spaces[id]
        kind = 'confluence-space'
      } else if (index.projects?.[id.toUpperCase()]) {
        entry = index.projects[id.toUpperCase()]
        kind = 'jira-project'
      }
    }
  }

  if (!entry) return null

  const path = toSafePath(entry.path, null)
  if (!path) return null

  return {
    kind,
    id: entry.id || entry.key,
    title: entry.title || entry.name || entry.key || entry.id,
    path,
    url: String(origin || '').replace(/\/+$/, '') + path,
  }
}

/**
 * Cadena de padres de una página, de la raíz hacia abajo. Con tope anti-bucle,
 * el mismo que admite la API: un árbol real puede tener más de ocho niveles, y
 * cortar antes deja sin desplegar justo las ramas de arriba.
 */
export function ancestryOf(index, pageId, limit = 50) {
  const chain = []
  const seen = new Set()
  let cur = index?.pages?.[String(pageId)]
  while (cur && !seen.has(cur.id) && chain.length < limit) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = cur.parentId ? index.pages?.[cur.parentId] : null
  }
  return chain
}

/**
 * Resumen compacto del índice para meterlo en el prompt del planificador.
 * Se acota para no reventar la ventana de contexto.
 */
export function indexDigest(index, { maxPages = 120, maxIssues = 60, relevantTo = '' } = {}) {
  if (!index) return '(sin índice)'
  const lines = []
  const spaces = Object.values(index.spaces || {})
  if (spaces.length) {
    lines.push('ESPACIOS DE CONFLUENCE')
    for (const s of spaces.slice(0, 40)) lines.push(`  ${s.key} — ${s.name}`)
  }

  // Con un índice grande, mandar 120 títulos hace el prompt largo y lento. Si
  // se sabe sobre qué va la respuesta, se mandan primero los que tienen que
  // ver con ella; el resto rellena hasta el tope.
  const pages = rankByRelevance(Object.values(index.pages || {}), relevantTo, (p) => p.title)
  if (pages.length) {
    lines.push(`PÁGINAS (${pages.length}${pages.length > maxPages ? `, se muestran ${maxPages}` : ''})`)
    for (const p of pages.slice(0, maxPages)) {
      lines.push(`  ${p.id} — ${p.title}${p.spaceKey ? ` [${p.spaceKey}]` : ''}`)
    }
  }
  const projects = Object.values(index.projects || {})
  if (projects.length) {
    lines.push('PROYECTOS DE JIRA')
    for (const p of projects.slice(0, 40)) lines.push(`  ${p.key} — ${p.name}`)
  }
  const issues = rankByRelevance(Object.values(index.issues || {}), relevantTo, (i) => i.title)
  if (issues.length) {
    lines.push(`INCIDENCIAS (${issues.length}${issues.length > maxIssues ? `, se muestran ${maxIssues}` : ''})`)
    for (const i of issues.slice(0, maxIssues)) lines.push(`  ${i.key} — ${i.title}`)
  }
  return lines.length ? lines.join('\n') : '(índice vacío)'
}

/** Ordena por palabras compartidas con un texto de referencia. Estable. */
export function rankByRelevance(items, texto, titleOf) {
  if (!texto) return items
  const claves = new Set(
    String(texto)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4)
  )
  if (!claves.size) return items
  return items
    .map((item, i) => {
      const palabras = String(titleOf(item) || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
      let n = 0
      for (const w of palabras) if (w.length >= 4 && claves.has(w)) n++
      return { item, n, i }
    })
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.item)
}
