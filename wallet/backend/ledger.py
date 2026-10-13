"""Contabilidad por partida doble: asientos, libro diario, mayor y balances, estados financieros.

Cada movimiento genera un comprobante con débitos y créditos que siempre suman igual. Las cuentas siguen el
Plan Único de Cuentas (Decreto 2650 de 1993) a nivel de cuenta (4 dígitos). Tu contador puede ajustar los nombres.
"""
from datetime import datetime

from tax import CO_TZ, COP, INFLOW, OUTFLOW, Ledger, year_bounds

# código: (nombre, naturaleza D = débito / C = crédito, clase). Las que usan los movimientos y las más comunes para
# que el contador haga sus notas de contabilidad (pasivos, gastos, impuesto de renta…).
ACCOUNTS = {
    "1105": ("Caja", "D", "activo"),
    "1110": ("Bancos", "D", "activo"),
    "1120": ("Cuentas de ahorro", "D", "activo"),
    "1305": ("Clientes", "D", "activo"),
    "1330": ("Anticipos y avances", "D", "activo"),
    "1355": ("Anticipo de impuestos y saldos a favor", "D", "activo"),
    "1380": ("Deudores varios", "D", "activo"),
    "1435": ("Criptoactivos (inventario)", "D", "activo"),
    "1524": ("Equipo de oficina", "D", "activo"),
    "1528": ("Equipo de computación y comunicación", "D", "activo"),
    "1592": ("Depreciación acumulada", "C", "activo"),
    "1625": ("Criptoactivos (intangibles)", "D", "activo"),
    "2105": ("Obligaciones financieras", "C", "pasivo"),
    "2205": ("Proveedores", "C", "pasivo"),
    "2335": ("Costos y gastos por pagar", "C", "pasivo"),
    "2365": ("Retención en la fuente por pagar", "C", "pasivo"),
    "2380": ("Acreedores varios", "C", "pasivo"),
    "2404": ("Impuesto de renta y complementarios por pagar", "C", "pasivo"),
    "2805": ("Anticipos y avances recibidos", "C", "pasivo"),
    "3105": ("Capital del propietario", "C", "patrimonio"),
    "3605": ("Resultado del ejercicio", "C", "patrimonio"),
    "3705": ("Resultados de ejercicios anteriores", "C", "patrimonio"),
    "4135": ("Ventas de criptoactivos", "C", "ingreso"),
    "4210": ("Rendimientos (Earn y staking)", "C", "ingreso"),
    "4248": ("Utilidad en venta de criptoactivos", "C", "ingreso"),
    "4250": ("Recuperaciones", "C", "ingreso"),
    "4295": ("Airdrops y otros ingresos", "C", "ingreso"),
    "5105": ("Gastos de personal", "D", "gasto"),
    "5110": ("Honorarios (contador)", "D", "gasto"),
    "5115": ("Impuestos: 4x1000 (GMF)", "D", "gasto"),
    "5120": ("Arrendamientos", "D", "gasto"),
    "5135": ("Servicios (internet, celular)", "D", "gasto"),
    "5140": ("Gastos legales", "D", "gasto"),
    "5145": ("Mantenimiento y reparaciones", "D", "gasto"),
    "5160": ("Depreciaciones", "D", "gasto"),
    "5195": ("Gastos diversos", "D", "gasto"),
    "5305": ("Gastos financieros y comisiones", "D", "gasto"),
    "5310": ("Pérdida en venta de criptoactivos", "D", "gasto"),
    "5315": ("Gastos extraordinarios", "D", "gasto"),
    "5405": ("Impuesto de renta y complementarios", "D", "gasto"),
    "6135": ("Costo de criptoactivos vendidos", "D", "costo"),
}
RESULT_CLASSES = ("ingreso", "gasto", "costo")
CASH_ACCOUNTS = ("1105", "1110", "1120")  # efectivo y equivalentes (flujo de efectivo)
GASTO_ACCOUNTS = {"servicios": "5135", "bancarios": "5305", "honorarios": "5110", "otros": "5195"}


def _fmt_qty(q):
    return ("%.8f" % q).rstrip("0").rstrip(".")


