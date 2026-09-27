/**
 * Estilos del overlay, como cadena, porque viven dentro de un Shadow DOM
 * cerrado: ni el CSS de Atlassian entra ni el nuestro sale.
 *
 * Decisiones de fondo:
 *  - El foco es un div con `box-shadow` de propagación enorme. Oscurece todo
 *    menos su propio hueco, tiene esquinas redondeadas gratis, y anima con
 *    transiciones normales (una máscara SVG animada es más frágil).
 *  - Nada gira ni rebota. Los movimientos rondan medio segundo, con la misma
 *    curva: lo bastante lentos para poder seguirlos con la vista, que es de lo
 *    que va guiar a alguien.
 *  - Con `prefers-reduced-motion` quedan sólo fundidos.
 *  - Dos colores con dos papeles, desde H23 (docs/PLAN2.md §3.6): el ÁMBAR es
 *    la marca de Faro —el foco, el cartel, sus botones y las insignias [n]—, y
 *    la TINTA es el color de lo que Faro te señala en la página —el trazo de
 *    una marca, su relleno, el foco sin escudo, el filete de una imagen—, azul
 *    por defecto y ámbar a elegir. La herramienta de «Señalar» es siempre azul.
 */

import { cursorRule } from './cursor.js'

export const OVERLAY_CSS = `
:host {
  --faro-gold: #E9AC4A;
  --faro-gold-deep: #C98A22;
  --faro-ink: #17161D;
  --faro-paper: #FFFFFF;
  --faro-muted: #6B6879;
  --faro-line: #E4E2EC;
  --faro-scrim: rgba(19, 18, 24, .58);
  --faro-glow: rgba(233, 172, 74, .34);
  --faro-shadow: 0 12px 32px -10px rgba(19, 18, 24, .45), 0 2px 6px rgba(19, 18, 24, .18);
  --faro-ease: cubic-bezier(.32, .72, 0, 1);
  --faro-tinta: #2563EB;
  --faro-tinta-fuerte: #1D4ED8;
  --faro-tinta-velo: rgba(59, 130, 246, .16);
  --faro-tinta-velo-fuerte: rgba(59, 130, 246, .28);

  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483600;
  pointer-events: none;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  contain: layout style;
}

:host(.faro-dark) {
  --faro-ink: #EDECF2;
  --faro-paper: #22212B;
  --faro-muted: #9A97A8;
  --faro-line: #35323F;
  --faro-scrim: rgba(8, 8, 11, .66);
  --faro-shadow: 0 12px 32px -10px rgba(0, 0, 0, .7), 0 2px 6px rgba(0, 0, 0, .4);
  --faro-tinta: #60A5FA;
  --faro-tinta-fuerte: #93C5FD;
}

/* La tinta a elegir (el ajuste «Color del subrayado»): el ámbar de antes de H23.
   El trazo claro sobre blanco se queda en 2,94 y el de la activa en 5,92; en
   oscuro, 8,07 y 10,23 (lo imprime «npm run contrast»). El relleno, el que lleva la
   letra encima, vive en highlightCss() y se exige en panel-css.test.js. */
:host(.faro-tinta-ambar) {
  --faro-tinta: #C98A22;
  --faro-tinta-fuerte: #8A5A0A;
  --faro-tinta-velo: rgba(233, 172, 74, .16);
  --faro-tinta-velo-fuerte: rgba(233, 172, 74, .28);
}
:host(.faro-tinta-ambar.faro-dark) {
  --faro-tinta: #E9AC4A;
  --faro-tinta-fuerte: #F3C77A;
}

* { box-sizing: border-box; }

/* ---------------------------------------------------------------- el foco */

.spot {
  position: fixed;
  border-radius: 10px;
  opacity: 0;
  pointer-events: none;
  box-shadow:
    0 0 0 100vmax var(--faro-scrim),
    0 0 0 1.5px var(--faro-gold),
    0 0 0 6px var(--faro-glow);
  transition:
    top .52s var(--faro-ease),
    left .52s var(--faro-ease),
    width .52s var(--faro-ease),
    height .52s var(--faro-ease),
    opacity .34s ease;
}
.spot.on { opacity: 1; }

/* El anillo se dibuja en vez de aparecer: la mirada sigue el trazo. */
.ring {
  position: fixed;
  pointer-events: none;
  overflow: visible;
  opacity: 0;
  transition:
    top .52s var(--faro-ease),
    left .52s var(--faro-ease),
    width .52s var(--faro-ease),
    height .52s var(--faro-ease),
    opacity .3s ease;
}
.ring.on { opacity: 1; }
.ring rect {
  fill: none;
  stroke: var(--faro-gold);
  stroke-width: 2;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
}
.ring.draw rect { animation: faro-draw .72s var(--faro-ease) forwards; }
@keyframes faro-draw { to { stroke-dashoffset: 0; } }

/* Respiración muy leve mientras el paso está activo. */
.spot.breathe { animation: faro-breathe 2.6s ease-in-out .5s infinite; }
@keyframes faro-breathe {
  0%, 100% { box-shadow: 0 0 0 100vmax var(--faro-scrim), 0 0 0 1.5px var(--faro-gold), 0 0 0 6px var(--faro-glow); }
  50%      { box-shadow: 0 0 0 100vmax var(--faro-scrim), 0 0 0 1.5px var(--faro-gold), 0 0 0 11px rgba(233, 172, 74, .12); }
}

/* ------------------------------------------------------------ el cartel */

.card {
  position: fixed;
  max-width: 330px;
  min-width: 250px;
  background: var(--faro-paper);
  color: var(--faro-ink);
  border: 1px solid var(--faro-line);
  border-radius: 12px;
  padding: 14px 16px 12px;
  box-shadow: var(--faro-shadow);
  pointer-events: auto;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity .34s ease, transform .34s var(--faro-ease), top .52s var(--faro-ease), left .52s var(--faro-ease);
}
.card.on { opacity: 1; transform: translateY(0); }

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.beacon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--faro-gold);
  flex: none;
  position: relative;
}
.beacon::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--faro-gold);
}
.card-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .11em;
  text-transform: uppercase;
  color: var(--faro-muted);
  flex: 1;
}
.card-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--faro-muted);
  flex: none;
}

.card-title {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  margin: 0 0 4px;
  color: var(--faro-ink);
}
.card-text {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  color: var(--faro-muted);
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}
button {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 7px;
  padding: 6px 11px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background .16s ease, border-color .16s ease, color .16s ease;
}
button:focus-visible { outline: 2px solid var(--faro-gold); outline-offset: 2px; }
.btn-primary {
  background: var(--faro-gold);
  color: #1B1405;
  border-color: var(--faro-gold-deep);
}
/* El texto se queda oscuro al pasar el ratón: el crema de antes (#FFF7E8) daba
   2,76:1 sobre el ámbar profundo, por debajo del 4,5 de AA. Medido en la
   auditoría del 2026-09-13 (docs/PLAN.md §2, A8); con #1B1405 da 6,22:1, y es
   el mismo texto que ya lleva el botón en reposo. */
.btn-primary:hover { background: var(--faro-gold-deep); color: #1B1405; }
.btn-ghost {
  background: transparent;
  color: var(--faro-muted);
  border-color: var(--faro-line);
}
.btn-ghost:hover { color: var(--faro-ink); border-color: var(--faro-muted); }
.spacer { flex: 1; }

/* Barra de progreso del paso: comunica que hay una pausa, no un cuelgue. */
.progress {
  height: 2px;
  background: var(--faro-line);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 10px;
}
.progress i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--faro-gold);
  border-radius: 2px;
}
.progress.run i { animation: faro-progress var(--faro-step-ms, 900ms) linear forwards; }
@keyframes faro-progress { to { width: 100%; } }

/* --------------------------------------------------- resaltado de texto */

/* Forma A (H23, docs/PLAN2.md §3.6). Pasó de verdad: el relleno amarillo iba en
   este rectángulo, ENCIMA de la letra, y se sumaba al ::highlight de debajo; en
   el tema oscuro el texto marcado bajaba de 8,95:1 a 3,63:1 (anexo 2-F). Ahora
   el relleno vive sólo en ::highlight(faro-quote), que se pinta DEBAJO del
   texto (highlightCss, en el documento), y aquí queda el trazo: una pastilla de
   2 px pegada al borde inferior de la caja de la línea, que ya incluye el
   espacio de los descendentes. Medido en el banco (revisión adversaria de H23,
   A3): el trazo normal (2 px) pisa las puntas de los descendentes, 0,5-1,3 de
   3 px en Segoe 14 y 2 de 4 en 16; el de la activa (3 px), 1,5-2,3 de 3 y 3 de
   4 —lo mismo que el normal de antes de la revisión—; nunca sube a la letra.
   El rectángulo es transparente. */
.quote-layer { position: fixed; inset: 0; pointer-events: none; }
.quote-rect {
  position: fixed;
  background: transparent;
  opacity: 0;
  /* El trazo vive DENTRO de la caja: recortado a ella, sobre un bloque de
     código con scroll propio no se sale del bloque (antes era el barrido el que
     se pintaba fuera, empezando en translateX(-110%): barras blancas
     escalonadas por la izquierda). El tramo 26 del banco lo pina. */
  overflow: hidden;
  transition: opacity .4s ease;
}
.quote-rect.on { opacity: 1; }

/* El trazo existe SIEMPRE (el barrido de antes sólo existía mientras barría, y
   con content:none se iba). Lo que va y viene es la animación: la clase
   «sweep» la pone barrer() y la quita al acabar. */
.quote-rect::after {
  content: "";
  position: absolute;
  left: 0; right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--faro-tinta);
  transform-origin: left center;
}
/* La observación que estás mirando ahora mismo: un trazo más grueso y de más
   contraste: en claro más oscuro, en oscuro más CLARO (con #3B82F6 bajaba a
   4,40 sobre la página y 2,49 sobre su propio relleno). */
.quote-rect.active::after { height: 3px; background: var(--faro-tinta-fuerte); }

/* Se dibuja de izquierda a derecha, una sola vez: el barrido blanco de antes
   era un fogonazo sobre cualquier fondo oscuro. El escalonado de cada caja lo
   escribe barrer() en --faro-retardo; con both, durante el retardo rige el
   from (scaleX(0)) y el trazo no se ve entero antes de dibujarse. */
.quote-rect.sweep::after { animation: faro-tinta .45s var(--faro-ease) both; animation-delay: var(--faro-retardo, 0ms); }
@keyframes faro-tinta { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* Sobre un bloque de código el fondo es oscuro y el texto va de colores: en
   código, sólo el trazo, como siempre (el relleno del ::highlight tampoco
   tapa la sintaxis: va debajo). */
.quote-rect.on-code { background: transparent; }

/* ------------------------------------------------- el foco sin escudo

   El mismo foco, pero sin oscurecer la página: un velo de la tinta, filete de
   1 px y línea inferior, como un rotulador. Sigue la TINTA y no el ámbar desde
   H23: es una marca de resultado («esto es lo que buscabas»), no la marca de
   Faro, y así dice lo mismo que el subrayado de una cita.

   Se usa en dos sitios, y por eso está escrito una sola vez:
     - Al LLEGAR a un destino. El oscurecido sirve para guiarte por el árbol,
       donde hay que no perder de vista el siguiente clic; una vez has llegado
       sólo tapa lo que has venido a leer. El foco guía, el subrayado señala.
     - Todo el rato en el modo «Subrayado» de los ajustes. */

.spot.flat,
:host(.faro-marker) .spot {
  border-radius: 4px;
  background: var(--faro-tinta-velo);
  box-shadow:
    0 0 0 1px var(--faro-tinta),
    inset 0 -2px 0 var(--faro-tinta);
}
@keyframes faro-marker-breathe {
  0%, 100% { background: var(--faro-tinta-velo); }
  50%      { background: var(--faro-tinta-velo-fuerte); }
}
.spot.flat.breathe,
:host(.faro-marker) .spot.breathe { animation: faro-marker-breathe 2.6s ease-in-out .4s infinite; }

/* El anillo que se dibuja es la animación del recorrido, no de la llegada. */
.ring.flat,
:host(.faro-marker) .ring { display: none; }

/* ------------------------------------------- observaciones numeradas

   Lo que deja el modo Análisis: cada punto sobre el que tiene algo que decir
   queda subrayado, y detrás del último carácter va su número, como una nota al
   pie. Al final de la cita y no en el margen, a propósito: en un panel estrecho
   o con la barra lateral abierta el margen no existe.

   Desde H23 van en SUPERÍNDICE: centradas en la línea tapaban las dos o tres
   primeras letras de la palabra siguiente (anexo 2-F). Miden 13 px, llevan un
   anillo de 2 px del color del papel que las despega del texto, y overlay.js
   las sube 5 px sobre la línea, así que acaban en «top + 8». Medido en el
   banco con Segoe UI 14 px (revisión adversaria de H23, A2): con 16 px y
   subidas 8, lo de antes, tapaban 6-10 px de la caja del carácter de la línea
   de ARRIBA; así el anillo se queda entre 0,88 px por debajo y 0,08 por encima
   de la línea base de arriba, en sus descendentes, y los cuerpos de las letras
   sólo se pisan con un interlineado apretado (2 px con 14/20, 3 con «normal»,
   nada con 16/24). La cifra en negrita a 9,5 px se dibuja con las mismas siete
   filas que a 10. Siguen en ámbar: son la marca de Faro, la misma pastilla [n]
   que el chat. */

.note-layer { position: fixed; inset: 0; pointer-events: none; }

.note-badge {
  position: fixed;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border: 1px solid var(--faro-gold-deep);
  border-radius: 7px;
  background: var(--faro-gold);
  color: #1B1405;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 11px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--faro-paper), 0 1px 3px rgba(19, 18, 24, .35);
  pointer-events: auto;
  cursor: pointer;
  opacity: 0;
  transform: scale(.6);
  transition: opacity .3s ease, transform .3s var(--faro-ease), box-shadow .16s ease, background .16s ease;
}
/* Entra creciendo, sin rebote: la curva del fichero no pasa de 1. */
.note-badge.on { opacity: 1; transform: scale(1); }
/* Igual que el botón del cartel: sobre el ámbar profundo el texto sigue siendo
   #1B1405 (6,22:1). Con el crema de antes la insignia que estabas mirando era
   justo la menos legible de la página (2,76:1). */
.note-badge:hover { background: var(--faro-gold-deep); color: #1B1405; }
.note-badge.active {
  background: var(--faro-gold-deep);
  color: #1B1405;
  box-shadow: 0 0 0 2px var(--faro-paper), 0 0 0 4px rgba(233, 172, 74, .38);
}

/* ------------------------------------------------- recuadro de imágenes */

.outline-layer { position: fixed; inset: 0; pointer-events: none; }
.img-outline {
  position: fixed;
  border: 1px solid var(--faro-tinta);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .3s ease;
}
.img-outline.on { opacity: 1; }

/* ------------------------------------------------- modo de selección

   La herramienta de «Señalar» es siempre azul, elija el usuario la tinta que
   elija (H23): el cursor subrayador, la selección, el recuadro al pasar por
   una imagen y el faro de la barra. Es la herramienta, no el resultado; y
   «Usar esto» sigue en ámbar, porque es la acción de Faro. */

.pick-hover {
  position: fixed;
  border: 1px solid #3B82F6;
  border-radius: 2px;
  background: rgba(59, 130, 246, .10);
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s ease;
}
.pick-hover.on { opacity: 1; }

.pick-bar {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translate(-50%, 10px);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  max-width: min(560px, 92vw);
  background: var(--faro-paper);
  color: var(--faro-ink);
  border: 1px solid var(--faro-line);
  border-radius: 11px;
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: var(--faro-shadow);
  opacity: 0;
  pointer-events: auto;
  transition: opacity .2s ease, transform .2s var(--faro-ease);
}
.pick-bar.on { opacity: 1; transform: translate(-50%, 0); }
/* Pasó de verdad: a 364 px el texto elegido medía 0 px y «Cancelar» se salía
   de la barra (anexo 2-F), porque la pista no cedía nada (flex: none). Ahora
   cede ella antes que el texto, por debajo de 480 px se oculta, y la barra
   envuelve en vez de salirse. */
.pick-text { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-hint {
  color: var(--faro-muted);
  font-size: 11.5px;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 480px) {
  .pick-hint { display: none; }
  .pick-bar { max-width: 96vw; }
}
/* El faro de la barra, en el azul de la herramienta; el del cartel no cambia. */
.pick-bar .beacon { border-color: #3B82F6; }
.pick-bar .beacon::after { background: #3B82F6; }
:host(.faro-dark) .pick-bar .beacon { border-color: #60A5FA; }
:host(.faro-dark) .pick-bar .beacon::after { background: #60A5FA; }

/* ------------------------------------------------------------- avisos */

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translate(-50%, 10px);
  background: var(--faro-paper);
  color: var(--faro-ink);
  border: 1px solid var(--faro-line);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.45;
  max-width: 420px;
  box-shadow: var(--faro-shadow);
  opacity: 0;
  pointer-events: auto;
  transition: opacity .22s ease, transform .22s var(--faro-ease);
}
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.toast b { color: var(--faro-gold-deep); font-weight: 650; }
:host(.faro-dark) .toast b { color: var(--faro-gold); }

@media (prefers-reduced-motion: reduce) {
  .spot, .ring, .card { transition: opacity .16s ease; }
  .spot.breathe { animation: none; }
  .note-badge { transition: opacity .16s ease; }
  .ring.draw rect { animation: none; stroke-dashoffset: 0; }
  /* El trazo se queda (con content:none desaparecería): sólo deja de dibujarse. */
  .quote-rect.sweep::after { animation: none; }
  .progress.run i { animation: none; width: 100%; }
}
:host(.faro-still) .spot,
:host(.faro-still) .ring,
:host(.faro-still) .card { transition: opacity .16s ease; }
:host(.faro-still) .spot.breathe { animation: none; }
:host(.faro-still) .note-badge { transition: opacity .16s ease; }
:host(.faro-still) .ring.draw rect { animation: none; stroke-dashoffset: 0; }
:host(.faro-still) .quote-rect.sweep::after { animation: none; }

/* Alto contraste de Windows: los colores de Faro se sustituyen por los del
   sistema, y un trazo de 2 px de «Highlight» solo se perdería. La caja entera
   se rodea, y la insignia conserva los suyos porque su texto ya se lee. */
@media (forced-colors: active) {
  .quote-rect { outline: 2px solid Highlight; outline-offset: 1px; }
  .quote-rect::after { background: Highlight; }
  .note-badge { forced-color-adjust: none; }
}
`

