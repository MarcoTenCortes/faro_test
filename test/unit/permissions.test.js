/**
 * Los permisos con los que Faro abre sus sesiones de opencode, evaluados como
 * los evalúa opencode 1.2.25 (src/shared/permissions.js).
 *
 * Reproducido en la auditoría del 2026-09-13 (docs/PLAN.md §2, S1): la lista
 * de antes denegaba diez ids a mano y no incluía `websearch`, `codesearch` ni
 * `skill`, que opencode registra y permite por defecto (`GET
 * /experimental/tool/ids` los devuelve; el agente `build` lleva `*: allow`):
 * una página podía pedirle al modelo que mandara su texto a exa.ai o cargar un
 * SKILL.md del disco como instrucciones. Además `patch` y `list` no son ids de
 * herramienta (la herramienta es `apply_patch`, que pide el permiso `edit`).
 * Ahora la primera regla deniega todo y sólo se permite el MCP de Atlassian:
 * lo que nazca en una versión nueva nace denegado.
 *
 * `permissionFor` reproduce `PermissionNext.evaluate` del binario (manda la
 * ÚLTIMA regla que casa; sin ninguna, «ask»; el patrón se casa contra el
 * ARGUMENTO de la herramienta y una herramienta MCP pide con `patterns:
 * ['*']`), así que estas pruebas dicen lo que haría opencode de verdad, sin
 * servidor. La prueba de integración compara con los ids reales.
 */
import { test, eq, assert } from '../harness.js'
import { SAFE_PERMISSIONS, MCP_TOOL_PATTERNS, permissionFor, wildcardMatch } from '../../src/shared/permissions.js'

/** `GET /experimental/tool/ids` de opencode 1.2.25 (sonda del 2026-09-14, puerto 4177). */
const TOOL_IDS_1_2_25 = [
  'invalid',
  'question',
  'bash',
  'read',
  'glob',
  'grep',
  'edit',
  'write',
  'task',
  'webfetch',
  'todowrite',
  'websearch',
  'codesearch',
  'skill',
  'apply_patch',
]

/** Los ids de permiso que piden las herramientas propias (`permission: "…"` en el binario). */
const PERMISOS_PROPIOS = [
  'bash',
  'read',
  'edit',
  'glob',
  'grep',
  'task',
  'webfetch',
  'websearch',
  'codesearch',
  'skill',
  'lsp',
  'todowrite',
  'todoread',
  'question',
  'doom_loop',
  'external_directory',
  'plan_enter',
  'plan_exit',
]

test('SEGURIDAD: SAFE_PERMISSIONS deniega websearch, codesearch, skill y todo lo demás que no sea el MCP', () => {
  for (const p of ['websearch', 'codesearch', 'skill', 'webfetch', 'bash', 'read', 'edit', 'write', 'task', 'glob', 'grep', 'lsp', 'todowrite', 'apply_patch']) {
    eq(permissionFor(SAFE_PERMISSIONS, p), 'deny', 'se deniega ' + p)
  }
  for (const p of PERMISOS_PROPIOS) eq(permissionFor(SAFE_PERMISSIONS, p), 'deny', 'permiso propio ' + p)
  for (const id of TOOL_IDS_1_2_25) eq(permissionFor(SAFE_PERMISSIONS, id), 'deny', 'id de 1.2.25 ' + id)
  // Lo que nazca en una versión nueva nace denegado: no hay que enterarse.
  eq(permissionFor(SAFE_PERMISSIONS, 'herramienta_nueva'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'exa_search'), 'deny')
  // El patrón se casa contra el argumento: da igual cuál sea.
  eq(permissionFor(SAFE_PERMISSIONS, 'bash', 'echo hola'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'webfetch', 'https://exa.ai/?q=texto-de-la-incidencia'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'read', 'C:/Users/marco/.ssh/id_rsa'), 'deny')
})

