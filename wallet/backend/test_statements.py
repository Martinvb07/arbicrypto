"""Pruebas de extractos bancarios:  python -m unittest test_statements -v"""
import io
import os
import tempfile
import time
import unittest
from datetime import date

import statements as st

CSV_BANCO = """Fecha;Descripción;Débitos;Créditos;Saldo
08/10/2026;TRANSFERENCIA BRE-B A JUAN;550.000,00;;1.450.000,00
08/10/2026;GMF 4X1000;2.200,00;;1.447.800,00
08/10/2026;TRANSF RECIBIDA BRE-B;;548.149,63;1.995.949,63
09/10/2026;PAGO NOMINA EMPRESA SAS;;3.000.000,00;4.995.949,63
10/10/2026;CUOTA DE MANEJO;14.900,00;;4.981.049,63
10/10/2026;COMPRA EXITO CALLE 80;85.300,00;;4.895.749,63
"""

CSV_NEQUI = """Fecha,Concepto,Valor,Saldo
2026-10-09,Envío a otro Nequi,-550000,120000
2026-10-11,Recibiste de Bancolombia,300000,420000
"""

TEXTO_PDF = """EXTRACTO CUENTA DE AHORROS
PERIODO 01/10/2026 AL 31/10/2026
SALDO ANTERIOR 2.000.000,00
08/10 PAGO PSE CLARO 89.900,00 1.910.100,00
09/10 ABONO INTERESES 1.234,56 1.911.334,56
12/10 RETIRO CAJERO AUTOMATICO 200.000,00 1.711.334,56
"""


class Lectura(unittest.TestCase):
    def test_numeros(self):
        self.assertEqual(st.money("$ 1.234.567,89"), 1234567.89)
        self.assertEqual(st.money("-1,234,567.89"), -1234567.89)
        self.assertEqual(st.money("(14.900)"), -14900)
        self.assertEqual(st.money("550.000"), 550000)
        self.assertEqual(st.money("548149.63"), 548149.63)
        self.assertIsNone(st.money("Saldo"))

    def test_fechas(self):
        self.assertEqual(st.parse_day("08/10/2026"), date(2026, 10, 8))
        self.assertEqual(st.parse_day("2026-10-09"), date(2026, 10, 9))
        self.assertEqual(st.parse_day("08 oct 2026"), date(2026, 10, 8))
        self.assertEqual(st.parse_day("08/10", 2026), date(2026, 10, 8))
        self.assertIsNone(st.parse_day("SALDO"))

    def test_csv_debitos_creditos(self):
        rows, warnings = st.read_file("banco.csv", CSV_BANCO.encode("utf-8"))
        self.assertEqual(warnings, [])
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0]["amount"], -550000)
        self.assertEqual(rows[2]["amount"], 548149.63)
        self.assertEqual(rows[-1]["balance"], 4895749.63)

    def test_csv_valor_con_signo(self):
        rows, _ = st.read_file("nequi.csv", CSV_NEQUI.encode("utf-8"))
        self.assertEqual([r["amount"] for r in rows], [-550000, 300000])

    def test_excel(self):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Banco Ejemplo"])
        ws.append(["Fecha", "Descripción", "Valor", "Saldo"])
        ws.append(["08/10/2026", "TRANSFERENCIA ENVIADA", -550000, 100000])
        ws.append(["09/10/2026", "CONSIGNACION", 200000, 300000])
        buf = io.BytesIO()
        wb.save(buf)
        rows, _ = st.read_file("extracto.xlsx", buf.getvalue())
        self.assertEqual([r["amount"] for r in rows], [-550000, 200000])

    def test_texto_de_pdf_usa_el_saldo_para_el_signo(self):
        rows, _ = st._from_text(TEXTO_PDF, 2026)
        self.assertEqual([round(r["amount"], 2) for r in rows], [-89900, 1234.56, -200000])

    def test_formato_no_soportado(self):
        with self.assertRaises(st.StatementError):
            st.read_file("foto.jpg", b"x")


