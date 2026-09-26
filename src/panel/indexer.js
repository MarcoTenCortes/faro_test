/**
 * Construcción del contexto y del índice.
 *
 * «Inspeccionar todo Confluence» no es literal: un espacio real tiene miles de
 * páginas. Se indexa en amplitud, con tope y cancelable, y se profundiza con
 * el uso. Sale en dos fases porque cada una quiere una forma distinta:
 *   1. Explorar y escribir prosa  -> el fichero de contexto, para el modelo.
 *   2. Volcar el índice como datos -> la fuente de verdad de la navegación.
 *
 * Desde H9, cuando el árbol del espacio se puede leer de la API del propio
 * Confluence (`restIndex`), las fases 2 y 3 NO se le piden al modelo: la lista
 * paginada dice exacto qué páginas hay y de quién cuelga cada una, en
 * milisegundos y sin gastar un token (§8.19). Lo que el modelo sigue haciendo
 * es lo único que sólo él puede hacer: escribir la prosa del contexto. Si la
 * API no contesta —o el usuario apagó las lecturas REST—, `restIndex` llega
 * null y esto es, letra a letra, lo de siempre.
 */

import { normalizeIndex, mergeIndex, mergeIndexKeepingTree, indexSize } from '../atlassian/index-store.js'
import {
  canonicalPagePath,
  canonicalSpacePath,
  isRealSpaceKey,
  validIssueKey,
  validProjectKey,
  validSpaceKey,
} from '../atlassian/site.js'
import {
  indexExploreSystem,
  indexExplorePrompt,
  indexEmitPrompt,
  indexTreePrompt,
  treeTitles,
  INDEX_SCHEMA,
  TREE_SCHEMA,
} from './prompts.js'
import { INDEX_LIMITS } from '../shared/config.js'
import { prettyTool } from '../shared/format.js'

/**
 * @param {object} client OpencodeClient
 * @param {{scope:object, site:object, model:object, onProgress:Function,
 *          signal:AbortSignal, linkedContext?:object|null,
 *          restIndex?:object|null, profile?:object|null}} opts
 *        `restIndex` es el índice ya leído de la API (H9): con él no se piden
 *        las fases 2 y 3. `profile` es la muestra del proyecto ya contada
 *        (sólo Jira), que va delimitada en el `system` del indexador.
 * @returns {Promise<{contextMd:string, index:object}>}
 */
