"""Base SQLAlchemy compartilhada pelos modelos operacionais do portal."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Metadata ORM do catálogo operacional de Logística."""

