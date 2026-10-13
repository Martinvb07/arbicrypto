"""Capa HTTP de ArbiCrypto Wallet sobre FastAPI/Starlette (servidor de produccion: uvicorn), igual que el panel.

Da a las rutas la misma forma sencilla de siempre (request, g, jsonify, abort, send_file...) para que la logica
no cambie, pero todo corre en FastAPI. Las rutas son funciones normales: FastAPI las ejecuta en hilos, asi que
pueden consultar a Binance o armar el Excel sin frenar a los demas.
"""
import contextvars
import decimal
import functools
import json
import logging
import os
import re

from fastapi import FastAPI, HTTPException
from starlette.datastructures import MutableHeaders
from starlette.requests import Request as _Request
from starlette.responses import (FileResponse, HTMLResponse, JSONResponse, RedirectResponse,
                                 Response as _Response, StreamingResponse)

MAX_BODY = 16 * 1024 * 1024  # los extractos en PDF/Excel llegan en base64 (maximo 12 MB de archivo)
TOO_BIG = "El archivo es demasiado grande (máximo 12 MB)."
HTTP_TEXT = {400: "Petición inválida.", 403: "No permitido.", 404: "No existe.", 405: "Método no permitido.",
             413: TOO_BIG, 415: "Se esperaba JSON."}

log = logging.getLogger("wallet")
_ctx = contextvars.ContextVar("wallet_request")


class _Ctx:
    def __init__(self, req, body):
        self.req, self.body, self.vars = req, body, {}


class _G:
    """Datos de la peticion actual (por ejemplo g.user)."""

    def __getattr__(self, name):
        try:
            return _ctx.get().vars.get(name)
        except LookupError:
            return None

    def __setattr__(self, name, value):
        _ctx.get().vars[name] = value


class _Args(dict):
    """Parametros de la URL; get(..., type=int) devuelve el valor por defecto si no se puede convertir."""

    def get(self, key, default=None, type=None):
        if key not in self:
            return default
        try:
            return type(self[key]) if type else self[key]
        except (TypeError, ValueError):
            return default


class _RequestProxy:
    """La peticion actual, con los nombres de siempre."""

    @property
    def _r(self):
        return _ctx.get().req

    @property
    def remote_addr(self):
        return self._r.client.host if self._r.client else None

    @property
    def host(self):
        return self._r.headers.get("host", "")

    @property
    def headers(self):
        return self._r.headers

    @property
    def path(self):
        return self._r.url.path

    @property
    def method(self):
        return self._r.method

    @property
    def is_json(self):
        return self._r.headers.get("content-type", "").split(";")[0].strip() == "application/json"

    @property
    def cookies(self):
        return self._r.cookies

    @property
    def args(self):
        return _Args(self._r.query_params)

    @property
    def scheme(self):
        return self._r.url.scheme

    def get_json(self, silent=True):
        try:
            return json.loads(_ctx.get().body or b"null")
        except ValueError:
            if silent:
                return None
            raise


g = _G()
request = _RequestProxy()


