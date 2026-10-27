"""Consultas de persistência de rascunhos e histórico de Entregas."""

from datetime import date, datetime
from typing import Any, TypeAlias
from uuid import UUID

from sqlalchemy import and_, exists, false, func, not_, or_, select, true
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.modules.access_control.models import AutorizacaoEvento
from app.modules.catalogs.models import (
    Localidade,
    MotivoNaoEntrega,
    Pessoa,
    Setor,
)
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    FormularioVersao,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)

ScopePair: TypeAlias = tuple[int | None, int | None]
LaunchRevisionRow: TypeAlias = tuple[Lancamento, LancamentoRevisao, Setor]


def get_active_sector(db: Session, *, id_setor: int) -> Setor | None:
    statement = select(Setor).where(
        Setor.id_setor == id_setor,
        Setor.ativo.is_(True),
    )
    return db.scalar(statement)


def get_active_sector_by_code(db: Session, *, codigo: str) -> Setor | None:
    statement = select(Setor).where(
        Setor.codigo == codigo,
        Setor.ativo.is_(True),
    )
    return db.scalar(statement)


def get_active_localities(
    db: Session,
    *,
    id_localidades: set[int],
) -> list[Localidade]:
    if not id_localidades:
        return []
    statement = select(Localidade).where(
        Localidade.id_localidade.in_(id_localidades),
        Localidade.ativo.is_(True),
    )
    return list(db.scalars(statement).all())


def get_people_by_ids(db: Session, *, id_pessoas: set[int]) -> list[Pessoa]:
    if not id_pessoas:
        return []
    statement = select(Pessoa).where(Pessoa.id_pessoa.in_(id_pessoas))
    return list(db.scalars(statement).all())


def get_reasons_by_ids(
    db: Session,
    *,
    id_motivos: set[int],
) -> list[MotivoNaoEntrega]:
    if not id_motivos:
        return []
    statement = select(MotivoNaoEntrega).where(
        MotivoNaoEntrega.id_motivo_nao_entrega.in_(id_motivos)
    )
    return list(db.scalars(statement).all())


def get_current_published_form(
    db: Session,
    *,
    id_setor: int,
    agora: datetime,
) -> FormularioVersao | None:
    statement = (
        select(FormularioVersao)
        .where(
            FormularioVersao.id_setor == id_setor,
            FormularioVersao.codigo_formulario == "ENTREGAS_DIARIAS",
            FormularioVersao.status == "PUBLICADO",
            FormularioVersao.vigente_desde <= agora,
            or_(FormularioVersao.vigente_ate.is_(None), FormularioVersao.vigente_ate > agora),
        )
        .order_by(FormularioVersao.versao.desc())
        .limit(1)
    )
    return db.scalar(statement)


def get_launch_by_idempotency_key(
    db: Session,
    *,
    idempotency_key: UUID,
) -> Lancamento | None:
    statement = select(Lancamento).where(
        Lancamento.chave_idempotencia == str(idempotency_key)
    )
    return db.scalar(statement)


def get_launch_event_by_idempotency_key(
    db: Session,
    *,
    idempotency_key: UUID,
) -> LancamentoEvento | None:
    statement = select(LancamentoEvento).where(
        LancamentoEvento.chave_idempotencia == str(idempotency_key)
    )
    return db.scalar(statement)


def get_latest_revision(
    db: Session,
    *,
    id_lancamento: int,
    lock: bool = False,
) -> LancamentoRevisao | None:
    statement = (
        select(LancamentoRevisao)
        .where(LancamentoRevisao.id_lancamento == id_lancamento)
        .order_by(LancamentoRevisao.numero_revisao.desc())
        .limit(1)
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement)


