"""Donde el pensar se vuelve accion. El agente propone, el backend dispone."""
from datetime import datetime
from bd import Sesion
from modelos import Conteo, StockSistema, SesionConteo, Bodega, Alerta, Articulo
from servicios.conciliacion import buscar_articulo, aprender_alias
from servicios.validacion import validar_conteo
from agente.cerebro import pensar

ESTADOS: dict[int, dict] = {}          # memoria viva por sesion

ALTA = 90
MEDIA = 60


def procesar_turno(texto: str, sesion_id: int, usuario=None,
                   opciones_respaldo=None, opciones_para_respaldo=None,
                   bodega_id_respaldo=None, bodega_nombre_respaldo=None,
                   preparacion_respaldo=None, porciones_respaldo=None) -> dict:
    est = ESTADOS.setdefault(sesion_id, {})
    # el frontend usa sesion_id negativo para la conversacion de Pedidos,
    # que no tiene bodega fisica que abrir - ver Pedido.jsx.
    modo_pedido = sesion_id < 0

    # resiliencia: si el backend se reinicio (se pierde ESTADOS en memoria)
    # justo mientras la persona tenia una pregunta de "¿cual de los dos?"
    # pendiente, el frontend ya sabe cuales eran las opciones - se las
    # recuerda al backend en vez de dejar que pregunte lo mismo otra vez
    # sin ningun recuerdo de la conversacion.
    if opciones_respaldo and not est.get("opciones"):
        est["opciones"] = opciones_respaldo
        est["opciones_para"] = opciones_para_respaldo or "consultar"

    # el mismo respaldo, para la bodega abierta: sin esto, un reinicio del
    # backend a mitad de un conteo deja el frontend mostrando "en conteo"
    # con la bodega en el titulo, mientras el servidor ya no tiene
    # bodega_id - el agente termina diciendo "no hay ninguna bodega
    # activa" aunque en pantalla se vea abierta, y "contar" cae en el
    # caso de "articulo no encontrado" para cualquier cosa que se dicte.
    if bodega_id_respaldo and not est.get("bodega_id"):
        est["bodega_id"] = bodega_id_respaldo
        est["bodega_nombre"] = bodega_nombre_respaldo or est.get("bodega_nombre")

    # el mismo respaldo, para el plato y las porciones del pedido: el chef
    # casi siempre los dicta en dos frases separadas ("arroz con pollo" y
    # luego "para cuatro"), asi que sin esto un reinicio de por medio deja
    # al agente sin memoria del plato aunque la pantalla lo siga mostrando.
    if preparacion_respaldo and not est.get("preparacion"):
        est["preparacion"] = preparacion_respaldo
    if porciones_respaldo and not est.get("porciones"):
        est["porciones"] = porciones_respaldo

    bodega_id = est.get("bodega_id")

    if modo_pedido:
        contexto = ("Estamos en el modulo de Pedidos: aqui se dicta el plato y las "
                    "porciones para calcular insumos por receta, y se puede consultar "
                    "el stock de un producto. NUNCA se abre ni se cuenta una bodega "
                    "fisica aqui - eso es en el modulo de Conteo, no lo mencione. ")
        # sin esto, Gemini no tiene memoria entre turnos: si el plato se dijo
        # dos frases atras y esta ahora solo llegan las porciones, vuelve a
        # preguntar "¿de que plato estamos hablando?" como si nunca se
        # hubiera dicho - la persona termina repitiendo lo mismo varias veces.
        if est.get("preparacion"):
            contexto += f"El plato ya lo dijo antes: {est['preparacion']}. "
        if est.get("porciones"):
            contexto += f"Las porciones ya las dijo antes: {est['porciones']:g}. "
        if est.get("preparacion") or est.get("porciones"):
            contexto += ("No vuelva a preguntar por el plato ni las porciones si ya "
                        "aparecen arriba: siga adelante con lo que falte, o confirme "
                        "que ya tiene todo. ")
    else:
        contexto = f"Bodega activa: {est.get('bodega_nombre') or 'ninguna'}. "
    if est.get("pendiente"):
        p = est["pendiente"]
        contexto += f"Pendiente de confirmar: {p['nombre']} {p['cantidad']:g}. "
    if est.get("opciones"):
        contexto += "Opciones ofrecidas: " + ", ".join(
            o["nombre"] for o in est["opciones"]) + ". "

    turno = pensar(contexto, texto)
    turno.setdefault("respuesta_hablada", "")
    intencion = (turno.get("intencion") or "").lower()

    if modo_pedido:
        # guarda lo nuevo que se haya dicho esta vez, y si esta vez no vino
        # nada, rellena con lo que ya se sabia - asi el frontend no pierde
        # de vista el plato solo porque este turno hablo unicamente de las
        # porciones (o al reves).
        if turno.get("preparacion"):
            if est.get("preparacion") and turno["preparacion"] != est["preparacion"]:
                # cambio de plato: las porciones del plato anterior no sirven
                # para este - hay que volver a preguntar, no asumir el mismo
                # numero (ej. si antes eran 4 porciones de ajiaco, un sancocho
                # nuevo no tiene por que ser tambien 4).
                est["porciones"] = None
            est["preparacion"] = turno["preparacion"]
        elif est.get("preparacion"):
            turno["preparacion"] = est["preparacion"]
        if turno.get("porciones"):
            est["porciones"] = turno["porciones"]
        elif est.get("porciones"):
            turno["porciones"] = est["porciones"]
    if modo_pedido and intencion == "contar":
        # en Pedidos nunca se registra un conteo fisico: mencionar un
        # producto aqui solo consulta su stock, no lo cuenta.
        intencion = "consultar"
        turno["intencion"] = "consultar"

    palabras = texto.lower().replace(",", " ").replace(".", " ").split()
    dice_si = (any(p in ("si", "sí", "claro", "listo", "dale", "correcto")
                   for p in palabras)
               or any(k in texto.lower() for k in
                      ("confirmo", "confirmar", "asi es", "así es", "eso es")))
    dice_no = ("no" in palabras
               or any(k in texto.lower() for k in
                      ("no gracias", "mejor no", "tampoco", "no por ahora")))

    # ── 0) declina lo que se le esta preguntando (oferta de archivo o
    # "¿cual de los dos?"): sin esto, un "no" caia en cualquier intencion que
    # Gemini le hubiera adivinado a esa palabra sola (a veces "corregir"), y
    # el agente terminaba preguntando algo sin relacion como "¿cual es el
    # valor correcto?" - la conversacion quedaba trabada en un tema que la
    # persona ya habia cerrado.
    if dice_no and not est.get("pendiente"):
        if est.get("oferta_reporte") and not est.get("opciones"):
            est["oferta_reporte"] = False
            turno["intencion"] = "explicar"
            turno["respuesta_hablada"] = "Listo, no genero nada. ¿Algo más en lo que le ayude?"
            return turno
        if est.get("opciones"):
            est["opciones"] = None
            est.pop("opciones_para", None)
            turno["intencion"] = "explicar"
            turno["respuesta_hablada"] = "Listo, cancelado. ¿En qué más le ayudo?"
            return turno

    # ── 1) confirma lo pendiente: aqui si se guarda ──
    if est.get("pendiente") and (dice_si or intencion == "confirmar"):
        return _guardar(est, sesion_id, usuario)

    # ── 1b) confirma la oferta de generar el archivo tras una consulta ──
    if (est.get("oferta_reporte") and not est.get("pendiente")
            and not est.get("opciones")
            and (dice_si or intencion in ("confirmar", "reporte"))):
        est["oferta_reporte"] = False
        return _generar_reporte_voz(usuario)

    # ── 1c) pide generar el archivo de una vez, sin que se le haya
    # ofrecido antes: "generame el archivo" dicho de la nada. Sin esto el
    # agente respondia con un mensaje que sonaba a que si lo iba a hacer
    # ("de una, te lo genero") pero nunca llamaba a generar nada de
    # verdad - la persona se quedaba con el mensaje y ningun archivo.
    if intencion == "reporte" and not est.get("pendiente") and not est.get("opciones"):
        if getattr(usuario, "perfil", None) != "auditor":
            turno["respuesta_hablada"] = ("Generar el consolidado lo hace el "
                                          "administrador de bodega; avísele.")
            return turno
        return _generar_reporte_voz(usuario)

    # confirma sin nada pendiente: hay que decirlo, no fingir que guardo
    if (dice_si or intencion == "confirmar") and not est.get("pendiente"):
        if est.get("opciones"):
            turno["respuesta_hablada"] = _leer_opciones(est["opciones"])
            turno["opciones"] = est["opciones"]
            turno["opciones_para"] = est.get("opciones_para")
        elif modo_pedido:
            turno["respuesta_hablada"] = ("No hay nada pendiente de confirmar. Dígame "
                                          "el plato y las porciones, o pregúnteme por "
                                          "un producto.")
        elif not bodega_id:
            turno["respuesta_hablada"] = ("Primero abra una bodega: diga "
                                          "«iniciar conteo en» y el nombre.")
        else:
            turno["respuesta_hablada"] = ("No hay nada pendiente de confirmar. "
                                          "Dicteme el producto y la cantidad.")
        return turno

    # ── 2) habia opciones y eligio una ──
    if est.get("opciones"):
        elegido = _elegir(texto, est["opciones"])
        if elegido:
            para = est.pop("opciones_para", "contar")
            est["opciones"] = None
            if para == "consultar":
                turno["respuesta_hablada"] = resumen_stock(elegido)
                turno["producto_consultado"] = {"codigo": elegido["codigo"],
                                                "nombre": elegido["nombre"],
                                                "unidad": elegido["unidad"]}
                est["oferta_reporte"] = True
                return turno
            return _dejar_pendiente(est, elegido, est.get("cantidad", 1), texto, turno)

    # ── 3) abrir bodega ──
    if intencion == "navegar":
        est["oferta_reporte"] = False
        if modo_pedido:
            turno["respuesta_hablada"] = ("Aquí en Pedidos no se abren bodegas, eso es "
                                          "en el módulo de Conteo. Dígame el plato y las "
                                          "porciones, o pregúnteme por un producto.")
            return turno
        return _abrir(est, turno.get("bodega_texto") or texto, turno, usuario)

    # ── 4) contar ──
    if intencion == "contar":
        est["oferta_reporte"] = False
        if not modo_pedido and not bodega_id:
            # sin bodega abierta no hay donde guardar un conteo: decirlo,
            # no ofrecer crear un producto nuevo con lo que se haya oido.
            turno["respuesta_hablada"] = ("Primero abra una bodega: diga "
                                          "«iniciar conteo en» y el nombre.")
            return turno
        cand = buscar_articulo(turno.get("articulo_texto") or texto, bodega_id)
        if not cand:
            turno["respuesta_hablada"] = ("No encontre ese articulo en el catalogo. "
                                          "¿Lo creamos? Quedara pendiente de aprobacion.")
            turno["intencion"] = "crear"
            return turno
        est["cantidad"] = turno.get("cantidad") or 1
        est["unidad_dicha"] = turno.get("unidad")
        resultado, dato = _resolver_candidato(cand)
        if resultado == "directo":
            return _dejar_pendiente(est, dato, est["cantidad"], texto, turno)
        if resultado == "ambiguo":
            est["opciones"] = dato
            est["opciones_para"] = "contar"
            turno["opciones"] = dato
            turno["opciones_para"] = "contar"
            turno["respuesta_hablada"] = _leer_opciones(dato)
            return turno
        turno["respuesta_hablada"] = ("No estoy seguro de cual es. "
                                      "¿Me lo repite o lo deletrea?")
        return turno

    # ── 5) corregir el ultimo ──
    if intencion == "corregir":
        est["oferta_reporte"] = False
        return _corregir(est, sesion_id, turno, usuario)

    # ── 5b) ver la receta / preparacion de un plato, por voz ──
    if intencion == "ver_receta" and modo_pedido:
        plato_pedido = turno.get("preparacion") or est.get("preparacion")
        if not plato_pedido:
            turno["respuesta_hablada"] = "¿La receta de qué plato quiere ver?"
            return turno
        from servicios.recetas import detalle_receta
        r = detalle_receta(plato_pedido)
        if not r:
            turno["respuesta_hablada"] = (f"No encontré una receta para «{plato_pedido}». "
                                          "Pruebe con ajiaco o sancocho.")
            return turno
        turno["receta"] = r
        n_ing = len(r.get("lineas", []))
        turno["respuesta_hablada"] = (f"Aquí tiene la receta de {r['nombre'].lower()}: "
                                      f"{n_ing} ingredientes" +
                                      (" y la preparación paso a paso." if r.get("preparacion")
                                       else ".") +
                                      " ¿Calculamos el pedido con esta receta?")
        return turno

    # ── 6) consultar ──
    if intencion == "consultar":
        texto_busqueda = turno.get("articulo_texto")
        if not texto_busqueda:
            # sin un producto nombrado no hay que buscar - "consultemos el
            # stock" a secas no es el nombre de ningun articulo, y antes esto
            # caia en buscar_articulo(texto) completo, que a veces por pura
            # coincidencia de letras encontraba un producto sin relacion.
            turno["respuesta_hablada"] = "¿El stock de qué producto quiere consultar?"
            return turno
        cand = buscar_articulo(texto_busqueda)
        if not cand:
            turno["respuesta_hablada"] = ("No encontre ese articulo en el catalogo. "
                                          "¿Me dice otro producto?")
            return turno
        resultado, dato = _resolver_candidato(cand)
        if resultado == "ambiguo":
            est["opciones"] = dato
            est["opciones_para"] = "consultar"
            turno["opciones"] = dato
            turno["opciones_para"] = "consultar"
            turno["respuesta_hablada"] = _leer_opciones(dato)
            return turno
        if resultado == "no_seguro":
            turno["respuesta_hablada"] = "No estoy seguro de cual articulo es. ¿Me lo repite?"
            return turno
        turno["respuesta_hablada"] = resumen_stock(dato)
        turno["producto_consultado"] = {"codigo": dato["codigo"], "nombre": dato["nombre"],
                                        "unidad": dato["unidad"]}
        est["oferta_reporte"] = True
        return turno

    # ── 7) avance ──
    if "falta" in texto.lower() or "avance" in texto.lower():
        turno["respuesta_hablada"] = avance(sesion_id)
        return turno

    if not turno["respuesta_hablada"]:
        turno["respuesta_hablada"] = "Perdon, no le entendi bien. ¿Me lo repite?"
    return turno


