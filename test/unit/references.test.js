/**
 * Las páginas de referencia del sitio (src/panel/references.js).
 *
 * EL CAMBIO: el CONTEXT.md ya dice en prosa dónde vive cada cosa, y desde H9 el
 * indexador de Confluence pide nombrar cada página de referencia «por su título
 * exacto y su id numérico» (el de Jira lo pedía desde antes). Leer esos ids
 * cuesta microsegundos y permite sugerir la guía que toca sin gastar un token
 * (docs/PLAN.md §3.2).
 *
 * NO SE GUARDA NADA: PLAN §3.2 descartó la lista estructurada del indexador, así
 * que no hay clave de almacenamiento —una que nadie escribiera sería una promesa
 * falsa— y por eso el objeto no lleva `version` ni `updated`. Se recalcula al
 * vuelo desde el CONTEXT.md que el panel ya tiene cargado.
 *
 * Lo que más se vigila: que un número cualquiera no se tome por un id (tres
 * cifras no, una clave de incidencia no, un `pageId=abc` no) y las claves
 * exactas, porque de aquí salen títulos de Confluence.
 */
import { test, eq, assert } from '../harness.js'
import {
  REFERENCE_LIMITS,
  REFERENCE_ROLES,
  emptyReferences,
  normalizeReferences,
  referencesFromContext,
  roleForFamily,
} from '../../src/panel/references.js'
import { ISSUE_FAMILIES } from '../../src/panel/issue-profile.js'
import { SOURCE_LIMITS } from '../../src/panel/sources.js'
import { normalizeIndex } from '../../src/atlassian/index-store.js'

const HOST = 'confluence.simplprogramme.eu'
const INDICE = normalizeIndex(
  {
    pages: [
      { id: '456789', title: 'Guía de API del programa', spaceKey: 'ENG', url: '/pages/456789' },
      { id: '456790', title: 'Runbook de guardia', spaceKey: 'ENG', url: '/pages/456790' },
      { id: '456791', title: 'ADR-014 Rotación de tokens', spaceKey: 'ENG', url: '/pages/456791' },
    ],
  },
  HOST,
  { kind: 'space', key: 'ENG' }
)

/** Un CONTEXT.md como los que escribe el indexador, con su apartado 4. */
const CONTEXTO = [
  '# Contexto de ENG',
  '',
  'Esta zona trata de la plataforma. Hay 14 espacios y nadie sabe cuál es cuál.',
  '',
  '## 4. Dónde vive cada cosa',
  '- Las convenciones de API están en «Guía de API del programa» (id 456789).',
  '- Nada que ver aquí: la incidencia SIMPL-1234, el id 123 y un pageId=abc.',
  '',
  '**Procesos**',
  '- **Runbook de guardia** — /pages/456790',
  '- Las decisiones se registran como ADR: «ADR-014 Rotación de tokens» (pageId=456791)',
].join('\n')

// ---- la forma ---------------------------------------------------------------

test('los papeles son los declarados, y el cajón «otra» va el último', () => {
  eq(REFERENCE_ROLES, ['guia', 'plantilla', 'adr', 'glosario', 'convenciones', 'arquitectura', 'proceso', 'otra'])
  eq(emptyReferences(), { items: {} }, 'sin versión ni fecha: aquí no se persiste nada')
})

test('normalizeReferences reconstruye con claves EXACTAS y tira lo que no vale', () => {
  const r = normalizeReferences(
    {
      items: [
        { id: '456789', title: 'Guía', role: 'guia', forWhat: 'las convenciones', families: ['api', 'inventada', 'api'], onclick: 'x' },
        { id: '123', title: 'tres cifras' },
        { id: 'abc', title: 'sin id' },
        { id: '456789', title: 'repetida' },
        null,
        'x',
      ],
    },
    { index: INDICE }
  )
  eq(Object.keys(r.items), ['456789'])
  eq(r.items['456789'], {
    families: ['api'],
    forWhat: 'las convenciones',
    id: '456789',
    role: 'guia',
    title: 'Guía',
  })
  eq(Object.keys(r.items['456789']).sort(), ['families', 'forWhat', 'id', 'role', 'title'])
  eq(SOURCE_LIMITS.bareIdMin, 4, 'un id de página de Confluence real tiene al menos cuatro cifras')
})