/**
 * El relleno de las marcas, por tinta: el de todas y el de la que estás mirando.
 *
 * Va en el documento, no en el shadow root: `::highlight()` sólo se puede
 * estilar desde una hoja del documento, y por eso tampoco ve las variables del
 * host: el color va en literal, uno por tinta (docs/PLAN2.md §3.6). Es la única
 * inserción que hacemos fuera del shadow, y va en <head>, nunca dentro del
 * contenido.
 *
 * Se pinta DEBAJO del texto, que es lo que lo hace legible: el relleno del
 * rectángulo de antes iba encima y en oscuro dejaba la letra a 3,63:1. Cada
 * relleno está elegido para que el texto de una página de Atlassian quede por
 * encima de 4,5:1 en los DOS temas (texto claro 10,14 · oscuro 6,13 la normal
 * en azul; la tabla entera la imprime `npm run contrast`, y la exige
 * `panel-css.test.js` leyendo ESTOS literales). Un enlace de Atlassian bajo la
 * tinta se queda por debajo (3,74 / 4,05 en azul) y se anota, no se exige.
 *
 * La observación activa va en SU highlight, `faro-quote-activa`, con prioridad
 * 1, y fuera del de las demás: dos rellenos traslúcidos sobre la misma letra se
 * suman, y en oscuro la activa apilada sobre la normal bajaba a 3,88:1 (azul)
 * y 3,31:1 (ámbar). Ninguna letra pinta dos rellenos: overlay.js resta el texto
 * de la activa de los Range de las demás (`fuera`), aunque sean otros Range.
 */
