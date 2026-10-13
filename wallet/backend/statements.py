"""Extractos bancarios: leer (PDF, Excel, CSV), clasificar y cruzar con Binance P2P.

Cada banco exporta distinto, así que se buscan las columnas por nombre (fecha, descripción, valor o débito/crédito,
saldo). En PDF primero se intentan las tablas y, si no hay, se lee línea por línea.
"""
import csv
import hashlib
import io
import re
import unicodedata
from datetime import date, datetime

from tax import CO_TZ

CATEGORIES = {
    "binance_p2p": "Binance P2P",
    "gmf": "4x1000",
    "traslado": "Entre mis cuentas",
    "salario": "Salario e ingresos laborales",
    "ingreso": "Otros ingresos",
    "rendimientos": "Intereses y rendimientos",
    "negocio": "Gasto del negocio",
    "bancarios": "Cuota de manejo y comisiones",
    "consumo": "Compras y consumos",
    "efectivo": "Retiro en efectivo",
    "credito": "Pago de créditos y tarjetas",
    "otro": "Sin clasificar",
}

# palabras clave → categoría (en orden: la primera que coincide gana)
RULES = [
    ("gmf", r"\bgmf\b|4 ?x ?1000|4x mil|gravamen|movimientos financieros|cuatro por mil"),
    ("bancarios", r"cuota de manejo|cuota manejo|comision|iva com|cobro servicio|costo transacc|tarifa|mensualidad cuenta"),
    ("rendimientos", r"interes|rendimiento|abono int|liquidacion int"),
    ("salario", r"nomina|salario|sueldo|pago de nomina|prima de servicios|cesantia|honorarios recibidos"),
    ("efectivo", r"retiro (en )?cajero|retiro efectivo|retiro atm|cajero|corresponsal.*retiro|avance"),
    ("credito", r"pago (de )?tarjeta|pago tc|pago tdc|abono (a )?credito|cuota (de )?credito|pago credito|pago prestamo"),
    ("consumo", r"compra|pago pse|\bpse\b|datafono|\bpos\b|pago en linea|suscripcion|netflix|spotify|uber|rappi|didi|"
                r"exito|olimpica|d1|ara\b|jumbo|carulla|falabella|amazon|mercadolibre|recarga|pago factura|servicios publicos"),
]

MONTHS = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "set": 9,
          "oct": 10, "nov": 11, "dic": 12, "jan": 1, "apr": 4, "aug": 8, "dec": 12}

COLS = {
    "date": ["fecha", "fecha transaccion", "fecha de transaccion", "fecha movimiento", "fecha operacion", "fecha y hora",
             "fecha de la transaccion", "date", "dia"],
    "desc": ["descripcion", "concepto", "detalle", "transaccion", "descripcion movimiento", "movimiento", "description",
             "detalle del movimiento", "referencia", "tipo de transaccion", "tipo"],
    "amount": ["valor", "monto", "importe", "valor transaccion", "valor de la transaccion", "amount", "valor movimiento"],
    "debit": ["debitos", "debito", "retiros", "cargos", "salidas", "valor debito", "debito $", "egresos"],
    "credit": ["creditos", "credito", "depositos", "abonos", "entradas", "valor credito", "credito $", "consignaciones", "ingresos"],
    "balance": ["saldo", "saldo final", "nuevo saldo", "balance", "saldo disponible", "saldo total"],
}
INFLOW_WORDS = r"abono|consignacion|recib|deposito|credito|transferencia de|recarga recibida|ingreso|devolucion|reembolso|nomina|interes"


class StatementError(Exception):
    pass


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9$ ]+", " ", s).strip()


NUM_RE = re.compile(r"\(?-?\$?\s?-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\)?-?|\(?-?\$?\s?-?\d+(?:[.,]\d{1,2})?\)?-?")


def money(v):
    """'$ 1.234.567,89' · '-1,234,567.89' · '(1.234)' · '550.000' → float. None si no es un número."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", " ")
    if not s or not re.search(r"\d", s):
        return None
    neg = s.startswith("-") or s.endswith("-") or (s.startswith("(") and s.endswith(")")) or "-$" in s
    s = re.sub(r"[^\d.,]", "", s)
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        s = s.replace(",", ".") if len(parts) == 2 and len(parts[1]) <= 2 else s.replace(",", "")
    elif "." in s:
        parts = s.split(".")
        if not (len(parts) == 2 and len(parts[1]) <= 2):
            s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def parse_day(v, year_hint=None):
    """Fecha de un extracto → date. Acepta dd/mm/aaaa, aaaa-mm-dd, dd-mm-aa, '08 oct 2026', 'dd/mm' (con año sugerido)."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = norm(v).replace("  ", " ")
    s0 = str(v or "").strip()
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s0)
    if m:
        return _mk(int(m[1]), int(m[2]), int(m[3]))
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s0)
    if m:
        y = int(m[3])
        return _mk(y + 2000 if y < 100 else y, int(m[2]), int(m[1]))
    m = re.match(r"^(\d{1,2}) ?([a-z]{3})[a-z]* ?(\d{2,4})?", s)
    if m and m[2] in MONTHS:
        y = int(m[3]) if m[3] else year_hint
        if y and y < 100:
            y += 2000
        return _mk(y, MONTHS[m[2]], int(m[1])) if y else None
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})$", s0)
    if m and year_hint:
        return _mk(year_hint, int(m[2]), int(m[1]))
    return None


