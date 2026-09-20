/** Constantes y valores por defecto. Sin dependencias del navegador. */

export const EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'
export const CORS_ORIGIN = `chrome-extension://${EXTENSION_ID}`

export const DEFAULT_SERVER = 'http://127.0.0.1:4096'

/** Nombre del servidor MCP en opencode para un host dado. */
export function mcpNameForHost(host) {
  return 'atlassian-' + String(host).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

/**
 * Cómo lleva Faro al usuario a un sitio.
 *
 * `guided`: intenta siempre enseñar el camino. Lee de quién cuelga el destino
 * y ofrece «Paso a paso» destacado; si no conoce el camino, lleva de golpe.
 * `quick`: lleva directamente, siempre. No se lee el árbol ni se espera nada.
 */
export const NAV_MODES = ['guided', 'quick']

/**
 * Tiempos de la navegación asistida. Es el ÚNICO sitio donde viven: el content
 * script (bootstrap.js) construye el NavRunner con una copia, runner.js cae en
 * estos valores cuando el panel no manda otros, y el service worker abandona
 * un paso atascado a los `stepStallMs`. Pasó de verdad (auditoría de
 * 2026-09-13): los mismos números estaban copiados a mano en esos tres
 * ficheros y cambiarlos aquí no cambiaba nada; nav-timing.test.js lo vigila.
 */
export const NAV_TIMING = {
  locateTimeoutMs: 2500, // cuánto se espera a que aparezca el enlace o la rama de un paso
  scrollSettleMs: 340, // reposo tras traer una fila del árbol a la vista
  stepPauseMs: 1600, // pausa con la tarjeta puesta antes de pulsar (el ajuste «stepDelayMs» del usuario)
  expandBudgetMs: 15000, // tope del barrido a ciegas por el árbol hacia el destino…
  maxExpandClicks: 40, // …y su tope de clics
  settleQuietMs: 220, // la página se da por quieta tras este silencio de mutaciones…
  settleMaxMs: 6000, // …o, como mucho, tras este tiempo
  stepStallMs: 9000, // el service worker abandona un paso cuya pestaña no avisa en este tiempo
}

/**
 * Cuánto vale la medida de la cabecera pegajosa antes de volver a tomarla.
 *
 * `stickyOffset()` (dom-utils.js) recorre hasta 400 elementos con un
 * `getComputedStyle` cada uno para saber qué barras hay fijadas arriba, y un
 * solo desplazamiento lo llama dos veces (`scrollToElement` y, dentro,
 * `scrollToRect`). En 400 ms la cabecera no cambia de sitio; si el usuario
 * cambia el tamaño de la ventana sí, y eso se nota sin esperar porque la
 * medida se guarda junto al tamaño del viewport con el que se tomó.
 */
export const STICKY_CACHE_MS = 400

export const DEFAULT_SETTINGS = {
  serverUrl: DEFAULT_SERVER,
  password: '',
  crossSessionMemory: false,
  navMode: 'guided',
  stepDelayMs: NAV_TIMING.stepPauseMs,
  reduceMotion: false,
  highlightStyle: 'spotlight',
  /**
   * El interruptor maestro de TODA lectura REST nueva: la lista de una búsqueda,
   * las búsquedas al instante, el perfil del proyecto, el índice por la API y
   * las sugerencias por actividad (docs/PLAN.md §3.3). Activo por defecto porque
   * es lo que hace que Faro conteste en milisegundos y sin gastar tokens; se
   * apaga entero porque un sitio detrás de un SSO que devuelve una página de
   * login en cada GET daría un aviso en cada pregunta.
   *
   * NO apaga `fetchAncestors` ni `searchPages`, que son las lecturas de las
   * páginas base y del camino y llevan funcionando desde antes: eso es
   * comportamiento pinado y no cambia (docs/PLAN.md §3.3).
   */
  restTools: true,
  /**
   * «Qué mirar hoy» (H11): las recomendaciones por actividad reciente.
   *
   * Está SUBORDINADO a `restTools`: apagado el maestro, esto no consulta nada
   * aunque siga marcado. Y manda sobre las dos cosas que hace esta función, no
   * sólo sobre la lista: con él apagado el service worker tampoco APUNTA la
   * visita, porque quien no quiere que el panel toque la API de su sitio
   * tampoco quiere un diario de lo que abre (docs/PLAN.md §3.1, §8.20).
   */
  todaySuggestions: true,
}

/**
 * Ajustes guardados por una versión anterior, en la forma actual. Pura.
 *
 * Hasta ahora había una casilla, `assistedByDefault`: marcada, la tarjeta
 * destacaba «Paso a paso»; sin marcar, «Llévame», pero seguía ofreciendo las
 * dos. Quien la desmarcó quería menos recorrido, así que pasa al modo rápido;
 * el resto se queda en el guiado, que era y sigue siendo el de por defecto.
 */
export function migrateSettings(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!NAV_MODES.includes(s.navMode)) {
    s.navMode = s.assistedByDefault === false ? 'quick' : DEFAULT_SETTINGS.navMode
  }
  delete s.assistedByDefault
  // Unos ajustes guardados antes de H7 no tienen el interruptor de las lecturas
  // REST. Se rellena con el valor de por defecto, y lo que el usuario haya
  // elegido se respeta; cualquier otra cosa en esa casilla no la escribió Faro
  // y cuenta como no elegida.
  if (typeof s.restTools !== 'boolean') s.restTools = DEFAULT_SETTINGS.restTools
  // Igual con el de las sugerencias por actividad (H11): unos ajustes de antes
  // no lo traen, y lo que no es un booleano no lo escribió Faro.
  if (typeof s.todaySuggestions !== 'boolean') s.todaySuggestions = DEFAULT_SETTINGS.todaySuggestions
  return s
}

