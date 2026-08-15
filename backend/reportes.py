"""El endpoint del flujo: informacion limpia lista para el ERP."""
import os
import pandas as pd
from bd import motor
from horario import ahora

# Los nombres de columna son a proposito los mismos que trae el extracto
# real de Colsubsidio (ver data/BODEGAS_Y_STOCK.xlsx: "Nr.Artículo",
# "Artículo", "Unidad", "SD") - Bodega/Contado/Diferencia son las unicas
# columnas nuevas. Asi el archivo que se descarga aqui se reconoce de una
# en My Inventory (Oracle) en vez de traer nombres genericos inventados.
CONSULTA = """
SELECT a.codigo AS "Nr.Artículo", a.nombre_oficial AS "Artículo",
       a.unidad_medida AS "Unidad", b.nombre_oficial AS "Bodega",
       c.cantidad AS "Contado", st.cantidad_sd AS "SD",
       c.cantidad - COALESCE(st.cantidad_sd, 0) AS "Diferencia"
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
    # "SD" sale NULL/NaN cuando el articulo no tiene fila de stock en esa
    # bodega (LEFT JOIN); NaN no es JSON valido para la vista previa, y
    # aqui significa lo mismo que en el resto de la app: no hay dato, se
    # trata como 0.
    df["SD"] = df["SD"].fillna(0)
    df["Diferencia"] = df["Diferencia"].round(2)
    os.makedirs("reportes", exist_ok=True)
    marca = ahora().strftime("%Y%m%d_%H%M")
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
    df["Diferencia"] = df["Diferencia"].round(2)
    df = df[df["Diferencia"] != 0]
    os.makedirs("reportes", exist_ok=True)
    marca = ahora().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/diferencias_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta, len(df), df["Bodega"].nunique() if len(df) else 0


def detalle_bodega(bodega_id: int, formato: str = "xlsx") -> str:
    """«Descargar detalle»: el conteo completo de una sola bodega."""
    df = pd.read_sql(CONSULTA + " AND b.id = :bodega_id",
                     motor, params={"bodega_id": bodega_id})
    df["Diferencia"] = df["Diferencia"].round(2)
    os.makedirs("reportes", exist_ok=True)
    marca = ahora().strftime("%Y%m%d_%H%M")
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
    marca = ahora().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/estado_bodegas_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta
