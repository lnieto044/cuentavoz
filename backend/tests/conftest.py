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


def _reclamos_prueba(token: str) -> dict[str, object] | None:
    """Reemplaza la verificacion real de un access token de Cognito (que
    exigiria red y un User Pool de verdad) por una regla trivial: el
    "token" que emite /api/ingresar de prueba (ver mas abajo) ES el
    nombre de usuario, y aqui simplemente se acepta tal cual - las
    pruebas de este archivo verifican la logica de negocio (permisos,
    asignaciones, agente...), no la integracion real con Cognito, que
    ya se probo a mano contra el User Pool real."""
    if not token:
        return None
    return {"username": token, "token_use": "access", "client_id": "prueba"}


@pytest.fixture
def app_modulos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[object]:
    """Importa una aplicación nueva conectada a un SQLite temporal por prueba."""
    ruta_db = tmp_path / "cuentavoz-pruebas.db"
    monkeypatch.setenv("DB_URL", f"sqlite:///{ruta_db.as_posix()}")
    monkeypatch.setenv("COGNITO_REGION", "us-east-2")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-2_pruebas")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "prueba")
    # datos_regresion (mas abajo) espera encontrar a "luis" ya creado por
    # arranque() - explicito aqui, no implicito via un .env de desarrollo
    # que quien corra esto en otra maquina o en CI no tiene por que tener.
    monkeypatch.setenv("SEMBRAR_DEMO", "1")
    _descargar_modulos_backend()

    modulo = importlib.import_module("main")
    # main.py hace "from seguridad import usuario_actual, ..." (no "import
    # seguridad"), asi que hay que importar el modulo aparte para parchar
    # _reclamos_cognito - sys.modules ya tiene la MISMA instancia que main
    # uso, importlib no la vuelve a crear.
    modulo_seguridad = importlib.import_module("seguridad")
    monkeypatch.setattr(modulo_seguridad, "_reclamos_cognito", _reclamos_prueba)

    from fastapi import Form

    @modulo.app.post("/api/ingresar")
    def _ingresar_prueba(username: str = Form(...), password: str = Form(...)):
        """Solo para pruebas: en la app real el login lo hace Cognito
        directo desde el frontend (ver cognito.js), este backend nunca
        recibe una clave. Emite un "token" de prueba que _reclamos_prueba
        acepta, para no reescribir cada prueba que necesita una sesión."""
        from fastapi import HTTPException
        with modulo.Sesion() as s:
            u = s.query(modulo.Usuario).filter_by(nombre=username.lower()).first()
        if u is None or not u.activo:
            raise HTTPException(401, "Usuario o clave incorrectos.")
        return {"token": u.nombre, "perfil": u.perfil}

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
        data={"username": "luis", "password": "StockXperts1"},
    )
    assert respuesta.status_code == 200, respuesta.text
    datos["headers"] = {"Authorization": f"Bearer {respuesta.json()['token']}"}
    return datos
