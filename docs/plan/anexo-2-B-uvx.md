<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# B · Instalación robusta de uv/uvx y de mcp-atlassian (el «no tenían uvx y tuvieron problemas»)

## Resumen

Sin uvx, opencode 1.2.25 deja el MCP en {"status":"failed","error":"MCP error -32000: Connection closed"}. No hay ningún ENOENT: el «"uvx" no se reconoce como un comando interno o externo» sólo sale en el log de la terminal de opencode, así que Faro no puede verlo. Además el `timeout` del bloque es el plazo de ARRANQUE: si se pasa, el error es «Operation timed out after N ms» y el proceso sigue vivo, descargando en segundo plano. Y el panel de hoy dice «El MCP está en «failed»…» durante 15 min sin explicar nada. Es la causa más probable de los «problemas».
Lo más útil que ha salido, verificado: POST /mcp/{name}/connect vuelve a arrancar un MCP «failed» y lo deja «connected» en unos 12 s sin reiniciar opencode (probado instalando uvx DESPUÉS del fallo). Una ruta absoluta a uvx.exe en `command` funciona sin uvx en el PATH. Y `uv tool install mcp-atlassian` precalienta, fija la versión y arranca más rápido (1,8 s frente a 3,5-7 s con --help).
Dos trampas nuevas tumban opencode entero al arrancar: un opencode.json con BOM y `{env:VAR}` con una ruta de Windows dentro de una cadena JSON.
Recomiendo cuatro cosas: (a) tools/instalar.ps1 + tools/instalar.sh, que instalan uv con el instalador oficial, refrescan el PATH, ejecutan `uv tool install mcp-atlassian==<probada>`, comprueban opencode y avisan de reiniciarlo desde una terminal NUEVA; (b) una pura `mcpFailureHint(status)` en setup.js que traduzca «Connection closed»/«timed out» a español con el comando para copiar y un botón «Reintentar» que llame a connectMcp; (c) el timeout del bloque a 60000; (d) INSTALL y README con uv como requisito del paso 0 y la resolución de problemas nueva.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[ejecutado]** Con el comando inexistente (o «uvx» fuera del PATH del proceso de opencode), GET /mcp devuelve status «failed» con error «MCP error -32000: Connection closed», sin ENOENT ni spawn. En frío tarda unos 40 ms.
  - Evidencia: opencode aislado en :4156 (home1) → {"sin-uvx":{"status":"failed","error":"MCP error -32000: Connection closed"}} en 42 ms; y en :4158 (home2) con command ['uvx','mcp-atlassian'] y el PATH sin los directorios de uv → el mismo error en 44 ms
- **[ejecutado]** La causa real sólo sale en el log de opencode (stderr de cmd.exe, en español): Faro no puede leerla porque ningún endpoint expone los logs (no hay GET /log, sólo POST /log).
  - Evidencia: home1\serve.log: «service=mcp key=sin-uvx mcp stderr: "uvx-que-no-existe" no se reconoce como un comando interno o externo» + «error=MCP error -32000: Connection closed local mcp startup failed». Lista de rutas de scratchpad/oc-doc.json: no hay lectura de logs
- **[leido-en-codigo]** El esquema MCPStatusFailed es {status:'failed', error:string} y los dos campos son obligatorios. `mcpStatusFor` ya devuelve la entrada cruda en `raw`, o sea que el `error` ya está al alcance del panel sin tocar el cliente.
  - Evidencia: oc-doc.json components.schemas.MCPStatusFailed; src/panel/setup.js:238 `return { name, present: true, connected: status === 'connected', status, raw: entry }`
- **[ejecutado]** `timeout` es el plazo de ARRANQUE: withTimeout(client.connect(transport), mcp.timeout ?? DEFAULT) y también el de listTools. Si se agota, el error es «Operation timed out after N ms» y el proceso hijo NO se mata: sigue descargando y acaba arrancando.
  - Evidencia: Bundle opencode.exe (grep -a): `const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT4; … await withTimeout(client.connect(transport), connectTimeout)`. Aislado home3 con timeout 3000 y --no-cache → «Operation timed out after 3000ms», y el log sigue con «Downloading …», «Installed 107 packages», «Starting MCP server» del mismo key después del fallo
