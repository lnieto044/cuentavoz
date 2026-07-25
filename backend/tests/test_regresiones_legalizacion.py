"""Regresiones para evitar alteraciones repetidas o cruzadas de inventario."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _stock(codigo: str, bodega_id: int) -> float:
    from bd import Sesion
    from modelos import StockSistema

    with Sesion() as sesion:
        fila = sesion.query(StockSistema).filter_by(
            articulo_codigo=codigo, bodega_id=bodega_id
        ).one()
        return float(fila.cantidad_sd)


def test_legalizacion_es_idempotente_y_afecta_solo_su_bodega(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Reintentar una legalización no duplica el sobrante en ninguna bodega."""
    from bd import Sesion
    from modelos import LineaServicio

    servicio_id = 777
    codigo = str(datos_regresion["articulo_codigo"])
    bodega_origen = int(datos_regresion["bodega_asignada_id"])
    otra_bodega = int(datos_regresion["bodega_no_asignada_id"])
    headers = datos_regresion["headers"]

    with Sesion() as sesion:
        sesion.add(LineaServicio(
            servicio_id=servicio_id,
            articulo_codigo=codigo,
            nombre="ARTICULO REGRESION",
            pedido=10,
            usado=0,
            bodega_id=bodega_origen,
        ))
        sesion.commit()

    payload = {
        "servicio_id": servicio_id,
        "usos": [{"codigo": codigo, "usado": 7}],
    }
    primera = client.post("/api/legalizacion/confirmar", headers=headers, json=payload)
    assert primera.status_code == 200, primera.text
    assert _stock(codigo, bodega_origen) == 103
    assert _stock(codigo, otra_bodega) == 200

    segunda = client.post("/api/legalizacion/confirmar", headers=headers, json=payload)
    # Un reintento puede responder éxito ya aplicado o conflicto; en ambos casos
    # la condición de idempotencia es que el inventario permanezca intacto.
    assert segunda.status_code in (200, 409), segunda.text
    assert _stock(codigo, bodega_origen) == 103
    assert _stock(codigo, otra_bodega) == 200
