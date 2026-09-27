import { test, eq, assert } from '../harness.js'
import { parseBlocks, parseInline, isSafeHref, renderMarkdown } from '../../src/panel/markdown.js'

test('markdown: párrafos y encabezados', () => {
  const b = parseBlocks('# Título\n\nUn párrafo\ncon dos líneas.\n\n## Otro')
  eq(b.map((x) => x.type), ['heading', 'paragraph', 'heading'])
  eq(b[0].level, 1)
  eq(b[1].text, 'Un párrafo con dos líneas.')
})

test('markdown: listas con y sin números', () => {
  const b = parseBlocks('- uno\n- dos\n\n1. primero\n2. segundo')
  eq(b[0].type, 'list')
  eq(b[0].ordered, false)
  eq(b[0].items, ['uno', 'dos'])
  eq(b[1].ordered, true)
  eq(b[1].items, ['primero', 'segundo'])
})

test('markdown: bloque de código conserva el texto tal cual', () => {
  const b = parseBlocks('```js\nconst a = 1\n// # no es un título\n```')
  eq(b[0].type, 'code')
  eq(b[0].lang, 'js')
  eq(b[0].text, 'const a = 1\n// # no es un título')
})

test('markdown: cita', () => {
  const b = parseBlocks('> una cita\n> en dos líneas')
  eq(b[0].type, 'quote')
  eq(b[0].text, 'una cita\nen dos líneas')
})

test('markdown en línea: negrita, cursiva y código', () => {
  const t = parseInline('esto es **fuerte**, esto *suave* y esto `código`')
  const kinds = t.filter((x) => x.type !== 'text').map((x) => x.type)
  eq(kinds, ['strong', 'em', 'code'])
})

test('markdown: enlaces http se conservan', () => {
  const t = parseInline('mira [la página](https://acme.atlassian.net/wiki/x)')
  const link = t.find((x) => x.type === 'link')
  eq(link.href, 'https://acme.atlassian.net/wiki/x')
  eq(link.text, 'la página')
})

test('SEGURIDAD: un enlace javascript: se queda en texto plano', () => {
  const t = parseInline('[pincha](javascript:alert(1))')
  assert(!t.some((x) => x.type === 'link'), 'no debe convertirse en enlace')
})

test('SEGURIDAD: data: y file: tampoco', () => {
  eq(isSafeHref('data:text/html,<script>alert(1)</script>'), false)
  eq(isSafeHref('file:///etc/passwd'), false)
  eq(isSafeHref('vbscript:msgbox'), false)
  eq(isSafeHref('https://ok.example'), true)
  eq(isSafeHref('http://ok.example'), true)
})

test('SEGURIDAD: el HTML embebido se trata como texto, no como marcado', () => {
  // El parser no produce nodos HTML: sólo tokens. El renderizador usa
  // textContent, así que esto acaba viéndose literal.
  const b = parseBlocks('<img src=x onerror=alert(1)>')
  eq(b[0].type, 'paragraph')
  eq(b[0].text, '<img src=x onerror=alert(1)>')
})

test('markdown: entrada vacía o rara no rompe', () => {
  eq(parseBlocks(''), [])
  eq(parseBlocks(null), [])
  eq(parseInline(''), [])
  eq(parseBlocks('```\nsin cerrar')[0].type, 'code')
})

// --- D7: negrita con cursiva dentro -----------------------------------------
//
// Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2.5 D7): la
// negrita `(\*\*[^*]+\*\*)` no admitía ningún asterisco dentro, así que
// «**Sin *entorno***» —justo la forma que normalizeNumbering conserva en el
// estilo bold-title— salía como cursiva de «Sin » con los asteriscos a la
// vista. Los tokens que se pinan aquí son la forma real que produce el parser.

test('markdown en línea: una negrita con cursiva dentro es una sola negrita', () => {
  eq(parseInline('**a *b* c**'), [{ type: 'strong', text: 'a *b* c' }])
  eq(parseInline('__a *b* c__'), [{ type: 'strong', text: 'a *b* c' }])
  // El interior se vuelve a trocear al pintar: es lo que renderMarkdown anida.
  eq(parseInline('a *b* c'), [
    { type: 'text', text: 'a ' },
    { type: 'em', text: 'b' },
    { type: 'text', text: ' c' },
  ])
})

