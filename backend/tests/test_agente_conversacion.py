"""Integración de extremo a extremo del agente conversacional: guía
conversaciones reales por /api/agente/turno. Corre sin GOOGLE_API_KEY a
propósito (usa el intérprete local, determinista) para no depender de una
red externa ni de la variabilidad de un modelo de lenguaje - exactamente
el camino que sostiene la demo si falla el Wi-Fi."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def datos_agente(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Una bodega asignada a luis con dos artículos deliberadamente
    ambiguos (ARROZ / ARROZ BASMATI, el ejemplo documentado en
    orquestador.py) y uno sin ambigüedad (ACEITE), para ejercitar tanto
    el camino directo como la desambiguación."""
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    from bd import Sesion
    from modelos import Articulo, AsignacionBodega, Bodega, StockSistema, Usuario

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        bodega = Bodega(nombre_oficial="BODEGA AGENTE")
        arroz = Articulo(codigo="ARR-001", nombre_oficial="ARROZ", unidad_medida="Kilogram")
        basmati = Articulo(codigo="ARR-002", nombre_oficial="ARROZ BASMATI",
                           unidad_medida="Kilogram")
        aceite = Articulo(codigo="ACE-001", nombre_oficial="ACEITE", unidad_medida="Liter")
        sesion.add_all([bodega, arroz, basmati, aceite])
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=bodega.id))
        sesion.add_all([
            StockSistema(articulo_codigo="ARR-001", bodega_id=bodega.id, cantidad_sd=100),
            StockSistema(articulo_codigo="ARR-002", bodega_id=bodega.id, cantidad_sd=50),
            StockSistema(articulo_codigo="ACE-001", bodega_id=bodega.id, cantidad_sd=100),
        ])
        sesion.commit()
        bodega_id = bodega.id

    respuesta = client.post("/api/ingresar",
                            data={"username": "luis", "password": "StockXperts"})
    assert respuesta.status_code == 200, respuesta.text
    headers = {"Authorization": f"Bearer {respuesta.json()['token']}"}
    return {"headers": headers, "bodega_id": bodega_id}


def _turno(client: TestClient, headers: dict, texto: str, sesion_id: int = 777) -> dict:
    r = client.post("/api/agente/turno", headers=headers,
                    json={"texto": texto, "sesion_id": sesion_id})
    assert r.status_code == 200, r.text
    return r.json()


def _ultimo_conteo(sesion_id: int):
    """_guardar() en orquestador.py escribe Conteo.sesion_id con el mismo
    entero de la conversación que llega a /api/agente/turno (no el id de
    SesionConteo) - se consulta igual aquí."""
    from bd import Sesion
    from modelos import Conteo
    with Sesion() as sesion:
        return (sesion.query(Conteo).filter_by(sesion_id=sesion_id, estado="confirmado")
                .order_by(Conteo.id.desc()).first())


def test_abrir_bodega_y_contar_directo_confirma_y_guarda(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]

    abrir = _turno(client, headers, "iniciar conteo en bodega agente")
    assert abrir["bodega"]["id"] == datos_agente["bodega_id"]

    contar = _turno(client, headers, "hay cien aceites")
    assert contar.get("pendiente") is not None
    assert contar.get("alerta") is None          # coincide exacto con el sistema: sin alerta

    confirmar = _turno(client, headers, "confirmo")
    assert confirmar.get("guardado") is True

    guardado = _ultimo_conteo(777)
    assert guardado is not None
    assert guardado.articulo_codigo == "ACE-001"
    assert guardado.cantidad == 100


def test_abrir_bodega_por_voz_encuentra_el_nombre_aunque_diga_tilde(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bug real reportado desde producción: el catálogo de bodegas viene
    sin tildes del Excel ("ALMACEN SUMINISTROS"), pero el reconocimiento
    de voz transcribe con tilde ("almacén suministros") - antes eso caía
    en "no la encuentro, ¿la creamos?" para una bodega que sí existía."""
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        bodega = Bodega(nombre_oficial="ALMACEN CENTRAL")
        sesion.add(bodega)
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=bodega.id))
        sesion.commit()
        bodega_id = bodega.id

    respuesta = client.post("/api/ingresar",
                            data={"username": "luis", "password": "StockXperts"})
    headers = {"Authorization": f"Bearer {respuesta.json()['token']}"}

    r = _turno(client, headers, "iniciar conteo en almacén central", sesion_id=779)
    assert r.get("intencion") != "crear_bodega", r
    assert r.get("bodega", {}).get("id") == bodega_id, r


def test_abrir_bodega_por_voz_no_confunde_nombres_parecidos(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bug real reportado desde producción: decir "autoservicios las
    fuentes" abría "AUTOSERVICIOS CASCADA" - el respaldo por palabras se
    quedaba con la PRIMERA bodega que contuviera "autoservicios", sin
    llegar a comparar "fuentes" para desempatar."""
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        cascada = Bodega(nombre_oficial="AUTOSERVICIOS CASCADA")
        fuentes = Bodega(nombre_oficial="AUTOSERVICIOS LAS FUENTES")
        sesion.add_all([cascada, fuentes])
        sesion.flush()
        sesion.add_all([
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=cascada.id),
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=fuentes.id),
        ])
        sesion.commit()
        fuentes_id = fuentes.id

    respuesta = client.post("/api/ingresar",
                            data={"username": "luis", "password": "StockXperts"})
    headers = {"Authorization": f"Bearer {respuesta.json()['token']}"}

    r = _turno(client, headers, "iniciar conteo en autoservicios las fuentes", sesion_id=780)
    assert r.get("bodega", {}).get("id") == fuentes_id, r