const RELLENO = Object.freeze({
  azul: Object.freeze(['rgba(59, 130, 246, .28)', 'rgba(59, 130, 246, .40)']),
  ambar: Object.freeze(['rgba(233, 172, 74, .28)', 'rgba(201, 138, 34, .34)']),
})

/**
 * La hoja de `#faro-highlight-style` para una tinta.
 * @param {'azul'|'ambar'} tinta lo que no sea 'ambar' cuenta como azul
 */
export function highlightCss(tinta) {
  const [normal, activa] = tinta === 'ambar' ? RELLENO.ambar : RELLENO.azul
  return `
::highlight(faro-quote) { background-color: ${normal}; color: inherit; }
::highlight(faro-quote-activa) { background-color: ${activa}; color: inherit; }
`
}

/**
 * Cursor y selección del modo de «Señalar».
 *
 * Va en el documento porque el cursor de la página no se puede cambiar desde un
 * shadow root. Se cuelga de una clase en <html> para poder quitarlo entero, y
 * no toca ni un nodo del contenido. La clase oscura la pone `setPicking`
 * cuando el overlay está en tema oscuro.
 *
 * El cursor es el subrayador azul de cursor.js, con `text` de respaldo: lo que
 * se hace es seleccionar texto, y `crosshair` decía «apunta a un píxel». Las
 * imágenes conservan `copy` —también en oscuro: por eso sus selectores repiten
 * la clase oscura, o la regla del subrayador oscuro, más específica, les
 * ganaría— y dentro del overlay, el de siempre.
 *
 * La selección azul vive SÓLO bajo `html.faro-picking`: fuera de «Señalar» la
 * selección de la página no es cosa de Faro.
 */
export const PICK_CSS = `
html.faro-picking, html.faro-picking * { cursor: ${cursorRule('claro')} !important; }
html.faro-picking.faro-picking-dark, html.faro-picking.faro-picking-dark * { cursor: ${cursorRule('oscuro')} !important; }
html.faro-picking img, html.faro-picking svg, html.faro-picking figure, html.faro-picking figure *,
html.faro-picking.faro-picking-dark img, html.faro-picking.faro-picking-dark svg,
html.faro-picking.faro-picking-dark figure, html.faro-picking.faro-picking-dark figure * { cursor: copy !important; }
html.faro-picking #faro-overlay-host, html.faro-picking #faro-overlay-host * { cursor: default !important; }
html.faro-picking ::selection { background-color: rgba(59, 130, 246, .32); color: inherit; text-decoration: underline 2px #2563EB; text-underline-offset: 3px; }
`
