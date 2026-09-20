/**
 * El diario local de actividad (src/atlassian/activity.js).
 *
 * Es lo único de Faro que guarda un rastro de lo que el usuario abre, así que
 * lo que más se comprueba aquí es lo que NO entra: ni una URL absoluta, ni la
 * consulta, ni el fragmento, ni un título con caracteres que no se ven, ni una
 * clave que no tenga forma de clave. Y que los dos escritores —el service
 * worker apuntando visitas y el panel apuntando análisis— no se pisan los
 * campos del otro, que es lo que hace inofensiva la carrera entre los dos.
 *
 * Todo con el reloj inyectado: la caducidad tiene que dar lo mismo hoy que
 * dentro de un año.
 */
import { test, eq, assert } from '../harness.js'
import {
  ACTIVITY_KINDS,
  ACTIVITY_LIMITS,
  ACTIVITY_VERSION,
  activityKey,
  dismissItem,
  emptyActivity,
  lastSeen,
  normalizeActivity,
  preferredFamilies,
  pruneActivity,
  recordVisit,
  touchActivity,
  visitFromUrl,
} from '../../src/atlassian/activity.js'

const HOST = 'confluence.simplprogramme.eu'
const JIRA = 'https://jira.simplprogramme.eu'
const CONF = 'https://confluence.simplprogramme.eu'
const AHORA = Date.UTC(2026, 8, 20, 9, 0, 0)
const DIA = 24 * 60 * 60 * 1000

/** Una visita ya validada y la clave con la que se guarda. */
const VISITA = { at: AHORA, id: 'ENG-7', kind: 'jira-issue', path: '/browse/ENG-7', title: 'Consent API v2' }
const CLAVE = 'jira-issue:ENG-7'

/** Las claves que puede tener una entrada del diario, y ninguna más. */
const CLAVES_ITEM = [
  'analyzedAt',
  'analyzedCount',
  'family',
  'id',
  'kind',
  'notes',
  'path',
  'seenAt',
  'seenCount',
  'sourceAt',
  'title',
]

// --------------------------------------------------------------- lo básico

test('actividad: el diario vacío tiene su versión, su host y sus dos cubos', () => {
  eq(emptyActivity(HOST), { version: ACTIVITY_VERSION, host: HOST, items: {}, dismissed: {} })
  eq(Object.keys(emptyActivity(HOST)).sort(), ['dismissed', 'host', 'items', 'version'])
  eq(ACTIVITY_KINDS, ['jira-issue', 'confluence-page'])
  eq(ACTIVITY_LIMITS.maxEntries, 300)
  eq(ACTIVITY_LIMITS.maxAgeDays, 30)
  eq(ACTIVITY_LIMITS.dedupeMs, 60000)
  eq(ACTIVITY_LIMITS.titleMax, 200)
  eq(ACTIVITY_LIMITS.dismissedMax, 100)
})

test('SEGURIDAD: una clave de entrada se reconstruye con las validadoras', () => {
  eq(activityKey('jira-issue', 'eng-7'), 'jira-issue:ENG-7', 'la clave sube a mayúsculas')
  eq(activityKey('confluence-page', '98830281'), 'confluence-page:98830281')
  eq(activityKey('confluence-page', 3003), 'confluence-page:3003', 'un id numérico vale')
  // Nada que no tenga forma de identificador llega a ser una entrada.
  for (const [kind, id] of [
    ['jira-issue', 'ENG'],
    ['jira-issue', '../../x'],
    ['jira-issue', ''],
    ['confluence-page', '30 03'],
    ['confluence-page', '3003abc'],
    ['confluence-page', ''],
    ['confluence-space', 'ENG'],
    ['', '3003'],
    [null, null],
  ]) {
    eq(activityKey(kind, id), '', `${kind}:${id}`)
  }
})

// ------------------------------------------------------------- visitFromUrl

