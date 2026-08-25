"""¿Se puede alcanzar una bodega ajena por una puerta que NO recibe un
bodega_id? El chequeo de asignación cubre las rutas /api/bodegas/{id}/...,
pero a una bodega también se llega por el id de sesión y por el respaldo
de resiliencia que el agente de voz acepta del cliente."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def sin_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)


def _entrar2(client: TestClient, nombre: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": nombre, "password": "StockXperts1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_firmar_por_sesion_no_alcanza_una_bodega_ajena(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """/api/sesiones/{id}/firmar deja firmar a cualquier auditor sin mirar
    la bodega: si no comprueba la asignación, el limite por sede que sí
    aplica /api/bodegas/{id}/auditoria/firmar se puede rodear por aquí."""
    from bd import Sesion
    from modelos import AsignacionBodega, SesionConteo, Usuario

    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]

    with Sesion() as s:
        diana = s.query(Usuario).filter_by(nombre="diana").one()
        s.add(AsignacionBodega(usuario_id=diana.id, bodega_id=propia))
        sesion_ajena = SesionConteo(bodega_id=ajena, usuario_id=diana.id, tipo="auditoria")
        s.add(sesion_ajena)
        s.commit()
        sesion_ajena_id = sesion_ajena.id

    headers = _entrar2(client, "diana")
    r = client.post(f"/api/sesiones/{sesion_ajena_id}/firmar", headers=headers)
    assert r.status_code == 403, (
        f"un administrador de sede firmo una sesion de otra sede: {r.status_code}")


def test_el_respaldo_del_agente_no_abre_una_bodega_ajena(
    client: TestClient, datos_regresion: dict[str, object], sin_gemini: None
) -> None:
    """El agente acepta bodega_id_respaldo del cliente para sobrevivir a un
    reinicio del backend. Si no comprueba la asignación, basta con mandar
    el id de una bodega ajena para quedar "dentro" de ella y contarle
    encima, sin haber pasado nunca por /api/bodegas/abrir."""
    from bd import Sesion
    from modelos import Conteo

    headers = datos_regresion["headers"]          # luis, auxiliar
    ajena = datos_regresion["bodega_no_asignada_id"]
    nombre_ajena = datos_regresion["bodega_no_asignada"]

    r = client.post("/api/agente/turno", headers=headers,
                    json={"texto": "hay treinta unidades de articulo regresion",
                          "sesion_id": 4242,
                          "bodega_id_respaldo": ajena,
                          "bodega_nombre_respaldo": nombre_ajena})
    assert r.status_code in (200, 403), r.text
    # confirmar, por si el agente pidio confirmacion antes de guardar
    client.post("/api/agente/turno", headers=headers,
                json={"texto": "si confirmo", "sesion_id": 4242,
                      "bodega_id_respaldo": ajena,
                      "bodega_nombre_respaldo": nombre_ajena})

    with Sesion() as s:
        filas = s.query(Conteo).filter_by(sesion_id=4242).all()
    assert not filas,         f"se conto en una bodega ajena por el respaldo del agente: {len(filas)} filas"

    avance = client.get("/api/sesiones/4242/avance", headers=headers)
    if avance.status_code == 200:
        assert avance.json().get("bodega") != nombre_ajena,             "el respaldo dejo a luis dentro de una bodega ajena"


def test_ver_avance_no_expone_la_sesion_de_otra_persona(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """/api/sesiones/{id}/avance no mira de quien es la sesion: devuelve el
    nombre de la bodega y los ultimos articulos contados a quien pregunte."""
    from bd import Sesion
    from modelos import SesionConteo, Usuario

    ajena = datos_regresion["bodega_no_asignada_id"]
    with Sesion() as s:
        otra = s.query(Usuario).filter_by(nombre="stephanie").one()
        ses = SesionConteo(bodega_id=ajena, usuario_id=otra.id, tipo="conteo")
        s.add(ses)
        s.commit()
        ses_id = ses.id

    headers = datos_regresion["headers"]          # luis, que no tiene nada que ver
    r = client.get(f"/api/sesiones/{ses_id}/avance", headers=headers)
    assert r.status_code == 403, \
        f"luis vio el avance de la sesion de stephanie: {r.status_code} {r.text}"


def test_no_se_puede_contar_en_la_sesion_abierta_de_otra_persona(
    client: TestClient, datos_regresion: dict[str, object], sin_gemini: None
) -> None:
    """Ni siquiera hace falta el respaldo: si el id de sesión no se
    comprueba, basta con mandar el de la sesión que otra persona tiene
    abierta para contarle encima en su bodega."""
    from bd import Sesion
    from modelos import Conteo, SesionConteo, Usuario

    ajena = datos_regresion["bodega_no_asignada_id"]
    with Sesion() as s:
        otra = s.query(Usuario).filter_by(nombre="stephanie").one()
        ses = SesionConteo(bodega_id=ajena, usuario_id=otra.id, tipo="conteo")
        s.add(ses)
        s.commit()
        ses_id = ses.id

    headers = datos_regresion["headers"]          # luis
    client.post("/api/agente/turno", headers=headers,
                json={"texto": "hay treinta unidades de articulo regresion",
                      "sesion_id": ses_id})
    client.post("/api/agente/turno", headers=headers,
                json={"texto": "si confirmo", "sesion_id": ses_id})

    with Sesion() as s:
        filas = s.query(Conteo).filter_by(sesion_id=ses_id).all()
    assert not filas, f"luis conto en la sesion de stephanie: {len(filas)} filas"


def test_no_se_puede_crear_un_producto_en_la_sesion_de_otra_persona(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """/api/conteo/crear-producto saca la bodega del mismo ESTADOS por el
    sesion_id que manda el cliente: sin comprobarlo, se le podía inyectar
    un producto al conteo que otra persona tiene abierto."""
    from bd import Sesion
    from modelos import Conteo, SesionConteo, Usuario

    ajena = datos_regresion["bodega_no_asignada_id"]
    with Sesion() as s:
        otra = s.query(Usuario).filter_by(nombre="stephanie").one()
        ses = SesionConteo(bodega_id=ajena, usuario_id=otra.id, tipo="conteo")
        s.add(ses)
        s.commit()
        ses_id = ses.id

    import main as modulo
    modulo.ESTADOS[ses_id] = {"bodega_id": ajena, "bodega_nombre": "X"}

    r = client.post("/api/conteo/crear-producto", headers=datos_regresion["headers"],
                    json={"nombre": "producto colado", "unidad_medida": "unidad",
                          "cantidad_inicial": 5, "sesion_id": ses_id})
    assert r.status_code == 403, f"luis creo un producto en la sesion ajena: {r.text}"

    with Sesion() as s:
        assert not s.query(Conteo).filter_by(sesion_id=ses_id).all()
