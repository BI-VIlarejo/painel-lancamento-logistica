"""Endpoints protegidos de lançamentos e pagamentos do módulo Fretes."""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.api.v1.dependencies import CsrfProtectedAuth, DatabaseSession, require_permission
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext

from . import service
from .schemas import (
    FreightAggregateDriverOption,
    FreightCancelRequest,
    FreightDeliverySummary,
    FreightInput,
    FreightPage,
    FreightPaymentOptions,
    FreightPaymentReport,
    FreightQuoteResponse,
    FreightResponse,
    TransportType,
)

router = APIRouter(prefix="/freights", tags=["Fretes"])
# Cada grupo de rotas tem uma permissão própria; gravações também validam CSRF.
_read_access = require_permission(PermissionCode.FREIGHT_VIEW)
_create_access = require_permission(PermissionCode.FREIGHT_CREATE)
_payment_view = require_permission(PermissionCode.AGGREGATE_PAYMENT_VIEW)
_payment_export = require_permission(PermissionCode.AGGREGATE_PAYMENT_EXPORT)


def _no_store(response: Response) -> None:
    """Evita guardar respostas de Fretes e dados financeiros em caches."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("/tariff-options", response_model=dict[str, object])
def get_tariff_options(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> dict[str, object]:
    """Fornece listas usadas para preencher o formulário de lançamento."""
    _no_store(response)
    return service.get_tariff_options(db, access=access)


@router.get("/aggregate-drivers", response_model=list[FreightAggregateDriverOption])
def get_aggregate_drivers(
    db: DatabaseSession,
    response: Response,
    data_servico: date,
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> list[FreightAggregateDriverOption]:
    """Lista motoristas cadastrados como entregas terceirizadas na data."""
    _no_store(response)
    return service.get_aggregate_drivers(
        db,
        data_servico=data_servico,
        access=access,
    )


@router.get("/carrier-drivers", response_model=list[FreightAggregateDriverOption])
def get_carrier_drivers(
    db: DatabaseSession,
    response: Response,
    data_servico: date,
    codigo_transportadora: Literal["JUST_IN_TIME", "PAULO_CRUZ"],
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> list[FreightAggregateDriverOption]:
    """Lista os motoristas cadastrados na transportadora e vigentes na data."""
    _no_store(response)
    return service.get_carrier_drivers(
        db,
        data_servico=data_servico,
        codigo_transportadora=codigo_transportadora,
        access=access,
    )


@router.get("/delivery-summary", response_model=FreightDeliverySummary)
def get_delivery_summary(
    db: DatabaseSession,
    response: Response,
    data_servico: date,
    id_motorista: int = Query(ge=1),
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> FreightDeliverySummary:
    """Carrega rota, quantidade e avarias da entrega confirmada selecionada."""
    _no_store(response)
    return service.get_delivery_summary(
        db,
        data_servico=data_servico,
        id_motorista=id_motorista,
        access=access,
    )


@router.post("/quote", response_model=FreightQuoteResponse)
def quote_freight(
    payload: FreightInput,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> FreightQuoteResponse:
    """Calcula uma prévia sem gravar o lançamento."""
    _no_store(response)
    return service.quote_freight(db, payload=payload, access=access)


@router.post("", response_model=FreightResponse, status_code=status.HTTP_201_CREATED)
def create_freight(
    payload: FreightInput,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),  # noqa: B008
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> FreightResponse:
    """Registra o frete e usa a chave do cabeçalho para deduplicar reenvios."""
    _no_store(response)
    return service.create_freight(
        db,
        payload=payload,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.get("", response_model=FreightPage)
def get_freights(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),  # noqa: B008
    data_de: date | None = None,
    data_ate: date | None = None,
    tipo_transporte: TransportType | None = None,
    status_calculo: Literal["CALCULADO", "PENDENTE_CONFERENCIA"] | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> FreightPage:
    """Consulta lançamentos por período/status, com limite e deslocamento."""
    _no_store(response)
    return service.list_freights(
        db,
        access=access,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        status_calculo=status_calculo,
        limit=limit,
        offset=offset,
    )


@router.get("/payments/report", response_model=FreightPaymentReport)
def get_payment_report(
    db: DatabaseSession,
    response: Response,
    data_de: date,
    data_ate: date,
    tipo_transporte: Literal["AGREGADO", "TRANSPORTADORA"] = "AGREGADO",
    nome_transportador: str | None = Query(default=None, min_length=2, max_length=160),
    sem_identificacao: bool = False,
    access: AuthorizationContext = Depends(_payment_view),  # noqa: B008
) -> FreightPaymentReport:
    """Retorna o total por período, modalidade e responsável selecionado."""
    _no_store(response)
    return service.build_payment_report(
        db,
        access=access,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
    )


@router.get("/payments/options", response_model=FreightPaymentOptions)
def get_payment_options(
    db: DatabaseSession,
    response: Response,
    data_de: date,
    data_ate: date,
    access: AuthorizationContext = Depends(_payment_view),  # noqa: B008
) -> FreightPaymentOptions:
    """Lista agregados e transportadoras com serviços no período consultado."""
    _no_store(response)
    return service.build_payment_options(
        db,
        access=access,
        data_de=data_de,
        data_ate=data_ate,
    )


@router.get("/payments/export.xlsx")
def export_payment_report(
    db: DatabaseSession,
    data_de: date,
    data_ate: date,
    tipo_transporte: Literal["AGREGADO", "TRANSPORTADORA"] = "AGREGADO",
    nome_transportador: str | None = Query(default=None, min_length=2, max_length=160),
    sem_identificacao: bool = False,
    access: AuthorizationContext = Depends(_payment_export),  # noqa: B008
) -> Response:
    """Baixa a solicitação XLSX somente para quem tem permissão de exportação."""
    xlsx_bytes = service.export_payment_report(
        db,
        access=access,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
    )
    transport_label = "agregados" if tipo_transporte == "AGREGADO" else "transportadoras"
    filename = f"solicitacao-pagamento-{transport_label}-{data_de:%Y%m%d}-{data_ate:%Y%m%d}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        },
    )


@router.get("/{codigo_frete}", response_model=FreightResponse)
def get_freight(
    codigo_frete: UUID,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_read_access),  # noqa: B008
) -> FreightResponse:
    """Retorna o registro completo e a situação do frete selecionado."""
    _no_store(response)
    return service.get_freight(db, codigo_frete=codigo_frete, access=access)


@router.put("/{codigo_frete}", response_model=FreightResponse)
def update_freight(
    codigo_frete: UUID,
    payload: FreightInput,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),  # noqa: B008
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> FreightResponse:
    """Recalcula os valores e salva as alterações auditadas do frete."""
    _no_store(response)
    return service.update_freight(
        db,
        codigo_frete=codigo_frete,
        payload=payload,
        idempotency_key=idempotency_key,
        access=access,
    )


@router.post("/{codigo_frete}/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_freight(
    codigo_frete: UUID,
    payload: FreightCancelRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),  # noqa: B008
    access: AuthorizationContext = Depends(_create_access),  # noqa: B008
) -> None:
    """Cancela o lançamento sem removê-lo do histórico de auditoria."""
    _no_store(response)
    service.cancel_freight(
        db,
        codigo_frete=codigo_frete,
        justificativa=payload.justificativa,
        idempotency_key=idempotency_key,
        access=access,
    )
