// IPv4 explícito, no "localhost": en Windows el navegador suele resolver
// "localhost" a ::1 (IPv6), y uvicorn por defecto solo escucha en 127.0.0.1.
export const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export function guardarToken(t) {
  localStorage.setItem("cv_token", t);
}
export function leerToken() {
  return localStorage.getItem("cv_token");
}
export function borrarToken() {
  localStorage.removeItem("cv_token");
}

/** "Failed to fetch" / "NetworkError" del navegador en un mensaje que un
    auxiliar en una bodega con mal Wi-Fi pueda entender, en vez del error
    técnico crudo en inglés que fetch() lanza tal cual. */
function mensajeDeRed(error) {
  if (error instanceof TypeError) {
    return new Error("Sin conexión con el servidor. Revise el Wi-Fi e intente de nuevo.");
  }
  return error;
}

/** Llama al backend adjuntando el token de la sesión. */
export async function pedir(ruta, opciones = {}, token) {
  const t = token || leerToken();
  let res;
  try {
    res = await fetch(`${BASE}${ruta}`, {
      ...opciones,
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...opciones.headers,
      },
    });
  } catch (error) {
    throw mensajeDeRed(error);
  }
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
  let res;
  try {
    res = await fetch(`${BASE}/api/ingresar`, { method: "POST", body: cuerpo });
  } catch (error) {
    throw mensajeDeRed(error);
  }
  if (!res.ok) throw new Error("Usuario o clave incorrectos.");
  return res.json();
}

// «respaldo» son las opciones que la pantalla ya tiene mostradas en
// pantalla ({ opciones, opcionesPara }); si el backend se reinició y
// perdió la memoria de la conversación, las recupera de ahí en vez de
// preguntar «¿cuál de los dos?» otra vez sin recordar nada.
export const enviarTurno = (texto, sesionId, token, respaldo = {}) =>
  pedir("/api/agente/turno", {
    method: "POST",
    body: JSON.stringify({
      texto, sesion_id: sesionId,
      opciones_pendientes: respaldo.opciones || null,
      opciones_para: respaldo.opcionesPara || null,
      bodega_id_respaldo: respaldo.bodegaId || null,
      bodega_nombre_respaldo: respaldo.bodegaNombre || null,
      preparacion_respaldo: respaldo.preparacion || null,
      porciones_respaldo: respaldo.porciones || null,
    }),
  }, token);

export const abrirBodega = (bodega, token) =>
  pedir("/api/bodegas/abrir", {
    method: "POST",
    body: JSON.stringify({ bodega }),
  }, token);

/** Descarga un reporte generado por el backend. Un <a href> comun no sirve
    aqui: el endpoint exige el token en la cabecera, y un enlace del
    navegador no lo puede enviar (por eso terminaba en una pagina en blanco
    pidiendo sesion). Se trae como blob autenticado y se dispara la
    descarga nativa del navegador, sin salir de la aplicacion. */
export async function descargarReporte(archivo, token) {
  const t = token || leerToken();
  let res;
  try {
    res = await fetch(
      `${BASE}/api/reportes/descargar?archivo=${encodeURIComponent(archivo)}`,
      { headers: { Authorization: `Bearer ${t}` } }
    );
  } catch (error) {
    throw mensajeDeRed(error);
  }
  if (!res.ok) throw new Error("No se pudo descargar el archivo.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
