# Plan de evolución de Faro · septiembre 2026

Plan para la siguiente etapa de Faro: corregir lo que está mal, rediseñar el
panel, añadir «Qué mirar hoy», sugerir páginas base, buscar en Jira sin gastar
tokens y hacer el panel más rápido. Sigue la metodología del repo (CLAUDE.md
§9-§11): módulo puro con test → cableado en `panel.js` → comprobación en el
banco → docs (CLAUDE.md, README, INSTALL) → revisión adversaria, en hitos
pequeños y commiteables, cada uno con `npm run check` en verde.

Los diseños detallados de cada área (módulos, mensajes, contratos, tests,
selfchecks, docs) están en `docs/plan/anexo-*.md`. Este documento decide; los
anexos desarrollan. Donde un anexo contradiga a este documento, manda éste.

---

## 0. Cómo se ha hecho este plan

- **Lectura y caza de fallos**: siete lectores (uno por subsistema) y siete
  cazadores con lentes distintas (concurrencia, content script, seguridad,
  rendimiento, lógica pura ejecutada con node, UX y accesibilidad, deriva de
  docs y tests) sobre el código real. 48 hallazgos.
- **Verificación**: 11 hallazgos no reproducidos pasaron por dos jueces
  adversarios (reproducción e intención); 12 sobre módulos puros se
  reprodujeron directamente en Node; 6 de documentación se comprobaron con
  grep; 1 con un juez. Resultado: 30 confirmados, 2 refutados, 16 sin juez
  (reproducidos por el cazador en el banco o contra un opencode real). Los
  fallos de la sección 2 llevan su estado.
- **Diseño**: para cada una de las cinco áreas, tres propuestas desde ángulos
  distintos (arquitecto conservador, valor para el usuario, automatizador sin
  tokens), dos a cuatro jueces que comprobaron cada cita del código y cada
  endpoint en la documentación pública de Atlassian, una síntesis, un crítico
  de completitud y un revisor de conformidad con CLAUDE.md §8-§12.
- **Hechos externos comprobados en la documentación de Data Center**: CQL
  `id in recentlyViewedContent(N)`, `recentlyViewedSpaces`, `favouriteSpaces`,
  campos `contributor`, `watcher`, `mention`, `lastmodified`; JQL
  `issueHistory()`, `watchedIssues()`, `linkedIssues(KEY)`, campo `lastViewed`;
  REST `GET /rest/api/2/search`, `/rest/api/2/filter/favourite`,
  `/rest/api/2/issue/KEY/remotelink`, `/rest/api/2/jql/autocompletedata`;
  Confluence `GET /rest/api/content?spaceKey&type=page&expand=ancestors&start&limit`.
  En Jira **Cloud** `GET /rest/api/2/search` está retirado (410): toda la REST
  de Jira de este plan es sólo Data Center.
- **Lo que se ha medido** (copia de sólo lectura de `opencode.db` y un
  `opencode serve` desechable): `GET /mcp` tarda 2,8-13,8 s la primera vez tras
  arrancar opencode y 1-2 ms después; `GET /config/providers` 60 ms;
  `listMessages` sin `limit` en una sesión de 7 mensajes devuelve 4,9 MB y con
  `limit=2` 14 KB; el `system` de un Análisis en Jira mide 24-27 k caracteres
  (General 2-4 k); opencode **poda** las salidas de herramienta antiguas por
  encima de 40 000 tokens (`PRUNE_PROTECT`, `PRUNE_MINIMUM` 20 000, «[Old tool
  result content cleared]»), así que «cada página base se arrastra para
  siempre» de §7 hay que matizarlo.

## 1. Estado de partida

- Rama `feature/analisis-jira-tipo-estado-y-siempre-subraya` (PR #5 contra
  `main`), árbol limpio, `npm run check` en verde con 540 pruebas, selfcheck
  del banco 1-38 (más 28b), con los huecos 21 y 36 en la numeración.
- `panel.js` tiene 3 732 líneas y todas las áreas lo tocan en las mismas
  funciones (`bootForSite`, `refreshTab`, `send`, `restoreConversation`,
  `paintTurn`, `showWelcome`, `notesCard`, `showSourcesScreen`): los hitos van
  en una sola rama cada uno, nunca dos áreas en paralelo sobre ese fichero.
- Sin verificar en un Jira/Confluence DC reales (heredado de §12): la pantalla
  de claves con dos PAT, un Análisis de punta a punta, la Búsqueda con JQL de
  punta a punta, las cookies de sesión en un `fetch` del panel al Confluence
  enlazado.

---

## 2. Fallos encontrados y qué se hace con cada uno

Estado: **J** confirmado por jueces adversarios · **N** reproducido en Node ·
**B** reproducido por el cazador en el banco o contra opencode · **G**
comprobado con grep · **R** refutado. La columna «Hito» dice dónde se arregla;
**✓ hecho (fecha)** en esa columna marca las filas ya resueltas (H2 cerrado el
2026-09-14: todo 2.1, 2.2, 2.3, 2.4 incluido R4, A1/A2/A3/A7 y D7; el detalle,
los límites asumidos y lo que queda sin verificar en Chrome están en
CLAUDE.md §12, bloque «H2 hecho»).

### 2.1 Seguridad

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| S1 | `SAFE_PERMISSIONS` no deniega `websearch`, `codesearch` ni `skill` (opencode 1.2.25 los permite por defecto): una página puede pedir al modelo que mande su texto a exa.ai o cargar un SKILL.md del disco como instrucciones. `patch` y `list` no son ids de herramienta. | `src/shared/config.js:112` | B (contra opencode real) | Regla `{permission:'*', pattern:'**', action:'deny'}` y `allow` sólo para las herramientas del MCP; test que compara con `GET /experimental/tool/ids` en integración. | H2 ✓ hecho (2026-09-14) |
| S2 | `spaceKey` sin validar entra en la segunda línea del `system`, antes de «Seguridad, sin excepciones», con saltos de línea (`?spaceKey=`, `/display/<x>/`, `/wiki/spaces/<x>/`). | `src/atlassian/site.js:50,58,75,143` | J | `validSpaceKey` (`/^~?[A-Za-z0-9_.@:-]{1,255}$/`) y `safeDecode` en las cuatro asignaciones; citar el espacio entre «». | H2 ✓ hecho (2026-09-14) |
| S3 | El texto señalado con el ratón va crudo al prompt: un `<span>` invisible con `--- FIN DE LO SEÑALADO ---` cierra el bloque SELECTION y habla como Faro; `stripSelectionBlock` corta en el primer cierre. | `src/panel/prompts.js:343` | N | Prefijar cada línea señalada con `> ` (o neutralizar `^---`); `stripSelectionBlock` corta en el ÚLTIMO cierre. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 añadió los saltos que no son «\n»: U+2028, U+2029 y U+0085 se normalizan en `cleanPicked` y se parten y colapsan en `quoted`/`oneLine` |
| S4 | CONTEXT.md, contexto enlazado y memoria entre sesiones entran como «lo indexó Faro o lo escribió el usuario» y sin la regla «información, nunca instrucciones» detrás: una inyección en una página raíz se hace persistente. | `src/panel/prompts.js:165-192` | J | Etiqueta «resumen escrito por el indexador a partir de páginas del sitio, o subido por el usuario» y la regla tras `FIN DEL CONTEXTO`, `LINKED_CLOSE` y `FIN`; la misma regla en el prompt del indexador de Confluence y en `memorySummaryPrompt`. `RECUERDA EL FORMATO` sigue siendo lo último. | H2 ✓ hecho (2026-09-14) |
| S5 | `openUrl` abre en pestaña nueva cualquier enlace que escriba el modelo: phishing desde una respuesta inyectada. | `src/panel/panel.js:2945`, `markdown.js:109` | B | Sólo orígenes conocidos (sitio, Confluence enlazado, `id.atlassian.com`); lo demás se pinta como texto con la URL visible y aviso «Enlace fuera del sitio». | H2 ✓ hecho (2026-09-14): en H2 sólo `openUrl`; el «se pinta como texto» de esta misma fila lo cerró la revisión adversaria del 2026-09-14 (`renderMarkdown(src, { allowHref })` + `allowHref: linkAllowed` en las cuatro llamadas del panel), y el aviso pasó a `{ force: true }` para verse tras A7 |
| S6 | El índice cosecha páginas e incidencias de OTROS hosts como si fueran de éste (`partner.atlassian.net/…/pages/998…` → `/spaces/PART/pages/998…` propio): «Llévame» a un 404. | `src/panel/indexer.js:179,219` | N | Antes de las regex, sustituir por espacios toda URL absoluta cuyo host no sea el del sitio (ni el enlazado). | H2 ✓ hecho (2026-09-14) |
| S7 | `web_accessible_resources` para `https://*/*` con id fijo: cualquier web detecta Faro y lee `config.js`. | `manifest.json:54` | G | `use_dynamic_url: true`; pinar en `test/manifest.js`. Además se exponen `src/atlassian/*.js` y `src/nav/*.js` (los módulos REST nuevos los importan desde el content script) con un test de que todo import transitivo de lo que carga `bootstrap.js` está bajo rutas expuestas. | H2 ✓ hecho (2026-09-14) |

### 2.2 Concurrencia y ciclo de vida

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| C1 | Cambiar a una pestaña de OTRO host a mitad de turno: `bootForSite` → `buildClient` → `disconnect()` deja al `runTurn` sin eventos; 90 s de «pensando», abort tardío de un turno que quizá acabó, error en una burbuja desconectada, `state.streaming` colgado. Misma raíz que «cerrar Ajustes mata el turno». | `panel.js:293,298,193` | J | En `buildClient()`, antes de `disconnect()`: `if (state.streaming) state.turnAbort?.abort()` + «Turno cancelado» (no en `refreshTab`: allí también salta al pasar a Gmail). Y Ajustes deja de rearrancar si no cambió servidor/contraseña (E). | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 añadió el `abort(state.sessionID)` en el servidor (sin él, desde C6 opencode seguía ejecutando el turno entero) y el corte del indexado en vuelo, y `changedHost` pasó a compararse con `state.lastHost`: volver de Gmail ya no es cambio de sitio |
| C2 | `generateContext` guarda contexto e índice bajo `state.site.host` de AHORA tras un `await` de minutos: el contexto de A se guarda en B y B queda `onboarded`. | `panel.js:3666,3672,3673,3687` | J | Capturar `sitio` al empezar y usarlo en todas las escrituras (también en el `catch`); si el host cambió, fundir con el índice GUARDADO de ese host y no tocar `state`. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 convirtió `sigueAqui` en una FUNCIÓN preguntada en cada uso (se evaluaba una vez) y separó cancelado de fallido: un indexado cancelado no escribe nada y el sitio NO queda `onboarded` («Indexado cancelado») |
| C3 | Dos `bootForSite` solapados sin testigo (onActivated ×2, botones): chat duplicado y cliente SSE zombi (`disconnect()` no es definitivo). | `panel.js:298,307,392`; `client.js:456-467` | J | `this._closed` en el cliente; testigo `state.client !== client` tras `health()` y antes de `restoreConversation()`; vaciar el chat DESPUÉS del `await listMessages`. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 hizo que `runTurn` MIRE el `false` de `ready()` (un cliente cerrado mandaba `prompt_async` a ciegas y el turno corría de verdad en opencode hasta agotar `stallMs`) |
| C4 | «Nueva sesión» a mitad de turno: respuesta en burbuja desconectada, tarjetas bajo la bienvenida, `state.turns` con respuesta huérfana. | `panel.js:3711` | J | `state.turnAbort?.abort()` al principio de `newSession` (el `finally` del turno apaga el streaming); o desactivar el botón en `setStreaming`. | H2 ✓ hecho (2026-09-14) |
| C5 | El paso manual del MCP espera hasta 15 min y `finishSetup` lee `state.site` en vivo: TypeError con una pestaña fuera de Atlassian, o registros de A escritos en B. | `panel.js:3593,3612-3620` | J | Guardar `site` en `state.pendingMcp` y usarlo; `refreshTab` aborta `state.mcpWait` al cambiar de host. | H2 ✓ hecho (2026-09-14) |
| C6 | Parar y mandar otra pregunta en menos de 1 s: el vigilante del turno viejo (sondeo de 1 s) aborta la sesión y se lleva el turno nuevo. | `client.js:289-301` | N | Escuchar `signal` con `addEventListener('abort')` y no llamar a `this.abort(id)` en `aborted` (quien abortó ya abortó la sesión). | H2 ✓ hecho (2026-09-14); consecuencia cerrada en la revisión adversaria del 2026-09-14: quien cancela tiene que abortar él la sesión, así que `buildClient` llama a `abort(state.sessionID)` antes de tirar el cliente |
| C7 | Repintar el chat a mitad de turno sin reconstruir el cliente (reindexar, «Omitir», subir contexto) deja el pintado final en una burbuja desconectada. | `panel.js:1085` | (baja) | `const cuerpo = body.isConnected ? body : liveBubble(null)` antes del pintado final, como ya hace el `repaint` del Análisis. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 cambió `mismoSitio` a `state.site?.host ?? state.lastHost`: con la pestaña en Gmail la respuesta SÍ es suya y se pinta |

