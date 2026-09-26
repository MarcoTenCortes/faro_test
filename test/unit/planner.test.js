/**
 * El planificador, sin gastar turnos de modelo cuando no hacen falta.
 *
 * Lo que motivó esto: la búsqueda guiada tardaba mucho en «encontrar el paso a
 * paso». Después de cada respuesta había un turno de modelo para elegir el
 * destino y, casi siempre, OTRO para preguntar de quién colgaba —con llamadas
 * al MCP por medio—, que podía llevar minutos. Ahora:
 *
 *  - En Búsqueda, si la respuesta nombra una sola página del índice, el destino
 *    se lee de ahí y no se pregunta.
 *  - El camino se lee de la API REST del sitio (lo trae `learnAncestry`), y en
 *    modo rápido ni siquiera eso.
 */
import { test, eq, assert } from '../harness.js'
import { pickDestination, declaredDestination, currentPageId, planNavigation, jqlDestination, jqlLink, jqlPlan, JQL_LIMITS } from '../../src/panel/planner.js'
import { normalizeIndex, indexDigest } from '../../src/atlassian/index-store.js'
import { plannerPrompt } from '../../src/panel/prompts.js'

const HOST = 'confluence.simplprogramme.eu'
const ORIGIN = 'https://confluence.simplprogramme.eu'
const SITE = { host: HOST, origin: ORIGIN, cloud: false, wikiPrefix: '', pageId: '2003' }

