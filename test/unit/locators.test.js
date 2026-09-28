import { test, eq, assert } from '../harness.js'
import {
  hrefDescriptors,
  locatorPlan,
  locateStep,
  resolveDescriptor,
  isSafeToClick,
  foldLabel,
  FORBIDDEN_ACTIONS,
  cssEscape,
} from '../../src/content/locators.js'
// Qué es un menú y qué no lo decide tree-dom.js, y locators.js no lo reexporta
// a propósito: quien lo necesite lo importa de allí.
import { isMenuTrigger } from '../../src/content/tree-dom.js'

/** Elemento de mentira: sólo lo que `isSafeToClick` mira de verdad. */
function fake(tag, attrs = {}, text = '') {
  return {
    tagName: tag.toUpperCase(),
    isConnected: true,
    textContent: text,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    // Lo único que `isSafeToClick` pregunta con `matches` (H28): si es un
    // control con `aria-expanded`, que en una fila del árbol es su chevron.
    matches: (sel) => sel === '[aria-expanded]' && 'aria-expanded' in attrs,
    closest: () => null,
    querySelector: () => null,
  }
}

/**
 * Una fila del árbol de mentira, con lo que miran `rowFor` y `rowLink`: cada
 * elemento sube a ella por `closest`, y ella da sus `a[href]` en orden de
 * documento. Devuelve la fila.
 */
function filaDelArbol(elementos) {
  const fila = {
    tagName: 'LI',
    querySelectorAll: (sel) => (sel === 'a[href]' ? elementos.filter((e) => e.tagName === 'A' && e.getAttribute('href') !== null) : []),
  }
  for (const e of elementos) e.closest = () => fila
  return fila
}

/** El contenedor del árbol de mentira: sólo sabe qué filas contiene. */
function arbolCon(...filas) {
  const dentro = new Set(filas)
  return { contains: (x) => dentro.has(x) }
}

const ORIGIN = 'https://acme.atlassian.net'

test('hrefDescriptors: el id de la página es la pista más fiable', () => {
  const d = hrefDescriptors({ kind: 'confluence-page', id: '1234567' })
  eq(d[0], { by: 'href', value: '/pages/1234567/' })
  eq(d[1], { by: 'href-end', value: '/pages/1234567' })
})

test('SEGURIDAD DE PRECISIÓN: el espacio no se busca por «contiene»', () => {
  // `/spaces/ENG/` está dentro de `/spaces/ENG/pages/100/Arquitectura`, así que
  // buscar por contenido llevaría a la página hija en vez de al espacio.
  const d = hrefDescriptors({ kind: 'confluence-space', id: 'ENG' })
  eq(d[0], { by: 'href-end', value: '/spaces/ENG' })
  assert(
    !d.some((x) => x.by === 'href' && x.value === '/spaces/ENG/'),
    'no debe haber una coincidencia por contenido del espacio a secas'
  )
})

test('SEGURIDAD DE PRECISIÓN: ENG-7 no puede casar con ENG-70', () => {
  const d = hrefDescriptors({ kind: 'jira-issue', id: 'ENG-7' })
  eq(d[0], { by: 'href-end', value: '/browse/ENG-7' })
  eq(d[1], { by: 'href-param', name: 'selectedIssue', value: 'ENG-7' })
  assert(!d.some((x) => x.by === 'href'), 'nada por contenido: /browse/ENG-7 es prefijo de /browse/ENG-70')
})

test('hrefDescriptors: un paso sin id no genera nada', () => {
  eq(hrefDescriptors({ kind: 'confluence-page' }), [])
})

test('locatorPlan: el href va antes que el rol, y el rol antes que el testid', () => {
  const plan = locatorPlan({ kind: 'confluence-page', id: '99', title: 'ADR-014' })
  assert(plan[0].by.startsWith('href'), 'lo primero debe ser por href')
  const byIdx = (b) => plan.findIndex((p) => p.by === b)
  assert(byIdx('href') < byIdx('role-name'), 'el href debe ir primero')
  // Nunca por clase CSS: se pierde en cada rediseño de Atlassian.
  assert(!plan.some((p) => p.by === 'class'), 'no debe haber estrategia por clase')
  // Ni por data-testid: los de Atlassian nombran contenedores, no páginas, y
  // casar con el contenedor entero es peor que no encontrar nada.
  assert(!plan.some((p) => p.by === 'testid'), 'no debe caer en un contenedor')
})

