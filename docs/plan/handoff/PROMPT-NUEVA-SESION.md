# Prompt para la sesión siguiente (Faro, segundo plan: H22-H26)

Eres Claude Code (Fable 5.1) en el repo de Faro, `C:\Users\marco\Desktop\proyectoChatbot` (extensión Chrome MV3 que convierte un opencode local 1.2.25 en un copiloto dentro de Jira y Confluence Data Center, con el MCP mcp-atlassian). Tu trabajo es TERMINAR el segundo plan de evolución, `docs/PLAN2.md` (hitos H22-H26), con el contexto bajo control. **Lee primero `docs/plan/handoff/ESTADO.md`** (dónde está todo, qué está a medias, qué decisiones ya están tomadas) y NO pidas ni pegues resúmenes de sesiones anteriores: todo lo que necesitas está en el repo.

## 0. Lo que no se negocia

- Tú, Fable, ORQUESTAS y VERIFICAS; el trabajo sustancial va en flujos (`Workflow`) cuyos agentes son **Opus 5.5** (`model: 'opus'`). Ultracode activado.
- Prohibido: escribir en el Jira o el Confluence reales (sólo GET); tocar el `opencode.json` real de Marco o su opencode en marcha con ninguna escritura (toda prueba de escritura, contra un opencode AISLADO con el HOME entero redirigido y `GET /path` comprobado antes: `npm run sandbox`; `OPENCODE_CONFIG_DIR` NO aísla en 1.2.25 y ya provocó un incidente); `git push` o abrir una PR sin que Marco lo pida; ejecutar `node --test` a secas (levanta la prueba de integración, que arranca opencode y gasta turnos de pago); `npm run test:integration` o cualquier sonda de modelo sin permiso explícito de gasto.
- Los commits terminan con la línea `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Hay una copia con tokens en `~/.config/opencode/opencode.json.faro-bak-2026-09-25`: no la leas, no la muevas, no la borres. Nunca imprimas valores de `environment` de opencode.
- En Windows el Bash tool trunca comandos >8 KB y mangla `\` en heredocs: JS con Write/Edit, nunca con heredoc; tras editar, grep de invisibles (`\u0085 \u2028 \u2029 \u202E \u200B`) sobre lo tocado. PowerShell 5.1 no tiene `&&`.

## 1. Tarea 0, ANTES de cualquier hito: adelgazar CLAUDE.md (la causa del contexto enorme) — HECHA el 2026-09-27 en `plan/docs-mapa` (ver ESTADO.md); se deja escrita por si hay que rehacerla

`CLAUDE.md` pesa **1,41 MB** (§12 «Estado y bitácora» 458 KB, §10 «Lo que los tests pinan» 350 KB, §4 «Flujos» 219 KB, §3 «Mapa» 162 KB) y Claude Code lo inyecta ENTERO al arrancar cada sesión y **en cada subagente**: por eso la ventana de contexto nace casi llena y cada flujo de agentes cuesta millones de tokens. Nada más empezar, y con un solo constructor Opus más tu verificación:

1. Deja en `CLAUDE.md` un MAPA de **≤60 KB**: §1 qué es, §2 arrancar y comprobar (sólo los comandos y las reglas), §3 el mapa de ficheros en UNA línea por fichero (qué es y a qué doc remite), §5 mensajería, §6 contratos de datos (compactado), §7 opencode, §8 las decisiones (sólo el enunciado de cada una, sin la historia), §9 convenciones (sin la lista de títulos de registro, que va a INSTALL), §11 cómo añadir cosas, y un §12 corto (estado en una tabla, límites, decisiones pendientes) que remita a la bitácora.
2. Mueve lo demás, **byte a byte y sin resumir**, a ficheros de `docs/`: `docs/FLUJOS.md` ← §4 entero; `docs/PINES.md` ← §10 entero; `docs/BITACORA.md` ← §12.5 entero (y lo largo de §12.2/§12.4); `docs/MAPA.md` ← el §3 largo de hoy. En CLAUDE.md, cada sección corta dice «para tocar X, lee `docs/FLUJOS.md` §4.y» y los agentes de un hito reciben en su prompt QUÉ apartados leer (no leen los ficheros enteros).
3. Adapta las herramientas que hoy leen CLAUDE.md: `tools/check-docs.mjs` (paso «docs» de `npm run check`: número de pruebas, títulos de registro, mensajes MSG, ficheros del mapa §3, «N pruebas» de §10 → ahora de `docs/PINES.md`), `test/unit/docs.test.js` (§10 ↔ código → `docs/PINES.md`; AGENTS.md) y `test/unit/check-docs.test.js`. `npm run check` tiene que quedar en verde con los 1478 (o los que haya).
4. Verifica tú, con un script, que el texto movido es idéntico al original (concatenar los trozos movidos + lo que queda y comparar con `git show HEAD:CLAUDE.md` salvo las líneas puente), y que `wc -c CLAUDE.md` ≤ 60 KB. Commit propio: «Docs: CLAUDE.md pasa a ser un mapa; flujos, pines y bitácora en docs/».
5. Actualiza `AGENTS.md` (puntero) y la memoria: en `MEMORY.md` una línea por memoria y corta (se carga entera en cada sesión); los detalles largos, en `docs/plan/handoff/ESTADO.md`, no en memoria.

Hasta que esto esté hecho, cada agente que lances cuesta ~350 K tokens sólo de arranque. Hazlo primero.

## 2. Cómo mantener el contexto bajo control durante toda la sesión

- Tus salidas de herramientas, cortas: `head`/`tail`/`cut -c1-160`, `grep -n` con rangos, nunca `cat` de un fichero grande ni `git diff` sin `--stat`. Los informes de los agentes se leen con un script node que imprime SÓLO los campos que necesitas (`resumen`, `pendientes`…), truncados; el JSON entero va a un fichero del scratchpad.
- Lo que necesites leer de varios ficheros lo leen LECTORES Opus en un flujo (como `h22-hechos.json`) y te devuelven hechos con líneas y fragmentos exactos; tú escribes el contrato con eso.
- El estado vivo se escribe en `docs/plan/handoff/ESTADO.md` (qué está commiteado, qué flujo corre, qué toca ahora) en cada hito, no en el chat. Si el contexto se acerca al límite: escribe ESTADO.md, commitea lo verificado y termina; la sesión siguiente arranca leyendo ESTADO.md.
- Los flujos corren en segundo plano y te avisan al terminar: no los sondees; mientras tanto, no toques el árbol que están editando.
- Gasto: **≤25 agentes por flujo** (uno de 37 tumbó el límite mensual en los refutadores, 429 «monthly spend limit»); lectores con `effort: 'medium'`, constructores y refutadores con `'high'`; refutadores por GRUPO de hallazgos deduplicados (varias lentes ven lo mismo), nunca uno por hallazgo; el tope de refutadores por encima del número de grupos.

## 3. Estrategia: los hitos que quedan, en dos carriles a la vez

Quedan **H22** (a medias), **H23**, **H24**, **H25** y **H26** (`docs/PLAN2.md` §4, líneas 1460-1600, con sus dependencias en la línea 1583: «H21 → H22 → H24, con H23 en carril paralelo»; H25 son dos piezas condicionadas, y H26 es el cierre). **H20** queda fuera salvo que Marco dé permiso de gasto y un compañero.

Reparto en dos carriles, cada uno en su **worktree y su rama**:

- **Carril 1 (pila principal)**: `plan/h22-jira-por-proyecto` (terminar H22) → `plan/h24-diagramas` → la parte de H25 que dependa de H22/H24 → `plan/h26-cierre`.
- **Carril 2 (paralelo, `git worktree add ../faro-h23 plan/h23-subrayado` sobre el cierre de H22 o de H21)**: H23 (subrayado azul: content script, overlay, `config.js`, `panel.html`/espejo en Ajustes) → la parte «Rotulador» de H25.

Reglas del paralelismo: (a) los tramos nuevos del banco se numeran FIJOS para no chocar (`docs.test.js` exige 1..N sin huecos): H23 → 64, H24 → 65, H25 → 66 y 67 si hace falta; (b) cada carril escribe SU bloque de bitácora y su fila de estado, y al fusionar el carril 2 en la pila (después de H22 y antes de H24, o después de H24: tú decides al ver los diffs) resuelves los conflictos de `panel.html`, `config.js`, `settings.test.js`, el espejo y las docs conservando los dos lados; (c) el navegador es UN recurso: las verificaciones del banco y del espejo se hacen de una en una; (d) primero mide y luego abre el segundo carril: si el gasto de dos flujos simultáneos amenaza el límite, pásalos a serie.

Quién lidera cada carril:

- **Opción A (la que quiere Marco): un subagente Fable 5.1 por carril** (`Agent` con `model: 'fable'`, `isolation: 'worktree'` o el worktree explícito), que lee `docs/plan/handoff/ESTADO.md` y el contrato de su hito, orquesta SUS flujos de Opus y devuelve un informe corto; tú verificas (navegador, banco, espejo) y fusionas. **Compruébalo antes de apostar**: lanza un subagente Fable con una tarea trivial que exija llamar a `Workflow` (un flujo de un agente Opus que devuelva «ok»); si el subagente NO puede lanzar flujos ni agentes desde dentro, la opción A no existe en este arnés.
- **Opción B (si A no es posible): tú orquestas los dos carriles**, lanzando un `Workflow` por carril en segundo plano (los flujos corren a la vez) con etapas Opus en serie (lectores → constructores con ficheros disjuntos → docs), y haces tú las verificaciones y los commits de cada carril en su worktree. Es lo que se hizo con H15-H21, sólo que con dos flujos vivos a la vez.

## 4. El ciclo por hito (el que ha funcionado catorce veces)

1. Lee la ficha del hito en PLAN2 §4 (Qué · Depende de · Ficheros · Pruebas · Riesgo), su área en §3 y sus anexos (`docs/plan/anexo-2-*.md`; donde un anexo contradiga al plan, manda el plan). Si el hito depende de una decisión de PLAN2 §8, usa el valor por defecto que el plan da; las ya tomadas están en `ESTADO.md`.
2. Flujo de LECTORES Opus (2-3, sólo lectura) que devuelven hechos con líneas y fragmentos exactos → tú escribes el CONTRATO (firmas exactas, reparto por ficheros disjuntos, reglas) en `docs/plan/handoff/<hito>-contrato.md`.
3. Flujo de CONSTRUCTORES Opus en serie o en paralelo con propiedad de ficheros disjunta (cada arreglo con su prueba vista fallar antes; cada pin nuevo demostrado por mutación sobre una COPIA del árbol; `panel.js` se prueba por regex en `panel-wiring.test.js` con `sinComentarios`, `funcion(firma)`, `una(línea entera)`, `orden` y `eq` sobre cuerpos enteros —los pines de literal se los saltan las mutaciones—); el último agente es el de docs (CLAUDE.md/FLUJOS/PINES/BITACORA, README, INSTALL; el paso «docs» de `npm run check` falla si un título de registro nuevo no está en INSTALL, si el número de pruebas no coincide o si un fichero nuevo de `src/` no está en el mapa).
4. Verificación TUYA: `npm run check` TRES veces seguidas, `npm run contrast`, `npm run snapshots` sólo si el cambio de prompt es intencionado (y revisando el `git diff`), el banco (`preview_start "harness"` a 1280×900; con el Browser pane oculto no hay frames: antes de `selfcheck()` sustituye `window.requestAnimationFrame` por un `setTimeout` de 16 ms y dilo) y el espejo `harness/panel-preview.html` con `faroPreview.check()` a 320/420 × claro y oscuro en cada pantalla que el hito toque. Lee tú los diffs de las puras contra el contrato.
5. Commit del hito.
6. Flujo de REVISIÓN ADVERSARIA: dos o tres cazadores Opus de sólo lectura con lentes distintas (puras/almacén/prompts · panel/espejo/pines · docs/contrato), mutaciones sobre copias; agrupa sus hallazgos (los duplicados entre lentes son la norma) y lanza UN refutador Opus por grupo (tope por encima del número de grupos, ≤25 agentes). Aplica lo que sobreviva con constructores que reciben cada decisión YA tomada; commit «revisión adversaria»; bloque del hito y de su revisión en la bitácora (mismo estilo y densidad que los anteriores), fila en la tabla de estado, hashes.
7. Actualiza `ESTADO.md` y la memoria (corta). Rama nueva para el siguiente hito.

## 5. H22, tal como se quedó

Rama `plan/h22-jira-por-proyecto` sobre `2684f14` con un commit **WIP** (el constructor A a medias: sólo `jira-rest.js`, `storage.js` y sus dos tests; `npm run check` no pasa ahí porque el panel sigue con los nombres viejos). El contrato completo está en `docs/plan/handoff/h22-contrato.md` (firmas exactas de `normalizeProfiles`/`withProfile`/`profileForProject`, `getProfiles`/`saveProfiles`, `linkedSpacesFor`/`normalizeLinkedSpaces`/`withLinkedSpace`, `linkedScopesLine`, `state.profiles`/`state.linkedSpaces`/`applyLinkedScope()`, el selector `#set-linked-space` de Ajustes, el título nuevo «Espacio enlazado», el tramo 52 con ENG y OPS, el escenario `jira-general-enlazado-sin-texto`) y los hechos del código en `h22-hechos.json`. Decide si continúas desde el WIP (verifica antes los dos tests que A tocó) o vuelves a `2684f14` y rehaces A entero desde el contrato; después B (panel) y C (docs), tu verificación, commit y revisión adversaria.

## 6. Al terminar cada hito, dile a Marco en tres líneas

Qué se cerró (commits), qué queda sin verificar en la extensión cargada (siempre hay algo: el panel sólo se ve ahí), y si hace falta una decisión suya o permiso de gasto. Nada más: los detalles están en la bitácora y en `ESTADO.md`.
