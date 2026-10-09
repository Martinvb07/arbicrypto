"""Avisos al celular por Telegram (opcional).

El administrador crea un bot con @BotFather, pega el token en Ajustes y le escribe /start
(a solas o en el grupo del equipo). El token y el chat se guardan en backend/.env.
"""
import re
import threading

import requests

API = "https://api.telegram.org/bot{token}/{method}"
TOKEN_RE = re.compile(r"^\d{5,15}:[A-Za-z0-9_-]{30,60}$")


class TelegramError(Exception):
    pass


class Telegram:
    def __init__(self, token="", chat_id="", chat_name="", bot=""):
        self.token, self.chat_id, self.chat_name, self.bot = token, chat_id, chat_name, bot

    @property
    def ready(self):
        return bool(self.token and self.chat_id)

    def info(self):
        return {"bot": self.bot or None, "chat": self.chat_name or None, "ready": self.ready}

    def _call(self, method, token=None, **params):
        token = token or self.token
        try:
            r = requests.post(API.format(token=token, method=method), json=params, timeout=15)
            data = r.json()
        except (requests.RequestException, ValueError) as e:
            # El error de requests trae la URL completa: nunca mostrar el token
            raise TelegramError(f"No se pudo hablar con Telegram: {str(e).replace(token, '***')}")
        if not data.get("ok"):
            raise TelegramError(data.get("description") or f"Telegram respondió HTTP {r.status_code}")
        return data["result"]

    def connect(self, token):
        if not TOKEN_RE.match(token.strip()):
            raise TelegramError("el token debe verse así: 123456789:ABCdef... (cópialo completo de @BotFather)")
        me = self._call("getMe", token=token.strip())
        self.token, self.bot, self.chat_id, self.chat_name = token.strip(), me["username"], "", ""
        return self.bot

    def detect_chat(self):
        """Busca el último chat que le escribió al bot (privado o grupo)."""
        for update in reversed(self._call("getUpdates", timeout=0)):
            for key in ("message", "channel_post", "my_chat_member", "edited_message"):
                chat = (update.get(key) or {}).get("chat")
                if chat:
                    self.chat_id = str(chat["id"])
                    self.chat_name = chat.get("title") or " ".join(
                        x for x in (chat.get("first_name"), chat.get("last_name")) if x) or "chat"
                    return self.chat_name
        raise TelegramError("Todavía no veo mensajes. Escríbele /start a tu bot (o en el grupo donde lo agregaste) y vuelve a intentar.")

    def send(self, text):
        self._call("sendMessage", chat_id=self.chat_id, text=text, parse_mode="HTML", disable_web_page_preview=True)

    def send_async(self, text):
        if not self.ready:
            return

        def run():
            try:
                self.send(text)
            except TelegramError as e:
                print(f"  Aviso de Telegram no enviado: {e}")

        threading.Thread(target=run, daemon=True).start()
