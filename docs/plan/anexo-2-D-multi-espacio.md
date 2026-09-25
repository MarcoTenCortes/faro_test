<!-- Anexo del segundo plan de evolución de Faro (docs/PLAN2.md). Informe de investigación escrito por un agente en Opus el 2026-09-25/26 y verificado por el orquestador (citas del código comprobadas línea a línea, sondas puras repetidas, logs leídos); los números de línea se refieren al código de 9fcbe7d (H14 cerrado). Donde contradiga a docs/PLAN2.md, manda el plan. -->


# D · Varios espacios de Confluence (y varios proyectos de Jira) en el mismo sitio: un árbol y un contexto por espacio, para la navegación y para las páginas base de los análisis

## Resumen

Hoy hay una sola unidad de guardado, el HOST: `faro:index:<host>`, `faro:context:<host>`, `faro:profile:<host>` y `sites[host].onboarded`. Lo he comprobado con una sonda en Node sobre los módulos de verdad y leyendo el panel.
- **Al pasar de SIMPL a DCPIAS en el mismo Confluence** no se rearranca nada y no sale la pantalla de contexto: B se da por indexado y usa el CONTEXT.md escrito para A.
- **Si luego se genera en B**, el CONTEXT.md de A se PISA (es la misma clave).
- **El índice FUNDE los dos espacios** (`mergeIndex`) y `scope` pasa a ser B. Las sugerencias por título y el digest del planificador mezclan espacios.
- **Lo que sí funciona bien, y conviene conservar**: el paso a paso entre espacios (ir de B a una página de A empieza por «Espacio SIMPL» y sigue la rama de A) y el `sameScope` de «hoy», que ya es por espacio.

**Recomiendo la opción (iii), híbrida:**
- UN índice por host, con las páginas de todos los espacios, cada una con su `spaceKey`. Se filtra por el espacio de la pestaña donde hace falta.
- Un CONTEXT.md POR ÁMBITO dentro de la MISMA clave por host: `{version:2, scopes:{'space:SIMPL':…, 'project:ENG':…}}`.
- El mismo contrato de ámbito para el perfil de Jira (un mapa de perfiles por proyecto), que cierra también la decisión 5 de §12.3.

Esta opción no añade claves a `STORAGE_KEYS`, así que el olvido de H13 y la lectura única de P4 siguen igual. Migrar es trivial: el string de hoy se asigna al `index.scope` guardado, que es el último espacio indexado.

## Hechos verificados

Cada hecho lleva cómo se comprobó: **ejecutado** (una sonda o un opencode aislado), **leído en el código** (con la línea), **leído en la documentación** o **supuesto** (no comprobado; el plan lo trata como tal).

- **[ejecutado]** Dos espacios del mismo Confluence comparten las claves de contexto y de índice: la clave depende sólo del host.
  - Evidencia: probe.mjs → contextA = contextB = 'faro:context:confluence.simplprogramme.eu' y lo mismo con index (mismaClaveContexto: true). Código: src/shared/config.js:181 `index: (host) =>`, :186 `context: (host) =>`, :191 `profile: (host) =>`.
- **[ejecutado]** defaultScope sí distingue espacios: SIMPL → {kind:'space', key:'SIMPL'} y DCPIAS → {kind:'space', key:'DCPIAS'}. Pero ese ámbito sólo se usa al INDEXAR; no decide qué se carga.
  - Evidencia: probe.mjs 'scope A / B'; src/atlassian/site.js:459-468; se usa en panel.js:7130 (generateContext) y :5881 (showContextScreen).
- **[leido-en-codigo]** Al ir de A a B en el mismo host no se rearranca ni se vacía nada: refreshTab sólo reacciona a un cambio de HOST, así que state.contextMd, state.index y state.profile siguen siendo los de A.
  - Evidencia: src/panel/panel.js:543 `const changedHost = !!site && site.host !== state.lastHost`; el vaciado está en :555-609, dentro de `if (changedHost)`; :637 `if (changedHost) await bootForSite()`. Para otro espacio sólo corre el bloque `otraPagina` (:484-499), que no toca ni el índice ni el contexto.
- **[leido-en-codigo]** B no ve la pantalla de contexto: `onboarded` es del host y sólo se mira en bootForSite, y bootForSite no se llama al cambiar de espacio.
  - Evidencia: panel.js:860 `if (!saved?.onboarded) {` → showContextScreen; lo escriben :7200 `saveSite(host, { onboarded: true, indexedAt: Date.now() })`, :7236, :7249 y :6611/6645/6656 (Omitir/saltar), todos por host.
- **[leido-en-codigo]** B tampoco ve la tarjeta «Me falta el mapa»: offerNavigation sólo la enseña si el índice está VACÍO del todo, y el índice de A tiene páginas. Desde B, la única forma de indexar B es Ajustes → «Reindexar».
  - Evidencia: panel.js:3323 `if (!state.index || !indexSize(state.index))` → sinMapaCard (:4426-4457); botón btn-reindex en :6717-6719.
