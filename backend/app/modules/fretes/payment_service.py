"""Serviço de fechamento financeiro, baixas, NF e ajustes de Pagamentos de Fretes."""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.modules.access_control.service import AuthorizationContext
from app.modules.catalogs.models import Pessoa

from . import repository
from .models import (
    Frete,
    FreteAjusteFinanceiro,
    FretePagamento,
    FretePagamentoItem,
)
from .schemas import (
    FreightPaymentAdjustmentCreateRequest,
    FreightPaymentAdjustmentItem,
    FreightPaymentExecutionSummary,
    FreightPaymentFreightDetail,
    FreightPaymentInvoiceUpdateRequest,
    FreightPaymentPending,
    FreightPaymentPendingSummary,
    FreightPaymentReport,
    FreightPaymentResponsibleSummary,
    FreightPaymentSettlementCreateRequest,
    FreightPaymentSettlementPage,
    FreightPaymentSettlementStatusRequest,
    FreightPaymentSettlementSummary,
    FreightPaymentWarning,
    PaymentFreightState,
    PaymentResponsibleStatus,
    PaymentSettlementStatus,
    PaymentTransportType,
)
from .status import effective_status
from .tariff_catalog import normalize_label

UNIDENTIFIED_KEY = "__SEM_IDENTIFICACAO__"
UNIDENTIFIED_LABEL = "Sem identificação"
ZERO = Decimal("0.00")
CENT = Decimal("0.01")


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _business_today() -> date:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def _q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _add_months(base: date, months: int) -> date:
    total_months = (base.year * 12 + (base.month - 1)) + months
    year, month_index = divmod(total_months, 12)
    month = month_index + 1
    day = min(base.day, monthrange(year, month)[1])
    return date(year, month, day)


