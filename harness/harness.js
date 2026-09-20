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
import { pageDigest, digestScope, resolveBlockQuote } from '../src/content/digest.js'
import { jiraIssueFields } from '../src/content/jira-issue.js'
import { formatDigest, blockHint, DIGEST_LIMITS } from '../src/shared/digest.js'

// --------------------------------------------------------------- contenido

/**
 * Una página larga, generada al vuelo y determinista.
 *
 * El ADR-014 del banco tiene veinte bloques; una página de Confluence de
 * verdad tiene cientos, y es ahí donde se nota lo que cuesta leerla en bloques
 * y resolver una observación tras otra (P7 de H6). Ésta son doce apartados de
 * veinticinco medidas, con sus listas y una tabla: 347 bloques y unos 25 600
 * caracteres, por debajo de los topes de `DIGEST_LIMITS` a propósito, para que
 * la comprobación 42 pueda exigir la página ENTERA y sin recortar.
 *
 * Cada párrafo nombra un servicio distinto («srv-042»), así que ninguna cita
 * aparece dos veces y una marca sólo puede caer donde tiene que caer. Devuelve
 * además cuántos bloques son, para no escribir el número a mano en la
 * comprobación: el que manda es el que genera la página.
 */
function paginaLarga({ apartados = 12, porApartado = 25 } = {}) {
  const html = []
  let bloques = 1 // el <h1> que pone renderPage con el título

  for (let a = 1; a <= apartados; a++) {
    html.push(`<h2>Apartado ${a} — rotación por lotes</h2>`)
    bloques++
    for (let i = 1; i <= porApartado; i++) {
      const n = (a - 1) * porApartado + i
      html.push(`<p>Medida ${n}. El servicio srv-${String(n).padStart(3, '0')} renueva su credencial cada 90 días.</p>`)
      bloques++
    }
    html.push(
      `<ul><li>Lote ${a}: ventana de mantenimiento nocturna.</li><li>Lote ${a}: responsable de guardia asignado.</li></ul>`
    )
    bloques += 2
  }

  // `ul`, `table`, `tbody` y `tr` no tienen texto propio: no son bloques, lo
  // son sus `li` y sus celdas. Ninguna celda baja de dos caracteres, que es lo
  // que `DIGEST_LIMITS.blockMin` deja de contar como bloque.
  html.push(
    '<table><caption>Resumen de lotes</caption><tbody>' +
      '<tr><th>Lote</th><th>Ventana</th><th>Estado</th></tr>' +
      '<tr><td>Lote 1</td><td>Nocturna</td><td>Pendiente</td></tr>' +
      '<tr><td>Lote 2</td><td>Diurna</td><td>Hecho</td></tr>' +
      '</tbody></table>'
  )
  bloques += 10 // el pie de la tabla y sus nueve celdas

  return {
    path: '/wiki/spaces/ENG/pages/900/Pagina-larga',
    title: 'Página larga de prueba',
    crumb: 'Ingeniería / Página larga',
    body: html.join(''),
    bloques,
    /** Cuántos párrafos tiene: de ahí salen las citas de la comprobación 42. */
    medidas: apartados * porApartado,
  }
}

const LARGO = paginaLarga()

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
  'page:largo': LARGO,
  'page:1086': {
    path: '/wiki/spaces/ENG/pages/1086/ACV+Static+-+Identity+Provider+Service',
    title: 'ACV Static - Identity Provider Service',
    crumb: '… / ACV Static - Identity Provider Service',
    body: `
      <p class="meta">Creado por Nicolas Auricchio</p>
      <h2>Identity Provider</h2>
      <p>Este componente se despliega dentro del Governance Authority Agent y genera y renueva credenciales para los participantes recién incorporados.</p>`,
  },

  // Una incidencia de Jira con la forma del Data Center real del usuario
  // (Jira 9): cabecera con el título y la barra de acciones, módulos con su
  // cabecera y su contenido, pestañas de campos, comentarios con su botón de
  // plegar y sus acciones, el editor de comentarios pegajoso y el panel lateral
  // con integraciones. Es lo que la lectura en bloques tiene que saber trocear
  // sin llevarse la interfaz.
  'issue:ENG-7': {
    path: '/browse/ENG-7',
    title: 'ENG-7 Rotar los tokens de servicio antes del despliegue de marzo',
    crumb: 'Jira · ENG · ENG-7',
    raw: true,
    body: `
      <div id="issue-content" class="issue-edit-form">
        <div class="issue-view">
          <header id="stalker" class="issue-header js-stalker">
            <div class="issue-header-content">
              <div class="issue-header-keys"><a href="/browse/ENG-7" id="key-val">ENG-7</a></div>
              <div id="summary-val" class="issue-summary">Rotar los tokens de servicio antes del despliegue de marzo</div>
              <div class="command-bar">
                <ul class="ops-menus aui-toolbar2">
                  <li><a href="#" class="tb-btn">Editar</a></li>
                  <li><a href="#" class="tb-btn">Añadir comentario</a></li>
                  <li><a href="#" class="tb-btn">Asignar</a></li>
                  <li><a href="#" class="tb-btn">Más</a></li>
                </ul>
              </div>
              <div id="issue-header-pager">1 de 45196 · <a href="#">Siguiente incidencia</a></div>
            </div>
          </header>
          <div class="issue-body-content">
            <div class="aui-item issue-main-column">
              <div id="details-module" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Detalles</h3><button class="aui-button toggle-title" type="button"><span>Contraer Detalles</span></button></div>
                <div class="mod-content">
                  <ul id="issuedetails" class="property-list two-cols">
                    <li class="item"><div class="wrap"><strong class="name">Tipo:</strong> <span id="type-val" class="value">Tarea</span></div></li>
                    <li class="item item-right"><div class="wrap"><strong class="name">Estado:</strong> <span id="status-val" class="value"><span class="lozenge">En curso</span></span></div></li>
                    <li class="item"><div class="wrap"><strong class="name">Prioridad:</strong> <span id="priority-val" class="value">Crítica</span></div></li>
                    <li class="item item-right"><div class="wrap"><strong class="name">Versión correctora:</strong> <span id="fixfor-val" class="value">Major Release Q4-2026</span></div></li>
                    <li class="item"><div class="wrap"><strong class="name">Etiquetas:</strong> <span class="value"><ul class="labels"><li><a href="#">seguridad</a></li><li><a href="#">tokens</a></li></ul></span></div></li>
                  </ul>
                  <ul class="tabs-menu"><li class="menu-item active-tab"><a href="#">Main</a></li><li class="menu-item"><a href="#">Planning</a></li></ul>
                  <div class="tabs-pane active-pane"><ul class="property-list"><li class="item"><div class="wrap"><strong class="name">Epic Link:</strong> <span class="value"><a class="issue-link" href="/browse/ENG-1">Rotación de credenciales</a></span></div></li></ul></div>
                  <div class="tabs-pane" style="display:none"><ul class="property-list"><li class="item"><div class="wrap"><strong class="name">Sprint:</strong> <span class="value">S37 Infra</span></div></li></ul></div>
                </div>
              </div>
              <div id="descriptionmodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Descripción</h3><button class="aui-button toggle-title" type="button"><span>Contraer Descripción</span></button></div>
                <div class="mod-content"><div id="description-val" class="field-ignore-highlight"><div class="user-content-block">
                  <p><b>Objetivo:</b> rotar los tokens de servicio de todos los componentes antes del despliegue de marzo, sin ventana de corte.</p>
                  <p>Por política de seguridad el token expira a los 90 días naturales y debe rotarse desde el panel de administración.</p>
                  <p><b>Criterios de aceptación:</b></p>
                  <ul>
                    <li>Ningún servicio queda fuera durante la rotación.</li>
                    <li>El exportador de métricas heredado mantiene su token fijo hasta el próximo trimestre.</li>
                  </ul>
                </div></div></div>
              </div>
              <div id="attachmentmodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Adjuntos</h3><a href="#" class="ops">Opciones</a></div>
                <div class="mod-content issue-drop-zone"><div class="issue-drop-zone"><p>Suelte los archivos para adjuntarlos o <a href="#">explorar</a>.</p></div></div>
              </div>
              <div id="linkingmodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Enlace a Incidencias</h3></div>
                <div class="mod-content"><dl class="links-list"><dt>relates to</dt><dd><div class="link-content"><a href="/browse/ENG-8">ENG-8</a> Revisar permisos del exportador</div></dd></dl></div>
              </div>
              <div id="activitymodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Actividad</h3></div>
                <div class="mod-content">
                  <ul class="tabs-menu" id="issue-tabs"><li class="menu-item"><a href="#">Todo</a></li><li class="menu-item active-tab"><a href="#">Comentarios</a></li><li class="menu-item"><a href="#">Histórico de Cambios</a></li></ul>
                  <div id="issue_actions_container" class="issuePanelContainer">
                    <div id="comment-1001" class="issue-data-block activity-comment twixi-block expanded">
                      <div class="twixi-wrap verbose actionContainer">
                        <div class="action-head">
                          <button class="twixi icon-default" type="button"><span>Contraer el comentario: Ana Ruiz</span></button>
                          <div class="action-details"><a class="user-hover" href="#">Ana Ruiz</a> añadió un comentario - <span class="date">14/ago/26 6:18 AM</span></div>
                        </div>
                        <div class="action-body flooded"><p>El exportador de métricas heredado no admite recarga en caliente: la rotación de su token tiene que ser a mano, en ventana de mantenimiento.</p></div>
                        <div class="action-links action-comment-actions"><button class="pinbutton" type="button">Anclar</button><a href="#">Editar</a><a href="#">Borrar</a></div>
                      </div>
                    </div>
                    <div id="comment-1002" class="issue-data-block activity-comment twixi-block expanded">
                      <div class="twixi-wrap verbose actionContainer">
                        <div class="action-head">
                          <button class="twixi icon-default" type="button"><span>Contraer el comentario: Marco</span></button>
                          <div class="action-details"><a class="user-hover" href="#">Marco</a> añadió un comentario - <span class="date">15/ago/26 9:02 AM</span></div>
                        </div>
                        <div class="action-body flooded"><p>De acuerdo. Entonces el criterio de «ningún servicio queda fuera» no se cumple para el exportador: hay que decirlo en la descripción.</p></div>
                        <div class="action-links action-comment-actions"><button class="pinbutton" type="button">Anclar</button></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div id="addcomment" class="module sticky">
                <div id="addcomment-inner" class="module"><div class="mod-content"><textarea placeholder="Añadir un comentario…"></textarea><p>Consejo de expertos: pulsa m para añadir un comentario</p></div></div>
              </div>
            </div>
            <div id="viewissuesidebar" class="aui-item">
              <div id="peoplemodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Personas</h3></div>
                <div class="mod-content"><dl><dt>Persona asignada:</dt><dd>Sin asignar</dd><dt>Informador:</dt><dd>Paulo Cabrita</dd></dl></div>
              </div>
              <div id="datesmodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Fechas</h3></div>
                <div class="mod-content"><dl><dt>Creada:</dt><dd>Hace 4 horas</dd></dl></div>
              </div>
              <div id="git-issue-webpanel" class="module"><div class="mod-header"><h3>Git Integration</h3></div><div class="mod-content"><p>0 commits</p><a href="#">Create branch</a></div></div>
            </div>
          </div>
        </div>
      </div>`,
  },
}

