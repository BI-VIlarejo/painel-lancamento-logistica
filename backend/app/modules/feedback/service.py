"""Regras de negócio para cadastro e consulta de feedback."""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Iterator, cast
from uuid import UUID, uuid5

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    APIError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.modules.access_control import service as access_control_service
from app.modules.access_control.service import AuthorizationContext
from app.modules.deliveries.models import EntregaDiaria, LancamentoRevisao
from app.modules.feedback import repository
from app.modules.feedback.models import Feedback
from app.modules.feedback.schemas import (
    FeedbackCreateRequest,
    FeedbackDeliveryItem,
    FeedbackItem,
    FeedbackImportPreviewResponse,
    FeedbackImportPreviewItem,
    FeedbackImportPreviewRow,
    FeedbackImportPreviewRequest,
    FeedbackImportRequest,
    FeedbackImportResult,
    FeedbackLocality,
    FeedbackPage,
    FeedbackParticipantInput,
    FeedbackParticipantResponse,
    FeedbackRole,
    FeedbackTypeCode,
)

logger = logging.getLogger("lancamento.feedback")


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _database_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("Reclamações e elogios temporariamente indisponíveis.")


def _participants_by_delivery(
    db: Session,
    delivery_ids: set[int],
) -> dict[int, list[FeedbackParticipantResponse]]:
    rows = repository.list_delivery_participants(db, id_entrega_ids=delivery_ids)
    return {
        delivery_id: [
            FeedbackParticipantResponse(
                id_pessoa=id_pessoa,
                nome_exibicao=name,
                papel_participante=cast(FeedbackRole, role),
            )
            for id_pessoa, name, role in participants
        ]
        for delivery_id, participants in rows.items()
    }


def _validate_selected_participants(
    db: Session,
    *,
    id_entrega_diaria: int,
    participants: list[FeedbackParticipantInput] | None,
) -> None:
    if participants is None:
        return
    actual = repository.list_delivery_participants(
        db,
        id_entrega_ids={id_entrega_diaria},
    ).get(id_entrega_diaria, [])
    selected_pairs = {
        (participant.id_pessoa, participant.papel_participante)
        for participant in participants
    }
    actual_pairs = {(id_pessoa, role) for id_pessoa, _name, role in actual}
    if selected_pairs != actual_pairs:
        raise APIError(
            status_code=422,
            code="validation_error",
            message=(
                "Motorista e ajudantes selecionados devem corresponder à equipe "
                "da entrega confirmada."
            ),
        )


def _feedback_response(
    row: repository.FeedbackRow,
    *,
    participants: list[FeedbackParticipantResponse],
) -> FeedbackItem:
    feedback, launch, revision, delivery, locality = row
    return FeedbackItem(
        id_feedback=feedback.id_feedback,
        codigo_lancamento=UUID(launch.codigo_lancamento),
        codigo_revisao=UUID(revision.codigo_revisao),
        codigo_item_lancamento=UUID(feedback.codigo_item_lancamento),
        data_feedback=feedback.data_feedback,
        data_entrega=delivery.data_entrega,
        tipo=feedback.tipo,
        nome_cliente=feedback.nome_cliente,
        id_localidade=locality.id_localidade,
        nome_localidade=locality.nome_localidade,
        participantes=participants,
        relato=feedback.relato,
        criado_em=feedback.criado_em,
    )