# ─────────────────────────── auxiliares ───────────────────────────
def _resolver_candidato(cand):
    """Decide si hay un ganador claro, si hay que preguntar, o si no hay
    certeza. Un puntaje alto NO basta para decidir solo: si el segundo
    candidato esta empatado o casi (como ARROZ contra ARROZ BASMATI, los
    dos al 100 cuando solo se dice «arroz»), ahi es donde el agente se
    confunde de producto sin que la persona se de cuenta. Por eso siempre
    se compara el primero contra el segundo, no el primero solo."""
    if not cand:
        return "vacio", None
    if len(cand) == 1:
        # un solo candidato no es garantia de que sea el correcto: puede ser
        # el unico que paso el filtro de buscar_articulo con una coincidencia
        # debil (ej. "consultemos" comparte raiz con "consumibles"). Sin este
        # piso, ese empate a una sola opcion se daba por bueno igual.
        if cand[0]["confianza"] < MEDIA:
            return "no_seguro", None
        return "directo", cand[0]
    if cand[0]["confianza"] < MEDIA:
        return "no_seguro", None
    if cand[0]["confianza"] >= ALTA and (cand[0]["confianza"] - cand[1]["confianza"]) >= 15:
        return "directo", cand[0]
    return "ambiguo", cand[:2]


