/**
 * Banco de pruebas visual.
 *
 * Monta una Confluence de mentira —con cabecera pegajosa, árbol lateral y
 * navegación por pushState— y ejecuta encima las piezas REALES de Faro: el
 * overlay, el anclaje de texto, los localizadores y el ejecutor de pasos.
 *
 * El bucle de pasos que hay aquí imita al del service worker a propósito: así
 * lo que se ve en pantalla es el mismo contrato que corre en la extensión.
 */

import { NavRunner, STEP_RESULT } from '../src/content/runner.js'
import { isSafeToClick } from '../src/content/locators.js'
import { treeContainer, rowFor, toggleFor, treeScroller } from '../src/content/tree-dom.js'
import { scrollWithinScrollers } from '../src/content/dom-utils.js'
import { imagesWithin } from '../src/content/anchor.js'
import { Picker } from '../src/content/picker.js'
import { pageDigest } from '../src/content/digest.js'
import { formatDigest, blockHint } from '../src/shared/digest.js'

// --------------------------------------------------------------- contenido

const PAGES = {
  'space:ENG': {
    path: '/wiki/spaces/ENG',
    title: 'Ingeniería',
    crumb: 'Ingeniería',
    body: `
      <p class="meta">Espacio · 214 páginas · actualizado hace 2 días</p>
      <div class="panel">Este espacio recoge las decisiones técnicas, los runbooks de operación y el material de incorporación del equipo.</div>
      <h2>Por dónde empezar</h2>
      <p>Si acabas de llegar, lee primero <code>Onboarding</code>. Si vienes a buscar el porqué de una decisión, todo está bajo <code>Arquitectura</code>, en formato ADR.</p>
      <h2>Cómo se organiza</h2>
      <ul>
        <li><strong>Arquitectura</strong> — decisiones con formato ADR, numeradas.</li>
        <li><strong>Operación</strong> — guardias, alertas y runbooks.</li>
        <li><strong>Onboarding</strong> — accesos y primeros pasos.</li>
      </ul>`,
  },
  'page:100': {
    path: '/wiki/spaces/ENG/pages/100/Arquitectura',
    title: 'Arquitectura',
    crumb: 'Ingeniería / Arquitectura',
    body: `
      <p class="meta">Actualizada por Marco · hace 9 días</p>
      <p>Las decisiones de arquitectura se registran como ADR. Cada una explica el contexto, la decisión y las consecuencias, y no se borra nunca: si deja de valer, se marca como sustituida.</p>
      <h2>Índice de decisiones</h2>
      <ul>
        <li>ADR-013 — Separación de los servicios de identidad</li>
        <li>ADR-014 — Rotación de tokens de servicio</li>
        <li>ADR-015 — Colas de eventos</li>
      </ul>
      <h2>Cómo proponer una nueva</h2>
      <p>Abre un ticket en el proyecto ENG con la etiqueta <code>adr</code> y enlaza el borrador aquí.</p>`,
  },
  'page:200': {
    path: '/wiki/spaces/ENG/pages/200/ADR-014',
    title: 'ADR-014 Rotación de tokens de servicio',
    crumb: 'Ingeniería / Arquitectura / ADR-014',
    body: `
      <p class="meta">Aceptada · 14 de marzo · sustituye a ADR-009</p>
      <h2>Contexto</h2>
      <p>Hasta ahora los tokens de servicio no caducaban. Eso significaba que una credencial filtrada seguía sirviendo indefinidamente, y que no teníamos forma de saber cuántas seguían vivas.</p>
      <p>Se revisaron tres alternativas: mantener los tokens eternos con revocación manual, migrar a certificados de cliente, o introducir caducidad con rotación automática.</p>
      <h2>Decisión</h2>
      <p>Adoptamos la rotación automática. Por política de seguridad el token expira a los 90 días naturales y debe rotarse desde el panel de administración, sin intervención manual del equipo de guardia.</p>
      <p>La rotación se solapa: durante las últimas 48 horas conviven el token viejo y el nuevo, de modo que un despliegue a medias no deja fuera a nadie.</p>
      <h2>Consecuencias</h2>
      <p>Cada servicio necesita releer su credencial sin reiniciar. Los que no puedan hacerlo quedan documentados como excepción en el runbook de guardia.</p>
      <h3>Excepciones conocidas</h3>
      <p>El exportador de métricas heredado sigue con token fijo hasta que se retire, previsto para el próximo trimestre.</p>
      <h2>Seguimiento</h2>
      <p>El cumplimiento se revisa cada trimestre. Los incumplimientos se registran en el proyecto ENG.</p>
      <h2>Ejemplo de configuración</h2>
      <pre class="code"><code><span class="k">apiVersion</span>: networking.k8s.io/v1
<span class="k">kind</span>: <span class="s">Ingress</span>
<span class="k">spec</span>:
  <span class="k">rules</span>:
    - <span class="k">host</span>: <span class="s">app.example.com</span>
      <span class="k">http</span>:
        <span class="k">paths</span>:
          - <span class="k">path</span>: /
            <span class="k">backend</span>:
              <span class="k">service</span>:
                <span class="k">name</span>: <span class="s">app</span>
                <span class="k">port</span>:
                  <span class="k">number</span>: <span class="n">80</span></code></pre>`,
  },
  'page:201': {
    path: '/wiki/spaces/ENG/pages/201/ADR-015',
    title: 'ADR-015 Colas de eventos',
    crumb: 'Ingeniería / Arquitectura / ADR-015',
    body: `<p class="meta">Propuesta · en revisión</p><p>Pendiente de acordar la garantía de orden entre particiones.</p>`,
  },
  'page:300': {
    path: '/wiki/spaces/ENG/pages/300/Operacion',
    title: 'Operación',
    crumb: 'Ingeniería / Operación',
    body: `<p class="meta">Actualizada hace 3 días</p><p>Guardias, alertas y procedimientos de recuperación.</p>`,
  },
  'page:301': {
    path: '/wiki/spaces/ENG/pages/301/Runbook',
    title: 'Runbook de guardia',
    crumb: 'Ingeniería / Operación / Runbook',
    body: `
      <p class="meta">Revisado en la última retrospectiva</p>
      <h2>Excepciones de rotación</h2>
      <p>El exportador de métricas heredado no admite recarga en caliente de credenciales. Hasta su retirada, su token se rota a mano durante la ventana de mantenimiento.</p>`,
  },
  'page:400': {
    path: '/wiki/spaces/ENG/pages/400/Onboarding',
    title: 'Onboarding',
    crumb: 'Ingeniería / Onboarding',
    body: `
      <p class="meta">Empieza por aquí</p>
      <p>Bienvenida. Esta página reúne los accesos que necesitas y el orden en el que conviene pedirlos.</p>
      <h2>Accesos</h2>
      <p>Pide primero el acceso al repositorio y luego el del entorno de pruebas. El acceso a producción va aparte y lo aprueba el responsable del área.</p>`,
  },
  'page:1080': { path: '/wiki/spaces/ENG/pages/1080/Architecture', title: '1080 - Architecture', crumb: 'Ingeniería / Architecture', body: '<p class="meta">Rama de arquitectura</p>' },
  'page:1081': { path: '/wiki/spaces/ENG/pages/1081/D13x', title: '1081 - D1.3.x', crumb: '… / D1.3.x', body: '<p class="meta">Especificación</p>' },
  'page:1082': { path: '/wiki/spaces/ENG/pages/1082/AppArch', title: 'Simpl-Open Application Architecture', crumb: '… / Application Architecture', body: '<p class="meta">Arquitectura de aplicación</p>' },
  'page:1083': { path: '/wiki/spaces/ENG/pages/1083/Components', title: 'Application Components Views', crumb: '… / Components Views', body: '<p class="meta">Vistas de componentes</p>' },
  'page:1084': { path: '/wiki/spaces/ENG/pages/1084/ACVDomain1', title: 'ACV - Domain 1 - Access Control & Trust', crumb: '… / ACV Domain 1', body: '<p class="meta">Dominio 1</p>' },
  'page:1085': { path: '/wiki/spaces/ENG/pages/1085/StaticViews', title: 'ACV - Domain 1 - Static Views', crumb: '… / Static Views', body: '<p class="meta">Vistas estáticas</p>' },
  // Las dos ramas hermanas del caso real: la ACV donde estás y la TCV a la que
  // hay que llegar. Cuelgan las dos de 1081, por caminos distintos.
  'page:2001': { path: '/wiki/spaces/ENG/pages/2001/AppArch', title: 'Simpl-Open Application Architecture', crumb: '… / Application Architecture', body: '<p class="meta">Arquitectura de aplicación</p>' },
  'page:2002': { path: '/wiki/spaces/ENG/pages/2002/ACVStatic', title: 'ACV - Domain 1 - Static Views', crumb: '… / ACV Static Views', body: '<p class="meta">Vistas estáticas ACV</p>' },
  'page:2003': {
    path: '/wiki/spaces/ENG/pages/2003/ACV+Static+-+Identity+Provider+Service',
    title: 'ACV Static - Identity Provider Service',
    crumb: '… / ACV Static - Identity Provider Service',
    body: `
      <p class="meta">Creado por Nicolas Auricchio</p>
      <h2>Identity Provider</h2>
      <p>Este componente se despliega dentro del Governance Authority Agent y genera y renueva credenciales para los participantes recién incorporados.</p>
      <figure>
        <img alt="Diagrama de despliegue del Identity Provider" width="320" height="180"
             src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23E9F2FF'/%3E%3Ctext x='20' y='96' font-size='16' fill='%230C66E4'%3EIdentity Provider%3C/text%3E%3C/svg%3E">
        <figcaption>Figura 3 — despliegue dentro del Governance Authority Agent.</figcaption>
      </figure>`,
  },
  'page:3001': { path: '/wiki/spaces/ENG/pages/3001/TechArch', title: 'Simpl-Open Technology Architecture', crumb: '… / Technology Architecture', body: '<p class="meta">Arquitectura tecnológica</p>' },
  'page:3002': { path: '/wiki/spaces/ENG/pages/3002/TCVStatic', title: 'TCV - Domain 1 - Static Views', crumb: '… / TCV Static Views', body: '<p class="meta">Vistas estáticas TCV</p>' },
  'page:3003': {
    path: '/wiki/spaces/ENG/pages/3003/TCV+Static+-+Identity+Provider+Service',
    title: 'TCV Static - Identity Provider Service',
    crumb: '… / TCV Static - Identity Provider Service',
    body: `
      <p class="meta">Implementación técnica</p>
      <h2>Identity Provider Service</h2>
      <p>Backends en Java, interfaz en Angular, EJBCA para la autoridad de certificación y PostgreSQL para la persistencia.</p>`,
  },
  'page:1086': {
    path: '/wiki/spaces/ENG/pages/1086/ACV+Static+-+Identity+Provider+Service',
    title: 'ACV Static - Identity Provider Service',
    crumb: '… / ACV Static - Identity Provider Service',
    body: `
      <p class="meta">Creado por Nicolas Auricchio</p>
      <h2>Identity Provider</h2>
      <p>Este componente se despliega dentro del Governance Authority Agent y genera y renueva credenciales para los participantes recién incorporados.</p>`,
  },
}

