"""Identidad: verificacion de tokens de AWS Cognito y permisos por perfil.

La contraseña, el registro y el login los maneja Cognito directamente (el
frontend habla con el SDK de Cognito, nunca manda la clave a este backend).
Lo unico que hace este modulo es comprobar que un access token que llega en
la cabecera Authorization de verdad lo firmo NUESTRO User Pool de Cognito -
firma (RS256, con las llaves publicas que Cognito publica), emisor,
audiencia (client_id) y que sea un access token, no un id token."""
import os
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from bd import Sesion
from modelos import Usuario

COGNITO_REGION = os.getenv("COGNITO_REGION", "us-east-2")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "")
COGNITO_APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "")
_EMISOR = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
_JWKS_URL = f"{_EMISOR}/.well-known/jwks.json"

if not COGNITO_USER_POOL_ID:
    print("[seguridad] COGNITO_USER_POOL_ID no esta configurado - "
          "ninguna sesion va a poder verificarse. Defina COGNITO_REGION, "
          "COGNITO_USER_POOL_ID y COGNITO_APP_CLIENT_ID en su .env.")

# PyJWKClient trae en cache las llaves publicas del User Pool (se refrescan
# solas si aparece un "kid" nuevo que no conoce todavia) - sin esto habria
# que ir a buscarlas a Cognito en cada peticion.
_jwks_client = jwt.PyJWKClient(_JWKS_URL) if COGNITO_USER_POOL_ID else None
esquema = OAuth2PasswordBearer(tokenUrl="/api/registro-completado", auto_error=False)


def _reclamos_cognito(token: str) -> dict | None:
    """Verifica un access token de Cognito y devuelve sus datos, o None si
    no es valido, vencio, es de otro User Pool/App Client, o es un id token
    en vez de un access token (llevan proposito distinto: el access token
    es para hablar con la API, el id token es para identificar a la
    persona ante el propio frontend)."""
    if not _jwks_client:
        return None
    try:
        llave = _jwks_client.get_signing_key_from_jwt(token).key
        datos = jwt.decode(
            token, llave, algorithms=["RS256"], issuer=_EMISOR,
            options={"require": ["exp", "iss", "sub", "token_use", "client_id", "username"]},
        )
    except jwt.PyJWTError:
        return None
    if datos.get("token_use") != "access" or datos.get("client_id") != COGNITO_APP_CLIENT_ID:
        return None
    return datos


def usuario_actual(token: str = Depends(esquema)) -> Usuario:
    if not token:
        raise HTTPException(401, "Falta la sesion.")
    datos = _reclamos_cognito(token)
    if datos is None:
        raise HTTPException(401, "Sesion invalida o vencida.")
    nombre = (datos.get("username") or "").lower()
    with Sesion() as s:
        u = s.query(Usuario).filter_by(nombre=nombre).first()
    if u is None:
        raise HTTPException(401, "Usuario no reconocido.")
    if not u.activo:
        raise HTTPException(403, "Ese usuario esta inactivo.")
    return u


def verificar_token(token: str):
    """Para WebSockets: el esquema OAuth2 exige el header Authorization, que
    un WebSocket del navegador no puede mandar, asi que aqui se valida el
    token pasado por query string con la misma regla que usuario_actual."""
    if not token:
        return None
    datos = _reclamos_cognito(token)
    if datos is None:
        return None
    nombre = (datos.get("username") or "").lower()
    with Sesion() as s:
        u = s.query(Usuario).filter_by(nombre=nombre).first()
    if u is None or not u.activo:
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
