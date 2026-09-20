# Faro

Extensión de Chrome que convierte tu **opencode local** en un copiloto dentro
de Jira y Confluence — y que, además de responder, **te lleva hasta donde está
la respuesta**.

- Chat en un panel lateral, con el modelo que tú elijas de los que ya tiene tu
  opencode (aquí, 43 entre tres proveedores).
- Consulta Jira y Confluence de verdad, a través del servidor MCP
  `mcp-atlassian`. Faro te prepara el bloque de configuración y espera a
  detectarlo; las claves van a tu opencode, no al navegador.
- Un mapa del sitio construido la primera vez —**incluido el árbol de páginas
  completo**, que es lo que permite enseñarte el camino— y que se enriquece con
  el uso.
- Memoria dentro de la sesión, y opcionalmente entre sesiones.
- Un **registro** de todo lo que se le pide a opencode, con resultado y
  duración, para saber qué pasó cuando algo falla.
- **Navegación asistida**: va **desplegando el árbol de páginas de la
  izquierda**, rama a rama, hasta dejar el destino a la vista. Sólo entonces
  navega — una vez, no ocho — y al llegar marca el párrafo exacto del que te
  hablaba. El camino no se lo inventa el modelo: es la rama del árbol, y se
  lee **de la API REST del propio Confluence, con tu sesión, en
  milisegundos**. Si no hay camino, te lleva de golpe. Y al llegar no oscurece
  nada: subraya.
- **Guiada o rápida**, a elegir en Ajustes: que intente siempre enseñarte el
  camino, o que te lleve directamente sin esperar a nada.
- **Dos formas de señalar**: el foco de siempre, que oscurece el resto de la
  página, o un **subrayado amarillo** que no tapa nada y rodea las imágenes con
  un filete muy fino. Se elige en Ajustes.
- **Señalar tú**: un botón en la barra de abajo cambia el cursor y te deja
  subrayar un párrafo o pulsar una imagen. Eso —y sólo eso— es el contexto de la
  siguiente pregunta. La imagen viaja de verdad, no su `alt`.
- **Skills**: General, Búsqueda, Resumen y Análisis, junto al selector de modelo.
  Las dos primeras te llevan; las otras dos trabajan sobre lo que tienes delante
  y no ofrecen viaje. Y saben **dónde están**: en Confluence, *Búsqueda*
  localiza la página y te enseña el camino por el árbol; en **Jira**, donde no
  hay árbol, escribe una **consulta JQL** con lo que preguntas, te dice cuál
  ha usado, nombra las incidencias por su clave y la tarjeta te abre **esa
  búsqueda en el buscador de Jira**, con la lista entera. La consulta no se
  lee de lo que el modelo escribe: se lee de la llamada real que hizo a
  `jira_search`, la que devolvió esos resultados.
- **Contexto de Jira**: en un proyecto, el mapa que Faro levanta la primera
  vez no es un árbol: son los **tipos de incidencia**, los **estados del
  flujo** (contados en una muestra de tickets) y las **convenciones de
  nombre** que el equipo sigue sin haberlas escrito («[Backend][Update] …»,
  «PSO | …»), con ejemplos. Y si el proyecto tiene un Confluence enlazado,
  busca ahí si están documentadas y apunta las páginas. Es lo que hace que
  una búsqueda con JQL sepa poner `issuetype`, `status` o un prefijo del
  resumen donde una búsqueda por palabras sueltas no encuentra nada.
- **Análisis de una incidencia de Jira**: el mismo modo Análisis, sobre un
  ticket. La incidencia se le enseña al modelo en bloques numerados leídos de
  lo que tienes en pantalla —título, campos, descripción, comentarios con su
  autor y su fecha— y **sin la interfaz**: ni la barra de acciones, ni las
  pestañas, ni el botón de plegar cada comentario, ni el editor. El modelo
  juzga lo que juzga un ticket: qué pide y para quién, si los criterios de
  aceptación son comprobables, qué falta, y si la descripción, los comentarios
  y los campos se contradicen entre sí o con la documentación del Confluence
  enlazado. Y subraya igual: un párrafo de la descripción, un comentario
  entero, un campo. Además **sabe qué ticket es**: lee de los campos en
  pantalla el tipo y el estado (y prioridad, versiones, etiquetas, asignado)
  y adapta el análisis: una definición de API se juzga por su contrato, su
  versión y la guía que debe cumplir; un error, por si se puede reproducir;
  una historia, por sus criterios; una épica, por lo que la compone. Y según
  el estado: por empezar, si está lista para cogerla; en marcha, qué falta
  por decidir; en revisión, si lo entregado cubre lo pedido; cerrada, si se
  cumplió con evidencia. Lo que ese tipo y ese estado significan en tu
  proyecto lo sabe el contexto que Faro construyó.
- **Jira y Confluence, cada uno con su token**: la pantalla de claves pide un
  bloque por producto —dirección, correo en Cloud, token—, porque en Server /
  Data Center son dos instalaciones con su token personal cada una. Un solo
  MCP sirve a los dos, y si viven en hosts distintos el otro queda enlazado:
  no vuelve a pedir claves, y desde Jira se lleva el contexto del Confluence
  de su pareja para saber qué páginas mirar. Y si el MCP ya existe en tu
  opencode con ese dominio dentro —lo pegaste a mano, o lo configuraste desde
  el otro producto—, Faro lo reconoce y lo usa sin pedirte nada.
- **Análisis con marcas numeradas**: el modo Análisis numera sus observaciones y
  **subraya en la página el pasaje del que habla cada una**, con su número
  detrás, como una nota al pie. En el chat, pulsar un `[2]` te lleva a su
  subrayado; pulsar el número en la página te lleva a su fila en el chat. La
  página se le enseña al modelo **troceada en bloques numerados** («¶7»), y él
  cierra su respuesta con un JSON que dice de qué bloque habla cada número: el
  subrayado lo decide un script a partir de ese JSON, no el modelo. Y **siempre
  subraya, salvo que no haya nada que decir**: si el modelo numera a su manera
  —una lista «1.», «Observación 1:», encabezados— Faro lo reescribe en local;
  si la prosa no lleva números pero el JSON sí, se fía del JSON; si no hay
  números en ningún sitio, trocea la prosa en observaciones en una pasada
  aparte; y si tampoco, un botón vuelve a pedirlo numerado. Cuando de verdad
  no hay nada que observar, el modelo cierra con «Sin observaciones.» y Faro
  lo dice tal cual, sin tratarlo como un fallo. El panel y las marcas de la
  página comparten el mismo ámbar: la pastilla numerada que ves en el chat es,
  byte a byte, la que ves sobre el texto de la página (y hay un test que no
  deja que se separen). La tarjeta del análisis dice además **de qué clase es
  cada observación** —dato, supuesto, hueco, contradicción, riesgo— y deja
  **copiarlas** tal como se leen, con sus números, para pegarlas en el
  comentario de la incidencia o de la página.
- **Lo que el modelo consultó no se tira**: al terminar un turno, las consultas
  a Atlassian se pliegan en una línea («3 consultas a Atlassian») que se puede
  desplegar para ver cuáles fueron y si alguna falló. Es lo primero que se mira
  cuando la respuesta no cuadra.
