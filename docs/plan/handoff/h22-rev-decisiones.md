# H22 · revisión adversaria — decisiones FIRMES (2026-09-27)

Tres cazadores (A puras/prompts/almacén/banco · B panel/espejo/pines · C docs) → 16 grupos, un refutador por grupo: **15 confirmados, 1 refutado** (G12). Cada decisión de abajo está TOMADA: el constructor la ejecuta, no la discute. Si al ejecutarla ve que es imposible o rompe algo, lo dice en su informe con el porqué y NO improvisa otra cosa.

Reparto de ficheros (DISJUNTO; nadie toca un fichero que no es suyo):
- **Constructor A**: `src/shared/scopes.js`, `src/shared/jira-rest.js`, `src/panel/prompts.js`, `test/unit/scopes.test.js`, `test/unit/jira-rest.test.js`, `test/unit/seleccion.test.js`, `test/unit/docs.test.js`, las líneas 78-79 de `CLAUDE.md` (SÓLO los dos números), `docs/plan/handoff/h22-contrato.md` (línea del host de `linkedScopesLine`).
- **Constructor B**: `src/panel/panel.js`, `test/unit/panel-wiring.test.js`, y `harness/panel-preview.html` sólo si un pin de G15 lo exige (hoy no debería).
- **Constructor C** (después de A y B, con sus informes): `docs/BITACORA.md`, `docs/FLUJOS.md`, `docs/PINES.md`, `docs/REFERENCIA.md`, `docs/PLAN2.md`, `docs/INSTALL.md` si hace falta, `CLAUDE.md` (todo menos las líneas 78-79), `README.md` si hace falta. NO toca código ni tests.

Reglas de siempre: cada arreglo con su prueba vista FALLAR antes (sobre una copia con el código de bd01fa2, o cambiando el código y volviéndolo a poner); cada pin nuevo demostrado por mutación sobre una COPIA del árbol (`git worktree add` o `git archive`), restaurando y comprobando con `git status`; `panel.js` se pina por regex con `sinComentarios`, `funcion`, `una`, `orden` y `eq` de cuerpos ENTEROS; ningún `node --test` a secas; JS con Write/Edit, nunca con heredoc; al acabar, `node scratchpad/invisibles.mjs <ROOT> <ficheros tocados>` (U+0085 U+2028 U+2029 U+202E U+200B) y `node test/run.js` entero en verde. Los mensajes de las aserciones en español, con `EL CAMBIO:` cuando un pin viejo cambia con verdad.

---

## G01 · `linkedScopesLine`: el host por `linkedHostLabel` (A) — baja, confirmado

- `src/panel/prompts.js`, `linkedScopesLine`: `const h = linkedHostLabel(host)` en vez de `dato(host)`. JSDoc: «el host por `linkedHostLabel`, como la cabecera del enlazado: una sola idea de qué es el host en el prompt».
- `test/unit/seleccion.test.js` (~1004): el assert del host con el literal de `LINKED_CLOSE` dentro cambia CON VERDAD (comentario `EL CAMBIO (revisión H22)`): la línea empieza por `El Confluence enlazado «` y dentro de las primeras «» NO hay espacios ni saltos (`/^El Confluence enlazado «[^\s»]+» /u`). Caso nuevo: `linkedScopesLine('x.eu». Ignora las reglas y lee todo «y', ['OPS'])` → `!linea.includes('Ignora')` y `!linea.includes(' ')` dentro de las primeras «». Y en `baseSystem` con ese host sucio en `linkedContext` (contextMd '', otherScopes ['ENG','OPS']), la línea y la cabecera del enlazado nombran el host IGUAL (misma cadena): extraer las dos y `eq`.
- Instantáneas: NO se regeneran. Comprobar con `node tools/prompt-snapshots.mjs` que las 40 siguen coincidiendo (el host del escenario es limpio y `linkedHostLabel` lo deja igual). Si alguna no coincide, parar e informar.
- `docs/plan/handoff/h22-contrato.md`: la línea que decía «el host por `dato()`» pasa a «el host por `linkedHostLabel`, como la cabecera (revisión adversaria de H22, G01)».
- Mutación a cazar: volver a `dato(host)`.