def _leer_opciones(cand):
    return ("Tengo dos parecidos: " + cand[0]["nombre"] + " o " +
            cand[1]["nombre"] + ". ¿Cual de los dos?")


def _dejar_pendiente(est, art, cantidad, texto, turno):
    v = validar_conteo(art["codigo"], cantidad, est.get("unidad_dicha"),
                       est.get("bodega_id"))
    est["pendiente"] = {"articulo_codigo": art["codigo"], "nombre": art["nombre"],
                        "cantidad": cantidad, "unidad": art["unidad"],
                        "texto_original": texto,
                        "alerta": None if v["ok"] else v["tipo"],
                        "detalle_alerta": None if v["ok"] else v["mensaje"]}
    if v["ok"]:
        turno["respuesta_hablada"] = (f"{art['nombre']}: {cantidad:g} "
                                      f"{art['unidad']}. ¿Confirma?")
    else:
        turno["respuesta_hablada"] = v["mensaje"]
        turno["alerta"] = v["tipo"]
        if v["tipo"] == "desviacion":
            # datos limpios para la tarjeta "Contexto de la validacion":
            # antes solo iban mezclados dentro de la frase hablada.
            esperado = v.get("esperado") or 0
            desviacion_pct = round((cantidad - esperado) / esperado * 100) if esperado else None
            turno["contexto_alerta"] = {
                "esperado": esperado, "dicho": cantidad, "unidad": art["unidad"],
                "articulo": art["nombre"], "desviacion_pct": desviacion_pct,
            }
        if v["tipo"] in ("negativo", "unidad", "inexistente"):
            est["pendiente"] = None          # no se puede guardar: hay que repetir
            # el intento no se guarda como conteo, pero si queda como alerta
            # de gestion - antes se perdia sin dejar rastro para el panel
            bodega = est.get("bodega_nombre") or "sin bodega"
            with Sesion() as s:
                s.add(Alerta(conteo_id=None, tipo=v["tipo"],
                             detalle=f"{bodega} · {art['nombre']}: {v['mensaje']}"))
                s.commit()
    turno["pendiente"] = est.get("pendiente") and {
        "nombre": art["nombre"], "cantidad": cantidad, "unidad": art["unidad"]}
    return turno


