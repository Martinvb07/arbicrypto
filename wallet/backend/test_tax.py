"""Pruebas del motor contable:  python -m unittest test_tax -v"""
import unittest
from datetime import datetime

import tax

D = lambda *a: datetime(*a, tzinfo=tax.CO_TZ).timestamp()


def mv(t, kind, out_asset=None, out_qty=None, in_asset=None, in_qty=None, cop=0.0, fee=0.0, gmf=0.0, i=[0]):
    i[0] += 1
    return dict(id=i[0], t=t, kind=kind, out_asset=out_asset, out_qty=out_qty, in_asset=in_asset, in_qty=in_qty,
                cop_value=cop, fee_cop=fee, gmf_cop=gmf)


def buy(t, asset, qty, cop, **kw):
    return mv(t, "compra", "COP", cop, asset, qty, cop, **kw)


def sell(t, asset, qty, cop, **kw):
    return mv(t, "venta", asset, qty, "COP", cop, cop, **kw)


class Engine(unittest.TestCase):
    def test_fifo_simple(self):
        ms = [buy(D(2025, 1, 1), "USDT", 100, 400_000), buy(D(2025, 1, 2), "USDT", 100, 420_000),
              sell(D(2025, 1, 3), "USDT", 150, 650_000)]
        r = tax.compute(ms, 2025, habitual=True)
        d = r["disposals"][0]
        self.assertAlmostEqual(d["cost"], 400_000 + 210_000)
        self.assertAlmostEqual(d["gain"], 40_000)
        self.assertAlmostEqual(r["holdings"]["USDT"]["qty"], 50)
        self.assertAlmostEqual(r["holdings"]["USDT"]["cost"], 210_000)

    def test_promedio(self):
        ms = [buy(D(2025, 1, 1), "USDT", 100, 400_000), buy(D(2025, 1, 2), "USDT", 100, 420_000),
              sell(D(2025, 1, 3), "USDT", 150, 650_000)]
        r = tax.compute(ms, 2025, habitual=True, method="promedio")
        self.assertAlmostEqual(r["disposals"][0]["cost"], 615_000)
        self.assertAlmostEqual(r["holdings"]["USDT"]["cost"], 205_000)

    def test_permuta_es_enajenacion(self):
        ms = [buy(D(2025, 1, 1), "USDT", 1000, 4_000_000),
              mv(D(2025, 2, 1), "permuta", "USDT", 1000, "BTC", 0.01, cop=4_200_000),
              sell(D(2025, 3, 1), "BTC", 0.01, 4_500_000)]
        r = tax.compute(ms, 2025, habitual=True)
        gains = [round(d["gain"]) for d in r["disposals"]]
        self.assertEqual(gains, [200_000, 300_000])  # el costo del BTC es su valor comercial en la permuta
        self.assertEqual(r["holdings"], {})

    def test_comisiones(self):
        ms = [buy(D(2025, 1, 1), "USDT", 100, 400_000, fee=1_000), sell(D(2025, 1, 2), "USDT", 100, 410_000, fee=2_000)]
        r = tax.compute(ms, 2025, habitual=True)
        d = r["disposals"][0]
        self.assertAlmostEqual(d["cost"], 401_000)
        self.assertAlmostEqual(d["gain"], 410_000 - 2_000 - 401_000)
        s = tax.summary(r, 2025)
        self.assertAlmostEqual(s["f210"]["no_laborales"]["ingresos"], 410_000)
        self.assertAlmostEqual(s["f210"]["no_laborales"]["costos"], 403_000)

    def test_comision_en_otra_cripto_es_gasto(self):
        ms = [buy(D(2025, 1, 1), "BNB", 1, 2_000_000), mv(D(2025, 1, 5), "comision", "BNB", 0.01, cop=25_000)]
        r = tax.compute(ms, 2025, habitual=True)
        self.assertAlmostEqual(r["disposals"][0]["gain"], -20_000)

    def test_ganancia_ocasional_dos_anios(self):
        ms = [buy(D(2023, 3, 10), "BTC", 1, 100_000_000), sell(D(2025, 3, 10), "BTC", 0.5, 150_000_000),
              buy(D(2024, 6, 1), "ETH", 1, 10_000_000), sell(D(2025, 5, 1), "ETH", 1, 12_000_000)]
        r = tax.compute(ms, 2025, habitual=False)
        btc, eth = r["disposals"]
        self.assertAlmostEqual(btc["go_gain"], 100_000_000)  # 2 años cumplidos de fecha a fecha
        self.assertAlmostEqual(eth["ro_gain"], 2_000_000)
        s = tax.summary(r, 2025)
        self.assertAlmostEqual(s["go"]["tax"], 15_000_000)
        # operador habitual: todo es renta ordinaria
        r2 = tax.compute(ms, 2025, habitual=True)
        self.assertAlmostEqual(sum(d["go_gain"] for d in r2["disposals"]), 0)

    def test_un_dia_antes_de_dos_anios(self):
        self.assertFalse(tax.held_two_years(D(2023, 3, 10), D(2025, 3, 9, 23, 59)))
        self.assertTrue(tax.held_two_years(D(2023, 3, 10), D(2025, 3, 10)))
        self.assertTrue(tax.held_two_years(D(2024, 2, 29), D(2026, 2, 28)))

    def test_venta_sin_compra_avisa(self):
        r = tax.compute([sell(D(2025, 1, 3), "USDT", 10, 40_000)], 2025)
        self.assertEqual(len(r["warnings"]), 1)
        self.assertAlmostEqual(r["disposals"][0]["gain"], 40_000)

    def test_aviso_sin_compra_solo_en_su_anio(self):
        ms = [sell(D(2025, 1, 3), "ETH", 1, 10_000_000), buy(D(2026, 2, 1), "USDT", 10, 40_000)]
        self.assertEqual(len(tax.compute(ms, 2025)["warnings"]), 1)
        self.assertEqual(len(tax.compute(ms, 2026)["warnings"]), 0)

    def test_solo_cuenta_el_anio(self):
        ms = [buy(D(2024, 1, 1), "USDT", 100, 400_000), sell(D(2024, 6, 1), "USDT", 50, 210_000),
              sell(D(2025, 6, 1), "USDT", 50, 230_000), buy(D(2026, 1, 2), "USDT", 1, 4_000)]
        r = tax.compute(ms, 2025, habitual=True)
        self.assertEqual(len(r["disposals"]), 1)
        self.assertAlmostEqual(r["disposals"][0]["gain"], 30_000)
        self.assertAlmostEqual(r["opening"]["USDT"]["cost"], 200_000)
        self.assertEqual(r["holdings"], {})

    def test_ingresos_y_airdrop(self):
        ms = [mv(D(2025, 2, 1), "ingreso", in_asset="USDT", in_qty=10, cop=40_000),
              mv(D(2025, 2, 2), "airdrop", in_asset="XYZ", in_qty=100, cop=50_000)]
        r = tax.compute(ms, 2025, habitual=True)
        s = tax.summary(r, 2025)
        self.assertAlmostEqual(s["ro"]["income"], 40_000)
        self.assertAlmostEqual(s["go"]["airdrops"], 50_000)
        self.assertAlmostEqual(r["holdings"]["USDT"]["cost"], 40_000)  # su costo fiscal es lo que ya tributó

    def test_gmf_deducible_50(self):
        ms = [buy(D(2025, 1, 1), "USDT", 100, 1_000_000, gmf=4_000), sell(D(2025, 1, 2), "USDT", 100, 1_100_000)]
        s = tax.summary(tax.compute(ms, 2025, habitual=True), 2025)
        self.assertAlmostEqual(s["ro"]["gmf_deduction"], 2_000)
        self.assertAlmostEqual(s["ro"]["net"], 98_000)


