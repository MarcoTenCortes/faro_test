/**
 * «Qué mirar hoy»: el ranking sin modelo (src/panel/today.js).
 *
 * EL CAMBIO: al abrir Jira por la mañana, Faro no decía por dónde empezar.
 * Ahora junta lo que el sitio sabe de ti (por REST, con plantillas fijas) con
 * lo que sólo Faro sabe (el diario local: qué miraste, qué analizaste y con
 * cuántas observaciones, qué usas de página base), lo puntúa y lo explica en
 * español, sin llamar al modelo ni gastar un token (docs/PLAN.md §3.1).
 *
 * Lo que más se vigila aquí:
 *  - el ORDEN de las señales del plan: «cambió tras tu análisis» por delante de
 *    «página base modificada», de «es tuya» y de «se movió en el proyecto»;
 *  - que sea DETERMINISTA: las lecturas llegan por `Promise.allSettled`, o sea
 *    en el orden en que conteste la red, y las mismas respuestas en otro orden
 *    tienen que dar la misma lista hasta en el desempate;
 *  - que lo ABIERTO y lo DESCARTADO no salgan, y que lo descartado vuelva solo
 *    en cuanto alguien lo toque;
 *  - las CLAVES BLANCAS de un candidato y de una fila, porque de aquí sale algo
 *    que el panel pinta y que la caché de `storage.session` guarda;
 *  - y que nada de esto se acerque a un prompt: `analyzeQuestion` deja una
 *    pregunta en el cuadro SIN mandarla, y no lleva ni el título, ni la clave,
 *    ni el id, ni el host (§8.20).
 */
import { test, eq, assert } from '../harness.js'
import {
  SIGNALS,
  TODAY_LIMITS,
  analyzeQuestion,
  buildCandidates,
  countNew,
  groupOf,
  rankToday,
  reasonText,
  recentPagesFromActivity,
  scoreCandidate,
  todaySummary,
  todayTargets,
} from '../../src/panel/today.js'
import { normalizeActivity } from '../../src/atlassian/activity.js'
import { normalizeIndex } from '../../src/atlassian/index-store.js'

const JIRA = 'jira.simplprogramme.eu'
const CONF = 'confluence.simplprogramme.eu'
const AHORA = Date.UTC(2026, 8, 20, 10, 0, 0)
const H = 60 * 60 * 1000
const D = 24 * H
/**
 * Los separadores que abren línea y NO se pueden escribir crudos en un fuente
 * (nadie los vería al revisar el diff): el NEL, que además el `\s` de
 * JavaScript no cubre, y los dos separadores de línea y de párrafo.
 */
const NEL = String.fromCharCode(0x85)
const ABRE_LINEA = new RegExp('[\\n\\r' + NEL + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']')

const SITIO_JIRA = {
  host: JIRA,
  origin: `https://${JIRA}`,
  product: 'jira',
  cloud: false,
  issueKey: 'ENG-7',
  projectKey: 'ENG',
}
const SITIO_CONF = { host: CONF, origin: `https://${CONF}`, product: 'confluence', cloud: false, spaceKey: 'ENG' }
/** Lo que el usuario tiene abierto: la incidencia ENG-7 de API. */
const AQUI = { ...SITIO_JIRA, title: 'Rotación de tokens de servicio', family: 'api' }

/** Una incidencia tal como la deja `parseSearchIssues`. */
function incidencia(key, extra = {}) {
  return {
    key,
    summary: `Incidencia ${key}`,
    type: 'Task',
    status: 'Open',
    statusCategory: 'new',
    priority: 'Medium',
    assignee: null,
    reporter: null,
    updatedAt: AHORA - 6 * H,
    lastViewedAt: 0,
    labels: [],
    components: [],
    epicKey: '',
    parentKey: '',
    ...extra,
  }
}

/** Una página tal como la deja `parseRecentV1`. */
function pagina(id, extra = {}) {
  return {
    id,
    title: `Página ${id}`,
    spaceKey: 'ENG',
    url: `/pages/${id}`,
    updatedAt: AHORA - 6 * H,
    updatedBy: '',
    version: 3,
    ...extra,
  }
}

/** Una lectura REST ya hecha, con el `kind` que viaja en el mensaje. */
function lectura(product, host, kind, items) {
  return { product, host, kind, items }
}

/** Un diario por host, pasado por su propia normalizadora. */
function diario(host, items = {}, dismissed = {}) {
  return normalizeActivity({ items, dismissed }, { host, now: AHORA })
}

function entrada(kind, id, extra = {}) {
  return {
    kind,
    id,
    title: `Apuntada ${id}`,
    path: '',
    seenAt: 0,
    seenCount: 0,
    analyzedAt: 0,
    analyzedCount: 0,
    notes: 0,
    family: '',
    sourceAt: 0,
    ...extra,
  }
}

// ---------------------------------------------------------- a quién preguntar

