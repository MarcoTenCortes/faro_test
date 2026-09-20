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
   URL del sitio, una incidencia, una página o el enlace corto de «Compartir»
   (`…/x/AbCd`): Faro se queda con el sitio, y conserva una ruta de contexto
   si la hay (`/jira`, `/confluence`, `/wiki`).
   En Data Center marca la casilla: se usan los tokens personales y no hace
   falta correo.

Faro construye entonces el bloque de configuración y te lo deja copiado. Con
el MCP conectado comprueba **los dos tokens**, uno detrás de otro, y lo dice.

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
    remoto trae su id: el título nunca se manda a ninguna API.
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
  sitio»** vive en su propia pantalla. Se aplica al momento.

- **Teclado y lector de pantalla** — `Esc` cierra Ajustes, Memoria, Registro,
  Páginas base (donde primero vacía las sugerencias) y Qué mirar hoy y cancela el
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
  cuanto esa página o esa incidencia cambie**, porque lo que se recuerda es cómo
  estaba cuando la descartaste.

Abajo del todo de la pantalla: **«No sugerir nada en este sitio»** (una casilla,
por sitio), **Actualizar**, **Borrar mi actividad** y una línea que dice qué se
guarda y dónde, con los números.

### Qué guarda tu diario, y dónde

Para poder decirte qué ha cambiado *desde que lo miraste*, Faro apunta en el
almacenamiento de tu navegador —**local, por sitio, nunca en ningún servidor**—
la clave de la incidencia o el id de la página, su **título**, su **ruta
relativa** dentro del sitio, cuándo la viste y cuántas veces, cuándo la
analizaste y con cuántas observaciones, si la usaste como página base y de qué
**tipo** era la incidencia. **No** guarda la URL completa, ni nada de lo que
venga detrás de un «?» o de un «#», ni el texto de ninguna página, ni una
palabra de lo que escribes. Trescientas entradas por sitio y **treinta días**;
lo más viejo se cae solo. Sólo se apunta de los sitios que has configurado, y
sólo con las dos casillas encendidas.

**Nada de eso llega nunca al modelo**: no entra en ningún prompt. Se borra con
**Borrar mi actividad**, y **Ajustes → Olvidar este sitio** se lo lleva junto con
el resto.

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

## 8. Guiada o rápida

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

## 9. Herramientas de desarrollo

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
«CLAUDE.md §10 (línea L): «x.test.js» dice N pruebas y registra M», pon M en
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

### El banco de pruebas

`npm run harness` levanta en <http://127.0.0.1:5175> una Confluence y un Jira de
mentira con las piezas reales encima. El botón **Autocomprobación completa**
recorre hoy **59 tramos numerados (111 comprobaciones)**; hay que correrla con el panel del navegador a
la vista y a 1280×900, porque con la ventana oculta Chrome estrangula los
temporizadores y no ejecuta los fotogramas.

Los cuatro últimos (56-59) son **«Qué mirar hoy»**, y tampoco navegan: que la
página de mentira lleve su id en una etiqueta `meta` y que de una URL se saque
la ruta **sin la parte de detrás del «?» ni del «#»**; que dos avisos de la
misma navegación cuenten una sola visita y que apuntar un análisis no toque lo
que se apuntó al verla; las siete consultas contra la Jira y la Confluence de
mentira, de las que salen veintidós candidatos y una lista de ocho que es
**exactamente la misma dos veces seguidas**, con sus motivos escritos; que lo
que tienes abierto no aparezca en la lista y que lo descartado vuelva en cuanto
cambia; y que con la sesión caducada las cuatro consultas de Jira fallen, no se
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
  pedidas a la vez, así que la fase mide lo que tarde la más lenta), «MCP» (las
  dos consultas a opencode: `GET /mcp` y `GET /config`), «enlazado» (adoptar el
  MCP si hacía falta y, desde Jira, leer lo del Confluence enlazado —contexto,
  índice y prefijo del wiki, también en una sola lectura—, que es otro sitio y
  no cabe en lo del propio) y «restaurar» (repintar la conversación).
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
- «MCP verificado» — los tokens se comprobaron, con una línea por producto
  («Jira: … · Confluence: …»).
- «Sitio enlazado» — el otro host (Jira o Confluence) comparte el MCP de
  éste y no pedirá claves.
- «Espera del MCP cancelada» — estabas en el paso manual del MCP (pegar el
  bloque y reiniciar opencode) y has cambiado a OTRO sitio de Atlassian antes
  de que opencode lo cargara: la espera se corta; al volver se vuelve a pedir,
  o el MCP ya conectado se reconoce solo. Pasar a una pestaña fuera de
  Atlassian no la corta.
- «Contexto de Confluence enlazado» — desde Jira, se cargó el contexto del
  Confluence enlazado: host, caracteres y si tiene índice.
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
- «Modelo cambiado» — elegiste otro modelo; se recuerda para el sitio.
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
  razón).
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
  entradas tiene el índice, cuántas peticiones hicieron falta, «recortado en N»
  si el espacio es más grande que el tope, y los milisegundos. Ni un token.
- «Perfil del proyecto» — se contó una muestra del proyecto de tu Jira (Data
  Center) para saber los nombres exactos de tipos, estados, componentes,
  etiquetas y convenciones: de cuántas incidencias era la muestra y cuántos
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
«CLAUDE.md §10 (línea L): «x.test.js» dice N pruebas y registra M» → pon M en
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
módulos con `use_dynamic_url` (desde Chrome 130 la URL cambia en cada sesión,
para que ninguna web pueda detectar la extensión) y los pide siempre con
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

**Quiero borrar lo que Faro sabe de lo que miro**
**Qué mirar hoy → Borrar mi actividad** borra el diario de ese sitio (y el del
Confluence enlazado, si lo hay). **Ajustes → Olvidar este sitio** se lo lleva
junto con el índice, el contexto y la memoria. Lo que se guarda está escrito en
una línea al pie de esa misma pantalla, con los números: claves, ids, títulos y
rutas relativas, nunca la URL completa ni el texto de ninguna página, y nunca
llega al modelo.

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
Es `GET /mcp`: opencode arranca sus servidores MCP en la primera consulta, y el
panel la espera. Mira «Arranque del panel» en el registro: si «MCP» dice
segundos y el resto milisegundos, es eso. La segunda vez baja a milisegundos.

**«El modelo no contesta nunca» o «Turno colgado» con un modelo de la lista**
El nivel gratuito de opencode (`opencode/*-free`, y también `big-pickle`) sólo
funciona desde la TUI de opencode: desde `opencode serve` —que es con quien
habla Faro— contesta «OpenCode's free tier can only be used from within
OpenCode» o no contesta nada. Usa un modelo de tu proveedor (por ejemplo
`github-copilot/gpt-5.6-luna`). Comprobado el 2026-09-19.

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

**Las páginas base no se han podido leer**
Este sitio no tiene el MCP conectado, así que el modelo no llega a ellas y el
análisis sale sólo de la página abierta. Configúralo en **Ajustes → Cambiar las
claves**. La pantalla de páginas base lo avisa antes, y la respuesta después.

**No se resalta nada**
Comprueba que no estás en el editor de Confluence: ahí Faro se aparta a
propósito para no interferir con el estado del editor.
