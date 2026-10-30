"""ArbiCrypto: arbitraje en Binance (P2P en pesos + Spot) en vivo, para ti y tu equipo.

Se enciende con PM2 (ver LEEME.md):
    pm2 start deploy/ecosystem.config.js                 solo este PC      -> http://127.0.0.1:8787
    pm2 start deploy/ecosystem.config.js --env equipo    red local (Wi-Fi) -> http://IP-de-este-PC:8787
"""
import asyncio
import base64
import binascii
import datetime
import functools
import hmac
import html
import logging
import math
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

from urllib.parse import quote

import requests

import storage
import webpush
from httpkit import App, Response, abort, asgi, g, jsonify, redirect, request, safe_join, send_from_directory

import engine
import sso
from auth import Auth, AuthError
from db import DB, to_csv
from keys import Vault
from notify import Telegram, TelegramError
from stream import LiveBook

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
WEB_DIR = os.path.normpath(os.path.join(ROOT, "..", "web", "out"))
ENV_FILE = os.path.join(ROOT, ".env")
ENV_KEYS = ["APP_SECRET", "SSO_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT", "TELEGRAM_CHAT_ID", "TELEGRAM_CHAT_NAME"]
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
PREFS_FILE = os.path.join(DATA_DIR, "prefs.json")  # capital de cada usuario
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
WATCH_FILE = os.path.join(DATA_DIR, "watches.json")
WATCH_AUTO_FILE = os.path.join(DATA_DIR, "watch_auto.json")  # desde cuándo y qué compras ya crearon su moneda sola
PRICE_FILE = os.path.join(DATA_DIR, "price_alerts.json")  # alertas de precio de cada usuario
_ENV0 = storage.read_env_file(ENV_FILE)
_flag = lambda k: (os.environ.get(k) or _ENV0.get(k, "")).strip().lower() in ("1", "true", "si", "yes")
TEAM = "--equipo" in sys.argv or _flag("EQUIPO")  # EQUIPO=1: abierto en la red Wi-Fi
HOST, PORT = ("0.0.0.0" if TEAM else os.environ.get("HOST", "127.0.0.1")), int(os.environ.get("PORT", 8787))
SECURE_COOKIE = _flag("COOKIE_SECURE")  # VPS con HTTPS: la cookie de sesion solo viaja cifrada
REMOTE_ADMIN = _flag("REMOTE_ADMIN")    # VPS (HTTPS): cada usuario conecta su cuenta de Binance desde su navegador
# SITE_DOMAIN=arbicrypto.org (VPS): la portada y el login viven en arbicrypto.org, el panel en panel.arbicrypto.org y la
# wallet en wallet.arbicrypto.org. La sesión se comparte entre los tres (cookie del dominio .arbicrypto.org).
SITE_DOMAIN = (os.environ.get("SITE_DOMAIN") or _ENV0.get("SITE_DOMAIN", "")).strip().lower().strip(".")
COOKIE_DOMAIN = f".{SITE_DOMAIN}" if SITE_DOMAIN else None
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
HISTORY_SAVE_EVERY = 300  # y se escribe a la base cada 5 min: reescribir las 24 h cada 20 s llenaba el disco de MySQL
REST_REFRESH = 30                     # foto completa de precios Spot cada 30 s (respaldo y saldos)
REAL_PRICE_NEAR = -0.001              # rutas Spot a menos de 0,1 % de dar ganancia se miden con el libro completo
ACCOUNT_INTERVAL = 20                 # saldos y órdenes de cada cuenta: Mis monedas se ajusta casi al momento
PUBLISH_EVERY = 5                     # refresco de pantallas por cambios de Spot
HISTORY_SECONDS = 24 * 3600
# Vigilancia de ventas ("avisame cuando pueda vender sin perder")
WATCH_INTERVAL = 5                # cada 5 s revisa las salidas que importan (vender directo, la mejor del momento y USDT)
WATCH_MAX = 10                    # maximo de monedas en la lista por usuario
WATCH_PER_STEP = 2                # en cada vuelta se revisan las 2 que llevan mas tiempo sin revisar (cupo de Binance)
WATCH_SPOT_EXTRA = 0.001          # si hay que cambiar en Spot antes de vender, se exige 0,1 % mas (el cambio toma tiempo)
WATCH_CONFIRM_DELAY = 2           # antes de avisar se vuelve a consultar a los 2 s: la oferta debe seguir ahi
C2C_URL = "https://c2c.binance.com/es-LA"  # el dominio con el que la app de Binance comparte P2P: en el celular abre la app
WALLET_URL = "https://www.binance.com/es/my/wallet/account/main"  # P2P vende desde la Billetera de Fondos
FIXED = {"fiat": FIAT, "p2p_assets": P2P_ASSETS, "max_profit": MAX_PROFIT, "p2p_interval": P2P_INTERVAL,
         "min_orders": MIN_ORDERS, "min_finish": MIN_FINISH,
         "safe_p2p": SAFE_P2P, "safe_spot": SAFE_SPOT, "spot_slippage": engine.SPOT_SLIPPAGE}

# Lo que se configura (cada usuario el suyo): capital, desde cuanto avisar, 4x1000 y sus costos reales.
# taker_fee: comision P2P que le cobra Binance al tomar un anuncio (-1 = automatica, sacada de sus ordenes).
# bank_fee: lo que le cobra su banco por cada transferencia al vendedor. tax: impuesto de renta sobre la ganancia.
DEFAULTS = {"capital": 500000, "min_per_usd": 3, "gmf": 0.004, "taker_fee": -1, "bank_fee": 0, "tax": 0}
PERSONAL = tuple(DEFAULTS)
LIMITS = {"capital": (10000, 1e10), "min_per_usd": (0, 1e5), "gmf": (0, 0.01), "taker_fee": (-1, 0.02),
          "bank_fee": (0, 100000), "tax": (0, 0.39)}
# Medios de pago de cada usuario: con cuales paga al comprar y por cuales recibe al vender (vacio = todos)
METHOD_LISTS = ("pay_methods", "recv_methods")
# Avisos que cada usuario silencia: por tipo (todo el arbitraje Spot, todo el P2P...) o una ruta puntual ("p2p:USDT>BTC")
MUTABLE_KINDS = ("spot", "p2p", "sell", "price")
MUTED_ROUTES_MAX = 100
PRICE_ALERT_MAX = 20              # alertas de precio por usuario

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
push = webpush.WebPush(store.load, store.save)  # avisos aunque la pestaña esté dormida o cerrada
lock = threading.RLock()
wake = {name: threading.Event() for name in ("spot", "p2p", "account", "watch")}
subscribers = []
online = {}  # {usuario: pestañas abiertas}: quien esta conectado ahora (para el chat)
chat_sent = {}  # {usuario: [momentos de sus ultimos mensajes]} para frenar el spam

settings = dict(DEFAULTS)
vault = None     # llaves de Binance cifradas (se abre en main con APP_SECRET)
sso_secret = ""  # firma los pases para entrar a la wallet sin volver a iniciar sesión (SSO_SECRET)
accounts = {}    # {usuario: engine.Account}: cada persona conecta SU cuenta y solo ella la ve
acc_state = {}   # {usuario: saldos, comision y ordenes de su cuenta}
acc_errors = {}  # {usuario: {"t", "msg"}} si su cuenta no se pudo leer
graph = {}
history = []
history_saved = [0.0]  # cuándo se escribió el historial por última vez
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
    """Capital, 4x1000, "avisar desde", costos y medios de pago de un usuario (administradores incluidos). Lo que no
    haya puesto sale de los valores iniciales de backend/data/settings.json."""
    mine = prefs.get(name) or {} if name else {}
    out = {k: mine[k] if mine.get(k) is not None else settings[k] for k in PERSONAL}
    out["bank_fee"] = 0  # las transferencias no cobran: el unico costo del banco es el 4x1000 (aunque se haya guardado otro)
    out["tax"] = 0  # la renta se cuadra por aparte: el panel no la descuenta (aunque se haya guardado otra)
    for k in METHOD_LISTS:
        out[k] = [str(m) for m in mine.get(k) or []]
    out["muted_kinds"] = [k for k in mine.get("muted_kinds") or [] if k in MUTABLE_KINDS]
    out["muted_routes"] = [str(r) for r in mine.get("muted_routes") or []]
    out["binance_since"] = mine.get("binance_since") or None
    out["blocked"] = [b for b in mine.get("blocked") or [] if isinstance(b, dict) and b.get("user")]
    return out


def account_days(pr):
    """Días que lleva registrada su cuenta de Binance (None si no anotó la fecha): hay anuncios que piden 30, 60 o 90."""
    try:
        since = datetime.date.fromisoformat(pr.get("binance_since") or "")
    except ValueError:
        return None
    return max((datetime.date.today() - since).days, 0)


def can_take_of(pr):
    """(días de registro, anunciantes bloqueados) de un usuario: lo que decide qué anuncios puede tomar."""
    return account_days(pr), tuple(sorted(b["user"] for b in pr["blocked"]))


def market_for(market, pr):
    return engine.takeable(market, *can_take_of(pr))


BLOCKED_MAX = 200


def clean_account(raw):
    """binance_since: fecha AAAA-MM-DD (o vacío para quitarla). blocked: [{user, nick}] de anunciantes que no te dejan."""
    out = {}
    if "binance_since" in raw:
        v = str(raw.get("binance_since") or "").strip()
        try:
            out["binance_since"] = datetime.date.fromisoformat(v).isoformat() if v and datetime.date.fromisoformat(v) <= datetime.date.today() else None
        except ValueError:
            out["binance_since"] = None
    if isinstance(raw.get("blocked"), list):
        seen, rows = set(), []
        for b in raw["blocked"]:
            user = str((b or {}).get("user") or "").strip()[:64] if isinstance(b, dict) else ""
            if user and re.fullmatch(r"[A-Za-z0-9_-]+", user) and user not in seen:
                seen.add(user)
                rows.append({"user": user, "nick": str(b.get("nick") or "?")[:60]})
        out["blocked"] = rows[-BLOCKED_MAX:]
    return out


def clean_muted(raw):
    """muted_kinds: solo tipos conocidos. muted_routes: ids de ruta como "p2p:USDT>BTC" o "spot:USDT>BTC>ETH>USDT"."""
    kinds = sorted({k for k in raw.get("muted_kinds") or [] if k in MUTABLE_KINDS}) if isinstance(raw.get("muted_kinds"), list) else None
    routes = (sorted({str(r).strip()[:120] for r in raw.get("muted_routes") or []
                      if re.fullmatch(r"(p2p|spot):[A-Z0-9]{2,15}(>[A-Z0-9]{2,15}){1,4}", str(r).strip())})[:MUTED_ROUTES_MAX]
              if isinstance(raw.get("muted_routes"), list) else None)
    return {k: v for k, v in (("muted_kinds", kinds), ("muted_routes", routes)) if v is not None and k in raw}


def wants_alert(name, kind, key):
    """¿Este usuario quiere el aviso? No, si silenció ese tipo o esa ruta (la clave del aviso empieza con el id de la ruta)."""
    pr = profile(name)
    return kind not in pr["muted_kinds"] and key.split("@")[0] not in pr["muted_routes"]


def clean_methods(raw):
    return sorted({str(m).strip()[:60] for m in raw or [] if str(m).strip()})[:30] if isinstance(raw, list) else []


def taker_fee_of(pr):
    """(porcentaje, minimo fijo en dolares por orden) que se descuenta al tomar un anuncio P2P.
    Automatica: lo visto en las ordenes reales y nunca menos que el fijo por orden. Puesta a mano: exactamente esa."""
    return (pr["taker_fee"], 0.0) if pr["taker_fee"] >= 0 else (p2p_fee(), engine.P2P_TAKER_USD)


def effective_fee(pr):
    """La comision P2P con su capital, como porcentaje (para mostrarla y para los calculos de la pantalla)."""
    rate, min_usd = taker_fee_of(pr)
    return max(rate, min_usd * (usd_ref() or 0) / pr["capital"]) if pr["capital"] else rate


def route_key(pr):
    """Las rutas P2P cambian con el capital, el 4x1000, los costos y los medios de pago: una cuenta por combinacion."""
    fee, min_usd = taker_fee_of(pr)
    return (pr["capital"], pr["gmf"], fee, pr["bank_fee"], pr["tax"], tuple(pr["pay_methods"]), tuple(pr["recv_methods"]), min_usd,
            *can_take_of(pr))


def tag_of(key):
    return "@".join(str(x) for x in key[:5]) + "@" + ",".join(key[5]) + "@" + ",".join(key[6])


def routes_for(market, key):
    cap, gmf, fee, bank, tax, pay, recv, min_usd, days, blocked = key
    return engine.p2p_routes(engine.takeable(market, days, blocked), graph, current_fee(), gmf, cap, FIAT, fee, bank_fee=bank, tax=tax, pay=pay, recv=recv,
                             p2p_min_usd=min_usd)


