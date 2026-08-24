// Lógica pura de cuándo mostrar el recorrido en video (ver
// VideoRecorrido.jsx), separada en un módulo .js aparte porque node:test no
// puede parsear JSX directamente - así esta parte sí se prueba, igual que
// colaOffline.js/accesibilidad.js.
//
// El video sale SIEMPRE al entrar, en cada ingreso - no solo la primera
// vez. Lo único que lo apaga es que la propia persona lo desactive desde
// un control dentro del video (VideoRecorrido.jsx), y esa bandera se
// guarda POR USUARIO (cv_tutorial_deshabilitado_<id>), no una sola para
// todo el dispositivo: en una bodega una tablet la comparten varios
// auxiliares, y una bandera única haria que un auxiliar apagara el video
// para todos los demas que usan el mismo equipo.
const PREFIJO_CLAVE = "cv_tutorial_deshabilitado_";
export const EVENTO_ABRIR_VIDEO = "cuentavoz:abrir-video";

export function debeAbrirTutorial(usuarioId) {
  try { return !localStorage.getItem(PREFIJO_CLAVE + usuarioId); }
  catch (_) { return true; }
}

export function deshabilitarTutorial(usuarioId) {
  try { localStorage.setItem(PREFIJO_CLAVE + usuarioId, "1"); } catch (_) {}
}

export function habilitarTutorial(usuarioId) {
  try { localStorage.removeItem(PREFIJO_CLAVE + usuarioId); } catch (_) {}
}