### 2.3 Marcado y navegación

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| M1 | El digest de una incidencia depende del scroll del panel interno: `visibleRects` sólo corrige por `window.scrollX/Y`; con el panel desplazado, los bloques de arriba se dan por ocultos (33 bloques → 6 → 0) y `applyNotes` no casa. La selfcheck 38 lo tapa poniendo `scrollTop = 0` antes. | `src/content/digest.js:84` | B (banco) | Sumar el `scrollTop/Left` de todos los contenedores con scroll que envuelven al elemento (como ya hace `scrollWithinScrollers`). Selfcheck: el digest con el panel arriba === con el panel abajo. | H2 ✓ hecho (2026-09-14) |
| M2 | Tras cualquier análisis o anclaje, `_onKey` se traga TODOS los Escape de la página para siempre (`onCancel` nunca vuelve a null; `clearAll`/`clearNotes` no lo tocan). | `overlay.js:138`; `runner.js:98,488,565` | B (banco) | `_onKey` sólo intercepta si hay algo de Faro en pantalla; `clearAll`/`clearNotes`/`hideCard` ponen `onCancel = null`; `applyNotes` no instala un `onCancel` que borre marcas sin avisar al panel. | H2 ✓ hecho (2026-09-14), salvo `hideCard` (desvío razonado: con el cartel escondido el barrido sigue con el foco puesto y tiene que poder cancelarse; ver CLAUDE.md §12). La revisión adversaria del 2026-09-14 cerró lo que quedaba a medias: `this.cancelled` también tras `_abrirRama`, tras cada `_flash` y DENTRO de la ronda del barrido, e `interceptsEscape()` vuelve a contar el subrayado de una llegada mientras no haya marcas numeradas |
| M3 | `isAlreadyHere` da por alcanzado un paso si el id es PREFIJO del actual (1234 en 12345, ENG-7 en ENG-70, ENG en ENGINE): ancla en la página equivocada. | `runner.js:718-722` | N | Casar con frontera `(?=[/?#]|$)` y `(?=&|#|$)`. | H2 ✓ hecho (2026-09-14) |
| M4 | Siglas «UTF-8», «ISO-8601», «COVID-19», «HTTP-404» se cosechan como incidencias y pueden ser destino de «Llévame». | `indexer.js:219` | N | Cosechar claves sueltas sólo si el proyecto es conocido (sitio, `index.projects`, JSON de `jira_search`), o si vienen en `/browse/KEY`. | H2 ✓ hecho (2026-09-14) |
| M5 | Una sola viñeta en una respuesta corta se convierte en «[1]» (estilo `bullets` con `min: 1`) y esquiva los frenos de «respuesta corta» y «seguimiento»: un turno estructurado tirado. | `notes.js:362` | N | `min: 2` para `bullets`; no adaptar estilos débiles con `answer.length < shortAnswer`. | H2 ✓ hecho (2026-09-14) |
| M6 | Un `n: 1.5` en el JSON de anclas tira el bloque ENTERO (el JSON se ve en el chat, sin anclas); `n: true` cuenta como la observación 1. | `notes.js:699` | N | `esAncla` exige entero o `/^\d{1,2}$/`; el bloque vale si ALGUNA entrada es ancla. | H2 ✓ hecho (2026-09-14) |
| M7 | `titleFromProse` toma el `[1]` de un código en línea o de un enlace por la marca. | `notes.js:563` | N | Buscar sobre una copia «cegada» (vallas, código, enlaces → espacios) y leer del original. | H2 ✓ hecho (2026-09-14) |
| M8 | `focusNote` re-resuelve un Range muerto sin exigir caja visible (al revés que `applyNotes`): `ok:true` con nada que mirar. | `runner.js:621` | (baja) | Misma guardia `rangeRect(...)`; `visibleResolution(resolved)` compartida. | H2 ✓ hecho (2026-09-14) |
| M9 | El barrido del árbol pulsa cualquier `[aria-expanded="false"]`, incluidos disparadores de menú (`aria-haspopup`). | `locators.js:315`; `tree-dom.js:210` | (baja, sin reproducir) | `aria-haspopup`/`aria-controls`→`role=menu` → no seguro; `expandersIn` los salta. | H2 ✓ hecho (2026-09-14) |

### 2.4 Robustez

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| R1 | `memoryToPrompt` lanza «Invalid time value» con una entrada sin fecha y tumba TODOS los turnos del host mientras la memoria esté activa. `memory.js` no tiene tests. | `memory.js:61` | N | Fecha opcional; `getMemory` normaliza; `test/unit/memory.test.js`. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 añadió `instantOf`: una fecha en TEXTO que `Date.parse` entienda se rescata como número en vez de perderse |
| R2 | `parseAtlassianUrl` lanza `URIError` con un `%` mal codificado en la clave del espacio; llega desde `consultedOutside` (el modelo), `pageRefFromUrl` (el usuario) y `samePage`/`refreshTab` (la pestaña): `send()` cae al `catch` y no se subraya. | `site.js:50,58` | N | `safeDecode` (ya existe, :173) en las dos ramas de Confluence. | H2 ✓ hecho (2026-09-14) |
| R3 | `siteBaseUrl` conserva un enlace corto `/x/AbCd` como ruta de contexto: el MCP se configura con una dirección que no existe. | `setup.js:100` | N | Añadir `x` a las rutas de producto que se recortan. | H2 ✓ hecho (2026-09-14) |
| R4 | `client.summarize()` manda `{model}` y el esquema exige `{providerID, modelID}` (400 seguro). Sin uso hoy. | `client.js:191` | (síntesis E, comprobado en `/doc`) | Corregir el cuerpo; comprobar en integración. | H3 → ✓ hecho en H2 (2026-09-14) y CERRADO en H3 (2026-09-19): el cuerpo bueno ya se ejercita en integración, `summarize(id, {providerID, modelID})` devolvió 200 y compactó en 2,2 s; sigue sin uso en el panel |

### 2.5 Accesibilidad y UX

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| A1 | Las pantallas a pantalla completa no reciben el foco ni dejan inerte lo de detrás: Tab recorre siete controles tapados (Intro en una sugerencia mandaría un turno con Ajustes abierto); «Listo» tira el foco al `body`. | `panel.js:2951,2965` | B (banco) | `<div id="app">` con `inert` mientras hay pantalla; enfocar el h1 (`tabindex=-1`) o el primer input; devolver el foco al cerrar. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 extendió lo mismo al velo «Trabajando…» (`showBusy` deja `#app` inerte y enfoca su Cancelar, que sólo se enseña si hay abortador) |
| A2 | `#chat` entero es `aria-live="polite"` y `paintTurn` reconstruye la burbuja en cada delta: un lector de pantalla encola la respuesta acumulada 120 veces; `restoreConversation` re-anuncia el historial. | `panel.html:39`; `panel.js:1219` | J (gravedad media) | `aria-busy` en `#chat` desde `setStreaming` (primer paso, gratis); anunciador `sr-only` aparte con un resumen corto al final del turno («Respuesta lista · N observaciones»); `restoreConversation` no lo dispara. No quitar `aria-live` sin pasar TODO lo que hoy se anuncia por el anunciador. | H2 ✓ hecho (2026-09-14) |
| A3 | Esc no cierra Ajustes, Memoria, Registro ni el velo «Trabajando…»; en Páginas base sólo con el foco en el campo. | `panel.js:2732` | B | Mapa puro `ESCAPE_CLOSES` (sólo pantallas de consulta; connect/setup/context no) + un `keydown` a nivel de documento. | H2 ✓ hecho (2026-09-14); la revisión adversaria del 2026-09-14 sacó Ajustes de `ESCAPE_CLOSES` a `ESCAPE_DISMISSES`: Escape lo cierra SIN guardar, porque su «Listo» guarda y rearranca el panel |
| A4 | Foco de inputs y textarea: `outline: none` y un borde a 1,3-1,8:1; fila activa del combobox a 1,1:1. | `panel.css:359,410,826` | B (calculado) | Anillo `--mark` en foco; marcador izquierdo en `.suggest-row.active`. Entra con los tokens. | H4 ✓ hecho (2026-09-19): ningún `outline: none` queda en panel.css (pinado), el anillo es `outline: 2px solid var(--mark)`, los bordes de controles pasan a `--hairline-strong` (3,01-3,52 según el fondo y el tema, y la tarjeta `.choice` entró en la revisión adversaria: era el único control cuyo borde seguía en `--hairline`, 1,30) y `.suggest-row.active` lleva `box-shadow: inset 3px 0 0 var(--mark)`. En claro `--hairline-strong` es `#8A8894` y no el `#8F8D99` del anexo: ese 3,26 estaba medido sobre `--surface`, sobre `--ground` se quedaba en 2,9977, y sobre `--surface-2` —los dos `<select>` del redactor, que nadie medía— el `#8E8C98` de H4 se quedaba en 2,8833 |
| A5 | Texto de `button.primary` y `.send` sobre `--gold` claro: 3,09:1 (AA exige 4,5). | `panel.css:362-368,434` | J | Desdoblar el dorado: `--mark` (relleno, el oro del overlay) con `--on-mark` #1B1405 (9,11:1). | H4 ✓ hecho (2026-09-19): 3,09 → 9,11 en reposo y 6,22 con el ratón encima, medido por `panel-css.test.js` y por `npm run contrast` en los dos temas |
| A6 | A 320 px el chip de ubicación queda en «Co…» (44 px para 218) con `title` fijo y sin acción, y el `<select>` de Skill en 35 px. | `panel.css:131,618` | B | El chip pasa a ser el elemento flexible (clave + título) con `title` = ubicación; la Skill no cede (`flex: none`), cede el modelo. | H5 |
| A7 | El chat se desplaza al fondo en cada delta aunque el usuario haya subido a leer; también al colgar la tarjeta segundos después. | `panel.js:1225,1270` | J | `stuckToBottom` medido ANTES de mutar; `scrollChat` sólo si estaba pegado; forzar sólo con la pregunta del usuario. | H2 ✓ hecho (2026-09-14) |
| A8 | `.perm-card` y `button.ghost.on` se pintan desde JS y no existen en el CSS; hover/activo del overlay #FFF7E8 sobre #C98A22 a 2,76:1. | `panel.js:501,3115`; `styles.js:190,328,331` | (síntesis D, comprobado) | Reglas nuevas; texto #1B1405 en el overlay (6,22:1). | H4 ✓ hecho (2026-09-19): `.perm-card` y `button.ghost.on` existen en el CSS (pinado por panel-wiring), y los tres `#FFF7E8` del overlay pasan a `#1B1405`, 2,76 → 6,22, sin tocar geometría, animaciones, clases ni neutros |
| A9 | Con `prefers-reduced-motion` las animaciones infinitas «parpadean» y «Reducir animaciones» nunca llega al panel. | `panel.css:516` | **R** (los dos jueces lo reprodujeron en Chromium: las animaciones quedan clavadas en el keyframe 0, sin parpadeo). Lo que sí es cierto: la barra `.busy-bar i` queda vacía y el ajuste de Faro sólo afecta al overlay. | `.busy-bar i { animation: none; width: 100% }` bajo la media query; `html.faro-still` aplicado por `applySettingsToUi` (entra con el rediseño). | H4 ✓ hecho (2026-09-19): `html.faro-still` con las mismas reglas que la media query más `animation-iteration-count: 1`, `scroll-behavior: auto` y la barra de «Trabajando…» llena; `applySettingsToUi` la cuelga del `<html>` y el `scrollIntoView` de `NOTE_CLICKED` usa `behavior: 'auto'` con el ajuste puesto. Sin verificar en Chrome: el espejo no corre `applySettingsToUi` |

