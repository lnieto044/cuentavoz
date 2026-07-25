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


def consolidado(formato: str = "xlsx") -> str:
    df = pd.read_sql(CONSULTA, motor)
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/consolidado_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
    return ruta
