"""Motor contable de criptoactivos para la declaración de renta en Colombia (personas naturales residentes).

Base normativa (resumen; confirmar siempre con un contador):
- DIAN, Concepto Unificado 1621 de 2023: las cripto son activos intangibles; cambiar una por otra es una
  permuta y por lo tanto una enajenación (art. 90 ET); el patrimonio se declara por su costo fiscal (art. 267 ET).
- Si se enajenan dentro del giro ordinario (operación habitual: trading o arbitraje) son activos movibles y la
  utilidad es renta ordinaria. Si se poseen como activo fijo 2 años o más, la utilidad es ganancia ocasional (art. 300 ET).
- Ganancia ocasional: tarifa del 15 % (art. 314 ET, Ley 2277 de 2022). Airdrops: ganancia ocasional.
  Minería, staking y pagos recibidos en cripto: renta ordinaria por su valor al recibirlos.
- Renta ordinaria: tabla del art. 241 ET sobre la renta líquida gravable de la cédula general.
- 50 % del GMF (4x1000) efectivamente pagado es deducible (art. 115 ET), con certificado del banco.
"""
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

COP = "COP"
CO_TZ = timezone(timedelta(hours=-5))  # Colombia no tiene horario de verano
UVT = {2023: 42412, 2024: 47065, 2025: 49799, 2026: 52374}
GO_RATE = 0.15
GMF_DEDUCTIBLE = 0.5
TOPE_PATRIMONIO, TOPE_INGRESOS, TOPE_EXTERIOR = 4500, 1400, 2000  # en UVT
ART_241 = [  # (desde UVT, hasta UVT, tarifa marginal, impuesto fijo en UVT)
    (0, 1090, 0.00, 0), (1090, 1700, 0.19, 0), (1700, 4100, 0.28, 116), (4100, 8670, 0.33, 788),
    (8670, 18970, 0.35, 2296), (18970, 31000, 0.37, 5901), (31000, float("inf"), 0.39, 10352),
]
GMF_RATE = 0.004            # 4x1000: $4.000 por cada $1.000.000
GMF_EXEMPT_UVT = 350        # cuenta marcada como exenta: no paga hasta 350 UVT de retiros al mes (art. 879 ET)
GMF_MODES = ("todas", "exenta", "tope350", "elegir")
OUTFLOW = {"venta", "permuta", "comision"}
INFLOW = {"compra", "permuta", "ingreso", "airdrop"}

# Calendario renta personas naturales año gravable 2025 (se presenta en 2026), por los 2 últimos dígitos del NIT
DEADLINES = {2025: {
    1: "2026-08-12", 3: "2026-08-13", 5: "2026-08-14", 7: "2026-08-18", 9: "2026-08-19", 11: "2026-08-20",
    13: "2026-08-21", 15: "2026-08-24", 17: "2026-08-25", 19: "2026-08-26", 21: "2026-08-27", 23: "2026-08-28",
    25: "2026-08-31", 27: "2026-09-01", 29: "2026-09-02", 31: "2026-09-03", 33: "2026-09-04", 35: "2026-09-07",
    37: "2026-09-08", 39: "2026-09-09", 41: "2026-09-10", 43: "2026-09-11", 45: "2026-09-14", 47: "2026-09-15",
    49: "2026-09-16", 51: "2026-09-17", 53: "2026-09-18", 55: "2026-09-21", 57: "2026-09-22", 59: "2026-09-23",
    61: "2026-09-24", 63: "2026-09-25", 65: "2026-09-28", 67: "2026-10-01", 69: "2026-10-02", 71: "2026-10-05",
    73: "2026-10-06", 75: "2026-10-07", 77: "2026-10-08", 79: "2026-10-09", 81: "2026-10-13", 83: "2026-10-14",
    85: "2026-10-15", 87: "2026-10-16", 89: "2026-10-19", 91: "2026-10-20", 93: "2026-10-21", 95: "2026-10-22",
    97: "2026-10-23", 99: "2026-10-26",
}}


