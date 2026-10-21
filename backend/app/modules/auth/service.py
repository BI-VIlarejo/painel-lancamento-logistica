"""Regras de autenticação local e ciclo de vida das sessões."""

from __future__ import annotations

import hashlib
import logging
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from math import ceil
from threading import Lock
from time import monotonic
from typing import NoReturn
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, ServiceUnavailableError
from app.core.security import (
    create_csrf_token,
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from app.modules.auth import repository
from app.modules.auth.normalization import normalize_username
from app.modules.auth.schemas import AuthenticatedUser
from app.modules.access_control.models import AutorizacaoEvento

logger = logging.getLogger("lancamento.api.auth")

@dataclass(frozen=True)
class AuthenticatedSession:
    """Contexto autenticado interno, sem o token bruto da sessão."""

    user: AuthenticatedUser
    session_id: int

@dataclass(frozen=True)
class LoginResult:
    """Resultado interno do login; o token bruto nunca é serializado."""

    user: AuthenticatedUser
    session_token: str = field(repr=False)
    csrf_token: str

class _InMemoryLoginLimiter:
    """Limitação local por combinação de IP e username, para desenvolvimento."""

    def __init__(self) -> None:
        self._attempts: OrderedDict[str, tuple[float, int]] = OrderedDict()
        self._lock = Lock()
        self._max_keys = 10_000

    def retry_after(
        self,
        key: str,
        *,
        max_attempts: int,
        window_seconds: int,
    ) -> int | None:
        now = monotonic()
        with self._lock:
            entry = self._attempts.get(key)
            if entry is None:
                return None

            started_at, count = entry
            if now - started_at >= window_seconds:
                del self._attempts[key]
                return None

            self._attempts.move_to_end(key)
            if count < max_attempts:
                return None

            return max(1, ceil(window_seconds - (now - started_at)))

    def record_failure(
        self,
        key: str,
        *,
        window_seconds: int,
    ) -> None:
        now = monotonic()
        with self._lock:
            entry = self._attempts.get(key)
            if entry is None or now - entry[0] >= window_seconds:
                self._attempts[key] = (now, 1)
            else:
                self._attempts[key] = (entry[0], entry[1] + 1)

            self._attempts.move_to_end(key)
            while len(self._attempts) > self._max_keys:
                self._attempts.popitem(last=False)

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)

_login_limiter = _InMemoryLoginLimiter()
_password_reset_limiter = _InMemoryLoginLimiter()
_dummy_password_hash = hash_password("dummy-password-never-used")

def _utc_now() -> datetime:
    """Produz datetime UTC sem timezone para compatibilidade com colunas DATETIME."""
    return datetime.now(UTC).replace(tzinfo=None)

def _limiter_key(client_ip: str, username: str) -> str:
    """Evita manter username e IP em texto claro na chave do limitador."""
    raw_key = f"{client_ip}\x00{username}".encode("utf-8")
    return hashlib.sha256(raw_key).hexdigest()

def _normalize_full_name(name: str) -> str:
    """Compara o nome sem diferenças de caixa ou espaços repetidos."""
    normalized = unicodedata.normalize("NFKC", name)
    return " ".join(normalized.split()).casefold()

def _raise_database_unavailable(db: Session, exc: SQLAlchemyError) -> NoReturn:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    logger.error("auth_database_failure exception_type=%s", type(exc).__name__)
    raise ServiceUnavailableError(
        "Autenticação temporariamente indisponível."
    ) from exc

def login(
    db: Session,
    *,
    username: str,
    password: str,
    client_ip: str,
) -> LoginResult:
    """Valida credenciais e cria uma sessão opaca persistente."""
    settings = get_settings()
    canonical_username = normalize_username(username)
    limiter_key = _limiter_key(client_ip, canonical_username)

    retry_after = _login_limiter.retry_after(
        limiter_key,
        max_attempts=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas de login. Tente novamente mais tarde.",
            headers={"Retry-After": str(retry_after)},
        )

    user_id: int | None = None
    stored_hash: str | None = None
    account_is_active = False

    try:
        user = repository.get_user_by_username(db, canonical_username)
        if user is not None:
            user_id = user.id_usuario
            stored_hash = user.hash_senha
            account_is_active = user.ativo
        db.rollback()
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)

    password_valid = verify_password(password, stored_hash or _dummy_password_hash)
    if (
        user_id is None
        or not account_is_active
        or not stored_hash
        or not password_valid
    ):
        _login_limiter.record_failure(
            limiter_key,
            window_seconds=settings.login_rate_limit_window_seconds,
        )
        raise AuthenticationError("Credenciais inválidas.")

    now = _utc_now()
    session_token = generate_session_token()
    token_hash = hash_session_token(session_token)

    try:
        created = repository.create_session_for_user(
            db,
            id_usuario=user_id,
            expected_password_hash=stored_hash,
            hash_token=token_hash,
            criado_em=now,
            expira_em=now + timedelta(minutes=settings.session_ttl_minutes),
        )
        if created is None:
            db.rollback()
            _login_limiter.record_failure(
                limiter_key,
                window_seconds=settings.login_rate_limit_window_seconds,
            )
            raise AuthenticationError("Credenciais inválidas.")

        _, user = created
        db.commit()
    except AuthenticationError:
        raise
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)

    _login_limiter.clear(limiter_key)
    public_user = AuthenticatedUser(
        id_usuario=user.id_usuario,
        username=user.username,
        nome_completo=user.nome_completo,
        troca_senha_obrigatoria=False,
    )
    return LoginResult(
        user=public_user,
        session_token=session_token,
        csrf_token=create_csrf_token(session_token, settings.session_signing_key),
    )

