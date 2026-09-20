/**
 * «Qué mirar hoy»: qué merece tu atención en este sitio, ordenado y explicado.
 *
 * POR QUÉ EXISTE: Marco abre Jira cada mañana y lo primero que tiene que
 * decidir es por dónde empezar, que es justo lo que ni Jira ni Confluence le
 * dicen —una bandeja de «actualizados» no distingue lo que cambió DESPUÉS de
 * que tú lo miraras de lo que cambió porque tú lo tocaste—. Faro sí puede
 * distinguirlo, porque tiene las dos mitades: el servidor sabe cuándo cambió
 * algo y el diario local (`src/atlassian/activity.js`) sabe cuándo lo miraste
 * tú, qué analizaste y con cuántas observaciones (docs/PLAN.md §3.1).
 *
 * POR QUÉ SIN MODELO: recomendar es ordenar una lista de treinta filas por
 * unas reglas que caben en esta página. Pedírselo al modelo costaría segundos y
 * tokens en cada arranque, daría una respuesta distinta cada vez y no se podría
 * explicar: cada fila tiene que poder decir POR QUÉ está ahí, en español, y ese
 * texto lo escribe la extensión (CLAUDE.md §8.20). Aquí no se llama a nadie: se
 * suman pesos enteros y se ordena.
 *
 * LO QUE NO SALE DE AQUÍ:
 *  - Ninguna URL. Este módulo produce `{kind, id, host}`; NAVEGAR es del panel y
 *    pasa por el índice y `validatePlan` para el host propio, o por
 *    `canonicalPagePath` con el id validado para el enlazado (§8.3, PLAN §3.1).
 *    Por eso no hay ningún `todayPlan` que fabrique direcciones.
 *  - Nada para un prompt. Los títulos y los motivos van a filas que el panel
 *    pinta con `textContent`; lo único que este módulo escribe para el cuadro
 *    de escribir es `analyzeQuestion`, y ahí no entra ni el título, ni la clave,
 *    ni el id, ni el host (mira su cabecera).
 *  - Ningún dato de persona salvo `updatedBy`, el nombre VISIBLE de quien
 *    modificó una página, que ya viene acotado de `parseRecentV1`: es lo que
 *    hace útil un «página base de tus análisis · modificada por Marta». De
 *    Jira no se enseña ninguno: la API dice quién es el asignado, pero Faro no
 *    sabe quién eres tú (nunca pregunta `myself`, descartado en PLAN §3.1) y
 *    poner el nombre del asignado en una fila sería decir algo que nadie pidió.
 *
 * DETERMINISTA, Y POR QUÉ IMPORTA: las lecturas llegan por `Promise.allSettled`,
 * o sea en el orden en que conteste la red. Las mismas respuestas en otro orden
 * tienen que dar la MISMA lista, así que las lecturas se ordenan antes de
 * fundirlas y el desempate final es total (puntos, fecha, título, clave). El
 * reloj se inyecta: «cambió ayer» tiene que decir lo mismo hoy que dentro de un
 * año en una prueba.
 *
 * Puro: no toca DOM, ni `chrome`, ni la red. Quien pide es el panel.
 */

import { ACTIVITY_LIMITS, activityKey } from '../atlassian/activity.js'
import { ancestryOf } from '../atlassian/index-store.js'
import { isRealSpaceKey, sinInvisibles, validIssueKey, validProjectKey } from '../atlassian/site.js'
import { CONFLUENCE_REST_LIMITS } from '../shared/confluence-rest.js'
import { issueFamily } from './issue-profile.js'
import { DAY_MS, titleWords } from './source-history.js'
import { linkedSite } from './sources.js'

export const TODAY_LIMITS = {
  /** Filas que salen de aquí. Ocho es una pantalla; una lista larga no se mira. */
  maxItems: 8,
  /**
   * Y como mucho cinco de un producto: con los dos enchufados, ocho filas de
   * Jira dejarían Confluence sin aparecer nunca, que es justo lo que pasa hoy
   * sin esta pantalla.
   */
  perProduct: 5,
  /**
   * Filas en el estado vacío del chat. Tres, el mismo presupuesto que las
   * sugerencias (`SUGGESTION_COUNT`): el bloque de «hoy» comparte sitio con
   * ellas y con los chips de H8, y a 320 px eso ya son tres filas de alto
   * (decisión 3 de docs/PLAN.md §3.4). Lo que no cabe se ve en la pantalla.
   */
  emptyRows: 3,
  /**
   * Lo leído vale un cuarto de hora. Abrir el panel tres veces en la misma
   * mañana no puede costar seis peticiones cada vez, y «qué ha cambiado» no
   * cambia de minuto en minuto. «Actualizar» y cambiar de host la invalidan.
   */
  cacheMs: 15 * 60 * 1000,
  /**
   * Las ventanas de las dos plantillas con días. Son las MISMAS que
   * `DIAS_POR_DEFECTO` de bootstrap.js a propósito, y viven aquí porque allí
   * son el respaldo de cualquiera que no diga nada, mientras que la lectura del
   * Confluence ENLAZADO la hace el panel llamando a `mineCql(days)` derecho, y
   * ahí no hay respaldo en el que caer: sin número no hay consulta.
   */
  daysMine: 7,
  daysProject: 3,
  /**
   * Lo que vale una intención de «Analizar» mientras se navega. Dos minutos son
   * de sobra para que cargue una página y poco para que el usuario se haya ido
   * a otra cosa: pasado eso, la pregunta preparada se tira en vez de aparecer
   * en un sitio donde ya no viene a cuento.
   */
  intentMs: 2 * 60 * 1000,
  /** Lo que ocupa el porqué de una fila, y de cuántos trozos se compone. */
  whyMax: 160,
  whyParts: 3,
  /** Un título de fila; los de la API y los del diario ya vienen así. */
  titleMax: 200,
  /**
   * La vida media de la recencia: a los tres días un cambio vale la mitad. Es
   * la escala del trabajo de un sprint, no la de una notificación.
   */
  halfLifeDays: 3,
  /** Hasta dónde mira `recentPagesFromActivity`, en días. */
  recentDays: 30,
  /** Visitas a partir de las cuales «la sueles mirar» dice algo. */
  frequentMin: 3,
  /** Palabras de título que hay que compartir para que cuente como parecido. */
  sharedWordsMin: 2,
}

