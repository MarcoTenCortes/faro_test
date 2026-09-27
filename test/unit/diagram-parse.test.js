/**
 * El diagrama del chat: el subconjunto de Mermaid `flowchart` que Faro lee, la
 * barrera que lo reconstruye con claves blancas y la vuelta a Mermaid (H24).
 *
 * Todo lo que llega aquí lo escribió el modelo (§8.12): las pruebas SEGURIDAD
 * lo ejecutan de verdad —lo que en Mermaid ejecuta o carga algo se rechaza con
 * su motivo, una etiqueta hostil es un texto de una línea, `ref` sólo por
 * `validIssueKey`, `kind` sólo de `NOTE_KINDS`— y la ida y vuelta de
 * `toMermaid` se compara con el objeto ENTERO.
 */
import { test, eq, assert } from '../harness.js'
import {
  DIAGRAM_LIMITS,
  DIAGRAM_SHAPES,
  parseFlowchart,
  validateDiagram,
  readFlowchart,
  toMermaid,
  citedIssueKeys,
} from '../../src/panel/diagram-parse.js'

const NEL = String.fromCharCode(0x85)
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)

/** El flujo del anexo E: seis incidencias, siete aristas, un subgrafo, `&`, clases y un [n]. */
const FLUJO = [
  'flowchart TD',
  '  %% seis incidencias, siete aristas y un subgrafo',
  '  A[ENG-1 Épica: rotación de credenciales] --> B[ENG-7 Definir la API de rotación]',
  '  B --> C[ENG-12 Backend de rotación]:::riesgo & D[OPS-2 Runbook de guardia]',
  '  C -.->|depende de| E{ENG-20 ¿Quién revoca la clave vieja? [3]}:::hueco',
  '  D --> E',
  '  E -->|contradice| F[ENG-3 Tokens de 90 días]:::contradiccion',
  '  A --> F',
  '  subgraph S [Sprint 1]',
  '    C',
  '    D',
  '  end',
].join('\n')

const nodo = (id, label, extra = {}) => ({
  id,
  label,
  shape: 'rect',
  kind: '',
  ref: null,
  note: 0,
  sub: '',
  ...extra,
})
const arista = (from, to, extra = {}) => ({ from, to, label: '', style: 'solid', arrow: 'arrow', ...extra })
const jira = (id) => ({ kind: 'jira-issue', id })

/** Los nodos y aristas de `src`, en corto, para las tablas de tolerancia. */
function corto(src) {
  const d = readFlowchart(src)
  assert(d.ok, `${JSON.stringify(src)} tenía que leerse y dio ${JSON.stringify(d.errores)}`)
  return {
    nodos: d.nodes.map((n) => `${n.id}${n.shape === 'rect' ? '' : '/' + n.shape}=${n.label}`),
    aristas: d.edges.map((e) => `${e.from}>${e.to}${e.style === 'solid' ? '' : ' ' + e.style}${e.arrow === 'arrow' ? '' : ' ' + e.arrow}${e.label ? ' «' + e.label + '»' : ''}`),
  }
}

test('diagrama: DIAGRAM_LIMITS y DIAGRAM_SHAPES, congelados y con sus valores', () => {
  eq(DIAGRAM_LIMITS, {
    srcMax: 6000,
    nodes: 30,
    edges: 60,
    labelMax: 80,
    edgeLabelMax: 40,
    idMax: 32,
    subgraphs: 6,
    offerMinKeys: 3,
  })
  assert(Object.isFrozen(DIAGRAM_LIMITS), 'DIAGRAM_LIMITS congelado')
  eq(DIAGRAM_SHAPES, ['rect', 'round', 'stadium', 'subroutine', 'cylinder', 'circle', 'diamond', 'hexagon'])
  assert(Object.isFrozen(DIAGRAM_SHAPES), 'DIAGRAM_SHAPES congelado')
})

