"""Persistência e consultas de feedback com filtragem de escopo no SQL."""

from datetime import date
from typing import Any, TypeAlias
from uuid import UUID

from sqlalchemy import and_, case, exists, false, func, not_, or_, select, true
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.modules.catalogs.models import Localidade, Pessoa
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaParticipante,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)
from app.modules.feedback.models import Feedback

ScopePair: TypeAlias = tuple[int | None, int | None]
DeliveryItemRow: TypeAlias = tuple[Lancamento, LancamentoRevisao, EntregaDiaria, Localidade]
FeedbackRow: TypeAlias = tuple[
    Feedback,
    Lancamento,
    LancamentoRevisao,
    EntregaDiaria,
    Localidade,
]


def _scope_condition(scope_pairs: tuple[ScopePair, ...]) -> ColumnElement[bool]:
    alternatives = []
    for id_setor, id_localidade in scope_pairs:
        predicates = []
        if id_setor is not None:
            predicates.append(Lancamento.id_setor == id_setor)
        if id_localidade is not None:
            predicates.append(EntregaDiaria.id_localidade == id_localidade)
        alternatives.append(and_(*predicates) if predicates else true())
    return or_(*alternatives) if alternatives else false()


def _latest_confirmed_revision_number() -> Any:
    return (
        select(func.max(LancamentoRevisao.numero_revisao))
        .where(
            LancamentoRevisao.id_lancamento == Lancamento.id_lancamento,
            LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")),
        )
        .correlate(Lancamento)
        .scalar_subquery()
    )


def _not_cancelled_condition() -> ColumnElement[bool]:
    return not_(
        exists(
            select(LancamentoEvento.id_evento).where(
                LancamentoEvento.id_lancamento == Lancamento.id_lancamento,
                LancamentoEvento.tipo_evento == "LANCAMENTO_CANCELADO",
            )
        )
    )


def _delivery_statement():
    return (
        select(Lancamento, LancamentoRevisao, EntregaDiaria, Localidade)
        .select_from(EntregaDiaria)
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == EntregaDiaria.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(Localidade, Localidade.id_localidade == EntregaDiaria.id_localidade)
        .where(
            LancamentoRevisao.numero_revisao == _latest_confirmed_revision_number(),
            LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")),
            _not_cancelled_condition(),
        )
    )


def list_delivery_items(
    db: Session,
    *,
    data_entrega: date,
    id_localidade: int,
    scope_pairs: tuple[ScopePair, ...],
) -> list[DeliveryItemRow]:
    statement = (
        _delivery_statement()
        .where(
            EntregaDiaria.data_entrega == data_entrega,
            EntregaDiaria.id_localidade == id_localidade,
            Localidade.ativo.is_(True),
            _scope_condition(scope_pairs),
        )
        .order_by(Lancamento.criado_em.desc(), EntregaDiaria.id_entrega_diaria)
    )
    return list(db.execute(statement).all())


def list_localities(
    db: Session,
    *,
    scope_pairs: tuple[ScopePair, ...],
) -> list[tuple[int, str]]:
    if not scope_pairs:
        return []
    has_unrestricted_locality_scope = any(
        id_localidade is None for _id_setor, id_localidade in scope_pairs
    )
    allowed_localities = {
        id_localidade
        for _id_setor, id_localidade in scope_pairs
        if id_localidade is not None
    }
    if not has_unrestricted_locality_scope and not allowed_localities:
        return []

    statement = select(Localidade.id_localidade, Localidade.nome_localidade).where(
        Localidade.ativo.is_(True)
    )
    if not has_unrestricted_locality_scope:
        statement = statement.where(Localidade.id_localidade.in_(allowed_localities))
    statement = statement.order_by(Localidade.nome_localidade)
    return [(row.id_localidade, row.nome_localidade) for row in db.execute(statement)]


def get_delivery_item(
    db: Session,
    *,
    codigo_lancamento: UUID,
    codigo_revisao: UUID,
    codigo_item_lancamento: UUID,
) -> DeliveryItemRow | None:
    statement = _delivery_statement().where(
        Lancamento.codigo_lancamento == str(codigo_lancamento),
        LancamentoRevisao.codigo_revisao == str(codigo_revisao),
        EntregaDiaria.codigo_item_lancamento == str(codigo_item_lancamento),
        Localidade.ativo.is_(True),
    )
    row = db.execute(statement).one_or_none()
    return tuple(row) if row is not None else None


def get_feedback_by_idempotency_key(
    db: Session,
    *,
    idempotency_key: UUID,
) -> Feedback | None:
    return db.scalar(
        select(Feedback).where(Feedback.chave_idempotencia == str(idempotency_key))
    )


