"""Agregações e detalhamento sob demanda do Painel Gerencial de Transportes."""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from collections import defaultdict
from datetime import date
from decimal import Decimal
from time import perf_counter
from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import APIError, NotFoundError, PermissionDeniedError, ServiceUnavailableError
from app.modules.access_control.catalog import DELIVERY_SECTOR_CODE, FREIGHT_SECTOR_CODE
from app.modules.access_control.service import AuthorizationContext
from app.modules.analytics.schemas import (
    TransportCarrierDeliveryItem,
    TransportCityDeliveryItem,
    TransportDashboardDetailResponse,
    TransportDashboardResponse,
    TransportDetailDeliveryItem,
    TransportDetailDeliveryPage,
    TransportDetailFreightPage,
    TransportDetailParticipant,
    TransportDetailReason,
    TransportDetailTotals,
    TransportKmItem,
    TransportPaymentItem,
    TransportRateItem,
)
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor
from app.modules.deliveries import repository as deliveries_repository
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)
from app.modules.feedback import service as feedback_service
from app.modules.fretes.models import Frete, FreteEvento
from app.modules.fretes.service import _freight_response
from app.modules.fretes.status import effective_status

logger = logging.getLogger("lancamento.api.analytics.transport")


def _strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _pt_sort_key(value: str) -> tuple[str, str]:
    return (_strip_accents(value).casefold(), value.casefold())


def _identity_part(value: str) -> str:
    cleaned = _strip_accents(value).strip().lower()
    return re.sub(r"[^a-z0-9]+", "-", cleaned).strip("-")


def _carrier_from_code(code: str) -> str:
    if code == "JUST_IN_TIME":
        return "JUST IN TIME"
    if code == "PAULO_CRUZ":
        return "Paulo Cruz"
    return "Agregados CD"


