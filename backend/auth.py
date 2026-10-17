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



ACCESS = ("ambos", "panel", "wallet")  # a qué puede entrar cada usuario
TEAM_NAME_MAX = 40

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
        # equipos: {id: {id, name, owner, created, chat}}; de qué equipo es cada quien va en users[nombre]["team"].
        # None = todavía no se han creado (el panel arma el primero con los usuarios de siempre).
        self.teams = store.load("teams", None)
        self.team_requests = store.load("team_requests", {})  # {id: {id, team, user, kind: pide|invita, by, t}}
        self.lock = threading.RLock()
        self.fails = {}
        # id fijo de cada usuario (no cambia al renombrarlo): con él se guardan su foto y sus datos
        missing = [u for u in self.users.values() if not u.get("uid")]
        for u in missing:
            u["uid"] = secrets.token_hex(8)
        if missing:
            self._persist("users")

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
                                    "created": time.time(), "last_login": None, "invited_by": invited_by,
                                    "uid": secrets.token_hex(8)}
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
            for t in (self.teams or {}).values():
                if t.get("owner") == old:
                    t["owner"] = new
            for r in self.team_requests.values():
                for k in ("user", "by"):
                    if r.get(k) == old:
                        r[k] = new
            self._persist("users", "sessions", "invites", "team_requests")
            if self.teams is not None:
                self._persist("teams")
        return new

    def set_avatar(self, username, version):
        """Marca que el usuario tiene foto (version = cuando la subio, para que el navegador la refresque) o None."""
        with self.lock:
            user = self.users.get(username)
            if not user:
                raise AuthError("Ese usuario no existe.")
            if version:
                user["avatar"] = version
            else:
                user.pop("avatar", None)
            self._persist("users")

    def avatars(self):
        """{usuario: url de su foto} de quienes tienen foto (la url cambia cuando la cambian)."""
        return {n: f"/api/avatar/{u['uid']}?v={int(u['avatar'])}" for n, u in self.users.items() if u.get("avatar") and u.get("uid")}

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
            if role == "admin":
                user["access"] = "ambos"
            self._persist("users")

    def set_access(self, username, access, by):
        """A qué entra: "ambos" (panel y wallet), "panel" o "wallet". Los administradores siempre entran a los dos."""
        if access not in ACCESS:
            raise AuthError("Acceso inválido.")
        with self.lock:
            user = self.users.get(username)
            if not user:
                raise AuthError("Ese usuario no existe.")
            if username == by:
                raise AuthError("No puedes cambiar tu propio acceso.")
            if user["role"] == "admin" and access != "ambos":
                raise AuthError("Un administrador entra al panel y a la wallet. Cámbialo a Equipo primero.")
            user["access"] = access
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
            team = user.get("team")
            del self.users[username]
            self.sessions = {k: v for k, v in self.sessions.items() if v["user"] != username}
            self._persist("users", "sessions")
            self._after_leaving(username, team)

    def list_users(self):
        return [{"username": n, "role": u["role"], "access": u.get("access", "ambos"), "created": u["created"], "last_login": u.get("last_login"),
                 "invited_by": u.get("invited_by"), "team": u.get("team")} for n, u in sorted(self.users.items())]

    # ------------------------------------------------------------ equipos
    # Cada usuario está en un equipo o en ninguno (los nuevos empiezan sin equipo). Solo ve y le escribe a los de su
    # equipo. Puede crear uno (queda de dueño) o pedir unirse a otro; el dueño acepta o invita. Los administradores
    # crean equipos y mueven a cualquiera.

    @staticmethod
    def clean_team_name(name):
        name = re.sub(r"\s+", " ", str(name or "")).strip()
        if not name or len(name) > TEAM_NAME_MAX:
            raise AuthError(f"Ponle un nombre al equipo (máximo {TEAM_NAME_MAX} letras).")
        return name

    def team_of(self, username):
        u = self.users.get(username)
        t = u and u.get("team")
        return t if t and self.teams and t in self.teams else None

    def team_members(self, tid):
        return sorted(n for n, u in self.users.items() if u.get("team") == tid)

    def same_team(self, a, b):
        t = self.team_of(a)
        return bool(t) and t == self.team_of(b)

    def can_talk(self, a, b):
        """Se ven y se escriben: los del mismo equipo, y cualquiera con un administrador."""
        ua, ub = self.users.get(a), self.users.get(b)
        if not ua or not ub:
            return False
        return self.same_team(a, b) or ua["role"] == "admin" or ub["role"] == "admin"

    def _check_name_free(self, name, skip=None):
        if any(t["name"].lower() == name.lower() and t["id"] != skip for t in self.teams.values()):
            raise AuthError("Ya hay un equipo con ese nombre. Elige otro.")

    def create_team(self, name, owner=None, chat=None):
        """Equipo nuevo. Con `owner`, esa persona (sin equipo) queda dentro y de dueña."""
        name = self.clean_team_name(name)
        with self.lock:
            if self.teams is None:
                self.teams = {}
            self._check_name_free(name)
            if owner is not None:
                if owner not in self.users:
                    raise AuthError("Ese usuario no existe.")
                if self.team_of(owner):
                    raise AuthError("Ya estás en un equipo: sal de él para crear otro.")
            tid = secrets.token_hex(6)
            # by_user: lo armó un usuario (se borra solo si queda vacío); los de un administrador se quedan
            self.teams[tid] = {"id": tid, "name": name, "owner": owner, "created": time.time(), "chat": chat, "by_user": owner is not None}
            if owner is not None:
                self._join(owner, tid)
                self.users[owner]["team_since"] = time.time()
            self._persist("teams", "users", "team_requests")
        return tid

    def set_team_chat(self, tid, chat):
        with self.lock:
            if tid in (self.teams or {}):
                self.teams[tid]["chat"] = chat
                self._persist("teams")

    def rename_team(self, tid, name, by=None):
        """Lo cambia el dueño (by) o un administrador (by=None)."""
        name = self.clean_team_name(name)
        with self.lock:
            t = (self.teams or {}).get(tid)
            if not t:
                raise AuthError("Ese equipo no existe.")
            if by is not None and t.get("owner") != by:
                raise AuthError("Solo el dueño del equipo puede cambiarle el nombre.")
            self._check_name_free(name, skip=tid)
            t["name"] = name
            self._persist("teams")

    def delete_team(self, tid):
        """Lo borra un administrador: todos quedan sin equipo. Devuelve el equipo borrado."""
        with self.lock:
            t = (self.teams or {}).pop(tid, None)
            if not t:
                raise AuthError("Ese equipo no existe.")
            for u in self.users.values():
                if u.get("team") == tid:
                    u["team"] = None
            self.team_requests = {k: r for k, r in self.team_requests.items() if r["team"] != tid}
            self._persist("teams", "users", "team_requests")
        return t

    def _join(self, username, tid):
        """Entra al equipo y se borran sus otras solicitudes e invitaciones (ya no hacen falta)."""
        self.users[username]["team"] = tid
        self.team_requests = {k: r for k, r in self.team_requests.items() if r["user"] != username}

    def _after_leaving(self, username, tid):
        """Alguien salió del equipo `tid`: si era el dueño, queda el que lleva más tiempo; si no queda nadie, el
        equipo se borra (salvo los que creó un administrador, que siguen vacíos)."""
        t = (self.teams or {}).get(tid) if tid else None
        if not t:
            return
        if t.get("owner") == username:
            rest = sorted(self.team_members(tid), key=lambda n: self.users[n].get("team_since") or self.users[n]["created"])
            t["owner"] = rest[0] if rest else None
        if not self.team_members(tid) and t.get("by_user"):
            del self.teams[tid]
            self.team_requests = {k: r for k, r in self.team_requests.items() if r["team"] != tid}
        self._persist("teams", "users", "team_requests")

    def set_team(self, username, tid):
        """Un administrador pone a alguien en un equipo (o lo saca con tid=None)."""
        with self.lock:
            u = self.users.get(username)
            if not u:
                raise AuthError("Ese usuario no existe.")
            if tid is not None and tid not in (self.teams or {}):
                raise AuthError("Ese equipo no existe.")
            old = self.team_of(username)
            if old == tid:
                return old
            u["team"] = None
            self._after_leaving(username, old)
            if tid is not None:
                self._join(username, tid)
                u["team_since"] = time.time()
                if not self.teams[tid].get("owner"):
                    self.teams[tid]["owner"] = username
            self._persist("users", "team_requests", "teams")
            return old

    def leave_team(self, username):
        with self.lock:
            tid = self.team_of(username)
            if not tid:
                raise AuthError("No estás en ningún equipo.")
            self.users[username]["team"] = None
            self._after_leaving(username, tid)
            self._persist("users")
            return tid

    def kick(self, owner, username):
        with self.lock:
            tid = self.team_of(owner)
            if not tid or self.teams[tid].get("owner") != owner:
                raise AuthError("Solo el dueño del equipo puede sacar a alguien.")
            if username == owner or self.team_of(username) != tid:
                raise AuthError("Esa persona no está en tu equipo.")
            self.users[username]["team"] = None
            self._persist("users")
            return tid

    def _new_request(self, tid, username, kind, by):
        if any(r["team"] == tid and r["user"] == username for r in self.team_requests.values()):
            raise AuthError("Ya hay una solicitud pendiente con ese equipo." if kind == "pide" else "Ya la invitaste: falta que acepte.")
        rid = secrets.token_hex(6)
        self.team_requests[rid] = {"id": rid, "team": tid, "user": username, "kind": kind, "by": by, "t": time.time()}
        self._persist("team_requests")
        return self.team_requests[rid]

    def request_join(self, username, tid):
        """Alguien sin equipo le pide al dueño entrar."""
        with self.lock:
            if self.team_of(username):
                raise AuthError("Ya estás en un equipo: sal de él para unirte a otro.")
            if tid not in (self.teams or {}):
                raise AuthError("Ese equipo no existe.")
            return self._new_request(tid, username, "pide", username)

    def invite_to_team(self, owner, username):
        """El dueño invita a alguien que todavía no tiene equipo."""
        with self.lock:
            tid = self.team_of(owner)
            if not tid or self.teams[tid].get("owner") != owner:
                raise AuthError("Solo el dueño del equipo puede invitar.")
            if username not in self.users:
                raise AuthError("Ese usuario no existe.")
            if self.team_of(username):
                raise AuthError("Esa persona ya está en un equipo.")
            return self._new_request(tid, username, "invita", owner)

    def answer_request(self, rid, by, accept, admin=False):
        """Una solicitud la responde el dueño (o un administrador); una invitación, la persona invitada."""
        with self.lock:
            r = self.team_requests.get(rid)
            if not r or r["team"] not in (self.teams or {}):
                raise AuthError("Esa solicitud ya no existe.")
            t = self.teams[r["team"]]
            ok = by == r["user"] if r["kind"] == "invita" else (admin or t.get("owner") == by)
            if not ok:
                raise AuthError("Esa solicitud no te toca responderla.")
            del self.team_requests[rid]
            if accept:
                if self.team_of(r["user"]):
                    self._persist("team_requests")
                    raise AuthError("Esa persona ya entró a otro equipo.")
                self._join(r["user"], r["team"])
                self.users[r["user"]]["team_since"] = time.time()
                if not t.get("owner"):
                    t["owner"] = r["user"]
                self._persist("users", "teams")
            self._persist("team_requests")
            return r

    def cancel_request(self, rid, by):
        with self.lock:
            r = self.team_requests.get(rid)
            if not r or r["by"] != by:
                raise AuthError("Esa solicitud ya no existe.")
            del self.team_requests[rid]
            self._persist("team_requests")

    def list_teams(self):
        return [{**t, "members": self.team_members(tid)} for tid, t in sorted((self.teams or {}).items(), key=lambda kv: kv[1]["created"])]

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
        return {"name": session["user"], "role": user["role"], "uid": user.get("uid"), "access": user.get("access", "ambos")} if user else None

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
