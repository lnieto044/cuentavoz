// Lógica pura de cuándo mostrar el recorrido en video la primera vez (ver
// VideoRecorrido.jsx), separada en un módulo .js aparte porque node:test no
// puede parsear JSX directamente - así esta parte sí se prueba, igual que
// colaOffline.js/accesibilidad.js.
const CLAVE_TUTORIAL = "cv_tutorial_visto";
export const EVENTO_ABRIR_VIDEO = "cuentavoz:abrir-video";

export function debeAbrirTutorial() {
  try { return !localStorage.getItem(CLAVE_TUTORIAL); }
  catch (_) { return false; }
}

export function marcarTutorialVisto() {
  try { localStorage.setItem(CLAVE_TUTORIAL, "1"); } catch (_) {}
}
