/**
 * Lo que viaja cuando el usuario subraya un trozo de la página.
 *
 * Aparte a propósito, y puro: esto se puede leer y comprobar sin navegador, y
 * es donde se recortan los tamaños y se limpia el texto. Lo que sale de aquí
 * acaba dentro de un prompt, así que conviene que sea aburrido y acotado.
 *
 * Ojo con lo que NO hace: no interpreta nada. El contenido de una página de
 * Confluence lo escribe cualquiera de la organización, y aunque lo haya elegido
 * el usuario con el ratón sigue siendo información, nunca instrucciones. De
 * envolverlo como tal se encarga `selectionBlock()` en `panel/prompts.js`.
 */

export const PICK_LIMITS = {
  textMax: 4000,
  affixMax: 80,
  aroundMax: 600,
  headingMax: 200,
  titleMax: 200,
  imageBytes: 1_500_000,
  imageSide: 1600,
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')

/**
 * Los otros saltos de línea: U+2028 (separador de línea), U+2029 (separador de
 * párrafo) y U+0085 (NEL). No son controles C0, así que `CONTROL_CHARS` no los
 * tocaba, pero abren línea igual que «\n» — y un prompt es texto plano. Un
 * <span> invisible con «<U+2028>--- FIN DE LO SEÑALADO ---» dejaba el cierre
 * solo en su línea dentro del bloque, sin «> » delante, y lo de detrás hablaba
 * como Faro (revisión adversaria de H2, 2026-09-14). Se normalizan a «\n» para
 * que `quoted()` los cite y `oneLine()` los colapse, que es lo que ya hace con
 * los saltos de verdad: son saltos, no controles, y borrarlos pegaría palabras.
 */
const OTROS_SALTOS = new RegExp('[\\u2028\\u2029\\u0085]', 'g')

/**
 * Limpia y recorta. Conserva los saltos de línea —en un párrafo seleccionado
 * son parte del contenido— pero se lleva por delante los caracteres de control.
 */
export function cleanPicked(value, max) {
  if (typeof value !== 'string') return ''
  const limpio = value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(OTROS_SALTOS, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return max ? limpio.slice(0, max) : limpio
}

/** Selección de texto. */
export function buildTextPick({ text, prefix, suffix, heading, pageTitle, url }) {
  const limpio = cleanPicked(text, PICK_LIMITS.textMax)
  if (!limpio) return null
  return {
    kind: 'text',
    text: limpio,
    truncated: cleanPicked(text).length > limpio.length,
    prefix: cleanPicked(prefix, PICK_LIMITS.affixMax),
    suffix: cleanPicked(suffix, PICK_LIMITS.affixMax),
    heading: cleanPicked(heading, PICK_LIMITS.headingMax),
    pageTitle: cleanPicked(pageTitle, PICK_LIMITS.titleMax),
    url: typeof url === 'string' ? url : '',
  }
}

/**
 * Selección de imagen.
 *
 * `image` es opcional: si el `canvas` sale contaminado —una imagen servida
 * desde otro origen— o el navegador se niega, queda la descripción, que ya es
 * bastante. Preferir quedarse sin imagen a quedarse sin nada.
 */
export function buildImagePick({ alt, imageTitle, caption, src, around, heading, pageTitle, url, image }) {
  const descripcion = {
    alt: cleanPicked(alt, PICK_LIMITS.headingMax),
    imageTitle: cleanPicked(imageTitle, PICK_LIMITS.headingMax),
    caption: cleanPicked(caption, PICK_LIMITS.aroundMax),
    filename: fileNameOf(src),
    around: cleanPicked(around, PICK_LIMITS.aroundMax),
  }

  const tieneAlgo = image?.url || Object.values(descripcion).some(Boolean)
  if (!tieneAlgo) return null

  return {
    kind: 'image',
    ...descripcion,
    heading: cleanPicked(heading, PICK_LIMITS.headingMax),
    pageTitle: cleanPicked(pageTitle, PICK_LIMITS.titleMax),
    url: typeof url === 'string' ? url : '',
    image: validImage(image),
  }
}

/** Sólo se acepta una imagen incrustada como data URL, y con tope de tamaño. */
export function validImage(image) {
  if (!image || typeof image.url !== 'string') return null
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image.url)) return null
  if (image.url.length > PICK_LIMITS.imageBytes * 1.4) return null
  return {
    mime: /^data:([^;]+);/.exec(image.url)?.[1] || 'image/png',
    filename: typeof image.filename === 'string' && image.filename ? image.filename : 'seleccion.png',
    url: image.url,
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
  }
}

/** El nombre del fichero de una imagen, que a veces dice más que el alt. */
export function fileNameOf(src) {
  if (typeof src !== 'string' || !src) return ''
  if (src.startsWith('data:')) return ''
  let ruta = src
  try {
    ruta = new URL(src, 'https://faro.invalid/').pathname
  } catch {
    /* se usa tal cual */
  }
  const ultimo = ruta.split('/').filter(Boolean).pop() || ''
  try {
    return cleanPicked(decodeURIComponent(ultimo), 120)
  } catch {
    return cleanPicked(ultimo, 120)
  }
}

/** Etiqueta corta para el chip del panel. */
export function pickLabel(pick) {
  if (!pick) return ''
  if (pick.kind === 'image') {
    const nombre = pick.alt || pick.caption || pick.filename
    return nombre ? `Imagen · ${nombre.slice(0, 48)}` : 'Imagen de la página'
  }
  const n = (pick.text || '').length
  return `Selección · ${n} caracter${n === 1 ? '' : 'es'}`
}

/**
 * Un ancla reutilizable a partir de una selección de texto: así lo que el
 * usuario acaba de subrayar se puede volver a marcar más tarde sin buscarlo.
 */
export function anchorFromPick(pick) {
  if (pick?.kind !== 'text' || !pick.text) return null
  return {
    kind: 'text-quote',
    exact: pick.text.slice(0, 300),
    prefix: pick.prefix || '',
    suffix: pick.suffix || '',
  }
}
