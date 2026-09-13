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

/** Hora corta para el registro. */
export function clockTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