def apply_gmf(movements, mode, methods=None):
    """4x1000 que de verdad se pagó, según la cuenta desde la que compras.
    todas: el registrado en cada compra · exenta: nada · tope350: solo lo que pase de 350 UVT en el mes ·
    elegir: compra por compra (gmf_choice 0 = no pagó; si no se marcó, el registrado). Las ventas nunca pagan 4x1000.
    `methods` permite elegir por medio de pago (Nequi, Bancolombia…); si no está, manda `mode`."""
    methods = methods or {}
    if mode == "elegir":
        out = []
        for m in movements:
            if m["kind"] == "compra" and m.get("gmf_choice") is not None:
                base = float(m.get("cop_value") or 0) + float(m.get("fee_cop") or 0)  # lo que salió de la cuenta
                m = {**m, "gmf_cop": round(base * GMF_RATE, 2) if m["gmf_choice"] else 0.0}
            out.append(m)
        return out
    if mode not in ("exenta", "tope350") and not any(v in ("exenta", "tope350") for v in methods.values()):
        return movements
    out, used = [], {}
    for m in sorted(movements, key=lambda x: (x["t"], x.get("id") or 0)):
        paid = float(m.get("gmf_cop") or 0)
        pm = m.get("pay_method") or ""
        mm = methods.get(pm) or mode
        if paid > 0 and mm == "exenta":
            m = {**m, "gmf_cop": 0.0}
        elif paid > 0 and mm == "tope350" and m["kind"] == "compra":
            d = datetime.fromtimestamp(m["t"], CO_TZ)
            key = (pm if pm in methods else "", d.year, d.month)
            limit = GMF_EXEMPT_UVT * (UVT.get(d.year) or UVT[max(UVT)])
            before = used.get(key, 0.0)
            base = float(m.get("cop_value") or 0) + float(m.get("fee_cop") or 0)  # lo que salió de la cuenta
            used[key] = before + base
            taxed = max(0.0, before + base - max(limit, before))
            m = {**m, "gmf_cop": round(taxed * GMF_RATE, 2)}
        out.append(m)
    return out


def sale_sources(parts):
    """De qué compras salió una venta: por cada compra, cuánto se usó, cuánto quedaba de ella y su 4x1000 proporcional."""
    out = {}
    for q, cost, _t, src, rest in parts:
        if not src:
            continue
        x = out.setdefault(src["id"] if src["id"] is not None else id(src),
                           {"id": src["id"], "t": src["t"], "kind": src["kind"], "bought_qty": src["qty"], "bought_cost": src["cost"],
                            "qty": 0.0, "cost": 0.0, "gmf": 0.0, "left": rest})
        x["qty"] += q
        x["cost"] += cost
        x["gmf"] += src["gmf"] * q / src["qty"] if src["qty"] else 0.0
        x["left"] = rest
    return list(out.values())


def year_bounds(year):
    start = datetime(year, 1, 1, tzinfo=CO_TZ).timestamp()
    end = datetime(year + 1, 1, 1, tzinfo=CO_TZ).timestamp()
    return start, end


def held_two_years(acquired_t, disposed_t):
    """Dos años contados de fecha a fecha (hora de Colombia)."""
    a = datetime.fromtimestamp(acquired_t, CO_TZ)
    d = datetime.fromtimestamp(disposed_t, CO_TZ)
    try:
        limit = a.replace(year=a.year + 2)
    except ValueError:  # 29 de febrero
        limit = a.replace(year=a.year + 2, day=28)
    return d >= limit


def art241_uvt(base_uvt):
    if base_uvt <= 0:
        return 0.0
    for lo, hi, rate, fixed in ART_241:
        if base_uvt <= hi:
            return (base_uvt - lo) * rate + fixed if rate else 0.0
    return 0.0


def deadline(year, nit):
    """Fecha límite según los 2 últimos dígitos del NIT (sin dígito de verificación)."""
    digits = "".join(ch for ch in str(nit or "").split("-")[0] if ch.isdigit())
    table = DEADLINES.get(year)
    if not table or len(digits) < 2:
        return None
    last = int(digits[-2:]) or 100
    key = last if last % 2 == 1 else last - 1
    return table.get(99 if key >= 99 else key)


