"""Datos de Binance (spot y P2P), busqueda de oportunidades y lectura de la cuenta."""
import hashlib
import hmac
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

import requests

API = "https://api.binance.com"  # cuentas (llaves de cada usuario)
# precios publicos: el espejo oficial de Binance solo de datos de mercado, sin bloqueo por pais (evita el HTTP 451)
MARKET = "https://data-api.binance.vision"
P2P = "https://p2p.binance.com/bapi/c2c/v2"

_local = threading.local()

# Estimaciones conservadoras: lo que de verdad pasa al operar, no el caso perfecto
SPOT_SLIPPAGE = 0.001  # colchon por cambio en Spot: el precio se mueve mientras haces la orden
LOT = {}  # simbolo -> (moneda base, paso minimo de cantidad): Binance redondea hacia abajo y deja saldo suelto


class BinanceError(Exception):
    pass


def http():
    """Una sesion HTTP por hilo (requests.Session no es segura entre hilos)."""
    s = getattr(_local, "session", None)
    if s is None:
        s = _local.session = requests.Session()
        s.headers["User-Agent"] = "Mozilla/5.0 (arb-panel local)"
    return s


def _json(r):
    try:
        data = r.json()
    except ValueError:
        raise BinanceError(f"respuesta invalida de Binance (HTTP {r.status_code})")
    if not r.ok:
        msg = (data.get("msg") or data.get("message")) if isinstance(data, dict) else None
        raise BinanceError(f"{msg or r.text[:200]} (HTTP {r.status_code})")
    return data


# ---------------------------------------------------------------- spot

def load_pairs():
    r = http().get(f"{MARKET}/api/v3/exchangeInfo",
                   params={"symbolStatus": "TRADING", "showPermissionSets": "false"}, timeout=30)
    symbols = _json(r)["symbols"]
    for s in symbols:
        step = next((float(f["stepSize"]) for f in s.get("filters", []) if f["filterType"] == "LOT_SIZE"), 0.0)
        LOT[s["symbol"]] = (s["baseAsset"], step)
    return {s["symbol"]: (s["baseAsset"], s["quoteAsset"]) for s in symbols}


def floor_step(qty, step):
    return math.floor(qty / step + 1e-9) * step if step else qty


def spot_detail(graph, a, c, qty, fee):
    """Lo que de verdad recibes al cambiar `qty` de `a` por `c` con orden de mercado en Spot, y en que se va
    la diferencia (en unidades de `c`): comision, redondeo de Binance (sobrante suelto) y colchon por movimiento."""
    if a == c:
        return qty, {"spot_fee": 0.0, "rounding": 0.0, "buffer": 0.0}
    edge = graph.get(a, {}).get(c)
    if not edge:
        return None, None
    rate, _, symbol = edge
    base, step = LOT.get(symbol, (None, 0.0))
    ideal = qty * rate
    if base == a:  # vendes la base: solo se vende la cantidad redondeada
        out = floor_step(qty, step) * rate
    else:  # compras la base: te llega redondeada hacia abajo
        out = floor_step(qty * rate, step)
    after_fee = out * (1 - fee)
    final = after_fee * (1 - SPOT_SLIPPAGE)
    return final, {"spot_fee": out - after_fee, "rounding": ideal - out, "buffer": after_fee - final}


def spot_fill(graph, a, c, qty, fee):
    return spot_detail(graph, a, c, qty, fee)[0]


def fetch_book():
    """Mejor compra y venta de todos los pares: {simbolo: (bid, bid_qty, ask, ask_qty)}."""
    return {d["symbol"]: (float(d["bidPrice"]), float(d["bidQty"]), float(d["askPrice"]), float(d["askQty"]))
            for d in _json(http().get(f"{MARKET}/api/v3/ticker/bookTicker", timeout=10))}


