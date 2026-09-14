/**
 * Las observaciones numeradas del modo Análisis.
 *
 * Un análisis que dice cinco cosas sobre una página larga obliga a buscar a
 * mano de qué párrafo habla cada una. Estas son las piezas que cierran el
 * círculo: los números que el modelo puso en su respuesta, el bloque JSON de
 * anclas con el que la cierra —que hay que separar de la prosa sin comerse un
 * bloque de código que sea contenido— y la validación de lo que llega a la
 * página, que es la barrera de seguridad.
 */
import { test, eq, assert } from '../harness.js'
import {
  numberedIn,
  numbersInAnchors,
  observationNumbers,
  expectedCount,
  normalizeNumbering,
  unwrapWholeFence,
  saysNothingToSay,
  looksLikeFollowUp,
  questionCitesPoint,
  numberedReminder,
  stripNumberedReminder,
  insertMarks,
  collectSegmentedNotes,
  segmentSystem,
  segmentPrompt,
  splitAnchorsBlock,
  validateNotes,
  collectNotes,
  titleFromProse,
  surplusNumbers,
  anchorsBlockRules,
  notesSystem,
  notesPrompt,
  NOTES_SCHEMA,
  SEGMENT_SCHEMA,
  NOTE_KINDS,
  NOTE_LIMITS,
  NOTHING_TO_SAY,
} from '../../src/panel/notes.js'
import { parseInline, parseBlocks } from '../../src/panel/markdown.js'
import { skillSystem } from '../../src/panel/skills.js'

const CITA = 'el token expira a los 90 días naturales'

const BLOQUES = [
  { id: 1, tag: 'h1', text: 'ADR-014 Rotación de tokens de servicio' },
  { id: 2, tag: 'p', text: 'Hasta ahora los tokens de servicio no caducaban.' },
  { id: 3, tag: 'p', text: 'Por política de seguridad ' + CITA + ' y debe rotarse desde el panel.' },
]

const nota = (extra = {}) => ({ n: 1, title: 'Caducidad sin justificar', block: 3, quote: CITA, ...extra })

// --- los números de la respuesta -----------------------------------------

test('numberedIn saca los números de la respuesta, en orden y sin repetir', () => {
  eq(numberedIn('[2] Segunda cosa. [1] Primera. Y otra vez [2].'), [1, 2])
  eq(numberedIn('Sin números aquí'), [])
  eq(numberedIn(null), [])
  eq(numberedIn('[0] y [100] no valen'), [], 'fuera de rango')
})

test('numberedIn ignora los corchetes que el chat no pinta como marca', () => {
  // `arr[1]` en código, un bloque de ejemplo o el texto de un enlace no son
  // observaciones: contarlos lanzaba una segunda pasada por una marca fantasma.
  eq(numberedIn('mira `items[1]` y ya'), [])
  eq(numberedIn('```\nx = list[2]\n```\n[3] De verdad'), [3])
  eq(numberedIn('ver [1](https://acme.atlassian.net/x) y [2] esto'), [2])
  eq(numberedIn('```json\n{"a": [1]}'), [], 'una valla sin cerrar también es código')
})

test('un [0] no es una pastilla: las observaciones empiezan en 1', () => {
  const tokens = parseInline('[0] cero')
  assert(!tokens.some((t) => t.type === 'note'), 'no hay pastilla')
  eq(tokens.map((t) => t.text).join(''), '[0] cero', 'y el texto se queda entero')
})

test('titleFromProse saca la frase que abre una observación, sin marcado y recortada', () => {
  const prosa = '[1] **La caducidad** no se justifica. Y más cosas.\n[2]: La ventana de solape no está medida\n[3] — Sin punto final'
  eq(titleFromProse(prosa, 1), 'La caducidad no se justifica.')
  eq(titleFromProse(prosa, 2), 'La ventana de solape no está medida')
  eq(titleFromProse(prosa, 3), 'Sin punto final')
  eq(titleFromProse(prosa, 7), 'Observación 7')
  eq(titleFromProse('[4] ' + 'x'.repeat(400), 4).length, NOTE_LIMITS.titleMax)
  eq(titleFromProse(prosa, 'x'), 'Observación')
})

test('titleFromProse entiende «[1].», «[1])» y el estilo cita «…la frase [1].»', () => {
  eq(titleFromProse('[1]. La caducidad no se justifica. Y más.', 1), 'La caducidad no se justifica.')
  eq(titleFromProse('[1]) Con paréntesis', 1), 'Con paréntesis')
  eq(titleFromProse('- [2]. En viñeta', 2), 'En viñeta')
  const cita = 'La caducidad no se justifica [1]. El solape no está medido [2].'
  eq(titleFromProse(cita, 1), 'La caducidad no se justifica')
  eq(titleFromProse(cita, 2), 'El solape no está medido')
  eq(titleFromProse('[3].', 3), 'Observación 3', 'sólo puntuación no es un título')
})

test('surplusNumbers: los números del JSON que la respuesta no usa, para el registro', () => {
  eq(surplusNumbers({ notes: [{ n: 1 }, { n: 7 }, { n: 7 }, { n: 'x' }, { n: 0 }] }, [1, 2]), [7])
  eq(surplusNumbers({ notes: [{ n: 1 }] }, [1]), [])
  eq(surplusNumbers(null, [1]), [])
})

// --- el bloque JSON con el que cierra la respuesta -------------------------

const PROSA = '[1] La caducidad no se justifica.\n\n[2] El solape no está medido.'
const ANCLAS = '{"notes": [{"n": 1, "block": 3, "quote": "' + CITA + '"}, {"n": 2, "block": 0, "quote": ""}]}'

test('EL CAMBIO: el bloque JSON del final se separa de la prosa y no se enseña', () => {
  const r = splitAnchorsBlock(PROSA + '\n\n```json\n' + ANCLAS + '\n```\n')
  eq(r.prose, PROSA)
  eq(r.anchors.notes.length, 2)
  eq(r.anchors.notes[0].block, 3)
  eq(r.pending, false)
})

test('el bloque vale sin idioma y sin cerrar, si dentro hay un objeto con notes', () => {
  eq(splitAnchorsBlock(PROSA + '\n```\n' + ANCLAS + '\n```').anchors.notes.length, 2, 'sin idioma')
  const abierto = splitAnchorsBlock(PROSA + '\n```json\n' + ANCLAS)
  eq(abierto.anchors.notes.length, 2, 'sin cerrar, al terminar')
  eq(abierto.prose, PROSA)
})

test('un bloque de código que es contenido se queda donde está', () => {
  const conEjemplo = '[1] El ejemplo está mal:\n\n```json\n{"ttl": "90d"}\n```\n\n[2] Y falta el owner.'
  const r = splitAnchorsBlock(conEjemplo)
  eq(r.anchors, null)
  eq(r.prose, conEjemplo, 'no se toca')

  // Un ejemplo Y el bloque de anclas: sólo se retira el segundo.
  const ambos = splitAnchorsBlock(conEjemplo + '\n\n```json\n' + ANCLAS + '\n```')
  eq(ambos.anchors.notes.length, 2)
  eq(ambos.prose, conEjemplo)
})

test('el bloque de anclas se reconoce aunque no sea el último, y una valla citada con > no cuenta', () => {
  const antes = '```json\n' + ANCLAS + '\n```\n\n' + PROSA
  const r = splitAnchorsBlock(antes)
  eq(r.anchors.notes.length, 2)
  eq(r.prose, PROSA)

  const citado = PROSA + '\n> ```json\n> {"notes": []}\n> ```'
  eq(splitAnchorsBlock(citado).anchors, null)
})