class Ledger:
    """Lotes por cripto. FIFO para fechas de tenencia; el costo puede ser FIFO o promedio ponderado."""

    def __init__(self, method):
        self.method = method
        self.lots = defaultdict(deque)  # cripto -> deque de [cantidad, costo COP, fecha, compra de origen]

    def add(self, asset, qty, cost, t, src=None):
        """src: de dónde salió el lote (la compra: id, fecha, cantidad, costo y su 4x1000), para decir en cada venta de
        qué compra salió y qué parte de su 4x1000 le toca."""
        if qty <= 0:
            return
        lots = self.lots[asset]
        lots.append([qty, cost, t, src])
        if self.method == "promedio":
            total_q = sum(l[0] for l in lots)
            avg = sum(l[1] for l in lots) / total_q
            for l in lots:
                l[1] = l[0] * avg

    def take(self, asset, qty, prefer=None):
        """Saca `qty` y devuelve [(cantidad, costo, fecha, compra de origen, lo que queda de ese lote)] más la cantidad
        sin historial de compra. `prefer`: id de la compra de la que dijiste que salió la venta; se saca primero de ella
        y, si no alcanza, sigue en orden (FIFO)."""
        lots, parts, left = self.lots[asset], [], qty
        first = next((l for l in lots if prefer is not None and l[3] and l[3].get("id") == prefer), None)
        for lot in ([first] if first else []) + list(lots):  # el elegido primero; el orden de los demás no cambia
            if left <= 1e-12:
                break
            if lot[0] <= 1e-12:
                continue
            q = min(left, lot[0])
            cost = lot[1] * q / lot[0]
            lot[0] -= q
            lot[1] -= cost
            left -= q
            parts.append((q, cost, lot[2], lot[3], max(lot[0], 0.0)))
        while lots and lots[0][0] <= 1e-12:
            lots.popleft()
        if first and first[0] <= 1e-12:
            for i, l in enumerate(lots):
                if l is first:
                    del lots[i]
                    break
        return parts, max(0.0, left)

    def holdings(self):
        out = {}
        for asset, lots in self.lots.items():
            q = sum(l[0] for l in lots)
            if q > 1e-10:
                out[asset] = {"qty": q, "cost": sum(l[1] for l in lots), "since": min(l[2] for l in lots)}
        return out


