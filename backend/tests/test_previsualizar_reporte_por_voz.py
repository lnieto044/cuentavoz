"""«Muéstrame el detalle de bodega», sin decir la palabra "archivo" - la
frase más natural para pedir ver un archivo ya generado. Diferencias,
tablero, detalle de bodega y trazabilidad no son el nombre de ninguna
pestaña de Reportes, así que no compiten con ningún cambio de pestaña y
deben abrirse directo. Consolidado y análisis sí son pestañas reales, así
que para esos dos la palabra "archivo" sigue siendo obligatoria - sin
ella, "muéstrame el consolidado" debe seguir cambiando de pestaña en vez
de abrir el archivo."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _ingresar(client: TestClient, usuario: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": usuario, "password": "StockXperts"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _sin_gemini(monkeypatch) -> None:
    import agente.cerebro as cerebro
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(cerebro, "_cliente", None)


def _generar_todos_los_reportes(client: TestClient, headers: dict[str, str]) -> None:
    for metodo, ruta in [
        (client.post, "/api/bodegas/1/exportar-detalle"),
        (client.post, "/api/reportes/diferencias"),
        (client.post, "/api/bodegas/exportar-estado"),
        (client.get, "/api/trazabilidad/exportar"),
        (client.post, "/api/reportes"),
    ]:
        r = metodo(ruta, headers=headers, params={"formato": "xlsx"})
        assert r.status_code == 200, r.text


def test_tipos_que_no_son_pestana_abren_directo_sin_decir_archivo(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "diana")
    _generar_todos_los_reportes(client, headers)

    casos = {
        "muéstrame el detalle de bodega": "Detalle de bodega",
        "ábreme las diferencias": "Diferencias por bodega",
        "muéstrame el estado del tablero": "Estado del tablero",
        "muéstrame la trazabilidad": "Registro de trazabilidad",
    }
    for texto, titulo_esperado in casos.items():
        r = client.post("/api/agente/asistente", headers=headers,
                        json={"texto": texto, "vista": "reportes"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accion"] == "previsualizar_reporte", (texto, d)
        assert d["titulo_archivo"] == titulo_esperado, (texto, d)


def test_consolidado_y_analisis_siguen_exigiendo_archivo_para_desambiguar(
    client: TestClient, monkeypatch
) -> None:
    _sin_gemini(monkeypatch)
    headers = _ingresar(client, "diana")
    _generar_todos_los_reportes(client, headers)

    # Sin "archivo": sigue siendo un cambio de pestaña, no abrir el archivo.
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "muéstrame el consolidado", "vista": "reportes"})
    d = r.json()
    assert d["accion"] == "navegar" and d["pestana"] == "consolidado", d

    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "muéstrame el análisis de consumo", "vista": "reportes"})
    d = r.json()
    assert d["accion"] == "navegar" and d["pestana"] == "analisis", d

    # Con "archivo": sí abre el archivo generado.
    r = client.post("/api/agente/asistente", headers=headers,
                    json={"texto": "muéstrame el archivo del consolidado", "vista": "reportes"})
    d = r.json()
    assert d["accion"] == "previsualizar_reporte"
    assert d["titulo_archivo"] == "Consolidado para My Inventory", d
