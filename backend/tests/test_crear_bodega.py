"""Regresión de «crear bodega nueva»: un auxiliar la solicita, queda
pendiente de aprobación (igual que un producto nuevo), y solo existe de
verdad - visible y abrible - una vez que el administrador la aprueba."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _ingresar(client: TestClient, usuario: str) -> dict[str, str]:
    r = client.post("/api/ingresar", data={"username": usuario, "password": "StockXperts"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_solicitar_bodega_nueva_queda_pendiente_y_no_es_visible_aun(
    client: TestClient,
) -> None:
    headers_luis = _ingresar(client, "luis")

    antes = client.get("/api/bodegas", headers=headers_luis)
    assert "ALMACEN NUEVO PISCILAGO" not in [b["bodega"] for b in antes.json()]

    solicitud = client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
                            json={"nombre": "almacen nuevo piscilago"})
    assert solicitud.status_code == 200, solicitud.text
    assert "pendiente" in solicitud.json()["respuesta_hablada"].lower()

    # todavia no existe como bodega real: sigue sin aparecer en el listado
    despues = client.get("/api/bodegas", headers=headers_luis)
    assert "ALMACEN NUEVO PISCILAGO" not in [b["bodega"] for b in despues.json()]


def test_solicitar_bodega_nueva_quita_el_punto_del_reconocimiento_de_voz(
    client: TestClient,
) -> None:
    """Bug real reportado desde producción: el reconocimiento de voz
    cierra la frase con un punto ("Juguetería.") que nadie dijo, y
    quedaba guardado tal cual en el catálogo para siempre."""
    headers_luis = _ingresar(client, "luis")
    r = client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
                    json={"nombre": "Juguetería."})
    assert r.status_code == 200, r.text

    headers_diana = _ingresar(client, "diana")
    pendientes = client.get("/api/aprobaciones?estado=pendiente", headers=headers_diana).json()
    nombres = [a["nombre"] for a in pendientes if a["tipo"] == "bodega"]
    assert "JUGUETERÍA" in nombres
    assert "JUGUETERÍA." not in nombres


def test_aprobar_bodega_nueva_la_crea_de_verdad_y_se_puede_abrir(
    client: TestClient,
) -> None:
    headers_luis = _ingresar(client, "luis")
    headers_diana = _ingresar(client, "diana")

    client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
               json={"nombre": "almacen nuevo piscilago"})

    pendientes = client.get("/api/aprobaciones?estado=pendiente", headers=headers_diana)
    assert pendientes.status_code == 200, pendientes.text
    solicitudes = [a for a in pendientes.json() if a["tipo"] == "bodega"]
    assert len(solicitudes) == 1
    assert solicitudes[0]["nombre"] == "ALMACEN NUEVO PISCILAGO"

    aprobar = client.post(f"/api/aprobaciones/{solicitudes[0]['id']}/aprobar",
                          headers=headers_diana)
    assert aprobar.status_code == 200, aprobar.text

    listado = client.get("/api/bodegas", headers=headers_diana)
    nombres = [b["bodega"] for b in listado.json()]
    assert "ALMACEN NUEVO PISCILAGO" in nombres

    # diana es auditora: sin asignacion previa, igual puede abrirla y contar
    abrir = client.post("/api/bodegas/abrir", headers=headers_diana,
                        json={"bodega": "ALMACEN NUEVO PISCILAGO"})
    assert abrir.status_code == 200, abrir.text


def test_administrador_crea_bodega_directo_sin_pasar_por_aprobacion(
    client: TestClient,
) -> None:
    """Antes, el administrador quedaba pidiendo su propia bodega y solo el
    mismo podia aprobarla (visto en produccion) - una aprobacion que no
    verifica nada. Ahora, para el auditor, la bodega se crea de una."""
    headers_diana = _ingresar(client, "diana")

    solicitud = client.post("/api/bodegas/crear-pendiente", headers=headers_diana,
                            json={"nombre": "bodega de la administradora"})
    assert solicitud.status_code == 200, solicitud.text
    assert "pendiente" not in solicitud.json()["respuesta_hablada"].lower()

    # ya existe de verdad, sin pasar por aprobaciones
    listado = client.get("/api/bodegas", headers=headers_diana)
    assert "BODEGA DE LA ADMINISTRADORA" in [b["bodega"] for b in listado.json()]

    pendientes = client.get("/api/aprobaciones?estado=pendiente", headers=headers_diana)
    assert not any(a["tipo"] == "bodega" for a in pendientes.json())


def test_buscar_bodega_resuelve_al_nombre_real_sin_abrir_nada(
    client: TestClient,
) -> None:
    """Bug real: el selector de bodega preguntaba "¿confirma que abro
    kiosco?" con lo que se dijo tal cual, aunque "KIOSCO" a secas no
    fuera ninguna bodega real (solo existen "KIOSCO TAQUILLA AYB",
    "KIOSCO PISCIGIROS AYB", etc.) - /api/bodegas/buscar debe resolver al
    nombre real (o decir que no encontró nada) SIN crear ninguna sesión."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega, SesionConteo

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        bodega = Bodega(nombre_oficial="KIOSCO TAQUILLA REGIONAL")
        sesion.add(bodega)
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=bodega.id))
        sesion.commit()
        bodega_id = bodega.id

    headers = _ingresar(client, "luis")

    r = client.post("/api/bodegas/buscar", headers=headers,
                    json={"bodega": "kiosco taquilla regional"})
    assert r.status_code == 200, r.text
    assert r.json() == {"encontrada": True, "bodega": "KIOSCO TAQUILLA REGIONAL",
                        "bodega_id": bodega_id, "opciones": []}

    r2 = client.post("/api/bodegas/buscar", headers=headers,
                     json={"bodega": "un nombre que no existe para nada"})
    assert r2.status_code == 200, r2.text
    assert r2.json() == {"encontrada": False, "bodega": None, "bodega_id": None, "opciones": []}

    # solo resolvió el nombre - no abrió ninguna sesión de conteo
    with Sesion() as sesion:
        assert sesion.query(SesionConteo).filter_by(bodega_id=bodega_id).count() == 0


