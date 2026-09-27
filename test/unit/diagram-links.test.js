/**
 * El diagrama «Según Jira» (H25b): de un diagrama del modelo leído por el
 * parser REAL y lo que devuelve `fetchIssueLinks` (aquí a mano, con su forma
 * exacta: `{ ok, nodes: [{key, summary, type, statusCategory}], links: [{from,
 * to, type, name, id}], … }`) a un segundo diagrama con los nodos del modelo y
 * las aristas de Jira, y la comparación entre los dos por pares sin orden.
 *
 * Lo que se pina es la procedencia (§8.27): entran SÓLO las claves del modelo
 * que Jira devolvió; una clave que el modelo escribió y Jira no tiene va a
 * `fuera`, y una relación de Jira con un extremo que el modelo no dibujó no se
 * pinta. Y la barrera: el diagrama sale por `validateDiagram` y vuelve igual
 * por «Copiar como Mermaid».
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jiraDiagram, resumenJira, clavesDelIndice } from '../../src/panel/diagram-links.js'
import { readFlowchart, toMermaid, validateDiagram, DIAGRAM_LIMITS } from '../../src/panel/diagram-parse.js'

const ROOT = join(import.meta.dirname, '..', '..')
const FUENTE = readFileSync(join(ROOT, 'src', 'panel', 'diagram-links.js'), 'utf8').replace(/\r\n/g, '\n')

function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Lo que dibujó el modelo: cuatro incidencias con tipos de observación y un
 * [3], una clave que sólo está en su prosa (ENG-999, que Jira no devuelve) y un
 * paso sin clave. Las aristas: A→B y C→D coinciden con Jira tal cual, A→C con
 * Jira AL REVÉS, y B→C no lo tiene Jira.
 */
const MODELO = [
  'flowchart LR',
  '  A[ENG-7 Definir la API de rotación] --> B[ENG-3 Tokens de 90 días]:::contradiccion',
  '  A -->|depende de| C[ENG-12 Backend de rotación]:::riesgo',
  '  C -.-> D{ENG-20 ¿Quién revoca la clave vieja? [3]}:::hueco',
  '  B --> C',
  '  D --> E[ENG-999 Una clave que sólo está en la prosa]',
  '  B --> F[Un paso sin clave]',
].join('\n')

/** Un nodo de la respuesta, con la forma de `parseIssueLinks`. */
const nodo = (key) => ({ key, summary: 'Resumen de ' + key, type: 'Historia', statusCategory: 'indeterminate' })
const rel = (from, to, type, name, id) => ({ from, to, type, name, id })

/** Lo que devuelve `fetchIssueLinks`: las cuatro del modelo y cinco relaciones, una hacia fuera. */
const RESULTADO = {
  ok: true,
  nodes: ['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20'].map(nodo),
  links: [
    rel('ENG-7', 'ENG-3', 'blocks', 'Blocks', '20001'),
    rel('ENG-12', 'ENG-7', 'relates to', 'Relates', '20002'),
    rel('ENG-12', 'ENG-20', 'blocks', 'Blocks', '20003'),
    rel('ENG-20', 'ENG-3', 'duplicates', 'Duplicate', '20006'),
    rel('ENG-20', 'ENG-25', 'duplicates', 'Duplicate', '20004'),
  ],
  via: 'rest',
  prefix: '',
  ms: 12,
}

function modelo(src = MODELO) {
  const d = readFlowchart(src)
  assert(d.ok, JSON.stringify(d.errores))
  return d
}

test('diagrama de Jira: un solo import (la barrera y sus topes) y nada del DOM ni de chrome', () => {
  const imports = [...FUENTE.matchAll(/^import .*$/gm)].map((m) => m[0])
  eq(imports, ["import { validateDiagram, DIAGRAM_LIMITS } from './diagram-parse.js'"])
  const codigo = sinComentarios(FUENTE)
  assert(!/\b(document|window|chrome|fetch|globalThis|localStorage)\b/.test(codigo), 'puro: no toca DOM, chrome ni la red')
  assert(!/innerHTML|insertAdjacentHTML|outerHTML/.test(codigo), 'y no escribe HTML')
  eq(
    [...codigo.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]),
    ['jiraDiagram', 'clavesDelIndice', 'resumenJira']
  )
  eq(typeof globalThis.document, 'undefined', 'importarlo en Node no ha necesitado un document')
})