class Formulario210(unittest.TestCase):
    def test_gmf_no_agranda_perdida(self):
        ms = [buy(D(2025, 1, 1), "USDT", 100, 1_000_000, gmf=4_000), sell(D(2025, 1, 2), "USDT", 100, 990_000)]
        s = tax.summary(tax.compute(ms, 2025, habitual=True), 2025)
        c = s["f210"]["casillas"]
        self.assertAlmostEqual(c["88"], 10_000)   # pérdida solo por la venta
        self.assertEqual(c["86"], 0)              # el 4x1000 no se resta si no hay renta líquida
        self.assertAlmostEqual(s["ro"]["net"], -10_000)

    def test_gmf_limitado_a_la_renta(self):
        ms = [buy(D(2025, 1, 1), "USDT", 1, 1_000_000, gmf=40_000), sell(D(2025, 1, 2), "USDT", 1, 1_005_000)]
        c = tax.summary(tax.compute(ms, 2025, habitual=True), 2025)["f210"]["casillas"]
        self.assertAlmostEqual(c["78"], 5_000)
        self.assertAlmostEqual(c["84"], 20_000)
        self.assertAlmostEqual(c["86"], 5_000)    # no puede pasar de la renta líquida
        self.assertEqual(c["87"], 0)

    def test_casillas_ganancia_ocasional(self):
        ms = [buy(D(2022, 1, 1), "BTC", 1, 50_000_000), sell(D(2025, 6, 1), "BTC", 1, 80_000_000)]
        c = tax.summary(tax.compute(ms, 2025, habitual=False), 2025)["f210"]["casillas"]
        self.assertAlmostEqual(c["112"], 80_000_000)
        self.assertAlmostEqual(c["113"], 50_000_000)
        self.assertAlmostEqual(c["115"], 30_000_000)
        self.assertAlmostEqual(c["127"], 4_500_000)