### 2.6 Rendimiento

| # | Fallo | Dónde | Estado | Arreglo | Hito |
|---|---|---|---|---|---|
| P1 | El overlay repinta TODAS las marcas en cada evento de scroll leyendo la geometría dos veces e intercalando lecturas y escrituras: 41 ms por evento en una página de 16 000 elementos. Además recrea cada rectángulo con `opacity: 0` y transición de 0,4 s: las marcas **parpadean** al hacer scroll (el usuario lo ve en su Jira). | `overlay.js:78,144,431-460,471`; `styles.js:225-233` | B (medido) | Un rAF coalescido; medir una vez por observación y pasar `{rects, ultimo}` a las dos capas; `_syncNodes` que reutiliza los nodos y pone `on` al instante sin barrido. Selfcheck: 40 scrolls → `created === 0`, mismos nodos, todos `on`. | H6 ✓ hecho (2026-09-19): `_scheduleRefresh` junta la ráfaga de scroll en un rAF, `_prepareGroups` y `_measureGroups` miden una vez para las dos capas, `_syncNodes` reutiliza los nodos y `on` se pone al instante; como los nodos ya no se recrean, la clase `sweep` hay que quitarla a propósito (`barrer`, `animationend` + respaldo `SWEEP_MS`). Selfchecks 41 y 42. **Revisión adversaria (2026-09-19)**: desde que las capas no se vacían, la poda de `_syncNodes` es lo ÚNICO que borra una marca de la pantalla y borrarla dejaba las 943 pruebas en verde → tres pines en `overlay-wiring.test.js` y un `ok(` más en el tramo 41 (corrido: 76/76) |
| P2 | `paintTurn` reconstruye la burbuja entera por cada delta, también por los deltas de `reasoning` que no cambian nada visible. | `panel.js:1064,1182`; `turn.js:150` | (medido: el parseo es barato, el DOM no) | `TurnTracker` no notifica por `reasoning`; `paintTurnSoon` con un rAF por frame y final síncrono. | H6 ✓ hecho (2026-09-19): `TurnTracker` no avisa por un delta de `reasoning` (sigue contando como señal de vida por el `ALIVE` de `runTurn`); `paintTurnSoon` lo hizo H5. Y de paso `onWarn` a mitad del plazo: «pensando… 45 s sin señales del modelo», que se retira con la primera palabra |
| P3 | El índice entero se serializa y escribe hasta TRES veces por turno (`growIndex`, `growTreeFromPage`, `onIndex`) y cada fusión lo clona por JSON. | `panel.js:1337,1370,1480`; `index-store.js:196` | N (medido) | `state.indexDirty` + `persistIndex()` una vez al final de `send()`; copias superficiales de los cuatro buckets en `mergeIndex`. | H6 ✓ hecho (2026-09-19): `markIndexDirty` + `state.indexDirty` + `persistIndex()` con «Índice guardado» e «Índice sin guardar», y `conCubosPropios` en vez del clon por JSON (2,93 → 1,88 ms con 2 000 páginas contra 2 000 en dos ejecuciones de `npm run bench`; 1,68 ms en la del cierre). `offerNotes` pasa delante del índice. **Revisión adversaria (2026-09-19)**: al ir detrás de `offerNotes`, la cosecha leía el sitio VIVO y podía apuntar bajo otro host → sitio capturado al mandar, «Índice sin ampliar» si el panel ya no está ahí; y la escritura tardía pisaba ENTERO un `generateContext` del mismo host → `generateContext` funde lo apuntado y `persistIndex` prefiere `state.index` si el panel sigue en ese host |
| P4 | `bootForSite` encadena en serie cuatro peticiones y ~13 lecturas de storage (`getSite` del mismo host seis veces). | `panel.js:303-385` | (trazado) | `getSiteBundle(host)` en una lectura; `Promise.all([models(), getSessionId()])`. | H6 ✓ hecho (2026-09-19): `getSiteBundle(host)` + `bundleKeys`/`BUNDLE_EXTRA_KEYS` + `takeIndex` en storage.js, y `Promise.all([getSiteBundle, getSessionId, models])`; queda UN `getSite` en todo el arranque. Fases renombradas a health · modelos y almacenamiento · MCP · enlazado · restaurar, porque al ir en paralelo dejaron de medir lo que decían. **Revisión adversaria (2026-09-19)**: el «un solo `getSite`» era falso en un Jira con Confluence enlazado (`loadLinkedContext` encadenaba `getContextMd` + `getIndex` + `getSite`) → también `getSiteBundle`; y «Omitir» escribía `onboarded` sin apagar el arranque que decidía esa pantalla → testigo nuevo |
| P5 | `GET /mcp` tarda segundos en frío y el chat espera. | `panel.js:331` | B (medido) | Comprobación del MCP en segundo plano si el sitio ya estaba configurado (`state.mcpCheck`), capturada en `send()` y esperada sólo en `warnAboutSources`. Condicionado a medirlo en el opencode del usuario (H3). | H6 — **NO hecho, pendiente de la lectura de H3**: el plan lo condiciona a leer «Arranque del panel · MCP N ms» en frío en el opencode de Marco, y esa lectura sigue sin hacerse; el MCP se sigue esperando en el camino crítico. Si ese número baja de ~1 s, el anexo E dice que P5 sobra. Falta, si se hace: `state.mcpCheck`, `mcpCheckAlPedir` en `send()`, `mcpConnected: await mcpCheckAlPedir` en `warnAboutSources` y los dos textos de «comprobando el MCP…» |
| P6 | Cerrar Ajustes rearranca SIEMPRE (`bootForSite`) y por tanto `restoreConversation` descarga la sesión entera y `buildClient` mata el turno en curso. | `panel.js:3407-3419` | R como «restoreConversation sin limit es un bug» (es diseño: hace falta todo para agrupar y la API no permite excluir `system`); **sí** vale el rearranque innecesario. | Rearrancar sólo si cambió servidor o contraseña; `listMessages(id, RESTORE_LIMITS.messages)` + `sortMessages` + «Ver toda la conversación». | H6 ✓ hecho (2026-09-19): `clientChanged` + «Ajustes aplicados», y `chrome.storage.onChanged` en el service worker para que la PÁGINA reciba los ajustes al momento (sin mensaje nuevo); `listMessages(id, RESTORE_LIMITS.messages)` + `sortMessages` + `dropOrphans` + `.older-turns` con «Ver toda la conversación» + «Conversación recortada» + `.msg.restored`, más «Conversación pesada» con `faro:session-weight:<host>`. Desvío anotado: el botón NO va en panel.html, porque la fila vive DENTRO del chat, que se vacía en cada restauración |
| P7 | `resolveBlockQuote` recalcula el ámbito (`digestScope` → `jiraIssueScope`, `contentRoot().textContent`) por cada observación. | `digest.js:204,272,302` | (trazado) | `applyNotes` calcula `scope` una vez y lo pasa. | H6 ✓ hecho (2026-09-19): `const scope = digestScope()` una vez en `applyNotes`, `resolveBlockQuote(anchor, { digest, scope })` en los tres sitios que lo recalculaban y `rootIndex` memorizando el índice de texto en el ámbito; además `stickyOffset` memoriza su medida `STICKY_CACHE_MS` junto al tamaño del viewport. Selfchecks 42 y 43. **Revisión adversaria (2026-09-19)**: el pin de P7 no cazaba que se tirara el ámbito recibido (`let ambito = null` pasaba las 943) → pin de la inicialización y un `ok(` más en el tramo 43 (corrido: 76/76) |
| P8 | `paintLog` reconstruye 200 filas por cada entrada mientras el Registro está abierto. | `panel.js:3084-3094` | (trazado) | Insertar sólo la fila nueva; repintar entero al cambiar el filtro. | H6 ✓ hecho (2026-09-19): `log.subscribe((entry) => …)` + `appendLogRow` + `logRow` + `LOG_ROWS`; el repintado entero se queda para abrir la pantalla, cambiar el filtro y `log.clear()`, que avisa SIN entrada. **Revisión adversaria (2026-09-19)**: con «sólo problemas» el tope de 200 filas no se dispara nunca, así que a partir de las 400 entradas del Logger la lista enseñaba filas que `paintLog()` ya no pintaría → `Logger.oldestId`, `row.dataset.id` y poda por id antes del filtro, con `log.test.js` (4 pruebas) comparando la lista incremental con el repintado entero a 600 y 1200 entradas |

### 2.7 Documentación y tests