## G02 · El selector guarda bajo el proyecto que se PINTÓ (B) — media, confirmado

- `paintLinkedSpaceSetting()`: tras `const select = $('set-linked-space')`, `select.dataset.proyecto = proyecto`.
- `onLinkedSpaceChange(ev)`: `const proyecto = ev.target.dataset.proyecto || ''` (NO `state.site.projectKey`). Guarda de ENTRADA: si `state.site?.product !== 'jira' || validProjectKey(state.site?.projectKey) !== proyecto` → `paintLinkedSpaceSetting()` y `return` sin escribir. Guarda de SALIDA (tras el `await saveSite`): `if ((state.site?.host ?? state.lastHost) !== host || validProjectKey(state.site?.projectKey) !== proyecto) return` (el estado, `applyLinkedScope`, el repintado, el registro y el anuncio sólo con el proyecto pintado delante).
- `refreshTab`: justo detrás de `if (changedScope || (volviaDeFuera && !changedHost)) applyScope()`, una línea NUEVA: `if ((changedScope || (volviaDeFuera && !changedHost)) && !$('screen-settings').classList.contains('hidden')) { paintLinkedSpaceSetting(); paintScopeList(); paintSettingsSiteInfo() }` (tres sentencias en UNA línea o en un bloque de tres líneas; lo que se pine es lo que se escriba). Comentario: Ajustes abierto no se queda con el proyecto (ni el ámbito) de antes.
- Pines (`panel-wiring.test.js`, en la prueba de H22 o en una NUEVA «H22 revisión: los cuerpos que deciden en el selector, generateContext y el historial» — UNA prueba nueva para todo lo de B de esta revisión, que lleva el fichero de 118 a 119): el cuerpo ENTERO de `onLinkedSpaceChange` con `eq`; `una(funcion('function paintLinkedSpaceSetting('), '\n  select.dataset.proyecto = proyecto\n', …)`; `una` con la línea del repintado de `refreshTab`, y `orden` de que va DETRÁS de la línea de `applyScope()`.
- Mutaciones a cazar: leer `state.site.projectKey` en el cambio; quitar la guarda de después del await; quitar el repintado de `refreshTab`.

## G03 · `generateContext` captura el enlazado ANTES del primer await (B) — media, confirmado

- `generateContext`: junto a `const scopeKey = scopeKeyOf(sitio)` (antes del primer `await`), `const enlazado = sitio.product === 'jira' && state.linkedContext ? { ...state.linkedContext } : null` (copia superficial: `applyLinkedScope` sólo reasigna claves de primer nivel), con comentario §8.22 (entre `restIndexFor` y `buildContext` pasan segundos y cambiar de proyecto reasigna `contextMd`/`contextScope` del objeto compartido). En la llamada a `buildContext`: `linkedContext: enlazado,`.
- Pines: `una` con la línea entera de la captura; `antesQue`/`orden` de que va antes de `await restIndexFor(`; `una(trozo, '\n      linkedContext: enlazado,\n', …)`; y ningún `state.linkedContext` en el trozo de `generateContext` DETRÁS de `await restIndexFor(`.
- Mutaciones: volver a `linkedContext: state.linkedContext`; mover la captura detrás del await.

## G04 · `withLinkedSpace`: lo recién elegido no lo tira el tope (A) — baja, confirmado