/**
 * Lo que suma cada señal, y por qué.
 *
 * La regla de reparto: lo que SÓLO Faro sabe pesa más que lo que sabe
 * cualquiera. «Cambió desde que lo miraste» (40) no lo puede decir ninguna
 * bandeja de Jira, y es literalmente la pregunta que el usuario se hace al
 * abrir el navegador; que algo sea tuyo (15) lo dice Jira en su primera
 * pantalla. La recencia (≤20) está por debajo de las señales personales a
 * propósito: lo más reciente del proyecto no es lo más importante para ti, y si
 * mandara, esto sería otra bandeja de actualizados.
 *
 * Señal nueva: un peso aquí con su comentario, un trozo en `reasonText` y una
 * prueba que ordene dos candidatos (CLAUDE.md §11).
 */
export const SIGNALS = {
  /**
   * Cambió después de la última vez que lo miraste. La señal fuerte, y la única
   * que necesita las dos mitades: la fecha del servidor y la del diario (o, si
   * el diario aún no sabe nada, el `lastViewed` que Jira lleva por su cuenta).
   */
  changedSinceSeen: 40,
  /**
   * Y encima cambió después de que lo ANALIZARAS: lo que dijo Faro de esto ya
   * no describe lo que hay. Suma sobre la anterior, no la sustituye.
   */
  changedSinceAnalyzed: 25,
  /**
   * Una página que usas de base en tus análisis, modificada. Cambia el suelo
   * sobre el que se apoyaron todas las respuestas que se apoyaron en ella.
   */
  sourceChanged: 25,
  /**
   * Es tuya o la sigues. Vale lo que vale: es lo que el propio Jira ya te pone
   * delante, así que ordena, pero no manda.
   */
  mine: 15,
  /** Enlazada con la incidencia que tienes abierta ahora mismo. */
  related: 10,
  /** Del mismo proyecto o del mismo espacio que lo que tienes abierto. */
  sameScope: 8,
  /** Cuelga del mismo padre que la página abierta: una hermana. */
  sibling: 6,
  /** Comparte palabras de título con lo abierto. */
  sharedWords: 6,
  /** Es de la misma familia (API, bug, arquitectura…) que la incidencia abierta. */
  sameFamily: 6,
  /** Y de las familias que más analizas últimamente. */
  preferredFamily: 6,
  /** Cuánto pesa que sea reciente, con la vida media de `TODAY_LIMITS`. */
  recencyMax: 20,
  /** Lo que sueles mirar, por veces vistas. Poco: es un empujón, no un criterio. */
  frequentMax: 6,
  /**
   * Cerrada. Penaliza de verdad: una incidencia terminada no es trabajo de hoy,
   * y sin esto las cerradas de ayer coparían la lista por recientes.
   */
  closed: -20,
  /**
   * Salvo que se cerrara DESPUÉS de tu análisis, que sí es noticia: querrás
   * saber que aquello en lo que pusiste seis observaciones se dio por hecho.
   */
  closedAfterAnalysis: 5,
}

/** Los dos productos, y las clases de entrada de cada uno. */
const PRODUCTS = ['jira', 'confluence']
const KIND_OF = { jira: 'jira-issue', confluence: 'confluence-page' }

/**
 * Los `kind` de lectura, que son los MISMOS nombres que viajan en
 * `MSG.RECENT_ISSUES` y `MSG.RECENT_PAGES` (CLAUDE.md §5) para que lo que
 * `todayTargets` devuelve se pueda mandar tal cual: si aquí se inventara otro
 * vocabulario habría que traducirlo en el panel, y una traducción es un sitio
 * más donde equivocarse. En Jira «lo que miraste» se llama `history`
 * (`issueHistory()`) y en Confluence `viewed` (`recentlyViewedContent()`).
 */
const READ_KINDS = {
  jira: ['history', 'mine', 'project', 'related'],
  confluence: ['viewed', 'mine', 'ids'],
}

const HALF = 0.5
/**
 * Los controles que hay que colapsar: los C0 y los C1, que incluyen el NEL
 * (U+0085) —el `\s` de JavaScript NO lo cubre, y abre línea—. Lo que no se ve y
 * no es texto lo borra antes `sinInvisibles`, que vive en site.js para que la
 * lista no ande repartida. Lo que entra aquí ya viene limpio de los parsers
 * REST y del diario; esto es la red por si un día entra por otro sitio (una
 * caché escrita por una versión anterior, el banco, una prueba).
 */
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')
/** La forma del identificador de una familia; la LISTA la tiene issue-profile.js. */
const FAMILY = /^[a-z][a-z0-9-]{0,19}$/
const ID = /^\d{1,19}$/
/**
 * Lo que mide un host. No se declara aquí un número nuevo: es el mismo de
 * `ACTIVITY_LIMITS.hostMax`, que ya tiene dueño en el diario, y lo que se acota
 * con él es exactamente lo mismo (CLAUDE.md §9: uno por módulo, y lo que ya
 * tenía dueño no se duplica).
 */