- **[ejecutado]** El MCP hereda el entorno de opencode: env = {...process.env, ...mcp.environment}. Un uv instalado DESPUÉS de arrancar opencode no está en el PATH de ese proceso.
  - Evidencia: Bundle opencode.exe: `env: { ...process.env, ...cmd2 === "opencode" ? { BUN_BE_BUN: "1" } : {}, ...mcp.environment }`. El install.ps1 oficial (líneas 558-561 y Add-Path) escribe HKCU\Environment\Path y dice «To add … to your PATH, either restart your shell»
- **[ejecutado]** POST /mcp/{name}/connect vuelve a arrancar un MCP en «failed» con la configuración ya cargada y lo deja «connected» sin reiniciar opencode (bloquea mientras arranca: unos 12 s).
  - Evidencia: reconectar.mjs contra un aislado en :4156 (home6): mcp 1 failed «Connection closed» → se copia uvx.exe a la ruta del command → mcp 2 sigue failed → POST /mcp/tarde/connect 200 en 12022 ms `true` → mcp 3 {"status":"connected"}
- **[ejecutado]** Una ruta ABSOLUTA en command (con barras invertidas escapadas o con barras normales) arranca el MCP sin que uvx esté en el PATH.
  - Evidencia: Aislado home5 con el PATH sin uv: ruta-abs `C:\\Users\\marco\\.local\\bin\\uvx.exe`, barras-normales `C:/Users/marco/.local/bin/uvx.exe` y tool-exe (el mcp-atlassian.exe de uv tool) → los tres «connected» (GET /mcp 8603 ms)
- **[ejecutado]** `{env:VAR}` se sustituye como TEXTO antes de parsear el JSON: con una ruta de Windows dentro, opencode serve muere al arrancar (ConfigJsonError InvalidEscapeCharacter).
  - Evidencia: home4-roto\serve.log: command ["{env:REAL_HOME}\\.local…"] → «is not valid JSON(C) … InvalidEscapeCharacter at line 1, column 214 … fatal»
- **[ejecutado]** Un opencode.json con BOM UTF-8 también tumba opencode serve al arrancar (InvalidSymbol en 1:1). Es lo que escribe `Set-Content -Encoding utf8` en PowerShell 5.1.
  - Evidencia: home1 (primer intento): «Config file … is not valid JSON(C) … InvalidSymbol at line 1, column 1 … ï»¿{…}» fatal
- **[ejecutado]** Arranque de mcp-atlassian dentro de opencode con la caché caliente: unos 8-12 s hasta «connected»; «Installed 107 packages» de la caché en 2-3 s en cada arranque.
  - Evidencia: home3: GET /mcp 11992 ms (tres MCP en paralelo); home5: 8603 ms; log «Installed 107 packages in 3.03s» → «Starting MCP server» 8 s después
- **[ejecutado]** En frío (descarga completa a una caché desechable) arranca en 7,3 s con el Python del sistema y en 10,2 s si además hay que descargar un CPython gestionado (red rápida de esta máquina); cabe en 30 s aquí, pero con proxy o red corporativa lenta puede no caber.
  - Evidencia: medir-uvx.ps1: «uvx --cache-dir TMP mcp-atlassian --help (frío) 7,3 s»; «uvx frío + descarga de CPython gestionado 10,2 s»; templado 3,5 s; caché real 7,1 s
- **[ejecutado]** `uv tool install mcp-atlassian` tarda 1,4 s (de la caché); el exe instalado arranca en 1,8 s (--help) y dentro de opencode aparece en unos 5 s, frente a los 8 s de uvx. Además uvx usa por defecto la versión instalada.
  - Evidencia: medir-uvx.ps1: tool install 1,4 s, mcp-atlassian.exe --help 1,8 s, uvx con la tool instalada 3,5 s. Log de home5: tool-exe «Starting MCP server» a +5 s y ruta-abs a +8 s. Doc de uv: «Once a tool is installed with `uv tool install`, `uvx` will use the installed version by default.»
