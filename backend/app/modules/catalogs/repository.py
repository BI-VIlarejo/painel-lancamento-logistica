"""Consultas paginadas dos catálogos operacionais de leitura."""

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor


def _locality_text_key(value: str) -> str:
    return " ".join(value.split()).casefold()


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


def get_locality_for_update(db: Session, *, id_localidade: int) -> Localidade | None:
    statement = (
        select(Localidade)
        .where(Localidade.id_localidade == id_localidade)
        .with_for_update()
    )
    return db.scalar(statement)


def locality_code_exists(
    db: Session,
    *,
    codigo_localidade: str,
    exclude_id: int | None = None,
) -> bool:
    statement = select(Localidade.id_localidade).where(
        Localidade.codigo_localidade == codigo_localidade
    )
    if exclude_id is not None:
        statement = statement.where(Localidade.id_localidade != exclude_id)
    return db.scalar(statement.limit(1)) is not None


def locality_name_city_uf_exists(
    db: Session,
    *,
    nome_localidade: str,
    cidade: str,
    uf: str,
    exclude_id: int | None = None,
) -> bool:
    statement = select(Localidade.nome_localidade, Localidade.cidade).where(
        Localidade.cidade.is_not(None),
        func.upper(func.trim(Localidade.uf)) == uf,
    )
    if exclude_id is not None:
        statement = statement.where(Localidade.id_localidade != exclude_id)
    normalized_name = _locality_text_key(nome_localidade)
    normalized_city = _locality_text_key(cidade)
    return any(
        _locality_text_key(stored_name) == normalized_name
        and _locality_text_key(stored_city) == normalized_city
        for stored_name, stored_city in db.execute(statement)
        if stored_name is not None and stored_city is not None
    )


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
