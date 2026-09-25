<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# C · Modelos por PERSONA, elección del modelo ANTES del contexto y recuperación cuando falla

## Resumen

La lista de modelos YA sale de opencode y es de esa persona (GET /config/providers sólo trae sus proveedores conectados), pero opencode NO distingue los modelos que su plan permite: los 43 dicen status 'active', coste 0 y toolcall true. El defecto de Faro (pickDefaultModel = primer default del mapa) cae en openai/gpt-5.4, que falla, y «Reintentar con…» alterna entre dos defaults que fallan los dos (openai/gpt-5.4 ⇄ github-copilot/claude-sonnet-4.6), verificado con los ids reales. El fallo del compañero se reconstruye así: en el primer uso el único turno es verifyCredentials con ese modelo → reason 'modelo' → finishSetup se para y el sitio no queda configurado; al recargar, checkMcp ADOPTA el MCP por dominio sin ningún turno (por eso «funcionaba»), y si después el indexado falla por el modelo, su catch pone onboarded:true sin contexto. No hay forma de saber sin un turno si un modelo vale, pero un rechazo tarda 0,2-1,3 s y el de Copilot trae la lista ENTERA de modelos disponibles («Available models: [...]»), aprovechable gratis. Recomiendo: pantalla «Elige el modelo» en el primer uso (conexión → modelo → claves → contexto), modelo GLOBAL de la persona en settings.model, sonda de dos palabras al pulsar «Usar este modelo», veredictos cacheados en una clave global faro:model-checks con TTL por motivo, y ante cualquier fallo por modelo (turno, verifyCredentials, indexado) volver a esa pantalla con el modelo marcado y su motivo en vez de saltar a ciegas.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[ejecutado]** GET /config/providers devuelve sólo los 3 proveedores conectados de esta persona: openai (4 modelos), github-copilot (32), opencode (7), con claves id,source,name,env,options,models; source 'custom' en los tres; default = {openai:'gpt-5.4', github-copilot:'claude-sonnet-4.6', opencode:'big-pickle'} en ese orden. Tarda 27-80 ms.
  - Evidencia: scratchpad/area-c/sonda-get.mjs y salida.txt contra opencode serve --port 4151 (sólo GET), 2026-09-26
- **[ejecutado]** GET /provider devuelve {all: 223 proveedores, connected: ['openai','github-copilot','opencode'], default: mapa de los 223}; los tres conectados traen source 'custom' también ahí. No aporta nada que /config/providers no tenga para decidir qué modelo es usable.
  - Evidencia: salida.txt (GET /provider 200, 98 ms)
- **[ejecutado]** Ningún campo del modelo marca si el plan de la persona lo permite: en los 43 modelos status='active', cost.input=0, capabilities.toolcall=true, capabilities.reasoning=true. Esquema Model en /doc: id,providerID,api,name,family,capabilities,cost,limit,status(enum alpha|beta|deprecated|active),options,headers,release_date,variants. Provider tiene además 'key' (no viene en /config/providers de esta instancia) y source enum env|config|custom|api.
  - Evidencia: node sobre /config/providers y doc.json (GET /doc) en scratchpad/area-c
- **[ejecutado]** client.models() lee m.reasoning, que en 1.2.25 no existe (está en m.capabilities.reasoning): el campo reasoning de la lista plana es siempre false. Nadie lo usa.
  - Evidencia: src/opencode/client.js:158-178; grep de .reasoning en src/panel y src/shared sin usos
- **[ejecutado]** GET /config de esta instancia no trae 'model' ni 'small_model' ni enabled/disabled_providers (claves raíz: $schema, mcp, agent, mode, plugin, command, username). Si otra persona tiene 'model' en su opencode.json, Faro hoy lo ignora.
  - Evidencia: salida.txt; src/shared/models.js pickDefaultModel no mira la config
- **[ejecutado]** Rechazos medidos con un turno 'Di solo: ok' en sesión desechable (abort+delete): openai/gpt-5.4 en 802 ms APIError 400 «The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account»; github-copilot/claude-sonnet-4.6 en 204-1313 ms APIError 400 «not available for integrator opencode. Available models: [...]»; opencode/big-pickle en 666 ms APIError 403 «OpenCode's free tier can only be used from within OpenCode». Los tres con isRetryable=false y data con claves message,statusCode,isRetryable,responseHeaders,responseBody,metadata. No se probó ningún modelo que funcione (sería de pago).
  - Evidencia: scratchpad/area-c/sonda-fallos.mjs y sonda-copilot.mjs
