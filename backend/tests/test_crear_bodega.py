"""Regresión de «crear bodega nueva»: un auxiliar la solicita, queda
pendiente de aprobación (igual que un producto nuevo), y solo existe de
verdad - visible y abrible - una vez que el administrador la aprueba."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _ingresar(client: TestClient, usuario: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": usuario, "password": "StockXperts"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_solicitar_bodega_nueva_queda_pendiente_y_no_es_visible_aun(
    client: TestClient,
) -> None:
    headers_luis = _ingresar(client, "luis")

    antes = client.get("/api/bodegas", headers=headers_luis)
    assert "ALMACEN NUEVO PISCILAGO" not in [b["bodega"] for b in antes.json()]

    solicitud = client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
                            json={"nombre": "almacen nuevo piscilago"})
    assert solicitud.status_code == 200, solicitud.text
    assert "pendiente" in solicitud.json()["respuesta_hablada"].lower()

    # todavia no existe como bodega real: sigue sin aparecer en el listado
    despues = client.get("/api/bodegas", headers=headers_luis)
    assert "ALMACEN NUEVO PISCILAGO" not in [b["bodega"] for b in despues.json()]


def test_aprobar_bodega_nueva_la_crea_de_verdad_y_se_puede_abrir(
    client: TestClient,
) -> None:
    headers_luis = _ingresar(client, "luis")
    headers_diana = _ingresar(client, "diana")

    client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
               json={"nombre": "almacen nuevo piscilago"})

    pendientes = client.get("/api/aprobaciones?estado=pendiente", headers=headers_diana)
    assert pendientes.status_code == 200, pendientes.text
    solicitudes = [a for a in pendientes.json() if a["tipo"] == "bodega"]
    assert len(solicitudes) == 1
    assert solicitudes[0]["nombre"] == "ALMACEN NUEVO PISCILAGO"

    aprobar = client.post(f"/api/aprobaciones/{solicitudes[0]['id']}/aprobar",
                          headers=headers_diana)
    assert aprobar.status_code == 200, aprobar.text

    listado = client.get("/api/bodegas", headers=headers_diana)
    nombres = [b["bodega"] for b in listado.json()]
    assert "ALMACEN NUEVO PISCILAGO" in nombres

    # diana es auditora: sin asignacion previa, igual puede abrirla y contar
    abrir = client.post("/api/bodegas/abrir", headers=headers_diana,
                        json={"bodega": "ALMACEN NUEVO PISCILAGO"})
    assert abrir.status_code == 200, abrir.text


def test_no_se_puede_solicitar_una_bodega_que_ya_existe(client: TestClient) -> None:
    headers_luis = _ingresar(client, "luis")

    ya_existe = client.get("/api/bodegas", headers=headers_luis).json()
    if not ya_existe:
        # arranque() solo reparte bodegas si ya hay alguna cargada; si esta
        # base de pruebas no tiene ninguna, no hay nada que probar aqui.
        return
    nombre = ya_existe[0]["bodega"]

    r = client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
                    json={"nombre": nombre})
    assert r.status_code == 409, r.text
