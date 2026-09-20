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