def build_graph(pairs, book):
    """graph[a][c] = (cuanto c recibes por 1 a, capacidad del libro en unidades de a, simbolo)."""
    graph = {}
    for symbol, (bid, bid_qty, ask, ask_qty) in book.items():
        pair = pairs.get(symbol)
        if not pair or bid <= 0 or ask <= 0:
            continue
        base, quote = pair
        graph.setdefault(base, {})[quote] = (bid, bid_qty, symbol)
        graph.setdefault(quote, {})[base] = (1 / ask, ask_qty * ask, symbol)
    return graph


def load_graph(pairs):
    return build_graph(pairs, fetch_book())


# ---------------------------------------------------------------- precio real segun el monto (profundidad del libro)

def depth(symbol, limit=20):
    d = _json(http().get(f"{MARKET}/api/v3/depth", params={"symbol": symbol, "limit": limit}, timeout=10))
    return ([(float(p), float(q)) for p, q in d["bids"]], [(float(p), float(q)) for p, q in d["asks"]])


def walk(amount, src, pair, book, fee):
    """Convierte `amount` de `src` recorriendo el libro nivel por nivel, como una orden a mercado.
    Devuelve lo recibido (ya con comision) o None si el libro no alcanza para ese monto."""
    base, _quote = pair
    bids, asks = book
    left, out = amount, 0.0
    if src == base:  # vendes la moneda base: te pagan los compradores (bids)
        for price, qty in bids:
            take = min(left, qty)
            out += take * price
            left -= take
            if left <= 1e-12:
                break
    else:  # compras la moneda base con la de cotizacion: le compras a los vendedores (asks)
        for price, qty in asks:
            spend = min(left, qty * price)
            out += spend / price
            left -= spend
            if left <= 1e-12:
                break
    if left > 1e-9 * max(1.0, amount):
        return None
    return out * (1 - fee)


def real_triangle_profit(tri, pairs, amount, fee_for, depth_fn=depth):
    """Ganancia real del triangulo para `amount` (en la moneda inicial) usando la profundidad del libro."""
    x = amount
    for i, symbol in enumerate(tri["symbols"]):
        src = tri["path"][i]
        base, step = LOT.get(symbol, (None, 0.0))
        if base == src:
            x = floor_step(x, step)
        x = walk(x, src, pairs[symbol], depth_fn(symbol), fee_for(symbol))
        if x is None:
            return None
        if base != src:
            x = floor_step(x / (1 - fee_for(symbol)), step) * (1 - fee_for(symbol))
        x *= 1 - SPOT_SLIPPAGE
    return x / amount - 1


def convert(graph, a, c, fee=0.0):
    if a == c:
        return 1.0
    edge = graph.get(a, {}).get(c)
    return edge[0] * (1 - fee) if edge else None


def usdt_value(graph, asset, qty):
    # Los saldos de Simple Earn llegan como LDBTC, LDUSDT...
    for a in (asset, asset[2:] if asset.startswith("LD") else None):
        if not a:
            continue
        rate = convert(graph, a, "USDT") or (
            (convert(graph, a, "BTC") or 0) * (convert(graph, "BTC", "USDT") or 0))
        if rate:
            return qty * rate
    return None