- **[leido-en-codigo]** Si se genera en B, el CONTEXT.md de A se sobrescribe.
  - Evidencia: panel.js:7174 `await memory.saveContextMd(host, contextMd)`; src/panel/memory.js:97-98 `chrome.storage.local.set({ [STORAGE_KEYS.context(host)]: String(md || '') })`, con la misma clave para A y B (sonda).
- **[ejecutado]** Al generar en B, el índice funde las páginas de los dos espacios sin borrar las de A, `scope` pasa a DCPIAS y no hay tope total (dos espacios de 300 dan 600 páginas, unos 65 KB).
  - Evidencia: probe.mjs: scopeTrasA SIMPL → scopeTrasB DCPIAS; páginas 100-103 [SIMPL] + 200-203 [DCPIAS]; 'dos espacios de 300 fundidos' → 600 páginas y 64 898 bytes. Código: index-store.js:143-151 (`out.scope = incoming?.scope || out.scope`, Object.assign por cubo) y panel.js:7193 `mergeIndex(base, index)`.
- **[ejecutado]** Cada página del índice leído de la API lleva su spaceKey, y el índice registra los dos espacios en `spaces`.
  - Evidencia: probe.mjs espacioDeCada {100..103: SIMPL, 200..203: DCPIAS} y espacios [SIMPL, DCPIAS]. indexer.js:178-201 (`claves.add(delAmbito)`, `spaceKey: clave || delAmbito`).
- **[ejecutado]** La fase 1 del indexado recibe sólo el árbol del espacio que se indexa: treeTitles(restIndex) no mezcla. Si se llamara sobre el índice fundido, sí mezclaría las raíces de los dos espacios.
  - Evidencia: indexer.js:57 y :71 `indexExplorePrompt(scope, { treeTitles: treeTitles(leido) })`, con `leido` = restIndex. probe.mjs: treeTitles(fundido) da «Arquitectura» (SIMPL), «DCPIAS Home», «Operaciones», «SIMPL Home» mezclados; treeTitles(iB) sólo DCPIAS.
- **[ejecutado]** Las páginas base sugeridas por título mezclan espacios y no dan preferencia al de la pestaña.
  - Evidencia: probe.mjs estando en B: suggestFromIndex(fundido,'guía') → [102 Guía de APIs [SIMPL], 202 Guía de despliegue [DCPIAS], 103 Guía de estilo [SIMPL]], y 'arquitectura' → [101 [SIMPL], 203 [DCPIAS]]. src/panel/sources.js:344 recorre `Object.values(index?.pages)` sin mirar spaceKey; se ordena sólo por puntos y título (:359).
- **[ejecutado]** El paso a paso de B a una página de A funciona y está previsto: primero abre el espacio A y después despliega la rama en la barra de A.
  - Evidencia: probe.mjs treeSteps desde /spaces/DCPIAS/... a 102 → ['confluence-space:SIMPL open «Espacio SIMPL» /spaces/SIMPL', 'confluence-page:101 expand', 'confluence-page:102 open']; dentro de B, sin el paso de espacio. validate.js:208-211 (`!inSpace(here, page.spaceKey)`) y :258-262 markActions (un espacio es 'open').
- **[ejecutado]** El planificador ve páginas de todos los espacios, sin preferir el de la pestaña.
  - Evidencia: probe.mjs indexDigest(fundido): ESPACIOS SIMPL y DCPIAS, y PÁGINAS (8) con [SIMPL]/[DCPIAS]. index-store.js:304-334 sólo ordena por relevancia (rankByRelevance) con la respuesta.
- **[ejecutado]** Una fila nueva leída de la barra lateral entra en el índice SIN espacio, aunque la barra es siempre la del espacio de la pestaña.
  - Evidencia: probe.mjs growTreeFromPage → página 204 con spaceKey null. panel.js:3133-3140 normaliza sin spaceKey y funde con `state.index?.scope` (el scope del último indexado, no el de la pestaña).
- **[leido-en-codigo]** El contexto entra en el prompt como «CONTEXTO DE ESTE SITIO», con un único texto por host. Ese prefijo es también un corte que usan otras funciones.
  - Evidencia: prompts.js:257-261 `--- CONTEXTO DE ESTE SITIO (${CONTEXT_LABEL}) ---`; :371 CONTEXT_LABEL 'resumen … a partir de páginas del sitio …'; :723 `otros = [PAGE_OPEN, '--- CONTEXTO DE ESTE SITIO', …]` (cortes de preloadFromSystem y compañía).
