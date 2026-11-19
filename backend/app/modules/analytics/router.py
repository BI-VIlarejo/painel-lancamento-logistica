"""Leitura dos indicadores agregados do painel gerencial."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.dependencies import CsrfProtectedAuth, DatabaseSession, RequestId, require_permission
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext
from app.modules.analytics import service, transport_service
from app.modules.analytics.schemas import (
    DashboardGoalResponse,
    DashboardGoalUpdate,
    DashboardResponse,
    TransportDashboardDetailResponse,
    TransportDashboardResponse,
)

router = APIRouter(prefix="/analytics", tags=["Indicadores"])
_dashboard_access = require_permission(PermissionCode.DASHBOARD_ACCESS)
_freight_access = require_permission(PermissionCode.FREIGHT_VIEW)


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    db: DatabaseSession,
    response: Response,
    request_id: RequestId,
    access: AuthorizationContext = Depends(_dashboard_access),
    data_de: date | None = None,
    data_ate: date | None = None,
    id_localidade: int | None = Query(default=None, ge=1),
    tipo_transporte_entrega: Literal["PROPRIA", "TERCEIRIZADA"] | None = None,
) -> DashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.get_dashboard(
        db,
        access=access,
        data_de=data_de,
        data_ate=data_ate,
        id_localidade=id_localidade,
        tipo_transporte_entrega=tipo_transporte_entrega,
        request_id=request_id,
    )


@router.get("/goal", response_model=DashboardGoalResponse)
def get_goal(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_dashboard_access),
) -> DashboardGoalResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.get_dashboard_goal(db, access=access)


@router.put("/goal", response_model=DashboardGoalResponse)
def update_goal(
    payload: DashboardGoalUpdate,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    response: Response,
    access: AuthorizationContext = Depends(_dashboard_access),
) -> DashboardGoalResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.update_dashboard_goal(
        db,
        access=access,
        id_usuario_ator=auth.user.id_usuario,
        payload=payload,
    )


@router.get("/transport", response_model=TransportDashboardResponse)
def get_transport_dashboard(
    db: DatabaseSession,
    response: Response,
    request_id: RequestId,
    dashboard_access: AuthorizationContext = Depends(_dashboard_access),
    freight_access: AuthorizationContext = Depends(_freight_access),
    data_de: date | None = None,
    data_ate: date | None = None,
) -> TransportDashboardResponse:
    """Retorna os indicadores consolidados do Painel Gerencial de Transportes."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return transport_service.get_transport_dashboard(
        db,
        dashboard_access=dashboard_access,
        freight_access=freight_access,
        data_de=data_de,
        data_ate=data_ate,
        request_id=request_id,
    )


@router.get("/transport/details", response_model=TransportDashboardDetailResponse)
def get_transport_dashboard_details(
    db: DatabaseSession,
    response: Response,
    kind: Literal["carrier", "city"],
    key: str = Query(min_length=1, max_length=200),
    dashboard_access: AuthorizationContext = Depends(_dashboard_access),
    freight_access: AuthorizationContext = Depends(_freight_access),
    data_de: date | None = None,
    data_ate: date | None = None,
    freight_limit: int = Query(default=10, ge=1, le=100),
    freight_offset: int = Query(default=0, ge=0),
    delivery_limit: int = Query(default=10, ge=1, le=100),
    delivery_offset: int = Query(default=0, ge=0),
) -> TransportDashboardDetailResponse:
    """Retorna totais e registros paginados apenas do recorte clicado no painel."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return transport_service.get_transport_dashboard_details(
        db,
        dashboard_access=dashboard_access,
        freight_access=freight_access,
        kind=kind,
        key=key,
        data_de=data_de,
        data_ate=data_ate,
        freight_limit=freight_limit,
        freight_offset=freight_offset,
        delivery_limit=delivery_limit,
        delivery_offset=delivery_offset,
    )
