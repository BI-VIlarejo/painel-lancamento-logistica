"""Regras de acesso, cálculo e consolidação de Fretes."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.modules.access_control.catalog import FREIGHT_SECTOR_CODE
from app.modules.access_control.service import AuthorizationContext
from app.modules.catalogs.models import Localidade, Pessoa

from . import repository
from .calculator import FreightCalculation, calculate_freight
from .models import Frete, FreteEvento
from .status import effective_status
from .tariff_catalog import normalize_label, tariff_options
from .schemas import (
    FreightAggregateDriverOption,
    FreightCarrierDriverOption,
    FreightDeliverySummary,
    HistoricalFreightEditDriverOption,
    FreightHistoryDriverOption,
    FreightHistoryFilterOptions,
    FreightInput,
    FreightPage,
    FreightPaymentOptions,
    FreightPaymentPending,
    FreightPaymentReport,
    FreightPaymentWarning,
    FreightQuoteResponse,
    FreightResponse,
    FreightStatus,
    HistoricalFreightEditInput,
    HistoricalFreightImportItem,
    HistoricalFreightImportRequest,
    HistoricalFreightImportResponse,
    PaymentTransportType,
    TariffSource,
    TransportType,
    TruckType,
)


def _utc_now() -> datetime:
    """Fornece horário UTC sem timezone, compatível com as colunas DATETIME."""
    return datetime.now(UTC).replace(tzinfo=None)


def _request_fingerprint(payload: FreightInput) -> str:
    """Cria hash estável do pedido para validar reenvios com a mesma chave."""
    serialized = json.dumps(
        payload.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(serialized.encode("utf-8")).hexdigest()


def _database_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    """Desfaz a transação com erro e converte falha SQL em resposta controlada."""
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("O módulo de Fretes está temporariamente indisponível.")


@dataclass(frozen=True)
class _HistoricalDriverMatch:
    person: Pessoa | None
    status: str
    basis: str | None = None
    name_match_type: str | None = None
    carrier_code: str | None = None


@dataclass(frozen=True)
class _HistoricalRouteMatch:
    value: str | None
    status: str
    basis: str | None = None


def _person_name_components(value: str) -> set[str]:
    """Decompõe nomes compostos do cadastro sem usar comparação aproximada."""
    normalized = normalize_label(value)
    return {
        component.strip()
        for component in re.split(r"\s*(?:[/,|+&])\s*|\s+E\s+", normalized)
        if component.strip() and component.strip() != normalized
    }


def _match_historical_driver(
    name: str | None,
    data_servico: date,
    drivers_by_name: dict[str, list[Pessoa]],
    drivers_by_name_component: dict[str, list[Pessoa]],
    drivers_by_carrier: dict[str, list[Pessoa]],
) -> _HistoricalDriverMatch:
    """Vincula nome individual, nome composto ou transportadora ao cadastro vigente."""
    if not name:
        return _HistoricalDriverMatch(None, "NAO_ENCONTRADO")
    normalized_name = normalize_label(name)
    carrier_aliases = {
        "JUST IN TIME": "JUST_IN_TIME",
        "JUST IN TIME 1": "JUST_IN_TIME",
        "JUSTI IN TIME": "JUST_IN_TIME",
        "PAULO CRUZ": "PAULO_CRUZ",
    }
    carrier_code = carrier_aliases.get(normalized_name)
    if normalized_name == "VITOR":
        victor_candidates = [
            driver
            for driver in drivers_by_name.get("VICTOR TRANSPORTADORA NITEROI", [])
            if driver.modalidade_terceirizada == "TRANSPORTADORA_INDEPENDENTE"
            and driver.codigo_transportadora_independente == "PAULO_CRUZ"
        ]
        victor_match = _choose_historical_driver(
            victor_candidates, data_servico, "ALIAS_VITOR_PAULO_CRUZ"
        )
        return victor_match
    direct_candidates = drivers_by_name.get(normalized_name, [])
    direct_match = _choose_historical_driver(
        direct_candidates,
        data_servico,
        "NOME_EXATO",
    )
    if (
        direct_match.status == "AMBIGUO"
        and carrier_code is not None
        and all(
            driver.codigo_transportadora_independente == carrier_code
            for driver in direct_candidates
        )
    ):
        return replace(direct_match, carrier_code=carrier_code)
    if direct_match.status != "NAO_ENCONTRADO":
        return direct_match

    component_candidates: dict[int, Pessoa] = {}
    for component in _person_name_components(name) | {normalized_name}:
        for driver in drivers_by_name_component.get(component, []):
            component_candidates[driver.id_pessoa] = driver
    component_match = _choose_historical_driver(
        list(component_candidates.values()),
        data_servico,
        "NOME_COMPOSTO",
    )
    if component_match.status != "NAO_ENCONTRADO":
        return component_match

    if carrier_code is None:
        return component_match
    carrier_match = _choose_historical_driver(
        drivers_by_carrier.get(carrier_code, []),
        data_servico,
        "TRANSPORTADORA_CADASTRADA",
    )
    if carrier_match.status == "VINCULADO":
        return replace(carrier_match, carrier_code=carrier_code)
    return _HistoricalDriverMatch(
        None,
        carrier_match.status,
        carrier_match.basis,
        "TRANSPORTADORA_CADASTRADA",
        carrier_code,
    )


def _choose_historical_driver(
    candidates: list[Pessoa],
    data_servico: date,
    name_match_type: str,
) -> _HistoricalDriverMatch:
    """Escolhe um único motorista válido na data ou um único cadastro atual."""
    date_matches = [
        driver
        for driver in candidates
        if driver.vigente_desde <= data_servico
        and (driver.vigente_ate is None or driver.vigente_ate > data_servico)
    ]
    if len(date_matches) == 1:
        return _HistoricalDriverMatch(
            date_matches[0], "VINCULADO", "DATA_SERVICO", name_match_type
        )
    if len(date_matches) > 1:
        return _HistoricalDriverMatch(None, "AMBIGUO", None, name_match_type)

    active_matches = [driver for driver in candidates if driver.ativo]
    if len(active_matches) == 1:
        return _HistoricalDriverMatch(
            active_matches[0], "VINCULADO", "CADASTRO_ATUAL", name_match_type
        )
    if len(active_matches) > 1:
        return _HistoricalDriverMatch(None, "AMBIGUO", None, name_match_type)
    return _HistoricalDriverMatch(None, "NAO_ENCONTRADO")


def _compact_route_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", normalize_label(value))


def _add_route_alias(
    index: dict[str, set[str]],
    alias: str | None,
    canonical_name: str,
) -> None:
    if alias and alias.strip():
        index.setdefault(_compact_route_key(alias), set()).add(canonical_name)


def _route_keys_one_typo_apart(left: str, right: str) -> bool:
    """Reconhece uma edição ou transposição simples sem usar similaridade vaga."""
    if min(len(left), len(right)) < 6 or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        differences = [index for index, pair in enumerate(zip(left, right, strict=True)) if pair[0] != pair[1]]
        return (
            len(differences) == 1
            or (
                len(differences) == 2
                and differences[1] == differences[0] + 1
                and left[differences[0]] == right[differences[1]]
                and left[differences[1]] == right[differences[0]]
            )
        )
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    short_index = 0
    long_index = 0
    skipped = 0
    while short_index < len(shorter) and long_index < len(longer):
        if shorter[short_index] == longer[long_index]:
            short_index += 1
            long_index += 1
            continue
        skipped += 1
        if skipped > 1:
            return False
        long_index += 1
    return skipped + (len(longer) - long_index) <= 1


def _resolve_route_key(index: dict[str, set[str]], key: str) -> str | None:
    candidates = index.get(key, set())
    if len(candidates) == 1:
        return next(iter(candidates))
    if len(candidates) > 1:
        return ""
    fuzzy_candidates = {
        canonical
        for alias, canonical_names in index.items()
        if _route_keys_one_typo_apart(key, alias)
        for canonical in canonical_names
    }
    if len(fuzzy_candidates) == 1:
        return next(iter(fuzzy_candidates))
    if len(fuzzy_candidates) > 1:
        return ""
    return None


def _build_historical_route_indexes(
    localities: list[Localidade],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Indexa rotas tarifárias e localidades pelo código e pelos nomes cadastrados."""
    tariff_index: dict[str, set[str]] = {}
    locality_index: dict[str, set[str]] = {}
    for route in tariff_options()["rotas_agregados_cd"]:
        if not isinstance(route, dict):
            continue
        canonical = str(route.get("nome", "")).strip()
        if not canonical:
            continue
        _add_route_alias(tariff_index, str(route.get("nome", "")), canonical)
        _add_route_alias(tariff_index, str(route.get("codigo", "")), canonical)

    for region in tariff_options()["zonas_just_in_time"]:
        if not isinstance(region, dict):
            continue
        canonical = str(region.get("nome", "")).strip()
        if canonical:
            _add_route_alias(locality_index, canonical, canonical)
            _add_route_alias(locality_index, str(region.get("codigo", "")), canonical)
            if normalize_label(canonical) == "REGIAO SERRANA":
                _add_route_alias(locality_index, "SERRA", canonical)

    for locality in localities:
        canonical = locality.cidade.strip() if locality.cidade and locality.cidade.strip() else locality.nome_localidade.strip()
        _add_route_alias(locality_index, locality.nome_localidade, canonical)
        _add_route_alias(locality_index, locality.cidade, canonical)
        _add_route_alias(locality_index, locality.codigo_localidade, canonical)
        if normalize_label(canonical) == "RIO DE JANEIRO":
            _add_route_alias(locality_index, "RIO", canonical)
    return tariff_index, locality_index


def _route_alias_target(index: dict[str, set[str]], value: str) -> str | None:
    key = _compact_route_key(value)
    # Números podem identificar áreas diferentes; não os remova nem os trate
    # como erro de digitação ao comparar uma rota histórica com o cadastro.
    if re.search(r"\d+$", key):
        candidates = index.get(key, set())
        if len(candidates) == 1:
            return next(iter(candidates))
        return "" if candidates else None
    exact_target = _resolve_route_key(index, key)
    if exact_target is not None:
        return exact_target
    return None


def _canonicalize_historical_route(
    value: str | None,
    tariff_index: dict[str, set[str]],
    locality_index: dict[str, set[str]],
) -> _HistoricalRouteMatch:
    """Mapeia cidade/rota para o mesmo rótulo usado pelos cadastros do portal."""
    if not value or not value.strip():
        return _HistoricalRouteMatch(None, "NAO_INFORMADA")
    segments = [
        segment.strip()
        for segment in re.split(r"\s*(?:/|,|\s+E\s+)\s*", value, flags=re.IGNORECASE)
        if segment.strip()
    ]
    if not segments:
        return _HistoricalRouteMatch(value, "NAO_ENCONTRADA")
    canonical_segments: list[str] = []
    bases: list[str] = []
    for segment in segments:
        target = _route_alias_target(tariff_index, segment)
        basis = "ROTA_TARIFARIA"
        if target == "":
            return _HistoricalRouteMatch(value, "AMBIGUA")
        if target is None:
            target = _route_alias_target(locality_index, segment)
            basis = "LOCALIDADE"
        if target == "":
            return _HistoricalRouteMatch(value, "AMBIGUA")
        if target is None:
            return _HistoricalRouteMatch(value, "NAO_ENCONTRADA")
        canonical_segments.append(target)
        bases.append(basis)
    canonical_segments = sorted(set(canonical_segments), key=normalize_label)
    canonical_route = " / ".join(canonical_segments)
    basis = bases[0] if len(set(bases)) == 1 else "ROTA_E_LOCALIDADE"
    return _HistoricalRouteMatch(canonical_route, "VINCULADA", basis)


