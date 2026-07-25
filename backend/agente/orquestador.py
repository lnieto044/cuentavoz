"""Donde el pensar se vuelve accion. El agente propone, el backend dispone."""
from datetime import datetime
from bd import Sesion
from modelos import Conteo, StockSistema, SesionConteo, Bodega, Alerta
from servicios.conciliacion import buscar_articulo, aprender_alias
from servicios.validacion import validar_conteo
from agente.cerebro import pensar

ESTADOS: dict[int, dict] = {}          # memoria viva por sesion

ALTA = 90
MEDIA = 60


def procesar_turno(texto: str, sesion_id: int, usuario=None) -> dict:
    est = ESTADOS.setdefault(sesion_id, {})
    bodega_id = est.get("bodega_id")

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

    dice_si = any(k in texto.lower() for k in
                  ("confirmo", "confirmar", "correcto", "asi es", "eso es"))

    # ── 1) confirma lo pendiente: aqui si se guarda ──
    if est.get("pendiente") and (dice_si or intencion == "confirmar"):
        return _guardar(est, sesion_id, usuario)

    # confirma sin nada pendiente: hay que decirlo, no fingir que guardo
    if (dice_si or intencion == "confirmar") and not est.get("pendiente"):
        if est.get("opciones"):
            turno["respuesta_hablada"] = _leer_opciones(est["opciones"])
            turno["opciones"] = est["opciones"]
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
            est["opciones"] = None
            return _dejar_pendiente(est, elegido, est.get("cantidad", 1), texto, turno)

    # ── 3) abrir bodega ──
    if intencion == "navegar":
        return _abrir(est, turno.get("bodega_texto") or texto, turno, usuario)

    # ── 4) contar ──
    if intencion == "contar":
        cand = buscar_articulo(turno.get("articulo_texto") or texto, bodega_id)
        if not cand:
            turno["respuesta_hablada"] = ("No encontre ese articulo en el catalogo. "
                                          "¿Lo creamos? Quedara pendiente de aprobacion.")
            turno["intencion"] = "crear"
            return turno
        est["cantidad"] = turno.get("cantidad") or 1
        est["unidad_dicha"] = turno.get("unidad")
        if len(cand) == 1 or cand[0]["confianza"] >= ALTA:
            return _dejar_pendiente(est, cand[0], est["cantidad"], texto, turno)
        if cand[0]["confianza"] >= MEDIA:
            est["opciones"] = cand[:2]
            turno["opciones"] = est["opciones"]
            turno["respuesta_hablada"] = _leer_opciones(cand[:2])
            return turno
        turno["respuesta_hablada"] = ("No estoy seguro de cual es. "
                                      "¿Me lo repite o lo deletrea?")
        return turno

    # ── 5) corregir el ultimo ──
    if intencion == "corregir":
        return _corregir(est, sesion_id, turno, usuario)

    # ── 6) consultar ──
    if intencion == "consultar":
        turno["respuesta_hablada"] = consultar_stock(turno.get("articulo_texto") or texto)
        return turno

    # ── 7) avance ──
    if "falta" in texto.lower() or "avance" in texto.lower():
        turno["respuesta_hablada"] = avance(sesion_id)
        return turno

    if not turno["respuesta_hablada"]:
        turno["respuesta_hablada"] = "Perdon, no le entendi bien. ¿Me lo repite?"
    return turno


# ─────────────────────────── auxiliares ───────────────────────────
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
        if v["tipo"] in ("negativo", "unidad", "inexistente"):
            est["pendiente"] = None          # no se puede guardar: hay que repetir
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
        nombre = orig.articulo_codigo
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


def consultar_stock(texto_articulo: str) -> str:
    cand = buscar_articulo(texto_articulo)
    if not cand:
        return "No encontre ese articulo en el catalogo."
    a = cand[0]
    with Sesion() as s:
        filas = s.query(StockSistema).filter_by(articulo_codigo=a["codigo"]).all()
        total = sum(f.cantidad_sd or 0 for f in filas)
        nombres = []
        for f in filas[:4]:
            b = s.get(Bodega, f.bodega_id)
            if b:
                nombres.append(f"{b.nombre_oficial.lower()} {f.cantidad_sd:g}")
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

    # 3) por palabra o sigla que aparezca en UNA sola de las opciones
    import re
    dichas = set(re.findall(r"[A-Z0-9/]{2,}", t)) - {"LA", "EL", "DE", "ES"}
    for i, o in enumerate(opciones):
        otras = " ".join(x["nombre"].upper() for j, x in enumerate(opciones) if j != i)
        propias = set(re.findall(r"[A-Z0-9/]{2,}", o["nombre"].upper()))
        ajenas = set(re.findall(r"[A-Z0-9/]{2,}", otras))
        distintivas = propias - ajenas          # lo que solo esta en esta opcion
        if dichas & distintivas:
            return o
    return None
