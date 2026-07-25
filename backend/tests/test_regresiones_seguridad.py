"""Regresiones de autorización, sesión y legalización de inventario."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def test_auxiliar_no_puede_abrir_bodega_no_asignada(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Una asignación limita tanto la lista visible como la apertura de bodega."""
    headers = datos_regresion["headers"]

    listado = client.get("/api/bodegas", headers=headers)
    assert listado.status_code == 200, listado.text
    ids_visibles = {fila["id"] for fila in listado.json()}
    assert datos_regresion["bodega_asignada_id"] in ids_visibles
    assert datos_regresion["bodega_no_asignada_id"] not in ids_visibles

    respuesta = client.post(
        "/api/bodegas/abrir",
        headers=headers,
        json={"bodega": datos_regresion["bodega_no_asignada"]},
    )
    assert respuesta.status_code == 403, respuesta.text


def test_cambio_de_pin_invalida_el_token_previo(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """El token emitido antes de cambiar el PIN no conserva acceso."""
    headers_viejos = datos_regresion["headers"]

    cambio = client.put("/api/usuarios/yo/pin", headers=headers_viejos,
                        json={"pin": "654321"})
    assert cambio.status_code == 200, cambio.text

    con_token_previo = client.get("/api/usuarios/yo", headers=headers_viejos)
    assert con_token_previo.status_code == 401, con_token_previo.text

    nuevo_ingreso = client.post(
        "/api/ingresar",
        data={"username": "luis", "password": "654321"},
    )
    assert nuevo_ingreso.status_code == 200, nuevo_ingreso.text


def test_websocket_rechaza_conexion_sin_token(client: TestClient) -> None:
    """El tablero en vivo no puede exponer estado de bodegas sin identidad."""
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/api/bodegas/estado") as websocket:
            websocket.receive_json()

    assert error.value.code == 1008