- **[leido-en-codigo]** Desde Jira viaja el CONTEXT.md único del host de Confluence enlazado: el del último espacio que se indexó allí.
  - Evidencia: panel.js:1263-1289 loadLinkedContext → getSiteBundle(confluenceHost).contextMd; sourcesIndex :1297-1300 devuelve el índice entero del enlazado; currentReferences :1322-1336 lee el contexto propio y el enlazado sin ámbito.
- **[leido-en-codigo]** «Qué mirar hoy» ya puntúa por espacio o proyecto de la pestaña; no necesita cambios.
  - Evidencia: src/panel/today.js:570-571: `ambitoAqui = … isRealSpaceKey(here?.spaceKey) ? here.spaceKey` y suma sameScope si coincide con el del candidato.
- **[leido-en-codigo]** Resolver un enlace /display/ sin id ya filtra por espacio contra el índice.
  - Evidencia: src/panel/source-suggest.js:222-226 `if (espacio && p.spaceKey && String(p.spaceKey) !== espacio) continue`.
- **[leido-en-codigo]** Jira tiene el mismo problema: un perfil por host que se recuenta al cambiar de proyecto; profileForProject impide que el de un proyecto entre en el prompt del otro.
  - Evidencia: panel.js:647-649 (refreshProfileSoon con state.profileAsked 'host:KEY'); src/shared/jira-rest.js:886-890 profileForProject; CLAUDE.md §12.3 decisión 5.
- **[leido-en-codigo]** La opción (ii), claves (host, espacio), rompe el olvido derivado de H13 y la lectura única: hostKeys genera las claves llamando a make(host) con un solo argumento.
  - Evidencia: src/shared/storage.js:77-84 `if (areaDe(name) === area) out.push(make(host))`; forgetEverythingFor :111-120; bundleKeys :182-193 lista claves fijas. Con `context: (host, space) =>`, el olvido borraría 'faro:context:<host>:undefined' y dejaría los contextos reales. test/unit/storage.test.js:42 PORHOST y :331 'toda clave por host dice en qué área vive'.
- **[leido-en-codigo]** saveSite funde a UN solo nivel: meter metadatos por ámbito anidados en sites[host] expone a escrituras que se pisan.
  - Evidencia: src/shared/storage.js:36-41 `const next = { ...(sites[host] || {}), ...patch, host }`.
- **[ejecutado]** Guardar el contexto por ámbito dentro de la misma clave es viable y cabe: 10 contextos de 24 000 caracteres son unos 240 KB en un solo item de storage.local (10 MB de cuota; el manifest no pide unlimitedStorage).
  - Evidencia: proto.mjs: '10 contextos de 24 000 chars en UNA clave: 240324 bytes'; manifest.json permisos: sidePanel, storage, tabs, scripting.
- **[ejecutado]** La migración del string de hoy es trivial e idempotente: se asigna al `index.scope` guardado. Ese scope es el del último generateContext, que es el mismo que escribió el CONTEXT.md.
  - Evidencia: proto.mjs: normalizeContexts(string, {legacyScope:'space:DCPIAS'}) → {version:2, scopes:{'space:DCPIAS':{…, legacy:true}}}; en A se ve '' y en B el texto; idempotente true; basura → scopes {}. El scope del índice sólo lo cambia mergeIndex desde generateContext (panel.js:7193); harvestIndex/growTreeFromPage lo conservan (indexer.js:230, panel.js:3133).
- **[leido-en-codigo]** El banco sólo tiene un espacio (ENG), así que ningún tramo ejercita dos espacios.
  - Evidencia: tools/cql-eval.mjs:113,123,148 (`if (spaceKey !== 'ENG') return { results: [] …}`), :245 `space: { key: 'ENG' …}`.

## Opciones

### (i) Índice partido por espacio dentro del mismo objeto por host

Se mantiene un índice por host y `scope` deja de ser un valor único: pasa a ser una lista, o se deriva de la pestaña. treeTitles, suggestFromIndex, indexDigest, restIndexFor y la comprobación de «hay mapa» filtran por el spaceKey de la pestaña. El CONTEXT.md sigue siendo uno por host.

**A favor**

- No cambia ninguna clave de almacén; migrar el índice es gratis (las páginas ya llevan spaceKey).
- Conserva la navegación entre espacios (treeSteps ya la resuelve).
- Coste de arranque igual (P4 intacto).

**En contra**

- NO resuelve lo que pide Marco: el CONTEXT.md se sigue pisando al generar en otro espacio, y onboarded sigue siendo del host.
- El prompt seguiría mezclando la prosa de un espacio con la pestaña de otro.

**Esfuerzo**: Bajo (2-3 ficheros de src, unas 10 pruebas), pero incompleto.

### (ii) Una clave de almacén por (host, espacio) para índice y contexto

Claves `faro:index:<host>:<space>` y `faro:context:<host>:<space>` (y `faro:profile:<host>:<project>`) declaradas en STORAGE_KEYS/AREAS. getSiteBundle lee las del espacio de la pestaña y forgetEverythingFor borra por prefijo.

