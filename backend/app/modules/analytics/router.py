"""Leitura dos indicadores agregados do painel gerencial."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.dependencies import DatabaseSession, RequestId, require_permission
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext
from app.modules.analytics import service
from app.modules.analytics.schemas import DashboardResponse

router = APIRouter(prefix="/analytics", tags=["Indicadores"])
_dashboard_access = require_permission(PermissionCode.DASHBOARD_ACCESS)


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
