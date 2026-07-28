"""Ingreso con huella del dispositivo: WebAuthn real (Windows Hello, Touch
ID, huella de Android), no la simulacion anterior de un solo campo booleano.

Los retos (challenges) viven en memoria del proceso - igual que ESTADOS del
agente en orquestador.py -, alcanza para esta app de un solo servidor y se
vencen solos a los pocos minutos."""
import json
import os
import secrets
from datetime import datetime, timedelta

import webauthn
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorAttachment, AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor, ResidentKeyRequirement,
    UserVerificationRequirement,
)

RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
RP_NOMBRE = os.getenv("WEBAUTHN_RP_NAME", "CuentaVoz")
# uno o varios origenes separados por coma - el/los dominio(s) reales del
# frontend, con esquema (http/https) y sin barra final.
ORIGENES = [o.strip() for o in
            os.getenv("WEBAUTHN_ORIGENES", "http://localhost:5173").split(",")
            if o.strip()]

_RETOS_REGISTRO: dict[int, dict] = {}     # usuario_id -> {challenge, expira}
_RETOS_INGRESO: dict[str, dict] = {}      # reto_id -> {challenge, usuario_id, expira}


def _vencido(expira: datetime) -> bool:
    return expira < datetime.now()


def opciones_registro(usuario_id: int, nombre: str, credenciales_existentes: list[str]) -> dict:
    opciones = webauthn.generate_registration_options(
        rp_id=RP_ID, rp_name=RP_NOMBRE,
        user_id=str(usuario_id).encode(), user_name=nombre, user_display_name=nombre,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            user_verification=UserVerificationRequirement.REQUIRED,
            resident_key=ResidentKeyRequirement.PREFERRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c))
                             for c in credenciales_existentes],
    )
    _RETOS_REGISTRO[usuario_id] = {"challenge": opciones.challenge,
                                    "expira": datetime.now() + timedelta(minutes=3)}
    return json.loads(webauthn.options_to_json(opciones))


def verificar_registro(usuario_id: int, credencial: dict) -> dict:
    entrada = _RETOS_REGISTRO.pop(usuario_id, None)
    if not entrada or _vencido(entrada["expira"]):
        raise ValueError("El registro de huella expiró. Intente de nuevo.")
    verificacion = webauthn.verify_registration_response(
        credential=credencial, expected_challenge=entrada["challenge"],
        expected_rp_id=RP_ID, expected_origin=ORIGENES,
        require_user_verification=True,
    )
    return {"credential_id": bytes_to_base64url(verificacion.credential_id),
            "public_key": bytes_to_base64url(verificacion.credential_public_key),
            "sign_count": verificacion.sign_count}


def opciones_ingreso(usuario_id: int, credenciales: list[str]) -> tuple[str, dict]:
    opciones = webauthn.generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c))
                           for c in credenciales],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    reto_id = secrets.token_urlsafe(16)
    _RETOS_INGRESO[reto_id] = {"challenge": opciones.challenge, "usuario_id": usuario_id,
                                "expira": datetime.now() + timedelta(minutes=2)}
    return reto_id, json.loads(webauthn.options_to_json(opciones))


def verificar_ingreso(reto_id: str, credencial: dict, public_key_b64: str,
                       sign_count: int) -> tuple[int, int]:
    """Devuelve (usuario_id, nuevo_sign_count) o lanza ValueError."""
    entrada = _RETOS_INGRESO.pop(reto_id, None)
    if not entrada or _vencido(entrada["expira"]):
        raise ValueError("El reto de huella expiró. Intente de nuevo.")
    verificacion = webauthn.verify_authentication_response(
        credential=credencial, expected_challenge=entrada["challenge"],
        expected_rp_id=RP_ID, expected_origin=ORIGENES,
        credential_public_key=base64url_to_bytes(public_key_b64),
        credential_current_sign_count=sign_count,
        require_user_verification=True,
    )
    return entrada["usuario_id"], verificacion.new_sign_count
