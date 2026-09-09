# Instalación paso a paso

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

1. `chrome://extensions`
2. Activa **Modo desarrollador**
3. **Cargar descomprimida** → selecciona esta carpeta
4. Comprueba que el identificador que muestra Chrome coincide con el de arriba

No hay paso de compilación: son módulos ES que Chrome carga tal cual.

## 3. Claves de Atlassian

Jira y Confluence son dos productos, y cada uno lleva **su dirección y su
token**. Un solo servidor MCP sirve a los dos.

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
   URL del sitio, una incidencia o una página: Faro se queda con el sitio, y
   conserva una ruta de contexto si la hay (`/jira`, `/confluence`, `/wiki`).
   En Data Center marca la casilla: se usan los tokens personales y no hace
   falta correo.

Faro construye entonces el bloque de configuración y te lo deja copiado. Con
el MCP conectado comprueba **los dos tokens**, uno detrás de otro, y lo dice.

Si Jira y Confluence viven en **hosts distintos**, el otro host queda
**enlazado** a éste: comparte el MCP —no se levanta un segundo proceso con el
mismo token— y al abrirlo no se vuelven a pedir claves. En el registro sale
como «Sitio enlazado». Y desde ese Jira, el contexto del Confluence enlazado
(su `CONTEXT.md`, si lo construiste) va en cada pregunta: sirve para saber
qué páginas mirar, y en el registro sale como «Contexto de Confluence
enlazado», con el host y su tamaño.

### Por qué hay un paso manual

opencode 1.2.25 **sólo carga los servidores MCP al arrancar**. Su endpoint para
registrarlos en caliente responde `200` pero no hace nada: ni escribe
configuración, ni expone herramientas, ni aparece luego en `GET /mcp`.
Comprobado contra un servidor real.

Así que Faro te enseña exactamente qué pegar y dónde:

```
C:\Users\marco\.config\opencode\opencode.json
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "atlassian-confluence-simplprogramme-eu": {
      "type": "local",
      "command": ["uvx", "mcp-atlassian"],
      "environment": {
        "CONFLUENCE_URL": "https://confluence.simplprogramme.eu",
        "CONFLUENCE_PERSONAL_TOKEN": "...",
        "READ_ONLY_MODE": "true"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

Si el fichero ya existe, el panel tiene un botón para copiar **sólo el bloque
`mcp`** y que lo fusiones tú.

Después **reinicia opencode**. Faro está mirando: en cuanto ve el MCP conectado,
comprueba el token y sigue solo. No tienes que volver a pulsar nada.

La primera vez, `uvx` descarga `mcp-atlassian` (unos 107 paquetes) y el proceso
tarda **unos diez segundos** en arrancar y exponer sus herramientas. Es normal
que el panel espere un poco.

Las claves acaban en la configuración de opencode, en disco, protegidas por los
permisos del sistema de ficheros. La extensión sólo recuerda que ese host ya
está configurado.

### Server / Data Center

Además de los tokens personales, ten en cuenta que el wiki cuelga de la raíz
en lugar de `/wiki` (Faro no lo añade: usa la dirección tal como la escribas),
y que Chrome pedirá permiso para cada dominio la primera vez porque no están
en el manifest. Si tu Confluence o tu Jira usan un certificado interno, añade
`"CONFLUENCE_SSL_VERIFY": "false"` o `"JIRA_SSL_VERIFY": "false"` al bloque
`environment`.

## 4. Contexto

Al entrar por primera vez en un sitio, Faro ofrece tres caminos:

- **Que lo genere Faro** — en Confluence recorre el árbol del espacio, con
  tope de páginas y profundidad; en un proyecto de **Jira** recorre los tipos
  de incidencia, cuenta los estados del flujo en una muestra de tickets
  recientes y deduce las **convenciones de nombre** de los resúmenes (los
  prefijos y separadores tipo «[Backend][Update] …» o «PSO | …»), con ejemplos
  literales; y si el proyecto tiene un Confluence enlazado, busca ahí si todo
  eso está documentado y apunta las páginas. Progreso visible y botón de
  cancelar. Produce el documento de contexto y el índice de navegación.
- **Traigo el mío** — un `.md` que ya tengas escrito. El índice se construye
  igualmente en segundo plano, porque sin él no hay navegación.
- **Empezar sin contexto** — el chat funciona igual vía MCP. Puedes indexar
  después desde ajustes.

El índice se enriquece solo: cada vez que una consulta descubre una página que
no estaba, se añade. Sin coste, porque sale de lo que ya devolvieron las
herramientas MCP.

## 5. Memoria

- **Dentro de la sesión** funciona siempre: una sesión de opencode es un hilo
  con historial.
- **Entre sesiones** es opcional. Con el interruptor activo, al pulsar «nueva
  sesión» se resume la anterior y el resumen queda disponible para las
  siguientes. La pantalla de memoria te deja leerlo y borrar entradas sueltas.

## 6. La barra de abajo

Junto al selector de modelo hay otras dos cosas:

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
  poner `issuetype`, `status` o un prefijo del resumen—, te dice qué JQL ha
  usado para que puedas afinarla, y nombra cada incidencia por su clave y su
  resumen. La tarjeta de abajo ofrece **«Abrir la búsqueda en Jira»**: te
  lleva al buscador con esa consulta y la lista entera. La consulta no se lee
  de lo que el modelo escribe, sino de la llamada real que hizo a
  `jira_search` (la última que devolvió resultados): un modelo que escribe
  una JQL en su respuesta y busca con otra no puede mandarte a una lista que
  no ha visto. Si no buscó nada y nombra una sola incidencia, la tarjeta abre
  esa incidencia: el proyecto no es un paso intermedio, sería otra carga de
  página. Y la incidencia que ya tienes abierta nunca es el destino.

  El modo **Análisis** hace además una cosa más: numera sus observaciones y
  subraya en la página el pasaje del que habla cada una, con su número detrás.
  En el chat aparece la lista; al pulsar una fila, la página salta a su marca y
  la destaca. Al revés también: pulsar el número en la página marca su fila en
  el chat. Y dentro del propio texto de la respuesta, cada `[2]` es pulsable.

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
  entero, un campo. Las **páginas base** desde Jira son páginas del Confluence
  enlazado: se eligen de su índice, o pegando su URL o su id; desde un Jira
  Data Center no se puede buscar en la API de Confluence, y la pantalla lo
  dice. En el alcance *Sólo estas*, leer la propia incidencia por el MCP (sus
  comentarios plegados, su historial) no cuenta como salirse.

  La elección se recuerda por sitio, igual que el modelo.

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
  que la navegación paso a paso.

## 7. Guiada o rápida

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

---

## Problemas frecuentes

**«opencode no responde»**
El servidor no está arrancado, o el puerto de los ajustes no coincide. El panel
te muestra el comando exacto, con el `--cors` ya relleno.

**Responde 401**
La contraseña del panel no coincide con `OPENCODE_SERVER_PASSWORD`. Se manda
como `Authorization: Basic base64("opencode:" + contraseña)`.

**El chat funciona pero no sabe nada de Jira o Confluence**
El MCP no conectó. Comprueba, en este orden:
1. Que el bloque está en `opencode.json` y el JSON es válido.
2. Que **reiniciaste** opencode después de pegarlo.
3. `curl -u opencode:TU_CONTRASENA http://127.0.0.1:4096/mcp` debe responder
   `{"atlassian-...":{"status":"connected"}}`.
