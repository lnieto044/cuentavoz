"""Guardar y leer los XLSX/CSV generados desde la base, no desde disco -
el disco del Web Service en Render es efimero (se borra en cada deploy o
reinicio), asi que un reporte "generado hace una hora" quedaria
inalcanzable despues del siguiente `git push`. La "ruta" (ej.
"reportes/consolidado_20260815_1636.xlsx") se sigue usando como
identificador legible en toda la app - solo cambia DONDE vive el
contenido real."""
import io

from bd import Sesion
from modelos import ArchivoGenerado


def guardar_df(ruta: str, df, formato: str) -> None:
    buf = io.BytesIO()
    if formato == "csv":
        df.to_csv(buf, index=False)
    else:
        df.to_excel(buf, index=False)
    with Sesion() as s:
        s.add(ArchivoGenerado(ruta=ruta, contenido=buf.getvalue()))
        s.commit()


def leer_bytes(ruta: str) -> bytes | None:
    with Sesion() as s:
        obj = (s.query(ArchivoGenerado).filter_by(ruta=ruta)
               .order_by(ArchivoGenerado.id.desc()).first())
        return obj.contenido if obj else None