test('todayTargets: desde un Jira Data Center se pregunta a la pestaña y al Confluence enlazado', () => {
  const r = todayTargets(SITIO_JIRA, { confluenceHost: CONF }, { linked: { host: CONF, wikiPrefix: '' }, pageIds: ['3003'] })
  eq(r.skipped, [], 'con los dos sitios en pie no se queda nada fuera')
  eq(r.targets.length, 2, 'la pestaña y el enlazado')
  eq(Object.keys(r.targets[0]).sort(), ['host', 'kinds', 'product', 'site', 'via'], 'claves exactas de un objetivo')

  const tab = r.targets[0]
  eq(tab.via, 'tab')
  eq(tab.product, 'jira')
  eq(tab.host, JIRA)
  eq(tab.site, null, 'la pestaña sabe su propio origen: el panel no se lo manda')
  // `project` y `related` sólo se piden si hay con qué: sin clave válida, el
  // content script las rechazaría por «consulta no permitida».
  eq(tab.kinds, ['history', 'mine', 'project', 'related'], 'con proyecto e incidencia abiertos, las cuatro')

  const linked = r.targets[1]
  eq(linked.via, 'linked')
  eq(linked.product, 'confluence')
  eq(linked.host, CONF)
  eq(linked.site, { host: CONF, origin: `https://${CONF}`, wikiPrefix: '', cloud: false }, 'el sitio que pide el panel')
  eq(linked.kinds, ['viewed', 'mine', 'ids'], 'con ids del diario, también las páginas concretas')

  const sinIds = todayTargets(SITIO_JIRA, { confluenceHost: CONF }, { linked: { host: CONF } })
  eq(sinIds.targets[1].kinds, ['viewed', 'mine'], 'sin ids que preguntar no se pide `ids`')

  const sinContexto = todayTargets(SITIO_JIRA, { confluenceHost: CONF }, {})
  eq(sinContexto.targets[1].host, CONF, 'el host enlazado vale igual desde el registro guardado')

  const suelto = todayTargets({ ...SITIO_JIRA, issueKey: '', projectKey: '' }, null, {})
  eq(suelto.targets.length, 1, 'sin enlace, sólo la pestaña')
  eq(suelto.targets[0].kinds, ['history', 'mine'], 'sin clave abierta no hay `project` ni `related`')
})

test('todayTargets: en Jira Cloud no se pregunta a la API de Jira, y se dice por qué', () => {
  const cloud = { host: 'acme.atlassian.net', origin: 'https://acme.atlassian.net', product: 'jira', cloud: true, projectKey: 'ENG' }
  const r = todayTargets(cloud, { confluenceHost: 'acme.atlassian.net' }, {})
  eq(r.targets, [], 'en Cloud, ni una petición a Jira')
  eq(r.skipped.length, 1)
  eq(Object.keys(r.skipped[0]).sort(), ['host', 'product', 'reason'], 'claves exactas de lo que se queda fuera')
  eq(r.skipped[0].product, 'jira')
  assert(/Cloud/.test(r.skipped[0].reason), 'el motivo nombra Cloud: ' + r.skipped[0].reason)
  assert(/MCP/.test(r.skipped[0].reason), 'y dice por dónde va entonces')

  // Y el enlazado tampoco: en Cloud los dos productos comparten host, así que
  // «el Confluence enlazado» no es otro sitio.
  eq(
    r.targets.filter((x) => x.product === 'confluence'),
    []
  )

  const conf = todayTargets({ host: 'acme.atlassian.net', product: 'confluence', cloud: true }, null, {})
  eq(conf.targets.length, 1, 'un Confluence Cloud sí se pregunta: su API no está retirada')
  eq(conf.targets[0].product, 'confluence')
  eq(conf.skipped, [])
})

test('todayTargets: desde Confluence se pregunta a la pestaña; el Jira enlazado queda para después', () => {
  const r = todayTargets(SITIO_CONF, { jiraHost: JIRA }, { pageIds: ['3003'] })
  eq(r.targets.length, 1, 'sólo la pestaña')
  eq(r.targets[0].product, 'confluence')
  eq(r.targets[0].via, 'tab')
  eq(r.targets[0].kinds, ['viewed', 'mine', 'ids'])
  eq(r.skipped.length, 1, 'y se dice que el Jira enlazado no se consulta todavía')
  eq(r.skipped[0].product, 'jira')
  eq(r.skipped[0].host, JIRA)
  assert(/todavía/.test(r.skipped[0].reason), 'el motivo dice que es un límite de la versión: ' + r.skipped[0].reason)

  eq(todayTargets(SITIO_CONF, null, {}).skipped, [], 'sin Jira enlazado no hay nada que explicar')
})

test('todayTargets SEGURIDAD: un host enlazado que no es un host no es un objetivo', () => {
  for (const malo of ['confluence.corp.com/x', 'https://confluence.corp.com', 'confluence.corp.com:8443', 'a b', '', '   ']) {
    const r = todayTargets(SITIO_JIRA, { confluenceHost: malo }, {})
    eq(
      r.targets.filter((x) => x.via === 'linked'),
      [],
      'no sale objetivo enlazado con ' + JSON.stringify(malo)
    )
    if (malo.trim()) assert(r.skipped.some((s) => s.product === 'confluence'), 'y se dice, con ' + JSON.stringify(malo))
  }
  eq(todayTargets(null, null, {}), { targets: [], skipped: [] }, 'sin sitio no se pregunta a nadie')
  eq(todayTargets({ host: JIRA, product: 'correo' }, null, {}), { targets: [], skipped: [] }, 'un producto que no existe tampoco')
})

// ------------------------------------------------------------- candidatos

