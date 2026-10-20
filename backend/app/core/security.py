"""Utilitários criptográficos para credenciais e sessões do Portal."""

from hashlib import sha256
from hmac import compare_digest, new as hmac_new
from secrets import token_urlsafe

from pwdlib import PasswordHash

_password_hash = PasswordHash.recommended()
MIN_PASSWORD_LENGTH = 6
MAX_PASSWORD_LENGTH = 1024


class InvalidPassword(ValueError):
    """Senha que não atende à política do Portal."""


def validate_new_password(password: str) -> None:
    """Aplica os limites de tamanho definidos para senhas novas."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise InvalidPassword(
            f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres."
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise InvalidPassword("A senha excede o tamanho máximo permitido.")


def hash_password(password: str) -> str:
    """Gera hash Argon2id para armazenamento; nunca armazena a senha original."""
    validate_new_password(password)
    return _password_hash.hash(password)


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verifica a senha sem propagar erro de hash malformado."""
    if not encoded_hash:
        return False
    try:
        return _password_hash.verify(password, encoded_hash)
    except Exception:
        return False


def generate_session_token() -> str:
    """Gera um token opaco de sessão com 256 bits de entropia."""
    return token_urlsafe(32)


def hash_session_token(session_token: str) -> str:
    """Retorna o SHA-256 hexadecimal do token de sessão."""
    return sha256(session_token.encode("utf-8")).hexdigest()


def create_csrf_token(session_token: str, signing_key: bytes) -> str:
    """Assina um token CSRF vinculado à sessão atual."""
    message = b"lancamento-logistica:csrf:v1:" + session_token.encode("utf-8")
    return hmac_new(signing_key, message, sha256).hexdigest()


def verify_csrf_token(
    session_token: str,
    supplied_token: str | None,
    signing_key: bytes,
) -> bool:
    """Compara o token CSRF em tempo constante."""
    if supplied_token is None or len(supplied_token) != 64:
        return False
    if any(character not in "0123456789abcdef" for character in supplied_token):
        return False
    expected_token = create_csrf_token(session_token, signing_key)
    return compare_digest(expected_token, supplied_token)