- **[ejecutado]** El rechazo de Copilot incluye la lista completa de modelos disponibles para el integrador opencode (57 ids). Cruzada con los 32 de github-copilot que da opencode: 29 están, 3 NO (claude-sonnet-4.6, gpt-5.4-nano, mai-code-1-flash-picker). O sea: el defecto que opencode propone para Copilot es justo uno de los que no se pueden usar.
  - Evidencia: sonda-copilot.mjs + cruce con /config/providers
- **[ejecutado]** Con los ids reales, la elección actual falla en cadena: pickDefaultModel → openai/gpt-5.4 (falla); pickAlternativeModel tras openai → github-copilot/claude-sonnet-4.6 (falla); tras copilot → openai/gpt-5.4 (falla). El botón «Reintentar con X» ofrece siempre otro modelo roto.
  - Evidencia: node sobre src/shared/models.js con las listas reales (scratchpad, comando inline)
- **[ejecutado]** pickPlannerModel elige un modelo 'rápido' por nombre SIN mirar si funciona: con openai/gpt-5.3-codex da openai/gpt-5.3-codex-spark; con github-copilot/gpt-5.6-luna da gpt-5-mini (disponible). Un planificador que cae en un modelo roto sólo se ve como «Sin navegación».
  - Evidencia: misma simulación; src/shared/models.js pickPlannerModel; panel.js:3334
- **[leido-en-codigo]** El arranque rellena el desplegable con saved?.model || pickDefaultModel(...) (panel.js:761-764). saved.model sólo se escribe tras un turno bueno (panel.js:2594), al cambiar el desplegable (panel.js:6514-6519) o al pulsar «Reintentar con» (panel.js:2998-3000). En el primer uso nunca hay saved.model, así que manda pickDefaultModel.
  - Evidencia: src/panel/panel.js:761-764, 2594, 2985-3000, 6514-6519
- **[leido-en-codigo]** fillModels asigna state.model = selected aunque ese modelo ya no esté en la lista; como el <select> no tiene esa opción, el.model.value queda '' y cae en models[0] (orden alfabético por proveedor), así que un saved.model que desapareció cambia de modelo en silencio.
  - Evidencia: src/panel/panel.js:1541-1567
- **[leido-en-codigo]** El <select id='model'> vive en el redactor, dentro de #app, que queda inerte bajo cualquier pantalla: durante la pantalla de claves y la de contexto el usuario NO puede cambiar el modelo.
  - Evidencia: src/panel/panel.html:74; showScreen deja #app inerte (CLAUDE.md §4.1 A1)
- **[leido-en-codigo]** finishSetup comprueba las claves con verifyCredentials(state.client, {model: state.model,...}); si el turno falla por el modelo, verifyCredentials devuelve {ok:false, reason:'modelo'}, finishSetup dice «Jira: <mensaje del modelo>» y hace return: el sitio no se guarda como configured y no se llega a la pantalla de contexto.
  - Evidencia: src/panel/panel.js:6929-6975; src/panel/setup.js verifyCredentials (turn.stalled y turn.error → reason 'modelo')
- **[leido-en-codigo]** Al recargar, bootForSite → checkMcp adopta un MCP conectado que lleva el dominio (mcpForHost) y escribe los registros configured SIN ningún turno de verificación; por eso, en cuanto opencode ya tiene el MCP cargado, recargar 'funciona' aunque el modelo siga roto.
  - Evidencia: src/panel/panel.js:1018-1081 (siteRecords + saveSite sin verifyCredentials)
- **[leido-en-codigo]** Si el indexado (generateContext) falla por el modelo, su catch registra «Indexado fallido» y hace saveSite(host, {onboarded: true}): el sitio queda como hecho y sin CONTEXT.md, que es el «tampoco tenía contexto».
  - Evidencia: src/panel/panel.js:7221-7237
- **[leido-en-codigo]** errorNode sólo ofrece otro modelo si suggestsAnotherModel(rawError) (ProviderAuthError o APIError/mensajes de pasarela) y siempre de OTRO proveedor, sin saber si funciona.
  - Evidencia: src/panel/panel.js:2976-3012; src/opencode/turn.js:395-458
- **[ejecutado]** POST /session/{id}/message acepta messageID, model, agent, noReply, tools, format, system, variant, parts. 'variant' existe (esfuerzo de razonamiento: los modelos traen variants none/low/…) y podría abaratar la sonda.
  - Evidencia: doc.json (GET /doc) de 1.2.25