**A favor**

- Aislamiento total: ningún espacio puede pisar a otro.
- Cada lectura trae sólo el espacio de la pestaña (items más pequeños).

**En contra**

- Rompe el olvido derivado de H13: hostKeys llama a make(host) (storage.js:77-84). Habría que leer el almacén entero (`get(null)`) y filtrar por prefijo, y reescribir la prueba 'toda clave por host'.
- Cambiar de espacio sin rearranque exige una lectura más, y el Jira enlazado tendría que leer N claves de otro host.
- Pierde el paso a paso entre espacios: el índice de B no conoce las páginas ni el espacio de A, así que treeSteps no puede encadenar «Espacio SIMPL» → rama.
- Migrar los índices v3 exige partirlos por spaceKey y reescribirlos (varias escrituras).

**Esfuerzo**: Alto (storage.js, config.js, memory.js, panel.js en unos 15 sitios, index-store; reescribir storage.test.js del olvido; 25-35 pruebas).

### (iii) Híbrido: índice único por host con varios espacios + CONTEXT.md, onboarded e indexedAt por ámbito DENTRO de la misma clave por host (RECOMENDADA)

El índice sigue siendo `faro:index:<host>`, con todas las páginas y cada una con su spaceKey; se filtra o se ordena por el espacio de la pestaña donde hace falta. `faro:context:<host>` cambia de string a `{version:2, scopes:{'space:SIMPL':{text, at, indexedAt, legacy?}, 'project:ENG':{…}, '*':{…}}}`. El «tiene mapa» de un ámbito se deriva de `scopes[k].indexedAt` o de que haya páginas de ese espacio. El perfil de Jira sigue la misma forma: `faro:profile:<host>` = `{version, byProject:{KEY: perfil v2}}`. El ámbito se calcula con una pura nueva, `scopeKeyOf(site)` → 'space:KEY' | 'project:KEY' | '*'.

**A favor**

- Ninguna clave nueva en STORAGE_KEYS: forgetEverythingFor, STORAGE_AREAS, BUNDLE_EXTRA_KEYS y la lectura única del arranque (P4) siguen igual.
- Cambiar de espacio sin rearranque no cuesta lecturas: todos los contextos del host ya están en memoria (unos 240 KB con 10 espacios, medido).
- Conserva el paso a paso entre espacios (verificado con la sonda).
- Migración en lectura, pura e idempotente: string de hoy → scopes[index.scope] (verificado); sin ámbito conocido → '*'.
- Resuelve con UN contrato el problema de Jira (§12.3 decisión 5: un perfil por proyecto sin recontar en cada salto).
- Los prompts sin ámbito salen byte a byte: las 37 instantáneas no cambian si la etiqueta del ámbito es opcional y los contextos migrados '*' la omiten.

**En contra**

- La clave de contexto cambia de FORMA (string → objeto): getSiteBundle.contextMd, memory.getContextMd/saveContextMd y sus pines cambian.
- Todos los contextos del host se leen en cada arranque, aunque sea para usar uno.
- Hay que filtrar por espacio en 5-6 consumidores (sinMapaCard, sugerencias, digest del planificador, treeTitles al reindexar, growTreeFromPage, paintPrivacy).
- El índice crece sin tope entre espacios: hace falta un tope total o dejarlo como decisión.

**Esfuerzo**: Medio: un módulo puro nuevo (src/shared/scopes.js), unos 8 ficheros de src tocados, un tramo nuevo del banco, 35-45 pruebas nuevas o actualizadas; 2 hitos (Confluence y después Jira/perfil).

## Recomendación del investigador

**Opción (iii), híbrida, en dos hitos**: (D1) Confluence, contexto y árbol por espacio; (D2) Jira, contexto y perfil por proyecto, con el mismo contrato.

**Por qué ésta:**
- Es la única que no rompe el olvido derivado de H13 ni la lectura única del arranque (P4).
- Es la única que conserva la navegación entre espacios que HOY funciona.
- Resuelve el CONTEXT.md que se pisa y la decisión 5 de §12.3 con un solo contrato.

**1. Contrato (§6)**

Pura nueva `src/shared/scopes.js`, sin DOM:
- `scopeKeyOf(site)` → `'space:KEY'` (por validSpaceKey) | `'project:KEY'` (por validProjectKey) | `'*'`.
- `SCOPE_KEY` (regex de lista blanca).
- `CONTEXTS_VERSION = 2`.
- `normalizeContexts(raw, {legacyScope, now})` → `{version:2, scopes:{[k]:{text, at, indexedAt, legacy}}}`. Claves blancas, `Object.hasOwn`, lo que no casa con `SCOPE_KEY` se cae; un string es lo de antes y se migra a `legacyScope`.
- `contextFor(ctxs, scopeKey, {fallback:'*'})`.
- `withContext(ctxs, scopeKey, {text, indexedAt, now})` (inmutable).
- `scopesWithMap(ctxs)`.
- `pagesOfSpace(index, key)`.
- `subIndex(index, key)` (sólo filtra `pages`: no toca espacios ni incidencias).
- `linkedSpacesFor({jiraContext, linkedIndex, history, projectKey, linkedContexts})` (ver punto 5).