def _describe(m):
    k = m["kind"]
    if k == "compra":
        return f"Compra {_fmt_qty(m['in_qty'])} {m['in_asset']}" + (f" · {m['platform']}" if m.get("platform") else "")
    if k == "venta":
        return f"Venta {_fmt_qty(m['out_qty'])} {m['out_asset']}" + (f" · {m['platform']}" if m.get("platform") else "")
    if k == "permuta":
        return f"Cambio {_fmt_qty(m['out_qty'])} {m['out_asset']} por {_fmt_qty(m['in_qty'])} {m['in_asset']}"
    if k == "ingreso":
        return f"Rendimiento {_fmt_qty(m['in_qty'])} {m['in_asset']}" + (f" · {m['platform']}" if m.get("platform") else "")
    if k == "gasto":
        return f"Gasto: {m.get('note') or m.get('category') or 'sin detalle'}"
    if k == "aporte":
        return "Aporte del propietario" + (f": {m['note']}" if m.get("note") else "")
    if k == "retiro":
        return "Retiro del propietario" + (f": {m['note']}" if m.get("note") else "")
    if k == "airdrop":
        return f"Airdrop {_fmt_qty(m['in_qty'])} {m['in_asset']}"
    return f"Comisión {_fmt_qty(m['out_qty'])} {m['out_asset']}"


def journal(movements, closings=(), habitual=True, method="fifo", notes=()):
    """Todos los comprobantes en orden. Cada uno: {t, number, kind, ref, text, lines: [{account, debit, credit}]}.
    `notes` son las notas de contabilidad (asientos manuales del contador): {id, t, text, support, lines}."""
    inv = "1435" if habitual else "1625"
    led = Ledger(method)
    raw = []

    for m in sorted(movements, key=lambda x: (x["t"], x.get("id") or 0)):
        k = m["kind"]
        v = float(m.get("cop_value") or 0)
        fee = float(m.get("fee_cop") or 0) if k in ("compra", "venta", "permuta") else 0.0
        gmf = float(m.get("gmf_cop") or 0)
        cost = 0.0
        if k in OUTFLOW and m.get("out_asset") and m["out_asset"] != COP:
            parts, _missing = led.take(m["out_asset"], float(m["out_qty"]))
            cost = sum(p[1] for p in parts)
        if k in INFLOW and m.get("in_asset") and m["in_asset"] != COP:
            led.add(m["in_asset"], float(m["in_qty"]), v + fee if k == "compra" else v, m["t"])

        L = []

        def line(acc, d=0.0, c=0.0):
            if abs(d) > 1e-9 or abs(c) > 1e-9:
                L.append({"account": acc, "debit": d, "credit": c})

        def sale(value):
            """Venta o cambio: ingreso y costo (habitual) o utilidad/pérdida neta (activo fijo)."""
            if habitual:
                line("4135", c=value)
                line("6135", d=cost)
                line(inv, c=cost)
            else:
                line(inv, c=cost)
                gain = value - cost
                line("4248", c=gain) if gain >= 0 else line("5310", d=-gain)

        if k == "compra":
            line(inv, d=v + fee)
            line("1110", c=v + fee)
        elif k == "venta":
            line("1110", d=v - fee)
            line("5305", d=fee)
            sale(v)
        elif k == "permuta":
            line(inv, d=v)
            sale(v)
            line("5305", d=fee)
            line("1110", c=fee)
        elif k == "ingreso":
            line(inv, d=v)
            line("4210", c=v)
        elif k == "airdrop":
            line(inv, d=v)
            line("4295", c=v)
        elif k == "comision":
            line("5305", d=cost)
            line(inv, c=cost)
        elif k == "gasto":
            line(GASTO_ACCOUNTS.get(m.get("category") or "otros", "5195"), d=v)
            line("1110", c=v)
        elif k == "aporte":
            line("1110", d=v)
            line("3105", c=v)
        elif k == "retiro":
            line("3105", d=v)
            line("1110", c=v)
        if gmf:
            line("5115", d=gmf)
            line("1110", c=gmf)
        if L:
            raw.append({"t": m["t"], "kind": k, "ref": m.get("id"), "text": _describe(m), "lines": L})

    for c in closings:
        adj = float(c.get("adjustment") or 0)
        if abs(adj) > 0.005:
            what = "Inicio de caja" if c.get("kind") == "inicio" else "Cierre de caja"
            text = f"{what}: aporte del propietario" if adj > 0 else f"{what}: retiro del propietario"
            lines = ([{"account": "1110", "debit": adj, "credit": 0.0}, {"account": "3105", "debit": 0.0, "credit": adj}] if adj > 0
                     else [{"account": "3105", "debit": -adj, "credit": 0.0}, {"account": "1110", "debit": 0.0, "credit": -adj}])
            raw.append({"t": c["t"], "kind": "ajuste", "ref": c.get("id"), "text": text, "lines": lines})

    for n in notes:
        raw.append({"t": n["t"], "kind": "nota", "ref": n["id"], "text": f"Nota de contabilidad: {n['text']}",
                    "support": n.get("support") or "", "lines": [dict(ln) for ln in n["lines"]]})

    raw.sort(key=lambda e: (e["t"], 0 if e["kind"] != "ajuste" else 1))
    seq = {}
    for e in raw:
        y = datetime.fromtimestamp(e["t"], CO_TZ).year
        seq[y] = seq.get(y, 0) + 1
        e["number"] = f"{y}-{seq[y]:05d}"
    return raw


