/**
 * Los enlaces del contenido de una página o de una incidencia.
 *
 * `pageLinks` necesita DOM (recorre el ámbito de lectura, pregunta por
 * `closest` y mide si un enlace se ve), así que de él se pina el cableado por
 * regex sobre el fuente —como hacen runner-wiring, overlay-wiring y la mitad de
 * digest.test.js— y se ejerce de verdad en el banco, sobre la incidencia de
 * Jira calcada del Data Center real.
 *
 * Lo único que sí se ejecuta aquí es lo que decide si un `href` es siquiera un
 * enlace a una página, que es una barrera y no depende del DOM: un
 * `javascript:` de una macro, un `mailto:`, un ancla o una URL rota no pueden
 * llegar al panel como candidatas a página base.
 */
import { test, eq, assert } from '../harness.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { linkHref, isOwnJiraRoute, LINK_LIMITS } from '../../src/content/page-links.js'

const ROOT = join(import.meta.dirname, '..', '..')

/** El fuente sin comentarios: lo que se pina es código, no lo que se cuenta de él. */
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const JS = sinComentarios(readFileSync(join(ROOT, 'src/content/page-links.js'), 'utf8'))

/** El trozo del fuente entre dos marcas de CÓDIGO, las dos obligatorias y en ese orden. */
function entre(desde, hasta) {
  const a = JS.indexOf(desde)
  assert(a >= 0, `no encuentro «${desde}» en page-links.js`)
  const b = JS.indexOf(hasta, a + desde.length)
  assert(b > a, `no encuentro «${hasta}» detrás de «${desde}»`)
  return JS.slice(a, b)
}

const BASE = 'https://jira.example.test/browse/ENG-7'

// ------------------------------------------------------- la barrera del href

test('SEGURIDAD: sólo http(s) llega a ser un enlace; un javascript:, un mailto: o un ancla no', () => {
  for (const malo of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1) ',
    'data:text/html,<b>x</b>',
    'mailto:alguien@example.test',
    'tel:+34600000000',
    'ftp://example.test/x',
    'chrome-extension://abc/panel.html',
    '#',
    '#seccion',
    '',
    '   ',
  ]) {
    eq(linkHref(malo, BASE), '', `no debería ser un enlace: ${malo || '(vacío)'}`)
  }
  eq(linkHref(null, BASE), '')
  eq(linkHref(undefined, BASE), '')
  // Un `javascript:` con un tabulador en medio se cae igual: lo que decide es
  // el esquema de la URL ya montada, no cómo estaba escrito el atributo.
  eq(linkHref('java' + String.fromCharCode(9) + 'script:alert(1)', BASE), '')
  eq(linkHref(String.fromCharCode(10) + 'javascript:alert(1)', BASE), '')
  // Y un ancla con un control delante sigue siendo un ancla: sin quitar los
  // controles ANTES de mirar, `new URL()` los tira él y devuelve la URL de la
  // página de ahora, o sea un enlace a donde ya estás.
  eq(linkHref(String.fromCharCode(1) + '#seccion', BASE), '')
})

test('un href relativo se resuelve contra la URL de la pestaña, y uno absoluto se queda como está', () => {
  eq(linkHref('/wiki/spaces/ENG/pages/200/ADR-014', BASE), 'https://jira.example.test/wiki/spaces/ENG/pages/200/ADR-014')
  eq(linkHref('  /wiki/x  ', BASE), 'https://jira.example.test/wiki/x')
  eq(
    linkHref('https://confluence.example.test/pages/viewpage.action?pageId=200', BASE),
    'https://confluence.example.test/pages/viewpage.action?pageId=200'
  )
  eq(linkHref('http://otro.example.test/x', BASE), 'http://otro.example.test/x')
  // Sin base, una relativa no es una URL: no se inventa un origen.
  eq(linkHref('/wiki/x', ''), '')
  eq(linkHref('https://confluence.example.test/x', ''), 'https://confluence.example.test/x')
  // Y una que ni con base se puede resolver.
  eq(linkHref('http://', BASE), '')
  // Lo que sale de aquí es SIEMPRE una URL absoluta, también cuando el href era
  // un número suelto. Importa: `pageRefFromUrl` acepta un número suelto como id
  // de página, así que un `<a href="200">` que llegara tal cual se habría
  // colado por ahí como «la página 200 de este sitio».
  eq(linkHref('200', BASE), 'https://jira.example.test/browse/200')
})

