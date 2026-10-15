"""Importar movimientos: Binance (P2P, Convert y Spot) con llaves de solo lectura, y archivos CSV.

Las llaves de Binance se usan en memoria mientras dura la importación y no se guardan en ningún lado.
"""
import csv
import hashlib
import hmac
import io
import re
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests

from rates import RateError, STABLE
from tax import CO_TZ

API = "https://api.binance.com"
DAY = 86400
WINDOW = 30 * DAY
P2P_API_DAYS = 179  # Binance solo entrega por API los últimos 6 meses de órdenes P2P
OVERLAP = 2 * DAY  # cada sincronización repasa 2 días: los repetidos no se duplican
CONVERT_START = datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp()
EARN_START = datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp()  # Simple Earn existe desde 2023
GMF_RATE = 0.004
ASSET_RE = re.compile(r"^[A-Z0-9]{2,12}$")
MAIN = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "TRX", "LTC", "DOT", "MATIC", "POL", "AVAX", "LINK",
        "TON", "SHIB", "USDC", "FDUSD", "USDT"]


class ImportError_(Exception):
    pass


class Binance:
    def __init__(self, key, secret):
        if not key or not secret or len(key) > 128 or len(secret) > 128:
            raise ImportError_("Escribe la API Key y la Secret Key.")
        self.key, self.secret = key.strip(), secret.strip()
        self.s = requests.Session()
        self.s.headers.update({"X-MBX-APIKEY": self.key, "User-Agent": "ArbiCrypto-Wallet/1.0"})
        self.offset = 0

    def call(self, path, signed=True, method="GET", **params):
        for attempt in range(4):
            p = dict(params)
            if signed:
                p["timestamp"] = int(time.time() * 1000) + self.offset
                p["recvWindow"] = 10000
                q = urlencode(p)
                q += "&signature=" + hmac.new(self.secret.encode(), q.encode(), hashlib.sha256).hexdigest()
            else:
                q = urlencode(p)
            try:
                r = (self.s.post if method == "POST" else self.s.get)(f"{API}{path}?{q}", timeout=20)
            except requests.RequestException as e:
                if attempt == 3:
                    raise ImportError_(f"No hay conexión con Binance ({type(e).__name__}).") from e
                time.sleep(2)
                continue
            if r.status_code in (418, 429):
                time.sleep(int(r.headers.get("Retry-After", "10")))
                continue
            try:
                data = r.json()
            except ValueError:
                raise ImportError_(f"Binance respondió {r.status_code}.")
            if r.status_code >= 400:
                code = data.get("code") if isinstance(data, dict) else None
                if code == -1021 and attempt < 3:  # reloj desfasado
                    self.sync_time()
                    continue
                msg = {-2008: "Esa API Key no existe en Binance. Revisa que la copiaste completa.",
                       -2014: "La API Key tiene un formato inválido. Cópiala de nuevo.",
                       -2015: "Binance rechazó la llave: revisa la API Key, la restricción de IP o que tenga permiso de lectura.",
                       -1022: "La Secret Key no corresponde a esa API Key."}.get(code)
                raise ImportError_(msg or f"Binance: {data.get('msg', r.status_code) if isinstance(data, dict) else r.status_code}")
            return data
        raise ImportError_("Binance está limitando las consultas. Intenta en unos minutos.")

    def sync_time(self):
        server = self.call("/api/v3/time", signed=False)["serverTime"]
        self.offset = server - int(time.time() * 1000)

    def check_read_only(self):
        """Solo se aceptan llaves que únicamente puedan leer."""
        r = self.call("/sapi/v1/account/apiRestrictions")
        safe = {"enableReading", "enableFixReadOnly"}
        risky = [k for k, v in r.items() if v is True and k not in safe and k.startswith(("enable", "permits"))]
        if risky:
            raise ImportError_("Por seguridad usa una API Key de solo lectura (desactiva trading, retiros y transferencias).")
        if not r.get("enableReading"):
            raise ImportError_("La API Key no tiene permiso de lectura.")


def windows(start, end, size=WINDOW):
    a = start
    while a < end:
        b = min(a + size, end)
        yield a, b
        a = b


