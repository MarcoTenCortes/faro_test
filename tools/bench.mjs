/**
 * `npm run bench`: el metro de Faro. Cuánto pesa lo que se le manda al modelo
 * y cuánto tardan los módulos puros más pesados.
 *
 * Por qué existe: hasta la auditoría del 2026-09-13 nadie medía nada, así que
 * las sospechas de lentitud caían siempre sobre el código propio. Al medir de
 * verdad —contra un opencode desechable con el MCP del usuario configurado—
 * resultó que `GET /mcp` tarda 2 811-13 768 ms la PRIMERA vez tras arrancar el
 * servidor (1-2 ms después) y que ningún módulo puro pasaba de 3 ms: el tiempo
 * estaba en la red y en el DOM, no en las funciones. Este fichero deja esa
 * medición al alcance de la mano para la próxima vez, y ancla la otra cifra
 * que sí depende de nosotros: el tamaño del `system`, que viaja ENTERO en cada
 * pregunta (3-4 k caracteres en General, 24-27 k en un Análisis de Jira).
 *
 * Qué NO es: una prueba. Nunca falla, no tiene umbrales y queda fuera de
 * `npm run check` a propósito —los tiempos de una máquina no son un contrato—.
 * Si un cambio empeora algo, se ve comparando dos ejecuciones en la MISMA
 * máquina, no contra un número escrito en el repo.
 *
 * Qué imprime, y qué no: de cada prompt sólo su TAMAÑO. Nunca su contenido
 * (los escenarios llevan hosts y contextos del usuario), ni claves, ni nada
 * que venga de opencode: este fichero no habla con ningún servidor.
 *
 * Los escenarios son los mismos que pinan las instantáneas de prompts
 * (`test/fixtures/prompts/escenarios.js`): una sola lista, para que lo medido
 * sea exactamente lo que se compara byte a byte.
 *
 *   node tools/bench.mjs        (= npm run bench)
 */

import { ESCENARIOS } from '../test/fixtures/prompts/escenarios.js'
import { formatInt } from './last-turn.mjs'
import { normalizeNumbering } from '../src/panel/notes.js'
import { matchBlock, blockHint, DIGEST_LIMITS } from '../src/shared/digest.js'
import { findQuote } from '../src/content/anchor-match.js'
import { normalizeIndex, mergeIndex, mergeIndexKeepingTree } from '../src/atlassian/index-store.js'
import { normalizeContexts, subIndex, CONTEXTS_VERSION } from '../src/shared/scopes.js'
import { INDEX_LIMITS } from '../src/shared/config.js'
import { parseAtlassianUrl } from '../src/atlassian/site.js'

/** Repeticiones de cada caso: la MEDIANA de 20 aguanta un pico del sistema. */
const REPS = 20

/**
 * Tokens por carácter, para la estimación. Regla de servilleta de toda la
 * vida (~4 chars por token en inglés; en español con acentos suele salir algo
 * peor). No es la cuenta de ningún proveedor: sirve para comparar escenarios
 * entre sí, nunca para predecir una factura.
 */
const CHARS_POR_TOKEN = 4

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/** Donde se tiran los resultados de lo medido: sin esto V8 borra la llamada. */
let sumidero = 0

// ---------------------------------------------------------------- utilidades

/** Milisegundos con dos decimales y coma decimal: «0,42 ms». */
function ms(v) {
  return `${v.toFixed(2).replace('.', ',')} ms`
}

/** Microsegundos por llamada: «420 µs» · «0,8 µs». */
function us(v) {
  const micro = v * 1000
  if (micro >= 100) return `${formatInt(Math.round(micro))} µs`
  return `${micro.toFixed(1).replace('.', ',')} µs`
}

/** Una tabla con las columnas alineadas a la izquierda salvo las numéricas. */
function tabla(cabeceras, filas, { derecha = [] } = {}) {
  const anchos = cabeceras.map((h, i) => Math.max(h.length, ...filas.map((f) => String(f[i]).length)))
  const linea = (celdas, dim) =>
    '    ' +
    celdas
      .map((c, i) => (derecha.includes(i) ? String(c).padStart(anchos[i]) : String(c).padEnd(anchos[i])))
      .join('  ')
      .trimEnd()
      .replace(/^/, dim ? DIM : '') + (dim ? OFF : '')
  const out = [linea(cabeceras, true)]
  for (const f of filas) out.push(linea(f, false))
  return out
}

