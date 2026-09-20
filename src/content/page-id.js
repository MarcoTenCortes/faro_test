/**
 * El id de la página de Confluence que se tiene delante, leído del DOM.
 *
 * Un fichero para una función de tres líneas, y con motivo: esto lo pide el aviso
 * de «esta pestaña está lista» (`CONTENT_READY`), que corre en CADA carga de
 * página de Jira y de Confluence, antes de que el panel haya mandado nada. Vivía
 * en `dom-utils.js`, que son 11 KB y arrastra `tree-dom.js` y `config.js` por
 * imports estáticos: unos 37 KB que Chrome pedía, parseaba y ejecutaba en cada
 * navegación para hacer UN `querySelector` (lo encontró la revisión adversaria de
 * H11). Aquí no hay ni un import, así que el aviso cuesta lo que pesa este
 * fichero; `dom-utils.js` se sigue cargando cuando de verdad hace falta mover
 * algo por la página.
 */

/**
 * El id de la página de Confluence, o ''.
 *
 * En un Confluence Server/Data Center una página es `/display/ESPACIO/Título`:
 * la URL NO lleva el id por ninguna parte, así que `parseAtlassianUrl` no lo
 * puede dar y sin esto no habría nada con lo que apuntar la visita ni con lo que
 * reconstruir su enlace. Confluence pone ese id en una `<meta name="ajs-*">` de
 * la cabecera (las mismas que alimentan `AJS.params`), y es lo único fiable que
 * hay. En Cloud esa meta no existe, pero allí el id ya viaja en la URL.
 *
 * Sólo cifras: el contenido de una meta lo escribe la página, y de aquí sale un
 * identificador que acaba en una clave de almacenamiento y en una URL. Se lee
 * con `getAttribute` y no con `.content` para no depender de que el elemento sea
 * un `HTMLMetaElement` de verdad.
 */
export function pageIdFromDom() {
  const raw = document.querySelector('meta[name="ajs-page-id"]')?.getAttribute('content')
  const id = String(raw ?? '').trim()
  return /^\d{1,19}$/.test(id) ? id : ''
}
