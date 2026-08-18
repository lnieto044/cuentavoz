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

// A que genero suena cada voz neuronal - para que, si la neuronal falla y
// hay que caer al respaldo del navegador, se busque una voz de navegador
// del mismo genero en vez de una elegida al azar. No es la MISMA voz (eso
// no se puede: el navegador no tiene "Kore"), pero al menos no suena como
// si de repente le estuviera hablando otra persona.
const _GENERO_VOZ = { kore: "femenina", aoede: "femenina", puck: "masculina", charon: "masculina" };

const Reconocedor =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const vozDisponible = () => Boolean(Reconocedor);

/** MiPerfil llama esto una vez cargadas (o cambiadas) las preferencias.
    "idioma" quedo con ese nombre por compatibilidad con quien ya llama
    configurarVoz(), pero ahora guarda la clave de la voz neuronal
    (kore, puck...), no un codigo de idioma de navegador. */
export function configurarVoz({ idioma, velocidad, confirmacionHablada: ch } = {}) {
  if (idioma && idioma !== vozNeuronal) {
    vozNeuronal = idioma;
    // la voz de respaldo se habia elegido (o cacheado como "no hay") con
    // la preferencia VIEJA - sin esto, cambiar la voz en Mi perfil no
    // cambiaba nada si en algun momento se habia caido al respaldo antes.
    vozNavegadorBuscada = false;
    vozNavegadorElegida = null;
  }
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

// Nombres tipicos de voces de navegador/SO en espanol, para adivinar de
// que genero suena cada una - el estandar Web Speech API no expone genero,
// asi que esto es lo mas cercano a saberlo sin reproducirla.
const _NOMBRES_FEM = /sabina|helena|elvira|laura|m[oó]nica|paulina|luc[ií]a|elena|isabela|marisol|conchita|pen[eé]lope|esperanza|camila|valentina|female|mujer/;
const _NOMBRES_MASC = /ra[uú]l|jorge|diego|pablo|carlos|alonso|enrique|miguel|male|hombre/;

function _puntuarVozNavegador(v, generoPreferido) {
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
  // que suene del mismo genero que la voz neuronal elegida en Mi perfil
  // pesa mas que cualquier otra cosa: es justo lo que hace notorio el
  // cambio de voz cuando toca caer al respaldo.
  if (generoPreferido === "femenina" && _NOMBRES_FEM.test(nombre)) p += 50;
  else if (generoPreferido === "masculina" && _NOMBRES_MASC.test(nombre)) p += 50;
  else if (generoPreferido === "femenina" && _NOMBRES_MASC.test(nombre)) p -= 50;
  else if (generoPreferido === "masculina" && _NOMBRES_FEM.test(nombre)) p -= 50;
  return p;
}

function _elegirVozNavegador() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voces = window.speechSynthesis.getVoices();
  if (!voces.length) return null;
  const generoPreferido = _GENERO_VOZ[vozNeuronal];
  const candidatas = voces.map((v) => ({ v, p: _puntuarVozNavegador(v, generoPreferido) }))
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

// Tope de seguridad: si el navegador alguna vez no dispara "ended"/"onend"
// (se ha visto en algunos Chrome tras minimizar la pestaña, y en entornos
// sin salida de audio real), hablar() quedaría esperando para siempre y el
// micrófono que depende de "await hablar()" nunca llegaría a abrirse.
//
// Un numero fijo no alcanza: "Hay varias: <hasta 6 bodegas>. ¿Cuál de
// todas?" (Conteo.jsx, cuando el nombre dictado es ambiguo) puede pasar
// facil los 200 caracteres con nombres reales del catalogo - a un ritmo
// de lectura normal eso son 15-20 segundos, mas que un limite fijo de 12s
// pensado para frases cortas. Con el limite fijo, esa frase se cortaba a
// medias: la promesa de hablar() se resolvia con el audio TODAVIA
// sonando, y el microfono que se abre justo despues terminaba
// "escuchando" la cola de la propia voz del agente como si fuera la
// respuesta de la persona. El tope ahora escala con el largo del texto
// (y con que tan lenta este la voz elegida en Mi perfil), con un piso
// para frases cortas y un techo para no esperar para siempre si el audio
// de verdad se atasco.
const TOPE_HABLAR_MS_PISO = 12000;
const TOPE_HABLAR_MS_TECHO = 40000;

function _topeHablar(texto) {
  // ~12 caracteres por segundo es una lectura pausada y generosa (cubre
  // voces mas lentas que el promedio); /tasaActual porque una voz "lenta"
  // (0.82x) de verdad tarda mas en decir lo mismo que una "rapida" (1.3x).
  const estimado = (texto.length / 12) * 1000 / tasaActual;
  return Math.min(TOPE_HABLAR_MS_TECHO, Math.max(TOPE_HABLAR_MS_PISO, estimado));
}

/** Habla el texto y devuelve una promesa que se resuelve cuando termina
    de decirlo (o, como mucho, al tope de seguridad calculado para ese
    texto). Casi todo el código la llama "al aire" (sin await) y eso sigue
    funcionando igual; quien necesite escuchar() justo después de
    preguntar algo sí debe esperarla, o el micrófono arranca mientras
    todavía se está hablando y se pierde parte de la respuesta. */
export function hablar(texto, { forzar = false } = {}) {
  if (!texto) return Promise.resolve();
  if (!forzar && !confirmacionHablada) return Promise.resolve();
  generacion++;
  const miGeneracion = generacion;
  const intento = hablarConNeuronal(texto, miGeneracion)
    .catch(() => { if (miGeneracion === generacion) return hablarConNavegador(texto); });
  return Promise.race([
    intento,
    new Promise((resolve) => setTimeout(resolve, _topeHablar(texto))),
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
