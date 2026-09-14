/**
 * Los ajustes guardados por una versión anterior siguen valiendo.
 *
 * Había una casilla, `assistedByDefault`; ahora hay un modo de navegación con
 * dos valores. Leer unos ajustes viejos no puede dejar el panel sin modo ni
 * cambiarle a nadie lo que había elegido.
 */
import { test, eq, assert } from '../harness.js'
import { migrateSettings, DEFAULT_SETTINGS, NAV_MODES, SAFE_PERMISSIONS as DESDE_CONFIG } from '../../src/shared/config.js'
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
