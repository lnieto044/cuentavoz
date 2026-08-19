// La cola de conteos guardados en este equipo mientras no había señal
// (ver Conteo.jsx). Vivía solo dentro de Conteo.jsx - invisible desde
// cualquier otra pantalla aunque los ítems seguían pendientes de
// sincronizar. Se saca a un módulo aparte para que BarraLateral.jsx
// también pueda mostrarla, sin duplicar la lógica.
export const CLAVE_COLA = (sesionId) => `cv_offline_${sesionId}`;
export const EVENTO_COLA = "cuentavoz:cola-offline-cambiada";

export function leerCola(sesionId) {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLA(sesionId)) || "[]"); }
  catch (_) { return []; }
}

export function guardarCola(sesionId, cola) {
  localStorage.setItem(CLAVE_COLA(sesionId), JSON.stringify(cola));
  window.dispatchEvent(new Event(EVENTO_COLA));
}
