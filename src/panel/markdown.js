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

    // Bloque de código: ``` o ~~~ (CommonMark), y cierra con el mismo carácter.
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(\S*)\s*$/)
    if (fence) {
      const lang = fence[2] || ''
      const cierre = fence[1][0] === '`' ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/
      const body = []
      i++
      while (i < lines.length && !cierre.test(lines[i])) body.push(lines[i++])
      // ¿Se vio la línea de cierre, o se acabó el texto? Se mira ANTES del
      // `i++`, que corre en los dos casos (H24: un diagrama sólo se dibuja con
      // la valla cerrada; durante el streaming, una abierta es código a medias).
      const closed = i < lines.length
      i++ // cierre
      blocks.push({ type: 'code', lang, text: body.join('\n'), closed })
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
    /^\s*(```|~~~)/.test(line) ||
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
  //
  // La negrita admite asteriscos SUELTOS dentro (`\*(?!\*)`: uno que no va
  // seguido de otro), así que «**a *b* c**» es una sola negrita con la cursiva
  // dentro, que se trocea al pintar. Reproducido en la auditoría del
  // 2026-09-13 (docs/PLAN.md §2.5 D7): con `[^*]+` no casaba «**Sin
  // *entorno***» —justo la forma que normalizeNumbering conserva en el estilo
  // bold-title— y salía la cursiva de «Sin » con los asteriscos a la vista.
  // Cada carácter sólo puede consumirlo una alternativa: sin cierre, el
  // retroceso es lineal, no exponencial.
  const re =
    /(`[^`]+`)|(\*\*(?:[^*]|\*(?!\*))+\*\*)|(__(?:[^_]|_(?!_))+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))|(\[\d{1,2}\])|(https?:\/\/[^\s<>()]+)/g

  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    let token = m[0]

    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      let inner = token.slice(2, -2)
      // «**Sin *entorno***»: la cursiva cierra pegada a la negrita y el regex
      // se ha quedado con los dos primeros asteriscos del «***». El tercero es
      // nuestro sólo si dentro queda una cursiva sin cerrar (un número impar
      // de asteriscos); si no («**a***b**»), se queda fuera y abre lo que abra.
      const marca = token[0]
      if (text[m.index + token.length] === marca && cuenta(inner, marca) % 2 === 1) {
        token += marca
        inner += marca
        re.lastIndex = m.index + token.length
      }
      out.push({ type: 'strong', text: inner })
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

function cuenta(s, marca) {
  let n = 0
  for (const c of s) if (c === marca) n++
  return n
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
 *
 * @param {{onLink?:Function, onNote?:Function, onCodeBlock?:Function, allowHref?:Function}} opts
 *        `onNote` recibe el número de una marca del análisis cuando se pulsa;
 *        sin él, `[3]` es texto. `allowHref(href)` decide si el enlace se
 *        puede abrir: el que diga que no NO se pinta como enlace (ver
 *        `blockedLink`); sin `allowHref`, todos se pintan (el banco y la
 *        vista previa del panel, que no tienen sitio contra el que mirar).
 *        `onCodeBlock({lang, text, closed}, pre)` (H24) recibe cada bloque de
 *        código con su `pre` ya construido: si devuelve un nodo, se pinta ESE
 *        en lugar del `pre` (así dibuja el panel un diagrama Mermaid); si
 *        devuelve `null`/`undefined` —o cualquier cosa que no sea un nodo—, el
 *        `pre` de siempre. Sin `onCodeBlock`, byte a byte lo de antes de H24.
 */
export function renderMarkdown(src, { onLink, onNote, onCodeBlock, allowHref } = {}) {
  const frag = document.createDocumentFragment()
  const opts = { onLink, onNote, allowHref }

  for (const block of parseBlocks(src)) {
    switch (block.type) {
      case 'heading': {
        const h = document.createElement('h' + Math.min(4, block.level + 2))
        h.className = 'md-h'
        appendInline(h, block.text, opts)
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
        const propio = onCodeBlock ? onCodeBlock({ lang: block.lang, text: block.text, closed: block.closed }, pre) : null
        frag.appendChild(esNodo(propio) ? propio : pre)
        break
      }
      case 'quote': {
        const q = document.createElement('blockquote')
        q.className = 'md-quote'
        appendInline(q, block.text, opts)
        frag.appendChild(q)
        break
      }
      case 'list': {
        const list = document.createElement(block.ordered ? 'ol' : 'ul')
        list.className = 'md-list'
        for (const item of block.items) {
          const li = document.createElement('li')
          appendInline(li, item, opts)
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
        appendInline(p, block.text, opts)
        frag.appendChild(p)
      }
    }
  }

  return frag
}

/**
 * ¿Es un nodo del DOM lo que devolvió `onCodeBlock`? Por `nodeType` y no por
 * `instanceof Node`, que en Node (las pruebas) no existe: así las pruebas
 * recorren el MISMO camino que el panel. Una cadena nunca pasa: no se
 * convierte en marcado ni en texto, se queda el `pre` (§8.12).
 */
function esNodo(valor) {
  return !!valor && typeof valor === 'object' && typeof valor.nodeType === 'number'
}

/**
 * Cómo se ve un enlace que el panel no abriría: texto, con la URL delante de
 * los ojos.
 *
 * Revisión adversaria de H2 (2026-09-14): H2 puso la regla de orígenes en
 * `openUrl` (`allowedLinkOrigin`), pero aquí se seguía escribiendo
 * `a.href` + `target="_blank"` en TODOS los enlaces, y un `href` no necesita
 * el manejador para abrirse: el clic central, «Abrir en pestaña nueva» del
 * menú contextual o arrastrarlo a la barra de direcciones se saltaban la
 * comprobación entera. Un enlace que no se puede abrir tampoco es un enlace:
 * se pinta como texto con su URL a la vista (si el texto YA es la URL, una
 * sola vez), para que se lea antes de copiarla a mano.
 *
 * Puro salvo el `createElement`.
 */
function blockedLink(tok) {
  const span = document.createElement('span')
  span.className = 'md-link-blocked'
  span.title = 'Enlace fuera del sitio'
  const etiqueta = String(tok.text || '').trim()
  span.textContent = etiqueta && etiqueta !== tok.href ? `${tok.text} (${tok.href})` : tok.href
  return span
}

function appendInline(parent, text, { onLink, onNote, allowHref } = {}) {
  const opts = { onLink, onNote, allowHref }
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
      // Lo que no se abriría ni siquiera se pinta como enlace (S5).
      if (allowHref && !allowHref(tok.href)) {
        parent.appendChild(blockedLink(tok))
        continue
      }
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
      // El interior de una negrita o una cursiva se vuelve a trocear SIEMPRE:
      // una marca «[1]» dentro de una negrita («**[1] Título**») también es
      // una pastilla (los modelos la ponen ahí a menudo, y numberedIn la
      // cuenta; sin onNote se queda en texto, como fuera), y una cursiva
      // dentro de una negrita («**Sin *entorno***», D7) se anida en vez de
      // verse con los asteriscos. En código, nada: `arr[1]` es código.
      if (tok.type === 'code') el.textContent = tok.text
      else appendInline(el, tok.text, opts)
      parent.appendChild(el)
    }
  }
}
