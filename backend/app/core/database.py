"""Engine e dependência de sessão SQLAlchemy para a API."""

from collections.abc import Generator
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database_tunnel import get_database_url


@lru_cache

def get_engine() -> Engine | None:
    """Cria a engine somente quando a URL operacional estiver configurada."""
    database_url = get_database_url()
    if not database_url:
        return None
    return create_engine(database_url, pool_pre_ping=True, pool_recycle=1800)

@lru_cache

def get_session_factory() -> sessionmaker[Session] | None:
    """Cria a fábrica de sessões associada à engine configurada."""
    engine = get_engine()
    if engine is None:
        return None
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Fornece uma sessão por requisição e garante seu fechamento."""
    factory = get_session_factory()
    if factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Banco de dados não configurado.",
        )

    session = factory()
    try:
        yield session
    finally:
        session.close()

def dispose_engine() -> None:
    """Fecha o pool SQLAlchemy durante o encerramento da aplicação."""
    if get_engine.cache_info().currsize:
        engine = get_engine()
        if engine is not None:
            engine.dispose()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