def _parse_numeric(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    raw = str(value).strip()
    if not raw:
        return None
    raw = re.sub(r"\s+", "", raw)
    normalized = raw.replace(".", "").replace(",", ".") if "," in raw else raw
    try:
        parsed = float(normalized)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _import_source(detail: object) -> dict[str, Any] | None:
    if not isinstance(detail, dict):
        return None
    source = detail.get("importacao_planilha")
    return source if isinstance(source, dict) else None


def _freight_carrier(
    *,
    tipo_transporte: str,
    codigo_fonte_tarifa: str | None,
    nome_transportador: str | None,
    detalhe_calculo: object,
) -> tuple[str, str]:
    if tipo_transporte == "PROPRIO":
        return ("PROPRIO::FROTA", "Frota própria")

    if tipo_transporte == "TRANSPORTADORA":
        code = codigo_fonte_tarifa if codigo_fonte_tarifa in ("PAULO_CRUZ", "JUST_IN_TIME") else None
        carrier_name = _carrier_from_code(code) if code else (nome_transportador or "").strip()
        if code or carrier_name:
            key = (
                f"TRANSPORTADORA::{code}"
                if code
                else f"TRANSPORTADORA::NOME::{_identity_part(carrier_name)}"
            )
            return (key, carrier_name or "Transportadora não identificada")
        return ("NAO_IDENTIFICADO::TRANSPORTADORA", "Transportadora não identificada")

    source = _import_source(detalhe_calculo)
    name = (nome_transportador or "").strip()
    if source is not None and source.get("tipo_transporte_identificado") is False and not name:
        return ("NAO_IDENTIFICADO::AGREGADO", "Agregado não identificado")
    if name:
        return (f"AGREGADO::{_identity_part(name)}", name)
    return ("NAO_IDENTIFICADO::AGREGADO", "Agregado não identificado")


def _freight_effective_status(row: Any) -> str:
    if row.status_calculo == "CALCULADO":
        return "CALCULADO"
    status, _ = effective_status(cast(Frete, row))
    return status


def _freight_payment_amount(row: Any) -> float | None:
    saved_amount = _parse_numeric(row.valor_frete_pago)
    gross = _parse_numeric(row.valor_frete_bruto)
    damage = _parse_numeric(row.valor_avaria) or 0.0
    amount = saved_amount if saved_amount is not None else (None if gross is None else gross - damage)
    if amount is None:
        return None
    if _freight_effective_status(row) == "CALCULADO":
        return amount

    source = _import_source(row.detalhe_calculo)
    name = (row.nome_transportador or "").strip()
    imported_responsible_clear = (
        source is not None
        and bool(name)
        and source.get("tipo_transporte_identificado") is not False
        and not (
            row.tipo_transporte == "AGREGADO"
            and source.get("vinculo_responsavel_status") == "AMBIGUO"
        )
    )
    return amount if imported_responsible_clear else None


def _freight_kilometers(row: Any) -> float | None:
    saved = _parse_numeric(row.km_rodado)
    if saved is not None:
        return saved
    source = _import_source(row.detalhe_calculo)
    if source is None:
        return None
    return _parse_numeric(source.get("km_rodado_planilha"))


def _delivery_carrier(
    *,
    id_pessoa: int | None,
    nome_exibicao: str | None,
    tipo_transporte_entrega: str | None,
    modalidade_terceirizada: str | None,
    codigo_transportadora_independente: str | None,
) -> tuple[str, str, str | None]:
    if id_pessoa is None:
        return ("NAO_IDENTIFICADO::MOTORISTA", "Motorista não identificado", None)
    name = (nome_exibicao or "").strip() or "Motorista não identificado"
    if tipo_transporte_entrega == "PROPRIA":
        return ("PROPRIO::FROTA", "Frota própria", name)
    if modalidade_terceirizada == "AGREGADO":
        return (f"AGREGADO::{_identity_part(name)}", name, name)
    if (
        modalidade_terceirizada == "TRANSPORTADORA_INDEPENDENTE"
        and codigo_transportadora_independente in ("PAULO_CRUZ", "JUST_IN_TIME")
    ):
        return (
            f"TRANSPORTADORA::{codigo_transportadora_independente}",
            _carrier_from_code(codigo_transportadora_independente),
            name,
        )
    suffix = _identity_part(name) or str(id_pessoa)
    return (f"NAO_IDENTIFICADO::{suffix}", f"Transportador não identificado · {name}", name)


def _delivery_city_label(
    *,
    cidade: str | None,
    uf: str | None,
    nome_localidade: str | None,
) -> str:
    city = (cidade or "").strip()
    state = (uf or "").strip()
    if city and state:
        return f"{city} / {state}"
    if city:
        return city
    return (nome_localidade or "").strip() or "Cidade não informada"


def _has_sector_or_global_grant(access: AuthorizationContext, sector_id: int) -> bool:
    return any(
        grant.tipo_escopo == "GLOBAL"
        or (grant.tipo_escopo == "SETOR" and grant.id_setor == sector_id)
        for grant in access.grants
    )


def _require_transport_dashboard_access(
    db: Session,
    *,
    dashboard_access: AuthorizationContext,
    freight_access: AuthorizationContext,
) -> tuple[int, int | None]:
    transport_sector = db.scalar(
        select(Setor).where(Setor.codigo == FREIGHT_SECTOR_CODE, Setor.ativo.is_(True))
    )
    if transport_sector is None:
        raise NotFoundError("O setor Transporte não está ativo no Portal.")
    if not _has_sector_or_global_grant(
        freight_access, transport_sector.id_setor
    ) or not _has_sector_or_global_grant(dashboard_access, transport_sector.id_setor):
        raise PermissionDeniedError(
            "O painel de transportes exige acesso global ou acesso ao setor Transporte."
        )
    support_sector_id = db.scalar(
        select(Setor.id_setor).where(
            Setor.codigo == DELIVERY_SECTOR_CODE,
            Setor.ativo.is_(True),
        )
    )
    return transport_sector.id_setor, support_sector_id


def _validate_period(data_de: date | None, data_ate: date | None) -> None:
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="A data inicial não pode ser posterior à data final.",
        )