- **[ejecutado]** GET /provider/auth expone los métodos de login por proveedor (openai: OAuth ChatGPT o API key; github-copilot: OAuth; anthropic; gitlab) y existen PUT/DELETE /auth/{providerID} y POST /provider/{id}/oauth/authorize: técnicamente el panel podría conectar un proveedor, pero es escritura de credenciales (fuera de este diseño).
  - Evidencia: curl GET /provider/auth y doc.json
- **[ejecutado]** El estado de la TUI (~/.local/state/opencode/model.json) guarda 'recent' y 'favorite' de la persona (aquí recent[0] = github-copilot/claude-sonnet-4.6), pero no hay endpoint HTTP que lo exponga y la extensión no lee disco: no sirve como fuente.
  - Evidencia: cat model.json (sólo lectura) + lista de paths de /doc
- **[leido-en-doc]** En Copilot cada petición de chat cuenta como una request con un multiplicador por modelo; la documentación no dice si un rechazo cuenta ni publica aquí qué modelos son 0x.
  - Evidencia: https://docs.github.com/en/copilot/concepts/billing/copilot-requests
- **[leido-en-codigo]** Una sonda que funciona ya se ha medido en integración con github-copilot/gpt-5.6-luna (turno bloqueante de dos palabras con PROBE_MS 15 s); su latencia de éxito no la medí hoy para no gastar un turno de pago.
  - Evidencia: test/integration/opencode.test.js:45, 514-566 (modelCandidates, responde)
- **[ejecutado]** Servidor de sonda arrancado en 127.0.0.1:4151 con la configuración real, sólo GET (y tres turnos que el proveedor rechazó), y matado al terminar (taskkill PID 33836; ningún LISTENING en :4151 después).
  - Evidencia: netstat/taskkill en PowerShell

## Opciones

### A · Sólo arreglar el defecto (sin pantalla nueva)

pickDefaultModel lee config.model si existe y si no pregunta a la caché de veredictos; pickAlternativeModel salta lo que ya falló; se marca el modelo fallido en la caché a partir del propio error. Sin sonda y sin pantalla.

**A favor**

- Muy poco código (models.js + dos llamadas en panel.js)
- No gasta ningún turno

**En contra**

- El primer uso sigue fallando la primera vez: nadie sabe que openai/gpt-5.4 falla hasta que falla
- No cumple lo pedido: el usuario no elige el modelo antes del contexto
- La recuperación sigue siendo adivinar otro proveedor

**Esfuerzo**: S · 2 ficheros de src, ~6 pruebas

### B · Pantalla «Elige el modelo» antes de las claves, sonda al aceptar y caché de veredictos (RECOMENDADA)

Nueva pantalla screen-model en el primer uso (conexión → modelo → claves → contexto) y alcanzable desde Ajustes y desde cualquier error de modelo. Lista agrupada por proveedor, con el predeterminado de opencode y el de su config marcados, veredicto guardado junto a cada modelo. «Usar este modelo» lanza una sonda de dos palabras (15 s, sesión desechable) y sólo avanza si contesta; el veredicto se cachea en faro:model-checks (global) con TTL por motivo. Todo fallo por modelo (turno, verifyCredentials, indexado, planificador) apunta el veredicto gratis y lleva a esta pantalla.

**A favor**

- Cumple las tres peticiones: modelos de la persona, elección antes del contexto, elegir otro en caso de error
- Un solo turno de pago por elección, y ninguno en los arranques siguientes gracias a la caché
- Los rechazos cuestan 0,2-1,3 s y el de Copilot enseña de golpe qué modelos no están disponibles
- Arregla los dos agujeros del primer uso: verifyCredentials ya no culpa a las claves y el indexado no deja onboarded sin contexto

**En contra**

- Una pantalla más en el primer uso
- La sonda de un modelo de pago cuesta una request
- Más superficie: pantalla, caché, sonda y cinco sitios que llaman al modelo

**Esfuerzo**: M-L · ~9 ficheros de src/docs, ~30 pruebas nuevas, espejo y 2 títulos de Registro

### C · Sondear automáticamente todos los modelos (o todos los defaults) al arrancar

Como la integración: probar en paralelo varios candidatos y quedarse con el primero que conteste, sin preguntar.

**A favor**

- Cero decisiones para el usuario

**En contra**

- Gasta N turnos de pago en cada instancia nueva y el usuario no lo ve
- No respeta que el usuario quiera ELEGIR su modelo
- Los mudos bloquean hasta el tope; con 43 modelos es inviable, con 3 defaults sigue siendo coste sin permiso