def _plain(o):
    if isinstance(o, decimal.Decimal):  # MySQL devuelve SUM() de enteros como Decimal
        return float(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return bytes(o).decode("utf-8", "replace")
    if hasattr(o, "isoformat"):
        return o.isoformat()
    raise TypeError(f"{type(o).__name__} no se puede pasar a JSON")


class Json(JSONResponse):
    """JSONResponse que acepta set_cookie(samesite="Strict") como antes."""

    def render(self, content):
        return json.dumps(content, ensure_ascii=False, separators=(",", ":"), default=_plain).encode("utf-8")

    def set_cookie(self, key, value="", max_age=None, httponly=False, samesite="lax", secure=False, **kw):
        super().set_cookie(key, value, max_age=max_age, httponly=httponly, samesite=(samesite or "lax").lower(),
                           secure=secure, path=kw.get("path", "/"))

    def delete_cookie(self, key, path="/", samesite="lax", secure=False, httponly=False, **_):
        super().delete_cookie(key, path=path, secure=secure, httponly=httponly, samesite=(samesite or "lax").lower())


def jsonify(*args, **kwargs):
    return Json(args[0] if args else kwargs)


def abort(code):
    raise HTTPException(status_code=code)


def redirect(url, code=302):
    return RedirectResponse(url, status_code=code)


def Response(body=b"", mimetype=None, headers=None, status=200):
    if isinstance(body, (str, bytes)):
        return _Response(body, status_code=status, media_type=mimetype, headers=headers)
    return StreamingResponse(body, status_code=status, media_type=mimetype, headers=headers)


def safe_join(base, name):
    full = os.path.realpath(os.path.join(base, name))
    root = os.path.realpath(base)
    return full if full == root or full.startswith(root + os.sep) else None


def send_file(source, mimetype=None, as_attachment=False, download_name=None, max_age=None):
    """Un archivo del disco (ruta) o en memoria (BytesIO), como descarga o para mostrar."""
    headers = {}
    if max_age is not None:
        headers["Cache-Control"] = f"public, max-age={max_age}, immutable" if max_age else "no-cache"
    if as_attachment and download_name:
        headers["Content-Disposition"] = f'attachment; filename="{download_name}"'
    if isinstance(source, (str, os.PathLike)):
        return FileResponse(source, media_type=mimetype, headers=headers)
    return _Response(source.getvalue(), media_type=mimetype or "application/octet-stream", headers=headers)


def _to_response(rv):
    status = None
    if isinstance(rv, tuple):
        rv, status = rv
    if isinstance(rv, _Response):
        resp = rv
    elif isinstance(rv, str):
        resp = HTMLResponse(rv)
    else:
        resp = Json(rv)
    if status is not None:
        resp.status_code = status
    return resp


def http_error(e):
    """abort(...) dentro de /api responde JSON {"error": ...} (la interfaz lo muestra tal cual)."""
    msg = HTTP_TEXT.get(e.status_code, str(e.detail))
    if request.path.startswith("/api/"):
        return Json({"error": msg}, status_code=e.status_code)
    return _Response(msg, status_code=e.status_code, media_type="text/plain; charset=utf-8")


class _Hooks:
    def __init__(self):
        self.before, self.after = [], []


class App(FastAPI):
    """FastAPI con before_request/after_request, errorhandler y rutas estilo '/<int:id>' o '/<path:path>'."""

    def __init__(self):
        super().__init__(docs_url=None, redoc_url=None, openapi_url=None)
        self.hooks = _Hooks()
        self.handlers = {}

    def before_request(self, fn):
        self.hooks.before.append(fn)
        return fn

    def after_request(self, fn):
        self.hooks.after.append(fn)
        return fn

    def errorhandler(self, exc):
        def deco(fn):
            self.handlers[exc] = fn
            return fn
        return deco

    def _handle(self, e):
        if isinstance(e, HTTPException):  # abort(404) etc.: nunca cae en el manejador general de Exception
            return http_error(e)
        for cls in type(e).__mro__:
            if cls in self.handlers:
                return _to_response(self.handlers[cls](e))
        raise e

    def _route(self, path, methods):
        # '/<int:mid>' -> '/{mid:int}', '/<path:path>' -> '/{path:path}', '/<kind>' -> '/{kind}'
        path = re.sub(r"<(?:(\w+):)?(\w+)>", lambda m: "{" + m.group(2) + (":" + m.group(1) if m.group(1) else "") + "}", path)

        def deco(fn):
            @functools.wraps(fn)
            def endpoint(*a, **kw):
                try:
                    return _to_response(fn(*a, **kw))
                except Exception as e:  # Bad, Locked, abort(...) y errores inesperados, como en Flask
                    return self._handle(e)
            self.add_api_route(path, endpoint, methods=methods, include_in_schema=False, response_model=None)
            return fn
        return deco

    def get(self, path, **_):
        return self._route(path, ["GET"])

    def post(self, path, **_):
        return self._route(path, ["POST"])


class Middleware:
    """Lee el cuerpo, prepara request/g, corre los before_request y agrega cabeceras con los after_request."""

    def __init__(self, asgi, app, max_body=MAX_BODY):
        self.asgi, self.app, self.max_body = asgi, app, max_body

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.asgi(scope, receive, send)
        req = _Request(scope, receive)
        body = b""
        if scope["method"] in ("POST", "PUT", "PATCH"):
            size = req.headers.get("content-length", "")
            if size.isdigit() and int(size) > self.max_body:
                return await JSONResponse({"error": TOO_BIG}, status_code=413)(scope, receive, send)
            body = await req.body()
            if len(body) > self.max_body:
                return await JSONResponse({"error": TOO_BIG}, status_code=413)(scope, receive, send)
        sent = False

        async def replay():  # el cuerpo ya se leyo: se entrega una vez y luego se espera la desconexion
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        ctx = _Ctx(_Request(scope, replay), body)
        token = _ctx.set(ctx)
        try:
            early = None
            try:
                for fn in self.app.hooks.before:
                    rv = fn()
                    if rv is not None:
                        early = _to_response(rv)
                        break
            except HTTPException as e:
                early = http_error(e)

            async def send_with_headers(message):
                if message["type"] == "http.response.start":
                    holder = type("R", (), {})()
                    holder.headers = MutableHeaders(raw=message["headers"])
                    for fn in self.app.hooks.after:
                        fn(holder)
                await send(message)

            if early is not None:
                return await early(scope, replay, send_with_headers)
            return await self.asgi(scope, replay, send_with_headers)
        finally:
            _ctx.reset(token)


def asgi(app):
    """La aplicacion lista para uvicorn."""
    return Middleware(app, app)
