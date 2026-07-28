"""El endpoint del flujo: informacion limpia lista para el ERP."""
import os
import datetime
import pandas as pd
from bd import motor

CONSULTA = """
SELECT a.codigo, a.nombre_oficial AS articulo, a.unidad_medida AS unidad,
       b.nombre_oficial AS bodega, c.cantidad AS contado,
       st.cantidad_sd AS sistema,
       c.cantidad - COALESCE(st.cantidad_sd, 0) AS diferencia
FROM conteo c
JOIN articulo a ON a.codigo = c.articulo_codigo
JOIN sesion_conteo sc ON sc.id = c.sesion_id
JOIN bodega b ON b.id = sc.bodega_id
LEFT JOIN stock_sistema st ON st.articulo_codigo = a.codigo
     AND st.bodega_id = b.id
WHERE c.estado = 'confirmado'
"""


def consolidado(formato: str = "xlsx") -> tuple[str, int, list[dict]]:
    df = pd.read_sql(CONSULTA, motor)
    # "sistema" sale NULL/NaN cuando el articulo no tiene fila de stock en
    # esa bodega (LEFT JOIN); NaN no es JSON valido para la vista previa,
    # y aqui significa lo mismo que en el resto de la app: no hay dato,
    # se trata como 0.
    df["sistema"] = df["sistema"].fillna(0)
    df["diferencia"] = df["diferencia"].round(2)
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/consolidado_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    vista_previa = df.head(8).to_dict("records")
    return ruta, len(df), vista_previa


def diferencias_archivo(formato: str = "xlsx") -> tuple[str, int, int]:
    """«Diferencias por bodega» descargable: solo las filas donde el
    conteo no cuadro con el sistema, no el consolidado completo."""
    df = pd.read_sql(CONSULTA, motor)
    df["diferencia"] = df["diferencia"].round(2)
    df = df[df["diferencia"] != 0]
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/diferencias_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta, len(df), df["bodega"].nunique() if len(df) else 0


def detalle_bodega(bodega_id: int, formato: str = "xlsx") -> str:
    """«Descargar detalle»: el conteo completo de una sola bodega."""
    df = pd.read_sql(CONSULTA + " AND b.id = :bodega_id",
                     motor, params={"bodega_id": bodega_id})
    df["diferencia"] = df["diferencia"].round(2)
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/bodega_{bodega_id}_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta


ESTADO_BODEGAS = """
SELECT nombre_oficial AS bodega, estado
FROM bodega ORDER BY nombre_oficial
"""


def estado_bodegas(formato: str = "xlsx") -> str:
    """«Exportar estado»: la foto del tablero en vivo, para mandarla por
    correo o adjuntarla sin tener que tomar una captura de pantalla."""
    df = pd.read_sql(ESTADO_BODEGAS, motor)
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/estado_bodegas_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta
