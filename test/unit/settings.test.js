/**
 * Los ajustes guardados por una versión anterior siguen valiendo.
 *
 * Había una casilla, `assistedByDefault`; ahora hay un modo de navegación con
 * dos valores. Leer unos ajustes viejos no puede dejar el panel sin modo ni
 * cambiarle a nadie lo que había elegido.
 */
import { test, eq, assert } from '../harness.js'
import {
  migrateSettings,
  DEFAULT_SETTINGS,
  NAV_MODES,
  RESTORE_LIMITS,
  SESSION_LIMITS,
  STORAGE_KEYS,
  INDEX_LIMITS,
  PROFILE_LIMITS,
  MCP_ATLASSIAN_VERSION,
  SAFE_PERMISSIONS as DESDE_CONFIG,
} from '../../src/shared/config.js'
import { SAFE_PERMISSIONS } from '../../src/shared/permissions.js'

test('config.js reexporta SAFE_PERMISSIONS de permissions.js: quien lo importaba de aquí recibe la misma lista', () => {
  assert(DESDE_CONFIG === SAFE_PERMISSIONS, 'la misma referencia, no una copia')
  eq(DESDE_CONFIG[0], { permission: '*', pattern: '**', action: 'deny' })
})

test('por defecto se navega en modo guiado, y la casilla vieja ya no existe', () => {
  eq(DEFAULT_SETTINGS.navMode, 'guided')
  assert(NAV_MODES.includes(DEFAULT_SETTINGS.navMode))
  eq('assistedByDefault' in DEFAULT_SETTINGS, false)
})

test('sin nada guardado: guiada', () => {
  eq(migrateSettings(undefined).navMode, 'guided')
  eq(migrateSettings(null).navMode, 'guided')
  eq(migrateSettings({}).navMode, 'guided')
})

test('quien desmarcó la casilla quería menos recorrido: pasa a rápida', () => {
  const s = migrateSettings({ assistedByDefault: false, stepDelayMs: 900 })
  eq(s.navMode, 'quick')
  eq('assistedByDefault' in s, false, 'la casilla vieja desaparece')
  eq(s.stepDelayMs, 900, 'y el resto no se toca')
})

test('la casilla marcada era el comportamiento de siempre: guiada', () => {
  eq(migrateSettings({ assistedByDefault: true }).navMode, 'guided')
})

test('un modo ya guardado manda sobre la casilla vieja', () => {
  eq(migrateSettings({ navMode: 'quick', assistedByDefault: true }).navMode, 'quick')
  eq(migrateSettings({ navMode: 'guided', assistedByDefault: false }).navMode, 'guided')
})

test('un modo desconocido cae en el guiado en vez de romper', () => {
  eq(migrateSettings({ navMode: 'lo-que-sea' }).navMode, 'guided')
  eq(migrateSettings({ navMode: 42 }).navMode, 'guided')
})

test('no se muta lo que entra', () => {
  const raw = { assistedByDefault: false }
  migrateSettings(raw)
  eq(raw, { assistedByDefault: false })
})

// ------------------------------------------------------------------ H7

test('H7: las lecturas REST vienen activadas, y quien las apague sigue con ellas apagadas', () => {
  // Es el interruptor maestro de todo lo que H8-H11 leen de la API con la sesión
  // del navegador: la lista de una búsqueda, los chips, el perfil, el índice y
  // las sugerencias por actividad.
  eq(DEFAULT_SETTINGS.restTools, true)
  eq(migrateSettings({}).restTools, true, 'unos ajustes de antes de H7 no dejan el panel sin el interruptor')
  eq(migrateSettings(undefined).restTools, true)
  eq(migrateSettings({ restTools: false }).restTools, false, 'lo que eligió el usuario manda')
  // Lo que no es un booleano no lo escribió Faro: cuenta como no elegido.
  for (const raro of ['false', 0, 1, null, {}]) eq(migrateSettings({ restTools: raro }).restTools, true, JSON.stringify(raro))
  const raw = { restTools: false }
  migrateSettings(raw)
  eq(raw, { restTools: false }, 'y no se muta lo que entra')
})

