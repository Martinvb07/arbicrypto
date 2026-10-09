"""Usuarios, sesiones e invitaciones de un solo uso de ArbiCrypto.

Las contraseñas se guardan cifradas (PBKDF2-SHA256 con sal); nunca en texto plano.
Para recuperar el acceso desde la consola (con el panel cerrado):  python auth.py
"""
import getpass
import hashlib
import hmac
import os
import re
import secrets
import threading
import time

from storage import Store
from storage import from_env as storage_from_env

ITERATIONS = 600_000  # recomendacion OWASP para PBKDF2-SHA256
SESSION_DAYS = 30
INVITE_DAYS = 7
MAX_FAILS = 8
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sin 0/O ni 1/I para que no se confundan
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,30}$")


class AuthError(Exception):
    pass


def _hash_password(password, salt, iterations=ITERATIONS):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations).hex()


def _digest(token):
    # En disco solo queda el hash del token de sesion, no el token
    return hashlib.sha256(token.encode()).hexdigest()


def _code_part():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))


class Auth:
    def __init__(self, data_dir=None, store=None, redis=None):
        """store: storage.Store (archivos o PostgreSQL). redis: storage.Redis para compartir intentos fallidos."""
        if store is None:
            os.makedirs(data_dir, exist_ok=True)
            store = Store(data_dir)
        self.store, self.redis = store, redis
        self.users = store.load("users", {})
        self.invites = store.load("invites", {})
        self.sessions = store.load("sessions", {})
        self.lock = threading.RLock()
        self.fails = {}

    def _persist(self, *names):
        for n in names:
            self.store.save(n, getattr(self, n))

    # ------------------------------------------------------------ usuarios

    @staticmethod
    def clean_username(name):
        name = str(name or "").strip().lower()
        if not USERNAME_RE.match(name):
            raise AuthError("El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.")
        return name

    @staticmethod
    def check_password(password):
        if len(password) < 8:
            raise AuthError("La contraseña debe tener al menos 8 caracteres.")

    def has_users(self):
        return bool(self.users)

    def create_user(self, username, password, role="user", invited_by=None):
        username = self.clean_username(username)
        self.check_password(password)
        with self.lock:
            if username in self.users:
                raise AuthError("Ese usuario ya existe. Elige otro nombre.")
            salt = secrets.token_hex(16)
            self.users[username] = {"salt": salt, "hash": _hash_password(password, salt), "iter": ITERATIONS, "role": role,
                                    "created": time.time(), "last_login": None, "invited_by": invited_by}
            self._persist("users")
        return username

    def verify(self, username, password):
        user = self.users.get(username)
        if not user:
            _hash_password(password, "00" * 16)  # tarda lo mismo exista o no el usuario
            return False
        return hmac.compare_digest(user["hash"], _hash_password(password, user["salt"], user["iter"]))

    def set_password(self, username, password):
        self.check_password(password)
        with self.lock:
            user = self.users.get(username)
            if not user:
                raise AuthError("Ese usuario no existe.")
            user["salt"] = secrets.token_hex(16)
            user["hash"] = _hash_password(password, user["salt"])
            user["iter"] = ITERATIONS
            self.sessions = {k: v for k, v in self.sessions.items() if v["user"] != username}
            self._persist("users", "sessions")

    def check_rename(self, old, new):
        """Valida un cambio de nombre sin aplicarlo; devuelve el nombre nuevo limpio."""
        new = self.clean_username(new)
        if old not in self.users:
            raise AuthError("Ese usuario no existe.")
        if new != old and new in self.users:
            raise AuthError("Ese nombre de usuario ya existe. Elige otro.")
        return new

    def rename_user(self, old, new):
        """Cambia el nombre de usuario sin cerrar sus sesiones ni perder invitaciones."""
        with self.lock:
            new = self.check_rename(old, new)
            if new == old:
                return new
            self.users[new] = self.users.pop(old)
            for u in self.users.values():
                if u.get("invited_by") == old:
                    u["invited_by"] = new
            for s in self.sessions.values():
                if s["user"] == old:
                    s["user"] = new
            for inv in self.invites.values():
                if inv.get("by") == old:
                    inv["by"] = new
                if inv.get("used_by") == old:
                    inv["used_by"] = new
            self._persist("users", "sessions", "invites")
        return new

    def set_role(self, username, role, by):
        if role not in ("admin", "user"):
            raise AuthError("Rol inválido.")
        with self.lock:
            user = self.users.get(username)
            if not user:
                raise AuthError("Ese usuario no existe.")
            if username == by:
                raise AuthError("No puedes cambiar tu propio rol.")
            if user["role"] == "admin" and role != "admin" and sum(u["role"] == "admin" for u in self.users.values()) <= 1:
                raise AuthError("Debe quedar al menos un administrador.")
            user["role"] = role
            self._persist("users")

    def delete_user(self, username, by):
        with self.lock:
            user = self.users.get(username)
            if not user:
                raise AuthError("Ese usuario no existe.")
            if username == by:
                raise AuthError("No puedes borrar tu propio usuario.")
            if user["role"] == "admin" and sum(u["role"] == "admin" for u in self.users.values()) <= 1:
                raise AuthError("Debe quedar al menos un administrador.")
            del self.users[username]
            self.sessions = {k: v for k, v in self.sessions.items() if v["user"] != username}
            self._persist("users", "sessions")

    def list_users(self):
        return [{"username": n, "role": u["role"], "created": u["created"], "last_login": u.get("last_login"),
                 "invited_by": u.get("invited_by")} for n, u in sorted(self.users.items())]

    # ------------------------------------------------------------ sesiones

    def _throttle(self, ip):
        if self.redis is not None and self.redis.on:
            if self.redis.blocked(ip):
                raise AuthError("Demasiados intentos fallidos. Espera 10 minutos.")
            return
        _, until = self.fails.get(ip, (0, 0))
        if time.time() < until:
            raise AuthError("Demasiados intentos fallidos. Espera 10 minutos.")

    def _fail(self, ip):
        if self.redis is not None and self.redis.on:  # compartido entre copias del panel
            self.redis.fail(ip, MAX_FAILS, 600)
            time.sleep(0.8)
            return
        if len(self.fails) > 1000:  # limpia registros viejos para que no crezca sin limite
            now = time.time()
            self.fails = {k: v for k, v in self.fails.items() if v[1] > now}
        n = self.fails.get(ip, (0, 0))[0] + 1
        self.fails[ip] = (0, time.time() + 600) if n >= MAX_FAILS else (n, 0)
        time.sleep(0.8)  # frena a quien intente adivinar

    def _new_session(self, username):
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self.lock:
            self.sessions = {k: v for k, v in self.sessions.items() if v["expires"] > now}
            self.sessions[_digest(token)] = {"user": username, "created": now, "expires": now + SESSION_DAYS * 86400}
            self.users[username]["last_login"] = now
            self._persist("sessions", "users")
        return token

    def login(self, username, password, ip):
        self._throttle(ip)
        try:
            username = self.clean_username(username)
        except AuthError:
            username = ""
        if not username or not self.verify(username, password):
            self._fail(ip)
            raise AuthError("Usuario o contraseña incorrectos.")
        self.fails.pop(ip, None)
        if self.redis is not None:
            self.redis.clear_fails(ip)
        if self.users[username]["iter"] < ITERATIONS:
            self._upgrade_hash(username, password)
        return self._new_session(username)

    def _upgrade_hash(self, username, password):
        """Rehace el hash con mas iteraciones sin cerrar sesiones (solo tras verificar la contraseña)."""
        with self.lock:
            user = self.users[username]
            user["salt"] = secrets.token_hex(16)
            user["hash"] = _hash_password(password, user["salt"])
            user["iter"] = ITERATIONS
            self._persist("users")

    def user_for(self, token):
        if not token:
            return None
        session = self.sessions.get(_digest(token))
        if not session or session["expires"] < time.time():
            return None
        user = self.users.get(session["user"])
        return {"name": session["user"], "role": user["role"]} if user else None

    def logout(self, token):
        with self.lock:
            if token and self.sessions.pop(_digest(token), None):
                self._persist("sessions")

    # ------------------------------------------------------------ invitaciones de un solo uso

    def create_invite(self, by):
        code = f"AC-{_code_part()}-{_code_part()}"
        now = time.time()
        with self.lock:
            self.invites[code] = {"by": by, "created": now, "expires": now + INVITE_DAYS * 86400,
                                  "used_by": None, "used_at": None}
            self._persist("invites")
        return code

    def revoke_invite(self, code):
        with self.lock:
            invite = self.invites.get(code)
            if not invite or invite["used_by"]:
                raise AuthError("Ese código no existe o ya se usó.")
            del self.invites[code]
            self._persist("invites")

    def register(self, code, username, password, ip):
        self._throttle(ip)
        code = str(code or "").strip().upper()
        with self.lock:
            invite = self.invites.get(code)
            valid = invite and not invite["used_by"] and invite["expires"] > time.time()
            if valid:
                username = self.create_user(username, password, invited_by=invite["by"])
                invite.update(used_by=username, used_at=time.time())
                self._persist("invites")
        if not valid:
            self._fail(ip)
            raise AuthError("El código de invitación no es válido, ya se usó o venció.")
        return self._new_session(username)

    def list_invites(self):
        now = time.time()
        out = []
        for code, inv in sorted(self.invites.items(), key=lambda kv: -kv[1]["created"]):
            status = "usado" if inv["used_by"] else ("vencido" if inv["expires"] < now else "pendiente")
            out.append(dict(inv, code=code, status=status))
        return out


