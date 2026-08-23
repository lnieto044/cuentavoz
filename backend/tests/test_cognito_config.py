"""El backend debe saber contra que User Pool trabaja aunque nadie haya
llenado las variables de entorno.

Regresion real: en Render, COGNITO_USER_POOL_ID y COGNITO_APP_CLIENT_ID van
como sync:false (viven solo en el panel). Quedaron vacias, el backend no
pudo construir el verificador de tokens, y TODAS las sesiones se rechazaron
con "Sesion invalida o vencida." - culpando a la persona por un problema de
despliegue. El frontend nunca tuvo ese problema porque siempre llevo estos
valores por defecto (frontend/src/cognito.js).
"""
from __future__ import annotations

import importlib
import sys

import pytest


def _recargar_seguridad():
    for nombre in ("seguridad", "bd", "modelos"):
        sys.modules.pop(nombre, None)
    return importlib.import_module("seguridad")


def test_sin_variables_de_entorno_igual_puede_verificar_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    monkeypatch.delenv("COGNITO_APP_CLIENT_ID", raising=False)
    monkeypatch.delenv("COGNITO_REGION", raising=False)

    seg = _recargar_seguridad()

    assert seg.COGNITO_USER_POOL_ID, "sin pool no se puede verificar nada"
    assert seg.COGNITO_APP_CLIENT_ID, "sin app client todo token se rechaza"
    assert seg.COGNITO_REGION == "us-east-2"
    assert seg._jwks_client is not None


def test_una_variable_vacia_no_deja_el_backend_ciego(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Vacia y ausente son el mismo caso: en Render una variable se puede
    crear con el valor en blanco, que es como quedo en el incidente real."""
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "   ")

    seg = _recargar_seguridad()

    assert seg.COGNITO_USER_POOL_ID == "us-east-2_6HbrPruvL"
    assert seg.COGNITO_APP_CLIENT_ID == "847jtkc5sem7mr4tb8csrrkqp"
    assert seg._jwks_client is not None


def test_la_variable_de_entorno_sigue_mandando(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """El valor por defecto es una red de seguridad, no una imposicion:
    apuntar a otro User Pool (otro entorno, otra cuenta) debe seguir siendo
    solo definir la variable."""
    monkeypatch.setenv("COGNITO_REGION", "us-west-1")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-west-1_otroPool")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "otroclienteid")

    seg = _recargar_seguridad()

    assert seg.COGNITO_USER_POOL_ID == "us-west-1_otroPool"
    assert seg.COGNITO_APP_CLIENT_ID == "otroclienteid"
    assert seg._EMISOR == ("https://cognito-idp.us-west-1.amazonaws.com/"
                           "us-west-1_otroPool")
