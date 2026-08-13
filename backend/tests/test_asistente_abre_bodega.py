"""/api/agente/asistente, desde la pantalla Bodegas: decir "abra/siga
contando <nombre>" debe resolver la bodega y mandar a Conteo con ella ya
lista - sin esto, Bodegas era la única pantalla con "Pregúntele al
agente" que no podía de verdad actuar, solo responder preguntas."""
from fastapi.testclient import TestClient


def test_abre_la_bodega_asignada_al_decir_el_verbo_y_el_nombre(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    r = client.post(
        "/api/agente/asistente",
        json={"texto": f"abra {datos_regresion['bodega_asignada']}", "vista": "bodegas"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["accion"] == "navegar"
    assert cuerpo["destino"] == "conteo"
    assert cuerpo["bodega"] == datos_regresion["bodega_asignada"]


def test_sin_verbo_de_abrir_no_navega_solo_por_decir_el_nombre(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Decir el nombre de una bodega a secas podría ser una PREGUNTA
    sobre ella ("¿cómo va bodega asignada?"), no una orden de ir a
    contarla - sin el verbo, no debe forzar la navegación."""
    r = client.post(
        "/api/agente/asistente",
        json={"texto": datos_regresion["bodega_asignada"], "vista": "bodegas"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["destino"] != "conteo"


def test_verbo_sin_nombre_reconocible_no_navega(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    r = client.post(
        "/api/agente/asistente",
        json={"texto": "abra qzxjklwvbn tfghqzxjkl", "vista": "bodegas"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["destino"] != "conteo"


def test_solo_aplica_en_la_pantalla_bodegas(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """El mismo texto en otra pantalla (ej. Inicio) no debe disparar el
    atajo de abrir bodega - ahí "abra X" no tiene el mismo sentido."""
    r = client.post(
        "/api/agente/asistente",
        json={"texto": f"abra {datos_regresion['bodega_asignada']}", "vista": "inicio"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["destino"] != "conteo" or "bodega" not in cuerpo