def _console():
    root = os.path.dirname(os.path.abspath(__file__))
    env = {}
    if os.path.exists(os.path.join(root, ".env")):
        for line in open(os.path.join(root, ".env"), encoding="utf-8"):
            k, _, v = line.strip().partition("=")
            if k and not k.startswith("#"):
                env[k.strip()] = v.strip().strip("\"'")
    _, store, redis = storage_from_env(env, os.path.join(root, "data"))
    auth = Auth(store=store, redis=redis)
    print("\n  ARBICRYPTO - administrar usuarios (cierra el panel antes de usar esto)\n")
    print("  1) Crear administrador\n  2) Cambiar la contraseña de un usuario\n  3) Ver usuarios\n")
    choice = input("  Opcion: ").strip()
    try:
        if choice == "1":
            name = input("  Usuario: ")
            pw = getpass.getpass("  Contrasena (no se ve al escribir): ")
            print(f"  Listo: administrador '{auth.create_user(name, pw, role='admin')}' creado.")
        elif choice == "2":
            name = auth.clean_username(input("  Usuario: "))
            auth.set_password(name, getpass.getpass("  Nueva contrasena: "))
            print("  Listo: contrasena cambiada.")
        elif choice == "3":
            for u in auth.list_users():
                print(f"  - {u['username']} ({u['role']})")
    except AuthError as e:
        print(f"  Error: {e}")


if __name__ == "__main__":
    _console()
