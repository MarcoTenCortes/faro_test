<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# A · Creación automática del MCP de Atlassian en opencode 1.2.25 y su borrado desde Ajustes

## Resumen

En opencode 1.2.25 SÍ se puede crear el MCP sin que el usuario toque ningún fichero ni reinicie: PATCH /global/config {mcp:{nombre:config}} escribe el fichero global Y recarga en caliente (updateGlobal hace Config.global.reset() + Instance.disposeAll() sin await), y el MCP aparece en GET /mcp unos 180-210 ms después con un servidor de juguete (verificado dos veces en un opencode aislado). Lo que vio el orquestador («no recarga») es una carrera: el primer GET justo tras el PATCH todavía contesta la instancia vieja (reproducido). POST /mcp NO es «no hace nada»: arranca el proceso y sus herramientas llegan al modelo (MCP.tools()), pero es sólo en memoria, invisible en GET /mcp (status() filtra por las claves de la config), no se persiste y muere con cualquier dispose; no sirve como camino principal. Borrar: no hay forma HTTP de quitar una entrada (null → 400; {mcp:{}} fusiona y no borra; no hay «opencode mcp remove»); lo que funciona es reescribir la entrada ENTERA con enabled:false y las variables secretas a "" (verificado: queda «disabled» y los tokens fuera del disco). Precios medidos: cada PATCH aborta todos los turnos en vuelo del proceso, cierra el SSE /event y rearranca TODOS los MCP (mcp-atlassian en frío ≈14 s); un fichero con error de sintaxis hace que el 500 devuelva el fichero ENTERO con los tokens en el cuerpo. PATCH /config (proyecto) no sirve: escribe <cwd>/config.json y no se carga. Recomiendo: alta por PATCH /global/config + waitForMcpReady, paso manual sólo como respaldo (con un «ya lo he pegado» que recarga con PATCH {} sin reiniciar), y un botón «Quitar las claves de este sitio» que deshabilita y vacía la entrada y desmarca los dos registros enlazados.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[ejecutado]** El opencode aislado quedó aislado de verdad: GET /path devolvió config=…\scratchpad\areaA\iso7\home\.config\opencode y state=…\iso7\home\.local\state\opencode, y el log sólo cargó config.json/opencode.json/opencode.jsonc de ese HOME. El opencode.json real no se tocó (SHA-256 5178A1C0… idéntico antes y después).
  - Evidencia: scratchpad/areaA/start-iso.ps1 (USERPROFILE, HOME, HOMEDRIVE/HOMEPATH, XDG_*, APPDATA, LOCALAPPDATA redirigidos; exe real en node_modules/opencode-ai/node_modules/opencode-windows-x64/bin/opencode.exe porque `opencode` es un .ps1); salida de GET /path en puerto 4157; Get-FileHash antes/después
- **[ejecutado]** POST /mcp con un MCP local real (toy-mcp.mjs) ARRANCA el proceso y lo conecta: respuesta 200 en 53 ms con {"faro-prueba":{"status":"connected"}}; el log del juguete registra ARRANQUE, initialize, notifications/initialized y tools/list. Pero GET /mcp justo después devuelve {}, GET /config y GET /global/config no lo tienen, no se escribe ningún fichero, y POST /mcp/faro-prueba/connect devuelve true pero el log dice «MCP config not found» y no cambia nada. /experimental/tool/ids sigue con 15 ids (no incluye MCP nunca).
  - Evidencia: node probe.mjs 4157 add; iso7/err.log: «service=mcp key=faro-prueba toolCount=1 create() successfully created client» y «ERROR … name=faro-prueba MCP config not found»
- **[leido-en-codigo]** Por qué: en 1.2.25 MCP.status() recorre SÓLO las claves de cfg.mcp (lo añadido en caliente queda fuera), MCP.connect() exige la entrada en la config, y MCP.tools() recorre TODOS los clientes conectados del estado, así que las herramientas de un POST /mcp sí llegan al modelo (resolveTools usa `await MCP.tools()`). El estado es Instance.state: muere con cualquier dispose.
  - Evidencia: opencode.exe 1.2.25 (grep -a): líneas ~962057 (state2 = Instance.state), ~962140 (add5), 962348 (status), 962365 (connect), 962411 (tools), 963734 (`for (const [key, item] of Object.entries(await MCP.tools()))`)
- **[ejecutado]** PATCH /global/config {mcp:{faro-b:…}} escribe y RECARGA sin reiniciar: faro-b aparece «connected» en GET /mcp a los 178 ms (186 ms desde el PATCH). El PATCH tarda 3-13 ms. Un GET inmediato tras el PATCH puede devolver todavía la instancia vieja ({}), que es lo que explica la observación previa del orquestador.
  - Evidencia: node probe2.mjs 4157 reload; node probe.mjs 4157 patch (GET /mcp justo después → {}, 3 s después → connected); log «disposing all instances … faro-patch … create() successfully created client»
