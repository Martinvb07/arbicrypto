"""Pruebas de lectura de archivos:  python -m unittest test_importers -v"""
import unittest
from datetime import datetime, timezone

import importers
from importers import ImportJob, read_csv

EN = """Order Number,Order Type,Asset Type,Fiat Type,Total Price,Price,Quantity,Exchange rate,Maker Fee,Maker Fee Rate,Taker Fee,Taker Fee Rate,Couterparty,Status,Created Time
22755145021487845376,Buy,USDT,COP,4350000.00,4350.00,1000.00,,0,0,0,0,Pepe,Completed,2025-04-10 13:00:00
22755145021487845377,Sell,USDT,COP,4330000.00,4330.00,1000.00,,1.5,0.0015,0,0,Ana,Completed,2025-04-10 14:00:00
22755145021487845378,Buy,USDT,COP,100000.00,4000.00,25.00,,0,0,0,0,Luis,Cancelled,2025-04-11 14:00:00
22755145021487845379,Buy,USDT,VES,100.00,40.00,2.50,,0,0,0,0,Max,Completed,2025-04-12 14:00:00
"""

ES = """Número de orden;Tipo de orden;Tipo de activo;Tipo de fiat;Precio total;Precio;Cantidad;Comisión del creador;Contraparte;Estado;Hora de creación
22755145021487845380;Comprar;USDT;COP;1.000.000,50;4.000;250;0;Pepe;Completada;2025-12-31 23:30:00
"""


class P2PFile(unittest.TestCase):
    def test_ingles(self):
        moves, errors, _ = read_csv(EN, gmf=True)
        self.assertEqual(errors, [])
        self.assertEqual(len(moves), 2)  # cancelada y en bolívares no cuentan
        buy, sell = moves[0][1], moves[1][1]
        self.assertEqual(buy["kind"], "compra")
        self.assertEqual(buy["ext_id"], "p2p:22755145021487845376")  # mismo id que la API: no se duplica
        self.assertAlmostEqual(buy["gmf_cop"], 17400)
        self.assertEqual(buy["t"], datetime(2025, 4, 10, 13, tzinfo=timezone.utc).timestamp())
        self.assertEqual(sell["kind"], "venta")
        self.assertAlmostEqual(sell["out_qty"], 1001.5)  # comisión de anunciante en cripto
        self.assertEqual(sell["source"], "binance")

    def test_espanol_y_sin_4x1000(self):
        moves, errors, _ = read_csv(ES, gmf=False)
        self.assertEqual(errors, [])
        m = moves[0][1]
        self.assertAlmostEqual(m["cop_value"], 1_000_000.5)
        self.assertEqual(m["gmf_cop"], 0)
        # 31 dic 23:30 UTC = 31 dic 18:30 en Colombia: sigue siendo 2025
        self.assertEqual(datetime.fromtimestamp(m["t"], timezone.utc).hour, 23)

    def test_numero_de_orden_danado_por_excel(self):
        bad = EN.replace("22755145021487845376", "2.27551E+19")
        _, errors, _ = read_csv(bad)
        self.assertTrue(any("Excel" in e for e in errors))


class P2PApi(unittest.TestCase):
    def test_orden_api_taker(self):
        o = {"orderNumber": "1", "tradeType": "BUY", "asset": "USDT", "fiat": "COP", "amount": "100", "totalPrice": "410000",
             "orderStatus": "COMPLETED", "createTime": 1735689600000, "commission": "0", "takerCommission": "0.1",
             "advertisementRole": "TAKER", "counterPartNickName": "x"}
        m = ImportJob._p2p_order(o, gmf=False)
        self.assertAlmostEqual(m["in_qty"], 99.9)
        self.assertIsNone(ImportJob._p2p_order({**o, "orderStatus": "CANCELLED"}, gmf=False))

    def test_comision_de_binance_en_pesos(self):
        # orden real: pagó $550.000 por 173,22 USDT y Binance se quedó 0,07 USDT
        o = {"orderNumber": "2", "tradeType": "BUY", "asset": "USDT", "fiat": "COP", "amount": "173.22", "totalPrice": "550000",
             "orderStatus": "COMPLETED", "createTime": 1735689600000, "takerCommission": "0.07", "advertisementRole": "TAKER",
             "counterPartNickName": "x", "payMethodName": "Nequi"}
        m = ImportJob._p2p_order(o, gmf=True)
        self.assertAlmostEqual(m["in_qty"], 173.15)
        self.assertAlmostEqual(m["fee_qty"], 0.07)
        self.assertEqual(m["fee_asset"], "USDT")
        self.assertAlmostEqual(m["fee_cop"], round(0.07 * 550000 / 173.22, 2))
        self.assertAlmostEqual(m["cop_value"] + m["fee_cop"], 550000)   # lo pagado no cambia
        self.assertAlmostEqual(m["gmf_cop"], 2200)                       # 4x1000 sobre lo que salió del banco

    def test_completa_la_comision_de_ordenes_guardadas(self):
        import os, tempfile
        from db import DB
        db = DB(os.path.join(tempfile.mkdtemp(), "t.db"))
        uid = db.run("INSERT INTO users (username, pw, salt, iter, created) VALUES ('a','x','x',1,0)")[0]
        db.save_binance(uid, "huella", "abcd…wxyz", 0)  # su Binance conectado (en el panel)
        o = {"orderNumber": "3", "tradeType": "BUY", "asset": "USDT", "fiat": "COP", "amount": "173.22", "totalPrice": "550000",
             "orderStatus": "COMPLETED", "createTime": 1735689600000, "takerCommission": "0.07", "advertisementRole": "TAKER",
             "counterPartNickName": "x"}
        m = ImportJob._p2p_order(o, gmf=True)
        old = {**m, "cop_value": 550000.0, "fee_cop": 0.0, "fee_qty": 0.0, "fee_asset": ""}   # como se guardaba antes
        self.assertEqual(db.add_movements(uid, [old], 0), 1)
        self.assertEqual(db.add_movements(uid, [m], 0), 0)              # no duplica…
        saved = db.movements(uid)[0]
        self.assertAlmostEqual(saved["fee_qty"], 0.07)                   # …pero completa la comisión
        self.assertAlmostEqual(saved["cop_value"] + saved["fee_cop"], 550000)
        self.assertAlmostEqual(saved["in_qty"], 173.15)


