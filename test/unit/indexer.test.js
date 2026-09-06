import { test, eq, assert } from '../harness.js'
import { extractEntities, harvestIndex } from '../../src/panel/indexer.js'
import { normalizeIndex, indexSize } from '../../src/atlassian/index-store.js'
import { shouldPlan } from '../../src/panel/planner.js'

const SITE = { host: 'acme.atlassian.net', origin: 'https://acme.atlassian.net' }

function toolPart(output) {
  return { type: 'tool', tool: 'confluence_search', state: { status: 'completed', output } }
}

test('extraer: páginas de Confluence a partir de sus URLs', () => {
  const parts = [
    toolPart('Encontrado en https://acme.atlassian.net/wiki/spaces/ENG/pages/1234567/ADR-014+Rotacion+de+tokens'),
  ]
  const r = extractEntities(parts, SITE)
  eq(r.pages.length, 1)
  eq(r.pages[0].id, '1234567')
  eq(r.pages[0].title, 'ADR-014 Rotacion de tokens')
  eq(r.pages[0].spaceKey, 'ENG')
})

test('extraer: páginas desde JSON con id y título', () => {
  const parts = [toolPart('{"results":[{"id":"998877","title":"Guía de despliegue","type":"page"}]}')]
  const r = extractEntities(parts, SITE)
  eq(r.pages.length, 1)
  eq(r.pages[0].id, '998877')
  eq(r.pages[0].title, 'Guía de despliegue')
})

test('extraer: el título real gana al marcador de posición', () => {
  const parts = [
    toolPart('/wiki/spaces/ENG/pages/555'),
    toolPart('{"id":"555","title":"El título de verdad"}'),
  ]
  const r = extractEntities(parts, SITE)
  eq(r.pages[0].title, 'El título de verdad')
})

test('extraer: incidencias de Jira con su resumen', () => {
  const parts = [toolPart('ENG-4821: Rotar los tokens de servicio\nENG-4822 - Revisar permisos')]
  const r = extractEntities(parts, SITE)
  const keys = r.issues.map((i) => i.key).sort()
  eq(keys, ['ENG-4821', 'ENG-4822'])
  eq(r.issues.find((i) => i.key === 'ENG-4821').summary, 'Rotar los tokens de servicio')
})

test('extraer: espacios', () => {
  const parts = [toolPart('Mira en /wiki/spaces/ARCH y también /wiki/spaces/ENG')]
  const r = extractEntities(parts, SITE)
  eq(r.spaces.map((s) => s.key).sort(), ['ARCH', 'ENG'])
})

test('extraer: sólo mira los resultados de herramientas, no el texto del modelo', () => {
  const parts = [{ type: 'text', text: 'Te invento la página /wiki/spaces/FAKE/pages/1/Inventada' }]
  const r = extractEntities(parts, SITE)
  eq(r.pages.length, 0)
  eq(r.spaces.length, 0)
})

test('harvest: el índice crece y no pierde lo anterior', () => {
  const base = normalizeIndex({ pages: [{ id: '1', title: 'Vieja', url: '/wiki/spaces/E/pages/1/Vieja' }] }, SITE.host)
  const parts = [toolPart('https://acme.atlassian.net/wiki/spaces/ENG/pages/2/Nueva')]
  const { index, added } = harvestIndex(parts, { site: SITE, index: base })
  eq(added, 2) // la página nueva y su espacio
  eq(indexSize(index), 3)
  assert(index.pages['1'], 'no debe perderse la anterior')
  assert(index.pages['2'], 'debe entrar la nueva')
})

test('harvest: sin nada que añadir, no toca el índice', () => {
  const base = normalizeIndex({ pages: [] }, SITE.host)
  const { added } = harvestIndex([toolPart('nada relevante aquí')], { site: SITE, index: base })
  eq(added, 0)
})

test('EL FALLO: descubrir otra vez una página no le quita el padre que ya se sabía', () => {
  // Pasó de verdad: el camino se leía de la API y, en la pregunta siguiente, la
  // misma URL en la salida de una herramienta lo pisaba con una entrada sin
  // padre. La tarjeta volvía a quedarse sin «Paso a paso».
  const conArbol = normalizeIndex(
    {
      pages: [
        { id: '3002', title: 'TCV - Domain 1 - Static Views', spaceKey: 'SIMPL', url: '/spaces/SIMPL/pages/3002/TCVStatic' },
        { id: '98830281', title: 'TCV Static - Identity Provider Service', spaceKey: 'SIMPL', parentId: '3002', url: '/spaces/SIMPL/pages/98830281/TCVIdP' },
      ],
    },
    DC.host,
    null,
    { wikiPrefix: '' }
  )
  const parts = [toolPart('Ver https://confluence.simplprogramme.eu/spaces/SIMPL/pages/98830281/TCVIdP y https://confluence.simplprogramme.eu/spaces/SIMPL/pages/555555/Otra')]
  const { index, added } = harvestIndex(parts, { site: DC, index: conArbol })
  assert(added > 0, 'la página nueva entra')
  eq(index.pages['98830281'].parentId, '3002', 'y la conocida conserva su padre')
  eq(index.pages['98830281'].spaceKey, 'SIMPL')
})