test('diagrama: el flujo del anexo se lee ENTERO (nodos, aristas, subgrafo, clases, refs y [n])', () => {
  eq(readFlowchart(FLUJO), {
    ok: true,
    direction: 'TD',
    nodes: [
      nodo('A', 'ENG-1 Épica: rotación de credenciales', { ref: jira('ENG-1') }),
      nodo('B', 'ENG-7 Definir la API de rotación', { ref: jira('ENG-7') }),
      nodo('C', 'ENG-12 Backend de rotación', { kind: 'riesgo', ref: jira('ENG-12'), sub: 'S' }),
      nodo('D', 'OPS-2 Runbook de guardia', { ref: jira('OPS-2'), sub: 'S' }),
      nodo('E', 'ENG-20 ¿Quién revoca la clave vieja? [3]', {
        shape: 'diamond',
        kind: 'hueco',
        ref: jira('ENG-20'),
        note: 3,
      }),
      nodo('F', 'ENG-3 Tokens de 90 días', { kind: 'contradiccion', ref: jira('ENG-3') }),
    ],
    edges: [
      arista('A', 'B'),
      arista('B', 'C'),
      arista('B', 'D'),
      arista('C', 'E', { label: 'depende de', style: 'dotted' }),
      arista('D', 'E'),
      arista('E', 'F', { label: 'contradice' }),
      arista('A', 'F'),
    ],
    subgraphs: [{ id: 'S', label: 'Sprint 1', nodes: ['C', 'D'] }],
    errores: [],
  })
})

test('diagrama: claves EXACTAS y en orden del resultado, de cada nodo, arista y subgrafo (también con ok:false)', () => {
  const d = readFlowchart(FLUJO)
  eq(Object.keys(d), ['ok', 'direction', 'nodes', 'edges', 'subgraphs', 'errores'])
  for (const n of d.nodes) eq(Object.keys(n), ['id', 'label', 'shape', 'kind', 'ref', 'note', 'sub'])
  for (const n of d.nodes.filter((x) => x.ref)) eq(Object.keys(n.ref), ['kind', 'id'])
  for (const e of d.edges) eq(Object.keys(e), ['from', 'to', 'label', 'style', 'arrow'])
  for (const s of d.subgraphs) eq(Object.keys(s), ['id', 'label', 'nodes'])
  const malo = readFlowchart('sequenceDiagram\n  A->>B: hola')
  eq(Object.keys(malo), ['ok', 'direction', 'nodes', 'edges', 'subgraphs', 'errores'])
  eq([malo.ok, malo.nodes, malo.edges, malo.subgraphs], [false, [], [], []], 'con ok:false, todo vacío')
  eq(Object.keys(parseFlowchart(FLUJO)), ['ok', 'direction', 'nodes', 'edges', 'subgraphs', 'errores'])
})

test('diagrama: parseFlowchart es la lectura EN CRUDO y readFlowchart = validateDiagram(parseFlowchart(src))', () => {
  const crudo = parseFlowchart('flowchart LR\n  A[ENG-1 uno]:::__proto__ --> B')
  eq(crudo.nodes, [
    { id: 'A', label: 'ENG-1 uno', shape: 'rect', kind: '__proto__', sub: '' },
    { id: 'B', label: 'B', shape: 'rect', kind: '', sub: '' },
  ])
  for (const src of [FLUJO, 'graph LR;A-->B', 'flowchart TD\n  click A x', null, '']) {
    eq(readFlowchart(src), validateDiagram(parseFlowchart(src)), JSON.stringify(src))
  }
})

test('diagrama: tolerancia a lo que escriben los modelos, un caso por variante (I: flechas y etiquetas)', () => {
  eq(corto('flowchart TD\nA-->B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B'] }, 'sin espacios')
  eq(corto('graph TD;A-->B;B-->C'), { nodos: ['A=A', 'B=B', 'C=C'], aristas: ['A>B', 'B>C'] }, '«graph» con «;»')
  eq(corto('flowchart TD\nA[texto] --> B(texto)'), { nodos: ['A=texto', 'B/round=texto'], aristas: ['A>B'] })
  eq(corto('flowchart TD\nA -- texto --> B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B «texto»'] })
  eq(corto('flowchart TD\nA -->|texto| B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B «texto»'] })
  eq(corto('flowchart TD\nA --x B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B cross'] })
  eq(corto('flowchart TD\nA --o B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B circle'] })
  eq(corto('flowchart TD\nA -.-> B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B dotted'] })
  eq(corto('flowchart TD\nA ==> B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B thick'] })
  eq(corto('flowchart TD\nA --- B\nB -.- C\nC === D'), {
    nodos: ['A=A', 'B=B', 'C=C', 'D=D'],
    aristas: ['A>B none', 'B>C dotted none', 'C>D thick none'],
  })
  eq(corto('flowchart TD\nA -. quizá .-> B\nB == seguro ==> C'), {
    nodos: ['A=A', 'B=B', 'C=C'],
    aristas: ['A>B dotted «quizá»', 'B>C thick «seguro»'],
  })
  eq(corto('flowchart TD\nA ---oficina'), { nodos: ['A=A', 'oficina=oficina'], aristas: ['A>oficina none'] }, 'la «o» del id no es una punta')
})