def compute(movements, year, habitual=False, method="fifo"):
    """Procesa todos los movimientos hasta el 31 de diciembre de `year`.

    Cada movimiento: dict con t, kind, out_asset, out_qty, in_asset, in_qty, cop_value, fee_cop, gmf_cop, id.
      compra:   sale COP (out_qty = pesos pagados), entra cripto. cop_value = pesos pagados.
      venta:    sale cripto, entra COP. cop_value = pesos recibidos.
      permuta:  sale cripto A, entra cripto B. cop_value = valor comercial en pesos de lo intercambiado.
      ingreso:  entra cripto (staking, minería, pagos). cop_value = valor al recibirla. Renta ordinaria.
      airdrop:  entra cripto gratis. cop_value = valor al recibirla. Ganancia ocasional.
      comision: sale cripto sin contraprestación (comisión pagada en cripto). Su costo es un gasto.
    """
    start, end = year_bounds(year)
    ledger = Ledger(method)
    disposals, incomes, warnings = [], [], []
    opening = None
    totals = {"gmf": 0.0, "fees": 0.0, "bought_cop": 0.0, "sold_cop": 0.0, "expenses": 0.0, "deductible_expenses": 0.0}

    for m in sorted(movements, key=lambda x: (x["t"], x.get("id") or 0)):
        if m["t"] >= end:
            break
        if opening is None and m["t"] >= start:
            opening = ledger.holdings()
        in_year = m["t"] >= start
        kind = m["kind"]
        if kind in ("gasto", "aporte", "retiro"):  # solo pesos: no tocan las cripto
            if in_year and kind == "gasto":
                v = float(m.get("cop_value") or 0)
                totals["expenses"] += v
                if habitual:  # gastos del negocio: costos y deducciones procedentes (casilla 77)
                    totals["deductible_expenses"] += v
            if in_year:
                totals["gmf"] += float(m.get("gmf_cop") or 0)
            continue
        fee = float(m.get("fee_cop") or 0) if kind in ("compra", "venta", "permuta") else 0.0
        value = float(m.get("cop_value") or 0)

        if kind in OUTFLOW and m.get("out_asset") and m["out_asset"] != COP:
            asset, qty = m["out_asset"], float(m["out_qty"])
            parts, missing = ledger.take(asset, qty, m.get("lot_from"))
            gross = value if kind in ("venta", "permuta") else 0.0
            proceeds = gross - fee
            if missing > 1e-9 and in_year:  # cada año avisa solo de sus propias ventas
                warnings.append({"t": m["t"], "asset": asset, "qty": missing, "id": m.get("id"),
                                 "msg": f"Se vendieron {missing:.8g} {asset} sin compra registrada: su costo quedó en $0."})
            if in_year:
                cost = sum(p[1] for p in parts)
                go_share = 0.0 if habitual or qty <= 0 else sum(p[0] for p in parts if held_two_years(p[2], m["t"])) / qty
                days = [(m["t"] - p[2]) / 86400 for p in parts]
                gain = proceeds - cost
                sources = sale_sources(parts)
                gmf_share = sum(x["gmf"] for x in sources)
                disposals.append({
                    "id": m.get("id"), "t": m["t"], "kind": kind, "asset": asset, "qty": qty,
                    "received": m.get("in_asset"), "gross": gross, "fee": fee, "proceeds": proceeds, "cost": cost, "gain": gain,
                    "go_share": go_share,
                    "go_gain": gain * go_share, "ro_gain": gain * (1 - go_share),
                    "days_min": min(days) if days else 0, "days_max": max(days) if days else 0, "missing": missing,
                    # el 4x1000 que pagaste al comprar lo que vendiste, y la ganancia ya sin él
                    "gmf": gmf_share, "net": gain - gmf_share, "sources": sources,
                })
                if kind == "venta":
                    totals["sold_cop"] += value
                totals["fees"] += fee

        if kind in INFLOW and m.get("in_asset") and m["in_asset"] != COP:
            asset, qty = m["in_asset"], float(m["in_qty"])
            cost = value + fee if kind == "compra" else value  # en permuta la comision ya resto en la venta
            ledger.add(asset, qty, cost, m["t"], {"id": m.get("id"), "t": m["t"], "kind": kind, "qty": qty, "cost": cost,
                                                  "gmf": float(m.get("gmf_cop") or 0) if kind == "compra" else 0.0})
            if in_year:
                if kind == "compra":
                    totals["bought_cop"] += value + fee
                    totals["fees"] += fee
                    totals["buy_fees"] = totals.get("buy_fees", 0.0) + fee
                if kind in ("ingreso", "airdrop"):
                    incomes.append({"id": m.get("id"), "t": m["t"], "kind": kind, "asset": asset, "qty": qty, "value": value})
        if in_year:
            totals["gmf"] += float(m.get("gmf_cop") or 0)

    if opening is None:
        opening = ledger.holdings()
    return {"disposals": disposals, "incomes": incomes, "holdings": ledger.holdings(),
            "opening": opening, "totals": totals, "warnings": warnings}


def ref_label(ext_id):
    """Referencia legible de la operación: número de orden de Binance, etc."""
    e = str(ext_id or "")
    if e.startswith("p2p:"):
        return f"P2P {e[4:]}"
    if e.startswith("convert:"):
        return f"Convert {e[8:]}"
    if e.startswith("spot:") or e.startswith("spotfee:"):
        parts = e.split(":")
        return f"Spot {parts[1]} #{parts[2]}" if len(parts) >= 3 else e
    if e.startswith("earn:"):
        return "Earn " + e.split(":")[-1]
    if e.startswith("dust:"):
        return "Polvo " + e.split(":")[1]
    return ""


PAY_NAMES = {"BreBKeys": "Bre-B", "BancoPopular": "Banco Popular", "BancolombiaSA": "Bancolombia", "DaviviendaSA": "Davivienda",
             "BankTransfer": "Transferencia bancaria"}


def pay_label(m):
    import re as _re
    return PAY_NAMES.get(m, _re.sub("([a-z])([A-Z])", lambda g: g.group(1) + " " + g.group(2), m or ""))


def _kardex_text(m, side):
    k = m["kind"]
    via = pay_label(m.get("pay_method") or "")
    plat = (m.get("platform") or "").replace("Binance P2P", "P2P")
    if k == "compra":
        return f"Compra {plat}".strip() + (f" · {via}" if via else "")
    if k == "venta":
        return f"Venta {plat}".strip() + (f" · {via}" if via else "")
    if k == "permuta":
        return f"Cambio por {m['in_asset']}" if side == "out" else f"Cambio desde {m['out_asset']}"
    if k == "ingreso":
        return f"Rendimiento {m.get('platform') or ''}".strip()
    if k == "airdrop":
        return "Airdrop"
    return "Comisión" + (f" · {m['note']}" if m.get("note") else "")