test('buildCandidates: funde las lecturas y cruza cada una con el diario de SU host', () => {
  const reads = [
    lectura('jira', JIRA, 'history', [incidencia('ENG-12', { updatedAt: AHORA - 2 * H })]),
    lectura('jira', JIRA, 'mine', [incidencia('ENG-12', { updatedAt: AHORA - 2 * H }), incidencia('ENG-20')]),
    lectura('confluence', CONF, 'viewed', [pagina('3003', { updatedBy: 'Marta' })]),
  ]
  const activity = {
    [JIRA]: diario(JIRA, {
      'jira-issue:ENG-12': entrada('jira-issue', 'ENG-12', { seenAt: AHORA - 5 * D, seenCount: 4, analyzedAt: AHORA - 4 * D, notes: 6, family: 'api' }),
    }),
    [CONF]: diario(CONF, { 'confluence-page:3003': entrada('confluence-page', '3003', { sourceAt: AHORA - 6 * D }) }),
  }
  const cands = buildCandidates({ reads, activity, here: AQUI, now: AHORA })
  eq(cands.length, 3, 'la incidencia repetida en dos lecturas es UN candidato')

  const eng12 = cands.find((c) => c.id === 'ENG-12')
  eq(
    Object.keys(eng12).sort(),
    [
      'analyzedAt',
      'family',
      'host',
      'id',
      'kind',
      'lastViewedAt',
      'notes',
      'product',
      'seenAt',
      'seenCount',
      'sourceAt',
      'sources',
      'spaceKey',
      'statusCategory',
      'title',
      'type',
      'updatedAt',
      'updatedBy',
    ],
    'claves exactas de un candidato'
  )
  eq(eng12.sources, ['history', 'mine'], 'recuerda de qué lecturas salió, ordenadas')
  eq(eng12.analyzedAt, AHORA - 4 * D, 'y lo que el diario de SU host sabe de ella')
  eq(eng12.notes, 6)
  eq(eng12.seenCount, 4)

  const guia = cands.find((c) => c.id === '3003')
  eq(guia.product, 'confluence')
  eq(guia.host, CONF, 'la página se cruza con el diario del host enlazado, no con el de Jira')
  eq(guia.sourceAt, AHORA - 6 * D)
  eq(guia.updatedBy, 'Marta')
  eq(guia.analyzedAt, 0, 'y no se contagia de lo que el otro diario dice de otra cosa')
})

test('buildCandidates SEGURIDAD: lo que tienes abierto no se recomienda', () => {
  const reads = [lectura('jira', JIRA, 'history', [incidencia('ENG-7'), incidencia('ENG-70')])]
  const cands = buildCandidates({ reads, activity: {}, here: AQUI, now: AHORA })
  eq(cands.map((c) => c.id), ['ENG-70'], 'la abierta fuera; la que empieza igual, dentro')

  const pages = [lectura('confluence', CONF, 'viewed', [pagina('200'), pagina('2000')])]
  const aqui = { host: CONF, product: 'confluence', pageId: '200' }
  eq(
    buildCandidates({ reads: pages, activity: {}, here: aqui, now: AHORA }).map((c) => c.id),
    ['2000'],
    'lo mismo con una página: 200 no es 2000'
  )
  // El mismo id en OTRO host es otra cosa.
  const otro = buildCandidates({ reads: pages, activity: {}, here: { ...aqui, host: 'otro.example' }, now: AHORA })
  eq(otro.length, 2, 'la exclusión es por host + clase + id')
})

test('buildCandidates: lo descartado con «×» no sale, y vuelve en cuanto cambia', () => {
  const cambio = AHORA - 2 * H
  const reads = [lectura('jira', JIRA, 'history', [incidencia('ENG-12', { updatedAt: cambio })])]
  // Se descartó con la fecha que la cosa tenía entonces.
  const descartadaAhora = { [JIRA]: diario(JIRA, {}, { 'jira-issue:ENG-12': cambio }) }
  eq(buildCandidates({ reads, activity: descartadaAhora, here: AQUI, now: AHORA }), [], 'descartada y sin tocar desde entonces')

  const descartadaAntes = { [JIRA]: diario(JIRA, {}, { 'jira-issue:ENG-12': cambio - 1 }) }
  eq(
    buildCandidates({ reads, activity: descartadaAntes, here: AQUI, now: AHORA }).map((c) => c.id),
    ['ENG-12'],
    'si ha cambiado después del descarte, vuelve sola'
  )
  const deOtro = { [CONF]: diario(CONF, {}, { 'jira-issue:ENG-12': cambio }) }
  eq(buildCandidates({ reads, activity: deOtro, here: AQUI, now: AHORA }).length, 1, 'el descarte es del host que lo guardó')
})

test('buildCandidates: el orden en que conteste la red no cambia el resultado', () => {
  const reads = [
    lectura('jira', JIRA, 'history', [incidencia('ENG-12', { summary: 'De la primera lectura' })]),
    lectura('jira', JIRA, 'mine', [incidencia('ENG-12', { summary: 'De la segunda lectura' }), incidencia('ENG-20')]),
    lectura('jira', JIRA, 'project', [incidencia('ENG-12', { summary: 'De la tercera' })]),
    lectura('confluence', CONF, 'viewed', [pagina('3003')]),
  ]
  const uno = buildCandidates({ reads, activity: {}, here: AQUI, now: AHORA })
  const otro = buildCandidates({ reads: [...reads].reverse(), activity: {}, here: AQUI, now: AHORA })
  eq(otro, uno, 'las mismas lecturas en otro orden dan exactamente lo mismo')
  eq(uno.find((c) => c.id === 'ENG-12').sources, ['history', 'mine', 'project'])

  const barajado = [reads[2], reads[0], reads[3], reads[1]]
  eq(buildCandidates({ reads: barajado, activity: {}, here: AQUI, now: AHORA }), uno, 'y en cualquier otro')
})