def _format_brl(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    absolute = _q2(abs(value))
    text = f"{absolute:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{sign}R$ {text}"


def _adjustment_signed_value(adjustment: FreteAjusteFinanceiro) -> Decimal:
    value = Decimal(adjustment.valor)
    return value if adjustment.natureza == "ACRESCIMO" else -value


def _responsible_key_from_freight(freight: Frete) -> tuple[str, str, bool]:
    name = (freight.nome_transportador or "").strip()
    if not name:
        return UNIDENTIFIED_KEY, UNIDENTIFIED_LABEL, True
    return name, name, False


def _is_freight_payment_ready(
    freight: Frete,
    *,
    historical_source: dict[str, object] | None,
    payment_amount: Decimal | None,
) -> tuple[bool, str | None]:
    status, reason = effective_status(freight)
    imported_responsible_is_clear = (
        historical_source is not None
        and bool((freight.nome_transportador or "").strip())
        and historical_source.get("tipo_transporte_identificado") is not False
        and not (
            freight.tipo_transporte == "AGREGADO"
            and historical_source.get("vinculo_responsavel_status") == "AMBIGUO"
        )
    )
    ready = payment_amount is not None and (
        status == "CALCULADO" or imported_responsible_is_clear
    )
    return ready, reason


@dataclass(frozen=True)
class _PeopleLookup:
    by_id: dict[int, Pessoa]
    by_name: dict[str, Pessoa]
    by_carrier_code: dict[str, Pessoa]


def _build_people_lookup(people: list[Pessoa]) -> _PeopleLookup:
    by_id: dict[int, Pessoa] = {}
    by_name: dict[str, Pessoa] = {}
    by_carrier: dict[str, Pessoa] = {}
    for person in people:
        by_id[person.id_pessoa] = person
        norm_name = normalize_label(person.nome_exibicao)
        if norm_name and norm_name not in by_name:
            by_name[norm_name] = person
        if person.codigo_transportadora_independente:
            carrier_key = person.codigo_transportadora_independente
            # Prefere registro que tenha documento/PIX cadastrado para a transportadora.
            existing = by_carrier.get(carrier_key)
            if existing is None or (
                not existing.documento_fiscal and not existing.chave_pix
                and (person.documento_fiscal or person.chave_pix)
            ):
                by_carrier[carrier_key] = person
    return _PeopleLookup(by_id=by_id, by_name=by_name, by_carrier_code=by_carrier)


def _resolve_responsible_person(
    *,
    tipo_transporte: str,
    nome_transportador: str,
    sem_identificacao: bool,
    person_ids: list[int],
    carrier_codes: list[str],
    lookup: _PeopleLookup,
) -> Pessoa | None:
    if sem_identificacao:
        return None
    for person_id in person_ids:
        person = lookup.by_id.get(person_id)
        if person is not None:
            return person
    if tipo_transporte == "AGREGADO":
        return lookup.by_name.get(normalize_label(nome_transportador))
    for code in carrier_codes:
        person = lookup.by_carrier_code.get(code)
        if person is not None:
            return person
    norm = normalize_label(nome_transportador)
    if "PAULO CRUZ" in norm:
        return lookup.by_carrier_code.get("PAULO_CRUZ")
    if "JUST IN TIME" in norm:
        return lookup.by_carrier_code.get("JUST_IN_TIME")
    return None


def _compute_settlement_divergence(
    settlement: FretePagamento,
    *,
    items: list[FretePagamentoItem],
    freights_by_id: dict[int, Frete],
    cancellations: dict[int, object],
    payment_amount_fn,
    historical_source_fn,
) -> tuple[bool, str | None, set[int]]:
    """Detecta alterações nos fretes vinculados após o fechamento (estilo NOVA_Demo)."""
    if settlement.status_pagamento == "ESTORNADO":
        return False, None, set()
    divergent_ids: set[int] = set()
    reasons: list[str] = []
    has_canceled = False
    has_value_change = False
    for item in items:
        if item.id_frete in cancellations:
            has_canceled = True
            divergent_ids.add(item.id_frete)
            continue
        freight = freights_by_id.get(item.id_frete)
        if freight is None:
            continue
        current_amount = payment_amount_fn(freight)
        ready, _ = _is_freight_payment_ready(
            freight,
            historical_source=historical_source_fn(freight),
            payment_amount=current_amount,
        )
        if (
            not ready
            or current_amount is None
            or _q2(current_amount) != _q2(Decimal(item.valor_frete_pago_snapshot))
            or _q2(Decimal(freight.valor_avaria)) != _q2(Decimal(item.valor_avaria_snapshot))
        ):
            has_value_change = True
            divergent_ids.add(item.id_frete)
    if has_canceled:
        reasons.append("Há frete cancelado após o fechamento.")
    if has_value_change:
        reasons.append("Valores ou status de frete mudaram após o fechamento.")
    return bool(reasons), (" ".join(reasons) if reasons else None), divergent_ids


def _settlement_to_summary(
    settlement: FretePagamento,
    *,
    users_by_id: dict[int, str],
    lookup: _PeopleLookup,
    possui_alteracao: bool = False,
    motivo_alteracao: str | None = None,
) -> FreightPaymentSettlementSummary:
    person = _resolve_responsible_person(
        tipo_transporte=settlement.tipo_transporte,
        nome_transportador=settlement.nome_transportador,
        sem_identificacao=settlement.sem_identificacao,
        person_ids=[settlement.id_pessoa_responsavel]
        if settlement.id_pessoa_responsavel is not None
        else [],
        carrier_codes=[],
        lookup=lookup,
    )
    exige_nf = (
        True
        if settlement.tipo_transporte == "TRANSPORTADORA"
        else bool(person.exige_nota_fiscal) if person is not None else False
    )
    return FreightPaymentSettlementSummary(
        codigo_pagamento=UUID(settlement.codigo_pagamento),
        tipo_transporte=settlement.tipo_transporte,  # type: ignore[arg-type]
        nome_transportador=settlement.nome_transportador,
        sem_identificacao=settlement.sem_identificacao,
        id_pessoa_responsavel=settlement.id_pessoa_responsavel or (
            person.id_pessoa if person is not None else None
        ),
        documento_fiscal=person.documento_fiscal if person is not None else None,
        chave_pix=person.chave_pix if person is not None else None,
        exige_nota_fiscal=exige_nf,
        data_de=settlement.data_de,
        data_ate=settlement.data_ate,
        status_pagamento=settlement.status_pagamento,  # type: ignore[arg-type]
        quantidade_fretes=settlement.quantidade_fretes,
        quantidade_dias=settlement.quantidade_dias,
        valor_frete_bruto=_q2(Decimal(settlement.valor_frete_bruto)),
        valor_avarias=_q2(Decimal(settlement.valor_avarias)),
        valor_ajustes=_q2(Decimal(settlement.valor_ajustes)),
        valor_liquido_registrado=_q2(Decimal(settlement.valor_liquido_registrado)),
        data_pagamento=settlement.data_pagamento,
        nf_numero=settlement.nf_numero,
        nf_data=settlement.nf_data,
        nf_recebida=settlement.nf_recebida,
        observacao=settlement.observacao,
        criado_em=settlement.criado_em,
        criado_por_nome=users_by_id.get(settlement.criado_por),
        pago_em=settlement.pago_em,
        pago_por_nome=users_by_id.get(settlement.pago_por) if settlement.pago_por else None,
        estornado_em=settlement.estornado_em,
        estornado_por_nome=(
            users_by_id.get(settlement.estornado_por) if settlement.estornado_por else None
        ),
        motivo_estorno=settlement.motivo_estorno,
        possui_alteracao=possui_alteracao,
        motivo_alteracao=motivo_alteracao,
    )


def _adjustment_to_schema(
    adjustment: FreteAjusteFinanceiro,
    *,
    payments_by_id: dict[int, FretePagamento],
    users_by_id: dict[int, str],
) -> FreightPaymentAdjustmentItem:
    payment = (
        payments_by_id.get(adjustment.id_frete_pagamento)
        if adjustment.id_frete_pagamento is not None
        else None
    )
    active_payment = (
        payment if payment is not None and payment.status_pagamento != "ESTORNADO" else None
    )
    return FreightPaymentAdjustmentItem(
        codigo_ajuste=UUID(adjustment.codigo_ajuste),
        tipo_transporte=adjustment.tipo_transporte,  # type: ignore[arg-type]
        nome_transportador=adjustment.nome_transportador,
        id_pessoa_responsavel=adjustment.id_pessoa_responsavel,
        data_referencia=adjustment.data_referencia,
        natureza=adjustment.natureza,  # type: ignore[arg-type]
        categoria=adjustment.categoria,  # type: ignore[arg-type]
        descricao=adjustment.descricao,
        valor=_q2(Decimal(adjustment.valor)),
        observacao=adjustment.observacao,
        vinculado_pagamento=active_payment is not None,
        codigo_pagamento=(
            UUID(active_payment.codigo_pagamento) if active_payment is not None else None
        ),
        status_pagamento=(
            active_payment.status_pagamento  # type: ignore[arg-type]
            if active_payment is not None
            else None
        ),
        criado_em=adjustment.criado_em,
        criado_por_nome=users_by_id.get(adjustment.criado_por),
    )


def _responsible_sort_key(item: FreightPaymentResponsibleSummary) -> tuple[int, str]:
    """Ordena pendentes e em aberto primeiro e pagos ao final (padrão NOVA_Demo)."""
    if item.possui_alteracao:
        priority = 0
    elif item.status_pagamento == "PENDENTE_CONFERENCIA":
        priority = 1
    elif item.status_pagamento == "PARCIAL":
        priority = 2
    elif item.status_pagamento == "A_PAGAR":
        priority = 3
    elif item.status_pagamento == "SOLICITADO":
        priority = 4
    else:
        priority = 5
    return (priority, item.nome_transportador.casefold())


def build_payment_report_from_records(
    records: list[Frete],
    *,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
    payment_amount_fn,
    historical_source_fn,
    historical_warning_fn,
    active_items_by_freight: dict[int, tuple[FretePagamentoItem, FretePagamento]] | None = None,
    extra_payments_by_id: dict[int, FretePagamento] | None = None,
    all_settlement_items_by_payment: dict[int, list[FretePagamentoItem]] | None = None,
    settlement_freights_by_id: dict[int, Frete] | None = None,
    cancellations: dict[int, object] | None = None,
    adjustments: list[FreteAjusteFinanceiro] | None = None,
    people: list[Pessoa] | None = None,
    users_by_id: dict[int, str] | None = None,
) -> FreightPaymentReport:
    """Consolida totais, pendências, status de pagamento e breakdown por responsável."""
    active_by_freight = active_items_by_freight or {}
    items_by_payment = all_settlement_items_by_payment or {}
    freights_lookup = settlement_freights_by_id or {f.id_frete: f for f in records}
    canceled_map = cancellations or {}
    adjustments_list = adjustments or []
    people_lookup = _build_people_lookup(people or [])
    users_map = users_by_id or {}

    pending_items: list[FreightPaymentPending] = []
    warning_items: list[FreightPaymentWarning] = []
    gross_total = Decimal("0")
    damage_total = Decimal("0")
    net_total = Decimal("0")

    payments_by_id: dict[int, FretePagamento] = dict(extra_payments_by_id or {})
    for _item, payment in active_by_freight.values():
        payments_by_id[payment.id_frete_pagamento] = payment

    settlement_divergence: dict[int, tuple[bool, str | None, set[int]]] = {}
    for payment_id, payment in payments_by_id.items():
        settlement_divergence[payment_id] = _compute_settlement_divergence(
            payment,
            items=items_by_payment.get(payment_id, []),
            freights_by_id=freights_lookup,
            cancellations=canceled_map,
            payment_amount_fn=payment_amount_fn,
            historical_source_fn=historical_source_fn,
        )

    @dataclass
    class _GroupAcc:
        key: str
        name: str
        unidentified: bool
        person_ids: list[int]
        carrier_codes: list[str]
        days: set[date]
        freights: list[FreightPaymentFreightDetail]
        adjustments: list[FreteAjusteFinanceiro]
        payment_ids: set[int]
        ready_count: int = 0
        pending_count: int = 0
        paid_count: int = 0
        requested_count: int = 0
        open_count: int = 0
        gross: Decimal = ZERO
        damage: Decimal = ZERO
        freights_net: Decimal = ZERO
        paid_value: Decimal = ZERO
        requested_value: Decimal = ZERO
        open_value: Decimal = ZERO

    groups: dict[str, _GroupAcc] = {}

    def _get_group(key: str, name: str, unidentified: bool) -> _GroupAcc:
        existing = groups.get(key)
        if existing is None:
            existing = _GroupAcc(
                key=key,
                name=name,
                unidentified=unidentified,
                person_ids=[],
                carrier_codes=[],
                days=set(),
                freights=[],
                adjustments=[],
                payment_ids=set(),
            )
            groups[key] = existing
        return existing

    for freight in records:
        payment_amount = payment_amount_fn(freight)
        historical_source = historical_source_fn(freight)
        payment_is_ready, reason = _is_freight_payment_ready(
            freight,
            historical_source=historical_source,
            payment_amount=payment_amount,
        )
        group_key, group_name, is_unidentified = _responsible_key_from_freight(freight)
        acc = _get_group(group_key, group_name, is_unidentified)
        if freight.id_motorista_agregado is not None:
            acc.person_ids.append(freight.id_motorista_agregado)
        if freight.codigo_fonte_tarifa in ("PAULO_CRUZ", "JUST_IN_TIME"):
            acc.carrier_codes.append(freight.codigo_fonte_tarifa)
        acc.days.add(freight.data_servico)

        active_link = active_by_freight.get(freight.id_frete)
        freight_state: PaymentFreightState = "EM_ABERTO"
        freight_payment_code: UUID | None = None
        freight_payment_date: date | None = None
        freight_divergent = False
        if active_link is not None:
            _link_item, linked_payment = active_link
            acc.payment_ids.add(linked_payment.id_frete_pagamento)
            freight_state = (
                "PAGO" if linked_payment.status_pagamento == "PAGO" else "SOLICITADO"
            )
            freight_payment_code = UUID(linked_payment.codigo_pagamento)
            freight_payment_date = linked_payment.data_pagamento
            _div, _div_reason, div_ids = settlement_divergence.get(
                linked_payment.id_frete_pagamento, (False, None, set())
            )
            freight_divergent = freight.id_frete in div_ids

        if not payment_is_ready:
            pending_reason = reason or (
                "Valor líquido do frete não informado."
                if payment_amount is None
                else "Frete aguardando conferência."
            )
            pending_items.append(
                FreightPaymentPending(
                    codigo_frete=UUID(freight.codigo_frete),
                    data_servico=freight.data_servico,
                    nome_transportador=freight.nome_transportador,
                    rota_cidade=freight.rota_cidade,
                    valor_frete_bruto=freight.valor_frete_bruto,
                    valor_avaria=freight.valor_avaria,
                    valor_frete_pago=payment_amount,
                    motivo_pendencia=pending_reason,
                )
            )
            acc.pending_count += 1
            acc.freights.append(
                FreightPaymentFreightDetail(
                    id_frete=freight.id_frete,
                    codigo_frete=UUID(freight.codigo_frete),
                    data_servico=freight.data_servico,
                    rota_cidade=freight.rota_cidade,
                    nome_motorista_transportadora=freight.nome_motorista_transportadora,
                    quantidade_entregas=freight.quantidade_entregas,
                    peso_kg=freight.peso_kg,
                    valor_nota=freight.valor_nota,
                    valor_frete_bruto=freight.valor_frete_bruto,
                    valor_avaria=freight.valor_avaria,
                    valor_frete_pago=payment_amount,
                    pronto_para_pagamento=False,
                    motivo_pendencia=pending_reason,
                    status_pagamento_frete=freight_state,
                    codigo_pagamento=freight_payment_code,
                    data_pagamento=freight_payment_date,
                    valor_divergente=freight_divergent,
                )
            )
            continue

        warning = historical_warning_fn(freight)
        if warning is not None:
            warning_items.append(warning)

        gross = freight.valor_frete_bruto or Decimal("0")
        damage = freight.valor_avaria
        assert payment_amount is not None
        net = payment_amount
        gross_total += gross
        damage_total += damage
        net_total += net

        acc.ready_count += 1
        acc.gross += gross
        acc.damage += damage
        acc.freights_net += net
        if freight_state == "PAGO":
            acc.paid_count += 1
            acc.paid_value += net
        elif freight_state == "SOLICITADO":
            acc.requested_count += 1
            acc.requested_value += net
        else:
            acc.open_count += 1
            acc.open_value += net

        acc.freights.append(
            FreightPaymentFreightDetail(
                id_frete=freight.id_frete,
                codigo_frete=UUID(freight.codigo_frete),
                data_servico=freight.data_servico,
                rota_cidade=freight.rota_cidade,
                nome_motorista_transportadora=freight.nome_motorista_transportadora,
                quantidade_entregas=freight.quantidade_entregas,
                peso_kg=freight.peso_kg,
                valor_nota=freight.valor_nota,
                valor_frete_bruto=freight.valor_frete_bruto,
                valor_avaria=freight.valor_avaria,
                valor_frete_pago=net,
                pronto_para_pagamento=True,
                motivo_pendencia=None,
                status_pagamento_frete=freight_state,
                codigo_pagamento=freight_payment_code,
                data_pagamento=freight_payment_date,
                valor_divergente=freight_divergent,
            )
        )

    for adjustment in adjustments_list:
        if adjustment.id_frete_pagamento is not None:
            adj_pay = payments_by_id.get(adjustment.id_frete_pagamento)
            if adj_pay is not None and adj_pay.status_pagamento == "ESTORNADO":
                adj_pay = None
        else:
            adj_pay = None
        acc = _get_group(adjustment.nome_transportador, adjustment.nome_transportador, False)
        if adjustment.id_pessoa_responsavel is not None:
            acc.person_ids.append(adjustment.id_pessoa_responsavel)
        acc.adjustments.append(adjustment)
        if adj_pay is not None:
            acc.payment_ids.add(adj_pay.id_frete_pagamento)

    responsaveis_list: list[FreightPaymentResponsibleSummary] = []
    exec_pagos = 0
    exec_solicitados = 0
    exec_parciais = 0
    exec_abertos = 0
    exec_pendencias = 0
    exec_alteracoes = 0
    exec_nf_pendentes = 0
    exec_valor_pago = ZERO
    exec_valor_solicitado = ZERO
    exec_valor_aberto = ZERO
    exec_valor_ajustes = ZERO

    for acc in groups.values():
        person = _resolve_responsible_person(
            tipo_transporte=tipo_transporte,
            nome_transportador=acc.name,
            sem_identificacao=acc.unidentified,
            person_ids=acc.person_ids,
            carrier_codes=acc.carrier_codes,
            lookup=people_lookup,
        )
        exige_nf = (
            True
            if tipo_transporte == "TRANSPORTADORA"
            else bool(person.exige_nota_fiscal) if person is not None else False
        )
        adj_add = ZERO
        adj_sub = ZERO
        adj_paid_count = 0
        adj_req_count = 0
        adj_open_count = 0
        for adj in acc.adjustments:
            val = Decimal(adj.valor)
            signed = _adjustment_signed_value(adj)
            if adj.natureza == "ACRESCIMO":
                adj_add += val
            else:
                adj_sub += val
            linked = (
                payments_by_id.get(adj.id_frete_pagamento)
                if adj.id_frete_pagamento is not None
                else None
            )
            if linked is not None and linked.status_pagamento == "PAGO":
                acc.paid_value += signed
                adj_paid_count += 1
            elif linked is not None and linked.status_pagamento == "SOLICITADO":
                acc.requested_value += signed
                adj_req_count += 1
            else:
                acc.open_value += signed
                adj_open_count += 1

        adj_net = adj_add - adj_sub
        total_net = acc.freights_net + adj_net

        total_paid_units = acc.paid_count + adj_paid_count
        total_req_units = acc.requested_count + adj_req_count
        total_open_units = acc.open_count + adj_open_count

        if acc.pending_count > 0:
            resp_status: PaymentResponsibleStatus = "PENDENTE_CONFERENCIA"
        elif total_paid_units > 0 and total_req_units == 0 and total_open_units == 0:
            resp_status = "PAGO"
        elif total_req_units > 0 and total_paid_units == 0 and total_open_units == 0:
            resp_status = "SOLICITADO"
        elif total_paid_units > 0 or total_req_units > 0:
            resp_status = "PARCIAL"
        else:
            resp_status = "A_PAGAR"

        linked_payments = sorted(
            (payments_by_id[pid] for pid in acc.payment_ids if pid in payments_by_id),
            key=lambda p: (p.criado_em, p.id_frete_pagamento),
            reverse=True,
        )
        payment_summaries: list[FreightPaymentSettlementSummary] = []
        any_divergent = False
        div_reasons: list[str] = []
        latest_pay_date: date | None = None
        for lp in linked_payments:
            div_flag, div_reason, _ = settlement_divergence.get(
                lp.id_frete_pagamento, (False, None, set())
            )
            if div_flag:
                any_divergent = True
                if div_reason and div_reason not in div_reasons:
                    div_reasons.append(div_reason)
            if lp.data_pagamento is not None and (
                latest_pay_date is None or lp.data_pagamento > latest_pay_date
            ):
                latest_pay_date = lp.data_pagamento
            payment_summaries.append(
                _settlement_to_summary(
                    lp,
                    users_by_id=users_map,
                    lookup=people_lookup,
                    possui_alteracao=div_flag,
                    motivo_alteracao=div_reason,
                )
            )

        ultimo_pag = payment_summaries[0] if payment_summaries else None
        nf_pendente = bool(
            exige_nf
            and resp_status != "PAGO"
            and (
                (ultimo_pag is not None and not ultimo_pag.nf_recebida)
                or (ultimo_pag is None and (acc.ready_count > 0 or len(acc.adjustments) > 0))
            )
        )

        summary = FreightPaymentResponsibleSummary(
            chave_responsavel=acc.key,
            nome_transportador=acc.name,
            sem_identificacao=acc.unidentified,
            id_pessoa_responsavel=person.id_pessoa if person is not None else None,
            documento_fiscal=person.documento_fiscal if person is not None else None,
            chave_pix=person.chave_pix if person is not None else None,
            exige_nota_fiscal=exige_nf,
            quantidade_fretes=len(acc.freights),
            quantidade_fretes_prontos=acc.ready_count,
            quantidade_fretes_pendentes=acc.pending_count,
            quantidade_fretes_pagos=acc.paid_count,
            quantidade_fretes_solicitados=acc.requested_count,
            quantidade_fretes_em_aberto=acc.open_count,
            quantidade_dias=len(acc.days),
            valor_frete_bruto=_q2(acc.gross),
            valor_avarias=_q2(acc.damage),
            valor_ajustes_acrescimos=_q2(adj_add),
            valor_ajustes_descontos=_q2(adj_sub),
            valor_ajustes_liquido=_q2(adj_net),
            valor_liquido_total=_q2(total_net),
            valor_pago=_q2(acc.paid_value),
            valor_solicitado=_q2(acc.requested_value),
            valor_em_aberto=_q2(acc.open_value),
            status_pagamento=resp_status,
            possui_alteracao=any_divergent,
            motivo_alteracao=" ".join(div_reasons) if div_reasons else None,
            data_pagamento_mais_recente=latest_pay_date,
            nf_pendente=nf_pendente,
            ultimo_pagamento=ultimo_pag,
            pagamentos=payment_summaries,
            fretes=acc.freights,
            ajustes=[
                _adjustment_to_schema(a, payments_by_id=payments_by_id, users_by_id=users_map)
                for a in acc.adjustments
            ],
        )
        responsaveis_list.append(summary)

        if resp_status == "PAGO":
            exec_pagos += 1
        elif resp_status == "SOLICITADO":
            exec_solicitados += 1
        elif resp_status == "PARCIAL":
            exec_parciais += 1
        elif resp_status == "A_PAGAR":
            exec_abertos += 1
        else:
            exec_pendencias += 1
        if any_divergent:
            exec_alteracoes += 1
        if nf_pendente:
            exec_nf_pendentes += 1
        exec_valor_pago += acc.paid_value
        exec_valor_solicitado += acc.requested_value
        exec_valor_aberto += acc.open_value
        exec_valor_ajustes += adj_net

    responsaveis_list.sort(key=_responsible_sort_key)

    adjustment_items = [
        _adjustment_to_schema(adj, payments_by_id=payments_by_id, users_by_id=users_map)
        for adj in adjustments_list
    ]

    return FreightPaymentReport(
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
        quantidade_fretes=len(records),
        quantidade_pendentes=len(pending_items),
        pendencias=pending_items,
        avisos=warning_items,
        valor_frete_bruto=_q2(gross_total),
        valor_avarias=_q2(damage_total),
        valor_a_pagar=_q2(net_total + exec_valor_ajustes),
        resumo_execucao=FreightPaymentExecutionSummary(
            total_responsaveis=len(responsaveis_list),
            responsaveis_pagos=exec_pagos,
            responsaveis_solicitados=exec_solicitados,
            responsaveis_parciais=exec_parciais,
            responsaveis_em_aberto=exec_abertos,
            responsaveis_com_pendencia=exec_pendencias,
            responsaveis_com_alteracao=exec_alteracoes,
            nf_pendentes=exec_nf_pendentes,
            valor_pago=_q2(exec_valor_pago),
            valor_solicitado=_q2(exec_valor_solicitado),
            valor_em_aberto=_q2(exec_valor_aberto),
            valor_ajustes=_q2(exec_valor_ajustes),
        ),
        responsaveis=responsaveis_list,
        ajustes=adjustment_items,
    )


def build_payment_report(
    db: Session,
    *,
    sector_id: int,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
    dedup_fn,
    payment_amount_fn,
    historical_source_fn,
    historical_warning_fn,
) -> FreightPaymentReport:
    """Carrega fretes, fechamentos, ajustes e pessoas para compor o relatório financeiro."""
    records = repository.list_payment_freights(
        db,
        id_setor=sector_id,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
    )
    records = dedup_fn(records)
    freight_ids = [freight.id_frete for freight in records]
    active_links = repository.list_active_payment_items_for_freights(
        db, freight_ids=freight_ids
    )
    active_by_freight: dict[int, tuple[FretePagamentoItem, FretePagamento]] = {
        item.id_frete: (item, payment) for item, payment in active_links
    }
    adjustments = (
        []
        if sem_identificacao
        else repository.list_payment_adjustments(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
        )
    )
    payment_ids_set = {payment.id_frete_pagamento for _, payment in active_links}
    extra_payments: dict[int, FretePagamento] = {}
    for adj in adjustments:
        if adj.id_frete_pagamento is not None:
            payment_ids_set.add(adj.id_frete_pagamento)
            if adj.id_frete_pagamento not in {p.id_frete_pagamento for _, p in active_links}:
                loaded_payment = db.get(FretePagamento, adj.id_frete_pagamento)
                if loaded_payment is not None and loaded_payment.status_pagamento != "ESTORNADO":
                    extra_payments[loaded_payment.id_frete_pagamento] = loaded_payment

    all_items: list[FretePagamentoItem] = []
    items_by_payment: dict[int, list[FretePagamentoItem]] = {}
    if payment_ids_set:
        all_items = repository.list_payment_items_by_payment_ids(
            db, payment_ids=sorted(payment_ids_set)
        )
        for item in all_items:
            items_by_payment.setdefault(item.id_frete_pagamento, []).append(item)

    extra_freight_ids = sorted(
        {item.id_frete for item in all_items} - {freight.id_frete for freight in records}
    )
    freights_lookup = {freight.id_frete: freight for freight in records}
    if extra_freight_ids:
        freights_lookup.update(repository.list_freights_by_ids(db, freight_ids=extra_freight_ids))
    all_checked_freight_ids = sorted({item.id_frete for item in all_items})
    cancellations = repository.list_freight_cancellations(
        db, freight_ids=all_checked_freight_ids
    )

    user_ids: set[int] = set()
    for payment in [p for _, p in active_links] + list(extra_payments.values()):
        user_ids.add(payment.criado_por)
        if payment.pago_por is not None:
            user_ids.add(payment.pago_por)
        if payment.estornado_por is not None:
            user_ids.add(payment.estornado_por)
    for adj in adjustments:
        user_ids.add(adj.criado_por)

    people = repository.list_outsourced_people_for_payments(db)
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)

    return build_payment_report_from_records(
        records,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
        payment_amount_fn=payment_amount_fn,
        historical_source_fn=historical_source_fn,
        historical_warning_fn=historical_warning_fn,
        active_items_by_freight=active_by_freight,
        extra_payments_by_id=extra_payments,
        all_settlement_items_by_payment=items_by_payment,
        settlement_freights_by_id=freights_lookup,
        cancellations=cancellations,
        adjustments=adjustments,
        people=people,
        users_by_id=users_by_id,
    )