test('mientras llega la respuesta, la valla abierta del final se esconde sólo si ya parece el bloque de anclas', () => {
  const aMedias = PROSA + '\n\n```json\n{"notes": [{"n": 1, "bl'
  const r = splitAnchorsBlock(aMedias, { final: false })
  eq(r.pending, true)
  eq(r.prose, PROSA, 'el JSON no se ve escribirse')
  eq(r.anchors, null)

  // Recién abierta, con «{» o «{"», todavía no se decide nada: cualquier JSON
  // empieza así, y esconderlo hacía parpadear los ejemplos de código.
  const reciénAbierta = splitAnchorsBlock(PROSA + '\n\n```json\n{"', { final: false })
  eq(reciénAbierta.pending, false)
  eq(splitAnchorsBlock(PROSA + '\n\n```json\n{"n', { final: false }).pending, true)

  // Un ejemplo de configuración a medias sigue viéndose: es contenido.
  const ejemplo = PROSA + '\n\n```json\n{"ttl": "90d",'
  const e = splitAnchorsBlock(ejemplo, { final: false })
  eq(e.pending, false)
  eq(e.prose, ejemplo)
})

test('un bloque de anclas cortado a medias no se enseña al terminar: se retira y no hay anclas', () => {
  // El modelo se quedó sin sitio a mitad del JSON. Enseñar medio JSON sería
  // peor que no marcar; la segunda pasada se encarga.
  const cortado = PROSA + '\n\n```json\n{"notes": [{"n": 1, "block": 3, "quote": "el tok'
  const r = splitAnchorsBlock(cortado)
  eq(r.prose, PROSA)
  eq(r.anchors, null)
  eq(r.truncated, true)
  // Un ejemplo de configuración sin cerrar sigue siendo contenido.
  const ejemplo = PROSA + '\n\n```json\n{"ttl": "90d",'
  eq(splitAnchorsBlock(ejemplo).prose, ejemplo)
})

test('la valla que cierra tiene que ser al menos tan larga como la que abre', () => {
  const conEjemplo = PROSA + '\n\nEjemplo:\n\n````\n```json\n{"ttl": "90d"}\n```\n````\n\n```json\n' + ANCLAS + '\n```'
  const r = splitAnchorsBlock(conEjemplo)
  eq(r.anchors.notes.length, 2)
  assert(r.prose.includes('````\n```json\n{"ttl": "90d"}\n```\n````'), 'el ejemplo de cuatro acentos se queda entero')
})

test('el idioma de la valla puede ser json5 o jsonc, y el objeto puede venir sin valla', () => {
  eq(splitAnchorsBlock(PROSA + '\n```json5\n' + ANCLAS + '\n```').anchors.notes.length, 2)
  const sinValla = splitAnchorsBlock(PROSA + '\n\n' + ANCLAS)
  eq(sinValla.anchors.notes.length, 2)
  eq(sinValla.prose, PROSA)
  // Pero un párrafo que no sea el objeto de anclas se queda como está.
  eq(splitAnchorsBlock(PROSA + '\n\n{"ttl": "90d"}').prose, PROSA + '\n\n{"ttl": "90d"}')
})

test('un JSON roto o sin notes no es un bloque de anclas', () => {
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": [\n```').anchors, null, 'roto')
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"otra": 1}\n```').anchors, null, 'sin notes')
  eq(splitAnchorsBlock(PROSA + '\n```json\n[1, 2]\n```').anchors, null, 'no es un objeto')
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": ["a", "b"]}\n```').anchors, null, 'las anclas son objetos')
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": []}\n```').anchors.notes, [], 'vacío sí es un bloque de anclas')
  // Un ejemplo de API que la página cita, con una lista «notes» de objetos sin
  // número, es contenido: se queda en el chat.
  const api = PROSA + '\n\nLa API devuelve:\n\n```json\n{"notes": [{"id": 17, "text": "hola"}]}\n```\n\n[3] Falta el owner.'
  eq(splitAnchorsBlock(api).anchors, null)
  eq(splitAnchorsBlock(api).prose, api)
  eq(splitAnchorsBlock('').prose, '')
  eq(splitAnchorsBlock(null).anchors, null)
})

test('los saltos de línea de Windows no rompen la separación', () => {
  const r = splitAnchorsBlock(PROSA.replace(/\n/g, '\r\n') + '\r\n```json\r\n' + ANCLAS + '\r\n```\r\n')
  eq(r.anchors.notes.length, 2)
  eq(r.prose, PROSA)
})

// --- validación -----------------------------------------------------------

test('una observación válida se queda en lo mínimo, con el ancla al bloque', () => {
  const [n] = validateNotes({ notes: [nota({ kind: 'supuesto' })] }, { blocks: BLOQUES })
  eq(n.n, 1)
  eq(n.title, 'Caducidad sin justificar')
  eq(n.kind, 'supuesto')
  eq(n.anchor.kind, 'block-quote')
  eq(n.anchor.block, 3)
  eq(n.anchor.exact, CITA)
})

test('SEGURIDAD: la pista del bloque sale del texto que enseñó la extensión, no del modelo', () => {
  const [n] = validateNotes({ notes: [nota({ hint: 'lo que yo diga', block: 3 })] }, { blocks: BLOQUES })
  assert(n.anchor.hint.startsWith('Por política de seguridad el token expira'), 'la pista es el principio del bloque enseñado')
  assert(BLOQUES[2].text.startsWith(n.anchor.hint), 'y sólo eso')
  assert(!JSON.stringify(n).includes('lo que yo diga'), 'la pista del modelo no llega')
})

test('SEGURIDAD: nada que no sean número, título, clase y ancla llega a la página', () => {
  const [n] = validateNotes(
    {
      notes: [
        nota({
          url: 'https://malicioso.example/robar',
          href: 'javascript:alert(1)',
          selector: '#algo',
          onClick: 'alert(1)',
        }),
      ],
    },
    { blocks: BLOQUES }
  )
  eq(Object.keys(n).sort(), ['anchor', 'kind', 'n', 'title'])
  eq(Object.keys(n.anchor).sort(), ['block', 'exact', 'hint', 'kind'])
  assert(!JSON.stringify(n).includes('malicioso'), 'nada puede apuntar fuera')
  assert(!JSON.stringify(n).includes('javascript:'), 'ni traer un protocolo raro')

  const [suelta] = validateNotes({ notes: [nota({ block: 0, selector: '#x' })] }, { blocks: BLOQUES })
  eq(Object.keys(suelta.anchor).sort(), ['exact', 'kind', 'prefix', 'suffix'])
})

test('un bloque fuera de la lista no vale; la cita, si tiene sustancia, se busca en toda la página', () => {
  const [n] = validateNotes({ notes: [nota({ block: 99 })] }, { blocks: BLOQUES })
  eq(n.anchor.kind, 'text-quote')
  eq(n.anchor.exact, CITA)

  const [cero] = validateNotes({ notes: [nota({ block: 0 })] }, { blocks: BLOQUES })
  eq(cero.anchor.kind, 'text-quote')
})

test('sin bloque y sin cita utilizable, la observación se lista pero no se marca', () => {
  const [general] = validateNotes({ notes: [nota({ block: 0, quote: '' })] }, { blocks: BLOQUES })
  eq(general.anchor, null)
  eq(general.title, 'Caducidad sin justificar')
  const [corta] = validateNotes({ notes: [nota({ block: 0, quote: 'corto' })] }, { blocks: BLOQUES })
  eq(corta.anchor, null, 'menos de ocho caracteres marca cualquier cosa')
})

test('un bloque sin cita, o con una cita ínfima, marca el bloque entero', () => {
  const [entero] = validateNotes({ notes: [nota({ quote: '' })] }, { blocks: BLOQUES })
  eq(entero.anchor.kind, 'block-quote')
  eq(entero.anchor.exact, '')
  const [minima] = validateNotes({ notes: [nota({ quote: 'ab' })] }, { blocks: BLOQUES })
  eq(minima.anchor.exact, '')
})

