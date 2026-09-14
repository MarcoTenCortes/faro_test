import { test, eq, assert } from '../harness.js'
import {
  hrefDescriptors,
  locatorPlan,
  isSafeToClick,
  foldLabel,
  FORBIDDEN_ACTIONS,
  cssEscape,
} from '../../src/content/locators.js'

/** Elemento de mentira: sólo lo que `isSafeToClick` mira de verdad. */
function fake(tag, attrs = {}, text = '') {
  return {
    tagName: tag.toUpperCase(),
    isConnected: true,
    textContent: text,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    closest: () => null,
    querySelector: () => null,
  }
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
