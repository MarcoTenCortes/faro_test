/**
 * Cómo encontrar en la página el elemento de un paso de la navegación asistida.
 *
 * La decisión que hace que esto envejezca bien: **primero el href**. Para
 * pulsar «la página ADR-014 en el árbol lateral» no hace falta adivinar la
 * clase CSS del árbol, porque ya conocemos su id y el enlace lo lleva dentro.
 * Los id de Atlassian no cambian nunca; sus clases CSS cambian cada trimestre.
 *
 * La lista de estrategias (`locatorPlan`) es pura y por tanto comprobable;
 * resolverla contra el DOM es lo único que necesita navegador.
 *
 * Todo lo que tiene que ver con la FORMA del árbol vive en `tree-dom.js`, que
 * es el único sitio donde se decide qué es una fila y cuál es su control de
 * desplegar. Aquí sólo se re-exporta lo que ya usaban otros.
 */

import { rowFor, toggleFor, isRowExpanded, visible, hasVisibleChildRows } from './tree-dom.js'

export { hasVisibleChildRows }

/** Palabras que jamás se pulsan automáticamente. Navegar no es actuar. */
export const FORBIDDEN_ACTIONS = [
  'eliminar', 'borrar', 'delete', 'remove', 'quitar',
  'publicar', 'publish', 'enviar', 'send', 'submit',
  'comentar', 'comment', 'responder', 'reply',
  'guardar', 'save', 'actualizar', 'update',
  'mover', 'move', 'archivar', 'archive', 'restaurar', 'restore',
  'transicion', 'transition', 'aprobar', 'approve', 'rechazar', 'reject',
  'asignar', 'assign', 'cerrar', 'close', 'resolver', 'resolve',
  'compartir', 'share', 'invitar', 'invite', 'permisos', 'permissions',
  'cerrar sesion', 'logout', 'sign out', 'desconectar',
  'comprar', 'pagar', 'purchase', 'upgrade', 'facturacion', 'billing',
  'revertir', 'revert', 'fusionar', 'merge', 'crear', 'create', 'nuevo', 'new',
]

/** Quita acentos y baja a minúsculas, para comparar etiquetas. */
export function foldLabel(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Descriptores de href que identifican inequívocamente el destino de un paso.
 *
 * Cuidado con `contains`: `/spaces/ENG/` también aparece dentro de
 * `/spaces/ENG/pages/100/Arquitectura`, y `/browse/ENG-7` dentro de
 * `/browse/ENG-70`. Por eso lo primero de cada lista es siempre una
 * coincidencia por final de cadena o por parámetro, que no admite prefijos.
 *
 * @param {{kind:string, id:string}} step
 * @returns {Array<{by:string, value?:string, name?:string}>}
 */
export function hrefDescriptors(step) {
  const id = String(step?.id ?? '')
  const out = []

  // La ruta del índice lleva el slug del título, así que identifica la página
  // aunque el id que guardamos no sea el que usa este Confluence. Va primero
  // porque es la pista más concreta que tenemos.
  const path = pathOnly(step?.path)
  if (path && path.length > 8) {
    out.push({ by: 'href-end', value: path })
    out.push({ by: 'href', value: path })
  }

  if (!id) return out
  return out.concat(idDescriptors(step, id))
}

/** Ruta sin query ni ancla, para poder compararla con un href. */
function pathOnly(path) {
  if (typeof path !== 'string') return ''
  return path.split('#')[0].split('?')[0].replace(/\/+$/, '')
}

function idDescriptors(step, id) {
  switch (step?.kind) {
    case 'confluence-page':
      return [
        { by: 'href', value: `/pages/${id}/` },
        { by: 'href-end', value: `/pages/${id}` },
        { by: 'href-param', name: 'pageId', value: id },
      ]
    case 'confluence-space':
      return [
        { by: 'href-end', value: `/spaces/${id}` },
        { by: 'href-end', value: `/display/${id}` },
        { by: 'href', value: `/spaces/${id}/overview` },
        { by: 'href', value: `/spaces/${id}/home` },
      ]
    case 'jira-issue':
      return [
        { by: 'href-end', value: `/browse/${id}` },
        { by: 'href-param', name: 'selectedIssue', value: id },
      ]
    case 'jira-project':
      return [
        { by: 'href-end', value: `/projects/${id}` },
        { by: 'href', value: `/projects/${id}/` },
        { by: 'href-param', name: 'projectKey', value: id },
      ]
    default:
      return [{ by: 'href-end', value: `/${id}` }]
  }
}

/**
 * Lista ordenada de estrategias para localizar el paso.
 * De más resistente a rediseños a menos.
 */
export function locatorPlan(step) {
  const plan = [...hrefDescriptors(step)]
  // El modelo escribe etiquetas largas y descriptivas («Su ACV
  // correspondiente: ACV Static - ...»), mientras que en el árbol pone sólo el
  // título. Se prueban las dos, y el título primero.
  const nombres = []
  for (const n of [step?.title, step?.label]) {
    const limpio = String(n || '').trim()
    if (limpio && !nombres.includes(limpio)) nombres.push(limpio)
  }
  for (const name of nombres) {
    plan.push({ by: 'role-name', role: 'treeitem', name })
    plan.push({ by: 'role-name', role: 'link', name })
    plan.push({ by: 'role-name', role: 'menuitem', name })
    plan.push({ by: 'text-link', name })
  }
  // Aquí NO va ningún `data-testid`: los que publica Atlassian identifican
  // contenedores («side-navigation»), no la página concreta del paso. Casar
  // con el contenedor entero es peor que no encontrar nada, porque el ejecutor
  // se pondría a resaltar media pantalla. Si nada de lo anterior acierta, es
  // mejor rendirse y ofrecer el salto directo.
  return plan
}

// ---------------------------------------------------------------- DOM

/**
 * Nombre accesible del elemento.
 *
 * Usa `innerText`, no `textContent`, y la diferencia importa de verdad:
 * `textContent` incluye el texto de las ramas plegadas del árbol, así que un
 * contenedor «Operación» acabaría casando con el nombre de una página hija
 * escondida y el ejecutor pulsaría el sitio equivocado.
 */
function accessibleName(el) {
  const label = el.getAttribute('aria-label')
  if (label) return label
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy && typeof document !== 'undefined') {
    const target = document.getElementById(labelledBy)
    if (target) return visibleText(target)
  }
  return visibleText(el)
}

