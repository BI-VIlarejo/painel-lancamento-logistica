"""Configuração da API carregada de variáveis de ambiente."""

from functools import lru_cache
from secrets import token_bytes
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_LOCAL_SESSION_SECRET = token_bytes(32)


class Settings(BaseSettings):
    """Configuração validada para o processo da API."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "local"
    api_prefix: str = "/api/v1"
    cors_allowed_origins: str = "http://localhost:5173"
    session_secret: str | None = Field(default=None, repr=False)
    session_ttl_minutes: int = Field(default=720, ge=5, le=43_200)
    session_cookie_name: str = "op_logistica_session"
    session_cookie_secure: bool | None = None
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    login_rate_limit_attempts: int = Field(default=5, ge=1, le=100)
    login_rate_limit_window_seconds: int = Field(default=900, ge=1, le=86_400)
    op_logistica_database_url: str | None = Field(default=None, repr=False)

    @model_validator(mode="after")
    def validate_auth_settings(self) -> "Settings":
        """Exige segredos e cookies seguros nos ambientes de produção."""
        environment = self.app_env.strip().lower()
        is_development = environment in {"local", "dev", "development", "test"}

        if (
            self.session_secret is not None
            and len(self.session_secret.encode("utf-8")) < 32
        ):
            raise ValueError("SESSION_SECRET precisa ter pelo menos 32 bytes.")

        if not is_development and self.session_secret is None:
            raise ValueError("SESSION_SECRET é obrigatório em staging e produção.")

        if not is_development and self.session_cookie_secure is False:
            raise ValueError("SESSION_COOKIE_SECURE não pode ser false fora do ambiente local.")

        if self.session_cookie_samesite == "none" and not self.session_cookie_is_secure:
            raise ValueError("SameSite=None exige SESSION_COOKIE_SECURE=true.")

        return self

    @property
    def cors_origins(self) -> list[str]:
        """Origens CORS configuradas, separadas por vírgula."""
        return [
            origin.strip().rstrip("/")
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]

    @property
    def session_cookie_is_secure(self) -> bool:
        """Usa cookies Secure por padrão fora dos ambientes locais."""
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.app_env.strip().lower() not in {
            "local",
            "dev",
            "development",
            "test",
        }

    @property
    def session_cookie_path(self) -> str:
        """Limita o cookie às rotas versionadas da API."""
        return self.api_prefix.rstrip("/") or "/"

    @property
    def session_signing_key(self) -> bytes:
        """Retorna a chave configurada ou uma chave efêmera apenas para desenvolvimento."""
        if self.session_secret is not None:
            return self.session_secret.encode("utf-8")
        return _LOCAL_SESSION_SECRET


@lru_cache
def get_settings() -> Settings:
    """Retorna uma instância única da configuração do processo."""
    return Settings()