- **Páginas base del análisis**: junto al selector de Skill, en Análisis, un
  botón para decir **en base a qué páginas** se analiza la abierta: una guía,
  una decisión anterior, la página con la que hay que comparar. Se añaden
  pegando su URL o buscándolas por título, con autocompletado desde el índice
  del sitio y desde la API del propio Confluence. Desde un **Jira Data
  Center**, las páginas son las del Confluence enlazado y se buscan ahí, con
  tu sesión y desde el propio panel (hace falta darle permiso sobre ese
  dominio una vez; la pantalla lo pide). Y un **alcance** a elegir:
  *sólo estas* —la página abierta y las base, nada más— o *estas como mínimo*,
  y las que el modelo decida consultar. Se recuerdan por sitio y se ven siempre
  en un chip sobre el cuadro de texto.

---

## Requisitos

| Qué | Por qué | Comprobado |
|---|---|---|
| `opencode` ≥ 1.2 | Es el motor. La extensión no habla con ninguna nube. | 1.2.25 |
| Chrome ≥ 116 | `chrome.sidePanel` y la CSS Custom Highlight API. Desde Chrome 130, además, los módulos de la extensión sólo se sirven a la página por una URL distinta en cada sesión (`use_dynamic_url`): ninguna web puede comprobar si tienes Faro instalado. Con 116-129 funciona igual, sin esa protección. | |
| `uvx` (o Docker) | Para ejecutar `mcp-atlassian`. | uvx en Windows |
| Un API token por producto | Para leer Jira y Confluence. En Cloud el mismo vale para los dos; en Data Center es un token personal por instalación. | |

---

## Instalación

### 1. Carga la extensión

```bash
chrome://extensions → Modo desarrollador → Cargar descomprimida → esta carpeta
```

El identificador es fijo (viene del campo `key` del manifest), así que no
cambia entre recargas ni entre equipos:

```
ickohiffpicdfeameogbihbcanbjibmk
```

### 2. Arranca opencode con CORS y contraseña

```bash
opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO
```

La bandera `--cors` lleva ese identificador porque Chrome, si no, bloquea la
lectura de las respuestas. Y `--print-logs --log-level INFO` hace que la
terminal muestre lo que esta pasando dentro de opencode:

```
INFO service=server status=completed duration=1 method=GET path=/global/health
INFO service=server status=started method=POST path=/session/ses_.../prompt_async
INFO service=config path=C:\\Users\\marco\\.config\\opencode\\opencode.json loading
```

Ahi se ven las llamadas, los tiempos, que configuracion carga y cualquier
error del lado del servidor. El **registro del panel** ensena lo mismo desde
el otro lado; los dos juntos cubren el camino entero. Para poner contraseña —recomendado, porque si no
cualquier proceso local puede pedirle cosas a opencode— define
`OPENCODE_SERVER_PASSWORD` antes de arrancar y méte la misma en los ajustes del
panel.

En PowerShell:

```powershell
$env:OPENCODE_SERVER_PASSWORD = "algo-largo-y-tuyo"; opencode serve --port 4096 --cors chrome-extension://ickohiffpicdfeameogbihbcanbjibmk --print-logs --log-level INFO
```

### 3. Abre Jira o Confluence y pulsa el icono

La primera vez en cada sitio, Faro te pedirá las claves de cada producto:
dirección, correo (en Cloud) y API token de Jira, y los de Confluence
(`id.atlassian.com` → Security → API tokens en Cloud; *Personal Access Tokens*
de cada producto en Data Center). Si tu Jira y tu Confluence viven en hosts
distintos, dalos juntos aquí: el otro host queda enlazado y no volverá a pedir
nada.

Después te enseñará un bloque de configuración para pegar en el `opencode.json`
de tu opencode, y te pedirá reiniciarlo. **Esto es una vez por sitio** (o por
pareja de sitios), y es inevitable: opencode 1.2.25 sólo carga los servidores
MCP al arrancar, y su endpoint para registrarlos en caliente responde `200` sin
hacer nada. Faro se queda vigilando y, en cuanto detecta el MCP conectado,
comprueba los dos tokens y sigue solo.

Luego te ofrecerá construir el contexto, traer el tuyo, o empezar sin él.

Los detalles están en [`docs/INSTALL.md`](docs/INSTALL.md).

---

## Cómo funciona

```mermaid
flowchart LR

  PAGINA["🌐 Jira / Confluence<br/>la página que tienes abierta"]
  EXT["🧩 Extensión<br/>Faro"]
  OC["💻 opencode<br/>en tu máquina"]
  LLM["🤖 LLM<br/>en la nube o en local"]
  MCP["🔌 MCP de Atlassian<br/>sólo lectura"]

  PAGINA <-- "marca, navega y lee el árbol" --> EXT
  EXT -- "pregunta" --> OC
  OC <-- "razona" --> LLM
  OC -- "consulta" --> MCP
  MCP -- "API" --> PAGINA

  classDef caja fill:#F7F8F9,stroke:#6B6879,color:#17161D
  classDef faro fill:#FFF6E4,stroke:#C98A22,color:#2B1F05
  class PAGINA,OC,LLM,MCP caja
  class EXT faro
```

Cinco piezas y ningún misterio:

- **La extensión** es la única que toca la página. Lee lo que estás viendo, va
  desplegando el árbol de la izquierda y marca en amarillo el fragmento del que
  te habla, sin modificar el documento.
- **opencode** corre en tu máquina. La extensión no habla con ninguna nube:
  sólo con `127.0.0.1` y, en modo lectura, con el Confluence que ya tienes
  abierto, para leer el árbol de páginas con tu propia sesión.
- **El LLM** lo eliges tú de la lista que tenga tu opencode: uno de pago en la
  nube, uno gratuito, o uno corriendo en tu propio equipo. Faro no llama a
  ninguna nube; le habla a tu opencode, y es él quien decide a dónde va la
  petición —o si no sale del ordenador.
- **El MCP** es por donde opencode lee Jira y Confluence, contra su API y en
  modo sólo lectura.

De ahí que haya dos caminos hasta el mismo sitio: la extensión ve **la página
que tienes delante**, y opencode consulta **la API**. Ninguno de los dos
escribe nada.

Trece decisiones que sostienen el diseño:

1. **El panel es el único que habla con opencode.** El content script vive
   dentro de una página que no controlamos: no conoce la contraseña del
   servidor ni ve las respuestas del modelo, sólo recibe órdenes ya validadas.

2. **El stream de eventos vive en el panel, no en el service worker.** En MV3
   el worker se duerme a los 30 s de inactividad y cortaría la respuesta a
   medias.

3. **El modelo nunca emite URLs ni selectores CSS.** Devuelve identificadores,
   y el panel los resuelve contra el índice del sitio. Un modelo alucinado
   produce un plan que no se ejecuta, no una navegación a un sitio equivocado.
   Y lo que devuelven las herramientas tampoco entra a ciegas en ese índice:
   una URL de otro Confluence o de otro Jira se descarta antes de mirar nada,
   y una sigla con forma de clave («UTF-8», «ISO-8601») sólo cuenta como
   incidencia si su proyecto ya se conoce —el de la pestaña, el índice o el
   JSON que devolvió `jira_search`— o si viene en una ruta `/browse/`. Los
   enlaces que el modelo escribe en el chat sólo se abren si son de tu sitio,
   de su Confluence enlazado o de `id.atlassian.com`; cualquier otro se dice y
   no se abre.