def _mk(y, mo, d):
    try:
        return date(y, mo, d) if 2000 <= y <= 2100 else None
    except ValueError:
        return None


# ------------------------------------------------------------ lectura de archivos

def read_file(filename, data, password=None, year_hint=None):
    """Devuelve (filas, avisos). Fila: {day, description, amount (+entra / −sale), balance}."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        return _from_pdf(data, password, year_hint)
    if ext in ("xlsx", "xlsm"):
        return _from_tables([_xlsx(data)], year_hint)
    if ext == "xls":
        return _from_tables([_xls(data)], year_hint)
    if ext in ("csv", "txt"):
        return _from_tables([_csv(data)], year_hint)
    raise StatementError("Formato no soportado. Sube PDF, Excel (.xlsx o .xls) o CSV.")


def _csv(data):
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    first = text.split("\n", 1)[0]
    delim = max((";", ",", "\t", "|"), key=first.count)
    return [list(r) for r in csv.reader(io.StringIO(text), delimiter=delim)]


def _xlsx(data):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    rows = []
    for ws in wb.worksheets:
        rows += [list(r) for r in ws.iter_rows(values_only=True)]
    return rows


def _xls(data):
    import xlrd
    book = xlrd.open_workbook(file_contents=data)
    rows = []
    for sh in book.sheets():
        for i in range(sh.nrows):
            row = []
            for c in sh.row(i):
                if c.ctype == xlrd.XL_CELL_DATE:
                    row.append(datetime(*xlrd.xldate_as_tuple(c.value, book.datemode)))
                else:
                    row.append(c.value)
            rows.append(row)
    return rows


def _find_header(table):
    """Busca la fila de encabezados y el índice de cada columna."""
    for i, row in enumerate(table[:40]):
        head = [norm(c) for c in row]
        idx = {}
        for col, names in COLS.items():
            for j, h in enumerate(head):
                if h in names or any(h.startswith(n + " ") for n in names if len(n) > 4):
                    if col not in idx and j not in idx.values():
                        idx[col] = j
                        break
        if "date" in idx and ("amount" in idx or "debit" in idx or "credit" in idx):
            return i, idx
    return None, None


def _from_tables(tables, year_hint):
    rows, warnings = [], []
    for table in tables:
        table = [r for r in table if r and any(c not in (None, "") for c in r)]
        start, idx = _find_header(table)
        if start is None:
            continue
        for r in table[start + 1:]:
            get = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else None
            day = parse_day(get("date"), year_hint)
            if not day:
                continue
            if "amount" in idx:
                amount = money(get("amount"))
            else:
                deb, cre = money(get("debit")) or 0.0, money(get("credit")) or 0.0
                amount = abs(cre) - abs(deb)
            if amount is None or abs(amount) < 0.005:
                continue
            desc = " ".join(str(get("desc") or "").split()) or "(sin descripción)"
            rows.append({"day": day, "description": desc[:200], "amount": amount, "balance": money(get("balance"))})
    if not rows and tables:
        warnings.append("No encontré columnas de fecha y valor. Revisa que el archivo sea el extracto de movimientos.")
    return rows, warnings


def _from_pdf(data, password, year_hint):
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect
    try:
        pdf = pdfplumber.open(io.BytesIO(data), password=password or "")
    except PDFPasswordIncorrect:
        raise StatementError("El PDF tiene clave. Escríbela (muchos bancos usan tu número de cédula).")
    except Exception as e:  # noqa: BLE001 - pdfminer lanza varios tipos
        if "password" in str(e).lower() or "encrypt" in str(e).lower():
            raise StatementError("El PDF tiene clave. Escríbela (muchos bancos usan tu número de cédula).")
        raise StatementError(f"No pude abrir el PDF ({type(e).__name__}).")
    with pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        tables = []
        for p in pdf.pages:
            for t in p.extract_tables() or []:
                tables.append(t)
    if not text.strip():
        raise StatementError("El PDF no tiene texto (parece una imagen escaneada). Descarga el extracto en Excel o CSV.")
    year_hint = year_hint or _guess_year(text)
    if tables:
        merged = [row for t in tables for row in t]
        rows, warnings = _from_tables([merged], year_hint)
        if rows:
            return rows, warnings
    return _from_text(text, year_hint)


def _guess_year(text):
    years = re.findall(r"\b(20[12]\d)\b", text)
    return int(max(set(years), key=years.count)) if years else None


LINE_DATE = re.compile(r"^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{1,2}\s?[A-Za-z]{3}[a-z]*(?:\s?\d{2,4})?)\s+(.*)$")
AMOUNT_RE = re.compile(r"(?<![\w/])-?\$?\s?-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?-?(?![\w/])|(?<![\w/.,])-?\$?\s?\d+[.,]\d{2}-?(?![\w/])")


def _from_text(text, year_hint):
    """Extracto en texto: cada línea que empieza con fecha y trae valores es un movimiento."""
    rows, prev_balance = [], None
    for line in text.splitlines():
        m = LINE_DATE.match(line)
        if not m:
            continue
        day = parse_day(m[1], year_hint)
        if not day:
            continue
        rest = m[2]
        nums = [(x.group(0), x.start()) for x in AMOUNT_RE.finditer(rest)]
        if not nums:
            continue
        values = [money(n) for n, _ in nums]
        desc = rest[:nums[0][1]].strip(" $-") or "(sin descripción)"
        balance = values[-1] if len(values) >= 2 else None
        amount = values[-2] if len(values) >= 2 else values[0]
        if amount is None:
            continue
        if balance is not None and prev_balance is not None and abs(abs(balance - prev_balance) - abs(amount)) < 1:
            amount = balance - prev_balance  # el saldo dice si entró o salió
        elif amount > 0 and not re.search(INFLOW_WORDS, norm(desc)):
            amount = -amount  # sin signo y sin palabra de entrada: es una salida
        if balance is not None:
            prev_balance = balance
        rows.append({"day": day, "description": " ".join(desc.split())[:200], "amount": amount, "balance": balance})
    warnings = [] if rows else ["No pude leer movimientos de este PDF. Pásame el archivo y ajusto el lector para tu banco."]
    if rows:
        warnings.append("Leí el PDF línea por línea: revisa en la vista previa que entradas y salidas queden bien.")
    return rows, warnings


# ------------------------------------------------------------ huellas, clasificación y cruces

def fingerprints(account_id, rows):
    """Huella de cada fila para no duplicar si el mismo movimiento viene en dos extractos."""
    seen, out = {}, []
    for r in rows:
        base = f"{account_id}|{r['day']}|{norm(r['description'])}|{round(r['amount'], 2)}"
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append(hashlib.sha256(f"{base}|{n}".encode()).hexdigest()[:32])
    return out


def classify(description, user_rules=()):
    d = norm(description)
    for pattern, cat in user_rules:
        if pattern and pattern in d:
            return cat
    for cat, rx in RULES:
        if re.search(rx, d):
            return cat
    return None


def day_ts(d):
    return datetime(d.year, d.month, d.day, 12, tzinfo=CO_TZ).timestamp()


def match_p2p(txs, p2p, used=None):
    """Cruza cada movimiento del banco con una orden P2P de Binance (mismo valor, ±2 días).
    txs: [{id, t, amount, pay_methods}] · p2p: [{id, t, kind, cop_value, pay_method}] → {tx_id: movement_id}."""
    used = set(used or ())
    out = {}
    for tx in sorted(txs, key=lambda x: x["t"]):
        want = "compra" if tx["amount"] < 0 else "venta"
        best = None
        for m in p2p:
            if m["id"] in used or m["kind"] != want:
                continue
            if abs(m["t"] - tx["t"]) > 2.5 * 86400:
                continue
            if abs(abs(tx["amount"]) - m["cop_value"]) > max(1.0, 0.0005 * m["cop_value"]):
                continue
            score = abs(m["t"] - tx["t"]) - (86400 if m.get("pay_method") and m["pay_method"] in tx.get("pay_methods", ()) else 0)
            if best is None or score < best[0]:
                best = (score, m["id"])
        if best:
            out[tx["id"]] = best[1]
            used.add(best[1])
    return out


def match_transfers(txs):
    """Salida de una cuenta y entrada del mismo valor en otra tuya (±2 días) → traslado. Devuelve pares de ids."""
    outs = [t for t in txs if t["amount"] < 0]
    ins = [t for t in txs if t["amount"] > 0]
    used, pairs = set(), []
    for o in sorted(outs, key=lambda x: x["t"]):
        for i in sorted(ins, key=lambda x: abs(x["t"] - o["t"])):
            if i["id"] in used or i["account_id"] == o["account_id"]:
                continue
            if abs(i["t"] - o["t"]) <= 2.5 * 86400 and abs(i["amount"] + o["amount"]) <= 1:
                pairs.append((o["id"], i["id"]))
                used.add(i["id"])
                break
    return pairs