test('diagrama: tolerancia a lo que escriben los modelos, un caso por variante (II: nodos, ids y cadenas)', () => {
  eq(corto('flowchart TD\nA --> B & C'), { nodos: ['A=A', 'B=B', 'C=C'], aristas: ['A>B', 'A>C'] })
  eq(corto('flowchart TD\nA & B --> C'), { nodos: ['A=A', 'B=B', 'C=C'], aristas: ['A>C', 'B>C'] })
  eq(corto('flowchart TD\nA --> B --> C'), { nodos: ['A=A', 'B=B', 'C=C'], aristas: ['A>B', 'B>C'] }, 'dos aristas')
  eq(corto('flowchart TD\nA["x [1] ]"] --> B'), { nodos: ['A=x [1] ]', 'B=B'], aristas: ['A>B'] }, 'corchetes entre comillas')
  eq(corto('flowchart TD\nENG-1 --> ENG-2'), { nodos: ['ENG-1=ENG-1', 'ENG-2=ENG-2'], aristas: ['ENG-1>ENG-2'] })
  eq(corto('flowchart TD\nENG-1-->ENG-2'), { nodos: ['ENG-1=ENG-1', 'ENG-2=ENG-2'], aristas: ['ENG-1>ENG-2'] })
  eq(readFlowchart('flowchart TD\nENG-1 --> ENG-2').nodes.map((n) => n.ref), [jira('ENG-1'), jira('ENG-2')], 'un id con guion es una clave')
  eq(corto('flowchart TD\nA["uno; dos"] --> B;B --> C'), { nodos: ['A=uno; dos', 'B=B', 'C=C'], aristas: ['A>B', 'B>C'] }, 'el «;» entre comillas no parte')
  eq(corto('flowchart TD\nA["x ] ; y"] --> B'), { nodos: ['A=x ] ; y', 'B=B'], aristas: ['A>B'] }, 'ni detrás de un «]» entre comillas')
  eq(readFlowchart('flowchart TD\n  subgraph "Lote; dos"\n  A --> B\n  end').subgraphs[0].label, 'Lote; dos', 'ni en el título de un subgrafo')
  eq(corto('flowchart TD\n  A  -->   B  '), { nodos: ['A=A', 'B=B'], aristas: ['A>B'] }, 'espacios de más')
})

test('diagrama: tolerancia a lo que escriben los modelos, un caso por variante (III: subgrafos, clases, comentarios)', () => {
  const sub = readFlowchart('flowchart LR\n  subgraph S [Sprint 1]\n    direction LR\n    A --> B\n  end\n  B --> C')
  eq(sub.subgraphs, [{ id: 'S', label: 'Sprint 1', nodes: ['A', 'B'] }], '«direction» dentro se acepta y se ignora')
  eq(sub.direction, 'LR')
  eq(sub.nodes.map((n) => n.sub), ['S', 'S', ''])
  eq(readFlowchart('flowchart TD\n  A:::riesgo --> B').nodes.map((n) => n.kind), ['riesgo', ''])
  eq(readFlowchart('flowchart TD\n  A --> B --> C\n  class A,B hueco').nodes.map((n) => n.kind), ['hueco', 'hueco', ''])
  eq(readFlowchart('flowchart TD\n  class A riesgo\n  A:::dato --> B\n').nodes[0].kind, 'dato', 'manda lo último')
  eq(corto('%% antes de la cabecera\nflowchart TD\n  %% comentario\n  A --> B'), { nodos: ['A=A', 'B=B'], aristas: ['A>B'] })
  const titulos = readFlowchart('flowchart TD\n  subgraph Lote de pruebas\n  A\n  end\n  subgraph "Otro lote"\n  B\n  end\n  subgraph T\n  C\n  end')
  eq(titulos.subgraphs, [
    { id: 'sg1', label: 'Lote de pruebas', nodes: ['A'] },
    { id: 'sg2', label: 'Otro lote', nodes: ['B'] },
    { id: 'T', label: 'T', nodes: ['C'] },
  ], 'un título con espacios lleva un id propio')
  eq(readFlowchart('flowchart TD\n  subgraph S [uno]\n  A\n  end\n  subgraph S [dos]\n  B\n  end').subgraphs, [
    { id: 'S', label: 'uno', nodes: ['A', 'B'] },
  ], 'el mismo id se reabre')
  eq(readFlowchart('flowchart TD\n  subgraph S\n  end\n  A --> B').subgraphs, [], 'un subgrafo vacío no se dibuja')
  eq(readFlowchart('flowchart TD\n  subgraph S\n  A --> B').nodes.map((n) => n.sub), ['S', 'S'], 'sin «end», se cierra al final')
})

