/**
 * Sugerir páginas base, y explicar por qué.
 *
 * La pantalla de páginas base se abre vacía y el usuario repite la misma
 * búsqueda en cada ticket parecido. Aquí se juntan las cuatro fuentes que Faro
 * ya tiene delante —lo que la incidencia o la página ENLAZA, lo que el usuario
 * ELIGIÓ en análisis anteriores (`source-history.js`), lo que el CONTEXTO DEL
 * SITIO nombra como guía o decisión (`references.js`) y los títulos del ÍNDICE
 * que tienen forma de referencia—, se puntúan y se ordenan. Ninguna de las
 * cuatro llama al modelo ni gasta un token: todas son locales o ya estaban
 * leídas (docs/PLAN.md §3.2).
 *
 * Las dos reglas que no se negocian (CLAUDE.md §8.20):
 *  - Faro NUNCA añade una página base por su cuenta. De aquí salen candidatas
 *    con su puntuación y su motivo; el clic es del usuario y pasa por el mismo
 *    `addSourcePage` de siempre, con su tope de seis.
 *  - Cada sugerencia dice DE DÓNDE sale, y ese texto lo escribe la extensión,
 *    no el modelo ni la página: un título de Confluence entra por `clean` y
 *    entre comillas, como todo lo demás.
 *
 * Y la que no se negocia de §8.12: un enlace `/display/ESPACIO/Título` sin id
 * se resuelve SÓLO contra el índice (título plegado + espacio) o por el
 * `pageId` de un enlace remoto de Jira. Mandar ese título a la API de
 * Confluence como consulta sería dejar que el contenido de una página decida
 * qué petición se hace; lo que no se resuelva, no se sugiere.
 *
 * El umbral (`minScore`) es lo que impide que una señal débil sola llegue a la
 * pantalla: un título del índice con forma de guía suma como mucho 21 y un
 * componente compartido sin familia 15, así que ninguno aparece si no lo
 * acompaña algo más. Marcar de más aquí cuesta un clic de menos en «Quitar»;
 * sugerir una página que no tiene nada que ver, en cambio, hace que el usuario
 * deje de mirar la sección.
 *
 * Todo puro y con el reloj inyectado: se prueba en Node.
 */

import { clean } from '../nav/validate.js'
import { isPlaceholderTitle } from '../atlassian/index-store.js'
import { isRealSpaceKey, parseAtlassianUrl } from '../atlassian/site.js'
import { isGenericTitle } from '../shared/jira-rest.js'
import { decodeSlug } from './indexer.js'
import { issueProfile } from './issue-profile.js'
import { roleForFamily } from './references.js'
import { DAY_MS, HISTORY_LIMITS, titleWords, usesOf } from './source-history.js'
import { foldText, pageRefFromUrl, SOURCE_LIMITS } from './sources.js'

export const SUGGEST_LIMITS = {
  /** Filas que se enseñan. Más no caben en 320 px sin tapar «Páginas elegidas». */
  max: 5,
  /**
   * Lo que hay que sumar para salir. Por debajo de esto una sugerencia sería
   * «esta página comparte una palabra con el título», que es ruido.
   */
  minScore: 25,
  /** Enlaces de la página que se miran. */
  linksMax: 60,
  /** Motivos que se enseñan de una sugerencia, y cuánto ocupan juntos. */
  reasonsMax: 2,
  reasonMax: 120,
  /** A partir de aquí, un uso anterior vale la mitad. */
  decayDays: 60,
  /** Tope de lo que puede sumar un título del índice: nunca llega al umbral solo. */
  titleScoreMax: 21,
  /** Cuántos análisis de más suman por encima de los dos que pide la regla. */
  familyExtraMax: 3,
  /** Palabras que tiene que compartir un título del índice para contar. */
  sharedWordsMin: 2,
}

/**
 * Lo que suma cada fuente. Un enlace desde la descripción es la señal más
 * fuerte que hay —alguien puso ahí esa página a propósito para quien lea la
 * incidencia—; un comentario, menos, porque un comentario enlaza cosas de paso.
 */