def main_user():
    """El administrador mas antiguo: su perfil manda en Telegram y en el historial (son del equipo)."""
    admins = sorted((u.get("created", 0), n) for n, u in auth.users.items() if u.get("role") == "admin")
    return admins[0][1] if admins else None


def all_profiles():
    """{route_key: [usuarios]}: las rutas P2P se calculan una vez por combinacion distinta."""
    groups = {}
    for name in list(auth.users):
        groups.setdefault(route_key(profile(name)), []).append(name)
    if not groups:
        groups[route_key(profile(None))] = []
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


def raise_alert(key, kind, title, body, capital=None, user=None, telegram_too=True, users=None, links=()):
    """links: [(texto, url)] para ir directo a Binance desde el aviso (anunciante, par de Spot...)."""
    now = time.time()
    audience = list(users) if users is not None else [user] if user else [ADMINS]
    if kind in MUTABLE_KINDS:  # los del sistema, del equipo y de prueba no se silencian
        audience = [n for n in audience if n == ADMINS or wants_alert(n, kind, key)]
        if not audience:
            return
        if users is not None:  # el navegador decide si suena con "users": sin los que silenciaron, a ellos no les suena
            users = [n for n in users if n in audience]
        telegram_too = telegram_too and (main_user() in audience or (user is None and users is None))
    links = [{"label": label, "url": url} for label, url in links if url]
    with lock:
        if now - last_alert.get(key, 0) < ALERT_COOLDOWN:
            return
        last_alert[key] = now
        alert_id = db.add_alert(now, kind, title, body, audience)
        state["alerts"].insert(0, {"id": alert_id, "t": now, "kind": kind, "title": title, "body": body,
                                   "capital": capital, "user": user, "users": users, "audience": audience, "links": links})
        del state["alerts"][200:]
    push.send([n for n, u in auth.users.items() if u.get("role") == "admin"] if ADMINS in audience else audience)
    icon = {"p2p": "💰", "spot": "⚡", "system": "⚠️", "sell": "🎯", "price": "🔔"}.get(kind, "✅")
    if telegram_too:
        buttons = "\n" + "".join(f'\n👉 <a href="{html.escape(l["url"])}">{html.escape(l["label"])}</a>' for l in links) if links else ""
        telegram.send_async(f"<b>{icon} {html.escape(title)}</b>\n{html.escape(body)}{buttons}"
                            "\n\n<i>Confirma el precio en Binance antes de pagar.</i>")
    publish("alert")


def sync_alerts(group, current, **extra):
    """Avisa solo cuando aparece una oportunidad NUEVA; no repite mientras siga igual.
    current: {clave: (tipo, titulo, cuerpo[, enlaces])}."""
    fresh = [k for k in current if k not in active_alerts.setdefault(group, set())]
    active_alerts[group] = set(current)
    for key in fresh:
        kind, title, body, *links = current[key]
        raise_alert(key, kind, title, body, links=links[0] if links else (), **extra)


