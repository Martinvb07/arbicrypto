"""Donde se guardan los datos de ArbiCrypto Wallet (igual que en el panel de ArbiCrypto).

- Sin configurar nada: SQLite en backend/data/wallet.db.
- Con DATABASE_URL=mysql://usuario:clave@127.0.0.1:3306/arbicrypto_wallet  en backend/.env: todo va a MySQL.
"""
import os
import threading


# ---------------------------------------------------------------- conexion SQL (SQLite o MySQL)

class SQL:
    """Envuelve sqlite3 o PyMySQL con la misma interfaz: placeholders '?', filas como dict.
    En MySQL las comillas dobles nombran columnas (ANSI_QUOTES), igual que en SQLite: "rows", "lines", "cursor"."""

    def __init__(self, url=None, sqlite_path=None):
        self.lock = threading.RLock()
        self.mysql = bool(url and url.startswith(("mysql://", "mysql+pymysql://")))
        if self.mysql:
            import pymysql
            from pymysql.constants import CLIENT
            from urllib.parse import unquote, urlparse
            u = urlparse(url)
            self._args = dict(host=u.hostname or "127.0.0.1", port=u.port or 3306, user=unquote(u.username or ""),
                              password=unquote(u.password or ""), database=u.path.lstrip("/") or "arbicrypto_wallet",
                              charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, autocommit=False,
                              # FOUND_ROWS: un UPDATE cuenta las filas encontradas aunque no cambien (como SQLite)
                              client_flag=CLIENT.FOUND_ROWS,
                              init_command="SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',ANSI_QUOTES')")
            self.con = pymysql.connect(**self._args)
        else:
            import sqlite3
            os.makedirs(os.path.dirname(os.path.abspath(sqlite_path)), exist_ok=True)
            self.con = sqlite3.connect(sqlite_path, check_same_thread=False)
            self.con.row_factory = sqlite3.Row
            self.con.execute("PRAGMA journal_mode=WAL")
            self.con.execute("PRAGMA foreign_keys=ON")

    def _cur(self):
        if self.mysql:
            self.con.ping(reconnect=True)  # MySQL cierra conexiones quietas (wait_timeout)
        return self.con.cursor()

    def _q(self, sql):
        # PyMySQL usa %s y trata '%' como especial (LIKE 'p2p:%'): se escapa
        return sql.replace("%", "%%").replace("?", "%s") if self.mysql else sql

    def _exec(self, cur, sql, args):
        cur.execute(self._q(sql), tuple(args) or None) if self.mysql else cur.execute(sql, tuple(args))

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
            self._exec(cur, sql, args)
            rows = cur.fetchall()
            self.con.commit()  # cierra la lectura: si no, MySQL seguiria mostrando datos viejos
            return [dict(r) for r in rows]

    def run(self, sql, args=()):
        """Ejecuta y confirma. Devuelve (id de la fila insertada, filas tocadas)."""
        with self.lock:
            cur = self._cur()
            try:
                self._exec(cur, sql, args)
                self.con.commit()
            except Exception:
                self.con.rollback()
                raise
            return cur.lastrowid, cur.rowcount

    def many(self, sql, rows):
        """Muchas filas en una sola transaccion: o quedan todas o ninguna. Devuelve cuantas filas toco."""
        rows = [tuple(r) for r in rows]
        if not rows:
            return 0
        with self.lock:
            cur = self._cur()
            try:
                cur.executemany(self._q(sql), rows)
                self.con.commit()
            except Exception:
                self.con.rollback()
                raise
            return max(cur.rowcount, 0)

    def transaction(self, statements):
        """Ejecuta varias sentencias [(sql, args)] como una sola: o quedan todas o ninguna."""
        with self.lock:
            cur = self._cur()
            try:
                for q, args in statements:
                    self._exec(cur, q, args)
                self.con.commit()
            except Exception:
                self.con.rollback()
                raise

    def columns(self, table):
        """Nombres de las columnas de una tabla."""
        if self.mysql:
            return {r["Field"] for r in self.all(f"SHOW COLUMNS FROM {table}")}
        return {r["name"] for r in self.all(f'PRAGMA table_info("{table}")')}

    def tables(self):
        if self.mysql:
            return {next(iter(r.values())) for r in self.all("SHOW TABLES")}
        return {r["name"] for r in self.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}

    # -------- diferencias de sintaxis entre SQLite y MySQL

    def upsert(self, table, cols, keys, updates):
        """INSERT que, si ya existe la llave, actualiza las columnas de `updates` con el valor nuevo."""
        ph = ", ".join("?" * len(cols))
        names = ", ".join(f'"{c}"' for c in cols)
        if self.mysql:
            sets = ", ".join(f'"{c}" = VALUES("{c}")' for c in updates)
            return f"INSERT INTO {table} ({names}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {sets}"
        sets = ", ".join(f'"{c}" = excluded."{c}"' for c in updates)
        return f'INSERT INTO {table} ({names}) VALUES ({ph}) ON CONFLICT({", ".join(keys)}) DO UPDATE SET {sets}'

    def insert_ignore(self, table, cols):
        verb = "INSERT IGNORE" if self.mysql else "INSERT OR IGNORE"
        names = ", ".join(f'"{c}"' for c in cols)
        return f'{verb} INTO {table} ({names}) VALUES ({", ".join("?" * len(cols))})'


def read_env_file(path):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            k, _, v = line.strip().partition("=")
            if k and not k.startswith("#"):
                env[k.strip()] = v.strip().strip("\"'")
    return env


def update_env_file(path, **values):
    """Escribe o cambia variables en backend/.env sin tocar las demas lineas."""
    lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else [
        "# Llaves privadas de ArbiCrypto Wallet. No compartas este archivo."]
    for k, v in values.items():
        for i, line in enumerate(lines):
            if line.split("=", 1)[0].strip() == k:
                lines[i] = f"{k}={v}"
                break
        else:
            lines.append(f"{k}={v}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
