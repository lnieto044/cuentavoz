"""Regresiones del «pensar» del agente: la limpieza de negaciones (para que
"no quiero preparar arroz" nunca se lea como un pedido de arroz) y la
degradación a respaldo local cuando no hay llave de Gemini - la garantía
de que la demo no se cae por falta de internet."""
from __future__ import annotations

import pytest

from agente.cerebro import _limpiar_si_niega, pensar


# ─────────────────────── _limpiar_si_niega ───────────────────────

def test_niega_pedido_borra_preparacion_y_baja_intencion():
    datos = {"intencion": "pedir", "preparacion": "ARROZ", "porciones": 4,
             "articulo_texto": None, "cantidad": None}
    _limpiar_si_niega("no quiero preparar arroz", datos)
    assert datos["intencion"] == "explicar"
    assert datos["preparacion"] is None
    assert datos["porciones"] is None


def test_niega_conteo_borra_articulo_y_cantidad():
    datos = {"intencion": "contar", "articulo_texto": "ARROZ", "cantidad": 5,
             "preparacion": None, "porciones": None}
    _limpiar_si_niega("ya no necesito eso", datos)
    assert datos["intencion"] == "explicar"
    assert datos["articulo_texto"] is None
    assert datos["cantidad"] is None


@pytest.mark.parametrize("frase", [
    "cancela el ajiaco", "cancelar el pedido", "quitalo de la lista",
    "no me sirve ese", "olvida eso", "no es arroz",
])
def test_frases_de_negacion_reconocidas(frase):
    datos = {"intencion": "pedir", "preparacion": "ALGO", "porciones": 1,
             "articulo_texto": None, "cantidad": None}
    _limpiar_si_niega(frase, datos)
    assert datos["preparacion"] is None


def test_frase_sin_negacion_no_se_toca():
    datos = {"intencion": "pedir", "preparacion": "ARROZ", "porciones": 4,
             "articulo_texto": None, "cantidad": None}
    _limpiar_si_niega("hoy preparamos arroz para cuatro", datos)
    assert datos["intencion"] == "pedir"
    assert datos["preparacion"] == "ARROZ"
    assert datos["porciones"] == 4


def test_intencion_distinta_de_pedir_o_contar_no_se_degrada():
    # una negación limpia los campos igual, pero no toca intenciones que
    # ya no son "pedir"/"contar" (ej. "consultar" no debe volverse "explicar").
    datos = {"intencion": "consultar", "preparacion": None, "porciones": None,
             "articulo_texto": "ARROZ", "cantidad": None}
    _limpiar_si_niega("no quiero ese, mejor cancelalo", datos)
    assert datos["intencion"] == "consultar"
    assert datos["articulo_texto"] is None


# ─────────────────────── pensar(): respaldo sin Gemini ───────────────────────

def test_pensar_sin_llave_cae_al_interprete_local(monkeypatch):
    """Sin GOOGLE_API_KEY, pensar() no debe lanzar ni bloquear la
    conversación: debe devolver exactamente lo que interpretaría el
    intérprete local, con su propio mensaje hablado de aviso."""
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    resultado = pensar("Bodega activa: ninguna.", "hay noventa cazuelas")

    assert resultado["intencion"] == "contar"
    assert resultado["cantidad"] == 90
    assert "llave" in resultado["respuesta_hablada"].lower()


def test_pensar_sin_llave_reconoce_confirmacion(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    import agente.cerebro as cerebro
    monkeypatch.setattr(cerebro, "_cliente", None)

    resultado = pensar("Pendiente de confirmar: arroz 90.", "confirmo")
    assert resultado["intencion"] == "confirmar"