export const SUGGEST_SCORE = {
  remoto: 50,
  descripcion: 50,
  enlaces: 45,
  pagina: 45,
  comentario: 35,
  usadaAqui: 40,
  familiaAmbito: 30,
  familiaAmbitoExtra: 5,
  familiaEtiqueta: 30,
  etiqueta: 15,
  ambito: 10,
  referencia: 25,
  referenciaFamilia: 10,
  tituloIndice: 12,
  tituloIndicePalabra: 3,
}

/**
 * De dónde puede venir un enlace, de la más fuerte a la más débil. El orden es
 * el que decide qué motivo se enseña cuando la misma página está enlazada en
 * dos sitios: una página enlazada dos veces no es el doble de relevante, así
 * que se queda con el mejor sitio y con sus puntos, no con la suma.
 */
export const LINK_WHERE = ['remoto', 'descripcion', 'enlaces', 'pagina', 'comentario']

const LINK_TEXT = {
  remoto: 'enlazada en Jira a esta incidencia',
  descripcion: 'enlazada desde la descripción',
  enlaces: 'desde los enlaces de la incidencia',
  pagina: 'enlazada desde esta página',
  comentario: 'desde un comentario',
}

const ROLE_TEXT = {
  guia: 'guía',
  plantilla: 'plantilla',
  adr: 'decisión (ADR)',
  glosario: 'glosario',
  convenciones: 'convenciones',
  arquitectura: 'arquitectura',
  proceso: 'proceso',
  otra: 'referencia',
}

/** Cómo se llama cada clase de trabajo dentro de un motivo: «3 análisis de API». */
const FAMILY_LABEL = {
  api: 'API',
  bug: 'errores',
  test: 'pruebas',
  epic: 'épicas',
  architecture: 'arquitectura',
  doc: 'documentación',
  story: 'historias',
  task: 'tareas',
}

/**
 * Un título con forma de página de referencia, en español y en inglés. Sólo
 * sirve para reforzar (12-21 puntos, nunca llega al umbral solo), así que un
 * falso positivo como «Guía de viaje del equipo» no puede colarse por sí mismo.
 * Sin bandera `g`: `test()` con estado global daría resultados alternos.
 */
export const REFERENCE_TITLE =
  /gu[ií]a|guidelines?\b|\bguide\b|plantilla|template|\badr\b|decisi[oó]n|glosario|glossary|convenci[oó]n|convention|naming|nomenclatura|checklist|est[aá]ndar|standard|definition of (?:ready|done)|arquitectura|architecture|runbook|procesos?\b|process\b|procedimiento/i

const ID = /^\d+$/

// ------------------------------------------------------- enlaces a páginas

/**
 * De dónde puede salir el título de una página, de lo más fiable a lo menos, y
 * por qué en ese orden:
 *
 *  1. el ÍNDICE, que es el título que Faro leyó de la propia Confluence;
 *  2. el TEXTO del enlace en el DOM, que es lo que el usuario tiene delante;
 *  3. el título del ENLACE REMOTO que guardó Jira, que puede estar viejo (se
 *     escribió el día que se creó el enlace) o ser genérico;
 *  4. el SLUG de la ruta, que es el título con los espacios como «+»;
 *  5. y el marcador «Página N», que no es un título sino la señal de que hay que
 *     leerlo: al añadirla, `chooseSuggestion` la manda por `addSourceById`, que
 *     pregunta el título de verdad por su id (revisión adversaria de H10).
 *
 * El título y la PROCEDENCIA (`where`) se deciden por separado. Pasó de verdad
 * (Jira Data Center del usuario, 2026-09-21): la misma página llegaba por el
 * enlace remoto de la API —que la titula «Page»— y por el `a.link-title` del
 * módulo de enlaces del DOM —que trae el título de verdad—; los remotos se leen
 * primero, así que el primer título no vacío se quedaba y la sugerencia se
 * llamaba «Page» con la procedencia correcta.
 */
const TITULO = { indice: 1, dom: 2, remoto: 3, slug: 4, marcador: 5 }

