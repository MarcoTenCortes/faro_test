<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# E · Diagramas en el chat (flujos entre tickets, «dónde está mal»)

## Resumen

Los MCP de Excalidraw no encajan en Faro: el oficial (excalidraw/excalidraw-mcp, MIT, sin token) devuelve una «MCP App» HTML que sólo pinta un host que soporte MCP Apps (Claude, ChatGPT, VS Code), no el panel de Faro; los comunitarios (p. ej. yctimlin/mcp_excalidraw, MIT, sin token) levantan un lienzo en un servidor local con una pestaña de navegador aparte y obligan al modelo a dibujar elemento a elemento con decenas de llamadas, además de exigir añadir `*_excalidraw_*` a SAFE_PERMISSIONS y otro MCP que instalar. Mermaid vendorizado pesa 3,57 MB (0,98 MB gzip), devuelve el SVG como CADENA pensada para innerHTML (lo prohíbe §9), lleva 19 usos de innerHTML y DOMPurify dentro, y tiene un historial de XSS 2025-2026. Viz.js (Graphviz) pesa 1,4 MB, usa WASM y también devuelve cadena. Recomiendo un renderizador PROPIO de un subconjunto de Mermaid «flowchart» (el modelo lo escribe con soltura) traducido a una forma interna validada con claves blancas (lo mejor de las opciones b y c), con layout por capas y SVG con createElementNS. Prueba de concepto en Node: 309 líneas (parser + validación + layout Sugiyama simplificado + SVG + «Copiar como Mermaid»), 6 nodos/7 aristas en ~1 ms de parse y ~1 ms de layout, 0 cruces, ida y vuelta Mermaid idéntica, y lo peligroso (click, style, classDef, <img onerror>, javascript:) no pasa. Los colores caben en tokens que ya existen (contraste medido ≥3,26 en bordes y ≥13 en texto). Estimación: un hito, ~700 líneas de src y ~60 pruebas.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[leido-en-doc]** El MCP oficial de Excalidraw (excalidraw/excalidraw-mcp) es MIT, no pide token, funciona en remoto (mcp.excalidraw.com) o autoalojado, y devuelve una interfaz HTML interactiva como extensión «MCP Apps»: sólo la pinta un cliente que soporte MCP Apps.
  - Evidencia: https://github.com/excalidraw/excalidraw-mcp (README: «works with any client that supports MCP Apps»)
- **[leido-en-doc]** yctimlin/mcp_excalidraw (npx -y mcp-excalidraw-server, Node ≥20, MIT, sin claves) expone 26 herramientas de CRUD de elementos sobre un lienzo que corre en un servidor local y necesita una pestaña de navegador para capturas, exportar imagen y convertir Mermaid; devuelve JSON de elementos, PNG/SVG o ficheros .excalidraw; «share» sube a excalidraw.com cifrado y es opcional.
  - Evidencia: https://github.com/yctimlin/mcp_excalidraw
- **[leido-en-doc]** Hay al menos otros seis servidores comunitarios (al1y/mcp-excalidraw, lesleslie/excalidraw-mcp, whallysson/excalidraw-mcp, debu-sinha/excalidraw-mcp-server con API key, i-tozer, Fromsko); todos dibujan en un lienzo propio con vista previa en una app web aparte.
  - Evidencia: Búsqueda web «excalidraw MCP server github» (resultados de github.com)
