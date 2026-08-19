"""Regresión del asistente de voz contextual (Inicio, Ajustes, Ayuda,
Reportes, Panel): sin Gemini configurado, cae al respaldo local que al
menos reconoce «lléveme a X» por palabra clave y nunca ofrece un destino
fuera de lo que el perfil puede ver - ni inventa una respuesta."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _ingresar(client: TestClient, usuario: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": usuario, "password": "StockXperts1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _sin_gemini(monkeypatch) -> None:
    """Mismo patrón que las demás pruebas del agente: el .env real de la
    raíz del repo trae una llave de verdad, así que hay que apagarla a
    mano para que la prueba sea determinista (cae siempre al respaldo)."""
    import agente.cerebro as cerebro
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(cerebro, "_cliente", None)


def test_asistente_navega_por_voz_a_una_pantalla_valida(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "luis")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "lleveme a bodegas", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["accion"] == "navegar"
    assert d["destino"] == "bodegas"


def test_asistente_no_ofrece_a_un_auxiliar_pantallas_de_administrador(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "luis")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "lleveme al panel gerencial", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    # "panel" no está en las pantallas disponibles para un auxiliar: nunca
    # se ofrece como destino, aunque lo haya pedido por su nombre exacto.
    assert not (d["accion"] == "navegar" and d["destino"] == "panel")


def test_asistente_administrador_si_puede_navegar_al_panel(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "diana")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "lleveme al panel", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["accion"] == "navegar"
    assert d["destino"] == "panel"


def test_asistente_sin_gemini_no_inventa_una_respuesta(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "luis")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "cual es el sentido de la vida", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["accion"] is None
    msg = d["respuesta_hablada"].lower()
    assert "sin conexión" in msg or "no pude" in msg


def test_asistente_no_revienta_construyendo_el_contexto_de_ninguna_pantalla(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers_diana = _ingresar(client, "diana")
    for vista in ["inicio", "ajustes", "ayuda", "reportes", "panel"]:
        r = client.post("/api/agente/asistente", headers=headers_diana,
                        json={"texto": "hola", "vista": vista})
        assert r.status_code == 200, f"{vista}: {r.text}"

    headers_luis = _ingresar(client, "luis")
    for vista in ["inicio", "ajustes", "ayuda"]:
        r = client.post("/api/agente/asistente", headers=headers_luis,
                        json={"texto": "hola", "vista": vista})
        assert r.status_code == 200, f"{vista}: {r.text}"


def test_asistente_exige_sesion(client: TestClient) -> None:
    r = client.post("/api/agente/asistente",
                    json={"texto": "hola", "vista": "inicio"})
    assert r.status_code == 401


def test_asistente_navega_directo_a_una_pestana_valida(
    client: TestClient, monkeypatch
) -> None:
    """Pedir "el análisis de consumo" no solo debe llevar a Reportes: debe
    llegar directo a esa pestaña, sin dar clic aparte."""
    import agente.cerebro as cerebro

    def _falso(contexto, frase, destinos, pestanas=None):
        return {"intencion": "navegar", "destino": "reportes", "pestana": "analisis",
                "respuesta_hablada": "Vamos al análisis de consumo."}
    monkeypatch.setattr(cerebro, "pensar_asistente", _falso)

    headers = _ingresar(client, "diana")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "llevame al analisis de consumo", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["accion"] == "navegar"
    assert d["destino"] == "reportes"
    assert d["pestana"] == "analisis"


def test_asistente_descarta_una_pestana_que_no_pertenece_al_destino(
    client: TestClient, monkeypatch
) -> None:
    """Si el modelo se equivoca y devuelve una pestaña que no existe en
    ese destino (o viene de otra pantalla), se descarta en vez de
    mandarla tal cual - nunca abrir una pestaña inexistente."""
    import agente.cerebro as cerebro

    def _falso(contexto, frase, destinos, pestanas=None):
        return {"intencion": "navegar", "destino": "reportes", "pestana": "usuarios",
                "respuesta_hablada": "Vamos a reportes."}
    monkeypatch.setattr(cerebro, "pensar_asistente", _falso)

    headers = _ingresar(client, "diana")
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "llevame a reportes", "vista": "inicio"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["destino"] == "reportes"
    assert d["pestana"] is None