| # | Fallo | Estado | Arreglo | Hito |
|---|---|---|---|---|
| D1 | `AGENTS.md` es una copia congelada del mapa (commit 7833bab: 464 pruebas, sin §4.7/§4.8). | G | Pasa a ser un puntero de tres líneas a CLAUDE.md; test que lo pina. | H1 |
| D2 | Ocho títulos de registro que §9 da por «documentados en INSTALL» no están («Marcas conservadas», «Marcas sobrantes», «Página base añadida/quitada/sin título», «Alcance del análisis», «Páginas base sin leer», «Contexto de Confluence enlazado»); en total `src/` emite 60 títulos y 35 no están ni en CLAUDE.md ni en INSTALL. | G | Sembrarlos; `tools/check-docs.mjs` como paso 5 de `npm run check`. | H1 |
| D3 | `NAV_TIMING` no lo importa nadie: `bootstrap.js` y `runner.js` llevan los números copiados; `highlightHoldMs` no existe en ningún sitio; el `9000` del SW va suelto. | G | `bootstrap.js` importa `NAV_TIMING`; los `??` de `runner.js` salen de ahí; test por regex. | H1 |
| D4 | Ocho exportaciones muertas (`HIGHLIGHT_STYLES`, `sendToRuntime`, `isVisible`, `FILES`/`workspaceForHost`, `isAtlassianUrl` (que además devuelve true para cualquier http), `expanderFor`, `incrementalIndexPrompt`, `humanDuration`) y código muerto en el cliente (`listSessions`, `disconnectMcp`, `readFile`, `state.tracker`). | G | Borrar o usar; `test/unit/dead-exports.test.js` (hermano de `undefined-refs`). | H1 |
| D5 | CLAUDE.md contradice al código: `panel.js (~2500)`, pines de §10 que ya no son los del test (`mcpStatusFor(mcp, …, saved?.mcpName)`, `normalizeNumbering(cruda).prose`), «selfcheck 36» sin número en el banco, `remark`. | G | Corregir; numerar 21 y 36 en el banco; `docs.test.js` que comprueba que cada fragmento de §10 entre acentos graves aparece en `panel.js` o en el test. | H1 |
| D6 | Funciones puras sin test: `fixWikiPrefix`, `canonicalPagePath`, `canonicalSpacePath`, `isRealSpaceKey`, `suggestsAnotherModel`, `clockTime`, `waitForMcpReady`, todo `memory.js`; `client.js` sin test unitario (`runTurn`, `promptStructured`, `_pump`). | G | Tests con `fetch` falso y `chrome` simulado. | H1/H2 ✓ (H1: los tests; H2: R1 en memory.js) |
| D7 | `markdown.js`: `**a *b* c**` rompe la negrita con cursiva dentro (justo la forma que `normalizeNumbering` conserva). | N | `(\*\*(?:[^*]|\*(?!\*))+\*\*)`. | H2 ✓ hecho (2026-09-14) |
| D8 | No hay prueba de instantánea de los prompts completos: cada área pina «sin X byte a byte igual» por pares y una interacción cruzada no la ve nadie. | (crítico) | `test/unit/prompt-snapshots.test.js` con ~12 escenarios (Confluence/Jira × General/Búsqueda/Análisis × con/sin páginas base) contra `test/fixtures/prompts/*.txt`, actualizados a conciencia. | H1 |

---

## 3. Las cinco áreas: qué se decide

### 3.1 «Qué mirar hoy»: recomendaciones por actividad, sin modelo

Se construye la arquitectura conservadora con los injertos de valor:

- **Actividad local** (`src/atlassian/activity.js`, puro; `src/shared/activity-store.js`)
  por host de la ENTIDAD: `items{'jira-issue:KEY'|'confluence-page:ID': {kind, id,
  title ≤200, path relativa, seenAt, seenCount, analyzedAt, analyzedCount, notes,
  family, sourceAt}}` y `dismissed{}`; 300 entradas, 30 días, dedupe 60 s;
  sólo hosts con `configured: true`; nunca URL completa, parámetros, texto ni
  prompt. La apunta el **service worker** (un solo escritor) con
  `chrome.tabs.onUpdated` (funciona con el panel cerrado y sin content script)
  y con `CONTENT_READY`/`URL_CHANGED`, que pasan a llevar `pageId` leído de
  `<meta name="ajs-page-id">` (lo único que identifica una página
  `/display/ESPACIO/Título` de un Confluence DC). Lo que sólo el panel sabe
  (qué analizaste, con cuántas observaciones, qué usas como página base) lo
  apunta `send()`/`addSource` por un gancho único `recordAnalysisTurn`
  compartido con las sugerencias de páginas base.
- **Lo que el sitio sabe de ti** se lee por REST con la sesión del navegador,
  con **consultas de plantilla fija** y parámetros validados (el panel manda
  `{kind, projectKey?, issueKey?, ids?, days?}`; la JQL/CQL la monta el content
  script): Jira `issuekey in issueHistory() ORDER BY lastViewed DESC` (ante 400,
  `ORDER BY updated DESC`), `assignee/reporter = currentUser() OR issuekey in
  watchedIssues()` con `updated >= -7d`, `project = KEY AND updated >= -3d`,
  `issue in linkedIssues(KEY)`; Confluence `id in recentlyViewedContent(30)`,
  `contributor/watcher/mention/favourite = currentUser()` con `lastmodified >=
  startOfDay("-7d")`, `id in (…)` con las páginas analizadas/base. Desde el
  content script para el producto de la pestaña; desde el panel con
  `credentials: 'include'` sólo para el **Confluence enlazado** (lo ya admitido
  en §4.8). En Jira Cloud no se consulta la REST (410).
- **Puntuación pura y explicable** (`src/panel/today.js`): la señal fuerte es
  «cambió desde que lo miraste/analizaste» (+40/+25), «página base de tus
  análisis modificada» (+25), asignada/mencionada (+15), relación con lo abierto
  (`linkedIssues`, hermanas por `ancestryOf`, misma familia), familias que más
  analizas, cerradas al final. ≤8 filas (≤5 por producto), cada una con su
  porqué en español («cambió ayer · lo analizaste el lunes con 6
  observaciones»). Caché 15 min en `storage.session`. Sin modelo; el turno
  «Que Faro lo ordene» queda diseñado como botón opcional de segunda fase y NO
  se construye.
- **UI**: hasta tres filas en el estado vacío del chat (tope que fija el
  rediseño), icono `#btn-today` con insignia en la cabecera y pantalla
  `screen-today` por grupos («Cambió desde que lo miraste», «Lo tuyo», «Nuevo
  en SIMPL») con «Abrir», «Analizar» (navega, fija la Skill Análisis y deja la
  pregunta en el cuadro SIN mandarla: `pendingIntent` consumido en
  `refreshTab`) y «×» («Ya lo he visto», vuelve si cambia). Interruptor global
  `todaySuggestions` (subordinado al maestro `restTools`) y `todayOff` por
  sitio. «Borrar mi actividad» y una línea que dice qué se guarda y dónde.
- **Navegar**: un ítem del host propio se funde en el índice y pasa por
  `validatePlan` (§8.3), como cualquier `jira-issue`/`confluence-page`; un
  ítem del host enlazado abre pestaña nueva con `openUrl(origin +
  canonicalPagePath)` con host e id validados (nunca `NAVIGATE_DIRECT`, que
  cambiaría la pestaña de sitio).

Descartado con motivo (→ §12): `chrome.history` (permiso sobre todo el
historial para ganar los días anteriores a instalar Faro, que `issueHistory()`
y `recentlyViewedContent()` ya dan); cookies como almacén (no son de la
extensión y viajan al servidor); recomendar con el modelo por defecto o en
segundo plano; `myself`/`user/current`; `expand=changelog`; apuntar «visto»
desde el panel (doble escritor); consultar el **Jira** enlazado desde una
pestaña de Confluence hasta que el PASO 0 confirme las cookies (v1 sólo
Confluence enlazado desde Jira, lo ya admitido).

### 3.2 Páginas base sugeridas (del contexto y de análisis anteriores)

- **Cuatro fuentes, ninguna con modelo en tiempo real**: (1) los enlaces a
  Confluence del cuerpo de la incidencia o de la página, leídos por el content
  script con el ámbito genérico `digestScope()` menos `scope.chrome`
  (`src/content/page-links.js`, `MSG.PAGE_LINKS`), etiquetados por región
  (`ISSUE_LINK_REGIONS` exportadas desde `jira-issue.js`: descripción, módulo
  de enlaces, comentario; `pagina` en Confluence), más en Jira DC los **enlaces
  remotos** `GET /rest/api/2/issue/KEY/remotelink` (dan el `pageId` de una
  «Wiki Page» sin depender del DOM ni de la sesión del Confluence); (2) el
  **historial de análisis con páginas base** (`src/panel/source-history.js`,
  `faro:source-history:<host>`: una entrada por `issueKey||pageId` con familia,
  fase, componentes, etiquetas, palabras del título y las páginas elegidas; 60
  entradas, 90 días); (3) las **páginas de referencia del contexto**
  (`src/panel/references.js`: parser de prosa del CONTEXT.md que reconoce ids y
  el papel —guía, ADR, plantilla, glosario, convenciones— por la línea o por el
  encabezado en vigor; el indexador de Confluence gana la frase «nombra las
  páginas de referencia por su título y su id», que el de Jira ya lleva); (4)
  el **índice** (títulos con forma de referencia y palabras compartidas).
- **Puntuación pura** (`src/panel/source-suggest.js`) con umbral 25: enlazada
  desde la descripción 50, remota 50, desde comentario 35; usada en ESTA
  incidencia 40; misma familia y proyecto con N≥2 análisis 30+; componente o
  etiqueta compartida 30; referencia del contexto 25 (+10 si su papel casa con
  la familia); título del índice 12-21 (nunca solo). Decaimiento a 60 días.
  Un `/display/ESPACIO/Título` sin id se resuelve **sólo** por el índice (título
  plegado + espacio, con `decodeSlug` exportado) o por el `pageId` del
  remotelink: **nunca mandando un título del DOM a la API** (§8.12).
- **UI**: sección «Sugeridas» entre el campo y «Páginas elegidas», hasta cinco
  filas con su motivo («enlazada desde la descripción · la usaste en 3 análisis
  de API en SIMPL»), oculta mientras se escribe en el campo, «Añadir las N»,
  «Olvidar el historial», y la frase fija «Nada se añade solo: pulsa una para
  añadirla». Desde Jira DC son páginas del Confluence enlazado (`path ''`,
  nunca fundidas en el índice del Jira).
- **Decisión sobre `references` estructuradas**: NO se añade la propiedad
  opcional a `INDEX_SCHEMA` en la fase 2 del indexador, porque el contexto por
  REST (3.3) salta esa fase en el camino feliz. Se confía en la frase nueva de
  la fase 1 y en el parser de prosa; si tras reindexar en el sitio real el
  parser no basta, se decidirá entonces.
- **Privacidad**: el historial guarda claves de incidencia e ids (nunca texto);
  se documenta en README §Seguridad e INSTALL; se borra con «Olvidar el
  historial» y con «Olvidar este sitio»; nunca entra en un prompt (pinado).

Descartado: resolver `/display/` por título contra la API; bucket `references`
dentro del índice v3 («SÓLO rutas»); cuarta fase del indexador con `format`;
mensaje `ISSUE_LINKS` sólo de Jira; guardar los ids que el modelo leyó;
búsquedas en tiempo real por etiqueta o actividad (es 3.1).

### 3.3 Herramientas sin tokens: JQL, búsquedas sugeridas, índice por REST

Inventario de lo que hoy hace el modelo y hará un script (irá a CLAUDE.md
§4.9): ejecutar la JQL y listar incidencias (`jira_search` vía modelo, 5-30 s y
3-15 KB arrastrados → `GET /rest/api/2/search`, 100-400 ms, 0 tokens); nombres
exactos de tipos y estados para la JQL (prosa del CONTEXT.md → perfil contado
de una muestra REST, 24 h); qué buscar (tres frases fijas → chips desde los
campos de la incidencia, el perfil, los filtros favoritos y las últimas JQL);
índice y árbol de Confluence (fases 2-3 del modelo → lista paginada con
`expand=ancestors`, exacta); muestra de Jira del contexto (el modelo la pedía y
contaba a ojo → REST + conteo local; el modelo escribe la prosa); precarga
(sólo por clic: «Preguntar sobre estos»). Lo que NO se automatiza: la prosa del
contexto, el juicio del análisis, decidir si merece llevar a alguien, traducir
la pregunta a JQL.

