"""La sede como entidad propia: agrupa bodegas para poder repartirlas de
una vez, sin tocar quién puede entrar a cuál — eso lo sigue decidiendo
AsignacionBodega, bodega por bodega."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _entrar(client: TestClient, nombre: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": nombre, "password": "StockXperts1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_las_bodegas_que_ya_existian_quedan_sin_sede(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """La migración no puede inventarse una sede para lo que ya estaba: sin
    sede es un estado válido y una bodega así se comporta igual que antes."""
    adm = _entrar(client, "diana")
    r = client.get("/api/sedes", headers=adm)
    assert r.status_code == 200, r.text
    assert r.json()["sedes"] == []
    assert r.json()["bodegas_sin_sede"] >= 2

    bodegas = client.get("/api/bodegas", headers=adm).json()
    assert all(b["sede_id"] is None and b["sede"] is None for b in bodegas)


def test_crear_una_sede_y_meterle_bodegas(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    adm = _entrar(client, "diana")
    r = client.post("/api/sedes", headers=adm,
                    json={"nombre": "piscilago", "ciudad": "Girardot"})
    assert r.status_code == 200, r.text
    sede_id = r.json()["id"]

    propia = datos_regresion["bodega_asignada_id"]
    r = client.put(f"/api/bodegas/{propia}/sede", headers=adm, json={"sede_id": sede_id})
    assert r.status_code == 200, r.text

    listado = client.get("/api/sedes", headers=adm).json()
    fila = next(x for x in listado["sedes"] if x["id"] == sede_id)
    assert fila["nombre"] == "PISCILAGO"      # se guarda en mayúsculas
    assert fila["ciudad"] == "Girardot"
    assert fila["bodegas"] == 1

    bodegas = client.get("/api/bodegas", headers=adm).json()
    b = next(x for x in bodegas if x["id"] == propia)
    assert b["sede"] == "PISCILAGO"


def test_no_se_repite_el_nombre_de_una_sede(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    adm = _entrar(client, "diana")
    assert client.post("/api/sedes", headers=adm, json={"nombre": "Norte"}).status_code == 200
    r = client.post("/api/sedes", headers=adm, json={"nombre": "  norte  "})
    assert r.status_code == 409, r.text


def test_borrar_una_sede_no_se_lleva_las_bodegas(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Mismo principio que en el resto del sistema: borrar una agrupación
    no puede llevarse por delante lo agrupado."""
    adm = _entrar(client, "diana")
    sede_id = client.post("/api/sedes", headers=adm, json={"nombre": "Sur"}).json()["id"]
    propia = datos_regresion["bodega_asignada_id"]
    client.put(f"/api/bodegas/{propia}/sede", headers=adm, json={"sede_id": sede_id})

    r = client.delete(f"/api/sedes/{sede_id}", headers=adm)
    assert r.status_code == 200, r.text
    assert r.json()["bodegas_sin_sede"] == 1

    bodegas = client.get("/api/bodegas", headers=adm).json()
    b = next(x for x in bodegas if x["id"] == propia)
    assert b["sede_id"] is None
    assert b["bodega"]          # la bodega sigue ahí


def test_la_sede_no_da_ni_quita_permisos(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Lo importante de todo esto: meter dos bodegas en la misma sede NO
    hace que quien tiene una alcance la otra. El permiso sigue siendo por
    asignación, no por sede."""
    adm = _entrar(client, "diana")
    sede_id = client.post("/api/sedes", headers=adm, json={"nombre": "Centro"}).json()["id"]
    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    for bid in (propia, ajena):
        assert client.put(f"/api/bodegas/{bid}/sede", headers=adm,
                          json={"sede_id": sede_id}).status_code == 200

    aux = datos_regresion["headers"]              # luis, asignado solo a "propia"
    assert client.get(f"/api/bodegas/{propia}/detalle", headers=aux).status_code == 200
    assert client.get(f"/api/bodegas/{ajena}/detalle", headers=aux).status_code == 403

    visibles = {b["id"] for b in client.get("/api/bodegas", headers=aux).json()}
    assert ajena not in visibles


def test_repartir_una_sede_entera_de_una_vez(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """El motivo por el que la sede existe: /api/sedes/{id}/bodegas da los
    ids para marcarlos todos, en vez de doce clics."""
    from bd import Sesion
    from modelos import AsignacionBodega, Usuario

    adm = _entrar(client, "diana")
    sede_id = client.post("/api/sedes", headers=adm, json={"nombre": "Occidente"}).json()["id"]
    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    for bid in (propia, ajena):
        client.put(f"/api/bodegas/{bid}/sede", headers=adm, json={"sede_id": sede_id})

    ids = client.get(f"/api/sedes/{sede_id}/bodegas", headers=adm).json()
    assert sorted(ids) == sorted([propia, ajena])

    with Sesion() as s:
        objetivo = s.query(Usuario).filter_by(nombre="stephanie").one().id
    r = client.put(f"/api/usuarios/{objetivo}/bodegas", headers=adm,
                   json={"bodega_ids": ids})
    assert r.status_code == 200, r.text

    with Sesion() as s:
        quedaron = {a.bodega_id for a in
                    s.query(AsignacionBodega).filter_by(usuario_id=objetivo).all()}
    assert quedaron == {propia, ajena}


def test_un_administrador_de_sede_solo_ve_lo_suyo_al_repartir(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Coherente con asignar_bodegas: si el PUT le va a filtrar las bodegas
    ajenas, la lista de la sede tampoco debe ofrecérselas."""
    from bd import Sesion
    from modelos import AsignacionBodega, Usuario

    adm = _entrar(client, "diana")
    sede_id = client.post("/api/sedes", headers=adm, json={"nombre": "Mixta"}).json()["id"]
    propia = datos_regresion["bodega_asignada_id"]
    ajena = datos_regresion["bodega_no_asignada_id"]
    for bid in (propia, ajena):
        client.put(f"/api/bodegas/{bid}/sede", headers=adm, json={"sede_id": sede_id})

    with Sesion() as s:                       # diana pasa a ser de una sede
        diana = s.query(Usuario).filter_by(nombre="diana").one()
        s.add(AsignacionBodega(usuario_id=diana.id, bodega_id=propia))
        s.commit()

    adm = _entrar(client, "diana")
    ids = client.get(f"/api/sedes/{sede_id}/bodegas", headers=adm).json()
    assert ids == [propia], f"le ofreció bodegas que no puede repartir: {ids}"


def test_un_auxiliar_no_crea_ni_borra_sedes(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    aux = datos_regresion["headers"]
    assert client.post("/api/sedes", headers=aux, json={"nombre": "X"}).status_code == 403
    assert client.delete("/api/sedes/1", headers=aux).status_code == 403
    # pero sí puede leerlas: son nombres de sitios, y necesita saber de
    # dónde es su bodega
    assert client.get("/api/sedes", headers=aux).status_code == 200
