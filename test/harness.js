/** Arnés de pruebas mínimo: sin dependencias, corre con `node test/run.js`. */

export const registry = []

export function test(name, fn) {
  registry.push({ name, fn })
}

export class AssertionError extends Error {}

export function assert(cond, msg = 'se esperaba un valor verdadero') {
  if (!cond) throw new AssertionError(msg)
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    throw new AssertionError(`${msg}\n     esperado: ${b}\n     obtenido: ${a}`)
  }
}

export function near(actual, expected, tolerance = 0.001, msg = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(`${msg} esperado ~${expected}, obtenido ${actual}`)
  }
}

export async function throws(fn, msg = 'se esperaba una excepción') {
  try {
    await fn()
  } catch {
    return
  }
  throw new AssertionError(msg)
}
