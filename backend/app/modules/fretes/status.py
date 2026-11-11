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
        if reason and freight.valor_frete_bruto is None and freight.tipo_transporte == "AGREGADO":
            missing = []
            if not freight.rota_cidade:
                missing.append("rota")
            if freight.peso_kg is None:
                missing.append("peso")
            if freight.valor_nota is None:
                missing.append("valor da nota")
            if freight.km_rodado is None:
                missing.append("KM rodado")
            explanation = ("Para calcular o frete, informe: " + ", ".join(missing) + "."
                           if missing else "Abra e salve o frete para calcular pela tarifa atual, ou informe o valor histórico.")
            for old in ("Valor do frete bruto ausente na planilha importada.", "Valor do frete bruto ausente."):
                reason = reason.replace(old, explanation)
        if freight.status_calculo == "PENDENTE_CONFERENCIA" and reason is None:
            return "CALCULADO", None
    return freight.status_calculo, reason
