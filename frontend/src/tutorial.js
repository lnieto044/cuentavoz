// Lógica pura de cuándo mostrar el recorrido en video la primera vez (ver
// VideoRecorrido.jsx), separada en un módulo .js aparte porque node:test no
// puede parsear JSX directamente - así esta parte sí se prueba, igual que
// colaOffline.js/accesibilidad.js.
//
// La bandera se guarda POR USUARIO (cv_tutorial_visto_<id>), no una sola
// para todo el dispositivo: en una bodega una tablet la comparten varios
// auxiliares, y con una bandera única solo la primera persona que la usara
// alguna vez veria el video - el resto, aunque fuera su primer ingreso,
// nunca lo veria.
const PREFIJO_CLAVE = "cv_tutorial_visto_";
export const EVENTO_ABRIR_VIDEO = "cuentavoz:abrir-video";

export function debeAbrirTutorial(usuarioId) {
  try { return !localStorage.getItem(PREFIJO_CLAVE + usuarioId); }
  catch (_) { return false; }
}

export function marcarTutorialVisto(usuarioId) {
  try { localStorage.setItem(PREFIJO_CLAVE + usuarioId, "1"); } catch (_) {}
}
