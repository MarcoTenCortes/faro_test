# Tercer plan de evolución de Faro · la extensión cargada de verdad · septiembre 2026

> **Plan ESCRITO el 2026-09-28 y PENDIENTE de ejecutar**: Marco dará la orden
> por chat; hasta entonces no se toca código. Nace de la primera carga real de
> la extensión desde H0: Marco la cargó en su Chrome 153 contra su Jira y su
> Confluence 9.2.23 Data Center y vio cinco cosas: el Análisis ya no subraya
> (B1), la navegación guiada sólo «lleva» (B2), la consola de la página repite
> «Failed to fetch dynamically imported module» (B3), «Señalar» dice «No he
> podido activar la selección» (B4) y «Dibujar el flujo» deja la pregunta
> escrita en vez de mandarla (B5). Este plan dice qué es cada cosa, con qué
> evidencia (MEDIDA, VISTA en el código o SUPUESTA), y en qué orden se arregla:
> **H27** (el content script vuelve a cargar y su fallo se ve), **H28** (lo que
> consume el content script dice la verdad, y el árbol del Data Center),
> **H29** («Dibujar el flujo» manda solo) y **H30** (verificación en real, con
> Marco recargando la extensión). El estado hito a hito irá a **CLAUDE.md §12**,
> la bitácora a **docs/BITACORA.md §12.5** y el traspaso a
> `docs/plan/handoff/ESTADO.md`. Empieza en **H27** sobre la punta
> `plan/h26-cierre` (793a8d8, 1 643 pruebas) y no reabre nada de los dos
> planes anteriores (`docs/PLAN.md`, `docs/PLAN2.md`).

---

## 0. Cómo se ha hecho este plan

- **Investigación** (2026-09-28, sólo lectura, sobre 793a8d8): siete cazadores
  en Opus, uno por frente —C1 la carga del content script y `use_dynamic_url`,
  C2 el modo Análisis y el subrayado, C3 la navegación guiada, C4 «Señalar»,
  C5 el service worker y los permisos en hosts propios, C6 «Dibujar el flujo»,
  C7 la regresión histórica frente al original—, un agrupador que fundió sus
  60 hallazgos en ocho grupos (G1-G8) con sus contradicciones resueltas, y un
  refutador por grupo (dos en los de plataforma; 11 en total). Veredictos: G1
  y G2 confirmados por la medida de abajo; G5 confirmado; G3, G4, G6 y G7
  matizados (sus correcciones están aplicadas en §2-§4); **G8 refutado** (el
  registro de `CSS.highlights` es uno por ventana y lo comparten los mundos:
  su refutador lo probó con una extensión de prueba en Chrome 153, y de paso
  REPRODUJO B3: con `use_dynamic_url: true` un módulo con un import relativo
  falla con el mensaje exacto de B3 y con `false` carga y pinta).
- **Medido por el orquestador en el Chrome de Marco** (153.0.8010.54, con la
  extensión cargada, sin tocar nada): en `https://jira.simplprogramme.eu/browse/SIMPL-31748`,
  desde la propia página, `import()` de un módulo HOJA por la URL con GUID
  resuelve (`page-id.js` → `pageIdFromDom`), y `import()` de un módulo con un
  `import './x.js'` dentro falla (`config.js` y `dom-utils.js`: «Failed to
  fetch dynamically imported module»). `fetch()` de la URL con GUID devuelve
  200 con `redirected: true` y `r.url` con el id fijo; en la pestaña Red la
  petición anidada sale como `chrome-extension://invalid/` con 503. Es el
  mecanismo entero de B3 (§3.1). En su Confluence: versión 9.2.23, interfaz en
  español; el árbol lateral es el clásico (`.plugin_pagetree`: `listitem` con
  un chevron `<a role="button" href="" aria-label="Ampliar elemento <título>"
  class="plugin_pagetree_childtoggle …" aria-expanded="false">` y el enlace);
  los enlaces del árbol y los `_links.webui` de la API REST (25 de 25) tienen
  la forma `/spaces/CLAVE/pages/ID/Título` (0 `/display/`, 0 `viewpage.action`);
  y de los 25 chevrons visibles UNO lleva en su etiqueta una palabra de
  `FORBIDDEN_ACTIONS` («Ampliar elemento 8700 - Contract + Billing» ⇐
  «billing»): hoy Faro no lo pulsaría (§3.2).
- **Lo que no se pudo medir**: nada que necesite el panel lateral (no se abre
  desde una pestaña: `chrome.tabs.query({ active: true, currentWindow: true })`
  en panel.js:634 lo ata a su ventana) ni `chrome://extensions` (recargar la
  extensión lo hace Marco). Por eso H30 es una lista con lo que debe verse en
  el Registro del panel en cada comprobación.
- **Método de ejecución** (el de `docs/plan/handoff/PROMPT-NUEVA-SESION.md`
  §4): por hito, lectores Opus → contrato → constructores Opus con ficheros
  disjuntos (cada arreglo con su prueba vista fallar antes; cada pin nuevo
  demostrado por mutación sobre una copia) → verificación del orquestador
  (`npm run check` ×3, contraste, banco y espejo cuando toque) → commit →
  revisión adversaria (cazadores → agrupador → un refutador por grupo, ≤25
  agentes por flujo) → docs → ESTADO.md. Lo ejecuta el orquestador con la
  petición de Marco del 2026-09-28 («tú orquestas y decides, mientras mandas a
  agentes Opus a hacer las tareas»; puede usar su Chrome para comprobar; nunca
  escribe mensajes ni borra nada en Jira o Confluence) y SÓLO cuando Marco lo
  diga por chat.

## 1. Estado de partida

- Punta `plan/h26-cierre` (793a8d8), 1 643 pruebas, `npm run check` en verde
  el 2026-09-28 antes de tocar nada. Dos planes cerrados (H0-H14, H15-H26);
  H20 saltado; H25a descartada.
- Lo que CLAUDE.md §12 llamaba «sin verificar desde H0» —el panel real, el
  service worker, los `import()` con `use_dynamic_url`— es exactamente lo que
  ha fallado al cargar. El banco (149/149) y las 1 643 pruebas no lo veían:
  el banco importa `runner.js` en el mundo PRINCIPAL por http, sin
  `web_accessible_resources` ni GUID (harness/harness.js:12), y H14 cargó los
  módulos como blob URL (docs/BITACORA.md, «H14»).
- La versión que a Marco «le funcionaba» es la que probó en su Jira el
  2026-09-09 (40f56d7, anterior a H0; docs/BITACORA.md §12.2): sin
  `use_dynamic_url`, con `minimum_chrome_version` 116 y el mismo
  `import(chrome.runtime.getURL(…))` de hoy en bootstrap.js.
  `use_dynamic_url: true` entró en H2 (f305e8c, S7) por una auditoría de
  seguridad hecha sin cargar la extensión, y es lo ÚNICO que cambió entre
  40f56d7 y HEAD en la carga del content script (`git diff --stat 40f56d7 HEAD -- src/nav`
  sale vacío; `src/content/bootstrap.js` sólo gana la lectura del `pageId`).
- Cargar H26 encima de la entrada vieja de `chrome://extensions` (misma
  `key`, mismo id) es una ACTUALIZACIÓN: Chrome borra los content scripts
  registrados con `registerContentScripts` (aunque lleven
  `persistAcrossSessions`) y conserva el permiso de host. Ese ESTADO explica
  parte de lo que Marco ve tras cada «Recargar» (§3.1, hecho (c)).

