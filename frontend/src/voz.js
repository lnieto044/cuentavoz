/** Escuchar y hablar. Las dos piezas de la capa de voz. */
const IDIOMA = "es-CO";
const Reconocedor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const vozDisponible = () => Boolean(Reconocedor);

export function hablar(texto) {
  if (!texto || typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = IDIOMA;
  u.rate = 1.02;
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
