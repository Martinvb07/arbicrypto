"""Cuentas bancarias y extractos: guardar, clasificar y resumir el año."""
import hashlib
import os
import re
import time

import statements as st
import tax

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "extractos")
KINDS = ("ahorros", "corriente", "billetera", "tarjeta")


def similar_pattern(description):
    """Patrón para "aplicar a parecidos": la descripción sin números ni referencias."""
    d = st.norm(description)
    d = re.sub(r"\d+", " ", d)
    return " ".join(d.split())[:40]


class Banks:
    def __init__(self, db):
        self.db = db

    # ------------------------------------------------------------ cuentas
    def accounts(self, uid):
        if not self.db.linked(uid):  # sin Binance conectado la wallet sale vacía
            return []
        rows = self.db.q("SELECT id, name, kind, pay_methods, created FROM accounts WHERE user_id=? ORDER BY created", (uid,))
        for r in rows:
            r["pay_methods"] = [p for p in r["pay_methods"].split(",") if p]
        return rows

    def save_account(self, uid, aid, name, kind, pay_methods):
        pm = ",".join(sorted({p.strip()[:40] for p in pay_methods if p and p.strip()}))[:300]
        if aid:
            self.db.run("UPDATE accounts SET name=?, kind=?, pay_methods=? WHERE id=? AND user_id=?", (name, kind, pm, aid, uid))
            return aid
        return self.db.run("INSERT INTO accounts (user_id, name, kind, pay_methods, created) VALUES (?,?,?,?,?)",
                           (uid, name, kind, pm, time.time()))[0]

    def account(self, uid, aid):
        return self.db.one("SELECT * FROM accounts WHERE id=? AND user_id=?", (aid, uid))

    def delete_account(self, uid, aid):
        self.db.run("DELETE FROM bank_tx WHERE user_id=? AND account_id=?", (uid, aid))
        self.db.run("DELETE FROM bank_files WHERE user_id=? AND account_id=?", (uid, aid))
        return self.db.run("DELETE FROM accounts WHERE id=? AND user_id=?", (aid, uid))[1]

    # ------------------------------------------------------------ extractos
    def save_file(self, uid, aid, filename, data, rows):
        sha = hashlib.sha256(data).hexdigest()
        folder = os.path.join(DATA_DIR, str(uid))
        os.makedirs(folder, exist_ok=True)
        ext = filename.lower().rsplit(".", 1)[-1][:5] if "." in filename else "bin"
        with open(os.path.join(folder, f"{sha[:24]}.{ext}"), "wb") as f:
            f.write(data)  # el original queda como soporte en backend/data (nunca va a git)
        days = sorted(r["day"] for r in rows)
        fid = self.db.run('INSERT INTO bank_files (user_id, account_id, name, sha, "rows", day_from, day_to, uploaded) VALUES (?,?,?,?,?,?,?,?)',
                          (uid, aid, filename[:120], sha, len(rows), days[0].isoformat() if days else None,
                           days[-1].isoformat() if days else None, time.time()))[0]
        fps = st.fingerprints(aid, rows)
        added = self.db.many(
            self.db.sql.insert_ignore("bank_tx", ("user_id", "account_id", "file_id", "day", "t", "description", "amount", "balance", "fp")),
            [(uid, aid, fid, r["day"].isoformat(), st.day_ts(r["day"]), r["description"], r["amount"], r["balance"], fp)
             for r, fp in zip(rows, fps)])
        self.reclassify(uid)
        return fid, added, len(rows) - added

    def known(self, uid, aid, rows):
        """Cuántas filas ya estaban guardadas (para la vista previa)."""
        fps = st.fingerprints(aid, rows)
        if not fps:
            return 0
        marks = ",".join("?" for _ in fps)
        return self.db.one(f"SELECT COUNT(*) AS n FROM bank_tx WHERE user_id=? AND fp IN ({marks})", (uid, *fps))["n"]

    def files(self, uid):
        if not self.db.linked(uid):
            return []
        return self.db.q('SELECT id, account_id, name, "rows", day_from, day_to, uploaded FROM bank_files WHERE user_id=? ORDER BY uploaded DESC', (uid,))

    def delete_file(self, uid, fid):
        self.db.run("DELETE FROM bank_tx WHERE user_id=? AND file_id=?", (uid, fid))
        n = self.db.run("DELETE FROM bank_files WHERE id=? AND user_id=?", (fid, uid))[1]
        self.reclassify(uid)
        return n

    # ------------------------------------------------------------ clasificación
    def reclassify(self, uid):
        """Vuelve a clasificar lo automático: reglas tuyas → Binance P2P → entre tus cuentas → palabras clave."""
        txs = self.db.q("SELECT id, account_id, t, description, amount, category, auto, match_id FROM bank_tx WHERE user_id=?", (uid,))
        rules = [(r["pattern"], r["category"]) for r in self.db.q("SELECT pattern, category FROM bank_rules WHERE user_id=?", (uid,))]
        acc_pm = {a["id"]: a["pay_methods"] for a in self.accounts(uid)}
        auto = [t for t in txs if t["auto"]]
        result = {t["id"]: (None, None) for t in auto}
        for t in auto:
            d = st.norm(t["description"])
            for pattern, cat in rules:
                if pattern and pattern in d:
                    result[t["id"]] = (cat, None)
                    break
        # toda compra o venta en pesos (de Binance o agregada a mano) sale o llega a alguna cuenta
        # lo que de verdad pasó por el banco: en la compra valor + comisión, en la venta valor - comisión
        p2p = self.db.q("SELECT id, t, kind, cop_value + CASE kind WHEN 'compra' THEN fee_cop ELSE -fee_cop END AS cop_value, pay_method "
                        "FROM movements WHERE user_id=? AND kind IN ('compra','venta')", (uid,))
        used = {t["match_id"] for t in txs if not t["auto"] and t["match_id"]}
        free = [dict(t, pay_methods=acc_pm.get(t["account_id"], [])) for t in auto if result[t["id"]][0] is None]
        for tid, mid in st.match_p2p(free, p2p, used).items():
            result[tid] = ("binance_p2p", mid)
        free = [t for t in auto if result[t["id"]][0] is None]
        for a, b in st.match_transfers(free):
            result[a] = result[b] = ("traslado", None)
        for t in auto:
            if result[t["id"]][0] is None:
                result[t["id"]] = (st.classify(t["description"]) or "otro", None)
        self.db.many("UPDATE bank_tx SET category=?, match_id=? WHERE id=?",
                     [(cat, mid, tid) for tid, (cat, mid) in result.items()])

    def set_category(self, uid, tid, category, note=None, similar=False):
        tx = self.db.one("SELECT description FROM bank_tx WHERE id=? AND user_id=?", (tid, uid))
        if not tx:
            return False
        self.db.run("UPDATE bank_tx SET category=?, auto=0, match_id=CASE WHEN ?='binance_p2p' THEN match_id ELSE NULL END, "
                    "note=COALESCE(?, note) WHERE id=? AND user_id=?", (category, category, note, tid, uid))
        if similar:
            pattern = similar_pattern(tx["description"])
            if len(pattern) >= 4:
                self.db.run(self.db.sql.upsert("bank_rules", ("user_id", "pattern", "category"), ("user_id", "pattern"), ("category",)),
                            (uid, pattern, category))
        self.reclassify(uid)
        return True

    # ------------------------------------------------------------ resumen del año
    def summary(self, uid, year):
        start, end = tax.year_bounds(year)
        accounts = self.accounts(uid)
        files = self.files(uid)
        linked = self.db.linked(uid)
        txs = self.db.q("SELECT * FROM bank_tx WHERE user_id=? ORDER BY t, id", (uid,)) if linked else []
        moves = {m["id"]: m for m in self.db.q("SELECT id, t, kind, cop_value + CASE kind WHEN 'compra' THEN fee_cop ELSE -fee_cop END "
                                                "AS cop_value, out_asset, in_asset, out_qty, in_qty, pay_method "
                                                "FROM movements WHERE user_id=? AND kind IN ('compra','venta')", (uid,))} if linked else {}
        cats = {k: {"category": k, "name": v, "in": 0.0, "out": 0.0, "n": 0} for k, v in st.CATEGORIES.items()}
        acc = {a["id"]: {**a, "in": 0.0, "out": 0.0, "gmf": 0.0, "n": 0, "balance_end": None, "balance_end_day": None,
                         "last_balance": None, "last_day": None, "files": 0, "day_from": None, "day_to": None} for a in accounts}
        for f in files:
            a = acc.get(f["account_id"])
            if a:
                a["files"] += 1
                if f["day_from"] and (not a["day_from"] or f["day_from"] < a["day_from"]):
                    a["day_from"] = f["day_from"]
                if f["day_to"] and (not a["day_to"] or f["day_to"] > a["day_to"]):
                    a["day_to"] = f["day_to"]
        year_tx = []
        for t in txs:
            a = acc.get(t["account_id"])
            if a and t["balance"] is not None:
                a["last_balance"], a["last_day"] = t["balance"], t["day"]
                if t["t"] < end:
                    a["balance_end"], a["balance_end_day"] = t["balance"], t["day"]
            if not start <= t["t"] < end:
                continue
            c = cats.get(t["category"]) or cats["otro"]
            c["n"] += 1
            if t["amount"] > 0:
                c["in"] += t["amount"]
            else:
                c["out"] += -t["amount"]
            if a:
                a["n"] += 1
                a["in" if t["amount"] > 0 else "out"] += abs(t["amount"])
                if t["category"] == "gmf":
                    a["gmf"] += -t["amount"]
            m = moves.get(t["match_id"]) if t["match_id"] else None
            year_tx.append({k: t[k] for k in ("id", "account_id", "day", "t", "description", "amount", "balance", "category", "auto", "note")}
                           | {"match": {"id": m["id"], "kind": m["kind"], "asset": m["in_asset"] if m["kind"] == "compra" else m["out_asset"],
                                        "qty": m["in_qty"] if m["kind"] == "compra" else m["out_qty"]} if m else None})
        matched = {t["match_id"] for t in txs if t["match_id"]}
        unmatched = [{"id": m["id"], "t": m["t"], "kind": m["kind"], "cop_value": m["cop_value"], "pay_method": m["pay_method"]}
                     for m in moves.values() if start <= m["t"] < end and m["id"] not in matched]
        ins = lambda k: cats[k]["in"]
        outs = lambda k: cats[k]["out"]
        dian = {
            "bank_balances_end": sum(a["balance_end"] or 0 for a in acc.values()),
            "deposits_other": sum(c["in"] for k, c in cats.items() if k not in ("traslado", "binance_p2p")),
            "salary": ins("salario"),
            "other_income": ins("ingreso") + ins("rendimientos"),
            "consumption": outs("consumo") + outs("credito"),
            "gmf_real": outs("gmf") - ins("gmf"),
        }
        return {"accounts": list(acc.values()), "files": files, "categories": [c for c in cats.values() if c["n"]],
                "transactions": year_tx, "p2p_unmatched": sorted(unmatched, key=lambda x: x["t"]), "dian": dian,
                "category_names": st.CATEGORIES}