def triangles(graph, bases, fee, min_liquidity, allowed=None, limit=40):
    """Ciclos base -> X -> Y -> base. Cada ciclo se cuenta una sola vez sin importar donde empiece.
    Con `allowed`, solo usa esas monedas (las principales, con buena liquidez)."""
    seen, found, evaluated = set(), [], 0
    for s in bases:
        to_usdt = convert(graph, s, "USDT")
        if not to_usdt:
            continue
        for x, e1 in graph.get(s, {}).items():
            if allowed and x not in allowed:
                continue
            for y, e2 in graph.get(x, {}).items():
                e3 = graph.get(y, {}).get(s)
                if y == s or not e3 or (allowed and y not in allowed):
                    continue
                cycle = (s, x, y)
                i = cycle.index(min(cycle))
                key = cycle[i:] + cycle[:i]
                if key in seen:
                    continue
                seen.add(key)
                evaluated += 1
                gross = e1[0] * e2[0] * e3[0]
                # Maximo que aguanta el primer nivel del libro en las 3 patas, en USDT
                liquidity = min(e1[1], e2[1] / e1[0], e3[1] / (e1[0] * e2[0])) * to_usdt
                if liquidity < min_liquidity:
                    continue
                found.append({"path": [s, x, y, s], "symbols": [e1[2], e2[2], e3[2]],
                              "gross": gross - 1, "profit": gross * ((1 - fee) * (1 - SPOT_SLIPPAGE)) ** 3 - 1,
                              "liquidity": liquidity, "to_usdt": to_usdt})
    found.sort(key=lambda t: -t["profit"])
    return {"top": found[:limit], "evaluated": evaluated, "liquid": len(found),
            "profitable": sum(t["profit"] > 0 for t in found)}


# ---------------------------------------------------------------- P2P

def _ad(a):
    adv, user = a["adv"], a["advertiser"]
    return {
        "price": float(adv["price"]),
        "min": float(adv.get("minSingleTransAmount") or 0),
        "max": float(adv.get("dynamicMaxSingleTransAmount") or adv.get("maxSingleTransAmount") or 0),
        "available": float(adv.get("tradableQuantity") or adv.get("surplusAmount") or 0),
        "methods": [m.get("tradeMethodName") or m.get("identifier") for m in adv.get("tradeMethods") or []],
        "nick": user.get("nickName") or "?",
        "user": user.get("userNo"),
        "orders": user.get("monthOrderCount") or 0,
        "finish": user.get("monthFinishRate") or 0,
        "merchant": user.get("userType") == "merchant",
        "minutes": adv.get("payTimeLimit"),
    }


def p2p_search(asset, side, fiat, amount=0, pay_types=(), merchant=False):
    """side=BUY: anuncios donde tu compras (precio que pagas). SELL: donde tu vendes."""
    body = {"asset": asset, "fiat": fiat, "tradeType": side, "page": 1, "rows": 20,
            "payTypes": list(pay_types), "publisherType": "merchant" if merchant else None}
    if amount:
        body["transAmount"] = str(int(amount))
    data = _json(http().post(f"{P2P}/friendly/c2c/adv/search", json=body, timeout=15))
    if data.get("code") not in (None, "000000"):
        raise BinanceError(data.get("message") or data.get("code"))
    return [_ad(a) for a in data.get("data") or []]


def p2p_pay_methods(fiat):
    r = http().post(f"{P2P}/public/c2c/adv/filter-conditions", json={"fiat": fiat}, timeout=15)
    methods = (_json(r).get("data") or {}).get("tradeMethods") or []
    return [{"id": m["identifier"], "name": m.get("tradeMethodName") or m["identifier"]} for m in methods]


def p2p_market(assets, fiat, amount, pay_types, merchant, min_orders, min_finish):
    def run(job):
        asset, side = job
        try:
            ads = p2p_search(asset, side, fiat, amount, pay_types, merchant)
            ok = [a for a in ads if a["orders"] >= min_orders and a["finish"] >= min_finish]
            return job, ok, ads[0]["price"] if ads else None, None
        except (requests.RequestException, BinanceError) as e:
            return job, [], None, f"{asset} {side}: {e}"

    market = {a: {"BUY": [], "SELL": [], "top": {}} for a in assets}
    errors = []
    with ThreadPoolExecutor(8) as pool:
        for (asset, side), ads, top, err in pool.map(run, [(a, s) for a in assets for s in ("BUY", "SELL")]):
            market[asset][side] = ads
            market[asset]["top"][side] = top
            if err:
                errors.append(err)
    return market, errors


def after_gmf(gain, gmf):
    """El 4x1000 se cobra solo sobre la ganancia que llega a tu banco (Nequi); el capital va y vuelve sin cobro por los topes exentos."""
    return gain - gmf * gain if gain > 0 else gain


