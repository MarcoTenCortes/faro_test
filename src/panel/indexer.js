/**
 * Construcción del contexto y del índice.
 *
 * «Inspeccionar todo Confluence» no es literal: un espacio real tiene miles de
 * páginas. Se indexa en amplitud, con tope y cancelable, y se profundiza con
 * el uso. Sale en dos fases porque cada una quiere una forma distinta:
 *   1. Explorar y escribir prosa  -> el fichero de contexto, para el modelo.
 *   2. Volcar el índice como datos -> la fuente de verdad de la navegación.
 */

import { normalizeIndex, mergeIndex, indexSize } from '../atlassian/index-store.js'
import { canonicalPagePath, canonicalSpacePath, isRealSpaceKey } from '../atlassian/site.js'
import {
  indexExploreSystem,
  indexExplorePrompt,
  indexEmitPrompt,
  indexTreePrompt,
  ancestryPrompt,
  INDEX_SCHEMA,
  TREE_SCHEMA,
} from './prompts.js'
import { INDEX_LIMITS } from '../shared/config.js'
import { prettyTool } from '../shared/format.js'

/**
 * @param {object} client OpencodeClient
 * @param {{scope:object, site:object, model:object, onProgress:Function, signal:AbortSignal}} opts
 * @returns {Promise<{contextMd:string, index:object}>}
 */
export async function buildContext(client, { scope, site, model, onProgress, signal }) {
  const report = (text) => onProgress?.(text)

  report('Abriendo una sesión de indexado…')
  const session = await client.createSession({ title: `Faro · índice de ${site.host}` })

  try {
    report(`Recorriendo ${scope?.label || 'la zona actual'}. Esto puede tardar un par de minutos.`)
    const explore = await client.runTurn(
      session.id,
      { text: indexExplorePrompt(scope), model, system: indexExploreSystem(scope, site) },
      {
        signal,
        stallMs: 120000,
        maxMs: INDEX_LIMITS.timeoutMs,
        // Enseñar lo que está mirando ahora mismo: un indexado silencioso de
        // dos minutos es indistinguible de uno colgado.
        onUpdate: (t) => {
          const last = t.tools[t.tools.length - 1]
          if (last) report(`Consultando Atlassian… (${t.tools.length}) ${prettyTool(last.tool)}`)
        },
      }
    )

    if (explore.stalled) {
      throw new Error(
        'El modelo dejó de responder mientras recorría el sitio. Prueba con otro: los gratuitos se cuelgan a menudo.'
      )
    }
    if (explore.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (explore.error) throw new Error(explore.error)

    const contextMd = explore.text.trim()
    if (!contextMd) throw new Error('El indexador no devolvió ningún documento de contexto.')

    report('Volcando el índice de navegación…')
    const raw = await client.promptStructured(
      session.id,
      { text: indexEmitPrompt(), model, schema: INDEX_SCHEMA },
      { signal, stallMs: 120000, maxMs: INDEX_LIMITS.timeoutMs }
    )

    let index = normalizeIndex({ ...raw, updated: Date.now() }, site.host, scope, { cloud: site.cloud, wikiPrefix: site.wikiPrefix })

    // Fase 3: la jerarquía. Es la que hace posible la navegación paso a paso,
    // porque sin saber quién es el padre de cada página no hay camino que
    // enseñar. Si falla, el índice sigue valiendo para todo lo demás.
    if (site.product === 'confluence') {
      report('Levantando el árbol de páginas…')
      try {
        const tree = await client.promptStructured(
          session.id,
          { text: indexTreePrompt(scope), model, schema: TREE_SCHEMA },
          { signal, stallMs: 120000, maxMs: INDEX_LIMITS.timeoutMs }
        )
        const conArbol = normalizeIndex(
          { pages: tree?.pages || [], updated: Date.now() },
          site.host,
          scope,
          { cloud: site.cloud, wikiPrefix: site.wikiPrefix }
        )
        index = mergeTree(index, conArbol)
        report(`Árbol: ${countWithParent(index)} páginas con padre conocido.`)
      } catch (err) {
        report('El árbol no se pudo levantar; el resto del índice sí. ' + (err?.message || ''))
      }
    }

    report(`Listo: ${indexSize(index)} entradas indexadas.`)

    return { contextMd, index }
  } finally {
    // La sesión de indexado no debe ensuciar tu historial de opencode.
    client.deleteSession(session.id).catch(() => {})
  }
}

/**
 * Enriquecimiento incremental, sin coste.
 *
 * En vez de gastar otro turno preguntándole al modelo qué acaba de consultar
 * —lo que además llenaría el historial de ruido—, se lee lo que devolvieron
 * las herramientas MCP. Ahí ya vienen los identificadores reales.
 *
 * @param {Array} parts partes del mensaje del asistente
 * @returns {{index: object, added: number}}
 */
export function harvestIndex(parts, { site, index }) {
  const found = extractEntities(parts, site)
  if (!found.pages.length && !found.issues.length && !found.spaces.length) {
    return { index, added: 0 }
  }
  const fresh = normalizeIndex({ ...found, updated: Date.now() }, site.host, index?.scope, { cloud: site?.cloud, wikiPrefix: site?.wikiPrefix })
  if (!indexSize(fresh)) return { index, added: 0 }

  const before = indexSize(index)
  const merged = mergeIndex(index, fresh)
  return { index: merged, added: indexSize(merged) - before }
}

// El `/wiki` es OPCIONAL: sólo lo lleva Confluence Cloud. En Server/Data
// Center las mismas rutas cuelgan de la raíz, y exigir el prefijo hacía que no
// reconociéramos ninguna URL real del sitio.
const PAGE_URL = /(?:\/wiki)?\/spaces\/([A-Za-z0-9._~-]+)\/pages\/(\d+)(?:\/([^\s"'<>)\]]*))?/g
const SPACE_URL = /(?:\/wiki)?\/spaces\/([A-Za-z0-9._~-]+)(?![/\w])/g
const DISPLAY_URL = /(?:\/wiki)?\/display\/([A-Za-z0-9._~-]+)(?![/\w])/g
const VIEWPAGE_URL = /(?:\/wiki)?\/pages\/viewpage\.action\?pageId=(\d+)/g
const ISSUE_KEY = /\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/g
const JSON_PAGE = /"(?:id|page_?id)"\s*:\s*"?(\d+)"?[^}]{0,240}?"title"\s*:\s*"([^"]{1,200})"/g
const JSON_TITLE_FIRST = /"title"\s*:\s*"([^"]{1,200})"[^}]{0,240}?"(?:id|page_?id)"\s*:\s*"?(\d+)"?/g