test('H7: el árbol leído de la API tiene tope de peticiones, y las páginas siguen teniendo UN solo tope', () => {
  // Con 300 páginas y 100 por petición sobran doce; el tope está para que un
  // servidor que siempre diga que hay más no se convierta en decenas de GET.
  assert(Number.isInteger(INDEX_LIMITS.restMaxRequests) && INDEX_LIMITS.restMaxRequests >= 1)
  assert(
    INDEX_LIMITS.restMaxRequests * 100 >= INDEX_LIMITS.maxPages,
    'con el tamaño de página de confluence-rest.js tienen que caber las maxPages'
  )
  eq(INDEX_LIMITS.maxPages, 300, 'el tope de páginas del índice no cambia por leerlo de la API')
  assert(!('restMaxPages' in INDEX_LIMITS), 'un segundo tope de páginas acabaría diciendo otra cosa que maxPages')
})

// ------------------------------------------------------------------ H11

test('H11: «Qué mirar hoy» viene activado y está SUBORDINADO al interruptor maestro', () => {
  eq(DEFAULT_SETTINGS.todaySuggestions, true)
  eq(migrateSettings({}).todaySuggestions, true, 'unos ajustes de antes de H11 no dejan el panel sin él')
  eq(migrateSettings(undefined).todaySuggestions, true)
  eq(migrateSettings({ todaySuggestions: false }).todaySuggestions, false, 'lo que eligió el usuario manda')
  for (const raro of ['false', 0, 1, null, {}]) {
    eq(migrateSettings({ todaySuggestions: raro }).todaySuggestions, true, JSON.stringify(raro))
  }
  const raw = { todaySuggestions: false }
  migrateSettings(raw)
  eq(raw, { todaySuggestions: false }, 'y no se muta lo que entra')
  // Subordinado: `restTools` sigue siendo el maestro de TODA lectura REST, así
  // que quien lo apague no consulta nada aunque esto siga marcado. Lo
  // comprueban quienes leen los dos (el service worker al apuntar y el panel al
  // consultar); aquí lo que se pina es que son DOS ajustes distintos.
  assert('restTools' in DEFAULT_SETTINGS && 'todaySuggestions' in DEFAULT_SETTINGS)
  eq(migrateSettings({ restTools: false }).todaySuggestions, true, 'apagar el maestro no desmarca la casilla')
})

test('H11: la actividad y la caché de hoy tienen su clave POR HOST, distintas de las demás', () => {
  eq(typeof STORAGE_KEYS.activity, 'function', 'es una clave por host, como el índice o el perfil')
  eq(typeof STORAGE_KEYS.today, 'function')
  eq(STORAGE_KEYS.activity('jira.simplprogramme.eu'), 'faro:actividad:jira.simplprogramme.eu')
  eq(STORAGE_KEYS.today('jira.simplprogramme.eu'), 'faro:today:jira.simplprogramme.eu')
  const host = 'x.eu'
  const otras = [
    STORAGE_KEYS.index(host),
    STORAGE_KEYS.context(host),
    STORAGE_KEYS.memory(host),
    STORAGE_KEYS.session(host),
    STORAGE_KEYS.sessionWeight(host),
    STORAGE_KEYS.profile(host),
    STORAGE_KEYS.sourceHistory(host),
  ]
  assert(!otras.includes(STORAGE_KEYS.activity(host)), 'el diario no pisa ninguna de las que ya había')
  assert(!otras.includes(STORAGE_KEYS.today(host)), 'ni la caché')
  assert(STORAGE_KEYS.activity(host) !== STORAGE_KEYS.today(host), 'y el diario no es la caché: uno dura 30 días y la otra 15 minutos')

  // Y la marca de borrado (revisión adversaria de H11): otra clave por host, en
  // storage.session, que es lo que hace que una escritura tardía del service
  // worker no devuelva un diario recién borrado. No es la del diario ni la de la
  // caché, porque sobrevive a que las dos se vayan.
  eq(typeof STORAGE_KEYS.activityCleared, 'function')
  eq(STORAGE_KEYS.activityCleared('jira.simplprogramme.eu'), 'faro:actividad-borrada:jira.simplprogramme.eu')
  assert(!otras.includes(STORAGE_KEYS.activityCleared(host)), 'no pisa ninguna de las que ya había')
  assert(
    STORAGE_KEYS.activityCleared(host) !== STORAGE_KEYS.activity(host) && STORAGE_KEYS.activityCleared(host) !== STORAGE_KEYS.today(host),
    'ni el diario ni su caché'
  )
})

// ------------------------------------------------------------------ H9

test('H9: el perfil del proyecto tiene su clave POR HOST, distinta de las demás', () => {
  eq(typeof STORAGE_KEYS.profile, 'function', 'es una clave por host, como el índice o la memoria')
  eq(STORAGE_KEYS.profile('jira.simplprogramme.eu'), 'faro:profile:jira.simplprogramme.eu')
  const host = 'x.eu'
  const otras = [STORAGE_KEYS.index(host), STORAGE_KEYS.context(host), STORAGE_KEYS.memory(host), STORAGE_KEYS.session(host), STORAGE_KEYS.sessionWeight(host)]
  assert(!otras.includes(STORAGE_KEYS.profile(host)), 'y no pisa ninguna de las que ya había')
})

