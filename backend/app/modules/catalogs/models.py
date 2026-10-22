"""Modelos ORM dos cadastros usados pelos formulários de Logística."""

from __future__ import annotations

from datetime import date, datetime

from app.core.orm import Base
from sqlalchemy import (
    BigInteger,
    Boolean,
    CHAR,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column


class Setor(Base):
    __tablename__ = "op_logistica_setor"

    id_setor: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    codigo: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    nome: Mapped[str] = mapped_column(String(100), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Localidade(Base):
    __tablename__ = "op_logistica_localidade"
    __table_args__ = (
        Index(
            "uq_op_logistica_localidade_nome_cidade_uf",
            "nome_localidade",
            "cidade",
            "uf",
            unique=True,
        ),
    )

    id_localidade: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_localidade: Mapped[str] = mapped_column(
        String(60), nullable=False, unique=True
    )
    nome_localidade: Mapped[str] = mapped_column(String(160), nullable=False)
    tipo_localidade: Mapped[str] = mapped_column(String(30), nullable=False)
    cidade: Mapped[str | None] = mapped_column(String(120), nullable=True)
    uf: Mapped[str | None] = mapped_column(String(2), nullable=True)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    sincronizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Pessoa(Base):
    __tablename__ = "op_logistica_pessoa"
    __table_args__ = (
        Index(
            "uq_op_logistica_pessoa_versao_inicio",
            "codigo_pessoa",
            "vigente_desde",
            unique=True,
        ),
        Index(
            "ix_op_logistica_pessoa_versao_fim",
            "codigo_pessoa",
            "vigente_ate",
        ),
        Index(
            "uq_op_logistica_pessoa_origem_inicio",
            "sistema_origem",
            "codigo_pessoa_origem",
            "vigente_desde",
            unique=True,
        ),
        Index(
            "ix_op_logistica_pessoa_ativa_nome",
            "ativo",
            "nome_exibicao",
        ),
        Index(
            "ix_op_logistica_pessoa_autor_data",
            "criado_por",
            "criado_em",
        ),
        CheckConstraint(
            "tipo_funcao in ('MOTORISTA', 'AJUDANTE')",
            name="ck_op_logistica_pessoa_funcao",
        ),
        CheckConstraint(
            "vigente_ate is null or vigente_ate > vigente_desde",
            name="ck_op_logistica_pessoa_periodo",
        ),
        CheckConstraint(
            "(sistema_origem is null and codigo_pessoa_origem is null) or "
            "(sistema_origem is not null and codigo_pessoa_origem is not null)",
            name="ck_op_logistica_pessoa_origem_par",
        ),
    )

    id_pessoa: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_pessoa: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    sistema_origem: Mapped[str | None] = mapped_column(String(40), nullable=True)
    codigo_pessoa_origem: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )
    nome_exibicao: Mapped[str] = mapped_column(String(160), nullable=False)
    tipo_funcao: Mapped[str] = mapped_column(String(24), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    vigente_desde: Mapped[date] = mapped_column(Date, nullable=False)
    vigente_ate: Mapped[date | None] = mapped_column(Date, nullable=True)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_pessoa_autor"),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class MotivoNaoEntrega(Base):
    __tablename__ = "op_logistica_motivo_nao_entrega"
    __table_args__ = (
        Index(
            "uq_op_logistica_motivo_versao_inicio",
            "codigo_motivo",
            "vigente_desde",
            unique=True,
        ),
        Index(
            "ix_op_logistica_motivo_versao_fim",
            "codigo_motivo",
            "vigente_ate",
        ),
        Index(
            "ix_op_logistica_motivo_autor_data",
            "criado_por",
            "criado_em",
        ),
        CheckConstraint(
            "vigente_ate is null or vigente_ate > vigente_desde",
            name="ck_op_logistica_motivo_periodo",
        ),
    )

    id_motivo_nao_entrega: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_motivo: Mapped[str] = mapped_column(String(40), nullable=False)
    descricao_motivo: Mapped[str] = mapped_column(String(160), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    vigente_desde: Mapped[date] = mapped_column(Date, nullable=False)
    vigente_ate: Mapped[date | None] = mapped_column(Date, nullable=True)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_motivo_nao_entrega_autor",
        ),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