- **[ejecutado]** Mecanismo: Config.updateGlobal escribe globalConfigFile() —el PRIMERO que exista de opencode.jsonc, opencode.json, config.json en Global.Path.config; si no existe ninguno, CREA opencode.jsonc—, fusiona en profundidad (D2) para .json (y reescribe con sangría 2) o parchea texto con jsonc-parser para .jsonc, luego Config.global.reset() y Instance.disposeAll() SIN await.
  - Evidencia: opencode.exe 1.2.25 líneas 966549-966640 (globalConfigFile, patchJsonc, updateGlobal); en iso7 sin fichero previo se creó home/.config/opencode/opencode.jsonc con "$schema" añadido
- **[ejecutado]** Con un opencode.json «escrito a mano» (sangría 4, clave model, otro MCP del usuario con su environment) el PATCH conserva todo lo demás (model, el otro MCP, sus variables), pero reformatea a sangría 2 y reordena las claves de cada entrada al orden del esquema (environment antes de enabled). Una clave desconocida en el fichero hace que el PATCH falle con 500 ConfigInvalidError y NO escriba nada. Los marcadores {env:MI_TOKEN} sobreviven literales en disco (GET /config los devuelve expandidos).
  - Evidencia: node probe3.mjs 4158 (fichero antes/después), node probe4.mjs 4158 (500 unrecognized_keys, fichero intacto), prueba {env:} → disco {"X_TOKEN":"{env:MI_TOKEN}"}
- **[ejecutado]** La respuesta del PATCH /global/config trae la configuración global ENTERA, con el environment de TODOS los MCP en claro (el token de mentira FALSO-1234 del otro MCP estaba en la respuesta).
  - Evidencia: probe3.mjs: «la respuesta trae la config ENTERA, con environment en claro: true»
- **[ejecutado]** Si el fichero global tiene un error de sintaxis, el PATCH devuelve 500 ConfigJsonError cuyo cuerpo (2 227 bytes) contiene el fichero ENTERO, tokens incluidos. El cliente de Faro guarda ese cuerpo en OpencodeError.body y registra sus 160 primeros caracteres con logger.error.
  - Evidencia: node probe5.mjs 4158 → «¿el cuerpo trae el token del fichero (FALSO-5678)? true»; src/opencode/client.js:113-117 (`this.logger?.error(label, res.status + ' ' + String(text).slice(0, 160))` y `{ status: res.status, body: text }`); opencode.exe parseConfig mete `--- JSONC Input --- ${text}` en el mensaje
- **[ejecutado]** Cada PATCH /global/config (y /instance/dispose, /global/dispose) rearranca TODOS los MCP del proceso, no sólo el nuevo (el MCP «otro-del-usuario» cambió de pid), cierra el stream SSE /event tras emitir server.instance.disposed, y aborta todos los turnos en vuelo (el disposer de SessionPrompt hace item.abort.abort()). Las sesiones siguen existiendo (GET /session/:id → 200).
  - Evidencia: probe3.mjs «arranques (FARO_X:pid)»; node probe2.mjs 4157 sse → eventos …, server.instance.disposed, <<STREAM TERMINADO>>; opencode.exe líneas 963066-963073 (SessionPrompt state disposer); el cliente de Faro reconecta el SSE al segundo (client.js:548-573)
- **[ejecutado]** Borrado: PATCH {mcp:{}} no borra nada (fusión); PATCH {mcp:{nombre:null}} → 400 invalid_union; PATCH {mcp:{nombre:{enabled:false}}} → la entrada queda con TODO su environment y status «disabled» a los 170 ms; PATCH {mcp:{nombre:{enabled:false, environment:{…:''}}}} → 400 (una entrada parcial que no es {enabled} solo tiene que llevar type y command); PATCH con la entrada completa {type, command, enabled:false, environment:{JIRA_PERSONAL_TOKEN:''}} → 200, en disco el token queda "" (el resto de variables se conserva por la fusión) y GET /mcp → disabled.
  - Evidencia: node probe2.mjs 4157 borrar-vacio / borrar-null / borrar-disabled; node probe3.mjs y probe4.mjs 4158; esquema Config.mcp.additionalProperties = anyOf[McpLocal|McpRemote, {enabled} con additionalProperties:false] en oc-doc.json
- **[ejecutado]** Una entrada añadida A MANO al fichero global NO la recogen POST /instance/dispose ni POST /global/dispose (la config global está en caché: sólo updateGlobal la resetea), pero sí un PATCH /global/config con cuerpo {}: los dos MCP pegados a mano aparecen «connected» a los 207 ms. O sea, se puede recargar sin reiniciar opencode.
  - Evidencia: node probe6.mjs 4158 /instance/dispose y /global/dispose → «(ausente)» tras 8 s; PATCH {} → p1 y p2 connected a los 207 ms