- **Cimiento REST** (una sola implementación para las tres áreas):
  `src/shared/rest-get.js` (`getJson`/`sameOrigin` extraídos tal cual de
  `confluence-rest.js`, con `errorBody` opcional para leer `errorMessages` de
  un 400; `confluence-rest.test.js` sigue en verde sin tocarse);
  `jiraContextPath(pathname)` en `site.js` (UNA función; el content script la
  deduce de la pestaña en cada petición; se persiste en `sites[host]` sólo
  como `jiraPrefix` observado por `refreshTab`); `src/shared/jira-rest.js`
  (transporte `searchIssues(fetchFn, site, jql, opts)` con las DOS
  degradaciones —400 con `lastViewed` → sin él; 404 con prefijo → sin prefijo—,
  `parseSearchIssues` con claves blancas de la unión de campos, un solo
  `JIRA_REST_LIMITS`, `cleanJql`/`JQL_LIMITS` viviendo aquí y re-exportados por
  `planner.js`, `jqlQuote`, plantillas fijas `historyJql/mineJql/projectJql/
  relatedJql/sampleQuery`, `profileFromSample`, `suggestedQueries`, filtros
  favoritos, `remoteLinksPath/parseRemoteLinks/fetchRemoteLinks`, y **rechazo
  de `site.cloud`** en un solo sitio); `confluence-rest.js` ampliado
  (`searchContent`, `viewedCql/mineCql/idsCql`, `fetchSpacePages/
  parseSpacePages`). Mensajes: `JQL_SEARCH {jql, limit, fields?}` (la JQL
  viaja en texto, pero SÓLO la del `input` de la llamada real a `jira_search`,
  la de un chip con valores escapados o la de un filtro del propio sitio:
  esto amplía §8.12 y se escribe), `RECENT_ISSUES`/`RECENT_PAGES {kind, …}`,
  `SPACE_PAGES`, `FAVOURITE_FILTERS`, `PAGE_LINKS`, y `PAGE_DIGEST
  {fieldsOnly: true}`. Banco: `harness/issues.json` + mini-evaluador de JQL con
  lista blanca (unión de cláusulas de las tres áreas; 400 fuera de ella), rutas
  `/rest/api/2/search`, `/filter/favourite`, `/issue/KEY/remotelink`,
  `content?spaceKey` paginado, CQL fijas, banderas `?fail=401`/`?lastViewed=400`.
- **Búsqueda en Jira con la lista dentro**: tras `navCard(jqlPlan(busqueda))`,
  `attachJqlResults` ejecuta la MISMA JQL que `jqlDestination` ya lee de la
  llamada real y pinta las filas («10 de 37, leídos ahora mismo de Jira»);
  cada fila se funde en el índice y pasa por `validatePlan` → `NAVIGATE_DIRECT`
  (no `issuePlan` sin índice: §8.3). Fallo → aviso bajo la tarjeta; la tarjeta
  de hoy nunca desaparece.
- **Chips deterministas** en el estado vacío de Jira (dentro del tope del
  rediseño): «Misma épica KEY» (sólo con la CLAVE de la épica leída del `href`,
  `jiraIssueFields` gana `epicKey`), «Mismo componente», «Enlazadas a KEY»,
  «Mis abiertas de KEY», dos estados del perfil, filtros favoritos (JQL del
  propio usuario, sin ejecutar los que lleven funciones de complementos hasta
  pulsar), «Última: …» (`recentJql` normalizado al leer). Un chip → «Búsqueda
  directa» sin modelo; no está en la sesión de opencode y la nota lo dice.
  Nada de heurística lenguaje natural → JQL ni precarga automática.
- **«Preguntar sobre estos»**: la única precarga, por clic sobre resultados
  que el usuario ve, en el `system` del siguiente turno (por mensaje, §7),
  delimitada con `SEARCH_OPEN/CLOSE` y la regla detrás; `sourcesFromSystem` y
  `pageUrlFromSystem` cortan también en `SEARCH_OPEN`/`PROFILE_OPEN`.
- **Contexto por REST** (una implementación; la mayor ganancia de tokens y
  minutos del producto): `restIndexFor(scope)` antes de `buildContext`; en
  Confluence, `fetchSpacePages` paginado desde el panel con tope
  `INDEX_LIMITS.maxPages` (300, un solo tope) y `restMaxRequests` 12; en Jira,
  muestra `project = KEY ORDER BY updated DESC` (≤120) + `profileFromSample`
  (tipos, estados con categoría, componentes, etiquetas, prefijos de resumen;
  sin personas) guardado en `faro:profile:<host>` con TTL 24 h; el modelo sólo
  escribe la prosa con el perfil delimitado (`PROFILE_OPEN/CLOSE`) delante y
  «no recorras el árbol con la herramienta»; las fases 2 y 3 quedan como
  respaldo probado. El perfil entra también en Búsqueda de Jira.
- **Interruptor maestro `restTools`** para TODA lectura REST nueva (chips,
  lista, perfil, índice, actividad); `fetchAncestors`/`searchPages` de hoy no
  cambian (pinado). Tregua por host y sesión para el aviso «tu sesión no vale
  para la API» (como los 60 s de `learnAncestry`).
- **Herramientas de desarrollo**: `tools/check-docs.mjs` como paso 5 de `npm
  run check` (número de pruebas estricto en README y CLAUDE.md; títulos de
  registro, constantes `MSG` con su `case`/manejador y en §5, ficheros de `src/`
  en §3: aviso hasta sembrar, estricto después); `tools/last-turn.mjs` (`npm
  run turn`: copia `opencode.db` al scratch, `node:sqlite` en sólo lectura,
  vuelca el último turno real de una sesión «Faro · …»); `tools/bench.mjs`
  (`npm run bench`, fuera de `check`, sin umbrales); `test/contrast.js` +
  `tools/contrast-report.mjs` (`npm run contrast`).

Descartado: heurística NL→JQL y precarga automática (retrasa la pregunta y
mete un falso positivo como «información»); `vocabFromContextMd` (prosa del
modelo → literal JQL en una URL); popover fuera de `screen-*`; caché de
resultados de JQL; `/jql/autocompletedata` (el 400 ya dice qué falla; Faro no
tiene editor de JQL) y `/project/KEY/statuses` (la muestra da los estados que
se usan) quedan anotados; ejecutar JQL en Cloud; JQL escrita en la PROSA del
modelo; rastrear el Confluence enlazado desde Jira; cabeceras «Pasó de verdad»
con incidentes que no pasaron.

### 3.4 Rediseño visual: la marca de la página como único acento, menos piezas