def create_payment_settlements(
    db: Session,
    *,
    sector_id: int,
    actor_id: int,
    payload: FreightPaymentSettlementCreateRequest,
    dedup_fn,
    payment_amount_fn,
    historical_source_fn,
    historical_warning_fn,
) -> list[FreightPaymentSettlementSummary]:
    """Registra solicitação ou pagamento efetivo para um ou mais responsáveis no período."""
    if payload.data_de > payload.data_ate:
        raise ConflictError("A data inicial deve ser anterior à data final.")
    if payload.sem_identificacao and payload.tipo_transporte != "AGREGADO":
        raise ConflictError("A opção sem identificação só se aplica aos agregados.")
    if payload.sem_identificacao and payload.responsaveis:
        raise ConflictError("Escolha responsáveis ou a opção sem identificação, não ambos.")

    target_filter_name = (
        payload.responsaveis[0]
        if payload.responsaveis and len(payload.responsaveis) == 1
        and payload.responsaveis[0] != UNIDENTIFIED_KEY
        else None
    )
    target_unidentified = payload.sem_identificacao or (
        payload.responsaveis is not None
        and len(payload.responsaveis) == 1
        and payload.responsaveis[0] == UNIDENTIFIED_KEY
    )

    records = repository.list_payment_freights(
        db,
        id_setor=sector_id,
        data_de=payload.data_de,
        data_ate=payload.data_ate,
        tipo_transporte=payload.tipo_transporte,
        nome_transportador=target_filter_name,
        sem_identificacao=target_unidentified,
    )
    records = dedup_fn(records)
    adjustments = (
        []
        if target_unidentified
        else repository.list_payment_adjustments(
            db,
            id_setor=sector_id,
            data_de=payload.data_de,
            data_ate=payload.data_ate,
            tipo_transporte=payload.tipo_transporte,
            nome_transportador=target_filter_name,
        )
    )
    selected_keys: set[str] | None = None
    if payload.sem_identificacao:
        selected_keys = {UNIDENTIFIED_KEY}
    elif payload.responsaveis:
        selected_keys = set(payload.responsaveis)

    freight_ids = [freight.id_frete for freight in records]
    active_links = repository.list_active_payment_items_for_freights(db, freight_ids=freight_ids)
    active_by_freight = {item.id_frete: payment for item, payment in active_links}

    grouped_freights: dict[str, list[Frete]] = {}
    grouped_labels: dict[str, tuple[str, bool]] = {}
    for freight in records:
        key, name, is_unid = _responsible_key_from_freight(freight)
        if selected_keys is not None and key not in selected_keys:
            continue
        grouped_freights.setdefault(key, []).append(freight)
        grouped_labels[key] = (name, is_unid)

    grouped_adjustments: dict[str, list[FreteAjusteFinanceiro]] = {}
    for adj in adjustments:
        key = adj.nome_transportador
        if selected_keys is not None and key not in selected_keys:
            continue
        grouped_adjustments.setdefault(key, []).append(adj)
        grouped_labels.setdefault(key, (adj.nome_transportador, False))

    if not grouped_labels:
        raise ConflictError("Nenhum responsável encontrado no período para este fechamento.")

    people = repository.list_outsourced_people_for_payments(db)
    people_lookup = _build_people_lookup(people)
    now = _utc_now()
    effective_payment_date = (
        payload.data_pagamento or _business_today()
        if payload.acao == "MARCAR_PAGO"
        else None
    )

    touched_payments: list[FretePagamento] = []
    for key in sorted(grouped_labels, key=str.casefold):
        name, is_unid = grouped_labels[key]
        resp_freights = grouped_freights.get(key, [])
        resp_adjustments = grouped_adjustments.get(key, [])

        # Bloqueia apenas este responsável se ele tiver fretes pendentes de conferência.
        open_ready_freights: list[tuple[Frete, Decimal]] = []
        requested_payment_ids: set[int] = set()
        person_ids: list[int] = []
        carrier_codes: list[str] = []

        for freight in resp_freights:
            if freight.id_motorista_agregado is not None:
                person_ids.append(freight.id_motorista_agregado)
            if freight.codigo_fonte_tarifa in ("PAULO_CRUZ", "JUST_IN_TIME"):
                carrier_codes.append(freight.codigo_fonte_tarifa)
            amount = payment_amount_fn(freight)
            ready, _ = _is_freight_payment_ready(
                freight,
                historical_source=historical_source_fn(freight),
                payment_amount=amount,
            )
            if not ready:
                raise ConflictError(
                    f"Resolva os fretes pendentes de conferência de {name} antes de fechar o pagamento."
                )
            assert amount is not None
            linked_payment = active_by_freight.get(freight.id_frete)
            if linked_payment is None:
                open_ready_freights.append((freight, amount))
            elif linked_payment.status_pagamento == "SOLICITADO":
                requested_payment_ids.add(linked_payment.id_frete_pagamento)

        open_adjustments: list[FreteAjusteFinanceiro] = []
        for adj in resp_adjustments:
            if adj.id_pessoa_responsavel is not None:
                person_ids.append(adj.id_pessoa_responsavel)
            if adj.id_frete_pagamento is None:
                open_adjustments.append(adj)

        # Ao marcar como pago, efetiva primeiro lotes SOLICITADOS existentes desse responsável.
        if payload.acao == "MARCAR_PAGO" and payload.incluir_solicitados and requested_payment_ids:
            for req_id in sorted(requested_payment_ids):
                existing = db.get(FretePagamento, req_id)
                if existing is not None and existing.status_pagamento == "SOLICITADO":
                    existing.status_pagamento = "PAGO"
                    existing.data_pagamento = effective_payment_date
                    existing.pago_por = actor_id
                    existing.pago_em = now
                    if payload.observacao:
                        existing.observacao = payload.observacao
                    if payload.nf_numero or payload.nf_recebida:
                        existing.nf_numero = payload.nf_numero
                        existing.nf_data = payload.nf_data
                        existing.nf_recebida = payload.nf_recebida
                    touched_payments.append(existing)

        if not open_ready_freights and not open_adjustments:
            continue

        person = _resolve_responsible_person(
            tipo_transporte=payload.tipo_transporte,
            nome_transportador=name,
            sem_identificacao=is_unid,
            person_ids=person_ids,
            carrier_codes=carrier_codes,
            lookup=people_lookup,
        )
        gross_sum = sum(
            (freight.valor_frete_bruto or ZERO for freight, _ in open_ready_freights),
            ZERO,
        )
        damage_sum = sum(
            (Decimal(freight.valor_avaria) for freight, _ in open_ready_freights),
            ZERO,
        )
        freights_net = sum((amount for _, amount in open_ready_freights), ZERO)
        adjustments_net = sum(
            (_adjustment_signed_value(adj) for adj in open_adjustments),
            ZERO,
        )
        service_days = {freight.data_servico for freight, _ in open_ready_freights}
        status_value: PaymentSettlementStatus = (
            "PAGO" if payload.acao == "MARCAR_PAGO" else "SOLICITADO"
        )
        settlement = FretePagamento(
            codigo_pagamento=str(uuid4()),
            id_setor=sector_id,
            tipo_transporte=payload.tipo_transporte,
            nome_transportador=name,
            sem_identificacao=is_unid,
            id_pessoa_responsavel=person.id_pessoa if person is not None else None,
            data_de=payload.data_de,
            data_ate=payload.data_ate,
            status_pagamento=status_value,
            quantidade_fretes=len(open_ready_freights),
            quantidade_dias=len(service_days),
            valor_frete_bruto=_q2(gross_sum),
            valor_avarias=_q2(damage_sum),
            valor_ajustes=_q2(adjustments_net),
            valor_liquido_registrado=_q2(freights_net + adjustments_net),
            data_pagamento=effective_payment_date,
            nf_numero=payload.nf_numero,
            nf_data=payload.nf_data,
            nf_recebida=payload.nf_recebida,
            observacao=payload.observacao,
            criado_por=actor_id,
            criado_em=now,
            pago_por=actor_id if status_value == "PAGO" else None,
            pago_em=now if status_value == "PAGO" else None,
            estornado_por=None,
            estornado_em=None,
            motivo_estorno=None,
        )
        db.add(settlement)
        db.flush()

        for freight, amount in open_ready_freights:
            db.add(
                FretePagamentoItem(
                    id_frete_pagamento=settlement.id_frete_pagamento,
                    id_frete=freight.id_frete,
                    id_frete_ativo=freight.id_frete,
                    data_servico_snapshot=freight.data_servico,
                    valor_frete_bruto_snapshot=freight.valor_frete_bruto,
                    valor_avaria_snapshot=_q2(Decimal(freight.valor_avaria)),
                    valor_frete_pago_snapshot=_q2(amount),
                )
            )
        for adj in open_adjustments:
            adj.id_frete_pagamento = settlement.id_frete_pagamento
        touched_payments.append(settlement)

    if not touched_payments:
        raise ConflictError(
            "Não há fretes ou ajustes pendentes de fechamento para os responsáveis selecionados."
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "Um ou mais fretes já pertencem a outro fechamento ativo. Atualize a tela e tente novamente."
        ) from exc

    user_ids = {
        uid
        for p in touched_payments
        for uid in (p.criado_por, p.pago_por, p.estornado_por)
        if uid is not None
    }
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)
    return [
        _settlement_to_summary(p, users_by_id=users_by_id, lookup=people_lookup)
        for p in touched_payments
    ]


