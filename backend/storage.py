"""Donde se guardan los datos de ArbiCrypto.

- Sin configurar nada: archivos JSON y SQLite en backend/data (como siempre).
- Con DATABASE_URL=mysql://usuario:clave@localhost:3306/arbicrypto  en backend/.env: todo va a MySQL.
- Con REDIS_URL=redis://...  (opcional): eventos en vivo, limite de intentos de login y un candado
  para que dos copias del panel nunca escaneen Binance al mismo tiempo.
"""
import json
import os
import threading
import time
import uuid

INSTANCE = uuid.uuid4().hex[:8]  # identifica esta copia del panel (para Redis)


# ---------------------------------------------------------------- conexion SQL (SQLite o MySQL)

class SQL:
    """Envuelve sqlite3 o PyMySQL con la misma interfaz: placeholders '?', filas como dict.
    En MySQL las comillas dobles nombran columnas (ANSI_QUOTES), igual que en SQLite: "user", "key"."""

    def __init__(self, url=None, sqlite_path=None):
        self.lock = threading.RLock()
        self.mysql = bool(url and url.startswith(("mysql://", "mysql+pymysql://")))
        if self.mysql:
            import pymysql
            from urllib.parse import unquote, urlparse
            u = urlparse(url)
            self._args = dict(host=u.hostname or "127.0.0.1", port=u.port or 3306, user=unquote(u.username or ""),
                              password=unquote(u.password or ""), database=u.path.lstrip("/") or "arbicrypto",
                              charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, autocommit=False,
                              init_command="SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',ANSI_QUOTES')")
            self.con = pymysql.connect(**self._args)
        else:
            import sqlite3
            os.makedirs(os.path.dirname(sqlite_path), exist_ok=True)
            self.con = sqlite3.connect(sqlite_path, check_same_thread=False)
            self.con.row_factory = sqlite3.Row
            self.con.execute("PRAGMA journal_mode=WAL")

    def _cur(self):
        if self.mysql:
            self.con.ping(reconnect=True)  # MySQL cierra conexiones quietas (wait_timeout)
            return self.con.cursor()
        return self.con.cursor()

    def _q(self, sql):
        return sql.replace("?", "%s") if self.mysql else sql

    def script(self, sql):
        with self.lock:
            cur = self._cur()
            for stmt in (x.strip() for x in sql.split(";")):
                if not stmt:
                    continue
                if self.mysql and stmt.upper().startswith("CREATE INDEX"):
                    stmt = stmt.replace("IF NOT EXISTS ", "")
                    try:
                        cur.execute(stmt)
                    except Exception as e:  # 1061: el indice ya existe
                        if "1061" not in str(e):
                            raise
                    continue
                cur.execute(stmt)
            self.con.commit()

    def all(self, sql, args=()):
        with self.lock:
            cur = self._cur()
            cur.execute(self._q(sql), args or None) if self.mysql else cur.execute(sql, args)
            rows = cur.fetchall()
            if self.mysql:
                self.con.commit()  # cierra la lectura: si no, MySQL seguiria mostrando datos viejos
            return [dict(r) for r in rows]

    def run(self, sql, args=(), returning=False):
        """Ejecuta y confirma. Devuelve el id de la fila insertada."""
        with self.lock:
            cur = self._cur()
            cur.execute(self._q(sql), args or None) if self.mysql else cur.execute(sql, args)
            self.con.commit()
            return cur.lastrowid

    def many(self, sql, rows):
        with self.lock:
            cur = self._cur()
            cur.executemany(self._q(sql), rows)
            self.con.commit()

    # -------- diferencias de sintaxis entre SQLite y MySQL
    def greatest(self):
        return "GREATEST" if self.mysql else "MAX"

    def serial(self):
        return "BIGINT AUTO_INCREMENT PRIMARY KEY" if self.mysql else "INTEGER PRIMARY KEY AUTOINCREMENT"

    def keytext(self):
        """Texto que sirve de llave (MySQL no deja TEXT como llave primaria)."""
        return "VARCHAR(191)" if self.mysql else "TEXT"

    def upsert(self, table, cols, keys, updates):
        """INSERT que, si ya existe la llave, actualiza: updates = {columna: "new" | "max"}."""
        ph = ", ".join("?" * len(cols))
        if self.mysql:
            sets = ", ".join(f'"{c}" = ' + (f'GREATEST("{c}", VALUES("{c}"))' if m == "max" else f'VALUES("{c}")')
                             for c, m in updates.items())
            return f'INSERT INTO {table} ({", ".join(cols)}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {sets}'
        sets = ", ".join(f'"{c}" = ' + (f'MAX({table}."{c}", excluded."{c}")' if m == "max" else f'excluded."{c}"')
                         for c, m in updates.items())
        return f'INSERT INTO {table} ({", ".join(cols)}) VALUES ({ph}) ON CONFLICT({", ".join(keys)}) DO UPDATE SET {sets}'

    def insert_ignore(self, table, cols):
        verb = "INSERT IGNORE" if self.mysql else "INSERT OR IGNORE"
        return f'{verb} INTO {table} ({", ".join(cols)}) VALUES ({", ".join("?" * len(cols))})'


# ---------------------------------------------------------------- datos sueltos (usuarios, ajustes, monedas...)

