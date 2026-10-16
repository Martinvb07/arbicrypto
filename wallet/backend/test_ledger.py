"""Pruebas de la contabilidad por partida doble:  python -m unittest test_ledger -v"""
import unittest

import ledger
import tax
from test_tax import D, buy, mv, sell


def balanced(entries):
    for e in entries:
        d = sum(l["debit"] for l in e["lines"])
        c = sum(l["credit"] for l in e["lines"])
        if abs(d - c) > 0.01:
            return e
    return None


MOVES = [
    buy(D(2025, 3, 1), "USDT", 100, 400_000, gmf=1_600),
    sell(D(2025, 3, 2), "USDT", 50, 205_000, fee=1_000),
    mv(D(2025, 4, 1), "permuta", "USDT", 50, "BTC", 0.0005, cop=210_000),
    mv(D(2025, 5, 1), "ingreso", in_asset="USDT", in_qty=2, cop=8_000),
    sell(D(2026, 2, 1), "BTC", 0.0005, 230_000),
]


class PartidaDoble(unittest.TestCase):
    def test_cada_comprobante_cuadra(self):
        for habitual in (True, False):
            e = ledger.journal(MOVES, habitual=habitual)
            self.assertIsNone(balanced(e), e)

    def test_balance_general_cuadra_y_coincide_con_resultados(self):
        e = ledger.journal(MOVES, closings=[{"t": D(2025, 12, 31, 23, 59), "adjustment": 500_000, "id": 1}])
        bs = ledger.balance_sheet(e, D(2025, 12, 31, 23, 59, 59))
        self.assertTrue(bs["balanced"], bs)
        # el resultado del ejercicio es el mismo de la contabilidad del año
        r = tax.compute(MOVES, 2025, habitual=True)
        books = tax.books(r, MOVES, 2025)
        net = next(x["value"] for x in bs["equity"] if x["account"] == "3605")
        self.assertAlmostEqual(net, books["pnl"]["net"], places=2)
        # inventario a costo = patrimonio cripto del motor
        inv = next(x["value"] for x in bs["assets"] if x["account"] == "1435")
        self.assertAlmostEqual(inv, sum(h["cost"] for h in r["holdings"].values()), places=2)

    def test_resultados_del_anio_anterior_pasan_a_3705(self):
        e = ledger.journal(MOVES)
        bs = ledger.balance_sheet(e, D(2026, 6, 1))
        prev = next(x["value"] for x in bs["equity"] if x["account"] == "3705")
        net25 = ledger.income_statement(e, *tax.year_bounds(2025))["net"]
        self.assertAlmostEqual(prev, net25, places=2)
        self.assertTrue(bs["balanced"])

    def test_mayor_mensual_arrastra_resultados_del_anio(self):
        e = ledger.journal(MOVES)
        tb = ledger.trial_balance(e, D(2025, 4, 1), D(2025, 5, 1))
        ventas = next(r for r in tb["rows"] if r["account"] == "4135")
        self.assertAlmostEqual(ventas["previous"], 205_000)   # marzo
        self.assertAlmostEqual(ventas["credit"], 210_000)     # abril
        self.assertTrue(tb["totals"]["balanced"])

    def test_caja_y_ajuste_de_cierre(self):
        closing = {"t": D(2025, 3, 31), "adjustment": 300_000, "id": 7}
        e = ledger.journal(MOVES, closings=[closing])
        # caja según libros sin el ajuste: -400.000 - 1.600 + 204.000
        self.assertAlmostEqual(ledger.cash_at(e, D(2025, 3, 31), exclude_ref=7), -197_600)
        self.assertAlmostEqual(ledger.cash_at(e, D(2025, 3, 31)), 102_400)

    def test_numeracion_por_anio(self):
        e = ledger.journal(MOVES)
        self.assertEqual(e[0]["number"], "2025-00001")
        self.assertEqual(e[-1]["number"], "2026-00001")

    def test_nota_de_contabilidad_y_pasivos(self):
        # el contador causa sus honorarios: gasto 5110 contra cuentas por pagar 2335
        nota = {"id": 1, "t": D(2025, 6, 30), "text": "Honorarios junio", "support": "Cuenta de cobro 12",
                "lines": [{"account": "5110", "debit": 150_000, "credit": 0}, {"account": "2335", "debit": 0, "credit": 150_000}]}
        e = ledger.journal(MOVES, notes=[nota])
        n = next(x for x in e if x["kind"] == "nota")
        self.assertEqual(n["text"], "Nota de contabilidad: Honorarios junio")
        self.assertIsNone(balanced(e))
        bs = ledger.balance_sheet(e, D(2025, 12, 31, 23, 59))
        self.assertTrue(bs["balanced"], bs)
        self.assertEqual([(x["account"], x["value"]) for x in bs["liabilities"]], [("2335", 150_000)])
        inc = ledger.income_statement(e, *tax.year_bounds(2025))
        self.assertAlmostEqual(inc["sections"]["gastos_operacionales"], 1_600 + 150_000)  # 4x1000 + honorarios

    def test_estado_de_resultados_por_secciones(self):
        inc = ledger.income_statement(ledger.journal(MOVES), *tax.year_bounds(2025))
        s = inc["sections"]
        self.assertAlmostEqual(s["utilidad_bruta"], s["ingresos_operacionales"] - s["costo_ventas"])
        self.assertAlmostEqual(s["utilidad_operacional"], s["utilidad_bruta"] - s["gastos_operacionales"])
        self.assertAlmostEqual(inc["net"], s["utilidad_antes_impuestos"] - s["impuesto_renta"])
        self.assertAlmostEqual(s["ingresos_no_operacionales"], 8_000)    # rendimiento (4210)
        self.assertAlmostEqual(s["gastos_no_operacionales"], 1_000)      # comisión de la venta (5305)

    def test_cambios_en_el_patrimonio(self):
        e = ledger.journal(MOVES, closings=[{"t": D(2025, 3, 31), "adjustment": 300_000, "id": 7}])
        y25 = ledger.equity_changes(e, *tax.year_bounds(2025))
        self.assertTrue(y25["balanced"])
        row = {r["key"]: r for r in y25["rows"]}
        self.assertAlmostEqual(row["aportes"]["total"], 300_000)
        net25 = ledger.income_statement(e, *tax.year_bounds(2025))["net"]
        self.assertAlmostEqual(row["resultado"]["values"]["3605"], net25)
        # en 2026 el resultado de 2025 pasa de 3605 a 3705
        y26 = {r["key"]: r for r in ledger.equity_changes(e, *tax.year_bounds(2026))["rows"]}
        self.assertAlmostEqual(y26["traslado"]["values"]["3605"], -net25)
        self.assertAlmostEqual(y26["traslado"]["values"]["3705"], net25)
        self.assertAlmostEqual(y26["opening"]["total"], y25["rows"][-1]["total"])

    def test_flujo_de_efectivo(self):
        e = ledger.journal(MOVES, closings=[{"t": D(2025, 3, 31), "adjustment": 300_000, "id": 7}])
        cf = ledger.cash_flow(e, *tax.year_bounds(2025))
        self.assertAlmostEqual(cf["closing"], ledger.cash_at(e, D(2025, 12, 31, 23, 59)))
        lines = {ln["label"]: ln["value"] for s in cf["sections"] for ln in s["lines"]}
        self.assertAlmostEqual(lines["Pagos por compras de criptoactivos"], -400_000)
        self.assertAlmostEqual(lines["Pagos de 4x1000 (GMF)"], -1_600)
        self.assertAlmostEqual(lines["Cobros por ventas de criptoactivos"], 204_000)
        self.assertAlmostEqual(lines["Aportes del propietario"], 300_000)
        # no habitual: comprar y vender cripto es inversión
        inv = ledger.cash_flow(ledger.journal(MOVES, habitual=False), *tax.year_bounds(2025), habitual=False)
        self.assertEqual(next(s for s in inv["sections"] if s["id"] == "operacion")["lines"], [{"label": "Pagos de 4x1000 (GMF)", "value": -1_600}])

    def test_caja_diaria(self):
        e = ledger.journal(MOVES, closings=[{"t": D(2025, 3, 2, 23), "adjustment": 300_000, "id": 7}])
        c = ledger.daily_cash(e, *tax.year_bounds(2025))
        # la permuta sin comisión (abril) y el rendimiento en cripto (mayo) no tocan bancos: no son días de caja
        self.assertEqual([d["day"] for d in c["days"]], ["2025-03-01", "2025-03-02"])
        d1, d2 = c["days"]
        # 1 mar: compra de 400.000 con 1.600 de 4x1000, aparte
        self.assertAlmostEqual(d1["out"], 400_000)
        self.assertAlmostEqual(d1["gmf"], 1_600)
        self.assertAlmostEqual(d1["closing"], -401_600)
        # 2 mar: venta neta de comisión + ajuste del cierre; cada día arranca donde terminó el anterior
        self.assertAlmostEqual(d2["opening"], d1["closing"])
        self.assertAlmostEqual(d2["in"], 204_000 + 300_000)
        self.assertEqual(len(d2["entries"]), 2)
        self.assertAlmostEqual(c["closing"], ledger.cash_at(e, D(2025, 12, 31, 23, 59)))
        # el año siguiente arranca con el saldo final
        self.assertAlmostEqual(ledger.daily_cash(e, *tax.year_bounds(2026))["opening"], c["closing"])


