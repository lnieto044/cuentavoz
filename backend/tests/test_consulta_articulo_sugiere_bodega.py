"""/api/articulos/consulta: cuando lo dicho no es un artículo pero sí
parece el nombre de una bodega, debe sugerir su detalle (con el id para
poder verlo) en vez de responder solo "no encontré" - sin esto, alguien
que dice el nombre de una bodega en el buscador de ingredientes (la
pantalla equivocada) se queda sin saber por qué no encontró nada."""
from fastapi.testclient import TestClient


def test_sugiere_la_bodega_asignada_cuando_el_nombre_es_exacto(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    r = client.get(
        "/api/articulos/consulta",
        params={"q": datos_regresion["bodega_asignada"]},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["sugerencia_bodega"] == datos_regresion["bodega_asignada"]
    assert cuerpo["sugerencia_bodega_id"] == datos_regresion["bodega_asignada_id"]


def test_no_le_sugiere_ni_le_nombra_una_bodega_que_no_le_esta_asignada(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """buscar_bodegas_candidatas() no restringe una coincidencia EXACTA
    (para que /abrir pueda decir "existe pero no es suya" en vez de "no
    existe"), pero esta sugerencia es solo informativa - no hay motivo
    para revelarle a un auxiliar el nombre de una bodega ajena aunque la
    haya dicho exacta."""
    r = client.get(
        "/api/articulos/consulta",
        params={"q": datos_regresion["bodega_no_asignada"]},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["sugerencia_bodega"] is None
    assert cuerpo["sugerencia_bodega_id"] is None
    assert datos_regresion["bodega_no_asignada"] not in cuerpo["resumen"]


def test_articulo_real_sigue_funcionando_igual(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Regresión: agregar la sugerencia de bodega no debe tocar el
    camino normal cuando sí se encuentra un artículo de verdad."""
    r = client.get(
        "/api/articulos/consulta",
        params={"q": "articulo regresion"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo.get("codigo") == datos_regresion["articulo_codigo"]
    assert "sugerencia_bodega" not in cuerpo or cuerpo.get("sugerencia_bodega") is None


def test_sin_ningun_parecido_cae_al_agente_general(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Ni artículo ni bodega: en vez de un "no encontré" seco, el mismo
    buscador cae al agente general (ver _resolver_asistente) - un solo
    cuadro que responde preguntas sueltas o navega, no dos cuadros
    separados dando respuestas distintas para lo mismo."""
    r = client.get(
        "/api/articulos/consulta",
        # gibberish elegido para que ninguna de sus palabras sea, ni de
        # casualidad, substring de "BODEGA ASIGNADA"/"BODEGA RESTRINGIDA"
        # (una consulta con palabras reales del español sí puede coincidir
        # por casualidad - "nada" cabe dentro de "asigNADA" - eso no es un
        # bug de esta función, y no es lo que esta prueba busca cubrir).
        params={"q": "qzxjklwvbn tfghqzxjkl"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["sugerencia_bodega"] is None
    assert cuerpo["resumen"]
    assert cuerpo["destino"] != "conteo"


def test_frase_suelta_no_confunde_un_articulo_de_baja_confianza(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """Bug real reportado: decir una frase conversacional ("seguir
    contando", eco de un botón de otra pantalla) coincidía por
    casualidad con un artículo real que comparte una raíz de 4 letras
    (aquí, "SEGUNDOS" comparte "SEGU" con "seguir") - una coincidencia
    de baja confianza que el buscador de Bodegas debe descartar, a
    diferencia de Conteo/Pedido, que sí aceptan ese mismo umbral más
    flojo porque ahí lo dictado siempre es, a propósito, un nombre de
    artículo."""
    from bd import Sesion
    from modelos import Articulo, StockSistema

    with Sesion() as sesion:
        art = Articulo(codigo="ART-REG-002", nombre_oficial="TIMER 60 SEGUNDOS DIGITAL",
                        unidad_medida="unidad")
        sesion.add(art)
        sesion.flush()
        sesion.add(StockSistema(articulo_codigo=art.codigo,
                                bodega_id=datos_regresion["bodega_asignada_id"], cantidad_sd=1))
        sesion.commit()

    r = client.get(
        "/api/articulos/consulta",
        params={"q": "seguir contando"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo.get("codigo") != "ART-REG-002"
    assert "SEGUNDOS" not in (cuerpo.get("resumen") or "")


def test_orden_de_abrir_una_bodega_navega_a_conteo_desde_el_mismo_buscador(
    client: TestClient, datos_regresion: dict[str, object]
) -> None:
    """El mismo buscador de ingredientes también entiende una orden
    explícita de abrir una bodega (no solo sugerirla) - "abra <nombre>"
    no es ni un artículo ni "solo" el nombre de una bodega, así que cae
    al agente general, que sí reconoce el verbo."""
    r = client.get(
        "/api/articulos/consulta",
        params={"q": f"abra {datos_regresion['bodega_asignada']}"},
        headers=datos_regresion["headers"],
    )
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["accion"] == "navegar"
    assert cuerpo["destino"] == "conteo"
    assert cuerpo["bodega"] == datos_regresion["bodega_asignada"]
