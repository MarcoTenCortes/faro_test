/**
 * Las parejas de color que dibujan el panel y el overlay, declaradas UNA vez.
 *
 * Por qué existe: hasta H4 la lista vivía dos veces —en `panel-css.test.js`, que
 * la pina, y en `tools/contrast-report.mjs`, que la imprime— y las dos copias ya
 * se habían separado: el informe medía `--ink-2` sobre `--surface-2` y lo
 * llamaba «burbuja del usuario» cuando `.msg.user` pinta `--ink`, y esa pareja
 * no estaba en el test (revisión adversaria de H4, hallazgo 8). Dos listas que
 * dicen cosas distintas sobre el mismo CSS son peores que una: el informe puede
 * salir en verde midiendo algo que el test no exige, y al revés.
 *
 * Aquí sólo hay DATOS: nombres de token, qué dibuja cada pareja y en qué tema se
 * exige. Quien mide es `test/contrast.js`; quien decide el umbral, quien importa
 * esto. Sin DOM, sin `chrome` y sin dependencias, como el resto de test/.
 *
 * Cada fila del panel es `[frente, fondo, qué dibuja, tema?]`. El cuarto campo
 * es `'dark'` cuando la pareja sólo se exige en el tema oscuro: en claro el
 * relleno ámbar lleva texto encima y quien identifica el control es ese texto
 * (`--on-mark` sobre `--mark`, 9,11), no el ámbar contra el blanco (2,01).
 *
 * De las cadenas de respaldo que tenía el informe (`['--hairline-strong',
 * '--line-2']`) no queda ninguna: existían para medir lo mismo antes y después
 * del renombrado de H4, que ya está hecho. Si un token no existe, el informe y
 * el test fallan en voz alta en vez de imprimir un «—» que nadie mira.
 */

/**
 * Texto: 4,5:1 (WCAG 2.1 SC 1.4.3). Entra aquí todo color que LLEVE o RECIBA
 * letra, incluido el marcador de una lista ordenada, que es texto y no un
 * filete (hallazgo 1 de la revisión: estaba pintado con un token de borde).
 */
export const TEXTO = [
  ['--ink', '--surface', 'cuerpo del chat sobre una tarjeta'],
  ['--ink', '--ground', 'título de pantalla sobre el fondo'],
  ['--ink', '--surface-2', 'burbuja del usuario'],
  ['--ink-2', '--surface', 'prosa del asistente'],
  ['--ink-2', '--ground', 'párrafo de una pantalla'],
  ['--ink-2', '--surface-2', 'código en línea de la prosa y fila de sugerencia con el ratón'],
  ['--ink-2', '--gold-bg', 'texto dentro de un chip dorado'],
  ['--muted', '--surface', 'meta y cita de una observación'],
  ['--muted', '--surface-2', 'meta en una fila resaltada'],
  ['--muted', '--ground', 'marcador de lista y letra fina de una pantalla'],
  ['--muted', '--gold-bg', 'la × del chip y la cita de la fila activa, sobre el tinte dorado'],
  ['--muted', '--danger-bg', 'la hora y el detalle de una fila de error del registro'],
  ['--gold', '--surface', 'acento de texto: kicker, enlace'],
  ['--gold', '--ground', 'enlace del texto de una pantalla (.link-like)'],
  ['--gold', '--surface-2', '«Añadir la página N» en la fila de sugerencia resaltada'],
  ['--gold', '--gold-bg', 'icono encendido sobre su tinte'],
  ['--on-mark', '--mark', 'texto del botón primario, del .send y de la pastilla [n]'],
  ['--on-mark', '--mark-strong', 'el mismo, con el ratón encima'],
  ['--ok', '--surface', 'línea «ok» del registro'],
  ['--ok', '--ground', 'el «listo» del bloque del MCP (.waiting.done y su anillo)'],
  ['--danger', '--surface', 'aviso y error'],
  ['--danger', '--ground', 'el botón «Borrar» y un aviso en rojo sobre el fondo de una pantalla'],
  ['--danger', '--danger-bg', 'fila de error del registro'],
]