export async function buildContext(
  client,
  { scope, site, model, onProgress, signal, linkedContext = null, restIndex = null, profile = null }
) {
  const report = (text) => onProgress?.(text)
  // Sólo cuenta un índice con páginas: uno vacío no ahorra ninguna fase y
  // dejaría el sitio sin índice creyendo que ya lo tiene.
  const leido = restIndex && typeof restIndex === 'object' && Object.keys(restIndex.pages || {}).length ? restIndex : null

  report('Abriendo una sesión de indexado…')
  const session = await client.createSession({ title: `Faro · índice de ${site.host}` })

  try {
    report(`Recorriendo ${scope?.label || 'la zona actual'}. Esto puede tardar un par de minutos.`)
    const explore = await client.runTurn(
      session.id,
      {
        // Con el árbol ya leído, la fase 1 lo recibe hecho: así la prosa habla
        // del sitio real desde la primera línea en vez de de lo que el modelo
        // alcanzara a recorrer. Sin él, `treeTitles` devuelve [] y el mensaje
        // es el de siempre, byte a byte (lo pina indexer.test.js).
        text: indexExplorePrompt(scope, { treeTitles: treeTitles(leido) }),
        model,
        system: indexExploreSystem(scope, site, { linkedContext, profile }),
      },
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

    // Un fallo del MODELO sale con lo necesario para clasificarlo (H16): si fue
    // por callarse, el error crudo del proveedor y con qué modelo. Con sólo el
    // mensaje, el `catch` de `generateContext` no podía distinguirlo de un
    // fallo del sitio y dejaba el sitio `onboarded` sin contexto. Los errores
    // de `promptStructured` (fases 2 y 3) ya salen así del cliente y pasan tal cual.
    const conModelo = (err, extra) => Object.assign(err, { model: explore.model || model || null, ...extra })
    if (explore.stalled) {
      throw conModelo(
        new Error('El modelo dejó de responder mientras recorría el sitio. Prueba con otro: los gratuitos se cuelgan a menudo.'),
        { stalled: true, rawError: explore.rawError || null }
      )
    }
    if (explore.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (explore.error) throw conModelo(new Error(explore.error), { rawError: explore.rawError || null })

    const contextMd = explore.text.trim()
    if (!contextMd) throw new Error('El indexador no devolvió ningún documento de contexto.')

    // Con el árbol leído de la API no hay nada que preguntarle al modelo sobre
    // la estructura: lo que devolvió la lista es exacto y ya trae el padre de
    // cada página, que es lo único que la fase 3 venía a conseguir. Dos turnos
    // de modelo menos por indexado, y sin la parte que más se inventaba.
    if (leido) {
      report(`Listo: ${indexSize(leido)} entradas, leídas de la API.`)
      return { contextMd, index: leido }
    }

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
 * El árbol de un espacio leído de la API, convertido en índice. Pura.
 *
 * Lo que llega es lo que devuelve `fetchSpacePages` (confluence-rest.js) a
 * través de la pestaña: páginas con su id, su título, su ruta y el id de su
 * padre. Aquí no se valida menos que lo que escribe un modelo: pasa por el
 * MISMO `normalizeIndex` —rutas relativas por `toSafePath`, mismo host, ids
 * numéricos, prefijo del wiki corregido— y por el MISMO tope de páginas
 * (`INDEX_LIMITS.maxPages`, el que ya aplica `fetchSpacePages`; es la misma
 * constante, no un segundo tope). Lo que cruza un mensaje desde una pestaña es
 * dato, aunque el content script sea nuestro.
 *
 * LA PORTADA no es una rama de la barra lateral, y por eso sus hijas quedan sin
 * padre: es lo mismo que hace `finish` con la cadena de antepasados leída por
 * la API (confluence-rest.js) y lo que el prompt de la fase 3 le pedía al
 * modelo («la raíz del espacio no tiene padre»). Si se dejara como padre, el
 * recorrido paso a paso empezaría por un peldaño que no se puede desplegar.
 * La portada sigue en el índice como una página más: es un destino legítimo.
 *
 * @param {Array<{id:string,title:string,parentId:string|null,url:string,spaceKey:string|null}>} pages
 * @param {{site:object, scope?:object|null, homeId?:string}} opts
 * @returns {object|null} el índice normalizado, o null si no queda ninguna página
 */
export function indexFromSpacePages(pages, { site, scope = null, homeId = '' } = {}) {
  if (!site?.host) return null
  const portada = /^\d+$/.test(String(homeId || '')) ? String(homeId) : ''
  const paginas = []
  const claves = new Set()
  const delAmbito = scope?.kind === 'space' ? validSpaceKey(scope.key) : ''
  if (delAmbito) claves.add(delAmbito)

  for (const p of Array.isArray(pages) ? pages.slice(0, INDEX_LIMITS.maxPages) : []) {
    if (!p || typeof p !== 'object') continue
    const id = String(p.id ?? '')
    if (!/^\d+$/.test(id)) continue
    const clave = validSpaceKey(p.spaceKey)
    if (clave && isRealSpaceKey(clave)) claves.add(clave)
    const padre = String(p.parentId ?? '')
    paginas.push({
      id,
      title: p.title,
      spaceKey: clave || delAmbito,
      parentId: padre && padre !== portada ? padre : '',
      url: p.url,
    })
  }
  if (!paginas.length) return null

  return normalizeIndex(
    {
      pages: paginas,
      spaces: [...claves].map((key) => ({ key, name: key })),
      updated: Date.now(),
    },
    site.host,
    scope,
    { cloud: site.cloud, wikiPrefix: site.wikiPrefix }
  )
}

/**
 * Enriquecimiento incremental, sin coste.
 *
 * En vez de gastar otro turno preguntándole al modelo qué acaba de consultar
 * —lo que además llenaría el historial de ruido—, se lee lo que devolvieron
 * las herramientas MCP. Ahí ya vienen los identificadores reales.
 *
 * @param {Array} parts partes del mensaje del asistente
 * @param {{site:object, index:object|null, allowedHosts?:string[]}} opts
 *   `allowedHosts`: hosts ajenos cuyas URLs NO se blanquean (el Confluence
 *   enlazado desde un Jira DC: sus páginas las tira después el filtro por
 *   producto, pero una incidencia propia enlazada desde una de sus páginas
 *   sigue contando). Todo lo demás con host distinto de `site.host` cae.
 * @returns {{index: object, added: number}}
 */
export function harvestIndex(parts, { site, index, allowedHosts = [] }) {
  const found = ownProductEntities(extractEntities(parts, site, { index, allowedHosts }), site)
  if (!found.pages.length && !found.issues.length && !found.spaces.length) {
    return { index, added: 0 }
  }
  const fresh = normalizeIndex({ ...found, updated: Date.now() }, site.host, index?.scope, { cloud: site?.cloud, wikiPrefix: site?.wikiPrefix })
  if (!indexSize(fresh)) return { index, added: 0 }

  const before = indexSize(index)
  // Lo que devuelve una herramienta no sabe de quién cuelga cada página: no
  // puede borrar el padre que ya se había leído del árbol o de la API.
  const merged = mergeIndexKeepingTree(index, fresh)
  return { index: merged, added: indexSize(merged) - before }
}

/**
 * Sólo las entidades del producto del sitio, en Data Center.
 *
 * Desde un Jira enlazado a un Confluence, el modelo lee páginas de Confluence
 * por el MCP y su salida trae ids y rutas de página; cosecharlas en el índice
 * del host de Jira las convertía en destinos de «Llévame» contra ese host, y
 * eso es un 404. En Cloud los dos productos comparten host y todo vale. Pura.
 */
export function ownProductEntities(found, site) {
  if (!site || site.cloud) return found
  if (site.product === 'jira') return { ...found, pages: [], spaces: [] }
  if (site.product === 'confluence') return { ...found, issues: [], projects: [] }
  return found
}

/**
 * Las incidencias que acaba de devolver la API REST de Jira, al índice. Pura.
 *
 * Hermana de `harvestIndex`, y con su misma firma a propósito: el panel las llama
 * igual y las dos acaban en `mergeIndexKeepingTree`. La diferencia es de dónde
 * viene lo que se funde. `harvestIndex` lee el TEXTO que devolvió una herramienta
 * del MCP y tiene que adivinar con regex qué es una clave y qué no (S6/M4);
 * aquí lo que llega ya pasó por `parseSearchIssues` (claves blancas, clave
 * validada, resumen de una línea acotado), así que basta con volver a exigir la
 * forma de clave —lo que entra en el índice se valida en el índice, no antes— y
 * dejar que `normalizeIndex` fabrique la ruta `/browse/CLAVE`.
 *
 * Esto es lo que hace que una fila de la lista de la tarjeta pueda abrirse sin
 * concatenar ninguna URL: la clave entra en el índice y el destino pasa por
 * `validatePlan` como cualquier otro (§8.3). Y pasa por `ownProductEntities`
 * porque en Data Center Jira y Confluence son dos sitios: desde una pestaña de
 * Confluence, una incidencia no es un destino de ESTE host.
 *
 * @param {Array<{key:string, summary?:string}>} issues lo que devolvió `searchIssues`
 * @param {{site:object, index:object|null}} opts
 * @returns {{index: object|null, added: number}}
 */
export function harvestFromSearch(issues, { site, index }) {
  if (!site) return { index, added: 0 }
  const vistas = new Set()
  const limpias = []
  for (const raw of Array.isArray(issues) ? issues : []) {
    const key = validIssueKey(raw?.key)
    if (!key || vistas.has(key)) continue
    vistas.add(key)
    limpias.push({ key, summary: typeof raw.summary === 'string' ? raw.summary : '' })
  }
  const found = ownProductEntities({ pages: [], spaces: [], projects: [], issues: limpias }, site)
  if (!found.issues.length) return { index, added: 0 }

  const fresh = normalizeIndex({ ...found, updated: Date.now() }, site.host, index?.scope, {
    cloud: site?.cloud,
    wikiPrefix: site?.wikiPrefix,
  })
  if (!indexSize(fresh)) return { index, added: 0 }

  const before = indexSize(index)
  // La MISMA fusión que `harvestIndex`. Hoy `mergeIndex` haría exactamente lo
  // mismo, porque lo que sale de aquí son sólo incidencias y lo que distingue a
  // `mergeIndexKeepingTree` es que no deja que una página nueva le quite el
  // padre a una que ya lo sabía. Se usa igualmente la que conserva el árbol para
  // que no haya dos formas de fundir en el índice: el día que una búsqueda traiga
  // una página —un enlace remoto, un padre— el cambio no sería silencioso.
  const merged = mergeIndexKeepingTree(index, fresh)
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
/**
 * Una clave dentro de una ruta `/browse/CLAVE`: la única forma en que una
 * clave suelta de un proyecto desconocido entra en el índice (M4).
 */
const BROWSE_KEY = /\/browse\/([A-Z][A-Z0-9_]{1,9}-\d+)\b/g
/**
 * El proyecto de una clave que DEVUELVE Jira (`"key": "ENG-1"` en el JSON de
 * `jira_search` o `jira_get_issue`). Sólo el campo `key` a secas: el
 * `"issue_key"` de la entrada lo escribió el modelo y no prueba nada.
 */
const JSON_KEY_PROJECT = /"key"\s*:\s*"([A-Z][A-Z0-9_]{1,9})-\d+"/g
/**
 * Toda URL absoluta, con esquema o sólo con «//» delante. La misma clase de
 * caracteres que usa PAGE_URL para el slug, para que una URL ajena caiga de
 * una pieza y no deje ni la ruta ni la clave (S6).
 */
const ABSOLUTE_URL = /(?:https?:)?\/\/[^\s"'<>)\]]+/gi
const JSON_PAGE = /"(?:id|page_?id)"\s*:\s*"?(\d+)"?[^}]{0,240}?"title"\s*:\s*"([^"]{1,200})"/g
const JSON_TITLE_FIRST = /"title"\s*:\s*"([^"]{1,200})"[^}]{0,240}?"(?:id|page_?id)"\s*:\s*"?(\d+)"?/g
/**
 * Una incidencia tal como la devuelve `jira_search`: `"key": "ABC-1", …,
 * "summary": "…"`. Sin esto, el índice se quedaba con la clave como título y
 * la tarjeta «Puedo llevarte» decía «SIMPL-12» en vez de de qué va.
 */
const JSON_ISSUE = /"key"\s*:\s*"([A-Z][A-Z0-9_]{1,9}-\d+)"[^}]{0,400}?"summary"\s*:\s*"([^"]{1,200})"/g
const JSON_SUMMARY_FIRST = /"summary"\s*:\s*"([^"]{1,200})"[^}]{0,400}?"key"\s*:\s*"([A-Z][A-Z0-9_]{1,9}-\d+)"/g

