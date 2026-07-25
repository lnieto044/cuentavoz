"""Interprete local: permite demostrar el flujo aun sin llave de Gemini.

No reemplaza al modelo. Reconoce numeros en palabras y las intenciones
mas frecuentes, para que la demo nunca se caiga por falta de internet.
"""
import re

NUMEROS = {
    "cero": 0, "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "dieciseis": 16, "dieciséis": 16, "diecisiete": 17, "dieciocho": 18,
    "diecinueve": 19, "veinte": 20, "veinticinco": 25, "treinta": 30,
    "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70,
    "ochenta": 80, "noventa": 90, "cien": 100, "ciento": 100,
    "doscientos": 200, "quinientos": 500, "mil": 1000,
}
UNIDADES = {
    "kilo": "Kilogram", "kilos": "Kilogram", "kilogramo": "Kilogram",
    "kilogramos": "Kilogram", "kg": "Kilogram",
    "litro": "Liter", "litros": "Liter", "l": "Liter",
    "unidad": "Unidad", "unidades": "Unidad",
    "porcion": "Portion", "porciones": "Portion", "porción": "Portion",
}


DECENAS = (20, 30, 40, 50, 60, 70, 80, 90)


def _numero(texto: str):
    """La PRIMERA cantidad de la frase. Ignora numeros que son parte
    del nombre del producto («cazuela 16 onzas», «tabla 50x38»)."""
    t = texto.lower()
    m = re.search(r"-?\d+(?:[.,]\d+)?", t)
    if m:
        val = float(m.group(0).replace(",", "."))
        return -val if "menos" in t[:m.start()] else val

    palabras = [p.strip(".,¿?¡!") for p in t.split()]
    total = None
    for i, p in enumerate(palabras):
        if p not in NUMEROS:
            continue
        v = NUMEROS[p]
        if total is None:
            total = v
            # «ciento ochenta»: centena seguida de decena
            if total >= 100 and i + 1 < len(palabras) and palabras[i + 1] in NUMEROS:
                sig = NUMEROS[palabras[i + 1]]
                if sig < 100:
                    total += sig
            # «treinta y cinco»: decena + y + unidad
            elif total in DECENAS and i + 2 < len(palabras) \
                    and palabras[i + 1] == "y" and palabras[i + 2] in NUMEROS:
                total += NUMEROS[palabras[i + 2]]
            break        # lo demas pertenece al nombre del producto
    if total is not None and "menos" in t:
        total = -abs(total)
    return total


def _unidad(texto: str):
    for p in texto.lower().replace("?", " ").split():
        p = p.strip(".,")
        if p in UNIDADES:
            return UNIDADES[p]
    return None


def interpretar_local(frase: str) -> dict:
    f = frase.lower().strip()
    cant = _numero(f)
    uni = _unidad(f)

    def sin_ruido(t):
        t = re.sub(r"-?\d+(?:[.,]\d+)?", " ", t)
        fuera = set(NUMEROS) | set(UNIDADES) | {
            "de", "del", "la", "el", "los", "las", "hay", "en", "y", "por",
            "confirmo", "confirmar", "son", "hoy", "preparamos", "quiero",
            "pedir", "insumos", "para", "cuanto", "cuánto", "cuantos",
            "iniciar", "conteo", "abrir", "bodega", "corregir", "ultimo",
            "último", "no", "uy", "que", "qué", "me", "genera", "generame",
            "consolidado", "reporte", "ayuda", "menos", "onzas", "onza",
        }
        return " ".join(w for w in t.split() if w.strip(".,¿?¡!") not in fuera).strip()

    # ── intenciones ──
    if any(k in f for k in ("iniciar conteo", "abrir bodega", "abrir la bodega")):
        return {"intencion": "navegar", "bodega_texto": sin_ruido(f),
                "respuesta_hablada": "Voy a abrir esa bodega."}

    if any(k in f for k in ("preparamos", "vamos a preparar", "pedir insumos")):
        return {"intencion": "pedir", "preparacion": sin_ruido(f),
                "porciones": int(cant) if cant else 0,
                "respuesta_hablada": "Le calculo los insumos segun la receta."}

    if f.startswith("confirmo") or f in ("confirmar", "si", "sí", "correcto", "confirmo."):
        return {"intencion": "confirmar", "respuesta_hablada": "Listo."}

    if any(k in f for k in ("corregir", "no son", "no, son", "uy no", "uy, no",
                            "esta mal", "está mal", "me equivoque", "cambiar")):
        return {"intencion": "corregir", "cantidad": cant, "unidad": uni,
                "respuesta_hablada": "Corrijo ese registro."}

    if any(k in f for k in ("cuanto", "cuánto", "cuantos", "donde hay", "dónde hay")):
        return {"intencion": "consultar", "articulo_texto": sin_ruido(f),
                "respuesta_hablada": "Reviso el inventario."}

    if any(k in f for k in ("reporte", "consolidado", "archivo", "imprim")):
        return {"intencion": "reporte", "respuesta_hablada": "Genero el archivo."}

    if "ayuda" in f or "no entiendo" in f:
        return {"intencion": "ayuda",
                "respuesta_hablada": "Con gusto. ¿Que necesita saber?"}

    if cant is not None:
        return {"intencion": "contar", "articulo_texto": sin_ruido(f),
                "cantidad": cant, "unidad": uni, "respuesta_hablada": ""}

    return {"intencion": "ayuda",
            "respuesta_hablada": "Perdon, no le entendi bien. ¿Me lo repite?"}