def update_payment_settlement_status(
    db: Session,
    *,
    sector_id: int,
    actor_id: int,
    codigo_pagamento: UUID,
    payload: FreightPaymentSettlementStatusRequest,
) -> FreightPaymentSettlementSummary:
    """Atualiza status de um fechamento: marcar pago, desfazer pago ou estornar."""
    settlement = repository.get_payment_by_code(
        db, codigo_pagamento=codigo_pagamento, id_setor=sector_id, lock=True
    )
    if settlement is None:
        raise NotFoundError("Fechamento de pagamento não encontrado.")

    now = _utc_now()
    if payload.acao == "MARCAR_PAGO":
        if settlement.status_pagamento == "ESTORNADO":
            raise ConflictError("Não é possível pagar um fechamento estornado.")
        if settlement.status_pagamento == "PAGO":
            raise ConflictError("Este fechamento já está marcado como pago.")
        settlement.status_pagamento = "PAGO"
        settlement.data_pagamento = payload.data_pagamento or _business_today()
        settlement.pago_por = actor_id
        settlement.pago_em = now
        if payload.observacao is not None:
            settlement.observacao = payload.observacao
    elif payload.acao == "DESFAZER_PAGO":
        if settlement.status_pagamento != "PAGO":
            raise ConflictError("Apenas fechamentos pagos podem voltar para solicitado.")
        settlement.status_pagamento = "SOLICITADO"
        settlement.data_pagamento = None
        settlement.pago_por = None
        settlement.pago_em = None
        if payload.observacao is not None:
            settlement.observacao = payload.observacao
    elif payload.acao == "ESTORNAR":
        if settlement.status_pagamento == "ESTORNADO":
            raise ConflictError("Este fechamento já foi estornado.")
        reason = (payload.motivo_estorno or "").strip()
        if len(reason) < 3:
            raise ConflictError("Informe o motivo do estorno (mínimo de 3 caracteres).")
        settlement.status_pagamento = "ESTORNADO"
        settlement.estornado_por = actor_id
        settlement.estornado_em = now
        settlement.motivo_estorno = reason
        items = repository.list_payment_items_by_payment_ids(
            db, payment_ids=[settlement.id_frete_pagamento]
        )
        for item in items:
            item.id_frete_ativo = None
        bound_adjustments = repository.list_payment_adjustments(
            db,
            id_setor=sector_id,
            payment_ids=[settlement.id_frete_pagamento],
        )
        for adj in bound_adjustments:
            adj.id_frete_pagamento = None

    db.commit()
    people_lookup = _build_people_lookup(repository.list_outsourced_people_for_payments(db))
    user_ids = {
        uid
        for uid in (settlement.criado_por, settlement.pago_por, settlement.estornado_por)
        if uid is not None
    }
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)
    return _settlement_to_summary(settlement, users_by_id=users_by_id, lookup=people_lookup)


