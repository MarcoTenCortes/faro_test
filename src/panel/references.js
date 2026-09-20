/**
 * Las páginas de referencia del sitio: cuáles de sus páginas son una guía, una
 * plantilla, una decisión (ADR), un glosario, unas convenciones, una página de
 * arquitectura o un proceso, leídas del CONTEXT.md que escribió el indexador.
 *
 * El contexto ya dice en prosa dónde vive cada cosa («las convenciones de API
 * están en «Guía de API del programa» (id 456789)»), y desde H9 el indexador de
 * Confluence tiene la frase que pide nombrar cada página de referencia «por su
 * título exacto y su id numérico» —el de Jira la tenía desde antes—. Eso basta
 * para sugerir esa página cuando se va a analizar un ticket de API, sin gastar
 * un token ni pedir nada a ninguna API: sólo hay que leer los ids que el
 * contexto ya cita.
 *
 * POR QUÉ NO SE GUARDA NADA. El anexo B tenía un paso más —una propiedad
 * opcional `references` en el esquema de la fase 2 del indexador, persistida en
 * su propia clave— y docs/PLAN.md §3.2 lo descartó: con el contexto por REST
 * (H9) el camino feliz ya no pasa por esa fase. Sin lista estructurada que
 * guardar, una clave de almacenamiento que nadie escribe sería una promesa
 * falsa; el parser corre sobre el CONTEXT.md que el panel ya tiene cargado, en
 * microsegundos, cada vez que hace falta. Por eso aquí no hay `version` ni
 * `updated` ni `host`: no hay nada persistido que versionar.
 *
 * Lo que sale de aquí NO viaja a ningún prompt: se usa para puntuar una
 * sugerencia y para escribir su motivo («el contexto la nombra como guía»), que
 * lo escribe la extensión (CLAUDE.md §8.20).
 *
 * Todo puro: se prueba en Node.
 */

import { clean } from '../nav/validate.js'
import { isPlaceholderTitle } from '../atlassian/index-store.js'
import { ISSUE_FAMILIES } from './issue-profile.js'
import { SOURCE_LIMITS } from './sources.js'

/**
 * Qué papel hace una página. El orden es el que manda cuando una línea encaja
 * con más de uno: «Plantilla de ADR» es una plantilla, «ADR-014» es una
 * decisión. `otra` es el cajón: una página de referencia que no se reconoce
 * sigue siendo una página de referencia.
 */
export const REFERENCE_ROLES = ['guia', 'plantilla', 'adr', 'glosario', 'convenciones', 'arquitectura', 'proceso', 'otra']

export const REFERENCE_LIMITS = {
  /** Páginas de referencia que se conservan de un contexto. */
  max: 40,
  /** Para qué sirve, en una línea. */
  forWhatMax: 160,
  /** Cuánto CONTEXT.md se recorre: más que eso no es un contexto, es un volcado. */
  contextMax: 200000,
}

/** Lo que dice el papel de una página, por su línea o por el apartado en vigor. */
const ROLE_MATCH = [
  ['guia', /gu[ií]as?\b|guidelines?\b|\bguide\b/i],
  ['plantilla', /plantillas?\b|template/i],
  ['adr', /\badr\b|decisi[oó]n|decisiones|decision record/i],
  ['glosario', /glosario|glossary/i],
  [
    'convenciones',
    /convenci[oó]n|convenciones|convention|naming|nomenclatura|definition of (?:ready|done)|checklist|est[aá]ndar|standard/i,
  ],
  ['arquitectura', /arquitectura|architecture/i],
  ['proceso', /procesos?\b|process\b|runbook|procedimiento/i],
]

/**
 * Qué papeles casan con qué clase de trabajo. Sólo los cuatro cruces que el
 * diseño declara (docs/PLAN.md §3.2): inventar los demás sería puntuar por una
 * relación que nadie ha pensado. Se pregunta con `Object.hasOwn` porque
 * `family` puede venir de un registro guardado: una familia «constructor»
 * devolvía algo del prototipo y reventaba al extenderlo (lo mismo que le pasó a
 * `suggestionsFor` en H5). Pura.
 */
const ROLE_FOR_FAMILY = {
  api: ['guia', 'convenciones'],
  architecture: ['adr', 'arquitectura'],
  doc: ['plantilla', 'guia'],
  test: ['proceso', 'guia'],
}

export function roleForFamily(family) {
  const f = String(family ?? '')
  return Object.hasOwn(ROLE_FOR_FAMILY, f) ? [...ROLE_FOR_FAMILY[f]] : []
}

export function emptyReferences() {
  return { items: {} }
}

const FAMILY_IDS = ISSUE_FAMILIES.map((f) => f.id)
const ID = /^\d+$/

function families(raw) {
  const out = []
  for (const item of Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []) {
    const f = typeof item === 'string' ? item.trim() : ''
    if (!FAMILY_IDS.includes(f) || out.includes(f)) continue
    out.push(f)
  }
  return out
}

/**
 * Las referencias en su forma canónica: un mapa por id con claves blancas.
 *
 * Es el ÚNICO sitio donde se decide la forma, venga de donde venga (hoy, del
 * parser de prosa de aquí abajo; mañana, de una lista estructurada). El id
 * tiene que ser numérico y de al menos cuatro cifras, como todo id de página
 * que se acepta pegado (`SOURCE_LIMITS.bareIdMin`): tres cifras es un número
 * suelto de una frase. El título del ÍNDICE gana a un marcador de posición,
 * porque el índice sabe cómo se llama de verdad la página. Pura.
 *
 * @param {{index?: object|null}} [ctx] el índice del sitio, para los títulos
 * @returns {{items: Object<string, {families:string[], forWhat:string, id:string, role:string, title:string}>}}
 */
