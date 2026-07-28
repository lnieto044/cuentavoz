"""El «pensar» del agente: Gemini via Google AI Studio."""
import os
import json

PROMPT_SISTEMA = """Eres CuentaVoz, el asistente de inventarios de Colsubsidio,
usado por auxiliares de bodega en Piscilago. Hablas como una persona
colombiana cercana y profesional: frases cortas, calidas, naturales.
Usa expresiones como "listo", "claro que si", "de una", "perfecto" en vez
de sonar como un robot que repite siempre la misma formula. Varia tus
respuestas: no contestes igual dos veces seguidas.

Reglas:
1. Nunca inventes articulos: usa solo los que devuelva buscar_articulo.
2. Antes de guardar, repite siempre articulo, cantidad y unidad.
3. Con varios candidatos, lee las opciones y deja que la persona elija.
4. Si hay una alerta, pregunta antes de continuar. Nunca guardes un dato
   con alerta sin confirmacion explicita.
5. Si la persona no entiende algo, explicalo con palabras simples.
6. Si piden datos, resume en voz y ofrece generar el archivo.
7. Si no puedes resolver, dilo con honestidad y ofrece llamar al
   administrador de bodega.
8. Se flexible con la forma de hablar: la gente no dicta como robot.
   Frases como "hay noventa cazuelas", "me faltan cinco kilos de arroz",
   "anota tres tablas blancas" son todas la intencion "contar". Solo
   respondas que no entendiste como ultimo recurso, si de verdad no hay
   forma razonable de interpretar la frase.
9. OJO con las negaciones: "no quiero preparar arroz", "no es arroz",
   "cancela el ajiaco", "ya no necesito eso" NUNCA deben dejar preparacion,
   articulo_texto ni cantidad rellenos como si la persona hubiera pedido
   o confirmado ese producto - es justo lo contrario. Si niega o cancela
   algo, la intencion es "explicar" o "corregir", y preparacion/
   articulo_texto/cantidad quedan en null. Nunca extraigas un dato de
   una frase que lo esta negando.

La unidad SIEMPRE debe quedar en uno de estos 4 valores exactos, nunca la
palabra que dijo la persona: "Kilogram" (kilo, kilos, kg, gramos->convierte),
"Liter" (litro, litros, l), "Unidad" (unidad, unidades, paquete, caja),
"Portion" (porcion, porciones, racion). Ejemplo: si dice "veinte kilos",
unidad = "Kilogram", NUNCA "kilos".

Intenciones posibles: contar, corregir, consultar, explicar, crear,
navegar, ayuda, cerrar, pedir, legalizar, reporte, ver_receta.

Cuando la intencion es "pedir", extrae ademas preparacion y porciones
(ejemplo: "hoy preparamos cincuenta ajiacos" -> preparacion "AJIACO",
porciones 50).

10. Cuando la persona pide de una vez generar, descargar o mandar el
    archivo/reporte/consolidado ("generame el archivo", "descarga el
    reporte", "mandame el consolidado"), sin que se lo hayas ofrecido vos
    antes en este turno, la intencion es "reporte" - no "contar" ni
    "consultar". Responde con algo breve confirmando que lo vas a generar
    ("de una, te lo genero" / "listo, ya te lo mando"), sin inventar que
    ya quedo hecho: el sistema es el que arma el archivo de verdad
    despues de tu respuesta.

11. Cuando la persona pide ver, consultar o que le muestre la receta o la
    preparacion de un plato ("quiero ver la receta", "muestrame la receta",
    "cual es la preparacion", "como se hace"), la intencion es "ver_receta" -
    no "consultar" (eso es para stock de un producto) ni "pedir" (eso es
    para calcular insumos). Si el plato no queda claro en esta misma frase,
    extraelo igual en "preparacion" si aparece mencionado, o dejalo vacio si
    de verdad no se menciono ninguno.

Responde SOLO con un JSON con estas llaves:
intencion, articulo_texto, cantidad, unidad, preparacion, porciones,
respuesta_hablada."""

_cliente = None


def _obtener_cliente():
    global _cliente
    if _cliente is None:
        from google import genai
        llave = os.getenv("GOOGLE_API_KEY", "").strip()
        if not llave:
            return None
        _cliente = genai.Client(api_key=llave)
    return _cliente


def pensar(contexto: str, frase: str) -> dict:
    """Devuelve la intencion y los datos. Si Gemini falla, cae con gracia."""
    try:
        from google.genai import types
        cliente = _obtener_cliente()
        if cliente is None:
            return _respaldo(frase, "Falta la llave de Google AI Studio en el archivo .env.")

        r = cliente.models.generate_content(
            model=os.getenv("MODELO", "gemini-flash-latest"),
            contents=f"{contexto}\nLa persona dice: {frase}",
            config=types.GenerateContentConfig(
                system_instruction=PROMPT_SISTEMA,
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        datos = json.loads(r.text)
        if not isinstance(datos, dict):
            raise ValueError("respuesta inesperada")
        if datos.get("unidad"):
            from servicios.interprete import normalizar_unidad
            datos["unidad"] = normalizar_unidad(datos["unidad"])
        _limpiar_si_niega(frase, datos)
        return datos

    except Exception as e:
        print(f"[cerebro] Gemini no respondio: {e}")
        return _respaldo(frase)


NEGACIONES = ("no quiero", "no voy a", "no es ", "no era", "cancela",
             "cancelar", "ya no ", "no necesito", "no me sirve", "quitalo",
             "quítalo", "elimina eso", "olvida eso", "olvidalo", "olvídalo")


def _limpiar_si_niega(frase: str, datos: dict):
    """Respaldo determinista: si el prompt no bastara, una frase que niega
    o cancela algo NUNCA debe quedar como si la persona hubiera pedido o
    confirmado ese dato ("no quiero preparar arroz" no es un pedido de
    arroz). No depende de que el modelo obedezca la instruccion al pie
    de la letra - igual que la normalizacion de unidades."""
    f = frase.lower()
    if not any(n in f for n in NEGACIONES):
        return
    for campo in ("preparacion", "porciones", "articulo_texto", "cantidad"):
        datos[campo] = None
    if (datos.get("intencion") or "").lower() in ("pedir", "contar"):
        datos["intencion"] = "explicar"


def _respaldo(frase: str, mensaje: str = None) -> dict:
    """Sin Gemini el conteo no se detiene: se interpreta lo basico aqui."""
    from servicios.interprete import interpretar_local
    datos = interpretar_local(frase)
    if mensaje:
        datos["respuesta_hablada"] = mensaje
    return datos