def update_payment_settlement_invoice(
    db: Session,
    *,
    sector_id: int,
    codigo_pagamento: UUID,
    payload: FreightPaymentInvoiceUpdateRequest,
) -> FreightPaymentSettlementSummary:
    """Atualiza os dados de nota fiscal vinculados a um fechamento de pagamento."""
    settlement = repository.get_payment_by_code(
        db, codigo_pagamento=codigo_pagamento, id_setor=sector_id, lock=True
    )
    if settlement is None:
        raise NotFoundError("Fechamento de pagamento não encontrado.")
    if settlement.status_pagamento == "ESTORNADO":
        raise ConflictError("Não é possível alterar NF de um fechamento estornado.")
    settlement.nf_numero = payload.nf_numero
    settlement.nf_data = payload.nf_data
    settlement.nf_recebida = payload.nf_recebida
    db.commit()
    people_lookup = _build_people_lookup(repository.list_outsourced_people_for_payments(db))
    user_ids = {
        uid
        for uid in (settlement.criado_por, settlement.pago_por, settlement.estornado_por)
        if uid is not None
    }
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)
    return _settlement_to_summary(settlement, users_by_id=users_by_id, lookup=people_lookup)


def list_payment_settlements(
    db: Session,
    *,
    sector_id: int,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: PaymentTransportType | None,
    status_pagamento: PaymentSettlementStatus | None,
    nome_transportador: str | None,
    incluir_estornados: bool,
    limit: int,
    offset: int,
    payment_amount_fn,
    historical_source_fn,
) -> FreightPaymentSettlementPage:
    """Lista fechamentos financeiros para a aba de histórico com detecção de divergência."""
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise ConflictError("A data inicial deve ser anterior à data final.")
    rows, total = repository.list_payment_settlements(
        db,
        id_setor=sector_id,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        status_pagamento=status_pagamento,
        nome_transportador=nome_transportador,
        incluir_estornados=incluir_estornados,
        limit=limit,
        offset=offset,
    )
    payment_ids = [row.id_frete_pagamento for row in rows if row.status_pagamento != "ESTORNADO"]
    items = repository.list_payment_items_by_payment_ids(db, payment_ids=payment_ids)
    items_by_payment: dict[int, list[FretePagamentoItem]] = {}
    freight_ids: set[int] = set()
    for item in items:
        items_by_payment.setdefault(item.id_frete_pagamento, []).append(item)
        freight_ids.add(item.id_frete)

    freights_by_id = repository.list_freights_by_ids(db, freight_ids=sorted(freight_ids))
    cancellations = repository.list_freight_cancellations(db, freight_ids=sorted(freight_ids))
    people_lookup = _build_people_lookup(repository.list_outsourced_people_for_payments(db))
    user_ids = {
        uid
        for row in rows
        for uid in (row.criado_por, row.pago_por, row.estornado_por)
        if uid is not None
    }
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)

    summaries: list[FreightPaymentSettlementSummary] = []
    for row in rows:
        div_flag, div_reason, _ = _compute_settlement_divergence(
            row,
            items=items_by_payment.get(row.id_frete_pagamento, []),
            freights_by_id=freights_by_id,
            cancellations=cancellations,
            payment_amount_fn=payment_amount_fn,
            historical_source_fn=historical_source_fn,
        )
        summaries.append(
            _settlement_to_summary(
                row,
                users_by_id=users_by_id,
                lookup=people_lookup,
                possui_alteracao=div_flag,
                motivo_alteracao=div_reason,
            )
        )
    return FreightPaymentSettlementPage(
        items=summaries,
        total=total,
        limit=limit,
        offset=offset,
    )