test('buildCandidates SEGURIDAD: basura de la API o del diario no lanza ni se cuela', () => {
  const reads = [
    lectura('jira', JIRA, 'history', [
      incidencia('ENG-12', { updatedAt: NaN, lastViewedAt: Infinity }),
      incidencia('eng-13', { updatedAt: '2026-09-20' }),
      { key: 'no es una clave' },
      { key: 'ENG-14', summary: `Con salto${NEL}y un control`, updatedAt: AHORA - 3 * H },
      null,
      'ENG-15',
    ]),
    lectura('jira', JIRA, 'inventado', [incidencia('ENG-99')]),
    lectura('correo', JIRA, 'history', [incidencia('ENG-98')]),
    { product: 'confluence', host: CONF, kind: 'viewed', items: 'no es una lista' },
    null,
  ]
  const cands = buildCandidates({ reads, activity: { [JIRA]: 'tampoco es un diario' }, here: AQUI, now: AHORA })
  eq(cands.map((c) => c.id).sort(), ['ENG-12', 'ENG-13', 'ENG-14'], 'sólo lo que tiene forma de incidencia')
  eq(cands.find((c) => c.id === 'ENG-12').updatedAt, 0, 'una fecha que no es un número es 0, no NaN')
  eq(cands.find((c) => c.id === 'ENG-12').lastViewedAt, 0, 'y un infinito tampoco es una fecha')
  eq(cands.find((c) => c.id === 'ENG-13').updatedAt, 0, 'una fecha en texto no se adivina: la API las da en ms')
  assert(!ABRE_LINEA.test(cands.find((c) => c.id === 'ENG-14').title), 'un título con un NEL dentro no abre línea')

  eq(buildCandidates({}), [], 'sin nada, nada')
  eq(buildCandidates({ reads: 'ninguna', activity: null, here: 'aquí', now: 'ayer' }), [], 'y con basura, tampoco lanza')

  // Una fecha por delante del reloj se trae a «ahora»: si no, esa fila sería la
  // primera para siempre.
  const futuro = buildCandidates({
    reads: [lectura('jira', JIRA, 'history', [incidencia('ENG-30', { updatedAt: AHORA + 5 * D })])],
    activity: {},
    now: AHORA,
  })
  eq(futuro[0].updatedAt, AHORA, 'lo que dice venir del futuro se queda en ahora')
})

// ---------------------------------------------------------------- puntuar

test('scoreCandidate: cada señal suma lo que dice SIGNALS, y dice cuáles fueron', () => {
  const base = {
    analyzedAt: 0,
    family: '',
    host: JIRA,
    id: 'ENG-12',
    kind: 'jira-issue',
    lastViewedAt: 0,
    notes: 0,
    product: 'jira',
    seenAt: 0,
    seenCount: 0,
    sourceAt: 0,
    sources: ['history'],
    spaceKey: '',
    statusCategory: 'new',
    // Un título que no comparte ni una palabra con el de la incidencia abierta:
    // así cada prueba de abajo enciende UNA señal y no dos.
    title: 'Cosa suelta',
    type: 'Task',
    updatedAt: 0,
    updatedBy: '',
  }
  const puntos = (extra, ctx = {}) => scoreCandidate({ ...base, ...extra }, { now: AHORA, ...ctx })

  eq(puntos({}), { hits: [], score: 0 }, 'sin nada que decir, cero')

  const visto = puntos({ seenAt: AHORA - 5 * D, updatedAt: AHORA - 2 * H })
  assert(visto.hits.includes('changedSinceSeen'), 'cambió desde que lo miraste')
  eq(visto.score, SIGNALS.changedSinceSeen + 20, 'la señal fuerte más la recencia llena (2 h)')

  const conServidor = puntos({ lastViewedAt: AHORA - 5 * D, updatedAt: AHORA - 2 * H })
  assert(conServidor.hits.includes('changedSinceSeen'), 'con el diario vacío vale el lastViewed del servidor')

  const tras = puntos({ seenAt: AHORA - 5 * D, analyzedAt: AHORA - 4 * D, updatedAt: AHORA - 2 * H })
  eq(tras.score, SIGNALS.changedSinceSeen + SIGNALS.changedSinceAnalyzed + 20, 'y si cambió tras tu análisis, suma encima')

  const base2 = puntos({ sourceAt: AHORA - 6 * D, updatedAt: AHORA - 2 * H })
  assert(base2.hits.includes('sourceChanged') && !base2.hits.includes('changedSinceSeen'), 'una base que nunca abriste')
  eq(base2.score, SIGNALS.sourceChanged + 20)

  eq(puntos({ sources: ['history', 'mine'] }).hits, ['mine'], 'es tuya o la sigues')
  eq(puntos({ sources: ['related'] }).hits, ['related'], 'enlazada con la abierta')
  eq(puntos({}, { here: AQUI }).hits, ['sameScope'], 'del mismo proyecto que lo abierto')
  eq(puntos({ family: 'api' }, { here: AQUI }).hits.sort(), ['sameFamily', 'sameScope'], 'y de la misma familia')
  eq(puntos({ family: 'api' }, { preferred: ['api', 'bug'] }).hits, ['preferredFamily'], 'de las que más analizas')
  eq(puntos({ title: 'Rotación de tokens en el borde' }, { here: AQUI }).hits.sort(), ['sameScope', 'sharedWords'], 'palabras del título')
  // Una sola palabra en común no es parecerse: con eso, «Guía de despliegue» y
  // «Guía de estilo» serían parientes. Se piden dos, como en el historial.
  eq(puntos({ title: 'Revisión de tokens caducados' }, { here: AQUI }).hits, ['sameScope'], 'una palabra suelta no basta')
  eq(puntos({ title: 'Otra cosa muy distinta' }, { here: AQUI }).hits, ['sameScope'], 'y ninguna, menos')
  eq(puntos({ title: 'Cosa suelta' }, { here: { ...AQUI, title: '' } }).hits, ['sameScope'], 'sin título abierto no hay parecido')

  // La recencia se parte por la mitad cada `halfLifeDays`.
  eq(puntos({ updatedAt: AHORA - TODAY_LIMITS.halfLifeDays * D }).score, Math.round(SIGNALS.recencyMax / 2))
  eq(puntos({ updatedAt: AHORA - 90 * D }).score, 0, 'lo de hace tres meses ya no suma por reciente')

  eq(puntos({ seenCount: 4 }).score, 4, 'lo que sueles mirar pesa poco')
  eq(puntos({ seenCount: 10000 }).score, SIGNALS.frequentMax, 'y deja de crecer')

  const cerrada = puntos({ statusCategory: 'done', updatedAt: AHORA - 2 * H })
  eq(cerrada.score, SIGNALS.closed + 20, 'una cerrada penaliza')
  const cerradaTras = puntos({ statusCategory: 'done', analyzedAt: AHORA - 4 * D, updatedAt: AHORA - 2 * H, seenAt: AHORA - 5 * D })
  assert(cerradaTras.hits.includes('closedAfterAnalysis'), 'salvo que se cerrara tras tu análisis')
  assert(!cerradaTras.hits.includes('closed'))

  eq(scoreCandidate(null), { hits: [], score: 0 }, 'y con basura no lanza')
  eq(scoreCandidate('ENG-7', { here: 'aquí', index: 3, preferred: 'api', now: 'ayer' }).score, 0)
})

