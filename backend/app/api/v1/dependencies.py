"""Dependências reutilizáveis das rotas HTTP."""

from collections.abc import Callable
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.security import verify_csrf_token
from app.modules.access_control import service as access_control_service
from app.modules.access_control.service import AuthorizationContext
from app.modules.auth.schemas import AuthenticatedUser
from app.modules.auth.service import AuthenticatedSession, require_session

DatabaseSession = Annotated[Session, Depends(get_db)]


def get_request_id(request: Request) -> str:
    """Obtém o identificador criado pelo middleware de request."""
    return getattr(request.state, "request_id", "")


RequestId = Annotated[str, Depends(get_request_id)]


def _origin_from_value(value: str, *, allow_path: bool) -> str | None:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    if not allow_path and (parsed.path or parsed.query or parsed.fragment):
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def validate_request_origin(request: Request) -> None:
    """Exige Origin ou Referer correspondente a uma origem CORS configurada."""
    settings = get_settings()
    origin_header = request.headers.get("origin")
    if origin_header:
        origin = _origin_from_value(origin_header.strip(), allow_path=False)
    else:
        referer = request.headers.get("referer")
        origin = (
            _origin_from_value(referer.strip(), allow_path=True)
            if referer
            else None
        )

    allowed = {
        normalized
        for configured in settings.cors_origins
        if (normalized := _origin_from_value(configured, allow_path=False)) is not None
    }
    if origin is None or origin not in allowed:
        raise PermissionDeniedError("Origem da solicitação não autorizada.")


def validate_csrf_request(request: Request, session_token: str) -> None:
    """Valida origem e token CSRF nas operações autenticadas de escrita."""
    validate_request_origin(request)
    settings = get_settings()
    supplied_token = request.headers.get("X-CSRF-Token")
    if not verify_csrf_token(
        session_token,
        supplied_token,
        settings.session_signing_key,
    ):
        raise PermissionDeniedError("Verificação CSRF inválida.")


def get_current_auth_context(
    request: Request,
    db: DatabaseSession,
) -> AuthenticatedSession:
    """Valida cookie, sessão persistida, expiração e estado da conta."""
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name)
    return require_session(db, session_token)


def get_current_user(
    auth: Annotated[AuthenticatedSession, Depends(get_current_auth_context)],
) -> AuthenticatedUser:
    """Fornece somente a identidade pública às rotas protegidas."""
    return auth.user


def require_csrf(
    request: Request,
    auth: Annotated[AuthenticatedSession, Depends(get_current_auth_context)],
) -> AuthenticatedSession:
    """Dependência reutilizável para rotas de escrita autenticadas por cookie."""
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name)
    if not session_token:
        raise AuthenticationError()
    validate_csrf_request(request, session_token)
    return auth


CurrentAuth = Annotated[AuthenticatedSession, Depends(get_current_auth_context)]
CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
CsrfProtectedAuth = Annotated[AuthenticatedSession, Depends(require_csrf)]


def require_permission(
    permission_code: str,
) -> Callable[..., AuthorizationContext]:
    """Cria uma dependência que exige permissão vigente para a identidade atual."""

    def dependency(
        db: DatabaseSession,
        auth: CurrentAuth,
    ) -> AuthorizationContext:
        return access_control_service.require_permission(
            db,
            id_usuario=auth.user.id_usuario,
            permission_code=permission_code,
        )

    return dependency


def require_global_permission(
    permission_code: str,
) -> Callable[..., AuthorizationContext]:
    """Exige a permissão indicada concedida explicitamente em escopo global."""

    def dependency(
        db: DatabaseSession,
        auth: CurrentAuth,
    ) -> AuthorizationContext:
        access = access_control_service.require_permission(
            db,
            id_usuario=auth.user.id_usuario,
            permission_code=permission_code,
        )
        if not any(grant.tipo_escopo == "GLOBAL" for grant in access.grants):
            raise PermissionDeniedError("É necessário um escopo global para esta ação.")
        return access

    return dependency
