"""Coincidencias de artículo por texto dicho/escrito (servicios/conciliacion.py)."""
from servicios.conciliacion import _cobertura, normalizar, puntuar

UMBRAL = 45  # el mismo que usa buscar_articulo() para aceptar un candidato


def test_restaurante_no_confunde_con_costilla_de_res():
    """Decir "restaurante" (buscando una bodega, en la pantalla equivocada)
    no debe encontrar "COSTILLA DE RES" como si fuera un artículo parecido.

    Antes, la raíz de comparación de 4 letras se quedaba corta cuando la
    palabra del catálogo tenía menos de 4 letras ("RES"): "RESTAURANTE"
    empieza igual que "RES" y eso contaba como coincidencia completa, sin
    que las palabras tengan relación alguna."""
    consulta = normalizar("restaurante")
    candidato = normalizar("COSTILLA DE RES")
    assert _cobertura(consulta, candidato) == 0.0
    assert puntuar(consulta, candidato) < UMBRAL


def test_una_palabra_corta_del_catalogo_no_hace_de_raiz_para_cualquier_cosa():
    """Lo mismo, en general: ninguna palabra de 3 letras del catálogo
    (RES, PAN...) debe servir de "raíz" para aceptar una palabra dicha
    mucho más larga solo porque empieza igual."""
    assert _cobertura(normalizar("restaurante"), normalizar("ARROZ RES")) == 0.0
    assert _cobertura(normalizar("paniculado"), normalizar("QUESO PAN")) == 0.0


def test_blanca_sigue_encontrando_blanco():
    """La raíz de 4 letras entre dos palabras largas (>=4) debe seguir
    funcionando igual que antes - lo que se corrigió es solo el caso de
    una palabra del catálogo más corta que la raíz."""
    consulta = normalizar("tabla para picar blanca")
    candidato = normalizar("TABLA PARA PICAR BLANCO")
    assert _cobertura(consulta, candidato) == 100.0


def test_cazuelas_sigue_encontrando_cazuela():
    assert _cobertura(normalizar("cazuelas"), normalizar("CAZUELA DE BARRO")) == 100.0


def test_palabra_dicha_corta_sigue_encontrando_candidato_largo():
    """Que la consulta sea corta (3 letras, "sal") y el candidato largo
    ("SALSA DE TOMATE") es el caso contrario al que causaba el bug, y
    debe seguir funcionando: "SALSA" empieza con la raíz de "sal"."""
    assert _cobertura(normalizar("sal"), normalizar("SALSA DE TOMATE")) == 100.0