4. **El camino sale del árbol, no del modelo.** Preguntado por «¿esta ACV
   tiene su TCV correspondiente?», el modelo devolvía un recorrido de dos
   saltos: la página en la que estabas y la de destino. En el árbol son ramas
   hermanas que cuelgan de sitios distintos, así que no había nada que
   desplegar y la navegación guiada acababa en un salto seco. Ahora los pasos
   son la cadena de padres del destino, que la sabe el índice; el `path` que
   escriba el modelo no cuenta. Y esa cadena **se lee, no se pregunta**: una
   petición `GET …/rest/api/content/<id>?expand=ancestors` al mismo Confluence
   en el que estás, con tu sesión, la devuelve entera en milisegundos
   (`src/shared/confluence-rest.js`, puro y con pruebas; si Cloud retira la
   API v1, son tres peticiones a la v2). Antes se le pedía al
   modelo, que tenía que llamar al MCP y devolver un JSON válido: entre treinta
   segundos y varios minutos, y con los modelos pequeños ni eso. Si la API no
   contesta, no se improvisa un camino falso: se lleva de golpe.

5. **Un paso intermedio nunca navega.** Una carga de página a mitad del
   recorrido pliega el árbol entero y deja sin base a los pasos que quedan. Si
   una rama intermedia no aparece, se salta y se sigue; sólo el destino puede
   llegar por URL.

6. **Guiar por el árbol es desplegar, no navegar.** Un recorrido de ocho
   niveles no son ocho cargas de página: son siete ramas que se abren en la
   barra lateral y una única navegación al final. Cada paso lleva su acción
   (`expand` u `open`), y sólo el último abre la página. Además se comprueba
   que la rama se abrió de verdad; si el clic no reacciona, se prueba el
   teclado (flecha derecha, como manda ARIA para un árbol).

7. **La estructura del árbol se guarda como datos, no como HTML.** Se lee de
   tres sitios: del MCP al construir el contexto, **del propio DOM de la barra
   lateral** mientras usas Faro — gratis, exacto y limitado a lo desplegado — y
   **de la API REST del sitio** cuando hace falta el camino hasta una página.
   Guardar marcado sería pesado y caducaría al primer rediseño; guardar «la
   1084 cuelga de la 1083» no caduca.

8. **Los pasos se localizan por `href` y por ruta, no por clase CSS.** El id y
   el slug de una página de Confluence no cambian; sus clases CSS cambian cada
   trimestre. Y si la rama está plegada, el árbol se va abriendo por rondas,
   priorizando las ramas cuyo nombre comparte palabras con el destino.

   Qué es el contenedor del árbol, qué es una fila y cuál es su control de
   desplegar se decide en **un solo sitio** (`src/content/tree-dom.js`), con una
   cascada de selectores conocidos y, por debajo, una heurística estructural que
   sube desde el enlace hasta lo que envuelve también a su chevron. Antes había
   tres lecturas distintas del mismo DOM y no coincidían: la barra lateral de un
   Confluence real no lleva `role="tree"`, así que el barrido de ramas no
   encontraba ninguna.

9. **El foco guía; el subrayado señala.** El oscurecido sirve mientras te lleva
   por el árbol, donde hay que ver adónde va el siguiente clic. Una vez has
   llegado, tapa justo lo que has venido a leer: ahí el fragmento se subraya y
   ya está. Es la misma pieza con y sin escudo, no dos.

   De ahí sale lo demás: las observaciones de un análisis son ese mismo
   subrayado, varias veces y numeradas. Y quien decide dónde cae cada una es un
   **script, no el modelo**. La página se lee del DOM y se le enseña troceada
   en bloques numerados —párrafo, encabezado, viñeta, celda, código: «¶7 [p]
   …»—; el modelo numera sus puntos en la prosa y cierra la respuesta con un
   bloque JSON que no ve el usuario: de cada número, el bloque ¶ del que habla y,
   si quiere afinar, una cita literal dentro de él. El panel lo valida contra
   los bloques que le enseñó (la pista con la que se reconoce un bloque son sus
   primeras letras, tal como las leyó la extensión, nunca lo que diga el
   modelo) y el content script vuelve a trocear la página de AHORA y resuelve
   cada ancla por una escalera fija: el bloque comprobado por su texto, la cita
   dentro de él, el bloque entero si la cita no está tal cual, la cita en toda
   la página si el bloque ya no existe, y si no, nada. Antes hacían falta dos
   turnos y el modelo tenía que copiar frases de memoria; copiaba mal, y lo
   que copiaba mal no se marcaba. Esa segunda pasada sigue existiendo sólo como
   red, para el modelo que numera y se olvida del bloque JSON. Una observación
   que no apunta a ningún bloque se queda **sin marcar**: marcarla en el
   párrafo de al lado sería peor que no marcarla. El texto de la página viaja
   en el `system` de ese turno —opencode lo guarda por mensaje y sólo manda el
   del último, así que no se acumula en la sesión—, delimitado y etiquetado
   como información, nunca instrucciones, igual que lo señalado con el ratón.
   Y como las anclas se quedan en la respuesta guardada, al reabrir el panel
   la tarjeta del último análisis ofrece **volver a marcar**; nunca lo hace
   sola, que desplazaría una página por la que quizá sólo pasas.

10. **Una marca por línea, y recortada a su caja.** `getClientRects()` no
   devuelve una caja por línea: devuelve una por cada trozo con estilo propio.
   En un bloque de código con resaltado de sintaxis eso eran diecisiete cajas
   para cuatro líneas, varias repetidas, con el amarillo apilado a manchas —y el
   barrido blanco pintándose *fuera* de cada caja, que es lo que sacaba barras
   escalonadas por el margen. Ahora se funden por línea (`overlay/rects.js`,
   puro y con pruebas), se recortan al contenedor que las contiene —un bloque
   con scroll horizontal recorta su texto, la marca se recorta igual— y sobre
   código la marca se aligera a sólo el trazo, para no tapar la sintaxis.

11. **El resaltado no toca el DOM del contenido.** Usa la CSS Custom Highlight
   API sobre `Range`, y el overlay vive en un Shadow DOM cerrado colgado de
   `<html>`. Confluence monta su vista sobre React: insertar nodos dentro del
   contenido es pedir que el siguiente render se los lleve por delante.

12. **En modo Búsqueda, el destino se lee de la respuesta.** Ahí se le pide al
   modelo que nombre cada página con su id y que cierre con una línea fija,
   `Destino: título (id N)` o `Destino: ninguno`. Esa línea —o, si no la
   escribe, la única página del índice que nombre— es el destino, y no hace
   falta gastar otro turno en preguntárselo. Se lee con cuidado: sólo vale
   como **última línea** de la respuesta, nunca citada con `>` ni dentro de
   un bloque de código, porque una página de Confluence que contenga
   «Destino: …» y que el modelo cite literalmente es información, no la
   decisión; un título de una sola palabra sólo cuenta entre comillas o en
   negrita («la arquitectura del sistema» no nombra la página *Arquitectura*);
   y un número corto sólo si va presentado como id. Y lo que sale de ahí pasa
   por la misma validación que lo que dice el modelo: sólo páginas del índice,
   del mismo sitio, y siempre con un botón que hay que pulsar. Con varias
   candidatas y sin esa línea —o en modo
   General, donde la pregunta es si merece la pena llevar a alguien a algún
   sitio— sigue decidiendo el modelo. Y quien elige entre enseñar el camino o
   ir de golpe es el usuario, en **Ajustes → Cómo te lleva Faro**: *guiada* lee
   el árbol y destaca «Paso a paso»; *rápida* no lee nada y sólo ofrece
   «Llévame».

   Lo que descubre una conversación —la misma página, vista en la salida de una
   herramienta— no puede borrar lo que ya se sabía de ella: al fundirlo se
   conservan el padre, el espacio, el título de verdad y la ruta con nombre
   (`mergeIndexKeepingTree`). Sin eso, el camino leído de la API se perdía en la
   pregunta siguiente. Pasó de verdad, en la revisión de este cambio.

