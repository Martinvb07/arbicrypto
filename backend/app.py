"""ArbiCrypto: arbitraje en Binance (P2P en pesos + Spot) en vivo, para ti y tu equipo.

Se enciende con PM2 (ver LEEME.md):
    pm2 start deploy/ecosystem.config.js                 solo este PC      -> http://127.0.0.1:8787
    pm2 start deploy/ecosystem.config.js --env equipo    red local (Wi-Fi) -> http://IP-de-este-PC:8787
"""
import asyncio
import functools
import html
import logging
import mimetypes
import os
import queue
import secrets
import re
import socket
import sys
import threading
import time
import webbrowser

import requests

import storage
from httpkit import App, Response, abort, asgi, g, jsonify, redirect, request, safe_join, send_from_directory

import engine
from auth import Auth, AuthError
from db import DB, to_csv
from keys import Vault
from notify import Telegram, TelegramError
from stream import LiveBook

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
WEB_DIR = os.path.normpath(os.path.join(ROOT, "..", "web", "out"))
ENV_FILE = os.path.join(ROOT, ".env")
ENV_KEYS = ["APP_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT", "TELEGRAM_CHAT_ID", "TELEGRAM_CHAT_NAME"]
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
PREFS_FILE = os.path.join(DATA_DIR, "prefs.json")  # capital de cada usuario
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
WATCH_FILE = os.path.join(DATA_DIR, "watches.json")
_ENV0 = storage.read_env_file(ENV_FILE)
_flag = lambda k: (os.environ.get(k) or _ENV0.get(k, "")).strip().lower() in ("1", "true", "si", "yes")
TEAM = "--equipo" in sys.argv or _flag("EQUIPO")  # EQUIPO=1: abierto en la red Wi-Fi
HOST, PORT = ("0.0.0.0" if TEAM else os.environ.get("HOST", "127.0.0.1")), int(os.environ.get("PORT", 8787))
SECURE_COOKIE = _flag("COOKIE_SECURE")  # VPS con HTTPS: la cookie de sesion solo viaja cifrada
REMOTE_ADMIN = _flag("REMOTE_ADMIN")    # VPS (HTTPS): cada usuario conecta su cuenta de Binance desde su navegador
LOOPBACK = ("127.0.0.1", "::1")
COOKIE = "cj_session"
BOOT = time.time()

# ---------------------------------------------------------------- reglas fijas (simples a proposito)

