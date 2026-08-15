"""El «pensar» del agente: Gemini via Google AI Studio."""
import os
import json
import io
import wave
import concurrent.futures

MODELO_VOZ = "gemini-2.5-flash-preview-tts"

# El SDK instalado (google-genai 0.3.0) no soporta timeout en HttpOptions
# todavia (es un TODO del propio paquete) - sin esto, una llamada lenta o
# con la cuota ahogada se queda esperando sin limite (confirmado: una
# prueba real tardo mas de 30 segundos), y la persona ve el microfono
# "pensando" sin saber si sigue vivo. Con este limite, si Gemini no
# contesta a tiempo, se cae al respaldo local de una vez en vez de dejar
# la voz esperando.
TIMEOUT_GEMINI = 7
_EJECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="gemini")


def _generar_con_limite(cliente, limite=TIMEOUT_GEMINI, **kwargs):
    futuro = _EJECUTOR.submit(cliente.models.generate_content, **kwargs)
    return futuro.result(timeout=limite)

# Voces neuronales de Gemini disponibles para elegir en Mi perfil. No son
# acentos de pais (Gemini TTS no expone eso todavia): son voces distintas,
# pero todas genuinamente humanas y fluidas - muy por encima de las voces
# "Desktop" clasicas del navegador, que es lo que se queria reemplazar.
VOCES = {
    "kore":   {"nombre": "Kore",   "etiqueta": "Femenina, firme y clara"},
    "aoede":  {"nombre": "Aoede",  "etiqueta": "Femenina, suave y cercana"},
    "puck":   {"nombre": "Puck",   "etiqueta": "Masculina, animada"},
    "charon": {"nombre": "Charon", "etiqueta": "Masculina, grave y pausada"},
}
VOZ_DEFECTO = "kore"

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

        r = _generar_con_limite(
            cliente,
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


PROMPT_ASISTENTE = """Eres CuentaVoz, el asistente de inventarios de
Colsubsidio. La persona esta en una pantalla de la aplicacion (no esta
contando ni armando un pedido) y le hace una pregunta o le pide ir a otra
pantalla. Hable como una persona colombiana cercana y profesional, en
frases cortas.

Reglas:
1. Responda SOLO con datos que aparezcan en el contexto que se le da. Si
   no tiene el dato, digalo con honestidad en vez de inventar un numero.
2. Si la persona pide ir a otra pantalla ("llevame a bodegas", "abre mi
   perfil", "muestrame los reportes"), la intencion es "navegar" y
   "destino" debe ser EXACTAMENTE una de las claves de la lista de
   pantallas disponibles del contexto - nunca invente una clave que no
   este ahi, y si la pantalla que piden no esta en la lista (por ejemplo
   porque su perfil no tiene acceso), dígalo en vez de forzar un destino.
3. Si no pide navegar, la intencion es "responder": conteste con el
   contexto que tiene, o explique brevemente que se hace en esta pantalla.
4. Nunca prometa una accion que esta pantalla no puede hacer todavia por
   voz (cambiar una configuracion, generar un archivo, aprobar algo): solo
   responde preguntas y navega. Si se lo piden, dígalo con claridad y
   sugiera usar los botones de la pantalla.
5. Algunas pantallas tienen pestañas propias (se listan en el contexto
   como "destino > pestaña"). Si la persona pide una pestaña especifica
   ("llevame al analisis de consumo", "abre la gestion de usuarios"), no
   se queda a medio camino: pone el destino correcto Y "pestana" con la
   clave exacta de esa pestaña, para llegar directo sin dar clic despues.
   Si solo pide la pantalla en general, sin mencionar pestaña, deje
   "pestana" en null - no adivine una.
6. Si lo que dice la persona no es una pregunta clara ni una orden
   reconocible (una palabra suelta sin sentido para esta pantalla, algo
   en otro idioma, texto que parece ruido o un eco del reconocimiento de
   voz), digalo con honestidad ("no le entendi eso" o similar) en vez de
   responder de una con la explicacion general de la pantalla como si la
   hubiera pedido - no finja haber entendido una pregunta que no hicieron.

Responde SOLO con un JSON con estas llaves: intencion (navegar|responder),
destino, pestana, respuesta_hablada."""


def pensar_asistente(contexto: str, frase: str, destinos: dict[str, str],
                     pestanas: dict[str, dict[str, str]] | None = None) -> dict:
    """Version liviana de pensar(), para las pantallas que no son de
    conteo ni de pedido (Inicio, Ajustes, Ayuda, Reportes, Panel): mismo
    modelo y mismo cliente, pero un prompt propio y mas simple - sin el
    estado de "pendiente"/"opciones" que solo tiene sentido a mitad de un
    conteo o de un pedido en curso. pestanas permite pedir de una vez una
    pestaña especifica de un destino con pestañas propias (ver main.py)."""
    pestanas = pestanas or {}
    lista = "\n".join(f"- {clave}: {etiqueta}" for clave, etiqueta in destinos.items())
    for destino, sub in pestanas.items():
        for clave_tab, etiqueta_tab in sub.items():
            lista += f"\n- {destino} > {clave_tab}: {etiqueta_tab}"
    contexto_completo = f"{contexto}\nPantallas disponibles para navegar:\n{lista}"
    try:
        from google.genai import types
        cliente = _obtener_cliente()
        if cliente is None:
            return _respaldo_asistente(frase, destinos,
                                       "Sin conexión con el agente en este momento.")
        r = _generar_con_limite(
            cliente,
            model=os.getenv("MODELO", "gemini-flash-latest"),
            contents=f"{contexto_completo}\nLa persona dice: {frase}",
            config=types.GenerateContentConfig(
                system_instruction=PROMPT_ASISTENTE,
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        datos = json.loads(r.text)
        if not isinstance(datos, dict):
            raise ValueError("respuesta inesperada")
        return datos
    except Exception as e:
        print(f"[cerebro] Asistente sin Gemini: {e}")
        return _respaldo_asistente(frase, destinos)


def _respaldo_asistente(frase: str, destinos: dict[str, str], mensaje: str = None) -> dict:
    """Sin Gemini, al menos reconoce «lleveme a <pantalla>» por palabra
    clave - el resto queda honesto (no inventa una respuesta) en vez de
    fingir que entendio. No intenta adivinar la pestaña sin el modelo."""
    f = frase.lower()
    for clave, etiqueta in destinos.items():
        if clave in f or etiqueta.lower() in f:
            return {"intencion": "navegar", "destino": clave, "pestana": None,
                    "respuesta_hablada": f"Vamos a {etiqueta.lower()}."}
    return {"intencion": "responder", "destino": None, "pestana": None,
            "respuesta_hablada": mensaje or
            "No pude entenderlo sin conexión al agente. Puede escribir su pregunta."}


def _pcm_a_wav(pcm: bytes, tasa: int = 24000, canales: int = 1, bits: int = 16) -> bytes:
    """Gemini TTS devuelve PCM crudo (sin encabezado): el navegador
    necesita un WAV valido para poder reproducirlo con <audio>/Audio()."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(canales)
        w.setsampwidth(bits // 8)
        w.setframerate(tasa)
        w.writeframes(pcm)
    return buf.getvalue()


def sintetizar_voz(texto: str, voz: str = VOZ_DEFECTO) -> bytes | None:
    """Convierte texto a un WAV con voz neuronal real. None si Gemini no
    esta disponible - quien llama decide si cae de respaldo a la voz del
    navegador (que suena distinta a la elegida en Mi perfil, asi que cada
    caida de vuelta ahi es una voz distinta hablando a mitad de sesion)."""
    cliente = _obtener_cliente()
    if cliente is None or not texto.strip():
        return None
    nombre_voz = VOCES.get(voz, VOCES[VOZ_DEFECTO])["nombre"]
    from google.genai import types
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=nombre_voz)
            )
        ),
    )
    # Un reintento, y solo si la primera vez se agoto el tiempo (se ha visto
    # que Gemini a veces tarda una vez bajo carga y responde rapido la
    # siguiente) - no ante cualquier otra falla (cuota agotada, por
    # ejemplo), donde insistir de una solo suma espera sin cambiar el
    # resultado y hace mas notoria la caida a la voz del navegador.
    for intento, limite in ((1, 12), (2, 6)):
        try:
            r = _generar_con_limite(cliente, limite=limite, model=MODELO_VOZ,
                                     contents=texto, config=config)
            parte = r.candidates[0].content.parts[0].inline_data
            return _pcm_a_wav(parte.data)
        except concurrent.futures.TimeoutError as e:
            print(f"[cerebro] Voz neuronal tardo demasiado (intento {intento}): {e}")
            continue
        except Exception as e:
            print(f"[cerebro] Voz neuronal no disponible: {e}")
            return None
    return None
