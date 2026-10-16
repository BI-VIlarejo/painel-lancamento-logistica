"""Configuração da API carregada de variáveis de ambiente."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    session_secret: str | None = None
    op_logistica_database_url: str | None = Field(default=None, repr=False)

    @property
    def cors_origins(self) -> list[str]:
        """Origens CORS configuradas, separadas por vírgula."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


@lru_cache

def get_settings() -> Settings:
    """Retorna uma instância única da configuração do processo."""
    return Settings()
