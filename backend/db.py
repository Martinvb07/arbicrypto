"""Almacenamiento permanente de ArbiCrypto: SQLite (backend/data/cryptojesus.db) o MySQL si hay DATABASE_URL.

Guarda: oportunidades detectadas, mejor ganancia por hora, avisos, bitacora de operaciones,
las ordenes P2P de la cuenta de Binance de cada usuario y el chat del equipo.
"""
import csv
import io
import json
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
  id {serial},
  "key" TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  start_t {real} NOT NULL,
  end_t {real} NOT NULL,
  open {int} NOT NULL DEFAULT 1,
  best_per_usd {real} NOT NULL,
  best_gain {real} NOT NULL,
  capital {real} NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_start ON opportunities(start_t);
CREATE TABLE IF NOT EXISTS hourly (
  hour {bigint} NOT NULL,
  kind {keytext} NOT NULL,
  best {real} NOT NULL,
  PRIMARY KEY (hour, kind)
);
CREATE TABLE IF NOT EXISTS alerts (
  id {serial},
  t {real} NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  id {serial},
  "user" TEXT NOT NULL,
  t {real} NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  invested {real} NOT NULL,
  received {real} NOT NULL,
  estimated {real},
  note TEXT,
  created {real} NOT NULL
);
CREATE TABLE IF NOT EXISTS p2p_orders (
  id {keytext} PRIMARY KEY,
  side TEXT, asset TEXT, fiat TEXT,
  amount {real}, price {real}, total {real},
  status TEXT, time {bigint}, counterpart TEXT,
  "user" {keytext}
);
CREATE TABLE IF NOT EXISTS messages (
  id {serial},
  t {real} NOT NULL,
  sender {keytext} NOT NULL,
  recipient {keytext},
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(recipient, sender);
CREATE TABLE IF NOT EXISTS chat_reads (
  "user" {keytext} NOT NULL,
  peer {keytext} NOT NULL,
  last_id {bigint} NOT NULL,
  PRIMARY KEY ("user", peer)
);
"""

# Columnas que se agregaron despues de crear la tabla: una base vieja (por ejemplo, la del VPS) las recibe sola
ADDED_COLUMNS = (("p2p_orders", "user", "{keytext}"),)

KEEP_DAYS = 120  # historial de oportunidades y horas


def csv_safe(v):
    """Evita que Excel ejecute formulas escondidas en un texto (inyeccion CSV)."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def to_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")  # ';' para que Excel en español separe bien las columnas
    w.writerow(header)
    for r in rows:
        w.writerow([csv_safe(x) for x in r])
    return "﻿" + buf.getvalue()  # BOM: Excel reconoce las tildes


