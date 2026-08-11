"""Regresiones del intérprete local: el respaldo que sostiene la demo si
falla el Wi-Fi o no hay llave de Gemini. Es reconocimiento de palabras
clave, no NLU real - por eso necesita cobertura explícita de cada intención
y de las formas de decir números que ya se sabe que aparecen en la demo."""
from __future__ import annotations

from servicios.interprete import interpretar_local, normalizar_unidad


# ─────────────────────────── números ───────────────────────────

def test_numero_digito_simple():
    assert interpretar_local("hay 12 arroces")["cantidad"] == 12


def test_numero_decimal_con_punto():
    assert interpretar_local("hay 2.5 kilos de arroz")["cantidad"] == 2.5


def test_numero_decimal_con_coma():
    assert interpretar_local("hay 2,5 kilos de arroz")["cantidad"] == 2.5


def test_numero_negativo_con_menos():
    assert interpretar_local("hay menos 5 cazuelas")["cantidad"] == -5


def test_numero_en_palabras_simple():
    assert interpretar_local("hay cinco cazuelas")["cantidad"] == 5


def test_numero_compuesto_decena_y_unidad():
    # "treinta y cinco" -> 35
    assert interpretar_local("hay treinta y cinco tablas")["cantidad"] == 35


def test_numero_compuesto_centena_y_decena():
    # "ciento ochenta" -> 180
    assert interpretar_local("hay ciento ochenta unidades")["cantidad"] == 180


def test_numero_en_palabras_mil():
    assert interpretar_local("hay mil servilletas")["cantidad"] == 1000


def test_numero_en_palabras_con_menos():
    assert interpretar_local("hay menos cinco cazuelas")["cantidad"] == -5


def test_sin_numero_ni_palabra_clave_cae_en_ayuda():
    # sin número reconocible ni ninguna palabra clave, cae en el
    # "no le entendí" por defecto en vez de fingir una cantidad.
    r = interpretar_local("no logro ver nada aqui")
    assert r["intencion"] == "ayuda"
    assert r.get("cantidad") is None


# ─────────────────────────── unidades ───────────────────────────

def test_unidad_kilo_variantes():
    for palabra in ("kilo", "kilos", "kilogramo", "kilogramos", "kg"):
        assert interpretar_local(f"hay 3 {palabra} de arroz")["unidad"] == "Kilogram"


def test_unidad_litro_variantes():
    for palabra in ("litro", "litros", "l"):
        assert interpretar_local(f"hay 3 {palabra} de aceite")["unidad"] == "Liter"


def test_unidad_no_reconocida_es_none():
    assert interpretar_local("hay 3 cazuelas blancas")["unidad"] is None


def test_normalizar_unidad_pasa_canonicas_intactas():
    assert normalizar_unidad("Kilogram") == "Kilogram"


def test_normalizar_unidad_traduce_lo_dicho():
    assert normalizar_unidad("kilos") == "Kilogram"
    assert normalizar_unidad("litros") == "Liter"
    assert normalizar_unidad("unidades") == "Unidad"
    assert normalizar_unidad("porciones") == "Portion"


def test_normalizar_unidad_desconocida_se_devuelve_igual():
    assert normalizar_unidad("bultos") == "bultos"


def test_normalizar_unidad_vacia():
    assert normalizar_unidad(None) is None
    assert normalizar_unidad("") == ""


# ─────────────────────────── intenciones ───────────────────────────

def test_intencion_navegar_iniciar_conteo():
    r = interpretar_local("iniciar conteo en almacen ayb")
    assert r["intencion"] == "navegar"
    assert "almacen ayb" in r["bodega_texto"] or "ayb" in r["bodega_texto"]


def test_intencion_navegar_abrir_bodega():
    r = interpretar_local("abrir bodega restaurante fuentes")
    assert r["intencion"] == "navegar"


def test_intencion_pedir_con_porciones():
    r = interpretar_local("hoy preparamos cincuenta ajiacos")
    assert r["intencion"] == "pedir"
    assert r["porciones"] == 50


def test_intencion_pedir_sin_porciones_queda_en_cero():
    r = interpretar_local("vamos a preparar sancocho")
    assert r["intencion"] == "pedir"
    assert r["porciones"] == 0


def test_intencion_confirmar_variantes():
    for frase in ("confirmo", "si", "sí", "correcto"):
        assert interpretar_local(frase)["intencion"] == "confirmar"


def test_intencion_corregir_variantes():
    for frase in ("no son esos, corregir", "uy no, esta mal", "cambiar la cantidad"):
        assert interpretar_local(frase)["intencion"] == "corregir"


def test_intencion_consultar():
    r = interpretar_local("cuanto arroz hay")
    assert r["intencion"] == "consultar"
    assert "arroz" in r["articulo_texto"]


def test_intencion_reporte():
    for frase in ("generame el reporte", "el consolidado por favor", "imprimeme el archivo"):
        assert interpretar_local(frase)["intencion"] == "reporte"


def test_intencion_ayuda_explicita():
    for frase in ("ayuda", "no entiendo"):
        assert interpretar_local(frase)["intencion"] == "ayuda"


def test_intencion_contar_con_cantidad_y_articulo():
    r = interpretar_local("hay noventa cazuelas blancas")
    assert r["intencion"] == "contar"
    assert r["cantidad"] == 90
    assert "cazuelas" in r["articulo_texto"] or "blancas" in r["articulo_texto"]


def test_intencion_desconocida_pide_repetir():
    r = interpretar_local("xyzzy blorp qwerty")
    assert r["intencion"] == "ayuda"
    assert "repite" in r["respuesta_hablada"].lower()


def test_articulo_texto_sin_ruido_quita_palabras_vacias():
    r = interpretar_local("hay noventa cazuelas blancas")
    for palabra_vacia in ("hay", "noventa"):
        assert palabra_vacia not in r["articulo_texto"].split()