- **[ejecutado]** Sin credenciales o con una URL mala, mcp-atlassian queda igualmente «connected»: «connected» no dice nada de las claves (por eso existe verifyCredentials).
  - Evidencia: home3: sin-config y url-mala (JIRA_URL=https://127.0.0.1:9) → {"status":"connected"}
- **[ejecutado]** La vía Docker funciona dentro de opencode pasando las variables por nombre (-e VAR sin valor toma la de environment). Arranca en unos 5-8 s con la imagen ya descargada (218 MB).
  - Evidencia: home7: command [docker, run, -i, --rm, -e, JIRA_URL, -e, JIRA_PERSONAL_TOKEN, -e, READ_ONLY_MODE, ghcr.io/sooperset/mcp-atlassian:latest] → connected en 7938 ms, log «toolCount=34». `docker run … --version` 4,9 s. La imagen local dice «version 0.0.0» y tiene 2 meses
- **[ejecutado]** En npm NO hay un mcp-atlassian oficial: el paquete `mcp-atlassian` 2.1.0 es de otro autor (Vijay-Duke), así que `npx mcp-atlassian` ejecutaría otra cosa. `@sooperset/mcp-atlassian` da 404.
  - Evidencia: npm view mcp-atlassian → repository git+https://github.com/Vijay-Duke/mcp-atlassian.git; npm view @sooperset/mcp-atlassian → E404
- **[leido-en-doc]** El instalador oficial de uv en Windows copia uv/uvx/uvw a %USERPROFILE%\.local\bin (o a UV_INSTALL_DIR / XDG_BIN_HOME), lo pone DELANTE en el PATH de usuario (HKCU, REG_EXPAND_SZ) y avisa del cambio, pero la shell y el opencode que ya estaban abiertos no lo ven. UV_NO_MODIFY_PATH=1 lo desactiva.
  - Evidencia: curl https://astral.sh/uv/install.ps1: líneas 400-401 (UV_INSTALL_DIR), 459-467 (XDG_BIN_HOME / XDG_DATA_HOME/../bin), Add-Path con registry::HKEY_CURRENT_USER\Environment, 558 «either restart your shell». docs.astral.sh/uv/getting-started/installation: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`, `winget install --id=astral-sh.uv -e`, `curl -LsSf https://astral.sh/uv/install.sh | sh`, brew, pipx, pip
- **[leido-en-doc]** uv no necesita un Python instalado y descarga uno gestionado si no hay ninguno que valga («By default, uv will automatically download Python versions when needed»). Con proxy corporativo se usan UV_SYSTEM_CERTS / --system-certs (versiones recientes) o SSL_CERT_FILE.
  - Evidencia: docs.astral.sh/uv/concepts/python-versions/ y /concepts/authentication/certificates/
- **[ejecutado]** En esta máquina hay DOS uv: el de `pip install uv` en el Scripts de Python 3.11 de la Tienda (0.9.7), que va primero en el PATH, y el del instalador oficial en ~/.local/bin (0.11.16). winget ofrece astral-sh.uv 0.12.19.
  - Evidencia: Get-Command uvx → …PythonSoftwareFoundation.Python.3.11…\Scripts\uvx.exe; `uvx --version` 0.9.7; `~/.local/bin/uvx.exe --version` 0.11.16; `winget show --id astral-sh.uv` → Versión 0.12.19
- **[ejecutado]** mcp-atlassian 0.23.1 avisa de que TOOLSETS no está puesto y de que el valor por defecto cambiará a «6 core toolsets»; admite --toolsets/--enabled-tools. Si llega a cambiar, Faro podría perder herramientas que usa.
  - Evidencia: serve.log: «WARNING - mcp_atlassian.utils.toolsets - TOOLSETS is not set — currently defaults to all toolsets. In v0.22.0, the default will change to 6 core toolsets only.»; `uvx mcp-atlassian --version` → 0.23.1; --help muestra --toolsets
- **[leido-en-codigo]** Hoy la espera del paso manual sólo pinta «El MCP está en «failed»…» durante hasta 15 min, sin el `error` y sin salida: un MCP «failed» no se recupera solo.
  - Evidencia: src/panel/panel.js:6899-6904 (onTick de waitForMcpReady con timeoutMs 15*60*1000); showMcpSetup en panel.js:1206 sólo dice «registrado pero en «failed»»; attachMcpNotice en 1217-1220
- **[leido-en-doc]** La doc actual de opencode define `timeout` como «Timeout in ms for fetching tools from the MCP server. Defaults to 5000» y menciona un `cwd` que el esquema de 1.2.25 NO acepta (additionalProperties:false).
  - Evidencia: https://opencode.ai/docs/mcp-servers/ y McpLocalConfig en oc-doc.json (sin cwd)
- **[leido-en-codigo]** Los enlaces del chat sólo se abren si son del sitio, del enlazado o de id.atlassian.com (S5): un aviso de Faro no puede enlazar a docs.astral.sh, así que la ayuda tiene que ser un comando para copiar, no un enlace.
  - Evidencia: CLAUDE.md §8.3 / src/panel/links.js allowedLinkOrigin

## Opciones

### A · Script de instalación + diagnóstico en el panel + «Reintentar» (recomendada)

tools/instalar.ps1 y tools/instalar.sh: instalan uv con el instalador oficial (winget como alternativa en Windows), refrescan el PATH del propio script desde el registro, ejecutan `uv tool install mcp-atlassian==<versión probada>`, comprueban `mcp-atlassian --version`, `opencode --version` y si hay un opencode escuchando en 4096, e imprimen «reinicia opencode desde una terminal NUEVA». En Faro, una pura mcpFailureHint(status) en setup.js (Connection closed → falta uvx; timed out → primera descarga lenta; otro → el texto de opencode acotado) que usan el paso manual, showMcpSetup y attachMcpNotice, con un botón «Reintentar» que llama a client.connectMcp(name) (verificado que funciona) y un comando para copiar. El bloque sigue siendo ['uvx','mcp-atlassian'] con timeout 60000.

**A favor**

- Ataca las dos causas medidas: el comando no encontrado y la primera descarga lenta
- No hay que tocar el formato del bloque ni los pines de command
- «Reintentar» evita reiniciar opencode tras un timeout (verificado)
- Versión de mcp-atlassian fija y la misma para todo el equipo; arranque más rápido
- El texto se decide en una pura que se prueba en Node

**En contra**

- El script lo tiene que ejecutar el compañero (Faro no ejecuta nada en su máquina)
- Si opencode arrancó antes de instalar uv, «Reintentar» no basta con command 'uvx': hay que reiniciarlo desde una terminal nueva (el texto lo dice)
- Dos scripts que mantener (ps1 y sh)

**Esfuerzo**: Medio: 1 hito, ~10 ficheros (2 scripts nuevos, setup.js, panel.js, panel.html, INSTALL, README, CLAUDE.md, espejo) y 6-8 pruebas nuevas

### B · Ruta absoluta a uvx en el bloque

Faro escribe command [<home>\.local\bin\uvx.exe, 'mcp-atlassian'] con `home` sacado de GET /path, o lo ofrece como variante «si opencode no encuentra uvx» en el paso manual.

**A favor**

- Verificado: arranca aunque uvx no esté en el PATH del proceso de opencode
- Con «Reintentar» funciona sin reiniciar opencode, incluso si uv se instaló después

**En contra**

- Sólo vale si uv se instaló con el instalador oficial (winget, pip o brew lo dejan en otro sitio)
- Faro no puede comprobar que el fichero existe (no ejecuta nada ni lee fuera del proyecto)
- Mete rutas de usuario en el bloque; {env:} no sirve (tumba opencode en Windows)

**Esfuerzo**: Bajo como variante secundaria dentro de A (una opción más en el paso manual y una función pura)

### C · Docker como alternativa

Bloque con docker run -i --rm -e VAR… ghcr.io/sooperset/mcp-atlassian:latest (versión fijada) para quien tenga Docker Desktop y no quiera Python/uv.

**A favor**

- Verificado: conecta en 5-8 s con la imagen descargada
- Evita Python, uv y el PATH

**En contra**

- Exige Docker Desktop encendido (en empresa suele necesitar licencia y admin)
- Imagen de 218 MB; con :latest la versión es opaca (sale «0.0.0»)
- Si opencode muere con taskkill /F, los contenedores podrían quedarse (no observado)

**Esfuerzo**: Bajo como opción documentada en INSTALL; medio si se añade un selector en la pantalla de claves

### D · npx

Ejecutar el MCP con npx en vez de uvx.

**A favor**

- Node ya está (opencode viene de npm)

**En contra**

- DESCARTAR: en npm no hay un mcp-atlassian oficial; el paquete `mcp-atlassian` es de otro autor y ejecutaría código ajeno con los tokens de Atlassian

**Esfuerzo**: N/A (descartada)

### E · Sólo subir el timeout

Pasar timeout de 30000 a 120000 y no hacer nada más.

**A favor**

- Un cambio de una línea

**En contra**

- No arregla que falte uvx (falla en 40 ms)
- No explica nada al usuario

**Esfuerzo**: Mínimo, pero insuficiente por sí sola

## Recomendación del investigador

Opción A, con la B como variante secundaria dentro del paso manual y la C sólo documentada.

1) tools/instalar.ps1 (Windows) y tools/instalar.sh (macOS/Linux), en ese orden de pasos, idempotentes y sin pedir admin:
 (1) `uvx` en el PATH → ya está. Si no, se busca $HOME\.local\bin\uvx.exe. Si tampoco, se instala con `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`, y si falla (proxy o política), `winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements`. En el .sh, `curl -LsSf https://astral.sh/uv/install.sh | sh`, o brew si existe.
 (2) Se refresca el PATH del propio script desde el registro (Machine + User) para que los pasos siguientes vean uv.
 (3) `uv tool install mcp-atlassian==$VERSION` con $VERSION como constante del repo (hoy 0.23.1, la probada). Si falla por certificados, se reintenta con `--system-certs` o `--native-tls` según `uv --version` y se imprime qué variable fijar (UV_SYSTEM_CERTS / SSL_CERT_FILE, HTTPS_PROXY).
 (4) Comprobación: `mcp-atlassian --version` desde `uv tool dir --bin` y `uvx mcp-atlassian --version` con su tiempo.
 (5) `opencode --version` (≥1.2) y GET http://127.0.0.1:4096/global/health: si ya hay uno corriendo, aviso en rojo: «ciérralo y arráncalo desde una terminal NUEVA: el que está abierto no ve uvx».
 (6) Resumen final: uvx=<ruta y versión>, mcp-atlassian=<versión>, opencode=<versión> y el comando de arranque con --cors.
 Reglas para los scripts: nunca escribir opencode.json (eso es del área A y el BOM de PS 5.1 lo rompe; si alguna vez escribe, [IO.File]::WriteAllText con UTF8Encoding($false)); nunca tocar tokens; salir con 1 y una línea clara si algo falla. Opcional: `tools/arrancar-opencode.ps1`, que relee el PATH del registro y lanza `opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO` pidiendo la contraseña si falta OPENCODE_SERVER_PASSWORD. Así el PATH viejo deja de ser un problema y el comando largo sale de la documentación. En README: `powershell -ExecutionPolicy Bypass -File tools\instalar.ps1`, porque un zip descargado lleva marca web y RemoteSigned lo bloquearía.

