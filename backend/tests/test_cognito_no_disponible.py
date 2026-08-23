"""Cuando Cognito no responde, el token NO es invalido: es el backend el que
no pudo comprobarlo.

Regresion real, vista en produccion (Render): un tropiezo de red al traer el
JWKS de AWS terminaba en 401 "Sesion invalida o vencida.", y como el frontend
cierra la sesion ante cualquier 401 (api.js: alSesionInvalida), sacaba a la
persona de la aplicacion por un problema que no era suyo. Debe responder 503.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_fallo_de_red_contra_cognito_responde_503_y_no_401(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import seguridad

    def _cognito_caido(token):
        raise seguridad.ServicioIdentidadCaido("no se pudo conectar al JWKS")

    monkeypatch.setattr(seguridad, "_reclamos_cognito", _cognito_caido)

    r = client.get("/api/usuarios/yo", headers=datos_regresion["headers"])

    # 503, NO 401: el frontend solo cierra la sesion ante un 401, asi que
    # este codigo es justamente lo que evita el cierre de sesion indebido.
    assert r.status_code == 503, r.text
    assert "Intente de nuevo" in r.json()["detail"]


def test_un_token_de_verdad_invalido_sigue_dando_401(
    client: TestClient, datos_regresion: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El arreglo no debe ablandar la seguridad: si el token es malo, sigue
    siendo 401 - solo cambia el caso en que la falla es de infraestructura."""
    import seguridad

    monkeypatch.setattr(seguridad, "_reclamos_cognito", lambda token: None)
    r = client.get("/api/usuarios/yo", headers=datos_regresion["headers"])
    assert r.status_code == 401, r.text
    assert r.json()["detail"] == "Sesion invalida o vencida."


def test_un_tropiezo_pasajero_se_reintenta_y_sale_bien(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Si el primer intento falla por red pero el segundo funciona, la llave
    se obtiene igual - sin que la persona se entere de nada."""
    import seguridad
    from jwt.exceptions import PyJWKClientConnectionError

    class _FallaUnaVez:
        def __init__(self):
            self.intentos = 0

        def get_signing_key_from_jwt(self, token):
            self.intentos += 1
            if self.intentos == 1:
                raise PyJWKClientConnectionError("tropiezo pasajero")
            class _Llave:
                key = "llave-de-prueba"
            return _Llave()

    falso = _FallaUnaVez()
    monkeypatch.setattr(seguridad, "_jwks_client", falso)

    assert seguridad._llave_de_firma("token-cualquiera") == "llave-de-prueba"
    assert falso.intentos == 2


def test_si_cognito_no_responde_nunca_se_levanta_la_excepcion_propia(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Dos fallos seguidos de red sí deben rendirse - pero con la excepción
    que usuario_actual sabe convertir en 503, no en un 401 engañoso."""
    import seguridad
    from jwt.exceptions import PyJWKClientConnectionError

    class _SiempreCaido:
        def __init__(self):
            self.intentos = 0

        def get_signing_key_from_jwt(self, token):
            self.intentos += 1
            raise PyJWKClientConnectionError("caido")

    caido = _SiempreCaido()
    monkeypatch.setattr(seguridad, "_jwks_client", caido)

    with pytest.raises(seguridad.ServicioIdentidadCaido):
        seguridad._llave_de_firma("token-cualquiera")
    assert caido.intentos == 2