def _fits(ad, fiat_amount, crypto_qty):
    """El anuncio acepta este monto en pesos y tiene suficiente cripto disponible."""
    return ad["min"] <= fiat_amount <= ad["max"] and (not ad["available"] or ad["available"] >= crypto_qty)


def p2p_routes(market, graph, fee, gmf, capital, fiat, p2p_fee=0.0):
    """Arbitraje que se puede hacer ya, tomando anuncios existentes:
    pesos -> X (compra P2P) -> [X a Y en Spot] -> Y (venta P2P) -> pesos, para todas las criptos X, Y.
    Cada paso usa el mejor anuncio que acepta el monto real; descuenta comision Spot y 4x1000 sobre la ganancia."""
    def buy_ad(asset):
        return next((a for a in market.get(asset, {}).get("BUY") or [] if _fits(a, capital, capital / a["price"])), None)

    def sell_ad(asset, qty):
        return next((a for a in market.get(asset, {}).get("SELL") or [] if _fits(a, qty * a["price"], qty)), None)

    def p2p_step(kind, asset, ad, qty):
        return {"venue": "P2P", "kind": kind, "asset": asset, "label": f"{'Comprar' if kind == 'buy' else 'Vender'} {asset}",
                "price": ad["price"], "unit": fiat, "ad": ad, "qty": qty}

    def spot_step(a, c, rate, qty):
        edge = graph[a][c]
        return {"venue": "Spot", "kind": "convert", "from": a, "to": c, "label": f"{a} → {c}",
                "price": edge[0], "unit": c, "symbol": edge[2], "rate": rate, "qty": qty}

    routes = []
    for x in market:
        bx = buy_ad(x)
        if not bx:
            continue
        qty_x = capital / bx["price"] * (1 - p2p_fee)  # si Binance cobra en P2P, te llega menos cripto
        for y in market:
            qty_y, lost = spot_detail(graph, x, y, qty_x, fee)
            if not qty_y or (y != x and graph[x][y][1] < qty_x):
                continue  # sin par directo, o el primer nivel del libro no aguanta tu monto
            rate = qty_y / qty_x
            sy = sell_ad(y, qty_y)
            if not sy:
                continue
            steps = [p2p_step("buy", x, bx, qty_x)]
            if y != x:
                steps.append(spot_step(x, y, rate, qty_y))
            steps.append(p2p_step("sell", y, sy, qty_y))
            received = qty_y * sy["price"] * (1 - p2p_fee)
            gain = after_gmf(received - capital, gmf)
            # en que se van los pesos: cada costo valorado al precio de venta
            costs = {k: v * sy["price"] for k, v in lost.items()}
            costs["p2p_fee"] = capital * p2p_fee + qty_y * sy["price"] * p2p_fee
            costs["gmf"] = (received - capital) - gain
            routes.append({"id": f"{x}>{y}", "steps": steps, "received": received, "paid": capital, "costs": costs,
                           "profit_fiat": gain, "profit": gain / capital})
    routes.sort(key=lambda t: -t["profit"])
    return routes