test('un papel que no existe es «otra», y las familias se filtran contra ISSUE_FAMILIES', () => {
  const r = normalizeReferences([{ id: '456789', role: 'inventado', families: ['api', 'nope', 42] }])
  eq(r.items['456789'].role, 'otra', 'una página de referencia que no se reconoce sigue siéndolo')
  eq(r.items['456789'].families, ['api'])
  const ids = ISSUE_FAMILIES.map((f) => f.id)
  for (const f of ids) eq(normalizeReferences([{ id: '456789', families: [f] }]).items['456789'].families, [f], f)
})

test('el título del índice gana a un marcador de posición, y se acota a una línea', () => {
  eq(normalizeReferences([{ id: '456789', title: 'Página 456789' }], { index: INDICE }).items['456789'].title, 'Guía de API del programa')
  eq(normalizeReferences([{ id: '456789' }], { index: INDICE }).items['456789'].title, 'Guía de API del programa')
  eq(normalizeReferences([{ id: '456789', title: 'El título de verdad' }], { index: INDICE }).items['456789'].title, 'El título de verdad')
  eq(normalizeReferences([{ id: '999999', title: 'Página 999999' }], { index: INDICE }).items['999999'].title, 'Página 999999')
  eq(normalizeReferences([{ id: '999999' }]).items['999999'].title, 'Página 999999', 'sin índice y sin título, el id')
})

test('SEGURIDAD: un título de 500 caracteres o con saltos queda en una línea y acotado', () => {
  const largo = normalizeReferences([
    { id: '456789', title: 'A'.repeat(500), forWhat: 'B'.repeat(500) },
    { id: '456790', title: 'Guía\ncon salto\ty tabulador' },
  ])
  eq(largo.items['456789'].title.length, SOURCE_LIMITS.titleMax)
  eq(largo.items['456789'].forWhat.length, REFERENCE_LIMITS.forWhatMax)
  eq(largo.items['456790'].title, 'Guía con salto y tabulador')
})

test('cuarenta páginas de referencia como mucho', () => {
  const muchas = Array.from({ length: REFERENCE_LIMITS.max + 10 }, (_, i) => ({ id: String(500000 + i), title: `P${i}` }))
  eq(Object.keys(normalizeReferences(muchas).items).length, REFERENCE_LIMITS.max)
})

test('lo que no tiene forma de referencias da unas vacías, no una excepción', () => {
  for (const malo of [null, undefined, 'abc', 7, {}, { items: 'x' }, { items: 7 }, []]) {
    eq(normalizeReferences(malo), { items: {} }, JSON.stringify(malo) ?? String(malo))
  }
})

test('roleForFamily sólo cruza los cuatro que el diseño declara, y no se cuela el prototipo', () => {
  eq(roleForFamily('api'), ['guia', 'convenciones'])
  eq(roleForFamily('architecture'), ['adr', 'arquitectura'])
  eq(roleForFamily('doc'), ['plantilla', 'guia'])
  eq(roleForFamily('test'), ['proceso', 'guia'])
  eq(roleForFamily('task'), [], 'una tarea a secas no pide ningún papel en concreto')
  // SEGURIDAD: `family` puede salir de un registro guardado o editado a mano.
  for (const raro of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null, undefined, 7])
    eq(roleForFamily(raro), [], String(raro))
  for (const f of ['api', 'architecture', 'doc', 'test'])
    for (const role of roleForFamily(f)) assert(REFERENCE_ROLES.includes(role), `${f} → ${role} no es un papel`)
})

// ---- el parser de prosa ------------------------------------------------------