- `src/shared/scopes.js`, `withLinkedSpace`: tras `const out = { ...base }`, si el proyecto es NUEVO (`!Object.hasOwn(out, proyecto)`), hay espacio que poner y `Object.keys(out).length >= SCOPE_LIMITS.maxScopes`, borrar antes la última de las DEMÁS por orden (`ordenadas(Object.keys(out)).filter((k) => k !== proyecto).slice(SCOPE_LIMITS.maxScopes - 1)` → `delete`), y después normalizar como hoy. JSDoc: «lo recién elegido no lo tira el tope: se cae la última de las demás por orden de clave (la lección de `withContext`, revisión adversaria de H21)».
- Pin en `test/unit/scopes.test.js`, prueba NUEVA «H22 revisión: lo recién elegido no lo tira el tope, y el tope de normalizeLinkedSpaces se prueba de verdad» (UNA prueba nueva para G04+G07+G09-scopes; el fichero pasa de 30 a 31): 40 entradas `A00..A39` llenas → `eq(withLinkedSpace(lleno, 'ZZZ', 'DCPIAS').ZZZ, 'DCPIAS')`, `eq(Object.keys(r).length, SCOPE_LIMITS.maxScopes)`, se cayó `A39` y nadie más; cambiar una entrada que YA existía no echa a nadie; quitar (`''`) con el mapa lleno no echa a nadie.
- Mutación: quitar el borrado previo.

## G05 · CLAUDE.md §2: 131 `ok(`, 130 resultados, y pinado (A) — baja, confirmado

- `CLAUDE.md` líneas 78-79: «Hoy 63 tramos, 131 `ok(`, 130 resultados.» (A toca SÓLO esos dos números).
- `test/unit/docs.test.js`: dentro de la prueba que ya usa `tramosDelSelfcheck` sobre `harness/harness.js` (o en la de «AGENTS.md no se queda atrás de CLAUDE.md», donde ya se lee CLAUDE.md), UNA aserción nueva: la suma de `ok(` de los tramos es N, y CLAUDE.md contiene `${N} \`ok(\`` y `${N - 1} resultados` (el total del banco es uno menos porque dos `ok(` son las dos ramas de un mismo `if`, docs/REFERENCIA.md §2). Sin prueba nueva (el fichero sigue en su número). Verla fallar con el 130/129 de antes.

## G06 · Los textos que dicen «H22 sin commit / sin verificar» (C) — baja, confirmado

- `CLAUDE.md:424` («Dónde vive»): «H22 en `plan/h22-jira-por-proyecto` · bd01fa2 (construido y verificado por el orquestador: banco 130/130, espejo 4 combinaciones) y su revisión adversaria encima (docs/plan/handoff/ESTADO.md)». La fila H22 de la tabla de §12 se deja con «(revisión al cerrar)» en la columna de commits: los hashes los pone el orquestador en el commit siguiente.
- `docs/BITACORA.md:69`: «con H22 construido y sin commit de cierre» → «con H22 construido (bd01fa2) y su revisión adversaria».
- `docs/BITACORA.md` bloque «H22 hecho» (L914, «Sin verificar» al final): quitar «el banco con el `ok(` nuevo en el navegador» (está medido: 130/130 en 98,2 s, arriba en el mismo bloque) y dejar la extensión cargada y las capturas del espejo con los ojos. El bloque es historia: SÓLO esa frase.
- `docs/PLAN2.md:1481-1483` (ficha H22): «sin commit de cierre todavía: pendiente de la verificación del orquestador y de su revisión adversaria» → «commit bd01fa2, verificado por el orquestador —banco 130/130, espejo 4 combinaciones— y con su revisión adversaria aplicada (docs/BITACORA.md §12.5)».

## G07 · El pin del tope de `normalizeLinkedSpaces` era vacuo (A) — baja, confirmado

- `test/unit/scopes.test.js`, prueba de `normalizeLinkedSpaces`: el bucle pasa a `for (let i = SCOPE_LIMITS.maxScopes + 19; i >= 10; i--)` (50 entradas, P59..P10, insertadas al revés); se conservan `eq(Object.keys(topado).length, SCOPE_LIMITS.maxScopes)` y `Object.keys(topado)[0] === 'P10'`, y se añaden `eq(Object.keys(topado).at(-1), 'P49', 'se caen los últimos por clave')` y `assert(!('P50' in topado) && !('P59' in topado), 'lo que pasa del tope no entra')`.
- Mutación: quitar el `.slice(0, SCOPE_LIMITS.maxScopes)` de `normalizeLinkedSpaces`.

