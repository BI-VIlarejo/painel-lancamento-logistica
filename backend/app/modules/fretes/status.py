"""Compatibilidade com pendências de rota de importações históricas."""

from sqlalchemy import and_, func

from .models import Frete

ROUTE_REASON = "Rota/cidade não vinculada de forma única ao catálogo do portal."


def route_only_pending_filter():
    """Identifica registros antigos cuja única pendência era a rota."""
    return and_(
        Frete.status_calculo == "PENDENTE_CONFERENCIA",
        func.coalesce(Frete.motivo_pendencia, "") == ROUTE_REASON,
    )


def effective_status(freight: Frete) -> tuple[str, str | None]:
    reason = freight.motivo_pendencia
    source = freight.detalhe_calculo or {}
    if reason and (reason == ROUTE_REASON or source.get("metodo_calculo") == "VALOR_HISTORICO_IMPORTADO"):
        reason = reason.replace(ROUTE_REASON, "").strip() or None
        if freight.status_calculo == "PENDENTE_CONFERENCIA" and reason is None:
            return "CALCULADO", None
    return freight.status_calculo, reason
