/**
 * El diario local de actividad: qué abriste, qué analizaste y qué usaste como
 * página base en este sitio.
 *
 * Por qué existe: para decir «esto cambió desde que lo miraste» hace falta saber
 * CUÁNDO lo miraste tú, y eso no lo sabe nadie más. El servidor sabe cuándo
 * cambió una página; `issueHistory()` y `recentlyViewedContent()` dan una lista
 * sin fecha; y lo que sólo Faro sabe —qué analizaste, con cuántas observaciones,
 * qué páginas usas de base— no está en ninguna API (docs/PLAN.md §3.1). Eso es
 * este fichero: un diario por host de la ENTIDAD con ids, claves, títulos y
 * rutas relativas, y nada más.
 *
 * Lo que NO se guarda, y por qué (CLAUDE.md §8.20): ni la URL completa, ni los
 * parámetros de la consulta, ni el fragmento, ni una línea de texto de la
 * página. Un `?focusedCommentId=…` o un token de sesión pegado en la query no
 * tienen por qué vivir treinta días en el disco de nadie, y la ruta relativa ya
 * dice todo lo que hace falta para reconocer de dónde salió la entrada. Para
 * NAVEGAR no se usa: la URL se reconstruye contra el origen de la pestaña y
 * pasa por `validatePlan` como todo lo demás (§8.3).
 *
 * Y nunca entra en un prompt: de aquí salen puntos, un motivo escrito por la
 * extensión y una fecha relativa. Las 36 instantáneas de prompts no cambian ni
 * un byte por nada de lo que haya aquí dentro.
 *
 * Vive en `src/atlassian/` y no en `src/panel/` porque lo importan el panel Y el
 * service worker, que es quien apunta las visitas con el panel cerrado: nada de
 * `src/panel/` entra en el worker. Por eso tampoco se valida la `family` contra
 * `ISSUE_FAMILIES` (que vive en `src/panel/issue-profile.js`, donde se decide
 * para el prompt): aquí sólo se comprueba su FORMA, y quien la escribe es el
 * panel, que ya la ha decidido con esa lista.
 *
 * Todo es puro y el reloj se inyecta: la caducidad tiene que dar lo mismo hoy
 * que dentro de un año en una prueba. Quien toca `chrome.storage` es
 * `src/shared/activity-store.js`.
 */

import { cleanTabTitle, parseAtlassianUrl, sinInvisibles, validIssueKey } from './site.js'

/** La versión de lo guardado. Un diario de otra versión se tira: se rellena solo. */
export const ACTIVITY_VERSION = 1

/** Las dos cosas que se apuntan. Una entrada de cualquier otra clase no existe. */
export const ACTIVITY_KINDS = ['jira-issue', 'confluence-page']

export const ACTIVITY_LIMITS = {
  /**
   * Entradas por host. Trescientas son un mes largo de trabajo intenso; más no
   * mejora ninguna recomendación y sí engorda una clave que se lee entera al
   * arrancar el panel.
   */
  maxEntries: 300,
  /** Y su caducidad: lo que miraste hace más de un mes ya no dice qué toca hoy. */
  maxAgeDays: 30,
  /**
   * Dos avisos de la misma entrada dentro de este rato son la misma visita.
   * Llegan dos por navegación a propósito (el service worker por
   * `tabs.onUpdated` y el content script por `CONTENT_READY`/`URL_CHANGED`), y
   * además Confluence reescribe su propia URL al cargar: sin esto, abrir una
   * página una vez contaría tres. La ventana se mide desde la ÚLTIMA visita, no
   * desde la primera: tener algo abierto recargándose cada medio minuto es
   * seguir mirando lo mismo, no visitarlo cien veces.
   */
  dedupeMs: 60000,
  /** Un título es el de la pestaña o el resumen de una incidencia: cabe de sobra. */
  titleMax: 200,
  /** Una ruta relativa, sin consulta ni fragmento. */
  pathMax: 300,
  /** Descartes recordados. Es una lista de «ya lo he visto», no un archivo. */
  dismissedMax: 100,
  /** Tope de los contadores: un número mayor no lo escribió Faro. */
  countMax: 9999,
  /** Observaciones de un análisis (`NOTE_LIMITS.max` son 12; aquí sobra margen). */
  notesMax: 99,
  /** Lo que mide el identificador de una familia («architecture» son 12). */
  familyMax: 20,
  /** El host va dentro del objeto además de en la clave, para poder mirarlo. */
  hostMax: 255,
}

