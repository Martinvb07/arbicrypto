"""Caja del día: abres con tu saldo, las compras y ventas se suman solas y al cerrar sale el informe.
python -m unittest test_jornada -v"""
import os
import tempfile
import time
import unittest

import app as wallet
from auth import Auth
from db import DB


def p2p(ext_id, t, side, qty, total, fee=0.0, method="Nequi"):
    gmf = round(total * 0.004, 2) if side == "BUY" else 0.0
    from importers import p2p_move
    return p2p_move(ext_id, side, "USDT", "COP", qty, total, fee, t, "alguien", gmf, method)


class Jornada(unittest.TestCase):
    def setUp(self):
        self.db = DB(os.path.join(tempfile.mkdtemp(), "t.db"))
        wallet.db = self.db
        self.uid = Auth(self.db).account_for("uid-1", "ana", "user")
        self.db.save_binance(self.uid, "huella", "x…y", 0)

    def test_informe_del_dia(self):
        t0 = time.time() - 3600
        jid = self.db.open_jornada(self.uid, t0, "Nequi", 120000)
        self.db.add_movements(self.uid, [
            p2p("1", t0 + 60, "BUY", 30, 100000),            # compras 30 USDT por 100.000 (+ 400 de 4x1000)
            p2p("2", t0 + 120, "SELL", 30, 101000),          # vendes los 30 por 101.000
            p2p("3", t0 + 180, "BUY", 5, 17000),             # compras 5 más y no los vendes
            p2p("9", t0 - 60, "BUY", 1, 3400),               # antes de abrir: no cuenta
        ], 0)
        r = wallet.jornada_report(self.uid, self.db.jornada(self.uid, jid), time.time())
        self.assertEqual((r["totals"]["buys"], r["totals"]["sells"]), (2, 1))
        self.assertAlmostEqual(r["totals"]["gmf"], 400 + 68)
        self.assertAlmostEqual(r["expected"], 120000 - 100000 + 101000 - 17000 - 468)
        usdt = r["assets"][0]
        self.assertAlmostEqual(usdt["left"], 5)                       # te quedaron 5 USDT
        self.assertAlmostEqual(r["gain"], 30 * (101000 / 30 - 117000 / 35) - 468)  # vueltas del día al costo promedio, menos 4x1000

    def test_cerrar_guarda_y_libera(self):
        jid = self.db.open_jornada(self.uid, time.time() - 60, "Nequi", 50000)
        self.assertIsNotNone(self.db.jornada_open(self.uid))
        self.assertEqual(self.db.jornada_users(), {self.uid})
        self.db.close_jornada(self.uid, jid, time.time(), 49000, "{}")
        self.assertIsNone(self.db.jornada_open(self.uid))
        self.assertEqual(len(self.db.jornadas(self.uid)), 1)
        self.assertEqual(self.db.jornada_users(), set())


if __name__ == "__main__":
    unittest.main()