/**
 * Un texto que es una URL pegada, no el nombre de nada. Real: en las
 * descripciones de las incidencias los enlaces a Confluence se pegan tal cual y
 * el texto del `<a>` ES la URL, de 80 a 106 caracteres.
 */
const PARECE_URL = /^(?:https?:\/\/|\/\/|www\.)/i

/**
 * Un título con el que se puede LLAMAR a una página en una lista, o ''.
 *
 * Se cae lo que no nombra la página: un marcador «Página N», un genérico como
 * «Page» (la misma regla que aplica `parseRemoteLinks` a lo que viene de la API:
 * una sola lista, en `jira-rest.js`) y una URL pegada. Lo que salga de aquí se
 * enseña en la fila, va dentro de su `aria-label` y, si el usuario la añade,
 * acaba nombrando la página base en el prompt del Análisis.
 */
function tituloUtil(raw) {
  const t = clean(raw, SOURCE_LIMITS.titleMax)
  return !t || isPlaceholderTitle(t) || isGenericTitle(t) || PARECE_URL.test(t) ? '' : t
}

/**
 * El título que la propia ruta lleva dentro, cuando lo lleva: el último segmento
 * de `/spaces/KEY/pages/ID/Slug` y de `/display/KEY/Slug`, con o sin prefijo del
 * wiki delante. '' en cualquier otra forma, y ahí está lo importante: el último
 * segmento de `/pages/viewpage.action?pageId=200` es «viewpage.action» y el de
 * `/display/ENG` es la clave del espacio, no un título.
 */
const SLUG_EN_RUTA = /\/(?:spaces\/[^/]+\/pages\/\d+|display\/[^/]+)\/([^/]+)\/?$/

function slugDeRuta(href) {
  let ruta = ''
  try {
    ruta = new URL(String(href ?? '')).pathname
  } catch {
    return ''
  }
  const m = SLUG_EN_RUTA.exec(ruta)
  return m ? decodeSlug(m[1]) : ''
}

/**
 * Un `/display/ESPACIO/Título` resuelto contra el índice: el último segmento es
 * el título con los espacios como «+», y si el índice tiene una página con ese
 * mismo título plegado en ese mismo espacio, es ésa.
 *
 * Nunca se pregunta a la API por un título (§8.12): lo que no esté en el
 * índice, no se sugiere. Determinista: si dos páginas tuvieran el mismo título
 * plegado, gana la del id más bajo.
 */
function porIndice(href, index) {
  const parsed = parseAtlassianUrl(href)
  if (!parsed || parsed.product !== 'confluence') return ''
  const titulo = foldText(clean(slugDeRuta(href), SOURCE_LIMITS.titleMax))
  if (!titulo) return ''
  const espacio = parsed.spaceKey || ''
  const candidatos = []
  for (const p of Object.values(index?.pages || {})) {
    if (!p || !ID.test(String(p.id ?? ''))) continue
    if (espacio && p.spaceKey && String(p.spaceKey) !== espacio) continue
    if (foldText(String(p.title || '')) !== titulo) continue
    candidatos.push(String(p.id))
  }
  return candidatos.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || ''
}

/**
 * Cuáles de los enlaces leídos de la página apuntan a una página de Confluence
 * que se puede añadir como página base, y desde dónde.
 *
 * SEGURIDAD: todo pasa primero por `pageRefFromUrl`, que sólo acepta http(s)
 * del host de la pestaña o del Confluence ENLAZADO. Un `javascript:`, un
 * `data:`, un `#`, una URL de otro host, una de Jira (`/browse/…`) o una que no
 * parsea se caen ahí. Un href tiene que ser absoluto para llegar siquiera a esa
 * comprobación: `pageRefFromUrl` acepta además un número suelto como id, y una
 * ruta relativa que fuera un número se habría colado por ahí. Pura.
 *
 * De cada página salen dos cosas y se deciden por separado: la PROCEDENCIA, que
 * es la mejor de `LINK_WHERE`, y el TÍTULO, que es el de la mejor fuente de
 * `TITULO` (ahí está el porqué). Una misma página enlazada dos veces sale una.
 *
 * @param {Array<{href?:string, text?:string, where?:string}>} links los del DOM
 * @param {{ok?:boolean, links?:Array<{pageId?:string, title?:string, url?:string}>}|null} remote
 *        los enlaces remotos de la incidencia, si la API contestó
 * @returns {Array<{id:string, path:string, spaceKey:string|null, title:string, where:string}>}
 */