FIAT = "COP"
P2P_ASSETS = ["USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "USDC", "FDUSD"]  # criptos principales del P2P en pesos
SPOT_COINS = {"USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "LTC", "LINK",
              "AVAX", "DOT", "BCH", "ATOM", "UNI", "ETC", "XLM", "FIL"}  # solo monedas grandes y liquidas
SPOT_BASES = ["USDT", "USDC", "FDUSD", "BTC"]
MIN_ORDERS, MIN_FINISH = 20, 0.9  # reputacion minima del anunciante
MIN_LIQUIDITY = 50                # USDT minimos disponibles en el libro para una ruta Spot
SAFE_P2P = 0.006                  # P2P: menos de 0,6 % se avisa igual, pero marcada "justa · actua rapido"
SAFE_SPOT = 0.001                 # Spot: menos de 0,1 % (despues del colchon) se marca "justa"
MAX_PROFIT = 0.03                 # mas que esto casi siempre es un precio viejo o una trampa
SPOT_CONFIRMATIONS = 2            # un triangulo debe verse en 2 revisiones seguidas
ALERT_COOLDOWN = 300              # no repetir el mismo aviso antes de 5 minutos
SPOT_INTERVAL, P2P_INTERVAL = 2, 1  # Spot usa precios en vivo por WebSocket; P2P no tiene, se consulta seguido
P2P_ALWAYS = ["USDT"]  # se revisa en cada vuelta; el resto por turnos (Binance bloquea con 429 si se consulta todo cada segundo)
HISTORY_EVERY = 20  # el grafico del dia guarda un punto cada 20 s aunque P2P se revise mas seguido
REST_REFRESH = 30                     # foto completa de precios Spot cada 30 s (respaldo y saldos)
REAL_PRICE_NEAR = -0.001              # rutas Spot a menos de 0,1 % de dar ganancia se miden con el libro completo
PUBLISH_EVERY = 5                     # refresco de pantallas por cambios de Spot
HISTORY_SECONDS = 24 * 3600
# Vigilancia de ventas ("avisame cuando pueda vender sin perder")
WATCH_INTERVAL = 5                # cada 5 s revisa las salidas que importan (vender directo, la mejor del momento y USDT)
WATCH_FULL_EVERY = 60             # cada 60 s revisa las 8 criptos por si aparece una salida mejor por otro camino
WATCH_MAX = 10                    # maximo de monedas en la lista por usuario
WATCH_PER_STEP = 2                # en cada vuelta se revisan las 2 que llevan mas tiempo sin revisar (cupo de Binance)
WATCH_SPOT_EXTRA = 0.001          # si hay que cambiar en Spot antes de vender, se exige 0,1 % mas (el cambio toma tiempo)
WATCH_CONFIRM_DELAY = 2           # antes de avisar se vuelve a consultar a los 2 s: la oferta debe seguir ahi
FIXED = {"fiat": FIAT, "p2p_assets": P2P_ASSETS, "max_profit": MAX_PROFIT, "p2p_interval": P2P_INTERVAL,
         "min_orders": MIN_ORDERS, "min_finish": MIN_FINISH,
         "safe_p2p": SAFE_P2P, "safe_spot": SAFE_SPOT, "spot_slippage": engine.SPOT_SLIPPAGE}

# Lo unico que se configura (cada usuario el suyo): capital, desde cuanto avisar y si su cuenta paga 4x1000
DEFAULTS = {"capital": 500000, "min_per_usd": 3, "gmf": 0.004}
PERSONAL = tuple(DEFAULTS)
LIMITS = {"capital": (10000, 1e10), "min_per_usd": (0, 1e5), "gmf": (0, 0.01)}

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")

mimetypes.add_type("application/manifest+json", ".webmanifest")  # manifiesto de la app (celular)
app = App()  # FastAPI; el tamano maximo de cada peticion lo controla httpkit
# MySQL si hay DATABASE_URL en backend/.env; si no, SQLite y archivos en backend/data. Redis opcional (REDIS_URL).
sql, store, redis = storage.from_env(storage.read_env_file(ENV_FILE), DATA_DIR)
db = DB(sql)
if sql.mysql:
    storage.import_local(sql, store, DATA_DIR)  # primera vez con MySQL: trae lo que haya en backend/data
auth = Auth(store=store, redis=redis)
live = LiveBook()
telegram = Telegram()
lock = threading.RLock()
wake = {name: threading.Event() for name in ("spot", "p2p", "account", "watch")}
subscribers = []
online = {}  # {usuario: pestañas abiertas}: quien esta conectado ahora (para el chat)
chat_sent = {}  # {usuario: [momentos de sus ultimos mensajes]} para frenar el spam

settings = dict(DEFAULTS)
vault = None     # llaves de Binance cifradas (se abre en main con APP_SECRET)
accounts = {}    # {usuario: engine.Account}: cada persona conecta SU cuenta y solo ella la ve
acc_state = {}   # {usuario: saldos, comision y ordenes de su cuenta}
acc_errors = {}  # {usuario: {"t", "msg"}} si su cuenta no se pudo leer
graph = {}
history = []
p2p_cache = {"market": {}, "turn": 0}  # ultimos anuncios de cada cripto
prefs = {}  # {usuario: {"capital": pesos}}
by_capital = {}  # {capital: {"routes", "conversions", "found"}} calculado en cada escaneo P2P
state = {"spot": None, "p2p": None, "alerts": [], "errors": {}}
opps = {"spot": []}
streak = {}
first_seen = {}
last_alert = {}
last_test = {}
last_refresh = {"t": 0.0}
active_alerts = {"spot": set(), "p2p": set()}
alerts_at_boot = 0
hour_best = {}
spot_meta = {"rest": {}, "rest_t": 0.0, "published": 0.0, "opp_ids": frozenset()}
depth_cache = {}


# ---------------------------------------------------------------- archivos

def clean_settings(raw):
    out = dict(DEFAULTS)
    for k, (lo, hi) in LIMITS.items():
        try:
            out[k] = min(max(float(raw.get(k, out[k])), lo), hi)
        except (TypeError, ValueError):
            pass
    return out


def profile(name):
    """Capital, 4x1000 y "avisar desde" de un usuario (administradores incluidos). Lo que no haya puesto
    sale de los valores iniciales de backend/data/settings.json."""
    mine = prefs.get(name) or {} if name else {}
    return {k: mine[k] if mine.get(k) is not None else settings[k] for k in PERSONAL}


def main_user():
    """El administrador mas antiguo: su perfil manda en Telegram y en el historial (son del equipo)."""
    admins = sorted((u.get("created", 0), n) for n, u in auth.users.items() if u.get("role") == "admin")
    return admins[0][1] if admins else None


def all_profiles():
    """{(capital, 4x1000): [usuarios]}: las rutas P2P se calculan una vez por combinacion distinta."""
    groups = {}
    for name in list(auth.users):
        pr = profile(name)
        groups.setdefault((pr["capital"], pr["gmf"]), []).append(name)
    if not groups:
        groups[(settings["capital"], settings["gmf"])] = []
    return dict(sorted(groups.items(), key=lambda kv: -len(kv[1]))[:8])


def public_settings(user=None):
    return {**FIXED, **settings, **profile(user and user["name"])}


def _doc(path):
    return os.path.splitext(os.path.basename(path))[0]  # backend/data/watches.json -> "watches"


def load_json(path, default):
    return store.load(_doc(path), default)


def save_json(path, data):
    store.save(_doc(path), data)


def read_env():
    env = {}
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            k, _, v = line.strip().partition("=")
            if k and not k.startswith("#"):
                env[k.strip()] = v.strip().strip("\"'")
    return env


def update_env(**changes):
    """Cambia claves de backend/.env; con valor None la clave se borra."""
    env = {k: v for k, v in dict(read_env(), **changes).items() if v is not None}
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.write("# Llaves privadas de ArbiCrypto (Binance SOLO LECTURA y Telegram). No compartas este archivo.\n")
        for k in ENV_KEYS + [k for k in env if k not in ENV_KEYS]:
            f.write(f"{k}={env.get(k, '')}\n")


def port_free(wait):
    """True si el puerto se puede abrir. Tras un reinicio o un deploy el panel anterior puede tardar
    unos segundos en soltarlo: se reintenta hasta `wait` segundos."""
    end = time.time() + wait
    while True:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                if os.name != "nt":  # Linux: igual que uvicorn, ignora conexiones viejas en TIME_WAIT
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind((HOST, PORT))
            return True
        except OSError:
            if time.time() >= end:
                return False
            time.sleep(1)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "IP-de-este-PC"


def load_history():
    cutoff = time.time() - HISTORY_SECONDS
    out = []
    for p in load_json(HISTORY_FILE, []):
        if p.get("t", 0) <= cutoff:
            continue
        out.append(p)
    return out


# ---------------------------------------------------------------- formatos para los avisos

def num(v, d=0):
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def money(v):
    return ("-$" if v < 0 else "$") + num(abs(v), 0 if abs(v) >= 1e5 or abs(v) == int(abs(v)) else 2)


def qty(v):
    return num(v, 2 if v >= 1 else 6)


def per_usd(v):
    return ("+" if v > 0 else "-" if v < 0 else "") + "$" + num(abs(v), 2) + " por dólar"


# ---------------------------------------------------------------- eventos y avisos

def publish(kind, remote=True):
    if remote:
        redis.publish(kind)
    for q in list(subscribers):
        try:
            q.put_nowait(kind)
        except queue.Full:
            pass


ADMINS = "@admins"


def alert_visible(a, user):
    """Todo es privado: cada quien ve sus avisos; los del sistema, solo los administradores.
    Los avisos viejos no guardaban de quien eran: se ocultan, salvo los del sistema (para administradores)."""
    audience = a.get("audience")
    if not audience:
        return a.get("kind") == "system" and user["role"] == "admin"
    if ADMINS in audience:
        return user["role"] == "admin"
    return user["name"] in audience


def raise_alert(key, kind, title, body, capital=None, user=None, telegram_too=True, users=None):
    now = time.time()
    audience = list(users) if users is not None else [user] if user else [ADMINS]
    with lock:
        if now - last_alert.get(key, 0) < ALERT_COOLDOWN:
            return
        last_alert[key] = now
        alert_id = db.add_alert(now, kind, title, body, audience)
        state["alerts"].insert(0, {"id": alert_id, "t": now, "kind": kind, "title": title, "body": body,
                                   "capital": capital, "user": user, "users": users, "audience": audience})
        del state["alerts"][200:]
    icon = {"p2p": "💰", "spot": "⚡", "system": "⚠️", "sell": "🎯"}.get(kind, "✅")
    if telegram_too:
        telegram.send_async(f"<b>{icon} {html.escape(title)}</b>\n{html.escape(body)}\n\n<i>Confirma el precio en Binance antes de pagar.</i>")
    publish("alert")


def sync_alerts(group, current, **extra):
    """Avisa solo cuando aparece una oportunidad NUEVA; no repite mientras siga igual."""
    fresh = [k for k in current if k not in active_alerts.setdefault(group, set())]
    active_alerts[group] = set(current)
    for key in fresh:
        raise_alert(key, *current[key], **extra)


def p2p_fee():
    """Comision P2P real segun las ordenes completadas de todas las cuentas conectadas
    (Binance casi nunca cobra al que toma un anuncio)."""
    rates = sorted(o["commission"] / o["amount"] for snap in list(acc_state.values()) for o in snap.get("orders", [])
                   if o.get("status") == "COMPLETED" and o.get("amount") and o.get("commission"))
    return min(rates[len(rates) // 2], 0.01) if rates else 0.0


STD_FEE = 0.001  # comision Spot estandar de Binance (0,1 %): la mas alta, asi el calculo nunca promete de mas


def current_fee():
    return STD_FEE


def best_price(asset, side):
    p2p = state["p2p"]
    ads = p2p["market"].get(asset, {}).get(side) if p2p else None
    return ads[0]["price"] if ads else None


def usd_ref():
    """Precio de referencia del dolar (USDT) en pesos para expresar ganancias por dolar."""
    return best_price("USDT", "BUY") or best_price("USDT", "SELL")


def record_hour_best(kind, best, now):
    if best is None:
        return
    key = (int(now // 3600), kind)
    if best > hour_best.get(key, float("-inf")):
        hour_best[key] = best
        db.hourly_best(kind, best, now)


def route_label(route):
    coins = [st["to"] if st["venue"] == "Spot" else st["asset"] for st in route["steps"]
             if st["venue"] == "Spot" or st["kind"] == "buy"]
    return " → ".join(["COP", *coins, "COP"])


def cached_depth(symbol):
    hit = depth_cache.get(symbol)
    if hit and time.time() - hit[0] < 2:
        return hit[1]
    book = engine.depth(symbol)
    depth_cache[symbol] = (time.time(), book)
    return book


def route_text(route):
    lines = []
    for i, st in enumerate(route["steps"], 1):
        if st["venue"] == "Spot":
            lines.append(f"{i}. Cambia a {st['to']} en Spot ({st['symbol']}) con orden de MERCADO, NO Convertir"
                         f" · te deben llegar mínimo {qty(st['qty'])} {st['to']} (si llega menos, no sigas)")
        elif st["kind"] == "buy":
            ad = st["ad"]
            lines.append(f"{i}. Compra {qty(st['qty'])} {st['asset']} a {money(st['price'])} · {ad['nick']} · {', '.join(ad['methods'][:2])}"
                         " · confirma que el precio siga igual antes de pagar")
        else:
            ad = st["ad"]
            lines.append(f"{i}. Vende a {money(st['price'])} → recibes {money(st['qty'] * st['price'])} · {ad['nick']} · {', '.join(ad['methods'][:2])}")
    return "\n".join(lines)


# ---------------------------------------------------------------- hilos de escaneo

pairs = {"data": {}, "t": 0.0}


def spot_step():
    global graph
    now = time.time()
    if not pairs["data"] or now - pairs["t"] > 3600:
        pairs["data"], pairs["t"] = engine.load_pairs(), now
        live.start([sym for sym, (b, q) in pairs["data"].items() if b in SPOT_COINS and q in SPOT_COINS])
    if now - spot_meta["rest_t"] > REST_REFRESH or not live.fresh():
        spot_meta["rest"], spot_meta["rest_t"] = engine.fetch_book(), now
    book = {**spot_meta["rest"], **live.snapshot()} if live.fresh() else spot_meta["rest"]
    g_ = engine.build_graph(pairs["data"], book)
    fee = current_fee()
    res = engine.triangles(g_, SPOT_BASES, fee, MIN_LIQUIDITY, allowed=SPOT_COINS)
    for t in res["top"]:
        t["pairs"] = [pairs["data"].get(sym) for sym in t["symbols"]]

    ref = usd_ref()
    fee_for = lambda sym: fee  # el escaner es de todos: comision estandar
    found, alive, checked = [], set(), 0
    for t in res["top"]:
        if t["profit"] <= REAL_PRICE_NEAR or not ref:
            break
        if t["profit"] > MAX_PROFIT:
            continue  # demasiado bueno para ser cierto: casi siempre es un precio viejo
        amount_usdt = min(profile(main_user())["capital"] / ref, t["liquidity"])  # el monto solo afina el precio real
        if checked < 3:  # precio real con la profundidad del libro, solo para las mejores
            checked += 1
            try:
                t["real"] = engine.real_triangle_profit(t, pairs["data"], amount_usdt / t["to_usdt"], fee_for, cached_depth)
            except (requests.RequestException, engine.BinanceError):
                t["real"] = None
        profit = t.get("real") if "real" in t else t["profit"]
        if profit is None or profit <= 0:
            continue
        key = "spot:" + ">".join(t["path"])
        alive.add(key)
        streak[key] = streak.get(key, 0) + 1
        first_seen.setdefault(key, now)
        if streak[key] >= SPOT_CONFIRMATIONS:  # el minimo de cada usuario se aplica despues
            found.append({"id": key, "kind": "spot", "profit": profit, "per_usd": profit * ref,
                          "gain": amount_usdt * profit * ref, "amount_usdt": amount_usdt, "since": first_seen[key], "tri": t,
                          "tight": profit < SAFE_SPOT})
    for key in [k for k in streak if k.startswith("spot:") and k not in alive]:
        streak.pop(key, None)
        first_seen.pop(key, None)

    sane = [t["profit"] for t in res["top"] if t["profit"] <= MAX_PROFIT]
    record_hour_best("spot", max(sane) * ref if sane and ref else None, now)
    main = profile(main_user())
    team = [o for o in found if o["per_usd"] >= main["min_per_usd"]]
    db.track("spot", {o["id"]: (" → ".join(o["tri"]["path"]), o["per_usd"], o["gain"], o["tri"]["symbols"]) for o in team},
             main["capital"], now)
    with lock:
        graph = g_
        state["spot"] = dict(res, t=now, fee=fee, live=live.fresh())
        opps["spot"] = found
    by_min = {}  # cada quien recibe las que pasan SU minimo
    for name in list(auth.users):
        by_min.setdefault(profile(name)["min_per_usd"], []).append(name)
    main_name = main_user()
    for minimum, names in by_min.items():
        sync_alerts(f"spot@{minimum}", {f"{o['id']}@{minimum}": (
            "spot", f"{per_usd(o['per_usd'])} dentro de Binance" + (" · JUSTA, actúa rápido" if o["tight"] else ""),
            f"{' → '.join(o['tri']['path'])}\nCon {num(o['amount_usdt'])} USDT en Spot: {money(o['gain'])} · 3 cambios seguidos, dura segundos\n"
            "Precio real según tu monto, con comisiones, redondeo y colchón · usa órdenes de MERCADO, NO Convertir")
            for o in found if o["per_usd"] >= minimum}, users=names, telegram_too=main_name in names)
    ids = frozenset(o["id"] for o in found)
    if ids != spot_meta["opp_ids"] or now - spot_meta["published"] >= PUBLISH_EVERY:
        spot_meta["opp_ids"], spot_meta["published"] = ids, now
        publish("spot")


def p2p_step():
    if p2p_hold.is_set():
        return  # se esta calculando una venta: esta vuelta se salta
    for _ in range(40):  # las rutas necesitan precios spot; espera el primer escaneo
        if graph:
            break
        time.sleep(0.5)
    cache = p2p_cache
    rest = [a for a in P2P_ASSETS if a not in P2P_ALWAYS]
    if len(cache["market"]) < len(P2P_ASSETS):
        batch = P2P_ASSETS
    else:
        batch = P2P_ALWAYS + [rest[cache["turn"] % len(rest)]]
        cache["turn"] += 1
    fresh, errors = engine.p2p_market(batch, FIAT, 0, [], False, MIN_ORDERS, MIN_FINISH)
    if errors and len(errors) == 2 * len(batch):
        raise engine.BinanceError(errors[0])
    for asset, m in fresh.items():
        if asset not in cache["market"] or not any(e.startswith(f"{asset} ") for e in errors):
            cache["market"][asset] = m  # si fallo, se conserva lo ultimo bueno
    market = {a: cache["market"][a] for a in P2P_ASSETS if a in cache["market"]}
    fee, pfee, now = current_fee(), p2p_fee(), time.time()
    usdt_ads = market.get("USDT", {}).get("BUY") or market.get("USDT", {}).get("SELL") or []
    ref = usdt_ads[0]["price"] if usdt_ads else (usd_ref() or 0)
    computed, keep = {}, set()
    groups = all_profiles()
    for (cap, gmf) in groups:
        routes = engine.p2p_routes(market, graph, fee, gmf, cap, FIAT, pfee)
        conversions = engine.usdt_conversions(market, graph, fee, gmf, cap)
        for r in routes:
            r["per_usd"] = r["profit"] * ref
            for step in r["steps"]:
                if step["venue"] == "Spot":
                    step["pair"] = pairs["data"].get(step["symbol"])
        found = []
        for r in routes:
            if r["profit"] <= 0:
                break
            if r["profit"] > MAX_PROFIT:
                continue  # el minimo de cada usuario se aplica al mostrar y al avisar
            key, seen_key = "p2p:" + r["id"], f"p2p:{r['id']}@{cap}@{gmf}"
            first_seen.setdefault(seen_key, now)
            keep.add(seen_key)
            found.append({"id": key, "kind": "p2p", "profit": r["profit"], "per_usd": r["per_usd"], "gain": r["profit_fiat"],
                          "since": first_seen[seen_key], "route": r, "tight": r["profit"] < SAFE_P2P})
        computed[(cap, gmf)] = {"routes": routes, "conversions": conversions, "found": found}
    for key in [k for k in first_seen if k.startswith("p2p:") and k not in keep]:
        first_seen.pop(key, None)
    main_name = main_user()
    main = profile(main_name)  # historial y Telegram: el perfil del administrador principal
    own = computed.get((main["capital"], main["gmf"])) or {"routes": [], "found": []}
    record_hour_best("p2p", own["routes"][0]["per_usd"] if own["routes"] else None, now)
    db.track("p2p", {o["id"]: (route_label(o["route"]), o["per_usd"], o["gain"], route_text(o["route"]))
                     for o in own["found"] if o["per_usd"] >= main["min_per_usd"]}, main["capital"], now)

    point = {"t": int(now), "p": {a: [m["BUY"][0]["price"] if m["BUY"] else None, m["SELL"][0]["price"] if m["SELL"] else None]
                                  for a, m in market.items() if m["BUY"] or m["SELL"]}}
    with lock:
        state["p2p"] = {"t": now, "market": market, "errors": errors, "fiat": FIAT}
        by_capital.clear()
        by_capital.update(computed)
        snapshot = None
        if not history or now - history[-1]["t"] >= HISTORY_EVERY:
            history.append(point)
            while history and history[0]["t"] < now - HISTORY_SECONDS:
                history.pop(0)
            snapshot = list(history)
    if snapshot is not None:
        save_json(HISTORY_FILE, snapshot)

    for (cap, gmf), names in groups.items():
        costs_txt = ("Ya descuenta comisiones, redondeo, colchón y 4x1000 sobre la ganancia" if gmf
                     else "Ya descuenta comisiones, redondeo y colchón (sin 4x1000)")
        found = computed[(cap, gmf)]["found"]
        by_min = {}
        for name in names:
            by_min.setdefault(profile(name)["min_per_usd"], []).append(name)
        for minimum, who in by_min.items():
            tag = f"{cap}@{gmf}@{minimum}"
            sync_alerts(f"p2p@{tag}", {f"{o['id']}@{tag}": (
                "p2p", f"{per_usd(o['per_usd'])} en P2P" + (" · JUSTA, actúa rápido" if o["tight"] else ""),
                f"{route_text(o['route'])}\nCon {money(cap)}: {money(o['gain'])} de ganancia\n{costs_txt}")
                for o in found if o["per_usd"] >= minimum}, capital=cap, users=who, telegram_too=main_name in who)
    publish("p2p")


# ---------------------------------------------------------------- vigilancia de ventas

watches = []
watch_lock = threading.Lock()


def qty8(v):
    return num(v, 2 if v >= 1 else 8)


def watch_need(w, o):
    """Pesos que tiene que dar la venta para cumplir el objetivo (el 4x1000 se cobra sobre la ganancia)."""
    extra = w["cost"] * WATCH_SPOT_EXTRA if len(o["path"]) > 1 else 0
    return w["cost"] + extra + (w["target"] / (1 - profile(w["user"])["gmf"]) if w["target"] > 0 else 0)


def watch_eval(w, targets):
    """Mejor salida para una vigilancia y si ya cumple (ganancia >= objetivo, con margen extra si pasa por Spot)."""
    options, failed = engine.exit_options(w["asset"], w["qty"], graph, current_fee(), FIAT, targets, usd_ref() or 0,
                                          MIN_ORDERS, MIN_FINISH)
    best, best_gap = None, None
    for o in options:
        need = watch_need(w, o)
        o["profit"] = engine.after_gmf(o["received"] - w["cost"], profile(w["user"])["gmf"])
        o["need_price"] = need / o["qty"]  # precio por unidad que tiene que pagar el comprador
        o["ok"] = o["received"] >= need
        if best is None or o["received"] - need > best_gap:
            best, best_gap = o, o["received"] - need
    return best, failed


def watch_targets(w, now):
    """Cada 5 s solo lo que importa; cada 60 s todas las criptos."""
    last = (w.get("last") or {}).get("best")
    if not last and not w.get("full_t"):  # primera revision: solo vender directo y por USDT; la completa viene despues
        w["full_t"] = now
        return [a for a in P2P_ASSETS if a in (w["asset"], "USDT")]
    if not last or now - w.get("full_t", 0) >= WATCH_FULL_EVERY:
        w["full_t"] = now
        return P2P_ASSETS
    keep = [w["asset"], last["to"], "USDT"]
    return [a for a in P2P_ASSETS if a in keep]


def watch_alert(w, o):
    ad, gain = o["ad"], round(o["profit"])
    title = (f"Ya puedes vender tu {w['asset']} ganando {money(gain)}" if gain >= 1
             else f"Ya puedes vender tu {w['asset']} sin perder")
    lines = []
    if len(o["path"]) > 1:
        lines.append(f"{len(lines) + 1}. Cambia {qty8(w['qty'])} {w['asset']} a {o['to']} en Spot con orden de MERCADO, NO Convertir"
                     f" · te deben llegar mínimo {qty8(o['qty'])} {o['to']} (si llega menos, no sigas)")
    lines.append(f"{len(lines) + 1}. Pasa {qty8(o['qty'])} {o['to']} a tu Billetera de Fondos (gratis)")
    lines.append(f"{len(lines) + 1}. Vende a {ad['nick']} a {money(ad['price'])} por {o['to']} → recibes {money(o['received'])}"
                 f" · {', '.join(ad['methods'][:2])}")
    body = (f"Pagaste {money(w['cost'])} · recibes {money(o['received'])} · resultado {'+' if gain >= 0 else ''}{money(gain)}"
            " (ya con comisiones y 4x1000)\n" + "\n".join(lines) + "\nEstas ofertas duran poco: hazlo ya y confirma el precio.")
    # la clave cambia con cada aparicion: si la oferta se va y vuelve, avisa de nuevo
    # Telegram es uno solo (el del equipo): ahi solo van las ventas del administrador principal
    raise_alert(f"sell:{w['id']}:{w['alerts']}", "sell", title, body, user=w["user"], telegram_too=w["user"] == main_user())


def watch_step():
    with watch_lock:
        active = [w for w in watches if w["status"] in ("vigilando", "lista")]
    if not active or not graph or not state["p2p"]:
        return  # al arrancar, primero el mercado: asi no se piden todas las criptos a la vez (Binance limita)
    active.sort(key=lambda w: (w.get("last") or {}).get("t", 0))  # primero las que llevan mas tiempo sin revisar
    for w in active[:WATCH_PER_STEP]:
        now = time.time()
        alert_on = w.get("alert", True)
        # la lista es manual: no se marca como vendida por saldos de Binance (puede estar en Earn, en otro exchange...)
        p2p_hold.set()  # el escaner P2P cede su cupo de consultas mientras tanto
        try:
            best, failed = watch_eval(w, watch_targets(w, now))
            confirmed = False
            if best and best["ok"] and w["status"] != "lista" and alert_on:
                time.sleep(WATCH_CONFIRM_DELAY)  # segunda consulta: que no sea un anuncio que ya se fue
                again, _ = watch_eval(w, [best["to"]])
                confirmed = bool(again and again["ok"])
                best = again or best
        finally:
            p2p_hold.clear()
        w["last"] = {"t": time.time(), "failed": failed, "best": best and {
            "to": best["to"], "path": best["path"], "qty": best["qty"], "received": best["received"], "hops": best["hops"],
            "profit": best["profit"], "need_price": best["need_price"], "ok": best["ok"], "ad": best["ad"]}}
        if confirmed:
            w["status"] = "lista"
            watch_alert(w, best)
            w["alerts"] += 1
        elif best and best["ok"] and not alert_on:
            w["status"] = "lista"  # sin aviso: solo se marca en la lista
        elif w["status"] == "lista" and not (best and best["ok"]):
            w["status"] = "vigilando"  # la oferta se fue: sigue vigilando y avisa de nuevo si reaparece
    with watch_lock:
        save_json(WATCH_FILE, watches)
    publish("watch")


def watch_view(user):
    with watch_lock:
        rows = [w for w in watches if w["user"] == user["name"]]  # personales, tambien para administradores
        return sorted(rows, key=lambda w: (w["status"] not in ("lista", "vigilando"), -w["created"]))[:30]


def account_step():
    """Lee la cuenta de Binance de cada usuario conectado. Si una falla, las demas siguen."""
    for user, acc in list(accounts.items()):
        try:
            snap = acc.snapshot()
        except Exception as e:  # llave borrada en Binance, IP no permitida, sin internet...
            with lock:
                if accounts.get(user) is acc:
                    acc_errors[user] = {"t": time.time(), "msg": friendly_error(e)}
            continue
        db.save_orders(user, snap["orders"])
        with lock:
            if accounts.get(user) is acc:
                acc_state[user] = dict(snap, t=time.time())
                acc_errors.pop(user, None)
    publish("account")


def friendly_error(e):
    msg = str(e)
    if any(k in msg for k in ("NameResolutionError", "getaddrinfo", "Max retries", "ConnectionError", "timed out")):
        return "Sin conexión con Binance (revisa el internet de este PC)"
    if "429" in msg or "rate limit" in msg:
        return "Binance pidió esperar por demasiadas consultas"
    if "451" in msg or "restricted location" in msg:
        return ("Binance no permite cuentas desde el país donde está el servidor (por ejemplo, EE. UU.). "
                "Los precios siguen funcionando; para conectar cuentas el panel debe correr en un servidor de otro país.")
    return msg


def run_loop(name, step, interval):
    while True:
        started, wait = time.time(), interval
        if not redis.leader():  # otra copia del panel ya esta escaneando (Redis): esta espera
            wake[name].wait(10)
            wake[name].clear()
            continue
        try:
            step()
            with lock:
                state["errors"].pop(name, None)
        except Exception as e:  # un fallo de red no debe matar el hilo
            with lock:
                state["errors"][name] = {"t": time.time(), "msg": friendly_error(e)}
            publish(name)
            wait = 10  # tras un fallo se reintenta en 10 s: ni cada segundo (Binance limita) ni esperar un minuto
        # el intervalo cuenta desde que empezo la revision, no desde que termino
        wake[name].wait(max(0, wait - (time.time() - started)) if wait == interval else wait)
        wake[name].clear()


# ---------------------------------------------------------------- seguridad y sesiones

PUBLIC_PATHS = {"/login", "/login.html", "/favicon.ico", "/robots.txt", "/api/auth/login", "/api/auth/register"}
PUBLIC_PREFIXES = ("/_next/", "/coins/", "/brand/", "/icons/")


def has_account():
    """¿Quien hace la peticion tiene conectada SU cuenta de Binance?"""
    return g.user is not None and g.user["name"] in accounts


def can_connect():
    """Las llaves solo viajan desde este PC, o por HTTPS en el VPS (REMOTE_ADMIN=1)."""
    return is_local() or REMOTE_ADMIN


def forget_account(user):
    """Borra la cuenta de Binance de un usuario: llaves cifradas, saldos y errores (las ordenes guardadas quedan)."""
    vault.remove(user)
    with lock:
        accounts.pop(user, None)
        acc_state.pop(user, None)
        acc_errors.pop(user, None)


def is_local():
    return request.remote_addr in LOOPBACK


@app.before_request
def guard():
    if request.method == "POST" and not request.is_json:
        abort(415)  # bloquea formularios enviados por otras paginas web (CSRF)
    if is_local() and request.host.split(":")[0] not in ("127.0.0.1", "localhost"):
        abort(403)  # evita ataques de DNS rebinding contra este PC
    g.user = auth.user_for(request.cookies.get(COOKIE))
    if g.user or request.path in PUBLIC_PATHS or request.path.startswith(PUBLIC_PREFIXES):
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="Inicia sesión para continuar."), 401
    return redirect("/login")


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")  # panel privado: fuera de los buscadores
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def admin_only(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if not g.user or g.user["role"] != "admin":
            return jsonify(error="Solo el administrador puede hacer esto."), 403
        return fn(*args, **kwargs)
    return wrapper


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def with_session(token):
    resp = jsonify(ok=True)
    resp.set_cookie(COOKIE, token, max_age=30 * 86400, httponly=True, samesite="Strict", secure=SECURE_COOKIE)
    return resp


@app.post("/api/auth/login")
def api_login():
    try:
        token = auth.login(body().get("username"), str(body().get("password") or ""), request.remote_addr)
    except AuthError as e:
        return jsonify(error=str(e)), 403
    return with_session(token)


@app.post("/api/auth/register")
def api_register():
    b = body()
    try:
        token = auth.register(b.get("code"), b.get("username"), str(b.get("password") or ""), request.remote_addr)
    except AuthError as e:
        return jsonify(error=str(e)), 400
    return with_session(token)


@app.post("/api/auth/logout")
def api_logout():
    auth.logout(request.cookies.get(COOKIE))
    resp = jsonify(ok=True)
    resp.delete_cookie(COOKIE)
    return resp


@app.post("/api/auth/password")
def api_password():
    b = body()
    if not auth.verify(g.user["name"], str(b.get("current") or "")):
        return jsonify(error="La contraseña actual no es correcta."), 403
    try:
        auth.set_password(g.user["name"], str(b.get("new") or ""))
    except AuthError as e:
        return jsonify(error=str(e)), 400
    return with_session(auth.login(g.user["name"], str(b.get("new")), request.remote_addr))


@app.get("/api/team")
@admin_only
def api_team():
    return jsonify(users=auth.list_users(), invites=auth.list_invites())


@app.post("/api/team/invite")
@admin_only
def api_team_invite():
    return jsonify(code=auth.create_invite(g.user["name"]))


@app.post("/api/team/revoke")
@admin_only
def api_team_revoke():
    try:
        auth.revoke_invite(str(body().get("code", "")))
    except AuthError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


@app.post("/api/team/delete-user")
@admin_only
def api_team_delete():
    name = str(body().get("username", ""))
    try:
        auth.delete_user(name, g.user["name"])
    except AuthError as e:
        return jsonify(error=str(e)), 400
    forget_account(name)  # su llave de Binance se borra con el usuario
    return jsonify(ok=True)


@app.post("/api/team/rename")
@admin_only
def api_team_rename():
    b = body()
    old = str(b.get("username", ""))
    try:
        new = auth.check_rename(old, b.get("new"))  # primero se valida; el usuario cambia de ultimo
    except AuthError as e:
        return jsonify(error=str(e)), 400
    if new == old:
        return jsonify(ok=True, username=new)
    # 1) base de datos en una transaccion: si falla, no se toca nada y el usuario sigue con su nombre
    db.rename_user(old, new)
    # 2) lo demas atado al nombre: capital y ajustes, vigilancias y la cuenta de Binance
    with lock:
        if old in prefs:
            prefs[new] = prefs.pop(old)
            save_json(PREFS_FILE, prefs)
    with watch_lock:
        for w in watches:
            if w["user"] == old:
                w["user"] = new
        save_json(WATCH_FILE, watches)
    vault.rename(old, new)
    with lock:
        for d in (accounts, acc_state, acc_errors):
            if old in d:
                d[new] = d.pop(old)
    # 3) el usuario, sus sesiones e invitaciones
    try:
        auth.rename_user(old, new)
    except AuthError as e:  # alguien tomo el nombre en este instante: se devuelve todo
        db.rename_user(new, old)
        return jsonify(error=str(e)), 400
    publish("watch")
    return jsonify(ok=True, username=new)


@app.post("/api/team/role")
@admin_only
def api_team_role():
    b = body()
    try:
        auth.set_role(str(b.get("username", "")), str(b.get("role", "")), g.user["name"])
    except AuthError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


@app.post("/api/team/reset-password")
@admin_only
def api_team_reset():
    try:
        auth.set_password(str(body().get("username", "")), str(body().get("password") or ""))
    except AuthError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


# ---------------------------------------------------------------- Telegram

def save_telegram():
    update_env(TELEGRAM_BOT_TOKEN=telegram.token, TELEGRAM_BOT=telegram.bot,
               TELEGRAM_CHAT_ID=telegram.chat_id, TELEGRAM_CHAT_NAME=telegram.chat_name)


@app.post("/api/telegram/connect")
@admin_only
def api_tg_connect():
    try:
        bot = telegram.connect(str(body().get("token", "")))
    except TelegramError as e:
        return jsonify(error=f"Ese token no funciona: {e}"), 400
    save_telegram()
    return jsonify(ok=True, bot=bot)


@app.post("/api/telegram/detect")
@admin_only
def api_tg_detect():
    try:
        chat = telegram.detect_chat()
        save_telegram()
        telegram.send("✅ <b>ArbiCrypto conectado</b>\nAquí te llegarán los avisos cuando haya una oportunidad.")
    except TelegramError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True, chat=chat)


@app.post("/api/telegram/disconnect")
@admin_only
def api_tg_disconnect():
    telegram.token = telegram.bot = telegram.chat_id = telegram.chat_name = ""
    save_telegram()
    return jsonify(ok=True)


# ---------------------------------------------------------------- datos

def account_view(user):
    acc = acc_state.get(user)
    if not acc:
        return None
    usdt_fiat = best_price("USDT", "SELL")

    def rows(balances):
        out = []
        for asset, amount in balances.items():
            usdt = engine.usdt_value(graph, asset, amount)
            out.append({"asset": asset, "qty": amount, "usdt": usdt,
                        "fiat": usdt * usdt_fiat if usdt is not None and usdt_fiat else None})
        return sorted(out, key=lambda r: -(r["usdt"] or 0))

    spot, funding = rows(acc["spot"]), rows(acc["funding"])
    total = sum(r["usdt"] or 0 for r in spot + funding)
    return dict(acc, spot=spot, funding=funding, total_usdt=total, usdt_fiat=usdt_fiat,
                total_fiat=total * usdt_fiat if usdt_fiat else None)


exit_busy = threading.Lock()
p2p_hold = threading.Event()


@app.post("/api/exit")
def api_exit():
    """¿Donde vendo lo que tengo? Compara todas las salidas a pesos para una cripto y cantidad."""
    b = body()
    asset = str(b.get("asset") or "").upper().strip()
    try:
        amount = float(b.get("qty") or 0)
        cost = float(b.get("cost") or 0)
    except (TypeError, ValueError):
        return jsonify(error="Cantidad o costo inválido."), 400
    if not graph or not re.fullmatch(r"[A-Z0-9]{2,12}", asset) or asset not in graph and asset not in P2P_ASSETS:
        return jsonify(error="Esa cripto no se puede vender desde el panel."), 400
    if not 0 < amount < 1e9 or not 0 <= cost < 1e12:
        return jsonify(error="Escribe una cantidad mayor que cero."), 400
    if not exit_busy.acquire(blocking=False):
        return jsonify(error="Ya estoy calculando otra venta, intenta en unos segundos."), 429
    try:
        p2p_hold.set()  # el escaner P2P se pausa para no gastar el cupo de consultas de Binance
        options, failed = engine.exit_options(asset, amount, graph, current_fee(), FIAT, P2P_ASSETS, usd_ref() or 0,
                                      MIN_ORDERS, MIN_FINISH)
    except (requests.RequestException, engine.BinanceError) as e:
        return jsonify(error=friendly_error(e)), 502
    finally:
        p2p_hold.clear()
        exit_busy.release()
    gmf = profile(g.user["name"])["gmf"]
    for o in options:
        o["profit"] = engine.after_gmf(o["received"] - cost, gmf) if cost else None
        if o["backup"]:
            o["backup"]["profit"] = engine.after_gmf(o["backup"]["received"] - cost, gmf) if cost else None
        # precio minimo por unidad de la cripto que vendes para recuperar lo que pagaste
        o["breakeven"] = cost / o["qty"] if cost else None
    return jsonify(asset=asset, qty=amount, cost=cost, options=options, failed=failed, t=time.time())


@app.post("/api/watches")
def api_watch_add():
    b = body()
    asset = str(b.get("asset") or "").upper().strip()
    try:
        amount, cost, target = float(b.get("qty") or 0), float(b.get("cost") or 0), float(b.get("target") or 0)
    except (TypeError, ValueError):
        return jsonify(error="Revisa los números."), 400
    if not re.fullmatch(r"[A-Z0-9]{2,12}", asset) or (graph and asset not in graph and asset not in P2P_ASSETS):
        return jsonify(error="Esa cripto no se puede vigilar."), 400
    if not 0 < amount < 1e9:
        return jsonify(error="Escribe cuánto tienes."), 400
    if not 0 < cost < 1e12:
        return jsonify(error="Escribe cuánto pagaste: sin eso no sé cuándo vendes sin perder."), 400
    if not 0 <= target < cost:
        return jsonify(error="La ganancia que quieres no es válida."), 400
    alert = b.get("alert") is not False
    now = time.time()
    with watch_lock:
        for w in watches:  # la misma cripto y cantidad del mismo usuario se reemplaza
            if (w["user"] == g.user["name"] and w["asset"] == asset and abs(w["qty"] - amount) < 1e-12
                    and w["status"] in ("vigilando", "lista")):
                w["status"] = "reemplazada"
        if sum(w["status"] in ("vigilando", "lista") and w["user"] == g.user["name"] for w in watches) >= WATCH_MAX:
            return jsonify(error=f"Máximo {WATCH_MAX} monedas en tu lista. Borra una primero."), 400
        w = {"id": secrets.token_hex(6), "asset": asset, "qty": amount, "cost": cost, "target": target,
             "user": g.user["name"], "created": now, "expires": None, "status": "vigilando",
             "alerts": 0, "last": None, "alert": alert}
        watches.append(w)
        del watches[:-100]
        save_json(WATCH_FILE, watches)
    wake["watch"].set()
    publish("watch")
    return jsonify(ok=True, id=w["id"])


@app.post("/api/watches/update")
def api_watch_update():
    """Editar una moneda de la lista (cantidad, costo, ganancia que quieres) o prender/apagar su aviso."""
    b = body()
    with watch_lock:
        w = next((w for w in watches if w["id"] == str(b.get("id") or "") and w["user"] == g.user["name"]), None)
        if not w:
            return jsonify(error="Esa moneda no está en tu lista."), 404
        changed = dict(w)
        try:
            if "asset" in b:
                asset = str(b["asset"]).upper().strip()
                if not re.fullmatch(r"[A-Z0-9]{2,12}", asset) or (graph and asset not in graph and asset not in P2P_ASSETS):
                    return jsonify(error="Esa cripto no se puede vigilar."), 400
                changed["asset"] = asset
            for k in ("qty", "cost", "target"):
                if k in b:
                    changed[k] = float(b[k] or 0)
        except (TypeError, ValueError):
            return jsonify(error="Revisa los números."), 400
        if not 0 < changed["qty"] < 1e9 or not 0 < changed["cost"] < 1e12 or not 0 <= changed.get("target", 0) < changed["cost"]:
            return jsonify(error="Revisa la cantidad, lo que pagaste y la ganancia que quieres."), 400
        if "alert" in b:
            changed["alert"] = bool(b["alert"])
        numbers = any(changed.get(k) != w.get(k) for k in ("asset", "qty", "cost", "target"))
        w.update(changed)
        if numbers:  # con datos nuevos se vuelve a calcular desde cero
            w.update(status="vigilando", last=None, full_t=0)
        elif b.get("alert") is True and w["status"] == "lista":
            w["status"] = "vigilando"  # al prender el aviso con una oferta ya buena: se confirma y avisa
        save_json(WATCH_FILE, watches)
    wake["watch"].set()
    publish("watch")
    return jsonify(ok=True)


@app.post("/api/watches/delete")
def api_watch_delete():
    wid = str(body().get("id") or "")
    with watch_lock:
        w = next((w for w in watches if w["id"] == wid), None)
        if not w or (g.user["role"] != "admin" and w["user"] != g.user["name"]):
            return jsonify(error="Esa vigilancia no existe."), 404
        watches.remove(w)
        save_json(WATCH_FILE, watches)
    publish("watch")
    return jsonify(ok=True)


@app.get("/api/state")
def api_state():
    with lock:
        name = g.user["name"]  # saldos, ordenes y llave de Binance: solo los de su propia cuenta
        me = profile(name)
        cap = me["capital"]
        mine = by_capital.get((cap, me["gmf"]))
        p2p = state["p2p"]
        if p2p and mine is None and graph:  # capital o 4x1000 recien cambiado: se calcula ya con los anuncios guardados
            routes = engine.p2p_routes(p2p["market"], graph, current_fee(), me["gmf"], cap, FIAT, p2p_fee())
            ref = usd_ref() or 0
            for r in routes:
                r["per_usd"] = r["profit"] * ref
            mine = {"routes": routes, "conversions": engine.usdt_conversions(p2p["market"], graph, current_fee(), me["gmf"], cap),
                    "found": []}
        if p2p:
            p2p = {**p2p, "routes": (mine or {}).get("routes", []), "conversions": (mine or {}).get("conversions")}
        return jsonify({
            "boot": BOOT, "now": time.time(), "settings": public_settings(g.user), "fee": current_fee(), "p2p_fee": p2p_fee(),
            "spot": state["spot"], "p2p": p2p, "account": account_view(name),
            "opps": sorted([o for o in (mine or {}).get("found", []) + opps["spot"] if o["per_usd"] >= me["min_per_usd"]],
                           key=lambda o: -o["per_usd"]),
            "connected": name in accounts, "key_hint": accounts[name].hint() if name in accounts else None,
            "can_connect": can_connect(), "local": is_local(), "team": TEAM, "user": g.user, "telegram": telegram.info(), "usd_ref": usd_ref(),
            "alerts_at_boot": alerts_at_boot,
            "alerts": [a for a in state["alerts"] if alert_visible(a, g.user)][:100], "watches": watch_view(g.user),
            "errors": {**state["errors"], **({"account": acc_errors[name]} if name in acc_errors else {})},
        })


@app.get("/api/history")
def api_history():
    since = request.args.get("since", 0, type=float)
    with lock:
        return jsonify([p for p in history if p["t"] > since])


@app.post("/api/settings")
def api_settings():
    b = {k: v for k, v in body().items() if k in PERSONAL}
    if not b:
        return jsonify(error="Nada que guardar."), 400
    # capital, 4x1000 y "avisar desde" son de cada usuario, tambien de los administradores
    clean = clean_settings({**profile(g.user["name"]), **b})
    with lock:
        prefs[g.user["name"]] = {**prefs.get(g.user["name"], {}), **{k: clean[k] for k in b}}
        save_json(PREFS_FILE, prefs)
    for e in wake.values():
        e.set()
    return jsonify(public_settings(g.user))


@app.post("/api/connect")
def api_connect():
    """Cada usuario conecta SU cuenta (solo lectura); reemplaza la que tuviera antes."""
    if not can_connect():
        return jsonify(error="Por seguridad, las llaves solo se ingresan desde el PC donde corre el panel (o por HTTPS en el servidor)."), 403
    key, secret = str(body().get("key", "")).strip(), str(body().get("secret", "")).strip()
    if not key or not secret:
        return jsonify(error="Pega la API Key y la Secret Key."), 400
    acc = engine.Account(key, secret)
    try:
        perms = acc.permissions()
        risky = [name for flag, name in (("enableWithdrawals", "retiros"), ("enableSpotAndMarginTrading", "trading"),
                                         ("enableMargin", "margen"), ("enableFutures", "futuros"),
                                         ("enableInternalTransfer", "transferencias"),
                                         ("permitsUniversalTransfer", "transferencias")) if perms.get(flag)]
        if risky:
            return jsonify(error=f"Por seguridad solo se aceptan llaves de SOLO LECTURA. Esta tiene: {', '.join(sorted(set(risky)))}. "
                                 "Crea una llave nueva marcando únicamente 'Habilitar lectura'."), 400
        snap = acc.snapshot()
    except (requests.RequestException, engine.BinanceError) as e:
        msg = friendly_error(e)
        return jsonify(error=msg if msg != str(e) else f"Binance rechazó la llave: {e}"), 400
    name = g.user["name"]
    vault.save(name, key, secret)
    db.save_orders(name, snap["orders"])
    with lock:
        accounts[name] = acc
        acc_state[name] = dict(snap, t=time.time())
        acc_errors.pop(name, None)
    wake["p2p"].set()  # la comision P2P real sale de las ordenes
    publish("account")
    return jsonify(ok=True)


@app.post("/api/disconnect")
def api_disconnect():
    """Desconecta SOLO la cuenta de quien lo pide (nadie puede desconectar la de otro)."""
    if not has_account():
        return jsonify(error="No tienes una cuenta de Binance conectada."), 400
    forget_account(g.user["name"])
    publish("account")
    return jsonify(ok=True)


@app.post("/api/refresh")
def api_refresh():
    # Limite: cada actualizacion son ~20 consultas a Binance; demasiadas seguidas pueden bloquear la IP
    if time.time() - last_refresh["t"] >= 10:
        last_refresh["t"] = time.time()
        for e in wake.values():
            e.set()
    return jsonify(ok=True)


@app.post("/api/test-alert")
def api_test_alert():
    now = time.time()
    if now - last_test.get(g.user["name"], 0) < 15:
        return jsonify(error="Espera unos segundos antes de probar otra vez."), 429
    last_test[g.user["name"]] = now
    raise_alert(f"test:{now}", "test", "Aviso de prueba", "Si te llegó, tus avisos están funcionando.",
                user=g.user["name"], telegram_too=g.user["name"] == main_user())
    return jsonify(ok=True)


@app.get("/api/events")
def api_events():
    q = queue.Queue(maxsize=100)
    subscribers.append(q)
    req = request._r  # para saber cuando el navegador se va
    name = g.user["name"]
    with lock:
        online[name] = online.get(name, 0) + 1
    publish("presence", remote=False)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            idle = 0.0
            while not await req.is_disconnected():
                try:
                    yield f"data: {q.get_nowait()}\n\n"
                    idle = 0.0
                except queue.Empty:
                    await asyncio.sleep(0.2)
                    idle += 0.2
                    if idle >= 15:
                        yield ": ping\n\n"
                        idle = 0.0
        finally:
            if q in subscribers:
                subscribers.remove(q)
            with lock:
                online[name] = online.get(name, 1) - 1
                if online[name] <= 0:
                    online.pop(name, None)
            publish("presence", remote=False)

    return Response(stream(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- chat del equipo
# Canal general (peer "") y mensajes privados entre dos usuarios. El evento "chat" solo dice que hay
# algo nuevo: cada quien pide despues lo suyo, asi un privado nunca viaja a otra persona.

CHAT_MAX = 2000           # caracteres por mensaje
CHAT_BURST = (12, 20)     # maximo 12 mensajes cada 20 s por usuario


def chat_peer(raw, must_exist=True):
    peer = str(raw or "")
    if peer and (peer == g.user["name"] or (must_exist and peer not in auth.users)):
        abort(400)
    return peer


@app.get("/api/chat")
def api_chat():
    me = g.user["name"]
    with lock:
        now_online = set(online)
    users = [{"name": u["username"], "role": u["role"], "online": u["username"] in now_online}
             for u in auth.list_users() if u["username"] != me]
    return jsonify(me=me, users=users, channels=db.chat_summary(me))


@app.get("/api/chat/messages")
def api_chat_messages():
    peer = chat_peer(request.args.get("peer"), must_exist=False)
    before = request.args.get("before", 0, type=int)
    return jsonify(messages=db.messages(g.user["name"], peer, before or None))


@app.post("/api/chat/send")
def api_chat_send():
    b = body()
    me = g.user["name"]
    peer = chat_peer(b.get("peer"))
    text = str(b.get("body") or "").strip()
    if not text:
        return jsonify(error="Escribe un mensaje."), 400
    if len(text) > CHAT_MAX:
        return jsonify(error=f"Máximo {CHAT_MAX} caracteres por mensaje."), 400
    now = time.time()
    with lock:
        recent = [t for t in chat_sent.get(me, []) if now - t < CHAT_BURST[1]]
        if len(recent) >= CHAT_BURST[0]:
            return jsonify(error="Vas muy rápido. Espera unos segundos."), 429
        chat_sent[me] = recent + [now]
    msg = db.add_message(me, peer or None, text)
    db.mark_read(me, peer, msg["id"])
    publish("chat")
    return jsonify(ok=True, message=msg)


@app.post("/api/chat/read")
def api_chat_read():
    b = body()
    peer = chat_peer(b.get("peer"), must_exist=False)
    try:
        last_id = int(b.get("id") or 0)
    except (TypeError, ValueError):
        abort(400)
    if last_id > 0:
        db.mark_read(g.user["name"], peer, last_id)
    return jsonify(ok=True)


@app.post("/api/chat/delete")
def api_chat_delete():
    try:
        msg = db.message(int(body().get("id") or 0))
    except (TypeError, ValueError):
        abort(400)
    me = g.user
    # cada quien borra lo suyo; el administrador tambien puede borrar del canal general
    if not msg or not (msg["from"] == me["name"] or (msg["to"] is None and me["role"] == "admin")):
        return jsonify(error="Solo puedes borrar tus propios mensajes."), 403
    db.delete_message(msg["id"])
    publish("chat")
    return jsonify(ok=True)


# ---------------------------------------------------------------- vigilante: avisa si el escaner se detiene

def watchdog():
    down = set()
    names = {"spot": ("Spot", 120), "p2p": ("P2P", 180)}
    while True:
        time.sleep(30)
        now = time.time()
        for key, (label, limit) in names.items():
            last = (state[key] or {}).get("t", BOOT)
            stale = now - last > limit
            if stale and key not in down:
                down.add(key)
                err = state["errors"].get(key, {}).get("msg", "sin respuesta de Binance")
                raise_alert(f"watchdog:{key}:{now}", "system", f"El escáner de {label} se detuvo",
                            f"Última revisión hace {int((now - last) // 60)} min. Motivo: {err}. Sigue reintentando solo.")
            elif not stale and key in down:
                down.discard(key)
                raise_alert(f"watchdog:{key}:{now}", "system", f"El escáner de {label} volvió a funcionar", "Todo normal otra vez.")


# ---------------------------------------------------------------- historial, bitacora y exportaciones

def csv_response(text, filename):
    return Response(text, mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def local_time(t):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(t))


@app.get("/api/history/stats")
def api_history_stats():
    days = min(max(request.args.get("days", 7, type=int), 1), 120)
    opps_rows, hours = db.stats(days)
    return jsonify(opps=opps_rows, hours=hours, days=days)


def auto_operations(user):
    """Bitacora automatica: arma cada operacion con las ordenes P2P completadas del usuario (compras seguidas de ventas).
    Pagaste = suma de las compras; recibiste = suma de las ventas, ya con el 4x1000 sobre la ganancia."""
    done = sorted((o for o in db.orders(user) if o["status"] == "COMPLETED" and o["total"]), key=lambda o: o["time"])
    ops, buys, sells = [], [], []

    def close():
        if buys and sells:
            paid, got = sum(o["total"] for o in buys), sum(o["total"] for o in sells)
            gross = got - paid
            names = lambda rows: " + ".join(dict.fromkeys(f"{num(o['amount'], 2 if o['amount'] >= 1 else 8)} {o['asset']}" for o in rows))
            ops.append({"id": "auto:" + str(buys[0]["id"]), "auto": True, "user": user, "t": buys[0]["time"] / 1000,
                        "kind": "p2p", "description": f"Compraste {names(buys)} → vendiste {names(sells)}",
                        "invested": paid, "received": got - (gross * profile(user)["gmf"] if gross > 0 else 0),
                        "estimated": None, "note": None})
        buys.clear()
        sells.clear()

    for o in done:
        if o["side"] == "BUY":
            if sells:
                close()
            buys.append(o)
        elif buys:
            sells.append(o)
    close()  # las compras sin venta todavia no son una operacion
    return ops


def journal_rows():
    rows = db.journal(g.user["name"])  # privada: cada quien ve solo sus operaciones, tambien los administradores
    # las operaciones automaticas salen de la cuenta de Binance de cada quien: solo las propias
    return sorted(rows + auto_operations(g.user["name"]), key=lambda e: -e["t"])


@app.get("/api/journal")
def api_journal():
    return jsonify(entries=journal_rows())


@app.post("/api/journal")
def api_journal_add():
    b = body()
    try:
        invested, received = float(b.get("invested")), float(b.get("received"))
        estimated = None if b.get("estimated") in (None, "") else float(b.get("estimated"))
        t = float(b.get("t") or time.time())
    except (TypeError, ValueError):
        return jsonify(error="Revisa los montos: deben ser números."), 400
    kind = b.get("kind") if b.get("kind") in ("p2p", "spot", "otro") else "otro"
    description = str(b.get("description") or "").strip()[:200]
    note = str(b.get("note") or "").strip()[:500]
    if not description or not (0 < invested < 1e12) or not (0 <= received < 1e12) or not (0 < t < time.time() + 86400):
        return jsonify(error="Completa la descripción y montos válidos."), 400
    entry_id = db.add_journal(g.user["name"], t, kind, description, invested, received, estimated, note)
    return jsonify(ok=True, id=entry_id)


@app.post("/api/journal/delete")
def api_journal_delete():
    entry = db.journal_entry(body().get("id"))
    if not entry:
        return jsonify(error="Esa operación no existe."), 404
    if entry["user"] != g.user["name"]:
        return jsonify(error="Solo puedes borrar tus propias operaciones."), 403
    db.delete_journal(entry["id"])
    return jsonify(ok=True)


@app.get("/api/journal.csv")
def api_journal_csv():
    rows = [(local_time(e["t"]), e["user"], e["kind"], e["description"], round(e["invested"]), round(e["received"]),
             round(e["received"] - e["invested"]), "" if e["estimated"] is None else round(e["estimated"]), e["note"] or "")
            for e in journal_rows()]
    return csv_response(to_csv(["Fecha", "Usuario", "Tipo", "Descripción", "Invertido COP", "Recibido COP",
                                "Ganancia COP", "Ganancia estimada COP", "Nota"], rows), "bitacora-arbicrypto.csv")


@app.get("/api/orders")
def api_orders():
    return jsonify(orders=db.orders(g.user["name"]))


@app.get("/api/orders.csv")
def api_orders_csv():
    rows = [(local_time(o["time"] / 1000), "Compra" if o["side"] == "BUY" else "Venta", o["asset"], o["amount"], o["price"],
             o["total"], o["fiat"], o["status"], o["counterpart"] or "", o["id"]) for o in db.orders(g.user["name"])]
    return csv_response(to_csv(["Fecha", "Tipo", "Cripto", "Cantidad", "Precio", "Total", "Moneda", "Estado",
                                "Contraparte", "Orden"], rows), "ordenes-p2p-binance.csv")


# ---------------------------------------------------------------- interfaz (Next.js exportado en web/out)

SITE_PLACEHOLDER = "https://arbicrypto.local"  # el mismo de web/src/app/layout.tsx


@app.get("/")
@app.get("/<path:path>")
def web(path=""):
    if not os.path.isdir(WEB_DIR):
        return ("<h1>Falta compilar la interfaz</h1><p>En la carpeta <b>web</b> ejecuta <b>npm run build</b> "
                "y reinicia el panel (pm2 restart arbicrypto).</p>"), 503
    target = path or "index.html"
    for candidate in (target, f"{target}.html", f"{target}/index.html"):
        full = safe_join(WEB_DIR, candidate)
        if full and os.path.isfile(full):
            if candidate.endswith(".html"):  # vistas previas al compartir: URLs absolutas con el dominio real
                with open(full, encoding="utf-8") as f:
                    page = f.read().replace(SITE_PLACEHOLDER, f"{request.scheme}://{request.host}")
                return Response(page, mimetype="text/html")
            return send_from_directory(WEB_DIR, candidate)
    abort(404)


# ---------------------------------------------------------------- arranque

def main():
    global settings, history, alerts_at_boot, vault
    os.makedirs(DATA_DIR, exist_ok=True)
    state["alerts"] = db.recent_alerts()
    alerts_at_boot = state["alerts"][0]["id"] if state["alerts"] else 0
    settings = clean_settings(load_json(SETTINGS_FILE, {}))
    history = load_history()
    env = read_env()
    secret = os.environ.get("APP_SECRET") or env.get("APP_SECRET")
    if not secret:  # primera vez: clave para cifrar las llaves de Binance (vive solo en .env)
        secret = Vault.new_secret()
        update_env(APP_SECRET=secret)
    vault = Vault(store, secret)
    for user, (key, sec) in vault.all().items():
        if user in auth.users:
            accounts[user] = engine.Account(key, sec)
    telegram.token, telegram.bot = env.get("TELEGRAM_BOT_TOKEN", ""), env.get("TELEGRAM_BOT", "")
    telegram.chat_id, telegram.chat_name = env.get("TELEGRAM_CHAT_ID", ""), env.get("TELEGRAM_CHAT_NAME", "")

    redis.listen(lambda kind: publish(kind, remote=False))  # eventos de otras copias del panel
    if sql.mysql or redis.on:
        print(f"  Datos en {'MySQL' if sql.mysql else 'SQLite'}{' + Redis' if redis.on else ''}")
    watches.extend(load_json(WATCH_FILE, []))
    prefs.update(load_json(PREFS_FILE, {}))
    for name, step, interval in (("spot", spot_step, SPOT_INTERVAL), ("p2p", p2p_step, P2P_INTERVAL),
                                 ("account", account_step, 60), ("watch", watch_step, WATCH_INTERVAL)):
        threading.Thread(target=run_loop, args=(name, step, interval), daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()

    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n  ARBICRYPTO - panel listo en {url}")
    if not auth.has_users():
        print("\n  AVISO: no hay usuarios. Cierra el panel y ejecuta:  python auth.py  (opcion 1)")
    if TEAM:
        print("\n  MODO EQUIPO: tu equipo entra desde la misma red Wi-Fi a")
        print(f"     http://{lan_ip()}:{PORT}")
        print("  Cada persona entra con su propio usuario (crealo con un codigo de invitacion).")
        print("  Usalo solo en redes de confianza (casa u oficina), no en Wi-Fi publicas.")
        print("  Si Windows pregunta por el firewall, permite el acceso en 'redes privadas'.")
    print("\n  Para apagarlo: pm2 stop arbicrypto (o Ctrl+C si lo abriste a mano).\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, webbrowser.open, (url,)).start()
    if not port_free(30):
        print(f"  El puerto {PORT} esta ocupado: el panel probablemente ya esta abierto en {url}")
        sys.exit(3)
    import uvicorn
    # proxy_headers: detras de nginx se ve la IP real del visitante (solo se confia en el nginx local)
    # timeout_graceful_shutdown: los eventos en vivo de los navegadores no deben retrasar el apagado (deploys)
    uvicorn.run(asgi(app), host=HOST, port=PORT, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                log_level="warning", access_log=False, timeout_graceful_shutdown=3)


if __name__ == "__main__":
    main()