class ImportJob:
    """Sincronización con Binance en segundo plano. Recuerda hasta dónde llegó (cursor) y sigue desde ahí."""

    def __init__(self, db, rates):
        self.db, self.rates = db, rates
        self.jobs = {}
        self.lock = threading.Lock()

    def status(self, uid):
        j = self.jobs.get(uid)
        return dict(j) if j else {"state": "idle"}

    def running(self, uid):
        return self.jobs.get(uid, {}).get("state") == "running"

    def start(self, uid, key, secret, gmf, cursor, on_finish):
        """on_finish(uid, ok, cursor, error) guarda el avance aunque falle a mitad de camino."""
        with self.lock:
            if self.running(uid):
                return False
            client = Binance(key, secret)
            self.jobs[uid] = {"state": "running", "step": "Revisando la API Key", "added": 0, "found": 0,
                              "skipped": 0, "errors": [], "notes": [], "started": time.time()}
        threading.Thread(target=self._run, args=(uid, client, gmf, dict(cursor), on_finish), daemon=True).start()
        return True

    def _set(self, uid, **kw):
        self.jobs[uid].update(kw)

    def _run(self, uid, client, gmf, cursor, on_finish):
        error = None
        try:
            client.sync_time()
            client.check_read_only()
            end = time.time()
            cursor.setdefault("spot", {})
            parts = [
                ("p2p", "P2P", lambda: self.p2p(uid, client, cursor.get("p2p"), end, gmf), end),
                ("convert", "Convert", lambda: self.convert(uid, client, cursor.get("convert"), end), end),
                ("spot", "Spot", lambda: self.spot(uid, client, cursor["spot"]), None),
                ("earn", "Simple Earn", lambda: self.earn(uid, client, cursor.get("earn"), end), (end // DAY) * DAY),
                ("dust", "Polvo a BNB", lambda: self.dust(uid, client), None),
            ]
            for key, label, run, mark in parts:
                try:
                    self._save(uid, run())
                    if mark is not None:
                        cursor[key] = mark
                except ImportError_ as e:  # una parte que falla no frena las demás
                    self.jobs[uid]["notes"].append(f"{label}: {e}")
            try:
                self._set(uid, step="Leyendo tus saldos para el cuadre")
                cursor["balances"], cursor["wallets"] = self.balances(client)
                cursor["balances_t"] = time.time()
            except ImportError_ as e:
                self.jobs[uid]["notes"].append(f"Saldos: {e}")
            # avisos que deben verse aunque se reinicie el servidor (el de P2P ya se muestra aparte)
            cursor["notes"] = [n for n in self.jobs[uid]["notes"] if not n.startswith("Binance solo entrega")]
            self._set(uid, state="done", step="Sincronizado", finished=time.time())
        except ImportError_ as e:
            error = str(e)
        except Exception as e:  # nunca dejar el estado colgado
            error = f"Error inesperado ({type(e).__name__})."
        finally:
            client.key = client.secret = ""
            client.s.headers.pop("X-MBX-APIKEY", None)
            if error:
                self._set(uid, state="error", step=error, finished=time.time())
            try:
                on_finish(uid, error is None, cursor, error)
            except Exception:
                pass

    def _save(self, uid, moves):
        lock = self.db.lock_until(uid)
        moves = list(moves)
        frozen = [m for m in moves if m["t"] <= lock]
        if frozen:
            moves = [m for m in moves if m["t"] > lock]
            j = self.jobs[uid]
            j["locked"] = j.get("locked", 0) + len(frozen)
            note = "Hay movimientos de Binance en periodos ya cerrados: no se agregaron. Reabre el cierre si faltaban."
            if note not in j["notes"]:
                j["notes"].append(note)
        n = self.db.add_movements(uid, moves, time.time())
        j = self.jobs[uid]
        j["found"] += len(moves)
        j["added"] += n
        j["skipped"] += len(moves) - n

    def _value(self, uid, asset, qty, t):
        try:
            return self.rates.cop(asset, qty, t)["cop"]
        except RateError as e:
            errs = self.jobs[uid]["errors"]
            if len(errs) < 20:
                errs.append(f"{datetime.fromtimestamp(t, CO_TZ):%Y-%m-%d} {asset}: {e}")
            return 0.0

    def exchange(self, uid, t, out_asset, out_qty, in_asset, in_qty, **extra):
        """Intercambio genérico: con pesos es compra o venta; entre cripto es permuta (art. 90 ET)."""
        if out_asset == "COP":
            return dict(t=t, kind="compra", out_asset="COP", out_qty=out_qty, in_asset=in_asset, in_qty=in_qty,
                        cop_value=out_qty, **extra)
        if in_asset == "COP":
            return dict(t=t, kind="venta", out_asset=out_asset, out_qty=out_qty, in_asset="COP", in_qty=in_qty,
                        cop_value=in_qty, **extra)
        # valor comercial: el lado estable si lo hay; si no, lo que se recibe
        if out_asset in STABLE:
            value = self._value(uid, out_asset, out_qty, t)
        elif in_asset in STABLE:
            value = self._value(uid, in_asset, in_qty, t)
        else:
            value = self._value(uid, in_asset, in_qty, t) or self._value(uid, out_asset, out_qty, t)
        return dict(t=t, kind="permuta", out_asset=out_asset, out_qty=out_qty, in_asset=in_asset, in_qty=in_qty,
                    cop_value=value, **extra)

    # ------------------------------------------------------------ P2P

    def p2p(self, uid, client, since, end, gmf):
        out = []
        oldest = end - P2P_API_DAYS * DAY
        if since is None:  # primera vez
            self.jobs[uid]["notes"].append(
                f"Binance solo entrega por API las órdenes P2P desde el {datetime.fromtimestamp(oldest, CO_TZ):%d/%m/%Y}. "
                "Las anteriores súbelas una vez con el archivo de Binance (P2P → Órdenes → Exportar).")
            since = oldest
        since = max(since - OVERLAP, oldest)
        for side in ("BUY", "SELL"):
            for a, b in windows(since, end):
                self._set(uid, step=f"P2P {'compras' if side == 'BUY' else 'ventas'}: {datetime.fromtimestamp(a, CO_TZ):%b %Y}")
                page = 1
                while True:
                    r = client.call("/sapi/v1/c2c/orderMatch/listUserOrderHistory", tradeType=side,
                                    startTimestamp=int(a * 1000), endTimestamp=int(b * 1000), page=page, rows=100)
                    if r.get("success") is False:
                        raise ImportError_(f"Binance P2P: {r.get('message') or r.get('code')}")
                    data = r.get("data") or []
                    for o in data:
                        m = self._p2p_order(o, gmf)
                        if m:
                            out.append(m)
                        elif o.get("orderStatus") == "COMPLETED":
                            self.jobs[uid]["skipped"] += 1
                    if len(data) < 100:
                        break
                    page += 1
                    time.sleep(0.3)
                time.sleep(0.3)
        return out

    @staticmethod
    def _p2p_order(o, gmf):
        if o.get("orderStatus") != "COMPLETED":
            return None
        role = o.get("advertisementRole")
        fee = o.get("commission") if role == "MAKER" else (o.get("takerCommission") or o.get("commission"))
        return p2p_move(o.get("orderNumber"), o.get("tradeType"), o.get("asset"), o.get("fiat"), o.get("amount"),
                        o.get("totalPrice"), fee, float(o["createTime"]) / 1000, o.get("counterPartNickName"), gmf,
                        o.get("payMethodName"))

    # ------------------------------------------------------------ Convert

    def convert(self, uid, client, since, end):
        out = []
        since = CONVERT_START if since is None else since - OVERLAP
        for a, b in windows(since, end):
            self._set(uid, step=f"Convert: {datetime.fromtimestamp(a, CO_TZ):%b %Y}")
            r = client.call("/sapi/v1/convert/tradeFlow", startTime=int(a * 1000), endTime=int(b * 1000), limit=1000)
            for o in r.get("list") or []:
                if o.get("orderStatus") != "SUCCESS":
                    continue
                fa, ta = o["fromAsset"].upper(), o["toAsset"].upper()
                if not ASSET_RE.match(fa) or not ASSET_RE.match(ta):
                    continue
                out.append(self.exchange(uid, float(o["createTime"]) / 1000, fa, float(o["fromAmount"]), ta,
                                         float(o["toAmount"]), gmf_cop=0.0, fee_cop=0.0, platform="Binance Convert",
                                         counterpart="", ext_id=f"convert:{o['orderId']}", source="binance", note=""))
            time.sleep(1.1)  # cada consulta pesa 3000 de 180.000 por minuto
        return out

    # ------------------------------------------------------------ Spot

    def spot(self, uid, client, last_ids):
        """Todo el historial de Spot; cada par sigue desde la última operación ya leída."""
        self._set(uid, step="Spot: buscando pares")
        info = client.call("/api/v3/exchangeInfo", signed=False)
        acct = client.call("/api/v3/account", omitZeroBalances="true")
        mine = {b["asset"] for b in acct.get("balances", []) if float(b["free"]) + float(b["locked"]) > 0}
        seen = {r["a"] for r in self.db.q("SELECT DISTINCT in_asset AS a FROM movements WHERE user_id=? AND in_asset IS NOT NULL "
                                          "UNION SELECT DISTINCT out_asset FROM movements WHERE user_id=? AND out_asset IS NOT NULL",
                                          (uid, uid))}
        assets = (mine | seen | set(MAIN)) - {"COP"}
        symbols = [s for s in info["symbols"] if s["baseAsset"] in assets and s["quoteAsset"] in assets]
        out = []
        for i, s in enumerate(symbols):
            self._set(uid, step=f"Spot: {s['symbol']} ({i + 1}/{len(symbols)})")
            from_id = last_ids.get(s["symbol"], -1) + 1
            while True:
                trades = client.call("/api/v3/myTrades", symbol=s["symbol"], fromId=from_id, limit=1000)
                moves = [m for tr in trades for m in self._spot_trade(uid, s, tr, float(tr["time"]) / 1000)]
                self._save(uid, moves)  # se guarda antes de mover el cursor: nada se pierde si se corta
                if trades:
                    last_ids[s["symbol"]] = trades[-1]["id"]
                if len(trades) < 1000:
                    break
                from_id = trades[-1]["id"] + 1
                time.sleep(0.5)
            time.sleep(0.25)  # myTrades pesa 20 de 6000 por minuto
        return out

    # ------------------------------------------------------------ Simple Earn (renta ordinaria)

    def earn(self, uid, client, since, end):
        """Rewards de Simple Earn sumados por día y moneda. Solo días ya cerrados (UTC), para que la suma no cambie."""
        day_end = (end // DAY) * DAY
        since = EARN_START if since is None else max(EARN_START, since - OVERLAP)
        since = (since // DAY) * DAY
        sums = {}
        sources = [("flexible", "/sapi/v1/simple-earn/flexible/history/rewardsRecord", t) for t in ("BONUS", "REALTIME", "REWARDS")]
        sources.append(("locked", "/sapi/v1/simple-earn/locked/history/rewardsRecord", None))
        for src, path, typ in sources:
            for a, b in windows(since, day_end, 30 * DAY):  # Binance rechaza rangos largos ("time range too large")
                self._set(uid, step=f"Simple Earn: {datetime.fromtimestamp(a, CO_TZ):%b %Y}")
                page = 1
                while True:
                    params = dict(startTime=int(a * 1000), endTime=int(b * 1000) - 1, current=page, size=100)
                    if typ:
                        params["type"] = typ
                    rows = client.call(path, **params).get("rows") or []
                    for x in rows:
                        t = float(x.get("time") or 0) / 1000
                        asset = str(x.get("asset") or "").upper()
                        amount = float(x.get("rewards") or x.get("amount") or 0)
                        if amount > 0 and t < day_end and ASSET_RE.match(asset):
                            k = (int(t // DAY) * DAY, asset, f"{src}-{typ or 'locked'}".lower())
                            sums[k] = sums.get(k, 0.0) + amount
                    if len(rows) < 100:
                        break
                    page += 1
                    time.sleep(1.6)
                time.sleep(1.6)  # cada consulta pesa 150
        out = []
        for (day, asset, kind), amount in sorted(sums.items()):
            t = day + 12 * 3600
            out.append(dict(t=t, kind="ingreso", out_asset=None, out_qty=None, in_asset=asset, in_qty=amount,
                            cop_value=self._value(uid, asset, amount, t), fee_cop=0.0, gmf_cop=0.0, platform="Binance Earn",
                            counterpart="", ext_id=f"earn:{kind}:{asset}:{datetime.fromtimestamp(day, timezone.utc):%Y-%m-%d}",
                            source="binance", note="Rewards de Simple Earn del día"))
        return out

    # ------------------------------------------------------------ polvo convertido a BNB (permuta)

    def dust(self, uid, client):
        self._set(uid, step="Conversiones de polvo a BNB")
        r = client.call("/sapi/v1/asset/dribblet")  # Binance guarda las últimas 100
        out = []
        for ev in r.get("userAssetDribblets") or []:
            for d in ev.get("userAssetDribbletDetails") or []:
                fa = str(d.get("fromAsset") or "").upper()
                amount, got = float(d.get("amount") or 0), float(d.get("transferedAmount") or 0)
                t = float(d.get("operateTime") or ev.get("operateTime") or 0) / 1000
                if amount > 0 and got > 0 and ASSET_RE.match(fa) and fa != "BNB":
                    out.append(self.exchange(uid, t, fa, amount, "BNB", got, fee_cop=0.0, gmf_cop=0.0,
                                             platform="Binance (polvo a BNB)", counterpart="",
                                             ext_id=f"dust:{d.get('transId') or ev.get('transId')}:{fa}", source="binance", note=""))
        return out

    # ------------------------------------------------------------ saldos reales (para el cuadre)

    def balances(self, client):
        """Lo que hay hoy en Binance: total por moneda y separado por billetera (Spot, Funding, Earn)."""
        bal, wallets = {}, {"spot": {}, "funding": {}, "earn": {}}
        where = ["spot"]

        def add(asset, q):
            asset = str(asset or "").upper()
            if q > 0 and ASSET_RE.match(asset):
                bal[asset] = bal.get(asset, 0.0) + q
                w = wallets[where[0]]
                w[asset] = w.get(asset, 0.0) + q

        for b in client.call("/api/v3/account", omitZeroBalances="true").get("balances", []):
            a = b["asset"]
            if a.startswith("LD") and len(a) > 4:  # Earn flexible visto desde Spot: se cuenta abajo
                continue
            add(a, float(b["free"]) + float(b["locked"]))
        where[0] = "funding"
        for f in client.call("/sapi/v1/asset/get-funding-asset", method="POST") or []:
            add(f["asset"], sum(float(f.get(k) or 0) for k in ("free", "locked", "freeze", "withdrawing")))
        where[0] = "earn"
        for path, field in (("/sapi/v1/simple-earn/flexible/position", "totalAmount"), ("/sapi/v1/simple-earn/locked/position", "amount")):
            page = 1
            while True:
                rows = client.call(path, current=page, size=100).get("rows") or []
                for x in rows:
                    add(x.get("asset"), float(x.get(field) or 0))
                if len(rows) < 100:
                    break
                page += 1
        return bal, wallets

    def _spot_trade(self, uid, s, tr, t):
        base, quote = s["baseAsset"], s["quoteAsset"]
        qty, quote_qty = float(tr["qty"]), float(tr["quoteQty"])
        fee, fee_asset = float(tr["commission"]), tr["commissionAsset"]
        if tr["isBuyer"]:
            out_a, out_q, in_a, in_q = quote, quote_qty, base, qty
        else:
            out_a, out_q, in_a, in_q = base, qty, quote, quote_qty
        extra = []
        fee_info = {}
        if fee > 0:
            if fee_asset == in_a:
                in_q -= fee  # la comisión llega descontada
                fee_info = dict(fee_qty=fee, fee_asset=fee_asset)
            elif fee_asset == out_a:
                out_q += fee
                fee_info = dict(fee_qty=fee, fee_asset=fee_asset)
            else:  # p. ej. pagada en BNB: es una salida aparte
                extra.append(dict(t=t, kind="comision", out_asset=fee_asset, out_qty=fee, in_asset=None, in_qty=None,
                                  cop_value=self._value(uid, fee_asset, fee, t), fee_cop=0.0, gmf_cop=0.0,
                                  platform="Binance Spot", counterpart="", ext_id=f"spotfee:{s['symbol']}:{tr['id']}",
                                  source="binance", note=f"Comisión {s['symbol']}"))
        m = self.exchange(uid, t, out_a, out_q, in_a, in_q, fee_cop=0.0, gmf_cop=0.0, platform="Binance Spot",
                          counterpart="", ext_id=f"spot:{s['symbol']}:{tr['id']}", source="binance", note="", **fee_info)
        return [m, *extra]


def p2p_move(order, side, asset, fiat, qty, total, fee_crypto, t, counterpart, gmf, pay_method=None):
    """Orden P2P completada en pesos → compra o venta. La comisión del anunciante se cobra en cripto."""
    asset = str(asset or "").strip().upper()
    if str(fiat or "").strip().upper() != "COP" or not ASSET_RE.match(asset) or not order:
        return None
    qty, total, fee = float(qty or 0), float(total or 0), float(fee_crypto or 0)
    if qty <= 0 or total <= 0:
        return None
    # La comisión llega en cripto: se registra en pesos al precio de la orden. En la compra pagas `total` por
    # (qty - fee) cripto: valor de la cripto + comisión = total. En la venta entregas qty + fee y te llega `total`.
    fee_cop = round(fee * total / qty, 2)
    common = dict(platform="Binance P2P", counterpart=str(counterpart or "")[:80], ext_id=f"p2p:{order}",
                  source="binance", note="", fee_cop=fee_cop, fee_qty=fee, fee_asset=asset if fee else "",
                  pay_method=str(pay_method or "").strip()[:40])
    if str(side).upper() in ("BUY", "COMPRA", "COMPRAR"):
        return dict(t=t, kind="compra", out_asset="COP", out_qty=total, in_asset=asset, in_qty=qty - fee,
                    cop_value=total - fee_cop, gmf_cop=round(total * GMF_RATE, 2) if gmf else 0.0, **common)
    return dict(t=t, kind="venta", out_asset=asset, out_qty=qty + fee, in_asset="COP", in_qty=total,
                cop_value=total + fee_cop, gmf_cop=0.0, **common)


# ------------------------------------------------------------ CSV

KINDS = ("compra", "venta", "permuta", "ingreso", "airdrop", "comision", "gasto", "aporte", "retiro")
GASTO_CATEGORIES = ("servicios", "bancarios", "honorarios", "otros")
COLUMNS = ["fecha", "tipo", "entrega_cripto", "entrega_cantidad", "recibe_cripto", "recibe_cantidad",
           "valor_cop", "comision_cop", "gmf_cop", "plataforma", "contraparte", "id_externo", "nota"]
ALIASES = {
    "fecha": ["fecha", "date", "time", "hora"],
    "tipo": ["tipo", "type", "kind"],
    "entrega_cripto": ["entrega_cripto", "sale_cripto", "out_asset"],
    "entrega_cantidad": ["entrega_cantidad", "sale_cantidad", "out_qty"],
    "recibe_cripto": ["recibe_cripto", "entra_cripto", "in_asset"],
    "recibe_cantidad": ["recibe_cantidad", "entra_cantidad", "in_qty"],
    "valor_cop": ["valor_cop", "valor", "pesos", "cop", "total_cop"],
    "comision_cop": ["comision_cop", "comision", "fee_cop"],
    "gmf_cop": ["gmf_cop", "gmf", "4x1000"],
    "plataforma": ["plataforma", "platform", "exchange"],
    "contraparte": ["contraparte", "counterpart"],
    "id_externo": ["id_externo", "id", "orden", "order", "ext_id"],
    "nota": ["nota", "note", "notas"],
    "categoria": ["categoria", "category"],
}
TEMPLATE_ROWS = [
    ["2025-03-01 10:30", "compra", "COP", "1000000", "USDT", "250", "1000000", "0", "4000", "Binance P2P", "", "", "Ejemplo: compra P2P"],
    ["2025-03-02 18:00", "venta", "USDT", "250", "COP", "1015000", "1015000", "0", "0", "Binance P2P", "", "", "Ejemplo: venta P2P"],
    ["2025-04-10 09:00", "permuta", "USDT", "100", "BTC", "0,0012", "410000", "0", "0", "Binance Spot", "", "", "Ejemplo: cambio USDT por BTC"],
    ["2025-05-01 00:00", "ingreso", "", "", "USDT", "1,5", "6000", "0", "0", "Binance Earn", "", "", "Ejemplo: intereses"],
]


def parse_number(v):
    """Acepta 1.234.567,89 · 1,234,567.89 · 1234567.89 · 1234567,89."""
    s = str(v or "").strip().replace("$", "").replace(" ", "").replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if s.count(",") == 1 else s.replace(",", "")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        raise ValueError(f"número inválido «{v}»")
    if n != n or n in (float("inf"), float("-inf")):
        raise ValueError(f"número inválido «{v}»")
    return n


def parse_date(v, tz=CO_TZ):
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=tz).timestamp()
        except ValueError:
            pass
    raise ValueError(f"fecha inválida «{v}» (usa AAAA-MM-DD HH:MM)")


P2P_LINE_STATUS = ("system cancelled", "completed", "cancelled", "appeal", "pending", "completada", "cancelada")


def is_p2p_statement(text):
    """El 'Historial de órdenes C2C' que Binance ahora entrega en PDF (o ese PDF pasado a texto/CSV)."""
    head = _norm(text[:3000])
    return "historial de ordenes c2c" in head or "c2c order history" in head


def read_p2p_statement(text, gmf=True):
    """Lee el historial P2P de Binance en PDF: una orden por línea
    'número tipo cripto fiat total precio cantidad [tipo de cambio] [comisiones] contraparte estado fecha hora'.
    Solo las completadas. Las horas vienen en la zona del encabezado ('Periodo(UTC--5)'); si no dice, Colombia."""
    m = re.search(r"UTC\s*([+-]+)\s*(\d{1,2})", text)
    tz = timezone(timedelta(hours=-int(m[2]) if "-" in m[1] else int(m[2]))) if m else CO_TZ
    moves, errors, seen = [], [], 0
    for n, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip().strip('"').strip()
        tok = line.split()
        if len(tok) < 11 or not re.fullmatch(r"\d{12,}", tok[0]) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", tok[-2]):
            continue
        seen += 1
        # estado: puede ser de dos palabras ("System cancelled")
        two, one = _norm(" ".join(tok[-4:-2])), _norm(tok[-3])
        status, cut = (two, 4) if two in P2P_LINE_STATUS else (one, 3)
        if status not in COMPLETED:
            continue
        try:
            order, side_txt, asset, fiat = tok[0], _norm(tok[1]), tok[2].upper(), tok[3].upper()
            side = "BUY" if side_txt in ("buy", "compra", "comprar") else "SELL" if side_txt in ("sell", "venta", "vender") else None
            if not side:
                raise ValueError(f"tipo de orden «{tok[1]}»")
            counterpart = tok[-cut - 1]
            nums = [parse_number(x) for x in tok[4:-cut - 1]]
            if len(nums) < 3 or any(x is None for x in nums):
                raise ValueError("no pude leer los valores de la orden")
            total, qty, extra = nums[0], nums[2], nums[3:]
            # lo que sigue a la cantidad: [tipo de cambio] y las comisiones (del creador / del tomador)
            if len(extra) >= 2 and extra[0] > 50:
                extra = extra[1:]  # el primero era el tipo de cambio
            fee = sum(extra)
            t = datetime.strptime(f"{tok[-2]} {tok[-1]}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz).timestamp()
            mv = p2p_move(order, side, asset, fiat, qty, total, fee, t, counterpart, gmf)
            if mv:
                moves.append((n, mv))
        except ValueError as e:
            errors.append(f"Orden {tok[0]}: {e}")
    if not seen:
        errors.append("No encontré órdenes en el historial de Binance. ¿Es el archivo de P2P → Órdenes → Exportar?")
    return moves, errors, 0


def read_csv(text, gmf=True):
    """Devuelve (movimientos sin validar, errores, filas de ejemplo ignoradas). Detecta ; o , como separador.
    Reconoce la plantilla propia y el archivo de órdenes P2P que se descarga en Binance."""
    text = text.lstrip("﻿")
    if is_p2p_statement(text):
        return read_p2p_statement(text, gmf)
    first = text.split("\n", 1)[0]
    delim = ";" if first.count(";") >= first.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        return [], ["El archivo está vacío."], 0
    if is_p2p_file(rows[0]):
        return read_p2p_file(rows, gmf)
    head = [h.strip().lower().replace(" ", "_") for h in rows[0]]
    idx = {}
    for col, names in ALIASES.items():
        for n in names:
            if n in head:
                idx[col] = head.index(n)
                break
    missing = [c for c in ("fecha", "tipo") if c not in idx]
    if missing:
        return [], [f"Faltan columnas: {', '.join(missing)}. Descarga la plantilla para ver el formato."], 0
    moves, errors, examples = [], [], 0
    for n, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        get = lambda c: row[idx[c]].strip() if c in idx and idx[c] < len(row) else ""
        if get("nota").lower().startswith("ejemplo"):
            examples += 1
            continue
        try:
            kind = get("tipo").lower().replace("ó", "o").replace("í", "i")
            kind = {"comisión": "comision", "staking": "ingreso", "mineria": "ingreso", "earn": "ingreso"}.get(kind, kind)
            if kind not in KINDS:
                raise ValueError(f"tipo «{get('tipo')}» (usa {', '.join(KINDS)})")
            m = {"t": parse_date(get("fecha")), "kind": kind,
                 "out_asset": get("entrega_cripto").upper() or None, "out_qty": parse_number(get("entrega_cantidad")),
                 "in_asset": get("recibe_cripto").upper() or None, "in_qty": parse_number(get("recibe_cantidad")),
                 "cop_value": parse_number(get("valor_cop")), "fee_cop": parse_number(get("comision_cop")) or 0.0,
                 "gmf_cop": parse_number(get("gmf_cop")) or 0.0, "platform": get("plataforma")[:60],
                 "counterpart": get("contraparte")[:80], "note": get("nota")[:300], "source": "csv",
                 "category": get("categoria").lower()[:20]}
            # sin id: la huella de la fila evita duplicar si se importa dos veces el mismo archivo
            ext = get("id_externo") or hashlib.sha256("|".join(c.strip() for c in row).encode()).hexdigest()[:24]
            m["ext_id"] = f"csv:{ext[:100]}"
            moves.append((n, m))
        except ValueError as e:
            errors.append(f"Fila {n}: {e}")
        if len(errors) >= 50:
            errors.append("Demasiados errores: se detuvo la lectura.")
            break
    return moves, errors, examples


# ------------------------------------------------------------ archivo P2P de Binance (P2P → Órdenes → Exportar)

def _norm(h):
    h = unicodedata.normalize("NFKD", str(h)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", h).strip()


P2P_COLUMNS = {
    "order": ["order number", "order no", "order id", "numero de orden", "no de orden", "n de orden", "id de orden", "numero de pedido"],
    "side": ["order type", "trade type", "tipo de orden", "tipo de operacion", "tipo"],
    "asset": ["asset type", "asset", "coin", "crypto", "tipo de activo", "activo", "cripto", "criptomoneda"],
    "fiat": ["fiat type", "fiat", "tipo de fiat", "moneda fiat", "moneda fiduciaria", "fiduciaria"],
    "total": ["total price", "total amount", "precio total", "importe total", "monto total", "total"],
    "qty": ["quantity", "amount", "cantidad"],
    "maker_fee": ["maker fee", "comision del creador", "comision de creador", "tarifa de creador", "tarifa del creador"],
    "taker_fee": ["taker fee", "comision del tomador", "tarifa de tomador", "tarifa del tomador"],
    "counterpart": ["couterparty", "counterparty", "contraparte"],
    "pay": ["payment method", "pay method", "payment", "metodo de pago", "medio de pago", "forma de pago"],
    "status": ["status", "order status", "estado", "estado de la orden"],
    "time": ["created time", "create time", "creation time", "hora de creacion", "fecha de creacion", "tiempo de creacion", "time", "date", "fecha"],
}
COMPLETED = {"completed", "complete", "completada", "completado", "finalizada", "finalizado"}


def _p2p_index(header):
    head = [_norm(h) for h in header]
    idx = {}
    for col, names in P2P_COLUMNS.items():
        for n in names:
            if n in head:
                idx[col] = head.index(n)
                break
    return idx


def is_p2p_file(header):
    idx = _p2p_index(header)
    return all(c in idx for c in ("order", "total", "qty", "side"))


def read_p2p_file(rows, gmf):
    """Las horas del archivo de Binance vienen en UTC."""
    idx = _p2p_index(rows[0])
    missing = [c for c in ("asset", "fiat", "status", "time") if c not in idx]
    if missing:
        return [], [f"Archivo P2P de Binance sin las columnas: {', '.join(missing)}. Encabezados: {'; '.join(rows[0])}"], 0
    moves, errors = [], []
    for n, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        get = lambda c: row[idx[c]].strip() if c in idx and idx[c] < len(row) else ""
        if _norm(get("status")) not in COMPLETED:
            continue
        try:
            order = get("order")
            if not order.isdigit():
                raise ValueError(f"número de orden «{order}» dañado (no abras el archivo en Excel antes de subirlo)")
            side = _norm(get("side"))
            side = "BUY" if side in ("buy", "compra", "comprar") else "SELL" if side in ("sell", "venta", "vender") else None
            if not side:
                raise ValueError(f"tipo de orden «{get('side')}»")
            fee = (parse_number(get("maker_fee")) or 0) + (parse_number(get("taker_fee")) or 0)
            m = p2p_move(order, side, get("asset"), get("fiat"), parse_number(get("qty")), parse_number(get("total")),
                         fee, parse_date(get("time"), timezone.utc), get("counterpart"), gmf, get("pay"))
            if m:
                moves.append((n, m))
        except ValueError as e:
            errors.append(f"Fila {n}: {e}")
        if len(errors) >= 50:
            errors.append("Demasiados errores: se detuvo la lectura.")
            break
    return moves, errors, 0