/**
 * Saca entidades de Atlassian del texto que devolvieron las herramientas.
 * Pura y comprobable: es lo que mantiene vivo el índice con el uso.
 *
 * Dos barreras antes de las regex, las dos reproducidas en la auditoría del
 * 2026-09-13 (docs/PLAN.md §2, S6 y M4):
 *   - Toda URL absoluta cuyo host no sea el del sitio (ni uno de
 *     `allowedHosts`) se sustituye por un espacio. Sin esto, una página de
 *     `partner.atlassian.net` entraba con una ruta relativa a ESTE sitio,
 *     `validatePlan` la aceptaba (la URL se reconstruye contra el origen
 *     propio) y «Llévame» abría un 404. Una ruta relativa sigue valiendo.
 *   - Una clave suelta («ABC-12») sólo es una incidencia si su proyecto es
 *     conocido: el de la pestaña, los del índice (`projects`, o el de sus
 *     `issues`) o los de las claves que devuelve Jira en JSON; o si viene en
 *     una ruta `/browse/CLAVE`. Sin esto, «UTF-8», «ISO-8601» o «COVID-19»
 *     eran incidencias y destino de «Llévame».
 *
 * @param {Array} parts
 * @param {object} site el de `parseAtlassianUrl` (host, projectKey…)
 * @param {{index?:object|null, allowedHosts?:string[]}} opts
 */