Los paquetes de Descargas (Apple, Raycast) son sistemas de **marketing**
extraídos de webs (tipografía de 17-64 px, tiles, canvas negro, azul #0066cc
que choca con el #0C66E4 de Atlassian, Inter desde Google Fonts). De ellos se
toman **principios**, no valores: de Apple «un solo color de acción,
superficies planas, hairlines, sin sombras en el chrome»; de Raycast «bordes
rgba de 1 px en oscuro, filas tipo command-palette con foco visible, tintes al
12-15 % para estados». Se conserva la identidad de Faro (neutros con sesgo
violeta, el ámbar del faro) porque el usuario ya la reconoce y el fallo del
primario se corrige desdoblando roles, no cambiando de color.

- **Tokens** en `panel.css`: un `:root` claro (`color-scheme: light`), el
  oscuro por `@media (prefers-color-scheme: dark)` guardado con
  `:not([data-theme="light"])` y repetido en `:root[data-theme="dark"]`
  (idénticos, pinado); la extensión sigue al sistema y `data-theme` existe sólo
  para el espejo. El dorado se desdobla: `--mark` #E9AC4A en ambos temas (= el
  `--faro-gold` del overlay, pinado) para rellenos —primario, `.send`,
  pastilla `[n]`, `.note-num`, `.badge`, faro— con `--on-mark` #1B1405 (9,11:1);
  `--gold` como acento de TEXTO (#7A4F08 claro 7,12 / #E9AC4A oscuro 8,60).
  `--hairline` (decorativa, exenta y documentada) y `--hairline-strong` ≥3:1
  para bordes de controles. Seis tamaños de texto (10/11/12/13,5/15/18),
  espaciado en múltiplos de 4 (`--s1..--s6`), radios 6/8/12/pill, dos
  duraciones; sin sombras salvo `.busy-card`; sin `transform` en hover;
  pesos 400/600/700; fuente del sistema (Segoe UI Variable → Segoe UI);
  `tabular-nums` donde hay números. Los alias `--line/--line-2/--teal/--clay`
  se conservan para no reescribir selectores. Se conservan `--gold`, `--ink`,
  `--ground`, `body{background:var(--ground)}`, `prefers-color-scheme: dark`,
  `.hidden`, todas las clases estructurales e ids de §10.
- **Composición**: cabecera de cinco piezas (faro = `#status-dot` con estados
  `ok/busy/bad` y `title`; chip de ubicación flexible con `.loc-key` «SIMPL-1234»
  + `.loc-title` título de la pestaña limpio por `cleanTabTitle`/`locationParts`
  en `site.js`, extraídas de `prompts.js` byte a byte; cuatro `icon-btn` más
  `#btn-today`); el texto de estado sigue **visible**: mientras dura un turno o
  un recorrido se escribe en `.loc-title` (§8.14: un tooltip no es visible),
  `#status-text` queda `sr-only`. Redactor sin la pastilla «Memoria» (su
  estado va a `#btn-memory.on`; el control sigue en la pantalla Memoria);
  Skill y modelo como pastillas-select nativas (`appearance: none`), la Skill no
  cede. Cada pantalla con `.screen-head` pegajosa (h1 + el botón de cierre
  EXISTENTE movido como `icon-btn back`; «Ahora no» se queda como botón con
  texto porque es una decisión). Pastilla `[n]` con UNA forma en el chat, la
  tarjeta y la página. Tarjeta de análisis como lista con separadores, `.note-kind`
  (dato · supuesto · hueco · contradicción · riesgo, que `validateNotes` ya
  devuelve y `notesCard` tira) y «Copiar observaciones» (la prosa numerada al
  portapapeles; sólo en la tarjeta viva mientras la pasada que trocea no se
  persista). Herramientas plegadas en `<details>` al terminar el turno.
  Sugerencias del estado vacío por producto Y Skill (`suggestions.js`, puro).
  Tope del estado vacío: ≤3 filas de «hoy» + 3 sugerencias + chips ≤4 en una
  línea; `faroPreview.check()` lo mide.
- **Verificación**: `test/unit/panel-css.test.js` calcula el contraste de cada
  pareja declarada (≥4,5 texto, ≥3 controles), exige los mismos nombres y
  valores en los bloques oscuros, `--mark === --faro-gold`, `color-scheme`
  explícito, la escala de px, sin `box-shadow` fuera de `.busy-card`; el
  espejo `harness/panel-preview.html` fuerza tema por `data-theme` (deja de
  copiar la paleta), anchuras 320/360/420, estados del faro, una segunda
  conversación de Jira con ocho observaciones, y `window.faroPreview.check()`
  (`overflowX`, alto de cabecera ≤48, fila del redactor ≤36, cabeceras de
  pantalla visibles); capturas 2×2 antes de dar el cambio por hecho.

Descartado: generador de CSS desde tokens (repo «sin build»; un informe y un
test de igualdad bastan); unificar los neutros del overlay con los del panel
(el overlay sigue a la PÁGINA); tinta como color de acción; mover Memoria y
Registro dentro de Ajustes; «Volver» sin id además de «Listo»; Inter
empaquetada o remota; escalas y colores de Apple/Raycast; ajuste de tema;
desplegable propio para 43 modelos; optgroup «Recientes» (funcionalidad con
persistencia, PR aparte); colorear por `kind`; `tokens.json` importado por el
banco; directorio `design/`.

### 3.5 Eficiencia y velocidad: medir primero

- **Medir** (`src/shared/timing.js`): «Arranque del panel» por fases,
  «Respuesta recibida» con duración, primer texto, KB de herramientas y chars
  del `system`, `ms` numérico en `PAGE_DIGEST`/`ANNOTATE`, filas «tiempos» y
  «almacenamiento» (`getBytesInUse`) en el Registro, `tools/bench.mjs`. Los
  tokens y el coste reales del turno vienen en `message.updated`
  (`info.tokens`, `info.cost`): se capturan en `TurnTracker` y sustituyen
  cualquier estimación. Hecho en H3, con una corrección de procedencia: la
  forma se confirmó contra `opencode.db` de esta máquina (3 598 mensajes de
  asistente), **no** contra el esquema del binario como decía esta línea, y se
  suma POR MENSAJE del asistente porque `message.updated` del mismo mensaje
  llega muchas veces (CLAUDE.md §7). `cost` es 0 en los 4 605 mensajes de esta
  base: «sin dato» es `null`, no 0.
- **Arranque**: `getSiteBundle(host)` (una lectura multi-clave que incluye las
  claves nuevas del plan: perfil, referencias, historial, actividad),
  `Promise.all([models(), getSessionId()])`, y el MCP en segundo plano
  (`state.mcpCheck`) sólo si el sitio ya estaba configurado; `send()` captura
  la promesa y `warnAboutSources` recibe su valor resuelto (`mcpAlPedir` sigue
  pinado). Condicionado a medir `GET /mcp` en frío en el opencode del usuario.
- **Ajustes** rearranca sólo si cambió servidor o contraseña; el SW empuja
  `MSG.SETTINGS` a la pestaña activa al cambiar `faro:settings`
  (`chrome.storage.onChanged`, ampliando el mock del test del SW).
- **Restauración**: `listMessages(id, RESTORE_LIMITS.messages = 60)` +
  `sortMessages` por `info.time.created` (H3 midió el orden en integración:
  `?limit=N` devuelve los últimos N en orden ASCENDENTE, igual que sin `limit`,
  así que `sortMessages` queda como red y no como parche; `sortMessages` y
  `dropOrphans` ya están escritos y probados, sin uso) + `dropOrphans` + fila «Conversación
  larga… Ver toda la conversación» (la contraparte visible, y el camino de
  vuelta a una tarjeta atenuada anterior al corte).
- **Turno**: `paintTurnSoon` (un rAF, final síncrono), `TurnTracker` no
  notifica por `reasoning`, `offerNotes` antes del índice en Análisis, UNA
  `saveIndex` por turno, «pensando… 45 s sin señales del modelo» a mitad del
  vigilante, aviso «Conversación pesada» una vez por sesión (umbral 200 000
  chars ≈ 50 k tokens, por encima de los 40 k que opencode protege; el texto
  dice que opencode ya poda).
- **Content script**: overlay con rAF coalescido y `_syncNodes` (adiós al
  parpadeo), `applyNotes` con `scope` único, `stickyOffset` memorizado 400 ms,
  `paintLog` incremental.
- **«YA LEÍDAS EN ESTA CONVERSACIÓN»** (sólo Análisis con páginas base): lista
  únicamente páginas cuya parte `tool` NO lleve `state.time.compacted`, y dice
  «si su texto sigue en tu historial no la releas; si ya no está, léela».
  Experimento: entra sólo si el contador de herramientas de H3 demuestra que
  el modelo relee.

Descartado: caché de modelos (60 ms medidos); `Promise.allSettled` con `health`
dentro y el SSE antes de `health`; digest recortado en seguimientos (rompe
`validateNotes` por posición y tensa §8.9); `trimContextByRelevance` (el
`system` pasaría a depender de la pregunta); páginas base embebidas por REST
(§8.15, §12); `summarize` (se corrige el cuerpo, sin uso); paginar el chat;
`chrome.alarms`; tocar `DIGEST_LIMITS`/`CONTEXT_BUDGET`; optimizar módulos
puros (H3 los midió con `npm run bench`: ninguno pasa de 5 ms ni en sus peores
casos fabricados —400 bloques, índice de 2 000 páginas—, así que el tiempo está
en la red y en el DOM, no aquí).

---

## 4. Hitos, en orden

Cada hito: rama propia, commits por paso, `npm run check` en verde en cada
uno, selfcheck del banco con el Browser pane visible a 1280×900 cuando toca
DOM, docs (§3/§4/§5/§6/§7/§9/§10/§12 + README + INSTALL, comprobadas por
`check-docs`) y **revisión adversaria con hallazgos aplicados antes del
siguiente hito** (como en §4.4 y §4.8). Esfuerzo: S ≤ medio día · M 1-2 días ·
L 3-5 días.

| Hito | Contenido | Depende de | Esf. |
|---|---|---|---|
| **H0 Preparación** | Fusionar la PR #5. **PASO 0 manual** (Marco, en su Jira y su Confluence DC con la sesión del navegador): las seis URL de la sección 7. Fijar en §8 la numeración 19/20 y en §12 el bloque «Jira Cloud: sin REST». Sólo docs. | — | S |
| **H1 Herramientas de desarrollo y deriva docs↔código** | `tools/check-docs.mjs` paso 5 (número de pruebas estricto; títulos/MSG/ficheros en aviso → estricto tras sembrar los ~35 títulos); `AGENTS.md` como puntero; `NAV_TIMING` importado; exportaciones muertas fuera + `dead-exports.test.js`; correcciones de §10 y numeración 21/36 del banco + `docs.test.js`; `tools/last-turn.mjs` (`npm run turn`); **`prompt-snapshots.test.js`** con las instantáneas de los ~12 escenarios actuales (antes de tocar ningún prompt); tests de las puras sin test (D6). | H0 | M |
| **H2 Seguridad, concurrencia y bugs** | Todo 2.1, 2.2, 2.3, 2.4 (R1-R3) y de 2.5 A1, A2, A3, A7, y D7. Orden: S1-S7 → C1-C7 → M1-M9 → R1-R3 → A1/A2/A3/A7 → D7. Cada arreglo empieza por el test que falla (para los puros, los scripts de reproducción de esta auditoría son el punto de partida; para M1, M2 y A1 el selfcheck). Selfcheck nuevos: digest sin depender del scroll interno, Escape vuelve a la página, foco/inert. **Hecho el 2026-09-14, con su revisión adversaria aplicada encima** (7 lentes, 19 hallazgos, todos verificados y aplicados: ver CLAUDE.md §12); las filas de 2.1-2.5 llevan anotado lo que cerró la revisión. | H1 | L |
| **H3 Medir** | E paso 1: `timing.js`, «Arranque del panel», «Respuesta recibida» con tokens reales, `ms` en PAGE_DIGEST/ANNOTATE, filas de tiempos, `bench.mjs`, `summarize` corregido, `listMessages(id, 2)` y `time.compacted` en `test:integration`. **Hecho el 2026-09-19** (rama `plan/h3-medir`, 852 pruebas tras una revisión adversaria de 12 hallazgos, todos aplicados —reloj monótono, fase «pintar», `ms` de marcar sin esperas ni animación, `toolOutputSize` con las fallidas, tiempos por sitio, `formatBytes`—, integración 18/18; el detalle, los desvíos y los límites en CLAUDE.md §12, bloques «H3 hecho» y «Revisión adversaria de H3»): cerró tres «sin verificar» del anexo E (`?limit=N` es ASCENDENTE, `summarize` da 200, `time.compacted` no se ve sin herramientas) y descubrió que el nivel gratuito de opencode ya no vale desde `opencode serve`. **Queda por LEER en el opencode de Marco**, que es lo que estas medidas venían a habilitar: «Arranque del panel · MCP N ms» en frío y en caliente (decide H6-P5) y «Respuesta recibida · N herramientas» en un Análisis con páginas base y su seguimiento (decide H12). | H1 | S |
| **H4 Rediseño, base** | D pasos 1-3: `test/contrast.js` + `contrast-report.mjs` + `npm run contrast`; bloque de tokens (claro/oscuro/`[data-theme]`, `--mark`), hover del overlay a #1B1405, `panel-css.test.js`; reescritura de componentes sobre la escala (incluye A4, A5, A8, A9, `.perm-card`, `button.ghost.on`, `html.faro-still`). Selfcheck 1-38 igual. **Hecho el 2026-09-19** (rama `plan/h4-rediseno-base`, 879 pruebas: 13 de `contrast.test.js`, 13 de `panel-css.test.js` y 1 más en `panel-wiring`; `npm run contrast` con las cuatro tablas en verde; el detalle, las desviaciones medidas y las catorce ideas descartadas del anexo D en CLAUDE.md §12, bloque «H4 hecho»). **Revisión adversaria el 2026-09-19**: dos cazadores en Opus, 8 hallazgos (5 medios, 3 bajos), todos verificados por mutación y por medida y todos aplicados, **884 pruebas** (15 de `contrast.test.js`, 16 de `panel-css.test.js`); lo gordo: el marcador de una lista ordenada pintado con un token de borde (3,04 → 5,32 con `--muted`), `EXCEPCIONES` inerte (se comprobaba contra propiedades donde sus valores no aparecen) → medidas de pieza y duraciones con motivo en las dos direcciones, el apagado de «Reducir animaciones» comprobado bloque a bloque, `.choice` (un `role="button"`) con `--hairline` como único borde (1,30 → 3,48), `--hairline-strong` sobre `--surface-2` en 2,8833 sin que nadie lo midiera → `#8E8C98` a `#8A8894` (3,48 / 3,20 / 3,04; en oscuro `#6C6A78` se queda: 3,26 / 3,52 / 3,01) y las parejas unificadas en `test/contrast-pairs.js` con 7 más que nadie declaraba. El detalle, en CLAUDE.md §12 («Revisión adversaria de H4»). Nada del banco cambió (selfcheck 1-40 corrido tras H4: 69/69), pero el botón «Claro» del espejo dejó de funcionar (lo arregla el paso 7, en H5): mientras tanto el tema claro se mira emulando `prefers-color-scheme`. **Queda por VER en Chrome**: el efecto de `color-scheme` en los `<button>`/`<select>` nativos, el primario ámbar grande de la pantalla de claves en claro, el `#8A8894` en pantalla, el borde de las tres `.choice` con su foco sólo en el anillo y el marcador de las listas ordenadas en `--muted`. | H2 | L |
| **H5 Rediseño, composición** | D pasos 4-8 + E `paintTurnSoon` en el MISMO commit que el `<details>` de `paintTurn`: cabecera (faro, chip clave+título con el estado visible durante el turno, hueco para `#btn-today`), `.screen-head`, redactor sin pastilla Memoria, `notesCard` con `.note-kind` + «Copiar observaciones», `suggestions.js`, espejo con `data-theme`/anchuras/`faroPreview.check()`, capturas 2×2, anchura mínima real anotada. Decide aquí el tope del estado vacío y el hueco del estado textual. **Hecho el 2026-09-19** (rama `plan/h5-rediseno-composicion`, pasos 4-8; tres constructores en paralelo sobre el mismo árbol —composición · tarjeta/vacío/turno · espejo— y un cierre de documentación; **904 pruebas** (+20: 4 en `site.test.js`, 7 del nuevo `suggestions.test.js` y 9 en `panel-wiring.test.js`, que pasa de 48 a 57); `npm run check` en verde con el paso «docs» a 0 errores y 0 avisos, `npm run contrast` en verde, las 33 instantáneas de prompts intactas y los pines de `offerNotes`/`send`/`restoreConversation` sin tocar). Las dos decisiones que el plan dejaba abiertas quedan resueltas: el **tope del estado vacío** son 3 sugerencias (`SUGGESTION_COUNT`), con el hueco de «Qué mirar hoy» (H8) entre la explicación y las sugerencias y el de los chips (H11) debajo, los dos creados vacíos y ocultos para que el presupuesto se pueda MEDIR en el espejo antes de que exista quien los llene; y el **hueco del estado textual** es el del título del chip, gobernado por `state.statusLine` (sólo `busy`), así que «pensando…» y «paso 2/5» se siguen viendo y al acabar vuelve el título de la pestaña. El detalle, los desvíos y lo que queda sin ver en Chrome, en CLAUDE.md §12, bloque «H5 hecho». **El paso 8 se hizo sobre el ESPEJO** (orquestador, 2026-09-19, Browser pane a 1280×900): `faroPreview.check()` en verde en las 12 combinaciones de anchura (320/420) × tema (claro/oscuro) × conversación (Confluence/Jira/chat vacío) y en las nueve pantallas; de ahí salieron los dos únicos fallos que sólo se ven en un navegador —el espejo no arrancaba sobre el `about:blank` del iframe y la clave del chip se cortaba en seco a 320 px con el quinto botón—. **Quedan la anchura mínima real del panel lateral** (arrastrando el borde) **y mirar la extensión recargada en Chrome**, que no se pueden hacer sobre el espejo. | H4 | L |
| **H6 Eficiencia sin REST** | E pasos 2-8 y 10 (menos lo ya hecho en H5): `getSiteBundle` (con las claves nuevas previstas), `Promise.all`, `state.mcpCheck` si H3 lo justifica, Ajustes sin rearranque + `storage.onChanged`, ventana de 60 + `sortMessages` + «Ver toda la conversación», `persistIndex()`, «Conversación pesada», overlay `_syncNodes` (selfcheck «40 scrolls»), `applyNotes` con `scope` único + `stickyOffset` (fixture `page:largo`), `paintLog` incremental. P1-P8.  **Hecho el 2026-09-19** (rama `plan/h6-eficiencia`; cuatro constructores en paralelo sobre el mismo árbol —arranque/Ajustes · restauración/peso · turno/registro · overlay/marcar— y un cierre de documentación; **943 pruebas** (+39: el nuevo `storage.test.js` con 11, y +8 en `panel-wiring.test.js`, que pasa de 57 a 65, +4 en `overlay-wiring`, +3 en `settings`, +3 en `client`, +3 en `runner-wiring`, +2 en `service-worker`, +2 en `index-store`, +2 en `digest` y +1 en `turn`); `npm run check` en verde con el paso «docs» a 0 errores y 0 avisos, `npm run contrast` en verde y las 33 instantáneas de prompts intactas: H6 no toca ningún prompt. Cada arreglo se vio FALLAR antes y cada pin nuevo se demostró por mutación (24 + 33 + 31 + 19 mutaciones, ninguna sobrevive; los scripts, fuera del repo). El detalle, los desvíos y los límites asumidos, en CLAUDE.md §12, bloque «H6 hecho»). **P5 no se hizo, a propósito**: la comprobación del MCP en segundo plano (`state.mcpCheck`) está condicionada en el plan a leer «Arranque del panel · MCP N ms» en frío en el opencode de Marco, y esa lectura sigue sin hacerse; el MCP se sigue esperando en el camino crítico. Es lo primero que hay que decidir cuando ese número exista: si baja de ~1 s, el anexo E dice que P5 sobra y H6 se queda con lo que hay. **Dos desvíos del anexo E, anotados**: el botón «Ver toda la conversación» NO va en panel.html (la fila vive dentro del chat, que se vacía en cada restauración, así que declararla también en el HTML daría dos elementos con el mismo id), y lo restaurado no se deja quieto con una clase en el chat (`.chat.restoring` se pondría y se quitaría sin un solo `await` en medio: el navegador nunca calcularía estilos con ella) sino por mensaje, con `markIfRestored` y `.msg.restored`. **Queda por VER en Chrome y en el opencode de Marco**: las cinco fases nuevas del arranque y que «modelos y almacenamiento» baje respecto a la suma de las dos de H3 (es la medida que justifica P4); que cerrar Ajustes a mitad de respuesta ya no corte el turno; que `chrome.storage.onChanged` despierte al worker y el `MSG.SETTINGS` llegue a un content script registrado dinámicamente; una sesión de más de 60 mensajes con su fila y su botón; el aviso de «Conversación pesada» al cruzar el umbral; un solo «Índice guardado» por turno; y que las marcas no parpadeen en la vista de incidencia del Jira DC, que es el caso que motivó P1 y el único que el banco no reproduce del todo. El banco pasa de 70 a 75 `ok(` (tramos 41-43 y la fixture `page:largo`; son 74 resultados, porque dos `ok(` son las dos ramas de un mismo `if`) y **el orquestador lo corrió al cerrar H6, el 2026-09-19: 74/74** con el Browser pane a la vista, 73/74 con el pane oculto (falla la 27: `requestAnimationFrame` no se ejecuta con la página oculta). **Revisión adversaria el 2026-09-19**: tres cazadores en Opus, sólo lectura, 12 hallazgos (6 medios, 6 bajos), todos verificados y todos aplicados, **953 pruebas** (+6 en `panel-wiring.test.js`, que pasa de 65 a 71, y el nuevo `log.test.js` con 4); lo gordo: dos botones del chat que nacían muertos durante el turno («Sesión nueva» del aviso de pesada y «Ver toda la conversación», que además podía pintar una sesión ya cerrada), el índice cosechado con el sitio VIVO y no con el que preguntó —`offerNotes` puede durar un turno entero del modelo— (título nuevo «Índice sin ampliar»), la escritura tardía del índice pisando ENTERO un `generateContext` del mismo host (cerrado por los dos lados), «Omitir» escribiendo `onboarded` sin apagar el arranque que decidía esa pantalla, `loadLinkedContext` con tres lecturas encadenadas que desmentían el «un solo await» de P4, la vista saltando al fondo justo al pedir lo anterior, y el Registro con «sólo problemas» enseñando a partir de las 400 entradas filas que `paintLog()` ya no pintaría. Con ella el banco gana dos `ok(` más (tramos 41 y 43, 77 → **76 resultados**) que el orquestador corrió después con el Browser pane a la vista: **76/76**. El detalle, en CLAUDE.md §12 («Revisión adversaria de H6»). | H3, H5 | L |
| **H7 Cimiento REST** | `rest-get.js`; `jiraContextPath` en `site.js` (+ regex de `/browse/`/`/projects/` con UN segmento de prefijo, `site.test.js` SEGURIDAD en el mismo commit); `jira-rest.js` unificado; `confluence-rest.js` ampliado; `web_accessible_resources` con `src/atlassian` y `src/nav` (ya con `use_dynamic_url` de H2) + test de imports transitivos; `harness/issues.json` + API falsa unificada; mensajes `JQL_SEARCH`, `RECENT_ISSUES`, `RECENT_PAGES`, `SPACE_PAGES`, `FAVOURITE_FILTERS`, `PAGE_LINKS`, `fieldsOnly`; `restTools` maestro; selfcheck de transporte. Sin UI. **Sólo si el PASO 0 devolvió JSON en Jira**; si no, sólo la parte de Confluence. **Hecho el 2026-09-20** (rama `plan/h7-cimiento-rest`; dos constructores en paralelo sobre el mismo árbol —las puras del cimiento · los mensajes y el banco— y un cierre de documentación; **1040 pruebas** (+87: los nuevos `rest-get.test.js` 12, `jira-rest.test.js` 35 y `serve-harness.test.js` 16, más +13 en `confluence-rest.test.js`, +4 en `site.test.js`, +4 en `check-docs.test.js`, +2 en `settings.test.js` y +1 en `dead-exports.test.js`); `npm run check` en verde con el paso «docs» a 0 errores, 0 avisos y 1 nota; las 33 instantáneas de prompts intactas —H7 no toca ningún prompt— y ningún título de registro nuevo. Cada garantía nueva se demostró por mutación sobre una copia del árbol (31 + 28, ninguna sobrevive; los scripts, fuera del repo). El detalle, los desvíos y lo que queda sin verificar, en CLAUDE.md §4.9 y §12, bloque «H7 hecho»). **Desvíos anotados**: `PAGE_LINKS` NO se hace aquí (viene con su módulo en H10); `searchContent` comprueba que el CQL casa con una plantilla ANTES de pedir nada (más fuerte que «sólo con CQL de plantilla»); `fetchSpacePages` pagina POR DENTRO en vez de una página por llamada, y nunca sigue `_links.next` como ruta, sólo como señal; la degradación de `lastViewed` quita también el campo de `fields`, no sólo el `ORDER BY`; el rechazo de Cloud se aplica también a filtros y enlaces remotos; `planner.js` reexporta `JQL_LIMITS` pero no `cleanJql`; y la ruta de contexto no admite puntos, más estricto que el prefijo del wiki. **Visto por el orquestador el 2026-09-20**: los tramos 44-49 del banco en el Browser pane, **13/13** (ejecutando sólo ese trozo), y los tramos 1-40, 69/69; la corrida ENTERA 1-49 (89 resultados) se paró en el 41 porque la ventana no producía frames y queda por hacer con la ventana delante. **Revisión adversaria** (2026-09-20): 7 hallazgos (1 medio, 6 bajos), todos aplicados; 1046 pruebas (`bootstrap-wiring.test.js` nuevo: el content script no tenía ninguna). **Queda por VER**: la extensión recargada en Chrome. | H2, H6 | L |
| **H8 Búsqueda en Jira sin tokens** | C pasos 6-8: lista en la tarjeta (`attachJqlResults`, filas → índice → `validatePlan`), `epicKey` + `readIssueFieldsQuick`, chips deterministas dentro del tope de H5, `recentJql` normalizado, filtros favoritos, casilla `#set-rest-tools`, tregua del aviso. Verificar en el Jira real: la tarjeta pinta la lista o el aviso y una fila abre `/browse/KEY`. | H7 | M |
| **H9 Contexto por REST** | C pasos 9-11 ≡ E 12-14, una implementación: `fetchSpacePages` paginado, muestra + `profileFromSample` + `faro:profile:<host>`, `restIndexFor` en `generateContext`, `buildContext` salta fases 2/3 con `restIndex` (respaldo probado), `profileBlock` en Búsqueda e indexador, `treeTitles`, frase de referencias con id en el indexador de Confluence. Verificar en el Confluence real: «Índice leído de la API», «Paso a paso» sin `learnAncestry`, y cuánto tarda «Generar contexto» antes y después. | H7 | L |
| **H10 Páginas base sugeridas** | B pasos 1-7 y 9 (sin el 8): gancho único `recordAnalysisTurn` en `send()` (compartido con H11), `source-history.js`, `references.js` (parser de prosa), `source-suggest.js`, sección «Sugeridas» sin red (con `readIssueFieldsQuick` de H8), `page-links.js` + `PAGE_LINKS`, remotelink por `jira-rest.js`, fixture `issue:ENG-7` con enlaces (incluido uno en la interfaz que NO debe salir), selfchecks de enlaces y puntuación. Verificar en el Jira real: «Enlaces de la página · N leídos · M a Confluence · remotos: N|status». | H7, H5 | L |
| **H11 Qué mirar hoy** | A pasos 2-3 primero (diario, `pageIdFromDom`, `tabs.onUpdated` en el SW, mock del SW ampliado) para empezar a apuntar cuanto antes; después 7-10: `today.js`, `loadToday` (vía `tab` por mensajes; vía `linked` sólo Confluence desde Jira), bloque en el estado vacío y `screen-today` dentro de la composición de H5, `pendingIntent`, `dismissed`, `todaySuggestions` subordinado a `restTools`, banco con ranking determinista y degradación 401 (sin navegar). | H7, H10 | L |
| **H12 Prompts opcionales** | Sólo con la prueba de instantánea de H1 en su sitio y en commits separados: «Preguntar sobre estos» (`preloaded`) y «YA LEÍDAS» (`readPages`, sólo si H3 demostró relecturas). Ambos ANTES de `sources,` en `baseSystem` (pin intacto). Leer el turno real con `npm run turn`. | H8, H3 | M |
| **H13 Cierre** | Vista única «Qué guarda Faro de mí» en Ajustes con borrado por host (`forgetSite` borra TODAS las claves nuevas: actividad, historial, referencias, perfil; pinado contra `STORAGE_KEYS`); consolidación de §12 (estado, «sin verificar» agrupado por hito, ideas descartadas de las cinco áreas sin duplicar); README/INSTALL definitivos («qué se conserva al reabrir el panel»); número de pruebas final. | todo | S |

Reglas transversales que evitan que los hitos se pisen:

- Un solo `jira-rest.js`, un solo `jiraContextPath`, un solo `getJson`
  (`rest-get.js`), un solo gancho `recordAnalysisTurn`, un solo `readIssueFieldsQuick`
  (`state.issueFields`; no `state.lastIssue`), un solo `html.faro-still`.
- Dos mensajes legítimos para Jira: `JQL_SEARCH` (JQL como parámetro, procedencia
  acotada) y `RECENT_ISSUES` (por `kind`). La muestra del contexto va por
  `JQL_SEARCH {jql: sampleQuery(projectKey)}`.
- Toda UI nueva nace sobre los tokens de H4 y con su variante en el espejo a
  320 px, claro y oscuro; el rediseño es dueño de la cabecera y del estado vacío.
- Los pines de `send()` se escriben como orden relativo (`indexOf`), no como
  adyacencia: `warnAboutSources` → `recordAnalysisTurn` → `offerNotes` (sólo
  Análisis) → `growIndex`.
- Lo que viene de storage se reconstruye con claves blancas al leer (también
  `recentJql`, `todaySeenAt`, `todayOff`, `jiraPrefix`), como pide §9.
- Selfcheck: numerar por orden de entrega (39 en adelante), sin navegar donde
  se pueda, ms sin umbral.
- Cabeceras de módulo: si el incidente no consta en §7/§12, «plausible, no
  observado», nunca «Pasó de verdad».

---

## 5. Decisiones que cambian o se añaden en CLAUDE.md

- **§8.12 ampliada**: la API se lee, nunca se escribe, y ahora con tres tipos de
  GET y en los dos productos: antepasados y título por id; búsqueda por título
  con texto del usuario limpiado; y **consultas de plantilla fija** (recientes,
  tuyas, cambiadas, muestra del proyecto, árbol del espacio, filtros favoritos,
  enlaces remotos) y **la JQL que ya hizo el modelo por el MCP** (o la de un
  chip con valores escapados, o la de un filtro del propio sitio), ejecutada
  como parámetro codificado de una ruta que monta la extensión, sólo GET, mismo
  origen, `maxResults` acotado, campos fijos, tope de tiempo, y siempre por un
  único `getJson`. Un título del DOM NUNCA se convierte en CQL. Desde el panel
  con `credentials: 'include'` sólo al Confluence enlazado guardado por
  `siteRecords`.
- **§8.19 Lecturas REST sin tokens**: lo que la API del propio sitio da exacto y
  en milisegundos (una búsqueda JQL, el árbol de un espacio, la muestra de un
  proyecto, los enlaces de una incidencia, lo que viste y lo tuyo) no se le
  pide al modelo: el modelo escribe prosa y JQL; la extensión ejecuta, pagina,
  valida y pinta; si la API no contesta, el camino de siempre sigue entero. En
  Jira Cloud no hay REST de Jira (410): todo por el MCP.
- **§8.20 Actividad y sugerencias**: la actividad del usuario es suya y local
  (ids, claves, títulos y rutas relativas; 30 días; sólo hosts configurados;
  visible y borrable; nunca en un prompt). Sugerir es gratis y explicado:
  ninguna sugerencia llama al modelo, cada una dice de dónde sale, Faro nunca
  añade una página base ni manda una pregunta por su cuenta; ir a una
  recomendación del host propio pasa por el índice y `validatePlan`.
- **§7 matices**: la poda de opencode (`PRUNE_PROTECT` 40 000, `PRUNE_MINIMUM`
  20 000, `time.compacted`, desactivable con `compaction.prune: false`) acota
  «las salidas se reenvían cada turno»; `GET /session/:id/message?limit=N`
  devuelve los últimos N (el panel ordena); latencias medidas (`GET /mcp` en
  frío); `summarize` exige `{providerID, modelID}`; `info.tokens`/`info.cost`
  existen en `message.updated`.
- **§9**: regla de tokens («ningún color, tamaño, espaciado o radio literal
  fuera de `:root`; un color nuevo entra con su pareja y su ratio en
  `panel-css.test.js`»; «el dorado de relleno `--mark` es la marca de la página
  y sólo va donde señala una marca»); los ~35 títulos de registro sembrados y
  los nuevos de cada hito; `check-docs` vigila el número de pruebas, títulos,
  `MSG` y el mapa §3.

## 6. Ideas descartadas con motivo (para §12)

Ver las listas de cada área en la sección 3. Las transversales: cookies como
almacén (no son de la extensión, viajan al servidor); `chrome.history`
(desproporcionado); recomendar u ordenar con el modelo por defecto (tokens y
5-60 s para reordenar ocho cosas que ya llevan su porqué); heurística NL→JQL;
precarga automática en el `system`; título del DOM como CQL; `references`
dentro del índice; cuarta fase del indexador con `format`; generador de CSS;
Inter; escalas y colores de Apple/Raycast; caché de modelos; digest recortado;
recorte del contexto por relevancia; páginas base embebidas por REST; una
herramienta de opencode para subrayar (§12 ya lo descarta).

## 7. Lo que sólo se puede verificar en el Jira/Confluence DC de Marco

**PASO 0 (H0), a mano, con la sesión del navegador**, y anotar en §7 qué
contesta:

```
https://<jira>[/jira]/rest/api/2/search?jql=project%20%3D%20SIMPL&maxResults=1&fields=summary,status,lastViewed
https://<jira>[/jira]/rest/api/2/issue/<KEY>/remotelink
https://<jira>[/jira]/rest/api/2/filter/favourite
https://<confluence>/rest/api/content?spaceKey=<KEY>&type=page&expand=ancestors,space.homepage&limit=2
https://<confluence>/rest/api/content/search?cql=type%3Dpage%20AND%20id%20in%20recentlyViewedContent(5)&expand=version
```

y que una página `/display/…` lleve `<meta name="ajs-page-id">`. Preguntas:
¿JSON o login? ¿ruta de contexto `/` o `/jira`? ¿`lastViewed` en `fields`?
¿`ORDER BY lastViewed` y `updated >= -7d` aceptados? ¿`globalId
appId=…&pageId=…` y `application.type com.atlassian.confluence` en una «Wiki
Page» real? ¿`ancestors` en la LISTA? ¿tope real de `limit`? ¿`version.by`?
Sin JSON en las de Jira se aplazan H7 (parte Jira), H8, H9 (Jira), H10 (paso
del remotelink) y H11 (objetivo Jira); todo lo demás sigue.

Por hito: **H3** «Arranque del panel · MCP N ms» en frío y «Respuesta recibida
· N herramientas» en un Análisis con páginas base y su seguimiento; orden de
`limit`. **H5** anchura mínima real del panel; controles nativos con
`color-scheme`; «Copiar observaciones» pegado en un comentario del Jira DC;
`<details>` con los títulos del MCP real. **H6** cerrar Ajustes a mitad de
turno ya no corta; marcas sin parpadeo en la vista de incidencia; sesión >60
mensajes restaura en KB. **H8** cookies para `/rest/api/2/search` desde el
content script (SSO estricto → HTML de login → «la respuesta no es JSON»);
`'Epic Link' = KEY`, `sprint`, `component`, `linkedIssues` con 200. **H9**
`expand=ancestors` sobre el espacio real y su tiempo; «Generar contexto» de
minutos a segundos; que el modelo cite ids en la prosa. **H10** remotelink con
la sesión; DOM real de «Wiki Page» y de los enlaces en descripción y
comentarios. **H11** `tabs.onUpdated` en los dos hosts; `ajs-page-id`;
`issueHistory()`/`watchedIssues()`/`recentlyViewedContent()` con la cookie;
que el ranking tenga sentido tras una semana (ajustar `SIGNALS`). **H12** que
`github-copilot/gpt-5.6-luna` obedezca «YA LEÍDAS» y no vuelva a `jira_search`
con «Preguntar sobre estos» (leer el turno con `npm run turn`). Y lo heredado
de §12.

## 8. Decisiones abiertas para Marco

Las tomo así si no dices lo contrario:

1. **Identidad**: se conserva el ámbar y los neutros con sesgo violeta; el
   primario en claro pasa a `--mark` #E9AC4A (mismo color que la marca en la
   página). Alternativa: `--mark-strong` #C98A22, más sobrio. Se decide con la
   captura de la pantalla de claves.
