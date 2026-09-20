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
 * Sólo las pantallas de CONSULTA: cerrarlas es volver al chat. Las de
 * conexión, claves y contexto quedan fuera a propósito, porque «cerrarlas» es
 * decidir algo —saltar las claves, empezar sin contexto— que no debe
 * dispararse por un Escape distraído.
 */

/** id de la pantalla → id del botón que la cierra (desde H5, la flecha de su cabecera). */
export const ESCAPE_CLOSES = Object.freeze({
  'screen-memory': 'btn-memory-close',
  'screen-log': 'btn-log-close',
  'screen-sources': 'btn-sources-close',
  'screen-today': 'btn-today-close',
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
