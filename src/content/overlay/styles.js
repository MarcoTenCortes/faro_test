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
 */

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
.btn-primary:hover { background: var(--faro-gold-deep); color: #FFF7E8; }
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

.quote-layer { position: fixed; inset: 0; pointer-events: none; }
.quote-rect {
  position: fixed;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(233,172,74,.10), rgba(233,172,74,.22));
  box-shadow: inset 0 -2px 0 var(--faro-gold);
  opacity: 0;
  /* El barrido vive DENTRO. Sin esto se pintaba fuera de su caja —empieza en
     translateX(-110%)— y sobre un bloque de código, con una marca por línea y
     de anchuras distintas, salían barras blancas escalonadas por la izquierda,
     fuera del bloque. */
  overflow: hidden;
  transition: opacity .4s ease;
}
.quote-rect.on { opacity: 1; }

/* Un barrido corto de izquierda a derecha, una sola vez.

   El pseudo sólo EXISTE mientras barre. Antes existía siempre, aparcado en
   translateX(-110%) —o en +110% al terminar, que forwards retiene—, y como
   cada repintado por scroll vuelve a crear los rectángulos sin la clase, la
   banda blanca se quedaba fija. Con content:none no hay nada que aparcar, y
   de paso no se compone una capa por cada marca de la página. */
.quote-rect::after { content: none; }

.quote-rect.sweep::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.55) 50%, transparent 80%);
  transform: translateX(-110%);
  animation: faro-sweep 1.1s var(--faro-ease) forwards;
}
@keyframes faro-sweep { to { transform: translateX(110%); } }

/* Sobre un bloque de código el fondo es oscuro y el texto va de colores: ahí un
   blanco al 55% es un fogonazo, y el relleno amarillo encima de la sintaxis la
   vuelve ilegible. La marca se queda en lo que de verdad hace falta, el trazo
   inferior del rotulador. */
.quote-rect.on-code {
  background: rgba(233, 172, 74, .13);
  box-shadow: inset 0 -2px 0 var(--faro-gold);
}
.quote-rect.on-code.sweep::after {
  background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.22) 50%, transparent 80%);
}

/* ------------------------------------------------- el foco sin escudo

   El mismo foco, pero sin oscurecer la página: fondo amarillo translúcido,
   filete de 1 px y línea inferior, como un rotulador.

   Se usa en dos sitios, y por eso está escrito una sola vez:
     - Al LLEGAR a un destino. El oscurecido sirve para guiarte por el árbol,
       donde hay que no perder de vista el siguiente clic; una vez has llegado
       sólo tapa lo que has venido a leer. El foco guía, el subrayado señala.
     - Todo el rato en el modo «Subrayado» de los ajustes. */

.spot.flat,
:host(.faro-marker) .spot {
  border-radius: 4px;
  background: rgba(233, 172, 74, .16);
  box-shadow:
    0 0 0 1px var(--faro-gold),
    inset 0 -2px 0 var(--faro-gold);
}
@keyframes faro-marker-breathe {
  0%, 100% { background: rgba(233, 172, 74, .16); }
  50%      { background: rgba(233, 172, 74, .28); }
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
   o con la barra lateral abierta el margen no existe. */

.note-layer { position: fixed; inset: 0; pointer-events: none; }

.note-badge {
  position: fixed;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid var(--faro-gold-deep);
  border-radius: 9px;
  background: var(--faro-gold);
  color: #1B1405;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 3px rgba(19, 18, 24, .35);
  pointer-events: auto;
  cursor: pointer;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity .3s ease, transform .3s var(--faro-ease), box-shadow .16s ease, background .16s ease;
}
.note-badge.on { opacity: 1; transform: translateY(0); }
.note-badge:hover { background: var(--faro-gold-deep); color: #FFF7E8; }
.note-badge.active {
  background: var(--faro-gold-deep);
  color: #FFF7E8;
  box-shadow: 0 0 0 3px rgba(233, 172, 74, .38);
}

/* La observación que estás mirando ahora mismo, más marcada que las demás. */
.quote-rect.active {
  background: linear-gradient(180deg, rgba(233,172,74,.28), rgba(233,172,74,.46));
  box-shadow: inset 0 -2px 0 var(--faro-gold-deep);
}
/* Y dentro de un bloque de código, destacada por el trazo y no por el relleno. */
.quote-rect.on-code.active {
  background: rgba(233, 172, 74, .22);
  box-shadow: inset 0 -3px 0 var(--faro-gold);
}

/* ------------------------------------------------- recuadro de imágenes */

.outline-layer { position: fixed; inset: 0; pointer-events: none; }
.img-outline {
  position: fixed;
  border: 1px solid var(--faro-gold);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .3s ease;
}
.img-outline.on { opacity: 1; }

/* ------------------------------------------------- modo de selección */

.pick-hover {
  position: fixed;
  border: 1px solid var(--faro-gold);
  border-radius: 2px;
  background: rgba(233, 172, 74, .10);
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
.pick-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-hint { color: var(--faro-muted); font-size: 11.5px; flex: none; }

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
  .quote-rect.sweep::after { content: none; }
  .progress.run i { animation: none; width: 100%; }
}
:host(.faro-still) .spot,
:host(.faro-still) .ring,
:host(.faro-still) .card { transition: opacity .16s ease; }
:host(.faro-still) .spot.breathe { animation: none; }
:host(.faro-still) .note-badge { transition: opacity .16s ease; }
:host(.faro-still) .ring.draw rect { animation: none; stroke-dashoffset: 0; }
:host(.faro-still) .quote-rect.sweep::after { content: none; }
`

/**
 * Estilo del resaltado nativo. Va en el documento, no en el shadow root:
 * `::highlight()` sólo se puede estilar desde una hoja del documento.
 * Es la única inserción que hacemos fuera del shadow, y va en <head>, nunca
 * dentro del contenido.
 */
export const HIGHLIGHT_CSS = `
::highlight(faro-quote) {
  background-color: rgba(233, 172, 74, .28);
  color: inherit;
}
`

/**
 * Cursor del modo de selección.
 *
 * Va en el documento porque el cursor de la página no se puede cambiar desde un
 * shadow root. Se cuelga de una clase en <html> para poder quitarlo entero, y
 * no toca ni un nodo del contenido.
 */
export const PICK_CSS = `
html.faro-picking, html.faro-picking * { cursor: crosshair !important; }
html.faro-picking img,
html.faro-picking svg,
html.faro-picking figure,
html.faro-picking figure * { cursor: copy !important; }
html.faro-picking #faro-overlay-host,
html.faro-picking #faro-overlay-host * { cursor: default !important; }
`