def _guardar(est, sesion_id, usuario):
    from seguridad import registrar
    c = est.pop("pendiente")
    with Sesion() as s:
        reg = Conteo(sesion_id=sesion_id, articulo_codigo=c["articulo_codigo"],
                     cantidad=c["cantidad"], unidad=c["unidad"],
                     estado="confirmado")
        s.add(reg)
        s.commit()
        s.refresh(reg)
        if c.get("alerta"):
            s.add(Alerta(conteo_id=reg.id, tipo=c["alerta"],
                         detalle=c["detalle_alerta"] or ""))
            s.commit()
        est["ultimo_id"] = reg.id
    aprender_alias(c.get("texto_original", ""), c["articulo_codigo"],
                   est.get("bodega_id"))
    if usuario:
        registrar(usuario, "CONTEO",
                  f"{c['nombre']}: {c['cantidad']:g} {c['unidad']}")
    return {"intencion": "guardado",
            "respuesta_hablada": "Guardado. " + avance(sesion_id),
            "guardado": True}


def _corregir(est, sesion_id, turno, usuario):
    """Corrige lo que esta pendiente; si no hay nada pendiente, el ultimo guardado."""
    from seguridad import registrar
    nueva = turno.get("cantidad")
    if nueva is None:
        turno["respuesta_hablada"] = "¿Cual es el valor correcto?"
        return turno

    # 1) lo mas comun: la persona corrige antes de confirmar («uy, no: son nueve»)
    p = est.get("pendiente")
    if p:
        art = {"codigo": p["articulo_codigo"], "nombre": p["nombre"],
               "unidad": p["unidad"]}
        est["cantidad"] = nueva
        return _dejar_pendiente(est, art, nueva, p.get("texto_original", ""), turno)

    # 2) si ya se habia guardado, se crea un registro que apunta al original
    ultimo_id = est.get("ultimo_id")
    if not ultimo_id:
        turno["respuesta_hablada"] = "Todavia no hay un registro que corregir."
        return turno
    with Sesion() as s:
        orig = s.get(Conteo, ultimo_id)
        if orig is None:
            turno["respuesta_hablada"] = "No encuentro ese registro."
            return turno
        orig.estado = "corregido"                   # nada se borra
        nuevo = Conteo(sesion_id=sesion_id, articulo_codigo=orig.articulo_codigo,
                       cantidad=nueva, unidad=orig.unidad,
                       estado="confirmado", corrige_a=orig.id)
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        est["ultimo_id"] = nuevo.id
        art = s.get(Articulo, orig.articulo_codigo)
        nombre = art.nombre_oficial if art else orig.articulo_codigo
    if usuario:
        registrar(usuario, "CORRECCION",
                  f"{nombre}: {orig.cantidad:g} -> {nueva:g} "
                  f"(valor anterior conservado)", "alerta")
    turno["respuesta_hablada"] = f"Corregido a {nueva:g}. Quedo registrado."
    turno["corregido"] = True
    return turno