def _historical_transport_fields(
    match: _HistoricalDriverMatch,
    sheet_name: str | None,
) -> tuple[dict[str, object], _HistoricalDriverMatch]:
    """Monta os campos exigidos pelo tipo de responsável registrado no catálogo."""
    driver = match.person
    if driver is None:
        carriers = {"JUST_IN_TIME": "JUST IN TIME", "PAULO_CRUZ": "Paulo Cruz"}
        carrier_name = carriers.get(match.carrier_code or "")
        if carrier_name is not None:
            return (
                {
                    "tipo_transporte": "TRANSPORTADORA",
                    "nome_transportador": carrier_name,
                    "id_motorista_agregado": None,
                    "id_motorista_transportadora": None,
                    "nome_motorista_transportadora": None,
                    "codigo_fonte_tarifa": match.carrier_code,
                },
                match,
            )
        return (
            {
                "tipo_transporte": "AGREGADO",
                "nome_transportador": sheet_name,
                "id_motorista_agregado": None,
                "id_motorista_transportadora": None,
                "nome_motorista_transportadora": None,
                "codigo_fonte_tarifa": "AGREGADOS_CD",
            },
            match,
        )
    if driver.modalidade_terceirizada == "AGREGADO":
        return (
            {
                "tipo_transporte": "AGREGADO",
                "nome_transportador": driver.nome_exibicao,
                "id_motorista_agregado": driver.id_pessoa,
                "id_motorista_transportadora": None,
                "nome_motorista_transportadora": None,
                "codigo_fonte_tarifa": "AGREGADOS_CD",
            },
            match,
        )
    carriers = {"JUST_IN_TIME": "JUST IN TIME", "PAULO_CRUZ": "Paulo Cruz"}
    carrier_code = driver.codigo_transportadora_independente
    carrier_name = carriers.get(carrier_code or "")
    if carrier_name is not None:
        return (
            {
                "tipo_transporte": "TRANSPORTADORA",
                "nome_transportador": carrier_name,
                "id_motorista_agregado": None,
                "id_motorista_transportadora": driver.id_pessoa,
                "nome_motorista_transportadora": driver.nome_exibicao,
                "codigo_fonte_tarifa": carrier_code,
            },
            match,
        )
    return (
        {
            "tipo_transporte": "AGREGADO",
            "nome_transportador": sheet_name,
            "id_motorista_agregado": None,
            "id_motorista_transportadora": None,
            "nome_motorista_transportadora": None,
            "codigo_fonte_tarifa": "AGREGADOS_CD",
        },
        _HistoricalDriverMatch(None, "NAO_ENCONTRADO"),
    )


def _historical_source_text(
    item: HistoricalFreightImportItem,
    field_name: str,
    value: Decimal | int | str | None,
) -> str | None:
    """Devolve a representação original da célula ou o valor já normalizado."""
    if field_name in item.valores_originais_planilha:
        return item.valores_originais_planilha[field_name]
    return str(value) if value is not None else None


def _historical_source_has_value(import_source: dict[str, object], field_name: str) -> bool:
    """Indica se a célula original da planilha tinha conteúdo, inclusive zero."""
    originals = import_source.get("valores_originais_planilha")
    if not isinstance(originals, dict):
        return False
    value = originals.get(field_name)
    return value is not None and str(value).strip() != ""


def _freight_duplicate_signature(
    *,
    data_servico: date,
    tipo_transporte: str,
    id_motorista: int | None,
    rota_cidade: str | None,
    km_inicial: Decimal | None,
    km_final: Decimal | None,
    km_rodado: Decimal | None,
    quantidade_entregas: int | None,
    peso_kg: Decimal | None,
    valor_nota: Decimal | None,
    valor_frete_bruto: Decimal | None,
    valor_avaria: Decimal | None,
    valor_frete_pago: Decimal | None,
) -> tuple[object, ...] | None:
    """Cria chave operacional forte sem confundir viagens só parecidas."""
    descriptive_fields = (
        rota_cidade,
        km_inicial,
        km_final,
        km_rodado,
        quantidade_entregas,
        peso_kg,
        valor_nota,
    )
    if id_motorista is None or valor_frete_bruto is None or sum(
        value is not None for value in descriptive_fields
    ) < 2:
        return None
    return (
        data_servico,
        tipo_transporte,
        id_motorista,
        normalize_label(rota_cidade) if rota_cidade else None,
        km_inicial,
        km_final,
        km_rodado,
        quantidade_entregas,
        peso_kg,
        valor_nota,
        valor_frete_bruto,
        valor_avaria,
        valor_frete_pago,
    )


def _historical_duplicate_signature(
    item: HistoricalFreightImportItem,
    transport_fields: dict[str, object],
    route_value: str | None,
    operational_km: tuple[Decimal | None, Decimal | None, Decimal | None],
    paid: Decimal | None,
) -> tuple[object, ...] | None:
    """Calcula a mesma chave para uma linha da planilha já vinculada ao cadastro."""
    driver_id = (
        transport_fields["id_motorista_agregado"]
        if transport_fields["tipo_transporte"] == "AGREGADO"
        else transport_fields["id_motorista_transportadora"]
    )
    return _freight_duplicate_signature(
        data_servico=item.data_servico,
        tipo_transporte=str(transport_fields["tipo_transporte"]),
        id_motorista=int(driver_id) if driver_id is not None else None,
        rota_cidade=route_value,
        km_inicial=operational_km[0],
        km_final=operational_km[1],
        km_rodado=operational_km[2],
        quantidade_entregas=item.quantidade_entregas,
        peso_kg=item.peso_kg,
        valor_nota=item.valor_nota,
        valor_frete_bruto=item.valor_frete_bruto,
        valor_avaria=item.valor_avaria,
        valor_frete_pago=paid,
    )


def _persisted_freight_duplicate_signature(freight: Frete) -> tuple[object, ...] | None:
    """Calcula a mesma chave operacional para um frete já salvo no portal."""
    driver_id = (
        freight.id_motorista_agregado
        if freight.tipo_transporte == "AGREGADO"
        else freight.id_motorista_transportadora
    )
    return _freight_duplicate_signature(
        data_servico=freight.data_servico,
        tipo_transporte=freight.tipo_transporte,
        id_motorista=driver_id,
        rota_cidade=freight.rota_cidade,
        km_inicial=freight.km_inicial,
        km_final=freight.km_final,
        km_rodado=freight.km_rodado,
        quantidade_entregas=freight.quantidade_entregas,
        peso_kg=freight.peso_kg,
        valor_nota=freight.valor_nota,
        valor_frete_bruto=freight.valor_frete_bruto,
        valor_avaria=freight.valor_avaria,
        valor_frete_pago=freight.valor_frete_pago,
    )


def _transport_access(
    db: Session,
    access: AuthorizationContext,
) -> int:
    """Exige escopo global ou do setor Transporte e devolve o ID do setor."""
    sector = repository.get_active_sector_by_code(db, codigo=FREIGHT_SECTOR_CODE)
    if sector is None:
        raise NotFoundError("O setor Transporte não está ativo no Portal.")
    grants = tuple(
        grant
        for grant in access.grants
        if grant.tipo_escopo == "GLOBAL"
        or (grant.tipo_escopo == "SETOR" and grant.id_setor == sector.id_setor)
    )
    if not grants:
        raise PermissionDeniedError("Fretes exige acesso global ou acesso ao setor Transporte.")
    return sector.id_setor


def _quote_response(calculation: FreightCalculation) -> FreightQuoteResponse:
    """Converte o resultado interno da calculadora no contrato da API."""
    return FreightQuoteResponse(
        status_calculo=calculation.status,
        valor_frete_bruto=calculation.valor_frete_bruto,
        percentual_frete=calculation.percentual_frete,
        motivo_pendencia=calculation.motivo_pendencia,
        detalhe_calculo=calculation.detalhe,
    )


def _tariff_source(value: str | None) -> TariffSource | None:
    """Valida e tipa o código da tarifa lido de uma linha persistida."""
    if value is None:
        return None
    if value == "AGREGADOS_CD":
        return "AGREGADOS_CD"
    if value == "JUST_IN_TIME":
        return "JUST_IN_TIME"
    if value == "PAULO_CRUZ":
        return "PAULO_CRUZ"
    raise ValueError(f"Código de fonte de tarifa inválido no frete: {value!r}")


def _payment_amount(freight: Frete) -> Decimal | None:
    """Usa o líquido histórico ou deriva bruto menos avaria."""
    if freight.valor_frete_pago is not None:
        return freight.valor_frete_pago
    gross = freight.valor_frete_bruto
    if gross is None:
        return None
    return gross - freight.valor_avaria


def _historical_payment_warning(freight: Frete) -> FreightPaymentWarning | None:
    """Lista dados tarifários ausentes quando o valor financeiro histórico existe."""
    imported = _historical_import_source(freight)
    if imported is None:
        return None

    missing: list[str] = []
    if freight.valor_frete_bruto is None:
        missing.append("frete bruto")

    if freight.codigo_fonte_tarifa == "AGREGADOS_CD":
        if not freight.rota_cidade:
            missing.append("rota/cidade")
        if freight.peso_kg is None:
            missing.append("peso")
        if freight.valor_nota is None:
            missing.append("valor da nota")
        if freight.km_rodado is None:
            missing.append("KM rodado")
    elif freight.codigo_fonte_tarifa == "JUST_IN_TIME":
        if freight.codigo_zona_jit is None:
            missing.append("zona JUST IN TIME")
        if freight.peso_kg is None:
            missing.append("peso")
    elif freight.codigo_fonte_tarifa == "PAULO_CRUZ" and freight.tipo_caminhao is None:
        missing.append("tipo de caminhão")

    if not missing:
        return None

    if freight.valor_frete_bruto is None and freight.valor_frete_pago is not None:
        message = (
            "O líquido informado na planilha será usado no pagamento. O frete bruto e os dados "
            "tarifários listados não estão disponíveis para conferência ou recálculo; este aviso não bloqueia a exportação."
        )
    else:
        message = (
            "O valor histórico calculado será preservado. Os campos ausentes só são necessários "
            "para auditar ou recalcular a tarifa; este aviso não bloqueia a exportação."
        )
    return FreightPaymentWarning(
        codigo_frete=UUID(freight.codigo_frete),
        data_servico=freight.data_servico,
        nome_transportador=freight.nome_transportador,
        rota_cidade=freight.rota_cidade,
        campos_ausentes=missing,
        motivo_aviso=message,
    )


def _transport_type(value: str) -> TransportType:
    """Valida e tipa a modalidade do transporte persistida."""
    if value == "PROPRIO":
        return "PROPRIO"
    if value == "AGREGADO":
        return "AGREGADO"
    if value == "TRANSPORTADORA":
        return "TRANSPORTADORA"
    raise ValueError(f"Tipo de transporte inválido no frete: {value!r}")


def _freight_status(value: str) -> FreightStatus:
    """Valida e tipa o status do cálculo lido de uma linha persistida."""
    if value == "CALCULADO":
        return "CALCULADO"
    if value == "PENDENTE_CONFERENCIA":
        return "PENDENTE_CONFERENCIA"
    raise ValueError(f"Status de cálculo inválido no frete: {value!r}")


def _truck_type(value: str | None) -> TruckType:
    """Valida e tipa o modelo de caminhão armazenado no lançamento."""
    if value is None:
        return None
    if value == "SAVEIRO":
        return "SAVEIRO"
    if value == "KIA_BONGO":
        return "KIA_BONGO"
    if value == "CAMINHAO_3_4":
        return "CAMINHAO_3_4"
    if value == "CAMINHAO_TOCO":
        return "CAMINHAO_TOCO"
    raise ValueError(f"Tipo de caminhão inválido no frete: {value!r}")


def _freight_response(
    freight: Frete,
    *,
    cancellation: FreteEvento | None = None,
) -> FreightResponse:
    """Converte o registro operacional preservando dados e situação do frete."""
    calculation_detail = {
        key: value for key, value in freight.detalhe_calculo.items() if key != "request_fingerprint"
    }
    status, reason = effective_status(freight)
    if status != freight.status_calculo or reason != freight.motivo_pendencia:
        calculation_detail.update(status=status, motivo=reason)
    payment_amount = _payment_amount(freight)
    return FreightResponse(
        id_frete=freight.id_frete,
        codigo_frete=UUID(freight.codigo_frete),
        tipo_transporte=_transport_type(freight.tipo_transporte),
        nome_transportador=freight.nome_transportador,
        id_motorista_agregado=freight.id_motorista_agregado,
        id_motorista_transportadora=freight.id_motorista_transportadora,
        nome_motorista_transportadora=freight.nome_motorista_transportadora,
        codigo_fonte_tarifa=_tariff_source(freight.codigo_fonte_tarifa),
        data_servico=freight.data_servico,
        rota_cidade=freight.rota_cidade,
        km_inicial=freight.km_inicial,
        km_final=freight.km_final,
        km_rodado=freight.km_rodado,
        quantidade_entregas=freight.quantidade_entregas,
        peso_kg=freight.peso_kg,
        valor_nota=freight.valor_nota,
        tipo_caminhao=_truck_type(freight.tipo_caminhao),
        carro_apoio=(freight.detalhe_calculo.get("carro_apoio")
                     if freight.detalhe_calculo.get("carro_apoio") in ("SAVEIRO", "KIA_BONGO")
                     else None),
        codigo_zona_jit=freight.codigo_zona_jit,
        adicionais_jit=freight.adicionais_jit,
        valor_frete_bruto=freight.valor_frete_bruto,
        valor_avaria=freight.valor_avaria,
        quantidade_avarias=freight.quantidade_avarias,
        valor_frete_pago=payment_amount,
        percentual_frete=freight.percentual_frete,
        status_calculo=_freight_status(status),
        motivo_pendencia=reason,
        detalhe_calculo=calculation_detail,
        criado_por=freight.criado_por,
        criado_em=freight.criado_em,
        cancelado=cancellation is not None,
        cancelado_em=cancellation.ocorrido_em if cancellation else None,
        cancelado_por=cancellation.id_usuario_ator if cancellation else None,
        justificativa_cancelamento=(
            str(cancellation.detalhes.get("justificativa", "")) or None
            if cancellation
            else None
        ),
    )


def _prepare_freight_payload(
    db: Session,
    payload: FreightInput,
    *,
    require_delivery_data: bool,
) -> tuple[FreightInput, dict[str, object] | None]:
    """Substitui os campos agregados pelos dados vigentes de equipe e Entregas."""
    if payload.tipo_transporte == "TRANSPORTADORA":
        driver_id = payload.id_motorista_transportadora
        if driver_id is None or payload.codigo_fonte_tarifa is None:
            raise ConflictError("Selecione o motorista da transportadora independente.")
        driver = repository.get_carrier_driver(
            db,
            id_motorista=driver_id,
            data_servico=payload.data_servico,
            codigo_transportadora=payload.codigo_fonte_tarifa,
        )
        if driver is None:
            raise NotFoundError(
                "O motorista não está ativo e vinculado à transportadora na data do serviço."
            )
        return (
            payload.model_copy(update={"quantidade_avarias": 0}),
            {
                "id_motorista_transportadora": driver.id_pessoa,
                "nome_motorista_transportadora": driver.nome_exibicao,
            },
        )
    if payload.tipo_transporte != "AGREGADO":
        return payload.model_copy(update={"quantidade_avarias": 0}), None

    driver_id = payload.id_motorista_agregado
    if driver_id is None:
        raise ConflictError("Selecione o motorista agregado no cadastro de equipes.")
    driver = repository.get_aggregate_driver(
        db,
        id_motorista=driver_id,
        data_servico=payload.data_servico,
    )
    if driver is None:
        raise NotFoundError(
            "O motorista não está ativo como agregado classificado na data do serviço."
        )

    route, cities, deliveries, damages, delivery_rows, weight = repository.get_driver_delivery_summary(
        db,
        id_motorista=driver_id,
        data_servico=payload.data_servico,
    )
    delivery_weight_available = weight is not None and weight > 0
    effective_weight = payload.peso_kg
    if require_delivery_data and effective_weight <= 0:
        raise ConflictError(
            "O peso total não foi informado nas Entregas; informe um peso maior que zero no lançamento do frete."
        )
    prepared = payload.model_copy(
        update={
            "nome_transportador": driver.nome_exibicao,
            "rota_cidade": payload.rota_cidade,
            "quantidade_entregas": payload.quantidade_entregas,
            "quantidade_avarias": payload.quantidade_avarias,
            "peso_kg": effective_weight,
        }
    )
    source_detail: dict[str, object] = {
        "id_motorista_agregado": driver.id_pessoa,
        "nome_motorista_agregado": driver.nome_exibicao,
        "data_entregas_consultadas": payload.data_servico.isoformat(),
        "cidades_entregas": cities,
        "quantidade_entregas_origem": deliveries,
        "quantidade_avarias_origem": damages,
        "quantidade_registros_entrega": delivery_rows,
        "peso_total_kg_origem": str(weight) if weight is not None else None,
        "peso_total_kg_usado": str(effective_weight),
        "peso_informado_manualmente": not delivery_weight_available or effective_weight != weight,
        "rota_cidade_origem": route,
        "dados_alterados_no_frete": bool(delivery_rows) and (
            payload.rota_cidade != route or payload.quantidade_entregas != deliveries
            or payload.quantidade_avarias != damages
            or (delivery_weight_available and payload.peso_kg != weight)
        ),
        "dados_informados_manualmente": delivery_rows == 0,
    }
    return prepared, source_detail


def _freight_calculation(
    db: Session,
    payload: FreightInput,
    *,
    require_delivery_data: bool,
) -> tuple[FreightInput, FreightCalculation]:
    """Prepara a origem dos dados e calcula a tarifa com valores confirmados."""
    prepared, source_detail = _prepare_freight_payload(
        db,
        payload,
        require_delivery_data=require_delivery_data,
    )
    calculation = calculate_freight(prepared)
    if source_detail is not None:
        detail_key = (
            "motorista_transportadora"
            if payload.tipo_transporte == "TRANSPORTADORA"
            else "origem_entregas"
        )
        calculation = replace(
            calculation,
            detalhe={**calculation.detalhe, detail_key: source_detail},
        )
    return prepared, calculation


def _carrier_driver_name(calculation: FreightCalculation) -> str | None:
    """Obtém o nome validado para guardar como fotografia do motorista."""
    value = calculation.detalhe.get("motorista_transportadora")
    if not isinstance(value, dict):
        return None
    name = value.get("nome_motorista_transportadora")
    return name if isinstance(name, str) else None


