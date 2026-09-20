/**
 * Sugerir páginas base y explicar por qué (src/panel/source-suggest.js).
 *
 * EL CAMBIO: la pantalla de páginas base se abría vacía. Ahora se juntan cuatro
 * fuentes que Faro ya tiene delante —enlaces de la página, historial, contexto
 * e índice—, se puntúan y se ordenan, sin llamar al modelo ni gastar un token
 * (docs/PLAN.md §3.2).
 *
 * Lo que más se vigila aquí:
 *  - el UMBRAL: una señal débil sola no llega a la pantalla (un título del
 *    índice suma 21 como mucho, un componente compartido sin familia 15, un
 *    análisis anterior de la misma familia sin nada más en común, nada);
 *  - la BARRERA de §8.12: un `/display/ESPACIO/Título` sin id se resuelve sólo
 *    contra el índice o por el `pageId` de un enlace remoto, y lo que no se
 *    resuelva no se sugiere. Ningún título del DOM sale como consulta;
 *  - que todo enlace pase por `pageRefFromUrl`: otro host, `/browse/`,
 *    `javascript:`, `data:`, `#` y lo que no parsea se caen ahí;
 *  - y el orden determinista, porque de esto sale una lista que el usuario ve.
 */
import { test, eq, assert } from '../harness.js'
import {
  LINK_WHERE,
  REFERENCE_TITLE,
  SUGGEST_LIMITS,
  SUGGEST_SCORE,
  confluenceLinksIn,
  reasonText,
  suggestSources,
} from '../../src/panel/source-suggest.js'
import { DAY_MS, emptyHistory, historyEntry, recordAnalysis } from '../../src/panel/source-history.js'
import { referencesFromContext } from '../../src/panel/references.js'
import { normalizeIndex } from '../../src/atlassian/index-store.js'

const JIRA = 'jira.simplprogramme.eu'
const CONF = 'confluence.simplprogramme.eu'
const SITIO = { host: JIRA, origin: `https://${JIRA}`, product: 'jira', cloud: false }
const AHORA = Date.UTC(2026, 8, 20, 10, 0, 0)

const GUIA = '456789'
const RUNBOOK = '456790'
const ADR = '456791'
const SPRINT = '456792'

const INDICE = normalizeIndex(
  {
    pages: [
      { id: GUIA, title: 'Guía de API del programa', spaceKey: 'ENG', url: '/pages/456789' },
      { id: RUNBOOK, title: 'Runbook de guardia', spaceKey: 'ENG', url: '/pages/456790' },
      { id: ADR, title: 'ADR-014 Rotación de tokens de servicio', spaceKey: 'ENG', url: '/pages/456791' },
      { id: SPRINT, title: 'Sprint 37', spaceKey: 'ENG', url: '/pages/456792' },
    ],
  },
  CONF,
  { kind: 'space', key: 'ENG' }
)

const ISSUE = { type: 'API Definition', status: 'In Review', components: ['Auth'], labels: ['api'] }
const SIN_ETIQUETAS = { type: 'API Definition', status: 'In Review', components: [], labels: [] }

/** Un análisis anterior de Jira, tal como lo apunta el panel. */
function uso(clave, ms, ids = [GUIA], issue = ISSUE, extra = {}) {
  return historyEntry({
    sources: { mode: 'open', pages: ids.map((id) => ({ id, title: INDICE.pages[id]?.title || '', spaceKey: 'ENG' })) },
    issue,
    summary: '[API Definition] - Consent API v2',
    issueKey: clave,
    projectKey: 'SIMPL',
    product: 'jira',
    now: ms,
    ...extra,
  })
}

function historial(...entradas) {
  let h = emptyHistory()
  for (const e of entradas) h = recordAnalysis(h, e, { host: JIRA, now: AHORA })
  return h
}

/** El contexto de arriba, con lo que hace falta para puntuar. */
function sugerir(extra = {}) {
  return suggestSources({
    index: INDICE,
    issue: ISSUE,
    summary: '[API Definition] - Consent API v3 de socios',
    projectKey: 'SIMPL',
    issueKey: 'SIMPL-99',
    product: 'jira',
    linked: true,
    now: AHORA,
    ...extra,
  })
}

const ids = (lista) => lista.map((s) => s.id)

// ---- los enlaces de la página -----------------------------------------------