/** El índice tal y como queda tras una respuesta: páginas sueltas, sin padres. */
const INDEX = normalizeIndex(
  {
    spaces: [{ key: 'SIMPL', name: 'SIMPL', url: '/spaces/SIMPL' }],
    pages: [
      { id: '2003', title: 'ACV Static - Identity Provider Service', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/2003/ACVIdP' },
      { id: '98830281', title: 'TCV Static - Identity Provider Service', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/98830281/TCVIdP' },
      { id: '3002', title: 'TCV - Domain 1 - Static Views', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/3002/TCVStatic' },
      { id: '1020', title: 'Memos & Meeting Notes', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/1020/Memos' },
      { id: '777', title: 'Página 777', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/777/X' },
      { id: '778', title: 'Corta', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/778/C' },
      // Títulos de una sola palabra corriente, como los hay en cualquier espacio.
      { id: '100', title: 'Arquitectura', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/100/Arquitectura' },
      { id: '400', title: 'Onboarding', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/400/Onboarding' },
      // Una página con ruta /display/, como las de un Data Center sin id en la URL.
      { id: '2004', title: 'Ficha del proveedor', spaceKey: 'SIMPL', url: '/display/SIMPL/Ficha+del+proveedor' },
    ],
    issues: [{ key: 'SIMPL-12', title: 'Revisar la TCV', url: '/browse/SIMPL-12' }],
  },
  HOST,
  null,
  { wikiPrefix: '' }
)

/** La cadena que devolvería la API para la TCV. */
const CADENA_TCV = [
  { id: '1080', title: '1080 - Architecture', parentId: null, url: '/spaces/SIMPL/pages/1080/Arch', spaceKey: 'SIMPL' },
  { id: '1081', title: '1081 - D1.3.x', parentId: '1080', url: '/spaces/SIMPL/pages/1081/D13x', spaceKey: 'SIMPL' },
  { id: '3001', title: 'Simpl-Open Technology Architecture', parentId: '1081', url: '/spaces/SIMPL/pages/3001/TechArch', spaceKey: 'SIMPL' },
  { id: '3002', title: 'TCV - Domain 1 - Static Views', parentId: '3001', url: '/spaces/SIMPL/pages/3002/TCVStatic', spaceKey: 'SIMPL' },
  { id: '98830281', title: 'TCV Static - Identity Provider Service', parentId: '3002', url: '/spaces/SIMPL/pages/98830281/TCVIdP', spaceKey: 'SIMPL' },
]

// ------------------------------------------------------- pickDestination

test('una sola página nombrada por su título completo: es el destino', () => {
  const r = pickDestination('La tienes en «TCV Static - Identity Provider Service», dentro de la rama de arquitectura tecnológica.', INDEX)
  eq(r, { kind: 'confluence-page', id: '98830281' })
})

test('el título se reconoce sin acentos ni mayúsculas, y en negrita', () => {
  const r = pickDestination('Está en **tcv static - identity provider service**.', INDEX)
  eq(r?.id, '98830281')
})

test('una sola página nombrada por su id', () => {
  eq(pickDestination('Es la página con id 98830281.', INDEX), { kind: 'confluence-page', id: '98830281' })
})

test('la página en la que ya está el usuario no cuenta', () => {
  const r = pickDestination('Estás en «ACV Static - Identity Provider Service» (2003); su TCV es la 98830281.', INDEX, { excludeId: '2003' })
  eq(r?.id, '98830281', 'la actual se descarta y queda una sola')
  eq(pickDestination('Ya estás en ACV Static - Identity Provider Service.', INDEX, { excludeId: '2003' }), null)
})

test('dos páginas distintas: no se adivina, decide el modelo', () => {
  const r = pickDestination('Puede ser «TCV Static - Identity Provider Service» o «Memos & Meeting Notes».', INDEX)
  eq(r, null)
  eq(pickDestination('Mira la página 98830281 y también la página 1020.', INDEX), null)
})

test('un título de una sola palabra sólo cuenta entre comillas o en negrita', () => {
  // «la arquitectura del sistema» no nombra la página «Arquitectura»: es una
  // palabra corriente. Pasó de verdad en la revisión: una respuesta que decía
  // que NO había nada llevaba a esa página sin preguntar al modelo.
  eq(pickDestination('No he encontrado nada concreto; la arquitectura del sistema no está documentada aquí.', INDEX), null)
  eq(pickDestination('El proceso de onboarding de proveedores se describe aparte.', INDEX), null)
  eq(pickDestination('Sigue en reonboardingxyz y punto.', INDEX), null, 'ni como trozo de otra palabra')
  eq(pickDestination('Está en «Onboarding».', INDEX)?.id, '400')
  eq(pickDestination('Está en **Onboarding**, dentro del espacio.', INDEX)?.id, '400')
  eq(pickDestination('Está en "Arquitectura".', INDEX)?.id, '100')
})

test('un título largo también respeta los límites de palabra', () => {
  eq(pickDestination('Mira xTCV - Domain 1 - Static Viewsx.', INDEX), null)
  eq(pickDestination('Mira TCV - Domain 1 - Static Views.', INDEX)?.id, '3002')
})

test('un título que es trozo de otro más largo no cuenta como candidata', () => {
  // La respuesta dice el título largo; el corto («TCV - Domain 1 - Static Views»)
  // NO está contenido en él, así que aquí hay dos de verdad. Y al revés:
  const idx = normalizeIndex(
    {
      pages: [
        { id: '1', title: 'ACV - Domain 1', url: '/spaces/S/pages/1/A' },
        { id: '2', title: 'ACV - Domain 1 - Static Views', url: '/spaces/S/pages/2/B' },
      ],
    },
    HOST,
    null,
    { wikiPrefix: '' }
  )
  eq(pickDestination('Está en ACV - Domain 1 - Static Views.', idx)?.id, '2', 'sólo la larga')
  eq(pickDestination('Está en ACV - Domain 1.', idx)?.id, '1', 'la corta a secas sigue valiendo')
})

test('una incidencia sola es destino; página e incidencia a la vez, no', () => {
  eq(pickDestination('Lo lleva SIMPL-12, que sigue abierta.', INDEX), { kind: 'jira-issue', id: 'SIMPL-12' })
  eq(pickDestination('Ver 98830281 y SIMPL-12.', INDEX), null)
  eq(pickDestination('Lo lleva SIMPL-999, que no está indexada.', INDEX), null)
})

test('EL CAMBIO: la incidencia en la que ya está el usuario no es un destino', () => {
  // En Jira la «página actual» es la incidencia abierta: el modelo la nombra
  // porque se le dice cuál es, igual que la página en Confluence.
  eq(pickDestination('Ya estás en SIMPL-12.', INDEX, { excludeId: 'SIMPL-12' }), null)
  eq(pickDestination('Ya estás en simpl-12.', INDEX, { excludeId: 'simpl-12' }), null, 'sin distinguir mayúsculas')
  const r = declaredDestination('Es la tuya.\nDestino: SIMPL-12', INDEX, { excludeId: 'SIMPL-12' })
  eq(r?.none, true)
  assert(/ya estás/.test(r.reason), r.reason)
  eq(declaredDestination('Destino: SIMPL-12', INDEX, { excludeId: '2003' })?.target?.id, 'SIMPL-12', 'un id de página no excluye una incidencia')
})

test('EL CAMBIO: en Jira, «Destino: CLAVE» lleva de golpe a la incidencia sin preguntar al modelo', async () => {
  // Es la Skill de búsqueda en Jira: JQL, claves, y una tarjeta que sólo
  // ofrece «Llévame», porque no hay árbol ni camino que leer.
  const client = fakeClient(new Error('no debería preguntarse'))
  let pedido = false
  const jira = { host: 'jira.simplprogramme.eu', origin: 'https://jira.simplprogramme.eu', cloud: false, product: 'jira', projectKey: 'SIMPL', issueKey: 'SIMPL-7' }
  const indice = normalizeIndex(
    {
      projects: [{ key: 'SIMPL', name: 'SIMPL', url: '/projects/SIMPL/summary' }],
      issues: [
        { key: 'SIMPL-7', title: 'La abierta', url: '/browse/SIMPL-7' },
        { key: 'SIMPL-12', title: 'Revisar la TCV', url: '/browse/SIMPL-12' },
      ],
    },
    jira.host
  )
  const { plan, source, reason } = await planNavigation(client, base({
    site: jira,
    index: indice,
    origin: jira.origin,
    host: jira.host,
    here: jira.origin + '/browse/SIMPL-7',
    answer: 'JQL: project = SIMPL AND text ~ "TCV". Lo trata SIMPL-12 (Revisar la TCV), en curso; la tuya, SIMPL-7, sólo la menciona.\n\nDestino: SIMPL-12',
    learnAncestry: async () => ((pedido = true), CADENA_TCV),
  }))
  assert(plan, reason)
  eq(source, 'respuesta')
  eq(plan.destination, { kind: 'jira-issue', id: 'SIMPL-12', title: 'Revisar la TCV', path: '/browse/SIMPL-12', url: 'https://jira.simplprogramme.eu/browse/SIMPL-12' })
  eq(plan.steps.map((s) => s.id), ['SIMPL-12'], 'un salto único: el proyecto no es un paso')
  eq(plan.mode, 'direct')
  eq(pedido, false, 'y no se lee ningún árbol')
  eq(client.calls.sessions, 0)

  // La incidencia abierta como destino declarado: nada que ofrecer.
  const misma = await planNavigation(client, base({ site: jira, index: indice, origin: jira.origin, host: jira.host, here: jira.origin + '/browse/SIMPL-7', answer: 'Es esa.\nDestino: SIMPL-7' }))
  eq(misma.plan, undefined)
  assert(/ya estás/.test(misma.reason), misma.reason)
})

test('títulos cortos y números sueltos no engañan', () => {
  // «Corta» tiene menos de ocho letras; 2024 y 1.2.25 no son ids del índice.
  eq(pickDestination('Es corta, de 2024, versión 1.2.25, y no dice más.', INDEX), null)
  eq(pickDestination('', INDEX), null)
  eq(pickDestination('lo que sea', null), null)
})

test('un id corto sólo cuenta si va presentado como id; uno largo, siempre', () => {
  // La 777 sólo se conoce como «Página 777»: por título no se casa nunca, pero
  // el número es un id real del índice si el modelo lo escribe como tal.
  eq(pickDestination('Está en la página 777.', INDEX), { kind: 'confluence-page', id: '777' })
  eq(pickDestination('Es la de id 777.', INDEX)?.id, '777')
  eq(pickDestination('Es la de pageId=1020, creo.', INDEX)?.id, '1020')
  eq(pickDestination('Cuelga de /pages/1020/Memos.', INDEX)?.id, '1020')
  eq(pickDestination('Está en la 777.', INDEX), null, 'un número suelto de tres cifras no es un id')
  eq(pickDestination('Se creó en el sprint 1020 de 2024.', INDEX), null)
  eq(pickDestination('Es la 98830281.', INDEX)?.id, '98830281', 'con cinco cifras o más no hay confusión posible')
})

// --------------------------------------------------- declaredDestination

test('la línea «Destino:» manda, y se lee la última línea de la respuesta', () => {
  const r = declaredDestination(
    'Candidatas: «TCV - Domain 1 - Static Views» (id 3002) y «TCV Static - Identity Provider Service» (id 98830281).\n\nDestino: TCV Static - Identity Provider Service (id 98830281)\n\n',
    INDEX
  )
  eq(r, { target: { kind: 'confluence-page', id: '98830281' } })
  eq(declaredDestination('Destino: SIMPL-12', INDEX)?.target, { kind: 'jira-issue', id: 'SIMPL-12' })
})

test('la etiqueta se reconoce con el marcado que suelen poner los modelos', () => {
  for (const linea of [
    '**Destino:** «Memos & Meeting Notes» (id: 1020)',
    '**Destino**: Memos & Meeting Notes (id 1020)',
    '__Destino__: Memos & Meeting Notes (id 1020)',
    '`Destino`: Memos & Meeting Notes (id 1020)',
    '### Destino: Memos & Meeting Notes (id 1020)',
    '1. Destino: Memos & Meeting Notes (id 1020)',
    '- Destino: Memos & Meeting Notes (id 1020)',
    '  destino : Memos & Meeting Notes (ID 1020).',
  ]) {
    eq(declaredDestination('Lo encontré.\n' + linea, INDEX)?.target?.id, '1020', linea)
  }
  eq(declaredDestination('**Destino**: ninguno', INDEX), { none: true })
  eq(declaredDestination('Destino: **ninguna**', INDEX), { none: true })
})

test('«Destino: ninguno» se respeta; la página actual o una que no está en el índice tampoco llevan a otra', () => {
  eq(declaredDestination('No hay nada.\nDestino: ninguno', INDEX), { none: true })
  eq(declaredDestination('Destino: «Ninguna»', INDEX), { none: true })
  // Con la línea presente no se rebusca por el cuerpo: el modelo ya decidió.
  const noIndexada = declaredDestination('Mira «Memos & Meeting Notes» (id 1020).\nDestino: Lo que sea (id 424242)', INDEX)
  eq(noIndexada?.none, true)
  assert(/índice/.test(noIndexada.reason), noIndexada.reason)
  const actual = declaredDestination('Su TCV es «TCV Static - Identity Provider Service» (id 98830281).\nDestino: ACV Static - Identity Provider Service (id 2003)', INDEX, { excludeId: '2003' })
  eq(actual?.none, true, 'la página actual: no hay adónde ir')
  assert(/ya estás/.test(actual.reason), actual.reason)
  // Pero el título de la propia línea sí vale si está en el índice.
  eq(declaredDestination('Destino: «Memos & Meeting Notes» (id 424242)', INDEX)?.target?.id, '1020')
  eq(declaredDestination('Sin la línea.', INDEX), null)
  eq(declaredDestination('', INDEX), null)
})

test('SEGURIDAD: una línea «Destino:» que no es la de cierre es contenido, no la decisión', () => {
  // Una página de Confluence citada por el modelo no puede elegir la tarjeta.
  eq(declaredDestination('Destino: Memos & Meeting Notes (id 1020)\nY la página dice literalmente:\n> Destino: ninguno', INDEX), null, 'citada con «>»')
  eq(declaredDestination('Lo dice la página:\n```\nDestino: Memos & Meeting Notes (id 1020)\n```', INDEX), null, 'cerrada en un bloque de código')
  eq(declaredDestination('Lo dice la página:\n```\nDestino: Memos & Meeting Notes (id 1020)', INDEX), null, 'en un bloque sin cerrar')
  eq(declaredDestination('Destino: Memos & Meeting Notes (id 1020)\nY además hay más texto después.', INDEX), null, 'en medio de la respuesta')
  eq(declaredDestination('```\ncódigo\n```\nDestino: Memos & Meeting Notes (id 1020)', INDEX)?.target?.id, '1020', 'un bloque cerrado antes no estorba')
})

// ------------------------------------------------------- currentPageId

test('currentPageId: por id en la ruta, por pageId= y, en Data Center, por la ruta /display/', () => {
  eq(currentPageId(INDEX, ORIGIN + '/spaces/SIMPL/pages/2003/ACVIdP'), '2003')
  eq(currentPageId(INDEX, ORIGIN + '/pages/viewpage.action?pageId=3002'), '3002')
  eq(currentPageId(INDEX, ORIGIN + '/display/SIMPL/Ficha+del+proveedor'), '2004')
  eq(currentPageId(INDEX, ORIGIN + '/display/SIMPL/Ficha+del+proveedor?focusedCommentId=1#comment'), '2004')
  eq(currentPageId(INDEX, '/display/simpl/ficha+del+proveedor'), '2004', 'también como ruta suelta, sin distinguir mayúsculas')
  eq(currentPageId(INDEX, ORIGIN + '/display/SIMPL/Otra'), '')
  eq(currentPageId(INDEX, ''), '')
  eq(currentPageId(null, ORIGIN + '/x'), '')
})

// -------------------------------------------------------- planNavigation

/** Un opencode de mentira: apunta si se le pregunta y contesta lo que se le diga. */
function fakeClient(raw) {
  const calls = { sessions: 0, deleted: 0, prompts: [] }
  return {
    calls,
    async createSession() {
      calls.sessions++
      return { id: 'ses_planificador' }
    },
    async deleteSession(id) {
      calls.deleted++
      eq(id, 'ses_planificador')
    },
    async promptStructured(id, req) {
      calls.prompts.push({ id, req })
      if (raw instanceof Error) throw raw
      return raw
    },
  }
}

const RESPUESTA_TCV = 'Su TCV correspondiente es «TCV Static - Identity Provider Service» (id 98830281), en la rama de Technology Architecture.'

function base(overrides = {}) {
  return {
    model: { providerID: 'p', modelID: 'm' },
    question: '¿Esta ACV tiene su TCV correspondiente?',
    answer: RESPUESTA_TCV,
    index: INDEX,
    origin: ORIGIN,
    host: HOST,
    site: SITE,
    here: ORIGIN + '/spaces/SIMPL/pages/2003/ACVIdP',
    force: true,
    navMode: 'guided',
    ...overrides,
  }
}

test('EL CAMBIO: en Búsqueda, con una sola página en la respuesta, no se pregunta al modelo', async () => {
  const client = fakeClient(new Error('no debería preguntarse'))
  const pedidos = []
  const { plan, source, reason } = await planNavigation(client, base({ learnAncestry: async (d) => (pedidos.push(d.id), CADENA_TCV) }))
  assert(plan, reason)
  eq(source, 'respuesta')
  eq(plan.destination.id, '98830281')
  eq(client.calls.sessions, 0, 'ni siquiera se abre la sesión del planificador')
  eq(client.calls.prompts.length, 0)
  eq(pedidos, ['98830281'], 'y el camino se pide una vez, para el destino')
})

test('guiada: el camino de la API completa los pasos, y el índice se guarda enriquecido', async () => {
  let guardado = null
  const { plan } = await planNavigation(fakeClient(null), base({
    learnAncestry: async () => CADENA_TCV,
    onIndex: async (idx) => (guardado = idx),
  }))
  eq(plan.steps.map((s) => s.id), ['1080', '1081', '3001', '3002', '98830281'], 'estando en el espacio, sin el salto a su portada')
  eq(plan.steps.map((s) => s.action), ['expand', 'expand', 'expand', 'expand', 'open'])
  eq(plan.mode, 'assisted')
  assert(guardado, 'debe avisar del índice enriquecido')
  eq(guardado.pages['98830281'].parentId, '3002')
  eq(guardado.pages['1080'].parentId, null)
  eq(guardado.pages['1081'].title, '1081 - D1.3.x')
  assert(guardado.pages['2003'], 'lo que ya había no se pierde')
})

test('rápida: no se lee el árbol, y el plan sale con el destino a secas', async () => {
  let pedido = false
  const { plan, source } = await planNavigation(fakeClient(null), base({
    navMode: 'quick',
    learnAncestry: async () => ((pedido = true), CADENA_TCV),
  }))
  eq(pedido, false, 'en modo rápido no se gasta ni una petición')
  eq(source, 'respuesta')
  eq(plan.steps.map((s) => s.id), ['98830281'])
  eq(plan.mode, 'direct')
})

test('si el camino no se puede leer, se lleva de golpe: nada de inventar', async () => {
  for (const learnAncestry of [async () => null, async () => [], async () => { throw new Error('API caída') }, undefined]) {
    const { plan, reason } = await planNavigation(fakeClient(null), base({ learnAncestry }))
    assert(plan, reason)
    eq(plan.steps.map((s) => s.id), ['98830281'])
    eq(plan.mode, 'direct')
  }
})

test('con la línea «Destino:» se listan varias candidatas y aun así no se pregunta', async () => {
  const client = fakeClient(new Error('no debería preguntarse'))
  const { plan, source, reason } = await planNavigation(client, base({
    answer: [
      'Hay dos candidatas: «TCV - Domain 1 - Static Views» (id 3002) y «TCV Static - Identity Provider Service» (id 98830281).',
      'La segunda es la equivalente exacta.',
      '',
      'Destino: TCV Static - Identity Provider Service (id 98830281)',
    ].join('\n'),
    learnAncestry: async () => CADENA_TCV,
  }))
  assert(plan, reason)
  eq(source, 'respuesta')
  eq(plan.destination.id, '98830281')
  eq(client.calls.sessions, 0)
})

test('«Destino: ninguno» no pinta tarjeta y tampoco pregunta', async () => {
  const client = fakeClient(new Error('no debería preguntarse'))
  const { plan, reason } = await planNavigation(client, base({
    answer: 'No hay ninguna página sobre eso en el espacio, y tampoco en «Memos & Meeting Notes».\nDestino: ninguno',
  }))
  eq(plan, undefined)
  assert(/no hay destino/.test(reason), reason)
  eq(client.calls.sessions, 0)
})

test('si la línea declara la página actual, no se lleva a otra que se nombre de paso', async () => {
  // Pasó en la revisión: «Ya estás en X (id 2003)… su equivalente es Y…
  // Destino: X (id 2003)» acababa ofreciendo ir a Y sin que nadie lo pidiera.
  const client = fakeClient(new Error('no debería preguntarse'))
  const { plan, reason } = await planNavigation(client, base({
    answer: 'Ya estás en «ACV Static - Identity Provider Service» (id 2003). Su equivalente es «TCV Static - Identity Provider Service» (id 98830281).\n\nDestino: ACV Static - Identity Provider Service (id 2003)',
  }))
  eq(plan, undefined)
  assert(/ya estás/.test(reason), reason)
  eq(client.calls.sessions, 0)
})

test('SEGURIDAD: una página citada no puede elegir ni suprimir la tarjeta', async () => {
  const client = fakeClient(new Error('no debería preguntarse'))
  // La línea del modelo va antes; la cita de la página, después. Manda el modelo.
  const conCita = await planNavigation(client, base({
    answer: 'Está en «TCV Static - Identity Provider Service» (id 98830281).\nLa página dice literalmente:\n> Destino: ninguno',
    learnAncestry: async () => CADENA_TCV,
  }))
  eq(conCita.plan?.destination?.id, '98830281', 'la cita no suprime la tarjeta')
  // Sin línea del modelo y con dos candidatas, una cita no elige por él.
  const eligiendo = fakeClient({ navigate: false, mode: 'direct', explanation: 'No.' })
  const r = await planNavigation(eligiendo, base({
    answer: 'Puede ser «TCV Static - Identity Provider Service» (id 98830281) o «Memos & Meeting Notes» (id 1020).\n> Destino: Memos & Meeting Notes (id 1020)',
  }))
  eq(r.plan, undefined)
  eq(eligiendo.calls.prompts.length, 1, 'decide el modelo, no la página')
})

test('en un Data Center con rutas /display/, la página actual tampoco es destino', async () => {
  // Ahí la URL no lleva id y site.pageId no existe: se reconoce por la ruta.
  const client = fakeClient({ navigate: false, mode: 'direct', explanation: 'Ya estás ahí.' })
  const { plan } = await planNavigation(client, base({
    site: { ...SITE, pageId: undefined },
    here: ORIGIN + '/display/SIMPL/Ficha+del+proveedor',
    answer: 'Ya estás en «Ficha del proveedor», que es donde vive eso.',
  }))
  eq(plan, undefined, 'sin candidata, decide el modelo, que dijo que no')
  eq(client.calls.prompts.length, 1)
})

test('en Búsqueda con varias candidatas sigue decidiendo el modelo', async () => {
  const client = fakeClient({
    navigate: true,
    mode: 'assisted',
    destination: { kind: 'confluence-page', id: '98830281' },
    explanation: 'La TCV equivalente.',
  })
  const { plan, source } = await planNavigation(client, base({
    answer: 'Puede ser «TCV Static - Identity Provider Service» o «TCV - Domain 1 - Static Views».',
    learnAncestry: async () => CADENA_TCV,
  }))
  eq(source, 'modelo')
  eq(client.calls.prompts.length, 1)
  eq(client.calls.sessions, 1)
  eq(client.calls.deleted, 1, 'la sesión desechable se borra')
  eq(plan.destination.id, '98830281')
  eq(plan.explanation, 'La TCV equivalente.')
  eq(plan.steps.length, 5, 'y el camino también se lee para lo que decide el modelo')
})

test('en General decide el modelo, aunque la respuesta nombre una sola página', async () => {
  const client = fakeClient({ navigate: false, mode: 'direct', explanation: 'No hace falta ir a ningún sitio.' })
  const { plan, reason } = await planNavigation(client, base({ force: false }))
  eq(plan, undefined)
  assert(/no hay destino/.test(reason), reason)
  eq(client.calls.prompts.length, 1)
})

test('en General, una respuesta que no apunta a nada ni siquiera pregunta', async () => {
  const client = fakeClient(new Error('no'))
  const { reason } = await planNavigation(client, base({ force: false, answer: 'Sí, claro que sí, sin ninguna duda al respecto.' }))
  assert(/no apunta/.test(reason), reason)
  eq(client.calls.sessions, 0)
})

test('un fallo del modelo o de la sesión no rompe: se devuelve el motivo', async () => {
  const roto = fakeClient(new Error('El modelo se quedó colgado'))
  const r1 = await planNavigation(roto, base({ answer: 'Puede ser la página 98830281 o la página 1020.' }))
  eq(r1.plan, undefined)
  assert(/colgado/.test(r1.reason))
  eq(roto.calls.deleted, 1, 'la sesión se borra aunque falle')

  const sinSesion = { createSession: async () => { throw new Error('502') }, promptStructured: async () => ({}), deleteSession: async () => {} }
  const r2 = await planNavigation(sinSesion, base({ answer: 'Puede ser la página 98830281 o la página 1020.' }))
  assert(/sesión/.test(r2.reason), r2.reason)
})

test('el camino sólo se pide para páginas de Confluence, no para incidencias', async () => {
  let pedido = false
  const { plan } = await planNavigation(fakeClient(null), base({
    answer: 'Lo lleva SIMPL-12.',
    learnAncestry: async () => ((pedido = true), CADENA_TCV),
  }))
  eq(plan.destination.kind, 'jira-issue')
  eq(pedido, false)
})

test('SEGURIDAD: una cadena de la API con ids raros no cuela nada en el índice', async () => {
  let guardado = null
  const sucia = [
    { id: 'javascript:x', title: 'mal', parentId: null, url: '/x' },
    { id: '3002', title: 'TCV - Domain 1 - Static Views', parentId: null, url: 'https://malicioso.example/robar' },
    { id: '98830281', title: 'TCV', parentId: '3002', url: '/spaces/SIMPL/pages/98830281/TCVIdP' },
  ]
  const { plan } = await planNavigation(fakeClient(null), base({
    learnAncestry: async () => sucia,
    onIndex: async (idx) => (guardado = idx),
  }))
  assert(!JSON.stringify(guardado).includes('malicioso'), 'la ruta externa se descarta entera')
  assert(!guardado.pages['javascript:x'])
  assert(plan.steps.every((s) => s.url.startsWith(ORIGIN)), 'ningún paso sale del sitio')
})

test('EL CAMBIO: donde ya estás nunca es destino, tampoco cuando decide el modelo', () => {
  // En Jira el modelo nombra la clave abierta en casi toda respuesta (se le
  // dice cuál es y se le manda citarla), así que la heurística dispara y el
  // planificador la elegía: tarjeta «Llévame a SIMPL-7» estando en SIMPL-7.
  const jira = { host: 'jira.x', origin: 'https://jira.x', cloud: false, product: 'jira', issueKey: 'SIMPL-7' }
  const indice = normalizeIndex(
    { issues: [{ key: 'SIMPL-7', title: 'La abierta', url: '/browse/SIMPL-7' }] },
    'jira.x'
  )
  const client = fakeClient({
    navigate: true,
    mode: 'direct',
    destination: { kind: 'jira-issue', id: 'SIMPL-7' },
    explanation: 'Ahí lo tienes.',
  })
  return planNavigation(client, base({
    site: jira,
    index: indice,
    origin: jira.origin,
    host: jira.host,
    here: jira.origin + '/browse/SIMPL-7',
    force: false,
    answer: 'Eso está en SIMPL-7, que es la incidencia que tienes delante, y lleva abierta desde marzo.',
  })).then(({ plan, reason }) => {
    eq(plan, undefined)
    assert(/ya estás/.test(reason), reason)
    // Y al planificador se le dice dónde está el usuario, para que no la elija.
    assert(/YA está en SIMPL-7/.test(client.calls.prompts[0].req.text), client.calls.prompts[0].req.text.slice(-200))
  })
})

// ---------------------------------------------------------- jqlDestination

/** Una llamada a jira_search tal como la deja el turno, con su salida. */
function busquedaJira(jql, output) {
  return { type: 'tool', tool: 'atlassian-jira-x-eu_jira_search', state: { status: 'completed', input: { jql, limit: 20 }, output } }
}

test('EL CAMBIO: en Jira el destino es la búsqueda que produjo la lista, leída de la llamada real a jira_search', () => {
  // Lo que responde a «¿dónde está lo de Kafka?» no es un ticket: es la lista,
  // y vive en el buscador con su JQL. La consulta sale de la herramienta, no
  // de la prosa: un modelo que escribe una JQL y llama con otra no manda al
  // usuario a una lista que no ha visto.
  const parts = [
    { type: 'text', text: 'JQL: project = SIMPL AND text ~ "inventada"' },
    busquedaJira('project = SIMPL AND text ~ "kafka"', JSON.stringify({ total: 3, issues: [{ key: 'SIMPL-1' }, { key: 'SIMPL-2' }, { key: 'SIMPL-3' }] })),
  ]
  const r = jqlDestination(parts, { origin: 'https://jira.x.eu' })
  eq(r.jql, 'project = SIMPL AND text ~ "kafka"')
  eq(r.count, 3)
  eq(r.path, '/issues/?jql=' + encodeURIComponent('project = SIMPL AND text ~ "kafka"'))
  eq(r.url, 'https://jira.x.eu' + r.path)
})

test('jqlDestination: se queda con la ÚLTIMA búsqueda con resultados; sin resultados no hay destino', () => {
  const vacia = JSON.stringify({ total: 0, issues: [] })
  const conAlgo = JSON.stringify({ total: 2, issues: [{ key: 'A-1' }, { key: 'A-2' }] })
  // El modelo afina: la primera dio dos, la segunda nada. La lista que enseñó es la primera.
  eq(jqlDestination([busquedaJira('project = A', conAlgo), busquedaJira('project = A AND status = Done', vacia)], { origin: 'https://j' }).jql, 'project = A')
  // Y al revés: la segunda es la buena.
  eq(jqlDestination([busquedaJira('project = A AND x', vacia), busquedaJira('project = A', conAlgo)], { origin: 'https://j' }).jql, 'project = A')
  eq(jqlDestination([busquedaJira('project = A', vacia)], { origin: 'https://j' }), null, 'como «Destino: ninguno»')
  eq(jqlDestination([], { origin: 'https://j' }), null)
  eq(jqlDestination(null, { origin: 'https://j' }), null)
})

test('jqlDestination: cuenta resultados aunque la salida no sea el JSON esperado, y sólo mira jira_search', () => {
  const texto = busquedaJira('project = ENG', 'Encontradas: ENG-1 Rotar tokens, ENG-2 Revisar permisos, ENG-1 otra vez')
  eq(jqlDestination([texto], { origin: 'https://j' }).count, 2, 'claves distintas')
  const otra = { type: 'tool', tool: 'x_jira_get_issue', state: { input: { issue_key: 'ENG-1', jql: 'project = ENG' }, output: '{"total": 5}' } }
  eq(jqlDestination([otra], { origin: 'https://j' }), null, 'una herramienta que no es la búsqueda no cuenta')
  eq(jqlDestination([busquedaJira('', '{"total":5}')], { origin: 'https://j' }), null, 'sin consulta no hay destino')
})

test('SEGURIDAD: la consulta entra en la URL codificada, en una línea y con tope; la URL es siempre la del origen', () => {
  const sucia = 'project = A\nAND summary ~ "x" -- ' + '#'.repeat(3000)
  const r = jqlDestination([busquedaJira(sucia, '{"total":1}')], { origin: 'https://jira.x.eu/' })
  assert(!r.jql.includes('\n'), 'una línea')
  eq(r.jql.length, JQL_LIMITS.maxChars, 'con tope')
  assert(r.url.startsWith('https://jira.x.eu/issues/?jql='), 'contra el origen, sin barra doble')
  assert(!r.url.includes('#') && !r.url.includes(' '), 'codificada')
  // Ni una URL ni un salto de origen escondido en la consulta cambian el destino.
  const tramposa = jqlDestination([busquedaJira('https://malicioso.example/?x', '{"total":1}')], { origin: 'https://jira.x.eu' })
  assert(tramposa.url.startsWith('https://jira.x.eu/issues/?jql=https%3A%2F%2Fmalicioso'), tramposa.url)
  eq(jqlDestination([busquedaJira('project = A', '{"total":1}')], {}), null, 'sin origen no hay URL')
})

test('EL CAMBIO: planNavigation en Jira devuelve la búsqueda sin índice, sin árbol y sin preguntar', async () => {
  const client = fakeClient(new Error('no debería preguntarse'))
  const jira = { host: 'jira.x.eu', origin: 'https://jira.x.eu', cloud: false, product: 'jira', issueKey: 'SIMPL-7' }
  const parts = [busquedaJira('project = SIMPL AND text ~ "kafka"', '{"total":4,"issues":[{"key":"SIMPL-1"}]}')]
  const { plan, source } = await planNavigation(client, base({ site: jira, index: null, origin: jira.origin, host: jira.host, parts, answer: 'Cuatro tickets hablan de Kafka.' }))
  eq(source, 'jql')
  eq(plan.destination.kind, 'jira-jql')
  eq(plan.destination.url, 'https://jira.x.eu/issues/?jql=' + encodeURIComponent('project = SIMPL AND text ~ "kafka"'))
  eq(plan.destination.title, 'Los 4 resultados de la búsqueda en Jira')
  eq(plan.steps.map((s) => s.action), ['open'], 'un solo paso')
  eq(plan.mode, 'direct')
  eq(plan.explanation, 'project = SIMPL AND text ~ "kafka"', 'la consulta se enseña en la tarjeta')
  eq(client.calls.sessions, 0)

  // Sin búsqueda en el turno, todo sigue como antes: la clave de la respuesta.
  const indice = normalizeIndex({ issues: [{ key: 'SIMPL-12', title: 'Revisar', url: '/browse/SIMPL-12' }] }, jira.host)
  const sinBusqueda = await planNavigation(client, base({ site: jira, index: indice, origin: jira.origin, host: jira.host, parts: [], answer: 'Es SIMPL-12.\nDestino: SIMPL-12' }))
  eq(sinBusqueda.source, 'respuesta')
  eq(sinBusqueda.plan.destination.kind, 'jira-issue')
  // Y en Confluence una búsqueda de Jira que hubiera hecho el modelo no manda a ningún sitio de este host.
  const desdeConfluence = await planNavigation(fakeClient(null), base({ parts, learnAncestry: async () => CADENA_TCV }))
  eq(desdeConfluence.source, 'respuesta')
})

// ------------------------------------------- una consulta propia (H8)

test('H8: jqlLink monta la URL de una consulta propia igual que la de una del modelo', () => {
  const r = jqlLink('project = ENG AND labels = api', { origin: 'https://jira.x.eu/' })
  eq(r.jql, 'project = ENG AND labels = api')
  eq(r.count, 0, 'todavía no se ha ejecutado: el título lo pone quien la pinte')
  eq(r.url, 'https://jira.x.eu/issues/?jql=' + encodeURIComponent('project = ENG AND labels = api'), 'contra el origen, sin barra doble')
  eq(r.path, '/issues/?jql=' + encodeURIComponent('project = ENG AND labels = api'))
  // La misma cola que `jqlDestination`: una sola forma de montar esa dirección.
  const delModelo = jqlDestination([busquedaJira('project = ENG AND labels = api', '{"total":1}')], { origin: 'https://jira.x.eu' })
  eq(r.url, delModelo.url)
  // SEGURIDAD: una línea, con tope y codificada, venga como venga el chip.
  const sucia = jqlLink('project = A\nAND summary ~ "x" #' + '#'.repeat(3000), { origin: 'https://jira.x.eu' })
  assert(!sucia.jql.includes('\n') && sucia.jql.length === JQL_LIMITS.maxChars)
  assert(!sucia.url.includes('#') && !sucia.url.includes(' '))
  for (const malo of [null, undefined, '', '   ', 7]) eq(jqlLink(malo, { origin: 'https://jira.x.eu' }), null, JSON.stringify(malo))
  eq(jqlLink('project = ENG', {}), null, 'sin origen no hay URL')
  eq(jqlLink('project = ENG'), null)
})

test('H8: jqlPlan admite el epígrafe y el título de una búsqueda directa, y sin ellos no cambia', () => {
  const destino = jqlLink('project = ENG AND assignee = currentUser()', { origin: 'https://jira.x.eu' })
  const directa = jqlPlan(destino, { kicker: 'Búsqueda directa', title: 'Mis abiertas de ENG' })
  eq(directa.kicker, 'Búsqueda directa')
  eq(directa.destination.title, 'Mis abiertas de ENG')
  eq(directa.steps.map((s) => s.label), ['Mis abiertas de ENG'], 'el paso dice lo mismo que la tarjeta')
  eq(directa.destination.kind, 'jira-jql')
  eq(directa.mode, 'direct')
  eq(directa.explanation, destino.jql, 'la consulta se enseña, como en la del modelo')
  // Sin opciones, byte a byte lo de siempre (y sin `kicker`, para que la
  // tarjeta siga diciendo «Puedo llevarte»).
  const delModelo = jqlPlan({ jql: 'project = ENG', count: 4, path: '/p', url: 'https://jira.x.eu/p' })
  eq(delModelo.destination.title, 'Los 4 resultados de la búsqueda en Jira')
  eq('kicker' in delModelo, false)
  eq(JSON.stringify(delModelo), JSON.stringify(jqlPlan({ jql: 'project = ENG', count: 4, path: '/p', url: 'https://jira.x.eu/p' }, {})))
  eq(jqlPlan({ jql: 'x', count: 1, path: '/p', url: 'u' }).destination.title, 'El resultado de la búsqueda en Jira')
})

test('H21: el planificador ve delante las páginas del espacio de la pestaña, sin excluir las demás', async () => {
  // El índice de un host guarda varios espacios (docs/PLAN2.md §3.4) y el
  // digest que ve el planificador se acota a 60 títulos: sin `preferSpace` las
  // trescientas páginas de otro espacio le quitaban el sitio a las diez del que
  // el usuario tiene abierto. El pin es sobre lo que DE VERDAD se manda: el
  // texto del turno del planificador, con el cliente falso.
  const dosEspacios = normalizeIndex(
    {
      spaces: [{ key: 'SIMPL', name: 'SIMPL', url: '/spaces/SIMPL' }, { key: 'OPS', name: 'Operaciones', url: '/spaces/OPS' }],
      pages: [
        { id: '2003', title: 'ACV Static - Identity Provider Service', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/2003/ACVIdP' },
        { id: '1020', title: 'Memos & Meeting Notes', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/1020/Memos' },
        { id: '100', title: 'Arquitectura', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/100/Arquitectura' },
        { id: '5001', title: 'Runbooks', spaceKey: 'OPS', url: '/spaces/OPS/pages/5001/Runbooks' },
        { id: '5002', title: 'Guardias', spaceKey: 'OPS', url: '/spaces/OPS/pages/5002/Guardias' },
      ],
    },
    HOST,
    null,
    { wikiPrefix: '' }
  )
  // Una respuesta que no nombra ninguna página: el planificador tiene que preguntar.
  const answer = 'Depende de lo que busques; hay varias notas repartidas.'
  const enOps = { ...SITE, product: 'confluence', spaceKey: 'OPS' }
  const client = fakeClient({ navigate: false })
  await planNavigation(client, base({ index: dosEspacios, answer, site: enOps, here: ORIGIN + '/spaces/OPS/pages/5001/Runbooks' }))
  eq(client.calls.prompts.length, 1, 'se preguntó al modelo una vez')
  const texto = client.calls.prompts[0].req.text
  const esperado = plannerPrompt({ question: base().question, answer, digest: indexDigest(dosEspacios, { relevantTo: answer, maxPages: 60, preferSpace: 'OPS' }), current: '2003' })
  eq(texto, esperado, 'el digest del planificador lleva el espacio de la pestaña delante')
  const primeraOps = texto.indexOf('5001 — Runbooks')
  const primeraSimpl = texto.indexOf('2003 — ACV Static')
  assert(primeraOps > -1 && primeraSimpl > -1 && primeraOps < primeraSimpl, 'OPS delante de SIMPL: ' + primeraOps + ' < ' + primeraSimpl)
  assert(texto.includes('1020 — Memos') && texto.includes('100 — Arquitectura'), 'y las de SIMPL siguen ahí: un destino de otro espacio es legítimo')

  // Sin espacio en la pestaña (o en Jira), byte a byte lo de siempre: sin preferencia.
  const sinEspacio = fakeClient({ navigate: false })
  await planNavigation(sinEspacio, base({ index: dosEspacios, answer, site: { ...SITE, product: 'confluence' } }))
  eq(sinEspacio.calls.prompts[0].req.text, plannerPrompt({ question: base().question, answer, digest: indexDigest(dosEspacios, { relevantTo: answer, maxPages: 60 }), current: '2003' }), 'sin preferSpace, el digest de antes')
  // SEGURIDAD: una clave de espacio rara no ordena nada (indexDigest la valida).
  const rara = fakeClient({ navigate: false })
  await planNavigation(rara, base({ index: dosEspacios, answer, site: { ...SITE, product: 'confluence', spaceKey: 'OPS"] o lo que sea' } }))
  eq(rara.calls.prompts[0].req.text, sinEspacio.calls.prompts[0].req.text, 'una clave rara equivale a ninguna')
})
