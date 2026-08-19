"""El filtro de aprobación del autoregistro (ver main.py: registro_completado,
aprobar_registro, rechazar_registro) - las cuentas demo/semilla NUNCA deben
verse afectadas (quedan con aprobado=NULL para siempre), solo las que se
autoregistran de aquí en adelante."""
from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(usuario: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {usuario}"}


def test_registro_completado_crea_la_cuenta_inactiva_y_pendiente(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    r = client.post(
        "/api/registro-completado",
        headers=_headers("nueva_persona"),
        json={"nombre_completo": "Nueva Persona", "correo": "nueva@ejemplo.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "ya_existia": False}

    import main as modulo
    with modulo.Sesion() as s:
        fila = s.query(modulo.Usuario).filter_by(nombre="nueva_persona").one()
        assert fila.activo == 0
        assert fila.aprobado == 0
        assert fila.perfil == "auxiliar"


def test_cuenta_pendiente_no_puede_usar_la_api(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    client.post(
        "/api/registro-completado",
        headers=_headers("otra_persona"),
        json={"nombre_completo": "Otra Persona", "correo": "otra@ejemplo.com"},
    )
    r = client.get("/api/usuarios/yo", headers=_headers("otra_persona"))
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "Ese usuario esta inactivo."


def test_lista_de_pendientes_solo_muestra_autoregistros_no_cuentas_semilla(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    client.post(
        "/api/registro-completado",
        headers=_headers("candidata"),
        json={"nombre_completo": "Candidata", "correo": "candidata@ejemplo.com"},
    )
    r = client.get("/api/usuarios/pendientes-aprobacion", headers=_headers("diana"))
    assert r.status_code == 200, r.text
    nombres = {p["nombre"] for p in r.json()}
    assert nombres == {"candidata"}
    # las cuentas semilla (aprobado=NULL) nunca deben aparecer aqui, aunque
    # existan de sobra en la misma base.
    assert "luis" not in nombres and "diana" not in nombres


def test_auxiliar_no_puede_ver_ni_resolver_pendientes(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    client.post(
        "/api/registro-completado",
        headers=_headers("candidata2"),
        json={"nombre_completo": "Candidata Dos", "correo": "c2@ejemplo.com"},
    )
    r = client.get("/api/usuarios/pendientes-aprobacion", headers=datos_regresion["headers"])
    assert r.status_code == 403, r.text


def test_aprobar_registro_activa_la_cuenta_con_el_perfil_elegido(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    client.post(
        "/api/registro-completado",
        headers=_headers("futura_auditora"),
        json={"nombre_completo": "Futura Auditora", "correo": "fa@ejemplo.com"},
    )
    import main as modulo
    with modulo.Sesion() as s:
        usuario_id = s.query(modulo.Usuario).filter_by(nombre="futura_auditora").one().id

    r = client.post(
        f"/api/usuarios/{usuario_id}/aprobar-registro",
        headers=_headers("diana"),
        json={"perfil": "auditor"},
    )
    assert r.status_code == 200, r.text

    with modulo.Sesion() as s:
        fila = s.get(modulo.Usuario, usuario_id)
        assert fila.activo == 1
        assert fila.aprobado == 1
        assert fila.perfil == "auditor"

    # ya puede usar la API normalmente.
    yo = client.get("/api/usuarios/yo", headers=_headers("futura_auditora"))
    assert yo.status_code == 200, yo.text
    assert yo.json()["perfil"] == "auditor"

    # y desaparece de la lista de pendientes.
    pendientes = client.get("/api/usuarios/pendientes-aprobacion", headers=_headers("diana"))
    assert "futura_auditora" not in {p["nombre"] for p in pendientes.json()}


def test_rechazar_registro_deja_la_cuenta_bloqueada_para_siempre(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    client.post(
        "/api/registro-completado",
        headers=_headers("rechazada"),
        json={"nombre_completo": "Rechazada", "correo": "r@ejemplo.com"},
    )
    import main as modulo
    with modulo.Sesion() as s:
        usuario_id = s.query(modulo.Usuario).filter_by(nombre="rechazada").one().id

    r = client.post(f"/api/usuarios/{usuario_id}/rechazar-registro", headers=_headers("diana"))
    assert r.status_code == 200, r.text

    with modulo.Sesion() as s:
        fila = s.get(modulo.Usuario, usuario_id)
        assert fila.aprobado == -1
        assert fila.activo == 0   # bloqueada para siempre, nunca se borra

    # no se puede volver a aprobar ni rechazar una segunda vez.
    otra_vez = client.post(f"/api/usuarios/{usuario_id}/aprobar-registro",
                           headers=_headers("diana"), json={"perfil": "auxiliar"})
    assert otra_vez.status_code == 404, otra_vez.text


def test_no_se_puede_resolver_un_usuario_que_no_es_un_autoregistro_pendiente(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    """Una cuenta semilla (aprobado=NULL, nunca pasó por el autoregistro)
    no debe poder aprobarse/rechazarse por accidente via estos endpoints
    nuevos - solo activo=0,aprobado=0 (creado por registro_completado)
    califica."""
    r = client.post(
        f"/api/usuarios/{datos_regresion['auxiliar_id']}/aprobar-registro",
        headers=_headers("diana"), json={"perfil": "auxiliar"},
    )
    assert r.status_code == 404, r.text


def test_desactivar_una_cuenta_normal_no_toca_la_columna_aprobado(
    client: TestClient, datos_regresion: dict[str, object],
) -> None:
    """El interruptor de Ajustes (activo/inactivo) y el filtro de
    aprobación son cosas independientes - desactivar a alguien ya
    aprobado/semilla no debe hacer que aparezca en la lista de pendientes."""
    import main as modulo
    with modulo.Sesion() as s:
        otro = s.query(modulo.Usuario).filter_by(nombre="stephanie").one()
        otro_id = otro.id
        aprobado_antes = otro.aprobado

    r = client.put(f"/api/usuarios/{otro_id}", headers=_headers("diana"),
                   json={"activo": False})
    assert r.status_code == 200, r.text

    with modulo.Sesion() as s:
        fila = s.get(modulo.Usuario, otro_id)
        assert fila.activo == 0
        assert fila.aprobado == aprobado_antes   # sin cambios (sigue NULL)

    pendientes = client.get("/api/usuarios/pendientes-aprobacion", headers=_headers("diana"))
    assert "stephanie" not in {p["nombre"] for p in pendientes.json()}
