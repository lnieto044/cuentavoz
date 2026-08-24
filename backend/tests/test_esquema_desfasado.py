"""El esquema real debe seguir al modelo, no solo al crearse.

Regresion real y cara: al pasar la identidad a Cognito, Usuario.clave_hash
paso a nullable=True en el modelo (ya nadie la llena, la clave la guarda
Cognito), pero la tabla de Postgres ya desplegada conservo su NOT NULL de
origen - _migrar_columnas_faltantes solo AGREGA columnas, nunca relaja una
restriccion. Resultado: en produccion fallaba CADA insercion de usuario
(autoregistro y "crear usuario" desde Ajustes) con un 500. En local no se
veia porque cuentavoz.db se recrea de cero en cada prueba.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_crear_usuario_no_necesita_clave_hash(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La clave la guarda Cognito: insertar un Usuario sin clave_hash tiene
    que funcionar. Si alguien le devuelve el nullable=False al modelo, esto
    lo caza antes de que llegue a produccion."""
    import main as modulo
    from modelos import Usuario
    assert Usuario.__table__.c.clave_hash.nullable, (
        "clave_hash debe seguir siendo opcional: la identidad la maneja "
        "Cognito y ningun INSERT la llena")

    # crear en Cognito de verdad exigiria AWS; aqui interesa la insercion local
    monkeypatch.setattr(modulo, "_crear_usuario_cognito", lambda *a, **k: True)

    r = client.post("/api/usuarios",
                    headers={"Authorization": "Bearer diana"},
                    json={"nombre": "recien_creada", "perfil": "auxiliar",
                          "correo": "recien@ejemplo.com", "pin": "ClaveDemo1234"})
    assert r.status_code == 200, r.text

    from bd import Sesion
    with Sesion() as s:
        fila = s.query(Usuario).filter_by(nombre="recien_creada").one()
        assert fila.clave_hash is None


def test_el_autoregistro_inserta_sin_clave_hash(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    r = client.post("/api/registro-completado",
                    headers={"Authorization": "Bearer autoregistrada"},
                    json={"nombre_completo": "Auto Registrada",
                          "correo": "auto@ejemplo.com"})
    assert r.status_code == 200, r.text

    from bd import Sesion
    from modelos import Usuario
    with Sesion() as s:
        fila = s.query(Usuario).filter_by(nombre="autoregistrada").one()
        assert fila.clave_hash is None
        assert fila.activo == 0 and fila.aprobado == 0


def test_un_500_llega_con_cabeceras_cors(app_modulos: object) -> None:
    """Sin cabeceras CORS, el navegador bloquea la respuesta entera y fetch
    lanza un TypeError indistinguible de quedarse sin red - por eso un 500
    de verdad se veia en pantalla como "Sin conexion con el servidor.
    Revise el Wi-Fi", mandando a buscar el problema en el router."""
    modulo = app_modulos
    origen = next(iter(modulo._origenes))

    @modulo.app.get("/api/_prueba_explota")
    def _explota():
        raise RuntimeError("fallo a proposito")

    # raise_server_exceptions=False para que el cliente devuelva la respuesta
    # 500 tal como la veria un navegador, en vez de relanzar la excepcion.
    with TestClient(modulo.app, raise_server_exceptions=False) as cliente:
        r = cliente.get("/api/_prueba_explota", headers={"Origin": origen})

    assert r.status_code == 500
    assert r.json()["detail"] == "Ocurrió un error inesperado. Intente de nuevo."
    assert r.headers.get("access-control-allow-origin") == origen