class Store:
    """Guarda documentos JSON por nombre: en archivos o en la tabla kv de MySQL."""

    def __init__(self, data_dir, sql=None):
        self.dir = data_dir
        self.sql = sql if sql is not None and sql.mysql else None
        if self.sql:  # LONGTEXT: el historial del dia pesa varios cientos de KB
            self.sql.script("CREATE TABLE IF NOT EXISTS kv (name VARCHAR(191) PRIMARY KEY, value LONGTEXT NOT NULL, updated DOUBLE NOT NULL)")

    def path(self, name):
        return os.path.join(self.dir, f"{name}.json")

    def load(self, name, default):
        if self.sql:
            rows = self.sql.all("SELECT value FROM kv WHERE name = ?", (name,))
            try:
                return json.loads(rows[0]["value"]) if rows else default
            except ValueError:
                return default
        try:
            with open(self.path(name), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def save(self, name, data):
        if self.sql:
            self.sql.run(self.sql.upsert("kv", ("name", "value", "updated"), ("name",), {"value": "new", "updated": "new"}),
                         (name, json.dumps(data), time.time()))
            return
        tmp = self.path(name) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, self.path(name))


# ---------------------------------------------------------------- Redis (opcional)

class Redis:
    """Si no hay REDIS_URL (o no responde) todo funciona igual, solo en memoria."""

    def __init__(self, url=None):
        self.r = None
        if url:
            try:
                import redis
                self.r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=3)
                self.r.ping()
            except Exception as e:  # sin Redis el panel sigue funcionando
                print(f"  Redis no disponible ({e}); se sigue sin Redis.")
                self.r = None

    @property
    def on(self):
        return self.r is not None

    # eventos en vivo entre copias del panel
    def publish(self, kind):
        if self.r:
            try:
                self.r.publish("arbicrypto:events", json.dumps({"from": INSTANCE, "kind": kind}))
            except Exception:
                pass

    def listen(self, on_event):
        """Hilo que recibe eventos de otras copias del panel y los entrega en esta."""
        if not self.r:
            return

        def loop():
            while True:
                try:
                    ps = self.r.pubsub(ignore_subscribe_messages=True)
                    ps.subscribe("arbicrypto:events")
                    for msg in ps.listen():
                        data = json.loads(msg["data"])
                        if data.get("from") != INSTANCE:
                            on_event(data["kind"])
                except Exception:
                    time.sleep(3)
        threading.Thread(target=loop, daemon=True).start()

    # intentos de login fallidos compartidos
    def fail(self, ip, max_fails, block_seconds):
        """Suma un intento fallido; devuelve True si la IP queda bloqueada."""
        if not self.r:
            return None
        k = f"arbicrypto:fails:{ip}"
        n = self.r.incr(k)
        self.r.expire(k, block_seconds)
        if n >= max_fails:
            self.r.set(f"arbicrypto:block:{ip}", 1, ex=block_seconds)
            self.r.delete(k)
            return True
        return False

    def blocked(self, ip):
        return bool(self.r and self.r.exists(f"arbicrypto:block:{ip}"))

    def clear_fails(self, ip):
        if self.r:
            self.r.delete(f"arbicrypto:fails:{ip}")

    # candado: solo una copia del panel escanea Binance
    def leader(self, ttl=30):
        if not self.r:
            return True
        k = "arbicrypto:scanner"
        if self.r.set(k, INSTANCE, nx=True, ex=ttl):
            return True
        if self.r.get(k) == INSTANCE:
            self.r.expire(k, ttl)
            return True
        return False


def read_env_file(path):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            k, _, v = line.strip().partition("=")
            if k and not k.startswith("#"):
                env[k.strip()] = v.strip().strip("\"'")
    return env


def import_local(sql, store, data_dir):
    """Primera vez con MySQL vacio: copia lo que haya en backend/data (archivos y SQLite). No borra nada."""
    if store.load("users", None) is not None or not os.path.exists(os.path.join(data_dir, "users.json")):
        return
    db_path = os.path.join(data_dir, "cryptojesus.db")
    if os.path.exists(db_path):
        src = SQL(sqlite_path=db_path)
        for t in [r["name"] for r in src.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]:
            rows = src.all(f'SELECT * FROM "{t}"')
            if rows:
                sql.many(sql.insert_ignore(t, [f'"{c}"' for c in rows[0]]), [tuple(r.values()) for r in rows])
    files = Store(data_dir)
    names = sorted((f[:-5] for f in os.listdir(data_dir) if f.endswith(".json")), key=lambda n: n == "users")
    for name in names:  # "users" al final: si se corta a mitad, la proxima vez se vuelve a copiar
        data = files.load(name, None)
        if data is not None:
            store.save(name, data)
    print("  Se copiaron los datos de backend/data a MySQL (backend/data queda igual, como respaldo).")


def from_env(env, data_dir):
    """Arma la base SQL, el almacen y Redis segun backend/.env."""
    url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL", "")
    sql = SQL(url=url or None, sqlite_path=os.path.join(data_dir, "cryptojesus.db"))
    store = Store(data_dir, sql)
    redis_url = os.environ.get("REDIS_URL") or env.get("REDIS_URL", "")
    return sql, store, Redis(redis_url or None)