/**
 * Topes del indexador: evitan que «indexar Confluence» se vuelva infinito.
 *
 * `restMaxRequests` es el tope de PETICIONES del árbol leído de la API
 * (`fetchSpacePages`, H7): con `maxPages` 300 y 100 páginas por petición sobran,
 * y es lo que evita que un espacio enorme —o un servidor que siempre dice que
 * hay más— se convierta en decenas de GET. Las páginas siguen teniendo UN solo
 * tope, `maxPages`, que es el mismo para el índice venga de donde venga.
 */
export const INDEX_LIMITS = {
  maxPages: 300,
  maxDepth: 4,
  maxIssues: 120,
  restMaxRequests: 12,
  timeoutMs: 10 * 60 * 1000,
}

/**
 * Cuántos mensajes se piden al restaurar la conversación.
 *
 * `listMessages` sin `limit` trae la sesión ENTERA, y en una sesión de opencode
 * lo que pesa no son los textos sino las salidas de las herramientas: medido
 * contra un servidor desechable, 7 mensajes eran 4 890 KB y los dos últimos
 * 14 KB (auditoría del 2026-09-13). Eso se descargaba cada vez que se abre el
 * panel, se cambia de pestaña o se cierra Ajustes, para pintar sólo el texto.
 *
 * 60 es un TOPE DE SEGURIDAD, no una ventana: las sesiones reales de Faro son
 * de 1 a 4 turnos de usuario (77 sesiones de la base de esta máquina), o sea
 * unos 8 mensajes, así que en la práctica no recorta ninguna. Cuando sí recorta,
 * el chat lo dice y ofrece traer el resto.
 *
 * Comprobado contra opencode 1.2.25: `?limit=N` devuelve los ÚLTIMOS N en orden
 * ascendente (el más viejo primero), igual que sin `limit`.
 */
export const RESTORE_LIMITS = { messages: 60 }

/**
 * Cuándo se avisa de que la conversación arrastra demasiado.
 *
 * Las salidas de las herramientas se quedan en el historial de la sesión y se
 * reenvían en cada turno (el `system` no). opencode las poda —deja intactos los
 * últimos 40 000 tokens (`PRUNE_PROTECT`, leído del binario) y recorta hacia
 * atrás—, así que avisar por debajo de eso sería avisar de algo que el servidor
 * ya resuelve solo. 200 000 caracteres son ≈50 000 tokens: el primer punto en el
 * que la conversación arrastra de verdad MÁS de lo que la poda protege.
 *
 * Es una hipótesis medible: los KB por turno salen en «Respuesta recibida».
 */