class FakeRates:
    def cop(self, asset, qty, t):
        usd = {"BTC": 60000.0, "BNB": 600.0, "SOL": 150.0}.get(asset, 1.0)
        return {"cop": qty * usd * 4000, "usd": usd, "trm": 4000.0}


class FakeBinance:
    """Responde como la API de Binance (formas tomadas de la documentación oficial)."""

    def __init__(self, now):
        self.now = now
        self.key = self.secret = "x"
        self.s = type("S", (), {"headers": {}})()
        self.calls = []

    def sync_time(self):
        pass

    def check_read_only(self):
        pass

    def call(self, path, signed=True, method="GET", **p):
        self.calls.append((method, path))
        ms = lambda t: int(t * 1000)
        inside = lambda t, a, b: a <= ms(t) < b
        if path.endswith("listUserOrderHistory"):
            t = self.now - 5 * 86400
            data = []
            if p["tradeType"] == "BUY" and inside(t, p["startTimestamp"], p["endTimestamp"]):
                data = [{"orderNumber": "111", "tradeType": "BUY", "asset": "USDT", "fiat": "COP", "amount": "100",
                         "totalPrice": "400000", "orderStatus": "COMPLETED", "createTime": ms(t), "commission": "0",
                         "advertisementRole": "TAKER", "counterPartNickName": "x"}]
            return {"code": "000000", "data": data, "success": True}
        if path.endswith("convert/tradeFlow"):
            t = self.now - 3 * 86400
            rows = [{"orderId": 9, "orderStatus": "SUCCESS", "fromAsset": "USDT", "fromAmount": "50", "toAsset": "SOL",
                     "toAmount": "0.3", "createTime": ms(t)}] if inside(t, p["startTime"], p["endTime"]) else []
            return {"list": rows, "moreData": False}
        if path == "/api/v3/exchangeInfo":
            return {"symbols": [{"symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT"}]}
        if path == "/api/v3/account":
            return {"balances": [{"asset": "BTC", "free": "0.001", "locked": "0"}, {"asset": "LDUSDT", "free": "5", "locked": "0"}]}
        if path == "/api/v3/myTrades":
            if p["fromId"] > 1:
                return []
            return [{"id": 1, "qty": "0.001", "quoteQty": "40", "commission": "0.00001", "commissionAsset": "BNB",
                     "isBuyer": True, "time": ms(self.now - 2 * 86400)}]
        if "rewardsRecord" in path:
            t = self.now - 2 * 86400
            if "flexible" in path and p.get("type") == "REALTIME" and inside(t, p["startTime"], p["endTime"]):
                return {"rows": [{"asset": "USDT", "rewards": "0.5", "time": ms(t)}, {"asset": "USDT", "rewards": "0.25", "time": ms(t + 60)}], "total": 2}
            return {"rows": [], "total": 0}
        if path.endswith("asset/dribblet"):
            return {"total": 1, "userAssetDribblets": [{"operateTime": ms(self.now - 86400), "transId": 77, "userAssetDribbletDetails": [
                {"transId": 77, "amount": "0.02", "fromAsset": "SOL", "transferedAmount": "0.004", "operateTime": ms(self.now - 86400)}]}]}
        if path.endswith("get-funding-asset"):
            assert method == "POST"
            return [{"asset": "USDT", "free": "10", "locked": "0", "freeze": "0", "withdrawing": "0"}]
        if path.endswith("flexible/position"):
            return {"rows": [{"asset": "USDT", "totalAmount": "20"}], "total": 1}
        if path.endswith("locked/position"):
            return {"rows": [], "total": 0}
        raise AssertionError(f"endpoint inesperado {path}")


