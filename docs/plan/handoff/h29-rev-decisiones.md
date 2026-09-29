# H29 · Revisión adversaria: decisiones (2026-09-29)

Sobre a89f7f6. Dos cazadores Opus (el código y sus pines · los docs y los contratos), un agrupador (6 grupos, 1 descartado) y un refutador por grupo: 6 matizados, 0 refutados. El texto entero de cada veredicto está en el scratchpad de la sesión (`h29-rev.json`). Reparto: **R1 código** (`src/panel/panel.js` sólo `diagramButton` y los JSDoc que se citan; `test/unit/panel-wiring.test.js` sólo la prueba H24; `harness/panel-preview.html` sólo `filaDibujarElFlujo` y sus comentarios) y **R2 docs** (después: CLAUDE.md, docs/REFERENCIA.md, docs/INSTALL.md, docs/FLUJOS.md, docs/PINES.md, docs/BITACORA.md, docs/plan/handoff/ESTADO.md).

## D1 (G1, baja) · Sin sitio, el botón prometía mandar y fallaba en silencio — R1 y R2

Reproducido con el `diagramButton` y el `send()` reales: preguntar en Jira, pasar a una pestaña fuera de Atlassian mientras llega la respuesta (el botón sale igual, por `lastHost`), pulsar → `send()` sale en su primera línea (`!state.site`) sin decir nada. `!state.client` no puede darse con el botón a la vista.

- **R1**: en el clic, detrás de `send()`: `if (!state.streaming && !state.site) showNotice('No lo he mandado: esta pestaña no es de Jira. Vuelve a la de Jira y pulsa Intro; la pregunta queda en el cuadro.', true)` (`showNotice` ya anuncia: ningún `announce` aparte). NO se añade un `announce` al mandar bien: es la convención de Intro y de los otros tres botones que mandan (A2: la respuesta se anuncia al terminar). El JSDoc de `diagramButton` corrige la justificación: «Sin `announce`, como Intro y los otros tres botones que mandan: el lector oye el foco en el cuadro, ya vacío, y la respuesta se anuncia al terminar (A2); a la vista, la fila se va y sale la burbuja con su nota» (fuera «aria-busy» como eco: `#chat` no es región viva). En la prueba H24: el `eq` del cuerpo con la línea nueva; la sonda gana `pulsar({ site: null })` (un aviso, cero turnos, la pregunta en el cuadro, el foco) y `crear` recibe `showNotice`; el caso `client: null` puede quedarse como está o irse.

## D2 (G2, baja) · «Sólo manda su texto fijo» era falso: lo señalado, lo precargado y, en Análisis, la página y las páginas base viajan — R1 (comentarios) y R2

- **R1**: JSDoc de `DIAGRAM_QUESTION`: «lo que escribe el botón es exactamente esta constante»; JSDoc de `diagramButton`: «Su texto es sólo `DIAGRAM_QUESTION`, y sale una vez»; en la frase de lo armado, añadir «la imagen señalada como adjunto y, en Análisis, la incidencia en bloques y las páginas base».
- **R2**: CLAUDE.md §8.27: «sigue sin mandar nada más que su texto fijo» → «el botón sólo pone su texto fijo; lo demás, como en cualquier envío» (+27 B: cabe en 61 440; si no, recortar en §7 lo que esté en REFERENCIA §7); REFERENCIA §8.27 (l.~675: «Lo que sale es sólo» → «Su texto es sólo»; el paréntesis de los hermanos «(`el.input.value = …` y `send()`)»; lo que viaja, con la imagen y el Análisis); INSTALL (l.~825-829: «que es lo único que escribe el botón» y lo que viaja).

## D3 (G3, baja) · Lo que H29 da por hecho de `send()` y `setStreaming` no estaba pinado contra el código real — R1

- **R1**, dentro de la prueba H24 (sin `test(` nuevo): (a) con `envio = funcion('async function send(')`: `una(envio, "\n  el.input.value = ''\n  autoGrow()\n", 'send() vacía el cuadro sin ceder el hilo: un Enter tras el clic no reenvía')`; `orden(envio, [retirada.trim(), "el.input.value = ''", 'setStreaming(true)'], 'retira la oferta, vacía el cuadro y se pone ocupado, en este orden')`; `assert(!/\bawait\b/.test(envio.slice(0, envio.indexOf('setStreaming(true)'))), 'ningún await antes de ocupar el panel (H2 «Ocupado desde ya»; decisión 17)')`. (b) `una(corte(JS_SIN, 'function setStreaming(on) {', '\n}'), '\n  el.input.disabled = false\n', 'setStreaming no deshabilita el cuadro: el foco que pide el botón se queda')`. (c) Si cabe sin enredar: la sonda ejecuta el PREFIJO real de `send()` (desde `async function send() {` hasta `\n  const cron = startTiming(`, con `return 'ocupado'\n}` añadido) en lugar del doble escrito a mano; si no cabe, (a) y (b) bastan. Los mutantes M05 (`send()` sin vaciar el cuadro), M04 (`el.input.disabled = on`), M01/M02 (un `await` delante de `setStreaming(true)`) tienen que caer. El JSDoc de `diagramButton` (el mecanismo del doble clic) dice lo que pina.

