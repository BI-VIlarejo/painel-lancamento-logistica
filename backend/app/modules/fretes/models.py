"""Modelos operacionais de lançamentos de frete."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm import Base


class Frete(Base):
    """Linha operacional do controle, com dados e resultado do cálculo.

    `detalhe_calculo` guarda a memória dos parâmetros e da versão da tarifa
    aplicada. Valores financeiros ficam nulos quando a linha exige conferência.
    """

    __tablename__ = "op_logistica_frete"
    __table_args__ = (
        CheckConstraint(
            "codigo_fonte_tarifa is null or codigo_fonte_tarifa in "
            "('AGREGADOS_CD', 'JUST_IN_TIME', 'PAULO_CRUZ')",
            name="ck_op_logistica_frete_fonte_tarifa",
        ),
        CheckConstraint(
            "tipo_transporte in ('PROPRIO', 'AGREGADO', 'TRANSPORTADORA')",
            name="ck_op_logistica_frete_tipo_transporte",
        ),
        CheckConstraint(
            "(tipo_transporte = 'PROPRIO' and codigo_fonte_tarifa is null "
            "and nome_transportador is not null) or "
            "(tipo_transporte = 'AGREGADO' and codigo_fonte_tarifa = 'AGREGADOS_CD') or "
            "(tipo_transporte = 'TRANSPORTADORA' "
            "and codigo_fonte_tarifa in ('JUST_IN_TIME', 'PAULO_CRUZ') "
            "and nome_transportador is not null)",
            name="ck_op_logistica_frete_modalidade_campos",
        ),
        CheckConstraint(
            "tipo_transporte = 'AGREGADO' or id_motorista_agregado is null",
            name="ck_op_logistica_frete_motorista_agregado",
        ),
        CheckConstraint(
            "(id_motorista_transportadora is null and nome_motorista_transportadora is null) or "
            "(tipo_transporte = 'TRANSPORTADORA' and "
            "id_motorista_transportadora is not null and "
            "nome_motorista_transportadora is not null)",
            name="ck_op_logistica_frete_motorista_transportadora",
        ),
        CheckConstraint(
            "status_calculo in ('CALCULADO', 'PENDENTE_CONFERENCIA')",
            name="ck_op_logistica_frete_status_calculo",
        ),
        CheckConstraint("quantidade_entregas >= 0", name="ck_op_logistica_frete_entregas"),
        CheckConstraint("peso_kg >= 0", name="ck_op_logistica_frete_peso"),
        CheckConstraint(
            "valor_avaria >= 0",
            name="ck_op_logistica_frete_avaria",
        ),
        CheckConstraint(
            "quantidade_avarias >= 0",
            name="ck_op_logistica_frete_quantidade_avarias",
        ),
        CheckConstraint(
            "(tipo_transporte = 'TRANSPORTADORA' and km_inicial is null "
            "and km_final is null and km_rodado is null) or "
            "(tipo_transporte = 'AGREGADO' and "
            "(km_inicial is null or km_inicial >= 0) and "
            "(km_final is null or km_final >= 0) and "
            "(km_rodado is null or km_rodado >= 0) and "
            "(km_inicial is null or km_final is null or "
            "(km_rodado is not null and km_final >= km_inicial "
            "and km_rodado = km_final - km_inicial))) or "
            "(km_inicial is not null and km_final is not null and km_rodado is not null "
            "and km_final >= km_inicial and km_rodado = km_final - km_inicial)",
            name="ck_op_logistica_frete_hodometros",
        ),
        Index("ix_op_logistica_frete_setor_data", "id_setor", "data_servico"),
        Index(
            "ix_op_logistica_frete_setor_data_id",
            "id_setor",
            "data_servico",
            "id_frete",
        ),
        Index("ix_op_logistica_frete_tipo_data", "tipo_transporte", "data_servico"),
        Index("ix_op_logistica_frete_status_data", "status_calculo", "data_servico"),
        Index(
            "ix_op_logistica_frete_motorista_data",
            "id_motorista_agregado",
            "data_servico",
        ),
        Index(
            "ix_op_logistica_frete_motorista_transportadora_data",
            "id_motorista_transportadora",
            "data_servico",
        ),
    )

    id_frete: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    codigo_frete: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    chave_idempotencia: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    id_setor: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_frete_setor"),
        nullable=False,
    )
    tipo_transporte: Mapped[str] = mapped_column(String(24), nullable=False)
    nome_transportador: Mapped[str | None] = mapped_column(String(160), nullable=True)
    id_motorista_agregado: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_pessoa.id_pessoa",
            name="fk_op_logistica_frete_motorista_agregado",
        ),
        nullable=True,
    )
    id_motorista_transportadora: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_pessoa.id_pessoa",
            name="fk_op_logistica_frete_motorista_transportadora",
        ),
        nullable=True,
    )
    nome_motorista_transportadora: Mapped[str | None] = mapped_column(
        String(160), nullable=True
    )
    codigo_fonte_tarifa: Mapped[str | None] = mapped_column(String(32), nullable=True)
    data_servico: Mapped[date] = mapped_column(Date, nullable=False)
    rota_cidade: Mapped[str | None] = mapped_column(String(160), nullable=True)
    km_inicial: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    km_final: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    km_rodado: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    quantidade_entregas: Mapped[int | None] = mapped_column(Integer, nullable=True)
    peso_kg: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    valor_nota: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    tipo_caminhao: Mapped[str | None] = mapped_column(String(40), nullable=True)
    codigo_zona_jit: Mapped[str | None] = mapped_column(String(60), nullable=True)
    adicionais_jit: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    valor_frete_bruto: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    valor_avaria: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    quantidade_avarias: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    valor_frete_pago: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    percentual_frete: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    status_calculo: Mapped[str] = mapped_column(String(30), nullable=False)
    motivo_pendencia: Mapped[str | None] = mapped_column(String(500), nullable=True)
    detalhe_calculo: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_autor"),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class FreteEvento(Base):
    """Evento de auditoria anexado a um frete, com ator e instante da ação."""

    __tablename__ = "op_logistica_frete_evento"
    __table_args__ = (
        Index("ix_op_logistica_frete_evento_frete_data", "id_frete", "ocorrido_em"),
        Index("ix_op_logistica_frete_evento_ator_data", "id_usuario_ator", "ocorrido_em"),
        Index("ix_op_logistica_frete_evento_tipo_frete", "tipo_evento", "id_frete"),
    )

    id_frete_evento: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_frete: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_frete.id_frete", name="fk_op_logistica_frete_evento_frete"),
        nullable=False,
    )
    id_usuario_ator: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_frete_evento_ator",
        ),
        nullable=False,
    )
    tipo_evento: Mapped[str] = mapped_column(String(30), nullable=False)
    ocorrido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    detalhes: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)


class FretePagamento(Base):
    """Fechamento financeiro por responsável e período, com status e auditoria."""

    __tablename__ = "op_logistica_frete_pagamento"
    __table_args__ = (
        CheckConstraint(
            "tipo_transporte in ('AGREGADO', 'TRANSPORTADORA')",
            name="ck_op_logistica_frete_pag_tipo",
        ),
        CheckConstraint(
            "status_pagamento in ('SOLICITADO', 'PAGO', 'ESTORNADO')",
            name="ck_op_logistica_frete_pag_status",
        ),
        CheckConstraint(
            "data_ate >= data_de",
            name="ck_op_logistica_frete_pag_periodo",
        ),
        CheckConstraint(
            "quantidade_fretes >= 0 and quantidade_dias >= 0",
            name="ck_op_logistica_frete_pag_quantidades",
        ),
        Index(
            "ix_op_logistica_frete_pag_setor_periodo",
            "id_setor",
            "tipo_transporte",
            "data_de",
            "data_ate",
        ),
        Index(
            "ix_op_logistica_frete_pag_status_data",
            "id_setor",
            "status_pagamento",
            "data_pagamento",
        ),
        Index(
            "ix_op_logistica_frete_pag_responsavel",
            "id_setor",
            "tipo_transporte",
            "nome_transportador",
            "status_pagamento",
        ),
    )

    id_frete_pagamento: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    codigo_pagamento: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    id_setor: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_frete_pag_setor"),
        nullable=False,
    )
    tipo_transporte: Mapped[str] = mapped_column(String(24), nullable=False)
    nome_transportador: Mapped[str] = mapped_column(String(160), nullable=False)
    sem_identificacao: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    id_pessoa_responsavel: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_pessoa.id_pessoa", name="fk_op_logistica_frete_pag_pessoa"),
        nullable=True,
    )
    data_de: Mapped[date] = mapped_column(Date, nullable=False)
    data_ate: Mapped[date] = mapped_column(Date, nullable=False)
    status_pagamento: Mapped[str] = mapped_column(String(24), nullable=False)
    quantidade_fretes: Mapped[int] = mapped_column(Integer, nullable=False)
    quantidade_dias: Mapped[int] = mapped_column(Integer, nullable=False)
    valor_frete_bruto: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    valor_avarias: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    valor_ajustes: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    valor_liquido_registrado: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    data_pagamento: Mapped[date | None] = mapped_column(Date, nullable=True)
    nf_numero: Mapped[str | None] = mapped_column(String(60), nullable=True)
    nf_data: Mapped[date | None] = mapped_column(Date, nullable=True)
    nf_recebida: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    observacao: Mapped[str | None] = mapped_column(String(500), nullable=True)
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_pag_criador"),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    pago_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_pag_pagador"),
        nullable=True,
    )
    pago_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    estornado_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_pag_estorno"),
        nullable=True,
    )
    estornado_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    motivo_estorno: Mapped[str | None] = mapped_column(String(500), nullable=True)


class FretePagamentoItem(Base):
    """Vincula cada frete ao seu fechamento financeiro e impede pagamento duplicado."""

    __tablename__ = "op_logistica_frete_pagamento_item"
    __table_args__ = (
        Index("ix_op_logistica_frete_pag_item_pag", "id_frete_pagamento"),
        Index("ix_op_logistica_frete_pag_item_frete", "id_frete"),
        Index("uq_op_logistica_frete_pag_item_ativo", "id_frete_ativo", unique=True),
    )

    id_frete_pagamento_item: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    id_frete_pagamento: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_frete_pagamento.id_frete_pagamento",
            name="fk_op_logistica_frete_pag_item_pag",
        ),
        nullable=False,
    )
    id_frete: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_frete.id_frete", name="fk_op_logistica_frete_pag_item_frete"),
        nullable=False,
    )
    # Mantém o id_frete enquanto o fechamento está ativo; fica nulo ao estornar,
    # garantindo unicidade no banco contra pagamentos duplicados sem perder histórico.
    id_frete_ativo: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data_servico_snapshot: Mapped[date] = mapped_column(Date, nullable=False)
    valor_frete_bruto_snapshot: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 2), nullable=True
    )
    valor_avaria_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    valor_frete_pago_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class FreteAjusteFinanceiro(Base):
    """Lançamento extra de acréscimo ou desconto (vale, adiantamento, bônus, pedágio)."""

    __tablename__ = "op_logistica_frete_ajuste"
    __table_args__ = (
        CheckConstraint(
            "tipo_transporte in ('AGREGADO', 'TRANSPORTADORA')",
            name="ck_op_logistica_frete_ajuste_tipo",
        ),
        CheckConstraint(
            "natureza in ('ACRESCIMO', 'DESCONTO')",
            name="ck_op_logistica_frete_ajuste_natureza",
        ),
        CheckConstraint(
            "categoria in ('VALE', 'ADIANTAMENTO', 'BONUS', 'PEDAGIO', 'DESCONTO', 'OUTRO')",
            name="ck_op_logistica_frete_ajuste_categoria",
        ),
        CheckConstraint(
            "valor > 0",
            name="ck_op_logistica_frete_ajuste_valor",
        ),
        Index(
            "ix_op_logistica_frete_ajuste_setor_data",
            "id_setor",
            "tipo_transporte",
            "data_referencia",
            "ativo",
        ),
        Index("ix_op_logistica_frete_ajuste_pag", "id_frete_pagamento"),
    )

    id_frete_ajuste: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    codigo_ajuste: Mapped[str] = mapped_column(CHAR(36), nullable=False, unique=True)
    id_setor: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_frete_ajuste_setor"),
        nullable=False,
    )
    tipo_transporte: Mapped[str] = mapped_column(String(24), nullable=False)
    nome_transportador: Mapped[str] = mapped_column(String(160), nullable=False)
    id_pessoa_responsavel: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_pessoa.id_pessoa", name="fk_op_logistica_frete_ajuste_pessoa"),
        nullable=True,
    )
    data_referencia: Mapped[date] = mapped_column(Date, nullable=False)
    natureza: Mapped[str] = mapped_column(String(16), nullable=False)
    categoria: Mapped[str] = mapped_column(String(32), nullable=False)
    descricao: Mapped[str] = mapped_column(String(200), nullable=False)
    valor: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    observacao: Mapped[str | None] = mapped_column(String(500), nullable=True)
    id_frete_pagamento: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_frete_pagamento.id_frete_pagamento",
            name="fk_op_logistica_frete_ajuste_pag",
        ),
        nullable=True,
    )
    ativo: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    criado_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_ajuste_criador"),
        nullable=False,
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    removido_por: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_usuario.id_usuario", name="fk_op_logistica_frete_ajuste_rem"),
        nullable=True,
    )
    removido_em: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