def list_payment_adjustments(
    db: Session,
    *,
    sector_id: int,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: PaymentTransportType | None,
    nome_transportador: str | None,
) -> list[FreightPaymentAdjustmentItem]:
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise ConflictError("A data inicial deve ser anterior à data final.")
    rows = repository.list_payment_adjustments(
        db,
        id_setor=sector_id,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
    )
    payment_ids = sorted(
        {row.id_frete_pagamento for row in rows if row.id_frete_pagamento is not None}
    )
    payments_by_id: dict[int, FretePagamento] = {}
    for pid in payment_ids:
        payment = db.get(FretePagamento, pid)
        if payment is not None:
            payments_by_id[pid] = payment
    user_ids = {row.criado_por for row in rows}
    users_by_id = repository.list_user_names_by_ids(db, user_ids=user_ids)
    return [
        _adjustment_to_schema(row, payments_by_id=payments_by_id, users_by_id=users_by_id)
        for row in rows
    ]


def create_payment_adjustments(
    db: Session,
    *,
    sector_id: int,
    actor_id: int,
    payload: FreightPaymentAdjustmentCreateRequest,
) -> list[FreightPaymentAdjustmentItem]:
    """Cria lançamento financeiro extra à vista ou parcelado (semanal/mensal)."""
    people_lookup = _build_people_lookup(repository.list_outsourced_people_for_payments(db))
    person = _resolve_responsible_person(
        tipo_transporte=payload.tipo_transporte,
        nome_transportador=payload.nome_transportador,
        sem_identificacao=False,
        person_ids=[],
        carrier_codes=[],
        lookup=people_lookup,
    )
    now = _utc_now()
    total_value = _q2(Decimal(payload.valor))
    n = payload.parcelas
    base_part = _q2(total_value / Decimal(n))
    created: list[FreteAjusteFinanceiro] = []
    accumulated = ZERO
    for idx in range(n):
        part_value = _q2(total_value - accumulated) if idx == n - 1 else base_part
        accumulated = _q2(accumulated + part_value)
        if part_value <= ZERO:
            raise ConflictError("O valor por parcela deve ser maior que zero.")
        ref_date = (
            payload.data_referencia + timedelta(days=7 * idx)
            if payload.periodicidade == "SEMANAL"
            else _add_months(payload.data_referencia, idx)
        )
        desc = f"{payload.descricao} ({idx + 1}/{n})" if n > 1 else payload.descricao
        row = FreteAjusteFinanceiro(
            codigo_ajuste=str(uuid4()),
            id_setor=sector_id,
            tipo_transporte=payload.tipo_transporte,
            nome_transportador=payload.nome_transportador,
            id_pessoa_responsavel=person.id_pessoa if person is not None else None,
            data_referencia=ref_date,
            natureza=payload.natureza,
            categoria=payload.categoria,
            descricao=desc[:200],
            valor=part_value,
            observacao=payload.observacao,
            id_frete_pagamento=None,
            ativo=True,
            criado_por=actor_id,
            criado_em=now,
            removido_por=None,
            removido_em=None,
        )
        db.add(row)
        created.append(row)
    db.commit()
    users_by_id = repository.list_user_names_by_ids(db, user_ids={actor_id})
    return [
        _adjustment_to_schema(row, payments_by_id={}, users_by_id=users_by_id)
        for row in created
    ]