def kardex(movements, year, method="fifo"):
    """Libro de criptoactivos (kardex): por cada cripto, entradas y salidas con su costo y el saldo corrido.
    Las salidas llevan el valor de venta (valor comercial) y la utilidad, como en el cálculo de la DIAN."""
    start, end = year_bounds(year)
    led = Ledger(method)
    books, opened = {}, False

    def snap(a):
        lots = led.lots.get(a) or []
        return sum(l[0] for l in lots), sum(l[1] for l in lots)

    def book(a):
        return books.setdefault(a, {"asset": a, "opening": None, "rows": []})

    for m in sorted(movements, key=lambda x: (x["t"], x.get("id") or 0)):
        if m["t"] >= end:
            break
        k = m["kind"]
        if k in ("gasto", "aporte", "retiro"):
            continue
        if not opened and m["t"] >= start:
            for a in list(led.lots):
                book(a)["opening"] = snap(a)
            opened = True
        in_year = m["t"] >= start
        v = float(m.get("cop_value") or 0)
        fee = float(m.get("fee_cop") or 0) if k in ("compra", "venta", "permuta") else 0.0
        base = {"t": m["t"], "kind": k, "id": m.get("id"), "ref": ref_label(m.get("ext_id"))}
        fee_q = {"fee_qty": float(m.get("fee_qty") or 0), "fee_asset": m.get("fee_asset") or ""}
        if k in OUTFLOW and m.get("out_asset") and m["out_asset"] != COP:
            a, q = m["out_asset"], float(m["out_qty"])
            parts, missing = led.take(a, q, m.get("lot_from"))
            cost = sum(p[1] for p in parts)
            gross = v if k in ("venta", "permuta") else 0.0
            if in_year:
                bq, bc = snap(a)
                book(a)["rows"].append({**base, **(fee_q if k != "permuta" or fee_q["fee_asset"] == a else {}),
                                        "text": _kardex_text(m, "out"), "out_qty": q, "out_cost": cost,
                                        "out_unit": cost / q if q else 0.0, "sale": gross, "fee": fee, "gmf": 0.0,
                                        "gain": gross - fee - cost, "bal_qty": bq, "bal_cost": bc, "missing": missing})
        if k in INFLOW and m.get("in_asset") and m["in_asset"] != COP:
            a, q = m["in_asset"], float(m["in_qty"])
            cost = v + fee if k == "compra" else v
            led.add(a, q, cost, m["t"], {"id": m.get("id")})
            if in_year:
                bq, bc = snap(a)
                # en la compra la comisión de Binance va dentro del costo; el 4x1000 es un gasto aparte
                row = {**base, "text": _kardex_text(m, "in"), "in_qty": q, "in_cost": cost,
                       "in_unit": cost / q if q else 0.0, "bal_qty": bq, "bal_cost": bc,
                       "fee": fee if k == "compra" else 0.0, "gmf": float(m.get("gmf_cop") or 0) if k == "compra" else 0.0}
                if k == "compra" or fee_q["fee_asset"] == a:
                    row.update(fee_q)
                book(a)["rows"].append(row)
    if not opened:
        for a in list(led.lots):
            book(a)["opening"] = snap(a)
    out = []
    for a, b in books.items():
        oq, oc = b["opening"] or (0.0, 0.0)
        cq, cc = snap(a)
        r = b["rows"]
        if not r and oq <= 1e-10 and cq <= 1e-10:
            continue
        out.append({
            "asset": a, "rows": r,
            "opening": {"qty": oq, "cost": oc}, "closing": {"qty": cq, "cost": cc},
            "totals": {"in_qty": sum(x.get("in_qty", 0) for x in r), "in_cost": sum(x.get("in_cost", 0) for x in r),
                       "out_qty": sum(x.get("out_qty", 0) for x in r), "out_cost": sum(x.get("out_cost", 0) for x in r),
                       "sales": sum(x.get("sale", 0) for x in r), "gain": sum(x.get("gain", 0) for x in r if "out_qty" in x),
                       "fees": sum(x.get("fee", 0) for x in r), "gmf": sum(x.get("gmf", 0) for x in r),
                       "fee_qty": sum(x.get("fee_qty", 0) for x in r if x.get("fee_asset") == a)},
        })
    out.sort(key=lambda b: -(b["totals"]["in_cost"] + b["totals"]["out_cost"] + b["closing"]["cost"]))
    return out


