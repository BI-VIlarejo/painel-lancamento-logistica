"""Logging básico e contexto de request para a API."""

from __future__ import annotations
import logging
from time import perf_counter
from uuid import uuid4
from starlette.types import ASGIApp, Message, Receive, Scope, Send

def configure_logging() -> None:
    """Configura logs concisos sem registrar payloads da aplicação."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

class RequestLoggingMiddleware:
    """Gera um request ID e registra metadados seguros de cada chamada HTTP."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started_at = perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            route = scope.get("route")
            route_path = getattr(route, "path", "unmatched")
            duration_ms = (perf_counter() - started_at) * 1000
            logging.getLogger("lancamento.api.request").info(
                "http_request request_id=%s method=%s route=%s status_code=%d duration_ms=%.2f",
                request_id,
                scope["method"],
                route_path,
                status_code,
                duration_ms,
            )