- **[ejecutado]** PATCH /config (proyecto) escribe <Instance.directory>/config.json (el cwd del serve, o el ?directory=) y ese fichero NO se carga: la entrada no aparece ni en GET /config ni en GET /mcp. Es inútil para Faro y además deja un config.json en el directorio de trabajo del usuario.
  - Evidencia: probe.mjs raw PATCH /config → iso7/work/config.json creado; GET /config mcp keys sin faro-d; opencode.exe 966542-966547 (update3: path.join(Instance.directory, "config.json") + Instance.dispose())
- **[ejecutado]** Un comando que no existe (como uvx ausente) da en GET /mcp {"status":"failed","error":"MCP error -32000: Connection closed"} a los ~190 ms; POST /mcp con él devuelve el mapa de estados con ese failed. La causa real (stderr) sólo está en el log de opencode, no en la API.
  - Evidencia: probe3.mjs pasos 3 y 4; en iso8 el bloque real de Faro (uvx mcp-atlassian, claves falsas) descargó dependencias ~10 s y falló por «Failed to persist temporary file» (muy probablemente la ruta larguísima del HOME aislado): el único rastro está en «mcp stderr» del log
- **[ejecutado]** POST /mcp/{nombre}/connect sobre una entrada que SÍ está en la config vuelve a crearla y es síncrono: tarda lo que tarde el arranque (6 885 ms en el reintento de uvx) y devuelve true aunque haya fallado; el estado real hay que leerlo de GET /mcp después. POST /mcp/{nombre}/disconnect la pone «disabled» sólo en memoria.
  - Evidencia: probe.mjs patch (connect faro-patch → 98 ms, connected); reintento uvx → «connect 200 true 6885 ms» y GET /mcp failed; opencode.exe 962365-962410
- **[ejecutado]** La CLI 1.2.25 tiene `opencode mcp add | list | auth | logout | debug`, sin remove; `mcp add` es interactivo (sin argumentos) y escribe la config global, o la del proyecto si el cwd es un repo git. No sirve a una extensión.
  - Evidencia: opencode mcp --help y mcp add --help; opencode.exe ~704169-704230 (resolveConfigPath, addMcpToConfig, prompts «Location»/«Enter MCP server name»)
- **[ejecutado]** CORS: el preflight OPTIONS de PATCH /global/config con content-type y authorization se acepta (204, Access-Control-Allow-Methods incluye PATCH) para un origen permitido; con --cors chrome-extension://… el panel podrá usarlo como usa POST hoy.
  - Evidencia: curl -X OPTIONS … → 204, Access-Control-Allow-Methods: GET,HEAD,PUT,POST,DELETE,PATCH; opencode.exe 1059664 (cors origin con opts.cors)
- **[leido-en-codigo]** mcp-atlassian trata una variable vacía como ausente (comprobaciones por verdad: `if confluence_url:`, `username = os.getenv("JIRA_USERNAME")` + `not username`), así que escribir "" en las claves que no se usan equivale a no tenerlas.
  - Evidencia: caché local de uv: mcp_atlassian/utils/environment.py:99-101 y 146-148, jira/config.py:243-275
- **[leido-en-doc]** Documentación y versiones posteriores: opencode.ai/docs/mcp-servers no menciona recarga sin reiniciar y dice que para quitar un servidor hay que borrar la entrada a mano (documenta un campo `cwd` que el esquema estricto de 1.2.25 NO acepta). opencode.ai/docs/server describe POST /mcp como «agregar dinámicamente» sin decir que es efímero. Upstream: el issue #49569 (opencode 1.18.31, 17-09-2026) pidiendo hot-reload se cerró «not planned»; los PR #43458 (POST /config/reload) y #43538 (OPENCODE_EXPERIMENTAL_HOT_RELOAD) se cerraron sin fusionar en septiembre de 2026; #4285 igual en 2025. En la rama dev, updateGlobal escribe el mismo fichero global y llama a invalidate(); no he podido verificar si ahí sigue habiendo dispose de instancias.
  - Evidencia: https://opencode.ai/docs/mcp-servers/ · https://opencode.ai/docs/server/ · https://github.com/anomalyco/opencode/issues/49569 · https://github.com/anomalyco/opencode/pull/43458 · https://github.com/anomalyco/opencode/pull/43538 · https://github.com/anomalyco/opencode/pull/4285 · raw dev/packages/opencode/src/config/config.ts
- **[ejecutado]** El opencode.json REAL del usuario está bien tras la prueba de hoy del orquestador: la entrada atlassian-jira-simplprogramme-eu es idéntica a la de la copia opencode.json.faro-bak-2026-09-25 (mismas claves: type, command, environment con JIRA_URL/JIRA_PERSONAL_TOKEN/CONFLUENCE_URL/CONFLUENCE_PERSONAL_TOKEN/READ_ONLY_MODE, enabled, timeout); la copia tenía además faro-prueba-off y faro-prueba-rota, que ya no están. Comprobado sólo por estructura, sin imprimir valores.
  - Evidencia: scratchpad/areaA/compara-claves.mjs y la comparación de la entrada (sólo lectura)