test('visita: una incidencia de Jira y una página de Confluence, en sus tres formas', () => {
  const issue = visitFromUrl(`${JIRA}/browse/ENG-7`, { title: '[ENG-7] Consent API v2 - Jira', at: AHORA })
  eq(issue, { at: AHORA, id: 'ENG-7', kind: 'jira-issue', path: '/browse/ENG-7', title: 'Consent API v2' })

  const dc = visitFromUrl(`${CONF}/pages/viewpage.action?pageId=3003`, { title: 'Runbook - Confluence', at: AHORA })
  eq(dc, {
    at: AHORA,
    id: '3003',
    kind: 'confluence-page',
    path: '/pages/viewpage.action',
    title: 'Runbook',
  })

  const cloud = visitFromUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/3003/Runbook', { at: AHORA })
  eq(cloud.kind, 'confluence-page')
  eq(cloud.id, '3003')
  eq(cloud.path, '/wiki/spaces/ENG/pages/3003/Runbook')
  eq(cloud.title, '', 'sin título de pestaña no se inventa ninguno')
})

test('visita: una página de un Data Center sólo existe con el id que el DOM da', () => {
  // `/display/ESPACIO/Título` no lleva el id por ninguna parte: sin la meta
  // `ajs-page-id` no hay nada que apuntar, y apuntarla por su ruta haría que la
  // misma página con otro título fuera otra entrada.
  eq(visitFromUrl(`${CONF}/display/ENG/Guia+de+APIs`, { title: 'Guía', at: AHORA }), null)
  const con = visitFromUrl(`${CONF}/display/ENG/Guia+de+APIs`, { title: 'Guía', pageId: '3003', at: AHORA })
  eq(con, { at: AHORA, id: '3003', kind: 'confluence-page', path: '/display/ENG/Guia+de+APIs', title: 'Guía' })
  // Y un id que no son cifras no es un id.
  eq(visitFromUrl(`${CONF}/display/ENG/T`, { pageId: '30 03', at: AHORA }), null)
  eq(visitFromUrl(`${CONF}/display/ENG/T`, { pageId: '../3003', at: AHORA }), null)
})

test('visita: lo que no es una incidencia ni una página no se apunta', () => {
  for (const url of [
    `${JIRA}/secure/Dashboard.jspa`,
    `${JIRA}/projects/ENG/summary`,
    `${JIRA}/issues/?jql=project%20%3D%20ENG`,
    `${CONF}/spaces/ENG/overview`,
    'https://mail.example.com/inbox',
    'javascript:alert(1)',
    'no es una url',
    '',
  ]) {
    eq(visitFromUrl(url, { at: AHORA }), null, url)
  }
  eq(visitFromUrl(`${JIRA}/browse/ENG-7`, { at: AHORA })?.kind, 'jira-issue', 'y la incidencia sí')
})

test('SEGURIDAD: de una URL sólo salen la clase, el id y la ruta relativa', () => {
  // Ni el origen, ni la consulta (un id de comentario, un token que alguien
  // pegó en la barra), ni el fragmento. Treinta días guardando eso no.
  const v = visitFromUrl(`${JIRA}/browse/ENG-7?focusedCommentId=9912&jwt=ey.SECRETO#comment-9912`, { at: AHORA })
  eq(v.path, '/browse/ENG-7')
  const json = JSON.stringify(v)
  assert(!json.includes('focusedCommentId'), 'la consulta no se guarda')
  assert(!json.includes('SECRETO'), 'ni un token pegado en la query')
  assert(!json.includes('#'), 'ni el fragmento')
  assert(!json.includes('http'), 'ni el origen: la URL se reconstruye, no se guarda')
  assert(!json.includes('simplprogramme'), 'el host va en la clave del almacén, no en la entrada')

  const p = visitFromUrl(`${CONF}/pages/viewpage.action?pageId=3003&src=correo#seccion`, { at: AHORA })
  eq(p.path, '/pages/viewpage.action')
  eq(p.id, '3003', 'el id sí, porque es lo que identifica la página')
})