def get_tariff_options(
    db: Session,
    *,
    access: AuthorizationContext,
) -> dict[str, object]:
    """Entrega as opções da tarifa somente a usuários autorizados de Fretes."""
    from .tariff_catalog import tariff_options

    try:
        _transport_access(db, access)
        return tariff_options()
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_aggregate_drivers(
    db: Session,
    *,
    data_servico: date,
    access: AuthorizationContext,
) -> list[FreightAggregateDriverOption]:
    """Entrega motoristas terceiros vigentes para a data do serviço."""
    try:
        _transport_access(db, access)
        return [
            FreightAggregateDriverOption(
                id_motorista=driver.id_pessoa,
                nome_motorista=driver.nome_exibicao,
            )
            for driver in repository.list_aggregate_drivers(
                db,
                data_servico=data_servico,
            )
        ]
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_carrier_drivers(
    db: Session,
    *,
    data_servico: date,
    access: AuthorizationContext,
) -> list[FreightCarrierDriverOption]:
    """Lista motoristas e empresas disponíveis para o lançamento."""
    try:
        _transport_access(db, access)
        options: list[FreightCarrierDriverOption] = []
        for driver in repository.list_carrier_drivers(db, data_servico=data_servico):
            code = driver.codigo_transportadora_independente
            if code == "JUST_IN_TIME":
                carrier_name = "JUST IN TIME"
            elif code == "PAULO_CRUZ":
                carrier_name = "Paulo Cruz"
            else:
                continue
            options.append(
                FreightCarrierDriverOption(
                    id_motorista=driver.id_pessoa,
                    nome_motorista=driver.nome_exibicao,
                    codigo_transportadora=code,
                    nome_transportadora=carrier_name,
                )
            )
        return options
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_historical_freight_edit_drivers(
    db: Session,
    *,
    data_servico: date,
    access: AuthorizationContext,
) -> list[HistoricalFreightEditDriverOption]:
    """Lista os motoristas cadastrados que podem ser vinculados na data histórica."""
    try:
        _transport_access(db, access)
        options: list[HistoricalFreightEditDriverOption] = []
        carrier_names = {"JUST_IN_TIME": "JUST IN TIME", "PAULO_CRUZ": "Paulo Cruz"}
        for driver in repository.list_historical_freight_drivers_at_date(
            db,
            data_servico=data_servico,
        ):
            carrier_code = driver.codigo_transportadora_independente
            is_carrier = driver.modalidade_terceirizada == "TRANSPORTADORA_INDEPENDENTE"
            if is_carrier and carrier_code not in carrier_names:
                continue
            options.append(
                HistoricalFreightEditDriverOption(
                    id_motorista=driver.id_pessoa,
                    nome_motorista=driver.nome_exibicao,
                    tipo_transporte="TRANSPORTADORA" if is_carrier else "AGREGADO",
                    codigo_transportadora=(carrier_code if is_carrier else None),
                    nome_transportadora=(carrier_names.get(carrier_code or "") if is_carrier else None),
                )
            )
        return options
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_delivery_summary(
    db: Session,
    *,
    data_servico: date,
    id_motorista: int,
    access: AuthorizationContext,
) -> FreightDeliverySummary:
    """Consulta a rota, o volume e as avarias confirmadas de um motorista."""
    try:
        _transport_access(db, access)
        driver = repository.get_historical_freight_driver_at_date(
            db,
            id_motorista=id_motorista,
            data_servico=data_servico,
        )
        if driver is None:
            raise NotFoundError("O motorista não está cadastrado e vigente na data do serviço.")
        route, cities, deliveries, damages, delivery_rows, weight = repository.get_driver_delivery_summary(
            db,
            id_motorista=id_motorista,
            data_servico=data_servico,
        )
        return FreightDeliverySummary(
            id_motorista=id_motorista,
            data_servico=data_servico,
            rota_cidade=route,
            cidades=cities,
            quantidade_entregas=deliveries,
            quantidade_avarias=damages,
            quantidade_registros=delivery_rows,
            peso_total_kg=weight,
        )
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def quote_freight(
    db: Session,
    *,
    payload: FreightInput,
    access: AuthorizationContext,
) -> FreightQuoteResponse:
    """Simula um lançamento sem persistir dados ou gerar evento de auditoria."""
    try:
        _transport_access(db, access)
        _, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        return _quote_response(calculation)
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_freight(
    db: Session,
    *,
    payload: FreightInput,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Calcula e grava um frete com chave idempotente e evento de auditoria."""
    try:
        sector_id = _transport_access(db, access)
        previous = repository.get_freight_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if previous is not None:
            if previous.id_setor != sector_id or previous.criado_por != access.id_usuario:
                raise ConflictError("A chave de idempotência já foi utilizada.")
            fingerprint = _request_fingerprint(payload)
            if previous.detalhe_calculo.get("request_fingerprint") != fingerprint:
                raise ConflictError(
                    "A chave de idempotência já foi usada com outros dados de frete."
                )
            return _freight_response(previous)

        prepared_payload, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        # A repetição idempotente compara o mesmo pedido recebido do cliente.
        # `prepared_payload` já contém o nome/rota/contagens recalculados do banco.
        request_fingerprint = _request_fingerprint(payload)
        calculation_detail = {
            **calculation.detalhe,
            "request_fingerprint": request_fingerprint,
        }
        gross = calculation.valor_frete_bruto
        paid: Decimal | None = None
        if gross is not None:
            paid = gross - prepared_payload.valor_avaria

        now = _utc_now()
        freight = Frete(
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(idempotency_key),
            id_setor=sector_id,
            tipo_transporte=prepared_payload.tipo_transporte,
            nome_transportador=prepared_payload.nome_transportador,
            id_motorista_agregado=prepared_payload.id_motorista_agregado,
            id_motorista_transportadora=prepared_payload.id_motorista_transportadora,
            nome_motorista_transportadora=_carrier_driver_name(calculation),
            codigo_fonte_tarifa=prepared_payload.codigo_fonte_tarifa,
            data_servico=prepared_payload.data_servico,
            rota_cidade=prepared_payload.rota_cidade,
            km_inicial=prepared_payload.km_inicial,
            km_final=prepared_payload.km_final,
            km_rodado=prepared_payload.km_rodado,
            quantidade_entregas=prepared_payload.quantidade_entregas,
            peso_kg=prepared_payload.peso_kg,
            valor_nota=prepared_payload.valor_nota,
            tipo_caminhao=prepared_payload.tipo_caminhao,
            codigo_zona_jit=prepared_payload.codigo_zona_jit,
            adicionais_jit=prepared_payload.adicionais_jit,
            valor_frete_bruto=gross,
            valor_avaria=prepared_payload.valor_avaria,
            quantidade_avarias=prepared_payload.quantidade_avarias,
            valor_frete_pago=paid,
            percentual_frete=calculation.percentual_frete,
            status_calculo=calculation.status,
            motivo_pendencia=calculation.motivo_pendencia,
            detalhe_calculo=calculation_detail,
            criado_por=access.id_usuario,
            criado_em=now,
        )
        repository.save_freight(
            db,
            freight,
            actor_id=access.id_usuario,
            occurred_at=now,
        )
        db.commit()
        db.refresh(freight)
        return _freight_response(freight)
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "A solicitação de lançamento foi repetida ou conflita com um registro."
        ) from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def import_historical_freights(
    db: Session,
    *,
    payload: HistoricalFreightImportRequest,
    access: AuthorizationContext,
) -> HistoricalFreightImportResponse:
    """Preserva os valores da planilha e grava o lote com auditoria idempotente."""
    try:
        sector_id = _transport_access(db, access)
        drivers = repository.list_historical_freight_driver_versions(
            db,
            data_de=min(item.data_servico for item in payload.itens),
            data_ate=max(item.data_servico for item in payload.itens),
        )
        drivers_by_name: dict[str, list[Pessoa]] = {}
        drivers_by_name_component: dict[str, list[Pessoa]] = {}
        drivers_by_carrier: dict[str, list[Pessoa]] = {}
        for driver in drivers:
            normalized_driver_name = normalize_label(driver.nome_exibicao)
            drivers_by_name.setdefault(normalized_driver_name, []).append(driver)
            for component in _person_name_components(driver.nome_exibicao):
                drivers_by_name_component.setdefault(component, []).append(driver)
            if driver.codigo_transportadora_independente in {"JUST_IN_TIME", "PAULO_CRUZ"}:
                drivers_by_carrier.setdefault(driver.codigo_transportadora_independente, []).append(driver)
        tariff_route_index, locality_route_index = _build_historical_route_indexes(
            repository.list_localities_for_freight_import(db)
        )

        fingerprints = [
            sha256(
                json.dumps(
                    item.model_dump(mode="json"),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            for item in payload.itens
        ]
        keys = [
            uuid5(
                NAMESPACE_URL,
                f"lancamento-logistica-frete-xlsx:{payload.sha256_arquivo}:"
                f"{normalize_label(payload.aba_origem)}:{item.linha_planilha}",
            )
            for item in payload.itens
        ]
        existing = repository.get_freights_by_idempotency_keys(
            db,
            idempotency_keys=keys,
        )
        existing_freights = repository.list_freights_for_historical_duplicate_check(
            db,
            id_setor=sector_id,
            data_de=min(item.data_servico for item in payload.itens),
            data_ate=max(item.data_servico for item in payload.itens),
        )
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete for freight in existing_freights],
        )
        existing_by_source: dict[tuple[str, str, int], list[Frete]] = {}
        available_duplicate_signatures: dict[tuple[object, ...], int] = {}
        for freight in existing_freights:
            imported_source = freight.detalhe_calculo.get("importacao_planilha")
            if isinstance(imported_source, dict):
                source_hash = imported_source.get("sha256_arquivo")
                source_sheet = imported_source.get("aba")
                source_row = imported_source.get("linha")
                if (
                    isinstance(source_hash, str)
                    and isinstance(source_sheet, str)
                    and isinstance(source_row, int)
                ):
                    source_key = (
                        source_hash,
                        normalize_label(source_sheet),
                        source_row,
                    )
                    existing_by_source.setdefault(source_key, []).append(freight)
            if freight.id_frete in cancellations:
                continue
            signature = _persisted_freight_duplicate_signature(freight)
            if signature is not None:
                available_duplicate_signatures[signature] = (
                    available_duplicate_signatures.get(signature, 0) + 1
                )

        pending: list[Frete] = []
        updates: list[Frete] = []
        update_events: list[FreteEvento] = []
        already_exists = 0
        matched_aggregates = 0
        matched_carriers = 0
        unmatched = 0
        now = _utc_now()
        for item, idempotency_key, row_fingerprint in zip(
            payload.itens,
            keys,
            fingerprints,
            strict=True,
        ):
            gross = item.valor_frete_bruto
            damage = item.valor_avaria
            calculated_ratio = (
                (gross / item.valor_nota).quantize(Decimal("0.000001"))
                if gross is not None and item.valor_nota not in (None, Decimal("0"))
                else None
            )
            ratio = item.percentual_frete if item.percentual_frete is not None else calculated_ratio
            paid = (
                item.valor_frete_pago
                if item.valor_frete_pago is not None
                else gross - damage if gross is not None else None
            )
            match = _match_historical_driver(
                item.nome_transportador,
                item.data_servico,
                drivers_by_name,
                drivers_by_name_component,
                drivers_by_carrier,
            )
            transport_fields, match = _historical_transport_fields(match, item.nome_transportador)
            route_match = _canonicalize_historical_route(
                item.rota_cidade,
                tariff_route_index,
                locality_route_index,
            )
            route_value = route_match.value if route_match.status == "VINCULADA" else item.rota_cidade
            if match.status == "VINCULADO":
                if transport_fields["tipo_transporte"] == "TRANSPORTADORA":
                    matched_carriers += 1
                else:
                    matched_aggregates += 1
            else:
                unmatched += 1

            pending_reasons: list[str] = []
            if gross is None:
                pending_reasons.append("Valor do frete bruto ausente na planilha importada.")
            if match.status == "AMBIGUO":
                if match.carrier_code is not None:
                    pending_reasons.append(
                        "A transportadora foi identificada, mas há mais de um motorista possível no cadastro."
                    )
                else:
                    pending_reasons.append(
                        "Há mais de um motorista com esse nome no cadastro; o vínculo precisa de conferência."
                    )
            elif match.status != "VINCULADO":
                if match.carrier_code is not None:
                    pending_reasons.append(
                        "A transportadora foi identificada, mas o motorista não foi encontrado no cadastro."
                    )
                else:
                    pending_reasons.append(
                        "Responsável não encontrado no cadastro de agregados ou transportadoras independentes."
                    )
            pending_reason = " ".join(pending_reasons) or None
            status_calculation = (
                "CALCULADO"
                if (
                    gross is not None
                    and match.status == "VINCULADO"
                )
                else "PENDENTE_CONFERENCIA"
            )
            matched_driver = match.person
            import_detail: dict[str, object] = {
                "arquivo": payload.nome_arquivo,
                "sha256_arquivo": payload.sha256_arquivo,
                "aba": payload.aba_origem,
                "linha": item.linha_planilha,
                "fingerprint": row_fingerprint,
                "data_servico_planilha": item.data_servico_planilha,
                "data_servico_ano_inferido": item.data_servico_ano_inferido,
                "transportador_planilha": _historical_source_text(
                    item,
                    "nome_transportador",
                    item.nome_transportador,
                ),
                "valores_originais_planilha": item.valores_originais_planilha,
                "vinculo_responsavel_status": match.status,
                "vinculo_responsavel_criterio": match.basis,
                "vinculo_responsavel_correspondencia": match.name_match_type,
                "vinculo_responsavel_id_pessoa": matched_driver.id_pessoa if matched_driver else None,
                "vinculo_responsavel_nome_cadastrado": matched_driver.nome_exibicao if matched_driver else None,
                "vinculo_responsavel_modalidade": matched_driver.modalidade_terceirizada if matched_driver else None,
                "vinculo_responsavel_transportadora": (
                    matched_driver.codigo_transportadora_independente
                    if matched_driver
                    else match.carrier_code
                ),
                "tipo_transporte_identificado": (
                    match.status == "VINCULADO" or match.carrier_code is not None
                ),
                "rota_cidade_planilha": _historical_source_text(
                    item,
                    "rota_cidade",
                    item.rota_cidade,
                ),
                "rota_cidade_status": route_match.status,
                "rota_cidade_criterio": route_match.basis,
                "rota_cidade_cadastrada": route_value if route_match.status == "VINCULADA" else None,
                "campos_nao_informados": [
                    label
                    for label, value in (
                        ("transportador", item.nome_transportador),
                        ("rota_cidade", _historical_source_text(item, "rota_cidade", item.rota_cidade)),
                        ("quantidade_entregas", item.quantidade_entregas),
                        ("peso_kg", item.peso_kg),
                        ("valor_nota", item.valor_nota),
                        ("valor_frete_bruto", gross),
                        ("valor_frete_pago", item.valor_frete_pago),
                        ("percentual_frete", item.percentual_frete),
                        ("valor_avaria", _historical_source_text(item, "valor_avaria", damage)),
                        ("km_inicial", item.km_inicial),
                        ("km_final", item.km_final),
                        ("km_rodado", item.km_rodado),
                    )
                    if value is None
                ],
                "quantidade_avarias_informada": False,
                "responsavel_vinculado_ao_cadastro": match.status == "VINCULADO",
                "valor_frete_bruto_planilha": _historical_source_text(item, "valor_frete_bruto", gross),
                "valor_avaria_planilha": _historical_source_text(item, "valor_avaria", damage),
                "valor_frete_pago_planilha": _historical_source_text(item, "valor_frete_pago", item.valor_frete_pago),
                "valor_frete_pago_importado": str(paid) if paid is not None else None,
                "percentual_frete_planilha": _historical_source_text(
                    item,
                    "percentual_frete",
                    item.percentual_frete_planilha,
                ),
                "percentual_frete_importado": str(ratio) if ratio is not None else None,
                "km_rodado_planilha": _historical_source_text(item, "km_rodado", item.km_rodado),
                "km_inicial_planilha": _historical_source_text(item, "km_inicial", item.km_inicial),
                "km_final_planilha": _historical_source_text(item, "km_final", item.km_final),
            }
            calculation_detail: dict[str, object] = {
                "status": status_calculation,
                "metodo_calculo": "VALOR_HISTORICO_IMPORTADO",
                "fonte_tarifa": transport_fields["codigo_fonte_tarifa"],
                "percentual_frete": str(ratio) if ratio is not None else None,
                "motivo": pending_reason,
                "importacao_planilha": import_detail,
            }
            operational_km = (
                (None, None, None)
                if transport_fields["tipo_transporte"] == "TRANSPORTADORA"
                else (item.km_inicial, item.km_final, item.km_rodado)
            )
            source_key = (
                payload.sha256_arquivo,
                normalize_label(payload.aba_origem),
                item.linha_planilha,
            )
            previous = existing.get(str(idempotency_key))
            if previous is None:
                source_matches = existing_by_source.get(source_key, [])
                if len(source_matches) > 1:
                    raise ConflictError(
                        f"A linha {item.linha_planilha} aparece mais de uma vez no histórico da importação."
                    )
                previous = source_matches[0] if source_matches else None
            if previous is not None:
                previous_import = previous.detalhe_calculo.get("importacao_planilha")
                if (
                    previous.id_setor != sector_id
                    or not isinstance(previous_import, dict)
                ):
                    raise ConflictError(
                        f"A linha {item.linha_planilha} já existe e não pertence a esta importação."
                    )

                previous_linked = (
                    previous_import.get("vinculo_responsavel_status") == "VINCULADO"
                    or previous_import.get("responsavel_vinculado_ao_cadastro") is True
                )
                previous_type_identified = (
                    previous_import.get("tipo_transporte_identificado") is True
                )
                current_type_identified = (
                    match.status == "VINCULADO" or match.carrier_code is not None
                )
                previous_route_status = previous_import.get("rota_cidade_status")
                resolution_improved = (
                    (not previous_linked and match.status == "VINCULADO")
                    or (not previous_type_identified and current_type_identified)
                    or (
                        previous_route_status not in {"VINCULADA", "NAO_INFORMADA"}
                        and route_match.status in {"VINCULADA", "NAO_INFORMADA"}
                    )
                )
                if previous_import.get("fingerprint") == row_fingerprint and not resolution_improved:
                    already_exists += 1
                    continue
                can_complete_missing_gross = previous.valor_frete_bruto is None and gross is not None
                if previous.status_calculo != "PENDENTE_CONFERENCIA" or not (
                    can_complete_missing_gross or resolution_improved
                ):
                    raise ConflictError(
                        f"A linha {item.linha_planilha} já foi importada com outros dados."
                    )
                if any(
                    event.tipo_evento == "FRETE_CANCELADO"
                    for event in repository.list_freight_events(db, id_frete=previous.id_frete)
                ):
                    raise ConflictError(
                        f"A linha {item.linha_planilha} corresponde a um frete cancelado."
                    )

                before = _freight_response(previous).model_dump(mode="json")
                for field_name, value in transport_fields.items():
                    setattr(previous, field_name, value)
                previous.data_servico = item.data_servico
                previous.rota_cidade = route_value
                previous.km_inicial, previous.km_final, previous.km_rodado = operational_km
                previous.quantidade_entregas = item.quantidade_entregas
                previous.peso_kg = item.peso_kg
                previous.valor_nota = item.valor_nota
                previous.valor_frete_bruto = gross
                previous.valor_avaria = damage
                previous.quantidade_avarias = 0
                previous.valor_frete_pago = paid
                previous.percentual_frete = ratio
                previous.status_calculo = status_calculation
                previous.motivo_pendencia = pending_reason
                previous.detalhe_calculo = calculation_detail
                updates.append(previous)
                update_events.append(
                    FreteEvento(
                        id_frete=previous.id_frete,
                        id_usuario_ator=access.id_usuario,
                        tipo_evento="FRETE_ATUALIZADO",
                        ocorrido_em=now,
                        detalhes={
                            "origem": "IMPORTACAO_XLSX",
                            "arquivo": payload.nome_arquivo,
                            "linha_planilha": item.linha_planilha,
                            "pendencia_concluida": status_calculation == "CALCULADO",
                            "antes": before,
                            "depois": _freight_response(previous).model_dump(mode="json"),
                        },
                    )
                )
                continue

            duplicate_signature = _historical_duplicate_signature(
                item,
                transport_fields,
                route_value,
                operational_km,
                paid,
            )
            if duplicate_signature is not None:
                duplicate_count = available_duplicate_signatures.get(duplicate_signature, 0)
                if duplicate_count > 0:
                    available_duplicate_signatures[duplicate_signature] = duplicate_count - 1
                    already_exists += 1
                    continue

            pending.append(
                Frete(
                    codigo_frete=str(uuid4()),
                    chave_idempotencia=str(idempotency_key),
                    id_setor=sector_id,
                    **transport_fields,
                    data_servico=item.data_servico,
                    rota_cidade=route_value,
                    km_inicial=operational_km[0],
                    km_final=operational_km[1],
                    km_rodado=operational_km[2],
                    quantidade_entregas=item.quantidade_entregas,
                    peso_kg=item.peso_kg,
                    valor_nota=item.valor_nota,
                    tipo_caminhao=None,
                    codigo_zona_jit=None,
                    adicionais_jit=[],
                    valor_frete_bruto=gross,
                    valor_avaria=damage,
                    quantidade_avarias=0,
                    valor_frete_pago=paid,
                    percentual_frete=ratio,
                    status_calculo=status_calculation,
                    motivo_pendencia=pending_reason,
                    detalhe_calculo=calculation_detail,
                    criado_por=access.id_usuario,
                    criado_em=now,
                )
            )

        if pending or updates:
            repository.save_freights(
                db,
                pending,
                actor_id=access.id_usuario,
                occurred_at=now,
            )
            db.add_all(update_events)
            db.commit()
        return HistoricalFreightImportResponse(
            importados=len(pending),
            atualizados=len(updates),
            ja_existentes=already_exists,
            vinculados_agregados=matched_aggregates,
            vinculados_transportadoras=matched_carriers,
            sem_vinculo=unmatched,
        )
    except (ConflictError, PermissionDeniedError, NotFoundError):
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "O banco recusou a importação. Confira se a migration de Fretes está aplicada e se a planilha já foi importada."
        ) from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Carrega os dados completos do frete selecionado dentro do setor permitido."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete],
        )
        return _freight_response(freight, cancellation=cancellations.get(freight.id_frete))
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    payload: FreightInput,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Atualiza o lançamento, recalcula a tarifa e guarda snapshots na auditoria."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
            lock=True,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")
        if isinstance(freight.detalhe_calculo.get("importacao_planilha"), dict):
            raise ConflictError(
                "Fretes históricos importados não podem ser recalculados pela edição normal."
            )

        events = repository.list_freight_events(db, id_frete=freight.id_frete)
        request_fingerprint = _request_fingerprint(payload)
        cancellation = next(
            (event for event in events if event.tipo_evento == "FRETE_CANCELADO"),
            None,
        )
        prior_event = next(
            (
                event
                for event in events
                if event.detalhes.get("idempotency_key") == str(idempotency_key)
            ),
            None,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "FRETE_ATUALIZADO"
                and prior_event.id_usuario_ator == access.id_usuario
                and prior_event.detalhes.get("request_fingerprint") == request_fingerprint
            ):
                return _freight_response(freight, cancellation=cancellation)
            raise ConflictError("A chave de idempotência já foi utilizada.")

        if cancellation is not None:
            raise ConflictError("Um frete cancelado não pode ser editado.")

        prepared_payload, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        gross = calculation.valor_frete_bruto
        paid: Decimal | None = None
        if gross is not None:
            paid = gross - prepared_payload.valor_avaria

        before = _freight_response(freight).model_dump(mode="json")
        freight.tipo_transporte = prepared_payload.tipo_transporte
        freight.nome_transportador = prepared_payload.nome_transportador
        freight.id_motorista_agregado = prepared_payload.id_motorista_agregado
        freight.id_motorista_transportadora = prepared_payload.id_motorista_transportadora
        freight.nome_motorista_transportadora = _carrier_driver_name(calculation)
        freight.codigo_fonte_tarifa = prepared_payload.codigo_fonte_tarifa
        freight.data_servico = prepared_payload.data_servico
        freight.rota_cidade = prepared_payload.rota_cidade
        freight.km_inicial = prepared_payload.km_inicial
        freight.km_final = prepared_payload.km_final
        freight.km_rodado = prepared_payload.km_rodado
        freight.quantidade_entregas = prepared_payload.quantidade_entregas
        freight.peso_kg = prepared_payload.peso_kg
        freight.valor_nota = prepared_payload.valor_nota
        freight.tipo_caminhao = prepared_payload.tipo_caminhao
        freight.codigo_zona_jit = prepared_payload.codigo_zona_jit
        freight.adicionais_jit = prepared_payload.adicionais_jit
        freight.valor_frete_bruto = gross
        freight.valor_avaria = prepared_payload.valor_avaria
        freight.quantidade_avarias = prepared_payload.quantidade_avarias
        freight.valor_frete_pago = paid
        freight.percentual_frete = calculation.percentual_frete
        freight.status_calculo = calculation.status
        freight.motivo_pendencia = calculation.motivo_pendencia
        freight.detalhe_calculo = {
            **calculation.detalhe,
            "request_fingerprint": request_fingerprint,
        }
        now = _utc_now()
        after = _freight_response(freight).model_dump(mode="json")
        db.add(
            FreteEvento(
                id_frete=freight.id_frete,
                id_usuario_ator=access.id_usuario,
                tipo_evento="FRETE_ATUALIZADO",
                ocorrido_em=now,
                detalhes={
                    "idempotency_key": str(idempotency_key),
                    "request_fingerprint": request_fingerprint,
                    "antes": before,
                    "depois": after,
                },
            )
        )
        db.commit()
        db.refresh(freight)
        return _freight_response(freight)
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A edição conflita com um evento já registrado.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_historical_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    payload: HistoricalFreightEditInput,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Edita valores históricos, revalida vínculos e registra o antes/depois."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
            lock=True,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")
        import_source = freight.detalhe_calculo.get("importacao_planilha")
        if not isinstance(import_source, dict):
            raise ConflictError("A edição de valores históricos só se aplica a fretes importados.")

        events = repository.list_freight_events(db, id_frete=freight.id_frete)
        request_fingerprint = sha256(
            json.dumps(
                payload.model_dump(mode="json"),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        cancellation = next(
            (event for event in events if event.tipo_evento == "FRETE_CANCELADO"),
            None,
        )
        prior_event = next(
            (
                event
                for event in events
                if event.detalhes.get("idempotency_key") == str(idempotency_key)
            ),
            None,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "FRETE_ATUALIZADO"
                and prior_event.id_usuario_ator == access.id_usuario
                and prior_event.detalhes.get("request_fingerprint") == request_fingerprint
                and prior_event.detalhes.get("origem") == "EDICAO_HISTORICA"
            ):
                return _freight_response(freight, cancellation=cancellation)
            raise ConflictError("A chave de idempotência já foi utilizada.")
        if cancellation is not None:
            raise ConflictError("Um frete cancelado não pode ser editado.")

        locked_values: dict[str, object] = {}
        imported_fields = {
            "data_servico": "data_servico",
            "rota_cidade": "rota_cidade",
            "km_inicial": "km_inicial",
            "km_final": "km_final",
            "km_rodado": "km_rodado",
            "quantidade_entregas": "quantidade_entregas",
            "peso_kg": "peso_kg",
            "valor_nota": "valor_nota",
            "valor_frete_bruto": "valor_frete_bruto",
            "valor_frete_pago": "valor_frete_pago",
            "percentual_frete": "percentual_frete",
            "valor_avaria": "valor_avaria",
        }
        for source_field, payload_field in imported_fields.items():
            if _historical_source_has_value(import_source, source_field):
                locked_values[payload_field] = getattr(freight, payload_field)
        if locked_values:
            payload = payload.model_copy(update=locked_values)

        drivers = repository.list_historical_freight_driver_versions(
            db,
            data_de=payload.data_servico,
            data_ate=payload.data_servico,
        )
        drivers_by_name: dict[str, list[Pessoa]] = {}
        drivers_by_name_component: dict[str, list[Pessoa]] = {}
        drivers_by_carrier: dict[str, list[Pessoa]] = {}
        for driver in drivers:
            drivers_by_name.setdefault(normalize_label(driver.nome_exibicao), []).append(driver)
            for component in _person_name_components(driver.nome_exibicao):
                drivers_by_name_component.setdefault(component, []).append(driver)
            if driver.codigo_transportadora_independente in {"JUST_IN_TIME", "PAULO_CRUZ"}:
                drivers_by_carrier.setdefault(driver.codigo_transportadora_independente, []).append(driver)

        if payload.id_motorista_selecionado is not None:
            selected_driver = repository.get_historical_freight_driver_at_date(
                db,
                id_motorista=payload.id_motorista_selecionado,
                data_servico=payload.data_servico,
            )
            if selected_driver is None:
                raise NotFoundError("O motorista selecionado não está vigente na data do frete.")
            match = _HistoricalDriverMatch(
                selected_driver,
                "VINCULADO",
                "ID_CADASTRO_SELECIONADO",
                "SELECAO_EXPLICITA",
                selected_driver.codigo_transportadora_independente,
            )
        else:
            match = _match_historical_driver(
                payload.nome_transportador,
                payload.data_servico,
                drivers_by_name,
                drivers_by_name_component,
                drivers_by_carrier,
            )
        if (
            match.status != "VINCULADO"
            and match.carrier_code is None
            and freight.tipo_transporte == "TRANSPORTADORA"
            and freight.codigo_fonte_tarifa in {"JUST_IN_TIME", "PAULO_CRUZ"}
        ):
            match = replace(
                match,
                carrier_code=freight.codigo_fonte_tarifa,
                name_match_type="TRANSPORTADORA_JA_IDENTIFICADA",
            )
        transport_fields, match = _historical_transport_fields(
            match,
            payload.nome_transportador,
        )
        delivery_summary: tuple[str, list[str], int, int, int, Decimal | None] | None = None
        if payload.complementar_com_entregas and payload.id_motorista_selecionado is not None:
            delivery_summary = repository.get_driver_delivery_summary(
                db,
                id_motorista=payload.id_motorista_selecionado,
                data_servico=payload.data_servico,
            )
            (
                summary_route,
                summary_cities,
                summary_quantity,
                summary_damages,
                summary_rows,
                summary_weight,
            ) = delivery_summary
            summary_fills: dict[str, object] = {}
            summary_applied_fields: list[str] = []
            if (
                summary_rows > 0
                and not _historical_source_has_value(import_source, "rota_cidade")
                and freight.rota_cidade is None
                and summary_route
            ):
                if payload.rota_cidade is None:
                    summary_fills["rota_cidade"] = summary_route
                if payload.rota_cidade in (None, summary_route):
                    summary_applied_fields.append("rota_cidade")
            if (
                summary_rows > 0
                and not _historical_source_has_value(import_source, "quantidade_entregas")
                and freight.quantidade_entregas is None
            ):
                if payload.quantidade_entregas is None:
                    summary_fills["quantidade_entregas"] = summary_quantity
                if payload.quantidade_entregas in (None, summary_quantity):
                    summary_applied_fields.append("quantidade_entregas")
            if (
                summary_rows > 0
                and not _historical_source_has_value(import_source, "peso_kg")
                and freight.peso_kg is None
                and summary_weight is not None
            ):
                if payload.peso_kg is None:
                    summary_fills["peso_kg"] = summary_weight
                if payload.peso_kg in (None, summary_weight):
                    summary_applied_fields.append("peso_kg")
            if summary_fills:
                payload = payload.model_copy(update=summary_fills)
            delivery_summary_snapshot: dict[str, object] = {
                "id_motorista": payload.id_motorista_selecionado,
                "data_servico": payload.data_servico.isoformat(),
                "cidades": summary_cities,
                "rota_cidade": summary_route,
                "quantidade_entregas": summary_quantity,
                "peso_total_kg": str(summary_weight) if summary_weight is not None else None,
                "quantidade_avarias": summary_damages,
                "quantidade_registros": summary_rows,
                "campos_complementados": summary_applied_fields,
            }
        else:
            delivery_summary_snapshot = None
        tariff_route_index, locality_route_index = _build_historical_route_indexes(
            repository.list_localities_for_freight_import(db)
        )
        route_match = _canonicalize_historical_route(
            payload.rota_cidade,
            tariff_route_index,
            locality_route_index,
        )
        route_value = (
            route_match.value
            if route_match.status == "VINCULADA"
            else payload.rota_cidade
        )

        historical_calculation = None
        if payload.valor_frete_bruto is None and match.person is not None:
            tariff_source = str(transport_fields["codigo_fonte_tarifa"])
            calculation_input: FreightInput | None = None
            if (
                tariff_source == "AGREGADOS_CD"
                and transport_fields["tipo_transporte"] == "AGREGADO"
                and route_value is not None
                and len(route_value.strip()) >= 2
                and payload.km_rodado is not None
                and payload.peso_kg is not None
                and payload.valor_nota is not None
            ):
                calculation_input = FreightInput(
                    data_servico=payload.data_servico,
                    tipo_transporte="AGREGADO",
                    id_motorista_agregado=match.person.id_pessoa,
                    codigo_fonte_tarifa="AGREGADOS_CD",
                    rota_cidade=route_value,
                    km_inicial=Decimal("0"),
                    km_final=payload.km_rodado,
                    quantidade_entregas=payload.quantidade_entregas or 0,
                    peso_kg=payload.peso_kg,
                    valor_nota=payload.valor_nota,
                    valor_avaria=payload.valor_avaria,
                )
            elif (
                tariff_source == "JUST_IN_TIME"
                and transport_fields["tipo_transporte"] == "TRANSPORTADORA"
                and transport_fields["id_motorista_transportadora"] is not None
                and payload.codigo_zona_jit is not None
                and payload.peso_kg is not None
            ):
                calculation_input = FreightInput(
                    data_servico=payload.data_servico,
                    tipo_transporte="TRANSPORTADORA",
                    nome_transportador=str(transport_fields["nome_transportador"]),
                    id_motorista_transportadora=int(transport_fields["id_motorista_transportadora"]),
                    codigo_fonte_tarifa="JUST_IN_TIME",
                    rota_cidade=route_value or payload.rota_cidade or "JUST IN TIME",
                    km_inicial=None,
                    km_final=None,
                    quantidade_entregas=payload.quantidade_entregas or 0,
                    peso_kg=payload.peso_kg,
                    valor_nota=payload.valor_nota,
                    valor_avaria=payload.valor_avaria,
                    codigo_zona_jit=payload.codigo_zona_jit,
                    adicionais_jit=payload.adicionais_jit,
                )
            elif (
                tariff_source == "PAULO_CRUZ"
                and transport_fields["tipo_transporte"] == "TRANSPORTADORA"
                and transport_fields["id_motorista_transportadora"] is not None
                and payload.tipo_caminhao is not None
            ):
                calculation_input = FreightInput(
                    data_servico=payload.data_servico,
                    tipo_transporte="TRANSPORTADORA",
                    nome_transportador=str(transport_fields["nome_transportador"]),
                    id_motorista_transportadora=int(transport_fields["id_motorista_transportadora"]),
                    codigo_fonte_tarifa="PAULO_CRUZ",
                    rota_cidade=route_value or payload.rota_cidade or "Paulo Cruz",
                    km_inicial=None,
                    km_final=None,
                    quantidade_entregas=payload.quantidade_entregas or 0,
                    peso_kg=payload.peso_kg or Decimal("0"),
                    valor_nota=payload.valor_nota,
                    valor_avaria=payload.valor_avaria,
                    tipo_caminhao=payload.tipo_caminhao,
                    carro_apoio=payload.carro_apoio,
                )

            if calculation_input is not None:
                result = calculate_freight(calculation_input)
                if result.status == "CALCULADO" and result.valor_frete_bruto is not None:
                    payload = payload.model_copy(update={"valor_frete_bruto": result.valor_frete_bruto})
                    historical_calculation = result.detalhe

        paid = payload.valor_frete_pago
        if paid is None and payload.valor_frete_bruto is not None:
            paid = payload.valor_frete_bruto - payload.valor_avaria
        ratio = payload.percentual_frete
        if (
            ratio is None
            and payload.valor_frete_bruto is not None
            and payload.valor_nota not in (None, Decimal("0"))
        ):
            ratio = (payload.valor_frete_bruto / payload.valor_nota).quantize(
                Decimal("0.000001")
            )

        pending_reasons: list[str] = []
        if payload.valor_frete_bruto is None:
            pending_reasons.append("Valor do frete bruto ausente.")
        if match.status == "AMBIGUO":
            if match.carrier_code is not None:
                pending_reasons.append(
                    "A transportadora foi identificada, mas há mais de um motorista possível no cadastro."
                )
            else:
                pending_reasons.append(
                    "Há mais de um motorista com esse nome no cadastro; o vínculo precisa de conferência."
                )
        elif match.status != "VINCULADO":
            if match.carrier_code is not None:
                pending_reasons.append(
                    "A transportadora foi identificada, mas o motorista não foi encontrado no cadastro."
                )
            else:
                pending_reasons.append(
                    "Responsável não encontrado no cadastro de agregados ou transportadoras independentes."
                )
        pending_reason = " ".join(pending_reasons) or None
        status_calculation = (
            "CALCULADO"
            if (
                payload.valor_frete_bruto is not None
                and match.status == "VINCULADO"
            )
            else "PENDENTE_CONFERENCIA"
        )

        now = _utc_now()
        before = _freight_response(freight).model_dump(mode="json")
        matched_driver = match.person
        import_source = dict(import_source)
        import_source.update(
            {
                "nome_transportador_editado": payload.nome_transportador,
                "vinculo_responsavel_status": match.status,
                "vinculo_responsavel_criterio": match.basis,
                "vinculo_responsavel_correspondencia": match.name_match_type,
                "vinculo_responsavel_id_pessoa": (
                    matched_driver.id_pessoa if matched_driver else None
                ),
                "vinculo_responsavel_nome_cadastrado": (
                    matched_driver.nome_exibicao if matched_driver else None
                ),
                "vinculo_responsavel_modalidade": (
                    matched_driver.modalidade_terceirizada if matched_driver else None
                ),
                "vinculo_responsavel_transportadora": (
                    matched_driver.codigo_transportadora_independente
                    if matched_driver
                    else match.carrier_code
                ),
                "tipo_transporte_identificado": (
                    match.status == "VINCULADO" or match.carrier_code is not None
                ),
                "responsavel_vinculado_ao_cadastro": match.status == "VINCULADO",
                "motorista_selecionado_id": (
                    matched_driver.id_pessoa if matched_driver else None
                ),
                "rota_cidade_editada": payload.rota_cidade,
                "rota_cidade_status": route_match.status,
                "rota_cidade_criterio": route_match.basis,
                "rota_cidade_cadastrada": (
                    route_value if route_match.status == "VINCULADA" else None
                ),
                "km_inicial_editado": (
                    str(payload.km_inicial) if payload.km_inicial is not None else None
                ),
                "km_final_editado": (
                    str(payload.km_final) if payload.km_final is not None else None
                ),
                "km_rodado_editado": (
                    str(payload.km_rodado) if payload.km_rodado is not None else None
                ),
                "ultima_edicao_manual": {
                    "em": now.isoformat(),
                    "usuario": access.id_usuario,
                },
                "complemento_entregas": delivery_summary_snapshot,
            }
        )
        freight.tipo_transporte = str(transport_fields["tipo_transporte"])
        freight.nome_transportador = (
            str(transport_fields["nome_transportador"])
            if transport_fields["nome_transportador"] is not None
            else None
        )
        freight.id_motorista_agregado = (
            int(transport_fields["id_motorista_agregado"])
            if transport_fields["id_motorista_agregado"] is not None
            else None
        )
        freight.id_motorista_transportadora = (
            int(transport_fields["id_motorista_transportadora"])
            if transport_fields["id_motorista_transportadora"] is not None
            else None
        )
        freight.nome_motorista_transportadora = (
            str(transport_fields["nome_motorista_transportadora"])
            if transport_fields["nome_motorista_transportadora"] is not None
            else None
        )
        freight.codigo_fonte_tarifa = str(transport_fields["codigo_fonte_tarifa"])
        freight.data_servico = payload.data_servico
        freight.rota_cidade = route_value
        if transport_fields["tipo_transporte"] == "TRANSPORTADORA":
            freight.km_inicial = None
            freight.km_final = None
            freight.km_rodado = None
        else:
            freight.km_inicial = payload.km_inicial
            freight.km_final = payload.km_final
            freight.km_rodado = payload.km_rodado
        freight.quantidade_entregas = payload.quantidade_entregas
        freight.peso_kg = payload.peso_kg
        freight.valor_nota = payload.valor_nota
        freight.tipo_caminhao = (
            payload.tipo_caminhao
            if transport_fields["codigo_fonte_tarifa"] == "PAULO_CRUZ"
            else None
        )
        freight.codigo_zona_jit = (
            payload.codigo_zona_jit
            if transport_fields["codigo_fonte_tarifa"] == "JUST_IN_TIME"
            else None
        )
        freight.adicionais_jit = (
            payload.adicionais_jit
            if transport_fields["codigo_fonte_tarifa"] == "JUST_IN_TIME"
            else []
        )
        freight.valor_frete_bruto = payload.valor_frete_bruto
        freight.valor_avaria = payload.valor_avaria
        freight.quantidade_avarias = (
            int(delivery_summary[3])
            if delivery_summary is not None
            and delivery_summary[4] > 0
            and freight.quantidade_avarias == 0
            else freight.quantidade_avarias
        )
        freight.valor_frete_pago = paid
        freight.percentual_frete = ratio
        freight.status_calculo = status_calculation
        freight.motivo_pendencia = pending_reason
        freight.detalhe_calculo = {
            **freight.detalhe_calculo,
            "status": status_calculation,
            "metodo_calculo": "VALOR_HISTORICO_IMPORTADO",
            "fonte_tarifa": transport_fields["codigo_fonte_tarifa"],
            "carro_apoio": (
                payload.carro_apoio
                if transport_fields["codigo_fonte_tarifa"] == "PAULO_CRUZ"
                else None
            ),
            "percentual_frete": str(ratio) if ratio is not None else None,
            "motivo": pending_reason,
            "importacao_planilha": import_source,
            **({"calculo_tarifa_atual": historical_calculation} if historical_calculation else {}),
        }
        after = _freight_response(freight).model_dump(mode="json")
        db.add(
            FreteEvento(
                id_frete=freight.id_frete,
                id_usuario_ator=access.id_usuario,
                tipo_evento="FRETE_ATUALIZADO",
                ocorrido_em=now,
                detalhes={
                    "idempotency_key": str(idempotency_key),
                    "request_fingerprint": request_fingerprint,
                    "origem": "EDICAO_HISTORICA",
                    "antes": before,
                    "depois": after,
                },
            )
        )
        db.commit()
        db.refresh(freight)
        return _freight_response(freight)
    except (ConflictError, PermissionDeniedError, NotFoundError):
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A edição do frete histórico conflita com os dados cadastrados.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def cancel_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    justificativa: str,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> None:
    """Cancela sem apagar o frete e registra justificativa e snapshot na auditoria."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
            lock=True,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")

        events = repository.list_freight_events(db, id_frete=freight.id_frete)
        prior_event = next(
            (
                event
                for event in events
                if event.detalhes.get("idempotency_key") == str(idempotency_key)
            ),
            None,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "FRETE_CANCELADO"
                and prior_event.id_usuario_ator == access.id_usuario
                and prior_event.detalhes.get("justificativa") == justificativa
            ):
                return
            raise ConflictError("A chave de idempotência já foi utilizada.")
        if any(event.tipo_evento == "FRETE_CANCELADO" for event in events):
            raise ConflictError("Este frete já está cancelado.")

        now = _utc_now()
        db.add(
            FreteEvento(
                id_frete=freight.id_frete,
                id_usuario_ator=access.id_usuario,
                tipo_evento="FRETE_CANCELADO",
                ocorrido_em=now,
                detalhes={
                    "idempotency_key": str(idempotency_key),
                    "justificativa": justificativa,
                    "frete": _freight_response(freight).model_dump(mode="json"),
                },
            )
        )
        db.commit()
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O cancelamento conflita com uma ação já registrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_freights(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: TransportType | None,
    status_calculo: str | None,
    id_motorista: int | None = None,
    rota_cidade: str | None = None,
    codigo_transportadora: str | None = None,
    limit: int,
    offset: int,
) -> FreightPage:
    """Consulta lançamentos do setor com filtros de período e paginação."""
    try:
        sector_id = _transport_access(db, access)
        if data_de is not None and data_ate is not None and data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if codigo_transportadora is not None and tipo_transporte != "TRANSPORTADORA":
            raise ConflictError(
                "Selecione Transportadora independente antes de filtrar por empresa."
            )
        rows, total = repository.list_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            status_calculo=status_calculo,
            id_motorista=id_motorista,
            rota_cidade=rota_cidade,
            codigo_transportadora=codigo_transportadora,
            limit=limit,
            offset=offset,
        )
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete for freight in rows],
        )
        return FreightPage(
            items=[
                _freight_response(freight, cancellation=cancellations.get(freight.id_frete))
                for freight in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_freight_history_filter_options(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: TransportType | None,
) -> FreightHistoryFilterOptions:
    """Monta filtros a partir dos lançamentos de todo o intervalo selecionado."""
    try:
        sector_id = _transport_access(db, access)
        if data_de is not None and data_ate is not None and data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        rows = repository.list_freight_history_filter_values(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
        )
        driver_names: dict[int, str] = {}
        routes: set[str] = set()
        has_unlinked = False
        for (
            recorded_type,
            aggregate_driver_id,
            carrier_driver_id,
            transporter_name,
            carrier_driver_name,
            route,
            registered_driver_name,
        ) in rows:
            if recorded_type == "PROPRIO":
                continue
            driver_id = aggregate_driver_id or carrier_driver_id
            driver_name = registered_driver_name or (
                transporter_name
                if aggregate_driver_id is not None
                else carrier_driver_name
            )
            if driver_id is not None:
                driver_names.setdefault(
                    driver_id,
                    driver_name or f"Motorista #{driver_id}",
                )
            else:
                has_unlinked = True
            if route:
                routes.add(route)

        drivers = [
            FreightHistoryDriverOption(id_motorista=driver_id, nome_motorista=name)
            for driver_id, name in sorted(
                driver_names.items(),
                key=lambda entry: normalize_label(entry[1]),
            )
        ]
        if has_unlinked:
            drivers.append(
                FreightHistoryDriverOption(
                    id_motorista=0,
                    nome_motorista="Sem motorista cadastrado",
                )
            )
        return FreightHistoryFilterOptions(
            motoristas=drivers,
            rotas=sorted(routes, key=normalize_label),
            possui_sem_motorista=has_unlinked,
        )
    except (ConflictError, PermissionDeniedError, NotFoundError):
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def export_freight_history(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: TransportType | None,
    status_calculo: str | None,
    id_motorista: int | None,
    rota_cidade: str | None,
    codigo_transportadora: str | None,
) -> bytes:
    """Gera uma planilha completa para todos os registros que atendem aos filtros."""
    try:
        sector_id = _transport_access(db, access)
        if data_de is not None and data_ate is not None and data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if codigo_transportadora is not None and tipo_transporte != "TRANSPORTADORA":
            raise ConflictError(
                "Selecione Transportadora independente antes de filtrar por empresa."
            )

        records: list[Frete] = []
        offset = 0
        total = 0
        page_size = 500
        while offset == 0 or offset < total:
            page, total = repository.list_freights(
                db,
                id_setor=sector_id,
                data_de=data_de,
                data_ate=data_ate,
                tipo_transporte=tipo_transporte,
                status_calculo=status_calculo,
                id_motorista=id_motorista,
                rota_cidade=rota_cidade,
                codigo_transportadora=codigo_transportadora,
                limit=page_size,
                offset=offset,
            )
            records.extend(page)
            offset += len(page)
            if not page:
                break
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete for freight in records],
        )
    except (ConflictError, PermissionDeniedError, NotFoundError):
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Histórico"
    worksheet.sheet_view.showGridLines = False
    worksheet.sheet_view.zoomScale = 85
    workbook.properties.creator = "Portal de Logística"
    workbook.properties.title = "Histórico de Fretes"
    workbook.properties.subject = "Exportação dos lançamentos filtrados no histórico"

    headers = (
        "Data do serviço",
        "Modalidade",
        "Responsável",
        "Motorista da transportadora",
        "Rota / cidade",
        "Entregas",
        "Peso (kg)",
        "Valor da nota (R$)",
        "Quantidade de avarias",
        "Valor da avaria (R$)",
        "Frete bruto (R$)",
        "Percentual do frete",
        "Total líquido (R$)",
        "Situação do cálculo",
        "Motivo / pendência",
        "Situação do registro",
        "Justificativa de cancelamento",
        "Arquivo de origem",
        "Aba de origem",
        "Linha da planilha",
        "Criado em",
        "KM inicial",
        "KM final",
        "KM rodado",
        "Tipo de caminhão",
        "Carro de apoio",
        "Zona JUST IN TIME",
        "Adicionais JIT",
    )
    worksheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    title = worksheet.cell(row=1, column=1, value="Histórico de fretes")
    title.font = Font(name="Calibri", size=20, bold=True, color="FFFFFFFF")
    title.fill = PatternFill("solid", fgColor="FF17324D")
    title.alignment = Alignment(vertical="center")
    worksheet.row_dimensions[1].height = 34

    if data_de is not None and data_ate is not None:
        date_description = f"Período: {data_de:%d/%m/%Y} a {data_ate:%d/%m/%Y}"
    elif data_de is not None:
        date_description = f"Período: a partir de {data_de:%d/%m/%Y}"
    elif data_ate is not None:
        date_description = f"Período: até {data_ate:%d/%m/%Y}"
    else:
        date_description = "Período: todas as datas"
    filter_description = " · ".join(
        value
        for value in (
            date_description,
            f"Tipo: {tipo_transporte or 'todos'}",
            f"Status: {status_calculo or 'todos'}",
            f"Motorista ID: {id_motorista if id_motorista is not None else 'todos'}",
            f"Rota: {rota_cidade or 'todas'}",
            f"Transportadora: {codigo_transportadora or 'todas'}",
            f"Registros: {len(records)}",
        )
    )
    worksheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
    subtitle = worksheet.cell(row=2, column=1, value=filter_description)
    subtitle.font = Font(name="Calibri", size=10, color="FF536477", italic=True)
    subtitle.alignment = Alignment(vertical="center", wrap_text=True)
    worksheet.row_dimensions[2].height = 28

    header_fill = PatternFill("solid", fgColor="FF254B6E")
    white_bold = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
    header_border = Border(bottom=Side(style="medium", color="FF17324D"))
    for column, label in enumerate(headers, start=1):
        cell = worksheet.cell(row=3, column=column, value=label)
        cell.font = white_bold
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = header_border
    worksheet.row_dimensions[3].height = 34
    worksheet.freeze_panes = "A4"
    worksheet.auto_filter.ref = f"A3:{worksheet.cell(row=3, column=len(headers)).coordinate}{max(3, len(records) + 3)}"

    widths = (
        13, 22, 24, 25, 24, 11, 12, 16, 14, 16, 16, 17, 16, 21,
        34, 16, 32, 25, 14, 14, 19, 12, 12, 12, 18, 16, 18, 24,
    )
    for column, width in enumerate(widths, start=1):
        worksheet.column_dimensions[worksheet.cell(row=3, column=column).column_letter].width = width

    currency_columns = {8, 10, 11, 13}
    decimal_columns = {7, 22, 23, 24}
    center_columns = {1, 2, 6, 9, 12, 14, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27}
    for row_index, freight in enumerate(records, start=4):
        cancellation = cancellations.get(freight.id_frete)
        source_status, source_reason = effective_status(freight)
        type_label = {
            "AGREGADO": "Agregado",
            "TRANSPORTADORA": "Transportadora independente",
            "PROPRIO": "Frota própria",
        }.get(freight.tipo_transporte, freight.tipo_transporte)
        truck_label = {
            "SAVEIRO": "Saveiro",
            "KIA_BONGO": "Kia Bongo",
            "CAMINHAO_3_4": "Caminhão 3/4",
            "CAMINHAO_TOCO": "Caminhão toco",
        }.get(freight.tipo_caminhao or "", "")
        support_label = {
            "SAVEIRO": "Saveiro",
            "KIA_BONGO": "Bongo",
        }.get(str(freight.detalhe_calculo.get("carro_apoio") or ""), "")
        payment_amount = _payment_amount(freight)
        reason = source_reason or ""
        import_source = freight.detalhe_calculo.get("importacao_planilha")
        import_source = import_source if isinstance(import_source, dict) else {}
        values: tuple[object, ...] = (
            freight.data_servico,
            type_label,
            freight.nome_transportador,
            freight.nome_motorista_transportadora,
            freight.rota_cidade,
            freight.quantidade_entregas,
            freight.peso_kg,
            freight.valor_nota,
            freight.quantidade_avarias,
            freight.valor_avaria,
            freight.valor_frete_bruto,
            freight.percentual_frete,
            payment_amount,
            "Calculado" if source_status == "CALCULADO" else "Pendente de conferência",
            reason,
            "Cancelado" if cancellation else "Ativo",
            cancellation.detalhes.get("justificativa") if cancellation else None,
            import_source.get("arquivo"),
            import_source.get("aba"),
            import_source.get("linha"),
            freight.criado_em,
            "Não se aplica" if freight.tipo_transporte == "TRANSPORTADORA" else freight.km_inicial,
            "Não se aplica" if freight.tipo_transporte == "TRANSPORTADORA" else freight.km_final,
            "Não se aplica" if freight.tipo_transporte == "TRANSPORTADORA" else freight.km_rodado,
            truck_label,
            support_label,
            freight.codigo_zona_jit,
            ", ".join(freight.adicionais_jit or []),
        )
        fill = PatternFill(
            "solid",
            fgColor="FFF5F8FB" if row_index % 2 == 0 else "FFFFFFFF",
        )
        for column, value in enumerate(values, start=1):
            cell = worksheet.cell(row=row_index, column=column, value=value)
            cell.fill = fill
            cell.font = Font(name="Calibri", size=10, color="FF24364B")
            cell.alignment = Alignment(
                horizontal="center" if column in center_columns else "left",
                vertical="center",
                wrap_text=column in {3, 4, 5, 15, 17, 18, 27, 28},
            )
            if column in currency_columns:
                cell.number_format = '"R$" #,##0.00;[Red]-"R$" #,##0.00'
            elif column in decimal_columns:
                cell.number_format = "#,##0.000"
            elif column == 1:
                cell.number_format = "dd/mm/yyyy"
            elif column == 12:
                cell.number_format = "0.000%"
            elif column == 21:
                cell.number_format = "dd/mm/yyyy hh:mm"
            if column == 14 and source_status != "CALCULADO":
                cell.font = Font(name="Calibri", size=10, bold=True, color="FF99610E")
            if column == 16 and cancellation:
                cell.font = Font(name="Calibri", size=10, bold=True, color="FF9D413B")
        worksheet.row_dimensions[row_index].height = 24

    worksheet.sheet_properties.pageSetUpPr.fitToPage = True
    worksheet.page_setup.orientation = "landscape"
    worksheet.page_setup.paperSize = worksheet.PAPERSIZE_A3
    worksheet.page_setup.fitToWidth = 1
    worksheet.page_setup.fitToHeight = 0
    worksheet.page_margins = PageMargins(
        left=0.25, right=0.25, top=0.5, bottom=0.5, header=0.2, footer=0.2
    )

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_payment_report(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> FreightPaymentReport:
    """Consolida por período, modalidade e responsável os fretes de terceiros."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if sem_identificacao and tipo_transporte != "AGREGADO":
            raise ConflictError("A opção sem identificação só se aplica aos agregados.")
        if sem_identificacao and nome_transportador is not None:
            raise ConflictError("Escolha um nome ou a opção sem identificação, não ambos.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
        records = _remove_relaunched_historical_duplicates(records)
        return _payment_report_from_records(
            records,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def build_payment_options(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
) -> FreightPaymentOptions:
    """Lista os responsáveis que têm lançamentos de pagamento no período."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
        )
        aggregate_names = {
            freight.nome_transportador
            for freight in records
            if freight.tipo_transporte == "AGREGADO" and freight.nome_transportador
        }
        carrier_names = {
            freight.nome_transportador
            for freight in records
            if freight.tipo_transporte == "TRANSPORTADORA" and freight.nome_transportador
        }
        return FreightPaymentOptions(
            agregados=sorted(aggregate_names, key=str.casefold),
            transportadoras=sorted(carrier_names, key=str.casefold),
            agregados_sem_identificacao=any(
                freight.tipo_transporte == "AGREGADO" and freight.nome_transportador is None
                for freight in records
            ),
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def _historical_import_source(freight: Frete) -> dict[str, object] | None:
    detail = freight.detalhe_calculo or {}
    source = detail.get("importacao_planilha")
    if (
        detail.get("metodo_calculo") != "VALOR_HISTORICO_IMPORTADO"
        or not isinstance(source, dict)
    ):
        return None
    return source


def _payment_responsible_id(freight: Frete) -> int | None:
    if freight.tipo_transporte == "AGREGADO":
        return freight.id_motorista_agregado
    if freight.tipo_transporte == "TRANSPORTADORA":
        return freight.id_motorista_transportadora
    return None


def _payment_route_key(route: str | None) -> str:
    normalized = normalize_label(route or "")
    if normalized in {"BUZIOS", "ARMACAO DOS BUZIOS", "ARMACAO DE BUZIOS"}:
        return "BUZIOS"
    return normalized


def _payment_match_key(freight: Frete) -> tuple[object, ...] | None:
    responsible_id = _payment_responsible_id(freight)
    if (
        responsible_id is None
        or not freight.rota_cidade
        or freight.peso_kg is None
        or freight.valor_nota is None
    ):
        return None
    return (
        freight.id_setor,
        freight.data_servico,
        freight.tipo_transporte,
        freight.codigo_fonte_tarifa,
        responsible_id,
        _payment_route_key(freight.rota_cidade),
        freight.peso_kg,
        freight.valor_nota,
    )


def _same_relaunched_historical_freight(historical: Frete, launched: Frete) -> bool:
    """Confere uma correspondência operacional forte sem confundir rotas do mesmo dia."""
    source = _historical_import_source(historical)
    if source is None or _historical_import_source(launched) is not None:
        return False
    historical_responsible = _payment_responsible_id(historical)
    if (
        historical_responsible is None
        or historical_responsible != _payment_responsible_id(launched)
        or historical.id_setor != launched.id_setor
        or historical.data_servico != launched.data_servico
        or historical.tipo_transporte != launched.tipo_transporte
        or historical.codigo_fonte_tarifa != launched.codigo_fonte_tarifa
        or _payment_route_key(historical.rota_cidade)
        != _payment_route_key(launched.rota_cidade)
        or historical.peso_kg is None
        or historical.valor_nota is None
        or historical.peso_kg != launched.peso_kg
        or historical.valor_nota != launched.valor_nota
    ):
        return False

    launched_status, _ = effective_status(launched)
    if (
        launched_status != "CALCULADO"
        or launched.valor_frete_bruto is None
        or _payment_amount(launched) is None
    ):
        return False

    missing_source_fields = source.get("campos_nao_informados")
    missing = set(missing_source_fields) if isinstance(missing_source_fields, list) else set()
    for field_name in (
        "valor_avaria",
        "valor_frete_bruto",
        "valor_frete_pago",
    ):
        historical_value = getattr(historical, field_name)
        if historical_value is not None and field_name not in missing:
            if historical_value != getattr(launched, field_name):
                return False
    if (
        historical.tipo_caminhao is not None
        and historical.tipo_caminhao != launched.tipo_caminhao
    ):
        return False
    if (
        historical.tipo_transporte == "AGREGADO"
        and historical.km_rodado is not None
        and historical.km_rodado != launched.km_rodado
    ):
        return False
    return True


def _remove_relaunched_historical_duplicates(records: list[Frete]) -> list[Frete]:
    """Conta uma vez quando há um relançamento completo e inequívoco."""
    imported = [freight for freight in records if _historical_import_source(freight) is not None]
    launched = [freight for freight in records if _historical_import_source(freight) is None]
    launches_by_key: dict[tuple[object, ...], list[Frete]] = {}
    for candidate in launched:
        status, _ = effective_status(candidate)
        if (
            status != "CALCULADO"
            or candidate.valor_frete_bruto is None
            or _payment_amount(candidate) is None
        ):
            continue
        key = _payment_match_key(candidate)
        if key is not None:
            launches_by_key.setdefault(key, []).append(candidate)

    matches_by_historical = {
        historical.id_frete: [
            candidate
            for candidate in launches_by_key.get(_payment_match_key(historical), [])
            if _same_relaunched_historical_freight(historical, candidate)
        ]
        for historical in imported
    }
    historical_matches_by_launch: dict[int, int] = {}
    for matches in matches_by_historical.values():
        for candidate in matches:
            candidate_id = candidate.id_frete
            historical_matches_by_launch[candidate_id] = (
                historical_matches_by_launch.get(candidate_id, 0) + 1
            )
    superseded = {
        historical_id
        for historical_id, matches in matches_by_historical.items()
        if (
            len(matches) == 1
            and historical_matches_by_launch.get(matches[0].id_frete) == 1
        )
    }
    if not superseded:
        return records
    return [freight for freight in records if freight.id_frete not in superseded]


def _payment_report_from_records(
    records: list[Frete],
    *,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> FreightPaymentReport:
    """Soma lançamentos já filtrados e registra os critérios no resultado."""
    pending_items: list[FreightPaymentPending] = []
    warning_items: list[FreightPaymentWarning] = []
    gross_total = Decimal("0")
    damage_total = Decimal("0")
    net_total = Decimal("0")

    for freight in records:
        status, reason = effective_status(freight)
        payment_amount = _payment_amount(freight)
        imported_source = _historical_import_source(freight)
        imported_responsible_is_clear = (
            imported_source is not None
            and bool((freight.nome_transportador or "").strip())
            and imported_source.get("tipo_transporte_identificado") is not False
            and not (
                freight.tipo_transporte == "AGREGADO"
                and imported_source.get("vinculo_responsavel_status") == "AMBIGUO"
            )
        )
        payment_is_ready = payment_amount is not None and (
            status == "CALCULADO" or imported_responsible_is_clear
        )
        if not payment_is_ready:
            pending_items.append(FreightPaymentPending(
                codigo_frete=UUID(freight.codigo_frete),
                data_servico=freight.data_servico,
                nome_transportador=freight.nome_transportador,
                rota_cidade=freight.rota_cidade,
                valor_frete_bruto=freight.valor_frete_bruto,
                valor_avaria=freight.valor_avaria,
                valor_frete_pago=payment_amount,
                motivo_pendencia=reason or (
                    "Valor líquido do frete não informado." if payment_amount is None
                    else "Frete aguardando conferência."
                ),
            ))
            continue

        warning = _historical_payment_warning(freight)
        if warning is not None:
            warning_items.append(warning)

        gross = freight.valor_frete_bruto or Decimal("0")
        damage = freight.valor_avaria
        net = payment_amount
        gross_total += gross
        damage_total += damage
        net_total += net

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
        valor_frete_bruto=gross_total,
        valor_avarias=damage_total,
        valor_a_pagar=net_total,
    )


def export_payment_report(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> bytes:
    """Gera a solicitação XLSX no formato da planilha usada pela operação."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if sem_identificacao and tipo_transporte != "AGREGADO":
            raise ConflictError("A opção sem identificação só se aplica aos agregados.")
        if sem_identificacao and nome_transportador is not None:
            raise ConflictError("Escolha um nome ou a opção sem identificação, não ambos.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
        records = _remove_relaunched_historical_duplicates(records)
        report = _payment_report_from_records(
            records,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc

    if report.quantidade_pendentes:
        raise ConflictError(
            "Resolva os fretes pendentes de conferência antes de exportar o pagamento."
        )

    grouped: dict[str, dict[str, object]] = {}
    for freight in records:
        # Pendências são bloqueadas acima; mantenha a proteção caso a regra mude.
        payment_amount = _payment_amount(freight)
        if payment_amount is None:
            continue
        responsible = freight.nome_transportador or "Sem identificação"
        row = grouped.setdefault(
            responsible,
            {
                "days": set(),
                "net": Decimal("0"),
            },
        )
        days = row["days"]
        assert isinstance(days, set)
        days.add(freight.data_servico)
        row["net"] = Decimal(row["net"]) + payment_amount

    workbook = Workbook()
    worksheet = workbook.active
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
    currency_format = r'_-[$R$-416]\ * #,##0.00_-;\-[$R$-416]\ * #,##0.00_-;_-[$R$-416]\ * "-"??_-;_-@_-'

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
        if cell.column <= 6:
            cell.fill = PatternFill("solid", fgColor=medium_gray)
            cell.border = Border(left=medium, right=medium, top=medium, bottom=medium)
    worksheet["A2"] = "Data"
    worksheet["A2"].font = Font(name="Calibri", size=11, bold=True, color=white)
    worksheet["A2"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet["C2"] = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
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
    data_end = data_start + len(grouped) - 1
    data_slot_end = max(23, data_end)
    payment_reason = "AGREGADO" if tipo_transporte == "AGREGADO" else "TRANSPORTADORA"

    for offset, (responsible, values) in enumerate(
        sorted(grouped.items(), key=lambda item: item[0].casefold())
    ):
        row_index = data_start + offset
        service_days = values["days"]
        assert isinstance(service_days, set)
        net = Decimal(values["net"])
        days_label = "DIA" if len(service_days) == 1 else "DIAS"
        values_for_row: tuple[object, ...] = (
            responsible,
            None,  # O cadastro de pessoas do Portal não armazena CPF.
            f"{payment_reason} TOTAL DE {len(service_days)} {days_label}",
            "TRANSPORTE",
            net,
            "",
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
