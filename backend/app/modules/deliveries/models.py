"""Modelos ORM do fluxo de lançamentos e do formulário de entregas."""

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
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

class FormularioVersao(Base):
    __tablename__ = "op_logistica_formulario_versao"
    __table_args__ = (
        UniqueConstraint(
            "id_setor",
            "codigo_formulario",
            "versao",
            name="uq_op_logistica_formulario_setor_versao",
        ),
        Index(
            "ix_op_logistica_formulario_setor_status",
            "id_setor",
            "status",
        ),
        Index(
            "ix_op_logistica_formulario_autor_data",
            "criado_por",
            "criado_em",
        ),
        Index(
            "ix_op_logistica_formulario_publicador_data",
            "publicado_por",
            "publicado_em",
        ),
        CheckConstraint("versao > 0", name="ck_op_logistica_formulario_versao_numero"),
        CheckConstraint(
            "status in ('RASCUNHO', 'PUBLICADO', 'ENCERRADO')",
            name="ck_op_logistica_formulario_versao_status",
        ),
        CheckConstraint(
            "vigente_ate is null or "
            "(vigente_desde is not null and vigente_ate > vigente_desde)",
            name="ck_op_logistica_formulario_versao_periodo",
        ),
        CheckConstraint(
            "(status = 'RASCUNHO' and publicado_por is null and publicado_em is null) "
            "or (status in ('PUBLICADO', 'ENCERRADO') and publicado_por is not null "
            "and publicado_em is not null and vigente_desde is not null)",
            name="ck_op_logistica_formulario_versao_publicacao",
        ),
        CheckConstraint(
            "status <> 'ENCERRADO' or vigente_ate is not null",
            name="ck_op_logistica_formulario_versao_encerrada",
        ),
    )

    id_formulario_versao: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    id_setor: Mapped[int] = mapped_column(
        ForeignKey(
            "op_logistica_setor.id_setor",
            name="fk_op_logistica_formulario_versao_setor",
        ),
        nullable=False,
    )
    codigo_formulario: Mapped[str] = mapped_column(String(60), nullable=False)
    versao: Mapped[int] = mapped_column(Integer, nullable=False)
    hash_contrato: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    vigente_desde: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    vigente_ate: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_formulario_versao_criador",
        ),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    publicado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_formulario_versao_publicador",
        ),
        nullable=True,
    )
    publicado_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class Lancamento(Base):
    __tablename__ = "op_logistica_lancamento"
    __table_args__ = (
        Index("ix_op_logistica_lancamento_setor_data", "id_setor", "criado_em"),
        Index(
            "ix_op_logistica_lancamento_autor_data",
            "criado_por",
            "criado_em",
        ),
    )

    id_lancamento: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_lancamento: Mapped[str] = mapped_column(
        CHAR(36), nullable=False, unique=True
    )
    id_setor: Mapped[int] = mapped_column(
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_lancamento_setor"),
        nullable=False,
    )
    chave_idempotencia: Mapped[str] = mapped_column(
        CHAR(36), nullable=False, unique=True
    )
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_lancamento_criador",
        ),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)