def _active_freights_base_predicates(
    *,
    sector_id: int,
    data_de: date | None,
    data_ate: date | None,
    carrier_key: str | None = None,
) -> list[Any]:
    predicates: list[Any] = [
        Frete.id_setor == sector_id,
        ~exists(
            select(FreteEvento.id_frete_evento).where(
                FreteEvento.id_frete == Frete.id_frete,
                FreteEvento.tipo_evento == "FRETE_CANCELADO",
            )
        ),
    ]
    if data_de is not None:
        predicates.append(Frete.data_servico >= data_de)
    if data_ate is not None:
        predicates.append(Frete.data_servico <= data_ate)
    if carrier_key is not None:
        if carrier_key == "PROPRIO::FROTA":
            predicates.append(Frete.tipo_transporte == "PROPRIO")
        elif carrier_key.startswith("TRANSPORTADORA::") or carrier_key == "NAO_IDENTIFICADO::TRANSPORTADORA":
            predicates.append(Frete.tipo_transporte == "TRANSPORTADORA")
            if carrier_key in ("TRANSPORTADORA::PAULO_CRUZ", "TRANSPORTADORA::JUST_IN_TIME"):
                predicates.append(
                    Frete.codigo_fonte_tarifa == carrier_key.removeprefix("TRANSPORTADORA::")
                )
        elif carrier_key.startswith("AGREGADO::") or carrier_key == "NAO_IDENTIFICADO::AGREGADO":
            predicates.append(Frete.tipo_transporte == "AGREGADO")
    return predicates