def delete_payment_adjustment(
    db: Session,
    *,
    sector_id: int,
    actor_id: int,
    codigo_ajuste: UUID,
) -> None:
    """Desativa um ajuste financeiro ainda não fechado em pagamento ativo."""
    row = repository.get_payment_adjustment_by_code(
        db, codigo_ajuste=codigo_ajuste, id_setor=sector_id, lock=True
    )
    if row is None or not row.ativo:
        raise NotFoundError("Lançamento financeiro não encontrado.")
    if row.id_frete_pagamento is not None:
        payment = db.get(FretePagamento, row.id_frete_pagamento)
        if payment is not None and payment.status_pagamento != "ESTORNADO":
            raise ConflictError(
                "Este lançamento já está vinculado a um pagamento fechado. Estorne o pagamento antes de excluí-lo."
            )
    row.ativo = False
    row.removido_por = actor_id
    row.removido_em = _utc_now()
    db.commit()


def get_pending_payment_summary(
    db: Session,
    *,
    sector_id: int,
    dedup_fn,
    payment_amount_fn,
    historical_source_fn,
    historical_warning_fn,
) -> FreightPaymentPendingSummary:
    """Resume pendências da semana atual (seg–dom) para badge no menu lateral."""
    today = _business_today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    open_responsibles = 0
    pending_responsibles = 0
    nf_pending = 0
    open_value = ZERO
    for modality in ("AGREGADO", "TRANSPORTADORA"):
        report = build_payment_report(
            db,
            sector_id=sector_id,
            data_de=week_start,
            data_ate=week_end,
            tipo_transporte=modality,  # type: ignore[arg-type]
            nome_transportador=None,
            sem_identificacao=False,
            dedup_fn=dedup_fn,
            payment_amount_fn=payment_amount_fn,
            historical_source_fn=historical_source_fn,
            historical_warning_fn=historical_warning_fn,
        )
        open_responsibles += (
            report.resumo_execucao.responsaveis_em_aberto
            + report.resumo_execucao.responsaveis_parciais
        )
        pending_responsibles += report.resumo_execucao.responsaveis_com_pendencia
        nf_pending += report.resumo_execucao.nf_pendentes
        open_value += report.resumo_execucao.valor_em_aberto
    return FreightPaymentPendingSummary(
        semana_de=week_start,
        semana_ate=week_end,
        responsaveis_em_aberto=open_responsibles,
        responsaveis_com_pendencia=pending_responsibles,
        nf_pendentes=nf_pending,
        valor_em_aberto=_q2(open_value),
    )