test('diagrama de Jira: claves EXACTAS del resultado, de la comparación y de cada fila', () => {
  const r = jiraDiagram(modelo(), RESULTADO)
  eq(Object.keys(r), ['diagram', 'comparacion'])
  eq(Object.keys(r.diagram), ['ok', 'direction', 'nodes', 'edges', 'subgraphs', 'errores'])
  eq(Object.keys(r.comparacion), ['comunes', 'soloModelo', 'soloJira', 'nodos', 'fuera', 'recortada'])
  for (const f of [...r.comparacion.comunes, ...r.comparacion.soloJira]) eq(Object.keys(f), ['from', 'to', 'type'])
  for (const f of r.comparacion.soloModelo) eq(Object.keys(f), ['from', 'to', 'label'])
  eq(Object.keys(jiraDiagram(null, null)), ['diagram', 'comparacion'])
  eq(Object.keys(jiraDiagram(null, null).comparacion), ['comunes', 'soloModelo', 'soloJira', 'nodos', 'fuera', 'recortada'])
})

test('diagrama de Jira: los nodos son los del modelo en su orden, con su id y su etiqueta, kind vacío y ref recalculado', () => {
  const m = modelo()
  const { diagram } = jiraDiagram(m, RESULTADO)
  assert(diagram && diagram.ok, 'hay diagrama')
  eq(diagram.direction, 'LR', 'la dirección del modelo')
  eq(diagram.subgraphs, [])
  eq(diagram.errores, [])
  eq(
    diagram.nodes,
    [
      { id: 'A', label: 'ENG-7 Definir la API de rotación', shape: 'rect', kind: '', ref: { kind: 'jira-issue', id: 'ENG-7' }, note: 0, sub: '' },
      { id: 'B', label: 'ENG-3 Tokens de 90 días', shape: 'rect', kind: '', ref: { kind: 'jira-issue', id: 'ENG-3' }, note: 0, sub: '' },
      { id: 'C', label: 'ENG-12 Backend de rotación', shape: 'rect', kind: '', ref: { kind: 'jira-issue', id: 'ENG-12' }, note: 0, sub: '' },
      {
        id: 'D',
        label: 'ENG-20 ¿Quién revoca la clave vieja? [3]',
        shape: 'rect',
        kind: '',
        ref: { kind: 'jira-issue', id: 'ENG-20' },
        note: 3,
        sub: '',
      },
    ],
    'el rombo pasa a rect, «contradiccion»/«riesgo»/«hueco» eran juicios del modelo y se van; ref y note los recalcula la barrera de la etiqueta'
  )
  eq(
    m.nodes.map((n) => n.kind),
    ['', 'contradiccion', 'riesgo', 'hueco', '', ''],
    'el modelo sí los traía: el vacío es a propósito'
  )
  // Si el orden fuese el de Jira, ENG-12 iría antes que ENG-3 en otra respuesta.
  const alReves = { ...RESULTADO, nodes: [...RESULTADO.nodes].reverse() }
  eq(jiraDiagram(m, alReves).diagram.nodes.map((n) => n.id), ['A', 'B', 'C', 'D'], 'el orden es el del modelo, no el de la respuesta')
})

test('diagrama de Jira: una clave dibujada dos veces entra UNA vez, con el id del primer nodo', () => {
  const src = MODELO + '\n  G[ENG-7 otra vez la misma] --> B\n  G --> D\n  H[ENG-999 y otra vez la de la prosa]'
  const { diagram, comparacion } = jiraDiagram(modelo(src), RESULTADO)
  eq(diagram.nodes.map((n) => n.id), ['A', 'B', 'C', 'D'])
  eq(comparacion.nodos, 4)
  eq(
    comparacion.soloModelo,
    [
      { from: 'ENG-3', to: 'ENG-12', label: '' },
      { from: 'ENG-7', to: 'ENG-20', label: '' },
    ],
    'G→B es ENG-7→ENG-3, que Jira tiene: no es una diferencia; G→D es ENG-7→ENG-20, que Jira no tiene: sí lo es, aunque G no se pinte'
  )
  eq(comparacion.fuera, ['ENG-999'], 'y una clave de fuera dibujada dos veces se dice una')
})