2. **Historial de páginas base con `issueKey`**: sí (es lo que permite «la
   usaste en ESTA incidencia» y el dedupe); local, documentado, borrable.
3. **Estado vacío**: ≤3 filas de «hoy» + 3 sugerencias + chips en una línea;
   si molesta a 320 px, «hoy» se degrada a una sola línea «Qué mirar hoy (8)».
4. **Cabecera**: cinco iconos (`#btn-today` incluido) y el chip flexible; el
   estado textual se enseña en el chip mientras dura un turno.
5. **`references` estructuradas**: no en esta ronda (parser de prosa + frase
   nueva del indexador); se revisa tras reindexar en el sitio real.
6. **«Preguntar sobre estos» y «YA LEÍDAS»**: H12, condicionados a la medida de
   H3; son los únicos cambios que tocan el `system` del chat.
7. **Jira Cloud**: fuera de toda la REST de Jira (Marco está en DC);
   `POST /rest/api/3/search/jql` queda anotado.
8. **«Copiar observaciones»**: Markdown tal cual (con `[n]`); texto plano como
   alternativa si al pegar en el comentario de Jira sale sucio.
9. **Topes** (`TODAY_LIMITS`, `SUGGEST_LIMITS`, `RESTORE_LIMITS`,
   `SESSION_LIMITS`): los del anexo; se ajustan con datos reales.