4. Que `uvx` está en el PATH del proceso que arrancó opencode.

**«El modelo no tenía ninguna herramienta del MCP disponible»**
Es lo que sale cuando se pregunta antes de que el MCP haya terminado de
arrancar. No es culpa del token: espera y reintenta desde ajustes.

**Dice «Jira: …» o «Confluence: …» y no sigue**
Son dos tokens y se comprueban los dos; el resultado queda en el registro como
«MCP verificado», con una línea por producto. El que falla se dice con su nombre:
revisa ese, no el otro. En Data Center, comprueba además que la dirección de
ese producto es la suya (`https://jira.…`, no la de Confluence).

**Abro el Jira de mi Confluence (u otro host) y me vuelve a pedir claves**
Sólo pasa si configuraste un solo producto. Para enlazar los dos hosts hay que
darlos juntos en la misma pantalla de claves: entonces el segundo host queda
apuntando al mismo MCP («Sitio enlazado» en el registro) y no pide nada. Si ya
lo hiciste por separado, tienes dos MCP con el mismo token: funciona, pero es
un proceso de más. Desde **Ajustes → Cambiar las claves** puedes rehacerlo con
los dos productos.

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

**«El modelo no aceptó la petición» o el turno se queda pensando**
Es el modelo, no Faro. Cambia de modelo en el desplegable: el propio mensaje
trae un botón para reintentar con otro proveedor. Ver la tabla de modelos del
README.

**Quiero ver qué está pasando por dentro**
El icono de las líneas, en la cabecera del panel, abre el **registro**: cada
llamada a opencode con su resultado y su duración, más el estado actual
(servidor, sitio, página, modelo, sesión, índice, MCP). El botón *Copiar* lo
deja en el portapapeles. Los cuerpos de las peticiones no se guardan nunca:
por ahí pasan tus claves.

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
reacciona, prueba con el teclado (flecha derecha, como manda ARIA). Si aun así
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
2. **El modelo no ha numerado sus observaciones.** Sin `[1]`, `[2]`… no hay nada
   que anclar. Pasa con los modelos pequeños; cambia de modelo.
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
«Sin anclar» con los números que no se pudieron situar. «Análisis marcado» dice,
de cada número, cómo se resolvió: `block+quote` es la cita dentro de su bloque,
`block+whole` el bloque entero, `block-moved` que el número no coincidía pero
el texto sí, y `global` que el bloque ya no estaba y la cita se buscó en toda
la página.

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

**Pulso [2] y dice que esa marca ya no está**
Las marcas viven en la página donde se hicieron. Si has navegado, recargado o
empezado una sesión nueva, se van con ella. Al volver a abrir el panel, la
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
   `*.atlassian.net` viene de fábrica.
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

**Las páginas base no se han podido leer**
Este sitio no tiene el MCP conectado, así que el modelo no llega a ellas y el
análisis sale sólo de la página abierta. Configúralo en **Ajustes → Cambiar las
claves**. La pantalla de páginas base lo avisa antes, y la respuesta después.

**No se resalta nada**
Comprueba que no estás en el editor de Confluence: ahí Faro se aparta a
propósito para no interferir con el estado del editor.