def unmatched_gain(d):
    """La parte de la ganancia de una venta que sale de cripto sin compra registrada (costo $0): es lo que recibiste
    por esa parte. En la declaración se deja así (lo conservador); en tus resultados no se cuenta hasta que la agregues."""
    return d["proceeds"] * d["missing"] / d["qty"] if d.get("missing") and d["qty"] else 0.0


def books(result, movements, year):
    """Contabilidad del año: estado de resultados, mes por mes y por moneda (cifras contables, en pesos)."""
    start, end = year_bounds(year)
    months = [{"month": i + 1, "bought": 0.0, "sold": 0.0, "ops": 0, "gain": 0.0, "income": 0.0, "gmf": 0.0, "fees": 0.0,
               "expenses": 0.0, "unmatched": 0.0} for i in range(12)]
    assets = {}

    def month(t):
        return months[datetime.fromtimestamp(t, CO_TZ).month - 1]

    def asset(a):
        return assets.setdefault(a, {"asset": a, "bought_qty": 0.0, "bought": 0.0, "sold_qty": 0.0, "sold": 0.0,
                                     "gain": 0.0, "income": 0.0, "hold_qty": 0.0, "hold_cost": 0.0})

    for m in movements:
        if not start <= m["t"] < end:
            continue
        mo = month(m["t"])
        mo["ops"] += 1
        mo["gmf"] += float(m.get("gmf_cop") or 0)
        value = float(m.get("cop_value") or 0)
        if m["kind"] == "compra":
            mo["bought"] += value + float(m.get("fee_cop") or 0)
            mo["fees"] += float(m.get("fee_cop") or 0)
        elif m["kind"] == "venta":
            mo["sold"] += value
        elif m["kind"] == "gasto":
            mo["expenses"] += value
        if m["kind"] in ("compra", "permuta") and m.get("in_asset") and m["in_asset"] != COP:
            x = asset(m["in_asset"])
            x["bought_qty"] += float(m.get("in_qty") or 0)
            x["bought"] += value + (float(m.get("fee_cop") or 0) if m["kind"] == "compra" else 0.0)
    for d in result["disposals"]:
        mo = month(d["t"])
        mo["gain"] += d["gain"]
        mo["fees"] += d["fee"]
        mo["unmatched"] += unmatched_gain(d)
        x = asset(d["asset"])
        x["sold_qty"] += d["qty"]
        x["sold"] += d["gross"]
        x["gain"] += d["gain"]
    for i in result["incomes"]:
        month(i["t"])["income"] += i["value"]
        asset(i["asset"])["income"] += i["value"]
    for a, h in result["holdings"].items():
        x = asset(a)
        x["hold_qty"], x["hold_cost"] = h["qty"], h["cost"]

    d = result["disposals"]
    sales = sum(x["gross"] for x in d)
    cost = sum(x["cost"] for x in d)
    fees = sum(x["fee"] for x in d)
    buy_fees = result["totals"].get("buy_fees", 0.0)  # comisiones de compra: ya van dentro del costo
    income = sum(x["value"] for x in result["incomes"])
    gmf = sum(mo["gmf"] for mo in months)
    expenses = sum(mo["expenses"] for mo in months)
    unmatched = sum(mo["unmatched"] for mo in months)
    for mo in months:  # tu resultado real: lo vendido sin su compra no cuenta hasta que la agregues
        mo["net"] = mo["gain"] - mo["unmatched"] + mo["income"] - mo["gmf"] - mo["expenses"]
    return {
        "pnl": {"sales": sales, "cost": cost, "fees": fees, "buy_fees": buy_fees, "gross_profit": sales - cost - fees, "income": income,
                "gmf": gmf, "expenses": expenses, "unmatched": unmatched,
                "net": sales - cost - fees - unmatched + income - gmf - expenses},
        "rounds": rounds(movements, year),
        "months": months,
        "assets": sorted(assets.values(), key=lambda x: -(x["bought"] + x["sold"] + x["hold_cost"])),
    }