class LancamentoRevisao(Base):
    __tablename__ = "op_logistica_lancamento_revisao"
    __table_args__ = (
        UniqueConstraint(
            "id_lancamento",
            "numero_revisao",
            name="uq_op_logistica_lancamento_revisao_numero",
        ),
        UniqueConstraint(
            "id_lancamento",
            "id_lancamento_revisao",
            name="uq_op_logistica_revisao_lancamento",
        ),
        Index("ix_op_logistica_revisao_estado_envio", "estado", "enviado_em"),
        Index(
            "ix_op_logistica_revisao_formulario_estado",
            "id_formulario_versao",
            "estado",
        ),
        Index(
            "ix_op_logistica_revisao_enviador_data",
            "enviado_por",
            "enviado_em",
        ),
        Index(
            "ix_op_logistica_revisao_aprovador_data",
            "aprovado_por",
            "aprovado_em",
        ),
        Index(
            "ix_op_logistica_revisao_devolvedor_data",
            "devolvido_por",
            "devolvido_em",
        ),
        CheckConstraint("numero_revisao > 0", name="ck_op_logistica_revisao_numero"),
        CheckConstraint(
            "estado in ('RASCUNHO', 'ENVIADA', 'EM_REVISAO', "
            "'DEVOLVIDA', 'APROVADA', 'CANCELADA')",
            name="ck_op_logistica_revisao_estado",
        ),
        CheckConstraint(
            "estado not in ('ENVIADA', 'EM_REVISAO', 'DEVOLVIDA', 'APROVADA') "
            "or (enviado_por is not null and enviado_em is not null)",
            name="ck_op_logistica_revisao_envio",
        ),
        CheckConstraint(
            "estado <> 'APROVADA' or "
            "(aprovado_por is not null and aprovado_em is not null)",
            name="ck_op_logistica_revisao_aprovacao",
        ),
        CheckConstraint(
            "estado <> 'DEVOLVIDA' or "
            "(devolvido_por is not null and devolvido_em is not null)",
            name="ck_op_logistica_revisao_devolucao",
        ),
        CheckConstraint(
            "estado not in ('ENVIADA', 'EM_REVISAO', 'DEVOLVIDA', 'APROVADA') "
            "or hash_conteudo is not null",
            name="ck_op_logistica_revisao_hash_enviada",
        ),
    )

    id_lancamento_revisao: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_lancamento: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_lancamento.id_lancamento",
            name="fk_op_logistica_lancamento_revisao_lancamento",
        ),
        nullable=False,
    )
    codigo_revisao: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    id_formulario_versao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_formulario_versao.id_formulario_versao",
            name="fk_op_logistica_lancamento_revisao_formulario",
        ),
        nullable=False,
    )
    numero_revisao: Mapped[int] = mapped_column(Integer, nullable=False)
    chave_idempotencia: Mapped[str] = mapped_column(
        CHAR(36), nullable=False, unique=True
    )
    estado: Mapped[str] = mapped_column(String(24), nullable=False)
    hash_conteudo: Mapped[str | None] = mapped_column(CHAR(64), nullable=True)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_lancamento_revisao_criador",
        ),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    enviado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_lancamento_revisao_enviador",
        ),
        nullable=True,
    )
    enviado_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    aprovado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_lancamento_revisao_aprovador",
        ),
        nullable=True,
    )
    aprovado_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    devolvido_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_lancamento_revisao_devolvedor",
        ),
        nullable=True,
    )
    devolvido_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LancamentoEvento(Base):
    __tablename__ = "op_logistica_lancamento_evento"
    __table_args__ = (
        ForeignKeyConstraint(
            ["id_lancamento", "id_lancamento_revisao"],
            [
                "op_logistica_lancamento_revisao.id_lancamento",
                "op_logistica_lancamento_revisao.id_lancamento_revisao",
            ],
            name="fk_op_logistica_evento_revisao_lancamento",
        ),
        Index(
            "ix_op_logistica_evento_lancamento_data",
            "id_lancamento",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_evento_revisao",
            "id_lancamento",
            "id_lancamento_revisao",
        ),
        Index(
            "ix_op_logistica_evento_ator_data",
            "ator_usuario_id",
            "ocorrido_em",
        ),
        CheckConstraint(
            "estado_anterior is null or estado_anterior in "
            "('RASCUNHO', 'ENVIADA', 'EM_REVISAO', 'DEVOLVIDA', "
            "'APROVADA', 'CANCELADA')",
            name="ck_op_logistica_evento_estado_anterior",
        ),
        CheckConstraint(
            "estado_novo is null or estado_novo in "
            "('RASCUNHO', 'ENVIADA', 'EM_REVISAO', 'DEVOLVIDA', "
            "'APROVADA', 'CANCELADA')",
            name="ck_op_logistica_evento_estado_novo",
        ),
    )

    id_evento: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_lancamento: Mapped[int] = mapped_column(BigInteger, nullable=False)
    id_lancamento_revisao: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chave_idempotencia: Mapped[str] = mapped_column(
        CHAR(36), nullable=False, unique=True
    )
    tipo_evento: Mapped[str] = mapped_column(String(30), nullable=False)
    estado_anterior: Mapped[str | None] = mapped_column(String(24), nullable=True)
    estado_novo: Mapped[str | None] = mapped_column(String(24), nullable=True)
    ator_usuario_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_evento_ator",
        ),
        nullable=False,
    )
    ocorrido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    comentario: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    campos_alterados: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True
    )