test('diagrama: las formas; >x] y las demás de Mermaid son rect; un id sin corchetes es rect con su id', () => {
  const d = readFlowchart(
    [
      'flowchart TD',
      '  a[r] --> b(re) --> c([es]) --> d[[su]] --> e[(ci)] --> f((cí)) --> g{ro} --> h{{he}}',
      '  h --> i>asi] --> j[/par/] --> k[\\tra/] --> l(((dob))) --> m',
    ].join('\n')
  )
  eq(
    d.nodes.map((n) => [n.id, n.shape, n.label]),
    [
      ['a', 'rect', 'r'],
      ['b', 'round', 're'],
      ['c', 'stadium', 'es'],
      ['d', 'subroutine', 'su'],
      ['e', 'cylinder', 'ci'],
      ['f', 'circle', 'cí'],
      ['g', 'diamond', 'ro'],
      ['h', 'hexagon', 'he'],
      ['i', 'rect', 'asi'],
      ['j', 'rect', 'par'],
      ['k', 'rect', 'tra'],
      ['l', 'rect', 'dob'],
      ['m', 'rect', 'm'],
    ]
  )
  eq(readFlowchart('flowchart TD\n  A --> B\n  A[primero] --> C\n  A(segundo)').nodes[0], nodo('A', 'segundo', { shape: 'round' }), 'manda la última forma')
})

test('diagrama: una arista a un id no declarado lo declara (rect, etiqueta = id) y el orden es el de primera aparición', () => {
  const d = readFlowchart('flowchart TD\n  B --> ENG-4\n  A["  con   comillas  "] --> B\n  subgraph S\n  A\n  end\n  subgraph T\n  A --> Z\n  end')
  eq(
    d.nodes.map((n) => [n.id, n.label, n.shape, n.sub]),
    [
      ['B', 'B', 'rect', ''],
      ['ENG-4', 'ENG-4', 'rect', ''],
      ['A', 'con comillas', 'rect', 'S'],
      ['Z', 'Z', 'rect', 'T'],
    ],
    'sin comillas envolventes; el primer subgrafo que nombra un nodo se lo queda'
  )
  eq(d.subgraphs, [
    { id: 'S', label: 'S', nodes: ['A'] },
    { id: 'T', label: 'T', nodes: ['Z'] },
  ])
})

test('diagrama: el sentido (TB es TD; sin sentido, TD)', () => {
  const dir = (cab) => {
    const d = readFlowchart(cab + '\n  A --> B')
    return d.ok ? d.direction : 'no se leyó'
  }
  eq(['flowchart TD', 'flowchart TB', 'flowchart LR', 'flowchart RL', 'flowchart BT', 'flowchart', 'graph lr'].map(dir), [
    'TD',
    'TD',
    'LR',
    'RL',
    'BT',
    'TD',
    'LR',
  ])
  eq(readFlowchart('flowchart XY\n  A --> B').errores, ['línea 1: no es un flowchart'])
})

test('SEGURIDAD: click, href, callback, style, classDef y linkStyle se rechazan con su motivo y su línea', () => {
  const casos = [
    ['click A "https://evil.example" _blank', 'click'],
    ['click A call alert()', 'click'],
    ['href A "javascript:alert(1)"', 'href'],
    ['callback A fn', 'callback'],
    ['style A fill:url(https://evil.example/x)', 'style'],
    ['classDef x fill:#f00', 'classDef'],
    ['linkStyle 0 stroke:red', 'linkStyle'],
    ['CLICK A x', 'CLICK'],
  ]
  for (const [linea, palabra] of casos) {
    const d = readFlowchart(`flowchart TD\n  A --> B\n  ${linea}`)
    eq([d.ok, d.errores, d.nodes, d.edges], [false, [`línea 3: «${palabra}» no se admite`], [], []], linea)
  }
  eq(readFlowchart('graph TD;A-->B;click A x').errores, ['línea 1: «click» no se admite'], 'también detrás de un «;»')
})