test('SEGURIDAD: de los enlaces de la página sólo pasan los de Confluence, y por pageRefFromUrl', () => {
  const fuera = [
    { href: `https://${JIRA}/browse/ENG-8`, text: 'ENG-8', where: 'comentario' },
    { href: 'https://evil.example/pages/456789/Guia', text: 'otra', where: 'descripcion' },
    { href: `https://${CONF}.evil.example/pages/456789/x`, text: 'parecido', where: 'descripcion' },
    { href: 'javascript:alert(1)', text: 'js', where: 'descripcion' },
    { href: 'data:text/html,<b>x</b>', text: 'data', where: 'descripcion' },
    { href: '#', text: 'ancla', where: 'descripcion' },
    { href: '', text: 'vacío', where: 'descripcion' },
    { href: 'no es una url', text: 'x', where: 'descripcion' },
    { href: `//${CONF}/pages/456789/Guia`, text: 'protocolo relativo', where: 'descripcion' },
    { href: '456789', text: 'un número no es una URL', where: 'descripcion' },
  ]
  eq(confluenceLinksIn(fuera, null, { site: SITIO, linkedHost: CONF, index: INDICE }), [], 'ninguno es una página base')
  // `http://` del MISMO Confluence sí: de la URL sólo se saca el id (nadie pide
  // nada a esa dirección; la página la lee el modelo por su id, §8.3), y es lo
  // que `pageRefFromUrl` acepta desde siempre con una URL pegada a mano.
  eq(ids(confluenceLinksIn([{ href: `http://${CONF}/pages/456789/Guia`, where: 'descripcion' }], null, { site: SITIO, linkedHost: CONF, index: INDICE })), [GUIA])
})

test('un enlace con id se resuelve solo, en sus dos formas, y con el título del índice', () => {
  const dentro = [
    { href: `https://${CONF}/pages/viewpage.action?pageId=${ADR}`, text: 'esta decisión', where: 'descripcion' },
    { href: `https://${CONF}/spaces/ENG/pages/${RUNBOOK}/Runbook`, text: '', where: 'comentario' },
  ]
  const r = confluenceLinksIn(dentro, null, { site: SITIO, linkedHost: CONF, index: INDICE })
  eq(ids(r), [ADR, RUNBOOK])
  eq(Object.keys(r[0]).sort(), ['id', 'path', 'spaceKey', 'title', 'where'])
  eq(r[0].title, 'ADR-014 Rotación de tokens de servicio', 'el índice sabe cómo se llama de verdad')
  eq(r[0].where, 'descripcion')
  eq(r[0].spaceKey, 'ENG')
  eq(r[1].where, 'comentario')
  // Sin índice, el texto del enlace; y sin texto, el id.
  const sinIndice = confluenceLinksIn(dentro, null, { site: SITIO, linkedHost: CONF, index: null })
  eq(sinIndice[0].title, 'esta decisión')
  eq(sinIndice[1].title, `Página ${RUNBOOK}`)
})

