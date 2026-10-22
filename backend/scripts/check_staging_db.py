"""Confirma o acesso de runtime ao catálogo de staging sem alterar dados."""

from __future__ import annotations

import sys

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError

from app.core.config import get_settings
from app.core.database import dispose_engine, get_engine


EXPECTED_DATABASE = "vilarejo_bi_logistica_staging"


def main() -> int:
    try:
        settings = get_settings()
    except (ValidationError, ValueError):
        print("Configuração inválida. Confira as variáveis obrigatórias; valores omitidos.", file=sys.stderr)
        return 1
    if settings.app_env.strip().lower() != "staging":
        print("Recusado: APP_ENV precisa ser staging.", file=sys.stderr)
        return 1
    if not settings.op_logistica_database_url:
        print("Recusado: OP_LOGISTICA_DATABASE_URL não está configurada.", file=sys.stderr)
        return 1

    try:
        database_url = make_url(settings.op_logistica_database_url)
    except (ArgumentError, ValueError):
        print("OP_LOGISTICA_DATABASE_URL inválida; valor omitido.", file=sys.stderr)
        return 1
    if database_url.get_backend_name() != "mysql" or database_url.database != EXPECTED_DATABASE:
        print("Recusado: a URL precisa apontar para o catálogo MySQL de staging esperado.", file=sys.stderr)
        return 1

    try:
        with get_engine().connect() as connection:
            if connection.execute(text("SELECT 1")).scalar_one() != 1:
                raise RuntimeError("A consulta de conectividade retornou um resultado inesperado.")
    except (SQLAlchemyError, RuntimeError):
        print(
            "Falha ao conectar ao staging. Confira DNS privado, rota, Security Groups e credencial; detalhes omitidos.",
            file=sys.stderr,
        )
        return 1
    finally:
        dispose_engine()

    print("Conexão ao banco de staging confirmada; nenhum dado foi alterado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
