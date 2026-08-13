/** Detectar un "sí"/"no" hablado o escrito - sin depender de nada más
    (ni del navegador, ni de la API), para poder probarlo con node --test
    igual que interpreteLocal.js. voz.js reexporta estas mismas funciones
    para quien ya las importaba desde ahí. */

/** Sin esto, "sí" (como lo transcribe la voz, con tilde) NUNCA hacía
    match contra /^(si|sí|...)\b/: en JavaScript \b y \w son ASCII puros,
    así que "í" no cuenta como letra y la frontera de palabra justo
    después de la tilde no se reconoce - "sí" (y hasta "sí ver detalle")
    fallaban en seco, y solo "si" sin tilde funcionaba. Bug real,
    encontrado en producción, que llevaba viva desde el principio en
    varios confirmaciones habladas de la app. */
export function quitarTildes(t) {
  return String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const AFIRMACIONES_BASE = ["si", "confirmo", "confirmar", "claro", "dale", "correcto", "listo"];
const FRASES_AFIRMATIVAS = ["eso es", "asi es"];

/** ¿La respuesta hablada/escrita es un "sí" a lo que se le preguntó?
    "extra" agrega palabras válidas solo en ese contexto puntual - p. ej.
    "ver" cuando la pregunta fue "¿ve el detalle?", o el texto del botón
    de turno ("Enviar", "Solicitar"...) para que decir esa misma palabra
    (en cualquier conjugación: "envíalo", "enviar", "envíelo") confirme
    igual que tocar el botón. */
export function esAfirmacion(texto, extra = []) {
  const t = quitarTildes(String(texto).toLowerCase()).replace(/[.,;:!¿?¡]/g, "");
  const palabras = t.split(/\s+/).filter(Boolean);
  if (!palabras.length || palabras.includes("no")) return false;
  const extrasNorm = extra.map((e) => quitarTildes(e.toLowerCase()));
  const afirmaciones = [...AFIRMACIONES_BASE, ...extrasNorm];
  if (palabras.some((p) => afirmaciones.includes(p))) return true;
  if (FRASES_AFIRMATIVAS.some((f) => t.includes(f))) return true;
  // conjugaciones del extra ("enviar" -> envía/envíalo/enviando...): se
  // compara por raíz, quitando la terminación de infinitivo -ar/-er/-ir,
  // en vez de enumerar cada forma verbal a mano.
  const raices = extrasNorm.map((e) => e.replace(/(ar|er|ir)$/, "")).filter((r) => r.length >= 3);
  return raices.length > 0 && palabras.some((p) => raices.some((r) => p.startsWith(r)));
}

/** ¿La respuesta es un "no" limpio? (primera palabra, no en cualquier
    parte de la frase, para no confundir "no sé, tal vez" con un cierre). */
export function esNegacion(texto) {
  const t = quitarTildes(String(texto).toLowerCase()).replace(/[.,;:!¿?¡]/g, "");
  const palabras = t.split(/\s+/).filter(Boolean);
  return palabras[0] === "no";
}
