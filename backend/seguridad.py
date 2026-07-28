"""Identidad: contraseñas cifradas, token firmado y permisos por perfil."""
import os
import datetime
import jwt
import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from bd import Sesion
from modelos import Usuario

SECRETO = os.getenv("SECRETO_JWT", "cambieme-por-una-frase-larga")
MINUTOS = int(os.getenv("MINUTOS_TOKEN", 480))
esquema = OAuth2PasswordBearer(tokenUrl="/api/ingresar", auto_error=False)


def hash_clave(clave: str) -> str:
    """bcrypt trabaja sobre bytes y no admite mas de 72."""
    b = clave.encode("utf-8")[:72]
    return bcrypt.hashpw(b, bcrypt.gensalt()).decode("utf-8")


def verificar_clave(clave: str, guardado: str) -> bool:
    try:
        return bcrypt.checkpw(clave.encode("utf-8")[:72],
                              guardado.encode("utf-8"))
    except Exception:
        return False


def crear_token(u: Usuario) -> str:
    datos = {
        "sub": str(u.id),
        "perfil": u.perfil,
        "ver": u.version_token or 0,
        "exp": datetime.datetime.now(datetime.timezone.utc)
               + datetime.timedelta(minutes=MINUTOS),
    }
    return jwt.encode(datos, SECRETO, algorithm="HS256")


def usuario_actual(token: str = Depends(esquema)) -> Usuario:
    if not token:
        raise HTTPException(401, "Falta la sesion.")
    try:
        datos = jwt.decode(token, SECRETO, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesion invalida o vencida.")
    with Sesion() as s:
        u = s.get(Usuario, int(datos["sub"]))
    if u is None:
        raise HTTPException(401, "Usuario no reconocido.")
    if not u.activo:
        raise HTTPException(403, "Ese usuario esta inactivo.")
    if (datos.get("ver", 0) or 0) != (u.version_token or 0):
        raise HTTPException(401, "Sesion cerrada desde otro dispositivo. Ingrese de nuevo.")
    return u


def verificar_token(token: str):
    """Para WebSockets: el esquema OAuth2 exige el header Authorization, que
    un WebSocket del navegador no puede mandar, asi que aqui se valida el
    token pasado por query string con la misma regla que usuario_actual."""
    if not token:
        return None
    try:
        datos = jwt.decode(token, SECRETO, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    with Sesion() as s:
        u = s.get(Usuario, int(datos["sub"]))
    if u is None or (datos.get("ver", 0) or 0) != (u.version_token or 0):
        return None
    return u


def requiere_perfil(perfil: str):
    def guardia(u: Usuario = Depends(usuario_actual)) -> Usuario:
        if u.perfil != perfil:
            raise HTTPException(403, "Su perfil no permite esta accion.")
        return u
    return guardia


def registrar(usuario, accion: str, detalle: str, tipo: str = "info"):
    """Deja rastro de una accion sensible. El registro solo crece."""
    from modelos import Traza
    with Sesion() as s:
        s.add(Traza(usuario_id=getattr(usuario, "id", None),
                    persona=getattr(usuario, "nombre", "sistema"),
                    accion=accion, detalle=detalle, tipo=tipo))
        s.commit()
