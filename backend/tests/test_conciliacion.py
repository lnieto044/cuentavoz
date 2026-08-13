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


def test_palabra_dicha_de_3_letras_ya_no_encuentra_candidato_largo_por_prefijo():
    """El caso contrario al de "restaurante": antes, una palabra DICHA de
    3 letras ("ver", de una frase como "sí para ver el detalle" - no una
    búsqueda real) encontraba cualquier artículo cuyo nombre EMPEZARA
    igual ("VERDE", "VERDURAS"), sin relación alguna. Ahora una palabra
    de 3 letras solo cuenta si coincide EXACTA - "sal" ya no encuentra
    "SALSA" solo por el prefijo (haría falta decir "sal" tal cual, no
    "salsa", para que cuente)."""
    assert _cobertura(normalizar("ver"), normalizar("VERDE")) == 0.0
    assert _cobertura(normalizar("sal"), normalizar("SALSA DE TOMATE")) == 0.0


def test_bug_real_si_para_ver_el_detalle_no_encuentra_un_articulo_al_azar():
    """Bug real reportado: decir "sí para ver el detalle" (el eco de la
    pregunta hablada del selector de bodega, no una búsqueda de
    artículo) encontraba "PASTILLA LIMPIADOR HORNO VERDE BALDEX150"
    porque "ver" es prefijo de "VERDE"."""
    consulta = normalizar("Sí para ver el detalle.")
    candidato = normalizar("PASTILLA LIMPIADOR HORNO VERDE BALDEX150")
    assert _cobertura(consulta, candidato) == 0.0
    assert puntuar(consulta, candidato) < UMBRAL


def test_palabra_dicha_de_4_letras_sigue_encontrando_candidato_largo_por_prefijo():
    """A partir de 4 letras, el prefijo real sigue contando en los dos
    sentidos - eso es lo que hace que BLANCA encuentre BLANCO."""
    assert _cobertura(normalizar("cazu"), normalizar("CAZUELA DE BARRO")) == 100.0