test('SEGURIDAD: un título con lo que no se ve se aplana y se acota', () => {
  // El título de la pestaña lo escribe quien creó la página. Un RLO deja leer
  // la ubicación al revés; el NEL abre línea y el `\s` de JavaScript no lo
  // cubre; los C0 no se ven y ensucian todo lo que los pinte.
  // Se componen con `String.fromCharCode` a propósito: crudos en el fuente no
  // se pueden leer ni revisar, y cualquier editor que «limpie» el fichero se
  // los lleva sin que se note (revisión adversaria de H5).
  const [RLO, NEL, LS, BEL, ZWSP] = [0x202e, 0x85, 0x2028, 0x07, 0x200b].map((c) => String.fromCharCode(c))
  const sucio = `Gu${RLO}ía${NEL}de${LS}APIs${BEL} y${ZWSP} más`
  eq(visitFromUrl(`${JIRA}/browse/ENG-7`, { title: sucio, at: AHORA }).title, 'Guía de APIs y más')

  const largo = 'A'.repeat(5000)
  const t = visitFromUrl(`${JIRA}/browse/ENG-7`, { title: largo, at: AHORA }).title
  assert(t.length <= ACTIVITY_LIMITS.titleMax, `un título de 5000 se queda en ${t.length}`)
  assert(t.length > 0 && /^A+$/.test(t))

  // El producto que firma el título de la pestaña no es parte del título.
  eq(visitFromUrl(`${JIRA}/browse/ENG-7`, { title: 'X - Jira', at: AHORA }).title, 'X')
  eq(visitFromUrl(`${CONF}/pages/viewpage.action?pageId=3003`, { title: 'Y - Confluence', at: AHORA }).title, 'Y')

  // Y lo mismo por los OTROS dos caminos por los que entra un título: el que
  // apunta el panel (el resumen de una incidencia, que lo escribe quien la
  // creó) y el que ya estaba guardado (editable a mano en el almacén). Aquí no
  // hay `cleanTabTitle` que valga: la limpieza es de este módulo.
  const a = touchActivity(
    emptyActivity(HOST),
    { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', title: sucio },
    { host: HOST, now: AHORA }
  )
  eq(a.items[CLAVE].title, 'Guía de APIs y más')
  const guardado = normalizeActivity(
    { items: { [CLAVE]: { seenAt: AHORA, title: sucio } } },
    { host: HOST, now: AHORA }
  )
  eq(guardado.items[CLAVE].title, 'Guía de APIs y más')
  eq(
    normalizeActivity({ items: { [CLAVE]: { seenAt: AHORA, title: largo } } }, { host: HOST, now: AHORA }).items[CLAVE]
      .title.length,
    ACTIVITY_LIMITS.titleMax
  )
})

// -------------------------------------------------------------- recordVisit

test('visto: la primera visita crea la entrada y la segunda suma', () => {
  const uno = recordVisit(emptyActivity(HOST), VISITA, { host: HOST, now: AHORA })
  eq(Object.keys(uno.items), [CLAVE])
  eq(uno.items[CLAVE].seenCount, 1)
  eq(uno.items[CLAVE].seenAt, AHORA)
  eq(uno.items[CLAVE].title, 'Consent API v2')

  const luego = AHORA + 3 * 60 * 60 * 1000
  const dos = recordVisit(uno, { ...VISITA, at: luego }, { host: HOST, now: luego })
  eq(dos.items[CLAVE].seenCount, 2)
  eq(dos.items[CLAVE].seenAt, luego)
  eq(uno.items[CLAVE].seenCount, 1, 'y no se muta lo que entra')
})

test('visto: los dos avisos de una misma navegación cuentan UNA vez', () => {
  // El worker apunta por `tabs.onUpdated` y el content script por
  // `CONTENT_READY`; Confluence además reescribe su propia URL al cargar.
  let a = recordVisit(emptyActivity(HOST), VISITA, { host: HOST, now: AHORA })
  a = recordVisit(a, { ...VISITA, at: AHORA + 200 }, { host: HOST, now: AHORA + 200 })
  a = recordVisit(a, { ...VISITA, at: AHORA + 59_000 }, { host: HOST, now: AHORA + 59_000 })
  eq(a.items[CLAVE].seenCount, 1, 'dentro de la ventana de dedupe es la misma visita')
  eq(a.items[CLAVE].seenAt, AHORA + 59_000, 'pero la fecha es la última')

  // La ventana se mide desde la ÚLTIMA visita, no desde la primera: tener algo
  // abierto recargando cada medio minuto es seguir mirando lo mismo, no
  // visitarlo cien veces.
  const fuera = AHORA + 59_000 + ACTIVITY_LIMITS.dedupeMs + 1
  const b = recordVisit(a, { ...VISITA, at: fuera }, { host: HOST, now: fuera })
  eq(b.items[CLAVE].seenCount, 2, 'pasada la ventana ya es otra visita')
})

test('visto: dentro de la ventana el título sí se refresca', () => {
  // `tabs.onUpdated` llega cuando la navegación se confirma, y ahí el título de
  // la pestaña todavía suele ser el de la página anterior; el `CONTENT_READY`
  // que viene detrás trae el bueno.
  const viejo = recordVisit(emptyActivity(HOST), { ...VISITA, title: 'Página anterior' }, { host: HOST, now: AHORA })
  const nuevo = recordVisit(viejo, { ...VISITA, at: AHORA + 300 }, { host: HOST, now: AHORA + 300 })
  eq(nuevo.items[CLAVE].title, 'Consent API v2')
  eq(nuevo.items[CLAVE].seenCount, 1)
  // Y un aviso sin título no borra el que había.
  const sin = recordVisit(nuevo, { ...VISITA, at: AHORA + 400, title: '' }, { host: HOST, now: AHORA + 400 })
  eq(sin.items[CLAVE].title, 'Consent API v2')
})

test('visto: una visita que no vale deja el diario como estaba', () => {
  const base = recordVisit(emptyActivity(HOST), VISITA, { host: HOST, now: AHORA })
  for (const mala of [null, undefined, {}, { kind: 'jira-issue' }, { kind: 'otra-cosa', id: 'ENG-7' }, { kind: 'confluence-page', id: 'x' }]) {
    eq(recordVisit(base, mala, { host: HOST, now: AHORA }), base, JSON.stringify(mala))
  }
})

// ------------------------------------------------------------ touchActivity

test('analizado: el panel apunta el análisis con sus observaciones y su familia', () => {
  const a = touchActivity(
    emptyActivity(HOST),
    { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', title: 'Consent API v2', notes: 6, family: 'api' },
    { host: HOST, now: AHORA }
  )
  eq(a.items[CLAVE].analyzedAt, AHORA)
  eq(a.items[CLAVE].analyzedCount, 1)
  eq(a.items[CLAVE].notes, 6)
  eq(a.items[CLAVE].family, 'api')
  eq(a.items[CLAVE].seenAt, 0, 'analizar no es haber mirado: de «visto» hay un solo escritor')
  eq(a.items[CLAVE].seenCount, 0)

  const otra = touchActivity(a, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', notes: 2 }, { host: HOST, now: AHORA + DIA })
  eq(otra.items[CLAVE].analyzedCount, 2)
  eq(otra.items[CLAVE].notes, 2, 'las observaciones son las del último análisis')
  eq(otra.items[CLAVE].family, 'api', 'y la familia se conserva si el análisis nuevo no la trae')
})

test('página base: se apunta cuándo se usó, y nada más', () => {
  const a = touchActivity(
    emptyActivity(HOST),
    { event: 'source', kind: 'confluence-page', id: '3003', title: 'Guía de APIs' },
    { host: HOST, now: AHORA }
  )
  const k = 'confluence-page:3003'
  eq(a.items[k].sourceAt, AHORA)
  eq(a.items[k].analyzedAt, 0)
  eq(a.items[k].seenAt, 0)
  eq(a.items[k].title, 'Guía de APIs')
})

test('SEGURIDAD: los dos escritores no se pisan los campos del otro', () => {
  // Es lo que hace inofensiva la carrera entre el service worker y el panel:
  // `recordVisit` nunca toca lo analizado y `touchActivity` nunca toca lo visto.
  let a = touchActivity(
    emptyActivity(HOST),
    { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', notes: 6, family: 'api' },
    { host: HOST, now: AHORA }
  )
  a = recordVisit(a, { ...VISITA, at: AHORA + DIA }, { host: HOST, now: AHORA + DIA })
  eq(a.items[CLAVE].analyzedAt, AHORA, 'la visita no borra el análisis')
  eq(a.items[CLAVE].notes, 6)
  eq(a.items[CLAVE].family, 'api')
  eq(a.items[CLAVE].seenCount, 1)

  a = touchActivity(a, { event: 'source', kind: 'jira-issue', id: 'ENG-7' }, { host: HOST, now: AHORA + 2 * DIA })
  eq(a.items[CLAVE].seenAt, AHORA + DIA, 'y el apunte del panel no borra la visita')
  eq(a.items[CLAVE].seenCount, 1)
})

test('analizado: un evento que no vale deja el diario como estaba', () => {
  const base = touchActivity(emptyActivity(HOST), { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7' }, { host: HOST, now: AHORA })
  for (const malo of [null, {}, { event: 'seen', kind: 'jira-issue', id: 'ENG-7' }, { event: 'analyzed', kind: 'jira-issue', id: 'x' }, { event: 'borrar', kind: 'jira-issue', id: 'ENG-7' }]) {
    eq(touchActivity(base, malo, { host: HOST, now: AHORA }), base, JSON.stringify(malo))
  }
})

// ------------------------------------------------------------- dismissItem

test('descartado: «ya lo he visto» se guarda con la fecha del DESCARTE, nunca anterior al cambio que se vio', () => {
  // EL CAMBIO (revisión adversaria de H11): antes se guardaba la fecha de la
  // COSA, y eso rompía dos cosas. Ahora es el momento del descarte, subido al del
  // cambio si el cambio venía por delante del reloj.
  const a = dismissItem(emptyActivity(HOST), CLAVE, AHORA - DIA, { host: HOST, now: AHORA })
  eq(a.dismissed, { [CLAVE]: AHORA }, '«ya lo he visto» es «lo he visto AHORA»')
  // Y sigue volviendo sola en cuanto alguien la toca DESPUÉS: quien lo consume
  // compara `updatedAt <= dismissed[clave]`.
  assert(a.dismissed[CLAVE] >= AHORA - DIA, 'lo que ya estaba visto no vuelve')
  assert(AHORA + DIA > a.dismissed[CLAVE], 'y un cambio posterior sí')

  // (12) Una fila con `updatedAt` por delante del reloj también se descarta: con
  // la fecha de la cosa a secas, la marca se quedaba por detrás de su propio
  // cambio y la fila no se podía quitar NUNCA.
  eq(dismissItem(emptyActivity(HOST), CLAVE, AHORA + DIA, { host: HOST, now: AHORA }).dismissed[CLAVE], AHORA + DIA)

  // Sin fecha utilizable, la de ahora.
  eq(dismissItem(emptyActivity(HOST), CLAVE, 'ayer', { host: HOST, now: AHORA }).dismissed[CLAVE], AHORA)
  eq(dismissItem(emptyActivity(HOST), CLAVE, -5, { host: HOST, now: AHORA }).dismissed[CLAVE], AHORA)
  // (2) Y un `updatedAt` de 0 —una API que no dijo cuándo cambió— tampoco deja
  // una marca de 1970 que `pruneActivity` se lleve en la primera escritura.
  eq(dismissItem(emptyActivity(HOST), CLAVE, 0, { host: HOST, now: AHORA }).dismissed[CLAVE], AHORA)
  // Y una clave que no lo es no se guarda.
  eq(dismissItem(emptyActivity(HOST), 'jira-issue:ENG', 1, { host: HOST, now: AHORA }).dismissed, {})
  eq(dismissItem(emptyActivity(HOST), '__proto__', 1, { host: HOST, now: AHORA }).dismissed, {})
})

test('descartado: se recuerdan los últimos, con tope', () => {
  let a = emptyActivity(HOST)
  for (let i = 1; i <= ACTIVITY_LIMITS.dismissedMax + 20; i++) {
    a = dismissItem(a, `confluence-page:${i}`, AHORA, { host: HOST, now: AHORA })
  }
  const claves = Object.keys(a.dismissed)
  eq(claves.length, ACTIVITY_LIMITS.dismissedMax)
  eq(claves[claves.length - 1], `confluence-page:${ACTIVITY_LIMITS.dismissedMax + 20}`, 'se queda el último descarte')
  assert(!claves.includes('confluence-page:1'), 'y se va el más viejo')

  // Descartar otra vez lo mismo no lo duplica y lo pone al final.
  const b = dismissItem(a, 'confluence-page:30', AHORA + 1, { host: HOST, now: AHORA + 1 })
  eq(Object.keys(b.dismissed).length, ACTIVITY_LIMITS.dismissedMax)
  eq(Object.keys(b.dismissed).at(-1), 'confluence-page:30')
  eq(b.dismissed['confluence-page:30'], AHORA + 1)
})

// --------------------------------------------------------- normalizeActivity

test('SEGURIDAD: una entrada guardada se reconstruye con claves EXACTAS', () => {
  const a = normalizeActivity(
    {
      version: ACTIVITY_VERSION,
      host: HOST,
      items: {
        [CLAVE]: {
          kind: 'confluence-page',
          id: '999',
          title: 'Consent API v2',
          path: '/browse/ENG-7',
          seenAt: AHORA,
          seenCount: 3,
          analyzedAt: AHORA,
          analyzedCount: 1,
          notes: 6,
          family: 'api',
          sourceAt: 0,
          onclick: 'alert(1)',
          url: `${JIRA}/browse/ENG-7?jwt=SECRETO`,
          text: 'el cuerpo entero de la página',
        },
      },
      dismissed: {},
      extra: 'no',
    },
    { host: HOST, now: AHORA }
  )
  eq(Object.keys(a).sort(), ['dismissed', 'host', 'items', 'version'])
  eq(Object.keys(a.items[CLAVE]).sort(), CLAVES_ITEM)
  // La CLAVE manda: una entrada no puede decir ser otra cosa de la que la indexa.
  eq(a.items[CLAVE].kind, 'jira-issue')
  eq(a.items[CLAVE].id, 'ENG-7')
  assert(!JSON.stringify(a).includes('SECRETO'), 'ni una URL guardada a mano se conserva')
  assert(!JSON.stringify(a).includes('alert'), 'ni un onclick')
  assert(!JSON.stringify(a).includes('el cuerpo entero'), 'ni texto de la página')
})

test('SEGURIDAD: lo que no tiene forma de entrada se cae', () => {
  const a = normalizeActivity(
    {
      items: {
        'jira-issue:ENG-7': { seenAt: AHORA },
        'jira-issue:ENG': { seenAt: AHORA },
        'confluence-page:../etc': { seenAt: AHORA },
        'confluence-space:ENG': { seenAt: AHORA },
        'sin-separador': { seenAt: AHORA },
        'confluence-page:3003': 'no es un objeto',
      },
      dismissed: { 'jira-issue:ENG-7': AHORA, 'jira-issue:nada': AHORA, 'confluence-page:3003': 'ayer' },
    },
    { host: HOST, now: AHORA }
  )
  eq(Object.keys(a.items), ['jira-issue:ENG-7'])
  eq(a.dismissed, { 'jira-issue:ENG-7': AHORA })
  // Y lo que no es un diario es un diario vacío, nunca una excepción.
  for (const raro of [null, undefined, 'abc', 7, [], { items: 'x' }, { version: 99, items: { [CLAVE]: { seenAt: 1 } } }]) {
    eq(normalizeActivity(raro, { host: HOST, now: AHORA }), emptyActivity(HOST), JSON.stringify(raro))
  }
})

test('SEGURIDAD: una ruta absoluta o con consulta guardada a mano no sobrevive', () => {
  const a = normalizeActivity(
    {
      items: {
        [CLAVE]: { seenAt: AHORA, path: `${JIRA}/browse/ENG-7?jwt=SECRETO` },
        'confluence-page:3003': { seenAt: AHORA, path: '//evil.example/x' },
        'confluence-page:3004': { seenAt: AHORA, path: '/pages/viewpage.action?pageId=3004#c1' },
      },
    },
    { host: HOST, now: AHORA }
  )
  eq(a.items[CLAVE].path, '', 'una absoluta no es una ruta relativa')
  eq(a.items['confluence-page:3003'].path, '', 'ni una protocolo-relativa, que es un salto de origen')
  eq(a.items['confluence-page:3004'].path, '/pages/viewpage.action')
})

test('números: contadores y fechas se reconstruyen, y nada viene del futuro', () => {
  const a = normalizeActivity(
    {
      items: {
        [CLAVE]: {
          seenAt: AHORA + 10 * DIA,
          seenCount: 1e12,
          analyzedCount: -3,
          notes: 9999,
          analyzedAt: 'ayer',
          sourceAt: null,
          family: 'Familia Rara',
        },
      },
    },
    { host: HOST, now: AHORA }
  )
  const it = a.items[CLAVE]
  eq(it.seenAt, AHORA, 'una fecha por delante del reloj se trae a ahora: si no, no caducaría nunca')
  eq(it.seenCount, ACTIVITY_LIMITS.countMax)
  eq(it.analyzedCount, 0)
  eq(it.notes, ACTIVITY_LIMITS.notesMax)
  eq(it.analyzedAt, 0)
  eq(it.sourceAt, 0)
  eq(it.family, '', 'una familia sin forma de identificador no se guarda')
})

test('normalizar dos veces da lo mismo, y se conservan las entradas más recientes', () => {
  const items = {}
  for (let i = 1; i <= ACTIVITY_LIMITS.maxEntries + 50; i++) {
    items[`confluence-page:${i}`] = { seenAt: AHORA - (ACTIVITY_LIMITS.maxEntries + 50 - i) * 1000, seenCount: 1 }
  }
  const a = normalizeActivity({ items }, { host: HOST, now: AHORA })
  eq(Object.keys(a.items).length, ACTIVITY_LIMITS.maxEntries)
  assert(a.items[`confluence-page:${ACTIVITY_LIMITS.maxEntries + 50}`], 'la más reciente se queda')
  assert(!a.items['confluence-page:1'], 'y la más vieja se va')
  eq(normalizeActivity(a, { host: HOST, now: AHORA }), a, 'idempotente')
})

// ------------------------------------------------------------ pruneActivity

test('caducidad: lo que hace más de 30 días que no se toca se va, por el ÚLTIMO toque', () => {
  const viejo = AHORA - 40 * DIA
  const a = normalizeActivity(
    {
      items: {
        'confluence-page:1': { seenAt: viejo, seenCount: 1 },
        // Vista hace 40 días pero usada como página base la semana pasada: una
        // guía que se sigue usando no caduca por cuándo se abrió la primera vez.
        'confluence-page:2': { seenAt: viejo, sourceAt: AHORA - 5 * DIA, seenCount: 1 },
        'confluence-page:3': { seenAt: viejo, analyzedAt: AHORA - 2 * DIA, analyzedCount: 1 },
        'confluence-page:4': { seenAt: AHORA - DIA, seenCount: 1 },
      },
      dismissed: { 'confluence-page:9': viejo },
    },
    { host: HOST, now: AHORA }
  )
  const p = pruneActivity(a, { host: HOST, now: AHORA })
  eq(Object.keys(p.items).sort(), ['confluence-page:2', 'confluence-page:3', 'confluence-page:4'])
  eq(pruneActivity(p, { host: HOST, now: AHORA }), p, 'idempotente')
  // Determinista: el mismo diario con el mismo reloj da el mismo JSON.
  eq(JSON.stringify(pruneActivity(a, { host: HOST, now: AHORA })), JSON.stringify(p))
})

test('caducidad: un descarte también caduca a los 30 días, y con él se va el diario entero', () => {
  // EL CAMBIO (revisión adversaria de H11): `dismissed` no caducaba nunca, así
  // que un «ya lo he visto» mantenía viva la clave del host para siempre —con 0
  // entradas dentro— y los treinta días de §8.20 no se cumplían.
  const a = normalizeActivity(
    {
      items: {},
      dismissed: { 'confluence-page:9': AHORA - 40 * DIA, 'confluence-page:10': AHORA - 10 * DIA },
    },
    { host: HOST, now: AHORA }
  )
  const p = pruneActivity(a, { host: HOST, now: AHORA })
  eq(p.dismissed, { 'confluence-page:10': AHORA - 10 * DIA }, 'el de hace 40 días se va; el de hace 10 decide todavía')
  eq(Object.keys(p.items), [])

  // Y cuando caduca el último, el diario se queda vacío del todo: es lo que
  // permite a `saveActivity` quitar la clave en vez de dejar un objeto para
  // siempre (activity-store.test.js lo comprueba contra el almacén).
  const todo = pruneActivity(a, { host: HOST, now: AHORA + 40 * DIA })
  eq(todo, { version: ACTIVITY_VERSION, host: HOST, items: {}, dismissed: {} })
  // Un descarte de algo que venía del futuro (`Math.max` en `dismissItem`) no se
  // cae por adelantado.
  const futuro = pruneActivity({ items: {}, dismissed: { [CLAVE]: AHORA + DIA } }, { host: HOST, now: AHORA })
  eq(futuro.dismissed, { [CLAVE]: AHORA + DIA })
})

// ---------------------------------------------------------------- consultas

test('lastSeen: cuándo miraste esto tú, que es lo que el servidor no sabe', () => {
  const a = recordVisit(emptyActivity(HOST), VISITA, { host: HOST, now: AHORA })
  eq(lastSeen(a, 'jira-issue', 'eng-7'), AHORA, 'la clave se reconstruye para buscar')
  eq(lastSeen(a, 'jira-issue', 'ENG-8'), 0)
  eq(lastSeen(a, 'confluence-page', '3003'), 0)
  eq(lastSeen(null, 'jira-issue', 'ENG-7'), 0)
  eq(lastSeen(a, 'jira-issue', '__proto__'), 0)
})

test('familias: lo que más analizas últimamente sube, y sin análisis no hay nada', () => {
  let a = emptyActivity(HOST)
  a = touchActivity(a, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-1', family: 'api' }, { host: HOST, now: AHORA - DIA })
  a = touchActivity(a, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-2', family: 'api' }, { host: HOST, now: AHORA - 2 * DIA })
  a = touchActivity(a, { event: 'analyzed', kind: 'jira-issue', id: 'ENG-3', family: 'bug' }, { host: HOST, now: AHORA - 3 * DIA })
  eq(preferredFamilies(a, { now: AHORA }), ['api', 'bug'])

  // Fuera de la ventana no cuenta.
  eq(preferredFamilies(a, { days: 1, now: AHORA + 5 * DIA }), [])
  eq(preferredFamilies(emptyActivity(HOST), { now: AHORA }), [])
  eq(preferredFamilies(null, { now: AHORA }), [])
  // Una visita no es un análisis.
  eq(preferredFamilies(recordVisit(emptyActivity(HOST), VISITA, { host: HOST, now: AHORA }), { now: AHORA }), [])
})