## D4 (G4, baja) · La bitácora decía «dos commits» y fue uno — R2

Decisión del orquestador (2026-09-28): las dos decisiones de H29 fueron en UN commit (a89f7f6) para no dejar un commit con `docs.test.js` en rojo entre medias; PLAN3 §3.3/§4 y el contrato pedían dos. Se escribe como desvío, sin reescribir la historia.

- **R2**: REFERENCIA §8.27 («en su propio commit» → «en el mismo commit que la 17»); BITACORA §12.3 (decisión 18: idem), §12.5 «H29 hecho» («Dos decisiones, en dos commits» → «en un solo commit (a89f7f6; PLAN3 §3.3/§4 y el contrato pedían dos: desvío abajo)», el recuento de constructores tal como fue: dos de código en serie y uno de docs, y en «Desvíos del contrato» la frase: revertir sólo la 18 obliga a deshacer a mano la guarda `if (diagrama) {`, el argumento `diagrama: diagramaAlPedir` y sus pines), §12.4 (párrafo «**De H29** (2026-09-28, docs/PLAN3.md §3.3 y §6): el ejemplo de forma de la decisión 15 dentro de H29 —cambiaría `DIAGRAM_QUESTION` y sus pines byte a byte, el espejo y las 40 instantáneas: commit aparte si Marco lo pide—; el `announce` al mandar bien —convención de todo el panel, decisión aparte—; un título nuevo para la guarda de la decisión 18 —«Sin navegación» ya existía—»), l.26 (la entrada del tercer plan) y ESTADO.md.

## D5 (G5, baja) · La guarda registra «Sin navegación» también en Análisis y Resumen, y el ahorro del planificador no era universal — R2 (docs) y R1 (dos comentarios)

El código NO cambia (la guarda va delante del modo a propósito: es la única huella en el Registro de que la respuesta era un diagrama).

- **R2**: INSTALL (l.~856-861 y ~1995-1998), REFERENCIA §8.27 y FLUJOS §4.3 (l.~52): el ahorro acotado: «en General con mapa (y en Búsqueda cuando la respuesta no nombra el destino), `shouldPlan` decía que sí y el planificador gastaba un segundo turno de pago para una tarjeta «Llévame» que sobra; sin mapa salía «Me falta el mapa», con una `jira_search` en el turno salía la tarjeta de esa búsqueda, y en Análisis y Resumen no salía nada»; y en INSTALL («Sin navegación»): el registro sale también en Análisis y Resumen, que nunca ofrecen tarjeta, porque la guarda va delante del modo.
- **R1**: el mismo matiz en el comentario de la guarda de `offerNavigation` (panel.js ~5108-5110) y en el de panel-wiring (~8091-8093).

## D6 (G6, baja) · El espejo enseña la fila del botón junto a la pregunta que mandó (imposible en el panel desde D03 de H24) — R1

- **R1**: en `harness/panel-preview.html`, el comentario de `conversacionJira` (~1651-1653): «H24: «Dibujar el flujo», que el panel cuelga justo detrás de la prosa (antes de los avisos y de la tarjeta de observaciones). Aquí se queda bajo b1 para medirla, junto a la pregunta que mandó: en el panel la retira el envío siguiente (D03) y, desde H29, el mismo clic, así que nunca se ven las dos a la vez»; `filaDibujarElFlujo` con `mk('div', 'nav-actions dg-offer')` (la copia fiel; la clase no tiene CSS: `check()` no cambia) y su cabecera; en panel-wiring, parte (11) de la prueba H24, un `assert` de que `corte(espejo, 'function filaDibujarElFlujo()', 'function respuestaConDiagrama()')` incluye `mk('div', 'nav-actions dg-offer')`. La fila NO se mueve (el orden de la l.~8236-8239 se queda) y el `title` no se copia (ningún botón de acción del espejo lo lleva).

## Descartado por el agrupador

- L1-06 (la pregunta no vuelve al cuadro tras «Parar» el turno del botón): es la conducta de cualquier envío parado.

## Lo que R2 documenta además

BITACORA §12.5: la viñeta «**H29 · revisión adversaria** (2026-09-29, sobre a89f7f6): dos cazadores Opus…, 6 grupos, 6 matizados, 0 refutados; D1-D6…» con la densidad de las anteriores; §12.2 (lo que sigue sin verse en Chrome: el aviso sin sitio, el eco para un lector de pantalla); PINES l.~178 con los fragmentos NUEVOS copiados del informe de R1 (el `eq` del cuerpo con `showNotice`, `pulsar({ site: null })`, los pines de `send()`/`setStreaming`, el `mk('div', 'nav-actions dg-offer')`); CLAUDE.md ≤ 61 440 B (mide; recorta en §5/§7 lo que esté en REFERENCIA); la fila de H29 sigue «sin commit» hasta los hashes; ESTADO.md.
