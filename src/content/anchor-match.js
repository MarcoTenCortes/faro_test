/**
 * Localización de una cita dentro de un texto.
 *
 * Es el clásico TextQuoteSelector de la anotación web: texto exacto más un
 * poco de contexto por delante y por detrás para desambiguar cuando la misma
 * frase aparece varias veces. Aguanta que la página se reedite alrededor.
 *
 * Módulo puro, sin DOM: por eso se puede probar de verdad.
 */

/**
 * Normaliza para comparar: espacios colapsados, minúsculas, comillas y guiones
 * tipográficos unificados. Devuelve también el mapa de posiciones para poder
 * volver al texto original.
 *
 * @returns {{text: string, map: number[]}}
 */
export function normalize(input) {
  const text = []
  const map = []
  let lastWasSpace = true // recorta también el espacio inicial

  for (let i = 0; i < input.length; i++) {
    let ch = input[i]

    if (/\s/.test(ch)) {
      if (lastWasSpace) continue
      text.push(' ')
      map.push(i)
      lastWasSpace = true
      continue
    }

    lastWasSpace = false
    ch = FOLD[ch] || ch
    text.push(ch.toLowerCase())
    map.push(i)
  }

  while (text.length && text[text.length - 1] === ' ') {
    text.pop()
    map.pop()
  }

  return { text: text.join(''), map }
}

/** Caracteres tipográficos que cambian al copiar y pegar. */
const FOLD = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '−': '-', '‑': '-',
  // Cada entrada debe ser de un solo carácter: el mapa de posiciones asume 1:1.
  '…': '.', ' ': ' ',
}

/**
 * Busca la cita en el texto.
 *
 * @param {string} haystack texto completo del contenido
 * @param {{exact: string, prefix?: string, suffix?: string}} quote
 * @param {{minScore?: number}} [opts]
 * @returns {{start:number, end:number, score:number, strategy:string}|null}
 *          posiciones referidas al `haystack` ORIGINAL
 */
export function findQuote(haystack, quote, opts = {}) {
  const minScore = opts.minScore ?? 0.72
  if (!haystack || !quote?.exact) return null

  const H = normalize(haystack)
  const needle = normalize(quote.exact).text
  const prefix = quote.prefix ? normalize(quote.prefix).text : ''
  const suffix = quote.suffix ? normalize(quote.suffix).text : ''
  if (!needle) return null

  // 1. Con contexto completo: es la coincidencia más fiable que existe.
  if (prefix || suffix) {
    const whole = prefix + needle + suffix
    const at = H.text.indexOf(whole)
    if (at !== -1) {
      return toOriginal(H, at + prefix.length, at + prefix.length + needle.length, 1, 'quote+context')
    }
  }

  // 2. Todas las apariciones del texto exacto, puntuadas por su contexto.
  const hits = allIndexes(H.text, needle)
  if (hits.length === 1) {
    return toOriginal(H, hits[0], hits[0] + needle.length, 1, 'quote')
  }
  if (hits.length > 1) {
    let best = hits[0]
    let bestScore = -1
    for (const at of hits) {
      const before = H.text.slice(Math.max(0, at - prefix.length), at)
      const after = H.text.slice(at + needle.length, at + needle.length + suffix.length)
      const score =
        (prefix ? similarity(before, prefix) : 0) + (suffix ? similarity(after, suffix) : 0)
      if (score > bestScore) {
        bestScore = score
        best = at
      }
    }
    return toOriginal(H, best, best + needle.length, 1, 'quote+disambiguated')
  }

  // 3. La página cambió un poco. Primero por palabras, que es lo que aguanta
  //    el caso real (alguien intercaló una coma o un inciso); si no, por
  //    distancia de edición.
  const byWords = findFuzzyTokens(H.text, needle)
  if (byWords) return toOriginal(H, byWords.start, byWords.end, byWords.score, 'fuzzy')

  const fuzzy = findFuzzy(H.text, needle, minScore)
  if (fuzzy) return toOriginal(H, fuzzy.start, fuzzy.end, fuzzy.score, 'fuzzy')

  return null
}

function toOriginal(H, nStart, nEnd, score, strategy) {
  if (nStart < 0 || nEnd > H.map.length || nEnd <= nStart) return null
  const start = H.map[nStart]
  // `map` apunta al primer carácter de cada posición normalizada; el final
  // real es el siguiente carácter tras el último incluido.
  const end = nEnd < H.map.length ? H.map[nEnd] : H.map[H.map.length - 1] + 1
  return { start, end, score, strategy }
}

function allIndexes(haystack, needle) {
  const out = []
  let i = haystack.indexOf(needle)
  while (i !== -1 && out.length < 200) {
    out.push(i)
    i = haystack.indexOf(needle, i + 1)
  }
  return out
}