def rounds(movements, year):
    """Rondas de arbitraje: desde que sale plata a comprar cripto hasta que todo vuelve a pesos.
    El resultado es plata real: lo recibido menos lo pagado, el 4x1000 y las comisiones."""
    start, end = year_bounds(year)
    hold, out, cur = {}, [], None
    for m in sorted(movements, key=lambda x: (x["t"], x.get("id") or 0)):
        if m["t"] >= end:
            break
        k = m["kind"]
        if k in ("gasto", "aporte", "retiro"):
            continue
        if cur is None:
            if k != "compra":  # una ronda empieza cuando sale plata a comprar
                for side, sign in (("out", -1), ("in", 1)):
                    a = m.get(f"{side}_asset")
                    if a and a != COP:
                        hold[a] = hold.get(a, 0.0) + sign * float(m.get(f"{side}_qty") or 0)
                continue
            cur = {"start": m["t"], "end": m["t"], "paid": 0.0, "received": 0.0, "gmf": 0.0, "fees": 0.0, "binance_fees": 0.0, "ops": 0,
                   "assets": [], "base": dict(hold), "peak": {}}
        v = float(m.get("cop_value") or 0)
        fee = float(m.get("fee_cop") or 0)
        cur["ops"] += 1
        cur["end"] = m["t"]
        if k in ("compra", "venta", "permuta"):
            cur["binance_fees"] += fee
        cur["gmf"] += float(m.get("gmf_cop") or 0)
        if k == "compra":
            cur["paid"] += v + fee
        elif k == "venta":
            cur["received"] += v - fee
        elif k == "permuta":
            cur["fees"] += fee
        for side, sign in (("out", -1), ("in", 1)):
            a = m.get(f"{side}_asset")
            if a and a != COP:
                q = float(m.get(f"{side}_qty") or 0)
                hold[a] = hold.get(a, 0.0) + sign * q
                cur["peak"][a] = max(cur["peak"].get(a, 0.0), abs(hold[a]))
                if k in ("ingreso", "airdrop"):  # lo que llega gratis no impide cerrar la ronda
                    cur["base"][a] = cur["base"].get(a, 0.0) + q
                if a not in cur["assets"]:
                    cur["assets"].append(a)
        done = all(hold.get(a, 0.0) <= cur["base"].get(a, 0.0) + max(1e-8, 1e-6 * cur["peak"].get(a, 0.0))
                   for a in cur["peak"])
        if done:
            out.append(cur)
            cur = None
    if cur:
        cur["open"] = True
        out.append(cur)
    res = []
    for r in out:
        if not start <= r["start"] < end:
            continue
        r.pop("base", None)
        r.pop("peak", None)
        r["open"] = r.get("open", False)
        r["result"] = r["received"] - r["paid"] - r["gmf"] - r["fees"]
        r["result_before_gmf"] = r["received"] - r["paid"] - r["fees"]
        res.append(r)
    return res


