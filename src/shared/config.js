/** Constantes y valores por defecto. Sin dependencias del navegador. */

export const EXTENSION_ID = 'ickohiffpicdfeameogbihbcanbjibmk'
export const CORS_ORIGIN = `chrome-extension://${EXTENSION_ID}`

export const DEFAULT_SERVER = 'http://127.0.0.1:4096'

/**
 * La versión de mcp-atlassian que Faro escribe en el `command` del MCP
 * (`uvx mcp-atlassian@<versión>`) y la que `tools/instalar.ps1` instala con
 * `uv tool install mcp-atlassian==<versión>`: UNA constante para las dos, y
 * `instalar.test.js` pina que el script lleve la misma (docs/PLAN2.md §8.4).
 * Es la probada: con la caché caliente `uvx mcp-atlassian@0.23.1 --version`
 * contesta en 1,3 s (H15, 2026-09-26). Se sube a mano, a cambio de que todo el
 * equipo lleve la misma: uvx no actualiza solo, y sin fijarla cada compañero
 * se quedaba con la del día de su primer arranque.
 */
export const MCP_ATLASSIAN_VERSION = '0.23.1'

/**
 * La versión de opencode contra la que está verificado todo lo que Faro sabe
 * de su API (CLAUDE.md §7), y en concreto la recarga en caliente de H18:
 * `PATCH /global/config` escribe el fichero Y recarga los MCP sin reiniciar,
 * pero eso NO está documentado y upstream cerró sin fusionar los PR de
 * recarga (anexo 2-A). Con otra versión, el panel lo dice en el texto de
 * espera («si el MCP no aparece, reinícialo») en vez de prometer que aparecerá.
 */
export const OPENCODE_VERIFIED_VERSION = '1.2.25'

/**
 * Los tiempos de la espera tras escribir el MCP en la configuración (H18).
 *
 * `appearMs` 20 s: cuánto se sondea `GET /mcp` hasta que la entrada escrita
 * APAREZCA. Con un MCP de juguete aparece en 180-210 ms (medido en un
 * opencode 1.2.25 aislado, anexo 2-A), pero el primer `GET` tras el PATCH
 * puede contestarlo todavía la instancia vieja, y una versión que no recargue
 * no la enseñará nunca: pasado el plazo se dice «ya está escrito; reinicia
 * opencode» en vez de esperar a ciegas. `pollMs` 400: bastante menos que lo
 * que tarda en aparecer de verdad, sin martillear el servidor. `fastFailMs`
 * 2 s: un «Connection closed» antes de eso es que el proceso ni arrancó (uvx
 * ausente da ese error a los ~40-190 ms), y es cuando tiene sentido el
 * reintento con la ruta absoluta de uvx; un fallo más tardío es otra cosa.
 */
export const MCP_RELOAD_LIMITS = { appearMs: 20000, pollMs: 400, fastFailMs: 2000 }

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
  /**
   * El modelo de la PERSONA, `{providerID, modelID}` (H16, docs/PLAN2.md §8.25).
   *
   * Global y no por sitio: el modelo lo decide el plan de quien usa Faro, no el
   * Jira o el Confluence que tenga abierto, y así el segundo sitio no vuelve a
   * preguntar. null hasta que alguien lo elige: ningún modelo se elige solo la
   * primera vez (el `pickDefaultModel` de antes cogía el primer default de
   * opencode, `openai/gpt-5.4`, que el plan del compañero de Marco no permitía).
   * El `model` que se guardaba por sitio queda como migración (`resolveModel`).
   */
  model: null,
  /**
   * Si la persona ya dio su permiso para que Faro escriba el MCP en la
   * configuración de opencode (H18, docs/PLAN2.md §3.2). Global, y false hasta
   * que marca la casilla la primera vez: escribir reformatea su fichero y
   * reinicia todas las conexiones de ese opencode, y eso se pregunta antes.
   */
  configWriteConsent: false,
}