test('rankToday: el orden de las señales es el del plan', () => {
  const reads = [
    // Cambió después de tu análisis.
    lectura('jira', JIRA, 'history', [incidencia('ENG-12', { updatedAt: AHORA - 2 * H })]),
    // Una página base que nunca abriste, modificada.
    lectura('confluence', CONF, 'ids', [pagina('3003', { updatedAt: AHORA - 2 * H, updatedBy: 'Marta' })]),
    // Tuya o seguida, sin más.
    lectura('jira', JIRA, 'mine', [incidencia('ENG-20', { updatedAt: AHORA - 20 * H })]),
    // Y algo que sólo se movió en el proyecto.
    lectura('jira', JIRA, 'project', [incidencia('ENG-30', { updatedAt: AHORA - 30 * H })]),
  ]
  const activity = {
    [JIRA]: diario(JIRA, {
      'jira-issue:ENG-12': entrada('jira-issue', 'ENG-12', { seenAt: AHORA - 5 * D, analyzedAt: AHORA - 4 * D, notes: 6, family: 'api' }),
    }),
    [CONF]: diario(CONF, { 'confluence-page:3003': entrada('confluence-page', '3003', { sourceAt: AHORA - 6 * D }) }),
  }
  const filas = rankToday(buildCandidates({ reads, activity, here: AQUI, now: AHORA }), { here: AQUI, now: AHORA })
  eq(filas.map((f) => f.id), ['ENG-12', '3003', 'ENG-20', 'ENG-30'], 'cambió tras tu análisis > base modificada > tuya > del proyecto')
  eq(filas.map((f) => f.group), ['cambio', 'cambio', 'tuyo', 'proyecto'], 'y cada una cae en su grupo')
  assert(filas[0].score > filas[1].score, 'y los puntos lo dicen, no el orden de llegada')
  assert(filas[1].score > filas[2].score)
  assert(filas[2].score > filas[3].score)
})

test('rankToday: una cerrada cae al final, salvo que se cerrara tras tu análisis', () => {
  const reads = [
    lectura('jira', JIRA, 'history', [
      incidencia('ENG-40', { statusCategory: 'done', updatedAt: AHORA - 1 * H }),
      incidencia('ENG-41', { updatedAt: AHORA - 20 * H }),
      incidencia('ENG-42', { statusCategory: 'done', updatedAt: AHORA - 1 * H }),
    ]),
  ]
  const activity = {
    [JIRA]: diario(JIRA, {
      'jira-issue:ENG-42': entrada('jira-issue', 'ENG-42', { seenAt: AHORA - 5 * D, analyzedAt: AHORA - 4 * D, notes: 3 }),
    }),
  }
  const filas = rankToday(buildCandidates({ reads, activity, here: AQUI, now: AHORA }), { here: AQUI, now: AHORA })
  eq(filas.map((f) => f.id), ['ENG-42', 'ENG-41', 'ENG-40'], 'la cerrada que analizaste sube; la cerrada a secas, al fondo')
  assert(/se cerró tras tu análisis/.test(filas[0].why), 'y lo dice: ' + filas[0].why)
  assert(/cerrada/.test(filas[2].why), 'la otra también: ' + filas[2].why)
})

test('rankToday: lo enlazado con lo abierto y lo hermano de lo abierto suman', () => {
  const reads = [
    lectura('jira', JIRA, 'related', [incidencia('ENG-3', { updatedAt: AHORA - 10 * H })]),
    lectura('jira', JIRA, 'project', [incidencia('ENG-4', { updatedAt: AHORA - 10 * H })]),
  ]
  const filas = rankToday(buildCandidates({ reads, activity: {}, here: AQUI, now: AHORA }), { here: AQUI, now: AHORA })
  eq(filas[0].id, 'ENG-3', 'la enlazada con la abierta va antes')
  assert(/enlazada con ENG-7/.test(filas[0].why), 'y lo dice: ' + filas[0].why)

  // Hermanas: dos páginas que cuelgan del mismo padre en el índice.
  const index = normalizeIndex(
    {
      pages: [
        { id: '100', title: 'Arquitectura', url: '/pages/100' },
        { id: '200', title: 'Decisiones de diseño', url: '/pages/200', parentId: '100' },
        { id: '201', title: 'Guía de despliegue', url: '/pages/201', parentId: '100' },
        { id: '300', title: 'Notas de la reunión', url: '/pages/300' },
      ],
    },
    CONF,
    { kind: 'space', key: 'ENG' }
  )
  const paginas = [lectura('confluence', CONF, 'viewed', [pagina('201', { updatedAt: AHORA - 10 * H }), pagina('300', { updatedAt: AHORA - 10 * H })])]
  const aqui = { host: CONF, product: 'confluence', pageId: '200', spaceKey: 'ENG' }
  const dosPaginas = rankToday(buildCandidates({ reads: paginas, activity: {}, here: aqui, now: AHORA }), { here: aqui, index, now: AHORA })
  eq(dosPaginas[0].id, '201', 'la hermana de la página abierta va antes')
  assert(/hermana de la página abierta/.test(dosPaginas[0].why), 'y lo dice: ' + dosPaginas[0].why)
  assert(!/hermana/.test(dosPaginas[1].why), 'la otra no')
  // Sin índice no se inventa el parentesco.
  const sinIndice = rankToday(buildCandidates({ reads: paginas, activity: {}, here: aqui, now: AHORA }), { here: aqui, now: AHORA })
  assert(!sinIndice.some((f) => /hermana/.test(f.why)), 'sin índice, nadie es hermana de nadie')
})