test('SEGURIDAD: las directivas %%{init}%% se rechazan, también antes de la cabecera', () => {
  eq(readFlowchart('%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A --> B').errores, [
    'línea 1: las directivas «%%{…}%%» no se admiten',
  ])
  eq(readFlowchart('flowchart TD\n  A --> B\n  %%{init: {"theme": "dark"}}%%').errores, [
    'línea 3: las directivas «%%{…}%%» no se admiten',
  ])
  eq(readFlowchart('flowchart TD\n  A --> B\n  %% {esto sí es un comentario}').ok, true)
})

test('SEGURIDAD: <img onerror> y javascript: en una etiqueta son TEXTO de una línea', () => {
  const d = readFlowchart('flowchart TD\n  A[<img src=x onerror=alert(1)>] --> B["javascript:alert(1)"]\n  B -->|<b onclick=x>| C')
  assert(d.ok, JSON.stringify(d.errores))
  eq(d.nodes.map((n) => n.label), ['<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'C'])
  eq(d.edges[1].label, '<b onclick=x>')
  eq(d.nodes.map((n) => n.ref), [null, null, null], 'nada de eso es una referencia')
  // Y claves blancas: lo que no es del contrato no pasa aunque venga en el crudo.
  const crudo = parseFlowchart('flowchart TD\n  A --> B')
  crudo.nodes[0].onclick = 'alert(1)'
  crudo.nodes[0].href = 'javascript:alert(1)'
  crudo.edges[0].style = 'fill:url(x)'
  crudo.edges[0].arrow = '<script>'
  crudo.nodes[1].shape = 'foreignObject'
  const v = validateDiagram(crudo)
  eq(Object.keys(v.nodes[0]), ['id', 'label', 'shape', 'kind', 'ref', 'note', 'sub'])
  eq([v.edges[0].style, v.edges[0].arrow, v.nodes[1].shape], ['solid', 'arrow', 'rect'])
})

test('SEGURIDAD: NEL, U+2028, U+2029, RLO y ZWSP se van de etiquetas e ids', () => {
  const src = `flowchart TD\n  A[uno${NEL}dos${LS}tres${PS}cuatro] --> E${RLO}NG-${ZWSP}1\n  A -->|a${NEL}b${RLO}c| B${ZWSP}X`
  const d = readFlowchart(src)
  assert(d.ok, JSON.stringify(d.errores))
  eq(d.nodes.map((n) => [n.id, n.label]), [
    ['A', 'uno dos tres cuatro'],
    ['ENG-1', 'ENG-1'],
    ['BX', 'BX'],
  ])
  eq(d.edges[1].label, 'a bc')
  eq(d.nodes[1].ref, jira('ENG-1'))
  const todo = JSON.stringify(d)
  for (const c of [NEL, LS, PS, RLO, ZWSP]) assert(!todo.includes(c), 'queda U+' + c.charCodeAt(0).toString(16))
  // También en lo que llega por validateDiagram sin pasar por el parser.
  const v = validateDiagram({ direction: 'TD', nodes: [{ id: 'A', label: `x${RLO}y${NEL}z` }, { id: 'B' }], edges: [] })
  eq(v.nodes[0].label, 'xy z')
})

test('SEGURIDAD: ref sólo por validIssueKey y sólo con la PRIMERA palabra', () => {
  const ref = (label) => readFlowchart(`flowchart TD\n  A["${label}"] --> B`).nodes[0].ref
  eq(ref('ENG-1 Alta'), jira('ENG-1'))
  eq(ref('eng-1 alta'), jira('ENG-1'), 'en mayúsculas')
  eq(ref('ENG-1 OR project = X'), jira('ENG-1'), 'sólo la palabra, nunca el resto')
  eq(ref('ENG-7: Definir la API'), jira('ENG-7'), 'la puntuación pegada no cuenta')
  eq(ref('Definir ENG-7'), null, 'no es la primera palabra')
  eq(ref('ENG-1234567890 largo'), null)
  eq(ref('1ENG-1'), null)
  eq(ref('ENG_X'), null)
  eq(ref('https://x.example/browse/ENG-1'), null, 'una URL no es una clave')
})

test('SEGURIDAD: kind sólo de NOTE_KINDS (__proto__ y constructor no cuelan)', () => {
  const kind = (cls) => readFlowchart(`flowchart TD\n  A:::${cls} --> B`).nodes[0].kind
  eq(['dato', 'supuesto', 'hueco', 'contradiccion', 'riesgo'].map(kind), ['dato', 'supuesto', 'hueco', 'contradiccion', 'riesgo'])
  eq(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'Riesgo', 'onclick'].map(kind), ['', '', '', '', '', ''])
  eq(readFlowchart('flowchart TD\n  A --> B\n  class A,B __proto__').nodes.map((n) => n.kind), ['', ''])
  eq(validateDiagram({ nodes: [{ id: 'A', kind: ['riesgo'] }, { id: 'B', kind: { toString: () => 'riesgo' } }] }).nodes.map((n) => n.kind), ['', ''])
})

test('SEGURIDAD: note es el primer [n] si es 1..NOTE_LIMITS.max (12); si no, 0', () => {
  const nota = (label) => readFlowchart(`flowchart TD\n  A["${label}"] --> B`).nodes[0].note
  eq(['uno [1]', 'doce [12]', 'x [3] y [4]', 'sin nota', '[0]', '[13]', '[99]', '[13] y [2]', '[-1]', '[1.5]'].map(nota), [
    1, 12, 3, 0, 0, 0, 0, 0, 0, 0,
  ])
})

test('SEGURIDAD: los topes, con su error', () => {
  const cadena = (n) => 'flowchart TD\n' + Array.from({ length: n - 1 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')
  eq(readFlowchart(cadena(30)).nodes.length, 30)
  eq(readFlowchart(cadena(31)).errores, ['demasiados nodos: 31 de tope 30'])
  eq(parseFlowchart(cadena(31)).errores, ['demasiados nodos: 31 de tope 30'], 'ya en la lectura')
  const aristas = (n) => 'flowchart TD\n' + Array.from({ length: n }, (_, i) => `  A --> B${i % 20}`).join('\n')
  eq(readFlowchart(aristas(60)).edges.length, 60)
  eq(readFlowchart(aristas(61)).errores, ['demasiadas aristas: 61 de tope 60'])
  eq(parseFlowchart(aristas(61)).errores, ['demasiadas aristas: 61 de tope 60'], 'ya en la lectura')
  const subs = (n) => 'flowchart TD\n' + Array.from({ length: n }, (_, i) => `  subgraph S${i}\n  N${i}\n  end`).join('\n')
  eq(readFlowchart(subs(6)).subgraphs.length, 6)
  eq(readFlowchart(subs(7)).errores, ['demasiados subgrafos: 7 de tope 6'])
  eq(parseFlowchart(subs(7)).errores, ['demasiados subgrafos: 7 de tope 6'], 'ya en la lectura')
  const largo = 'flowchart TD\n  A --> B\n' + '%'.repeat(6000)
  eq(readFlowchart(largo).errores, [`demasiado largo: ${largo.length} caracteres de tope 6000`])
  eq(readFlowchart('flowchart TD\n  A').errores, ['menos de dos nodos'])
  eq(readFlowchart('flowchart TD').errores, ['menos de dos nodos'])
  const id33 = 'X'.repeat(33)
  eq(readFlowchart(`flowchart TD\n  ${id33} --> B`).errores, [`línea 2: «${id33}» no vale como id`])
  eq(readFlowchart(`flowchart TD\n  ${'X'.repeat(32)} --> B`).ok, true)
  // Y lo mismo por la barrera, sin pasar por el parser.
  const muchos = Array.from({ length: 31 }, (_, i) => ({ id: 'N' + i }))
  eq(validateDiagram({ nodes: muchos }).errores, ['demasiados nodos: 31 de tope 30'])
})

test('diagrama: lo que no se entiende se rechaza con su línea', () => {
  const error = (src) => readFlowchart(src).errores
  eq(error('sequenceDiagram\n  A->>B: hola'), ['línea 1: no es un flowchart'])
  eq(error('\n\nflowchart-elk TD\n  A --> B'), ['línea 3: no es un flowchart'])
  eq(error('flowchart TD\n  A --> B\n  A <--> B'), ['línea 3: sobra: «<--> B»'])
  eq(error('flowchart TD\n  A --> B %% nota'), ['línea 2: sobra: «%% nota»'])
  eq(error('flowchart TD\n  A -->'), ['línea 2: sobra: «-->»'])
  eq(error('flowchart TD\n  subgraph S\n  subgraph T\n  A --> B\n  end\n  end'), ['línea 3: un subgrafo dentro de otro no se admite'])
  eq(error('flowchart TD\n  A --> B\n  end'), ['línea 3: sobra: «end»'])
  eq(error('flowchart TD\n  direction LR\n  A --> B'), ['línea 2: sobra: «direction LR»'])
  eq(error('flowchart TD\n  A --> end'), ['línea 2: «end» no vale como id'])
  // Una palabra que abre sentencia no es un id: `click --> B` en la copia sería un `click`.
  eq(error('flowchart TD\n  A --> click --> B'), ['línea 2: «click» no vale como id'])
  eq(error('flowchart TD\n  A --> Style'), ['línea 2: «Style» no vale como id'])
  eq(error('flowchart TD\n  A --> B ' + '?'.repeat(100)), [`línea 2: sobra: «${'?'.repeat(80)}…»`], 'lo que sobra, recortado')
  eq(error(''), ['no es un flowchart'])
})

test('diagrama: nunca lanza (null, basura, 100 KB, un Proxy que lanza)', () => {
  let semilla = 7
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648)
  const basura = Array.from({ length: 3000 }, () => String.fromCharCode(Math.floor(azar() * 0x3000))).join('')
  const trampa = new Proxy({}, { get() { throw new Error('trampa') } })
  const entradas = [null, undefined, 42, {}, [], true, basura, 'flowchart TD\n' + basura, 'x'.repeat(100 * 1024), trampa, Symbol('x')]
  for (const e of entradas) {
    for (const f of [parseFlowchart, validateDiagram, readFlowchart, toMermaid, citedIssueKeys]) {
      let r
      try {
        r = f(e)
      } catch (err) {
        assert(false, `${f.name} lanzó con ${typeof e}: ${err.message}`)
      }
      if (f === readFlowchart || f === validateDiagram) eq(Object.keys(r), ['ok', 'direction', 'nodes', 'edges', 'subgraphs', 'errores'])
    }
  }
  eq(readFlowchart('x'.repeat(100 * 1024)).errores, ['demasiado largo: 102400 caracteres de tope 6000'])
  eq(validateDiagram(trampa).errores, ['no se ha podido leer el diagrama'])
  eq(toMermaid(null), '')
  eq(citedIssueKeys(null), [])
})

test('diagrama: validateDiagram reconstruye con claves blancas (ids malos, duplicados, huérfanos, recortes)', () => {
  const largo = 'x'.repeat(DIAGRAM_LIMITS.labelMax - 1) + '😀 cola'
  const v = validateDiagram({
    ok: true,
    direction: 'tb',
    nodes: [
      { id: 'A', label: `  "entre comillas"  `, shape: 'circle', sub: 'S' },
      { id: 'A', label: 'duplicado' },
      { id: 'mal id', label: 'fuera' },
      { id: 'end', label: 'reservado' },
      { id: 'B', label: largo, sub: 'NO' },
      { id: 'C', label: '' },
      null,
    ],
    edges: [
      { from: 'A', to: 'B', label: 'e'.repeat(50), style: 'dotted', arrow: 'circle' },
      { from: 'A', to: 'Z' },
      { from: 'C', to: 'A', label: 7 },
    ],
    subgraphs: [
      { id: 'S', label: 'Sprint' },
      { id: 'S', label: 'repetido' },
      { id: 'V', label: 'vacío' },
      { id: 'no vale' },
    ],
    errores: [],
    extra: 'fuera',
  })
  // Un crudo que dice ok:false no se da por bueno aunque traiga nodos y ningún error.
  eq(validateDiagram({ ok: false, nodes: [{ id: 'A' }, { id: 'B' }], edges: [], errores: [] }).errores, ['no se ha podido leer el diagrama'])
  eq(v, {
    ok: true,
    direction: 'TD',
    nodes: [
      nodo('A', "'entre comillas'", { shape: 'circle', sub: 'S' }),
      nodo('B', 'x'.repeat(DIAGRAM_LIMITS.labelMax - 1)),
      nodo('C', 'C'),
    ],
    edges: [
      arista('A', 'B', { label: 'e'.repeat(DIAGRAM_LIMITS.edgeLabelMax), style: 'dotted', arrow: 'circle' }),
      arista('C', 'A'),
    ],
    subgraphs: [{ id: 'S', label: 'Sprint', nodes: ['A'] }],
    errores: [],
  })
})

test('diagrama: validateDiagram es idempotente (también con ok:false)', () => {
  const entradas = [
    readFlowchart(FLUJO),
    parseFlowchart(FLUJO),
    readFlowchart('flowchart TD\n  click A x'),
    { nodes: [{ id: 'A', label: ` a${NEL} "b" ` + 'z'.repeat(90) }, { id: 'B', label: '[2] B', kind: 'dato' }], edges: [{ from: 'A', to: 'B', label: 'q'.repeat(45) + ' ' }] },
    // El recorte cae justo detrás de un espacio: sin el trim de después, la segunda pasada lo quitaría.
    { nodes: [{ id: 'A', label: 'x'.repeat(DIAGRAM_LIMITS.labelMax - 1) + ' y' }, { id: 'B' }], edges: [{ from: 'A', to: 'B', label: 'e'.repeat(DIAGRAM_LIMITS.edgeLabelMax - 1) + ' f' }] },
    { ok: false, errores: [`uno${NEL}dos`, 3] },
    null,
  ]
  for (const x of entradas) {
    const una = validateDiagram(x)
    eq(validateDiagram(una), una, JSON.stringify(x)?.slice(0, 80))
  }
})

test('diagrama: toMermaid escribe el Mermaid canónico', () => {
  const d = readFlowchart('flowchart LR\n  subgraph S [Sprint 1]\n  A[ENG-1 Alta]:::riesgo\n  end\n  A -->|bloquea| B([ENG-2 Baja])\n  B -.-x C')
  eq(
    toMermaid(d),
    [
      'flowchart LR',
      '  A["ENG-1 Alta"]:::riesgo',
      '  B(["ENG-2 Baja"])',
      '  C["C"]',
      '  subgraph S ["Sprint 1"]',
      '    A',
      '  end',
      '  A -->|"bloquea"| B',
      '  B -.-x C',
    ].join('\n')
  )
  eq(toMermaid(readFlowchart('flowchart TD\n  A')), '', 'sin diagrama válido, nada')
})

test('diagrama: la ida y vuelta de toMermaid es EXACTA (el objeto entero)', () => {
  const variado = [
    'flowchart RL',
    '  subgraph Lote de pruebas',
    '    a1([Estadio]) --- b2[[Subrutina]]',
    '  end',
    '  b2 -.- c3[(Cilindro)] -.-x d4((Círculo)) -.-o e5{{Hexágono}}',
    '  e5 ==> f6{Rombo} === g7(Redondo) ==x h8>Asimétrico]',
    '  h8 ==o i9["con; punto y coma | y [corchetes] ]"] --x j10[dice "hola"]',
    '  j10 --o k11:::supuesto',
    '  k11 -->|"a | b"| a1',
    '  k11 -- texto largo con : y | --> ENG-9',
    '  subgraph T [Otro]',
    '    ENG-9',
    '    k11',
    '  end',
  ].join('\n')
  for (const src of [FLUJO, variado, 'graph BT;A-->B', 'flowchart TD\n  A --> A\n  A --> B & B']) {
    const d = readFlowchart(src)
    assert(d.ok, JSON.stringify(d.errores))
    eq(readFlowchart(toMermaid(d)), d, src.slice(0, 40))
  }
  // Y con lo que sólo llega por la barrera: todas las formas, estilos y puntas.
  const nodes = DIAGRAM_SHAPES.map((shape, i) => ({ id: 'n' + i, label: `[${i + 1}] ${shape} "x" | ; ]`, shape, kind: i % 2 ? 'riesgo' : '', sub: i === 1 ? 'Z' : '' }))
  const edges = []
  for (const style of ['solid', 'dotted', 'thick']) {
    for (const arrow of ['arrow', 'none', 'cross', 'circle']) edges.push({ from: 'n0', to: 'n' + (edges.length % 8), style, arrow, label: edges.length % 2 ? 'et | "q"' : '' })
  }
  const d = validateDiagram({ direction: 'BT', nodes, edges, subgraphs: [{ id: 'Z', label: 'zeta ] "x"' }] })
  assert(d.ok)
  eq(readFlowchart(toMermaid(d)), d)
})

test('diagrama: citedIssueKeys da las claves DISTINTAS en orden, y [] con lo que no es texto', () => {
  eq(citedIssueKeys('ENG-1 bloquea a OPS-22; ENG-1 otra vez, luego ABC_2-3 y ENG-7.'), ['ENG-1', 'OPS-22', 'ABC_2-3', 'ENG-7'])
  eq(citedIssueKeys('eng-1 en minúsculas no cuenta, ni ENG-1234567890, ni XENG1-2x'), [])
  eq(citedIssueKeys('```mermaid\nA[ENG-1] --> B[ENG-2]\n```'), ['ENG-1', 'ENG-2'])
  for (const x of [null, undefined, 3, {}, ['ENG-1']]) eq(citedIssueKeys(x), [])
  assert(DIAGRAM_LIMITS.offerMinKeys === 3)
})