test('el host del Confluence enlazado vale desde Jira, sin distinguir mayúsculas', () => {
  const r = confluenceLinksIn([{ href: `https://${CONF.toUpperCase()}/pages/viewpage.action?pageId=${GUIA}`, where: 'enlaces' }], null, {
    site: SITIO,
    linkedHost: CONF,
    index: INDICE,
  })
  eq(ids(r), [GUIA])
  // Y sin enlace guardado, ese mismo host es «otro sitio».
  eq(confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=${GUIA}`, where: 'enlaces' }], null, { site: SITIO, index: INDICE }), [])
})

test('un /display/ sin id se resuelve por el índice —título plegado y espacio—, nunca por la API', () => {
  const display = [{ href: `https://${CONF}/display/ENG/Runbook+de+guardia`, text: 'el runbook', where: 'enlaces' }]
  eq(ids(confluenceLinksIn(display, null, { site: SITIO, linkedHost: CONF, index: INDICE })), [RUNBOOK])
  eq(confluenceLinksIn(display, null, { site: SITIO, linkedHost: CONF, index: null }), [], 'sin índice, no se sugiere: preguntar por título está prohibido')
  // El espacio tiene que casar: la misma página en OPS no es ésta.
  eq(confluenceLinksIn([{ href: `https://${CONF}/display/OPS/Runbook+de+guardia`, where: 'enlaces' }], null, { site: SITIO, linkedHost: CONF, index: INDICE }), [])
  // Y el título, con acentos y con «%»: se decodifica con decodeSlug.
  const acentos = normalizeIndex({ pages: [{ id: GUIA, title: 'Rotación', spaceKey: 'ENG', url: '/x' }] }, CONF, null)
  eq(ids(confluenceLinksIn([{ href: `https://${CONF}/display/ENG/Rotaci%C3%B3n`, where: 'enlaces' }], null, { site: SITIO, linkedHost: CONF, index: acentos })), [GUIA])
  eq(confluenceLinksIn([{ href: `https://${CONF}/display/ENG/No+existe`, where: 'enlaces' }], null, { site: SITIO, linkedHost: CONF, index: INDICE }), [])
  // SEGURIDAD: sólo se intenta resolver lo que YA pasó la barrera de host. Un
  // `/display/` de otro sitio con el mismo título no puede convertirse en
  // nuestra página: si no, una página ajena elegiría qué se sugiere.
  eq(confluenceLinksIn([{ href: 'https://evil.example/display/ENG/Runbook+de+guardia', where: 'descripcion' }], null, { site: SITIO, linkedHost: CONF, index: INDICE }), [])
})

test('el pageId de un enlace remoto manda, y su título vale si el índice no lo conoce', () => {
  const remote = { ok: true, links: [{ pageId: '999999', title: 'Página remota de Confluence', url: `https://${CONF}/x` }] }
  const r = confluenceLinksIn([{ href: `https://${CONF}/display/ENG/No+existe`, where: 'comentario' }], remote, {
    site: SITIO,
    linkedHost: CONF,
    index: INDICE,
  })
  eq(ids(r), ['999999'], 'el remoto trae el id sin depender del DOM')
  eq(r[0].title, 'Página remota de Confluence')
  eq(r[0].where, 'remoto')
  // Un remoto que falló, o sin id, no aporta nada.
  eq(confluenceLinksIn([], { ok: false, status: 401 }, { site: SITIO, index: INDICE }), [])
  eq(confluenceLinksIn([], { ok: true, links: [{ title: 'sin id' }, { pageId: 'abc' }] }, { site: SITIO, index: INDICE }), [])
})

test('la misma página enlazada dos veces sale una, con su mejor procedencia', () => {
  const dobles = [
    { href: `https://${CONF}/pages/viewpage.action?pageId=${GUIA}`, where: 'comentario' },
    { href: `https://${CONF}/pages/viewpage.action?pageId=${GUIA}`, where: 'descripcion' },
  ]
  const r = confluenceLinksIn(dobles, { ok: true, links: [{ pageId: GUIA }] }, { site: SITIO, linkedHost: CONF, index: INDICE })
  eq(r.length, 1)
  eq(r[0].where, 'remoto', 'el orden de LINK_WHERE decide, no el orden en que llegan')
  eq(LINK_WHERE[0], 'remoto')
  assert(LINK_WHERE.indexOf('descripcion') < LINK_WHERE.indexOf('comentario'))
})

test('se miran como mucho sesenta enlaces', () => {
  const muchos = Array.from({ length: SUGGEST_LIMITS.linksMax + 20 }, (_, i) => ({
    href: `https://${CONF}/pages/viewpage.action?pageId=${500000 + i}`,
    where: 'pagina',
  }))
  eq(confluenceLinksIn(muchos, null, { site: SITIO, linkedHost: CONF, index: INDICE }).length, SUGGEST_LIMITS.linksMax)
  eq(confluenceLinksIn(null, null, { site: SITIO }), [], 'y sin enlaces no lanza')
})

// ---- la puntuación ----------------------------------------------------------

test('un enlace desde la descripción gana a un análisis anterior', () => {
  const enlaces = confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=${ADR}`, where: 'descripcion' }], null, {
    site: SITIO,
    linkedHost: CONF,
    index: INDICE,
  })
  const r = sugerir({ links: enlaces, history: historial(uso('SIMPL-1', AHORA - 1000), uso('SIMPL-2', AHORA - 900)) })
  eq(ids(r), [ADR, GUIA])
  eq(r[0].score, SUGGEST_SCORE.descripcion)
  eq(r[0].reasons[0], { kind: 'descripcion', text: 'enlazada desde la descripción' })
})

test('usada en ESTA incidencia suma más que cualquier otra cosa del historial', () => {
  const h = historial(uso('SIMPL-99', AHORA - 1000, [RUNBOOK]))
  const r = sugerir({ history: h })
  eq(ids(r), [RUNBOOK])
  eq(r[0].score, SUGGEST_SCORE.usadaAqui)
  eq(reasonText(r[0].reasons), 'la usaste en esta incidencia')
  // En Confluence se habla de la página, y la identidad es su id.
  const enConfluence = suggestSources({
    index: INDICE,
    history: historial(historyEntry({ sources: { pages: [{ id: RUNBOOK }] }, pageId: '111111', spaceKey: 'ENG', product: 'confluence', now: AHORA - 10 })),
    pageId: '111111',
    spaceKey: 'ENG',
    product: 'confluence',
    now: AHORA,
  })
  eq(reasonText(enConfluence[0].reasons), 'la usaste en esta página')
})

test('el historial aporta UN motivo: la misma familia y el mismo proyecto piden dos análisis', () => {
  const uno = sugerir({ history: historial(uso('SIMPL-1', AHORA - 1000)), issue: SIN_ETIQUETAS })
  eq(uno, [], 'con un solo análisis y nada más en común no se sugiere nada')
  const dos = sugerir({ history: historial(uso('SIMPL-1', AHORA - 1000), uso('SIMPL-2', AHORA - 900)), issue: SIN_ETIQUETAS })
  eq(ids(dos), [GUIA])
  eq(dos[0].score, SUGGEST_SCORE.familiaAmbito)
  eq(reasonText(dos[0].reasons), 'la usaste en 2 análisis de API en SIMPL')
  // Y cada análisis de más suma, hasta el tope.
  const cinco = sugerir({
    history: historial(...[1, 2, 3, 4, 5].map((i) => uso(`SIMPL-${i}`, AHORA - i * 100))),
    issue: SIN_ETIQUETAS,
  })
  eq(cinco[0].score, SUGGEST_SCORE.familiaAmbito + 3 * SUGGEST_SCORE.familiaAmbitoExtra)
  eq(reasonText(cinco[0].reasons), 'la usaste en 5 análisis de API en SIMPL')
  const seis = sugerir({ history: historial(...[1, 2, 3, 4, 5, 6].map((i) => uso(`SIMPL-${i}`, AHORA - i * 100))), issue: SIN_ETIQUETAS })
  eq(seis[0].score, SUGGEST_SCORE.familiaAmbito + SUGGEST_LIMITS.familyExtraMax * SUGGEST_SCORE.familiaAmbitoExtra, 'con tope')
})

test('un componente compartido basta con un solo análisis de la misma familia', () => {
  const r = sugerir({ history: historial(uso('SIMPL-1', AHORA - 1000)) })
  eq(ids(r), [GUIA])
  eq(r[0].score, SUGGEST_SCORE.familiaEtiqueta)
  eq(reasonText(r[0].reasons), 'la usaste en 1 análisis de API con «auth»', 'el número, en singular')
})

test('un componente compartido SIN la misma familia no llega al umbral', () => {
  const otraFamilia = { type: 'Bug', status: 'Open', components: ['Auth'], labels: [] }
  const h = historial(uso('SIMPL-1', AHORA - 1000, [GUIA], otraFamilia))
  eq(SUGGEST_SCORE.etiqueta < SUGGEST_LIMITS.minScore, true)
  eq(sugerir({ history: h }), [], '15 puntos no son 25')
})

test('sólo el mismo proyecto pide tres análisis, y aun así no llega solo', () => {
  // Los análisis anteriores no son de ninguna familia reconocible: ni el tipo ni
  // el título los delatan (el prefijo «[API Definition]» del título de arriba sí
  // lo haría, que es justo lo que mira `issueFamily`).
  const sinFamilia = { type: 'Cosa rara', status: 'Open', components: [], labels: [] }
  const h = historial(...[1, 2, 3].map((i) => uso(`SIMPL-${i}`, AHORA - i * 100, [GUIA], sinFamilia, { summary: 'Cosa cualquiera' })))
  eq(h.entries.every((e) => e.family === ''), true)
  eq(SUGGEST_SCORE.ambito < SUGGEST_LIMITS.minScore, true)
  eq(sugerir({ history: h, issue: SIN_ETIQUETAS }), [], '10 puntos tampoco son 25')
})

test('lo que se usó hace más de sesenta días vale la mitad', () => {
  const viejo = historial(
    uso('SIMPL-1', AHORA - (SUGGEST_LIMITS.decayDays + 1) * DAY_MS),
    uso('SIMPL-2', AHORA - (SUGGEST_LIMITS.decayDays + 2) * DAY_MS)
  )
  eq(sugerir({ history: viejo, issue: SIN_ETIQUETAS }), [], '30 pasan a 15 y se quedan por debajo del umbral')
  // El mismo historial, mirado cuando todavía era reciente, sí sugiere.
  const reciente = suggestSources({
    index: INDICE,
    history: viejo,
    issue: SIN_ETIQUETAS,
    summary: 'x',
    projectKey: 'SIMPL',
    product: 'jira',
    now: AHORA - (SUGGEST_LIMITS.decayDays + 1) * DAY_MS,
  })
  eq(reciente[0].score, SUGGEST_SCORE.familiaAmbito)
})

test('una referencia del contexto llega justo al umbral, y suma si su papel casa con la familia', () => {
  const refs = referencesFromContext(
    ['## Dónde vive cada cosa', `- «Guía de API del programa» (id ${GUIA})`, `- «Runbook de guardia» (id ${RUNBOOK})`].join('\n'),
    { index: INDICE }
  )
  const r = sugerir({ references: refs, issue: SIN_ETIQUETAS, summary: 'x' })
  eq(ids(r), [GUIA, RUNBOOK])
  eq(r[0].score, SUGGEST_SCORE.referencia + SUGGEST_SCORE.referenciaFamilia, 'una guía es lo que un ticket de API tiene que contrastar')
  eq(reasonText(r[0].reasons), 'el contexto la nombra como guía')
  eq(r[1].score, SUGGEST_SCORE.referencia, 'un proceso no casa con la familia api, pero 25 ya es el umbral')
  eq(reasonText(r[1].reasons), 'el contexto la nombra como proceso')
  // Y si la referencia declara la familia, también suma (lo hará una lista estructurada).
  const declarada = sugerir({ references: { items: { [RUNBOOK]: { id: RUNBOOK, title: 'Runbook de guardia', role: 'proceso', forWhat: '', families: ['api'] } } }, issue: SIN_ETIQUETAS, summary: 'x' })
  eq(declarada[0].score, SUGGEST_SCORE.referencia + SUGGEST_SCORE.referenciaFamilia)
})

test('un título del índice con forma de referencia refuerza, pero NUNCA sale solo', () => {
  // La página 456791 se llama «ADR-014 Rotación de tokens de servicio»: con un
  // título de incidencia que comparta dos palabras, el índice suma.
  const conDos = sugerir({
    references: { items: { [ADR]: { id: ADR, title: 'ADR-014', role: 'adr', forWhat: '', families: [] } } },
    summary: 'Rotación de tokens en el proveedor',
    issue: SIN_ETIQUETAS,
  })
  eq(conDos[0].score, SUGGEST_SCORE.referencia + SUGGEST_SCORE.tituloIndice)
  eq(conDos[0].reasons.map((x) => x.kind), ['referencia', 'indice'])
  // Con una sola palabra compartida, el índice no aporta.
  const conUna = sugerir({
    references: { items: { [ADR]: { id: ADR, title: 'ADR-014', role: 'adr', forWhat: '', families: [] } } },
    summary: 'Rotación del certificado',
    issue: SIN_ETIQUETAS,
  })
  eq(conUna[0].score, SUGGEST_SCORE.referencia)
  eq(conUna[0].reasons.map((x) => x.kind), ['referencia'])
  // Y el índice por su cuenta no crea candidatas: 21 nunca llegan a 25.
  eq(sugerir({ summary: 'Rotación de tokens de servicio', issue: SIN_ETIQUETAS }), [])
  assert(SUGGEST_LIMITS.titleScoreMax < SUGGEST_LIMITS.minScore, 'el tope del título del índice está por debajo del umbral a propósito')
})

test('REFERENCE_TITLE reconoce una página de referencia y no una reunión', () => {
  for (const si of ['Guía de API', 'API Guidelines', 'Plantilla de ADR', 'ADR-014', 'Glosario', 'Definition of Ready', 'Runbook de guardia', 'Convenciones de nombres', 'Arquitectura de referencia'])
    assert(REFERENCE_TITLE.test(si), si)
  for (const no of ['Sprint 37', 'Reunión de equipo', 'Notas del viernes', 'Cuadro de mando', 'Madrid'])
    assert(!REFERENCE_TITLE.test(no), no)
  assert(!REFERENCE_TITLE.global, 'sin bandera global: test() con estado daría resultados alternos')
})

// ---- exclusiones, orden y forma ---------------------------------------------

test('la página abierta y las ya elegidas no se sugieren', () => {
  const h = historial(uso('SIMPL-99', AHORA - 10, [GUIA, RUNBOOK]))
  eq(ids(sugerir({ history: h })), [GUIA, RUNBOOK])
  eq(ids(sugerir({ history: h, exclude: [GUIA] })), [RUNBOOK], 'una página base ya elegida no se vuelve a proponer')
  eq(ids(sugerir({ history: h, exclude: [GUIA, RUNBOOK] })), [])
  const enConfluence = suggestSources({ index: INDICE, history: h, pageId: RUNBOOK, spaceKey: 'ENG', product: 'confluence', now: AHORA, issueKey: 'SIMPL-99' })
  eq(ids(enConfluence), [GUIA], 'ni la página que se está analizando')
})

test('una página de la que sólo se sabe el id sólo se sugiere si viene enlazada', () => {
  const h = historial(uso('SIMPL-1', AHORA - 200, ['777777']), uso('SIMPL-2', AHORA - 100, ['777777']))
  eq(sugerir({ history: h, issue: SIN_ETIQUETAS }), [], '«Página 777777» no le dice nada a nadie en una lista')
  const enlazada = confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=777777`, where: 'descripcion' }], null, {
    site: SITIO,
    linkedHost: CONF,
    index: INDICE,
  })
  const r = sugerir({ history: h, links: enlazada, issue: SIN_ETIQUETAS })
  eq(ids(r), ['777777'])
  eq(r[0].title, 'Página 777777', 'venir enlazada es motivo suficiente de por sí')
})