def find_session(
    db: Session,
    session_token: str,
) -> AuthenticatedSession | None:
    """Retorna identidade somente para sessão ativa e conta habilitada."""
    if not session_token or len(session_token) > 512:
        return None

    now = _utc_now()
    token_hash = hash_session_token(session_token)
    try:
        result = repository.get_valid_session(
            db,
            hash_token=token_hash,
            agora=now,
        )
        if result is None:
            return None

        session, user = result
        last_use = session.ultimo_uso_em
        if last_use is None or last_use < now - timedelta(minutes=5):
            repository.update_session_last_use(session, usado_em=now)
            db.commit()

        return AuthenticatedSession(
            user=AuthenticatedUser(
                id_usuario=user.id_usuario,
                username=user.username,
                nome_completo=user.nome_completo,
                troca_senha_obrigatoria=False,
            ),
            session_id=session.id_sessao,
        )
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)

def require_session(
    db: Session,
    session_token: str | None,
) -> AuthenticatedSession:
    """Exige uma sessão persistida válida."""
    if not session_token:
        raise AuthenticationError()
    auth = find_session(db, session_token)
    if auth is None:
        raise AuthenticationError()
    return auth

def find_session_id_for_logout(
    db: Session,
    session_token: str,
) -> int | None:
    """Busca a sessão pelo token para permitir logout também após expiração."""
    if not session_token or len(session_token) > 512:
        return None

    try:
        session = repository.get_session_by_hash(
            db,
            hash_token=hash_session_token(session_token),
        )
        return session.id_sessao if session is not None else None
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)

def revoke_session(db: Session, session_id: int) -> None:
    """Revoga a sessão e confirma a alteração no banco."""
    try:
        repository.revoke_session(
            db,
            id_sessao=session_id,
            revogado_em=_utc_now(),
        )
        db.commit()
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)


def change_password(
    db: Session,
    *,
    id_usuario: int,
    id_sessao_atual: int,
    senha_atual: str,
    nova_senha: str,
) -> None:
    """Atualiza a credencial e invalida as outras sessões da conta."""
    try:
        user = repository.get_user_for_update(db, id_usuario=id_usuario)
        if user is None or not user.ativo or not verify_password(senha_atual, user.hash_senha or ""):
            raise AuthenticationError("A senha atual não confere.")
        try:
            encoded_hash = hash_password(nova_senha)
        except ValueError as exc:
            raise AuthenticationError("A nova senha não atende à política do portal.") from exc

        now = _utc_now()
        user.hash_senha = encoded_hash
        user.senha_alterada_em = now
        user.troca_senha_obrigatoria = False
        user.atualizado_em = now
        repository.revoke_other_user_sessions(
            db,
            id_usuario=id_usuario,
            id_sessao_atual=id_sessao_atual,
            revogado_em=now,
        )
        db.add(
            AutorizacaoEvento(
                tipo_evento="USUARIO_SENHA_ALTERADA",
                id_usuario_ator=id_usuario,
                ocorrido_em=now,
                detalhes={"id_usuario": id_usuario},
            )
        )
        db.commit()
    except AuthenticationError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)


def reset_password(
    db: Session,
    *,
    nome_completo: str,
    username: str,
    nova_senha: str,
    client_ip: str,
) -> None:
    """Redefine a senha local após conferir nome completo e username."""
    settings = get_settings()
    canonical_username = normalize_username(username)
    limiter_key = _limiter_key(client_ip, canonical_username)
    retry_after = _password_reset_limiter.retry_after(
        limiter_key,
        max_attempts=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas de redefinição. Tente novamente mais tarde.",
            headers={"Retry-After": str(retry_after)},
        )
    _password_reset_limiter.record_failure(
        limiter_key,
        window_seconds=settings.login_rate_limit_window_seconds,
    )

    try:
        user = repository.get_user_by_username_for_update(db, canonical_username)
        if (
            user is None
            or not user.ativo
            or _normalize_full_name(user.nome_completo) != _normalize_full_name(nome_completo)
        ):
            db.rollback()
            return

        try:
            encoded_hash = hash_password(nova_senha)
        except ValueError:
            db.rollback()
            return

        now = _utc_now()
        user.hash_senha = encoded_hash
        user.senha_alterada_em = now
        user.troca_senha_obrigatoria = False
        user.atualizado_em = now
        repository.revoke_user_sessions(
            db,
            id_usuario=user.id_usuario,
            revogado_em=now,
        )
        db.add(
            AutorizacaoEvento(
                tipo_evento="USUARIO_SENHA_ALTERADA",
                id_usuario_ator=user.id_usuario,
                ocorrido_em=now,
                detalhes={
                    "id_usuario": user.id_usuario,
                    "tipo_alteracao": "SENHA_REDEFINIDA_DADOS_CADASTRAIS",
                },
            )
        )
        db.commit()
    except SQLAlchemyError as exc:
        _raise_database_unavailable(db, exc)