- **[leido-en-codigo]** Hoy Faro nunca manda ?directory= (setDirectory existe pero nadie lo llama), así que todas sus peticiones van a la instancia del cwd del serve; configureMcp llama a addMcp+connectMcp y espera 8 s en GET /mcp, que por lo visto arriba nunca puede ver lo añadido por POST /mcp, así que siempre acaba en showManualStep. configFilePath asume «opencode.json» aunque opencode, sin fichero previo, cree opencode.jsonc.
  - Evidencia: src/opencode/client.js:71-88 y 446-456; src/panel/setup.js:263-283 (comentario «POST /mcp responde 200 pero no tiene ningún efecto», falso en parte) y 286-291; src/panel/panel.js:6806-6860 (saveKeys) y 6865-6925 (showManualStep)

## Opciones

### A1 · PATCH /global/config desde el panel (alta persistente y en caliente)

saveKeys construye el bloque como hoy y lo escribe con client.updateGlobalConfig({mcp:{[nombre]: config}}); después waitForMcpReady con plazo largo enseñando el estado real (connected / failed + error / aún no aparece). Si en N segundos no aparece (otra versión de opencode que no recargue), se dice «ya está escrito en <ruta>; reinicia opencode» sin pedir que se pegue nada.

**A favor**

- Verificado en 1.2.25: el MCP aparece en ~200 ms con un juguete; persiste en disco
- Elimina el paso manual (pegar JSON y reiniciar) que es justo lo que falló a los compañeros
- Las claves siguen sólo en la config de opencode (§8.13 intacta)
- Conserva el resto del fichero del usuario (fusión profunda)
- waitForMcpReady, mcpStatusFor y finishSetup se reutilizan tal cual

**En contra**

- Aborta cualquier turno en vuelo en ESE proceso de opencode (también de otros clientes conectados a él) y cierra el SSE
- Rearranca todos los MCP del usuario (mcp-atlassian ≈14 s en frío)
- Reformatea un opencode.json (sangría 2, orden del esquema); los .jsonc se parchean respetando formato
- La respuesta y los errores 500 llevan tokens en claro: hay que tratarlos como sensibles
- Un fichero que no valida (clave desconocida, sintaxis) bloquea la escritura: 500 y hay que caer al paso manual

**Esfuerzo**: Medio: client.js (1 método + opción sensible), setup.js (2-3 puras), panel.js (saveKeys/espera), tests ~12-15

### A2 · POST /mcp + connect (alta en caliente efímera)

Lo que Faro intenta hoy. Arranca el MCP y sus herramientas llegan al modelo, pero GET /mcp no lo ve, no se escribe en disco, connect no lo reconoce y cualquier dispose (incluido un PATCH) lo mata.

**A favor**

- No toca ningún fichero ni reinicia nada
- La respuesta dice si arrancó (connected/failed) al instante

**En contra**

- Invisible para mcpStatusFor/mcpForHost/checkMcp: el panel creería que no hay MCP
- Se pierde al reiniciar opencode o con el primer PATCH/dispose
- No se puede reconectar tras un fallo; sólo disconnect (queda «disabled» en memoria)
- Duplicaría herramientas si luego se persiste con el mismo host

**Esfuerzo**: Bajo, pero no resuelve el problema; como mucho una comprobación previa opcional (POST /mcp con nombre temporal + disconnect) antes de persistir

### A3 · Paso manual mejorado (respaldo)

Mantener el bloque para pegar, pero con un botón «Ya lo he pegado» que manda PATCH /global/config {} para que opencode relea el fichero sin reiniciar (verificado: 207 ms). Y la ruta sale de GET /path con los mismos candidatos que opencode (jsonc > json > config.json).

**A favor**

- Funciona aunque el fichero del usuario no valide todavía para la API o aunque la escritura por API esté bloqueada
- Quita el «reinicia opencode»

**En contra**

- Sigue pidiendo tocar un fichero con tokens a mano
- PATCH {} también reformatea y también aborta turnos/rearranca MCP

**Esfuerzo**: Bajo: panel.js + setup.js (configFilePath)

### B1 · Borrado: entrada completa deshabilitada y con secretos vacíos

«Quitar las claves de este sitio» en Ajustes: PATCH /global/config con {mcp:{[n]: {type:'local', command:[…el que tenga…], enabled:false, environment:{cada clave secreta:'' , URLs:''}}}} para CADA entrada cuyo JIRA_URL/CONFLUENCE_URL sea este host o el enlazado; luego en chrome.storage configured:false, mcpName:'', skippedKeys:false, jiraHost/confluenceHost:'' en los registros que compartían ese MCP; y bootForSite, que llega a la pantalla de claves por el camino normal.

**A favor**

