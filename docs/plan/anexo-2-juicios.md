<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Los dos juicios cruzados escritos por dos agentes en Opus, independientes entre sí, sobre los seis informes el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# Los dos juicios sobre los seis informes

Dos jueces leyeron los seis informes completos y el código, cada uno por su cuenta, y contestaron a las mismas cuatro preguntas: qué conflictos hay entre áreas, qué hueco no cubre ningún informe, qué hitos y en qué orden, y qué objeciones ponen a las recomendaciones de cada investigador. Están aquí tal cual: docs/PLAN2.md §4 es la reconciliación de los dos.

# Juicio 1

## Conflictos entre áreas

- C + A + B tocan las mismas cuatro funciones del primer uso. bootForSite paso 3 (panel.js:761-764: `fillModels(..., saved?.model || pickDefaultModel(...))`, y en 802 `primeraVez`) recibe la pantalla de modelo de C JUSTO ANTES de la salida a la pantalla de claves de A y B. saveKeys y showManualStep (6806-6925) los reescriben A (PATCH) y B (consejo y «Reintentar»). finishSetup (6929-6990: `verifyCredentials(state.client, { model: state.model, ... })` y `return` si falla) lo toca C con la rama reason 'modelo'. Y el catch de generateContext (7236: `saveSite(host, { onboarded: true })` en cualquier fallo) lo tocan C (no marcar onboarded si el fallo es del modelo) y D (onboarded pasa a «primera configuración» y el mapa pasa a ir por ámbito). Hacerlos a la vez en hitos distintos es garantía de conflictos de fusión y de pines de panel-wiring rotos dos veces (las líneas 326-335 y 609-620 recortan saveKeys → showManualStep → finishSetup con indexOf).
- El PATCH /global/config de A aborta TODOS los turnos en vuelo del proceso de opencode, cierra el SSE /event y rearranca todos los MCP. Esto choca con: (a) la sonda de modelo de C (un turno en sesión desechable); (b) un indexado o un turno en curso; (c) P5, porque state.mcpCheck y state.mcpConnected quedan obsoletos tras el PATCH y el siguiente GET /mcp puede volver a tardar los ~14 s del frío de mcp-atlassian; y (d) otros clientes conectados al mismo serve. Hace falta UNA guarda común, «opencode se está reconfigurando»: NEEDS_IDLE más un estado que suspenda sondas e indexados y reinicie mcpCheck. No puede resolverla cada área por su cuenta.
- A y B cambian los dos buildMcpConfig (setup.js:36-54) y sus pines de claves EXACTAS en setup.test.js. A pone el environment completo, con '' en las claves que no se usan; B sube el timeout de 30000 (setup.js:52) a 60000 y abre las decisiones de fijar versión y de TOOLSETS. Tienen que ir en el mismo hito, o el pin de environment se reescribe dos veces.
- A cree que el PATCH resuelve el «uvx ausente», pero B demuestra que el MCP hereda el `process.env` del opencode arrancado: un uv instalado DESPUÉS sigue sin estar en el PATH aunque se recargue en caliente. La única corrección sin reiniciar es la variante de B, la ruta absoluta a uvx, que con A se aplica sola (reescribir el command y volver a hacer PATCH o connect). A la deja a «el área de uvx» y B a «si el área A escribe». Nadie la posee: tiene que diseñarse junta en el mismo hito.
- Cuatro áreas meten controles nuevos en Ajustes a la vez: C añade «Cambiar el modelo» (btn-change-model), A añade «Quitar las claves de este sitio» junto a btn-edit-keys (panel.html:339), F añade un tercer estilo y «Color del subrayado» con tres muestras, y D añade filas nuevas en «Qué guarda Faro de mí» (N espacios con contexto, N páginas en M espacios). Además el radio «marca el texto en amarillo» (panel.html:304-305) deja de ser verdad con F. A 320 px hay que medir con faroPreview.check() en cada hito, y conviene decidir el orden de las secciones de Ajustes una sola vez.
- Instantáneas de prompts. D añade `contextScope` a baseSystem: 37 intactas y +2 escenarios. E añade una viñeta en Análisis y Búsqueda de Jira que cambia 9 .txt (jira-analisis-* ×6, jira-busqueda* ×3), y cambiaría también los escenarios nuevos de D si D va antes. Si E va primero, D tiene que regenerar sobre los .txt de E. Con el orden D → E sólo hay una regeneración por hito y cada git diff es legible.
- Contrato de almacén. D cambia `getSiteBundle` (claves exactas pinadas ['contextMd','extras','index','memoryRaw','site','stale'] → contextRaw) y la forma de `faro:context:<host>` (de string a objeto) y de `faro:profile:<host>` (a byProject). C añade una clave GLOBAL `faro:model-checks`, que encaja con el patrón de settings y sites, que ya son strings globales en STORAGE_KEYS (config.js:178-180). Las dos pasan por storage.test.js y por la prueba de H13 que cruza STORAGE_AREAS con src/. Hay que hacerlas en hitos distintos para que cada cambio de contrato se revise solo.
- C y D sobre el modelo y la memoria. C hace el modelo GLOBAL (settings.model) y deja saved.model como migración. D deja por host la sesión de opencode y la memoria. Son coherentes, pero §4.2 dice hoy `saveSite({model})` tras cada turno (panel.js:2594) y el pin de C lo quita. Si D va antes y toca `send()`, el conflicto está en el mismo bloque de «al terminar».
- La recuperación por modelo de C (volver a screen-model conservando state.pendingMcp y reintentar finishSetup) necesita que el MCP escrito por A NO se reescriba al reintentar. Si A reescribe en cada finishSetup, cada cambio de modelo provocaría otro PATCH (turnos abortados y 14 s de MCP en frío). El reintento de finishSetup tiene que empezar DESPUÉS de la escritura: separar «escribir» (saveKeys) de «verificar» (finishSetup).
- La cosecha por API de claves del diagrama (E, keysJql) choca con §8.12 y con M4. Hoy JQL_SEARCH tiene exactamente DOS emisores pinados (attachJqlResults y countProfile) y las lecturas «recientes» eligen plantilla por `kind` en bootstrap.js (bootstrap-wiring.test.js). Una tercera procedencia, con claves sacadas de la prosa del modelo, rompe el pin y además la regla M4 («una clave suelta sólo cuenta si su proyecto es conocido»).
- F cambia el mensaje SETTINGS: pushSettings tiene las claves exactas pinadas ['highlightStyle','reduceMotion','timing','type'] (service-worker.test.js:482). No choca con C, que guarda settings.model en el mismo objeto `faro:settings` pero no lo empuja a la página, así que el pin de SEGURIDAD de H6 («la contraseña no viaja») sigue valiendo si nadie añade model a pushSettings. Hay que anotarlo para que C no lo haga por error.

## Huecos que ningún informe cubre

- Nadie ha visto la máquina del compañero. La afirmación «la lista de modelos no son los que ellos tienen» se explica en C por inferencia: /config/providers lista 32 modelos de Copilot y el plan de integrador sólo permite 29. No se ha descartado que su panel apuntara a otro opencode ni que su lista viniera vacía o de otro proveedor. Antes de H16 hay que pedirle a Marco el Registro (la fila «modelos» y «Turno fallido») o una captura de su pantalla.
- Falta una decisión §8 nueva para la ESCRITURA en la configuración de opencode. Con A, Faro pasa de sólo leer GET /config a escribir en ~/.config/opencode/opencode.json. §8.13 dice que las claves viven sólo en la config de opencode, pero no dice qué puede escribir Faro allí. Una puerta que aceptara cualquier parche permitiría meter `agent`, `permission`, `plugin` o `command` (ejecución de código). Hace falta escribirla: sólo la clave `mcp`, sólo entradas con la forma fija de buildMcpConfig, nombre con la forma de mcpNameForHost o el mcpName guardado, command en una lista blanca (`uvx` + `mcp-atlassian[==versión]`, o la ruta absoluta validada de uvx) y nunca cuerpos de respuesta en el registro. Y una prueba SEGURIDAD que lo pine en client.js y setup.js.
- Seguridad del command con ruta absoluta en Windows. B vio el stderr de cmd.exe, así que opencode lanza a través del shell. Una ruta sacada de GET /path con `&`, `^` o comillas podría inyectar. Ningún informe valida la ruta: hay que exigir `^[A-Za-z]:\\[^&|<>^"%]+\\uvx\.exe$` o equivalente.
- El consentimiento para escribir la configuración no está diseñado. A lo deja como decisión, pero no propone qué ve el usuario: una frase en la pantalla de claves con la ruta real de GET /path y el aviso de que la reformatea y de que corta las respuestas a medias.
- Qué pasa con varias instancias de opencode o con el HOME del serve distinto del de la TUI. A lo lista como riesgo, pero no hay ninguna prueba ni ningún texto en la UI que enseñe la ruta escrita.
- «Qué guarda Faro de mí» (H13, §4.11) es por host y no enseña lo GLOBAL nuevo: settings.model y faro:model-checks (los veredictos y los mensajes de error del proveedor). Por §8.20, lo que Faro guarda de la persona se ve y se borra. Falta una fila global y su borrado.
- Ningún informe cubre cómo se ARRANCA opencode en la máquina del compañero: la contraseña, --cors y la terminal nueva tras instalar uv. B sugiere tools/arrancar-opencode.ps1 como opcional, pero sin eso el paso de «Reintentar» no sirve si el command es 'uvx'. Además hay que decidir que el script NUNCA escriba la contraseña en disco.
- No hay plan de verificación en real con un compañero sin uv y con otro plan de Copilot, que son los dos casos que originaron la petición. H14 enseñó que el banco no los reproduce. Hace falta un hito de cierre con esa sesión, con permiso de gasto explícito para la sonda de modelo.
- Integración gratis. A propone un test de integración de escritura con HOME aislado y un MCP de juguete, que no gasta turnos. Encaja con la decisión 3 de §12.3, pero nadie lo sitúa en un hito ni en npm run. Tiene que ir con H17 y quedar fuera de npm run check, como bench y contrast.
- D no dice qué pasa con «Quitar las claves» (A) ni con «Olvidar este sitio» respecto a los contextos por ámbito. El olvido sigue sirviendo porque la clave es la misma, pero la fila de privacidad y el texto del botón deberían decir «N espacios».
- D1 no cubre la búsqueda por título de páginas base contra el Confluence enlazado (searchPages): no filtra ni prefiere espacio. Sólo lo hace el índice (preferSpace).
- E no dice si el diagrama se guarda o sobrevive a «Copiar observaciones». Tampoco dice cómo interactúa con el freno de respuesta corta (NOTE_LIMITS.shortAnswer), que se mide sobre el original con la valla dentro, ni con el anuncio `answerAnnouncement`, que leería el código Mermaid al lector de pantalla si no se quita la valla. He verificado que numberedIn ignora las vallas (notes.js:261, stripFencedCode), así que los [n] de las etiquetas no cambian la detección de análisis nuevo.
- F no verifica la CSP de img-src del Confluence y el Jira reales para el cursor en data:, porque el banco no tiene CSP. Se puede comprobar en real con el método de H14 (módulos como blob en la pestaña): hay que planificarlo.
- El pin de docs del paso «docs» exige un título de registro nuevo por cada log.* nuevo en INSTALL y en §9, y cada área introduce varios: «Modelo elegido», «Modelo comprobado», «Modelo no disponible», «MCP escrito en opencode», «Claves quitadas», «MCP reintentado», «Diagrama». Ningún informe los reúne; cada hito tiene que llevar los suyos.

## Hitos propuestos

### H15 · Instalador de uv y diagnóstico del MCP caído (parte B que no depende del panel nuevo)

