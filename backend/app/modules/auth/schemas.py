"""Schemas públicos de autenticação, sem campos de credencial de saída."""

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class LoginRequest(BaseModel):
    """Credenciais enviadas para iniciar uma sessão."""

    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(min_length=1, max_length=80)
    password: SecretStr = Field(min_length=1, max_length=1024)


class AuthenticatedUser(BaseModel):
    """Identidade pública do usuário autenticado."""

    id_usuario: int
    username: str
    nome_completo: str


class MeResponse(BaseModel):
    """Identidade e capacidades calculadas pelo servidor."""

    user: AuthenticatedUser
    permissions: list[str]
    scopes: list[dict[str, int | str | None]]