export const SESSION_LIMITS = { heavyToolChars: 200000 }

/**
 * El perfil de un proyecto de Jira guardado por host (H9).
 *
 * Su FORMA —cuántos tipos, cuántos prefijos, cuántos ejemplos y cuánto mide
 * cada nombre— la decide `JIRA_REST_LIMITS` en el módulo que lo cuenta
 * (`jira-rest.js`, donde vive `profileFromSample`): aquí sólo está lo que es de
 * ALMACENAMIENTO, para no acabar con dos topes de lo mismo diciendo cosas
 * distintas.
 *
 * `ttlMs`: cuánto vale un perfil guardado antes de volver a contarlo. Un flujo
 * de trabajo gana estados, componentes o convenciones de nombre cada semanas,
 * no cada hora, y recontarlo cuesta una petición con la sesión del usuario que
 * sólo se hace cuando ya hay permiso sobre el dominio (§8.22: nunca en el
 * camino crítico del arranque).
 */
export const PROFILE_LIMITS = { ttlMs: 24 * 60 * 60 * 1000 }

export const STORAGE_KEYS = {
  settings: 'faro:settings',
  sites: 'faro:sites',
  index: (host) => `faro:index:${host}`,
  session: (host) => `faro:session:${host}`,
  // Lo que llevan devuelto las herramientas en la sesión abierta de ese host.
  // Va en storage.session, al lado de `session`: nace y muere con ella.
  sessionWeight: (host) => `faro:session-weight:${host}`,
  context: (host) => `faro:context:${host}`,
  memory: (host) => `faro:memory:${host}`,
  // Lo que la extensión contó de una muestra del proyecto de ese Jira (tipos,
  // estados, componentes, etiquetas y convenciones de nombre). Es la PRIMERA
  // clave por host que viaja en el paquete del sitio (`BUNDLE_EXTRA_KEYS`).
  profile: (host) => `faro:profile:${host}`,
  // Qué páginas base eligió el usuario para analizar qué, en este sitio: la
  // señal con la que se sugieren páginas base sin gastar un token (H10). Es un
  // rastro local —claves, ids y títulos, nunca texto— y por eso vive en su
  // propia clave: se borra con «Olvidar el historial» y con «Olvidar este
  // sitio», sin llevarse por delante el modelo ni el MCP del sitio.
  //
  // Las PÁGINAS DE REFERENCIA del contexto no tienen clave: docs/PLAN.md §3.2
  // descartó la lista estructurada del indexador, así que se sacan del
  // CONTEXT.md al vuelo (`referencesFromContext`) y no hay nada que guardar.
  // Una clave que nadie escribe es una promesa falsa.
  sourceHistory: (host) => `faro:source-history:${host}`,
  // El diario local de actividad (H11): qué abriste, qué analizaste y qué usas
  // como página base en ese host. Es del USUARIO y no sale del navegador; se
  // borra con «Borrar mi actividad» y con «Olvidar este sitio». Por host de la
  // ENTIDAD: una página del Confluence enlazado analizada desde Jira se apunta
  // en el host de Confluence, que es donde su pestaña la verá.
  activity: (host) => `faro:actividad:${host}`,
  // Y la caché de lo que contestaron las API para «qué mirar hoy». Va en
  // storage.session, como la sesión: abrir el panel cinco veces en una mañana
  // no puede costar cinco tandas de peticiones, y al cerrar Chrome se va sola.
  today: (host) => `faro:today:${host}`,
}

/**
 * Permisos con los que Faro abre TODAS sus sesiones de opencode: una regla
 * que deniega todo y sólo el MCP de Atlassian permitido. Viven en
 * permissions.js (puro, con la simulación de cómo los evalúa opencode 1.2.25
 * para poder probarlos en Node y el porqué entero); se reexportan desde aquí
 * para que nadie cambie sus imports.
 *
 * Comprobado contra opencode 1.2.25: el `permission` de la sesión se respeta
 * (va DETRÁS de las reglas del agente y manda sobre ellas). El campo `tools`
 * del mensaje (marcado como obsoleto) también: lo convierte en reglas de
 * permiso de la sesión, persistentes. Faro simplemente no lo manda.
 */
export { SAFE_PERMISSIONS } from './permissions.js'
