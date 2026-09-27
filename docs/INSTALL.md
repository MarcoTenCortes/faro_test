# Instalación paso a paso

## 0. Antes de nada: uv

El MCP de Atlassian (`mcp-atlassian`) es un programa de Python, y opencode lo
arranca con `uvx`, el lanzador de **uv** (el gestor de paquetes de Python de
Astral): `uvx` descarga el paquete la primera vez, lo guarda en su caché y lo
ejecuta, sin que tengas que instalar Python a mano. Sin `uvx`, opencode no
puede arrancar el MCP y el panel lo ve en «failed»: es lo que dejó a un
compañero quince minutos mirando la pantalla de claves.

En Windows, desde la carpeta de Faro:

```powershell
powershell -ExecutionPolicy Bypass -File tools\instalar.ps1
```

El `-ExecutionPolicy Bypass` hace falta porque un zip descargado lleva la «marca
de la web» y la política de ejecución por defecto no deja correr un `.ps1` con
ella; sólo vale para esta ejecución, no cambia nada del sistema.

Qué hace, en orden (y es idempotente: puedes repetirlo cuando quieras):

1. Relee el PATH del registro (usuario y máquina), por si algo se instaló en
   otra terminal, y busca `uvx`: primero en el PATH, después en
   `%USERPROFILE%\.local\bin\uvx.exe`. Si no está, instala uv con el instalador
   oficial de Astral (`irm https://astral.sh/uv/install.ps1 | iex`) y, si ése
   falla, con `winget install --id astral-sh.uv`. Sin permisos de
   administrador.
2. `uv tool install mcp-atlassian==0.23.1`: la versión **fijada**, la misma que
   Faro escribe en el bloque del MCP (`uvx mcp-atlassian@0.23.1`), para que todo
   el equipo lleve la misma. Si falla por certificados (una red corporativa con
   inspección TLS), reintenta con `--native-tls`, y si sigue fallando te dice
   qué fijar: `UV_NATIVE_TLS=1` (o `SSL_CERT_FILE`) y `HTTPS_PROXY`.
3. Comprueba que arranca: `mcp-atlassian --version` y
   `uvx mcp-atlassian@0.23.1 --version`, cada uno con sus segundos.
4. Mira Node y `opencode --version` (1.2 o más). Si falta opencode y tienes
   Node 18 o más, te pregunta si ejecuta `npm i -g opencode-ai`; **nunca
   instala Node**.
5. Mira si ya hay un opencode escuchando en `127.0.0.1:4096`. Si lo hay, te
   avisa en **rojo**: ciérralo y arráncalo desde una terminal NUEVA, porque el
   opencode que está abierto no ve `uvx` (el MCP hereda el PATH con el que
   arrancó opencode, y el de una terminal abierta antes de instalar uv no lo
   lleva).
6. Un resumen con las rutas, las versiones y el comando para arrancar.

Qué **no** hace: no escribe la configuración de opencode (`opencode.json`: el
BOM que pone PowerShell 5.1 la dejaría sin arrancar), no toca tokens ni la
contraseña del servidor y no cambia variables del sistema. Si algo falla sale
con 1 y una línea clara; si falta algo, «Falta: …».

Con `-SoloComprobar` no instala ni pregunta nada: dice qué hay y qué falta
(`uvx` va sin red, así que si el paquete no está en la caché lo dice en vez de
descargarlo) y sale con 1 si falta algo. Que mcp-atlassian no esté instalado
con `uv tool` es sólo un aviso, no una falta: `uvx mcp-atlassian@<versión>`
arranca igual desde la caché, sólo más despacio. Con `-Si` acepta la pregunta
de opencode sin esperar.

Después de instalar uv, **cierra la terminal y abre una nueva** antes de
arrancar opencode: la que tenías abierta tiene el PATH de antes.

### Arrancar opencode con el script

La forma recomendada de arrancar el servidor es:

```powershell
powershell -ExecutionPolicy Bypass -File tools\arrancar-opencode.ps1
```

Relee el PATH del registro (así un uv recién instalado se ve aunque la terminal
sea vieja), te pide la contraseña del servidor si no está en
`OPENCODE_SERVER_PASSWORD` —sin enseñarla al escribir, sólo para ese proceso:
no se guarda en ningún sitio, y vacía no arranca— y lanza el comando de la
sección 1 con el `--cors` de esta extensión. Además arranca en una carpeta
propia y vacía (`%LOCALAPPDATA%\Faro\opencode-cwd`) con
`OPENCODE_DISABLE_PROJECT_CONFIG=1` y `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1`:
opencode busca `AGENTS.md`, `CLAUDE.md` o `CONTEXT.md` subiendo desde la carpeta
en la que arranca y los mete como «Instructions from:» en cada sesión (texto que
llega al modelo y cuesta tokens en cada turno), y carga el `opencode.json` de
proyecto de esa carpeta, que podría tapar el bloque del MCP.

`-Port 4097` cambia el puerto; `-SoloMostrar` imprime la carpeta, las variables
y el comando sin lanzar nada ni pedir la contraseña. Si el puerto ya está
ocupado sale con 1: no pisa un opencode que ya esté corriendo.

**macOS o Linux**: no hay script. Instala uv con
`curl -LsSf https://astral.sh/uv/install.sh | sh`, abre una terminal nueva,
`uv tool install mcp-atlassian==0.23.1` y arranca opencode a mano (sección 1).

## 1. opencode

Ya lo tienes (`opencode --version` → 1.2.25). Sólo hace falta arrancarlo en
modo servidor con dos cosas: el origen de la extensión en `--cors` y una
contraseña.

### El origen de la extensión

Chrome deriva el identificador de una extensión del campo `key` del manifest.
Como aquí está fijado, el identificador es siempre el mismo:

```
ickohiffpicdfeameogbihbcanbjibmk
```

Si algún día regeneras la clave (`npm run key -- --write`), el identificador
cambia y hay que actualizar el comando de arranque. `npm run check` avisa si el
identificador del manifest y el del código dejan de coincidir.

### Arrancar

En Windows, lo más cómodo es `tools\arrancar-opencode.ps1` (sección 0): hace
esto mismo y además relee el PATH y arranca en una carpeta propia. A mano:

**PowerShell:**

```powershell
$env:OPENCODE_SERVER_PASSWORD = "elige-algo-largo"
opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO
```

**bash:**

```bash
OPENCODE_SERVER_PASSWORD="elige-algo-largo" opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO
```

Con `--print-logs --log-level INFO` la terminal va ensenando cada peticion
(`method`, `path`, `status`, `duration`), que ficheros de configuracion carga,
que servidores MCP levanta y cualquier error. Si prefieres menos ruido, baja a
`--log-level WARN`; si estas persiguiendo algo raro, sube a `DEBUG`.

Si al arrancar ves `Warning: OPENCODE_SERVER_PASSWORD is not set`, la variable
no llegó. Ojo con el `set VAR=valor && ...` de `cmd`: mete un espacio al final
del valor.

Para dejarlo siempre corriendo en Windows, lo más simple es un acceso directo
en `shell:startup` que ejecute ese comando minimizado.

## 2. La extensión

Hace falta **Chrome 130 o más nuevo** (`minimum_chrome_version` del manifest). El
panel lateral y el subrayado existen desde la 116, pero la protección que hace
que los módulos de Faro sólo se sirvan a la página por una URL distinta en cada
sesión —para que ninguna web pueda comprobar si la tienes instalada— sólo actúa
desde la 130; entre la 116 y la 129 Chrome ignoraba esa clave, así que el mínimo
se subió para que no fuera opcional.

1. `chrome://extensions`
2. Activa **Modo desarrollador**
3. **Cargar descomprimida** → selecciona esta carpeta
4. Comprueba que el identificador que muestra Chrome coincide con el de arriba

No hay paso de compilación: son módulos ES que Chrome carga tal cual.

## 3. Claves de Atlassian

Jira y Confluence son dos productos, y cada uno lleva **su dirección y su
token**. Un solo servidor MCP sirve a los dos.

Antes de esta pantalla, la primera vez, Faro te pide **el modelo** (la pantalla
«Elige el modelo», apartado 6 → «Elegir modelo»): la comprobación de tus claves
es ya un turno con ese modelo, y así un modelo que tu plan no permite no se
confunde con un token malo. Si ya tienes uno elegido de otro sitio, no la ves.