class Sincronizacion(unittest.TestCase):
    def setUp(self):
        from unittest import mock
        patcher = mock.patch("importers.time.sleep", lambda s: None)  # sin las pausas de Binance en la prueba
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_sincronizacion_completa(self):
        import os, tempfile, time as _t
        from db import DB
        from importers import ImportJob
        db = DB(os.path.join(tempfile.mkdtemp(), "t.db"))
        uid = db.run("INSERT INTO users (username, pw, salt, iter, created) VALUES ('a','x','x',1,0)")[0]
        db.save_binance(uid, "huella", "abcd…wxyz", 0)  # su Binance conectado (en el panel)
        job = ImportJob(db, FakeRates())
        job.jobs[uid] = {"state": "running", "added": 0, "found": 0, "skipped": 0, "errors": [], "notes": []}
        saved = {}
        job._run(uid, FakeBinance(_t.time()), True, {}, lambda u, ok, c, e: saved.update(ok=ok, cursor=c, error=e))
        self.assertTrue(saved["ok"], saved)
        kinds = sorted((m["kind"], m["platform"]) for m in db.movements(uid))
        self.assertIn(("compra", "Binance P2P"), kinds)
        self.assertIn(("permuta", "Binance Convert"), kinds)
        self.assertIn(("permuta", "Binance Spot"), kinds)
        self.assertIn(("comision", "Binance Spot"), kinds)      # comisión en BNB aparte
        self.assertIn(("ingreso", "Binance Earn"), kinds)
        self.assertIn(("permuta", "Binance (polvo a BNB)"), kinds)
        earn = [m for m in db.movements(uid) if m["platform"] == "Binance Earn"]
        self.assertEqual(len(earn), 1)
        self.assertAlmostEqual(earn[0]["in_qty"], 0.75)          # sumado por día
        self.assertEqual(saved["cursor"]["balances"], {"BTC": 0.001, "USDT": 30.0})  # LDUSDT no se cuenta dos veces
        self.assertEqual(saved["cursor"]["wallets"], {"spot": {"BTC": 0.001}, "funding": {"USDT": 10.0}, "earn": {"USDT": 20.0}})
        self.assertEqual(saved["cursor"]["spot"], {"BTCUSDT": 1})
        # la segunda vez no duplica nada
        job.jobs[uid] = {"state": "running", "added": 0, "found": 0, "skipped": 0, "errors": [], "notes": []}
        job._run(uid, FakeBinance(_t.time()), True, saved["cursor"], lambda u, ok, c, e: None)
        self.assertEqual(job.jobs[uid]["added"], 0)


HISTORIAL_PDF = """www.binance.com Page 1/1
Historial de órdenes C2C
Id. de usuario: 123 Periodo(UTC--5): 2026-04-14 to 2026-10-14
Número de orden Activo Precio total Precio Cantidad del Creado del tomad Contraparte Estado
22941560102382657536 Buy USDT COP 108773 3217.73 33.8 3219.34 0.07 VENDEDOR Completed 2026-10-08 12:10:25
22941953194110771200 Sell ETH COP 118499.45 7860993.83 0.01507436 3193.32 0 COMPRADOR Completed 2026-10-09 14:12:26
22941968647793750016 Sell USDT COP 120599.7 3210 37.57 0.07 OTRO System cancelled 2026-10-09 15:13:50
"22942405566905016320 Buy USDT COP 500000 3179.99 157.23 0.07 ALGUIEN Completed 2026-10-10 20:10:00"
"""


class HistorialP2PEnPdf(unittest.TestCase):
    def test_lee_completadas_con_comision_y_hora_de_colombia(self):
        moves, errors, _ = importers.read_csv(HISTORIAL_PDF)
        self.assertEqual(errors, [])
        ms = [m for _, m in moves]
        self.assertEqual([m["kind"] for m in ms], ["compra", "venta", "compra"])  # la cancelada no entra
        self.assertAlmostEqual(ms[0]["in_qty"], 33.73)          # 33,8 − 0,07 de comisión
        self.assertEqual(ms[0]["out_qty"], 108773)
        self.assertEqual(ms[1]["fee_qty"], 0)                    # 3193,32 era el tipo de cambio, no comisión
        self.assertEqual(ms[2]["ext_id"], "p2p:22942405566905016320")  # misma referencia que la API: no se duplica
        self.assertEqual(datetime.fromtimestamp(ms[0]["t"], importers.CO_TZ).strftime("%Y-%m-%d %H:%M"), "2026-10-08 12:10")

if __name__ == "__main__":
    unittest.main()