Almacén:
- `faro:context:<host>` pasa a ser ese objeto: misma clave, mismo área (`local`), el olvido intacto.
- `faro:profile:<host>` pasa a `{version:1, byProject:{KEY: perfil PROFILE_VERSION 2}}`, con `normalizeProfiles` en jira-rest.js. `profileForProject(profiles, key)` cambia de semántica: busca en el mapa, en vez de comparar el único perfil guardado. Un perfil suelto de hoy se migra bajo su `projectKey`.
- `sites[host].onboarded` se queda: significa «el sitio ya pasó la primera configuración». Lo que es «tiene mapa» pasa a ser por ámbito y se deriva de `scopes[k].indexedAt` (o de páginas de ese espacio en el índice).
- NO se anida nada en `sites[host]`, porque `saveSite` funde a un solo nivel (storage.js:36-41).

El índice se queda en v3 y en una clave, SIN migración:
- `scope` pasa a ser «el último ámbito indexado» (sólo informativo).
- `growTreeFromPage` estampa `spaceKey: state.site.spaceKey` en las filas que llegan sin él (hoy entran con null, verificado).
- Tope total opcional: `INDEX_LIMITS.maxPagesTotal`, decisión de Marco.

**2. Flujo (§4.6)**

- **bootForSite**: `state.contexts = normalizeContexts(bundle.contextRaw, {legacyScope: scopeKeyOf del bundle.index?.scope})` y `state.contextMd = contextFor(state.contexts, scopeKeyOf(state.site))`. getSiteBundle cambia `contextMd` por `contextRaw`, con su pin de claves exactas.
- **refreshTab**: nuevo `changedScope = !changedHost && scopeKeyOf(site) !== scopeKeyOf(state.site)`. Si cambia de ámbito, se recalculan `state.contextMd` y `state.references` sin leer nada, `state.sourcesSuggest` sube el testigo, y se repinta el chip de estado del mapa.
- **generateContext**:
  - Guarda con `saveContexts(host, withContext(…, scopeKeyOf(sitio), {text, indexedAt}))`, bajo el host Y el ámbito capturados al empezar (§8.22).
  - Leer-fundir-escribir de la clave entera, con la misma guarda `sigueAqui`: se relee lo guardado justo antes de escribir, para no pisar otro ámbito que se haya indexado en paralelo.
  - Con `keepContext` (subida a mano) igual, en el ámbito de la pestaña.
- **Espacio sin mapa propio**: nada bloqueante.
  - offerNavigation sustituye `indexSize(state.index)` por «hay páginas de este espacio» y enseña `sinMapaCard` con el texto «Me falta el mapa de este espacio».
  - El estado vacío del chat enseña una línea «DCPIAS aún no tiene mapa · Construir».
  - La pantalla de contexto NO se abre sola: la decisión 1 lo deja a Marco.
- **treeTitles** al reindexar sigue usando el `restIndex` del espacio (ya es así).
- **indexDigest** gana `preferSpace` (primero las del espacio de la pestaña) y **suggestFromIndex** gana `preferSpace`. Se ordena primero el espacio de la pestaña, pero no se filtra: una página base de otro espacio es legítima (verificado en proto).

**3. Qué ve el modelo**

- En baseSystem, `contextScope` opcional. Con él, la cabecera dice `--- CONTEXTO DE ESTE SITIO (espacio «DCPIAS»; ${CONTEXT_LABEL}) ---`: se conserva el prefijo que usan los cortes de prompts.js:723.
- Sin él (contexto migrado `'*'`), byte a byte lo de hoy: las 37 instantáneas no cambian y se añaden 2 escenarios nuevos (confluence con ámbito y jira con ámbito).
- Si el espacio no tiene contexto propio y existe `'*'`, va `'*'`.
- Si no, una sola línea de Faro fuera de bloque: «Este sitio tiene mapa de otros espacios: SIMPL, OPS» (sólo claves validadas, sin prosa).

**4. Qué mirar hoy**

Sin cambios: `sameScope` ya es por espacio (today.js:570-571).

**5. Confluence enlazado desde Jira**

loadLinkedContext recibe todos los contextos del host enlazado (ya vienen en su bundle) y `linkedSpacesFor` elige, determinista:
- (a) los espacios de las páginas que el CONTEXT.md del proyecto de Jira cita con id (`referencesFromContext` + `spaceKey` en el índice enlazado), el más citado primero;
- (b) si no, los espacios de las páginas base que el historial de ese proyecto usó (source-history lleva `spaceKey` por página);
- (c) si no, el único espacio con contexto;
- (d) si no, todos, repartiendo `CONTEXT_BUDGET.linked` a partes iguales con un subbloque por espacio.