- Verificado: queda «disabled» y sin tokens en disco
- mcpForHost ya salta enabled:false, así que el arranque no lo vuelve a adoptar (sin bucle)
- El nombre se reutiliza al volver a crear (se sobrescribe por fusión)

**En contra**

- No se puede eliminar la entrada: queda un «esqueleto» deshabilitado en opencode.json (hay que decirlo)
- Mismos efectos colaterales del PATCH (turnos abortados, MCP reiniciados)

**Esfuerzo**: Medio: setup.js (pura scrubPatch), panel.js (manejador + confirmación), panel.html (botón + frase), tests ~6-8

### B2 · Borrado sólo en chrome.storage

Olvidar configured/mcpName y mandar a la pantalla de claves sin tocar opencode.

**A favor**

- Trivial y sin efectos sobre opencode

**En contra**

- No borra nada: mcpForHost encuentra la entrada por dominio en GET /config y la vuelve a adoptar en el siguiente arranque → bucle o botón que no hace nada
- Los tokens viejos siguen activos

**Esfuerzo**: Bajo, pero incorrecto

## Recomendación del investigador

A1 como camino principal, A3 como respaldo y B1 para el borrado. Diseño concreto:

(a) ALTA. client.js: `updateGlobalConfig(patch)` → `request('PATCH', '/global/config', { body: patch, sensitive: true })` y devolver SÓLO `true` (nunca el Config, que lleva los tokens de todos los MCP); la opción `sensitive` hace que `request` no guarde el cuerpo en OpencodeError ni lo registre (hoy client.js:113-117 registra 160 caracteres y guarda body entero; un 500 ConfigJsonError trae el fichero completo). Para distinguir fallos sin leer el cuerpo: devolver `{ok:false, status, kind}` donde kind sale sólo del campo `name` del JSON de error (ConfigJsonError / ConfigInvalidError), parseado y tirado. setup.js: una pura `mcpWritePatch(name, config)` = {mcp:{[name]: config}} con el environment COMPLETO: todas las claves que Faro sabe escribir (JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN, JIRA_PERSONAL_TOKEN y las CONFLUENCE_*) con "" en las que no usa, porque la fusión profunda no puede quitar claves y un cambio Cloud→DC dejaría el USERNAME/API_TOKEN viejo; mcp-atlassian trata "" como ausente (leído). Nombre: si GET /config ya tiene una entrada para este host (mcpForHost, pero en una variante que incluya las deshabilitadas) se reutiliza ESE nombre; si no, mcpNameForHost(host). Así no se duplican servidores ni herramientas. panel.js/saveKeys: sólo con el panel quieto (sin turno ni indexado; guarda como NEEDS_IDLE), avisar en la pantalla de claves de que «opencode reinicia sus conexiones: si tienes una respuesta a medias en otra ventana conectada a este opencode, se corta»; PATCH; esperar 300 ms (la carrera medida) y waitForMcpReady con plazo ~120 s pintando el estado real: «arrancando…», «failed: <error>» con un botón «Reintentar» que manda POST /mcp/{n}/connect (síncrono; leer GET /mcp después) y el enlace a la instalación de uvx (el error de uvx ausente es «Connection closed» a los ~200 ms: la heurística «failed en <1 s» ≈ comando que no existe es del área de uvx). Si en 20 s ni siquiera APARECE la entrada en GET /mcp (versión de opencode que no recargue), mensaje «La configuración ya está escrita en <ruta de GET /path + candidato real>. Reinicia opencode» y se sigue esperando como hoy. Si el PATCH da 500/400: caer a showManualStep (A3) diciendo «tu opencode.json tiene algo que opencode no acepta; lo pego yo aquí y lo añades a mano». Después, finishSetup igual que hoy (verificación por turno con el modelo, siteRecords, saveSite).

(b) configureMcp deja de llamar a addMcp/connectMcp (o, como mucho, POST /mcp con un nombre temporal «faro-comprobacion» + disconnect como comprobación previa de que uvx arranca; opcional y no persistente).

(c) RESPALDO A3: el paso manual se queda, con la ruta calculada como opencode (jsonc > json > config.json en paths.config; configFilePath hoy asume opencode.json) y un botón «Ya lo he pegado» → updateGlobalConfig({}) (recarga verificada sin reiniciar) → waitForMcpReady.