const DAY_MS = 24 * 60 * 60 * 1000
const ID = /^\d{1,19}$/
/**
 * La forma del identificador de una familia de incidencia («api», «bug»,
 * «architecture»). La LISTA está en `src/panel/issue-profile.js` y no se puede
 * importar desde aquí (§3: nada del panel entra en el service worker); quien
 * escribe este campo es el panel, que ya la ha elegido de esa lista.
 */
const FAMILY = /^[a-z][a-z0-9-]{0,19}$/

/**
 * Los controles que hay que colapsar en un espacio: los C0 y los C1, que
 * incluyen el NEL (U+0085) —el `\s` de JavaScript NO lo cubre, y abre línea—.
 * Lo que no se ve y no es texto (el RLO que deja leer un título al revés, el
 * espacio de ancho cero, el BOM) lo BORRA antes `sinInvisibles`, que vive en
 * site.js para que la lista de caracteres prohibidos no ande repartida.
 */
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

function texto(v) {
  return typeof v === 'string' ? v : ''
}

/** Un título en una línea, sin invisibles y con tope. Pura. */
function limpiarTitulo(value, max = ACTIVITY_LIMITS.titleMax) {
  return sinInvisibles(texto(value))
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Un instante guardado: número finito, no negativo y nunca en el futuro.
 *
 * Una fecha por delante del reloj (el del sistema saltó, alguien editó el
 * almacén) se trae a «ahora»: dejarla pondría esa entrada la primera para
 * siempre y no caducaría nunca. Es la misma regla que `source-history.js`.
 */
function instante(value, now) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  const tope = Number.isFinite(now) ? now : Date.now()
  return Math.round(Math.min(n, tope))
}

/** Un contador: entero, no negativo y acotado. */
function contador(value, max = ACTIVITY_LIMITS.countMax) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), max)
}

/** El diario vacío de un host. */
export function emptyActivity(host = '') {
  return {
    version: ACTIVITY_VERSION,
    host: limpiarTitulo(host, ACTIVITY_LIMITS.hostMax),
    items: {},
    dismissed: {},
  }
}

/**
 * La clave de una entrada: `jira-issue:ENG-7`, `confluence-page:98830281`. '' si
 * la clase o el identificador no valen. Pura.
 *
 * El identificador se RECONSTRUYE con las validadoras (una clave de incidencia
 * en mayúsculas, un id que son sólo cifras), así que dos formas de escribir lo
 * mismo dan la misma clave y nada raro llega a ser una entrada.
 */
export function activityKey(kind, id) {
  if (kind === 'jira-issue') {
    const clave = validIssueKey(id)
    return clave ? 'jira-issue:' + clave : ''
  }
  if (kind === 'confluence-page') {
    const num = String(id ?? '').trim()
    return ID.test(num) ? 'confluence-page:' + num : ''
  }
  return ''
}

/** De la clave a sus dos piezas, o null. Pura. */
function partesDeClave(key) {
  const k = texto(key)
  const corte = k.indexOf(':')
  if (corte < 0) return null
  const kind = k.slice(0, corte)
  const id = k.slice(corte + 1)
  return activityKey(kind, id) === k ? { kind, id } : null
}

/** Cuándo se tocó una entrada por última vez, sea por lo que sea. Pura. */
function ultimoToque(item) {
  return Math.max(item.seenAt || 0, item.analyzedAt || 0, item.sourceAt || 0)
}

// ------------------------------------------------------------- forma canónica

/**
 * Una entrada reconstruida con claves blancas, o null.
 *
 * La CLAVE manda sobre lo que diga el objeto: `kind` e `id` se reescriben desde
 * ella, así que una entrada que dijera ser otra cosa de la que la indexa no
 * puede existir, y buscar por clave siempre encuentra lo que promete.
 */