const content = document.getElementById('page-content')
const crumbs = document.getElementById('crumbs')
const log = document.getElementById('rig-log')

function renderPage(key, { push = true } = {}) {
  const page = PAGES[key]
  if (!page) return
  content.innerHTML = `<article class="doc"><h1>${page.title}</h1>${page.body}</article>`
  crumbs.textContent = page.crumb
  // Como el Confluence real: la pagina en la que estas se pinta en negrita y
  // SIN enlace. Es justo el caso que hacia decir «no encuentro este paso».
  document.querySelectorAll('.sidebar a, .sidebar span[data-nav]').forEach((el) => {
    const esActual = el.dataset.nav === key
    el.classList.toggle('current', esActual)
    if (esActual && el.tagName === 'A') {
      const span = document.createElement('span')
      span.dataset.nav = el.dataset.nav
      span.dataset.href = el.getAttribute('href')
      span.className = el.className
      span.textContent = el.textContent
      el.replaceWith(span)
    } else if (!esActual && el.tagName === 'SPAN') {
      const a = document.createElement('a')
      a.dataset.nav = el.dataset.nav
      a.setAttribute('href', el.dataset.href)
      a.className = el.className
      a.textContent = el.textContent
      el.replaceWith(a)
    }
  })
  if (push && location.pathname !== page.path) history.pushState({ key }, '', page.path)
  document.title = page.title + ' · Confluence'
}

function keyForPath(path) {
  return Object.keys(PAGES).find((k) => PAGES[k].path === path)
}

// Navegación estilo SPA: cambia la URL sin recargar, como hace Confluence.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-nav]')
  if (!a) return
  ev.preventDefault()
  // Un retardo deliberado: la extensión tiene que esperar a que la vista monte.
  setTimeout(() => renderPage(a.dataset.nav), 140)
})

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('.twisty')
  if (!t) return
  const item = t.closest('.tree-item, .cloud-row')
  const kids = item?.querySelector('.children, .cloud-kids')
  if (!kids) return
  const open = !kids.classList.contains('collapsed')
  kids.classList.toggle('collapsed', open)
  t.setAttribute('aria-expanded', String(!open))
  t.textContent = open ? '▸' : '▾'
})

// ------------------------------------------------- la barra lateral «Cloud»
//
// La clásica de arriba tiene role=tree y role=treeitem, que es lo cómodo. El
// Confluence real no: el contenedor se reconoce por data-testid, las filas son
// divs sin rol, y sólo el chevron lleva aria-expanded. Tener las dos y poder
// cambiar entre ellas es lo que demuestra que el adaptador vale para ambas.

const CLOUD_TREE = [
  {
    id: '1080',
    title: '1080 - Architecture',
    kids: [
      {
        id: '1081',
        title: '1081 - D1.3.x - Simpl-Open functional and technical architecture specification',
        kids: [
          {
            id: '2001',
            title: 'Simpl-Open Application Architecture',
            kids: [
              {
                id: '2002',
                title: 'ACV - Domain 1 - Access Control & Trust - Static Views',
                kids: [{ id: '2003', title: 'ACV Static - Identity Provider Service' }],
              },
            ],
          },
          {
            id: '3001',
            title: 'Simpl-Open Technology Architecture',
            kids: [
              {
                id: '3002',
                title: 'TCV - Domain 1 - Access Control & Trust - Static Views',
                kids: [{ id: '3003', title: 'TCV Static - Identity Provider Service' }],
              },
            ],
          },
        ],
      },
    ],
  },
  { id: '400', title: 'Onboarding' },
]

function cloudRow(nodo) {
  const fila = document.createElement('div')
  fila.className = 'cloud-row'

  if (nodo.kids?.length) {
    const btn = document.createElement('button')
    btn.className = 'twisty'
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-label', 'Expandir ' + nodo.title)
    btn.textContent = '▸'
    fila.appendChild(btn)
  } else {
    const hueco = document.createElement('span')
    hueco.className = 'twisty-space'
    fila.appendChild(hueco)
  }

  const a = document.createElement('a')
  a.setAttribute('href', PAGES['page:' + nodo.id].path)
  a.dataset.nav = 'page:' + nodo.id
  a.textContent = nodo.title
  fila.appendChild(a)

  if (nodo.kids?.length) {
    const kids = document.createElement('div')
    kids.className = 'cloud-kids collapsed'
    for (const hijo of nodo.kids) kids.appendChild(cloudRow(hijo))
    fila.appendChild(kids)
  }

  return fila
}

function buildCloudSidebar() {
  const aside = document.createElement('aside')
  aside.className = 'sidebar cloud'
  aside.setAttribute('data-testid', 'side-navigation')

  const head = document.createElement('div')
  head.className = 'space-head'
  const avatar = document.createElement('span')
  avatar.className = 'space-avatar'
  avatar.textContent = 'EN'
  const enlace = document.createElement('a')
  enlace.setAttribute('href', '/wiki/spaces/ENG')
  enlace.dataset.nav = 'space:ENG'
  enlace.textContent = 'Ingeniería'
  head.append(avatar, enlace)
  aside.appendChild(head)

  const tree = document.createElement('div')
  tree.setAttribute('data-vc', 'page-tree')
  for (const nodo of CLOUD_TREE) tree.appendChild(cloudRow(nodo))

  // Relleno para que la barra tenga scroll propio de verdad: sin él no se puede
  // comprobar que el recorrido la desplaza.
  for (let i = 1; i <= 22; i++) {
    const fila = document.createElement('div')
    fila.className = 'cloud-row'
    const hueco = document.createElement('span')
    hueco.className = 'twisty-space'
    const a = document.createElement('a')
    a.setAttribute('href', '/wiki/spaces/ENG/pages/9' + String(i).padStart(3, '0') + '/Relleno')
    a.textContent = 'Otra página del espacio ' + i
    fila.append(hueco, a)
    tree.appendChild(fila)
  }

  aside.appendChild(tree)
  return aside
}

let sidebarActual = 'clasica'
const SIDEBAR_CLASICA = document.querySelector('.sidebar')

function setSidebar(cual) {
  if (cual === sidebarActual) return
  const viva = document.querySelector('.sidebar')
  viva.replaceWith(cual === 'cloud' ? buildCloudSidebar() : SIDEBAR_CLASICA)
  sidebarActual = cual
  renderPage(keyForPath(location.pathname) || 'page:400', { push: false })
}

window.addEventListener('popstate', () => {
  const key = keyForPath(location.pathname)
  if (key) renderPage(key, { push: false })
})

renderPage(keyForPath(location.pathname) || 'page:400', { push: false })

// ------------------------------------------------------------------ el rig