## 2. Los cinco bugs y lo que se ha comprobado

| Bug | Qué vio Marco | Causa (grupo) | Evidencia |
|---|---|---|---|
| B3 | `[faro] fallo en el content script TypeError: Failed to fetch dynamically imported module: chrome-extension://<GUID>/src/content/runner.js` (también `config.js` y `dom-utils.js`) | **G1**: con `use_dynamic_url: true`, la URL con GUID se sirve por REDIRECCIÓN al id fijo; la base de un módulo ES es la URL de respuesta, así que sus `import './x.js'` se piden al id fijo, y ésa es justo la URL que `use_dynamic_url` deniega. Cargan las hojas (`messages.js`, `page-id.js`) y falla todo lo que importa algo (`runner.js`, `dom-utils.js`, `config.js` → `./permissions.js`). | MEDIDO (§0) y reproducido por el refutador de G8 con una extensión de prueba. En la captura de Marco sólo aparecen esos tres, nunca las dos hojas. Chrome 153: la CSP de Chrome 130-131 (crbug 363027634) queda descartada. |
| B4 | «No he podido activar la selección en esta pestaña. Recárgala y vuelve a intentarlo.» | **G1 + G2**: bootstrap.js contesta CADA mensaje detrás de `await boot()` (l.170) y cachea el rechazo en `ready` (l.22): PING contesta `{ok:false, error}`; `contentStatus` lo reduce a `ready:false` y tira el error (service-worker.js:315); el panel, con permiso, pide REQUEST_HOST_PERMISSION; `ensureContentScript` reinyecta bootstrap.js en el MISMO mundo, donde `window.__faroBooted` ya es true (l.15: no hace nada), y devuelve `{ok:true}` sin otro PING (l.264-274); el panel apunta «Content script inyectado» en verde (panel.js:2229) y PICK_START vuelve a fallar → el aviso (panel.js:6633), cuyo consejo («Recárgala») no arregla nada. La otra salida al mismo aviso: PING ok y el `import()` de `picker.js` (que importa `pick-payload.js`) fallando en `getPicker`. | VISTO línea a línea por C1/C4/C5 y por tres refutadores: el aviso literal SÓLO se alcanza con `ensureContentAccess` a true, y con `boot()` roto eso exige el `ok:true` falso de `ensureContentScript` o el PING ok con `getPicker` roto. |
| B1 | El Análisis ya no subraya | **G1**: PAGE_DIGEST contesta `{ok:false}` y `offerNotes` sale por la guarda del digest («No he podido leer el texto de esta página… Recarga la pestaña», panel.js:5866-5879), o antes por la tarjeta «Falta un permiso» (con el permiso concedido: **G3**), o en SILENCIO si esa tarjeta ya estaba en el chat (l.2241). **G4**: el disfraz «Análisis marcado · 0 de N no las he sabido situar» en verde (l.5963-6038) sólo sale con digest bueno y ANNOTATE roto (la página recargada a mitad de turno). | C2 y el refutador de G4, que corrigió la cadena. Con G1 arreglado, un Análisis lanzado con clic o Enter lleva gesto y vuelve a registrar e inyectar el script (§3.1, hecho (c)): B1 se cura con G1. |
| B2 | Sólo «Llévame» | **B2 = B3 en Confluence**: TREE_SNAPSHOT, PAGE_ANCESTORS y SPACE_PAGES contestan `{ok:false}` → `learnAncestry` da null (panel.js:5108-5110, registrando `r?.reason`, que bootstrap no manda: manda `error`) → el destino no tiene `parentId` → `treeSteps` da un solo paso (validate.js:85, 212) → `navOptions` sólo ofrece «Llévame» (options.js:33). Y tres casos POR DISEÑO, iguales en 40f56d7: en Jira una incidencia o una búsqueda JQL son un salto único (§8.16; el botón dice «Abrir la búsqueda en Jira»); una página que cuelga de la portada estando ya en su espacio no tiene ramas («Camino leído de Confluence · 0 rama(s)», confluence-rest.js:174); y el modo «Rápida» de Ajustes quita «Paso a paso» (`navMode:'quick'`). | C3, y los refutadores de G6 y G3 (G6 «sin B3» no es una regresión: `src/nav` no cambió desde 40f56d7). Lo que SÍ es nuevo y se ve al arreglar G1: **G7**, el chevron del árbol del DC con un verbo prohibido en su etiqueta (medido: «Contract + Billing»), y `runCurrentStep` saltando TODOS los pasos ante un `{ok:false}` (service-worker.js:439-441; ejecutado en Node por el refutador de G4). |
| B5 | «Dibujar el flujo» pega la pregunta | **G5**: no es un bug: decisión §8.27 de H24 («no manda nada»), heredada de «Preguntar sobre estos» (§8.20) sin motivo propio (`h24-rev-decisiones.md` no tiene ni una línea sobre mandar; el «coste cero si no se pulsa» del anexo comparaba el botón con meter la viñeta en el prompt). Marco pide lo contrario: decisión 17. | C6 y su refutador (CONFIRMADO con una sonda ejecutada: el botón con `send()` funciona, cae una prueba y cuatro fragmentos de PINES). El panel ya tiene tres botones que mandan al pulsar (las sugerencias del chat vacío, «Reintentar con X», «Pedirlo numerado», panel.js:2842, 4083, 6198). |

Y lo transversal que no es ninguno de los cinco pero los acompaña:

- **G3** (service worker nunca ejercitado; latente, ya estaba en 523c25f):
  `requestHostPermission` del SW llama a `chrome.permissions.request`
  (service-worker.js:226), y Chromium comprueba el GESTO antes de mirar si el
  permiso ya está concedido (`PermissionsRequestFunction::Run`, leído por dos
  refutadores en el código fuente). El gesto SÍ viaja del panel al SW por
  `sendMessage` (`HasTransientUserActivation` + `ExtensionInteractionProvider::Scope::ForWorker`),
  pero sólo durante los 5 s de activación y sólo mientras el oyente del SW
  corre de forma síncrona: los caminos con clic pasan y los caminos sin clic
  (`learnAncestry` al acabar el turno, `readToday`, `restIndexFor`,
  `loadSearchChipSources`, `readIssueFieldsQuick`, `paintSuggestedSources`,
  `contrastarConJira`) fallan como «permiso denegado» en silencio; y un «Dar
  permiso» que tarda más de 5 s en cerrarse manda el mensaje sin gesto y no
  registra nada. Además, al reinstalar o actualizar (recargar una extensión
  sin empaquetar lo es), `OnExtensionWillBeInstalled` borra los content scripts
  dinámicos y nadie los rehace. SUPUESTO en Chrome (leído en Chromium): se
  mide en H30; el arreglo de H27 vale en los dos casos.