function normalizeItem(key, raw, now) {
  const partes = partesDeClave(key)
  if (!partes || !raw || typeof raw !== 'object') return null
  return {
    analyzedAt: instante(raw.analyzedAt, now),
    analyzedCount: contador(raw.analyzedCount),
    family: FAMILY.test(texto(raw.family)) ? raw.family : '',
    id: partes.id,
    kind: partes.kind,
    notes: contador(raw.notes, ACTIVITY_LIMITS.notesMax),
    path: rutaRelativa(raw.path),
    seenAt: instante(raw.seenAt, now),
    seenCount: contador(raw.seenCount),
    sourceAt: instante(raw.sourceAt, now),
    title: limpiarTitulo(raw.title),
  }
}

/**
 * Una ruta que ya está guardada, revalidada: relativa, de una sola línea, sin
 * consulta ni fragmento y con tope. Lo que no lo sea se cae a ''. Pura.
 *
 * Una `//otro-host/x` es un salto de origen encubierto y una absoluta es
 * justo lo que este módulo promete no guardar.
 */
function rutaRelativa(value) {
  const p = limpiarTitulo(value, ACTIVITY_LIMITS.pathMax)
  if (!p.startsWith('/') || p.startsWith('//')) return ''
  return p.split('?')[0].split('#')[0]
}

/**
 * Lo guardado (o lo que sea) en la forma canónica: entradas con claves blancas,
 * ids validados, títulos de una línea, y los topes puestos. Pura.
 *
 * NO caduca por antigüedad: eso lo hace `pruneActivity`, que es donde el reloj
 * decide algo. Leer no puede tirar nada por su cuenta.
 *
 * Un `version` distinto se tira entero, como el perfil del proyecto: el diario
 * se rellena solo con el uso. Un objeto SIN `version` se acepta, para que quien
 * construya uno a mano (una prueba, el banco) no tenga que saberse el número.
 *
 * Los topes conservan lo más RECIENTE: si hay que tirar entradas, las que
 * sobran son las que hace más que no se tocan. `dismissed` se recorta por el
 * final de la lista —el orden de inserción de las claves de un objeto, que es
 * lo que `dismissItem` respeta reinsertando—, porque su valor es la fecha de la
 * COSA descartada y no la del descarte: ordenar por él haría volver lo que
 * acabas de quitar sólo porque lleve tiempo sin cambiar.
 */