// ------------------------------------------------------------------ H10

test('H10: el historial de páginas base tiene su clave POR HOST, y las referencias NO tienen clave', () => {
  eq(typeof STORAGE_KEYS.sourceHistory, 'function', 'es una clave por host, como el índice o el perfil')
  eq(STORAGE_KEYS.sourceHistory('jira.simplprogramme.eu'), 'faro:source-history:jira.simplprogramme.eu')
  const host = 'x.eu'
  const otras = [
    STORAGE_KEYS.index(host),
    STORAGE_KEYS.context(host),
    STORAGE_KEYS.memory(host),
    STORAGE_KEYS.session(host),
    STORAGE_KEYS.sessionWeight(host),
    STORAGE_KEYS.profile(host),
  ]
  assert(!otras.includes(STORAGE_KEYS.sourceHistory(host)), 'y no pisa ninguna de las que ya había')
  // docs/PLAN.md §3.2 descartó la lista estructurada de páginas de referencia
  // del indexador: sin nada que guardar, una clave que nadie escribe sería una
  // promesa falsa. El parser de prosa las saca del CONTEXT.md al vuelo.
  eq('references' in STORAGE_KEYS, false, 'las páginas de referencia se calculan, no se guardan')
})

test('H9: del perfil guardado, aquí sólo vive lo que es de almacenamiento', () => {
  // La FORMA (cuántos tipos, cuántos prefijos, cuánto mide un nombre) la decide
  // `JIRA_REST_LIMITS` en el módulo que lo cuenta: dos topes de lo mismo en dos
  // sitios acabarían diciendo cosas distintas (CLAUDE.md §9).
  eq(Object.keys(PROFILE_LIMITS).sort(), ['ttlMs'])
  assert(Number.isInteger(PROFILE_LIMITS.ttlMs) && PROFILE_LIMITS.ttlMs > 0)
  assert(PROFILE_LIMITS.ttlMs >= 60 * 60 * 1000, 'recontar cuesta una petición: no se hace cada hora')
  for (const k of ['profileList', 'profilePrefixes', 'profileExamples', 'maxPages', 'list', 'prefixes']) {
    assert(!(k in PROFILE_LIMITS), `${k} no es un tope de almacenamiento: vive donde se cuenta el perfil`)
  }
})

// ------------------------------------------------------------------ H6 (P6b)

test('H6: la ventana de la restauración es un tope de seguridad, no una ventana deslizante', () => {
  // `listMessages` sin `limit` traía la sesión ENTERA —salidas de herramientas
  // incluidas, megabytes— cada vez que se abre el panel (docs/PLAN.md §2.6 P6b).
  // El número tiene que ser de mensajes, entero y holgado: las sesiones reales
  // son de 1-4 turnos (≈8 mensajes), así que 60 no recorta ninguna de verdad.
  eq(Object.keys(RESTORE_LIMITS).sort(), ['messages'])
  assert(Number.isInteger(RESTORE_LIMITS.messages), 'un número de mensajes es entero')
  assert(RESTORE_LIMITS.messages >= 20, 'por debajo de 20 se recortarían conversaciones normales')
})

test('H6: el umbral de «Conversación pesada» va por encima de lo que opencode protege', () => {
  // opencode poda las salidas de herramientas viejas dejando `PRUNE_PROTECT`
  // (40 000 tokens) sin tocar: avisar por debajo de eso sería avisar de algo que
  // el servidor ya resuelve solo. 200 000 caracteres ≈ 50 000 tokens, o sea el
  // primer punto en el que la conversación arrastra MÁS de lo protegido.
  eq(Object.keys(SESSION_LIMITS).sort(), ['heavyToolChars'])
  assert(Number.isInteger(SESSION_LIMITS.heavyToolChars), 'se cuenta en caracteres enteros')
  assert(
    SESSION_LIMITS.heavyToolChars >= 160000,
    'el aviso tiene que quedar por encima de los 40 000 tokens que opencode protege (≈160 000 caracteres)'
  )
})