test('SEGURIDAD: un enlace del propio sitio se puede pulsar', () => {
  const a = fake('a', { href: '/wiki/spaces/ENG/pages/200/ADR-014' }, 'ADR-014')
  eq(isSafeToClick(a, ORIGIN).ok, true)
})

test('SEGURIDAD: un enlace fuera del sitio no se pulsa', () => {
  const a = fake('a', { href: 'https://malicioso.example/robar' }, 'Documentación')
  const r = isSafeToClick(a, ORIGIN)
  eq(r.ok, false)
  assert(r.reason.includes('sale del sitio'))
})

test('SEGURIDAD: javascript: nunca', () => {
  eq(isSafeToClick(fake('a', { href: 'javascript:alert(1)' }, 'Ver'), ORIGIN).ok, false)
})

test('SEGURIDAD: nada que actúe se pulsa, aunque sea un enlace del sitio', () => {
  const casos = [
    ['a', { href: '/wiki/x' }, 'Eliminar página'],
    ['button', { role: 'button' }, 'Publicar'],
    ['a', { href: '/browse/AB-1' }, 'Transicionar a Hecho'],
    ['button', {}, 'Enviar comentario'],
    ['a', { href: '/x' }, 'Compartir'],
    ['button', {}, 'Cerrar sesión'],
  ]
  for (const [tag, attrs, label] of casos) {
    const r = isSafeToClick(fake(tag, attrs, label), ORIGIN)
    eq(r.ok, false, `debería rechazar «${label}»`)
  }
})

test('SEGURIDAD: la lista de acciones prohibidas cubre lo destructivo', () => {
  for (const w of ['eliminar', 'publicar', 'enviar', 'transicion', 'compartir', 'comprar']) {
    assert(FORBIDDEN_ACTIONS.includes(w), `falta «${w}» en la lista`)
  }
})

test('desplegar una rama del árbol sí es seguro', () => {
  eq(isSafeToClick(fake('button', { 'aria-expanded': 'false' }, 'Arquitectura'), ORIGIN).ok, true)
  // Ya desplegado: no hay nada que hacer.
  eq(isSafeToClick(fake('button', { 'aria-expanded': 'true' }, 'Arquitectura'), ORIGIN).ok, false)
})