def test_buscar_bodega_ofrece_opciones_en_vez_de_adivinar(
    client: TestClient,
) -> None:
    """Bug real reportado desde producción: decir "kiosco" a secas
    "encontraba" (mal) "KIOSCO 2 SUMINISTROS" - "kiosco" es substring de
    esa Y de "KIOSCO TAQUILLA AYB" por igual, así que ninguna gana sola.
    En vez de solo decir "no la encuentro", ahora ofrece las dos como
    opciones para que la persona elija cuál era."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        a = Bodega(nombre_oficial="KIOSCO DOS SUMINISTROS")
        b = Bodega(nombre_oficial="KIOSCO TAQUILLA AYB")
        sesion.add_all([a, b])
        sesion.flush()
        sesion.add_all([
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=a.id),
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=b.id),
        ])
        sesion.commit()
        ids = {a.id, b.id}

    headers = _ingresar(client, "luis")
    r = client.post("/api/bodegas/buscar", headers=headers, json={"bodega": "kiosco"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["encontrada"] is False
    assert d["bodega"] is None
    assert {o["bodega_id"] for o in d["opciones"]} == ids
    assert {o["bodega"] for o in d["opciones"]} == {"KIOSCO DOS SUMINISTROS",
                                                     "KIOSCO TAQUILLA AYB"}


def test_buscar_bodega_restaurante_ofrece_las_dos_reales(
    client: TestClient,
) -> None:
    """Mismo caso que reportó la usuaria en vivo: decir "restaurante" a
    secas, con "RESTAURANTE FUENTES AYB" y "RESTAURANTE FUENTES SUMIN"
    en el catálogo, debe ofrecer ambas - no fallar en seco."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        ayb = Bodega(nombre_oficial="RESTAURANTE FUENTES AYB")
        sumin = Bodega(nombre_oficial="RESTAURANTE FUENTES SUMIN")
        sesion.add_all([ayb, sumin])
        sesion.flush()
        sesion.add_all([
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=ayb.id),
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=sumin.id),
        ])
        sesion.commit()

    headers = _ingresar(client, "luis")
    r = client.post("/api/bodegas/buscar", headers=headers, json={"bodega": "restaurante"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["encontrada"] is False
    nombres = {o["bodega"] for o in d["opciones"]}
    assert nombres == {"RESTAURANTE FUENTES AYB", "RESTAURANTE FUENTES SUMIN"}


def test_buscar_bodega_restringe_opciones_a_lo_asignado_del_auxiliar(
    client: TestClient,
) -> None:
    """Bug real reportado en vivo: decir "restaurante" mostraba las CINCO
    bodegas "RESTAURANTE ..." del catálogo completo, aunque el auxiliar
    solo tuviera UNA asignada - viendo nombres de zonas ajenas que ni
    podía llegar a abrir. Restringido a lo suyo, "restaurante" debe
    resolver directo a la única que sí tiene (sin mostrar "opciones")."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="stephanie").one()
        suya = Bodega(nombre_oficial="RESTAURANTE FUENTES AYB")
        ajena1 = Bodega(nombre_oficial="RESTAURANTE FUENTES SUMIN")
        ajena2 = Bodega(nombre_oficial="RESTAURANTE NUTRIAS")
        sesion.add_all([suya, ajena1, ajena2])
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=suya.id))
        sesion.commit()
        suya_id = suya.id

    headers = _ingresar(client, "stephanie")
    r = client.post("/api/bodegas/buscar", headers=headers, json={"bodega": "restaurante"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d == {"encontrada": True, "bodega": "RESTAURANTE FUENTES AYB",
                "bodega_id": suya_id, "opciones": []}


def test_abrir_bodega_por_rest_encuentra_el_nombre_aunque_diga_tilde(
    client: TestClient,
) -> None:
    """Mismo bug que en el agente conversacional, pero por el REST directo
    (\"Abrir por nombre exacto\" / clic en una tarjeta): el catálogo no
    trae tildes, así que buscar con tilde no debe fallar."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        bodega = Bodega(nombre_oficial="ALMACEN REGIONAL")
        sesion.add(bodega)
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=bodega.id))
        sesion.commit()

    headers = _ingresar(client, "luis")
    r = client.post("/api/bodegas/abrir", headers=headers,
                    json={"bodega": "almacén regional"})
    assert r.status_code == 200, r.text
    assert r.json()["bodega"] == "ALMACEN REGIONAL"


def test_abrir_bodega_por_rest_ignora_el_punto_final_del_reconocimiento_de_voz(
    client: TestClient,
) -> None:
    """Bug real reportado desde producción: el reconocimiento de voz del
    navegador cierra la frase con un punto ("Zoológico.") aunque nadie lo
    haya dicho - antes eso bastaba para que "No encuentro esa bodega."."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        bodega = Bodega(nombre_oficial="ZOOLOGICO")
        sesion.add(bodega)
        sesion.flush()
        sesion.add(AsignacionBodega(usuario_id=auxiliar.id, bodega_id=bodega.id))
        sesion.commit()

    headers = _ingresar(client, "luis")
    r = client.post("/api/bodegas/abrir", headers=headers,
                    json={"bodega": "Zoológico."})
    assert r.status_code == 200, r.text
    assert r.json()["bodega"] == "ZOOLOGICO"


def test_abrir_bodega_prefiere_la_coincidencia_exacta_sobre_una_mas_larga(
    client: TestClient,
) -> None:
    """Bug real: decir solo "Zoológico" abría "ZOOLOGICO SUMINISTROS" (una
    bodega distinta) porque "ZOOLOGICO" es substring de su nombre - debe
    preferir la bodega cuyo nombre es EXACTAMENTE lo que se dijo."""
    from bd import Sesion
    from modelos import Bodega, Usuario, AsignacionBodega

    with Sesion() as sesion:
        auxiliar = sesion.query(Usuario).filter_by(nombre="luis").one()
        corta = Bodega(nombre_oficial="ZOOLOGICO")
        larga = Bodega(nombre_oficial="ZOOLOGICO SUMINISTROS")
        sesion.add_all([larga, corta])          # a proposito: la larga primero
        sesion.flush()
        sesion.add_all([
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=corta.id),
            AsignacionBodega(usuario_id=auxiliar.id, bodega_id=larga.id),
        ])
        sesion.commit()
        corta_id = corta.id

    headers = _ingresar(client, "luis")
    r = client.post("/api/bodegas/abrir", headers=headers,
                    json={"bodega": "zoologico"})
    assert r.status_code == 200, r.text
    assert r.json()["bodega"] == "ZOOLOGICO"
    assert r.json()["bodega_id"] == corta_id


def test_no_se_puede_solicitar_una_bodega_que_ya_existe(client: TestClient) -> None:
    headers_luis = _ingresar(client, "luis")

    ya_existe = client.get("/api/bodegas", headers=headers_luis).json()
    if not ya_existe:
        # arranque() solo reparte bodegas si ya hay alguna cargada; si esta
        # base de pruebas no tiene ninguna, no hay nada que probar aqui.
        return
    nombre = ya_existe[0]["bodega"]

    r = client.post("/api/bodegas/crear-pendiente", headers=headers_luis,
                    json={"nombre": nombre})
    assert r.status_code == 409, r.text
