# Cómo se construyó el agente conversacional
*(lectura: menos de 1 minuto)*

El agente no es un solo archivo — son tres capas, cada una con un trabajo distinto:

**1. Entender** — `backend/agente/cerebro.py`
La frase de la persona va a Gemini con un system prompt que fija la
personalidad («habla como alguien colombiano, cercano y profesional») y una
regla dura: responder siempre con el mismo JSON (intención, artículo,
cantidad, unidad, receta, respuesta hablada). Sin llave de Gemini configurada,
cae a un intérprete local (`servicios/interprete.py`, reglas + números en
palabras) para que la demo nunca se quede muda.

**2. Decidir** — `backend/agente/orquestador.py`
Con la intención ya extraída, decide qué hacer: busca el artículo real contra
el catálogo oficial (`servicios/conciliacion.py`, fuzzy match — «tabla para
picar blanca» → el código exacto), valida la cantidad
(`servicios/validacion.py` — negativos, unidad equivocada, desviación fuera
de rango) y, si todo cuadra, guarda; si no, deja la alerta y pregunta antes
de continuar. Nunca guarda un dato con alerta sin confirmación explícita.

**3. Hablar** — `backend/agente/cerebro.py` otra vez
La misma llave de Gemini genera la voz de la respuesta con un modelo
neuronal real (no la voz del navegador), para que la conversación se sienta
humana de punta a punta.

```
persona habla → cerebro.py (Gemini) → orquestador.py (decide) → guarda / pregunta
                       ↓
                 respuesta hablada (Gemini TTS)
```
