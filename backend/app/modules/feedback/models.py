"""Modelos ORM opcionais para feedback e participantes relacionados."""

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
            "id_lancamento_revisao",
            "codigo_item_lancamento",
            name="uq_op_logistica_feedback_revisao_item",
        ),
        Index(
            "ix_op_logistica_feedback_localidade_data_tipo",
            "id_localidade",
            "data_feedback",
            "id_tipo_feedback",
        ),
        Index(
            "ix_op_logistica_feedback_entrega_revisao_localidade",
            "id_entrega_diaria",
            "id_lancamento_revisao",
            "id_localidade",
        ),
        Index("ix_op_logistica_feedback_tipo", "id_tipo_feedback"),
    )

    id_feedback: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    id_lancamento_revisao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_lancamento_revisao.id_lancamento_revisao",
            name="fk_op_logistica_feedback_revisao",
        ),
        nullable=False,
    )
    codigo_item_lancamento: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    id_tipo_feedback: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "op_logistica_tipo_feedback.id_tipo_feedback",
            name="fk_op_logistica_feedback_tipo",
        ),
        nullable=False,
    )
    data_feedback: Mapped[date] = mapped_column(Date, nullable=False)
    id_localidade: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_localidade.id_localidade",
            name="fk_op_logistica_feedback_localidade",
        ),
        nullable=False,
    )
    id_entrega_diaria: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )
    identificador_cliente: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )
    nome_cliente: Mapped[str | None] = mapped_column(String(160), nullable=True)
    relato: Mapped[str] = mapped_column(Text, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class FeedbackParticipante(Base):
    __tablename__ = "op_logistica_feedback_participante"
    __table_args__ = (
        Index(
            "ix_op_logistica_feedback_participante_papel",
            "id_feedback",
            "papel_participante",
        ),
        Index(
            "ix_op_logistica_feedback_participante_pessoa",
            "id_pessoa",
        ),
        CheckConstraint(
            "papel_participante in ('MOTORISTA', 'AJUDANTE')",
            name="ck_op_logistica_feedback_papel",
        ),
    )

    id_feedback: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_feedback.id_feedback",
            name="fk_op_logistica_feedback_participante_feedback",
        ),
        primary_key=True,
    )
    id_pessoa: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_pessoa.id_pessoa",
            name="fk_op_logistica_feedback_participante_pessoa",
        ),
        primary_key=True,
    )
    papel_participante: Mapped[str] = mapped_column(String(20), nullable=False)
