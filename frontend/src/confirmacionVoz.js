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
    "extra" agrega palabras válidas solo en ese contexto puntual (p. ej.
    "ver" cuando la pregunta fue "¿ve el detalle?"). */
export function esAfirmacion(texto, extra = []) {
  const t = quitarTildes(String(texto).toLowerCase()).replace(/[.,;:!¿?¡]/g, "");
  const palabras = t.split(/\s+/).filter(Boolean);
  if (!palabras.length || palabras.includes("no")) return false;
  const afirmaciones = [...AFIRMACIONES_BASE, ...extra.map((e) => quitarTildes(e.toLowerCase()))];
  if (palabras.some((p) => afirmaciones.includes(p))) return true;
  return FRASES_AFIRMATIVAS.some((f) => t.includes(f));
}

/** ¿La respuesta es un "no" limpio? (primera palabra, no en cualquier
    parte de la frase, para no confundir "no sé, tal vez" con un cierre). */
export function esNegacion(texto) {
  const t = quitarTildes(String(texto).toLowerCase()).replace(/[.,;:!¿?¡]/g, "");
  const palabras = t.split(/\s+/).filter(Boolean);
  return palabras[0] === "no";
}