/** La mediana de una lista de números (ya ordenada o no). Pura. */
function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b)
  const mitad = Math.floor(v.length / 2)
  return v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2
}

// ------------------------------------------------------------------- prompts

/** A qué grupo pertenece cada escenario, por el prefijo de su id. */
function grupoDe(id) {
  if (id.startsWith('interno-')) return 'internos'
  if (id.startsWith('usuario-')) return 'usuario'
  return 'sistema'
}

const GRUPOS = [
  {
    clave: 'sistema',
    titulo: 'SISTEMA DEL TURNO',
    nota: 'viaja ENTERO en cada pregunta (opencode lo guarda por mensaje y sólo manda el del último)',
  },
  {
    clave: 'internos',
    titulo: 'PROMPTS INTERNOS',
    nota: 'turnos desechables: observaciones, pasada que trocea, indexador, planificador, memoria',
  },
  { clave: 'usuario', titulo: 'MENSAJE DEL USUARIO', nota: 'lo que acompaña a la pregunta (selección señalada)' },
]

function medirPrompts() {
  console.log(`${BOLD}PROMPTS${OFF} ${DIM}· cuánto pesa lo que lee el modelo${OFF}`)
  console.log(
    `${DIM}    Los tokens son una ESTIMACIÓN (caracteres ÷ ${CHARS_POR_TOKEN}), no la cuenta de ningún proveedor.${OFF}`
  )

  const medido = ESCENARIOS.map((e) => {
    const texto = e.build()
    return {
      id: e.id,
      que: e.que,
      grupo: grupoDe(e.id),
      chars: texto.length,
      lineas: texto.split('\n').length,
      tokens: Math.round(texto.length / CHARS_POR_TOKEN),
    }
  })

  for (const g of GRUPOS) {
    const filas = medido.filter((m) => m.grupo === g.clave)
    if (!filas.length) continue
    console.log(`\n  ${g.titulo} ${DIM}(${filas.length}) · ${g.nota}${OFF}`)
    const cuerpo = filas
      .slice()
      .sort((a, b) => b.chars - a.chars)
      .map((m) => [m.id, formatInt(m.chars), formatInt(m.lineas), '~' + formatInt(m.tokens)])
    cuerpo.push([
      'mediana',
      formatInt(Math.round(mediana(filas.map((m) => m.chars)))),
      '',
      '~' + formatInt(Math.round(mediana(filas.map((m) => m.tokens)))),
    ])
    for (const l of tabla(['escenario', 'chars', 'líneas', '~tokens'], cuerpo, { derecha: [1, 2, 3] })) {
      console.log(l)
    }
  }

  const sistema = medido.filter((m) => m.grupo === 'sistema')
  const mayor = sistema.reduce((a, b) => (b.chars > a.chars ? b : a))
  const menor = sistema.reduce((a, b) => (b.chars < a.chars ? b : a))
  console.log(
    `\n${DIM}    El más gordo y el más flaco de los que viajan en cada pregunta:${OFF}\n` +
      `      ${mayor.id} ${formatInt(mayor.chars)} chars ${DIM}· ${mayor.que}${OFF}\n` +
      `      ${menor.id} ${formatInt(menor.chars)} chars ${DIM}· ${menor.que}${OFF}`
  )
}

// -------------------------------------------------------------------- puros

/**
 * El informe de un modelo que numeró «a su manera»: ocho líneas de prosa con
 * apartados y una lista «1.» que `normalizeNumbering` tiene que reconocer y
 * reescribir. Está calcado del que hizo fallar la extensión de verdad
 * (gpt-5.6-luna, 2026-09-09) y que vive en `test/unit/notes.test.js`; se copia
 * aquí porque ese `INFORME` es local del test y no se exporta.
 */
const INFORME = [
  '**Análisis de la incidencia**',
  '',
  '**Qué pide**',
  '- La tarea solicita extender la API del servicio `query-mapper-adapter`.',
  '- Está en **PBI For DG Review**, sin asignar.',
  '',
  '**Observaciones**',
  '1. **Objetivo funcional todavía ambiguo.** La descripción mezcla la API con la delegación y no dice cuál de las dos entra en este sprint.',
  '2. **Contrato HTTP incompleto.** No se especifican método, ruta ni códigos de error: un 404 y un 409 cambian el cliente.',
  '3. **Dependencia crítica con otra incidencia.** No define el contrato entre ambas ni quién publica primero.',
  '4. **Sin criterios de aceptación comprobables.** «Funciona» no es una condición que nadie pueda verificar.',
  '5. **Versiones y entorno sin fijar.** No se dice contra qué versión del adaptador se prueba.',
  '6. **Contradicción entre la descripción y los comentarios.** El comentario del 12 de marzo da por cerrado lo que la descripción deja abierto.',
  '7. **Riesgo de compatibilidad hacia atrás.** Cambiar la forma de la respuesta rompe a los consumidores actuales.',
  '8. **Nadie asignado con la fecha encima.** La corrección de la versión está puesta y la incidencia sigue sin persona.',
  '',
  '**Dependencias y riesgos**',
  '- La otra incidencia está en **PBI Defined**.',
  '',
  '**Conclusión**',
  'La tarea no está lista para aprobarse como contrato de API.',
].join('\n')