def _abrir(est, texto_bodega, turno, usuario):
    from seguridad import registrar
    with Sesion() as s:
        b = (s.query(Bodega)
             .filter(Bodega.nombre_oficial.contains(texto_bodega.upper()))
             .first())
        if b is None:
            palabras = [p for p in texto_bodega.upper().split() if len(p) > 3]
            for p in palabras:
                b = s.query(Bodega).filter(Bodega.nombre_oficial.contains(p)).first()
                if b:
                    break
        if b is None:
            turno["respuesta_hablada"] = "No encuentro esa bodega. ¿Me repite el nombre?"
            return turno
        abierta = s.query(SesionConteo).filter_by(bodega_id=b.id, tipo="conteo",
                                                 estado="abierta").first()
        if abierta and abierta.usuario_id != getattr(usuario, "id", None):
            turno["respuesta_hablada"] = (f"{b.nombre_oficial} ya esta en conteo "
                                          "por otra persona.")
            return turno
        ses = abierta or SesionConteo(bodega_id=b.id,
                                      usuario_id=getattr(usuario, "id", 1))
        if not abierta:
            s.add(ses)
            b.estado = "en_conteo"
            s.commit()
            s.refresh(ses)
        refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
        est["bodega_id"] = b.id
        est["bodega_nombre"] = b.nombre_oficial
        est["sesion_bd"] = ses.id
        nombre = b.nombre_oficial
    if usuario:
        registrar(usuario, "APERTURA", f"{nombre} abierta - sesion bloqueada")
    turno["respuesta_hablada"] = (f"Listo, {nombre.lower()} abierta con "
                                 f"{refs} referencias. Dicteme el primer producto.")
    turno["bodega"] = {"id": est["bodega_id"], "nombre": nombre, "referencias": refs}
    return turno