test('H6: el peso de la sesión se guarda por host, como la sesión misma', () => {
  eq(typeof STORAGE_KEYS.sessionWeight, 'function', 'es una clave POR HOST')
  eq(STORAGE_KEYS.sessionWeight('a.b'), 'faro:session-weight:a.b')
  // Vive junto a `faro:session:<host>` y muere con ella (las dos en
  // storage.session): un peso que sobreviviera a su sesión avisaría de lo que
  // arrastra una conversación que ya no existe.
  assert(
    STORAGE_KEYS.sessionWeight('a.b') !== STORAGE_KEYS.session('a.b'),
    'pero no es la misma clave: el id de la sesión no se pisa con un número'
  )
})

test('H15: la versión fijada de mcp-atlassian es una cadena de tres números', () => {
  // Acaba en «uvx mcp-atlassian@<versión>» y en «uv tool install mcp-atlassian==<versión>»:
  // cualquier otra cosa (un «latest», un espacio, un «>=») cambiaría qué se ejecuta.
  eq(typeof MCP_ATLASSIAN_VERSION, 'string')
  assert(/^\d+\.\d+\.\d+$/.test(MCP_ATLASSIAN_VERSION), 'tres números separados por puntos: ' + MCP_ATLASSIAN_VERSION)
})

// ---- H16: el modelo es de la persona, y lo que Faro sabe de cada modelo ------

import { MODEL_LIMITS, STORAGE_AREAS } from '../../src/shared/config.js'

test('H16: el modelo es de la persona y nace sin elegir: ningún modelo se elige solo', () => {
  eq(DEFAULT_SETTINGS.model, null)
  eq(migrateSettings({}).model, null)
  eq(migrateSettings(undefined).model, null)
  const bueno = { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }
  eq(migrateSettings({ model: bueno }).model, bueno)
  eq(migrateSettings({ model: { providerID: ' openrouter ', modelID: ' meta/llama-3 ', extra: 1, name: 'x' } }).model, { providerID: 'openrouter', modelID: 'meta/llama-3' }, 'recortado y con claves blancas')
  const NEL = String.fromCharCode(0x85)
  const LS = String.fromCharCode(0x2028)
  for (const malo of [
    'github-copilot/gpt-5.6-luna',
    ['a', 'b'],
    7,
    true,
    { providerID: 'a' },
    { modelID: 'b' },
    { providerID: '', modelID: 'b' },
    { providerID: '   ', modelID: 'b' },
    { providerID: 'a', modelID: 3 },
    { providerID: 'a', modelID: 'x'.repeat(121) },
    { providerID: 'a\nb', modelID: 'c' },
    { providerID: 'a', modelID: 'b' + NEL + 'c' },
    { providerID: 'a', modelID: 'b' + LS + 'c' },
    { providerID: 'a', modelID: 'b' + String.fromCharCode(0) },
  ]) {
    eq(migrateSettings({ model: malo }).model, null, 'sin forma: ' + JSON.stringify(malo))
  }
  eq(migrateSettings({ model: { providerID: 'a', modelID: 'x'.repeat(120) } }).model.modelID.length, 120, 'el tope es inclusivo')
  const entra = { model: { providerID: 'a', modelID: 'b', extra: 1 } }
  const copia = JSON.stringify(entra)
  migrateSettings(entra)
  eq(JSON.stringify(entra), copia, 'no se muta lo que entra')
})

test('H16: los veredictos de los modelos tienen su clave GLOBAL, en local, distinta de las demás', () => {
  eq(STORAGE_KEYS.modelChecks, 'faro:model-checks')
  eq(typeof STORAGE_KEYS.modelChecks, 'string', 'no es una función de un host: el modelo no es de ningún sitio')
  eq(STORAGE_AREAS.modelChecks, 'local')
  const otras = Object.entries(STORAGE_KEYS)
    .filter(([n]) => n !== 'modelChecks')
    .map(([, k]) => (typeof k === 'function' ? k('faro:model-checks') : k))
  assert(!otras.includes('faro:model-checks'), 'no pisa ninguna otra clave')
  assert(!otras.some((k) => k.startsWith('faro:model-checks')), 'ni es el prefijo de ninguna')
})

test('H16: cada motivo de fallo caduca a su ritmo, y hay uno para cada motivo', () => {
  const H = 60 * 60 * 1000
  eq(MODEL_LIMITS.ttlMs, { ok: 7 * 24 * H, plan: 7 * 24 * H, credenciales: H, mudo: 24 * H, transitorio: 15 * 60 * 1000, otro: H })
  eq([MODEL_LIMITS.maxEntries, MODEL_LIMITS.messageMax], [100, 200])
  eq(Object.keys(MODEL_LIMITS).sort(), ['maxEntries', 'messageMax', 'ttlMs'])
})
