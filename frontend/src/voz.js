/** Escuchar y hablar. Las dos piezas de la capa de voz. */
let IDIOMA = "es-CO";
const TASA = { lenta: 0.82, normal: 1.02, rapida: 1.3 };
let tasaActual = TASA.normal;
let confirmacionHablada = true;

const Reconocedor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const vozDisponible = () => Boolean(Reconocedor);

/** MiPerfil llama esto una vez cargadas las preferencias de la persona. */
export function configurarVoz({ idioma, velocidad, confirmacionHablada: ch } = {}) {
  if (idioma) IDIOMA = idioma;
  if (velocidad && TASA[velocidad]) tasaActual = TASA[velocidad];
  if (ch !== undefined) confirmacionHablada = ch;
}

export function hablar(texto, { forzar = false } = {}) {
  if (!texto || typeof window === "undefined" || !window.speechSynthesis) return;
  if (!forzar && !confirmacionHablada) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = IDIOMA;
  u.rate = tasaActual;
  window.speechSynthesis.speak(u);
}

/** Escucha una frase y la devuelve como texto. */
export function escuchar({ alTexto, alEstado, alError }) {
  if (!Reconocedor) {
    alError?.("Este navegador no reconoce voz. Use Chrome o Edge.");
    return null;
  }
  const rec = new Reconocedor();
  rec.lang = IDIOMA;
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