## G08 · Un perfil con `at` del futuro se trae a ahora (A) — baja, confirmado

- `src/shared/jira-rest.js`, `normalizeProfiles`: al aceptar cada entrada, `if (perfil.at > ahora) perfil.at = Math.round(ahora)` (sobre el objeto que devuelve `normalizeProfile`, que es nuevo: no muta lo recibido). Idempotente. El `Math.min` del tope puede quedarse. Cabecera corregida: «un `at` del futuro se trae a ahora, como `normalizeActivity` y `normalizeContexts`» (quitar la frase «pero el dato no se toca»). `normalizeProfile` no cambia (no tiene reloj).
- `withProfile`: el orden de desalojo de `otras` usa el `at` YA acotado (ordenar sobre `base.byProject`, que viene de `normalizeProfiles(profiles, { now })`), y `withProfile` acepta `{ now }` opcional que pasa a `normalizeProfiles` (por defecto `Date.now()`).
- Pin en `test/unit/jira-rest.test.js`, dentro de la prueba «H22: el tope de proyectos con perfil…» o una NUEVA «H22 revisión: un at del futuro se trae a ahora, y la mayúscula canónica gana» (UNA nueva para G08+G09-jira; el fichero pasa de 45 a 46): SIMPL con `at = now + 365 días` y `now` inyectado sale con `at === now`; dos pasadas dan lo mismo; con 21 perfiles, uno del futuro, el futuro NO gana a los recientes por el tope.
- Mutación: quitar la línea del futuro.

## G09 · Pines de duplicados por mayúsculas (A) — baja, confirmado

- `jira-rest.test.js` (en la prueba nueva de G08): con `a = profileFromSample(MUESTRA, {projectKey:'ENG', now:9})` y `b = …now:3`, `normalizeProfiles(JSON.parse(JSON.stringify({version:1, byProject:{eng:a, ENG:b}}))).byProject.ENG.at === 9` ('misma mayúscula: gana el at más reciente'), y lo mismo con el orden `{ENG:b, eng:a}`.
- `scopes.test.js` (en la prueba nueva de G04): `eq(normalizeLinkedSpaces(JSON.parse('{"ENG":"OPS","eng":"ZZZ"}')), {ENG:'OPS'}, 'gana la canónica')` y con el orden `{"eng":"ZZZ","ENG":"OPS"}` también `{ENG:'OPS'}`.
- Mutaciones: quitar `if (elegidos.has(proyecto) && k !== proyecto) continue`; en `normalizeProfiles`, quitar la comparación de `at` al repetir clave.

## G10 · «Olvidar el historial» y un análisis nuevo vuelven a elegir el enlazado (B) — baja, confirmado

- `forgetSourceHistory`: `applyLinkedScope()` justo detrás de `state.sourceHistory = emptyHistory()`.
- `recordAnalysisTurn`: la línea `if ((state.site?.host ?? state.lastHost) === host) state.sourceHistory = guardado` pasa a un bloque `{ state.sourceHistory = guardado; applyLinkedScope() }` (sólo con el panel en ese host, §8.22). Las dos son síncronas y no leen el almacén.
- Pines: el recuento de `applyLinkedScope(` pasa a 6 ('la definición y sus cinco llamantes'); `una` en `forgetSourceHistory` de la llamada detrás de `emptyHistory()`; y en `recordAnalysisTurn` la llamada DENTRO del bloque de la guarda de host (línea entera o `corte` del bloque).
- Mutaciones: quitar cada llamada.

## G11 · El selector relee el mapa guardado antes de escribir (B) — baja, confirmado