def get_revision_for_launch(
    db: Session,
    *,
    id_lancamento: int,
    id_lancamento_revisao: int,
) -> tuple[LancamentoRevisao, Setor] | None:
    statement = (
        select(LancamentoRevisao, Setor)
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(Setor, Setor.id_setor == Lancamento.id_setor)
        .where(
            LancamentoRevisao.id_lancamento == id_lancamento,
            LancamentoRevisao.id_lancamento_revisao == id_lancamento_revisao,
        )
    )
    row = db.execute(statement).one_or_none()
    return (row[0], row[1]) if row is not None else None


def get_latest_confirmed_revision(
    db: Session,
    *,
    id_lancamento: int,
    before_revision: int | None = None,
) -> LancamentoRevisao | None:
    statement = select(LancamentoRevisao).where(
        LancamentoRevisao.id_lancamento == id_lancamento,
        LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")),
    )
    if before_revision is not None:
        statement = statement.where(
            LancamentoRevisao.numero_revisao < before_revision
        )
    statement = statement.order_by(LancamentoRevisao.numero_revisao.desc()).limit(1)
    return db.scalar(statement)


def list_launch_events(
    db: Session,
    *,
    id_lancamento: int,
) -> list[tuple[LancamentoEvento, LancamentoRevisao]]:
    statement = (
        select(LancamentoEvento, LancamentoRevisao)
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == LancamentoEvento.id_lancamento_revisao,
        )
        .where(LancamentoEvento.id_lancamento == id_lancamento)
        .order_by(LancamentoEvento.ocorrido_em, LancamentoEvento.id_evento)
    )
    return list(db.execute(statement).all())


def get_launch_by_code(
    db: Session,
    *,
    codigo_lancamento: UUID,
    lock: bool = False,
) -> Lancamento | None:
    statement = select(Lancamento).where(
        Lancamento.codigo_lancamento == str(codigo_lancamento)
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement)


def _scope_row_condition(
    scope_pairs: tuple[ScopePair, ...],
) -> ColumnElement[bool]:
    predicates = []
    for id_setor, id_localidade in scope_pairs:
        parts = []
        if id_setor is not None:
            parts.append(Lancamento.id_setor == id_setor)
        if id_localidade is not None:
            parts.append(EntregaDiaria.id_localidade == id_localidade)
        predicates.append(and_(*parts) if parts else true())
    if not predicates:
        return false()
    return or_(*predicates)


def _all_items_visible_condition(
    scope_pairs: tuple[ScopePair, ...],
    *,
    revision: Any,
) -> ColumnElement[bool]:
    row_scope = _scope_row_condition(scope_pairs)
    has_hidden_item = exists(
        select(EntregaDiaria.id_entrega_diaria).where(
            EntregaDiaria.id_lancamento_revisao == revision.id_lancamento_revisao,
            not_(row_scope),
        )
    )
    return not_(has_hidden_item)


def _latest_revision_number():
    return (
        select(func.max(LancamentoRevisao.numero_revisao))
        .where(LancamentoRevisao.id_lancamento == Lancamento.id_lancamento)
        .correlate(Lancamento)
        .scalar_subquery()
    )


def get_visible_launch(
    db: Session,
    *,
    codigo_lancamento: UUID,
    scope_pairs: tuple[ScopePair, ...],
    lock: bool = False,
) -> LaunchRevisionRow | None:
    current_revision = aliased(LancamentoRevisao)
    statement = (
        select(Lancamento, current_revision, Setor)
        .join(current_revision, current_revision.id_lancamento == Lancamento.id_lancamento)
        .join(Setor, Setor.id_setor == Lancamento.id_setor)
        .where(
            Lancamento.codigo_lancamento == str(codigo_lancamento),
            current_revision.numero_revisao == _latest_revision_number(),
            _all_items_visible_condition(scope_pairs, revision=current_revision),
        )
    )
    if lock:
        statement = statement.with_for_update()
    row = db.execute(statement).one_or_none()
    return (row[0], row[1], row[2]) if row is not None else None


