# Faro — contexto para trabajar en este repo

Este fichero es el MAPA del proyecto para una sesión nueva: qué es, cómo se arranca y se comprueba, qué hace cada fichero, qué contratos hay entre piezas, qué decisiones no se negocian y cómo se añaden cosas. Cabe en 60 KB a propósito, porque Claude Code lo inyecta entero en cada sesión y en cada subagente. Lo largo —los flujos paso a paso, el mapa con la historia de cada fichero, lo que pina cada test, la bitácora hito a hito y la referencia de cada contrato y cada decisión— vive en `docs/` desde el 2026-09-27 con la MISMA numeración de secciones que tenía aquí, así que una referencia «CLAUDE.md §4.6» escrita en README, INSTALL, PLAN2, la bitácora o un comentario del código se lee hoy en el fichero que dice esta tabla, en su §4.6:

| Sección | Aquí | Entera, byte a byte |
|---|---|---|
| §1 Qué es | entera | — |
| §2 Arrancar y comprobar | comandos y reglas | `docs/REFERENCIA.md` §2: cada herramienta con sus números medidos y la historia del banco |
| §3 Mapa de ficheros | una línea por fichero | `docs/MAPA.md` §3: qué hizo cada hito en cada fichero |
| §4 Flujos, paso a paso | qué hay en cada flujo | `docs/FLUJOS.md` §4.1-4.11 |
| §5 Mensajería | entera | — |
| §6 Contratos de datos | la forma exacta | `docs/REFERENCIA.md` §6 |
| §7 opencode 1.2.25 | los hechos | `docs/REFERENCIA.md` §7 |
| §8 Decisiones de diseño | el enunciado | `docs/REFERENCIA.md` §8 |
| §9 Convenciones | las reglas | `docs/REFERENCIA.md` §9 (la lista de títulos del registro está allí y en `docs/INSTALL.md`) |
| §10 Lo que los tests pinan | puntero | `docs/PINES.md` §10 |
| §11 Cómo añadir cosas | los pasos | `docs/REFERENCIA.md` §11 |
| §12 Estado y pendientes | tabla, límites y decisiones | `docs/BITACORA.md` §12: 12.2 sin verificar, 12.4 descartado con su motivo, 12.5 la bitácora entera |

Regla de trabajo: un hito NO lee esos ficheros enteros; lee el apartado que le toca, y a cada agente se le dice cuál. Al cambiar código se mantienen al día los tres documentos de siempre (este mapa, README y `docs/INSTALL.md`) Y el fichero de `docs/` que describe lo tocado, con la misma densidad de siempre: el paso «docs» de `npm run check` (§2) vigila lo más fácil de olvidar (el número de pruebas aquí y en README, el de cada fichero en `docs/PINES.md`, los títulos del registro, los mensajes de §5, los ficheros de §3) y `docs.test.js` cruza PINES con el código. `AGENTS.md` es un puntero corto a este fichero (≤6 líneas y sin secciones, lo pina `docs.test.js`). El estado vivo entre sesiones (qué está commiteado, qué flujo corre, qué toca ahora) está en `docs/plan/handoff/ESTADO.md`, y se lee antes que nada.

## 1. Qué es

Extensión de Chrome MV3 («Faro») que convierte un **opencode local** (servidor
headless HTTP+SSE en `127.0.0.1:4096`) en un copiloto dentro de Jira y
Confluence. Chat en panel lateral; el modelo consulta Atlassian a través del
servidor MCP `mcp-atlassian` (sólo lectura) configurado en opencode; la
extensión además **lleva al usuario hasta la respuesta** (despliega el árbol de
páginas de la izquierda y navega una vez) y **subraya en la página** el
fragmento del que habla (Custom Highlight API + overlay en Shadow DOM).

Cinco piezas: la página (Jira/Confluence) · la extensión · opencode · el LLM
(el que tenga opencode; Faro no habla con ninguna nube) · el MCP de Atlassian.

- Sin build, sin dependencias npm: módulos ES que Chrome carga tal cual. Node ≥18.
- Todo en español: comentarios, UI, logs, nombres de test, muchos identificadores
  locales. Nombres exportados en inglés.
- Verificado contra **opencode 1.2.25**. **Chrome ≥130** (`minimum_chrome_version`
  en el manifest, decidido en H14): la protección de `use_dynamic_url` (S7) —que
  ninguna web pueda comprobar si tienes Faro leyendo un módulo por una URL
  estable— sólo ACTÚA desde Chrome 130, y hasta H14 el mínimo era 116, o sea que
  entre 116 y 129 Chrome ignoraba la clave y la extensión funcionaba igual pero
  sin esa protección; Chrome 130 es de octubre de 2024 y el del usuario es el 153,
  así que el mínimo se sube y la protección deja de ser opcional. El usuario real
  usa un Jira Data Center y un Confluence **9.2** Data Center propios
  (`jira.simplprogramme.eu`, `confluence.simplprogramme.eu`, fuera de
  `*.atlassian.net`, **con la interfaz en español**: §8.23) y modelos vía
  `github-copilot/*` y `opencode/*-free`.

## 2. Arrancar y comprobar

```bash
npm run check              # sintaxis + TDZ + manifest + 1498 pruebas unitarias + docs (sólo si las unitarias pasan)
npm run check:docs         # sólo el paso docs, informe entero; sale con 1 si hay errores
npm run test:integration   # su propio opencode serve (4123) y el cliente real; GASTA turnos de pago
npm run harness            # Confluence de mentira en http://127.0.0.1:5175 (preview_start "harness")
npm run turn -- [--host h] [--n 1] [--all] [--db ruta]   # el último turno REAL desde una COPIA de opencode.db (Node ≥22.13)
npm run bench              # el metro: tamaño del system, puros, KB del índice; nunca falla, fuera de check
npm run contrast           # tabla de contraste por tema; sale con 1 si algo baja de 4,5/3 o falta un token
npm run sandbox            # H18/H19: escribe DE VERDAD en un opencode PROPIO aislado, nueve casos; fuera de check
npm run snapshots          # regenera test/fixtures/prompts/*.txt; sólo con un cambio de prompt intencionado, revisando el diff
```