export function visibleText(el) {
  if (typeof el.innerText === 'string') return el.innerText
  return el.textContent || ''
}

/**
 * Casa por nombre accesible.
 *
 * La coincidencia exacta gana siempre. La parcial sólo se acepta si el nombre
 * del candidato no es mucho más largo que lo buscado —si lo es, es un
 * contenedor, no el elemento— y si dentro no hay otro candidato del mismo
 * papel, para quedarse siempre con el más interior.
 */
function matchByName(nodes, wanted, role) {
  if (!wanted) return null
  let loose = null
  let checked = 0

  for (const el of nodes) {
    if (checked++ > 400) break
    if (!visible(el)) continue

    const name = foldLabel(accessibleName(el))
    if (!name) continue
    if (name === wanted) return el

    if (loose || wanted.length < 4) continue
    if (!name.includes(wanted)) continue
    if (name.length > wanted.length * 2.5) continue
    if (role && role !== 'link' && el.querySelector?.(`[role="${role}"]`)) continue
    loose = el
  }

  return loose
}

/**
 * De entre varios enlaces que casan, el bueno es el de href más corto: el de
 * la sección padre, no el de una página que cuelga de ella.
 */
function shortestVisible(nodes) {
  let best = null
  let bestLen = Infinity
  for (const a of nodes) {
    if (!visible(a)) continue
    const len = (a.getAttribute('href') || '').length
    if (len < bestLen) {
      best = a
      bestLen = len
    }
  }
  return best
}

/** Base para resolver hrefs relativos, también fuera del navegador. */
function baseUrl(origin) {
  if (origin) return origin
  if (typeof location !== 'undefined' && location.href) return location.href
  return 'https://faro.invalid/'
}

/** Resuelve una sola estrategia. Devuelve el primer elemento visible. */
export function resolveDescriptor(descriptor, scope = document) {
  switch (descriptor.by) {
    case 'href':
      return shortestVisible(scope.querySelectorAll(`a[href*="${cssEscape(descriptor.value)}"]`))

    case 'href-end':
      return shortestVisible(scope.querySelectorAll(`a[href$="${cssEscape(descriptor.value)}"]`))

    case 'href-param': {
      const wanted = String(descriptor.value).toLowerCase()
      const hits = []
      for (const a of scope.querySelectorAll(`a[href*="${cssEscape(descriptor.name)}="]`)) {
        if (!visible(a)) continue
        const href = a.getAttribute('href') || ''
        let params
        try {
          params = new URL(href, baseUrl()).searchParams
        } catch {
          continue
        }
        if ((params.get(descriptor.name) || '').toLowerCase() === wanted) hits.push(a)
      }
      return shortestVisible(hits)
    }
    case 'role-name': {
      const wanted = foldLabel(descriptor.name)
      const selector = descriptor.role === 'link'
        ? `[role="link"], a[href]`
        : `[role="${descriptor.role}"]`
      return matchByName(scope.querySelectorAll(selector), wanted, descriptor.role)
    }
    case 'text-link':
      return matchByName(scope.querySelectorAll('a[href]'), foldLabel(descriptor.name), 'link')
    case 'testid': {
      const el = scope.querySelector(`[data-testid="${cssEscape(descriptor.value)}"]`)
      return el && visible(el) ? el : null
    }
    default:
      return null
  }
}