tools/instalar.ps1 (y un .sh mínimo si Marco lo quiere): instala uv con el instalador oficial y, si falla, con winget. Refresca el PATH del propio script desde el registro, ejecuta `uv tool install mcp-atlassian==<versión probada>`, comprueba mcp-atlassian y opencode, y avisa en rojo si hay un opencode ya abierto en 4096 («ciérralo y arráncalo desde una terminal NUEVA»). Nunca escribe opencode.json ni la contraseña. Opcional: tools/arrancar-opencode.ps1, que relee el PATH y arranca con --cors (la contraseña sólo en memoria). En Faro, la pura mcpFailureHint(status) en setup.js: «Connection closed» → falta uvx, «timed out after N ms» → primera descarga, otro → texto acotado a una línea. Se cablea SÓLO en showMcpSetup y attachMcpNotice (que H17 no reescribe), con un botón «Reintentar» → connectMcp + GET /mcp, el host capturado y un comando para copiar (sin enlaces externos, por S5). docs/INSTALL.md gana la sección 0 «uv» y cuatro entradas en resolución de problemas (Connection closed, timed out, BOM, {env:} con barras); README cambia sus requisitos. Es la ayuda que desbloquea HOY a los compañeros, sin tocar el flujo de claves.

**Depende de**: nada

**Ficheros**