test('las herramientas del MCP de Atlassian se permiten, sea cual sea el nombre del MCP (y sin mayúsculas)', () => {
  for (const tool of [
    'atlassian_confluence_get_page',
    'mcp-atlassian_jira_search',
    'atlassian-jira-simplprogramme-eu_jira_search',
    'atlassian-confluence-simplprogramme-eu_confluence_get_page',
    'atlassian-acme-atlassian-net_confluence_search',
    'atlassian-acme-atlassian-net_jira_get_issue',
    'ATLASSIAN_JIRA_GET_ISSUE',
    'x_confluence_get_page_children',
  ]) {
    eq(permissionFor(SAFE_PERMISSIONS, tool), 'allow', 'se permite ' + tool)
  }
  // Una herramienta MCP pide con `patterns: ['*']`: el argumento es literalmente «*».
  eq(permissionFor(SAFE_PERMISSIONS, 'atlassian_jira_search', '*'), 'allow')
  // Sin el prefijo del MCP no es una herramienta MCP: opencode siempre lo pone («<mcp>_<herramienta>»).
  eq(permissionFor(SAFE_PERMISSIONS, 'jira_search'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'confluence_get_page'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'atlassian_jira'), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'atlassian_jiraweb_x'), 'deny')
  eq(MCP_TOOL_PATTERNS, ['*_confluence_*', '*_jira_*'])
})

test('SEGURIDAD: primero la regla que deniega todo, detrás sólo las que permiten el MCP: manda la última que casa', () => {
  eq(SAFE_PERMISSIONS[0], { permission: '*', pattern: '**', action: 'deny' })
  eq(SAFE_PERMISSIONS.length, 1 + MCP_TOOL_PATTERNS.length)
  for (const r of SAFE_PERMISSIONS.slice(1)) {
    eq(Object.keys(r).sort(), ['action', 'pattern', 'permission'])
    eq(r.action, 'allow')
    eq(r.pattern, '**')
    assert(MCP_TOOL_PATTERNS.includes(r.permission), 'sólo el MCP: ' + r.permission)
  }
  // Al revés, la que deniega todo casaría la última y no quedaría ni el MCP: el orden es parte de la regla.
  eq(permissionFor([...SAFE_PERMISSIONS].reverse(), 'atlassian_jira_search'), 'deny')
  // Ninguna entrada muerta: `patch` y `list` no son ids de herramienta en 1.2.25 (apply_patch pide `edit`).
  assert(!SAFE_PERMISSIONS.some((r) => ['patch', 'list'].includes(r.permission)), 'sin ids que no existen')
  assert(!SAFE_PERMISSIONS.some((r) => r.action === 'ask'), 'nada se pregunta: no hay nadie mirando')
})

test('permissionFor simula evaluate de opencode: la ÚLTIMA regla que casa, «ask» sin ninguna, el patrón contra el argumento', () => {
  eq(permissionFor([], 'bash'), 'ask')
  eq(permissionFor([{ permission: 'bash', pattern: '*', action: 'allow' }], 'read'), 'ask', 'otra herramienta: sin regla')
  const reglas = [
    { permission: 'bash', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: 'rm *', action: 'deny' },
  ]
  eq(permissionFor(reglas, 'bash', 'ls -la'), 'allow')
  eq(permissionFor(reglas, 'bash', 'rm -rf /'), 'deny')
  eq(permissionFor(reglas, 'bash', 'rm'), 'deny', '«rm *» también casa «rm» a secas (así lo hace opencode)')
  eq(permissionFor([...reglas].reverse(), 'bash', 'rm -rf /'), 'allow', 'la última manda')
  // El agente `build` de 1.2.25 lleva «question: deny» y después «question: allow»: gana la de detrás.
  const build = [
    { permission: '*', action: 'allow', pattern: '*' },
    { permission: 'question', action: 'deny', pattern: '*' },
    { permission: 'question', action: 'allow', pattern: '*' },
  ]
  eq(permissionFor(build, 'question'), 'allow')
  eq(permissionFor(build, 'bash', 'rm -rf /'), 'allow')
  // La sesión va DETRÁS del agente (merge(agent.permission, session.permission)): sus reglas mandan sobre él.
  eq(permissionFor([...build, ...SAFE_PERMISSIONS], 'bash', 'rm -rf /'), 'deny')
  eq(permissionFor([...build, ...SAFE_PERMISSIONS], 'question'), 'deny')
  eq(permissionFor([...build, ...SAFE_PERMISSIONS], 'atlassian_jira_search'), 'allow')
  // read con «*.env» → ask y después «*» → allow: la última.
  eq(permissionFor([{ permission: 'read', pattern: '*.env', action: 'ask' }, { permission: 'read', pattern: '*', action: 'allow' }], 'read', 'a/.env'), 'allow')
  eq(permissionFor([{ permission: 'read', pattern: '*', action: 'allow' }, { permission: 'read', pattern: '*.env', action: 'ask' }], 'read', 'a/.env'), 'ask')
})