test('markdown en línea: «[1] **Sin *entorno***: x», la forma que normalizeNumbering conserva', () => {
  const t = parseInline('[1] **Sin *entorno***: x')
  eq(t.map((x) => x.type), ['note', 'text', 'strong', 'text'])
  eq(t[0].n, 1)
  eq(t[2], { type: 'strong', text: 'Sin *entorno*' })
  eq(t[3].text, ': x')
  // La cursiva cierra pegada a la negrita («***»): el tercer asterisco es suyo.
  eq(parseInline('Sin *entorno*'), [
    { type: 'text', text: 'Sin ' },
    { type: 'em', text: 'entorno' },
  ])
})

test('markdown en línea: «***a***» es cursiva dentro de negrita', () => {
  eq(parseInline('***a***'), [{ type: 'strong', text: '*a*' }])
  eq(parseInline('*a*'), [{ type: 'em', text: 'a' }])
})

test('markdown en línea: un tercer asterisco que no cierra ninguna cursiva se queda fuera de la negrita', () => {
  // «**a***b**»: la negrita es «a»; el asterisco sobrante abre la cursiva «b».
  eq(parseInline('**a***b**'), [
    { type: 'strong', text: 'a' },
    { type: 'em', text: 'b' },
    { type: 'text', text: '*' },
  ])
})

test('markdown en línea: un asterisco suelto o un guion bajo dentro de la negrita no la rompen', () => {
  eq(parseInline('**5 * 3**'), [{ type: 'strong', text: '5 * 3' }])
  eq(parseInline('__snake_case__'), [{ type: 'strong', text: 'snake_case' }])
  // Con guiones bajos la misma regla del tercer carácter; «_a_» no es cursiva
  // en este parser, así que se ve literal dentro de la negrita.
  eq(parseInline('___a___'), [{ type: 'strong', text: '_a_' }])
  eq(parseInline('__a___'), [{ type: 'strong', text: 'a' }, { type: 'text', text: '_' }])
  // Lo de siempre sigue igual: dos negritas seguidas no se funden en una.
  eq(parseInline('**a** y **b**').map((x) => x.type), ['strong', 'text', 'strong'])
  eq(parseInline('**a** y **b**')[1].text, ' y ')
})

test('SEGURIDAD: una negrita sin cerrar con miles de asteriscos sueltos no cuelga el panel', () => {
  // La alternativa «asterisco que no va seguido de otro» es la única forma de
  // consumir cada carácter: sin ambigüedad no hay retroceso exponencial.
  const texto = '**' + 'a *'.repeat(4000) + '\n' + '__' + 'b _'.repeat(4000)
  const t0 = Date.now()
  const t = parseInline(texto)
  const ms = Date.now() - t0
  assert(ms < 500, `parseInline tardó ${ms} ms`)
  assert(!t.some((x) => x.type === 'strong'), 'sin cierre no hay negrita')
})

// Un `document` mínimo para probar renderMarkdown en Node: sólo lo que el
// renderizador usa (createElement, createTextNode, createDocumentFragment,
// appendChild, textContent, addEventListener, dataset). Se instala dentro de
// cada prueba y se restaura en finally (§9).
function documentoFalso() {
  const elemento = (tag) => ({
    tagName: tag,
    // H24: `renderMarkdown` decide por `nodeType` si lo que devuelve
    // `onCodeBlock` es un nodo (1 elemento, 3 texto, 11 fragmento, como el DOM).
    nodeType: tag === '#fragment' ? 11 : 1,
    className: '',
    dataset: {},
    listeners: {},
    children: [],
    appendChild(hijo) {
      this.children.push(hijo)
      return hijo
    },
    addEventListener(tipo, fn) {
      ;(this.listeners[tipo] ||= []).push(fn)
    },
    get textContent() {
      return this.children.map((c) => c.textContent).join('')
    },
    set textContent(v) {
      this.children = [texto(v)]
    },
  })
  const texto = (v) => ({ tagName: '#text', nodeType: 3, textContent: String(v), children: [] })
  return {
    createDocumentFragment: () => elemento('#fragment'),
    createElement: (tag) => elemento(String(tag).toLowerCase()),
    createTextNode: texto,
  }
}

