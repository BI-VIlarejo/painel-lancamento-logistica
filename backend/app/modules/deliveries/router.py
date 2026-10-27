"""Rotas protegidas de gravação, confirmação e consulta de Entregas."""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.api.v1.dependencies import (
    CsrfProtectedAuth,
    DatabaseSession,
    require_permission,
)
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext
from app.modules.deliveries import service
from app.modules.deliveries.schemas import (
    DeliveryDraftCreateRequest,
    DeliveryDraftUpdateRequest,
    DeliveryCorrectionRequest,
    DeliveryEventResponse,
    DeliveryLaunchDetail,
    DeliveryLaunchPage,
    DeliveryLifecycleReasonRequest,
)

router = APIRouter(prefix="/deliveries", tags=["Entregas"])
_read_access = require_permission(PermissionCode.DELIVERY_VIEW)
_create_access = require_permission(PermissionCode.DELIVERY_CREATE)
_edit_access = require_permission(PermissionCode.DELIVERY_EDIT_DRAFT)
_correct_access = require_permission(PermissionCode.DELIVERY_CORRECT)
_cancel_access = require_permission(PermissionCode.DELIVERY_CANCEL)


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("", response_model=DeliveryLaunchPage)
def get_deliveries(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),
    estado: Literal[
        "RASCUNHO",
        "ENVIADA",
        "EM_REVISAO",
        "DEVOLVIDA",
        "APROVADA",
        "CANCELADA",
    ] | None = None,
    data_de: date | None = None,
    data_ate: date | None = None,
    id_localidade: int | None = Query(default=None, ge=1),
    criado_por: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DeliveryLaunchPage:
    _no_store(response)
    return service.list_drafts(
        db,
        access=access,
        estado=estado,
        data_de=data_de,
        data_ate=data_ate,
        id_localidade=id_localidade,
        criado_por=criado_por,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    response_model=DeliveryLaunchDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_delivery_draft(
    payload: DeliveryDraftCreateRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_create_access),
) -> DeliveryLaunchDetail:
    _no_store(response)
    return service.create_draft(
        db,
        payload=payload,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.get("/{codigo_lancamento}", response_model=DeliveryLaunchDetail)
def get_delivery(
    codigo_lancamento: UUID,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),
) -> DeliveryLaunchDetail:
    _no_store(response)
    return service.get_draft(
        db,
        codigo_lancamento=codigo_lancamento,
        access=access,
    )


@router.get(
    "/{codigo_lancamento}/events",
    response_model=list[DeliveryEventResponse],
)
def get_delivery_events(
    codigo_lancamento: UUID,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),
) -> list[DeliveryEventResponse]:
    _no_store(response)
    return service.list_launch_events(
        db,
        codigo_lancamento=codigo_lancamento,
        access=access,
    )


@router.put("/{codigo_lancamento}", response_model=DeliveryLaunchDetail)
def update_delivery_draft(
    codigo_lancamento: UUID,
    payload: DeliveryDraftUpdateRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_edit_access),
) -> DeliveryLaunchDetail:
    _no_store(response)
    return service.update_draft(
        db,
        codigo_lancamento=codigo_lancamento,
        payload=payload,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.delete("/{codigo_lancamento}", status_code=status.HTTP_204_NO_CONTENT)
def discard_delivery_draft(
    codigo_lancamento: UUID,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_edit_access),
) -> Response:
    """Descarta somente rascunhos, preservando o evento para auditoria."""
    _no_store(response)
    service.discard_draft(
        db,
        codigo_lancamento=codigo_lancamento,
        idempotency_key=idempotency_key,
        access=access,
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/{codigo_lancamento}/confirm", response_model=DeliveryLaunchDetail)
def confirm_delivery_draft(
    codigo_lancamento: UUID,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_create_access),
) -> DeliveryLaunchDetail:
    """Confirma o rascunho e registra o lançamento imediatamente."""
    _no_store(response)
    return service.confirm_draft(
        db,
        codigo_lancamento=codigo_lancamento,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.post(
    "/{codigo_lancamento}/corrections",
    response_model=DeliveryLaunchDetail,
    status_code=status.HTTP_201_CREATED,
)
def start_delivery_correction(
    codigo_lancamento: UUID,
    payload: DeliveryCorrectionRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_correct_access),
) -> DeliveryLaunchDetail:
    _no_store(response)
    return service.start_correction_draft(
        db,
        codigo_lancamento=codigo_lancamento,
        justificativa=payload.justificativa,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.post(
    "/{codigo_lancamento}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
)
def cancel_delivery(
    codigo_lancamento: UUID,
    payload: DeliveryLifecycleReasonRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
    access: AuthorizationContext = Depends(_cancel_access),
) -> Response:
    _no_store(response)
    service.cancel_confirmed_launch(
        db,
        codigo_lancamento=codigo_lancamento,
        justificativa=payload.justificativa,
        idempotency_key=idempotency_key,
        access=access,
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
