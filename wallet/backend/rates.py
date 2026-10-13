"""Tasas para pasar todo a pesos: TRM oficial (datos.gov.co, Superfinanciera) y precio en dólares de Binance.

Las dos se guardan en la base de datos: una fecha pasada nunca se vuelve a pedir.
"""
import threading
import time
from datetime import date, datetime, timedelta

import requests

from tax import CO_TZ

TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json"
KLINES_URL = "https://api.binance.com/api/v3/klines"
STABLE = {"USDT", "USDC", "FDUSD", "BUSD", "DAI", "TUSD", "USDP", "USD"}
HEADERS = {"User-Agent": "ArbiCrypto-Wallet/1.0"}


class RateError(Exception):
    pass


def co_day(t):
    return datetime.fromtimestamp(t, CO_TZ).date()


class Rates:
    def __init__(self, db):
        self.db = db
        self.lock = threading.Lock()  # evita pedir lo mismo en paralelo
        self.missing = {}  # par -> hora en que se supo que no existe
        self.mem = {}  # valores de hoy que aún cambian: TRM (1 hora) y precio actual (1 minuto)

    def _memo(self, key, ttl, fn):
        hit = self.mem.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        value = fn()
        self.mem[key] = (time.time(), value)
        return value

    # ------------------------------------------------------------ TRM

    def trm(self, day):
        """TRM vigente el día `day` (date). La de hoy se guarda una hora en memoria."""
        if day >= date.today():
            return self._memo(("trm", day.isoformat()), 3600, lambda: self._trm(day))
        return self._trm(day)

    def _trm(self, day):
        key = day.isoformat()
        hit = self.db.one("SELECT value FROM trm WHERE day=?", (key,))
        if hit:
            return hit["value"]
        with self.lock:
            hit = self.db.one("SELECT value FROM trm WHERE day=?", (key,))
            if hit:
                return hit["value"]
            return self._fetch_trm(day)

    def _fetch_trm(self, day):
        # Trae un bloque de ~1 año alrededor de la fecha y lo guarda día por día.
        lo, hi = day - timedelta(days=10), day + timedelta(days=370)
        params = {"$where": f"vigenciadesde<='{hi}T00:00:00' AND vigenciahasta>='{lo}T00:00:00'",
                  "$order": "vigenciadesde ASC", "$limit": 1000}
        try:
            r = requests.get(TRM_URL, params=params, headers=HEADERS, timeout=20)
            r.raise_for_status()
            data = r.json()
        except (requests.RequestException, ValueError) as e:
            raise RateError(f"No se pudo consultar la TRM ({type(e).__name__}).") from e
        today = date.today()
        rows, found = [], None
        for rec in data:
            try:
                v = float(rec["valor"])
                d0 = date.fromisoformat(rec["vigenciadesde"][:10])
                d1 = date.fromisoformat(rec["vigenciahasta"][:10])
            except (KeyError, ValueError):
                continue
            d = d0
            while d <= d1:
                if d < today:  # la de hoy o futuras aún pueden cambiar: no se guardan
                    rows.append((d.isoformat(), v))
                if d == day:
                    found = v
                d += timedelta(days=1)
        if rows:
            self.db.many(self.db.sql.upsert("trm", ("day", "value"), ("day",), ("value",)), rows)
        if found is None:
            if day >= today:  # fecha futura o sin publicar: la última conocida
                return self.latest_trm()
            raise RateError(f"No hay TRM publicada para {day}.")
        return found

    def latest_trm(self):
        try:
            r = requests.get(TRM_URL, params={"$order": "vigenciadesde DESC", "$limit": 1}, headers=HEADERS, timeout=20)
            r.raise_for_status()
            return float(r.json()[0]["valor"])
        except (requests.RequestException, ValueError, KeyError, IndexError) as e:
            raise RateError("No se pudo consultar la TRM.") from e

    # ------------------------------------------------------------ precio en dólares

    def usd(self, asset, t):
        """Precio en dólares de 1 `asset` en el momento `t` (vela de 1 hora de Binance). El de la hora en curso dura 1 minuto."""
        hour = int(t // 3600) * 3600
        if hour + 3600 > time.time() and asset.upper() not in STABLE:
            return self._memo(("usd", asset.upper(), hour), 60, lambda: self._usd(asset, t))
        return self._usd(asset, t)

    def _usd(self, asset, t):
        asset = asset.upper()
        if asset in STABLE:
            return 1.0
        hour = int(t // 3600) * 3600
        hit = self.db.one("SELECT usd FROM prices WHERE asset=? AND hour=?", (asset, hour))
        if hit:
            return hit["usd"]
        with self.lock:
            hit = self.db.one("SELECT usd FROM prices WHERE asset=? AND hour=?", (asset, hour))
            if hit:
                return hit["usd"]
            p = self._candles(asset + "USDT", hour)
            if p is None:  # sin par contra USDT: se pasa por BTC
                via = self._candles(asset + "BTC", hour)
                btc = self._candles("BTCUSDT", hour) if via is not None else None
                p = via * btc if via is not None and btc is not None else None
            if p is None:
                raise RateError(f"Binance no tiene precio para {asset}. Escribe el valor en pesos a mano.")
            if hour + 3600 < time.time():
                self.db.run(self.db.sql.upsert("prices", ("asset", "hour", "usd"), ("asset", "hour"), ("usd",)), (asset, hour, p))
            return p

    def _candles(self, symbol, hour):
        """Pide 1000 velas de 1 hora desde `hour`, guarda las cerradas y devuelve el cierre de la primera."""
        miss = self.missing.get(symbol)
        if miss and time.time() - miss < 3600:
            return None
        try:
            r = requests.get(KLINES_URL, params={"symbol": symbol, "interval": "1h", "startTime": hour * 1000, "limit": 1000},
                             headers=HEADERS, timeout=20)
            if r.status_code == 400:  # el par no existe
                self.missing[symbol] = time.time()
                return None
            r.raise_for_status()
            data = r.json()
        except (requests.RequestException, ValueError) as e:
            raise RateError(f"No se pudo consultar Binance ({type(e).__name__}).") from e
        if not data:
            return None
        base = symbol[:-4] if symbol.endswith("USDT") else None
        now = time.time()
        if base:
            rows = [(base, int(k[0] // 1000), float(k[4])) for k in data if k[6] / 1000 < now]
            if rows:
                self.db.many(self.db.sql.upsert("prices", ("asset", "hour", "usd"), ("asset", "hour"), ("usd",)), rows)
        first = data[0]
        if int(first[0] // 1000) > hour + 3600:  # el par empezó a cotizar después
            return None
        return float(first[4])

    # ------------------------------------------------------------ en pesos

    def cop(self, asset, qty, t):
        """Valor en pesos de `qty` `asset` en `t`: dólares × TRM del día en Colombia."""
        usd = self.usd(asset, t)
        trm = self.trm(co_day(t))
        return {"cop": qty * usd * trm, "usd": usd, "trm": trm}
