"""Leitura do retrato das tabelas de tarifa recebidas para o primeiro corte."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any

JUST_IN_TIME_ZONE_GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "RIO_DE_JANEIRO",
        "Rio de Janeiro",
        (
            "ZONA_OESTE_1",
            "ZONA_OESTE_2",
            "ZONA_SUL",
            "BAIXADA_FLUMINENSE",
            "ZONA_NORTE_1",
            "ZONA_NORTE_2",
        ),
    ),
    (
        "REGIAO_SERRANA",
        "Região Serrana",
        ("REGI_O_SERRANA_1", "REGI_O_SERRANA_2"),
    ),
    (
        "COSTA_VERDE",
        "Costa Verde",
        ("COSTA_VERDE_1", "COSTA_VERDE_2"),
    ),
    (
        "VALE_DO_PARAIBA",
        "Vale do Paraíba",
        ("VALE_DO_PARAIBA1", "VALE_DO_PARAIBA_2"),
    ),
)


@lru_cache(maxsize=1)
def tariff_data() -> dict[str, Any]:
    """Carrega uma vez o retrato JSON e calcula seu hash para rastreabilidade."""
    path = Path(__file__).with_name("initial_tariffs.json")
    content = path.read_bytes()
    data = json.loads(content)
    data["snapshot_hash"] = sha256(content).hexdigest()
    return data


def normalize_label(value: str) -> str:
    """Remove acentos e uniformiza espaços/caixa para comparar nomes de rota."""
    ascii_value = unicodedata.normalize("NFKD", value.strip())
    ascii_value = "".join(char for char in ascii_value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", ascii_value).upper()


def just_in_time_zone_codes() -> frozenset[str]:
    """Códigos de tarifas JIT permitidos nas regiões atualmente atendidas."""
    return frozenset(
        code
        for _, _, zone_codes in JUST_IN_TIME_ZONE_GROUPS
        for code in zone_codes
    )


def tariff_options() -> dict[str, object]:
    """Monta as opções que o formulário precisa sem expor dados pessoais."""
    data = tariff_data()
    jit = data["just_in_time"]
    zones_by_code = {zone["code"]: zone for zone in jit["zones"]}
    additional_headers = jit["additional_tiers"][0]["rates"] if jit["additional_tiers"] else {}
    additional_options = [
        {"codigo": normalize_label(label).replace(" ", "_"), "nome": label}
        for label in additional_headers
    ]
    return {
        "fontes": [
            {"codigo": "AGREGADOS_CD", "nome": "Agregados CD"},
            {"codigo": "JUST_IN_TIME", "nome": "JUST IN TIME"},
            {"codigo": "PAULO_CRUZ", "nome": "Paulo Cruz"},
        ],
        "rotas_agregados_cd": [
            {"codigo": "RIO DAS OSTRAS", "nome": "Rio das Ostras"},
            {"codigo": "MACAE", "nome": "Macaé"},
            {"codigo": "MACAE SERRA", "nome": "Macaé Serra"},
            {"codigo": "CABO FRIO", "nome": "Cabo Frio"},
            {"codigo": "ARMACAO DOS BUZIOS", "nome": "Armação dos Búzios"},
            {"codigo": "SAO PEDRO DA ALDEIA", "nome": "São Pedro da Aldeia"},
            {"codigo": "ARRAIAL DO CABO", "nome": "Arraial do Cabo"},
            {"codigo": "ARARUAMA", "nome": "Araruama"},
            {"codigo": "CAMPOS", "nome": "Campos"},
        ],
        "zonas_just_in_time": [
            {
                "codigo": region_code,
                "nome": region_name,
                "subzonas": [
                    {
                        "codigo": zones_by_code[zone_code]["code"],
                        "nome": zones_by_code[zone_code]["label"],
                        "areas": zones_by_code[zone_code]["area"],
                    }
                    for zone_code in zone_codes
                    if zone_code in zones_by_code
                ],
            }
            for region_code, region_name, zone_codes in JUST_IN_TIME_ZONE_GROUPS
        ],
        "adicionais_just_in_time": additional_options,
        "tipos_caminhao_paulo_cruz": [
            {"codigo": "SAVEIRO", "nome": "Saveiro"},
            {"codigo": "KIA_BONGO", "nome": "Kia Bongo"},
            {"codigo": "CAMINHAO_3_4", "nome": "Caminhão 3/4"},
            {"codigo": "CAMINHAO_TOCO", "nome": "Caminhão toco"},
        ],
        "retrato_tarifas_em": data["snapshot_date"],
        "hash_retrato_tarifas": data["snapshot_hash"],
    }