const runner = new NavRunner({ timing: { stepPauseMs: 1100, locateTimeoutMs: 2500 } })
const picker = new Picker(runner.overlay)

// En la extensión esto lo conecta el content script para avisar al panel; aquí
// sirve para ver que pulsar el número hace algo.
runner.overlay.onNote = (n) => say('han pulsado la marca ' + n, 'ok')

/**
 * Tres observaciones sobre el ADR-014, como las que dejaría el modo Análisis, y
 * una cuarta que no existe en la página: esa tiene que quedarse sin marcar en
 * vez de caer en cualquier sitio.
 */
const OBSERVACIONES = [
  {
    n: 1,
    title: 'La caducidad no se justifica',
    kind: 'supuesto',
    anchor: {
      kind: 'text-quote',
      exact: 'el token expira a los 90 días naturales',
      prefix: 'Por política de seguridad ',
      suffix: ' y debe rotarse',
    },
  },
  {
    n: 2,
    title: 'Ventana de solape sin medir',
    kind: 'hueco',
    anchor: {
      kind: 'text-quote',
      exact: 'durante las últimas 48 horas conviven el token viejo y el nuevo',
    },
  },
  {
    n: 3,
    title: 'Excepción sin fecha firme',
    kind: 'riesgo',
    anchor: {
      kind: 'text-quote',
      exact: 'El exportador de métricas heredado sigue con token fijo',
    },
  },
  {
    n: 4,
    title: 'Esta no está en la página',
    kind: 'dato',
    anchor: { kind: 'text-quote', exact: 'la rotación la aprueba el comité de los martes' },
  },
]

function say(text, kind = '') {
  const tag = kind === 'ok' ? 'b' : kind === 'bad' ? 'i' : 'span'
  log.insertAdjacentHTML('afterbegin', `<${tag}>${new Date().toLocaleTimeString()} ${text}</${tag}>\n`)
}

const ORIGIN = location.origin

const STEPS_FULL = [
  { kind: 'confluence-space', id: 'ENG', title: 'Ingeniería', label: 'Espacio Ingeniería', path: '/wiki/spaces/ENG', url: ORIGIN + '/wiki/spaces/ENG' },
  { kind: 'confluence-page', id: '100', title: 'Arquitectura', label: 'Arquitectura', path: '/wiki/spaces/ENG/pages/100/Arquitectura', url: ORIGIN + '/wiki/spaces/ENG/pages/100/Arquitectura' },
  { kind: 'confluence-page', id: '200', title: 'ADR-014', label: 'ADR-014 Rotación de tokens', path: '/wiki/spaces/ENG/pages/200/ADR-014', url: ORIGIN + '/wiki/spaces/ENG/pages/200/ADR-014' },
]

const STEPS_COLLAPSED = [
  { kind: 'confluence-page', id: '300', title: 'Operación', label: 'Operación', url: ORIGIN + '/wiki/spaces/ENG/pages/300/Operacion' },
  { kind: 'confluence-page', id: '301', title: 'Runbook de guardia', label: 'Runbook de guardia', url: ORIGIN + '/wiki/spaces/ENG/pages/301/Runbook' },
]

/**
 * El caso de la captura: estando en la ACV, llegar a su TCV hermana.
 *
 * Los dos cuelgan de 1081 por ramas distintas, así que el recorrido baja hasta
 * la raíz común y vuelve a subir por la otra rama. Es lo que `treeSteps()`
 * calcula a partir del índice, y lo que el modelo NO puede improvisar.
 */
const CADENA_TCV = ['1080', '1081', '3001', '3002', '3003']
const PASOS_ACV_TCV = CADENA_TCV.map((id, i) => ({
  kind: 'confluence-page',
  id,
  title: PAGES['page:' + id].title,
  label: PAGES['page:' + id].title,
  path: PAGES['page:' + id].path,
  url: ORIGIN + PAGES['page:' + id].path,
  action: i === CADENA_TCV.length - 1 ? 'open' : 'expand',
}))

const ANCHOR_QUOTE = {
  kind: 'text-quote',
  exact: 'el token expira a los 90 días naturales',
  prefix: 'Por política de seguridad ',
  suffix: ' y debe rotarse',
}

const ANCHOR_EDITED = {
  kind: 'text-quote',
  // Cómo se indexó la frase en su día. Desde entonces alguien la reeditó: en la
  // página pone «el token expira…», sin «de servicio», y con acento en «días».
  // Esta es la cita que sólo salva la coincidencia aproximada.
  exact: 'el token de servicio expira a los 90 dias naturales',
}

const ANCHOR_HEADING = { kind: 'heading', headingText: 'Excepciones conocidas' }

/** Una cita que cae dentro del bloque de código y ocupa varias líneas. */
const ANCHOR_CODIGO = {
  kind: 'text-quote',
  exact: 'rules:\n    - host: app.example.com\n      http:\n        paths:',
}

const ANCHOR_MISSING = {
  kind: 'text-quote',
  exact: 'la rotación se hace cada catorce lunas mediante un ritual documentado aparte',
}

/**
 * Cinco observaciones como las que deja hoy el modo Análisis: apuntan a un
 * bloque numerado de la página y, si acaso, a una cita dentro de él. Se
 * construyen sobre la página en bloques leída del DOM, como hace el panel: la
 * pista de cada bloque sale del texto que se le enseñó al modelo, nunca del
 * modelo. Cubren la escalera entera:
 *   1. bloque + cita literal;
 *   2. bloque sin cita: se marca entero;
 *   3. número equivocado pero texto correcto: el texto manda;
 *   4. bloque que no existe: la cita se busca en toda la página;
 *   5. ni bloque ni cita: sin marcar.
 */
function observacionesPorBloques(digest) {
  const bloque = (inicio) => digest.blocks.find((b) => b.text.startsWith(inicio))
  const decision = bloque('Adoptamos la rotación')
  const solape = bloque('La rotación se solapa')
  const excepcion = bloque('El exportador de métricas')
  const ancla = (b, exact, desvio = 0) => ({ kind: 'block-quote', block: b.id + desvio, hint: blockHint(b.text), exact })
  return [
    { n: 1, title: 'La caducidad no se justifica', kind: 'supuesto', anchor: ancla(decision, 'el token expira a los 90 días naturales') },
    { n: 2, title: 'Ventana de solape sin medir', kind: 'hueco', anchor: ancla(solape, '') },
    { n: 3, title: 'Excepción sin fecha firme', kind: 'riesgo', anchor: ancla(excepcion, 'El exportador de métricas heredado sigue con token fijo', 1) },
    {
      n: 4,
      title: 'Recarga en caliente',
      kind: 'dato',
      anchor: { kind: 'block-quote', block: 999, hint: 'un bloque que no existe', exact: 'Cada servicio necesita releer su credencial sin reiniciar' },
    },
    {
      n: 5,
      title: 'Comité de los martes',
      kind: 'dato',
      anchor: { kind: 'block-quote', block: 999, hint: 'tampoco existe', exact: 'la rotación la aprueba el comité de los martes' },
    },
  ]
}

/** Imita el bucle del service worker: un paso por vuelta. */
async function driveSteps(steps, anchor) {
  for (let i = 0; i < steps.length; i++) {
    const res = await runner.executeStep({
      step: steps[i],
      index: i,
      total: steps.length,
      isLast: i === steps.length - 1,
    })
    say(`paso ${i + 1}/${steps.length} → ${res.status}${res.reason ? ' (' + res.reason + ')' : ''}`,
      res.status === STEP_RESULT.CANCELLED ? 'bad' : 'ok')

    if (res.status === STEP_RESULT.CANCELLED) return
    if (res.status === STEP_RESULT.NAVIGATE) {
      const key = keyForPath(new URL(steps[i].url).pathname)
      if (key) renderPage(key)
      await new Promise((r) => setTimeout(r, 400))
    }
    await new Promise((r) => setTimeout(r, 260))
  }

  if (anchor) {
    const res = await runner.applyAnchor({ anchor, explanation: 'Es el apartado de Decisión.', title: 'ADR-014' })
    say(`anclaje → ${res.anchored ? res.strategy : 'no encontrado'}`, res.anchored ? 'ok' : 'bad')
  }
}

