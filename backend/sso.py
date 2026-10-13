"""Entrada a la wallet sin volver a iniciar sesión.

Desde el menú del usuario, el panel firma un pase de un solo uso (vence en 60 s) con SSO_SECRET y manda a la persona a
wallet.../sso?t=PASE. La wallet comprueba la firma y abre la sesión de ESA persona: cada quien entra solo a sus datos.
El pase lleva el id fijo del usuario (no cambia si lo renombran), su nombre y su rol; nunca la contraseña ni la sesión.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time

TTL = 60


def new_secret():
    return secrets.token_urlsafe(32)


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(secret, message):
    """Firma de las consultas internas de la wallet (llave de Binance de un usuario)."""
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def ticket(secret, user):
    """user: {"uid", "name", "role"} del panel."""
    payload = _b64(json.dumps({"id": user["uid"], "u": user["name"], "r": user["role"],
                               "exp": int(time.time()) + TTL, "n": secrets.token_hex(8)}).encode())
    sig = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"