- **G7** (latente, anterior a los planes): `isSafeToClick` casa
  `FORBIDDEN_ACTIONS` por SUBCADENA sobre el nombre accesible (locators.js:285),
  y el chevron del árbol del DC lleva el TÍTULO de la página en su
  `aria-label` («Ampliar elemento …»), así que un título con «new», «update»,
  «billing», «shared», «comments», «published», «assignment»… bloquea
  `_abrirRama` (runner.js:258), el barrido (runner.js:394) descarta ese mismo
  chevron, la rama no se abre y el recorrido acaba en «No encuentro este
  paso… ¿Te llevo directamente?» con «Llévame». Medido en el sitio de Marco:
  1 de 25 chevrons. Y las pistas por ruta de `locateStep` (`a[href*="…"]`,
  locators.js:67, 225) se buscan en TODO el documento sin frontera: en un DC
  cuyo índice tenga `/display/CLAVE/Título` no casan nunca con la fila del
  árbol 9.1+ (`/spaces/CLAVE/pages/ID/Slug?src=…`) y sí con un enlace del
  cuerpo. En el sitio de Marco índice y árbol coinciden (`/spaces/…`), así que
  hoy no le toca; se endurece igual porque es puro y barato. `inSpace` con
  `viewpage.action` (C3-7) NO se toca: un 9.1+ redirige esas URL y, si
  ocurriera, añade un paso en vez de quitarlo.
- **G8** (el relleno del subrayado desde el mundo aislado): REFUTADO. Sólo
  queda mirarlo con los ojos en H30, y decirle a Marco que la marca se ve
  distinta al original a propósito: 523c25f pintaba DOS rellenos (el degradado
  ámbar de `.quote-rect` más el `::highlight`), y desde H23 hay uno solo, azul
  al .28 y debajo del texto (§8.28).

## 3. Las cuatro áreas: qué se decide

### 3.1 El content script vuelve a cargar, y cuando no, se ve (G1, G2, G3)

**Hechos.** (a) MEDIDO en el Chrome de Marco y pinado por las propias
pruebas de Chromium (`UseDynamicUrlInFetch`: lo dinámico pedido por la URL
estática se bloquea; `MainFrameLocationHrefUpdatesAreSubjectToAccessibleResources`:
la URL dinámica acaba en la estática; Blink toma `base_url = ResponseUrl` en
`document_module_script_fetcher.cc`; idéntico en M153 y en main): `use_dynamic_url: true`
sirve la URL con GUID redirigiendo al id fijo; la base del módulo es la URL
de respuesta; los imports relativos van al id fijo, `IsResourceWebAccessibleImpl`
los deniega y el renderer los reescribe a `chrome-extension://invalid/`. La
prueba de regresión de Chromium para `import()` con `use_dynamic_url`
(`ContentScriptsCanImportDynamicUrlResources`) importa SÓLO una hoja: por eso
no hay crbug. El aviso de la consola («Denying load of chrome-extension://ickohiff…/src/…
Resources must be listed in the web_accessible_resources manifest key…»)
ENGAÑA: sí están listados. Sin build no hay forma de que un módulo con
imports cargue así, y S7 no se puede conservar a medias (una segunda entrada
sin `use_dynamic_url` para los anidados los vuelve a exponer). (b) VISTO: el content script arranca entero
detrás del primer mensaje y un arranque roto contesta `{ok:false}` a todo,
PING incluido, con lo que para el SW y el panel «hay script» y «no hay
script» se confunden; `ensureContentScript` devuelve `ok:true` sin comprobar
nada. (c) SUPUESTO (Chromium): el SW pide permiso con `request`, que exige
gesto aunque esté concedido, y una actualización borra los registros.

**Opciones para (a)**, todas evaluadas: **A** quitar `use_dynamic_url`
(volver a lo que 40f56d7 ya probó en Chrome), conservando los cinco patrones
(`content/`, `content/overlay/`, `shared/`, `atlassian/`, `nav/`); **B**
mantener S7 con un bundle hoja generado en `tools/` y comprobado byte a byte
(contradice «sin build», §1); **C** módulos sin imports estáticos cableados
desde bootstrap (refactor enorme); **D** una segunda entrada de WAR con
`extension_ids` (experimental, y choca con el pin de `test/manifest.js`);
**E** `executeScript` con `files` en orden desde el SW sin WAR (los módulos
usan `export`: como scripts clásicos no parsean). **Decisión: A**, con el
motivo medido escrito en §8.21 y S7 pasando a docs/BITACORA.md §12.4 como
descartada. Lo que se pierde: cualquier web https puede comprobar si Faro está
instalado pidiendo `chrome-extension://ickoh…/src/shared/config.js`. Lo que
NO se pierde: nada de `panel/`, `background/` ni `opencode/` se expone (los
patrones no cambian), la contraseña de opencode sigue sólo en el panel, y
`web-accessible.test.js` sigue vigilando el cierre transitivo.
`minimum_chrome_version` se queda en 130: su motivo pasa a ser «lo verificado»
(Custom Highlight API, `sidePanel`, `registerContentScripts`) y no S7.