(d) BORRADO B1, botón nuevo en Ajustes → «Este sitio», junto a «Cambiar las claves»: «Quitar las claves de este sitio» con confirmación en línea (texto: «Quita las claves de Jira/Confluence de la configuración de opencode y te vuelve a pedirlas. opencode reinicia sus conexiones.»). Pasos: 1) GET /config y localizar TODAS las entradas cuyo host de JIRA_URL o CONFLUENCE_URL sea este host o el enlazado (saved.jiraHost/confluenceHost), no sólo saved.mcpName: si quedase otra entrada habilitada para el host, mcpForHost la re-adoptaría y el botón parecería no hacer nada; 2) un único PATCH con cada una reescrita ENTERA {type, command (el suyo), enabled:false, environment: mismas claves con ''} (una entrada parcial da 400; {enabled:false} solo deja los tokens en disco); 3) chrome.storage: para cada registro de getSites() con ese mcpName o con esos hosts → saveSite(host, {configured:false, mcpName:'', skippedKeys:false, jiraHost:'', confluenceHost:''}); NO tocar onboarded, índice, contexto ni memoria (no es «Olvidar este sitio»); 4) state.mcpConnected=false, state.mcpCheck=null, state.pendingMcp=null, abortar state.mcpWait; 5) bootForSite(): con configured y skippedKeys a false, primeraVez=true → checkMcp → faltanClaves → pantalla de claves. No hay bucle porque mcpForHost salta enabled:false (setup.js:195). La entrada deshabilitada se reutiliza al volver a crear (misma clave, fusión). «Olvidar este sitio» NO debe tocar opencode (sigue siendo sólo navegador), pero su texto puede remitir al botón nuevo.

(e) HOST ENLAZADO: el MCP es de los dos (siteRecords da el mismo mcpName a Jira y Confluence). Borrar desde cualquiera de los dos quita las claves de ambos productos y desmarca los DOS registros; la confirmación lo dice («también deja sin claves <host enlazado>»). Si se quiere quitar sólo un producto, el camino es «Cambiar las claves» con ese producto desmarcado (el environment completo con "" lo vacía).

(f) RIESGOS y cómo se cubren: tokens en respuestas (sensitive, no devolver el Config, nunca registrar cuerpos; un test que exija que updateGlobalConfig no devuelva ni registre nada del cuerpo); fusión vs reemplazo (siempre entrada completa y environment completo; nunca PATCH de otras claves; nunca /config de proyecto); fichero del usuario reformateado (decirlo una vez en la pantalla de claves; .jsonc se respeta); varias instancias de opencode (sólo recarga el proceso al que habla Faro; otro TUI/serve con su propio proceso seguirá con lo viejo hasta reiniciar; si comparten fichero, gana el último que escribe con lo que leyó al escribir); HOME distinto (Faro escribe en el HOME del proceso serve: enseñar la ruta de GET /path); permisos del fichero: opencode lo escribe con los permisos por defecto del usuario, igual que hoy a mano; versiones futuras: la escritura en disco es estable (dev sigue escribiendo el mismo fichero) pero la recarga no está garantizada → la espera con el mensaje «reinicia opencode» es la red. Ficheros de Faro: src/opencode/client.js (updateGlobalConfig, disconnectMcp opcional, opción sensitive en request), src/panel/setup.js (mcpWritePatch, mcpScrubPatch, entradas por host incluidas las deshabilitadas, configFileCandidates/configFilePath, configureMcp reescrito y su comentario corregido), src/panel/panel.js (saveKeys, showManualStep con «Ya lo he pegado», manejador del botón nuevo, mensajes de espera), src/panel/panel.html (botón y frase en Ajustes; texto de la pantalla manual), storage.js no necesita cambios (saveSite basta) salvo si se quiere una helper `unlinkMcpRecords`; tests: setup.test.js, client.test.js, panel-wiring.test.js; docs: CLAUDE.md §7 (la frase «POST /mcp responde 200 sin hacer nada» es incorrecta), §4.1/§4.7, §8.13, §9 (títulos de registro nuevos, p. ej. «MCP escrito en opencode», «Claves quitadas»), INSTALL y README.

## Ficheros y pines que toca

- src/opencode/client.js:90-125 (request: registra 160 chars del cuerpo de error y guarda body → añadir opción sensitive), 446-456 (listMcp/addMcp/connectMcp; añadir updateGlobalConfig y disconnectMcp)
- src/panel/setup.js:36-54 (buildMcpConfig: environment completo con ''), 189-216 (mcpForHost salta enabled:false: es lo que evita el bucle al borrar; hará falta una variante que incluya las deshabilitadas para reutilizar el nombre), 263-283 (configureMcp y su comentario, que hay que corregir), 286-291 (configFilePath asume opencode.json; opencode crea opencode.jsonc si no hay ninguno)
- src/panel/panel.js:6806-6860 (saveKeys), 6865-6925 (showManualStep), 6929-7010 (finishSetup; ojo: verifyCredentials usa state.model, relevante para el área de modelos), 6721 (btn-edit-keys), 6723-6784 (btn-forget: no mezclar), 802 y 1170 (primeraVez/faltanClaves dependen de configured y skippedKeys)
- src/panel/panel.html:339 (btn-edit-keys, junto al que va el botón nuevo), 213-240 (setup-manual y setup-snippet)
- src/shared/storage.js:36-42 (saveSite fusiona superficial: basta para configured/mcpName/skippedKeys/jiraHost/confluenceHost)
- test/unit/panel-wiring.test.js:326-329 (pina `configureMcp(state.client, { host: state.site.host, jira, confluence, dataCenter })` recortando saveKeys→showManualStep), 609-620 (C5: recortes saveKeys/showManualStep/finishSetup por indexOf: si showManualStep se renombra o se mueve, los indexOf dan -1), 1243/1270/1276 (setup-manual con su screen-head y btn-setup-back), el pin «todo $('…') existe en panel.html» para el id del botón nuevo
- test/unit/setup.test.js:197-210 (configFilePath/mcpBlockSnippet/fullConfigSnippet), 348-460 (waitForMcpReady) y las pruebas de buildMcpConfig (claves EXACTAS del environment: cambiarán si se escriben todas con '') y de mcpForHost (claves exactas {name, jiraHost, confluenceHost, products, connected})
- test/unit/client.test.js (conServidor: añadir PATCH /global/config y la no-fuga del cuerpo)
- CLAUDE.md §7 (frase de POST /mcp), §8.13, §10 (pines de setup.test.js y panel-wiring), §12; docs/INSTALL.md y README (paso manual)

