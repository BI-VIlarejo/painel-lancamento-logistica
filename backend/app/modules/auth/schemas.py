"""Schemas públicos de autenticação, sem campos de credencial de saída."""

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.modules.access_control.schemas import AccessScopeSummary
from app.modules.auth.normalization import normalize_username


class LoginRequest(BaseModel):
    """Credenciais enviadas para iniciar uma sessão."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=80)
    password: SecretStr = Field(min_length=1, max_length=1024)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        """Normaliza somente o username; espaços da senha são significativos."""
        if isinstance(value, str):
            return normalize_username(value)
        return value


class AuthenticatedUser(BaseModel):
    """Identidade pública do usuário autenticado."""

    id_usuario: int
    username: str
    nome_completo: str
    troca_senha_obrigatoria: bool = False


class LoginResponse(BaseModel):
    """Resposta de login; o token de sessão vai somente no cookie HttpOnly."""

    user: AuthenticatedUser
    csrf_token: str


class CsrfTokenResponse(BaseModel):
    """Token CSRF público para ser enviado no cabeçalho das operações de escrita."""

    csrf_token: str


class MeResponse(BaseModel):
    """Identidade e capacidades que serão calculadas pelo servidor."""

    user: AuthenticatedUser
    permissions: list[str]
    scopes: list[AccessScopeSummary]


class ChangePasswordRequest(BaseModel):
    """Troca de senha autenticada, inclusive para a primeira entrada da conta."""

    model_config = ConfigDict(extra="forbid")

    senha_atual: SecretStr = Field(min_length=1, max_length=1024)
    nova_senha: SecretStr = Field(min_length=6, max_length=1024)

    @model_validator(mode="after")
    def require_new_value(self) -> "ChangePasswordRequest":
        if self.senha_atual.get_secret_value() == self.nova_senha.get_secret_value():
            raise ValueError("A nova senha deve ser diferente da senha atual.")
        return self
