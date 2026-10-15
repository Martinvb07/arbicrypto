"""Base de datos: cuentas (una por usuario del panel), sesiones, perfil fiscal, movimientos, extractos, cierres y caché de TRM y precios.

SQLite (backend/data/wallet.db) o MySQL si hay DATABASE_URL en backend/.env, igual que el panel de ArbiCrypto.
"""
import csv
import io
import json
import os
import re

import storage

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
ENV_FILE = os.path.join(ROOT, ".env")
DB_PATH = os.path.join(DATA_DIR, "wallet.db")

# {id} llave autonumerica · {ref} columna que apunta a otra tabla · {key} texto que va en una llave o indice
# {name} usuario (sin distinguir mayusculas) · {real} decimal · {big} entero grande
# "rows", "lines" y "cursor" van entre comillas: en MySQL son palabras reservadas
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id {id},
  username {name} NOT NULL UNIQUE,
  pw TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created {real} NOT NULL,
  panel_uid {key}
);
CREATE TABLE IF NOT EXISTS sessions (
  token {key} PRIMARY KEY,
  user_id {ref} NOT NULL,
  created {real} NOT NULL, expires {real} NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS invites (
  code {key} PRIMARY KEY,
  created_by {ref}, created {real} NOT NULL, expires {real} NOT NULL,
  used_by TEXT, used_at {real}, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profile (
  user_id {ref} PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '', nit TEXT NOT NULL DEFAULT '',
  habitual INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL DEFAULT 'fifo',
  gmf_exempt INTEGER NOT NULL DEFAULT 0,
  gmf_mode TEXT,
  gmf_methods TEXT NOT NULL DEFAULT '{{}}',
  auto_close INTEGER NOT NULL DEFAULT 1,
  cash_account TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS year_extra (
  user_id {ref} NOT NULL,
  year INTEGER NOT NULL,
  other_income {real} NOT NULL DEFAULT 0,
  other_patrimony {real} NOT NULL DEFAULT 0,
  other_deposits {real} NOT NULL DEFAULT 0,
  gmf_cert {real} NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS movements (
  id {id},
  user_id {ref} NOT NULL,
  t {real} NOT NULL,
  kind TEXT NOT NULL,
  out_asset TEXT, out_qty {real},
  in_asset TEXT, in_qty {real},
  cop_value {real} NOT NULL DEFAULT 0,
  fee_cop {real} NOT NULL DEFAULT 0,
  gmf_cop {real} NOT NULL DEFAULT 0,
  platform TEXT NOT NULL DEFAULT '',
  counterpart TEXT NOT NULL DEFAULT '',
  ext_id {key},
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  created {real} NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL DEFAULT '',
  fee_asset TEXT NOT NULL DEFAULT '',
  fee_qty {real} NOT NULL DEFAULT 0,
  UNIQUE (user_id, ext_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS movements_user_t ON movements(user_id, t);
CREATE TABLE IF NOT EXISTS binance (
  user_id {ref} PRIMARY KEY,
  key_enc TEXT NOT NULL, secret_enc TEXT NOT NULL,      -- vacías: la llave vive solo en el panel (Mi Binance)
  key_fp {key},                                       -- huella de la llave del panel con la que se sincronizó
  hint TEXT NOT NULL, created {real} NOT NULL,
  last_run {real}, last_ok {real}, last_error TEXT,
  "cursor" TEXT NOT NULL DEFAULT '{{}}',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS closings (
  id {id},
  user_id {ref} NOT NULL,
  kind TEXT NOT NULL,
  t {real} NOT NULL,
  cash_expected {real} NOT NULL, cash_real {real} NOT NULL, adjustment {real} NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1,
  snapshot {long} NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created {real} NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS closings_user_t ON closings(user_id, t);
CREATE TABLE IF NOT EXISTS accounts (
  id {id},
  user_id {ref} NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'ahorros',
  pay_methods TEXT NOT NULL DEFAULT '',
  created {real} NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bank_files (
  id {id},
  user_id {ref} NOT NULL,
  account_id {ref} NOT NULL,
  name TEXT NOT NULL, sha TEXT NOT NULL, "rows" INTEGER NOT NULL, day_from TEXT, day_to TEXT, uploaded {real} NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bank_tx (
  id {id},
  user_id {ref} NOT NULL,
  account_id {ref} NOT NULL,
  file_id {ref},
  day TEXT NOT NULL, t {real} NOT NULL, description TEXT NOT NULL, amount {real} NOT NULL, balance {real},
  category TEXT NOT NULL DEFAULT 'otro',
  auto INTEGER NOT NULL DEFAULT 1,
  match_id {ref},
  note TEXT NOT NULL DEFAULT '',
  fp {key} NOT NULL,
  UNIQUE (user_id, fp),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bank_tx_user_t ON bank_tx(user_id, t);
CREATE TABLE IF NOT EXISTS bank_rules (
  id {id},
  user_id {ref} NOT NULL,
  pattern {key} NOT NULL, category TEXT NOT NULL,
  UNIQUE (user_id, pattern),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notes (
  id {id},
  user_id {ref} NOT NULL,
  t {real} NOT NULL, text TEXT NOT NULL, support TEXT NOT NULL DEFAULT '',
  "lines" TEXT NOT NULL,
  created {real} NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS jornadas (
  id {id},
  user_id {ref} NOT NULL,
  opened {real} NOT NULL, account TEXT NOT NULL, opening {real} NOT NULL,
  closed {real}, cash_real {real}, report {long},
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS jornadas_user ON jornadas(user_id, opened);
CREATE TABLE IF NOT EXISTS trm (day {key} PRIMARY KEY, value {real} NOT NULL);
CREATE TABLE IF NOT EXISTS prices (asset {key} NOT NULL, hour {big} NOT NULL, usd {real} NOT NULL, PRIMARY KEY (asset, hour));
"""

# Columnas que se agregaron despues: una base vieja las recibe sola al arrancar
ADDED_COLUMNS = (
    ("users", "panel_uid", "{key}"),
    ("binance", "key_fp", "{key}"),                            # huella de la llave del panel (si cambia, se vuelve a traer todo)                           # id fijo del usuario en el panel (entra desde allá)
    ("movements", "category", "TEXT NOT NULL DEFAULT ''"),     # categoría de gastos
    ("movements", "pay_method", "TEXT NOT NULL DEFAULT ''"),   # medio de pago P2P (Nequi, BreBKeys…)
    ("movements", "fee_asset", "TEXT NOT NULL DEFAULT ''"),    # cripto de la comisión de Binance
    ("movements", "fee_qty", "{real} NOT NULL DEFAULT 0"),     # comisión que Binance cobró en cripto
    ("movements", "gmf_choice", "INTEGER"),                     # 4x1000 elegido a mano en esa compra: 1 sí, 0 no, NULL = el de siempre
    ("movements", "lot_from", "INTEGER"),                       # venta: id de la compra de la que salió (NULL = FIFO)
    ("profile", "gmf_mode", "TEXT"),                           # NULL = aún no ha dicho si su banco cobra el 4x1000
    ("profile", "gmf_methods", "TEXT NOT NULL DEFAULT '{{}}'"),  # 4x1000 por medio de pago
    ("profile", "auto_close", "INTEGER NOT NULL DEFAULT 1"),   # cierres automáticos (0 = en pausa)
    ("profile", "cash_account", "TEXT NOT NULL DEFAULT ''"),   # cuenta de pesos con la que se lleva la caja
    ("closings", "auto", "INTEGER NOT NULL DEFAULT 0"),        # 1 = lo hizo la app
    ("accounts", "balance_manual", "{real}"),                   # saldo escrito a mano (bancos cuyo extracto no trae saldo)
    ("accounts", "balance_manual_day", "TEXT"),
    ("year_extra", "gmf_cert", "{real} NOT NULL DEFAULT 0"),   # 4x1000 del certificado del banco
)

# Orden para copiar de SQLite a MySQL: primero lo que otras tablas necesitan
TABLES = ("users", "sessions", "invites", "profile", "year_extra", "movements", "binance", "closings", "accounts",
          "bank_files", "bank_tx", "bank_rules", "notes", "jornadas", "trm", "prices")

MOVE_FIELDS = ("t", "kind", "out_asset", "out_qty", "in_asset", "in_qty", "cop_value", "fee_cop", "gmf_cop",
               "platform", "counterpart", "ext_id", "source", "note", "category", "pay_method", "fee_qty", "fee_asset")


def _types(mysql):
    if mysql:
        return dict(id="BIGINT AUTO_INCREMENT PRIMARY KEY", ref="BIGINT", real="DOUBLE", big="BIGINT", long="LONGTEXT",
                    key="VARCHAR(191) COLLATE utf8mb4_bin", name="VARCHAR(64) COLLATE utf8mb4_unicode_ci")
    return dict(id="INTEGER PRIMARY KEY AUTOINCREMENT", ref="INTEGER", real="REAL", big="INTEGER", long="TEXT",
                key="TEXT", name="TEXT COLLATE NOCASE")


def _ddl(text, mysql):
    text = text.format(**_types(mysql))
    # MySQL solo acepta un valor por defecto en TEXT escrito como expresión: DEFAULT ('')
    return re.sub(r"(TEXT NOT NULL DEFAULT )('[^']*')", r"\1(\2)", text) if mysql else text


class DB:
    def __init__(self, path=DB_PATH, url=None):
        """path: archivo SQLite (pruebas y PC sin MySQL). url: mysql://... (manda sobre path)."""
        self.sql = storage.SQL(url=url, sqlite_path=path)
        self.lock = self.sql.lock
        self.mysql = self.sql.mysql
        with self.lock:
            self.sql.script(_ddl(SCHEMA, self.mysql))
            for table, column, kind in ADDED_COLUMNS:
                if column not in self.sql.columns(table):
                    self.sql.run(f'ALTER TABLE {table} ADD COLUMN "{column}" {_ddl(kind, self.mysql)}')
                    if (table, column) == ("profile", "gmf_mode"):
                        self.sql.run("UPDATE profile SET gmf_mode='exenta' WHERE gmf_exempt=1")

    def q(self, sql, args=()):
        return self.sql.all(sql, args)

    def one(self, sql, args=()):
        rows = self.q(sql, args)
        return rows[0] if rows else None

    def run(self, sql, args=()):
        return self.sql.run(sql, args)

    def many(self, sql, rows):
        return self.sql.many(sql, rows)

    # ------------------------------------------------------------ perfil fiscal

    def profile(self, uid):
        q = "SELECT name, nit, habitual, method, gmf_exempt, gmf_mode, gmf_methods, auto_close, cash_account FROM profile WHERE user_id=?"
        p = self.one(q, (uid,))
        if not p:
            self.run(self.sql.insert_ignore("profile", ("user_id",)), (uid,))
            p = self.one(q, (uid,))
        p["habitual"] = bool(p["habitual"])
        p["auto_close"] = bool(p["auto_close"])
        p["gmf_asked"] = p["gmf_mode"] is not None
        p["gmf_mode"] = p["gmf_mode"] or "todas"
        p["gmf_exempt"] = p["gmf_mode"] == "exenta"
        try:
            p["gmf_methods"] = json.loads(p["gmf_methods"] or "{}")
        except ValueError:
            p["gmf_methods"] = {}
        return p

    def save_profile(self, uid, p):
        self.profile(uid)
        self.run("UPDATE profile SET name=?, nit=?, habitual=?, method=?, gmf_exempt=?, gmf_mode=?, gmf_methods=? WHERE user_id=?",
                 (p["name"], p["nit"], int(p["habitual"]), p["method"], int(p["gmf_mode"] == "exenta"), p["gmf_mode"],
                  json.dumps(p.get("gmf_methods") or {}), uid))

    def linked(self, uid):
        """¿La persona tiene su Binance conectado (en el panel)? Sin eso la wallet entera sale vacía."""
        return self.one("SELECT user_id FROM binance WHERE user_id=?", (uid,)) is not None

    def year_extra(self, uid, year):
        if not self.linked(uid):
            return {"other_income": 0.0, "other_patrimony": 0.0, "other_deposits": 0.0, "gmf_cert": 0.0}
        r = self.one("SELECT other_income, other_patrimony, other_deposits, gmf_cert FROM year_extra WHERE user_id=? AND year=?",
                     (uid, year))
        return r or {"other_income": 0.0, "other_patrimony": 0.0, "other_deposits": 0.0, "gmf_cert": 0.0}

    def save_year_extra(self, uid, year, e):
        cols = ("user_id", "year", "other_income", "other_patrimony", "other_deposits", "gmf_cert")
        self.run(self.sql.upsert("year_extra", cols, ("user_id", "year"), cols[2:]),
                 (uid, year, e["other_income"], e["other_patrimony"], e["other_deposits"], e["gmf_cert"]))

    # ------------------------------------------------------------ conexión con Binance

    def binance(self, uid):
        return self.one("SELECT * FROM binance WHERE user_id=?", (uid,))

    def save_binance(self, uid, key_fp, hint, now):
        """Une la wallet a la llave que la persona conectó en el panel. Aquí no se guarda la llave, solo su huella."""
        cols = ("user_id", "key_enc", "secret_enc", "key_fp", "hint", "created", "last_error", "cursor", "last_run", "last_ok")
        self.run(self.sql.upsert("binance", cols, ("user_id",), cols[1:]), (uid, "", "", key_fp, hint, now, None, "{}", None, None))

    def binance_sync(self, uid, **fields):
        sets = ", ".join(f'"{k}"=?' for k in fields)
        self.run(f"UPDATE binance SET {sets} WHERE user_id=?", (*fields.values(), uid))

    def delete_binance(self, uid):
        self.run("DELETE FROM binance WHERE user_id=?", (uid,))

    def binance_due(self, older_than):
        return [r["user_id"] for r in self.q("SELECT user_id FROM binance WHERE last_run IS NULL OR last_run<?", (older_than,))]

    # ------------------------------------------------------------ movimientos

    def movements(self, uid, start=None, end=None):
        if not self.linked(uid):  # sin Binance conectado no se muestra nada
            return []
        sql, args = "SELECT * FROM movements WHERE user_id=?", [uid]
        if start is not None:
            sql += " AND t>=?"
            args.append(start)
        if end is not None:
            sql += " AND t<?"
            args.append(end)
        return self.q(sql + " ORDER BY t, id", args)

    def add_movements(self, uid, moves, now):
        """Inserta ignorando duplicados (mismo ext_id). Devuelve cuántos entraron."""
        defaults = {"category": "", "pay_method": "", "fee_qty": 0.0, "fee_asset": ""}
        rows = [(uid, *[m.get(f, defaults.get(f)) if m.get(f) is not None else defaults.get(f) for f in MOVE_FIELDS], now) for m in moves]
        n = self.many(self.sql.insert_ignore("movements", ("user_id", *MOVE_FIELDS, "created")), rows)
        # completa el medio de pago de órdenes ya guardadas antes de que existiera ese dato
        fill = [(m["pay_method"], uid, m["ext_id"]) for m in moves if m.get("pay_method") and m.get("ext_id")]
        if fill:
            self.many("UPDATE movements SET pay_method=? WHERE user_id=? AND ext_id=? AND pay_method=''", fill)
        # y la comisión de Binance de órdenes guardadas cuando aún no se registraba (fuera de periodos cerrados)
        lock = self.lock_until(uid)
        fees = [(m["fee_qty"], m["fee_asset"], m["fee_cop"], m["cop_value"], uid, m["ext_id"], lock)
                for m in moves if (m.get("fee_qty") or 0) > 0 and m.get("ext_id")]
        if fees:
            self.many("UPDATE movements SET fee_qty=?, fee_asset=?, fee_cop=?, cop_value=? "
                      "WHERE user_id=? AND ext_id=? AND fee_qty=0 AND t>?", fees)
        return n

    def set_gmf_choice(self, uid, ids, on):
        """Marca en esas compras si pagaste 4x1000 (modo 'elegir cuáles')."""
        ids = [int(i) for i in ids][:5000]
        if not ids:
            return 0
        marks = ",".join("?" * len(ids))
        return self.run(f"UPDATE movements SET gmf_choice=? WHERE user_id=? AND kind='compra' AND id IN ({marks})",
                        (1 if on else 0, uid, *ids))[1]

    def set_lot_from(self, uid, mid, buy_id):
        """En esa venta, de qué compra salió (None vuelve al orden normal)."""
        return self.run("UPDATE movements SET lot_from=? WHERE user_id=? AND id=? AND kind IN ('venta','permuta','comision')",
                        (buy_id, uid, mid))[1]

    def update_movement(self, uid, mid, m):
        keep = ("ext_id", "source", "pay_method", "fee_qty", "fee_asset")
        sets = ", ".join(f"{f}=?" for f in MOVE_FIELDS if f not in keep)
        args = [m.get(f) if m.get(f) is not None or f != "category" else "" for f in MOVE_FIELDS if f not in keep]
        return self.run(f"UPDATE movements SET {sets} WHERE id=? AND user_id=?", (*args, mid, uid))[1]

    # ------------------------------------------------------------ cierres

    def closings(self, uid, with_snapshot=False):
        if not self.linked(uid):
            return []
        cols = "*" if with_snapshot else "id, kind, t, cash_expected, cash_real, adjustment, locked, note, created, auto"
        return self.q(f"SELECT {cols} FROM closings WHERE user_id=? ORDER BY t, id", (uid,))

    def closing(self, uid, cid):
        if not self.linked(uid):
            return None
        return self.one("SELECT * FROM closings WHERE user_id=? AND id=?", (uid, cid))

    def add_closing(self, uid, c, now):
        return self.run("INSERT INTO closings (user_id, kind, t, cash_expected, cash_real, adjustment, locked, snapshot, note, created, auto) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (uid, c["kind"], c["t"], c["cash_expected"], c["cash_real"], c["adjustment"], int(c["locked"]),
                         c["snapshot"], c["note"], now, int(c.get("auto", False))))[0]

    def set_auto_close(self, uid, on):
        self.profile(uid)
        self.run("UPDATE profile SET auto_close=? WHERE user_id=?", (int(bool(on)), uid))

    def notes(self, uid):
        if not self.linked(uid):
            return []
        return [{**n, "lines": json.loads(n["lines"])}
                for n in self.q('SELECT id, t, text, support, "lines" FROM notes WHERE user_id=? ORDER BY t, id', (uid,))]

    def add_note(self, uid, n, now):
        return self.run('INSERT INTO notes (user_id, t, text, support, "lines", created) VALUES (?,?,?,?,?,?)',
                        (uid, n["t"], n["text"], n["support"], json.dumps(n["lines"]), now))[0]

    def delete_note(self, uid, nid):
        return self.run("DELETE FROM notes WHERE id=? AND user_id=?", (nid, uid))[1]

    def set_cash_account(self, uid, account):
        self.profile(uid)
        self.run("UPDATE profile SET cash_account=? WHERE user_id=?", (account, uid))

    def first_movement_t(self, uid):
        if not self.linked(uid):
            return None
        r = self.one("SELECT MIN(t) AS t FROM movements WHERE user_id=?", (uid,))
        return r and r["t"]

    def delete_last_closing(self, uid):
        last = self.one("SELECT id FROM closings WHERE user_id=? ORDER BY t DESC, id DESC LIMIT 1", (uid,))
        if not last:
            return None
        self.run("DELETE FROM closings WHERE id=?", (last["id"],))
        return last["id"]

    # ------------------------------------------------------------ caja del día (no toca la contabilidad)

    def jornada_open(self, uid):
        return self.one("SELECT * FROM jornadas WHERE user_id=? AND closed IS NULL ORDER BY opened DESC LIMIT 1", (uid,))

    def jornada(self, uid, jid):
        return self.one("SELECT * FROM jornadas WHERE user_id=? AND id=?", (uid, jid))

    def jornadas(self, uid, limit=60):
        return self.q("SELECT * FROM jornadas WHERE user_id=? AND closed IS NOT NULL ORDER BY opened DESC LIMIT ?", (uid, limit))

    def open_jornada(self, uid, t, account, opening):
        return self.run("INSERT INTO jornadas (user_id, opened, account, opening) VALUES (?,?,?,?)", (uid, t, account, opening))[0]

    def close_jornada(self, uid, jid, t, cash_real, report):
        self.run("UPDATE jornadas SET closed=?, cash_real=?, report=? WHERE user_id=? AND id=? AND closed IS NULL",
                 (t, cash_real, report, uid, jid))

    def delete_jornada(self, uid, jid):
        self.run("DELETE FROM jornadas WHERE user_id=? AND id=?", (uid, jid))

    def jornada_users(self):
        """Usuarios con la caja del día abierta: se sincronizan más seguido."""
        return {r["user_id"] for r in self.q("SELECT DISTINCT user_id FROM jornadas WHERE closed IS NULL")}

    def lock_until(self, uid):
        """Fecha hasta la que los movimientos están congelados por un cierre (0 si no hay)."""
        r = self.one("SELECT MAX(t) AS t FROM closings WHERE user_id=? AND locked=1", (uid,))
        return (r and r["t"]) or 0.0

    def delete_movements(self, uid, ids=None, source=None, after=0.0):
        if ids is not None:
            ids = [int(i) for i in ids][:5000]
            if not ids:
                return 0
            marks = ",".join("?" for _ in ids)
            return self.run(f"DELETE FROM movements WHERE user_id=? AND id IN ({marks})", (uid, *ids))[1]
        if source:
            return self.run("DELETE FROM movements WHERE user_id=? AND source=? AND t>?", (uid, source, after))[1]
        return 0

    def years(self, uid):
        if not self.linked(uid):
            return {"a": None, "b": None, "n": 0}
        r = self.one("SELECT MIN(t) AS a, MAX(t) AS b, COUNT(*) AS n FROM movements WHERE user_id=?", (uid,))
        return r

    # ------------------------------------------------------------ paso de SQLite a MySQL

    def import_sqlite(self, path):
        """Primera vez con MySQL vacío: copia todo lo de wallet/backend/data/wallet.db. No borra nada del archivo.
        La conexión con Binance no se copia: se vuelve a unir sola con la llave de cada persona en el panel."""
        if not self.mysql or not os.path.exists(path) or self.one("SELECT id FROM users LIMIT 1"):
            return False
        src = storage.SQL(sqlite_path=path)
        have = src.tables()
        if "users" not in have or not src.all("SELECT id FROM users LIMIT 1"):
            return False
        for table in TABLES:
            if table not in have or table == "binance":
                continue
            dest = self.sql.columns(table)
            rows = src.all(f'SELECT * FROM "{table}"')
            if not rows:
                continue
            cols = [c for c in rows[0] if c in dest]
            self.many(self.sql.insert_ignore(table, cols), [tuple(r[c] for c in cols) for r in rows])
        print("  Se copiaron los datos de backend/data/wallet.db a MySQL (el archivo queda igual, como respaldo).")
        return True


def open_db():
    """La base según backend/.env: MySQL si hay DATABASE_URL, si no SQLite en backend/data/wallet.db."""
    url = os.environ.get("DATABASE_URL") or storage.read_env_file(ENV_FILE).get("DATABASE_URL", "")
    return DB(DB_PATH, url=url or None)


# ------------------------------------------------------------ CSV (Excel en español: ";" y BOM)

def csv_safe(v):
    """Evita fórmulas al abrir el CSV en Excel."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def csv_cell(v):
    if isinstance(v, bool):
        return "Sí" if v else "No"
    if isinstance(v, float):  # Excel en español usa coma decimal
        return ("%.8f" % v).rstrip("0").rstrip(".").replace(".", ",")
    if v is None:
        return ""
    return csv_safe(v)


def to_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(header)
    for r in rows:
        w.writerow([csv_cell(v) for v in r])
    return "﻿" + buf.getvalue()
