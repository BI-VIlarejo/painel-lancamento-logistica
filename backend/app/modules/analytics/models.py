"""Modelos persistentes de metas do Painel Gerencial."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm import Base


class DashboardGoal(Base):
    """Meta geral de taxa de realização; a linha de ID 1 é única por catálogo."""

    __tablename__ = "op_logistica_meta_painel"
    __table_args__ = (
        CheckConstraint("id_meta = 1", name="ck_op_logistica_meta_painel_singleton"),
        CheckConstraint(
            "valor_percentual >= 0 and valor_percentual <= 100",
            name="ck_op_logistica_meta_painel_percentual",
        ),
        CheckConstraint(
            "periodicidade in ('MENSAL', 'TRIMESTRAL', 'ANUAL')",
            name="ck_op_logistica_meta_painel_periodicidade",
        ),
        CheckConstraint(
            "escopo_operacao in ('TODAS', 'ENTREGAS', 'COLETAS')",
            name="ck_op_logistica_meta_painel_escopo",
        ),
    )

    id_meta: Mapped[int] = mapped_column(Integer, primary_key=True)
    valor_percentual: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    periodicidade: Mapped[str] = mapped_column(String(12), nullable=False)
    escopo_operacao: Mapped[str] = mapped_column(String(12), nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_meta_painel_usuario"),
        nullable=True,
    )


class DashboardGoalEvent(Base):
    """Histórico somente de acréscimo das alterações da meta geral."""

    __tablename__ = "op_logistica_meta_painel_evento"
    __table_args__ = (
        Index("ix_op_logistica_meta_painel_evento_data", "ocorrido_em"),
        Index(
            "ix_op_logistica_meta_painel_evento_ator_data",
            "id_usuario_ator",
            "ocorrido_em",
        ),
        CheckConstraint(
            "valor_anterior is null or (valor_anterior >= 0 and valor_anterior <= 100)",
            name="ck_op_logistica_meta_painel_evento_anterior",
        ),
        CheckConstraint(
            "valor_novo >= 0 and valor_novo <= 100",
            name="ck_op_logistica_meta_painel_evento_novo",
        ),
        CheckConstraint(
            "periodicidade_nova in ('MENSAL', 'TRIMESTRAL', 'ANUAL')",
            name="ck_op_logistica_meta_painel_evento_periodicidade",
        ),
        CheckConstraint(
            "periodicidade_anterior is null or periodicidade_anterior in ('MENSAL', 'TRIMESTRAL', 'ANUAL')",
            name="ck_op_logistica_meta_painel_evento_periodicidade_anterior",
        ),
        CheckConstraint(
            "escopo_novo in ('TODAS', 'ENTREGAS', 'COLETAS')",
            name="ck_op_logistica_meta_painel_evento_escopo",
        ),
        CheckConstraint(
            "escopo_anterior is null or escopo_anterior in ('TODAS', 'ENTREGAS', 'COLETAS')",
            name="ck_op_logistica_meta_painel_evento_escopo_anterior",
        ),
    )

    id_evento: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    valor_anterior: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    valor_novo: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    periodicidade_anterior: Mapped[str | None] = mapped_column(String(12), nullable=True)
    periodicidade_nova: Mapped[str] = mapped_column(String(12), nullable=False)
    escopo_anterior: Mapped[str | None] = mapped_column(String(12), nullable=True)
    escopo_novo: Mapped[str] = mapped_column(String(12), nullable=False)
    id_usuario_ator: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_meta_painel_evento_ator"),
        nullable=False,
    )
    ocorrido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