test('en modo estricto, un bloque sólo vale si la cita está de verdad dentro de él', () => {
  // Es el caso de volver a marcar sobre una página que quizá no es la misma:
  // los bloques de ahora no son los que vio el modelo, y la pista no comprueba
  // nada. Sin la cita dentro, «el bloque 3» sería cualquier cosa.
  const [dentro] = validateNotes({ notes: [nota()] }, { blocks: BLOQUES, strict: true })
  eq(dentro.anchor.kind, 'block-quote')
  const [fuera] = validateNotes({ notes: [nota({ block: 2 })] }, { blocks: BLOQUES, strict: true })
  eq(fuera.anchor.kind, 'text-quote', 'la cita no está en el bloque 2: se busca en toda la página')
  const [entero] = validateNotes({ notes: [nota({ quote: '' })] }, { blocks: BLOQUES, strict: true })
  eq(entero.anchor, null, 'sin cita no hay bloque entero que valga')
  const [normal] = validateNotes({ notes: [nota({ block: 2 })] }, { blocks: BLOQUES })
  eq(normal.anchor.kind, 'block-quote', 'sin modo estricto, el bloque enseñado manda')
})

test('sin bloques enseñados, sólo valen las citas sueltas', () => {
  const [n] = validateNotes({ notes: [nota()] })
  eq(n.anchor.kind, 'text-quote')
  eq(validateNotes({ notes: [] }), [])
  eq(validateNotes(null), [])
  eq(validateNotes({ notes: 'no es una lista' }), [])
})

test('la segunda pasada sigue entendiendo "exact" además de "quote"', () => {
  const [n] = validateNotes({ notes: [{ n: 1, block: 3, exact: CITA }] }, { blocks: BLOQUES })
  eq(n.anchor.exact, CITA)
})

test('un número repetido o fuera de rango se descarta', () => {
  const r = validateNotes(
    { notes: [nota({ n: 1 }), nota({ n: 1, title: 'Repetida' }), nota({ n: 0 }), nota({ n: 'x' })] },
    { blocks: BLOQUES }
  )
  eq(r.length, 1)
  eq(r[0].title, 'Caducidad sin justificar', 'gana la primera')
})

test('salen ordenadas por número aunque lleguen desordenadas', () => {
  const r = validateNotes({ notes: [nota({ n: 3 }), nota({ n: 1 }), nota({ n: 2 })] }, { blocks: BLOQUES })
  eq(r.map((x) => x.n), [1, 2, 3])
})

test('sólo se marcan los números que de verdad están en la respuesta', () => {
  // Sin esto, el bloque de anclas puede inventarse una observación 7 que el
  // usuario no ha leído en ninguna parte.
  const r = validateNotes({ notes: [nota({ n: 1 }), nota({ n: 7, title: 'Inventada' })] }, { allowed: [1, 2] })
  eq(r.map((x) => x.n), [1])
})

test('hay tope: doce marcas ya son demasiadas', () => {
  const muchas = Array.from({ length: 30 }, (_, i) => nota({ n: i + 1 }))
  eq(validateNotes({ notes: muchas }, { blocks: BLOQUES }).length, NOTE_LIMITS.max)
  eq(validateNotes({ notes: muchas }, { max: 3, blocks: BLOQUES }).length, 3)
})

test('el título se limpia y se recorta; sin título hay uno de oficio', () => {
  const [conBasura] = validateNotes({ notes: [nota({ title: '  hola    mundo  ' })] })
  eq(conBasura.title, 'hola mundo')

  const [largo] = validateNotes({ notes: [nota({ title: 'x'.repeat(400) })] })
  eq(largo.title.length, NOTE_LIMITS.titleMax)

  const [sin] = validateNotes({ notes: [nota({ n: 4, title: '' })] })
  eq(sin.title, 'Observación 4')
})

test('una clase inventada se ignora en vez de colarse', () => {
  eq(validateNotes({ notes: [nota({ kind: 'catastrofe' })] })[0].kind, '')
  for (const k of NOTE_KINDS) {
    eq(validateNotes({ notes: [nota({ kind: k })] })[0].kind, k)
  }
})

// --- la segunda pasada, sólo como red --------------------------------------

test('collectNotes no pide nada sin números ni sin página, y no lanza si el modelo falla', async () => {
  let llamadas = 0
  const client = {
    async promptStructured() {
      llamadas++
      throw new Error('se cayó')
    },
  }
  const digest = { text: '¶1 [p] hola', blocks: [{ id: 1, tag: 'p', text: 'hola' }], truncated: false }
  eq((await collectNotes(client, { answer: 'sin números', digest })).notes, [])
  eq((await collectNotes(client, { answer: '[1] algo', digest: null })).notes, [])
  eq(llamadas, 0)
  const r = await collectNotes(client, { sessionID: 's', answer: '[1] algo', digest })
  eq(r.notes, [])
  assert(/se cayó/.test(r.reason))
  eq(llamadas, 1)
})

test('collectNotes valida lo que vuelve contra los bloques enseñados, y pasa la señal de parar', async () => {
  const señal = new AbortController().signal
  let recibida = null
  const client = {
    async promptStructured(_id, { schema, system, text }, control) {
      eq(schema, NOTES_SCHEMA)
      assert(/anclador/i.test(system))
      assert(text.includes('¶3 [p]'), 'la página va en bloques')
      recibida = control
      return { notes: [{ n: 1, block: 3, quote: CITA }, { n: 9, block: 1 }] }
    },
  }
  const digest = { text: '¶1 [h1] ADR-014\n¶2 [p] Hasta ahora\n¶3 [p] Por política', blocks: BLOQUES, truncated: false }
  const r = await collectNotes(client, { sessionID: 's', answer: '[1] La caducidad.', digest, signal: señal })
  eq(r.notes.length, 1, 'la 9 no estaba en la respuesta')
  eq(r.notes[0].anchor.block, 3)
  assert(recibida === señal, 'el botón de parar del panel también para la segunda pasada')
})

// --- el contrato con el modelo -------------------------------------------