test('la forma de una sugerencia: claves EXACTAS y, desde un Jira DC, sin ruta', () => {
  const h = historial(uso('SIMPL-99', AHORA - 10, [GUIA]))
  const r = sugerir({ history: h })
  eq(Object.keys(r[0]).sort(), ['id', 'path', 'reasons', 'score', 'source', 'spaceKey', 'title'])
  eq(r[0].source, 'suggested')
  eq(r[0].spaceKey, 'ENG')
  eq(r[0].path, '', 'el índice es el del Confluence ENLAZADO: su ruta no es de este sitio')
  for (const motivo of r[0].reasons) eq(Object.keys(motivo).sort(), ['kind', 'text'])
  // En Confluence (o en Jira Cloud) el índice sí es el de la pestaña.
  const enConfluence = historial(
    historyEntry({
      sources: { pages: [{ id: GUIA, title: 'Guía de API del programa', spaceKey: 'ENG' }] },
      pageId: '222222',
      spaceKey: 'ENG',
      product: 'confluence',
      now: AHORA - 10,
    })
  )
  const propio = suggestSources({ index: INDICE, history: enConfluence, pageId: '222222', spaceKey: 'ENG', product: 'confluence', now: AHORA })
  eq(propio[0].path, '/pages/456789')
})

test('el orden es determinista: puntos, luego título, luego id', () => {
  const enlaces = confluenceLinksIn(
    [
      { href: `https://${CONF}/pages/viewpage.action?pageId=${RUNBOOK}`, where: 'enlaces' },
      { href: `https://${CONF}/pages/viewpage.action?pageId=${ADR}`, where: 'enlaces' },
      { href: `https://${CONF}/pages/viewpage.action?pageId=${SPRINT}`, where: 'enlaces' },
    ],
    null,
    { site: SITIO, linkedHost: CONF, index: INDICE }
  )
  const r = sugerir({ links: enlaces, issue: SIN_ETIQUETAS, summary: 'x' })
  eq(ids(r), [ADR, RUNBOOK, SPRINT], 'a igualdad de puntos, por título en español')
  for (const s of r) eq(s.score, SUGGEST_SCORE.enlaces)
  // Dos ejecuciones dan exactamente lo mismo.
  eq(JSON.stringify(sugerir({ links: enlaces, issue: SIN_ETIQUETAS, summary: 'x' })), JSON.stringify(r))
})

