"""Modelos ORM opcionais para controle e linhagem de publicação."""

from __future__ import annotations

from datetime import datetime

from app.core.orm import Base
from sqlalchemy import (
    BigInteger,
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column


class Publicacao(Base):
    __tablename__ = "op_logistica_publicacao"
    __table_args__ = (
        Index(
            "ix_op_logistica_publicacao_status_inicio",
            "status",
            "iniciado_em",
        ),
        Index(
            "ix_op_logistica_publicacao_alvo_inicio",
            "codigo_alvo",
            "iniciado_em",
        ),
        Index(
            "ix_op_logistica_publicacao_iniciador_data",
            "iniciado_por",
            "iniciado_em",
        ),
        CheckConstraint(
            "status in ('INICIADA', 'CONCLUIDA', 'FALHOU', 'CANCELADA')",
            name="ck_op_logistica_publicacao_status",
        ),
        CheckConstraint(
            "lancamentos_lidos >= 0 and lancamentos_publicados >= 0 "
            "and lancamentos_rejeitados >= 0",
            name="ck_op_logistica_publicacao_contagens",
        ),
        CheckConstraint(
            "lancamentos_publicados + lancamentos_rejeitados <= lancamentos_lidos",
            name="ck_op_logistica_publicacao_contagens_soma",
        ),
        CheckConstraint(
            "concluido_em is null or concluido_em >= iniciado_em",
            name="ck_op_logistica_publicacao_periodo",
        ),
        CheckConstraint(
            "(status = 'INICIADA' and concluido_em is null) or "
            "(status in ('CONCLUIDA', 'FALHOU', 'CANCELADA') "
            "and concluido_em is not null)",
            name="ck_op_logistica_publicacao_conclusao",
        ),
    )

    id_publicacao: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_execucao: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    chave_idempotencia: Mapped[str] = mapped_column(
        CHAR(36), nullable=False, unique=True
    )
    codigo_alvo: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    iniciado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_publicacao_iniciador",
        ),
        nullable=True,
    )
    iniciado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    concluido_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lancamentos_lidos: Mapped[int] = mapped_column(Integer, nullable=False)
    lancamentos_publicados: Mapped[int] = mapped_column(Integer, nullable=False)
    lancamentos_rejeitados: Mapped[int] = mapped_column(Integer, nullable=False)
    erro_resumido: Mapped[str | None] = mapped_column(Text, nullable=True)


class PublicacaoLancamento(Base):
    __tablename__ = "op_logistica_publicacao_lancamento"
    __table_args__ = (
        Index(
            "ix_op_logistica_publicacao_revisao_data",
            "id_lancamento_revisao",
            "processado_em",
        ),
        CheckConstraint(
            "resultado in ('PUBLICADO', 'IGNORADO', 'REJEITADO', 'SUBSTITUIDO')",
            name="ck_op_logistica_publicacao_lancamento_resultado",
        ),
    )

    id_publicacao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_publicacao.id_publicacao",
            name="fk_op_logistica_publicacao_lancamento_publicacao",
        ),
        primary_key=True,
    )
    id_lancamento_revisao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_lancamento_revisao.id_lancamento_revisao",
            name="fk_op_logistica_publicacao_lancamento_revisao",
        ),
        primary_key=True,
    )
    hash_revisao: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    resultado: Mapped[str] = mapped_column(String(20), nullable=False)
    processado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
