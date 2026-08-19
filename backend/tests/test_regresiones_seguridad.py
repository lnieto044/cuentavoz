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


def test_cerrar_todas_las_sesiones_pide_a_cognito_revocar_las_del_usuario_correcto(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La clave y el login los maneja Cognito directamente, asi que esta
    ruta ya no puede invalidar un token propio (no hay "token propio") -
    lo que sigue siendo responsabilidad de este backend, y lo que prueba
    esto, es pedirle a Cognito (AdminUserGlobalSignOut) que revoque las
    sesiones exactamente de quien hizo la llamada, no de otra persona."""
    import main as modulo

    llamadas = []

    class _ClienteCognitoFalso:
        def admin_user_global_sign_out(self, UserPoolId, Username):
            llamadas.append((UserPoolId, Username))

    monkeypatch.setattr(modulo, "_cliente_cognito", lambda: _ClienteCognitoFalso())

    headers = datos_regresion["headers"]
    r = client.post("/api/usuarios/yo/cerrar-todas", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert llamadas == [(modulo.COGNITO_USER_POOL_ID, "luis")]


def test_cerrar_todas_las_sesiones_devuelve_502_si_cognito_falla(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Si Cognito no responde, se avisa con un error - no se calla el
    fallo como si las sesiones sí se hubieran cerrado."""
    import main as modulo

    class _ClienteCognitoFalso:
        def admin_user_global_sign_out(self, UserPoolId, Username):
            raise RuntimeError("Cognito no disponible")

    monkeypatch.setattr(modulo, "_cliente_cognito", lambda: _ClienteCognitoFalso())

    headers = datos_regresion["headers"]
    r = client.post("/api/usuarios/yo/cerrar-todas", headers=headers)
    assert r.status_code == 502, r.text


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