class DB:
    def __init__(self, sql):
        """sql: storage.SQL (SQLite o MySQL)."""
        self.sql = sql
        my = sql.mysql
        sql.script(SCHEMA.format(serial=sql.serial(), real="DOUBLE" if my else "REAL", keytext=sql.keytext(),
                                 bigint="BIGINT" if my else "INTEGER", int="INTEGER"))
        for table, column, kind in ADDED_COLUMNS:
            if column not in sql.columns(table):
                sql.run(f'ALTER TABLE {table} ADD COLUMN "{column}" {kind.format(keytext=sql.keytext())}')
        # Si el panel se apago con oportunidades abiertas, se cierran en su ultima hora vista
        sql.run("UPDATE opportunities SET open = 0 WHERE open = 1")
        sql.run("DELETE FROM hourly WHERE hour < ?", (time.time() - KEEP_DAYS * 86400,))

    def _all(self, q, args=()):
        return self.sql.all(q, args)

    def _run(self, q, args=(), returning=False):
        return self.sql.run(q, args, returning)

    # ------------------------------------------------------------ oportunidades

    def track(self, kind, current, capital, now):
        """current: {key: (label, per_usd, gain, detail)} de lo que esta activo en este escaneo."""
        g = self.sql.greatest()
        with self.sql.lock:
            open_rows = {r["key"]: r for r in self._all(
                'SELECT id, "key", best_per_usd FROM opportunities WHERE open = 1 AND kind = ?', (kind,))}
            for key, row in open_rows.items():
                if key not in current:
                    self._run("UPDATE opportunities SET open = 0 WHERE id = ?", (row["id"],))
            for key, (label, per_usd, gain, detail) in current.items():
                row = open_rows.get(key)
                if row:
                    self._run(f"UPDATE opportunities SET end_t = ?, best_per_usd = {g}(best_per_usd, ?), "
                              f"best_gain = {g}(best_gain, ?) WHERE id = ?", (now, per_usd, gain, row["id"]))
                else:
                    self._run(
                        'INSERT INTO opportunities ("key", kind, label, start_t, end_t, best_per_usd, best_gain, capital, detail) '
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (key, kind, label, now, now, per_usd, gain, capital, json.dumps(detail)))

    def hourly_best(self, kind, best, now):
        if best is None:
            return
        hour = int(now // 3600 * 3600)
        self._run(self.sql.upsert("hourly", ("hour", "kind", "best"), ("hour", "kind"), {"best": "max"}), (hour, kind, best))

    def stats(self, days):
        since = time.time() - days * 86400
        opps = self._all("SELECT id, kind, label, start_t, end_t, open, best_per_usd, best_gain, capital "
                         "FROM opportunities WHERE start_t >= ? ORDER BY start_t DESC LIMIT 500", (since,))
        hours = self._all("SELECT hour, kind, best FROM hourly WHERE hour >= ? ORDER BY hour", (since,))
        return opps, hours

    # ------------------------------------------------------------ avisos

    def add_alert(self, t, kind, title, body):
        return self._run("INSERT INTO alerts (t, kind, title, body) VALUES (?, ?, ?, ?)", (t, kind, title, body), returning=True)

    def recent_alerts(self, n=200):
        return self._all("SELECT id, t, kind, title, body FROM alerts ORDER BY id DESC LIMIT ?", (n,))

    # ------------------------------------------------------------ bitacora

    def add_journal(self, user, t, kind, description, invested, received, estimated, note):
        return self._run(
            'INSERT INTO journal ("user", t, kind, description, invested, received, estimated, note, created) '
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (user, t, kind, description, invested, received, estimated, note, time.time()),
            returning=True)

    def journal(self, user=None):
        if user:
            return self._all('SELECT * FROM journal WHERE "user" = ? ORDER BY t DESC', (user,))
        return self._all("SELECT * FROM journal ORDER BY t DESC")

    def journal_entry(self, entry_id):
        rows = self._all("SELECT * FROM journal WHERE id = ?", (entry_id,))
        return rows[0] if rows else None

    def rename_user(self, old, new):
        """Todo lo del usuario pasa al nombre nuevo en una sola transaccion: o se mueve todo o nada."""
        self.sql.transaction([(q, (new, old)) for q in (
            'UPDATE journal SET "user" = ? WHERE "user" = ?',
            'UPDATE p2p_orders SET "user" = ? WHERE "user" = ?',
            "UPDATE messages SET sender = ? WHERE sender = ?",
            "UPDATE messages SET recipient = ? WHERE recipient = ?",
            'UPDATE chat_reads SET "user" = ? WHERE "user" = ?',
            "UPDATE chat_reads SET peer = ? WHERE peer = ?",
        )])

    def delete_journal(self, entry_id):
        self._run("DELETE FROM journal WHERE id = ?", (entry_id,))

    # ------------------------------------------------------------ ordenes P2P de Binance

    def save_orders(self, user, orders):
        cols = ("id", "side", "asset", "fiat", "amount", "price", "total", "status", "time", "counterpart")
        self.sql.many(self.sql.upsert("p2p_orders", cols + ('"user"',), ("id",), {"status": "new"}),
                      [tuple(o.get(c) for c in cols) + (user,) for o in orders if o.get("id")])

    def orders(self, user):
        """Solo las ordenes de la cuenta de Binance de ese usuario."""
        return self._all('SELECT * FROM p2p_orders WHERE "user" = ? ORDER BY time DESC', (user,))

    # ------------------------------------------------------------ chat del equipo
    # recipient NULL = canal general; si no, mensaje privado. En chat_reads, peer "" = canal general.

    @staticmethod
    def _msg(r):
        return {"id": r["id"], "t": r["t"], "from": r["sender"], "to": r["recipient"], "body": r["body"]}

    def add_message(self, sender, recipient, body):
        t = time.time()
        msg_id = self._run("INSERT INTO messages (t, sender, recipient, body) VALUES (?, ?, ?, ?)",
                           (t, sender, recipient, body), returning=True)
        return {"id": msg_id, "t": t, "from": sender, "to": recipient, "body": body}

    def messages(self, user, peer, before=None, limit=60):
        """Los ultimos mensajes de una conversacion (antes de `before` para cargar los viejos), del mas viejo al mas nuevo."""
        if peer:
            where, args = "((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))", [user, peer, peer, user]
        else:
            where, args = "recipient IS NULL", []
        if before:
            where += " AND id < ?"
            args.append(before)
        rows = self._all(f"SELECT * FROM messages WHERE {where} ORDER BY id DESC LIMIT ?", (*args, limit))
        return [self._msg(r) for r in reversed(rows)]

    def message(self, msg_id):
        rows = self._all("SELECT * FROM messages WHERE id = ?", (msg_id,))
        return self._msg(rows[0]) if rows else None

    def delete_message(self, msg_id):
        self._run("DELETE FROM messages WHERE id = ?", (msg_id,))

    def mark_read(self, user, peer, last_id):
        self._run(self.sql.upsert("chat_reads", ('"user"', "peer", "last_id"), ('"user"', "peer"), {"last_id": "max"}),
                  (user, peer, last_id))

    def chat_summary(self, user):
        """{peer: {"last": mensaje, "unread": n}} de cada conversacion de este usuario ("" = canal general)."""
        reads = {r["peer"]: r["last_id"] for r in self._all('SELECT peer, last_id FROM chat_reads WHERE "user" = ?', (user,))}
        out = {}
        rows = self._all("SELECT * FROM messages WHERE recipient IS NULL ORDER BY id DESC LIMIT 1")
        if rows:
            n = self._all("SELECT COUNT(*) AS n FROM messages WHERE recipient IS NULL AND id > ? AND sender <> ?",
                          (reads.get("", 0), user))[0]["n"]
            out[""] = {"last": self._msg(rows[0]), "unread": n}
        last = self._all(
            "SELECT * FROM messages WHERE id IN (SELECT MAX(id) FROM messages WHERE recipient IS NOT NULL "
            "AND (sender = ? OR recipient = ?) GROUP BY CASE WHEN sender = ? THEN recipient ELSE sender END)",
            (user, user, user))
        for r in last:
            peer = r["recipient"] if r["sender"] == user else r["sender"]
            out[peer] = {"last": self._msg(r), "unread": 0}
        for r in self._all('SELECT m.sender, COUNT(*) AS n FROM messages m LEFT JOIN chat_reads r '
                           'ON r."user" = m.recipient AND r.peer = m.sender '
                           "WHERE m.recipient = ? AND m.id > COALESCE(r.last_id, 0) GROUP BY m.sender", (user,)):
            if r["sender"] in out:
                out[r["sender"]]["unread"] = r["n"]
        return out