def list_delivery_items(
    db: Session,
    *,
    data_entrega: date,
    id_localidade: int,
    access: AuthorizationContext,
) -> list[FeedbackDeliveryItem]:
    try:
        rows = repository.list_delivery_items(
            db,
            data_entrega=data_entrega,
            id_localidade=id_localidade,
            scope_pairs=access_control_service.scope_pairs(access),
        )
        participant_rows = _participants_by_delivery(
            db, {row[2].id_entrega_diaria for row in rows}
        )
        return [
            FeedbackDeliveryItem(
                codigo_lancamento=UUID(launch.codigo_lancamento),
                codigo_revisao=UUID(revision.codigo_revisao),
                codigo_item_lancamento=UUID(delivery.codigo_item_lancamento),
                data_entrega=delivery.data_entrega,
                id_localidade=locality.id_localidade,
                nome_localidade=locality.nome_localidade,
                quantidade_realizada=delivery.quantidade_realizada,
                quantidade_nao_realizada=delivery.quantidade_nao_realizada,
                participantes=participant_rows.get(delivery.id_entrega_diaria, []),
            )
            for launch, revision, delivery, locality in rows
        ]
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_localities(
    db: Session,
    *,
    access: AuthorizationContext,
) -> list[FeedbackLocality]:
    try:
        rows = repository.list_localities(
            db,
            scope_pairs=access_control_service.scope_pairs(access),
        )
        return [
            FeedbackLocality(id_localidade=id_localidade, nome_localidade=name)
            for id_localidade, name in rows
        ]
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_feedback(
    db: Session,
    *,
    payload: FeedbackCreateRequest,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FeedbackItem:
    try:
        item_row = repository.get_delivery_item(
            db,
            codigo_lancamento=payload.codigo_lancamento,
            codigo_revisao=payload.codigo_revisao,
            codigo_item_lancamento=payload.codigo_item_lancamento,
        )
        if item_row is None:
            raise NotFoundError("A entrega confirmada selecionada não foi encontrada.")
        launch, revision, delivery, _locality = item_row
        access_control_service.require_scope(
            access,
            id_setor=launch.id_setor,
            id_localidade=delivery.id_localidade,
        )
        if payload.data_feedback < delivery.data_entrega:
            raise APIError(
                status_code=422,
                code="validation_error",
                message="A data da manifestação não pode anteceder a data da entrega.",
            )
        _validate_selected_participants(
            db,
            id_entrega_diaria=delivery.id_entrega_diaria,
            participants=payload.participantes,
        )

        existing = repository.get_feedback_by_idempotency_key(
            db, idempotency_key=idempotency_key
        )
        if existing is not None:
            if _feedback_matches_request(
                existing,
                payload=payload,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                tipo=payload.tipo,
                id_localidade=delivery.id_localidade,
                id_entrega_diaria=delivery.id_entrega_diaria,
            ):
                row = repository.get_feedback_by_id(db, id_feedback=existing.id_feedback)
                if row is not None:
                    participant_rows = _participants_by_delivery(
                        db, {row[3].id_entrega_diaria}
                    )
                    return _feedback_response(
                        row,
                        participants=participant_rows.get(
                            row[3].id_entrega_diaria, []
                        ),
                    )
            raise ConflictError(
                "A chave de idempotência já foi usada para outra manifestação."
            )

        now = _now()
        feedback = Feedback(
            chave_idempotencia=str(idempotency_key),
            id_lancamento_revisao=revision.id_lancamento_revisao,
            codigo_item_lancamento=str(payload.codigo_item_lancamento),
            tipo=payload.tipo,
            data_feedback=payload.data_feedback,
            id_localidade=delivery.id_localidade,
            id_entrega_diaria=delivery.id_entrega_diaria,
            nome_cliente=payload.nome_cliente,
            identificador_cliente=None,
            relato=payload.relato,
            criado_por=access.id_usuario,
            criado_em=now,
            atualizado_em=now,
        )
        try:
            db.add(feedback)
            db.flush()
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            existing = repository.get_feedback_by_idempotency_key(
                db, idempotency_key=idempotency_key
            )
            if existing is not None and _feedback_matches_request(
                existing,
                payload=payload,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                tipo=payload.tipo,
                id_localidade=delivery.id_localidade,
                id_entrega_diaria=delivery.id_entrega_diaria,
            ):
                row = repository.get_feedback_by_id(db, id_feedback=existing.id_feedback)
                if row is not None:
                    participant_rows = _participants_by_delivery(
                        db, {row[3].id_entrega_diaria}
                    )
                    return _feedback_response(
                        row,
                        participants=participant_rows.get(
                            row[3].id_entrega_diaria, []
                        ),
                    )
            raise ConflictError(
                "A chave de idempotência já foi usada para outra manifestação."
            ) from exc

        # Audit logs contain identifiers and classification only, never the report text.
        logger.info(
            "Feedback criado: id_feedback=%s ator_usuario_id=%s tipo=%s id_localidade=%s",
            feedback.id_feedback,
            access.id_usuario,
            payload.tipo,
            delivery.id_localidade,
        )
        row = repository.get_feedback_by_id(db, id_feedback=feedback.id_feedback)
        if row is None:
            raise ServiceUnavailableError("Não foi possível carregar a manifestação criada.")
        participant_rows = _participants_by_delivery(
            db, {row[3].id_entrega_diaria}
        )
        return _feedback_response(
            row,
            participants=participant_rows.get(row[3].id_entrega_diaria, []),
        )
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "A chave de idempotência já foi usada para outra manifestação."
        ) from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def _feedback_matches_request(
    feedback: Feedback,
    *,
    payload: FeedbackCreateRequest,
    id_lancamento_revisao: int,
    tipo: str,
    id_localidade: int,
    id_entrega_diaria: int,
) -> bool:
    return (
        feedback.id_lancamento_revisao == id_lancamento_revisao
        and feedback.codigo_item_lancamento == str(payload.codigo_item_lancamento)
        and feedback.tipo == tipo
        and feedback.data_feedback == payload.data_feedback
        and feedback.id_localidade == id_localidade
        and feedback.id_entrega_diaria == id_entrega_diaria
        and feedback.nome_cliente == payload.nome_cliente
        and feedback.relato == payload.relato
    )


def _validate_import_item(
    db: Session,
    *,
    payload: FeedbackCreateRequest | FeedbackImportPreviewItem,
    access: AuthorizationContext,
) -> tuple[LancamentoRevisao, EntregaDiaria]:
    item_row = repository.get_delivery_item(
        db,
        codigo_lancamento=payload.codigo_lancamento,
        codigo_revisao=payload.codigo_revisao,
        codigo_item_lancamento=payload.codigo_item_lancamento,
    )
    if item_row is None:
        raise NotFoundError("A entrega confirmada relacionada não foi encontrada.")
    launch, revision, delivery, _locality = item_row
    access_control_service.require_scope(
        access,
        id_setor=launch.id_setor,
        id_localidade=delivery.id_localidade,
    )
    if payload.data_feedback < delivery.data_entrega:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="A data da manifestação não pode anteceder a data da entrega.",
        )
    _validate_selected_participants(
        db,
        id_entrega_diaria=delivery.id_entrega_diaria,
        participants=getattr(payload, "participantes", None),
    )
    return revision, delivery