const content = document.getElementById('page-content')
const crumbs = document.getElementById('crumbs')
const log = document.getElementById('rig-log')

function renderPage(key, { push = true } = {}) {
  const page = PAGES[key]
  if (!page) return
  // Una incidencia de Jira trae su propia estructura entera; una página de
  // Confluence es un artículo con su título.
  content.innerHTML = page.raw ? page.body : `<article class="doc"><h1>${page.title}</h1>${page.body}</article>`
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
  document.title = page.title + (page.raw ? ' - Jira' : ' · Confluence')
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

/**
 * Tres observaciones sobre la incidencia, construidas con sus bloques: un
 * párrafo de la descripción con cita, un comentario entero y un campo. Es lo
 * que el análisis en Jira tiene que poder subrayar.
 */
function observacionesDeIncidencia(digest) {
  const bloque = (inicio) => digest.blocks.find((b) => b.text.startsWith(inicio))
  const politica = bloque('Por política de seguridad')
  const comentario = bloque('El exportador de métricas heredado no admite')
  const prioridad = bloque('Prioridad:')
  const ancla = (b, exact) => ({ kind: 'block-quote', block: b?.id || 999, hint: blockHint(b?.text || ''), exact })
  return [
    { n: 1, title: 'La caducidad no se justifica', kind: 'supuesto', anchor: ancla(politica, 'el token expira a los 90 días naturales') },
    { n: 2, title: 'El comentario contradice un criterio', kind: 'contradiccion', anchor: ancla(comentario, '') },
    { n: 3, title: 'Prioridad sin fecha', kind: 'riesgo', anchor: ancla(prioridad, '') },
  ]
}

/**
 * Doce observaciones sobre la página larga, seis por cada camino que cuesta:
 *   - seis con su bloque y una cita dentro («block+quote»), que es el caso
 *     normal de un análisis;
 *   - seis cuyo bloque NO existe, que caen al peldaño global («global+quote»)
 *     y son las que antes recorrían la página entera una por una.
 * Los bloques se buscan por su texto en el digest recién leído, nunca por un
 * número escrito a mano.
 */
function observacionesDePaginaLarga(digest) {
  const bloque = (n) => digest.blocks.find((b) => b.text.startsWith(`Medida ${n}.`))
  const cita = (n) => `El servicio srv-${String(n).padStart(3, '0')} renueva su credencial`
  const conBloque = [20, 70, 120, 170, 220, 270]
  const sinBloque = [31, 81, 131, 181, 231, 281]

  const notas = []
  conBloque.forEach((n, i) => {
    const b = bloque(n)
    notas.push({
      n: i + 1,
      title: `Medida ${n} sin responsable`,
      kind: 'hueco',
      anchor: { kind: 'block-quote', block: b?.id || 999, hint: blockHint(b?.text || ''), exact: cita(n) },
    })
  })
  sinBloque.forEach((n, i) => {
    notas.push({
      n: conBloque.length + i + 1,
      title: `Medida ${n} sin fecha`,
      kind: 'riesgo',
      anchor: { kind: 'block-quote', block: 999, hint: 'un bloque que no existe', exact: cita(n) },
    })
  })
  return notas
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

  async jira() {
    renderPage('issue:ENG-7')
    await wait(320)
    runner.clear()
    const d = pageDigest()
    say(`incidencia en ${d.blocks.length} bloques · ${d.chars} caracteres`, 'ok')
    for (const l of formatDigest(d.blocks).split('\n').slice(0, 8)) say(l.length > 110 ? l.slice(0, 107) + '…' : l)
    // Y sus campos, que son lo que decide cómo se analiza.
    const campos = jiraIssueFields()
    say(`campos: tipo «${campos?.type}» · estado «${campos?.status}» · prioridad «${campos?.priority}» · etiquetas «${campos?.labels.join(', ')}»`, 'ok')
    const r = await runner.applyNotes({ notes: observacionesDeIncidencia(d) })
    say(`marcadas ${r.placed.join(', ') || 'ninguna'}${r.missed.length ? ' · sin anclar ' + r.missed.join(', ') : ''}`, 'ok')
    for (const x of r.detail || []) say(`  ${x.n} → ${x.strategy}${x.approximate ? ' (aproximada)' : ''}`)
    say('pulsa «Limpiar» y navega a otra página para volver a la Confluence simulada')
  },

  /**
   * El parpadeo de P1, a ojo: marcas puestas y cuarenta scrolls de golpe.
   * Antes cada evento vaciaba la capa y recreaba cada rectángulo desde
   * `opacity: 0`; ahora los nodos son los mismos y siguen encendidos.
   */
  async scrollStress() {
    renderPage('page:200')
    await wait(360)
    runner.clear()
    const r = await runner.applyNotes({ notes: observacionesPorBloques(pageDigest()) })
    await wait(700)
    const capa = runner.overlay.el.quoteLayer
    const antes = [...capa.children]
    runner.overlay.resetStats()
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new Event('scroll'))
      treeScroller()?.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    await frame()
    await frame()
    const s = runner.overlay.stats
    const mismos = capa.children.length === antes.length && antes.every((n, i) => n === capa.children[i])
    say(
      `40 scrolls → ${s.paints} repintado(s) · creados ${s.created} · reutilizados ${s.reused} · ` +
        `los mismos nodos ${mismos ? 'sí' : 'NO'} · marcadas ${r.placed.join(', ')}`,
      s.created === 0 && mismos ? 'ok' : 'bad'
    )
  },

  /** Una página larga de verdad: leerla en bloques y marcar doce observaciones. */
  async stress() {
    renderPage('page:largo')
    await wait(400)
    runner.clear()
    const tiempos = []
    let d = null
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      d = pageDigest()
      tiempos.push(performance.now() - t)
    }
    tiempos.sort((a, b) => a - b)
    say(
      `${d.blocks.length} bloques (esperados ${LARGO.bloques}) · ${d.chars} caracteres` +
        `${d.truncated ? ' · RECORTADA' : ''} · leer: mediana ${Math.round(tiempos[1])} ms`,
      d.blocks.length === LARGO.bloques && !d.truncated ? 'ok' : 'bad'
    )
    const r = await runner.applyNotes({ notes: observacionesDePaginaLarga(d) })
    say(`marcadas ${r.placed.length}/12 en ${r.ms} ms · ${(r.detail || []).map((x) => x.strategy).join(' ')}`, r.placed.length === 12 ? 'ok' : 'bad')
  },

  /**
   * Las lecturas REST de H7 a ojo: una consulta de plantilla contra la Jira de
   * mentira, los filtros del usuario y el árbol del espacio de la Confluence de
   * mentira. Nada de esto toca la página; es lo que el content script contesta
   * cuando el panel pregunta.
   */
  async 'jira-rest'() {
    const jiraRest = await import('/src/shared/jira-rest.js')
    const confRest = await import('/src/shared/confluence-rest.js')
    const pide = (u, o) => fetch(u, o)
    const sitioJira = { origin: location.origin, jiraPrefix: '', cloud: false }
    const sitioConf = { origin: location.origin, wikiPrefix: '/wiki', cloud: false }

    const vistas = await jiraRest.searchIssues(pide, sitioJira, jiraRest.historyJql(), { limit: 10 })
    say(
      vistas.ok ? `lo que has mirado (${vistas.via}, ${vistas.ms} ms): ${vistas.issues.map((i) => i.key).join(', ')}` : `sin lista: ${vistas.reason}`,
      vistas.ok ? 'ok' : 'bad'
    )
    for (const i of (vistas.issues || []).slice(0, 4)) say(`  ${i.key} · ${i.status} (${i.statusCategory}) · ${i.summary}`)

    const mala = await jiraRest.searchIssues(pide, sitioJira, 'foo = 1')
    say(`una JQL que Jira no acepta: ${mala.reason} · ${(mala.messages || []).join(' | ')}`, mala.ok ? 'bad' : 'ok')

    const filtros = await jiraRest.fetchFavouriteFilters(pide, sitioJira)
    say(filtros.ok ? `filtros favoritos: ${filtros.filters.map((f) => f.name).join(' | ')}` : `sin filtros: ${filtros.reason}`, filtros.ok ? 'ok' : 'bad')

    const arbol = await confRest.fetchSpacePages(pide, sitioConf, 'ENG', { limit: 5 })
    say(
      arbol.ok
        ? `árbol del espacio ENG: ${arbol.pages.length} páginas en ${arbol.requests} peticiones · portada ${arbol.homeId} · ${arbol.ms} ms`
        : `sin árbol: ${arbol.reason}`,
      arbol.ok ? 'ok' : 'bad'
    )
    for (const p of (arbol.pages || []).slice(0, 5)) say(`  ${p.id} ← ${p.parentId ?? 'raíz'} · ${p.title}`)
  },

  /**
   * Los chips de «búsquedas al instante» de la incidencia que hay delante (H8),
   * con sus consultas ejecutadas de verdad contra la Jira de mentira.
   *
   * Es la acción que enseña el camino entero sin panel: de los campos que se leen
   * de la pantalla a una lista de incidencias, sin modelo y sin tokens.
   */
  async chips() {
    renderPage('issue:ENG-7')
    await wait(320)
    const jiraRest = await import('/src/shared/jira-rest.js')
    const { searchChips } = await import('/src/panel/search-chips.js')
    const { normalizeIssueFields } = await import('/src/panel/issue-profile.js')
    const FIX = await (await fetch('/harness/issues.json')).json()
    const campos = normalizeIssueFields(jiraIssueFields())
    if (!campos) return say('esta página no es una incidencia', 'bad')
    say(`campos leídos: tipo «${campos.type}» · estado «${campos.status}» · épica ${campos.epicKey || '(sin enlace)'}`)

    const sitio = { product: 'jira', cloud: false, projectKey: 'ENG', issueKey: 'ENG-7' }
    const chips = searchChips(sitio, {
      issueFields: campos,
      favouriteFilters: FIX.filters,
      recentJql: [{ jql: 'project = ENG AND labels = seguridad', at: Date.now(), count: 4 }],
    })
    const sitioJira = { origin: location.origin, jiraPrefix: '', cloud: false }
    for (const chip of chips) {
      if (!chip.run) {
        say(`  ${chip.label} → se abre en Jira: ${chip.title}`, 'ok')
        continue
      }
      const r = await jiraRest.searchIssues((u, o) => fetch(u, o), sitioJira, chip.jql, { limit: 5 })
      say(
        `  ${chip.label} → ${r.ok ? `${r.issues.length} de ${r.total} en ${r.ms} ms` : 'sin lista: ' + r.reason}  ·  ${chip.jql}`,
        r.ok ? 'ok' : 'bad'
      )
      for (const i of (r.issues || []).slice(0, 3)) say(`      ${i.key} · ${i.status} · ${i.summary}`)
    }
  },

  /**
   * Lo que H9 adelanta antes de gastar un turno del modelo: el árbol del espacio
   * leído de la API y convertido en índice, comparado con el que se lee de la
   * barra lateral, y la muestra del proyecto contada.
   *
   * Es la acción que enseña de un vistazo por qué el indexado dejó de pedirle al
   * modelo el volcado del índice y la jerarquía: lo que aquí sale en
   * milisegundos eran dos turnos y una jerarquía adivinada a trozos.
   */
  async 'rest-index'() {
    setSidebar('clasica')
    renderPage('page:200')
    await wait(320)
    const confRest = await import('/src/shared/confluence-rest.js')
    const jiraRest = await import('/src/shared/jira-rest.js')
    const { snapshotTree } = await import('/src/content/tree-scan.js')
    const { indexFromSpacePages } = await import('/src/panel/indexer.js')
    const { searchChips } = await import('/src/panel/search-chips.js')
    const pide = (u, o) => fetch(u, o)
    const sitioConf = { origin: location.origin, wikiPrefix: '/wiki', cloud: false }
    const sitioJira = { origin: location.origin, jiraPrefix: '', cloud: false }

    const arbol = await confRest.fetchSpacePages(pide, sitioConf, 'ENG', { limit: 8 })
    if (!arbol.ok) return say(`sin árbol: ${arbol.reason}`, 'bad')
    const indice = indexFromSpacePages(arbol.pages, {
      site: { host: location.hostname, cloud: false, wikiPrefix: '/wiki' },
      scope: { kind: 'space', key: 'ENG' },
      homeId: arbol.homeId,
    })
    const entradas = Object.keys(indice?.pages || {}).length
    say(`índice del espacio ENG por la API: ${entradas} páginas en ${arbol.requests} peticiones · ${arbol.ms} ms`, entradas ? 'ok' : 'bad')
    for (const id of Object.keys(indice?.pages || {}).slice(0, 5)) {
      const p = indice.pages[id]
      say(`  ${id} ← ${p.parentId ?? 'raíz'} · ${p.title}`)
    }

    // Lo mismo que el usuario ve: si las dos versiones no dicen el mismo padre,
    // el recorrido paso a paso abriría una rama que no lleva a ninguna parte.
    const deLaBarra = snapshotTree().pages
    const comunes = deLaBarra.filter((p) => indice?.pages?.[p.id])
    const distintas = comunes.filter((p) => (indice.pages[p.id].parentId || null) !== (p.parentId || null))
    say(
      `contra el árbol lateral: ${comunes.length} de ${deLaBarra.length} páginas en las dos · ${distintas.length} con otro padre`,
      comunes.length === deLaBarra.length && !distintas.length ? 'ok' : 'bad'
    )
    for (const p of distintas) say(`  ${p.id}: la API dice ${indice.pages[p.id].parentId ?? 'raíz'} y el árbol ${p.parentId ?? 'raíz'}`, 'bad')

    const muestra = await jiraRest.searchIssues(pide, sitioJira, jiraRest.sampleQuery('ENG'), {
      limit: jiraRest.JIRA_REST_LIMITS.maxResults,
      fields: jiraRest.SAMPLE_FIELDS,
    })
    if (!muestra.ok) return say(`sin muestra: ${muestra.reason}`, 'bad')
    const perfil = jiraRest.profileFromSample(muestra.issues, { projectKey: 'ENG' })
    say(`perfil de ENG contado de ${perfil.sampled} incidencias (de ${muestra.total}) en ${muestra.ms} ms`, 'ok')
    say(`  tipos: ${perfil.types.map((t) => `${t.name} ${t.count}`).join(' · ')}`)
    say(`  estados: ${perfil.statuses.map((s) => `${s.name} ${s.count} (${s.category})`).join(' · ')}`)
    say(`  convenciones: ${perfil.prefixes.map((p) => `${p.pattern} ${p.count} (p. ej. ${p.examples[0]?.key})`).join(' · ')}`)
    const chips = searchChips({ product: 'jira', cloud: false, projectKey: 'ENG' }, { profile: perfil })
    say(`  chips que salen del perfil: ${chips.map((c) => c.label).join(' · ') || 'ninguno'}`)
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

    // 21. Una imagen se marca con un recuadro exterior, no con un Range: es
    //     la segunda mitad de la 20 («las imagenes con un recuadro fino»).
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
    // retiene—, y se iba sólo porque cada repintado por scroll recreaba el
    // rectángulo sin la clase. Desde H6 los nodos se REUTILIZAN, así que la
    // clase se quita a propósito al acabar la animación (`animationend`, con un
    // respaldo por tiempo): se espera a que termine y se comprueba lo mismo,
    // que es ahora una garantía y no un efecto secundario del scroll.
    await wait(1200)
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

    // Y no depende de por dónde esté mirando el usuario: lo que decide si un
    // bloque se ve es su sitio en el DOCUMENTO, no en la ventana. Pasó de
    // verdad al filtrar por cajas visibles: con la página desplazada se
    // perdían los primeros bloques, el título incluido.
    window.scrollTo(0, 3000)
    await wait(200)
    const conScroll = pageDigest()
    window.scrollTo(0, 0)
    await wait(200)
    ok(
      'digest: los bloques no dependen de por donde este el scroll',
      formatDigest(conScroll.blocks) === formatDigest(d1.blocks),
      `${conScroll.blocks.length} bloques desplazado · ${d1.blocks.length} arriba`
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

    // 34. Una incidencia de Jira en bloques: el título como h1, los campos,
    //     la descripción y los comentarios, y NADA de la interfaz —botones,
    //     pestañas, «Contraer el comentario», el editor, los paneles de
    //     integraciones ni la pestaña de campos que está oculta—.
    runner.clear()
    renderPage('issue:ENG-7')
    await wait(320)
    const dj1 = pageDigest()
    const dj2 = pageDigest()
    const textosJira = dj1.blocks.map((b) => b.text)
    const lineaJira = (i) => formatDigest(dj1.blocks).split('\n')[i]
    const interfaz = ['Editar', 'Añadir comentario', 'Asignar', 'Contraer', 'Main', 'Planning', 'Anclar', 'Suelte los archivos', 'Consejo de expertos', 'Sprint:', 'Git Integration', 'Create branch', '45196', 'Opciones']
    const colada = interfaz.filter((t) => textosJira.some((x) => x.includes(t)))
    ok(
      'jira: la incidencia en bloques empieza por su titulo y trae campos, descripcion y comentarios',
      formatDigest(dj1.blocks) === formatDigest(dj2.blocks) &&
        /^¶1 \[h1\] Rotar los tokens de servicio antes del despliegue de marzo$/.test(lineaJira(0)) &&
        dj1.blocks.some((b) => b.tag === 'h2' && b.text === 'Descripción') &&
        dj1.blocks.some((b) => b.tag === 'h2' && b.text === 'Actividad') &&
        dj1.blocks.some((b) => b.text === 'Tipo: Tarea') &&
        dj1.blocks.some((b) => b.text === 'Prioridad: Crítica') &&
        dj1.blocks.some((b) => b.text === 'Epic Link: Rotación de credenciales') &&
        dj1.blocks.some((b) => b.tag === 'p' && b.text.startsWith('Por política de seguridad el token expira')) &&
        dj1.blocks.some((b) => b.text === 'Ana Ruiz añadió un comentario - 14/ago/26 6:18 AM') &&
        dj1.blocks.some((b) => b.text.startsWith('El exportador de métricas heredado no admite recarga')) &&
        dj1.blocks.some((b) => b.text === 'Persona asignada:') &&
        dj1.blocks.some((b) => b.text.startsWith('relates to')),
      `${dj1.blocks.length} bloques · ${lineaJira(0)}`
    )
    ok('jira: la interfaz no entra en los bloques', colada.length === 0, colada.length ? 'se colo: ' + colada.join(', ') : `${dj1.blocks.length} bloques limpios`)

    // 36. Una cita que sólo existe en la interfaz o en una pestaña oculta no
    //     se marca: buscarla en toda la página la habría encontrado ahí y la
    //     tarjeta diría que está subrayada sin que se vea nada. Va aquí, entre
    //     la 34 y la 35, porque usa la incidencia que acaba de leer la 34; el
    //     número es el que CLAUDE.md le da.
    const fantasmas = [
      { n: 1, title: 'Cita de la interfaz', kind: '', anchor: { kind: 'text-quote', exact: 'Consejo de expertos', prefix: '', suffix: '' } },
      { n: 2, title: 'Cita de una pestaña oculta', kind: '', anchor: { kind: 'text-quote', exact: 'S37 Infra', prefix: '', suffix: '' } },
      { n: 3, title: 'Cita de la descripción', kind: '', anchor: { kind: 'text-quote', exact: 'sin ventana de corte', prefix: '', suffix: '' } },
    ]
    const resFantasma = await runner.applyNotes({ notes: fantasmas })
    await wait(300)
    ok(
      'jira: una cita que solo esta en la interfaz o en una pestana oculta no se marca',
      resFantasma.placed.join(',') === '3' && resFantasma.missed.sort().join(',') === '1,2',
      `puestas ${resFantasma.placed.join(',')} · sin anclar ${resFantasma.missed.join(',')}`
    )
    runner.clearNotes()

    // 35. Y se subraya igual que una página: la cita dentro de un párrafo de la
    //     descripción, un comentario entero y un campo, cada uno con su número.
    const notasJira = observacionesDeIncidencia(dj1)
    const resJira = await runner.applyNotes({ notes: notasJira })
    await wait(500)
    const estrategiaJira = (n) => resJira.detail?.find((x) => x.n === n)?.strategy || 'sin detalle'
    ok(
      'jira: tres marcas sobre la incidencia, en la descripcion, en un comentario y en un campo',
      resJira.placed.join(',') === '1,2,3' &&
        estrategiaJira(1) === 'block+quote' &&
        estrategiaJira(2) === 'block+whole' &&
        estrategiaJira(3) === 'block+whole' &&
        highlighted().includes('el token expira a los 90 días naturales') &&
        highlighted().some((t) => t.startsWith('El exportador de métricas heredado no admite')) &&
        highlighted().includes('Prioridad: Crítica') &&
        runner.overlay.el.noteLayer.children.length === 3,
      `puestas ${resJira.placed.join(',')} · ${[1, 2, 3].map(estrategiaJira).join(' ')} · ${highlighted().length} resaltados`
    )
    runner.clearNotes()

    // 37. Los campos de la incidencia: el tipo y el estado por su id (como en
    //     el Data Center real), lo demás por su etiqueta —también lo de la
    //     pestaña de campos oculta y el panel de personas—, y nada de la
    //     interfaz. En una página de Confluence, ninguno.
    const campos = jiraIssueFields()
    ok(
      'jira: los campos de la incidencia se leen por su id y por su etiqueta',
      !!campos &&
        campos.type === 'Tarea' &&
        campos.status === 'En curso' &&
        campos.priority === 'Crítica' &&
        campos.resolution === '' &&
        campos.assignee === 'Sin asignar' &&
        campos.reporter === 'Paulo Cabrita' &&
        campos.epic === 'Rotación de credenciales' &&
        campos.sprint === 'S37 Infra' &&
        campos.fixVersions.join('|') === 'Major Release Q4-2026' &&
        campos.affectsVersions.length === 0 &&
        campos.components.length === 0 &&
        campos.labels.join('|') === 'seguridad|tokens',
      campos ? `tipo ${campos.type} · estado ${campos.status} · ${campos.labels.length} etiquetas` : 'sin campos'
    )
    // Y un <dl> escrito en la descripción no es un campo: un «Estado:» de un
    // usuario no puede cambiar la fase del análisis.
    const dl = document.createElement('dl')
    dl.append(Object.assign(document.createElement('dt'), { textContent: 'Estado:' }), Object.assign(document.createElement('dd'), { textContent: 'Cerrada' }))
    document.querySelector('#description-val .user-content-block').appendChild(dl)
    const conDl = jiraIssueFields()
    dl.remove()
    ok('jira: un campo escrito en la descripcion no es un campo', conDl?.status === 'En curso', `estado ${conDl?.status}`)
    renderPage('page:200')
    await wait(320)
    ok('confluence: una página no tiene campos de incidencia', jiraIssueFields() === null)

    // 38. En la vista de incidencia de un Jira Data Center el que hace scroll
    //     es un panel interno, no la ventana: ir a una observación tiene que
    //     mover ESE panel. Pasó de verdad: las marcas se ponían y al pulsar
    //     cada hallazgo la página no se movía.
    renderPage('issue:ENG-7')
    await wait(320)
    const panel = document.getElementById('page-content')
    const estiloPanel = panel.getAttribute('style') || ''
    panel.setAttribute('style', 'height: 260px; overflow: auto')
    panel.scrollTop = 0
    const dPanel = pageDigest()
    const resPanel = await runner.applyNotes({ notes: observacionesDeIncidencia(dPanel) })
    await wait(400)
    panel.scrollTop = 0
    await wait(100)
    const focoPanel = await runner.focusNote({ n: 2 })
    await wait(500)
    const marca2 = runner.overlay.notes.find((x) => x.n === 2)?.ranges[0]?.getBoundingClientRect()
    const cajaPanel = panel.getBoundingClientRect()
    // La marca dentro del panel, y el panel dentro de la ventana: el de fuera
    // no puede pasarse de largo mientras el de dentro aún se mueve.
    const aLaVista = !!marca2 && marca2.top >= cajaPanel.top && marca2.bottom <= cajaPanel.bottom
    const panelALaVista = cajaPanel.top >= 0 && cajaPanel.bottom <= window.innerHeight
    ok(
      'jira: ir a una observacion desplaza el panel con scroll propio y deja el panel a la vista',
      resPanel.placed.includes(2) && focoPanel.ok && panel.scrollTop > 0 && aLaVista && panelALaVista,
      `scrollTop ${Math.round(panel.scrollTop)} · marca ${marca2 ? Math.round(marca2.top) + '-' + Math.round(marca2.bottom) : 'sin caja'} · panel ${Math.round(cajaPanel.top)}-${Math.round(cajaPanel.bottom)} · ventana ${window.innerHeight}`
    )
    runner.clearNotes()
    panel.setAttribute('style', estiloPanel)
    if (!estiloPanel) panel.removeAttribute('style')
    renderPage('page:200')
    await wait(320)

    // 39. La incidencia en bloques no depende de por dónde esté el scroll del
    //     PANEL interno (el 30 sólo mueve la ventana; el 38 pone el panel
    //     arriba antes de leer). Reproducido en la auditoría del 2026-09-13
    //     (docs/PLAN.md M1): `visibleRects` corregía sólo por el scroll de la
    //     ventana, con el panel abajo los bloques de arriba se daban por
    //     ocultos (33 → 6 → 0) y `applyNotes`, que relee la página con el panel
    //     donde esté, no casaba las observaciones de arriba.
    runner.clear()
    renderPage('issue:ENG-7')
    await wait(320)
    const panel39 = document.getElementById('page-content')
    const estilo39 = panel39.getAttribute('style') || ''
    panel39.setAttribute('style', 'height: 260px; overflow: auto')
    panel39.scrollTop = 0
    const conPanelArriba = pageDigest()
    panel39.scrollTop = panel39.scrollHeight
    await wait(60)
    const conPanelAbajo = pageDigest()
    ok(
      'jira: la incidencia en bloques no depende del scroll del panel interno',
      panel39.scrollTop > 0 &&
        conPanelArriba.blocks.length > 10 &&
        formatDigest(conPanelAbajo.blocks) === formatDigest(conPanelArriba.blocks),
      `${conPanelArriba.blocks.length} bloques arriba · ${conPanelAbajo.blocks.length} abajo · scrollTop ${Math.round(panel39.scrollTop)}`
    )
    // Y las marcas se ponen igual con el panel abajo que arriba: las mismas
    // observaciones, los mismos números puestos y por la misma estrategia.
    const notas39 = observacionesDeIncidencia(conPanelArriba)
    const estrategias39 = (r) => (r.detail || []).map((x) => `${x.n}:${x.strategy}`).join(' ')
    panel39.scrollTop = 0
    await wait(60)
    const marcasArriba = await runner.applyNotes({ notes: notas39 })
    await wait(300)
    runner.clearNotes()
    panel39.scrollTop = panel39.scrollHeight
    await wait(60)
    const marcasAbajo = await runner.applyNotes({ notes: notas39 })
    await wait(300)
    ok(
      'jira: las marcas se ponen igual con el panel interno abajo que arriba',
      marcasArriba.placed.join(',') === '1,2,3' &&
        marcasAbajo.placed.join(',') === '1,2,3' &&
        estrategias39(marcasAbajo) === estrategias39(marcasArriba),
      `arriba [${marcasArriba.placed}] ${estrategias39(marcasArriba)} · abajo [${marcasAbajo.placed}] ${estrategias39(marcasAbajo)}`
    )
    runner.clearNotes()
    panel39.setAttribute('style', estilo39)
    if (!estilo39) panel39.removeAttribute('style')
    renderPage('page:200')
    await wait(320)

    // 40. Escape vuelve a la página cuando Faro no tiene nada en marcha: con
    //     las marcas de un análisis puestas (son del panel: Escape no las borra
    //     a sus espaldas) y tras «Quitar las marcas». Sólo con algo en marcha
    //     —el foco de un recorrido, o el subrayado de una llegada por cita, que
    //     no es de nadie más— Escape es de Faro: lo quita y no llega a la
    //     página. Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md M2):
    //     desde la primera marca, ningún Escape llegaba ya a Jira/Confluence.
    runner.clear()
    const parrafo40 = document.querySelector('#page-content p')
    const escapeLlega = () => {
      let llego = false
      const oyente = (ev) => {
        if (ev.key === 'Escape') llego = true
      }
      document.body.addEventListener('keydown', oyente)
      parrafo40.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      document.body.removeEventListener('keydown', oyente)
      return llego
    }
    const res40 = await runner.applyNotes({ notes: observacionesPorBloques(pageDigest()) })
    await wait(300)
    const conMarcas = escapeLlega()
    const marcasSiguen = res40.placed.length > 0 && runner.overlay.notes.length === res40.placed.length
    runner.clearNotes()
    const sinMarcas = escapeLlega()
    const sueltoTrasQuitar = runner.overlay.onCancel === null
    ok(
      'escape: vuelve a la pagina con las marcas de un analisis puestas y tras quitarlas, sin borrar nada',
      conMarcas && marcasSiguen && sinMarcas && sueltoTrasQuitar,
      `con marcas ${conMarcas} (siguen ${marcasSiguen}) · sin marcas ${sinMarcas} (onCancel ${sueltoTrasQuitar ? 'null' : typeof runner.overlay.onCancel})`
    )

    //     El subrayado de una llegada por cita sí es de Faro mientras no haya
    //     marcas numeradas: el panel no guarda estado de él (sólo registra
    //     «Fragmento resaltado»), así que quitarlo con Escape no lo
    //     desincroniza, y es el único control que tiene el usuario porque en
    //     ese camino el foco se apaga antes de subrayar (revisión adversaria de
    //     H2, 2026-09-14: tras H2 esa tecla dejó de borrarlo).
    await runner.applyAnchor({ anchor: ANCHOR_QUOTE })
    await wait(200)
    runner.overlay.hideSpot()
    const citaPuesta = runner.overlay.quoteRanges.length > 0
    const conCita = escapeLlega()
    const citaQuitada = runner.overlay.quoteRanges.length === 0 && runner.overlay.onCancel === null
    ok(
      'escape: con la cita de una llegada y sin marcas numeradas, la quita y no llega a la pagina',
      citaPuesta && !conCita && citaQuitada,
      `cita puesta ${citaPuesta} · llego ${conCita} · quitada ${citaQuitada} (onCancel ${runner.overlay.onCancel === null ? 'null' : typeof runner.overlay.onCancel})`
    )
    runner.clear()
    runner.overlay.spotlight(parrafo40.getBoundingClientRect())
    let cancelado40 = ''
    runner.overlay.onCancel = (motivo) => {
      cancelado40 = motivo
      runner.overlay.clearAll()
    }
    const conFoco = escapeLlega()
    ok(
      'escape: con algo de Faro en marcha lo cancela y no llega a la pagina',
      !conFoco && cancelado40 === 'escape' && !runner.overlay.el.spot.classList.contains('on') && runner.overlay.onCancel === null,
      `llego ${conFoco} · cancelado «${cancelado40}» · foco ${runner.overlay.el.spot.classList.contains('on') ? 'encendido' : 'apagado'}`
    )
    renderPage('page:200')
    await wait(320)

    // 41. Las marcas no se recrean ni parpadean al hacer scroll (P1 de H6,
    //     docs/plan/anexo-E-eficiencia.md). El oyente de `scroll` está en
    //     window con captura, así que recibe el de la ventana y el de cada
    //     contenedor: decenas por gesto. Cada uno vaciaba la capa y volvía a
    //     crear todos los rectángulos, que nacen con `opacity: 0` y una
    //     transición de .4 s (styles.js), o sea que se apagaban y se volvían a
    //     encender una y otra vez mientras te desplazabas.
    runner.clear()
    renderPage('page:200')
    await wait(360)
    const res41 = await runner.applyNotes({ notes: observacionesPorBloques(pageDigest()) })
    // Sin prisa: `applyNotes` acaba desplazándose suavemente hasta la primera
    // marca, y ese desplazamiento dispara scrolls de verdad que contarían.
    await wait(700)

    const capa41 = runner.overlay.el.quoteLayer
    const antes41 = [...capa41.children]
    const caja41 = runner.overlay.notes.find((x) => x.n === 1)?.ranges[0]?.getClientRects()[0]
    runner.overlay.resetStats()
    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new Event('scroll'))
      treeScroller()?.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    await frame()
    await frame()

    const stats41 = runner.overlay.stats
    const despues41 = [...capa41.children]
    const mismos41 = despues41.length === antes41.length && antes41.every((n, i) => n === despues41[i])
    const encendidas41 = despues41.length > 0 && despues41.every((n) => n.classList.contains('on'))
    const sobreElTexto41 =
      !!caja41 &&
      despues41.length > 0 &&
      Math.abs(despues41[0].getBoundingClientRect().top - caja41.top) <= 2 &&
      Math.abs(despues41[0].getBoundingClientRect().left - caja41.left) <= 2
    ok(
      'las marcas no se recrean al hacer scroll: los mismos nodos, encendidos y sobre su texto',
      res41.placed.length > 0 && stats41.created === 0 && stats41.paints <= 2 && mismos41 && encendidas41 && sobreElTexto41,
      `${despues41.length} marcas · ${stats41.paints} repintado(s) · creados ${stats41.created} · reutilizados ${stats41.reused} · ` +
        `mismos nodos ${mismos41} · encendidas ${encendidas41} · sobre el texto ${sobreElTexto41}`
    )

    //     Y cuando el ancho cambia de verdad, el texto se reparte en otras
    //     líneas: ahí sí hay que crear o quitar rectángulos, y ninguno puede
    //     quedarse apagado ni en la posición vieja.
    const main41 = document.getElementById('page-content')
    const anchoAntes41 = main41.style.maxWidth
    main41.style.maxWidth = '420px'
    window.dispatchEvent(new Event('resize'))
    await frame()
    await frame()
    const trasAncho41 = [...capa41.children]
    const cajaAncho41 = runner.overlay.notes.find((x) => x.n === 1)?.ranges[0]?.getClientRects()[0]
    const alineada41 =
      !!cajaAncho41 &&
      trasAncho41.length > 0 &&
      Math.abs(trasAncho41[0].getBoundingClientRect().top - cajaAncho41.top) <= 2
    ok(
      'al cambiar el ancho las marcas se recolocan, sin quedarse apagadas ni en la posicion vieja',
      trasAncho41.length > 0 && trasAncho41.every((n) => n.classList.contains('on')) && alineada41,
      `${antes41.length} → ${trasAncho41.length} marcas · alineada ${alineada41}`
    )
    main41.style.maxWidth = anchoAntes41
    if (!main41.getAttribute('style')) main41.removeAttribute('style')
    window.dispatchEvent(new Event('resize'))
    await frame()
    await frame()

    //     Y cuando una pasada trae MENOS observaciones, los nodos que sobran se
    //     quitan de verdad. Desde P1 las capas ya no se vacían, así que la poda
    //     de `_syncNodes` es lo ÚNICO que borra una marca de la pantalla: sin
    //     ella, los rectángulos y las insignias de la pasada anterior se quedan
    //     encima del texto (y borrarla dejaba las pruebas en verde: revisión
    //     adversaria de H6). `annotate` se llama directo, que es lo que hace
    //     `focusNote` al re-resolver un Range muerto; `applyNotes` pasa antes
    //     por `clearNotes()` y ahí no habría nada que podar.
    const antesPoda41 = capa41.children.length
    const insigniasAntes41 = runner.overlay.el.noteLayer.children.length
    const menos41 = runner.overlay.notes.slice(0, 1)
    runner.overlay.resetStats()
    runner.overlay.annotate(menos41)
    await frame()
    await frame()
    const statsPoda41 = runner.overlay.stats
    const esperados41 = runner.overlay._measureGroups().reduce((n, m) => n + m.rects.length, 0)
    ok(
      'una pasada con menos observaciones quita de la pantalla los nodos que sobran',
      statsPoda41.removed > 0 &&
        statsPoda41.created === 0 &&
        capa41.children.length === esperados41 &&
        capa41.children.length < antesPoda41 &&
        runner.overlay.el.noteLayer.children.length === menos41.length,
      `rectángulos ${antesPoda41} → ${capa41.children.length} (esperados ${esperados41}) · ` +
        `insignias ${insigniasAntes41} → ${runner.overlay.el.noteLayer.children.length} · ` +
        `quitados ${statsPoda41.removed} · creados ${statsPoda41.created}`
    )
    runner.clearNotes()

    // 42. Una página larga de verdad: 347 bloques en vez de los veinte de un
    //     ADR. Se lee entera y sin recortar, y se marcan doce observaciones por
    //     los dos caminos que cuestan: seis con su bloque y seis que caen al
    //     peldaño global, que es el que recorría la página una vez por
    //     observación antes de P7. Los ms se apuntan SIN umbral: son de esta
    //     máquina, y sólo valen para comparar dos ejecuciones de la misma.
    renderPage('page:largo')
    await wait(400)
    const tiempos42 = []
    let dLargo = null
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      dLargo = pageDigest()
      tiempos42.push(performance.now() - t)
    }
    tiempos42.sort((a, b) => a - b)
    ok(
      'pagina larga: se lee entera en bloques, dentro de los topes de DIGEST_LIMITS',
      dLargo.blocks.length === LARGO.bloques &&
        !dLargo.truncated &&
        dLargo.blocks.length <= DIGEST_LIMITS.maxBlocks &&
        dLargo.chars <= DIGEST_LIMITS.maxChars,
      `${dLargo.blocks.length}/${LARGO.bloques} bloques · ${dLargo.chars}/${DIGEST_LIMITS.maxChars} caracteres · ` +
        `leer: mediana ${Math.round(tiempos42[1])} ms`
    )

    const res42 = await runner.applyNotes({ notes: observacionesDePaginaLarga(dLargo) })
    await wait(400)
    const estrategias42 = (res42.detail || []).map((x) => x.strategy)
    ok(
      'pagina larga: las doce observaciones se marcan, seis por su bloque y seis por la cita global',
      res42.placed.length === 12 &&
        estrategias42.filter((s) => s === 'block+quote').length === 6 &&
        estrategias42.filter((s) => s === 'global+quote').length === 6 &&
        Number.isFinite(res42.ms),
      `marcadas ${res42.placed.length}/12 en ${res42.ms} ms · ${estrategias42.join(' ')}`
    )
    runner.clearNotes()

    // 43. Resolver con el ámbito ya calculado da exactamente lo mismo que
    //     calculándolo dentro. Es lo único que P7 podía cambiar: `applyNotes`
    //     decide UNA vez qué es contenido y qué es interfaz y se lo pasa a cada
    //     observación, en vez de que cada una lo recalcule hasta tres veces.
    //     Sobre la incidencia, que es donde el ámbito no es la página entera.
    runner.clear()
    renderPage('issue:ENG-7')
    await wait(360)
    const ambito43 = digestScope()
    const digest43 = pageDigest({ scope: ambito43 })
    const notas43 = [
      ...observacionesDeIncidencia(digest43),
      {
        n: 4,
        title: 'Cita cuyo bloque ya no existe',
        kind: 'dato',
        anchor: { kind: 'block-quote', block: 999, hint: 'un bloque que no existe', exact: 'no admite recarga en caliente' },
      },
    ]
    const texto43 = (r) => (r.ranges?.[0] ? r.ranges[0].toString() : '')
    const conAmbito43 = notas43.map((x) => resolveBlockQuote(x.anchor, { digest: digest43, scope: ambito43 }))
    const sinAmbito43 = notas43.map((x) => resolveBlockQuote(x.anchor, { digest: digest43 }))
    const iguales43 = conAmbito43.every(
      (r, i) => r.strategy === sinAmbito43[i].strategy && texto43(r) === texto43(sinAmbito43[i])
    )
    ok(
      'resolver con el ambito ya calculado da lo mismo que calcularlo dentro, peldaño global incluido',
      iguales43 && conAmbito43.every((r) => r.ok) && conAmbito43[3].strategy.startsWith('global+'),
      conAmbito43.map((r, i) => `${i + 1}:${r.strategy}`).join(' ') +
        ' · sin ámbito ' +
        sinAmbito43.map((r) => r.strategy).join(' ')
    )

    //     Y que el ámbito compartido sirva de algo: `rootIndex` memoriza el
    //     índice de texto de cada raíz EN el ámbito (`scope._indices`), que es
    //     lo que evita recorrer la incidencia entera una vez por observación en
    //     el peldaño global. Con el ámbito compartido hay un índice por RAÍZ
    //     visitada, no uno por llamada: una segunda cita global no construye
    //     ninguno nuevo. Sin ámbito, cada llamada trae el suyo y no memoriza
    //     nada entre observaciones.
    const memoria43 = ambito43._indices
    const antesMemo43 = memoria43 ? memoria43.size : 0
    const otraGlobal43 = resolveBlockQuote(
      { kind: 'block-quote', block: 998, hint: 'un bloque que no existe', exact: 'no admite recarga en caliente' },
      { digest: digest43, scope: ambito43 }
    )
    const despuesMemo43 = ambito43._indices ? ambito43._indices.size : 0
    const raices43 = (ambito43.roots || []).length
    ok(
      'el indice de texto de cada raiz se memoriza en el ambito: una segunda cita global no reconstruye ninguno',
      antesMemo43 > 0 &&
        antesMemo43 <= raices43 &&
        despuesMemo43 === antesMemo43 &&
        otraGlobal43.ok &&
        otraGlobal43.strategy.startsWith('global+'),
      `${antesMemo43} indice(s) memorizado(s) para ${raices43} raices · tras la segunda cita ${despuesMemo43} · ${otraGlobal43.strategy}`
    )

    // ------------------------------------------------------------------
    // 44-49: el cimiento REST (H7). Nada de esto toca la página: son las
    // lecturas que la extensión hace con la sesión del navegador contra la API
    // del propio sitio, aquí contra la Jira y la Confluence de mentira de
    // tools/serve-harness.js (fixture harness/issues.json). Lo que se comprueba
    // es el TRANSPORTE entero —montar la ruta, pedirla, degradar cuando el
    // servidor dice que no, y devolver datos ya validados—, que es justo lo que
    // no se puede probar en Node.
    // ------------------------------------------------------------------

    // 44. Una consulta de PLANTILLA ejecutada contra la API del sitio: es lo que
    //     sustituye un turno del modelo por una petición de milisegundos. Lo que
    //     se espera no está escrito a mano: sale de la propia fixture.
    const jiraRest = await import('/src/shared/jira-rest.js')
    const confRest = await import('/src/shared/confluence-rest.js')
    const FIX = await (await fetch('/harness/issues.json')).json()
    const pedidasRest = []
    const pideApi = (u, o) => {
      pedidasRest.push(String(u))
      return fetch(u, o)
    }
    const sitioJira = { origin: location.origin, jiraPrefix: '', cloud: false }
    const sitioConf = { origin: location.origin, wikiPrefix: '/wiki', cloud: false }
    const CLAVES_FILA = 'assignee,components,epicKey,key,labels,lastViewedAt,parentKey,priority,reporter,status,statusCategory,summary,type,updatedAt'
    const vistas44 = FIX.issues
      .filter((i) => i.history)
      .sort((a, b) => a.lastViewedHoursAgo - b.lastViewedHoursAgo)
      .map((i) => i.key)
    const busca44 = await jiraRest.searchIssues(pideApi, sitioJira, jiraRest.historyJql(), { limit: 10 })
    ok(
      'una JQL de plantilla se ejecuta en la API del sitio y devuelve lo que dice la fixture, en su orden',
      busca44.ok &&
        busca44.issues.map((i) => i.key).join(',') === vistas44.join(',') &&
        busca44.via === 'jql' &&
        busca44.prefix === '' &&
        Number.isFinite(busca44.ms),
      busca44.ok ? `${busca44.issues.map((i) => i.key).join(' ')} · ${busca44.total} en total · ${busca44.ms} ms` : busca44.reason
    )
    const fila44 = busca44.issues?.[0] || {}
    ok(
      'cada fila llega con claves blancas: del JSON de Jira no se cuela ninguna',
      Object.keys(fila44).sort().join(',') === CLAVES_FILA &&
        fila44.statusCategory === 'indeterminate' &&
        fila44.assignee?.displayName === 'Ana Pérez' &&
        !('fields' in fila44),
      Object.keys(fila44).sort().join(' ')
    )

    // 45. Cuando la API dice que no. El mensaje es del SERVIDOR y se devuelve
    //     tal cual: Faro no decide qué está mal en una consulta, y una sesión
    //     que no vale no se confunde con una consulta mala.
    const mala45 = await jiraRest.searchIssues(pideApi, sitioJira, 'foo = 1')
    ok(
      'una JQL que el servidor rechaza vuelve con su motivo y su mensaje, no como lista vacía',
      !mala45.ok && mala45.reason === 'jql' && mala45.status === 400 && /Field 'foo' does not exist/.test(mala45.messages?.[0] || ''),
      `${mala45.reason} · ${(mala45.messages || []).join(' | ')}`
    )
    const sinSesion45 = await jiraRest.searchIssues(pideApi, sitioJira, jiraRest.sampleQuery('ENG'), { prefix: '/sinsesion' })
    ok(
      'sin sesión válida el motivo es la sesión, y el mensaje también viene del servidor',
      !sinSesion45.ok && sinSesion45.reason === 'sesion' && sinSesion45.status === 401 && /authenticated/i.test(sinSesion45.messages?.[0] || ''),
      `${sinSesion45.reason} · ${sinSesion45.status} · ${(sinSesion45.messages || []).join(' | ')}`
    )

    // 46. Las dos degradaciones, una vez cada una: una instancia que no tiene
    //     `lastViewed` (400) y una ruta de contexto que no es la suya (404). En
    //     las dos se acaba contestando, y se dice por dónde.
    const antes46 = pedidasRest.length
    const sinVista46 = await jiraRest.searchIssues(pideApi, sitioJira, jiraRest.historyJql(), { prefix: '/sinvista', limit: 10 })
    const ultima46 = decodeURIComponent(pedidasRest[pedidasRest.length - 1] || '')
    ok(
      'si la instancia no acepta lastViewed, se reintenta sin él —ni en el orden ni en los campos— y se dice que el orden es otro',
      sinVista46.ok &&
        sinVista46.via === 'updated' &&
        sinVista46.prefix === '/sinvista' &&
        pedidasRest.length === antes46 + 2 &&
        !/lastViewed/i.test(ultima46),
      `${sinVista46.via} · ${pedidasRest.length - antes46} peticiones`
    )
    const antes46b = pedidasRest.length
    const otraRuta46 = await jiraRest.searchIssues(pideApi, { ...sitioJira, jiraPrefix: '/jira' }, jiraRest.sampleQuery('OPS'), { limit: 3 })
    ok(
      'y si la ruta de contexto no es esa, se reintenta en la raíz una sola vez',
      otraRuta46.ok &&
        otraRuta46.prefix === '' &&
        otraRuta46.issues.length === 3 &&
        pedidasRest.length === antes46b + 2 &&
        pedidasRest[antes46b].includes('/jira/rest/api/2/search'),
      `${pedidasRest.length - antes46b} peticiones · prefijo «${otraRuta46.prefix}»`
    )

    // 47. El árbol ENTERO de un espacio leído de la lista de la API, paginado:
    //     es lo que sustituye las dos fases de modelo del indexador. El padre de
    //     cada página sale de `expand=ancestors`, no de que nadie lo adivine, y
    //     se comprueba contra la cadena que da la otra ruta de la misma API.
    const arbol47 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 5 })
    const porId47 = new Map((arbol47.pages || []).map((p) => [p.id, p]))
    const cadena47 = await confRest.fetchAncestors(pideApi, sitioConf, '1086')
    const padres47 = cadena47.ok ? cadena47.pages.map((p) => p.id) : []
    // Las peticiones no se escriben a mano: son las que hacen falta para las
    // páginas que trajo, de cinco en cinco. Así una página vacía de más, o un
    // `_links.next` que no acabe nunca, se ven aquí.
    const peticiones47 = Math.ceil((arbol47.pages || []).length / 5)
    ok(
      'el árbol del espacio se lee paginado y el padre de cada página es el que dice la API',
      arbol47.ok &&
        arbol47.pages.length === 20 &&
        arbol47.requests === peticiones47 &&
        !arbol47.truncated &&
        arbol47.homeId === '1' &&
        porId47.get('1')?.parentId === null &&
        padres47.length === 7 &&
        padres47.every((id, i) => i === 0 || porId47.get(id)?.parentId === padres47[i - 1]),
      arbol47.ok
        ? `${arbol47.pages.length} páginas en ${arbol47.requests} peticiones · portada ${arbol47.homeId} · cadena ${padres47.join('>')}`
        : arbol47.reason
    )
    const corto47 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 5, maxRequests: 3 })
    ok(
      'con tope de peticiones se para y lo dice: lo que quede se completa como hasta ahora',
      corto47.ok && corto47.requests === 3 && corto47.pages.length === 15 && corto47.truncated === true,
      `${corto47.pages.length} páginas · ${corto47.requests} peticiones · recortado ${corto47.truncated}`
    )

    // 48. Lo demás que se lee con la sesión: los filtros que el usuario tiene
    //     guardados en su Jira, los enlaces de una incidencia a páginas de
    //     Confluence y lo último que vio en el wiki.
    const filtros48 = await jiraRest.fetchFavouriteFilters(pideApi, sitioJira)
    ok(
      'los filtros favoritos vuelven con id, nombre y consulta, y nada más',
      filtros48.ok &&
        filtros48.filters.length === FIX.filters.length &&
        filtros48.filters.every((f) => Object.keys(f).sort().join(',') === 'id,jql,name') &&
        filtros48.filters[0].name === FIX.filters[0].name,
      filtros48.ok ? filtros48.filters.map((f) => f.name).join(' | ') : filtros48.reason
    )
    const enlaces48 = await jiraRest.fetchRemoteLinks(pideApi, sitioJira, 'ENG-7', { hosts: [location.hostname] })
    ok(
      'de los enlaces remotos sólo cuentan los que señalan una página de Confluence por id',
      enlaces48.ok && enlaces48.links.length === 1 && enlaces48.links[0].pageId === '200' && enlaces48.links[0].url.startsWith(location.origin),
      enlaces48.ok ? enlaces48.links.map((l) => `${l.pageId} ${l.title}`).join(' | ') : enlaces48.reason
    )
    const vistas48 = await confRest.searchContent(pideApi, sitioConf, confRest.viewedCql(3))
    ok(
      'y lo último que viste en el wiki llega con quién lo tocó y cuándo',
      vistas48.ok && vistas48.via === 'v1' && vistas48.pages.length === 3 && vistas48.pages.every((p) => p.updatedAt > 0 && p.updatedBy),
      vistas48.ok ? vistas48.pages.map((p) => `${p.id}:${p.updatedBy}`).join(' | ') : vistas48.reason
    )

    // 49. SEGURIDAD: ninguna de estas lecturas sale del sitio, y lo que no es
    //     una consulta de plantilla ni siquiera se pide.
    const fuera49 = pedidasRest.filter((u) => !u.startsWith(location.origin))
    ok(
      'ninguna de las lecturas de este tramo salió del origen del sitio',
      fuera49.length === 0 && pedidasRest.length > 10,
      `${pedidasRest.length} peticiones, todas a ${location.origin}`
    )
    const antes49 = pedidasRest.length
    const otroOrigen49 = await jiraRest.searchIssues(pideApi, { origin: location.origin + '/jira', cloud: false }, jiraRest.sampleQuery('ENG'))
    const libre49 = await confRest.searchContent(pideApi, sitioConf, 'type = page AND title ~ "lo que sea"')
    ok(
      'un origen que no es un origen y un CQL que no escribió una plantilla no piden nada',
      !otroOrigen49.ok &&
        otroOrigen49.reason === 'origen' &&
        !libre49.ok &&
        libre49.reason === 'consulta no permitida' &&
        pedidasRest.length === antes49,
      `${otroOrigen49.reason} · ${libre49.reason} · ${pedidasRest.length - antes49} peticiones`
    )

    // ------------------------------------------------------------------
    // 50: las búsquedas al instante (H8). Es el único tramo que junta las dos
    // mitades: lo que la extensión LEE de la pantalla (los campos de la
    // incidencia, con la clave de la épica sacada del enlace) y lo que hace con
    // ello (consultas que ejecuta ella misma contra la API del sitio). Ninguna
    // de las dos se puede probar sola en Node: una necesita DOM y la otra un
    // servidor que conteste como Jira.
    // ------------------------------------------------------------------

    // 50. Cada chip que sale de la incidencia que hay delante es EJECUTABLE: eso
    //     es lo que lo separa de una sugerencia en prosa. Y el que llama a una
    //     función que no es de Jira no se ejecuta aquí, porque acabaría en un 400
    //     del servidor.
    renderPage('issue:ENG-7')
    await wait(320)
    const { searchChips: chipsDe } = await import('/src/panel/search-chips.js')
    const { normalizeIssueFields } = await import('/src/panel/issue-profile.js')
    const campos50 = normalizeIssueFields(jiraIssueFields())
    const sitio50 = { product: 'jira', cloud: false, projectKey: 'ENG', issueKey: 'ENG-7' }
    const chips50 = chipsDe(sitio50, {
      issueFields: campos50,
      favouriteFilters: FIX.filters,
      recentJql: [{ jql: 'project = ENG AND labels = seguridad', at: 1, count: 4 }],
    })
    const epica50 = chips50.find((c) => c.kind === 'epica')
    ok(
      'la clave de la épica sale del enlace del campo, no de su nombre: con el nombre la consulta no encontraría nada',
      campos50?.epicKey === 'ENG-1' &&
        !!epica50 &&
        epica50.jql.includes('ENG-1') &&
        !/credenciales/i.test(epica50.jql) &&
        chips50.length > 1,
      `${chips50.length} chips · ${chips50.map((c) => c.kind).join(' ')} · ${epica50 ? epica50.jql : 'sin chip de épica'}`
    )

    const antes50 = pedidasRest.length
    const corridas50 = []
    for (const chip of chips50) corridas50.push({ chip, r: await jiraRest.searchIssues(pideApi, sitioJira, chip.jql, { limit: 5 }) })
    const filas50 = corridas50.flatMap(({ r }) => r.issues || [])
    ok(
      'cada chip se ejecuta en la API del sitio sin que ninguno dé un 400, y lo que vuelve son filas con claves blancas',
      corridas50.length === chips50.length &&
        corridas50.every(({ chip, r }) => chip.run && r.ok) &&
        pedidasRest.length === antes50 + chips50.length &&
        filas50.length > 0 &&
        filas50.every((f) => Object.keys(f).sort().join(',') === CLAVES_FILA),
      corridas50.map(({ chip, r }) => `${chip.kind}:${r.ok ? r.issues.length + ' de ' + r.total : 'FALLO ' + r.reason}`).join(' · ')
    )

    // Un filtro que el propio usuario guardó puede llamar a una función de un
    // complemento (ScriptRunner y compañía): es suya y sólo lee, pero la API de
    // Jira no la conoce. El chip se ofrece igual y se ABRE en Jira; si se
    // ejecutara aquí, esto es lo que contestaría el servidor.
    const plugin50 = { id: '9', name: 'ScriptRunner', jql: 'issueFunction in linkedIssuesOf("project = ENG")' }
    const conPlugin50 = chipsDe(sitio50, { favouriteFilters: [plugin50] }).find((c) => c.kind === 'filtro')
    const antes50b = pedidasRest.length
    const rechazada50 = await jiraRest.searchIssues(pideApi, sitioJira, plugin50.jql)
    ok(
      'una consulta con una función que no es de Jira no la ejecuta Faro, y el servidor la rechaza con SU mensaje',
      !!conPlugin50 &&
        conPlugin50.run === false &&
        /la abro en Jira/.test(conPlugin50.title) &&
        !rechazada50.ok &&
        rechazada50.reason === 'jql' &&
        rechazada50.status === 400 &&
        /linkedIssuesOf/.test(rechazada50.messages?.[0] || '') &&
        pedidasRest.length === antes50b + 1,
      `run=${conPlugin50?.run} · ${rechazada50.reason} · ${(rechazada50.messages || []).join(' | ')}`
    )

    // ------------------------------------------------------------------
    // 51-52: el mapa que se levanta sin gastar un turno (H9). Levantar el
    // contexto de un espacio eran TRES turnos del modelo —explorar, volcar el
    // índice y levantar el árbol—; el árbol lo dice exacto la lista paginada de
    // Confluence, y en Jira lo que hacía falta no era un árbol sino los nombres
    // de verdad del proyecto, que salen de contar una muestra.
    // No se pinta nada en la página ni se depende de un frame, como en 44-50, y
    // el panel no aparece; pero el 51 sí LEE la barra lateral, porque lo que hay
    // que comprobar es que el árbol que da la API sea el MISMO que el usuario
    // tiene delante: es por donde Faro le va a llevar, y eso no se puede
    // comprobar en Node.
    // ------------------------------------------------------------------

    // 51. El árbol del espacio leído de la API y pasado por las mismas
    //     validadoras que el índice del modelo dice de quién cuelga cada página
    //     lo mismo que se lee de la barra lateral. Nada está escrito a mano: los
    //     dos lados se leen al vuelo y se comparan entre sí.
    setSidebar('clasica')
    renderPage('page:200')
    await wait(320)
    // Con otro nombre porque `snapshotTree` ya está declarado arriba (tramo 15);
    // así este tramo no depende de que aquél siga existiendo.
    const { snapshotTree: leerBarra51 } = await import('/src/content/tree-scan.js')
    const { indexFromSpacePages } = await import('/src/panel/indexer.js')
    const arbol51 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 8 })
    const indice51 = indexFromSpacePages(arbol51.pages, {
      site: { host: location.hostname, cloud: false, wikiPrefix: '/wiki' },
      scope: { kind: 'space', key: 'ENG' },
      homeId: arbol51.homeId,
    })
    const deLaBarra51 = leerBarra51().pages
    const comunes51 = deLaBarra51.filter((p) => indice51?.pages?.[p.id])
    const otroPadre51 = comunes51.filter((p) => (indice51.pages[p.id].parentId || null) !== (p.parentId || null))
    ok(
      'el árbol que da la API dice de quién cuelga cada página lo mismo que la barra lateral, página a página',
      !!indice51 &&
        deLaBarra51.length > 10 &&
        comunes51.length === deLaBarra51.length &&
        otroPadre51.length === 0 &&
        arbol51.requests === Math.ceil(arbol51.pages.length / 8) &&
        !arbol51.truncated,
      `${comunes51.length} de ${deLaBarra51.length} páginas del árbol lateral · ${otroPadre51.length} con otro padre · ` +
        `${arbol51.pages.length} de la API en ${arbol51.requests} peticiones`
    )
    // La portada del espacio está por encima de todo en la API y NO es una rama
    // que se despliegue en la barra lateral: tiene que quedar como destino y no
    // como peldaño, o el paso a paso empezaría por algo que no se puede abrir.
    const hijasDeLaPortada51 = Object.values(indice51?.pages || {}).filter((p) => p.parentId === arbol51.homeId)
    const otraRuta51 = comunes51.filter((p) => indice51.pages[p.id].path !== p.url)
    ok(
      'la portada del espacio queda como destino pero no como peldaño, y la ruta de cada página es a la que enlaza el árbol',
      !!indice51?.pages?.[arbol51.homeId] &&
        indice51.pages[arbol51.homeId].parentId === null &&
        hijasDeLaPortada51.length === 0 &&
        otraRuta51.length === 0,
      `portada ${arbol51.homeId} · ${hijasDeLaPortada51.length} páginas colgadas de ella · ${otraRuta51.length} rutas distintas de las del árbol`
    )

    // 52. La muestra del proyecto, contada. Es lo que sustituye el «pregúntale
    //     al modelo qué tipos y estados hay»: se cuenta dos veces y da lo mismo,
    //     porque un perfil que cambiara solo no valdría para escribir consultas.
    const opciones52 = { limit: jiraRest.JIRA_REST_LIMITS.maxResults, fields: jiraRest.SAMPLE_FIELDS }
    const muestra52 = await jiraRest.searchIssues(pideApi, sitioJira, jiraRest.sampleQuery('ENG'), opciones52)
    const otraVez52 = await jiraRest.searchIssues(pideApi, sitioJira, jiraRest.sampleQuery('ENG'), opciones52)
    // El reloj se inyecta distinto a propósito: `at` es lo ÚNICO que puede
    // cambiar entre dos conteos de la misma muestra.
    const perfil52 = jiraRest.profileFromSample(muestra52.issues, { projectKey: 'ENG', now: 1 })
    const perfil52b = jiraRest.profileFromSample(otraVez52.issues, { projectKey: 'ENG', now: 2 })
    const sinFecha52 = (p) => JSON.stringify({ ...p, at: 0 })
    const deENG52 = FIX.issues.filter((i) => i.key.startsWith('ENG-'))
    ok(
      'contar la misma muestra dos veces da el mismo perfil, y lo contado cuadra con la fixture',
      muestra52.ok &&
        perfil52.sampled === deENG52.length &&
        sinFecha52(perfil52) === sinFecha52(perfil52b) &&
        perfil52.at !== perfil52b.at &&
        perfil52.types.reduce((n, t) => n + t.count, 0) === perfil52.sampled &&
        perfil52.statuses.every((s) => s.category) &&
        sinFecha52(jiraRest.normalizeProfile(perfil52)) === sinFecha52(perfil52),
      `${perfil52.sampled} incidencias · ${perfil52.types.length} tipos · ${perfil52.statuses.length} estados · ` +
        `convenciones ${perfil52.prefixes.map((p) => p.pattern).join(' ')}`
    )
    // SIN PERSONAS: el perfil es lo único de todo esto que acaba dentro de un
    // `system`, y la muestra ni siquiera pide quién es quién.
    const gente52 = Object.values(FIX.people || {})
    const enElPerfil52 = gente52.filter((quien) => JSON.stringify(perfil52).includes(quien))
    ok(
      'ni la muestra pide personas ni el perfil las lleva',
      !jiraRest.SAMPLE_FIELDS.includes('assignee') &&
        !jiraRest.SAMPLE_FIELDS.includes('reporter') &&
        muestra52.issues.every((i) => !i.assignee && !i.reporter) &&
        gente52.length > 0 &&
        enElPerfil52.length === 0,
      `${gente52.length} personas en la fixture, ${enElPerfil52.length} en el perfil · campos ${jiraRest.SAMPLE_FIELDS.join(',')}`
    )
    // Y con el perfil contado, los chips de estado que H8 dejó previstos tienen
    // por fin qué ofrecer: los nombres EXACTOS del flujo de este proyecto, no
    // los que el modelo supondría. Se ejecutan contra la API y cuadran con lo
    // que el perfil contó, porque la muestra cubre el proyecto entero.
    const chips52 = chipsDe({ product: 'jira', cloud: false, projectKey: 'ENG' }, { profile: perfil52 })
    const porEstado52 = chips52.filter((c) => c.kind === 'estado')
    const abiertos52 = perfil52.statuses.filter((s) => s.category !== 'done').slice(0, 2)
    const corridas52 = []
    for (const chip of porEstado52) {
      corridas52.push({ chip, r: await jiraRest.searchIssues(pideApi, sitioJira, chip.jql, { limit: 5 }) })
    }
    ok(
      'con el perfil contado, los chips de estado llevan los nombres exactos del proyecto y la API devuelve justo lo que el perfil contó',
      porEstado52.length === abiertos52.length &&
        abiertos52.every((s) => porEstado52.some((c) => c.jql.includes('"' + s.name + '"'))) &&
        perfil52.sampled === muestra52.total &&
        corridas52.length > 0 &&
        corridas52.every(({ chip, r }) => chip.run && r.ok) &&
        corridas52.every(({ chip, r }) => r.total === abiertos52.find((s) => chip.jql.includes('"' + s.name + '"'))?.count),
      corridas52.map(({ chip, r }) => `${chip.label} → ${r.ok ? r.total : 'FALLO ' + r.reason}`).join(' · ') ||
        'ningún chip de estado'
    )

    renderPage('page:200')
    await wait(320)

    runner.clear()
    const passed = results.filter((x) => x.pass).length
    say(`—— ${passed}/${results.length} comprobaciones ——`, passed === results.length ? 'ok' : 'bad')
    return { passed, total: results.length, results }
  },
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Un frame de pintado: lo que tarda el overlay en atender una ráfaga de scroll. */
function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()))
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
  jiraIssueFields,
  formatDigest,
  observacionesPorBloques,
  observacionesDeIncidencia,
  observacionesDePaginaLarga,
  // Una función y no el objeto: `resetStats()` lo sustituye, así que una
  // referencia guardada se quedaría contando lo de antes.
  overlayStats: () => runner.overlay.stats,
  // Los módulos REST de H7 y la fixture de la Jira de mentira, a demanda: el
  // banco no los necesita para pintar, y quien dirige el banco desde fuera
  // (H8-H11) los quiere enteros, no una copia envuelta aquí.
  jiraRest: () => import('/src/shared/jira-rest.js'),
  confluenceRest: () => import('/src/shared/confluence-rest.js'),
  issuesFixture: () => fetch('/harness/issues.json').then((r) => r.json()),
  // Y de H8, los chips: viven en src/panel/, así que aquí sólo se piden a
  // demanda como los módulos REST. Lo que el panel hace con ellos no se puede
  // probar en el banco (panel.js necesita `chrome.*`), pero QUÉ consultas
  // produce la pantalla y si son ejecutables, sí.
  searchChips: () => import('/src/panel/search-chips.js'),
  // Y de H9, el índice que se monta con lo que devuelve la API. Se expone por lo
  // mismo que los anteriores y por una razón más: en H7 la corrida completa se
  // quedó parada en un tramo que espera un frame y hubo que ejecutar SÓLO el
  // trozo REST a mano; con esto, el tramo 51 se puede repetir desde fuera sin
  // pasar por los cuarenta de antes.
  indexer: () => import('/src/panel/indexer.js'),
  treeScan: () => import('/src/content/tree-scan.js'),
}
say('banco listo')