def _confirmed_deliveries_base_query(
    *,
    support_sector_id: int,
    data_de: date | None,
    data_ate: date | None,
):
    latest_confirmed = (
        select(
            LancamentoRevisao.id_lancamento.label("id_lancamento"),
            func.max(LancamentoRevisao.numero_revisao).label("numero_revisao"),
        )
        .where(LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")))
        .group_by(LancamentoRevisao.id_lancamento)
        .subquery("ultima_revisao_confirmada")
    )
    occurrences_subquery = (
        select(
            EntregaMotivo.id_entrega_diaria.label("id_entrega_diaria"),
            func.coalesce(func.sum(EntregaMotivo.quantidade), 0).label("occurrences"),
        )
        .where(EntregaMotivo.tipo_operacao == "ENTREGA")
        .group_by(EntregaMotivo.id_entrega_diaria)
        .subquery("ocorrencias_entrega")
    )
    predicates: list[Any] = [
        Lancamento.id_setor == support_sector_id,
        LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")),
        ~exists(
            select(LancamentoEvento.id_evento).where(
                LancamentoEvento.id_lancamento == Lancamento.id_lancamento,
                LancamentoEvento.tipo_evento == "LANCAMENTO_CANCELADO",
            )
        ),
        or_(
            EntregaDiaria.quantidade_realizada > 0,
            EntregaDiaria.quantidade_nao_realizada > 0,
        ),
    ]
    if data_de is not None:
        predicates.append(EntregaDiaria.data_entrega >= data_de)
    if data_ate is not None:
        predicates.append(EntregaDiaria.data_entrega <= data_ate)

    return (
        select(
            EntregaDiaria.id_entrega_diaria,
            EntregaDiaria.codigo_item_lancamento,
            EntregaDiaria.data_entrega,
            EntregaDiaria.quantidade_realizada,
            EntregaDiaria.quantidade_nao_realizada,
            EntregaDiaria.observacao,
            Lancamento.codigo_lancamento,
            Localidade.id_localidade,
            Localidade.codigo_localidade,
            Localidade.nome_localidade,
            Localidade.cidade,
            Localidade.uf,
            Pessoa.id_pessoa,
            Pessoa.nome_exibicao,
            Pessoa.tipo_transporte_entrega,
            Pessoa.modalidade_terceirizada,
            Pessoa.codigo_transportadora_independente,
            func.coalesce(occurrences_subquery.c.occurrences, 0).label("ocorrencias"),
        )
        .select_from(EntregaDiaria)
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao == EntregaDiaria.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(
            latest_confirmed,
            and_(
                latest_confirmed.c.id_lancamento == Lancamento.id_lancamento,
                latest_confirmed.c.numero_revisao == LancamentoRevisao.numero_revisao,
            ),
        )
        .join(Localidade, Localidade.id_localidade == EntregaDiaria.id_localidade)
        .outerjoin(
            EntregaParticipante,
            and_(
                EntregaParticipante.id_entrega_diaria == EntregaDiaria.id_entrega_diaria,
                EntregaParticipante.papel_participante == "MOTORISTA",
            ),
        )
        .outerjoin(Pessoa, Pessoa.id_pessoa == EntregaParticipante.id_pessoa)
        .outerjoin(
            occurrences_subquery,
            occurrences_subquery.c.id_entrega_diaria == EntregaDiaria.id_entrega_diaria,
        )
        .where(*predicates)
        .order_by(EntregaDiaria.id_entrega_diaria, EntregaParticipante.ordem)
    )


def get_transport_dashboard(
    db: Session,
    *,
    dashboard_access: AuthorizationContext,
    freight_access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    request_id: str | None = None,
) -> TransportDashboardResponse:
    """Agrega os indicadores do Painel Gerencial de Transportes em duas consultas."""
    _validate_period(data_de, data_ate)

    try:
        started_at = perf_counter()
        sector_id, support_sector_id = _require_transport_dashboard_access(
            db,
            dashboard_access=dashboard_access,
            freight_access=freight_access,
        )

        freight_stmt = select(
            Frete.tipo_transporte,
            Frete.codigo_fonte_tarifa,
            Frete.nome_transportador,
            Frete.valor_frete_pago,
            Frete.valor_frete_bruto,
            Frete.valor_avaria,
            Frete.valor_nota,
            Frete.km_rodado,
            Frete.codigo_zona_jit,
            Frete.tipo_caminhao,
            Frete.rota_cidade,
            Frete.peso_kg,
            Frete.status_calculo,
            Frete.motivo_pendencia,
            Frete.detalhe_calculo,
        ).where(
            *_active_freights_base_predicates(
                sector_id=sector_id,
                data_de=data_de,
                data_ate=data_ate,
            )
        )
        freight_rows = db.execute(freight_stmt).all()

        carrier_labels: dict[str, str] = {}
        payment_totals: dict[str, dict[str, Any]] = {}
        rate_totals: dict[str, dict[str, Any]] = {}
        km_totals: dict[str, dict[str, Any]] = {}

        for row in freight_rows:
            key, label = _freight_carrier(
                tipo_transporte=row.tipo_transporte,
                codigo_fonte_tarifa=row.codigo_fonte_tarifa,
                nome_transportador=row.nome_transportador,
                detalhe_calculo=row.detalhe_calculo,
            )
            carrier_labels.setdefault(key, label)

            pay_entry = payment_totals.setdefault(
                key, {"total": 0.0, "fretes_count": 0, "known_count": 0}
            )
            pay_entry["fretes_count"] += 1
            amount = _freight_payment_amount(row)
            if amount is not None:
                pay_entry["total"] += amount
                pay_entry["known_count"] += 1

            gross = _parse_numeric(row.valor_frete_bruto)
            invoice = _parse_numeric(row.valor_nota)
            if gross is not None and invoice is not None and invoice > 0:
                rate_entry = rate_totals.setdefault(
                    key, {"gross": 0.0, "invoice": 0.0, "known_count": 0}
                )
                rate_entry["gross"] += gross
                rate_entry["invoice"] += invoice
                rate_entry["known_count"] += 1

            km = _freight_kilometers(row)
            if km is not None:
                km_entry = km_totals.setdefault(key, {"total_km": 0.0, "known_count": 0})
                km_entry["total_km"] += km
                km_entry["known_count"] += 1

        delivery_carrier_totals: dict[str, dict[str, int]] = {}
        city_totals: dict[str, dict[str, int]] = {}
        total_registros_entrega = 0

        if support_sector_id is not None:
            delivery_rows = db.execute(
                _confirmed_deliveries_base_query(
                    support_sector_id=support_sector_id,
                    data_de=data_de,
                    data_ate=data_ate,
                )
            ).all()
            seen_delivery_ids: set[int] = set()
            for row in delivery_rows:
                if row.id_entrega_diaria in seen_delivery_ids:
                    continue
                seen_delivery_ids.add(row.id_entrega_diaria)
                total_registros_entrega += 1

                c_key, c_label, _ = _delivery_carrier(
                    id_pessoa=row.id_pessoa,
                    nome_exibicao=row.nome_exibicao,
                    tipo_transporte_entrega=row.tipo_transporte_entrega,
                    modalidade_terceirizada=row.modalidade_terceirizada,
                    codigo_transportadora_independente=row.codigo_transportadora_independente,
                )
                carrier_labels.setdefault(c_key, c_label)

                realized = int(row.quantidade_realizada or 0)
                not_realized = int(row.quantidade_nao_realizada or 0)
                planned = realized + not_realized
                occurrences = int(row.ocorrencias or 0)

                dc = delivery_carrier_totals.setdefault(
                    c_key, {"planned": 0, "realized": 0, "not_realized": 0, "occurrences": 0}
                )
                dc["planned"] += planned
                dc["realized"] += realized
                dc["not_realized"] += not_realized
                dc["occurrences"] += occurrences

                city = _delivery_city_label(
                    cidade=row.cidade,
                    uf=row.uf,
                    nome_localidade=row.nome_localidade,
                )
                ct = city_totals.setdefault(
                    city, {"planned": 0, "realized": 0, "not_realized": 0, "occurrences": 0}
                )
                ct["planned"] += planned
                ct["realized"] += realized
                ct["not_realized"] += not_realized
                ct["occurrences"] += occurrences

        pagamentos = sorted(
            (
                TransportPaymentItem(
                    key=key,
                    label=carrier_labels[key],
                    total=round(entry["total"], 2),
                    fretes_count=entry["fretes_count"],
                    known_count=entry["known_count"],
                )
                for key, entry in payment_totals.items()
            ),
            key=lambda item: (-item.total, _pt_sort_key(item.label)),
        )
        percentuais_frete = sorted(
            (
                TransportRateItem(
                    key=key,
                    label=carrier_labels[key],
                    percentual=(entry["gross"] / entry["invoice"]) * 100.0,
                    known_count=entry["known_count"],
                )
                for key, entry in rate_totals.items()
                if entry["invoice"] > 0
            ),
            key=lambda item: (-item.percentual, _pt_sort_key(item.label)),
        )
        entregas_transportadora = sorted(
            (
                TransportCarrierDeliveryItem(
                    key=key,
                    label=carrier_labels[key],
                    planned=entry["planned"],
                    realized=entry["realized"],
                    not_realized=entry["not_realized"],
                    occurrences=entry["occurrences"],
                    accuracy=(entry["realized"] / entry["planned"]) * 100.0
                    if entry["planned"] > 0
                    else None,
                )
                for key, entry in delivery_carrier_totals.items()
            ),
            key=lambda item: (-item.planned, _pt_sort_key(item.label)),
        )
        km_rodado = sorted(
            (
                TransportKmItem(
                    key=key,
                    label=carrier_labels[key],
                    total_km=round(entry["total_km"], 3),
                    known_count=entry["known_count"],
                )
                for key, entry in km_totals.items()
                if entry["known_count"] > 0
            ),
            key=lambda item: (-item.total_km, _pt_sort_key(item.label)),
        )
        entregas_cidade = sorted(
            (
                TransportCityDeliveryItem(
                    city=city,
                    planned=entry["planned"],
                    realized=entry["realized"],
                    not_realized=entry["not_realized"],
                    occurrences=entry["occurrences"],
                )
                for city, entry in city_totals.items()
            ),
            key=lambda item: (-item.planned, _pt_sort_key(item.city)),
        )

        logger.info(
            "transport_dashboard request_id=%s freights=%d deliveries=%d duration_ms=%.2f",
            request_id or "-",
            len(freight_rows),
            total_registros_entrega,
            (perf_counter() - started_at) * 1000,
        )
        return TransportDashboardResponse(
            data_de=data_de,
            data_ate=data_ate,
            total_fretes=len(freight_rows),
            total_registros_entrega=total_registros_entrega,
            pagamentos=pagamentos,
            percentuais_frete=percentuais_frete,
            entregas_transportadora=entregas_transportadora,
            km_rodado=km_rodado,
            entregas_cidade=entregas_cidade,
        )
    except APIError:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError(
            "O Painel Gerencial de Transportes está temporariamente indisponível."
        ) from exc


def get_transport_dashboard_details(
    db: Session,
    *,
    dashboard_access: AuthorizationContext,
    freight_access: AuthorizationContext,
    kind: Literal["carrier", "city"],
    key: str,
    data_de: date | None,
    data_ate: date | None,
    freight_limit: int = 10,
    freight_offset: int = 0,
    delivery_limit: int = 10,
    delivery_offset: int = 0,
) -> TransportDashboardDetailResponse:
    """Carrega detalhamento paginado e totais apenas do recorte clicado."""
    _validate_period(data_de, data_ate)

    try:
        sector_id, support_sector_id = _require_transport_dashboard_access(
            db,
            dashboard_access=dashboard_access,
            freight_access=freight_access,
        )

        matched_freights: list[Frete] = []
        pagamento_total = 0.0
        pagamento_count = 0
        km_total = 0.0
        km_count = 0
        rate_gross = 0.0
        rate_invoice = 0.0
        rate_count = 0

        if kind == "carrier":
            freight_candidates = list(
                db.scalars(
                    select(Frete)
                    .where(
                        *_active_freights_base_predicates(
                            sector_id=sector_id,
                            data_de=data_de,
                            data_ate=data_ate,
                            carrier_key=key,
                        )
                    )
                    .order_by(Frete.data_servico.desc(), Frete.codigo_frete.desc())
                ).all()
            )
            for freight in freight_candidates:
                carrier_key, _ = _freight_carrier(
                    tipo_transporte=freight.tipo_transporte,
                    codigo_fonte_tarifa=freight.codigo_fonte_tarifa,
                    nome_transportador=freight.nome_transportador,
                    detalhe_calculo=freight.detalhe_calculo,
                )
                if carrier_key != key:
                    continue
                matched_freights.append(freight)

                pay = _freight_payment_amount(freight)
                if pay is not None:
                    pagamento_total += pay
                    pagamento_count += 1

                km = _freight_kilometers(freight)
                if km is not None:
                    km_total += km
                    km_count += 1

                gross = _parse_numeric(freight.valor_frete_bruto)
                invoice = _parse_numeric(freight.valor_nota)
                if gross is not None and invoice is not None and invoice > 0:
                    rate_gross += gross
                    rate_invoice += invoice
                    rate_count += 1

        paged_freights = [
            _freight_response(freight)
            for freight in matched_freights[freight_offset : freight_offset + freight_limit]
        ]

        matched_deliveries: list[tuple[Any, str, str | None]] = []
        entregas_realizadas = 0
        entregas_nao_realizadas = 0
        ocorrencias_total = 0

        if support_sector_id is not None:
            delivery_rows = db.execute(
                _confirmed_deliveries_base_query(
                    support_sector_id=support_sector_id,
                    data_de=data_de,
                    data_ate=data_ate,
                )
            ).all()
            seen_delivery_ids: set[int] = set()
            for row in delivery_rows:
                if row.id_entrega_diaria in seen_delivery_ids:
                    continue
                seen_delivery_ids.add(row.id_entrega_diaria)

                c_key, c_label, driver = _delivery_carrier(
                    id_pessoa=row.id_pessoa,
                    nome_exibicao=row.nome_exibicao,
                    tipo_transporte_entrega=row.tipo_transporte_entrega,
                    modalidade_terceirizada=row.modalidade_terceirizada,
                    codigo_transportadora_independente=row.codigo_transportadora_independente,
                )
                city_label = _delivery_city_label(
                    cidade=row.cidade,
                    uf=row.uf,
                    nome_localidade=row.nome_localidade,
                )
                if kind == "carrier" and c_key != key:
                    continue
                if kind == "city" and city_label != key:
                    continue

                matched_deliveries.append((row, c_label, driver))
                entregas_realizadas += int(row.quantidade_realizada or 0)
                entregas_nao_realizadas += int(row.quantidade_nao_realizada or 0)
                ocorrencias_total += int(row.ocorrencias or 0)

        matched_deliveries.sort(
            key=lambda entry: (
                -entry[0].data_entrega.toordinal(),
                _pt_sort_key(entry[0].nome_localidade),
                -entry[0].id_entrega_diaria,
            )
        )
        paged_slice = matched_deliveries[delivery_offset : delivery_offset + delivery_limit]
        paged_delivery_ids = {row.id_entrega_diaria for row, _, _ in paged_slice}

        participants_by_item: dict[int, list[TransportDetailParticipant]] = defaultdict(list)
        reasons_by_item: dict[int, list[TransportDetailReason]] = defaultdict(list)
        feedback_counts: dict[tuple[str, int], dict[str, int]] = {}

        if paged_delivery_ids:
            for participant, person in deliveries_repository.list_participant_rows(
                db, id_entregas=paged_delivery_ids
            ):
                participants_by_item[participant.id_entrega_diaria].append(
                    TransportDetailParticipant(
                        nome_exibicao=person.nome_exibicao,
                        papel_participante=participant.papel_participante,
                    )
                )

            reason_rows = db.execute(
                select(EntregaMotivo, MotivoNaoEntrega)
                .join(
                    MotivoNaoEntrega,
                    MotivoNaoEntrega.id_motivo_nao_entrega == EntregaMotivo.id_motivo_nao_entrega,
                )
                .where(
                    EntregaMotivo.id_entrega_diaria.in_(paged_delivery_ids),
                    EntregaMotivo.tipo_operacao == "ENTREGA",
                )
                .order_by(EntregaMotivo.id_entrega_diaria, EntregaMotivo.id_entrega_motivo)
            ).all()
            for reason_link, reason in reason_rows:
                reasons_by_item[reason_link.id_entrega_diaria].append(
                    TransportDetailReason(
                        descricao_motivo=reason.descricao_motivo,
                        quantidade=reason_link.quantidade,
                    )
                )

            feedback_counts = feedback_service.feedback_counts_by_items(
                db,
                item_keys={
                    (row.codigo_item_lancamento, row.id_localidade) for row, _, _ in paged_slice
                },
            )

        delivery_items = [
            TransportDetailDeliveryItem(
                codigo_lancamento=UUID(row.codigo_lancamento),
                codigo_item_lancamento=UUID(row.codigo_item_lancamento),
                data_entrega=row.data_entrega,
                id_localidade=row.id_localidade,
                codigo_localidade=row.codigo_localidade,
                nome_localidade=row.nome_localidade,
                cidade=row.cidade,
                uf=row.uf,
                carrier_label=carrier_label,
                driver=driver,
                quantidade_realizada=int(row.quantidade_realizada or 0),
                quantidade_nao_realizada=int(row.quantidade_nao_realizada or 0),
                ocorrencias=int(row.ocorrencias or 0),
                quantidade_reclamacoes=feedback_counts.get(
                    (row.codigo_item_lancamento, row.id_localidade), {}
                ).get("RECLAMACAO", 0),
                quantidade_elogios=feedback_counts.get(
                    (row.codigo_item_lancamento, row.id_localidade), {}
                ).get("ELOGIO", 0),
                observacao=row.observacao,
                participantes=participants_by_item[row.id_entrega_diaria],
                motivos=reasons_by_item[row.id_entrega_diaria],
            )
            for row, carrier_label, driver in paged_slice
        ]

        entregas_planejadas = entregas_realizadas + entregas_nao_realizadas
        return TransportDashboardDetailResponse(
            kind=kind,
            key=key,
            data_de=data_de,
            data_ate=data_ate,
            totals=TransportDetailTotals(
                fretes_count=len(matched_freights),
                pagamento_total=round(pagamento_total, 2),
                pagamento_count=pagamento_count,
                percentual_frete=(rate_gross / rate_invoice) * 100.0 if rate_invoice > 0 else None,
                percentual_count=rate_count,
                km_total=round(km_total, 3),
                km_count=km_count,
                registros_entrega=len(matched_deliveries),
                entregas_planejadas=entregas_planejadas,
                entregas_realizadas=entregas_realizadas,
                entregas_nao_realizadas=entregas_nao_realizadas,
                ocorrencias=ocorrencias_total,
                taxa_acerto=(entregas_realizadas / entregas_planejadas) * 100.0
                if entregas_planejadas > 0
                else None,
            ),
            fretes=TransportDetailFreightPage(
                items=paged_freights,
                total=len(matched_freights),
                limit=freight_limit,
                offset=freight_offset,
            ),
            entregas=TransportDetailDeliveryPage(
                items=delivery_items,
                total=len(matched_deliveries),
                limit=delivery_limit,
                offset=delivery_offset,
            ),
        )
    except APIError:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError(
            "O detalhamento do Painel de Transportes está temporariamente indisponível."
        ) from exc
