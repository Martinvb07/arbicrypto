"""Capa HTTP de ArbiCrypto sobre FastAPI/Starlette (servidor de produccion: uvicorn).

Da a las rutas la misma forma sencilla de siempre (request, g, jsonify, abort...) para que la logica del
panel no cambie, pero todo corre en FastAPI. Las rutas son funciones normales: FastAPI las ejecuta en
hilos, asi que pueden consultar a Binance sin frenar a los demas.
"""
import contextvars
import functools
import json
import os

from fastapi import FastAPI, HTTPException
from starlette.datastructures import MutableHeaders
from starlette.requests import Request as _Request
from starlette.responses import (FileResponse, HTMLResponse, JSONResponse, RedirectResponse,
                                 Response as _Response, StreamingResponse)

MAX_BODY = 64 * 1024  # ningun formulario legitimo pesa mas

_ctx = contextvars.ContextVar("arbicrypto_request")


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


class Json(JSONResponse):
    """JSONResponse que acepta set_cookie(samesite="Strict") como antes."""

    def set_cookie(self, key, value="", max_age=None, httponly=False, samesite="lax", secure=False, **kw):
        super().set_cookie(key, value, max_age=max_age, httponly=httponly, samesite=(samesite or "lax").lower(),
                           secure=secure, path=kw.get("path", "/"))


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


def send_from_directory(base, name):
    full = safe_join(base, name)
    if not full or not os.path.isfile(full):
        abort(404)
    return FileResponse(full)


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


class _Hooks:
    def __init__(self):
        self.before, self.after = [], []


class App(FastAPI):
    """FastAPI con before_request/after_request y rutas estilo '/<path:path>'."""

    def __init__(self):
        super().__init__(docs_url=None, redoc_url=None, openapi_url=None)
        self.hooks = _Hooks()

    def before_request(self, fn):
        self.hooks.before.append(fn)
        return fn

    def after_request(self, fn):
        self.hooks.after.append(fn)
        return fn

    def _route(self, path, methods):
        path = path.replace("<path:path>", "{path:path}")

        def deco(fn):
            @functools.wraps(fn)
            def endpoint(*a, **kw):
                return _to_response(fn(*a, **kw))
            self.add_api_route(path, endpoint, methods=methods, include_in_schema=False, response_model=None)
            return fn
        return deco

    def get(self, path, **_):
        return self._route(path, ["GET"])

    def post(self, path, **_):
        return self._route(path, ["POST"])


class Middleware:
    """Lee el cuerpo, prepara request/g, corre los before_request y agrega cabeceras con los after_request."""

    def __init__(self, asgi, app):
        self.asgi, self.app = asgi, app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.asgi(scope, receive, send)
        req = _Request(scope, receive)
        body = b""
        if scope["method"] in ("POST", "PUT", "PATCH"):
            body = await req.body()
            if len(body) > MAX_BODY:
                return await JSONResponse({"error": "Demasiado grande."}, status_code=413)(scope, receive, send)
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
                early = JSONResponse({"error": e.detail}, status_code=e.status_code)

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
