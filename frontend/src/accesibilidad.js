// Preferencias de accesibilidad (alto contraste, tamaño de letra) - a
// propósito por dispositivo, no por servidor: son ajustes de cómo se ve la
// pantalla en ESTE equipo, no algo que deba viajar con la cuenta a otro
// dispositivo, y así siguen funcionando sin conexión.
const CLAVE = "cv_accesibilidad";

export function leerPreferencias() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || "{}"); }
  catch (_) { return {}; }
}

export function aplicarPreferencias(p) {
  document.documentElement.setAttribute("data-contraste", p.contraste ? "alto" : "");
  document.documentElement.setAttribute("data-tamano", p.tamano || "");
}

export function guardarPreferencias(p) {
  localStorage.setItem(CLAVE, JSON.stringify(p));
  aplicarPreferencias(p);
}