export function normalizeActivity(raw, { host = '', now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const out = emptyActivity(host || (raw && typeof raw === 'object' ? raw.host : ''))
  if (!raw || typeof raw !== 'object') return out
  if (raw.version !== undefined && raw.version !== ACTIVITY_VERSION) return out

  const entradas = []
  for (const [key, value] of Object.entries(raw.items && typeof raw.items === 'object' ? raw.items : {})) {
    const item = normalizeItem(key, value, t)
    if (item) entradas.push([key, item])
  }
  entradas.sort((a, b) => ultimoToque(b[1]) - ultimoToque(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [key, item] of entradas.slice(0, ACTIVITY_LIMITS.maxEntries)) out.items[key] = item

  const descartes = []
  for (const [key, value] of Object.entries(raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {})) {
    if (!partesDeClave(key)) continue
    const at = Number(value)
    if (!Number.isFinite(at) || at < 0) continue
    descartes.push([key, Math.round(at)])
  }
  for (const [key, at] of descartes.slice(-ACTIVITY_LIMITS.dismissedMax)) out.dismissed[key] = at

  return out
}

/**
 * El diario sin lo caducado. Pura.
 *
 * La antigüedad de una entrada es la del ÚLTIMO toque, sea una visita, un
 * análisis o un uso como página base: una guía que se usa cada semana no
 * caduca porque la abrieras por primera vez hace dos meses.
 */
export function pruneActivity(activity, { host = '', now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const base = normalizeActivity(activity, { host, now: t })
  const limite = t - ACTIVITY_LIMITS.maxAgeDays * DAY_MS
  const out = emptyActivity(base.host)
  for (const [key, item] of Object.entries(base.items)) {
    if (ultimoToque(item) >= limite) out.items[key] = item
  }
  out.dismissed = { ...base.dismissed }
  return out
}

// ----------------------------------------------------------------- apuntar

/**
 * La visita que describe una URL, o null si esa URL no señala nada que se pueda
 * apuntar. Pura.
 *
 * Sólo cuentan una incidencia de Jira y una página de Confluence: un tablero,
 * un panel de control o la portada de un espacio no son algo a lo que volver.
 * De la URL salen SÓLO la clase, el identificador y la ruta relativa; el resto
 * —consulta y fragmento incluidos— se queda fuera.
 *
 * `pageId` es el de `<meta name="ajs-page-id">`, que el content script lee del
 * DOM: en un Confluence Data Center una página es `/display/ESPACIO/Título` y
 * la URL no lleva el id por ninguna parte, así que sin esa lectura no habría
 * nada que apuntar. Sólo se mira en Confluence: en una incidencia de Jira la
 * clave está en la URL y cualquier otra cosa sería inventarla.
 */
export function visitFromUrl(url, { title = '', pageId = '', at = Date.now() } = {}) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const site = parseAtlassianUrl(u.href)
  if (!site) return null

  let kind = ''
  let id = ''
  if (site.product === 'jira' && site.issueKey) {
    kind = 'jira-issue'
    id = site.issueKey
  } else if (site.product === 'confluence') {
    // El de la URL manda sobre el del DOM: los dos son de la misma pestaña, y
    // el de la URL ya lo ha validado `parseAtlassianUrl`.
    const num = texto(site.pageId) || String(pageId ?? '').trim()
    if (ID.test(num)) {
      kind = 'confluence-page'
      id = num
    }
  }
  if (!activityKey(kind, id)) return null

  return {
    at: instante(at, at),
    id,
    kind,
    // La ruta, sin `?` ni `#`: es lo que se ve, no por dónde se navega.
    path: rutaRelativa(u.pathname),
    title: limpiarTitulo(cleanTabTitle(title, site)),
  }
}

/**
 * Apunta una visita: la entrada nueva se funde con la que hubiera. No muta lo
 * que recibe. Pura.
 *
 * Dentro de `dedupeMs` NO se suma otra visita —las dos fuentes y las
 * reescrituras de URL de Confluence son la misma—, pero el título y la ruta sí
 * se refrescan: `chrome.tabs.onUpdated` llega cuando la navegación se confirma,
 * y ahí el título de la pestaña todavía suele ser el de antes; el
 * `CONTENT_READY` que viene detrás trae el bueno.
 *
 * Y nunca toca `analyzedAt`, `notes`, `family` ni `sourceAt`: de lo VISTO hay un
 * solo escritor (el service worker) y de lo analizado otro (el panel), así que
 * dos escrituras que se crucen no pueden pisarse los campos del otro.
 */
export function recordVisit(activity, visit, { host = '', now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const base = normalizeActivity(activity, { host, now: t })
  const key = activityKey(visit?.kind, visit?.id)
  if (!key) return base

  const at = instante(visit.at ?? t, t)
  const previo = base.items[key] || null
  const repetida = !!previo && at - previo.seenAt < ACTIVITY_LIMITS.dedupeMs
  const titulo = limpiarTitulo(visit.title)
  const ruta = rutaRelativa(visit.path)

  const item = {
    ...(previo || vacioDeClave(key)),
    seenAt: Math.max(previo?.seenAt || 0, at),
    seenCount: repetida ? previo.seenCount : contador((previo?.seenCount || 0) + 1),
    title: titulo || previo?.title || '',
    path: ruta || previo?.path || '',
  }
  return normalizeActivity({ ...base, items: { ...base.items, [key]: item } }, { host: base.host, now: t })
}

/** Una entrada recién nacida, con todo a cero salvo lo que la identifica. */
function vacioDeClave(key) {
  const { kind, id } = partesDeClave(key)
  return {
    analyzedAt: 0,
    analyzedCount: 0,
    family: '',
    id,
    kind,
    notes: 0,
    path: '',
    seenAt: 0,
    seenCount: 0,
    sourceAt: 0,
    title: '',
  }
}

/**
 * Apunta lo que sólo el panel sabe: que analizaste algo (con cuántas
 * observaciones y de qué familia) o que lo usaste como página base. No muta lo
 * que recibe. Pura.
 *
 * Nunca toca `seenAt` ni `seenCount`: el único escritor de «visto» es el service
 * worker (docs/PLAN.md §3.1). Si la entrada no existía, nace con la visita a
 * cero: analizar algo a lo que llegaste por un enlace del chat no es haberlo
 * mirado, y lo mirado ya lo apuntará quien corresponda.
 */
export function touchActivity(activity, evento, { host = '', now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const base = normalizeActivity(activity, { host, now: t })
  const key = activityKey(evento?.kind, evento?.id)
  if (!key || (evento.event !== 'analyzed' && evento.event !== 'source')) return base

  const at = instante(evento.at ?? t, t)
  const previo = base.items[key] || vacioDeClave(key)
  const titulo = limpiarTitulo(evento.title)
  const item = { ...previo, title: titulo || previo.title, path: rutaRelativa(evento.path) || previo.path }

  if (evento.event === 'analyzed') {
    item.analyzedAt = Math.max(previo.analyzedAt, at)
    item.analyzedCount = contador(previo.analyzedCount + 1)
    // Las observaciones y la familia son las del análisis que acaba de terminar:
    // sustituyen a las de antes, que ya no describen lo que hay ahora.
    item.notes = contador(evento.notes, ACTIVITY_LIMITS.notesMax)
    if (FAMILY.test(texto(evento.family))) item.family = evento.family
  } else {
    item.sourceAt = Math.max(previo.sourceAt, at)
  }

  return normalizeActivity({ ...base, items: { ...base.items, [key]: item } }, { host: base.host, now: t })
}

/**
 * «Ya lo he visto»: la entrada deja de recomendarse hasta que cambie. No muta lo
 * que recibe. Pura.
 *
 * Se guarda CUÁNDO estaba cambiada la cosa cuando se descartó, no cuándo se
 * descartó: así vuelve sola en cuanto alguien la toca otra vez, que es lo que
 * el usuario espera de «ya lo he visto». Sin esa fecha se usa la de ahora, que
 * es lo más cerca que se puede estar de la verdad.
 */
export function dismissItem(activity, key, updatedAt, { host = '', now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const base = normalizeActivity(activity, { host, now: t })
  const clave = typeof key === 'string' ? key : activityKey(key?.kind, key?.id)
  if (!partesDeClave(clave)) return base

  const bruto = Number(updatedAt)
  const at = Number.isFinite(bruto) && bruto >= 0 ? Math.round(bruto) : t
  // Se reinserta al final a propósito: el orden de las claves es lo que decide
  // qué descartes se conservan cuando hay que recortar.
  const dismissed = { ...base.dismissed }
  delete dismissed[clave]
  dismissed[clave] = at
  return normalizeActivity({ ...base, dismissed }, { host: base.host, now: t })
}

// ---------------------------------------------------------------- consultas

/**
 * Cuándo miraste esto por última vez, o 0. Es la mitad de «cambió desde que lo
 * viste»: la otra mitad la pone el servidor. Pura.
 */
export function lastSeen(activity, kind, id) {
  const key = activityKey(kind, id)
  if (!key) return 0
  const item = activity?.items?.[key]
  return Number.isFinite(item?.seenAt) ? item.seenAt : 0
}

/**
 * Las familias de incidencia que más analizas últimamente, de más a menos. Pura.
 *
 * Sirve para subir un poco lo que se parece a tu trabajo: quien lleva un mes
 * revisando definiciones de API agradece ver antes otra definición de API. Con
 * empate manda el orden alfabético, para que dos ejecuciones den lo mismo.
 */
export function preferredFamilies(activity, { days = ACTIVITY_LIMITS.maxAgeDays, now = Date.now() } = {}) {
  const t = Number.isFinite(now) ? now : Date.now()
  const dias = Number.isFinite(days) && days > 0 ? days : ACTIVITY_LIMITS.maxAgeDays
  const desde = t - dias * DAY_MS
  const cuenta = new Map()
  for (const item of Object.values(activity?.items || {})) {
    if (!item || typeof item !== 'object') continue
    if (!FAMILY.test(texto(item.family))) continue
    if (!Number.isFinite(item.analyzedAt) || item.analyzedAt < desde) continue
    cuenta.set(item.family, (cuenta.get(item.family) || 0) + Math.max(1, contador(item.analyzedCount)))
  }
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([family]) => family)
}
