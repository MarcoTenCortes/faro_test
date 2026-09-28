# Faro — contexto para trabajar en este repo

Este fichero es el MAPA del proyecto para una sesión nueva: qué es, cómo se arranca y se comprueba, qué hace cada fichero, qué contratos hay entre piezas, qué decisiones no se negocian y cómo se añaden cosas. Cabe en 60 KB a propósito, porque Claude Code lo inyecta entero en cada sesión y en cada subagente. Lo largo —los flujos paso a paso, el mapa con la historia de cada fichero, lo que pina cada test, la bitácora hito a hito y la referencia de cada contrato y cada decisión— vive en `docs/` desde el 2026-09-27 con la MISMA numeración de secciones que tenía aquí, así que una referencia «CLAUDE.md §4.6» escrita en README, INSTALL, PLAN2, la bitácora o un comentario del código se lee hoy en el fichero que dice esta tabla, en su §4.6:

| Sección | Aquí | Entera, byte a byte |
|---|---|---|
| §1 Qué es | entera | — |
| §2 Arrancar y comprobar | comandos y reglas | `docs/REFERENCIA.md` §2: cada herramienta con sus números medidos y la historia del banco |
| §3 Mapa de ficheros | una línea por fichero | `docs/MAPA.md` §3: qué hizo cada hito en cada fichero |
| §4 Flujos, paso a paso | qué hay en cada flujo | `docs/FLUJOS.md` §4.1-4.11 |
| §5 Mensajería | casi entera | `docs/FLUJOS.md` §4.10: el párrafo de H11; §4.9: quién manda cada lectura REST |
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
- Verificado contra **opencode 1.2.25**. **Chrome ≥130** desde H14
  (`minimum_chrome_version`) por lo verificado: Custom Highlight API,
  `sidePanel`, `registerContentScripts` (§8.21). El usuario real
  usa un Jira Data Center y un Confluence **9.2** Data Center propios
  (`jira.simplprogramme.eu`, `confluence.simplprogramme.eu`, fuera de
  `*.atlassian.net`, **con la interfaz en español**: §8.23) y modelos vía
  `github-copilot/*` y `opencode/*-free`.

## 2. Arrancar y comprobar

```bash
npm run check              # sintaxis + TDZ + manifest + 1730 pruebas unitarias + docs (sólo si las unitarias pasan)
npm run check:docs         # sólo el paso docs, informe entero; sale con 1 si hay errores
npm run test:integration   # su propio opencode serve (4123) y el cliente real; GASTA turnos de pago
npm run harness            # Confluence de mentira en http://127.0.0.1:5175 (preview_start "harness")
npm run turn -- [--host h] [--n 1] [--all] [--db ruta]   # el último turno REAL desde una COPIA de opencode.db (Node ≥22.13)
npm run bench              # el metro: tamaño del system, puros, KB del índice; nunca falla, fuera de check
npm run contrast           # tabla de contraste por tema; sale con 1 si algo baja de 4,5/3 (lo «anotado» no cuenta) o falta un token
npm run sandbox            # H18/H19: escribe DE VERDAD en un opencode PROPIO aislado, nueve casos; fuera de check
npm run snapshots          # regenera test/fixtures/prompts/*.txt; sólo con un cambio de prompt intencionado, revisando el diff
```