def usdt_conversions(market, graph, fee, gmf, capital):
    """Si ya tienes dolares (USDT) o los quieres comprar: ¿conviene hacerlo directo en P2P
    o pasando por otra cripto en Spot? Todo en pesos por dolar, con comisiones (aqui no hay ganancia, no aplica 4x1000)."""
    def first(asset, side, fiat_amount, qty_of):
        for a in market.get(asset, {}).get(side) or []:
            if _fits(a, fiat_amount(a), qty_of(a)):
                return a
        return None

    usdt_buy = (market.get("USDT", {}).get("BUY") or [None])[0]
    ref = usdt_buy["price"] if usdt_buy else None
    if not ref:
        return {"sell": [], "buy": []}
    usd = capital / ref  # dolares equivalentes a tu capital

    sell = []  # vender dolares: USDT -> (Spot) -> X -> pesos en P2P
    for x in market:
        qty = spot_fill(graph, "USDT", x, usd, fee)
        if not qty or (x != "USDT" and graph["USDT"][x][1] < usd):
            continue
        rate = qty / usd
        ad = first(x, "SELL", lambda a: qty * a["price"], lambda a: qty)
        if ad:
            sell.append({"asset": x, "per_usd": rate * ad["price"], "ad": ad,
                         "symbol": graph["USDT"][x][2] if x != "USDT" else None})

    buy = []  # comprar dolares: pesos -> X en P2P -> (Spot) -> USDT
    for x in market:
        ad = first(x, "BUY", lambda a: capital, lambda a: capital / a["price"])
        got = spot_fill(graph, x, "USDT", capital / ad["price"], fee) if ad else None
        if got:
            rate = got / (capital / ad["price"])
            buy.append({"asset": x, "per_usd": ad["price"] / rate, "ad": ad,
                        "symbol": graph[x]["USDT"][2] if x != "USDT" else None})

    direct_sell = next((r["per_usd"] for r in sell if r["asset"] == "USDT"), None)
    direct_buy = next((r["per_usd"] for r in buy if r["asset"] == "USDT"), None)
    for r in sell:
        r["vs_direct"] = r["per_usd"] - direct_sell if direct_sell else None
    for r in buy:
        r["vs_direct"] = direct_buy - r["per_usd"] if direct_buy else None  # positivo = te sale mas barato
    sell.sort(key=lambda r: -r["per_usd"])
    buy.sort(key=lambda r: r["per_usd"])
    return {"sell": sell, "buy": buy}


# ---------------------------------------------------------------- ¿donde vendo lo que tengo?

def _search_retry(asset, fiat, amount):
    for i in range(5):  # si Binance pide esperar, se reintenta
        try:
            return p2p_search(asset, "SELL", fiat, amount)
        except BinanceError as e:
            if "429" not in str(e) or i == 4:
                raise
            time.sleep(1 + i)


def exit_options(asset, qty, graph, fee, fiat, targets, usd_fiat, min_orders, min_finish):
    """Todas las formas de pasar `qty` de `asset` a pesos: vender directo en P2P o cambiar antes en Spot
    (directo o pasando por USDT) y vender esa. Cada opcion usa el mejor comprador real que acepta el monto
    y dice cuanto darian si ese comprador desaparece (el siguiente que acepta)."""
    options, errors = [], []
    for y in targets:
        path = [asset] if y == asset else [asset, y]
        got = spot_fill(graph, asset, y, qty, fee)
        if not got and "USDT" not in (asset, y):
            mid = spot_fill(graph, asset, "USDT", qty, fee)
            got = spot_fill(graph, "USDT", y, mid, fee) if mid else None
            path = [asset, "USDT", y]
        if not got:
            continue
        to_usdt = usdt_value(graph, y, got)
        approx = to_usdt * usd_fiat if to_usdt and usd_fiat else 0
        try:
            ads = [a for a in _search_retry(y, fiat, approx) if a["orders"] >= min_orders and a["finish"] >= min_finish]
        except (requests.RequestException, BinanceError):
            errors.append(y)
            continue
        ok = [a for a in ads if _fits(a, got * a["price"], got)]
        if not ok:
            continue
        best = ok[0]
        backup = next((a for a in ok[1:] if a["user"] != best["user"]), None)
        hops = []  # cada cambio en Spot con su par, para enlazar directo a Binance
        for a, c in zip(path, path[1:]):
            sym = graph[a][c][2]
            base = LOT.get(sym, (a, 0))[0]
            hops.append({"from": a, "to": c, "symbol": sym, "pair": [base, c if base == a else a]})
        options.append({"to": y, "path": path, "qty": got, "ad": best, "received": got * best["price"], "hops": hops,
                        "backup": {"ad": backup, "received": got * backup["price"]} if backup else None})
    options.sort(key=lambda o: -o["received"])
    return options, errors