- tools/instalar.ps1 (nuevo)
- tools/instalar.sh (nuevo, opcional)
- tools/arrancar-opencode.ps1 (nuevo, opcional)
- src/panel/setup.js (mcpFailureHint)
- src/panel/panel.js (showMcpSetup ~1193, attachMcpNotice ~1217)
- src/panel/panel.html (#btn-mcp-retry si hace falta fuera del chat)
- harness/panel-preview.html (el aviso con el consejo a 320 px)
- docs/INSTALL.md
- README.md
- CLAUDE.md §3, §7, §9, §10

**Pruebas**: ~12 nuevas. setup.test.js: mcpFailureHint con los dos mensajes REALES medidos, una línea sin invisibles y ≤200, y basura o connected → null. Nuevo test/unit/instalar.test.js por regex: la misma versión fijada en ps1 y sh, `uv tool install mcp-atlassian==`, el PATH refrescado con GetEnvironmentVariable('Path','User'/'Machine'), ninguna escritura a opencode.json ni a la contraseña, y ningún `npx mcp-atlassian`. panel-wiring: el consejo va detrás del texto «está registrado pero en», que sigue apareciendo una sola vez; connectMcp con el host capturado antes del await, el botón desactivado mientras reintenta y el título «MCP reintentado». Espejo con check() a 320 y 420 px. Sonda manual: un opencode aislado sin uv, «Reintentar» con ruta completa → connected.

**Riesgo**: Bajo. No cambia el formato del bloque ni el flujo de claves. Hay dos riesgos: la política de ejecución de PowerShell con un zip marcado (se mitiga documentando -ExecutionPolicy Bypass) y un proxy corporativo, que no se ha medido.

### H16 · El modelo es de la persona: elegirlo antes de las claves y del contexto, y volver a elegir cuando falla (C)

client.models() gana isDefault, toolcall, status y variants, y lee reasoning de capabilities (hoy siempre sale false). Puras nuevas en models.js: usableModels, recommendModel, classifyModelFailure (plan / credenciales / mudo / transitorio / otro, probada con los tres rawError reales), availableFromError (la lista «Available models» de Copilot, cruzada sólo como lista blanca de ids) y normalizeModelChecks/modelVerdict con reloj inyectado. pickAlternativeModel y pickPlannerModel saltan lo que ya falló (se acaba el bucle openai/gpt-5.4 ⇄ claude-sonnet-4.6). Ajuste global settings.model, con saved.model sólo como migración, y clave global faro:model-checks en STORAGE_KEYS y STORAGE_AREAS 'local'. Pantalla screen-model con .screen-head, un filtro y las filas por proveedor con su veredicto. En bootForSite, tras el paso 3 y ANTES de checkMcp y primeraVez, si no hay modelo resuelto → pantalla y return. Rutas de error: el turno (errorNode con «Elegir otro modelo»), verifyCredentials (devuelve rawError; finishSetup con reason 'modelo' NO culpa a las claves, conserva pendingMcp y vuelve a la pantalla) y generateContext (propagar rawError; con un fallo de modelo NO escribe onboarded:true). Dejar de escribir saved.model tras cada turno. Ajustes gana «Cambiar el modelo». Una fila global en «Qué guarda Faro de mí» con el modelo elegido y los N veredictos, y «Olvidar los veredictos».

**Depende de**: nada

**Ficheros**

- src/shared/models.js
- src/opencode/client.js (models, probeModel opcional, rawError en promptStructured)
- src/shared/config.js (DEFAULT_SETTINGS.model, migrateSettings, STORAGE_KEYS/AREAS.modelChecks, MODEL_LIMITS)
- src/shared/storage.js (getModelChecks/saveModelChecks/recordModelCheck)
- src/panel/setup.js (verifyCredentials con rawError)
- src/panel/indexer.js (propagar rawError desde buildContext)
- src/panel/panel.js (bootForSite paso 3, fillModels 1541-1567, change de #model, 2594, errorNode 2976-3012, send, finishSetup 6929-6990, catch de generateContext 7221-7237, offerNavigation 3334, showSettingsScreen, paintPrivacy, nuevas showModelScreen/paintModelList/useModel/attachModelNotice)
- src/panel/panel.html (section#screen-model, btn-change-model)
- src/panel/panel.css (.model-list/.model-row/.model-why, sin tokens nuevos)
- src/panel/screens.js (según decisión)
- harness/panel-preview.html
- docs/INSTALL.md, README.md, CLAUDE.md §3, §4.1, §4.2, §6, §7, §9, §10

**Pruebas**: ~35. models.test.js +14 (los tres rechazos reales, la lista real de Copilot con los 3 ids no disponibles, los TTL con reloj, que recommendModel no propone nunca uno fallido, el pin del bucle roto). client.test.js +3. settings.test.js +2. storage.test.js +2, con la prueba H13 de áreas cruzada con src y la comprobación de que forgetEverythingFor no la toca. setup.test.js +1. panel-wiring +6: la pantalla antes de checkMcp por posición; finishSetup reason 'modelo' sin siteRecords y con pendingMcp; el catch de generateContext sin onboarded en fallo de modelo; ninguna sonda en el arranque; y que pushSettings sigue sin llevar model (SEGURIDAD). Espejo a 320/420 con el mensaje largo de Copilot. Verificación en real con permiso de gasto.

**Riesgo**: Medio. Es la pantalla nueva del primer uso y el cambio de comportamiento a modelo global. La sonda gasta una request de pago si se hace. Además hay que llevar rawError hasta el catch del indexado.

### H17 · Alta automática del MCP por PATCH /global/config, reintento con ruta absoluta de uvx y «Quitar las claves de este sitio» (A + el resto de B)

client.updateGlobalConfig(patch), con una opción `sensitive` en request: no guarda body en OpencodeError, no registra nada y devuelve sólo `{ok, status, kind}` a partir del `name` del JSON de error. Puras en setup.js: mcpWritePatch(name, config), que valida la forma (decisión §8.24 nueva: sólo `mcp`, command de lista blanca, nombre validado), y mcpScrubPatch (la entrada ENTERA con enabled:false y todas las claves secretas a ''). Además, entradas por host incluidas las deshabilitadas, para reutilizar el nombre, y configFilePath con la preferencia jsonc > json > config.json. buildMcpConfig pasa a llevar el environment completo, timeout 60000 y la versión fijada en el command (decisión). saveKeys: sólo con el panel quieto, con la guarda común «opencode se está reconfigurando» (suspende sondas e indexados y reinicia mcpCheck, mcpConnected y pendingMcp), luego PATCH y waitForMcpReady hasta que la clave APAREZCA (sin un sleep fijo) y conecte. Si falla por «Connection closed» en menos de 1 s, un intento automático con la ruta absoluta validada de uvx (home de GET /path). Si ni aparece, «ya está escrito en <ruta>; reinicia opencode». Si hay 400/500, cae a showManualStep (A3) con «Ya lo he pegado» → PATCH {}. Se separa «escribir» (saveKeys) de «verificar» (finishSetup), para que reintentar tras cambiar de modelo (H16) no vuelva a escribir. configureMcp deja de usar addMcp/connectMcp. Ajustes gana «Quitar las claves de este sitio», con confirmación que LISTA los nombres de las entradas que va a deshabilitar. Integración gratis con HOME aislado y un MCP de juguete (tools/mcp-sandbox.mjs o test/integration/config-write.test.js), fuera de npm run check.

**Depende de**: H15, H16

**Ficheros**

- src/opencode/client.js (request sensitive, updateGlobalConfig)
- src/panel/setup.js (buildMcpConfig, mcpWritePatch, mcpScrubPatch, entradas por host, configFilePath, configureMcp y su comentario)
- src/panel/panel.js (saveKeys 6806-6860, showManualStep 6865-6925, finishSetup, manejador del botón nuevo, guarda común de reconfiguración, showManualStep con mcpFailureHint de H15)
- src/panel/panel.html (botón en Ajustes, texto de la pantalla manual y del consentimiento)
- src/shared/storage.js (si hace falta un helper unlinkMcpRecords)
- test/integration/config-write.test.js o tools/mcp-sandbox.mjs (nuevo)
- harness/panel-preview.html
- docs/INSTALL.md, README.md, CLAUDE.md §4.1, §4.7, §7 (la frase «POST /mcp responde 200 sin hacer nada» es incorrecta), §8 (nueva decisión 24), §9, §10, §12.3

**Pruebas**: ~22. client.test.js +4 (PATCH con el cuerpo exacto; SEGURIDAD: con un 500 ConfigJsonError con tokens, ni body ni el logger los contienen; devuelve true y nunca el Config). setup.test.js +10 (environment completo con claves exactas y ''; el paso Cloud→DC deja USERNAME/API_TOKEN en ''; scrub con la entrada entera y nunca `{enabled:false}` a secas; SEGURIDAD: mcpWritePatch rechaza cualquier clave que no sea mcp, un command fuera de la lista blanca y una ruta con metacaracteres de cmd; configFilePath con los candidatos; configureMcp sin addMcp). panel-wiring +6 (updateGlobalConfig sólo sin turno en vuelo y con el sitio capturado; la guarda de reconfiguración; «Ya lo he pegado»; que el botón nuevo desmarca configured, mcpName, skippedKeys, jiraHost y confluenceHost de TODOS los registros del MCP, no llama a forgetEverythingFor, vacía mcpCheck, mcpWait y pendingMcp, y llama a bootForSite; ningún log.* con la respuesta del PATCH). La integración gratis aislada: 4 casos. Espejo con los estados de espera. En real: con el opencode de Marco (con copia de seguridad del fichero) y con un compañero sin uv.

**Riesgo**: Alto. Escribe en un fichero del usuario que lleva tokens, aborta turnos y rearranca todos sus MCP, y la recarga en caliente de 1.2.25 no está documentada (el aviso «reinicia opencode» es la red). Toda prueba de escritura tiene que hacerse en un opencode aislado: el incidente de OPENCODE_CONFIG_DIR de hoy lo demuestra.

### H18 · Un contexto y un árbol por espacio de Confluence (D1)

Pura nueva src/shared/scopes.js: scopeKeyOf, normalizeContexts con migración idempotente del string de hoy al index.scope guardado, contextFor, withContext, pagesOfSpace, subIndex, stampSpace y linkedSpacesFor. `faro:context:<host>` pasa a ser `{version:2, scopes:{...}}` con la MISMA clave (el olvido de H13 y P4 quedan intactos). getSiteBundle cambia contextMd por contextRaw. refreshTab con `changedScope` sin leer nada del almacén. generateContext guarda bajo host Y ámbito capturados y relee antes de escribir. offerNavigation y sinMapaCard pasan a trabajar por espacio. growTreeFromPage estampa el spaceKey. indexDigest y suggestFromIndex con preferSpace (ordenan, no filtran). La cabecera del contexto dice «(espacio «X»; …)» y es opcional, así que las 37 instantáneas no cambian y se añaden +2. Desde Jira, linkedSpacesFor elige UN espacio del enlazado y nombra los demás en una línea (ver objeción). Tope total del índice por decisión. En el banco, un segundo espacio OPS en cql-eval.mjs y el tramo 63. «Qué guarda Faro de mí» enseña N espacios con contexto.

**Depende de**: H16

**Ficheros**

- src/shared/scopes.js (nuevo) + test/unit/scopes.test.js
- src/shared/storage.js (getSiteBundle contextRaw)
- src/panel/memory.js (getContexts/saveContexts)
- src/panel/panel.js (bootForSite, refreshTab, generateContext, uploadContext, offerNavigation, growTreeFromPage, sourcesIndex, currentReferences, loadLinkedContext, paintPrivacy, estado vacío)
- src/panel/prompts.js (contextScope opcional sin tocar el prefijo de 723)
- src/atlassian/index-store.js (indexDigest preferSpace y tope total opcional)
- src/panel/sources.js (suggestFromIndex preferSpace)
- tools/cql-eval.mjs, harness/harness.js (tramo 63), harness/panel-preview.html
- test/fixtures/prompts/escenarios.js (+2)
- CLAUDE.md §3, §4.6, §6, §10, §12; INSTALL; README

**Pruebas**: ~40. scopes.test.js ~20 (SEGURIDAD: claves de ámbito raras → '*'; __proto__; migración idempotente). storage.test.js +3 (contextRaw con claves exactas, el olvido se lleva el objeto entero). memory.test.js +3. index-store y sources +4 (preferSpace estable). seleccion.test.js +3 (el prefijo conservado; una clave con salto no abre línea). prompt-snapshots +2. panel-wiring +6 (changedScope sin await del almacén; host y ámbito capturados antes del primer await; relectura antes de escribir; pagesOfSpace en vez de indexSize; nadie usa state.contextMd sin contextFor). Tramo 63 del banco. Verificación en real, sólo GET, con SIMPL y DCPIAS como blob.

**Riesgo**: Medio. Es un cambio de forma de una clave persistida, con migración en la lectura. Hay una carrera leer-fundir-escribir entre ámbitos. Y el índice crece sin tope mientras no se decida el tope.

### H19 · Un contexto y un perfil por proyecto de Jira (D2): cierra la decisión 5 de §12.3

scopeKeyOf → 'project:KEY' con el mismo contrato de contextos. `faro:profile:<host>` pasa a `{version:1, byProject:{KEY: perfil v2}}` con normalizeProfiles, migrando el perfil suelto bajo su projectKey. profileForProject busca en el mapa. refreshTab deja de recontar al alternar proyectos (se mantiene la tregua de profileAsked). El indexador de Jira ya es por proyecto. La fila de privacidad dice «N proyectos con perfil».

**Depende de**: H18

**Ficheros**

- src/shared/scopes.js
- src/shared/jira-rest.js (normalizeProfiles, profileForProject)
- src/shared/storage.js (getProfile/saveProfile)
- src/panel/panel.js (currentProfile, refreshProfile, countProfile, paintPrivacy)
- harness/harness.js (tramo 52 con dos proyectos)
- CLAUDE.md §4.7, §6, §10, §12.3

**Pruebas**: ~15. jira-rest.test.js (reescribir la prueba SEGURIDAD de profileForProject, migración, dos proyectos que no se pisan); storage.test.js +2; panel-wiring (pines 2530-2656 actualizados con verdad); tramo 52 con ENG y OPS.

**Riesgo**: Bajo-medio. El contrato y el patrón ya existen tras H18. El perfil v2 guardado se migra sin recontar.

### H20 · Subrayado más bonito y legible: cursor subrayador azul, selección azul, relleno bajo el texto, insignias que no tapan y barra de «Señalar» responsiva (F sin el host de mezcla)

Módulo puro src/content/overlay/cursor.js con los dos SVG de 32×32 y punto activo 5 27. En PICK_CSS: html.faro-picking con cursor url(...) 5 27, text, la variante oscura y ::selection azul sólo dentro de html.faro-picking. Forma A: el relleno pasa a ::highlight(faro-quote) / faro-quote-activa, por debajo del texto, y .quote-rect pasa a ser un trazo en pastilla, lo que arregla el AA en oscuro (3,63 → ≥4,9). El barrido «se dibuja» con scaleX y se anula con faro-still y reduced-motion. Insignias como superíndice que no tapan la palabra siguiente. Barra de «Señalar» con la pista que cede y flex-wrap por debajo de 480 px. Ajuste highlightColor (azul por defecto si Marco lo confirma; ámbar; verde) con tokens de tinta del overlay; insignias y --mark del panel siguen en ámbar, así que los pines de panel-css no cambian. pushSettings gana highlightColor (el pin de claves exactas se cambia a propósito). En forced-colors, outline Highlight. Verificación en real, como en H14, de la CSP de img-src con el cursor en data: y con respaldo `text`.

**Depende de**: nada

**Ficheros**

- src/content/overlay/cursor.js (nuevo) + test/unit/cursor.test.js
- src/content/overlay/styles.js (OVERLAY_CSS, HIGHLIGHT_CSS, PICK_CSS)
- src/content/overlay/overlay.js (_paintNoteBadges, _setHighlight con dos nombres, setTint, setPicking con clase oscura)
- src/content/runner.js, src/content/bootstrap.js:179
- src/shared/config.js (highlightColor), src/background/service-worker.js:304
- src/panel/panel.html:304-305, src/panel/panel.js:6135-6136 y 6687
- test/contrast.js (blendOver ya existe; parejas de texto bajo ::highlight por color y tema) y test/contrast-pairs.js
- harness/harness.js (tramos 20, 22, 27, 41 y 42, y un tramo nuevo de insignias sin solape)
- docs/INSTALL.md, README, CLAUDE.md §3, §6, §8.8, §8.10, §8.11

**Pruebas**: ~18. cursor.test.js 5 (32×32, sin # ni < > crudos, sin script ni on*, ≤2 KB). overlay-wiring +4 (::selection sólo dentro de faro-picking, keyframes anulados, ningún mix-blend-mode inerte en OVERLAY_CSS, los pines de P1 intactos). contrast-pairs: filas de tinta por color × tema ≥4,5 (el enlace anotado, no exigido). settings.test.js +2, service-worker.test.js (claves exactas con highlightColor). Banco: tramo nuevo de insignias sin solape con el carácter siguiente, y el 22 con el cursor y la selección. npm run contrast en verde.

**Riesgo**: Bajo-medio. No hay capa nueva en el documento. Los riesgos son la CSP del cursor en data: y la regresión visual, que no se captura sin frames.

### H21 · Diagramas de flujo en el chat con un renderizador propio de un subconjunto de Mermaid flowchart (E, sin la cosecha por API)

src/panel/diagram-parse.js (parseFlowchart y validateDiagram con claves blancas; se rechazan click, href, style, classDef y %%{init}%%; ref sólo por validIssueKey o id numérico; kind sólo de NOTE_KINDS; toMermaid con ida y vuelta exacta; tolerancia a &, --x/--o e ids con guion). src/panel/diagram-layout.js puro, con una función de medida inyectada (canvas measureText en el panel, estimación en Node). src/panel/diagram-view.js con createElementNS y nunca innerHTML, más una lista equivalente plegada y «Copiar como Mermaid». markdown.js: parseBlocks gana `closed` y renderMarkdown gana onCodeBlock, pasado en las cuatro llamadas del panel igual que allowHref. Un nodo es navegable SÓLO si su ref está ya en el índice (validatePlan + runPlan 'direct', como openIssueFromResults); si no, se pinta sin dg-link. Un [n] llama a focusNote sólo si existe. answerAnnouncement no lee la valla. La viñeta del prompt en Análisis y Búsqueda de Jira, o el botón según la decisión de Marco (9 .txt regenerados). Clases .dg-* sin tokens nuevos y con 4 parejas nuevas en contrast-pairs.

**Depende de**: H18, H19

**Ficheros**

- src/panel/diagram-parse.js, diagram-layout.js, diagram-view.js (nuevos) + tres test/unit nuevos
- src/panel/markdown.js (+ markdown.test.js)
- src/panel/panel.js (las cuatro renderMarkdown, clic de nodo, log «Diagrama», answerAnnouncement sin vallas)
- src/panel/skills.js (viñeta en Jira)
- src/panel/panel.css, test/contrast-pairs.js
- test/fixtures/prompts/*.txt (9)
- harness/panel-preview.html ('.dg-wrap' en CAJAS)
- CLAUDE.md §3, §4.4, §4.7, §6, §9, §10; INSTALL; README

**Pruebas**: ~60. diagram-parse ~25 (con SEGURIDAD), diagram-layout ~12 (el caso de la PoC con 0 cruces, determinista, 30 nodos por debajo del tope de ms), diagram-view ~10 con un document mínimo (sin innerHTML, role/title/desc, tabindex sólo con ref en el índice), markdown +3, panel-wiring +3 (onCodeBlock en las cuatro llamadas, clic por validatePlan sin '/browse/' +, focusNote sólo con la nota existente), skills +2 (Confluence y los otros modos byte a byte), 9 instantáneas. En real: npm run turn sobre un Análisis de una épica, para ver qué variantes escribe gpt-5.6-luna.

**Riesgo**: Medio. La tolerancia del parser a lo que escriben los modelos pequeños (la PoC entiende 5 de 9 casos) y el layout propio en grafos densos. El diagrama cuesta tokens en cada turno de Jira si la viñeta va siempre.

### H22 · Condicionado: estilo «Rotulador» con host de mezcla (F forma B) y grafo de relaciones exacto por la API (E opción 3)

Sólo si Marco los quiere tras ver H20 y H21. (a) Un segundo host fixed con mix-blend-mode multiply/screen para las marcas fuera de código, y existencia sólo mientras haya marcas; se decide con un trace de Performance (p95 de frame) en el banco con scrollStress y stress, antes y después en la MISMA máquina, y se mira en el tema oscuro real. (b) Las relaciones issuelinks de las claves del diagrama por una plantilla fija nueva elegida por `kind` en RECENT_ISSUES (validIssueKey en el content script, sólo proyectos conocidos por M4, sólo Jira DC con restTools), que cosecha en el índice y hace navegables los nodos.

**Depende de**: H20, H21

**Ficheros**

- src/content/overlay/overlay.js, styles.js (MARKS_CSS), overlay-wiring.test.js
- src/shared/jira-rest.js (plantilla), src/content/bootstrap.js (kind nuevo), bootstrap-wiring.test.js, harness

**Pruebas**: (a) overlay-wiring: las marcas de código nunca van al host de mezcla, destroy quita los dos hosts y los pines de P1 se repiten en la capa nueva; banco 27/41/42 con el host nuevo. (b) jira-rest y bootstrap-wiring: plantilla por kind, claves validadas y ninguna consulta leída del mensaje; tramo del banco con issuelinks.

**Riesgo**: Medio-alto en (a) por el coste de GPU sin medir y por la detección del tema de la página. Medio en (b) por §8.12.

### H23 · Cierre y verificación en real con un compañero

Sesión guiada con un compañero SIN uv y con otro plan de modelos. Ejecuta tools/instalar.ps1, arranca opencode desde una terminal nueva, elige el modelo en screen-model (con permiso de gasto de una sonda), las claves se escriben solas, se verifican y se construye el contexto de dos espacios. Luego «Quitar las claves» y volver a crearlas. Registro leído y npm run turn de un Análisis con diagrama. Corrida entera del banco, capturas 2×2 del espejo, CLAUDE.md §12 con la bitácora de H15-H22, y README e INSTALL definitivos.

**Depende de**: H15, H16, H17, H18, H19, H20, H21

**Ficheros**

- CLAUDE.md §12
- README.md
- docs/INSTALL.md
- docs/PLAN.md

**Pruebas**: npm run check ×3, npm run contrast, npm run test:integration (con permiso) y la integración gratis de H17, el banco 1-N con frames de verdad, faroPreview.check() en todas las pantallas nuevas y la verificación en real documentada.

**Riesgo**: Bajo en código. Depende de que Marco consiga la máquina y el tiempo de un compañero.

## Orden y motivo

H15 → H16 → H17 → H18 → H19 → H21, con H20 en un carril paralelo (cuando se quiera, porque sólo toca content/overlay y ajustes), H22 condicionado y H23 de cierre. Los motivos: (1) H15 va primero porque desbloquea HOY a los compañeros (el instalador y un aviso que dice qué falta) sin tocar ni el flujo de claves ni el contrato del MCP, que H17 reescribe. Y porque mcpFailureHint es una pura que H17 reutiliza en vez de inventarla. (2) H16 va antes que H17 porque el fallo que describió el compañero es de MODELO: con el modelo por defecto roto, el alta automática de H17 seguiría acabando en verifyCredentials → reason 'modelo' → «Jira: <error>» y el sitio sin configurar. Sin H16, H17 no arregla lo que se pidió. Además H16 fija dos cosas que H17 necesita: el orden del primer uso (conexión → modelo → claves → contexto) y la separación entre «escribir» y «verificar» en finishSetup, que evita PATCH repetidos al cambiar de modelo. (3) H17 va después porque es el de más riesgo: escribe en un fichero con tokens, aborta turnos y reinicia los MCP. Así entra sobre un primer uso ya estable y con la guarda común de reconfiguración, que suspende la sonda de modelo de H16 y el indexado. (4) H18 va tras H16 porque los dos tocan el catch de generateContext y el significado de onboarded. Primero se arregla que un fallo de modelo no marque el sitio como hecho, y después onboarded pasa a «primera configuración» con el mapa por ámbito. Si fuera al revés, habría que reescribir el mismo bloque dos veces. H19 reutiliza el contrato de H18. (5) H21 va después de H18 y H19 porque los dos cambian prompts: D añade escenarios y contextScope, y E regenera 9 .txt de Jira. Hacer E al final deja una sola regeneración revisable por hito y la viñeta del diagrama entra ya en los escenarios nuevos. (6) H20 es independiente (content script, overlay y pushSettings): puede ir en paralelo con cualquiera, y conviene hacerlo pronto porque es visible y de riesgo bajo. Sólo conviene no fusionarlo a la vez que H16 y H17 por el conflicto de Ajustes (panel.html y el espejo). (7) H22 sólo con medida y con decisión de Marco. (8) H23 cierra con la verificación en real, que es lo que motivó todo esto.

## Decisiones para Marco

- ¿Aceptas que Faro ESCRIBA en ~/.config/opencode/opencode.json por la API de opencode (lo reformatea, corta las respuestas a medias de ese opencode y reinicia sus MCP) para que el alta sea automática? ¿Y quieres una casilla de consentimiento explícito la primera vez o basta con una frase en la pantalla de claves?
- Si Faro escribe solo la configuración, ¿fijamos la versión de mcp-atlassian EN EL COMMAND (`uvx mcp-atlassian==0.23.1`), que da la misma versión a todo el equipo aunque no pasen por el script pero obliga a subirla a mano, o la dejamos sin fijar? ¿Y añadimos TOOLSETS='all' para que un cambio de valor por defecto de mcp-atlassian no quite herramientas?
- Timeout del bloque: ¿60000 o 120000 si el equipo está detrás de un proxy lento?
- «Quitar las claves»: como el MCP es compartido, ¿quita los dos productos enlazados? ¿Deshabilita también entradas que Faro NO creó pero que llevan el dominio (puede que las uses desde otra herramienta)? ¿Te vale que quede en opencode.json una entrada deshabilitada y sin tokens, porque no hay borrado por API?
- Modelo GLOBAL de la persona (recomendado: el segundo sitio no vuelve a preguntar) o por sitio como hoy.
- ¿Comprobar el modelo con una sonda de dos palabras al elegirlo (una request de pago)? ¿O aceptar sin sonda y que el primer turno real (verifyCredentials en el primer uso) haga de prueba, volviendo a la pantalla si falla (coste cero)?
- ¿La pantalla de modelos enseña TODOS los modelos conectados, o esconde los que tienen veredicto de fallo detrás de un «Ver los no disponibles»?
- Al entrar en un espacio del mismo Confluence sin mapa: ¿aviso no bloqueante («DCPIAS aún no tiene mapa · Construir», recomendado) o la pantalla de contexto como la primera vez? ¿Y qué contexto ve el modelo en un espacio sin contexto propio?
- Desde Jira, ¿qué contexto del Confluence enlazado viaja: la regla automática (espacios citados, luego historial, luego el único), o además un selector manual por proyecto «se documenta en el espacio X»?
- Tope total del índice entre espacios (p. ej. 1500 páginas, soltando el espacio indexado hace más tiempo) o sin tope.
- Páginas base y búsqueda por título: ¿el espacio de la pestaña DELANTE sin excluir los demás (recomendado) o sólo el espacio actual? ¿Y se mantiene el paso a paso a una página de otro espacio (hoy funciona)?
- Diagramas: ¿la instrucción va SIEMPRE en Análisis y Búsqueda de Jira (automático, ~120 tokens por turno y 9 instantáneas cambiadas), sólo cuando la pregunta pide dibujar, o con un botón «Dibujar el flujo» bajo la respuesta que deja la pregunta escrita? ¿También en Confluence? ¿Se descarta del todo el MCP de Excalidraw, que no pinta en el chat de Faro?
- ¿«Descargar .excalidraw» además de «Copiar como Mermaid»? Excalidraw ya importa Mermaid pegado.
- Subrayado: ¿las marcas de resultado en azul por defecto (con ámbar y verde a elegir), con las insignias y los botones en ámbar, o todo en ámbar salvo la herramienta de «Señalar»? ¿Tres estilos (Rotulador, Subrayado, Foco) o dos?
- ¿Se hace el estilo «Rotulador» con host de mezcla (H22) aunque cueste GPU sin medir, o basta con la forma A de H20?
- ¿Scripts sólo para Windows (el equipo) o también el .sh para macOS y Linux? ¿Se añade tools/arrancar-opencode.ps1 como forma oficial de arrancar opencode?
- ¿Permiso de gasto para la verificación en real de H23: una sonda de modelo y npm run test:integration?

## Objeciones a las recomendaciones de los informes

- **A · MCP automático** — El borrado localiza TODAS las entradas cuyo JIRA_URL o CONFLUENCE_URL sea el host o el enlazado y las deshabilita con los tokens a ''. Eso incluye entradas que Faro no creó (a mano, o de otro flujo de trabajo del usuario con opencode), y sería destructivo sin que el usuario sepa qué se toca. La justificación («si no, mcpForHost la re-adopta») es real, pero no autoriza a borrar tokens ajenos a ciegas.
  - Alternativa: La confirmación LISTA por nombre cada entrada que se va a deshabilitar. Por defecto sólo se tocan saved.mcpName y las que tienen la forma de mcpNameForHost. Las ajenas exigen una segunda casilla explícita («también «X», que no creó Faro»), y si no se marca se dice que el sitio las seguirá adoptando.
- **A · MCP automático** — El diseño deja «esperar 300 ms (la carrera medida)» como sincronización. Un sleep fijo medido con un MCP de juguete no garantiza nada con mcp-atlassian en frío ni en otra máquina. Además, ni A ni B asumen el caso «uvx instalado después de arrancar opencode»: el PATCH recarga la config pero no el PATH del proceso (verificado en B), así que el camino principal de A falla justo en el caso de los compañeros.
  - Alternativa: Sondear GET /mcp hasta que la clave APAREZCA (acotado a 20 s) en vez de dormir. Si queda failed con «Connection closed» en menos de 1 s, UN reintento automático reescribiendo el command con la ruta absoluta de uvx sacada de GET /path, validada contra metacaracteres de cmd.exe, porque opencode lanza por el shell en Windows. Y si tampoco, el mensaje de H15 con «reinicia opencode desde una terminal nueva».
- **A · MCP automático** — updateGlobalConfig recibe un `patch` genérico. Con Faro escribiendo en la config de opencode, una puerta genérica permitiría meter agent, permission, plugin o command. Es un salto de capacidad que CLAUDE.md §8 no contempla (hoy §8.13 sólo dice dónde viven las claves).
  - Alternativa: Nueva decisión §8.24 y una firma restringida: updateMcpEntry(name, entry), que construye `{mcp:{[name]: entry}}` dentro del cliente tras validar la forma con una pura de setup.js. Nunca un objeto arbitrario. Y una prueba SEGURIDAD que pine que no sale ninguna otra clave raíz.
- **B · uvx** — Fijar la versión sólo en el script (`uv tool install ...==0.23.1`) no protege a quien no lo ejecute: con el alta automática de A, el command `uvx mcp-atlassian` baja la última versión el día de su primer arranque, justo la deriva que la fijación quería evitar. Y el .sh para macOS/Linux duplica mantenimiento para un equipo que por lo visto usa Windows.
  - Alternativa: Si Marco acepta fijar, que la versión vaya en el command que escribe Faro (`uvx mcp-atlassian==X` o `--from`), y el script la precalienta con la MISMA constante (una prueba pina que coinciden). El .sh, sólo si Marco confirma que alguien lo va a usar.
- **B · uvx** — Cablear el consejo en showManualStep (el onTick de panel.js:6899) en el mismo hito que B choca con A, que reescribe showManualStep. Sería trabajo que se tira.
  - Alternativa: En H15, cablearlo sólo en showMcpSetup y attachMcpNotice (que A no reescribe) y dejar la pura lista. El onTick de la espera lo cablea H17 dentro de su nueva espera tras el PATCH.
- **C · modelos** — La sonda al pulsar «Usar este modelo» es redundante en el primer uso: dos pasos después, verifyCredentials hace un turno REAL con ese modelo (panel.js:6956). Añadir la sonda gasta una request de pago más por persona y por elección para dar la misma información unos segundos antes.
  - Alternativa: En el primer uso no hay sonda. El turno de verifyCredentials hace de prueba: con reason 'modelo', se apunta el veredicto gratis (classifyModelFailure + availableFromError) y se vuelve a screen-model conservando pendingMcp. La sonda queda como botón «Comprobar» opcional al cambiar de modelo desde Ajustes, donde no hay un turno inmediato que la sustituya.
- **C · modelos** — C pone la pantalla de modelo «tras el paso 3» sin decir qué pasa si la lista de modelos no llegó: el `else` de panel.js:765-767 sólo muestra un aviso. Tampoco dice cómo convive con P5 (checkMcp en segundo plano) cuando el modelo se resuelve pero el MCP está en frío.
  - Alternativa: Si no hay lista, sale la pantalla de modelo con el mensaje de «sin proveedores» y «Reintentar», no el aviso en el chat. La pantalla de modelo se abre ANTES de lanzar checkMcp, así la comprobación de 14 s no corre bajo una pantalla que puede tardar minutos. Hay que pinarlo por posición.
- **C · modelos** — La clave global faro:model-checks guarda mensajes de error del proveedor (hasta 200 caracteres), que son datos de la persona, pero la vista «Qué guarda Faro de mí» de H13 es por host y no la enseñaría. Eso incumple la promesa de §8.20 («se ve y se borra»).
  - Alternativa: Una sección global en «Qué guarda Faro de mí»: «modelo elegido: X · N veredictos guardados», con «Olvidar los veredictos» (no borra el modelo elegido).
- **D · multi-espacio** — La rama (d) de linkedSpacesFor, «todos, con el presupuesto repartido a partes iguales», mete varios CONTEXT.md recortados en cada turno de Jira. Diluye justo lo que da valor al contexto y pesa más en el system. Y dejar el índice sin tope total mientras persistIndex escribe el objeto entero en cada turno (P3) acerca la cuota de 10 MB con varios espacios.
  - Alternativa: Desde Jira viaja UN solo espacio: el de las reglas (a)-(c). Si no hay regla, el '*' heredado, más una línea de Faro «hay contexto de SIMPL, OPS» (sólo las claves validadas). Y un tope total por defecto (p. ej. 1500 páginas, soltando el espacio indexado hace más tiempo), no dejado sólo como decisión.
- **D · multi-espacio** — La migración asigna el CONTEXT.md de hoy al `index.scope` guardado. Pero D mismo prueba que growTreeFromPage estampa `state.index?.scope` y que el scope del índice puede ser 'confluence-site'. Y D no cubre el caso de un contexto SUBIDO a mano (uploadContext), que no cambia index.scope: podría asignarse a un espacio distinto del que el usuario pretendía.
  - Alternativa: Migrar a '*' siempre que no se pueda afirmar el ámbito con certeza (sin indexedAt coherente con el índice, o subido a mano). '*' se enseña en todos los espacios, que es el comportamiento de hoy y por tanto sin regresión.
- **E · diagramas** — La cosecha de claves del diagrama con una plantilla nueva `issuekey in (A,B,C)` mete una tercera procedencia de consulta con claves sacadas de la PROSA DEL MODELO. Choca con §8.12 (hoy dos emisores de JQL_SEARCH pinados) y con M4 (una clave suelta sólo cuenta con proyecto conocido). El informe no dice por qué mensaje viajaría.
  - Alternativa: En H21 un nodo es navegable sólo si su clave YA está en el índice (normalmente la cosechó growIndex del jira_search del propio turno). La consulta por API, si se quiere, va aparte (H22b) como `kind` nuevo de RECENT_ISSUES, con plantilla elegida por kind en bootstrap.js, validIssueKey en el content script y sólo proyectos conocidos.
- **E · diagramas** — La anchura del texto se estima a 6,6 px por carácter. En el panel hay medida real disponible, y la estimación desborda con CJK, emojis o tipografías distintas por tema del sistema.
  - Alternativa: layout(diagram, {measure}) con la función inyectada: en el panel, canvas measureText con la fuente computada del panel (determinista y sin DOM visible); en Node, la estimación de hoy para las pruebas. El contrato de layout sigue siendo puro.
- **F · subrayado** — La recomendación hace del «Rotulador» con host de mezcla el defecto «tras medir», pero lo mete en el mismo diseño que la forma A. Es la pieza de más riesgo (una segunda raíz en el documento, GPU en cada frame de scroll, y multiply o screen según una detección de tema que puede fallar en zonas mixtas), y no hace falta para lo que pidió el usuario: el cursor azul y que se vea mejor.
  - Alternativa: H20 con cursor, selección, forma A (que ya arregla el AA en oscuro), insignias y barra. El host de mezcla, a un hito condicionado (H22a) con un trace de Performance antes y después en el banco y una prueba en el tema oscuro real.
- **F · subrayado** — Dos ajustes nuevos (un tercer estilo y tres colores) más los que ya hay llenan Ajustes, y los informes A y C también añaden botones ahí. El usuario pidió «más bonito», no más opciones.
  - Alternativa: Un solo control «Color del subrayado» (azul o ámbar), el estilo «Subrayado» de la forma A mejorado como defecto, y «Foco» como opción. El verde y el tercer estilo, sólo si alguien los pide.

# Juicio 2

## Conflictos entre áreas

- A + B + C sobre el PRIMER USO. Los tres reescriben la misma cadena `bootForSite` → `checkMcp`/`primeraVez` (panel.js:802-830) → `saveKeys` (6806) → `showManualStep` → `finishSetup` (6929). C mete una pantalla de modelo ANTES de `checkMcp`, A cambia el final de `saveKeys` por una escritura PATCH, y B cuelga consejos y un «Reintentar» de `showManualStep`, `showMcpSetup` y `attachMcpNotice`. Hecho en tres hitos independientes, cada uno pisa los pines del anterior (panel-wiring.test.js:326-329 y 609-620 recortan por `indexOf` entre `saveKeys`, `showManualStep` y `finishSetup`). Hace falta UNA especificación de la máquina de estados del primer uso (conexión → modelo → claves → escritura → espera → verificación → contexto) antes de tocar código, y el orden de hitos C → B → A.
- A (PATCH /global/config) contra P5 de H14. El PATCH hace `Instance.disposeAll()`: cierra el SSE, aborta los turnos y rearranca TODOS los MCP (≈14 s). La promesa `state.mcpCheck` y el `state.mcpPending` de un arranque anterior pueden resolverse durante ese hueco con «failed» o «ausente», y `onMcpResult` → `showMcpPending` volvería a abrir la pantalla de claves justo después de haberlas escrito, o colgaría «MCP sin conectar» en el chat. Antes de escribir hay que invalidar `state.mcpCheck`, `state.mcpPending` y `state.mcpWait`, y dar a la espera su propio testigo.
- A contra cualquier turno en vuelo, no sólo el del panel. El guardado «sólo con el panel quieto» de A no cubre: el panel de OTRA ventana de Chrome (hay un panel lateral por ventana y todos hablan con el mismo opencode); un `generateContext` que sigue en segundo plano de otro host (§4.6, sigue vivo tras cambiar de sitio); la sonda de modelo de C; y la TUI del usuario si comparte proceso. Todos mueren con el PATCH. Con C, además, la sonda y `verifyCredentials` no pueden solaparse con la escritura.
- C (modelo) contra la verificación de A. Hoy `finishSetup` verifica con `state.model` (panel.js:6955) y un fallo del MODELO sale como «Jira: <mensaje>», es decir, como si fallaran las claves. Si A escribe el MCP automáticamente y el modelo falla, el usuario sigue viendo el bucle del compañero. Por tanto, A no puede cerrarse antes de que C haya separado reason 'modelo' de reason 'claves'.
- C y D sobre el `catch` de `generateContext` (panel.js:7226-7237). C quiere que un fallo por modelo NO escriba `onboarded:true`. D cambia qué significa «tiene mapa» (pasa a ser por ámbito: `scopes[k].indexedAt`) y lo guarda bajo host + ámbito. Hay que decidir una sola semántica. Además, ese mismo `catch` pinta «El indexado falló» ANTES de `restoreConversation()`, que vacía el chat: el aviso nunca se ve (pendiente ya anotado en §12.5 de H2). Es la mitad del «tampoco tenía contexto» del compañero y ningún informe lo nombra.
- D y E regeneran instantáneas de prompts. D añade `contextScope` a la cabecera del contexto en `baseSystem` (+2 escenarios); E añade una viñeta a 9 instantáneas de Jira (análisis ×6, búsqueda ×3). Si van en paralelo, cada `npm run snapshots` se come el diff del otro. Hay que ordenarlos (D antes que E) y revisar cada `git diff` por separado.
- E y F sobre la infraestructura de contraste. E añade 2 parejas TEXTO y 2 CONTROL a `test/contrast-pairs.js`. F añade una tabla TINTAS por color y tema, y una ayuda `blendWith` (multiply/screen) en `test/contrast.js`, que hoy sólo compone source-over. Los dos tocan `panel-css.test.js` y `npm run contrast`. No se contradicen, pero no conviene tocarlos en paralelo.
- F contra el mensaje SETTINGS. Añadir `highlightColor` cambia las claves EXACTAS que pina service-worker.test.js:482 (['highlightStyle','reduceMotion','timing','type']) y la cadena `pushSettings` → bootstrap → runner → overlay. Otro hito que toque ajustes (C con `settings.model` en `DEFAULT_SETTINGS`/`migrateSettings`) edita el mismo bloque de config.js y settings.test.js. Son cambios menores, pero conviene secuenciarlos.
- C (`settings.model` global) contra D (todo por ámbito). C lleva el modelo de ser POR SITIO a ser POR PERSONA (`saved.model` pasa a migración). D deja la memoria y la sesión por host y mueve el contexto a por ámbito. No chocan, pero cada uno migra un campo de `sites[host]` o de `faro:context:<host>`, así que las dos migraciones tienen que ser idempotentes y estar probadas con el registro REAL de Marco (su `saved.model` y su CONTEXT.md string).
- B y A sobre el comando del bloque. B recomienda `['uvx','mcp-atlassian']` con timeout 60000 y una variante con ruta absoluta. A recomienda que al escribir se REUTILICE el nombre y la entrada ya existentes. Si la entrada existente del usuario tiene un command propio (docker, ruta absoluta, versión fijada), la reescritura «completa» de A con el command de Faro lo rompe. Hay que decidir quién manda en el command de una entrada que ya existe.

## Huecos que ningún informe cubre

- Ningún informe especifica el PRIMER USO de punta a punta como un todo (qué ve el compañero en cada paso, cuánto espera, qué pasa si cierra el panel a mitad, qué tras recargar). Es justo donde falló el compañero. Hace falta un diagrama de estados con los caminos de error: sin opencode, contraseña mal, sin proveedores, modelo rechazado, uvx ausente, primera descarga de más de 60 s, PATCH 500, claves malas y MCP conectado pero sin herramientas. Y cada caso con su contraparte visible (§8.14).
- No hay forma automática de probar el panel de punta a punta: `init()` muere en `getSettings` en el banco (§2) y el espejo sólo pinta pantallas rellenas a mano. La nueva máquina de estados del primer uso (tres pantallas encadenadas y esperas de hasta 120 s) sólo quedaría pinada por regex. Propuesta: un arnés en Node que cargue panel.js con un `chrome` y un `document` mínimos, o al menos un modo del espejo que recorra las pantallas en orden y mida cada una.
- La deriva de versión de opencode en los compañeros. Todo está verificado en 1.2.25 y la recarga en caliente por PATCH no está documentada (los PR upstream se cerraron sin fusionar). Nadie propone leer la versión de `GET /global/health` (o equivalente) y avisar con un «opencode X no probado: si el MCP no aparece, reinícialo». Con otra versión, A degrada a «reinicia», pero el compañero no sabrá por qué.
- Precedencia de configuración por proyecto (supuesto, sin verificar): si un compañero pegó el bloque en un `opencode.json` del directorio de trabajo del serve (la configuración de proyecto pesa más que la global), un PATCH global —alta o borrado con `enabled:false`— no cambia la entrada efectiva. `mcpForHost` la seguirá viendo habilitada en `GET /config` (fusionada) y el botón «Quitar las claves» parecerá no hacer nada. Tras escribir hay que releer `GET /config` y comprobar que la entrada efectiva es la escrita; si no, decir «hay otra en <fichero de proyecto>».
- Instalar opencode y Node no está cubierto. B comprueba `opencode --version` pero no lo instala, y el «dale un install con las dependencias» de Marco probablemente incluye opencode (npm i -g opencode-ai) y el arranque con `--cors` y la contraseña. Falta decidir si el script instala también opencode y si genera la contraseña y la deja en la variable de usuario.
- Coste acumulado en turnos de pago del primer uso, que nadie suma: sonda del modelo (1) + `verifyCredentials` por producto (hasta 2, en la misma sesión) + indexado fase 1 (1) + planificador del primer turno. Con Copilot cada uno es una request con multiplicador. Además D añade un turno por espacio nuevo indexado y E alarga cada respuesta de Jira. Hay que decidir el presupuesto y comprobar si la verificación de los dos productos cabe en UN turno.
- La adopción sin verificar tras recargar (panel.js checkMcp → siteRecords sin `verifyCredentials`) se queda como está en todos los informes. Con A es más probable: un compañero con el modelo roto recarga, el MCP escrito se adopta y el sitio queda `configured` con claves NUNCA probadas; el primer fallo de token aparecerá como una fila de herramienta fallida en mitad de un análisis. Falta un `verified:false` en el registro y un aviso hasta la primera verificación buena.
- Migración de los usuarios que ya lo usan (Marco): nadie especifica qué ve Marco al actualizar. Su `saved.model` pasa a global; su CONTEXT.md string migra a `scopes[index.scope]`; su perfil v2 suelto pasa a `byProject`; su entrada de opencode.json NO debe reescribirse si ya funciona; su `highlightStyle` 'spotlight'. Cada migración necesita una prueba con la forma real guardada hoy y la regla de «no pantalla nueva si ya estaba configurado».
- Seguridad de tokens en lecturas, no sólo en escrituras. A propone `sensitive` para el PATCH, pero `GET /config` ya devuelve todos los environment en claro y `client.request` (client.js:113-117) registra 160 caracteres del cuerpo de CUALQUIER error y guarda el body en `OpencodeError`. Un 500 en `GET /config` con un fichero roto (ConfigJsonError trae el fichero entero, verificado por A) acabaría en el Registro. La opción `sensitive` tiene que cubrir también `config()`, y hace falta un test que lo pine.
- El BOM y `{env:}` que tumban opencode al arrancar (verificados por B) llegan al panel como «sin opencode» en la pantalla de conexión, sin pista. Nadie propone que la pantalla de conexión diga «si opencode no arranca, mira su terminal: un opencode.json con BOM…».
- La comprobación de CSP del cursor `data:` en los sitios reales es fácil y nadie la plantea con el método de H14: los módulos se cargaron como blob URL en las pestañas reales, lo que sugiere un `script-src` laxo, pero `img-src` —que es lo que gobierna `cursor: url(data:…)`— no se ha mirado. Es una sonda de solo lectura de un minuto con la misma técnica.
- Diagramas y el formato de Análisis: ningún informe mide si pedir un bloque ```mermaid en Análisis rompe la escalera tan trabajada de §4.4 (numeración, `saysNothingToSay` con «Sin observaciones.» como última línea, freno `shortAnswer` medido sobre la respuesta original con la valla dentro, `formatReminder` que cierra el sistema). Hay que medirlo con `npm run turn` sobre turnos reales antes de tocar el prompt de Análisis.
- Accesibilidad de las pantallas nuevas (modelo con 43 filas y filtro, espera del MCP de hasta 120 s con spinner, confirmación de borrado) y del diagrama SVG: sólo E menciona role/title/desc. Falta decidir cómo se anuncia (`announce`) el progreso largo de la espera sin saturar el lector de pantalla (A2).

## Hitos propuestos

### H15 · Modelos: veredictos, clasificación de fallos y los agujeros del primer uso (sin pantalla nueva)

La parte pura y los arreglos que el bug del compañero exige:
- En models.js: `classifyModelFailure` (plan / credenciales / mudo / transitorio / otro) con los tres rawError reales; `availableFromError` (lista de Copilot); un veredicto a nivel de PROVEEDOR cuando el rechazo es «free tier can only be used from within OpenCode» (un solo 403 marca todo opencode/* sin gastar más); `usableModels`, `recommendModel`, `normalizeModelChecks` y `modelVerdict` con reloj inyectado.
- `pickAlternativeModel` y `pickPlannerModel` saltan los modelos con fallo.
- `client.models()` lee `capabilities` e `isDefault`.
- Clave global `faro:model-checks` (STORAGE_AREAS local) y `settings.model` global con migración desde `saved.model`.
- `verifyCredentials` devuelve rawError, y `finishSetup` con reason 'modelo' NO culpa a las claves ni escribe registros, y conserva `pendingMcp`.
- `generateContext`: un fallo por modelo no escribe `onboarded:true` y el aviso de fallo se enseña DESPUÉS de repintar el chat.
- `fillModels` no asigna un modelo que no está en la lista.
- `errorNode` ofrece «Reintentar con X» sólo si X tiene veredicto ok.
- Todo fallo por modelo en un turno apunta el veredicto gratis.

**Depende de**: nada

**Ficheros**

- src/shared/models.js
- src/opencode/client.js
- src/shared/config.js
- src/shared/storage.js
- src/panel/setup.js
- src/panel/panel.js
- test/unit/models.test.js
- test/unit/client.test.js
- test/unit/settings.test.js
- test/unit/storage.test.js
- test/unit/setup.test.js
- test/unit/panel-wiring.test.js
- CLAUDE.md §6 §7 §9 §10
- docs/INSTALL.md
- README.md

**Pruebas**: ≈30 nuevas, todas en Node y sin turnos:
- `classifyModelFailure` con los tres mensajes reales medidos por C.
- El bucle openai/gpt-5.4 ⇄ claude-sonnet-4.6 ya no ocurre con veredictos.
- Veredicto de proveedor con el 403 de free tier.
- TTL con reloj inyectado.
- `normalizeModelChecks` con basura y `__proto__`.
- `STORAGE_AREAS.modelChecks` cruzado con src (la prueba de H13).
- `forgetEverythingFor` no la toca.
- Migración de `saved.model` idempotente.
- `finishSetup` con 'modelo' sin `siteRecords` y sin la palabra «claves».
- `generateContext` sin `onboarded` en fallo por modelo y con el aviso detrás de `restoreConversation`.
- `npm run check` ×3.

**Riesgo**: Medio. Toca `finishSetup` y el `catch` del indexado, que tienen pines de C5/C2. El comportamiento por sitio del modelo cambia (una decisión de Marco). No gasta turnos: la sonda llega en H16.

### H16 · Pantalla «Elige el modelo» y orden del primer uso (conexión → modelo → claves → contexto)

La pantalla y el orden del primer uso:
- `section#screen-model`: lista agrupada por proveedor, filtro, veredicto por fila, «Usar este modelo» con sonda y «Usar sin comprobar».
- Modo «sin proveedores»: remite a opencode auth login.
- Accesible desde Ajustes («Cambiar el modelo») y desde cualquier error de modelo; en ese caso se vuelve a finishSetup o se reintenta el indexado.
- `client.probeModel` con SAFE_PERMISSIONS, tope de 15 s y abort+delete siempre.
- En `bootForSite`, si no hay modelo resuelto, la pantalla va ANTES de `checkMcp`: se corta el arranque y, al aceptar, se hace un rearranque con testigo nuevo.
- Hay que invalidar `mcpCheck` y `mcpPending` para que un resultado tardío no tape la pantalla.
- Aviso en el chat con «Elegir otro modelo» cuando la pantalla taparía algo (el mismo patrón que `attachMcpNotice`).

**Depende de**: H15

**Ficheros**

- src/panel/panel.html
- src/panel/panel.css
- src/panel/panel.js
- src/panel/screens.js
- src/opencode/client.js
- harness/panel-preview.html
- test/unit/panel-wiring.test.js
- test/unit/screens.test.js
- test/unit/client.test.js
- test/unit/panel-css.test.js (si hay medidas nuevas)
- CLAUDE.md §4.1 §4.2 §9 §10
- docs/INSTALL.md
- README.md

**Pruebas**: - `probeModel` con fetch falso en los tres desenlaces: siempre abort + DELETE.
- Pines por regex:
  - la pantalla va antes de `checkMcp` en el primer uso;
  - ninguna sonda en el arranque;
  - un resultado del MCP tardío no abre la pantalla de claves sobre la de modelo;
  - `errorNode` con «Elegir otro modelo».
- Ids en panel.html.
- Espejo: `screen-model` con el mensaje largo de Copilot, sin proveedores, a 320/420 en claro y oscuro con `faroPreview.check()` en verde.
- Verificación en real con permiso de gasto: openai/gpt-5.4 da 'plan' en menos de 1,5 s; un modelo bueno cuesta una request.

**Riesgo**: Alto. Es la tercera salida del arranque junto a las de claves y contexto, y se cruza con P5 (`mcpPending`, `showMcpPending`, `puedeAbrirPantalla`). Cada sonda buena es una request de pago.

### H17 · uv/uvx: instalador, diagnóstico del MCP caído y «Reintentar»

El instalador y el diagnóstico:
- `tools/instalar.ps1`, más `.sh` si Marco lo quiere: instala uv (oficial → winget), refresca el PATH del script, `uv tool install mcp-atlassian==<fija>`, comprueba opencode y un serve vivo, y avisa de reiniciar desde una terminal NUEVA.
- Nunca escribe opencode.json; si alguna vez escribe algo, en UTF-8 sin BOM.
- En setup.js, `mcpFailureHint(status)` pura: Connection closed → falta uvx; timed out → primera descarga; otro → el texto de opencode en una línea, sin invisibles y con tope de 200.
- La heurística del tiempo: un fallo en menos de 2 s es casi seguro un comando que no existe.
- Botón «Reintentar» con `connectMcp` (bloquea unos 12 s; testigo y host capturados) en `showManualStep`, `showMcpSetup` y `attachMcpNotice`.
- Comando para copiar, sin enlaces externos (S5).
- `timeout` a 60000.
- La pantalla de conexión dice qué mirar si opencode no arranca (BOM, `{env:}`).

**Depende de**: nada

**Ficheros**

- tools/instalar.ps1
- tools/instalar.sh (decisión)
- src/panel/setup.js
- src/panel/panel.js
- src/panel/panel.html
- harness/panel-preview.html
- test/unit/setup.test.js
- test/unit/panel-wiring.test.js
- test/unit/instalar.test.js (nuevo, regex)
- docs/INSTALL.md (sección 0 y resolución de problemas)
- README.md
- CLAUDE.md §3 §7 §9 §10

**Pruebas**: - `mcpFailureHint` con los mensajes reales, más SEGURIDAD: una línea, sin invisibles y null ante basura.
- `timeout` 60000.
- instalar.test.js: la misma versión en .ps1 y .sh, el PATH desde el registro, ninguna escritura a opencode.json, sin `npx mcp-atlassian`.
- Pines del reintento con el host capturado y el botón desactivado.
- «está registrado pero en» sigue apareciendo una sola vez.
- Espejo a 320 px con el comando largo.
- En real: un compañero SIN uv ejecuta el script en la red corporativa y se mide la primera descarga.

**Riesgo**: Bajo-medio. Faro no puede ejecutar nada ni leer el stderr: el diagnóstico es heurístico («casi siempre»). La primera descarga detrás de un proxy corporativo con inspección TLS está sin medir.

### H18 · Creación automática del MCP (PATCH /global/config) con respaldo manual

La escritura automática y su respaldo:
- `client.updateGlobalConfig(patch)` con la opción `sensitive`: no guarda ni registra el cuerpo, devuelve true o `{kind}` sacado del `name` del error. La misma protección se aplica a `config()` y a cualquier error de `request`.
- `mcpWritePatch` con el environment COMPLETO (con '' en lo que no se usa).
- Al actualizar una entrada que YA existe, se conservan su `command`/`type`/`timeout` y sólo se cambia el environment.
- Nombre reutilizado de la entrada existente, contando también las deshabilitadas.
- `configFileCandidates` (jsonc > json > config.json).
- Consentimiento explícito la primera vez: «Faro escribirá en <ruta de GET /path> y opencode reiniciará sus conexiones».
- Antes de escribir: guarda global (sin turno, sin indexado, sin sonda), invalidar `mcpCheck`/`mcpPending`/`mcpWait` y avisar de que se cortan las respuestas de otras ventanas.
- Tras el PATCH:
  - sondear hasta que la entrada APAREZCA (no esperar 300 ms fijos);
  - releer `GET /config` y comprobar que la entrada efectiva es la escrita (una de proyecto puede taparla);
  - `waitForMcpReady` pintando el estado real con `mcpFailureHint`;
  - si falla en menos de 2 s, ofrecer reescribir con la ruta absoluta de uvx.
- Si el PATCH da 400/500, respaldo manual con «Ya lo he pegado» → `updateGlobalConfig({})` para recargar sin reiniciar.
- Después, el `finishSetup` de siempre.
- Se marca `verified:false` si se adopta sin verificar.
- Se quita la llamada a `addMcp`/`connectMcp` de `configureMcp` y se corrige §7.

**Depende de**: H16, H17

**Ficheros**

- src/opencode/client.js
- src/panel/setup.js
- src/panel/panel.js
- src/panel/panel.html
- harness/panel-preview.html
- tools/config-sandbox.mjs (integración GRATIS, fuera de npm run check y de test:integration)
- test/unit/client.test.js
- test/unit/setup.test.js
- test/unit/panel-wiring.test.js
- CLAUDE.md §4.1 §4.7 §7 §8.13 §9 §10 §12
- docs/INSTALL.md
- README.md

**Pruebas**: - SEGURIDAD: con un 500 ConfigJsonError, ni `OpencodeError.body` ni el logger contienen el cuerpo, tampoco en `config()`.
- `mcpWritePatch` con claves exactas.
- Reescritura de una entrada existente sin tocar su `command`.
- Pines:
  - `saveKeys` no escribe con un turno, un indexado o una sonda en vuelo;
  - `mcpCheck`/`mcpPending` se invalidan antes del PATCH;
  - relectura de la entrada efectiva;
  - «Ya lo he pegado» → `updateGlobalConfig({})`.
- `tools/config-sandbox.mjs` con el HOME ENTERO redirigido y la guarda de `GET /path` antes de escribir: MCP de juguete connected en menos de 2 s, fichero roto → sin escritura, `{}` recarga lo pegado a mano. Sin modelo, así que no gasta nada.
- En real con Marco: «Cambiar las claves» sin pegar nada.

**Riesgo**: Alto. Escribe en el fichero con tokens del usuario, lo reformatea y aborta todos los turnos del proceso. La recarga en caliente no está documentada. Es el hito donde un fallo silencioso más cuesta.

### H19 · «Quitar las claves de este sitio» en Ajustes

El botón y lo que hace:
- Con confirmación en línea, que dice que afecta también a <host enlazado> y a CUALQUIER cliente de ese opencode (la TUI incluida).
- `GET /config` → todas las entradas cuyo JIRA_URL/CONFLUENCE_URL sea este host o el enlazado.
- Un PATCH con cada una reescrita ENTERA: su `command`, `enabled:false` y todas las variables a ''.
- Relectura de la entrada efectiva; si sigue habilitada por una config de proyecto, decirlo.
- En `chrome.storage`: `configured:false`, `mcpName:''`, `skippedKeys:false`, `jiraHost`/`confluenceHost:''` en todos los registros de ese MCP. No se toca ni el contexto ni el índice.
- Invalidar `mcpCheck`/`mcpWait`/`pendingMcp` y `bootForSite()`.
- Dos títulos de Registro nuevos.

**Depende de**: H18

**Ficheros**

- src/panel/setup.js (mcpScrubPatch, entradas por host incluidas las deshabilitadas)
- src/panel/panel.js
- src/panel/panel.html
- harness/panel-preview.html
- test/unit/setup.test.js
- test/unit/panel-wiring.test.js
- tools/config-sandbox.mjs
- CLAUDE.md §4.11 §8.13 §10
- docs/INSTALL.md
- README.md

**Pruebas**: - `mcpScrubPatch`: nunca `{enabled:false}` a secas, siempre la entrada completa.
- Pines: no llama a `forgetEverythingFor`, desmarca los dos registros y no hay bucle porque `mcpForHost` salta `enabled:false`.
- En el sandbox: queda «disabled» y con los tokens '' en disco.
- En real con Marco: su opencode.json con la entrada deshabilitada y sin tokens, y la pantalla de claves otra vez.

**Riesgo**: Medio-alto. Deja un esqueleto deshabilitado en opencode.json, porque no hay borrado por API. Deshabilita el MCP para todos los clientes del usuario. El caso de la config de proyecto está supuesto.

### H20 · Varios espacios de Confluence: contexto y «tiene mapa» por espacio (D1)

Opción (iii):
- `src/shared/scopes.js` (puro).
- `faro:context:<host>` pasa a `{version:2, scopes}`, con migración en la lectura hacia `index.scope`.
- `getSiteBundle.contextRaw`.
- `refreshTab` con `changedScope`, sin lectura ni rearranque.
- `generateContext` guarda bajo host + ámbito capturados, releyendo justo antes de escribir.
- `sinMapaCard` y una línea no bloqueante «X aún no tiene mapa · Construir».
- `preferSpace` en `suggestFromIndex` e `indexDigest`.
- `growTreeFromPage` estampa `spaceKey`.
- Cabecera del contexto con el ámbito opcional; sin él, byte a byte igual.
- «Qué guarda Faro de mí» con N espacios.
- Segundo espacio OPS en cql-eval y tramo 63 del banco.
- Desde Jira, el contexto enlazado se elige por referencias citadas y, en su defecto, por un selector manual (ver objeciones).

**Depende de**: H15

**Ficheros**

- src/shared/scopes.js (nuevo)
- src/shared/storage.js
- src/panel/memory.js
- src/panel/panel.js
- src/panel/prompts.js
- src/atlassian/index-store.js
- src/panel/sources.js
- tools/cql-eval.mjs
- harness/harness.js
- harness/panel-preview.html
- test/unit/scopes.test.js
- test/unit/storage.test.js
- test/unit/memory.test.js
- test/unit/panel-wiring.test.js
- test/unit/seleccion.test.js
- test/unit/serve-harness.test.js
- test/fixtures/prompts (+2 escenarios)
- CLAUDE.md §3 §4.6 §6 §10

**Pruebas**: - 35-45 pruebas nuevas, con la migración probada sobre la forma REAL de hoy (un string) y el olvido de H13 intacto.
- Las 37 instantáneas intactas, más 2 nuevas.
- Tramo 63: `subIndex(ENG)` igual al 51, y `treeSteps` desde ENG a OPS empieza por el espacio.
- En real, por el método blob de H14 y sólo con GET: SIMPL y DCPIAS.

**Riesgo**: Medio. Cambia la FORMA de una clave guardada. La escritura concurrente de dos ámbitos del mismo host tiene una ventana de milisegundos. Indexar un segundo espacio en real gasta un turno.

### H21 · Jira por proyecto: contexto y perfil byProject (D2, cierra §12.3 decisión 5)

El mismo contrato de ámbito para Jira:
- `scopeKeyOf` → 'project:KEY'.
- `faro:profile:<host>` → `{version, byProject}`, con migración del perfil v2 suelto.
- `currentProfile` busca en el mapa y ya no se recuenta al alternar entre proyectos.
- El contexto de Jira por proyecto.

**Depende de**: H20

**Ficheros**

- src/shared/jira-rest.js
- src/shared/storage.js
- src/panel/panel.js
- test/unit/jira-rest.test.js
- test/unit/storage.test.js
- test/unit/panel-wiring.test.js
- CLAUDE.md §6 §12.3

**Pruebas**: - `profileForProject` sobre el mapa.
- Dos proyectos que no se pisan.
- Migración.
- `profileAsked` como tregua.
- La prueba SEGURIDAD existente reescrita con verdad.

**Riesgo**: Bajo-medio.

### H22 · Subrayado: cursor subrayador azul, selección azul, marcas legibles e insignias que no tapan (forma A)

Todo lo que no necesita el host de mezcla:
- `src/content/overlay/cursor.js` con un SVG de 32×32, punto activo en 5 27 y respaldo `text`.
- `::selection` azul sólo dentro de `html.faro-picking`.
- Barra de «Señalar» responsive: la pista cede y hay wrap a menos de 480 px.
- `.pick-hover` azul.
- El relleno pasa a `::highlight` (faro-quote y faro-quote-activa), que arregla el AA en oscuro (3,63 → 4,91).
- El trazo en pastilla que se dibuja con scaleX.
- Insignias en superíndice.
- `forced-colors`.
- El texto del radio «en amarillo» se corrige.

**Depende de**: nada

**Ficheros**

- src/content/overlay/cursor.js (nuevo)
- src/content/overlay/styles.js
- src/content/overlay/overlay.js
- src/panel/panel.html (texto del radio)
- test/unit/cursor.test.js
- test/unit/overlay-wiring.test.js
- test/contrast-pairs.js
- harness/harness.js (tramos 20, 22 y uno nuevo)
- CLAUDE.md §3 §8.8-8.11
- docs/INSTALL.md

**Pruebas**: - cursor.test.js: 32×32, sin '#'/'<' crudos, sin on*, tope de 2 KB.
- `::selection` nunca global.
- Los pines de P1 intactos.
- Tramo nuevo: la insignia no se solapa con el rect del carácter siguiente.
- 27, 41 y 42 en verde.
- En real, con GET y el método blob: CSP de `img-src data:` para el cursor en Jira y Confluence.
- Capturas a 1280 y 480 px.

**Riesgo**: Bajo-medio. El cursor puede quedar bloqueado por la CSP (degrada a `text`) y su nitidez al 150 % está sin verificar.

### H23 · «Rotulador» (host de mezcla multiply/screen) y «Color del subrayado» (opcional, tras medir)

Forma B:
- Segundo host con `mix-blend-mode`; el código sigue en la capa normal.
- `highlightColor` azul/ámbar/verde con tokens del overlay y `setTint`.
- Sube de dos a tres estilos y se amplía `pushSettings` (con su pin de claves exactas).
- `blendWith` en test/contrast.js y la tabla TINTAS.
- Sólo pasa a ser el valor por defecto si el trace de Performance con scrollStress/stress no empeora el p95.

**Depende de**: H22

**Ficheros**

- src/content/overlay/overlay.js
- src/content/overlay/styles.js
- src/content/runner.js
- src/content/bootstrap.js
- src/shared/config.js
- src/background/service-worker.js
- src/panel/panel.html
- src/panel/panel.js
- test/contrast.js
- test/contrast-pairs.js
- test/unit/service-worker.test.js
- test/unit/settings.test.js
- test/unit/overlay-wiring.test.js
- harness/harness.js

**Pruebas**: - `blendWith` con los números de la sonda (11,20 y 6,01).
- Claves exactas de SETTINGS con `highlightColor`.
- `destroy()` quita los dos hosts.
- El código nunca va en el host de mezcla.
- Trace de rendimiento en la misma máquina.
- En real con el tema oscuro de su Jira: comprobar `faro-dark` sobre zonas mixtas.

**Riesgo**: Medio. Coste de GPU sin medir. Elegir multiply o screen depende de que `faro-dark` acierte.

### H24 · Diagramas: renderizador propio de flowchart y «Dibujar el flujo»

- `diagram-parse.js` (subconjunto de Mermaid con barrera de claves blancas; se rechazan click/style/classDef/%%{init}%%), `diagram-layout.js` (Sugiyama) y `diagram-view.js` (createElementNS, lista equivalente, «Copiar como Mermaid»).
- `renderMarkdown` gana `onCodeBlock` con `closed` en `parseBlocks`.
- Nodos navegables por `validatePlan`/`runPlan`, y `[n]` → `focusNote`.
- Por defecto SIN cambiar el prompt de Análisis: botón «Dibujar el flujo» bajo una respuesta de Jira que menciona ≥3 claves; deja escrita una pregunta como hace «Preguntar sobre estos».
- Opcional: el grafo EXACTO de issuelinks por una plantilla fija, sin modelo, en Jira DC.

**Depende de**: H20

**Ficheros**

- src/panel/diagram-parse.js
- src/panel/diagram-layout.js
- src/panel/diagram-view.js
- src/panel/markdown.js
- src/panel/panel.js
- src/panel/panel.css
- src/shared/jira-rest.js (opcional)
- test/contrast-pairs.js
- test/unit/diagram-*.test.js
- test/unit/markdown.test.js
- test/unit/panel-wiring.test.js
- harness/panel-preview.html
- CLAUDE.md §3 §4.4 §6 §9 §10

**Pruebas**: - ≈60: parser con sus casos de SEGURIDAD, layout determinista, vista sin innerHTML.
- `onCodeBlock` en las cuatro llamadas a `renderMarkdown`.
- Sin `onCodeBlock` la salida es byte a byte igual.
- Espejo con `.dg-wrap` en CAJAS a 320 px.
- Si se toca el prompt: `npm run snapshots` revisando el diff y `npm run turn` sobre turnos reales de Análisis para comprobar que la numeración no regresa.

**Riesgo**: Medio. La tolerancia del parser a lo que escribe gpt-5.6-luna está sin medir (la PoC entiende 5 de 9 variantes típicas), y cambiar el prompt de Análisis puede degradar §4.4.

### HV · Verificación con un compañero nuevo, de punta a punta

Sesión guiada con un compañero SIN uv y SIN nada configurado, siguiendo el README: instalar.ps1 → arrancar opencode → cargar la extensión → elegir el modelo → claves → MCP automático → verificación → contexto. Después, «Quitar las claves» y volver a crearlas. Se apunta cada tiempo y cada pantalla, y se leen los turnos reales con `npm run turn` (en su máquina) y el Registro.

**Depende de**: H16, H17, H18, H19

**Ficheros**

- CLAUDE.md §12.2
- docs/INSTALL.md (lo que salga)

**Pruebas**: Manual, con el gasto autorizado por Marco.

**Riesgo**: Es lo único que prueba lo que falló de verdad; sin esta sesión, H15-H19 quedan como «probado en Node».

## Orden y motivo

H15 → H16 primero. Marco lo llama «el principal». Además la verificación de claves y el indexado de toda la cadena de alta (A) necesitan un modelo que funcione: sin separar «falla el modelo» de «fallan las claves», automatizar el MCP sólo reproduciría más rápido el bucle del compañero.

H17 (uv) puede ir EN PARALELO a H15, porque apenas comparte ficheros (sólo `showManualStep`/`showMcpSetup`). Tiene que estar antes de H18, porque la espera automática usa `mcpFailureHint` y «Reintentar».

H18 después de H16 y H17: es el de mayor riesgo, escribe en el fichero con tokens del usuario y tiene que encajar en el orden del primer uso ya fijado. H19 va detrás, porque reutiliza la escritura, el `sensitive` y el sandbox.

HV cierra el bloque de alta, antes de seguir con otra cosa.

H20 → H21 (multi-espacio): cambian contratos de almacén y de prompt, y conviene cerrarlos antes de E para regenerar las instantáneas una sola vez por contrato.

H22 es independiente (content script) y de bajo riesgo: puede intercalarse en cualquier momento, incluso en paralelo a H15. H23 sólo después de medir el rendimiento de H22.

H24 al final: es lo más nuevo, depende de que el formato de las respuestas de Análisis esté estable y conviene medirlo con turnos reales, que gastan.

Tamaño: ningún hito debería pasar de ~40 pruebas nuevas. H16 y H18 son los candidatos a partirse si en la revisión adversaria salen más de ~15 hallazgos.

## Decisiones para Marco

- ¿Aceptas que Faro ESCRIBA en ~/.config/opencode/opencode.json por la API de opencode? Hay que asumir tres cosas: reformatea un .json (sangría 2, claves reordenadas), aborta las respuestas en curso de cualquier ventana conectada a ese opencode y rearranca todos sus MCP (≈14 s). ¿Con un consentimiento explícito la primera vez que diga la ruta?
- Cuando ya existe una entrada del MCP para el host (creada a mano, con docker o con una ruta absoluta), ¿Faro conserva su `command` y sólo cambia las variables, o la sustituye por el bloque estándar `['uvx','mcp-atlassian']`?
- «Quitar las claves»: ¿quita los DOS productos enlazados (un solo MCP) y deja una entrada deshabilitada sin tokens en opencode.json? Ten en cuenta que eso deshabilita el MCP también para tu opencode de terminal. ¿O prefieres sólo «Cambiar las claves» con un producto desmarcado?
- Modelo POR PERSONA, global (recomendado: el segundo sitio no vuelve a preguntar), o por sitio como hoy.
- Sonda al pulsar «Usar este modelo» (una request de pago si funciona; los rechazos tardan <1,5 s y, por lo que se sabe, no cuentan) o sólo con un botón «Comprobar» explícito.
- Presupuesto del primer uso en turnos de pago: sonda + verificación de claves + indexado. ¿Intentamos verificar Jira y Confluence en UN turno en vez de dos?
- ¿El instalador incluye también opencode (npm i -g opencode-ai) y un script de arranque con --cors y la contraseña (tools/arrancar-opencode.ps1)? ¿Hace falta la versión .sh o el equipo es todo Windows?
- Versión de mcp-atlassian: ¿fijada (0.23.1) también en el bloque (`uvx mcp-atlassian@0.23.1`) para que todo el equipo tenga la misma aunque no ejecute el script? ¿`TOOLSETS=all` en el environment? ¿timeout de 60 s o 120 s si hay proxy?
- Multi-espacio: al entrar en un espacio sin mapa, ¿aviso no bloqueante (recomendado) o la pantalla de contexto como la primera vez? Y desde Jira, ¿qué contexto de Confluence viaja: el que cite el contexto del proyecto o uno elegido a mano en Ajustes?
- Diagramas: ¿botón «Dibujar el flujo» (recomendado: no toca el prompt de Análisis y no gasta tokens si no se pulsa) o instrucción siempre en Análisis/Búsqueda de Jira? ¿También el grafo exacto de issuelinks leído de la API, sin modelo? ¿Confirmas que se descarta el MCP de Excalidraw porque no pinta en el chat?
- Color: ¿herramienta de «Señalar» en azul y marcas en azul por defecto con ámbar/verde a elegir, e insignias y botones de Faro en ámbar (opción iii)? ¿El «Rotulador» con mezcla pasa a ser el valor por defecto sólo después de medir su rendimiento en tu Jira?
- Orden: ¿modelos primero (el «principal») y uv en paralelo, o prefieres empezar por el instalador porque bloquea antes al compañero?

## Objeciones a las recomendaciones de los informes

- **A · MCP automático** — «Esperar 300 ms (la carrera medida) y luego waitForMcpReady» es un número mágico medido con un MCP de juguete en una máquina rápida. Con 14 s de mcp-atlassian en frío y el SSE cerrado, un GET temprano de la instancia vieja puede dar «ausente» y disparar un «no aparece».
  - Alternativa: Sondear hasta que la entrada APAREZCA en `GET /mcp` (o esperar al evento `server.instance.disposed` del SSE) con su plazo, sin sleep fijo. Además, invalidar `state.mcpCheck`, `state.mcpPending` y `state.mcpWait` antes del PATCH, para que P5 no abra la pantalla de claves con un resultado viejo.
- **A · MCP automático** — La guarda «sólo con el panel quieto» es local a ESTE panel. No ve otras ventanas de Chrome con su panel, ni un `generateContext` en segundo plano de otro host, ni la TUI del usuario si comparte proceso. Todos pierden su turno sin aviso: un fallo silencioso (§8.14) en otra parte.
  - Alternativa: Guarda local más una confirmación que diga «se cortará cualquier respuesta en curso de este opencode». En el primer uso no hay turnos, así que ahí basta la guarda; en «Cambiar las claves» siempre se confirma.
- **A · MCP automático** — La recomendación de reescribir la entrada existente «ENTERA» con el bloque de Faro (reutilizando su nombre) rompería una entrada hecha a mano con docker, una ruta absoluta o una versión fijada, que es justo lo que B propone como respaldo.
  - Alternativa: Si la entrada ya existe, el patch conserva su `type`/`command`/`timeout` y sólo reescribe el environment completo. Sólo una entrada NUEVA lleva el `command` estándar.
- **A · MCP automático** — Da por hecho que un PATCH global cambia la entrada efectiva. Si la entrada vive en una config de proyecto (el opencode.json del directorio del serve), el global no la tapa (supuesto por la precedencia de opencode), y tanto el alta como el borrado parecerían funcionar sin hacerlo.
  - Alternativa: Tras cada escritura, releer `GET /config` (fusionado) y comparar la entrada efectiva con la escrita. Si difiere: «hay otra definición en <ruta de proyecto> que manda; edítala a mano».
- **A · MCP automático** — La opción `sensitive` se propone sólo para el PATCH, pero `GET /config` ya devuelve tokens y `request` registra 160 caracteres del cuerpo de CUALQUIER error (client.js:113-117). Un ConfigJsonError en `GET /config` filtraría el fichero entero al Registro.
  - Alternativa: `sensitive` en `config()`, `updateGlobalConfig` y todo lo que toque la configuración, más una prueba SEGURIDAD que recorra los métodos del cliente que hablan de configuración y exija que ni el logger ni `OpencodeError.body` lleven el cuerpo.
- **B · uvx** — Fijar la versión sólo en `uv tool install` deja a quien no ejecute el script con la última versión del día de su primer uvx: el equipo diverge, y el cambio de TOOLSETS anunciado podría quitar herramientas.
  - Alternativa: Fijarla también en el bloque que Faro escribe (`uvx mcp-atlassian@<versión>`) como constante de setup.js compartida con el script, con un pin que exija la misma versión en los tres sitios.
- **B · uvx** — Con A hecho, lo de «reinicia opencode desde una terminal nueva» como remedio principal de un «Connection closed» se queda corto: Faro puede reescribir la entrada sola.
  - Alternativa: Si el MCP falla en menos de 2 s tras escribirlo, ofrecer un botón «Probar con la ruta completa de uvx» que reescribe el command con `<home de GET /path>\.local\bin\uvx.exe` y hace un PATCH (sin reiniciar). Si también falla, entonces sí el script y el reinicio.
- **C · Modelos** — Tratar los modelos modelo a modelo desaprovecha lo que ya se sabe: el 403 «free tier can only be used from within OpenCode» es del PROVEEDOR opencode entero (§7) y es seguramente la mitad del «no son los que tenemos». Obligar a sondear siete modelos gratuitos para descubrirlo cuesta tiempo y frustración.
  - Alternativa: Un veredicto a nivel de proveedor: el primer rechazo con ese mensaje marca todos los `opencode/*` como «no disponibles desde el servidor», y la pantalla los pliega bajo «No disponibles (N)». No se codifica fijo, porque con una clave de opencode Zen sí funcionarían.
- **C · Modelos** — La sonda separada con éxito cuesta una request de pago, y justo después `verifyCredentials` gasta una o dos más con el mismo modelo.
  - Alternativa: Mantener la sonda (los rechazos son casi gratis y rápidos, que es lo que interesa), pero cachear el ok y reutilizarlo: si la sonda acaba de dar ok, el primer fallo de `verifyCredentials` se clasifica sin dudar como de claves. Y estudiar juntar la verificación de Jira y Confluence en un solo turno.
- **C · Modelos** — Coloca la pantalla de modelo antes de `checkMcp`, pero con `primeraVez` el arranque ESPERA a `checkMcp` (panel.js:810). Si la comprobación arranca en paralelo (P5), su resultado puede llegar con la pantalla de modelo abierta: `puedeAbrirPantalla` dará false y el aviso irá al chat en vez de a la pantalla de claves.
  - Alternativa: En el primer uso sin modelo resuelto, NO lanzar `checkMcp` hasta aceptar el modelo (el rearranque con testigo nuevo lo lanza), o marcar `mcpPending` para enseñarlo al cerrar la pantalla. Y pinarlo.
- **D · Multi-espacio** — La regla (d) de `linkedSpacesFor` (repartir `CONTEXT_BUDGET.linked` a partes iguales entre todos los espacios con contexto) diluye cada contexto a trozos cortados por caracteres. Con cinco espacios el modelo recibiría cinco resúmenes truncados de páginas que no vienen al caso.
  - Alternativa: Quedarse con (a) y (b), y como respaldo un selector en Ajustes («este proyecto se documenta en el espacio X») en vez del reparto. Sin nada de eso, sólo la línea «hay mapa de SIMPL, OPS», sin prosa.
- **E · Diagramas** — Meter la instrucción del bloque ```mermaid en el prompt de Análisis de Jira arriesga la escalera de §4.4, que costó varias revisiones: el freno `shortAnswer`, «Sin observaciones.» como última línea y el recordatorio de formato que cierra el sistema. Además cuesta ~120 tokens en cada turno aunque no se dibuje nada, y los modelos pequeños tienden a obedecer de más.
  - Alternativa: Primero el renderizador y un botón «Dibujar el flujo» (sólo si la respuesta cita ≥3 claves) que deja la pregunta escrita, como «Preguntar sobre estos»: coste cero si no se pulsa y ningún cambio en las 37 instantáneas. Y el grafo EXACTO de issuelinks por la API, sin modelo. Sólo después de leer turnos reales con `npm run turn`, decidir si va en el prompt.
- **F · Subrayado** — Proponer el «Rotulador» (host de mezcla a pantalla completa) como valor por defecto introduce una segunda raíz en el documento, un coste de GPU en cada frame de scroll sin medir y una elección multiply/screen que falla en zonas de tema mixto. Todo ello sobre la parte más frágil y más probada del overlay (P1, tramos 27/41/42).
  - Alternativa: Separarlo: H22 con la forma A (relleno en `::highlight`, trazo, cursor, selección, insignias), que ya arregla el AA en oscuro y el solapamiento, y H23 opcional con el rotulador detrás de un ajuste, que sólo pasa a ser el valor por defecto si el trace de Performance no empeora.
- **F · Subrayado** — Usar el cursor `data:` SVG sin comprobar la CSP `img-src` de los sitios reales puede hacer que el cambio más visible («el ratón es un subrayador») no se vea en Jira ni en Confluence, aunque el banco lo enseñe.
  - Alternativa: Antes de escribirlo, una sonda de sólo lectura en las pestañas reales con el método blob de H14 que aplique el `cursor: url(data:…)` y lea `getComputedStyle`, más la cabecera CSP de la respuesta. Si lo bloquea, servir el SVG desde `web_accessible_resources` (ya expuesto con `use_dynamic_url`) y medirlo igual.
