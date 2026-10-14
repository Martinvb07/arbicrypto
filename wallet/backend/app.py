"""ArbiCrypto Wallet: contabilidad de criptoactivos para la declaración de renta ante la DIAN.

Se enciende con PM2, igual que el panel de ArbiCrypto (ver LEEME.md):
    pm2 start deploy/ecosystem.config.js        -> http://127.0.0.1:8788
"""
import base64
import functools
import hashlib
import io
import json
import logging
import math
import os
import socket
import sys
import threading
import time
from datetime import datetime, timedelta

import requests

import ledger
import storage
import statements
import tax
import workbook
from banks import KINDS as ACCOUNT_KINDS, Banks
import sso
from auth import SESSION_HOURS, Auth
from db import DATA_DIR, ENV_FILE, open_db, to_csv
from httpkit import App, Response, abort, asgi, g, jsonify, log, redirect, request, safe_join, send_file
from importers import (ASSET_RE, COLUMNS, DAY, GASTO_CATEGORIES, GMF_RATE, KINDS, P2P_API_DAYS, TEMPLATE_ROWS, ImportJob,
                       read_csv)
from rates import STABLE, RateError, Rates

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web", "out")
_ENV0 = storage.read_env_file(ENV_FILE)
_env = lambda k, default="": (os.environ.get(k) or _ENV0.get(k) or default).strip()
_flag = lambda k: _env(k).lower() in ("1", "true", "si", "yes")
HOST, PORT = _env("HOST", "127.0.0.1"), int(_env("PORT", "8788"))
SECURE = _flag("COOKIE_SECURE")  # VPS con HTTPS: la cookie de sesión solo viaja cifrada
# dominios con los que se puede abrir (VPS: ALLOWED_HOSTS=wallet.arbicrypto.org); el resto se rechaza (DNS rebinding)
ALLOWED_HOSTS = {"127.0.0.1", "localhost", *(h.strip().lower() for h in _env("ALLOWED_HOSTS").split(",") if h.strip())}
COOKIE = "acw_session"
PANEL_ENV = os.path.join(ROOT, "..", "backend", ".env")  # el panel vive en el mismo repositorio y servidor
# El panel en este mismo servidor: de ahí sale la llave de Binance de cada persona (una sola conexión para los dos)
PANEL_INTERNAL = (_env("PANEL_INTERNAL_URL") or f"http://127.0.0.1:{storage.read_env_file(PANEL_ENV).get('PORT', '8787')}").rstrip("/")
SYNC_EVERY = 30 * 60  # segundos entre sincronizaciones automáticas con Binance
AUTO_CLOSE_AFTER = 3 * 86400  # el cierre automático de un mes se hace 3 días después de terminado
MONTHS = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre")
MIN_T = datetime(2009, 1, 3, tzinfo=tax.CO_TZ).timestamp()

app = App()  # FastAPI; el tamaño máximo de cada petición (16 MB, por los extractos) lo controla httpkit
# MySQL si hay DATABASE_URL en backend/.env; si no, SQLite en backend/data/wallet.db
db = open_db()
auth = Auth(db)
rates = Rates(db)
jobs = ImportJob(db, rates)
banks = Banks(db)

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")


class Bad(Exception):
    pass


class Locked(Exception):
    pass


# ------------------------------------------------------------ seguridad

@app.before_request
def guard():
    host = (request.host or "").rsplit(":", 1)[0].strip("[]").lower()
    if host not in ALLOWED_HOSTS:  # evita DNS rebinding
        abort(400)
    if request.path.startswith("/api/") and request.method not in ("GET", "HEAD"):
        if not request.is_json:
            return jsonify(error="Se esperaba JSON."), 415
        origin = request.headers.get("Origin")
        if origin and origin.split("://", 1)[-1].lower() != (request.host or "").lower():
            return jsonify(error="Origen no permitido."), 403


@app.after_request
def security_headers(r):
    h = r.headers
    h["Content-Security-Policy"] = CSP
    h["X-Frame-Options"] = "DENY"
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    if request.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    if SECURE:
        h["Strict-Transport-Security"] = "max-age=31536000"
    return r