test('rankToday: las familias que más analizas suben', () => {
  const reads = [
    lectura('jira', JIRA, 'project', [
      incidencia('ENG-50', { type: 'API Definition', updatedAt: AHORA - 10 * H }),
      incidencia('ENG-51', { type: 'Bug', updatedAt: AHORA - 10 * H }),
    ]),
  ]
  const aqui = { host: JIRA, product: 'jira', projectKey: 'ENG' }
  const cands = buildCandidates({ reads, activity: {}, here: aqui, now: AHORA })
  eq(rankToday(cands, { here: aqui, preferred: ['api'], now: AHORA }).map((f) => f.id), ['ENG-50', 'ENG-51'])
  eq(rankToday(cands, { here: aqui, preferred: ['bug'], now: AHORA }).map((f) => f.id), ['ENG-51', 'ENG-50'], 'y al revés')
  eq(rankToday(cands, { here: aqui, now: AHORA }).map((f) => f.id), ['ENG-50', 'ENG-51'], 'sin familias preferidas, el desempate de siempre')
})

test('rankToday: los empates se rompen siempre igual, y dos llamadas dan el mismo JSON', () => {
  const reads = [
    lectura('jira', JIRA, 'project', [
      incidencia('ENG-60', { summary: 'Zeta', updatedAt: AHORA - 10 * H }),
      incidencia('ENG-61', { summary: 'Alfa', updatedAt: AHORA - 10 * H }),
      incidencia('ENG-62', { summary: 'Álava', updatedAt: AHORA - 10 * H }),
      incidencia('ENG-63', { summary: 'Alfa', updatedAt: AHORA - 9 * H }),
    ]),
  ]
  const aqui = { host: JIRA, product: 'jira', projectKey: 'ENG' }
  const cands = buildCandidates({ reads, activity: {}, here: aqui, now: AHORA })
  const filas = rankToday(cands, { here: aqui, now: AHORA })
  eq(filas.map((f) => f.id), ['ENG-63', 'ENG-62', 'ENG-61', 'ENG-60'], 'más reciente primero; a igual fecha, el título en español')
  eq(JSON.stringify(rankToday([...cands].reverse(), { here: aqui, now: AHORA })), JSON.stringify(filas), 'el orden de entrada no cuenta')

  // Y si dos empatan hasta en el título, decide la clave: nunca el azar.
  const gemelas = buildCandidates({
    reads: [lectura('jira', JIRA, 'project', [incidencia('ENG-71', { summary: 'Gemela', updatedAt: AHORA - 5 * H }), incidencia('ENG-70', { summary: 'Gemela', updatedAt: AHORA - 5 * H })])],
    activity: {},
    now: AHORA,
  })
  eq(rankToday(gemelas, { now: AHORA }).map((f) => f.id), ['ENG-70', 'ENG-71'])
  eq(rankToday([...gemelas].reverse(), { now: AHORA }).map((f) => f.id), ['ENG-70', 'ENG-71'])
})

test('rankToday: ocho filas como mucho, y cinco por producto', () => {
  const issues = []
  for (let i = 0; i < 12; i++) issues.push(incidencia(`ENG-${100 + i}`, { updatedAt: AHORA - i * H }))
  const pages = []
  for (let i = 0; i < 6; i++) pages.push(pagina(String(3000 + i), { updatedAt: AHORA - (i + 20) * H }))
  const cands = buildCandidates({
    reads: [lectura('jira', JIRA, 'project', issues), lectura('confluence', CONF, 'viewed', pages)],
    activity: {},
    here: AQUI,
    now: AHORA,
  })
  eq(cands.length, 18)
  const filas = rankToday(cands, { here: AQUI, now: AHORA })
  eq(filas.length, TODAY_LIMITS.maxItems, 'ocho filas')
  eq(filas.filter((f) => f.product === 'jira').length, TODAY_LIMITS.perProduct, 'cinco de Jira como mucho')
  eq(filas.filter((f) => f.product === 'confluence').length, 3, 'y el resto de Confluence, que si no no saldría nunca')
  eq(
    Object.keys(filas[0]).sort(),
    ['group', 'host', 'id', 'kind', 'product', 'score', 'title', 'updatedAt', 'updatedBy', 'why'],
    'claves exactas de una fila'
  )
  eq(rankToday([], {}), [], 'sin candidatos, ninguna fila')
  eq(rankToday(null), [], 'y con basura tampoco lanza')
  eq(rankToday(['ENG-7', null, {}], {}), [], 'lo que no es un candidato no es una fila')
})

// ------------------------------------------------------------- el porqué