class Clasificacion(unittest.TestCase):
    def test_palabras_clave(self):
        self.assertEqual(st.classify("GMF 4X1000"), "gmf")
        self.assertEqual(st.classify("CUOTA DE MANEJO"), "bancarios")
        self.assertEqual(st.classify("PAGO NOMINA EMPRESA"), "salario")
        self.assertEqual(st.classify("COMPRA EXITO"), "consumo")
        self.assertEqual(st.classify("RETIRO CAJERO"), "efectivo")
        self.assertIsNone(st.classify("TRANSFERENCIA A JUAN"))
        self.assertEqual(st.classify("TRANSFERENCIA A JUAN", [("transferencia a juan", "negocio")]), "negocio")

    def test_cruce_con_binance_p2p(self):
        t0 = time.time()
        txs = [{"id": 1, "t": t0, "amount": -550000, "pay_methods": []}, {"id": 2, "t": t0, "amount": 548149.63, "pay_methods": []},
               {"id": 3, "t": t0, "amount": -550000, "pay_methods": []}]
        p2p = [{"id": 10, "t": t0 + 3600, "kind": "compra", "cop_value": 550000, "pay_method": ""},
               {"id": 11, "t": t0 - 3600, "kind": "venta", "cop_value": 548149.63, "pay_method": ""}]
        m = st.match_p2p(txs, p2p)
        self.assertEqual(m, {1: 10, 2: 11})  # la segunda salida de 550.000 no tiene orden: no se cruza dos veces

    def test_traslados_entre_mis_cuentas(self):
        t0 = time.time()
        txs = [{"id": 1, "account_id": 1, "t": t0, "amount": -300000}, {"id": 2, "account_id": 2, "t": t0 + 86400, "amount": 300000},
               {"id": 3, "account_id": 1, "t": t0, "amount": -50000}]
        self.assertEqual(st.match_transfers(txs), [(1, 2)])


class Servicio(unittest.TestCase):
    def test_subir_clasificar_y_resumir(self):
        from banks import Banks
        from db import DB
        import banks as banks_mod
        tmp = tempfile.mkdtemp()
        banks_mod.DATA_DIR = os.path.join(tmp, "extractos")
        db = DB(os.path.join(tmp, "t.db"))
        uid = db.run("INSERT INTO users (username, pw, salt, iter, created) VALUES ('a','x','x',1,0)")[0]
        db.save_binance(uid, "huella", "abcd…wxyz", 0)  # su Binance conectado (en el panel)
        t = st.day_ts(date(2026, 10, 8))
        db.add_movements(uid, [
            dict(t=t - 3600, kind="compra", out_asset="COP", out_qty=550000, in_asset="USDT", in_qty=170.84, cop_value=550000,
                 fee_cop=0, gmf_cop=2200, platform="Binance P2P", counterpart="", ext_id="p2p:1", source="binance", note="", pay_method="BreBKeys"),
            dict(t=t + 3600, kind="venta", out_asset="BTC", out_qty=0.002, in_asset="COP", in_qty=548149.63, cop_value=548149.63,
                 fee_cop=0, gmf_cop=0, platform="Binance P2P", counterpart="", ext_id="p2p:2", source="binance", note="", pay_method="BreBKeys")], 0)
        b = Banks(db)
        aid = b.save_account(uid, None, "Bancolombia ahorros", "ahorros", ["BreBKeys"])
        nequi = b.save_account(uid, None, "Nequi", "billetera", ["Nequi"])
        rows, _ = st.read_file("banco.csv", CSV_BANCO.encode())
        fid, added, dup = b.save_file(uid, aid, "banco.csv", CSV_BANCO.encode(), rows)
        self.assertEqual((added, dup), (6, 0))
        _, added2, dup2 = b.save_file(uid, aid, "banco-otra-vez.csv", CSV_BANCO.encode(), rows)
        self.assertEqual((added2, dup2), (0, 6))  # el mismo extracto no se duplica
        s = b.summary(uid, 2026)
        cats = {t["description"]: t["category"] for t in s["transactions"]}
        self.assertEqual(cats["TRANSFERENCIA BRE-B A JUAN"], "binance_p2p")
        self.assertEqual(cats["TRANSF RECIBIDA BRE-B"], "binance_p2p")
        self.assertEqual(cats["GMF 4X1000"], "gmf")
        self.assertEqual(cats["PAGO NOMINA EMPRESA SAS"], "salario")
        self.assertEqual(s["dian"]["gmf_real"], 2200)
        self.assertEqual(s["dian"]["salary"], 3000000)
        self.assertEqual(s["dian"]["bank_balances_end"], 4895749.63)
        self.assertEqual(s["p2p_unmatched"], [])
        acc = next(a for a in s["accounts"] if a["id"] == aid)
        self.assertEqual(acc["last_balance"], 4895749.63)
        # corregir una categoría y aplicarla a parecidos
        tx = next(t for t in s["transactions"] if t["description"] == "COMPRA EXITO CALLE 80")
        b.set_category(uid, tx["id"], "negocio", similar=True)
        s = b.summary(uid, 2026)
        self.assertEqual(next(t["category"] for t in s["transactions"] if t["id"] == tx["id"]), "negocio")
        # traslado entre Bancolombia y Nequi
        rows_n, _ = st.read_file("nequi.csv", "Fecha,Concepto,Valor,Saldo\n2026-10-10,Recibiste de Bancolombia,85300,85300\n".encode())
        b.save_file(uid, nequi, "nequi.csv", b"x", rows_n)
        # borrar el archivo borra sus movimientos
        b.delete_file(uid, fid)
        self.assertEqual(db.one("SELECT COUNT(*) AS n FROM bank_tx WHERE account_id=?", (aid,))["n"], 0)