def _signed(acc, debit, credit):
    """Saldo según la naturaleza de la cuenta (positivo = saldo normal)."""
    return debit - credit if ACCOUNTS[acc][1] == "D" else credit - debit


def trial_balance(entries, start, end):
    """Mayor y balances del periodo [start, end): saldo anterior, débitos, créditos y saldo final por cuenta.
    Las cuentas de resultado (4, 5 y 6) arrancan en cero cada 1 de enero."""
    fy_start = year_bounds(datetime.fromtimestamp(start, CO_TZ).year)[0] if start > 0 else 0
    acc = {}
    for e in entries:
        if e["t"] >= end:
            continue
        for ln in e["lines"]:
            a = acc.setdefault(ln["account"], {"prev_d": 0.0, "prev_c": 0.0, "prev_y_d": 0.0, "prev_y_c": 0.0,
                                               "debit": 0.0, "credit": 0.0})
            if e["t"] < start:
                a["prev_d"] += ln["debit"]
                a["prev_c"] += ln["credit"]
                if e["t"] >= fy_start:
                    a["prev_y_d"] += ln["debit"]
                    a["prev_y_c"] += ln["credit"]
            else:
                a["debit"] += ln["debit"]
                a["credit"] += ln["credit"]
    rows = []
    for code in sorted(acc):
        a = acc[code]
        name, nature, cls = ACCOUNTS[code]
        prev = _signed(code, a["prev_y_d"], a["prev_y_c"]) if cls in RESULT_CLASSES else _signed(code, a["prev_d"], a["prev_c"])
        rows.append({"account": code, "name": name, "nature": nature, "class": cls, "previous": prev,
                     "debit": a["debit"], "credit": a["credit"],
                     "final": prev + _signed(code, a["debit"], a["credit"])})
    totals = {"debit": sum(r["debit"] for r in rows), "credit": sum(r["credit"] for r in rows)}
    totals["balanced"] = abs(totals["debit"] - totals["credit"]) < 0.01
    return {"rows": rows, "totals": totals}


# Estado de resultados por secciones (PUC): (clave, título, prefijos de cuenta)
SECTIONS = (
    ("ingresos_operacionales", "Ingresos operacionales", ("41",)),
    ("costo_ventas", "Costo de ventas", ("6",)),
    ("gastos_operacionales", "Gastos operacionales", ("51", "52")),
    ("ingresos_no_operacionales", "Ingresos no operacionales", ("42",)),
    ("gastos_no_operacionales", "Gastos no operacionales", ("53",)),
    ("impuesto_renta", "Impuesto de renta y complementarios", ("54",)),
)


