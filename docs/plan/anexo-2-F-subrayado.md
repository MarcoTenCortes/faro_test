<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# F · Subrayado más bonito: cursor «subrayador azul», marcas tipo rotulador, insignias, foco, barra de «Señalar» y color

## Resumen

Lo he mirado en el banco (en el Browser pane, a 364 px de ancho y con capturas, en claro y en un oscuro simulado). Hay tres problemas de verdad, además de que se vea soso: (1) en oscuro, el texto que queda bajo una marca baja de 8,95:1 a 3,63:1 y no llega a AA, porque la capa del overlay pinta el ámbar ENCIMA de la letra y además se suma al ::highlight que ya va debajo; (2) las insignias [n] tapan las dos o tres primeras letras de la palabra que sigue a la cita; (3) mientras se señala, la selección es la gris del sistema y el cursor es la cruz de siempre.

He comprobado ejecutándolo: (a) mix-blend-mode en .quote-rect NO hace nada, porque el host del overlay (fixed, z-index) aísla la mezcla; (b) un host propio para las marcas, con multiply en claro y screen en oscuro, deja el texto oscuro y nítido bajo un rotulador con forma de verdad; (c) ::highlight admite subrayado grueso u ondulado con desplazamiento, y ::selection dentro de html.faro-picking pinta la selección en azul con subrayado; (d) Chrome acepta el cursor SVG de 32×32 con el punto activo en la punta (lo he diseñado y renderizado).

Recomiendo lo siguiente: el azul para la HERRAMIENTA (el cursor, la selección, la barra y el recuadro al señalar) y también como color por defecto del rotulador sobre la página; las insignias y el --mark del panel siguen en ámbar, que es la marca de Faro, así que los pines de panel-css siguen valiendo. Además, un ajuste «Color del subrayado» (azul, ámbar o verde) con tokens propios en el overlay, y el nuevo estilo «Rotulador» con el host de mezcla, con ::highlight de respaldo.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[ejecutado]** Inventario del subrayado de hoy. Hay DOS rellenos a la vez sobre la misma cita: por un lado ::highlight(faro-quote) con background rgba(233,172,74,.28), que va DEBAJO del texto y vive en la hoja del documento; por otro, .quote-rect con un degradado vertical de rgba(233,172,74,.10) a .22, un filete inferior de 2 px en #E9AC4A (box-shadow inset 0 -2px 0), radio de 3 px, overflow hidden, aparición con opacity .4 s y un barrido blanco al 55 % de 1,1 s. La observación activa sube el degradado a .28-.46 con el filete en #C98A22. En código queda un relleno de .13 y un filete de 2 px (3 px si está activa).
  - Evidencia: src/content/overlay/styles.js:221-269 (quote-rect, sweep, on-code), 342-351 (.active), 451-456 (HIGHLIGHT_CSS); getComputedStyle en el banco: backgroundImage «linear-gradient(rgba(233,172,74,0.1), rgba(233,172,74,0.22))», boxShadow «rgb(233,172,74) 0px -2px 0px 0px inset», CSS.highlights.size = 1
- **[leido-en-codigo]** Inventario del resto de piezas. Foco: .spot con box-shadow 0 0 0 100vmax rgba(19,18,24,.58), 1,5 px de ámbar y 6 px de resplandor rgba(233,172,74,.34), radio 10 px, transiciones de .52 s y una respiración de 2,6 s. Anillo: SVG de 2 px en ámbar que se dibuja en .72 s. Llegada y modo «marker»: .spot.flat con fondo rgba(233,172,74,.16), filete de 1 px y trazo inferior de 2 px, sin anillo. Insignia: pastilla de 17 px de alto, fondo #E9AC4A, borde #C98A22, texto #1B1405 a 10,5 px/700, sombra 0 1px 3px; activa y con el ratón encima pasa a #C98A22 con un halo de 3 px. Cartel y aviso: papel blanco o #22212B, radio 12/10 px y sombra --faro-shadow. Barra de «Señalar»: centrada abajo, max-width min(560px, 92vw), con el faro, el texto, la pista y los botones. Recuadro al pasar por una imagen: 1 px ámbar sobre un .10. Cursor: html.faro-picking * { cursor: crosshair !important } y copy sobre las imágenes. Tema oscuro: :host(.faro-dark) sólo cambia tinta, papel, línea, velo y sombra, y el ámbar no cambia.
  - Evidencia: styles.js:16-44, 50-97, 101-219, 282-299, 310-340, 366-402, 406-426, 465-473; overlay.js:159-165 (_applyColorScheme lee data-color-mode o prefers-color-scheme)
- **[ejecutado]** Lo que se ve y chirría en claro (captura de la página 200 con tres observaciones): las marcas son un rectángulo de color melocotón apagado (los dos rellenos sumados) con una raya naranja a ras del borde inferior, que corta los descendentes; son rectángulos de esquina casi recta y no parecen un rotulador; la marca activa apenas se distingue de las demás. Las insignias van centradas en la línea, 3 px detrás del último carácter, y TAPAN el texto que sigue: la 1 tapa la coma, la 2 tapa «de» y la 3 tapa «ha» de «hasta».
  - Evidencia: Captura del Browser pane tras faroHarness.actions.notes(); posición de las insignias en overlay.js:665-670 (left = derecha + 3, top = centro de la línea - 8,5)