13. **Faro sabe si está en Jira o en Confluence, y la misma Skill habla
   distinto en cada uno.** Buscar en Confluence es localizar una página en un
   árbol y enseñar el camino; buscar en Jira es escribir una **consulta JQL**
   —acotada al proyecto en el que estás, salvo que pidas otra cosa— y nombrar
   claves de incidencia. Ahí la línea de cierre es `Destino: CLAVE-123`, la
   clave se cosecha del JSON que devolvió `jira_search` (con su resumen, para
   que la tarjeta diga de qué va) y la tarjeta sólo ofrece «Llévame»: Jira no
   tiene árbol, y el proyecto por delante de la incidencia sería una carga de
   página antes de otra, justo lo que un paso intermedio nunca hace. La
   incidencia que ya tienes abierta se descarta como destino igual que la
   página abierta en Confluence.

   Y como son dos productos, son **dos tokens**: en Server / Data Center Jira y
   Confluence son dos instalaciones con su token personal cada una, y copiar el
   mismo en los dos —lo que se hacía antes— sólo funcionaba en Cloud. Un solo
   MCP sirve a los dos; si viven en hosts distintos, el otro host queda
   enlazado al mismo MCP (no se levanta un segundo proceso con el mismo token,
   ni se vuelven a pedir claves) y desde ese Jira viaja en cada pregunta el
   contexto del Confluence de su pareja, delimitado y con su propio
   presupuesto: sirve para saber qué páginas mirar, que es lo que necesitará el
   análisis de una incidencia.

14. **Nada se hace dos veces si se puede hacer una.** Casi todo lo que Faro
   tardaba era trabajo repetido, y quitarlo no cambia lo que hace, sólo cuándo
   responde:

   - **Abrir el panel** leía trece veces el almacén del navegador, cinco de
     ellas el mismo registro del mismo sitio, y en fila detrás de las consultas
     a opencode. Ahora es **una** lectura con todo lo del sitio, y va en
     paralelo con la lista de modelos. El registro lo dice fase por fase.
   - **Cerrar Ajustes** rearrancaba el panel siempre: reconstruía el cliente
     —lo que cancelaba la respuesta en curso— y volvía a descargar la
     conversación. Ahora rearranca **sólo si cambiaste la dirección del
     servidor o la contraseña**; lo demás se aplica en caliente, y la página se
     entera al momento sin esperar a que navegues.
   - **Volver a una conversación** descargaba la sesión entera, salidas de
     herramientas incluidas (megabytes), para pintar sólo el texto. Ahora pide
     los últimos 60 mensajes y, si recorta, lo dice con un botón **Ver toda la
     conversación**, que trae el resto y te deja donde estabas leyendo —en el
     primer mensaje que ya había— en vez de saltar al fondo. Ese botón no se
     puede pulsar mientras llega una respuesta. Y cuando lo que la conversación
     arrastra pasa de cierto tamaño, Faro te avisa una vez, explica que opencode
     ya poda las salidas viejas y te ofrece empezar una sesión nueva ahí mismo
     (con el botón en gris hasta que la respuesta termina).
   - **El índice del sitio** se escribía entero hasta tres veces por turno para
     dejar lo mismo en disco. Ahora se apunta lo aprendido y se escribe una sola
     vez al final, bajo el sitio que lo aprendió —y con el sitio al que
     preguntaste, no con el que tengas abierto al acabar: si te fuiste a otro
     mientras respondía, el registro lo dice («Índice sin ampliar») y el índice
     de aquél se queda como estaba—.
   - **Las marcas del análisis parpadeaban al hacer scroll**: el overlay
     recreaba cada rectángulo en cada evento, y un rectángulo nace transparente
     y aparece con una transición. Ahora una ráfaga de scroll se junta en un
     fotograma y los nodos se reutilizan. Y marcar una incidencia larga dejó de
     recorrerla tres veces por observación.
   - **El razonamiento** de un modelo que piensa en voz alta repintaba la
     respuesta entera por cada trozo, sin que se viera nada: ya no.

15. **Faro va a empezar a preguntarle a tu propio Jira y a tu propio
   Confluence, no al modelo.** Una búsqueda JQL, el árbol de un espacio, los
   filtros que tienes marcados, los enlaces de una incidencia o lo último que
   miraste son cosas que la API del sitio contesta exacta y en milisegundos; hoy
   se las pide al modelo, que tarda segundos, cuesta tokens y arrastra su
   respuesta en la conversación. Las lecturas van **con la sesión que ya tienes
   abierta en el navegador** —Faro no guarda ni pide ningún token para esto—,
   son **siempre de lectura** (GET, nunca se escribe nada), sólo al sitio en el
   que estás y con la consulta que escribe la propia extensión a partir de una
   plantilla fija; si la API no contesta, el camino de siempre sigue entero.

   De momento **no se nota nada**: esta versión trae sólo el cimiento —el
   transporte, las consultas y el banco de pruebas que lo ejercita—, y todavía
   no hay ningún botón que lo use. Lo usarán la lista de resultados dentro de la
   tarjeta de una búsqueda, las sugerencias de qué buscar, el contexto del sitio
   leído de la API y las recomendaciones de qué mirar hoy. Cuando lleguen, un
   solo interruptor en Ajustes las apagará todas de golpe; en Jira Cloud no se
   consulta la API en ningún caso (Atlassian la retiró: allí todo sigue por el
   MCP).

---

## Comprobaciones

```bash
npm run check              # sintaxis + orden + manifest + 1040 pruebas unitarias + docs
npm run check:docs         # sólo el paso docs: número de pruebas, títulos del registro, mensajes y ficheros del mapa
npm run test:integration   # contra un opencode real que arranca la propia prueba
npm run harness            # banco de pruebas visual en http://127.0.0.1:5175
npm run turn -- --n 1      # el último turno real (pregunta, sistema, herramientas, respuesta) desde una copia de opencode.db
npm run bench              # el metro: cuánto pesa el system de cada escenario y cuánto tardan los módulos puros
npm run contrast           # el contraste de cada pareja de colores, por tema: informa, y falla si alguna baja de 4,5 (texto) o 3 (control)
npm run snapshots          # regenera las instantáneas de los prompts (test/fixtures/prompts) cuando un cambio de prompt es intencionado
```

Con el banco levantado hay dos páginas:

- <http://127.0.0.1:5175/> — la Confluence de mentira, para ver el foco, el
  anillo, el cartel y el recorrido asistido funcionando de verdad.
- <http://127.0.0.1:5175/harness/panel-preview.html> — el panel real con dos
  conversaciones de ejemplo (una de Confluence y una de Jira), para recorrer sus
  nueve pantallas sin tener que instalar nada. Sus mandos cambian el tema
  (claro/oscuro), la anchura (320, 360 y 420), el estado del faro y la pantalla
  abierta, y `faroPreview.check()` mide en cada combinación lo que hay que mirar:
  que haya panel que medir, que nada se salga a lo ancho, que la cabecera y la
  fila del redactor quepan en una línea y que el chat vacío no pase de tres
  sugerencias. Lo primero no sobra: un selector que no casa mide 0 px, y 0 cabe
  de sobra en cualquier tope, así que sobre una página vacía la medida decía que
  todo estaba bien. Si falta el panel, ahora lo dice con su motivo. El rediseño
  se acepta mirando las cuatro capturas (320 y 420 × claro y oscuro) con esa
  medida en verde.

