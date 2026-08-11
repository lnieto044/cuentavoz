"""Infraestructura aislada para las pruebas de regresión de la API."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _descargar_modulos_backend() -> None:
    """Fuerza que cada prueba lea DB_URL antes de crear el motor SQLAlchemy."""
    directos = {"bd", "modelos", "seguridad", "main", "reportes"}
    prefijos = ("agente", "servicios")
    for nombre in list(sys.modules):
        if nombre in directos or nombre.startswith(prefijos):
            sys.modules.pop(nombre, None)


@pytest.fixture
def app_modulos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[object]:
    """Importa una aplicación nueva conectada a un SQLite temporal por prueba."""
    ruta_db = tmp_path / "cuentavoz-pruebas.db"
    monkeypatch.setenv("DB_URL", f"sqlite:///{ruta_db.as_posix()}")
    monkeypatch.setenv("SECRETO_JWT", "secreto-solo-para-pruebas-de-regresion")
    monkeypatch.setenv("MINUTOS_TOKEN", "60")
    _descargar_modulos_backend()

    modulo = importlib.import_module("main")
    try:
        yield modulo
    finally:
        # Libera el archivo SQLite antes de que pytest elimine tmp_path en Windows.
        modulo.Sesion.kw["bind"].dispose() if hasattr(modulo.Sesion, "kw") else None
        _descargar_modulos_backend()


@pytest.fixture
def client(app_modulos: object) -> Iterator[TestClient]:
    """Cliente con el ciclo de vida de FastAPI activo (incluye iniciar_bd)."""
    with TestClient(app_modulos.app) as cliente:
        yield cliente


@pytest.fixture
def datos_regresion(client: TestClient) -> dict[str, object]:
    """Crea un auxiliar, dos bodegas y el mismo artículo en ambas bodegas."""
    from bd import Sesion
    from modelos import (  # Se importan después de fijar DB_URL en app_modulos.
        Articulo,
        AsignacionBodega,
        Bodega,
        StockSistema,
        Usuario,
    )

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        asignada = Bodega(nombre_oficial="BODEGA ASIGNADA")
        no_asignada = Bodega(nombre_oficial="BODEGA RESTRINGIDA")
        articulo = Articulo(codigo="ART-REG-001", nombre_oficial="ARTICULO REGRESION",
                            unidad_medida="unidad")
        sesion.add_all([asignada, no_asignada, articulo])
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=asignada.id))
        sesion.add_all([
            StockSistema(articulo_codigo=articulo.codigo, bodega_id=asignada.id,
                         cantidad_sd=100),
            StockSistema(articulo_codigo=articulo.codigo, bodega_id=no_asignada.id,
                         cantidad_sd=200),
        ])
        sesion.commit()
        datos = {
            "auxiliar_id": auxiliar.id,
            "bodega_asignada_id": asignada.id,
            "bodega_no_asignada_id": no_asignada.id,
            "bodega_asignada": asignada.nombre_oficial,
            "bodega_no_asignada": no_asignada.nombre_oficial,
            "articulo_codigo": articulo.codigo,
        }

    respuesta = client.post(
        "/api/ingresar",
        data={"username": "luis", "password": "StockXperts"},
    )
    assert respuesta.status_code == 200, respuesta.text
    datos["headers"] = {"Authorization": f"Bearer {respuesta.json()['token']}"}
    return datos
