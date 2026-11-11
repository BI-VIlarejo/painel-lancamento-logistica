"""Cálculo de frete com as tarifas e fórmulas encontradas nas planilhas."""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from .schemas import FreightInput, FreightStatus
from .tariff_catalog import just_in_time_zone_codes, normalize_label, tariff_data

CENT = Decimal("0.01")


@dataclass(frozen=True)
class FreightCalculation:
    """Resultado imutável do cálculo, ou pendência que precisa de revisão."""

    status: FreightStatus
    valor_frete_bruto: Decimal | None
    percentual_frete: Decimal | None
    motivo_pendencia: str | None
    detalhe: dict[str, object]


def _decimal(value: Any) -> Decimal:
    """Converte tarifas do JSON para Decimal sem operar com float diretamente."""
    return Decimal(str(value))


def _money(value: Decimal) -> Decimal:
    """Arredonda valores monetários para centavos com regra comercial usual."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _pending(reason: str, detail: dict[str, object]) -> FreightCalculation:
    """Cria um resultado sem valor a pagar quando os dados são ambíguos."""
    return FreightCalculation(
        status="PENDENTE_CONFERENCIA",
        valor_frete_bruto=None,
        percentual_frete=None,
        motivo_pendencia=reason,
        detalhe={**detail, "status": "PENDENTE_CONFERENCIA", "motivo": reason},
    )


def calculate_freight(payload: FreightInput) -> FreightCalculation:
    """Seleciona a tabela, calcula o bruto e anexa a versão das tarifas usadas."""
    data = tariff_data()
    base_detail: dict[str, object] = {
        "retrato_tarifas_em": data["snapshot_date"],
        "hash_retrato_tarifas": data["snapshot_hash"],
        "arquivos_origem": data["sources"],
        "fonte_tarifa": payload.codigo_fonte_tarifa,
        "tipo_transporte": payload.tipo_transporte,
    }

    if payload.codigo_fonte_tarifa == "PAULO_CRUZ":
        base_detail["carro_apoio"] = payload.carro_apoio

    if payload.codigo_fonte_tarifa == "AGREGADOS_CD":
        calculation = _calculate_aggregados_cd(payload, data, base_detail)
    elif payload.codigo_fonte_tarifa == "JUST_IN_TIME":
        calculation = _calculate_just_in_time(payload, data, base_detail)
    elif payload.codigo_fonte_tarifa == "PAULO_CRUZ":
        calculation = _calculate_paulo_cruz(payload, data, base_detail)
    else:
        return _pending(
            "Selecione uma fonte tarifária para este transporte terceirizado.",
            base_detail,
        )

    if (
        calculation.status == "CALCULADO"
        and calculation.valor_frete_bruto is not None
        and calculation.percentual_frete is None
        and payload.valor_nota is not None
        and payload.valor_nota != 0
    ):
        ratio = (calculation.valor_frete_bruto / payload.valor_nota).quantize(Decimal("0.000001"))
        detail = {**calculation.detalhe, "percentual_frete": str(ratio)}
        calculation = replace(calculation, percentual_frete=ratio, detalhe=detail)
    return calculation


def _calculate_aggregados_cd(
    payload: FreightInput,
    data: dict[str, Any],
    base_detail: dict[str, object],
) -> FreightCalculation:
    """Aplica percentual da nota, tarifa por kg e tarifa por km da aba escolhida."""
    city = normalize_label(payload.rota_cidade)
    route_to_sheet = {
        "RIO DAS OSTRAS": "RO",
        "MACAE": "MC",
        "MACAE SERRA": "MC S",
        "CABO FRIO": "CF",
        "BUZIOS": "CF",
        "ARMACAO DOS BUZIOS": "CF",
        "ARMACAO DE BUZIOS": "CF",
        "SAO PEDRO DA ALDEIA": "CF",
        "ARRAIAL DO CABO": "CF",
        "ARARUAMA": "AR",
        "CAMPOS": "CP",
    }
    sheet = route_to_sheet.get(city)
    if sheet is None:
        return _pending(
            "A rota ainda não está associada a uma aba de tarifa Agregados CD.",
            {**base_detail, "rota_cidade": payload.rota_cidade},
        )

    km = payload.km_rodado
    weight = payload.peso_kg
    invoice = payload.valor_nota
    if km is None:
        return _pending(
            "Informe o hodômetro para calcular a tarifa Agregados CD.",
            {**base_detail, "aba_tarifa": sheet},
        )
    if invoice is None:
        return _pending(
            "Informe o valor da nota para calcular a tarifa Agregados CD.",
            {**base_detail, "aba_tarifa": sheet},
        )

    rates = data["aggregados_cd"][sheet]
    percent = _decimal(rates["percent_invoice"])
    per_km = _decimal(rates["per_km"])
    per_kg = _decimal(rates["per_kg"])
    invoice_component = invoice * percent
    weight_component = weight * per_kg
    distance_component = km * per_km
    gross = _money(invoice_component + weight_component + distance_component)
    ratio = (gross / invoice).quantize(Decimal("0.000001")) if invoice else None
    detail: dict[str, object] = {
        **base_detail,
        "status": "CALCULADO",
        "aba_tarifa": sheet,
        "formula": (
            "(valor_nota × percentual) + (peso_kg × valor_por_kg) + (km_rodado × valor_por_km)"
        ),
        "parametros": {
            "percentual_nota": str(percent),
            "valor_por_km": str(per_km),
            "valor_por_kg": str(per_kg),
            "frete_minimo": rates["freight_min_value"],
            "celulas_da_formula": rates["formula_cells"],
        },
        "componentes": {
            "nota": str(_money(invoice_component)),
            "peso": str(_money(weight_component)),
            "distancia": str(_money(distance_component)),
        },
    }
    return FreightCalculation("CALCULADO", gross, ratio, None, detail)


def _calculate_just_in_time(
    payload: FreightInput,
    data: dict[str, Any],
    base_detail: dict[str, object],
) -> FreightCalculation:
    """Resolve a zona e faixa JIT; só calcula quando há uma única tarifa aplicável."""
    jit = data["just_in_time"]
    zone = next(
        (
            item
            for item in jit["zones"]
            if item["code"] == payload.codigo_zona_jit
            and item["code"] in just_in_time_zone_codes()
        ),
        None,
    )
    if zone is None:
        return _pending("Selecione uma zona válida da tabela JUST IN TIME.", base_detail)

    matches = [
        tier
        for tier in zone["tiers"]
        if _decimal(tier["min_kg"]) <= payload.peso_kg <= _decimal(tier["max_kg"])
    ]
    detail: dict[str, object] = {
        **base_detail,
        "zona": zone["label"],
        "areas_da_zona": zone["area"],
        "peso_kg": str(payload.peso_kg),
    }
    if len(matches) != 1:
        return _pending(
            "A faixa de peso não tem um único valor aplicável na tabela JUST IN TIME.",
            {**detail, "faixas_correspondentes": [item["label"] for item in matches]},
        )

    selected_additions = list(payload.adicionais_jit)
    if len(selected_additions) > 1:
        return _pending(
            (
                "A tabela JUST IN TIME pede negociação quando mais de um "
                "adicional ocorre no mesmo local."
            ),
            {**detail, "adicionais": selected_additions},
        )

    if matches[0].get("price") is None:
        return _pending("A faixa selecionada não tem uma tarifa preenchida.", detail)
    base_value = _decimal(matches[0]["price"])
    addition_value = Decimal("0")
    addition_label = None
    if selected_additions:
        addition_code = selected_additions[0]
        addition_tiers = [
            tier
            for tier in jit["additional_tiers"]
            if tier.get("min_kg") is not None
            and tier.get("max_kg") is not None
            and _decimal(tier["min_kg"]) <= payload.peso_kg <= _decimal(tier["max_kg"])
        ]
        if len(addition_tiers) != 1:
            return _pending(
                "O adicional selecionado não tem uma única faixa de peso aplicável.",
                {**detail, "faixas_adicional": [item["label"] for item in addition_tiers]},
            )
        rate_map = addition_tiers[0]["rates"]
        rate_label = next(
            (
                label
                for label in rate_map
                if normalize_label(label).replace(" ", "_") == addition_code
            ),
            None,
        )
        if rate_label is None or rate_map[rate_label] is None:
            return _pending("O adicional selecionado não tem uma tarifa preenchida.", detail)
        addition_label = rate_label
        addition_value = _decimal(rate_map[rate_label])

    gross = _money(base_value + addition_value)
    detail.update(
        {
            "status": "CALCULADO",
            "formula": "frete_base_da_zona_e_faixa + um_adicional_selecionado",
            "faixa_peso": matches[0]["label"],
            "frete_base": str(base_value),
            "adicional": {"nome": addition_label, "valor": str(addition_value)},
            "armazenagem": (
                "fora do cálculo do controle de fretes; valores variáveis não preenchidos"
            ),
        }
    )
    return FreightCalculation("CALCULADO", gross, None, None, detail)


def _calculate_paulo_cruz(
    payload: FreightInput,
    data: dict[str, Any],
    base_detail: dict[str, object],
) -> FreightCalculation:
    """Aplica o valor fixo do veículo, independentemente da rota e do peso."""
    vehicle_names = {
        "SAVEIRO": "Saveiro",
        "KIA_BONGO": "Kia Bongo",
        "CAMINHAO_3_4": "Caminhão 3/4",
        "CAMINHAO_TOCO": "Caminhão toco",
    }
    selected_name = vehicle_names.get(payload.tipo_caminhao or "")
    vehicle = next(
        (
            item
            for item in data["paulo_cruz"]
            if selected_name and normalize_label(item["vehicle"]) == normalize_label(selected_name)
        ),
        None,
    )
    if vehicle is None or selected_name is None:
        return _pending("Selecione um tipo de caminhão da tabela Paulo Cruz.", base_detail)
    base_value = _decimal(vehicle["price"])
    support_name = {"SAVEIRO": "Saveiro", "KIA_BONGO": "Kia Bongo"}.get(payload.carro_apoio)
    support = next((item for item in data["paulo_cruz"] if item["vehicle"] == support_name), None)
    support_value = _decimal(support["price"]) if support else Decimal("0")
    gross = _money(base_value + support_value)
    detail: dict[str, object] = {
        **base_detail,
        "status": "CALCULADO",
        "tipo_caminhao": payload.tipo_caminhao,
        "formula": "frete_fixo_por_tipo_de_caminhao + carro_de_apoio",
        "faixa_de_peso": vehicle["weight_label"],
        "valor_fixo": str(_money(base_value)),
        "valor_carro_apoio": str(_money(support_value)),
    }
    return FreightCalculation("CALCULADO", gross, None, None, detail)
