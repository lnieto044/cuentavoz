"""El cierre de una bodega exige dos firmas: la de quien contó y la de
quien auditó. La segunda la ponía Auditoría; la primera no la ponía
ninguna pantalla, así que ninguna bodega contada llegaba a cerrarse."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _admin(client: TestClient) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": "diana", "password": "StockXperts1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_una_bodega_contada_hoy_se_puede_cerrar(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    propia = datos_regresion["bodega_asignada_id"]
    aux = datos_regresion["headers"]

    r = client.post("/api/bodegas/abrir", headers=aux,
                    json={"bodega": datos_regresion["bodega_asignada"]})
    assert r.status_code == 200, r.text
    sesion_id = r.json()["sesion_id"]

    # la firma del auxiliar: lo que ahora ofrece "Terminar y firmar mi conteo"
    r = client.post(f"/api/sesiones/{sesion_id}/firmar", headers=aux)
    assert r.status_code == 200, r.text

    adm = _admin(client)
    assert client.post(f"/api/bodegas/{propia}/auditoria/iniciar",
                       headers=adm).status_code == 200
    assert client.post(f"/api/bodegas/{propia}/auditoria/firmar",
                       headers=adm).status_code == 200

    f = client.get(f"/api/bodegas/{propia}/firmas", headers=adm).json()
    assert f["lista_para_cerrar"], f

    r = client.post(f"/api/bodegas/{propia}/cerrar", headers=adm)
    assert r.status_code == 200, r.text


def test_sin_la_firma_del_conteo_no_cierra(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """La otra mitad: la doble firma sigue siendo obligatoria."""
    propia = datos_regresion["bodega_asignada_id"]
    client.post("/api/bodegas/abrir", headers=datos_regresion["headers"],
                json={"bodega": datos_regresion["bodega_asignada"]})

    adm = _admin(client)
    client.post(f"/api/bodegas/{propia}/auditoria/iniciar", headers=adm)
    client.post(f"/api/bodegas/{propia}/auditoria/firmar", headers=adm)

    r = client.post(f"/api/bodegas/{propia}/cerrar", headers=adm)
    assert r.status_code == 409, r.text


def test_un_auxiliar_no_firma_el_conteo_de_otro(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    from bd import Sesion
    from modelos import SesionConteo, Usuario

    with Sesion() as s:
        otra = s.query(Usuario).filter_by(nombre="stephanie").one()
        ses = SesionConteo(bodega_id=datos_regresion["bodega_asignada_id"],
                           usuario_id=otra.id, tipo="conteo")
        s.add(ses)
        s.commit()
        ses_id = ses.id

    r = client.post(f"/api/sesiones/{ses_id}/firmar", headers=datos_regresion["headers"])
    assert r.status_code == 403, r.text