- **[ejecutado]** En oscuro, el texto que queda bajo una marca baja de AA. Con una página oscura de Atlassian simulada (fondo #1D2125, texto #B6C2CF) el texto marcado se ve marrón turbio: 8,95:1 sin marca y 3,63:1 con la marca de hoy, porque .quote-rect va ENCIMA de la letra (a .16 de media) y se suma al .28 del ::highlight que va debajo. Con sólo el ::highlight al .28 serían 4,91:1. En claro, de 14,10 a 7,97 (con sólo el ::highlight, 11,71).
  - Evidencia: scratchpad/areaF/azules.mjs (usa test/contrast.js del repo), bloque 2: «oscuro ámbar hoy sin marca 8.95 · hoy (debajo .28 + encima .16) 3.63 … sólo debajo .28 4.91»; captura con data-color-mode=dark y la hoja probe-dark
- **[ejecutado]** mix-blend-mode puesto en .quote-rect (o en cualquier nodo de dentro del shadow root) NO se mezcla con la página: el host (position fixed + z-index 2147483600) forma un contexto de apilamiento aislado. Las capturas con multiply y con normal salen idénticas. Poniendo mix-blend-mode: multiply en el HOST sí se mezcla, pero las insignias también se vuelven transparentes y se ve el texto a través («y1», «de2»).
  - Evidencia: Banco: getComputedStyle(.quote-rect).mixBlendMode = 'multiply' con la captura igual a la de 'normal'; ov.host.style.mixBlendMode='multiply' da la captura con las insignias transparentes. Host: position fixed, zIndex 2147483600, contain «layout style»
- **[ejecutado]** Un host APARTE para las marcas (un div fixed en el documento, fuera del shadow del cartel, con mix-blend-mode multiply en claro y screen en oscuro) permite dibujar un rotulador de verdad: la franja cubre el 72 % inferior de la línea, con radios irregulares, skewX(-6deg) y rotate(-.4deg). El texto sigue oscuro y nítido en claro y claro y legible en oscuro, y las insignias, que siguen en el host de siempre, no se ven afectadas.
  - Evidencia: Banco: div #probe-marks con los rectángulos de la cita, claro y oscuro. Medido (scratchpad/areaF/rotulador.mjs): azul #93C5FD α.5 multiply → texto 11,20:1 en claro; #1D4ED8 α.45 screen → texto 6,01:1 en oscuro
- **[ejecutado]** ::highlight() en el Chromium del pane acepta el subrayado con grosor, estilo (también wavy) y desplazamiento: la regla se quedó como «text-decoration: underline 2px wavy rgb(37,99,235); text-underline-offset: 4px» y se pintó. MDN dice que sólo se admiten color, background-color, text-decoration y sus longhands, text-shadow y -webkit-text-stroke/fill; background-image se ignora, así que dentro de ::highlight no hay degradados, esquinas redondeadas ni forma de rotulador.
  - Evidencia: cssRules[0].cssText en el banco; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::highlight
- **[ejecutado]** html.faro-picking ::selection { background-color: rgba(59,130,246,.32); color: inherit; text-decoration: underline 2px #2563EB; text-underline-offset: 3px } pinta la selección en azul de rotulador mientras se señala, y lo hace también con la ventana sin foco, donde hoy sale el gris inactivo del sistema.
  - Evidencia: Banco: se añadió a #faro-pick-style con el picker activo; la selección pasó del gris a azul con subrayado
- **[ejecutado]** El cursor SVG de 32×32 como data URL, con cursor: url("data:image/svg+xml;utf8,…") 5 27, crosshair, se acepta: getComputedStyle(html).cursor empieza por url( y la imagen decodifica a 32×32. Renderizado a 1× y 3× sobre blanco y sobre #1D2125, se lee como un subrayador inclinado 45°, con el cuerpo azul, la anilla marino, la punta biselada azul oscuro, halo blanco, sombra suave y un trazo de tinta bajo la punta. El cursor en sí no sale en las capturas del pane, así que no he visto el puntero de verdad moviéndose.
  - Evidencia: scratchpad/areaF/cursor.mjs → cursor-claro.svg y cursor-oscuro.svg (1319 caracteres; la URL tiene 1471); javascript en el banco: {cursorAceptado:true, w:32, h:32}
- **[leido-en-doc]** Límites del cursor: Chromium y Firefox limitan la imagen a 128×128 y se recomienda 32×32; una más grande se ignora. El punto activo va en píxeles de la imagen, desde arriba a la izquierda, y se acota a la imagen. Se admite SVG estático con tamaño propio. Que Chromium bloquee los cursores de más de 32 px cuando se solapan con la interfaz del navegador lo sé de memoria y no lo he verificado aquí. La nitidez del SVG a 150 % de escala en Windows tampoco está verificada.
  - Evidencia: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/cursor
- **[ejecutado]** Barra de «Señalar»: a 1280 px mide 560×52 y el texto elegido sólo tiene 163 px (va con elipsis), mientras que la pista «Vuelve a subrayar para cambiarlo» se lleva 168 px. A 364 px el texto desaparece del todo (0 px), «Usar esto» se parte en dos líneas y «Cancelar» se sale por la derecha.
  - Evidencia: Banco: pickBar.getBoundingClientRect y sus hijos {bar:[560,52], pick-text:163x18, pick-hint:168x16}; captura a 364 px
- **[leido-en-codigo]** El ajuste highlightStyle 'spotlight'|'marker' ya existe (su valor por defecto es 'spotlight'). El panel lo ofrece con dos radios, «Foco» y «Subrayado — marca el texto en amarillo…», y llega a la página por pushSettings → bootstrap → runner.setHighlightStyle → overlay.setStyle, que pone :host(.faro-marker). Sólo cambia el FOCO (lo hace plano); no toca las marcas numeradas.
  - Evidencia: src/shared/config.js:60; src/panel/panel.html:304-305; src/panel/panel.js:6135-6136, 6687; src/content/bootstrap.js:179; src/content/runner.js:56-57; overlay.js:150-157; service-worker.js:304; styles.js:282-299
- **[ejecutado]** Tabla de azules medida con test/contrast.js. Con --on-mark #1B1405 encima llegan a 4,5 #93C5FD 10,14 · #85B8FF 8,96 · #60A5FA 7,19 · #579DFF 6,68 · #4C9AFF 6,42 · #388BFF 5,49 · #3B82F6 4,97 · #2F7BF5 4,59; no llegan #2563EB 3,54 · #0C66E4 3,51 · #1D4ED8 2,73. Como control (≥3) en oscuro sobre --surface, --ground y --surface-2: #60A5FA 6,78/7,33/6,26 · #3B82F6 4,69/5,06/4,32 · #2563EB 3,34/3,60/3,08. En claro ningún azul que lleve texto oscuro llega a 3 sobre blanco (#3B82F6 3,68 es el más claro que sí llega, pero como relleno de texto se queda en 4,97). Hoy el ámbar da 9,11 con --on-mark, y la fila CONTROL de --mark sólo se exige en oscuro.
  - Evidencia: node scratchpad/areaF/azules.mjs, bloque 1
- **[ejecutado]** Un ENLACE de Atlassian dentro de la marca ya baja de AA hoy: en claro #0C66E4 sobre ámbar .28 da 4,32 (5,20 sin marca) y en oscuro #579DFF da 3,25 (5,92 sin marca). Con el rotulador azul propuesto (#93C5FD α.5 multiply en claro, #1D4ED8 α.45 screen en oscuro) el enlace da 4,41 y 4,14: mejor que hoy en los dos temas, pero sigue sin llegar a 4,5. Con azul saturado a α.5 (#3B82F6) daría 3,64: peor.
  - Evidencia: azules.mjs bloque 3; rotulador.mjs y rotulador2.mjs
- **[leido-en-codigo]** Pines que hoy protegen el color: panel-css.test.js exige --mark === --faro-gold, --mark-strong === --faro-gold-deep, el mismo ámbar en oscuro, --on-mark === el color del .btn-primary del overlay, que no esté #FFF7E8 y que .btn-primary:hover, .note-badge:hover y .note-badge.active lleven color #1B1405. contrast-pairs.js mide OVERLAY_REGLAS (.btn-primary, sus :hover, .note-badge, :hover y .active) y OVERLAY_TOKENS. overlay-wiring.test.js pina la geometría y el repintado de P1 (_syncNodes, _measureGroups, sweep, if (nuevo && sweep)) y el Escape. El banco mira faro-marker en el tramo 20 y faro-picking en el 22.
  - Evidencia: test/unit/panel-css.test.js:161-184; test/contrast-pairs.js:102-115; test/unit/overlay-wiring.test.js:113-178; harness/harness.js:1934-1994
- **[ejecutado]** El foco del recorrido (el velo al .58, el anillo dorado de 1,5 px y el cartel con «Llévame» en ámbar) se ve limpio y coherente. Es la pieza que menos necesita cambiar.
  - Evidencia: Captura del banco con ov.spotlight(h2) + showCard

## Opciones

### (i) Azul sólo para la herramienta de «Señalar»; las marcas siguen en ámbar

El cursor subrayador azul, ::selection azul mientras se señala, el faro y el botón de la barra de selección en azul y el recuadro al pasar por una imagen en azul. Los resultados (las marcas numeradas, la llegada y las insignias) siguen en ámbar; eso sí, se arreglan legibilidad y forma: el relleno se mueve a ::highlight y el trazo pasa a ser una pastilla.

**A favor**

- Ningún pin de panel-css cambia; contrast-pairs sólo gana filas del overlay
- Separa bien lo que hace el usuario (azul) de lo que marca Faro (ámbar)
- Es lo más barato

**En contra**

- El usuario pidió «azul» y seguramente se refería también a cómo queda marcado el texto
- El ámbar en oscuro sigue siendo el peor caso para los enlaces (3,25 hoy)

**Esfuerzo**: S: styles.js (PICK_CSS, pick-bar y pick-hover), cursor en un módulo aparte, 1-2 pruebas nuevas y el tramo 22 del banco

### (ii) Todo azul: --mark pasa a azul en el panel Y en el overlay

--faro-gold/--mark a #60A5FA, --mark-strong a #3B82F6 y --on-mark a #0A1A33 (tinta marino: 6,83 y 4,72) o #1B1405 (7,19 y 4,97). También cambian las insignias, los botones primarios del panel, .send, la pastilla [n], el faro y el anillo de foco del panel.

**A favor**

- Un solo color en todo el producto
- Con #60A5FA/#3B82F6 los pares medidos cumplen: texto ≥4,5 y control en oscuro ≥4,3

**En contra**

- Rompe la identidad de «Faro» (dorado): --gold, --gold-bg y --gold-line del panel siguen siendo ámbar para acentos, y quedarían mezclados azul y dorado, o habría que repintar todo el panel (23 parejas TEXTO)
- Choca con el azul de Atlassian (#0C66E4, botones y enlaces): la marca se confunde con la interfaz del sitio
- Cambia los pines de panel-css (las tres igualdades y el color del texto del botón), el espejo, las capturas del rediseño H4/H5, INSTALL y README
- En claro un --mark azul no llega a 3 sobre blanco (igual que el ámbar), así que la fila CONTROL sigue siendo sólo de oscuro

**Esfuerzo**: L: panel.css (tres bloques de tema), styles.js, contrast-pairs, panel-css.test (reescribir el pin), el espejo, 20 capturas, npm run contrast y la documentación

### (iii) Azul en la herramienta + «Color del subrayado» (azul por defecto, ámbar o verde) con tokens propios del overlay

La herramienta de «Señalar» es siempre azul (el cursor y la selección). Las marcas de resultado usan tokens nuevos del overlay (--faro-ink-fill, --faro-ink-stroke, --faro-ink-alpha) por color, elegidos con :host(.faro-tinta-azul|ambar|verde), y con azul por defecto. Las insignias [n] y el --mark del panel siguen en ámbar, así que la insignia de la página sigue siendo la misma pastilla que la del chat y el pin sigue siendo verdad. Un ajuste nuevo, highlightColor: 'azul'|'ambar'|'verde', viaja por pushSettings como highlightStyle.

**A favor**

- Cumple el «azul» del usuario sin tocar la identidad del panel ni sus pines
- Una insignia ámbar sobre un rotulador azul contrasta mejor que ámbar sobre ámbar (se ve el número)
- Quien prefiera el ámbar de siempre lo recupera con un clic
- Medido: el azul da un texto de 11,20 en claro y 6,01 en oscuro; los enlaces, 4,41 y 4,14, mejor que hoy (4,32 y 3,25)

**En contra**

- Un ajuste más y una clave más en el mensaje SETTINGS (service-worker.test.js pina sus claves exactas)
- Hay que declarar filas nuevas en contrast-pairs por color y tema

**Esfuerzo**: M: styles.js, overlay.js (el host de marcas + setTint), picker/PICK_CSS, config.js, panel.html/panel.js (radios), service-worker pushSettings + su prueba, contrast-pairs + panel-css/overlay-wiring, banco 20/22/27/41/42 y un tramo nuevo, INSTALL «Ajustes»

### Forma de la marca A: relleno en ::highlight y trazo en el overlay (sin mezcla)

El .quote-rect pierde el relleno: el relleno lo pone sólo ::highlight(faro-quote), por debajo del texto, y ::highlight(faro-quote-activa) con más prioridad para la activa. El overlay dibuja un trazo en pastilla de 3 px con los extremos redondeados, 1 px por debajo de la línea, y el barrido pasa a «dibujarse» de izquierda a derecha con scaleX.

**A favor**

- Arregla el AA en oscuro (3,63 → 4,91 en ámbar, 6,13 con #3B82F6) sin estructura nueva
- El relleno lo mueve el navegador al hacer scroll, sin JS
- Coste de rendimiento cero

**En contra**

- El relleno ocupa la caja de línea entera, en rectángulo y sin esquinas: se parece a una selección más que a un rotulador
- El relleno no se puede animar (aparece de golpe)

**Esfuerzo**: S-M: styles.js (HIGHLIGHT_CSS, quote-rect), overlay.js (_setHighlight con dos nombres), overlay-wiring

### Forma de la marca B: «Rotulador» en un host de mezcla propio (multiply en claro, screen en oscuro)

Un segundo host (#faro-marks-host) fixed, con pointer-events none y su propio shadow cerrado, a z-index 2147483599, con mix-blend-mode multiply, o screen con :host(.faro-dark). Ahí van los .quote-rect con forma de rotulador (el 72 % inferior de la línea, radios irregulares, skewX(-6deg)) y el barrido con scaleX. Las marcas sobre código se quedan en el host de siempre (sólo el trazo), porque multiply sobre un fondo oscuro las haría invisibles. ::highlight se queda como respaldo con forced-colors o si el host falla.

**A favor**

- Es lo que de verdad parece un subrayador (verificado en las capturas)
- El texto sigue oscuro y nítido bajo la tinta (11,20 en claro y 6,01 en oscuro con el azul propuesto)
- El barrido se puede convertir en un trazo que se dibuja

**En contra**

- Hay una segunda raíz en el documento y un segundo _syncNodes a mantener
- mix-blend-mode sobre una capa fija que ocupa toda la ventana obliga a leer el fondo en cada frame de scroll: coste de GPU sin medir
- Elegir entre multiply y screen depende de que faro-dark acierte con el tema de la página

**Esfuerzo**: M-L: overlay.js (mount del segundo host, _paintQuoteRects hacia la capa que toque, destroy), styles.js (MARKS_CSS), overlay-wiring (pines de P1 sobre la capa nueva), tramos 27/41/42 del banco

## Recomendación del investigador

OPCIÓN (iii) de color + FORMA A de serie, más FORMA B como el estilo nuevo «Rotulador», que pasa a ser el valor por defecto después de medirlo. En detalle:

1) CURSOR (siempre azul). Módulo puro nuevo src/content/overlay/cursor.js con dos SVG de 32×32 y el punto activo en «5 27»; en PICK_CSS: html.faro-picking, html.faro-picking * { cursor: url("data:image/svg+xml;utf8,<SVG con # → %23, < → %3C, > → %3E>") 5 27, text !important } (respaldo text, no crosshair, porque lo que se hace es seleccionar texto); html.faro-picking.faro-oscuro con la variante oscura; las imágenes conservan copy (o una segunda variante «subrayador con marco» si se quiere). La clase oscura la pone setPicking reutilizando el cálculo de _applyColorScheme. SVG de la variante clara (el mismo que genera scratchpad/areaF/cursor.mjs):
<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M6.5 29.6H15' stroke='#3B82F6' stroke-opacity='.55' stroke-width='3' stroke-linecap='round'/><g transform='translate(6.2 28.2) rotate(45)' opacity='.22'><path d='M0 0L-3.6-4.2V-7H3.6V-3.4Z' fill='#000'/><rect x='-4.6' y='-10.6' width='9.2' height='3.9' rx='1' fill='#000'/><rect x='-5' y='-28.4' width='10' height='18.2' rx='2.4' fill='#000'/><rect x='-5' y='-31' width='10' height='3.4' rx='1.6' fill='#000'/></g><g transform='translate(5 27) rotate(45)'><g stroke='#FFFFFF' stroke-width='2.6' stroke-linejoin='round'>…la misma pieza rellena de #FFFFFF…</g><g stroke='#0A1A33' stroke-width='.9' stroke-linejoin='round'><path d='M0 0L-3.6-4.2V-7H3.6V-3.4Z' fill='#1D4ED8'/><rect x='-4.6' y='-10.6' width='9.2' height='3.9' rx='1' fill='#0A1A33'/><rect x='-5' y='-28.4' width='10' height='18.2' rx='2.4' fill='#3B82F6'/><rect x='-5' y='-31' width='10' height='3.4' rx='1.6' fill='#1D4ED8'/></g><rect x='-2.9' y='-26.6' width='1.8' height='14.6' rx='.9' fill='#fff' fill-opacity='.5'/></g></svg>
Variante oscura: cuerpo #60A5FA, punta #93C5FD, tapa #2563EB, halo #E6EEFF y trazo #60A5FA. Sin animación (un cursor animado no se admite y tampoco hace falta para prefers-reduced-motion). Contraste del cuerpo: #3B82F6 da 3,68 sobre blanco y 4,40 sobre #1D2125, y el halo blanco y el contorno marino lo separan de cualquier fondo.

2) SELECCIÓN AL SEÑALAR. En PICK_CSS: html.faro-picking ::selection { background-color: rgba(59,130,246,.32); color: inherit; text-decoration: underline 2px #2563EB; text-underline-offset: 3px }. Barra: el faro de la barra en azul (--faro-tool: #2563EB), .pick-hover con borde 1,5 px #3B82F6 sobre un rgba(59,130,246,.10) con radio de 4 px, y en la barra la pista cede antes que el texto (.pick-hint { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis } y .pick-text { flex: 1 1 60% }). Con @media (max-width: 480px), la pista se oculta y la barra envuelve (flex-wrap: wrap), que es el fallo medido a 364 px. El botón «Usar esto» sigue siendo el .btn-primary ámbar: el pin de --on-mark sigue en pie y es la acción de Faro.

3) MARCAS (el resultado). Tokens por color en :host: --faro-tinta y --faro-tinta-trazo, con :host(.faro-tinta-azul) { --faro-tinta: #93C5FD; --faro-tinta-alfa: .5; --faro-tinta-trazo: #2563EB } y en :host(.faro-dark.faro-tinta-azul) { --faro-tinta: #1D4ED8; --faro-tinta-alfa: .45; --faro-tinta-trazo: #60A5FA }; el ámbar con #E9AC4A .55 / #C98A22 .5 y el verde con #34D399 .55 / #059669 .5 (medidos en rotulador.mjs: texto 10,95/4,14 y 10,51/4,59). Si el estilo es «Rotulador» (B): .quote-rect { top: calc(+28%); height: 72%; border-radius: 3px 7px 5px 8px / 6px 4px 7px 5px; transform: skewX(-6deg) rotate(-.4deg); background: linear-gradient(90deg, color-mix(in srgb, var(--faro-tinta) 85%, transparent), var(--faro-tinta) 12% 88%, color-mix(in srgb, var(--faro-tinta) 75%, transparent)); opacity: var(--faro-tinta-alfa) }, dentro del host de mezcla (multiply, o screen en oscuro). La geometría (72 % inferior) se calcula en _paintQuoteRects y no en CSS, porque setBox fija la altura. Si el estilo es «Subrayado» o «Foco» (A): relleno por HIGHLIGHT_CSS ::highlight(faro-quote) { background-color: color-mix(var(--tinta) 26%) } (definido con valores literales por color, porque la hoja vive en el documento y no ve las variables del host), y .quote-rect se queda en un trazo: background: none; height: 3px; top = parte baja de la línea + 1 px; border-radius: 999px; background-color: var(--faro-tinta-trazo); box-shadow: 0 0 0 1px color-mix(var(--faro-tinta-trazo) 25%). Barrido: se sustituye el destello blanco por un «se dibuja», @keyframes faro-tinta { from { transform: scaleX(0) } to { transform: scaleX(1) } } con transform-origin: left, .45 s, var(--faro-ease), escalonado como hoy (60 + i·40 ms), y quitado con faro-still y prefers-reduced-motion. Activa: la tinta al 100 % de alfa y el trazo de 3 a 4 px más oscuro; en ::highlight, un segundo nombre, faro-quote-activa, con priority 1. En código: nunca en el host de mezcla, sólo el trazo de 2 px como hoy.

4) INSIGNIAS. Pasan a ser un superíndice que no tapa la palabra siguiente: top = ultimo.top - 6, left = ultimo.right + 1 (en _paintNoteBadges, la función libre() se queda). Miden 16 px, con radio 999 px, fondo var(--faro-gold), borde 1 px var(--faro-gold-deep), texto #1B1405 (el pin sigue), anillo blanco de 2 px (box-shadow: 0 0 0 2px var(--faro-paper), 0 1px 3px rgba(19,18,24,.35)) para despegarla del texto, y entrada con scale .6→1 más opacidad en .28 s var(--faro-ease) (sin rebote, que es la regla del fichero). Con el ratón encima o activa: fondo --faro-gold-deep con halo de 3 px rgba(233,172,74,.38), como hoy.

5) FOCO Y LLEGADA. Se quedan igual en el modo «Foco». La llegada (.spot.flat) hereda la tinta del color elegido en vez del ámbar fijo.

6) AJUSTES. highlightStyle pasa de dos a tres valores: 'rotulador' (nuevo y por defecto cuando pase la medida de rendimiento), 'marker' y 'spotlight'; migrateSettings deja el que ya hubiera elegido el usuario. Se añade highlightColor: 'azul' por defecto. En el panel, «Cómo te señala Faro» con los tres radios y «Color del subrayado» con tres muestras; el texto «marca el texto en amarillo» del radio actual deja de ser verdad y hay que cambiarlo.

## Ficheros y pines que toca

- src/content/overlay/styles.js: OVERLAY_CSS (tokens de tinta por color, .quote-rect en trazo o rotulador, keyframes faro-tinta, insignias, pick-bar y pick-hover responsivos), HIGHLIGHT_CSS (dos nombres, activa y normal, y color por tinta), PICK_CSS (el cursor, ::selection y la variante oscura); más un MARKS_CSS nuevo si va la forma B
- src/content/overlay/cursor.js (NUEVO, puro): los dos SVG y la función que los pasa a url() con # y < > codificados; con su test test/unit/cursor.test.js (32×32, punto activo dentro, sin «#» crudo en la URL, sin <script> ni on*, longitud ≤ 2 KB)
- src/content/overlay/overlay.js: mount() crea el segundo host de mezcla (forma B) y destroy() lo quita; _paintQuoteRects manda a cada rectángulo a su capa (código → la de siempre) y calcula la geometría del 72 %; _paintNoteBadges cambia a superíndice; setTint(color) como setStyle; _setHighlight con faro-quote y faro-quote-activa; setPicking añade la clase oscura
- src/content/picker.js: sin cambios de lógica (la barra y el cursor viven en el overlay y en PICK_CSS); quizá acortar la pista 'Vuelve a subrayar para cambiarlo'
- src/content/runner.js:56 setHighlightStyle acepta 'rotulador' y un setHighlightColor nuevo; src/content/bootstrap.js:179 pasa msg.highlightColor
- src/shared/config.js:60 DEFAULT_SETTINGS.highlightStyle y un highlightColor nuevo, más migrateSettings; test/unit/settings.test.js
- src/background/service-worker.js:304 pushSettings con highlightColor; test/unit/service-worker.test.js:482 pina las claves EXACTAS ['highlightStyle','reduceMotion','timing','type'] → cambia a propósito
- src/panel/panel.html:304-305 (los radios y el texto «en amarillo»), src/panel/panel.js:6135-6136 y 6687 (leer y guardar), panel-wiring.test.js (los ids nuevos existen)
- test/contrast-pairs.js: OVERLAY_REGLAS gana .pick-bar .btn-primary si cambia, y filas nuevas para la tinta por color y tema (texto de la página bajo la tinta ≥4,5 con el modelo de mezcla; se necesitaría una ayuda blendMode en test/contrast.js, que hoy sólo hace source-over)
- test/unit/panel-css.test.js:161-184: con la opción (iii) los pines --mark === --faro-gold, --mark-strong === --faro-gold-deep y --on-mark = texto del .btn-primary SIGUEN VALIENDO (la insignia y el botón siguen en ámbar); con la opción (ii) habría que reescribirlos
- test/unit/overlay-wiring.test.js: los pines de P1 (_syncNodes en las tres capas, if (nuevo && sweep), _measureGroups una vez) tienen que seguir cumpliéndose también en la capa del host de mezcla; pin nuevo: los .quote-rect sobre código NO van al host de mezcla, y destroy() quita los dos hosts
- harness/harness.js: el tramo 20 (modo subrayado: faro-marker) y el 22 (faro-picking) ganan un ok( por el cursor url( y el ::selection; el 27 (código desplazado: la marca se recorta al bloque) y el 41 (40 scrolls, created 0) tienen que pasar con el host nuevo; el 42 (página larga con 12 marcas) mide los ms; tramo nuevo: el rotulador en claro y en oscuro, la insignia sin solaparse con el carácter siguiente (comparando su rect con el Range del carácter siguiente) y la mezcla presente sólo fuera de código
- harness/panel-preview.html: los radios nuevos de Ajustes (el espejo no pinta la página)
- docs/INSTALL.md:1686 «Ajustes → Cómo te señala Faro → Subrayado» y la lista de ajustes; README; CLAUDE.md §3 (styles.js, overlay.js, cursor.js), §6 (Ajustes: highlightColor), §8.8/§8.10/§8.11 (una marca por línea recortada: sigue; en código sólo el trazo: sigue; resaltado con Custom Highlight + overlay: ahora también un host de mezcla)

## Riesgos y límites

- Rendimiento de la forma B: mix-blend-mode en un host fixed que ocupa toda la ventana obliga al compositor a leer el fondo de la página en cada frame de scroll. No lo he medido (con JS no se puede; hace falta un trace de Performance en el banco con scrollStress y stress, 12 marcas, en claro y oscuro). Mitigación: el host de mezcla sólo existe mientras hay marcas (display none si no) y se limita a la caja que envuelve las marcas. P1 de H6 (un frame por ráfaga) sigue valiendo, porque la mezcla no añade trabajo de JS
- Elegir entre multiply y screen depende de _applyColorScheme (data-color-mode o prefers-color-scheme). Una zona clara dentro de una página oscura (o al revés) dejaría la tinta invisible o lavada; en código se evita mandándola a la capa normal. Hay que ver esto en el Confluence y el Jira reales con su tema oscuro
- Custom Highlight API sólo admite color, background-color, text-decoration*, text-shadow y -webkit-text-stroke/fill (MDN; background-image se ignora): con la forma A no hay degradado, radio ni animación del relleno. Y HIGHLIGHT_CSS vive en el documento y no ve las variables del :host, así que el color de ::highlight hay que escribirlo en literal por cada tinta (o con una clase en <html>, como faro-picking)
- Un enlace de Atlassian (azul) dentro de la tinta azul se queda en 4,41 en claro y 4,14 en oscuro: mejor que hoy (4,32 y 3,25), pero por debajo de 4,5. Límite anotado, no regresión; con α más baja mejora a costa de que la marca se vea menos (la marca frente a la página baja a 1,33-1,6)
- El cursor data: SVG dentro de un <style> de la página: la CSP de img-src de Confluence o Jira podría bloquear data: (no verificado; el banco no tiene CSP). El respaldo ', text' lo deja usable. Alternativa: servir el SVG como recurso web_accessible (src/content/overlay/ ya está expuesto con use_dynamic_url) usando chrome.runtime.getURL, aunque la CSP de la página seguramente también aplique ahí (supuesto)
- La nitidez del SVG del cursor con escalado de Windows al 125-150 % no está verificada: Chromium puede rasterizarlo a 1× y escalarlo. Si sale borroso, image-set() con una variante 2× (64×64 con el mismo punto activo escalado); ojo con el límite de 32 px cuando se solapa con la interfaz (lo sé de memoria, sin verificar)
- Poner la insignia como superíndice puede pisar los descendentes de la línea de ARRIBA con un interlineado apretado; el anillo de 2 px del papel lo separa, y libre() sigue evitando que dos insignias se pisen
- La forma B añade un segundo shadow root en el documento: hay que incluirlo en destroy(), en interceptsEscape (no le afecta: las marcas no cuentan) y en que el content script no toque el contenido (§8.11 se cumple: sigue colgado de <html>)
- forced-colors (alto contraste de Windows): con mix-blend-mode y los rellenos anulados, en @media (forced-colors: active) conviene volver a outline: 2px solid Highlight en .quote-rect
- No he visto moverse el puntero de verdad (el cursor no sale en las capturas del pane) ni he cargado la extensión en Chrome: todo está en el banco con los módulos de verdad del overlay y sondas inyectadas

## Decisiones que el investigador deja a Marco

- Color: ¿vale la opción (iii)? Herramienta de «Señalar» siempre azul, subrayado azul por defecto con ámbar y verde a elegir, y las insignias [n] y los botones de Faro en ámbar (la marca de siempre). ¿O prefiere (ii), todo azul, que obliga a repintar el panel entero y choca con el azul de Atlassian?
- Estilo por defecto: ¿el nuevo «Rotulador» (multiply/screen, la forma de las capturas) pasa a ser el defecto después de medir el rendimiento en su Jira, o se queda como opción y el defecto sigue siendo «Foco»?
- ¿Se conservan los tres estilos (Rotulador · Subrayado · Foco) o se funden «Subrayado» y «Rotulador» en uno para no llenar Ajustes?
- Insignias: ¿como superíndice encima del final de la cita (no tapa texto, estilo nota al pie) o en el margen derecho cuando haya sitio?

## Pruebas propuestas

- Unitaria nueva test/unit/cursor.test.js: los dos SVG miden 32×32, el punto activo está dentro y en la punta (se comprueba con el transform), la URL no lleva «#», «<» ni «>» sin codificar, ni <script> ni atributos on*, y ocupa ≤ 2 KB; PICK_CSS contiene cursor: url( … ) 5 27, text y la variante oscura
- styles/overlay (por regex, estilo overlay-wiring): .quote-rect sin relleno en el estilo «Subrayado»; HIGHLIGHT_CSS con faro-quote y faro-quote-activa; ::selection sólo dentro de html.faro-picking (nunca global: no hay que pisar la selección de la página fuera de «Señalar»); los keyframes del barrido anulados con faro-still y con prefers-reduced-motion; ningún mix-blend-mode dentro de OVERLAY_CSS (sería inerte, como demostró la sonda) y sí en el host de marcas
- overlay-wiring: _paintQuoteRects manda enCodigo a la capa normal y lo demás a la de mezcla; destroy() quita los dos hosts; los pines de P1 se repiten sobre la capa nueva
- contrast.js: ayuda nueva blendWith(fondo, capa, alfa, 'multiply'|'screen') con los números de esta sonda como caso fijo (azul claro: texto 11,20; azul oscuro: 6,01), y en contrast-pairs.js una tabla TINTAS por color y tema exigiendo que el texto de la página bajo la tinta sea ≥4,5 (el enlace se imprime como anotado y no se exige)
- settings.test.js/service-worker.test.js: highlightColor por defecto 'azul', migrateSettings respeta lo elegido, y pushSettings con claves exactas ['highlightColor','highlightStyle','reduceMotion','timing','type']
- Banco, tramo nuevo 63: con runner.setHighlightStyle('rotulador') y 12 marcas, el host de mezcla existe, las marcas sobre código NO están en él, ninguna insignia se solapa con el rect del carácter que sigue a su cita, y con faro-dark el host usa screen; el 22 gana un ok( por el cursor url( y por ::selection; el 27, 41 y 42 en verde con el host nuevo (41: created 0 tras 40 scrolls)
- Rendimiento: trace de Performance en el banco (acciones scrollStress y stress) con y sin el host de mezcla, comparando el tiempo de frame (p95) en la MISMA máquina, como hace npm run bench
- Aceptación visual: capturas en el banco a 1280×900 (con el Browser pane a la vista, o en una pestaña de Chrome) de página 200 + tres observaciones, issue:ENG-7, page:largo y un bloque de código, × claro y oscuro (data-color-mode=dark) × los tres estilos × los tres colores, más «Señalar» con la selección azul y la barra a 1280 y a 480 px. Y en el Confluence y Jira reales de Marco con su tema oscuro, mirando la CSP del cursor data:

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/areaF\azules.mjs — contraste de los azules candidatos con test/contrast.js del repo (relleno, control, texto bajo la marca de hoy, enlaces, trazo y cursor)
- <scratchpad>/areaF\rotulador.mjs y rotulador2.mjs — el rotulador con mezcla multiply/screen: texto, enlace y marca frente a página por color y alfa
- <scratchpad>/areaF\cursor.mjs — genera cursor-claro.svg, cursor-oscuro.svg y cursor-regla.json (la declaración cursor lista para PICK_CSS); urls.txt con las dos data URL