**Esfuerzo**: M · descartada

## Recomendación del investigador

Opción B. Diseño concreto:

1) FUENTE Y FORMA DE LA LISTA. client.models() sigue leyendo GET /config/providers (es por persona), y gana por modelo: isDefault (es el default de su proveedor en opencode), toolcall (capabilities.toolcall), status, reasoning (arreglado: capabilities.reasoning), variants (las claves). Pura nueva en models.js usableModels(models): fuera status 'deprecated' y toolcall false (Faro necesita herramientas para el MCP), marcadas, no borradas si no queda nada. Se lee además config.model de GET /config (ya se pide en checkMcp; para la pantalla se pide antes, sólo ese campo) como «el que tienes puesto en opencode».

2) PRIORIDAD (decisión para Marco, recomendada): el modelo es de la PERSONA, no del sitio → settings.model global {providerID, modelID} (DEFAULT_SETTINGS.model = null, migrateSettings lo valida con claves blancas). Orden al arrancar: settings.model si está en la lista y su veredicto no es fallo → si no, saved.model del sitio (sólo migración: si vale, se copia a settings.model) → si no, NO se elige solo: se pide la pantalla. saved.model deja de escribirse tras cada turno (panel.js:2594) y el cambio del desplegable escribe settings.model. recommendModel(models, {configModel, defaults, checks}) sólo preselecciona en la pantalla: 1º el último con veredicto ok, 2º config.model, 3º un default de proveedor sin veredicto de fallo, 4º nada.

3) CACHÉ DE VEREDICTOS. Clave global STORAGE_KEYS.modelChecks = 'faro:model-checks' (STORAGE_AREAS 'local'; no es por host, así que forgetEverythingFor no la toca). Forma normalizada: {version:1, server: serverUrl, fingerprint, checks: {'prov/model': {ok, reason, message(≤200, una línea, sin invisibles), at}}}, tope 100. fingerprint = hash de los proveedores conectados y sus ids (si alguien hace opencode auth login y cambia la lista, se invalida entero); server distinto también. reason por la pura classifyModelFailure(rawError, {stalled}): 'plan' (400/403 con not supported|not available|free tier), 'credenciales' (ProviderAuthError/401), 'mudo' (stalled o sin texto), 'transitorio' (429, 5xx, overloaded), 'otro'. TTL: ok 7 días; plan 7 días; credenciales 1 h; mudo 1 día; transitorio 15 min. Extra gratis: availableFromError(rawError) lee «Available models: [...]» de Copilot y marca como 'plan' todos los de ese proveedor que no estén en la lista (en esta máquina, 3 de 32) sin gastar nada.

4) SONDA. client.probeModel(model, {timeoutMs = MODEL_LIMITS.probeMs (15000), signal}): createSession('Faro · probando modelo') con SAFE_PERMISSIONS, prompt bloqueante {text: 'Responde sólo: ok', model, system: 'Es una comprobación de disponibilidad. Contesta sólo «ok». No uses herramientas.', variant: la más barata que el modelo declare entre none|minimal|low}, Promise.race con el tope, y SIEMPRE abort + deleteSession en finally (DELETE no cancela el turno, §7). Devuelve {ok, ms, rawError, reason}. Se lanza SOLO al pulsar «Usar este modelo» o «Comprobar» en la pantalla, nunca en el arranque; un veredicto ok vigente salta la sonda. Coste: un turno corto por elección (rechazo: <1,5 s y, por lo leído, sin consumo; éxito: una request).

5) PANTALLA screen-model (panel.html), con .screen-head (h1 id model-title «Elige el modelo»), párrafo «Estos son los modelos que tu opencode tiene conectados. Faro los usa para todo: contestar, comprobar tus claves y escribir el contexto.», lista id model-list agrupada por proveedor (fieldset por proveedor con legend = nombre, una fila radio por modelo: nombre, «predeterminado de opencode» / «el de tu configuración», y el veredicto: «funciona · hace 2 h», «no disponible con tu plan: <mensaje del proveedor>», «no contesta», «credenciales caducadas: opencode auth login»), filtro de texto id model-filter (43 modelos no caben a 320 px sin buscar), estado id model-status con aria-live vía announce(), botones btn-model-use (primario «Usar este modelo» = sonda + guardar), btn-model-skip-check (ghost «Usar sin comprobar»), y flecha btn-model-close SÓLO cuando se abre desde Ajustes o desde un error (en el primer uso no hay cierre, como setup/context). Sin proveedores conectados: «Tu opencode no tiene ningún proveedor de modelos conectado. Ejecuta opencode auth login en una terminal, reinicia opencode y pulsa Reintentar.» + btn-model-retry. Ajustes gana btn-change-model («Cambiar el modelo»). ESCAPE_CLOSES: 'screen-model' → 'btn-model-close', y el manejador de Escape no hace nada si el botón está oculto (o se deja fuera y se documenta: decisión menor).

