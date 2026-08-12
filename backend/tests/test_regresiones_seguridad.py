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
                        json={"pin_actual": "StockXperts", "pin": "654321"})
    assert cambio.status_code == 200, cambio.text

    con_token_previo = client.get("/api/usuarios/yo", headers=headers_viejos)
    assert con_token_previo.status_code == 401, con_token_previo.text

    nuevo_ingreso = client.post(
        "/api/ingresar",
        data={"username": "luis", "password": "654321"},
    )
    assert nuevo_ingreso.status_code == 200, nuevo_ingreso.text


def test_cambio_de_pin_exige_el_pin_actual_correcto(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Con el token abierto no basta para tomarse la cuenta: hay que saber
    el PIN vigente, no solo tener una sesión activa."""
    headers = datos_regresion["headers"]

    sin_pin_actual = client.put("/api/usuarios/yo/pin", headers=headers,
                                json={"pin": "999999"})
    assert sin_pin_actual.status_code == 401, sin_pin_actual.text

    pin_actual_incorrecto = client.put("/api/usuarios/yo/pin", headers=headers,
                                       json={"pin_actual": "no-es-este", "pin": "999999"})
    assert pin_actual_incorrecto.status_code == 401, pin_actual_incorrecto.text

    # el PIN sigue siendo el original: se puede entrar con el de siempre
    ingreso = client.post("/api/ingresar", data={"username": "luis", "password": "StockXperts"})
    assert ingreso.status_code == 200, ingreso.text


def test_auxiliar_no_puede_ver_detalle_de_bodega_ajena(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """La asignación también protege el detalle/firmas/inventario, no solo
    el listado: antes se podía pedir estos datos directo por bodega_id sin
    que la asignación se revisara para nada."""
    headers = datos_regresion["headers"]
    ajena = datos_regresion["bodega_no_asignada_id"]

    for ruta in (f"/api/bodegas/{ajena}/detalle", f"/api/bodegas/{ajena}/firmas",
                 f"/api/bodegas/{ajena}/articulos"):
        r = client.get(ruta, headers=headers)
        assert r.status_code == 403, f"{ruta}: {r.text}"

    propia = datos_regresion["bodega_asignada_id"]
    r = client.get(f"/api/bodegas/{propia}/detalle", headers=headers)
    assert r.status_code == 200, r.text


def test_auxiliar_no_puede_abrir_bodega_ajena_por_voz(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El mismo límite de asignación que /api/bodegas/abrir aplica al pedir
    lo mismo por el agente conversacional (/api/agente/turno) - antes
    bastaba con dictar el nombre de la bodega para saltárselo. Se fuerza
    el intérprete local (sin Gemini) para que el resultado no dependa de
    cómo un modelo externo decida frasear "bodega_texto" ese día - lo que
    se prueba aquí es la autorización, no la interpretación del lenguaje."""
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    headers = datos_regresion["headers"]
    nombre_ajena = datos_regresion["bodega_no_asignada"]

    r = client.post("/api/agente/turno", headers=headers,
                    json={"texto": f"iniciar conteo en {nombre_ajena}", "sesion_id": 999})
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos.get("bodega") is None
    assert "no esta asignada" in datos["respuesta_hablada"].lower() \
        or "no está asignada" in datos["respuesta_hablada"].lower()


def test_websocket_rechaza_conexion_sin_token(client: TestClient) -> None:
    """El tablero en vivo no puede exponer estado de bodegas sin identidad."""
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/api/bodegas/estado") as websocket:
            websocket.receive_json()

    assert error.value.code == 1008
