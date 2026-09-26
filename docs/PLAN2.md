# Segundo plan de evolución de Faro · septiembre 2026

Plan para lo que el equipo de Marco pidió después de usar Faro: que instalar
uv no sea un problema, que el MCP de Atlassian se cree y se quite solo, que la
lista de modelos sea la de cada persona y se elija ANTES de construir el
contexto (y otra vez cuando falle), que un Confluence con varios espacios tenga
un árbol y un contexto por espacio, que el chat dibuje flujos entre tickets, y
que el subrayado sea más bonito, con el ratón como un subrayador azul. Sigue la
metodología del repo (CLAUDE.md §9-§11): módulo puro con test → cableado en
`panel.js` → comprobación en el banco → docs → revisión adversaria, en hitos
pequeños y commiteables, cada uno con `npm run check` en verde.

Los informes de investigación de cada área (hechos verificados con su
evidencia, opciones, recomendación, ficheros, riesgos, pruebas) están en
`docs/plan/anexo-2-*.md`, y los dos juicios que los cruzaron en
`docs/plan/anexo-2-juicios.md`. Este documento decide; los anexos desarrollan.
Donde un anexo contradiga a este documento, manda éste. El primer plan
(`docs/PLAN.md`, H0-H13) está cerrado y ejecutado, y H14 encima: este plan
empieza en **H15** y no reabre nada de aquél.

---

## 0. Cómo se ha hecho este plan

- **Investigación**: seis agentes en Opus, uno por área y cada uno con su
  lente —A el API de opencode para crear y quitar el MCP, B uv/uvx y el MCP que
  no arranca, C los modelos por persona, D varios espacios, E los diagramas, F
  el subrayado—, sobre el código real de `9fcbe7d` (H14 cerrado, 1 317
  pruebas), la documentación pública, **un opencode 1.2.25 aislado** (con el
  HOME entero redirigido, para poder escribir sin tocar el de Marco), sondas en
  Node sobre los módulos puros de `src/` y el banco en el Browser pane. Cada
  informe separa lo **ejecutado** de lo **leído en el código**, lo **leído en
  la documentación** y lo **supuesto**.
- **Juicio**: dos jueces en Opus, independientes, leyeron los seis informes y
  el código y contestaron a las mismas cuatro preguntas: conflictos entre
  áreas, huecos que ningún informe cubre, hitos en orden, y objeciones a la
  recomendación de cada investigador. Los dos coinciden en lo importante (el
  modelo va ANTES que el MCP automático; uv antes que el MCP automático; el
  multi-espacio antes que los diagramas; el subrayado en dos partes, con el
  «rotulador» de mezcla aparte) y discrepan en el corte de los hitos: §4 es la
  reconciliación.