# ---------------------------------------------------------------- cuenta (solo lectura)

class Account:
    def __init__(self, key, secret):
        self.key, self.secret = key.strip(), secret.strip()
        self._offset, self._synced = 0, 0.0

    def hint(self):
        return f"{self.key[:6]}…{self.key[-4:]}"

    def _timestamp(self):
        # Usa la hora del servidor de Binance para evitar el error -1021 si el reloj del PC esta corrido
        if time.time() - self._synced > 600:
            server = _json(http().get(f"{MARKET}/api/v3/time", timeout=10))["serverTime"]
            self._offset, self._synced = server - int(time.time() * 1000), time.time()
        return int(time.time() * 1000) + self._offset

    def call(self, method, path, **params):
        params.update(recvWindow=10000, timestamp=self._timestamp())
        query = urlencode(params)
        sig = hmac.new(self.secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        return _json(http().request(method, f"{API}{path}?{query}&signature={sig}",
                                    headers={"X-MBX-APIKEY": self.key}, timeout=15))

    def permissions(self):
        return self.call("GET", "/sapi/v1/account/apiRestrictions")

    def symbol_fee(self, symbol, default):
        """Comision real de un par (algunos tienen 0 % por promocion). Se guarda 1 hora."""
        cache = self.__dict__.setdefault("_fees", {})
        hit = cache.get(symbol)
        if hit and time.time() - hit[1] < 3600:
            return hit[0]
        try:
            res = self.call("GET", "/api/v3/account/commission", symbol=symbol)
            fee = sum(float((res.get(k) or {}).get("taker", 0)) for k in ("standardCommission", "taxCommission", "specialCommission"))
        except (BinanceError, requests.RequestException):
            fee = default
        cache[symbol] = (fee, time.time())
        return fee

    def snapshot(self):
        perms = self.permissions()
        acc = self.call("GET", "/api/v3/account", omitZeroBalances="true")
        spot = {b["asset"]: float(b["free"]) + float(b["locked"]) for b in acc["balances"]}
        notes = []
        try:
            funding = {f["asset"]: float(f["free"]) + float(f["locked"]) + float(f.get("freeze") or 0)
                       for f in self.call("POST", "/sapi/v1/asset/get-funding-asset")}
        except BinanceError as e:
            funding = {}
            notes.append(f"Billetera de fondos no disponible: {e}")
        orders = []
        for side in ("BUY", "SELL"):
            try:
                res = self.call("GET", "/sapi/v1/c2c/orderMatch/listUserOrderHistory", tradeType=side, rows=30)
            except BinanceError as e:
                notes.append(f"Historial P2P no disponible: {e}")
                break
            for o in res.get("data") or []:
                orders.append({"id": o.get("orderNumber"), "side": o.get("tradeType"), "asset": o.get("asset"),
                               "fiat": o.get("fiat"), "amount": float(o.get("amount") or 0),
                               "price": float(o.get("unitPrice") or 0), "total": float(o.get("totalPrice") or 0),
                               "status": o.get("orderStatus"), "time": int(o.get("createTime") or 0),
                               "counterpart": o.get("counterPartNickName"),
                               "commission": float(o.get("commission") or 0)})
        orders.sort(key=lambda o: -o["time"])
        rates = acc.get("commissionRates") or {}
        return {
            "uid": acc.get("uid"),
            "maker": float(rates.get("maker", 0.001)),
            "taker": float(rates.get("taker", 0.001)),
            "permissions": {"reading": perms.get("enableReading", False),
                            "trading": perms.get("enableSpotAndMarginTrading", False),
                            "withdrawals": perms.get("enableWithdrawals", False),
                            "ip_restricted": perms.get("ipRestrict", False)},
            "spot": spot,
            "funding": funding,
            "orders": orders[:30],
            "notes": notes,
        }
