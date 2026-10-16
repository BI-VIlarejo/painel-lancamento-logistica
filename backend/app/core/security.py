"""Utilitários de hashing para credenciais locais do Portal."""

from pwdlib import PasswordHash

_password_hash = PasswordHash.recommended()


class InvalidPassword(ValueError):
    """Senha que não atende à política do Portal."""


def validate_new_password(password: str) -> None:
    """Aplica o tamanho mínimo definido para contas sem MFA."""
    if len(password) < 15:
        raise InvalidPassword("A senha deve ter pelo menos 15 caracteres.")
    if len(password) > 1024:
        raise InvalidPassword("A senha excede o tamanho máximo permitido.")


def hash_password(password: str) -> str:
    """Gera hash Argon2id para armazenamento; nunca armazena a senha original."""
    validate_new_password(password)
    return _password_hash.hash(password)


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verifica uma senha sem propagar erros de hash malformado."""
    try:
        return _password_hash.verify(password, encoded_hash)
    except (ValueError, TypeError):
        return False