test('reasonText: en español, con fechas relativas y sin fingir qué cambió', () => {
  const cand = {
    analyzedAt: AHORA - 4 * D,
    family: 'api',
    host: JIRA,
    id: 'ENG-12',
    kind: 'jira-issue',
    lastViewedAt: 0,
    notes: 6,
    product: 'jira',
    seenAt: AHORA - 5 * D,
    seenCount: 4,
    sourceAt: 0,
    sources: ['history'],
    spaceKey: '',
    statusCategory: 'new',
    title: 'Rotación de tokens',
    type: 'API Definition',
    updatedAt: AHORA - 26 * H,
    updatedBy: '',
  }
  const why = reasonText(cand, { hits: ['changedSinceSeen', 'changedSinceAnalyzed'], here: AQUI, now: AHORA })
  eq(why, 'cambió ayer · la analizaste hace 4 días con 6 observaciones · API Definition')
  assert(!/(qué cambió|nuevo comentario|estado)/i.test(why), 'la API dice cuándo, no qué: no se finge')

  const base = reasonText(
    { ...cand, analyzedAt: 0, notes: 0, sourceAt: AHORA - 6 * D, kind: 'confluence-page', id: '3003', type: '', updatedBy: 'Marta', updatedAt: AHORA - 2 * H },
    { hits: ['sourceChanged'], now: AHORA }
  )
  eq(base, 'página base de tus análisis · cambió hace 2 h · modificada por Marta')

  eq(reasonText({ ...cand, notes: 1, updatedAt: 0 }, { now: AHORA }), 'la analizaste hace 4 días con 1 observación · API Definition')
  eq(reasonText({ ...cand, analyzedAt: 0, updatedAt: AHORA - 30 * 60 * 1000, type: '' }, { now: AHORA }), 'cambió hace 30 min')
  eq(reasonText({ ...cand, analyzedAt: 0, updatedAt: AHORA - 10 * 1000, type: '' }, { now: AHORA }), 'cambió ahora mismo')
  eq(reasonText({ ...cand, analyzedAt: 0, updatedAt: AHORA - 200 * D, type: '' }, { now: AHORA }), 'cambió hace más de un mes')
  // Una fecha por delante del reloj no dice «dentro de dos horas».
  eq(reasonText({ ...cand, analyzedAt: 0, updatedAt: AHORA + 2 * H, type: '' }, { now: AHORA }), 'cambió ahora mismo')

  const suya = reasonText({ ...cand, analyzedAt: 0, type: '' }, { hits: ['mine'], now: AHORA })
  eq(suya, 'cambió ayer · es tuya o la sigues')
  const suyaPagina = reasonText({ ...cand, analyzedAt: 0, kind: 'confluence-page', id: '3003', type: '' }, { hits: ['mine'], now: AHORA })
  eq(suyaPagina, 'cambió ayer · la escribiste o la sigues')

  const delProyecto = reasonText({ ...cand, analyzedAt: 0, seenCount: 0, sources: ['project'] }, { now: AHORA })
  eq(delProyecto, 'cambió ayer · actividad reciente en ENG · API Definition')

  const mirada = reasonText({ ...cand, analyzedAt: 0, type: '', seenCount: 7 }, { hits: ['frequent'], now: AHORA })
  eq(mirada, 'cambió ayer · la sueles mirar (7 veces)')

  eq(reasonText(null), '', 'con basura, sin porqué')
  eq(reasonText({}, { hits: 'ninguno', here: 3, now: 'ayer' }), '')
})

test('reasonText SEGURIDAD: nunca dice de quién es, y ningún texto abre línea ni se sale del tope', () => {
  const cand = {
    analyzedAt: AHORA - 2 * D,
    family: '',
    host: JIRA,
    id: 'ENG-12',
    kind: 'jira-issue',
    lastViewedAt: 0,
    notes: 99,
    product: 'jira',
    seenAt: AHORA - 5 * D,
    seenCount: 9999,
    sourceAt: AHORA - 6 * D,
    sources: ['history', 'mine', 'project'],
    spaceKey: '',
    statusCategory: 'new',
    title: 'x',
    type: 'Un tipo con un nombre larguísimo '.repeat(4),
    updatedAt: AHORA - 2 * H,
    updatedBy: `Alguien${NEL}de otra línea`,
  }
  const why = reasonText(cand, { hits: ['changedSinceSeen', 'mine', 'frequent', 'sourceChanged'], here: AQUI, now: AHORA })
  assert(why.length <= TODAY_LIMITS.whyMax, 'acotado a whyMax: ' + why.length)
  assert(!ABRE_LINEA.test(why), 'una sola línea, con NEL incluido')
  // La plantilla pregunta por tres cosas a la vez y la respuesta no dice cuál
  // casó; y Faro no sabe quién eres (nunca pregunta `myself`).
  assert(!/asignad|te mencionan|currentUser/i.test(why), 'no se inventa que te la asignaron: ' + why)
  eq(why.split(' · ').length <= TODAY_LIMITS.whyParts, true, 'tres trozos como mucho')
})

test('groupOf: los tres grupos de la pantalla', () => {
  const cand = { sources: ['history'] }
  eq(groupOf(cand, ['changedSinceSeen']), 'cambio')
  eq(groupOf(cand, ['changedSinceAnalyzed']), 'cambio')
  eq(groupOf(cand, ['sourceChanged']), 'cambio')
  eq(groupOf(cand, ['mine', 'recency']), 'tuyo')
  eq(groupOf(cand, ['changedSinceSeen', 'mine']), 'cambio', 'el cambio manda sobre lo tuyo')
  eq(groupOf(cand, ['recency']), 'proyecto')
  eq(groupOf({ sources: ['mine'] }, []), 'tuyo', 'sin señales vale de qué lectura salió')
  eq(groupOf(null), 'proyecto', 'y con basura, el cajón de siempre')
  eq(groupOf({ sources: 'ninguna' }, 'tampoco'), 'proyecto')
})

// --------------------------------------------------- el resto del panel

test('todaySummary: números y motivos, nunca títulos ni ids', () => {
  const items = [
    { group: 'cambio', product: 'jira', id: 'ENG-12', title: 'Rotación de tokens' },
    { group: 'cambio', product: 'confluence', id: '3003', title: 'Guía de API' },
    { group: 'tuyo', product: 'jira', id: 'ENG-20', title: 'Arreglar el login' },
  ]
  const linea = todaySummary({ items, errors: [{ product: 'jira', reason: 'sesion' }] })
  eq(linea, '3 filas · Jira 2 · Confluence 1 · 2 con cambios · Jira sin lista: sesion')
  for (const prohibido of ['ENG-12', '3003', 'Rotación', 'Guía', 'http']) {
    assert(!linea.includes(prohibido), 'el Registro no enseña ' + prohibido)
  }
  eq(todaySummary({ items: [items[0]] }), '1 fila · Jira 1 · 1 con cambios', 'singular')
  eq(todaySummary({}), '0 filas', 'sin nada que decir')
  eq(todaySummary(), '0 filas')
  eq(todaySummary({ items: 'ninguna', errors: [null, 'x'] }), '0 filas', 'con basura no lanza')
  assert(/sin motivo/.test(todaySummary({ errors: [{ product: 'confluence' }] })), 'un fallo sin código se nombra igual')
})

