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

// La sesión completa (token + datos del usuario), no solo el token: sin
// esto, reabrir la app (o perder la señal justo al recargar) obligaba a
// iniciar sesión otra vez contra el backend - imposible sin red, aunque
// la persona ya se hubiera identificado minutos antes en el mismo equipo.
// Con la sesión guardada, App.jsx entra directo sin depender de la red.
const CLAVE_SESION = "cv_sesion";

export function guardarSesion(s) {
  localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
  if (s?.token) guardarToken(s.token);   // cv_token queda siempre en sync
}
export function leerSesion() {
  try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || "null"); }
  catch (_) { return null; }
}
export function borrarSesion() {
  localStorage.removeItem(CLAVE_SESION);
  borrarToken();
}
/** Cambiar el PIN o "cerrar todas las sesiones" emite un token nuevo sin
    volver a pasar por /api/ingresar: hay que refrescar también la sesión
    cacheada, no solo el token suelto, o la próxima vez que la app arranque
    sin red restauraría el token viejo ya invalidado. */
export function actualizarTokenSesion(nuevoToken) {
  guardarToken(nuevoToken);
  const s = leerSesion();
  if (s) guardarSesion({ ...s, token: nuevoToken });
}

/** fetch() rechaza con un TypeError cuando la red falla (Wi-Fi caído, DNS,
    CORS bloqueado) - la especificación lo llama "network error". Detectarlo
    así (en vez de por texto del mensaje) es lo que ya usaba Conteo.jsx para
    activar el modo sin conexión; se comparte aquí para que todo el frontend
    reconozca el mismo caso una sola vez. */
export function esFalloRed(error) {
  return error?.esFalloRed === true || error instanceof TypeError
    || /failed to fetch|networkerror|load failed/i.test(error?.message || "");
}

/** El error técnico crudo en inglés que fetch() lanza tal cual, traducido a
    algo que un auxiliar en una bodega con mal Wi-Fi pueda entender. Marca el
    error con esFalloRed=true para que quien lo reciba después de pedir()
    (que ya perdió el TypeError original) lo siga reconociendo con
    esFalloRed(), en vez de tener que repetir la detección por texto. */
function errorDeRed() {
  const error = new Error("Sin conexión con el servidor. Revise el Wi-Fi e intente de nuevo.");
  error.esFalloRed = true;
  return error;
}

/** Llama al backend adjuntando el token de la sesión. */
export async function pedir(ruta, opciones = {}, token) {
  const t = token || leerToken();
  // arma las opciones completas ANTES del try: si algo aquí lanza (un
  // "opciones.headers" mal formado, por ejemplo), es un error de
  // programación real y no debe disfrazarse de fallo de red.
  const opcionesCompletas = {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...opciones.headers,
    },
  };
  let res;
  try {
    res = await fetch(`${BASE}${ruta}`, opcionesCompletas);
  } catch (error) {
    if (esFalloRed(error)) throw errorDeRed();
    throw error;
  }
  if (!res.ok) {
    // 401 de verdad (no un fallo de red: el servidor sí respondió) significa
    // que el servidor ya no reconoce este token - ni reintentar ni seguir
    // usando la sesión cacheada sirve de nada; se limpia para que la
    // próxima carga pida iniciar sesión de nuevo en vez de quedar
    // atascada reusando un token que el backend rechaza siempre.
    if (res.status === 401) borrarSesion();
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
    if (esFalloRed(error)) throw errorDeRed();
    throw error;
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

// Para pantallas que no cuentan ni piden (Inicio, Ajustes, Ayuda, Reportes,
// Panel): una pregunta suelta o una orden de navegar, sin el estado de
// conversación multi-turno que sí necesita enviarTurno. Ver AsistenteVoz.jsx.
export const preguntarAsistente = (texto, vista, token) =>
  pedir("/api/agente/asistente", {
    method: "POST",
    body: JSON.stringify({ texto, vista }),
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
    if (esFalloRed(error)) throw errorDeRed();
    throw error;
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