test('diagrama de Jira: las aristas son las relaciones de Jira con su tipo como etiqueta, y la que sale del conjunto no entra', () => {
  const { diagram } = jiraDiagram(modelo(), RESULTADO)
  eq(diagram.edges, [
    { from: 'A', to: 'B', label: 'blocks', style: 'solid', arrow: 'arrow' },
    { from: 'C', to: 'A', label: 'relates to', style: 'solid', arrow: 'arrow' },
    { from: 'C', to: 'D', label: 'blocks', style: 'solid', arrow: 'arrow' },
    { from: 'D', to: 'B', label: 'duplicates', style: 'solid', arrow: 'arrow' },
  ], 'en el sentido de Jira (ENG-12 → ENG-7 aunque el modelo lo dibujase al revés) y sin ENG-20 → ENG-25')
})

test('diagrama de Jira: dos relaciones entre los mismos nodos son dos aristas; la misma repetida, una', () => {
  const r = {
    ...RESULTADO,
    links: [
      rel('ENG-7', 'ENG-3', 'blocks', 'Blocks', '1'),
      rel('ENG-7', 'ENG-3', 'relates to', 'Relates', '2'),
      rel('ENG-7', 'ENG-3', 'blocks', 'Blocks', '1'),
      rel('ENG-7', 'ENG-7', 'relates to', 'Relates', '3'),
    ],
  }
  const { diagram, comparacion } = jiraDiagram(modelo(), r)
  eq(diagram.edges.map((e) => `${e.from}>${e.to}:${e.label}`), ['A>B:blocks', 'A>B:relates to'], 'y un bucle sobre sí misma no es una relación entre dos')
  eq(comparacion.comunes.length, 2, 'las dos casan con la flecha A→B del modelo')
})

test('diagrama de Jira: la comparación va por PARES SIN ORDEN (A→B del modelo coincide con B→A de Jira)', () => {
  const { comparacion } = jiraDiagram(modelo(), RESULTADO)
  eq(comparacion.comunes, [
    { from: 'ENG-7', to: 'ENG-3', type: 'blocks' },
    { from: 'ENG-12', to: 'ENG-7', type: 'relates to' },
    { from: 'ENG-12', to: 'ENG-20', type: 'blocks' },
  ], 'ENG-12 → ENG-7 de Jira casa con ENG-7 → ENG-12 del modelo')
  eq(comparacion.soloModelo, [{ from: 'ENG-3', to: 'ENG-12', label: '' }], 'B→C lo dibujó el modelo y Jira no lo tiene; D→E y B→F no son del conjunto')
  eq(comparacion.soloJira, [{ from: 'ENG-20', to: 'ENG-3', type: 'duplicates' }])
  eq(comparacion.nodos, 4)
  eq(comparacion.fuera, ['ENG-999'])
  // La misma diferencia dos veces (mismo par y misma etiqueta) se dice una.
  const doble = jiraDiagram(modelo(MODELO + '\n  C --> B'), RESULTADO).comparacion.soloModelo
  eq(doble, [{ from: 'ENG-3', to: 'ENG-12', label: '' }])
})

test('diagrama de Jira: las etiquetas salen recortadas a edgeLabelMax y limpias, también en la comparación', () => {
  const largo = 'is blocked by "algo" ' + 'x'.repeat(80)
  const r = { ...RESULTADO, links: [rel('ENG-7', 'ENG-20', largo, 'Largo', '9')] }
  const { diagram, comparacion } = jiraDiagram(modelo(), r)
  const etiqueta = diagram.edges[0].label
  eq(etiqueta.length, DIAGRAM_LIMITS.edgeLabelMax)
  assert(etiqueta.startsWith("is blocked by 'algo' "), 'la comilla doble pasa a simple: «Copiar como Mermaid» la escribe entre dobles')
  eq(comparacion.soloJira, [{ from: 'ENG-7', to: 'ENG-20', type: etiqueta }], 'lo que se cuenta es lo que se pinta')
  const raro = { ...RESULTADO, links: [{ from: 'ENG-7', to: 'ENG-3', type: 42 }] }
  eq(jiraDiagram(modelo(), raro).diagram.edges[0].label, '', 'un tipo que no es texto es una arista sin etiqueta')
})