def preview_feedback_import(
    db: Session,
    *,
    payload: FeedbackImportPreviewRequest,
    access: AuthorizationContext,
) -> FeedbackImportPreviewResponse:
    try:
        rows = []
        for row in payload.rows:
            try:
                _validate_import_item(db, payload=row.item, access=access)
                rows.append(FeedbackImportPreviewRow(line=row.line, valid=True, errors=[]))
            except APIError as exc:
                rows.append(
                    FeedbackImportPreviewRow(
                        line=row.line,
                        valid=False,
                        errors=[exc.message],
                    )
                )
        return FeedbackImportPreviewResponse(rows=rows)
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def import_feedbacks(
    db: Session,
    *,
    payload: FeedbackImportRequest,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FeedbackImportResult:
    try:
        prepared = []
        existing_count = 0
        for row in payload.rows:
            try:
                revision, delivery = _validate_import_item(
                    db,
                    payload=row.item,
                    access=access,
                )
            except APIError as exc:
                raise APIError(
                    status_code=exc.status_code,
                    code=exc.code,
                    message=f"Linha {row.line}: {exc.message}",
                ) from exc
            row_key = uuid5(idempotency_key, str(row.line))
            existing = repository.get_feedback_by_idempotency_key(
                db,
                idempotency_key=row_key,
            )
            if existing is not None:
                if _feedback_matches_request(
                    existing,
                    payload=row.item,
                    id_lancamento_revisao=revision.id_lancamento_revisao,
                    tipo=row.item.tipo,
                    id_localidade=delivery.id_localidade,
                    id_entrega_diaria=delivery.id_entrega_diaria,
                ):
                    existing_count += 1
                    continue
                raise ConflictError(
                    f"A chave de importação já foi usada para outro conteúdo (linha {row.line})."
                )
            prepared.append((row, revision, delivery, row_key))

        if existing_count and prepared:
            raise ConflictError(
                "A chave de importação já foi usada por outro conjunto de linhas."
            )
        if existing_count == len(payload.rows):
            return FeedbackImportResult(imported=existing_count)

        now = _now()
        for row, revision, delivery, row_key in prepared:
            db.add(
                Feedback(
                    chave_idempotencia=str(row_key),
                    id_lancamento_revisao=revision.id_lancamento_revisao,
                    codigo_item_lancamento=str(row.item.codigo_item_lancamento),
                    tipo=row.item.tipo,
                    data_feedback=row.item.data_feedback,
                    id_localidade=delivery.id_localidade,
                    id_entrega_diaria=delivery.id_entrega_diaria,
                    nome_cliente=row.item.nome_cliente,
                    identificador_cliente=None,
                    relato=row.item.relato,
                    criado_por=access.id_usuario,
                    criado_em=now,
                    atualizado_em=now,
                )
            )
        db.flush()
        db.commit()
        logger.info(
            "Importação de feedback concluída: ator_usuario_id=%s quantidade=%s",
            access.id_usuario,
            len(prepared),
        )
        return FeedbackImportResult(imported=len(prepared))
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A importação conflita com registros existentes.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_feedbacks(
    db: Session,
    *,
    access: AuthorizationContext,
    query: str | None,
    tipo: FeedbackTypeCode | None,
    id_localidade: int | None,
    data_de: date | None,
    data_ate: date | None,
    limit: int,
    offset: int,
) -> FeedbackPage:
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="A data inicial não pode ser posterior à data final.",
        )
    try:
        rows, total = repository.list_feedbacks(
            db,
            scope_pairs=access_control_service.scope_pairs(access),
            query=query.strip() if query else None,
            tipo=tipo,
            id_localidade=id_localidade,
            data_de=data_de,
            data_ate=data_ate,
            limit=limit,
            offset=offset,
        )
        participants = _participants_by_delivery(
            db,
            {row[3].id_entrega_diaria for row in rows},
        )
        return FeedbackPage(
            items=[
                _feedback_response(
                    row,
                    participants=participants.get(row[3].id_entrega_diaria, []),
                )
                for row in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def iter_feedbacks_for_export(
    db: Session,
    *,
    access: AuthorizationContext,
    query: str | None,
    tipo: FeedbackTypeCode | None,
    id_localidade: int | None,
    data_de: date | None,
    data_ate: date | None,
) -> Iterator[FeedbackItem]:
    offset = 0
    while True:
        page = list_feedbacks(
            db,
            access=access,
            query=query,
            tipo=tipo,
            id_localidade=id_localidade,
            data_de=data_de,
            data_ate=data_ate,
            limit=200,
            offset=offset,
        )
        yield from page.items
        offset += page.limit
        if offset >= page.total:
            break
