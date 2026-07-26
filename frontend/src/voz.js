/** Escuchar y hablar. Las dos piezas de la capa de voz. */
const IDIOMA_ESCUCHA = "es-CO";     // como reconoce lo que usted dice: fijo
let idiomaVoz = "es-MX";            // como suena CuentaVoz al hablar: elegible
const TASA = { lenta: 0.82, normal: 1.02, rapida: 1.3 };
let tasaActual = TASA.normal;
let confirmacionHablada = true;

const Reconocedor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const vozDisponible = () => Boolean(Reconocedor);

/** MiPerfil llama esto una vez cargadas (o cambiadas) las preferencias. */
export function configurarVoz({ idioma, velocidad, confirmacionHablada: ch } = {}) {
  if (idioma && idioma !== idiomaVoz) {
    idiomaVoz = idioma;
    vozBuscada = false;             // hay que rebuscar la voz para el nuevo idioma
  }
  if (velocidad && TASA[velocidad]) tasaActual = TASA[velocidad];
  if (ch !== undefined) confirmacionHablada = ch;
}

/** Elige la voz en español más natural disponible en este navegador/SO:
    prioriza el idioma elegido por la persona (México por defecto: suele
    tener las voces mejor entrenadas) y las voces "neurales/online"
    (mucho más humanas) sobre las clásicas "Desktop", que suenan robóticas. */
let vozElegida = null;
let vozBuscada = false;

function _puntuarVoz(v) {
  const lang = (v.lang || "").toLowerCase();
  const nombre = (v.name || "").toLowerCase();
  let p = 0;
  if (lang === idiomaVoz.toLowerCase()) p += 60;
  else if (lang.startsWith("es-")) p += 20;
  else if (lang.startsWith("es")) p += 5;
  else return -1;                                   // ni siquiera es español

  if (["es-mx", "es-419", "es-us", "es-co", "es-ar"].includes(lang)) p += 15;
  if (lang === "es-es") p -= 10;                     // acento de España: no es lo pedido

  if (/natural|online|neural|wavenet|premium/.test(nombre)) p += 30;
  if (/google/.test(nombre)) p += 10;
  if (/desktop|compact/.test(nombre)) p -= 20;        // motores viejos, suenan robóticos
  if (/female|mujer|dalia|paulina|larissa|renata|sabina|lucia|helena|salome|camila/
      .test(nombre)) p += 5;
  return p;
}

function _elegirVoz() {
  const voces = window.speechSynthesis.getVoices();
  if (!voces.length) return null;
  const candidatas = voces.map((v) => ({ v, p: _puntuarVoz(v) }))
    .filter((x) => x.p >= 0)
    .sort((a, b) => b.p - a.p);
  return candidatas[0]?.v || null;
}

/** Lista de voces en español disponibles en este navegador, para mostrar
    en Mi perfil (nombre visible + puntaje interno de calidad esperada). */
export function vocesDisponibles() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices()
    .filter((v) => (v.lang || "").toLowerCase().startsWith("es"))
    .map((v) => ({ nombre: v.name, lang: v.lang, puntaje: _puntuarVoz(v) }))
    .sort((a, b) => b.puntaje - a.puntaje);
}

export function hablar(texto, { forzar = false } = {}) {
  if (!texto || typeof window === "undefined" || !window.speechSynthesis) return;
  if (!forzar && !confirmacionHablada) return;

  if (!vozBuscada) {
    vozElegida = _elegirVoz();
    if (!vozElegida) {
      // las voces cargan async la primera vez; reintenta cuando estén listas
      window.speechSynthesis.onvoiceschanged = () => { vozElegida = _elegirVoz(); };
    } else {
      vozBuscada = true;
    }
  }

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = vozElegida?.lang || idiomaVoz;
  u.rate = tasaActual;
  u.pitch = 1.03;
  if (vozElegida) u.voice = vozElegida;
  window.speechSynthesis.speak(u);
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
