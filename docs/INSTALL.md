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

1. Consigue un token:
   - **Cloud** -> [id.atlassian.com -> Security -> API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Server / Data Center** -> tu perfil -> *Personal Access Tokens*
2. Abre Jira o Confluence, pulsa el icono de Faro y pega el correo y el token.
   En Data Center marca la casilla: se usa el token personal y no hace falta correo.

Faro construye entonces el bloque de configuración y te lo deja copiado.

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

Además del token personal, ten en cuenta que el wiki cuelga de la raíz en lugar
de `/wiki`, y que Chrome pedirá permiso para ese dominio la primera vez porque
no está en el manifest. Si tu Confluence usa un certificado interno, añade
`"CONFLUENCE_SSL_VERIFY": "false"` al bloque `environment`.

## 4. Contexto

Al entrar por primera vez en un sitio, Faro ofrece tres caminos:

- **Que lo genere Faro** — recorre el árbol del espacio o el proyecto, con tope
  de páginas y profundidad, progreso visible y botón de cancelar. Produce el
  documento de contexto y el índice de navegación.
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

  La elección se recuerda por sitio, igual que el modelo.

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

**No se resalta nada**
Comprueba que no estás en el editor de Confluence: ahí Faro se aparta a
propósito para no interferir con el estado del editor.
