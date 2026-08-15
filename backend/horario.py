"""La hora de Bogotá para toda la aplicación.

El servidor (Render) corre en UTC, pero CuentaVoz es una sola operación
en Colombia: lo que se guarda en la base (creado, resuelto, inicio, fin...)
y lo que se muestra (trazabilidad, alertas, reportes) debe leerse en hora
de Bogotá, no en la del contenedor - si no, cada hora mostrada queda
adelantada 5 horas (confirmado en producción: un reporte generado a las
2:56pm quedó con el nombre de archivo en 19:56)."""
from datetime import datetime
from zoneinfo import ZoneInfo

_BOGOTA = ZoneInfo("America/Bogota")


def ahora() -> datetime:
    """La hora de Bogotá ahora mismo, sin info de zona (naive) - para
    seguir siendo comparable con las columnas datetime ya guardadas y con
    el resto del código, que nunca maneja zonas horarias explícitas."""
    return datetime.now(_BOGOTA).replace(tzinfo=None)