const actions = {
  async quote() {
    renderPage('page:200')
    await new Promise((r) => setTimeout(r, 200))
    const res = await runner.applyAnchor({ anchor: ANCHOR_QUOTE, explanation: 'Aquí está la política de caducidad.' })
    say(`cita → ${res.anchored ? res.strategy : 'no encontrada'}`, res.anchored ? 'ok' : 'bad')
  },

  async 'quote-edited'() {
    renderPage('page:200')
    await new Promise((r) => setTimeout(r, 200))
    const res = await runner.applyAnchor({ anchor: ANCHOR_EDITED })
    say(`cita editada → ${res.anchored ? res.strategy : 'no encontrada'}`, res.anchored ? 'ok' : 'bad')
  },

  async heading() {
    renderPage('page:200')
    await new Promise((r) => setTimeout(r, 200))
    const res = await runner.applyAnchor({ anchor: ANCHOR_HEADING })
    say(`encabezado → ${res.anchored ? res.strategy : 'no encontrado'}`, res.anchored ? 'ok' : 'bad')
  },

  async missing() {
    renderPage('page:200')
    await new Promise((r) => setTimeout(r, 200))
    const res = await runner.applyAnchor({ anchor: ANCHOR_MISSING })
    say(`cita ausente → ${res.anchored ? 'ERROR: no debería encontrarla' : 'se rinde bien'}`,
      res.anchored ? 'bad' : 'ok')
  },

  async assisted() {
    renderPage('page:400')
    await new Promise((r) => setTimeout(r, 250))
    await driveSteps(STEPS_FULL, ANCHOR_QUOTE)
  },

  async 'assisted-collapsed'() {
    renderPage('page:400')
    await new Promise((r) => setTimeout(r, 250))
    await driveSteps(STEPS_COLLAPSED, { kind: 'heading', headingText: 'Excepciones de rotación' })
  },

  sidebar() {
    setSidebar(sidebarActual === 'cloud' ? 'clasica' : 'cloud')
    say('barra lateral: ' + sidebarActual)
  },

  async 'acv-tcv'() {
    setSidebar('clasica')
    setSidebar('cloud')
    renderPage('page:2003')
    await wait(320)
    await driveSteps(PASOS_ACV_TCV, { kind: 'heading', headingText: 'Identity Provider Service' })
  },

  async marker() {
    renderPage('page:2003')
    await wait(250)
    runner.clear()
    const nuevo = runner.overlay.style === 'marker' ? 'spotlight' : 'marker'
    runner.setHighlightStyle(nuevo)
    say('resaltado: ' + nuevo)
    await runner.applyAnchor({
      anchor: { kind: 'text-quote', exact: 'genera y renueva credenciales' },
      explanation: 'Así se ve este estilo.',
    })
    runner.overlay.outlineElements(imagesWithin(document.querySelector('#page-content figure')))
  },

  async picker() {
    if (location.pathname.indexOf('/pages/2003') === -1) {
      renderPage('page:2003')
      await wait(300)
    }
    say('modo selección: subraya un párrafo o pulsa el diagrama')
    const pick = await picker.start()
    if (!pick) return say('cancelado')
    say(
      pick.kind === 'image'
        ? `imagen → «${pick.alt || pick.caption}» ${pick.image ? pick.image.width + '×' + pick.image.height : 'sin adjuntar'}`
        : `texto → «${pick.text.slice(0, 60)}» bajo «${pick.heading}»`,
      'ok'
    )
  },

  async code() {
    renderPage('page:200')
    await wait(320)
    runner.clear()
    const r = await runner.applyAnchor({ anchor: ANCHOR_CODIGO, explanation: 'El bloque de ejemplo.' })
    say(`código → ${r.anchored ? r.strategy : 'no encontrado'}`, r.anchored ? 'ok' : 'bad')
  },

  async notes() {
    renderPage('page:200')
    await wait(320)
    runner.clear()
    const r = await runner.applyNotes({ notes: OBSERVACIONES })
    say(`marcadas ${r.placed.join(', ') || 'ninguna'}${r.missed.length ? ' · sin anclar ' + r.missed.join(', ') : ''}`, 'ok')
    say('pulsa un número, o usa faroHarness.runner.focusNote({ n: 2 })')
  },

  async digest() {
    renderPage('page:200')
    await wait(320)
    const d = pageDigest()
    const lineas = formatDigest(d.blocks).split('\n')
    say(`${d.blocks.length} bloques · ${d.chars} caracteres${d.truncated ? ' · recortada' : ''}`, 'ok')
    for (const l of lineas.slice(0, 6)) say(l.length > 110 ? l.slice(0, 107) + '…' : l)
    if (lineas.length > 6) say(`… y ${lineas.length - 6} bloques más (faroHarness.pageDigest() para verlos todos)`)
  },

  async 'notes-blocks'() {
    renderPage('page:200')
    await wait(320)
    runner.clear()
    const r = await runner.applyNotes({ notes: observacionesPorBloques(pageDigest()) })
    say(
      `marcadas ${r.placed.join(', ') || 'ninguna'}${r.missed.length ? ' · sin anclar ' + r.missed.join(', ') : ''}`,
      'ok'
    )
    for (const d of r.detail || []) say(`  ${d.n} → ${d.strategy}${d.approximate ? ' (aproximada)' : ''}`)
  },

  unsafe() {
    const del = [...document.querySelectorAll('.tb-btn')].find((b) => /elimin/i.test(b.textContent))
    const r = isSafeToClick(del, ORIGIN)
    say(`«Eliminar» → ${r.ok ? 'ERROR: lo habría pulsado' : 'rechazado: ' + r.reason}`, r.ok ? 'bad' : 'ok')

    const link = document.querySelector('a[data-nav="page:200"]')
    const r2 = isSafeToClick(link, ORIGIN)
    say(`enlace del árbol → ${r2.ok ? 'permitido (' + r2.kind + ')' : 'ERROR: ' + r2.reason}`, r2.ok ? 'ok' : 'bad')
  },

  clear() {
    runner.clear()
    say('limpio')
  },

  /**
   * Recorre todos los casos y dice si pasan. Es la comprobación que no se
   * puede hacer desde Node: necesita DOM, layout y la Custom Highlight API.
   */
  async selfcheck() {
    log.textContent = ''
    const results = []
    const ok = (name, pass, detail) => {
      results.push({ name, pass, detail })
      say(`${pass ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`, pass ? 'ok' : 'bad')
    }
    const highlighted = () => {
      const h = CSS.highlights.get('faro-quote')
      return h ? [...h].map((r) => r.toString()) : []
    }

    // 1. Cita exacta
    renderPage('page:200')
    await wait(300)
    runner.clear()
    let r = await runner.applyAnchor({ anchor: ANCHOR_QUOTE })
    await wait(700)
    ok('cita exacta', r.anchored && highlighted()[0] === ANCHOR_QUOTE.exact, r.strategy)

    // 2. El contenido no se toca
    const content = document.getElementById('page-content')
    const before = content.innerHTML
    let mutations = 0
    const obs = new MutationObserver((m) => (mutations += m.length))
    obs.observe(content, { childList: true, subtree: true, attributes: true, characterData: true })
    runner.clear()
    await runner.applyAnchor({ anchor: ANCHOR_QUOTE })
    await wait(700)
    obs.disconnect()
    ok('el DOM del contenido queda intacto', content.innerHTML === before && mutations === 0, `${mutations} mutaciones`)

    // 3. Cita reeditada -> aproximada
    runner.clear()
    r = await runner.applyAnchor({ anchor: ANCHOR_EDITED })
    await wait(700)
    ok('cita reeditada localizada por aproximación', r.anchored && r.strategy === 'fuzzy', r.strategy)

    // 4. Encabezado
    runner.clear()
    r = await runner.applyAnchor({ anchor: ANCHOR_HEADING })
    await wait(600)
    ok('encabezado', r.anchored && highlighted()[0] === 'Excepciones conocidas', r.strategy)

    // 5. Cita que ya no existe -> se rinde bien
    runner.clear()
    r = await runner.applyAnchor({ anchor: ANCHOR_MISSING })
    await wait(600)
    ok('cita inexistente: se rinde en vez de marcar cualquier cosa', !r.anchored && highlighted().length === 0)

    // 6. Desplazamiento por debajo de la cabecera pegajosa
    runner.clear()
    window.scrollTo(0, 0)
    await wait(200)
    await runner.applyAnchor({ anchor: ANCHOR_QUOTE })
    await wait(900)
    const quoteEl = [...document.querySelectorAll('#page-content p')].find((p) =>
      p.textContent.includes('90 días naturales')
    )
    const top = quoteEl?.getBoundingClientRect().top ?? 0
    const headerBottom = document.querySelector('.topbar').getBoundingClientRect().bottom
    ok('el fragmento no queda debajo de la cabecera', top > headerBottom, `top ${Math.round(top)} > ${Math.round(headerBottom)}`)

    // 7. Asistida de tres pasos
    runner.clear()
    renderPage('page:400')
    await wait(300)
    const trail = []
    for (let i = 0; i < STEPS_FULL.length; i++) {
      const res = await runner.executeStep({ step: STEPS_FULL[i], index: i, total: STEPS_FULL.length, isLast: i === 2 })
      await wait(400)
      trail.push(location.pathname)
      if (res.status === STEP_RESULT.CANCELLED) break
    }
    ok(
      'asistida: pasa por espacio, sección y página',
      trail[0] === '/wiki/spaces/ENG' &&
        trail[1] === '/wiki/spaces/ENG/pages/100/Arquitectura' &&
        trail[2] === '/wiki/spaces/ENG/pages/200/ADR-014',
      trail.join(' → ')
    )

    // 8. Rama plegada: se vuelve a plegar a mano para poder repetir la prueba
    //    sin recargar la página.
    document.querySelectorAll('.children').forEach((c) => {
      if (c.querySelector('a[href*="/pages/301"]')) c.classList.add('collapsed')
    })
    document.querySelectorAll('.twisty').forEach((t) => {
      if (t.closest('.tree-item')?.querySelector('a[href*="/pages/301"]')) {
        t.setAttribute('aria-expanded', 'false')
        t.textContent = '▸'
      }
    })
    renderPage('page:400')
    await wait(300)
    const resCol = await runner.executeStep({ step: STEPS_COLLAPSED[1], index: 0, total: 1, isLast: true })
    await wait(600)
    ok('rama plegada: la despliega y entra', location.pathname.includes('/pages/301'), resCol.status)

    // 9. Lista blanca de clics
    const del = [...document.querySelectorAll('.tb-btn')].find((b) => /elimin/i.test(b.textContent))
    const link = document.querySelector('a[data-nav="page:200"]')
    ok(
      'nunca pulsa acciones, sí enlaces de navegación',
      !isSafeToClick(del, ORIGIN).ok && isSafeToClick(link, ORIGIN).ok
    )

    // 10. Aislamiento del overlay
    const host = document.getElementById('faro-overlay-host')
    ok(
      'overlay aislado: shadow cerrado y colgado de <html>',
      !!host && host.shadowRoot === null && host.parentElement === document.documentElement
    )

    // 11. Ya estamos en el destino: el paso debe darse por hecho, no fallar.
    //     El id que se pasa esta MAL a proposito; solo la ruta lo salva.
    renderPage('page:200')
    await wait(300)
    const yaAqui = await runner.executeStep({
      step: {
        kind: 'confluence-page',
        id: '99999999',
        title: 'ADR-014',
        label: 'Su ADR correspondiente: ADR-014 (vista completa)',
        path: '/wiki/spaces/ENG/pages/200/ADR-014',
        url: ORIGIN + '/wiki/spaces/ENG/pages/200/ADR-014',
      },
      index: 1,
      total: 2,
      isLast: true,
    })
    ok(
      'estando ya en el destino, el paso se da por hecho',
      yaAqui.status === STEP_RESULT.CLICKED,
      yaAqui.status + (yaAqui.note ? ' · ' + yaAqui.note : '')
    )

    // 12. El arbol no enlaza la pagina actual: no debe romper nada.
    ok(
      'la pagina actual del arbol no es un enlace (como en Confluence)',
      !document.querySelector('.sidebar a[data-nav="page:200"]') &&
        !!document.querySelector('.sidebar span[data-nav="page:200"]')
    )

    // 13. Arbol profundo y plegado, como el Confluence real del usuario: la
    //     pagina esta a SEIS niveles y ninguno esta abierto.
    renderPage('page:400')
    await wait(300)
    document.querySelectorAll('.children').forEach((c) => {
      if (c.querySelector('a[data-nav^="page:108"]')) c.classList.add('collapsed')
    })
    document.querySelectorAll('.twisty').forEach((t) => {
      const item = t.closest('.tree-item')
      if (item?.querySelector('a[data-nav^="page:108"]')) {
        t.setAttribute('aria-expanded', 'false')
        t.textContent = '▸'
      }
    })
    const nivelesPlegadosAntes = [...document.querySelectorAll('.children.collapsed')].filter((c) =>
      c.querySelector('a[data-nav^="page:108"]')
    ).length

    const t0 = Date.now()
    const profundo = await runner.executeStep({
      step: {
        kind: 'confluence-page',
        id: '1086',
        title: 'ACV Static - Identity Provider Service',
        label: 'Su ACV correspondiente: ACV Static - Identity Provider Service (vista de componentes)',
        path: '/wiki/spaces/ENG/pages/1086/ACV+Static+-+Identity+Provider+Service',
        url: ORIGIN + '/wiki/spaces/ENG/pages/1086/ACV+Static+-+Identity+Provider+Service',
      },
      index: 1,
      total: 2,
      isLast: true,
    })
    await wait(500)
    ok(
      'arbol de seis niveles plegado: lo despliega y llega',
      profundo.status === STEP_RESULT.CLICKED && location.pathname.includes('/pages/1086'),
      `${profundo.status} · ${nivelesPlegadosAntes} niveles plegados · ${Date.now() - t0}ms · ${location.pathname}`
    )

    // 14b. Como el Confluence real: el aria-expanded en la propia fila, sin
    //      chevron aparte. Era lo que hacia que no se desplegara solo.
    renderPage('page:400')
    await wait(250)
    const filaSuelta = document.querySelector('.tree-item:has(a[data-nav="page:1080"])')
    if (filaSuelta) {
      const chevron = filaSuelta.querySelector('.twisty')
      filaSuelta.setAttribute('aria-expanded', 'false')
      if (chevron) chevron.removeAttribute('aria-expanded')
      filaSuelta.querySelector('.children')?.classList.add('collapsed')
      filaSuelta.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return
        filaSuelta.setAttribute('aria-expanded', 'true')
        filaSuelta.querySelector('.children')?.classList.remove('collapsed')
      })
      const mod = await import('/src/content/locators.js')
      const enlace = filaSuelta.querySelector('a[data-nav="page:1080"]')
      const t = mod.treeToggleFor(enlace)
      ok('aria-expanded en la fila: se detecta igual', !!t && t.isRow === true, t ? `isRow=${t.isRow}` : 'no lo encuentra')

      // Y tambien: un aria-expanded que dice «true» con las hijas ocultas es
      // mentira, y hay que tratarlo como cerrado.
      filaSuelta.setAttribute('aria-expanded', 'true')
      filaSuelta.querySelector('.children')?.classList.add('collapsed')
      const mentira = mod.treeToggleFor(enlace)
      ok(
        'un aria-expanded que miente se trata como cerrado',
        !!mentira && mentira.declared === true && mentira.expanded === false,
        mentira ? `declared=${mentira.declared} expanded=${mentira.expanded}` : 'no lo encuentra'
      )

      // Se deshace todo: una comprobacion no puede dejar la pagina tocada, o
      // las siguientes se vuelven locas.
      filaSuelta.removeAttribute('aria-expanded')
      if (chevron) chevron.setAttribute('aria-expanded', 'false')
      filaSuelta.replaceWith(filaSuelta.cloneNode(true))
    }

    // 14. Guiar POR EL ARBOL: desplegar las ramas y navegar una sola vez.
    renderPage('page:400')
    await wait(300)
    document.querySelectorAll('.children').forEach((c) => {
      if (c.querySelector('a[data-nav^="page:108"]')) c.classList.add('collapsed')
    })
    document.querySelectorAll('.twisty').forEach((t) => {
      const item = t.closest('.tree-item')
      if (item?.querySelector('a[data-nav^="page:108"]')) {
        t.setAttribute('aria-expanded', 'false')
        t.textContent = '▸'
      }
    })

    const cadena = ['1080', '1081', '1082', '1083', '1084', '1085', '1086']
    const pasos = cadena.map((id, i) => ({
      kind: 'confluence-page',
      id,
      title: PAGES['page:' + id].title,
      label: PAGES['page:' + id].title,
      path: PAGES['page:' + id].path,
      url: ORIGIN + PAGES['page:' + id].path,
      action: i === cadena.length - 1 ? 'open' : 'expand',
    }))

    const rutas = []
    const estados = []
    for (let i = 0; i < pasos.length; i++) {
      const r = await runner.executeStep({ step: pasos[i], index: i, total: pasos.length, isLast: i === pasos.length - 1 })
      estados.push(r.status)
      rutas.push(location.pathname)
      await wait(320)
      if (r.status === STEP_RESULT.CANCELLED) break
    }
    const navegaciones = new Set(rutas).size
    ok(
      'guia por el arbol: despliega y navega UNA sola vez',
      estados.slice(0, -1).every((e) => e === STEP_RESULT.EXPANDED) &&
        estados[estados.length - 1] === STEP_RESULT.CLICKED &&
        location.pathname.includes('/pages/1086'),
      `${estados.join(',')} · ${navegaciones} rutas distintas · ${location.pathname}`
    )

    // 15. Leer la estructura del arbol del propio DOM.
    document.querySelectorAll('.children.collapsed').forEach((c) => c.classList.remove('collapsed'))
    const { snapshotTree } = await import('/src/content/tree-scan.js')
    const snap = snapshotTree()
    const hijo = snap.pages.find((p) => p.id === '1086')
    const nieto = snap.pages.find((p) => p.id === '1084')
    ok(
      'lee del DOM quien cuelga de quien',
      !!hijo && hijo.parentId === '1085' && !!nieto && nieto.parentId === '1083',
      `${snap.scanned} filas · 1086→${hijo?.parentId} · 1084→${nieto?.parentId}`
    )

    // 16. La barra lateral con la forma del Confluence real: sin role=tree, sin
    //     role=treeitem, y el contenedor reconocible sólo por data-testid. Era
    //     exactamente donde la navegación guiada se quedaba ciega.
    setSidebar('clasica')
    setSidebar('cloud')
    renderPage('page:400')
    await wait(320)

    const contenedor = treeContainer()
    const enlace1080 = document.querySelector('.sidebar a[data-nav="page:1080"]')
    const fila1080 = rowFor(enlace1080, contenedor)
    const chevron = toggleFor(fila1080)
    ok(
      'arbol estilo Cloud: encuentra contenedor, fila y control de desplegar',
      contenedor?.getAttribute('data-testid') === 'side-navigation' &&
        !!fila1080 &&
        fila1080.classList.contains('cloud-row') &&
        !!chevron &&
        chevron.toggle.getAttribute('aria-expanded') === 'false',
      `contenedor=${contenedor?.getAttribute('data-testid')} fila=${fila1080?.className} control=${!!chevron}`
    )

    // 17. EL CASO DE LA CAPTURA: estando en la ACV, llegar a su TCV hermana.
    //     Cinco ramas que desplegar, ninguna carga de pagina hasta el final.
    renderPage('page:2003')
    await wait(320)
    const antesDeTodo = location.pathname
    const estadosTcv = []
    for (let i = 0; i < PASOS_ACV_TCV.length; i++) {
      const r = await runner.executeStep({
        step: PASOS_ACV_TCV[i],
        index: i,
        total: PASOS_ACV_TCV.length,
        isLast: i === PASOS_ACV_TCV.length - 1,
      })
      estadosTcv.push(r.status)
      await wait(300)
      if (r.status === STEP_RESULT.CANCELLED) break
    }
    ok(
      'de la ACV a su TCV hermana: despliega cuatro ramas y navega UNA vez',
      estadosTcv.slice(0, -1).every((e) => e === STEP_RESULT.EXPANDED) &&
        estadosTcv[estadosTcv.length - 1] === STEP_RESULT.CLICKED &&
        location.pathname.includes('/pages/3003'),
      `${estadosTcv.join(',')} · ${antesDeTodo} → ${location.pathname}`
    )

    // 18. El arbol se desplaza solo: tiene scroll propio, y sin moverlo las
    //     ramas se abren por debajo del borde visible y no se ve nada.
    const scroller = treeScroller()
    if (scroller) {
      scroller.scrollTop = 0
      await wait(120)
      const lejana = [...document.querySelectorAll('.sidebar .cloud-row a')].pop()
      await scrollWithinScrollers(lejana, { behavior: 'auto' })
      ok('el arbol lateral se desplaza solo hasta la rama', scroller.scrollTop > 20, `scrollTop=${Math.round(scroller.scrollTop)}`)
    } else {
      ok('el arbol lateral se desplaza solo hasta la rama', false, 'no encuentra el scroller')
    }

    // 19. Un paso INTERMEDIO que no existe se salta. Antes acababa en una carga
    //     de pagina que plegaba el arbol entero.
    const fantasma = await runner.executeStep({
      step: {
        kind: 'confluence-page',
        id: '77777',
        title: 'Pagina que no esta en el arbol',
        label: 'Pagina que no esta en el arbol',
        path: '/wiki/spaces/ENG/pages/77777/Fantasma',
        url: ORIGIN + '/wiki/spaces/ENG/pages/77777/Fantasma',
        action: 'expand',
      },
      index: 1,
      total: 3,
      isLast: false,
    })
    ok(
      'un paso intermedio que no esta se salta, no navega',
      fantasma.status === STEP_RESULT.SKIPPED && location.pathname.includes('/pages/3003'),
      `${fantasma.status} · ${location.pathname}`
    )

    // 20. El otro estilo de resaltado: subrayado en amarillo, sin oscurecer, y
    //     las imagenes con un recuadro fino.
    setSidebar('clasica')
    renderPage('page:2003')
    await wait(320)
    runner.clear()
    runner.setHighlightStyle('marker')
    const rMarker = await runner.applyAnchor({ anchor: { kind: 'text-quote', exact: 'genera y renueva credenciales' } })
    await wait(700)
    const hostOverlay = document.getElementById('faro-overlay-host')
    ok(
      'modo subrayado: marca el texto en amarillo y no oscurece la pagina',
      hostOverlay?.classList.contains('faro-marker') && rMarker.anchored && highlighted().length === 1,
      `${rMarker.strategy} · ${highlighted().length} resaltados`
    )

    const figura = document.querySelector('#page-content figure')
    const marcadas = runner.overlay.outlineElements(imagesWithin(figura))
    ok(
      'una imagen se marca con un recuadro exterior, no con un Range',
      marcadas === 1 && runner.overlay.outlineTargets[0] === figura,
      `${marcadas} recuadro(s)`
    )
    runner.setHighlightStyle('spotlight')
    setSidebar('clasica')

    // 22. Señalar en la página: lo que el usuario subraya o pulsa es lo que se
    //     manda. Se simulan los dos gestos, texto e imagen.
    runner.clear()
    renderPage('page:2003')
    await wait(320)

    const parrafo = [...document.querySelectorAll('#page-content p')].find((p) =>
      p.textContent.includes('genera y renueva')
    )
    const esperaTexto = picker.start()
    const conCursor = document.documentElement.classList.contains('faro-picking')

    const frase = 'genera y renueva credenciales'
    const nodo = parrafo.firstChild
    const desde = nodo.nodeValue.indexOf(frase)
    const rango = document.createRange()
    rango.setStart(nodo, desde)
    rango.setEnd(nodo, desde + frase.length)
    const seleccion = getSelection()
    seleccion.removeAllRanges()
    seleccion.addRange(rango)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await wait(120)
    picker._finish(picker.pick)
    const pickTexto = await esperaTexto

    ok(
      'señalar texto: se queda con la cita, su contexto y su encabezado',
      conCursor &&
        pickTexto?.kind === 'text' &&
        pickTexto.text === frase &&
        pickTexto.prefix.length > 0 &&
        pickTexto.heading === 'Identity Provider' &&
        !document.documentElement.classList.contains('faro-picking'),
      pickTexto ? `«${pickTexto.text}» bajo «${pickTexto.heading}»` : 'no devolvió nada'
    )

    const esperaImagen = picker.start()
    document
      .querySelector('#page-content figure img')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(700)
    picker._finish(picker.pick)
    const pickImagen = await esperaImagen

    ok(
      'señalar una imagen: viaja la imagen, no sólo su alt',
      pickImagen?.kind === 'image' &&
        !!pickImagen.image &&
        pickImagen.image.url.startsWith('data:image/') &&
        pickImagen.alt.includes('Identity Provider') &&
        pickImagen.caption.includes('Figura 3'),
      pickImagen?.image
        ? `${pickImagen.image.mime} ${pickImagen.image.width}×${pickImagen.image.height} · ${pickImagen.image.url.length} B`
        : 'sin imagen'
    )

    // 23. Las observaciones del modo Análisis: subrayadas y numeradas.
    runner.clear()
    renderPage('page:200')
    await wait(320)

    const resNotas = await runner.applyNotes({ notes: OBSERVACIONES })
    await wait(500)
    const insignias = [...runner.overlay.el.noteLayer.children]

    ok(
      'analisis: tres observaciones ancladas y numeradas',
      resNotas.placed.join(',') === '1,2,3' &&
        insignias.length === 3 &&
        insignias.map((b) => b.textContent).join(',') === '1,2,3',
      `puestas ${resNotas.placed.join(',')} · ${insignias.length} insignias`
    )

    ok(
      'una cita que no esta en la pagina se queda sin marcar, no se marca al azar',
      resNotas.missed.join(',') === '4' && highlighted().length === 3,
      `sin anclar ${resNotas.missed.join(',')} · ${highlighted().length} resaltados`
    )

    // La insignia va DETRÁS de su cita, no encima ni en el margen.
    const rangoUno = runner.overlay.notes.find((x) => x.n === 1)?.ranges[0]
    const finDeLaCita = [...(rangoUno?.getClientRects() || [])].pop()
    const insigniaUno = insignias[0]
    ok(
      'la insignia va justo detras del ultimo caracter de su cita',
      !!finDeLaCita &&
        Math.abs(parseFloat(insigniaUno.style.left) - (finDeLaCita.right + 3)) <= 3 &&
        Math.abs(parseFloat(insigniaUno.style.top) - (finDeLaCita.top + finDeLaCita.height / 2 - 8.5)) <= 3,
      finDeLaCita
        ? `cita acaba en ${Math.round(finDeLaCita.right)},${Math.round(finDeLaCita.top)} · insignia en ${insigniaUno.style.left},${insigniaUno.style.top}`
        : 'sin rectangulo'
    )

    // 24. Ir a una observación concreta la destaca sin apagar las demás.
    await runner.focusNote({ n: 2 })
    await wait(400)
    const activas = [...runner.overlay.el.noteLayer.children].filter((b) => b.classList.contains('active'))
    ok(
      'ir a una observacion la destaca y deja las otras marcadas',
      runner.overlay.activeNote === 2 &&
        activas.length === 1 &&
        activas[0].textContent === '2' &&
        highlighted().length === 3,
      `activa ${runner.overlay.activeNote} · ${highlighted().length} siguen resaltadas`
    )

    const fantasmaNota = await runner.focusNote({ n: 9 })
    ok('ir a una observacion que no existe no rompe nada', fantasmaNota.ok === false, fantasmaNota.reason || '')

    runner.clearNotes()
    await wait(200)
    ok(
      'quitar las marcas deja la pagina limpia',
      highlighted().length === 0 && runner.overlay.el.noteLayer.children.length === 0,
      `${highlighted().length} resaltados · ${runner.overlay.el.noteLayer.children.length} insignias`
    )

    // 25. EL CAMBIO: al llegar a un destino no se oscurece la pagina. El foco
    //     sirve para guiarte por el arbol; una vez has llegado, tapa justo lo
    //     que has venido a leer.
    runner.clear()
    renderPage('page:200')
    await wait(320)
    const rLlegada = await runner.applyAnchor({ anchor: ANCHOR_QUOTE, explanation: 'Aquí está.' })
    await wait(700)
    const foco = runner.overlay.el.spot
    ok(
      'al llegar se subraya, no se oscurece la pagina',
      rLlegada.anchored &&
        highlighted().length === 1 &&
        !foco.classList.contains('on') &&
        !getComputedStyle(foco).boxShadow.includes('100vmax'),
      `${rLlegada.strategy} · foco ${foco.classList.contains('on') ? 'encendido' : 'apagado'}`
    )

    // 26. Marcar dentro de un bloque de código. Es donde peor se veía: el
    //     navegador devuelve una caja por cada <span> de sintaxis —diecisiete
    //     para cuatro líneas, varias repetidas— y el barrido blanco se pintaba
    //     FUERA de cada caja, asomando por la izquierda del bloque.
    runner.clear()
    renderPage('page:200')
    await wait(320)

    const rCodigo = await runner.applyAnchor({ anchor: ANCHOR_CODIGO })
    await wait(600)

    const bloque = document.querySelector('#page-content pre.code').getBoundingClientRect()
    const cajas = [...runner.overlay.el.quoteLayer.children]
    const izquierdas = cajas.map((d) => parseFloat(d.style.left))
    const derechas = cajas.map((d) => parseFloat(d.style.left) + parseFloat(d.style.width))

    // La cita ocupa cuatro líneas del bloque, así que son cuatro barras. Antes
    // salían cinco: el índice de texto se saltaba los nodos que sólo tienen
    // espacios, la cita —que cruza uno— sólo se encontraba por aproximación, y
    // la marca aproximada se comía media línea de más.
    ok(
      'codigo: una barra por linea, no una por cada color de sintaxis',
      rCodigo.anchored && cajas.length === 4,
      `${cajas.length} cajas para 4 lineas · ${rCodigo.strategy}`
    )

    ok(
      'codigo: nada se pinta fuera del bloque',
      cajas.length > 0 &&
        getComputedStyle(cajas[0]).overflow === 'hidden' &&
        Math.min(...izquierdas) >= bloque.left &&
        Math.max(...derechas) <= bloque.right,
      `bloque ${Math.round(bloque.left)}–${Math.round(bloque.right)} · marcas ${Math.round(Math.min(...izquierdas))}–${Math.round(Math.max(...derechas))} · overflow ${cajas.length ? getComputedStyle(cajas[0]).overflow : '?'}`
    )

    ok(
      'codigo: la marca se aligera para no tapar la sintaxis',
      cajas.every((d) => d.classList.contains('on-code')),
      cajas.filter((d) => d.classList.contains('on-code')).length + ' de ' + cajas.length
    )

    // Y ninguna caja se solapa con otra: el amarillo no se apila.
    let solapes = 0
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        const a = cajas[i].getBoundingClientRect()
        const b = cajas[j].getBoundingClientRect()
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) solapes++
      }
    }
    ok('codigo: las marcas no se apilan unas sobre otras', solapes === 0, solapes + ' solapes')

    // El barrido blanco sólo existe mientras barre. Antes vivía siempre,
    // aparcado en translateX(-110%) —o en +110% al acabar, que `forwards`
    // retiene—, y cada repintado por scroll lo dejaba fijo fuera de su caja.
    ok(
      'codigo: el barrido no se queda aparcado fuera de la marca',
      cajas.every((d) => getComputedStyle(d, '::after').content === 'none'),
      cajas.map((d) => getComputedStyle(d, '::after').content).join(' ')
    )

    // 27. El bloque de código con scroll horizontal propio: el navegador recorta
    //     su texto, así que la marca tiene que recortarse igual. Sin esto se
    //     quedaba pintada donde estaba el texto, fuera del bloque.
    const preCode = document.querySelector('#page-content pre.code')
    preCode.style.maxWidth = '160px'
    preCode.scrollLeft = 90
    preCode.dispatchEvent(new Event('scroll', { bubbles: true }))
    await wait(320)

    const cajaPre = preCode.getBoundingClientRect()
    const recortadas = [...runner.overlay.el.quoteLayer.children].map((d) => ({
      left: parseFloat(d.style.left),
      right: parseFloat(d.style.left) + parseFloat(d.style.width),
    }))
    ok(
      'codigo desplazado en horizontal: la marca se recorta al bloque',
      recortadas.length > 0 &&
        recortadas.every((r) => r.left >= cajaPre.left - 0.5 && r.right <= cajaPre.right + 0.5),
      `bloque ${Math.round(cajaPre.left)}–${Math.round(cajaPre.right)} · marcas ${recortadas
        .map((r) => Math.round(r.left) + '–' + Math.round(r.right))
        .join(' ')}`
    )
    preCode.style.maxWidth = ''

    // 28. El camino se lee de la API REST del propio sitio, no del modelo: una
    //     petición, milisegundos, y la portada del espacio fuera del recorrido.
    const { fetchAncestors } = await import('/src/shared/confluence-rest.js')
    const sitioRest = { origin: location.origin, wikiPrefix: '/wiki', cloud: true }
    const pideRest = (u, o) => fetch(u, o)
    const t0Rest = Date.now()
    const rest = await fetchAncestors(pideRest, sitioRest, '3003')
    const cadenaRest = rest.ok ? rest.pages.map((p) => p.id).join('>') : ''
    ok(
      'el camino se lee de la API REST del sitio, en milisegundos y sin la portada',
      rest.ok &&
        cadenaRest === '1080>1081>3001>3002>3003' &&
        rest.pages[0].parentId === null &&
        rest.pages[4].parentId === '3002' &&
        rest.pages[4].url === '/wiki/spaces/ENG/pages/3003/TCV+Static+-+Identity+Provider+Service' &&
        Date.now() - t0Rest < 2000,
      rest.ok ? `${cadenaRest} · ${rest.via} · ${rest.ms} ms` : rest.reason
    )
    const restNo = await fetchAncestors(pideRest, sitioRest, '424242')
    ok('una página que no existe no tiene camino, y no se inventa', !restNo.ok && restNo.status === 404, restNo.reason || '')

    // 28b. La búsqueda de páginas por título, por la misma API: un término por
    //      palabra, comodín de prefijo sólo en el último, y nada de lo que el
    //      usuario escriba puede romper el literal. La Confluence falsa busca
    //      como la de verdad: sin comodín, «Arqui» no encontraría nada.
    const { searchPages } = await import('/src/shared/confluence-rest.js')
    const pedidas = []
    const pideContando = (u, o) => {
      pedidas.push(String(u))
      return fetch(u, o)
    }
    const busca = await searchPages(pideContando, sitioRest, 'ADR')
    const idsBusca = busca.ok ? busca.pages.map((p) => p.id).sort().join(',') : ''
    ok(
      'la búsqueda por título se hace en la API del sitio y devuelve sólo lo que casa',
      busca.ok && busca.via === 'v1' && idsBusca === '200,201' && busca.pages.every((p) => p.spaceKey === 'ENG' && p.url.startsWith('/wiki/spaces/ENG/pages/')),
      busca.ok ? `${idsBusca} · ${busca.via} · ${busca.ms} ms` : busca.reason
    )
    const prefijoBusca = await searchPages(pideContando, sitioRest, 'Arqui')
    ok(
      'escribir el principio de una palabra encuentra la página: el último término lleva comodín',
      prefijoBusca.ok && prefijoBusca.pages.some((p) => p.id === '100'),
      prefijoBusca.ok ? prefijoBusca.pages.map((p) => p.title).join(' | ') : prefijoBusca.reason
    )
    const pedidasAntes = pedidas.length
    const corta = await searchPages(pideContando, sitioRest, 'x')
    ok('con una letra no se pide nada al sitio', !corta.ok && pedidas.length === pedidasAntes, corta.reason || '')
    const rara = await searchPages(pideContando, sitioRest, 'ADR"\\')
    const ultimaUrl = decodeURIComponent(pedidas[pedidas.length - 1] || '')
    ok(
      'las comillas y las barras del usuario no llegan al CQL',
      rara.ok && ultimaUrl.includes('title~"ADR*"') && !ultimaUrl.includes('\\') && rara.pages.some((p) => p.id === '200'),
      ultimaUrl.slice(Math.max(0, ultimaUrl.indexOf('cql=')))
    )

    // 29. Y con ese camino, sin que el modelo haya dicho nada, el recorrido
    //     entero sobre la barra lateral estilo Cloud: cuatro ramas y un salto.
    if (rest.ok) {
      setSidebar('clasica')
      setSidebar('cloud')
      renderPage('page:2003')
      await wait(320)
      const pasosRest = rest.pages.map((p, i) => ({
        kind: 'confluence-page',
        id: p.id,
        title: p.title,
        label: p.title,
        path: p.url,
        url: ORIGIN + p.url,
        action: i === rest.pages.length - 1 ? 'open' : 'expand',
      }))
      const estadosRest = []
      for (let i = 0; i < pasosRest.length; i++) {
        const r = await runner.executeStep({
          step: pasosRest[i],
          index: i,
          total: pasosRest.length,
          isLast: i === pasosRest.length - 1,
        })
        estadosRest.push(r.status)
        await wait(300)
        if (r.status === STEP_RESULT.CANCELLED) break
      }
      ok(
        'con el camino de la API, de la ACV a su TCV: despliega cuatro ramas y navega una vez',
        estadosRest.slice(0, -1).every((e) => e === STEP_RESULT.EXPANDED) &&
          estadosRest[estadosRest.length - 1] === STEP_RESULT.CLICKED &&
          location.pathname.includes('/pages/3003'),
        `${estadosRest.join(',')} · ${location.pathname}`
      )
      setSidebar('clasica')
    }

    // 30. La página en bloques numerados, tal como se le enseña al modelo:
    //     determinista, con la forma esperada y sin lo que no se ve.
    runner.clear()
    renderPage('page:200')
    await wait(320)
    const d1 = pageDigest()
    const d2 = pageDigest()
    const lineasDigest = formatDigest(d1.blocks).split('\n')
    ok(
      'digest: la pagina en bloques numerados, determinista y con la forma esperada',
      formatDigest(d1.blocks) === formatDigest(d2.blocks) &&
        d1.blocks.length > 10 &&
        !d1.truncated &&
        /^¶1 \[h1\] ADR-014/.test(lineasDigest[0]) &&
        d1.blocks.some((b) => b.tag === 'h2' && b.text === 'Contexto') &&
        d1.blocks.some((b) => b.tag === 'código' && b.text.includes('app.example.com')),
      `${d1.blocks.length} bloques · ${d1.chars} caracteres · ${lineasDigest[0]}`
    )

    const articulo = document.querySelector('#page-content article')
    const oculto = document.createElement('p')
    oculto.textContent = 'Párrafo oculto que no debe verse'
    oculto.style.display = 'none'
    const escondido = document.createElement('p')
    escondido.textContent = 'Párrafo aria-hidden que tampoco'
    escondido.setAttribute('aria-hidden', 'true')
    articulo.append(oculto, escondido)
    const conOcultos = pageDigest()
    oculto.remove()
    escondido.remove()
    ok(
      'digest: lo que no se ve no se le ensena al modelo',
      conOcultos.blocks.length === d1.blocks.length && !conOcultos.blocks.some((b) => /oculto|tampoco/.test(b.text)),
      `${conOcultos.blocks.length} bloques con dos parrafos ocultos`
    )

    // 31. La escalera entera del análisis por bloques, sobre observaciones
    //     construidas con la misma página en bloques que vería el modelo.
    const notasBloque = observacionesPorBloques(d1)
    runner.clear()
    const resBloques = await runner.applyNotes({ notes: notasBloque })
    await wait(500)
    const estrategia = (n) => resBloques.detail?.find((x) => x.n === n)?.strategy || 'sin detalle'

    ok(
      'analisis por bloques: bloque + cita literal',
      estrategia(1) === 'block+quote' && highlighted().includes('el token expira a los 90 días naturales'),
      estrategia(1)
    )
    ok(
      'analisis por bloques: sin cita se marca el bloque entero',
      estrategia(2) === 'block+whole' && highlighted().some((t) => t.startsWith('La rotación se solapa')),
      estrategia(2)
    )
    ok(
      'analisis por bloques: el numero se equivoco pero el texto manda',
      estrategia(3) === 'block-moved+quote' && highlighted().includes('El exportador de métricas heredado sigue con token fijo'),
      estrategia(3)
    )
    ok(
      'analisis por bloques: sin bloque, la cita se busca en toda la pagina',
      estrategia(4) === 'global+quote' && highlighted().includes('Cada servicio necesita releer su credencial sin reiniciar'),
      estrategia(4)
    )
    ok(
      'analisis por bloques: sin bloque ni cita, sin marcar; y una marca por observacion',
      resBloques.placed.join(',') === '1,2,3,4' && resBloques.missed.join(',') === '5' && highlighted().length === 4,
      `puestas ${resBloques.placed.join(',')} · sin anclar ${resBloques.missed.join(',')} · ${highlighted().length} resaltados`
    )

    // El bloque entero es una barra por línea, sin apilar; y las insignias, una
    // por observación, detrás de su última línea.
    const cajasBloques = [...runner.overlay.el.quoteLayer.children]
    let solapesBloques = 0
    for (let i = 0; i < cajasBloques.length; i++) {
      for (let j = i + 1; j < cajasBloques.length; j++) {
        const a = cajasBloques[i].getBoundingClientRect()
        const b = cajasBloques[j].getBoundingClientRect()
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) solapesBloques++
      }
    }
    ok(
      'analisis por bloques: el bloque entero es una barra por linea, sin apilar',
      cajasBloques.length >= 5 && solapesBloques === 0 && runner.overlay.el.noteLayer.children.length === 4,
      `${cajasBloques.length} cajas · ${solapesBloques} solapes · ${runner.overlay.el.noteLayer.children.length} insignias`
    )

    // 32. La página se desplazó un bloque entre que se leyó y se marcó: alguien
    //     añadió un párrafo por encima. El número ya no vale; el texto sí.
    const insertado = document.createElement('p')
    insertado.textContent = 'Nota añadida hoy por encima de todo lo demás.'
    articulo.insertBefore(insertado, articulo.children[1])
    runner.clearNotes()
    const resMovido = await runner.applyNotes({ notes: notasBloque })
    await wait(300)
    insertado.remove()
    ok(
      'analisis por bloques: la pagina se desplazo un bloque y la marca sigue donde estaba el texto',
      resMovido.detail?.find((x) => x.n === 1)?.strategy === 'block-moved+quote' &&
        highlighted().includes('el token expira a los 90 días naturales'),
      resMovido.detail?.find((x) => x.n === 1)?.strategy || 'sin detalle'
    )

    // 33. Confluence repinta: el párrafo marcado se sustituye por un clon. Ir a
    //     la observación la vuelve a resolver contra la página de ahora.
    runner.clearNotes()
    renderPage('page:200')
    await wait(320)
    await runner.applyNotes({ notes: notasBloque })
    const parrafoMarcado = [...document.querySelectorAll('#page-content p')].find((p) =>
      p.textContent.includes('el token expira')
    )
    parrafoMarcado.replaceWith(parrafoMarcado.cloneNode(true))
    const focoVivo = await runner.focusNote({ n: 1 })
    await wait(300)
    ok(
      'analisis por bloques: una marca sobrevive a un repintado del parrafo',
      focoVivo.ok &&
        runner.overlay.notes.find((x) => x.n === 1)?.ranges[0]?.startContainer?.isConnected === true &&
        highlighted().includes('el token expira a los 90 días naturales') &&
        runner.overlay.activeNote === 1,
      focoVivo.ok ? 'resuelta de nuevo' : focoVivo.reason
    )
    runner.clearNotes()

    runner.clear()
    const passed = results.filter((x) => x.pass).length
    say(`—— ${passed}/${results.length} comprobaciones ——`, passed === results.length ? 'ok' : 'bad')
    return { passed, total: results.length, results }
  },
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

document.getElementById('rig-body').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.rig-btn')
  if (!btn) return
  const act = actions[btn.dataset.act]
  if (act) Promise.resolve(act()).catch((err) => say('fallo: ' + err.message, 'bad'))
})

document.getElementById('rig-min').addEventListener('click', () => {
  document.getElementById('rig-body').classList.toggle('hidden')
})

// Expuesto para poder dirigir el banco desde fuera en las comprobaciones.
window.faroHarness = {
  actions,
  runner,
  picker,
  renderPage,
  PAGES,
  OBSERVACIONES,
  pageDigest,
  formatDigest,
  observacionesPorBloques,
}
say('banco listo')