test('diagrama de Jira: validado, idempotente y de ida y vuelta por «Copiar como Mermaid»', () => {
  const { diagram } = jiraDiagram(modelo(), RESULTADO)
  eq(validateDiagram(diagram), diagram, 'validar lo validado da lo mismo')
  const texto = toMermaid(diagram)
  assert(texto.startsWith('flowchart LR\n'), texto)
  eq(readFlowchart(texto), diagram, 'readFlowchart(toMermaid(d)) es d')
})

test('diagrama de Jira: con menos de dos incidencias no hay diagrama, pero sí comparación', () => {
  const una = { ...RESULTADO, nodes: [nodo('ENG-7')] }
  const r = jiraDiagram(modelo(), una)
  eq(r.diagram, null)
  eq(r.comparacion, { comunes: [], soloModelo: [], soloJira: [], nodos: 1, fuera: ['ENG-3', 'ENG-12', 'ENG-20', 'ENG-999'], recortada: false })
  eq(jiraDiagram(modelo(), null), {
    diagram: null,
    comparacion: { comunes: [], soloModelo: [], soloJira: [], nodos: 0, fuera: ['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20', 'ENG-999'], recortada: false },
  }, 'sin respuesta, todas fuera')
  eq(jiraDiagram({ ok: false, errores: ['roto'] }, RESULTADO).diagram, null, 'un diagrama del modelo que no vale no da diagrama de Jira')
  for (const basura of [undefined, 'flowchart TD', 7, [], { nodes: 'x' }]) {
    const b = jiraDiagram(basura, basura)
    eq(b.diagram, null)
    eq(b.comparacion.nodos, 0)
  }
})

test('diagrama de Jira: sin relaciones en Jira, los nodos y cero aristas, y el resumen lo dice', () => {
  const { diagram, comparacion } = jiraDiagram(modelo(), { ...RESULTADO, links: [] })
  eq(diagram.nodes.map((n) => n.id), ['A', 'B', 'C', 'D'])
  eq(diagram.edges, [])
  eq(comparacion.soloModelo.length, 4, 'todo lo que dibujó el modelo entre las cuatro es suyo')
  eq(resumenJira(comparacion), 'Según Jira: sin relaciones en Jira entre 4 incidencias · sólo el modelo 4')
  eq(
    resumenJira(jiraDiagram(modelo('flowchart TD\n  A[ENG-7 uno]\n  B[ENG-3 dos]'), { ...RESULTADO, links: [] }).comparacion),
    'Según Jira: sin relaciones en Jira entre 2 incidencias'
  )
})

test('diagrama de Jira: el resumen dice N relaciones entre M incidencias y sólo las diferencias que hay', () => {
  eq(
    resumenJira(jiraDiagram(modelo(), RESULTADO).comparacion),
    'Según Jira: 4 relaciones entre 4 incidencias · coinciden 3 · sólo el modelo 1 · sólo Jira 1'
  )
  eq(
    resumenJira({ comunes: [{}], soloModelo: [], soloJira: [], nodos: 2, fuera: [] }),
    'Según Jira: 1 relación entre 2 incidencias · coinciden 1',
    'en singular, y sin «sólo…» a cero'
  )
  eq(
    resumenJira({ comunes: [], soloModelo: [], soloJira: [{}, {}], nodos: 3, fuera: [] }),
    'Según Jira: 2 relaciones entre 3 incidencias · coinciden 0 · sólo Jira 2'
  )
  eq(resumenJira(null), 'Según Jira: sin relaciones en Jira entre 0 incidencias', 'nunca lanza')
  eq(resumenJira({ nodos: 1 }), 'Según Jira: sin relaciones en Jira entre 1 incidencia')
})

test('diagrama de Jira: nunca más aristas que el tope del diagrama', () => {
  const muchas = Array.from({ length: DIAGRAM_LIMITS.edges + 10 }, (_, i) => rel('ENG-7', 'ENG-3', 'tipo ' + i, 'T' + i, String(i)))
  const { diagram, comparacion } = jiraDiagram(modelo(), { ...RESULTADO, links: muchas })
  assert(diagram && diagram.ok, 'con más relaciones que el tope se recorta, no se tumba (validateDiagram tumbaría todo)')
  eq(diagram.edges.length, DIAGRAM_LIMITS.edges)
  eq(comparacion.comunes.length + comparacion.soloJira.length, DIAGRAM_LIMITS.edges, 'y la comparación cuenta lo que se pinta')
  // Una relación con un extremo fuera del conjunto se descarta SIN contar para el tope.
  const haciaFuera = Array.from({ length: DIAGRAM_LIMITS.edges }, (_, i) => rel('ENG-7', 'ENG-25', 'tipo ' + i, 'T', String(i)))
  const conFuera = jiraDiagram(modelo(), { ...RESULTADO, links: [...haciaFuera, rel('ENG-7', 'ENG-3', 'blocks', 'Blocks', '1')] })
  eq(conFuera.diagram.edges.map((e) => `${e.from}>${e.to}:${e.label}`), ['A>B:blocks'], 'las sesenta hacia ENG-25 no se comen el tope')
})

