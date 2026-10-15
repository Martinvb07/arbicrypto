"""Avisos push del navegador (Web Push con VAPID): llegan aunque la pestaña del panel esté dormida o cerrada.

Chrome y Edge congelan las pestañas que llevan rato en segundo plano y ahí la página deja de oír al servidor.
El push lo entrega el propio navegador al service worker (web/public/sw.js), que pide los avisos nuevos y los
muestra. El push va sin contenido (no hace falta cifrarlo): solo despierta al service worker.
"""
import base64
import json
import threading
import time
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

# solo se le envía a los servicios push de los navegadores (nunca a una URL cualquiera)
PUSH_HOSTS = ("fcm.googleapis.com", ".notify.windows.com", "updates.push.services.mozilla.com", ".push.apple.com")
MAX_PER_USER = 10


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def allowed_endpoint(url):
    try:
        u = urlparse(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h.lstrip(".") or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS)


class WebPush:
    def __init__(self, load, save, subject="mailto:avisos@arbicrypto.org"):
        """load/save: leer y guardar un documento (backend/data/*.json o la base de datos)."""
        self.save, self.subject, self.lock = save, subject, threading.Lock()
        keys = load("push_keys", None)
        if not keys:
            pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
            keys = {"private": pem}
            save("push_keys", keys)
        self.key = serialization.load_pem_private_key(keys["private"].encode(), None)
        self.public = b64(self.key.public_key().public_bytes(serialization.Encoding.X962,
                                                            serialization.PublicFormat.UncompressedPoint))
        self.subs = load("push_subs", {})  # {usuario: [{"endpoint": ...}]}
        self.tokens = {}  # {origen del servicio: (jwt, vence)}

    def subscribe(self, user, endpoint):
        if not allowed_endpoint(endpoint):
            raise ValueError("Ese navegador no tiene un servicio de avisos conocido.")
        with self.lock:
            mine = [s for s in self.subs.get(user, []) if s["endpoint"] != endpoint]
            self.subs[user] = (mine + [{"endpoint": endpoint, "t": time.time()}])[-MAX_PER_USER:]
            self.save("push_subs", self.subs)

    def unsubscribe(self, user, endpoint):
        with self.lock:
            before = self.subs.get(user, [])
            self.subs[user] = [s for s in before if s["endpoint"] != endpoint]
            if len(self.subs[user]) != len(before):
                self.save("push_subs", self.subs)

    def rename(self, old, new):
        with self.lock:
            if old in self.subs:
                self.subs[new] = self.subs.pop(old)
                self.save("push_subs", self.subs)

    def _jwt(self, endpoint):
        u = urlparse(endpoint)
        aud = f"{u.scheme}://{u.netloc}"
        tok = self.tokens.get(aud)
        if tok and tok[1] > time.time() + 600:
            return tok[0]
        exp = int(time.time()) + 12 * 3600
        head = b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
        claims = b64(json.dumps({"aud": aud, "exp": exp, "sub": self.subject}).encode())
        r, s = decode_dss_signature(self.key.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
        token = f"{head}.{claims}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
        self.tokens[aud] = (token, exp)
        return token

    def send(self, users):
        """Despierta a los navegadores de esos usuarios (en otro hilo: nunca frena el escaneo)."""
        with self.lock:
            targets = [(u, s["endpoint"]) for u in set(users) for s in self.subs.get(u, [])]
        if targets:
            threading.Thread(target=self._send_all, args=(targets,), daemon=True).start()

    def _send_all(self, targets):
        gone = []
        for user, endpoint in targets:
            try:
                r = requests.post(endpoint, timeout=10, headers={
                    "TTL": "120", "Urgency": "high", "Content-Length": "0",
                    "Authorization": f"vapid t={self._jwt(endpoint)}, k={self.public}"})
                if r.status_code in (404, 410):  # el navegador ya no tiene esa suscripción
                    gone.append((user, endpoint))
            except requests.RequestException:
                pass
        for user, endpoint in gone:
            self.unsubscribe(user, endpoint)