- **`npm run check`** no necesita nada instalado. Valida que todos los ficheros
  parsean, que **nada se usa antes de declararse**, que el manifest es MV3
  correcto y que el id derivado de la `key` coincide con el que usa el código, y
  corre las pruebas de lógica pura:
  detección de sitio, índice, validación de planes, anclaje de texto,
  localizadores, markdown, memoria y la máquina de estados del service worker
  con un `chrome` simulado, el cliente de opencode con un servidor falso
  (autenticación, SSE, vigilante, cancelación, salida estructurada), los
  permisos de sesión contra una copia de cómo los evalúa opencode (todo
  denegado salvo el MCP), que todo lo que el content script carga está entre
  los recursos que el manifest expone, y los prompts completos
  de 33 escenarios comparados byte a byte con sus instantáneas (dos de ellos
  con contexto, memoria y Confluence enlazado más largos que el presupuesto,
  para que los recortes se vean). El panel, el overlay y el ejecutor de pasos
  —que sólo viven en el navegador— se comprueban por regex sobre su propio
  código fuente: que capturan el sitio antes de esperar, que Escape se
  instala y se suelta donde toca, que las marcas exigen una caja visible.

  El último paso, «docs», vigila que README y CLAUDE.md digan el número real
  de pruebas (el total, y el de cada fichero de test que CLAUDE.md §10
  declara), que cada título del registro esté documentado (en
  `docs/INSTALL.md` o en CLAUDE.md), que cada mensaje entre las piezas tenga
  quien lo atienda y esté descrito —y avisa del que nadie manda—, y que ningún
  fichero de `src/` falte en el mapa (`npm run check:docs` para verlo entero,
  con las líneas). Y `AGENTS.md`
  no es una copia de CLAUDE.md: es un puntero de tres líneas, para que no se
  quede atrás.

  Lo del orden hace falta porque parsear no ejecuta: una zona muerta temporal
  —leer una constante dos líneas antes de declararla— pasa la comprobación de
  sintaxis y revienta cuando el usuario pulsa el botón. Pasó de verdad. El
  detector está acotado a lo que siempre es un error, dentro de una misma
  función y al mismo nivel: comparar entre ámbitos daba ciento cincuenta falsos
  positivos, y un aviso que se ignora no es una red, es ruido.

- **`npm run test:integration`** arranca su propio `opencode serve` con
  contraseña y CORS, y ejercita el mismo cliente que usa la extensión:
  autenticación, CORS, lista de modelos, sesiones, streaming por SSE y salida
  estructurada con el esquema real de navegación. Gasta turnos de verdad: sin
  `FARO_TEST_MODEL=proveedor/modelo` sondea los candidatos con un turno de dos
  palabras —los gratuitos primero— y cae en `github-copilot/gpt-5.6-luna`, que
  paga la suscripción de Copilot, porque el nivel gratuito de opencode ya no vale
  desde `opencode serve`.

- **`npm run harness`** levanta una Confluence de mentira —con cabecera
  pegajosa, árbol lateral y navegación por pushState— y ejecuta encima las
  piezas reales. El botón **Autocomprobación completa** recorre los casos que
  sólo se pueden verificar con DOM: anclaje exacto, aproximado y por encabezado,
  que el contenido no se muta, el desplazamiento por debajo de la cabecera, el
  recorrido asistido de tres pasos, la lista blanca de clics, el aislamiento del
  overlay, y los casos que más cuestan en un Confluence real: **un árbol de seis
  niveles plegado** que hay que ir abriendo hasta dar con la página, **la página
  actual, que Confluence pinta sin enlace**, un `aria-expanded` que dice
  «abierto» con las hijas ocultas, y el recorrido guiado que despliega seis
  ramas y navega una sola vez.

  El banco trae **dos barras laterales** y se puede cambiar entre ellas: la
  clásica, con `role="tree"` y `role="treeitem"`, y otra con la forma del
  Confluence real —contenedor reconocible sólo por `data-testid`, filas que son
  divs sin rol, scroll propio—. Sobre esa segunda se comprueban las cuatro cosas
  nuevas: que el adaptador encuentra contenedor, fila y control; **el caso de la
  captura**, que va de una ACV hasta su TCV hermana desplegando cuatro ramas y
  navegando una sola vez; que la barra lateral se desplaza sola; y que un paso
  intermedio inexistente se salta sin recargar nada. Más el otro estilo de
  resaltado y el recuadro fino de las imágenes.

  Y las del análisis: tres observaciones que se anclan y se numeran, con la
  insignia justo detrás del último carácter de su cita; una cuarta cuya cita no
  existe, que tiene que quedarse sin marcar; ir a una observación concreta sin
  apagar las demás; y que **al llegar a un destino no se oscurece la página**.
  Más las del análisis por bloques: que la página en bloques numerados sale
  igual dos veces seguidas y sin lo que está oculto; la escalera entera sobre
  cinco observaciones —bloque más cita, bloque entero, número equivocado con
  el texto correcto, cita sin bloque, y nada—, con una marca por observación y
  el bloque entero en una barra por línea; que si alguien añade un párrafo por
  encima la marca sigue donde estaba el texto; y que si Confluence repinta el
  párrafo marcado, ir a la observación la vuelve a resolver.

  Y las de Jira: el banco trae también **una incidencia** con la forma exacta
  del Jira Data Center real —cabecera con la barra de acciones, módulos con su
  cabecera, pestañas de campos, comentarios con su botón de plegar y sus
  acciones, el editor pegado abajo, el panel lateral con integraciones— y se
  comprueba que en bloques sale primero el título, luego los campos («Tipo:
  Tarea»), la descripción y cada comentario con su autor y su fecha, que **nada
  de la interfaz** entra en ningún bloque (ni «Editar», ni «Contraer el
  comentario», ni las pestañas, ni la pestaña de campos que está oculta), que
  tres observaciones se subrayan donde tienen que caer: la cita en un párrafo de
  la descripción, un comentario entero y un campo; y que los **campos** de la
  incidencia —tipo, estado, prioridad, personas, épica, sprint, versiones,
  etiquetas— se leen por su id como en el Data Center real y, si no lo llevan,
  por su etiqueta, mientras que una página de Confluence no tiene ninguno. Y
  que, con la incidencia dentro de un panel con scroll propio —como en la
  vista de incidencia de un Data Center—, ir a una observación desplaza ese
  panel y deja la marca a la vista, no sólo la ventana; que la incidencia se
  lee en los mismos bloques con ese panel arriba que abajo (antes, con el
  panel desplazado, los bloques de arriba se daban por ocultos y las
  observaciones de arriba se quedaban sin marca); y que Escape, con las marcas
  de un análisis puestas, llega a la página y no las borra, mientras que con
  el foco de un recorrido encendido lo apaga y con la cita de una llegada
  subrayada —y sin marcas numeradas— la quita.

  Y las tres de rendimiento: que **cuarenta scrolls seguidos no recrean ni una
  sola marca** (el overlay cuenta cuántos nodos crea y cuántos reutiliza) ni las
  dejan apagadas al cambiar el ancho de la ventana; que una **página larga de
  verdad** —347 bloques generados al vuelo— se lee entera y se marca con doce
  observaciones, seis a su propio párrafo y seis encontradas por su cita en toda
  la página; y que resolver una observación con el ámbito de lectura ya calculado
  da exactamente el mismo resultado que dejando que se calcule solo.

  Y las del camino leído por la API: la Confluence de mentira contesta a
  `…/rest/api/content/<id>?expand=ancestors` como la de verdad —con la portada
  del espacio por encima de todo— y se comprueba que la cadena sale entera, sin
  esa portada, en milisegundos; que una página inexistente no tiene camino; y
  que con esa cadena, **sin que el modelo haya dicho nada**, el recorrido de la
  ACV a su TCV despliega cuatro ramas y navega una sola vez. Y la búsqueda de
  páginas por título contra la misma API falsa, que busca como la de verdad:
  «ADR» devuelve las dos ADR y nada más, «Arqui» encuentra «Arquitectura»
  porque el último término lleva comodín, con una letra no se pide nada, y las
  comillas y barras del usuario no llegan al CQL.

  Y, desde que Faro lee la API del propio sitio, el banco finge también **la API
  de Jira**: una consulta de las que Faro escribe por plantilla devuelve las
  incidencias que dice la fixture y en su orden; una consulta que el servidor
  rechaza vuelve con el mensaje del servidor y no como una lista vacía; una
  sesión que no vale se distingue de una consulta mala; los dos reintentos
  ocurren una sola vez cada uno (una instancia sin el campo «visto por última
  vez», y una dirección con una carpeta de más delante); el **árbol entero de un
  espacio** se lee de la propia API, paginado, con el padre de cada página, y
  dice cuándo se ha quedado corto; y salen los filtros que el usuario tiene
  marcados, los enlaces de una incidencia a Confluence y lo último que vio.
  Lo último es de seguridad: ninguna de esas lecturas sale del sitio, y una
  consulta que no salga de una plantilla no llega a pedirse.