test('countNew: cuántas han cambiado desde que abriste la lista', () => {
  const items = [{ updatedAt: AHORA - 1 * H }, { updatedAt: AHORA - 5 * H }, { updatedAt: AHORA - 30 * H }]
  eq(countNew(items, AHORA - 3 * H), 1)
  eq(countNew(items, AHORA - 10 * H), 2)
  eq(countNew(items, 0), 3, 'la primera vez cuentan todas: la insignia tiene que decir que hay algo')
  eq(countNew(items, undefined), 3)
  eq(countNew(items, AHORA), 0)
  eq(countNew(null, AHORA), 0)
  eq(countNew([null, {}, { updatedAt: 'ayer' }], AHORA - 3 * H), 0, 'lo que no tiene fecha no ha cambiado')
})

test('analyzeQuestion: la pregunta que se deja escrita, con la fecha de TU análisis si lo hubo', () => {
  const activity = diario(JIRA, {
    'jira-issue:ENG-12': entrada('jira-issue', 'ENG-12', { analyzedAt: AHORA - 3 * D, notes: 6 }),
  })
  const nueva = analyzeQuestion({ kind: 'jira-issue', id: 'ENG-20' }, activity, { now: AHORA })
  eq(nueva, 'Analiza esta incidencia y dime qué le falta.')
  const otra = analyzeQuestion({ kind: 'jira-issue', id: 'ENG-12' }, activity, { now: AHORA })
  eq(otra, 'Analiza esta incidencia otra vez: la analizaste hace 3 días y ha cambiado. ¿Qué es distinto y qué sigue faltando?')

  eq(analyzeQuestion({ kind: 'confluence-page', id: '3003' }, null, { now: AHORA }), 'Analiza esta página y dime qué le falta.')
  const paginas = diario(CONF, { 'confluence-page:3003': entrada('confluence-page', '3003', { analyzedAt: AHORA - 26 * H }) })
  assert(/esta página otra vez: la analizaste ayer/.test(analyzeQuestion({ kind: 'confluence-page', id: '3003' }, paginas, { now: AHORA })))

  eq(analyzeQuestion(null), 'Analiza esta incidencia y dime qué le falta.', 'con basura, la pregunta de siempre')
  eq(analyzeQuestion({ kind: 'jira-issue', id: 'ENG-12' }, 'no es un diario', { now: AHORA }), 'Analiza esta incidencia y dime qué le falta.')
})

test('analyzeQuestion SEGURIDAD: el diario no entra en un prompt por la puerta de atrás', () => {
  // Lo que se deja en el cuadro puede acabar en un prompt en cuanto el usuario
  // pulse enviar, así que no lleva NADA que el usuario no tenga ya delante: ni
  // el título, ni la clave, ni el id, ni el host (CLAUDE.md §8.20).
  const activity = diario(JIRA, {
    'jira-issue:ENG-12': entrada('jira-issue', 'ENG-12', {
      title: 'Rotación de tokens de servicio en produccion',
      path: '/browse/ENG-12',
      analyzedAt: AHORA - 3 * D,
      notes: 6,
    }),
  })
  const item = { kind: 'jira-issue', id: 'ENG-12', host: JIRA, title: 'Rotación de tokens de servicio en produccion' }
  const texto = analyzeQuestion(item, activity, { now: AHORA })
  for (const prohibido of ['ENG-12', 'Rotación', 'produccion', JIRA, '/browse/', '6 observaciones']) {
    assert(!texto.includes(prohibido), 'la pregunta no lleva ' + prohibido + ': ' + texto)
  }
  assert(texto.startsWith('Analiza esta incidencia'), 'habla de lo que el usuario tiene delante: ' + texto)
  assert(!/[\n\r]/.test(texto), 'y es una línea')
})

test('recentPagesFromActivity: primero lo que tocaste con intención', () => {
  const activity = diario(CONF, {
    'confluence-page:3001': entrada('confluence-page', '3001', { seenAt: AHORA - 1 * H, seenCount: 3, title: 'Sólo vista' }),
    'confluence-page:3002': entrada('confluence-page', '3002', { seenAt: AHORA - 9 * D, analyzedAt: AHORA - 9 * D, title: 'Analizada', path: '/pages/3002' }),
    'confluence-page:3003': entrada('confluence-page', '3003', { seenAt: AHORA - 2 * D, sourceAt: AHORA - 2 * D, title: 'Página base' }),
    'confluence-page:3004': entrada('confluence-page', '3004', { seenAt: AHORA - 40 * D, title: 'Vieja' }),
    'jira-issue:ENG-12': entrada('jira-issue', 'ENG-12', { seenAt: AHORA - 1 * H }),
  })
  const r = recentPagesFromActivity(activity, { now: AHORA })
  eq(r.map((p) => p.id), ['3003', '3002', '3001'], 'base y analizada antes que la sólo vista; la de hace 40 días, fuera')
  eq(Object.keys(r[0]).sort(), ['id', 'path', 'title'], 'claves exactas')
  eq(r[1], { id: '3002', path: '/pages/3002', title: 'Analizada' })
  eq(recentPagesFromActivity(activity, { limit: 2, now: AHORA }).length, 2, 'con su tope')
  eq(recentPagesFromActivity(activity, { days: 1, now: AHORA }).map((p) => p.id), ['3001'], 'y su ventana')
  eq(recentPagesFromActivity(null), [], 'sin diario, nada')
  eq(recentPagesFromActivity({ items: 'ninguno' }, { days: 'muchos', limit: -3 }), [], 'con basura tampoco lanza')
})