test('cinco sugerencias como mucho', () => {
  const muchos = confluenceLinksIn(
    Array.from({ length: 9 }, (_, i) => ({ href: `https://${CONF}/pages/viewpage.action?pageId=${600000 + i}`, text: `Página base ${i}`, where: 'descripcion' })),
    null,
    { site: SITIO, linkedHost: CONF, index: INDICE }
  )
  eq(sugerir({ links: muchos, issue: SIN_ETIQUETAS, summary: 'x' }).length, SUGGEST_LIMITS.max)
  eq(sugerir({ links: muchos, issue: SIN_ETIQUETAS, summary: 'x', max: 2 }).length, 2)
})

test('sin ninguna fuente no se sugiere nada, y nada de esto lanza con basura', () => {
  eq(suggestSources(), [])
  eq(suggestSources({}), [])
  eq(sugerir(), [])
  for (const malo of [null, 'abc', 7, [], { pages: 'x' }]) {
    eq(sugerir({ index: malo, history: malo, references: malo, links: malo, issue: malo }), [], JSON.stringify(malo) ?? String(malo))
  }
})

test('reasonText junta como mucho dos motivos, con « · » y acotado', () => {
  const tres = [
    { kind: 'descripcion', text: 'enlazada desde la descripción' },
    { kind: 'historial', text: 'la usaste en 3 análisis de API en SIMPL' },
    { kind: 'referencia', text: 'el contexto la nombra como guía' },
  ]
  eq(reasonText(tres), 'enlazada desde la descripción · la usaste en 3 análisis de API en SIMPL')
  eq(SUGGEST_LIMITS.reasonsMax, 2)
  eq(reasonText(tres, { max: 1 }), 'enlazada desde la descripción')
  eq(reasonText([]), '')
  eq(reasonText(null), '')
  eq(reasonText([{ text: 'x' }, { text: 'x' }]), 'x', 'sin repetir')
  eq(reasonText([{ text: 'A'.repeat(200) }]).length, SUGGEST_LIMITS.reasonMax)
  eq(reasonText([{ text: 'con\nsalto' }]), 'con salto', 'los motivos los escribe la extensión, pero entran limpios igual')
})