- **`npm run turn`** enseña lo que el modelo contestó DE VERDAD en el último
  turno de la última sesión del panel: la pregunta, cuánto sistema llevaba (con
  sus primeras y últimas líneas), cada consulta a Atlassian con su JQL o su id y
  400 caracteres de lo que devolvió, y el texto completo con el bloque de
  anclas señalado. Lee una COPIA de la base de datos de opencode
  (`~/.local/share/opencode/opencode.db`), abierta en sólo lectura y borrada al
  acabar; la original no se toca. Necesita Node ≥22.13 (todo lo demás sigue
  con Node ≥18). `--host jira` elige la última sesión de ese host, `--n 3` los
  tres últimos turnos, `--all` incluye las sesiones internas (planificador,
  observaciones…). Es lo primero que hay que mirar cuando el panel dice algo
  raro: qué se le pidió y qué contestó, no lo que el panel pintó después.

- **`npm run bench`** es el metro: cuánto pesa el `system` de cada escenario (en
  caracteres, líneas y tokens estimados a caracteres ÷ 4) y cuánto tardan los
  módulos puros más pesados, como mediana de 20 repeticiones. Mide los mismos
  escenarios que las instantáneas de los prompts, así que lo medido es
  exactamente lo que se compara byte a byte. No tiene umbrales, no falla nunca y
  no entra en `npm run check`: los tiempos de una máquina no son un contrato,
  sirven para comparar dos ejecuciones de la MISMA máquina antes y después de un
  cambio. Hoy el `system` va de 2 767 a 29 159 caracteres (mediana 8 127) y
  ningún módulo puro pasa de 5 ms.

- **`npm run contrast`** imprime la tabla de contraste del panel y del overlay,
  tema a tema: ratio, nivel (AA/AAA) y qué dibuja cada pareja de colores. No
  genera nada; sólo dice qué mide el CSS de hoy, con la fórmula de WCAG 2.1.
  Como el metro, queda fuera de `npm run check`; a diferencia de él, sale con 1
  si alguna pareja baja de su umbral —4,5:1 el texto y 3:1 lo que dibuja un
  control (el borde de un campo, cuando el borde es lo único que lo dibuja)— o
  si falta un token, que sale en rojo como «falta» y no como un hueco. Los
  bordes decorativos salen marcados «exenta» con su número, y el test comprueba
  que sigan por debajo de 3. Las parejas no se declaran en el informe: viven en
  `test/contrast-pairs.js`, que es la misma lista que pina `panel-css.test.js`,
  el que sí corre en `npm run check`.

- **`npm run snapshots`** reescribe `test/fixtures/prompts/*.txt` con los
  prompts que el código produce hoy para 33 escenarios fijos (Confluence y Jira
  Data Center × cada Skill × con y sin página en bloques, páginas base,
  contexto, memoria y Confluence enlazado, más los turnos internos).
  `npm run check` los compara byte a byte y, si difieren, enseña la primera
  línea distinta con su número. Se regenera SÓLO cuando el cambio de prompt es
  intencionado, y se revisa el `git diff` de los `.txt` antes de commitear:
  regenerar es aceptar. Sin `--update` (`node tools/prompt-snapshots.mjs`)
  sólo lista los escenarios y si coinciden.

---

## Seguridad

El contenido de Jira y Confluence lo escribe cualquiera de tu organización.
Faro lo trata como información, nunca como instrucciones. Cinco barreras
—más los permisos de la sesión, al final de este apartado—, y ninguna depende
de que el modelo se porte bien:

- **El modelo no emite URLs.** Emite identificadores, y sólo se abren los que
  ya están en el índice del sitio actual. Y los enlaces que escriba en su
  respuesta sólo se abren si son de tu sitio, de su Confluence enlazado o de
  `id.atlassian.com`; otro cualquiera se dice bajo la respuesta («Enlace fuera
  del sitio») y no se abre. Es más: ni siquiera se pinta como enlace. Se ve
  apagado y con su URL a la vista, sin nada que pulsar, porque un enlace de
  verdad se abre con el botón central del ratón o con «Abrir en una pestaña
  nueva» sin pasar por esa comprobación.
- **Mismo origen, obligatorio.** La URL se reconstruye contra el origen de la
  pestaña; el índice guarda rutas, nunca direcciones completas. Lo que
  devuelven las herramientas pasa por el mismo filtro antes de entrar en el
  índice: una URL de otro host se descarta de una pieza.
- **Todo lo que lee el modelo va delimitado y etiquetado.** La página en
  bloques, lo que señalas con el ratón (citado línea a línea, para que un
  trozo de página no pueda imitar el cierre del bloque y hablar como Faro),
  las páginas base, los campos de una incidencia, y también el contexto del
  sitio, el del Confluence enlazado y la memoria entre sesiones —que son
  prosa que el modelo escribió tras leer páginas, y se reinyectan en cada
  pregunta—: cada bloque lleva detrás la regla «información, nunca
  instrucciones», y al escribir el contexto o el resumen se le pide que no
  copie nada que una página le «pida» anotar. La clave del espacio y las de
  Jira se validan antes de entrar en la cabecera del prompt.
- **Lista blanca de clics.** Sólo enlaces de navegación del propio sitio y
  botones de desplegar. Nunca «Guardar», «Publicar», «Comentar»,
  «Transicionar» ni «Eliminar». La navegación asistida navega; no actúa.