// M9 (auditoría del 2026-09-13): un disparador de menú lleva el mismo
// `aria-expanded="false"` que un chevron del árbol, y el barrido lo pulsaba:
// abría «Mover», «Archivar», «Eliminar» encima de la página buscando la rama.
test('SEGURIDAD: un disparador de menú con aria-expanded=false no se pulsa', () => {
  const r = isSafeToClick(fake('button', { 'aria-expanded': 'false', 'aria-haspopup': 'true' }, 'Más acciones'), ORIGIN)
  eq(r.ok, false)
  assert(r.reason.includes('abre un menú'), r.reason)
  for (const popup of ['menu', 'listbox', 'dialog', 'grid', 'tree', 'TRUE']) {
    eq(isSafeToClick(fake('button', { 'aria-expanded': 'false', 'aria-haspopup': popup }, '···'), ORIGIN).ok, false, popup)
  }
  // AUI (Jira DC) hace sus disparadores con un <a href="#">: antes pasaba como «ancla».
  eq(isSafeToClick(fake('a', { href: '#', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, 'Más'), ORIGIN).ok, false)
  // Sin aria-haspopup pero con aria-controls hacia un role=menu.
  const menu = { getAttribute: (n) => (n === 'role' ? 'menu' : null) }
  const conControls = fake('button', { 'aria-expanded': 'false', 'aria-controls': 'menu-1' }, 'Más')
  conControls.ownerDocument = { getElementById: (id) => (id === 'menu-1' ? menu : null) }
  eq(isSafeToClick(conControls, ORIGIN).ok, false)
})

test('un chevron del árbol sigue siendo «desplegar», con aria-haspopup=false o aria-controls a su grupo', () => {
  eq(isSafeToClick(fake('button', { 'aria-expanded': 'false' }, 'Arquitectura'), ORIGIN), { ok: true, kind: 'desplegar' })
  eq(isSafeToClick(fake('button', { 'aria-expanded': 'false', 'aria-haspopup': 'false' }, 'Arquitectura'), ORIGIN).kind, 'desplegar')
  // En un árbol ARIA el chevron apunta con aria-controls al grupo de hijas.
  const grupo = { getAttribute: (n) => (n === 'role' ? 'group' : null) }
  const chevron = fake('button', { 'aria-expanded': 'false', 'aria-controls': 'hijas-1' }, 'Arquitectura')
  chevron.ownerDocument = { getElementById: (id) => (id === 'hijas-1' ? grupo : null) }
  eq(isSafeToClick(chevron, ORIGIN).kind, 'desplegar')
  // Un aria-controls que no apunta a nada tampoco asusta.
  const suelto = fake('button', { 'aria-expanded': 'false', 'aria-controls': 'no-existe' }, 'Arquitectura')
  suelto.ownerDocument = { getElementById: () => null }
  eq(isSafeToClick(suelto, ORIGIN).kind, 'desplegar')
})

// F9 (verificación en real, 2026-09-21): el chevron del pagetree clásico de un
// Confluence Data Center es un `<a href="" role="button" aria-expanded="false">`
// con el título de la página en su `aria-label`. Vale «ancla» y no «desplegar»
// —el bloque de los enlaces va antes que el de `aria-expanded`—, y da igual:
// quien lo pulsa (`_abrirRama`) sólo mira `ok`. Se pina porque es lo que se
// pulsa de verdad en ese Confluence, no una forma inventada.
test('F9: el chevron del pagetree de un Data Center se puede pulsar', () => {
  const chevron = fake('a', {
    href: '',
    role: 'button',
    tabindex: '0',
    'aria-expanded': 'false',
    'aria-label': 'Ampliar elemento 1080 - Architecture',
  })
  eq(isSafeToClick(chevron, ORIGIN), { ok: true, kind: 'ancla' })
  eq(isMenuTrigger(chevron), false, 'no es un disparador de menú: no lleva aria-haspopup ni aria-controls')
  // Y el «Borrar este enlace» que ese mismo Jira pinta al lado de cada enlace
  // remoto sigue siendo intocable, aunque también sea un <a>.
  eq(isSafeToClick(fake('a', { href: '/secure/DeleteRemoteIssueLink.jspa?id=1' }, 'Borrar este enlace'), ORIGIN).ok, false)
})

test('un div cualquiera no se pulsa', () => {
  eq(isSafeToClick(fake('div', {}, 'algo'), ORIGIN).ok, false)
})

test('el nombre accesible gana al texto', () => {
  const a = fake('a', { href: '/x', 'aria-label': 'Eliminar' }, 'Ver detalles')
  eq(isSafeToClick(a, ORIGIN).ok, false)
})

test('foldLabel quita acentos y normaliza', () => {
  eq(foldLabel('  Rotación   DE Credenciales '), 'rotacion de credenciales')
})

test('cssEscape escapa comillas, no las barras de las rutas', () => {
  eq(cssEscape('/pages/123/'), '/pages/123/')
  eq(cssEscape('a"b'), 'a\\"b')
})

// --- H28 (PLAN3 §0 y §3.2, C3-8): el título de una fila es contenido ---------
// En el Confluence 9.2 del usuario el chevron del pagetree lleva el título en
// su etiqueta, y «Ampliar elemento 8700 - Contract + Billing» casaba con
// «billing»: Faro no desplegaba esa rama. El título se quita del nombre del
// chevron y del enlace propio de una fila DENTRO del árbol; lo demás, igual.
// En Node no hay `document`, así que sin `container` no se quita nada (las
// pruebas de arriba) y aquí se pasa uno de mentira.

/** Una fila del pagetree como la de F9: chevron `<a href="">` delante, enlace detrás. */
function filaPagetree(titulo, id) {
  const chevron = fake('a', { href: '', role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': 'Ampliar elemento ' + titulo })
  const enlace = fake('a', { href: `/spaces/SIMPL/pages/${id}/Pagina?src=contextnavpagetreemode` }, titulo)
  return { chevron, enlace, fila: filaDelArbol([chevron, enlace]) }
}

test('SEGURIDAD (H28): en una fila del árbol el título es contenido: su chevron y su enlace pasan aunque lleven «billing» o «new»', () => {
  const billing = filaPagetree('8700 - Contract + Billing', '8700')
  const nuevos = filaPagetree('Onboarding of new participants', '400')
  const arch = filaPagetree('1080 - Architecture', '1080')
  const container = arbolCon(billing.fila, nuevos.fila, arch.fila)

  eq(isSafeToClick(billing.chevron, ORIGIN, { container }), { ok: true, kind: 'ancla' }, 'el chevron de «… Billing»')
  eq(isSafeToClick(nuevos.chevron, ORIGIN, { container }), { ok: true, kind: 'ancla' }, 'el de «… new participants»')
  eq(isSafeToClick(billing.enlace, ORIGIN, { container }), { ok: true, kind: 'enlace' }, 'y el enlace propio de la fila')
  // El chevron F9 de siempre no cambia, con contenedor ni sin él.
  eq(isSafeToClick(arch.chevron, ORIGIN, { container }), { ok: true, kind: 'ancla' })
  eq(isSafeToClick(arch.chevron, ORIGIN), { ok: true, kind: 'ancla' })

  // El chevron de un árbol ARIA, un <button> con aria-expanded, igual.
  const boton = fake('button', { 'aria-expanded': 'false', 'aria-label': 'Expandir Guía para crear incidencias' })
  const suyo = fake('a', { href: '/wiki/spaces/ENG/pages/77/Guia' }, 'Guía para crear incidencias')
  eq(isSafeToClick(boton, ORIGIN, { container: arbolCon(filaDelArbol([boton, suyo])) }), { ok: true, kind: 'desplegar' })

  // Un título de más de 120 caracteres se quita igual: ANTES del recorte. Si se
  // recortara primero, el título quedaría a medias y «update» seguiría ahí.
  const largo = filaPagetree('Update of the ' + 'x'.repeat(130) + ' programme', '9001')
  eq(isSafeToClick(largo.chevron, ORIGIN, { container: arbolCon(largo.fila) }), { ok: true, kind: 'ancla' })
})

test('SEGURIDAD (H28): quitar el título no desbloquea nada que actúe, ni dentro de la fila ni fuera del árbol', () => {
  const { chevron, enlace } = filaPagetree('8700 - Contract + Billing', '8700')
  const borrar = fake('a', { href: '/x', 'aria-label': 'Delete page' })
  const mover = fake('a', { href: '', 'aria-label': 'Mover' })
  const menu = fake('button', { 'aria-expanded': 'false', 'aria-haspopup': 'true', 'aria-label': '···' })
  const container = arbolCon(filaDelArbol([chevron, enlace, borrar, mover, menu]))

  // Dentro de la fila: un <a> que no es el enlace propio, un «chevron» con
  // otra etiqueta y el «···» (M9) siguen bloqueados.
  eq(isSafeToClick(borrar, ORIGIN, { container }).ok, false, '«Delete page» dentro de la fila')
  eq(isSafeToClick(mover, ORIGIN, { container }).ok, false, '«Mover» con href="" dentro de la fila')
  eq(isSafeToClick(menu, ORIGIN, { container }).ok, false, 'el «···» de la fila')

  // Fuera del árbol, con el contenedor puesto, lo de siempre.
  for (const [tag, attrs, label] of [
    ['button', {}, 'Eliminar'],
    ['a', { href: '/x' }, 'Guardar'],
    ['button', { role: 'button' }, 'Publicar'],
    ['a', { href: '/x' }, 'Unpublish'],
    ['button', {}, 'Reassign'],
  ]) {
    eq(isSafeToClick(fake(tag, attrs, label), ORIGIN, { container }).ok, false, `«${label}» fuera del árbol`)
  }
  eq(isSafeToClick(fake('a', { href: '/secure/DeleteRemoteIssueLink.jspa?id=1' }, 'Borrar este enlace'), ORIGIN, { container }).ok, false, 'F9')

  // `rowFor` da por fila cualquier `li` (ROW_SELECTORS lo lleva): uno FUERA
  // del contenedor, con un enlace con forma de página, no es una fila del árbol.
  const fuera = fake('a', { href: '/spaces/SIMPL/pages/9/Delete' }, 'Delete')
  filaDelArbol([fuera])
  eq(isSafeToClick(fuera, ORIGIN, { container }).ok, false, 'un li fuera del árbol')

  // `removepage.action?pageId=` casa con PAGE_HREF, pero no lleva a VER la
  // página: no es el enlace propio de nadie, y su texto no es un título.
  const quitar = fake('a', { href: '/pages/removepage.action?pageId=8700' }, 'Eliminar')
  eq(isSafeToClick(quitar, ORIGIN, { container: arbolCon(filaDelArbol([quitar])) }).ok, false, 'una acción con pageId')

  // El título se quita como palabra ENTERA: una página llamada «e» no borra
  // las «e» de «delete page».
  const chevronE = fake('a', { href: '', 'aria-label': 'Delete page' })
  const enlaceE = fake('a', { href: '/spaces/SIMPL/pages/5/E' }, 'e')
  eq(isSafeToClick(chevronE, ORIGIN, { container: arbolCon(filaDelArbol([chevronE, enlaceE])) }).ok, false, 'un título de una letra')
})

// --- H28 (PLAN3 §3.2, C3-6): pistas por ruta con frontera ------------------

test('C3-6 (H28): una ruta sin slug no da pistas por ruta: viewpage.action o el id en la consulta', () => {
  // `/pages/viewpage.action?pageId=12345` sin la consulta es el prefijo de
  // TODAS las páginas de un Data Center: manda el id.
  eq(hrefDescriptors({ kind: 'confluence-page', id: '12345', path: '/pages/viewpage.action?pageId=12345' }), [
    { by: 'href', value: '/pages/12345/' },
    { by: 'href-end', value: '/pages/12345' },
    { by: 'href-param', name: 'pageId', value: '12345' },
  ])
  eq(hrefDescriptors({ kind: 'confluence-page', id: '9', path: '/confluence/pages/viewpage.action' })[0].by, 'href', 'acabar en .action basta')
  eq(hrefDescriptors({ kind: 'confluence-page', id: '9', path: '/spaces/SIMPL/overview?pageId=9' })[0].by, 'href', 'y el id en la consulta también')
})

test('C3-6 (H28): la ruta casa por final exacto y por ruta entera, nunca por «contiene»', () => {
  const P = '/display/SIMPL/Architecture'
  eq(hrefDescriptors({ kind: 'confluence-page', id: '555', path: P }).slice(0, 2), [
    { by: 'href-end', value: P },
    { by: 'href-path', value: P },
  ])
  // Para cualquier tipo: `/browse/ENG-7` está dentro de `/browse/ENG-70`.
  for (const step of [
    { kind: 'confluence-page', id: '555', path: P },
    { kind: 'confluence-space', id: 'SIMPL', path: '/display/SIMPL' },
    { kind: 'jira-issue', id: 'ENG-7', path: '/browse/ENG-7' },
    { kind: 'jira-project', id: 'ENG', path: '/projects/ENG/issues' },
  ]) {
    assert(!hrefDescriptors(step).some((x) => x.by === 'href' && x.value === step.path), `${step.kind}: nada por contenido de la ruta`)
  }
})

/**
 * Un documento de mentira para `locateStep`: enlaces visibles con su href y un
 * `querySelectorAll` que entiende los selectores simples del localizador
 * (`a[href]`, `a[href$="…"]`, `a[href*="…"]`, `[role="…"]`, separados por
 * comas). Un selector que no entienda revienta: así no se cuela un «nada».
 */
function documento(hrefs) {
  const enlaces = hrefs.map((href) => ({
    tagName: 'A',
    isConnected: true,
    textContent: '',
    innerText: '',
    getAttribute: (n) => (n === 'href' ? href : null),
    getBoundingClientRect: () => ({ width: 80, height: 16 }),
    querySelector: () => null,
  }))
  const casa = (el, sel) => {
    const m = /^(\w*)\[([\w-]+)(?:([*$^]?=)"((?:[^"\\]|\\.)*)")?\]$/.exec(sel.trim())
    if (!m) throw new Error('selector que el documento de mentira no entiende: ' + sel)
    const [, tag, attr, op, crudo] = m
    if (tag && el.tagName !== tag.toUpperCase()) return false
    const v = el.getAttribute(attr)
    if (v === null) return false
    const valor = (crudo || '').replace(/\\(.)/g, '$1')
    if (op === '=') return v === valor
    if (op === '*=') return v.includes(valor)
    if (op === '$=') return v.endsWith(valor)
    if (op === '^=') return v.startsWith(valor)
    return true
  }
  return { querySelectorAll: (sel) => enlaces.filter((e) => sel.split(',').some((s) => casa(e, s))) }
}

/** `visible()` de tree-dom.js pide `getComputedStyle`: dentro de la prueba y restaurado. */
function conEstilos(fn) {
  const previo = globalThis.getComputedStyle
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' })
  try {
    return fn()
  } finally {
    if (previo === undefined) delete globalThis.getComputedStyle
    else globalThis.getComputedStyle = previo
  }
}

test('C3-6 (H28): entre dos viewpage.action gana el del id, no el de href más corto', () => {
  conEstilos(() => {
    const doc = documento(['/pages/viewpage.action?pageId=7', '/pages/viewpage.action?pageId=12345'])
    const r = locateStep({ kind: 'confluence-page', id: '12345', path: '/pages/viewpage.action?pageId=12345' }, doc)
    eq(r?.element.getAttribute('href'), '/pages/viewpage.action?pageId=12345', 'antes ganaba el 7 por ser más corto')
    eq(r?.by, 'href-param')
  })
})

test('C3-6 (H28): /display/SIMPL/Architecture no casa con …/Architecture+Overview del cuerpo, y sí con el del árbol aunque lleve ?src=', () => {
  conEstilos(() => {
    const paso = { kind: 'confluence-page', id: '555', path: '/display/SIMPL/Architecture' }
    const arbol = '/display/SIMPL/Architecture?src=contextnavpagetreemode'
    const cuerpo = '/display/SIMPL/Architecture+Overview'
    const r = locateStep(paso, documento([cuerpo, arbol]))
    eq(r?.element.getAttribute('href'), arbol, 'antes ganaba el del cuerpo, más corto')
    eq(r?.by, 'href-path')
    eq(locateStep(paso, documento([cuerpo])), null, 'con sólo el del cuerpo, nada')

    // La ruta entera: sin ancla ni barra final, y escrita igual aunque una
    // traiga la tilde cruda y la otra codificada.
    const ruta = (value, hrefs) => resolveDescriptor({ by: 'href-path', value }, documento(hrefs))?.getAttribute('href') ?? null
    eq(ruta('/display/SIMPL/Architecture', ['/display/SIMPL/Architecture/#decision']), '/display/SIMPL/Architecture/#decision')
    eq(ruta('/display/SIMPL/Categoría', ['/display/SIMPL/Categor%C3%ADa?src=x']), '/display/SIMPL/Categor%C3%ADa?src=x')
    eq(ruta('/display/SIMPL/Architecture', ['/display/SIMPL/Architecture/Hija']), null, 'una hija no es la página')
  })
})