def summary(result, year, other_income=0.0, other_patrimony=0.0, other_deposits=0.0, gmf_cert=0.0, gmf_deduct=True):
    """Cifras para la declaración: rentas, impuesto estimado, patrimonio, topes y guía del formulario 210."""
    uvt = UVT.get(year) or UVT[max(UVT)]
    uvt_next = UVT.get(year + 1) or uvt
    d, inc, t = result["disposals"], result["incomes"], result["totals"]
    ro_share = [1 - x["go_share"] for x in d]

    ro_gross = sum(x["gross"] * r for x, r in zip(d, ro_share))
    ro_costs = sum((x["cost"] + x["fee"]) * r for x, r in zip(d, ro_share))
    go_gross = sum(x["gross"] * (1 - r) for x, r in zip(d, ro_share))
    go_costs = sum((x["cost"] + x["fee"]) * (1 - r) for x, r in zip(d, ro_share))
    ro_income = sum(x["value"] for x in inc if x["kind"] == "ingreso")
    go_income = sum(x["value"] for x in inc if x["kind"] == "airdrop")
    # 4x1000 = 0,4 % ($4.000 por cada $1.000.000) de cada compra pagada desde el banco.
    # Si hay certificado del banco, manda el certificado.
    gmf_paid = gmf_cert if gmf_cert and gmf_cert > 0 else t["gmf"]

    # Formulario 210 (instructivo DIAN AG 2023 y siguientes), cédula general, rentas no laborales:
    c74 = ro_gross + ro_income            # ingresos brutos (ventas, permutas e ingresos en cripto)
    c77 = ro_costs + t.get("deductible_expenses", 0.0)  # costos y deducciones (costo fiscal + comisiones + gastos)
    c78 = max(0.0, c74 - c77)             # renta líquida
    c88 = max(0.0, c77 - c74)             # pérdida líquida del ejercicio
    # Casilla 84: 50 % del GMF es deducción imputable. Solo aplica si hay renta líquida (78 > 0) y entra al
    # límite del 40 % de los ingresos, máximo 1.340 UVT (casilla 86). Nunca crea ni agranda una pérdida.
    c84 = gmf_paid * GMF_DEDUCTIBLE if gmf_deduct else 0.0
    limit_40 = min(0.40 * c74, 1340 * uvt)
    c86 = min(c84, c78, limit_40) if c78 > 0 else 0.0
    c87 = max(0.0, c78 - c86)             # renta líquida ordinaria del ejercicio
    gmf_deduction = c86

    ro_sales = ro_gross - ro_costs
    go_sales = go_gross - go_costs
    ro_net = c87 if c78 > 0 else -c88
    go_net = go_sales + go_income
    patrimony = sum(h["cost"] for h in result["holdings"].values())
    gross_income = ro_gross + go_gross + ro_income + go_income

    # Ganancias ocasionales: 112 ingresos, 113 costos, 114 no gravadas, 115 gravables, 127 impuesto (15 %).
    c112, c113, c114 = go_gross + go_income, go_costs, 0.0
    c115 = max(0.0, c112 - c113 - c114)

    # Impuesto marginal: lo que suben las cripto sobre la renta líquida gravable de tus otros ingresos.
    # Las pérdidas no se restan de otras rentas: quedan para compensar en años siguientes (casilla 89).
    base_other = max(0.0, other_income) / uvt
    base_total = (max(0.0, other_income) + c87) / uvt
    ro_tax = (art241_uvt(base_total) - art241_uvt(base_other)) * uvt
    go_tax = c115 * GO_RATE

    def tope(value, limit_uvt):
        limit = limit_uvt * uvt
        return {"value": value, "limit": limit, "over": value >= limit}

    return {
        "year": year, "uvt": uvt,
        "ro": {"gross": ro_gross, "costs": ro_costs, "sales": ro_sales, "income": ro_income,
               "gmf_deduction": gmf_deduction, "net": ro_net, "tax": ro_tax, "loss": -ro_net if ro_net < 0 else 0.0},
        "go": {"gross": go_gross, "costs": go_costs, "sales": go_sales, "airdrops": go_income,
               "net": go_net, "tax": go_tax, "loss": -go_net if go_net < 0 else 0.0},
        "gmf": {"estimated": t["gmf"], "cert": gmf_cert or 0.0, "paid": gmf_paid, "deduction": gmf_deduction},
        "tax_total": ro_tax + go_tax,
        "patrimony": patrimony,
        "gross_income": gross_income,
        "topes": {
            "patrimonio": tope(patrimony + other_patrimony, TOPE_PATRIMONIO),
            "ingresos": tope(gross_income + max(0.0, other_income), TOPE_INGRESOS),
            "consignaciones": tope(t["sold_cop"] + other_deposits, TOPE_INGRESOS),
            "compras": tope(t["bought_cop"], TOPE_INGRESOS),
        },
        "exterior": {"value": patrimony, "limit": TOPE_EXTERIOR * uvt_next, "over": patrimony >= TOPE_EXTERIOR * uvt_next,
                     "uvt": uvt_next, "year": year + 1},
        "f210": {
            "patrimonio_bruto": patrimony,
            "no_laborales": {"ingresos": c74, "costos": c77, "gmf": c86, "renta_liquida": ro_net},
            "ganancia_ocasional": {"ingresos": c112, "costos": c113, "gravable": c115},
            # valores por casilla del formulario 210 (solo la parte de las cripto)
            "casillas": {"29": patrimony + other_patrimony, "74": c74, "75": 0.0, "76": 0.0, "77": c77, "78": c78,
                         "84": c84, "86": c86, "87": c87, "88": c88, "112": c112, "113": c113, "114": c114,
                         "115": c115, "127": go_tax},
            "gmf_limited": c84 > c86,
        },
        "totals": t,
    }