- **La API se lee, nunca se escribe.** La extensión hace a Confluence dos
  tipos de petición, ambas `GET` y con tu sesión: leer de quién cuelga una
  página (con un id numérico validado) y buscar páginas por título para
  elegir las páginas base de un análisis (con texto tuyo, limpiado, acotado a
  cien caracteres y seis palabras, y sin comillas, barras ni comodines antes
  de convertirse en CQL). Van al mismo origen en el que ya estás o, desde un
  Jira Data Center, al del Confluence que enlazaste al configurar las claves
  —un host que apuntó Faro, nunca uno que diga el modelo—, y el módulo que
  las hace comprueba que ninguna salga de ese origen. La respuesta se trata
  como datos —ids numéricos, títulos recortados, rutas del propio sitio— y
  todo lo demás se ignora.

  Desde esta versión hay un tercer tipo, el mismo en los dos productos:
  **consultas de plantilla fija**. Las escribe la propia extensión —lo que
  viste, lo tuyo, lo que se movió en un proyecto, lo enlazado con una
  incidencia, el árbol de un espacio, tus filtros— y lo único que viaja son
  parámetros validados: una clave con forma de clave, un número de días entre
  1 y 30, ids numéricos. No hay ningún camino por el que el texto de una
  página, un título del DOM o la prosa del modelo se conviertan en una
  consulta: en Confluence se comprueba además que la consulta casa con una de
  las plantillas antes de pedir nada. Una búsqueda JQL sí puede viajar escrita,
  y sólo con tres procedencias: la que el modelo ya ejecutó por el MCP, la de
  un botón que la extensión arma escapando los valores, o la de un filtro que
  guardaste tú. Todas salen por el mismo y único punto —siempre `GET`, siempre
  al sitio en el que estás, con campos fijos, tope de resultados y tope de
  tiempo—, y en Jira Cloud no se pide nada en absoluto.

**Y el modelo no puede tocar tu máquina.** El agente por defecto de opencode
trae herramientas de shell y de ficheros, y las usa: comprobado, ejecutaba
`echo hola` y leía `package.json` dentro de un turno normal de chat. Faro abre
todas sus sesiones con **todo denegado salvo el MCP de Atlassian**: una regla
que deniega cualquier herramienta y, detrás, las que permiten sólo
`*_confluence_*` y `*_jira_*`. Antes se denegaban diez nombres concretos y
quedaban fuera `websearch`, `codesearch` y `skill` —con los que un texto
escondido en una página podía mandar su contenido a un buscador o cargar un
fichero del disco como instrucciones—; ahora lo que nazca en una versión nueva
de opencode nace denegado, y la prueba de integración lo compara con la lista
real de herramientas del servidor. Sin eso, un texto escondido en una página
de Confluence podría acabar ejecutando órdenes en tu equipo.

Además: el MCP se configura en modo sólo lectura, las claves de Atlassian van
al proceso local de opencode y no al `chrome.storage`, el panel construye
todo el texto del modelo con `textContent`, nunca con `innerHTML`, y los
módulos de la extensión que la página puede cargar se sirven con una URL
distinta en cada sesión (`use_dynamic_url`), para que ninguna web detecte que
tienes Faro.

---

## Accesibilidad

- **Foco.** Al abrir Ajustes, Memoria, Registro o Páginas base, el resto del
  panel queda inerte (Tab no llega a los controles tapados) y el foco va al
  título de la pantalla; al cerrarla vuelve a donde estaba, o al cuadro de
  texto. Cada pantalla se cierra con la flecha de su cabecera, que se queda
  arriba mientras lees: antes había que bajar hasta el final para encontrar un
  «Listo».
- **Escape.** Cierra esas pantallas (en Páginas base, primero vacía las
  sugerencias) y cancela el velo «Trabajando…», desde cualquier sitio del
  panel. En Ajustes cierra **sin guardar**: lo que hayas tecleado y no
  guardado se pierde, porque su flecha de volver guarda todos los campos —la
  contraseña y la dirección del servidor incluidas—, y por eso se llama
  «Guardar y volver». En la
  página, Escape es de Faro sólo mientras tiene algo
  en marcha —el foco de un recorrido, el cartel, la barra de señalar— o
  mientras el único subrayado es el de una llegada por cita, que sí quita; con
  las marcas de un análisis puestas, la tecla llega a la página como siempre y
  no borra nada.
- **Lector de pantalla.** El chat no anuncia cada trozo de texto que llega
  (antes era una región viva y una respuesta se encolaba cien veces): mientras
  se responde lleva `aria-busy`, y al terminar un anunciador aparte dice
  «Respuesta lista · N observaciones» y el principio de la respuesta; los
  avisos y las tarjetas se anuncian igual, y restaurar una conversación no
  anuncia nada.
- **Scroll.** El chat sólo baja solo al fondo si ya estabas pegado a él: si
  subiste a leer, se queda donde estás; tu propia pregunta sí lo baja.
- **Cambiar de sitio a mitad de respuesta.** Pasar a una pestaña de otro host o
  abrir una sesión nueva cancela el turno en vez de dejarlo «pensando…» 90
  segundos, y lo dice en el registro; lo que ya llegó a opencode sigue en la
  sesión de aquel sitio. Cerrar Ajustes ya **no** lo cancela, salvo que hayas
  cambiado la dirección del servidor o la contraseña. Un indexado que termina
  cuando ya estás en otro sitio se guarda bajo el sitio que se indexó.
- **Mientras esperas.** Si el modelo lleva 45 segundos sin dar ninguna señal, la
  cabecera lo dice («pensando… 45 s sin señales del modelo») en vez de dejarte
  adivinar si sigue vivo; el turno sigue esperando su plazo entero, y el texto
  vuelve a «pensando…» con la primera palabra.

---

## Confluence o Jira propios (no `*.atlassian.net`)

El manifest sólo puede declarar dominios conocidos, así que en un despliegue
propio Chrome no inyecta el content script por su cuenta. Sin él, Faro puede
consultar y llevarte de golpe, pero **no puede resaltar ni guiarte paso a
paso**: no tiene a quién darle las órdenes.

La primera vez que pidas navegación en un dominio así, Faro te enseña una
tarjeta pidiendo permiso. Al concederlo:

1. registra el content script para ese dominio, y
2. lo inyecta en la pestaña que ya tienes abierta, sin recargar.

Si el permiso falta, el aviso lo dice. Antes esto fallaba en silencio: pulsabas
«Paso a paso» y no ocurría nada.

## Elegir modelo

No todos los modelos de la lista sirven, y el fallo no es de Faro. Remedido
contra un opencode real el 2026-09-19, con un turno de dos palabras por modelo:

| Modelo | Resultado |
|---|---|
| `github-copilot/gpt-5.6-luna` | **funciona** (es el que se usa hoy) |
| `opencode/ling-3.0-flash-fin-free` | «OpenCode's free tier can only be used from within OpenCode» |
| `opencode/big-pickle` | el mismo error del nivel gratuito |
| `opencode/jev-1.13-free` | acepta el turno y **no contesta nunca** |
| `github-copilot/claude-sonnet-4.6` | `APIError: not available for integrator "opencode"` |
| `openai/gpt-5.4` | no soportado con una cuenta de ChatGPT |

Lo importante de esa tabla: **el nivel gratuito de opencode (`opencode/*-free`,
y también `big-pickle`) ya no se puede usar desde `opencode serve`**, sólo desde
la propia TUI de opencode. Como Faro habla con el servidor, hay que elegir un
modelo del proveedor propio. `opencode/hy3-free`, que antes funcionaba, ya no
está en la lista.