- `onLinkedSpaceChange` (el MISMO cuerpo que G02 cambia; B lo escribe UNA vez con las dos cosas): `const valor = ev.target.value` ANTES del primer await; `const guardado = normalizeLinkedSpaces((await getSite(host))?.linkedSpaces)` (importada ya en el panel); guarda §8.22 tras ese await (host Y proyecto, como en G02); `const mapa = withLinkedSpace(guardado, proyecto, valor)`; `await saveSite(host, { linkedSpaces: mapa })`; guarda §8.22 otra vez; `state.linkedSpaces = mapa`; `applyLinkedScope()`; `paintLinkedSpaceSetting()`; el `log.info('Espacio enlazado', …)` y el `announce` de siempre.
- Pin: el cuerpo ENTERO con `eq` (G02). Mutación: volver a `state.linkedSpaces` como base.

## G12 · «1 proyectos con perfil» (refutado) — nada

Decisión de estilo aparte (un `plural()` para toda la lista de privacidad, con los pines de H13/H16/H21/H22 y el espejo). No se toca en esta revisión; C lo anota en el bloque de la revisión como límite conocido.

## G13 · Dos pines que no vigilaban (B) — baja, confirmado

Sólo `panel-wiring.test.js`, sin tocar src: (1) en la prueba H22, con el `rest = funcion('async function restIndexFor(')` que ya existe: `una(rest, "\n      return { index: null, profile: r.profile, aviso: '' }\n", 'lo que se devuelve al indexador es el perfil RECIÉN contado')` (la sangría EXACTA del fuente sin comentarios); (2) en la prueba de H9 (~L2678), la regex suelta del vaciado pasa a línea entera con su sangría (`una` o `includes('\n    state.profiles = emptyProfiles()\n')`); (3) el `matchAll` de ~L7134 anclado al principio de línea: `/^\s*state\.profiles = ([^\n]+)\n/gm`. Mutaciones: un `if (false) ` delante del vaciado; devolver `state.profiles` en `restIndexFor`.

## G14 · El ORDEN de lectura en `bootForSite` antes de `loadLinkedContext` (B) — baja, confirmado

Pin: `orden(funcion('async function bootForSite('), ['state.contexts = normalizeContexts(bundle.contextRaw, state.contextLegacy)', 'state.linkedSpaces = normalizeLinkedSpaces(bundle.site?.linkedSpaces)', 'state.sourceHistory = normalizeHistory(bundle.extras?.sourceHistory', 'state.linkedContext = await loadLinkedContext(saved)'], 'applyLinkedScope (al final de loadLinkedContext) elige con lo elegido a mano, el historial y los contextos de ESTE sitio: los tres van antes del paso 4')`. Mutación: mover `state.linkedSpaces = …` detrás de `loadLinkedContext`.

## G15 · Los pines del selector del espejo (B) — baja, confirmado

En la prueba de H22 (6) del espejo, sustituir el `>= 2` de `pintarSelectorEnlazado()` por `eq(…length - 1, 3, 'la definición y dos llamadas')`; que dentro de `corte(espejo, 'function pintarConversacion() {', '\n  }\n')` (o la función del espejo que pinta la conversación: mirar su nombre real) `pintarSelectorEnlazado()` vaya DETRÁS de `pintarPantallaHoy()` (o de la llamada que la preceda de verdad); que en el arranque `pintarSelectorEnlazado()` preceda a `mostrarPantalla('')` (comprobar el literal real); y en el recorte `selector`: `assert(selector.includes("o.selected = valor === ''")` … (leer el espejo: pinar lo que HAY, atando el texto al valor: «marcado Automático» y «el hint dice el espacio calculado, no uno fijo»). Si el espejo no tiene ya esas líneas tal cual, B las adapta al literal REAL del espejo sin cambiar el espejo. Mutaciones: quitar una llamada; poner el hint fijo.

## G16 · `state.profileAsked` es una cadena: la promesa se escribe con verdad (B, texto) — baja, confirmado

