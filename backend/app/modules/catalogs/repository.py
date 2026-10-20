"""Consultas paginadas dos catálogos operacionais de leitura."""

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor


def list_sectors(
    db: Session,
    *,
    allowed_ids: set[int] | None,
    limit: int,
    offset: int,
) -> tuple[list[Setor], int]:
    conditions = [Setor.ativo.is_(True)]
    if allowed_ids is not None:
        if not allowed_ids:
            return [], 0
        conditions.append(Setor.id_setor.in_(allowed_ids))
    total = db.scalar(select(func.count()).select_from(Setor).where(*conditions)) or 0
    statement = (
        select(Setor)
        .where(*conditions)
        .order_by(Setor.nome, Setor.id_setor)
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement).all()), total


def list_localities(
    db: Session,
    *,
    allowed_ids: set[int] | None,
    limit: int,
    offset: int,
) -> tuple[list[Localidade], int]:
    conditions = [Localidade.ativo.is_(True)]
    if allowed_ids is not None:
        if not allowed_ids:
            return [], 0
        conditions.append(Localidade.id_localidade.in_(allowed_ids))
    total = (
        db.scalar(select(func.count()).select_from(Localidade).where(*conditions)) or 0
    )
    statement = (
        select(Localidade)
        .where(*conditions)
        .order_by(Localidade.nome_localidade, Localidade.id_localidade)
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement).all()), total


def list_people(
    db: Session,
    *,
    tipo_funcao: str | None,
    data_referencia: date,
    limit: int,
    offset: int,
) -> tuple[list[Pessoa], int]:
    conditions = [
        Pessoa.ativo.is_(True),
        Pessoa.vigente_desde <= data_referencia,
        or_(Pessoa.vigente_ate.is_(None), Pessoa.vigente_ate > data_referencia),
    ]
    if tipo_funcao is not None:
        conditions.append(Pessoa.tipo_funcao == tipo_funcao)
    total = db.scalar(select(func.count()).select_from(Pessoa).where(*conditions)) or 0
    statement = (
        select(Pessoa)
        .where(*conditions)
        .order_by(Pessoa.nome_exibicao, Pessoa.id_pessoa)
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement).all()), total


def list_non_delivery_reasons(
    db: Session,
    *,
    data_referencia: date,
    limit: int,
    offset: int,
) -> tuple[list[MotivoNaoEntrega], int]:
    conditions = [
        MotivoNaoEntrega.ativo.is_(True),
        MotivoNaoEntrega.vigente_desde <= data_referencia,
        or_(
            MotivoNaoEntrega.vigente_ate.is_(None),
            MotivoNaoEntrega.vigente_ate > data_referencia,
        ),
    ]
    total = (
        db.scalar(
            select(func.count()).select_from(MotivoNaoEntrega).where(*conditions)
        )
        or 0
    )
    statement = (
        select(MotivoNaoEntrega)
        .where(*conditions)
        .order_by(
            MotivoNaoEntrega.descricao_motivo,
            MotivoNaoEntrega.id_motivo_nao_entrega,
        )
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(statement).all()), total


def list_admin_localities(db: Session) -> list[Localidade]:
    statement = select(Localidade).order_by(
        Localidade.nome_localidade,
        Localidade.codigo_localidade,
    )
    return list(db.scalars(statement).all())


def list_admin_people(db: Session) -> list[Pessoa]:
    latest_ids = select(func.max(Pessoa.id_pessoa)).group_by(Pessoa.codigo_pessoa)
    statement = select(Pessoa).where(Pessoa.id_pessoa.in_(latest_ids)).order_by(
        Pessoa.nome_exibicao,
        Pessoa.codigo_pessoa,
    )
    return list(db.scalars(statement).all())


def get_person_for_update(db: Session, *, id_pessoa: int) -> Pessoa | None:
    statement = select(Pessoa).where(Pessoa.id_pessoa == id_pessoa).with_for_update()
    return db.scalar(statement)


def get_latest_person_for_update(db: Session, *, codigo_pessoa: str) -> Pessoa | None:
    statement = (
        select(Pessoa)
        .where(Pessoa.codigo_pessoa == codigo_pessoa)
        .order_by(Pessoa.id_pessoa.desc())
        .limit(1)
        .with_for_update()
    )
    return db.scalar(statement)


def list_admin_non_delivery_reasons(db: Session) -> list[MotivoNaoEntrega]:
    latest_ids = select(func.max(MotivoNaoEntrega.id_motivo_nao_entrega)).group_by(
        MotivoNaoEntrega.codigo_motivo
    )
    statement = (
        select(MotivoNaoEntrega)
        .where(MotivoNaoEntrega.id_motivo_nao_entrega.in_(latest_ids))
        .order_by(
            MotivoNaoEntrega.descricao_motivo,
            MotivoNaoEntrega.codigo_motivo,
        )
    )
    return list(db.scalars(statement).all())


def get_latest_reason_for_update(
    db: Session,
    *,
    codigo_motivo: str,
) -> MotivoNaoEntrega | None:
    statement = (
        select(MotivoNaoEntrega)
        .where(MotivoNaoEntrega.codigo_motivo == codigo_motivo)
        .order_by(MotivoNaoEntrega.id_motivo_nao_entrega.desc())
        .limit(1)
        .with_for_update()
    )
    return db.scalar(statement)


def get_reason_for_update(
    db: Session,
    *,
    id_motivo_nao_entrega: int,
) -> MotivoNaoEntrega | None:
    statement = (
        select(MotivoNaoEntrega)
        .where(MotivoNaoEntrega.id_motivo_nao_entrega == id_motivo_nao_entrega)
        .with_for_update()
    )
    return db.scalar(statement)