export function confluenceLinksIn(links, remote, { site = null, linkedHost = '', index = null } = {}) {
  const porId = new Map()
  /**
   * De qué fuente salió el título que lleva puesto cada candidata. Va aparte y
   * no dentro del objeto porque lo que se devuelve tiene claves EXACTAS (§6) y
   * esto es cocina de aquí dentro.
   */
  const rangos = new Map()

  const anotar = (id, where, { title = '', from = 'dom', spaceKey = null, path = '', href = '' } = {}) => {
    if (!ID.test(String(id ?? ''))) return
    if (!LINK_WHERE.includes(where)) return
    if (!porId.has(id) && porId.size >= SUGGEST_LIMITS.linksMax) return

    const delIndice = index?.pages?.[id] || null
    const espacio = clean(delIndice?.spaceKey ?? spaceKey, SOURCE_LIMITS.spaceKeyMax)
    // El mejor título de los que esta llegada puede dar, por el orden de `TITULO`.
    let titulo = `Página ${id}`
    let rango = TITULO.marcador
    for (const [cual, texto] of [
      [TITULO.indice, tituloUtil(delIndice?.title)],
      [from === 'remoto' ? TITULO.remoto : TITULO.dom, tituloUtil(title)],
      [TITULO.slug, tituloUtil(slugDeRuta(href))],
    ]) {
      if (texto && cual < rango) {
        titulo = texto
        rango = cual
      }
    }
    const candidato = {
      id,
      path: typeof delIndice?.path === 'string' && delIndice.path ? delIndice.path : typeof path === 'string' ? path : '',
      spaceKey: isRealSpaceKey(espacio) ? espacio : null,
      title: titulo,
      where,
    }
    const previo = porId.get(id)
    if (!previo) {
      porId.set(id, candidato)
      rangos.set(id, rango)
      return
    }
    if (LINK_WHERE.indexOf(where) < LINK_WHERE.indexOf(previo.where)) previo.where = where
    // La procedencia se queda con la mejor y el título con el de mejor fuente,
    // cada uno por su cuenta: la llegada que gana una cosa no gana la otra.
    if (rango < (rangos.get(id) ?? TITULO.marcador)) {
      previo.title = titulo
      rangos.set(id, rango)
    }
    if (!previo.spaceKey && candidato.spaceKey) previo.spaceKey = candidato.spaceKey
    if (!previo.path && candidato.path) previo.path = candidato.path
  }

  // Los remotos primero: traen el id sin depender del DOM, que es justo lo que
  // el módulo de enlaces de un Jira Data Center no garantiza.
  if (remote?.ok) {
    for (const l of Array.isArray(remote.links) ? remote.links : []) {
      anotar(String(l?.pageId ?? '').trim(), 'remoto', { title: l?.title, from: 'remoto', href: l?.url })
    }
  }

  let mirados = 0
  for (const l of Array.isArray(links) ? links : []) {
    if (mirados >= SUGGEST_LIMITS.linksMax) break
    mirados++
    const href = typeof l?.href === 'string' ? l.href.trim() : ''
    if (!/^https?:\/\//i.test(href)) continue
    const where = LINK_WHERE.includes(l?.where) && l.where !== 'remoto' ? l.where : 'pagina'
    const ref = pageRefFromUrl(href, site, { linkedHost })
    if (ref.ok) {
      anotar(ref.id, where, { title: l?.text, spaceKey: parseAtlassianUrl(href)?.spaceKey, path: ref.path, href })
      continue
    }
    // Sólo un `/display/` del sitio o del enlazado llega aquí: `pageRefFromUrl`
    // ya descartó otro host, Jira y lo que no es una URL.
    if (ref.reason !== 'sin-id') continue
    const id = porIndice(href, index)
    if (id) anotar(id, where, { title: l?.text, spaceKey: parseAtlassianUrl(href)?.spaceKey, href })
  }

  return [...porId.values()]
}

// --------------------------------------------------------------- motivos

function cuentaAnalisis(n) {
  return `${n} análisis`
}

function etiquetaFamilia(family) {
  const f = String(family ?? '')
  return Object.hasOwn(FAMILY_LABEL, f) ? FAMILY_LABEL[f] : ''
}

/**
 * Los motivos de una sugerencia, unidos y acotados: como mucho dos, porque la
 * fila es una línea con elipsis y el tercero no se leería. Los textos los
 * escribe `suggestSources`; aquí sólo se juntan. Pura.
 */
export function reasonText(reasons, { max = SUGGEST_LIMITS.reasonsMax } = {}) {
  const tope = Number.isInteger(max) && max > 0 ? max : SUGGEST_LIMITS.reasonsMax
  const textos = []
  for (const r of Array.isArray(reasons) ? reasons : []) {
    if (textos.length >= tope) break
    const t = clean(r?.text, SUGGEST_LIMITS.reasonMax)
    if (!t || textos.includes(t)) continue
    textos.push(t)
  }
  return textos.join(' · ').slice(0, SUGGEST_LIMITS.reasonMax)
}

// ------------------------------------------------------------- sugerencias

/**
 * Las páginas base que Faro propone, con sus puntos y sus motivos.
 *
 * El índice NO crea candidatas: un título con forma de guía sólo refuerza a una
 * que ya venga de un enlace, del historial o del contexto. Es lo mismo que
 * saldría dejándole crear candidatas —21 puntos nunca llegan a 25— y evita
 * recorrer trescientas páginas para descartarlas todas.
 *
 * @param {{index?:object|null, references?:object|null, history?:object|null,
 *          links?:Array, issue?:object|null, summary?:string, projectKey?:string,
 *          spaceKey?:string, pageId?:string, issueKey?:string, exclude?:Array,
 *          product?:string, linked?:boolean, now?:number, max?:number}} ctx
 *        `linked` es «estas páginas son del Confluence ENLAZADO»: entonces la
 *        ruta se vacía, porque el índice que llega es el de ese otro host y su
 *        ruta no es de este sitio (§4.8).
 * @returns {Array<{id:string, path:string, reasons:Array<{kind:string, text:string}>,
 *                  score:number, source:'suggested', spaceKey:string|null, title:string}>}
 */
export function suggestSources({
  index = null,
  references = null,
  history = null,
  links = [],
  issue = null,
  summary = '',
  projectKey = '',
  spaceKey = '',
  pageId = '',
  issueKey = '',
  exclude = [],
  product = '',
  linked = false,
  now = Date.now(),
  max = SUGGEST_LIMITS.max,
} = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const enJira = product === 'jira'
  const { family } = issueProfile(issue, { summary })
  const ambito = clean(projectKey, SOURCE_LIMITS.spaceKeyMax) || clean(spaceKey, SOURCE_LIMITS.spaceKeyMax)
  const aqui = issueKey || pageId

  // Se pliegan y se acotan igual que al guardarlas (`HISTORY_LIMITS.tagMax`):
  // si los dos lados no se limpian con la misma regla, «Auth» de la pantalla no
  // casaría nunca con «auth» del historial.
  const etiquetasAqui = new Set(
    [...(Array.isArray(issue?.components) ? issue.components : []), ...(Array.isArray(issue?.labels) ? issue.labels : [])]
      .map((x) => foldText(clean(x, HISTORY_LIMITS.tagMax)))
      .filter(Boolean)
  )
  const palabrasAqui = new Set([...titleWords(summary), ...etiquetasAqui])

  const fuera = new Set([...(Array.isArray(exclude) ? exclude : []), pageId].map((x) => String(x ?? '').trim()).filter(Boolean))

  // ---- de dónde sale cada candidata, y cómo se llama -----------------------
  const enlazadas = new Map()
  const datos = new Map()
  const anotar = (id, { title = '', spaceKey: espacio = null, path = '' } = {}) => {
    const previo = datos.get(id) || { id, path: '', spaceKey: null, title: '' }
    // El primero que sirva. Como el índice se anota antes que la fuente en los
    // tres bucles de abajo, «el primero» es el del índice cuando lo hay; y lo
    // que no sirve —un marcador, un genérico, una URL— ni se guarda, así que ya
    // no hay que mirar si lo de antes era un marcador para reemplazarlo. Un
    // historial de antes de H14 pudo guardar una página base llamada «Page», y
    // el título de una referencia lo escribió el modelo en el CONTEXTO DEL SITIO.
    const nuevo = tituloUtil(title)
    if (nuevo && !previo.title) previo.title = nuevo
    if (!previo.spaceKey && isRealSpaceKey(espacio)) previo.spaceKey = espacio
    if (!previo.path && typeof path === 'string' && path) previo.path = path
    datos.set(id, previo)
  }

  const candidatas = new Set()
  const apuntar = (id) => {
    if (!ID.test(String(id ?? '')) || fuera.has(id)) return
    candidatas.add(id)
    const p = index?.pages?.[id]
    if (p) anotar(id, { title: p.title, spaceKey: p.spaceKey, path: p.path })
  }

  // `links` son los que ya filtró `confluenceLinksIn`: uno por página, con su
  // mejor procedencia. Si llegaran repetidos, se queda con la más fuerte.
  for (const l of Array.isArray(links) ? links : []) {
    const id = String(l?.id ?? '').trim()
    apuntar(id)
    if (!candidatas.has(id)) continue
    const w = LINK_WHERE.includes(l?.where) ? l.where : ''
    if (w && (!enlazadas.has(id) || LINK_WHERE.indexOf(w) < LINK_WHERE.indexOf(enlazadas.get(id)))) enlazadas.set(id, w)
    anotar(id, { title: l.title, spaceKey: l.spaceKey, path: l.path })
  }

  for (const e of Array.isArray(history?.entries) ? history.entries : []) {
    for (const p of Array.isArray(e?.pages) ? e.pages : []) {
      const id = String(p?.id ?? '').trim()
      apuntar(id)
      if (candidatas.has(id)) anotar(id, { title: p.title, spaceKey: p.spaceKey })
    }
  }

  for (const r of Object.values(references?.items || {})) {
    const id = String(r?.id ?? '').trim()
    apuntar(id)
    if (candidatas.has(id)) anotar(id, { title: r.title })
  }

  // ---- puntuar -------------------------------------------------------------
  const out = []
  for (const id of candidatas) {
    const info = datos.get(id) || { id, path: '', spaceKey: null, title: '' }
    const titulo = info.title || `Página ${id}`
    const where = enlazadas.get(id) || ''
    // Una página de la que sólo se sabe el id no dice nada en una lista de
    // sugerencias… salvo que venga enlazada, que es motivo suficiente de por sí.
    if (isPlaceholderTitle(titulo) && !where) continue

    let score = 0
    const reasons = []
    if (where) {
      score += SUGGEST_SCORE[where]
      reasons.push({ kind: where, text: LINK_TEXT[where] })
    }

    const delHistorial = puntosDelHistorial(id, { history, family, ambito, etiquetasAqui, aqui, enJira, now: t })
    if (delHistorial) {
      score += delHistorial.score
      reasons.push(delHistorial.reason)
    }

    const ref = references?.items && Object.hasOwn(references.items, id) ? references.items[id] : null
    if (ref) {
      const casa = family && (roleForFamily(family).includes(ref.role) || (ref.families || []).includes(family))
      score += SUGGEST_SCORE.referencia + (casa ? SUGGEST_SCORE.referenciaFamilia : 0)
      reasons.push({ kind: 'referencia', text: `el contexto la nombra como ${ROLE_TEXT[ref.role] || ROLE_TEXT.otra}` })
    }

    const delIndice = puntosDelIndice(id, { index, palabrasAqui })
    if (delIndice) {
      score += delIndice
      reasons.push({ kind: 'indice', text: 'el título la señala como referencia' })
    }

    if (score < SUGGEST_LIMITS.minScore) continue
    out.push({
      id,
      path: linked ? '' : info.path,
      reasons,
      score,
      source: 'suggested',
      spaceKey: info.spaceKey,
      title: titulo,
    })
  }

  const tope = Number.isInteger(max) && max > 0 ? max : SUGGEST_LIMITS.max
  out.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es') || a.id.length - b.id.length || a.id.localeCompare(b.id)
  )
  return out.slice(0, tope)
}

