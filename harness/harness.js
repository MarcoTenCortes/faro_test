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
import { treeContainer, rowFor, toggleFor, treeScroller, describeTree } from '../src/content/tree-dom.js'
import { scrollWithinScrollers } from '../src/content/dom-utils.js'
import { pageIdFromDom } from '../src/content/page-id.js'
import { imagesWithin } from '../src/content/anchor.js'
import { Picker } from '../src/content/picker.js'
import { pageDigest, digestScope, resolveBlockQuote } from '../src/content/digest.js'
import { jiraIssueFields, jiraIssueKey } from '../src/content/jira-issue.js'
import { pageLinks, isOwnJiraRoute } from '../src/content/page-links.js'
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
      <p>Cada servicio necesita releer su credencial sin reiniciar. Los que no puedan hacerlo quedan documentados como excepción en el <a href="/wiki/spaces/ENG/pages/301/Runbook">runbook de guardia</a>.</p>
      <h3>Excepciones conocidas</h3>
      <p>El exportador de métricas heredado sigue con token fijo hasta que se retire, previsto para el próximo trimestre.</p>
      <h2>Seguimiento</h2>
      <p>El cumplimiento se revisa cada trimestre. Los incumplimientos se registran en <a href="/browse/ENG-7">el proyecto ENG</a>.</p>
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
                  <!-- El estado, donde lo pinta el Data Center real (H14): en el
                       botón de transiciones, con el nombre ENTERO dentro del
                       atributo title (que es HTML), el texto visible RECORTADO
                       por Jira y la categoría del flujo en la clase. Está en la
                       barra de acciones, o sea que es interfaz: su texto no entra
                       en ningún bloque y nadie lo pulsa (abre un menú). -->
                  <li id="opsbar-opsbar-transitions" class="aui-buttons pluggable-ops">
                    <a id="opsbar-transitions_more" class="aui-button aui-dropdown2-trigger opsbar-transitions__status-category_indeterminate"
                       role="button" aria-haspopup="true" aria-expanded="false" href="#"
                       title='<span class="jira-issue-status-tooltip-title">PENDING SECURITY SIGN-OFF</span><br><span class="jira-issue-status-tooltip-desc">El equipo de seguridad tiene que firmar la rotación</span>'>
                      <span class="dropdown-text">PENDING SECURITY S...</span>
                    </a>
                  </li>
                  <li><a href="#" class="tb-btn">Editar</a></li>
                  <li><a href="#" class="tb-btn">Añadir comentario</a></li>
                  <li><a href="#" class="tb-btn">Asignar</a></li>
                  <li><a href="#" class="tb-btn">Más</a></li>
                  <!-- Un enlace de verdad a Confluence, pero en la barra de
                       acciones: lo trae Jira en todas las incidencias, así que
                       no es una página que nadie haya elegido para ésta. -->
                  <li><a href="/wiki/spaces/ENG/pages/999/Ayuda" class="tb-btn">Ayuda</a></li>
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
                    <!-- Un campo VACÍO se pinta como texto, no se omite (H14): de
                         aquí salían un chip «Mismo componente «Ninguno»» que la
                         API rechaza con un 400 y un prompt que decía componentes
                         «Ninguno». Y el estado NO está aquí: en este Jira, como
                         en el real, vive en el botón de transiciones. -->
                    <li class="item item-right"><div class="wrap"><strong class="name">Componentes:</strong> <span id="components-val" class="value"> Ninguno </span></div></li>
                    <li class="item"><div class="wrap"><strong class="name">Prioridad:</strong> <span id="priority-val" class="value">Crítica</span></div></li>
                    <li class="item item-right"><div class="wrap"><strong class="name">Versión correctora:</strong> <span id="fixfor-val" class="value">Major Release Q4-2026</span></div></li>
                    <li class="item"><div class="wrap"><strong class="name">Etiquetas:</strong> <span class="value"><ul class="labels"><li><a href="#">seguridad</a></li><li><a href="#">tokens</a></li></ul></span></div></li>
                  </ul>
                  <ul class="tabs-menu"><li class="menu-item active-tab"><a href="#">Main</a></li><li class="menu-item"><a href="#">Planning</a></li></ul>
                  <div class="tabs-pane active-pane"><ul class="property-list"><li class="item"><div class="wrap"><strong class="name">Epic Link:</strong> <span class="value"><a class="issue-link" href="/browse/ENG-1">Rotación de credenciales</a></span></div></li></ul></div>
                  <div class="tabs-pane" style="display:none"><ul class="property-list"><li class="item"><div class="wrap"><strong class="name">Sprint:</strong> <span class="value"><a href="/wiki/spaces/ENG/pages/998/Sprint37">S37 Infra</a></span></div></li></ul></div>
                </div>
              </div>
              <div id="descriptionmodule" class="module toggle-wrap">
                <div class="mod-header"><h3 class="toggle-header">Descripción</h3><button class="aui-button toggle-title" type="button"><span>Contraer Descripción</span></button></div>
                <div class="mod-content"><a href="/wiki/spaces/ENG/pages/997/Plantilla" role="button" class="aui-button">Usar plantilla</a><div id="description-val" class="field-ignore-highlight"><div class="user-content-block">
                  <!-- Enlaces internos de Jira DELANTE de los de Confluence, como
                       en la épica real (H14): ahí eran 55 de los 60 que caben y
                       los de los comentarios no llegaban a leerse. No son páginas
                       y no cuentan para el tope. -->
                  <p>Depende de <a href="/browse/ENG-42">ENG-42</a> y el panel de administración lo expone en <a href="/rest/api/2/issue/ENG-7/remotelink">/rest/api/2/issue/ENG-7/remotelink</a>.</p>
                  <p><b>Objetivo:</b> rotar los <a href="/wiki/spaces/ENG/pages/200/ADR-014">tokens de servicio</a> de todos los componentes antes del despliegue de marzo, sin ventana de corte.</p>
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
                <div class="mod-content"><dl class="links-list"><dt>relates to</dt><dd><div class="link-content"><a href="/browse/ENG-8">ENG-8</a> Revisar permisos del exportador</div></dd></dl><dl class="links-list"><dt>mentioned in</dt><dd id="remote-10501" class="remote-link"><div class="link-content"><p><img alt="[Confluence] Page" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="> <span title="Runbook de guardia"><a class="link-title" target="_blank" href="/wiki/pages/viewpage.action?pageId=301">Runbook de guardia</a></span></p></div><div class="delete-link" id="delete_remote-10501"><a id="delete-link_remote-10501" href="/secure/DeleteRemoteIssueLink!default.jspa?remoteIssueLinkId=10501&amp;id=1007" title="Borrar este enlace"><span class="aui-icon">Borrar este enlace</span></a></div></dd></dl><dl class="links-list"><dt>Wiki Page</dt><dd class="remote-link"><div class="link-content"><a class="link-title" href="/display/ENG/Runbook+de+guardia">Runbook de guardia</a></div><div class="delete-link"><a href="/secure/DeleteRemoteIssueLink!default.jspa?remoteIssueLinkId=10500&amp;id=1007" title="Borrar este enlace"><span class="aui-icon">Borrar este enlace</span></a></div></dd></dl></div>
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
                        <div class="action-body flooded"><p>El exportador de métricas heredado no admite recarga en caliente: la rotación de su token tiene que ser a mano, en <a href="/wiki/spaces/ENG/pages/100/Arquitectura">ventana de mantenimiento</a>.</p></div>
                        <div class="action-links action-comment-actions"><button class="pinbutton" type="button">Anclar</button><a href="#">Editar</a><a href="#">Borrar</a></div>
                      </div>
                    </div>
                    <div id="comment-1002" class="issue-data-block activity-comment twixi-block expanded">
                      <div class="twixi-wrap verbose actionContainer">
                        <div class="action-head">
                          <button class="twixi icon-default" type="button"><span>Contraer el comentario: Marco</span></button>
                          <div class="action-details"><a class="user-hover" href="#">Marco</a> añadió un comentario - <span class="date">15/ago/26 9:02 AM</span></div>
                        </div>
                        <!-- H14: un enlace PEGADO, que es como llegan los de
                             Confluence en las incidencias reales: el texto del
                             <a> ES la URL, de 80 a 106 caracteres, así que la
                             sugerencia se llamaba como una URL. El título está
                             en el slug de la ruta. El href va relativo porque el
                             banco no sabe su propio origen al escribir la
                             fixture; el TEXTO es la URL tal como se pega. -->
                        <div class="action-body flooded"><p>De acuerdo. Entonces el criterio de «ningún servicio queda fuera» no se cumple para <a href="https://git.example.com/eng/exporter">el exportador</a>: hay que decirlo en la descripción.</p><p>Contexto: <a href="/wiki/spaces/ENG/pages/200/ADR-014">https://confluence.example.com/wiki/spaces/ENG/pages/200/ADR-014</a></p></div>
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
    // El pagetree de un Data Center deja la página abierta COMO ENLACE y sólo
    // marca su span (`marcarPagetreeActual`, más abajo). Cambiar el <a> por un
    // <span> es lo que hace Confluence Cloud, y lo que prueba el tramo 12.
    if (el.closest('.plugin_pagetree')) return
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
  marcarPagetreeActual(key)
  if (push && location.pathname !== page.path) history.pushState({ key }, '', page.path)
  document.title = page.title + (page.raw ? ' - Jira' : ' · Confluence')
  ponerIdDeLaPagina(page)
}

/**
 * La meta `ajs-page-id` al día, como la sirve un Confluence Data Center.
 *
 * El id sale de la RUTA de la página y no de la clave del banco: así
 * `page:largo` dice 900 —el id de su ruta— y una página de Jira o la portada de
 * un espacio se quedan sin id, que es lo que pasa de verdad. Con el contenido
 * vacío, `pageIdFromDom` devuelve '' (sólo acepta cifras), que es lo mismo que
 * si la meta no estuviera: se conserva el elemento para no andar metiéndolo y
 * sacándolo de la cabecera en cada render.
 */