test('referencesFromContext lee los ids que el contexto cita, con su papel', () => {
  const r = referencesFromContext(CONTEXTO, { index: INDICE })
  eq(Object.keys(r.items).sort(), ['456789', '456790', '456791'])
  eq(r.items['456789'].role, 'guia', 'lo dice la propia línea')
  eq(r.items['456789'].title, 'Guía de API del programa', 'el título entre comillas latinas')
  eq(r.items['456790'].role, 'proceso', '«Runbook» está en la línea')
  eq(r.items['456790'].title, 'Runbook de guardia', 'y el título en negrita también vale')
  eq(r.items['456791'].role, 'adr')
  eq(r.items['456791'].title, 'ADR-014 Rotación de tokens')
  for (const item of Object.values(r.items)) {
    eq(item.families, [], 'la prosa no dice a qué clase de trabajo sirve una página: no se adivina')
    assert(item.forWhat.length > 0 && !item.forWhat.includes('\n'), 'para qué sirve, en una línea')
  }
})

test('el papel sale del apartado en vigor cuando la línea no lo dice', () => {
  const r = referencesFromContext(
    ['## Plantillas del equipo', '- «Ficha de servicio» (id 456789)', '### Glosario', '- «Términos» (id 456790)'].join('\n')
  )
  eq(r.items['456789'].role, 'plantilla')
  eq(r.items['456790'].role, 'glosario')
  // Y una línea entera en negrita también es un apartado: los modelos las escriben así.
  const negrita = referencesFromContext(['**Convenciones**', '- «Nombres de rama» (id 456789)'].join('\n'))
  eq(negrita.items['456789'].role, 'convenciones')
  // El papel de la LÍNEA manda sobre el del apartado.
  const manda = referencesFromContext(['## Procesos', '- «Guía de despliegue» (id 456789)'].join('\n'))
  eq(manda.items['456789'].role, 'guia')
})

test('SEGURIDAD: un número cualquiera no es un id de página', () => {
  const nada = (linea) => Object.keys(referencesFromContext(linea).items)
  eq(nada('- «X» (id 123)'), [], 'tres cifras es un número suelto de una frase')
  eq(nada('- «X» SIMPL-1234'), [], 'una clave de incidencia no lleva ningún «id» delante')
  eq(nada('- «X» pageId=abc'), [])
  eq(nada('- La versión 2026 del documento'), [], 'un año no es un id')
  eq(nada('- Se revisó en 2026 con 14000 usuarios'), [], 'ni una cifra en una frase')
  eq(nada(''), [])
  eq(nada(null), [])
  // Y las cuatro formas que sí valen.
  eq(nada('- «X» (id 456789)'), ['456789'])
  eq(nada('- «X» id: 456789'), ['456789'])
  eq(nada('- «X» https://x.eu/pages/456789/Slug'), ['456789'])
  eq(nada('- «X» https://x.eu/pages/viewpage.action?pageId=456789'), ['456789'])
})

test('una línea aporta una referencia, y el CRLF no la mueve', () => {
  const r = referencesFromContext('## Guías\r\n- «Guía de API del programa» (id 456789)\r\n\r\n- «Otra» (id 456790)\r\n')
  eq(Object.keys(r.items).sort(), ['456789', '456790'])
  // Límite asumido: si el modelo pone dos en la misma línea, sólo cuenta la primera.
  eq(Object.keys(referencesFromContext('- «A» (id 456789) y «B» (id 456790)').items), ['456789'])
})

test('un contexto enorme no se recorre entero, y uno sin ids no da nada', () => {
  eq(Object.keys(referencesFromContext('Prosa sin un solo id numérico.\n## Apartado\nMás prosa.').items), [])
  const relleno = 'x\n'.repeat(REFERENCE_LIMITS.contextMax)
  eq(Object.keys(referencesFromContext(relleno + '- «Tarde» (id 456789)').items), [], 'más allá del tope no es un contexto')
})