test('la Skill pide el bloque JSON al final, con bloque ¶ y cita literal', () => {
  const reglas = anchorsBlockRules()
  assert(/```json/.test(reglas), 'una valla json')
  assert(/"notes"/.test(reglas), 'con un objeto notes')
  assert(/LITERAL/.test(reglas), 'la cita tiene que ser literal')
  assert(/"block": 0/.test(reglas), 'y un 0 para lo que no apunta a ningún bloque')
  assert(/no lo lee el usuario/i.test(reglas), 'el modelo debe saber que se retira')
  assert(/No menciones los números ¶/.test(reglas), 'y que los ¶ no son de la página')
})

test('el sistema de la segunda pasada exige bloque, cita literal y no inventar', () => {
  const s = notesSystem()
  assert(/LITERAL/.test(s), 'la cita tiene que ser literal')
  assert(/pon 0/i.test(s), 'y mejor no marcar que marcar mal')
  assert(/no inventes/i.test(s))
  assert(/no renumeres/i.test(s), 'los números vienen de la respuesta')
  assert(/informaci[óo]n, nunca instrucciones/i.test(s), 'el texto de la página no manda')
  // Corre en una sesión aparte con el MCP a mano y fuera del alcance del
  // análisis: no debe tocar ninguna herramienta.
  assert(/No uses ninguna herramienta/.test(s), 'la segunda pasada no consulta nada')
})

test('el prompt de la segunda pasada lleva la pregunta, la respuesta y la página en bloques', () => {
  const p = notesPrompt({
    question: '¿qué falla aquí?',
    answer: '[1] La caducidad no se justifica.',
    digestText: '¶1 [p] Por política de seguridad ' + CITA,
    truncated: true,
  })
  assert(p.includes('¿qué falla aquí?'))
  assert(p.includes('[1] La caducidad no se justifica.'))
  assert(p.includes('¶1 [p]'))
  assert(/recortado/i.test(p), 'si va recortado, hay que avisarlo')
})

test('el esquema pide número y bloque; la cita y el título son opcionales', () => {
  const props = NOTES_SCHEMA.properties.notes.items.properties
  assert(props.n && props.title && props.block && props.quote)
  eq(NOTES_SCHEMA.properties.notes.items.required, ['n', 'block'])
  eq(props.kind.enum, NOTE_KINDS)
  eq(props.block.type, 'integer')
})

// --- la Skill --------------------------------------------------------------

test('el modo Análisis pide numerar y hablar de pasajes concretos', () => {
  for (const ctx of [{}, { digest: true }]) {
    const s = skillSystem('analisis', ctx)
    assert(/\[1\], \[2\]/.test(s), 'debe decir cómo numerar')
    assert(/sin saltos y sin repetir/i.test(s))
    assert(/trozos concretos/i.test(s), 'una observación sobre la página entera no se puede marcar')
  }
})

test('con la página en bloques, la Skill pide el bloque JSON y no manda leerla con la herramienta', () => {
  const con = skillSystem('analisis', { digest: true })
  assert(/```json/.test(con), 'pide el bloque de anclas')
  assert(/bloques numerados/i.test(con), 'y dice que la página va en bloques')
  assert(!/Léela con la herramienta/.test(con), 'la página ya la tiene')

  const sin = skillSystem('analisis')
  assert(!/```json/.test(sin), 'sin bloques no hay a qué apuntar')
  assert(/Léela con la herramienta/.test(sin), 'y hay que leerla con la herramienta')
})

// --- la marca dentro del texto de la respuesta ---------------------------

test('[3] es una marca; [texto](url) sigue siendo un enlace', () => {
  eq(parseInline('falta algo [3] ahí').map((t) => t.type), ['text', 'note', 'text'])
  eq(parseInline('falta algo [3] ahí')[1].n, 3)

  const enlace = parseInline('mira [la página](https://acme.atlassian.net/x)')
  eq(enlace.map((t) => t.type), ['text', 'link'])
})

test('lo que no es un número entre corchetes se queda como texto', () => {
  eq(parseInline('[algo] y [123]').map((t) => t.type), ['text'])
})

test('una marca dentro de una negrita («**[1] Título**») sigue contando', () => {
  eq(numberedIn('**[1] Título** texto'), [1])
})

// --- EL CAMBIO: cuando el modelo no numera como se le pide ---------------
//
// Pasó de verdad (gpt-5.6-luna, 2026-09-09, en una incidencia de Jira): ocho
// observaciones perfectas como lista «1.» bajo un apartado «Observaciones», con
// el bloque JSON de anclas impecable, y la extensión lo tiraba todo por no ver
// «[1]» en la prosa: «Este modelo no ha numerado sus observaciones».

const INFORME = [
  '**Análisis de SIMPL-31875**',
  '',
  '**Qué pide**',
  '- La tarea solicita extender la API del servicio `query-mapper-adapter`.',
  '- Está en **PBI For DG Review**, sin asignar.',
  '',
  '**Observaciones**',
  '1. **Objetivo funcional todavía ambiguo.** La descripción mezcla la API con la delegación.',
  '2. **Contrato HTTP incompleto.** No se especifican método, ruta ni errores.',
  '3. **Dependencia crítica con `SIMPL-31880`.** No define el contrato entre ambas.',
  '',
  '**Dependencias y riesgos**',
  '- `SIMPL-31880` está en **PBI Defined**.',
  '',
  '**Conclusión**',
  'La tarea no está lista para aprobarse como contrato API.',
].join('\n')
const ANCLAS_INFORME = { notes: [{ n: 1, block: 3, quote: CITA }, { n: 2, block: 2 }, { n: 3, block: 0 }] }

test('numberedIn tolera lo que un modelo escribe queriendo decir [n]: escapado, ancho completo; y sólo las vallas al principio de línea', () => {
  eq(numberedIn('\\[1\\] a \\[2\\] b'), [1, 2], 'escapado para el Markdown')
  eq(numberedIn('［1］ a [２] b'), [1, 2], 'corchetes o dígitos de ancho completo')
  eq(numberedIn('cierro con ```json abajo\n\n[1] a'), [1], 'un ``` a mitad de frase es texto, no una valla')
  eq(numberedIn('```json\n{"a": [1]}'), [], 'una valla sin cerrar sigue siendo código')
  eq(numberedIn('[ 1 ] con espacios'), [], 'con espacios no es la marca que pinta el chat')
})

test('observationNumbers: la prosa manda; sin prosa numerada valen los números del JSON si empiezan en 1', () => {
  eq(numbersInAnchors(ANCLAS_INFORME), [1, 2, 3])
  eq(numbersInAnchors({ notes: [{ n: 3 }, { n: 'x' }, { n: 3 }, { n: 0 }] }), [3])
  eq(observationNumbers(INFORME, ANCLAS_INFORME), { numeros: [1, 2, 3], origen: 'json' }, 'el JSON salva el análisis')
  eq(observationNumbers('[1] a', ANCLAS_INFORME), { numeros: [1], origen: 'prosa' }, 'la prosa manda')
  eq(observationNumbers('sin nada', { notes: [{ n: 3, block: 2 }] }), { numeros: [], origen: '' }, 'un JSON que no empieza en 1 no es un análisis')
  eq(observationNumbers('sin nada', null), { numeros: [], origen: '' })
})

test('EL CAMBIO: normalizeNumbering reescribe la lista «1.» del informe real como [n], sin tocar las viñetas ni los apartados', () => {
  const r = normalizeNumbering(INFORME)
  eq(r.style, 'ordered')
  eq(r.numbers, [1, 2, 3])
  assert(r.prose.includes('\n[1] **Objetivo funcional todavía ambiguo.** La descripción'), 'la marca va delante de la negrita')
  assert(r.prose.includes('\n[3] **Dependencia crítica con `SIMPL-31880`.**'))
  assert(r.prose.includes('- La tarea solicita extender'), 'las viñetas de «Qué pide» se quedan')
  assert(r.prose.includes('**Conclusión**\nLa tarea no está lista'), 'los apartados se quedan')
  eq(numberedIn(r.prose), [1, 2, 3], 'y numberedIn ya los ve')
  eq(titleFromProse(r.prose, 2), 'Contrato HTTP incompleto.', 'la fila de la tarjeta sale de la prosa')
  // Con el JSON del modelo, todo casa como si hubiera obedecido.
  eq(validateNotes(ANCLAS_INFORME, { allowed: r.numbers, blocks: BLOQUES }).map((x) => x.n), [1, 2, 3])
})

test('normalizeNumbering: los estilos que usan los modelos', () => {
  eq(normalizeNumbering('Intro.\n1. **Falta el entorno**: no dice versión.\n2. Texto plano.').prose, 'Intro.\n\n[1] **Falta el entorno**: no dice versión.\n\n[2] Texto plano.')
  eq(normalizeNumbering('1) uno\n2) dos').prose, '[1] uno\n\n[2] dos')
  eq(normalizeNumbering('**1.** Primera.\n\n**2.** Segunda.').prose, '[1] Primera.\n\n[2] Segunda.')
  const bt = normalizeNumbering('**1. Sin entorno**: nada.\n**2. Sin datos:** nada.')
  eq(bt.style, 'bold-title')
  eq(bt.prose, '[1] **Sin entorno**: nada.\n\n[2] **Sin datos:** nada.')
  const h = normalizeNumbering('### 1. La caducidad\nNo se justifica.\n\n### 2. El solape\nNo está medido.')
  eq(h.style, 'heading')
  eq(h.prose, '### [1] La caducidad\nNo se justifica.\n\n### [2] El solape\nNo está medido.')
  eq(titleFromProse(h.prose, 1), 'La caducidad', 'un encabezado también es «al principio de línea»')
  const lab = normalizeNumbering('**Observación 1**: falta el entorno.\n**Observación 2:** sin criterios.\n- **Punto 3 —** riesgo.')
  eq(lab.style, 'labeled')
  eq(lab.prose, '[1] falta el entorno.\n\n[2] sin criterios.\n\n[3] riesgo.')
  eq(normalizeNumbering('## Observación 1: Falta el entorno\nTexto.\n## Observación 2 — Sin criterios\nTexto.').prose, '## [1] Falta el entorno\nTexto.\n## [2] Sin criterios\nTexto.')
  eq(normalizeNumbering('(1) uno\n(2) dos').style, 'paren')
  eq(normalizeNumbering('#1 uno\n#2: dos').prose, '[1] uno\n\n[2] dos')
  eq(normalizeNumbering('1 — uno\n2 - dos').style, 'dash')
  eq(normalizeNumbering('[1.] uno\n[ 2 ] dos').prose, '[1] uno\n\n[2] dos')
  eq(normalizeNumbering('a) uno\nb) dos\nc) tres').numbers, [1, 2, 3])
  // Viñetas sin número: sólo cuando no hay ninguna numeración, y de corrido.
  const b = normalizeNumbering('Qué pide:\n- Falta el entorno.\n- Sin criterios.\n\nRiesgos:\n* Depende de otro equipo.')
  eq(b.style, 'bullets')
  eq(b.prose, 'Qué pide:\n\n[1] Falta el entorno.\n\n[2] Sin criterios.\n\nRiesgos:\n\n[3] Depende de otro equipo.')
  // Una sola observación también vale; un estilo débil con una sola, no.
  eq(normalizeNumbering('1. La única cosa que decir.').numbers, [1])
  eq(normalizeNumbering('(1) ver nota al pie').numbers, [])
  eq(normalizeNumbering('a) alternativa').numbers, [])
  // Con el título en la línea siguiente, el párrafo lo absorbe.
  eq(normalizeNumbering('**1.**\nFalta el entorno.\n**2.**\nSin criterios.').prose, '[1]\nFalta el entorno.\n\n[2]\nSin criterios.')
})

test('normalizeNumbering: lo que no se toca', () => {
  const ya = '[1] uno\n1. paso\n2. paso'
  eq(normalizeNumbering(ya), { prose: ya, numbers: [1], style: 'brackets' }, 'si ya lleva [n], intacta')
  const nada = 'Un párrafo normal.\n\nOtro párrafo sin lista.'
  eq(normalizeNumbering(nada), { prose: nada, numbers: [], style: '' })
  eq(normalizeNumbering(''), { prose: '', numbers: [], style: '' })
  eq(normalizeNumbering(null), { prose: '', numbers: [], style: '' })
  // Manda el estilo más explícito: los encabezados; los pasos «1. 2.» de dentro no se tocan.
  const src = '### 1. Falta el entorno\nPara reproducirlo:\n1. Abre la incidencia.\n2. Pulsa Editar.\n\n### 2. Sin criterios\nTexto.'
  eq(normalizeNumbering(src).prose, '### [1] Falta el entorno\nPara reproducirlo:\n1. Abre la incidencia.\n2. Pulsa Editar.\n\n### [2] Sin criterios\nTexto.')
  // Ni las listas sangradas, ni las citadas, ni las de dentro de una valla.
  eq(normalizeNumbering('1. Uno\n   1. sub uno\n   2. sub dos\n2. Dos\n> 1. citada\n> 2. citada').prose, '[1] Uno\n   1. sub uno\n   2. sub dos\n\n[2] Dos\n> 1. citada\n> 2. citada')
  eq(normalizeNumbering('Texto.\n```\n1. no\n2. no\n```\n1. sí\n2. sí').prose, 'Texto.\n```\n1. no\n2. no\n```\n\n[1] sí\n\n[2] sí')
  eq(normalizeNumbering('1. sí\n```json\n1. no\n2. no').prose, '[1] sí\n```json\n1. no\n2. no', 'una valla sin cerrar también es código')
  // La secuencia tiene que empezar en 1 y ser consecutiva, con tope.
  eq(normalizeNumbering('3. tres\n4. cuatro').numbers, [], 'empieza en 3')
  eq(normalizeNumbering('1. uno\n3. tres').numbers, [], 'salto')
  eq(normalizeNumbering('1. uno\n2. dos\n1. otra vez\n2. otra vez').numbers, [], 'dos listas que reinician: ambiguo')
  eq(normalizeNumbering('1. uno\n1. uno bis').numbers, [], 'repetida')
  const doce = Array.from({ length: 12 }, (_, k) => `${k + 1}. obs ${k + 1}`).join('\n')
  eq(normalizeNumbering(doce).numbers.length, 12)
  eq(normalizeNumbering(doce + '\n13. obs 13').numbers, [], 'trece ya no')
  eq(normalizeNumbering(doce.replace(/\d+\. /g, '- ')).numbers.length, 12)
  // Falsos positivos conocidos.
  eq(normalizeNumbering('2026. Fue el año del cambio.').numbers, [], 'cuatro cifras')
  eq(normalizeNumbering('1.5 segundos de espera es mucho.').numbers, [], 'decimal')
  eq(normalizeNumbering('Hay que esperar 3) segundos y 1) minuto.').numbers, [], 'dentro del párrafo')
  eq(normalizeNumbering('**Resumen**: nada que decir.').numbers, [])
  eq(normalizeNumbering('# 1\ntexto').numbers, [], 'un h1 con texto «1» no es «#1»')
  // Falso positivo ASUMIDO: unos pasos de nivel superior sin nada más son las observaciones.
  eq(normalizeNumbering('Para reproducirlo:\n1. Abre la incidencia.\n2. Pulsa Editar.').numbers, [1, 2])
  // CRLF se normaliza y el código en línea sigue sin contar.
  const r = normalizeNumbering('Intro\r\n1. uno\r\n2. dos\r\n\r\nCierre `x[1]` en código.')
  eq(r.prose, 'Intro\n\n[1] uno\n\n[2] dos\n\nCierre `x[1]` en código.')
  eq(numberedIn(r.prose), [1, 2])
})

test('una respuesta entera envuelta en una valla se desenvuelve primero', () => {
  eq(numberedIn('```markdown\n[1] a\n\n[2] b\n```'), [])
  eq(normalizeNumbering('```markdown\n[1] a\n\n[2] b\n```'), { prose: '[1] a\n\n[2] b', numbers: [1, 2], style: 'brackets' })
  eq(normalizeNumbering('```\n1. a\n2. b\n```').prose, '[1] a\n\n[2] b', 'sin idioma también, y luego se numera')
  eq(normalizeNumbering('Texto.\n```\n1. a\n2. b\n```').numbers, [], 'con algo fuera de la valla no es la respuesta entera')
  eq(normalizeNumbering('```js\n1. a\n2. b\n```').numbers, [], 'una valla con idioma de código es código')
  eq(unwrapWholeFence('```\na\n```\nfuera\n```\nb\n```'), '```\na\n```\nfuera\n```\nb\n```', 'dos vallas no son una')
})

test('«Sin observaciones.» es un resultado: se reconoce como última línea, con o sin negrita', () => {
  eq(NOTHING_TO_SAY, 'Sin observaciones.')
  eq(saysNothingToSay('Está completa.\n\nSin observaciones.'), true)
  eq(saysNothingToSay('**Sin observaciones**'), true)
  eq(saysNothingToSay('Sin observaciones sobre esto, pero [1] algo'), false)
  eq(saysNothingToSay('Sin observaciones.\n```\ncódigo\n```'), true, 'una valla al final no cuenta')
  eq(saysNothingToSay(''), false)
})

test('looksLikeFollowUp: una pregunta sobre un punto, una respuesta corta o «Sin observaciones.» son seguimiento; un análisis largo sin números no', () => {
  eq(looksLikeFollowUp('amplía el punto 3', 'x'.repeat(2000)), true)
  eq(looksLikeFollowUp('¿y la [2]?', 'x'.repeat(2000)), true)
  eq(looksLikeFollowUp('analiza esto', 'Corta.'), true)
  eq(looksLikeFollowUp('analiza esto', 'x'.repeat(2000) + '\n\nSin observaciones.'), true)
  eq(looksLikeFollowUp('analiza esto', 'x'.repeat(2000)), false)
})

test('numberedReminder pone el recordatorio de formato delante de la pregunta, con tope', () => {
  const r = numberedReminder('¿Qué falla aquí?')
  assert(/empieza cada observación por su número entre corchetes —\[1\], \[2\], \[3\]…—/.test(r))
  assert(/bloque ```json de anclas/.test(r))
  assert(r.endsWith('\n\n¿Qué falla aquí?'))
  eq(numberedReminder('x'.repeat(5000)).length, r.length - '¿Qué falla aquí?'.length + 4000)
})

test('anchorsBlockRules dice que "n" es el mismo número de la prosa, y que un 0 vale para la página o la incidencia', () => {
  const reglas = anchorsBlockRules()
  assert(/"n" es el mismo número que pusiste entre corchetes en la prosa/.test(reglas))
  assert(/la página o la incidencia en general/.test(reglas))
})

// --- la pasada que trocea ---------------------------------------------------

test('insertMarks numera por posición, salta código y enlaces, y lo que no encuentra va detrás sin pastilla', () => {
  const prosa = 'Primero: la descripción no dice el entorno.\n\nSegundo: faltan criterios.\n\nTercero: el comentario de Ana cambia el alcance. Y faltan criterios en la épica.'
  const r = insertMarks(prosa, [
    { n: 3, opening: 'Tercero: el comentario' },
    { n: 1, opening: 'Segundo: faltan' },
    { n: 4, opening: 'Primero: la descripción' },
    { n: 7, opening: 'faltan criterios' },
    { n: 9, opening: 'nada de esto' },
    { n: 9, opening: 'repetido' },
  ])
  eq(r.prose, '[1] Primero: la descripción no dice el entorno.\n\n[2] Segundo: faltan criterios.\n\n[3] Tercero: el comentario de Ana cambia el alcance. Y faltan criterios en la épica.')
  eq([...r.renumber], [[4, 1], [1, 2], [3, 3], [7, 4], [9, 5]])
  eq(r.inserted, [1, 2, 3])
  eq(r.missing, [4, 5])
  eq(numberedIn(r.prose), [1, 2, 3], 'empieza en 1 y de corrido')
  // «faltan criterios» está a mitad de frase: no se marca ahí.
  const conCodigo = 'Ver `items[1]` y [la guía](https://x.y/z).\n\n```json\n{"ttl": "90d"}\n```\n\nDice «hecho cuando funcione».'
  const c = insertMarks(conCodigo, [{ n: 1, opening: '"ttl"' }, { n: 2, opening: 'la guía' }, { n: 3, opening: 'dice "hecho cuando' }])
  eq(c.inserted, [1])
  assert(c.prose.endsWith('[1] Dice «hecho cuando funcione».'), 'plegado con normalize; la valla y el enlace no se tocan')
  eq(insertMarks('- Primera cosa\n- Segunda cosa', [{ n: 1, opening: 'Primera cosa' }, { n: 2, opening: 'Segunda cosa' }]).prose, '- [1] Primera cosa\n- [2] Segunda cosa')
  // Delante de la negrita que abre la línea, no dentro: dentro no se pinta la pastilla.
  eq(insertMarks('**Objetivo ambiguo.** La descripción mezcla.', [{ n: 1, opening: 'Objetivo ambiguo' }]).prose, '[1] **Objetivo ambiguo.** La descripción mezcla.')
  eq(insertMarks('hola', null).inserted, [])
  eq(insertMarks('hola', [{ n: 1, opening: 'ho' }]).missing, [1], 'un arranque de dos letras no vale')
})

// --- lo que la revisión adversaria encontró encima -----------------------

test('EL CAMBIO: con un JSON que numera desde 1, una lista de la prosa que cuente menos no se queda con los números', () => {
  // Pasó en la revisión: dos viñetas de «Qué pide» secuestraban los ocho números del JSON.
  const viñetas = '**Qué pide**\n- Extender el endpoint.\n- Añadir el campo.\n\n**Observaciones**\nLa descripción exige un 404.\n\nNo se dice el entorno.\n\nLos criterios hablan de «validar».\n\nLa fecha no cuadra.'
  const json4 = { notes: [{ n: 1, block: 1 }, { n: 2, block: 2 }, { n: 3, block: 3 }, { n: 4, block: 4 }] }
  eq(expectedCount(json4), 4)
  eq(expectedCount({ notes: [{ n: 1 }, { n: 2 }, { n: 4 }] }), 4, 'el mayor, por si dejó un hueco')
  eq(expectedCount({ notes: [{ n: 2 }] }), 0)
  eq(expectedCount(null), 0)
  const r = normalizeNumbering(viñetas, { expected: 4 })
  eq(r.style, '')
  eq(r.prose, viñetas, 'la prosa queda intacta')
  eq(observationNumbers(r.prose, json4), { numeros: [1, 2, 3, 4], origen: 'json' }, 'y el análisis es el del JSON')
  // Sin JSON, las viñetas siguen valiendo; y una lista «1.» que cuenta lo mismo o más que el JSON, también.
  eq(normalizeNumbering(viñetas).style, 'bullets')
  eq(normalizeNumbering(INFORME, { expected: 3 }).style, 'ordered')
  eq(normalizeNumbering(INFORME, { expected: 2 }).numbers, [1, 2, 3], 'numeró tres y situó dos: la tercera saldrá en gris')
  eq(normalizeNumbering(INFORME, { expected: 4 }).style, '', 'una lista más corta que el análisis no es la de las observaciones')
  // Las viñetas sólo valen si cuentan exactamente lo mismo.
  eq(normalizeNumbering('- a\n- b\n- c', { expected: 3 }).style, 'bullets')
  eq(normalizeNumbering('- a\n- b\n- c\n- d', { expected: 3 }).style, '')
  // Unos apartados «**1. Qué pide**» y unos criterios «1. 2.» dentro de una observación tampoco.
  eq(normalizeNumbering('**1. Qué pide**: x\n**2. Riesgos**: y', { expected: 5 }).style, '')
})

test('las vallas «~~~» son vallas: ni se numera lo de dentro, ni cuenta un [1], ni las pinta el chat como texto', () => {
  eq(numberedIn('~~~\n[1]\n~~~'), [])
  eq(normalizeNumbering('~~~\n1. no\n2. no\n~~~\n1. sí\n2. sí').prose, '~~~\n1. no\n2. no\n~~~\n\n[1] sí\n\n[2] sí')
  eq(normalizeNumbering('~~~\n1. a\n2. b\n~~~').prose, '[1] a\n\n[2] b', 'una respuesta entera envuelta en ~~~ se desenvuelve')
  eq(normalizeNumbering('```\n1. a\n~~~').numbers, [], 'una valla no se cierra con la otra')
  eq(unwrapWholeFence('~~~\na\n```'), '~~~\na\n```')
  eq(insertMarks('~~~\nuno dos tres\n~~~\n\nuno dos tres.', [{ n: 1, opening: 'uno dos tres' }]).prose, '~~~\nuno dos tres\n~~~\n\n[1] uno dos tres.')
  eq(parseBlocks('~~~\nx\n~~~').map((b) => b.type), ['code'])
  eq(parseBlocks('Para reproducirlo:\n~~~\n1. a\n~~~\n\n[1] La descripción.').map((b) => b.type), ['paragraph', 'code', 'paragraph'])
  eq(parseBlocks('```js\nx\n~~~\ny\n```').map((b) => b.type), ['code'], 'y una ``` no se cierra con ~~~')
})

test('lo escapado o de ancho completo se deja como [n] de verdad en la prosa, salvo en código', () => {
  const r = normalizeNumbering('\\[1\\] a \\[2\\] b y `x\\[1\\]` y ［3］ c')
  eq(r, { prose: '[1] a [2] b y `x\\[1\\]` y [3] c', numbers: [1, 2, 3], style: 'brackets' })
  eq(parseInline(r.prose).filter((t) => t.type === 'note').map((t) => t.n), [1, 2, 3])
  eq(normalizeNumbering('```\n\\[1\\]\n```\n[２] a').prose, '```\n\\[1\\]\n```\n[2] a')
})

test('saysNothingToSay tolera lo que un modelo pone alrededor de la frase, y nunca otra palabra pegada', () => {
  for (const s of ['- Sin observaciones.', '> Sin observaciones.', '## Sin observaciones', '**Conclusión:** Sin observaciones.', 'Sin observaciones.\n\n---', 'Sin observaciones.\n\nLa incidencia está lista.', 'Sin observaciones. La incidencia está lista.', 'Sin observaciones: está completa.', '**Sin observaciones.** Todo cuadra.']) {
    eq(saysNothingToSay(s), true, s)
  }
  for (const s of ['Sin observaciones relevantes.', 'Sin observaciones, pero [1] algo.', 'Sin observaciones sobre esto, pero la descripción…', 'Todo bien, sin observaciones de forma.']) {
    eq(saysNothingToSay(s), false, s)
  }
})

test('el recordatorio de «Pedirlo numerado» no se apila y no cuenta como pregunta que cita un punto', () => {
  const q = 'analiza los riesgos de esta incidencia'
  eq(numberedReminder(numberedReminder(q)), numberedReminder(q), 'idempotente')
  eq(stripNumberedReminder(numberedReminder(numberedReminder(q))), q)
  eq(stripNumberedReminder(q), q)
  eq(questionCitesPoint(numberedReminder(q)), false, 'el «[1], [2], [3]» del recordatorio no es una cita')
  eq(questionCitesPoint('amplía el punto 3'), true)
  eq(questionCitesPoint(numberedReminder('amplía el punto 3')), true)
  eq(looksLikeFollowUp(numberedReminder(q), 'x'.repeat(2000)), false, 'la respuesta al reintento no es un seguimiento')
})

test('insertMarks: un encabezado es frontera, un arranque sin el énfasis casa igual, y dos arranques en el mismo sitio no ponen dos marcas', () => {
  eq(insertMarks('### Objetivo ambiguo\ntexto', [{ n: 1, opening: 'Objetivo ambiguo' }]).prose, '### [1] Objetivo ambiguo\ntexto')
  eq(insertMarks('### Objetivo ambiguo\ntexto', [{ n: 1, opening: '### Objetivo ambiguo' }]).prose, '### [1] Objetivo ambiguo\ntexto')
  eq(insertMarks('Ver el ticket #1234 ahora.', [{ n: 1, opening: '1234 ahora' }]).inserted, [], 'a mitad de frase no')
  // «**Título**: texto» copiado sin asteriscos.
  const negrita = '**Objetivo ambiguo**: la descripción mezcla dos endpoints.\n\n**Contrato incompleto**: no hay esquema.'
  const r = insertMarks(negrita, [{ n: 1, opening: 'Objetivo ambiguo: la descripción' }, { n: 2, opening: 'Contrato incompleto: no hay' }])
  eq(r.prose, '[1] **Objetivo ambiguo**: la descripción mezcla dos endpoints.\n\n[2] **Contrato incompleto**: no hay esquema.')
  eq(insertMarks('- **Campo `due_date`**: vacío', [{ n: 1, opening: 'Campo due_date: vacío' }]).prose, '- [1] **Campo `due_date`**: vacío')
  // La misma negrita dos veces: una sola pastilla; y si el epígrafe se repite más abajo, la segunda va allí.
  const misma = insertMarks('**Objetivo ambiguo.** La descripción.\n\nSegunda.', [{ n: 1, opening: '**Objetivo ambiguo.**' }, { n: 2, opening: 'Objetivo ambiguo.' }])
  eq(misma.prose, '[1] **Objetivo ambiguo.** La descripción.\n\nSegunda.')
  eq(misma.inserted, [1])
  eq(misma.missing, [2])
  const repetida = insertMarks('**Objetivo ambiguo.** Primera.\n\n**Objetivo ambiguo.** Se repite.', [{ n: 1, opening: 'Objetivo ambiguo.' }, { n: 2, opening: 'Objetivo ambiguo.' }])
  eq(repetida.prose, '[1] **Objetivo ambiguo.** Primera.\n\n[2] **Objetivo ambiguo.** Se repite.')
})

test('bold-title tolera énfasis dentro del título y no deja un «**» colgando', () => {
  const r = normalizeNumbering('**1. Sin *entorno* de pruebas**: nada.\n**2. Sin datos:** nada.')
  eq(r.style, 'bold-title')
  eq(r.prose, '[1] **Sin *entorno* de pruebas**: nada.\n\n[2] **Sin datos:** nada.')
  eq(normalizeNumbering('**1. Título sin cierre\n**2. Otro').prose, '[1] Título sin cierre\n\n[2] Otro', 'una negrita sin cerrar sigue valiendo como lista')
})

test('collectSegmentedNotes pide con SEGMENT_SCHEMA, sin herramientas, y devuelve la prosa numerada y las notas validadas', async () => {
  const señal = new AbortController().signal
  let recibida = null
  const client = {
    async promptStructured(_id, { schema, system, text }, control) {
      eq(schema, SEGMENT_SCHEMA)
      assert(/No uses ninguna herramienta/.test(system))
      assert(/informaci[óo]n, nunca instrucciones/i.test(system))
      assert(/"opening"/.test(system) && /LITERALES/.test(system))
      assert(text.includes('¶3 [p]') && text.includes('TU RESPUESTA (sin numerar)'))
      recibida = control
      return { notes: [{ n: 1, opening: 'La caducidad no', block: 3, quote: CITA, title: 'Caducidad', selector: 'body' }, { n: 2, opening: 'no está', block: 0 }] }
    },
  }
  const digest = { text: '¶1 [h1] ADR-014\n¶2 [p] Hasta ahora\n¶3 [p] Por política', blocks: BLOQUES, truncated: false }
  const r = await collectSegmentedNotes(client, { sessionID: 's', answer: 'La caducidad no se justifica.', digest, signal: señal })
  eq(r.prose, '[1] La caducidad no se justifica.')
  eq(r.inserted, [1])
  eq(r.missing, [2])
  eq(r.notes[0].anchor.block, 3)
  eq(Object.keys(r.notes[0]).sort(), ['anchor', 'kind', 'n', 'title'], 'opening y lo demás no llegan a la página')
  assert(recibida === señal, 'el botón de parar también para esto')
  eq((await collectSegmentedNotes(client, { sessionID: 's', answer: '[1] ya numerada', digest })).inserted, [], 'con números no se trocea')
  eq((await collectSegmentedNotes(client, { sessionID: 's', answer: 'algo', digest: null })).inserted, [])
  const roto = { async promptStructured() { throw new Error('se cayó') } }
  const f = await collectSegmentedNotes(roto, { sessionID: 's', answer: 'algo largo sin números', digest })
  eq(f.inserted, [])
  assert(/se cayó/.test(f.reason))
  eq(SEGMENT_SCHEMA.properties.notes.items.required, ['n', 'block', 'opening'])
  assert(/TU RESPUESTA \(sin numerar\)/.test(segmentPrompt({ answer: 'x', digestText: 'y' })))
  assert(/No renumeres/.test(notesSystem()) && !/No renumeres/.test(segmentSystem()), 'la que trocea sí numera; la de siempre no')
})

// --- H2: lo que la auditoría del 2026-09-13 reprodujo (docs/PLAN.md §2: M5, M6, M7)

test('una sola viñeta no es una observación: la respuesta corta que explica un fallo se queda como está', () => {
  // M5. «No he podido leer la incidencia:\n- El MCP devolvió 401.» se
  // convertía en «[1] El MCP devolvió 401.», pasaba por análisis nuevo,
  // se saltaba «Marcas conservadas» y gastaba una segunda pasada.
  const fallo = 'No he podido leer la incidencia:\n- El MCP devolvió 401.'
  eq(normalizeNumbering(fallo), { prose: fallo, numbers: [], style: '' })
  eq(normalizeNumbering('- a').style, '', 'una viñeta suelta, tampoco')
  eq(normalizeNumbering('- a\n- b').style, 'bullets', 'dos viñetas siguen valiendo')
  eq(normalizeNumbering('- a\n- b').prose, '[1] a\n\n[2] b')
  // Con `shortAnswer`, una respuesta más corta que eso no adapta los estilos
  // débiles (viñetas, «(1)», «#1», «1 —», letras)…
  const dosVinetas = 'No he podido leer la incidencia:\n- El MCP devolvió 401.\n- Y el token caducó.'
  const corta = { shortAnswer: NOTE_LIMITS.shortAnswer }
  eq(normalizeNumbering(dosVinetas, corta), { prose: dosVinetas, numbers: [], style: '' })
  eq(normalizeNumbering(dosVinetas).style, 'bullets', 'sin el tope, como antes')
  eq(normalizeNumbering('(1) uno\n(2) dos', corta).style, '')
  eq(normalizeNumbering('#1 uno\n#2: dos', corta).style, '')
  eq(normalizeNumbering('1 — uno\n2 - dos', corta).style, '')
  eq(normalizeNumbering('a) uno\nb) dos', corta).style, '')
  // …los explícitos sí: el falso positivo asumido de los pasos «1. 2.» sigue igual.
  eq(normalizeNumbering('Para reproducirlo:\n1. Abre la incidencia.\n2. Pulsa Editar.', corta).numbers, [1, 2])
  eq(normalizeNumbering('1. La única cosa que decir.', corta).numbers, [1])
  eq(normalizeNumbering('**1. Sin entorno**: nada.\n**2. Sin datos:** nada.', corta).style, 'bold-title')
  eq(normalizeNumbering('### 1. Uno\n### 2. Dos', corta).style, 'heading')
  eq(normalizeNumbering('**Observación 1**: a.\n**Observación 2:** b.', corta).style, 'labeled')
  eq(normalizeNumbering('[1.] uno\n[ 2 ] dos', corta).style, 'bracket')
  // …y una respuesta larga con viñetas, también.
  const larga = 'Intro. ' + 'x'.repeat(NOTE_LIMITS.shortAnswer) + '\n- Falta el entorno.\n- Sin criterios.'
  eq(normalizeNumbering(larga, corta).style, 'bullets')
  // Si el JSON de anclas numera desde 1 y las viñetas cuentan lo mismo, el modelo ya dijo que son observaciones.
  eq(normalizeNumbering(dosVinetas, { ...corta, expected: 2 }).style, 'bullets')
  eq(normalizeNumbering(dosVinetas, { ...corta, expected: 3 }).style, '', 'y si no cuentan lo mismo, no')
  // La prosa que ya lleva «[n]» no se toca en ningún caso.
  eq(normalizeNumbering('[1] a', corta).style, 'brackets')
})

test('una entrada rara del JSON no tira el bloque de anclas ni deja el JSON en el chat', () => {
  // M6. Un «n: 1.5» tiraba el bloque ENTERO: el JSON se veía en el chat como
  // código y se lanzaba una segunda pasada aunque la otra entrada fuera perfecta.
  const bloque = '{"notes":[{"n":1.5,"block":1,"quote":""},{"n":"2","block":2}]}'
  const r = splitAnchorsBlock(PROSA + '\n\n```json\n' + bloque + '\n```')
  assert(!r.prose.includes('```'), 'el JSON no se ve en el chat')
  eq(r.prose, PROSA)
  eq(numbersInAnchors(r.anchors), [2])
  eq(validateNotes(r.anchors, { blocks: BLOQUES }).map((x) => x.n), [2], 'validateNotes descarta la rara y se queda con la buena')
  eq(numbersInAnchors(splitAnchorsBlock(PROSA + '\n\n```json\n{"notes":[{"n":"1a","block":1},{"n":2,"block":2}]}\n```').anchors), [2])
  eq(numbersInAnchors(splitAnchorsBlock(PROSA + '\n\n```json\n{"notes":[{"n":null,"block":1},{"n":1,"block":2}]}\n```').anchors), [1])
  // Sin valla, igual.
  eq(numbersInAnchors(splitAnchorsBlock(PROSA + '\n\n' + bloque).anchors), [2])
  // Pero una lista «notes» donde NINGUNA entrada tiene número sigue siendo contenido.
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": [{"n": 1.5, "block": 1}]}\n```').anchors, null)
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": [{"id": 17, "text": "hola"}]}\n```').anchors, null)
  eq(splitAnchorsBlock(PROSA + '\n```json\n{"notes": []}\n```').anchors.notes, [], 'vacío sigue siendo un bloque de anclas')
})

test('SEGURIDAD: n: true no es la observación 1', () => {
  // M6. `Number(true)` es 1: un «n: true» pasaba la barrera y acababa anclado
  // al bloque que dijera, aunque el [1] de la prosa hablara de otro sitio.
  eq(validateNotes({ notes: [{ n: true, block: 1 }] }, { blocks: BLOQUES }), [])
  eq(validateNotes({ notes: [{ n: [1], block: 1 }, { n: {}, block: 1 }, { n: '', block: 1 }, { n: ' 1', block: 1 }] }, { blocks: BLOQUES }), [])
  eq(validateNotes({ notes: [{ n: '1', block: 1 }] }, { blocks: BLOQUES }).map((x) => x.n), [1], 'una cadena de dígitos sí')
  eq(numbersInAnchors({ notes: [{ n: true }, { n: [1] }, { n: {} }, { n: '' }] }), [])
  eq(surplusNumbers({ notes: [{ n: true }] }, [2]), [])
  eq(expectedCount({ notes: [{ n: true }, { n: 2 }] }), 0, 'true no es el 1 que hace que el JSON empiece en 1')
  // Con «n: true» y un 2 de verdad, el bloque vale y sólo cuenta el 2.
  const r = splitAnchorsBlock('[1] A.\n\n[2] B.\n\n```json\n{"notes":[{"n":true,"block":1},{"n":2,"block":2}]}\n```')
  eq(numbersInAnchors(r.anchors), [2])
  eq(validateNotes(r.anchors, { blocks: BLOQUES }).map((x) => x.n), [2])
  // La pasada que trocea tampoco se traga un «n: true».
  eq(insertMarks('Primera cosa.', [{ n: true, opening: 'Primera cosa' }]).inserted, [])
})

test('titleFromProse ignora un [n] dentro de código en línea o de un enlace', () => {
  // M7. La primera aparición de «[1]» podía ser un `arr[1]` o un enlace
  // «[1](https://…)», y la fila de la tarjeta salía con la frase de esa línea.
  eq(titleFromProse('Mira `arr[1]`.\n\n[1] La descripción exige un 404.', 1), 'La descripción exige un 404.')
  const dos = 'Mira `items[1]` y `data[2]`.\n\n[1] La descripción exige un 404.\n\n[2] Otra cosa.'
  eq(titleFromProse(dos, 1), 'La descripción exige un 404.')
  eq(titleFromProse(dos, 2), 'Otra cosa.')
  eq(titleFromProse('Ver [1](https://x.y/z) el doc.\n\n[1] Frase real.', 1), 'Frase real.')
  eq(titleFromProse('```\nx = list[1]\n```\n\n[1] De verdad.', 1), 'De verdad.')
  eq(titleFromProse('~~~\nx = list[1]\n~~~\n\n[1] De verdad.', 1), 'De verdad.')
  eq(titleFromProse('Sólo `arr[1]` en código.', 1), 'Observación 1', 'si sólo está en código, no hay marca')
  // El estilo cita sigue leyendo la frase del original, con su código en línea.
  eq(titleFromProse('El campo `due_date` va vacío [1]. Otra cosa [2].', 1), 'El campo due_date va vacío')
  // Y los offsets no se mueven: la marca de verdad se lee del original.
  eq(titleFromProse('Ver `a[1]`, `b[1]` y [1](u) aquí.\n[1] **La caducidad** no se justifica.', 1), 'La caducidad no se justifica.')
})