- **[leido-en-doc]** Compartir en excalidraw.com por enlace (#json=id,clave) exige subir la escena cifrada a su backend; no hay un parámetro documentado para abrir datos sin subirlos. Un fichero .excalidraw (type, version, source, elements, appState, files) sí se puede generar y descargar.
  - Evidencia: https://docs.excalidraw.com/docs/codebase/json-schema ; DeepWiki excalidraw «Backend Integration and Share Links»; issue #1090
- **[supuesto]** Que excalidraw.com abra un .excalidraw local con Ctrl+O o arrastrándolo sin subir nada, y que su restore rellene los campos que falten en elementos mínimos.
  - Evidencia: Conocimiento general del producto; no comprobado
- **[ejecutado]** mermaid@11 dist/mermaid.min.js mide 3 572 661 bytes (980 407 gzip); versión 11.17.2 dentro; npm dice que la última es 12.0.0, MIT.
  - Evidencia: curl de https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js | wc -c y | gzip | wc -c; npm view mermaid version license
- **[ejecutado]** El bundle de Mermaid contiene 19 apariciones de innerHTML, 7 de DOMPurify, 0 de eval( y 0 de «new Function»; sí contiene Function("return this") (detección del global, que con el CSP de extensión lanzaría EvalError si se llega a evaluar) y ramas de KaTeX con Function(...).
  - Evidencia: grep -o sobre scratchpad/diagramas/mermaid.min.js
- **[leido-en-doc]** mermaid.render devuelve { svg } como CADENA y la documentación indica insertarla con element.innerHTML; securityLevel 'sandbox' pinta dentro de un iframe aislado; mermaid.parse sólo valida y devuelve { diagramType }, no la estructura.
  - Evidencia: https://mermaid.js.org/config/usage.html
- **[leido-en-doc]** Mermaid ha tenido varias vulnerabilidades XSS/inyección recientes: CVE-2025-54880/54881 (d3.html en diagramas de arquitectura, ≤11.9.0), CVE-2026-41159 (inyección CSS, <11.15.0), y XSS en integraciones que usan securityLevel loose + innerHTML (CVE-2026-32308, GitLab CVE-2026-0752).
  - Evidencia: Búsqueda web «mermaid XSS vulnerability CVE 2025 2026» (sentinelone, advisories.gitlab.com, miggo)
- **[ejecutado]** @viz-js/viz@3 viz-standalone.js mide 1 404 869 bytes (592 058 gzip), usa WebAssembly y no usa innerHTML; su salida también es una cadena SVG. dagre@0.8.5 (sólo layout, MIT) mide 283 803 bytes (65 272 gzip); elkjs 1,6 MB.
  - Evidencia: curl | wc -c sobre jsDelivr; grep WebAssembly/innerHTML en viz.js
- **[leido-en-doc]** El CSP mínimo de las páginas de extensión MV3 es equivalente a script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; no se puede añadir 'unsafe-eval' ni orígenes remotos; eval sí funciona en páginas sandbox declaradas en el manifest.
  - Evidencia: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- **[leido-en-codigo]** manifest.json no declara content_security_policy (usa el de por defecto) y panel.html carga sólo <script type="module" src="panel.js">.
  - Evidencia: manifest.json completo; src/panel/panel.html:530
- **[leido-en-codigo]** parseBlocks de markdown.js ya separa las vallas con su lenguaje (block.lang) y renderMarkdown pinta 'code' con pre>code y textContent: un ```mermaid llega hoy como bloque de código con data-lang=mermaid. parseBlocks NO dice si la valla se cerró (cierra al final del texto), lo que importa en streaming.
  - Evidencia: src/panel/markdown.js:22-32 (fence), :204-212 (case 'code'), :191 renderMarkdown(src, {onLink, onNote, allowHref})
- **[leido-en-codigo]** splitAnchorsBlock sólo mira vallas cuyo lenguaje empieza por 'json' o está vacío, así que un ```mermaid se queda en la prosa (y se restaura con ella) sin interferir con el bloque de anclas.
  - Evidencia: src/panel/notes.js:684-718, línea 686: fences(src).filter((f) => f.lang.startsWith('json') || f.lang === '')
- **[leido-en-codigo]** NOTE_KINDS = ['dato','supuesto','hueco','contradiccion','riesgo'] es la lista que reutilizaría el diagrama para «dónde está mal».
  - Evidencia: src/panel/notes.js:73
- **[leido-en-codigo]** Una fila de la lista navega con validatePlan({kind:'jira-issue', id}) + runPlan(..., 'direct'), y resolveTarget exige que la incidencia esté en index.issues: una clave del diagrama que no esté en el índice no se puede abrir sin cosecharla antes.
  - Evidencia: src/panel/panel.js:3654-3680 (openIssueFromResults); src/atlassian/index-store.js:230-247 (resolveTarget, case 'jira-issue': index.issues[id])
- **[leido-en-codigo]** SAFE_PERMISSIONS sólo permite MCP_TOOL_PATTERNS = ['*_confluence_*', '*_jira_*']; un MCP de Excalidraw exigiría ampliar esa lista (y su pin en permissions.test.js).
  - Evidencia: src/shared/permissions.js:77
- **[ejecutado]** Los colores de un diagrama caben en tokens que YA existen, con contraste suficiente en los dos temas: --ink sobre --surface 17,97/14,69; --ink sobre --danger-bg 15,15/14,21; --ink sobre --gold-bg 16,28/13,36; --hairline-strong sobre --surface (borde/arista, 3:1) 3,48/3,26; --danger sobre --surface 6,42/6,61; --gold sobre --surface 7,12/8,60; --muted sobre --surface (etiqueta de arista) 5,78/5,78.
  - Evidencia: scratchpad/diagramas/contraste.mjs con cssVarsOf/contrastRatio de test/contrast.js sobre src/panel/panel.css
- **[ejecutado]** La PoC (309 líneas) parsea un flowchart de 6 nodos/7 aristas con subgrafos, clases :::hueco/:::contradiccion y refs de incidencia, lo coloca en 5 capas con 3 nodos ficticios y 0 cruces en 344×492 px, en ~1,1-1,6 ms de parse, ~1,0-1,4 ms de layout y ~0,5 ms de SVG; 30 nodos se colocan en ~0,5 ms.
  - Evidencia: node run-poc.mjs (salida: «layout 344x492 capas 5 ficticios 3 cruces 0», «ms parse 1.63 layout 1.42 svg 0.66»)
- **[ejecutado]** En la PoC, «Copiar como Mermaid» y volver a parsear da exactamente los mismos nodos y aristas; un ciclo en LR se coloca sin cruces; las líneas click, style, classDef se rechazan con su motivo; <img onerror>, javascript: y RLO/NEL quedan como texto de una línea; con 80 nodos se corta en DIAGRAM_LIMITS.nodes=30 y se dice.
  - Evidencia: node run-poc.mjs (salidas «ida y vuelta igual: true», «malo errores [...]», «svg malo sin <img ni onerror...: true true true», «grande nodos 30 ... 'demasiados nodos'»)
- **[ejecutado]** Tolerancia de la PoC a lo que suelen escribir los modelos: acepta A-->B sin espacios, graph TD con «;», etiquetas entrecomilladas, «-- texto -->» y subgraph; NO acepta aún «A --> B & C», un «]» dentro de comillas, las flechas --x/--o ni ids con guion (ENG-1 --> ENG-2). Son ~60-80 líneas más.
  - Evidencia: node tolerancia.mjs (9 casos: 5 enteros, 4 con «sobra …»)
- **[ejecutado]** Los escenarios de instantáneas que cambiarían si la instrucción entra en Análisis y Búsqueda de Jira son 9: jira-analisis-{base-abierto, base-exclusivo, digest-enlazado-largo, digest, sin-digest, sin-enlace} y jira-busqueda{,-perfil,-precargada}.
  - Evidencia: ls test/fixtures/prompts/*.txt

## Opciones

### (1) MCP de Excalidraw

Registrar un MCP de Excalidraw en opencode (el oficial remoto/local o uno comunitario con lienzo local) y dejar que el modelo dibuje con sus herramientas.

**A favor**

- Sin token en los principales (MIT)
- Resultado editable a mano en Excalidraw
- Estética «a mano» conocida

**En contra**

- El oficial devuelve una MCP App HTML que el panel de Faro no sabe pintar (Faro no es host de MCP Apps): el dibujo no aparece en el chat
- Los comunitarios dibujan en un lienzo local en OTRA pestaña/servidor (Node ≥20, puerto propio), no en el chat
- El modelo tiene que hacer decenas de llamadas de herramientas por diagrama: más turnos, más tokens, más salida arrastrada en la sesión (§7), y los modelos pequeños lo hacen mal
- Obliga a ampliar SAFE_PERMISSIONS (*_excalidraw_*) y a instalar/configurar otro MCP por usuario, justo lo que el equipo ya sufre con uvx
- Ningún nodo sería navegable por validatePlan: rompe §8.3

**Esfuerzo**: Medio para instalarlo, pero no resuelve el objetivo (dibujo en el chat)

### (2a) Mermaid vendorizado

Copiar dist/mermaid.min.js al repo y pintar los ```mermaid del chat con mermaid.render.

**A favor**

- Soporta todos los tipos de diagrama
- El modelo escribe Mermaid con soltura
- MIT

**En contra**

- 3,57 MB (0,98 MB gzip) en un repo «sin dependencias»
- Devuelve cadena SVG para innerHTML: choca con §9; convertirla con DOMParser sigue siendo meter marcado de un tercero
- 19 innerHTML y DOMPurify empotrado; historial de XSS 2025-2026 que obliga a seguir actualizando
- Etiquetas HTML por foreignObject; tema, clic en nodos y [n] exigen post-procesar su SVG
- Con securityLevel sandbox pinta en iframe: puente postMessage para navegar, alto y tema

**Esfuerzo**: Bajo para verlo, alto para dejarlo seguro y mantenido

### (2b+c) Subconjunto de Mermaid flowchart con renderizador propio y forma interna validada (RECOMENDADA)

El modelo escribe un bloque ```mermaid con flowchart TD/LR; un parser puro lo traduce a {direction, nodes:[{id,label,shape,kind,ref,note,sub}], edges:[{from,to,label,style,arrow}], subgraphs} validado con claves blancas y topes; layout por capas (ciclos por DFS, capas por camino más largo, ficticios, baricentro, coordenadas) y SVG con createElementNS. Si no se entiende, cae en el bloque de código de hoy.

**A favor**

- Cero dependencias, cero innerHTML, CSP intacto
- El modelo usa un lenguaje que conoce (más fiable que un JSON propio) y el usuario puede copiarlo a Confluence/GitHub/Excalidraw (Excalidraw importa Mermaid)
- Todo lo que llega pasa por una barrera: click/style/classDef/href rechazados, textos de una línea sin invisibles, refs sólo por validIssueKey o id numérico
- Nodos navegables por validatePlan, [n] enlazados a focusNote, kinds de notes.js coloreados con tokens existentes
- Probado en Node: ~1 ms, 0 cruces en el caso real, ida y vuelta exacta
- Degradación honesta: lo que no se entiende se ve como código, igual que hoy

**En contra**

- Sólo flowchart (sin secuencia ni Gantt)
- Layout menos pulido que dagre/Graphviz en grafos densos (aristas largas rodean por fuera)
- Hay que ampliar la tolerancia del parser (&, comillas con corchetes, --x/--o) y mantenerlo
- Cambia 9 instantáneas de prompt si la instrucción va siempre

**Esfuerzo**: Un hito: ~250 líneas parser+validación, ~250 layout, ~200 vista DOM, ~120 cableado del panel, ~60 CSS; ~60 pruebas

### (2c) Sólo DSL JSON propio «faro-diagram»

El modelo emite ```json {"diagram":{nodes,edges}} como el bloque de anclas y se valida con claves blancas.

**A favor**

- Validación trivial con claves blancas
- Encaja con el patrón de splitAnchorsBlock

**En contra**

- Los modelos pequeños fallan más con un esquema propio que con Mermaid
- El usuario no lo puede pegar en ningún otro sitio
- Compite con el bloque json de anclas (dos JSON al final de la respuesta)

**Esfuerzo**: Algo menor que 2b+c en el parser, igual en layout y vista

### (2d) Graphviz con viz.js/WASM

Vendorizar @viz-js/viz y pedir DOT al modelo.

**A favor**

- Layout de calidad
- El CSP de extensión admite wasm-unsafe-eval

**En contra**

- 1,4 MB
- Salida en cadena SVG (innerHTML)
- DOT es menos conocido por los modelos y el usuario
- Nodos navegables y temas exigen post-procesar

**Esfuerzo**: Medio

### (2e) Excalidraw JSON emitido por el modelo + mini-render propio

El modelo emite elementos Excalidraw (rect/ellipse/arrow/text con coordenadas) y Faro los pinta y ofrece descargar el .excalidraw.

**A favor**

- Fichero editable en Excalidraw

**En contra**

- El modelo tiene que calcular coordenadas: sale mal casi siempre
- Muchos campos obligatorios por elemento
- Mismo problema de validación y más tokens

**Esfuerzo**: Medio-alto para peor resultado; mejor como EXPORTACIÓN desde la opción recomendada

### (3) Complemento sin modelo: grafo de relaciones leído de la API

Con las claves que salen en la respuesta (validadas), una plantilla fija issuekey in (…) con fields issuelinks,parent,status da las relaciones EXACTAS, y Faro las dibuja con el mismo renderizador; el modelo sólo añadiría los kinds.

**A favor**

- Relaciones exactas, sin tokens (§8.19)
- Cosecha las claves en el índice y las deja navegables

**En contra**

- Sólo Jira DC; nuevo campo en la lista blanca y una plantilla nueva
- No sabe «dónde está mal»: eso sigue siendo del modelo

**Esfuerzo**: Medio, en un hito posterior

## Recomendación del investigador

Opción (2b+c): subconjunto de Mermaid «flowchart» escrito por el modelo, traducido a una forma interna validada y pintado por un renderizador propio con createElementNS. Motivo: es la única que cumple a la vez las reglas duras del proyecto (sin dependencias, sin innerHTML, CSP por defecto, lo que viene del modelo pasa por validate* con claves blancas, navegación sólo por identificadores y validatePlan) y aprovecha que los modelos ya escriben Mermaid; el Excalidraw MCP no pinta en el chat de Faro y Mermaid vendorizado pesa 3,6 MB y trae innerHTML con historial de XSS.

Puntuación (1-5, más es mejor) — dependencias / seguridad / fiabilidad del modelo / calidad visual / esfuerzo / mantenimiento:
- MCP Excalidraw: 2/2/2/4/2/2 → 14 (y no resuelve «en el chat»)
- Mermaid vendorizado: 1/2/5/5/3/2 → 18
- Propio sobre Mermaid (recomendada): 5/5/4/3/3/4 → 24
- DSL JSON propio: 5/5/3/3/3/4 → 23
- viz.js: 2/3/3/5/3/3 → 19
- Excalidraw JSON del modelo: 5/4/1/3/2/3 → 18

DISEÑO CONCRETO
1. Contrato de datos (pura, src/panel/diagram-parse.js): parseFlowchart(src) → validateDiagram(raw) → {ok, direction:'TB'|'BT'|'LR'|'RL', nodes:[{id,label,shape,kind,ref,note,sub}], edges:[{from,to,label,style,arrow}], subgraphs:[{id,label,nodes}], errores:[…]}, claves EXACTAS. DIAGRAM_LIMITS {srcMax 6000, nodes 30, edges 60, labelMax 80, edgeLabelMax 40, idMax 32, subgraphs 6}. id por /^[A-Za-z_][A-Za-z0-9_]*$/; label de una línea con sinInvisibles + NEL colapsado (como dato() de prompts.js); shape de lista blanca (rect, round, diamond, circle, stadium, subroutine, hexagon); kind sólo de NOTE_KINDS (vía :::clase o «class A riesgo»); ref = {kind:'jira-issue', id} si la PRIMERA palabra de la etiqueta pasa validIssueKey, o {kind:'confluence-page', id} si es «página NNNN»/id ≥4 cifras (decidir forma exacta); note = el primer «[n]» de la etiqueta (1..NOTE_LIMITS.max). Se RECHAZAN con su motivo: click, href, callback, style, classDef, linkStyle, directivas %%{init}%%, y cualquier otro tipo de diagrama. Ampliar la tolerancia a «A --> B & C», comillas con corchetes, --x/--o y ids con guion (ENG-1 --> ENG-2, que los modelos escriben aunque Mermaid lo desaconseje: tratarlo como id con ref).
2. Layout (pura, src/panel/diagram-layout.js): layout(diagram, {rankGap, nodeGap}) → {width, height, nodes con x,y,w,h,lines, edges con points, cruces}. Anchura del texto ESTIMADA (6,6 px/carácter, envolver a 22 caracteres, 3 líneas); en el navegador se puede medir con getComputedTextLength en una segunda pasada si hace falta. Arreglos vistos en la PoC: el rombo debe dimensionarse ~1,5× la etiqueta; los límites incluyen los puntos de las aristas (corregido en la PoC).
3. Vista (src/panel/diagram-view.js, DOM): diagramNode(diagram, {onIssue, onNote, notesAvailable}) → <figure class="dg-wrap"> con <svg role="img"> + <title> + <desc>, un <g class="dg-node dg-<kind> dg-link" tabindex=0 role=button aria-label="Abrir ENG-7 · riesgo"> por nodo navegable (Enter/Espacio/clic), una lista equivalente plegada (<details> «Ver como lista»: «ENG-1 → ENG-7 (la consume)») y una barra con «Copiar como Mermaid» (toMermaid, ida y vuelta exacta) y, si Marco lo quiere, «Descargar .excalidraw» (toExcalidraw puro + Blob + a[download]). A 320 px: contenedor con overflow-x:auto y el SVG a su tamaño natural; si cabe con escala ≥0,75 se escala al ancho; botón «Ampliar» opcional. NUNCA innerHTML: todo createElementNS/setAttribute/textContent.
4. Navegación (§8.3): clic en un nodo con ref jira-issue → la misma ruta que openIssueFromResults (validatePlan + runPlan 'direct'); si la clave no está en el índice, en Jira DC con restTools se cosecha antes con una plantilla fija nueva «issuekey in (A,B,C)» (claves por validIssueKey, en jira-rest.js, como idsCql) y harvestFromSearch; si no se puede, el nodo se pinta sin dg-link y con title «no está en el índice». Un nodo/arista con [n] llama a focusNote(n) sólo si n está en state.notes. Nada del diagrama navega por URL.
5. Integración en el chat: renderMarkdown gana una opción onCodeBlock(lang, text, closed) → Node|null; el panel la pasa en las cuatro llamadas (como allowHref) y sólo pinta diagrama para lang 'mermaid' con la valla CERRADA (parseBlocks añade closed al bloque 'code'); durante el streaming se ve «Dibujando el diagrama…» o el código. Si parse falla o quedan <2 nodos, el bloque de código de hoy + nota «No he podido dibujarlo: …». Se restaura solo, porque vive en la prosa guardada en opencode. Registro: un título nuevo, p. ej. «Diagrama» (N nodos · M aristas · X líneas ignoradas).
6. Prompt (skills.js/prompts.js): una viñeta en Análisis de JIRA y en Búsqueda de Jira: «Si relacionas tres o más incidencias o páginas (dependencias, flujo, bloqueos), añade ANTES del bloque json de anclas un bloque ```mermaid con flowchart LR o TD: ids cortos (A, B…), la clave al principio de cada etiqueta (A[ENG-7 Definir la API]), como mucho 15 nodos, marca con :::riesgo, :::contradiccion o :::hueco donde algo está mal y pon [n] en la etiqueta del nodo de una observación. Sin click, style, classDef ni enlaces.» Nada en Confluence ni en los demás modos (byte a byte, pinado). Cambian 9 instantáneas (jira-analisis-* ×6, jira-busqueda* ×3) con npm run snapshots revisando el diff. Alternativa a decidir: en vez de siempre, sólo cuando la pregunta lo pide o con un botón «Dibujar el flujo» bajo la respuesta que deja la pregunta escrita (como «Preguntar sobre estos», §8.20).
7. Estilo (panel.css): .dg-wrap, .dg, .dg-node, .dg-link, .dg-edge, .dg-dotted, .dg-thick, .dg-elabel, .dg-arrowhead, .dg-riesgo/.dg-contradiccion (stroke --danger, fill --danger-bg), .dg-hueco/.dg-supuesto (stroke --gold, fill --gold-bg), texto --ink, arista --hairline-strong, etiqueta de arista --muted, foco con el anillo --mark de siempre. Sin tokens nuevos; parejas nuevas a declarar en test/contrast-pairs.js: TEXTO ['--ink','--danger-bg'], ['--ink','--gold-bg']; CONTROL ['--danger','--danger-bg'], ['--gold','--gold-bg'] (medidas arriba, todas holgadas).
8. Sin MCP nuevo: SAFE_PERMISSIONS no cambia.

## Ficheros y pines que toca

- NUEVO src/panel/diagram-parse.js (puro): parseFlowchart, validateDiagram, toMermaid, DIAGRAM_LIMITS, DIAGRAM_SHAPES; importa validIssueKey/sinInvisibles de site.js y NOTE_KINDS/NOTE_LIMITS de notes.js
- NUEVO src/panel/diagram-layout.js (puro): layout, envolver (Sugiyama simplificado)
- NUEVO src/panel/diagram-view.js (DOM): diagramNode con createElementNS, lista equivalente, «Copiar como Mermaid»; opcional toExcalidraw puro en diagram-parse.js o diagram-export.js
- NUEVOS test/unit/diagram-parse.test.js (~25: sintaxis admitida, SEGURIDAD click/style/classDef/%%{init}%%/href, invisibles/NEL/RLO, refs sólo validIssueKey, kinds sólo NOTE_KINDS, topes, ida y vuelta toMermaid), diagram-layout.test.js (~12: DAG sin cruces, ciclo, LR, ficticios, determinista, sin solapes por capa, límites incluyen aristas, 30 nodos < X ms), diagram-view.test.js (~10 con un document mínimo como conDocument de markdown.test.js: ningún innerHTML, role/title/desc, tabindex sólo en nodos con ref, data-note sólo si la nota existe)
- src/panel/markdown.js: parseBlocks añade closed al bloque 'code'; renderMarkdown(src, {onLink, onNote, allowHref, onCodeBlock}); markdown.test.js +2-3 (sin onCodeBlock, igual que hoy; valla sin cerrar no dibuja)
- src/panel/panel.js: las cuatro llamadas a renderMarkdown con onCodeBlock (pin S5b de panel-wiring exige hoy allowHref en las cuatro: ampliar), el clic de nodo por validatePlan/runPlan (reutilizar openIssueFromResults generalizada), focusNote, log «Diagrama»; panel-wiring.test.js +2-3 (sin innerHTML, sin '/browse/' +, onCodeBlock en las cuatro)
- src/shared/jira-rest.js (si se hace la cosecha): plantilla keysJql(keys) con validIssueKey; jira-rest.test.js +2; bootstrap-wiring.test.js si entra como kind nuevo de RECENT_ISSUES
- src/panel/skills.js (busquedaJira y analisis en Jira) o prompts.js: la viñeta del diagrama; skills.test.js +2 (Confluence y otros modos byte a byte); npm run snapshots → 9 .txt de Jira
- src/panel/panel.css: clases .dg-*; panel-css.test.js: sin px fuera de escala (la PoC usa 6/16/24/56: pasar a tokens o a EXCEPCIONES con motivo), sin colores literales
- test/contrast-pairs.js: 2 TEXTO + 2 CONTROL nuevas
- harness/panel-preview.html: un diagrama en «Jira · SIMPL-1234» y '.dg-wrap' en CAJAS de check() (overflowX a 320 px con scroll interno)
- docs: CLAUDE.md §3 (mapa de los 3 ficheros), §4.4/§4.7, §6 (contrato Diagrama), §9 (clases), §10 (pines), README, docs/INSTALL.md (título «Diagrama»)
- Scripts de sonda: scratchpad/diagramas/poc-diagram.mjs, run-poc.mjs, tolerancia.mjs, contraste.mjs, flujo.svg

## Riesgos y límites

- Sólo flowchart: un modelo que responda con sequenceDiagram o un gráfico ve su bloque como código (degradación honesta, igual que hoy)
- Anchura de texto estimada en Node (6,6 px/carácter): con emojis o CJK puede desbordar el nodo; en el navegador conviene medir con getComputedTextLength
- Layout propio menos pulido que dagre/Graphviz: aristas largas rodean por fuera (visto en la PoC: A→F por x=336). Plan B sin cambiar el contrato: vendorizar sólo dagre.min.js (284 KB, MIT, sin DOM) para las coordenadas
- Un grafo de 30 nodos en cadena mide 2600 px de alto: el prompt debe pedir ≤15 nodos y LR para cadenas largas
- Los modelos pequeños (gpt-5.6-luna) pueden escribir Mermaid con variantes que el parser aún no admite (&, --x, ids con guion): la PoC entiende 5 de 9 casos típicos; hay que ampliar antes de dar el hito por bueno y leer turnos reales con npm run turn
- Añadir el bloque alarga la respuesta: el freno «respuesta corta» (NOTE_LIMITS.shortAnswer 400) se mide sobre la respuesta original con la valla dentro; conviene medirlo sin las vallas de diagrama
- Una clave del diagrama que no esté en el índice no se puede abrir sin una lectura REST previa (sólo Jira DC con restTools); en Cloud o sin permiso, el nodo queda no navegable
- «Descargar .excalidraw»: que excalidraw.com abra un fichero con elementos mínimos (restore rellenando campos) no está comprobado; y compartir por enlace sube la escena a su servidor, así que Faro no debe ofrecer «Abrir en excalidraw.com» con datos
- No se ha probado nada en el panel real ni en Chrome: la PoC es Node puro que produce texto SVG

## Decisiones que el investigador deja a Marco

- ¿La instrucción del diagrama va SIEMPRE en Análisis/Búsqueda de Jira (el modelo decide si dibuja; cambia 9 instantáneas y ~120 tokens por turno), sólo cuando la pregunta pide dibujar, o con un botón «Dibujar el flujo» bajo la respuesta que deja la pregunta escrita?
- ¿También en Confluence (flujos entre páginas) o sólo en Jira, como pidió el equipo («cuando se mencionen varios tickets»)?
- ¿Se ofrece «Descargar .excalidraw» además de «Copiar como Mermaid»? (Excalidraw importa Mermaid pegado, así que copiar Mermaid ya permite editarlo allí sin subir nada)
- ¿Hito posterior con el grafo de relaciones EXACTO leído de la API (issuelinks de las claves citadas, sin modelo, sólo Jira DC)?
- Confirmar que se descarta instalar un MCP de Excalidraw: no pinta en el chat de Faro, exige otro MCP por usuario y ampliar SAFE_PERMISSIONS
- Si el layout propio se queda corto con grafos densos, ¿se acepta vendorizar dagre.min.js (284 KB, MIT) sólo para coordenadas, rompiendo el «sin dependencias» en un único fichero?

## Pruebas propuestas

- diagram-parse.test.js: sintaxis admitida (TD/LR/TB/BT/RL, graph/flowchart, formas, -->, ---, -.->, ==>, |etiqueta|, -- etiqueta -->, &, subgraph…end, :::clase, class A x, %% comentarios); SEGURIDAD: click/href/callback/style/classDef/linkStyle/%%{init}%% rechazados con motivo, <img onerror>/javascript: quedan como texto, NEL/U+2028/RLO/ZWSP colapsados o borrados, ref sólo si pasa validIssueKey, kind sólo de NOTE_KINDS (y '__proto__' no cuela, Object.hasOwn), note sólo 1..NOTE_LIMITS.max, topes DIAGRAM_LIMITS con su error, claves EXACTAS del resultado; toMermaid ida y vuelta idéntica
- diagram-layout.test.js: el flujo de 6 nodos de la PoC da 0 cruces y 5 capas; ciclo sin bucle infinito; LR intercambia ejes; ningún par de nodos de una capa se solapa; los límites incluyen los puntos de las aristas; determinista (misma entrada, mismo JSON); 30 nodos en < 20 ms
- diagram-view.test.js con document mínimo: no se usa innerHTML ni insertAdjacentHTML (también por regex sobre el fuente), svg con role=img, title y desc; sólo los nodos con ref llevan tabindex y role=button; data-note sólo con una nota existente; la lista equivalente tiene una fila por arista
- markdown.test.js: sin onCodeBlock todo byte a byte igual; valla mermaid sin cerrar → código; con onCodeBlock que devuelve null → código
- panel-wiring.test.js: onCodeBlock en las cuatro renderMarkdown; el clic de nodo pasa por validatePlan y runPlan, sin '/browse/' + ni URL; focusNote sólo con la nota en state.notes
- skills.test.js + prompt-snapshots: viñeta sólo en Jira Análisis/Búsqueda; Confluence y demás modos byte a byte; 9 .txt regenerados con diff revisado
- panel-css.test.js/contrast-pairs: parejas nuevas declaradas y en verde en los dos temas; npm run contrast en verde
- Espejo: un diagrama en «Jira · SIMPL-1234», faroPreview.check() en verde a 320/420 × claro/oscuro con '.dg-wrap' en CAJAS
- Real: npm run turn sobre un Análisis de una épica con varios tickets en el Jira DC de Marco para ver si gpt-5.6-luna escribe el bloque y qué variantes usa; clic en un nodo que abre la incidencia; [n] del nodo enfoca la marca

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/diagramas\poc-diagram.mjs (parser + validación + layout + SVG + toMermaid, 309 líneas)
- <scratchpad>/diagramas\run-poc.mjs (el flujo de 6 nodos, LR con ciclo, SEGURIDAD, topes, tiempos)
- <scratchpad>/diagramas\tolerancia.mjs (9 variantes típicas de modelo: 5 enteras)
- <scratchpad>/diagramas\contraste.mjs (parejas de color medidas con test/contrast.js)
- <scratchpad>/diagramas\flujo.svg (SVG resultante, 3 148 bytes; texto: <svg viewBox="0 0 344 492" role="img" class="dg"><title>Flujo entre ENG-1, ENG-7, ENG-12, OPS-2, ENG-20 y ENG-3</title>… 7 <path class="dg-edge …" marker-end="url(#fa)"> (A→F rodea por M113.2,56 L192,136 L336,240 L336,350 L270.3,436) … 6 <g class="dg-node [dg-hueco|dg-contradiccion] dg-link" data-ref="jira-issue:ENG-N" tabindex="0" role="button" aria-label="Abrir ENG-N" [data-note="3"]><rect|polygon …/><text><tspan>ENG-7 Definir la API</tspan><tspan dy="16">de rotación</tspan></text></g>)
- mermaid.min.js y viz.js descargados sólo para medir tamaño y hacer grep (no forman parte de nada)