function conDocument(fn) {
  const antes = globalThis.document
  globalThis.document = documentoFalso()
  try {
    return fn()
  } finally {
    if (antes === undefined) delete globalThis.document
    else globalThis.document = antes
  }
}

/** Forma compacta del árbol: texto → cadena; elemento → { 'tag.clase': hijos }. */
function forma(nodo) {
  if (nodo.tagName === '#text') return nodo.textContent
  return { [nodo.tagName + (nodo.className ? '.' + nodo.className : '')]: nodo.children.map(forma) }
}

test('renderMarkdown: la pastilla [n] dentro de una negrita sigue pintándose, y la cursiva dentro de la negrita se anida', () => {
  conDocument(() => {
    const pulsadas = []
    const frag = renderMarkdown('**[1] Sin *entorno***: x', { onNote: (n) => pulsadas.push(n) })
    eq(forma(frag), {
      '#fragment': [
        {
          'p.md-p': [{ strong: [{ 'button.md-note': ['1'] }, ' Sin ', { em: ['entorno'] }] }, ': x'],
        },
      ],
    })
    const boton = frag.children[0].children[0].children[0]
    eq(boton.type, 'button')
    boton.listeners.click[0]()
    eq(pulsadas, [1])
  })
})

test('renderMarkdown: sin onNote la marca es texto, pero la cursiva dentro de la negrita se sigue anidando', () => {
  conDocument(() => {
    const frag = renderMarkdown('[1] **Sin *entorno***: x')
    eq(forma(frag), {
      '#fragment': [{ 'p.md-p': ['[1]', ' ', { strong: ['Sin ', { em: ['entorno'] }] }, ': x'] }],
    })
  })
})

test('renderMarkdown: en código no se anida nada («`arr[1]`» no es una pastilla)', () => {
  conDocument(() => {
    const frag = renderMarkdown('**mira `arr[1]`** y `*no es cursiva*`', { onNote: () => {} })
    eq(forma(frag), {
      '#fragment': [{ 'p.md-p': [{ strong: ['mira ', { code: ['arr[1]'] }] }, ' y ', { code: ['*no es cursiva*'] }] }],
    })
  })
})

// --- S5 a medias: el enlace que openUrl no abriría tampoco se pinta ---------
//
// Revisión adversaria de H2 (2026-09-14): H2 dejó `openUrl` mirando el origen
// (`allowedLinkOrigin`), pero aquí se seguía poniendo `a.href` + `target=_blank`
// en TODOS los enlaces. Un clic central, «Abrir en pestaña nueva» del menú
// contextual o arrastrar el enlace esquivan el manejador y abren el dominio
// inyectado igual. Con `allowHref`, lo que no se puede abrir ni siquiera es un
// enlace: es texto con la URL a la vista, para que se lea antes de copiarla.

test('SEGURIDAD S5: con allowHref que rechaza, el enlace es texto con la URL a la vista y sin href', () => {
  conDocument(() => {
    const pulsados = []
    const vistos = []
    const frag = renderMarkdown('mira [la política](https://evil.example/x) y vuelve', {
      onLink: (h) => pulsados.push(h),
      allowHref: (h) => {
        vistos.push(h)
        return false
      },
    })
    eq(forma(frag), {
      '#fragment': [
        {
          'p.md-p': ['mira ', { 'span.md-link-blocked': ['la política (https://evil.example/x)'] }, ' y vuelve'],
        },
      ],
    })
    eq(vistos, ['https://evil.example/x'], 'se pregunta por el enlace tal cual')
    const span = frag.children[0].children[1]
    eq(span.href, undefined, 'SEGURIDAD: sin href no hay clic central ni «Abrir en pestaña nueva»')
    eq(span.target, undefined)
    eq(span.listeners.click, undefined, 'ni manejador')
    eq(span.title, 'Enlace fuera del sitio')
    eq(pulsados, [])
  })
})

