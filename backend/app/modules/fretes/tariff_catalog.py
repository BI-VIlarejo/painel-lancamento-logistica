"""Leitura do retrato das tabelas de tarifa recebidas para o primeiro corte."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any


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


def tariff_options() -> dict[str, object]:
    """Monta as opções que o formulário precisa sem expor dados pessoais."""
    data = tariff_data()
    jit = data["just_in_time"]
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
            {"codigo": "BUZIOS", "nome": "Búzios"},
            {"codigo": "SAO PEDRO DA ALDEIA", "nome": "São Pedro da Aldeia"},
            {"codigo": "ARRAIAL DO CABO", "nome": "Arraial do Cabo"},
            {"codigo": "ARARUAMA", "nome": "Araruama"},
            {"codigo": "CAMPOS", "nome": "Campos"},
        ],
        "zonas_just_in_time": [
            {"codigo": zone["code"], "nome": zone["label"], "areas": zone["area"]}
            for zone in jit["zones"]
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
