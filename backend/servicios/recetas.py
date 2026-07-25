"""Momentos 1 y 3 del reto: pedido por receta y legalizacion del servicio."""
from bd import Sesion
from modelos import (Receta, RecetaIngrediente, Articulo,
                     StockSistema, LineaServicio)


def calcular_pedido(preparacion: str, porciones: int, bodega_id: int) -> list[dict]:
    """La regla del reto: cantidad por porcion x porciones - lo que ya hay."""
    with Sesion() as s:
        receta = s.query(Receta).filter(
            Receta.nombre.ilike(f"%{preparacion}%")).first()
        if receta is None:
            return []

        ings = s.query(RecetaIngrediente).filter_by(receta_id=receta.id).all()
        lineas = []
        for ing in ings:
            art = s.get(Articulo, ing.articulo_codigo)
            if art is None:
                continue
            necesario = round(ing.cantidad_por_porcion * porciones, 3)
            stock = s.query(StockSistema).filter_by(
                articulo_codigo=art.codigo, bodega_id=bodega_id).first()
            hay = stock.cantidad_sd if stock else 0
            falta = max(0, round(necesario - hay, 3))
            lineas.append({"codigo": art.codigo, "nombre": art.nombre_oficial,
                           "unidad": art.unidad_medida, "necesario": necesario,
                           "stock": hay, "falta": falta})
    return lineas


def detalle_receta(preparacion: str) -> dict:
    """Solo consulta: cómo está armada la receta, sin tocar stock."""
    with Sesion() as s:
        receta = s.query(Receta).filter(
            Receta.nombre.ilike(f"%{preparacion}%")).first()
        if receta is None:
            return {}
        ings = s.query(RecetaIngrediente).filter_by(receta_id=receta.id).all()
        lineas = []
        for ing in ings:
            art = s.get(Articulo, ing.articulo_codigo)
            if art is None:
                continue
            lineas.append({"codigo": art.codigo, "nombre": art.nombre_oficial,
                           "unidad": art.unidad_medida,
                           "por_porcion": ing.cantidad_por_porcion})
    return {"nombre": receta.nombre, "rendimiento": receta.rendimiento, "lineas": lineas}


def comparar_legalizacion(servicio_id: int) -> dict:
    """Lo pedido contra lo usado, con la lectura en palabras."""
    with Sesion() as s:
        filas = s.query(LineaServicio).filter_by(servicio_id=servicio_id).all()
    lineas = []
    for l in filas:
        dif = round((l.usado or 0) - (l.pedido or 0), 3)
        if dif < 0:
            lectura = "Sobrante: vuelve a bodega"
        elif dif > 0:
            lectura = "Merma: revisar con el chef"
        else:
            lectura = "Cuadro exacto"
        lineas.append({"codigo": l.articulo_codigo, "nombre": l.nombre,
                       "pedido": l.pedido, "usado": l.usado,
                       "diferencia": dif, "lectura": lectura})
    return {"lineas": lineas}


def analisis_consumo() -> dict:
    """El «suma puntos» del reto: subutilizados y sobrepedido."""
    with Sesion() as s:
        filas = s.query(LineaServicio).filter_by(estado="legalizado").all()
    total_ped = sum(f.pedido or 0 for f in filas)
    total_uso = sum(f.usado or 0 for f in filas)
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
    return {"pedido_total": round(total_ped, 2), "usado_total": round(total_uso, 2),
            "aprovechamiento": round(total_uso / total_ped * 100, 1) if total_ped else 0,
            "subutilizados": subutil}