const HOST_MAX = ACTIVITY_LIMITS.hostMax

// -------------------------------------------------------------- utilidades

function texto(v) {
  return typeof v === 'string' ? v : ''
}

/** Un número que se puede comparar: finito y no negativo, o 0. */
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Un texto de una línea, sin invisibles y con tope. Pura. */
function limpiar(value, max = TODAY_LIMITS.titleMax) {
  return sinInvisibles(texto(value))
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Hace cuánto, en palabras. Pura.
 *
 * Se mide por TIEMPO TRANSCURRIDO y no por día del calendario —«ayer» es
 * «entre 24 y 48 horas», no «el día natural anterior»— porque un nombre de día
 * o un «ayer» de calendario dependen de la zona horaria de la máquina, y esto
 * tiene que decir lo mismo en una prueba de Node que en el navegador de Marco.
 * Una fecha por delante del reloj (el del sistema saltó) cuenta como ahora.
 */
function relativo(at, now) {
  const t = num(at)
  if (!t) return ''
  const ms = Math.max(0, num(now) - t)
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(ms / (60 * 60 * 1000))
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(ms / DAY_MS)
  if (dias < 2) return 'ayer'
  if (dias <= TODAY_LIMITS.recentDays) return `hace ${dias} días`
  return 'hace más de un mes'
}

/** «6 observaciones», «1 observación». */
function observaciones(n) {
  const x = Math.max(0, Math.floor(num(n)))
  return x === 1 ? '1 observación' : `${x} observaciones`
}

/** El ámbito al que pertenece un candidato: el proyecto de una clave, o el espacio. */
function ambitoDe(cand) {
  if (cand.kind === 'jira-issue') return validProjectKey(String(cand.id).split('-')[0]) || ''
  return isRealSpaceKey(cand.spaceKey) ? cand.spaceKey : ''
}

// ----------------------------------------------------------- a quién preguntar

/**
 * A quién se le pregunta «qué hay de nuevo», y qué se le pregunta. Pura.
 *
 * Dos objetivos como mucho: el producto de la PESTAÑA (por el content script,
 * mismo origen) y, desde un Jira Data Center, el Confluence ENLAZADO (desde el
 * panel, con `credentials: 'include'` y el permiso de host que el usuario ya dio
 * para las páginas base, §4.8). Lo que se queda fuera sale en `skipped` con su
 * motivo escrito, porque una sección que se vacía sin decir por qué es un fallo
 * silencioso (§8.14):
 *
 *  - **Jira Cloud**: `GET /rest/api/2/search` está retirado (410) y el rechazo
 *    vive en un solo sitio (`sinRestDeJira`, §8.19). Ni se intenta.
 *  - **El Jira enlazado desde una pestaña de Confluence**: en v1 no se consulta.
 *    El PASO 0 comprobó la sesión de Confluence desde Jira, no al revés, y
 *    PLAN §3.1 lo deja descartado hasta tener esa comprobación.
 *
 * Los `kinds` de cada objetivo son los nombres que viajan en el mensaje, y se
 * piden sólo si hay con qué: `project` necesita una clave de proyecto válida,
 * `related` la clave de la incidencia abierta e `ids` unos ids que preguntar
 * (los del diario, que da `recentPagesFromActivity`). Un `kind` sin su
 * parámetro sería una consulta que el content script rechaza por «no
 * permitida».
 *
 *  - **Un sitio con «No sugerir nada en este sitio» puesto**: el del enlazado se
 *    comprueba AQUÍ porque el suyo lo mira el panel antes de llamar (el de la
 *    pestaña corta la función entera). Sin esto, apagar las sugerencias en un
 *    Confluence sólo las apagaba al abrir el panel EN ese Confluence: desde el
 *    Jira que lo tiene enlazado se le seguían haciendo lecturas y se seguían
 *    recomendando sus páginas (revisión adversaria de H11).
 *
 * @param {object|null} site el sitio de la pestaña (`parseAtlassianUrl`)
 * @param {object|null} saved el registro guardado del host (`sites[host]`)
 * @param {{linked?: object|null, linkedSaved?: object|null, pageIds?: string[]}} [ctx]
 *        el Confluence enlazado (`state.linkedContext`), SU registro guardado
 *        (`sites[hostEnlazado]`, de donde sale su `todayOff`) y los ids de
 *        página que preguntar
 * @returns {{targets: Array<{host:string, kinds:string[], product:string, site:object|null, via:'tab'|'linked'}>,
 *            skipped: Array<{host:string, product:string, reason:string}>}}
 */
export function todayTargets(site, saved = null, { linked = null, linkedSaved = null, pageIds = [] } = {}) {
  const targets = []
  const skipped = []
  const host = limpiar(site?.host, HOST_MAX).toLowerCase()
  const product = PRODUCTS.includes(site?.product) ? site.product : ''
  if (!host || !product) return { targets, skipped }

  const ids = (Array.isArray(pageIds) ? pageIds : []).filter((x) => ID.test(String(x))).length

  if (product === 'jira' && site.cloud) {
    skipped.push({ host, product: 'jira', reason: 'En Jira Cloud Faro no consulta la API; todo va por el MCP.' })
  } else if (product === 'jira') {
    const kinds = ['history', 'mine']
    if (validProjectKey(site.projectKey)) kinds.push('project')
    if (validIssueKey(site.issueKey)) kinds.push('related')
    targets.push({ host, kinds, product: 'jira', site: null, via: 'tab' })
  } else {
    const kinds = ['viewed', 'mine']
    if (ids) kinds.push('ids')
    targets.push({ host, kinds, product: 'confluence', site: null, via: 'tab' })
  }

  // El enlazado, sólo en la dirección comprobada: Jira Data Center → su
  // Confluence. El host puede venir del contexto cargado o del registro; las
  // dos formas pasan por `linkedSite`, que es quien dice si eso es un sitio.
  if (product === 'jira' && !site.cloud) {
    const apuntado = limpiar(linked?.host || saved?.confluenceHost, HOST_MAX).toLowerCase()
    if (apuntado) {
      const enlazado = linkedSite(linked?.host ? linked : { host: apuntado })
      if (!enlazado || enlazado.host === host) {
        skipped.push({
          host: enlazado ? enlazado.host : '',
          product: 'confluence',
          reason: enlazado
            ? 'El Confluence enlazado es el mismo sitio que el Jira: no hay nada que preguntar dos veces.'
            : 'El Confluence enlazado no se reconoce como un sitio.',
        })
      } else if (linkedSaved?.todayOff === true) {
        // Su propio interruptor, comparado con `true` como el de la pestaña: lo
        // que no sea `true` no lo escribió Faro y no apaga nada.
        skipped.push({
          host: enlazado.host,
          product: 'confluence',
          reason: 'Apagado en ese sitio: abre el panel ahí y quita la casilla para volver a mirar.',
        })
      } else {
        const kinds = ['viewed', 'mine']
        if (ids) kinds.push('ids')
        targets.push({ host: enlazado.host, kinds, product: 'confluence', site: enlazado, via: 'linked' })
      }
    }
  } else if (product === 'confluence' && !site.cloud && limpiar(saved?.jiraHost, HOST_MAX)) {
    skipped.push({
      host: limpiar(saved.jiraHost, HOST_MAX).toLowerCase(),
      product: 'jira',
      reason: 'Desde Confluence todavía no se consulta el Jira enlazado.',
    })
  }

  return { targets, skipped }
}

// -------------------------------------------------------------- candidatos

/**
 * Funde lo que contestaron los sitios con lo que dice el diario, y deja fuera lo
 * que no tiene sentido recomendar. Pura.
 *
 * Cada lectura es `{product, host, kind, items}` con lo que devolvieron
 * `parseSearchIssues` (Jira) o `parseRecentV1` (Confluence). Una misma
 * incidencia puede venir de tres lecturas —la miraste, es tuya y se movió en el
 * proyecto—, y eso no la hace tres candidatas: se funden en una que recuerda de
 * qué lecturas salió (`sources`), que es de donde sale media explicación.
 *
 * Las lecturas se ORDENAN antes de fundirlas (producto, host, kind). Llegan por
 * `Promise.allSettled`, o sea en el orden en que contestó la red, y dos
 * ejecuciones con las mismas respuestas tienen que dar la misma lista hasta en
 * el título que se queda cuando dos lecturas traen uno distinto.
 *
 * Quedan fuera, y no es negociable: lo que el usuario tiene ABIERTO (recomendar
 * la página en la que estás es ruido) y lo que descartó con «×» mientras no
 * haya cambiado desde entonces (`dismissed[clave] >= updatedAt`), que es lo que
 * hace que «ya lo he visto» vuelva solo cuando alguien lo toca.
 *
 * @param {{reads?: Array, activity?: object, here?: object|null, now?: number}} ctx
 *        `activity` es un mapa host → diario: el de la pestaña y el del
 *        enlazado son dos diarios distintos y cada candidato se cruza con el
 *        SUYO (§8.22: lo guardado por host se consume por host).
 * @returns {Array<object>} candidatos con claves blancas, sin ordenar
 */
export function buildCandidates({ reads = [], activity = {}, here = null, now = Date.now() } = {}) {
  const t = num(now) || Date.now()
  const diarios = activity && typeof activity === 'object' ? activity : {}
  const porClave = new Map()

  const ordenadas = (Array.isArray(reads) ? reads : [])
    .filter((r) => r && typeof r === 'object' && PRODUCTS.includes(r.product) && Array.isArray(r.items))
    .filter((r) => READ_KINDS[r.product].includes(r.kind) && limpiar(r.host, HOST_MAX))
    .sort((a, b) => `${a.product}|${a.host}|${a.kind}`.localeCompare(`${b.product}|${b.host}|${b.kind}`))

  for (const read of ordenadas) {
    const host = limpiar(read.host, HOST_MAX).toLowerCase()
    for (const raw of read.items) {
      const fila = read.product === 'jira' ? deJira(raw) : dePagina(raw)
      if (!fila) continue
      const clave = `${host}|${fila.kind}:${fila.id}`
      const previo = porClave.get(clave)
      porClave.set(clave, previo ? fundir(previo, fila, read.kind) : { ...fila, host, product: read.product, sources: [read.kind] })
    }
  }

  const out = []
  for (const cand of porClave.values()) {
    if (esLoAbierto(cand, here)) continue
    const diario = diarios[cand.host] || null
    const clave = activityKey(cand.kind, cand.id)
    const item = clave ? diario?.items?.[clave] || null : null
    const descartadoEn = clave ? Number(diario?.dismissed?.[clave]) : NaN
    // Descartado y sin tocar desde entonces: fuera. En cuanto cambie, vuelve.
    if (Number.isFinite(descartadoEn) && cand.updatedAt <= descartadoEn) continue
    out.push({
      analyzedAt: num(item?.analyzedAt),
      family: cand.family || (FAMILY.test(texto(item?.family)) ? item.family : ''),
      host: cand.host,
      id: cand.id,
      kind: cand.kind,
      lastViewedAt: cand.lastViewedAt,
      notes: Math.floor(num(item?.notes)),
      product: cand.product,
      seenAt: num(item?.seenAt),
      seenCount: Math.floor(num(item?.seenCount)),
      sourceAt: num(item?.sourceAt),
      sources: [...cand.sources].sort(),
      spaceKey: cand.spaceKey,
      statusCategory: cand.statusCategory,
      title: cand.title || limpiar(item?.title),
      type: cand.type,
      // Una fecha por delante del reloj —el del sistema saltó, la respuesta
      // viene de una zona horaria mal puesta— se trae a «ahora»: dejarla
      // pondría esa fila la primera para siempre. Es la regla de `instante` en
      // activity.js, aplicada aquí a lo que llega de la API.
      updatedAt: Math.min(cand.updatedAt, t),
      updatedBy: cand.updatedBy,
    })
  }
  // El orden de salida no lo decide el recorrido del mapa: `rankToday` ordena
  // por puntos, pero una lista estable hace que el desempate sea reproducible
  // aunque dos candidatos empaten en todo.
  return out.sort((a, b) => (a.host + a.kind + a.id).localeCompare(b.host + b.kind + b.id))
}

/** Una incidencia de `parseSearchIssues` en la forma común, o null. */
function deJira(raw) {
  const id = validIssueKey(raw?.key)
  if (!id) return null
  const title = limpiar(raw.summary)
  const type = limpiar(raw.type, 60)
  const labels = Array.isArray(raw.labels) ? raw.labels : []
  return {
    family: issueFamily({ type, labels }, { summary: title }),
    id,
    kind: 'jira-issue',
    lastViewedAt: num(raw.lastViewedAt),
    spaceKey: '',
    statusCategory: limpiar(raw.statusCategory, 20),
    title,
    type,
    updatedAt: num(raw.updatedAt),
    // De Jira no se enseña ninguna persona: mira la cabecera del módulo.
    updatedBy: '',
  }
}

/** Una página de `parseRecentV1` en la forma común, o null. */
function dePagina(raw) {
  const id = String(raw?.id ?? '').trim()
  if (!ID.test(id)) return null
  return {
    family: '',
    id,
    kind: 'confluence-page',
    lastViewedAt: 0,
    spaceKey: isRealSpaceKey(raw.spaceKey) ? limpiar(raw.spaceKey, HOST_MAX) : '',
    statusCategory: '',
    title: limpiar(raw.title),
    type: '',
    updatedAt: num(raw.updatedAt),
    updatedBy: limpiar(raw.updatedBy, CONFLUENCE_REST_LIMITS.updatedByChars),
  }
}

/**
 * Dos filas de la misma cosa en una. Las fechas se quedan con la mayor y los
 * textos con el primero que diga algo: como las lecturas vienen ordenadas, «el
 * primero» es siempre el mismo dos ejecuciones seguidas.
 */
function fundir(previo, fila, kind) {
  return {
    ...previo,
    family: previo.family || fila.family,
    lastViewedAt: Math.max(previo.lastViewedAt, fila.lastViewedAt),
    sources: previo.sources.includes(kind) ? previo.sources : [...previo.sources, kind],
    spaceKey: previo.spaceKey || fila.spaceKey,
    statusCategory: previo.statusCategory || fila.statusCategory,
    title: previo.title || fila.title,
    type: previo.type || fila.type,
    updatedAt: Math.max(previo.updatedAt, fila.updatedAt),
    updatedBy: previo.updatedBy || fila.updatedBy,
  }
}

/**
 * ¿Es esto lo que el usuario tiene abierto? Se compara host + clase + id y no
 * con `samePage`, porque aquí no hay URLs que comparar: un candidato es un
 * identificador, que es exactamente lo que `samePage` mira cuando lo tiene.
 */
function esLoAbierto(cand, here) {
  if (!here || limpiar(here.host, HOST_MAX).toLowerCase() !== cand.host) return false
  if (cand.kind === 'jira-issue') return validIssueKey(here.issueKey) === cand.id
  return String(here.pageId ?? '').trim() === cand.id
}

// --------------------------------------------------------------- puntuar

/**
 * Los puntos de un candidato y qué señales se los dieron. Pura.
 *
 * `hits` es la lista de señales que dispararon, en el orden de `SIGNALS`; es lo
 * que `reasonText` usa para escribir el porqué sin volver a calcular nada y lo
 * que `groupOf` mira para decidir en qué grupo cae la fila.
 *
 * @param {object} cand un candidato de `buildCandidates`
 * @param {{here?: object|null, index?: object|null, preferred?: string[], now?: number}} ctx
 *        `preferred` son las familias que más analizas (`preferredFamilies` del
 *        diario); `index` sirve sólo para saber si dos páginas son hermanas.
 * @returns {{hits: string[], score: number}}
 */
export function scoreCandidate(cand, { here = null, index = null, preferred = [], now = Date.now() } = {}) {
  const hits = []
  if (!cand || typeof cand !== 'object') return { hits, score: 0 }
  const t = num(now) || Date.now()
  let score = 0
  const suma = (id, puntos) => {
    if (!puntos) return
    hits.push(id)
    score += puntos
  }

  const cambio = cand.updatedAt
  // La mitad local manda; el `lastViewed` del servidor es el respaldo para
  // cuando el diario todavía no sabe nada (una instalación nueva).
  const mirado = Math.max(cand.seenAt, cand.lastViewedAt)
  if (cambio && mirado && cambio > mirado) suma('changedSinceSeen', SIGNALS.changedSinceSeen)
  if (cambio && cand.analyzedAt && cambio > cand.analyzedAt) suma('changedSinceAnalyzed', SIGNALS.changedSinceAnalyzed)
  if (cambio && cand.sourceAt && cambio > cand.sourceAt) suma('sourceChanged', SIGNALS.sourceChanged)

  const de = Array.isArray(cand.sources) ? cand.sources : []
  if (de.includes('mine')) suma('mine', SIGNALS.mine)
  if (de.includes('related')) suma('related', SIGNALS.related)

  const ambito = ambitoDe(cand)
  const ambitoAqui = cand.kind === 'jira-issue' ? validProjectKey(here?.projectKey) : isRealSpaceKey(here?.spaceKey) ? here.spaceKey : ''
  if (ambito && ambitoAqui && ambito === ambitoAqui) suma('sameScope', SIGNALS.sameScope)

  if (cand.kind === 'confluence-page' && esHermana(cand, here, index)) suma('sibling', SIGNALS.sibling)
  if (comparteTitulo(cand.title, here?.title)) suma('sharedWords', SIGNALS.sharedWords)

  const familiaAqui = FAMILY.test(texto(here?.family)) ? here.family : ''
  if (cand.family && familiaAqui && cand.family === familiaAqui) suma('sameFamily', SIGNALS.sameFamily)
  if (cand.family && (Array.isArray(preferred) ? preferred : []).includes(cand.family)) {
    suma('preferredFamily', SIGNALS.preferredFamily)
  }

  suma('recency', recencia(cambio, t))
  suma('frequent', frecuencia(cand.seenCount))

  if (cand.statusCategory === 'done') {
    const trasAnalisis = cand.analyzedAt && cambio > cand.analyzedAt
    if (trasAnalisis) suma('closedAfterAnalysis', SIGNALS.closedAfterAnalysis)
    else suma('closed', SIGNALS.closed)
  }

  return { hits, score: Math.round(score) }
}

/** Cuánto vale ser reciente: mitad cada `halfLifeDays`, con tope. */
function recencia(updatedAt, now) {
  if (!updatedAt) return 0
  const dias = Math.max(0, now - updatedAt) / DAY_MS
  return Math.round(SIGNALS.recencyMax * HALF ** (dias / TODAY_LIMITS.halfLifeDays))
}

/** Lo que sueles mirar pesa un poco, y deja de crecer enseguida. */
function frecuencia(seenCount) {
  const n = Math.floor(num(seenCount))
  if (n < 2) return 0
  return Math.min(SIGNALS.frequentMax, Math.round(Math.log2(n) * 2))
}

/** ¿Cuelgan las dos páginas del mismo padre? El índice es quien lo sabe. */
function esHermana(cand, here, index) {
  const aqui = String(here?.pageId ?? '').trim()
  if (!index || !ID.test(aqui) || aqui === cand.id) return false
  const padre = (id) => {
    const cadena = ancestryOf(index, id)
    return cadena.length >= 2 ? String(cadena[cadena.length - 2].id) : ''
  }
  const a = padre(cand.id)
  return !!a && a === padre(aqui)
}

/**
 * ¿Comparten título? Se piden dos palabras y no una: con una, «Guía de
 * despliegue» y «Guía de estilo» serían parientes. Las palabras las pliega
 * `titleWords` (sin acentos, sin mayúsculas, ≥4 letras), que es la misma regla
 * con la que el historial de páginas base compara títulos.
 */
function comparteTitulo(a, b) {
  const uno = titleWords(a)
  if (!uno.length) return false
  const otro = new Set(titleWords(b))
  if (!otro.size) return false
  let n = 0
  for (const w of uno) if (otro.has(w)) n++
  return n >= TODAY_LIMITS.sharedWordsMin
}

// ---------------------------------------------------------------- ordenar

/**
 * La lista que se enseña: puntuada, ordenada, acotada y explicada. Pura.
 *
 * El desempate es TOTAL a propósito —puntos, fecha, título y clave—: si dos
 * candidatos empatan en todo lo que se mira, decide la clave, así que el orden
 * de entrada nunca puede cambiar el de salida. Sin ese último escalón, la lista
 * dependería del orden en que contestó la red.
 *
 * El tope por producto se aplica RECORRIENDO la lista ya ordenada: las cinco
 * mejores de Jira y las cinco mejores de Confluence, hasta ocho. Así un sitio
 * con mucho movimiento en Jira no deja Confluence sin una sola fila.
 *
 * @param {Array} candidates de `buildCandidates`
 * @param {{here?: object|null, index?: object|null, preferred?: string[], now?: number}} ctx
 * @returns {Array<{group:string, host:string, id:string, kind:string, product:string,
 *                  score:number, title:string, updatedAt:number, updatedBy:string, why:string}>}
 */
export function rankToday(candidates, { here = null, index = null, preferred = [], now = Date.now() } = {}) {
  const t = num(now) || Date.now()
  const puntuados = []
  for (const cand of Array.isArray(candidates) ? candidates : []) {
    if (!cand || typeof cand !== 'object' || !cand.id || !cand.kind) continue
    const { hits, score } = scoreCandidate(cand, { here, index, preferred, now: t })
    puntuados.push({ cand, hits, score })
  }

  puntuados.sort(
    (a, b) =>
      b.score - a.score ||
      b.cand.updatedAt - a.cand.updatedAt ||
      String(a.cand.title).localeCompare(String(b.cand.title), 'es') ||
      (a.cand.host + a.cand.kind + a.cand.id).localeCompare(b.cand.host + b.cand.kind + b.cand.id)
  )

  const out = []
  const porProducto = { jira: 0, confluence: 0 }
  for (const { cand, hits, score } of puntuados) {
    if (out.length >= TODAY_LIMITS.maxItems) break
    if (porProducto[cand.product] >= TODAY_LIMITS.perProduct) continue
    porProducto[cand.product]++
    out.push({
      group: groupOf(cand, hits),
      host: cand.host,
      id: cand.id,
      kind: cand.kind,
      product: cand.product,
      score,
      title: cand.title,
      updatedAt: cand.updatedAt,
      updatedBy: cand.updatedBy,
      why: reasonText(cand, { hits, here, now: t }),
    })
  }
  return out
}

/**
 * En qué grupo de la pantalla cae una fila. Pura.
 *
 * Los tres, con el título que pinta el panel (docs/PLAN.md §3.1):
 *  - `cambio` → «Cambió desde que lo miraste»: algo se movió después de que tú
 *    lo miraras, lo analizaras o lo usaras de base. Es el grupo que justifica
 *    la pantalla entera.
 *  - `tuyo` → «Lo tuyo»: es tuya o la sigues, y no ha cambiado desde que la
 *    miraste (si hubiera cambiado, estaría arriba).
 *  - `proyecto` → «Nuevo en <ámbito>»: el resto. Casi todo lo que cae aquí
 *    viene de la lectura del proyecto, que es la única que trae cosas que no
 *    habías visto; lo demás que caiga (una enlazada que no ha cambiado) lleva
 *    su porqué escrito, que es lo que de verdad lee el usuario.
 */
export function groupOf(cand, hits = []) {
  const h = Array.isArray(hits) ? hits : []
  const de = Array.isArray(cand?.sources) ? cand.sources : []
  if (h.includes('changedSinceSeen') || h.includes('changedSinceAnalyzed') || h.includes('sourceChanged')) return 'cambio'
  // Con `hits` se sabe seguro; sin ellos —quien tenga sólo el candidato— vale
  // de qué lectura salió, que es de donde la señal `mine` saca su verdad.
  if (h.includes('mine') || de.includes('mine')) return 'tuyo'
  return 'proyecto'
}

/**
 * Por qué está esta fila aquí, en español. Pura.
 *
 * Se componen hasta `TODAY_LIMITS.whyParts` trozos de una lista de prioridad
 * fija y se juntan con « · », como el resto de los detalles del Registro. El
 * orden de la lista es el orden en que un humano lo contaría: qué ha pasado,
 * qué es esto para ti, y de dónde sale.
 *
 * Dos reglas que no se negocian:
 *  - NUNCA se finge saber QUÉ cambió. La API dice cuándo, no qué, así que aquí
 *    se dice «cambió hace 2 h» y se acabó.
 *  - Nunca se dice «te la asignaron» ni «te mencionan». La plantilla `mineJql`
 *    pregunta por tres cosas a la vez (asignada, informada o seguida) y la
 *    respuesta no dice cuál casó; Faro no sabe quién eres (no pregunta
 *    `myself`, PLAN §3.1) y no puede averiguarlo mirando el asignado. Se dice
 *    lo que se sabe: «es tuya o la sigues».
 */
export function reasonText(cand, { hits = [], here = null, now = Date.now() } = {}) {
  if (!cand || typeof cand !== 'object') return ''
  const t = num(now) || Date.now()
  const h = Array.isArray(hits) ? hits : []
  const de = Array.isArray(cand.sources) ? cand.sources : []
  const pagina = cand.kind === 'confluence-page'
  const partes = []

  // El orden es el de lo que más distingue a esta fila de las otras siete.
  // «Página base» va antes que «cambió» porque es lo que no dice ninguna
  // bandeja; el tipo, el último, porque es lo que ya se ve en la propia fila.
  if (h.includes('closedAfterAnalysis')) partes.push('se cerró tras tu análisis')
  else if (h.includes('closed')) partes.push('cerrada')

  if (h.includes('sourceChanged') || num(cand.sourceAt)) partes.push('página base de tus análisis')

  const cuando = relativo(cand.updatedAt, t)
  if (cuando) partes.push(`cambió ${cuando}`)
  if (cand.updatedBy) partes.push(`modificada por ${limpiar(cand.updatedBy, CONFLUENCE_REST_LIMITS.updatedByChars)}`)

  if (num(cand.analyzedAt)) {
    partes.push(`la analizaste ${relativo(cand.analyzedAt, t)} con ${observaciones(cand.notes)}`)
  }

  // Una sola de las cuatro razones de «qué es esto para ti»: dos seguidas
  // ocuparían los tres trozos sin añadir nada que el usuario no vea ya.
  const clave = validIssueKey(here?.issueKey)
  if (h.includes('mine')) partes.push(pagina ? 'la escribiste o la sigues' : 'es tuya o la sigues')
  else if (h.includes('related') && clave) partes.push(`enlazada con ${clave}`)
  else if (h.includes('sibling')) partes.push('hermana de la página abierta')
  else if (de.includes('project') && ambitoDe(cand)) partes.push(`actividad reciente en ${ambitoDe(cand)}`)

  if (h.includes('frequent') && Math.floor(num(cand.seenCount)) >= TODAY_LIMITS.frequentMin) {
    partes.push(`la sueles mirar (${Math.floor(num(cand.seenCount))} veces)`)
  }
  if (cand.type) partes.push(limpiar(cand.type, 60))

  return limpiar(partes.slice(0, TODAY_LIMITS.whyParts).join(' · '), TODAY_LIMITS.whyMax)
}

// ------------------------------------------------------- el resto del panel

/**
 * La línea del Registro de una lectura de «qué mirar hoy». Pura.
 *
 * Números y motivos, nunca títulos, ids ni URLs: el Registro se mira con el
 * panel abierto delante de otra gente y el diario es del usuario (§8.20). Los
 * `reason` son los códigos de `jira-rest.js`, que ya son palabras sueltas.
 */
export function todaySummary({ items = [], errors = [] } = {}) {
  const filas = Array.isArray(items) ? items : []
  const fallos = (Array.isArray(errors) ? errors : []).filter((e) => e && typeof e === 'object')
  const partes = []
  partes.push(filas.length === 1 ? '1 fila' : `${filas.length} filas`)
  for (const product of PRODUCTS) {
    const n = filas.filter((i) => i?.product === product).length
    if (n) partes.push(`${product === 'jira' ? 'Jira' : 'Confluence'} ${n}`)
  }
  const cambiadas = filas.filter((i) => i?.group === 'cambio').length
  if (cambiadas) partes.push(`${cambiadas} con cambios`)
  for (const e of fallos.slice(0, PRODUCTS.length + 1)) {
    partes.push(`${e.product === 'confluence' ? 'Confluence' : 'Jira'} sin lista: ${limpiar(e.reason, 40) || 'sin motivo'}`)
  }
  return partes.join(' · ')
}

/**
 * Cuántas filas han cambiado desde la última vez que el usuario abrió la lista:
 * el número de la insignia. Pura.
 *
 * Sin fecha guardada (la primera vez) cuentan todas: la insignia tiene que
 * decir que hay algo, no cero.
 */
export function countNew(items, seenAt) {
  const filas = Array.isArray(items) ? items : []
  const desde = num(seenAt)
  if (!desde) return filas.length
  return filas.filter((i) => num(i?.updatedAt) > desde).length
}

/**
 * La pregunta que «Analizar» deja ESCRITA en el cuadro, sin mandarla. Pura.
 *
 * Faro nunca manda una pregunta por su cuenta (§8.20): esto navega hasta la
 * página, fija la Skill Análisis y deja el texto para que el usuario lo lea, lo
 * cambie si quiere y pulse él.
 *
 * QUÉ NO LLEVA, y por qué: ni el título, ni la clave, ni el id, ni el host. En
 * cuanto el usuario pulse enviar, esto es un prompt, y el diario NO entra en un
 * prompt. Tampoco hace falta: «Analizar» acaba de llevarle a esa página, así
 * que «esta incidencia» es exactamente lo que tiene delante. Lo único que se
 * dice es cuándo la analizaste TÚ, que es un acto del usuario, está a la vista
 * en el cuadro y se borra de un tirón antes de mandar.
 */
export function analyzeQuestion(item, activity = null, { now = Date.now() } = {}) {
  const pagina = item?.kind === 'confluence-page'
  const cosa = pagina ? 'esta página' : 'esta incidencia'
  const clave = activityKey(item?.kind, item?.id)
  const previo = clave ? activity?.items?.[clave] : null
  const analizado = num(previo?.analyzedAt)
  if (!analizado) return `Analiza ${cosa} y dime qué le falta.`
  const cuando = relativo(analizado, num(now) || Date.now())
  return `Analiza ${cosa} otra vez: la analizaste ${cuando} y ha cambiado. ¿Qué es distinto y qué sigue faltando?`
}

/**
 * Las páginas de Confluence que el diario conoce, de más a menos interesantes.
 * Pura.
 *
 * Para dos cosas: preguntar por ellas con `idsCql` (¿alguna ha cambiado?) y
 * ofrecerlas bajo el campo vacío de «Páginas base», que es donde el usuario
 * repite la misma búsqueda en cada ticket parecido.
 *
 * El orden: primero las que ANALIZASTE o usaste de base (las tocaste con
 * intención), y después las que sólo has visto. El tope es el del `id in (…)`
 * de Confluence, que es donde acaba esta lista; quien la enseñe recorta a lo
 * suyo.
 */
export function recentPagesFromActivity(
  activity,
  { days = TODAY_LIMITS.recentDays, limit = CONFLUENCE_REST_LIMITS.maxIds, now = Date.now() } = {}
) {
  const t = num(now) || Date.now()
  const dias = Number.isFinite(days) && days > 0 ? days : TODAY_LIMITS.recentDays
  const desde = t - dias * DAY_MS
  const tope = Number.isInteger(limit) && limit > 0 ? limit : CONFLUENCE_REST_LIMITS.maxIds

  const filas = []
  for (const item of Object.values(activity?.items || {})) {
    if (!item || typeof item !== 'object' || item.kind !== 'confluence-page') continue
    const id = String(item.id ?? '').trim()
    if (!ID.test(id)) continue
    const intencion = Math.max(num(item.analyzedAt), num(item.sourceAt))
    const cuando = Math.max(intencion, num(item.seenAt))
    if (cuando < desde) continue
    filas.push({ cuando, id, intencion, title: limpiar(item.title), path: texto(item.path) })
  }

  filas.sort((a, b) => (b.intencion ? 1 : 0) - (a.intencion ? 1 : 0) || b.cuando - a.cuando || a.id.localeCompare(b.id))
  return filas.slice(0, tope).map(({ id, title, path }) => ({ id, path, title }))
}