def avance(sesion_id) -> str:
    with Sesion() as s:
        hechas = s.query(Conteo).filter_by(sesion_id=sesion_id,
                                           estado="confirmado").count()
        est = ESTADOS.get(sesion_id, {})
        total = (s.query(StockSistema)
                 .filter_by(bodega_id=est.get("bodega_id")).count()
                 if est.get("bodega_id") else 0)
    if total:
        return f"Llevamos {hechas} de {total} referencias."
    return f"Llevamos {hechas} referencias."


def _generar_reporte_voz(usuario) -> dict:
    """Cuando la persona acepta la oferta «¿le genero el archivo?» tras
    una consulta: aqui de verdad se genera, no solo se dice que si."""
    import os
    import reportes
    ruta, filas, _vista_previa = reportes.consolidado("xlsx")
    if usuario:
        from seguridad import registrar
        registrar(usuario, "REPORTE", f"Consolidado generado por voz: {ruta} ({filas} filas)")
    return {"intencion": "reporte", "guardado": True, "archivo": ruta,
            "respuesta_hablada": f"Listo, ya genere el archivo {os.path.basename(ruta)}. "
                                 "Lo encuentra en el menu Reportes para descargarlo. "
                                 "¿Algo más en lo que le ayude?"}


def resumen_stock(a) -> str:
    """El articulo ya viene resuelto (sin ambiguedad): solo arma la respuesta."""
    with Sesion() as s:
        filas = s.query(StockSistema).filter_by(articulo_codigo=a["codigo"]).all()
        total = sum(f.cantidad_sd or 0 for f in filas)
        nombres = []
        for f in filas[:4]:
            b = s.get(Bodega, f.bodega_id)
            if b:
                nombres.append(f"{b.nombre_oficial.lower()} {f.cantidad_sd:g}")
    if not filas:
        return f"{a['nombre']}: no tiene registro de stock en ninguna bodega todavia."
    detalle = "; ".join(nombres)
    return (f"{a['nombre']}: {total:g} {a['unidad']} en {len(filas)} bodegas. "
            f"{detalle}. ¿Le genero el archivo?")


def _elegir(texto, opciones):
    """Empareja «la FB», «la primera», el codigo o una palabra distintiva."""
    t = " " + texto.upper().strip() + " "
    if not opciones:
        return None

    # 1) por codigo dictado
    for o in opciones:
        if o["codigo"] in t:
            return o

    # 2) por posicion
    if any(k in t for k in (" PRIMERA ", " PRIMERO ", " UNO ", " LA UNA ")):
        return opciones[0]
    if any(k in t for k in (" SEGUNDA ", " SEGUNDO ", " DOS ")) and len(opciones) > 1:
        return opciones[1]

    import re
    dichas = set(re.findall(r"[A-Z0-9/]{2,}", t)) - {"LA", "EL", "DE", "ES"}

    # 3) dijo el nombre completo de una opcion, tal cual - incluso si ese
    # nombre esta contenido dentro del de la otra (ARROZ dentro de ARROZ
    # BASMATI). Aqui NO sirve buscar una palabra distintiva porque ARROZ
    # no tiene ninguna que no este tambien en ARROZ BASMATI; lo que importa
    # es que lo dicho coincide exactamente con el conjunto de palabras de
    # esa opcion y no con el de la otra.
    for o in opciones:
        propias = set(re.findall(r"[A-Z0-9/]{2,}", o["nombre"].upper()))
        if dichas == propias:
            return o

    # 4) por palabra o sigla que aparezca en UNA sola de las opciones
    for i, o in enumerate(opciones):
        otras = " ".join(x["nombre"].upper() for j, x in enumerate(opciones) if j != i)
        propias = set(re.findall(r"[A-Z0-9/]{2,}", o["nombre"].upper()))
        ajenas = set(re.findall(r"[A-Z0-9/]{2,}", otras))
        distintivas = propias - ajenas          # lo que solo esta en esta opcion
        if dichas & distintivas:
            return o
    return None
