export const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function guardarToken(t) {
  localStorage.setItem("cv_token", t);
}
export function leerToken() {
  return localStorage.getItem("cv_token");
}
export function borrarToken() {
  localStorage.removeItem("cv_token");
}

/** Llama al backend adjuntando el token de la sesión. */
export async function pedir(ruta, opciones = {}, token) {
  const t = token || leerToken();
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...opciones.headers,
    },
  });
  if (!res.ok) {
    let detalle = `Error ${res.status}`;
    try {
      const j = await res.json();
      detalle = j.detail || j.detalle || detalle;
    } catch (_) {}
    throw new Error(detalle);
  }
  return res.json();
}

export async function ingresar(usuario, clave) {
  const cuerpo = new URLSearchParams({ username: usuario, password: clave });
  const res = await fetch(`${BASE}/api/ingresar`, { method: "POST", body: cuerpo });
  if (!res.ok) throw new Error("Usuario o clave incorrectos.");
  return res.json();
}

export const enviarTurno = (texto, sesionId, token) =>
  pedir("/api/agente/turno", {
    method: "POST",
    body: JSON.stringify({ texto, sesion_id: sesionId }),
  }, token);

export const abrirBodega = (bodega, token) =>
  pedir("/api/bodegas/abrir", {
    method: "POST",
    body: JSON.stringify({ bodega }),
  }, token);