- Paso «docs» (`tools/check-docs.mjs`): el total de pruebas de README y de este
  §2 (`registry.length`), el de cada «`x.test.js` (…; N pruebas» de
  docs/PINES.md §10 (`porFichero`), cada título de `log.*('Título'` de `src/`
  entre «» en docs/INSTALL.md o aquí, cada `MSG.X` con RECEPTOR y en §5, cada
  `.js` de `src/` en §3. Todo ERROR (`STRICT`); `MSG_SIN_EMISOR_HASTA` vacía.
- Extensión: `chrome://extensions` → modo desarrollador → cargar `.` (id fijo
  `ickohiffpicdfeameogbihbcanbjibmk`); tras cambiar código, recargar la extensión
  y la pestaña. opencode: `opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO`
  con `OPENCODE_SERVER_PASSWORD` (la misma en Ajustes). En Windows,
  `tools/instalar.ps1` deja uv y mcp-atlassian y `tools/arrancar-opencode.ps1` lo arranca.
- Banco: `http://127.0.0.1:5175/`, botón **Autocomprobación completa** (o
  `await faroHarness.actions.selfcheck()`), con el Browser pane VISIBLE a
  1258×597 (H26: 149/149 con frames de verdad; a 1280×900 emulado no hay
  frames): oculto caen la 27 y la 41. Hoy 67 tramos, 154 `ok(`,
  153 resultados (H28: 153/153 con el pane oculto). Con el pane oculto se sustituye `window.requestAnimationFrame`
  por un `setTimeout` de 16 ms, y se dice.
- Espejo del panel: `harness/panel-preview.html` (el `panel.html` real en un
  iframe; seis conversaciones, diez pantallas). `window.faroPreview.check()` a
  320/420 × claro y oscuro devuelve `{ok, motivo, overflowX, …}` (las doce
  claves, en REFERENCIA §2); mandos `setTheme`,
  `setWidth`, `setStatus`, `setChat`, `setScreen`, `setPick`, `setSources`,
  `setFifth`, `setToday`, `setClaves`, `setQuitar`.
- Windows: el Bash tool trunca >8 KB y mangla `\` en heredocs: JS con
  Write/Edit, nunca con heredoc. PowerShell 5.1 no tiene `&&`.
- Prohibido: `node --test` a secas; `test:integration` y las sondas de modelo
  gastan turnos de pago (no sin permiso; la integración, al cerrar un plan y con
  `FARO_TEST_MODEL=github-copilot/gpt-5.6-luna`, H26); el sandbox sólo contra un opencode
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
manifest.json  MV3, sidePanel; sin use_dynamic_url (H27, §8.21) (docs/MAPA.md)
src/panel/panel.js  el panel, ÚNICO que habla con opencode: estado, chat, turnos; H22 applyLinkedScope; H24 drawCodeBlock; H25 contrastarConJira (docs/FLUJOS.md §4.1)
src/panel/panel.html  las pantallas; ids pinados por test; H22 #set-linked-space y H23 #set-color-field en Ajustes (docs/MAPA.md)
src/panel/panel.css  sobre tokens, claro y oscuro; contraste pinado (docs/REFERENCIA.md §9)
src/panel/chat-scroll.js  stuckToBottom: ¿chat pegado al fondo? (A7) (docs/MAPA.md)
src/panel/screens.js  ESCAPE_CLOSES/ESCAPE_DISMISSES (A3) (docs/MAPA.md)
src/panel/links.js  allowedLinkOrigin: qué enlaces se abren (S5) (docs/MAPA.md)
src/panel/prompts.js  baseSystem y los bloques delimitados; H22 linkedScopesLine (docs/FLUJOS.md §4.2)
src/panel/skills.js  SKILLS y skillSystem (docs/FLUJOS.md §4.7)
src/panel/sources.js  páginas base; consultedOutside (docs/FLUJOS.md §4.4)
src/panel/suggestions.js  las tres sugerencias del chat vacío (H5) (docs/MAPA.md)
src/panel/source-history.js  historial de análisis con páginas base (H10) (docs/FLUJOS.md §4.4)
src/panel/references.js  páginas que nombra el CONTEXT.md (H10) (docs/FLUJOS.md §4.4)
src/panel/source-suggest.js  suggestSources: sugerir y explicar (H10) (docs/FLUJOS.md §4.4)
src/panel/rest-notice.js  cuándo se dice que una lectura REST falló; H28 failReason, sinAccesoMotivo (docs/FLUJOS.md §4.7)
src/panel/today.js  «qué mirar hoy» sin modelo (H11) (docs/FLUJOS.md §4.10)
src/panel/search-chips.js  búsquedas al instante (H8) (docs/FLUJOS.md §4.7)
src/panel/issue-profile.js  familia y fase de la incidencia; issueBlock (docs/FLUJOS.md §4.8)
src/panel/notes.js  modo Análisis: anclas y numeración (docs/FLUJOS.md §4.4)
src/panel/planner.js  de la respuesta a un plan; jqlDestination (docs/FLUJOS.md §4.3)
src/panel/indexer.js  buildContext, harvestIndex (docs/FLUJOS.md §4.6)
src/panel/setup.js  el MCP: configureMcp, quitar las claves (docs/FLUJOS.md §4.7)
src/panel/memory.js  contextos por ámbito y memoria (docs/FLUJOS.md §4.6)
src/panel/markdown.js  markdown → DOM sin innerHTML; allowHref; H24 closed y onCodeBlock (docs/MAPA.md)
src/panel/diagram-parse.js  H24: el Mermaid flowchart leído con claves blancas; toMermaid (docs/FLUJOS.md §4.4)
src/panel/diagram-layout.js  H24: layoutDiagram, capas y baricentro (docs/REFERENCIA.md §6)
src/panel/diagram-view.js  H24: diagramNode, el SVG sin innerHTML; un solo import, LAYOUT_LIMITS (docs/FLUJOS.md §4.4)
src/panel/diagram-links.js  H25: jiraDiagram, clavesDelIndice, la comparación con Jira (docs/FLUJOS.md §4.4)
src/background/service-worker.js  paso a paso, permisos, «visto»; H27 re-PING y reconciliación (§8.29); H28 el vigilante del salto (docs/FLUJOS.md §4.3)
src/content/bootstrap.js  content script: switch de mensajes; H27 PING/SETTINGS sin boot(), el huérfano (docs/FLUJOS.md §4.9)
src/content/runner.js  NavRunner: executeStep, applyNotes (docs/FLUJOS.md §4.4)
src/content/anchor.js  buildTextIndex, resolveAnchor (docs/MAPA.md)
src/content/anchor-match.js  findQuote (docs/MAPA.md)
src/content/digest.js  pageDigest: la página en bloques ¶ (docs/FLUJOS.md §4.4)
src/content/jira-issue.js  la incidencia en pantalla (docs/FLUJOS.md §4.8)
src/content/page-links.js  enlaces del contenido (H10) (docs/FLUJOS.md §4.4)
src/content/locators.js  localizar un paso (H28 href-path); isSafeToClick sin el título de la fila; llevaAlPaso (docs/FLUJOS.md §4.3)
src/content/tree-dom.js  el árbol lateral; isMenuTrigger (M9); H28 rowTitle (docs/FLUJOS.md §4.3)
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
src/shared/scopes.js  el ámbito del contexto y del mapa (H21); H22 linkedSpacesFor por proyecto (docs/FLUJOS.md §4.6)
src/shared/permissions.js  SAFE_PERMISSIONS (S1) (docs/REFERENCIA.md §7)
src/shared/mcp-config.js  la ÚNICA barrera de escritura en opencode (H18) (docs/REFERENCIA.md §8)
src/shared/messages.js  MSG y sendToTab (docs/MAPA.md)
src/shared/storage.js  getSiteBundle, forgetEverythingFor; H22 getProfiles/saveProfiles (docs/FLUJOS.md §4.11)
src/shared/activity-store.js  el diario, con su cola (H11) (docs/FLUJOS.md §4.10)
src/shared/digest.js  formatDigest, matchBlock (docs/MAPA.md)
src/shared/rest-get.js  la ÚNICA puerta REST: getJson (H7) (docs/FLUJOS.md §4.9)
src/shared/jira-rest.js  la REST de Jira; H22 perfiles por proyecto (normalizeProfiles) (docs/FLUJOS.md §4.9)
src/shared/confluence-rest.js  la REST de Confluence (docs/FLUJOS.md §4.9)
src/shared/timing.js  cronómetro por fases (H3) (docs/MAPA.md)
src/shared/models.js  veredictos y elección de modelo (H16) (docs/REFERENCIA.md §8)
src/shared/log.js  Logger y LEVELS (docs/MAPA.md)
src/shared/format.js  prettyTool, clockTime, formatBytes (docs/MAPA.md)
src/atlassian/site.js  parseAtlassianUrl, validSpaceKey, sameSearch (docs/MAPA.md)
src/atlassian/activity.js  el diario de actividad (H11) (docs/FLUJOS.md §4.10)
src/atlassian/index-store.js  el índice, SÓLO rutas (docs/REFERENCIA.md §6)
src/opencode/client.js  OpencodeClient: fetch + SSE, runTurn (docs/REFERENCIA.md §7)
src/opencode/turn.js  TurnTracker (docs/MAPA.md)
harness/index.html  banco: páginas falsas y ENG-7 (docs/REFERENCIA.md §2)
harness/harness.js  selfcheck 1-67 del banco; 65-66 las relaciones (H25); el 52 con dos proyectos (H22); el 64, el subrayado (H23); el 67, el título de la fila (H28) (docs/REFERENCIA.md §2)
harness/harness.css  estilos del banco (docs/BITACORA.md)
harness/issues.json  la Jira de mentira: 40 incidencias; H25 issueLinks (docs/MAPA.md)
harness/panel-preview.html  espejo del panel (docs/REFERENCIA.md §2)
test/run.js  npm run check (docs/REFERENCIA.md §2)
test/harness.js  test(), eq(), assert() (docs/MAPA.md)
test/syntax.js  node --check (docs/MAPA.md)
test/tdz.js  uso antes de declarar (docs/MAPA.md)
test/manifest.js  MV3, key, sin use_dynamic_url (docs/MAPA.md)
test/contrast.js  ayudas de contraste WCAG (docs/MAPA.md)
test/contrast-pairs.js  las parejas de color, UNA vez; H23 PAGINA y TINTAS (docs/MAPA.md)
test/unit/*.test.js  una prueba por módulo, descubrimiento automático; qué pina cada uno, docs/PINES.md
test/fixtures/prompts/  escenarios.js + 40 .txt (docs/REFERENCIA.md §2)
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
docs/PLAN2.md  segundo plan, H15-H26, CERRADO (docs/MAPA.md)
docs/PLAN3.md  tercer plan, H27-H30: la extensión cargada (docs/MAPA.md)
docs/plan/  anexos y handoff (docs/MAPA.md)
docs/REFERENCIA.md  §2, §6, §7, §8, §9 y §11 enteros (el preámbulo de este fichero)
docs/MAPA.md  §3: el mapa largo (el preámbulo de este fichero)
docs/FLUJOS.md  §4: los flujos (el preámbulo de este fichero)
docs/PINES.md  §10: lo que pinan los tests (el preámbulo de este fichero)
docs/BITACORA.md  §12: estado y bitácora (el preámbulo de este fichero)
```

## 4. Flujos, paso a paso

Los flujos viven ENTEROS en `docs/FLUJOS.md` (§4.1-4.11, con su numeración de siempre): para tocar uno, lee su apartado, no el fichero entero. Qué hay en cada uno:

- **§4.1 Arranque del panel** (`bootForSite`): el testigo `state.bootToken`, el paquete del sitio en UNA lectura en paralelo con la red (H6), el MCP en segundo plano con `checkMcp`/`state.mcpCheck`/`state.mcpPending` (H14), el modelo de la persona y «Elige el modelo» ANTES de las claves en el primer uso (H16-H17), las claves que se escriben solas y la adopción con `verified` (H18), lo que deja «Quitar las claves» (H19) y el contexto por ámbito con `applyScope`/`changedScope` (H21); el content script, inyectado sin clic y sin arrancar hasta el primer mensaje real (H27).
- **§4.2 Un turno de chat** (`send()`): lo que se captura al pedir (§8.22), `runTurn`, `mismoSitio`, el orden pintar → `warnAboutSources` → `recordAnalysisTurn` → `offerNotes` → índice → `offerNavigation` → `persistIndex`, el cronómetro de H3, el silencio del modelo (H6), los veredictos de modelo y «Reintentar con X» (H16) y «Elegir otro modelo» (H17).
- **§4.3 Navegación**: `offerNavigation` → `planNavigation` → `validatePlan` (sólo ids del índice, mismo origen, la rama del árbol) → `runPlan` → pasos en la página; la lista de una búsqueda de Jira dentro de su tarjeta (H8).
- **§4.4 Modo Análisis**: el prompt con «[n]» y el bloque JSON de anclas, la escalera «siempre subraya» de `offerNotes`, `applyNotes` en la página, Escape, restaurar, las páginas base y las sugeridas (H10, H14); qué pinta cada capa (relleno en dos highlights disjuntos, trazo, insignias en superíndice, tinta, H23); un ```mermaid cerrado se dibuja (`drawCodeBlock`) y una respuesta a «Dibujar el flujo» no se subraya (`esDiagrama`, H24).
- **§4.5 Señalar en la página**: el pick y `selectionBlock` citado línea a línea con «> » (S3); el subrayador y la selección azul (H23); la causa, si no se enciende (H27).
- **§4.6 Indexado y memoria**: `generateContext` bajo host Y ámbito con relectura antes de escribir, `restIndexFor` (el árbol por la API, H9/H14), cancelado y fallido por el modelo, la memoria normalizada (R1) y los contextos por ámbito con su tope total (H21).
- **§4.7 Jira**: claves por producto y hosts enlazados, el MCP caído con «Reintentar» (H15), la verificación que no culpa a las claves (H16), las claves escritas por `PATCH /global/config` (H18) y quitadas desde Ajustes (H19), Búsqueda con JQL y la búsqueda como destino, la lista y los chips (H8), «Preguntar sobre estos» (H12) y «Dibujar el flujo» (H24), el perfil del proyecto (H9) y los ids en JQL (H14).
- **§4.8 Análisis en Jira**: la incidencia en bloques (`jiraIssueScope`), los campos leídos de la pantalla, el estado del botón de transiciones y «Ninguno» (H14), las páginas base desde un Jira DC.
- **§4.9 Lecturas REST sin tokens**: la única puerta `getJson`, los dos módulos REST con plantillas fijas, la ruta de contexto observada, el interruptor `restTools` y lo que el PASO 0 y H14 vieron en los sitios reales.
- **§4.10 Qué mirar hoy** (H11): apuntar (el service worker como ÚNICO escritor de «visto»), leer, puntuar, pintar, actuar y olvidar; sin modelo.
- **§4.11 Qué guarda Faro de mí** (H13, H16, H21): `paintPrivacy`, `forgetEverythingFor` derivada de `STORAGE_KEYS` + `STORAGE_AREAS`, lo global de la persona y «Olvidar el mapa de X».

## 5. Mensajería (`src/shared/messages.js`)
- panel → SW: START_PLAN, CANCEL_PLAN, NAVIGATE_DIRECT, REQUEST_HOST_PERMISSION, CONTENT_STATUS. Desde H27 (§8.29) REQUEST_HOST_PERMISSION conserva el nombre y ASEGURA el script: el SW comprueba el permiso con `contains`, nunca lo pide, registra e inyecta con un re-PING que pide `arrancar`; CONTENT_STATUS distingue ausente, roto (`alive` + `error`) y listo (formas en §6, «Estado del content script»). Los cinco, sólo sin `sender.tab`; un tipo que el SW no atiende no deja el canal abierto.
- SW → content: PING, STEP, ANCHOR, CANCEL, SETTINGS, TREE_SNAPSHOT, TREE_DEBUG. Desde H27 PING y SETTINGS se contestan ANTES de `boot()` y no arrancan el content script, salvo el PING con `arrancar` (SETTINGS se guarda hasta el arranque). `SETTINGS` (`pushSettings`) se manda al lanzar un recorrido, al retomarlo cuando la pestaña avisa (CONTENT_READY con recorrido; en un salto, sólo la página de destino, H28), cuando CAMBIAN los ajustes (H6: el `onChanged` de `faro:settings`, sólo a la pestaña activa) y, desde la revisión de H23, detrás de cada PING bueno de `contentStatus` y de `ensureContentScript`; una carga sin recorrido no, por peso y sentido (hasta H27, porque la arrancaba entera). Así «Reducir animaciones», el estilo del subrayado, su color (`highlightColor`, H23; las claves EXACTAS del mensaje, en REFERENCIA §6) y la pausa entre pasos llegan a la página al momento y no al navegar. Ningún mensaje nuevo.
- panel → content: PICK_START, PICK_CANCEL, PAGE_DIGEST (→ `{ok, text, blocks, count, chars, truncated, title, url, issue, ms}`; `issue` = `jiraIssueFields()` o null; `ms` = lo que costó leer la página, sin la espera a que pinte), PAGE_ANCESTORS, PAGE_SEARCH (`{query, wikiPrefix, cloud, limit}` → `searchPages`), ANNOTATE (→ `{ok, placed, missed, detail, ms}`; `ms` = lo que costó marcar, sin el `waitFor` ni el desplazamiento suave: docs/FLUJOS.md §4.4), FOCUS_NOTE, CLEAR_NOTES; y de H10 PAGE_LINKS (`{remote, confluenceHost, cloud}` → `{ok, links, issue, issueKey, remote, title, url, ms}` o `{ok:false, reason:'editando'}` con la misma guarda que PAGE_DIGEST; el contrato entero, en docs/FLUJOS.md §4.4). Lo manda `paintSuggestedSources` del panel (§4.4). Desde un Jira DC, PAGE_ANCESTORS/PAGE_SEARCH no se mandan: el panel llama a `fetchAncestors`/`searchPages` contra el Confluence enlazado (§4.8).
- panel → content, **lecturas REST del propio sitio con la sesión del navegador** (H7): el content script deduce de SU pestaña lo que decide a qué ruta se pide —`jiraContextPath(location.pathname)` en Jira, `resolveWikiPrefix` en Confluence— en CADA petición, y el panel nunca manda el origen, una URL ni la ruta de contexto de Jira. JQL_SEARCH (`{jql, limit?, fields?, cloud?}` → lo que devuelve `searchIssues`), RECENT_ISSUES (`{kind:'history'|'mine'|'project'|'related', projectKey?, issueKey?, days?, limit?}` → la plantilla fija de jira-rest.js), RECENT_PAGES (`{kind:'viewed'|'mine'|'ids', ids?, days?, limit?, wikiPrefix?, cloud?}` → `viewedCql`/`mineCql`/`idsCql` + `searchContent`), SPACE_PAGES (`{spaceKey, limit?, wikiPrefix?, cloud?}` → `fetchSpacePages`; los topes, de `INDEX_LIMITS`, no viajan), FAVOURITE_FILTERS (`{}` → `fetchFavouriteFilters`). Un `kind` que no esté en la lista, o un parámetro que no valide, → `{ok:false, reason:'consulta no permitida'}` **sin pedir nada**. Y `PAGE_DIGEST` admite además `{fieldsOnly: true}` → `{ok:true, issue, url, ms}` sin trocear la página y antes de la guarda de «editando». Quién manda cada uno (H7-H11), en docs/FLUJOS.md §4.9.
- panel → content (H25): ISSUE_LINKS (`{keys, cloud?}` → `fetchIssueLinks`), sólo claves del índice, revalidadas con `validIssueKey`; con menos de dos, `{ok:false, reason:'consulta no permitida'}` **sin pedir nada**. Lo manda `contrastarConJira`, una vez (docs/FLUJOS.md §4.4, §4.9).
- content → SW/panel: CONTENT_READY, URL_CHANGED, PICK_RESULT, NOTE_CLICKED. SW → panel: PLAN_PROGRESS, PLAN_FINISHED. Desde H11 `CONTENT_READY` y `URL_CHANGED` llevan además `pageId` (`pageIdFromDom()`: la meta `ajs-page-id`, `''` si no hay) y NADA más, y con ellos el service worker apunta la visita en el diario; también por `chrome.tabs.onUpdated` con `changeInfo.url` (el porqué, `page-id.js` y quién lo pina, en docs/FLUJOS.md §4.10). Revisión de H28: en la fase 'anchor' ancla el aviso del destino, URL_CHANGED incluido; el `reason` de PLAN_PROGRESS va al Registro; `avisado`: ya salió su PLAN_FINISHED.
- El content script sólo acepta tipos que empiezan por `faro:`; contesta `{ok, …}`; cada `case` importa perezosamente lo que necesita. `chrome.tabs.sendMessage(...).catch(() => null)` siempre. El paso «docs» exige a cada MSG un receptor y avisa del que nadie manda: hoy ninguno, y `MSG_SIN_EMISOR_HASTA` está VACÍA desde H11, así que el informe da 0 avisos y 0 notas. `CANCEL_PLAN` lo atiende el SW (service-worker.test.js) y desde H2 lo manda el botón «Parar» de la tarjeta de navegación (`runPlan`, sólo en recorridos START_PLAN, con el `tabId` capturado al lanzar); `PLAN_FINISHED` con `cancelled` pasa por `finishNavRun` («Navegación cancelada», «desde la tarjeta» / «desde la página»).

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
- **Sitio guardado** (`sites[host]`): registro de `siteRecords` con claves en este orden `configured, mcpName, product, cloud, verified, jiraHost|confluenceHost`; `verified` ausente = verificado, sólo `false` explícito en un `configured: true` avisa (`keysUnverified`). De H22, `linkedSpaces` (proyecto → espacio o `'*'`, `normalizeLinkedSpaces`), escrito entero sólo por el selector.
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
- **Confluence enlazado como sitio** (`linkedSite`). En memoria (`state.linkedContext`, H22): `{host, ctxs, index, wikiPrefix, contextMd, contextScope, otherScopes, via}` en ese orden, rellenado por `applyLinkedScope` con `linkedSpacesFor` → `{key, text, via, otras}`.
- **Fallo de una lectura REST de Jira**: `reason` código.
- **Incidencia leída de la API** (`parseSearchIssues`): `['assignee','components','epicKey','key','labels','lastViewedAt','parentKey','priority','priorityId','reporter','status','statusCategory','statusId','summary','type','typeId','updatedAt']`; ids sólo dígitos; personas nunca en un prompt.
- **Perfiles por proyecto** (`normalizeProfiles`, H22): contenedor `['version', 'byProject']`, `PROFILES_VERSION` 1, tope `profileProjects` 20 (los de `at` más reciente); el perfil suelto de antes migra bajo su clave. Cada perfil (`normalizeProfile`): `['at','components','labels','prefixes','projectKey','sampled','statuses','types','version']`, `PROFILE_VERSION` 2 (la 1 se descarta), sin personas.
- **Búsqueda sugerida** (`suggestedQueries`): `['jql','kind','label']`.
- **Chip de búsqueda** (`searchChips`): `['jql','kind','label','run','title']`.
- **Búsqueda precargada** (`state.pendingPreload`).
- **Diagrama** (H24): `readFlowchart` → `{ok, direction, nodes, edges, subgraphs, errores}`, nodo `{id, label, shape, kind, ref, note, sub}`, arista `{from, to, label, style, arrow}`; `layoutDiagram` → `{width, height, nodes, edges, subgraphs}` 1:1 con el diagrama, `LAYOUT_LIMITS.edgeSep` entre paralelas; `diagramNode(…, { kinds })` → `figure.dg-wrap`; `offerDiagramKeys`/`knownProjectsFor` sólo deciden la oferta; `state.pendingDiagram` `{host}` o null, sólo memoria.
- **Relación de Jira** (H25, `parseIssueLinks`): `{from, to, type, name, id}`, sentido de `outward`, → `{nodes, links, truncated}`; `linksJql` de 2 a 30 claves, las de `clavesDelIndice`; `fetchIssueLinks` → `{ok, nodes, links, truncated, via, prefix, ms}`, con un reintento sin las claves que cita un 400; `jiraDiagram` → `{diagram, comparacion:{comunes, soloModelo, soloJira, nodos, fuera, recortada}}`; motivos `'claves'`/`'devueltas'` por `avisoEnLaFigura` (`.dg-aviso`); `figure.dg-wrap.dg-jira` sin guardar nada.
- **Últimas consultas** (`normalizeRecentJql`): 5.
- **Avisos REST ya dados** (`state.restWarned`).
- **Filtro favorito** (`parseFilters`).
- **Lo que la API adelanta al indexar** (`restIndexFor`).
- **Página de un espacio** (`parseSpacePages`).
- **Ajustes**: `navMode` `'guided'`|`'quick'` (de `assistedByDefault`); `restTools` (maestro, no apaga `fetchAncestors`/`searchPages`), `todaySuggestions` subordinado a él, `configWriteConsent` false y global; `highlightColor` `'azul'`|`'ambar'` (H23, `HIGHLIGHT_COLORS`, última clave), a la página por `pushSettings`.
- **Cursor de «Señalar»** (`cursor.js`, H23): `CURSOR_SIZE` 32, `CURSOR_HOTSPOT` `{x: 5, y: 27}`, `cursorDataUrl` ≤2048 con sólo `% # < > "` codificados; `cursorRule` acaba en `5 27, text`.
- **El modelo de la persona** (`settings.model`): `{providerID, modelID}` o null.
- **Veredictos de los modelos** (`normalizeModelChecks`): `['checks', 'fingerprint', 'server', 'version']`.
- **Veredicto de un fallo** (`verdictsForFailure`): `['at', 'key', 'message', 'ok', 'reason']`.
- **Verificación que falla por el modelo** (`verifyCredentials`).
- **Veredictos en memoria** (`state.modelChecks`).
- **Búsqueda** (`searchPages`).
- **Tiempos de la navegación** (`NAV_TIMING`): sólo números; `stepStallMs` 9000 y, de H28, `anchorStallMs` 12000 (el salto por URL) y `afterClickMs` 420 (tras un clic, la SPA).
- **El motivo** (H28, rest-notice.js): `failReason(r, porDefecto)` (`reason`, `error` ≤200 o el de por defecto); `sinAccesoMotivo(problema, {tabId, host})`; `state.ancestryNote` `{host, id, motivo}` o null.
- **Estado del content script** (H27): PING (`arrancar?`) `{ok, url, title, booted}` o, roto, `{ok:false, alive, booted, error}` (`bootErrorText`); CONTENT_STATUS `{granted, ready, alive, error}`; REQUEST_HOST_PERMISSION `{ok:true}` | `{ok:false, needsPermission, error}` | `{ok:false, kind, error}`, `'registro'|'inyeccion'|'roto'|'huerfano'`; `state.contentProblem` `{host, tabId, error}` o null.

## 7. opencode 1.2.25: lo comprobado en el binario (no está en ninguna doc)
- `format:{type:'json_schema'}` añade `StructuredOutput` y fuerza `tool_choice: required` en todos los pasos, sin reintentos (`retryCount` no se lee) ni streaming → **no en el chat**; sólo planificador, indexador y segunda pasada.
- `system` se guarda por mensaje de usuario y sólo va el del último: contexto grande por turno sin acumularlo.
- `GET /config` trae los `environment` de los MCP con las claves EN CLARO: sólo hosts, nunca se guarda ni registra.
- `PATCH /global/config` escribe el fichero global con fusión profunda y rearranca los MCP abortando TODOS los turnos; `PATCH {}` recarga lo pegado; `POST /mcp` sólo memoria; sin borrado por API (`enabled: false` y variables a `""`); su respuesta lleva los tokens → `sensitive`; `OPENCODE_CONFIG_DIR` NO aísla (HOME entero + `GET /path`); `POST /pty` y `/session/:id/shell` son RCE: no usar. El resto, en REFERENCIA §7.
- mcp-atlassian 0.23.1: `uvx mcp-atlassian@0.23.1` arranca; `TOOLSETS=all` (sin ella el defecto bajará a seis); `npx mcp-atlassian` es de otro autor.
- `tools` del mensaje se respeta como permiso PERSISTENTE: Faro no lo manda (el alcance exclusivo va por prompt + `consultedOutside`).
- Permisos (S1): manda la ÚLTIMA regla que casa (sin ninguna, «ask»); el `pattern` se casa contra el ARGUMENTO; las reglas de sesión dan `DeniedError`; las «always» guardadas del proyecto ganan a su `deny`: Faro nunca crea ninguna y rechaza todo `permission.asked`.
- `info.tokens` e `info.cost` por mensaje; `total` = `input + output + cache.read`; `cost` 0 en copilot y `-free` → «sin dato» es `null`; `message.updated` se repite: se suma por mensaje.
- Modelos: el free tier de opencode no vale desde `serve`; funciona `github-copilot/gpt-5.6-luna`; nada en `/config/providers` dice si el plan lo permite; los rechazos reales (`APIError`, `isRetryable: false`), en REFERENCIA §7.
- `probeModel` (H17): sesión desechable con `SAFE_PERMISSIONS`, UN turno, `variant` más barato, plazo `MODEL_LIMITS.probeMs` 15 s; abort ANTES de DELETE.
- `~/.local/share/opencode/opencode.db` (SQLite WAL) guarda cada turno, sistema incluido: lo lee `npm run turn` (§2); su forma, en REFERENCIA §7.

Detalle y cómo se midió cada cosa: docs/REFERENCIA.md §7

## 8. Decisiones de diseño (no negociables sin motivo escrito)
Sólo el enunciado; el porqué, el incidente que la motivó y sus matices están en docs/REFERENCIA.md §8 con el mismo número.

1. **Sólo el panel habla con opencode** — el content script sólo recibe órdenes validadas.
2. **SSE en el panel** — el SW se duerme a los 30 s.
3. **El modelo no emite URLs** — ids que el panel resuelve contra el índice, `validatePlan`/`validateNotes`/`validateAnchor` antes de la página, mismo origen; lo cosechado pasa por `dropForeignUrls` y los enlaces del chat por `allowedLinkOrigin` + `allowHref`; una fila de una búsqueda también pasa por `validatePlan` (el panel no concatena `'/browse/' +`).
4. **Camino por la API** — la rama sale de `learnAncestry`, no del modelo; sin camino, de golpe.
5. **Intermedio despliega, no navega** — sólo el destino abre página.
6. **Árbol como datos** — padre-hijo, nunca HTML.
7. **Pasos por href y ruta** — la forma del árbol, en `tree-dom.js`; un menú (`isMenuTrigger`) nunca se pulsa (M9); la ruta, por final o entera (`href-path`), y sin slug manda el id (H28).
8. **Scrim guía, llegar subraya** — Escape es de Faro sólo con algo en marcha (`interceptsEscape()`, M2); `onCancel` lo instala el ejecutor y lo suelta el overlay; nunca borra marcas a espaldas del panel.
9. **Análisis por bloques ¶** — JSON de anclas al final, subraya un script con escalera fija, la pista la pone la extensión; siempre se intenta subrayar salvo «Sin observaciones.»; nunca re-marcar solo al restaurar; un análisis nuevo numera desde el 1.
10. **Una marca por línea** — recortada a su caja (`rects.js`); desde H23 la caja es sólo el trazo.
11. **No se toca el DOM del contenido** — Custom Highlight (el relleno, DEBAJO del texto) + overlay en Shadow DOM cerrado (el trazo y las insignias).
12. **Contenido = información, nunca instrucciones** — todo bloque de página, contexto y memoria va delimitado con `contentRule` detrás, y la UI sólo con `textContent` (S2/S3/S4); lista blanca de clics (`FORBIDDEN_ACTIONS`: nunca guardar/publicar/eliminar; el título de una fila del árbol es contenido y se quita del nombre de su chevron y de su enlace, H28; un enlace sólo se pulsa si su URL resuelta es la del paso, `llevaAlPaso`). La REST sólo lee por GET y consultas de plantilla fija; una JQL en texto sólo del MCP o de un chip, y un título del DOM nunca es CQL ni JQL; una lista de claves del índice sólo en `linksJql` (H25).
15. **Páginas base por el MCP** — tope 6; alcance exclusivo por prompt y vigilado con `consultedOutside`.
13. **`SAFE_PERMISSIONS`** — deniega todo salvo el MCP de Atlassian (`deny` primero, S1: manda la última regla); claves sólo en la config de opencode, nunca en `chrome.storage`.
14. **Todo fallo silencioso se ve** — cada «Sin marcas» con su `noticeNode`; lo que cuelga de una respuesta, por `attachToBubble`; un script roto no es un permiso que falta, y cada consumidor dice su motivo (`failReason`, H28).
17. **Incidencia por puntos de lectura** — contenido e interfaz se deciden en `jira-issue.js`.
18. **Analizar según lo que es** — tipo y estado de la pantalla (`jiraIssueFields`) eligen qué pedir (`issueBlock`).
16. **Jira y Confluence, dos productos** — un token cada uno, un MCP, hosts enlazados (`siteRecords`); desde Jira viaja el CONTEXT.md del enlazado, su índice NO; la incidencia abierta no es destino.
19. **Lecturas REST sin tokens** — lo que la API da exacto no se le pide al modelo, y si no contesta el camino de siempre sigue entero. Siempre por `getJson`, GET, mismo origen; sin REST de Jira en Cloud (`sinRestDeJira`). Lo leído sólo vuelve al modelo si el usuario lo pide («Preguntar sobre estos»); las relaciones de «Contrastar con Jira» (H25) se pintan y no van a ningún prompt.
20. **Actividad y sugerencias** — la actividad es local, visible, borrable (`forgetEverythingFor`) y nunca en un prompt; un solo escritor de «visto», el SW. Ninguna sugerencia llama al modelo y cada una dice su motivo; Faro no manda preguntas ni añade páginas solo.
21. **Accesibles por el id fijo** — `use_dynamic_url` NO (H27, medido en Chrome 153: la URL con GUID redirige al id fijo, la base del módulo es la de respuesta y sus imports relativos se deniegan); los cinco patrones y nada de `panel/`, `background/` ni `opencode/`; todo por `chrome.runtime.getURL()`, nunca `chrome-extension://<id>` escrito; `web-accessible.test.js` sigue el cierre.
22. **Se captura al pedir** — todo `await` largo captura sitio/sesión/host (y la pestaña, `tabIdAlPedir`, H28) y comprueba al volver antes de escribir; un turno en vuelo se cancela con `state.turnAbort` (C1-C7).
23. **Enseñar traducido, preguntar por id** — en JQL, tipo/estado/prioridad por id (`porIdONombre`, F5); lo del equipo, por nombre.
24. **Faro sólo escribe MCP en opencode** — una barrera (`mcp-config.js`) y dos puertas: `updateMcpEntries` y `reloadGlobalConfig`, nunca un PATCH genérico ni `POST /mcp`; nunca `/config` de proyecto ni `agent`/`permission`/`plugin`/`command`; sin configuración legible no se escribe. Con permiso, `reconfiguring()`, `sensitive`, sin pisar lo que no pidió; quitar = entrada entera `enabled: false`. Pruebas sólo en `npm run sandbox`.
25. **El modelo es de la persona** — `settings.model` global; `resolveModel` nunca elige solo, se elige en «Elige el modelo». Fallos clasificados gratis en `faro:model-checks` con TTL; la única sonda es «Comprobar» (`probeModel`).
26. **El ámbito, unidad del contexto** — contexto por `space:`/`project:`/`'*'` en la misma clave, índice por host sin partir; migración a `'*'` en la duda. «Tiene mapa» = `hasMap` (sólo `indexedAt`); tope total sin desalojo; ninguna clave nueva en `STORAGE_KEYS` por ámbito. En Jira (H22), por proyecto también el perfil (`byProject`) y el contexto del enlazado que viaja (`linkedSpacesFor`; lo elegido a mano manda).
27. **Diagramas** — el modelo escribe Mermaid `flowchart`; la extensión lo valida con claves blancas y lo pinta con `createElementNS`, sin dependencias ni `innerHTML`; un nodo navega sólo al hacer clic, por `validatePlan` y con la clave en el índice; nada del diagrama se vuelve consulta (el contraste de H25 manda claves del índice, cosechadas por M4, a una plantilla fija); `classDef`/`style`/`linkStyle` se ignoran y `click`/`href`/`callback` se rechazan (H26); «Dibujar el flujo» no manda nada; sin viñeta en el prompt ni MCP de dibujo.
28. **El subrayado** (H23) — «Señalar» siempre azul; la tinta de las marcas a elegir (azul por defecto, ámbar); insignias y botones de Faro en ámbar; el relleno en dos `::highlight` DISJUNTOS debajo del texto (≥4,5 en los dos temas) y el trazo en el overlay; sin `mix-blend-mode` (forma B, H25, sólo tras medir).
29. **El SW nunca pide un permiso** (H27) — sólo `contains`; el diálogo, el panel con gesto. Registros reconciliados en `onInstalled` y `permissions.onAdded`/`onRemoved` (`originsToRegister`: sitios guardados y sus enlazados con permiso, nunca lo que ya cubre `content_scripts`). PING y SETTINGS no arrancan el content script, salvo el PING con `arrancar` al asegurarlo; uno vivo y roto no se reinyecta: se dice.

## 9. Convenciones de código
- Cabecera `/** … */` en cada módulo con POR QUÉ existe y el incidente que lo motivó; comentarios de razones, no de mecánica.
- Lógica pura separada del DOM/chrome y marcada «Puro/Pura» (es lo que se prueba en Node); ningún módulo de `src/` toca `document`/`window`/`chrome` al importarse. Lo que el panel decide con una regla vive en un módulo puro con su test (`screens.js`, `chat-scroll.js`, `links.js`, `permissions.js`) y `panel.js` sólo lo llama (H2).
- Lo del modelo pasa por `clean(value, max)` y un `validate*()` con claves blancas; lo de storage se reconstruye igual al leer (`normalizeMemory`, `normalizeSources`, `migrateSettings`) y se repara una vez.
- Límites en objetos `UPPER_SNAKE`, **uno por módulo**, y lo que ya tiene dueño no se duplica. Los tiempos de la navegación sólo en `NAV_TIMING` (`nav-timing.test.js`).
- Toda exportación de `src/` la importa alguien de verdad, o está en `dead-exports.test.js`: `EXPORTADAS_SIN_IMPORTAR` (deuda que sólo encoge), `LISTA_BLANCA` (con motivo), `PENDIENTES_DE_HITO` (vacía, pinado). Lo que no usa nadie se borra.
- Prompts como funciones puras (`[...].join('\n')`); todo cambio hace fallar `prompt-snapshots.test.js`: si es intencionado, `npm run snapshots` y revisar el diff en el mismo commit; regenerar es aceptar.
- Turnos internos: sesión desechable «Faro · <cosa>» + `promptStructured` + `deleteSession` en `finally`. Todo `chrome.tabs.sendMessage` con `.catch(() => null)`. Un turno real se mira con `npm run turn`, nunca con un script ad hoc sobre opencode.db.
- Registro: `log.ok/info/warn/error('Título corto', 'detalle · detalle')`. Cada título nuevo va entre «» en docs/INSTALL.md (el paso «docs» lo exige, `STRICT.titles`); la lista de los 109 con su significado vive allí y en docs/REFERENCIA.md §9.
- UI sólo con `createElement`/`textContent`, nunca `innerHTML`. Familias: `nav-card`, `note-row`, `suggest-row`, `source-row`, `result-*`, `search-chip`, `today-*`, `model-*`, `dg-*` (H24; H25 `.dg-jira`/`.dg-caption`/`.dg-diff`, marca `.dg-aviso`), `.privacy`, `.screen-head` + `.icon-btn.back`, `.loc`. Cabecera: sólo cede el chip; `.top-actions` `flex: none`. Accesibilidad: todo anuncio por `announce()`, pantalla abierta = `#app` inerte + foco a su `h1`.
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
- **Color o tinta nueva del overlay** (H23): la marca de Faro (ámbar) no es tinta; una tinta nueva = sus dos `:host(.faro-tinta-X)` y `(.faro-tinta-X.faro-dark)`, rellenos literales en `highlightCss`, filas en `TINTAS` y su capa en `tokensDeTinta` (contrast-report.mjs), valor en `HIGHLIGHT_COLORS` (y `setTint`), radio en Ajustes, pines; `pushSettings` ya lo lleva.
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
| H22 | Jira por proyecto: perfiles `byProject`, `linkedSpacesFor` y su selector | `plan/h22-jira-por-proyecto` · bd01fa2 + a7b781a | 1498 |
| H24 | Diagramas: parser, layout y SVG propios, «Dibujar el flujo» | `plan/h24-diagramas` · e8b950f + 512e8a1 | 1580 |
| H23 | Subrayado (forma A): tinta azul/ámbar bajo el texto, trazo, insignias en superíndice, cursor subrayador | `plan/h23-subrayado` · 5184261 + 65adb9c + 3cd6ae3 → fusión 39ef839 | 1505; fundido, 1607 |
| H25 | «Contrastar con Jira»: las `issuelinks` reales, el diagrama «Según Jira» y la comparación (H25a descartada) | `plan/h25-issuelinks` · 8928c60 + dfabd81 | 1642 |
| H26 | Cierre: docs definitivos, banco con frames de verdad, integración, sandbox, el turno real; classDef tolerado y la pregunta sin classDef | `plan/h26-cierre` · d2e243b + 7e48237 | 1643 |
| H27 | El content script vuelve a cargar (sin `use_dynamic_url`), y cuando no, se ve: PING/SETTINGS sin `boot()`, re-PING, el SW sin `request` y reconciliando | `plan/h27-content-script` · 7c729e4 + a024313 | 1666; revisión, 1679 |
| H28 | Lo que consume el content script dice la verdad (`failReason`, `sinAccesoMotivo`, el vigilante del salto) y el árbol del DC (el título de la fila, `href-path`); revisión: el último clic del DC, «Llévame» sin permiso, `llevaAlPaso` | `plan/h28-la-verdad` · 6afde42 + ace17bc | 1707; revisión, 1730 |

Ramas `plan/…`. **Dónde vive:** 22 ramas apiladas sobre `40f56d7` (H0-H21), nada pusheado ni PR, `main` local en `523c25f`; H20 saltado (manual, con gasto); encima `plan/docs-mapa` (este mapa, Tarea 0), `plan/h22-jira-por-proyecto` (bd01fa2 + a7b781a + 9cfc93d), `plan/h24-diagramas` (e8b950f + 512e8a1 + 8a98d94), `plan/h23-fusion` (39ef839 + 225421e: H23, hecho en su carril `plan/h23-subrayado` sobre 6256545, fundido sobre 8a98d94), `plan/h25-issuelinks` · 8928c60 + dfabd81 + 149ddf0 y la punta, `plan/h26-cierre` · d2e243b + 7e48237 + el commit de los hashes (docs/plan/handoff/ESTADO.md). El segundo plan queda CERRADO el 2026-09-27. Encima, el TERCER plan (docs/PLAN3.md, H27-H30): `plan/plan3-preparacion` (13b70e8), `plan/h27-content-script` y `plan/h28-la-verdad`.

**Límites que no son de ningún hito:**
- Jira Cloud sin REST de Jira (410): todo por el MCP (`sinRestDeJira`).
- La segunda pasada (`collectNotes`) no usa herramientas por prompt, no se comprueba.
- Iframes, shadow roots y ramas plegadas no entran en los bloques.
- Imagen de otro origen: viaja su `alt`, pie y texto de alrededor.
- Hosts propios: sin permiso no hay content script («Dar permiso»).
- Faro no arranca opencode; la configuración la escribe opencode (§8.24).

**Visto el 2026-09-28**: Marco cargó la extensión en su Chrome 153 y el content script no arrancaba (con `use_dynamic_url`, MEDIDO; PLAN3 §2); H27 lo arregla en código.
**Sin verificar:** H27 y H28 en Chrome (la lista de H30, PLAN3 §7): el panel real, el SW y los SUPUESTOS de §8.29 (`request` sin gesto, la
actualización que borra los registros, el mundo aislado nuevo) y, de su revisión, un `<div id="__faroBooted">` y el paso del huérfano; las lecturas del panel al Confluence enlazado; ningún lector de pantalla; las capturas 2×2 del espejo (medidas con check() a 320/420 × claro y oscuro
en H22-H25 y vistas con los ojos a 320 en claro en H23-H25, sin ficheros); de H23, el cursor, la selección azul, el trazo y el color en caliente; de H26,
la pregunta nueva y el parser tolerante frente a un modelo con datos reales; de H28, el banco con frames de verdad y, de su revisión, el último clic del DC y «Llévame» sin permiso (PLAN3 §7, 15-20).
**Verificado en H26** (2026-09-27): el banco con frames de verdad (149/149 con rAF nativo a 1258×597 emulado, pane visible),
`npm run test:integration` (18/18 con `FARO_TEST_MODEL=github-copilot/gpt-5.6-luna`), `npm run turn` (probado) y el sandbox (9/9).
Detalle por hito: docs/BITACORA.md §12.2.

**Decisiones pendientes de Marco:**
1. ~~`minimum_chrome_version`~~ RESUELTA en H14: 130 (desde H27, por lo verificado).
2. ~~P5, MCP fuera del camino crítico~~ RESUELTA en H14: hecho.
3. ~~`test:integration`: cuándo correrlo~~ RESUELTA en H26: al cerrar cada plan, con `FARO_TEST_MODEL` fijado (la sonda de seis modelos a la vez deja a Copilot sin contestar en 15 s).
4. `jiraPrefix` no se guarda (sin instancia con ruta de contexto).
5. ~~Un perfil por host~~ RESUELTA en H22: uno por proyecto (`byProject`).
6. Las ramas, sin push ni PR: apiladas o aplastadas.
7. Topes puestos a ojo (`TODAY_LIMITS`, `SIGNALS`, TTL…).
8. «Copiar observaciones» copia Markdown tal cual.
9. Modelo GLOBAL de la persona: TOMADA en H16.
10. Decisiones 6-8 de PLAN2 §8: TOMADAS en H17.
11. Decisiones 1, 2 y 4 de PLAN2 §8: TOMADAS en H18.
12. Decisión 3 de PLAN2 §8: TOMADA en H19 (no hay quitar UN producto).
13. Decisión 9 de PLAN2 §8: TOMADA en H21 y H22 (lo de Jira, hecho; «manual manda», desvío anotado).
14. Decisión 11 de PLAN2 §8 (subrayado): TOMADA en H23; la forma B (H25a) DESCARTADA en H25 (BITACORA §12.4).
15. La viñeta del diagrama en el prompt: FUERA. Con datos (2026-09-28) el modelo ya dibuja bien, pero mete `:::hueco [n]` DENTRO de las comillas de la etiqueta: la pregunta necesita el ejemplo de forma.
16. ~~El token de Jira del MCP~~ RESUELTA el 2026-09-28: Marco lo renovó a mano y un turno real lo confirmó (épica SIMPL-31748 leída).
Detalle: docs/BITACORA.md §12.3.