/** Lo más largo que se admite en un id de proveedor o de modelo guardado. */
const MODEL_ID_MAX = 120

/**
 * Un id de proveedor o de modelo tal como se guarda: una cadena no vacía,
 * recortada, ≤ `MODEL_ID_MAX` y sin saltos ni controles, o null. Los saltos se
 * miran con escape (`\s` de JS no cubre el NEL, U+0085).
 */
function idGuardado(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.length > MODEL_ID_MAX) return null
  return new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]').test(v) ? null : v
}

/**
 * `settings.model` con claves blancas, o null. Pura: lo que no tiene la forma
 * `{providerID, modelID}` con las dos cadenas buenas no lo escribió Faro, y un
 * modelo a medias acabaría en el cuerpo de un turno.
 */
function modeloGuardado(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const providerID = idGuardado(raw.providerID)
  const modelID = idGuardado(raw.modelID)
  return providerID && modelID ? { providerID, modelID } : null
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
  // El modelo de la persona (H16): sólo `{providerID, modelID}` con las dos
  // cadenas buenas, reconstruido con claves blancas; lo demás, null.
  s.model = modeloGuardado(s.model)
  // El permiso para escribir en la configuración de opencode (H18): sólo un
  // booleano de verdad cuenta como dado; lo demás, como no preguntado.
  if (typeof s.configWriteConsent !== 'boolean') s.configWriteConsent = DEFAULT_SETTINGS.configWriteConsent
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
 *
 * `maxPagesTotal` (H21) es el tope de páginas del índice ENTERO de un host, que
 * desde H21 guarda varios espacios (docs/PLAN2.md §3.4): cinco espacios de
 * `maxPages`. `persistIndex` escribe el objeto entero en cada turno (P3, H6) y
 * `npm run bench` mide lo que pesa (300, 1 500 y 3 000 páginas). Al alcanzarse
 * NO se desaloja ningún espacio solo —sería lo contrario de «que se guarde un
 * árbol u otro»—: indexar uno nuevo por la API se para con un aviso hasta que
 * se olvide el mapa de otro desde Ajustes (decisión 9). `maxPages` sigue siendo
 * el ÚNICO tope por espacio.
 */
export const INDEX_LIMITS = {
  maxPages: 300,
  maxPagesTotal: 1500,
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

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

/**
 * Lo que Faro recuerda de cada modelo (H16, `faro:model-checks`; docs/PLAN2.md
 * §3.3 y §8.25). Los topes de su FORMA viven aquí, como `PROFILE_LIMITS`: uno
 * por módulo, y models.js los importa.
 *
 * `ttlMs` es cuánto vale un veredicto según su motivo, porque cada motivo cambia
 * a un ritmo distinto:
 * - `ok` 7 días: si contestó, lo normal es que siga contestando; y si deja de
 *   hacerlo, el primer turno que falle lo apunta gratis (no hace falta sondear).
 * - `plan` 7 días: «no está en tu plan» o «no existe para este integrador» no
 *   cambia solo; cambia cuando cambias de plan, que es cosa de semanas.
 * - `credenciales` 1 h: se arregla con `opencode auth login` en un minuto, y
 *   tenerlo marcado un día entero después de arreglarlo sería castigar a quien
 *   lo arregló.
 * - `mudo` 1 día: un modelo que no contesta suele ser un gratuito saturado o un
 *   despliegue a medias; mañana es otra historia, esta tarde probablemente no.
 * - `transitorio` 15 min: un 429 o un 503 es exactamente eso, pasajero.
 * - `otro` 1 h: no se sabe qué fue; lo bastante para no volver a proponerlo en
 *   el mismo rato, lo bastante corto para no condenarlo por un error raro.
 *
 * `maxEntries` 100: una persona tiene del orden de 40 modelos conectados (43 en
 * la máquina de Marco); con 100 caben todos y los de un cambio de proveedor.
 * `messageMax` 200: el mensaje del proveedor se guarda para enseñarlo, y el de
 * Copilot con su lista de 57 modelos mide más de mil caracteres.
 *
 * `probeMs` 15 s (H17): el plazo de la sonda de «Comprobar» (`probeModel` del
 * cliente), que es a la vez su `stallMs` y su `maxMs`. Es el mismo `PROBE_MS`
 * con el que la integración ya decide si un modelo está vivo: un rechazo llega
 * en 0,2-1,3 s en caliente (anexo 2-C), y un modelo que en quince segundos no
 * dice «ok» a una pregunta de dos palabras no va a contestar un análisis. Más
 * largo sería tener al usuario mirando «Comprobando…» por un modelo mudo.
 */
export const MODEL_LIMITS = {
  ttlMs: {
    ok: 7 * DIA,
    plan: 7 * DIA,
    credenciales: HORA,
    mudo: DIA,
    transitorio: 15 * 60 * 1000,
    otro: HORA,
  },
  maxEntries: 100,
  messageMax: 200,
  probeMs: 15000,
}

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
  // Cuándo se borró por última vez el diario de ese host. Va en storage.session
  // porque la escribe un contexto (el panel, al borrar) y la lee el otro (el
  // service worker, antes de guardar una visita que había leído ANTES del
  // borrado: sin esta marca, esa escritura devolvía el diario entero unos
  // milisegundos después). Es un instante y nada más, y muere con el navegador:
  // al arrancar Chrome no hay ninguna escritura en vuelo que desmentir.
  activityCleared: (host) => `faro:actividad-borrada:${host}`,
  // Y la caché de lo que contestaron las API para «qué mirar hoy». Va en
  // storage.session, como la sesión: abrir el panel cinco veces en una mañana
  // no puede costar cinco tandas de peticiones, y al cerrar Chrome se va sola.
  today: (host) => `faro:today:${host}`,
  // Lo que Faro sabe de cada MODELO (H16): cuál contestó y cuál falló, y por
  // qué, con su caducidad (`MODEL_LIMITS`). Es GLOBAL —una cadena, no una
  // función de un host—, porque el modelo es de la persona y del opencode con
  // el que habla, no de un sitio: «Olvidar este sitio» no lo toca. Se ve y se
  // borra aparte (docs/PLAN2.md §8.25).
  modelChecks: 'faro:model-checks',
}

/**
 * En qué área del almacén vive cada clave de arriba: `storage.local` o
 * `storage.session` (H13).
 *
 * Hasta aquí el área estaba sólo en los comentarios, y con eso «Olvidar este
 * sitio» tenía que saberse de memoria cuáles se borran de `local` y cuáles de
 * `session`: dos listas escritas a mano en otro fichero. Así se quedaron sin
 * borrar el contexto y la memoria del sitio —`forgetSite` no las tocaba, las
 * borraba el manejador del botón, y cualquier otro llamante las habría dejado
 * atrás—. Declarada aquí, `forgetEverythingFor` (storage.js) DERIVA las dos
 * listas de esta tabla, así que una clave nueva por host se borra sola en cuanto
 * dice dónde vive, y `storage.test.js` exige que toda clave de `STORAGE_KEYS`
 * la diga: una que se añada mañana y se olvide aquí hace fallar la prueba.
 *
 * `faro:plans` del service worker no está: no es de `STORAGE_KEYS` y no es por
 * host, es por PESTAÑA (el recorrido en vuelo de esa pestaña, que muere con el
 * navegador), así que no hay forma de pedir «el de este host» ni sentido en
 * hacerlo.
 */
export const STORAGE_AREAS = {
  settings: 'local',
  sites: 'local',
  index: 'local',
  session: 'session',
  sessionWeight: 'session',
  context: 'local',
  memory: 'local',
  profile: 'local',
  sourceHistory: 'local',
  activity: 'local',
  activityCleared: 'session',
  today: 'session',
  modelChecks: 'local',
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