/**
 * Lo que aporta el historial, que es UN solo motivo: el más fuerte de los que
 * casen. Una página usada en esta misma incidencia no suma además por ser del
 * mismo proyecto; las reglas son variantes cada vez más débiles de la misma
 * señal, no señales distintas.
 */
function puntosDelHistorial(id, { history, family, ambito, etiquetasAqui, aqui, enJira, now }) {
  const u = usesOf(history, id, { here: aqui })
  if (!u.total) return null

  let mejor = null
  const proponer = (score, text) => {
    if (score > 0 && (!mejor || score > mejor.score)) mejor = { score, text }
  }
  const compartida = (uso) => uso.tags.find((x) => etiquetasAqui.has(x)) || ''

  if (u.usedHere) proponer(SUGGEST_SCORE.usadaAqui, enJira ? 'la usaste en esta incidencia' : 'la usaste en esta página')

  const nombre = etiquetaFamilia(family)
  if (family && ambito) {
    const n = u.uses.filter((x) => x.family === family && x.scope === ambito).length
    if (n >= 2) {
      proponer(
        SUGGEST_SCORE.familiaAmbito + SUGGEST_SCORE.familiaAmbitoExtra * Math.min(n - 2, SUGGEST_LIMITS.familyExtraMax),
        `la usaste en ${cuentaAnalisis(n)}${nombre ? ` de ${nombre}` : ''} en ${ambito}`
      )
    }
  }
  if (family && etiquetasAqui.size) {
    const usos = u.uses.filter((x) => x.family === family && compartida(x))
    if (usos.length) {
      proponer(
        SUGGEST_SCORE.familiaEtiqueta,
        `la usaste en ${cuentaAnalisis(usos.length)}${nombre ? ` de ${nombre}` : ''} con «${compartida(usos[0])}»`
      )
    }
  }
  if (etiquetasAqui.size) {
    const usos = u.uses.filter((x) => compartida(x))
    if (usos.length) proponer(SUGGEST_SCORE.etiqueta, `la usaste en ${cuentaAnalisis(usos.length)} con «${compartida(usos[0])}»`)
  }
  if (ambito) {
    const n = u.uses.filter((x) => x.scope === ambito).length
    if (n >= 3) proponer(SUGGEST_SCORE.ambito, `la usaste en ${cuentaAnalisis(n)} de ${ambito}`)
  }

  if (!mejor) return null
  // Lo que se usó hace más de dos meses sigue contando, pero la mitad: los
  // sitios cambian de guía y una elección vieja no puede mandar para siempre.
  const viejo = u.lastAt > 0 && now - u.lastAt > SUGGEST_LIMITS.decayDays * DAY_MS
  return { score: viejo ? Math.round(mejor.score / 2) : mejor.score, reason: { kind: 'historial', text: mejor.text } }
}

/** Y lo que aporta el título del índice: refuerzo, nunca lo bastante para salir solo. */
function puntosDelIndice(id, { index, palabrasAqui }) {
  const p = index?.pages?.[id]
  const titulo = clean(p?.title, SOURCE_LIMITS.titleMax)
  if (!titulo || isPlaceholderTitle(titulo) || !REFERENCE_TITLE.test(titulo)) return 0
  const compartidas = titleWords(titulo).filter((w) => palabrasAqui.has(w)).length
  if (compartidas < SUGGEST_LIMITS.sharedWordsMin) return 0
  return Math.min(
    SUGGEST_SCORE.tituloIndice + SUGGEST_SCORE.tituloIndicePalabra * (compartidas - SUGGEST_LIMITS.sharedWordsMin),
    SUGGEST_LIMITS.titleScoreMax
  )
}