2) Faro. En src/panel/setup.js, una pura nueva `mcpFailureHint(status, {home})` que devuelve null o {kind, text, retry, copy}:
 - error /Connection closed/ → kind 'sin-arranque', texto: «opencode no ha podido arrancar el MCP de Atlassian: el proceso se cerró nada más empezar. Casi siempre es que no encuentra uvx. Ejecuta tools\instalar.ps1 (o instala uv) y reinicia opencode desde una terminal nueva; en su ventana verás «"uvx" no se reconoce…» si es eso.», copy: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`, retry: true;
 - /timed out after (\d+)ms/ → kind 'lento', texto: «Ha tardado más de N s en arrancar. La primera vez uvx descarga unos 107 paquetes (y Python si no lo tienes); ya siguen bajando. Pulsa Reintentar en unos segundos.», retry: true;
 - otro «failed» → kind 'otro', con el error de opencode en una línea, sin invisibles y ≤200;
 - «connected» o ausente → null.
 El texto «está registrado pero en» sigue escrito UNA sola vez (hay un pin): el consejo va detrás.
 En panel.js: (i) el onTick de showManualStep (panel.js:6899), cuando s.status==='failed', pinta el consejo en #setup-mcp-hint y enseña #btn-mcp-retry; (ii) showMcpSetup (1193) añade el consejo en #setup-status; (iii) attachMcpNotice (1217) añade «Reintentar» junto a «Cambiar las claves». El botón llama a `state.client.connectMcp(name)` (ya existe en client.js; bloquea unos 12 s, así que lleva spinner, se desactiva mientras tanto, captura el host, §8.22) y después a listMcp; registro «MCP reintentado» con el resultado. El comando se copia con el mismo patrón `.cmd` + «Copiar» que #setup-config-path, sin enlaces externos (S5). Variante B: si kind==='sin-arranque', el paso manual ofrece «Usar la ruta completa de uvx», que regenera el fragmento con command [paths.home + '\\.local\\bin\\uvx.exe', 'mcp-atlassian'] (home de GET /path, que showManualStep ya pide). Si el área A escribe la configuración sola, esa misma pura decide reescribir y llamar a connect.
 En buildMcpConfig: timeout 30000 → 60000, con un comentario sobre lo medido (8-12 s en caliente, 7-10 s en frío con red rápida; con proxy corporativo más). Opcional y a decidir: `TOOLSETS: 'all'` en environment, para que no desaparezcan herramientas si mcp-atlassian cambia el valor por defecto.

3) Docs. INSTALL.md gana una sección 0 «Antes de nada: uv», con el script y los comandos manuales por sistema, y la advertencia de reabrir la terminal. La nota de la línea 138 pasa a hablar de 107 paquetes, Python y el timeout de 60 s. La resolución de problemas (línea 1334) gana cuatro entradas: «failed · Connection closed» (falta uvx: cómo verlo en la terminal), «failed · Operation timed out» (Reintentar), «opencode no arranca: not valid JSON(C) InvalidSymbol 1:1» (BOM: guárdalo en UTF-8 sin BOM) y «InvalidEscapeCharacter» ({env:} o barras sin escapar), además de la alternativa Docker con el bloque probado y el aviso de que `npx mcp-atlassian` NO es el mismo paquete. README: la tabla de requisitos dice «uv (lo instala tools/instalar.ps1)» y el paso 0 de Instalación ejecuta el script.

## Ficheros y pines que toca

- src/panel/setup.js:49-52 — buildMcpConfig: command ['uvx','mcp-atlassian'] (se queda) y timeout 30000 → 60000; nueva pura exportada mcpFailureHint (y, si se hace la variante B, uvxAbsoluteCommand(home)); el comentario de waitForMcpReady (245) pasa a decir 8-12 s
- src/panel/panel.js:1193-1208 showMcpSetup (consejo detrás del texto pinado «está registrado pero en», que sigue en un solo sitio); 1217 attachMcpNotice (+ «Reintentar»); 6865-6915 showManualStep (onTick con el consejo cuando está en failed, botón de reintento con connectMcp y variante de ruta completa); paintState, fila MCP con el error
- src/panel/panel.html:213-253 #setup-manual: nuevos #setup-mcp-hint (con .cmd + botón copiar) y #btn-mcp-retry; y una línea en el paso 1 «¿Tienes uv? tools\instalar.ps1»
- src/opencode/client.js — connectMcp ya existe (lo usa configureMcp, setup.js:278); sin cambios salvo quizá un signal/timeout propio para los ~12 s que bloquea
- tools/instalar.ps1, tools/instalar.sh (nuevos) y opcional tools/arrancar-opencode.ps1; package.json: script opcional «instalar» (sólo Windows)
- docs/INSTALL.md:119-126 (bloque con timeout 60000), 138 (nota del primer arranque), sección 0 nueva, 1330-1360 (resolución de problemas); README.md:142 (requisitos) y paso de instalación
- harness/panel-preview.html:1613-1622 — el fragmento del espejo con el timeout nuevo y el consejo de failed pintado a mano en la pantalla de claves (medir a 320 px)
- test/unit/setup.test.js:36 eq(c.command, ['uvx','mcp-atlassian']) se mantiene; nuevas: eq(c.timeout, 60000) y 4-5 pruebas de mcpFailureHint (Connection closed, timed out con N, otro error acotado a una línea y sin invisibles, connected→null, basura→null)
- test/unit/panel-wiring.test.js — el pin «el texto del MCP caído vive en un solo sitio» (split('está registrado pero en') === 1) no se toca; prueba nueva: mcpFailureHint( en showManualStep/showMcpSetup/attachMcpNotice, connectMcp( dentro del manejador de reintento con el host capturado, el botón desactivado mientras reintenta, ningún enlace externo, #setup-mcp-hint y #btn-mcp-retry en panel.html
- test/unit/instalar.test.js (nuevo, por regex sobre los scripts): misma versión fijada en .ps1 y .sh, `uv tool install mcp-atlassian==`, el PATH se refresca desde el registro, ningún Set-Content/Out-File hacia opencode.json, ni UV_NO_MODIFY_PATH ni `npx mcp-atlassian`
- CLAUDE.md §3 (tools nuevos), §7 (error strings de failed, connect que reintenta, env heredado, huérfano tras timeout, BOM y {env:} fatales, timeout = arranque), §9 (título «MCP reintentado»), §10 (pines nuevos), §2 (número de pruebas); docs/INSTALL.md con el título nuevo del registro (paso docs de npm run check)

## Riesgos y límites

- Faro no puede saber POR QUÉ se cerró el proceso: «Connection closed» también sale si mcp-atlassian revienta al arrancar por otra causa (dependencia rota, Python incompatible). El texto tiene que decir «casi siempre» y mandar a mirar la terminal de opencode
- «Reintentar» (POST /mcp/{name}/connect) reutiliza el entorno del proceso de opencode: si uv se instaló después de arrancar opencode y el command es 'uvx', seguirá fallando hasta reiniciar opencode desde una terminal nueva (o usar la ruta completa). Verificado sólo con ruta absoluta
- POST /mcp/{name}/connect bloquea unos 12 s; si el MCP vuelve a colgarse espera hasta `timeout` (60 s). Hace falta estado de «reintentando», testigo y host capturado (§8.22)
- Tras un timeout el proceso huérfano sigue vivo; si al reintentar se arranca otro, pueden convivir dos mcp-atlassian hasta que opencode se cierre (no medido; con taskkill /T sí se limpiaron)
- Probado sólo en esta máquina (red rápida, Windows 11, uv 0.11.16). No se ha medido detrás de un proxy corporativo con inspección TLS, que es donde la primera descarga más puede fallar o pasarse del tiempo
- La variante de ruta completa sólo vale con el instalador oficial (~/.local/bin); con winget, pip (Scripts de la Tienda) o brew la ruta es otra, y Faro no puede comprobar que el fichero existe
- Política de ejecución: en un Windows sin RemoteSigned/Unrestricted o con un zip marcado desde la web, el .ps1 no corre sin `-ExecutionPolicy Bypass` (aquí CurrentUser=Unrestricted, LocalMachine=RemoteSigned)
- Fijar la versión de mcp-atlassian obliga a subirla a mano; no fijarla deja a cada compañero con la versión del día de su primer uvx (uvx no actualiza solo)
- Docker: la imagen local (latest) dice «version 0.0.0»; hay que fijar una etiqueta si se documenta. En esta máquina hay tres contenedores de mcp-atlassian «Up 11-12 hours» que NO son de estas pruebas (no se tocaron)
- Los puertos 4151 y 4157 los tenían ocupados otros agentes (4151 servía la configuración REAL del usuario); estas pruebas usaron 4156 y 4158 y no mandaron ninguna escritura a ningún servidor; POST /mcp/tarde/connect sólo al aislado, tras comprobar /path

## Decisiones que el investigador deja a Marco

- Timeout del bloque: 60000 (recomendado) o 120000 si el equipo está detrás de un proxy lento
- ¿Fijar la versión de mcp-atlassian en el script (uv tool install mcp-atlassian==0.23.1) o dejar la última? Fijar da el mismo comportamiento a todo el equipo a cambio de subirla a mano
- ¿Instalador oficial de uv primero (ruta predecible ~/.local/bin, recomendado) o winget primero (le suena más a IT en empresa)?
- ¿Añadir TOOLSETS='all' al environment del bloque para blindarse contra el cambio de valor por defecto que anuncia mcp-atlassian?
- ¿Ofrecer Docker en la pantalla de claves (selector) o sólo documentarlo en INSTALL? Recomendado: sólo documentarlo
- ¿Añadir tools/arrancar-opencode.ps1 (relee el PATH y arranca opencode con --cors) como forma oficial de arrancar opencode, también para shell:startup?
- ¿`npm run instalar` además del .ps1? Exige Node, que el compañero tiene si instaló opencode por npm, pero no necesariamente

## Pruebas propuestas

- setup.test.js: mcpFailureHint con {status:'failed', error:'MCP error -32000: Connection closed'} → kind 'sin-arranque', retry true y el texto nombra uvx; con 'Operation timed out after 30000ms' → kind 'lento' y dice «30 s»; con otro error → kind 'otro', una línea, ≤200, sin invisibles ni saltos (SEGURIDAD); connected, ausente, null y basura → null sin lanzar
- setup.test.js: buildMcpConfig → timeout 60000 y command ['uvx','mcp-atlassian'] intacto (el pin de la línea 36)
- panel-wiring.test.js: el consejo cableado en showManualStep (onTick), showMcpSetup y attachMcpNotice; el reintento llama a connectMcp( con el nombre capturado y el host capturado antes del await, el botón desactivado mientras reintenta, el registro «MCP reintentado», ningún href externo; #setup-mcp-hint y #btn-mcp-retry en panel.html; el texto «está registrado pero en» sigue una sola vez
- instalar.test.js (nuevo, regex): la versión fijada es la misma en .ps1 y .sh; `uv tool install mcp-atlassian==`; el PATH se refresca con [Environment]::GetEnvironmentVariable('Path','User'/'Machine'); ninguna escritura a opencode.json; sin `npx mcp-atlassian`; el mensaje de reiniciar opencode desde una terminal nueva
- Sonda manual (scratchpad/areaB): un opencode AISLADO con PATH sin uv → failed «Connection closed» → el panel en el espejo o la extensión enseña el consejo → se instala uv → «Reintentar» con ruta completa → connected (reproduce reconectar.mjs)
- Espejo: faroPreview.check() a 320/420 × claro/oscuro con la pantalla de claves en «failed» y el consejo y el .cmd visibles (que el comando largo no desborde: .cmd ya tiene su patrón)
- Verificación en real con un compañero SIN uv: ejecutar tools\instalar.ps1 en su Windows, medir cuánto tarda la primera descarga en la red corporativa y comprobar que opencode arrancado desde una terminal nueva conecta a la primera
- npm run check ×3 (número de pruebas en README/§2, título nuevo del registro en INSTALL y §9)

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/areaB\start-aislado.ps1 (opencode serve con el HOME entero redirigido; escribe la config sin BOM; se niega a arrancar si el puerto está ocupado)
- …\areaB\sonda.mjs (espera a health y mide GET /path, GET /mcp, enmascarando tokens)
- …\areaB\matar.ps1 (taskkill /T de lo que escucha en un puerto)
- …\areaB\medir-uvx.ps1 (tiempos en frío, con Python gestionado, en caliente y con uv tool install, con cachés y directorios de tools en temporales)
- …\areaB\reconectar.mjs (MCP en failed → se instala uvx → POST /mcp/{name}/connect → connected; sólo tras comprobar /path aislado)
- …\areaB\cfg-rutas.json, cfg-tarde.json, cfg-docker.json (configuraciones de prueba); home1..home7 (homes aislados con serve.log); uv-install.ps1.txt (el instalador oficial descargado para leerlo)