export function extractEntities(parts, site, { index = null, allowedHosts = [] } = {}) {
  const blob = dropForeignUrls(collectToolText(parts), [site?.host, ...asStrings(allowedHosts)])
  const pages = new Map()
  const spaces = new Map()
  const issues = new Map()

  const addSpace = (key) => {
    if (!isRealSpaceKey(key) || spaces.has(key)) return
    spaces.set(key, { key, name: key, url: canonicalSpacePath(site, key) })
  }

  for (const m of blob.matchAll(PAGE_URL)) {
    const [, spaceKey, id, slug] = m
    // Un slug que no se deja decodificar no es un título (`decodeSlug` da ''):
    // queda el marcador, que es la señal de «lee el título por su id».
    const title = (slug && decodeSlug(slug)) || `Página ${id}`
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

  const conocidos = knownProjects(site, index, blob)
  const enRuta = new Set()
  for (const m of blob.matchAll(BROWSE_KEY)) enRuta.add(m[1])
  for (const m of blob.matchAll(ISSUE_KEY)) {
    const key = m[1]
    if (issues.has(key)) continue
    if (!conocidos.has(key.split('-')[0]) && !enRuta.has(key)) continue
    issues.set(key, { key, summary: key, url: `/browse/${key}` })
  }

  // Los títulos de incidencia suelen venir como "KEY: resumen" o "KEY - resumen".
  for (const [key, entry] of issues) {
    const m = blob.match(new RegExp(escapeRe(key) + '\\s*[:\\-–]\\s*([^\\n"]{3,140})'))
    if (m) entry.summary = m[1].trim()
  }
  // Y en el JSON de `jira_search`, como clave y resumen en el mismo objeto.
  for (const re of [JSON_ISSUE, JSON_SUMMARY_FIRST]) {
    for (const m of blob.matchAll(re)) {
      const [key, summary] = re === JSON_ISSUE ? [m[1], m[2]] : [m[2], m[1]]
      const entry = issues.get(key)
      if (entry && entry.summary === key) entry.summary = summary.trim()
    }
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

/**
 * Sustituye por un espacio toda URL absoluta cuyo host no esté en `hosts`
 * (nombres de host, sin puerto; se comparan en minúsculas). Lo que no parsea
 * como URL también cae. Pura; es la barrera de S6.
 */
export function dropForeignUrls(text, hosts) {
  const propios = new Set(asStrings(hosts).map((h) => h.toLowerCase()))
  return String(text || '').replace(ABSOLUTE_URL, (u) => (propios.has(hostOfUrl(u)) ? u : ' '))
}

function hostOfUrl(u) {
  try {
    return new URL(u.startsWith('//') ? 'https:' + u : u).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function asStrings(list) {
  if (!Array.isArray(list)) return []
  return list.filter((h) => typeof h === 'string' && h.trim()).map((h) => h.trim())
}

/**
 * Los proyectos de Jira de los que se fía la cosecha de claves sueltas: el
 * de la pestaña, los del índice (sus `projects` y el proyecto de cada una de
 * sus `issues`) y los de las claves que devuelve Jira en JSON. Pura.
 */
function knownProjects(site, index, blob) {
  const out = new Set()
  const add = (k) => {
    const p = validProjectKey(k)
    if (p) out.add(p)
  }
  add(site?.projectKey)
  for (const k of Object.keys(index?.projects || {})) add(k)
  for (const is of Object.values(index?.issues || {})) add(is?.projectKey || String(is?.key || '').split('-')[0])
  for (const m of blob.matchAll(JSON_KEY_PROJECT)) add(m[1])
  return out
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

/**
 * El último segmento de la URL de una página, convertido en su título: los «+»
 * son espacios y lo codificado se decodifica. Los «+» se cambian ANTES de
 * decodificar: al revés, un «+» del propio título («C%2B%2B+Guide») salía como
 * espacio y la página se llamaba «C Guide» (revisión adversaria de H14). Un
 * «%» mal escrito no lanza: da '', que es «no hay título», y quien lo llama
 * pone el marcador «Página N» —devolver el texto crudo era llamar a una página
 * «%E0%A4%A»—.
 *
 * Se exporta desde H10 porque `source-suggest.js` lo necesita para lo mismo:
 * un enlace `/display/ESPACIO/Runbook+de+guardia` no lleva id, y la única
 * forma admitida de resolverlo es buscar ese título en el índice —nunca
 * mandárselo a la API como consulta (§8.12)—. Copiarlo allí habría dejado dos
 * reglas de decodificación que se separarían. Pura.
 */
export function decodeSlug(slug) {
  try {
    return decodeURIComponent(String(slug ?? '').replace(/\+/g, ' ')).trim()
  } catch {
    return ''
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

// Los antepasados de UNA página ya no se le piden al modelo: los lee el panel
// de la API REST del propio Confluence (`src/shared/confluence-rest.js`), en
// milisegundos y sin depender de que el modelo sepa usar el MCP.