/** Recorre el plan y devuelve el primer acierto, diciendo con qué estrategia. */
export function locateStep(step, scope = document) {
  for (const descriptor of locatorPlan(step)) {
    const el = resolveDescriptor(descriptor, scope)
    if (el) return { element: el, by: descriptor.by, descriptor }
  }
  return null
}

/**
 * ¿Se puede pulsar esto automáticamente?
 *
 * Sólo enlaces de navegación del mismo sitio y botones de desplegar. Nunca
 * nada que actúe: guardar, publicar, comentar, transicionar, eliminar.
 * Esta función es la que impide que una instrucción escondida en una página
 * de Confluence acabe cambiando el estado de un ticket.
 */
export function isSafeToClick(el, origin) {
  if (!el || !el.isConnected) return { ok: false, reason: 'el elemento ya no está en la página' }

  const name = foldLabel(accessibleName(el)).slice(0, 120)
  for (const word of FORBIDDEN_ACTIONS) {
    if (name.includes(word)) {
      return { ok: false, reason: `«${name}» parece una acción, no una navegación` }
    }
  }

  const tag = el.tagName
  const role = el.getAttribute('role')

  if (tag === 'A') {
    const href = el.getAttribute('href') || ''
    if (!href || href.startsWith('#')) return { ok: true, kind: 'ancla' }
    let url
    try {
      url = new URL(href, baseUrl(origin))
    } catch {
      return { ok: false, reason: 'el enlace no tiene una dirección válida' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, reason: 'el enlace no es http(s)' }
    }
    if (origin && url.origin !== new URL(origin).origin) {
      return { ok: false, reason: 'el enlace sale del sitio actual' }
    }
    return { ok: true, kind: 'enlace' }
  }

  // Desplegar una rama del árbol es seguro: no cambia nada.
  const expanded = el.getAttribute('aria-expanded')
  if (expanded !== null) {
    return expanded === 'false'
      ? { ok: true, kind: 'desplegar' }
      : { ok: false, reason: 'ya está desplegado' }
  }

  if (role === 'treeitem' || role === 'menuitem' || role === 'tab') return { ok: true, kind: role }

  return { ok: false, reason: 'no es un control de navegación reconocible' }
}

/** Sube hasta el enlace o el control pulsable que envuelve al elemento. */
export function clickableAncestor(el) {
  let cur = el
  for (let i = 0; cur && i < 6; i++) {
    if (cur.tagName === 'A' && cur.getAttribute('href')) return cur
    if (cur.getAttribute?.('role') === 'treeitem' || cur.getAttribute?.('aria-expanded') !== null) return cur
    cur = cur.parentElement
  }
  return el
}

/** Botón de desplegar de la rama que contiene al elemento, si lo hay. */
export function expanderFor(el) {
  const item = rowFor(el)
  if (!item) return null
  const btn = item.querySelector('[aria-expanded="false"]')
  return btn && visible(btn) ? btn : null
}

/**
 * El control de desplegar de la propia fila del árbol, esté abierto o cerrado.
 *
 * Hace falta distinguir «cerrado» de «ya abierto»: en el segundo caso no hay
 * nada que pulsar, pero el paso está cumplido igualmente.
 *
 * La forma del árbol la resuelve `tree-dom.js`; aquí sólo se le da la forma que
 * espera el ejecutor.
 */
export function treeToggleFor(el) {
  const item = rowFor(el)
  if (!item) return null

  const t = toggleFor(item)
  if (!t) return null

  return {
    toggle: t.toggle,
    row: item,
    // `aria-expanded` puede mentir: hay arboles que lo dejan en `true` con las
    // hijas ocultas. Lo que cuenta es si de verdad se ven filas debajo.
    expanded: isRowExpanded(item),
    declared: t.toggle.getAttribute('aria-expanded') === 'true',
    isRow: t.isRow,
  }
}

/** ¿Está desplegada ahora mismo esta fila del árbol? */
export function isExpanded(toggle) {
  return toggle?.getAttribute?.('aria-expanded') === 'true'
}

/**
 * Escapa un valor para meterlo entre comillas en un selector de atributo.
 * Ojo: NO vale `CSS.escape` aquí — eso escapa identificadores, no cadenas
 * entrecomilladas, y deja los `/` de las rutas hechos un desastre.
 */
export function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&')
}
