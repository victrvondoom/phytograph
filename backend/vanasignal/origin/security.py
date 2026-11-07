"""Security controls for the Origin Gate.

* Security headers on every response (no framing, no sniffing, strict CSP, no referrer leakage).
* Request body size limit (protects the synchronous audit endpoints from oversized payloads).
* Optional bearer-token guard for state-changing endpoints (VANASIGNAL_API_TOKEN). The token stays
  server-side; the browser never receives it.
* CSV formula-injection neutralisation for every spreadsheet export.
"""

from __future__ import annotations

import hmac
import os

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 1_000_000
STATE_CHANGING = {"POST", "PUT", "PATCH", "DELETE"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'"
    ),
}


def api_token() -> str | None:
    return os.environ.get("VANASIGNAL_API_TOKEN") or None


def token_ok(header: str | None, expected: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].encode(), expected.encode())


def safe_csv_cell(value: object) -> str:
    """Prevent spreadsheet formula injection: values starting with = + - @ tab or CR are neutralised."""
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


class SecurityMiddleware:
    """Pure ASGI middleware: headers, body limit and bearer guard for writes."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        method = scope["method"]

        if int(headers.get("content-length", "0") or 0) > MAX_BODY_BYTES:
            await self._reply(send, 413, {"detail": {"code": "payload_too_large", "message": f"Request body exceeds {MAX_BODY_BYTES} bytes."}})
            return

        expected = api_token()
        if expected and method in STATE_CHANGING and not token_ok(headers.get("authorization"), expected):
            await self._reply(send, 401, {"detail": {"code": "unauthorized", "message": "A valid bearer token is required for changes."}})
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {k.decode().lower() for k, _ in message.get("headers", [])}
                extra = [(k.encode(), v.encode()) for k, v in SECURITY_HEADERS.items() if k.lower() not in existing]
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        await self.app(scope, receive, send_with_headers)

    @staticmethod
    async def _reply(send: Send, status: int, payload: dict) -> None:
        response = JSONResponse(payload, status_code=status, headers=SECURITY_HEADERS)
        await response({"type": "http", "method": "GET", "headers": [], "path": "/"}, _no_receive, send)


async def _no_receive():  # pragma: no cover - only used to satisfy the ASGI signature
    return {"type": "http.disconnect"}
