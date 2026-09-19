/** Formateo de textos que se enseñan al usuario. Puro. */

/**
 * Nombre legible de una herramienta MCP.
 *
 * Lo que llega es `atlassian-confluence-simplprogramme-eu_confluence_get_page`,
 * que en pantalla no dice nada. Se queda en «Confluence: get page».
 */
export function prettyTool(name) {
  if (!name) return 'trabajando…'
  return String(name)
    .replace(/^atlassian[^_]*_/i, '')
    .replace(/^(confluence|jira)_/i, (m, p) => (p.toLowerCase() === 'jira' ? 'Jira: ' : 'Confluence: '))
    .replace(/_/g, ' ')
    .trim()
}

/**
 * Un tamaño en bytes para una fila del Registro: «512 KB» · «8,4 MB».
 *
 * POR QUÉ EXISTE: la fila «almacenamiento» se escribía siempre en KB («8598 KB
 * de 10 MB») mientras el espejo del panel la enseñaba en MB, así que el mismo
 * dato tenía dos unidades según dónde se mirara; y en KB nadie ve de un vistazo
 * cuánto queda de la cuota de 10 MB (revisión adversaria de H3). Coma decimal y
 * un decimal, como las duraciones de `timingLine`.
 *
 * No es la `formatSize` de tools/last-turn.mjs: ésa mide salidas de herramientas,
 * que pueden ser de tres caracteres, y por eso tiene tramo en «B». Aquí lo
 * medido es una cuota de megas y por debajo de 1 MB los KB bastan.
 *
 * Lo que no sea un número de bytes cuenta como cero: una fila del Registro no
 * puede tumbar la pantalla de estado. Pura.
 */
export function formatBytes(bytes) {
  const b = Math.max(0, Number(bytes) || 0)
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** Hora corta para el registro. */
export function clockTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
