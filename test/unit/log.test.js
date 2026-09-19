/**
 * El registro: cada entrada con su id, y cuál es la más vieja que conserva.
 *
 * El Logger tiene un tope (400 entradas) y tira las viejas por delante. La
 * pantalla del Registro las pinta al revés (la más nueva arriba) y, desde H6
 * P8, mete la línea nueva sin repintar la lista. Para que esa lista incremental
 * no se separe de lo que `paintLog()` pintaría, cada fila lleva el id de su
 * entrada y se quitan las filas cuya entrada el registro ya ha olvidado.
 *
 * Hasta la revisión adversaria de H6 el recorte era sólo por número de filas
 * (200), y con «sólo problemas» puesto no se disparaba nunca: unos pocos avisos
 * entre seiscientas entradas siguen siendo unas pocas filas, así que la
 * pantalla enseñaba líneas que el registro ya no tenía. `oldestId` es lo que la
 * inserción pregunta, y es lo que se prueba aquí.
 */
import { test, eq, assert } from '../harness.js'
import { Logger, LEVELS } from '../../src/shared/log.js'

test('cada entrada tiene un id propio y creciente', () => {
  const log = new Logger()
  const a = log.info('uno')
  const b = log.warn('dos')
  const c = log.error('tres')
  eq([a.id, b.id, c.id], [1, 2, 3], 'los ids van de uno en uno')
  assert(log.entries.every((e) => typeof e.id === 'number'), 'todas las entradas guardadas lo llevan')
})

test('los ids no se reutilizan: ni al recortar por el tope ni al vaciar el registro', () => {
  const log = new Logger({ limit: 3 })
  for (let i = 0; i < 5; i++) log.info('l' + i)
  eq(log.entries.map((e) => e.id), [3, 4, 5], 'se quedan las tres últimas, con sus ids de siempre')
  log.clear()
  eq(log.entries, [], 'vaciar deja la lista vacía')
  eq(log.info('otra').id, 6, 'y el contador sigue donde estaba: un id no vuelve a salir')
})

test('oldestId dice cuál es la entrada más vieja que el registro conserva', () => {
  const log = new Logger({ limit: 4 })
  eq(log.oldestId, 0, 'sin nada guardado, cero: ninguna fila sobra por vieja')
  log.info('uno')
  eq(log.oldestId, 1)
  for (let i = 0; i < 6; i++) log.info('más')
  eq(log.entries.length, 4, 'el tope se respeta')
  eq(log.oldestId, log.entries[0].id, 'y es el id de la primera de las que quedan')
  eq(log.oldestId, 4, 'las tres primeras ya no están')
  log.clear()
  eq(log.oldestId, 0, 'un registro vaciado no conserva ninguna')
})

test('EL CAMBIO: con «sólo problemas» el tope de filas no basta; quitar por id deja la lista igual que un repintado entero', () => {
  // La regla de `appendLogRow`, sobre ids: la fila nueva arriba, y por abajo se
  // quitan las que el registro ya no tiene y las que pasan del tope de la
  // pantalla. Lo que se compara es esa lista incremental con la que pintaría
  // `paintLog()` desde cero.
  const FILAS = 200
  for (const total of [600, 1200]) {
    const log = new Logger({ limit: 400 })
    const filas = [] // ids, la más nueva primero, como los hijos de #log-body
    log.subscribe((e) => {
      if (!e) {
        filas.length = 0
        return
      }
      while (filas.length && filas[filas.length - 1] < log.oldestId) filas.pop()
      if ((LEVELS[e.level] ?? 0) < LEVELS.warn) return
      filas.unshift(e.id)
      while (filas.length > FILAS) filas.pop()
    })

    for (let i = 0; i < total; i++) log[i % 7 === 0 ? 'warn' : 'info']('l' + i)

    const entero = log
      .filter('warn')
      .slice(-FILAS)
      .reverse()
      .map((e) => e.id)
    eq(filas, entero, `con ${total} entradas la lista incremental es la del repintado entero`)
    assert(filas.length > 0 && filas.length < FILAS, 'y el tope de filas no se ha disparado: lo que la recorta es el id')
    assert(log.oldestId > 1, 'había entradas olvidadas que separar')
  }
})