def income_statement(entries, start, end):
    """Estado de resultados del periodo, con la estructura del PUC: utilidad bruta, operacional, antes de impuestos y neta."""
    tb = trial_balance(entries, start, end)
    # ingresos suman por el crédito; gastos y costos por el débito (así las cuentas de signo contrario restan)
    lines = {code: 0.0 for code in ("4135", "6135", "4248", "5310", "4210", "4295", "5305", "5115", "5110", "5135", "5195")}
    for r in tb["rows"]:
        if r["class"] in RESULT_CLASSES:
            lines[r["account"]] = r["credit"] - r["debit"] if r["class"] == "ingreso" else r["debit"] - r["credit"]
    rows, sec = [], {key: 0.0 for key, _, _ in SECTIONS}
    for code in sorted(lines):
        key = next(k for k, _, prefixes in SECTIONS if code.startswith(prefixes))
        sec[key] += lines[code]
        if abs(lines[code]) > 0.005:
            rows.append({"account": code, "name": ACCOUNTS[code][0], "section": key, "value": lines[code]})
    sec["utilidad_bruta"] = sec["ingresos_operacionales"] - sec["costo_ventas"]
    sec["utilidad_operacional"] = sec["utilidad_bruta"] - sec["gastos_operacionales"]
    sec["utilidad_antes_impuestos"] = sec["utilidad_operacional"] + sec["ingresos_no_operacionales"] - sec["gastos_no_operacionales"]
    net = sec["utilidad_antes_impuestos"] - sec["impuesto_renta"]
    gross = lines["4135"] - lines["6135"] + lines["4248"] - lines["5310"]
    other = sum(v for c, v in lines.items() if ACCOUNTS[c][2] == "ingreso" and c not in ("4135", "4248"))
    return {"lines": lines, "rows": rows, "sections": sec, "layout": _income_layout(rows, sec, net), "gross_profit": gross,
            "other_income": other, "expenses": gross + other - net, "net": net}


def _income_layout(rows, sec, net):
    """Renglones del estado de resultados en el orden del PUC, con subtotales: lo que se muestra, imprime y exporta."""
    titles = {key: title for key, title, _ in SECTIONS}
    steps = ("ingresos_operacionales", "costo_ventas", ("utilidad_bruta", "Utilidad bruta"), "gastos_operacionales",
             ("utilidad_operacional", "Utilidad operacional"), "ingresos_no_operacionales", "gastos_no_operacionales",
             ("utilidad_antes_impuestos", "Utilidad antes de impuestos"), "impuesto_renta")
    out = []
    for step in steps:
        if isinstance(step, tuple):
            out.append({"kind": "subtotal", "account": "", "label": step[1], "value": sec[step[0]]})
            continue
        lines = [r for r in rows if r["section"] == step]
        if lines or step in ("ingresos_operacionales", "costo_ventas"):
            out.append({"kind": "section", "account": "", "label": titles[step], "value": None})
            out += [{"kind": "line", "account": r["account"], "label": r["name"], "value": r["value"]} for r in lines]
            out.append({"kind": "total", "account": "", "label": f"Total {titles[step].lower()}", "value": sec[step]})
    out.append({"kind": "net", "account": "", "label": "Resultado neto del periodo", "value": net})
    return out


def _side_value(r, side):
    """Saldo de una cuenta visto desde su lado del balance (las cuentas correctoras, como la depreciación, restan)."""
    return r["final"] if r["nature"] == side else -r["final"]


