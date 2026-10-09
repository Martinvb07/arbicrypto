import time
import requests

SPOT = "https://api.binance.com/api/v3/ticker/bookTicker"
P2P = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
FEE = 0.001
GMF = 0.004
FIAT = "COP"
ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"]
MIN_PROFIT = 0.002


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
    while True:
        b = book()
        for name, g in triangles(b):
            print(f"[SPOT] {name}: {g:.3%}")
        for name, g in p2p_routes(b)[:3]:
            print(f"[P2P ] {name}: {g:.3%}")
        print("-" * 40)
        time.sleep(15)
