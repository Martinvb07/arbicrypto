"""Entrada desde el panel sin volver a iniciar sesión (el pase lo firma backend/sso.py del panel).

El pase vence en 60 s y sirve una sola vez. La firma usa SSO_SECRET: el de wallet/backend/.env o, si no está,
el del panel (backend/.env), que vive en el mismo servidor y lo crea el panel la primera vez que arranca.
"""
import base64
import hashlib
import hmac
import json
import threading
import time

import storage

_used = {}  # pases ya usados -> cuándo vencen (un pase no se puede usar dos veces)
_lock = threading.Lock()


def secret(wallet_env, panel_env_file):
    return wallet_env("SSO_SECRET") or storage.read_env_file(panel_env_file).get("SSO_SECRET", "")


def sign(key, message):
    """Firma de las consultas a la ruta interna del panel (la llave de Binance de una persona)."""
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify(key, token):
    """{"id", "u", "r"} si el pase es válido, vigente y no se ha usado; si no, None."""
    if not key or not token or len(token) > 1000 or token.count(".") != 1:
        return None
    payload, sig = token.split(".")
    good = base64.urlsafe_b64encode(hmac.new(key.encode(), payload.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    if not hmac.compare_digest(sig, good):
        return None
    try:
        data = json.loads(_unb64(payload))
    except ValueError:
        return None
    now = time.time()
    if not isinstance(data, dict) or not data.get("id") or not data.get("u") or data.get("exp", 0) < now:
        return None
    with _lock:
        for n in [n for n, exp in _used.items() if exp < now]:
            del _used[n]
        if data.get("n") in _used:
            return None
        _used[data.get("n")] = data["exp"]
    return data