def balance_sheet(entries, at):
    """Estado de situación financiera al instante `at` (incluido). Los resultados del año y de años anteriores
    se calculan de las cuentas 4, 5 y 6 (3605 y 3705), más lo que se haya registrado directo en ellas."""
    year_start, _ = year_bounds(datetime.fromtimestamp(at, CO_TZ).year)
    end = at + 1e-6
    before = income_statement(entries, 0, year_start)["net"]          # años anteriores
    current = income_statement(entries, year_start, end)["net"]       # este año hasta la fecha
    tb = trial_balance(entries, 0, end)
    rows = {r["account"]: r for r in tb["rows"]}
    assets = [{"account": c, "name": r["name"], "value": _side_value(r, "D")} for c, r in rows.items() if r["class"] == "activo"]
    liabilities = [{"account": c, "name": r["name"], "value": _side_value(r, "C")} for c, r in rows.items() if r["class"] == "pasivo"]
    direct = {c: _side_value(r, "C") for c, r in rows.items() if r["class"] == "patrimonio"}
    equity = [{"account": "3105", "name": ACCOUNTS["3105"][0], "value": direct.pop("3105", 0.0)}]
    equity += [{"account": c, "name": ACCOUNTS[c][0], "value": v} for c, v in sorted(direct.items()) if c not in ("3605", "3705")]
    equity += [{"account": "3705", "name": ACCOUNTS["3705"][0], "value": before + direct.get("3705", 0.0)},
               {"account": "3605", "name": ACCOUNTS["3605"][0], "value": current + direct.get("3605", 0.0)}]
    total_assets = sum(a["value"] for a in assets)
    total_liabilities = sum(x["value"] for x in liabilities)
    total_equity = sum(e["value"] for e in equity)
    return {"at": at, "assets": assets, "liabilities": liabilities, "equity": equity, "total_assets": total_assets,
            "total_liabilities": total_liabilities, "total_equity": total_equity,
            "balanced": abs(total_assets - total_liabilities - total_equity) < 0.01}


def equity_changes(entries, start, end):
    """Estado de cambios en el patrimonio [start, end): saldo inicial, aportes, retiros, traslado de resultados,
    resultado del periodo y saldo final por cada cuenta de patrimonio."""
    opening = {e["account"]: e["value"] for e in balance_sheet(entries, start - 1e-6)["equity"]} if start > 0 else {}
    final_bs = balance_sheet(entries, end - 1e-6)
    closing = {e["account"]: e["value"] for e in final_bs["equity"]}
    posted = {}  # lo registrado directo en cada cuenta de patrimonio durante el periodo (crédito − débito)
    aportes = retiros = 0.0
    for e in entries:
        if start <= e["t"] < end:
            for ln in e["lines"]:
                if ACCOUNTS[ln["account"]][2] == "patrimonio":
                    posted[ln["account"]] = posted.get(ln["account"], 0.0) + ln["credit"] - ln["debit"]
                    if ln["account"] == "3105":
                        aportes += ln["credit"]
                        retiros += ln["debit"]
    result = income_statement(entries, start, end)["net"]
    accounts = [c for c in closing if c in opening or abs(closing[c]) > 0.005 or c in ("3105", "3705", "3605")]
    moves = {c: {"opening": opening.get(c, 0.0), "closing": closing[c]} for c in accounts}
    for c, m in moves.items():
        delta = m["closing"] - m["opening"]
        m["aportes"] = aportes if c == "3105" else 0.0
        m["retiros"] = -retiros if c == "3105" else 0.0
        m["resultado"] = result if c == "3605" else 0.0
        m["otros"] = posted.get(c, 0.0) if c != "3105" else 0.0
        m["traslado"] = delta - m["aportes"] - m["retiros"] - m["resultado"] - m["otros"]  # cierre del año anterior: 3605 → 3705
    labels = (("opening", "Saldo inicial"), ("aportes", "Aportes del propietario"), ("retiros", "Retiros del propietario"),
              ("traslado", "Traslado del resultado del año anterior"), ("resultado", "Resultado del periodo"),
              ("otros", "Otros movimientos (notas de contabilidad)"), ("closing", "Saldo final"))
    rows = [{"key": k, "label": label, "values": {c: moves[c][k] for c in accounts}, "total": sum(moves[c][k] for c in accounts)}
            for k, label in labels if k in ("opening", "closing") or any(abs(moves[c][k]) > 0.005 for c in accounts)]
    total = sum(m["closing"] for m in moves.values())
    return {"columns": [{"account": c, "name": ACCOUNTS[c][0]} for c in accounts], "rows": rows,
            "balanced": abs(total - final_bs["total_equity"]) < 0.01}