def test_sin_bodega_abierta_no_deja_contar(client: TestClient, datos_agente: dict) -> None:
    headers = datos_agente["headers"]
    r = _turno(client, headers, "hay diez aceites", sesion_id=778)
    assert "abra una bodega" in r["respuesta_hablada"].lower()
    assert r.get("pendiente") is None


def test_arroz_ambiguo_se_desambigua_y_dispara_desviacion(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]
    sid = 779
    _turno(client, headers, "iniciar conteo en bodega agente", sesion_id=sid)

    ambiguo = _turno(client, headers, "hay noventa arroces", sesion_id=sid)
    assert ambiguo.get("opciones") is not None
    nombres = {o["nombre"] for o in ambiguo["opciones"]}
    assert nombres == {"ARROZ", "ARROZ BASMATI"}

    # el sistema espera 50 de la basmati; decir noventa es una desviación
    # del 80%, muy por encima del umbral - debe alertar y NO auto-confirmar.
    elegido = _turno(client, headers, "la basmati", sesion_id=sid)
    assert elegido.get("alerta") == "desviacion"
    assert elegido["contexto_alerta"]["articulo"] == "ARROZ BASMATI"
    assert elegido.get("guardado") is not True

    confirmar = _turno(client, headers, "confirmo", sesion_id=sid)
    assert confirmar.get("guardado") is True

    guardado = _ultimo_conteo(sid)
    assert guardado.articulo_codigo == "ARR-002"
    assert guardado.cantidad == 90


def test_declina_opciones_con_no_cancela_sin_romper(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]
    sid = 780
    _turno(client, headers, "iniciar conteo en bodega agente", sesion_id=sid)
    ambiguo = _turno(client, headers, "hay noventa arroces", sesion_id=sid)
    assert ambiguo.get("opciones") is not None

    cancelado = _turno(client, headers, "no", sesion_id=sid)
    assert "cancelado" in cancelado["respuesta_hablada"].lower()

    # sin opciones pendientes, un tercer turno normal ya no debe seguir
    # atascado en la desambiguación anterior.
    siguiente = _turno(client, headers, "hay cien aceites", sesion_id=sid)
    assert siguiente.get("pendiente") is not None


def test_corregir_antes_de_confirmar_cambia_la_cantidad_pendiente(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]
    sid = 781
    _turno(client, headers, "iniciar conteo en bodega agente", sesion_id=sid)
    _turno(client, headers, "hay cien aceites", sesion_id=sid)

    corregido = _turno(client, headers, "no, son noventa", sesion_id=sid)
    assert corregido.get("pendiente") is not None

    _turno(client, headers, "confirmo", sesion_id=sid)

    guardado = _ultimo_conteo(sid)
    assert guardado.cantidad == 90          # el valor corregido, no los cien originales


def test_cantidad_negativa_no_se_guarda_y_pide_repetir(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]
    sid = 782
    _turno(client, headers, "iniciar conteo en bodega agente", sesion_id=sid)

    negativo = _turno(client, headers, "hay menos cinco aceites", sesion_id=sid)
    assert negativo.get("alerta") == "negativo"
    assert negativo.get("pendiente") is None

    # nada quedo pendiente: un "confirmo" no debe inventar un guardado.
    confirmar = _turno(client, headers, "confirmo", sesion_id=sid)
    assert confirmar.get("guardado") is not True

    assert _ultimo_conteo(sid) is None


def test_modo_pedido_extrae_preparacion_y_porciones_sin_bodega(
    client: TestClient, datos_agente: dict,
) -> None:
    headers = datos_agente["headers"]
    r = _turno(client, headers, "hoy preparamos cincuenta ajiacos", sesion_id=-777)
    assert r["intencion"] == "pedir"
    assert r["porciones"] == 50
    assert "ajiaco" in (r.get("preparacion") or "").lower()