test('SEGURIDAD S5: una URL suelta rechazada se ve una sola vez', () => {
  conDocument(() => {
    const frag = renderMarkdown('copia https://evil.example/x a mano', { allowHref: () => false })
    eq(forma(frag), {
      '#fragment': [{ 'p.md-p': ['copia ', { 'span.md-link-blocked': ['https://evil.example/x'] }, ' a mano'] }],
    })
  })
})

test('SEGURIDAD S5: un enlace rechazado dentro de una negrita tampoco es enlace', () => {
  conDocument(() => {
    const frag = renderMarkdown('**mira [aquí](https://evil.example/x)**', { allowHref: () => false })
    eq(forma(frag), {
      '#fragment': [
        { 'p.md-p': [{ strong: ['mira ', { 'span.md-link-blocked': ['aquí (https://evil.example/x)'] }] }] },
      ],
    })
  })
})

test('S5: con allowHref que acepta, el enlace sigue siendo el de siempre', () => {
  conDocument(() => {
    const pulsados = []
    const frag = renderMarkdown('mira [la página](https://acme.atlassian.net/wiki/x)', {
      onLink: (h) => pulsados.push(h),
      allowHref: () => true,
    })
    eq(forma(frag), { '#fragment': [{ 'p.md-p': ['mira ', { a: ['la página'] }] }] })
    const a = frag.children[0].children[1]
    eq(a.href, 'https://acme.atlassian.net/wiki/x')
    eq(a.target, '_blank')
    eq(a.rel, 'noopener noreferrer')
    a.listeners.click[0]({ preventDefault: () => {} })
    eq(pulsados, ['https://acme.atlassian.net/wiki/x'])
  })
})

test('S5: sin allowHref, lo de hoy no cambia (el banco y la vista previa no pasan ninguno)', () => {
  conDocument(() => {
    const frag = renderMarkdown('mira [la política](https://evil.example/x)', { onLink: () => {} })
    eq(forma(frag), { '#fragment': [{ 'p.md-p': ['mira ', { a: ['la política'] }] }] })
    eq(frag.children[0].children[1].href, 'https://evil.example/x')
  })
})

// --- H24: la valla dice si cerró, y el bloque de código tiene un gancho --------
//
// El diagrama sólo se dibuja con la valla CERRADA: durante el streaming una
// valla abierta es código a medio escribir, y dibujarla daría un diagrama a
// trozos que cambia en cada frame. Hasta H24 `parseBlocks` consumía hasta el
// cierre o el final del texto sin distinguir un caso del otro (hecho M1: el
// `i++` del cierre corría en los dos). `onCodeBlock` es el gancho por el que el
// panel sustituye el `pre` por el dibujo; sin él, todo como siempre.

test('markdown H24: el bloque de código dice si su valla cerró (closed), con ``` y con ~~~', () => {
  const cerrada = parseBlocks('```mermaid\nflowchart LR\nA --> B\n```\ndespués')
  eq(Object.keys(cerrada[0]).sort(), ['closed', 'lang', 'text', 'type'], 'claves EXACTAS del bloque de código')
  eq(cerrada[0], { type: 'code', lang: 'mermaid', text: 'flowchart LR\nA --> B', closed: true })
  eq(cerrada[1], { type: 'paragraph', text: 'después' }, 'lo de detrás de la valla sigue siendo prosa')
  eq(parseBlocks('~~~\nx\n~~~')[0], { type: 'code', lang: '', text: 'x', closed: true }, 'con ~~~ también')
  eq(parseBlocks('```\nx\n`````')[0].closed, true, 'más acentos que la apertura cierran si el carácter es el mismo')
  eq(parseBlocks('```mermaid\nflowchart LR\nA --> B')[0], { type: 'code', lang: 'mermaid', text: 'flowchart LR\nA --> B', closed: false }, 'sin cierre: consume hasta el final y lo dice')
  eq(parseBlocks('~~~\nx')[0].closed, false)
  // Como hoy: una valla de ``` no la cierra una de ~~~ (ni con más), así que
  // la de ~~~ es texto del bloque y éste sigue abierto hasta el final.
  eq(parseBlocks('```\nx\n~~~~\ny')[0], { type: 'code', lang: '', text: 'x\n~~~~\ny', closed: false })
  eq(parseBlocks('```\n```')[0], { type: 'code', lang: '', text: '', closed: true }, 'vacía y cerrada')
  eq(parseBlocks('```')[0], { type: 'code', lang: '', text: '', closed: false }, 'sólo la apertura: abierta')
})