Cada subbloque va dentro del mismo LINKED_OPEN/CLOSE con «(espacio «X»)» y `dato()` en la clave.

**6. Jira (D2)**

- `scopeKeyOf` → `'project:KEY'`; el contexto por proyecto con el mismo mapa.
- Perfil `byProject`: refreshTab deja de recontar al alternar proyectos, porque `currentProfile` busca en el mapa; `state.profileAsked` sigue siendo la tregua.
- El indexador de Jira ya es por proyecto (`indexExploreJira`, scope project).

**7. «Qué guarda Faro de mí»**

La fila «contexto» pasa a «N espacios/proyectos con contexto (SIMPL, DCPIAS…)» —las claves son la excepción aceptada, como la clave del proyecto del perfil—, y «índice» pasa a «N páginas en M espacios».

**8. Banco y espejo**

- tools/cql-eval.mjs gana un segundo espacio OPS (árbol propio y portada propia).
- Tramo nuevo 63: `fetchSpacePages` de ENG y de OPS → dos `indexFromSpacePages` → `mergeIndex`. Pina que:
  - `subIndex(ENG)` da página a página lo mismo que el tramo 51;
  - `treeTitles(subIndex(OPS))` no contiene ningún id de ENG;
  - `treeSteps` de una página de OPS estando en ENG empieza por «Espacio OPS».
- Los tramos 51 y 60-62 no cambian (indexFromSpacePages y tree-dom intactos).
- Espejo: la pantalla de contexto con «el espacio X», la línea «sin mapa» del estado vacío y las filas nuevas de privacidad en CAJAS.

## Ficheros y pines que toca

