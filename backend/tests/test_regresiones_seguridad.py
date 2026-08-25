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


def _entrar(client: TestClient, nombre: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": nombre, "password": "StockXperts1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _asignar(nombre: str, bodega_id: int) -> None:
    from bd import Sesion
    from modelos import AsignacionBodega, Usuario

    with Sesion() as s:
        persona = s.query(Usuario).filter_by(nombre=nombre).one()
        s.add(AsignacionBodega(usuario_id=persona.id, bodega_id=bodega_id))
        s.commit()


def test_administrador_sin_bodegas_asignadas_sigue_alcanzando_todo_el_parque(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """El administrador general no tiene zona propia: manda la asignación,
    y sin asignaciones no hay nada que lo limite. Esto es lo que NO debe
    romperse al agregar el administrador de sede - en la demo diana no
    tiene ninguna bodega asignada."""
    headers = _entrar(client, "diana")
    ajena = datos_regresion["bodega_no_asignada_id"]

    for ruta in (f"/api/bodegas/{ajena}/detalle",
                 f"/api/bodegas/{ajena}/articulos",
                 f"/api/bodegas/{ajena}/firmas"):
        r = client.get(ruta, headers=headers)
        assert r.status_code != 403, f"{ruta} -> {r.text}"

    r = client.post(f"/api/bodegas/{ajena}/auditoria/iniciar", headers=headers)
    assert r.status_code == 200, r.text


def test_administrador_de_sede_no_alcanza_la_auditoria_de_otra_sede(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Un administrador CON bodegas asignadas queda limitado a esas: sin
    esto, al crecer a varias sedes el administrador de una podía iniciar,
    firmar o cerrar la auditoría de la otra con solo cambiar el número en
    la URL, aunque el tablero (?propias=1) ya no se la mostrara."""
    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    _asignar("diana", propia)
    headers = _entrar(client, "diana")

    ajenas = [
        ("get", f"/api/bodegas/{ajena}/detalle"),
        ("get", f"/api/bodegas/{ajena}/articulos"),
        ("get", f"/api/bodegas/{ajena}/firmas"),
        ("post", f"/api/bodegas/{ajena}/auditoria/iniciar"),
        ("get", f"/api/bodegas/{ajena}/auditoria/comparar"),
        ("post", f"/api/bodegas/{ajena}/auditoria/firmar"),
        ("post", f"/api/bodegas/{ajena}/cerrar"),
        ("post", f"/api/bodegas/{ajena}/exportar-detalle"),
    ]
    for metodo, ruta in ajenas:
        r = getattr(client, metodo)(ruta, headers=headers)
        assert r.status_code == 403, f"{ruta} devolvio {r.status_code}: {r.text}"

    r = client.post(f"/api/bodegas/{ajena}/reabrir", headers=headers,
                    json={"motivo": "prueba"})
    assert r.status_code == 403, r.text

    # y la suya sigue funcionando igual que antes
    r = client.get(f"/api/bodegas/{propia}/detalle", headers=headers)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/bodegas/{propia}/auditoria/iniciar", headers=headers)
    assert r.status_code == 200, r.text


def test_administrador_de_sede_no_ve_bodegas_ajenas_al_buscar_por_voz(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """La voz no debe ofrecer lo que la puerta va a rechazar: antes, decir
    el nombre de una bodega de otra sede la encontraba igual."""
    _asignar("diana", datos_regresion["bodega_asignada_id"])
    headers = _entrar(client, "diana")

    r = client.post("/api/bodegas/abrir", headers=headers,
                    json={"bodega": datos_regresion["bodega_no_asignada"]})
    assert r.status_code in (403, 404), r.text


def test_administrador_de_sede_no_puede_asignarse_bodegas_de_otra_sede(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Sin esto el límite de sede era decorativo: bastaba con asignarse a
    sí mismo las bodegas ajenas para volver a alcanzar todo el parque."""
    from bd import Sesion
    from modelos import AsignacionBodega, Usuario

    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    _asignar("diana", propia)
    headers = _entrar(client, "diana")

    with Sesion() as s:
        diana_id = s.query(Usuario).filter_by(nombre="diana").one().id

    r = client.put(f"/api/usuarios/{diana_id}/bodegas", headers=headers,
                   json={"bodega_ids": [propia, ajena]})
    assert r.status_code == 200, r.text

    with Sesion() as s:
        quedaron = {a.bodega_id for a in
                    s.query(AsignacionBodega).filter_by(usuario_id=diana_id).all()}
    assert quedaron == {propia}, f"se coló una bodega ajena: {quedaron}"

    r = client.get(f"/api/bodegas/{ajena}/detalle", headers=headers)
    assert r.status_code == 403, r.text


def test_administrador_de_sede_no_borra_las_asignaciones_de_otra_sede(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Dos administradores de sedes distintas pueden repartirle bodegas a
    la misma persona: el de una no debe borrar el trabajo del otro al
    guardar su propia lista."""
    from bd import Sesion
    from modelos import AsignacionBodega, Usuario

    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    auxiliar_id = datos_regresion["auxiliar_id"]

    _asignar("diana", propia)
    with Sesion() as s:            # el auxiliar ya trabaja en la otra sede
        s.add(AsignacionBodega(usuario_id=auxiliar_id, bodega_id=ajena))
        s.commit()

    headers = _entrar(client, "diana")
    r = client.put(f"/api/usuarios/{auxiliar_id}/bodegas", headers=headers,
                   json={"bodega_ids": [propia]})
    assert r.status_code == 200, r.text

    with Sesion() as s:
        quedaron = {a.bodega_id for a in
                    s.query(AsignacionBodega).filter_by(usuario_id=auxiliar_id).all()}
    assert quedaron == {propia, ajena}, f"se perdio la otra sede: {quedaron}"
