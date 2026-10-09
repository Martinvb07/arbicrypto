"""Pasa los datos de backend/data (SQLite + archivos JSON) a MySQL.

Uso (con el panel apagado y DATABASE_URL en backend/.env):
    python migrate.py
No borra nada de backend/data: si algo sale mal, quitas DATABASE_URL y todo sigue como antes.
"""
import os
import sys

import storage
from db import DB

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
DOCS = ("users", "invites", "sessions", "settings", "prefs", "watches", "history")
TABLES = {
    "opportunities": ("id", '"key"', "kind", "label", "start_t", "end_t", "open", "best_per_usd", "best_gain", "capital", "detail"),
    "hourly": ("hour", "kind", "best"),
    "alerts": ("id", "t", "kind", "title", "body"),
    "journal": ("id", '"user"', "t", "kind", "description", "invested", "received", "estimated", "note", "created"),
    "p2p_orders": ("id", "side", "asset", "fiat", "amount", "price", "total", "status", "time", "counterpart"),
}


def main():
    env = storage.read_env_file(os.path.join(ROOT, ".env"))
    url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL", "")
    if not url.startswith(("mysql://", "mysql+pymysql://")):
        sys.exit("  Falta DATABASE_URL=mysql://usuario:clave@localhost:3306/arbicrypto en backend/.env")
    src = storage.SQL(sqlite_path=os.path.join(DATA, "cryptojesus.db"))
    dst = storage.SQL(url=url)
    DB(dst)  # crea las tablas en MySQL

    for table, cols in TABLES.items():
        rows = src.all(f"SELECT {', '.join(cols)} FROM {table}")
        if rows:  # MySQL sigue numerando despues del ultimo id copiado
            dst.many(dst.insert_ignore(table, cols), [tuple(r[c.strip('"')] for c in cols) for r in rows])
        print(f"  {table}: {len(rows)} filas")

    files, mysql = storage.Store(DATA), storage.Store(DATA, dst)
    for name in DOCS:
        data = files.load(name, None)
        if data is not None:
            mysql.save(name, data)
            print(f"  {name}.json -> MySQL")
    print("\n  Listo. Arranca el panel: ahora usa MySQL.")


if __name__ == "__main__":
    main()