def p2p_fee():
    """Porcentaje que Binance cobra al que TOMA un anuncio P2P, visto en las ordenes completadas de las cuentas conectadas
    (ahora leido de takerCommission). Las ordenes de anuncios propios no cuentan: pagan otra comision. Con la comision
    automatica, encima va siempre el minimo fijo por orden (engine.P2P_TAKER_USD)."""
    rates = sorted(o["commission"] / o["amount"] for snap in list(acc_state.values()) for o in snap.get("orders", [])
                   if o.get("status") == "COMPLETED" and o.get("amount") and o.get("commission") and o.get("role") != "MAKER"
                   and not fixed_fee_only(o))
    return min(rates[len(rates) // 2], 0.01) if rates else 0.0


def fixed_fee_only(o):
    """¿Binance cobró solo el fijo por orden (0,07 USDT)? Esas órdenes no dicen nada del porcentaje: en una orden pequeña
    el fijo parece un porcentaje alto (0,07 de 70 USDT = 0,1 %) y aplicarlo a una grande la haría ver peor de lo que es."""
    usd = 1.0 if o.get("asset") in ("USDT", "USDC", "FDUSD") else (engine.usdt_value(graph, o.get("asset") or "", 1) if graph else None)
    return not usd or o["commission"] * usd <= engine.P2P_TAKER_USD * 1.1


def maker_fee(user):
    """Comision que le cobra Binance a un usuario por sus propios anuncios, segun sus ordenes completadas como
    anunciante. None si no tiene: el simulador de anuncios usa una de referencia."""
    rates = sorted(o["commission"] / o["amount"] for o in (acc_state.get(user) or {}).get("orders", [])
                   if o.get("role") == "MAKER" and o.get("status") == "COMPLETED" and o.get("amount"))
    return min(rates[len(rates) // 2], 0.02) if rates else None


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


def advertiser_url(ad):
    """El anuncio exacto en Binance P2P; si no hay numero de anuncio, el perfil del anunciante."""
    if ad.get("adv"):
        return f"{C2C_URL}/adv?code={quote(str(ad['adv']))}"
    return f"{C2C_URL}/advertiserDetail?advertiserNo={quote(str(ad['user']))}" if ad.get("user") else None


def spot_url(pair):
    return f"https://www.binance.com/es/trade/{pair[0]}_{pair[1]}?type=spot" if pair else None


def route_links(route):
    """Un enlace por paso de la ruta: el anunciante en P2P o el par en Spot."""
    links = []
    for st in route["steps"]:
        if st["venue"] == "Spot":
            links.append((f"{'Vender' if spot_sells(st) else 'Comprar'} {st['from'] if spot_sells(st) else st['to']} en Spot ({st['symbol']})",
                          spot_url(st.get("pair"))))
        else:
            links.append((f"{'Comprar' if st['kind'] == 'buy' else 'Vender'} {st['asset']} a {st['ad']['nick']}",
                          advertiser_url(st["ad"])))
    return links


def spot_sells(st):
    """En el par de Spot, ¿se vende la moneda que tienes (es la base, ETH en ETHUSDT) o se compra la otra?"""
    pair = st.get("pair")
    return pair[0] == st["from"] if pair else st["symbol"].startswith(st["from"])


def floor_qty(v):
    """Cantidad para escribir en Binance: redondeada hacia abajo, nunca mas de lo que tienes."""
    d = 2 if v >= 1 else 6
    return num(math.floor(v * 10 ** d) / 10 ** d, d)


def spot_clicks(st, have):
    """Donde hacer clic en Spot, paso a paso, para cambiar `have` de st['from'] a st['to']."""
    if spot_sells(st):
        return (f"abajo, en el lado derecho: pestaña Market → en Cantidad pon {floor_qty(have)} {st['from']}"
                f" → botón rojo Vender {st['from']}")
    return (f"abajo, en el lado izquierdo: pestaña Market → en Total pon {floor_qty(have)} {st['from']}"
            f" → botón verde Comprar {st['to']}")


def route_text(route):
    lines = []
    for i, st in enumerate(route["steps"], 1):
        if st["venue"] == "Spot":
            have = route["steps"][i - 2]["qty"] if i > 1 else 0
            lines.append(f"{i}. Cambia a {st['to']} en Spot: lo que compras en P2P llega a Fondos, primero pásalo a Spot"
                         f" (Billetera → Transferir, gratis) · abre {st['symbol']} · {spot_clicks(st, have)} (NO uses Convertir)"
                         f" · te deben llegar mínimo {qty(st['qty'])} {st['to']} (si llega menos, no sigas)"
                         f" · luego pasa los {st['to']} de Spot a Fondos para venderlos en P2P")
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
            "Precio real según tu monto, con comisiones, redondeo y colchón · usa órdenes de MERCADO, NO Convertir",
            [(f"Abrir {sym} en Spot", spot_url(pair)) for sym, pair in zip(o["tri"]["symbols"], o["tri"].get("pairs") or [])])
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
    fee, now = current_fee(), time.time()
    usdt_ads = market.get("USDT", {}).get("BUY") or market.get("USDT", {}).get("SELL") or []
    ref = usdt_ads[0]["price"] if usdt_ads else (usd_ref() or 0)
    computed, keep = {}, set()
    groups = all_profiles()
    for gkey in groups:
        cap, gmf = gkey[0], gkey[1]
        routes = routes_for(market, gkey)
        conversions = engine.usdt_conversions(engine.takeable(market, gkey[8], gkey[9]), graph, fee, gmf, cap, gkey[2], gkey[7])
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
            key, seen_key = "p2p:" + r["id"], f"p2p:{r['id']}@{tag_of(gkey)}"
            first_seen.setdefault(seen_key, now)
            keep.add(seen_key)
            found.append({"id": key, "kind": "p2p", "profit": r["profit"], "per_usd": r["per_usd"], "gain": r["profit_fiat"],
                          "since": first_seen[seen_key], "route": r, "tight": r["profit"] < SAFE_P2P})
        computed[gkey] = {"routes": routes, "conversions": conversions, "found": found}
    for key in [k for k in first_seen if k.startswith("p2p:") and k not in keep]:
        first_seen.pop(key, None)
    main_name = main_user()
    main = profile(main_name)  # historial y Telegram: el perfil del administrador principal
    own = computed.get(route_key(main)) or {"routes": [], "found": []}
    record_hour_best("p2p", own["routes"][0]["per_usd"] if own["routes"] else None, now)
    try:
        price_check(market)
    except Exception as e:  # una alerta rota no frena el escaneo
        logging.getLogger("arbicrypto").warning("alertas de precio: %s", e)
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
            if now - history_saved[0] >= HISTORY_SAVE_EVERY:
                history_saved[0] = now
                snapshot = list(history)
    if snapshot is not None:
        save_json(HISTORY_FILE, snapshot)

    for gkey, names in groups.items():
        cap, gmf, _, bank, tax = gkey[:5]
        extra = "".join([f", transferencia {money(bank)}" if bank else "", f", renta {num(tax * 100, 0)} %" if tax else ""])
        costs_txt = (f"Ya descuenta comisiones, el 4x1000 de lo que pagas ({money(cap * gmf)}){extra}" if gmf
                     else f"Ya descuenta comisiones (sin 4x1000){extra}")
        found = computed[gkey]["found"]
        by_min = {}
        for name in names:
            by_min.setdefault(profile(name)["min_per_usd"], []).append(name)
        for minimum, who in by_min.items():
            tag = f"{tag_of(gkey)}@{minimum}"
            sync_alerts(f"p2p@{tag}", {f"{o['id']}@{tag}": (
                "p2p", f"{per_usd(o['per_usd'])} en P2P" + (" · JUSTA, actúa rápido" if o["tight"] else ""),
                f"{route_text(o['route'])}\nCon {money(cap)}: {money(o['gain'])} de ganancia\n{costs_txt}",
                route_links(o["route"]))
                for o in found if o["per_usd"] >= minimum}, capital=cap, users=who, telegram_too=main_name in who)
    publish("p2p")


# ---------------------------------------------------------------- vigilancia de ventas

watches = []
watch_auto = {}  # por usuario: {"since": desde cuándo una compra crea su moneda sola, "done": órdenes ya usadas}
watch_lock = threading.Lock()


def qty8(v):
    return num(v, 2 if v >= 1 else 8)


def paid_with_gmf(user, cost):
    """Lo que de verdad te costo una moneda: lo que le pagaste al vendedor + el 4x1000 que cobro tu banco."""
    return engine.with_gmf(cost, profile(user)["gmf"])


def watch_need(w, o):
    """Pesos que tiene que dar la venta para cumplir el objetivo: recuperar lo pagado (con su 4x1000) + la meta."""
    extra = w["cost"] * WATCH_SPOT_EXTRA if len(o["path"]) > 1 else 0
    return paid_with_gmf(w["user"], w["cost"]) + extra + max(w["target"], 0)


def watch_eval(w, targets):
    """Mejor salida para una vigilancia y si ya cumple (ganancia >= objetivo, con margen extra si pasa por Spot)."""
    options, failed = engine.exit_options(w["asset"], w["qty"], graph, current_fee(), FIAT, targets, usd_ref() or 0,
                                          MIN_ORDERS, MIN_FINISH, *taker_fee_of(profile(w["user"])), *can_take_of(profile(w["user"])))
    best, best_gap = None, None
    for o in options:
        need = watch_need(w, o)
        o["profit"] = o["received"] - paid_with_gmf(w["user"], w["cost"])
        o["need_price"] = need / (o["qty"] - o.get("p2p_fee", 0))  # precio por unidad: el comprador paga lo que queda tras la comision
        o["even_price"] = (need - max(w["target"], 0)) / (o["qty"] - o.get("p2p_fee", 0))  # sin meta: solo para no perder
        o["ok"] = o["received"] >= need
        if best is None or o["received"] - need > best_gap:
            best, best_gap = o, o["received"] - need
    return best, failed


def watch_targets(w, now):
    """Mis monedas: solo vender directo en P2P la misma moneda (sin cambiar antes en Spot: es mas simple y sin riesgo de
    que el precio se mueva a mitad de camino). Solo si esa cripto no se vende en P2P en pesos, se pasa por USDT."""
    return [w["asset"]] if w["asset"] in P2P_ASSETS else ["USDT"]


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
    links = [(f"Abrir {h['symbol']} en Spot", spot_url(h.get("pair"))) for h in o.get("hops") or []]
    links.append(("Pasar a Fondos (gratis)", WALLET_URL))
    links.append((f"Vender {o['to']} a {ad['nick']}", advertiser_url(ad)))
    raise_alert(f"sell:{w['id']}:{w['alerts']}", "sell", title, body, user=w["user"], telegram_too=w["user"] == main_user(),
                links=links)


def watch_partial(w):
    """Comprador que NO acepta todo lo que tienes pero sí una parte (p. ej. compra de $200.000 a $300.000 y tú tienes
    $500.000): cuánto le vendes, cuánto recibes y cuánto ganas con esa parte, contra lo que te costó esa parte (con su
    4x1000). Solo venta directa en P2P. El mejor por ganancia; None si no hay."""
    p2p = state["p2p"]
    ads = ((market_for((p2p or {}).get("market", {}), profile(w["user"]))).get(w["asset"]) or {}).get("SELL") or []
    if not ads or not graph or w["qty"] <= 0:
        return None
    paid = paid_with_gmf(w["user"], w["cost"])
    fee = taker_fee_of(profile(w["user"]))
    best = None
    for ad in ads:
        if ad["max"] >= w["qty"] * ad["price"]:
            continue  # ese acepta todo: ya es la venta normal
        q = min(w["qty"], ad["max"] / ad["price"], ad["available"] or float("inf"), ad.get("max_qty") or float("inf"))
        if q <= 0 or q * ad["price"] < ad["min"] or q < ad.get("min_qty", 0) or ad.get("hold_btc", 0) > (w["qty"] if w["asset"] == "BTC" else 0):
            continue
        cut = engine.p2p_taker_fee(graph, w["asset"], q, *fee)
        received = (q - cut) * ad["price"]
        profit = received - paid * q / w["qty"]
        if best is None or profit > best["profit"]:
            best = {"ad": ad, "qty": q, "received": received, "profit": profit,
                    "ok": profit >= max(w["target"], 0) * q / w["qty"] and profit > 0}
    return best


def watch_partial_alert(w, part):
    ad, gain = part["ad"], round(part["profit"])
    title = f"Puedes vender una parte de tu {w['asset']} ganando {money(gain)}"
    body = (f"{ad['nick']} compra entre {money(ad['min'])} y {money(ad['max'])} a {money(ad['price'])}: no te recibe todo, pero "
            f"si le vendes {qty8(part['qty'])} {w['asset']} recibes {money(part['received'])} y ganas {money(gain)} con esa parte "
            f"(ya con comisión y 4x1000) · {', '.join(ad['methods'][:2])}\nEl resto lo sigo vigilando. Confirma el precio antes de vender.")
    raise_alert(f"sellpart:{w['id']}:{ad.get('user')}:{ad['price']}", "sell", title, body, user=w["user"],
                telegram_too=w["user"] == main_user(), links=[(f"Vender {w['asset']} a {ad['nick']}", advertiser_url(ad))])


def apply_order(w, o):
    """Una orden P2P sobre una moneda de la lista: comprar suma (cripto menos comisión, costo = lo pagado); vender
    resta lo vendido más la comisión y la parte proporcional de lo que costó. Guarda cómo estaba antes, para poder
    pasar el ajuste a otra moneda si no era de esta."""
    before = {"qty": w["qty"], "cost": w["cost"], "status": w["status"], "target": w.get("target") or 0}
    fee = float(o.get("commission") or 0)
    if o["side"] == "BUY":
        moved, cost_moved = max(o["amount"] - fee, 0), o["total"]
        w["qty"] += moved
        w["cost"] += o["total"]
        kind = "compraste"
    else:
        moved = min(o["amount"] + fee, w["qty"])
        cost_moved = w["cost"] * (moved / w["qty"]) if w["qty"] > 0 else w["cost"]
        w["cost"] -= cost_moved
        w["qty"] -= moved
        kind = "vendiste"
    # historial de la moneda: cómo empezó y cada orden que la movió (se ve al desplegar el ajuste)
    w.setdefault("start", {"t": w["created"], "qty": before["qty"], "cost": before["cost"]})
    w["moves"] = (w.get("moves") or [])[-49:] + [{
        "id": o.get("id"), "t": (o.get("time") or 0) / 1000 or time.time(), "kind": kind, "qty": o["amount"], "fee": fee,
        "price": o["price"], "total": o["total"], "moved": moved, "cost": cost_moved, "left": w["qty"], "cost_left": w["cost"]}]
    w["orders"] = sorted(set(w.get("orders") or []) | {o["id"]})[-300:]
    w["synced"] = {"t": time.time(), "kind": kind, "qty": o["amount"], "price": o["price"], "total": o["total"], "before": before,
                   "order": {k: o.get(k) for k in ("id", "side", "amount", "commission", "total", "price", "time")}}
    dust = 0.01 if w["asset"] in ("USDT", "USDC", "FDUSD") else 1e-8
    if w["qty"] <= dust:
        w.update(status="vendida", qty=max(w["qty"], 0.0), cost=max(w["cost"], 0.0))
    else:
        w["target"] = min(w.get("target") or 0, w["cost"] * 0.9)
        w.update(status="vigilando", last=None, full_t=0)  # con lo que te queda se calcula de nuevo


def watch_from_buy(user, o):
    """Moneda nueva en la lista a partir de una compra P2P: lo que te llegó (sin la comisión) y lo que pagaste."""
    fee = float(o.get("commission") or 0)
    t = (o.get("time") or 0) / 1000 or time.time()
    got = max(o["amount"] - fee, 0)
    return {"id": secrets.token_hex(6), "asset": o["asset"], "qty": got, "cost": o["total"], "target": 0,
            "user": user, "created": t, "expires": None, "status": "vigilando", "alerts": 0, "last": None,
            "alert": True, "auto": True, "start": {"t": t, "qty": 0, "cost": 0}, "orders": [o["id"]],
            "moves": [{"id": o["id"], "t": t, "kind": "compraste", "qty": o["amount"], "fee": fee, "price": o["price"],
                       "total": o["total"], "moved": got, "cost": o["total"], "left": got, "cost_left": o["total"]}]}


def sync_watches(user, orders):
    """Mis monedas se ajustan solas con las órdenes P2P de Binance hechas DESPUÉS de anotar la moneda: si vendes una
    parte, queda lo que te quedó con su costo proporcional (costo promedio); si compras más, se suma con lo que pagaste.
    Cada orden se cuenta una sola vez. Si vendiste todo, la moneda pasa a Terminadas. Con varias filas de la misma
    cripto va a la más reciente; si no era de esa, 'No era de esta' la pasa a otra (api_watch_move_sync).
    Si compras una cripto que no está en la lista, se agrega sola con lo que te llegó y lo que pagaste (solo compras
    hechas desde que esto empezó a funcionar, y cada compra una sola vez: si quitas esa moneda no vuelve a salir)."""
    changed = False
    with watch_lock:
        fresh = user not in watch_auto
        auto = watch_auto.setdefault(user, {"since": time.time(), "done": []})
        done = set(auto["done"])
        live = [w for w in watches if w["user"] == user and w["status"] in ("vigilando", "lista")]
        mine = [w for w in watches if w["user"] == user]
        ok = [o for o in orders if o.get("status") == "COMPLETED" and o.get("asset") and o.get("id")
              and (o.get("fiat") or FIAT) == FIAT]
        for asset in {w["asset"] for w in live} | {o["asset"] for o in ok if o.get("side") == "BUY"}:
            seen = {i for x in mine if x["asset"] == asset for i in (x.get("orders") or [])} | done  # ya contada
            rows = [x for x in live if x["asset"] == asset]
            if rows:
                w = max(rows, key=lambda x: x["created"])  # la más reciente de esa cripto
            else:  # compraste una que no tenías anotada: se crea sola con la primera compra nueva
                first = min((o for o in ok if o["asset"] == asset and o.get("side") == "BUY" and o["id"] not in seen
                             and (o.get("time") or 0) / 1000 > auto["since"]), key=lambda o: o["time"], default=None)
                if not first or len(live) >= WATCH_MAX:
                    continue
                w = watch_from_buy(user, first)
                watches.append(w)
                del watches[:-100]
                live.append(w)
                seen.add(first["id"])
                auto["done"].append(first["id"])
                changed = True
            new = sorted((o for o in ok if o["asset"] == asset and o["id"] not in seen
                          and (o.get("time") or 0) / 1000 >= w["created"]), key=lambda o: o["time"])
            for o in new:
                if w["status"] in ("vigilando", "lista"):
                    apply_order(w, o)
                    auto["done"].append(o["id"])
                    changed = True
        auto["done"] = auto["done"][-500:]
        if changed or fresh:
            save_json(WATCH_AUTO_FILE, watch_auto)
        if changed:
            save_json(WATCH_FILE, watches)
    if changed:
        wake["watch"].set()
        publish("watch")


spot_seen = {}  # por usuario: saldos de Spot de la última lectura (si cambian, se buscan cambios en Spot)


def watch_symbols(user):
    """Pares de Spot entre una moneda de su lista y otra que se vende en P2P (USDT→BTC, XRP→USDT...)."""
    with watch_lock:
        assets = {w["asset"] for w in watches if w["user"] == user and w["status"] in ("vigilando", "lista")}
    return sorted(sym for sym, (b, q) in pairs["data"].items()
                  if (b in assets and q in P2P_ASSETS) or (q in assets and b in P2P_ASSETS))


def spot_orders(trades):
    """Trades de Spot agrupados por orden (una orden de mercado se llena en varios trades): qué diste y qué te llegó."""
    by = {}
    for t in trades:
        pair = pairs["data"].get(t["symbol"])
        if not pair:
            continue
        base, quote = pair
        o = by.setdefault((t["symbol"], t["order"]), {"id": f"spot:{t['symbol']}:{t['order']}", "symbol": t["symbol"],
                                                      "from": quote if t["buyer"] else base, "to": base if t["buyer"] else quote,
                                                      "spent": 0.0, "got": 0.0, "time": 0})
        o["spent"] += t["quote"] if t["buyer"] else t["qty"]
        o["got"] += t["qty"] if t["buyer"] else t["quote"]
        if t["fee_asset"] == o["to"]:
            o["got"] -= t["fee"]  # la comisión de Spot sale de lo que te llega (si se paga en BNB, no)
        o["time"] = max(o["time"], t["time"])
    return sorted(by.values(), key=lambda o: o["time"])


def sync_spot(user, trades):
    """Si cambias en Spot una moneda de tu lista (p. ej. tus USDT por XRP), la fila pasa sola a la otra moneda con lo que
    te llegó y el costo en pesos de lo que cambiaste; si ya tenías esa moneda en la lista, se suma. Así, al venderla en P2P,
    la ganancia se mide contra lo que de verdad pagaste. Cada orden se cuenta una sola vez."""
    changed = False
    with watch_lock:
        auto = watch_auto.setdefault(user, {"since": time.time(), "done": []})
        done = set(auto["done"]) | {i for w in watches if w["user"] == user for i in (w.get("orders") or [])}
        for o in spot_orders(trades):
            t = o["time"] / 1000
            if o["id"] in done or o["spent"] <= 0 or o["got"] <= 0:
                continue
            live = [w for w in watches if w["user"] == user and w["status"] in ("vigilando", "lista")]
            src = max((w for w in live if w["asset"] == o["from"] and w["created"] <= t and w["qty"] > 0),
                      key=lambda w: w["created"], default=None)
            if not src:
                continue  # cambiaste algo que no está en tu lista
            moved = min(o["spent"], src["qty"])  # si cambiaste más de lo anotado, solo cuenta lo de esta fila
            got = o["got"] * moved / o["spent"]
            cost = src["cost"] * moved / src["qty"]
            dst = max((w for w in live if w["asset"] == o["to"] and w is not src), key=lambda w: w["created"], default=None)
            if not dst and len(live) >= WATCH_MAX and src["qty"] - moved > 0:
                continue
            src["qty"] -= moved
            src["cost"] -= cost
            src["moves"] = (src.get("moves") or [])[-49:] + [{
                "id": o["id"], "t": t, "kind": "cambiaste", "qty": moved, "to": o["to"], "got": got, "moved": moved,
                "cost": cost, "left": src["qty"], "cost_left": src["cost"]}]
            src["orders"] = sorted(set(src.get("orders") or []) | {o["id"]})[-300:]
            if src["cost"] < (usd_ref() or 4000):  # quedó menos de un dólar (polvo): la fila ya pasó a la otra moneda
                src.update(status="vendida", qty=max(src["qty"], 0.0), cost=max(src["cost"], 0.0), changed_to=o["to"])
            if not dst:
                dst = {"id": secrets.token_hex(6), "asset": o["to"], "qty": 0.0, "cost": 0.0, "target": 0, "user": user,
                       "created": t, "expires": None, "status": "vigilando", "alerts": 0, "last": None,
                       "alert": src.get("alert", True), "auto": True, "start": {"t": t, "qty": 0, "cost": 0}, "orders": [], "moves": []}
                watches.append(dst)
                del watches[:-100]
            dst["qty"] += got
            dst["cost"] += cost
            dst["moves"] = (dst.get("moves") or [])[-49:] + [{
                "id": o["id"], "t": t, "kind": "llego", "qty": got, "from": o["from"], "spent": moved, "moved": got,
                "cost": cost, "left": dst["qty"], "cost_left": dst["cost"]}]
            dst["orders"] = sorted(set(dst.get("orders") or []) | {o["id"]})[-300:]
            dst.update(status="vigilando", last=None)
            dst["synced"] = {"t": time.time(), "kind": "llego", "qty": got, "price": 0, "total": cost}
            auto["done"].append(o["id"])
            done.add(o["id"])
            changed = True
        if changed:
            auto["done"] = auto["done"][-500:]
            save_json(WATCH_AUTO_FILE, watch_auto)
            save_json(WATCH_FILE, watches)
    if changed:
        wake["watch"].set()
        publish("watch")


def watch_spot_step(user, acc, snap):
    """Busca cambios en Spot solo cuando cambió el saldo de Spot de alguna moneda de su lista (myTrades pesa 20 por par)."""
    symbols = watch_symbols(user)
    if not symbols:
        return
    with watch_lock:
        assets = {w["asset"] for w in watches if w["user"] == user and w["status"] in ("vigilando", "lista")}
    now = {a: round(snap["spot"].get(a, 0.0), 8) for a in assets}
    if spot_seen.get(user) == now:
        return
    sync_spot(user, acc.spot_trades(symbols))
    spot_seen[user] = now  # solo si se leyó bien: si falla, se intenta en la próxima lectura


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
        part = watch_partial(w)
        if part and best and part["ad"]["price"] <= best["ad"]["price"]:
            part = None  # vender todo paga igual o mejor: no hace falta partir
        if part and part["ok"] and alert_on and not (best and best["ok"]):
            key = f"{part['ad'].get('user')}:{part['ad']['price']}"
            if w.get("partial_key") != key:  # una vez por oferta: si cambia de precio o de comprador, avisa de nuevo
                w["partial_key"] = key
                watch_partial_alert(w, part)
        elif not (part and part["ok"]):
            w.pop("partial_key", None)
        w["last"] = {"t": time.time(), "failed": failed, "partial": part, "best": best and {
            "to": best["to"], "path": best["path"], "qty": best["qty"], "received": best["received"], "hops": best["hops"],
            "profit": best["profit"], "need_price": best["need_price"], "even_price": best["even_price"], "ok": best["ok"],
            "ad": best["ad"]}}
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


# ---------------------------------------------------------------- alertas de precio ("avisame cuando este barato")

price_alerts = []
price_lock = threading.Lock()


def wallet_qty(user, asset):
    """Lo que la persona tiene de `asset` en su Binance (Spot + Fondos) para vender; 0 si no tiene o es menos de un
    dólar (polvo: ningún anuncio lo recibe)."""
    acc = acc_state.get(user) or {}
    q = sum(float((acc.get(w) or {}).get(asset) or 0) for w in ("spot", "funding"))
    usd = engine.usdt_value(graph, asset, q) if q > 0 and graph else None
    return q if usd and usd >= 1 else 0.0


def price_ads(alert, market):
    """Anuncios que cuentan para esa alerta, del mejor al peor: BUY = los mas baratos para comprar, SELL = los que mas
    pagan al vender. Con mine=True solo los que te sirven por monto y medio de pago: al vender, los que reciben lo que
    tienes en tu Binance; sin saldo (o al comprar), los que aceptan tu capital."""
    pr = profile(alert["user"])
    cap = pr["capital"]
    held = wallet_qty(alert["user"], alert["asset"]) if alert["side"] == "SELL" else 0.0
    methods = pr["pay_methods"] if alert["side"] == "BUY" else pr["recv_methods"]

    def fits(ad):
        btc = held if alert["asset"] == "BTC" else 0.0
        return engine._fits(ad, held * ad["price"], held, btc) if held else engine._fits(ad, cap, cap / ad["price"])
    return [ad for ad in market.get(alert["asset"], {}).get(alert["side"]) or []
            if not alert.get("mine", True) or (fits(ad) and engine._pays_with(ad, methods) and engine.can_take(ad, *can_take_of(pr)))]


def price_meets(alert, ad):
    return ad["price"] <= alert["target"] if alert["side"] == "BUY" else ad["price"] >= alert["target"]


def ad_who(ad):
    return str(ad.get("user") or ad.get("nick") or "")


def price_check(market):
    """Revisa las alertas con los anuncios de este escaneo. Suena con CADA anunciante que llega a la meta (igual o mejor),
    tambien si sale una promocion mientras el precio ya estaba ahi, y otra vez si ese mismo anunciante mejora su precio.
    Mientras un anuncio siga igual no repite; si se va y vuelve, avisa de nuevo."""
    main_name = main_user()
    fired = []
    with price_lock:
        changed = False
        for a in price_alerts:
            if not a.get("on", True) or a["asset"] not in market:
                continue
            ads = price_ads(a, market)
            ad = ads[0] if ads else None
            meeting = [x for x in ads if price_meets(a, x)]
            hit = bool(meeting)
            a["last"] = {"t": time.time(), "price": ad["price"] if ad else None, "nick": ad["nick"] if ad else None, "hit": hit}
            seen = a.get("seen") or {}  # {anunciante: precio con el que ya se aviso}
            better = (lambda new, old: new < old) if a["side"] == "BUY" else (lambda new, old: new > old)
            fresh = [x for x in meeting if ad_who(x) not in seen or better(x["price"], seen[ad_who(x)])]
            now_seen = {ad_who(x): min(x["price"], seen.get(ad_who(x), x["price"])) if a["side"] == "BUY"
                        else max(x["price"], seen.get(ad_who(x), x["price"])) for x in meeting}
            if now_seen != seen:
                a["seen"] = now_seen  # los que ya no cumplen salen: si vuelven, avisa otra vez
                changed = True
            a["armed_off"] = hit
            if fresh:
                a["hits"] = a.get("hits", 0) + 1
                a["last_hit"] = time.time()
                fired.append((a, fresh[0]))  # el mejor de los nuevos
                changed = True
                if a.get("once"):
                    a["on"] = False
        if changed:
            save_json(PRICE_FILE, price_alerts)
    for a, ad in fired:
        unit = "cada dólar" if a["asset"] in ("USDT", "USDC", "FDUSD") else f"por {a['asset']}"
        verb = "Compra" if a["side"] == "BUY" else "Vende"
        title = f"{a['asset']} {'barato' if a['side'] == 'BUY' else 'caro'}: {money(ad['price'])} {unit}"
        body = (f"{verb} a {ad['nick']} a {money(ad['price'])} {unit} (tu meta: {money(a['target'])})\n"
                f"Acepta entre {money(ad['min'])} y {money(ad['max'])} · {', '.join(ad['methods'][:3])}")
        raise_alert(f"price:{a['id']}:{a['hits']}", "price", title, body, users=[a["user"]],
                    telegram_too=a["user"] == main_name,
                    links=[(f"{verb} {a['asset']} a {ad['nick']}", advertiser_url(ad))])


def price_alert_view(name):
    with price_lock:
        return sorted([a for a in price_alerts if a["user"] == name], key=lambda a: -a["created"])


BALANCE_EVERY = 15 * 60       # un punto del historial de tu capital cada 15 minutos
BALANCE_DAYS = 90             # y se guardan los últimos 90 días
balances = {}                 # {uid: [{"t", "fiat", "usdt"}]} (se carga de a uno al pedirlo)


def balance_points(uid):
    # siempre del almacenamiento: con varias copias del panel, la que guarda no es siempre la que responde
    balances[uid] = store.load(f"balhist_{uid}", None) or []
    return balances[uid]


def record_balance(user):
    """Guarda cuánto vale tu Binance (en pesos y USDT) para la gráfica de Inicio: ¿va de subida lo que tienes?"""
    uid = (auth.users.get(user) or {}).get("uid")
    view = account_view(user) if uid else None
    if not view or not view.get("total_fiat"):
        return
    now = time.time()
    with lock:
        pts = balance_points(uid)
        if pts and now - pts[-1]["t"] < BALANCE_EVERY:
            return
        pts.append({"t": now, "fiat": round(view["total_fiat"], 2), "usdt": round(view["total_usdt"], 4)})
        del pts[:-int(BALANCE_DAYS * 86400 / BALANCE_EVERY)]
        store.save(f"balhist_{uid}", pts)


CO_OFFSET = 5 * 3600  # Colombia es UTC-5: los días de la gráfica cortan a la medianoche de aquí


WALLET_INTERNAL = (os.environ.get("WALLET_INTERNAL_URL") or _ENV0.get("WALLET_INTERNAL_URL") or "http://127.0.0.1:8788").rstrip("/")


def wallet_sales(user, days):
    """Las ventas tal cual las muestra Resultados en la wallet (ganancia neta, con tus ajustes). None si no responde."""
    uid = (auth.users.get(user) or {}).get("uid")
    if not uid or not sso_secret:
        return None
    ts = int(time.time())
    try:
        r = requests.get(f"{WALLET_INTERNAL}/internal/resultados", params={"uid": uid, "ts": ts, "days": days},
                         headers={"X-Panel-Sig": sso.sign(sso_secret, f"resultados|{uid}|{ts}")}, timeout=6)
        sales = r.json().get("sales") if r.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None
    return [{"t": float(x["t"]), "gain": float(x["net"]), "total": float(x.get("gross") or 0), "known": 0 if x.get("missing") else 1}
            for x in sales] if isinstance(sales, list) else None


def performance(user, days=30):
    """Rendimiento real con TODAS tus órdenes P2P guardadas: cada venta contra lo que costó lo primero que compraste de
    esa cripto (FIFO), con la comisión de Binance y el 4x1000 de la compra (como Resultados en la wallet).
    Lo que vendiste sin compra registrada aquí (vino de otro lado) cuenta con ganancia 0."""
    wallet = wallet_sales(user, days)
    if wallet is not None:
        return summarize_sales(wallet, days, "wallet")
    gmf = profile(user)["gmf"]
    rows = sorted((o for o in db.orders(user) if o.get("status") == "COMPLETED" and (o.get("fiat") or FIAT) == FIAT
                   and o.get("amount")), key=lambda o: o["time"] or 0)
    lots, sales = {}, []
    for o in rows:
        fee, amount, total = float(o.get("commission") or 0), float(o["amount"]), float(o["total"] or 0)
        q = lots.setdefault(o["asset"], [])
        if o["side"] == "BUY":
            got = max(amount - fee, 0)
            if got > 0:
                q.append([got, total / got])
            continue
        need, cost, known = amount + fee, 0.0, 0.0
        while need > 1e-12 and q:
            take = min(need, q[0][0])
            cost += take * q[0][1]
            known += take
            need -= take
            q[0][0] -= take
            if q[0][0] <= 1e-12:
                q.pop(0)
        share = known / (amount + fee) if amount + fee else 0  # parte de la venta con compra registrada
        gain = (total * share - cost * (1 + gmf)) if share else 0.0
        sales.append({"t": (o["time"] or 0) / 1000, "gain": gain, "total": total, "asset": o["asset"], "known": share})
    return summarize_sales(sales, days, "binance")


def summarize_sales(sales, days, source):
    """Ganancia por día (Colombia) de los últimos `days` días y los totales."""
    sales = sorted(sales, key=lambda x: x["t"])
    now = time.time()
    today = (now - CO_OFFSET) // 86400
    start = today - days + 1
    by = {}
    for s_ in sales:
        d = (s_["t"] - CO_OFFSET) // 86400
        if d >= start:
            x = by.setdefault(d, {"gain": 0.0, "n": 0, "sold": 0.0})
            x["gain"] += s_["gain"]
            x["n"] += 1
            x["sold"] += s_["total"]
    out = [{"t": (start + i) * 86400 + CO_OFFSET, **by.get(start + i, {"gain": 0.0, "n": 0, "sold": 0.0})} for i in range(days)]
    period = [x for x in sales if x["t"] >= start * 86400 + CO_OFFSET]
    return {"days": out, "won": sum(x["gain"] for x in period), "sales": len(period), "sold": sum(x["total"] for x in period),
            "unknown": sum(1 for x in period if x["known"] < 0.999), "all_won": sum(x["gain"] for x in sales), "all_sales": len(sales),
            "since": sales[0]["t"] if sales else None, "source": source}


@app.get("/api/performance")
def api_performance():
    days = max(7, min(365, request.args.get("days", 30, type=int)))
    return jsonify(performance(g.user["name"], days))


@app.get("/api/balance-history")
def api_balance_history():
    uid = g.user.get("uid")
    with lock:
        pts = list(balance_points(uid)) if uid else []
    return jsonify(points=pts)


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
        try:
            watch_spot_step(user, acc, snap)  # antes que P2P: si cambiaste USDT por XRP y vendiste el XRP, primero llega el XRP
        except Exception as e:  # sin esto, igual siguen las órdenes P2P
            print(f"  cambios en Spot ({user}): {e}")
        sync_watches(user, snap["orders"])
        try:
            record_balance(user)
        except Exception as e:  # la gráfica no puede tumbar la lectura de la cuenta
            print(f"  historial de capital ({user}): {e}")
    publish("account")


# Errores de Binance que tienen solucion del lado del usuario (codigos de la API de Binance)
BINANCE_CODES = {
    -1021: "La hora de este PC no coincide con la de Binance. Sincroniza el reloj (Windows: Configuración → Hora e idioma → "
           "Sincronizar ahora).",
    -1022: "La Secret Key no corresponde a la API Key. Cópialas otra vez, completas.",
    -2014: "La API Key no tiene el formato correcto. Cópiala otra vez, completa.",
    -2015: ("Binance no acepta la llave: puede estar borrada, sin 'Habilitar lectura' o restringida a otra IP "
            "(en Gestión de API agrega la IP de este PC o servidor)."),
    -1002: "La llave no tiene permiso para leer esto en Binance: revisa que tenga 'Habilitar lectura'.",
}


def friendly_error(e):
    msg = str(e)
    code, status, wait = (getattr(e, k, None) for k in ("code", "status", "wait"))
    if isinstance(e, (requests.ConnectionError, requests.Timeout)) or any(
            k in msg for k in ("NameResolutionError", "getaddrinfo", "Max retries", "ConnectionError", "timed out")):
        return "Sin conexión con Binance (revisa el internet de este PC)"
    if isinstance(code, int) and code in BINANCE_CODES:
        return BINANCE_CODES[code]
    later = f" Se reintenta solo en {max(1, round(wait / 60))} min." if wait and wait >= 60 else ""
    if status == 418:
        return "Binance bloqueó por un tiempo la IP de este servidor por demasiadas consultas." + later
    if status == 429 or code == -1003 or "429" in msg or "rate limit" in msg:
        return "Binance pidió esperar por demasiadas consultas." + later
    if status == 451 or "451" in msg or "restricted location" in msg:
        return ("Binance no permite cuentas desde el país donde está el servidor (por ejemplo, EE. UU.). "
                "Los precios siguen funcionando; para conectar cuentas el panel debe correr en un servidor de otro país.")
    if status == 403:
        return "El firewall de Binance frenó las consultas de este servidor (HTTP 403). Se reintenta solo."
    if status and status >= 500:
        return f"Binance tiene problemas en este momento (HTTP {status}). Se reintenta solo."
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

# Páginas del sitio público (arbicrypto.org): se ven sin sesión y salen en los buscadores
SITE_PAGES = {"/inicio", "/arbitraje", "/vender", "/renta", "/precios", "/calculadora", "/seguridad", "/preguntas"}
PUBLIC_PATHS = {"/login", "/login.html", "/favicon.ico", "/robots.txt", "/api/auth/login", "/api/auth/register",
                "/api/public/mercado", "/api/auth/logout", "/salir",
                "/internal/binance", "/internal/avatar", "/internal/cuenta", "/internal/aviso"} | SITE_PAGES  # solo responde a la wallet de este servidor, con firma (ver internal_binance)  # cerrar sesión funciona aunque ya haya vencido
PUBLIC_PREFIXES = ("/_next/", "/coins/", "/brand/", "/icons/")
# Lo que puede abrir en el panel alguien con acceso solo a la wallet (entrar, ir a su wallet y salir)
WALLET_ONLY_PATHS = PUBLIC_PATHS | {"/wallet", "/login"}
# Lo único que responde arbicrypto.org (la portada): el resto vive en panel.arbicrypto.org
SITE_PATHS = PUBLIC_PATHS | {"/", "/wallet", "/panel"}


def on_site():
    """¿La petición llegó a la portada (arbicrypto.org o www.arbicrypto.org)?"""
    return bool(SITE_DOMAIN) and request.host.split(":")[0].lower() in (SITE_DOMAIN, f"www.{SITE_DOMAIN}")


def site_url(sub=""):
    """https://arbicrypto.org, https://panel.arbicrypto.org o https://wallet.arbicrypto.org (solo con SITE_DOMAIN)."""
    return f"https://{sub + '.' if sub else ''}{SITE_DOMAIN}"


def login_url(goto=None):
    """El login: en arbicrypto.org/login (VPS) o en /login de este mismo panel (PC). goto: "panel" o "wallet"."""
    q = f"?next={goto}" if goto else ""
    return f"{site_url()}/login{q}" if SITE_DOMAIN else f"/login{q}"


def panel_home():
    return f"{site_url('panel')}/" if SITE_DOMAIN else "/"


def after_login(goto):
    """A dónde sigue la persona después de entrar: su wallet o el panel."""
    return "/wallet" if goto in ("wallet", "/wallet") else panel_home()


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
    path = request.path
    if on_site() and path not in SITE_PATHS and not path.startswith(PUBLIC_PREFIXES):
        if path.startswith("/api/"):
            return jsonify(error="No existe."), 404
        return redirect(panel_home().rstrip("/") + path)  # arbicrypto.org/algo-del-panel -> panel.arbicrypto.org/algo
    # la portada: siempre en arbicrypto.org; en el panel, a quien llega sin sesión (en este PC)
    g.landing = path in SITE_PAGES or (path == "/" and (on_site() or (not g.user and not SITE_DOMAIN)))
    if g.user and g.user.get("access") == "wallet" and not g.landing and path not in WALLET_ONLY_PATHS \
            and not path.startswith(PUBLIC_PREFIXES):  # su usuario solo tiene la wallet: el panel lo manda allá
        if path.startswith("/api/"):
            return jsonify(error="Tu usuario solo tiene acceso a la wallet."), 403
        return redirect("/wallet")
    if path == "/login" and g.user:  # ya entró: sigue directo a donde iba
        resp = redirect(after_login(request.args.get("next")))
        if COOKIE_DOMAIN:  # sesión de antes de SITE_DOMAIN (solo de arbicrypto.org): sin esto panel. no la ve y el login da vueltas
            set_session_cookie(resp, request.cookies.get(COOKIE))
        return resp
    if g.user or g.landing or path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
        return None
    if path.startswith("/api/"):
        return jsonify(error="Inicia sesión para continuar."), 401
    return redirect(login_url("wallet" if path == "/wallet" else "panel" if SITE_DOMAIN else None))


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if not g.landing:  # la portada sí sale en los buscadores; el panel privado no
        resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
    if request.path.startswith("/api/") and not request.path.startswith("/api/avatar/"):  # las fotos si se guardan
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


def set_session_cookie(resp, token):
    resp.set_cookie(COOKIE, token, max_age=30 * 86400, httponly=True, samesite="Strict", secure=SECURE_COOKIE,
                    domain=COOKIE_DOMAIN)  # VPS: la misma sesión sirve en arbicrypto.org, panel. y wallet.
    return resp


def with_session(token):
    return set_session_cookie(jsonify(ok=True), token)


def clear_session(resp):
    resp.delete_cookie(COOKIE)
    if COOKIE_DOMAIN:  # la del dominio compartido y la vieja, solo de panel.arbicrypto.org
        resp.delete_cookie(COOKIE, domain=COOKIE_DOMAIN)
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
    return clear_session(jsonify(ok=True, login=login_url()))


@app.get("/salir")
def logout_page():
    """Cerrar sesión desde la wallet: cierra también la del panel. La cookie es SameSite=Strict:
    solo llega desde el panel o la wallet (mismo sitio), nunca desde una página ajena."""
    auth.logout(request.cookies.get(COOKIE))
    return clear_session(redirect(login_url()))


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


# ---------------------------------------------------------------- foto de perfil

AVATAR_MAX = 48 * 1024  # la foto llega recortada a 256 px y comprimida en el navegador
AVATAR_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
AVATAR_MAGIC = {"jpeg": (bytes([0xFF, 0xD8, 0xFF]),), "png": (bytes([0x89]) + b"PNG",), "webp": (b"RIFF",)}


@app.post("/api/me/avatar")
def api_avatar_set():
    m = AVATAR_RE.match(str(body().get("image") or ""))
    if not m:
        return jsonify(error="Elige una imagen JPG, PNG o WebP."), 400
    kind, data = m.group(1), m.group(2)
    try:
        raw = base64.b64decode(data, validate=True)
    except ValueError:
        return jsonify(error="La imagen no llegó bien. Intenta otra vez."), 400
    if len(raw) > AVATAR_MAX or not raw.startswith(AVATAR_MAGIC[kind]):
        return jsonify(error="Esa imagen no sirve o pesa demasiado. Prueba con otra."), 400
    store.save(f"avatar_{g.user['uid']}", {"type": kind, "data": data})
    auth.set_avatar(g.user["name"], time.time())
    publish("presence")  # el chat y el equipo la ven de una vez
    return jsonify(ok=True, avatars=auth.avatars())


@app.post("/api/me/avatar/delete")
def api_avatar_delete():
    store.save(f"avatar_{g.user['uid']}", None)
    auth.set_avatar(g.user["name"], None)
    publish("presence")
    return jsonify(ok=True, avatars=auth.avatars())


@app.get("/api/avatar/{uid}")
def api_avatar(uid):
    """La foto de un miembro del equipo (solo con sesión: el panel es privado)."""
    if not re.fullmatch(r"[0-9a-f]{16}", uid or ""):
        abort(404)
    doc = store.load(f"avatar_{uid}", None)
    if not doc or not doc.get("data"):
        abort(404)
    resp = Response(base64.b64decode(doc["data"]), mimetype=f"image/{doc['type']}")
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"  # la url cambia con cada foto nueva
    return resp


@app.get("/api/team")
@admin_only
def api_team():
    return jsonify(users=auth.list_users(), invites=auth.list_invites(), teams=auth.list_teams())


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
    sync_teams()
    with price_lock:
        price_alerts[:] = [x for x in price_alerts if x["user"] != name]
        save_json(PRICE_FILE, price_alerts)
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
    with price_lock:
        for x in price_alerts:
            if x["user"] == old:
                x["user"] = new
        save_json(PRICE_FILE, price_alerts)
    vault.rename(old, new)
    push.rename(old, new)
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


@app.post("/api/team/access")
@admin_only
def api_team_access():
    b = body()
    try:
        auth.set_access(str(b.get("username", "")), str(b.get("access", "")), g.user["name"])
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


# ---------------------------------------------------------------- equipos
# Cada quien está en un equipo o en ninguno. Los nuevos empiezan sin equipo: crean uno o piden unirse a otro.


def team_view(tid, me=None):
    t = auth.teams[tid]
    with lock:
        now_online = set(online)
    return {"id": tid, "name": t["name"], "owner": t.get("owner"), "created": t["created"], "mine": me is not None and t.get("owner") == me,
            "members": [{"name": n, "role": auth.users[n]["role"], "online": n in now_online} for n in auth.team_members(tid)]}


def my_team_brief(name):
    """Lo que la barra necesita: tu equipo y cuántas solicitudes o invitaciones esperan tu respuesta."""
    tid = auth.team_of(name)
    t = auth.teams[tid] if tid else None
    waiting = sum(1 for r in auth.team_requests.values()
                  if (r["kind"] == "invita" and r["user"] == name) or (r["kind"] == "pide" and t and r["team"] == tid and t.get("owner") == name))
    return {"id": tid, "name": t["name"] if t else None, "owner": bool(t) and t.get("owner") == name, "waiting": waiting}


def team_notify(user, title, body):
    raise_alert(f"team:{user}:{time.time()}", "team", title, body, user=user, telegram_too=False)


def team_error(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            out = fn(*args, **kwargs)
        except AuthError as e:
            return jsonify(error=str(e)), 400
        sync_teams()
        return out
    return wrapper


@app.get("/api/teams")
def api_teams():
    me = g.user["name"]
    tid = auth.team_of(me)
    owner = bool(tid) and auth.teams[tid].get("owner") == me
    reqs = list(auth.team_requests.values())
    name_of = lambda t: auth.teams[t]["name"] if t in (auth.teams or {}) else "?"
    return jsonify(
        team=team_view(tid, me) if tid else None,
        # para unirse: los demás equipos (sin ver quiénes están, solo cuántos)
        teams=[{"id": t["id"], "name": t["name"], "owner": t.get("owner"), "size": len(t["members"]),
                "asked": any(r["team"] == t["id"] and r["user"] == me for r in reqs)}
               for t in auth.list_teams() if t["id"] != tid],
        invites=[{**r, "team_name": name_of(r["team"])} for r in reqs if r["kind"] == "invita" and r["user"] == me],
        asked=[{**r, "team_name": name_of(r["team"])} for r in reqs if r["kind"] == "pide" and r["user"] == me],
        requests=[r for r in reqs if owner and r["team"] == tid and r["kind"] == "pide"],
        invited=[r for r in reqs if owner and r["team"] == tid and r["kind"] == "invita"],
        free=[n for n in sorted(auth.users) if owner and n != me and not auth.team_of(n)],
    )


@app.post("/api/teams/create")
@team_error
def api_teams_create():
    auth.create_team(body().get("name"), owner=g.user["name"])
    return jsonify(ok=True)


@app.post("/api/teams/rename")
@team_error
def api_teams_rename():
    tid = auth.team_of(g.user["name"])
    if not tid:
        raise AuthError("No estás en ningún equipo.")
    auth.rename_team(tid, body().get("name"), by=g.user["name"])
    return jsonify(ok=True)


@app.post("/api/teams/request")
@team_error
def api_teams_request():
    r = auth.request_join(g.user["name"], str(body().get("team") or ""))
    owner = auth.teams[r["team"]].get("owner")
    if owner:
        team_notify(owner, f"{g.user['name']} quiere unirse a {auth.teams[r['team']]['name']}", "Acéptalo o recházalo en la pestaña Equipo.")
    return jsonify(ok=True)


@app.post("/api/teams/invite")
@team_error
def api_teams_invite():
    r = auth.invite_to_team(g.user["name"], str(body().get("username") or ""))
    team_notify(r["user"], f"{g.user['name']} te invita a {auth.teams[r['team']]['name']}", "Acepta o rechaza en la pestaña Equipo.")
    return jsonify(ok=True)


@app.post("/api/teams/answer")
@team_error
def api_teams_answer():
    b = body()
    accept = bool(b.get("accept"))
    r = auth.answer_request(str(b.get("id") or ""), g.user["name"], accept, admin=g.user["role"] == "admin")
    team = auth.teams[r["team"]]["name"]
    if r["kind"] == "pide":
        team_notify(r["user"], f"{'Ya estás en' if accept else 'No te aceptaron en'} {team}",
                    "Ya puedes escribirle a tu equipo en el chat." if accept else "Puedes pedir unirte a otro equipo o crear el tuyo.")
    elif r["by"] in auth.users:
        team_notify(r["by"], f"{r['user']} {'aceptó' if accept else 'no aceptó'} tu invitación", f"Equipo {team}.")
    return jsonify(ok=True)


@app.post("/api/teams/cancel")
@team_error
def api_teams_cancel():
    auth.cancel_request(str(body().get("id") or ""), g.user["name"])
    return jsonify(ok=True)


@app.post("/api/teams/leave")
@team_error
def api_teams_leave():
    auth.leave_team(g.user["name"])
    return jsonify(ok=True)


@app.post("/api/teams/kick")
@team_error
def api_teams_kick():
    name = str(body().get("username") or "")
    auth.kick(g.user["name"], name)
    team_notify(name, "Saliste del equipo", f"{g.user['name']} te sacó del equipo.")
    return jsonify(ok=True)


# administradores: crean equipos, ponen y sacan a cualquiera, y los borran

@app.post("/api/team/teams/create")
@admin_only
@team_error
def api_admin_team_create():
    return jsonify(ok=True, id=auth.create_team(body().get("name")))


@app.post("/api/team/teams/rename")
@admin_only
@team_error
def api_admin_team_rename():
    b = body()
    auth.rename_team(str(b.get("id") or ""), b.get("name"))
    return jsonify(ok=True)


@app.post("/api/team/teams/assign")
@admin_only
@team_error
def api_admin_team_assign():
    b = body()
    name, tid = str(b.get("username") or ""), b.get("team") or None
    auth.set_team(name, str(tid) if tid else None)
    if tid and name != g.user["name"]:
        team_notify(name, f"Ahora estás en {auth.teams[str(tid)]['name']}", f"{g.user['name']} te puso en ese equipo.")
    return jsonify(ok=True)


@app.post("/api/team/teams/delete")
@admin_only
@team_error
def api_admin_team_delete():
    auth.delete_team(str(body().get("id") or ""))
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
                                      MIN_ORDERS, MIN_FINISH, *taker_fee_of(profile(g.user["name"])), *can_take_of(profile(g.user["name"])))
    except (requests.RequestException, engine.BinanceError) as e:
        return jsonify(error=friendly_error(e)), 502
    finally:
        p2p_hold.clear()
        exit_busy.release()
    spent = paid_with_gmf(g.user["name"], cost) if cost else 0  # lo que pagaste + su 4x1000
    for o in options:
        o["profit"] = o["received"] - spent if cost else None
        if o["backup"]:
            o["backup"]["profit"] = o["backup"]["received"] - spent if cost else None
        # precio minimo por unidad de la cripto que vendes para recuperar lo que pagaste (con su 4x1000)
        o["breakeven"] = spent / o["qty"] if cost else None
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
        amounts = any(changed.get(k) != w.get(k) for k in ("qty", "cost"))
        w.update(changed)
        if numbers:  # con datos nuevos se vuelve a calcular desde cero
            w.update(status="vigilando", last=None, full_t=0)
            w.pop("synced", None)  # lo escribiste a mano: el último ajuste con Binance ya no aplica
            if w.get("moves") and amounts:  # queda en el historial que lo corregiste
                w["moves"] = w["moves"][-49:] + [{"t": time.time(), "kind": "editaste", "left": w["qty"], "cost_left": w["cost"]}]
        elif b.get("alert") is True and w["status"] == "lista":
            w["status"] = "vigilando"  # al prender el aviso con una oferta ya buena: se confirma y avisa
        save_json(WATCH_FILE, watches)
    wake["watch"].set()
    publish("watch")
    return jsonify(ok=True)


@app.post("/api/watches/move-sync")
def api_watch_move_sync():
    """'No era de esta': deshace el último ajuste automático de una moneda y lo aplica a otra de la misma cripto."""
    b = body()
    with watch_lock:
        mine = {w["id"]: w for w in watches if w["user"] == g.user["name"]}
        src, dst = mine.get(str(b.get("from") or "")), mine.get(str(b.get("to") or ""))
        sync = (src or {}).get("synced") or {}
        if not src or not dst or src is dst or src["asset"] != dst["asset"] or not sync.get("before") or not sync.get("order"):
            return jsonify(error="No se puede pasar ese ajuste."), 400
        if dst["status"] not in ("vigilando", "lista"):
            return jsonify(error="Esa moneda ya está terminada."), 400
        src.update(qty=sync["before"]["qty"], cost=sync["before"]["cost"], status=sync["before"]["status"],
                   target=sync["before"].get("target", src.get("target")), last=None, full_t=0)
        src["orders"] = [i for i in (src.get("orders") or []) if i != sync["order"]["id"]]
        src["moves"] = [m for m in (src.get("moves") or []) if m.get("id") != sync["order"]["id"]]
        if not src["moves"]:
            src.pop("start", None)
        src.pop("synced", None)
        apply_order(dst, sync["order"])
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


def price_input(b, base=None):
    """Valida una alerta de precio (nueva o cambios sobre `base`)."""
    a = dict(base or {})
    if "asset" in b or not base:
        a["asset"] = str(b.get("asset") or "").upper()
    if "side" in b or not base:
        a["side"] = str(b.get("side") or "BUY").upper()
    for k in ("mine", "on", "once"):
        if k in b:
            a[k] = bool(b[k])
    if "target" in b or not base:
        try:
            a["target"] = float(b.get("target"))
        except (TypeError, ValueError):
            a["target"] = 0
    if a["asset"] not in P2P_ASSETS:
        raise ValueError("Esa cripto no está en P2P.")
    if a["side"] not in ("BUY", "SELL"):
        raise ValueError("Elige comprar o vender.")
    if not 0 < a["target"] < 1e12:
        raise ValueError("Escribe el precio al que quieres que te avise.")
    return a


@app.post("/api/price-alerts")
def api_price_add():
    try:
        a = price_input(body())
    except ValueError as e:
        return jsonify(error=str(e)), 400
    with price_lock:
        if sum(x["user"] == g.user["name"] for x in price_alerts) >= PRICE_ALERT_MAX:
            return jsonify(error=f"Máximo {PRICE_ALERT_MAX} alertas. Borra una primero."), 400
        a.update(id=secrets.token_hex(6), user=g.user["name"], created=time.time(), hits=0, last=None, armed_off=False,
                 on=a.get("on", True), mine=a.get("mine", True), once=a.get("once", False))
        price_alerts.append(a)
        save_json(PRICE_FILE, price_alerts)
    publish("watch")
    return jsonify(ok=True, id=a["id"])


@app.post("/api/price-alerts/update")
def api_price_update():
    b = body()
    with price_lock:
        a = next((x for x in price_alerts if x["id"] == str(b.get("id") or "") and x["user"] == g.user["name"]), None)
        if not a:
            return jsonify(error="Esa alerta ya no existe."), 404
        try:
            new = price_input(b, a)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        if any(new.get(k) != a.get(k) for k in ("asset", "side", "target", "mine")) or (new.get("on") and not a.get("on")):
            new["armed_off"], new["seen"] = False, {}  # meta nueva: puede avisar otra vez con todos
        a.update(new)
        save_json(PRICE_FILE, price_alerts)
    publish("watch")
    return jsonify(ok=True)


@app.post("/api/price-alerts/delete")
def api_price_delete():
    pid = str(body().get("id") or "")
    with price_lock:
        a = next((x for x in price_alerts if x["id"] == pid and x["user"] == g.user["name"]), None)
        if not a:
            return jsonify(error="Esa alerta ya no existe."), 404
        price_alerts.remove(a)
        save_json(PRICE_FILE, price_alerts)
    publish("watch")
    return jsonify(ok=True)


@app.get("/api/state")
def api_state():
    with lock:
        name = g.user["name"]  # saldos, ordenes y llave de Binance: solo los de su propia cuenta
        me = profile(name)
        cap = me["capital"]
        rkey = route_key(me)
        mine = by_capital.get(rkey)
        p2p = state["p2p"]
        if p2p and mine is None and graph:  # capital, costos o medios recien cambiados: se calcula ya con los anuncios guardados
            routes = routes_for(p2p["market"], rkey)
            ref = usd_ref() or 0
            for r in routes:
                r["per_usd"] = r["profit"] * ref
            mine = {"routes": routes, "conversions": engine.usdt_conversions(market_for(p2p["market"], me), graph, current_fee(), me["gmf"], cap,
                                                                             rkey[2], rkey[7]),
                    "found": []}
        if p2p:
            p2p = {**p2p, "market": market_for(p2p["market"], me),  # sin los anuncios que su cuenta no puede tomar
                   "routes": (mine or {}).get("routes", []), "conversions": (mine or {}).get("conversions")}
        return jsonify({
            "boot": BOOT, "now": time.time(), "settings": public_settings(g.user), "fee": current_fee(), "p2p_fee": effective_fee(me),
            "p2p_fee_auto": effective_fee({**me, "taker_fee": -1}), "price_alerts": price_alert_view(name),
            # porcentaje y minimo fijo por separado: con otro monto (simulador, otros montos) el minimo pesa distinto
            "p2p_fee_rate": taker_fee_of(me)[0], "p2p_fee_min_usd": taker_fee_of(me)[1],
            "maker_fee": maker_fee(name), "spot": state["spot"], "p2p": p2p, "account": account_view(name),
            "opps": sorted([o for o in (mine or {}).get("found", []) + opps["spot"] if o["per_usd"] >= me["min_per_usd"]],
                           key=lambda o: -o["per_usd"]),
            "connected": name in accounts, "key_hint": accounts[name].hint() if name in accounts else None,
            "can_connect": can_connect(), "local": is_local(), "team": TEAM, "user": g.user, "my_team": my_team_brief(name), "avatars": auth.avatars(), "telegram": telegram.info(), "usd_ref": usd_ref(),
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
    raw = body()
    b = {k: v for k, v in raw.items() if k in PERSONAL}
    lists = {k: clean_methods(raw[k]) for k in METHOD_LISTS if k in raw}
    lists.update(clean_muted(raw))
    lists.update(clean_account(raw))
    if not b and not lists:
        return jsonify(error="Nada que guardar."), 400
    # capital, 4x1000, "avisar desde", costos y medios son de cada usuario, tambien de los administradores
    clean = clean_settings({**profile(g.user["name"]), **b})
    with lock:
        prefs[g.user["name"]] = {**prefs.get(g.user["name"], {}), **{k: clean[k] for k in b}, **lists}
        save_json(PREFS_FILE, prefs)
    for e in wake.values():
        e.set()
    return jsonify(public_settings(g.user))


@app.post("/api/connect")
def api_connect():
    """Cada usuario conecta SU cuenta (solo lectura); reemplaza la que tuviera antes."""
    if not can_connect():
        return jsonify(error="Por seguridad, las llaves solo se ingresan desde el PC donde corre el panel (o por HTTPS en el servidor)."), 403
    # al copiar se cuelan espacios, saltos de linea o caracteres invisibles; las llaves de Binance son solo letras y numeros
    key, secret = (re.sub(r"[\s\u200b-\u200d\u2060\ufeff]+", "", str(body().get(k, ""))) for k in ("key", "secret"))
    if not key or not secret:
        return jsonify(error="Pega la API Key y la Secret Key."), 400
    if not re.fullmatch(r"[A-Za-z0-9]{16,256}", key) or not re.fullmatch(r"[A-Za-z0-9]{16,256}", secret):
        return jsonify(error="La API Key y la Secret Key son solo letras y números (64 cada una). Cópialas otra vez completas; "
                             "la llave debe ser “Generada por el sistema”."), 400
    acc = engine.Account(key, secret)
    try:
        perms = acc.permissions()
        risky = engine.risky_permissions(perms)
        if risky:
            return jsonify(error=f"Por seguridad solo se aceptan llaves de SOLO LECTURA. Esta tiene: {', '.join(risky)}. "
                                 "Crea una llave nueva marcando únicamente 'Habilitar lectura'."), 400
        if not perms.get("enableReading"):
            return jsonify(error="Esta llave no tiene activado 'Habilitar lectura'. Actívalo en Binance (Gestión de API)."), 400
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


@app.get("/api/push/key")
def api_push_key():
    return jsonify(key=push.public)


@app.post("/api/push/subscribe")
def api_push_subscribe():
    try:
        push.subscribe(g.user["name"], str(body().get("endpoint") or ""))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


@app.post("/api/push/unsubscribe")
def api_push_unsubscribe():
    push.unsubscribe(g.user["name"], str(body().get("endpoint") or ""))
    return jsonify(ok=True)


@app.get("/api/push/recent")
def api_push_recent():
    """Lo que muestra el service worker cuando llega un push: los avisos de los últimos 2 minutos."""
    since = time.time() - 120
    with lock:
        mine = [a for a in state["alerts"] if a["t"] >= since and alert_visible(a, g.user)]
    return jsonify([{k: a.get(k) for k in ("id", "kind", "title", "body")} for a in mine[:4]])


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
CHAT_IMG_DIR = os.path.join(DATA_DIR, "chat_img")
CHAT_IMG_MAX = 3 * 1024 * 1024  # 3 MB por imagen (el navegador la reduce antes de enviarla)
CHAT_IMG_TYPES = {"jpeg": (b"\xff\xd8\xff",), "png": (b"\x89PNG",), "gif": (b"GIF8",), "webp": (b"RIFF",)}
CHAT_EMOJIS = ("👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "💰")
CHAT_BURST = (12, 20)     # maximo 12 mensajes cada 20 s por usuario


def team_chat_key(name):
    """El chat General de tu equipo ("#<id>"), o None si no estás en ninguno."""
    tid = auth.team_of(name)
    gid = tid and auth.teams[tid].get("chat")
    return f"#{gid}" if gid else None


def team_chat_keys():
    return {f"#{t['chat']}" for t in (auth.teams or {}).values() if t.get("chat")}


def sync_team_chat(tid):
    """El chat de cada equipo tiene exactamente a sus miembros (se crea si falta)."""
    t = (auth.teams or {}).get(tid)
    if not t:
        return None
    members = auth.team_members(tid)
    grp = db.chat_group(t["chat"]) if t.get("chat") else None
    if grp:
        if grp["name"] != t["name"] or sorted(grp["members"]) != members:
            db.update_group(grp["id"], t["name"], members)
        return grp["id"]
    gid = db.add_group(t["name"], members, "")
    auth.set_team_chat(tid, gid)
    return gid


def sync_teams():
    for tid in list(auth.teams or {}):
        sync_team_chat(tid)
    alive = {t.get("chat") for t in (auth.teams or {}).values()}
    for grp in db.chat_groups():  # equipos borrados: su chat se va con ellos
        if grp["created_by"] == "" and grp["id"] not in alive:
            for name in db.delete_group(grp["id"]):
                try:
                    os.remove(os.path.join(CHAT_IMG_DIR, name))
                except OSError:
                    pass
    publish("chat")
    publish("team")


def ensure_teams():
    """La primera vez que corre con equipos: todos los usuarios de siempre quedan en "Equipo principal" y el canal
    General de siempre pasa a ser el chat de ese equipo. De ahí en adelante, quien entra empieza sin equipo."""
    if auth.teams is None and auth.users:
        tid = auth.create_team("Equipo principal")
        for name in list(auth.users):
            auth.set_team(name, tid)
        with auth.lock:
            auth.teams[tid]["owner"] = main_user()
            auth._persist("teams")
        gid = sync_team_chat(tid)
        db.move_general(f"#{gid}")
    for tid in list(auth.teams or {}):
        sync_team_chat(tid)


def chat_peer(raw, must_exist=True):
    """"" = el General de tu equipo (None si no tienes), "#<id>" = un subgrupo en el que está quien pregunta, o el
    nombre del otro en un privado (solo con quien puedes hablar: los de tu equipo y los administradores)."""
    peer = str(raw or "")
    if not peer:
        return team_chat_key(g.user["name"])
    if peer.startswith("#"):
        grp = db.chat_group(int(peer[1:])) if re.fullmatch(r"#\d{1,9}", peer) else None
        if not grp or g.user["name"] not in grp["members"]:
            abort(404 if must_exist else 403)
        return peer
    if peer == g.user["name"] or (must_exist and not auth.can_talk(g.user["name"], peer)):
        abort(400)
    return peer


GROUP_NAME_MAX = 40


def group_input(b):
    """(nombre, miembros) de un subgrupo, validados: los miembros tienen que existir y quien lo arma queda dentro."""
    name = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()
    if not name or len(name) > GROUP_NAME_MAX:
        raise ValueError(f"Ponle un nombre al grupo (máximo {GROUP_NAME_MAX} letras).")
    raw = b.get("members") if isinstance(b.get("members"), list) else []
    members = {str(m) for m in raw if auth.can_talk(g.user["name"], str(m))}
    if not members - {g.user["name"]}:
        raise ValueError("Elige al menos una persona más para el grupo.")
    return name, members


def group_for_edit(b):
    """El subgrupo que quien pregunta puede cambiar: lo creó él, o es administrador."""
    try:
        grp = db.chat_group(int(b.get("id") or 0))
    except (TypeError, ValueError):
        abort(400)
    if not grp:
        abort(404)
    if grp["key"] in team_chat_keys():
        abort(403)  # el chat del equipo se arma solo con sus miembros (pestaña Equipo)
    if grp["created_by"] != g.user["name"] and g.user["role"] != "admin":
        abort(403)
    return grp


@app.get("/api/chat")
def api_chat():
    me = g.user["name"]
    with lock:
        now_online = set(online)
    users = [{"name": u["username"], "role": u["role"], "online": u["username"] in now_online}
             for u in auth.list_users() if u["username"] != me and auth.can_talk(me, u["username"])]
    teams, mine = team_chat_keys(), team_chat_key(me)
    groups = [{**x, "can_edit": x["created_by"] == me or g.user["role"] == "admin"} for x in db.chat_groups(me) if x["key"] not in teams]
    channels = {}
    for k, v in db.chat_summary(me).items():
        if k == mine:
            channels[""] = v  # el General es el chat de tu equipo
        elif k and k not in teams:
            channels[k] = v
    tid = auth.team_of(me)
    return jsonify(me=me, users=users, channels=channels, groups=groups, team=auth.teams[tid]["name"] if tid else None)


@app.post("/api/chat/groups")
def api_chat_group_create():
    """Cualquiera del equipo puede armar un subgrupo; queda dentro y lo puede editar."""
    try:
        name, members = group_input(body())
    except ValueError as e:
        return jsonify(error=str(e)), 400
    gid = db.add_group(name, members | {g.user["name"]}, g.user["name"])
    publish("chat")
    return jsonify(ok=True, key=f"#{gid}")


@app.post("/api/chat/groups/update")
def api_chat_group_update():
    b = body()
    grp = group_for_edit(b)
    try:
        name, members = group_input(b)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    if grp["created_by"] in auth.users:
        members.add(grp["created_by"])  # quien lo creó sigue dentro
    db.update_group(grp["id"], name, members)
    publish("chat")
    return jsonify(ok=True)


@app.post("/api/chat/groups/leave")
def api_chat_group_leave():
    try:
        grp = db.chat_group(int(body().get("id") or 0))
    except (TypeError, ValueError):
        abort(400)
    me = g.user["name"]
    if not grp or me not in grp["members"]:
        abort(404)
    if grp["key"] in team_chat_keys():
        return jsonify(error="Es el chat de tu equipo: para salir, sal del equipo."), 400
    if grp["created_by"] == me:
        return jsonify(error="Creaste este grupo: bórralo o pídele a un administrador que lo maneje."), 400
    db.update_group(grp["id"], grp["name"], [m for m in grp["members"] if m != me])
    publish("chat")
    return jsonify(ok=True)


@app.post("/api/chat/groups/delete")
def api_chat_group_delete():
    grp = group_for_edit(body())
    for name in db.delete_group(grp["id"]):
        try:
            os.remove(os.path.join(CHAT_IMG_DIR, name))
        except OSError:
            pass
    publish("chat")
    return jsonify(ok=True)


@app.get("/api/chat/messages")
def api_chat_messages():
    peer = chat_peer(request.args.get("peer"), must_exist=False)
    before = request.args.get("before", 0, type=int)
    if peer is None:
        return jsonify(messages=[])  # sin equipo todavía: el General está vacío
    return jsonify(messages=db.messages(g.user["name"], peer, before or None))


def can_see(msg, user):
    """El general de antes lo ven todos; un equipo o subgrupo, sus miembros; un privado, solo sus dos personas."""
    if not msg:
        return False
    to = msg["to"]
    if to and to.startswith("#"):
        grp = db.chat_group(int(to[1:])) if to[1:].isdigit() else None
        return bool(grp) and user in grp["members"]
    return to is None or user in (msg["from"], to)


def save_chat_image(data_url):
    """data:image/...;base64,... -> nombre del archivo guardado en backend/data/chat_img."""
    m = re.fullmatch(r"data:image/(jpeg|png|gif|webp);base64,([A-Za-z0-9+/=\s]+)", str(data_url or ""))
    if not m:
        raise ValueError("Esa imagen no se puede enviar (usa JPG, PNG, GIF o WEBP).")
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except (ValueError, binascii.Error):
        raise ValueError("La imagen está dañada.")
    kind = m.group(1)
    if len(raw) > CHAT_IMG_MAX:
        raise ValueError("La imagen pesa demasiado (máximo 3 MB).")
    if not raw.startswith(CHAT_IMG_TYPES[kind]) or (kind == "webp" and raw[8:12] != b"WEBP"):
        raise ValueError("Eso no parece una imagen.")
    os.makedirs(CHAT_IMG_DIR, exist_ok=True)
    name = f"{secrets.token_hex(12)}.{'jpg' if kind == 'jpeg' else kind}"
    with open(os.path.join(CHAT_IMG_DIR, name), "wb") as f:
        f.write(raw)
    return name


@app.get("/api/chat/image")
def api_chat_image():
    name = str(request.args.get("name") or "")
    if not re.fullmatch(r"[0-9a-f]{24}\.(jpg|png|gif|webp)", name):
        abort(404)
    msg = db.message_by_image(name)
    if not can_see(msg, g.user["name"]):
        abort(404)
    resp = send_from_directory(CHAT_IMG_DIR, name)
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return resp


@app.post("/api/chat/react")
def api_chat_react():
    b = body()
    try:
        msg = db.message(int(b.get("id") or 0))
    except (TypeError, ValueError):
        abort(400)
    emoji = str(b.get("emoji") or "")
    if emoji and emoji not in CHAT_EMOJIS:
        return jsonify(error="Esa reacción no está disponible."), 400
    if not can_see(msg, g.user["name"]):
        return jsonify(error="Ese mensaje ya no existe."), 404
    db.react(msg["id"], g.user["name"], emoji)
    publish("chat")
    return jsonify(ok=True)


@app.post("/api/chat/send")
def api_chat_send():
    b = body()
    me = g.user["name"]
    peer = chat_peer(b.get("peer"))
    if peer is None:
        return jsonify(error="Todavía no estás en un equipo: únete o crea uno en la pestaña Equipo."), 400
    text = str(b.get("body") or "").strip()
    reply_to = None
    if b.get("reply_to"):
        try:
            quoted = db.message(int(b.get("reply_to")))
        except (TypeError, ValueError):
            abort(400)
        # solo se responde a un mensaje de la misma conversacion
        same = quoted and (quoted["to"] == peer if peer.startswith("#") else {quoted["from"], quoted["to"]} == {me, peer})
        if not same:
            return jsonify(error="Ese mensaje ya no existe."), 400
        reply_to = quoted["id"]
    if not text and not b.get("image"):
        return jsonify(error="Escribe un mensaje."), 400
    if len(text) > CHAT_MAX:
        return jsonify(error=f"Máximo {CHAT_MAX} caracteres por mensaje."), 400
    now = time.time()
    with lock:
        recent = [t for t in chat_sent.get(me, []) if now - t < CHAT_BURST[1]]
        if len(recent) >= CHAT_BURST[0]:
            return jsonify(error="Vas muy rápido. Espera unos segundos."), 429
        chat_sent[me] = recent + [now]
    image = None
    if b.get("image"):
        try:
            image = save_chat_image(b["image"])
        except ValueError as e:
            return jsonify(error=str(e)), 400
    msg = db.add_message(me, peer or None, text, reply_to, image)
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
    if last_id > 0 and peer is not None:
        db.mark_read(g.user["name"], peer, last_id)
    return jsonify(ok=True)


@app.post("/api/chat/delete")
def api_chat_delete():
    try:
        msg = db.message(int(body().get("id") or 0))
    except (TypeError, ValueError):
        abort(400)
    me = g.user
    # cada quien borra lo suyo; el administrador tambien puede borrar del canal general y de los subgrupos donde esta
    shared = msg and (msg["to"] is None or (msg["to"].startswith("#") and can_see(msg, me["name"])))
    if not msg or not (msg["from"] == me["name"] or (shared and me["role"] == "admin")):
        return jsonify(error="Solo puedes borrar tus propios mensajes."), 403
    db.delete_message(msg["id"])
    if msg.get("image"):
        try:
            os.remove(os.path.join(CHAT_IMG_DIR, msg["image"]))
        except OSError:
            pass
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


# ---------------------------------------------------------------- historial y exportaciones

def csv_response(text, filename):
    return Response(text, mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def local_time(t):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(t))


@app.get("/api/history/stats")
def api_history_stats():
    days = min(max(request.args.get("days", 7, type=int), 1), 120)
    opps_rows, hours = db.stats(days)
    cap = profile(g.user["name"])["capital"]
    for o in opps_rows:  # la ganancia se guardo con el capital del equipo: se muestra con el tuyo, en proporcion
        if o.get("capital"):
            o["best_gain"] = o["best_gain"] / o["capital"] * cap
            o["capital"] = cap
    return jsonify(opps=opps_rows, hours=hours, days=days, capital=cap)


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

def wallet_url():
    """Dirección de la wallet: WALLET_URL de backend/.env, o la que corresponde a este panel
    (panel.arbicrypto.org -> wallet.arbicrypto.org; en este PC, el puerto 8788)."""
    url = (os.environ.get("WALLET_URL") or _ENV0.get("WALLET_URL", "")).strip().rstrip("/")
    if url:
        return url
    if SITE_DOMAIN:
        return site_url("wallet")
    host = request.host.split(":")[0]
    if host.startswith("panel."):
        return f"{request.scheme}://wallet.{host[len('panel.'):]}"
    return f"http://{host}:8788"


@app.get("/wallet")
def go_wallet():
    """Menú del usuario -> Wallet: entra a SU wallet con un pase de un solo uso, sin volver a iniciar sesión."""
    if not g.user.get("uid"):
        abort(403)
    if g.user.get("access") == "panel":  # su usuario solo tiene el panel
        return redirect(panel_home() + "#sin-wallet")
    resp = redirect(f"{wallet_url()}/sso?t={sso.ticket(sso_secret, g.user)}")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/internal/binance")
def internal_binance():
    """La wallet de ESTE servidor pide la llave de Binance (solo lectura) de una persona: una sola conexión para
    el panel y la wallet. Solo desde 127.0.0.1 (no por nginx), firmada con SSO_SECRET y con hora (vale 30 s)."""
    if not is_local() or request.headers.get("x-forwarded-for"):  # lo que llega por nginx nunca pasa
        abort(404)
    uid, ts = request.args.get("uid", ""), request.args.get("ts", 0, type=int)
    sig = request.headers.get("x-wallet-sig", "")
    if not uid or abs(time.time() - ts) > 30 or not hmac.compare_digest(sig, sso.sign(sso_secret, f"{uid}|{ts}")):
        abort(404)
    name = next((n for n, u in auth.users.items() if u.get("uid") == uid), None)
    keys = vault.all().get(name) if name else None
    resp = jsonify(connected=bool(keys), key=keys[0] if keys else None, secret=keys[1] if keys else None)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/internal/aviso")
def internal_notice():
    """La wallet de ESTE servidor le avisa algo a una persona (hoy: que su Binance no cuadra con sus movimientos).
    Llega como un aviso más del panel (y por Telegram si es la cuenta principal). Mismas reglas que /internal/binance:
    solo 127.0.0.1, firmada con SSO_SECRET y con hora (vale 30 s)."""
    if not is_local() or request.headers.get("x-forwarded-for"):
        abort(404)
    a = request.args
    uid, ts, key, title, body_ = a.get("uid", ""), a.get("ts", 0, type=int), a.get("key", ""), a.get("title", ""), a.get("body", "")
    sig = request.headers.get("x-wallet-sig", "")
    if not uid or not title or abs(time.time() - ts) > 30 \
            or not hmac.compare_digest(sig, sso.sign(sso_secret, f"aviso|{uid}|{ts}|{key}|{title}|{body_}")):
        abort(404)
    name = next((n for n, u in auth.users.items() if u.get("uid") == uid), None)
    if not name:
        abort(404)
    raise_alert(f"wallet:{uid}:{key[:80]}", "system", title[:120], body_[:600], user=name, telegram_too=name == main_user(),
                links=[("Revisar en la wallet", wallet_url())])
    return jsonify(ok=True)


@app.get("/internal/avatar")
def internal_avatar():
    """La foto de perfil de una persona para la wallet de ESTE servidor (la wallet vive en otro dominio y no tiene
    la sesión del panel). Mismas reglas que /internal/binance: solo 127.0.0.1, firmada con SSO_SECRET, vale 30 s."""
    if not is_local() or request.headers.get("x-forwarded-for"):
        abort(404)
    uid, ts = request.args.get("uid", ""), request.args.get("ts", 0, type=int)
    sig = request.headers.get("x-wallet-sig", "")
    if not re.fullmatch(r"[0-9a-f]{16}", uid) or abs(time.time() - ts) > 30 \
            or not hmac.compare_digest(sig, sso.sign(sso_secret, f"avatar|{uid}|{ts}")):
        abort(404)
    doc = store.load(f"avatar_{uid}", None)
    if not doc or not doc.get("data"):
        abort(404)
    resp = Response(base64.b64decode(doc["data"]), mimetype=f"image/{doc['type']}")
    resp.headers["Cache-Control"] = "no-store"
    return resp


def sell_now(name, asset, qty):
    """Lo que de verdad recibe en pesos si vende ya `qty` de `asset` en P2P, igual que Mis monedas: el mejor comprador
    que acepta esa cantidad (de los anuncios que ya tiene el escaner) menos la comision al tomar su anuncio."""
    p2p = state["p2p"]
    ads = (market_for(p2p["market"], profile(name)).get(asset) or {}).get("SELL") if p2p else None
    if not ads or not graph or qty <= 0:
        return None
    ad = next((a for a in ads if engine._fits(a, qty * a["price"], qty, qty if asset == "BTC" else 0.0)), None)
    if not ad:
        return None
    cut = engine.p2p_taker_fee(graph, asset, qty, *taker_fee_of(profile(name)))
    return {"received": (qty - cut) * ad["price"], "price": ad["price"], "nick": ad["nick"], "fee": cut}


@app.get("/internal/cuenta")
def internal_account():
    """Los saldos de Binance de una persona tal como los muestra Mi Binance, para que la wallet muestre los mismos
    números (mismo precio, misma hora). Mismas protecciones que /internal/binance."""
    if not is_local() or request.headers.get("x-forwarded-for"):
        abort(404)
    uid, ts = request.args.get("uid", ""), request.args.get("ts", 0, type=int)
    sig = request.headers.get("x-wallet-sig", "")
    if not uid or abs(time.time() - ts) > 30 or not hmac.compare_digest(sig, sso.sign(sso_secret, f"{uid}|{ts}")):
        abort(404)
    name = next((n for n, u in auth.users.items() if u.get("uid") == uid), None)
    with lock:
        view = account_view(name) if name else None
        error = acc_errors.get(name) if name else None
    keep = ("t", "spot", "funding", "total_usdt", "usdt_fiat", "total_fiat")
    account = {k: view[k] for k in keep} if view else None
    if account:  # "si vendes ya" por moneda: el mismo calculo de Mis monedas, para que la wallet no diga otra cosa
        held = {}
        for r in view["spot"] + view["funding"]:
            a = r["asset"][2:] if r["asset"].startswith("LD") and len(r["asset"]) > 4 else r["asset"]
            held[a] = held.get(a, 0.0) + r["qty"]
        account["sell"] = {a: v for a, q in held.items() if a in P2P_ASSETS and (v := sell_now(name, a, q))}
        account["gmf"] = profile(name)["gmf"]
        # para que la wallet diga en cada compra a cuánto vender y cuánto ganas si vendes ya (igual que Mis monedas)
        rate, min_usd = taker_fee_of(profile(name))
        market = market_for((state["p2p"] or {}).get("market") or {}, profile(name))
        account["p2p"] = {"fee": rate, "min_usd": min_usd, "buyers": {
            a: [{k: ad.get(k) for k in ("price", "nick", "min", "max", "available", "min_qty", "max_qty", "hold_btc", "reg_days")} for ad in (market.get(a) or {}).get("SELL", [])[:15]]
            for a in P2P_ASSETS}}
    resp = jsonify(connected=bool(name and name in accounts), account=account,
                   error=error["msg"] if error else None, fiat=FIAT)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/panel")
def go_panel():
    """Después del login en arbicrypto.org: al panel (panel.arbicrypto.org; en este PC, la misma página)."""
    return redirect(panel_home())


@app.get("/api/public/mercado")
def api_public_market():
    """Precios P2P en pesos del mejor anuncio de cada cripto, para la cinta de la portada (datos públicos de Binance)."""
    with lock:
        p2p = state["p2p"]
        rows = []
        for a in P2P_ASSETS if p2p else []:
            m = p2p["market"].get(a) or {}
            buy, sell = (m.get("BUY") or [{}])[0].get("price"), (m.get("SELL") or [{}])[0].get("price")
            if buy or sell:
                rows.append({"asset": a, "buy": buy, "sell": sell})
    resp = jsonify(t=p2p["t"] if p2p else None, fiat=FIAT, rows=rows)
    return resp


SITE_PLACEHOLDER = "https://arbicrypto.local"  # el mismo de web/src/app/layout.tsx


@app.get("/")
@app.get("/<path:path>")
def web(path=""):
    if not os.path.isdir(WEB_DIR):
        return ("<h1>Falta compilar la interfaz</h1><p>En la carpeta <b>web</b> ejecuta <b>npm run build</b> "
                "y reinicia el panel (pm2 restart arbicrypto).</p>"), 503
    target = path or ("inicio.html" if g.landing else "index.html")
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
    global settings, history, alerts_at_boot, vault, sso_secret
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
    sso_secret = os.environ.get("SSO_SECRET") or env.get("SSO_SECRET")
    if not sso_secret:  # primera vez: la wallet la lee de este mismo archivo (están en el mismo servidor)
        sso_secret = sso.new_secret()
        update_env(SSO_SECRET=sso_secret)
    for user, (key, sec) in vault.all().items():
        if user in auth.users:
            accounts[user] = engine.Account(key, sec)
    telegram.token, telegram.bot = env.get("TELEGRAM_BOT_TOKEN", ""), env.get("TELEGRAM_BOT", "")
    telegram.chat_id, telegram.chat_name = env.get("TELEGRAM_CHAT_ID", ""), env.get("TELEGRAM_CHAT_NAME", "")

    redis.listen(lambda kind: publish(kind, remote=False))  # eventos de otras copias del panel
    if sql.mysql or redis.on:
        print(f"  Datos en {'MySQL' if sql.mysql else 'SQLite'}{' + Redis' if redis.on else ''}")
    ensure_teams()  # la primera vez, los usuarios de siempre quedan en "Equipo principal" con su chat General
    watches.extend(load_json(WATCH_FILE, []))
    watch_auto.update(load_json(WATCH_AUTO_FILE, {}))
    price_alerts.extend(load_json(PRICE_FILE, []))
    prefs.update(load_json(PREFS_FILE, {}))
    for name, step, interval in (("spot", spot_step, SPOT_INTERVAL), ("p2p", p2p_step, P2P_INTERVAL),
                                 ("account", account_step, ACCOUNT_INTERVAL), ("watch", watch_step, WATCH_INTERVAL)):
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
