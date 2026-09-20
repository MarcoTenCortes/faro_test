/** Tipos de mensaje entre panel, service worker y content script. */

export const MSG = {
  // panel -> service worker
  START_PLAN: 'faro:start-plan',
  CANCEL_PLAN: 'faro:cancel-plan',
  NAVIGATE_DIRECT: 'faro:navigate-direct',
  REQUEST_HOST_PERMISSION: 'faro:request-host-permission',
  CONTENT_STATUS: 'faro:content-status',

  // service worker -> content script
  PING: 'faro:ping',
  STEP: 'faro:step',
  ANCHOR: 'faro:anchor',
  CANCEL: 'faro:cancel',
  SETTINGS: 'faro:settings',
  TREE_SNAPSHOT: 'faro:tree-snapshot',
  TREE_DEBUG: 'faro:tree-debug',

  // panel -> content script
  PICK_START: 'faro:pick-start',
  PICK_CANCEL: 'faro:pick-cancel',
  PAGE_DIGEST: 'faro:page-digest',
  PAGE_ANCESTORS: 'faro:page-ancestors',
  PAGE_SEARCH: 'faro:page-search',
  ANNOTATE: 'faro:annotate',
  FOCUS_NOTE: 'faro:focus-note',
  CLEAR_NOTES: 'faro:clear-notes',

  // panel -> content script: lecturas REST del propio sitio con la sesión del
  // navegador (H7). Las contesta el content script porque es quien está en el
  // origen del sitio; el panel nunca manda rutas ni URLs, sólo la consulta o el
  // `kind` de una plantilla fija, y el content script deduce de SU pestaña la
  // ruta de contexto. Nacen con receptor y sin emisor a propósito: los cablean
  // H8 (JQL_SEARCH, FAVOURITE_FILTERS), H9 (SPACE_PAGES) y H11 (RECENT_*), y
  // hasta entonces la lista MSG_SIN_EMISOR_HASTA de tools/check-docs.mjs los
  // declara pendientes.
  JQL_SEARCH: 'faro:jql-search',
  RECENT_ISSUES: 'faro:recent-issues',
  RECENT_PAGES: 'faro:recent-pages',
  SPACE_PAGES: 'faro:space-pages',
  FAVOURITE_FILTERS: 'faro:favourite-filters',

  // content script -> service worker / panel
  CONTENT_READY: 'faro:content-ready',
  URL_CHANGED: 'faro:url-changed',
  PICK_RESULT: 'faro:pick-result',
  NOTE_CLICKED: 'faro:note-clicked',

  // service worker -> panel
  PLAN_PROGRESS: 'faro:plan-progress',
  PLAN_FINISHED: 'faro:plan-finished',
}

/** Envío tolerante: un content script que no está no debe romper nada. */
export async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch {
    return null
  }
}