- Paso «docs» (`tools/check-docs.mjs`): el número de pruebas de README y de este
  §2 es el real (`registry.length`); cada «`x.test.js` (…; N pruebas» de
  docs/PINES.md §10 es lo que registra ese fichero (`porFichero`); cada título de
  `log.(ok|info|warn|error)('Título'` de `src/` va entre «» en docs/INSTALL.md o
  aquí; cada `MSG.X` tiene RECEPTOR y está en §5; cada `.js` de `src/` está en el
  mapa §3. Todo es ERROR (`STRICT` en `{ titles: true, msgs: true, files: true }`),
  y `MSG_SIN_EMISOR_HASTA` está vacía (0 notas).
- Extensión: `chrome://extensions` → modo desarrollador → cargar `.` (id fijo
  `ickohiffpicdfeameogbihbcanbjibmk`); tras cambiar código, recargar la extensión
  y la pestaña. opencode: `opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO`
  con `OPENCODE_SERVER_PASSWORD` (la misma en Ajustes). En Windows,
  `tools/instalar.ps1` deja uv y mcp-atlassian y `tools/arrancar-opencode.ps1` lo arranca.
- Banco: `http://127.0.0.1:5175/`, botón **Autocomprobación completa** (o
  `await faroHarness.actions.selfcheck()`), con el Browser pane VISIBLE a
  1280×900: oculto no hay frames y caen la 27 y la 41. Hoy 64 tramos, 136 `ok(`,
  135 resultados. Con el pane oculto se sustituye `window.requestAnimationFrame`
  por un `setTimeout` de 16 ms, y se dice.
- Espejo del panel: `harness/panel-preview.html` (el `panel.html` real en un
  iframe; seis conversaciones, diez pantallas). `window.faroPreview.check()` a
  320/420 × claro y oscuro devuelve `{ok, motivo, overflowX, topHeight,
  composerMetaHeight, screenHeadsVisible, emptyStateRows, chipRows,
  chipsClipped, emptyFits, todayRows, todayLine}`; mandos `setTheme`,
  `setWidth`, `setStatus`, `setChat`, `setScreen`, `setPick`, `setSources`,
  `setFifth`, `setToday`, `setClaves`, `setQuitar`.
- Windows: el Bash tool trunca >8 KB y mangla `\` en heredocs: JS con
  Write/Edit, nunca con heredoc. PowerShell 5.1 no tiene `&&`.
- Prohibido: `node --test` a secas; `test:integration` y las sondas de modelo
  gastan turnos de pago (no sin permiso); el sandbox sólo contra un opencode
  aislado con el HOME entero redirigido y `GET /path` comprobado antes de
  escribir (`OPENCODE_CONFIG_DIR` no basta), nunca el del 4096.
- `turn`: copia opencode.db y abre LA COPIA en sólo lectura (la original no se
  toca); una compactación no es un turno. `bench`: sin umbrales, nunca falla.
  `contrast`: parejas de `test/contrast-pairs.js` y, de H23, la tabla TINTAS; informa, no genera.
  `sandbox`: mata el árbol y borra su directorio en un `finally`; sólo Windows.
  `snapshots`: regenerar es aceptar; `prompt-snapshots.test.js` compara byte a byte.

Detalle de cada herramienta, con sus números medidos y la historia del selfcheck: docs/REFERENCIA.md §2.

## 3. Mapa de ficheros

Qué es cada fichero, en una línea; el mapa largo (qué hizo cada hito en cada uno) está en docs/MAPA.md, y lo que cada uno pina, en docs/PINES.md.

```
manifest.json  MV3, sidePanel, use_dynamic_url (S7) (docs/MAPA.md)
src/panel/panel.js  el panel, ÚNICO que habla con opencode: estado, chat, turnos (docs/FLUJOS.md §4.1)
src/panel/panel.html  las pantallas; ids pinados por test; H23 #set-color-field en Ajustes (docs/MAPA.md)
src/panel/panel.css  sobre tokens, claro y oscuro; contraste pinado (docs/REFERENCIA.md §9)
src/panel/chat-scroll.js  stuckToBottom: ¿chat pegado al fondo? (A7) (docs/MAPA.md)
src/panel/screens.js  ESCAPE_CLOSES/ESCAPE_DISMISSES (A3) (docs/MAPA.md)
src/panel/links.js  allowedLinkOrigin: qué enlaces se abren (S5) (docs/MAPA.md)
src/panel/prompts.js  baseSystem y los bloques delimitados (docs/FLUJOS.md §4.2)
src/panel/skills.js  SKILLS y skillSystem (docs/FLUJOS.md §4.7)
src/panel/sources.js  páginas base; consultedOutside (docs/FLUJOS.md §4.4)
src/panel/suggestions.js  las tres sugerencias del chat vacío (H5) (docs/MAPA.md)
src/panel/source-history.js  historial de análisis con páginas base (H10) (docs/FLUJOS.md §4.4)
src/panel/references.js  páginas que nombra el CONTEXT.md (H10) (docs/FLUJOS.md §4.4)
src/panel/source-suggest.js  suggestSources: sugerir y explicar (H10) (docs/FLUJOS.md §4.4)
src/panel/rest-notice.js  cuándo se dice que una lectura REST falló (docs/FLUJOS.md §4.7)
src/panel/today.js  «qué mirar hoy» sin modelo (H11) (docs/FLUJOS.md §4.10)
src/panel/search-chips.js  búsquedas al instante (H8) (docs/FLUJOS.md §4.7)
src/panel/issue-profile.js  familia y fase de la incidencia; issueBlock (docs/FLUJOS.md §4.8)
src/panel/notes.js  modo Análisis: anclas y numeración (docs/FLUJOS.md §4.4)
src/panel/planner.js  de la respuesta a un plan; jqlDestination (docs/FLUJOS.md §4.3)
src/panel/indexer.js  buildContext, harvestIndex (docs/FLUJOS.md §4.6)
src/panel/setup.js  el MCP: configureMcp, quitar las claves (docs/FLUJOS.md §4.7)
src/panel/memory.js  contextos por ámbito y memoria (docs/FLUJOS.md §4.6)
src/panel/markdown.js  markdown → DOM sin innerHTML; allowHref (docs/MAPA.md)
src/background/service-worker.js  paso a paso, permisos, «visto» (docs/FLUJOS.md §4.3)
src/content/bootstrap.js  content script: switch de mensajes (docs/FLUJOS.md §4.9)
src/content/runner.js  NavRunner: executeStep, applyNotes (docs/FLUJOS.md §4.4)
src/content/anchor.js  buildTextIndex, resolveAnchor (docs/MAPA.md)
src/content/anchor-match.js  findQuote (docs/MAPA.md)
src/content/digest.js  pageDigest: la página en bloques ¶ (docs/FLUJOS.md §4.4)
src/content/jira-issue.js  la incidencia en pantalla (docs/FLUJOS.md §4.8)
src/content/page-links.js  enlaces del contenido (H10) (docs/FLUJOS.md §4.4)
src/content/locators.js  localizar un paso; isSafeToClick (docs/FLUJOS.md §4.3)
src/content/tree-dom.js  el árbol lateral; isMenuTrigger (M9) (docs/FLUJOS.md §4.3)
src/content/tree-scan.js  snapshotTree (docs/MAPA.md)
src/content/picker.js  «Señalar en la página» (docs/FLUJOS.md §4.5)
src/content/pick-payload.js  el pick; cleanPicked (docs/FLUJOS.md §4.5)
src/content/overlay/overlay.js  Shadow DOM: foco, trazo de tinta, insignias en superíndice (P1); H23 setTint (docs/MAPA.md)
src/content/overlay/rects.js  una caja por línea (docs/MAPA.md)
src/content/overlay/styles.js  CSS del overlay; H23 tinta, highlightCss, cursor en PICK_CSS (docs/MAPA.md)
src/content/overlay/cursor.js  el cursor subrayador de «Señalar», URL data: (H23) (docs/MAPA.md)
src/content/dom-utils.js  contentRoot, scroll, waitFor (docs/MAPA.md)
src/content/page-id.js  pageIdFromDom() y ni un import (docs/MAPA.md)
src/nav/schema.js  NAVIGATION_PLAN_SCHEMA, TARGET_KINDS (docs/MAPA.md)
src/nav/validate.js  validatePlan/validateAnchor (docs/REFERENCIA.md §8)
src/nav/options.js  navOptions: «Paso a paso» / «Llévame» (docs/MAPA.md)
src/shared/config.js  constantes, límites, STORAGE_KEYS; H23 HIGHLIGHT_COLORS (docs/REFERENCIA.md §6)
src/shared/scopes.js  el ámbito del contexto y del mapa (H21) (docs/FLUJOS.md §4.6)
src/shared/permissions.js  SAFE_PERMISSIONS (S1) (docs/REFERENCIA.md §7)
src/shared/mcp-config.js  la ÚNICA barrera de escritura en opencode (H18) (docs/REFERENCIA.md §8)
src/shared/messages.js  MSG y sendToTab (docs/MAPA.md)
src/shared/storage.js  getSiteBundle, forgetEverythingFor (docs/FLUJOS.md §4.11)
src/shared/activity-store.js  el diario, con su cola (H11) (docs/FLUJOS.md §4.10)
src/shared/digest.js  formatDigest, matchBlock (docs/MAPA.md)
src/shared/rest-get.js  la ÚNICA puerta REST: getJson (H7) (docs/FLUJOS.md §4.9)
src/shared/jira-rest.js  la REST de Jira (docs/FLUJOS.md §4.9)
src/shared/confluence-rest.js  la REST de Confluence (docs/FLUJOS.md §4.9)
src/shared/timing.js  cronómetro por fases (H3) (docs/MAPA.md)
src/shared/models.js  veredictos y elección de modelo (H16) (docs/REFERENCIA.md §8)
src/shared/log.js  Logger y LEVELS (docs/MAPA.md)
src/shared/format.js  prettyTool, clockTime, formatBytes (docs/MAPA.md)
src/atlassian/site.js  parseAtlassianUrl, validSpaceKey (docs/MAPA.md)
src/atlassian/activity.js  el diario de actividad (H11) (docs/FLUJOS.md §4.10)
src/atlassian/index-store.js  el índice, SÓLO rutas (docs/REFERENCIA.md §6)
src/opencode/client.js  OpencodeClient: fetch + SSE, runTurn (docs/REFERENCIA.md §7)
src/opencode/turn.js  TurnTracker (docs/MAPA.md)
harness/index.html  banco: páginas falsas y ENG-7 (docs/REFERENCIA.md §2)
harness/harness.js  selfcheck 1-64 del banco; el 64, el subrayado (H23) (docs/REFERENCIA.md §2)
harness/harness.css  estilos del banco (docs/BITACORA.md)
harness/issues.json  la Jira de mentira: 40 incidencias (docs/MAPA.md)
harness/panel-preview.html  espejo del panel (docs/REFERENCIA.md §2)
test/run.js  npm run check (docs/REFERENCIA.md §2)
test/harness.js  test(), eq(), assert() (docs/MAPA.md)
test/syntax.js  node --check (docs/MAPA.md)
test/tdz.js  uso antes de declarar (docs/MAPA.md)
test/manifest.js  MV3, key, use_dynamic_url (docs/MAPA.md)
test/contrast.js  ayudas de contraste WCAG (docs/MAPA.md)
test/contrast-pairs.js  las parejas de color, UNA vez; H23 PAGINA y TINTAS (docs/MAPA.md)
test/unit/*.test.js  una prueba por módulo, descubrimiento automático; qué pina cada uno, docs/PINES.md
test/fixtures/prompts/  escenarios.js + 39 .txt (docs/REFERENCIA.md §2)
test/fixtures/models/  rechazos y providers reales (H16) (docs/MAPA.md)
test/integration/opencode.test.js  contra un opencode real (docs/REFERENCIA.md §2)
tools/check-docs.mjs  deriva docs↔código (docs/REFERENCIA.md §2)
tools/last-turn.mjs  npm run turn (docs/REFERENCIA.md §2)
tools/bench.mjs  npm run bench (docs/REFERENCIA.md §2)
tools/contrast-report.mjs  npm run contrast (docs/REFERENCIA.md §2)
tools/serve-harness.js  sirve el banco y su API falsa (docs/REFERENCIA.md §2)
tools/jql-eval.mjs  la Jira de mentira (docs/MAPA.md)
tools/cql-eval.mjs  la Confluence de mentira (docs/MAPA.md)
tools/prompt-snapshots.mjs  npm run snapshots (docs/REFERENCIA.md §2)
tools/instalar.ps1  deja uv y mcp-atlassian (H15) (docs/MAPA.md)
tools/arrancar-opencode.ps1  arranca opencode (H15) (docs/MAPA.md)
tools/config-sandbox.mjs  npm run sandbox (H18) (docs/REFERENCIA.md §2)
tools/toy-mcp.mjs  el MCP de juguete (docs/MAPA.md)
docs/INSTALL.md  instalación y títulos del registro (docs/MAPA.md)
README.md  lo mismo, para personas (docs/MAPA.md)
AGENTS.md  puntero a CLAUDE.md (docs/MAPA.md)
docs/PLAN.md  primer plan, H0-H13 (docs/MAPA.md)
docs/PLAN2.md  segundo plan, H15-H26 (docs/MAPA.md)
docs/plan/  anexos y handoff (docs/MAPA.md)
docs/REFERENCIA.md  §2, §6, §7, §8, §9 y §11 enteros (el preámbulo de este fichero)
docs/MAPA.md  §3: el mapa largo (el preámbulo de este fichero)
docs/FLUJOS.md  §4: los flujos (el preámbulo de este fichero)
docs/PINES.md  §10: lo que pinan los tests (el preámbulo de este fichero)
docs/BITACORA.md  §12: estado y bitácora (el preámbulo de este fichero)
```

## 4. Flujos, paso a paso

Los flujos viven ENTEROS en `docs/FLUJOS.md` (§4.1-4.11, con su numeración de siempre): para tocar uno, lee su apartado, no el fichero entero. Qué hay en cada uno:

- **§4.1 Arranque del panel** (`bootForSite`): el testigo `state.bootToken`, el paquete del sitio en UNA lectura en paralelo con la red (H6), el MCP en segundo plano con `checkMcp`/`state.mcpCheck`/`state.mcpPending` (H14), el modelo de la persona y «Elige el modelo» ANTES de las claves en el primer uso (H16-H17), las claves que se escriben solas y la adopción con `verified` (H18), lo que deja «Quitar las claves» (H19) y el contexto por ámbito con `applyScope`/`changedScope` (H21).
- **§4.2 Un turno de chat** (`send()`): lo que se captura al pedir (§8.22), `runTurn`, `mismoSitio`, el orden pintar → `warnAboutSources` → `recordAnalysisTurn` → `offerNotes` → índice → `offerNavigation` → `persistIndex`, el cronómetro de H3, el silencio del modelo (H6), los veredictos de modelo y «Reintentar con X» (H16) y «Elegir otro modelo» (H17).
- **§4.3 Navegación**: `offerNavigation` → `planNavigation` → `validatePlan` (sólo ids del índice, mismo origen, la rama del árbol) → `runPlan` → pasos en la página; la lista de una búsqueda de Jira dentro de su tarjeta (H8).
- **§4.4 Modo Análisis**: el prompt con «[n]» y el bloque JSON de anclas, la escalera «siempre subraya» de `offerNotes`, `applyNotes` en la página, Escape, restaurar, las páginas base y las sugeridas (H10, H14).
- **§4.5 Señalar en la página**: el pick y `selectionBlock` citado línea a línea con «> » (S3).
- **§4.6 Indexado y memoria**: `generateContext` bajo host Y ámbito con relectura antes de escribir, `restIndexFor` (el árbol por la API, H9/H14), cancelado y fallido por el modelo, la memoria normalizada (R1) y los contextos por ámbito con su tope total (H21).
- **§4.7 Jira**: claves por producto y hosts enlazados, el MCP caído con «Reintentar» (H15), la verificación que no culpa a las claves (H16), las claves escritas por `PATCH /global/config` (H18) y quitadas desde Ajustes (H19), Búsqueda con JQL y la búsqueda como destino, la lista y los chips (H8), «Preguntar sobre estos» (H12), el perfil del proyecto (H9) y los ids en JQL (H14).
- **§4.8 Análisis en Jira**: la incidencia en bloques (`jiraIssueScope`), los campos leídos de la pantalla, el estado del botón de transiciones y «Ninguno» (H14), las páginas base desde un Jira DC.
- **§4.9 Lecturas REST sin tokens**: la única puerta `getJson`, los dos módulos REST con plantillas fijas, la ruta de contexto observada, el interruptor `restTools` y lo que el PASO 0 y H14 vieron en los sitios reales.
- **§4.10 Qué mirar hoy** (H11): apuntar (el service worker como ÚNICO escritor de «visto»), leer, puntuar, pintar, actuar y olvidar; sin modelo.
- **§4.11 Qué guarda Faro de mí** (H13, H16, H21): `paintPrivacy`, `forgetEverythingFor` derivada de `STORAGE_KEYS` + `STORAGE_AREAS`, lo global de la persona y «Olvidar el mapa de X».

## 5. Mensajería (`src/shared/messages.js`)
- panel → SW: START_PLAN, CANCEL_PLAN, NAVIGATE_DIRECT, REQUEST_HOST_PERMISSION, CONTENT_STATUS.
- SW → content: PING, STEP, ANCHOR, CANCEL, SETTINGS, TREE_SNAPSHOT, TREE_DEBUG. `SETTINGS` (`pushSettings`) se manda al lanzar un recorrido, al estar lista la pestaña y, desde H6, cuando CAMBIAN los ajustes: `chrome.storage.onChanged.addListener((changes, area) => …)` en el service worker, con `area === 'local'` y `STORAGE_KEYS.settings in changes`, busca la pestaña activa (`chrome.tabs.query({ active: true, lastFocusedWindow: true })`) y le hace `pushSettings(tab.id)`. Así «Reducir animaciones», el estilo del subrayado, su color (`highlightColor`, H23: claves EXACTAS del mensaje `['highlightColor', 'highlightStyle', 'reduceMotion', 'timing', 'type']`) y la pausa entre pasos llegan a la página al momento y no al navegar (antes llegaban de rebote con el rearranque del panel al cerrar Ajustes, que H6 ya no hace). Ningún mensaje nuevo.
- panel → content: PICK_START, PICK_CANCEL, PAGE_DIGEST (→ `{ok, text, blocks, count, chars, truncated, title, url, issue, ms}`; `issue` = `jiraIssueFields()` o null; `ms` = lo que costó leer la página, sin la espera a que pinte), PAGE_ANCESTORS, PAGE_SEARCH (`{query, wikiPrefix, cloud, limit}` → `searchPages`), ANNOTATE (→ `{ok, placed, missed, detail, ms}`; `ms` = lo que costó marcar: desde que la página tiene texto (tras el `waitFor`) hasta que las marcas están puestas, sin el desplazamiento suave hasta la primera), FOCUS_NOTE, CLEAR_NOTES; y de H10 PAGE_LINKS (`{remote, confluenceHost, cloud}` → `{ok, links, issue, issueKey, remote, title, url, ms}` o `{ok:false, reason:'editando'}` con la misma guarda que PAGE_DIGEST. `links` son `[{href, text, where}]` con tope `LINK_LIMITS.max` y `where` de `LINK_WHERE` (descripcion · enlaces · comentario · pagina); `issue` es `jiraIssueFields()` o null; `issueKey` se lee de la PANTALLA con `jiraIssueKey`, nunca del mensaje; y `remote` es `{ok, links:[{pageId, title, url}], ms}`, o el fallo con su `reason`, o null fuera de una incidencia y con `remote: false`; `ms` mide SÓLO la lectura del DOM —lo que tarde la API va en `remote.ms`—. `remote` es el interruptor maestro `restTools` del panel llevado al content script: apagado, no sale ni una petición y los enlaces del DOM llegan igual, porque leer el DOM no es una lectura REST; `confluenceHost` es el host que `siteRecords` guardó y sirve SÓLO para filtrar a qué hosts se admite que apunte un enlace remoto (`hosts: [location.hostname, enlazado]`), nunca para montar una URL. No se llama `host` ni `hosts` porque el pin de H7 exige que `msg.host` no aparezca en bootstrap.js. Lo manda `paintSuggestedSources` del panel (§4.4). Desde un Jira DC, PAGE_ANCESTORS/PAGE_SEARCH no se mandan: el panel llama a `fetchAncestors`/`searchPages` contra el Confluence enlazado (§4.8).
- panel → content, **lecturas REST del propio sitio con la sesión del navegador** (H7): el content script deduce de SU pestaña lo que decide a qué ruta se pide —`jiraContextPath(location.pathname)` en Jira, `resolveWikiPrefix` en Confluence— en CADA petición, y el panel nunca manda el origen, una URL ni la ruta de contexto de Jira (el `wikiPrefix?` de los mensajes de Confluence es una PROPUESTA que `resolveWikiPrefix` sólo acepta con forma de ruta, como en PAGE_ANCESTORS y PAGE_SEARCH; revisión adversaria de H7). JQL_SEARCH (`{jql, limit?, fields?, cloud?}` → lo que devuelve `searchIssues`), RECENT_ISSUES (`{kind:'history'|'mine'|'project'|'related', projectKey?, issueKey?, days?, limit?}` → la plantilla fija de jira-rest.js; por defecto 7 días «lo tuyo» y 3 «el proyecto»), RECENT_PAGES (`{kind:'viewed'|'mine'|'ids', ids?, days?, limit?, wikiPrefix?, cloud?}` → `viewedCql`/`mineCql`/`idsCql` + `searchContent`), SPACE_PAGES (`{spaceKey, limit?, wikiPrefix?, cloud?}` → `fetchSpacePages`; los topes son los de `INDEX_LIMITS` y NO viajan en el mensaje, para que no haya dos topes de lo mismo diciendo cosas distintas), FAVOURITE_FILTERS (`{}` → `fetchFavouriteFilters`). Un `kind` que no esté en la lista, o un parámetro que no valide, → `{ok:false, reason:'consulta no permitida'}` **sin pedir nada**. Y `PAGE_DIGEST` admite además `{fieldsOnly: true}` → `{ok:true, issue, url, ms}` sin trocear la página y antes de la guarda de «editando». Los cinco nacieron con RECEPTOR y sin EMISOR a propósito (H7 fue sin interfaz): `MSG_SIN_EMISOR_HASTA` de `tools/check-docs.mjs` los convierte en NOTA con el hito que los cablea, y en cuanto alguien los manda seguir en la lista es ERROR: sólo puede encoger, y borrarlos de ahí es parte del hito que los cablea. **Desde H11 los cinco tienen emisor y `MSG_SIN_EMISOR_HASTA` está VACÍA**: `RECENT_ISSUES` y `RECENT_PAGES` los manda `readToday` de panel.js, uno por `kind` y con los parámetros validados del sitio CAPTURADO, nunca con una consulta, un origen, una URL ni una ruta (§4.10). `JQL_SEARCH` lo mandan `attachJqlResults` (la lista de la tarjeta y la búsqueda directa) y, desde H9, `countProfile` (la muestra con la que se cuenta el perfil), y son exactamente DOS apariciones de `MSG.JQL_SEARCH` en el panel, cada una en su función, pinadas; `FAVOURITE_FILTERS` lo manda `loadSearchChipSources`, una vez por sitio y sólo con un chat vacío delante (una sola aparición); y `SPACE_PAGES` lo manda `restIndexFor` desde H9 para leer el árbol del espacio antes de gastar un turno del modelo, con lo que sale de `MSG_SIN_EMISOR_HASTA` (la lista sólo puede encoger: dejarlo ahí sería ERROR «ya lo manda alguien»). `PAGE_DIGEST {fieldsOnly}` lo manda `readIssueFieldsQuick`.
- content → SW/panel: CONTENT_READY, URL_CHANGED, PICK_RESULT, NOTE_CLICKED. SW → panel: PLAN_PROGRESS, PLAN_FINISHED. Desde H11 `CONTENT_READY` y `URL_CHANGED` llevan además `pageId` (`pageIdFromDom()`: la meta `ajs-page-id`, `''` si no hay) y NADA más, y con ellos el service worker apunta la visita en el diario (§4.10); también apunta por `chrome.tabs.onUpdated` con `changeInfo.url`, que es lo que cubre el panel cerrado y los hosts registrados dinámicamente — el filtro no ahorra visitas de más (`recordVisit` funde por su clave los avisos de la misma navegación), ahorra los ajustes y el mapa de sitios LEÍDOS en cada uno de los cuatro o cinco avisos de cada carga de cualquier pestaña (revisión adversaria de H11). Ese id sale de `src/content/page-id.js`, un módulo sin un solo import, porque el aviso corre en cada carga de página. Que bootstrap.js los MANDE lo pina `bootstrap-wiring.test.js`; que el SW los use y no lea ni escriba nada con los interruptores apagados, el sitio sin configurar o sin `changeInfo.url`, `service-worker.test.js`.
- El content script sólo acepta tipos que empiezan por `faro:`; contesta `{ok, …}`; cada `case` importa perezosamente lo que necesita. `chrome.tabs.sendMessage(...).catch(() => null)` siempre. El paso «docs» exige a cada MSG un receptor y avisa del que nadie manda: hoy ninguno, y `MSG_SIN_EMISOR_HASTA` está VACÍA desde H11 (los cinco que sembró H7 los cablearon H8, H9 y H11), así que el informe da 0 avisos y 0 notas. `CANCEL_PLAN` lo atiende el SW (service-worker.test.js) y desde H2 lo manda el botón «Parar» de la tarjeta de navegación (`runPlan`, sólo en recorridos START_PLAN, con el `tabId` capturado al lanzar); `PLAN_FINISHED` con `cancelled` pasa por `finishNavRun` («Navegación cancelada», «desde la tarjeta» / «desde la página»). Borrados en la revisión de H1 (2026-09-14): `GET_TAB_INFO` (con `tabInfo` del SW: nadie lo mandaba) y `CLEAR` (con su `case` en bootstrap.js; `runner.clear()` sigue, lo usa el banco).

## 6. Contratos de datos
Cada contrato con su porqué y sus bordes, en docs/REFERENCIA.md §6; aquí, la forma exacta.
- **Ancla** (`validateAnchor`): heading · text-quote (`exact` 3..300, afijos ≤80) · block-quote (`block` 1..9999, `hint` ≤80, `exact` ''|3..300).
- **Nota**: `{n, title, kind, anchor}`, máx 12; `n` por `noteNumber`.
- **Digest** (`MSG.PAGE_DIGEST`): `{ok, text, blocks, count, chars, truncated, title, url, issue, ms}`; ámbito `{roots, chrome}`.
- **Plan**: `{navigate, mode, destination, anchor, steps, explanation}`; `TARGET_KINDS`.
- **Índice**: `version: 3`, sólo rutas (`toSafePath`), varios espacios; `maxPagesTotal` 1500 puerta, `maxPages` 300.
- **Contextos por ámbito** (`normalizeContexts`): `['version', 'scopes']`, ámbito `['at', 'indexedAt', 'legacy', 'text']`; `*`|`space:KEY`|`project:KEY`.
- **Pick**: `{kind:'text', text(≤4000), …}` · `{kind:'image', alt, …, image}`.
- **Sitio** (`parseAtlassianUrl`): `{host, origin, product, cloud, spaceKey?, pageId?, projectKey?, issueKey?, wikiPrefix?, jiraPrefix?}`.
- **Permisos de sesión** (`SAFE_PERMISSIONS`): `['action', 'pattern', 'permission']`, deny-all primero.
- **Memoria** (`normalizeMemory`): `['at', 'text']`, tope 40.
- **Paquete del sitio** (`getSiteBundle(host)`): `{site, index, stale, contextRaw, memoryRaw, extras}`; `BUNDLE_EXTRA_KEYS`.
- **Lo que Faro guarda por host**: `STORAGE_KEYS`+`STORAGE_AREAS`; olvido salvo `FORGET_KEEPS`.
- **Peso de la sesión**: entero > 0, lo demás 0.
- **Índice pendiente** (`state.indexDirty`): `{host, index}` o null.
- **Entrada del registro** (`Logger`): `{id, at, level, message, detail}`; `log.oldestId`.
- **Tiempos del panel** (`state.timing`): `{boot, turn}`; foto `['phases', 'total']`/`['label', 'ms']`.
- **Ubicación de la cabecera** (`locationParts`): `{key, title}`.
- **Enlace del chat** (`allowedLinkOrigin`): origen EXACTO; `EXTENSION_ORIGINS`.
- **Sitio guardado** (`sites[host]`): registro de `siteRecords` con claves en este orden `configured, mcpName, product, cloud, verified, jiraHost|confluenceHost`; `verified` ausente = verificado, sólo `false` explícito en un `configured: true` avisa (`keysUnverified`).
- **Claves de un producto** (`buildMcpConfig`): `['command', 'enabled', 'environment', 'timeout', 'type']`; `mcpFailureHint` `{copy, kind, retry, text}`.
- **Entrada MCP que Faro escribe** (`validMcpEntry`): claves EXACTAS `['command', 'enabled', 'environment', 'timeout', 'type']` (una de más la INVALIDA), `type` `'local'`, `command` de lista blanca o byte a byte el de `GET /config`; diez `MCP_ENV_KEYS`, ≤4096, `timeout` 1000..600000.
- **Respuesta de las puertas de escritura**: `{ok, status, kind}` y NADA de la respuesta de opencode (trae los tokens); `configureMcp` `['ok','status','kind','name','block','reuse','standard']`, `kind: 'config'` = no se escribió; `paths()` `{config, state, home}`.
- **Destino de una escritura** (`chooseWriteTarget`): `{name, reuse, knownCommand, standard, keep}`.
- **Quitar las claves**: candidata (`mcpScrubCandidates`) `['name','enabled','command','type','timeout','jiraHost','confluenceHost','restos']`, SIN `environment`; `{propias, ajenas, noQuitables}`; `mcpScrubPatch` = entrada ENTERA con `enabled: false` y las diez a `''`, `command` byte a byte; `{ok, status, kind, names}`; `{ok, pendientes}`; `{principal, ajenas, noQuitables, restos}`; `unlinkRecords` patch EXACTO `{configured: false, skippedKeys: false, jiraHost: '', confluenceHost: ''}`, que CONSERVA `mcpName`.
- **Historial de páginas base** (`normalizeHistory`): 60, 90 días; página `['id','spaceKey','title']`.
- **Página de referencia** (`normalizeReferences`): `{families, forWhat, id, role, title}`.
- **Sugerencia** (`suggestSources`): `['id','path','reasons','score','source','spaceKey','title']`.
- **Enlace resuelto de la página** (`confluenceLinksIn`): `[{id, path, spaceKey, title, where}]`.
- **Actividad** (`normalizeActivity`): 300, 30 días, sin prompt.
- **Caché de «hoy»**: 15 min.
- **Marca de borrado del diario**: `CLEAR_GRACE_MS`.
- **Objetivo de «hoy»** (`todayTargets`): `['host', 'kinds', 'product', 'site', 'via']`.
- **Candidato** (`buildCandidates`): `['analyzedAt','family','host','id','kind','lastViewedAt','notes','product','seenAt','seenCount','sourceAt','sources','spaceKey','statusCategory','title','type','updatedAt','updatedBy']`. **Fila** (`rankToday`): `['group','host','id','kind','product','score','title','updatedAt','updatedBy','why']`.
- **Lo que «hoy» tiene en memoria** (`state.today`).
- **Páginas base** (`normalizeSources`): `['id','path','spaceKey','title']`, máx 6.
- **Campos de la incidencia** (`normalizeIssueFields`): `ISSUE_REF_KEYS` `['epicKey','statusCategory']`.
- **Campos leídos para los chips** (`state.issueFields`): `{url, fields}`.
- **La comprobación del MCP** (`state.mcpCheck`): nunca rechaza; `state.mcpPending`.
- **Confluence enlazado como sitio** (`linkedSite`).
- **Fallo de una lectura REST de Jira**: `reason` código.
- **Incidencia leída de la API** (`parseSearchIssues`): `['assignee','components','epicKey','key','labels','lastViewedAt','parentKey','priority','priorityId','reporter','status','statusCategory','statusId','summary','type','typeId','updatedAt']`; ids sólo dígitos; personas nunca en un prompt.
- **Perfil del proyecto** (`normalizeProfile`): `['at','components','labels','prefixes','projectKey','sampled','statuses','types','version']`, `PROFILE_VERSION` 2 (la 1 se descarta), sin personas.
- **Búsqueda sugerida** (`suggestedQueries`): `['jql','kind','label']`.
- **Chip de búsqueda** (`searchChips`): `['jql','kind','label','run','title']`.
- **Búsqueda precargada** (`state.pendingPreload`).
- **Últimas consultas** (`normalizeRecentJql`): 5.
- **Avisos REST ya dados** (`state.restWarned`).
- **Filtro favorito** (`parseFilters`).
- **Lo que la API adelanta al indexar** (`restIndexFor`).
- **Página de un espacio** (`parseSpacePages`).
- **Ajustes**: `restTools` (maestro, no apaga `fetchAncestors`/`searchPages`), `todaySuggestions` subordinado a él, `configWriteConsent` false y global; `highlightColor` `'azul'`|`'ambar'` (H23, `HIGHLIGHT_COLORS`, última clave), a la página por `pushSettings`.
- **Cursor de «Señalar»** (`cursor.js`, H23): `CURSOR_SIZE` 32, `CURSOR_HOTSPOT` `{x: 5, y: 27}`, `cursorDataUrl` ≤2048 con sólo `% # < > "` codificados; `cursorRule` acaba en `5 27, text`.
- **El modelo de la persona** (`settings.model`): `{providerID, modelID}` o null.
- **Veredictos de los modelos** (`normalizeModelChecks`): `['checks', 'fingerprint', 'server', 'version']`.
- **Veredicto de un fallo** (`verdictsForFailure`): `['at', 'key', 'message', 'ok', 'reason']`.
- **Verificación que falla por el modelo** (`verifyCredentials`).
- **Veredictos en memoria** (`state.modelChecks`).
- **Búsqueda** (`searchPages`).

## 7. opencode 1.2.25: lo comprobado en el binario (no está en ninguna doc)
- `format:{type:'json_schema'}` añade `StructuredOutput` y fuerza `tool_choice: required` en todos los pasos, sin reintentos (`retryCount` no se lee) ni streaming → **no en el chat**; sólo planificador, indexador y segunda pasada.
- `system` se guarda por mensaje de usuario y sólo va el del último: contexto grande por turno sin acumularlo.
- Un turno son varios mensajes del asistente (uno por vuelta de herramientas): `runTurn` junta partes, `restoreConversation` agrupa.
- `GET /config` trae los `environment` de los MCP con las claves EN CLARO: sólo hosts, nunca se guarda ni registra.
- `GET /mcp` en frío 14 463 ms (caliente 2 ms): motivó P5.
- `PATCH /global/config` escribe el fichero global (`opencode.jsonc` > `opencode.json` > `config.json`; sin ninguno crea `.jsonc`), fusión profunda, `disposeAll()` sin await: aborta TODOS los turnos y rearranca los MCP; entrada nueva «connected» en ~64-210 ms; `PATCH {}` recarga lo pegado. `POST /mcp` sólo memoria (`GET /mcp` no lo ve). Sin borrado por API: entrada entera con `enabled: false` y variables a `""`. La respuesta del PATCH y el 500 `ConfigJsonError` llevan los tokens → `sensitive`. `OPENCODE_CONFIG_DIR` NO aísla: HOME entero + `GET /path`. uvx ausente → «Connection closed» en ~40 ms; `timeout` es plazo de arranque; `POST /mcp/{name}/connect` ~12 s y dice `true` aunque falle. `PATCH /config` escribe `<cwd>/config.json`, que no se carga; tras el PATCH un `GET /mcp` inmediato puede contestar la instancia vieja (esperar `pollMs`) y se cierra el SSE `/event`. `POST /pty` y `/session/:id/shell` son RCE: no usar; las herramientas propias en `{tool,tools}/*.{js,ts}` quedan fuera de `SAFE_PERMISSIONS`.
- mcp-atlassian 0.23.1: `uvx mcp-atlassian@0.23.1` arranca; `TOOLSETS=all` (sin ella el defecto bajará a seis); `npx mcp-atlassian` es de otro autor.
- `tools` del mensaje se respeta como permiso PERSISTENTE: Faro no lo manda (el alcance exclusivo va por prompt + `consultedOutside`).
- Permisos (S1): manda la ÚLTIMA regla que casa (`findLast`; sin ninguna, «ask»); el `pattern` se casa contra el ARGUMENTO; una MCP es `<cliente>_<herramienta>` con `patterns: ['*']`; las reglas de sesión no quitan herramientas, dan `DeniedError`. Las aprobaciones «always» guardadas del proyecto (tabla `permission`) van DETRÁS de la sesión y ganan a su `deny`: Faro nunca crea ninguna y rechaza todo `permission.asked`. `GET /experimental/tool/ids`: invalid, question, bash, read, glob, grep, edit, write, task, webfetch, todowrite, websearch, codesearch, skill, apply_patch.
- `DELETE /session/:id` NO cancela el turno: abortar antes (`_abandoned`).
- `GET /session/:id/message?limit=N` da los últimos N en orden ASCENDENTE.
- `summarize` exige `{providerID, modelID}`; sin ellos, 400 (R4).
- `info.tokens` `{total, input, output, reasoning, cache}` e `info.cost` por mensaje; `total` = `input + output + cache.read`; `cost` 0 en copilot y `-free` → «sin dato» es `null`; `message.updated` se repite y se suma por mensaje (`this.usage.set(info.id, uso)`).
- Poda: protege los últimos 40 000 tokens (`PRUNE_PROTECT`), marca `time.compacted`; por eso `heavyToolChars` 200 000.
- `confluence_get_page` lee por `page_id`, URL, enlace corto o `title`+`space_key`.
- Modelos: el free tier de opencode no vale desde `serve`; funciona `github-copilot/gpt-5.6-luna`. Nada en `/config/providers` dice si el plan lo permite. Rechazos reales (`APIError`, `isRetryable: false`): `openai/gpt-5.4` 400 «not supported»; `github-copilot/claude-sonnet-4.6` 400 con «Available models» (57 ids; faltan 3 de los 32 de Copilot: `claude-sonnet-4.6`, `gpt-5.4-nano`, `mai-code-1-flash-picker`); `opencode/big-pickle` 403 free tier (veredicto de proveedor).
- `probeModel` (H17): sesión «Faro · probando modelo» con `SAFE_PERMISSIONS`, UN turno «Responde sólo: ok», `variant` más barato (`none` → `minimal` → `low`), plazo `MODEL_LIMITS.probeMs` 15 s; abort ANTES de DELETE; sin probar contra modelo real.
- `~/.local/share/opencode/opencode.db` (SQLite WAL) guarda cada turno, sistema incluido; `npm run turn` copia con `-wal`/`-shm` y abre la COPIA en sólo lectura (la original no se toca). `session.title` es columna; `message.data` `{role, time, system, modelID, providerID, tokens, finish, error?}`; `part.data.tool` lleva el prefijo del MCP; compactación = `user` con parte `compaction` + asistente `summary: true`.

Detalle y cómo se midió cada cosa: docs/REFERENCIA.md §7

## 8. Decisiones de diseño (no negociables sin motivo escrito)
Sólo el enunciado; el porqué, el incidente que la motivó y sus matices están en docs/REFERENCIA.md §8 con el mismo número.

1. **Sólo el panel habla con opencode** — el content script sólo recibe órdenes validadas.
2. **SSE en el panel** — el SW se duerme a los 30 s.
3. **El modelo no emite URLs** — ids que el panel resuelve contra el índice, `validatePlan`/`validateNotes`/`validateAnchor` antes de la página, mismo origen; lo cosechado pasa por `dropForeignUrls` y los enlaces del chat por `allowedLinkOrigin` + `allowHref`; una fila de una búsqueda también pasa por `validatePlan` (el panel no concatena `'/browse/' +`).
4. **Camino por la API** — la rama sale de `learnAncestry`, no del modelo; sin camino, de golpe.
5. **Intermedio despliega, no navega** — sólo el destino abre página.
6. **Árbol como datos** — padre-hijo, nunca HTML.
7. **Pasos por href y ruta** — la forma del árbol, en `tree-dom.js`; un menú (`isMenuTrigger`) nunca se pulsa (M9).
8. **Scrim guía, llegar subraya** — Escape es de Faro sólo con algo en marcha (`interceptsEscape()`, M2); `onCancel` lo instala el ejecutor y lo suelta el overlay; nunca borra marcas a espaldas del panel.
9. **Análisis por bloques ¶** — JSON de anclas al final, subraya un script con escalera fija, la pista la pone la extensión; siempre se intenta subrayar salvo «Sin observaciones.»; nunca re-marcar solo al restaurar; un análisis nuevo numera desde el 1.
10. **Una marca por línea** — recortada a su caja (`rects.js`); desde H23 la caja es sólo el trazo.
11. **No se toca el DOM del contenido** — Custom Highlight (el relleno, DEBAJO del texto) + overlay en Shadow DOM cerrado (el trazo y las insignias).
12. **Contenido = información, nunca instrucciones** — todo bloque de página, contexto y memoria va delimitado con `contentRule` detrás, y la UI sólo con `textContent` (S2/S3/S4); lista blanca de clics (`FORBIDDEN_ACTIONS`: nunca guardar/publicar/eliminar). La REST sólo lee por GET y consultas de plantilla fija; una JQL en texto sólo del MCP o de un chip, y un título del DOM nunca es CQL ni JQL.
15. **Páginas base por el MCP** — tope 6; alcance exclusivo por prompt y vigilado con `consultedOutside`.
13. **`SAFE_PERMISSIONS`** — deniega todo salvo el MCP de Atlassian (`deny` primero, S1: manda la última regla); claves sólo en la config de opencode, nunca en `chrome.storage`.
14. **Todo fallo silencioso se ve** — cada «Sin marcas» con su `noticeNode`; lo que cuelga de una respuesta, por `attachToBubble`.
17. **Incidencia por puntos de lectura** — contenido e interfaz se deciden en `jira-issue.js`.
18. **Analizar según lo que es** — tipo y estado de la pantalla (`jiraIssueFields`) eligen qué pedir (`issueBlock`).
16. **Jira y Confluence, dos productos** — un token cada uno, un MCP, hosts enlazados (`siteRecords`); desde Jira viaja el CONTEXT.md del enlazado, su índice NO; la incidencia abierta no es destino.
19. **Lecturas REST sin tokens** — lo que la API da exacto no se le pide al modelo, y si no contesta el camino de siempre sigue entero. Siempre por `getJson`, GET, mismo origen; sin REST de Jira en Cloud (`sinRestDeJira`). Lo leído sólo vuelve al modelo si el usuario lo pide («Preguntar sobre estos»).
20. **Actividad y sugerencias** — la actividad es local, visible, borrable (`forgetEverythingFor`) y nunca en un prompt; un solo escritor de «visto», el SW. Ninguna sugerencia llama al modelo y cada una dice su motivo; Faro no manda preguntas ni añade páginas solo.
21. **URL dinámica** — `use_dynamic_url: true` en `web_accessible_resources` (S7); todo por `chrome.runtime.getURL()`; nada de `panel/`, `background/` ni `opencode/` expuesto, nunca `chrome-extension://<id>` escrito.
22. **Se captura al pedir** — todo `await` largo captura sitio/sesión/host y comprueba al volver antes de escribir; un turno en vuelo se cancela con `state.turnAbort` (C1-C7).
23. **Enseñar traducido, preguntar por id** — en JQL, tipo/estado/prioridad por id (`porIdONombre`, F5); lo del equipo, por nombre.
24. **Faro sólo escribe MCP en opencode** — una barrera (`mcp-config.js`) y dos puertas: `updateMcpEntries` y `reloadGlobalConfig`, nunca un PATCH genérico ni `POST /mcp`; nunca `/config` de proyecto ni `agent`/`permission`/`plugin`/`command`; sin configuración legible no se escribe. Con permiso, `reconfiguring()`, `sensitive`, sin pisar lo que no pidió; quitar = entrada entera `enabled: false`. Pruebas sólo en `npm run sandbox`.
25. **El modelo es de la persona** — `settings.model` global; `resolveModel` nunca elige solo, se elige en «Elige el modelo». Fallos clasificados gratis en `faro:model-checks` con TTL; la única sonda es «Comprobar» (`probeModel`).
26. **El ámbito, unidad del contexto** — contexto por `space:`/`project:`/`'*'` en la misma clave, índice por host sin partir; migración a `'*'` en la duda. «Tiene mapa» = `hasMap` (sólo `indexedAt`); tope total sin desalojo; ninguna clave nueva en `STORAGE_KEYS` por ámbito.
28. **El subrayado** (H23) — «Señalar» siempre azul; la tinta de las marcas a elegir (azul por defecto, ámbar); insignias y botones de Faro en ámbar; el relleno en dos `::highlight` DISJUNTOS debajo del texto (≥4,5 en los dos temas) y el trazo en el overlay; sin `mix-blend-mode` (forma B, H25, sólo tras medir).

## 9. Convenciones de código
- Cabecera `/** … */` en cada módulo con POR QUÉ existe y el incidente que lo motivó; comentarios de razones, no de mecánica.
- Lógica pura separada del DOM/chrome y marcada «Puro/Pura» (es lo que se prueba en Node); ningún módulo de `src/` toca `document`/`window`/`chrome` al importarse. Lo que el panel decide con una regla vive en un módulo puro con su test (`screens.js`, `chat-scroll.js`, `links.js`, `permissions.js`) y `panel.js` sólo lo llama (H2).
- Lo del modelo pasa por `clean(value, max)` y un `validate*()` con claves blancas; lo de storage se reconstruye igual al leer (`normalizeMemory`, `normalizeSources`, `migrateSettings`) y se repara una vez.
- Límites en objetos `UPPER_SNAKE`, **uno por módulo**, y lo que ya tiene dueño no se duplica. Los tiempos de la navegación sólo en `NAV_TIMING` (`nav-timing.test.js`).
- Toda exportación de `src/` la importa alguien de verdad, o está en `dead-exports.test.js`: `EXPORTADAS_SIN_IMPORTAR` (deuda que sólo encoge), `LISTA_BLANCA` (con motivo), `PENDIENTES_DE_HITO` (vacía, pinado). Lo que no usa nadie se borra.
- Prompts como funciones puras (`[...].join('\n')`); todo cambio hace fallar `prompt-snapshots.test.js`: si es intencionado, `npm run snapshots` y revisar el diff en el mismo commit; regenerar es aceptar.
- Turnos internos: sesión desechable «Faro · <cosa>» + `promptStructured` + `deleteSession` en `finally`. Todo `chrome.tabs.sendMessage` con `.catch(() => null)`. Un turno real se mira con `npm run turn`, nunca con un script ad hoc sobre opencode.db.
- Registro: `log.ok/info/warn/error('Título corto', 'detalle · detalle')`. Cada título nuevo va entre «» en docs/INSTALL.md (el paso «docs» lo exige, `STRICT.titles`); la lista de los 104 con su significado vive allí y en docs/REFERENCIA.md §9.
- UI sólo con `createElement`/`textContent`, nunca `innerHTML`. Familias: `nav-card`, `note-row`, `suggest-row`, `source-row`, `result-*`, `search-chip`, `today-*`, `model-*`, `.privacy`, `.screen-head` + `.icon-btn.back`, `.loc`. Cabecera: sólo cede el chip; `.top-actions` `flex: none`. Accesibilidad: todo anuncio por `announce()`, pantalla abierta = `#app` inerte + foco a su `h1`.
- Tokens del CSS: px de la escala de `:root` (a mano sólo 0, 1 y 2); medidas de pieza en `EXCEPCIONES` y duraciones en `DURACIONES_PROPIAS`, cada una con su motivo (`panel-css.test.js` falla en las dos direcciones). Color nuevo con su pareja en `test/contrast-pairs.js`; un token de borde nunca es tinta. `--mark` es relleno con `--on-mark` encima, `--gold` acento de texto; `outline: none` prohibido; sin sombras salvo `.busy-card`. Overlay (H23): la tinta `--faro-tinta*` en sus cuatro `:host`; el relleno, literal en `highlightCss` y leído de ahí por `TINTAS` (texto ≥4,5; enlace y trazo anotados).
- Tests: `test/unit/<módulo>.test.js`, nombres en español, `SEGURIDAD:` para barreras, `EL CAMBIO:` para un rediseño. `panel.js`, `overlay.js` y `runner.js` por regex sobre su fuente (`panel-wiring`, `overlay-wiring` y `runner-wiring.test.js`), con `sinComentarios`, `funcion`, `una`, `orden` y `eq` sobre cuerpos enteros. `chrome`, `fetch`, `document` o `setInterval` se instalan DENTRO de cada prueba y se restauran en `finally`. Un pin de §10/PINES se copia del código, no se resume.

Detalle, incluidas las familias de clases y los ejemplos de cada regla: docs/REFERENCIA.md §9

## 10. Lo que los tests pinan (no renombrar sin tocar el test)

La lista entera, prueba a prueba y fichero a fichero, está en `docs/PINES.md` (§10, con su numeración de siempre). Es un contrato vivo: `docs.test.js` busca cada fragmento entre acentos graves de ahí en el código y en los tests (uno que no aparezca es un fallo), y el paso «docs» de `npm run check` lee de ahí cada «`x.test.js` (…; N pruebas» y lo compara con lo que registra ese fichero. Reglas: un pin nuevo se COPIA del código o del test, no se resume; lo que se renombra se cambia en el test y en su línea de PINES en el mismo commit; y el número total de pruebas de README y de §2 de aquí es `registry.length`.

## 11. Cómo añadir cosas
- **Módulo puro**: `src/<área>/<nombre>.js` con cabecera de porqué, sin DOM al importar; `test/unit/<nombre>.test.js` (`eq` compara JSON).
- **Mensaje nuevo**: constante en `MSG`, `case` en `bootstrap.js` con import perezoso, `.catch(() => null)`; el paso «docs» falla sin receptor o sin su nombre en el §5 de este fichero, y avisa si nadie lo manda.
- **Mensaje que todavía no tiene quien lo mande**: en `MSG_SIN_EMISOR_HASTA` con su hito (NOTA); sólo encoge, y cablearlo es borrarlo de ahí.
- **Lectura REST nueva**: `xxxPath`+`parseXxx`+`fetchXxx` por `getJson`; sitio de `location`, plantilla por `kind`; fixture, tramo y SEGURIDAD de origen; barrera UNA vez.
- **Fuente nueva de sugerencias**: pura en `source-suggest.js` + `SUGGEST_SCORE`, motivo de la extensión, sin modelo, por `addSource`; prueba por rama en `source-suggest.test.js`.
- **Prompt**: pura en `prompts.js`/`skills.js`/`notes.js`, contenido delimitado; `npm run snapshots` revisando el diff; escenario en `escenarios.js`.
- **Comprobación del banco**: en `selfcheck()`, `// N. …` + `ok(`; fixtures del DOM; 1..N sin huecos (`docs.test.js`).
- **Título de registro nuevo**: en docs/INSTALL.md (lo que mira el paso «docs», con este fichero) y en la lista de docs/REFERENCIA.md §9. **Mensaje nuevo**: en §5. **Fichero nuevo en `src/`**: en §3. **Test nuevo**: el total en README y §2, y el de su fichero en docs/PINES.md §10.
- **Pantalla del panel**: `screen-x` + `showScreen` + `.screen-head` con `h1` y `icon-btn back`; Escape por `ESCAPE_CLOSES` (`screens.js`).
- **Pantalla nueva en el primer uso** (H17): salida de `bootForSite` con `medir()`+`return`, `state.mcpCheck`/`mcpPending` a null, rearranque real al aceptar, flecha `hidden`.
- **Pieza nueva en la cabecera**: está en CINCO botones; un sexto se mide antes en el espejo (`faroPreview.setFifth(true)`).
- **Señal nueva de recomendación** (H11): peso en `SIGNALS` con su porqué, trozo en `reasonText`, y una prueba que ORDENE dos candidatos; `rankToday` total.
- **Bloque nuevo en el `system` del chat**: apertura/cierre, `contentRule` detrás, cada valor por `dato()`, tope en `CONTEXT_BUDGET`; lo decide `baseSystem`; «sin X, byte a byte igual».
- **Chip de búsqueda nuevo**: plantilla en `suggestedQueries`, valores por `jqlQuote`, `kind` en `GRUPOS`; lo traducible por id vía `porIdONombre` (§8.23).
- **Skill que habla distinto en Jira**: `xxxJira(ctx)` y `xxxConfluence()` byte a byte (`skillSystem(id, {product:'confluence'}) === skillSystem(id)`).
- **Script de PowerShell nuevo** (H15): UTF-8 con BOM, sintaxis 5.1, nada de config ni contraseña; pin en `instalar.test.js` y ejecución real (`-SoloComprobar`/`-SoloMostrar`); si instala, con `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` en el scratchpad, nunca el del usuario.
- **Ajuste**: `DEFAULT_SETTINGS` + `migrateSettings` + `applySettingsToUi` + `pushSettings` si afecta a la página.
- **Un veredicto nuevo o un fallo de modelo nuevo** (H16): `classifyModelFailure`/`verdictsForFailure` y `noteModelFailure`; motivo con TTL en `MODEL_LIMITS.ttlMs`; `rawError` real.
- **Clave nueva por host en el almacén** (H13): en `STORAGE_KEYS` y `STORAGE_AREAS` (lo exige `storage.test.js`); sobrevivir sólo por `FORGET_KEEPS` con motivo.
- **Color, tamaño, espaciado o radio nuevo en el panel**: token en claro y en los dos oscuros; pareja en `test/contrast-pairs.js`; `panel-css.test.js` y `npm run contrast`.
- **Color o tinta nueva del overlay** (H23): token en los cuatro `:host`, literal en `highlightCss`, fila en `TINTAS`, valor en `HIGHLIGHT_COLORS`, radio en Ajustes, `pushSettings`, pines.
- **Puerta nueva de escritura en opencode**: NO existe (§8.24): sólo `updateMcpEntries`/`reloadGlobalConfig`; nunca un parche genérico ni `allowCommand` desde `src/` (es la puerta de prueba del sandbox), y lo que traiga la config va `sensitive`; se cambia la barrera con su prueba en `mcp-config.test.js`.
- **Caso nuevo del sandbox**: bloque en `tools/config-sandbox.mjs` detrás de `GET /path` (`sandbox-wiring.test.js`), `apunta(`, toda salida por `imprime` (el token de mentira no se imprime); ejecutado con `npm run sandbox`.
- **Ámbito nuevo, o cambio de forma de una clave por host** (H21): sin clave nueva en `STORAGE_KEYS`; `version` + `normalize*`, migración a `'*'` en la duda, relectura antes de escribir.

Los pasos completos, con el porqué de cada regla: docs/REFERENCIA.md §11.

## 12. Estado, límites y pendientes

12.2 (sin verificar, por hito), 12.4 (ideas descartadas, con su motivo) y 12.5 (la bitácora entera) viven en docs/BITACORA.md con su numeración: léelos ANTES de proponer algo ya descartado.

| Hito | Qué trajo | Rama · commits | Pruebas |
|---|---|---|---|
| H0 | El plan, §8.19/§8.20; PASO 0 | `plan/h0-preparacion` · 0d2cc40 | 540 |
| H1 | check-docs, dead-exports, `npm run turn`, instantáneas | `…h1-herramientas-de-desarrollo` · 56bbb38 | 703 |
| H2 | S1-S7, C1-C7, M1-M9, R1-R4, A1-A3/A7, D7 | `…h2-seguridad-concurrencia-bugs` · f305e8c | 821 |
| H3 | `timing.js`, fases, tokens, `npm run bench` | `…h3-medir` · 9569bff + 9032f69 | 852 |
| H4 | Contraste medido, `panel.css` sobre tokens | `…h4-rediseno-base` · 9e1d89b + c8bd666 | 884 |
| H5 | Cabecera, `.screen-head`, frames, espejo | `…h5-rediseno-composicion` · b6c44d6 + 8020e64 | 904 |
| H6 | P1-P4, P6-P8 (P5 no) | `…h6-eficiencia` · 6ac2965 + f85ff4b | 953 |
| H7 | Cimiento REST, `restTools`, sin UI | `…h7-cimiento-rest` · 29980c7 + 00f6adf | 1046 |
| H8 | Lista en la tarjeta, chips | `…h8-busqueda-jira` · 2ef58b9 + 185fe01 | 1074 |
| H9 | Árbol por API, perfil del proyecto | `…h9-contexto-rest` · fc68f6d + fd4f752 | 1101 |
| H10 | Páginas base sugeridas | `…h10-paginas-base-sugeridas` · f39b108 + 6dbfcc5 | 1171 |
| H11 | Qué mirar hoy, diario local | `…h11-que-mirar-hoy` · 74075fa + 792315a | 1266 |
| H12 | «Preguntar sobre estos» | `…h12-prompts-opcionales` · abfc0fc + 4477eda | 1279 |
| H13 | «Qué guarda Faro de mí», `forgetEverythingFor` | `…h13-cierre` · d0ef30d + ff90e94 | 1283 |
| H14 | Verificación en real: F1-F9, P5, Chrome 130 | `…h14-verificacion-real` · 0b0df78 + 8323fcc | 1317 |
| H15 | uv: instalar/arrancar .ps1, Reintentar MCP | `…h15-uv` · 7be5f67 + cb1cbd1 | 1337 |
| H16 | Modelo de la persona, veredictos | `…h16-modelos-i` · b2c642c + 07bde12 | 1372 |
| H17 | «Elige el modelo», `probeModel` | `…h17-modelos-ii` · fa38dd9 + b26dcb6 | 1378 |
| H18 | MCP por `PATCH /global/config`, sandbox | `…h18-mcp-automatico` · 80e7ce9 + 8188813 | 1416 |
| H19 | «Quitar las claves de este sitio» | `…h19-quitar-claves` · 9f65b73 + 8bb5298 | 1431 |
| H21 | Contexto y mapa por ámbito (`scopes.js`) | `…h21-multi-espacio` · 4a62170 + 9a7780a | 1478 |
| H23 | Subrayado (forma A): tinta azul/ámbar bajo el texto, trazo, insignias en superíndice, cursor subrayador | `plan/h23-subrayado` · al cerrar | 1498 |

Ramas `plan/…`. **Dónde vive:** 22 ramas apiladas sobre `40f56d7` (H0-H21), nada pusheado ni PR, `main` local en `523c25f`; H20 saltado (manual, con gasto); encima, este mapa (Tarea 0, 2026-09-27) en `plan/docs-mapa`, sobre `2684f14`, y sobre él dos carriles en paralelo: H22 en `plan/h22-jira-por-proyecto` (cerrado allí con su revisión adversaria) y H23 en `plan/h23-subrayado`, en un worktree aparte (`C:/Users/marco/Desktop/faro-h23`) y sin commit todavía (docs/plan/handoff/ESTADO.md).

**Límites que no son de ningún hito:**
- Jira Cloud sin REST de Jira (410): todo por el MCP (`sinRestDeJira`).
- La segunda pasada (`collectNotes`) no usa herramientas por prompt, no se comprueba.
- Iframes, shadow roots y ramas plegadas no entran en los bloques.
- Imagen de otro origen: viaja su `alt`, pie y texto de alrededor.
- Hosts propios: sin permiso no hay content script («Dar permiso»).
- Faro no arranca opencode; la configuración la escribe opencode (§8.24).

**Sin verificar:** desde H0 nadie ha cargado la extensión en Chrome (el panel no se ha visto); las capturas 2×2 del espejo (sólo medido);
el banco con frames de verdad; `npm run test:integration` desde H3 (lo corre el orquestador) y `npm run turn` desde H1;
el service worker, nunca ejercitado; las lecturas del panel al Confluence enlazado; ningún lector de pantalla;
de H23, el cursor, la selección azul, el trazo dibujándose y el color en caliente, sólo con la extensión cargada.
Detalle por hito: docs/BITACORA.md §12.2.

**Decisiones pendientes de Marco:**
1. ~~`minimum_chrome_version`~~ RESUELTA en H14: 130.
2. ~~P5, MCP fuera del camino crítico~~ RESUELTA en H14: hecho.
3. `test:integration` gasta turnos de pago: cuándo correrlo.
4. `jiraPrefix` no se guarda (sin instancia con ruta de contexto).
5. Un perfil por host, no por proyecto (lo cierra H22).
6. Las ramas, sin push ni PR: apiladas o aplastadas.
7. Topes puestos a ojo (`TODAY_LIMITS`, `SIGNALS`, TTL…).
8. «Copiar observaciones» copia Markdown tal cual.
9. Modelo GLOBAL de la persona: TOMADA en H16.
10. Decisiones 6-8 de PLAN2 §8: TOMADAS en H17.
11. Decisiones 1, 2 y 4 de PLAN2 §8: TOMADAS en H18.
12. Decisión 3 de PLAN2 §8: TOMADA en H19 (no hay quitar UN producto).
13. Decisión 9 de PLAN2 §8: TOMADA en H21; lo de Jira es de H22.
14. Decisión 11 de PLAN2 §8 (subrayado): TOMADA en H23; la forma B (H25) sólo tras medir.
Detalle: docs/BITACORA.md §12.3.
