"""Exceções da aplicação e respostas HTTP seguras e consistentes."""

from __future__ import annotations
import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("lancamento.api.errors")

class APIError(Exception):
    """Erro esperado da aplicação que pode ser apresentado ao cliente."""

    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message

class NotFoundError(APIError):
    """O recurso solicitado não existe ou não está visível ao usuário."""

    def __init__(self, message: str = "Recurso não encontrado.") -> None:
        super().__init__(status_code=404, code="not_found", message=message)

class AuthenticationError(APIError):
    """A chamada não tem uma identidade autenticada válida."""

    def __init__(self, message: str = "Autenticação necessária.") -> None:
        super().__init__(status_code=401, code="unauthorized", message=message)

class PermissionDeniedError(APIError):
    """A identidade não tem autorização para executar a ação."""

    def __init__(self, message: str = "Ação não autorizada.") -> None:
        super().__init__(status_code=403, code="forbidden", message=message)

class ConflictError(APIError):
    """A operação conflita com o estado ou com um registro existente."""

    def __init__(self, message: str = "A operação conflita com o estado atual.") -> None:
        super().__init__(status_code=409, code="conflict", message=message)

class ServiceUnavailableError(APIError):
    """Um serviço necessário não está disponível."""

    def __init__(self, message: str = "Serviço temporariamente indisponível.") -> None:
        super().__init__(status_code=503, code="service_unavailable", message=message)

def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return JSONResponse(
        status_code=status_code,
        content={"error": error},
        headers=headers,
    )

def _http_error_message(status_code: int) -> tuple[str, str]:
    known_errors = {
        400: ("bad_request", "Não foi possível processar a solicitação."),
        401: ("unauthorized", "Autenticação necessária."),
        403: ("forbidden", "Ação não autorizada."),
        404: ("not_found", "Recurso não encontrado."),
        405: ("method_not_allowed", "Método não permitido."),
        409: ("conflict", "A operação conflita com o estado atual."),
        429: ("too_many_requests", "Muitas solicitações. Tente novamente mais tarde."),
        503: ("service_unavailable", "Serviço temporariamente indisponível."),
    }
    if status_code in known_errors:
        return known_errors[status_code]
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        phrase = "Erro na solicitação."
    return "http_error", phrase

async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """Oculta detalhes internos do cliente e registra somente metadados seguros."""
    logger.error(
        "Erro não tratado na API: request_id=%s method=%s exception_type=%s",
        getattr(request.state, "request_id", "-"),
        request.method,
        type(exc).__name__,
    )
    return _error_response(
        status_code=500,
        code="internal_error",
        message="Ocorreu um erro interno. Tente novamente mais tarde.",
        headers={"X-Request-ID": getattr(request.state, "request_id", "-")},
    )


async def handle_api_error(request: Request, exc: Exception) -> JSONResponse:
    """Converte erros esperados em uma resposta pública padronizada."""
    if not isinstance(exc, APIError):
        return await handle_unexpected_error(request, exc)
    return _error_response(
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
    )

async def handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    """Normaliza erros HTTP sem devolver detalhes arbitrários da exceção."""
    if not isinstance(exc, StarletteHTTPException):
        return await handle_unexpected_error(request, exc)
    code, message = _http_error_message(exc.status_code)
    return _error_response(
        status_code=exc.status_code,
        code=code,
        message=message,
        headers=exc.headers,
    )

async def handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    """Retorna erros de validação sem ecoar os valores enviados."""
    if not isinstance(exc, RequestValidationError):
        return await handle_unexpected_error(request, exc)
    details = [
        {
            "location": list(error.get("loc", ())),
            "message": error.get("msg", "Valor inválido."),
            "type": error.get("type", "value_error"),
        }
        for error in exc.errors()
    ]
    return _error_response(
        status_code=422,
        code="validation_error",
        message="Os dados enviados são inválidos.",
        details=details,
    )

def register_exception_handlers(application: FastAPI) -> None:
    """Registra os handlers de domínio, HTTP, validação e erros inesperados."""
    application.add_exception_handler(APIError, handle_api_error)
    application.add_exception_handler(StarletteHTTPException, handle_http_error)
    application.add_exception_handler(RequestValidationError, handle_validation_error)
    application.add_exception_handler(Exception, handle_unexpected_error)