test('SEGURIDAD: una URL más larga que el tope se descarta entera, no se recorta', () => {
  const larga = 'https://confluence.example.test/wiki/spaces/ENG/pages/200/' + 'a'.repeat(LINK_LIMITS.hrefMax)
  assert(larga.length > LINK_LIMITS.hrefMax)
  eq(linkHref(larga, BASE), '', 'media URL no es una URL: el panel la parsearía creyéndola entera')
  const justa = 'https://confluence.example.test/x'
  assert(justa.length < LINK_LIMITS.hrefMax)
  eq(linkHref(justa, BASE), justa)
})

test('los topes son enteros positivos y el del texto cabe en una fila', () => {
  eq(Object.keys(LINK_LIMITS).sort(), ['hrefMax', 'max', 'textMax'])
  for (const [k, v] of Object.entries(LINK_LIMITS)) {
    assert(Number.isInteger(v) && v > 0, `${k} tiene que ser un entero positivo`)
  }
  assert(LINK_LIMITS.textMax <= 200 && LINK_LIMITS.max <= 200)
})

// ------------------------------------- una ruta propia de Jira no es una página

test('H14 real: un enlace a una ruta propia de Jira del mismo sitio no es una página', () => {
  // Pasó de verdad: una épica del Jira del usuario tiene 254 enlaces y el tope
  // de 60 se lo comían los suyos —22 `/browse/`, 21 `/rest/`, 12 `/secure/`
  // («Borrar este enlace»)—, así que los de los COMENTARIOS, que van al final
  // del documento, se quedaban fuera. Ninguno de ésos es una página que alguien
  // haya enlazado para esta incidencia: los pone Jira en todas.
  for (const propia of [
    'https://jira.example.test/browse/ENG-42',
    'https://jira.example.test/browse/ENG-42?focusedCommentId=1',
    'https://jira.example.test/secure/DeleteRemoteIssueLink!default.jspa?remoteIssueLinkId=10500',
    'https://jira.example.test/rest/api/2/issue/ENG-7/remotelink',
    'https://jira.example.test/issues/?jql=project%20%3D%20ENG',
    'https://jira.example.test/projects/ENG/issues',
    'https://jira.example.test/plugins/servlet/x',
    '/browse/ENG-42',
  ]) {
    eq(isOwnJiraRoute(propia, BASE), true, propia)
  }
  // Y con ruta de contexto, lo mismo: la deduce `jiraContextPath`, no una lista
  // nueva escrita aquí.
  eq(isOwnJiraRoute('https://jira.example.test/jira/browse/ENG-42', 'https://jira.example.test/jira/browse/ENG-7'), true)
  eq(isOwnJiraRoute('https://jira.example.test/jira/secure/Dashboard.jspa', 'https://jira.example.test/jira/browse/ENG-7'), true)
  // Lo que sí puede ser una página se queda: las de Confluence en cualquiera de
  // sus formas, y lo que no es del sitio.
  for (const pagina of [
    'https://jira.example.test/wiki/spaces/ENG/pages/200/ADR-014',
    'https://jira.example.test/display/ENG/Runbook+de+guardia',
    'https://jira.example.test/pages/viewpage.action?pageId=200',
    'https://confluence.example.test/browse/ENG-42',
    'https://otro.example.test/rest/api/2/x',
    'https://git.example.com/eng/exporter',
  ]) {
    eq(isOwnJiraRoute(pagina, BASE), false, pagina)
  }
  // SEGURIDAD: «del mismo sitio» es el origen EXACTO. Otro host, un subdominio
  // que empieza igual, otro puerto u otro esquema son otro sitio, y ahí un
  // `/browse/` puede ser cualquier cosa: eso lo decide el panel, no esto.
  eq(isOwnJiraRoute('https://jira.example.test.evil.example/browse/ENG-42', BASE), false)
  eq(isOwnJiraRoute('https://jira.example.test:8443/browse/ENG-42', BASE), false)
  eq(isOwnJiraRoute('http://jira.example.test/browse/ENG-42', BASE), false)
  // Sin una base que valga no hay «mismo sitio» del que hablar.
  for (const sinBase of ['', null, undefined, 'jira.example.test']) {
    eq(isOwnJiraRoute('/browse/ENG-42', sinBase), false, JSON.stringify(sinBase))
  }
  // Lo que no llega a ser un enlace no es la ruta de nada.
  for (const raro of ['', null, undefined, 'javascript:alert(1)', 'mailto:a@b.test', '#', '#seccion']) {
    eq(isOwnJiraRoute(raro, BASE), false, JSON.stringify(raro))
  }
  // Y un href relativo se resuelve como lo resolvería el navegador, que es lo
  // que cierra una trampa de paso: en una incidencia, un `<a href="200">` es
  // `/browse/200`, o sea Jira, y no «la página 200 de este sitio» —que es como
  // habría podido colarse por `pageRefFromUrl`, según su propia prueba—.
  eq(isOwnJiraRoute('200', BASE), true)
  eq(isOwnJiraRoute('ENG-8', BASE), true)
})