test('SEGURIDAD: las claves que se contrastan son las del índice: ENG-999 no está y no sale, sin repetir, sólo refs de incidencia y con el tope', () => {
  const d = modelo(MODELO + '\n  C --> X[ENG-999 No existe]')
  const indice = { issues: Object.fromEntries(['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20'].map((k) => [k, { key: k }])) }
  eq(clavesDelIndice(d, indice, 30), ['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20'], 'ENG-999 no está en el índice y no sale')
  const repetidas = { nodes: [...d.nodes, ...d.nodes, { ref: { kind: 'confluence-page', id: 'ENG-7' } }, { ref: null }, null] }
  eq(clavesDelIndice(repetidas, indice, 30), ['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20'], 'sin repetir y sólo refs de incidencia')
  eq(clavesDelIndice({ nodes: [{ ref: { kind: 'confluence-page', id: 'ENG-7' } }] }, indice, 30), [], 'un ref de página no es una incidencia, aunque su id esté en el índice')
  eq(clavesDelIndice(d, indice, 2), ['ENG-7', 'ENG-3'], 'con el tope, las primeras')
  eq(clavesDelIndice(d, null, 30), [], 'sin índice, ninguna')
  eq(clavesDelIndice(null, indice, 30), [], 'sin diagrama, ninguna')
  eq(clavesDelIndice(d, indice, undefined), [], 'sin tope, ninguna: el tope lo pone quien llama')
})

test('SEGURIDAD: diagrama de Jira: una clave de la prosa del modelo que Jira no devolvió NO entra, y una que devolvió Jira sin que el modelo la dibujara tampoco', () => {
  const r = {
    ...RESULTADO,
    nodes: [...RESULTADO.nodes, nodo('ENG-25'), nodo('OPS-2')],
    links: [...RESULTADO.links, rel('ENG-999', 'ENG-7', 'blocks', 'Blocks', '7'), rel('OPS-2', 'ENG-12', 'relates to', 'Relates', '8')],
  }
  const { diagram, comparacion } = jiraDiagram(modelo(), r)
  const pintado = JSON.stringify(diagram)
  for (const clave of ['ENG-999', 'ENG-25', 'OPS-2']) assert(!pintado.includes(clave), clave + ' no se pinta')
  eq(diagram.nodes.map((n) => n.ref.id), ['ENG-7', 'ENG-3', 'ENG-12', 'ENG-20'], 'sólo las del modelo que Jira devolvió')
  eq(diagram.edges.length, 4, 'ni sus relaciones')
  eq(comparacion.fuera, ['ENG-999'], 'la de la prosa va a fuera, por si hay que decirlo')
  assert(!JSON.stringify(comparacion.comunes.concat(comparacion.soloJira, comparacion.soloModelo)).match(/ENG-999|ENG-25|OPS-2/), 'ni en la comparación')
  // Un nodo de la respuesta con la clave como id de otro nodo del modelo no cuela: se casa por ref, no por id.
  const porId = jiraDiagram(modelo('flowchart TD\n  ENG-7[Un paso]\n  B[ENG-3 dos]'), RESULTADO)
  eq(porId.diagram, null, 'un nodo cuyo id es una clave pero su etiqueta no empieza por ella no es la incidencia')
  // Ni un `ref` puesto a mano: la barrera lo recalcula de la etiqueta antes de casar.
  const aMano = {
    ok: true,
    direction: 'TD',
    nodes: [
      { id: 'A', label: 'Un paso', shape: 'rect', kind: '', ref: { kind: 'jira-issue', id: 'ENG-7' }, note: 0, sub: '' },
      { id: 'B', label: 'Otro paso', shape: 'rect', kind: '', ref: { kind: 'jira-issue', id: 'ENG-3' }, note: 0, sub: '' },
    ],
    edges: [],
    subgraphs: [],
    errores: [],
  }
  eq(jiraDiagram(aMano, RESULTADO).diagram, null, 'un ref que la etiqueta no respalda no se contrasta')
})