/** Un párrafo de página con la longitud típica de lo que se marca. */
function parrafo(i) {
  return (
    `Bloque ${i} de la página: este párrafo describe una parte del procedimiento, ` +
    'con una frase larga para que la comparación tenga que recorrer texto de verdad ' +
    'y no una palabra suelta, como pasa en cualquier página de Confluence escrita por personas.'
  )
}

/** Una página en bloques como la que ve el modelo, con el tope de `DIGEST_LIMITS`. */
const BLOQUES = Array.from({ length: DIGEST_LIMITS.maxBlocks }, (_, i) => ({
  id: i + 1,
  tag: i % 17 === 0 ? 'h2' : 'p',
  text: parrafo(i + 1),
}))

/**
 * El peor caso de `matchBlock`: la pista es la del ÚLTIMO bloque y el número
 * que dio el modelo es el 1, así que no acierta a la primera y tiene que
 * recorrer los 400 buscando el más cercano («block-moved»).
 */
const ANCLA_MOVIDA = { block: 1, hint: blockHint(BLOQUES[BLOQUES.length - 1].text) }

/** Una página entera como texto plano, del tamaño que se le enseña al modelo. */
const PAGINA = BLOQUES.map((b) => b.text).join('\n\n').slice(0, DIGEST_LIMITS.maxChars)

/**
 * El último bloque que cabe ENTERO en la página recortada. Se BUSCA en vez de
 * fijar un número porque cuántos caben depende de `DIGEST_LIMITS.maxChars`
 * (hoy 121 de los 400: el recorte a 30 000 chars se come el resto). Con un
 * número a mano la cita se salía de la página y este caso medía un fallo que
 * acababa en la búsqueda difusa, con la etiqueta «cita literal» puesta: el
 * `strategy` que se imprime al lado está justamente para que eso se vea.
 */
const ULTIMO_ENTERO = BLOQUES.filter((b) => PAGINA.includes(b.text)).pop()

/** Cita que existe tal cual, lo más lejos posible: el escaneo recorre casi toda la página. */
const CITA_EXACTA = { exact: ULTIMO_ENTERO.text.slice(0, 120) }

/**
 * Cita que NO está: el modelo la parafraseó. Obliga a agotar la escalera hasta
 * la búsqueda difusa, que es donde `findQuote` cuesta de verdad.
 */
const CITA_DIFUSA = {
  exact: 'este parrafo describe una parte del procedimiento con una frase larga para que la busqueda difusa tenga trabajo',
}

/** Un índice de N páginas con árbol, como el de un espacio grande. */
function indiceDe(n, { desplazamiento = 0 } = {}) {
  const pages = Array.from({ length: n }, (_, i) => {
    const id = String(100000 + desplazamiento + i)
    return {
      id,
      title: `Página ${i + 1} del espacio de ingeniería`,
      url: `/display/ENG/Pagina+${i + 1}`,
      spaceKey: 'ENG',
      parentId: i > 0 ? String(100000 + desplazamiento + Math.floor((i - 1) / 8)) : null,
    }
  })
  return normalizeIndex({ spaces: [{ key: 'ENG', name: 'Ingeniería', url: '/display/ENG' }], pages }, 'confluence.simplprogramme.eu')
}

/**
 * H21: un índice de varios espacios de 300 páginas, fundidos como los funde el
 * panel (`mergeIndex`), para medir lo que pesa el objeto que `persistIndex`
 * escribe ENTERO en cada turno (P3): es la medida que justifica
 * `INDEX_LIMITS.maxPagesTotal`. Las páginas llevan títulos y rutas de la
 * longitud de las de verdad.
 */
