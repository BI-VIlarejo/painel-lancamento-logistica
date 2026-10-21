"""Modelo ORM opcional para feedback relacionado a entregas."""

from __future__ import annotations

from datetime import date, datetime

from app.core.orm import Base
from sqlalchemy import (
    BigInteger,
    CHAR,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column


class Feedback(Base):
    __tablename__ = "op_logistica_feedback"
    __table_args__ = (
        ForeignKeyConstraint(
            [
                "id_entrega_diaria",
                "id_lancamento_revisao",
                "id_localidade",
            ],
            [
                "op_logistica_entrega_diaria.id_entrega_diaria",
                "op_logistica_entrega_diaria.id_lancamento_revisao",
                "op_logistica_entrega_diaria.id_localidade",
            ],
            name="fk_op_logistica_feedback_entrega_revisao_localidade",
        ),
        UniqueConstraint(
            "chave_idempotencia",
            name="uq_op_logistica_feedback_idempotencia",
        ),
        CheckConstraint(
            "tipo in ('RECLAMACAO', 'ELOGIO')",
            name="ck_op_logistica_feedback_tipo",
        ),
        Index("ix_op_logistica_feedback_revisao", "id_lancamento_revisao"),
        Index(
            "ix_op_logistica_feedback_localidade_data_tipo",
            "id_localidade",
            "data_feedback",
            "tipo",
        ),
        Index(
            "ix_op_logistica_feedback_entrega_revisao_localidade",
            "id_entrega_diaria",
            "id_lancamento_revisao",
            "id_localidade",
        ),
        Index("ix_op_logistica_feedback_tipo", "tipo"),
    )

    id_feedback: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    chave_idempotencia: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    id_lancamento_revisao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_lancamento_revisao.id_lancamento_revisao",
            name="fk_op_logistica_feedback_revisao",
        ),
        nullable=False,
    )
    codigo_item_lancamento: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    data_feedback: Mapped[date] = mapped_column(Date, nullable=False)
    id_localidade: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_localidade.id_localidade",
            name="fk_op_logistica_feedback_localidade",
        ),
        nullable=False,
    )
    id_entrega_diaria: Mapped[int] = mapped_column(BigInteger, nullable=False)
    identificador_cliente: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )
    nome_cliente: Mapped[str | None] = mapped_column(String(160), nullable=True)
    relato: Mapped[str] = mapped_column(Text, nullable=False)
    criado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_feedback_criador",
        ),
        nullable=True,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
