/**
 * Uso antes de declarar, dentro de una misma función.
 *
 * `node --check` no lo ve: parsear un fichero no ejecuta nada, y la zona muerta
 * temporal es un error de ejecución. Se coló uno de verdad —una línea leía
 * `pagina.url` dos líneas antes del `const pagina = await …`— y el panel se
 * cayó con «Cannot access 'pagina' before initialization» sólo cuando el
 * usuario pidió un análisis. En un proyecto sin dependencias y sin linter, esta
 * es la red.
 *
 * A propósito, MUY acotado: sólo mira declaraciones que están en el primer
 * nivel del cuerpo de una función, y usos también del primer nivel, antes de
 * ella. Ahí no hay excusa posible: es un error seguro.
 *
 * Comparar entre ámbitos distintos daba ciento cincuenta falsos positivos —el
 * mismo nombre en dos funciones—, y un aviso que se ignora no es una red, es
 * ruido.
 */

/**
 * Deja el código y borra todo lo demás, conservando las posiciones.
 *
 * Con un escáner de estados y no a base de expresiones regulares, porque a base
 * de expresiones regulares se rompe: borrar comentarios antes que cadenas hace
 * que el `'//'` de `raw.startsWith('//')` se coma el resto de la línea —comilla
 * de cierre y paréntesis incluidos—, y a partir de ahí el recuento de llaves ya
 * no vale nada. Eso mismo daba un falso positivo a doscientas líneas de
 * distancia.
 */
export function stripNoise(src) {
  const out = new Array(src.length)
  let i = 0

  // Para saber si una barra abre una expresión regular o es una división:
  // detrás de un identificador, un número o un cierre, es división.
  let previo = ''

  const copiar = (n) => {
    for (let k = 0; k < n && i < src.length; k++, i++) out[i] = src[i]
  }
  const borrar = (hasta) => {
    for (; i < hasta && i < src.length; i++) out[i] = src[i] === '\n' ? '\n' : ' '
  }

  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]

    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      borrar(j)
      continue
    }

    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2)
      borrar(j === -1 ? src.length : j + 2)
      continue
    }

    if (c === '"' || c === "'" || c === '`') {
      const fin = finDeLiteral(src, i, c)
      out[i] = c
      i++
      borrar(fin)
      if (i < src.length) {
        out[i] = src[i]
        i++
      }
      previo = 'x'
      continue
    }

    if (c === '/' && !/[\w)\]}$]/.test(previo)) {
      const fin = finDeLiteral(src, i, '/')
      out[i] = ' '
      i++
      borrar(fin)
      if (i < src.length) {
        out[i] = ' '
        i++
      }
      previo = 'x'
      continue
    }

    if (!/\s/.test(c)) previo = c
    copiar(1)
  }

  return out.join('')
}

/** Dónde se cierra un literal abierto en `desde`, respetando los escapes. */
function finDeLiteral(src, desde, cierre) {
  for (let j = desde + 1; j < src.length; j++) {
    if (src[j] === '\\') {
      j++
      continue
    }
    if (src[j] === cierre) return j
    // Una expresión regular no cruza de línea; una cadena normal, tampoco.
    if (src[j] === '\n' && cierre !== '`') return j
  }
  return src.length
}

const DECLARA = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g
const FUNCION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm

/**
 * Los problemas encontrados.
 * @returns {Array<{file:string, nombre:string, funcion:string, usoEn:number, declEn:number}>}
 */
export function findUseBeforeDeclare(src, file = '') {
  const limpio = stripNoise(src)
  const problemas = []

  for (const fn of cuerposDeFuncion(limpio)) {
    const cuerpo = limpio.slice(fn.desde, fn.hasta)
    const nivel = niveles(cuerpo)

    for (const d of cuerpo.matchAll(DECLARA)) {
      const nombre = d[1]
      const declEn = d.index
      if (nivel[declEn] !== 0) continue // no es del primer nivel del cuerpo

      const uso = primerUsoAntes(cuerpo, nivel, nombre, declEn)
      if (uso === -1) continue

      problemas.push({
        file,
        nombre,
        funcion: fn.nombre,
        usoEn: linea(limpio, fn.desde + uso),
        declEn: linea(limpio, fn.desde + declEn),
      })
    }
  }

  return problemas
}

function primerUsoAntes(cuerpo, nivel, nombre, declEn) {
  const re = new RegExp('(^|[^\\w.$])' + nombre + '\\b', 'g')
  let m

  while ((m = re.exec(cuerpo))) {
    const en = m.index + m[1].length
    if (en >= declEn) return -1
    if (nivel[en] !== 0) continue // dentro de un bloque anidado: otro ámbito

    // Y si el uso cae dentro de una función que se define aquí pero se llama
    // más tarde, es legítimo: «const f = () => tarde» escrito antes de
    // «const tarde» no falla mientras nadie llame a f todavía.
    const renglon = cuerpo.slice(cuerpo.lastIndexOf('\n', en) + 1, en)
    if (/=>/.test(renglon) || /\bfunction\b/.test(renglon)) continue

    return en
  }

  return -1
}

/** Cuerpos de las funciones declaradas en el primer nivel del fichero. */
function cuerposDeFuncion(src) {
  const out = []
  for (const m of src.matchAll(FUNCION)) {
    const abre = src.indexOf('{', cierraParentesis(src, src.indexOf('(', m.index)))
    if (abre === -1) continue
    const cierra = cierreDe(src, abre)
    if (cierra > abre) out.push({ nombre: m[1], desde: abre + 1, hasta: cierra })
  }
  return out
}

function cierraParentesis(src, abre) {
  let d = 0
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '(') d++
    else if (src[i] === ')' && --d === 0) return i
  }
  return abre
}

function cierreDe(src, abre) {
  let d = 0
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '{') d++
    else if (src[i] === '}' && --d === 0) return i
  }
  return -1
}

/** Profundidad de llaves en cada posición del cuerpo. */
function niveles(cuerpo) {
  const out = new Int16Array(cuerpo.length)
  let d = 0
  for (let i = 0; i < cuerpo.length; i++) {
    if (cuerpo[i] === '}') d--
    out[i] = d
    if (cuerpo[i] === '{') d++
  }
  return out
}

function linea(src, i) {
  return src.slice(0, i).split('\n').length
}