def get_feedback_by_id(db: Session, *, id_feedback: int) -> FeedbackRow | None:
    statement = (
        select(
            Feedback,
            Lancamento,
            LancamentoRevisao,
            EntregaDiaria,
            Localidade,
        )
        .join(
            EntregaDiaria,
            and_(
                EntregaDiaria.id_entrega_diaria == Feedback.id_entrega_diaria,
                EntregaDiaria.id_lancamento_revisao == Feedback.id_lancamento_revisao,
                EntregaDiaria.codigo_item_lancamento == Feedback.codigo_item_lancamento,
                EntregaDiaria.id_localidade == Feedback.id_localidade,
            ),
        )
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == Feedback.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(Localidade, Localidade.id_localidade == Feedback.id_localidade)
        .where(Feedback.id_feedback == id_feedback)
    )
    row = db.execute(statement).one_or_none()
    return tuple(row) if row is not None else None


def list_delivery_participants(
    db: Session,
    *,
    id_entrega_ids: set[int],
) -> dict[int, list[tuple[int, str, str]]]:
    if not id_entrega_ids:
        return {}
    rows = db.execute(
        select(
            EntregaParticipante.id_entrega_diaria,
            EntregaParticipante.id_pessoa,
            Pessoa.nome_exibicao,
            EntregaParticipante.papel_participante,
        )
        .join(Pessoa, Pessoa.id_pessoa == EntregaParticipante.id_pessoa)
        .where(EntregaParticipante.id_entrega_diaria.in_(id_entrega_ids))
        .order_by(
            EntregaParticipante.id_entrega_diaria,
            case((EntregaParticipante.papel_participante == "MOTORISTA", 0), else_=1),
            EntregaParticipante.ordem,
        )
    ).all()
    result: dict[int, list[tuple[int, str, str]]] = {}
    for row in rows:
        result.setdefault(row.id_entrega_diaria, []).append(
            (row.id_pessoa, row.nome_exibicao, row.papel_participante)
        )
    return result


def list_feedbacks(
    db: Session,
    *,
    scope_pairs: tuple[ScopePair, ...],
    query: str | None,
    tipo: str | None,
    id_localidade: int | None,
    data_de: date | None,
    data_ate: date | None,
    limit: int,
    offset: int,
) -> tuple[list[FeedbackRow], int]:
    statement = (
        select(
            Feedback,
            Lancamento,
            LancamentoRevisao,
            EntregaDiaria,
            Localidade,
        )
        .select_from(Feedback)
        .join(
            EntregaDiaria,
            and_(
                EntregaDiaria.id_entrega_diaria == Feedback.id_entrega_diaria,
                EntregaDiaria.id_lancamento_revisao == Feedback.id_lancamento_revisao,
                EntregaDiaria.codigo_item_lancamento == Feedback.codigo_item_lancamento,
                EntregaDiaria.id_localidade == Feedback.id_localidade,
            ),
        )
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == Feedback.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(Localidade, Localidade.id_localidade == Feedback.id_localidade)
    )
    conditions: list[ColumnElement[bool]] = [_scope_condition(scope_pairs)]
    if query:
        pattern = f"%{query}%"
        participant_matches = exists(
            select(EntregaParticipante.id_entrega_diaria)
            .join(Pessoa, Pessoa.id_pessoa == EntregaParticipante.id_pessoa)
            .where(
                EntregaParticipante.id_entrega_diaria == Feedback.id_entrega_diaria,
                Pessoa.nome_exibicao.ilike(pattern),
            )
        )
        conditions.append(
            or_(
                Feedback.relato.ilike(pattern),
                Feedback.nome_cliente.ilike(pattern),
                Localidade.nome_localidade.ilike(pattern),
                participant_matches,
            )
        )
    if tipo is not None:
        conditions.append(Feedback.tipo == tipo)
    if id_localidade is not None:
        conditions.append(Feedback.id_localidade == id_localidade)
    if data_de is not None:
        conditions.append(Feedback.data_feedback >= data_de)
    if data_ate is not None:
        conditions.append(Feedback.data_feedback <= data_ate)

    total = db.scalar(
        select(func.count(Feedback.id_feedback))
        .select_from(Feedback)
        .join(
            EntregaDiaria,
            and_(
                EntregaDiaria.id_entrega_diaria == Feedback.id_entrega_diaria,
                EntregaDiaria.id_lancamento_revisao == Feedback.id_lancamento_revisao,
                EntregaDiaria.codigo_item_lancamento == Feedback.codigo_item_lancamento,
                EntregaDiaria.id_localidade == Feedback.id_localidade,
            ),
        )
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == Feedback.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(Localidade, Localidade.id_localidade == Feedback.id_localidade)
        .where(*conditions)
    ) or 0
    rows = db.execute(
        statement.where(*conditions)
        .order_by(
            Feedback.data_feedback.desc(),
            Feedback.criado_em.desc(),
            Feedback.id_feedback.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return [tuple(row) for row in rows], total