/**
 * Saca entidades de Atlassian del texto que devolvieron las herramientas.
 * Pura y comprobable: es lo que mantiene vivo el índice con el uso.
 */
export function extractEntities(parts, site) {
  const blob = collectToolText(parts)
  const pages = new Map()
  const spaces = new Map()
  const issues = new Map()

  const addSpace = (key) => {
    if (!isRealSpaceKey(key) || spaces.has(key)) return
    spaces.set(key, { key, name: key, url: canonicalSpacePath(site, key) })
  }

  for (const m of blob.matchAll(PAGE_URL)) {
    const [, spaceKey, id, slug] = m
    const title = slug ? decodeSlug(slug) : `Página ${id}`
    const prev = pages.get(id)
    // Un título de verdad gana a un marcador de posición.
    if (!prev || (prev.title.startsWith('Página ') && !title.startsWith('Página '))) {
      pages.set(id, { id, title, spaceKey: isRealSpaceKey(spaceKey) ? spaceKey : null, url: m[0] })
    }
    // El espacio va implícito en la URL de la página: registrarlo sale gratis
    // y es lo que permite enseñar el camino completo en la asistida.
    addSpace(spaceKey)
  }

  for (const m of blob.matchAll(VIEWPAGE_URL)) {
    const id = m[1]
    if (!pages.has(id)) pages.set(id, { id, title: `Página ${id}`, url: m[0] })
  }

  for (const re of [JSON_PAGE, JSON_TITLE_FIRST]) {
    for (const m of blob.matchAll(re)) {
      const [id, title] = re === JSON_PAGE ? [m[1], m[2]] : [m[2], m[1]]
      if (pages.has(id)) {
        const prev = pages.get(id)
        if (prev.title.startsWith('Página ')) pages.set(id, { ...prev, title })
      } else if (id.length >= 4) {
        // Un id suelto en un JSON es menos de fiar que uno sacado de una URL:
        // sólo se crea la entrada si tiene pinta de id real de Confluence.
        //
        // Y la ruta NO se inventa: `viewpage.action?pageId=` existe tanto en
        // Cloud como en Data Center y no necesita saber el espacio. Antes se
        // fabricaba `/wiki/spaces/~/pages/<id>`, que en un Data Center lleva
        // derecho a «Page Not Found».
        pages.set(id, { id, title, url: canonicalPagePath(site, id) })
      }
    }
  }

  for (const m of blob.matchAll(SPACE_URL)) addSpace(m[1])
  for (const m of blob.matchAll(DISPLAY_URL)) addSpace(m[1])

  for (const m of blob.matchAll(ISSUE_KEY)) {
    const key = m[1]
    if (!issues.has(key)) issues.set(key, { key, summary: key, url: `/browse/${key}` })
  }

  // Los títulos de incidencia suelen venir como "KEY: resumen" o "KEY - resumen".
  for (const [key, entry] of issues) {
    const m = blob.match(new RegExp(escapeRe(key) + '\\s*[:\\-–]\\s*([^\\n"]{3,140})'))
    if (m) entry.summary = m[1].trim()
  }

  const known = site?.host
  return {
    pages: [...pages.values()],
    spaces: [...spaces.values()],
    issues: [...issues.values()],
    projects: [],
    host: known,
  }
}