function ponerIdDeLaPagina(page) {
  const meta = document.querySelector('meta[name="ajs-page-id"]')
  if (!meta) return
  const id = page.raw ? '' : /\/pages\/(\d+)\//.exec(page.path)?.[1] || ''
  meta.setAttribute('content', id)
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

// ------------------------------- la barra lateral «pagetree» (Data Center 9.2)
//
// La tercera forma, y la única que estaba ROTA: el pagetree clásico de un
// Confluence Server/Data Center. El marcado está copiado del Confluence 9.2 del
// usuario (F9 de la verificación en real, 2026-09-21), donde `treeContainer()`
// no encontraba nada y `describeTree()` contestaba «(ninguno) — sin contenedor
// no hay recorrido posible»: ni «Paso a paso» ni «Árbol leído de la página».
//
// Lo que tiene de distinto, y por lo que hace falta tenerla aquí:
//  - No hay `<aside>`, ni `role="tree"`, ni un solo `data-testid`: la barra es
//    un `div.ia-fixed-sidebar[role="complementary"]` y el árbol, un
//    `div.plugin_pagetree`.
//  - El que hace scroll es `.acs-side-bar.ia-scrollable-section`, no la barra.
//  - Cada fila es un `<li>` con su chevron aparte, que es un `<a href="">`
//    (sin dirección útil) con `role="button"` y el título en su `aria-label`.
//  - La página abierta SIGUE siendo un enlace: sólo su span se marca con
//    `plugin_pagetree_current` (las otras dos barras cambian el `<a>` por un
//    `<span>`, que es lo que hace Cloud y lo que prueba el tramo 12).
//  - Y las hijas NO están en el DOM hasta pulsar el chevron: llegan por AJAX.
//    Eso es lo que de verdad pone a prueba al ejecutor, porque un paso de
//    desplegar tiene que encontrar en el árbol una fila que todavía no existe.
//
// El árbol de páginas es el MISMO que el de la barra clásica, para que comparar
// lo que `snapshotTree()` lee de una con lo que lee de la otra signifique algo.
const PAGETREE = [
  { id: '100', kids: [{ id: '200' }, { id: '201' }] },
  { id: '300', kids: [{ id: '301' }] },
  { id: '400' },
  {
    id: '1080',
    kids: [
      {
        id: '1081',
        kids: [
          { id: '1082', kids: [{ id: '1083', kids: [{ id: '1084', kids: [{ id: '1085', kids: [{ id: '1086' }] }] }] }] },
        ],
      },
    ],
  },
]

/** Qué hijas le toca cargar a cada fila cuando se la despliegue. */
const pagetreePendientes = new WeakMap()
let pagetreeSeq = 0

/**
 * La dirección que pone el pagetree de un Confluence 9: `/spaces/KEY/pages/ID/
 * Slug` (sin `/wiki`) y con la consulta `?src=contextnavpagetreemode` detrás.
 * No es la ruta con la que el banco enruta —eso es `PAGES[...].path`—, y ahí
 * está la gracia: el paso se localiza por el `/pages/<id>/` que lleva dentro.
 */
function pagetreeHref(id) {
  return PAGES['page:' + id].path.replace(/^\/wiki/, '') + '?src=contextnavpagetreemode'
}

function pagetreeRow(nodo) {
  const page = PAGES['page:' + nodo.id]
  const sufijo = nodo.id + '-' + pagetreeSeq++
  const li = document.createElement('li')

  const cajaToggle = document.createElement('div')
  cajaToggle.className = 'plugin_pagetree_childtoggle_container'
  if (nodo.kids?.length) {
    const chevron = document.createElement('a')
    chevron.id = 'plusminus' + sufijo
    chevron.className = 'plugin_pagetree_childtoggle aui-icon aui-icon-small aui-iconfont-chevron-right'
    // Sin dirección útil, como el real: pulsarlo no navega, pide las hijas.
    chevron.setAttribute('href', '')
    chevron.setAttribute('role', 'button')
    chevron.setAttribute('tabindex', '0')
    chevron.setAttribute('data-type', 'toggle')
    chevron.setAttribute('data-page-id', nodo.id)
    chevron.setAttribute('aria-expanded', 'false')
    chevron.setAttribute('aria-label', 'Ampliar elemento ' + page.title)
    cajaToggle.appendChild(chevron)
  } else {
    const hoja = document.createElement('span')
    hoja.className = 'no-children icon'
    cajaToggle.appendChild(hoja)
  }
  li.appendChild(cajaToggle)

  const contenido = document.createElement('div')
  contenido.className = 'plugin_pagetree_children_content'
  const span = document.createElement('span')
  span.id = 'childrenspan' + sufijo
  span.className = 'plugin_pagetree_children_span'
  const a = document.createElement('a')
  a.setAttribute('href', pagetreeHref(nodo.id))
  a.dataset.nav = 'page:' + nodo.id
  a.textContent = page.title
  span.appendChild(a)
  contenido.appendChild(span)
  li.appendChild(contenido)

  const caja = document.createElement('div')
  caja.id = 'children' + sufijo
  caja.className = 'plugin_pagetree_children_container oculta'
  li.appendChild(caja)
  if (nodo.kids?.length) pagetreePendientes.set(li, nodo.kids)

  return li
}

/** Una hoja de relleno: sin ellas la barra no tiene scroll propio que probar. */
function pagetreeRelleno(i) {
  const li = document.createElement('li')
  const cajaToggle = document.createElement('div')
  cajaToggle.className = 'plugin_pagetree_childtoggle_container'
  const hoja = document.createElement('span')
  hoja.className = 'no-children icon'
  cajaToggle.appendChild(hoja)
  const contenido = document.createElement('div')
  contenido.className = 'plugin_pagetree_children_content'
  const span = document.createElement('span')
  span.className = 'plugin_pagetree_children_span'
  const a = document.createElement('a')
  a.setAttribute('href', '/spaces/ENG/pages/9' + String(i).padStart(3, '0') + '/Relleno')
  a.textContent = 'Otra página del espacio ' + i
  span.appendChild(a)
  contenido.appendChild(span)
  li.append(cajaToggle, contenido)
  return li
}

/**
 * El AJAX del pagetree: al pulsar el chevron, `aria-expanded` pasa a «true» y
 * el `ul` de las hijas aparece VACÍO y con `aria-busy`; las filas llegan un
 * momento después. Al plegar no se tiran: el real deja `data-children-loaded`
 * puesto y sólo las esconde, así que la segunda vez no hay petición.
 */
document.addEventListener('click', (ev) => {
  const chevron = ev.target.closest?.('.plugin_pagetree_childtoggle')
  if (!chevron) return
  ev.preventDefault()
  const fila = chevron.closest('li')
  const caja = fila?.querySelector(':scope > .plugin_pagetree_children_container')
  if (!caja) return

  if (chevron.getAttribute('aria-expanded') === 'true') {
    chevron.setAttribute('aria-expanded', 'false')
    caja.classList.add('oculta')
    return
  }
  chevron.setAttribute('aria-expanded', 'true')
  caja.classList.remove('oculta')
  if (chevron.dataset.childrenLoaded === 'true') return
  chevron.dataset.childrenLoaded = 'true'

  const ul = document.createElement('ul')
  ul.className = 'plugin_pagetree_children_list'
  ul.setAttribute('role', 'list')
  ul.setAttribute('aria-busy', 'true')
  caja.appendChild(ul)
  setTimeout(() => {
    for (const hijo of pagetreePendientes.get(fila) || []) ul.appendChild(pagetreeRow(hijo))
    ul.removeAttribute('aria-busy')
    marcarPagetreeActual()
  }, 180)
})

/** La página abierta del pagetree: sigue siendo enlace, sólo se marca su span. */
function marcarPagetreeActual(key = keyForPath(location.pathname)) {
  for (const span of document.querySelectorAll('.plugin_pagetree_children_span')) {
    const a = span.querySelector('a[data-nav]')
    span.classList.toggle('plugin_pagetree_current', !!a && a.dataset.nav === key)
  }
}

function buildPagetreeSidebar() {
  pagetreeSeq = 0
  // `sidebar` es la clase de maquetación del banco, y lo que `setSidebar` y
  // `renderPage` buscan; `ia-fixed-sidebar` y el rol son los del DC real.
  const fuera = document.createElement('div')
  fuera.className = 'sidebar pagetree ia-fixed-sidebar'
  fuera.setAttribute('role', 'complementary')
  fuera.setAttribute('aria-label', 'barra lateral del espacio Ingeniería')

  const scroll = document.createElement('div')
  scroll.className = 'acs-side-bar ia-scrollable-section'
  const contenido = document.createElement('div')
  contenido.className = 'acs-side-bar-content'
  const secundario = document.createElement('div')
  secundario.className = 'ia-secondary-container tipsy-enabled'
  const dentro = document.createElement('div')
  dentro.className = 'ia-secondary-content'

  const head = document.createElement('div')
  head.className = 'space-head'
  const avatar = document.createElement('span')
  avatar.className = 'space-avatar'
  avatar.textContent = 'EN'
  const enlace = document.createElement('a')
  enlace.setAttribute('href', '/spaces/ENG')
  enlace.dataset.nav = 'space:ENG'
  enlace.textContent = 'Ingeniería'
  head.append(avatar, enlace)

  const arbol = document.createElement('div')
  arbol.className = 'plugin_pagetree conf-macro output-inline'
  const raiz = document.createElement('ul')
  raiz.className = 'plugin_pagetree_children_list plugin_pagetree_children_list_noleftspace'
  raiz.setAttribute('role', 'list')
  for (const nodo of PAGETREE) raiz.appendChild(pagetreeRow(nodo))
  // Cuarenta hojas de relleno: el espacio real tiene 83 filas, y aquí hacen
  // falta suficientes para que `.acs-side-bar` desborde su alto y tenga scroll
  // propio de verdad — sin él no hay `treeScroller` que encontrar.
  for (let i = 1; i <= 40; i++) raiz.appendChild(pagetreeRelleno(i))
  arbol.appendChild(raiz)

  dentro.append(head, arbol)
  secundario.appendChild(dentro)
  contenido.appendChild(secundario)
  scroll.appendChild(contenido)
  fuera.appendChild(scroll)
  return fuera
}

let sidebarActual = 'clasica'
const SIDEBAR_CLASICA = document.querySelector('.sidebar')
/** El botón las recorre en círculo: las tres formas, una tras otra. */
const SIGUIENTE_SIDEBAR = { clasica: 'cloud', cloud: 'pagetree', pagetree: 'clasica' }

function setSidebar(cual) {
  if (cual === sidebarActual) return
  const viva = document.querySelector('.sidebar')
  const nueva = cual === 'cloud' ? buildCloudSidebar() : cual === 'pagetree' ? buildPagetreeSidebar() : SIDEBAR_CLASICA
  viva.replaceWith(nueva)
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

/**
 * El diario de actividad de mentira con el que se prueba «qué mirar hoy» (H11).
 *
 * Es la mitad que el servidor no tiene: cuándo miraste cada cosa, qué
 * analizaste y con cuántas observaciones, y qué página usas de base. Se
 * construye con el MÓDULO de verdad (`src/atlassian/activity.js`) y con el
 * reloj que se le pase, para que dos corridas den lo mismo; las cuatro entradas
 * están elegidas para que cada señal de `SIGNALS` dispare al menos una vez:
 *
 *  - la página 2003, vista cuatro veces (la sueles mirar) y cambiada después;
 *  - ENG-12, mirada hace 30 h y movida hace 24: cambió desde que la miraste;
 *  - ENG-7, analizada hace dos días con seis observaciones y movida después;
 *  - la página 200, que usas como página base y que alguien ha tocado.
 *
 * @param {object} actividad el módulo `activity.js`, que se importa a demanda
 * @param {number} ahora el reloj: todas las fechas cuelgan de él
 */
function diarioDeMentira(actividad, ahora) {
  const HORA = 3600000
  const DIA = 24 * HORA
  const host = location.hostname
  let diario = actividad.emptyActivity(host)
  // Cuatro visitas separadas: dentro de `dedupeMs` contarían como una sola.
  for (const dias of [5, 4, 3, 2]) {
    diario = actividad.recordVisit(
      diario,
      {
        kind: 'confluence-page',
        id: '2003',
        title: 'ACV Static - Identity Provider Service',
        path: '/wiki/spaces/ENG/pages/2003/ACV',
        at: ahora - dias * DIA,
      },
      { host, now: ahora }
    )
  }
  diario = actividad.recordVisit(
    diario,
    { kind: 'jira-issue', id: 'ENG-12', title: 'Cachear el catálogo de servicios', path: '/browse/ENG-12', at: ahora - 30 * HORA },
    { host, now: ahora }
  )
  diario = actividad.touchActivity(
    diario,
    { event: 'analyzed', kind: 'jira-issue', id: 'ENG-7', notes: 6, family: 'api', at: ahora - 2 * DIA },
    { host, now: ahora }
  )
  diario = actividad.touchActivity(diario, { event: 'source', kind: 'confluence-page', id: '200', at: ahora - 3 * DIA }, { host, now: ahora })
  return diario
}

/**
 * Los DOS espacios de la Confluence de mentira (ENG y OPS, H21) leídos por la
 * API como los lee el panel —cada uno con su `fetchSpacePages` y su
 * `indexFromSpacePages`— y fundidos en UN índice con `mergeIndex`, que es lo que
 * pasa en un host en el que se han indexado dos espacios. Lo usan la acción
 * «Dos espacios…» y el tramo 63, para que los dos digan lo mismo.
 *
 * Qué páginas tiene cada espacio NO se escribe aquí: se pregunta a la LISTA de
 * cada espacio (`/rest/api/content?spaceKey=…`), que es otra ruta de la misma
 * API, y con eso se compara lo que dio la búsqueda por fecha.
 *
 * @param {Function} pide el `fetch` con el que se pide (el tramo lo cuenta)
 * @param {{limitEng?: number, limitOps?: number}} opts el tamaño de página de cada lectura
 */
async function leerDosEspacios(pide, { limitEng = 25, limitOps = 8 } = {}) {
  const confRest = await import('/src/shared/confluence-rest.js')
  const { indexFromSpacePages } = await import('/src/panel/indexer.js')
  const { mergeIndex } = await import('/src/atlassian/index-store.js')
  const sitioConf = { origin: location.origin, wikiPrefix: '/wiki', cloud: false }
  const site = { host: location.hostname, cloud: false, wikiPrefix: '/wiki' }
  const leer = async (clave, limit) => {
    const arbol = await confRest.fetchSpacePages(pide, sitioConf, clave, { limit })
    const indice = arbol.ok
      ? indexFromSpacePages(arbol.pages, { site, scope: { kind: 'space', key: clave }, homeId: arbol.homeId })
      : null
    const lista = await (await pide(`${location.origin}/wiki/rest/api/content?spaceKey=${clave}&type=page&limit=200`)).json()
    const ids = (confRest.parseSpacePages(lista, '/wiki')?.pages || []).map((p) => p.id)
    return { arbol, indice, ids }
  }
  const eng = await leer('ENG', limitEng)
  const ops = await leer('OPS', limitOps)
  // En el orden en que un usuario los indexaría: primero el que ya tenía, luego
  // el nuevo. `mergeIndex` es lo mismo que hace `generateContext` al guardar.
  const fundido = eng.indice && ops.indice ? mergeIndex(eng.indice, ops.indice) : null
  return { eng, ops, fundido }
}

/** Una página del índice como la ve el paso a paso: quién es, de quién cuelga, a dónde lleva y de qué espacio es. */
function firmaDePaginas(indice) {
  return Object.values(indice?.pages || {})
    .map((p) => `${p.id}|${p.parentId ?? '-'}|${p.path}|${p.spaceKey ?? '-'}`)
    .sort()
    .join(' ')
}

/** Los ids que nombran unas líneas de `treeTitles` («- «Título» (id N)»). */
function idsDeTitulos(lineas) {
  return lineas.map((l) => /\(id (\d+)\)$/.exec(l)?.[1]).filter(Boolean)
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
    setSidebar(SIGUIENTE_SIDEBAR[sidebarActual])
    // Se dice con qué contenedor se queda `treeContainer()`: es lo único que
    // distinguía a la barra que estaba rota, y así se ve de un vistazo.
    const cont = treeContainer()
    const nombre = cont ? cont.className.split(' ')[0] || cont.tagName.toLowerCase() : '(ninguno)'
    say(`barra lateral: ${sidebarActual} · contenedor: ${nombre}`)
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
    // Desde H14 se dice cuántas de cuántas y por dónde: el árbol son las páginas
    // más recientes del espacio, no todas, y con la lista de antes serían las más
    // viejas (F8).
    say(
      `índice del espacio ENG por la API: ${arbol.own} de ${arbol.total} páginas` +
        ` (${entradas} entradas con antepasados) en ${arbol.requests} peticiones vía ${arbol.via}` +
        `${arbol.truncated ? ' · recortado' : ''} · ${arbol.ms} ms`,
      entradas ? 'ok' : 'bad'
    )
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
    // Con el id de cada tipo y de cada estado (H14): el nombre lo devuelve la API
    // traducido al idioma del usuario y una consulta JQL sólo acepta el id.
    say(`  tipos: ${perfil.types.map((t) => `${t.name} ${t.count} (id ${t.id || '—'})`).join(' · ')}`)
    say(`  estados: ${perfil.statuses.map((s) => `${s.name} ${s.count} (${s.category}, id ${s.id || '—'})`).join(' · ')}`)
    say(`  convenciones: ${perfil.prefixes.map((p) => `${p.pattern} ${p.count} (p. ej. ${p.examples[0]?.key})`).join(' · ')}`)
    const chips = searchChips({ product: 'jira', cloud: false, projectKey: 'ENG' }, { profile: perfil })
    say(`  chips que salen del perfil: ${chips.map((c) => `${c.label} [${c.jql}]`).join(' · ') || 'ninguno'}`)
  },

  /**
   * De dónde sale una página base sugerida (H10): los enlaces que esta página
   * o esta incidencia tienen EN SU CONTENIDO, cuáles de ellos llevan a una
   * página que se puede añadir y cuáles se descartan.
   *
   * Es la acción que enseña por qué la sección «Sugeridas» no le pregunta nada
   * al modelo: todo lo que pinta está aquí, en la pantalla y en la API del
   * propio sitio.
   */
  async links() {
    const enlaces = pageLinks()
    const clave = jiraIssueKey(document, location.href)
    say(`${enlaces.length} enlaces en el contenido${clave ? ' de ' + clave : ' de esta página'}`)
    for (const l of enlaces) say(`  [${l.where}] ${l.text} → ${l.href}`)
    // Y los que NO son una página porque son de Jira (H14): en una épica real
    // eran 55 de los 60 que caben y dejaban fuera los de los comentarios.
    const deJira = [...document.querySelectorAll('#page-content a[href]')].filter((a) => isOwnJiraRoute(a.getAttribute('href'), location.href))
    if (deJira.length) say(`  ${deJira.length} enlaces a rutas propias de Jira, que no son páginas: ${deJira.slice(0, 4).map((a) => a.getAttribute('href')).join(' · ')}`)
    if (!enlaces.length) return say('no hay enlaces en el contenido de esta página', 'bad')

    const jiraRest = await import('/src/shared/jira-rest.js')
    const { confluenceLinksIn } = await import('/src/panel/source-suggest.js')
    const { normalizeIndex } = await import('/src/atlassian/index-store.js')
    const indice = normalizeIndex(
      {
        pages: Object.entries(PAGES)
          .map(([k, p]) => ({ id: k.replace('page:', ''), title: p.title, spaceKey: 'ENG', url: p.path }))
          .filter((p) => /^\d+$/.test(p.id)),
      },
      location.hostname,
      { kind: 'space', key: 'ENG' },
      { wikiPrefix: '/wiki' }
    )
    let remoto = null
    if (clave) {
      remoto = await jiraRest.fetchRemoteLinks((u, o) => fetch(u, o), { origin: location.origin, jiraPrefix: '', cloud: false }, clave, {
        hosts: [location.hostname],
      })
      say(remoto.ok ? `remotos: ${remoto.links.length} a Confluence` : `remotos: ${remoto.reason}`, remoto.ok ? 'ok' : 'bad')
      // H14: y con qué título los manda la API. En el Jira real es «Page» en
      // todos —el nombre del TIPO de enlace—, así que aquí sale vacío y el
      // título de abajo tiene que venir de otra parte.
      if (remoto.ok) for (const l of remoto.links) say(`  remoto ${l.pageId} · título que da la API: «${l.title}»`)
    }
    const site = { host: location.hostname, origin: location.origin, product: clave ? 'jira' : 'confluence', cloud: false }
    const quedan = confluenceLinksIn(enlaces, remoto, { site, linkedHost: location.hostname, index: indice })
    say(`${quedan.length} llevan a una página que se puede añadir:`, quedan.length ? 'ok' : 'bad')
    for (const c of quedan) say(`  ${c.id} · ${c.title} · desde ${c.where}`)
    const fuera = enlaces.length - quedan.length
    say(`${fuera} descartados: otro producto, otro host o sin id que se pueda resolver con el índice`)
  },

  /**
   * «Qué mirar hoy» de punta a punta (H11), sin panel y sin modelo: lo que
   * contestan las API del sitio, cruzado con un diario de mentira, puntuado y
   * explicado.
   *
   * Es la acción que enseña de dónde sale cada fila: la mitad del servidor
   * (cuándo cambió) no dice nada por sí sola, y la mitad local (cuándo lo
   * miraste tú, qué analizaste) no la tiene nadie más. Se ve porque la misma
   * lista se ordena dos veces, con diario y sin él.
   */
  async today() {
    const jiraRest = await import('/src/shared/jira-rest.js')
    const confRest = await import('/src/shared/confluence-rest.js')
    const actividad = await import('/src/atlassian/activity.js')
    const hoy = await import('/src/panel/today.js')
    const pide = (u, o) => fetch(u, o)
    const sitioJira = { origin: location.origin, jiraPrefix: '', cloud: false }
    const sitioConf = { origin: location.origin, wikiPrefix: '/wiki', cloud: false }

    // La mitad local empieza aquí: lo que se apuntaría de la página que hay
    // delante. En un Data Center el id no está en la URL, sólo en el DOM.
    const visita = actividad.visitFromUrl(location.href, { title: document.title, pageId: pageIdFromDom() })
    say(
      visita
        ? `de esta página se apuntaría: ${visita.kind} ${visita.id} · ruta «${visita.path}» · «${visita.title}»`
        : 'de esta página no se apunta nada: no es una incidencia ni una página con id',
      visita ? 'ok' : ''
    )

    const lecturas = []
    for (const [kind, jql] of Object.entries({
      history: jiraRest.historyJql(),
      mine: jiraRest.mineJql(hoy.TODAY_LIMITS.daysMine),
      project: jiraRest.projectJql('ENG', hoy.TODAY_LIMITS.daysProject),
      related: jiraRest.relatedJql('ENG-7'),
    })) {
      const r = await jiraRest.searchIssues(pide, sitioJira, jql, { limit: 20 })
      say(`  jira/${kind} → ${r.ok ? r.issues.length + ' incidencias en ' + r.ms + ' ms' : 'sin lista: ' + r.reason}`, r.ok ? 'ok' : 'bad')
      if (r.ok) lecturas.push({ product: 'jira', host: location.hostname, kind, items: r.issues })
    }
    const vistas = await confRest.searchContent(pide, sitioConf, confRest.viewedCql(10))
    say(`  confluence/viewed → ${vistas.ok ? vistas.pages.length + ' páginas en ' + vistas.ms + ' ms' : 'sin lista: ' + vistas.reason}`, vistas.ok ? 'ok' : 'bad')
    if (vistas.ok) lecturas.push({ product: 'confluence', host: location.hostname, kind: 'viewed', items: vistas.pages })

    const ahora = Date.now()
    const diario = diarioDeMentira(actividad, ahora)
    const preferidas = actividad.preferredFamilies(diario, { now: ahora })
    const candidatos = hoy.buildCandidates({ reads: lecturas, activity: { [location.hostname]: diario }, here: null, now: ahora })
    const filas = hoy.rankToday(candidatos, { here: null, index: null, preferred: preferidas, now: ahora })
    say(`${candidatos.length} candidatos → ${filas.length} filas · familias que más analizas: ${preferidas.join(', ') || '(ninguna)'}`, 'ok')
    for (const f of filas) say(`  [${f.group}] ${f.kind === 'jira-issue' ? f.id : 'página ' + f.id} · ${f.score} · ${f.title}`)
    for (const f of filas) say(`      ${f.id}: ${f.why}`)

    // Y lo mismo sin el diario: es la comparación que dice qué aporta la mitad
    // que sólo tiene Faro.
    const sinDiario = hoy.rankToday(hoy.buildCandidates({ reads: lecturas, activity: {}, here: null, now: ahora }), { now: ahora })
    const conCambios = (lista) => lista.filter((f) => f.group === 'cambio').length
    say(
      `sin el diario la lista es otra: ${conCambios(filas)} filas «cambió desde que lo miraste» con él, ${conCambios(sinDiario)} sin él`,
      conCambios(filas) > conCambios(sinDiario) ? 'ok' : 'bad'
    )
  },

  /**
   * Un host con DOS espacios indexados (H21): ENG y OPS leídos por la API y
   * fundidos en un índice, y lo que el panel saca de ahí por espacio —el
   * subíndice de cada uno, sus títulos para el indexador, si tiene mapa— más el
   * paso a paso desde ENG hasta una página de OPS, que empieza por abrir ese
   * espacio. Es la acción que enseña por qué el mapa es por espacio: con los dos
   * fundidos a pelo, los títulos que se le dan al indexador de OPS llevarían
   * medio árbol de ENG.
   */
  async multiSpace() {
    setSidebar('clasica')
    renderPage('page:200')
    await wait(320)
    const { subIndex, stampSpace, hasMap, emptyContexts, withContext, countPages } = await import('/src/shared/scopes.js')
    const { treeTitles } = await import('/src/panel/prompts.js')
    const { validatePlan } = await import('/src/nav/validate.js')
    const { ancestryOf, normalizeIndex } = await import('/src/atlassian/index-store.js')
    const { snapshotTree } = await import('/src/content/tree-scan.js')

    const { eng, ops, fundido } = await leerDosEspacios((u, o) => fetch(u, o))
    if (!fundido) return say(`sin índice: ENG ${eng.arbol.reason || 'ok'} · OPS ${ops.arbol.reason || 'ok'}`, 'bad')
    const cuenta = countPages(fundido)
    say(`índice fundido: ${cuenta.pages} páginas de ${cuenta.spaces} espacios`, 'ok')
    for (const [clave, leido] of [['ENG', eng], ['OPS', ops]]) {
      const sub = subIndex(fundido, clave)
      say(
        `  ${clave}: ${leido.arbol.own} de ${leido.arbol.total} por la API en ${leido.arbol.requests} peticiones · ` +
          `${Object.keys(sub.pages).length} en su subíndice · portada ${leido.arbol.homeId} · mapa sin construir ${hasMap(emptyContexts(), fundido, 'space:' + clave)} · construido ${hasMap(withContext(emptyContexts(), 'space:' + clave, { text: 'x', indexedAt: Date.now() }), fundido, 'space:' + clave)}`,
        'ok'
      )
    }
    const titulosOps = treeTitles(subIndex(fundido, 'OPS'))
    say(`títulos para el indexador de OPS (${titulosOps.length}):`)
    for (const l of titulosOps) say('  ' + l)
    const ajenos = idsDeTitulos(treeTitles(fundido)).filter((id) => !ops.ids.includes(id))
    say(`con el índice fundido a pelo irían además ${ajenos.length} páginas de ENG`, ajenos.length ? '' : 'bad')

    const hoja = Object.keys(subIndex(fundido, 'OPS').pages).sort((a, b) => ancestryOf(fundido, b).length - ancestryOf(fundido, a).length)[0]
    const plan = validatePlan(
      { navigate: true, mode: 'assisted', destination: { kind: 'confluence-page', id: hoja } },
      { index: fundido, origin: ORIGIN, here: ORIGIN + PAGES['page:200'].path, site: { product: 'confluence', cloud: false, host: location.hostname } }
    )
    say(
      plan.ok
        ? `desde ENG hasta la ${hoja} de OPS: ${plan.plan.steps.map((s) => `${s.label} (${s.action})`).join(' → ')}`
        : `sin plan: ${plan.reason}`,
      plan.ok ? 'ok' : 'bad'
    )

    const barra = normalizeIndex({ pages: snapshotTree().pages, updated: Date.now() }, location.hostname, null, { cloud: false, wikiPrefix: '/wiki' })
    const estampada = stampSpace(barra, 'ENG')
    const conEspacio = Object.values(estampada.pages).filter((p) => p.spaceKey === 'ENG').length
    say(`barra lateral: ${Object.keys(barra.pages).length} filas, ${conEspacio} estampadas con ENG`, conEspacio ? 'ok' : 'bad')
  },

  // El botón se llama por su `data-act` («multi-space», como los demás en
  // kebab); `multiSpace` es el nombre por el que se llama desde fuera
  // (`faroHarness.actions.multiSpace()`). Un alias y no dos copias.
  'multi-space'() {
    return actions.multiSpace()
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
    // Lo resaltado en la página. Desde H23 el relleno vive en DOS highlights
    // disjuntos (overlay.js, `_setHighlight`): `faro-quote` con todas las marcas
    // menos la activa y `faro-quote-activa` con la activa, porque dos rellenos
    // traslúcidos sobre la misma letra se apilan. Lo resaltado es la UNIÓN: sin
    // ella, la 24 (tres marcas, una activa) contaría dos.
    const highlighted = () => {
      const rangos = new Set()
      for (const nombre of ['faro-quote', 'faro-quote-activa']) {
        const h = CSS.highlights.get(nombre)
        if (h) for (const r of h) rangos.add(r)
      }
      return [...rangos].map((r) => r.toString())
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

    // 20. El otro estilo de resaltado: subrayado con la tinta, sin oscurecer, y
    //     las imagenes con un recuadro fino. Hasta H23 era «en amarillo»; desde
    //     entonces el relleno y el trazo son de la tinta que elige el usuario
    //     (azul por defecto, ámbar a elegir), y el nombre lo dice.
    setSidebar('clasica')
    renderPage('page:2003')
    await wait(320)
    runner.clear()
    runner.setHighlightStyle('marker')
    const rMarker = await runner.applyAnchor({ anchor: { kind: 'text-quote', exact: 'genera y renueva credenciales' } })
    await wait(700)
    const hostOverlay = document.getElementById('faro-overlay-host')
    ok(
      'modo subrayado: marca el texto con la tinta y no oscurece la pagina',
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
    // H23: mientras se señala, el cursor es el subrayador de cursor.js —una URL
    // `data:`, nunca un recurso de la extensión, que dejaría a la vista de la
    // página la dirección que `use_dynamic_url` esconde (S7)— con `text` de
    // respaldo detrás; y la selección azul vive en la misma hoja, sólo bajo
    // `html.faro-picking`. Se lee mientras dura, y se comprueba abajo.
    const cursorSenalando = getComputedStyle(document.documentElement).cursor
    const hojaSenalar = document.getElementById('faro-pick-style')?.textContent || ''

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

    const cursorAlAcabar = getComputedStyle(document.documentElement).cursor
    ok(
      'señalar: el cursor es el subrayador, una imagen data: con el de texto de respaldo, y se va al acabar',
      cursorSenalando.startsWith('url(') &&
        cursorSenalando.includes('data:image/svg+xml') &&
        cursorSenalando.includes(', text') &&
        !cursorAlAcabar.startsWith('url('),
      `${cursorSenalando.slice(0, 34)}…${cursorSenalando.slice(-14)} (${cursorSenalando.length} caracteres) · al acabar «${cursorAlAcabar}»`
    )
    ok(
      'señalar: la seleccion azul vive solo bajo html.faro-picking, sin la direccion de la extension',
      hojaSenalar.includes('html.faro-picking ::selection') && !hojaSenalar.includes('chrome-extension://'),
      `#faro-pick-style ${hojaSenalar.length} caracteres · ${(hojaSenalar.match(/::selection/g) || []).length} ::selection · ` +
        `chrome-extension:// ${hojaSenalar.includes('chrome-extension://') ? 'SÍ' : 'no'}`
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

    // La insignia va DETRÁS de su cita, no encima ni en el margen. Desde H23
    // (forma A, anexo 2-F) en SUPERÍNDICE: a 1 px del último carácter y 5 px por
    // encima de la línea (overlay.js, `_paintNoteBadges`). Mide 13 px, así que
    // acaba en `top + 8` y no baja de la mitad del carácter que sigue. Hasta la
    // revisión adversaria de H23 medía 16 y subía 8, y medido en este banco se
    // metía 6-10 px en la caja del carácter de la línea de ARRIBA (A2); antes de
    // H23 iba centrada en la línea (`right + 3`, `top + height / 2 - 8.5`) y
    // tapaba las primeras letras de la palabra siguiente. Lo que tapa hoy, por
    // delante y por arriba, lo mide el tramo 64. Aquí se tolera 1 px en `left` y
    // en `top`: el único error es el `Math.round` de overlay.js, ≤ 0,5 + 1/64
    // (medido ≤ 0,34), y con 3 una vuelta a `right + 3` pasaba, y una a −8
    // (|Δ| 2,66-3,34) pasaba dos de cada tres veces.
    const rangoUno = runner.overlay.notes.find((x) => x.n === 1)?.ranges[0]
    const finDeLaCita = [...(rangoUno?.getClientRects() || [])].pop()
    const insigniaUno = insignias[0]
    ok(
      'la insignia va justo detras del ultimo caracter de su cita',
      !!finDeLaCita &&
        Math.abs(parseFloat(insigniaUno.style.left) - (finDeLaCita.right + 1)) <= 1 &&
        Math.abs(parseFloat(insigniaUno.style.top) - Math.max(0, finDeLaCita.top - 5)) <= 1,
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

    // Y ninguna caja se solapa con otra: dos trazos no se apilan (hasta H23,
    // era el amarillo lo que se apilaba a manchas).
    let solapes = 0
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        const a = cajas[i].getBoundingClientRect()
        const b = cajas[j].getBoundingClientRect()
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) solapes++
      }
    }
    ok('codigo: las marcas no se apilan unas sobre otras', solapes === 0, solapes + ' solapes')

    // La animación sólo corre mientras dibuja. Hasta H23 era un barrido blanco
    // que vivía siempre, aparcado en translateX(-110%) —o en +110% al acabar,
    // que `forwards` retiene—, y se iba sólo porque cada repintado por scroll
    // recreaba el rectángulo sin la clase; desde H6 los nodos se REUTILIZAN, así
    // que la clase se quita a propósito al acabar la animación (`animationend`,
    // con un respaldo por tiempo). Desde H23 (forma A) el `::after` ES el trazo
    // de tinta y existe siempre: lo que tiene que irse es la ANIMACIÓN, no el
    // pseudo. Se espera a que termine («se dibuja» dura .45 s, escalonado 40 ms
    // por caja) y se comprueba que ninguna caja se queda con `sweep`, que su
    // `::after` ya no anima y que sigue ahí con los 2 px del trazo (3 hasta la
    // revisión adversaria de H23, que midió que tapaba 1,5-2,3 de los 3 px de
    // los descendentes con Segoe 14: G03).
    await wait(1200)
    const conSweep = cajas.filter((d) => d.classList.contains('sweep')).length
    const animaciones = cajas.map((d) => getComputedStyle(d, '::after').animationName)
    const trazos = cajas.map((d) => getComputedStyle(d, '::after').height)
    ok(
      'codigo: el barrido no se queda aparcado y el trazo sigue dibujado',
      cajas.length > 0 && conSweep === 0 && animaciones.every((a) => a === 'none') && trazos.every((h) => h === '2px'),
      `${conSweep} con sweep · animación ${animaciones.join(' ')} · trazo ${trazos.join(' ')}`
    )

    // 27. El bloque de código con scroll horizontal propio: el navegador recorta
    //     su texto, así que la marca tiene que recortarse igual. Sin esto se
    //     quedaba pintada donde estaba el texto, fuera del bloque.
    const preCode = document.querySelector('#page-content pre.code')
    preCode.style.maxWidth = '160px'
    preCode.scrollLeft = 90
    preCode.dispatchEvent(new Event('scroll', { bubbles: true }))
    // Desde H6 el overlay atiende el scroll en el frame siguiente, y en un
    // navegador sin foco ese frame puede tardar medio segundo (medido: 505 ms en
    // el Browser pane, con el repintado correcto a los 535): 320 ms fijos daban
    // un fallo que era del entorno. Se espera AL FRAME —el del overlay se pidió
    // antes, así que corre antes que éste— con un tope, porque con la página
    // oculta no hay frames y la espera no volvería nunca.
    await Promise.race([frame(), wait(1500)])
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
    // «Ayuda» y «Usar plantilla» son de H10: dos enlaces a Confluence puestos a
    // propósito en la interfaz (la barra de acciones y un botón del módulo de
    // descripción). Los lee el 53 para comprobar que NO salen como enlaces de
    // la incidencia; aquí, que tampoco se cuelan en los bloques.
    // «PENDING SECURITY S...» es de H14: el estado vive en el botón de
    // transiciones, que está en la barra de acciones. Su texto no es un bloque
    // —y además viene recortado por Jira—; el nombre entero lo lee el 37 del
    // atributo `title`.
    const interfaz = ['Editar', 'Añadir comentario', 'Asignar', 'Contraer', 'Main', 'Planning', 'Anclar', 'Suelte los archivos', 'Consejo de expertos', 'Sprint:', 'Git Integration', 'Create branch', '45196', 'Opciones', 'Ayuda', 'Usar plantilla', 'PENDING SECURITY']
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

    // 37. Los campos de la incidencia: el tipo por su id, el ESTADO donde lo
    //     pinta el Data Center real —el botón de transiciones, con el nombre
    //     entero dentro del `title` y la categoría en la clase—, y lo demás por
    //     su etiqueta, también lo de la pestaña de campos oculta y el panel de
    //     personas. Nada de la interfaz. En una página de Confluence, ninguno.
    const campos = jiraIssueFields()
    ok(
      'jira: los campos de la incidencia se leen por su id y por su etiqueta',
      !!campos &&
        campos.type === 'Tarea' &&
        campos.priority === 'Crítica' &&
        campos.resolution === '' &&
        campos.assignee === 'Sin asignar' &&
        campos.reporter === 'Paulo Cabrita' &&
        campos.epic === 'Rotación de credenciales' &&
        campos.sprint === 'S37 Infra' &&
        campos.fixVersions.join('|') === 'Major Release Q4-2026' &&
        campos.affectsVersions.length === 0 &&
        campos.labels.join('|') === 'seguridad|tokens',
      campos ? `tipo ${campos.type} · estado ${campos.status} · ${campos.labels.length} etiquetas` : 'sin campos'
    )
    // H14: el estado ENTERO sale del `title` del botón de transiciones y NO de
    // su texto visible, que Jira recorta él mismo («PENDING SECURITY S...»).
    // Pasó de verdad: en el Jira del usuario no hay `#status-val` ni pastilla de
    // estado en ninguna parte, y el análisis se quedaba sin estado y sin fase.
    const boton37 = document.getElementById('opsbar-transitions_more')
    const visible37 = (boton37?.querySelector('.dropdown-text')?.textContent || '').trim()
    const { issuePhase: fase37, normalizeIssueFields: normal37 } = await import('/src/panel/issue-profile.js')
    ok(
      'jira: el estado sale entero del title del boton de transiciones, y su categoria de la clase',
      campos?.status === 'PENDING SECURITY SIGN-OFF' &&
        visible37.endsWith('...') &&
        campos.status !== visible37 &&
        !/</.test(campos.status) &&
        campos.statusCategory === 'indeterminate' &&
        // Y por eso hay fase: por nombre, un estado a medida no dice nada.
        fase37(campos.status) === '' &&
        fase37(campos.status, campos.statusCategory) === 'en-curso',
      `estado «${campos?.status}» · categoría ${campos?.statusCategory} · visible «${visible37}» · fase ${fase37(campos?.status, campos?.statusCategory) || '(ninguna)'}`
    )
    // H14: un campo VACÍO se pinta como texto («Ninguno»), y eso no es un valor.
    // La barrera es la del panel, que es por donde pasa todo lo que llega de la
    // pantalla antes de un prompt o de una consulta: sin ella salía un chip
    // «Mismo componente «Ninguno»» que la API rechaza con un 400.
    const normalizados37 = normal37(campos)
    ok(
      'jira: «Ninguno» se lee de la pantalla tal cual y la barrera del panel lo tira',
      campos.components.join('|') === 'Ninguno' &&
        normalizados37.components.length === 0 &&
        normalizados37.labels.join('|') === 'seguridad|tokens' &&
        normalizados37.status === 'PENDING SECURITY SIGN-OFF' &&
        normalizados37.statusCategory === 'indeterminate',
      `pantalla «${campos.components.join(', ')}» → panel ${normalizados37.components.length} componentes`
    )
    // Y donde SÍ están los selectores de siempre, mandan ellos y en su orden:
    // otras instalaciones tienen `#status-val`, y el botón es sólo el respaldo.
    const val37 = document.createElement('span')
    val37.id = 'status-val'
    val37.className = 'value'
    val37.textContent = 'En curso'
    document.querySelector('#details-module .mod-content')?.appendChild(val37)
    const conVal37 = jiraIssueFields()
    val37.remove()
    ok(
      'jira: con el campo de estado de siempre delante, manda el de siempre',
      conVal37?.status === 'En curso' && conVal37?.statusCategory === 'indeterminate',
      `estado ${conVal37?.status} · categoría ${conVal37?.statusCategory}`
    )
    // Y un <dl> escrito en la descripción no es un campo: un «Estado:» de un
    // usuario no puede cambiar la fase del análisis.
    const dl = document.createElement('dl')
    dl.append(Object.assign(document.createElement('dt'), { textContent: 'Estado:' }), Object.assign(document.createElement('dd'), { textContent: 'Cerrada' }))
    document.querySelector('#description-val .user-content-block').appendChild(dl)
    const conDl = jiraIssueFields()
    dl.remove()
    ok('jira: un campo escrito en la descripcion no es un campo', conDl?.status === 'PENDING SECURITY SIGN-OFF', `estado ${conDl?.status}`)
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
    // `typeId`, `statusId` y `priorityId` desde H14: el nombre viene traducido al
    // idioma del usuario y el id es lo único con lo que se puede preguntar.
    const CLAVES_FILA =
      'assignee,components,epicKey,key,labels,lastViewedAt,parentKey,priority,priorityId,reporter,status,statusCategory,statusId,summary,type,typeId,updatedAt'
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
    const digitos44 = [fila44.typeId, fila44.statusId, fila44.priorityId].every((id) => /^\d+$/.test(String(id)))
    ok(
      'cada fila llega con claves blancas —y con el id de tipo, estado y prioridad— sin que del JSON de Jira se cuele ninguna',
      Object.keys(fila44).sort().join(',') === CLAVES_FILA &&
        fila44.statusCategory === 'indeterminate' &&
        fila44.assignee?.displayName === 'Ana Pérez' &&
        digitos44 &&
        !('fields' in fila44),
      `${Object.keys(fila44).sort().join(' ')} · ids ${fila44.typeId}/${fila44.statusId}/${fila44.priorityId}`
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

    // 47. El árbol de un espacio leído de la API, paginado: es lo que sustituye
    //     las dos fases de modelo del indexador. Desde H14 se lee por la
    //     BÚSQUEDA ordenada por fecha —las más recientes primero, porque la
    //     lista da las más viejas y en un espacio de verdad el tope se gastaba
    //     en páginas de hace años (F8)—, y el padre de cada página sale de
    //     `expand=ancestors`, no de que nadie lo adivine: se comprueba contra la
    //     cadena que da la otra ruta de la misma API.
    const arbol47 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 5 })
    const porId47 = new Map((arbol47.pages || []).map((p) => [p.id, p]))
    const cadena47 = await confRest.fetchAncestors(pideApi, sitioConf, '1086')
    const padres47 = cadena47.ok ? cadena47.pages.map((p) => p.id) : []
    // Las peticiones no se escriben a mano: la de la portada más las que hacen
    // falta para las páginas propias que trajo, de cinco en cinco. Así una
    // página vacía de más, o un `_links.next` que no acabe nunca, se ven aquí.
    const peticiones47 = 1 + Math.ceil((arbol47.own || 0) / 5)
    ok(
      'el árbol del espacio se lee por fecha y el padre de cada página es el que dice la API',
      arbol47.ok &&
        arbol47.via === 'busqueda' &&
        arbol47.own === 20 &&
        arbol47.total === 20 &&
        arbol47.requests === peticiones47 &&
        !arbol47.truncated &&
        arbol47.homeId === '1' &&
        porId47.get('1')?.parentId === null &&
        padres47.length === 7 &&
        padres47.every((id, i) => i === 0 || porId47.get(id)?.parentId === padres47[i - 1]),
      arbol47.ok
        ? `${arbol47.own} de ${arbol47.total} páginas (${arbol47.pages.length} con antepasados) en ${arbol47.requests} peticiones ` +
          `vía ${arbol47.via} · portada ${arbol47.homeId} · cadena ${padres47.join('>')}`
        : arbol47.reason
    )
    // Leyendo las más recientes, los padres casi nunca están entre ellas: entran
    // como antepasados. Lo que no puede pasar es que una página quede con la
    // cadena a medias, porque entonces no habría por dónde empezar a llevar a
    // nadie.
    const raizDe47 = (p) => {
      let cur = p
      const vistos = new Set()
      while (cur?.parentId && !vistos.has(cur.id)) {
        vistos.add(cur.id)
        cur = porId47.get(cur.parentId)
      }
      return cur && !cur.parentId ? cur.id : ''
    }
    const rotas47 = (arbol47.pages || []).filter((p) => !raizDe47(p))
    ok(
      'cada página incluida trae su cadena entera: subiendo por parentId se llega siempre a una raíz del árbol',
      arbol47.ok && rotas47.length === 0 && raizDe47(porId47.get('1086')) === '1',
      `${(arbol47.pages || []).length} páginas · ${rotas47.length} con la cadena a medias · la 1086 sube hasta ${raizDe47(porId47.get('1086'))}`
    )
    const corto47 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 5, maxRequests: 3 })
    ok(
      'con tope de peticiones se para y dice cuántas de cuántas: lo que quede se completa como hasta ahora',
      corto47.ok &&
        corto47.requests === 3 &&
        corto47.own === 5 * (corto47.requests - 1) &&
        corto47.pages.length >= corto47.own &&
        corto47.total === 20 &&
        corto47.truncated === true,
      `${corto47.own} de ${corto47.total} páginas (${corto47.pages.length} con antepasados) · ${corto47.requests} peticiones · recortado ${corto47.truncated}`
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
    // H14: el título que manda este Jira es «Page» —el nombre del TIPO de enlace,
    // lo que se vio en los quince enlaces remotos del Jira real—, y ése no es el
    // nombre de la página: llega vacío y lo busca el panel donde sí está (el
    // índice, el texto del enlace del DOM o el slug de la ruta). Cuál es el
    // genérico no se escribe aquí: lo dice la fixture.
    const generico48 = FIX.remoteLinks['ENG-7'][0].object.title
    ok(
      'de los enlaces remotos sólo cuentan los que señalan una página por id, y «Page» no es un título',
      enlaces48.ok &&
        enlaces48.links.length === 1 &&
        enlaces48.links[0].pageId === '301' &&
        enlaces48.links[0].url.startsWith(location.origin) &&
        generico48 === 'Page' &&
        enlaces48.links[0].title === '',
      enlaces48.ok ? enlaces48.links.map((l) => `${l.pageId} «${l.title}» (la API dice «${generico48}»)`).join(' | ') : enlaces48.reason
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
        arbol51.requests === 1 + Math.ceil(arbol51.own / 8) &&
        !arbol51.truncated,
      `${comunes51.length} de ${deLaBarra51.length} páginas del árbol lateral · ${otroPadre51.length} con otro padre · ` +
        `${arbol51.own} de la API (${arbol51.pages.length} con antepasados) en ${arbol51.requests} peticiones`
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
    // por fin qué ofrecer: los estados de verdad del flujo de este proyecto, no
    // los que el modelo supondría. Desde H14 la consulta va por el ID que el
    // perfil guardó —el nombre viene traducido y JQL lo rechaza— y la etiqueta
    // sigue enseñando el nombre. Se ejecutan contra la API y cuadran con lo que el
    // perfil contó, porque la muestra cubre el proyecto entero.
    const chips52 = chipsDe({ product: 'jira', cloud: false, projectKey: 'ENG' }, { profile: perfil52 })
    const porEstado52 = chips52.filter((c) => c.kind === 'estado')
    const abiertos52 = perfil52.statuses.filter((s) => s.category !== 'done').slice(0, 2)
    const corridas52 = []
    for (const chip of porEstado52) {
      corridas52.push({ chip, r: await jiraRest.searchIssues(pideApi, sitioJira, chip.jql, { limit: 5 }) })
    }
    const deSuEstado52 = (chip) => abiertos52.find((s) => s.id && chip.jql.endsWith('status = ' + s.id))
    ok(
      'con el perfil contado, los chips de estado preguntan por el id de cada estado y la API devuelve justo lo que el perfil contó',
      porEstado52.length === abiertos52.length &&
        abiertos52.every((s) => !!s.id && porEstado52.some((c) => c.jql.endsWith('status = ' + s.id))) &&
        porEstado52.every((c) => !/status = "/.test(c.jql)) &&
        porEstado52.every((c) => abiertos52.some((s) => c.label.includes('«' + s.name + '»'))) &&
        perfil52.sampled === muestra52.total &&
        corridas52.length > 0 &&
        corridas52.every(({ chip, r }) => chip.run && r.ok) &&
        corridas52.every(({ chip, r }) => r.total === deSuEstado52(chip)?.count),
      corridas52.map(({ chip, r }) => `${chip.label} [${chip.jql}] → ${r.ok ? r.total : 'FALLO ' + r.reason}`).join(' · ') ||
        'ningún chip de estado'
    )

    // Y por qué el id y no el nombre: el que la API DEVUELVE está traducido al
    // idioma del usuario y JQL lo rechaza con un 400. Cuál está traducido no se
    // escribe a mano: lo dice la fixture, y el nombre que el perfil contó es
    // justamente ése.
    const traducido52 = (FIX.catalog?.status || []).find((e) => e.display && e.display !== e.name)
    const contado52 = perfil52.statuses.find((s) => s.name === traducido52?.display)
    const porNombre52 = await jiraRest.searchIssues(pideApi, sitioJira, `project = ENG AND status = ${jiraRest.jqlQuote(traducido52?.display || '')}`, {
      limit: 5,
    })
    const porIdDeEse52 = await jiraRest.searchIssues(pideApi, sitioJira, `project = ENG AND status = ${contado52?.id || 'x'}`, { limit: 5 })
    ok(
      'el nombre de estado que la API devuelve viene traducido y la consulta con él la rechaza el SERVIDOR; con el id que el perfil guardó, la misma consulta contesta',
      !!traducido52 &&
        !!contado52?.id &&
        !porNombre52.ok &&
        porNombre52.reason === 'jql' &&
        porNombre52.status === 400 &&
        /no existe para el campo/.test(porNombre52.messages?.[0] || '') &&
        porIdDeEse52.ok &&
        porIdDeEse52.total === contado52.count,
      `«${traducido52?.display}» (JQL lo llama «${traducido52?.name}») → ${porNombre52.ok ? 'la aceptó' : (porNombre52.messages || []).join(' | ')} · ` +
        `id ${contado52?.id} → ${porIdDeEse52.ok ? porIdDeEse52.total + ' de ' + contado52?.count + ' contadas' : 'FALLO ' + porIdDeEse52.reason}`
    )

    // El otro lado del mismo problema: el TIPO se lee de la pantalla (el DOM da el
    // nombre y nada más) y el id lo tiene el perfil. Que las dos mitades casen no
    // se puede probar en Node: una necesita el DOM de la incidencia y la otra un
    // servidor que conteste como Jira. `campos50` es lo que el tramo 50 leyó de
    // `issue:ENG-7`.
    const sugeridas52 = jiraRest.suggestedQueries({ site: sitio50, issue: campos50, profile: perfil52 })
    const chipTipo52 = sugeridas52.find((c) => c.kind === 'tipo')
    const tipoDelPerfil52 = perfil52.types.find((t) => t.name === campos50?.type)
    const corridaTipo52 = chipTipo52 ? await jiraRest.searchIssues(pideApi, sitioJira, chipTipo52.jql, { limit: 5 }) : null
    ok(
      'el tipo que se lee de la pantalla se cruza con el perfil por su nombre para preguntar por el id, y la API contesta',
      !!chipTipo52 &&
        !!tipoDelPerfil52?.id &&
        chipTipo52.jql.includes('issuetype = ' + tipoDelPerfil52.id) &&
        !chipTipo52.jql.includes('"' + campos50.type + '"') &&
        !!corridaTipo52?.ok &&
        corridaTipo52.issues.length > 0,
      `pantalla «${campos50?.type}» → perfil id ${tipoDelPerfil52?.id} · ${chipTipo52?.jql} → ` +
        `${corridaTipo52?.ok ? corridaTipo52.issues.length + ' de ' + corridaTipo52.total : 'FALLO ' + corridaTipo52?.reason}`
    )

    // ------------------------------------------------------------------
    // 53-55: las páginas base que Faro propone sin preguntarle al modelo
    // (H10). De dónde salen es lo que hay que comprobar aquí: los enlaces que
    // la incidencia o la página tienen EN SU CONTENIDO —no en su interfaz, no
    // en una pestaña que no se ve—, que es justo lo que `page-links.js` no
    // puede probar en Node; y, con ellos, el historial y el contexto, la lista
    // que la pantalla ofrecerá. Ninguna de las tres fuentes gasta un token.
    // ------------------------------------------------------------------

    // 53. Los enlaces de una incidencia, con la parte de la que vienen. La
    //     descripción, el módulo de enlaces y los comentarios sí; la barra de
    //     acciones, el botón del módulo y la pestaña de campos plegada no,
    //     aunque los tres enlacen a Confluence a propósito en la fixture.
    runner.clear()
    renderPage('issue:ENG-7')
    await wait(320)
    const enlaces53 = pageLinks()
    const otraVez53 = pageLinks()
    // La URL entera si es de fuera, y la ruta si es de aquí: así se lee.
    const corto53 = (l) => l.href.replace(location.origin, '') + ' ' + l.where
    const mapa53 = enlaces53.map(corto53).sort().join(' | ')
    // El módulo de enlaces trae el enlace remoto con la forma del Jira real
    // (`dt` «mentioned in» + `a.link-title` con `pageId` y el título de verdad)
    // y, detrás, el `/display/` sin id de H10: dos enlaces a la misma página.
    const esperado53 = [
      '/display/ENG/Runbook+de+guardia enlaces',
      '/wiki/pages/viewpage.action?pageId=301 enlaces',
      '/wiki/spaces/ENG/pages/100/Arquitectura comentario',
      '/wiki/spaces/ENG/pages/200/ADR-014 comentario',
      '/wiki/spaces/ENG/pages/200/ADR-014 descripcion',
      'https://git.example.com/eng/exporter comentario',
    ].join(' | ')
    ok(
      'jira: los enlaces de la incidencia salen con la parte de la que vienen, y el filtrado es del panel',
      mapa53 === esperado53 && mapa53 === otraVez53.map(corto53).sort().join(' | ') && jiraIssueKey(document, location.href) === 'ENG-7',
      mapa53 || 'ningún enlace'
    )
    // Las tres trampas de la fixture, cada una por un motivo distinto: la 999
    // está en la barra de acciones (fuera de los puntos de lectura), la 997 en
    // un `role="button"` DENTRO del módulo de descripción (interfaz según el
    // ámbito) y la 998 en la pestaña de campos que está plegada (no se ve).
    const trampas53 = ['/pages/999/', '/pages/997/', '/pages/998/'].filter((t) => enlaces53.some((l) => l.href.includes(t)))
    ok(
      'jira: ni la barra de acciones, ni un boton del modulo, ni una pestana plegada cuentan como enlaces de la incidencia',
      trampas53.length === 0 && document.querySelectorAll('a[href*="/pages/99"]').length === 3 && enlaces53.every((l) => l.text && !/\n/.test(l.text)),
      trampas53.length ? 'se colaron: ' + trampas53.join(', ') : `${enlaces53.length} enlaces, 3 trampas fuera`
    )
    // H14: y las rutas PROPIAS de Jira tampoco, ni cuentan para el tope. Pasó de
    // verdad: en una épica real eran 55 de los 60 que caben —`/browse/`,
    // `/rest/`, `/secure/`— y los enlaces de los COMENTARIOS, que van al final
    // del documento, no llegaban a leerse. Los de la incidencia se cuentan del
    // DOM, no de una lista escrita a mano.
    // El tope es 4 porque delante de los comentarios van tres enlaces (uno en
    // la descripción y dos en el módulo de enlaces, que son la misma página):
    // lo que se comprueba es que los internos de Jira NO se lo comen.
    const propias53 = [...document.querySelectorAll('#issue-content a[href]')].filter((a) => isOwnJiraRoute(a.getAttribute('href'), location.href))
    const tope53 = pageLinks({ limits: { max: 4 } })
    ok(
      'jira: las rutas propias de Jira no se leen ni se comen el tope, asi que los comentarios entran',
      propias53.length >= 5 &&
        !enlaces53.some((l) => isOwnJiraRoute(l.href, location.href)) &&
        tope53.length === 4 &&
        tope53.some((l) => l.where === 'comentario') &&
        !tope53.some((l) => isOwnJiraRoute(l.href, location.href)),
      `${propias53.length} enlaces internos de Jira fuera · con tope 4: ${tope53.map((l) => l.where).join(' ')}`
    )

    // 54. Y en una página de Confluence, sólo los del contenido: el árbol
    //     lateral tiene decenas de enlaces y ninguno lo puso nadie para ESTA
    //     página. Salen sin región, porque en Confluence no hay regiones. El
    //     `/browse/ENG-7` del contenido tampoco es una página (H14): aquí la
    //     Jira y la Confluence de mentira comparten origen, como en un Cloud.
    renderPage('page:200')
    await wait(320)
    const enlaces54 = pageLinks()
    const delArbol54 = [...document.querySelectorAll('.sidebar a[href]')].map((a) => a.href)
    // Lo que se comprueba es que del árbol no se cuela NADA de más, no que ningún
    // href coincida: el Runbook (301) está enlazado en el contenido Y es una fila
    // del árbol —es la misma página—, así que comparar por href daba un falso
    // fallo (lo vio el orquestador al correr el tramo en el navegador; el ensayo
    // en Node no tenía barra lateral). Se cuentan los del árbol que NO están en
    // el contenido: de ésos no puede salir ninguno.
    const soloDelArbol54 = delArbol54.filter((h) => !/\/pages\/301\//.test(h))
    ok(
      'confluence: los enlaces son los del contenido, y ninguno de los del arbol lateral',
      enlaces54.map(corto53).sort().join(' | ') === '/wiki/spaces/ENG/pages/301/Runbook pagina' &&
        document.querySelectorAll('#page-content a[href*="/browse/"]').length === 1 &&
        delArbol54.length > 10 &&
        soloDelArbol54.length === delArbol54.length - 1 &&
        !enlaces54.some((l) => soloDelArbol54.includes(l.href)),
      `${enlaces54.length} del contenido · ${delArbol54.length} en el arbol lateral · ${soloDelArbol54.length} sólo del árbol, ninguno leído`
    )

    // 55. Y con esos enlaces, los enlaces remotos que da la API, un historial
    //     de dos análisis anteriores y un contexto que nombra páginas con su
    //     id: la lista que la pantalla ofrece, puntuada y explicada. Ningún
    //     turno del modelo en todo el camino.
    renderPage('issue:ENG-7')
    await wait(320)
    const { confluenceLinksIn, suggestSources, reasonText } = await import('/src/panel/source-suggest.js')
    const { referencesFromContext } = await import('/src/panel/references.js')
    const { emptyHistory, historyEntry, recordAnalysis } = await import('/src/panel/source-history.js')
    const { normalizeIndex } = await import('/src/atlassian/index-store.js')

    // El índice sale de las páginas del propio banco, no de una lista escrita
    // a mano: si mañana cambia un título, cambia el índice con él.
    const indice55 = normalizeIndex(
      {
        pages: Object.entries(PAGES)
          .map(([clave, p]) => ({ id: clave.replace('page:', ''), title: p.title, spaceKey: 'ENG', url: p.path }))
          .filter((p) => /^\d+$/.test(p.id)),
      },
      location.hostname,
      { kind: 'space', key: 'ENG' },
      { wikiPrefix: '/wiki' }
    )
    const remoto55 = await jiraRest.fetchRemoteLinks(pideApi, sitioJira, 'ENG-7', { hosts: [location.hostname] })
    // En el banco la Jira y la Confluence de mentira comparten origen, así que
    // el «Confluence enlazado» es este mismo host.
    const sitio55 = { host: location.hostname, origin: location.origin, product: 'jira', cloud: false, issueKey: 'ENG-7', projectKey: 'ENG' }
    const candidatas55 = confluenceLinksIn(pageLinks(), remoto55, { site: sitio55, linkedHost: location.hostname, index: indice55 })
    const dondeSale55 = (id) => candidatas55.find((c) => c.id === id)?.where || '(no está)'
    // H14: el enlace remoto de la API y el `dd.remote-link` del módulo de enlaces
    // son el MISMO —el Runbook—, como en el Jira real, así que su procedencia es
    // «remoto» y no «enlaces». Que el `/display/` sin id se resuelva contra el
    // ÍNDICE se comprueba SIN el remoto: con él, el id vendría de ahí y no
    // probaría nada.
    const sinRemoto55 = confluenceLinksIn(pageLinks(), null, { site: sitio55, linkedHost: location.hostname, index: indice55 })
    ok(
      'de los enlaces leidos solo quedan los que llevan a una pagina, y el /display/ se resuelve por el INDICE',
      candidatas55.length === 3 &&
        dondeSale55('301') === 'remoto' &&
        dondeSale55('200') === 'descripcion' &&
        dondeSale55('100') === 'comentario' &&
        candidatas55.find((c) => c.id === '301').title === 'Runbook de guardia' &&
        !candidatas55.some((c) => c.title.startsWith('Página ')) &&
        sinRemoto55.find((c) => c.id === '301')?.where === 'enlaces',
      candidatas55.map((c) => `${c.id}:${c.where}`).join(' ') + ` · remotos ${remoto55.ok ? remoto55.links.length : remoto55.reason}`
    )
    // H14: y el TÍTULO se decide aparte de la procedencia. Sin índice —que es lo
    // que tapa el fallo, porque el título de verdad lo sabe él— el «Page» que
    // manda la API sólo deja el marcador, que es la señal de «lee el título por
    // su id» (`addSourceById`); y el enlace PEGADO del comentario, cuyo texto ES
    // una URL, saca el suyo del slug de la ruta. Los enlaces pegados se cuentan
    // del DOM, no de una lista escrita aquí.
    const pegados55 = pageLinks().filter((l) => /^https?:\/\//i.test(l.text))
    const soloPegado55 = confluenceLinksIn(pegados55, null, { site: sitio55, linkedHost: location.hostname, index: null })
    // El marcador sólo queda cuando la 301 llega SÓLO por el remoto genérico: el
    // enlace del DOM con `pageId` —el de la forma real— se aparta aquí a
    // propósito, y se cuenta del DOM que existe.
    const conId55 = pageLinks().filter((l) => /pageId=301\b/.test(l.href))
    const soloRemoto55 = confluenceLinksIn(
      pageLinks().filter((l) => !/pageId=301\b/.test(l.href)),
      remoto55,
      { site: sitio55, linkedHost: location.hostname, index: null }
    )
    ok(
      'ni «Page» ni una URL pegada llaman a una pagina: queda el marcador, o el titulo que la ruta lleva dentro',
      pegados55.length === 1 &&
        soloPegado55.length === 1 &&
        soloPegado55[0].title === 'ADR-014' &&
        conId55.length === 1 &&
        soloRemoto55.find((c) => c.id === '301')?.title === 'Página 301' &&
        !soloRemoto55.concat(candidatas55).some((c) => c.title === 'Page' || /^https?:\/\//i.test(c.title)),
      `pegados ${pegados55.length} → «${soloPegado55.map((c) => c.title).join('» «')}» · sólo remoto: ${soloRemoto55
        .map((c) => `${c.id}:${c.title}`)
        .join(' ')}`
    )
    // Y el caso REAL de F1 (revisión adversaria de H14: el banco no lo ejercía):
    // la misma página llega por el remoto de la API, que la titula «Page», y por
    // el `a.link-title` del módulo de enlaces, que trae el título de verdad y el
    // `pageId`. Sin índice, el título es el del DOM y la procedencia sigue siendo
    // la mejor, «remoto». El título se lee del DOM, no de una cadena escrita aquí.
    const sinIndice55 = confluenceLinksIn(pageLinks(), remoto55, { site: sitio55, linkedHost: location.hostname, index: null })
    const tituloDom55 = conId55[0]?.text || ''
    ok(
      'F1 real: sin indice, la pagina que la API titula «Page» se llama como en el DOM y viene de «remoto»',
      remoto55.ok &&
        remoto55.links.some((l) => l.pageId === '301' && l.title === '') &&
        tituloDom55.length > 3 &&
        sinIndice55.find((c) => c.id === '301')?.title === tituloDom55 &&
        sinIndice55.find((c) => c.id === '301')?.where === 'remoto' &&
        sinIndice55.filter((c) => c.id === '301').length === 1,
      `sin índice: ${sinIndice55.map((c) => `${c.id}:${c.title}:${c.where}`).join(' ')}`
    )

    // Dos análisis anteriores de la misma clase de trabajo y del mismo
    // proyecto, con la misma página elegida: es la señal de «esto es lo que
    // usas para esto». Los campos y el título los lee del DOM, como el panel.
    const campos55 = normalizeIssueFields(jiraIssueFields())
    const titulo55 = pageDigest().blocks[0]?.text || ''
    const ahora55 = Date.UTC(2026, 8, 20, 12, 0, 0)
    let historial55 = emptyHistory()
    for (const clave of ['ENG-20', 'ENG-21']) {
      historial55 = recordAnalysis(
        historial55,
        historyEntry({
          sources: { mode: 'open', pages: [{ id: '100', title: 'Arquitectura', spaceKey: 'ENG' }] },
          issue: campos55,
          summary: 'Rotar credenciales del exportador',
          issueKey: clave,
          projectKey: 'ENG',
          product: 'jira',
          now: ahora55 - 86400000,
        }),
        { host: location.hostname, now: ahora55 }
      )
    }
    // Y un contexto como el que escribe el indexador: una página con su id bajo
    // un apartado que dice de qué sirve, y tres señuelos que NO son ids.
    const contexto55 = [
      '## 6. Dónde está documentado en Confluence',
      '',
      '**Arquitectura**',
      '',
      '- «1080 - Architecture» (id 1080) — el índice de las vistas de arquitectura del programa.',
      '',
      '**Procesos**',
      '',
      '- «ACV Static - Identity Provider Service» (id 2003) — cómo se despliega el proveedor de identidad.',
      '- La página de bienvenida (id 123) no vale: tres cifras no son un id de página.',
      '- SIMPL-1234 tampoco, que es una incidencia.',
    ].join('\n')
    const refs55 = referencesFromContext(contexto55, { index: indice55 })

    const ctx55 = {
      index: indice55,
      references: refs55,
      history: historial55,
      links: candidatas55,
      issue: campos55,
      summary: titulo55,
      projectKey: 'ENG',
      issueKey: 'ENG-7',
      product: 'jira',
      now: ahora55,
    }
    const sugeridas55 = suggestSources(ctx55)
    const linea55 = (s) => `${s.id} ${s.score} ${reasonText(s.reasons)}`
    ok(
      'paginas base sugeridas: del enlace, del historial y del contexto, cada una con su motivo y sin gastar un token',
      sugeridas55.length === 5 &&
        sugeridas55.map((s) => s.id).join(' ') === '100 200 301 1080 2003' &&
        linea55(sugeridas55[0]) === '100 65 desde un comentario · la usaste en 2 análisis de tareas en ENG' &&
        linea55(sugeridas55[1]) === '200 62 enlazada desde la descripción · el título la señala como referencia' &&
        linea55(sugeridas55[2]) === '301 50 enlazada en Jira a esta incidencia' &&
        linea55(sugeridas55[3]) === '1080 25 el contexto la nombra como arquitectura' &&
        linea55(sugeridas55[4]) === '2003 25 el contexto la nombra como proceso' &&
        Object.keys(refs55.items).sort().join(',') === '1080,2003',
      sugeridas55.map(linea55).join(' | ') || 'ninguna sugerencia'
    )
    // Determinista, sin las que ya están elegidas, y desde un Jira las páginas
    // son del Confluence ENLAZADO: su ruta no es de este sitio y se vacía.
    const otraVez55 = suggestSources(ctx55)
    const sinLa100 = suggestSources({ ...ctx55, exclude: ['100'] })
    const delEnlazado55 = suggestSources({ ...ctx55, linked: true })
    ok(
      'la misma lista dos veces, sin las ya elegidas, y desde Jira sin ruta de este sitio',
      JSON.stringify(otraVez55) === JSON.stringify(sugeridas55) &&
        !sinLa100.some((s) => s.id === '100') &&
        sinLa100.length === 4 &&
        delEnlazado55.every((s) => s.path === '') &&
        sugeridas55.some((s) => s.path.startsWith('/wiki/')) &&
        suggestSources({ product: 'jira', now: ahora55 }).length === 0,
      `${sinLa100.map((s) => s.id).join(' ')} sin la 100 · rutas del enlazado «${delEnlazado55.map((s) => s.path).join('')}»`
    )

    // ------------------------------------------------------------------
    // 56-59: «Qué mirar hoy» (H11). Son las dos mitades de una recomendación
    // juntas: la del SERVIDOR (qué cambió y cuándo, por las plantillas fijas
    // contra la API del sitio) y la LOCAL (cuándo lo miraste tú, qué
    // analizaste, qué usas de base), que no tiene nadie más. Aquí no se navega
    // ni se pinta nada del panel —el panel no corre en el banco—: lo que se
    // comprueba es el transporte y la lógica, que es justo lo que no se puede
    // probar en Node (la API de mentira) ni en Node solo (la meta del DOM).
    //
    // El reloj se para DESPUÉS de la última lectura y se usa el mismo para el
    // diario y para las dos ordenaciones: la fixture da las fechas en horas
    // hacia atrás desde que contesta el servidor, así que parar el reloj antes
    // convertiría un «cambió hace 2 h» en «hace 1 h» por unos milisegundos.
    // ------------------------------------------------------------------

    // 56. En un Confluence Data Center una página es `/display/ESPACIO/Título`:
    //     la URL no lleva el id por ninguna parte y lo único que lo dice es la
    //     meta `ajs-page-id`. Sin leerla no habría visita que apuntar, y de la
    //     URL no se guarda ni la consulta ni el fragmento (§8.20).
    const act56 = await import('/src/atlassian/activity.js')
    renderPage('page:200')
    await wait(320)
    const id56 = pageIdFromDom()
    const titulo56 = document.title
    renderPage('page:201')
    await wait(320)
    const otra56 = pageIdFromDom()
    renderPage('issue:ENG-7')
    await wait(320)
    const enJira56 = pageIdFromDom()
    const visita56 = act56.visitFromUrl(location.origin + '/display/ENG/ADR-014?focusedCommentId=9#hilo', { title: titulo56, pageId: id56 })
    const sinMeta56 = act56.visitFromUrl(location.origin + '/display/ENG/ADR-014', { title: titulo56, pageId: '' })
    ok(
      'el id de una pagina de Data Center sale del DOM, y de la URL no se guarda ni la consulta ni el fragmento',
      id56 === '200' &&
        otra56 === '201' &&
        enJira56 === '' &&
        !!visita56 &&
        visita56.kind === 'confluence-page' &&
        visita56.id === '200' &&
        visita56.path === '/display/ENG/ADR-014' &&
        visita56.title === titulo56 &&
        sinMeta56 === null,
      `meta ${id56} → ${otra56} → «${enJira56 || 'sin id'}» · ruta guardada «${visita56?.path}» · sin meta ${sinMeta56 === null ? 'no hay visita' : 'ERROR'}`
    )

    // Y los dos escritores no se pisan: el service worker apunta lo VISTO y el
    // panel lo que sólo él sabe. Dos avisos de la misma navegación (uno del
    // worker, otro del content script) son una visita; dos minutos después, dos.
    const host56 = location.hostname
    const ahora56 = Date.now()
    const clave56 = act56.activityKey('confluence-page', '200')
    let diario56 = act56.recordVisit(act56.emptyActivity(host56), { ...visita56, at: ahora56 }, { host: host56, now: ahora56 })
    diario56 = act56.recordVisit(diario56, { ...visita56, at: ahora56 + 30000 }, { host: host56, now: ahora56 + 30000 })
    const unaVisita56 = diario56.items[clave56]
    diario56 = act56.recordVisit(diario56, { ...visita56, at: ahora56 + 120000 }, { host: host56, now: ahora56 + 120000 })
    diario56 = act56.touchActivity(
      diario56,
      { event: 'analyzed', kind: 'confluence-page', id: '200', notes: 4, at: ahora56 + 120000 },
      { host: host56, now: ahora56 + 120000 }
    )
    const tras56 = diario56.items[clave56]
    ok(
      'dos avisos de la misma navegacion cuentan una visita, y analizar no toca lo visto ni al reves',
      unaVisita56.seenCount === 1 &&
        unaVisita56.analyzedAt === 0 &&
        tras56.seenCount === 2 &&
        tras56.seenAt === ahora56 + 120000 &&
        tras56.analyzedAt === ahora56 + 120000 &&
        tras56.notes === 4 &&
        Object.keys(diario56.items).length === 1,
      `visitas ${unaVisita56.seenCount} → ${tras56.seenCount} · analizada con ${tras56.notes} observaciones`
    )

    // 57. La lista entera: las cuatro plantillas de Jira y las tres de
    //     Confluence contra la API del sitio, cruzadas con el diario. Lo que se
    //     comprueba es que sale la MISMA lista dos veces, con los mismos
    //     motivos: las lecturas llegan en el orden en que conteste la red y el
    //     desempate tiene que ser total, o la lista bailaría entre arranques.
    const hoy57 = await import('/src/panel/today.js')
    const lecturas57 = []
    const fallos57 = []
    const leer57 = async (kind, jql, opciones = {}) => {
      const r = await jiraRest.searchIssues(pideApi, sitioJira, jql, { limit: 20, ...opciones })
      if (r.ok) lecturas57.push({ product: 'jira', host: location.hostname, kind, items: r.issues })
      else fallos57.push({ product: 'jira', host: location.hostname, kind, reason: r.reason, status: r.status, messages: r.messages })
      return r
    }
    await leer57('history', jiraRest.historyJql())
    await leer57('mine', jiraRest.mineJql(hoy57.TODAY_LIMITS.daysMine))
    await leer57('project', jiraRest.projectJql('ENG', hoy57.TODAY_LIMITS.daysProject))
    await leer57('related', jiraRest.relatedJql('ENG-7'))
    // Los ids que se preguntan salen del diario, que es lo que hace el panel:
    // «de las páginas que tú tocas, ¿alguna ha cambiado?».
    const delDiario57 = hoy57.recentPagesFromActivity(diarioDeMentira(act56, Date.now())).map((p) => p.id)
    const paginas57 = []
    for (const [kind, cql] of [
      ['viewed', confRest.viewedCql(10)],
      ['mine', confRest.mineCql(hoy57.TODAY_LIMITS.daysMine)],
      ['ids', confRest.idsCql(delDiario57)],
    ]) {
      const r = await confRest.searchContent(pideApi, sitioConf, cql)
      if (r.ok) paginas57.push({ product: 'confluence', host: location.hostname, kind, items: r.pages })
    }
    const todas57 = [...lecturas57, ...paginas57]
    // El reloj se para aquí: después de la última petición y antes de puntuar.
    const ahora57 = Date.now()
    const diario57 = diarioDeMentira(act56, ahora57)
    const preferidas57 = act56.preferredFamilies(diario57, { now: ahora57 })
    const cands57 = hoy57.buildCandidates({ reads: todas57, activity: { [location.hostname]: diario57 }, here: null, now: ahora57 })
    const ordenar57 = (candidatos, aqui = null) =>
      hoy57.rankToday(candidatos, { here: aqui, index: null, preferred: preferidas57, now: ahora57 })
    const filas57 = ordenar57(cands57)
    const otraVez57 = ordenar57(cands57)
    const corto57 = (f) => (f.kind === 'jira-issue' ? f.id : 'p' + f.id)
    ok(
      'las siete plantillas dan una lista ordenada que es la misma dos veces, hasta en el desempate',
      todas57.length === 7 &&
        delDiario57.join(',') === '200,2003' &&
        cands57.length > 15 &&
        filas57.length === hoy57.TODAY_LIMITS.maxItems &&
        filas57.map(corto57).join(' ') === 'ENG-12 ENG-7 p2003 p200 ENG-3 ENG-5 p1086 ENG-18' &&
        JSON.stringify(otraVez57) === JSON.stringify(filas57),
      `${cands57.length} candidatos → ${filas57.map((f) => corto57(f) + ':' + f.score).join(' ')}`
    )
    // Y cada fila dice POR QUÉ está ahí, con las dos mitades dentro: el servidor
    // pone «cambió», el diario pone «la analizaste» y «página base de tus
    // análisis», y sin él la lista es otra.
    const motivo57 = (id) => filas57.find((f) => corto57(f) === id)?.why || '(no está)'
    const sinDiario57 = hoy57.rankToday(hoy57.buildCandidates({ reads: todas57, activity: {}, here: null, now: ahora57 }), { now: ahora57 })
    const conCambio = (lista) => lista.filter((f) => f.group === 'cambio').length
    // El tipo de la fila es el NOMBRE con el que la API lo devuelve, que desde
    // H14 viene traducido («Tarea», no «Task»): es lo que el usuario ve en su
    // Jira, y el id sólo se usa para preguntar (§8.23).
    ok(
      'cada fila dice por que esta ahi, y sin el diario ni el orden ni los grupos son los mismos',
      motivo57('ENG-12') === 'cambió ayer · es tuya o la sigues · Tarea' &&
        motivo57('ENG-7') === 'cambió hace 3 h · la analizaste hace 2 días con 6 observaciones · es tuya o la sigues' &&
        motivo57('p2003') === 'cambió hace 2 h · modificada por Ana Pérez · la sueles mirar (4 veces)' &&
        motivo57('p200') === 'página base de tus análisis · cambió ayer · modificada por Marta Ruiz' &&
        conCambio(filas57) === 5 &&
        conCambio(sinDiario57) === 2 &&
        sinDiario57.map(corto57).join(' ') !== filas57.map(corto57).join(' '),
      `${conCambio(filas57)} filas con cambios con diario, ${conCambio(sinDiario57)} sin él · sin diario: ${sinDiario57.map(corto57).join(' ')}`
    )

    // 58. Lo que ya tienes delante no se recomienda, y lo que descartaste no
    //     vuelve hasta que alguien lo toque: es lo que separa esta lista de una
    //     bandeja de actualizados.
    const aqui58 = { host: location.hostname, issueKey: 'ENG-7', projectKey: 'ENG' }
    const conENG7 = ordenar57(hoy57.buildCandidates({ reads: todas57, activity: { [location.hostname]: diario57 }, here: aqui58, now: ahora57 }), aqui58)
    ok(
      'la incidencia que tienes abierta no se recomienda, aunque sea la que mas puntos tendria',
      filas57.some((f) => f.id === 'ENG-7') && !conENG7.some((f) => f.id === 'ENG-7') && conENG7.length === hoy57.TODAY_LIMITS.maxItems,
      `con ella ${filas57.map(corto57).join(' ')} · abierta ${conENG7.map(corto57).join(' ')}`
    )
    const eng12 = cands57.find((c) => c.id === 'ENG-12')
    const descartado58 = act56.dismissItem(diario57, 'jira-issue:ENG-12', eng12.updatedAt, { host: location.hostname, now: ahora57 })
    // El descarte guarda CUÁNDO se descartó (revisión adversaria de H11): uno de
    // hace una hora, cuando la fila todavía no había cambiado, deja que vuelva.
    const antes58 = eng12.updatedAt - 3600000
    const antiguo58 = act56.dismissItem(diario57, 'jira-issue:ENG-12', antes58, { host: location.hostname, now: antes58 })
    const conDescarte = (diario) => ordenar57(hoy57.buildCandidates({ reads: todas57, activity: { [location.hostname]: diario }, here: null, now: ahora57 }))
    const sin12 = conDescarte(descartado58)
    const vuelve12 = conDescarte(antiguo58)
    ok(
      'lo descartado desaparece, y vuelve solo en cuanto cambia despues del descarte',
      !sin12.some((f) => f.id === 'ENG-12') &&
        sin12.length === hoy57.TODAY_LIMITS.maxItems &&
        vuelve12.map(corto57).join(' ') === filas57.map(corto57).join(' ') &&
        Object.keys(descartado58.dismissed).join(',') === 'jira-issue:ENG-12',
      `sin él ${sin12.map(corto57).join(' ')} · si cambia vuelve el primero: ${vuelve12[0] ? corto57(vuelve12[0]) : '(nada)'}`
    )

    // 59. Y si la API dice que no, la sección se degrada: la lista sale de lo
    //     que haya contestado y el motivo es del SERVIDOR, no una lista vacía
    //     que parecería «hoy no hay nada que mirar» (§8.14).
    const antes59 = pedidasRest.length
    const caidas59 = []
    for (const [kind, jql] of [
      ['history', jiraRest.historyJql()],
      ['mine', jiraRest.mineJql(hoy57.TODAY_LIMITS.daysMine)],
      ['project', jiraRest.projectJql('ENG', hoy57.TODAY_LIMITS.daysProject)],
      ['related', jiraRest.relatedJql('ENG-7')],
    ]) {
      const r = await jiraRest.searchIssues(pideApi, sitioJira, jql, { limit: 20, prefix: '/sinsesion' })
      caidas59.push({ product: 'jira', host: location.hostname, kind, reason: r.reason, status: r.status, ok: r.ok })
    }
    ok(
      'sin sesion valida las cuatro lecturas de Jira fallan por la sesion, y ninguna sale del origen',
      caidas59.length === 4 &&
        caidas59.every((e) => !e.ok && e.reason === 'sesion' && e.status === 401) &&
        pedidasRest.length === antes59 + 4 &&
        pedidasRest.slice(antes59).every((u) => u.startsWith(location.origin)),
      caidas59.map((e) => `${e.kind}:${e.reason}`).join(' ')
    )
    const soloPaginas59 = ordenar57(hoy57.buildCandidates({ reads: paginas57, activity: { [location.hostname]: diario57 }, here: null, now: ahora57 }))
    const resumen59 = hoy57.todaySummary({ items: soloPaginas59, errors: caidas59 })
    ok(
      'la lista sale de lo que haya contestado, y el Registro dice por que viene corta sin un solo titulo',
      soloPaginas59.length > 0 &&
        soloPaginas59.every((f) => f.product === 'confluence') &&
        resumen59.startsWith(`${soloPaginas59.length} filas · Confluence ${soloPaginas59.length}`) &&
        resumen59.includes('Jira sin lista: sesion') &&
        !soloPaginas59.some((f) => f.title && resumen59.includes(f.title)) &&
        !soloPaginas59.some((f) => resumen59.includes(f.id)),
      resumen59
    )

    // 60. La TERCERA barra lateral: el pagetree clásico de un Confluence
    //     Server/Data Center. En el Confluence 9.2 real (F9, 2026-09-21) no hay
    //     `<aside>`, ni `role="tree"`, ni `nav[aria-label*="página"]`, ni un
    //     solo `data-testid`, así que `treeContainer()` no encontraba nada y
    //     `describeTree()` contestaba «(ninguno) — sin contenedor no hay
    //     recorrido posible»: ni «Paso a paso» ni «Árbol leído de la página».
    //     Todo lo demás ya funcionaba con el contenedor señalado a mano, así que
    //     lo que estos tres tramos pinan es que se siga reconociendo.
    setSidebar('pagetree')
    renderPage('page:400')
    await wait(320)

    const barra60 = document.querySelector('.sidebar')
    const cont60 = treeContainer()
    const enlace60 = document.querySelector('.plugin_pagetree a[data-nav="page:1080"]')
    const fila60 = rowFor(enlace60, cont60)
    const chevron60 = toggleFor(fila60)
    const scroller60 = treeScroller(cont60)
    ok(
      'pagetree de un Data Center: encuentra contenedor, fila, chevron y scroller',
      !!cont60 &&
        cont60.classList.contains('plugin_pagetree') &&
        // Y lo hace SIN ninguna de las pistas que conocía la cascada de antes:
        // esa barra no es un <aside>, no lleva role=tree y no tiene un solo
        // data-testid, que es exactamente lo que pasa en el Confluence 9.2.
        !barra60.matches('aside, [role="tree"], [data-testid]') &&
        !barra60.querySelector('[role="tree"], [data-testid], nav') &&
        fila60?.tagName === 'LI' &&
        !!chevron60 &&
        chevron60.toggle.classList.contains('plugin_pagetree_childtoggle') &&
        chevron60.toggle.getAttribute('aria-expanded') === 'false' &&
        chevron60.toggle.getAttribute('href') === '' &&
        isSafeToClick(chevron60.toggle, ORIGIN).ok &&
        !!scroller60 &&
        scroller60.classList.contains('ia-scrollable-section'),
      `contenedor=${cont60?.className.split(' ')[0]} fila=${fila60?.tagName} chevron=${chevron60?.toggle.className.split(' ')[0]} scroller=${scroller60?.className.split(' ')[0]}`
    )

    const diag60 = describeTree()
    const elegida60 = diag60.split('\n').find((l) => l.includes('<== ELEGIDO')) || ''
    ok(
      'y el diagnostico ya no dice «(ninguno)»: nombra el pagetree como elegido',
      !diag60.includes('(ninguno)') &&
        elegida60.includes('.plugin_pagetree ->') &&
        /árbol=true/.test(diag60) &&
        !/\(ningún enlace a página dentro del contenedor\)/.test(diag60),
      elegida60.trim() || '(sin línea de elegido)'
    )

    // 61. Y con ese contenedor, leer del DOM quién cuelga de quién. Aquí las
    //     hijas NO están en el DOM hasta desplegar, así que primero se lee lo
    //     que hay (sólo raíces), y al abrir dos ramas aparecen las que se ven —y
    //     sólo ésas, que es lo que significa «perezosas»—. Se importa aparte
    //     para poder repetir el tramo desde fuera sin pasar por los sesenta de
    //     antes.
    const treeScan61 = await import('/src/content/tree-scan.js')
    const chevronDe = (id) =>
      document
        .querySelector(`.plugin_pagetree a[data-nav="page:${id}"]`)
        ?.closest('li')
        ?.querySelector(':scope > .plugin_pagetree_childtoggle_container > .plugin_pagetree_childtoggle')

    const plegado61 = treeScan61.snapshotTree()
    for (const id of ['1080', '1081']) {
      chevronDe(id)?.click()
      await wait(360)
    }
    const abierto61 = treeScan61.snapshotTree()
    const padre61 = (id) => abierto61.pages.find((p) => p.id === id)?.parentId
    ok(
      'del pagetree se leen las hijas que ya se ven, con su padre, y ni una mas',
      plegado61.pages.length > 0 &&
        !plegado61.pages.some((p) => p.parentId) &&
        !plegado61.pages.some((p) => p.id === '1081') &&
        padre61('1081') === '1080' &&
        padre61('1082') === '1081' &&
        !abierto61.pages.some((p) => p.id === '1083'),
      `plegado ${plegado61.scanned} filas sin padre · abierto ${abierto61.scanned} · 1081→${padre61('1081')} 1082→${padre61('1082')}`
    )

    // Y desplegado entero, las relaciones que se leen son las MISMAS que las de
    // la barra clásica: sin eso, comparar una barra con otra no querría decir
    // nada (es lo que hace valer el tramo 51, que lee la clásica).
    for (let i = 0; i < 12; i++) {
      const plegados = [...document.querySelectorAll('.plugin_pagetree .plugin_pagetree_childtoggle[aria-expanded="false"]')]
      if (!plegados.length) break
      for (const ch of plegados) ch.click()
      await wait(320)
    }
    const IDS61 = new Set(['100', '200', '201', '300', '301', '400', '1080', '1081', '1082', '1083', '1084', '1085', '1086'])
    const relaciones61 = (snap) =>
      snap.pages
        .filter((p) => IDS61.has(p.id))
        .map((p) => `${p.id}→${p.parentId || '-'}`)
        .sort()
        .join(' ')
    const delPagetree61 = relaciones61(treeScan61.snapshotTree())

    setSidebar('clasica')
    renderPage('page:400')
    await wait(320)
    document.querySelectorAll('.children.collapsed').forEach((c) => c.classList.remove('collapsed'))
    const deLaClasica61 = relaciones61(treeScan61.snapshotTree())
    ok(
      'y son exactamente las MISMAS relaciones que se leen de la barra clasica',
      delPagetree61 === deLaClasica61 && IDS61.size === delPagetree61.split(' ').length,
      delPagetree61 === deLaClasica61 ? delPagetree61 : `pagetree «${delPagetree61}» ≠ clasica «${deLaClasica61}»`
    )

    // 62. Y el recorrido paso a paso de dos niveles: las dos ramas de en medio
    //     no están en el DOM cuando arranca, llegan por AJAX al desplegarlas, y
    //     sólo el último paso navega. Es lo que en el Confluence real ya
    //     funcionaba con el contenedor señalado a mano.
    setSidebar('pagetree')
    renderPage('page:400')
    await wait(320)

    const enElDom62 = (id) => !!document.querySelector(`.plugin_pagetree a[data-nav="page:${id}"]`)
    const antes62 = ['1081', '1082'].filter(enElDom62)
    const cadena62 = ['1080', '1081', '1082']
    const pasos62 = cadena62.map((id, i) => ({
      kind: 'confluence-page',
      id,
      title: PAGES['page:' + id].title,
      label: PAGES['page:' + id].title,
      path: PAGES['page:' + id].path,
      url: ORIGIN + PAGES['page:' + id].path,
      action: i === cadena62.length - 1 ? 'open' : 'expand',
    }))
    const estados62 = []
    const rutas62 = []
    for (let i = 0; i < pasos62.length; i++) {
      const paso = await runner.executeStep({
        step: pasos62[i],
        index: i,
        total: pasos62.length,
        isLast: i === pasos62.length - 1,
      })
      estados62.push(paso.status)
      rutas62.push(location.pathname)
      await wait(340)
      if (paso.status === STEP_RESULT.CANCELLED) break
    }
    ok(
      'recorrido en el pagetree: despliega las ramas que llegan por AJAX y navega UNA vez',
      antes62.length === 0 &&
        estados62.length === 3 &&
        estados62.slice(0, -1).every((e) => e === STEP_RESULT.EXPANDED) &&
        estados62[2] === STEP_RESULT.CLICKED &&
        new Set(rutas62).size === 2 &&
        location.pathname.includes('/pages/1082'),
      `${estados62.join(',')} · ${new Set(rutas62).size} rutas · ${location.pathname}`
    )

    // 63. Un host con DOS espacios indexados (H21): ENG y OPS leídos por la API
    //     cada uno con su `fetchSpacePages`, convertidos con `indexFromSpacePages`
    //     y fundidos con `mergeIndex`, que es lo que deja `generateContext` tras
    //     indexar el segundo espacio. Lo que se comprueba es lo que el panel saca
    //     de ahí POR ESPACIO: el subíndice de uno es el mismo árbol que leído
    //     solo, sus títulos para el indexador no llevan páginas del otro, el paso
    //     a paso de un espacio al otro empieza por abrir el espacio, y la barra
    //     lateral se estampa con el espacio de la pestaña. Nada escrito a mano:
    //     qué páginas tiene cada espacio lo dice la LISTA de la misma API, y el
    //     árbol de ENG solo se RECALCULA aquí como en el tramo 51 (limit 8), sin
    //     depender de él.
    setSidebar('clasica')
    renderPage('page:200')
    await wait(320)
    runner.clear()
    const ambitos63 = await import('/src/shared/scopes.js')
    const { treeTitles: titulos63 } = await import('/src/panel/prompts.js')
    const { validatePlan: plan63 } = await import('/src/nav/validate.js')
    const indices63 = await import('/src/atlassian/index-store.js')
    const { snapshotTree: leerBarra63 } = await import('/src/content/tree-scan.js')
    const { indexFromSpacePages: aIndice63 } = await import('/src/panel/indexer.js')

    // El árbol de ENG SOLO, recalculado como en el tramo 51.
    const arbolEng63 = await confRest.fetchSpacePages(pideApi, sitioConf, 'ENG', { limit: 8 })
    const soloEng63 = aIndice63(arbolEng63.pages, {
      site: { host: location.hostname, cloud: false, wikiPrefix: '/wiki' },
      scope: { kind: 'space', key: 'ENG' },
      homeId: arbolEng63.homeId,
    })
    // Y los dos espacios fundidos, con ENG leído con OTRO tamaño de página: que
    // el subíndice salga igual no depende de cómo se paginó la lectura.
    const { eng: eng63, ops: ops63, fundido: fundido63 } = await leerDosEspacios(pideApi, { limitEng: 25, limitOps: 8 })
    const subEng63 = ambitos63.subIndex(fundido63, 'ENG')
    const subOps63 = ambitos63.subIndex(fundido63, 'OPS')
    const idsSubOps63 = Object.keys(subOps63?.pages || {}).sort()
    ok(
      'dos espacios leídos por separado y fundidos: el subíndice de ENG es, página a página, el árbol de ENG leído solo',
      !!soloEng63 &&
        !!fundido63 &&
        !arbolEng63.truncated &&
        !ops63.arbol.truncated &&
        ops63.arbol.via === 'busqueda' &&
        ops63.arbol.own === ops63.ids.length &&
        ops63.arbol.total === ops63.ids.length &&
        ops63.arbol.requests === 1 + Math.ceil(ops63.arbol.own / 8) &&
        ops63.ids.length >= 5 &&
        !ops63.ids.some((id) => eng63.ids.includes(id)) &&
        Object.keys(soloEng63.pages).length > 10 &&
        firmaDePaginas(subEng63) === firmaDePaginas(soloEng63) &&
        idsSubOps63.join() === [...ops63.ids].sort().join() &&
        Object.keys(fundido63.pages).length === Object.keys(soloEng63.pages).length + idsSubOps63.length,
      `ENG solo ${Object.keys(soloEng63?.pages || {}).length} · subíndice ENG ${Object.keys(subEng63?.pages || {}).length}` +
        `${firmaDePaginas(subEng63) === firmaDePaginas(soloEng63) ? ' (iguales)' : ' (DISTINTOS)'} · ` +
        `OPS ${ops63.arbol.own} de ${ops63.arbol.total} en ${ops63.arbol.requests} peticiones, portada ${ops63.arbol.homeId} · ` +
        `fundido ${Object.keys(fundido63?.pages || {}).length}`
    )

    // Los títulos que se le darían al indexador de OPS: los de OPS y NINGUNO de
    // ENG. Con el índice fundido a pelo sí irían los de ENG (el control: es el
    // subíndice lo que filtra, no que ENG no esté).
    const idsTitulosOps63 = idsDeTitulos(titulos63(subOps63))
    const idsTitulosTodo63 = idsDeTitulos(titulos63(fundido63))
    ok(
      'los títulos del subíndice de OPS nombran todas sus páginas y ninguna de ENG; los del índice fundido sí llevan las de ENG',
      idsTitulosOps63.length === ops63.ids.length &&
        idsTitulosOps63.every((id) => ops63.ids.includes(id)) &&
        !idsTitulosOps63.some((id) => eng63.ids.includes(id)) &&
        idsTitulosTodo63.some((id) => eng63.ids.includes(id)),
      `OPS: ${idsTitulosOps63.join(' ')} · el fundido nombra ${idsTitulosTodo63.filter((id) => eng63.ids.includes(id)).length} de ENG`
    )

    // Desde una página de ENG, la hoja más honda de OPS: el paso a paso empieza
    // por abrir el espacio OPS (una carga de página, no un despliegue) y ningún
    // paso es una página de ENG. Desde dentro de OPS, ese primer paso no está:
    // es por venir de otro espacio.
    const hoja63 = Object.keys(subOps63?.pages || {}).sort(
      (a, b) => indices63.ancestryOf(fundido63, b).length - indices63.ancestryOf(fundido63, a).length
    )[0]
    const sitioPlan63 = { product: 'confluence', cloud: false, host: location.hostname }
    const destino63 = { navigate: true, mode: 'assisted', destination: { kind: 'confluence-page', id: hoja63 } }
    const desdeEng63 = plan63(destino63, { index: fundido63, origin: ORIGIN, here: ORIGIN + PAGES['page:200'].path, site: sitioPlan63 })
    const desdeOps63 = plan63(destino63, { index: fundido63, origin: ORIGIN, here: ORIGIN + '/wiki/spaces/OPS/pages/5000/Operaciones', site: sitioPlan63 })
    const pasos63 = desdeEng63.ok ? desdeEng63.plan.steps : []
    ok(
      'desde ENG, el paso a paso hasta una página de OPS empieza por abrir el espacio OPS, y ningún paso es de ENG',
      desdeEng63.ok &&
        pasos63.length >= 3 &&
        pasos63[0].kind === 'confluence-space' &&
        pasos63[0].id === 'OPS' &&
        pasos63[0].action === 'open' &&
        pasos63[0].label.startsWith('Espacio') &&
        pasos63.slice(1, -1).every((s) => s.kind === 'confluence-page' && s.action === 'expand' && ops63.ids.includes(s.id)) &&
        pasos63[pasos63.length - 1].id === hoja63 &&
        pasos63[pasos63.length - 1].action === 'open' &&
        !pasos63.some((s) => eng63.ids.includes(s.id)) &&
        desdeOps63.ok &&
        desdeOps63.plan.steps[0].kind === 'confluence-page',
      desdeEng63.ok
        ? `${pasos63.map((s) => `${s.kind === 'confluence-space' ? 'espacio ' : ''}${s.id}:${s.action}`).join(' → ')} · desde OPS empieza por ${desdeOps63.plan?.steps?.[0]?.id}`
        : `sin plan: ${desdeEng63.reason}`
    )

    // La barra lateral no sabe de qué espacio es cada fila: el panel la estampa
    // con el de la pestaña antes de fundirla (`growTreeFromPage`), y sin eso esas
    // páginas no contarían para su mapa. Lo que ya tiene espacio no se toca, y
    // una clave rara no estampa nada. Y el mapa de un espacio lo dice su
    // `indexedAt`, no el índice: desde la revisión adversaria de H21 las páginas
    // no dan mapa (una cosechada o una fila de la barra no lo construyen).
    const filasBarra63 = leerBarra63().pages
    const barra63 = indices63.normalizeIndex({ pages: filasBarra63, updated: Date.now() }, location.hostname, null, {
      cloud: false,
      wikiPrefix: '/wiki',
    })
    const estampada63 = ambitos63.stampSpace(barra63, 'ENG')
    const unaDeOps63 = Object.keys(barra63?.pages || {})[0]
    const mezclada63 = ambitos63.stampSpace(
      { ...barra63, pages: { ...barra63.pages, [unaDeOps63]: { ...barra63.pages[unaDeOps63], spaceKey: 'OPS' } } },
      'ENG'
    )
    const vacios63 = ambitos63.emptyContexts()
    const construidos63 = ambitos63.withContext(
      ambitos63.withContext(vacios63, 'space:ENG', { text: 'x', indexedAt: Date.now() }),
      'space:OPS',
      { text: 'x', indexedAt: Date.now() }
    )
    ok(
      'la barra lateral se estampa con el espacio de la pestaña, y el mapa de cada espacio lo dice su indexado, no sus páginas',
      filasBarra63.length > 10 &&
        Object.keys(estampada63.pages).length === new Set(filasBarra63.map((p) => p.id)).size &&
        Object.values(barra63.pages).every((p) => p.spaceKey === null) &&
        Object.values(estampada63.pages).every((p) => p.spaceKey === 'ENG') &&
        mezclada63.pages[unaDeOps63].spaceKey === 'OPS' &&
        ambitos63.stampSpace(barra63, 'A"B') === barra63 &&
        ambitos63.hasMap(construidos63, fundido63, 'space:OPS') &&
        ambitos63.hasMap(construidos63, fundido63, 'space:ENG') &&
        !ambitos63.hasMap(construidos63, fundido63, 'space:XXX') &&
        !ambitos63.hasMap(vacios63, fundido63, 'space:OPS') &&
        !ambitos63.hasMap(vacios63, fundido63, 'space:ENG'),
      `${filasBarra63.length} filas de la barra · ${Object.values(estampada63.pages).filter((p) => p.spaceKey === 'ENG').length} con ENG · ` +
        `mapa OPS ${ambitos63.hasMap(construidos63, fundido63, 'space:OPS')} · XXX ${ambitos63.hasMap(construidos63, fundido63, 'space:XXX')} · ` +
        `OPS sin construir ${ambitos63.hasMap(vacios63, fundido63, 'space:OPS')}`
    )

    // 64. El subrayado de H23 (forma A, docs/PLAN2.md §3.6). El relleno de las
    //     marcas vive DEBAJO del texto, en dos highlights del documento que no
    //     comparten ni un Range —`faro-quote` con todas menos la activa y
    //     `faro-quote-activa` con la activa, prioridad 1—, porque dos rellenos
    //     traslúcidos sobre la misma letra se apilan y en oscuro dejaban el
    //     texto por debajo de 4,5:1; el overlay dibuja encima sólo el TRAZO de
    //     cada línea (2 px, 3 px la activa; 3 y 4 hasta la revisión adversaria
    //     de H23, que midió que tapaban los descendentes) en un `.quote-rect`
    //     transparente; las insignias suben a superíndice (13 px, 5 px por
    //     encima de la línea) para no tapar lo que se lee detrás de la cita ni
    //     las letras de la línea de arriba; la tinta se elige (azul o ámbar,
    //     «Color del subrayado» de Ajustes) y con la página en tema oscuro
    //     «Señalar» pone el subrayador de cuerpo claro. Sobre las observaciones
    //     de siempre de `page:200` y una fabricada: qué Range es de qué nota, qué
    //     insignia lleva qué número y de qué color era el trazo se leen de la
    //     página, no se escriben aquí.
    runner.clear()
    setSidebar('clasica')
    renderPage('page:200')
    await wait(320)
    const tintaAntes64 = runner.overlay.tint
    runner.setHighlightColor('azul')
    // La fabricada: las tres de OBSERVACIONES acaban en la 1.ª línea de su
    // párrafo, así que ninguna insignia tenía un párrafo encima y lo que tapa por
    // arriba no lo medía nadie (revisión adversaria de H23, A2). Es la primera
    // mitad de la 2.ª línea de «Adoptamos la rotación automática…», elegida por
    // los rects de sus palabras —la línea depende del ancho, como el bloque de
    // `observacionesDePaginaLarga` depende del digest—, nunca escrita a mano; y
    // de ese párrafo porque es el que queda a la vista con la 2 enfocada. Lleva
    // el 5: el 4 de OBSERVACIONES no está en la página.
    const parrafo64 = [...document.querySelectorAll('#page-content p')].find((p) =>
      p.textContent.startsWith('Adoptamos la rotación automática')
    )
    const texto64 = parrafo64?.firstChild
    const lineas64 = []
    for (const m of texto64?.nodeType === Node.TEXT_NODE ? texto64.data.matchAll(/\S+/g) : []) {
      const r = document.createRange()
      r.setStart(texto64, m.index)
      r.setEnd(texto64, m.index + m[0].length)
      const c = r.getClientRects()[0]
      if (!c) continue
      const ultima = lineas64[lineas64.length - 1]
      if (ultima && Math.abs(ultima.top - c.top) < c.height / 2) ultima.palabras.push(m[0])
      else lineas64.push({ top: c.top, palabras: [m[0]] })
    }
    const segunda64 = lineas64[1]?.palabras || []
    const fabricada64 = segunda64.length
      ? {
          n: 5,
          title: 'Una cita que acaba en la segunda linea',
          kind: 'dato',
          anchor: { kind: 'text-quote', exact: segunda64.slice(0, Math.ceil(segunda64.length / 2)).join(' ') },
        }
      : null
    const res64 = await runner.applyNotes({ notes: fabricada64 ? [...OBSERVACIONES, fabricada64] : OBSERVACIONES })
    await wait(500)
    await runner.focusNote({ n: 2 })
    await wait(400)

    //     (1) Los dos highlights, disjuntos, y entre los dos todas las marcas.
    const notas64 = runner.overlay.notes
    const todos64 = notas64.flatMap((x) => x.ranges)
    const activos64 = notas64.find((x) => x.n === 2)?.ranges || []
    const hTodas64 = CSS.highlights.get('faro-quote')
    const hActiva64 = CSS.highlights.get('faro-quote-activa')
    const enTodas64 = hTodas64 ? [...hTodas64] : []
    const enActiva64 = hActiva64 ? [...hActiva64] : []
    ok(
      'subrayado: la activa en su propio highlight, con prioridad 1 y sin repetirse en el de las demas; entre los dos, todas',
      res64.placed.includes(2) &&
        runner.overlay.activeNote === 2 &&
        !!hActiva64 &&
        hActiva64.priority === 1 &&
        activos64.length > 0 &&
        enActiva64.length === activos64.length &&
        activos64.every((r) => hActiva64.has(r)) &&
        !enTodas64.some((r) => hActiva64.has(r)) &&
        enTodas64.length + enActiva64.length === todos64.length &&
        todos64.every((r) => hTodas64?.has(r) || hActiva64.has(r)),
      `notas ${res64.placed.join(',')} con ${todos64.length} Range · activa ${runner.overlay.activeNote} · ` +
        `faro-quote-activa ${enActiva64.length} (prioridad ${hActiva64?.priority}) · faro-quote ${enTodas64.length}`
    )

    //     (2) La insignia es un SUPERÍNDICE: acaba por encima de la mitad de la
    //     caja del carácter que sigue a su cita —como mucho roza su trazo alto;
    //     la mitad de abajo, que es lo que se lee, queda libre— y no se echa
    //     atrás sobre la cita. La caja de un carácter es la que da su Range (su
    //     área de contenido), no la de la línea. Una cita cuyo carácter
    //     siguiente ya cae en otra línea, o no se pinta, no cuenta; una sin
    //     insignia, sí, y falla. El margen está medido con Segoe UI, la letra
    //     del banco en Windows (caja de 19 px, y el `detail` dice la que hay):
    //     con Arial o Helvetica la caja mide 16 y la insignia tapa 5 de los 8 px
    //     del ojo de la palabra siguiente, y que esto falle ahí es decir la
    //     verdad, no un umbral mal puesto (revisión adversaria de H23, B8).
    const caracterSiguiente64 = (rango) => {
      let nodo = rango.endContainer
      let desde = rango.endOffset
      if (nodo.nodeType !== Node.TEXT_NODE) return null
      if (desde >= nodo.data.length) {
        const paseo = document.createTreeWalker(document.getElementById('page-content') || document.body, NodeFilter.SHOW_TEXT)
        paseo.currentNode = nodo
        nodo = paseo.nextNode()
        while (nodo && !nodo.data.length) nodo = paseo.nextNode()
        if (!nodo) return null
        desde = 0
      }
      const r = document.createRange()
      r.setStart(nodo, desde)
      r.setEnd(nodo, desde + 1)
      return r
    }
    const insignias64 = [...runner.overlay.el.noteLayer.children]
    const medidas64 = notas64.map((nota) => {
      const ultimoRango = nota.ranges[nota.ranges.length - 1]
      const finCita = [...(ultimoRango?.getClientRects() || [])].filter((r) => r.width > 0 && r.height > 0).pop()
      const siguiente = ultimoRango ? caracterSiguiente64(ultimoRango) : null
      const caja = siguiente?.getBoundingClientRect()
      const enSuLinea = !!caja && !!finCita && caja.height > 0 && Math.abs(caja.top - finCita.top) < finCita.height / 2
      if (!enSuLinea) return { n: nota.n, cuenta: false, texto: `${nota.n}: sin carácter detrás en su línea` }
      const insignia = insignias64.find((b) => b.dataset.n === String(nota.n))
      if (!insignia) return { n: nota.n, cuenta: true, bien: false, texto: `${nota.n}: SIN insignia` }
      const b = insignia.getBoundingClientRect()
      const mitad = caja.top + caja.height / 2
      const sobra = b.bottom - mitad
      return {
        n: nota.n,
        cuenta: true,
        bien: b.bottom <= mitad && b.left >= caja.left - 1,
        texto:
          `${nota.n}: «${siguiente.toString()}» caja ${Math.round(caja.height)} px (${caja.top.toFixed(1)}+${caja.height.toFixed(1)}) · ` +
          `insignia ${b.top.toFixed(1)}–${b.bottom.toFixed(1)}, mitad ${mitad.toFixed(1)} (${sobra > 0 ? '+' : ''}${sobra.toFixed(1)}) · ` +
          `izquierda ${b.left.toFixed(1)} ≥ ${(caja.left - 1).toFixed(1)}`,
      }
    })
    const cuentan64 = medidas64.filter((m) => m.cuenta)
    ok(
      'subrayado: cada insignia es un superindice que no tapa la mitad de abajo del caracter que sigue a su cita',
      cuentan64.length > 0 && cuentan64.every((m) => m.bien),
      medidas64.map((m) => m.texto).join(' · ')
    )

    //     (5) La otra mitad del (2), y por eso va aquí y no detrás del (4): el
    //     superíndice sube sobre la línea de ARRIBA, y ahí sólo puede pisar los
    //     descendentes, nunca el cuerpo de las letras (nació en la revisión
    //     adversaria de H23, A2: la insignia de 16 px subida 8 se metía 6-10 px
    //     en la caja del carácter de arriba). Se toma el carácter que queda
    //     3 px encima de cada insignia —el anillo mide 2— y cuenta sólo si es de
    //     OTRA línea: en una cita de 1.ª línea `caretRangeFromPoint` devuelve la
    //     misma. Entonces el anillo (`b.top - 2`) no sube del 79 % de esa caja,
    //     que en Segoe UI es su línea base, con medio píxel por el `Math.round`
    //     de overlay.js. Medido (R2, 44 casos de 2.ª línea): con la insignia de
    //     hoy sobra +0,41..+1,37 px; con la de antes faltaban 1,63-2,59. La
    //     fabricada tiene que contar, porque es la única con texto encima: las
    //     otras tres acaban en la 1.ª línea de su párrafo, y sobre la 3 lo que
    //     queda es el hueco bajo el h3 (su caja acaba antes del punto que se
    //     mira), así que sin ella el ok pasaría sin medir nada.
    const caracterEn64 = (caret, y) => {
      const nodo = caret?.startContainer
      if (!nodo || nodo.nodeType !== Node.TEXT_NODE || !nodo.data.length) return null
      const desde = Math.min(caret.startOffset, nodo.data.length - 1)
      for (const i of [desde, desde - 1]) {
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(nodo, i)
        r.setEnd(nodo, i + 1)
        const caja = r.getBoundingClientRect()
        if (caja.height > 0 && caja.top <= y && y <= caja.bottom) return r
      }
      return null
    }
    const arriba64 = notas64.map((nota) => {
      const ultimoRango = nota.ranges[nota.ranges.length - 1]
      const finCita = [...(ultimoRango?.getClientRects() || [])].filter((r) => r.width > 0 && r.height > 0).pop()
      const insignia = insignias64.find((x) => x.dataset.n === String(nota.n))
      if (!finCita || !insignia) return { n: nota.n, cuenta: false, texto: `${nota.n}: sin cita o sin insignia` }
      const b = insignia.getBoundingClientRect()
      const arriba = caracterEn64(document.caretRangeFromPoint(b.left + b.width / 2, b.top - 3), b.top - 3)
      const cajaArriba = arriba?.getBoundingClientRect()
      const otraLinea = !!cajaArriba && cajaArriba.bottom <= finCita.top + 0.5
      if (!otraLinea) return { n: nota.n, cuenta: false, texto: `${nota.n}: sin otra línea encima` }
      const umbral = cajaArriba.top + cajaArriba.height * 0.79 - 0.5
      const margen = b.top - 2 - umbral
      return {
        n: nota.n,
        cuenta: true,
        bien: (b.top - 2) >= cajaArriba.top + cajaArriba.height * 0.79 - 0.5,
        texto:
          `${nota.n}: «${arriba.toString()}» de ${arriba.startContainer.parentElement?.tagName || '?'} arriba, ` +
          `caja ${Math.round(cajaArriba.height)} px (${cajaArriba.top.toFixed(1)}+${cajaArriba.height.toFixed(1)}) · ` +
          `anillo ${(b.top - 2).toFixed(1)} ≥ ${umbral.toFixed(2)} (${margen >= 0 ? '+' : ''}${margen.toFixed(2)})`,
      }
    })
    const cuentanArriba64 = arriba64.filter((m) => m.cuenta)
    ok(
      'subrayado: la insignia en superindice no tapa las letras de la linea de arriba, solo sus descendentes',
      cuentanArriba64.length > 0 &&
        cuentanArriba64.every((m) => m.bien) &&
        !!fabricada64 &&
        cuentanArriba64.some((m) => m.n === fabricada64.n),
      (fabricada64 ? `fabricada 5 «${fabricada64.anchor.exact}» · ` : 'SIN fabricada: el párrafo no tiene 2.ª línea · ') +
        arriba64.map((m) => m.texto).join(' · ')
    )

    //     (3) El trazo: la caja del overlay es transparente —el relleno vive en
    //     el highlight, debajo del texto— y su `::after` es la pastilla de
    //     tinta, 2 px, y 3 px en la activa (3 y 4 hasta la revisión adversaria
    //     de H23: el de 3 tapaba 1,5-2,3 de los 3 px de los descendentes con
    //     Segoe 14, G03).
    const cajas64 = [...runner.overlay.el.quoteLayer.children]
    const normales64 = cajas64.filter((d) => !d.classList.contains('active'))
    const activas64 = cajas64.filter((d) => d.classList.contains('active'))
    const fondos64 = [...new Set(cajas64.map((d) => getComputedStyle(d).backgroundColor))]
    const alto64 = (d) => getComputedStyle(d, '::after').height
    ok(
      'subrayado: el rectangulo del overlay es transparente y su trazo mide 2 px, 3 px en la activa',
      normales64.length > 0 &&
        activas64.length > 0 &&
        fondos64.length === 1 &&
        fondos64[0] === 'rgba(0, 0, 0, 0)' &&
        normales64.every((d) => alto64(d) === '2px') &&
        activas64.every((d) => alto64(d) === '3px'),
      `${cajas64.length} cajas, ${activas64.length} de la activa · fondo ${fondos64.join(' | ')} · ` +
        `trazo ${[...new Set(normales64.map(alto64))].join('/')}, ${[...new Set(activas64.map(alto64))].join('/')} en la activa`
    )

    //     (4) La tinta llega a la página (`runner.setHighlightColor`, que es lo
    //     que hace bootstrap con el ajuste): en ámbar el host lleva
    //     `faro-tinta-ambar`, la hoja del relleno cambia y el trazo cambia de
    //     color; en azul todo vuelve a como estaba. Y con la página en tema
    //     oscuro, «Señalar» pone `faro-picking-dark` —el subrayador de cuerpo
    //     claro, otro cursor que el de la página clara— y al cancelar lo quita.
    //     El banco no tiene tema oscuro propio: se pone `data-color-mode`, que
    //     es lo que lee `_applyColorScheme` al montar, se le pide que lo relea,
    //     y se deja como estaba pase lo que pase: «Señalar» se cancela en su
    //     propio `finally` (`cancel()` es idempotente; sin él, algo que lanzase
    //     entre `start()` y `cancel()` dejaba `<html>` con `faro-picking`), y el
    //     de fuera devuelve el tema, la tinta de antes y quita las notas
    //     (revisión adversaria de H23, B4). El ok no depende de las notas.
    const host64 = document.getElementById('faro-overlay-host')
    const vistaTinta64 = () => ({
      clase: !!host64?.classList.contains('faro-tinta-ambar'),
      hoja: document.getElementById('faro-highlight-style')?.textContent || '',
      trazo: normales64[0] ? getComputedStyle(normales64[0], '::after').backgroundColor : '',
    })
    const relleno64 = (hoja) => /::highlight\(faro-quote\)\s*\{[^}]*background-color:\s*(rgba?\([^)]*\))/.exec(hoja)?.[1] || '—'
    const azulAntes64 = vistaTinta64()
    runner.setHighlightColor('ambar')
    const ambar64 = vistaTinta64()
    runner.setHighlightColor('azul')
    const azulDespues64 = vistaTinta64()

    const html64 = document.documentElement
    const modoAntes64 = html64.getAttribute('data-color-mode')
    const senalarCon64 = async (modo) => {
      html64.setAttribute('data-color-mode', modo)
      runner.overlay._applyColorScheme()
      try {
        const espera = picker.start()
        const vista = { oscuro: html64.classList.contains('faro-picking-dark'), cursor: getComputedStyle(html64).cursor }
        picker.cancel()
        await espera
        vista.quitado = !html64.classList.contains('faro-picking-dark') && !html64.classList.contains('faro-picking')
        return vista
      } finally {
        picker.cancel()
      }
    }
    let claro64 = null
    let oscuro64 = null
    try {
      claro64 = await senalarCon64('light')
      oscuro64 = await senalarCon64('dark')
    } finally {
      if (modoAntes64 === null) html64.removeAttribute('data-color-mode')
      else html64.setAttribute('data-color-mode', modoAntes64)
      runner.overlay._applyColorScheme()
      runner.setHighlightColor(tintaAntes64)
      runner.clearNotes()
    }
    ok(
      'subrayado: la tinta ambar llega a la pagina y la azul la deja como estaba; en una pagina oscura, Señalar pone su cursor y lo quita',
      !azulAntes64.clase &&
        azulAntes64.hoja.includes('rgba(59, 130, 246, .28)') &&
        ambar64.clase &&
        ambar64.hoja.includes('rgba(233, 172, 74, .28)') &&
        !!ambar64.trazo &&
        ambar64.trazo !== azulAntes64.trazo &&
        !azulDespues64.clase &&
        azulDespues64.hoja === azulAntes64.hoja &&
        azulDespues64.trazo === azulAntes64.trazo &&
        !!claro64 &&
        !claro64.oscuro &&
        claro64.cursor.startsWith('url(') &&
        claro64.quitado &&
        !!oscuro64 &&
        oscuro64.oscuro &&
        oscuro64.cursor.startsWith('url(') &&
        oscuro64.cursor !== claro64.cursor &&
        oscuro64.quitado,
      `azul: relleno ${relleno64(azulAntes64.hoja)}, trazo ${azulAntes64.trazo} · ` +
        `ámbar: clase ${ambar64.clase}, relleno ${relleno64(ambar64.hoja)}, trazo ${ambar64.trazo} · ` +
        `de vuelta: clase ${azulDespues64.clase}, relleno ${relleno64(azulDespues64.hoja)}, trazo ${azulDespues64.trazo} · ` +
        `Señalar en claro: faro-picking-dark ${claro64?.oscuro}, quitado ${claro64?.quitado} · ` +
        `en oscuro: faro-picking-dark ${oscuro64?.oscuro}, quitado ${oscuro64?.quitado}, ` +
        `cursor ${oscuro64 && claro64 && oscuro64.cursor !== claro64.cursor ? 'distinto del claro' : 'IGUAL que el claro'}`
    )

    setSidebar('clasica')
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
  // Las tres formas de barra lateral, por su nombre («clasica», «cloud»,
  // «pagetree»): `actions.sidebar()` las recorre en círculo, pero los tramos
  // 60-62 piden una concreta y desde fuera hay que poder ponerla sin dar tres
  // vueltas al botón.
  setSidebar,
  PAGES,
  OBSERVACIONES,
  pageDigest,
  jiraIssueFields,
  jiraIssueKey,
  // De H10, lo que se lee de la pantalla para sugerir páginas base: es DOM
  // puro, así que se expone entero y no a demanda como los módulos del panel.
  pageLinks,
  // Y de H11, el id de la página que se tiene delante: en un Data Center sólo
  // está en el DOM, así que va aquí por lo mismo que `pageLinks`.
  pageIdFromDom,
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
  // Y de H10, los tres módulos que puntúan y explican una sugerencia. Viven en
  // src/panel/, así que a demanda como los demás: el banco no los necesita
  // para pintar, y quien dirija el tramo 55 desde fuera los quiere enteros.
  sourceSuggest: () => import('/src/panel/source-suggest.js'),
  references: () => import('/src/panel/references.js'),
  sourceHistory: () => import('/src/panel/source-history.js'),
  // Y de H11, las dos mitades de «qué mirar hoy»: la que puntúa y explica
  // (src/panel/) y el diario local (src/atlassian/), más el diario de ejemplo
  // con el que se prueban los tramos 56-59 desde fuera. Funciones, como los
  // demás: el diario depende del reloj que se le pase.
  today: () => import('/src/panel/today.js'),
  activity: () => import('/src/atlassian/activity.js'),
  diarioDeEjemplo: async (ahora = Date.now()) => diarioDeMentira(await import('/src/atlassian/activity.js'), ahora),
  // Y de H21, lo que decide el contexto y el mapa POR ESPACIO (subíndice,
  // estampar la barra, si un espacio tiene mapa…): a demanda como los demás,
  // para poder repetir el tramo 63 desde fuera sin pasar por los de antes.
  scopes: () => import('/src/shared/scopes.js'),
  // Y de H23, el cursor de «Señalar» (el SVG, su URL `data:` y la regla con su
  // punto activo), a demanda: para mirarlo a otro tamaño o con el otro tema sin
  // tener que arrancar el selector.
  cursor: () => import('/src/content/overlay/cursor.js'),
}
say('banco listo')
