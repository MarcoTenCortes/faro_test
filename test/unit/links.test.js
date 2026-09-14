/**
 * Qué enlaces del chat puede abrir el panel (src/panel/links.js).
 *
 * `openUrl` abría en una pestaña nueva cualquier enlace que escribiera el
 * modelo: phishing desde una respuesta inyectada (docs/PLAN.md §2.1 S5,
 * reproducido en la auditoría del 2026-09-13). Sólo se abren el sitio de la
 * pestaña, el Confluence enlazado y la lista fija de la extensión.
 */
import { test, eq, assert } from '../harness.js'
import { allowedLinkOrigin, EXTENSION_ORIGINS } from '../../src/panel/links.js'

const ctx = { origin: 'https://acme.atlassian.net', linkedOrigin: 'https://confluence.acme.eu' }

test('SEGURIDAD: se abre el propio sitio y el Confluence enlazado, con cualquier ruta', () => {
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki/spaces/ENG/pages/123', ctx), true)
  eq(allowedLinkOrigin('https://acme.atlassian.net/browse/ENG-7?focusedCommentId=1#c1', ctx), true)
  eq(allowedLinkOrigin('https://confluence.acme.eu/display/ENG/Guia', ctx), true)
  eq(allowedLinkOrigin('https://ACME.atlassian.net/wiki', ctx), true, 'el host no distingue mayúsculas')
  eq(allowedLinkOrigin('https://acme.atlassian.net:443/wiki', ctx), true, 'el puerto por defecto es el mismo origen')
})

test('SEGURIDAD: otro host, un subdominio parecido, otro esquema o un puerto distinto NO se abren', () => {
  eq(allowedLinkOrigin('https://evil.example/login', ctx), false)
  eq(allowedLinkOrigin('https://acme.atlassian.net.evil.example/wiki', ctx), false, 'el host propio como prefijo de otro')
  eq(allowedLinkOrigin('https://login.acme.atlassian.net/', ctx), false, 'un subdominio del propio')
  eq(allowedLinkOrigin('https://acme-atlassian.net/', ctx), false)
  eq(allowedLinkOrigin('http://acme.atlassian.net/wiki', ctx), false, 'http no es el mismo origen que https')
  eq(allowedLinkOrigin('https://acme.atlassian.net:8443/wiki', ctx), false, 'otro puerto es otro origen')
  eq(allowedLinkOrigin('https://acme.atlassian.net@evil.example/', ctx), false, 'el host propio como usuario de la URL')
})

test('SEGURIDAD: javascript:, data:, chrome:, file: y lo que no es una URL no se abren nunca', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'chrome://extensions', 'file:///etc/passwd', 'blob:https://acme.atlassian.net/x', '', null, undefined, 'wiki/spaces/ENG', '//evil.example/x']) {
    eq(allowedLinkOrigin(href, ctx), false, 'no debería abrirse: ' + href)
  }
})

test('SEGURIDAD: la lista fija de la extensión (id.atlassian.com) se abre siempre, y sin sitio nada más', () => {
  eq(EXTENSION_ORIGINS, ['https://id.atlassian.com'])
  eq(allowedLinkOrigin('https://id.atlassian.com/manage-profile/security/api-tokens', {}), true)
  eq(allowedLinkOrigin('https://id.atlassian.com.evil.example/', {}), false)
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', {}), false, 'sin sitio no hay origen propio')
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', { origin: '', linkedOrigin: '' }), false)
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki'), false)
})

test('los orígenes del contexto se normalizan (barra final, URL entera, mayúsculas) y uno raro no abre nada', () => {
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', { origin: 'https://acme.atlassian.net/' }), true)
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', { origin: 'https://acme.atlassian.net/wiki/spaces/ENG' }), true, 'vale una URL del sitio: sólo cuenta su origen')
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', { origin: 'HTTPS://ACME.ATLASSIAN.NET' }), true)
  eq(allowedLinkOrigin('https://acme.atlassian.net/wiki', { origin: 'acme.atlassian.net' }), false, 'sin esquema no es un origen')
  eq(allowedLinkOrigin('https://x/', { origin: 'javascript:alert(1)', linkedOrigin: 'null' }), false)
  assert(Object.isFrozen(EXTENSION_ORIGINS))
})