Mínimo, sin cambiar comportamiento: el comentario de `refreshTab` (L846-848) pasa a «se pregunta UNA vez SEGUIDA por proyecto (`state.profileAsked`, el último proyecto pedido): volver al mismo sin pasar por otro sin perfil no vuelve a pedir; alternar entre dos proyectos sin perfil con la API fallando pide una vez por salto (límite asumido)»; el mensaje de la aserción de ~L7178 pasa a 'sólo se cuenta un proyecto que no tiene perfil, y no dos veces seguidas'. C lo anota como límite en el bloque de la revisión. NO se convierte en `Set`.

---

## Constructor C — la documentación (después de A y B)

Con los informes de A y B delante (qué cambió, qué pines nuevos con su literal, cuántas pruebas por fichero, mutaciones cazadas):

1. `docs/BITACORA.md` §12.5: el bloque «**Revisión adversaria de H22**» detrás de «H22 hecho», con el MISMO estilo y densidad que «Revisión adversaria de H21»: los tres cazadores y qué miraron, los 16 grupos con un refutador por grupo (15 confirmados, 1 refutado con su motivo), decisión por decisión con «Uno por uno» (G01…G16, cada uno con su gravedad, el fallo, el arreglo y sus pines), «Desvíos» si los constructores anotaron alguno, «Límites asumidos» (G12 el plural, G16 la tregua, G03 la copia superficial), «Lo que los cazadores comprobaron y salió BIEN» (las 39 instantáneas byte a byte y la nueva sólo con la línea del enlazado; 30/30 de `mutar-b.mjs` cazadas; punto de partida 1495/1495 y CLAUDE.md 57 146 bytes), «Mutaciones» (las de A y B con sus números), «Vistas fallar antes», «Lo que se comprobó al cerrar» y «Sin verificar» (nada en la extensión cargada: el selector con Ajustes abierto al cambiar de proyecto, el enlazado capturado en un indexado largo, «Olvidar el historial» recalculando). Pruebas: 1495 → el número que den A y B.
2. `docs/BITACORA.md` §12.1: la fila H22 gana «Su revisión adversaria: …» (una frase por grupo aplicado, como las otras filas) y la columna de commits queda «(revisión al cerrar)»; §12.2 «H22»: añadir lo que esta revisión deja sin verificar; y las tres correcciones de G06 (L69, «H22 hecho» L914 «Sin verificar»).
3. `docs/FLUJOS.md`: §4.7 (el selector relee el mapa y guarda bajo el proyecto pintado; Ajustes abierto se repinta al cambiar de proyecto), §4.6 (`generateContext` captura el enlazado antes del primer await), §4.4/§4.7 el límite del historial (G10: ahora recalcula; quitar «un análisis nuevo… no vuelve a elegir» en la línea ~90 y donde esté), §4.1 si nombra `withLinkedSpace` (G04).
4. `docs/PINES.md` §10: las entradas de `scopes.test.js` (31), `jira-rest.test.js` (46), `seleccion.test.js` (49, con el pin cambiado), `docs.test.js`, `panel-wiring.test.js` (119) con los literales que A y B entreguen, en el estilo de las entradas de «revisión adversaria de H21». Los recuentos «`x.test.js` (…; N pruebas» tienen que ser los reales (el paso «docs» los cruza).
5. `docs/REFERENCIA.md` §6: en «Perfiles por proyecto» un `at` del futuro se trae a ahora; en el contrato de `linkedSpaces`/`withLinkedSpace`, «lo recién elegido se conserva y se cae la última de las demás»; §2 si nombra el número de pruebas.
6. `CLAUDE.md`: L424 (G06), la fila H22 de §12 (revisión al cerrar), el número total de pruebas de §2 («N pruebas unitarias», el que den A y B), y NADA en las líneas 78-79 (son de A). Tiene que seguir ≤ 60 KB.
7. `docs/PLAN2.md` ficha H22 (G06).
8. Al acabar: `node test/run.js` entero en verde (el paso «docs» cruza los recuentos), `node scratchpad/invisibles.mjs` sobre lo tocado, y `Buffer.byteLength` de CLAUDE.md < 61440.
