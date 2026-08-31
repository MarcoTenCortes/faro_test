/**
 * Los dos niveles de memoria.
 *
 * Dentro de una sesión no hay nada que implementar: una sesión de opencode ya
 * es un hilo con historial. Lo que se construye aquí es el nivel de arriba —
 * el resumen de una sesión que sobrevive a la siguiente — y es opcional
 * porque un resumen puede arrastrar cosas que no quieres guardar.
 */

import { STORAGE_KEYS } from '../shared/config.js'
import { memorySummaryPrompt } from './prompts.js'

const MAX_ENTRIES = 40
const MAX_CHARS = 12000

export async function getContextMd(host) {
  const key = STORAGE_KEYS.context(host)
  const got = await chrome.storage.local.get(key)
  return got[key] || ''
}

export async function saveContextMd(host, md) {
  await chrome.storage.local.set({ [STORAGE_KEYS.context(host)]: String(md || '') })
}

export async function getMemory(host) {
  const key = STORAGE_KEYS.memory(host)
  const got = await chrome.storage.local.get(key)
  return got[key] || { entries: [] }
}

export async function saveMemory(host, memory) {
  await chrome.storage.local.set({ [STORAGE_KEYS.memory(host)]: memory })
}

export async function clearMemory(host) {
  await chrome.storage.local.remove(STORAGE_KEYS.memory(host))
}

export async function addEntry(host, text) {
  const memory = await getMemory(host)
  memory.entries.unshift({ at: Date.now(), text: String(text || '').trim() })
  memory.entries = memory.entries.slice(0, MAX_ENTRIES)
  await saveMemory(host, memory)
  return memory
}

export async function removeEntry(host, at) {
  const memory = await getMemory(host)
  memory.entries = memory.entries.filter((e) => e.at !== at)
  await saveMemory(host, memory)
  return memory
}

/** Texto que se inyecta en el `system` de cada turno. Acotado a lo reciente. */
export function memoryToPrompt(memory) {
  if (!memory?.entries?.length) return ''
  const out = []
  let total = 0
  for (const e of memory.entries) {
    const line = `[${new Date(e.at).toISOString().slice(0, 10)}] ${e.text}`
    if (total + line.length > MAX_CHARS) break
    out.push(line)
    total += line.length
  }
  return out.join('\n\n')
}

/**
 * Resume la sesión que se cierra. Usa el propio resumidor de opencode y, si
 * no da texto aprovechable, pide el resumen a mano.
 */
export async function summarizeSession(client, { sessionID, model }) {
  try {
    const msg = await client.prompt(sessionID, { text: memorySummaryPrompt(), model })
    const text = (msg?.parts || [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
      .trim()
    return text.slice(0, 1200)
  } catch {
    return ''
  }
}

/** ¿Ha pasado algo en esta sesión que merezca guardarse? */
export function worthRemembering(turns) {
  return Array.isArray(turns) && turns.filter((t) => t.role === 'user').length >= 1
}