class SignosNequi(unittest.TestCase):
    def test_menos_despues_del_peso(self):
        for v, out in [("$-50.000,00", -50000), ("$ -50.000,00", -50000), ("-$50.000,00", -50000), ("\u2212$50.000", -50000),
                       ("1.234-", -1234), ("(1.234)", -1234), ("$ 250.000,00", 250000)]:
            self.assertEqual(st.money(v), out, v)

    def test_el_saldo_corrige_el_signo(self):
        mk = lambda d, a, b: {"day": d, "description": d, "amount": a, "balance": b}
        rows = [mk("1", 100000.0, 600000.0), mk("2", 50000.0, 550000.0), mk("3", 20000.0, 530000.0), mk("4", 30000.0, 560000.0)]
        self.assertEqual([r["amount"] for r in st.fix_signs(rows)], [100000, -50000, -20000, 30000])
        rows = [mk("4", 30000.0, 560000.0), mk("3", 20000.0, 530000.0), mk("2", 50000.0, 550000.0), mk("1", 100000.0, 600000.0)]
        self.assertEqual([r["amount"] for r in st.fix_signs(rows)], [30000, -20000, -50000, 100000])

NU_TEXTO = """Llegó tu extracto de Marzo
Período 01 - 31 MAR 2026
Tu dinero al inicio del mes $148.526,76
Lo que entró a tu cuenta +$56.400,00
Tu dinero a final del mes $476,03
Movimientos
02 mar Enviaste a ALGUIEN -$100.000,00
Impuesto del 4x1000 -$400,00
23 mar Recibiste de Fulano +$50.000,00
28 mar Compra en TIENDA con tarjeta débito -$5.737,00
Impuesto del 4x1000 -$22,95
Rendimiento total de tu cuenta +$0,82
"""


class ExtractoNu(unittest.TestCase):
    def test_4x1000_sin_fecha_y_saldo_final(self):
        rows, _ = st._from_text(NU_TEXTO, 2026)
        self.assertEqual([r["amount"] for r in rows], [-100000, -400, 50000, -5737, -22.95])
        self.assertEqual(str(rows[1]["day"]), "2026-03-02")   # el 4x1000 va con el envío de arriba
        self.assertEqual(rows[-1]["balance"], 476.03)          # 'Tu dinero a final del mes'
        self.assertEqual(st.classify(rows[1]["description"]), "gmf")

if __name__ == "__main__":
    unittest.main()