def cash_flow(entries, start, end, habitual=True):
    """Estado de flujos de efectivo [start, end) por el método directo: de dónde vino y a dónde se fue cada peso
    de caja y bancos (1105, 1110, 1120), en actividades de operación, inversión y financiación."""
    trade = "operacion" if habitual else "inversion"  # si no es habitual, las cripto son inversión (intangibles)
    flows = {"operacion": {}, "inversion": {}, "financiacion": {}}

    def add(group, label, v):
        if abs(v) > 1e-9:
            flows[group][label] = flows[group].get(label, 0.0) + v

    opening = 0.0
    for e in entries:
        if e["t"] >= end:
            continue
        cash = sum(ln["debit"] - ln["credit"] for ln in e["lines"] if ln["account"] in CASH_ACCOUNTS)
        if e["t"] < start:
            opening += cash
            continue
        if abs(cash) < 1e-9:
            continue
        gmf = min(sum(ln["debit"] for ln in e["lines"] if ln["account"] == "5115"), -cash) if cash < 0 else 0.0
        add("operacion", "Pagos de 4x1000 (GMF)", -gmf)
        main, k = cash + gmf, e["kind"]
        if k == "compra":
            add(trade, "Pagos por compras de criptoactivos", main)
        elif k == "venta":
            add(trade, "Cobros por ventas de criptoactivos", main)
        elif k == "gasto":
            add("operacion", "Pagos de gastos", main)
        elif k in ("permuta", "comision"):
            add("operacion", "Pagos de comisiones", main)
        elif k in ("aporte", "retiro", "ajuste"):
            add("financiacion", "Aportes del propietario" if main > 0 else "Retiros del propietario", main)
        else:  # notas de contabilidad: según la cuenta contraria
            other = [ln["account"] for ln in e["lines"] if ln["account"] not in CASH_ACCOUNTS]
            group = ("financiacion" if any(a.startswith(("3", "21")) for a in other) else
                     "inversion" if any(a.startswith(("15", "16")) for a in other) else "operacion")
            add(group, "Notas de contabilidad", main)
    titles = {"operacion": "Actividades de operación", "inversion": "Actividades de inversión", "financiacion": "Actividades de financiación"}
    sections = [{"id": g, "label": titles[g], "lines": [{"label": k, "value": v} for k, v in flows[g].items()],
                 "total": sum(flows[g].values())} for g in ("operacion", "inversion", "financiacion")]
    net = sum(s["total"] for s in sections)
    return {"opening": opening, "sections": sections, "net": net, "closing": opening + net}


def daily_cash(entries, start, end):
    """Libro de caja y bancos [start, end): por cada día con movimiento en Bancos (1110), saldo inicial, entradas,
    salidas, 4x1000 y saldo final, con los comprobantes del día."""
    opening, days = 0.0, {}
    for e in entries:
        if e["t"] >= end:
            continue
        cash = [ln for ln in e["lines"] if ln["account"] == "1110"]
        if not cash:
            continue
        d, c = sum(ln["debit"] for ln in cash), sum(ln["credit"] for ln in cash)
        if e["t"] < start:
            opening += d - c
            continue
        gmf = sum(ln["debit"] for ln in e["lines"] if ln["account"] == "5115")
        key = datetime.fromtimestamp(e["t"], CO_TZ).date().isoformat()
        day = days.setdefault(key, {"day": key, "in": 0.0, "out": 0.0, "gmf": 0.0, "entries": []})
        day["in"] += d
        day["out"] += c - gmf
        day["gmf"] += gmf
        day["entries"].append({"number": e["number"], "t": e["t"], "kind": e["kind"], "text": e["text"], "in": d, "out": c - gmf, "gmf": gmf})
    bal, rows = opening, []
    for key in sorted(days):
        x = days[key]
        x["opening"] = bal
        for e in x["entries"]:  # saldo corrido después de cada comprobante
            bal += e["in"] - e["out"] - e["gmf"]
            e["balance"] = bal
        x["closing"] = bal
        rows.append(x)
    totals = {k: sum(x[k] for x in rows) for k in ("in", "out", "gmf")}
    return {"opening": opening, "days": rows, "totals": totals, "closing": bal}


def cash_at(entries, at, exclude_ref=None):
    """Saldo de Bancos según los libros al instante `at`."""
    total = 0.0
    for e in entries:
        if e["t"] > at or (e["kind"] == "ajuste" and exclude_ref is not None and e["ref"] == exclude_ref):
            continue
        for ln in e["lines"]:
            if ln["account"] == "1110":
                total += ln["debit"] - ln["credit"]
    return total
