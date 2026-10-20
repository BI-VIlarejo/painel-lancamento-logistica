"""Modelos ORM das contas locais e das sessões persistentes do portal."""

from __future__ import annotations

from datetime import datetime

from app.core.orm import Base
from sqlalchemy import (
    BigInteger,
    Boolean,
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column


class Usuario(Base):
    __tablename__ = "op_logistica_usuario"
    __table_args__ = (
        CheckConstraint(
            "(hash_senha IS NULL AND senha_alterada_em IS NULL "
            "AND troca_senha_obrigatoria IS NULL) OR "
            "(hash_senha IS NOT NULL AND senha_alterada_em IS NOT NULL "
            "AND troca_senha_obrigatoria IS NOT NULL)",
            name="ck_op_logistica_usuario_credencial_completa",
        ),
    )

    id_usuario: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    username: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    nome_completo: Mapped[str] = mapped_column(String(160), nullable=False)
    ativo: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("0")
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ultimo_login_em: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    hash_senha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    senha_alterada_em: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    troca_senha_obrigatoria: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )


class UsuarioSessao(Base):
    """Sessões persistentes; o token bruto nunca é armazenado no banco."""

    __tablename__ = "op_logistica_sessao"
    __table_args__ = (
        CheckConstraint(
            "expira_em > criado_em",
            name="ck_op_logistica_sessao_periodo",
        ),
        CheckConstraint(
            "revogado_em IS NULL OR revogado_em >= criado_em",
            name="ck_op_logistica_sessao_revogacao",
        ),
        Index(
            "ix_op_logistica_sessao_usuario_expira",
            "id_usuario",
            "expira_em",
        ),
        Index("ix_op_logistica_sessao_expira", "expira_em"),
        UniqueConstraint("hash_token", name="uq_op_logistica_sessao_hash_token"),
    )

    id_sessao: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    id_usuario: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_sessao_usuario",
        ),
        nullable=False,
    )
    hash_token: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expira_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ultimo_uso_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revogado_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
