/**
 * Qué cierra la tecla Escape en el panel.
 *
 * Esc no cerraba Ajustes, Memoria ni Registro, ni el velo «Trabajando…» con su
 * botón Cancelar a la vista; en Páginas base sólo si el foco estaba en el campo
 * de búsqueda, porque el único manejador vivía ahí (docs/PLAN.md §2.5 A3,
 * reproducido en la auditoría del 2026-09-13). Ahora hay un solo `keydown` a
 * nivel de documento en panel.js, y este mapa —puro, sin DOM— dice qué botón
 * pulsa según qué pantalla esté abierta.
 *
 * Qué entra en el mapa: las pantallas cuya flecha es «volver al chat» y no
 * decide nada —Memoria, Registro, Páginas base y «Qué mirar hoy»— y, desde
 * H17, la del modelo. Las de conexión, claves y contexto quedan fuera a
 * propósito, porque «cerrarlas» es decidir algo —saltar las claves, empezar
 * sin contexto— que no debe dispararse por un Escape distraído.
 *
 * La del modelo (H17, docs/PLAN2.md §3.3) está en el mapa pero NO siempre se
 * cierra: su flecha sólo se enseña cuando de ahí se puede salir sin elegir
 * (abierta desde Ajustes, o tras un error con el chat ya en marcha). En el
 * primer uso, tras una verificación de claves o un indexado que fallaron por
 * el modelo, la flecha nace oculta —no hay modelo con el que seguir— y el
 * manejador de teclado del panel no pulsa un botón oculto: Escape no hace
 * nada. Aquí sólo se dice qué botón es; si está a la vista lo decide el panel.
 */

/** id de la pantalla → id del botón que la cierra (desde H5, la flecha de su cabecera). */
export const ESCAPE_CLOSES = Object.freeze({
  'screen-memory': 'btn-memory-close',
  'screen-log': 'btn-log-close',
  'screen-sources': 'btn-sources-close',
  'screen-today': 'btn-today-close',
  'screen-model': 'btn-model-close',
})

/**
 * Pantallas que Escape cierra SIN pulsar su botón.
 *
 * El botón de Ajustes («Guardar y volver» desde H5; antes «Listo») no cierra
 * sin más: guarda todos los campos —la contraseña y la
 * URL del servidor incluidas— y, si una de esas dos cambió, rearranca el panel,
 * lo que de paso cancela el turno en vuelo (desde H6 sólo entonces: lo demás se
 * aplica en caliente). Con Escape mapeado a ese botón, un Escape distraído aplicaba
 * unos ajustes a medio escribir (revisión adversaria de H2, 2026-09-14). Aquí
 * Escape es «cerrar y olvidar»: la pantalla se rellena de `state.settings` cada
 * vez que se abre, así que lo tecleado y no guardado se pierde, que es justo lo
 * que se pide.
 */
export const ESCAPE_DISMISSES = Object.freeze(['screen-settings'])