function indiceDeEspacios(nEspacios) {
  let fundido = null
  for (let e = 0; e < nEspacios; e++) {
    const clave = 'ESP' + e
    const pages = Array.from({ length: INDEX_LIMITS.maxPages }, (_, i) => {
      const id = String(10000000 + e * 1000 + i)
      return {
        id,
        title: `Página ${i + 1} del espacio ${clave}: procedimiento de despliegue`,
        url: `/spaces/${clave}/pages/${id}/Pagina+${i + 1}+del+espacio`,
        spaceKey: clave,
        parentId: i > 0 ? String(10000000 + e * 1000 + Math.floor((i - 1) / 8)) : null,
      }
    })
    const uno = normalizeIndex({ spaces: [{ key: clave, name: 'Espacio ' + e, url: '/spaces/' + clave }], pages }, 'confluence.simplprogramme.eu')
    fundido = mergeIndex(fundido, uno)
  }
  return fundido
}

const INDICES_ESPACIOS = [1, 5, 10].map((n) => ({ espacios: n, indice: indiceDeEspacios(n) }))

/** 20 ámbitos de 24 000 caracteres: lo que cabe de cada uno en el prompt. */
const CONTEXTOS_20 = {
  version: CONTEXTS_VERSION,
  scopes: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      'space:ESP' + i,
      { text: ['# Espacio ' + i, 'x'.repeat(80), ''].join('\n').repeat(300).slice(0, 24000), at: 1000 + i, indexedAt: 2000 + i, legacy: false },
    ])
  ),
}

/** 2 000 páginas: casi siete veces el tope del indexador (INDEX_LIMITS.maxPages = 300), a propósito. */
const INDICE_BASE = indiceDe(2000)
const INDICE_ENTRANTE = indiceDe(2000, { desplazamiento: 1000 })

/**
 * Por qué peldaño de la escalera de `findQuote` acaba una cita. Se imprime al
 * lado de cada caso porque un fixture que se queda corto no falla —devuelve una
 * coincidencia difusa cualquiera— y entonces lo medido no es lo que dice la
 * etiqueta. Con el peldaño a la vista, la siguiente persona lo nota.
 */
function estrategiaDe(cita) {
  const r = findQuote(PAGINA, cita)
  return r ? `estrategia: ${r.strategy}` : 'NO LA ENCUENTRA'
}

const URLS = [
  'https://confluence.simplprogramme.eu/pages/viewpage.action?pageId=123456',
  'https://confluence.simplprogramme.eu/display/ENG/Guia+de+APIs?pageId=98830281',
  'https://jira.simplprogramme.eu/browse/SIMPL-31875',
  'https://jira.simplprogramme.eu/projects/SIMPL/issues/SIMPL-31875?filter=allopenissues',
  'https://acme.atlassian.net/wiki/spaces/ENG/pages/200/ADR-014',
  'https://acme.atlassian.net/jira/software/projects/ENG/boards/1',
]

const CASOS = [
  {
    nombre: 'normalizeNumbering',
    detalle: 'informe con 8 observaciones numeradas «1.» y apartados alrededor',
    fn: () => normalizeNumbering(INFORME, { expected: 8 }).numbers.length,
  },
  {
    nombre: 'matchBlock (peor caso)',
    detalle: `pista del bloque ${DIGEST_LIMITS.maxBlocks} con el número 1: recorre los ${DIGEST_LIMITS.maxBlocks}`,
    fn: () => matchBlock(BLOQUES, ANCLA_MOVIDA).index,
  },
  {
    nombre: 'findQuote (cita literal)',
    detalle:
      `cita de 120 chars que está tal cual en ${formatInt(PAGINA.length)} chars de página ` +
      `(${estrategiaDe(CITA_EXACTA)})`,
    fn: () => findQuote(PAGINA, CITA_EXACTA)?.start ?? 0,
  },
  {
    nombre: 'findQuote (peor caso)',
    detalle: `cita parafraseada: agota la escalera hasta la búsqueda difusa (${estrategiaDe(CITA_DIFUSA)})`,
    fn: () => findQuote(PAGINA, CITA_DIFUSA)?.start ?? 0,
  },
  {
    nombre: 'mergeIndexKeepingTree',
    detalle: '2 000 páginas contra 2 000 (la mitad se solapa y conserva su padre)',
    fn: () => Object.keys(mergeIndexKeepingTree(INDICE_BASE, INDICE_ENTRANTE).pages).length,
  },
  {
    nombre: 'normalizeContexts (H21)',
    detalle: '20 ámbitos de 24 000 caracteres: lo que el arranque lee y normaliza de un host con muchos espacios',
    fn: () => Object.keys(normalizeContexts(CONTEXTOS_20).scopes).length,
  },
  {
    nombre: 'subIndex (H21)',
    detalle: 'el índice de UN espacio sacado de uno de 3 000 páginas (10 espacios)',
    fn: () => Object.keys(subIndex(INDICES_ESPACIOS[2].indice, 'ESP7').pages).length,
  },
  {
    nombre: 'parseAtlassianUrl',
    detalle: '6 URLs de Confluence DC, Jira DC y Cloud',
    veces: 1000,
    fn: () => {
      let n = 0
      for (const u of URLS) n += parseAtlassianUrl(u) ? 1 : 0
      return n
    },
  },
]