test('cada procedencia de un enlace tiene su motivo escrito', () => {
  const texto = (where) => {
    const enlaces = confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=${ADR}`, where }], null, {
      site: SITIO,
      linkedHost: CONF,
      index: INDICE,
    })
    return reasonText(sugerir({ links: enlaces, issue: SIN_ETIQUETAS, summary: 'x' })[0].reasons)
  }
  eq(texto('descripcion'), 'enlazada desde la descripción')
  eq(texto('enlaces'), 'desde los enlaces de la incidencia')
  eq(texto('comentario'), 'desde un comentario')
  eq(texto('pagina'), 'enlazada desde esta página')
  const remoto = confluenceLinksIn([], { ok: true, links: [{ pageId: ADR }] }, { site: SITIO, linkedHost: CONF, index: INDICE })
  eq(reasonText(sugerir({ links: remoto, issue: SIN_ETIQUETAS, summary: 'x' })[0].reasons), 'enlazada en Jira a esta incidencia')
  // Un `where` que no existe cuenta como «de la página», que es lo genérico.
  const raro = confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=${ADR}`, where: 'inventado' }], null, { site: SITIO, linkedHost: CONF, index: INDICE })
  eq(raro[0].where, 'pagina')
})

test('los motivos se enseñan en orden: de dónde viene, luego el historial, luego el contexto', () => {
  const enlaces = confluenceLinksIn([{ href: `https://${CONF}/pages/viewpage.action?pageId=${GUIA}`, where: 'descripcion' }], null, {
    site: SITIO,
    linkedHost: CONF,
    index: INDICE,
  })
  const refs = referencesFromContext(`## Guías\n- «Guía de API del programa» (id ${GUIA})`, { index: INDICE })
  const r = sugerir({ links: enlaces, references: refs, history: historial(uso('SIMPL-1', AHORA - 100), uso('SIMPL-2', AHORA - 90)) })
  eq(r[0].reasons.map((x) => x.kind), ['descripcion', 'historial', 'referencia'])
  eq(reasonText(r[0].reasons), 'enlazada desde la descripción · la usaste en 2 análisis de API en SIMPL')
  eq(r[0].score, SUGGEST_SCORE.descripcion + SUGGEST_SCORE.familiaAmbito + SUGGEST_SCORE.referencia + SUGGEST_SCORE.referenciaFamilia)
})