1. Consigue los tokens:
   - **Cloud** -> [id.atlassian.com -> Security -> API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
     El mismo token vale para Jira y para Confluence: pégalo en los dos bloques.
   - **Server / Data Center** -> en *cada* producto, tu perfil -> *Personal
     Access Tokens*. Son dos tokens distintos, de dos instalaciones distintas.
2. Abre Jira o Confluence, pulsa el icono de Faro y rellena un bloque por
   producto: dirección, correo (sólo en Cloud) y token. La dirección del
   producto en el que estás viene rellena; en Cloud también la del otro, porque
   comparten host. En Data Center el otro producto sale sin marcar: márcalo y
   escribe dónde vive (`https://jira.tuempresa.com`). Puedes pegar cualquier
   URL del sitio, una incidencia, una página o el enlace corto de «Compartir»
   (`…/x/AbCd`): Faro se queda con el sitio, y conserva una ruta de contexto
   si la hay (`/jira`, `/confluence`, `/wiki`).
   En Data Center marca la casilla: se usan los tokens personales y no hace
   falta correo.

Con el permiso dado (abajo), Faro **escribe él mismo el MCP en la configuración
de opencode** y, en cuanto está conectado, comprueba **los dos tokens**, uno
detrás de otro, y lo dice.

Si Jira y Confluence viven en **hosts distintos**, el otro host queda
**enlazado** a éste: comparte el MCP —no se levanta un segundo proceso con el
mismo token— y al abrirlo no se vuelven a pedir claves. En el registro sale
como «Sitio enlazado». Y aunque Faro no lo hubiera apuntado —porque pegaste el
bloque a mano, o porque la comprobación no terminó en el panel—, al abrir
cualquiera de los dos dominios reconoce el MCP que lo lleva dentro y lo adopta
(«MCP reconocido»). Y desde ese Jira, el contexto del Confluence enlazado
(su `CONTEXT.md`, si lo construiste) va en cada pregunta: sirve para saber
qué páginas mirar, y en el registro sale como «Contexto de Confluence
enlazado», con el host y su tamaño.

### Faro escribe el MCP en opencode

opencode 1.2.25 carga los servidores MCP de su configuración al arrancar **y
cada vez que alguien la cambia por su API** (`PATCH /global/config`: comprobado
contra un servidor real aislado; no está en su documentación). Así que Faro ya
no te pide que pegues nada: escribe él el bloque en el fichero de configuración
global de opencode y espera a que lo cargue. (Su otro camino, `POST /mcp`,
arranca el proceso **sólo en memoria**: no se escribe en ningún fichero,
`GET /mcp` no lo ve y muere en cuanto opencode recarga. Por eso no se usa.)

Lo que ves en la pantalla de claves:

1. **La primera vez, un permiso.** Encima del botón sale la carpeta donde tu
   opencode tiene su configuración (en Windows, `C:\Users\<tú>\.config\opencode`)
   y lo que pasa al escribir: opencode escribe en el primero que exista de
   `opencode.jsonc`, `opencode.json` y `config.json` (si no hay ninguno, crea
   `opencode.jsonc`), **reformatea el fichero** (sangría de dos espacios y las
   claves reordenadas; un `.jsonc` conserva su formato) y **reinicia sus
   conexiones**: si tienes una respuesta a medias en otra ventana conectada a ese
   mismo opencode —otra ventana de Chrome, la TUI—, se corta. El botón no se
   enciende hasta que marcas la casilla. Faro recuerda el permiso, pero
   **«Cambiar las claves»** (en Ajustes) lo vuelve a pedir siempre.
2. **Escribe con el panel quieto.** Con una respuesta llegando, un indexado en
   marcha, «Comprobar» probando un modelo o la comprobación de las claves a
   medias, Faro no escribe: te dice que esperes, porque escribir lo cortaría.
3. **Espera**, en tres pasos que se leen bajo el botón: «Escribiendo en
   opencode…», «Esperando a que opencode recargue…» (hasta que el MCP aparece
   en su lista; contra un servidor aislado, menos de una décima de segundo) y
   «Arrancando el MCP…» (la primera vez, `uvx` descarga; abajo). Si tu opencode
   no es la versión probada (1.2.25), lo dice ahí mismo.
4. **Comprueba que lo que carga es lo escrito.** Si arrancaste opencode desde
   una carpeta que tiene su propio `opencode.json` de proyecto, ése taparía al
   global: Faro lo detecta y te lo dice («hay una configuración de proyecto
   delante»). `tools\arrancar-opencode.ps1` arranca en una carpeta propia, así
   que con él no pasa.
5. **Comprueba los tokens**, ya sin escribir nada en opencode: si vuelves a la
   pantalla del modelo porque el modelo falló, al elegir otro sólo se repite
   esta comprobación.

Si ese dominio **ya tenía un MCP** en tu configuración (pegado a mano, con
Docker, de una versión anterior de Faro), se reutiliza: conserva su nombre, su
comando y su plazo (que no baja de un minuto), y sólo se reescriben las
variables. Uno que tú desactivaste a mano (`"enabled": false`) no se vuelve a
encender: se crea otro a su lado. Y el bloque lleva siempre las diez variables
que Faro sabe poner, vacías las que no usa: opencode **fusiona** lo que recibe
con lo que ya hay, así que al pasar de Cloud a Data Center el correo y el token
de Cloud se quedan en blanco en vez de quedarse con el valor viejo. Una variable
que hayas añadido tú (`CONFLUENCE_SSL_VERIFY`, por ejemplo) se conserva, porque
Faro no la toca.

**«Cambiar las claves» sólo renueva el producto de la pestaña.** En un Data
Center, Jira y Confluence comparten el mismo MCP, y la pantalla de claves sólo
trae marcado el producto de la pestaña desde la que la abres: desde una pestaña
de Confluence se renueva el token de Confluence, y las variables de Jira se
conservan tal como estaban (y al revés desde Jira). Si marcas los dos
productos, se reescriben los dos. Tampoco se pisa el comando de un MCP que ya
exista con el nombre de Faro aunque no lleve este dominio, y si opencode no
contesta cuando Faro lee su configuración, **no escribe nada** —sin saber qué
hay no puede saber qué se llevaría por delante— y te deja el bloque para
pegarlo a mano, con «No he podido leer la configuración de opencode» como
motivo.

Si el MCP que Faro acaba de crear **cae al instante** con «Connection closed»
(casi siempre, un opencode arrancado antes de instalar uv, que no encuentra
`uvx`), Faro lo intenta una vez con la ruta completa
`C:\Users\<tú>\.local\bin\uvx.exe`, que es donde la deja el instalador oficial
de uv; si tampoco arranca, devuelve el comando a `uvx` y te enseña el consejo de
siempre con **Reintentar**. Esa vuelta al comando `uvx` se hace aunque te vayas
de la pantalla o a otra pestaña a mitad: la ruta completa no se queda escrita.
Lo de fondo se arregla arrancando opencode desde una terminal nueva. Lo mismo
vale para el MCP que Faro creó en un intento anterior (con su comando de
siempre); con uno que lleve un comando tuyo (Docker, una ruta propia) no toca
nada.

Si recargas el panel a mitad —el MCP ya escrito y conectado, pero sin que se
llegaran a comprobar los tokens—, Faro lo reconoce y lo adopta, pero lo dice en
el chat: «Las claves de <sitio> no se han comprobado todavía…», con un botón
**Comprobar las claves** que hace esa comprobación sin volver a escribir nada.
El aviso se va con la primera comprobación buena. Si ya tenías el sitio
configurado de antes, no lo verás.

### El paso manual, sólo si falla

Si opencode **no acepta la escritura** —su fichero tiene un error de sintaxis,
o una clave que no conoce—, Faro te dice cuál de las dos es (sin enseñarte el
fichero: lleva tus claves) y te deja exactamente qué pegar y dónde:

```
C:\Users\marco\.config\opencode\opencode.json
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "atlassian-confluence-simplprogramme-eu": {
      "type": "local",
      "command": [
        "uvx",
        "mcp-atlassian@0.23.1"
      ],
      "environment": {
        "JIRA_URL": "",
        "JIRA_PERSONAL_TOKEN": "",
        "JIRA_USERNAME": "",
        "JIRA_API_TOKEN": "",
        "CONFLUENCE_URL": "https://confluence.simplprogramme.eu",
        "CONFLUENCE_PERSONAL_TOKEN": "...",
        "CONFLUENCE_USERNAME": "",
        "CONFLUENCE_API_TOKEN": "",
        "READ_ONLY_MODE": "true",
        "TOOLSETS": "all"
      },
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Tres cosas del bloque que no son de adorno: la versión va **fijada**
(`mcp-atlassian@0.23.1`, la misma que instala `tools\instalar.ps1`: `uvx` no
actualiza solo, y sin fijarla cada uno se quedaba con la del día de su primer
arranque); `TOOLSETS: "all"` conserva todas las herramientas, porque
mcp-atlassian avisa de que en una versión futura su valor por defecto pasará a
seis grupos y Faro perdería herramientas sin que nada fallara; y `timeout` es el
plazo de **arranque**, un minuto. Las variables vacías son las que no se usan,
y mcp-atlassian las trata como si no estuvieran.

Si el fichero ya existe, el panel tiene un botón para copiar **sólo el bloque
`mcp`** y que lo fusiones tú.

Después pulsa **Ya lo he pegado**: opencode relee su configuración sin
reiniciar. Si aun así no lo ve, reinícialo con el mismo comando. Faro está
mirando: en cuanto ve el MCP conectado, comprueba los tokens y sigue solo.

Y si Faro **lo escribió pero opencode no lo ha cargado** en 20 segundos (una
versión que no recarga la configuración en caliente), no hay nada que pegar: te
dice dónde está escrito y que reinicies opencode; en cuanto vuelve, sigue solo.

La primera vez, `uvx` descarga `mcp-atlassian` (unos 107 paquetes, y Python si
no lo tienes) y el proceso tarda en arrancar: con la caché ya caliente son de 8 a
12 segundos, y detrás de un proxy corporativo más. Es normal que el panel espere
un poco. El plazo del bloque es de 60 s; si se pasa, el MCP queda en «failed ·
Operation timed out» y el panel ofrece **Reintentar** (la descarga sigue en
segundo plano, así que el segundo intento suele entrar). Si ejecutaste antes
`tools\instalar.ps1`, los paquetes ya están en la caché de uv y el primer
arranque se ahorra la descarga.

Las claves acaban en la configuración de opencode, en disco, protegidas por los
permisos del sistema de ficheros. Faro las manda ahí en una sola petición y no
las guarda en el navegador: la extensión sólo recuerda el nombre del MCP, si
sus claves se han comprobado y que ese host ya
está configurado.

### Quitar las claves de este sitio

Para cambiarlas o dejar de usar un sitio, **Ajustes → Este sitio → Quitar las
claves de este sitio**. Va en dos pasos, y el primero no escribe nada: Faro lee
lo que tu opencode tiene de verdad y te lo enseña debajo del botón —qué entradas
de Faro va a deshabilitar; qué otro host (tu Jira o tu Confluence, si comparten
MCP) se queda también sin claves porque usa esa misma entrada; que afecta a
**cualquier cliente de ese opencode**, la TUI incluida (opencode reinicia sus
conexiones y una respuesta a medias en otra ventana se corta); y en qué carpeta
queda el rastro—. «De Faro» es por su comando (el `uvx` que escribe Faro), no
por su nombre: una entrada que **no escribió Faro** (pegada a mano, con Docker)
sale con su propia casilla, desmarcada, aunque Faro ya la estuviera usando. Sin
marcarla se queda como está: si está habilitada, el sitio la seguirá adoptando;
si ya estaba deshabilitada, no se adopta, pero guarda sus claves en disco y
marcarla las vacía. Si sólo hay entradas de ésas, **Quitar** no se enciende
hasta que marques la casilla. Una que Faro no sabe deshabilitar (un MCP remoto,
o una con un nombre que Faro no puede escribir, como uno con espacios) se nombra
o se cuenta para que la quites a mano. Y si alguna guarda algo que Faro no sabe
vaciar —una variable que añadiste tú, como `JIRA_SSL_VERIFY`, o lo que lleve el
comando de una entrada con Docker—, te lo dice aparte: eso se queda en el
fichero y lo quitas a mano.

Al pulsar **Quitar**, Faro vuelve a leer la configuración (si ha cambiado desde
que abriste la lista, te la enseña otra vez y no escribe nada) y, con el panel
quieto, reescribe cada entrada **entera, deshabilitada y con sus diez variables
vacías** en una sola escritura: opencode no deja borrar una entrada por su API, y
un «deshabilitar» a secas dejaría los tokens en el fichero. Después comprueba que
lo que opencode carga es eso y sólo entonces da el sitio por desconfigurado y te
lleva a la pantalla de claves —o, si tenías algo escrito en el cuadro, a un
aviso en el chat con **Cambiar las claves**—, que dice «El MCP «…» está
deshabilitado y sin claves en opencode (es lo que deja «Quitar las claves»)…».
En tu fichero queda esa entrada deshabilitada y sin claves: si vuelves a guardar
las claves —desde este sitio o desde el que comparte su MCP—, Faro la
reutiliza, con su comando.

Si opencode no acepta la escritura, las claves siguen ahí y el panel te dice qué
hacer a mano: en la carpeta de configuración, `"enabled": false` en esas
entradas y sus variables vacías. Si la acepta pero lo que carga no es lo escrito,
hay una configuración de proyecto delante (en la carpeta donde arrancaste
`opencode serve`): arráncalo desde otra (`tools\arrancar-opencode.ps1` usa una
propia) y vuelve a intentarlo; en los dos casos Faro no da el sitio por
desconfigurado.

Quitar las claves **no** es olvidar el sitio: el índice, el contexto, la memoria
y el diario se quedan. Y «Olvidar este sitio» (§8) borra lo que Faro guarda en el
navegador y **no toca la configuración de opencode**.

### Server / Data Center

Además de los tokens personales, ten en cuenta que el wiki cuelga de la raíz
en lugar de `/wiki` (Faro no lo añade: usa la dirección tal como la escribas),
y que Chrome pedirá permiso para cada dominio la primera vez porque no están
en el manifest. Si tu Confluence o tu Jira usan un certificado interno, añade
`"CONFLUENCE_SSL_VERIFY": "false"` o `"JIRA_SSL_VERIFY": "false"` al bloque
`environment`.

## 4. Contexto

Al entrar por primera vez en un sitio, Faro ofrece tres caminos:

- **Que lo genere Faro** — en Confluence lee el **árbol entero del espacio de
  la API de tu sitio, con tu sesión**: exacto, en segundos y sin gastar un
  token, y el modelo sólo escribe con él el documento; en un proyecto de
  **Jira** propio (Data Center) cuenta una muestra de tickets con tu sesión
  —tipos, estados del flujo con cuáles son de cierre, componentes, etiquetas y
  las **convenciones de nombre** de los resúmenes, con ejemplos literales, y
  sin mirar quién es quién— y el modelo escribe el documento con esos nombres
  exactos; y si el proyecto tiene un Confluence enlazado, busca ahí si todo eso
  está documentado y apunta las páginas. Progreso visible y botón de cancelar.
  Produce el documento de contexto y el índice de navegación.

  Antes eran tres turnos del modelo —explorar, volcar el índice y levantar la
  jerarquía— y una jerarquía que el modelo se inventaba a trozos; ahora, con el
  árbol leído de la API, es **uno**. Si la API no contesta —Jira Cloud, sesión
  caducada, falta el permiso sobre el dominio, o pediste indexar «todo
  Confluence» en vez de un espacio—, se dice el motivo en el velo y al terminar
  y **se recorre entero con el modelo, como siempre**: nunca te quedas sin
  contexto por esto. Con **Ajustes → Consultar tu sitio** apagado va
  directamente por el camino de siempre, sin avisar de nada: lo elegiste tú.

  Lo contado del proyecto de Jira (los nombres exactos de tipos y estados) se
  guarda para ese sitio, se vuelve a contar como mucho una vez al día y en
  segundo plano —nunca mientras esperas el chat, y nunca pidiendo un permiso
  que no hayas dado ya—, y va en el prompt de **Búsqueda**: es lo que hace que
  el modelo escriba «status = "In Progress"» y no «status = Revisión», que en
  JQL no da error, da cero resultados. Se borra con «Olvidar este sitio».
- **Traigo el mío** — un `.md` que ya tengas escrito. El índice se construye
  igualmente en segundo plano, porque sin él no hay navegación.
- **Empezar sin contexto** — el chat funciona igual vía MCP. Puedes indexar
  después desde ajustes.

El índice se enriquece solo: cada vez que una consulta descubre una página que
no estaba, se añade. Sin coste, porque sale de lo que ya devolvieron las
herramientas MCP.

### Varios espacios (o varios proyectos) en el mismo sitio

Desde H21, **el contexto y el mapa son de cada espacio**, no del sitio entero.
Si usas un Confluence con varios espacios —por ejemplo SIMPL y DCPIAS—:

- **Cada espacio tiene su contexto.** Generar el contexto estando en DCPIAS lo
  guarda para DCPIAS, y el de SIMPL se queda como estaba (antes el segundo
  pisaba al primero sin avisar). En Jira pasa lo mismo por proyecto. Si un
  espacio no tiene contexto propio, usa el de «todo el sitio» si lo hay; y si
  no hay ninguno, el modelo sólo sabe qué otros espacios tienen mapa.
- **El mapa es uno por sitio, con cada página marcada con su espacio.** Por eso
  desde SIMPL Faro te sigue pudiendo llevar a una página de DCPIAS: el paso a
  paso empieza por abrir el espacio («Espacio DCPIAS») y sigue por su árbol.
  Donde importa, el espacio en el que estás va delante (en las sugerencias de
  páginas base, sin quitar las de los demás).
- **Al entrar en un espacio sin mapa no se abre ninguna pantalla.** El chat
  vacío dice en una línea **«DCPIAS» aún no tiene mapa**, con un botón
  **Construir** que lo genera (son un par de minutos, y se hace una vez por
  espacio; con una respuesta en marcha el botón espera). Si el espacio ya tiene
  mapa, el título del chat vacío dice cuántas páginas suyas hay en él; sin mapa,
  dice «Listo para escuchar». Un espacio tiene mapa cuando se ha construido: que
  Faro haya visto alguna de sus páginas (por la barra lateral o por una
  respuesta) no cuenta. Y si le pides que
  te lleve a una página de un espacio sin mapa, bajo la respuesta sale la
  tarjeta «Me falta el mapa de este espacio» con el mismo ofrecimiento.
- **Construir el mapa de un espacio tiene un tope: 1 500 páginas**, cinco
  espacios de 300, contando sólo las de los OTROS espacios —lo que se puede
  olvidar: las páginas que Faro aprendió sin saber de qué espacio eran y las del
  propio espacio no cuentan, así que reconstruirlo no lo hace crecer—. Es una
  puerta al construir, no un tope del mapa entero, que con lo que Faro aprende de
  la barra lateral y de las respuestas puede pasar de ese número. Cuando
  construir un espacio más podría pasarse, Faro **no lee nada y no borra
  ningún espacio por su cuenta**: te avisa en rojo («El mapa de este sitio ya
  tiene N páginas de M espacios (tope 1500). Olvida el mapa de alguno desde
  Ajustes para indexar el espacio X.») y tú eliges cuál sobra.
- **Ajustes → Mapas y contextos de este sitio** es la lista de lo que Faro
  tiene de cada espacio (o proyecto, o «todo el sitio»): cuántas páginas, cuánto
  mide su contexto y de cuándo es su mapa (y «migrado del contexto de antes de
  H21» si vino del contexto que tenías antes), con un botón **Olvidar el mapa**
  por fila. En Jira, un proyecto sólo sale en la lista si tiene contexto (las
  incidencias que Faro aprende por el camino no se olvidan desde aquí), y si
  pulsas Olvidar el mapa de algo que no tenía nada que olvidar, te lo dice («No
  había nada que olvidar de …»). Olvidar el mapa de un espacio se lleva sus páginas del mapa y su
  contexto, y **nada más**: los demás espacios, la memoria, el diario y todo lo
  demás del sitio se quedan. No es «Olvidar este sitio» (§8).
- **El contexto que ya tenías de antes** (uno solo por sitio) se queda bajo su
  espacio sólo si se puede afirmar que era suyo —el mapa guardado era de ese
  espacio y se sabe cuándo se indexó—; en cualquier otro caso sigue valiendo
  para todo el sitio, como hasta ahora. También el que subiste a mano: subirlo
  reindexaba el espacio de la pestaña, así que el mapa guardado dice de cuál
  era, y se queda bajo ese espacio (en Ajustes, su fila dice «migrado del
  contexto de antes de H21»). Faro lo convierte una sola vez, al abrir el panel,
  y lo apunta en el Registro («Contexto migrado»). Si pasaba de 60 000
  caracteres, al convertirlo se recorta y lo que sobra se pierde de lo que
  guarda Faro (tu fichero sigue donde lo tengas): el Registro lo dice en
  amarillo.
- **Desde Jira**, del Confluence enlazado viaja UN contexto, y desde H22 se
  elige **por proyecto**: si en **Ajustes → Este sitio** elegiste en qué espacio
  se documenta el proyecto de la pestaña (el selector «El proyecto «SIMPL» se
  documenta en el espacio»), manda eso; si no, el espacio de las páginas que el
  contexto de ESE proyecto cita con su id (el más citado), si no el de las
  páginas base que usaste en análisis de ese proyecto, si no el único espacio
  con contexto, y si no el de todo el sitio. Si el espacio que elegiste todavía
  no tiene contexto, viaja el de todo el sitio si lo hay, y si no, ninguno. Si al
  final no viaja ninguno, el modelo recibe una sola línea con las claves de los
  espacios de ese Confluence que sí tienen contexto (nunca su texto). Tu
  historial de análisis no entra en ninguna pregunta: sólo ayuda a elegir el
  espacio.
- **El selector** sale en **Ajustes → Este sitio** sólo en un Jira con
  Confluence enlazado y un proyecto delante. «Automático (hoy X, por el
  contexto)» dice qué elegiría Faro sin ti y por qué; «Todo el sitio» y cada
  espacio con contexto son las otras opciones, y debajo una línea dice qué viaja
  ahora. Lo que eliges se guarda por proyecto en este sitio —siempre bajo el
  proyecto que nombra el selector: si con Ajustes abierto la pestaña pasa a
  otro proyecto, el selector pasa a ése— y se apunta en el Registro («Espacio
  enlazado»). Con dos ventanas del mismo Jira, una no borra lo que eligió la
  otra.
- **El perfil del proyecto es también por proyecto** (H22): Faro guarda uno por
  cada proyecto de tu Jira (hasta 20 por sitio, los más recientes), así que
  volver a un proyecto que ya contó no lo vuelve a contar. El perfil que tenías
  de antes (uno por sitio) se conserva bajo su proyecto.

La memoria entre sesiones y la conversación de opencode siguen siendo del sitio
entero, no de cada espacio.

## 5. Memoria

- **Dentro de la sesión** funciona siempre: una sesión de opencode es un hilo
  con historial.
- **Entre sesiones** es opcional, y se enciende en **un solo sitio**: la casilla
  «Recordar entre sesiones» de la pantalla de Memoria (el icono del marcador, en
  la cabecera). Mientras está activa, ese icono se queda **encendido en ámbar**,
  así que se ve sin abrir nada. Hasta H5 había además una pastilla «Memoria» en
  la fila donde se escribe, que hacía lo mismo: dos controles para un ajuste, y
  el que se veía siempre era el que ocupaba sitio en el redactor.

  Con el interruptor activo, al pulsar «nueva sesión» se resume la anterior y el
  resumen queda disponible para las siguientes. La pantalla de memoria te deja
  leerlo y borrar entradas sueltas. Lo que hay guardado se normaliza al leerlo
  (una entrada sin fecha, editada a mano o de una versión anterior, sale sin
  fecha en vez de tumbar el turno) y se repara una sola vez, para que «Borrar»
  siga dando con cada entrada.

Lo que el modelo escribió en el resumen —y en el contexto del sitio, y en el
del Confluence enlazado— entra en cada pregunta como **información, nunca
instrucciones**: va delimitado y con esa regla detrás, y al escribirlos se le
pide que no copie al documento nada que una página le «pida» anotar. Una página
con texto dirigido a Faro no puede hacerse permanente por ese camino.

## 6. La cabecera y la barra de abajo

Arriba hay tres cosas, y ninguna ocupa más de una línea:

- **El faro**, a la izquierda del nombre. Es el estado de opencode: relleno de
  ámbar cuando está conectado, **rojo** si no hay conexión, y latiendo mientras
  se responde o mientras se comprueba. Pasando el ratón por encima dice qué pasa
  («opencode: conectado», «opencode: sin conexión», «opencode: pensando…»).
  Antes había además un punto gris con su texto al lado, en la esquina; el punto
  y el faro eran la misma información dos veces, y entre los dos se comían el
  sitio de los botones. Para un lector de pantalla el texto sigue estando ahí,
  aunque no se vea.
- **Dónde estás**, en el centro: la clave («SIMPL-1234» en Jira, «ENG» —la del espacio— en Confluence) y,
  detrás, el título de la pestaña. Si el panel se estrecha, el primero en
  recortarse es el título, y sólo cuando ya no queda título se recorta la clave,
  siempre con puntos suspensivos y nunca a hachazos contra el borde del chip; y
  el tooltip dice la ubicación entera, con el id de
  la página incluido. **Mientras se responde o mientras Faro te lleva por el
  árbol**, ese hueco enseña qué está pasando («pensando…», «paso 2/5») y al
  acabar vuelve el título. Un fallo de conexión no se queda ahí: lo cuentan el
  faro en rojo y la pantalla que te dice cómo arrancar opencode.
- **Los cinco botones**: nueva sesión, **qué mirar hoy** (con su insignia
  cuando hay novedades), memoria (encendido si la memoria entre sesiones está
  activa), registro y ajustes. Nunca se encogen ni se parten en
  dos filas, ni con el panel en su anchura mínima. El de memoria dice en qué
  estado está también por escrito —«Memoria entre sesiones: activa» o
  «: desactivada», en el tooltip y en el nombre que lee un lector de pantalla—,
  porque el color encendido no se oye.

Cada pantalla (Ajustes, Memoria, Registro, Páginas base, Qué mirar hoy, el paso
manual de las claves) se cierra con **la flecha de su cabecera**, que se queda arriba mientras
lees: antes había que bajar hasta el final a buscar un «Listo». La de Ajustes
dice «Guardar y volver», porque al cerrarla se guardan la contraseña y la
dirección del servidor y el panel rearranca.

Junto al selector de modelo, abajo, hay otras dos cosas:

- **Skill** — en qué modo trabaja Faro:
  - *General*, lo de siempre: responde y, si hay dónde, ofrece llevarte.
  - *Búsqueda*, para localizar dónde vive algo: respuesta corta y siempre
    intenta ofrecerte el camino, sin descartarlo por heurística.
  - *Resumen* y *Análisis*, que trabajan sobre lo que tienes delante —la
    selección si la hay, y si no la página abierta— y **no** ofrecen tarjeta de
    navegación, porque no hay ningún sitio al que ir.

  Faro sabe si estás en Jira o en Confluence, y la misma Skill habla distinto
  según dónde. En **Confluence**, *Búsqueda* localiza la página y te enseña el
  camino por el árbol. En **Jira** no hay árbol: *Búsqueda* escribe una
  **consulta JQL** con lo que preguntas —acotada al proyecto en el que estás,
  salvo que pidas otra cosa, y apoyándose en el contexto del proyecto para
  poner `issuetype`, `status` o un prefijo del resumen; en un Jira propio, con
  los nombres EXACTOS que Faro contó de tu proyecto delante, que es lo que
  evita un `status = Revisión` que no da error sino cero resultados—, te dice qué JQL ha
  usado para que puedas afinarla, y nombra cada incidencia por su clave y su
  resumen. La tarjeta de abajo ofrece **«Abrir la búsqueda en Jira»**: te
  lleva al buscador con esa consulta y la lista entera. La consulta no se lee
  de lo que el modelo escribe, sino de la llamada real que hizo a
  `jira_search` (la última que devolvió resultados): un modelo que escribe
  una JQL en su respuesta y busca con otra no puede mandarte a una lista que
  no ha visto.

  Y **dentro de esa tarjeta viene la lista**: las incidencias de verdad, con su
  clave, su resumen, en qué estado están y de quién son. No las escribe el
  modelo ni te las cuenta de memoria: Faro ejecuta esa misma consulta contra la
  API de tu propio Jira con tu sesión del navegador, así que son de este
  momento, tardan milisegundos y no cuestan ni un token. Una línea encima dice
  cuántas se enseñan de cuántas hay. Al pulsar una fila, Faro te lleva a esa
  incidencia —por el mismo camino que cualquier destino: la clave entra en el
  índice del sitio y se comprueba antes de abrir nada, no se pega una URL a
  mano—, y la lista se queda viva para que sigas con la siguiente.

  Si la API no contesta —Jira Cloud, sesión caducada, falta el permiso sobre el
  dominio, o Jira rechaza la consulta—, **la tarjeta se queda entera** y debajo
  sale un aviso con el motivo y «La tarjeta te lleva igual»: nunca te quedas sin
  el botón que te lleva a la búsqueda. Todo esto se apaga desde **Ajustes →
  Consultar tu sitio**.

  Si no buscó nada y nombra una sola incidencia, la tarjeta abre
  esa incidencia: el proyecto no es un paso intermedio, sería otra carga de
  página. Y la incidencia que ya tienes abierta nunca es el destino.

  El modo **Análisis** hace además una cosa más: numera sus observaciones y
  subraya en la página el pasaje del que habla cada una, con su número detrás.
  En el chat aparece la lista; al pulsar una fila, la página salta a su marca y
  la destaca. Al revés también: pulsar el número en la página marca su fila en
  el chat. Y dentro del propio texto de la respuesta, cada `[2]` es pulsable.
  Cada fila dice además **de qué clase** es la observación —dato, supuesto,
  hueco, contradicción, riesgo—, que es lo que el modelo ya declaraba y antes se
  tiraba. Y bajo la lista, **«Copiar observaciones»** pone en el portapapeles la
  respuesta numerada **tal como se ve**, con sus `[1]`, `[2]`…: está pensada para
  pegarla en un comentario de la incidencia o de la página, donde los números
  tienen que seguir casando con las marcas. Sólo la tarjeta del análisis vivo lo
  ofrece; la tarjeta atenuada de un análisis anterior no guarda su texto.

  Cómo lo hace: antes de mandar la pregunta, Faro lee la página abierta y se
  la enseña al modelo troceada en bloques numerados («¶7 [p] …»), tal como se
  ve en pantalla; debajo de la pregunta queda dicho que iba. El modelo cierra
  su respuesta con un bloque JSON —que el chat retira, no es para leerlo— con
  el bloque del que habla cada número y, si puede, una cita literal. Con eso,
  un script de la extensión decide qué subrayar: la cita si está tal cual, el
  bloque entero si no. Todo en el mismo turno. Si un modelo numera pero se
  olvida del bloque JSON, se le pide aparte en una segunda pasada.

  **En Jira** el modo Análisis trabaja sobre la incidencia abierta. Lo que se
  trocea en bloques es lo que tienes en pantalla, y sólo eso: el título, los
  campos de la pestaña visible («Tipo: Tarea», «Prioridad: Crítica»), la
  descripción, los enlaces a otras incidencias, cada comentario con su autor y
  su fecha, y el panel de personas y fechas. La interfaz no entra —ni la barra
  de acciones, ni las pestañas, ni el editor de comentarios, ni los paneles de
  Git o Structure—, así que el modelo no habla de botones. Lo que analiza es lo
  que se le pide a un ticket: qué pide exactamente y para quién, si los
  criterios de aceptación existen y son comprobables, qué falta (entorno,
  versiones, pasos, dependencias), y si la descripción, los comentarios y los
  campos se contradicen entre sí o con la documentación del Confluence
  enlazado. Y subraya igual: un párrafo de la descripción, un comentario
  entero, un campo.

  Y **sabe qué ticket es**. Antes de mandar la pregunta lee de los campos en
  pantalla el tipo, el estado, la prioridad, la resolución, las personas, la
  épica, el sprint, las versiones, los componentes y las etiquetas (en el
  registro: «Página leída en bloques · … · tipo Tarea · estado En curso»), y
  se los enseña al modelo con lo que hay que comprobar según lo que sea: una
  definición de API, por si está el contrato, qué cambia, si rompe
  compatibilidad y si sigue la guía de API del sitio; un error, por si se
  puede reproducir; una historia, por sus criterios y su alcance; una épica,
  por lo que la compone; un test, por lo que prueba y su evidencia; una
  tarea, por su resultado comprobable. Y según el estado: por empezar, si
  está lista para cogerla; en marcha, qué falta por decidir y qué cambian los
  comentarios; en revisión o en pruebas, si lo entregado cubre lo pedido y
  cada criterio; cerrada, si se cumplió con evidencia y qué quedó sin
  resolver; bloqueada, qué la bloquea. Los nombres se reconocen en español y
  en inglés; lo que no se reconoce no se inventa: se le pide al modelo que lo
  deduzca, y lo que ese tipo y ese estado significan en tu proyecto se lo
  remite al contexto que Faro construyó (que en Jira recoge tipos, estados y
  convenciones). Si tu Jira pinta los campos de otra forma y no se leen, el
  análisis funciona igual: se le pide que los mire él con la herramienta.

  Las **páginas base** desde Jira son páginas del Confluence enlazado: se
  eligen de su índice, buscándolas por título en su API, o pegando su URL o
  su id. Desde un Jira Data Center la API de ese Confluence está en otro
  dominio, así que la búsqueda la hace el propio panel con tu sesión, y hace
  falta darle permiso sobre ese dominio una vez: la pantalla lo pide con un
  botón **Dar permiso**. Sin él sólo se busca en el índice. En el alcance
  *Sólo estas*, leer la propia incidencia por el MCP (sus comentarios
  plegados, su historial) no cuenta como salirse.

  La elección se recuerda por sitio; el modelo no, que es tuyo para todos los
  sitios (más abajo, «Elegir modelo»).

- **Páginas base del análisis** — el icono de las dos hojas, que sólo aparece
  con la Skill Análisis. Abre una pantalla para decir **en base a qué páginas**
  de Confluence se analiza la abierta: una guía, una decisión anterior, la
  página con la que hay que comparar. Se añaden de tres formas en el mismo
  campo: pegando la URL de la página (tiene que ser de este mismo sitio y
  llevar el id; las de tipo `/display/ESPACIO/Título` no lo llevan), pegando
  su id numérico, o escribiendo parte del título: las sugerencias salen al
  instante del índice del sitio y, un cuarto de segundo después, de la API del
  propio Confluence con tu sesión (para eso hace falta el permiso del dominio,
  como para señalar; la pantalla lo pide si falta). Flechas, Intro y Esc valen
  para elegir. Como mucho seis páginas.

  Debajo, el **alcance**: *Sólo estas* —la página abierta y las páginas base,
  y nada más: el modelo no busca ni lee ninguna otra— o *Estas como mínimo*,
  que las lee siempre y además consulta las que él decida, diciendo cuáles.
  Se recuerdan por sitio, y mientras la Skill sea Análisis se ven en un chip
  sobre el cuadro de texto y en la nota bajo cada pregunta («con 2 páginas
  base (sólo estas)»).

  Sobre esa lista, **Sugeridas**: hasta cinco páginas que Faro propone con el
  motivo a la vista. No le pregunta al modelo ni gasta un token, y **no añade
  ninguna sola**: hay que pulsarla. Cada motivo necesita algo distinto, y por
  eso al principio pueden salir pocas o ninguna:

  - «enlazada desde la descripción / desde los enlaces de la incidencia / desde
    un comentario / enlazada en Jira a esta incidencia» — Faro lee los enlaces
    que la página o la incidencia tiene **en su contenido** (los de la barra de
    acciones y los menús no cuentan) y, en una incidencia de Jira Data Center,
    sus enlaces remotos por la API con tu sesión. Un enlace `/display/…` sin id
    sólo se reconoce si esa página está en el índice del sitio o si el enlace
    remoto trae su id: el título nunca se manda a ninguna API. En una incidencia,
    los enlaces que Jira pone en todas —a otra incidencia, a su propia API, los
    «Borrar este enlace» del módulo de enlaces— no cuentan y no gastan el tope
    de sesenta: eran 55 de los 60 en una épica real, y por eso los enlaces de
    los **comentarios** no llegaban a leerse.
  - «el contexto la nombra como guía / como decisión…» — sale del CONTEXT.md
    del sitio, y sólo de las páginas que ahí aparecen **con su id numérico**.
    Los contextos generados antes de que Faro empezara a pedir ese id casi
    nunca lo llevan: vuelve a generar el contexto desde Ajustes y este motivo
    empieza a aparecer.
  - «la usaste en N análisis de …» — sale de tu propio historial: cada vez que
    terminas un análisis **con páginas base**, Faro apunta en tu navegador qué
    páginas usaste y para qué ticket (su clave, su tipo, su proyecto, sus
    componentes y las palabras de su título). Lo primero que analices no tiene
    historial que mirar; a partir del tercero o cuarto empieza a acertar. En
    Confluence sólo puntúa «la usaste en esta página», porque sin campos de
    incidencia no hay tipo ni etiquetas que comparar.

  Escribir dos letras en el campo esconde las sugeridas y enseña la búsqueda;
  vaciarlo las devuelve. «Añadir las N» las añade todas de golpe (respetando el
  tope de seis) y **«Olvidar el historial»** borra lo apuntado de este sitio:
  las sugerencias que vinieran de ahí desaparecen y las demás se quedan.

  Las páginas base las lee el modelo por el MCP, enteras, antes de responder:
  cada una es una consulta, y sin el MCP conectado no puede leerlas (la
  pantalla y la respuesta lo dicen). Sólo se subraya la página abierta: una
  observación que hable de una página base sale en la lista sin marca.

- **Señalar en la página** — el icono del rotulador. Al pulsarlo el cursor
  cambia y puedes subrayar un párrafo o pulsar una imagen; aparece una barra
  abajo con «Usar esto». Lo que elijas queda en un recuadro encima del cuadro de
  texto y acompaña a la **siguiente** pregunta, sólo a ésa.

  De un texto se guarda la cita, lo que hay justo antes y después, y el
  encabezado bajo el que está. De una imagen, su descripción **y la imagen
  misma**, incrustada en el mensaje. Necesita permiso sobre el dominio, igual
  que la navegación paso a paso. Lo señalado viaja citado línea a línea (como
  una cita de Markdown, con `> ` delante) y delimitado: un trozo de página que
  imite el cierre del bloque no puede hablar como Faro.

- **Lo que el modelo consultó** — mientras responde se ven las consultas que va
  haciendo a Atlassian, una por línea. Al terminar se **pliegan** en una sola
  («3 consultas a Atlassian») que se puede desplegar: dentro están las mismas
  filas, y las que fallaron se distinguen. Antes se tiraban al acabar, y con
  ellas la única forma de ver qué había leído el modelo de verdad, que es lo
  primero que se mira cuando la respuesta no cuadra. Siempre empieza plegada, y
  al reabrir el panel no se recrea: la conversación restaurada no las tiene.

- **Preguntar sobre estos** — bajo la lista de una búsqueda, al lado de «Abrir
  la búsqueda en Jira», hay un botón más. Pulsarlo **no manda nada**: te deja
  escrita en el cuadro la pregunta «¿Qué tienen en común estas incidencias?»
  —cámbiala o bórrala, enviar lo haces tú— y apunta esas filas para que viajen
  con la siguiente pregunta. Así el modelo no tiene que volver a buscar lo que
  ya tienes delante. Cuando envías, bajo tu pregunta se dice lo que fue: «con
  los 10 resultados de una búsqueda previa (project = ENG AND …)». De cada
  incidencia van la clave, el estado, el tipo y el resumen, como mucho veinte, y
  **nunca de quién es**. Si te vas a otra página o a otro sitio entre el clic y
  el envío, se descarta y la nota no aparece: vuelve a pulsar el botón, que la
  tarjeta sigue ahí con los mismos resultados. Y no sobrevive a cerrar el panel:
  son los resultados de ese momento. Tampoco viajan en un **Análisis con alcance
  exclusivo** —ahí el modelo sólo puede mirar la incidencia abierta y las páginas
  base, y una lista de otras incidencias sería lo contrario—: en ese caso sale
  un aviso en el chat que lo dice. Y como la pregunta es sobre una lista que ya
  tienes, si el modelo no vuelve a buscar no aparece ninguna tarjeta de
  «Abrir la búsqueda en Jira» debajo de la respuesta: la de antes sigue arriba.

- **Búsquedas al instante** — en un **Jira propio (Data Center)**, con el chat
  vacío, bajo las tres sugerencias hay hasta cuatro pastillas: «Misma épica
  ENG-1», «Mismo sprint «S37 Infra»», «Mis abiertas de ENG», «Filtro: API en
  revisión», «Última: …». Las tres sugerencias son preguntas **para el modelo**;
  estas pastillas no pasan por él: Faro ejecuta la consulta él mismo contra tu
  Jira y te devuelve la lista, con la misma tarjeta de una búsqueda. Bajo la
  pregunta lo dice: «búsqueda directa, sin modelo». El tooltip de cada pastilla
  es la consulta entera, para que puedas leerla antes de pulsar.

  De dónde salen: de los campos de la incidencia que tienes delante —la épica se
  busca por su clave, no por su nombre, que es lo único con lo que Jira la
  encuentra—, de los **filtros que tú tienes marcados como favoritos** en tu
  Jira, y de las **últimas búsquedas que se ejecutaron** en ese sitio (se
  guardan cinco, y sólo las que de verdad devolvieron lista). Ninguna se inventa
  y ninguna sale de lo que escribas: son plantillas fijas con los valores
  entrecomillados, o consultas tuyas. Si un filtro tuyo usa una función que no es
  de Jira (ScriptRunner y compañía), la pastilla aparece igual pero **te abre
  Jira** en vez de intentar ejecutarla y enseñarte un error.

  En Confluence y en Jira Cloud no hay pastillas. Y una búsqueda directa **no
  queda en la conversación**: no ha hablado nadie con opencode, así que al
  reabrir el panel no está.

- **Ajustes → Consultar tu sitio** — una sola casilla que enciende o apaga
  **todo** lo que Faro lee de la API de tu Jira o tu Confluence con tu sesión:
  la lista dentro de la tarjeta de una búsqueda, las búsquedas al instante y el
  árbol del espacio —o la muestra del proyecto— al levantar el mapa.
  Viene encendida. Sólo son lecturas (`GET`), siempre al mismo sitio en el que
  estás, y nunca salen de él. Apagarla no rompe nada: la tarjeta sigue
  llevándote a la búsqueda, las sugerencias del chat vacío siguen ahí y el mapa
  se levanta con los turnos del modelo, como siempre. No apaga
  la lectura del camino por el árbol ni la búsqueda de páginas base, que
  funcionan desde antes. Se aplica al momento, sin rearrancar el panel.

- **Ajustes → Sugerirme qué mirar hoy** — enciende o apaga la lista de «Qué
  mirar hoy» y, con ella, el diario local que la alimenta: apagada, no sale ni
  una consulta y no se apunta nada. Viene encendida, y **depende de la de
  arriba**: con *Consultar tu sitio* apagado ésta se queda desactivada y lo
  dice. Para apagarla sólo en un sitio, la casilla **«No sugerir nada en este
  sitio»** vive en su propia pantalla, y apaga las consultas y las
  recomendaciones de ese sitio (no el diario, que lo apaga ésta). Se aplica al momento.

- **Ajustes → Qué guarda Faro de mí** — la lista de todo lo que Faro tiene
  apuntado de este sitio, una línea por cosa y con su medida, y debajo el botón
  que se lo lleva todo. Está entero en el apartado 8 de esta guía.

- **Elegir modelo** — el desplegable de abajo, junto a la Skill. Lista los
  modelos que **tu** opencode tiene conectados (`GET /config/providers`: los
  proveedores que conectaste con `opencode auth login`), agrupados por
  proveedor. Lo que elijas **es tuyo y no del sitio**: vale para todos tus Jira
  y Confluence, así que el segundo sitio ya no vuelve a preguntar ni arranca
  con otro. Si traes una versión anterior de Faro, que guardaba un modelo por
  sitio, el primer sitio que abras copia el suyo como tuyo **una sola vez** (y
  sólo si todavía no tenías uno); los demás modelos por sitio ya no se usan, y
  para cambiar basta el desplegable. Faro no elige un modelo por ti como si lo
  hubieras elegido tú: en un sitio que ya está en marcha y sin ningún modelo
  guardado, **preselecciona** el último que contestó bien o un predeterminado
  de tus proveedores que no haya fallado, sin guardarlo como tuyo; y en el
  **primer uso** te lo pregunta en su pantalla, abajo.

  **La pantalla «Elige el modelo».** Sale sola **la primera vez** en un sitio
  —antes de las claves y del contexto: el orden es conexión → modelo → claves →
  contexto—, si no tienes modelo guardado o el tuyo ya no vale; **desde
  Ajustes**, con «Cambiar el modelo» (en su sección «Modelo», que también dice
  cuál es el tuyo); **desde un error**, con el botón «Elegir otro modelo» que
  lleva todo aviso de un turno que falla, y también cuando fallan por el modelo
  la comprobación de las claves o el indexado; y en un sitio ya en marcha,
  cuando tu modelo tiene un fallo reciente o ha desaparecido de la lista (si en
  ese momento la pantalla taparía algo —estás escribiendo, llega una
  respuesta— sale un aviso en el chat con «Elegir otro modelo»). Enseña todos
  los modelos que tu opencode tiene conectados, **agrupados por proveedor**,
  con «predeterminado de opencode» junto al predeterminado de cada proveedor,
  «el de tu configuración» junto al `model` de tu `opencode.json`, y lo que
  Faro sabe de cada uno en palabras: «funciona · hace 2 h», «no disponible con
  tu plan: …», «no contesta», «credenciales caducadas: opencode auth login»,
  «falló hace 10 min: …». Los que tienen un fallo reciente —y los que opencode
  va a retirar o no tienen herramientas— van plegados bajo **«No disponibles
  (N)»**, pero se pueden elegir igual: es información, no un candado. Cuando
  la pantalla sale por un fallo, el modelo que acaba de fallar se ve ahí, con
  su motivo, pero **no sale marcado**: la marca va al que Faro recomienda (el
  último que contestó bien, el de tu configuración o un predeterminado que no
  haya fallado), para que «Usar este modelo» no repita el fallo. Arriba
  hay un **filtro** que busca por nombre, id o proveedor.

  **«Usar este modelo» es gratis**: lo guarda como tuyo y sigue —la primera vez
  arranca de nuevo el panel con él, tras un error deja la pregunta que falló
  escrita en el cuadro **sin mandarla**, tras la comprobación de las claves
  repite sólo esa comprobación, y tras el indexado lo repite—. **«Comprobar»
  cuesta un turno**: manda al modelo marcado una pregunta de dos palabras
  («Responde sólo: ok») en una sesión aparte que se borra al acabar, con el
  nivel de razonamiento más bajo que el modelo tenga y un plazo de 15 s; con un
  proveedor de pago **eso es una petición**, y por eso Faro no lo hace nunca
  por su cuenta (tampoco al elegir: la comprobación de las claves ya es un
  turno de verdad con ese modelo). Lo que diga se apunta como cualquier otro
  resultado, así que un «contesta» borra el «no disponible» de antes: es la
  salida si tu modelo tiene un fallo apuntado que ya no es verdad (la otra,
  «Olvidar los veredictos» en Ajustes). Si opencode **no tiene ningún
  proveedor conectado**, la pantalla lo dice: ejecuta `opencode auth login`,
  reinicia opencode y pulsa «Reintentar».

  **`Esc` sólo cierra esta pantalla cuando se abrió desde Ajustes o desde un
  error** (la flecha de arriba a la izquierda está a la vista): la primera vez,
  tras la comprobación de las claves y tras el indexado no hay con qué seguir
  sin elegir, la flecha no está y `Esc` no hace nada.

  **Cuando un modelo falla**, Faro se lo apunta, gratis y sin preguntar nada
  más, con el motivo: *no disponible con tu plan* (el proveedor lo rechaza:
  «not supported», «not available», «free tier»…), *credenciales* (la sesión
  con el proveedor caducó: `opencode auth login`), *no contesta* (se quedó
  colgado), *transitorio* (un 429 o un 5xx) u *otro*. Lo apuntado caduca solo
  según el motivo —7 días lo del plan, una hora lo de las credenciales, un día
  el que no contesta, un cuarto de hora lo transitorio— y mientras vale ese
  modelo sale en el desplegable como «· no disponible» y **no se vuelve a
  proponer** en ninguna elección automática. El rechazo enseña a veces más de
  lo que falló: el de GitHub Copilot trae la lista de los modelos que tu plan sí
  permite, y los que faltan en ella quedan apuntados a la vez; el 403 «free tier
  can only be used from within OpenCode» vale para todos los modelos
  `opencode/*` de golpe. Lo que contesta bien también se apunta, y **«Reintentar
  con X»**, bajo un error, sólo aparece si X ya ha contestado alguna vez en los
  últimos 7 días: ya no salta a ciegas entre dos modelos que tu plan rechaza.
  Nada de esto viaja a la página ni entra en ninguna pregunta.

  **En el primer uso** (la comprobación de las claves) un modelo que no contesta
  **no se cuenta como un fallo de tus claves**: el sitio se queda sin
  configurar y vuelves a «Elige el modelo» con el que falló a la vista (no
  marcado) y el motivo arriba («… No se ha llegado a comprobar ningún token: elige otro y se
  repetirá la comprobación.»). Al elegir se repite sólo la comprobación, sin
  volver a escribir nada en opencode. Si en ese momento la pantalla taparía
  algo, en su lugar sale en el chat el aviso con «Volver a comprobar», que hace
  lo mismo con el modelo del desplegable. Y **un indexado que falla por el
  modelo no da el sitio por hecho**: el aviso sale después de repintar el chat
  —antes se perdía— con un botón «Generar el contexto otra vez», se abre la
  pantalla del modelo (o, si taparía algo, un aviso con «Elegir otro modelo») y
  al elegir se vuelve a generar el contexto; la pantalla de contexto vuelve a
  ofrecerse en el siguiente arranque.

- **Teclado y lector de pantalla** — `Esc` cierra Ajustes, Memoria, Registro,
  Páginas base (donde primero vacía las sugerencias), Qué mirar hoy y «Elige el
  modelo» (ésta sólo si su flecha está a la vista) y cancela el
  velo «Trabajando…»; con una pantalla abierta el resto del panel queda inerte
  y el foco va a su título, y al cerrarla vuelve a donde estaba. Mientras llega
  una respuesta el chat lleva `aria-busy`; lo que se anuncia al lector de
  pantalla es un resumen al final («Respuesta lista · N observaciones») y los
  avisos, no cada trozo de texto. El chat sólo se desplaza solo al fondo si ya
  estabas pegado a él: si subiste a leer, se queda donde estás.

## 7. Qué mirar hoy

El **quinto botón de la cabecera** (el de la lista, entre «Nueva sesión» y
«Memoria») abre **Qué mirar hoy**: hasta ocho filas con la incidencia o la
página que te importa ahora mismo, agrupadas en tres bloques —*Cambió desde que
lo miraste*, *Lo tuyo* y *Nuevo en \<tu proyecto o espacio\>*—. Si hay algo nuevo
desde la última vez que abriste la lista, el botón se enciende y lo dice también
por escrito, en el tooltip y en el nombre que lee un lector de pantalla («Qué
mirar hoy: 3 novedades»). En el **chat vacío** salen las tres primeras, y si esa
zona se queda sin sitio —porque hay pastillas de búsqueda además de las
sugerencias— se encoge sola a una línea, «Qué mirar hoy (8)», que abre la
pantalla.

**Nada de esto pasa por el modelo, y no cuesta un token.** La lista sale de
preguntarle a tu propio Jira y a tu propio Confluence, con la sesión que ya
tienes abierta en el navegador, siete cosas que sus API contestan exactas: lo
que has visto últimamente, lo que es tuyo o sigues, lo que se ha movido en el
proyecto, lo que enlaza la incidencia abierta, y en Confluence lo que viste, lo
que escribiste y las páginas concretas que ya conoce tu diario. Eso se cruza con
el **diario local** (abajo) y se ordena. **Cada fila dice por qué está ahí**, en
español: «cambió ayer · es tuya o la sigues · Task», «la analizaste hace 2 días
con 6 observaciones», «la sueles mirar (4 veces)», «página base de tus
análisis». Lo leído vale un cuarto de hora; **Actualizar** lo vuelve a pedir.

Cada fila tiene tres cosas que hacer:

- **Abrir** — te lleva ahí. Si es del sitio de la pestaña, por el mismo camino
  validado que cualquier otro destino de Faro (entra en el índice y se comprueba
  antes de abrir nada); si es una página del Confluence enlazado a tu Jira, se
  abre en una pestaña nueva.
- **Analizar** — te lleva, pone la Skill en *Análisis* y **deja la pregunta
  escrita en el cuadro, sin mandarla**. Enviarla es tuyo, siempre. Si tardas más
  de dos minutos o acabas en otra página, la pregunta se descarta sola en vez de
  aparecer donde no viene a cuento.
- **Ya lo he visto** — quita la fila. No es «para siempre»: **vuelve sola en
  cuanto esa página o esa incidencia cambie**, porque lo que se recuerda es
  cuándo la quitaste, así que cualquier cambio posterior la devuelve. Eso también
  caduca a los treinta días, y cuando cae el último el diario de ese sitio se
  borra solo.

Abajo del todo de la pantalla: **«No sugerir nada en este sitio»** (una casilla,
por sitio), **Actualizar**, **Borrar mi actividad** y una línea que dice qué se
guarda y dónde, con los números.

Esa casilla apaga **las consultas y las recomendaciones de ese sitio** —ahí y
también cuando las pide el Jira que lo tenga enlazado—, pero **no** el diario:
Faro sigue apuntando lo que abres allí. Para que no apunte nada, la casilla que
manda es **Ajustes → Sugerirme qué mirar hoy** (o la de arriba, *Consultar tu
sitio*). Lo dice la propia pantalla, debajo de la casilla.

### Qué guarda tu diario, y dónde

Para poder decirte qué ha cambiado *desde que lo miraste*, Faro apunta en el
almacenamiento de tu navegador —**local, por sitio, nunca en ningún servidor**—
la clave de la incidencia o el id de la página, su **título**, su **ruta
relativa** dentro del sitio, cuándo la viste y cuántas veces, cuándo la
analizaste y con cuántas observaciones, si la usaste como página base y de qué
**tipo** era la incidencia. **No** guarda la URL completa, ni nada de lo que
venga detrás de un «?» o de un «#», ni el texto de ninguna página, ni una
palabra de lo que escribes. De lo que quitas con «Ya lo he visto» apunta sólo **cuándo lo
quitaste**, para poder devolvértelo si vuelve a cambiar. Trescientas entradas por
sitio y **treinta días** —los «ya lo he visto» también, y cuando cae el último el
diario de ese sitio se borra solo—; lo más viejo se cae solo. Sólo se apunta de los sitios que has configurado, y
sólo con las dos casillas encendidas.

**Nada de eso llega nunca al modelo**: no entra en ningún prompt. Se ve entero,
con sus números, en **Ajustes → Qué guarda Faro de mí**; se borra con **Borrar mi
actividad**, y **Ajustes → Olvidar este sitio** se lo lleva junto con el resto.

### Cuándo no sale nada

- **Ajustes → *Sugerirme qué mirar hoy* apagado**, o **Ajustes → *Consultar tu
  sitio* apagado**: con el segundo apagado se apaga también el primero (y la
  casilla lo dice), y entonces no sale ni una consulta ni se apunta nada.
- **Jira Cloud**: Atlassian retiró esa API, así que allí no hay lista de Jira.
- **Desde una pestaña de Confluence** todavía no se consulta el Jira enlazado.
- **Sin permiso sobre el dominio** del Confluence enlazado: la pantalla ofrece
  un botón para dártelo. No se pide solo.
- **Sesión caducada o consulta rechazada**: sale un aviso con el motivo y la
  lista se queda con lo que sí se pudo leer. El resto del panel sigue igual.

## 8. Qué guarda Faro de mí

**Ajustes → Qué guarda Faro de mí** es la lista entera, para este sitio, de lo
que Faro tiene apuntado en tu navegador. Una línea por cosa, con su cuenta o su
medida y **sin nada de su contenido** —ni un título de página, ni una clave de
incidencia, ni una línea del contexto—:

- **índice de navegación** — «412 páginas en 2 espacios · 37 incidencias»: el
  mapa que permite llevarte, con rutas del propio sitio, y de cuántos espacios
  son sus páginas. En Jira dice sólo «N incidencias».
- **contexto del sitio** — «3 ámbitos con contexto (SIMPL, DCPIAS, todo el
  sitio)»: los resúmenes que el indexador escribió (o los que subiste tú), uno
  por espacio o proyecto. Se dice DE QUÉ son —las claves de los espacios o
  proyectos, reconstruidas y nunca copiadas, como mucho cuatro y «y N más»—,
  por lo mismo que se dice el proyecto del perfil; su texto no sale nunca.
- **memoria entre sesiones** — «3 resúmenes». Si la casilla de la pantalla de
  Memoria está apagada pero hay resúmenes de antes, lo dice así: «3 resúmenes ·
  desactivada» —apagarla no los borra: deja de usarlos y de añadir—. Se borran
  uno a uno en esa pantalla, o todos con «Olvidar este sitio».
- **perfiles de proyectos** — «2 proyectos con perfil (SIMPL, OPS) · el de
  SIMPL: muestra de 30 · contado hace 2 días»: los nombres que Faro contó de tu
  Jira (tipos, estados, componentes, etiquetas), uno por proyecto desde H22. Se
  dice de qué proyectos son —sus claves, reconstruidas y nunca copiadas, como
  mucho cuatro y «y N más»— y, del que tienes delante, de cuántas incidencias
  era su muestra y cuándo se contó; nunca un nombre de estado ni de tipo.
- **historial de páginas base** — «6 análisis»: con qué páginas analizaste qué,
  que es lo que permite proponerlas otra vez.
- **diario de actividad** — «48 entradas · 2 descartes», y «· apagado» detrás si
  la función está apagada: apagarla deja de apuntar, pero lo apuntado sigue ahí
  hasta que lo borres o caduque a los 30 días.
- **últimas búsquedas** — «5 consultas»: las JQL que de verdad se ejecutaron
  aquí, para ofrecerlas como pastilla.
- **páginas base elegidas** — «2 páginas»: las que tienes puestas ahora mismo
  para el análisis.
- **modelo elegido** — «github-copilot/gpt-5.6-luna» o «(ninguno)»: el modelo
  que elegiste. Es **tuyo, no de este sitio** (vale para todos), y por eso se
  enseña su nombre: es el que opencode le da, no nada de tu sitio.
- **veredictos de modelos** — «4 veredictos · todos los sitios»: cuántos modelos
  tiene Faro apuntados como que contestan o que fallan, con su caducidad. Sólo
  la cuenta: ni cuáles ni con qué mensaje. También es tuyo y no del sitio.
- **espacio usado** — «1,4 MB de 10 MB»: lo que Faro ocupa en el navegador. Esta
  cuenta es de **todos** los sitios, no sólo de este.

Debajo, si tienes más sitios configurados, una línea los nombra. No hay botones
para ellos a propósito: cada sitio se borra desde sí mismo, que es donde ves qué
vas a perder.

**Lo que NO está ahí**: las claves de Jira y de Confluence —ésas sólo están en
la configuración de opencode, en tu máquina, y se quitan de allí con **Quitar
las claves de este sitio** (§3)—, el texto de las páginas que Faro
lee y tus preguntas y respuestas, que viven en la sesión de opencode y se
cierran con «Sesión nueva».

Y al final, **Olvidar este sitio**: borra de golpe todo lo de la lista y deja
ese sitio como si Faro no lo hubiera visto nunca —con los contextos y los
mapas de TODOS sus espacios—. No se puede deshacer, y la
próxima vez volverá a preguntarte por el contexto. Para olvidar el mapa y el
contexto de UN espacio y dejar los demás, **Mapas y contextos de este sitio →
Olvidar el mapa**, justo encima (§4, «Varios espacios»). Para borrar sólo el diario,
**Qué mirar hoy → Borrar mi actividad**; para sólo el historial de páginas base,
**Olvidar el historial**, en la pantalla de páginas base.

«Olvidar este sitio» **no toca la configuración de opencode**: tus claves de
Atlassian viven allí y no en el navegador, así que el MCP sigue conectado y la
próxima vez el sitio lo vuelve a adoptar. Para quitarlas de ahí está **Quitar
las claves de este sitio**, más arriba en la misma pantalla (§3, «Quitar las
claves de este sitio»).

«Olvidar este sitio» **no toca el modelo elegido ni los veredictos de
modelos**, que no son de ningún sitio. Para los veredictos está al lado
**Olvidar los veredictos**: los borra todos —vuelven a apuntarse con el
siguiente turno que falle o conteste— y deja tu modelo como está. Cambiar la
dirección del servidor de opencode en Ajustes también los deja de lado, porque
lo apuntado es de aquel opencode.

La lista se lee del almacenamiento de verdad, no de lo que el panel tenga en
memoria, así que sirve para comprobarlo: después de olvidar un sitio, vuelve a
abrirla y todo lo suyo dice «(nada)» (el espacio usado sigue con su número,
porque ése cuenta el navegador entero).

### Qué se conserva al reabrir el panel

**Mientras no cierres Chrome**, al volver a ese Jira o a ese Confluence:

- **la conversación** se repinta con lo que hay en opencode: los últimos 60
  mensajes, y si había más, **«Ver toda la conversación»** arriba trae el resto;
- **las observaciones del último análisis** vuelven como tarjeta: viva si sus
  marcas siguen en la página, y si no, atenuada con **«Volver a marcar»** (que
  comprueba antes que sigues en la misma página; Faro nunca re-marca solo).

**Aunque cierres el navegador** se conserva todo lo de la lista de arriba: el
índice, el contexto, la memoria entre sesiones, el perfil del proyecto, el
historial de páginas base, el diario de actividad, las páginas base elegidas con
su alcance, las últimas búsquedas y la Skill de ese sitio; y, de todos los
sitios, tu modelo elegido y los veredictos de modelos.

**No se conserva**, y es a propósito:

- **la sesión de chat, al cerrar Chrome**: el id de la conversación vive en el
  almacén de sesión del navegador, así que se olvida y la próxima vez Faro abre
  una nueva. La conversación sigue existiendo dentro de opencode; lo que se
  pierde es saber cuál era;
- **una búsqueda directa** (una pastilla del chat vacío): no habló nadie con
  opencode, así que no está en la conversación que se restaura;
- **la lista de resultados dentro de la tarjeta de una búsqueda**: la tarjeta
  vuelve, la lista no —se lee de tu sitio en el momento, y una de hace dos días
  no diría la verdad—, y con ella lo que hubieras precargado con «Preguntar
  sobre estos»;
- **los números de las observaciones cuando los puso la pasada de rescate** (la
  que trocea la respuesta si el modelo no numeró): lo que opencode guarda es la
  respuesta original, sin esos `[n]`;
- **lo que hubieras señalado con el rotulador**: acompaña a la siguiente
  pregunta y ahí se acaba;
- **la lista de «qué mirar hoy»**, que vale un cuarto de hora y muere al cerrar
  el navegador (el diario que la alimenta, no: ése dura treinta días).

## 9. Guiada o rápida

**Ajustes → Cómo te lleva Faro** decide qué hace la tarjeta «Puedo llevarte»:

- **Guiada** (por defecto): intenta siempre enseñarte el camino. Lee de quién
  cuelga la página en la API REST del propio Confluence —una petición `GET` con
  tu sesión, milisegundos— y destaca «Paso a paso», con «Llévame» al lado. Si
  no hay camino, sólo queda «Llévame».
- **Rápida**: te lleva directamente, siempre. No se lee el árbol ni se espera
  a nada: la tarjeta sólo tiene «Llévame».

En el modo **Búsqueda**, además, el modelo termina cada respuesta con una línea
`Destino: título (id N)` —o `Destino: ninguno`— y Faro la lee tal cual: el
destino sale de ahí, sin gastar un turno en preguntárselo. Si un modelo se
salta esa línea pero nombra una sola página del índice, vale igual. La tarjeta
aparece nada más terminar la respuesta.

## 10. Herramientas de desarrollo

### Cómo ver el último turno real

Cuando el panel dice algo raro («Sin marcas», una tarjeta que no aparece, un
análisis por apartados), lo que hay que mirar es qué contestó el modelo de
verdad y con qué instrucciones se le preguntó, no lo que el panel pintó
después. opencode guarda cada turno entero —sistema incluido— en su base de
datos, y Faro trae un comando para leerlo:

```
npm run turn                     # el último turno de la última sesión del panel
npm run turn -- --n 3            # los tres últimos turnos
npm run turn -- --host jira      # la última sesión cuyo host contiene «jira» (por el título o por la «URL abierta» del sistema)
npm run turn -- --all            # también las sesiones internas de Faro (planificador, observaciones, comprobación, índice de …)
npm run turn -- --db copia.db    # otra base de datos (una copia que hayas guardado)
```

Qué enseña, por turno: la pregunta tal como la mandó el panel (sin el fragmento
señalado, si lo había; se avisa de los adjuntos); el sistema con su longitud en
caracteres y líneas y sus primeras y últimas seis líneas (ahí se ve, por
ejemplo, si iba el RECUERDA EL FORMATO del Análisis); y cada mensaje del
asistente —opencode parte un turno en varios, uno por vuelta de herramientas—
con el modelo, la duración, los tokens, y sus partes: cada herramienta con su
nombre, su `jql`, `page_id`, `issue_key`, `query`, `title` o `space_key`
enteros (en una línea), el nombre de los demás campos y 400
caracteres de lo que devolvió (o su error); el texto entero, con una línea
«— bloque de anclas (N notas) —» delante del JSON de anclas para verlo de un
vistazo; y el razonamiento sólo por longitud. El número de caracteres del
texto es el del texto guardado (la línea «— bloque de anclas» la pone el
comando, no cuenta). Si opencode compactó la sesión (lo hace solo cuando el
contexto se le llena), no aparece como un turno más: bajo el turno tras el que
ocurrió sale «(compactación automática de opencode tras este turno: resumen de
N caracteres)» y la cabecera de la sesión cuenta cuántas hubo. Arriba lista las
ocho sesiones más recientes con la elegida marcada (▶).

Cómo lo hace: copia `opencode.db` (y sus `-wal` y `-shm`, para no leer
atrasado) de `~/.local/share/opencode/` (en Windows,
`%USERPROFILE%\.local\share\opencode\`) a un directorio temporal, abre LA
COPIA en sólo lectura con `node:sqlite` y borra el directorio al acabar,
también si algo falla. La base de datos original nunca se abre ni se toca (se
puede comprobar: su fecha de modificación no cambia). Necesita Node 22.13 o
más reciente (con 22.5-22.12 hay que arrancar
`node --experimental-sqlite tools/last-turn.mjs` o poner esa bandera en
NODE_OPTIONS; el script lo dice si no consigue cargar node:sqlite); todo lo
demás de Faro sigue funcionando con Node 18.

Si no encuentra la base de datos, dice dónde ha mirado: pásale la ruta con
`--db`. Si lo que le pasas con `--db` es un directorio, o un fichero que no es
SQLite o no es de opencode (sin tabla `session`), lo dice en una línea
(««ruta» no es una base de datos de opencode») y sale con 1, sin traza. Si
opencode no está en esta máquina o nunca se ha usado el panel, no hay sesiones
«Faro · …» y lo dice.

### `npm run check` y el paso «docs»

`npm run check` tiene cinco pasos: sintaxis, orden (nada se usa antes de
declararse), manifest, las pruebas unitarias y, sólo si todas pasan, «docs»:
compara los documentos con el código. Si sale en rojo por «README.md: dice N
pruebas unitarias y hay M», actualiza el número en README.md y en CLAUDE.md
§2 (es el `M/M` que imprime el propio `npm run check`); si sale por
«docs/PINES.md §10 (línea L): «x.test.js» dice N pruebas y registra M», pon M en
esa línea de §10 (o «N pruebas más» si esa entrada sólo cuenta las que añadió
un hito a un fichero que ya existía: ésas no se comprueban). Si sale por
«Títulos de registro sin documentar», cada título nuevo que emita
`log.ok/info/warn/error('Título', …)` en `src/` tiene que aparecer entre «»
aquí (en la lista de abajo) o en CLAUDE.md; si sale por «MSG.X: nadie lo
atiende», el `MSG` nuevo necesita receptor (`case MSG.X` en `bootstrap.js` o
en el service worker, `=== MSG.X` en el panel) y su línea en CLAUDE.md §5; «lo
atiende … y nadie lo manda» es sólo aviso (código que espera algo que nadie
envía: cablea quien lo manda o bórralo); y el fichero nuevo de `src/` va en el
mapa de §3. `npm run check:docs` da el informe entero con la línea de cada
título.

Hay un caso a medio camino, y sale como **nota** en vez de aviso: un mensaje
que existe y tiene quien lo atienda, pero cuyo botón todavía no está escrito
porque llega en un paso posterior. Esos van con su nombre y su paso en la lista
`MSG_SIN_EMISOR_HASTA` de `tools/check-docs.mjs`, y entonces el informe dice «lo
atiende bootstrap.js y todavía nadie lo manda (lo cablea H8)». La lista sólo
puede encoger: en cuanto alguien manda ese mensaje —o el mensaje deja de
existir— seguir en ella es un ERROR que pide borrarlo, para que el aviso de
verdad no quede tapado. Hoy están ahí tres de las lecturas por API: las otras
dos (la búsqueda JQL y los filtros favoritos) ya tienen quien las mande.

`npm run snapshots` regenera las instantáneas de los prompts
(`test/fixtures/prompts/*.txt`): `npm run check` las compara byte a byte con
lo que el código produce y, si un prompt cambió, falla con la primera línea
distinta. Se regenera sólo cuando el cambio es intencionado, revisando el
`git diff` de los `.txt` antes de commitear.

### `npm run sandbox`: probar lo que Faro escribe en opencode, sin tocar el tuyo

Faro escribe en la configuración de opencode, y eso sólo se puede probar
escribiendo de verdad. `npm run sandbox` lo hace en un opencode **propio**:
arranca `opencode serve` con toda la carpeta de usuario redirigida a una
carpeta temporal (`%TEMP%\faro-sandbox-<número>`), sin ninguna variable
`OPENCODE_*` heredada y en un puerto entre 4200 y 4299 (nunca el 4096), y antes
de escribir nada le pregunta dónde tiene su configuración: si no está dentro de
esa carpeta temporal, se va con un error sin tocar nada. No basta con
`OPENCODE_CONFIG_DIR`: en opencode 1.2.25 esa variable NO redirige la
configuración global, y una prueba que lo daba por hecho escribió una vez en el
fichero de verdad.

Con un MCP de juguete (`tools/toy-mcp.mjs`) comprueba nueve casos e imprime cada
uno con sus milisegundos: que lo que no pasa la barrera no se manda, que una
entrada nueva conecta en menos de 2 s, que una entrada desactivada deja el
fichero sin el token, que un bloque pegado a mano se carga con «Ya lo he pegado»
sin reiniciar, que con el fichero roto no se escribe nada y el token no llega a
ningún registro, que una ruta con espacios arranca, que opencode no carga
ningún AGENTS.md ni CLAUDE.md, y dos de «Quitar las claves de este sitio» con
las funciones de verdad del panel: que quitar dos entradas que no son de Faro
—una de ellas bajo el nombre que el sitio tiene apuntado, porque «de Faro» es
por su comando— es UNA sola escritura, que las dos quedan deshabilitadas y sin
el token en el fichero y que volver a guardar las claves, con el registro que
deja el panel, reutiliza la entrada y conecta;
y que una entrada deshabilitada a mano no se adopta y guardar las claves la
reutiliza. Sale con 1 si alguno falla. Al acabar, pase lo
que pase, mata opencode y sus hijos y borra la carpeta temporal (`--conservar`
la deja, con los registros de opencode dentro; `--exe <ruta>` usa otro
`opencode.exe`). Sólo Windows, fuera de `npm run check`, y no manda ningún turno
de modelo.

### El banco de pruebas

`npm run harness` levanta en <http://127.0.0.1:5175> una Confluence y un Jira de
mentira con las piezas reales encima. El botón **Autocomprobación completa**
recorre hoy **63 tramos numerados (129 comprobaciones)**; hay que correrla con el panel del navegador a
la vista y a 1280×900, porque con la ventana oculta Chrome estrangula los
temporizadores y no ejecuta los fotogramas.

El último (63) es **un sitio con DOS espacios** (H21): la Confluence de mentira
tiene ahora un segundo espacio, OPS, con su portada y su árbol, y el tramo lee
los dos por la API, los funde en un solo mapa como hace Faro al construir el
del segundo, y comprueba lo que se saca de ahí POR ESPACIO: que el mapa de ENG
es, página a página, el mismo que leído solo; que los títulos que se le darían
al indexador de OPS no llevan ninguna página de ENG; que desde ENG el paso a
paso hasta una página de OPS empieza por abrir el espacio OPS; y que el árbol
de la barra lateral se marca con el espacio de la pestaña. El botón **«Dos
espacios: subíndice, títulos y paso a paso entre espacios»** enseña lo mismo
paso a paso.

Los tramos 60-62 son **la barra lateral de un Confluence Data Center**,
la que estaba rota: en un Confluence 9 el árbol de páginas no tiene ninguna de
las señales que Faro buscaba —no es un `<aside>`, no lleva `role="tree"` y no
tiene un solo `data-testid`—, así que **no lo encontraba**, y en ese Confluence
no había ni «Paso a paso» ni «Árbol leído de la página». El banco trae ahora una
tercera barra lateral con ese marcado, con las hijas llegando por AJAX al abrir
una rama como en el producto de verdad, y los tres tramos comprueban que se
reconoce el contenedor, la fila, el chevron y el scroller; que de ahí se lee
quién cuelga de quién **exactamente igual** que de la barra clásica; y que un
recorrido de dos niveles despliega las dos ramas de en medio y navega una sola
vez. Se cambia de barra con el botón **«Cambiar de barra lateral»**, que ahora
recorre las tres.

Los tramos 56-59 son **«Qué mirar hoy»**, y tampoco navegan: que la
página de mentira lleve su id en una etiqueta `meta` y que de una URL se saque
la ruta **sin la parte de detrás del «?» ni del «#»**; que dos avisos de la
misma navegación cuenten una sola visita y que apuntar un análisis no toque lo
que se apuntó al verla; las siete consultas contra la Jira y la Confluence de
mentira, de las que salen veintidós candidatos y una lista de ocho que es
**exactamente la misma dos veces seguidas**, con sus motivos escritos; que lo
que tienes abierto no aparezca en la lista y que lo descartado vuelva en cuanto
cambia DESPUÉS de que lo descartaras; y que con la sesión caducada las cuatro consultas de Jira fallen, no se
salga del sitio y la lista salga de lo que sí contestó Confluence. Tienen botón
propio, **«Qué mirar hoy: lo que ha cambiado desde que lo miraste»**.

Los tramos 53-55 son las **páginas base que Faro propone**: los enlaces que
una incidencia tiene en su contenido con la parte de la que viene cada uno —y
tres trampas que NO tienen que salir: uno en la barra de acciones, uno en un
botón dentro de la descripción y uno en una pestaña de campos plegada—, lo mismo
en una página de Confluence (ninguno de los trece del árbol lateral entra), y la
tubería entera: de esos enlaces a las páginas candidatas —una por el id que da
el enlace remoto, otra resuelta contra el índice desde un `/display/` sin id— y
de ahí a las cinco sugerencias con su motivo. Tienen botón propio, **«Enlaces
del contenido y páginas que se pueden sugerir»**. Los tramos 51 y 52 son el mapa
levantado por la API (el árbol de un espacio comparado con el árbol lateral, y
el perfil contado de un proyecto).

El tramo 50 junta las dos mitades de las **búsquedas al instante**: lo
que la extensión lee de la pantalla —los campos de una incidencia, con la clave
de la épica sacada del enlace y no de su nombre— y lo que hace con ello,
ejecutando cada pastilla contra la Jira de mentira sin que ninguna dé un error, y
comprobando que la consulta de un filtro con una función de complemento no se
ejecuta aquí sino que se abre en Jira. Tiene botón propio, **«Búsquedas al
instante de ENG-7»**.

Los tramos 44-49 son de las **lecturas por API** y no tocan la
página ni el panel: el servidor del banco finge `/rest/api/2/search`, los filtros
favoritos, los enlaces remotos de una incidencia, el contenido paginado de un
espacio y las consultas de plantilla de Confluence, y se comprueba que una
consulta de plantilla devuelve lo que dice la fixture, que un error trae el
mensaje del servidor, que los dos reintentos ocurren una vez cada uno, que el
árbol de un espacio se lee entero con el padre de cada página, y que ninguna de
esas peticiones sale del sitio. Hay un botón propio, **«Leer Jira y el árbol del
espacio por la API»**, para verlas sueltas. Para provocar los fallos, el servidor
usa direcciones de mentira delante de la API: `/sinsesion` contesta como una
sesión caducada (401) y `/sinvista` como una instalación que no tiene el campo
«visto por última vez» (400).

### Qué significa cada título del registro

El registro del panel (el icono de las líneas) apunta cada cosa con un título
corto y un detalle. Todos los títulos, por dónde salen:

**Arranque y conexión**

- «Arranque del panel» — cuánto tardó abrir el panel, fase por fase: el total
  primero y detrás «health» (¿está opencode?), «modelos y almacenamiento» (la
  lista de modelos, todo lo que este sitio tiene guardado —sitio, índice,
  contexto y memoria, en una sola lectura— y la sesión abierta, las tres cosas
  pedidas a la vez, así que la fase mide lo que tarde la más lenta), «enlazado»
  (desde Jira, leer lo del Confluence enlazado —contexto,
  índice y prefijo del wiki, también en una sola lectura—, que es otro sitio y
  no cabe en lo del propio) y «restaurar» (repintar la conversación). Hay una
  quinta fase, «MCP» —la comprobación del MCP entera: las dos consultas a
  opencode, `GET /mcp` y `GET /config`, y, si Faro reconoce el MCP y lo apunta,
  guardar eso—, pero **sólo la primera vez que usas un sitio**, que es la única
  en la que el panel la espera; en un sitio ya configurado esa comprobación va
  en segundo plano. Lo que tardan SÓLO las dos consultas se apunta aparte y
  siempre, en «MCP comprobado».
  Sale también cuando el arranque acaba en la pantalla de claves o en la de
  contexto, sin las fases que no llegó a hacer. Si opencode no contesta NO sale
  nada (sería un arranque verde que no hubo) y la fila «tiempos (arranque)» del
  estado vuelve a «(sin medir)», en vez de quedarse con la línea del arranque
  anterior. Si «MCP» dice segundos, es normal la primera vez tras arrancar
  opencode: carga sus servidores MCP en la primera consulta.
- «Ajustes aplicados» — cerraste Ajustes con **Guardar y volver** y no hacía
  falta rearrancar el panel, porque ni la dirección del servidor ni la
  contraseña cambiaron. Lo demás (el modo de navegación, la pausa entre pasos,
  el estilo del subrayado, «Reducir animaciones») se aplicó en caliente, y la
  respuesta que estuviera llegando siguió viva: hasta esta versión, cerrar
  Ajustes reconstruía el cliente y mataba el turno en vuelo.
- «Conversación recortada» — la sesión de opencode tiene más mensajes de los
  que el panel pide al abrirse: se enseñan los últimos (60) y arriba del chat
  sale la fila **Ver toda la conversación**, que trae el resto. Nada se ha
  perdido: la conversación entera sigue en opencode. El detalle dice cuántos se
  piden y cuántos KB de salidas de herramientas venían en esa ventana.
- «Stream de eventos abierto» — el panel abrió el stream de eventos (`/event`)
  de opencode; el estado pasa a «conectado».
- «Stream de eventos cerrado» — el stream se cortó; el cliente reintenta solo
  y el estado pasa a «sin conexión» mientras tanto.
- «Stream de eventos» — el stream devolvió un error; el detalle es el error.
- «Prefijo de Confluence detectado» — al entrar en un host se vio por primera
  vez (o cambió) el prefijo del wiki: `/wiki` en Cloud, «(raiz, Data Center)»
  en un Confluence propio. Se guarda para ese sitio.
- «Índice descartado» — el índice guardado era de una versión anterior de
  Faro; hay que reconstruir el contexto.
- «MCP reconocido» — un servidor MCP de opencode lleva este dominio en su
  configuración y Faro lo adopta (con qué productos sirve).
- «MCP sin conectar» — el MCP que lleva este dominio existe pero no está
  conectado: se arregla o se quita del `opencode.json`.
- «MCP reintentado» — pulsaste **Reintentar** en el consejo de un MCP en
  «failed» (en la pantalla de claves, en la espera del paso manual o en el
  aviso del chat) y Faro le pidió a opencode que volviera a arrancarlo sin
  reiniciarse. El detalle es el nombre del MCP y cómo quedó —«conectado», «en
  «failed»» o «no está en opencode»— con los milisegundos desde el clic (suelen
  ser unos 12 s: opencode no contesta hasta haberlo intentado). Sale en verde si
  conectó y en amarillo si no, y se apunta aunque entretanto te hayas ido a otro
  sitio (entonces sólo se apunta: no se pinta nada). Nunca lleva la
  configuración, que tiene las claves.
- «MCP comprobado» — cuánto ha tardado saber si el MCP de este sitio está
  conectado (`GET /mcp` y `GET /config`) y cómo ha quedado: su nombre y
  «conectado», «registrado pero en «failed»» o «no está en opencode». Desde
  esta versión el panel NO espera esa comprobación para enseñarte el chat (la
  primera vez tras arrancar opencode tarda hasta quince segundos, porque es
  cuando carga sus servidores MCP): mientras dura, la cabecera dice
  «comprobando MCP…», y si al terminar no hay MCP sale la pantalla de claves —o,
  si estabas escribiendo o esperando una respuesta, un aviso en el chat con el
  botón **Cambiar las claves**, para no taparte lo que estabas haciendo—. Si en
  esos segundos te habías ido a otra pestaña, sale cuando vuelvas al sitio; y si
  tenías delante la pantalla de contexto, al salir de ella. Un sitio que todavía
  no has configurado sí la espera: ahí la pantalla de claves es lo primero que
  hay que ver.
- «MCP escrito en opencode» — Faro escribió el MCP de este sitio en la
  configuración de opencode por su API (`PATCH /global/config`). En verde, con
  el nombre del MCP, la carpeta, los milisegundos del PATCH y los que tardó en
  aparecer en la lista de opencode, o «arranca con la ruta completa de uvx» si
  hizo falta el reintento. En amarillo: «no aparece en 20 s» (escrito, pero
  opencode no lo ha recargado: reinícialo), «tampoco con la ruta completa de
  uvx · command devuelto a uvx» (arranca opencode desde una terminal nueva) o
  «la configuración que opencode carga no es la escrita» (una configuración de
  proyecto delante). En gris, «espera cancelada», si te fuiste a otro sitio a
  mitad. Nunca lleva el contenido del fichero ni ninguna clave.
- «MCP sin escribir» — opencode no aceptó la escritura, o Faro no pudo montar
  una entrada válida con esos datos. El detalle es el código y el tipo:
  `500 · ConfigJsonError` (el fichero tiene un error de sintaxis),
  `400 · ConfigInvalidError` (una clave que opencode no conoce), `0 · entrada`
  o `0 · red` (opencode no contestó). Sale el paso manual con el porqué.
- «Configuración recargada» — pulsaste **Ya lo he pegado** en el paso manual y
  opencode releyó su fichero sin reiniciar (en verde, con los milisegundos), o no
  lo aceptó (en amarillo, con el código y el tipo).
- «Claves sin comprobar» — en amarillo, Faro adoptó un MCP que ya estaba
  conectado sin que ningún turno hubiera probado sus tokens (recargaste el panel
  a mitad del primer uso, o pegaste el bloque a mano), y el chat lo dice con un
  botón **Comprobar las claves**; el detalle nombra los hosts que se quedan sin
  comprobar, porque se decide host a host (el que ya tenías comprobado con ese
  mismo MCP no vuelve a avisar); en verde, esa primera comprobación salió bien.
  Desde que existe «Quitar las claves», sólo avisa en un sitio configurado.
- «Claves quitadas» — pulsaste **Quitar las claves de este sitio** en Ajustes.
  En verde, las entradas quedaron deshabilitadas y sin claves en opencode, lo que
  opencode carga es eso y el sitio (y su enlazado) quedó sin configurar: el
  detalle nombra las entradas, los milisegundos de la escritura y los hosts
  desmarcados. En amarillo, no se quitó nada o el sitio no se dio por
  desconfigurado: «sin quitar · configuración ilegible» (opencode no devolvió su
  configuración), «sin quitar · <código> · <tipo>» (no aceptó la escritura),
  «sin releer la configuración» (la aceptó pero no se pudo comprobar) o «la
  configuración que opencode carga no es la escrita» (una configuración de
  proyecto delante); y, tras un quitar que sí salió, las entradas que guardan
  datos que Faro no sabe vaciar (variables de más o argumentos del comando), que
  tienes que quitar a mano. En gris, «espera cancelada» si te fuiste a otro sitio
  a mitad, las entradas que no son de Faro que dejaste sin marcar y que el sitio
  seguirá adoptando, o las que ya estaban deshabilitadas y siguen con claves en
  disco. Nunca lleva el contenido del fichero ni ninguna clave.
- «MCP verificado» — los tokens se comprobaron, con una línea por producto
  («Jira: … · Confluence: …»).
- «Sitio enlazado» — el otro host (Jira o Confluence) comparte el MCP de
  éste y no pedirá claves.
- «Espera del MCP cancelada» — estabas esperando al MCP (tras escribirlo Faro
  en opencode, o en el paso manual de pegar el
  bloque y reiniciar opencode) y has cambiado a OTRO sitio de Atlassian antes
  de que opencode lo cargara: la espera se corta; al volver se vuelve a pedir,
  o el MCP ya conectado se reconoce solo. Pasar a una pestaña fuera de
  Atlassian no la corta.
- «Contexto de Confluence enlazado» — desde Jira, se cargó el contexto del
  Confluence enlazado: host, caracteres, de qué ámbito es el que viaja (desde
  H21: «espacio X», «*» si es el de todo ese sitio, o «sin contexto» si tiene
  varios espacios con contexto y ninguno de todo el sitio) y si tiene índice.
  Desde H22 dice además por qué regla se eligió: «a mano», «por el contexto»,
  «por el historial», «por ser el único con contexto» o «heredado».
- «Espacio enlazado» — (H22, en gris) cambiaste en **Ajustes → Este sitio** en
  qué espacio del Confluence enlazado se documenta el proyecto de la pestaña:
  host, proyecto y lo elegido («host · SIMPL → DCPIAS», «→ *» para todo el
  sitio, o «→ automático» si volviste a dejarlo en manos de Faro). Desde ese
  momento viaja lo que elegiste.
- «Content script inyectado» — con el permiso ya concedido, el content script
  se inyectó en la pestaña abierta sin recargarla.
- «Permiso concedido» — concediste el permiso sobre el dominio; el content
  script queda registrado para él.
- «Permiso de host denegado» — cerraste o rechazaste el diálogo de permiso de
  Chrome sobre ese host.

**Un turno**

- «Turno enviado» — la pregunta salió hacia opencode: modelo, caracteres,
  Skill, lo señalado, «página en N bloques» (y «recortada» si llegó al tope)
  y las páginas base.
- «Turno colgado» — 90 segundos sin contenido (o 15 minutos en total): el
  vigilante abortó el turno y el mensaje ofrece reintentar con otro modelo.
- «Turno fallido» — opencode o el proveedor devolvieron un error; el detalle
  es el mensaje.
- «Turno cancelado por el usuario» — pulsaste Parar: se abortan el turno y la
  sesión.
- «Turno cancelado» — el turno en vuelo se canceló desde el panel sin pulsar
  Parar: al reconstruir el cliente (cambiaste a una pestaña de OTRO host, o
  cerraste Ajustes **habiendo cambiado la dirección del servidor o la
  contraseña**) o al abrir una sesión nueva a mitad de respuesta. Antes se
  quedaba 90 s «pensando…» hasta que el vigilante lo abortaba. Si el panel
  vuelve al sitio, la respuesta que llegó a opencode sigue en esa sesión.
  También sale con «la comprobación de las claves se canceló al cambiar de
  sitio»: cambiaste de sitio mientras Faro comprobaba las claves de otro; esa
  comprobación se abandona sin apuntar nada del modelo ni tocar el sitio nuevo.
- «Respuesta recibida» — el turno terminó: caracteres de la respuesta,
  herramientas que llamó y cuántos KB de texto devolvieron, incluidas las trazas
  de las que fallaron (eso es lo que la conversación arrastra al turno
  siguiente), el reloj del turno por fases —«primer texto» es lo que tardó en
  aparecer la primera palabra; «pintar» es enseñar la respuesta, entre «fin» e
  «índice»—, cuántos
  caracteres pesaba el sistema que se mandó y, si opencode los da, los tokens
  (con la salida y la lectura de caché) y el coste.
- «Conversación pesada» — lo que esta conversación arrastra en salidas de
  herramientas ha pasado de 200 000 caracteres, y eso se reenvía al modelo en
  cada pregunta siguiente (el sistema no se acumula; las salidas sí). No es una
  avería: opencode recorta las más antiguas y protege las últimas, pero lo
  barato a partir de ahí es empezar una sesión nueva, y el aviso de la respuesta
  trae el botón. Sale una vez por sesión (y otra vez si el chat se repinta
  entero, porque el aviso se va con él).
- «Skill» — cambió la Skill (desde el desplegable, o porque «Pedirlo
  numerado» la fija en Análisis).
- «Modelo cambiado» — elegiste otro modelo; desde H16 se recuerda como tuyo,
  para todos los sitios, no para éste.
- «Modelo no disponible» — un turno, la comprobación de las claves o el
  indexado fallaron por el MODELO, y Faro lo apuntó: el detalle es
  «proveedor/modelo: <motivo> · <mensaje del proveedor>» o «… · colgado», y el
  motivo es *plan* (no está en tu plan), *credenciales* (`opencode auth login`),
  *mudo* (no contestó), *transitorio* (429 o 5xx) u *otro*. También sale con
  «proveedor/modelo: no está en la lista» si el modelo que tenías elegido ya no
  está entre los que tu opencode tiene conectados, o con «proveedor/modelo: fallo
  apuntado (<motivo>) · se preselecciona otro esta vez» si tiene un fallo
  reciente: lo dice el arranque del panel, se preselecciona otro esta vez y se
  abre la pantalla «Elige el modelo» con el motivo (o, si taparía algo, un aviso
  en el chat con «Elegir otro modelo»); la primera vez en un sitio, la pantalla
  sale antes de las claves. Y con
  «todos los modelos de la lista tienen un fallo apuntado · se usa
  proveedor/modelo» si no queda ninguno sin marcar: se usa el predeterminado y
  la pantalla te propone elegir uno, «Comprobar» alguno o pulsar «Olvidar los
  veredictos» en Ajustes.
  Un turno que termina sin ninguna palabra también se apunta, como *mudo*. En un turno sólo sale si el error es del proveedor: uno de la
  conversación, como un contexto desbordado, no dice nada del modelo.
- «Modelo elegido» — pulsaste **Usar este modelo** en la pantalla «Elige el
  modelo» y quedó guardado como el tuyo, para todos los sitios. El detalle es
  «proveedor/modelo · desde <dónde>»: *primera-vez* (el primer uso de un sitio,
  y a continuación el panel arranca de nuevo con él), *ajustes* (desde «Cambiar
  el modelo», o porque tu modelo tenía un fallo reciente), *error* (desde
  «Elegir otro modelo» bajo un error; la pregunta queda escrita en el cuadro,
  sin mandar), *setup* (falló la comprobación de las claves por el modelo, y se
  repite) o *indexado* (falló el indexado por el modelo, y se repite).
- «Modelo comprobado» — pulsaste **Comprobar** en la pantalla «Elige el modelo»
  y volvió la respuesta de ese turno corto. En verde, «proveedor/modelo · N ms»:
  contestó, y queda apuntado que funciona. En amarillo, «proveedor/modelo ·
  <motivo> · <mensaje del proveedor>»: no contestó, con el mismo motivo que
  «Modelo no disponible» (que sale también). Y en amarillo con «· sin comprobar ·
  <mensaje de opencode>»: la comprobación no llegó al proveedor —opencode no
  creó la sesión, o no hubo red— y no se apunta nada del modelo. Si cambias de
  servidor o de sitio mientras se comprueba, no se registra nada.
- «Veredictos de modelos olvidados» — pulsaste **Olvidar los veredictos** en
  Ajustes: Faro olvida qué modelos contestan y cuáles no; «el modelo elegido se
  conserva».
- «Sesión nueva» — pulsaste «nueva sesión»: se olvidan la sesión de opencode y
  las marcas; «la anterior quedó resumida» si la memoria entre sesiones está
  activa.

**Análisis**

- «Página leída en bloques» — antes de un Análisis, la página o la incidencia
  se leyó en bloques ¶: cuántos, cuántos caracteres, «recortada» si llegó al
  tope, en Jira el tipo y el estado leídos de los campos, y cuántos
  milisegundos costó leerla, medidos en la propia página (sin contar lo que
  tardó en pintarse).
- «Página sin bloques» — no se pudo leer en bloques: estás en el editor, o la
  pestaña no contesta (recárgala).
- «Anclas en la respuesta» — el bloque JSON de anclas señala un bloque válido
  para N de las M observaciones.
- «Sin bloque de anclas» — la respuesta numera pero no trae el bloque JSON (o
  ninguno utilizable): se pide aparte.
- «Segunda pasada» — la petición aparte de las anclas, en una sesión
  desechable: cuántas observaciones situó, por qué no, o que no se pudo abrir
  la sesión.
- «Pasada que trocea» — la respuesta no numeraba nada: se le pidió aparte que
  la trocee en observaciones y las sitúe; cuántas se numeraron y situaron.
- «Numeración adaptada» — el modelo numeró a su manera («1.», «Observación
  1:», encabezados) y Faro lo reescribió como `[n]`.
- «Numeración del JSON» — la prosa no lleva `[n]`; valen los números del
  bloque de anclas.
- «Sin observaciones» — el modelo cerró con «Sin observaciones.»: no hay nada
  que subrayar; con marcas previas, se quedan.
- «Marcas conservadas» — la respuesta es un seguimiento (cita observaciones
  sueltas, o no numera nada): las marcas que hay se quedan.
- «Marcas sobrantes» — el bloque JSON trae números que la respuesta no tiene.
- «Sin marcas» — no se marcó nada, con la razón (las ocho que emite el panel):
  la respuesta es corta y no numera nada, o una consulta falló y la respuesta
  no numera nada (y se ofrece «Pedirlo numerado»); la respuesta cita
  observaciones sueltas y no hay un análisis del que vengan; falta permiso en
  ese host; estás en el editor (antes de leer la página, o al ir a marcar); no
  se pudo leer la página en bloques; ninguna observación apunta a un bloque
  del texto; la respuesta no numera nada y no se supo trocearla; la pestaña
  cambió de página mientras se preparaban.
- «Sin anclar» — las observaciones que no se pudieron situar en la página.
- «Análisis marcado» — de cada número, cómo se resolvió: `block+quote`,
  `block+whole`, `block-moved`, `global`, y «N ms en la página»: lo que costó
  resolver y pintar las marcas dentro de la página, sin la espera a que la
  página tenga texto ni el desplazamiento hasta la primera marca (son hasta 2 s
  y 420-820 ms que no son trabajo de Faro y tapaban la diferencia entre una
  página corta y una larga).
- «Análisis marcado de nuevo» — pulsaste «Volver a marcar en esta página» y
  las marcas se volvieron a poner (cuántas de cuántas), con los mismos «N ms en
  la página».
- «Observaciones copiadas» — pulsaste «Copiar observaciones» en la tarjeta del
  análisis y la respuesta numerada está en el portapapeles, tal como se lee en
  el chat (con sus «[n]»); el detalle son los caracteres copiados. Si el
  portapapeles falla, el propio botón lo dice («No se pudo») y no se apunta
  nada aquí.

**Páginas base**

- «Página base» — al añadir una página por su id, la API del Confluence
  respondió 404: no se añade.
- «Página base añadida» — con su título, su id y de dónde salió (índice, API
  del sitio, del Confluence enlazado o por su id).
- «Página base quitada» — la quitaste de la lista.
- «Página base sin título» — se añadió por id como «Página N» porque no había
  Confluence al que preguntar o la API no contestó (motivo al lado).
- «Páginas base quitadas» — «Quitar las páginas»; el alcance se queda como
  estaba.
- «Alcance del análisis» — cambiaste el alcance: sólo estas, o estas como
  mínimo.
- «Búsqueda de páginas» — la búsqueda por título en la API falló, con el
  motivo (sesión, login, la pestaña no contestó).
- «Fuera del alcance» — con «sólo estas», el modelo consultó algo que no
  estaba en la lista; el detalle dice qué.
- «Páginas base sin leer» — este sitio no tiene el MCP conectado: el modelo no
  pudo leerlas.
- «Historial de páginas base» — terminaste un análisis con páginas base y Faro
  apuntó cuáles usaste y para qué (la clave o el id, el tipo de ticket, cuántas
  páginas y cuántas entradas quedan), que es de lo que salen las sugerencias.
  Se guarda **sólo en tu navegador** y nunca entra en un prompt. También sale
  cuando lo borras («borrado · N entradas de …»), cuando el turno terminó con
  el panel ya en otro sitio y no se apunta nada, y en amarillo si
  `chrome.storage` no dejó guardarlo: lo que se pierde entonces es una
  sugerencia futura, no la respuesta.
- «Enlaces de la página» — al abrir Páginas base, cuántos enlaces se leyeron
  del contenido, cuántos de ellos son páginas de Confluence y qué pasó con los
  enlaces remotos de la incidencia (su número, «no es una incidencia»,
  «apagados en Ajustes» o el motivo del fallo), más lo que costó leer la
  página. En amarillo si la pestaña no contestó: entonces las sugerencias
  siguen saliendo del contexto, del historial y del índice, y el texto de la
  pantalla lo dice.

**Navegación**

- «Índice ampliado» — las salidas de las herramientas descubrieron páginas o
  incidencias nuevas y el índice creció (+N · total). Sólo entidades de este
  sitio (y, desde un Jira, del Confluence enlazado): las URLs de otros hosts se
  descartan antes de mirar nada, y una sigla con forma de clave («UTF-8»,
  «ISO-8601») sólo cuenta si su proyecto es conocido o viene en `/browse/`.
- «Índice sin ampliar» — el turno terminó con el panel ya en otro sitio (o en
  otra sesión), así que lo que devolvieron las herramientas no se cosechó ni se
  leyó el árbol de la barra lateral: el índice de aquel sitio se queda como
  estaba y la siguiente pregunta allí vuelve a intentarlo. El detalle dice con
  qué sitio se preguntó. Pasa cuando cambias de pestaña a mitad de una respuesta
  larga: entre que el modelo contesta y que se cosecha el índice está el marcado
  de las observaciones, que puede durar otro turno entero.
- «Árbol leído de la página» — tras la respuesta se leyó del DOM la parte
  desplegada del árbol lateral: relaciones nuevas y filas leídas.
- «Índice guardado» — la ÚNICA escritura del índice de este turno, con cuántas
  páginas e incidencias tiene y bajo qué sitio se guardó. Todo lo que hace
  crecer el índice durante un turno (las salidas de las herramientas, el árbol
  de la barra lateral, el camino que lee el planificador) se apunta y se escribe
  una sola vez al final; antes se escribía hasta tres veces y no se decía
  ninguna.
- «Índice sin guardar» — esa escritura falló (normalmente por la cuota de
  `chrome.storage`): lo aprendido se queda apuntado y el turno siguiente lo
  intenta otra vez. La respuesta no se toca. Antes un fallo de cuota salía como
  «Fallo enviando: …», que era mentira: el turno ya había respondido.
- «Destino leído de la respuesta» — en Búsqueda, la línea «Destino: …» dio el
  destino sin preguntar al modelo.
- «Búsqueda de Jira como destino» — la tarjeta abre la búsqueda JQL real que
  hizo el modelo, con cuántos resultados dio.
- «Sin navegación» — no hay índice de este sitio, o no hay dónde ir (con la
  razón). Desde H21, con el detalle «este espacio no tiene mapa»: estás en un
  espacio de Confluence que todavía no tiene mapa y la respuesta apuntaba a
  algún sitio; bajo ella sale la tarjeta «Me falta el mapa de este espacio»
  con su «Construir». Un destino de OTRO espacio que sí tenga mapa sigue dando
  su tarjeta de siempre.
- «Camino leído de Confluence» — la cadena de padres del destino se leyó de
  la API REST del sitio (ramas, versión de la API, milisegundos).
- «Sin camino» — no se pudo leer (sin acceso a la pestaña, 401/403, login,
  404): te lleva de golpe.
- «Asistida bloqueada» — pulsaste «Paso a paso» sin permiso sobre el dominio
  («falta permiso»); sale la tarjeta **Dar permiso**.
- «Navegación lanzada» — el plan salió al service worker: modo, destino y
  URL.
- «Navegación fallida» — el service worker no aceptó el plan, o no contestó.
- «Navegación detenida» — el recorrido acabó mal: «sin permiso de host», o el
  error del paso.
- «Navegación cancelada» — cancelaste el recorrido: «desde la tarjeta» (el
  botón **Parar** que la tarjeta enseña mientras dura un recorrido paso a
  paso) o «desde la página» (Escape con el foco puesto).
- «Enlace fuera del sitio» — un enlace del chat (lo escribió el modelo) no
  era del sitio de la pestaña, ni del Confluence enlazado, ni de
  `id.atlassian.com`, y no se ha abierto; el detalle es el host. Si lo
  necesitas, cópialo a mano. Desde la revisión adversaria de H2 ese enlace ni
  siquiera se pinta como enlace: se ve su texto con la URL entre paréntesis,
  atenuada, para que la leas antes de copiarla.
- «Fragmento resaltado» — al llegar, el fragmento se subrayó; el detalle es la
  estrategia con la que se encontró.
- «Sin resaltar» — se llegó al destino pero el fragmento no se encontró, con
  el motivo.
- «Diagnóstico del árbol» — Ajustes → Diagnóstico del árbol leyó la barra
  lateral; cada línea del informe va debajo como «debug» (fuera del filtro
  «Solo problemas»).

**Buscar en Jira sin gastar tokens**

Estos cinco salen sólo en un **Jira propio (Data Center)** y sólo con la casilla
**Ajustes → Consultar tu sitio** encendida. En Jira Cloud esa API está retirada y
en Confluence no hay nada de esto.

- «Lista de Jira leída» — la tarjeta de una búsqueda trae dentro la lista de
  incidencias, leída de la API del propio Jira con tu sesión del navegador:
  cuántas se enseñan de cuántas hay, «sin ordenar por lo último visto» si tu
  instalación no acepta ese orden y hubo que pedirlo por fecha de cambio, «vía
  /jira» si tu Jira cuelga de una ruta de contexto, cuántos milisegundos costó y
  la consulta entera. Ni un token: la consulta es la misma que el modelo acababa
  de ejecutar, y ejecutarla otra vez contra tu sitio es una petición.
- «Lista de Jira no disponible» — no se pudo leer esa lista, con el motivo:
  estás en Jira Cloud, falta el permiso sobre el dominio, tu sesión no vale para
  la API (401/403), Jira rechazó la consulta (y entonces el detalle es **el
  mensaje del servidor**, tal cual), o el panel ya se había ido a otro sitio
  mientras llegaba. **La tarjeta se queda igual y sigue llevándote a la
  búsqueda**: la lista es un añadido. El aviso bajo la tarjeta sale una vez por
  sitio y por sesión, salvo el de una consulta rechazada, que habla de ESA
  consulta y se dice siempre.
- «Búsquedas al instante» — sólo si algo falló al preparar los chips del chat
  vacío; el detalle es el error. Los chips en sí no se apuntan: son una oferta.
- «Filtros favoritos» — los filtros que tú tienes marcados en tu Jira se
  leyeron para ofrecerlos como chip (cuántos), o no se pudieron leer, con el
  motivo. Quedarse sin ellos sólo quita chips, así que no sale nada en el chat.
- «Búsqueda directa» — pulsaste un chip: la consulta se ejecutó **sin pasar por
  el modelo** (de qué fuente salía el chip, su etiqueta y la consulta). Bajo la
  pregunta lo pone: «búsqueda directa, sin modelo». Si el chip no se pudo
  ejecutar, el detalle dice por qué.
- «Búsqueda precargada» — pulsaste *Preguntar sobre estos* bajo la lista de una
  búsqueda: esas filas viajarán con la siguiente pregunta, para que el modelo no
  tenga que volver a pedirlas a Jira. El detalle es lo mismo que verás bajo la
  pregunta —cuántos resultados y la consulta recortada— más la consulta entera.
  No hay título de fallo: si cambias de página o de sitio entre el clic y el
  envío, lo precargado se descarta y la nota bajo la pregunta no aparece, que es
  lo que se ve. Con el detalle «no viaja: el alcance del análisis es exclusivo»,
  es que mandaste la pregunta en Análisis con el alcance exclusivo puesto: la
  lista no fue (y un aviso en el chat te lo dijo). Y el «Sin navegación» con
  «la pregunta era sobre una lista ya leída» que sale detrás de un turno así no
  es un fallo: no había búsqueda nueva que abrir ni sitio al que llevarte.

**Qué mirar hoy**

- «Qué mirar hoy» — la lista se leyó: cuántas filas salieron, cuántas de Jira y
  cuántas de Confluence, cuántas traen un cambio desde que las miraste, de
  cuántos candidatos, de qué sitios, y lo que tardó (o «de la caché», si valía
  la lectura de hace menos de un cuarto de hora). Con el mismo título salen
  también las otras cosas que se hacen ahí: descartar una fila, apagar o
  encender el sitio, borrar tu actividad, y «pregunta de Análisis preparada en
  el cuadro, sin mandar». Son números y motivos: nunca un título ni un id.
- «Qué mirar hoy no disponible» — no se pudo leer, o no había a quién
  preguntar. Los casos: no hay ningún sitio que consultar (Jira Cloud, donde esa
  API está retirada; o una pestaña de Confluence, desde la que todavía no se
  consulta el Jira enlazado); un sitio se quedó fuera y el detalle dice por qué;
  la respuesta llegó con el panel ya en otro sitio; ninguna consulta devolvió
  nada; o no se pudo apuntar la actividad. La sección se queda vacía o a medias
  y el resto del panel sigue igual.

**Señalar en la página**

- «Señalado en la página» — lo que subrayaste o la imagen que pulsaste llegó
  al panel.
- «Selección cancelada» — saliste del modo de señalar sin elegir nada.

**Contexto**

- «Índice leído de la API» — el árbol del espacio se leyó de la API de tu
  Confluence con tu sesión, antes de gastar un turno del modelo: cuántas
  entradas tiene el índice, cuántas peticiones hicieron falta, **«N de M»** si el
  espacio es más grande que el tope —lo que entra son las páginas que se han
  movido más recientemente, cada una con su rama entera— y los milisegundos. Si
  tu Confluence no sabe hacer esa consulta ordenada, se lee la lista de siempre y
  lo dice («por la lista, sin ordenar por fecha»). Ni un token.
- «Perfil del proyecto» — se contó una muestra del proyecto de tu Jira (Data
  Center) para saber los tipos, estados, componentes,
  etiquetas y convenciones que usa de verdad, **con el id de cada tipo y de cada
  estado** (que es lo único que una búsqueda JQL acepta cuando el nombre te lo
  traduce Jira): de cuántas incidencias era la muestra y cuántos
  tipos y estados salieron. Sale al levantar el mapa y también cuando se
  refresca solo, como mucho una vez al día y siempre en segundo plano; si el
  refresco no pudo, lo dice con el motivo. No mira quién es quién: del perfil
  no salen personas.
- «Índice por la API no disponible» — no se pudo leer eso de la API, con el
  motivo: estás en Jira Cloud, pediste indexar «todo Confluence» (o «todo
  Jira») en vez de UN espacio o UN proyecto, falta el permiso sobre el dominio,
  la pestaña no contestó, o la API no devolvió ninguna página. **El indexado
  sigue entero por el camino de siempre**, con los turnos del modelo, y el
  motivo se ve también en el velo mientras pasa y al terminar. Con **Ajustes →
  Consultar tu sitio** apagado no sale: apagarlo no es un fallo.
- «Contexto construido» — el indexado terminó: entradas del índice y
  caracteres del documento de contexto.
- «Contexto migrado» — (H21, en gris, una sola vez) el contexto que tenías de
  antes —uno por sitio— se ha guardado ya con su forma nueva, uno por espacio o
  proyecto. El detalle dice el sitio, bajo qué ámbito quedó (`space:KEY` o
  `project:KEY` si el mapa guardado era de ese espacio y se sabía cuándo se
  indexó; `*`, todo el sitio, en cualquier otro caso: sigue valiendo en todos
  los espacios, como antes) y cuántos caracteres. Si no se pudo escribir no
  sale, y se vuelve a intentar al abrir el panel. En amarillo, «N de M
  caracteres (recortado a textMax)»: el contexto de antes pasaba de 60 000
  caracteres y lo que sobraba se ha perdido de lo que guarda Faro.
- «Mapa lleno» — (H21, en amarillo) pediste construir el mapa de un espacio y
  las páginas de los otros espacios, más las 300 que puede traer, pasarían de
  1 500 (las que no se pueden olvidar no cuentan; el número del detalle sí las
  cuenta todas): no se ha leído ni
  escrito nada. El detalle dice cuántas páginas de cuántos espacios hay y qué
  espacio se quedó sin indexar; en el chat, un aviso rojo te manda a **Ajustes
  → Mapas y contextos de este sitio** a olvidar el mapa de otro.
- «Mapa olvidado» — (H21) pulsaste **Olvidar el mapa** de un espacio (o
  proyecto) en Ajustes: en gris, el sitio, la clave y cuántas páginas y
  caracteres de contexto se llevó, o «nada que olvidar» si no había nada; en
  amarillo, «no se pudo escribir», y el mapa sigue donde estaba.
- «Contexto construido en segundo plano» — el indexado terminó cuando el panel
  ya estaba en otro sitio: se guardó bajo el host que se indexó (fundido con
  el índice guardado de ese host) sin tocar el estado ni el chat del sitio
  abierto. Al volver a aquel sitio, está.
- «Indexado cancelado» — el indexado se paró antes de acabar: lo paraste con
  **Cancelar**, o cambiaste de sitio a mitad (el cliente se reconstruye y se
  lo lleva). No se guarda nada: el sitio NO queda configurado y su pantalla de
  contexto volverá a salir.
- «Indexado fallido» — el indexado falló, con el mensaje (cancelarlo no es un
  fallo: se dice aparte).

---

## Problemas frecuentes

**`npm run check` acaba en rojo por «docs»**
Es el quinto paso, que compara los documentos con el código. «README.md: dice
N pruebas unitarias y hay M» → pon M en README.md y en CLAUDE.md §2.
«docs/PINES.md §10 (línea L): «x.test.js» dice N pruebas y registra M» → pon M en
esa línea de §10. Un título del registro sin documentar → una línea en la
lista de arriba. Un mensaje sin receptor o sin mención, o un fichero de `src/`
fuera del mapa → CLAUDE.md §5 y §3; «nadie lo manda» es aviso, no error.
`npm run check:docs` lo enseña entero con las líneas.

**«opencode no responde»**
El servidor no está arrancado, o el puerto de los ajustes no coincide. El panel
te muestra el comando exacto, con el `--cors` ya relleno.

**El panel dice que la página no contesta justo después de actualizar la extensión**
Recarga la pestaña: el content script se inyecta al cargar la página, y el
que tiene cargado es el anterior. Si sigue igual, mira en la consola de la
página si hay errores al cargar `chrome-extension://…/src/…`: Faro sirve sus
módulos con `use_dynamic_url` (la URL cambia en cada sesión, para que ninguna web
pueda detectar la extensión; esa protección sólo funciona desde Chrome 130, que
es por eso el mínimo del manifest) y los pide siempre con
`chrome.runtime.getURL()`, así que un módulo bloqueado significa que su carpeta
no está en `web_accessible_resources` del manifest (lo vigila
`web-accessible.test.js` en `npm run check`).

**Cambié de pestaña a mitad de respuesta y el turno desapareció**
Es lo previsto. Al pasar a una pestaña de OTRO host el panel reconstruye su
cliente y cancela el turno en vuelo («Turno cancelado» en el registro) en vez de
dejarlo 90 s «pensando…». Pasar a una pestaña fuera de Atlassian no lo cancela.
La respuesta, si llegó a opencode, sigue en la sesión de aquel sitio y aparece
al volver. «Nueva sesión» a mitad de turno también lo cancela, y el botón está
desactivado mientras se responde.
Cerrar **Ajustes** ya no lo cancela, salvo que hayas cambiado la dirección del
servidor o la contraseña: eso es lo único que obliga a reconstruir el cliente.
Cambiar «Reducir animaciones», el modo de navegación, la pausa entre pasos o el
estilo del subrayado se aplica en caliente («Ajustes aplicados» en el registro)
y la respuesta sigue llegando; la página se entera al momento, sin esperar a que
navegues.

**El panel dice «pensando… 45 s sin señales del modelo»**
Es el vigilante avisando a mitad de su plazo: el turno sigue vivo y sigue
esperando hasta los 90 segundos. Un modelo que está leyendo tres páginas con el
MCP y uno que se ha quedado colgado se veían igual, y no había con qué decidir
si esperar o pulsar Parar. En cuanto llega la primera palabra (o una consulta),
el texto vuelve a «pensando…». Si el turno muere de verdad, sale «Turno colgado»
y el mensaje ofrece reintentar con otro modelo.

**El panel enseña sólo los últimos 60 mensajes de la conversación**
A propósito. Pedir la sesión entera bajaba también las salidas de las
herramientas —megabytes— cada vez que se abre el panel, se vuelve al sitio o se
sube un contexto, para pintar sólo el texto. Cuando recorta, el chat lo dice
arriba («Conversación larga: se enseñan los últimos 60 mensajes») y el botón
**Ver toda la conversación** trae el resto; en el registro queda «Conversación
recortada». Con 1-4 turnos, que es lo normal, no recorta nunca.

**Faro me avisa de que la conversación es pesada**
El número son los caracteres de todo lo que las herramientas han devuelto en
esta sesión, y eso viaja otra vez al modelo en cada pregunta (el sistema no se
acumula; las salidas sí). opencode ya recorta las más antiguas y protege las
últimas, así que no es una avería: es el punto en el que sale más barato empezar
de nuevo. El botón **Sesión nueva** del aviso lo hace, y si tienes la memoria
entre sesiones activa, la sesión que cierras queda resumida. El aviso sale una
vez por sesión.

**Las marcas del análisis parpadeaban al hacer scroll**
Arreglado. El overlay recreaba cada rectángulo en cada evento de scroll, y un
rectángulo nace transparente y aparece con una transición de 0,4 s: desplazarse
lo hacía aparecer desde cero una y otra vez (se veía sobre todo en la vista de
incidencia de un Jira Data Center, donde el que se desplaza es un panel
interno). Ahora una ráfaga de scroll se junta en un solo fotograma y los nodos
se reutilizan en vez de recrearse. Lo comprueba la comprobación 41 del banco
(botón «Marcas + 40 scrolls (parpadeo)»).

**Un enlace del chat no se abre**
Sólo se abren enlaces del sitio de la pestaña, del Confluence enlazado y de
`id.atlassian.com`; cualquier otro —los escribe el modelo, y un texto
escondido en una página podría dictárselo— se dice bajo la respuesta y en el
registro («Enlace fuera del sitio», con el host) y no se abre. Cópialo a mano
si lo necesitas.
En el chat esos enlaces aparecen apagados y con la URL a la vista: no son
pulsables ni con el botón central ni con «Abrir en una pestaña nueva», que era
la forma de saltarse la comprobación.

**Escape no borra las marcas del análisis (o «se lo queda» la página)**
A propósito, desde H2: Escape es de Faro sólo mientras tiene algo en marcha
—el foco de un recorrido, el cartel, la barra de señalar o el seguimiento— o
mientras el único subrayado es el de una llegada por cita.
Con las marcas de un análisis puestas, Escape llega a la página como siempre
y no borra nada a espaldas del panel: las marcas se quitan con **Quitar las
marcas** o con la siguiente orden. La cita subrayada al llegar a un destino sí
se quita con Escape mientras no haya marcas numeradas: de ésa el panel no
guarda estado, así que la tecla es el control para borrarla (entre H2 y la
revisión del 2026-09-14 se quedaba puesta hasta la siguiente orden).

**Responde 401**
La contraseña del panel no coincide con `OPENCODE_SERVER_PASSWORD`. Se manda
como `Authorization: Basic base64("opencode:" + contraseña)`.

**El chat funciona pero no sabe nada de Jira o Confluence**
El MCP no conectó. Comprueba, en este orden:
1. Que el bloque está en `opencode.json` y el JSON es válido.
2. Que **reiniciaste** opencode después de pegarlo.
3. `curl -u opencode:TU_CONTRASENA http://127.0.0.1:4096/mcp` debe responder
   `{"atlassian-...":{"status":"connected"}}`.
4. Que `uvx` está en el PATH del proceso que arrancó opencode: si el panel dice
   que el MCP está en «failed», mira las entradas de justo debajo.

**El MCP está en «failed · Connection closed»**
El proceso del MCP se cerró nada más empezar (opencode lo marca en unos 40 ms).
En Windows es casi siempre que opencode no encuentra `uvx`: en la terminal de
opencode (con `--print-logs`) verás «"uvx" no se reconoce como un comando…».
Ejecuta `powershell -ExecutionPolicy Bypass -File tools\instalar.ps1` y
**arranca opencode desde una terminal NUEVA** (o con
`tools\arrancar-opencode.ps1`): el MCP hereda el PATH con el que arrancó
opencode, así que un uv instalado después no lo ve el opencode que ya estaba
abierto. **Reintentar** del panel vuelve a arrancar el MCP sin reiniciar
opencode, pero sólo sirve si `uvx` ya estaba en el PATH de ese opencode; si
acabas de instalar uv, reiniciarlo es lo que lo arregla. Faro no puede leer la
terminal de opencode: por eso el panel dice «casi siempre» y te manda a mirarla.

**El MCP está en «failed · Operation timed out after N ms»**
Venció el plazo de arranque del bloque (60 s). Suele ser la primera vez, con
`uvx` descargando unos 107 paquetes (y Python) o detrás de un proxy lento. El
proceso no muere: sigue descargando en segundo plano. Espera unos segundos y
pulsa **Reintentar**. Tras un plazo vencido puede quedar un `mcp-atlassian` de
más vivo hasta que cierres opencode; es inofensivo.

**Faro dice que ha escrito la configuración y el MCP no aparece**
«Ya está escrito en <carpeta>, pero opencode no lo ha cargado en 20 s»: tu
opencode no ha recargado su configuración en caliente, que es algo que sólo está
probado en la versión 1.2.25 (si la tuya es otra, la espera ya te lo avisaba).
**Reinicia opencode** con el mismo comando: al arrancar lee su fichero, y Faro,
que sigue mirando, continúa solo en cuanto el MCP aparece conectado. No hay nada
que pegar: el bloque ya está en el fichero, y si abres la carpeta que te dice
lo verás (en `opencode.jsonc` o en `opencode.json`, el que ya tuvieras). En el
registro sale «MCP escrito en opencode» en amarillo, con «no aparece en 20 s».

**«La configuración de opencode tiene un error de sintaxis» (o «una clave que opencode no conoce»)**
Faro intentó escribir y opencode no lo aceptó, porque su fichero de
configuración ya estaba mal: tiene un error de sintaxis (una coma de más, una
comilla sin cerrar, un BOM al principio…) o una clave que opencode no reconoce.
Faro no te enseña el contenido del fichero (lleva tus claves); abre tú la
carpeta de la pantalla, arregla el fichero, pega el bloque que te enseña el
paso manual y pulsa **Ya lo he pegado**. En el registro sale «MCP sin escribir»
con `500 · ConfigJsonError` (sintaxis) o `400 · ConfigInvalidError` (clave
desconocida), y tras pulsar el botón, «Configuración recargada».

**«Hay una configuración de proyecto delante»**
Faro escribió el MCP en la configuración global de opencode, pero opencode está
cargando otra: la de un `opencode.json` de proyecto en la carpeta desde la que lo
arrancaste, que manda sobre la global. Arranca opencode desde otra carpeta
—`tools\arrancar-opencode.ps1` usa una propia y vacía, y además le dice que no
lea configuraciones de proyecto— y vuelve a pulsar **Conectar y comprobar**. En
el registro, «MCP escrito en opencode» con «la configuración que opencode carga
no es la escrita».

**«Las claves de … no se han comprobado todavía»**
El MCP de este sitio ya estaba conectado en opencode cuando se abrió el panel,
pero ningún turno ha probado sus tokens: pasa si recargas el panel a mitad del
primer uso, o si pegaste el bloque a mano. Pulsa **Comprobar las claves**: hace
la misma comprobación de siempre (un turno corto por producto) sin volver a
escribir nada en opencode, y el aviso se va si sale bien. En el registro, «Claves
sin comprobar» en amarillo al adoptarlo y en verde al comprobarlas.

**Faro no me deja guardar las claves: «Espera a que termine…»**
Escribir en la configuración de opencode corta TODO lo que ese opencode tenga en
marcha, así que Faro sólo escribe con el panel quieto: sin una respuesta
llegando, sin un indexado, sin «Comprobar» probando un modelo y sin la
comprobación de las claves a medias. Espera a que termine y vuelve a pulsar. Y
si el botón está apagado sin nada en marcha, es que falta marcar la casilla del
permiso, justo encima. Lo mismo vale para **Quitar** en «Quitar las claves de
este sitio»: también escribe en opencode, y además se apaga si no hay nada que
quitar —con sólo entradas que no son de Faro, hasta que marques su casilla—.

**Quité las claves y el sitio vuelve a quedar configurado**
Ese dominio tiene otra entrada que no escribió Faro (pegada a mano, con Docker) y
la dejaste sin marcar: sigue habilitada con sus claves, y al arrancar Faro la
vuelve a adoptar. Vuelve a **Quitar las claves de este sitio** y marca su
casilla, o quítala tú del fichero. En el registro, «Claves quitadas» en gris la
nombra.

**Quité las claves y sale un aviso en el chat en vez de la pantalla de claves**
Tenías algo escrito en el cuadro, y Faro no abre una pantalla encima de lo que
estás escribiendo: el aviso dice lo mismo que la pantalla («El MCP «…» está
deshabilitado y sin claves…») y su botón **Cambiar las claves** te lleva a ella.

**«Quitar las claves»: «lo que carga no es lo escrito»**
opencode aceptó la escritura, pero la entrada que carga sigue con claves: hay
una configuración de proyecto (un `opencode.json` en la carpeta donde
arrancaste `opencode serve`) delante de la global. Faro no da el sitio por
desconfigurado. Arranca opencode desde otra carpeta —`tools\arrancar-opencode.ps1`
usa una propia y vacía— y vuelve a intentarlo.

**opencode no arranca: «is not valid JSON(C)… InvalidSymbol 1:1»**
El `opencode.json` está guardado con BOM (tres bytes invisibles al principio).
Guárdalo como UTF-8 **sin** BOM. Ojo: `Set-Content -Encoding utf8` y
`Out-File -Encoding utf8` de PowerShell 5.1 lo ponen siempre; en el Bloc de
notas, «Guardar como» → codificación «UTF-8» (no «UTF-8 con BOM»).

**opencode no arranca: «InvalidEscapeCharacter»**
Dentro de una cadena JSON la barra invertida es un escape: una ruta de Windows
como `C:\Users\…` tiene que ir con las barras dobladas (`C:\\Users\\…`) o con
barras normales (`C:/Users/…`). Lo mismo si metiste un `{env:…}` con una ruta
dentro.

**Quiero usar Docker en vez de uv**
Se puede, y Faro no lo escribe: el bloque se pega a mano, con las variables por
**nombre** (`-e VAR` sin valor toma la del `environment` del bloque, así que el
token no aparece en la línea de órdenes):

```json
"command": [
  "docker", "run", "-i", "--rm",
  "-e", "JIRA_URL", "-e", "JIRA_PERSONAL_TOKEN",
  "-e", "CONFLUENCE_URL", "-e", "CONFLUENCE_PERSONAL_TOKEN",
  "-e", "READ_ONLY_MODE", "-e", "TOOLSETS",
  "ghcr.io/sooperset/mcp-atlassian:ETIQUETA"
]
```

con el `environment` de siempre. Cambia `ETIQUETA` por la de una versión
concreta publicada en `ghcr.io/sooperset/mcp-atlassian`, **no** `latest`: la
imagen `latest` probada decía «version 0.0.0», y sin fijarla cada uno llevaría
una distinta. Con la imagen ya descargada conectó en unos 8 s. Exige Docker
Desktop encendido. Y **no** uses `npx mcp-atlassian`: en npm ese nombre es de
otro autor y no es el mismo paquete; ejecutaría código ajeno con tus tokens.

**«El modelo no tenía ninguna herramienta del MCP disponible»**
Es lo que sale cuando se pregunta antes de que el MCP haya terminado de
arrancar. No es culpa del token: espera y reintenta desde ajustes.

**Dice «Jira: …» o «Confluence: …» y no sigue**
Son dos tokens y se comprueban los dos; el resultado queda en el registro como
«MCP verificado», con una línea por producto. El que falla se dice con su nombre:
revisa ese, no el otro. En Data Center, comprueba además que la dirección de
ese producto es la suya (`https://jira.…`, no la de Confluence). Si lo que
falló fue el MODELO y no el token, ya no sale así: el chat dice «El modelo «X»
no ha podido contestar…» (la entrada de más abajo sobre el modelo).

**Abro el Jira de mi Confluence (u otro host) y me vuelve a pedir claves**
No debería: al arrancar, Faro le pregunta a opencode qué servidores MCP tiene
y se queda con el que lleve este dominio en su `JIRA_URL` o `CONFLUENCE_URL`,
lo haya configurado Faro desde el otro producto, lo hayas pegado tú a mano, o
venga de antes. Con varios, elige el que está **conectado**; entre los
conectados, el que tiene los dos productos; en igualdad, el primero del
fichero. Un bloque con `"enabled": false` no cuenta. En el registro sale como
«MCP reconocido», y el otro host queda enlazado en ese momento.

Si la pantalla de claves dice «El MCP «nombre» está registrado pero en
«failed»», ese bloque es el que hay que arreglar o quitar del `opencode.json`:
mientras exista y ninguno de los que llevan este dominio conecte, Faro no tiene
otro que usar (en el registro, «MCP sin conectar»). Si tienes dos MCP con el
mismo token de cuando se configuraban por separado, funciona, pero es un
proceso de más: quita el que sobre.

**En Jira la tarjeta no ofrece abrir la búsqueda**
Sólo sale cuando el modelo llamó de verdad a `jira_search` y esa búsqueda
devolvió algo: en el registro aparece «Búsqueda de Jira como destino» con la
consulta y cuántos resultados dio. Si no está, es que el modelo contestó sin
buscar (pásale la Skill Búsqueda, que le obliga) o que todas sus consultas
volvieron vacías; entonces, si nombra una sola incidencia, la tarjeta abre esa.

**En Jira la Skill Búsqueda no encuentra nada**
Mira qué JQL ha usado: lo dice en la respuesta. Casi siempre es que acotó al
proyecto de la URL y lo que buscas está en otro: dile «en todos los proyectos»
o nombra el proyecto. Y en Jira Data Center `text ~` busca por palabras
enteras.

**La tarjeta de la búsqueda no trae la lista, o dice «tu sesión no vale para la API»**
La lista se lee de la API de tu propio Jira con la sesión del navegador, así que
lo primero es **abrir ese Jira en una pestaña y entrar**: si la sesión caducó, la
API contesta 401 aunque el panel siga funcionando (el modelo va por el MCP, que
usa su token, no tu sesión). Recarga la pestaña y vuelve a preguntar. El registro
lo dice con el motivo exacto en «Lista de Jira no disponible». Los demás motivos:
**Jira Cloud** (esa API está retirada allí; todo va por el MCP), **falta el
permiso** sobre el dominio (la navegación paso a paso lo pide con un botón), y
**Jira rechazó la consulta**, en cuyo caso el aviso trae el mensaje del propio
servidor —normalmente una cláusula que tu instalación no tiene—. Y comprueba que
**Ajustes → Consultar tu sitio** está encendido: apagado, no se pide nada y no
hay aviso, porque no es un fallo. En todos los casos la tarjeta sigue llevándote
a la búsqueda en Jira.

**No me salen las búsquedas al instante en el chat vacío**
Sólo salen en un **Jira propio (Data Center)**, con la casilla **Ajustes →
Consultar tu sitio** encendida, y salen las que haya de qué sacar: si no tienes
una incidencia abierta, no hay épica ni sprint de los que partir; si no tienes
filtros marcados como favoritos en tu Jira, no hay pastilla de filtro (el registro
dice «Filtros favoritos» con cuántos leyó); y las «Última: …» aparecen en cuanto
ejecutes la primera. Como mucho cuatro, para que el chat vacío siga cabiendo.

**«Qué mirar hoy» sale vacío, o el botón nunca se enciende**
Primero, las dos casillas: **Ajustes → Consultar tu sitio** y **Ajustes →
Sugerirme qué mirar hoy** tienen que estar encendidas (la segunda se apaga sola
con la primera), y la pantalla tiene la suya propia, **«No sugerir nada en este
sitio»**. Después, dónde estás: en **Jira Cloud** no hay lista de Jira —esa API
está retirada— y desde una pestaña de **Confluence** todavía no se consulta el
Jira enlazado; las dos cosas las dice la propia pantalla, y quedan en el
registro como «Qué mirar hoy no disponible» con el motivo. Si la sesión de tu
sitio caducó, la API contesta 401: abre ese Jira o ese Confluence en una
pestaña, entra y vuelve. Y si acabas de instalar, **es normal que los primeros
días haya poco**: la mitad de las señales salen de tu propio diario —qué has
visto, qué has analizado—, que se llena mientras trabajas. La lista se guarda un
cuarto de hora; **Actualizar** la vuelve a pedir.

**Quiero ver y borrar lo que Faro guarda de mí**
**Ajustes → Qué guarda Faro de mí** lo enseña TODO lo de este sitio en una lista,
una línea por cosa y con su medida —el índice, el contexto, la memoria, el perfil
del proyecto, el historial de páginas base, el diario de actividad, las últimas
búsquedas y las páginas base elegidas—, sin enseñar nada de su contenido, más el
espacio que ocupa en el navegador y qué otros sitios tienen datos. Debajo está
**Olvidar este sitio**, que se lo lleva todo de golpe y deja ese sitio como si
Faro no lo hubiera visto nunca. Y para el diario a solas, **Qué mirar hoy →
Borrar mi actividad** borra el de ese sitio (y el del Confluence enlazado, si lo
hay), y esa misma pantalla dice en una línea qué apunta y con qué números
—entradas, análisis, páginas base y «ya lo he visto»—: claves, ids, títulos y
rutas relativas, nunca la URL completa ni el texto de ninguna página, y nunca
llega al modelo. La lista entera, fila por fila, y qué se conserva al reabrir el
panel están en el apartado **«Qué guarda Faro de mí»** de esta guía.

**«El modelo no aceptó la petición» o el turno se queda pensando**
Es el modelo, no Faro. El propio mensaje trae **Elegir otro modelo**, que abre
la pantalla con el que falló a la vista (con su motivo, pero sin marcar: la
marca va al que Faro recomienda) y, al elegir, deja tu pregunta escrita en
el cuadro para que la mandes tú; y además un botón para reintentar con otro
**si hay otro que ya haya contestado bien** (si no, ese no sale, para no
mandarte a ciegas a otro que también falle). Ver la tabla de modelos del README
y la entrada siguiente.

**El modelo que elegí no contesta, o «no está disponible con mi plan»**
opencode lista todos los modelos de los proveedores que tienes conectados, pero
no sabe cuáles permite tu plan: eso sólo lo dice el proveedor al rechazar un
turno («not supported when using Codex with a ChatGPT account», «not available
for integrator opencode», «free tier can only be used from within OpenCode»).
Faro apunta ese rechazo —«Modelo no disponible» en el registro, con el
motivo— y marca el modelo como «· no disponible» en el desplegable durante 7
días (una hora si es de credenciales, un día si no contestó, un cuarto de hora
si fue un 429 o un 5xx). Con GitHub Copilot, el rechazo trae además la lista de
lo que tu plan sí permite, y los que faltan se marcan a la vez; con el nivel
gratuito de opencode se marcan todos sus modelos. Qué hacer: **elige otro
modelo** en la pantalla «Elige el modelo» o en el desplegable (vale para todos
tus sitios). Si pasó al comprobar las claves, Faro no culpa a tus tokens:
vuelve a esa pantalla y, al elegir, repite sólo la comprobación con el modelo
nuevo (si la pantalla taparía algo, el aviso del chat trae **Volver a
comprobar**); si pasó al generar el contexto, el sitio NO se da por
configurado, el aviso trae **Generar el contexto otra vez** y la pantalla, al
elegir, lo vuelve a generar. Si crees que el rechazo ya no es verdad, marca el
modelo y pulsa **Comprobar**: un turno corto (con un proveedor de pago, una
petición) que, si contesta, borra el «no disponible». Si el motivo es *credenciales*, ejecuta
`opencode auth login` y reinicia opencode. Si cambiaste de plan y un modelo
sigue marcado, **Ajustes → Olvidar los veredictos** lo deja probar otra vez.

**Faro me pide elegir modelo cada vez, o no me deja salir de esa pantalla**
Las dos cosas son a propósito. La pantalla sale en cada arranque mientras **tu
modelo tenga un fallo reciente apuntado** (o ya no esté entre los de tu
opencode): el motivo va arriba. Para que deje de salir, elige otro, o marca el
tuyo y pulsa **Comprobar** —si contesta, el fallo deja de valer—, o **Ajustes →
Olvidar los veredictos** si cambiaste de plan. Si eliges a sabiendas uno de «No
disponibles», Faro lo respeta hasta que cierres el panel. Y la pantalla **no
tiene flecha de volver** (ni `Esc` la cierra) la primera vez en un sitio, tras
una comprobación de claves que falló por el modelo y tras un indexado que falló
por el modelo, porque ahí no hay con qué seguir sin elegir: elige uno y
«Usar este modelo», que no cuesta nada. Desde Ajustes o desde un error sí se
sale sin elegir. Si la lista está vacía, tu opencode no tiene ningún proveedor
conectado: `opencode auth login`, reinicia opencode y **Reintentar**.

**Quiero ver qué está pasando por dentro**
El icono de las líneas, en la cabecera del panel, abre el **registro**: cada
llamada a opencode con su resultado y su duración, más el estado actual
(servidor, sitio, página, modelo, sesión, índice, MCP). El botón *Copiar* lo
deja en el portapapeles. Los cuerpos de las peticiones no se guardan nunca:
por ahí pasan tus claves.

El estado actual trae además tres filas de medidas: **«tiempos (arranque)»** y
**«tiempos (último turno)»** repiten las líneas de «Arranque del panel» y
«Respuesta recibida», para poder pegarlas sin buscar en la lista («(sin medir)»
mientras no haya turno). Las dos son del sitio que tienes abierto: al cambiar de
sitio se vacían, porque hablaban del arranque y del turno de otro. Y
**«almacenamiento»** dice cuánto de los 10 MB de `chrome.storage.local` llevan
gastados el índice, el contexto y la memoria de todos tus sitios: en KB por
debajo del mega («512 KB de 10 MB») y en MB con un decimal a partir de ahí
(«8,4 MB de 10 MB»); se pone en rojo a partir de 8 MB, y a partir de ahí conviene
«Descartar índice» en un sitio que ya no uses.

**El panel se ve claro (u oscuro) y yo quería lo otro**
Faro no tiene ajuste de tema: sigue al del sistema, como la propia página de
Jira o Confluence que tienes al lado. Si cambias el tema de Windows (o el de
Chrome), el panel cambia con él; no hace falta recargar la extensión.

**Los textos se ven apagados o los bordes de los campos no se distinguen**
Desde el rediseño los colores del panel están medidos, no elegidos a ojo: todo
el texto llega a 4,5:1 —el número de una lista ordenada incluido, que hasta la
revisión de H4 se quedaba en 3,04— y el borde de un campo, de un botón
fantasma, de una pastilla del redactor o de una tarjeta de elección a 3:1, en
los dos temas y sobre los tres fondos del panel. Si algo se ve peor que eso, es
del tema del sistema o del brillo de la pantalla, no del panel. Quien quiera la tabla con la que se comprueba:
`npm run contrast` la imprime pareja por pareja, y `npm run check` no pasa si
alguna baja de su umbral.

**El panel tarda en abrirse la primera vez tras arrancar opencode**
Ya no debería: era `GET /mcp` —opencode arranca sus servidores MCP en la primera
consulta, y eso tardó **catorce segundos y medio** medido contra un opencode de
verdad—, y el panel la esperaba. Desde esta versión el chat aparece sin esperarla
y la comprobación va en segundo plano; mientras dura, la cabecera dice
«comprobando MCP…». Lo que tarda se apunta en el registro como **«MCP
comprobado»** (ahí verás los segundos la primera vez y milisegundos las
siguientes); en «Arranque del panel» ya no hay fase «MCP» salvo la primera vez
que usas un sitio, que es la única en la que sí se espera. Si aun así el panel
tarda, mira las otras fases de «Arranque del panel»: «health» es si opencode
contesta y «modelos y almacenamiento» la lista de modelos.

**«El modelo no contesta nunca» o «Turno colgado» con un modelo de la lista**
El nivel gratuito de opencode (`opencode/*-free`, y también `big-pickle`) sólo
funciona desde la TUI de opencode: desde `opencode serve` —que es con quien
habla Faro— contesta «OpenCode's free tier can only be used from within
OpenCode» o no contesta nada. Usa un modelo de tu proveedor (por ejemplo
`github-copilot/gpt-5.6-luna`). Comprobado el 2026-09-19.

**En Jira las búsquedas por tipo o por estado no devolvían nada (o daban error)**
Si tu Jira está en español —o en cualquier idioma que no sea inglés—, tanto la
pantalla como su API te dicen «Tarea», «Historia», «En progreso» o «Crítica»…
pero una consulta JQL **no acepta esos nombres traducidos**: `issuetype =
"Tarea"` contesta «El valor 'Tarea' no existe para el campo 'issuetype'» y
`issuetype = Task` devuelve miles. No es un fallo de Faro ni del modelo, es cómo
funciona Jira. Desde esta versión, cuando Faro cuenta tu proyecto se guarda
también **el id** de cada tipo y de cada estado, se lo enseña al modelo al lado
del nombre y le explica que en el JQL va el número; los botones de «búsquedas al
instante» preguntan por ese id y siguen enseñándote el nombre. Los componentes y
las etiquetas los escribió tu equipo, Jira no los traduce, y ésos siguen yendo
por su nombre. **Si acabas de actualizar**, el perfil guardado es de la versión
anterior y se descarta: Faro lo vuelve a contar solo la primera vez que abras ese
Jira (una consulta con tu sesión, no un turno del modelo), y hasta entonces la
Skill Búsqueda va sin el bloque «DATOS DEL PROYECTO» y la lista de **Ajustes →
Qué guarda Faro de mí** dice «(nada)» en la fila del perfil. Si no se recuenta,
es que falta el permiso sobre ese dominio: vuelve a generar el contexto con
**Reconstruir el contexto**, en Ajustes.

**En mi Confluence Data Center no había «Paso a paso» ni «Árbol leído de la página»**
Arreglado. El árbol de páginas de un Confluence 9 (Server o Data Center) no lleva
ninguna de las señales por las que Faro lo buscaba —no es un `<aside>`, no tiene
`role="tree"` y no tiene ni un `data-testid`—, así que no lo encontraba y
**Ajustes → Diagnóstico del árbol** contestaba «(ninguno) — sin contenedor no hay
recorrido posible». Ahora reconoce también el pagetree clásico
(`.plugin_pagetree`). Si vuelve a pasar en otra versión de Confluence, ese mismo
diagnóstico es lo que hay que mirar: dice qué contenedor eligió, cuántas filas y
cuántos controles encontró, y lo deja copiado.

**El mapa del espacio no tiene la página que yo estaba mirando**
Un espacio de verdad tiene miles de páginas —2 697 en el que se probó— y el mapa
cabe unos cientos. Antes se leían **las más antiguas**, porque es lo que la API de
Confluence devuelve por defecto, así que el mapa podía no contener nada de lo que
usas. Ahora se leen **las que se han movido más recientemente, cada una con su
rama entera hasta la raíz**, y el registro dice «N de M» para que se vea que viene
recortado. Si tu Confluence no sabe hacer esa consulta ordenada, Faro se lo dice
en el registro («por la lista, sin ordenar por fecha») y lee la lista de siempre.
Lo que quede fuera se completa con el uso: cada vez que Faro te lleva a una
página, aprende su rama.

**He entrado en otro espacio y no me lleva a ninguna página**
Desde H21 el mapa es de cada espacio: el de SIMPL no sirve para llevarte por el
árbol de DCPIAS. Al entrar en un espacio sin mapa, el chat vacío lo dice
(«DCPIAS» aún no tiene mapa) con un botón **Construir**, y si le pides que te
lleve a una página de ese espacio, bajo la respuesta sale la tarjeta «Me falta
el mapa de este espacio» (en el registro, «Sin navegación · este espacio no
tiene mapa»). Pulsa Construir: son un par de minutos y se hace una vez por
espacio. Lo que SÍ sigue funcionando sin construir nada es ir a una página de
un espacio que ya tiene mapa, desde cualquier otro: el paso a paso empieza por
abrir ese espacio. No se abre sola la pantalla de contexto, a propósito: el
sitio ya está configurado, y un espacio nuevo no tiene por qué interrumpirte.

**«El mapa de este sitio ya tiene N páginas…» (el mapa está lleno)**
Construir el mapa de un espacio más se para si los demás espacios ya tienen
cerca de 1 500 páginas —cinco espacios de 300—, porque Faro reescribe el mapa
entero en el navegador en cada turno que lo amplía. Al pedir el
mapa de un espacio más, si podría pasarse, Faro no lee nada ni borra ningún
espacio por su cuenta: te avisa («Mapa lleno» en el registro). Abre **Ajustes →
Mapas y contextos de este sitio**, pulsa **Olvidar el mapa** en el espacio que
ya no uses (se lleva sus páginas del mapa y su contexto, y nada más) y vuelve a
pulsar Construir. Sólo cuentan las páginas de los OTROS espacios —lo que
«Olvidar el mapa» puede liberar—: las que Faro aprendió sin saber de qué espacio
eran no cuentan, y al reconstruir el mapa de un espacio que YA está sus páginas
tampoco (se cuenta lo de los demás más lo que un espacio puede traer, 300). Por
eso el mapa entero puede pasar de 1 500 con lo que se aprende de la barra
lateral y de las respuestas: el tope es una puerta al construir, no un límite
del mapa.

**Sólo me ofrece «Llévame», nunca «Paso a paso»**
Lo primero: **Ajustes → Cómo te lleva Faro** tiene que estar en *Guiada*. En
*Rápida* la tarjeta sólo ofrece «Llévame», a propósito.

Para enseñar el camino hace falta saber quién es la página padre del destino: el
recorrido ES su rama del árbol, no un camino que se invente el modelo. Faro la
lee de la API REST del propio Confluence, con tu sesión, en cuanto sabe el
destino; en el **registro** aparece como «Camino leído de Confluence» con la
duración. Si en su lugar ves «Sin camino», el motivo va al lado:

- *sin acceso a la pestaña*: falta el permiso del dominio o el content script
  no está cargado. Es el mismo permiso que necesita el propio «Paso a paso».
- *la API respondió 401 o 403*: tu sesión de Confluence no vale para su API.
  Recarga la página y vuelve a entrar.
- *la respuesta no es JSON*: el sitio ha devuelto una página de login o un
  proxy se ha puesto en medio.
- *la API respondió 404*: la página del índice ya no existe con ese id.

En cualquiera de esos casos Faro no inventa nada: te lleva de golpe. Y cada
respuesta aprovecha, además, para leer del DOM la parte del árbol que esté
desplegada.

**Pulso «Paso a paso» y no pasa nada**
Faro necesita permiso sobre el dominio para poder actuar dentro de la página.
En `*.atlassian.net` lo tiene de fábrica; en un Confluence propio hay que
concederlo. Aparece una tarjeta pidiéndolo la primera vez que hace falta. Si la
cerraste, vuelve a pedir navegación y saldrá otra vez. En el **registro** se ve
como «Asistida bloqueada · falta permiso».

**Quiero que vaya más despacio (o más rápido)**
**Ajustes → Pausa entre pasos**, de 0,4 s a 4 s. Por defecto son 1,6 s. Ese
mismo valor rige la barra de progreso de cada cartel, así que sabes cuánto
queda. Con *Reducir animaciones* marcado se quitan los desplazamientos suaves y
quedan sólo fundidos.

**Una rama del árbol no se despliega sola**
Faro pulsa el control de desplegar y **comprueba** que la rama se abrió; si no
reacciona, prueba con el teclado (flecha derecha, como manda ARIA). Lo que
nunca pulsa es un disparador de menú (`aria-haspopup`, o `aria-controls` hacia
un `role="menu"`): el «···» de una fila abre un menú, no una rama, y el
barrido lo salta aunque lleve `aria-expanded="false"`. Y un Escape a mitad
del paso —durante el barrido, mientras se abre la rama o mientras destella una
que ya estaba abierta— acaba el paso como cancelado: no ofrece «Llévame», no
navega solo y Faro no lanza el paso siguiente.
Si aun así
no se abre, ve a **Ajustes → Diagnóstico del árbol**: lee la barra lateral de
esa pestaña y apunta en el registro qué contenedor, qué filas y qué controles ha
encontrado, además de dejarlo copiado. Con eso se ajusta
`src/content/tree-dom.js`, que es el único sitio donde se decide qué forma
tiene el árbol.

**La navegación asistida se salta pasos**
Es lo previsto. Si una rama intermedia no aparece en 2,5 s, se salta y el
recorrido sigue; sólo el **destino** ofrece el salto directo cuando no hay forma
de llegar pulsando. Se hace así a propósito: navegar por URL a mitad de camino
recarga la página, y eso pliega el árbol entero y deja sin base a los pasos que
faltaban.

Si pasa siempre en el mismo sitio, Atlassian habrá cambiado ese trozo de
interfaz: mira el **Diagnóstico del árbol** y revisa `src/content/tree-dom.js`;
los localizadores de paso están en `src/content/locators.js`, y la estrategia por
`href` es la que hay que mirar primero.

**El análisis no me subraya nada**
Faro te dirá por qué, debajo de la respuesta. Los motivos, por frecuencia:

1. **Falta el permiso del dominio.** Es lo normal en un Confluence propio:
   marcar la página es tocarla, y eso necesita el mismo permiso que la
   navegación paso a paso. Sale una tarjeta con **Dar permiso**; concédelo y
   vuelve a pedir el análisis. Si el diálogo no llega a aparecer,
   `chrome://extensions` → Faro → Detalles → Acceso al sitio → «En sitios
   específicos» → añade tu dominio.
2. **El modelo no ha numerado como se le pide.** Ya no es motivo para no
   marcar: si numeró a su manera —una lista «1.», «**1.**», «Observación 1:»,
   encabezados «### 1.», o la respuesta entera dentro de un bloque de código—
   Faro lo reescribe como `[1]`, `[2]`… en el propio chat («Numeración
   adaptada» en el registro); si la prosa no lleva números pero el bloque JSON
   de anclas sí, valen los del JSON («Numeración del JSON»); si no hay números
   en ningún sitio, se le pide aparte que trocee su respuesta en observaciones
   y las sitúe («Pasada que trocea»), y los números aparecen en el chat
   después. Sólo si tampoco así sale un aviso con el botón **Pedirlo
   numerado**, que repite la misma pregunta con el formato por delante. Y si el
   modelo cierra con «Sin observaciones.», es que no encontró nada que decir:
   se dice en neutro y no hay nada que subrayar. Una respuesta muy corta o con
   una consulta fallida («no he podido leer la incidencia») no se trocea: no
   es un análisis, y el aviso ofrece pedirlo de nuevo.
3. **No se ha podido leer la página en bloques.** Casi siempre es que la
   pestaña se cargó antes que la versión nueva de la extensión: recárgala. Si
   estás en el editor, Faro no lee ni marca nada a propósito. En el registro
   sale «Página sin bloques» con la razón, y debajo de la pregunta no aparece
   «con el texto de la página».
4. **El modelo no ha señalado ningún bloque.** Numera, pero cierra sin el
   bloque JSON —o con bloques que no existen—. Faro lo pide aparte en una
   segunda pasada («Sin bloque de anclas» en el registro); si tampoco así,
   cambia de modelo.
5. **La Skill no es Análisis.** En General no se marca nada.

En el **registro** queda lo mismo, con más detalle: «Sin marcas» con la razón, o
«Sin anclar» con los números que no se pudieron situar; «Numeración adaptada»,
«Numeración del JSON» y «Pasada que trocea» cuentan cómo se recuperó una
respuesta que no venía numerada. «Análisis marcado» dice,
de cada número, cómo se resolvió: `block+quote` es la cita dentro de su bloque,
`block+whole` el bloque entero, `block-moved` que el número no coincidía pero
el texto sí, y `global` que el bloque ya no estaba y la cita se buscó en toda
la página.

**En Jira el análisis no sabía en qué estado estaba la incidencia, o decía que un campo valía «Ninguno»**
Las dos cosas están arregladas, y las dos salieron de probar Faro contra un Jira
Data Center de verdad. El **estado**: en ese Jira no aparece en la lista de
detalles ni como pastilla en la cabecera —está sólo en el botón de transiciones,
el que abre el menú de «mover a…»—, así que Faro lo leía vacío y el análisis se
quedaba sin saber si la incidencia estaba por empezar, en revisión o cerrada. Ahora
lo lee de ahí, y del **nombre entero**: el texto que se ve en ese botón lo recorta
Jira («DevTeam PBI is ready f...») y el nombre completo está en su tooltip. De paso
lee la **categoría** del estado (nueva / en curso / cerrada), que es lo único que
no depende de cómo haya llamado tu equipo a sus estados: con nombres como «FOR SC
TO RESPOND» o «PBI INTERNAL QA», el nombre no dice nada y la categoría sí. Y
«Ninguno»: un campo vacío se pinta como texto («Ninguno», «None»), y Faro lo
tomaba por un valor, así que el prompt decía componentes «Ninguno» y el botón
«Mismo componente «Ninguno»» era un error de Jira. Ahora esos marcadores no
cuentan como valor; «Sin asignar» y «Sin resolver» sí, que son información.

**En Jira el análisis habla de botones o de la barra lateral**
La incidencia se lee por sus módulos —título, campos, descripción, comentarios—
y la interfaz queda fuera; si algo de la interfaz se cuela en los bloques, es
que tu Jira pinta la vista de otra forma (Cloud no está comprobado; Data Center
9 sí). Con la Skill Análisis puesta, mira en el **registro** «Turno enviado ·
página en N bloques» y, en el banco de pruebas, el botón «Jira: la incidencia
en bloques» enseña qué sale; lo que hay que ajustar está en
`src/content/jira-issue.js`, el único sitio donde se decide qué es una
incidencia en pantalla. Mientras tanto, el análisis funciona igual: sólo hay
más texto del que hace falta.

**Algunas observaciones salen en gris, sin marca**
Son las que no apuntan a ningún bloque de la página: hablan de ella en general,
o de algo que cae fuera de los bloques que se le enseñaron al modelo (la página
se recorta a 30.000 caracteres o 400 bloques, y lo que hay dentro de un iframe
o de una rama plegada no se ve). Se dejan sin marcar a propósito: subrayar el
párrafo de al lado sería peor que no subrayar nada.

**Una fila dice «bloque entero» o «aproximada»**
La cita del modelo no estaba tal cual en el bloque que señaló —la parafraseó, o
la página cambió—, así que se marca el bloque entero, que es lo que él señaló;
o se encontró por aproximación. La fila lo dice para que no pase por exacta.

**Pulso [2] y la marca está, pero la página no se mueve**
Pasaba en la vista de incidencia de un Jira Data Center: ahí el que hace
scroll es un panel interno, no la ventana, y Faro sólo movía la ventana. Ahora
al ir a una observación se desplazan primero los contenedores con scroll
propio que la envuelven y después la ventana, como ya hacía la navegación por
el árbol. Si aun así no se mueve, recarga la pestaña: el content script que
tiene cargado es anterior a este cambio.

**Pulso [2] y dice que esa marca ya no está**
Las marcas viven en la página donde se hicieron. Si has navegado, recargado o
empezado una sesión nueva, se van con ella (también si Jira repintó el bloque
y el texto sólo queda en una pestaña oculta: ir a una marca exige que tenga
una caja visible, igual que al ponerla). Al volver a abrir el panel, la
tarjeta del último análisis sale atenuada con **Volver a marcar en esta
página**: si sigues en la misma página, la vuelve a subrayar; si no, te lo
dice y no toca nada. Si no, vuelve a pedir el análisis.

**No quiero que oscurezca la página entera**
**Ajustes → Cómo te señala Faro → Subrayado**. En ese modo no se oscurece nada:
el texto se marca en amarillo y las imágenes quedan rodeadas por un filete muy
fino. El otro modo, *Foco*, es el de siempre.

Ese ajuste gobierna los **pasos** del recorrido. Al **llegar** al destino nunca
se oscurece: el foco sirve para enseñarte dónde va el siguiente clic, y una vez
estás delante de lo que buscabas sólo taparía lo que has venido a leer.

**Pulso el rotulador y no pasa nada**
Como la navegación paso a paso, señalar en la página necesita permiso sobre el
dominio y que el content script esté cargado. Si acabas de conceder el permiso,
recarga la pestaña. En `*.atlassian.net` funciona de fábrica.

**Señalé una imagen y dice «sin adjuntar»**
La imagen está servida desde otro origen, así que el navegador no deja
exportarla del `canvas`. Se manda igualmente su texto alternativo, el pie de
figura y lo que hay escrito alrededor; lo que no viaja es la imagen.

**Pedí un resumen y no aparece la tarjeta para llevarme**
Es lo previsto: las Skills *Resumen* y *Análisis* trabajan sobre lo que ya
tienes delante y no ofrecen viaje. Cambia a *General* o *Búsqueda*.

**El buscador de páginas base no encuentra nada**
Por orden de probabilidad:

1. **Falta el permiso del dominio.** Sin él sólo se busca en el índice del
   sitio, y la pantalla lo dice con un botón **Dar permiso**. En
   `*.atlassian.net` viene de fábrica. Desde un **Jira Data Center** el
   permiso que hace falta es el del **Confluence enlazado** (es a él a quien
   se le pregunta, desde el panel y con tu sesión): la pantalla lo nombra y
   lo pide. Si al buscar dice que tu sesión de ese host no vale para su API,
   ábrelo en otra pestaña, entra, y vuelve a intentarlo.
2. **No hay índice.** Si además el sitio no tiene contexto construido, no hay
   dónde buscar hasta que Confluence conteste: pega la URL de la página, que
   siempre vale.
3. **Tu sesión no vale para la API.** Si la pantalla dice que recargues la
   pestaña, es que Confluence contestó con una página de login o un 401: entra
   de nuevo y repite. En el **registro** sale como «Búsqueda de páginas» con el
   motivo.
4. **Es una palabra a medias en mitad del título.** La API busca por
   palabras: «Arqui» encuentra «Arquitectura» (el último término lleva
   comodín), pero «quitec» no. Escribe el principio de una palabra.

Una URL de otro sitio, una incidencia de Jira o una dirección sin id no valen
como página base, y la pantalla explica cuál de las tres es.

**El análisis consultó páginas que no le pedí**
Con el alcance *Sólo estas*, Faro se lo pide al modelo en el prompt, pero no
puede impedírselo: opencode convierte cualquier límite de herramientas en un
permiso permanente de la sesión. Por eso, al terminar, mira qué herramientas
llamó el modelo y, si buscó, recorrió el árbol o leyó una página fuera de la
lista, lo dice bajo la respuesta y en el registro («Fuera del alcance», con lo
que consultó). Con otro modelo suele respetarse mejor.

**No me sugiere ninguna página base**
La sección «Sugeridas» de esa pantalla sólo propone lo que puede explicar, y
cada motivo necesita algo distinto. Si sale vacía: (1) mira el registro —«Enlaces
de la página» dice cuántos enlaces se leyeron y cuántos eran de Confluence; si
sale en amarillo, la pestaña no contestó (recarga la página y vuelve a abrir la
pantalla)—; (2) si esta página o esta incidencia no enlaza ninguna página de
Confluence **en su contenido**, ahí no hay nada que leer: los enlaces de la
barra de acciones y de los menús no cuentan a propósito; (3) el contexto del
sitio sólo aporta páginas que nombre **con su id numérico**, y los contextos
generados hace tiempo casi nunca lo llevan (vuelve a generarlo desde Ajustes);
(4) el historial empieza vacío: se llena solo, un análisis con páginas base cada
vez, y en Confluence sólo distingue «la usaste en esta página». Y si la página
está abierta en el **editor**, la fuente de los enlaces no funciona mientras
editas, igual que no se puede leer la página en bloques.

**Una página sugerida se llamaba «Page», o como una dirección web**
Arreglado, y las dos cosas salieron de probarlo en un Jira de verdad. El título
que Jira guarda en un enlace remoto a Confluence es, en todos los que se vieron,
literalmente «Page»: el nombre del TIPO de enlace, no el de la página. Y en las
descripciones los enlaces se pegan tal cual, así que el texto del enlace ES la
dirección entera. Ahora Faro elige el título por orden de fiabilidad —el que leyó
del propio Confluence, el que se ve en la página, el que guardó Jira, el que lleva
la propia dirección— y descarta los que no nombran nada; si no puede saberlo, la
fila dice «Página 12345» y al añadirla lo pregunta por su id, que es justo lo que
hacía falta.

**Las páginas base no se han podido leer**
Este sitio no tiene el MCP conectado, así que el modelo no llega a ellas y el
análisis sale sólo de la página abierta. Configúralo en **Ajustes → Cambiar las
claves**. La pantalla de páginas base lo avisa antes, y la respuesta después. Ese
aviso puede tardar un segundo en aparecer: la comprobación del MCP ya no bloquea
nada, así que la pantalla se abre antes de saberlo y decir «no hay MCP» sin
saberlo sería peor.

**No se resalta nada**
Comprueba que no estás en el editor de Confluence: ahí Faro se aparta a
propósito para no interferir con el estado del editor.