- **Verificación del orquestador (Fable)**: cada cita del código de los
  informes se comprobó línea a línea (`setup.js:196` salta `enabled: false`;
  `client.js:118` registra 160 caracteres del cuerpo de cualquier error y
  guarda el cuerpo entero; `panel.js:764` elige el modelo con
  `pickDefaultModel`, `1563` cae en `models[0]`, `2594` guarda `saved.model`
  tras cada turno, `3323` mira `indexSize`, `6956` verifica con `state.model`,
  `7236` escribe `onboarded: true` en el `catch` del indexado, `543` sólo
  reacciona a un cambio de HOST; `notes.js:686` sólo trocea las vallas
    `json` o sin lenguaje, así que un ```mermaid se queda en la prosa;
  `styles.js:451` la Custom Highlight y `466` el cursor `crosshair`;
  `overlay.js:667` las insignias a media línea; `config.js:181-191` las tres
  claves por host; `service-worker.test.js:482` las claves exactas de
  `SETTINGS`); las sondas puras de D, E y F se **volvieron a ejecutar** y dan
  los mismos números; los logs de los opencode aislados de A y B se leyeron
  (el MCP de juguete arrancado por `PATCH {}`, el «Connection closed» con su
  stderr en español); y la salida de C confirma el orden del `default`.
- **Revisión adversaria del propio plan** (2026-09-26, antes de darlo por
  escrito): cuatro críticos en Opus con lentes distintas —conformidad con
  CLAUDE.md, seguridad y tokens, fidelidad a lo que pidió Marco y a los
  hechos, ejecutabilidad y orden— sobre el borrador, sus anexos y el código,
  y un refutador por hallazgo (veinte agentes, 37 hallazgos brutos). Quince
  quedaron confirmados por su refutador, uno refutado (con un resto que sí
  valía: `enabled: true` en toda escritura), y veintiuno se quedaron sin
  refutador por el tope del flujo y los juzgó el orquestador contra el
  código, uno a uno. **Se aplicaron todos**; los que más cambiaron el
  documento: la guarda de `offerNavigation` NO pasa a `pagesOfSpace` (habría
  cortado el paso a paso a otro espacio, que el plan promete conservar); el
  reintento con la ruta absoluta de uvx sólo sobre la entrada recién creada y
  con vuelta atrás; una entrada ajena deshabilitada nunca se reutiliza; dos
  puertas de escritura cerradas en vez de una a medias; el botón «Dibujar el
  flujo» no pasa por `offerNotes`; la navegabilidad de un nodo se decide al
  clic; la lista de modelos caída no abre ninguna pantalla a quien ya estaba
  configurado; la flecha de `screen-model` oculta y una guarda en el
  manejador de Escape; el cursor no se expone jamás desde
  `web_accessible_resources`; ningún espacio se desaloja solo; el script de
  arranque apaga las instrucciones de proyecto de opencode; y dos hechos que
  el plan daba por verificados pasan a supuestos (que Excalidraw importe
  Mermaid pegado; que opencode lance por `cmd.exe`).
- **Lo que se ha medido** (todo contra opencode 1.2.25):
  - `PATCH /global/config` escribe `~/.config/opencode/opencode.json` (fusión
    profunda, sangría 2) **y recarga en caliente**: un MCP nuevo aparece en
    `GET /mcp` **178-210 ms** después, y un bloque pegado a mano se recoge con
    `PATCH {}` en 207 ms; cada PATCH cierra el SSE, aborta TODOS los turnos en
    vuelo del proceso y rearranca TODOS sus MCP (mcp-atlassian en frío ≈14 s).
    `POST /mcp` arranca el proceso y sus herramientas llegan al modelo, pero es
    sólo en memoria: invisible en `GET /mcp`, no se escribe y muere con el
    primer dispose. No hay borrado por API: se reescribe la entrada ENTERA con
    `enabled: false` y las variables secretas a `""` (queda «disabled» en
    170 ms y sin tokens en disco). Un fichero con error de sintaxis hace que
    el 500 devuelva el fichero ENTERO, tokens incluidos.
  - Sin `uvx` en el PATH del proceso de opencode el MCP queda
    `{status: 'failed', error: 'MCP error -32000: Connection closed'}` en
    **40 ms**; la causa («"uvx" no se reconoce como un comando…») sólo está en
    la terminal de opencode. `timeout` es el plazo de ARRANQUE: pasado, el
    error es «Operation timed out after N ms» y el proceso sigue descargando.
    `POST /mcp/{name}/connect` vuelve a arrancar un MCP «failed» sin reiniciar
    opencode (12 s). Una ruta absoluta a `uvx.exe` arranca sin PATH. En frío,
    uvx descarga 107 paquetes en **7,3 s** (10,2 s si además baja un CPython);
    en caliente, 8-12 s hasta «connected»; con `uv tool install` el exe arranca
    en 1,8 s y dentro de opencode en 5 s. Un `opencode.json` con BOM, o un
    `{env:VAR}` con una ruta de Windows dentro, tumban opencode al arrancar.
    El paquete `mcp-atlassian` de npm es de OTRO autor.
  - `GET /config/providers` da sólo los proveedores CONECTADOS de la persona
    (aquí 3, 43 modelos), todos con `status: 'active'` y coste 0: opencode no
    sabe qué permite el plan. El `default` viene en un orden fijo con
    `openai/gpt-5.4` primero, que aquí falla en **802 ms** («not supported…
    with a ChatGPT account»); `github-copilot/claude-sonnet-4.6` falla en
    204-1 313 ms y su rechazo trae la lista ENTERA de modelos disponibles para
    el integrador (57 ids; 3 de los 32 que opencode lista NO están, y uno es
    justo su default); `opencode/big-pickle` da 403 «free tier can only be
    used from within OpenCode» desde `serve` (el nivel gratuito entero, §7;
    `jev-1.13-free` acepta el turno y no contesta). Con los ids reales,
    «Reintentar con X» alterna entre dos modelos rotos.
  - Dos espacios del mismo Confluence comparten `faro:context:<host>`,
    `faro:index:<host>` y `onboarded`: generar en el segundo PISA el CONTEXT.md
    del primero, el índice los funde (600 páginas = 64 898 bytes) y el segundo
    espacio nunca ve la pantalla de contexto. Diez contextos de 24 000
    caracteres en una sola clave son 240 324 bytes.
  - `mermaid.min.js` mide 3 572 661 bytes, devuelve una cadena SVG para
    `innerHTML` y lleva 19 `innerHTML` dentro; una prueba de concepto propia
    de 309 líneas parsea, valida, coloca (5 capas, 0 cruces) y pinta un flujo
    de 6 nodos en ~1 ms, con ida y vuelta a Mermaid idéntica, y rechaza
    `click`, `style`, `classDef`, `<img onerror>` y `javascript:`.
  - En oscuro, el texto bajo una marca baja de **8,95:1 a 3,63:1** (el overlay
    pinta ENCIMA de la letra y se suma a la Custom Highlight de debajo); sólo
    con la Custom Highlight sería 4,91. Las insignias tapan las dos o tres
    primeras letras de la palabra siguiente. `mix-blend-mode` en `.quote-rect`
    es inerte (el host aísla la mezcla); en un host propio, multiply/screen da
    11,20 y 6,01. Chrome acepta un cursor SVG de 32×32 con el punto activo en
    la punta, y `::selection` dentro de `html.faro-picking` se pinta azul.
- **El incidente, y la regla que sale de él**: durante la investigación una
  prueba del orquestador contra un `opencode serve` desechable escribió dos
  entradas de prueba en el `opencode.json` REAL de Marco, porque
  `OPENCODE_CONFIG_DIR` **no** redirige la configuración global en 1.2.25
  (observado en el propio incidente: la variable estaba puesta y el PATCH fue
  al fichero real; el investigador A aisló después con el HOME entero y
  `GET /path` lo confirmó). Se restauró (copia previa, las dos claves quitadas, JSON comprobado; la
  entrada real, idéntica) y el investigador A lo confirmó por estructura sin
  imprimir valores; queda una copia con los tokens,
  `opencode.json.faro-bak-2026-09-25`, en el mismo directorio, que Marco debe
  borrar cuando quiera. La regla, para todo hito de este plan: **ninguna prueba
  de escritura contra un opencode que no tenga el HOME ENTERO redirigido
  (`USERPROFILE`, `HOME`, `HOMEDRIVE`/`HOMEPATH`, `XDG_*`, `APPDATA`,
  `LOCALAPPDATA`) y `GET /path` comprobado antes de escribir**; el script que
  lo hace está copiado al final del anexo A. Y en el producto, la escritura de Faro queda
  acotada por una decisión nueva (§5, §8.24).

## 1. Estado de partida

- Rama `plan/h14-verificacion-real` (`9fcbe7d`), árbol limpio, `npm run check`
  en verde con **1 317 pruebas**, el banco 1-62 corrido (125/125), las quince
  ramas `plan/h0…h14` apiladas sobre `40f56d7` **sin push ni PR**, y `main`
  local en `523c25f` (CLAUDE.md §12.1). Este plan se escribe en una rama
  nueva encima de H14 y sus hitos siguen la misma pila.
- `panel.js` tiene ~8 100 líneas y las tres áreas de la petición principal
  (modelos, uv y MCP automático) tocan la MISMA cadena del primer uso:
  `bootForSite` → `checkMcp`/`primeraVez` (802-830) → `saveKeys` (6806) →
  `showManualStep` (6865) → `finishSetup` (6929) → pantalla de contexto →
  `generateContext` (7119) y su `catch` (7235-7237). `panel-wiring.test.js`
  recorta esos trozos por `indexOf` (326-335 y 609-620): **los hitos de esa
  cadena van en serie, nunca dos en paralelo sobre `panel.js`**, y el orden
  de §4 está elegido para reescribir cada bloque una sola vez.
- **Lo que le pasó al compañero, reconstruido con el código** (anexo C, hechos
  8-12): en el primer uso el único turno es `verifyCredentials` con
  `state.model`, que sale de `pickDefaultModel` = el PRIMER `default` del
  mapa de opencode, `openai/gpt-5.4`, que su cuenta no permite → el turno
  falla con `reason: 'modelo'` → `finishSetup` lo pinta como «Jira: <error>»
  (como si fallaran las claves) y hace `return` sin `saveSite`: el sitio no
  queda configurado. Al recargar, `checkMcp` ADOPTA el MCP por dominio sin
  ningún turno, así que «funcionaba»; y si después el indexado falla por el
  mismo modelo, su `catch` escribe `onboarded: true` sin CONTEXT.md, que es
  el «tampoco tenía contexto». Además, el `catch` pinta «El indexado falló»
  ANTES de `restoreConversation()`, que vacía el chat: el aviso no se ve
  (pendiente anotado en §12.5 desde H2). Y si además faltaba `uvx`, el paso
  manual enseñaba «El MCP está en «failed»…» hasta 15 minutos, sin el motivo
  y sin salida.
- **La lista de modelos** SÍ es la de cada persona (`GET /config/providers`
  sólo trae sus proveedores conectados): lo que no es de la persona es cuál
  vale, porque opencode lista modelos que el plan no permite y Faro no tiene
  forma de saberlo sin un turno. Nadie ha visto la máquina del compañero:
  antes de H16 conviene pedirle el Registro («Turno fallido», la fila
  «modelos») o una captura, por si su caso fuera otro (§7).
- **Lo que hoy funciona y se conserva**: el paso a paso a una página de OTRO
  espacio (empieza por «Espacio X» y sigue su rama, verificado con la sonda);
  «Qué mirar hoy» ya puntúa por espacio o proyecto; el foco del recorrido y
  el cartel «Llévame» se ven limpios; la barrera `SAFE_PERMISSIONS`; y todo
  lo de H14, que este plan no toca.

## 2. Lo que pidió el equipo y lo que se comprobó

Cada punto: qué pidió Marco · qué pasa hoy (verificado) · qué se decide · dónde
se desarrolla.

1. **«No tenían instalado uvx y tuvieron problemas; que se solucione de la
   manera más sencilla»**. Hoy el bloque que Faro pide pegar lleva
   `command: ['uvx', 'mcp-atlassian']` y `timeout: 30000`; sin uvx, opencode
   deja el MCP en «failed · Connection closed» a los 40 ms y Faro sólo dice
   «está en failed». Se decide un script de instalación (`tools/instalar.ps1`)
   que instala uv con su instalador oficial (o winget), refresca el PATH,
   precalienta `mcp-atlassian` con `uv tool install` a una versión FIJADA,
   comprueba opencode y avisa de arrancarlo desde una terminal NUEVA; y en
   Faro, un diagnóstico puro (`mcpFailureHint`) que traduce «Connection
   closed» y «timed out» a qué hacer, con un botón «Reintentar» que vuelve a
   arrancar el MCP sin reiniciar opencode. §3.1, anexo B, **H15**.
2. **«Que la creación de los MCP se haga automática; creo que hay un endpoint
   en opencode»**. Lo hay, y no es el que Faro usa: `POST /mcp` (lo que
   `configureMcp` intenta hoy) arranca el proceso pero no lo persiste ni lo
   ve `GET /mcp`, así que Faro acaba siempre en el paso manual; **`PATCH
   /global/config` escribe el fichero Y recarga en caliente**, verificado dos
   veces en un opencode aislado. Se decide crear el MCP con ese PATCH, esperar
   a que aparezca y conecte, y dejar el paso manual sólo como respaldo con un
   botón «Ya lo he pegado» que recarga sin reiniciar. §3.2, anexo A, **H18**.
3. **«Desde configuración debes poder eliminar la configuración para volver a
   crear los MCP»**. No hay borrado por API (`null` → 400, `{mcp:{}}` fusiona
   y no borra, y la CLI no tiene `remove`): lo que funciona es reescribir la
   entrada entera con `enabled: false` y las claves a `""`, que
   `mcpForHost` ya salta (`setup.js:196`), y desmarcar los registros
   enlazados en `chrome.storage` para que el arranque llegue a la pantalla de
   claves. §3.2, anexo A, **H19**.
4. **«Pueden haber varios espacios: que en función del espacio se guarde un
   árbol u otro»**. Hoy todo es por HOST: el CONTEXT.md se pisa, el índice
   funde los espacios y el segundo espacio nunca pide contexto. Se decide un
   contexto POR ÁMBITO (espacio o proyecto) dentro de la misma clave por host,
   un índice único por host con cada página estampada con su espacio y
   filtrado por el de la pestaña donde hace falta, y el mismo contrato para el
   perfil de Jira por proyecto, que cierra la decisión 5 de §12.3. §3.4,
   anexo D, **H21** y **H22**.
5. **«Dibujar flujos en el chat; si el MCP de Excalidraw requiere token,
   otra herramienta»**. No requiere token, pero no sirve: el oficial devuelve
   una «MCP App» HTML que sólo pintan hosts que soportan MCP Apps (Faro no lo
   es), y los comunitarios dibujan en un lienzo local en OTRA pestaña, con
   decenas de llamadas de herramienta por dibujo y otro MCP que instalar por
   persona. Se decide un renderizador PROPIO de un subconjunto de Mermaid
   `flowchart`: el modelo escribe un bloque ```mermaid (lo hace con soltura),
   la extensión lo valida con claves blancas y lo pinta con `createElementNS`;
   nada de `innerHTML`, ninguna dependencia, nodos navegables por
   `validatePlan`. §3.5, anexo E, **H24**.
6. **«La lista de modelos no son los que ellos tienen; que salgan en función
   de la persona; que el usuario elija el modelo al principio, antes de que
   coja contexto; en caso de error, elegir otro»** (el principal). La lista
   YA es de la persona; lo que falla es el DEFECTO (el primer `default` del
   mapa, que puede no estar permitido), que ese fallo se disfraza de fallo de
   claves y deja el sitio sin configurar, y que la recuperación adivina otro
   modelo que también falla. Se decide: el modelo es de la PERSONA
   (`settings.model`), no se elige solo la primera vez —pantalla «Elige el
   modelo» ANTES de las claves y del contexto—, los fallos por modelo se
   clasifican gratis y se recuerdan (`faro:model-checks`), y cualquier fallo
   por modelo (turno, verificación de claves, indexado) vuelve a esa pantalla
   sin culpar a las claves ni dejar el sitio a medias. §3.3, anexo C, **H16**
   y **H17**.
7. **«Más bonito el modo de subrayar: el ratón un subrayador azul, que se vea
   mejor en general»**. Hoy hay dos rellenos ámbar sumados sobre la misma
   cita, con el overlay encima de la letra (en oscuro, 3,63:1), insignias
   que tapan la palabra siguiente, la cruz del sistema como cursor y la
   selección gris. Se decide: cursor SVG de subrayador azul y selección azul
   mientras se señala; el relleno de las marcas pasa DEBAJO del texto (Custom
   Highlight) y el overlay dibuja sólo un trazo en pastilla; insignias como
   superíndice; barra de «Señalar» que cabe a 364 px; y un ajuste «Color del
   subrayado» (azul por defecto, ámbar a elegir) con las insignias y los
   botones de Faro en ámbar, que es su marca. El «rotulador» con host de
   mezcla queda condicionado a medir su coste. §3.6, anexo F, **H23** y
   **H25**.

## 3. Las seis áreas: qué se decide

### 3.1 uv, uvx y el MCP que no arranca

**Decisión**: opción A del anexo B —script de instalación + diagnóstico en el
panel + «Reintentar»—, con la ruta absoluta a uvx como variante secundaria
dentro del alta automática (§3.2) y Docker sólo documentado.

- **`tools/instalar.ps1`**, idempotente y sin admin: (1) si `uvx` está en el
  PATH, listo; si no, se busca `$HOME\.local\bin\uvx.exe`; si tampoco, se
  instala con `irm https://astral.sh/uv/install.ps1 | iex` y, si falla, con
  `winget install --id astral-sh.uv`; (2) se refresca el PATH del propio
  script desde el registro (User + Machine) para que los pasos siguientes
  vean uv; (3) `uv tool install mcp-atlassian==<VERSIÓN>`, con la versión
  como constante del repo (hoy 0.23.1, la probada), reintentando con
  `--native-tls`/`--system-certs` si fallan los certificados y diciendo qué
  variable fijar detrás de un proxy; (4) comprobación `mcp-atlassian --version`
  y `uvx mcp-atlassian --version` con su tiempo; (5) Node y `opencode
  --version` (≥1.2): si falta opencode y hay Node ≥18, ofrece `npm i -g
  opencode-ai` (pregunta sí/no; nunca instala Node); después
  `GET http://127.0.0.1:4096/global/health`: si ya hay uno corriendo,
  aviso en rojo «ciérralo y arráncalo desde una terminal NUEVA: el que está
  abierto no ve uvx» (el MCP hereda `process.env` del opencode arrancado);
  (6) resumen con rutas, versiones y el comando de arranque con `--cors`.
  Reglas: nunca escribe `opencode.json` (el BOM de PowerShell 5.1 lo rompe),
  nunca toca tokens ni contraseña, sale con 1 y una línea clara si algo
  falla. README dice `powershell -ExecutionPolicy Bypass -File
  tools\instalar.ps1`, porque un zip descargado lleva marca web. **Además
  `tools/arrancar-opencode.ps1`**: relee el PATH del registro y lanza
  `opencode serve --port 4096 --cors chrome-extension://…` pidiendo la
  contraseña si `OPENCODE_SERVER_PASSWORD` no está (sólo en memoria, nunca en
  disco): con eso el PATH viejo deja de ser un problema y el comando largo
  sale de la documentación. Y **fija `OPENCODE_DISABLE_PROJECT_CONFIG=1` y
  `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1` y arranca en una carpeta propia y
  vacía**: opencode 1.2.25 busca `AGENTS.md`, `CLAUDE.md` o `CONTEXT.md`
  subiendo desde el directorio de trabajo del serve y los mete como
  «Instructions from:» en el `system` de CADA sesión (texto que llega al
  modelo sin delimitar y sin `contentRule`, y que cuesta tokens en cada
  turno), y carga además el `opencode.json` de proyecto de esa carpeta, que
  puede tapar la entrada que Faro escribe (los tres nombres y las dos
  variables, leídos en el binario; las variables no quitan
  `~/.config/opencode/AGENTS.md`, y por eso además la carpeta propia). INSTALL
  lo dice para quien arranque a mano, y el sandbox de H18 comprueba con
  `npm run turn` que el `system` de una sesión de Faro no lleva ninguna línea
  «Instructions from:». El `.sh` para macOS/Linux, sólo si Marco confirma
  que alguien lo usa (§8).
- **`mcpFailureHint(status)`** (pura, `setup.js`) → `null` o
  `{kind, text, retry, copy}`: `/Connection closed/` → `sin-arranque`
  («opencode no ha podido arrancar el MCP: el proceso se cerró nada más
  empezar. Casi siempre es que no encuentra uvx…», con el comando para copiar;
  Faro NO puede leer el stderr: el texto dice «casi siempre» y manda a mirar
  la terminal); `/timed out after (\d+)ms/` → `lento` («la primera vez uvx
  descarga unos 107 paquetes…, pulsa Reintentar en unos segundos»); otro
  «failed» → `otro`, con el error de opencode en UNA línea, sin invisibles y
  acotado a 200; «connected» o ausente → `null`. La heurística «failed en
  menos de 2 s ≈ comando que no existe» la usa el alta automática (§3.2). El
  texto «está registrado pero en» sigue escrito UNA vez (hay un pin): el
  consejo va detrás.
- **Dónde se cablea en H15**: `showMcpSetup`, `attachMcpNotice`, la pantalla
  de conexión (una pista de qué mirar si opencode no arranca: BOM, `{env:}`
  con barras) **y el `onTick` de la espera de `showManualStep`**
  (`panel.js:6896-6905`), que es justo la pantalla en la que el compañero se
  quedó quince minutos mirando «está en failed»: son pocas líneas, H18 las
  reescribe dentro de su espera nueva y la pura se reutiliza; sin eso H15 no
  desbloquearía a nadie hasta H18. «Reintentar» llama a `client.connectMcp(name)` (ya existe; bloquea
  ~12 s: spinner, botón desactivado, host capturado antes del `await`,
  §8.22) y lee `GET /mcp` después; registro «MCP reintentado». Sin enlaces
  externos (S5): la ayuda es un comando para copiar.
- **El bloque**: `command` sigue siendo `['uvx', 'mcp-atlassian']` hasta que
  Marco decida fijar la versión (§8), `timeout` sube de 30 000 a **60 000**
  (8-12 s en caliente, 7-10 s en frío con red rápida; detrás de un proxy
  corporativo, más), y `TOOLSETS` queda como decisión (mcp-atlassian avisa de
  que su valor por defecto cambiará a «6 core toolsets», lo que quitaría
  herramientas que Faro usa; el valor exacto que significa «todas» hay que
  leerlo de su `--help` en H15).
- **Límites**: Faro no ejecuta nada ni lee el stderr de opencode; si uv se
  instala DESPUÉS de arrancar opencode, «Reintentar» con `command: 'uvx'`
  sigue fallando hasta reiniciar desde una terminal nueva (o usar la ruta
  absoluta: §3.2); tras un timeout el proceso huérfano sigue vivo y un
  reintento puede dejar dos mcp-atlassian hasta cerrar opencode; nada medido
  detrás de un proxy con inspección TLS.

### 3.2 El MCP se crea y se quita solo

**Decisión**: alta por `PATCH /global/config` con espera hasta que la entrada
aparezca y conecte, paso manual como respaldo, borrado como entrada
deshabilitada sin secretos, y una decisión nueva en CLAUDE.md que acota QUÉ
puede escribir Faro en la configuración de opencode (§5, §8.24).

- **Alta** (`saveKeys`, H18): las puertas de escritura son DOS y las dos
  cerradas, nunca un `updateGlobalConfig(patch)` genérico —con Faro
  escribiendo en la config de opencode, una puerta que aceptara cualquier
  parche permitiría meter `agent`, `permission`, `plugin` o `command`, que es
  ejecución de código—: `client.updateMcpEntries(entradas)`, un mapa nombre →
  entrada en el que CADA entrada ha pasado por `mcpWritePatch` o
  `mcpScrubPatch` (puras de `setup.js`) y que construye `{mcp: {...}}` DENTRO
  del cliente (el alta manda una; el borrado, varias en un solo PATCH); y
  `client.reloadGlobalConfig()`, que manda un cuerpo `{}` FIJO y sin
  parámetros (el «Ya lo he pegado» del respaldo manual). `mcpWritePatch`
  exige: sólo la clave `mcp`; un nombre validado por su FORMA (el de
  `mcpNameForHost`, el `mcpName` guardado, o el de la entrada habilitada que
  `GET /config` ya tiene para este dominio, que no tiene por qué seguir la
  forma de Faro); el `command` de lista blanca (`['uvx', 'mcp-atlassian' |
  'mcp-atlassian@X']` o la ruta absoluta validada de `uvx.exe`:
  `^[A-Za-z]:\\[^&|<>^"%]+\\uvx\.exe$`, porque una ruta con `&` o `^`
  inyectaría si opencode lanza por `cmd.exe` en Windows —INFERIDO del texto
  del stderr, no leído: el sandbox de H18 prueba también una ruta con
  espacios—), y el `environment` COMPLETO más `enabled: true` —todas las
  claves que Faro sabe escribir, con `""` en las que no usa, porque la fusión
  profunda no quita claves y un cambio Cloud→DC dejaría el USERNAME/API_TOKEN
  viejo; mcp-atlassian trata `""` como ausente (leído en su código)—. **Si ya
  existe una entrada HABILITADA con el dominio** (`mcpForHost` la encuentra
  hoy igual) se reutiliza su nombre y se conservan su `type`, su `command` y
  su `timeout`: se reescriben el environment y `enabled: true`. Ese `command`
  se acepta tal cual sólo si pasa la lista blanca o si coincide byte a byte
  con el que `GET /config` trae para ese mismo nombre (lo escribió el propio
  usuario en su fichero: no es código nuevo); **una entrada DESHABILITADA sólo
  se reutiliza si es el esqueleto de Faro** (nombre con la forma de
  `mcpNameForHost` o el `mcpName` guardado): una ajena que el usuario
  deshabilitó a mano no vuelve a arrancar con tokens frescos, y el alta crea
  una entrada nueva a su lado. Sólo una entrada NUEVA lleva el `command`
  estándar. Tras «Quitar las claves» las URL quedan vacías y el esqueleto no
  se encuentra por dominio: se recrea bajo `mcpNameForHost`, que es la misma
  clave —desde la revisión adversaria de H19, por el `mcpName` que el registro
  conserva, así que también desde el host enlazado o con una entrada de nombre
  propio—, y la fusión lo vuelve a habilitar (el sandbox de H19 prueba el ciclo
  quitar → crear → connected, y también «deshabilitada a mano con sus URL →
  Cambiar las claves → connected»). La opción `sensitive` de `request` hace
  que ni `OpencodeError.body` ni el registro lleven el cuerpo (hoy
  `client.js:118` registra 160 caracteres de cualquier error y un 500
  `ConfigJsonError` trae el fichero entero con los tokens), y cubre también
  `config()`: la respuesta buena del PATCH trae la config global ENTERA con
  todos los environment en claro, así que las dos puertas devuelven sólo
  `{ok, status, kind}` con `kind` sacado del `name` del JSON de error
  (`ConfigJsonError` / `ConfigInvalidError`), parseado y tirado.
- **Antes de escribir**: consentimiento la primera vez, con la ruta REAL de
  `GET /path` («Faro escribirá en <ruta>; opencode reformatea el fichero y
  reinicia sus conexiones: si tienes una respuesta a medias en otra ventana
  conectada a este opencode, se corta»); guarda común **«opencode se está
  reconfigurando»**: sólo con el panel quieto (sin turno, sin indexado, sin
  sonda de modelo; `NEEDS_IDLE`), invalidando `state.mcpCheck`,
  `state.mcpPending` y `state.mcpWait` —si no, P5 (H14) podría abrir la
  pantalla de claves con un resultado viejo justo después de escribirlas— y
  con `state.mcpConnected = false`. La guarda es local a ESTE panel: no ve
  otras ventanas de Chrome ni la TUI, y por eso en «Cambiar las claves» se
  confirma siempre.
- **Después de escribir**: NO un sleep de 300 ms (la carrera medida con un
  juguete no garantiza nada con mcp-atlassian en frío) sino sondear `GET
  /mcp` hasta que la entrada APAREZCA (tope 20 s) y después `waitForMcpReady`
  pintando el estado real con `mcpFailureHint`; **releer `GET /config`** y
  comprobar que la entrada efectiva es la escrita (una config de PROYECTO en
  el cwd del serve la taparía: con `arrancar-opencode.ps1` queda cerrado por
  construcción, §3.1, y para quien arranque a mano la relectura cuesta una
  petición); si falla con «Connection closed» en menos de 2 s **y la entrada
  es la que Faro acaba de crear con el `command` estándar**, UN reintento
  automático reescribiendo el `command` con la ruta absoluta de uvx sacada de
  `GET /path` (`<home>\.local\bin\uvx.exe`, que sólo existe con el instalador
  oficial: con winget o pip el reintento falla igual en 40 ms, porque Faro no
  puede comprobar que el fichero exista) y validada; si tampoco llega a
  «connected», otro PATCH devuelve el `command` a `['uvx', 'mcp-atlassian']`
  y sale el consejo de H15 con «reinicia opencode desde una terminal nueva»
  (cada PATCH rearranca los MCP del usuario; en el primer uso no suele haber
  otros); con cualquier otro `command` —docker, ruta propia, entrada ajena—
  no se toca nada y sale el consejo; nunca se prueba nada por `POST /mcp`.
  Si en 20 s ni aparece (una versión de opencode que no recargue: la recarga
  en caliente de 1.2.25 NO está documentada y upstream cerró sin fusionar los
  PR de hot-reload), «ya está escrito en <ruta>; reinicia opencode» y se
  sigue esperando como hoy; si el PATCH da 400/500 (clave desconocida en el
  fichero, sintaxis rota), respaldo manual con «Ya lo he pegado» →
  `reloadGlobalConfig()` (el `PATCH {}` verificado, con `sensitive`: va justo
  después de una edición a mano, que es cuando más probable es un 500 con el
  fichero entero). La versión de opencode se lee de `GET /global/health` al
  arrancar y, si no es la probada, el mensaje de espera lo dice (H18, con su
  prueba).
- **Escribir ≠ verificar**: `saveKeys` escribe; `finishSetup` verifica. Así
  volver a la pantalla de modelo tras un fallo por modelo (§3.3) repite SOLO
  la verificación y no vuelve a hacer PATCH (que abortaría turnos y
  rearrancaría todos los MCP). `configureMcp` deja de llamar a
  `addMcp`/`connectMcp`; su comentario y CLAUDE.md §7 se corrigen.
- **Adopción sin verificar**: cuando `checkMcp` adopta un MCP conectado que
  lleva el dominio (recarga a mitad del primer uso), el registro queda con
  `verified: false` y el chat avisa «claves sin comprobar» con un botón hasta
  la primera verificación buena; hoy ese sitio queda `configured` con claves
  que nunca se probaron y el primer fallo de token sale como una fila de
  herramienta fallida en mitad de un análisis. **Migración**: `verified`
  ausente cuenta como verificado —los registros de hoy no lo llevan y nadie
  tiene que ver «claves sin comprobar» por actualizar—; sólo `verified: false`
  explícito avisa (pinado con un registro guardado de hoy, y las claves
  exactas de `siteRecords` en `setup.test.js` cambian con verdad).
- **Borrado** («Quitar las claves de este sitio», en Ajustes junto a «Cambiar
  las claves», H19): confirmación en línea que LISTA por nombre cada entrada
  que se va a deshabilitar y dice que afecta también al host enlazado y a
  CUALQUIER cliente de ese opencode (la TUI incluida). Por defecto sólo
  `saved.mcpName` y las entradas con la forma de `mcpNameForHost`; una
  entrada AJENA que lleve el dominio (hecha a mano o de otro flujo) exige una
  segunda casilla explícita, y si no se marca se dice que el sitio la seguirá
  adoptando. Un solo PATCH con cada entrada reescrita ENTERA (`type`, su
  `command`, `enabled: false`, todas las variables a `""`: una entrada parcial
  da 400 y `{enabled: false}` a secas deja los tokens en disco); relectura de
  la entrada efectiva; en `chrome.storage`, `configured: false`, `mcpName:
  ''`, `skippedKeys: false`, `jiraHost`/`confluenceHost: ''` en TODOS los
  registros de ese MCP, sin tocar índice, contexto, memoria ni `onboarded`
  (no es «Olvidar este sitio», que sigue sin tocar opencode); invalidar
  `mcpCheck`/`mcpWait`/`pendingMcp` y `bootForSite()`, que llega a la
  pantalla de claves por el camino normal sin bucle. Queda un esqueleto
  deshabilitado en `opencode.json`, y se dice. (Desde la revisión adversaria de
  H19, `mcpName` se conserva: tras quitar, el esqueleto ya no lleva el dominio,
  y es ese nombre lo que hace que se reutilice desde cualquier host del MCP y
  que la pantalla de claves lo vea «disabled»; el registro de un host enlazado
  sólo se desmarca si no apunta a ningún MCP o apunta al quitado; y bajo
  `saved.mcpName` una entrada es de Faro sólo si su `command` es el de Faro:
  lo adoptado con docker o pegado a mano va con la casilla de las ajenas.)
- **Integración GRATIS** (sin modelo): `tools/config-sandbox.mjs`, fuera de
  `npm run check` y de `test:integration` como `bench` y `contrast`, arranca
  `opencode serve` con el HOME entero redirigido (el `start-iso.ps1` del
  anexo A), comprueba `GET /path` antes de escribir y verifica con el MCP de
  juguete: PATCH → connected en menos de 2 s; entrada deshabilitada → disabled
  y tokens `""` en disco; `{}` recarga lo pegado a mano; fichero roto → no se
  escribe nada. Es la única forma de probar la escritura sin tocar el fichero
  de nadie.

### 3.3 El modelo es de la persona, se elige antes y se vuelve a elegir cuando falla

**Decisión**: opción B del anexo C, partida en dos hitos (la parte pura y los
agujeros del primer uso primero; la pantalla después) y con las objeciones de
los dos jueces aplicadas: sin sonda en el primer uso, veredicto a nivel de
proveedor, la pantalla ANTES de lanzar `checkMcp`, y lo global visible en «Qué
guarda Faro de mí».

- **Fuente y forma**: `client.models()` sigue leyendo `GET /config/providers`
  (es por persona) y gana `isDefault`, `toolcall`, `status`, `variants` y el
  `reasoning` arreglado (hoy lee `m.reasoning`, que no existe: siempre
  `false`). Puras en `models.js`: `usableModels` (fuera `deprecated` y
  `toolcall: false`, marcados y no borrados si no queda nada),
  `classifyModelFailure(rawError, {stalled})` → `plan` (400/403 con «not
  supported», «not available», «free tier»), `credenciales`
  (`ProviderAuthError`/401), `mudo` (stalled o sin texto), `transitorio`
  (429/5xx), `otro`, probada con los tres `rawError` REALES medidos;
  `availableFromError` lee la lista «Available models: […]» de Copilot y marca
  como `plan` los del proveedor que no estén (aquí 3 de 32, sin gastar nada);
  **veredicto de PROVEEDOR**: el 403 «free tier can only be used from within
  OpenCode» marca todos los `opencode/*` de golpe (no se codifica fijo: con
  una clave de opencode Zen sí funcionarían); `normalizeModelChecks` y
  `modelVerdict` con reloj inyectado; `recommendModel` sólo PRESELECCIONA en
  la pantalla (último ok → `config.model` de opencode → un default de
  proveedor sin fallo → nada); `pickAlternativeModel` (borrada en H17: sin
  uso desde que errorNode elige con pickRetryModel) y `pickPlannerModel`
  saltan lo que ya falló (se acaba el bucle `gpt-5.4 ⇄ claude-sonnet-4.6`, y
  el planificador deja de caer en `gpt-5.3-codex-spark`). `fillModels` no
  asigna un modelo que no está en la lista.
- **Prioridad**: el modelo es de la PERSONA → `settings.model`
  (`DEFAULT_SETTINGS.model = null`, `migrateSettings` con claves blancas);
  `saved.model` del sitio queda como migración (si vale, se copia una vez a
  `settings.model`); `panel.js:2594` deja de escribir `saved.model` tras cada
  turno y el cambio del desplegable escribe `settings.model`. Con global, el
  segundo sitio no vuelve a preguntar.
- **Caché de veredictos**: clave GLOBAL `faro:model-checks`
  (`STORAGE_AREAS` `local`; no es por host, `forgetEverythingFor` no la toca)
  = `{version: 1, server, fingerprint, checks: {'prov/model': {ok, reason,
  message ≤200 de una línea sin invisibles, at}}}`, tope 100; `fingerprint`
  = los proveedores conectados y sus ids (un `opencode auth login` la
  invalida entera; otro `server` también). TTL por motivo (propuesta: ok y
  plan 7 días, credenciales 1 h, mudo 1 día, transitorio 15 min). Todo fallo
  por modelo en un turno la apunta gratis. **Se ve y se borra** (§8.20): una
  sección global en «Qué guarda Faro de mí» —«modelo elegido: X · N
  veredictos»— con «Olvidar los veredictos» (no borra el modelo elegido); esa
  fila enseña `settings.model` validado como `prov/model` y una cuenta
  `.length`, y es una excepción nueva a la lista BLANCA `PERMITIDO` de
  `panel-wiring.test.js:3699`, que H16 amplía y que §4.11 justifica (el id
  del modelo no es contenido del sitio, como no lo es la clave del proyecto
  del perfil); y `settings.model` NO entra en `pushSettings` (el pin de
  SEGURIDAD de H6 «la contraseña no viaja» sigue valiendo).
- **La pantalla `screen-model`** (H17): `.screen-head` con «Elige el modelo»,
  párrafo («Estos son los modelos que tu opencode tiene conectados. Faro los
  usa para todo: contestar, comprobar tus claves y escribir el contexto.»),
  lista por proveedor (un `fieldset` por proveedor, una fila `radio` por
  modelo con su nombre, «predeterminado de opencode» / «el de tu
  configuración» y su veredicto: «funciona · hace 2 h», «no disponible con tu
  plan: <mensaje del proveedor>», «no contesta», «credenciales caducadas:
  opencode auth login»), los no disponibles plegados bajo «No disponibles
  (N)», filtro de texto (43 modelos no caben a 320 px sin buscar), estado con
  `announce()`, botones «Usar este modelo» (primario), «Comprobar» (sonda
  opcional, ver abajo) y una flecha de cierre que existe siempre en el HTML y
  nace con `hidden` en el primer uso —también al volver del paso 4 o 5 de la
  máquina de abajo— y sólo se enseña desde Ajustes o desde un error de un
  turno; `screen-model` entra en `ESCAPE_CLOSES` y el manejador de Escape
  gana la guarda de no pulsar un botón que falte o esté oculto (hoy hace
  `$(btn).click()` sin mirarlo, `panel.js:6501-6504`), pinada por regex; la
  lista exacta de `screens.test.js` y la cabecera de `screens.js` («sólo las
  pantallas de CONSULTA») cambian con verdad en H17. Sin proveedores
  conectados: «Tu opencode no tiene ningún proveedor de modelos conectado.
  Ejecuta `opencode auth login` en una terminal, reinicia opencode y pulsa
  Reintentar» (Faro no conecta proveedores: `PUT /auth` existe pero es
  escribir credenciales, fuera). Ajustes gana «Cambiar el modelo». Si no llegó
  la lista de modelos y hay un modelo guardado (`settings.model`, o
  `saved.model` por migrar), se conserva el aviso de P4 en el chat y se usa
  ese modelo sin validarlo —la migración y el «no está en la lista» sólo se
  deciden con lista, y quien ya estaba configurado no ve ninguna pantalla
  nueva—; sólo sin ningún modelo guardado sale esta pantalla con ese mensaje
  y «Reintentar» (el pin de P4 de `panel-wiring.test.js:985` se conserva, y
  H17 añade la rama «lista caída sin modelo guardado»).
- **Sonda**: `client.probeModel(model, {timeoutMs 15 000, signal})` —sesión
  desechable con `SAFE_PERMISSIONS`, «Responde sólo: ok», la `variant` más
  barata que el modelo declare, y SIEMPRE `abort` + `deleteSession` en
  `finally` (DELETE no cancela el turno, §7)—, pero **no en el primer uso**:
  dos pasos después `verifyCredentials` hace un turno REAL con ese modelo y
  una sonda gastaría una request de pago más para saber lo mismo unos
  segundos antes. La sonda queda como «Comprobar» opcional al cambiar de
  modelo desde Ajustes o desde un error, donde no hay un turno inmediato que
  la sustituya. Los rechazos cuestan 0,2-1,3 s y, por lo leído, no cuentan
  como request (supuesto: no documentado).
- **El primer uso, como máquina de estados** (esto es lo que ningún informe
  escribía entero, y es justo donde falló el compañero; se pina por posición
  en `bootForSite`):
  0. Sin opencode → pantalla de conexión, con la pista nueva de H15.
  1. Con opencode y sin modelo resuelto (`settings.model` ausente, no en la
     lista, o con veredicto de fallo vigente) → **`screen-model` ANTES de
     lanzar `checkMcp`** (una comprobación de 14 s no corre bajo una pantalla
     que puede tardar minutos, y su resultado tardío no abre la pantalla de
     claves encima); al aceptar, `saveSettings({model})` y `bootForSite()`,
     un rearranque de verdad («Omitir» hace lo contrario: apaga el arranque
     en curso con un testigo nuevo y NO rearranca, y está pinado así; no es
     el patrón). Si el modelo resuelto tiene veredicto de
     fallo y el panel no está en el primer uso, la pantalla se abre sola sólo
     si `puedeAbrirPantalla()`; si no, aviso en el chat con «Elegir otro
     modelo» (el patrón de `attachMcpNotice`).
  2. Modelo elegido → `checkMcp` (con `primeraVez` se espera) → MCP del host
     conectado → paso 4; si no → paso 3.
  3. Pantalla de claves → «Guardar» → consentimiento → PATCH → espera (§3.2)
     → connected → paso 4; failed → diagnóstico y reintentos (§3.1, §3.2);
     PATCH 400/500 → respaldo manual.
  4. Verificación (`finishSetup`): `verifyCredentials` por producto con el
     modelo elegido. `reason 'modelo'` → veredicto gratis, **NO se culpa a las
     claves** («El modelo «X» no ha podido contestar (motivo). Tus claves no se
     han llegado a probar: elige otro modelo»), se conserva `state.pendingMcp`
     y se vuelve a `screen-model`; al elegir, se repite SOLO `finishSetup`.
     `reason 'credenciales'` → «Cambiar las claves». `sin-herramientas` → como
     hoy. Ok → `siteRecords` + `saveSite({configured, verified: true})` →
     paso 5.
  5. Pantalla de contexto → Generar / Subir / Omitir. Un fallo del indexado
     por modelo NO escribe `onboarded: true` (hay que llevar `rawError` desde
     `promptStructured`/`buildContext` hasta el `catch`), vuelve a
     `screen-model` y ofrece reintentar el indexado; el aviso «El indexado
     falló» se pinta DESPUÉS de repintar el chat (el pendiente de H2).
  6. Recarga a mitad: `checkMcp` adopta con `verified: false` y aviso hasta la
     primera verificación buena (§3.2).
  **Coste en turnos de pago del primer uso**: verificación (1 por producto,
  hasta 2, en la misma sesión) + indexado fase 1 (1) + el planificador del
  primer turno de Búsqueda; sin sonda. Juntar la verificación de los dos
  productos en UN turno queda como decisión (§8).
- **Caminos de error fuera del primer uso**: `errorNode` ofrece «Elegir otro
  modelo» (abre la pantalla con el fallido a la vista y su motivo, y la
  preselección en la recomendación —revisión adversaria de H17: con el fallido
  marcado, «Usar este modelo» repetía el fallo, y en los modos sin flecha era
  la única salida; se puede seguir eligiendo tocándolo—; al elegir se
  reescribe la pregunta en el cuadro SIN mandarla, §8.20) y conserva
  «Reintentar con X» sólo si X tiene veredicto ok vigente. Registro: «Modelo
  elegido», «Modelo comprobado» (ok con ms, o warn con motivo), «Modelo no
  disponible» (fallo en un turno real).
- **Límites**: un ok de la sonda o de la verificación dice que el modelo
  CONTESTA, no que numere bien ni escriba el JSON de anclas (eso sigue en la
  escalera de §4.4); los veredictos caducan por TTL, y un cambio de plan en
  medio no se ve hasta que falle un turno (que lo apunta gratis); hacer el
  modelo global cambia un comportamiento (quien usaba modelos distintos por
  sitio los pierde: decisión de Marco); el formato de la lista de Copilot es
  texto libre y si cambia sólo se pierde la ventaja gratis.

### 3.4 Varios espacios de Confluence y varios proyectos de Jira

**Decisión**: opción (iii) del anexo D —híbrida— en dos hitos, con las
objeciones aplicadas: desde Jira viaja UN solo espacio del Confluence enlazado
(nunca el reparto a partes iguales), la migración va a `*` cuando el ámbito no
se puede afirmar, y el índice lleva tope total.

- **Por qué ésta y no las otras**: (i) partir el índice y dejar el contexto
  por host NO resuelve lo que pide Marco (el CONTEXT.md se sigue pisando);
  (ii) una clave por (host, espacio) rompe el olvido derivado de H13
  (`hostKeys` llama a `make(host)` con un solo argumento y borraría
  `faro:context:<host>:undefined`), la lectura única de P4, y el paso a paso
  entre espacios que HOY funciona (el índice de B no conocería las páginas de
  A). (iii) no añade ninguna clave a `STORAGE_KEYS`: el olvido, las áreas y
  el paquete del sitio siguen igual, y cambiar de espacio no cuesta ninguna
  lectura porque todos los contextos del host ya están en memoria (240 KB
  con diez, medido).
- **Contrato** (pura nueva `src/shared/scopes.js`, en `shared/` porque la
  comparten storage.js y el panel): `scopeKeyOf(site)` → `'space:KEY'`
  (`validSpaceKey`) | `'project:KEY'` (`validProjectKey`) | `'*'`;
  `CONTEXTS_VERSION = 2`; `normalizeContexts(raw, {legacyScope, now})` →
  `{version: 2, scopes: {[k]: {text, at, indexedAt, legacy}}}` con claves
  blancas, `Object.hasOwn`, lo que no casa con `SCOPE_KEY` se cae, y un
  string (lo de hoy) migra bajo `legacyScope` **sólo si el `index.scope`
  guardado tiene `indexedAt` coherente con él; en cualquier duda —índice de
  otra versión, `scope` `confluence-site`, contexto subido a mano por
  `uploadContext`, que no cambia `index.scope`— va a `'*'`**, que se enseña en
  todos los espacios, o sea el comportamiento de hoy y sin regresión;
  `contextFor(ctxs, key, {fallback: '*'})`, `withContext` (inmutable),
  `scopesWithMap`, `pagesOfSpace`, `subIndex` (sólo filtra `pages`),
  `stampSpace` y `linkedSpacesFor`. `faro:context:<host>` pasa de string a ese
  objeto: misma clave, misma área, `getSiteBundle` cambia `contextMd` por
  `contextRaw` (el pin de claves exactas cambia con verdad), `memory.js`
  gana `getContexts`/`saveContexts` que normalizan al leer y al guardar. El
  índice se queda en v3 y en una clave, sin migración: `scope` pasa a ser
  informativo («el último ámbito indexado») y `growTreeFromPage` estampa
  `spaceKey: state.site.spaceKey` en las filas que hoy entran con `null`.
  «Tiene mapa» pasa a ser por ámbito con UN solo criterio,
  `scopes[k].indexedAt`. **Ningún espacio se desaloja solo** (sería lo
  contrario de «que se guarde un árbol u otro»): `INDEX_LIMITS.maxPagesTotal`
  se MIDE en H21 (`npm run bench` con diez espacios de 300: hoy 600 páginas
  son 65 KB y `persistIndex` escribe el objeto entero en cada turno, P3) y,
  al alcanzarse, indexar un espacio nuevo por la API se para con un aviso
  hasta que se olvide otro desde Ajustes («Olvidar el mapa de X», que borra
  sus páginas, su `indexedAt` y su contexto). `sites[host].onboarded` se
  queda: «el sitio ya pasó la primera configuración». Nada se anida en
  `sites[host]` salvo el mapa `linkedSpaces` de más abajo, que escribe entero
  un único escritor: `saveSite` funde a un solo nivel.
- **Flujo**: `refreshTab` gana `changedScope` (dentro del camino sin
  `changedHost`, sin ninguna lectura del almacén): recalcula
  `state.contextMd`, `state.references`, sube el testigo de las sugeridas y
  repinta el chip del mapa. `generateContext` guarda bajo host **y ámbito**
  capturados al empezar (§8.22), con leer-fundir-escribir de la clave entera
  y relectura justo antes de escribir (dos indexados del mismo host en
  paralelo tienen una ventana de milisegundos, como el diario de §4.10; peor
  caso, perder un contexto recién generado). Entrar en un espacio sin mapa
  propio NO abre la pantalla de contexto: una línea en el chat vacío «DCPIAS
  aún no tiene mapa · Construir» y la tarjeta «Me falta el mapa de este
  espacio» sólo cuando, en Confluence con `spaceKey` válido y sin páginas de
  ese espacio, `planNavigation` no devuelve plan. **La guarda que corta sigue
  siendo `indexSize` del índice entero** (`panel.js:3323`): `indexSize` cuenta
  también proyectos e incidencias, y desde un espacio sin mapa un «Destino:
  título (id N)» de OTRO espacio del índice tiene que seguir dando su
  `navCard` con el paso a paso que hoy funciona (empieza por «Espacio X» y
  sigue su rama); en Jira la guarda no cambia. Las dos cosas van pinadas en
  H21. `indexDigest` y `suggestFromIndex` ganan `preferSpace`:
  el espacio de la pestaña DELANTE sin excluir los demás (una página base de
  otro espacio es legítima). El paso a paso entre espacios se mantiene.
- **Qué ve el modelo**: `baseSystem` gana `contextScope` opcional; con él la
  cabecera dice `--- CONTEXTO DE ESTE SITIO (espacio «DCPIAS»; …) ---`
  conservando el PREFIJO que usan los cortes de `prompts.js:723`; sin él
  (contexto `'*'`), byte a byte lo de hoy: las 37 instantáneas no cambian y
  se añaden 2 escenarios. En un espacio sin contexto propio: el `'*'` si
  existe y, si no, una sola línea de Faro fuera de bloque «Este sitio tiene
  mapa de otros espacios: «SIMPL», «OPS»» —cada clave por `validSpaceKey`,
  citada entre «», acotada a `LOCATION_LIMITS.key` (40) y como mucho seis,
  porque `validSpaceKey` admite claves personales de 255 caracteres con `:`,
  `.`, `_` y `@` y una línea que habla como Faro no puede llevar una frase
  dentro; pinado en `seleccion.test.js`—.
  Desde Jira, `linkedSpacesFor` elige UN espacio del Confluence enlazado, en
  este orden y determinista: (a) los espacios de las páginas que el CONTEXT.md
  del proyecto cita con id (el más citado primero); (b) los de las páginas
  base que el historial de ese proyecto usó; (c) el único con contexto; y si
  no hay regla, el `'*'` heredado más la línea de las claves; **como respaldo
  manual, un selector en Ajustes «este proyecto se documenta en el espacio
  X»**, porque los contextos generados antes de H9 casi nunca citan ids; el
  mapeo vive en `sites[host].linkedSpaces` (proyecto → espacio), un mapa que
  escribe ENTERO su único escritor, el selector, y que se valida clave a
  clave al leer. **Todo esto es de H22, no de H21**: la regla (a) y el
  selector necesitan el ámbito `project:KEY`. Y una precisión que toca una
  promesa escrita: con la regla (b) el historial de páginas base ELIGE qué
  CONTEXT.md enlazado viaja —sólo la clave, dentro de `loadLinkedContext`;
  nunca aporta texto ni llega a `prompts.js`/`skills.js`—, así que la frase
  de CLAUDE.md §4.4 («el historial no entra en ningún prompt») y la cabecera
  de `source-history.js` se reescriben con verdad («el historial elige qué
  contexto enlazado viaja, y nada más») y H22 lo pina en `scopes.test.js`
  (`linkedSpacesFor` devuelve sólo una clave por `validSpaceKey`) y en
  `panel-wiring` (`baseSystem` no recibe nada derivado del historial salvo
  ese contexto). Si Marco prefiere la promesa literal, se quita la regla (b)
  y quedan (a), (c) y el selector (§8, decisión 9).
- **Jira (H22)**: `scopeKeyOf` → `'project:KEY'` con el mismo contrato;
  `faro:profile:<host>` pasa a `{version, byProject: {KEY: perfil v2}}` con
  `normalizeProfiles` (el perfil suelto de hoy migra bajo su `projectKey`),
  `profileForProject` busca en el mapa, `refreshTab` deja de recontar al
  alternar proyectos (`profileAsked` sigue como tregua). Cierra la decisión
  5 de §12.3.
- **Privacidad** (§4.11): la fila «contexto» pasa a «N espacios/proyectos con
  contexto (SIMPL, DCPIAS…)» e «índice» a «N páginas en M espacios». Las
  claves de ámbito son otra excepción a la lista blanca `PERMITIDO` de
  `paintPrivacy` (`panel-wiring.test.js:3699`), que H21 amplía con la cuenta
  de ámbitos sacada de `contextRaw` y con claves pasadas por
  `validSpaceKey`/`validProjectKey`, y que §4.11 justifica igual que
  `perfil.projectKey`: la clave dice DE QUÉ es lo guardado, no qué guarda.
- **Banco**: `tools/cql-eval.mjs` gana un segundo espacio OPS (árbol y
  portada propios) y el tramo 63 pina que `subIndex(ENG)` da página a página
  lo del tramo 51, que `treeTitles(subIndex(OPS))` no lleva ningún id de ENG
  y que `treeSteps` a una página de OPS estando en ENG empieza por «Espacio
  OPS».
- **Límites**: todos los contextos del host se leen en cada arranque (unos
  24 000 caracteres por ámbito, que es lo que cabe en el prompt y lo que un
  CONTEXT.md suele medir —el almacén no lo acota—: con decenas, cientos de
  KB; `npm run bench` puede medir
  `normalizeContexts` con 20); las páginas cosechadas de las herramientas
  entran sin espacio y no cuentan para «tiene mapa» (el mapa lo da el árbol
  de la API, que siempre lo trae); indexar un segundo espacio en real gasta
  un turno de modelo.

### 3.5 Diagramas en el chat

**Decisión**: opción (2b+c) del anexo E —subconjunto de Mermaid `flowchart`
escrito por el modelo, traducido a una forma interna validada y pintado por un
renderizador propio— con la objeción de los dos jueces aplicada: **primero el
renderizador y un botón «Dibujar el flujo»**, sin tocar el prompt de Análisis
hasta leer turnos reales; la cosecha por API de claves del diagrama, aparte y
condicionada.

- **Por qué no las otras**: el MCP oficial de Excalidraw devuelve una «MCP
  App» que Faro no sabe pintar y los comunitarios dibujan en un lienzo en
  otra pestaña con decenas de llamadas por diagrama, otro MCP por persona
  (justo lo que el equipo ya sufre con uvx) y `*_excalidraw_*` en
  `SAFE_PERMISSIONS`, y ningún nodo sería navegable (§8.3); Mermaid
  vendorizado pesa 3,57 MB, devuelve cadena para `innerHTML` (§9 lo
  prohíbe), lleva DOMPurify y 19 `innerHTML` dentro y tiene historial de XSS
  2025-2026; viz.js 1,4 MB y cadena; un DSL JSON propio lo escriben peor los
  modelos pequeños y no se puede pegar en ningún sitio; y pedirle al modelo
  elementos Excalidraw con coordenadas sale mal casi siempre. Puntuación
  del investigador (dependencias/seguridad/fiabilidad/visual/esfuerzo/
  mantenimiento): propia 24, DSL 23, viz 19, Mermaid y Excalidraw JSON 18,
  MCP 14.
- **Contrato** (`src/panel/diagram-parse.js`, puro): `parseFlowchart(src)` →
  `validateDiagram` → `{ok, direction, nodes: [{id, label, shape, kind, ref,
  note, sub}], edges: [{from, to, label, style, arrow}], subgraphs, errores}`
  con claves EXACTAS; `DIAGRAM_LIMITS` {srcMax 6 000, nodes 30, edges 60,
  labelMax 80, edgeLabelMax 40, idMax 32, subgraphs 6}; etiqueta de una línea
  con `sinInvisibles` + NEL colapsado; `shape` de lista blanca; `kind` sólo de
  `NOTE_KINDS` (`:::riesgo`); `ref` = `{kind: 'jira-issue', id}` si la primera
  palabra de la etiqueta pasa `validIssueKey` (o `confluence-page` por id
  numérico); `note` = el primer `[n]` de la etiqueta. Se RECHAZAN con motivo
  `click`, `href`, `callback`, `style`, `classDef`, `linkStyle`,
  `%%{init}%%` y cualquier otro tipo de diagrama. Tolerancia a ampliar antes
  de dar el hito por bueno: `A --> B & C`, comillas con corchetes, `--x`/`--o`
  e ids con guion (la PoC entiende 5 de 9 variantes típicas). `toMermaid` con
  ida y vuelta exacta.
- **Layout** (`diagram-layout.js`, puro): Sugiyama simplificado (ciclos por
  DFS, capas por camino más largo, ficticios, baricentro), con la **medida
  del texto inyectada** (`canvas.measureText` con la fuente del panel en el
  panel; la estimación de 6,6 px/carácter en Node para las pruebas). Plan B
  sin cambiar el contrato: vendorizar sólo `dagre.min.js` (284 KB, MIT, sin
  DOM) si el layout propio se queda corto en grafos densos (decisión).
- **Vista** (`diagram-view.js`, DOM): `<figure class="dg-wrap">` con `<svg
  role="img">` + `<title>` + `<desc>`, un `<g tabindex=0 role=button>` por
  nodo navegable, una lista equivalente plegada («Ver como lista») y «Copiar
  como Mermaid» (que Excalidraw importe Mermaid pegado es un SUPUESTO —el
  anexo E no lo verifica— que H24 comprueba antes de descartar «Descargar
  .excalidraw»). NUNCA `innerHTML`. A 320 px, `overflow-x: auto`
  y el SVG a su tamaño; escala al ancho si cabe con ≥0,75.
- **Navegación** (§8.3): todo nodo con `ref` es un botón y la navegabilidad
  se decide AL HACER CLIC: `validatePlan` + `runPlan('direct')` contra el
  índice de ese momento, como `openIssueFromResults`, y si la clave no está
  en el índice, un aviso «no está en el índice» en la tarjeta. No se decide al
  pintar porque en `send()` el pintado final (`panel.js:2555`) va ANTES de
  `growIndex` (`2675`, detrás de `offerNotes`): las claves cosechadas en ese
  mismo turno saldrían sin enlace en vivo y con enlace al restaurar. Un `[n]`
  llama a `focusNote` sólo si esa nota existe. La consulta por API para
  cosechar las claves que faltan NO va aquí: metería una tercera procedencia
  de JQL con claves sacadas de la prosa del modelo (§8.12 pina hoy dos
  emisores de `JQL_SEARCH`, y M4 exige proyecto conocido); si se quiere, va
  en H25 como `kind` nuevo de `RECENT_ISSUES`, plantilla elegida por `kind`
  en `bootstrap.js`, `validIssueKey` en el content script y sólo proyectos
  conocidos.
- **Integración**: `parseBlocks` gana `closed` en el bloque `code`;
  `renderMarkdown` gana `onCodeBlock(lang, text, closed)`, pasado en las
  cuatro llamadas del panel como `allowHref`, y sólo dibuja `mermaid` con la
  valla CERRADA (durante el streaming, el código); si el parser falla o
  quedan menos de 2 nodos, el bloque de código de hoy más una nota «No he
  podido dibujarlo: …». Se restaura solo (vive en la prosa guardada en
  opencode). `answerAnnouncement` no lee la valla. Registro: «Diagrama».
- **Cómo se pide**: por defecto **sin cambiar el prompt de Análisis**: bajo
  una respuesta de Jira que cite tres o más claves, un botón «Dibujar el
  flujo» que deja escrita la pregunta como «Preguntar sobre estos» (coste
  cero si no se pulsa, 37 instantáneas intactas, y el PROMPT de §4.4 no se
  toca: `shortAnswer` sobre la respuesta original, «Sin observaciones.» como
  última línea, `formatReminder` cerrando el sistema) y apunta una marca de un
  solo uso, `state.pendingDiagram` con su host, consumida en `send()` como
  `state.pendingPreload` de H12. **El turno que la lleva no pasa por
  `offerNotes`**: con la Skill Análisis una respuesta que es sobre todo una
  valla no tiene `[n]` fuera de código y, como `respuestaCorta` se mide con la
  valla dentro (`panel.js:3748`), caería casi siempre en `segmentedPassNotes`
  (`3870-3877`), un turno de pago más que acaba en «Pedirlo numerado» porque
  `insertMarks` nunca marca dentro de código; sale en silencio con «Sin
  marcas · la pregunta era dibujar el flujo» en el Registro, sin segunda
  pasada ni aviso, y el pin de H24 exige esa salida ANTES de
  `segmentedPassNotes`. Sólo después de leer turnos reales con `npm run turn`
  se decide si la viñeta va siempre en Análisis y Búsqueda de Jira (9
  instantáneas). Sólo en Jira, como pidió el equipo.
- **Estilo**: clases `.dg-*` con tokens que ya existen (contraste medido:
  texto ≥13, bordes ≥3,26) y cuatro parejas nuevas en `test/contrast-pairs.js`.
- **Límites**: sólo `flowchart`; layout menos pulido que Graphviz en grafos
  densos (una arista larga rodea por fuera); un grafo de 30 nodos en cadena
  mide 2 600 px de alto (el prompt, cuando exista, pedirá ≤15 nodos y LR);
  y nada probado en el panel real.

### 3.6 El subrayado

**Decisión**: opción (iii) del anexo F reducida —la herramienta de «Señalar»
siempre azul; las marcas de resultado en azul por defecto con ámbar a elegir;
las insignias `[n]` y los botones de Faro en ámbar, que es su marca y lo que
pinan `panel-css` y el espejo— con la forma A de serie (relleno bajo el texto
y trazo en el overlay) y el «rotulador» con host de mezcla (forma B) en un
hito condicionado a medir.

- **Por qué no «todo azul»**: rompe la identidad de Faro (el panel entero
  quedaría mezclado o habría que repintar 23 parejas), choca con el azul de
  Atlassian (`#0C66E4` de botones y enlaces: la marca se confundiría con la
  interfaz del sitio) y en claro ningún azul que lleve texto oscuro llega a
  3:1 sobre blanco, igual que el ámbar.
- **Cursor**: módulo puro `src/content/overlay/cursor.js` con dos SVG de
  32×32 (claro y oscuro: cuerpo `#3B82F6`/`#60A5FA`, anilla marino, punta
  biselada, halo blanco, sombra suave y un trazo de tinta bajo la punta) y el
  punto activo «5 27» en la punta; en `PICK_CSS`: `html.faro-picking,
  html.faro-picking * { cursor: url("data:image/svg+xml;utf8,…") 5 27, text
  !important }` (respaldo `text`, porque lo que se hace es seleccionar texto)
  y la variante oscura por clase, que `setPicking` pone reutilizando
  `_applyColorScheme`; las imágenes conservan `copy`. Chrome acepta el SVG
  (verificado en el banco); la **CSP `img-src` de los sitios reales no está
  comprobada**, y es una sonda de un minuto con el método blob de H14 que se
  hace ANTES de escribirlo. Si la bloquea, se degrada al respaldo `text` y
  **no se expone ningún recurso nuevo**: `web_accessible_resources` sólo
  lleva patrones `.js` (`manifest.json:54-66`, pinados por
  `web-accessible.test.js:185`), y una URL `chrome.runtime.getURL` escrita en
  la hoja `#faro-pick-style` que el overlay cuelga del `document.head`
  (`overlay.js:811-817`, y no la quita nunca) dejaría a la vista de la página
  el GUID de sesión que S7 (§8.21) existe para esconder; H23 pina que ni
  `chrome.runtime.getURL` ni `chrome-extension://` aparecen en `PICK_CSS` ni
  en nada que se escriba en el documento.
- **Selección y barra**: `html.faro-picking ::selection { background-color:
  rgba(59,130,246,.32); text-decoration: underline 2px #2563EB; … }` (nunca
  global: no se pisa la selección de la página fuera de «Señalar»); el faro
  de la barra y el recuadro al pasar por una imagen en azul; en la barra la
  pista cede antes que el texto y por debajo de 480 px se oculta y la barra
  envuelve (a 364 px hoy el texto elegido mide 0 px y «Cancelar» se sale).
  «Usar esto» sigue siendo el `.btn-primary` ámbar.
- **Marcas (forma A)**: el relleno se va del `.quote-rect` a
  `::highlight(faro-quote)` / `::highlight(faro-quote-activa)` con
  `priority`, DEBAJO del texto (en oscuro 3,63 → 4,91 en ámbar, más con
  azul), y el overlay dibuja sólo un trazo en pastilla de 3 px con los
  extremos redondeados 1 px bajo la línea (4 px y más oscuro en la activa);
  el barrido blanco se sustituye por un «se dibuja» con `scaleX` (.45 s,
  escalonado como hoy), anulado con `faro-still` y `prefers-reduced-motion`;
  en código, sólo el trazo, como hoy. `HIGHLIGHT_CSS` vive en el documento y
  no ve las variables del host: el color por tinta va en literal (o por una
  clase en `<html>`, como `faro-picking`). En `forced-colors`, `outline: 2px
  solid Highlight`.
- **Insignias**: superíndice que no tapa la palabra siguiente (`top =
  ultimo.top - 6`, `left = ultimo.right + 1`), 16 px, radio de pastilla, fondo
  `--faro-gold`, borde `--faro-gold-deep`, texto `#1B1405` (el pin sigue),
  anillo de 2 px del papel para despegarla, entrada por escala y opacidad sin
  rebote; `libre()` sigue evitando que dos se pisen. Riesgo anotado: puede
  rozar los descendentes de la línea de arriba con un interlineado apretado.
- **Ajustes**: `highlightColor: 'azul' | 'ambar'` (azul por defecto, viaja por
  `pushSettings`; el pin de claves exactas de `service-worker.test.js` cambia
  a propósito); el radio «marca el texto en amarillo» deja de ser verdad y se
  reescribe. **Dos estilos** de momento (Subrayado mejorado y Foco): el
  verde y el tercer estilo, sólo si alguien los pide (el usuario pidió «más
  bonito», no más opciones, y Ajustes ya gana botones en A y C).
- **Rotulador (forma B, H25, condicionado)**: un segundo host `fixed` con
  `mix-blend-mode: multiply` (claro) o `screen` (oscuro), sólo mientras haya
  marcas, con la franja del 72 % inferior de la línea, radios irregulares y
  `skewX(-6deg)`; el código nunca va ahí. Es la pieza que de verdad parece un
  subrayador (11,20 y 6,01 de texto bajo la tinta), pero mete una segunda
  raíz en el documento, GPU en cada frame de scroll SIN medir y una elección
  multiply/screen que falla en zonas de tema mixto: sólo pasa a ser el valor
  por defecto si un trace de Performance en el banco (`scrollStress`,
  `stress`, p95 de frame, la misma máquina) no empeora y se ve en el tema
  oscuro real.
- **Límite anotado, no regresión**: un ENLACE de Atlassian dentro de la marca
  azul queda en 4,41 (claro) y 4,14 (oscuro), mejor que hoy (4,32 y 3,25)
  pero por debajo de 4,5; se imprime en `npm run contrast` como anotado y no
  se exige. Y ni el puntero moviéndose ni la nitidez del SVG al 150 % de
  escala de Windows se han visto: todo está en el banco con los módulos de
  verdad del overlay.

## 4. Hitos, en orden

Reglas transversales, que salen de los dos juicios y valen para todos:

- **Antes de tocar código en H16-H19, la máquina de estados del primer uso de
  §3.3 es la especificación**: cada estado con su contraparte visible
  (§8.14) y cada camino de error con su prueba. Cada uno de los cuatro
  bloques de `panel.js` que las tres áreas comparten tiene UN hito dueño que
  lo reescribe, y los demás sólo le añaden por posición con los pines de
  `panel-wiring` (326-335 y 609-620) que cada uno actualiza: `bootForSite`
  pasos 3-5 → dueño H17 (H16 sólo cambia cómo se resuelve el modelo; H21
  añade la carga de contextos); `finishSetup` → dueño H17 (la reentrada sin
  volver a escribir, que es la separación escribir/verificar; H16 añade la
  rama `'modelo'`; H18 sólo le quita la escritura); `saveKeys`/
  `showManualStep` → dueño H18 (H15 añade el consejo al `onTick`); el `catch`
  de `generateContext` → dueño H16 (H21 añade el ámbito).
- **Una guarda común «opencode se está reconfigurando»** (H18) que suspende
  sondas e indexados, invalida `mcpCheck`/`mcpPending`/`mcpWait` y se
  confirma en «Cambiar las claves»; ningún área la resuelve por su cuenta.
- **Cada hito trae sus títulos de registro** en docs/INSTALL.md y en
  CLAUDE.md §9 (el paso «docs» de `npm run check` los exige): «MCP
  reintentado» (H15); «Modelo elegido», «Modelo comprobado», «Modelo no
  disponible» (H16-H17); «MCP escrito en opencode», «Claves quitadas»
  (H18-H19); «Mapa de otro espacio» (H21); «Diagrama» (H24).
- **Las instantáneas de prompts se regeneran una vez por hito y con el diff
  revisado**: H21 añade dos escenarios sin tocar las 37; H24 no toca ninguna
  mientras el diagrama vaya por botón.
- **Ajustes se mide en el espejo en cada hito que le añada algo** (H15 el
  consejo, H17 «Cambiar el modelo», H19 «Quitar las claves», H21 las filas
  de privacidad y el selector, H23 el color), con `faroPreview.check()` a 320
  y 420 × claro y oscuro; el orden de sus secciones se decide en H17 y no se
  vuelve a mover.
- **Cada migración se prueba con la forma REAL guardada hoy** (`saved.model`
  del sitio, el CONTEXT.md como string, el perfil v2 suelto, `highlightStyle`
  `'spotlight'`) y con la regla «ninguna pantalla nueva para quien ya estaba
  configurado».
- **Toda escritura de prueba en opencode, en un aislado** (§0), y toda
  lectura de tokens tratada como sensible: ni un `log.*` con un cuerpo de
  respuesta de configuración.
- **Revisión adversaria de cada hito antes del siguiente**, como en el primer
  plan; y `npm run check` ×3 al cerrar (la lección de la revisión de H11).

### H15 · uv: instalador, arranque y diagnóstico del MCP caído

- **Qué**: `tools/instalar.ps1` y `tools/arrancar-opencode.ps1` (§3.1);
  `mcpFailureHint` en `setup.js`, cableada en `showMcpSetup`, `attachMcpNotice`
  y la pantalla de conexión, con «Reintentar» (`connectMcp`, host capturado,
  botón desactivado mientras); `timeout` a 60 000; docs/INSTALL.md gana la
  sección 0 «Antes de nada: uv», la nota del primer arranque (107 paquetes,
  Python, 60 s) y cuatro entradas de resolución de problemas (Connection
  closed, timed out, BOM, `{env:}` con barras) más Docker documentado con el
  bloque probado y el aviso de que `npx mcp-atlassian` NO es el mismo
  paquete; README con uv en los requisitos y el paso 0.
- **Depende de**: nada. Va primero porque desbloquea HOY a los compañeros sin
  tocar el flujo de claves ni el contrato del MCP, que H18 reescribe.
- **Ficheros**: `tools/instalar.ps1`, `tools/arrancar-opencode.ps1` (nuevos),
  `src/panel/setup.js`, `src/panel/panel.js` (~1193, ~1217, pantalla de
  conexión), `src/panel/panel.html`, `harness/panel-preview.html`,
  `docs/INSTALL.md`, `README.md`, CLAUDE.md §3, §7, §9, §10.
- **Pruebas** (~12): `setup.test.js` con los dos mensajes REALES medidos, una
  línea sin invisibles y ≤200, basura o `connected` → `null`, `timeout`
  60 000 y `command` intacto; `instalar.test.js` nuevo por regex (la versión
  fijada, `uv tool install mcp-atlassian==`, el PATH desde el registro,
  ninguna escritura a `opencode.json` ni a la contraseña, sin `npx
  mcp-atlassian`, el aviso de la terminal nueva); `panel-wiring` (el consejo
  detrás de «está registrado pero en», que sigue una sola vez; `connectMcp`
  con el host capturado; «MCP reintentado»; ningún `href` externo); espejo a
  320/420. Sonda manual: opencode aislado sin uv → failed → «Reintentar» con
  ruta completa → connected (el `reconectar.mjs` del anexo B).
- **Riesgo**: bajo. Política de ejecución de PowerShell con un zip marcado
  (documentado `-ExecutionPolicy Bypass`) y un proxy corporativo sin medir.
- **Hecho el 2026-09-26** (rama `plan/h15-uv`): los dos scripts de Windows
  (UTF-8 con BOM, PowerShell 5.1), `MCP_ATLASSIAN_VERSION` en config.js
  cruzada con la del instalador, `mcpFailureHint` y «Reintentar» (`retryMcp`)
  en la pantalla de claves, la espera del paso manual y el aviso del chat, la
  pista de la pantalla de conexión, el espejo con `setup.js` de verdad e
  INSTALL/README; 1334 pruebas (+17). Desvíos: la versión fijada va también
  en el `command` (`uvx mcp-atlassian@0.23.1`), porque manda la decisión 4 de
  §8 y la sintaxis se verificó antes; `TOOLSETS: 'all'`, leído en el fuente
  de 0.23.1; al conectar, desde el paso manual no se hace nada (su espera
  sigue sola), y desde la pantalla de claves o el chat se rearranca el panel
  sin turno en vuelo o se da por conectado con uno; reintento de certificados
  sólo con `--native-tls` (el uv 0.9.7 no acepta `--system-certs`); y sin
  `.sh` (decisión 12 de §8). La bitácora, en CLAUDE.md §12.5.

### H16 · Modelos I: veredictos, clasificación de fallos y los agujeros del primer uso

- **Qué**: la parte pura y los arreglos que el fallo del compañero exige, sin
  pantalla nueva (§3.3): `classifyModelFailure`, `availableFromError`, el
  veredicto de proveedor, `usableModels`, `recommendModel`,
  `normalizeModelChecks`, `modelVerdict`; `pickAlternativeModel` (borrada en
  H17: sin uso desde que errorNode elige con pickRetryModel) y
  `pickPlannerModel` saltando fallos; `client.models()` con `capabilities` e
  `isDefault`; `settings.model` global con migración desde `saved.model` y
  `faro:model-checks` en `STORAGE_KEYS`/`STORAGE_AREAS`;
  `verifyCredentials` devuelve `rawError`; `finishSetup` con `reason
  'modelo'` NO culpa a las claves, no escribe registros y conserva
  `pendingMcp`; `generateContext` no escribe `onboarded: true` en un fallo por
  modelo y pinta el aviso DESPUÉS de repintar; `fillModels` no asigna lo que
  no está; `errorNode` sólo ofrece «Reintentar con X» con veredicto ok; todo
  fallo por modelo apunta el veredicto gratis; la sección global en «Qué
  guarda Faro de mí» con «Olvidar los veredictos». **Lo que ve el usuario en
  H16 cuando falla por modelo**, sin pantalla todavía: se cierra la pantalla
  de claves (el sitio queda sin configurar y `pendingMcp` conservado), el
  chat enseña el motivo y un botón «Volver a comprobar» que repite
  `finishSetup` con el modelo que elija en el desplegable del redactor —que
  en el chat sí se puede usar—; H17 lo sustituye por la pantalla.
- **Depende de**: H15. Los dos tocan `panel.js`, `setup.js`,
  `panel-wiring.test.js`, §9, §10, INSTALL y README: en serie, como todo lo
  de la cadena del primer uso (§1).
- **Ficheros**: `src/shared/models.js`, `src/opencode/client.js`,
  `src/shared/config.js`, `src/shared/storage.js`, `src/panel/setup.js`,
  `src/panel/indexer.js` (propagar `rawError`), `src/panel/panel.js`
  (bootForSite paso 3, fillModels 1541-1567, 2594, errorNode 2976-3012, send,
  finishSetup 6929-6990, catch 7235-7237, offerNavigation 3334, paintPrivacy),
  sus tests, CLAUDE.md §4.11, §6, §7, §9, §10; INSTALL; README.
- **Pruebas** (~30, todas en Node y sin turnos): los tres `rawError` reales
  (copiados al final del anexo C; la lista entera de Copilot no quedó
  guardada y H16 la captura otra vez con la sonda del anexo, un turno
  rechazado);
  la lista real de Copilot marca exactamente `claude-sonnet-4.6`,
  `gpt-5.4-nano` y `mai-code-1-flash-picker`; el bucle roto; el veredicto de
  proveedor con el 403; TTL con reloj; `normalizeModelChecks` con basura y
  `__proto__`; `STORAGE_AREAS.modelChecks` cruzado con `src/` ampliando la
  prueba de H13 a las claves GLOBALES (hoy salta toda clave que no sea
  función de un host, `storage.test.js:323-331`) y `forgetEverythingFor` que
  no la toca; el pin `PERMITIDO` de `paintPrivacy` ampliado con la fila del
  modelo; migración idempotente de
  `saved.model`; `finishSetup` con `'modelo'` sin `siteRecords` y sin la
  palabra «claves»; `generateContext` sin `onboarded` en fallo por modelo y
  con el aviso detrás de `restoreConversation`; SEGURIDAD: `pushSettings`
  sigue sin llevar `model`.
- **Riesgo**: medio. Toca `finishSetup` y el `catch` del indexado (pines de
  C5/C2) y cambia el comportamiento del modelo por sitio (decisión de Marco).
- **Hecho el 2026-09-26** (rama `plan/h16-modelos-i`): todo lo de «Qué» salvo
  la pantalla, que es H17. Las puras de los veredictos en `models.js`,
  `client.models()` con `isDefault`/`toolcall`/`status`/`variants` y el
  `reasoning` arreglado, `promptStructured` y `buildContext` con
  `rawError`/`model`/`stalled`, `settings.model` global con la migración de
  `saved.model`, `faro:model-checks` (global, `local`, TTL por motivo en
  `MODEL_LIMITS`), `verifyCredentials` con `rawError`, y en el panel la
  resolución del modelo en el arranque, los veredictos gratis de cada turno,
  `errorNode` con veredicto ok, `finishSetup` con `'modelo'` y «Volver a
  comprobar», el `catch` del indexado sin `onboarded` y con el aviso detrás de
  `restoreConversation`, el planificador saltando lo que falla y las dos filas
  globales de «Qué guarda Faro de mí» con «Olvidar los veredictos»; dos títulos
  de registro («Modelo no disponible», «Veredictos de modelos olvidados»);
  1368 pruebas (+31), las 37 instantáneas intactas y 57 + 57 mutaciones
  cazadas. La lista entera de Copilot **se recapturó con la sonda del anexo**
  (un turno rechazado, 400, 57 ids; 3 de los 32 de Copilot fuera, como el
  anexo), así que la fixture es real. Desvíos: la migración sólo se escribe si
  la persona no tenía modelo propio (con el suyo marcado vale como preselección
  de esa vez); en un turno el veredicto de fallo sólo se apunta si el error es
  del proveedor (`suggestsAnotherModel`); `recommendModel` salta además lo
  retirado o sin herramientas; `availableFromError` da null con una lista
  vacía; el indexado fallido por modelo trae «Generar el contexto otra vez»;
  y sin modelo resuelto el arranque PRESELECCIONA sin guardar
  (`recommendModel` o `pickDefaultModel` saltando fallos) hasta que H17 ponga
  la pantalla ahí. La bitácora, en CLAUDE.md §12.5.

### H17 · Modelos II: pantalla «Elige el modelo» y el orden del primer uso

- **Qué**: `section#screen-model` con todo lo de §3.3 (lista por proveedor,
  filtro, veredictos, no disponibles plegados, «Usar este modelo»,
  «Comprobar» opcional con `client.probeModel`, modo sin proveedores,
  cierre sólo desde Ajustes o error); en `bootForSite` la pantalla ANTES de
  lanzar `checkMcp` cuando no hay modelo resuelto, con rearranque por testigo
  nuevo al aceptar; `mcpCheck`/`mcpPending` invalidados para que un resultado
  tardío no tape la pantalla; aviso en el chat con «Elegir otro modelo»
  cuando la pantalla taparía algo; «Cambiar el modelo» en Ajustes;
  `ESCAPE_CLOSES` con la flecha oculta en el primer uso y la guarda del
  manejador; `screen-model` en el espejo con el mensaje largo de Copilot y el
  modo sin proveedores; y un MODO del espejo que recorra las pantallas
  encadenadas del primer uso (conexión → modelo → claves → contexto) midiendo
  cada una con `faroPreview.check()`, porque el panel no corre en el banco
  (`init()` muere en `getSettings`) y todo lo demás de H16-H19 se pina por
  regex y posición; lo que queda —que la máquina entera sólo se ve en la
  extensión cargada— está en §7 como riesgo aceptado.
- **Depende de**: H16.
- **Ficheros**: `src/panel/panel.html`, `panel.css` (`.model-list`,
  `.model-row`, `.model-why`, sin tokens nuevos), `panel.js`, `screens.js`,
  `src/opencode/client.js`, `harness/panel-preview.html`, sus tests, CLAUDE.md
  §4.1, §4.2, §9, §10; INSTALL; README.
- **Pruebas**: `probeModel` con fetch falso en los tres desenlaces, siempre
  `abort` + DELETE; por regex y por POSICIÓN: la pantalla antes de `checkMcp`
  en el primer uso, ninguna sonda en el arranque, un resultado tardío del MCP
  no abre la pantalla de claves sobre la de modelo, `errorNode` con «Elegir
  otro modelo»; ids en `panel.html`; `faroPreview.check()` a 320/420 × claro
  y oscuro; en real, con permiso de gasto: `openai/gpt-5.4` da `plan` en
  menos de 1,5 s y un modelo bueno cuesta una request.
- **Riesgo**: alto. Es la tercera salida del arranque junto a claves y
  contexto y se cruza con P5 (`mcpPending`, `showMcpPending`,
  `puedeAbrirPantalla`).
- **Hecho el 2026-09-26** (rama `plan/h17-modelos-ii`): todo lo de «Qué». La
  pantalla `screen-model` con sus cinco modos (`primera-vez`, `ajustes`,
  `error`, `setup`, `indexado`), la flecha oculta salvo en `ajustes` y
  `error`, «Usar este modelo» (gratis) y «Comprobar» (la ÚNICA sonda,
  `client.probeModel` con `variant` y `MODEL_LIMITS.probeMs`, sólo probada con
  fetch falso), el modo sin proveedores; en `bootForSite` la pantalla antes de
  las páginas base y de `checkMcp` con `primeraVez` decidido antes del modelo,
  `mcpCheck`/`mcpPending` soltados y rearranque real al elegir; las vueltas a
  ella desde el error de un turno («Elegir otro modelo» siempre, la pregunta
  al cuadro sin mandarse), la verificación de las claves (repite sólo
  `finishSetup`) y el indexado (con su `keepContext`), con su aviso en el chat
  cuando taparía algo; «Cambiar el modelo» en Ajustes; Escape que no pulsa un
  botón oculto; `state.configModel` (sólo `config.model`); y el espejo con las
  fixtures reales y «Primer uso (encadenado)». `pickAlternativeModel` borrada
  con sus pruebas. Dos títulos («Modelo elegido», «Modelo comprobado»); 1377
  pruebas (+5); las 37 instantáneas intactas; 29 + 27 mutaciones (una viva,
  equivalente). Desvíos: `state.modelAceptado` (sin él, elegir a sabiendas un
  modelo con fallo apuntado volvía a sacar la pantalla en bucle);
  `.icon-btn.back[hidden] { display: none; }` (la flecha «oculta» se veía); un
  fallo de opencode en la sonda (`OpencodeError`) no se apunta como veredicto;
  «Elegir otro modelo» también en los errores que no son del proveedor; la
  variable sigue llamándose `avisoModelo`; y un sitio configurado pero sin
  `onboarded` sigue sin pantalla del modelo (sólo el Registro). El espejo SÍ
  está medido (Browser pane, 2026-09-26: `check()` en verde en `screen-model` a
  320/420 × claro y oscuro, el recorrido del primer uso 4/4 y el modo vacío), y
  medirlo destapó un TDZ del propio espejo —dos `const` usadas antes de
  inicializarse tumbaban `arrancar()`— arreglado en el mismo commit. Sin
  verificar: nada en la extensión, ninguna sonda real. La bitácora, en
  CLAUDE.md §12.5. Revisión adversaria aplicada el 2026-09-26: 6 confirmados
  y R1 como desvío (el modelo que acaba de fallar queda a la vista pero no
  es la preselección); 1378 pruebas; el detalle en CLAUDE.md §12.5.

### H18 · MCP automático: alta por PATCH /global/config, ruta absoluta de uvx y respaldo manual

- **Qué**: §3.2 entero salvo el borrado: `request` con `sensitive` (también
  en `config()`), `updateMcpEntries` y `reloadGlobalConfig`, `mcpWritePatch`,
  entradas por host
  incluidas las deshabilitadas, `configFileCandidates` (jsonc > json >
  config.json), `buildMcpConfig` con environment completo (y la versión
  fijada en el `command` si Marco lo decide), consentimiento, guarda común,
  espera hasta que aparezca, relectura de la entrada efectiva, reintento con
  ruta absoluta, degradación a «reinicia opencode», respaldo manual con «Ya
  lo he pegado», `verified: false` en la adopción sin verificar, escribir
  separado de verificar, `configureMcp` sin `addMcp`/`connectMcp` y §7
  corregido; la versión de opencode leída de `GET /global/health` con su
  aviso; `TOOLSETS` en `buildMcpConfig` con el valor que H15 leyó;
  `tools/config-sandbox.mjs`, que prueba también una ruta con espacios y que
  el `system` de una sesión de Faro no lleva ninguna línea «Instructions
  from:» (§3.1).
- **Depende de**: H15 (reutiliza `mcpFailureHint` y «Reintentar») y H17 (el
  orden del primer uso y la separación escribir/verificar: sin ellos, el
  alta automática reproduciría más rápido el bucle del compañero).
- **Ficheros**: `src/opencode/client.js`, `src/panel/setup.js`,
  `src/panel/panel.js` (saveKeys 6806-6860, showManualStep 6865-6925,
  finishSetup, guarda común), `src/panel/panel.html`, `src/shared/storage.js`
  (`verified`), `tools/config-sandbox.mjs` (nuevo), `harness/panel-preview.html`,
  sus tests, CLAUDE.md §4.1, §4.7, §7, §8 (§8.24), §9, §10, §12; INSTALL;
  README.
- **Pruebas** (~22): SEGURIDAD en `client.test.js` (con un 500
  `ConfigJsonError` que trae tokens, ni `OpencodeError.body` ni el logger los
  contienen, tampoco en `config()`; `updateMcpEntries` y `reloadGlobalConfig`
  devuelven `{ok, status, kind}` y nunca el Config; ninguna otra clave raíz
  que `mcp`; `reloadGlobalConfig` no admite cuerpo); `setup.test.js`
  (environment completo con claves exactas, `""` y `enabled: true`; Cloud→DC
  deja USERNAME/API_TOKEN en `""`; una entrada habilitada existente conserva
  su `command` sólo si pasa la lista blanca o es byte a byte el de
  `GET /config`, y una deshabilitada ajena no se reutiliza; el reintento con
  ruta absoluta no toca una entrada con `command` propio aunque falle en
  menos de 2 s, y vuelve atrás si no conecta;
  `mcpWritePatch` rechaza otra clave, un `command` fuera de la lista blanca y
  una ruta con metacaracteres; candidatos del fichero; `configureMcp` sin
  `addMcp`); `panel-wiring` (sólo sin turno/indexado/sonda; invalidación
  antes del PATCH; relectura; «Ya lo he pegado» → `{}`; ningún `log.*` con la
  respuesta); el sandbox con sus cuatro casos; espejo con los estados de
  espera; en real, con el opencode de Marco (con copia del fichero): «Cambiar
  las claves» sin pegar nada.
- **Riesgo**: alto. Escribe en un fichero con tokens, aborta turnos y
  rearranca todos los MCP del usuario, y la recarga en caliente no está
  documentada (la red es «reinicia opencode»). Es el hito donde un fallo
  silencioso más cuesta y por eso va sobre un primer uso ya estable.

- **Hecho el 2026-09-26** (rama `plan/h18-mcp-automatico`): todo lo de «Qué».
  La barrera pura `src/shared/mcp-config.js` (`validMcpEntry`, `mcpPatchBody`,
  `validMcpCommand` con `UVX_ABS_PATH`), importada por el cliente y por
  setup.js; las dos puertas del cliente (`updateMcpEntries`,
  `reloadGlobalConfig`) con `sensitive` también en `config()`, `paths()` con
  sólo `{config, state, home}`, `version()`, y `addMcp` borrado; en setup.js el
  environment completo, `mcpEntriesForHost`, `chooseWriteTarget`,
  `mcpWritePatch`, `uvxAbsoluteCommand`, `configFileCandidates`,
  `configureMcp` sin `addMcp`/`connectMcp` ni espera, y `siteRecords` con
  `verified` (+ `keysUnverified`, la regla de la migración); en el panel
  `saveKeys` y `showManualStep` reescritas (permiso, guarda común
  `reconfiguring()`, invalidación antes del PATCH, espera hasta que aparezca y
  conecte, reintento con la ruta absoluta sólo en una entrada nueva y con
  vuelta atrás, relectura de la entrada efectiva, respaldo manual con «Ya lo he
  pegado»), la adopción con `verified: false` y su aviso «Comprobar las
  claves», `verified: true` añadido a `finishSetup`, y la versión de opencode
  leída sin esperarla; y `npm run sandbox` (`tools/config-sandbox.mjs` +
  `tools/toy-mcp.mjs`), **ejecutado de verdad: 7/7** contra opencode 1.2.25
  aislado, con los cuatro casos de §3.2 más la puerta real, la ruta con
  espacios y el «sin instructions». Cuatro títulos («MCP escrito en
  opencode», «MCP sin escribir», «Configuración recargada», «Claves sin
  comprobar»); 1410 pruebas (+32); las 37 instantáneas intactas; 47 + 40
  mutaciones del panel y del sandbox, todas cazadas. Desvíos: el `timeout` de
  una entrada reutilizada se conserva pero nunca baja de 60 000 (las de antes
  de H15 llevan 30 000); el texto del consentimiento dice «el primero que exista
  de opencode.jsonc, opencode.json y config.json (si no hay ninguno, opencode
  crea opencode.jsonc)», porque el panel no puede listar la carpeta y sin
  fichero opencode crea el `.jsonc` (confirmado por el sandbox);
  `reconfiguring()` también espera a la comprobación de las claves
  (`state.setupAbort`); la adopción conserva `verified` cuando es el MISMO MCP
  ya verificado y sólo aprende un host enlazado; `updateMcpEntries` recibe como
  segundo argumento las opciones de la barrera (`known` para conservar el
  `command` de una entrada reutilizada, y `allowCommand`, que sólo pasa el
  sandbox); `storage.js` no se tocó (`verified` viaja en `siteRecords` y
  `saveSite` lo funde); `mcpScrubPatch` no existe todavía (es del borrado, H19).
  El espejo SÍ está medido (Browser pane, 2026-09-26: `check()` en verde en los
  cinco estados de la pantalla de claves, el paso manual, Ajustes y el chat ×
  320/420 × claro y oscuro), y medirlo destapó que una carpeta de configuración
  real desbordaba el consentimiento a 320 px: una regla de `overflow-wrap` en
  `#setup-consent-path`, con su pin. Sin verificar: nada en la extensión cargada,
  nada con mcp-atlassian de verdad tras el PATCH, «Cambiar las claves» con el
  opencode de Marco (con copia del fichero), la ruta absoluta de uvx con un
  compañero, y el «Instructions from:» con un turno real (sin permiso de gasto).
  La bitácora, en CLAUDE.md §12.5. Revisión adversaria aplicada el 2026-09-26:
  7 confirmados (1 alto: en Data Center, «Cambiar las claves» desde el host
  enlazado vaciaba las variables del otro producto en la entrada compartida, y
  ahora se conservan) y 3 refutados; además, el nombre que ya existe se
  reutiliza sin pisar su `command`, sin la configuración no se escribe, la
  vuelta atrás del reintento es incondicional, `verified` se decide host a
  host, la cabecera suelta «comprobando MCP…» y los desenlaces se anuncian;
  1416 pruebas; el detalle en CLAUDE.md §12.5.

### H19 · «Quitar las claves de este sitio»

- **Qué**: el botón de §3.2 con su confirmación (lista de nombres, host
  enlazado, «cualquier cliente de este opencode», casilla aparte para las
  entradas ajenas), `mcpScrubPatch` (siempre la entrada entera), relectura,
  los registros de `chrome.storage` desmarcados sin tocar contexto ni índice,
  invalidación y `bootForSite()`; «Olvidar este sitio» remite al botón nuevo
  sin tocar opencode.
- **Depende de**: H18 (reutiliza la escritura, `sensitive` y el sandbox).
- **Ficheros**: `src/panel/setup.js`, `panel.js`, `panel.html`,
  `harness/panel-preview.html`, `tools/config-sandbox.mjs`, sus tests,
  CLAUDE.md §4.11, §8.13, §10; INSTALL; README.
- **Pruebas**: `mcpScrubPatch` nunca `{enabled: false}` a secas y el borrado
  sale en un único PATCH cuya única clave raíz es `mcp`; el manejador no
  llama a `forgetEverythingFor`, desmarca los dos registros, invalida
  `mcpCheck`/`mcpWait`/`pendingMcp` y no hay bucle porque `mcpForHost` salta
  `enabled: false`; en el sandbox queda «disabled» con `""` en disco y el
  ciclo quitar → volver a crear → connected (y «deshabilitada a mano con sus
  URL → Cambiar las claves → connected»); en real
  con Marco: su `opencode.json` con la entrada deshabilitada y sin tokens, y
  la pantalla de claves otra vez.
- **Riesgo**: medio-alto. Deja un esqueleto deshabilitado (no hay borrado
  por API) y deshabilita el MCP para todos los clientes del usuario.

- **Hecho el 2026-09-26** (rama `plan/h19-quitar-claves`): todo lo de «Qué».
  En setup.js, puro salvo `scrubMcp`: `mcpScrubCandidates` (propias por
  nombre —el `mcpName` guardado o el de Faro de este host o de un enlazado—,
  ajenas por dominio, y aparte las que no se pueden deshabilitar, sin
  `environment`), `mcpScrubPatch` (la entrada ENTERA con `enabled: false` y las
  diez variables a `''`, su `command` byte a byte por la barrera de siempre),
  `scrubEffective`, `unlinkRecords` (el patch exacto que deja el sitio sin
  configurar, sin tocar `onboarded` ni nada más), `scrubMcp` (UN PATCH por
  `updateMcpEntries` con `known`) y `scrubConfirmText` (los textos, que el
  espejo importa); y `keysUnverified` exige ya `configured: true`. En el panel,
  el botón en «Este sitio» con su confirmación en línea (`prepareRemoveKeys`
  sólo lee; `removeKeys` relee y RECALCULA la lista, guarda común, la
  invalidación de `saveKeys` más `pendingMcp`, un PATCH, relectura con
  `scrubEffective` y sólo entonces los registros y `bootForSite()`), la rama
  «disabled» de la pantalla de claves, y «Olvidar este sitio» remitiendo al
  botón. En el sandbox, los casos 7 (quitar con las funciones reales en un
  PATCH, disabled y sin el token en el fichero, y volver a guardar reutiliza el
  esqueleto y conecta) y 8 (deshabilitada a mano con sus URL → guardar →
  connected), **ejecutado de verdad tres veces: 9/9**. Un título («Claves
  quitadas», en ok, warn e info); 1425 pruebas (+9); las 37 instantáneas
  intactas; 41 + 40 mutaciones, todas cazadas. Desvíos: el caso 8 usa otro host
  (tras el 7 la entrada de Faro vuelve a estar habilitada con el dominio y se
  reutilizaría ella); el texto de las no quitables concuerda en plural; el plan
  lleva además la carpeta y el recálculo compara también los hosts enlazados;
  la casilla de las ajenas se lee al clic; el porqué de un fallo sale de
  `porQueNoSeQuita` (la clasificación de `porQueNoSeEscribe` sin sus remedios de
  pegar); y sin poder releer la configuración tras el PATCH se dice sólo eso,
  sin tocar el almacén. Límites: `scrubEffective` sólo mira las diez variables
  de Faro; el esqueleto sólo se reutiliza al volver a guardar desde el host
  cuyo nombre de Faro lleva. Sin verificar: nada en la extensión cargada ni
  medido en el espejo; en real con Marco, su `opencode.json` con la entrada
  deshabilitada y sin tokens y la pantalla de claves otra vez. La bitácora, en
  CLAUDE.md §12.5. Revisión adversaria aplicada el 2026-09-26: 25 confirmados
  (10 medios; el mayor, que tras quitar el esqueleto sólo se reutilizaba desde
  el host de su nombre y la pantalla de claves no decía «disabled» desde el
  enlazado ni con una entrada de nombre propio) y 1 refutado; `mcpName` se
  conserva al quitar (desvío de §3.2), lo adoptado con otro `command` es ajena,
  lo que Faro no sabe vaciar se dice (`restos`), los no quitables de nombre raro
  se cuentan, la casilla manda en «Quitar», un PATCH rechazado no da el MCP por
  caído (y donde se aplicó sin desconfigurar el sitio se vuelve a comprobar), la
  preparación lleva testigo, la frase «disabled» sale también en el aviso del
  chat, los enlazados de otro MCP no se desmarcan, las ajenas ya deshabilitadas
  tienen su frase, y los pines son de cuerpos enteros (las 30 mutaciones vivas
  del panel caen); el espejo SÍ estaba medido (16 combinaciones en verde);
  1431 pruebas; el sandbox, 9/9 tres veces con el registro que deja el panel;
  el detalle en CLAUDE.md §12.5.

### H20 · Verificación en real del primer uso con un compañero

- **Qué**: la sesión que motivó la petición, guiada: un compañero SIN uv y
  con OTRO plan de modelos ejecuta `instalar.ps1`, arranca opencode con
  `arrancar-opencode.ps1` desde una terminal nueva, carga la extensión, elige
  el modelo, guarda las claves (que se escriben solas), se verifican y se
  construye el contexto; después «Quitar las claves» y volver a crearlas. Se
  apunta cada tiempo y cada pantalla, se lee el Registro y `npm run turn` en
  su máquina, y lo que salga va a CLAUDE.md §12.2 y a INSTALL.
- **Depende de**: H15-H19.
- **Pruebas**: manual, con el gasto autorizado por Marco (§8).
- **Riesgo**: es lo único que prueba lo que falló de verdad; sin esta sesión
  H15-H19 quedan como «probado en Node y en un aislado».

### H21 · Varios espacios de Confluence: contexto y mapa por espacio (D1)

- **Qué**: §3.4 para Confluence: `scopes.js`, el contexto como
  `{version: 2, scopes}` con la migración prudente, `contextRaw`,
  `getContexts`/`saveContexts`, `changedScope`, `generateContext` bajo host y
  ámbito, la línea «aún no tiene mapa · Construir» y `sinMapaCard` por
  espacio, `preferSpace`, `stampSpace`, `maxPagesTotal`, `contextScope`
  opcional en `baseSystem` (37 intactas, +2), `linkedSpacesFor` con el
  selector manual en Ajustes, las filas de privacidad, el espacio OPS en
  `cql-eval.mjs` y el tramo 63.
- **Depende de**: H16 (los dos tocan el `catch` de `generateContext` y el
  significado de `onboarded`: primero que un fallo de modelo no marque el
  sitio como hecho, después que «tiene mapa» pase a ser por ámbito).
- **Ficheros**: `src/shared/scopes.js` (nuevo), `src/shared/storage.js`,
  `src/panel/memory.js`, `panel.js` (bootForSite, refreshTab, generateContext,
  uploadContext, offerNavigation, growTreeFromPage, sourcesIndex,
  currentReferences, loadLinkedContext, paintPrivacy, estado vacío),
  `prompts.js` (sin tocar el prefijo de 723), `index-store.js`, `sources.js`,
  `tools/cql-eval.mjs`, `harness/harness.js`, `harness/panel-preview.html`,
  `test/fixtures/prompts/escenarios.js`, sus tests, CLAUDE.md §3, §4.6, §6,
  §10, §12; INSTALL; README.
- **Pruebas** (~40): `scopes.test.js` (SEGURIDAD: claves de ámbito raras →
  `'*'`, `__proto__`, migración idempotente y prudente), `storage.test.js`
  (`contextRaw` con claves exactas, el olvido se lleva el objeto entero),
  `memory.test.js`, `index-store`/`sources` (`preferSpace` estable),
  `seleccion.test.js` (el prefijo conservado; una clave con salto no abre
  línea), `prompt-snapshots` (+2), `panel-wiring` (`changedScope` sin
  `await` del almacén; host y ámbito capturados antes del primer `await`;
  relectura antes de escribir; la guarda de `offerNavigation` sigue siendo
  `indexSize` y `sinMapaCard` por espacio sólo sale sin plan, con el pin de
  que desde un espacio sin mapa un destino de otro espacio del índice sigue
  dando `navCard` y de que en Jira nada cambia; nadie consume
  `state.contextMd` sin `contextFor`; y el pin `PERMITIDO` de `paintPrivacy`
  ampliado con la cuenta de ámbitos y las claves validadas); el tramo del
  banco (el 63, o el siguiente si H23 entró antes); en real, sólo GET, con
  SIMPL y DCPIAS como blob.
- **Riesgo**: medio. Cambia la forma de una clave persistida, con migración
  en la lectura, y hay una carrera entre ámbitos de milisegundos.
- **Hecho el 2026-09-26** (rama `plan/h21-multi-espacio`): todo lo de «Qué»
  salvo `linkedSpacesFor` y el selector manual de Ajustes, que §3.4 deja para
  **H22** (la regla (a) y el selector necesitan el ámbito `project:KEY`; la
  ficha y §3.4 se contradecían y mandó §3.4). En su lugar, **provisional**,
  `linkedContextFor` (la regla (c) sola: desde Jira viaja el contexto `'*'` del
  Confluence enlazado si existe, o el de su ÚNICO espacio con contexto, y con
  dos ninguno), que H22 sustituye. `src/shared/scopes.js` con el contrato de
  §3.4 más `scopeKeyFromScope`, `scopeLabel`, `contextScopeFor`,
  `withoutContext`, `scopeKeys`, `withoutSpace`, `hasMap`,
  `otherScopesWithMap`, `countPages` y `spaceOverflow`; el contexto como
  `{version: 2, scopes}` en la misma clave, `contextRaw` en el paquete,
  `getContexts`/`saveContexts` (borradas `getContextMd`/`saveContextMd`),
  `changedScope` sin ninguna lectura, `generateContext` y `uploadContext` bajo
  host y ámbito con relectura antes de escribir, la línea «aún no tiene mapa ·
  Construir», `sinMapaCard` por espacio detrás del planificador con la guarda
  `indexSize` intacta, `preferSpace` en `indexDigest` y `suggestFromIndex`,
  `stampSpace` en `growTreeFromPage`, `INDEX_LIMITS.maxPagesTotal` = 1 500
  MEDIDO (`npm run bench`: 58 KB con 300 páginas, 288 KB con 1 500 y 576 KB con
  3 000), el aviso «Mapa lleno» sin desalojar nada y **«Olvidar el mapa de X»**
  en una lista nueva de Ajustes («Mapas y contextos de este sitio»),
  `contextScope`/`otherScopes` en `baseSystem` (las 37 instantáneas intactas y
  dos nuevas), las dos filas de privacidad con `PERMITIDO` ampliado, el espacio
  OPS en `cql-eval.mjs`, el tramo 63 y su botón. Tres títulos nuevos
  («Contexto migrado», «Mapa lleno», «Mapa olvidado»); 1469 pruebas (+38);
  32 + 42 + 19 mutaciones, cazadas todas salvo una equivalente del banco.
  Desvíos: la migración exige además en `normalizeContexts` que
  `legacyIndexedAt` sea un instante válido (la regla está dos veces a
  propósito, en el panel y en la pura); `applyScope` también al VOLVER de fuera
  al mismo host (con la pestaña en el correo no hay con qué comparar);
  `sinMapaCard` por espacio sólo si la respuesta apuntaba a algún sitio, como la
  de sin índice; «Olvidar el mapa» relee antes de escribir y va con su fallo
  visible; el `preferSpace` del planificador no lo pasaba nadie (su único
  llamante, `planner.js`, no estaba en el reparto) y lo cableó el orquestador al
  verificar: `planNavigation` lo deriva del sitio de la pestaña y `askModel` se
  lo da a `indexDigest`, con su pin en `planner.test.js` sobre el texto REAL del
  turno del planificador. Verificado por el orquestador en el Browser pane el
  2026-09-27: el banco entero 1-63 (129/129 con `requestAnimationFrame`
  sustituido; con frames de verdad 127/129, cayendo sólo las dos que dependen
  de un frame) con el tramo 63 4/4, y el espejo en verde en 8 combinaciones
  («espacio sin mapa» y Ajustes con `#scope-list` × 320/420 × claro y oscuro).
  Sin verificar: nada en la extensión cargada, el espejo con los ojos, y en
  real, sólo GET, SIMPL y DCPIAS como blob y la migración con el CONTEXT.md de
  Marco. La bitácora, en CLAUDE.md §12.5.

### H22 · Jira por proyecto: contexto y perfil byProject (D2)

- **Qué**: `scopeKeyOf` → `'project:KEY'`; `faro:profile:<host>` →
  `{version, byProject}` con `normalizeProfiles` y migración del perfil v2
  suelto; `profileForProject` sobre el mapa; `refreshTab` sin recontar;
  la fila «N proyectos con perfil»; el tramo 52 con dos proyectos. Cierra la
  decisión 5 de §12.3.
- **Depende de**: H21.
- **Ficheros**: `src/shared/scopes.js`, `src/shared/jira-rest.js`,
  `src/shared/storage.js`, `src/panel/panel.js`, `harness/harness.js`, sus
  tests, CLAUDE.md §4.7, §6, §10, §12.3.
- **Pruebas** (~15): la prueba SEGURIDAD de `profileForProject` reescrita con
  verdad; dos proyectos que no se pisan; migración; `profileAsked` como
  tregua; los pines 2530-2656 de `panel-wiring` actualizados.
- **Riesgo**: bajo-medio.

### H23 · Subrayado (forma A): cursor subrayador azul, selección azul, marcas legibles, insignias que no tapan y barra que cabe

- **Qué**: §3.6 sin el host de mezcla: `cursor.js`, `PICK_CSS` con el cursor
  y `::selection`, la barra responsiva, `.pick-hover` azul, el relleno en
  `::highlight` con dos nombres y el trazo en pastilla que se dibuja, las
  insignias en superíndice, `forced-colors`, `highlightColor` (azul/ámbar)
  por `pushSettings`, el radio «en amarillo» corregido, las parejas de tinta
  por color y tema en `test/contrast-pairs.js` (texto bajo la marca ≥4,5; el
  enlace anotado, no exigido), y la sonda de CSP `img-src` en los sitios
  reales ANTES de escribir el cursor.
- **Depende de**: nada. Carril paralelo (content script, overlay, ajustes):
  puede ir en cualquier momento, pero no se fusiona a la vez que H16-H19 ni
  que H21: choca con H16 en `config.js` (`DEFAULT_SETTINGS`/`migrateSettings`),
  `settings.test.js` y el pin de claves exactas de `SETTINGS`, y con H17-H19
  y H21 en Ajustes, `panel.html` y el espejo. El tramo nuevo del banco lo
  numera el hito que entre SEGUNDO: H21 pide el 63; si H23 llega antes, el 63
  es suyo y H21 toma el 64 (`docs.test.js` exige 1..N sin huecos).
- **Ficheros**: `src/content/overlay/cursor.js` (nuevo), `styles.js`,
  `overlay.js` (`_paintNoteBadges`, `_setHighlight` con dos nombres,
  `setTint`, `setPicking` con la clase oscura), `src/content/runner.js`,
  `src/content/bootstrap.js:179`, `src/shared/config.js`,
  `src/background/service-worker.js:304`, `src/panel/panel.html:304-305`,
  `panel.js:6135-6136` y `6687`, `test/contrast-pairs.js`,
  `harness/harness.js` (tramos 20, 22, 27, 41, 42 y uno nuevo),
  `harness/panel-preview.html`, sus tests, CLAUDE.md §3, §6, §8.8, §8.10,
  §8.11; INSTALL; README.
- **Pruebas** (~18): `cursor.test.js` (32×32, punto activo dentro y en la
  punta, sin `#`/`<`/`>` crudos, sin `<script>` ni `on*`, ≤2 KB);
  `overlay-wiring` (`::selection` sólo dentro de `faro-picking`, keyframes
  anulados, ningún `mix-blend-mode` en `OVERLAY_CSS`, los pines de P1
  intactos); `settings`/`service-worker` (claves exactas con
  `highlightColor`); tramo nuevo (ninguna insignia se solapa con el rect del
  carácter que sigue a su cita) y el 22 con el cursor `url(` y la selección;
  27, 41 y 42 en verde; `npm run contrast` en verde; capturas a 1280 y 480.
- **Riesgo**: bajo-medio. La CSP del cursor en `data:` (degrada a `text`) y
  la regresión visual, que no se captura sin frames.

### H24 · Diagramas: renderizador propio de flowchart y «Dibujar el flujo»

- **Qué**: §3.5 entero: `diagram-parse.js`, `diagram-layout.js` con la medida
  inyectada, `diagram-view.js`, `parseBlocks` con `closed`, `onCodeBlock` en
  las cuatro llamadas, nodos navegables sólo con la clave en el índice, `[n]`
  → `focusNote`, `answerAnnouncement` sin la valla, el botón «Dibujar el
  flujo», las clases `.dg-*` y las cuatro parejas nuevas, el diagrama en
  «Jira · SIMPL-1234» del espejo con `.dg-wrap` en `CAJAS`; y `npm run turn`
  sobre un Análisis de una épica real para ver qué variantes de Mermaid
  escribe `gpt-5.6-luna` ANTES de decidir la viñeta del prompt.
- **Depende de**: H21 y H22 (si algún día la viñeta entra en el prompt, que
  sea sobre los escenarios ya regenerados de D).
- **Ficheros**: los tres módulos nuevos y sus tres tests, `markdown.js`,
  `panel.js`, `panel.css`, `test/contrast-pairs.js`, `harness/panel-preview.html`,
  `skills.js` sólo si Marco decide la viñeta, CLAUDE.md §3, §4.4, §4.7, §6,
  §8 (§8.27), §9, §10; INSTALL; README.
- **Pruebas** (~60): parser con sus casos de SEGURIDAD (click/href/callback/
  style/classDef/linkStyle/`%%{init}%%` rechazados con motivo; `<img
  onerror>` y `javascript:` como texto; NEL/U+2028/RLO/ZWSP fuera; `ref` sólo
  por `validIssueKey`; `kind` sólo de `NOTE_KINDS` sin `__proto__`; topes),
  `toMermaid` ida y vuelta; layout (0 cruces en el caso de la PoC, ciclo sin
  bucle, LR, determinista, límites con las aristas, 30 nodos por debajo del
  tope de ms); vista con un `document` mínimo (ningún `innerHTML` también por
  regex, `role`/`title`/`desc`, `tabindex` sólo con `ref` en el índice,
  `data-note` sólo con nota existente, una fila por arista en la lista);
  `markdown` (sin `onCodeBlock` byte a byte igual; valla sin cerrar no
  dibuja); `panel-wiring` (`onCodeBlock` en las cuatro; clic por
  `validatePlan` sin `'/browse/' +`; `focusNote` sólo con la nota);
  `panel-css`/`contrast` en verde; espejo a 320.
- **Riesgo**: medio. La tolerancia del parser a lo que escriben los modelos
  pequeños y el layout propio en grafos densos.

### H25 · Condicionados: «Rotulador» con host de mezcla, y el grafo exacto de issuelinks

- **Qué**: sólo si Marco los quiere tras ver H23 y H24. (a) El segundo host
  con `mix-blend-mode`, `MARKS_CSS`, el código nunca en la capa de mezcla,
  `destroy()` quitando los dos hosts, `blendWith` en `test/contrast.js` y la
  tabla de tintas; pasa a ser el valor por defecto sólo si el trace de
  Performance (p95 de frame en `scrollStress` y `stress`, la misma máquina)
  no empeora y se ve en el tema oscuro real. (b) Las relaciones `issuelinks`
  de las claves del diagrama **que ya están en el índice** —cosechadas por M4
  de una herramienta, nunca leídas de la prosa del modelo: así §8.27 se cumple
  tal cual, a cambio de que un nodo cuya clave no esté siga sin enlace— por
  una plantilla fija nueva elegida por `kind` en `RECENT_ISSUES`
  (`validIssueKey` en el content script, sólo proyectos conocidos, sólo Jira
  DC con `restTools`), que trae las relaciones EXACTAS y las dibuja;
  CLAUDE.md §8.12 y §8.27 se precisan con esa procedencia; y, si el layout
  propio se queda corto, `dagre.min.js` vendorizado sólo para coordenadas.
- **Depende de**: H23 y H24.
- **Pruebas**: (a) `overlay-wiring` (las marcas de código nunca en el host de
  mezcla; los pines de P1 repetidos en la capa nueva) y el banco 27/41/42
  con el host nuevo; (b) `jira-rest` y `bootstrap-wiring` (plantilla por
  `kind`, claves validadas, ninguna consulta leída del mensaje) y un tramo
  con issuelinks.
- **Riesgo**: medio-alto en (a) por la GPU sin medir y la detección del tema;
  medio en (b) por §8.12.

### H26 · Cierre

- **Qué**: CLAUDE.md §12 con la bitácora de H15-H25 (un bloque por hito y por
  revisión, como siempre), el mapa §3 y los contratos §6 definitivos, las
  decisiones nuevas de §8, README e INSTALL definitivos, `docs/PLAN2.md`
  marcado como cerrado; la corrida entera del banco (1-64 o los que sean)
  con frames de verdad; las capturas 2×2 del espejo en todas las pantallas
  nuevas; `npm run check` ×3, `npm run contrast`, la integración gratis de
  H18 y, con permiso, `npm run test:integration`.
- **Depende de**: todo lo anterior.
- **Riesgo**: bajo en código.

**Orden y motivo.** H15 → H16 → H17 → H18 → H19 → H20 (verificación en real
del bloque de la petición principal) → H21 → H22 → H24, con **H23 en carril
paralelo** (cuando se quiera, sin fusionarlo junto a H17-H19), H25 condicionado
y H26 de cierre. (1) H15 primero porque desbloquea HOY a los compañeros —el
instalador y un aviso que dice qué falta— sin tocar el flujo de claves ni el
contrato del MCP, y porque `mcpFailureHint` es una pura que H18 reutiliza.
(2) H16-H17 antes que H18 porque el fallo del compañero es de MODELO: con el
defecto roto, el alta automática seguiría acabando en `verifyCredentials` →
«Jira: <error>» y el sitio sin configurar; además fijan el orden del primer
uso y la separación escribir/verificar que H18 necesita. (3) H18 después
porque es el de más riesgo y entra sobre un primer uso ya estable y con la
guarda común. (4) H20 cierra ese bloque antes de seguir con otra cosa: es lo
que motivó todo esto. (5) H21 tras H16 por el `catch` de `generateContext` y
`onboarded`; H22 reutiliza su contrato. (6) H24 tras D porque, si la viñeta
entra alguna vez en el prompt, lo hace sobre los escenarios ya regenerados y
con una sola regeneración revisable por hito. (7) H23 es independiente, visible
y de riesgo bajo: conviene hacerlo pronto. (8) H25 sólo con medida y decisión.
Ningún hito debería pasar de ~40 pruebas nuevas; H17 y H18 son los candidatos
a partirse si en su revisión adversaria salen más de ~15 hallazgos.

## 5. Decisiones que cambian o se añaden en CLAUDE.md

- **§7 corregida, ya** (es documentación de hechos comprobados y estaba
  mal): «`POST /mcp` responde 200 sin hacer nada» pasa a «`POST /mcp` arranca
  el proceso y sus herramientas llegan al modelo, pero es sólo en memoria:
  no se persiste, `GET /mcp` no lo ve y muere con cualquier dispose;
  **`PATCH /global/config` escribe el fichero global y recarga en caliente**
  (`Config.updateGlobal` → `Config.global.reset()` + `Instance.disposeAll()`
  sin `await`): el MCP aparece en `GET /mcp` a los ~200 ms, cada PATCH cierra
  el SSE, aborta los turnos en vuelo y rearranca todos los MCP; no hay borrado
  por API; un 500 `ConfigJsonError` devuelve el fichero entero con los
  tokens; `PATCH /config` escribe `<cwd>/config.json` y no se carga». Y los
  hechos de B: `timeout` es el plazo de arranque, el error de un comando
  ausente es «Connection closed» en 40 ms sin causa en la API,
  `POST /mcp/{name}/connect` reintenta un «failed» sin reiniciar, el MCP
  hereda `process.env`, BOM y `{env:}` con barras tumban opencode al arrancar.
  Y los de C: `/config/providers` es por persona pero no marca el plan; el
  `default` en orden fijo; los tres rechazos medidos y la lista de Copilot.
- **§8.24 nueva · Faro escribe en la configuración de opencode, y sólo
  esto**: la clave `mcp`, por dos puertas cerradas del cliente
  (`updateMcpEntries`, con cada entrada validada, y `reloadGlobalConfig`, con
  el cuerpo `{}` fijo); una entrada por sitio con la forma fija de
  `buildMcpConfig`, nombre validado por su forma (`mcpNameForHost`, el
  `mcpName` guardado, o el de la entrada habilitada que `GET /config` ya
  tiene para el dominio), `command` de lista blanca (uvx + mcp-atlassian, o la
  ruta absoluta validada de `uvx.exe`), environment completo con `""` en lo
  que no se usa y `enabled: true`; de una entrada habilitada que ya existe se
  reescriben el environment y `enabled` y se conserva su `command` sólo si
  pasa la lista blanca o es byte a byte el que ya tiene; una deshabilitada
  sólo se reutiliza si es el esqueleto de Faro; el reintento con ruta absoluta
  sólo sobre la entrada que Faro acaba de crear con el `command` estándar, y
  con vuelta atrás; nunca por `POST /mcp`, nunca `/config` de proyecto, nunca
  `agent`, `permission`, `plugin` ni `command`; con consentimiento la primera vez y con
  la ruta real de `GET /path`; ningún cuerpo de respuesta de configuración
  llega al registro ni a `OpencodeError.body` (`sensitive`, también en
  `config()`); el borrado es la entrada entera con `enabled: false` y los
  secretos a `""`; y toda prueba de escritura, en un opencode con el HOME
  entero redirigido y `GET /path` comprobado antes.
- **§8.25 nueva · El modelo es de la persona**: `settings.model` global, no
  por sitio; ningún modelo se elige solo la primera vez (la pantalla va antes
  de las claves y del contexto, y antes de lanzar `checkMcp`); un fallo por
  modelo se clasifica gratis, se recuerda con TTL en `faro:model-checks` (que
  se ve y se borra en «Qué guarda Faro de mí» y nunca viaja a la página),
  nunca se cuenta como fallo de claves ni deja un sitio `onboarded` sin
  contexto, y siempre vuelve a la pantalla de elegir; ninguna sonda en el
  arranque ni en el primer uso.
- **§8.26 nueva · El ámbito es la unidad del contexto y del mapa; el host la
  del almacén**: un CONTEXT.md por espacio o proyecto dentro de la misma
  clave por host; un índice por host con cada página estampada con su
  espacio, filtrado u ordenado por el de la pestaña donde hace falta y nunca
  partido (el paso a paso entre espacios se conserva); la migración va a
  `'*'` en cualquier duda; ninguna clave nueva en `STORAGE_KEYS` por esto
  (el olvido de H13 y la lectura única de P4 se quedan como están).
- **§8.27 nueva · Diagramas**: el modelo escribe Mermaid `flowchart`, la
  extensión lo valida con claves blancas y lo pinta con `createElementNS`;
  ninguna dependencia, ningún `innerHTML`, CSP por defecto; un nodo navega
  sólo por `validatePlan` y sólo si su clave está en el índice; nada del
  diagrama convierte texto en consulta (si H25b se hace, sólo consulta claves
  que YA estaban en el índice, por una plantilla elegida por `kind`); sin MCP
  de dibujo.
- **§8.8, §8.10 y §8.11 precisadas**: el relleno de una marca va DEBAJO del
  texto (Custom Highlight) y el overlay dibuja el trazo y las insignias; una
  marca por línea recortada a su caja sigue; en código sólo el trazo sigue;
  la herramienta de «Señalar» es azul y el resultado del color elegido, con
  las insignias y los botones de Faro en ámbar; `::selection` sólo dentro de
  `html.faro-picking`.
- **§8.13 ampliada**: las claves siguen sólo en la configuración de opencode,
  y desde H18 Faro las ESCRIBE ahí por el API (§8.24) en vez de pedir que se
  peguen; siguen sin entrar en `chrome.storage`.
- **§12.3**: la decisión 5 (un perfil por host) se resuelve con H22; la 4
  (`jiraPrefix`) sigue igual; se añaden las abiertas de §8 de este plan.

## 6. Ideas descartadas con motivo (para §12.4)

- **`POST /mcp` como camino del alta** (lo que Faro hace hoy): sólo en
  memoria, invisible para `mcpStatusFor`/`mcpForHost`/`checkMcp`, muere con
  el primer dispose y no se puede reconectar. Como mucho, una comprobación
  previa efímera, y ni eso: la espera tras el PATCH ya dice si arranca.
- **`PATCH /config` de proyecto**: escribe `<cwd>/config.json`, que no se
  carga, y deja un fichero en el directorio de trabajo del usuario.
- **Un `updateGlobalConfig(patch)` genérico**: permitiría escribir `agent`,
  `permission`, `plugin` o `command` (ejecución de código). Las puertas son
  dos y cerradas: `updateMcpEntries(entradas)`, con cada entrada validada, y
  `reloadGlobalConfig()`, con el cuerpo `{}` fijo.
- **Borrar sólo en `chrome.storage`**: `mcpForHost` encuentra la entrada por
  dominio en `GET /config` y la readopta en el siguiente arranque; los tokens
  viejos siguen activos.
- **Esperar 300 ms fijos tras el PATCH**: un número medido con un juguete en
  una máquina rápida; se sondea hasta que la entrada aparece.
- **Reescribir ENTERA una entrada que ya existe** con el bloque de Faro:
  rompería una hecha a mano con docker, ruta absoluta o versión fijada. Sólo
  se reescribe el environment.
- **Deshabilitar a ciegas toda entrada ajena que lleve el dominio**: es
  destructivo con tokens que Faro no creó; se lista por nombre y exige una
  casilla aparte.
- **`npx mcp-atlassian`**: el paquete de npm es de otro autor y ejecutaría
  código ajeno con los tokens de Atlassian.
- **Docker como selector en la pantalla de claves**: exige Docker Desktop
  encendido (licencia y admin en empresa), imagen de 218 MB y versión opaca
  con `:latest`; se documenta con el bloque probado, nada más.
- **`{env:VAR}` en el `command`**: con una ruta de Windows dentro tumba
  opencode al arrancar (`InvalidEscapeCharacter`).
- **Sólo subir el `timeout`**: no arregla que falte uvx (falla en 40 ms) y no
  explica nada.
- **Fijar la versión de mcp-atlassian sólo en el script**: quien no lo
  ejecute baja la última el día de su primer uvx; si se fija, va también en
  el `command` que Faro escribe, con una constante compartida y su pin.
- **Sólo arreglar el defecto del modelo, sin pantalla**: el primer uso sigue
  fallando la primera vez y el usuario no elige antes del contexto, que es lo
  que pidió.
- **Sondear todos los modelos (o todos los defaults) al arrancar**: gasta N
  turnos de pago sin permiso y los mudos bloquean hasta el tope.
- **La sonda al pulsar «Usar este modelo» en el primer uso**: redundante con
  el turno real de `verifyCredentials` dos pasos después; queda como
  «Comprobar» opcional fuera del primer uso.
- **Leer `~/.local/state/opencode/model.json`** (recientes y favoritos de la
  TUI): no hay endpoint y la extensión no lee disco.
- **Conectar proveedores desde Faro** (`PUT /auth`, OAuth): es escribir
  credenciales, fuera de este diseño.
- **Índice partido por espacio con el contexto por host (opción i)** y **una
  clave por (host, espacio) (opción ii)**: la primera no resuelve el CONTEXT.md
  pisado; la segunda rompe el olvido derivado de H13, la lectura única y el
  paso a paso entre espacios.
- **Repartir `CONTEXT_BUDGET.linked` a partes iguales entre todos los
  espacios** del Confluence enlazado: cinco resúmenes truncados de páginas
  que no vienen al caso; viaja UN espacio, con un selector manual de respaldo.
- **Migrar el CONTEXT.md de hoy al `index.scope` guardado en cualquier caso**:
  con un contexto subido a mano o un `scope` `confluence-site` podría
  asignarse al espacio equivocado; en la duda, `'*'`.
- **Un cubo `references` en el índice, o más fases del indexador**: ya
  descartados en el primer plan; no vuelven por el multi-espacio.
- **El MCP de Excalidraw** (oficial o comunitario), **Mermaid vendorizado**,
  **viz.js**, **un DSL JSON propio** y **elementos Excalidraw emitidos por el
  modelo**: §3.5.
- **La viñeta del diagrama siempre en el prompt de Análisis** (por ahora):
  ~120 tokens por turno aunque no se dibuje, 9 instantáneas cambiadas y un
  riesgo real sobre la escalera de §4.4; primero el botón y los turnos
  reales.
- **Cosechar las claves del diagrama con una JQL nueva desde el panel**: una
  tercera procedencia de consulta con claves sacadas de la prosa del modelo
  (§8.12, M4); si se hace, en H25 y por `kind`.
- **Anchura de texto estimada en el layout**: en el panel hay medida real
  (`measureText`); la estimación queda sólo para las pruebas en Node.
- **«Todo azul» en el panel** (opción ii de F): §3.6.
- **`mix-blend-mode` en `.quote-rect`**: inerte, el host aísla la mezcla
  (verificado con capturas idénticas).
- **El «rotulador» de mezcla como valor por defecto sin medir**: segunda raíz
  en el documento, GPU en cada frame y multiply/screen que falla en zonas
  mixtas; condicionado a un trace.
- **Tres colores y tres estilos de subrayado**: el usuario pidió «más
  bonito», no más opciones; azul y ámbar, dos estilos.
- **Cursores animados o mayores de 32 px**: no se admiten o se bloquean al
  solaparse con la interfaz del navegador.
- **Un enlace a docs.astral.sh desde un aviso de Faro**: S5 sólo abre el
  sitio, el enlazado e `id.atlassian.com`; la ayuda es un comando para copiar.

## 7. Lo que sólo se puede verificar en real

- **Con un compañero** (H20, lo único que reproduce lo que falló): un Windows
  SIN uv y con otro plan de Copilot, en la red corporativa (proxy con
  inspección TLS, si la hay): cuánto tarda la primera descarga, si
  `instalar.ps1` corre con la política de ejecución de su equipo, si opencode
  arrancado desde una terminal nueva conecta a la primera, qué modelos lista
  su `GET /config/providers` y cuál rechaza, y todo el primer uso de punta a
  punta. Antes de H16, su Registro o una captura, por si su caso fuera otro.
- **Con el opencode de Marco** (con copia del fichero, y sólo tras el
  sandbox): «Cambiar las claves» sin pegar nada y ver «MCP reconocido/
  verificado»; «Quitar las claves» y comprobar la entrada deshabilitada sin
  tokens; que el `verified: false` de una adopción aparezca y se vaya; y, con
  permiso de gasto, `openai/gpt-5.4` → `plan` en menos de 1,5 s y
  `github-copilot/gpt-5.6-luna` → ok en una request. **Tras H17 sigue
  pendiente**: la sonda («Comprobar», `client.probeModel`) existe y sólo se
  ha probado con fetch falso; que opencode 1.2.25 acepte de verdad `variant`
  en `prompt_async`, que un mudo se corte a los 15 s y que la sesión «Faro ·
  probando modelo» no quede en opencode (abort + DELETE) se ve la primera vez
  que alguien pulse «Comprobar» con ese permiso. **Tras H18 sigue pendiente**: la
  escritura está verificada contra un opencode 1.2.25 AISLADO con un MCP de
  juguete (`npm run sandbox`, 7/7), no contra el de Marco ni con mcp-atlassian:
  «Cambiar las claves» sin pegar nada (con copia del fichero), cuánto tarda
  mcp-atlassian en aparecer y conectar tras el PATCH en frío, y que el primer
  `GET /mcp` de una entrada reutilizada no conteste todavía con la instancia
  vieja.
- **Supuestos que sólo se cierran allí**: que un rechazo de Copilot no cuenta
  como request; que la configuración de PROYECTO tapa a la global (por eso se
  relee `GET /config`); ~~que `uvx mcp-atlassian@0.23.1` arranca con esa
  sintaxis (lo medido fue `uv tool install ==`)~~ **VERIFICADO en H15**
  (2026-09-26: arranca, 1,3 s con la caché caliente); ~~el valor exacto de
  `TOOLSETS` que significa «todas»~~ **VERIFICADO en H15** (`all`, leído en
  `utils/toolsets.py` de 0.23.1); que `variant` abarata la sonda. Lo que la sonda de H16 SÍ
  cerró (2026-09-26): el formato «Available models: […]» del rechazo de
  Copilot sigue siendo el mismo, con la lista ENTERA (57 ids, 1 022
  caracteres), y ahora está guardado como fixture; que el rechazo no cuente
  como request sigue sin verificar.
- **En el Jira y el Confluence reales, con el método blob de H14 (sólo
  GET)**: la CSP `img-src` para el cursor en `data:`; SIMPL y DCPIAS leídos
  por la API, fundidos, `subIndex`, `treeTitles` y `treeSteps` entre
  espacios; el tema oscuro real para multiply/screen (H25); y `npm run turn`
  sobre un Análisis de una épica con varios tickets para ver qué Mermaid
  escribe `gpt-5.6-luna` (H24) y que la numeración no regresa.
- **En la extensión cargada** (lo que ningún hito anterior ha visto tampoco:
  CLAUDE.md §12.2): las tres pantallas encadenadas del primer uso con sus
  esperas de hasta 120 s —riesgo ACEPTADO: el panel no corre en el banco y
  el modo del espejo de H17 sólo mide cada pantalla por separado, así que la
  máquina de estados de §3.3 sólo se recorre entera aquí; H17 lo dejó así:
  «Primer uso (encadenado)» del espejo pasa por conexión → modelo → claves →
  contexto midiendo cada una, pero no rearranca nada—, la pantalla «Elige el
  modelo» con su flecha oculta y Escape sin efecto en el primer uso, la cabecera «comprobando…» durante el PATCH, el
  panel de OTRA ventana durante una escritura, «Analizar»/«Dibujar el flujo»
  dejando la pregunta sin mandarla, y el puntero de verdad moviéndose.
- **Un lector de pantalla** con la lista de 43 modelos y su filtro, la espera
  larga del MCP (cómo se anuncia sin saturar, A2) y el SVG del diagrama.

## 8. Decisiones abiertas para Marco

Las tomo así si no dices lo contrario:

1. **Escribir en `~/.config/opencode/opencode.json` por el API**: sí, con
   una frase de consentimiento la primera vez que diga la ruta real, que el
   fichero se reformatea (sangría 2, claves reordenadas; los `.jsonc` se
   respetan) y que se cortan las respuestas en curso de cualquier ventana
   conectada a ese opencode y se reinician sus MCP (≈14 s).
2. **Entrada que ya existe** (a mano, docker, ruta absoluta, versión fijada):
   si está habilitada se conserva su `command` (por la lista blanca, o byte a
   byte el suyo) y se reescriben las variables y `enabled`; si está
   deshabilitada y no es de Faro, no se toca y se crea otra al lado; el
   reintento con la ruta absoluta de uvx sólo sobre la que Faro acaba de
   crear, y con vuelta atrás si no conecta.
3. **«Quitar las claves»**: quita los DOS productos enlazados (un solo MCP),
   lista por nombre lo que va a deshabilitar, las entradas ajenas sólo con
   una casilla aparte, y deja el esqueleto deshabilitado en `opencode.json`
   diciéndolo (no hay borrado por API). Para quitar un solo producto:
   «Cambiar las claves» con ese producto desmarcado.
4. **Versión de mcp-atlassian fijada** (0.23.1) en el script Y en el
   `command` que Faro escribe, con una constante compartida y su pin (se sube
   a mano; a cambio, todo el equipo con la misma); `TOOLSETS` con el valor
   que signifique «todas» (leído en H15), para que el cambio anunciado no
   quite herramientas; `timeout` 60 000 (120 000 si hay proxy lento).
5. **Modelo GLOBAL de la persona** (el segundo sitio no vuelve a preguntar),
   con `saved.model` como migración.
6. **Sin sonda en el primer uso** (la verificación de claves hace de prueba,
   coste cero extra); «Comprobar» opcional desde Ajustes o desde un error.
   ¿Verificar Jira y Confluence en UN turno en vez de dos? Se estudia en H17.
7. **La pantalla lista TODOS los modelos conectados**, con los que tienen
   veredicto de fallo plegados bajo «No disponibles (N)»; los `opencode/*`
   caen ahí de golpe con el primer 403.
8. **Escape en `screen-model`**: entra en `ESCAPE_CLOSES` con la flecha
   oculta (`hidden`) en el primer uso y visible sólo desde Ajustes o desde un
   error de un turno, y el manejador de Escape deja de pulsar botones que
   falten o estén ocultos; el pin de `screens.test.js` cambia con verdad.
9. **Multi-espacio**: al entrar en un espacio sin mapa, aviso NO bloqueante
   («aún no tiene mapa · Construir»), nunca la pantalla de contexto; en un
   espacio sin contexto propio el modelo ve el `'*'` heredado si existe y, si
   no, sólo la línea de las claves; memoria entre sesiones y sesión de
   opencode siguen por HOST; desde Jira viaja UN espacio por las reglas (a)-(c)
   más el selector manual en Ajustes, todo en H22 (la regla (b) hace que el
   historial ELIJA qué contexto enlazado viaja, y se dice; si prefieres la
   promesa literal de que el historial no toca ningún prompt, se quita (b));
   tope total medido en H21, sin desalojo automático y con «Olvidar el mapa de
   X»; sugeridas y
   búsqueda con el espacio de la pestaña DELANTE sin excluir los demás; el
   paso a paso a otro espacio se mantiene; D1 antes que D2.
10. **Diagramas**: botón «Dibujar el flujo» primero, la viñeta en el prompt
    sólo tras leer turnos reales; sólo Jira; «Copiar como Mermaid» y NO
    «Descargar .excalidraw», si H24 confirma que Excalidraw importa Mermaid
    pegado (hoy es un supuesto); el MCP de Excalidraw se descarta; `dagre`
    vendorizado sólo si el layout se queda corto (rompería «sin
    dependencias» en un único fichero de 284 KB); el grafo exacto de
    `issuelinks` por la API, condicionado (H25b).
11. **Subrayado**: herramienta de «Señalar» azul; marcas azules por defecto
    con ámbar a elegir; insignias y botones de Faro en ámbar; dos estilos
    (Subrayado y Foco); insignias como superíndice; el «Rotulador» de mezcla
    sólo tras medir (H25a).
12. **Scripts sólo para Windows** (`instalar.ps1` y `arrancar-opencode.ps1`);
    el `.sh` si alguien del equipo usa macOS o Linux. El instalador comprueba
    Node y opencode y, si falta opencode y hay Node, ofrece `npm i -g
    opencode-ai`; nunca instala Node ni escribe la contraseña.
13. **Orden**: uv primero (H15, dos o tres días y desbloquea), modelos justo
    detrás (H16-H17), y el MCP automático después. Alternativa: modelos
    primero, porque es «el principal».
14. **Permiso de gasto** para H17 (una sonda), H20 (la sesión con el
    compañero) y H26 (`npm run test:integration`).
15. **La copia `opencode.json.faro-bak-2026-09-25`** con tus tokens, que
    quedó junto al fichero real: bórrala cuando quieras; no la toco.

## 9. Anexos

- `docs/plan/anexo-2-A-mcp-automatico.md` · el API de opencode 1.2.25 para
  crear y quitar el MCP, verificado en un opencode aislado (18 hechos, 5
  opciones, el script de aislamiento).
- `docs/plan/anexo-2-B-uvx.md` · uv, uvx, el MCP que no arranca, tiempos en
  frío y en caliente, Docker, npm, BOM y `{env:}` (19 hechos, 5 opciones).
- `docs/plan/anexo-2-C-modelos.md` · la lista por persona, los rechazos
  medidos, la reconstrucción del fallo del compañero y la pantalla (18
  hechos, 3 opciones).
- `docs/plan/anexo-2-D-multi-espacio.md` · qué pasa hoy con dos espacios,
  las tres opciones y el contrato de ámbitos (19 hechos).
- `docs/plan/anexo-2-E-diagramas.md` · Excalidraw, Mermaid, viz.js, la prueba
  de concepto y su SVG (17 hechos, 7 opciones).
- `docs/plan/anexo-2-F-subrayado.md` · el inventario del overlay, las medidas
  de contraste, el cursor y las dos formas de la marca (16 hechos, 5
  opciones).
- `docs/plan/anexo-2-juicios.md` · los dos juicios cruzados tal cual:
  conflictos, huecos, hitos, objeciones.

Los anexos son informes de investigación escritos por agentes en Opus el
2026-09-25/26 y verificados por el orquestador; sus números de línea se
refieren al código de `9fcbe7d` y cambiarán. Donde un anexo diga algo distinto
de las secciones 3-5 (por ejemplo la sonda en el primer uso, el sleep de
300 ms, el reparto del contexto enlazado, el «rotulador» como defecto o la
viñeta del diagrama siempre en el prompt), manda el plan: son justo las cosas
que los jueces objetaron y este documento cambió.