@app.errorhandler(Bad)
def bad(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(Locked)
def locked_period(e):
    return jsonify(error=str(e)), 409


def check_open(uid, *ts):
    """Los movimientos de un periodo cerrado no se pueden cambiar."""
    lock = db.lock_until(uid)
    if lock and any(t is not None and t <= lock for t in ts):
        raise Locked(f"Ese periodo está cerrado (hasta el {fmt_t(lock)}). Si necesitas corregirlo, reabre el último cierre en Cierres.")


@app.errorhandler(Exception)
def crash(e):
    log.exception("error")
    return jsonify(error="Error interno. Revisa los registros del servidor (pm2 logs arbicrypto-wallet)."), 500


def with_session(fn):
    @functools.wraps(fn)
    def wrap(*a, **kw):
        g.token = request.cookies.get(COOKIE)
        g.user = auth.user_for(g.token)
        if not g.user:
            return jsonify(error="Inicia sesión."), 401
        return fn(*a, **kw)
    return wrap


def needs_binance(fn):
    """Agregar o cambiar datos solo con el Binance de la persona conectado: sin eso la wallet queda vacía."""
    @functools.wraps(fn)
    def wrap(*a, **kw):
        if not db.linked(g.user["id"]):
            return jsonify(error="Conecta tu Binance en el panel (Mi Binance) primero: la wallet trabaja solo con tu cuenta de Binance."), 409
        return fn(*a, **kw)
    return wrap


def body():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise Bad("Datos inválidos.")
    return d


def set_cookie(resp, token):
    resp.set_cookie(COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True, samesite="Strict", secure=SECURE, path="/")
    return resp


def panel_url():
    """Dirección del panel: PANEL_URL de .env, o la que corresponde a esta wallet
    (wallet.arbicrypto.org -> panel.arbicrypto.org; en este PC, el puerto 8787)."""
    url = _env("PANEL_URL").rstrip("/")
    if url:
        return url
    host = request.host.rsplit(":", 1)[0]
    if host.startswith("wallet."):
        return f"{request.scheme}://panel.{host[len('wallet.'):]}"
    return f"http://{host}:8787"


# ------------------------------------------------------------ validación

def num(v, name, minimum=0.0, allow_zero=True, required=True):
    if v in (None, ""):
        if required:
            raise Bad(f"Falta {name}.")
        return 0.0
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise Bad(f"{name}: número inválido.")
    if not math.isfinite(n) or n < minimum or (not allow_zero and n == 0) or n > 1e15:
        raise Bad(f"{name}: valor fuera de rango.")
    return n


def asset(v, name):
    a = str(v or "").strip().upper()
    if not ASSET_RE.match(a) or a == "COP":
        raise Bad(f"{name}: escribe el símbolo de la cripto (ej. USDT, BTC).")
    return a


def text(v, n):
    return str(v or "").strip()[:n]


def year_arg():
    try:
        y = int(request.args.get("year", datetime.now(tax.CO_TZ).year))
    except ValueError:
        raise Bad("Año inválido.")
    if not 2015 <= y <= 2100:
        raise Bad("Año inválido.")
    return y


def clean_move(d, gmf_default=False):
    """Valida un movimiento y lo deja con la forma que usa el motor."""
    kind = d.get("kind")
    if kind not in KINDS:
        raise Bad("Tipo de movimiento inválido.")
    t = num(d.get("t"), "Fecha")
    if not MIN_T <= t <= time.time() + 86400:
        raise Bad("Fecha fuera de rango.")
    m = dict(t=t, kind=kind, out_asset=None, out_qty=None, in_asset=None, in_qty=None, fee_cop=0.0, gmf_cop=0.0,
             platform=text(d.get("platform"), 60), counterpart=text(d.get("counterpart"), 80), note=text(d.get("note"), 300),
             category="", pay_method=text(d.get("pay_method"), 60))  # cuenta de pesos (Nequi…); al editar no se cambia
    if kind in ("gasto", "aporte", "retiro"):  # movimientos de pesos que no tocan cripto
        m["cop_value"] = num(d.get("cop_value"), "Valor", allow_zero=False)
        if kind == "aporte":
            m["in_asset"], m["in_qty"] = "COP", m["cop_value"]
        else:
            m["out_asset"], m["out_qty"] = "COP", m["cop_value"]
            m["gmf_cop"] = num(d.get("gmf_cop"), "4x1000", required=False)  # lo que cobró el banco por sacar la plata
        if kind == "gasto":
            cat = str(d.get("category") or "otros").lower()
            if cat not in GASTO_CATEGORIES:
                raise Bad("Categoría de gasto inválida.")
            m["category"] = cat
            if not m["note"]:
                raise Bad("Escribe en qué fue el gasto (por ejemplo: internet de octubre).")
        return m
    if kind == "compra":
        m["in_asset"], m["in_qty"] = asset(d.get("in_asset"), "Cripto"), num(d.get("in_qty"), "Cantidad", allow_zero=False)
        m["cop_value"] = num(d.get("cop_value"), "Pesos pagados", allow_zero=False)
        m["out_asset"], m["out_qty"] = "COP", m["cop_value"]
    elif kind == "venta":
        m["out_asset"], m["out_qty"] = asset(d.get("out_asset"), "Cripto"), num(d.get("out_qty"), "Cantidad", allow_zero=False)
        m["cop_value"] = num(d.get("cop_value"), "Pesos recibidos", allow_zero=False)
        m["in_asset"], m["in_qty"] = "COP", m["cop_value"]
    elif kind == "permuta":
        m["out_asset"], m["out_qty"] = asset(d.get("out_asset"), "Cripto entregada"), num(d.get("out_qty"), "Cantidad entregada", allow_zero=False)
        m["in_asset"], m["in_qty"] = asset(d.get("in_asset"), "Cripto recibida"), num(d.get("in_qty"), "Cantidad recibida", allow_zero=False)
        if m["in_asset"] == m["out_asset"]:
            raise Bad("En una permuta las dos cripto deben ser distintas.")
        m["cop_value"] = num(d.get("cop_value"), "Valor en pesos")
    elif kind in ("ingreso", "airdrop"):
        m["in_asset"], m["in_qty"] = asset(d.get("in_asset"), "Cripto"), num(d.get("in_qty"), "Cantidad", allow_zero=False)
        m["cop_value"] = num(d.get("cop_value"), "Valor en pesos")
    else:  # comision
        m["out_asset"], m["out_qty"] = asset(d.get("out_asset"), "Cripto"), num(d.get("out_qty"), "Cantidad", allow_zero=False)
        m["cop_value"] = num(d.get("cop_value"), "Valor en pesos", required=False)
    if kind in ("compra", "venta", "permuta"):
        m["fee_cop"] = num(d.get("fee_cop"), "Comisión", required=False)
    # los pesos que de verdad pasaron por el banco: en la compra valor + comisión, en la venta valor - comisión
    if kind == "compra":
        m["out_qty"] = m["cop_value"] + m["fee_cop"]
    elif kind == "venta":
        m["in_qty"] = m["cop_value"] - m["fee_cop"]
    if kind in ("compra", "venta"):
        gmf = d.get("gmf_cop")
        m["gmf_cop"] = num(gmf, "4x1000", required=False) if gmf not in (None, "") else \
            (round(m["out_qty"] * GMF_RATE, 2) if gmf_default and kind == "compra" else 0.0)
    return m


def moves(uid, start=None, end=None):
    """Movimientos con el 4x1000 que de verdad se pagó según el perfil."""
    p = db.profile(uid)
    return tax.apply_gmf(db.movements(uid, start, end), p["gmf_mode"], p["gmf_methods"])


def public_move(m):
    return {**{k: m.get(k) for k in ("id", "t", "kind", "out_asset", "out_qty", "in_asset", "in_qty", "cop_value", "fee_cop",
                                     "gmf_cop", "platform", "counterpart", "source", "note", "category", "pay_method",
                                     "fee_qty", "fee_asset")},
            "ref": tax.ref_label(m.get("ext_id"))}


# ------------------------------------------------------------ sesión y cuenta

# Usuarios y contraseñas viven en el panel: se entra desde su menú (Wallet) con un pase de un solo uso.

@app.get("/sso")
def sso_enter():
    """Pase del panel -> sesión en la cuenta de la wallet de ESA persona."""
    info = sso.verify(sso.secret(_env, PANEL_ENV), request.args.get("t", ""))
    if not info:  # vencido, usado o falso: se pide uno nuevo al panel (si la sesión del panel sigue abierta, es automático)
        return redirect(f"{panel_url()}/wallet")
    uid = auth.account_for(str(info["id"])[:64], str(info["u"])[:64], info.get("r"))
    resp = redirect("/")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return set_cookie(resp, auth.new_session(uid))


@app.get("/entrar")
def enter():
    """Sin sesión en la wallet: se pide el pase al panel (si no hay sesión en el panel, primero el login del panel)."""
    return redirect(f"{panel_url()}/wallet")


@app.post("/api/logout")
def logout():
    """Cierra la sesión de la wallet y la del panel (la página sigue a {panel}/salir)."""
    auth.logout(request.cookies.get(COOKIE))
    r = jsonify(ok=True, panel=panel_url())
    r.delete_cookie(COOKIE, path="/", samesite="Strict", secure=SECURE, httponly=True)
    return r


@app.get("/api/me")
@with_session
def me():
    uid = g.user["id"]
    span = db.years(uid)
    now_y = datetime.now(tax.CO_TZ).year
    first = datetime.fromtimestamp(span["a"], tax.CO_TZ).year if span["a"] else now_y - 1
    methods = [] if not db.linked(uid) else db.q("SELECT pay_method AS method, COUNT(*) AS n, SUM(cop_value) AS total FROM movements "
                   "WHERE user_id=? AND kind='compra' AND pay_method<>'' GROUP BY pay_method ORDER BY total DESC", (uid,))
    return jsonify(user=g.user, profile=db.profile(uid), movements=span["n"], pay_methods=methods,
                   years=list(range(now_y, min(first, now_y - 1) - 1, -1)), uvt=tax.UVT, panel=panel_url())


@app.post("/api/profile")
@with_session
def save_profile():
    d = body()
    nit = text(d.get("nit"), 20)
    if nit and not all(c.isdigit() or c == "-" for c in nit):
        raise Bad("NIT o cédula: solo números (y guion antes del dígito de verificación).")
    method = d.get("method")
    if method not in ("fifo", "promedio"):
        raise Bad("Método de costo inválido.")
    mode = d.get("gmf_mode") or ("exenta" if d.get("gmf_exempt") else "todas")
    if mode not in tax.GMF_MODES:
        raise Bad("Opción de 4x1000 inválida.")
    per = d.get("gmf_methods") or {}
    if not isinstance(per, dict) or len(per) > 30:
        raise Bad("4x1000 por cuenta inválido.")
    per = {text(k, 40): v for k, v in per.items() if v in tax.GMF_MODES and str(k).strip()}
    db.save_profile(g.user["id"], {"name": text(d.get("name"), 120), "nit": nit, "habitual": bool(d.get("habitual")),
                                   "method": method, "gmf_mode": mode, "gmf_methods": per})
    return jsonify(profile=db.profile(g.user["id"]))


@app.post("/api/year-extra")
@with_session
@needs_binance
def save_year_extra():
    d = body()
    y = int(num(d.get("year"), "Año", minimum=2015))
    e = {"other_income": num(d.get("other_income"), "Otros ingresos", required=False),
         "other_patrimony": num(d.get("other_patrimony"), "Otro patrimonio", required=False),
         "other_deposits": num(d.get("other_deposits"), "Otras consignaciones", required=False),
         "gmf_cert": num(d.get("gmf_cert"), "4x1000 del certificado", required=False)}
    db.save_year_extra(g.user["id"], y, e)
    return jsonify(ok=True)


# ------------------------------------------------------------ movimientos

@app.get("/api/movements")
@with_session
def movements():
    y = request.args.get("year")
    if y:
        start, end = tax.year_bounds(year_arg())
        rows = moves(g.user["id"], start, end)
    else:
        rows = moves(g.user["id"])
    return jsonify(movements=[public_move(m) for m in rows], lock_until=db.lock_until(g.user["id"]))


@app.post("/api/movements")
@with_session
@needs_binance
def add_movement():
    m = clean_move(body(), gmf_default=True)
    check_open(g.user["id"], m["t"])
    m.update(ext_id=None, source="manual")
    db.add_movements(g.user["id"], [m], time.time())
    return jsonify(ok=True)


@app.post("/api/movements/<int:mid>")
@with_session
@needs_binance
def edit_movement(mid):
    m = clean_move(body())
    old = db.one("SELECT t FROM movements WHERE id=? AND user_id=?", (mid, g.user["id"]))
    if not old:
        return jsonify(error="No existe ese movimiento."), 404
    check_open(g.user["id"], old["t"], m["t"])
    if not db.update_movement(g.user["id"], mid, m):
        return jsonify(error="No existe ese movimiento."), 404
    return jsonify(ok=True)


@app.post("/api/movements/delete")
@with_session
@needs_binance
def delete_movements():
    d = body()
    if isinstance(d.get("ids"), list):
        try:
            ids = [int(i) for i in d["ids"]][:5000]
        except (TypeError, ValueError):
            raise Bad("Lista inválida.")
        if ids:
            marks = ",".join("?" for _ in ids)
            ts = [r["t"] for r in db.q(f"SELECT t FROM movements WHERE user_id=? AND id IN ({marks})", (g.user["id"], *ids))]
            check_open(g.user["id"], *ts)
        n = db.delete_movements(g.user["id"], ids=ids)
    elif d.get("source") in ("binance", "csv", "manual"):
        n = db.delete_movements(g.user["id"], source=d["source"], after=db.lock_until(g.user["id"]))
    else:
        raise Bad("Nada para borrar.")
    return jsonify(deleted=n)


@app.get("/api/value")
@with_session
def value():
    """Valor sugerido en pesos: precio en dólares (Binance) × TRM del día."""
    a = asset(request.args.get("asset"), "Cripto")
    qty = num(request.args.get("qty") or "1", "Cantidad")
    t = num(request.args.get("t"), "Fecha")
    try:
        return jsonify(rates.cop(a, qty, t))
    except RateError as e:
        return jsonify(error=str(e)), 502


# ------------------------------------------------------------ importar

# ------------------------------------------------------------ conexión con Binance (sincroniza sola)

class PanelDown(Exception):
    pass


def panel_binance(panel_uid):
    """La llave de Binance que esa persona conectó en el panel (Mi Binance): (key, secret), o None si no tiene."""
    key, ts = sso.secret(_env, PANEL_ENV), int(time.time())
    try:
        r = requests.get(f"{PANEL_INTERNAL}/internal/binance", params={"uid": panel_uid, "ts": ts},
                         headers={"X-Wallet-Sig": sso.sign(key, f"{panel_uid}|{ts}")}, timeout=8)
        d = r.json() if r.status_code == 200 else None
    except (requests.RequestException, ValueError):
        d = None
    if not d:
        raise PanelDown("No hay conexión con el panel: se reintenta sola.")
    return (d["key"], d["secret"]) if d.get("connected") and d.get("key") else None


def panel_account(uid):
    """Los saldos de Binance tal como los muestra el panel (Mi Binance): mismo precio, misma hora. None si no hay."""
    u = db.one("SELECT panel_uid FROM users WHERE id=?", (uid,))
    if not u or not u["panel_uid"]:
        return None
    key, ts = sso.secret(_env, PANEL_ENV), int(time.time())
    try:
        r = requests.get(f"{PANEL_INTERNAL}/internal/cuenta", params={"uid": u["panel_uid"], "ts": ts},
                         headers={"X-Wallet-Sig": sso.sign(key, f"{u['panel_uid']}|{ts}")}, timeout=5)
        return r.json() if r.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None


def live_rows(acc, own):
    """Une Spot y Fondos del panel por moneda (LDBTC = BTC en Earn) y les pone el cuadre con tus libros."""
    rows = {}
    for where, items in (("spot", acc.get("spot") or []), ("funding", acc.get("funding") or [])):
        for it in items:
            a = it["asset"]
            if a.startswith("LD") and len(a) > 4:
                a, where_ = a[2:], "earn"
            else:
                where_ = where
            r = rows.setdefault(a, {"asset": a, "qty": 0.0, "usdt": 0.0, "fiat": 0.0, "wallets": {}, "priced": True})
            r["qty"] += it["qty"]
            r["wallets"][where_] = r["wallets"].get(where_, 0.0) + it["qty"]
            if it.get("usdt") is None:
                r["priced"] = False
            r["usdt"] += it.get("usdt") or 0
            r["fiat"] += it.get("fiat") or 0
    out = []
    for a, r in rows.items():
        mine = own.get(a)
        out.append({**r, "usdt": r["usdt"] if r["priced"] else None, "fiat": r["fiat"] if r["priced"] else None,
                    "cost": mine["cost"] if mine else 0.0, "app_qty": mine["app_qty"] if mine else 0.0,
                    "ok": mine["ok"] if mine else True})
    return sorted(out, key=lambda r: -(r["usdt"] or 0))


def forget_binance(uid):
    """Sin Binance no queda nada de Binance: la conexión y lo que se trajo con ella (lo de periodos cerrados se queda)."""
    db.delete_binance(uid)
    if db.delete_movements(uid, source="binance", after=db.lock_until(uid)):
        banks.reclassify(uid)  # los extractos que cruzaban con esas órdenes se vuelven a clasificar


def link_binance(uid):
    """Pone la wallet igual que el panel: conectada con la misma llave, o vacía si en el panel no hay llave.
    Devuelve (key, secret) o None. Si el panel no responde (PanelDown) no se toca nada."""
    u = db.one("SELECT panel_uid FROM users WHERE id=?", (uid,))
    if not u or not u["panel_uid"]:
        return None
    keys = panel_binance(u["panel_uid"])
    b = db.binance(uid)
    fp = hashlib.sha256(keys[0].encode()).hexdigest()[:16] if keys else None
    if b and b["key_fp"] != fp:  # la desconectó o cambió de llave en el panel
        if jobs.running(uid):
            return None  # se pone al día cuando termine la sincronización en curso
        forget_binance(uid)
        b = None
    if keys and not b:
        db.save_binance(uid, fp, f"{keys[0][:4]}…{keys[0][-4:]}", time.time())
    return keys


def sync_now(uid):
    """Sincroniza con la llave que la persona tiene en el panel. False si no tiene, el panel no responde o ya está corriendo."""
    if jobs.running(uid):
        return False
    try:
        keys = link_binance(uid)
    except PanelDown as e:
        if db.binance(uid):
            db.binance_sync(uid, last_run=time.time(), last_error=str(e))
        return False
    b = db.binance(uid)
    if not keys or not b:
        return False
    key, secret = keys
    db.binance_sync(uid, last_run=time.time())
    try:
        cursor = json.loads(b["cursor"] or "{}")
    except ValueError:
        cursor = {}
    # el 4x1000 se guarda siempre (0,4 % de cada compra P2P) y el perfil decide cuánto se pagó de verdad
    return jobs.start(uid, key, secret, True, cursor, finish_sync)


def finish_sync(uid, ok, cursor, error):
    if not db.binance(uid):  # se desconectó mientras sincronizaba
        return
    fields = {"cursor": json.dumps(cursor)}
    if ok:
        fields.update(last_ok=time.time(), last_error=None)
    else:
        fields["last_error"] = error
    db.binance_sync(uid, **fields)


def binance_status(uid):
    b = db.binance(uid)
    out = {"connected": bool(b), "job": jobs.status(uid), "every": SYNC_EVERY, "panel_url": f"{panel_url()}/#cuenta"}
    if b:
        api_from = b["created"] - P2P_API_DAYS * DAY  # P2P más viejos que esto solo llegan con el archivo de Binance
        old = db.one("SELECT COUNT(*) AS n FROM movements WHERE user_id=? AND ext_id LIKE 'p2p:%' AND t<?", (uid, api_from))
        try:
            notes = json.loads(b["cursor"] or "{}").get("notes") or []
        except ValueError:
            notes = []
        out.update(hint=b["hint"], since=b["created"], last_ok=b["last_ok"], last_run=b["last_run"], last_error=b["last_error"],
                   p2p_api_from=api_from, has_old_p2p=old["n"] > 0, notes=notes)
    return out


def scheduler():
    """Cada minuto revisa quién lleva más de 30 minutos sin sincronizar; cada hora, los cierres automáticos."""
    time.sleep(5)
    next_close = 0.0
    while True:
        try:
            due = db.q("SELECT u.id FROM users u LEFT JOIN binance b ON b.user_id=u.id "
                       "WHERE u.panel_uid IS NOT NULL AND (b.last_run IS NULL OR b.last_run<?)", (time.time() - SYNC_EVERY,))
            for u in due:
                sync_now(u["id"])
        except Exception:
            log.exception("sincronización automática")
        if time.time() >= next_close:
            next_close = time.time() + 3600
            for u in db.q("SELECT id FROM users"):
                try:
                    auto_close(u["id"])
                except Exception:
                    log.exception("cierre automático")
        time.sleep(60)


@app.get("/api/binance")
@with_session
def binance_get():
    """Al abrir la wallet se pone igual que el panel: si allá conectaste o quitaste Binance, aquí se nota ya."""
    uid = g.user["id"]
    try:
        link_binance(uid)
    except PanelDown:
        pass
    b = db.binance(uid)
    if b and not b["last_run"]:
        sync_now(uid)
    return jsonify(binance_status(uid))


@app.post("/api/binance/sync")
@with_session
def binance_sync():
    body()
    uid = g.user["id"]
    try:
        link_binance(uid)
    except PanelDown as e:
        return jsonify(error=str(e)), 503
    if not db.binance(uid):
        return jsonify(error="Conecta tu Binance en el panel (Mi Binance): la wallet usa esa misma conexión."), 400
    sync_now(uid)
    return jsonify(binance_status(uid))


@app.post("/api/import/csv")
@with_session
@needs_binance
def import_csv():
    d = body()
    rows, errors, examples = read_csv(str(d.get("text") or ""), gmf=True)
    moves = []
    for n, raw in rows:
        try:
            m = csv_move(raw)
            moves.append(m)
        except (Bad, RateError) as e:
            errors.append(f"Fila {n}: {e}")
    if errors and not d.get("partial"):
        return jsonify(error="El archivo tiene errores. No se importó nada.", errors=errors[:50], valid=len(moves)), 400
    lock = db.lock_until(g.user["id"])
    frozen = sum(1 for m in moves if m["t"] <= lock)
    moves = [m for m in moves if m["t"] > lock]
    added = db.add_movements(g.user["id"], moves, time.time())
    return jsonify(added=added, skipped=len(moves) - added, examples=examples, locked=frozen, errors=errors[:50])


def csv_move(raw):
    """Fila del CSV a movimiento: completa los pesos que falten."""
    d = dict(raw)
    k = d["kind"]
    if d.get("cop_value") is None:
        if k == "compra" and d.get("out_asset") == "COP":
            d["cop_value"] = d.get("out_qty")
        elif k == "venta" and d.get("in_asset") == "COP":
            d["cop_value"] = d.get("in_qty")
        elif k in ("permuta", "ingreso", "airdrop", "comision"):
            a, q = (d["in_asset"], d["in_qty"]) if k != "comision" else (d["out_asset"], d["out_qty"])
            if a and q:
                d["cop_value"] = rates.cop(a, q, d["t"])["cop"]
    m = clean_move(d)
    m.update(ext_id=raw.get("ext_id"), source=raw.get("source") or "csv")
    return m


# ------------------------------------------------------------ reporte

def run_report(uid, year, with_moves=False):
    p = db.profile(uid)
    extra = db.year_extra(uid, year)
    _, end = tax.year_bounds(year)
    ms = moves(uid, end=end)
    res = tax.compute(ms, year, p["habitual"], p["method"])
    s = tax.summary(res, year, **extra)
    return (p, extra, res, s, ms) if with_moves else (p, extra, res, s)


def holdings_list(h):
    return sorted(({"asset": a, **v} for a, v in h.items()), key=lambda x: -x["cost"])


def cuadre(uid, profile):
    """Compara lo que la app calcula que tienes hoy con lo que hay en Binance (última sincronización)."""
    b = db.binance(uid)
    try:
        cur = json.loads(b["cursor"] or "{}") if b else {}
    except ValueError:
        cur = {}
    bal = cur.get("balances")
    if bal is None:
        return None
    now_y = datetime.now(tax.CO_TZ).year
    res = tax.compute(db.movements(uid), now_y, profile["habitual"], profile["method"])
    hold = {a: h["qty"] for a, h in res["holdings"].items()}
    rows = []
    for a in sorted((set(bal) | set(hold)) - {"COP"}):
        mine, real = hold.get(a, 0.0), float(bal.get(a, 0.0))
        diff = real - mine
        ok = abs(diff) <= max(1e-6, 0.01 * max(abs(mine), abs(real))) or (a in STABLE and abs(diff) < 1)
        rows.append({"asset": a, "app": mine, "binance": real, "diff": diff, "ok": ok})
    rows.sort(key=lambda r: (r["ok"], r["asset"]))
    return {"t": cur.get("balances_t"), "rows": rows, "ok": all(r["ok"] for r in rows)}


@app.get("/api/saldos")
@with_session
def saldos():
    """Todo lo que tienes hoy: Binance por moneda y billetera (a precio de hoy) y los pesos de tus cuentas."""
    uid = g.user["id"]
    p = db.profile(uid)
    b = db.binance(uid)
    try:
        cur = json.loads(b["cursor"] or "{}") if b else {}
    except ValueError:
        cur = {}
    bal, wallets = cur.get("balances"), cur.get("wallets") or {}
    now = time.time()
    res = tax.compute(moves(uid), datetime.now(tax.CO_TZ).year, p["habitual"], p["method"])
    hold = res["holdings"]
    trm, errors = None, []
    try:
        trm = rates.trm(datetime.now(tax.CO_TZ).date())
    except RateError as e:
        errors.append(str(e))
    rows = []
    for a in sorted((set(bal or {}) | set(hold)) - {"COP"}):
        real = float((bal or {}).get(a, 0.0))
        mine = hold.get(a, {}).get("qty", 0.0)
        qty = real if bal is not None else mine
        price = None
        try:
            price = rates.usd(a, now)
        except RateError as e:
            errors.append(str(e))
        usd = qty * price if price is not None else None
        diff = real - mine
        rows.append({
            "asset": a, "qty": qty, "app_qty": mine, "binance_qty": real if bal is not None else None,
            "wallets": {w: float(wallets.get(w, {}).get(a, 0.0)) for w in ("spot", "funding", "earn")},
            "usd_price": price, "usd": usd, "cop": usd * trm if usd is not None and trm else None,
            "cost": hold.get(a, {}).get("cost", 0.0),
            "ok": bal is None or abs(diff) <= max(1e-6, 0.01 * max(abs(mine), abs(real))) or (a in STABLE and abs(diff) < 1),
        })
    rows.sort(key=lambda r: -(r["cop"] or 0))
    # lo que se ve de Binance es lo mismo que en el panel (Mi Binance); los libros se cuadran con la última sincronización
    live = panel_account(uid) if b else None
    acc = (live or {}).get("account")
    panel = None
    if acc:
        own = {r["asset"]: r for r in rows}
        panel = {"t": acc["t"], "fiat": live.get("fiat") or "COP", "usdt_fiat": acc.get("usdt_fiat"),
                 "total_usdt": acc["total_usdt"], "total_fiat": acc.get("total_fiat"), "rows": live_rows(acc, own),
                 "error": live.get("error")}
    entries = user_journal(uid)
    caja = [c for c in db.closings(uid) if not c["auto"]]  # solo los cierres con el saldo real que escribiste
    return jsonify(
        binance={"connected": bool(b), "synced": cur.get("balances_t"), "rows": rows, "trm": trm,
                 "total_cop": sum(r["cop"] or 0 for r in rows), "total_usd": sum(r["usd"] or 0 for r in rows),
                 "total_cost": sum(r["cost"] for r in rows), "ok": all(r["ok"] for r in rows), "panel": panel},
        banks={"books": ledger.cash_at(entries, now), "by_method": cash_by_method(uid, now),
               "last_closing": caja[-1] if caja else None,
               "statements": [{"id": acc["id"], "name": acc["name"], "balance": acc["last_balance"], "day": acc["last_day"]}
                              for acc in banks.summary(uid, datetime.now(tax.CO_TZ).year)["accounts"] if acc["last_balance"] is not None]},
        errors=errors[:5])


# ------------------------------------------------------------ cuentas bancarias y extractos

@app.get("/api/bancos")
@with_session
def bancos():
    return jsonify(banks.summary(g.user["id"], year_arg()))


@app.post("/api/bancos/cuentas")
@with_session
@needs_binance
def bancos_cuenta():
    d = body()
    name = text(d.get("name"), 60)
    if not name:
        raise Bad("Escribe el nombre de la cuenta (por ejemplo: Nequi o Bancolombia ahorros).")
    kind = d.get("kind") if d.get("kind") in ACCOUNT_KINDS else "ahorros"
    pms = d.get("pay_methods") if isinstance(d.get("pay_methods"), list) else []
    aid = int(d["id"]) if str(d.get("id") or "").isdigit() else None
    if aid and not banks.account(g.user["id"], aid):
        return jsonify(error="No existe esa cuenta."), 404
    aid = banks.save_account(g.user["id"], aid, name, kind, [str(p) for p in pms][:10])
    banks.reclassify(g.user["id"])
    return jsonify(id=aid)


@app.post("/api/bancos/cuentas/<int:aid>/borrar")
@with_session
@needs_binance
def bancos_cuenta_borrar(aid):
    body()
    if not banks.delete_account(g.user["id"], aid):
        return jsonify(error="No existe esa cuenta."), 404
    return jsonify(ok=True)


def statement_input():
    d = body()
    aid = int(num(d.get("account_id"), "Cuenta"))
    if not banks.account(g.user["id"], aid):
        raise Bad("Elige la cuenta del extracto.")
    name = text(d.get("filename"), 120) or "extracto"
    try:
        data = base64.b64decode(str(d.get("data") or ""), validate=True)
    except ValueError:
        raise Bad("El archivo no llegó bien. Vuelve a subirlo.")
    if not data:
        raise Bad("El archivo está vacío.")
    try:
        rows, warnings = statements.read_file(name, data, str(d.get("password") or "")[:64] or None)
    except statements.StatementError as e:
        raise Bad(str(e))
    return aid, name, data, rows, warnings


@app.post("/api/bancos/extracto/preview")
@with_session
@needs_binance
def bancos_preview():
    aid, name, data, rows, warnings = statement_input()
    days = sorted(r["day"] for r in rows)
    return jsonify(rows=[{**r, "day": r["day"].isoformat()} for r in rows[:300]], total=len(rows), warnings=warnings,
                   known=banks.known(g.user["id"], aid, rows), day_from=days[0].isoformat() if days else None,
                   day_to=days[-1].isoformat() if days else None,
                   inflow=sum(r["amount"] for r in rows if r["amount"] > 0), outflow=-sum(r["amount"] for r in rows if r["amount"] < 0))


@app.post("/api/bancos/extracto")
@with_session
@needs_binance
def bancos_upload():
    aid, name, data, rows, warnings = statement_input()
    if not rows:
        raise Bad(warnings[0] if warnings else "No encontré movimientos en el archivo.")
    fid, added, dup = banks.save_file(g.user["id"], aid, name, data, rows)
    return jsonify(file_id=fid, added=added, skipped=dup, warnings=warnings)


@app.post("/api/bancos/archivo/<int:fid>/borrar")
@with_session
@needs_binance
def bancos_archivo_borrar(fid):
    body()
    if not banks.delete_file(g.user["id"], fid):
        return jsonify(error="No existe ese archivo."), 404
    return jsonify(ok=True)


@app.post("/api/bancos/tx/<int:tid>")
@with_session
@needs_binance
def bancos_tx(tid):
    d = body()
    cat = d.get("category")
    if cat not in statements.CATEGORIES:
        raise Bad("Categoría inválida.")
    note = text(d.get("note"), 200) if d.get("note") is not None else None
    if not banks.set_category(g.user["id"], tid, cat, note, bool(d.get("similar"))):
        return jsonify(error="No existe ese movimiento."), 404
    return jsonify(ok=True)


@app.get("/api/report")
@with_session
def report():
    year = year_arg()
    uid = g.user["id"]
    p, extra, res, s, moves = run_report(uid, year, with_moves=True)
    start, end = tax.year_bounds(year)
    unvalued = 0 if not db.linked(uid) else db.one("SELECT COUNT(*) AS n FROM movements WHERE user_id=? AND t>=? AND t<? AND cop_value<=0 "
                      "AND kind IN ('permuta','ingreso','airdrop')", (uid, start, end))["n"]
    return jsonify(year=year, profile=p, extra=extra, summary=s, disposals=res["disposals"], incomes=res["incomes"],
                   holdings=holdings_list(res["holdings"]), opening=holdings_list(res["opening"]),
                   warnings=res["warnings"][:200], warnings_total=len(res["warnings"]), unvalued=unvalued,
                   cuadre=cuadre(uid, p), books=tax.books(res, moves, year),
                   deadline=tax.deadline(year, p["nit"]), uvt_known=year in tax.UVT)


@app.get("/api/market")
@with_session
def market():
    """Valor de mercado al 31 de diciembre (informativo: se declara el costo fiscal)."""
    year = year_arg()
    _, end = tax.year_bounds(year)
    t = min(end - 60, time.time())
    _, _, res, _ = run_report(g.user["id"], year)
    out, errors = {}, []
    for a, h in res["holdings"].items():
        try:
            v = rates.cop(a, h["qty"], t)
            out[a] = {"cop": v["cop"], "usd": v["usd"] * h["qty"], "trm": v["trm"]}
        except RateError as e:
            errors.append(f"{a}: {e}")
    return jsonify(t=t, values=out, errors=errors)


def fmt_t(t):
    return datetime.fromtimestamp(t, tax.CO_TZ).strftime("%Y-%m-%d %H:%M")


def movements_csv(uid, start, end):
    rows = []
    for m in moves(uid, start, end):
        k, v, fee, gmf = m["kind"], m["cop_value"] or 0.0, m["fee_cop"] or 0.0, m["gmf_cop"] or 0.0
        left = v + fee + gmf if k == "compra" else v + gmf if k in ("gasto", "retiro") else 0.0
        came = v - fee if k == "venta" else v if k == "aporte" else 0.0
        rows.append([fmt_t(m["t"]), k, tax.ref_label(m.get("ext_id")), m["out_asset"] or "", m["out_qty"], m["in_asset"] or "", m["in_qty"],
                     v, fee, m.get("fee_qty") or 0.0, m.get("fee_asset") or "", gmf, left, came, m["platform"],
                     tax.pay_label(m.get("pay_method") or ""), m["counterpart"], m.get("category") or "", m["source"], m["note"]])
    return (["Fecha", "Tipo", "Referencia", "Entrega", "Cantidad entregada", "Recibe", "Cantidad recibida", "Valor COP",
             "Comisión Binance COP", "Comisión en cripto", "Cripto de la comisión", "4x1000 COP", "Salió de tus cuentas COP",
             "Entró a tus cuentas COP", "Plataforma", "Medio de pago", "Contraparte", "Categoría", "Origen", "Nota"], rows)


def csv_response(name, header, rows):
    return Response(to_csv(header, rows), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export/<kind>.csv")
@with_session
def export(kind):
    if kind == "libro-cripto":
        return export_kardex()
    if kind.startswith("libro-"):
        return export_libro(kind[len("libro-"):])
    year = year_arg()
    uid = g.user["id"]
    if kind == "movimientos":
        start, end = tax.year_bounds(year)
        return csv_response(f"movimientos-{year}.csv", *movements_csv(uid, start, end))
    _, _, res, _ = run_report(uid, year)
    if kind == "ganancias":
        rows = [[fmt_t(x["t"]), x["kind"], x["asset"], x["qty"], x["gross"], x["fee"], x["cost"], x["gain"],
                 x["ro_gain"], x["go_gain"], round(x["days_min"], 1), round(x["days_max"], 1),
                 x["missing"] > 1e-9] for x in res["disposals"]]
        rows += [[fmt_t(x["t"]), x["kind"], x["asset"], x["qty"], x["value"], 0.0, 0.0, x["value"],
                  x["value"] if x["kind"] == "ingreso" else 0.0, x["value"] if x["kind"] == "airdrop" else 0.0, "", "", False]
                 for x in res["incomes"]]
        rows.sort(key=lambda r: r[0])
        return csv_response(f"ganancias-{year}.csv",
                            ["Fecha", "Tipo", "Cripto", "Cantidad", "Valor de enajenación COP", "Comisión COP",
                             "Costo fiscal COP", "Utilidad COP", "Renta ordinaria COP", "Ganancia ocasional COP",
                             "Días tenencia (mín)", "Días tenencia (máx)", "Sin costo registrado"], rows)
    if kind == "patrimonio":
        rows = [[h["asset"], h["qty"], h["cost"], fmt_t(h["since"])] for h in holdings_list(res["holdings"])]
        return csv_response(f"patrimonio-31dic{year}.csv",
                            ["Cripto", "Cantidad al 31/12", "Costo fiscal COP", "Lote más antiguo"], rows)
    abort(404)


@app.get("/api/plantilla.csv")
@with_session
def template():
    return csv_response("plantilla-movimientos.csv", COLUMNS, TEMPLATE_ROWS)


# ------------------------------------------------------------ libros contables y cierres

def user_journal(uid):
    p = db.profile(uid)
    return ledger.journal(moves(uid), db.closings(uid), p["habitual"], p["method"], db.notes(uid))


def period_arg():
    """Año y mes (0 = todo el año) de la consulta → (inicio, fin, etiqueta)."""
    year = year_arg()
    try:
        month = int(request.args.get("month", "0"))
    except ValueError:
        raise Bad("Mes inválido.")
    if not 0 <= month <= 12:
        raise Bad("Mes inválido.")
    if month == 0:
        start, end = tax.year_bounds(year)
        return start, end, str(year), year, month
    start = datetime(year, month, 1, tzinfo=tax.CO_TZ).timestamp()
    end = (datetime(year + 1, 1, 1, tzinfo=tax.CO_TZ) if month == 12 else datetime(year, month + 1, 1, tzinfo=tax.CO_TZ)).timestamp()
    return start, end, f"{year}-{month:02d}", year, month


def named(entries):
    return [{**e, "lines": [{**ln, "name": ledger.ACCOUNTS[ln["account"]][0]} for ln in e["lines"]]} for e in entries]


@app.get("/api/libros")
@with_session
def libros():
    uid = g.user["id"]
    start, end, label, year, month = period_arg()
    entries = user_journal(uid)
    at = min(end - 1, time.time())
    return jsonify(period={"start": start, "end": end, "label": label, "year": year, "month": month, "at": at},
                   journal=named([e for e in entries if start <= e["t"] < end]),
                   trial=ledger.trial_balance(entries, start, end),
                   income=ledger.income_statement(entries, start, end),
                   balance=ledger.balance_sheet(entries, at),
                   equity=ledger.equity_changes(entries, start, end),
                   cashflow=ledger.cash_flow(entries, start, end, db.profile(uid)["habitual"]),
                   lock_until=db.lock_until(uid))


@app.get("/api/puc")
@with_session
def puc():
    return jsonify(accounts=[{"account": c, "name": n, "nature": nat, "class": cls} for c, (n, nat, cls) in ledger.ACCOUNTS.items()])


def clean_note(d):
    """Valida una nota de contabilidad: fecha, detalle y renglones con débitos = créditos."""
    t = num(d.get("t"), "Fecha")
    if not MIN_T <= t <= time.time() + 86400:
        raise Bad("Fecha fuera de rango.")
    detail = text(d.get("text"), 200)
    if not detail:
        raise Bad("Escribe el detalle de la nota (por ejemplo: causación de honorarios del contador).")
    lines = []
    for ln in d.get("lines") if isinstance(d.get("lines"), list) else []:
        acc = str((ln or {}).get("account") or "")
        if acc not in ledger.ACCOUNTS:
            raise Bad(f"La cuenta {acc or '(vacía)'} no existe en el plan de cuentas.")
        dr, cr = num(ln.get("debit"), "Débito", required=False), num(ln.get("credit"), "Crédito", required=False)
        if (dr > 0) == (cr > 0):
            raise Bad(f"Cuenta {acc}: escribe el valor en débito o en crédito, no en los dos.")
        lines.append({"account": acc, "debit": round(dr, 2), "credit": round(cr, 2)})
    if not 2 <= len(lines) <= 40:
        raise Bad("Una nota necesita entre 2 y 40 renglones.")
    if abs(sum(x["debit"] for x in lines) - sum(x["credit"] for x in lines)) > 0.005:
        raise Bad("Los débitos y los créditos deben sumar igual.")
    return {"t": t, "text": detail, "support": text(d.get("support"), 120), "lines": lines}


@app.post("/api/notas")
@with_session
@needs_binance
def note_create():
    n = clean_note(body())
    check_open(g.user["id"], n["t"])
    return jsonify(id=db.add_note(g.user["id"], n, time.time()))


@app.post("/api/notas/<int:nid>/borrar")
@with_session
@needs_binance
def note_delete(nid):
    body()
    n = next((x for x in db.notes(g.user["id"]) if x["id"] == nid), None)
    if not n:
        return jsonify(error="No existe esa nota."), 404
    check_open(g.user["id"], n["t"])
    db.delete_note(g.user["id"], nid)
    return jsonify(ok=True)


def inventory_book(uid, start, end, entries=None):
    """Libro de inventarios y balances al corte: el balance y el detalle de cada cripto (cantidad, costo y valor de mercado)."""
    p = db.profile(uid)
    at = min(end - 1, time.time())
    entries = user_journal(uid) if entries is None else entries
    res = tax.compute(moves(uid, end=at + 1e-6), datetime.fromtimestamp(at, tax.CO_TZ).year, p["habitual"], p["method"])
    cryptos = []
    for h in holdings_list(res["holdings"]):
        if h["qty"] <= 1e-12:
            continue
        try:
            mk = rates.cop(h["asset"], h["qty"], at)
        except Exception:  # sin internet o sin precio: el valor de mercado queda en blanco
            mk = {"cop": None, "usd": None, "trm": None}
        cryptos.append({"asset": h["asset"], "qty": h["qty"], "cost": h["cost"], "unit": h["cost"] / h["qty"], "since": h["since"],
                        "market": mk["cop"], "usd": mk["usd"], "trm": mk["trm"]})
    return {"at": at, "account": "1435" if p["habitual"] else "1625", "balance": ledger.balance_sheet(entries, at), "cryptos": cryptos}


@app.get("/api/inventarios")
@with_session
def inventarios():
    start, end, label, year, month = period_arg()
    return jsonify(period={"label": label, "year": year, "month": month}, **inventory_book(g.user["id"], start, end))


@app.get("/api/notas-ef")
@with_session
def notas_ef():
    return jsonify(notes=fs_notes(g.user["id"], year_arg()))


def cash_book(uid, start, end, entries=None):
    """Caja diaria: cada día se cierra solo a medianoche y queda congelado con el cierre del mes."""
    book = ledger.daily_cash(user_journal(uid) if entries is None else entries, start, end)
    now, lock = time.time(), db.lock_until(uid)
    real = {datetime.fromtimestamp(c["t"], tax.CO_TZ).date().isoformat(): c["cash_real"]
            for c in db.closings(uid) if c["kind"] in ("caja", "inicio") and not c["auto"]}
    for d in book["days"]:
        day_end = (datetime.fromisoformat(d["day"]).replace(tzinfo=tax.CO_TZ) + timedelta(days=1)).timestamp() - 1
        d["status"] = "abierto" if day_end > now else "congelado" if day_end <= lock else "cerrado"
        d["real"] = real.get(d["day"])  # saldo real si ese día cuadraste caja
    return book


def cash_book_csv(book):
    rows = [["", "", "Saldo inicial", "", "", "", book["opening"]]]
    for d in book["days"]:
        rows += [[e["number"], fmt_t(e["t"]), e["text"], e["in"] or "", e["out"] or "", e["gmf"] or "", e["balance"]] for e in d["entries"]]
        rows.append(["", d["day"], f"Cierre del día ({d['status']})", d["in"], d["out"], d["gmf"], d["closing"]])
    rows.append(["", "", "Totales y saldo final", book["totals"]["in"], book["totals"]["out"], book["totals"]["gmf"], book["closing"]])
    return ["Comprobante", "Fecha", "Detalle", "Entradas", "Salidas", "4x1000", "Saldo"], rows


@app.get("/api/caja-diaria")
@with_session
def caja_diaria():
    uid = g.user["id"]
    start, end, label, year, month = period_arg()
    return jsonify(period={"label": label, "year": year, "month": month}, lock_until=db.lock_until(uid), **cash_book(uid, start, end))


@app.post("/api/caja/iniciar")
@with_session
@needs_binance
def caja_iniciar():
    """Arranca la caja con lo que hay hoy en la cuenta: la diferencia con los libros entra como aporte o retiro."""
    uid = g.user["id"]
    d = body()
    real = num(d.get("cash_real"), "Saldo de hoy")
    account = text(d.get("account"), 40) or "Nequi"
    cid = make_closing(uid, "inicio", time.time(), real, False, f"Inicio de caja en {account}")
    db.set_cash_account(uid, account)
    return jsonify(id=cid)


@app.get("/api/caja")
@with_session
def caja():
    """La caja desde que se inició: saldo inicial, cada entrada y salida con su saldo, y el saldo de hoy."""
    uid = g.user["id"]
    start = next((c for c in reversed(db.closings(uid)) if c["kind"] == "inicio"), None)
    if not start:
        return jsonify(start=None, account=db.profile(uid)["cash_account"], balance=ledger.cash_at(user_journal(uid), time.time()))
    book = cash_book(uid, start["t"] + 1e-3, time.time() + 86400)
    return jsonify(start={"t": start["t"], "amount": start["cash_real"]}, account=db.profile(uid)["cash_account"],
                   balance=book["closing"], **book)


@app.get("/api/libro-cripto")
@with_session
def libro_cripto():
    uid = g.user["id"]
    year = year_arg()
    p = db.profile(uid)
    return jsonify(year=year, method=p["method"], name=p["name"], nit=p["nit"], username=g.user["username"],
                   assets=tax.kardex(moves(uid), year, p["method"]))


def kardex_csv(uid, year):
    p = db.profile(uid)
    rows = []
    for b in tax.kardex(moves(uid), year, p["method"]):
        rows.append([b["asset"], "", "Saldo inicial", "", "", "", "", "", "", "", "", b["opening"]["qty"], b["opening"]["cost"], ""])
        for r in b["rows"]:
            rows.append([b["asset"], fmt_t(r["t"]), r["text"], r["ref"], r.get("in_qty", ""), r.get("in_unit", ""), r.get("in_cost", ""),
                         r.get("out_qty", ""), r.get("out_unit", ""), r.get("out_cost", ""), r.get("sale", ""),
                         r["bal_qty"], r["bal_cost"], r.get("gain", "")])
        rows.append([b["asset"], "", "Saldo final", "", b["totals"]["in_qty"], "", b["totals"]["in_cost"], b["totals"]["out_qty"], "",
                     b["totals"]["out_cost"], b["totals"]["sales"], b["closing"]["qty"], b["closing"]["cost"], b["totals"]["gain"]])
    return (["Cripto", "Fecha", "Detalle", "Referencia", "Entrada cantidad", "Entrada costo unitario", "Entrada costo total",
             "Salida cantidad", "Salida costo unitario", "Salida costo total", "Valor de venta", "Saldo cantidad",
             "Saldo costo", "Utilidad"], rows)


def export_kardex():  # /api/export/libro-cripto.csv (la reparte export)
    year = year_arg()
    return csv_response(f"libro-criptoactivos-{year}.csv", *kardex_csv(g.user["id"], year))


def export_libro(kind):  # /api/export/libro-<kind>.csv (la reparte export)
    uid = g.user["id"]
    start, end, label, _, _ = period_arg()
    entries = user_journal(uid)
    if kind == "diario":
        rows = [[e["number"], fmt_t(e["t"]), e["text"], ln["account"], ledger.ACCOUNTS[ln["account"]][0], ln["debit"], ln["credit"]]
                for e in entries if start <= e["t"] < end for ln in e["lines"]]
        return csv_response(f"libro-diario-{label}.csv", ["Comprobante", "Fecha", "Detalle", "Cuenta", "Nombre", "Débito", "Crédito"], rows)
    if kind == "mayor":
        tb = ledger.trial_balance(entries, start, end)
        rows = [[r["account"], r["name"], r["previous"], r["debit"], r["credit"], r["final"]] for r in tb["rows"]]
        rows.append(["", "Totales", "", tb["totals"]["debit"], tb["totals"]["credit"], ""])
        return csv_response(f"mayor-y-balances-{label}.csv", ["Cuenta", "Nombre", "Saldo anterior", "Débitos", "Créditos", "Saldo final"], rows)
    if kind == "balance":
        return csv_response(f"balance-general-{label}.csv", *balance_csv(ledger.balance_sheet(entries, min(end - 1, time.time()))))
    if kind == "resultados":
        return csv_response(f"estado-de-resultados-{label}.csv", *income_csv(ledger.income_statement(entries, start, end)))
    if kind == "caja":
        return csv_response(f"libro-caja-diaria-{label}.csv", *cash_book_csv(cash_book(uid, start, end, entries)))
    if kind == "inventarios":
        return csv_response(f"inventarios-y-balances-{label}.csv", *inventory_csv(inventory_book(uid, start, end, entries)))
    if kind == "patrimonio":
        return csv_response(f"cambios-en-el-patrimonio-{label}.csv", *equity_csv(ledger.equity_changes(entries, start, end)))
    if kind == "flujo":
        return csv_response(f"flujo-de-efectivo-{label}.csv",
                            *cashflow_csv(ledger.cash_flow(entries, start, end, db.profile(uid)["habitual"])))
    abort(404)


def balance_csv(bs):
    rows = [["Activo", x["account"], x["name"], x["value"]] for x in bs["assets"]]
    rows.append(["Total activo", "", "", bs["total_assets"]])
    rows += [["Pasivo", x["account"], x["name"], x["value"]] for x in bs["liabilities"]]
    rows.append(["Total pasivo", "", "", bs["total_liabilities"]])
    rows += [["Patrimonio", x["account"], x["name"], x["value"]] for x in bs["equity"]]
    rows.append(["Total patrimonio", "", "", bs["total_equity"]])
    rows.append(["Total pasivo y patrimonio", "", "", bs["total_liabilities"] + bs["total_equity"]])
    return ["Grupo", "Cuenta", "Nombre", "Valor"], rows


def income_csv(inc):
    """Estado de resultados en el orden del PUC, con sus subtotales."""
    return ["Cuenta", "Concepto", "Valor"], [[x["account"], x["label"], "" if x["value"] is None else x["value"]] for x in inc["layout"]]


def inventory_csv(inv):
    b = inv["balance"]
    rows = [["Activo", x["account"], x["name"], "", "", x["value"], ""] for x in b["assets"]]
    rows += [["Detalle " + inv["account"], "", x["asset"], x["qty"], x["unit"], x["cost"], x["market"] if x["market"] is not None else ""]
             for x in inv["cryptos"]]
    rows.append(["Total activo", "", "", "", "", b["total_assets"], ""])
    rows += [["Pasivo", x["account"], x["name"], "", "", x["value"], ""] for x in b["liabilities"]]
    rows.append(["Total pasivo", "", "", "", "", b["total_liabilities"], ""])
    rows += [["Patrimonio", x["account"], x["name"], "", "", x["value"], ""] for x in b["equity"]]
    rows.append(["Total pasivo y patrimonio", "", "", "", "", b["total_liabilities"] + b["total_equity"], ""])
    return ["Grupo", "Cuenta", "Nombre / cripto", "Cantidad", "Costo unitario", "Valor en libros", "Valor de mercado"], rows


def equity_csv(eq):
    cols = eq["columns"]
    return (["Concepto", *[f"{c['account']} {c['name']}" for c in cols], "Total"],
            [[r["label"], *[r["values"][c["account"]] for c in cols], r["total"]] for r in eq["rows"]])


def notes_text(notes, year):
    """Notas a los estados financieros en texto plano (para el paquete del contador)."""
    def cell(head, v):
        if v is None or isinstance(v, str):
            return v or "—"
        if head == "Cantidad":
            return f"{v:.8f}".rstrip("0").rstrip(".")
        return str(int(v)) if head == "Operaciones" else workbook.fmt_money(v)

    out = [f"NOTAS A LOS ESTADOS FINANCIEROS - {year}", ""]
    for n in notes:
        out += [f"Nota {n['n']}. {n['title']}", *n["text"]]
        t = n.get("table")
        if t and t["rows"]:
            out.append("  " + " | ".join(t["head"]))
            out += ["  " + " | ".join(cell(h, v) for h, v in zip(t["head"], r)) for r in t["rows"]]
        out.append("")
    return "\r\n".join(out)


def cashflow_csv(cf):
    rows = [["Efectivo al inicio del periodo", cf["opening"]]]
    for s in cf["sections"]:
        rows += [[f"{s['label']}: {ln['label']}", ln["value"]] for ln in s["lines"]]
        rows.append([f"Efectivo neto de {s['label'].lower()}", s["total"]])
    rows += [["Aumento (disminución) neto del efectivo", cf["net"]], ["Efectivo al final del periodo", cf["closing"]]]
    return ["Concepto", "Valor"], rows


def month_end(y, m):
    """Último segundo del mes en hora de Colombia."""
    nxt = datetime(y + 1, 1, 1, tzinfo=tax.CO_TZ) if m == 12 else datetime(y, m + 1, 1, tzinfo=tax.CO_TZ)
    return nxt.timestamp() - 1


def closing_target(d):
    """Fin del periodo a cerrar según el tipo de cierre."""
    kind = d.get("kind")
    if kind == "caja":
        t = num(d.get("t"), "Fecha")
    elif kind == "mes":
        y, m = int(num(d.get("year"), "Año", minimum=2015)), int(num(d.get("month"), "Mes", minimum=1))
        if m > 12:
            raise Bad("Mes inválido.")
        t = month_end(y, m)
    elif kind == "anio":
        t = tax.year_bounds(int(num(d.get("year"), "Año", minimum=2015)))[1] - 1
    else:
        raise Bad("Tipo de cierre inválido.")
    if t > time.time() + 60:
        raise Bad("No se puede cerrar un periodo que aún no termina.")
    return kind, t


def closing_snapshot(uid, kind, t, entries):
    year = datetime.fromtimestamp(t, tax.CO_TZ).year
    ys, _ = tax.year_bounds(year)
    snap = {"balance": ledger.balance_sheet(entries, t), "income_year": ledger.income_statement(entries, ys, t + 1e-6),
            "trial_year": ledger.trial_balance(entries, ys, t + 1e-6)}
    if kind == "mes":
        ms = datetime.fromtimestamp(t, tax.CO_TZ).replace(day=1, hour=0, minute=0, second=0).timestamp()
        snap["income_month"] = ledger.income_statement(entries, ms, t + 1e-6)
    if kind == "anio":
        _, _, res, s = run_report(uid, year)
        snap["declaracion"] = {"casillas": s["f210"]["casillas"], "tax_total": s["tax_total"], "topes": s["topes"]}
        snap["holdings"] = holdings_list(res["holdings"])
    return snap


closing_lock = threading.Lock()  # el cierre automático (hilo de fondo) y el manual no se cruzan


def make_closing(uid, kind, t, real=None, locked=True, note="", auto=False):
    """Guarda un cierre con su ajuste de caja y la foto de los estados. real=None: toma la caja de los libros, sin negativos."""
    with closing_lock:
        last = db.closings(uid)
        if last and t <= last[-1]["t"]:
            raise Bad(f"Ya hay un cierre hasta el {fmt_t(last[-1]['t'])}. Los cierres van en orden.")
        p = db.profile(uid)
        ms = moves(uid)
        notes = db.notes(uid)
        expected = ledger.cash_at(ledger.journal(ms, last, p["habitual"], p["method"], notes), t)
        if real is None:
            real = max(expected, 0.0)
        c = {"kind": kind, "t": t, "cash_expected": expected, "cash_real": real, "adjustment": real - expected,
             "locked": locked, "note": note, "auto": auto}
        if auto:
            c["note"] = "Hecho solo." + (" Los pesos que faltaban en tus libros quedaron como aporte tuyo." if c["adjustment"] > 0.5 else "")
        # el ajuste entra a los libros antes de tomar la foto
        entries = ledger.journal(ms, [*last, {**c, "id": -1}], p["habitual"], p["method"], notes)
        c["snapshot"] = json.dumps(closing_snapshot(uid, kind, t, entries))
        return db.add_closing(uid, c, time.time())


def auto_status(uid):
    """Próximo cierre automático: el mes que sigue al último cierre (o el del primer movimiento) y si ya se puede hacer."""
    p = db.profile(uid)
    last = db.closings(uid)
    start = last[-1]["t"] + 1 if last else db.first_movement_t(uid)
    st = {"on": p["auto_close"], "next": None, "ready": False, "reason": None}
    if start is None:
        return st
    d = datetime.fromtimestamp(start, tax.CO_TZ)
    t = month_end(d.year, d.month)
    st["next"] = {"kind": "anio" if d.month == 12 else "mes", "year": d.year, "month": d.month, "t": t,
                  "label": f"{MONTHS[d.month - 1]} {d.year}", "due": t + AUTO_CLOSE_AFTER}
    if time.time() >= t + AUTO_CLOSE_AFTER:
        st["reason"] = auto_close_blocker(uid, p, t)
        st["ready"] = p["auto_close"] and not st["reason"]
    return st


def auto_close_blocker(uid, p, t):
    """Lo que impide congelar los libros hasta t sin que falte nada (None si está todo)."""
    b = db.binance(uid)
    if b and (b["last_ok"] or 0) < t + 3600:
        return f"Binance no sincroniza: {b['last_error']}" if b["last_error"] else "Esperando que Binance sincronice."
    _, _, res, _ = run_report(uid, datetime.fromtimestamp(t, tax.CO_TZ).year)
    missing = sum(1 for w in res["warnings"] if w["t"] <= t)
    if missing:
        return f"{missing} ventas sin su compra. Agrega las compras que faltan en Movimientos."
    unvalued = sum(1 for m in db.movements(uid, None, t + 1e-6)
                   if m["kind"] in ("permuta", "ingreso", "airdrop") and (m["cop_value"] or 0) <= 0)
    if unvalued:
        return f"{unvalued} operaciones sin valor en pesos. Complétalas en Movimientos."
    cq = cuadre(uid, p)
    if cq and not cq["ok"]:
        return "Tus cripto no cuadran con Binance (" + ", ".join(r["asset"] for r in cq["rows"] if not r["ok"]) + "). Revísalas en Inicio."
    return None


def auto_close(uid):
    """Hace los cierres de mes que ya tocan (diciembre se cierra como año). Devuelve cuántos hizo."""
    n = 0
    while n < 36:  # pone al día hasta 3 años de meses pendientes
        st = auto_status(uid)
        if not st["ready"]:
            break
        x = st["next"]
        make_closing(uid, x["kind"], x["t"], auto=True)
        log.info("cierre automático de %s (usuario %s)", x["label"], uid)
        n += 1
    return n


@app.get("/api/cierres")
@with_session
def cierres():
    uid = g.user["id"]
    entries = user_journal(uid)
    return jsonify(closings=db.closings(uid), lock_until=db.lock_until(uid), cash_now=ledger.cash_at(entries, time.time()),
                   auto=auto_status(uid))


@app.post("/api/cierres/auto")
@with_session
@needs_binance
def cierre_auto():
    uid = g.user["id"]
    db.set_auto_close(uid, bool(body().get("on")))
    made = auto_close(uid)
    return jsonify(made=made, auto=auto_status(uid))


def cash_by_method(uid, t, start=None):
    """Pesos que salieron y entraron por cada medio de pago (Nequi, Bancolombia…) hasta la fecha."""
    rows = {}
    for m in moves(uid, start=start, end=t + 1e-6):
        if m["kind"] not in ("compra", "venta", "gasto", "aporte", "retiro"):
            continue
        key = m.get("pay_method") or ("Sin medio de pago" if m["kind"] in ("compra", "venta") else "Otros movimientos de caja")
        r = rows.setdefault(key, {"method": key, "out": 0.0, "in": 0.0, "gmf": 0.0, "ops": 0})
        v = float(m["cop_value"] or 0)
        if m["kind"] in ("venta", "aporte"):
            r["in"] += v - (float(m["fee_cop"] or 0) if m["kind"] == "venta" else 0)
        else:
            r["out"] += v + (float(m["fee_cop"] or 0) if m["kind"] == "compra" else 0)
        r["gmf"] += float(m["gmf_cop"] or 0)
        r["ops"] += 1
    for r in rows.values():
        r["net"] = r["in"] - r["out"] - r["gmf"]
    return sorted(rows.values(), key=lambda r: -(r["in"] + r["out"]))


@app.post("/api/cierres")
@with_session
@needs_binance
def cierre_create():
    uid = g.user["id"]
    d = body()
    kind, t = closing_target(d)
    real = num(d.get("cash_real"), "Saldo real en bancos", minimum=-1e15)
    locked = True if kind in ("mes", "anio") else bool(d.get("lock", True))
    cid = make_closing(uid, kind, t, real, locked, text(d.get("note"), 300))
    return jsonify(id=cid, closing=db.closing(uid, cid) and {k: v for k, v in db.closing(uid, cid).items() if k != "snapshot"})


@app.get("/api/cierres/<int:cid>")
@with_session
def cierre_detail(cid):
    c = db.closing(g.user["id"], cid)
    if not c:
        return jsonify(error="No existe ese cierre."), 404
    c["snapshot"] = json.loads(c["snapshot"] or "{}")
    return jsonify(c)


@app.post("/api/cierres/reabrir")
@with_session
@needs_binance
def cierre_reopen():
    body()
    uid = g.user["id"]
    with closing_lock:
        last = db.closings(uid)
        if not last:
            return jsonify(error="No hay cierres para reabrir."), 400
        db.delete_last_closing(uid)
        if last[-1]["locked"]:  # si no, el cierre automático lo volvería a hacer enseguida
            db.set_auto_close(uid, False)
    return jsonify(reopened=last[-1]["id"], lock_until=db.lock_until(uid), auto=auto_status(uid))


GMF_TEXT = {"todas": "Se paga en todas las compras: $4.000 por cada $1.000.000 que sale de tu cuenta.",
            "exenta": "Cuenta exenta: el banco no lo cobra.",
            "tope350": "Cuenta exenta hasta 350 UVT al mes: se paga solo sobre lo que pase de ese tope."}


def gmf_text(p):
    t = GMF_TEXT.get(p["gmf_mode"], GMF_TEXT["todas"])
    special = {k: v for k, v in (p.get("gmf_methods") or {}).items() if v and v != p["gmf_mode"]}
    if special:
        t += " Excepto: " + ", ".join(f"{tax.pay_label(k)} ({dict(todas='paga', exenta='exenta', tope350='exenta hasta el tope').get(v, v)})"
                                     for k, v in special.items()) + "."
    return t


def fs_notes(uid, year, entries=None, inv=None):
    """Notas a los estados financieros: quién reporta, cómo se preparan, políticas, el detalle de cada cifra
    y los supuestos de cálculo, para que el contador sepa de dónde sale cada número."""
    p = db.profile(uid)
    start, end = tax.year_bounds(year)
    now = time.time()
    at = min(end - 1, now)
    entries = user_journal(uid) if entries is None else entries
    inv = inventory_book(uid, start, end, entries) if inv is None else inv
    bs, inc = ledger.balance_sheet(entries, at), ledger.income_statement(entries, start, end)
    eq, cf = ledger.equity_changes(entries, start, end), ledger.cash_flow(entries, start, end, p["habitual"])
    ms = [m for m in moves(uid) if start <= m["t"] < end]
    M, D = workbook.fmt_money, lambda t: datetime.fromtimestamp(t, tax.CO_TZ).strftime("%d/%m/%Y")
    who = p["name"] or (db.one("SELECT username FROM users WHERE id=?", (uid,)) or {}).get("username", "")
    method = "PEPS (primero en entrar, primero en salir)" if p["method"] == "fifo" else "promedio ponderado"
    acc = inv["account"]
    notes = []

    def note(title, *paras, table=None):
        notes.append({"n": len(notes) + 1, "title": title, "text": [x for x in paras if x], "table": table})

    pays = sorted({tax.pay_label(m.get("pay_method") or "") for m in ms if m.get("pay_method")})
    note("Entidad que reporta",
         f"{who}{', cédula ' + p['nit'] if p['nit'] else ' (sin cédula: regístrala en Ajustes)'} es una persona natural que compra y "
         "vende criptoactivos " + ("de forma habitual: es su actividad comercial." if p["habitual"] else "como inversión, sin habitualidad."),
         "Opera en Binance (P2P, Convert y Spot)." + (f" Paga y recibe pesos por: {', '.join(pays)}." if pays else ""))
    note("Bases de preparación",
         f"Periodo: 1 de enero a 31 de diciembre de {year}" + (f" (año en curso: cifras al {D(at)})" if now < end else "") + ".",
         "Moneda funcional y de presentación: peso colombiano (COP). Base de medición: costo histórico.",
         "Los hechos económicos se registran por partida doble con las cuentas del Plan Único de Cuentas (Decreto 2650 de 1993). "
         "Cada comprobante del libro diario tiene su soporte: el número de orden de Binance, el cierre de caja o la nota de contabilidad.",
         "El marco técnico normativo aplicable (por ejemplo, el de microempresas del Decreto 2420 de 2015) lo define el contador.")
    note("Políticas contables",
         f"Criptoactivos: se reconocen como {'inventario (1435), porque se compran para venderlos en el giro ordinario' if p['habitual'] else 'activos intangibles (1625)'} "
         f"y se miden al costo. El costo incluye lo pagado y la comisión que cobra Binance (art. 69 ET). Las salidas se costean por {method}.",
         "Permutas: cambiar una cripto por otra se registra como venta de la entregada y compra de la recibida, al valor comercial del "
         "momento: precio en dólares de Binance (vela de 1 hora) × TRM del día (art. 90 ET; Concepto DIAN 1621 de 2023).",
         "Ingresos: se reconocen cuando se entrega la cripto (venta P2P o permuta). Los rendimientos de Earn o staking, por su valor el día que se reciben.",
         f"4x1000 (GMF): gasto en la cuenta 5115. {gmf_text(p)} Fiscalmente se deduce el 50 % (art. 115 ET).",
         "Cierres: cada mes se cierra 3 días después de terminado; el periodo queda congelado y se guarda la foto de los estados financieros.")

    cash = sum(x["value"] for x in bs["assets"] if x["account"] in ledger.CASH_ACCOUNTS)
    inflow = sum(ln["value"] for s in cf["sections"] for ln in s["lines"] if ln["value"] > 0)
    outflow = -sum(ln["value"] for s in cf["sections"] for ln in s["lines"] if ln["value"] < 0)
    inicio = next((c for c in reversed(db.closings(uid)) if c["kind"] == "inicio"), None)
    cuadres = [c for c in db.closings(uid) if c["kind"] in ("inicio", "caja") and start <= c["t"] < end]
    note("Efectivo (caja y bancos)",
         f"Saldo al corte: {M(cash)}. En el periodo entraron {M(inflow)} y salieron {M(outflow)} (ver estado de flujos de efectivo).",
         (f"La caja se inició el {D(inicio['t'])} con el saldo real de {p['cash_account'] or 'la cuenta'}: {M(inicio['cash_real'])}. "
          f"La diferencia con los libros ({M(inicio['adjustment'])}) se registró como {'aporte' if inicio['adjustment'] >= 0 else 'retiro'} del propietario.")
         if inicio else "No se ha registrado el saldo real de las cuentas: Bancos arranca en cero y su saldo es el neto de lo que entró y salió "
         "por las operaciones." + (" El saldo negativo indica que falta registrar el dinero con el que se empezó (Inicio → Inicia tu caja)." if cash < -0.5 else ""),
         table={"head": ["Fecha", "Tipo", "Según libros", "Saldo real", "Diferencia"],
                "rows": [[D(c["t"]), "Inicio de caja" if c["kind"] == "inicio" else "Cuadre de caja", c["cash_expected"], c["cash_real"], c["adjustment"]]
                         for c in cuadres]} if cuadres else None)

    if inv["cryptos"]:
        cost = sum(x["cost"] for x in inv["cryptos"])
        priced = [x for x in inv["cryptos"] if x["market"] is not None]
        gap = sum(x["market"] - x["cost"] for x in priced)
        note("Criptoactivos",
             f"Se presentan al costo en la cuenta {acc}: {M(cost)} al {D(inv['at'])}. El valor de mercado es informativo "
             "(precio de Binance × TRM al corte) y no se registra en los libros.",
             f"El valor de mercado es menor que el costo en {M(-gap)}: el contador evalúa si corresponde reconocer deterioro." if gap < -0.5 else "",
             table={"head": ["Cripto", "Cantidad", "Costo unitario", "Costo total", "Valor de mercado", "Diferencia"],
                    "rows": [[x["asset"], x["qty"], x["unit"], x["cost"], x["market"], None if x["market"] is None else x["market"] - x["cost"]]
                             for x in inv["cryptos"]]})
    else:
        note("Criptoactivos", f"Al {D(inv['at'])} no hay criptoactivos: todo lo comprado se vendió o se cambió.")

    note("Patrimonio",
         "El patrimonio es el capital que ha puesto el propietario más los resultados acumulados (ver estado de cambios en el patrimonio).",
         table={"head": ["Concepto", "Valor"], "rows": [[r["label"], r["total"]] for r in eq["rows"]]})

    def count(kinds):
        sel = [m for m in ms if m["kind"] in kinds]
        return len(sel), sum(float(m["cop_value"] or 0) for m in sel)

    sales, swaps, earn, drops = count(("venta",)), count(("permuta",)), count(("ingreso",)), count(("airdrop",))
    received = sum(float(m["cop_value"] or 0) - float(m["fee_cop"] or 0) for m in ms if m["kind"] == "venta")
    note("Ingresos",
         f"Las permutas (cambios de una cripto por otra) son ventas para efectos fiscales (art. 90 ET): por eso los ingresos son mayores "
         f"que el dinero que entró a las cuentas por ventas ({M(received)})." if swaps[0] else "",
         table={"head": ["Concepto", "Operaciones", "Valor"],
                "rows": [[label, n, v] for label, (n, v) in (("Ventas P2P y Spot", sales), ("Permutas (Convert)", swaps),
                                                             ("Rendimientos (Earn, staking)", earn), ("Airdrops", drops)) if n]})
    note("Costos y gastos",
         table={"head": ["Cuenta", "Nombre", "Valor"],
                "rows": [[r["account"], r["name"], r["value"]] for r in inc["rows"] if not r["section"].startswith("ingresos")]})

    gmf = inc["lines"].get("5115", 0.0)
    n_notes = sum(1 for e in entries if e["kind"] == "nota" and start <= e["t"] < end)
    note("Diferencias entre la contabilidad y la declaración de renta",
         f"4x1000: en los libros va completo ({M(gmf)}); en la declaración se deduce la mitad ({M(gmf / 2)})." if gmf else "",
         f"Las {n_notes} notas de contabilidad del periodo cambian los libros, no el cálculo de la declaración, que sale de las operaciones." if n_notes else "",
         "Los criptoactivos se declaran al costo fiscal (art. 267 ET), igual que en los libros.")

    cert = db.year_extra(uid, year).get("gmf_cert") or 0
    note("Origen de las cifras y supuestos de cálculo",
         "Compras, ventas, cambios, cantidades y comisiones salen tal cual de las órdenes de Binance (conexión de solo lectura); "
         "cada comprobante lleva su número de orden.",
         "La comisión de Binance en cripto se pasa a pesos al precio de la misma compra.",
         "El valor de las permutas, rendimientos y airdrops es precio en dólares de Binance × TRM del día (datos.gov.co, Superfinanciera).",
         "El 4x1000 se calcula como 0,4 % de lo que sale de la cuenta según la configuración de Ajustes." +
         (f" Para la declaración se usa el certificado del banco: {M(cert)}." if cert else " Si tienes el certificado del banco, regístralo en Declaración y manda ese valor."),
         "Los gastos, aportes y retiros que no vienen de Binance son los que registraste en la app con su soporte.")
    return notes


def dian_context(uid, year):
    """Todo lo que lleva el libro de Excel para la DIAN."""
    p, extra, res, s, ms = run_report(uid, year, with_moves=True)
    start, end = tax.year_bounds(year)
    now = time.time()
    at = min(end - 1, now)
    entries = user_journal(uid)
    bk = tax.books(res, ms, year)
    kx = tax.kardex(ms, year, p["method"])
    year_moves = sorted((m for m in ms if start <= m["t"] < end), key=lambda m: (m["t"], m.get("id") or 0))
    ops = [{**m, "n": f"OP-{year}-{i:04d}", "ref": tax.ref_label(m.get("ext_id")), "pay_label": tax.pay_label(m.get("pay_method") or "")}
           for i, m in enumerate(year_moves, 1)]
    fee_qty = {}
    for m in year_moves:
        if (m.get("fee_qty") or 0) > 0 and m.get("fee_asset"):
            fee_qty[m["fee_asset"]] = fee_qty.get(m["fee_asset"], 0.0) + m["fee_qty"]
    tb = ledger.trial_balance(entries, start, end)
    bs = ledger.balance_sheet(entries, at)
    inc = ledger.income_statement(entries, start, end)

    checks = []
    if kx:
        bad = [b["asset"] for b in kx if abs(b["opening"]["cost"] + b["totals"]["in_cost"] - b["totals"]["out_cost"] - b["closing"]["cost"]) >= 1]
        checks.append(("Kardex de cada cripto", not bad,
                       f"{', '.join(b['asset'] for b in kx)}: saldo inicial + entradas − salidas = saldo final." if not bad
                       else f"No cuadra: {', '.join(bad)}."))
        kg, dg = sum(b["totals"]["gain"] for b in kx), sum(d["gain"] for d in res["disposals"])
        checks.append(("Kardex contra hoja Ganancias", abs(kg - dg) < 1,
                       f"La utilidad del kardex ({workbook.fmt_money(kg)}) es la misma de la hoja Ganancias ({workbook.fmt_money(dg)})."))
    checks.append(("Libro diario: débitos = créditos", tb["totals"]["balanced"],
                   f"Débitos {workbook.fmt_money(tb['totals']['debit'])} · créditos {workbook.fmt_money(tb['totals']['credit'])}."))
    checks.append(("Balance general", bs["balanced"],
                   f"Activo {workbook.fmt_money(bs['total_assets'])} = pasivo + patrimonio {workbook.fmt_money(bs['total_liabilities'] + bs['total_equity'])}."))
    cash = sum(x["value"] for x in bs["assets"] if x["account"] == "1110")
    checks.append(("Caja inicial registrada", cash >= -1,
                   "Los pesos según los libros no quedan negativos." if cash >= -1 else
                   f"Bancos queda en {workbook.fmt_money(cash)}: falta registrar con cuánta plata empezaste (aporte o cierre de caja). "
                   "No cambia la declaración de las cripto."))
    unvalued = sum(1 for m in year_moves if m["kind"] in ("permuta", "ingreso", "airdrop") and (m["cop_value"] or 0) <= 0)
    checks.append(("Valor en pesos de cada operación", unvalued == 0,
                   "Todas las operaciones tienen su valor en pesos." if not unvalued else f"{unvalued} operaciones sin valor en pesos: complétalas en Movimientos."))
    checks.append(("Ventas con compra registrada", not res["warnings"],
                   "Ninguna venta quedó sin su compra: todos los costos están." if not res["warnings"]
                   else f"{len(res['warnings'])} ventas sin compra registrada: su costo quedó en $0. Sube el historial que falta."))
    if year == datetime.now(tax.CO_TZ).year:
        cq = cuadre(uid, p)
        if cq:
            when = datetime.fromtimestamp(cq["t"], tax.CO_TZ).strftime("%d/%m/%Y %H:%M") if cq.get("t") else "la última sincronización"
            checks.append(("Saldos contra Binance", cq["ok"],
                           f"Lo que la app calcula que tienes en cada cripto coincide con Binance ({when})." if cq["ok"]
                           else "Hay diferencias con Binance: " + ", ".join(f"{r['asset']} {r['diff']:+.8g}" for r in cq["rows"] if not r["ok"]) + "."))

    bank = banks.summary(uid, year) if banks.accounts(uid) else None
    pays = {}
    for m in year_moves:
        if m["kind"] in ("compra", "gasto", "retiro"):
            key = tax.pay_label(m.get("pay_method") or "") or "Sin medio de pago"
            r = pays.setdefault(key, {"method": key, "out": 0.0, "gmf": 0.0, "ops": 0})
            r["out"] += (m["cop_value"] or 0) + ((m["fee_cop"] or 0) if m["kind"] == "compra" else 0)
            r["gmf"] += m["gmf_cop"] or 0
            r["ops"] += 1
    by_method = sorted(pays.values(), key=lambda r: -r["out"])
    return {
        "year": year, "generated": datetime.now(tax.CO_TZ), "in_progress": now < end, "at": datetime.fromtimestamp(at, tax.CO_TZ),
        "name": p["name"], "nit": p["nit"], "username": g.user["username"], "habitual": p["habitual"],
        "method_text": "PEPS (primero en entrar, primero en salir)" if p["method"] == "fifo" else "Promedio ponderado",
        "method_short": "PEPS" if p["method"] == "fifo" else "promedio ponderado",
        "gmf_text": gmf_text(p), "summary": s, "pnl": bk["pnl"], "months": bk["months"], "rounds": bk["rounds"],
        "kardex": kx, "ops": ops, "fee_qty": fee_qty, "disposals": res["disposals"], "incomes": res["incomes"],
        "holdings": holdings_list(res["holdings"]), "journal": named([e for e in entries if start <= e["t"] < end]),
        "trial": tb, "balance": bs, "income": inc, "account_name": lambda code: ledger.ACCOUNTS[code][0],
        "cash_book": cash_book(uid, start, end, entries),
        "inventory": (inv := inventory_book(uid, start, end, entries)),
        "equity": ledger.equity_changes(entries, start, end), "cashflow": ledger.cash_flow(entries, start, end, p["habitual"]),
        "notes": fs_notes(uid, year, entries, inv),
        "closings": db.closings(uid), "banks": bank, "by_method": by_method, "checks": checks,
    }


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@app.get("/api/export/contabilidad.xlsx")
@with_session
def export_workbook():
    """El libro de Excel para cuadrar con la DIAN: resumen explicado, formulario 210, libros y comprobaciones."""
    year = year_arg()
    data = workbook.build(dian_context(g.user["id"], year))
    return send_file(io.BytesIO(data), mimetype=XLSX, as_attachment=True, download_name=f"contabilidad-cripto-{year}.xlsx")


@app.get("/api/export/paquete-contador.zip")
@with_session
def export_package():
    """Todo lo que necesita el contador en un solo archivo."""
    import zipfile
    uid = g.user["id"]
    year = year_arg()
    start, end = tax.year_bounds(year)
    p, extra, res, s, ms = run_report(uid, year, with_moves=True)
    entries = user_journal(uid)
    at = min(end - 1, time.time())
    # mismo orden que la pestaña Libros: libros oficiales, estados financieros, notas, auxiliares, soportes fiscales y cierres
    ctx = dian_context(uid, year)
    files = {}
    files[f"01-libro-diario-{year}.csv"] = to_csv(
        ["Comprobante", "Fecha", "Detalle", "Cuenta", "Nombre", "Débito", "Crédito"],
        [[e["number"], fmt_t(e["t"]), e["text"], ln["account"], ledger.ACCOUNTS[ln["account"]][0], ln["debit"], ln["credit"]]
         for e in entries if start <= e["t"] < end for ln in e["lines"]])
    tb = ledger.trial_balance(entries, start, end)
    files[f"02-mayor-y-balances-{year}.csv"] = to_csv(
        ["Cuenta", "Nombre", "Saldo anterior", "Débitos", "Créditos", "Saldo final"],
        [[r["account"], r["name"], r["previous"], r["debit"], r["credit"], r["final"]] for r in tb["rows"]]
        + [["", "Totales", "", tb["totals"]["debit"], tb["totals"]["credit"], ""]])
    files[f"03-inventarios-y-balances-{year}.csv"] = to_csv(*inventory_csv(ctx["inventory"]))
    bs = ledger.balance_sheet(entries, at)
    files[f"04-estado-de-situacion-financiera-{year}.csv"] = to_csv(*balance_csv(bs))
    inc = ledger.income_statement(entries, start, end)
    files[f"05-estado-de-resultados-{year}.csv"] = to_csv(*income_csv(inc))
    files[f"06-cambios-en-el-patrimonio-{year}.csv"] = to_csv(*equity_csv(ctx["equity"]))
    files[f"07-flujo-de-efectivo-{year}.csv"] = to_csv(*cashflow_csv(ctx["cashflow"]))
    files[f"08-notas-a-los-estados-financieros-{year}.txt"] = notes_text(ctx["notes"], year)
    files[f"09-libro-caja-diaria-{year}.csv"] = to_csv(*cash_book_csv(ctx["cash_book"]))
    files[f"10-libro-criptoactivos-kardex-{year}.csv"] = to_csv(*kardex_csv(uid, year))
    files[f"11-registro-de-operaciones-{year}.csv"] = to_csv(*movements_csv(uid, start, end))
    files[f"12-ganancias-por-operacion-{year}.csv"] = to_csv(
        ["Fecha", "Tipo", "Cripto", "Cantidad", "Valor de enajenación COP", "Comisión COP", "Costo fiscal COP", "Utilidad COP"],
        [[fmt_t(x["t"]), x["kind"], x["asset"], x["qty"], x["gross"], x["fee"], x["cost"], x["gain"]] for x in res["disposals"]])
    files[f"13-inventario-fiscal-cripto-31dic{year}.csv"] = to_csv(
        ["Cripto", "Cantidad", "Costo fiscal COP", "Lote más antiguo"],
        [[h["asset"], h["qty"], h["cost"], fmt_t(h["since"])] for h in holdings_list(res["holdings"])])
    rounds = tax.books(res, ms, year)["rounds"]
    files[f"14-rondas-de-arbitraje-{year}.csv"] = to_csv(
        ["Inicio", "Fin", "Operaciones", "Pagaste COP", "Recibiste COP", "4x1000 COP", "Comisión Binance COP (incluida)", "Resultado COP", "Abierta"],
        [[fmt_t(r["start"]), fmt_t(r["end"]), r["ops"], r["paid"], r["received"], r["gmf"], r.get("binance_fees", 0.0), r["result"], r["open"]]
         for r in rounds])
    files["15-cierres.csv"] = to_csv(
        ["Fecha", "Tipo", "Caja según libros", "Caja real", "Diferencia (aporte/retiro)", "Congelado", "Automático", "Nota"],
        [[fmt_t(c["t"]), c["kind"], c["cash_expected"], c["cash_real"], c["adjustment"], bool(c["locked"]), bool(c["auto"]), c["note"]]
         for c in db.closings(uid)])
    c = s["f210"]["casillas"]
    lines = [
        f"Resumen de criptoactivos - año gravable {year}",
        f"Contribuyente: {p['name'] or g.user['username']}  ·  Cédula/NIT: {p['nit'] or '-'}",
        f"Método de costo: {'PEPS' if p['method'] == 'fifo' else 'Promedio ponderado'}  ·  Operación habitual: {'sí' if p['habitual'] else 'no'}",
        f"4x1000: {gmf_text(p)}",
        f"Comisiones de Binance en compras (incluidas en el costo): $ {tax.books(res, ms, year)['pnl']['buy_fees']:,.0f}".replace(",", "."),
        "",
        "Formulario 210 (solo la parte de criptoactivos):",
        *[f"  Casilla {k}: $ {v:,.0f}".replace(",", ".") for k, v in c.items() if abs(v) > 0.5],
        f"  Impuesto estimado por las cripto: $ {s['tax_total']:,.0f}".replace(",", "."),
        "",
        f"Resultado contable del año: $ {inc['net']:,.0f}".replace(",", "."),
        f"Balance general cuadrado: {'sí' if bs['balanced'] else 'NO'}  ·  Débitos = créditos: {'sí' if tb['totals']['balanced'] else 'NO'}",
        "",
        f"El archivo 00-contabilidad-cripto-{year}.xlsx tiene todo explicado: resumen, casillas del formulario 210, kardex,",
        "operaciones, 4x1000, libros contables y comprobaciones. Los CSV son los mismos datos para importar en otro programa,",
        "en el orden de los libros: 01-03 libros oficiales (diario, mayor y balances, inventarios y balances), 04-07 estados",
        "financieros (situación financiera, resultados, cambios en el patrimonio, flujo de efectivo), 08 notas, 09-11 auxiliares",
        "(caja diaria, kardex, registro de operaciones), 12-14 soportes de la declaración y 15 cierres.",
        "",
        "Base: Estatuto Tributario y Concepto Unificado DIAN 1621 de 2023. Cálculo informativo: revísalo con tu contador.",
        f"Generado: {fmt_t(time.time())}",
    ]
    files["00-LEEME-resumen.txt"] = "\r\n".join(lines)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"00-contabilidad-cripto-{year}.xlsx", workbook.build(ctx))
        for name, content in sorted(files.items()):
            z.writestr(name, content.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=f"contabilidad-cripto-{year}.zip")

# ------------------------------------------------------------ página web (Next.js exportado)

@app.get("/")
@app.get("/<path:path>")
def web(path=""):
    if path.startswith("api/"):
        abort(404)
    target = safe_join(WEB, path) if path else os.path.join(WEB, "index.html")
    if target and os.path.isdir(target):
        target = os.path.join(target, "index.html")
    if target and not os.path.isfile(target) and os.path.isfile(target + ".html"):
        target += ".html"
    if not target or not os.path.isfile(target):
        if path.startswith("_next/") or "." in os.path.basename(path):
            abort(404)
        target = os.path.join(WEB, "index.html")
        if not os.path.isfile(target):
            return Response("Falta compilar la web: cd web && npm run build", status=503, mimetype="text/plain")
    return send_file(target, max_age=31536000 if path.startswith("_next/static/") else 0)


# ------------------------------------------------------------ arranque

def port_free(wait):
    """Espera hasta `wait` segundos a que el puerto se libere (PM2 reinicia antes de que el anterior suelte el puerto)."""
    for _ in range(wait):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                if os.name != "nt":  # Linux: igual que uvicorn, ignora conexiones viejas en TIME_WAIT
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((HOST, PORT))
                return True
            except OSError:
                time.sleep(1)
    return False


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if db.mysql:
        db.import_sqlite(os.path.join(DATA_DIR, "wallet.db"))  # primera vez con MySQL: trae lo de SQLite
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n  ARBICRYPTO WALLET - lista en {url}  (datos en {'MySQL' if db.mysql else 'SQLite'})")
    if not sso.secret(_env, PANEL_ENV):
        print("\n  AVISO: falta SSO_SECRET. Prende el panel una vez (lo crea en backend/.env) para poder entrar desde su menú.")
    print("\n  Para apagarla: pm2 stop arbicrypto-wallet (o Ctrl+C si la abriste a mano).\n")
    if not port_free(30):
        print(f"  El puerto {PORT} está ocupado: la wallet probablemente ya está abierta en {url}")
        sys.exit(3)
    threading.Thread(target=scheduler, daemon=True, name="sincronizacion").start()
    import uvicorn
    # proxy_headers: detrás de nginx se ve la IP real del visitante (solo se confía en el nginx local)
    uvicorn.run(asgi(app), host=HOST, port=PORT, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                log_level="warning", access_log=False, timeout_graceful_shutdown=3)


if __name__ == "__main__":
    main()