class EntregaDiaria(Base):
    __tablename__ = "op_logistica_entrega_diaria"
    __table_args__ = (
        UniqueConstraint(
            "id_lancamento_revisao",
            "codigo_item_lancamento",
            name="uq_op_logistica_entrega_revisao_item",
        ),
        UniqueConstraint(
            "id_entrega_diaria",
            "id_lancamento_revisao",
            "id_localidade",
            name="uq_op_logistica_entrega_revisao_localidade",
        ),
        Index(
            "ix_op_logistica_entrega_localidade_data",
            "id_localidade",
            "data_entrega",
        ),
        Index(
            "ix_op_logistica_entrega_revisao_data",
            "id_lancamento_revisao",
            "data_entrega",
        ),
        CheckConstraint(
            "quantidade_realizada >= 0 and quantidade_nao_realizada >= 0 "
            "and (quantidade_realizada > 0 or quantidade_nao_realizada > 0)",
            name="ck_op_logistica_entrega_quantidades",
        ),
        CheckConstraint(
            "tipo_operacao in ('ENTREGA', 'COLETA')",
            name="ck_op_logistica_entrega_tipo_operacao",
        ),
        CheckConstraint(
            "(quantidade_entregas_no_prazo is null and "
            "quantidade_entregas_completas is null) or "
            "(quantidade_entregas_no_prazo is not null and "
            "quantidade_entregas_completas is not null and "
            "quantidade_entregas_no_prazo >= 0 and "
            "quantidade_entregas_completas >= 0 and "
            "quantidade_entregas_no_prazo <= quantidade_realizada and "
            "quantidade_entregas_completas <= quantidade_realizada)",
            name="ck_op_logistica_entrega_otif_quantidades",
        ),
    )

    id_entrega_diaria: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_lancamento_revisao: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_lancamento_revisao.id_lancamento_revisao",
            name="fk_op_logistica_entrega_revisao",
        ),
        nullable=False,
    )
    codigo_item_lancamento: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    tipo_operacao: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ENTREGA", server_default="ENTREGA"
    )
    data_entrega: Mapped[date] = mapped_column(Date, nullable=False)
    id_localidade: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_localidade.id_localidade",
            name="fk_op_logistica_entrega_localidade",
        ),
        nullable=False,
    )
    quantidade_realizada: Mapped[int] = mapped_column(Integer, nullable=False)
    quantidade_nao_realizada: Mapped[int] = mapped_column(Integer, nullable=False)
    # Legacy columns retained for database compatibility; the API and OTIF ignore them.
    quantidade_entregas_no_prazo: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    quantidade_entregas_completas: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    observacao: Mapped[str | None] = mapped_column(Text, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class EntregaParticipante(Base):
    __tablename__ = "op_logistica_entrega_participante"
    __table_args__ = (
        UniqueConstraint(
            "id_entrega_diaria",
            "papel_participante",
            "ordem",
            name="uq_op_logistica_entrega_papel_ordem",
        ),
        Index(
            "ix_op_logistica_entrega_participante_pessoa",
            "id_pessoa",
        ),
        CheckConstraint(
            "papel_participante in ('MOTORISTA', 'AJUDANTE')",
            name="ck_op_logistica_entrega_papel",
        ),
        CheckConstraint("ordem > 0", name="ck_op_logistica_entrega_participante_ordem"),
    )

    id_entrega_diaria: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_entrega_diaria.id_entrega_diaria",
            name="fk_op_logistica_entrega_participante_entrega",
        ),
        primary_key=True,
    )
    id_pessoa: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_pessoa.id_pessoa",
            name="fk_op_logistica_entrega_participante_pessoa",
        ),
        primary_key=True,
    )
    papel_participante: Mapped[str] = mapped_column(String(20), nullable=False)
    ordem: Mapped[int] = mapped_column(SmallInteger, nullable=False)


class EntregaMotivo(Base):
    __tablename__ = "op_logistica_entrega_motivo"
    __table_args__ = (
        Index(
            "ix_op_logistica_entrega_motivo_motivo",
            "id_motivo_nao_entrega",
        ),
        CheckConstraint(
            "quantidade > 0",
            name="ck_op_logistica_entrega_motivo_quantidade",
        ),
    )

    id_entrega_motivo: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_entrega_diaria: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_entrega_diaria.id_entrega_diaria",
            name="fk_op_logistica_entrega_motivo_entrega",
        ),
        nullable=False,
    )
    id_motivo_nao_entrega: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_motivo_nao_entrega.id_motivo_nao_entrega",
            name="fk_op_logistica_entrega_motivo_motivo",
        ),
        nullable=False,
    )
    quantidade: Mapped[int] = mapped_column(Integer, nullable=False)
    observacao: Mapped[str | None] = mapped_column(Text, nullable=True)