// ------------------------------------------------------------- planificador

const INDEX = normalizeIndex(
  {
    pages: [{ id: '200', title: 'ADR-014 Rotación de tokens', url: '/wiki/spaces/ENG/pages/200/ADR' }],
    issues: [{ key: 'ENG-7', title: 'Rotar tokens', url: '/browse/ENG-7' }],
  },
  SITE.host
)

test('shouldPlan: sí cuando la respuesta menciona algo del índice', () => {
  eq(shouldPlan('Lo tienes en ADR-014 Rotación de tokens, en el apartado final del documento.', INDEX), true)
})

test('shouldPlan: sí cuando aparece una clave de incidencia', () => {
  eq(shouldPlan('Eso se está tratando en ENG-7, que sigue abierto desde marzo pasado.', INDEX), true)
})

test('shouldPlan: no para respuestas cortas o sin destino', () => {
  eq(shouldPlan('Sí.', INDEX), false)
  eq(shouldPlan('No tengo ni idea de eso, lo siento mucho de verdad, prueba a preguntar a alguien.', INDEX), false)
  eq(shouldPlan('Cualquier cosa aquí pero sin índice todavía cargado en memoria del panel.', null), false)
})

// --- Data Center: rutas sin /wiki ----------------------------------------
// Caso real de confluence.simplprogramme.eu. El indexador exigia el prefijo
// /wiki, no reconocia ninguna URL del sitio, y acababa fabricando
// /wiki/spaces/~/pages/<id>, que lleva derecho a «Page Not Found».

const DC = { host: 'confluence.simplprogramme.eu', origin: 'https://confluence.simplprogramme.eu', cloud: false }

test('DC: reconoce las URLs de paginas sin /wiki', () => {
  const parts = [toolPart('https://confluence.simplprogramme.eu/spaces/SIMPL/pages/8320687/ACV+Static+-+Identity+Provider+Service')]
  const r = extractEntities(parts, DC)
  eq(r.pages.length, 1)
  eq(r.pages[0].id, '8320687')
  eq(r.pages[0].spaceKey, 'SIMPL')
  assert(!r.pages[0].url.startsWith('/wiki'), 'no debe meter /wiki en un Data Center')
})

test('DC: un id suelto produce una ruta que EXISTE, no una inventada', () => {
  const parts = [toolPart('{"id":"98830281","title":"TCV Static - Identity Provider Service"}')]
  const r = extractEntities(parts, DC)
  eq(r.pages.length, 1)
  eq(r.pages[0].url, '/pages/viewpage.action?pageId=98830281')
  assert(!r.pages[0].url.includes('/wiki'), 'sin /wiki en Data Center')
  assert(!r.pages[0].url.includes('~'), 'jamas un espacio inventado')
})

test('Cloud: el mismo id suelto lleva /wiki', () => {
  const CLOUD = { host: 'acme.atlassian.net', origin: 'https://acme.atlassian.net', cloud: true }
  const r = extractEntities([toolPart('{"id":"98830281","title":"X"}')], CLOUD)
  eq(r.pages[0].url, '/wiki/pages/viewpage.action?pageId=98830281')
})

test('el espacio «~» a secas nunca entra en el indice', () => {
  const r = extractEntities([toolPart('/spaces/~/pages/12345/Algo')], DC)
  eq(r.spaces.length, 0, 'no es un espacio real')
  eq(r.pages[0].spaceKey, null)
})

test('DC: /display/CLAVE tambien cuenta como espacio', () => {
  const r = extractEntities([toolPart('ver /display/ARCH para el detalle')], DC)
  eq(r.spaces.map((s) => s.key), ['ARCH'])
  eq(r.spaces[0].url, '/spaces/ARCH')
})

test('viewpage.action en la salida de la herramienta se reconoce', () => {
  const r = extractEntities([toolPart('enlace: /pages/viewpage.action?pageId=777888')], DC)
  eq(r.pages.map((p) => p.id), ['777888'])
})

test('el indice normalizado de un DC no inventa /wiki', () => {
  const idx = normalizeIndex(
    { pages: [{ id: '98830281', title: 'TCV' }], spaces: [{ key: 'SIMPL', name: 'SIMPL' }] },
    DC.host,
    null,
    { cloud: false }
  )
  eq(idx.pages['98830281'].path, '/pages/viewpage.action?pageId=98830281')
  eq(idx.spaces.SIMPL.path, '/spaces/SIMPL')
})

test('el indice normalizado de Cloud si lleva /wiki', () => {
  const idx = normalizeIndex(
    { pages: [{ id: '1', title: 'X' }], spaces: [{ key: 'ENG', name: 'ENG' }] },
    'acme.atlassian.net',
    null,
    { cloud: true }
  )
  eq(idx.pages['1'].path, '/wiki/pages/viewpage.action?pageId=1')
  eq(idx.spaces.ENG.path, '/wiki/spaces/ENG')
})