## 9. Anexos

- `docs/plan/anexo-hallazgos.md` · los 48 hallazgos con escenario, evidencia,
  arreglo y test propuestos.
- `docs/plan/anexo-A-que-mirar-hoy.md` · diseño detallado de 3.1.
- `docs/plan/anexo-B-paginas-base-sugeridas.md` · diseño detallado de 3.2.
- `docs/plan/anexo-C-herramientas-sin-tokens.md` · diseño detallado de 3.3
  (incluye el inventario y las herramientas de desarrollo).
- `docs/plan/anexo-D-rediseno-visual.md` · tokens, componentes, tests y
  procedimiento de aceptación de 3.4.
- `docs/plan/anexo-E-eficiencia.md` · medidas, pasos y descartes de 3.5.
- `docs/plan/anexo-critica.md` · el crítico de completitud y el revisor de
  conformidad, que son el origen de las reglas transversales de la sección 4.

Los anexos son borradores de diseño generados y juzgados en la auditoría; sus
números de línea se refieren al código del 2026-09-09 y cambiarán. Donde un
anexo diga algo distinto de las secciones 3-5 (por ejemplo `issuePlan` sin
índice, `via: 'linked'` al Jira desde Confluence, `references` en
`INDEX_SCHEMA`, tres `jira-rest.js` distintos, `#status-text` sólo en el
tooltip), manda este documento.
