"""Modelos ORM de perfis, permissões, escopos e trilha de autorização."""

from __future__ import annotations
from datetime import datetime
from app.core.orm import Base
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

class Perfil(Base):
    __tablename__ = "op_logistica_perfil"

    id_perfil: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    codigo: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    nome: Mapped[str] = mapped_column(String(100), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)

class Recurso(Base):
    __tablename__ = "op_logistica_recurso"
    __table_args__ = (
        Index("ix_op_logistica_recurso_setor_ativo", "id_setor", "ativo"),
    )

    id_recurso: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    codigo: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    nome: Mapped[str] = mapped_column(String(100), nullable=False)
    id_setor: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_recurso_setor"),
        nullable=True,
    )
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)

class Permissao(Base):
    __tablename__ = "op_logistica_permissao"
    __table_args__ = (
        UniqueConstraint(
            "id_recurso",
            "acao",
            name="uq_op_logistica_permissao_recurso_acao",
        ),
    )

    id_permissao: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True
    )
    id_recurso: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_recurso.id_recurso", name="fk_op_logistica_permissao_recurso"),
        nullable=False,
    )
    acao: Mapped[str] = mapped_column(String(40), nullable=False)
    codigo: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    descricao: Mapped[str] = mapped_column(String(160), nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)

class PerfilPermissao(Base):
    __tablename__ = "op_logistica_perfil_permissao"
    __table_args__ = (
        Index(
            "ix_op_logistica_perfil_permissao_permissao",
            "id_permissao",
        ),
        Index(
            "ix_op_logistica_perfil_permissao_autor_data",
            "concedido_por",
            "concedido_em",
        ),
    )

    id_perfil: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_perfil.id_perfil", name="fk_op_logistica_perfil_permissao_perfil"),
        primary_key=True,
    )
    id_permissao: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "op_logistica_permissao.id_permissao",
            name="fk_op_logistica_perfil_permissao_permissao",
        ),
        primary_key=True,
    )
    concedido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    concedido_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_perfil_permissao_autor",
        ),
        nullable=False,
    )

class Escopo(Base):
    __tablename__ = "op_logistica_escopo"
    __table_args__ = (
        CheckConstraint(
            "tipo_escopo in ('GLOBAL', 'SETOR', 'LOCALIDADE', 'SETOR_LOCALIDADE')",
            name="ck_op_logistica_escopo_tipo",
        ),
        CheckConstraint(
            "((tipo_escopo = 'GLOBAL' and id_setor is null and id_localidade is null) "
            "or (tipo_escopo = 'SETOR' and id_setor is not null and id_localidade is null) "
            "or (tipo_escopo = 'LOCALIDADE' and id_setor is null and id_localidade is not null) "
            "or (tipo_escopo = 'SETOR_LOCALIDADE' and id_setor is not null "
            "and id_localidade is not null))",
            name="ck_op_logistica_escopo_alvo",
        ),
        Index("ix_op_logistica_escopo_setor", "id_setor"),
        Index("ix_op_logistica_escopo_localidade", "id_localidade"),
    )

    id_escopo: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    codigo_escopo: Mapped[str] = mapped_column(String(140), nullable=False, unique=True)
    tipo_escopo: Mapped[str] = mapped_column(String(24), nullable=False)
    id_setor: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("op_logistica_setor.id_setor", name="fk_op_logistica_escopo_setor"),
        nullable=True,
    )
    id_localidade: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_localidade.id_localidade",
            name="fk_op_logistica_escopo_localidade",
        ),
        nullable=True,
    )
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)

class UsuarioEscopo(Base):
    __tablename__ = "op_logistica_usuario_escopo"
    __table_args__ = (
        UniqueConstraint(
            "id_usuario",
            "id_perfil",
            "id_escopo",
            "vigente_desde",
            name="uq_op_logistica_usuario_escopo_inicio",
        ),
        Index(
            "ix_op_logistica_usuario_escopo_ativo",
            "id_usuario",
            "ativo",
            "vigente_ate",
        ),
        Index("ix_op_logistica_usuario_escopo_perfil", "id_perfil", "ativo"),
        Index(
            "ix_op_logistica_escopo_perfil_ativo",
            "id_escopo",
            "id_perfil",
            "ativo",
        ),
        Index(
            "ix_op_logistica_usuario_escopo_autor_data",
            "concedido_por",
            "concedido_em",
        ),
        CheckConstraint(
            "vigente_ate is null or vigente_ate > vigente_desde",
            name="ck_op_logistica_usuario_escopo_periodo",
        ),
    )

    id_usuario_escopo: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    id_usuario: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_usuario_escopo_usuario",
        ),
        nullable=False,
    )
    id_perfil: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("op_logistica_perfil.id_perfil", name="fk_op_logistica_usuario_escopo_perfil"),
        nullable=False,
    )
    id_escopo: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("op_logistica_escopo.id_escopo", name="fk_op_logistica_usuario_escopo_escopo"),
        nullable=False,
    )
    ativo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    vigente_desde: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    vigente_ate: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    concedido_por: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_usuario_escopo_autor",
        ),
        nullable=False,
    )
    concedido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)

