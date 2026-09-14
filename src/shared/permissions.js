/**
 * Permisos con los que Faro abre TODAS sus sesiones de opencode, y la
 * simulación de cómo opencode los evalúa (para poder probarlos en Node).
 *
 * Sin esto, el agente por defecto de opencode trae herramientas de shell, de
 * ficheros y de red, y las usa: comprobado, ejecutaba `echo hola` y leía
 * package.json dentro de un turno normal de chat. Faro no necesita nada de eso
 * —sólo las herramientas MCP de Atlassian— y dejarlo abierto significaría que
 * un texto escondido en una página de Confluence podría acabar ejecutando
 * órdenes en la máquina del usuario, o mandando el texto de una incidencia a
 * un buscador de fuera.
 *
 * Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2, S1): la lista
 * de antes denegaba diez ids a mano (`bash`, `edit`, `write`, `read`, `patch`,
 * `glob`, `grep`, `list`, `webfetch`, `task`) y se quedó atrás: opencode 1.2.25
 * registra y permite por defecto `websearch` (consultas a exa.ai),
 * `codesearch` y `skill` (carga un SKILL.md del disco como instrucciones), y
 * `patch`/`list` ya no son ids de herramienta (la herramienta es
 * `apply_patch`, que pide el permiso `edit`). Por eso la política está
 * invertida: la primera regla deniega TODO y sólo se permite lo que casa con
 * las herramientas del MCP de Atlassian. Lo que nazca en una versión nueva
 * nace denegado; la prueba de integración compara con los ids reales.
 *
 * Comprobado en el binario de opencode 1.2.25 (el bundle JS embebido en
 * opencode.exe, `grep -a`; sonda contra el servidor en el puerto 4177 el
 * 2026-09-14), que es lo que esta simulación reproduce:
 *
 *  - `PermissionNext.evaluate(permission, pattern, ...rulesets)`:
 *    `merged = rulesets.flat()` y `merged.findLast(rule =>
 *    Wildcard.match(permission, rule.permission) && Wildcard.match(pattern,
 *    rule.pattern)) ?? { action: 'ask' }`. Manda la ÚLTIMA regla que casa;
 *    sin ninguna, se pregunta (y Faro rechaza toda pregunta: nadie mira).
 *  - En el turno de chat (`SessionPrompt.resolveTools`), cada herramienta
 *    pregunta con `ruleset: PermissionNext.merge(agent.permission,
 *    session.permission ?? [])` y `ask()` evalúa `(ruleset, approved)`: las
 *    reglas de la sesión van DETRÁS de las del agente (`build` lleva `*:
 *    allow`) y mandan sobre ellas; detrás de todo van las aprobaciones
 *    «always» guardadas del proyecto (`approved`), que Faro nunca crea.
 *  - `Wildcard.match(str, pattern)`: `*` → `.*`, `?` → `.`, el resto se
 *    escapa, anclado `^…$`, flags `si` (sin mayúsculas, el punto cruza saltos
 *    de línea) y toda `\` se lee como `/`. Así `**` y `*` son lo mismo; un
 *    patrón que acaba en « *» también casa sin el espacio ni lo de detrás.
 *  - `permission` es el id de permiso de la herramienta (`bash`, `read`,
 *    `edit` —también para write y apply_patch—, `glob`, `grep`, `task`,
 *    `webfetch`, `websearch`, `codesearch`, `skill`, `lsp`, `todowrite`,
 *    `todoread`, `question`, `doom_loop`, `external_directory`, `plan_enter`,
 *    `plan_exit`) y `pattern` es EL ARGUMENTO de la llamada (la orden de bash,
 *    la ruta, la URL, la consulta), no el nombre de la herramienta.
 *  - Una herramienta MCP (`MCP.tools`) se registra como
 *    `<cliente>_<herramienta>` con `[^a-zA-Z0-9_-]` → `_`, y pide
 *    `ctx.ask({ permission: <esa clave>, patterns: ['*'] })`: para
 *    `mcp-atlassian` en el MCP `atlassian-x`, `atlassian-x_confluence_get_page`
 *    y `atlassian-x_jira_search`. `StructuredOutput` e `invalid` no piden
 *    permiso.
 *  - `PermissionNext.disabled(tools, agent.permission)` sólo mira las reglas
 *    del AGENTE con `pattern === '*'`: las de la sesión no quitan herramientas
 *    de la lista que ve el modelo; se deniegan al llamarlas (`DeniedError`, y
 *    el bucle sigue). Por eso `**` en vez de `*` no cambia nada aquí.
 *  - `GET /experimental/tool/ids` (1.2.25): invalid, question, bash, read,
 *    glob, grep, edit, write, task, webfetch, todowrite, websearch, codesearch,
 *    skill, apply_patch. `POST /session` acepta la lista y `GET /session/:id`
 *    la devuelve tal cual, en el mismo orden.
 *
 * Puro: sin DOM ni chrome. config.js lo reexporta para que nadie cambie sus
 * imports.
 */

const ACTIONS = new Set(['allow', 'deny', 'ask'])

/**
 * Las herramientas del MCP de Atlassian, sea cual sea el nombre del MCP:
 * opencode antepone siempre `<cliente>_` al nombre de la herramienta, y las de
 * `mcp-atlassian` empiezan por `confluence_` o `jira_` (es lo que `prettyTool`
 * y `consultedOutside` leen). Sin ese prefijo (`jira_search` a secas) no es
 * una herramienta MCP y queda denegada.
 */
export const MCP_TOOL_PATTERNS = ['*_confluence_*', '*_jira_*']

/**
 * Primero la regla que deniega todo, después sólo las que permiten el MCP:
 * como manda la ÚLTIMA regla que casa, el orden es parte de la regla (al revés
 * no quedaría ni el MCP; `permissions.test.js` lo pina). Ninguna «ask»: no hay
 * nadie mirando el panel para contestar.
 */
export const SAFE_PERMISSIONS = [
  { permission: '*', pattern: '**', action: 'deny' },
  ...MCP_TOOL_PATTERNS.map((permission) => ({ permission, pattern: '**', action: 'allow' })),
]

/**
 * `Wildcard.match` de opencode 1.2.25, tal cual (ver la cabecera). Pura.
 * @param {string} str lo que se casa (un id de permiso, o el argumento de una llamada)
 * @param {string} pattern el patrón de una regla
 */
export function wildcardMatch(str, pattern) {
  const s = typeof str === 'string' ? str.replaceAll('\\', '/') : ''
  if (typeof pattern !== 'string') return false
  const p = pattern.replaceAll('\\', '/')
  let escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?'
  return new RegExp('^' + escaped + '$', 'si').test(s)
}

/**
 * Qué haría opencode con una llamada: `PermissionNext.evaluate` sobre `rules`
 * (ya en el orden en que opencode las junta). Pura.
 *
 * @param {Array<{permission:string, pattern:string, action:string}>} rules
 * @param {string} tool id de permiso (el nombre de la herramienta; para una MCP, `<mcp>_<herramienta>`)
 * @param {string} [argument] lo que la herramienta pasa como patrón: la orden, la ruta, la URL… (`*` para una MCP)
 * @returns {'allow'|'deny'|'ask'}
 */
export function permissionFor(rules, tool, argument = '*') {
  const permission = typeof tool === 'string' ? tool : ''
  const pattern = typeof argument === 'string' ? argument : '*'
  let action = 'ask'
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || typeof rule !== 'object') continue
    if (typeof rule.permission !== 'string' || typeof rule.pattern !== 'string' || !ACTIONS.has(rule.action)) continue
    if (wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern)) action = rule.action
  }
  return action
}