export function normalizeReferences(raw, { index = null } = {}) {
  const out = emptyReferences()
  const lista = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : raw?.items && typeof raw.items === 'object'
        ? Object.values(raw.items)
        : []

  for (const item of lista) {
    if (Object.keys(out.items).length >= REFERENCE_LIMITS.max) break
    if (!item || typeof item !== 'object') continue
    const id = String(item.id ?? '').trim()
    if (!ID.test(id) || id.length < SOURCE_LIMITS.bareIdMin) continue
    if (Object.hasOwn(out.items, id)) continue

    const delIndice = clean(index?.pages?.[id]?.title, SOURCE_LIMITS.titleMax)
    let title = clean(item.title, SOURCE_LIMITS.titleMax)
    if ((!title || isPlaceholderTitle(title)) && delIndice && !isPlaceholderTitle(delIndice)) title = delIndice
    if (!title) title = `Página ${id}`

    out.items[id] = {
      families: families(item.families),
      forWhat: clean(item.forWhat, REFERENCE_LIMITS.forWhatMax),
      id,
      role: REFERENCE_ROLES.includes(item.role) ? item.role : 'otra',
      title,
    }
  }
  return out
}

// ------------------------------------------------------- el parser de prosa

/**
 * Las formas en que un contexto cita el id de una página. Todas llevan por
 * delante algo que dice «esto es un id»: «id 456789», «id: 456789»,
 * «/pages/456789», «pageId=456789». Sin ese prefijo, un número de cuatro
 * cifras en una frase no es una página, y «SIMPL-1234» tampoco (no hay ningún
 * «id» ni ninguna barra delante de sus cifras).
 *
 * Ojo con `\bid`: en «pageId=456789» no hay frontera de palabra antes de la
 * «I» (va pegada a «page»), así que esa forma la coge su propia rama, y ésa sí
 * vale tanto en una URL («?pageId=») como escrita a mano («(pageId=…)»).
 */
const ID_IN_LINE = new RegExp(
  '(?:\\bid\\s*[:=]?\\s*|/pages/(?:viewpage\\.action)?|\\bpageId\\s*=\\s*)(\\d{' + SOURCE_LIMITS.bareIdMin + ',})',
  'i'
)

/** El título citado: entre comillas latinas, o en negrita. */
const TITLE_QUOTED = /«([^»]{1,200})»/
const TITLE_BOLD = /\*\*([^*]{1,200})\*\*/
/** Un encabezado Markdown, o una línea entera en negrita, que es como los escriben los modelos. */
const HEADING = /^#{1,6}\s+(.*\S)\s*$/
const BOLD_LINE = /^\*\*([^*]{1,120})\*\*:?$/
/** Lo que sobra de una línea para quedarse con lo que dice: viñetas, numeración y marcado. */
const BULLET = /^(?:[-*+]|\d{1,3}[.)])\s+/
const MARKUP = /[«»*`_]/g

function roleIn(texto) {
  const t = String(texto || '')
  if (!t) return ''
  for (const [role, re] of ROLE_MATCH) if (re.test(t)) return role
  return ''
}

function titleIn(linea) {
  const m = TITLE_QUOTED.exec(linea) || TITLE_BOLD.exec(linea)
  return m ? clean(m[1], SOURCE_LIMITS.titleMax) : ''
}

/**
 * Las páginas de referencia que el CONTEXT.md cita con su id. Pura.
 *
 * Una línea con id es una referencia; una sin id que sea un encabezado (o una
 * línea entera en negrita) pasa a ser el apartado en vigor, y de él sale el
 * papel cuando la línea no lo dice («**Procesos**» y debajo un ADR en negrita
 * con su id). El papel de la línea manda sobre el del apartado.
 *
 * LÍMITES ASUMIDOS, y son los que hacen que esto sea barato y no se equivoque:
 * una línea aporta UNA referencia (la del primer id), porque el indexador pide
 * una por viñeta; el título sale de las comillas o de la negrita, y si la línea
 * no lo destaca se pide al índice, porque quedarse con «la frase de antes del
 * id» convertía oraciones enteras en títulos; y `families` sale siempre vacía,
 * porque la prosa no dice a qué clase de trabajo sirve una página y deducirlo
 * con las regex de `ISSUE_FAMILIES` marcaría de «error» cualquier línea que
 * lleve la palabra «error». El cruce papel ↔ familia lo hace `roleForFamily`.
 */
export function referencesFromContext(contextMd, { index = null } = {}) {
  const texto = String(contextMd ?? '')
    .slice(0, REFERENCE_LIMITS.contextMax)
    .replace(/\r\n?/g, '\n')
  const items = []
  let apartado = ''

  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim()
    if (!linea) continue
    const id = ID_IN_LINE.exec(linea)?.[1] || ''
    if (!id) {
      const h = HEADING.exec(linea) || BOLD_LINE.exec(linea)
      if (h) apartado = clean(h[1], REFERENCE_LIMITS.forWhatMax)
      continue
    }
    if (items.length >= REFERENCE_LIMITS.max) break
    items.push({
      families: [],
      forWhat: clean(linea.replace(BULLET, '').replace(MARKUP, ' '), REFERENCE_LIMITS.forWhatMax),
      id,
      role: roleIn(linea) || roleIn(apartado) || 'otra',
      title: titleIn(linea),
    })
  }
  return normalizeReferences({ items }, { index })
}