**Lo que cambia en (b)**, independiente de (a) y con valor propio (§8.14):
- bootstrap.js: PING y SETTINGS se contestan ANTES de `await boot()` y NO
  arrancan el content script (SETTINGS se guarda en `pendientes` y se aplica
  al arrancar): así el peso de H11 se conserva, porque `contentStatus` y
  `pushSettings` corren al abrir el panel en cada pestaña. Con arranque bueno,
  PING → `{ok:true, url, title}` como hoy; con arranque roto → `{ok:false,
  alive:true, error}` donde `error` es el mensaje recortado a la ruta `src/…`
  (sin el GUID: «Copiar registro» lo sacaría); sin arrancar todavía →
  `{ok:true, url, title, booted:false}`. Un solo `console.error` por
  instancia (`bootError`). `ready = null` en el `catch` de `boot()` con tope
  de UN reintento (`bootAttempts`): Chromium guarda el fetch fallido en el
  mapa de módulos (whatwg/html#6768), así que dentro de la misma página el
  reintento no arregla G1, pero cubre un fallo transitorio anterior al fetch
  y no multiplica los errores.
- `window.__faroBooted` se QUEDA como está: dentro de una misma vida de la
  extensión, una segunda instancia en el mismo mundo añadiría un segundo
  `onMessage` que competiría con el viejo (y el viejo contesta antes, con su
  `ready` rechazada); y tras recargar la extensión el mundo aislado es OTRO
  (`Dispatcher::UnloadExtension` → `RemoveIsolatedWorlds`), así que la guarda
  no bloquea nada. La recuperación de un arranque roto dentro de una misma
  página es el reintento con tope y, si también falla, «recarga la pestaña»:
  el aviso lo dice junto al error. El huérfano (la instancia vieja tras
  recargar la extensión sin recargar la pestaña) tiene que detectarse a sí
  mismo (`!chrome.runtime?.id`) en el sondeo de `dom-utils.js:280` y en sus
  oyentes, desmontar su overlay y parar; el nuevo, al arrancar, quita lo que
  el viejo dejó en el DOM compartido (`#faro-overlay-host` duplicados:
  `overlay.js:88-96` crea otro con el mismo id; `faro-picking` y
  `faro-picking-dark` en `<html>`; `#faro-pick-style`; `#faro-highlight-style`).
- `announce()`: `console.warn` en su `catch`, sin tocar el mensaje (§5: `url`
  y `pageId` y NADA más).
- service-worker.js: `contentStatus` → `{granted, ready, alive, error}`
  (`alive: ping !== null`, `error: ping?.error`); `ensureContentScript`: si el
  script está vivo y roto, NO reinyecta y devuelve `{ok:false, kind:'roto',
  error}`; tras `executeScript` hace OTRO PING y sólo devuelve `ok` si contesta
  `ok`; si no contesta, `{ok:false, kind:'huerfano', error:'el content script
  no contesta'}`; `pushSettings` sólo detrás de un PING bueno (el pin
  `['faro:ping', 'faro:settings']` de service-worker.test.js:786-797 pasa a
  `['faro:ping', 'faro:ping', 'faro:settings']`, con su línea en PINES:39).
- panel.js: `ensureContentAccess` sigue devolviendo un booleano (hay muchos
  `if (!puede)` pinados; se corta por `'async function ensureContentAccess'`
  en al menos 8 pruebas: ni renombrarla ni moverla) y guarda el motivo en
  `state.contentProblem`; con permiso y script roto NO pide permiso por el SW:
  registra «Content script roto» (título nuevo, host · error) una vez por
  pestaña y devuelve false; la tarjeta «Dar permiso» dice «Listo. Ya puedo
  resaltar…» (l.2278) sólo con el `ok` del re-PING; `togglePick` distingue
  `r === null` (huérfano o carrera) de `r.ok === false` (roto) y enseña
  `r.error` en lugar de «Recárgala».

**Lo que cambia en (c)**:
- `requestHostPermission` del SW: `chrome.permissions.contains` y NUNCA
  `request` (ni «contains y luego request»: cualquier `await` delante pierde
  el gesto); el diálogo sólo lo abre el panel, con gesto (panel.js:2313, que ya
  existe). Sin permiso → `{ok:false, needsPermission:true}`. Se conserva el
  nombre REQUEST_HOST_PERMISSION con el sentido «asegura el script» (§5 lo
  dice; sin mensaje nuevo). El comentario de panel.js:2294-2296 («el gesto no
  viaja») se corrige con el hecho verificado.
- Reconciliación en `onInstalled` (install/update; recargar una sin
  empaquetar es un update) y por `permissions.onAdded`/`onRemoved`: de
  `permissions.getAll().origins` se quitan los `host_permissions` del manifest
  (`chrome.runtime.getManifest()`: 127.0.0.1, localhost, `*.atlassian.net`) y
  se registra, idempotente y con el mismo id (`scriptIdFor(origin)` sacado a
  función), cada origen que sea un sitio `configured` de `getSites` o el host
  enlazado (`jiraHost`/`confluenceHost`) de uno; un host con permiso y
  `configured:false` (tras «Quitar las claves», H19) NO se registra. Un
  «Duplicate script ID» cuenta como éxito. Sin `onStartup`
  (`persistAcrossSessions` aguanta el reinicio del navegador).
- `ensureContentScript` serializado por origen (Map origen → promesa que
  cubre registro, inyección y re-PING): sin gesto y sin `request`,
  `bootForSite`, `loadSearchChipSources`, `readIssueFieldsQuick`, `readToday` y
  `restIndexFor` corren en paralelo. Consecuencia documentada en FLUJOS §4.1:
  al abrir el panel en un sitio configurado se inyecta sin clic; el content
  script NO arranca hasta el primer mensaje real (PING y SETTINGS no arrancan).
  (Revisión adversaria de H27, D1: salvo el PING con `arrancar` que el SW
  manda al asegurarlo, antes y después de inyectar, porque uno ligero sólo
  prueba que hay un oyente y el «Listo» tiene que querer decir arrancado.)
- De paso y baratos (C5-9, C5-10): `onMessage` devuelve `true` sólo para los
  tipos que atiende; la hidratación guarda su PROMESA; START_PLAN,
  NAVIGATE_DIRECT y REQUEST_HOST_PERMISSION sólo sin `sender.tab`.

**Pruebas** (Node, sin Chrome; las nuevas se ven fallar ANTES del arreglo):
en `service-worker.test.js` el mock de `permissions.request` LANZA «This
function must be called during a user gesture» como el SW real, y gana
`permissions.onAdded/onRemoved/getAll`, `scripting.unregisterContentScripts` y
`runtime.getManifest`; «con el PING muerto también después de inyectar,
REQUEST_HOST_PERMISSION da ok:false» (hoy `{ok:true}`); «dos
REQUEST_HOST_PERMISSION a la vez registran UNA vez»; «onInstalled con reason
update registra cada origen OPCIONAL concedido de un sitio configurado y
ninguno del manifest»; «un permiso añadido registra y uno quitado
desregistra»; «el SW nunca llama a request»; cambian los `eq` del objeto de `contentStatus`
(service-worker.test.js:733, 750, 764, 780) y la secuencia de 786-797. En
`bootstrap-wiring.test.js`, «PING y SETTINGS se contestan antes de boot()»,
«SETTINGS antes de arrancar se aplica al arrancar», el tope de reintentos y
la limpieza del huérfano. En `manifest.js` y `web-accessible.test.js`, los
pines invertidos con «EL CAMBIO:» y uno nuevo que fije la REGLA, no el valor:
`use_dynamic_url: true` se rechaza mientras el cierre de bootstrap.js tenga
imports estáticos relativos (cruzado con el grafo que ya recorre
`web-accessible.test.js`). En `panel-wiring`, «Content script roto» y el aviso
de «Señalar» con `r.error`. **Regla para los constructores** (contrato): los
cortes de `panel-wiring.test.js` dependen del ORDEN de las funciones de
panel.js —`offerNavigation`→`learnAncestry` (455, 1791, 2019, 2214, 6647),
`learnAncestry`→`attachJqlResults` (2259), `bootForSite`→`ensureContentAccess`
(294, 362, 396, 3034), `loadLinkedContext`→`ensureContentAccess` (376, 432,
495), `readPageDigest`→`attachToBubble` (513, 1174, 2381),
`paintTurn`→`readPageDigest` (223, 709, 715, 752, 1457, 1482) y
`runPlan`→`togglePick` (794)—: un ayudante nuevo NO se mete entre esas
parejas.

### 3.2 Lo que consume el content script dice la verdad, y el árbol del DC (G4, G7, G6)

- `offerNotes` y `remarkFromAnchors`: con `!res` o `res.ok === false` y un
  `reason` distinto de `'editando'`, `log.warn('Sin marcas', 'la página no
  contestó al marcar: ' + …)` + `noticeNode` y `return`, sin `notesCard` ni
  «Análisis marcado» (se mantiene la proporción Sin marcas/noticeNode/
  showPermissionNotice del pin panel-wiring:238). La salida muda con
  `state.site` nulo (l.5745) registra y avisa; `send()` captura sitio y
  pestaña al pedir y `offerNotes` los usa en sus tres lecturas de `state`
  (`ensureContentAccess`, el `log.warn`, `chrome.tabs.get`) o dice «has
  cambiado de pestaña; no he marcado nada» (§8.22).
- `readPageDigest` registra «Página sin bloques» también en `'sin pestaña'` y
  `'permiso'`, con `r.error`; todos los sitios del panel que hoy tiran
  `r.error` y dicen que la pestaña calló cuando contestó con error usan
  `r?.reason || r?.error`: `learnAncestry` (l.5109), 7015, 7299, 7324, 7525,
  10567, `fetchPageChain`, `restIndexFor`, `focusNote` (l.6404) y, en el SW,
  `watchStalledStep` (l.290); ANNOTATE con `{ok:false}` deja de contar todas
  las anclas como `missed` sin motivo (l.5952-5963, 6373);
  `showPermissionNotice`, si la tarjeta ya está, cuelga un aviso corto en la
  burbuja (l.2241).
- La tarjeta de navegación que se queda con un solo paso porque
  `learnAncestry` dio null lleva un `noticeNode` («No he podido leer el camino
  (<motivo>): sólo puedo llevarte de golpe»); con «0 rama(s)» no (es diseño).
- SW: `runCurrentStep` y `watchStalledStep`: un STEP con `res.ok === false &&
  !res.status` (los resultados legítimos de `executeStep` llevan `status`,
  runner.js:131-166) acaba el recorrido con su error (`setPlan(null)` +
  PLAN_FINISHED con motivo) en vez de saltar TODOS los pasos; el contrato de
  H28 decide si en el último paso con URL se abre con `tabs.update`. Un
  vigilante en la fase `'anchor'` con `NAV_TIMING.anchorStallMs` (nueva, en
  `nav-timing.test.js`); `onContentReady` compara `msg.pageId` con
  `plan.destination.id` y, sin `pageId`, `samePage(msg.url, plan.destination.url)`
  de site.js —NUNCA `sameDoc`, que en un DC con `viewpage.action?pageId=`
  da falso «mismo documento», ni `sender.tab.url`—; `navigateDirect` usa la
  misma comparación para `alreadyThere` (l.337), con su prueba.
- PICK_START: `const promesa = p.start(); sendResponse({ ok: true }); await promesa`
  (`Picker.start()` es síncrona hasta su `return new Promise`).
  `onRuntimeMessage(msg, sender)` ignora PICK_RESULT y NOTE_CLICKED de otra
  pestaña (`sender.tab?.id`) y PLAN_PROGRESS/PLAN_FINISHED con `msg.tabId !==
  state.tabId` (hoy un segundo panel pinta «Navegación detenida»); la prueba
  corta por `'function onRuntimeMessage'` (panel-wiring:798).
- locators.js, C3-8: se sigue casando por subcadena (casar por palabra entera
  DEBILITARÍA la barrera: «unpublish», «reassign», «undelete», «autosave»…
  dejarían de bloquearse), pero cuando el elemento es el chevron o el enlace
  de una fila reconocida del árbol (`rowFor(el)` dentro de `treeContainer()`,
  tree-dom.js, §8.7) se quita del nombre accesible el TÍTULO de esa fila (el
  texto de su enlace, plegado con `foldLabel`) antes de mirar
  `FORBIDDEN_ACTIONS`: el título es contenido, no una acción (§8.12).
  `isMenuTrigger` sigue detrás y tapa el «···». SEGURIDAD en
  `locators.test.js`: pasan el chevron F9 con «Ampliar elemento Onboarding of
  new participants» y «Ampliar elemento 8700 - Contract + Billing» y el enlace
  de esa fila; siguen BLOQUEADOS un botón o `<a>` fuera del árbol con
  «Eliminar», «Guardar», «Publicar», «Unpublish» y «Reassign», un `<a>` DENTRO
  de la fila con `aria-label` «Delete page» o «Mover», el «···» de la fila
  (M9) y «Borrar este enlace» (F9). Un tramo nuevo del banco (67) con una
  fila del pagetree cuyo título lleve «Update» (la fixture de harness.js:650
  ya pone «Ampliar elemento » + título).
- locators.js y runner.js, C3-6: (a) sin pistas por ruta cuando `pathOnly`
  no lleva slug (acaba en `.action` o el id va en la consulta); (b) el
  `href*=` de la ruta pasa a coincidencias con frontera (`path + '?'`,
  `path + '#'`, `path + '/'` además del `href$=` que ya hay); (c) en un paso
  `action:'expand'` se localiza primero dentro de `treeContainer()` y después
  en el documento. Se conservan los dos pines de `already-here.test.js`
  (`d[0]` = `href$=` de la ruta `/spaces/…`; consulta y ancla fuera). Casos
  nuevos: dos enlaces `viewpage.action` (pageId 7 y 12345; hoy gana el 7) y
  una ruta `/display/SIMPL/Architecture` con un enlace de cuerpo `…+Overview`
  (hoy gana el del cuerpo).
- G6: NINGÚN cambio de código (la migración `assistedByDefault:false` →
  `'quick'` es anterior a H0 y `saveSettings` ya la dejó escrita: sólo la
  cambia Ajustes). docs/INSTALL.md, «Sólo me ofrece “Llévame”»: en Jira es así
  a propósito (§8.16), una página que cuelga de la portada no tiene ramas, y
  «Rápida» lo quita a propósito. docs/REFERENCIA.md §6 «Ajustes» gana
  `navMode` y su migración (hoy no los menciona).

### 3.3 «Dibujar el flujo» manda solo (G5)

**Decisión 17** (2026-09-28, petición literal de Marco: «quiero que la función
del diagrama […] no sea copiar y pegar un prompt en el input del chat, si no
que lo haga directamente»): el clic manda. En `diagramButton`: guarda de
`streaming` → `state.pendingDiagram = { host }` → `log.info('Diagrama',
'pedido desde el botón')` → `el.input.value = DIAGRAM_QUESTION` → `autoGrow()`
→ `el.input.focus()` → `send()`. El foco va antes de `send()` porque el botón
desaparece y, si `send()` sale pronto (sin cliente o sin sitio, l.3202-3203),
el foco ya está en el cuadro y la pregunta queda escrita como antes (el
Registro dirá «pedido desde el botón» sin «Turno enviado»: se pina así).
Fuera el `announce` («Pregunta preparada…»: el clic ya tiene eco —la fila
desaparece, la burbuja sale con la nota «dibujar el flujo» y el chat se pone
`aria-busy`—, como los otros tres botones que mandan) y `b.title` nuevo.
`pendingDiagram` y `diagramaAlPedir` se quedan (la salida de «Parar» y un
`send()` sin cliente los siguen necesitando). Ningún `await` antes de
`setStreaming(true)` en `send()` (l.3283), así que un doble clic no abre dos
turnos. Lo que esté armado (`state.pendingPick`, lo precargado con «Preguntar
sobre estos», l.3205-3216) viaja con la pregunta: se documenta en la decisión
(la nota bajo la pregunta lo dice) y no se toca `send()`. SEGURIDAD
equivalente al assert que se quita: lo único que se manda es la constante
(`eq` del cuerpo entero con `el.input.value = DIAGRAM_QUESTION`, el bucle de
prohibidos de panel-wiring:7885, y `send()` exactamente UNA vez), con la
etiqueta «decisión 17», no §8.20. Mutantes que tienen que caer: sin `send()`,
`send()` antes de `el.input.value = …` (mandaría el borrador), `send()` antes
de `state.pendingDiagram = …` (dejaría el armado vivo para la pregunta
siguiente), sin la guarda; «`focus()` después de `send()`» es equivalente y
no tiene que caer.

**Decisión 18**, en un commit APARTE dentro de H29: `offerNavigation` recibe
`{ diagrama: diagramaAlPedir }` y sale con «Sin navegación» (hoy, con Enter,
panel.js:3723 la llama sin guarda y planner.js:68/411 gastan un segundo turno
de pago para una tarjeta «Llévame» que sobra: hallazgo independiente de B5).
Pines: panel-wiring:454 (`{ preloaded: !!preloadDelTurno }`), :2213-2216,
docs/PINES.md:15 y :106, docs/FLUJOS.md:28 y :91 (citan la misma llamada).

**Fuera**: la viñeta y el ejemplo de forma de la decisión 15 (BITACORA
§12.3): ningún prompt cambia y las 40 instantáneas quedan intactas
(`DIAGRAM_QUESTION` no está en `test/fixtures` ni en `tools/`); si Marco lo
quiere, es un commit aparte. CLAUDE.md §8.20 NO se toca («Faro no manda
preguntas solo» no se incumple con un clic en un botón que dice lo que hace);
el matiz va en docs/REFERENCIA.md:631 con una frase. Pines y textos:
`panel-wiring.test.js` 7676 (nombre de la prueba H24), 7871-7912 (parte 5,
`eq` del cuerpo entero), 7881, 7910, 7995-8003 (la guarda de `offerNotes`,
que H28 también toca) y los comentarios 7680 y 7871-7872; docs/PINES.md 175
y 178 (fragmentos copiados del código nuevo); comentarios de panel.js que se
vuelven falsos: 535-538, 3218-3219, 3585-3586, 5377-5381, 5396-5406;
docs/REFERENCIA.md §8.27 (l.638), :647 (el detalle del registro «pregunta
preparada · sin mandar» → el nuevo; el paso «docs» no lo detecta) y §9;
docs/INSTALL.md 814-820 y 1836-1838; README.md 599-602; docs/MAPA.md 10 y
82; docs/FLUJOS.md §4.2 (l.43) y §4.7 (l.95); espejo `harness/panel-preview.html`
1692-1694 (comentario); CLAUDE.md §8.27 (l.352) y §12 (decisiones 17 y 18):
tiene 389 bytes libres bajo el tope de 61 440, así que lo que entre sale de
§5/§7 (Tarea 0). NO se tocan (historia): docs/PLAN2.md, h24-contrato.md,
h24-rev-decisiones.md.

### 3.4 Lo que sólo se puede verificar en real (§7)

Con Marco recargando la extensión después de H27-H29: cada bug con lo que
debe verse, las tres cosas de plataforma que este plan da por supuestas
(recargar borra los registros dinámicos; `request` sin gesto falla aunque
esté concedido; el mundo aislado es nuevo tras recargar), y la mirada al
relleno (G8). Lo de G7 que no se ve en el sitio de Marco (`viewpage.action`)
no se toca.

## 4. Hitos, en orden

### H27 · El content script vuelve a cargar, y cuando no, se ve

- **Qué**: §3.1 entero. `use_dynamic_url` fuera del manifest (decisión A);
  PING y SETTINGS antes de `boot()`, `bootError`, el reintento con tope, el
  huérfano que se apaga solo y la limpieza del DOM en bootstrap.js;
  `contentStatus`/`ensureContentScript` que distinguen vivo, roto y huérfano
  con re-PING; el SW nunca pide permiso, reconcilia los registros en
  `onInstalled`/`permissions.onAdded|onRemoved` (sin los orígenes del
  manifest, sólo sitios configurados y sus enlazados) y serializa por origen;
  `state.contentProblem`, «Content script roto» y el aviso de «Señalar» con la
  causa; «Listo. Ya puedo resaltar…» sólo con el re-PING bueno. §8.21
  reescrita con el motivo medido; S7 en §12.4; §7 gana los hechos de
  plataforma (MEDIDO/SUPUESTO); §12.2 se actualiza con lo medido; nueva §8.29.
- **Depende de**: nada. Es lo primero: sin él nada de la página se puede
  verificar.
- **Ficheros**: `manifest.json`, `src/content/bootstrap.js`,
  `src/content/dom-utils.js` (el sondeo se apaga si `!chrome.runtime?.id`),
  `src/content/overlay/overlay.js` (sólo si la limpieza del host duplicado
  va ahí), `src/background/service-worker.js`, `src/panel/panel.js`
  (`ensureContentAccess`, `togglePick`, `showPermissionNotice`, el comentario
  2294-2296), `test/manifest.js`, `test/unit/web-accessible.test.js`,
  `test/unit/bootstrap-wiring.test.js`, `test/unit/service-worker.test.js`,
  `test/unit/panel-wiring.test.js`, `test/unit/nav-timing.test.js` (lee
  bootstrap.js); CLAUDE.md §1, §2, §3, §5, §7, §8.21, §8.29, §9 (el 107),
  §12; docs/REFERENCIA.md §6 (CONTENT_STATUS y PING), §7, §8.21, §8.29, §9
  (títulos); docs/FLUJOS.md §4.1, §4.3, §4.5, §4.9; docs/PINES.md (l.39 el
  recuento del SW, l.58 web-accessible, las líneas de bootstrap-wiring y
  manifest); docs/BITACORA.md §12.2, §12.3, §12.4, §12.5; docs/INSTALL.md
  (títulos, «El análisis no me subraya nada» punto 1, l.2651, la recarga);
  README.md (148, 1240); docs/MAPA.md (8, 36, 78); comentarios que citan el
  GUID (`cursor.js:11-17`, `panel-css.test.js:511`, `harness.js:2097`: el
  cursor en `data:` sigue siendo correcto y se dice por qué sigue). Si
  `scriptIdFor` o la regla de reconciliación salen a un módulo puro (§9):
  CLAUDE.md §3, docs/MAPA.md y `dead-exports.test.js`.
- **Pruebas** (~22): las de §3.1. Cada nueva se ve fallar ANTES del arreglo;
  los pines de literal se demuestran por mutación sobre una copia.
- **Riesgo**: bajo en el código, medio en la plataforma (G3 son supuestos
  hasta H30; el arreglo está hecho para valer en los dos casos).

### H28 · Lo que consume el content script dice la verdad, y el árbol del DC

- **Qué**: §3.2 entero.
- **Depende de**: H27 (los `{ok, alive, error}` nuevos y el re-PING).
- **Ficheros**: `src/panel/panel.js`, `src/background/service-worker.js`,
  `src/shared/config.js` (`NAV_TIMING.anchorStallMs`), `src/content/bootstrap.js`
  (PICK_START), `src/content/locators.js`, `src/content/runner.js` (los pasos
  `expand` dentro del árbol; comentario de `_abrirRama`), `src/content/tree-dom.js`
  si «el título de la fila» se decide ahí (§8.7), `src/atlassian/site.js`
  sólo si `samePage` necesita un caso; `test/unit/panel-wiring.test.js`,
  `test/unit/service-worker.test.js`, `test/unit/nav-timing.test.js`,
  `test/unit/locators.test.js`, `test/unit/already-here.test.js`,
  `test/unit/runner-wiring.test.js`, `test/unit/bootstrap-wiring.test.js`,
  `harness/harness.js` (tramos 9 y 60; el tramo nuevo 67 y sus `ok(`);
  CLAUDE.md §2 (tramos y `ok(`), §6 (NAV_TIMING, Ajustes), §8.7, §8.12, §8.14,
  §8.22; docs/REFERENCIA.md §2, §6, §8.7, §8.12, §9; docs/FLUJOS.md §4.2-§4.5
  (l.51 «locateStep href→rol→texto; isSafeToClick»); docs/PINES.md
  (panel-wiring, service-worker, locators l.110, already-here l.61,
  tree-steps); docs/INSTALL.md («Análisis marcado», «Sólo me ofrece Llévame»);
  README.md.
- **Pruebas** (~22): «el análisis no se cae en silencio cuando no puede
  marcar»; «un content script roto acaba el recorrido con motivo»; «sin aviso
  de la pestaña, el salto directo se abandona con motivo»; «un aviso desde
  otra URL no ancla un plan viejo»; «Llévame entre dos viewpage.action sí
  navega»; SEGURIDAD de C3-8 (las diez de §3.2); C3-6 con sus tres casos;
  PICK_START; `onRuntimeMessage` con remitente; el vigilante con margen corto
  (como `conMargenCorto`, para no dejar temporizadores de 9 s).
- **Riesgo**: bajo-medio. La barrera §8.12 cambia de forma: la revisión
  adversaria de H28 lleva un cazador sólo para ella. El banco tiene que
  seguir en 149/149 + el tramo nuevo con frames de verdad (1258×597).

### H29 · «Dibujar el flujo» manda solo

- **Qué**: §3.3 entero en DOS commits: decisión 17 (`diagramButton` →
  `send()`, pines, comentarios, espejo, docs) y decisión 18 (`offerNavigation`
  con `{ diagrama }` → «Sin navegación», sus pines y FLUJOS).
- **Depende de**: nada del código (va detrás de H28 sólo por orden de
  commits; los dos tocan la guarda de `offerNotes` pinada en panel-wiring
  7995-8003, así que H29 se construye sobre H28 ya commiteado).
- **Ficheros**: `src/panel/panel.js`, `test/unit/panel-wiring.test.js`,
  `harness/panel-preview.html` (comentario), docs (§3.3).
- **Pruebas**: la H24 de panel-wiring reescrita (sonda ejecutada con `new
  Function` y fakes: clic → `send` UNA vez con el cuadro valiendo
  `DIAGRAM_QUESTION` y `pendingDiagram = {host}`; con streaming, cero; los
  cuatro mutantes); la llamada a `offerNavigation` con `diagrama`; `npm run
  snapshots` NO se corre y `prompt-snapshots.test.js` lo demuestra; `wc -c
  CLAUDE.md` ≤ 61 440.
- **Riesgo**: bajo. El espejo a 320/420 × claro y oscuro con la pantalla
  «Jira · SIMPL-1234».

### H30 · Verificación en real

- **Qué**: Marco recarga la extensión y la pestaña; el orquestador comprueba
  desde su Chrome lo que se ve desde la página (los `import()` por el id fijo
  cargan; ningún «[faro] fallo…» en la consola) y Marco pasa la lista de §7
  con el Registro abierto; lo medido va a docs/BITACORA.md §12.2 y a CLAUDE.md
  §12 «Sin verificar» (que por fin encoge). Si G3 resulta distinto de lo
  supuesto, se apunta y el código no cambia (reconciliar es idempotente). Si
  un análisis marcado sale sin fondo, se diagnostica (`#faro-highlight-style`
  con `sheet?.cssRules.length === 2` e `isConnected`; `CSS.highlights.has('faro-quote')`
  desde «top») ANTES de proponer nada: un relleno en el overlay reabriría
  §8.10, §8.11 y §8.28.
- **Depende de**: H27-H29 y de Marco.
- **Ficheros**: sólo docs (BITACORA §12.2/§12.5, CLAUDE.md §12, ESTADO.md,
  INSTALL si hay un paso manual nuevo).
- **Riesgo**: es la medida.

## 5. Decisiones que cambian o se añaden en CLAUDE.md

- **§8.21** (URL dinámica) se REESCRIBE: «Recursos accesibles desde la web por
  el id fijo: `use_dynamic_url` NO, porque Chrome sirve la URL con GUID
  redirigiendo al id fijo y la base del módulo es la URL de respuesta, así que
  los imports relativos de cualquier módulo van al id fijo y se deniegan
  (medido el 2026-09-28 en Chrome 153: cargan las hojas, falla todo lo que
  importa algo). Lo que se expone son los cinco patrones de siempre y nada de
  `panel/`, `background/` ni `opencode/`; todo se carga por
  `chrome.runtime.getURL()`; `web-accessible.test.js` sigue el cierre
  transitivo. Chrome ≥130 por lo verificado, no por S7.»
- **§8.27** (diagramas): «“Dibujar el flujo” manda su pregunta fija al
  pulsarlo (decisión 17) y no ofrece navegación (decisión 18); sigue sin
  mandar nada más que su texto fijo.»
- **§8.14** (todo fallo silencioso se ve) gana: «un content script vivo pero
  sin arrancar se distingue de uno ausente (`alive`) y de uno roto (`error`),
  y cada consumidor (`offerNotes`, `readPageDigest`, `learnAncestry`,
  `runCurrentStep`, `togglePick`, `focusNote`) dice su motivo».
- **§8.12** (contenido ≠ instrucciones) precisa: «el título de una fila del
  árbol es contenido: se quita del nombre accesible de su chevron y de su
  enlace antes de mirar `FORBIDDEN_ACTIONS`; la lista sigue casando por
  subcadena en todo lo demás».
- **Nueva §8.29**: «El service worker nunca pide un permiso: sólo comprueba
  (`contains`); el diálogo lo abre el panel con gesto. Los registros dinámicos
  se reconcilian en `onInstalled` y por `permissions.onAdded/onRemoved`, sólo
  para sitios configurados y sus enlazados, nunca para los orígenes del
  manifest. PING y SETTINGS no arrancan el content script.»
- **§12, decisiones**: 17 (el botón manda: TOMADA), 18 (sin navegación tras
  un diagrama: TOMADA), 15 sigue como estaba (la viñeta y el ejemplo de
  forma, fuera).
- **§7**: los hechos de plataforma —la redirección GUID→id (MEDIDO),
  `request` con gesto antes que «ya concedido» y el gesto que viaja por
  `sendMessage` sólo en el despacho síncrono (Chromium, SUPUESTO hasta H30),
  los registros dinámicos y la actualización (SUPUESTO hasta H30), el mundo
  aislado nuevo tras recargar (SUPUESTO hasta H30), el mapa de módulos que
  guarda el fallo (whatwg)—.

## 6. Ideas descartadas con motivo (para §12.4)

- **S7, `use_dynamic_url: true`**: incompatible con módulos ES sin build (la
  redirección al id fijo rompe los imports relativos; medido). Las cuatro
  alternativas para conservarla (bundle hoja, módulos sin imports,
  `extension_ids`, `executeScript` en cadena) cuestan un build, un refactor
  entero, una API experimental o no parsean.
- **Reintentar `boot()` sin tope**: el mapa de módulos guarda el fetch
  fallido (whatwg/html#6768); reintentar en la misma página multiplica los
  errores sin arreglar nada. Queda UN reintento y la visibilidad.
- **Un mensaje nuevo para «asegura el script»**: REQUEST_HOST_PERMISSION
  conserva el nombre y cambia el sentido, documentado en §5.
- **`onStartup` en la reconciliación**: `persistAcrossSessions` aguanta el
  reinicio del navegador; el registro sólo se borra al instalar/actualizar.
- **Migrar `assistedByDefault:false` a `'guided'`**: `saveSettings` ya dejó
  escrito el modo migrado (obligatorio desde «Elige el modelo», H17); sólo
  Ajustes lo cambia. Es anterior a H0 y no es una regresión.
- **Casar `FORBIDDEN_ACTIONS` por palabra entera**: debilita la barrera
  («unpublish», «reassign», «undelete», «autosave», «resubmit», «unarchive»
  dejarían de bloquearse). Se quita el título de la fila, no la subcadena.
- **`inSpace` con `viewpage.action` (C3-7)**: un Confluence 9.1+ redirige
  esas URL; si ocurriera, añade un paso en vez de quitarlo; el sitio de Marco
  no las usa.
- **Un relleno de respaldo en el overlay (G8)**: refutado; desde JS no se
  sabe si un `::highlight` pinta, y un relleno ENCIMA de la letra choca con
  §8.10, §8.11 y §8.28 y con la tabla TINTAS.
- **El ejemplo de forma de la decisión 15 dentro de H29**: cambiaría
  `DIAGRAM_QUESTION` y sus pines byte a byte con el espejo; commit aparte si
  Marco lo pide.
- **`matches` con `http://127.0.0.1/*` para cargar la extensión contra el
  banco**: el panel lateral no se maneja desde una pestaña, así que no sirve
  para ninguna comprobación de este plan.

## 7. Lo que sólo se puede verificar en real (la lista de H30)

Con la extensión recargada y una pestaña de Jira o Confluence recargada:

1. Consola de la página: NINGÚN «[faro] fallo en el content script»; en Red,
   `chrome-extension://ickohiffpicdfeameogbihbcanbjibmk/src/…` con 200 para
   `runner.js`, `overlay/overlay.js`, `config.js`, `permissions.js`. (El
   orquestador lo comprueba desde el Chrome de Marco:
   `import('chrome-extension://ickohiffpicdfeameogbihbcanbjibmk/src/shared/config.js')`
   desde la página resuelve.)
2. «Señalar»: la barra azul aparece. Registro: NINGÚN «Content script
   inyectado» falso delante.
3. Análisis en Jira: «Página leída en bloques», «Turno enviado», «Análisis
   marcado · N de N · 1:block+quote … · X ms», y las marcas con fondo azul
   tenue debajo del texto, trazo e insignia (más tenue y de otro color que en
   el original: a propósito, §2 G8); con «Sin marcas · …» el motivo está
   escrito.
4. Búsqueda en Confluence con un destino a dos niveles o más bajo la portada:
   «Camino leído de Confluence · N rama(s)» con N ≥ 1, la tarjeta ofrece
   «Paso a paso» destacado y «Llévame»; «Paso a paso» despliega la rama
   «8700 - Contract + Billing» (C3-8); en Jira sólo «Abrir la búsqueda en
   Jira»/«Llévame» (por diseño). Ajustes → «Cómo te lleva Faro»: mirar qué
   modo tiene Marco.
5. «Dibujar el flujo» bajo una respuesta con 3 claves o más: la burbuja sale
   sin pulsar Enter, «Diagrama · pedido desde el botón», «Turno enviado», el
   diagrama se dibuja, NO aparece «Plan de navegación» ni una tarjeta debajo,
   y `npm run turn -- --all` no lista una sesión del planificador.
6. G3, medido: en la consola del SW, `getRegisteredContentScripts()` y
   `permissions.getAll()` antes y después de «Recargar»; `request` sin gesto
   con un `setTimeout` de 6 s en la consola del panel (y con gesto, con un
   oyente de clic `{once:true}`); dos contextos «Faro — copiloto para Jira y
   Confluence» o uno tras recargar sin recargar la pestaña, y
   `document.querySelectorAll('#faro-overlay-host').length` (no `getElementById`).
7. `chrome://extensions` → Faro → «Errores»: vacío tras una sesión entera; el
   SW no sale «no se puede iniciar».
8. Preguntar a Marco si cargó H26 recargando la entrada vieja (actualización)
   o de cero, y si alguna vez vio «Permiso dado, pero no he podido inyectarme:
   permiso denegado» (la carrera de los 5 s).
9. (Revisión adversaria de H27, D1) Tras «Dar permiso» en un host propio,
   «Content script inyectado» sólo si el content script ARRANCÓ; con un módulo
   roto, «Content script roto» ya en esa primera comprobación, nunca «Listo».
10. (D3) Recargar la extensión con un «Paso a paso» a mitad de un paso: el
    huérfano se apaga sin pulsar nada ni volver a montar el overlay
    (`document.querySelectorAll('#faro-overlay-host').length` en 0 o 1).
11. (D4) Una página con un `<div id="__faroBooted">` (pegado desde la consola
    antes de cargar la extensión, o en el banco) sigue teniendo Faro.
12. (G8) Quitar el permiso de un DC con la pestaña abierta y mirar si Faro
    sigue marcando: `ready` no mira `granted`, a propósito, y se espera que sí
    hasta recargar la pestaña (como hace Chrome con el acceso retirado).
13. (G8) Con «Paso a paso» y «Señalar», que el panel lateral llega SIN
    `sender.tab`: desde la revisión CANCEL_PLAN y CONTENT_STATUS dependen de
    ello, y si no fuera así fallaría todo a la vez («sólo desde el panel»).
14. (D10) «Dar permiso» desde «Qué mirar hoy» (`askTodayPermission`, con un
    `await todayMissingPermission()` delante del diálogo) abre el diálogo de
    Chrome.
15. NUNCA «Quitar Faro» de `chrome://extensions` para probar: borra
   `chrome.storage.local` entero (sitios, contextos, mapas, modelo, diario).
   El control sin código es editar `manifest.json` a mano en la copia de
   trabajo, «Recargar» y luego `git checkout manifest.json`; H27 lo hace ya
   con su commit.

## 8. Decisiones abiertas para Marco

1. **Ejecutar**: el plan está listo; H27 arranca cuando Marco lo diga por
   chat (rama `plan/h27-content-script` sobre `plan/plan3-preparacion`).
2. **El ejemplo de forma de la decisión 15** (`A["ENG-1 resumen [1]"]:::riesgo`
   en `DIAGRAM_QUESTION`): fuera de este plan salvo que lo pida.
3. **Las ramas** (decisión 6 de siempre): sin push ni PR; H27-H30 se apilan.
4. **La huella de Faro** que S7 escondía: si algún día importa, la única
   salida real es un bundle (§6); no se hace sin pedirlo.
5. **El último paso con el script roto** (H28): abortar con motivo, o abrir
   la URL con `tabs.update` si el paso la lleva; el contrato de H28 propone y
   Marco no tiene que decidirlo si le vale lo que proponga.

## 9. Anexos

- `docs/plan/anexo-3-diagnostico.md`: los ocho grupos del agrupador (causa,
  evidencia, cómo comprobar, arreglo, alcance, pines), sus descartes y
  contradicciones resueltas, y los once veredictos de los refutadores con sus
  correcciones y comprobaciones. Este documento decide; el anexo desarrolla, y
  donde contradiga a este plan manda el plan (que ya lleva las correcciones y
  lo medido). Los 60 hallazgos de los cazadores quedan en el scratchpad de la
  sesión del 2026-09-28. Los contratos de cada hito irán a
  `docs/plan/handoff/h27-contrato.md` y siguientes cuando se ejecuten.