class Contabilidad(unittest.TestCase):
    def test_libros_por_mes_y_moneda(self):
        ms = [buy(D(2026, 3, 1), "USDT", 100, 400_000, gmf=1_600), sell(D(2026, 3, 2), "USDT", 100, 410_000),
              buy(D(2026, 5, 1), "USDT", 50, 200_000, gmf=800)]
        r = tax.compute(ms, 2026, habitual=True)
        b = tax.books(r, ms, 2026)
        mar, may = b["months"][2], b["months"][4]
        self.assertEqual(mar["ops"], 2)
        self.assertAlmostEqual(mar["gain"], 10_000)
        self.assertAlmostEqual(mar["net"], 10_000 - 1_600)
        self.assertAlmostEqual(may["bought"], 200_000)
        self.assertAlmostEqual(b["pnl"]["net"], 10_000 - 2_400)
        usdt = b["assets"][0]
        self.assertEqual(usdt["asset"], "USDT")
        self.assertAlmostEqual(usdt["hold_qty"], 50)
        self.assertAlmostEqual(usdt["sold"], 410_000)


class CuatroPorMil(unittest.TestCase):
    def test_modos(self):
        uvt = tax.UVT[2026]
        limit = 350 * uvt
        ms = [buy(D(2026, 3, 1), "USDT", 1, limit - 100_000, gmf=(limit - 100_000) * 0.004),
              buy(D(2026, 3, 2), "USDT", 1, 1_000_000, gmf=4_000),
              buy(D(2026, 4, 1), "USDT", 1, 1_000_000, gmf=4_000)]
        g = lambda mode: [round(m["gmf_cop"], 2) for m in tax.apply_gmf(ms, mode)]
        self.assertEqual(g("exenta"), [0, 0, 0])
        self.assertEqual(g("todas"), [round((limit - 100_000) * 0.004, 2), 4_000, 4_000])
        # en marzo solo pagan los 900.000 que pasan del tope; abril empieza de cero
        self.assertEqual(g("tope350"), [0, 3_600, 0])

    def test_por_cuenta(self):
        ms = [{**buy(D(2026, 10, 8), "USDT", 1, 550_000, gmf=2_200), "pay_method": "Nequi"},
              {**buy(D(2026, 10, 9), "USDT", 1, 550_000, gmf=2_200), "pay_method": "BreBKeys"}]
        r = tax.apply_gmf(ms, "todas", {"Nequi": "exenta"})
        self.assertEqual([m["gmf_cop"] for m in r], [0, 2_200])


class Kardex(unittest.TestCase):
    def test_kardex_peps(self):
        ms = [buy(D(2025, 12, 1), "USDT", 100, 400_000), buy(D(2026, 1, 5), "USDT", 100, 420_000),
              mv(D(2026, 2, 1), "permuta", "USDT", 150, "BTC", 0.002, cop=630_000), sell(D(2026, 3, 1), "BTC", 0.002, 640_000)]
        k = {b["asset"]: b for b in tax.kardex(ms, 2026)}
        usdt = k["USDT"]
        self.assertAlmostEqual(usdt["opening"]["qty"], 100)
        self.assertAlmostEqual(usdt["opening"]["cost"], 400_000)
        entrada, salida = usdt["rows"]
        self.assertAlmostEqual(entrada["bal_qty"], 200)
        self.assertAlmostEqual(salida["out_cost"], 400_000 + 210_000)   # PEPS: primero el lote viejo
        self.assertAlmostEqual(salida["out_unit"], 610_000 / 150)
        self.assertAlmostEqual(salida["gain"], 630_000 - 610_000)
        self.assertAlmostEqual(usdt["closing"]["qty"], 50)
        self.assertAlmostEqual(usdt["closing"]["cost"], 210_000)
        btc = k["BTC"]
        self.assertAlmostEqual(btc["opening"]["qty"], 0)
        self.assertAlmostEqual(btc["totals"]["in_cost"], 630_000)
        self.assertAlmostEqual(btc["totals"]["gain"], 10_000)
        self.assertAlmostEqual(btc["closing"]["qty"], 0)
        # saldo inicial + entradas - salidas = saldo final
        for b in k.values():
            self.assertAlmostEqual(b["opening"]["cost"] + b["totals"]["in_cost"] - b["totals"]["out_cost"], b["closing"]["cost"], places=4)


