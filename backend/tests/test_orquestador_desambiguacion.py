"""Regresiones de la desambiguación de artículos: pattern matching hecho a
mano (posición dictada, código, nombre exacto, palabra distintiva) que es
justo lo que una frase improvisada en vivo puede romper. Son funciones
puras (sin base de datos), así que se prueban directo."""
from __future__ import annotations

from agente.orquestador import _elegir, _resolver_candidato


def _cand(codigo, nombre, confianza):
    return {"codigo": codigo, "nombre": nombre, "unidad": "Unidad", "confianza": confianza}


# ─────────────────────── _resolver_candidato ───────────────────────

def test_sin_candidatos_es_vacio():
    assert _resolver_candidato([]) == ("vacio", None)


def test_un_candidato_con_confianza_alta_es_directo():
    cand = [_cand("A1", "ACEITE", 95)]
    assert _resolver_candidato(cand) == ("directo", cand[0])


def test_un_candidato_con_confianza_baja_no_es_seguro():
    # ej. "consultemos" coincidiendo por casualidad con "consumibles"
    cand = [_cand("A1", "CONSUMIBLES VARIOS", 40)]
    resultado, dato = _resolver_candidato(cand)
    assert resultado == "no_seguro"
    assert dato is None


def test_dos_candidatos_lejos_en_confianza_es_directo():
    cand = [_cand("A1", "ACEITE DE OLIVA", 95), _cand("A2", "ACEITE DE GIRASOL", 60)]
    assert _resolver_candidato(cand) == ("directo", cand[0])


def test_arroz_contra_arroz_basmati_es_ambiguo():
    # el caso documentado en el código: ambos casi empatados al 100
    cand = [_cand("A1", "ARROZ", 100), _cand("A2", "ARROZ BASMATI", 95)]
    resultado, dato = _resolver_candidato(cand)
    assert resultado == "ambiguo"
    assert dato == cand[:2]


def test_primer_candidato_bajo_umbral_medio_no_es_seguro_aunque_haya_varios():
    cand = [_cand("A1", "X", 50), _cand("A2", "Y", 45)]
    resultado, _ = _resolver_candidato(cand)
    assert resultado == "no_seguro"


# ─────────────────────── _elegir ───────────────────────

OPCIONES = [
    {"codigo": "A1", "nombre": "ARROZ", "unidad": "Kilogram", "confianza": 100},
    {"codigo": "A2", "nombre": "ARROZ BASMATI", "unidad": "Kilogram", "confianza": 95},
]


def test_elegir_por_codigo_dictado():
    assert _elegir("es el A2", OPCIONES) == OPCIONES[1]


def test_elegir_por_posicion_primera():
    for frase in ("la primera", "el primero", "la uno"):
        assert _elegir(frase, OPCIONES) == OPCIONES[0]


def test_elegir_por_posicion_segunda():
    for frase in ("la segunda", "el segundo", "la dos"):
        assert _elegir(frase, OPCIONES) == OPCIONES[1]


def test_elegir_por_nombre_exacto_de_la_opcion_contenida():
    # "arroz" a secas coincide exacto con el conjunto de palabras de ARROZ,
    # no con el de ARROZ BASMATI (que tiene una palabra de más)
    assert _elegir("arroz", OPCIONES) == OPCIONES[0]


def test_elegir_por_palabra_distintiva():
    assert _elegir("la basmati", OPCIONES) == OPCIONES[1]


def test_elegir_sin_coincidencia_devuelve_none():
    assert _elegir("ninguna de esas", OPCIONES) is None


def test_elegir_con_lista_vacia_devuelve_none():
    assert _elegir("la primera", []) is None


def test_elegir_segunda_no_aplica_con_una_sola_opcion():
    una = [OPCIONES[0]]
    assert _elegir("la segunda", una) is None
