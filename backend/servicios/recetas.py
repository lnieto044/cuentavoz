"""Momentos 1 y 3 del reto: pedido por receta y legalizacion del servicio."""
import unicodedata
from datetime import datetime, timedelta
from bd import Sesion
from modelos import (Receta, RecetaIngrediente, Articulo,
                     StockSistema, LineaServicio)


def _sin_tildes(t: str) -> str:
    """«santafereño» dicho o escrito sin tilde («santafereno») no debe
    fallar la busqueda - un LIKE normal en SQLite si distingue Ñ de N, y
    eso ya causo un "no encontre la receta" con un plato que si existia."""
    t = str(t or "").upper().strip()
    return "".join(c for c in unicodedata.normalize("NFD", t)
                   if unicodedata.category(c) != "Mn")


def _buscar_receta(s, preparacion: str):
    objetivo = _sin_tildes(preparacion)
    if not objetivo:
        return None
    for r in s.query(Receta).all():
        if objetivo in _sin_tildes(r.nombre):
            return r
    return None


def calcular_pedido(preparacion: str, porciones: int, bodega_id: int) -> dict:
    """La regla del reto: cantidad por porcion x porciones - lo que ya hay.

    Si un ingrediente de la receta no esta en el catalogo, o esta pero esa
    bodega nunca lo ha tenido registrado, no se salta en silencio: queda
    en «faltantes_catalogo» / «sin_registro_bodega» para que la persona
    se entere y no crea que el pedido esta completo cuando no lo esta."""
    with Sesion() as s:
        receta = _buscar_receta(s, preparacion)
        if receta is None:
            return {"lineas": [], "faltantes_catalogo": [],
                    "sin_registro_bodega": [], "receta_encontrada": False}

        ings = s.query(RecetaIngrediente).filter_by(receta_id=receta.id).all()
        lineas, faltantes, sin_registro = [], [], []
        for ing in ings:
            art = s.get(Articulo, ing.articulo_codigo)
            if art is None:
                faltantes.append(ing.articulo_codigo)
                continue
            necesario = round(ing.cantidad_por_porcion * porciones, 3)
            stock = s.query(StockSistema).filter_by(
                articulo_codigo=art.codigo, bodega_id=bodega_id).first()
            if stock is None:
                sin_registro.append(art.nombre_oficial)
            hay = stock.cantidad_sd if stock else 0
            falta = max(0, round(necesario - hay, 3))
            lineas.append({"codigo": art.codigo, "nombre": art.nombre_oficial,
                           "unidad": art.unidad_medida, "necesario": necesario,
                           "stock": hay, "falta": falta,
                           "sin_registro_bodega": stock is None})
    return {"lineas": lineas, "faltantes_catalogo": faltantes,
            "sin_registro_bodega": sin_registro, "receta_encontrada": True}


def detalle_receta(preparacion: str) -> dict:
    """Solo consulta: cómo está armada la receta, sin tocar stock."""
    with Sesion() as s:
        receta = _buscar_receta(s, preparacion)
        if receta is None:
            return {}
        ings = s.query(RecetaIngrediente).filter_by(receta_id=receta.id).all()
        lineas, faltantes = [], []
        for ing in ings:
            art = s.get(Articulo, ing.articulo_codigo)
            if art is None:
                faltantes.append(ing.articulo_codigo)
                continue
            lineas.append({"codigo": art.codigo, "nombre": art.nombre_oficial,
                           "unidad": art.unidad_medida,
                           "por_porcion": ing.cantidad_por_porcion})
    return {"id": receta.id, "nombre": receta.nombre, "rendimiento": receta.rendimiento,
            "preparacion": receta.preparacion or "", "lineas": lineas,
            "faltantes_catalogo": faltantes}


def comparar_legalizacion(servicio_id: int) -> dict:
    """Lo pedido contra lo usado, con la lectura en palabras. Solo lo que
    sigue abierto: si ya se legalizo antes (el servicio de ejemplo, u otro
    pedido con el mismo numero de servicio) no debe mezclarse aqui ni
    volver a legalizarse por accidente."""
    with Sesion() as s:
        filas = s.query(LineaServicio).filter_by(
            servicio_id=servicio_id, estado="abierto").all()
        lineas = []
        for l in filas:
            dif = round((l.usado or 0) - (l.pedido or 0), 3)
            if dif < 0:
                lectura = "Sobrante: vuelve a bodega"
            elif dif > 0:
                lectura = "Merma: revisar con el chef"
            else:
                lectura = "Cuadro exacto"
            art = s.get(Articulo, l.articulo_codigo)
            lineas.append({"codigo": l.articulo_codigo, "nombre": l.nombre,
                           "unidad": art.unidad_medida if art else "",
                           "pedido": l.pedido, "usado": l.usado,
                           "diferencia": dif, "lectura": lectura})
    plato = next((f.plato for f in filas if f.plato), "")
    porciones = next((f.porciones for f in filas if f.porciones), 0)
    return {"lineas": lineas, "plato": plato, "porciones": porciones}


def analisis_consumo(dias: int = 30) -> dict:
    """El «suma puntos» del reto: subutilizados y sobrepedido, acotado a
    los ultimos N dias (por defecto 30, como en el tablero de Reportes)."""
    desde = datetime.now() - timedelta(days=dias)
    with Sesion() as s:
        filas = (s.query(LineaServicio)
                .filter(LineaServicio.estado == "legalizado",
                        LineaServicio.creado >= desde).all())
    total_ped = sum(f.pedido or 0 for f in filas)
    total_uso = sum(f.usado or 0 for f in filas)
    servicios = len({f.servicio_id for f in filas})
    porart = {}
    for f in filas:
        d = porart.setdefault(f.nombre, {"pedido": 0, "usado": 0, "veces": 0})
        d["pedido"] += f.pedido or 0
        d["usado"] += f.usado or 0
        d["veces"] += 1
    subutil = []
    for nombre, d in porart.items():
        sobra = round(d["pedido"] - d["usado"], 3)
        if sobra > 0:
            pct = round(sobra / d["pedido"] * 100) if d["pedido"] else 0
            subutil.append({"nombre": nombre, "sobra": sobra,
                            "veces": d["veces"], "sobrepedido_pct": pct})
    subutil.sort(key=lambda x: -x["sobrepedido_pct"])
    ahorro_potencial = round(sum(s["sobra"] for s in subutil), 2)
    return {"pedido_total": round(total_ped, 2), "usado_total": round(total_uso, 2),
            "aprovechamiento": round(total_uso / total_ped * 100, 1) if total_ped else 0,
            "servicios_periodo": servicios, "ahorro_potencial": ahorro_potencial,
            "dias": dias, "subutilizados": subutil}