6) ORDEN DEL PRIMER USO en bootForSite, tras el paso 3 (modelos cargados): si no hay modelo resuelto en (2) → showModelScreen({motivo:'primera vez'}), medir(), return; al aceptar, saveSettings({model}) + bootForSite() (como hace choice-skip con testigo nuevo). Luego sigue igual: checkMcp → pantalla de claves → verifyCredentials → contexto. Un segundo sitio ya no ve la pantalla (el modelo es global). Si el modelo resuelto tiene veredicto de fallo vigente: la pantalla se abre sola sólo si puedeAbrirPantalla(); si no, aviso en el chat con botón «Elegir otro modelo» (mismo patrón que attachMcpNotice de P5).

7) CAMINOS DE ERROR. (a) Turno normal (panel.js send, ramas stalled y !ok): recordModelCheck gratis con classifyModelFailure + availableFromError; errorNode ofrece «Elegir otro modelo» (abre la pantalla con el fallido marcado y su motivo; al elegir, se reescribe la pregunta en el cuadro sin mandarla) y conserva «Reintentar con X» SÓLO si X tiene veredicto ok vigente. (b) verifyCredentials: devolver también rawError; en finishSetup, si check.reason === 'modelo', NO decir que las claves fallan: «El modelo «X» no ha podido contestar (motivo). Tus claves no se han llegado a probar: elige otro modelo.», recordModelCheck, abrir la pantalla en modo 'setup' conservando state.pendingMcp y, al aceptar, volver a llamar a finishSetup (el MCP ya está cargado). (c) generateContext: si el error es de modelo (hay que propagar rawError en el Error de promptStructured/buildContext; hoy sólo viaja el mensaje) no escribir onboarded:true; abrir la pantalla y ofrecer reintentar el indexado. (d) pickPlannerModel y pickAlternativeModel reciben checks y saltan los fallidos. Mensajes del Registro nuevos: «Modelo elegido», «Modelo comprobado» (ok con ms, o warn con motivo), «Modelo no disponible» (fallo en un turno real).

8) PRUEBAS en el espejo: harness/panel-preview.html gana un botón de pantalla «Elige el modelo» con una lista de mentira de tres proveedores (una fila de cada veredicto: ok, plan con el mensaje real de Copilot, mudo, credenciales, sin comprobar, predeterminado), el modo sin proveedores, y '.model-row' en las CAJAS de check(); medir a 320/420 × claro/oscuro. El veredicto 'plan' con el mensaje largo de Copilot (57 ids) es el caso que desborda si no se recorta: el mensaje se guarda acotado a 200 y la fila lo envuelve.

## Ficheros y pines que toca