- NUEVO src/shared/scopes.js (puro): scopeKeyOf, SCOPE_KEY, CONTEXTS_VERSION, normalizeContexts, contextFor, withContext, scopesWithMap, pagesOfSpace, subIndex, linkedSpacesFor. Con test/unit/scopes.test.js (~20 pruebas: forma, basura, __proto__, migración idempotente, SEGURIDAD de claves de ámbito, orden determinista de linkedSpacesFor). En shared/ para que storage.js y el panel la compartan; entra en web_accessible_resources por src/shared/*.js (web-accessible.test.js sólo si el content script la importa, y no debería).
- src/shared/storage.js: getSiteBundle cambia la clave `contextMd` por `contextRaw` → storage.test.js pina las claves EXACTAS ['contextMd','extras','index','memoryRaw','site','stale'] y cambia con verdad. getProfile/saveProfile pasan a `byProject` (getProfile(host, projectKey), saveProfile(host, profile), que funde). forgetEverythingFor NO cambia, y la prueba 'toda clave por host declara su área' (storage.test.js:331) sigue en verde sin tocarse: es el argumento a favor de (iii).
- src/panel/memory.js:91-99 getContextMd/saveContextMd → getContexts/saveContexts(host, ctxs) con normalizeContexts al leer y al guardar (como saveMemory). memory.test.js cambia las pruebas de contexto ('saveContextMd bajo «faro:context:<host>»').
- src/shared/jira-rest.js:886-890 profileForProject busca en el mapa; normalizeProfiles nuevo; jira-rest.test.js ('SEGURIDAD: profileForProject sólo deja pasar el perfil del proyecto que hay delante' se reescribe) y los pines de panel-wiring.test.js:2530-2656 sobre currentProfile/getProfile/profileAsked.
- src/panel/panel.js: bootForSite (state.contexts; pines :920-1010 y 3657/3701/3831 'bundle.contextMd'); refreshTab (changedScope, pin nuevo por posición: dentro de `!changedHost` y sin ninguna lectura del almacén); generateContext (:7174 `saveContextMd(host,` está pinado en panel-wiring.test.js:576 → pasa a saveContexts(host, … scopeKey capturado); el pin de C2 se actualiza con verdad); uploadContext (:7248); offerNavigation (:3323, sinMapaCard por espacio); growTreeFromPage (:3133, estampar spaceKey); sourcesIndex/onSourcesInput (preferSpace); currentReferences (:1322, contexto del ámbito); loadLinkedContext (:1263, linkedSpacesFor); showContextScreen (:5880, «el espacio X» ya sale de scope.label); paintPrivacy (:6232); estado vacío (línea «sin mapa»).
- src/panel/prompts.js: baseSystem(contextScope opcional) :257-261, sin tocar CONTEXT_LABEL ni el prefijo '--- CONTEXTO DE ESTE SITIO' (:723, cortes de preloadFromSystem/sourcesFromSystem); bloque enlazado con subbloques por espacio (:143, :279). seleccion.test.js: orden y recortes del enlazado, un escenario multi-espacio; prompt-snapshots: 37 intactos + 2 nuevos (confluence con ámbito, jira enlazado con dos espacios).
- src/atlassian/index-store.js: indexDigest({preferSpace}) y, si Marco lo decide, un tope total en mergeIndex (con index-store.test.js: 'fundir dos veces lo mismo da lo mismo' sigue verde). src/panel/sources.js suggestFromIndex({preferSpace}) + sources.test.js.
- src/panel/indexer.js: sin cambios de firma (indexFromSpacePages y buildContext ya son por ámbito); indexer.test.js sólo si growTreeFromPage mueve lógica a una pura (mejor: pura `stampSpace(index, spaceKey)` en scopes.js).
- tools/cql-eval.mjs (segundo espacio OPS) + serve-harness.test.js (el contrato con parseSpaceSearch para OPS); harness/harness.js tramo 63 (docs.test.js exige 1..N sin huecos y un ok( por tramo); harness/panel-preview.html (pantalla de contexto, línea sin mapa, filas de privacidad) + los pines del espejo en panel-wiring.test.js.
- Docs: CLAUDE.md §3 (mapa: scopes.js), §4.1/§4.6 (flujo por ámbito), §6 (contratos «Contextos por ámbito», «Perfil del proyecto» → byProject, «Paquete del sitio» contextRaw, «Índice» con spaceKey obligatorio en la barra lateral), §8.20/§4.11 (privacidad), §10 (pines nuevos), §12.3 decisión 5 → RESUELTA; README e INSTALL (qué pasa al entrar en un espacio sin mapa); títulos de registro nuevos si los hay (p. ej. «Mapa de otro espacio») en §9 e INSTALL, que el paso docs exige.

## Riesgos y límites

- Todos los contextos del host se leen en cada arranque (unos 24 KB por ámbito). Con decenas de espacios indexados serían cientos de KB por arranque: aceptable, pero sin medir en el navegador. `npm run bench` podría medir normalizeContexts con 20 ámbitos.
- saveContexts es leer-fundir-escribir de una clave compartida por ámbitos: dos generateContext en paralelo del mismo host (uno en segundo plano tras cambiar de espacio) podrían perder uno si no se relee justo antes de escribir. Ventana de milisegundos, como el diario (§4.10); peor caso: perder un contexto recién generado.
- La migración asigna el string de hoy al `index.scope` guardado. Si ese índice era de otra versión (takeIndex lo tira), o el scope era 'confluence-site', va a '*' y ese contexto se enseña en TODOS los espacios hasta que se reindexen (que es lo de hoy: no hay regresión).
- Un Confluence sin índice pero con contexto subido a mano antes de esto: el contexto se queda en '*', y así debe ser.
- El índice único sigue creciendo sin tope al indexar espacios nuevos (300 por espacio). Sin tope total, 10 espacios son unos 325 KB escritos en cada persistIndex del turno (P3 escribe el objeto entero).
- Páginas cosechadas de las herramientas del MCP (harvestIndex) pueden entrar sin spaceKey. `pagesOfSpace` no las contará para «este espacio tiene mapa», y la sugerencia por título las verá sin preferencia. Aceptable: el mapa lo da el árbol leído de la API, que siempre trae espacio.
- linkedSpacesFor depende de que el CONTEXT.md del proyecto de Jira cite páginas con id. Los contextos generados antes de H9 casi nunca lo hacen: caerán a (b)-(d), repartiendo el presupuesto entre todos los espacios con contexto.
- Nada de esto se puede verificar contra el Confluence real de Marco sin tener DOS espacios indexados. El PASO 0 vio SIMPL, DCPIAS y SPCK en recentlyViewedContent: existen, pero indexar un segundo espacio gasta un turno de modelo (fase 1).
- No he tocado el repo ni opencode. Las sondas (probe.mjs, proto.mjs) están en el scratchpad, en area-d, y sólo importan módulos puros.

## Decisiones que el investigador deja a Marco

- 1. Al entrar en un espacio del mismo Confluence que todavía no tiene mapa: ¿aviso NO bloqueante (línea en el chat vacío «DCPIAS aún no tiene mapa · Construir» y la tarjeta «Me falta el mapa de este espacio» al pedir navegación) —recomendado— o abrir la pantalla de contexto como la primera vez?
- 2. Qué contexto ve el modelo en un espacio sin contexto propio: ¿ninguno + la línea «hay mapa de SIMPL, OPS» (recomendado), el antiguo '*' si existe, o el del espacio más parecido?
- 3. La memoria entre sesiones y la sesión de opencode, ¿siguen siendo por host (recomendado: la conversación cruza espacios y el usuario la ve como una) o por espacio?
- 4. Desde Jira, qué CONTEXT.md del Confluence enlazado viaja: la regla automática propuesta (espacios citados por el contexto del proyecto → historial de páginas base → único con contexto → todos con presupuesto repartido), ¿o además un selector manual en Ajustes «este proyecto se documenta en el espacio X»?
- 5. Tope total del índice entre espacios (p. ej. INDEX_LIMITS.maxPagesTotal = 1500, soltando las páginas del espacio indexado hace más tiempo) o sin tope.
- 6. Páginas base sugeridas y búsqueda por título: ¿el espacio de la pestaña DELANTE sin excluir los demás (recomendado: la documentación de un análisis puede vivir en otro espacio) o sólo el espacio actual?
- 7. Paso a paso a una página de otro espacio: hoy funciona y abre primero el otro espacio. ¿Se mantiene (recomendado) o se limita al espacio actual?
- 8. Orden de los hitos: D1 (Confluence) primero y D2 (Jira: contexto y perfil por proyecto, que cierra §12.3 decisión 5) después, o los dos juntos.

## Pruebas propuestas

- Unitarias, scopes.test.js: scopeKeyOf en las ramas producto × con/sin clave × clave rara (SEGURIDAD: 'space:A"B', '~', '_' → '*'); normalizeContexts: string → legacyScope, idempotente, claves blancas, __proto__/constructor ignorados, versión distinta → vacío, texto vacío fuera; withContext no muta; contextFor con fallback '*'; pagesOfSpace/subIndex sin tocar espacios ni incidencias; linkedSpacesFor determinista en las cuatro ramas y con el presupuesto repartido que no pasa de CONTEXT_BUDGET.linked.
- storage.test.js: getSiteBundle con contextRaw (claves exactas nuevas); forgetEverythingFor sigue llevándose el objeto de contextos entero; perfiles byProject: migrar el perfil suelto de hoy, dos proyectos que no se pisan, otra versión → sin perfil.
- memory.test.js: getContexts/saveContexts normalizan al leer y al guardar, reparan una vez lo de antes (string → objeto) y un ámbito no pisa a otro.
- panel-wiring.test.js (por regex, sin comentarios): refreshTab calcula changedScope DENTRO del camino sin changedHost y sin await del almacén; generateContext escribe bajo host Y ámbito capturados antes del primer await (§8.22), relee antes de escribir, y en el catch no marca el ámbito como indexado; offerNavigation usa pagesOfSpace en vez de indexSize; growTreeFromPage estampa spaceKey; currentReferences/loadLinkedContext usan el contexto del ámbito; nadie consume state.contextMd sin pasar por contextFor. Cada pin demostrado por mutación.
- prompt-snapshots: las 37 intactas (sin ámbito, byte a byte) + 2 escenarios nuevos: confluence-general con contextScope y jira-analisis con enlazado de dos espacios; seleccion.test.js: la cabecera con «(espacio «X»; …)» conserva el prefijo que usa preloadFromSystem, y SEGURIDAD: una clave de espacio con salto o comilla no abre línea.
- index-store.test.js / sources.test.js: indexDigest({preferSpace}) y suggestFromIndex({preferSpace}) ponen delante las del espacio sin quitar las otras, en orden estable.
- Banco: tools/cql-eval.mjs con un segundo espacio OPS + serve-harness.test.js (parseSpaceSearch lo entiende) + tramo 63 del selfcheck: dos lecturas por la API, mergeIndex, subIndex(ENG) igual al tramo 51 página a página, treeTitles(subIndex(OPS)) sin ningún id de ENG, y treeSteps de una página de OPS estando en ENG empezando por 'confluence-space:OPS open'.
- Espejo: pantalla de contexto «el espacio OPS», línea «sin mapa» del estado vacío y filas de privacidad dentro de CAJAS; faroPreview.check() en verde a 320/420 × claro y oscuro.
- Verificación en real (a cargo del orquestador, sólo GET, como en H14): cargar los módulos como blob URL en dos espacios reales del Confluence de Marco (SIMPL y DCPIAS), fetchSpacePages de los dos, fundir, y comprobar subIndex, treeTitles y treeSteps entre espacios; en la extensión cargada, que al pasar de un espacio a otro el chip del mapa y las sugerencias cambien sin rearranque.

## Sondas (fuera del repo, en el scratchpad de la sesión)

- <scratchpad>/area-d\probe.mjs (qué pasa HOY con dos espacios: claves, mergeIndex, scope, treeTitles, suggestFromIndex, treeSteps entre espacios, indexDigest, growTreeFromPage sin spaceKey, tamaño con 600 páginas)
- <scratchpad>/area-d\proto.mjs (prototipo de la opción iii: scopeKeyOf, normalizeContexts con migración idempotente, contextFor, pagesOfSpace/subIndex, ordenar el espacio de la pestaña primero, 10 contextos en una clave = 240 324 bytes)