function collectToolText(parts) {
  const out = []
  for (const p of parts || []) {
    if (p?.type !== 'tool') continue
    const state = p.state || {}
    if (typeof state.output === 'string') out.push(state.output)
    if (state.input) out.push(safeJson(state.input))
    if (state.metadata) out.push(safeJson(state.metadata))
  }
  return out.join('\n').slice(0, 400000)
}

function safeJson(v) {
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

function decodeSlug(slug) {
  try {
    return decodeURIComponent(slug).replace(/\+/g, ' ').trim() || slug
  } catch {
    return slug.replace(/\+/g, ' ')
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Funde el árbol sobre el índice: se queda con el `parentId` de la fase del
 * árbol, que es el bueno, y conserva títulos y rutas que ya teníamos.
 * Pura.
 */
export function mergeTree(index, arbol) {
  const out = JSON.parse(JSON.stringify(index))
  for (const [id, page] of Object.entries(arbol?.pages || {})) {
    const previo = out.pages[id]
    out.pages[id] = previo
      ? { ...previo, parentId: page.parentId ?? previo.parentId, title: previo.title || page.title }
      : page
  }
  return out
}

/** Cuántas páginas del índice saben quién es su padre. */
export function countWithParent(index) {
  return Object.values(index?.pages || {}).filter((p) => p.parentId).length
}

/**
 * Antepasados de UNA página, a la carta.
 *
 * El respaldo para los índices que ya existen: sin esto habría que reindexar
 * el sitio entero sólo para poder enseñar el camino hasta una página. Se llama
 * una vez por página y el resultado se queda en el índice.
 */
export async function fetchAncestry(client, { sessionID, model, site, index, pageId, title, signal }) {
  try {
    const raw = await client.promptStructured(
      sessionID,
      { text: ancestryPrompt(pageId, title), model, schema: TREE_SCHEMA },
      { signal, stallMs: 90000, maxMs: 240000 }
    )
    if (!raw?.pages?.length) return { index, added: 0 }

    const arbol = normalizeIndex({ pages: raw.pages, updated: Date.now() }, site.host, index?.scope, {
      cloud: site.cloud,
      wikiPrefix: site.wikiPrefix,
    })
    const antes = countWithParent(index)
    const merged = mergeTree(mergeIndex(index, arbol), arbol)
    return { index: merged, added: countWithParent(merged) - antes }
  } catch {
    return { index, added: 0 }
  }
}
