import hashlib
import hmac
import os
import time
from urllib.parse import urlencode

import requests

API = "https://api.binance.com"
SPOT = API + "/api/v3/ticker/bookTicker"
P2P = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
FEE = 0.001
GMF = 0.004
FIAT = "COP"
ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"]
MIN_PROFIT = 0.002
ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def load_env(path=ENV):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        k, _, v = line.strip().partition("=")
        if k and not k.startswith("#") and v.strip():
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def signed(path, **params):
    key, secret = os.environ["BINANCE_API_KEY"], os.environ["BINANCE_API_SECRET"]
    server = requests.get(API + "/api/v3/time", timeout=10).json()["serverTime"]
    params.update(recvWindow=10000, timestamp=server)
    q = urlencode(params)
    sig = hmac.new(secret.encode(), q.encode(), hashlib.sha256).hexdigest()
    r = requests.get(f"{API}{path}?{q}&signature={sig}",
                     headers={"X-MBX-APIKEY": key}, timeout=10)
    if not r.ok:
        raise RuntimeError(f"Binance {r.status_code}: {r.text}")
    return r.json()


def account():
    acc = signed("/api/v3/account", omitZeroBalances="true")
    bal = {x["asset"]: float(x["free"]) + float(x["locked"]) for x in acc["balances"]}
    return float(acc["commissionRates"]["taker"]), {a: q for a, q in bal.items() if q > 0}


def book():
    data = requests.get(SPOT, timeout=10).json()
    return {d["symbol"]: (float(d["bidPrice"]), float(d["askPrice"]))
            for d in data if float(d["bidPrice"]) > 0}


def rate(b, a, c):
    if a == c:
        return 1.0
    if a + c in b:
        return b[a + c][0] * (1 - FEE)
    if c + a in b:
        return (1 / b[c + a][1]) * (1 - FEE)
    return None


def p2p_best(trade_type, asset):
    body = {"asset": asset, "fiat": FIAT, "tradeType": trade_type,
            "page": 1, "rows": 5, "payTypes": [], "publisherType": None}
    try:
        ads = requests.post(P2P, json=body, timeout=10).json()["data"]
        return float(ads[0]["adv"]["price"]) if ads else None
    except Exception:
        return None


def triangles(b):
    out = []
    for x in ASSETS[1:]:
        for y in ASSETS[1:]:
            if x == y:
                continue
            r1, r2, r3 = rate(b, "USDT", x), rate(b, x, y), rate(b, y, "USDT")
            if r1 and r2 and r3:
                g = r1 * r2 * r3 - 1
                if g > MIN_PROFIT:
                    out.append((f"USDT>{x}>{y}>USDT", g))
    return out


def p2p_routes(b):
    sell_usdt = p2p_best("SELL", "USDT")
    if not sell_usdt:
        return []
    out = []
    for x in ASSETS:
        buy_x = p2p_best("BUY", x)
        r = rate(b, x, "USDT")
        if buy_x and r:
            g = (1 / buy_x) * r * sell_usdt * (1 - GMF) - 1
            out.append((f"{FIAT}>{x}(P2P)>USDT(spot)>{FIAT}(P2P)", g))
    return sorted(out, key=lambda t: -t[1])


if __name__ == "__main__":
    load_env()
    if os.getenv("BINANCE_API_KEY") and os.getenv("BINANCE_API_SECRET"):
        try:
            if signed("/sapi/v1/account/apiRestrictions").get("enableWithdrawals"):
                print("!! Tu API key tiene RETIROS habilitados. Desactivalos en Binance.")
            FEE, bal = account()
        except RuntimeError as e:
            raise SystemExit(f"No se pudo conectar la cuenta: {e}")
        b = book()
        print(f"Cuenta conectada. Comision taker real: {FEE:.3%}")
        for a, q in sorted(bal.items()):
            print(f"  {a:<8} {q:.8f}  ~ {q * (rate(b, a, 'USDT') or 0):.2f} USDT")
    else:
        print(f"Modo publico (sin API key), comision supuesta {FEE:.3%}. Llaves en: {ENV}")
    print("-" * 40)
    while True:
        try:
            b = book()
            tri = triangles(b)
            for name, g in tri:
                print(f"[SPOT] {name}: {g:.3%}")
            if not tri:
                print(f"[SPOT] sin triangulos > {MIN_PROFIT:.1%}")
            for name, g in p2p_routes(b)[:3]:
                print(f"[P2P ] {name}: {g:.3%}")
        except requests.RequestException as e:
            print(f"Error de red, reintentando: {e}")
        print("-" * 40)
        time.sleep(15)
