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
  splitAnchorsBlock,
  validateNotes,
  collectNotes,
  titleFromProse,
  surplusNumbers,
  anchorsBlockRules,
  notesSystem,
  notesPrompt,
  NOTES_SCHEMA,
  NOTE_KINDS,
  NOTE_LIMITS,
} from '../../src/panel/notes.js'
import { parseInline } from '../../src/panel/markdown.js'
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