class Tarifas(unittest.TestCase):
    def test_art_241(self):
        self.assertEqual(tax.art241_uvt(1000), 0)
        self.assertAlmostEqual(tax.art241_uvt(1700), 610 * 0.19)
        self.assertAlmostEqual(tax.art241_uvt(2000), 300 * 0.28 + 116)
        self.assertAlmostEqual(tax.art241_uvt(40000), 9000 * 0.39 + 10352)
        # la tabla oficial redondea en los cortes (115,9 vs 116 UVT): casi continua
        for _lo, hi, _r, _f in tax.ART_241[:-1]:
            self.assertAlmostEqual(tax.art241_uvt(hi), tax.art241_uvt(hi + 1e-9), delta=0.2)

    def test_impuesto_marginal(self):
        uvt = tax.UVT[2025]
        ms = [buy(D(2025, 1, 1), "USDT", 1, 0.0001), sell(D(2025, 2, 1), "USDT", 1, 500 * uvt + 0.0001)]
        s = tax.summary(tax.compute(ms, 2025, habitual=True), 2025, other_income=1500 * uvt)
        self.assertAlmostEqual(s["ro"]["tax"] / uvt, tax.art241_uvt(2000) - tax.art241_uvt(1500), places=4)

    def test_perdida_no_resta_otras_rentas(self):
        ms = [buy(D(2025, 1, 1), "USDT", 1, 1_000_000), sell(D(2025, 2, 1), "USDT", 1, 500_000)]
        s = tax.summary(tax.compute(ms, 2025, habitual=True), 2025, other_income=100_000_000)
        self.assertEqual(s["ro"]["tax"], 0)
        self.assertAlmostEqual(s["ro"]["loss"], 500_000)

    def test_topes(self):
        uvt = tax.UVT[2025]
        ms = [buy(D(2025, 1, 1), "USDT", 1, 1400 * uvt)]
        s = tax.summary(tax.compute(ms, 2025), 2025)
        self.assertTrue(s["topes"]["compras"]["over"])
        self.assertFalse(s["topes"]["patrimonio"]["over"])

    def test_vencimientos(self):
        self.assertEqual(tax.deadline(2025, "1234567801"), "2026-08-12")
        self.assertEqual(tax.deadline(2025, "1234567802"), "2026-08-12")
        self.assertEqual(tax.deadline(2025, "1234567850-3"), "2026-09-16")
        self.assertEqual(tax.deadline(2025, "1234567800"), "2026-10-26")
        self.assertEqual(tax.deadline(2025, "1234567899"), "2026-10-26")
        self.assertIsNone(tax.deadline(2026, "1234567899"))


class VentasSinCompra(unittest.TestCase):
    def test_resultado_no_cuenta_lo_vendido_sin_compra(self):
        t = 1.76e9
        ms = [dict(id=1, t=t, kind="compra", out_asset="COP", out_qty=100000, in_asset="USDT", in_qty=30, cop_value=100000,
                   fee_cop=0, gmf_cop=400),
              dict(id=2, t=t + 60, kind="venta", out_asset="USDT", out_qty=40, in_asset="COP", in_qty=136000, cop_value=136000,
                   fee_cop=0, gmf_cop=0)]
        r = tax.compute(ms, 2025, True)
        pnl = tax.books(r, ms, 2025)["pnl"]
        self.assertAlmostEqual(pnl["gross_profit"], 36000)  # para la DIAN: los 10 sin compra van con costo $0
        self.assertAlmostEqual(pnl["unmatched"], 34000)
        self.assertAlmostEqual(pnl["net"], 30 * 3400 - 100000 - 400)  # tu resultado real


if __name__ == "__main__":
    unittest.main()
