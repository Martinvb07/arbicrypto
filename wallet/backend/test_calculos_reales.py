"""Cálculos reales de punta a punta: órdenes P2P tal como las entrega Binance → movimientos → ganancia, rondas,
caja, libros y kardex. Cada número se comprueba contra la cuenta hecha a mano y todos deben cuadrar entre sí.
python -m unittest test_calculos_reales -v"""
import unittest
from datetime import datetime

import ledger
import tax
from importers import ImportJob

D = lambda *a: datetime(*a, tzinfo=tax.CO_TZ).timestamp()


def order(n, side, amount, price, t, role="TAKER", commission=0.0, taker=0.0, method="Nequi"):
    """Una orden de /sapi/v1/c2c/orderMatch/listUserOrderHistory (los números llegan como texto)."""
    return {"orderNumber": str(n), "tradeType": side, "asset": "USDT", "fiat": "COP", "amount": str(amount),
            "unitPrice": str(price), "totalPrice": str(round(amount * price, 2)), "orderStatus": "COMPLETED",
            "createTime": int(t * 1000), "advertisementRole": role, "commission": str(commission),
            "takerCommission": str(taker), "counterPartNickName": "alguien", "payMethodName": method}


def moves(orders, gmf=True):
    out = []
    for i, o in enumerate(orders, 1):
        m = ImportJob._p2p_order(o, gmf)
        m["id"] = i
        out.append(m)
    return out


class UnaVuelta(unittest.TestCase):
    """Compras 500 USDT a $4.000 (pagas $2.000.000 desde Nequi, Binance se queda 0,25 USDT) y los vendes todos
    a $4.050 en tu anuncio (Binance te cobra 0,5 USDT de comisión de anunciante)."""

    def setUp(self):
        self.ms = moves([
            order(1, "BUY", 500, 4000, D(2026, 3, 2, 9), taker=0.25),
            order(2, "SELL", 499.25, 4050, D(2026, 3, 2, 11), role="MAKER", commission=0.5),
        ])
        self.paid = 2_000_000.0                  # salió de Nequi
        self.received = 499.25 * 4050            # entró a Nequi: 2.021.962,50
        self.gmf = self.paid * 0.004             # 4x1000 de la compra: 8.000

    def test_movimientos_como_en_binance(self):
        buy, sell = self.ms
        self.assertEqual((buy["kind"], buy["in_qty"], buy["out_qty"]), ("compra", 499.75, self.paid))
        self.assertAlmostEqual(buy["cop_value"] + buy["fee_cop"], self.paid)   # lo que muestra Movimientos
        self.assertAlmostEqual(buy["fee_cop"], 1_000)                            # 0,25 USDT a $4.000
        self.assertAlmostEqual(buy["gmf_cop"], self.gmf)
        self.assertEqual((sell["kind"], sell["out_qty"], sell["in_qty"]), ("venta", 499.75, self.received))
        self.assertAlmostEqual(sell["cop_value"] - sell["fee_cop"], self.received)
        self.assertAlmostEqual(sell["gmf_cop"], 0)                               # vender no paga 4x1000

    def test_ganancia_real(self):
        r = tax.compute(self.ms, 2026, habitual=True)
        self.assertEqual(r["holdings"], {})                                     # no queda USDT
        self.assertEqual(r["warnings"], [])
        d = r["disposals"][0]
        self.assertAlmostEqual(d["cost"], self.paid)                            # costo = lo que pagaste
        self.assertAlmostEqual(d["proceeds"], self.received)                    # lo que te llegó
        self.assertAlmostEqual(d["gain"], self.received - self.paid)            # 21.962,50
        pnl = tax.books(r, self.ms, 2026)["pnl"]
        self.assertAlmostEqual(pnl["gmf"], self.gmf)
        self.assertAlmostEqual(pnl["net"], self.received - self.paid - self.gmf)  # 13.962,50 de verdad

    def test_ronda_igual_a_la_plata_del_banco(self):
        rs = tax.rounds(self.ms, 2026)
        self.assertEqual(len(rs), 1)
        r = rs[0]
        self.assertFalse(r["open"])
        self.assertAlmostEqual(r["paid"], self.paid)
        self.assertAlmostEqual(r["received"], self.received)
        self.assertAlmostEqual(r["result"], self.received - self.paid - self.gmf)

    def test_caja_y_libros(self):
        aporte = {"id": 0, "t": D(2026, 3, 1), "kind": "aporte", "cop_value": self.paid, "fee_cop": 0, "gmf_cop": 0,
                  "out_asset": None, "out_qty": None, "in_asset": None, "in_qty": None}
        entries = ledger.journal([aporte] + self.ms)
        for e in entries:  # partida doble: cada asiento cuadra
            self.assertAlmostEqual(sum(l["debit"] for l in e["lines"]), sum(l["credit"] for l in e["lines"]), places=2)
        # en la cuenta queda: lo que metiste − lo que pagaste − 4x1000 + lo que te llegó
        self.assertAlmostEqual(ledger.cash_at(entries, D(2026, 3, 3)), self.received - self.gmf, places=2)
        start, end = tax.year_bounds(2026)
        inc = ledger.income_statement(entries, start, end)
        r = tax.compute(self.ms, 2026, habitual=True)
        self.assertAlmostEqual(inc["net"], tax.books(r, self.ms, 2026)["pnl"]["net"], places=2)

    def test_kardex_cuadra(self):
        k = {b["asset"]: b for b in tax.kardex(self.ms, 2026)}["USDT"]
        self.assertAlmostEqual(k["totals"]["in_qty"], 499.75)
        self.assertAlmostEqual(k["totals"]["out_qty"], 499.75)
        self.assertAlmostEqual(k["closing"]["qty"], 0)
        self.assertAlmostEqual(k["totals"]["gain"], self.received - self.paid)

    def test_declaracion(self):
        s = tax.summary(tax.compute(self.ms, 2026, habitual=True), 2026)
        c = s["f210"]["casillas"]
        self.assertAlmostEqual(c["74"], self.received + 0.5 * 4050)          # ingreso bruto: valor de venta
        self.assertAlmostEqual(c["78"], self.received - self.paid)           # renta líquida antes del 4x1000
        self.assertAlmostEqual(c["84"], self.gmf / 2)                        # mitad del 4x1000 deducible