class AutorizacaoEvento(Base):
    __tablename__ = "op_logistica_autorizacao_evento"
    __table_args__ = (
        Index(
            "ix_op_logistica_autorizacao_evento_tipo_data",
            "tipo_evento",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_autorizacao_evento_ator_data",
            "id_usuario_ator",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_autorizacao_evento_permissao_data",
            "id_perfil",
            "id_permissao",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_autorizacao_evento_permissao_fk",
            "id_permissao",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_autorizacao_evento_escopo_data",
            "id_usuario_escopo",
            "ocorrido_em",
        ),
        Index(
            "ix_op_logistica_autorizacao_evento_recurso_data",
            "id_recurso",
            "ocorrido_em",
        ),
        CheckConstraint(
            "tipo_evento in ('PERFIL_PERMISSAO_CONCEDIDA', "
            "'PERFIL_PERMISSAO_REVOGADA', 'USUARIO_ESCOPO_CONCEDIDO', "
            "'USUARIO_ESCOPO_REVOGADO', 'PERFIL_CRIADO', 'PERFIL_ATUALIZADO', "
            "'PERFIL_ATIVADO', 'PERFIL_DESATIVADO', 'RECURSO_CRIADO', "
            "'RECURSO_ATUALIZADO', 'RECURSO_ATIVADO', 'RECURSO_DESATIVADO', "
            "'PERMISSAO_CRIADA', 'PERMISSAO_ATUALIZADA', 'PERMISSAO_ATIVADA', "
            "'PERMISSAO_DESATIVADA', 'USUARIO_CRIADO', 'USUARIO_ATIVADO', "
            "'USUARIO_DESATIVADO', 'USUARIO_SENHA_ALTERADA', "
            "'LOCALIDADE_CRIADA', 'LOCALIDADE_ATIVADA', 'LOCALIDADE_DESATIVADA', "
            "'LOCALIDADES_SINCRONIZADAS_BI', "
            "'PESSOA_CRIADA', 'PESSOA_VERSIONADA', 'PESSOA_DESATIVADA', "
            "'MOTIVO_CRIADO', 'MOTIVO_VERSIONADO', 'MOTIVO_DESATIVADO')",
            name="ck_op_logistica_autorizacao_evento_tipo",
        ),
        CheckConstraint(
            "((tipo_evento in ('PERFIL_PERMISSAO_CONCEDIDA', "
            "'PERFIL_PERMISSAO_REVOGADA') and id_perfil is not null "
            "and id_permissao is not null and id_recurso is null "
            "and id_usuario_escopo is null) "
            "or (tipo_evento in ('USUARIO_ESCOPO_CONCEDIDO', "
            "'USUARIO_ESCOPO_REVOGADO') and id_perfil is null "
            "and id_permissao is null and id_recurso is null "
            "and id_usuario_escopo is not null) "
            "or (tipo_evento in ('PERFIL_CRIADO', 'PERFIL_ATUALIZADO', "
            "'PERFIL_ATIVADO', 'PERFIL_DESATIVADO') and id_perfil is not null "
            "and id_permissao is null and id_recurso is null "
            "and id_usuario_escopo is null) "
            "or (tipo_evento in ('RECURSO_CRIADO', 'RECURSO_ATUALIZADO', "
            "'RECURSO_ATIVADO', 'RECURSO_DESATIVADO') and id_perfil is null "
            "and id_permissao is null and id_recurso is not null "
            "and id_usuario_escopo is null) "
            "or (tipo_evento in ('PERMISSAO_CRIADA', 'PERMISSAO_ATUALIZADA', "
            "'PERMISSAO_ATIVADA', 'PERMISSAO_DESATIVADA') and id_perfil is null "
            "and id_permissao is not null and id_recurso is null "
            "and id_usuario_escopo is null) "
            "or (tipo_evento in ('USUARIO_CRIADO', 'USUARIO_ATIVADO', "
            "'USUARIO_DESATIVADO', 'USUARIO_SENHA_ALTERADA', "
            "'LOCALIDADE_CRIADA', 'LOCALIDADE_ATIVADA', 'LOCALIDADE_DESATIVADA', "
            "'LOCALIDADES_SINCRONIZADAS_BI', "
            "'PESSOA_CRIADA', 'PESSOA_VERSIONADA', 'PESSOA_DESATIVADA', "
            "'MOTIVO_CRIADO', 'MOTIVO_VERSIONADO', 'MOTIVO_DESATIVADO') "
            "and id_perfil is null and id_permissao is null and id_recurso is null "
            "and id_usuario_escopo is null))",
            name="ck_op_logistica_autorizacao_evento_alvo",
        ),
        CheckConstraint(
            "tipo_evento not in ('PERFIL_PERMISSAO_REVOGADA', "
            "'USUARIO_ESCOPO_REVOGADO') or "
            "(motivo is not null and length(trim(motivo)) > 0)",
            name="ck_op_logistica_autorizacao_evento_motivo_revogacao",
        ),
    )

    id_evento_autorizacao: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    tipo_evento: Mapped[str] = mapped_column(String(40), nullable=False)
    id_usuario_ator: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_autorizacao_evento_ator",
        ),
        nullable=False,
    )
    id_perfil: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "op_logistica_perfil.id_perfil",
            name="fk_op_logistica_autorizacao_evento_perfil",
        ),
        nullable=True,
    )
    id_permissao: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "op_logistica_permissao.id_permissao",
            name="fk_op_logistica_autorizacao_evento_permissao",
        ),
        nullable=True,
    )
    id_recurso: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "op_logistica_recurso.id_recurso",
            name="fk_op_logistica_autorizacao_evento_recurso",
        ),
        nullable=True,
    )
    id_usuario_escopo: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario_escopo.id_usuario_escopo",
            name="fk_op_logistica_autorizacao_evento_usuario_escopo",
        ),
        nullable=True,
    )
    ocorrido_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    motivo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    detalhes: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