class GastosYRondas(unittest.TestCase):
    MOVES = [
        mv(D(2026, 10, 8, 9), "aporte", in_asset="COP", in_qty=600_000, cop=600_000),
        buy(D(2026, 10, 8, 10), "USDT", 170.84, 550_000, gmf=2_200),
        mv(D(2026, 10, 8, 10, 5), "permuta", "USDT", 170.84, "BTC", 0.002084, cop=553_330),
        sell(D(2026, 10, 8, 22), "BTC", 0.002084, 548_150),
        buy(D(2026, 10, 9, 10), "USDT", 172.07, 550_000, gmf=2_200),
        sell(D(2026, 10, 9, 11), "USDT", 172.07, 556_000),
        {**mv(D(2026, 10, 9, 12), "gasto", out_asset="COP", out_qty=80_000, cop=80_000), "category": "servicios"},
        mv(D(2026, 10, 9, 13), "retiro", out_asset="COP", out_qty=100_000, cop=100_000),
    ]

    def test_libros_cuadran_con_gastos_aportes_y_retiros(self):
        e = ledger.journal(self.MOVES)
        self.assertIsNone(balanced(e))
        bs = ledger.balance_sheet(e, D(2026, 10, 9, 23))
        self.assertTrue(bs["balanced"], bs)
        cap = next(x["value"] for x in bs["equity"] if x["account"] == "3105")
        self.assertAlmostEqual(cap, 500_000)  # 600.000 de aporte - 100.000 de retiro
        inc = ledger.income_statement(e, *tax.year_bounds(2026))
        self.assertAlmostEqual(inc["lines"]["5135"], 80_000)
        # caja: 600.000 + ventas - compras - 4x1000 - gasto - retiro
        self.assertAlmostEqual(ledger.cash_at(e, D(2026, 10, 9, 23)), 600_000 + 548_150 + 556_000 - 1_100_000 - 4_400 - 80_000 - 100_000)

    def test_gasto_es_deducible_si_es_negocio(self):
        r = tax.compute(self.MOVES, 2026, habitual=True)
        c = tax.summary(r, 2026)["f210"]["casillas"]
        self.assertAlmostEqual(c["77"], 550_000 + 553_330 + 550_000 + 80_000)
        b = tax.books(r, self.MOVES, 2026)
        self.assertAlmostEqual(b["pnl"]["expenses"], 80_000)
        self.assertAlmostEqual(b["pnl"]["net"], (548_150 + 556_000) - 1_100_000 - 4_400 - 80_000)

    def test_rondas_de_arbitraje(self):
        rs = tax.rounds(self.MOVES, 2026)
        self.assertEqual(len(rs), 2)
        self.assertAlmostEqual(rs[0]["result_before_gmf"], -1_850)
        self.assertAlmostEqual(rs[0]["result"], -4_050)
        self.assertAlmostEqual(rs[1]["result"], 556_000 - 550_000 - 2_200)
        self.assertFalse(rs[1]["open"])
        self.assertEqual(rs[0]["assets"], ["USDT", "BTC"])


class ResultadoEnElLibro(unittest.TestCase):
    def test_venta_deja_lo_mismo_que_en_resultados(self):
        """Tu venta de 10,65 USDT: en el libro el resultado ya trae la comisión y el 4x1000 de la compra."""
        ms = [buy(D(2026, 10, 15), "USDT", 158.25, 500_000, gmf=2_000),
              sell(D(2026, 10, 15) + 3600, "USDT", 10.65, 33_924, fee=223)]
        e = [x for x in ledger.journal(ms) if x["kind"] == "venta"][0]
        d = tax.compute(ms, 2026)["disposals"][0]
        self.assertAlmostEqual(e["result"]["gmf"], d["gmf"])
        self.assertAlmostEqual(e["result"]["net"], d["net"])
        self.assertAlmostEqual(e["result"]["gmf"], 2_000 * 10.65 / 158.25)


if __name__ == "__main__":
    unittest.main()