/** Trocea en palabras guardando dónde empieza y acaba cada una. */
function words(text) {
  const out = []
  let i = 0
  for (const w of text.split(' ')) {
    if (w) out.push({ w, start: i, end: i + w.length })
    i += w.length + 1
  }
  return out
}

/** Dos palabras son «la misma» si sólo cambian en un detalle (dias/días). */
function wordEq(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 2) return false
  if (Math.min(a.length, b.length) < 3) return false
  return similarity(a, b) >= 0.75
}

/**
 * Coincidencia aproximada por palabras.
 *
 * Es la que salva el caso real: alguien reeditó la frase e intercaló un inciso
 * («el token» -> «el token de servicio»). La distancia de edición penaliza esa
 * inserción como si fuera un cambio enorme; alinear palabra a palabra ve que
 * están todas, en orden, y además acota bien el fragmento que hay que marcar.
 */
export function findFuzzyTokens(haystack, needle, minScore = 0.8) {
  const H = words(haystack)
  const N = words(needle)
  if (N.length < 2 || !H.length) return null

  // Semilla: la palabra más larga de la cita, la que menos se repite.
  let seedIdx = 0
  for (let i = 1; i < N.length; i++) if (N[i].w.length > N[seedIdx].w.length) seedIdx = i
  if (N[seedIdx].w.length < 4) return null
  const seed = N[seedIdx].w

  const maxSkip = Math.max(4, Math.ceil(N.length * 0.6))
  let best = null
  let tried = 0

  for (let h = 0; h < H.length; h++) {
    if (!wordEq(H[h].w, seed)) continue
    if (tried++ > 80) break

    const from = Math.max(0, h - seedIdx - 2)
    const limit = Math.min(H.length, from + N.length + maxSkip + 4)

    let hi = from
    let matched = 0
    let first = -1
    let last = -1

    for (let n = 0; n < N.length && hi < limit; n++) {
      let found = -1
      for (let k = hi; k < limit && k - hi <= maxSkip; k++) {
        if (wordEq(H[k].w, N[n].w)) {
          found = k
          break
        }
      }
      if (found === -1) continue
      matched++
      if (first === -1) first = found
      last = found
      hi = found + 1
    }

    if (matched < 2 || first === -1) continue
    const score = matched / N.length
    if (score >= minScore && (!best || score > best.score)) {
      best = { start: H[first].start, end: H[last].end, score }
    }
  }

  return best
}

/**
 * Coincidencia aproximada por distancia de edición, como segunda opción.
 * En vez de recorrer todas las posiciones (carísimo), se buscan anclas: las
 * primeras palabras largas de la cita.
 */
export function findFuzzy(haystack, needle, minScore = 0.72) {
  if (needle.length < 6) return null
  const words = needle.split(' ').filter((w) => w.length >= 4)
  const anchors = words.slice(0, 4)
  if (!anchors.length) return null

  const candidates = new Set()
  for (const w of anchors) {
    let i = haystack.indexOf(w)
    let guard = 0
    while (i !== -1 && guard++ < 60) {
      candidates.add(Math.max(0, i - Math.floor(needle.length * 0.35)))
      i = haystack.indexOf(w, i + 1)
    }
  }
  if (!candidates.size) return null

  const window = Math.min(haystack.length, Math.ceil(needle.length * 1.35))
  let best = null

  for (const start of candidates) {
    for (const width of [needle.length, window]) {
      const end = Math.min(haystack.length, start + width)
      const slice = haystack.slice(start, end)
      if (!slice) continue
      const score = similarity(slice, needle)
      if (score >= minScore && (!best || score > best.score)) {
        best = { start, end, score }
      }
    }
  }
  return best
}

/** Similitud 0..1 basada en distancia de edición normalizada. */
export function similarity(a, b) {
  if (a === b) return 1
  if (!a || !b) return 0
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  // Evita comparaciones absurdamente caras.
  if (max > 800) {
    a = a.slice(0, 800)
    b = b.slice(0, 800)
  }
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

/** Distancia de Levenshtein con una sola fila de trabajo. */
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length]
}

/**
 * Busca un encabezado por su texto. Devuelve el índice del candidato mejor
 * puntuado dentro de la lista dada.
 * @param {string[]} headings
 * @param {string} wanted
 */
export function bestHeading(headings, wanted) {
  const target = normalize(wanted).text
  if (!target) return -1
  let bestIdx = -1
  let bestScore = 0
  headings.forEach((h, i) => {
    const t = normalize(h).text
    if (!t) return
    let score = 0
    if (t === target) score = 1
    else if (t.includes(target) || target.includes(t)) score = 0.9
    else score = similarity(t, target)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  })
  return bestScore >= 0.7 ? bestIdx : -1
}
