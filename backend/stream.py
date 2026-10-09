"""Precios de Binance Spot en tiempo real por WebSocket (mejor compra y venta de cada par).

Se suscribe solo a los pares entre las criptos principales; si la conexion se cae,
reintenta sola y mientras tanto el panel usa los precios por consulta normal.
"""
import json
import threading
import time

import websocket

URL = "wss://data-stream.binance.vision/stream"  # solo datos de mercado, sin bloqueo por pais
CHUNK = 100  # Binance permite suscribir muchos pares por mensaje; se envian en grupos


class LiveBook:
    def __init__(self):
        self.book = {}  # simbolo -> (bid, bid_qty, ask, ask_qty)
        self.last = 0.0
        self.symbols = []
        self._ws = None
        self._lock = threading.Lock()
        self._thread = None

    def fresh(self, max_age=10):
        return bool(self.book) and time.time() - self.last < max_age

    def snapshot(self):
        with self._lock:
            return dict(self.book)

    def start(self, symbols):
        symbols = sorted(set(symbols))
        if symbols == self.symbols and self._thread and self._thread.is_alive():
            return
        self.symbols = symbols
        if self._ws:
            self._ws.close()  # el hilo vuelve a conectar con la lista nueva
        if not self._thread or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _on_open(self, ws):
        streams = [f"{s.lower()}@bookTicker" for s in self.symbols]
        for i in range(0, len(streams), CHUNK):
            ws.send(json.dumps({"method": "SUBSCRIBE", "params": streams[i:i + CHUNK], "id": i // CHUNK + 1}))
            time.sleep(0.3)  # Binance limita los mensajes por segundo

    def _on_message(self, _ws, raw):
        msg = json.loads(raw)
        d = msg.get("data")
        if not d or "s" not in d:
            return
        bid, ask = float(d["b"]), float(d["a"])
        if bid > 0 and ask > 0:
            with self._lock:
                self.book[d["s"]] = (bid, float(d["B"]), ask, float(d["A"]))
            self.last = time.time()

    def _run(self):
        delay = 2
        while True:
            started = time.time()
            self._ws = websocket.WebSocketApp(URL, on_open=self._on_open, on_message=self._on_message)
            try:
                # ping cada 3 min: Binance cierra conexiones sin actividad
                self._ws.run_forever(ping_interval=180, ping_timeout=20)
            except Exception as e:  # nunca debe tumbar el panel
                print(f"  Precios en tiempo real: {e}")
            delay = 2 if time.time() - started > 60 else min(delay * 2, 60)
            time.sleep(delay)
