/** Escuchar y hablar. Las dos piezas de la capa de voz. */
import { BASE, leerToken } from "./api";
// quitarTildes/esAfirmacion/esNegacion viven en su propio módulo sin
// dependencias (ni de "./api" ni del navegador) para poder probarlas con
// node --test igual que interpreteLocal.js - se reexportan aquí para que
// quien ya las importaba desde "./voz" siga funcionando igual.
export { quitarTildes, esAfirmacion, esNegacion } from "./confirmacionVoz.js";

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

/** Devuelve una promesa que se resuelve cuando termina de decirlo (no
    cuando empieza) - quien vaya a escuchar() justo después de hablar()
    necesita esperar a que la pregunta se termine de decir, o el
    micrófono arranca mientras el navegador todavía está sonando y se
    pierde la respuesta. */
function hablarConNavegador(texto) {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
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
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
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

// Si detenerVoz() corta el audio a la mitad (pause() no dispara "ended"),
// esto es lo que despierta a quien esté esperando hablar() - si no, un
// cambio de pantalla a mitad de frase dejaría esa promesa colgada para
// siempre.
let resolverAudioActual = null;

/** App.jsx la llama en cada cambio de pantalla: corta lo que se esté
    reproduciendo y invalida cualquier hablar() todavía en camino. */
export function detenerVoz() {
  generacion++;
  if (audioActual) { audioActual.pause(); audioActual.currentTime = 0; }
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  resolverAudioActual?.();
  resolverAudioActual = null;
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
  // Espera a que el audio TERMINE de sonar, no solo a que arranque -
  // audio.play() por sí solo se resuelve apenas empieza a reproducir, y
  // quien llama a hablar() esperando poder escuchar() justo después
  // necesita que la pregunta ya se haya terminado de decir.
  await new Promise((resolve) => {
    resolverAudioActual = resolve;
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", resolve, { once: true });
    audio.play().catch(resolve);
  });
  resolverAudioActual = null;
  URL.revokeObjectURL(url);
}

// Tope de seguridad: ninguna frase de esta app tarda tanto en decirse.
// Sin esto, si el navegador alguna vez no dispara "ended"/"onend" (se ha
// visto en algunos Chrome tras minimizar la pestaña, y en entornos sin
// salida de audio real), hablar() quedaría esperando para siempre y el
// micrófono que depende de "await hablar()" nunca llegaría a abrirse.
const TOPE_HABLAR_MS = 12000;

/** Habla el texto y devuelve una promesa que se resuelve cuando termina
    de decirlo (o, como mucho, a los TOPE_HABLAR_MS). Casi todo el código
    la llama "al aire" (sin await) y eso sigue funcionando igual; quien
    necesite escuchar() justo después de preguntar algo sí debe
    esperarla, o el micrófono arranca mientras todavía se está hablando y
    se pierde parte de la respuesta. */
export function hablar(texto, { forzar = false } = {}) {
  if (!texto) return Promise.resolve();
  if (!forzar && !confirmacionHablada) return Promise.resolve();
  generacion++;
  const miGeneracion = generacion;
  const intento = hablarConNeuronal(texto, miGeneracion)
    .catch(() => { if (miGeneracion === generacion) return hablarConNavegador(texto); });
  return Promise.race([
    intento,
    new Promise((resolve) => setTimeout(resolve, TOPE_HABLAR_MS)),
  ]);
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