test('diagrama de Jira: con la lista de Jira RECORTADA no se afirma «Jira no lo tiene», y el resumen dice «al menos»', () => {
  // B→C lo dibujó el modelo y no está en RESULTADO: entera, es «sólo el modelo».
  eq(jiraDiagram(modelo(), RESULTADO).comparacion.soloModelo.map((a) => `${a.from}>${a.to}`), ['ENG-3>ENG-12'])
  // Con `truncated` (fetchIssueLinks), la misma arista queda sin afirmar.
  const { comparacion } = jiraDiagram(modelo(), { ...RESULTADO, truncated: true })
  eq(comparacion.soloModelo, [], 'lo que no cupo en la lista de Jira no es «Jira no lo tiene»')
  eq(comparacion.recortada, true)
  eq(comparacion.comunes.length + comparacion.soloJira.length, 4, 'lo leído se sigue pintando y comparando')
  eq(resumenJira(comparacion), 'Según Jira: al menos 4 relaciones entre 4 incidencias · coinciden 3 · sólo Jira 1')
  // Y el propio tope del diagrama cuenta como recorte.
  const muchas = Array.from({ length: DIAGRAM_LIMITS.edges + 1 }, (_, i) => rel('ENG-7', 'ENG-3', 'tipo ' + i, 'T' + i, String(i)))
  const r = jiraDiagram(modelo(), { ...RESULTADO, links: muchas })
  eq([r.comparacion.recortada, r.comparacion.soloModelo.length], [true, 0])
  const justas = jiraDiagram(modelo(), { ...RESULTADO, links: muchas.slice(0, DIAGRAM_LIMITS.edges) })
  eq(justas.comparacion.recortada, false, 'sesenta que caben no son un recorte')
  // El tope va detrás del dedupe y del conjunto: una repetida o una hacia fuera, después de las sesenta, no lo son.
  const conSobras = [...muchas.slice(0, DIAGRAM_LIMITS.edges), muchas[0], rel('ENG-7', 'ENG-25', 'blocks', 'Blocks', '99')]
  eq(jiraDiagram(modelo(), { ...RESULTADO, links: conSobras }).comparacion.recortada, false, 'una repetida o una que sale del conjunto no es un recorte')
})

test('diagrama de Jira: dos nodos del modelo con la misma clave unidos entre sí no son una diferencia', () => {
  const { comparacion } = jiraDiagram(modelo(MODELO + '\n  A --> G[ENG-7 otra vez la misma]'), RESULTADO)
  eq(comparacion.soloModelo, [{ from: 'ENG-3', to: 'ENG-12', label: '' }], 'A→G es ENG-7→ENG-7: un bucle, no una relación entre dos')
})

test('diagrama de Jira: dos flechas del modelo del mismo par con etiquetas distintas son dos diferencias', () => {
  const src = 'flowchart LR\n  A[ENG-7 uno] -->|bloquea| B[ENG-3 dos]\n  A -->|depende de| B'
  const { comparacion } = jiraDiagram(modelo(src), { ...RESULTADO, links: [] })
  eq(comparacion.soloModelo, [
    { from: 'ENG-7', to: 'ENG-3', label: 'bloquea' },
    { from: 'ENG-7', to: 'ENG-3', label: 'depende de' },
  ], 'la misma diferencia dos veces se dice una; dos distintas, dos')
})

test('diagrama de Jira: A blocks B y B blocks A son dos aristas, una en cada sentido', () => {
  const ciclo = { ...RESULTADO, links: [rel('ENG-7', 'ENG-3', 'blocks', 'Blocks', '1'), rel('ENG-3', 'ENG-7', 'blocks', 'Blocks', '2')] }
  const { diagram, comparacion } = jiraDiagram(modelo(), ciclo)
  eq(diagram.edges.map((e) => `${e.from}>${e.to}:${e.label}`), ['A>B:blocks', 'B>A:blocks'], 'un ciclo de Jira no se funde: el sentido es de Jira')
  eq(comparacion.comunes.length, 2)
})
