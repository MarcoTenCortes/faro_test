/**
 * Cronómetro por fases para el Registro. Puro.
 *
 * POR QUÉ EXISTE: nadie veía dónde se iba el tiempo del arranque. La auditoría
 * del 2026-09-13 (docs/plan/anexo-E-eficiencia.md, «APIs externas») midió
 * contra un `opencode serve` desechable con el MCP real configurado que
 * `GET /global/health` tarda 1 ms, `GET /config` 3 ms, `GET /config/providers`
 * 58-61 ms y `GET /mcp` entre 2 811 y 13 768 ms la PRIMERA vez tras arrancar
 * opencode (1-2 ms después), y que `bootForSite` espera ese GET antes de
 * enseñar el chat. Sin un número en el Registro eso es una sospecha: con él es
 * un dato, y es el dato que decide si el MCP se comprueba en segundo plano
 * (H6-P5) o no hace falta. H3 MIDE SIN CAMBIAR COMPORTAMIENTO: este módulo no
 * hace ninguna petición, no espera a nada y no decide nada.
 *
 * QUÉ NO HACE: no registra cuerpos de respuesta, ni URLs, ni claves, ni
 * contraseñas. Una fase es una ETIQUETA escrita por Faro y un NÚMERO de
 * milisegundos; nada más sale de aquí. Las etiquetas se aplanan a una línea
 * porque algún día una podría llevar un host o el id de una Skill, y una sola
 * fase no puede inventarse otras en la línea del Registro.
 *
 * El reloj se inyecta (`startTiming(now)`) para poder probarlo sin esperar.
 */

/** Una etiqueta larga no aporta y desborda la línea del Registro. */
export const LABEL_MAX = 40

/**
 * Lo que abre línea o finge un separador dentro de una etiqueta.
 *
 * `\s` de JavaScript cubre U+2028 (separador de línea) y U+2029 (separador de
 * párrafo) pero NO el NEL (U+0085), así que va explícito; y el «·» se va
 * porque es el separador de la propia línea: una etiqueta no puede fingir dos
 * fases donde hay una (la misma lección de `quoted`/`oneLine` en prompts.js).
 * Se construye con `new RegExp` y la barra escapada, como `ESPACIOS` en
 * prompts.js: así el escape lo resuelve la expresión regular y no queda un
 * carácter invisible en el fuente.
 */
const SEPARADORES = new RegExp('[\\s\\u0085·]+', 'g')

/** Espacios y NEL, sin tocar el «·». */
const ESPACIOS = new RegExp('[\\s\\u0085]+', 'g')

/** Etiqueta en una línea, sin separadores y acotada. Pura. */
function flatLabel(label) {
  const limpia = String(label ?? '')
    .replace(SEPARADORES, ' ')
    .trim()
    .slice(0, LABEL_MAX)
    .trim()
  return limpia || 'fase'
}

/**
 * Milisegundos legibles: «182 ms» · «13,8 s» · «1 min 12 s».
 *
 * Mismo estilo que `formatDuration` de tools/last-turn.mjs, a propósito: el
 * usuario lee las duraciones de Faro de una sola manera. Vive aquí y no en
 * format.js porque format.js no es de este hito; si algún día hace falta en
 * más sitios, se sube allí y este se borra.
 */
function formatMs(ms) {
  const v = Math.max(0, Math.round(Number(ms) || 0))
  if (v < 1000) return `${v} ms`
  if (v < 60000) return `${(v / 1000).toFixed(1).replace('.', ',')} s`
  const min = Math.floor(v / 60000)
  const s = Math.round((v % 60000) / 1000)
  return `${min} min ${s} s`
}

/**
 * Arranca un cronómetro por fases.
 *
 * `mark(label)` cierra la fase que iba corriendo (desde el arranque o desde la
 * marca anterior) y devuelve sus milisegundos, por si quien mide quiere el
 * número suelto. `done()` devuelve la foto: el total desde el arranque y las
 * fases en el orden en que se marcaron. Llamar a `done()` dos veces no rompe
 * nada (lee el reloj otra vez); la suma de las fases no tiene por qué ser el
 * total: lo que pasa entre la última marca y `done()` no es de ninguna fase.
 *
 * @param {() => number} [now] reloj en milisegundos; por defecto `Date.now`.
 * @returns {{mark: (label: string) => number, done: () => {total: number, phases: Array<{label: string, ms: number}>}}}
 */
export function startTiming(now = Date.now) {
  const reloj = typeof now === 'function' ? now : Date.now
  const t0 = Number(reloj()) || 0
  let ultimo = t0
  const phases = []

  return {
    mark(label) {
      const t = Number(reloj()) || 0
      const ms = Math.max(0, Math.round(t - ultimo))
      ultimo = t
      phases.push({ label: flatLabel(label), ms })
      return ms
    },
    done() {
      const t = Number(reloj()) || 0
      return {
        total: Math.max(0, Math.round(t - t0)),
        phases: phases.map((p) => ({ label: p.label, ms: p.ms })),
      }
    },
  }
}

/**
 * La foto de un cronómetro en una línea para `log.*`: el total primero y cada
 * fase detrás, «182 ms · health 1 ms · modelos 61 ms».
 *
 * `extra` es texto ya formateado que se pega al final (por ejemplo «restaurar
 * 12 KB»): una cadena o una lista de cadenas. Se aplana a una línea como las
 * etiquetas, pero conserva el «·» porque puede venir ya con sus separadores.
 * Nada más entra: ni cuerpos, ni URLs, ni claves.
 *
 * @param {{total?: number, phases?: Array<{label?: string, ms?: number}>}} t
 * @param {{extra?: string|string[]}} [opciones]
 * @returns {string}
 */
export function timingLine(t, { extra } = {}) {
  const partes = []
  if (t && typeof t === 'object') {
    partes.push(formatMs(t.total))
    for (const p of Array.isArray(t.phases) ? t.phases : []) {
      if (!p || typeof p !== 'object') continue
      partes.push(`${flatLabel(p.label)} ${formatMs(p.ms)}`)
    }
  }
  for (const e of Array.isArray(extra) ? extra : [extra]) {
    const limpio = String(e ?? '')
      .replace(ESPACIOS, ' ')
      .trim()
    if (limpio) partes.push(limpio)
  }
  return partes.join(' · ')
}