// --------------------------------------------------------------- el cableado

test('SEGURIDAD: lo que el ámbito declara interfaz no se lee, y lo que no se ve tampoco', () => {
  const cuerpo = entre('export function pageLinks(', 'return out')
  assert(cuerpo.includes('const S = scope || digestScope()'), 'el ámbito es el de siempre, o el que le pasen')
  assert(cuerpo.includes("const chrome = String(S.chrome || '')"), 'la interfaz sale del ámbito, no de una lista propia')
  assert(cuerpo.includes('if (chrome && a.closest(chrome)) continue'), 'un enlace de la interfaz no cuenta')
  assert(cuerpo.includes('if (!visible(a)) continue'), 'un enlace que no se ve no cuenta')
  assert(cuerpo.includes("for (const r of S.roots || [])"), 'se recorren los puntos de lectura del ámbito')
  assert(cuerpo.includes("raiz.querySelectorAll('a[href]')"), 'sólo enlaces con href')
  // La interfaz se descarta ANTES de resolver el href: es lo más barato y lo
  // que más hay.
  const iChrome = cuerpo.indexOf('a.closest(chrome)')
  const iHref = cuerpo.indexOf('linkHref(a.getAttribute')
  assert(iChrome >= 0 && iHref > iChrome, 'la interfaz se descarta antes de mirar el href')
  // Y una ruta propia de Jira, antes de medir si se ve: mirar si algo se ve
  // cuesta un `getBoundingClientRect` y un `getComputedStyle` por enlace.
  assert(cuerpo.includes('if (isOwnJiraRoute(href, base)) continue'), 'un enlace a una ruta de Jira no cuenta')
  const iJira = cuerpo.indexOf('isOwnJiraRoute(href, base)')
  const iVisible = cuerpo.indexOf('if (!visible(a)) continue')
  assert(iJira > iHref && iVisible > iJira, 'entre resolver el href y medir si se ve')
  // Y se descarta ANTES del tope, que es de lo que iba el arreglo: si contara,
  // seguiría comiéndose los enlaces de los comentarios.
  assert(iJira < cuerpo.indexOf('out.push('), 'no cuenta para el tope: no llega a entrar')
})

test('el href pasa siempre por linkHref, y la región por ISSUE_LINK_REGIONS', () => {
  assert(/import \{ visible \} from '\.\/tree-dom\.js'/.test(JS), 'la visibilidad se decide en tree-dom.js, no aquí')
  assert(/import \{ ISSUE_LINK_REGIONS \} from '\.\/jira-issue\.js'/.test(JS), 'qué es una incidencia se decide en jira-issue.js')
  assert(/import \{ digestScope \} from '\.\/digest\.js'/.test(JS), 'el ámbito de lectura es el del digest')
  const region = entre('function regionDe(el) {', 'export function pageLinks(')
  assert(region.includes('Object.entries(ISSUE_LINK_REGIONS)'), 'las regiones son las de jira-issue.js')
  assert(region.includes("return 'pagina'"), 'lo que no casa con ninguna región es la página')
  // Ni un selector de incidencia escrito aquí: si Jira mueve su descripción, se
  // toca UN sitio (§8.17).
  assert(!/#description-val|#linkingmodule|#issue_actions_container/.test(JS), 'los selectores de la incidencia viven en jira-issue.js')
})

test('page-links.js sólo LEE: no toca la página ni habla con nadie', () => {
  for (const prohibido of [
    'setAttribute(',
    'removeAttribute(',
    'appendChild(',
    'innerHTML',
    '.remove()',
    '.click()',
    'chrome.',
    'fetch(',
    'addEventListener(',
  ]) {
    assert(!JS.includes(prohibido), `page-links.js no debería usar ${prohibido}`)
  }
  // `location` sólo dentro de la función, nunca al importarse (§9): en el
  // margen izquierdo no puede haber un `const x = location…`.
  assert(!/^(const|let|var)\s+\w+\s*=\s*location/m.test(JS), 'nada de location al importar el módulo')
  assert(JS.includes('const base = location.href'), 'la URL de la pestaña se lee al llamar, no al importar')
})

test('el mismo enlace repetido en la misma región cuenta una vez, y el tope es el del módulo', () => {
  const cuerpo = entre('export function pageLinks(', 'return out')
  assert(cuerpo.includes("const clave = where + '\\n' + href"), 'se deduplica por región y href')
  assert(cuerpo.includes('if (vistos.has(clave)) continue'))
  assert(cuerpo.includes('if (out.length >= tope) break'), 'el tope corta el recorrido, no sólo el resultado')
  assert(cuerpo.includes('LINK_LIMITS.max'), 'sin tope válido, el del módulo')
})
