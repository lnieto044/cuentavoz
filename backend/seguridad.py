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

# El User Pool Id y el App Client Id NO son secretos: identifican al pool,
# no autorizan nada, y de hecho ya viajan dentro del JavaScript que
# descarga cualquiera que abra la aplicacion (ver frontend/src/cognito.js,
# donde llevan exactamente estos mismos valores por defecto). Lo secreto
# son las claves de las personas (que las guarda Cognito, no este backend)
# y las credenciales AWS_* (que siguen siendo solo variables de entorno).
#
# Llevan valor por defecto por la misma razon que VITE_API_URL en api.js o
# DB_URL en bd.py: que el proyecto funcione sin depender de que alguien se
# acuerde de llenar una variable. Antes el backend era la unica pieza que
# NO lo hacia, y el resultado fue un despliegue en el que estas dos
# quedaron vacias y TODOS los tokens se rechazaron con "Sesion invalida o
# vencida." - un mensaje que ademas culpaba a la persona equivocada.
# Definir la variable de entorno sigue mandando: apuntar a otro User Pool
# (otro entorno, otra cuenta de AWS) es solo ponerla.
COGNITO_REGION = os.getenv("COGNITO_REGION", "").strip() or "us-east-2"
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "").strip() or "us-east-2_6HbrPruvL"
COGNITO_APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "").strip() or "847jtkc5sem7mr4tb8csrrkqp"
_EMISOR = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
_JWKS_URL = f"{_EMISOR}/.well-known/jwks.json"

# PyJWKClient trae en cache las llaves publicas del User Pool (se refrescan
# solas si aparece un "kid" nuevo que no conoce todavia) - sin esto habria
# que ir a buscarlas a Cognito en cada peticion.
#   lifespan: las llaves de firma de un User Pool son estables (no rotan
#     cada rato). Con el valor por defecto (300 s) el backend volvia a
#     pedir el JWKS a AWS cada 5 minutos, y CADA una de esas idas a la red
#     era una oportunidad de que un tropiezo tumbara la sesion de todos
#     (ver _reclamos_cognito). Una hora reduce esas idas ~12 veces.
#   timeout: 30 s por defecto es demasiado - deja la peticion colgada. Es
#     preferible fallar rapido y reintentar.
_jwks_client = (jwt.PyJWKClient(_JWKS_URL, cache_keys=True, lifespan=3600, timeout=8)
                if COGNITO_USER_POOL_ID else None)
esquema = OAuth2PasswordBearer(tokenUrl="/api/registro-completado", auto_error=False)


class ServicioIdentidadCaido(Exception):
    """No se pudieron consultar las llaves publicas de Cognito.

    Ojo con la distincion, que es la razon de ser de esta excepcion: esto
    NO significa que el token sea malo, significa que este backend no pudo
    hablar con AWS para comprobarlo. Antes ambos casos terminaban en el
    mismo 401 "Sesion invalida o vencida.", y como el frontend cierra la
    sesion ante cualquier 401 (ver api.js: alSesionInvalida), un tropiezo
    de red de un segundo contra el JWKS sacaba a la persona de la
    aplicacion y la mandaba de vuelta al login con un mensaje que ademas
    era mentira. Se responde 503 en su lugar."""


def _llave_de_firma(token: str):
    """La llave publica con la que Cognito firmo este token.

    PyJWT ya reintenta solo (refrescando el JWKS) cuando el "kid" no esta
    en la cache; lo que no reintenta es un fallo de RED al traer ese JWKS,
    que es justo el caso que aqui interesa cubrir."""
    from jwt.exceptions import PyJWKClientConnectionError
    try:
        return _jwks_client.get_signing_key_from_jwt(token).key
    except PyJWKClientConnectionError as e:
        print(f"[seguridad] no se pudo traer el JWKS de Cognito ({e}); reintentando")
        try:
            return _jwks_client.get_signing_key_from_jwt(token).key
        except PyJWKClientConnectionError as e2:
            raise ServicioIdentidadCaido(str(e2)) from e2


def _reclamos_cognito(token: str) -> dict | None:
    """Verifica un access token de Cognito y devuelve sus datos, o None si
    no es valido, vencio, es de otro User Pool/App Client, o es un id token
    en vez de un access token (llevan proposito distinto: el access token
    es para hablar con la API, el id token es para identificar a la
    persona ante el propio frontend).

    Levanta ServicioIdentidadCaido si el problema no es el token sino la
    conexion con Cognito."""
    if not _jwks_client:
        return None
    try:
        llave = _llave_de_firma(token)
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
    try:
        datos = _reclamos_cognito(token)
    except ServicioIdentidadCaido as e:
        # 503 y no 401 a proposito: el token esta bien, lo que fallo fue la
        # consulta a Cognito. Un 401 aqui cerraria la sesion de la persona
        # (ver api.js) por un problema que no es suyo ni de su token.
        print(f"[seguridad] Cognito no responde: {e}")
        raise HTTPException(
            503, "No se pudo verificar su sesion en este momento. Intente de nuevo.")
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
    try:
        datos = _reclamos_cognito(token)
    except ServicioIdentidadCaido as e:
        # Un WebSocket no tiene forma de decir "reintente": se rechaza la
        # conexion y el frontend la vuelve a abrir sola mas adelante.
        print(f"[seguridad] Cognito no responde (websocket): {e}")
        return None
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
