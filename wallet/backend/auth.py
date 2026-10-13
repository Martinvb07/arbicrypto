"""Sesiones de la wallet. Los usuarios, contraseñas e invitaciones se manejan en el panel (panel.arbicrypto.org).

- Se entra desde el panel (menú del usuario → Wallet) con un pase firmado: ver sso.py.
- Cada usuario del panel tiene SU cuenta en la wallet, unida por su id fijo del panel (panel_uid): aunque lo renombren
  sigue viendo sus datos, y nadie más los ve (ni los administradores).
- Sesiones: solo se guarda el sha256 del token de la cookie. Duran 12 horas; al vencer, la wallet vuelve a pedir
  el pase al panel sin que la persona haga nada (si sigue con la sesión del panel abierta).
"""
import hashlib
import secrets
import time

SESSION_HOURS = 12
NO_PASSWORD = "!"  # la contraseña vive en el panel: aquí no hay con qué entrar


def _sha(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Auth:
    def __init__(self, db):
        self.db = db

    # ------------------------------------------------------------ cuenta de cada usuario del panel

    def account_for(self, panel_uid, username, role):
        """La cuenta de la wallet de ese usuario del panel; la crea la primera vez. Devuelve su id."""
        role = "admin" if role == "admin" else "user"
        with self.db.lock:
            # SOLO por el id fijo del panel, nunca por el nombre: una cuenta jamás recibe los datos de otra
            u = self.db.one("SELECT id, username FROM users WHERE panel_uid=?", (panel_uid,))
            if not u:  # primera vez: su wallet empieza vacía y se llena solo con SU Binance
                self._free_name(username)
                uid, _ = self.db.run("INSERT INTO users (username, pw, salt, iter, role, created, panel_uid) VALUES (?,?,?,?,?,?,?)",
                                     (username, NO_PASSWORD, NO_PASSWORD, 0, role, time.time(), panel_uid))
                u = {"id": uid, "username": username}
            if u["username"] != username:  # lo renombraron en el panel
                self._free_name(username)
                self.db.run("UPDATE users SET username=? WHERE id=?", (username, u["id"]))
            self.db.run("UPDATE users SET role=? WHERE id=?", (role, u["id"]))
            return u["id"]

    def _free_name(self, username):
        """Si otra cuenta tiene ese nombre (alguien que ya no está en el panel), se le cambia el nombre: sus datos no se mezclan."""
        old = self.db.one("SELECT id FROM users WHERE username=?", (username,))
        if old:
            self.db.run("UPDATE users SET username=? WHERE id=?", (f"{username}~{old['id']}", old["id"]))

    # ------------------------------------------------------------ sesiones

    def new_session(self, uid):
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.db.run("DELETE FROM sessions WHERE expires<?", (now,))
        self.db.run("INSERT INTO sessions (token, user_id, created, expires) VALUES (?,?,?,?)",
                    (_sha(token), uid, now, now + SESSION_HOURS * 3600))
        return token

    def user_for(self, token):
        if not token or len(token) > 200:
            return None
        return self.db.one("SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id "
                           "WHERE s.token=? AND s.expires>?", (_sha(token), time.time()))

    def logout(self, token):
        if token:
            self.db.run("DELETE FROM sessions WHERE token=?", (_sha(token),))
