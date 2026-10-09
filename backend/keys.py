"""Llaves de Binance de cada usuario, guardadas CIFRADAS (Fernet: AES + HMAC).

Cada persona conecta su propia cuenta (solo lectura). Las llaves van en el documento "binance_keys"
(backend/data o MySQL) y la clave para descifrarlas vive aparte, en backend/.env (APP_SECRET):
si alguien copia solo la base de datos, no puede leer ninguna llave.
"""
import threading
import time

from cryptography.fernet import Fernet, InvalidToken

DOC = "binance_keys"


class Vault:
    def __init__(self, store, secret):
        """secret: APP_SECRET de backend/.env (se crea con new_secret() la primera vez)."""
        self.store, self.f, self.lock = store, Fernet(secret.encode()), threading.Lock()

    @staticmethod
    def new_secret():
        return Fernet.generate_key().decode()

    def _load(self):
        return self.store.load(DOC, {})

    def all(self):
        """{usuario: (api_key, secret)} de las llaves que se pueden descifrar."""
        out = {}
        for user, row in self._load().items():
            try:
                out[user] = (self.f.decrypt(row["key"].encode()).decode(), self.f.decrypt(row["secret"].encode()).decode())
            except (InvalidToken, KeyError, AttributeError):
                print(f"  La llave de Binance de {user} no se pudo leer (¿cambió APP_SECRET?); debe conectarla otra vez.")
        return out

    def save(self, user, key, secret):
        with self.lock:
            rows = self._load()
            rows[user] = {"key": self.f.encrypt(key.encode()).decode(), "secret": self.f.encrypt(secret.encode()).decode(),
                          "since": time.time()}
            self.store.save(DOC, rows)

    def remove(self, user):
        with self.lock:
            rows = self._load()
            if rows.pop(user, None) is not None:
                self.store.save(DOC, rows)

    def rename(self, old, new):
        with self.lock:
            rows = self._load()
            if old in rows:
                rows[new] = rows.pop(old)
                self.store.save(DOC, rows)
