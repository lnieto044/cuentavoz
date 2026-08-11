/** Puerto a JavaScript de backend/servicios/interprete.py: el mismo
    reconocimiento de números en palabras e intenciones frecuentes, pero
    corriendo en el navegador en vez del servidor - para que el modo sin
    conexión entienda texto escrito de verdad (no solo un formulario
    numérico) incluso con la red completamente apagada, cero llamadas al
    backend. Mantener esto en sincronía con interprete.py a mano: no hay
    una fuente única compartida entre Python y JS todavía.

    No reemplaza a Gemini ni al intérprete del servidor: es el mismo
    respaldo de última instancia, ahora también disponible sin backend. */

const NUMEROS = new Map(Object.entries({
  cero: 0, un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4,
  cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, "dieciséis": 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veinticinco: 25, treinta: 30,
  cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, quinientos: 500, mil: 1000,
}));

const UNIDADES = new Map(Object.entries({
  kilo: "Kilogram", kilos: "Kilogram", kilogramo: "Kilogram",
  kilogramos: "Kilogram", kg: "Kilogram",
  litro: "Liter", litros: "Liter", l: "Liter",
  unidad: "Unidad", unidades: "Unidad",
  porcion: "Portion", porciones: "Portion", "porción": "Portion",
}));

const DECENAS = [20, 30, 40, 50, 60, 70, 80, 90];
const CANONICAS = new Set(["Kilogram", "Liter", "Unidad", "Portion"]);

const RE_NUMERO_DIGITOS = /-?\d+(?:[.,]\d+)?/;
const RE_PUNTUACION_BORDE = /^[.,¿?¡!]+|[.,¿?¡!]+$/g;

function quitarPuntuacion(palabra) {
  return palabra.replace(RE_PUNTUACION_BORDE, "");
}

/** La PRIMERA cantidad de la frase. Ignora números que son parte del
    nombre del producto («cazuela 16 onzas», «tabla 50x38»). */
function numero(texto) {
  const t = texto.toLowerCase();
  const m = RE_NUMERO_DIGITOS.exec(t);
  if (m) {
    const val = parseFloat(m[0].replace(",", "."));
    return t.slice(0, m.index).includes("menos") ? -val : val;
  }

  const palabras = t.trim().split(/\s+/).filter(Boolean).map(quitarPuntuacion);
  let total = null;
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i];
    if (!NUMEROS.has(p)) continue;
    const v = NUMEROS.get(p);
    total = v;
    // «ciento ochenta»: centena seguida de decena
    if (total >= 100 && i + 1 < palabras.length && NUMEROS.has(palabras[i + 1])) {
      const sig = NUMEROS.get(palabras[i + 1]);
      if (sig < 100) total += sig;
    // «treinta y cinco»: decena + y + unidad
    } else if (DECENAS.includes(total) && i + 2 < palabras.length
               && palabras[i + 1] === "y" && NUMEROS.has(palabras[i + 2])) {
      total += NUMEROS.get(palabras[i + 2]);
    }
    break;   // lo demas pertenece al nombre del producto
  }
  if (total !== null && t.includes("menos")) total = -Math.abs(total);
  return total;
}

function unidad(texto) {
  for (let p of texto.toLowerCase().replace(/\?/g, " ").trim().split(/\s+/)) {
    p = p.replace(/^[.,]+|[.,]+$/g, "");
    if (UNIDADES.has(p)) return UNIDADES.get(p);
  }
  return null;
}

/** Lo que sea que devuelva el agente (humano o el modelo) para la unidad,
    lo lleva a uno de los 4 valores canónicos de la base de datos. */
export function normalizarUnidad(dicha) {
  if (!dicha) return dicha;
  if (CANONICAS.has(dicha)) return dicha;
  const clave = String(dicha).trim().toLowerCase();
  return UNIDADES.has(clave) ? UNIDADES.get(clave) : dicha;
}

const PALABRAS_FUERA = new Set([
  ...NUMEROS.keys(), ...UNIDADES.keys(),
  "de", "del", "la", "el", "los", "las", "hay", "en", "y", "por",
  "confirmo", "confirmar", "son", "hoy", "preparamos", "quiero",
  "pedir", "insumos", "para", "cuanto", "cuánto", "cuantos",
  "iniciar", "conteo", "abrir", "bodega", "corregir", "ultimo",
  "último", "no", "uy", "que", "qué", "me", "genera", "generame",
  "consolidado", "reporte", "ayuda", "menos", "onzas", "onza",
]);

function sinRuido(t) {
  const sinDigitos = t.replace(RE_NUMERO_DIGITOS, " ");
  return sinDigitos.trim().split(/\s+/).filter(Boolean)
    .filter((w) => !PALABRAS_FUERA.has(quitarPuntuacion(w)))
    .join(" ").trim();
}

const contiene = (f, claves) => claves.some((k) => f.includes(k));

/** El mismo respaldo de última instancia que interprete.py, corriendo en
    el navegador: entiende lo básico sin backend ni internet. */
export function interpretarLocal(frase) {
  const f = frase.toLowerCase().trim();
  const cant = numero(f);
  const uni = unidad(f);

  if (contiene(f, ["iniciar conteo", "abrir bodega", "abrir la bodega"])) {
    return { intencion: "navegar", bodega_texto: sinRuido(f),
             respuesta_hablada: "Voy a abrir esa bodega." };
  }
  if (contiene(f, ["preparamos", "vamos a preparar", "pedir insumos"])) {
    return { intencion: "pedir", preparacion: sinRuido(f),
             porciones: cant ? Math.trunc(cant) : 0,
             respuesta_hablada: "Le calculo los insumos según la receta." };
  }
  if (f.startsWith("confirmo") || ["confirmar", "si", "sí", "correcto", "confirmo."].includes(f)) {
    return { intencion: "confirmar", respuesta_hablada: "Listo." };
  }
  if (contiene(f, ["corregir", "no son", "no, son", "uy no", "uy, no",
                   "esta mal", "está mal", "me equivoque", "cambiar"])) {
    return { intencion: "corregir", cantidad: cant, unidad: uni,
             respuesta_hablada: "Corrijo ese registro." };
  }
  if (contiene(f, ["cuanto", "cuánto", "cuantos", "donde hay", "dónde hay"])) {
    return { intencion: "consultar", articulo_texto: sinRuido(f),
             respuesta_hablada: "Reviso el inventario." };
  }
  if (contiene(f, ["reporte", "consolidado", "archivo", "imprim"])) {
    return { intencion: "reporte", respuesta_hablada: "Genero el archivo." };
  }
  if (f.includes("ayuda") || f.includes("no entiendo")) {
    return { intencion: "ayuda", respuesta_hablada: "Con gusto. ¿Qué necesita saber?" };
  }
  if (cant !== null) {
    return { intencion: "contar", articulo_texto: sinRuido(f),
             cantidad: cant, unidad: uni, respuesta_hablada: "" };
  }
  return { intencion: "ayuda", respuesta_hablada: "Perdón, no le entendí bien. ¿Me lo repite?" };
}
