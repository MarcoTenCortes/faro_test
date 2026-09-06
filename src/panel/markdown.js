/**
 * Markdown mínimo a nodos del DOM.
 *
 * Por qué no `innerHTML`: el texto que llega aquí lo escribe un modelo que
 * acaba de leer páginas de Confluence que puede haber escrito cualquiera. Si
 * lo inyectáramos como HTML, una página podría meter marcado en el panel.
 * Aquí todo se construye con `createElement` y `textContent`, así que lo peor
 * que puede pasar es que se vea un asterisco de más.
 *
 * El parser (`parseBlocks`) es puro y se prueba sin navegador.
 */

/** @returns {Array<{type:string, ...}>} */
export function parseBlocks(src) {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Bloque de código
    const fence = line.match(/^\s*```+\s*(\S*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      const body = []
      i++
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) body.push(lines[i++])
      i++ // cierre
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      const ordered = !!numbered
      const items = []
      while (i < lines.length) {
        const m = ordered ? lines[i].match(/^\s*\d+[.)]\s+(.*)$/) : lines[i].match(/^\s*[-*+]\s+(.*)$/)
        if (!m) break
        let text = m[1]
        i++
        // Continuación indentada de la misma viñeta.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i])) {
          text += ' ' + lines[i++].trim()
        }
        items.push(text)
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // Párrafo: hasta la línea en blanco o el inicio de otro bloque.
    const para = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++])
    blocks.push({ type: 'paragraph', text: para.join(' ') })
  }

  return blocks
}

function isBlockStart(line) {
  return (
    /^\s*```/.test(line) ||
    /^#{1,4}\s/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  )
}

/**
 * Trocea el texto en línea: negrita, cursiva, código y enlaces.
 * @returns {Array<{type:'text'|'strong'|'em'|'code'|'link', text:string, href?:string}>}
 */
export function parseInline(src) {
  const out = []
  const text = String(src ?? '')
  // Ojo con el orden: el enlace `[texto](url)` va ANTES que la marca `[3]`.
  // La alternancia se prueba de izquierda a derecha en cada posición, así que
  // un enlace markdown que empiece por un número sigue siendo un enlace.
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))|(\[\d{1,2}\])|(https?:\/\/[^\s<>()]+)/g

  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const token = m[0]

    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ type: 'strong', text: token.slice(2, -2) })
    } else if (token.startsWith('*')) {
      out.push({ type: 'em', text: token.slice(1, -1) })
    } else if (/^\[\d{1,2}\]$/.test(token)) {
      // La marca de una observación del análisis. En el panel se pinta como una
      // pastilla que lleva al subrayado correspondiente de la página. Las
      // observaciones empiezan en 1: un «[0]» es texto.
      const n = Number(token.slice(1, -1))
      out.push(n >= 1 ? { type: 'note', text: token, n } : { type: 'text', text: token })
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      if (link && isSafeHref(link[2])) out.push({ type: 'link', text: link[1], href: link[2] })
      else out.push({ type: 'text', text: token })
    } else {
      out.push(isSafeHref(token) ? { type: 'link', text: token, href: token } : { type: 'text', text: token })
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** Sólo http(s). Nada de javascript:, data:, file: ni protocolos raros. */
export function isSafeHref(href) {
  try {
    const u = new URL(href)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// --------------------------------------------------------------------- DOM

/**
 * Construye el fragmento del DOM. Sólo usable en navegador.
 * @param {{onLink?:Function, onNote?:Function}} opts `onNote` recibe el número
 *        de una marca del análisis cuando se pulsa; sin él, `[3]` es texto.
 */
export function renderMarkdown(src, { onLink, onNote } = {}) {
  const frag = document.createDocumentFragment()

  for (const block of parseBlocks(src)) {
    switch (block.type) {
      case 'heading': {
        const h = document.createElement('h' + Math.min(4, block.level + 2))
        h.className = 'md-h'
        appendInline(h, block.text, onLink, onNote)
        frag.appendChild(h)
        break
      }
      case 'code': {
        const pre = document.createElement('pre')
        pre.className = 'md-pre'
        const code = document.createElement('code')
        code.textContent = block.text
        if (block.lang) code.dataset.lang = block.lang
        pre.appendChild(code)
        frag.appendChild(pre)
        break
      }
      case 'quote': {
        const q = document.createElement('blockquote')
        q.className = 'md-quote'
        appendInline(q, block.text, onLink, onNote)
        frag.appendChild(q)
        break
      }
      case 'list': {
        const list = document.createElement(block.ordered ? 'ol' : 'ul')
        list.className = 'md-list'
        for (const item of block.items) {
          const li = document.createElement('li')
          appendInline(li, item, onLink, onNote)
          list.appendChild(li)
        }
        frag.appendChild(list)
        break
      }
      case 'rule':
        frag.appendChild(document.createElement('hr'))
        break
      default: {
        const p = document.createElement('p')
        p.className = 'md-p'
        appendInline(p, block.text, onLink, onNote)
        frag.appendChild(p)
      }
    }
  }

  return frag
}

function appendInline(parent, text, onLink, onNote) {
  for (const tok of parseInline(text)) {
    if (tok.type === 'text') {
      parent.appendChild(document.createTextNode(tok.text))
    } else if (tok.type === 'note') {
      // Sin nadie que la atienda no hay nada a lo que saltar: se queda en texto.
      if (!onNote) {
        parent.appendChild(document.createTextNode(tok.text))
        continue
      }
      const b = document.createElement('button')
      b.className = 'md-note'
      b.type = 'button'
      b.textContent = String(tok.n)
      b.title = 'Ver la observación ' + tok.n + ' en la página'
      b.addEventListener('click', () => onNote(tok.n))
      parent.appendChild(b)
    } else if (tok.type === 'link') {
      const a = document.createElement('a')
      a.textContent = tok.text
      a.href = tok.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      if (onLink) {
        a.addEventListener('click', (ev) => {
          ev.preventDefault()
          onLink(tok.href)
        })
      }
      parent.appendChild(a)
    } else {
      const el = document.createElement(tok.type === 'strong' ? 'strong' : tok.type === 'em' ? 'em' : 'code')
      el.textContent = tok.text
      parent.appendChild(el)
    }
  }
}