test('renderMarkdown H24: sin onCodeBlock el código se pinta como siempre, y un onCodeBlock que devuelve null deja el pre', () => {
  conDocument(() => {
    const textos = [
      'antes\n\n```js\nconst a = 1\n```\n\ndespués',
      '~~~\nsin lenguaje\n~~~',
      '```mermaid\nflowchart LR\nA --> B',
    ]
    const esperadas = [
      { '#fragment': [{ 'p.md-p': ['antes'] }, { 'pre.md-pre': [{ code: ['const a = 1'] }] }, { 'p.md-p': ['después'] }] },
      { '#fragment': [{ 'pre.md-pre': [{ code: ['sin lenguaje'] }] }] },
      { '#fragment': [{ 'pre.md-pre': [{ code: ['flowchart LR\nA --> B'] }] }] },
    ]
    const lenguajes = (frag) => frag.children.filter((c) => c.tagName === 'pre').map((pre) => pre.children[0].dataset.lang)
    textos.forEach((texto, i) => {
      const frag = renderMarkdown(texto, { onLink: () => {}, onNote: () => {}, allowHref: () => true })
      eq(forma(frag), esperadas[i], `sin onCodeBlock, byte a byte lo de siempre (${i})`)
      eq(lenguajes(frag), [['js', undefined, 'mermaid'][i]], 'data-lang sólo con lenguaje')
    })
    const recibidos = []
    textos.forEach((texto, i) => {
      const frag = renderMarkdown(texto, {
        onCodeBlock: (block, pre) => {
          recibidos.push([block, forma(pre)])
          return i === 0 ? null : undefined
        },
      })
      eq(forma(frag), esperadas[i], `null o undefined: el pre de siempre (${i})`)
    })
    eq(recibidos, [
      [{ lang: 'js', text: 'const a = 1', closed: true }, { 'pre.md-pre': [{ code: ['const a = 1'] }] }],
      [{ lang: '', text: 'sin lenguaje', closed: true }, { 'pre.md-pre': [{ code: ['sin lenguaje'] }] }],
      [{ lang: 'mermaid', text: 'flowchart LR\nA --> B', closed: false }, { 'pre.md-pre': [{ code: ['flowchart LR\nA --> B'] }] }],
    ], 'el gancho recibe {lang, text, closed} y el pre YA construido; la valla sin cerrar llega con closed: false')
  })
})

test('renderMarkdown H24: un onCodeBlock que devuelve un nodo lo pone EN LUGAR del pre, y sólo en ese bloque', () => {
  conDocument(() => {
    const pres = []
    const frag = renderMarkdown('uno\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```js\nx\n```', {
      onCodeBlock: (block, pre) => {
        pres.push(pre)
        if (block.lang !== 'mermaid' || !block.closed) return null
        const figura = document.createElement('figure')
        figura.className = 'dg-wrap'
        figura.textContent = 'dibujo de ' + block.text.split('\n')[1]
        return figura
      },
    })
    eq(forma(frag), {
      '#fragment': [{ 'p.md-p': ['uno'] }, { 'figure.dg-wrap': ['dibujo de A --> B'] }, { 'pre.md-pre': [{ code: ['x'] }] }],
    })
    eq(pres.length, 2, 'una llamada por bloque de código')
    assert(frag.children[2] === pres[1], 'el pre que se devolvió null es el mismo que se construyó')
    // Lo que no es un nodo (una cadena, un número) no se cuela en el árbol.
    const otra = renderMarkdown('```\nx\n```', { onCodeBlock: () => '<img src=x onerror=alert(1)>' })
    eq(forma(otra), { '#fragment': [{ 'pre.md-pre': [{ code: ['x'] }] }] }, 'SEGURIDAD: una cadena no es un nodo: el pre')
  })
})