## Riesgos y límites

- Cada escritura (PATCH /global/config) aborta TODOS los turnos en vuelo del proceso opencode, incluidos los de otro cliente conectado al mismo serve, y rearranca todos los MCP (mcp-atlassian ≈14 s en frío): sólo con el panel quieto y avisándolo
- El 500 de un fichero con error de sintaxis devuelve el fichero entero con tokens; y la respuesta buena trae la config global entera: si el cliente registra o guarda cuerpos, se filtran claves
- No hay borrado real por API: queda una entrada deshabilitada sin secretos en opencode.json
- El fichero .json del usuario se reescribe con sangría 2 y claves reordenadas; una clave que el esquema no conoce bloquea la escritura (500, no se escribe nada)
- La recarga en caliente es comportamiento de 1.2.25 (updateGlobal → disposeAll) no documentado; upstream no hay recarga oficial fusionada (PR #43458, #43538 cerrados sin fusionar): hay que degradar a «reinicia opencode» si no aparece
- Varias instancias de opencode: sólo se recarga la que habla con Faro; la escritura va al HOME del proceso serve (enseñar la ruta de GET /path)
- No verificado: el arranque real de mcp-atlassian por uvx en el aislado falló por una ruta demasiado larga en el HOME del scratchpad (error de uv al persistir un temporal), así que el tiempo en frío de un compañero sin caché NO está medido aquí; el `timeout: 30000` de la entrada cubre también la descarga de uvx
- No verificado con un modelo: que las herramientas de un POST /mcp lleguen al turno (sólo leído en el código; en el aislado no hay credenciales de proveedor)
- Otro agente usaba el puerto 4151 durante esta investigación; usé 4157/4158 y los maté al acabar

## Decisiones que el investigador deja a Marco

- ¿Aceptas que Faro ESCRIBA en ~/.config/opencode/opencode.json por la API de opencode (reformateándolo) en vez de pedir que se pegue a mano? Es lo que hace automática la creación; las claves siguen fuera del navegador
- ¿El botón de borrado quita las claves de los DOS productos enlazados (un solo MCP) o prefieres que sólo exista «Cambiar las claves» con un producto desmarcado para quitar uno?
- ¿Vale dejar en opencode.json una entrada deshabilitada y sin tokens tras el borrado (no hay forma de eliminarla por API), o prefieres que Faro además enseñe cómo borrarla a mano?
- ¿Subimos el `timeout` del bloque (hoy 30 s) para la primera ejecución de uvx en un equipo sin caché, o se deja en 30 s con botón «Reintentar»? (depende también del área uvx)
- ¿Se ofrece la comprobación previa efímera con POST /mcp (arranca el MCP sin escribir nada) antes de escribir, o se escribe directamente?

## Pruebas propuestas

- client.test.js: updateGlobalConfig manda PATCH /global/config con el cuerpo exacto y Authorization; devuelve true y NO el Config; con 500 {name:'ConfigJsonError', …tokens…} ni OpencodeError.body ni el logger contienen el cuerpo (SEGURIDAD); con 400 devuelve kind sin cuerpo
- setup.test.js: mcpWritePatch con environment completo (claves exactas, '' en las no usadas; Cloud→DC deja USERNAME/API_TOKEN en ''); mcpScrubPatch reescribe la entrada ENTERA (type+command+enabled:false+environment con todas las claves a '') y nunca {enabled:false} a secas; las entradas por host incluyen deshabilitadas para reutilizar nombre; configFilePath elige jsonc > json > config.json según exista (con los nombres que dé GET /path/un listado inyectado) y opencode.jsonc si no hay ninguno
- setup.test.js: configureMcp ya no llama a addMcp; con un cliente falso cuya config aparece tras el PATCH devuelve ready; si no aparece en el plazo corto, devuelve ready:false con motivo «escrito, reinicia»
- panel-wiring.test.js: saveKeys llama a updateGlobalConfig con el sitio capturado y sólo sin turno en vuelo; showManualStep conserva «Ya lo he pegado» → updateGlobalConfig({}); el manejador del botón nuevo desmarca configured/mcpName/skippedKeys/jiraHost/confluenceHost de todos los registros del MCP, vacía mcpCheck/mcpWait/pendingMcp y llama a bootForSite; no llama a forgetEverythingFor; ningún log.* recibe la respuesta del PATCH
- Integración GRATIS nueva (sin modelo, no gasta turnos): tools/mcp-sandbox.mjs o test/integration/config-write.test.js que arranque `opencode serve` con el HOME entero redirigido (el script de este informe: start-iso.ps1), compruebe GET /path antes de escribir, y verifique con el MCP de juguete: PATCH → connected en <2 s; entrada completa enabled:false → disabled y tokens '' en disco; PATCH {} recarga un bloque pegado a mano; 500 con fichero roto no escribe nada
- Banco/espejo: la pantalla de claves con el nuevo estado de espera («escribiendo en opencode…», «arrancando el MCP…», «falló: … · Reintentar») y Ajustes con el botón nuevo a 320/420 px con faroPreview.check()
- En real (Marco): con su opencode, «Cambiar las claves» sin pegar nada y ver «MCP reconocido/verificado»; «Quitar las claves» y comprobar en su opencode.json la entrada deshabilitada sin tokens; y un compañero sin caché de uv para medir el primer arranque

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/areaA\start-iso.ps1 (arranca opencode.exe serve con el HOME entero redirigido; usar -Port 4157 -Name isoN)
- …\scratchpad\areaA\toy-mcp.mjs (MCP stdio de juguete con faro_ping y log de arranques)
- …\scratchpad\areaA\probe.mjs (POST /mcp, connect/disconnect, PATCH, raw; se niega a escribir si /path no cae en el aislado)
- …\scratchpad\areaA\probe2.mjs (recarga con tiempos, las tres formas de borrar, SSE a través del dispose)
- …\scratchpad\areaA\seed-iso8.mjs + probe3.mjs, probe4.mjs, probe5.mjs, probe6.mjs, probe7.mjs (fusión y formato, vaciado de tokens, fichero roto y fuga en el 500, recarga de un bloque pegado a mano, uvx mcp-atlassian con claves falsas)
- …\scratchpad\areaA\doc-dump.mjs (endpoints y esquemas de oc-doc.json)
- …\scratchpad\areaA\compara-claves.mjs (SÓLO LECTURA: compara la estructura del opencode.json real con su copia sin imprimir valores)

## El script de aislamiento (start-iso.ps1), copiado tal cual

Es la regla de seguridad que nace del incidente de docs/PLAN2.md seccion 0: un opencode serve con el HOME ENTERO redirigido (USERPROFILE, HOME, HOMEDRIVE/HOMEPATH, XDG_*, APPDATA y LOCALAPPDATA), porque OPENCODE_CONFIG_DIR no redirige la configuracion global en 1.2.25. Antes de escribir nada hay que comprobar con GET /path que config y state caen dentro del HOME aislado. H18 lo convierte en tools/config-sandbox.mjs; hasta entonces vive aqui. La ruta del exe es la del npm global de esta maquina.

```powershell
param([int]$Port = 4151, [string]$Name = 'iso1')
$base = Join-Path $PSScriptRoot $Name
$home2 = Join-Path $base 'home'
$work = Join-Path $base 'work'
New-Item -ItemType Directory -Force $home2, $work, (Join-Path $home2 '.config'), (Join-Path $home2 '.local\share'), (Join-Path $home2 '.local\state'), (Join-Path $home2 '.cache') | Out-Null
$env:USERPROFILE = $home2
$env:HOME = $home2
$env:HOMEDRIVE = $home2.Substring(0, 2)
$env:HOMEPATH = $home2.Substring(2)
$env:XDG_CONFIG_HOME = Join-Path $home2 '.config'
$env:XDG_DATA_HOME = Join-Path $home2 '.local\share'
$env:XDG_STATE_HOME = Join-Path $home2 '.local\state'
$env:XDG_CACHE_HOME = Join-Path $home2 '.cache'
$env:APPDATA = Join-Path $home2 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $home2 'AppData\Local'
Remove-Item Env:OPENCODE_SERVER_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
Remove-Item Env:OPENCODE_CONFIG_DIR -ErrorAction SilentlyContinue
Remove-Item Env:OPENCODE_CONFIG_CONTENT -ErrorAction SilentlyContinue
$exe = 'C:\Users\marco\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe'
$p = Start-Process -FilePath $exe -ArgumentList @('serve', '--port', "$Port", '--print-logs', '--log-level', 'INFO') -WorkingDirectory $work -RedirectStandardOutput (Join-Path $base 'out.log') -RedirectStandardError (Join-Path $base 'err.log') -PassThru -WindowStyle Hidden
"PID=$($p.Id) exe=$exe home=$home2 work=$work"
```
