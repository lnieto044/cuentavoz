/** Escuchar y hablar. Las dos piezas de la capa de voz. */
import { BASE, leerToken } from "./api";

const IDIOMA_ESCUCHA = "es-CO";     // como reconoce lo que usted dice: fijo
let vozNeuronal = "kore";           // que voz neuronal usa CuentaVoz al hablar: elegible
const TASA = { lenta: 0.82, normal: 1.02, rapida: 1.3 };
let tasaActual = TASA.normal;
let confirmacionHablada = true;

const Reconocedor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const vozDisponible = () => Boolean(Reconocedor);

/** MiPerfil llama esto una vez cargadas (o cambiadas) las preferencias.
    "idioma" quedo con ese nombre por compatibilidad con quien ya llama
    configurarVoz(), pero ahora guarda la clave de la voz neuronal
    (kore, puck...), no un codigo de idioma de navegador. */
export function configurarVoz({ idioma, velocidad, confirmacionHablada: ch } = {}) {
  if (idioma) vozNeuronal = idioma;
  if (velocidad && TASA[velocidad]) tasaActual = TASA[velocidad];
  if (ch !== undefined) confirmacionHablada = ch;
}

/* ── Respaldo: voz del navegador (speechSynthesis) ──
   Solo se usa si la voz neuronal no responde (sin internet, sin llave de
   Gemini configurada, o la API falla) - para que el conteo por voz nunca
   se quede completamente mudo. Suena mas robotica, pero es mejor que
   nada mientras se recupera la conexion. */
let vozNavegadorElegida = null;
let vozNavegadorBuscada = false;

function _puntuarVozNavegador(v) {
  const lang = (v.lang || "").toLowerCase();
  const nombre = (v.name || "").toLowerCase();
  let p = 0;
  if (lang.startsWith("es-mx") || lang.startsWith("es-419")) p += 20;
  else if (lang.startsWith("es-")) p += 10;
  else if (lang.startsWith("es")) p += 5;
  else return -1;
  if (/natural|online|neural|wavenet|premium/.test(nombre)) p += 30;
  if (/google/.test(nombre)) p += 10;
  if (/desktop|compact/.test(nombre)) p -= 20;
  return p;
}

function _elegirVozNavegador() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voces = window.speechSynthesis.getVoices();
  if (!voces.length) return null;
  const candidatas = voces.map((v) => ({ v, p: _puntuarVozNavegador(v) }))
    .filter((x) => x.p >= 0).sort((a, b) => b.p - a.p);
  return candidatas[0]?.v || null;
}

function hablarConNavegador(texto) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (!vozNavegadorBuscada) {
    vozNavegadorElegida = _elegirVozNavegador();
    if (!vozNavegadorElegida) {
      window.speechSynthesis.onvoiceschanged = () => { vozNavegadorElegida = _elegirVozNavegador(); };
    } else {
      vozNavegadorBuscada = true;
    }
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = vozNavegadorElegida?.lang || "es-MX";
  u.rate = tasaActual;
  u.pitch = 1.03;
  if (vozNavegadorElegida) u.voice = vozNavegadorElegida;
  window.speechSynthesis.speak(u);
}

/* ── Voz neuronal real (Gemini TTS, via el backend) ── */
let audioActual = null;

// La síntesis real tarda unos segundos (viaja al backend y a Gemini): si
// mientras tanto la persona ya cambió de pantalla, esa respuesta ya no
// tiene contexto y no debe hablar sola de repente sobre una pantalla que
// ya no está en uso. Cada hablar() (y detenerVoz()) sube esta generación;
// una respuesta que llega tarde, de una generación vieja, se descarta en
// vez de reproducirse.
let generacion = 0;

/** App.jsx la llama en cada cambio de pantalla: corta lo que se esté
    reproduciendo y invalida cualquier hablar() todavía en camino. */
export function detenerVoz() {
  generacion++;
  if (audioActual) { audioActual.pause(); audioActual.currentTime = 0; }
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}

async function hablarConNeuronal(texto, miGeneracion) {
  const res = await fetch(`${BASE}/api/voz/hablar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${leerToken()}`,
    },
    body: JSON.stringify({ texto, voz: vozNeuronal }),
  });
  if (!res.ok) throw new Error("voz neuronal no disponible");
  const blob = await res.blob();
  if (miGeneracion !== generacion) return;      // se cambió de pantalla mientras se generaba
  const url = URL.createObjectURL(blob);
  if (audioActual) { audioActual.pause(); audioActual.currentTime = 0; }
  const audio = new Audio(url);
  audio.playbackRate = tasaActual;
  audioActual = audio;
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  await audio.play();
}

export function hablar(texto, { forzar = false } = {}) {
  if (!texto) return;
  if (!forzar && !confirmacionHablada) return;
  generacion++;
  const miGeneracion = generacion;
  hablarConNeuronal(texto, miGeneracion)
    .catch(() => { if (miGeneracion === generacion) hablarConNavegador(texto); });
}

/** Escucha una frase y la devuelve como texto. */
export function escuchar({ alTexto, alEstado, alError }) {
  if (!Reconocedor) {
    alError?.("Este navegador no reconoce voz. Use Chrome o Edge.");
    return null;
  }
  const rec = new Reconocedor();
  rec.lang = IDIOMA_ESCUCHA;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => alEstado?.("escuchando");
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const texto = r[0].transcript.trim();
    if (r.isFinal) {
      alEstado?.("procesando");
      alTexto?.(texto);
    } else {
      alEstado?.("escuchando", texto);
    }
  };
  rec.onerror = (e) => {
    alEstado?.("listo");
    if (e.error === "not-allowed")
      alError?.("Debe permitir el micrófono en el navegador.");
    else if (e.error !== "aborted" && e.error !== "no-speech")
      alError?.(`No pude escuchar (${e.error}).`);
  };
  rec.onend = () => alEstado?.("listo");
  try {
    rec.start();
  } catch (_) {}
  return rec;
}