Por eso Faro trae un vigilante: si un turno deja de producir contenido durante
90 segundos, se rinde, lo dice, y ofrece reintentar con otro proveedor. El
modelo que funciona se recuerda para ese sitio.

## Lo que no hace

- **No indexa «todo Confluence» literalmente.** Un espacio real tiene miles de
  páginas. Indexa en amplitud con tope, y profundiza con el uso.
- **No arranca opencode por ti, ni escribe su configuración.** Una extensión no
  puede tocar el disco. Por eso el MCP se pega a mano una vez por sitio y hay
  que reiniciar opencode. Un host de mensajería nativa resolvería ambas cosas;
  no está hecho.
- **La navegación asistida depende del DOM de Atlassian.** Cuando el destino no
  aparece, se degrada a salto directo en vez de quedarse colgado, pero si
  Atlassian rediseña la barra lateral habrá que revisar
  `src/content/tree-dom.js`. Para eso está **Ajustes → Diagnóstico del árbol**:
  lee la barra lateral de la pestaña, apunta en el Registro qué contenedor,
  filas y controles ha encontrado, y lo deja copiado. Se ajusta con datos, no a
  ojo.

- **Un análisis no marca todo lo que dice.** Sólo se subraya lo que apunta a
  un bloque del texto de la página: la cita literal si está tal cual, y si no,
  el bloque entero que señaló el modelo. Una observación general —«a esta
  página le falta un diagrama»— no apunta a ningún bloque, así que sale en la
  lista del chat en gris y sin marca. Es a propósito: la alternativa sería
  subrayar un párrafo cualquiera. Y lo que no está en los bloques —el texto
  dentro de un iframe, de un macro o de una rama plegada— no se puede marcar,
  porque no se ve.

- **Una imagen seleccionada no siempre viaja.** Si está servida desde otro
  origen, el `canvas` queda contaminado y el navegador no deja exportarla. En
  ese caso se manda su `alt`, su pie de figura y el texto de alrededor, y se
  dice en el chat que la imagen no iba.

- **El alcance «sólo estas» se le pide al modelo, no se le impone.** Las
  páginas base las lee el modelo por el MCP, y limitar sus herramientas en un
  turno no se puede: opencode convierte esa limitación en permisos permanentes
  de la sesión, que es por sitio y compartida entre turnos. Así que el alcance
  va en el prompt y, al terminar, Faro mira qué herramientas llamó el modelo:
  si buscó, recorrió el árbol o leyó una página que no estaba en la lista, lo
  dice bajo la respuesta («Fuera del alcance» en el registro). Sin MCP
  conectado no hay páginas base que valgan, y también se dice. Y cada análisis
  con páginas base cuesta una consulta por página, cuyo texto se queda en la
  sesión: por eso el tope son seis.

---

## Estructura

```
manifest.json               MV3 · key fija el id · sidePanel
src/
  panel/
    panel.js                chat, ajustes, memoria, indexador, planificador
    chat-scroll.js          ¿está el chat pegado al fondo? (puro)
    screens.js              qué pantalla cierra Escape, y con qué botón o sin
                            guardar (Ajustes) (puro)
    links.js                qué enlaces del chat se abren: el sitio, su Confluence enlazado, id.atlassian.com (puro)
    skills.js               General · Búsqueda · Resumen · Análisis; Búsqueda habla distinto en Jira (JQL) y en Confluence (árbol) (puro)
    setup.js                claves por producto → bloque MCP; hosts enlazados (puro salvo las llamadas a opencode)
    sources.js              páginas base del análisis: forma, alcance, autocompletado desde el índice, URL pegada, vigilancia del alcance (puro)
    suggestions.js          las tres sugerencias del chat vacío, por producto y por Skill (puro)
    notes.js                observaciones numeradas: el bloque JSON de anclas, su validación, la segunda pasada (puro)
    issue-profile.js        qué ticket es: tipo y estado leídos de sus campos → qué comprobar en el análisis (puro)
    prompts.js              plantillas, incluido el bloque de lo señalado y la página en bloques
  background/               orquestador del recorrido paso a paso
  content/
    overlay/                foco, subrayado, insignias, cartel — Shadow DOM cerrado
    anchor.js               escalera de anclaje + Custom Highlight API
    anchor-match.js         localización de citas (puro)
    digest.js               la página en bloques numerados, y de «¶7 + cita» a un Range
    jira-issue.js           qué es una incidencia de Jira en pantalla: título, campos, descripción, comentarios; y qué es interfaz
    overlay/rects.js        funde por línea y recorta a su caja (puro)
    tree-dom.js             qué es el árbol, una fila y su control · diagnóstico
    locators.js             cascada href → rol → texto + lista blanca de clics
    picker.js               modo de selección: subrayar texto, elegir imágenes
    pick-payload.js         lo que viaja de esa selección (puro)
    runner.js               ejecutor de un paso
  opencode/                 cliente HTTP + SSE, reconstrucción de turnos
  atlassian/                detección de sitio, índice de contenido
  nav/                      esquema NavigationPlan y su validación
  shared/
    rest-get.js             la única puerta por la que Faro lee una API REST: sólo GET, sólo al mismo sitio, con tope de tiempo y sin lanzar nunca (puro)
    jira-rest.js            lo que la API del propio Jira da exacto: consultas de plantilla, filas con claves blancas, el perfil contado de un proyecto y las búsquedas sugeridas; en Jira Cloud no pide nada (puro)
    confluence-rest.js      el árbol y la búsqueda de páginas por la API REST del sitio, con tu sesión; lo último que viste y el árbol entero de un espacio, paginado (puro)
    digest.js               cómo se enseñan los bloques y cómo se reconoce uno después (puro)
    config.js               ajustes por defecto y su migración; NAV_TIMING, el único sitio con los tiempos de la navegación; y los topes de la eficiencia: cuántos mensajes se piden al restaurar y cuándo se avisa de una conversación pesada
    storage.js              lo guardado del navegador; todo lo de un sitio en UNA lectura (getSiteBundle) y lo que arrastra la sesión abierta
    permissions.js          los permisos de cada sesión de opencode: todo denegado salvo el MCP, y una copia de cómo los evalúa opencode para probarlo (puro)
    timing.js               el cronómetro por fases que el registro enseña: sólo etiquetas y números, nunca cuerpos ni claves (puro)
harness/                    Confluence y Jira de mentira para pruebas visuales; issues.json es la fixture de la Jira falsa
test/                       arnés propio, sin dependencias; test/fixtures/prompts/ son las instantáneas de los prompts
tools/                      generación de iconos, clave del manifest, servidor del banco
  check-docs.mjs            el paso «docs» de npm run check (npm run check:docs suelto)
  jql-eval.mjs              el mini-evaluador de JQL de la Jira falsa del banco: lista blanca de cláusulas y 400 con su mensaje para todo lo demás (puro)
  last-turn.mjs             el último turno real desde una copia de opencode.db (npm run turn)
  bench.mjs                 el metro: tamaño del system por escenario y tiempos de los módulos puros (npm run bench)
  contrast-report.mjs       la tabla de contraste del panel y del overlay, por tema, con las parejas de test/contrast-pairs.js (npm run contrast); un token que no exista es un fallo, no un hueco
  prompt-snapshots.mjs      comprobar o regenerar (--update) las instantáneas de los prompts (npm run snapshots)
AGENTS.md                   puntero a CLAUDE.md, que es el mapa del proyecto para una sesión nueva
```