- src/shared/models.js: nuevas puras usableModels, recommendModel, classifyModelFailure, availableFromError, normalizeModelChecks, modelVerdict(checks, key, now), modelsFingerprint; pickAlternativeModel y pickPlannerModel con checks; pickDefaultModel queda sólo como fallback o se retira del arranque
- src/opencode/client.js:158-178 models(): isDefault, toolcall, status, variants y reasoning desde capabilities; método nuevo probeModel(model, {timeoutMs, signal}) con abort+delete en finally
- src/shared/config.js: DEFAULT_SETTINGS.model null, migrateSettings valida {providerID, modelID}; STORAGE_KEYS.modelChecks = 'faro:model-checks' y STORAGE_AREAS.modelChecks = 'local'; MODEL_LIMITS {probeMs 15000, ttlOk, ttlPlan, ttlAuth, ttlMute, ttlTransient, maxEntries 100}
- src/shared/storage.js: getModelChecks/saveModelChecks/recordModelCheck (entran y salen por normalizeModelChecks)
- src/panel/setup.js verifyCredentials: devolver rawError en reason 'modelo'
- src/panel/panel.js: bootForSite (resolver modelo tras el paso 3 y cortar con la pantalla), fillModels (marcas de veredicto y predeterminado; no asignar un modelo que no está en la lista), change de #model (settings.model), 2594 (dejar de escribir saved.model), errorNode 2976-3012, send ramas stalled/!ok, finishSetup 6929-6975, generateContext catch 7221-7237, offerNavigation 3334 (planner), showSettingsScreen (btn-change-model), nuevas showModelScreen/paintModelList/useModel/runModelProbe/attachModelNotice
- src/panel/panel.html: section#screen-model con model-title, model-list, model-filter, model-status, btn-model-use, btn-model-skip-check, btn-model-retry, btn-model-close; en Ajustes btn-change-model
- src/panel/panel.css: .model-list, .model-group, .model-row (.ok/.bad/.default/.selected), .model-why; reutilizar tokens y parejas existentes (--muted, --ink-2, --danger sobre --surface) para no tocar test/contrast-pairs.js
- src/panel/screens.js: ESCAPE_CLOSES 'screen-model' → 'btn-model-close' (o fuera, decisión)
- test/unit/models.test.js (12 → ~26): classifyModelFailure con los tres mensajes reales medidos, availableFromError con el de Copilot, modelVerdict y TTL con reloj inyectado, recommendModel, pickAlternativeModel/pickPlannerModel saltando fallidos, y el pin del bucle openai/gpt-5.4 ⇄ claude-sonnet-4.6 que ya no ocurre
- test/unit/client.test.js (+3): models() con capabilities y isDefault; probeModel ok, rechazo y mudo con fetch falso, siempre abort+delete
- test/unit/settings.test.js (+2) y storage.test.js (+2, incluida la prueba de áreas que cruza STORAGE_AREAS con src/)
- test/unit/setup.test.js (+1): verifyCredentials devuelve rawError con reason 'modelo'
- test/unit/panel-wiring.test.js (105 → ~110): pantalla y sus ids, orden del primer uso (modelo antes de checkMcp/claves), finishSetup con reason 'modelo' que no culpa a las claves y conserva pendingMcp, generateContext que no escribe onboarded en fallo de modelo, errorNode con «Elegir otro modelo»; OJO al pin existente de la línea 335 (verifyCredentials(state.client, {…product,)
- test/unit/screens.test.js si entra en ESCAPE_CLOSES
- harness/panel-preview.html: data-screen='screen-model', fixture de modelos con veredictos, '.model-row' en CAJAS
- docs/INSTALL.md (sección «Modelos» y títulos «Modelo elegido», «Modelo comprobado», «Modelo no disponible»), README.md (qué modelos salen y por qué, coste de la sonda), CLAUDE.md §3, §4.1, §4.2, §6 (contrato de faro:model-checks), §7 (hechos medidos: campos del Model, la lista de Copilot en el error, los tres rechazos), §9 (títulos)

## Riesgos y límites

- La sonda de un modelo que funciona gasta una request de pago (Copilot cuenta por petición con multiplicador); por eso sólo al aceptar/comprobar y con caché de 7 días. Que un rechazo no cuente está supuesto, no documentado.
- La lista «Available models» sólo la da Copilot y está en texto libre del mensaje: si GitHub cambia el formato, availableFromError devuelve nada y se pierde sólo la ventaja gratis.
- La sonda manda también el prompt del agente y la definición de todas las herramientas (MCP incluido): las reglas de sesión no las quitan de la lista (§7). Con proveedores de pago por token cuesta como un turno corto; que 'tools' o 'variant' la abaraten está SUPUESTO, sin verificar.
- Un ok de la sonda no garantiza un buen modelo para Faro (numerar, JSON de anclas, herramientas): sólo que contesta. Los problemas de formato siguen en la escalera de §4.4.
- Veredictos caducan por TTL: un cambio de plan en medio no se ve hasta que falle un turno (que lo apunta gratis) o caduque.
- Hacer el modelo global cambia un comportamiento: quien usaba modelos distintos por sitio los pierde (saved.model pasa a migración). Decisión para Marco.
- Una pantalla más en el primer uso; si el usuario no tiene ningún proveedor conectado Faro no puede conectarlo por él (PUT /auth existe, pero es escribir credenciales: fuera).
- No se ha verificado nada de esto en la extensión cargada; la latencia de una sonda con éxito no se midió para no gastar un turno.
- generateContext y promptStructured hoy sólo propagan el mensaje del error: para clasificarlo hay que llevar rawError hasta el catch (cambio pequeño pero en client.js).

## Decisiones que el investigador deja a Marco

- ¿Modelo GLOBAL de la persona (settings.model, recomendado) o por sitio como hoy (saved.model)? Con global, el segundo sitio no vuelve a preguntar.
- ¿Sonda al pulsar «Usar este modelo» (recomendado, una request) o sólo con un botón explícito «Comprobar» y aceptar sin comprobar por defecto?
- ¿Se queda el botón de un clic «Reintentar con X» (sólo si X tiene veredicto ok) o se sustituye entero por «Elegir otro modelo»?
- ¿La pantalla lista TODOS los modelos conectados o sólo los que no tienen veredicto de fallo (con un «Ver los no disponibles»)?
- TTL de los veredictos (propuesta: ok 7 d, plan 7 d, credenciales 1 h, mudo 1 d, transitorio 15 min).
- ¿Escape cierra la pantalla cuando se abre desde Ajustes/error (entra en ESCAPE_CLOSES) o se deja fuera como setup/context?

## Pruebas propuestas

- models.test.js: classifyModelFailure con los tres rawError REALES medidos (openai 400 «not supported…ChatGPT account» → plan; copilot 400 «not available for integrator» → plan; opencode 403 «free tier» → plan) más ProviderAuthError → credenciales, stalled → mudo, 429/502 → transitorio.
- models.test.js: availableFromError con el mensaje real de Copilot marca exactamente claude-sonnet-4.6, gpt-5.4-nano y mai-code-1-flash-picker sobre la lista real de 32; con un mensaje sin lista devuelve null.
- models.test.js: modelVerdict con reloj inyectado respeta cada TTL; normalizeModelChecks con claves blancas, mensaje en una línea sin invisibles, tope 100, otro server/fingerprint → vacío.
- models.test.js: recommendModel no propone nunca un modelo con veredicto de fallo; el bucle openai/gpt-5.4 ⇄ github-copilot/claude-sonnet-4.6 de hoy desaparece con esos veredictos; pickPlannerModel no elige gpt-5.3-codex-spark si está marcado.
- client.test.js: probeModel crea sesión con SAFE_PERMISSIONS, manda variant barata si existe, corta a timeoutMs, y hace abort + DELETE en los tres desenlaces (ok, error, mudo).
- setup.test.js: verifyCredentials con un turno que falla por modelo devuelve reason 'modelo' y rawError.
- panel-wiring.test.js: la pantalla existe con sus ids; en bootForSite la salida a screen-model va antes de checkMcp/pantalla de claves en el primer uso; finishSetup con reason 'modelo' no escribe siteRecords ni dice «claves» y conserva pendingMcp; generateContext no escribe onboarded:true si el error es de modelo; errorNode enseña «Elegir otro modelo»; ningún camino hace sonda en el arranque.
- storage/settings: STORAGE_AREAS.modelChecks = 'local' cruzado con src (la prueba de H13), forgetEverythingFor no la toca, migrateSettings rechaza un model sin forma.
- Espejo: faroPreview.check() en verde con screen-model a 320/420 × claro/oscuro, con la fila del mensaje de Copilot y el modo sin proveedores.
- Verificación en real (manual, con permiso de gasto): opencode aislado sin proveedores → mensaje de opencode auth login; con los del usuario, elegir openai/gpt-5.4 → veredicto 'plan' en <1,5 s; elegir github-copilot/gpt-5.6-luna → ok (una request); primer uso de punta a punta con un modelo roto elegido a propósito en settings → finishSetup lleva a la pantalla y, tras cambiar, el sitio queda configurado CON contexto.

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/area-c/sonda-get.mjs (sólo GET: /config/providers, /provider, /config enmascarado, /path)
- <scratchpad>/area-c/sonda-fallos.mjs (turno de dos palabras contra tres modelos que el proveedor rechaza; abort+delete)
- <scratchpad>/area-c/sonda-copilot.mjs (el rechazo de Copilot con la lista entera)
- <scratchpad>/area-c/salida.txt y doc.json (salidas, sin secretos)

## Los tres rechazos reales, tal como llegaron (recuperados del diario de la investigacion)

Un turno «Di solo: ok» en una sesion desechable (abort + delete) contra el opencode de Marco el 2026-09-25. Los tres son APIError con isRetryable=false y las claves message, statusCode, isRetryable, responseHeaders, responseBody, metadata. Son los mensajes con los que H16 prueba classifyModelFailure.

- openai/gpt-5.4 · 802 ms · statusCode 400 · «Bad Request: … The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.»
- github-copilot/claude-sonnet-4.6 · 204-1313 ms · statusCode 400 · «The requested model is not available for integrator opencode. Available models: [gpt-4.1 claude-fable-5.1 claude-fable-5 claude-opus-4.7 claude-opus-4.8-fast …]» (57 ids en total; la lista ENTERA no quedo guardada: H16 la vuelve a capturar con sonda-copilot.mjs, un turno rechazado)
- opencode/big-pickle · 666 ms · statusCode 403 · «Error from provider (Console): OpenCode's free tier can only be used from within OpenCode»

### sonda-fallos.mjs (copiado tal cual)

```js
// Sonda de modelos que se ESPERA que fallen (rechazo del proveedor, sin coste):
// mide cuánto tarda el rechazo y qué forma tiene el error. Sesión desechable,
// abort + delete siempre. NO se prueba ningún modelo que funcione (sería de pago).
const base = 'http://127.0.0.1:4151'
const modelos = [
  ['openai', 'gpt-5.4'],
  ['github-copilot', 'claude-sonnet-4.6'],
  ['opencode', 'big-pickle'],
]
const req = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  try { return { status: r.status, j: JSON.parse(t) } } catch { return { status: r.status, t } }
}
for (const [providerID, modelID] of modelos) {
  const s = await req('POST', '/session', { title: 'Faro · sonda área C' })
  const id = s.j?.id
  const t0 = Date.now()
  let out
  try {
    const r = await Promise.race([
      req('POST', `/session/${id}/message`, { parts: [{ type: 'text', text: 'Di solo: ok' }], model: { providerID, modelID } }),
      new Promise((res) => setTimeout(() => res(null), 20000)),
    ])
    if (!r) out = 'sin respuesta en 20 s'
    else {
      const e = r.j?.info?.error
      const texto = (r.j?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('')
      out = e ? `ERROR name=${e.name} msg=${String(e.data?.message || '').split('\n')[0].slice(0, 160)} statusCode=${e.data?.statusCode} isRetryable=${e.data?.isRetryable} claves=${Object.keys(e.data || {}).join(',')}` : `texto=${JSON.stringify(texto.slice(0, 40))} tokens=${JSON.stringify(r.j?.info?.tokens)} cost=${r.j?.info?.cost}`
    }
  } catch (err) {
    out = 'excepción ' + err.message
  }
  console.log(`${providerID}/${modelID} · ${Date.now() - t0} ms · ${out}`)
  await req('POST', `/session/${id}/abort`, {})
  await req('DELETE', `/session/${id}`)
}
```

### sonda-copilot.mjs (copiado tal cual)

```js
// Sonda de modelos que se ESPERA que fallen (rechazo del proveedor, sin coste):
// mide cuánto tarda el rechazo y qué forma tiene el error. Sesión desechable,
// abort + delete siempre. NO se prueba ningún modelo que funcione (sería de pago).
const base = 'http://127.0.0.1:4151'
const modelos = [['github-copilot','claude-sonnet-4.6']]; const _x = [
  ['openai', 'gpt-5.4'],
  ['github-copilot', 'claude-sonnet-4.6'],
  ['opencode', 'big-pickle'],
]
const req = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  try { return { status: r.status, j: JSON.parse(t) } } catch { return { status: r.status, t } }
}
for (const [providerID, modelID] of modelos) {
  const s = await req('POST', '/session', { title: 'Faro · sonda área C' })
  const id = s.j?.id
  const t0 = Date.now()
  let out
  try {
    const r = await Promise.race([
      req('POST', `/session/${id}/message`, { parts: [{ type: 'text', text: 'Di solo: ok' }], model: { providerID, modelID } }),
      new Promise((res) => setTimeout(() => res(null), 20000)),
    ])
    if (!r) out = 'sin respuesta en 20 s'
    else {
      const e = r.j?.info?.error
      const texto = (r.j?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('')
      out = e ? `ERROR name=${e.name} msg=${String(e.data?.message || '').split('\n')[0].slice(0, 2000)} statusCode=${e.data?.statusCode} isRetryable=${e.data?.isRetryable} claves=${Object.keys(e.data || {}).join(',')}` : `texto=${JSON.stringify(texto.slice(0, 40))} tokens=${JSON.stringify(r.j?.info?.tokens)} cost=${r.j?.info?.cost}`
    }
  } catch (err) {
    out = 'excepción ' + err.message
  }
  console.log(`${providerID}/${modelID} · ${Date.now() - t0} ms · ${out}`)
  await req('POST', `/session/${id}/abort`, {})
  await req('DELETE', `/session/${id}`)
}
```
