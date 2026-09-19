/**
 * Formateo de textos que se enseñan al usuario (src/shared/format.js).
 *
 * `clockTime` es la hora que lleva cada línea del registro. Se comprueba con
 * fechas construidas en hora LOCAL, que es la que enseña, para que pase igual
 * en cualquier zona horaria. (Plan 2026-09-13, D6: puras sin test.)
 */
import { test, eq } from '../harness.js'
import { clockTime, prettyTool, formatBytes } from '../../src/shared/format.js'

test('clockTime: HH:MM:SS en hora local, con ceros a la izquierda', () => {
  eq(clockTime(new Date(2026, 8, 13, 9, 5, 7).getTime()), '09:05:07')
  eq(clockTime(new Date(2026, 0, 1, 0, 0, 0).getTime()), '00:00:00')
  eq(clockTime(new Date(2026, 11, 31, 23, 59, 59).getTime()), '23:59:59')
})

test('clockTime: los milisegundos no se enseñan, y acepta un Date además de un número', () => {
  eq(clockTime(new Date(2026, 8, 13, 14, 30, 45, 999).getTime()), '14:30:45')
  eq(clockTime(new Date(2026, 8, 13, 14, 30, 45)), '14:30:45')
})

test('clockTime: un valor que no es una fecha no lanza', () => {
  // Nadie le pasa esto (el registro usa Date.now()), pero una línea del
  // registro nunca debe tumbar el panel: sale «NaN:NaN:NaN» y ya.
  eq(clockTime(NaN), 'NaN:NaN:NaN')
  eq(clockTime('ayer'), 'NaN:NaN:NaN')
})

test('prettyTool: el nombre largo del MCP se queda en «Confluence: get page»', () => {
  eq(prettyTool('atlassian-confluence-simplprogramme-eu_confluence_get_page'), 'Confluence: get page')
  eq(prettyTool('atlassian_jira_search'), 'Jira: search')
  eq(prettyTool('confluence_search'), 'Confluence: search')
  eq(prettyTool('jira_get_issue'), 'Jira: get issue')
  // Lo que no es del MCP de Atlassian se deja como está.
  eq(prettyTool('StructuredOutput'), 'StructuredOutput')
  // Sin nombre todavía (la parte acaba de llegar): el indicador genérico.
  eq(prettyTool(''), 'trabajando…')
  eq(prettyTool(null), 'trabajando…')
  eq(prettyTool(undefined), 'trabajando…')
})

test('formatBytes: KB por debajo de 1 MB y MB con un decimal a partir de ahí', () => {
  // La fila «almacenamiento» del Registro decía «8598 KB de 10 MB» y el espejo del
  // panel enseñaba «8,4 MB de 10 MB»: dos unidades para el mismo dato, y en KB
  // nadie ve de un vistazo si queda sitio (revisión adversaria de H3).
  eq(formatBytes(0), '0 KB')
  eq(formatBytes(1023), '1 KB')
  eq(formatBytes(512 * 1024), '512 KB')
  eq(formatBytes(1024 * 1024), '1,0 MB', 'coma decimal, como el resto de las medidas de Faro')
  eq(formatBytes(8.4 * 1024 * 1024), '8,4 MB')
  eq(formatBytes(10 * 1024 * 1024), '10,0 MB')
  // Una fila del Registro no puede tumbar la pantalla de estado: lo que no es un
  // número de bytes cuenta como cero.
  eq(formatBytes(NaN), '0 KB')
  eq(formatBytes(-1), '0 KB')
  eq(formatBytes(null), '0 KB')
  eq(formatBytes(undefined), '0 KB')
  eq(formatBytes('mucho'), '0 KB')
})
