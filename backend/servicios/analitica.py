"""Las métricas del panel gerencial y de reportes: todo calculado en vivo
sobre la misma base que usa el resto de la aplicación — una sola fuente."""
from datetime import datetime
from bd import Sesion
from modelos import (Bodega, Articulo, StockSistema, SesionConteo, Conteo,
                     Alerta, AliasArticulo, HistorialCierre, ConfigClave)


def _config(clave: str, defecto: str) -> str:
    with Sesion() as s:
        c = s.get(ConfigClave, clave)
        return c.valor if c else defecto


def diferencias_por_bodega(limite: int = 6) -> list[dict]:
    """Suma de |contado - sistema| por bodega, sobre lo confirmado."""
    with Sesion() as s:
        bodegas = s.query(Bodega).all()
        salida = []
        for b in bodegas:
            conteos = (s.query(Conteo).join(SesionConteo)
                       .filter(SesionConteo.bodega_id == b.id,
                               Conteo.estado == "confirmado").all())
            if not conteos:
                continue
            total = 0.0
            for c in conteos:
                st = s.query(StockSistema).filter_by(
                    articulo_codigo=c.articulo_codigo, bodega_id=b.id).first()
                esperado = st.cantidad_sd if st else 0
                total += abs((c.cantidad or 0) - esperado)
            if total > 0:
                salida.append({"bodega": b.nombre_oficial, "diferencia": round(total, 1)})
    salida.sort(key=lambda x: -x["diferencia"])
    return salida[:limite]


def stock_por_unidad() -> list[dict]:
    with Sesion() as s:
        arts = {a.codigo: a.unidad_medida for a in s.query(Articulo).all()}
        acumulado = {}
        for st in s.query(StockSistema).all():
            u = arts.get(st.articulo_codigo, "Otra")
            acumulado[u] = acumulado.get(u, 0) + max(st.cantidad_sd or 0, 0)
    total = sum(acumulado.values()) or 1
    salida = [{"unidad": u, "cantidad": round(c, 1),
               "pct": round(c / total * 100, 1)}
              for u, c in acumulado.items()]
    salida.sort(key=lambda x: -x["cantidad"])
    return salida


def alertas_por_tipo() -> list[dict]:
    etiquetas = {"desviacion": "Desviación", "unidad": "Unidad",
                 "negativo": "Saldo negativo", "inexistente": "Inexistente"}
    with Sesion() as s:
        conteo = {}
        for a in s.query(Alerta).all():
            conteo[a.tipo] = conteo.get(a.tipo, 0) + 1
    salida = [{"tipo": etiquetas.get(t, t), "cantidad": n} for t, n in conteo.items()]
    salida.sort(key=lambda x: -x["cantidad"])
    return salida


def descuadres_recurrentes(limite: int = 5) -> list[dict]:
    """Un artículo con diferencia en más de una toma: ahí está la causa raíz."""
    with Sesion() as s:
        arts = {a.codigo: a.nombre_oficial for a in s.query(Articulo).all()}
        por_articulo = {}
        conteos = (s.query(Conteo).join(SesionConteo)
                   .filter(Conteo.estado == "confirmado").all())
        for c in conteos:
            ses = s.get(SesionConteo, c.sesion_id)
            st = s.query(StockSistema).filter_by(
                articulo_codigo=c.articulo_codigo, bodega_id=ses.bodega_id).first()
            esperado = st.cantidad_sd if st else 0
            dif = (c.cantidad or 0) - esperado
            if abs(dif) < 0.01:
                continue
            d = por_articulo.setdefault(c.articulo_codigo,
                                        {"dif": 0.0, "tomas": set(), "negativo": False})
            d["dif"] += dif
            d["tomas"].add(c.sesion_id)
            if esperado < 0:
                d["negativo"] = True
    salida = []
    for cod, d in por_articulo.items():
        if len(d["tomas"]) < 2 and not d["negativo"]:
            continue
        salida.append({
            "articulo": arts.get(cod, cod),
            "tipo": "Saldo negativo" if d["negativo"] else "Desviación",
            "diferencia": round(d["dif"], 1),
            "tomas": len(d["tomas"]),
            "accion": "Revisar salidas sin entrada" if d["negativo"]
                      else "Crear en catálogo oficial" if cod.startswith("PEND")
                      else "Ajustar el saldo del sistema",
        })
    salida.sort(key=lambda x: -abs(x["diferencia"]))
    return salida[:limite]


def historial_exactitud(limite: int = 12) -> list[dict]:
    with Sesion() as s:
        filas = (s.query(HistorialCierre).order_by(HistorialCierre.fecha).all())[-limite:]
        nombres = {b.id: b.nombre_oficial for b in s.query(Bodega).all()}
    return [{"fecha": f.fecha.strftime("%Y-%m-%d"), "exactitud": round(f.exactitud, 1),
             "bodega_id": f.bodega_id, "bodega": nombres.get(f.bodega_id, "")} for f in filas]


def resumen_ejecutivo() -> dict:
    with Sesion() as s:
        bodegas = s.query(Bodega).all()
        cerradas = [b for b in bodegas if b.estado == "cerrada"]
        total_conteos = s.query(Conteo).filter_by(estado="confirmado").count()
        alertas_total = s.query(Alerta).count()
        alertas_resueltas = s.query(Alerta).filter_by(resuelta=1).count()
        historial = s.query(HistorialCierre).all()
        exact = (round(sum(h.exactitud for h in historial) / len(historial), 1)
                  if historial else 100.0)
    return {
        "exactitud_primera_pasada": exact,
        "referencias_contadas": total_conteos,
        "alertas_gestionadas": alertas_resueltas,
        "alertas_total": alertas_total,
        "bodegas_cerradas": len(cerradas),
        "bodegas_total": len(bodegas),
        "diferencia_por_bodega": diferencias_por_bodega(limite=10),
        "stock_por_unidad": stock_por_unidad(),
        "historial_exactitud": historial_exactitud(),
    }


def resumen_alertas_panel() -> dict:
    with Sesion() as s:
        negativos_actuales = s.query(StockSistema).filter(
            StockSistema.cantidad_sd < 0).count()
        alias = s.query(AliasArticulo).count()
        bodegas = s.query(Bodega).all()
        cerradas_ses = (s.query(SesionConteo).filter_by(tipo="conteo", estado="cerrada")
                        .filter(SesionConteo.fin.isnot(None)).all())
        minutos = [( (ses.fin - ses.inicio).total_seconds() / 60)
                   for ses in cerradas_ses if ses.fin]
    negativos_iniciales = int(_config("negativos_iniciales", str(negativos_actuales or 0)))
    estado_bodegas = {}
    for b in bodegas:
        estado_bodegas[b.estado] = estado_bodegas.get(b.estado, 0) + 1
    return {
        "negativos_iniciales": negativos_iniciales,
        "negativos_actuales": negativos_actuales,
        "tiempo_promedio_min": round(sum(minutos) / len(minutos)) if minutos else 0,
        "alias_aprendidos": alias,
        "estado_bodegas": estado_bodegas,
        "alertas_por_tipo": alertas_por_tipo(),
        "descuadres_recurrentes": descuadres_recurrentes(),
    }