def list_visible_launches(
    db: Session,
    *,
    scope_pairs: tuple[ScopePair, ...],
    estado: str | None,
    data_de: date | None,
    data_ate: date | None,
    id_localidade: int | None,
    criado_por: int | None,
    limit: int,
    offset: int,
) -> tuple[list[LaunchRevisionRow], int]:
    current_revision = aliased(LancamentoRevisao)
    conditions: list[ColumnElement[bool]] = [
        current_revision.numero_revisao == _latest_revision_number(),
        _all_items_visible_condition(scope_pairs, revision=current_revision),
    ]
    if estado is not None:
        conditions.append(current_revision.estado == estado)
    if criado_por is not None:
        conditions.append(Lancamento.criado_por == criado_por)

    item_conditions = [
        EntregaDiaria.id_lancamento_revisao == current_revision.id_lancamento_revisao
    ]
    if data_de is not None:
        item_conditions.append(EntregaDiaria.data_entrega >= data_de)
    if data_ate is not None:
        item_conditions.append(EntregaDiaria.data_entrega <= data_ate)
    if id_localidade is not None:
        item_conditions.append(EntregaDiaria.id_localidade == id_localidade)
    if len(item_conditions) > 1:
        conditions.append(
            exists(select(EntregaDiaria.id_entrega_diaria).where(*item_conditions))
        )

    total_statement = (
        select(func.count(func.distinct(Lancamento.id_lancamento)))
        .select_from(Lancamento)
        .join(current_revision, current_revision.id_lancamento == Lancamento.id_lancamento)
        .where(*conditions)
    )
    total = db.scalar(total_statement) or 0
    statement = (
        select(Lancamento, current_revision, Setor)
        .join(current_revision, current_revision.id_lancamento == Lancamento.id_lancamento)
        .join(Setor, Setor.id_setor == Lancamento.id_setor)
        .where(*conditions)
        .order_by(Lancamento.criado_em.desc(), Lancamento.id_lancamento.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(statement).all()
    return [(row[0], row[1], row[2]) for row in rows], total


def list_delivery_rows(
    db: Session,
    *,
    id_revisoes: set[int],
) -> list[tuple[EntregaDiaria, Localidade]]:
    if not id_revisoes:
        return []
    statement = (
        select(EntregaDiaria, Localidade)
        .join(Localidade, Localidade.id_localidade == EntregaDiaria.id_localidade)
        .where(EntregaDiaria.id_lancamento_revisao.in_(id_revisoes))
        .order_by(
            EntregaDiaria.data_entrega,
            Localidade.nome_localidade,
            EntregaDiaria.id_entrega_diaria,
        )
    )
    return list(db.execute(statement).all())


def list_participant_rows(
    db: Session,
    *,
    id_entregas: set[int],
) -> list[tuple[EntregaParticipante, Pessoa]]:
    if not id_entregas:
        return []
    statement = (
        select(EntregaParticipante, Pessoa)
        .join(Pessoa, Pessoa.id_pessoa == EntregaParticipante.id_pessoa)
        .where(EntregaParticipante.id_entrega_diaria.in_(id_entregas))
        .order_by(
            EntregaParticipante.id_entrega_diaria,
            EntregaParticipante.papel_participante,
            EntregaParticipante.ordem,
        )
    )
    return list(db.execute(statement).all())


def list_reason_rows(
    db: Session,
    *,
    id_entregas: set[int],
) -> list[tuple[EntregaMotivo, MotivoNaoEntrega]]:
    if not id_entregas:
        return []
    statement = (
        select(EntregaMotivo, MotivoNaoEntrega)
        .join(
            MotivoNaoEntrega,
            MotivoNaoEntrega.id_motivo_nao_entrega
            == EntregaMotivo.id_motivo_nao_entrega,
        )
        .where(EntregaMotivo.id_entrega_diaria.in_(id_entregas))
        .order_by(
            EntregaMotivo.id_entrega_diaria,
            EntregaMotivo.id_entrega_motivo,
        )
    )
    return list(db.execute(statement).all())
