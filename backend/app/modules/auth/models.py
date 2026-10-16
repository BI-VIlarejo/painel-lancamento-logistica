"""Modelos ORM das contas locais e das credenciais do portal."""

from __future__ import annotations

from datetime import datetime

from app.core.orm import Base
from sqlalchemy import BigInteger, Boolean, CHAR, DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column


class Usuario(Base):
    __tablename__ = "op_logistica_usuario"

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


class UsuarioCredencial(Base):
    __tablename__ = "op_logistica_usuario_credencial"

    id_usuario: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_usuario_credencial_usuario",
        ),
        primary_key=True,
    )
    hash_senha: Mapped[str] = mapped_column(String(255), nullable=False)
    senha_alterada_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    troca_senha_obrigatoria: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("1")
    )
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class UsuarioIdentificacao(Base):
    """Identificação pessoal opcional, separada das credenciais de login."""

    __tablename__ = "op_logistica_usuario_identificacao"

    id_usuario: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "op_logistica_usuario.id_usuario",
            name="fk_op_logistica_usuario_identificacao_usuario",
        ),
        primary_key=True,
    )
    cpf: Mapped[str] = mapped_column(CHAR(11), nullable=False, unique=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, nullable=False)