function medirCaso({ fn, veces = 1 }) {
  // Una vuelta en frío para que V8 compile y llene sus cachés: lo que importa
  // es el coste en régimen, no el del primer arranque.
  sumidero += Number(fn()) || 0

  const muestras = []
  for (let r = 0; r < REPS; r++) {
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < veces; i++) sumidero += Number(fn()) || 0
    muestras.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  muestras.sort((a, b) => a - b)
  return { med: mediana(muestras), min: muestras[0], max: muestras[muestras.length - 1], veces }
}

function medirPuros() {
  console.log(`\n${BOLD}MÓDULOS PUROS${OFF} ${DIM}· mediana de ${REPS} repeticiones${OFF}`)
  console.log(
    `${DIM}    Estos casos son PEORES que los de la auditoría del 2026-09-13 (que midió todo por debajo de 3 ms):\n` +
      `    la página llena a ${formatInt(DIGEST_LIMITS.maxBlocks)} bloques, el índice a 2 000 páginas. Unos pocos ms aquí\n` +
      `    son normales; lo que importa es que no crezcan entre dos ejecuciones de la misma máquina.${OFF}\n`
  )

  const filas = CASOS.map((c) => {
    const r = medirCaso(c)
    const llamadas = r.veces > 1 ? `× ${formatInt(r.veces)}` : ''
    return [
      c.nombre,
      ms(r.med),
      us(r.med / r.veces) + (llamadas ? ` ${llamadas}` : ''),
      `${ms(r.min)} – ${ms(r.max)}`,
      c.detalle,
    ]
  })
  for (const l of tabla(['caso', 'mediana', 'por llamada', 'mín – máx', 'qué mide'], filas, { derecha: [1, 2, 3] })) {
    console.log(l)
  }
}

// ------------------------------------------------------------------ índice (H21)

/**
 * Lo que pesa el índice de un host según cuántos espacios guarde (H21). No es un
 * tiempo sino un tamaño: `persistIndex` escribe el objeto ENTERO en cada turno,
 * y `chrome.storage.local` tiene cuota. Es la medida con la que se eligió
 * `INDEX_LIMITS.maxPagesTotal`.
 */
function medirIndice() {
  console.log(`\n${BOLD}ÍNDICE DE UN HOST${OFF} ${DIM}· lo que pesa el objeto que se escribe entero en cada turno (H21)${OFF}`)
  const filas = INDICES_ESPACIOS.map(({ espacios, indice }) => {
    const bytes = Buffer.byteLength(JSON.stringify(indice), 'utf8')
    const paginas = Object.keys(indice.pages).length
    return [`${espacios} × ${INDEX_LIMITS.maxPages}`, formatInt(paginas), formatInt(Math.round(bytes / 1024)) + ' KB', paginas <= INDEX_LIMITS.maxPagesTotal ? 'cabe' : 'pasa del tope']
  })
  for (const l of tabla(['espacios', 'páginas', 'JSON', `tope ${formatInt(INDEX_LIMITS.maxPagesTotal)}`], filas, { derecha: [1, 2] })) console.log(l)
}

// ----------------------------------------------------------------- principal

function main() {
  console.log(
    `${BOLD}Faro · metro${OFF} ${DIM}(npm run bench) · node ${process.version} · ${process.platform}${OFF}\n`
  )
  medirPrompts()
  medirPuros()
  medirIndice()
  console.log(
    `\n${DIM}Esto no es una prueba: no falla nunca y queda fuera de «npm run check». ` +
      `Compara dos ejecuciones en la MISMA máquina, no con números de otra.${OFF}`
  )
  // El sumidero sólo existe para que V8 no borre lo medido; se calla, pero se usa.
  if (!Number.isFinite(sumidero)) console.log('')
}

main()
