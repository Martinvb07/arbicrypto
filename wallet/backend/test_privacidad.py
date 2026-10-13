"""Regla de la wallet: solo lo de TU Binance; sin Binance conectado, todo vacío.  python -m unittest test_privacidad -v"""
import os
import tempfile
import time
import unittest

from auth import Auth
from banks import Banks
from db import DB


def compra(ext_id):
    return dict(t=time.time() - 3600, kind="compra", out_asset="COP", out_qty=400000, in_asset="USDT", in_qty=100, cop_value=400000,
                fee_cop=0, gmf_cop=1600, platform="Binance P2P", counterpart="", ext_id=ext_id, source="binance", note="")


class Privacidad(unittest.TestCase):
    def setUp(self):
        self.db = DB(os.path.join(tempfile.mkdtemp(), "t.db"))
        self.auth = Auth(self.db)

    def test_sin_binance_todo_vacio(self):
        uid = self.auth.account_for("uid-1", "ana", "user")
        self.db.add_movements(uid, [compra("p2p:1")], 0)  # aunque hubiera algo guardado…
        self.assertEqual(self.db.movements(uid), [])        # …sin Binance conectado no se ve
        self.assertEqual(self.db.years(uid)["n"], 0)
        self.assertEqual(self.db.closings(uid), [])
        self.assertEqual(self.db.notes(uid), [])
        self.assertEqual(Banks(self.db).accounts(uid), [])
        s = Banks(self.db).summary(uid, time.localtime().tm_year)
        self.assertEqual((s["accounts"], s["transactions"], s["files"]), ([], [], []))

    def test_con_binance_solo_lo_suyo(self):
        ana = self.auth.account_for("uid-ana", "ana", "user")
        luis = self.auth.account_for("uid-luis", "luis", "user")
        self.db.save_binance(ana, "huella-ana", "anaa…0001", 0)
        self.db.save_binance(luis, "huella-luis", "luis…0002", 0)
        self.db.add_movements(ana, [compra("p2p:ana")], 0)
        self.assertEqual([m["ext_id"] for m in self.db.movements(ana)], ["p2p:ana"])
        self.assertEqual(self.db.movements(luis), [])  # luis nunca ve lo de ana

    def test_cuentas_unidas_solo_por_id_del_panel(self):
        ana = self.auth.account_for("uid-ana", "ana", "user")
        self.assertEqual(self.auth.account_for("uid-ana", "ana.nueva", "user"), ana)  # renombrada: la misma
        otra = self.auth.account_for("uid-otra", "ana.nueva", "user")                # mismo nombre, otra persona
        self.assertNotEqual(otra, ana)


if __name__ == "__main__":
    unittest.main()
