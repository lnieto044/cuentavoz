// Ingreso con huella del dispositivo (WebAuthn real: Windows Hello, Touch
// ID, huella de Android) - conversión manual base64url <-> ArrayBuffer en
// vez de PublicKeyCredential.parseCreationOptionsFromJSON/toJSON() para que
// funcione en cualquier navegador con soporte WebAuthn, no solo los más
// recientes.
import { pedir } from "./api";

function base64urlABuffer(b64url) {
  const relleno = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const cruda = atob(b64);
  const buf = new Uint8Array(cruda.length);
  for (let i = 0; i < cruda.length; i++) buf[i] = cruda.charCodeAt(i);
  return buf.buffer;
}

function bufferABase64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function soportaHuella() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** No basta con que el navegador soporte WebAuthn: hay que confirmar que
    este equipo tiene un autenticador integrado configurado (Windows Hello,
    Touch ID, huella de Android). Sin esto el botón aparecería para
    cualquiera y fallaría en silencio en equipos sin lector ni PIN de
    Windows Hello activado. */
export async function hayAutenticadorDisponible() {
  if (!soportaHuella()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function opcionesCreacionDesdeJSON(json) {
  return {
    ...json,
    challenge: base64urlABuffer(json.challenge),
    user: { ...json.user, id: base64urlABuffer(json.user.id) },
    excludeCredentials: (json.excludeCredentials || []).map((c) => ({
      ...c, id: base64urlABuffer(c.id),
    })),
  };
}

function opcionesPeticionDesdeJSON(json) {
  return {
    ...json,
    challenge: base64urlABuffer(json.challenge),
    allowCredentials: (json.allowCredentials || []).map((c) => ({
      ...c, id: base64urlABuffer(c.id),
    })),
  };
}

function credencialRegistroAJSON(cred) {
  return {
    id: cred.id, rawId: bufferABase64url(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufferABase64url(cred.response.clientDataJSON),
      attestationObject: bufferABase64url(cred.response.attestationObject),
    },
  };
}

function credencialIngresoAJSON(cred) {
  return {
    id: cred.id, rawId: bufferABase64url(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufferABase64url(cred.response.clientDataJSON),
      authenticatorData: bufferABase64url(cred.response.authenticatorData),
      signature: bufferABase64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufferABase64url(cred.response.userHandle) : null,
    },
  };
}

/** Registra la huella de este dispositivo para el usuario ya autenticado. */
export async function registrarHuellaDispositivo(token) {
  const opciones = await pedir("/api/usuarios/yo/huella/opciones", { method: "POST" }, token);
  const credencial = await navigator.credentials.create({
    publicKey: opcionesCreacionDesdeJSON(opciones),
  });
  if (!credencial) throw new Error("No se pudo crear la credencial de huella.");
  await pedir("/api/usuarios/yo/huella/verificar", {
    method: "POST", body: JSON.stringify(credencialRegistroAJSON(credencial)),
  }, token);
}

/** Ingresa con la huella ya registrada. Devuelve {token, perfil, usuario},
    igual que ingresar() con clave. */
export async function ingresarConHuella(usuarioOCodigo) {
  const { reto_id, opciones } = await pedir(
    `/api/auth/huella/opciones?usuario=${encodeURIComponent(usuarioOCodigo)}`);
  const credencial = await navigator.credentials.get({
    publicKey: opcionesPeticionDesdeJSON(opciones),
  });
  if (!credencial) throw new Error("No se pudo leer la huella.");
  return pedir("/api/auth/huella/verificar", {
    method: "POST",
    body: JSON.stringify({ reto_id, credencial: credencialIngresoAJSON(credencial) }),
  });
}
