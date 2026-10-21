"""Rotas HTTP de login, logout e identidade autenticada."""

import logging

from fastapi import APIRouter, Request, Response, status

from app.api.v1.dependencies import (
    CurrentAuth,
    CsrfProtectedAuth,
    DatabaseSession,
    validate_csrf_request,
    validate_request_origin,
)
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError
from app.core.security import create_csrf_token
from app.modules.access_control.service import build_me_response
from app.modules.auth import service
from app.modules.auth.schemas import (
    AuthenticatedUser,
    ChangePasswordRequest,
    CsrfTokenResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    ResetPasswordRequest,
)

logger = logging.getLogger("lancamento.api.auth")
router = APIRouter(tags=["Autenticação"])

def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"

@router.post("/auth/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
) -> LoginResponse:
    """Autentica a conta e entrega a sessão somente em cookie HttpOnly."""
    validate_request_origin(request)
    client_ip = request.client.host if request.client is not None else "unknown"

    try:
        result = service.login(
            db,
            username=payload.username,
            password=payload.password.get_secret_value(),
            client_ip=client_ip,
        )
    except AuthenticationError:
        logger.warning(
            "auth_login_failed request_id=%s",
            getattr(request.state, "request_id", "-"),
        )
        raise

    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=result.session_token,
        max_age=settings.session_ttl_minutes * 60,
        path=settings.session_cookie_path,
        secure=settings.session_cookie_is_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )
    _no_store(response)
    logger.info(
        "auth_login_succeeded request_id=%s user_id=%s",
        getattr(request.state, "request_id", "-"),
        result.user.id_usuario,
    )
    return LoginResponse(user=result.user, csrf_token=result.csrf_token)


@router.post(
    "/auth/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def logout(
    request: Request,
    response: Response,
    db: DatabaseSession,
) -> Response:
    """Revoga a sessão atual e limpa o cookie, inclusive para sessão expirada."""
    validate_request_origin(request)
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name)

    if session_token:
        session_id = service.find_session_id_for_logout(db, session_token)
        if session_id is not None:
            validate_csrf_request(request, session_token)
            service.revoke_session(db, session_id)

    response.delete_cookie(
        key=settings.session_cookie_name,
        path=settings.session_cookie_path,
        secure=settings.session_cookie_is_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )
    _no_store(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    auth: CsrfProtectedAuth,
    db: DatabaseSession,
    response: Response,
) -> Response:
    """Permite trocar a senha própria e concluir a ativação de uma conta."""
    service.change_password(
        db,
        id_usuario=auth.user.id_usuario,
        id_sessao_atual=auth.session_id,
        senha_atual=payload.senha_atual.get_secret_value(),
        nova_senha=payload.nova_senha.get_secret_value(),
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    _no_store(response)
    return response


@router.post(
    "/auth/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
) -> Response:
    """Redefine a senha no portal sem depender de envio de e-mail."""
    validate_request_origin(request)
    client_ip = request.client.host if request.client is not None else "unknown"
    service.reset_password(
        db,
        nome_completo=payload.nome_completo,
        username=payload.username,
        nova_senha=payload.nova_senha.get_secret_value(),
        client_ip=client_ip,
    )
    _no_store(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/auth/csrf", response_model=CsrfTokenResponse)
def get_csrf_token(
    request: Request,
    response: Response,
    auth: CurrentAuth,
) -> CsrfTokenResponse:
    """Renova o token CSRF após recarregar o frontend, sem expor a sessão."""
    settings = get_settings()
    session_token = request.cookies.get(settings.session_cookie_name)
    if not session_token:
        raise AuthenticationError()

    _no_store(response)
    return CsrfTokenResponse(
        csrf_token=create_csrf_token(
            session_token,
            settings.session_signing_key,
        )
    )


@router.get("/me", response_model=MeResponse)
def get_me(
    response: Response,
    auth: CurrentAuth,
    db: DatabaseSession,
) -> MeResponse:
    """Retorna identidade, permissões e escopos calculados no servidor."""
    _no_store(response)
    return build_me_response(db, user=auth.user)