/**
 * Lo que dibuja un control: 3:1 (SC 1.4.11). `--hairline-strong` es el borde de
 * TODOS los campos y botones que sólo se distinguen por su borde, y vive sobre
 * tres fondos distintos: `--surface` (input, textarea, la tarjeta `.choice`),
 * `--ground` (el botón fantasma y el punto de estado apagado) y `--surface-2`
 * (los dos `<select>` del redactor y la pastilla apagada de una observación sin
 * pasaje). El de `--surface-2` es el más apretado de los tres y nadie lo medía
 * (hallazgo 6 de la revisión): en claro se quedaba en 2,88.
 */
export const CONTROL = [
  ['--hairline-strong', '--surface', 'borde de input y textarea, y punto de estado'],
  ['--hairline-strong', '--ground', 'borde del botón fantasma'],
  ['--hairline-strong', '--surface-2', 'borde de las pastillas-select del redactor'],
  ['--mark', '--surface', 'relleno de la pastilla [n] y del faro', 'dark'],
]

/**
 * Exenciones razonadas: bordes que NO llegan a 3:1 y no tienen por qué, porque
 * ninguno es lo único que identifica su control. Se miden igualmente y se
 * imprimen con su número, para que la exención sea una medida y no una promesa:
 * si alguna sube de 3, deja de ser un filete y se muda a CONTROL.
 *
 *  - `--hairline` separa filas y enmarca tarjetas que no son controles.
 *  - `--gold-line` enmarca el chip de lo señalado y el de páginas base
 *    (`.pick-chip`/`.sources-chip`): son botones con TEXTO, y quien los
 *    identifica es ese texto `--ink-2` sobre `--gold-bg` (8,87 en claro).
 *  - el mismo `--gold-line` es el borde de `.icon-btn.on`, `.icon-btn.picking`
 *    y `.pill.on` cuando se encienden: el estado lo llevan el icono `--gold`
 *    sobre `--gold-bg` (6,45) y el propio relleno, no el borde, y SC 1.4.11 no
 *    exige borde cuando el control se identifica sin él.
 */
export const EXENTOS = [
  ['--hairline', '--surface', 'filete entre filas y marco de tarjetas: decorativo'],
  ['--gold-line', '--surface', 'borde del chip de selección y del de páginas base, contra el fondo del redactor'],
  ['--gold-line', '--gold-bg', 'el mismo borde contra su relleno, y el borde encendido de .icon-btn.on y .pill.on'],
]

/**
 * El overlay, leído de sus PROPIAS reglas y no de una lista de colores: de cada
 * regla se saca el `color` y el `background` que tiene escritos, porque es justo
 * ahí donde estaba el fallo (un `color: #FFF7E8` sobre el ámbar profundo, 2,76).
 * Cada fila es `[regla, qué dibuja]` y todas son texto.
 */
export const OVERLAY_REGLAS = [
  ['.btn-primary', 'botón del cartel, en reposo'],
  ['.btn-primary:hover', 'botón del cartel, con el ratón encima'],
  ['.note-badge', 'insignia [n] sobre la página'],
  ['.note-badge:hover', 'insignia con el ratón encima'],
  ['.note-badge.active', 'insignia de la observación que se está mirando'],
]

/** Y los dos textos del cartel, que sí salen de tokens y siguen al tema de la PÁGINA. */
export const OVERLAY_TOKENS = [
  ['--faro-ink', '--faro-paper', 'texto del cartel'],
  ['--faro-muted', '--faro-paper', 'texto secundario del cartel'],
]

/** Los umbrales de WCAG 2.1, para que el test y el informe no puedan discrepar. */
export const UMBRAL = { texto: 4.5, control: 3 }
