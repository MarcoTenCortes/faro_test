import { test, eq, assert } from '../harness.js'
import { parseBlocks, parseInline, isSafeHref } from '../../src/panel/markdown.js'

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
