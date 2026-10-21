"""Consultas paginadas de eventos sem carregar detalhes potencialmente sensíveis."""

from datetime import datetime
from typing import Literal

from sqlalchemy import BigInteger, cast, func, inspect, literal, null, select, union_all
from sqlalchemy.orm import Session

from app.modules.access_control.models import AutorizacaoEvento
from app.modules.deliveries.models import LancamentoEvento
from app.modules.feedback.models import Feedback


def list_events(
    db: Session,
    *,
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"] | None,
    tipo_evento: str | None,
    ator_usuario_id: int | None,
    ocorrido_de: datetime | None,
    ocorrido_ate: datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, object]], int]:
    delivery_events = select(
        literal("ENTREGAS").label("origem"),
        LancamentoEvento.id_evento.label("id_evento"),
        LancamentoEvento.tipo_evento.label("tipo_evento"),
        LancamentoEvento.ator_usuario_id.label("ator_usuario_id"),
        LancamentoEvento.ocorrido_em.label("ocorrido_em"),
        LancamentoEvento.id_lancamento.label("referencia_id"),
    )
    access_events = select(
        literal("ACESSOS").label("origem"),
        AutorizacaoEvento.id_evento_autorizacao.label("id_evento"),
        AutorizacaoEvento.tipo_evento.label("tipo_evento"),
        AutorizacaoEvento.id_usuario_ator.label("ator_usuario_id"),
        AutorizacaoEvento.ocorrido_em.label("ocorrido_em"),
        cast(null(), BigInteger).label("referencia_id"),
    )
    event_sources = [delivery_events, access_events]
    inspector = inspect(db.get_bind())
    if inspector.has_table(Feedback.__tablename__):
        feedback_columns = {
            column["name"]
            for column in inspector.get_columns(Feedback.__tablename__)
        }
        if "criado_por" in feedback_columns:
            feedback_events = select(
                literal("FEEDBACK").label("origem"),
                Feedback.id_feedback.label("id_evento"),
                literal("FEEDBACK_CRIADO").label("tipo_evento"),
                Feedback.criado_por.label("ator_usuario_id"),
                Feedback.criado_em.label("ocorrido_em"),
                cast(Feedback.id_feedback, BigInteger).label("referencia_id"),
            )
            event_sources.append(feedback_events)
    events = union_all(*event_sources).subquery("audit_eventos")
    conditions = []
    if origem is not None:
        conditions.append(events.c.origem == origem)
    if tipo_evento is not None:
        conditions.append(events.c.tipo_evento == tipo_evento)
    if ator_usuario_id is not None:
        conditions.append(events.c.ator_usuario_id == ator_usuario_id)
    if ocorrido_de is not None:
        conditions.append(events.c.ocorrido_em >= ocorrido_de)
    if ocorrido_ate is not None:
        conditions.append(events.c.ocorrido_em <= ocorrido_ate)

    total = db.scalar(
        select(func.count()).select_from(events).where(*conditions)
    ) or 0
    rows = db.execute(
        select(events)
        .where(*conditions)
        .order_by(
            events.c.ocorrido_em.desc(),
            events.c.origem,
            events.c.id_evento.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).mappings().all()
    return [dict(row) for row in rows], total