class VariasVueltas(unittest.TestCase):
    """Dos compras a distinto precio y una venta parcial: PEPS toma primero lo más viejo y lo que queda vale su costo."""

    def test_venta_parcial(self):
        ms = moves([
            order(1, "BUY", 100, 4000, D(2026, 5, 1, 9)),
            order(2, "BUY", 100, 4100, D(2026, 5, 1, 10)),
            order(3, "SELL", 150, 4120, D(2026, 5, 1, 12)),
        ])
        r = tax.compute(ms, 2026, habitual=True)
        d = r["disposals"][0]
        self.assertAlmostEqual(d["cost"], 400_000 + 50 * 4100)               # 100 a 4.000 + 50 a 4.100
        self.assertAlmostEqual(d["gain"], 150 * 4120 - 605_000)              # 13.000
        self.assertAlmostEqual(r["holdings"]["USDT"]["qty"], 50)
        self.assertAlmostEqual(r["holdings"]["USDT"]["cost"], 205_000)
        rs = tax.rounds(ms, 2026)
        self.assertTrue(rs[-1]["open"])                                       # aún tienes 50 USDT: la ronda sigue
        pnl = tax.books(r, ms, 2026)["pnl"]
        self.assertAlmostEqual(pnl["gmf"], (400_000 + 410_000) * 0.004)
        self.assertAlmostEqual(pnl["net"], 13_000 - 3_240)

    def test_cuenta_exenta_no_paga_4x1000(self):
        ms = tax.apply_gmf(moves([order(1, "BUY", 100, 4000, D(2026, 5, 1, 9))]), "exenta")
        self.assertEqual(ms[0]["gmf_cop"], 0)

    def test_sin_compra_avisa(self):
        r = tax.compute(moves([order(1, "SELL", 10, 4000, D(2026, 5, 1, 9))]), 2026, habitual=True)
        self.assertEqual(len(r["warnings"]), 1)                              # "Sin costo": falta su compra


if __name__ == "__main__":
    unittest.main()
