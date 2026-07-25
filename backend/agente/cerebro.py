"""El «pensar» del agente: Gemini via Google AI Studio."""
import os
import json

PROMPT_SISTEMA = """Eres CuentaVoz, el asistente de inventarios de Colsubsidio.
Hablas espanol claro, en frases cortas, con respeto y calidez.

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

Intenciones posibles: contar, corregir, consultar, explicar, crear,
navegar, ayuda, cerrar, pedir, legalizar.

Cuando la intencion es "pedir", extrae ademas preparacion y porciones
(ejemplo: "hoy preparamos cincuenta ajiacos" -> preparacion "AJIACO",
porciones 50).

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
            model=os.getenv("MODELO", "gemini-2.0-flash"),
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
        return datos

    except Exception as e:
        print(f"[cerebro] Gemini no respondio: {e}")
        return _respaldo(frase)


def _respaldo(frase: str, mensaje: str = None) -> dict:
    """Sin Gemini el conteo no se detiene: se interpreta lo basico aqui."""
    from servicios.interprete import interpretar_local
    datos = interpretar_local(frase)
    if mensaje:
        datos["respuesta_hablada"] = mensaje
    return datos