def _render_payment_xlsx(
    rows: list[tuple[str, str | None, str, Decimal, str]],
) -> bytes:
    """Gera o arquivo XLSX no layout padrão da Solicitação de Pagamento Extra."""
    workbook = Workbook()
    worksheet = workbook.active
    assert worksheet is not None
    worksheet.title = "Sheet1"
    worksheet.sheet_view.showGridLines = False
    workbook.properties.creator = "Portal de Logística"
    workbook.properties.title = "Solicitação de pagamento de Fretes"

    dark = "FF000000"
    dark_gray = "FF808080"
    medium_gray = "FF404040"
    white = "FFFFFFFF"
    black = "FF000000"
    thin = Side(style="thin", color=black)
    medium = Side(style="medium", color=black)
    currency_format = (
        r'_-[$R$-416]\ * #,##0.00_-;\-[$R$-416]\ * #,##0.00_-;_-[$R$-416]\ * "-"??_-;_-@_-'
    )

    widths = (28.140625, 28.7109375, 41.28515625, 20.140625, 19.140625, 40.7109375)
    for index, width in enumerate(widths, start=1):
        worksheet.column_dimensions[chr(64 + index)].width = width

    worksheet.merge_cells("A1:F1")
    title = worksheet["A1"]
    title.value = "Solicitação de pagamento Extra"
    title.font = Font(name="Calibri", size=24, bold=True, italic=True, color=white)
    title.fill = PatternFill("solid", fgColor=dark_gray)
    title.alignment = Alignment(horizontal="center", vertical="center")
    worksheet.row_dimensions[1].height = 32.25

    for cell in worksheet[2]:
        if cell.column is not None and cell.column <= 6:
            cell.fill = PatternFill("solid", fgColor=medium_gray)
            cell.border = Border(left=medium, right=medium, top=medium, bottom=medium)
    worksheet["A2"] = "Data"
    worksheet["A2"].font = Font(name="Calibri", size=11, bold=True, color=white)
    worksheet["A2"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet["C2"] = _business_today()
    worksheet["C2"].number_format = "dd/mm/yyyy"
    worksheet["C2"].font = Font(name="Calibri", size=14, bold=True, italic=True, color=white)
    worksheet["C2"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet.row_dimensions[2].height = 21.75

    headers = ("Nome", "CPF", "Motivo", "Setor", "Valor Total", "Observações")
    for column, value in enumerate(headers, start=1):
        cell = worksheet.cell(row=3, column=column, value=value)
        cell.font = Font(name="Calibri", size=11, bold=True, color=white)
        cell.fill = PatternFill("solid", fgColor="FF0D0D0D")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(
            left=medium if column == 1 else thin,
            right=thin,
            top=medium,
            bottom=thin,
        )

    data_start = 4
    data_end = data_start + len(rows) - 1
    data_slot_end = max(23, data_end)

    for offset, (name, cpf, reason, total_value, observations) in enumerate(rows):
        row_index = data_start + offset
        values_for_row: tuple[object, ...] = (
            name,
            cpf,
            reason,
            "TRANSPORTE",
            total_value,
            observations,
        )
        for column, value in enumerate(values_for_row, start=1):
            cell = worksheet.cell(row=row_index, column=column, value=value)
            if isinstance(value, str):
                cell.data_type = "s"
            cell.font = Font(name="Calibri", size=16, color=black)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(
                left=medium if column == 1 else thin,
                right=thin,
                top=thin,
                bottom=medium if row_index == data_slot_end else thin,
            )
            if column == 5:
                cell.fill = PatternFill("solid", fgColor="FFD9D9D9")
                cell.number_format = currency_format
        worksheet.row_dimensions[row_index].height = 42

    for row_index in range(max(data_start, data_end + 1), data_slot_end + 1):
        worksheet.row_dimensions[row_index].height = 21
        for column in range(1, 7):
            cell = worksheet.cell(row=row_index, column=column)
            cell.font = Font(name="Calibri", size=16, color=black)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(
                left=medium if column == 1 else thin,
                right=thin,
                top=thin,
                bottom=medium if row_index == data_slot_end else thin,
            )
            if column == 5:
                cell.fill = PatternFill("solid", fgColor="FFD9D9D9")
                cell.number_format = currency_format

    if data_end < data_slot_end:
        worksheet.row_dimensions[data_slot_end].height = 21.75

    total_row = data_slot_end + 1
    for column in (4, 5):
        cell = worksheet.cell(row=total_row, column=column)
        cell.fill = PatternFill("solid", fgColor=dark)
        cell.font = Font(name="Calibri", size=16, bold=column == 4, color=white)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = Border(left=medium, right=medium, top=medium, bottom=medium)
    worksheet.cell(row=total_row, column=4, value="TOTAL GERAL")
    total = worksheet.cell(row=total_row, column=5)
    total.value = f"=SUM(E{data_start}:E{data_slot_end})"
    total.number_format = currency_format
    worksheet.row_dimensions[total_row].height = 21.75

    worksheet.page_setup.orientation = "landscape"
    worksheet.page_setup.paperSize = worksheet.PAPERSIZE_A4
    worksheet.page_setup.scale = 69
    worksheet.page_margins = PageMargins(
        left=0.7086614173228347,
        right=0.7086614173228347,
        top=0.7480314960629921,
        bottom=0.7480314960629921,
        header=0.3149606299212598,
        footer=0.3149606299212598,
    )
    worksheet.print_area = f"A1:F{total_row}"

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def export_payment_report(
    db: Session,
    *,
    sector_id: int,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
    responsaveis: list[str] | None,
    apenas_em_aberto: bool,
    codigo_pagamento: UUID | None,
    dedup_fn,
    payment_amount_fn,
    historical_source_fn,
    historical_warning_fn,
) -> bytes:
    """Exporta XLSX por período, por seleção de responsáveis ou por lote histórico."""
    people_lookup = _build_people_lookup(repository.list_outsourced_people_for_payments(db))

    if codigo_pagamento is not None:
        settlement = repository.get_payment_by_code(
            db, codigo_pagamento=codigo_pagamento, id_setor=sector_id
        )
        if settlement is None:
            raise NotFoundError("Fechamento de pagamento não encontrado.")
        person = _resolve_responsible_person(
            tipo_transporte=settlement.tipo_transporte,
            nome_transportador=settlement.nome_transportador,
            sem_identificacao=settlement.sem_identificacao,
            person_ids=[settlement.id_pessoa_responsavel]
            if settlement.id_pessoa_responsavel is not None
            else [],
            carrier_codes=[],
            lookup=people_lookup,
        )
        reason_prefix = (
            "AGREGADO" if settlement.tipo_transporte == "AGREGADO" else "TRANSPORTADORA"
        )
        days_label = "DIA" if settlement.quantidade_dias == 1 else "DIAS"
        notes: list[str] = []
        if settlement.valor_ajustes != ZERO:
            notes.append(f"Ajustes: {_format_brl(Decimal(settlement.valor_ajustes))}")
        if settlement.nf_numero:
            notes.append(f"NF {settlement.nf_numero}")
        if settlement.observacao:
            notes.append(settlement.observacao)
        return _render_payment_xlsx(
            [
                (
                    settlement.nome_transportador,
                    person.documento_fiscal if person is not None else None,
                    f"{reason_prefix} TOTAL DE {settlement.quantidade_dias} {days_label}",
                    _q2(Decimal(settlement.valor_liquido_registrado)),
                    " · ".join(notes),
                )
            ]
        )

    if data_de is None or data_ate is None:
        raise ConflictError("Informe data_de e data_ate para exportar o pagamento.")
    if data_de > data_ate:
        raise ConflictError("A data inicial deve ser anterior à data final.")
    if sem_identificacao and tipo_transporte != "AGREGADO":
        raise ConflictError("A opção sem identificação só se aplica aos agregados.")
    if sem_identificacao and nome_transportador is not None:
        raise ConflictError("Escolha um nome ou a opção sem identificação, não ambos.")

    report = build_payment_report(
        db,
        sector_id=sector_id,
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
        dedup_fn=dedup_fn,
        payment_amount_fn=payment_amount_fn,
        historical_source_fn=historical_source_fn,
        historical_warning_fn=historical_warning_fn,
    )

    selected_set = set(responsaveis) if responsaveis else None
    target_responsaveis = [
        resp
        for resp in report.responsaveis
        if selected_set is None or resp.chave_responsavel in selected_set
    ]

    if selected_set is None and report.quantidade_pendentes:
        raise ConflictError(
            "Resolva os fretes pendentes de conferência antes de exportar o pagamento."
        )
    if any(resp.quantidade_fretes_pendentes > 0 for resp in target_responsaveis):
        raise ConflictError(
            "Resolva os fretes pendentes de conferência antes de exportar o pagamento."
        )

    payment_reason = "AGREGADO" if tipo_transporte == "AGREGADO" else "TRANSPORTADORA"
    rows: list[tuple[str, str | None, str, Decimal, str]] = []
    for resp in sorted(target_responsaveis, key=lambda item: item.nome_transportador.casefold()):
        if apenas_em_aberto:
            open_freights = [
                f
                for f in resp.fretes
                if f.pronto_para_pagamento and f.status_pagamento_frete == "EM_ABERTO"
            ]
            open_adjs = [a for a in resp.ajustes if not a.vinculado_pagamento]
            if not open_freights and not open_adjs:
                continue
            days_count = len({f.data_servico for f in open_freights})
            net_amount = resp.valor_em_aberto
            adj_delta = sum(
                (a.valor if a.natureza == "ACRESCIMO" else -a.valor for a in open_adjs),
                ZERO,
            )
        else:
            days_count = resp.quantidade_dias
            net_amount = resp.valor_liquido_total
            adj_delta = resp.valor_ajustes_liquido

        days_label = "DIA" if days_count == 1 else "DIAS"
        obs = f"Ajustes: {_format_brl(adj_delta)}" if adj_delta != ZERO else ""
        rows.append(
            (
                resp.nome_transportador,
                resp.documento_fiscal,
                f"{payment_reason} TOTAL DE {days_count} {days_label}",
                _q2(net_amount),
                obs,
            )
        )

    return _render_payment_xlsx(rows)
