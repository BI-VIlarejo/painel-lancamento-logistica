"""Endpoints autorizados de feedback de clientes."""

import csv
from datetime import date
from io import StringIO
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.responses import StreamingResponse

from app.api.v1.dependencies import (
    CsrfProtectedAuth,
    DatabaseSession,
    require_permission,
)
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext
from app.modules.feedback import service
from app.modules.feedback.schemas import (
    FeedbackCreateRequest,
    FeedbackDeliveryItem,
    FeedbackItem,
    FeedbackLocality,
    FeedbackPage,
    FeedbackTypeCode,
)

router = APIRouter(prefix="/feedbacks", tags=["Reclamações e elogios"])
_read_access = require_permission(PermissionCode.FEEDBACK_VIEW)
_create_access = require_permission(PermissionCode.FEEDBACK_CREATE)
_export_access = require_permission(PermissionCode.FEEDBACK_EXPORT)
_section_access = require_permission(PermissionCode.FEEDBACK_ACCESS)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _csv_row(values: list[object]) -> str:
    buffer = StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    sanitized = []
    for value in values:
        text = str(value)
        if text.startswith(("=", "+", "-", "@", "\t", "\r")):
            text = "'" + text
        sanitized.append(text)
    writer.writerow(sanitized)
    return buffer.getvalue()


@router.get("/delivery-items", response_model=list[FeedbackDeliveryItem])
def get_delivery_items_for_feedback(
    db: DatabaseSession,
    response: Response,
    data_entrega: date,
    access: AuthorizationContext = Depends(_create_access),
    id_localidade: int = Query(ge=1),
) -> list[FeedbackDeliveryItem]:
    _no_store(response)
    return service.list_delivery_items(
        db,
        data_entrega=data_entrega,
        id_localidade=id_localidade,
        access=access,
    )


@router.get("/localities", response_model=list[FeedbackLocality])
def get_feedback_localities(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_section_access),
) -> list[FeedbackLocality]:
    _no_store(response)
    return service.list_localities(db, access=access)


@router.post("", response_model=FeedbackItem, status_code=201)
def create_feedback(
    payload: FeedbackCreateRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_create_access),
) -> FeedbackItem:
    _no_store(response)
    return service.create_feedback(
        db,
        payload=payload,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.get("", response_model=FeedbackPage)
def list_feedbacks(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    tipo: FeedbackTypeCode | None = None,
    id_localidade: int | None = Query(default=None, ge=1),
    data_de: date | None = None,
    data_ate: date | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> FeedbackPage:
    _no_store(response)
    return service.list_feedbacks(
        db,
        access=access,
        query=q,
        tipo=tipo,
        id_localidade=id_localidade,
        data_de=data_de,
        data_ate=data_ate,
        limit=limit,
        offset=offset,
    )


@router.get("/export")
def export_feedbacks(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_export_access),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    tipo: FeedbackTypeCode | None = None,
    id_localidade: int | None = Query(default=None, ge=1),
    data_de: date | None = None,
    data_ate: date | None = None,
) -> StreamingResponse:
    _no_store(response)
    service.list_feedbacks(
        db,
        access=access,
        query=q,
        tipo=tipo,
        id_localidade=id_localidade,
        data_de=data_de,
        data_ate=data_ate,
        limit=1,
        offset=0,
    )

    def rows():
        yield "\ufeff" + _csv_row(
            [
                "data_manifestacao",
                "data_entrega",
                "tipo",
                "cliente",
                "loja",
                "motorista",
                "entregador_1",
                "entregador_2",
                "descricao",
            ]
        )
        for item in service.iter_feedbacks_for_export(
            db,
            access=access,
            query=q,
            tipo=tipo,
            id_localidade=id_localidade,
            data_de=data_de,
            data_ate=data_ate,
        ):
            driver = next(
                (
                    person.nome_exibicao
                    for person in item.participantes
                    if person.papel_participante == "MOTORISTA"
                ),
                "",
            )
            helpers = [
                person.nome_exibicao
                for person in item.participantes
                if person.papel_participante == "AJUDANTE"
            ]
            yield _csv_row(
                [
                    item.data_feedback.isoformat(),
                    item.data_entrega.isoformat(),
                    item.tipo,
                    item.nome_cliente or "",
                    item.nome_localidade,
                    driver,
                    helpers[0] if helpers else "",
                    helpers[1] if len(helpers) > 1 else "",
                    item.relato,
                ]
            )

    return StreamingResponse(
        rows(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="reclamacoes-elogios.csv"',
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        },
    )