test('wildcardMatch como Wildcard.match de opencode: «*» y «**» son lo mismo, «?» una letra, sin mayúsculas, anclado, «\\» como «/»', () => {
  assert(wildcardMatch('atlassian-x_jira_search', '*_jira_*'))
  assert(wildcardMatch('atlassian-x_jira_search', '**'))
  assert(wildcardMatch('', '*'))
  assert(wildcardMatch('', '**'))
  assert(wildcardMatch('a/b/c', 'a*'), '«*» cruza las barras')
  assert(wildcardMatch('a\nb', 'a*b'), 'y los saltos de línea')
  assert(wildcardMatch('ABC', 'abc'), 'sin mayúsculas')
  assert(wildcardMatch('ab', 'a?'))
  eq(wildcardMatch('abc', 'a?'), false)
  eq(wildcardMatch('abc', 'ab'), false, 'anclado por los dos lados')
  eq(wildcardMatch('xabc', 'abc'), false)
  assert(wildcardMatch('a.b', 'a.b'))
  eq(wildcardMatch('axb', 'a.b'), false, 'el punto es un punto')
  eq(wildcardMatch('a+b', 'a.b'), false)
  assert(wildcardMatch('C:\\Users\\marco\\x', 'C:/Users/*'), 'las barras invertidas se leen como barras')
  assert(wildcardMatch('C:/Users/marco/x', 'C:\\Users\\*'))
  // La rareza de opencode: «git *» casa «git» a secas (el espacio final es opcional).
  assert(wildcardMatch('git', 'git *'))
  assert(wildcardMatch('git status', 'git *'))
  eq(wildcardMatch('gitk', 'git *'), false)
})

test('SEGURIDAD: reglas o entradas malformadas no cuentan ni tumban la evaluación', () => {
  eq(permissionFor(null, 'bash'), 'ask')
  eq(permissionFor('deny', 'bash'), 'ask')
  eq(
    permissionFor(
      [null, 7, 'x', { permission: 'bash' }, { permission: 'bash', pattern: '*', action: 'nope' }, { permission: 5, pattern: '*', action: 'deny' }],
      'bash'
    ),
    'ask',
    'sin regla válida, «ask»'
  )
  eq(permissionFor([{ permission: 'bash', pattern: '*', action: 'deny' }, { permission: 'bash', pattern: '*', action: 'allow', extra: 1 }], 'bash'), 'allow', 'las claves de más no molestan')
  eq(permissionFor(SAFE_PERMISSIONS, null), 'deny', 'una herramienta sin nombre cae en la que deniega todo')
  eq(permissionFor(SAFE_PERMISSIONS, 42), 'deny')
  eq(permissionFor(SAFE_PERMISSIONS, 'atlassian_jira_search', null), 'allow', 'sin argumento, «*» como una herramienta MCP')
  eq(wildcardMatch(null, '*'), true)
  eq(wildcardMatch('x', null), false)
})
