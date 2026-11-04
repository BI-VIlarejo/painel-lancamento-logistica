"""Exemplos financeiros, limites das planilhas e contratos de entrada."""

from copy import deepcopy
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch

from freight_support import payload
from pydantic import ValidationError

from app.modules.fretes.calculator import calculate_freight
from app.modules.fretes.tariff_catalog import tariff_data


class FreightCalculatorTests(TestCase):
    def test_approved_aggregate_rates_and_odometer_distance(self):
        for city, expected in (("Rio das Ostras", "496.00"), ("  Macaé  ", "358.00")):
            with self.subTest(city=city):
                result = calculate_freight(payload(rota_cidade=city))
                self.assertEqual(result.status, "CALCULADO")
                self.assertEqual(result.valor_frete_bruto, Decimal(expected))
                self.assertEqual(result.detalhe["parametros"]["percentual_nota"], "0.012")
                self.assertEqual(len(result.detalhe["hash_retrato_tarifas"]), 64)

    def test_rounds_sum_to_cents_without_inventing_minimum(self):
        result = calculate_freight(payload(km_final="100", peso_kg="0.25", valor_nota="0"))
        self.assertEqual(result.valor_frete_bruto, Decimal("0.02"))
        self.assertIsNone(result.percentual_frete)

    def test_unknown_or_composite_route_and_missing_invoice_stay_pending(self):
        for changes in ({"rota_cidade": "Macaé / Cabo Frio"}, {"valor_nota": None}):
            with self.subTest(changes=changes):
                result = calculate_freight(payload(**changes))
                self.assertEqual(result.status, "PENDENTE_CONFERENCIA")
                self.assertIsNone(result.valor_frete_bruto)

    def test_new_launch_rejects_own_fleet_modality(self):
        with self.assertRaises(ValidationError):
            payload(
                tipo_transporte="PROPRIO",
                codigo_fonte_tarifa=None,
                nome_transportador="Veículo de teste",
            )

    def test_paulo_cruz_requires_confirmed_weight_bounds(self):
        cases = [
            ("SAVEIRO", "500", None),
            ("KIA_BONGO", "1000", None),
            ("CAMINHAO_3_4", "1500", "950.00"),
            ("CAMINHAO_3_4", "4000", "950.00"),
            ("CAMINHAO_3_4", "4000.001", None),
            ("CAMINHAO_TOCO", "4001", "1100.00"),
            ("CAMINHAO_TOCO", "9000", "1100.00"),
            ("CAMINHAO_TOCO", "9000.001", None),
        ]
        for truck, weight, expected in cases:
            with self.subTest(truck=truck, weight=weight):
                result = calculate_freight(
                    payload(
                        tipo_transporte="TRANSPORTADORA",
                        nome_transportador="Paulo Cruz",
                        codigo_fonte_tarifa="PAULO_CRUZ",
                        tipo_caminhao=truck,
                        peso_kg=weight,
                    )
                )
                self.assertEqual(result.valor_frete_bruto, Decimal(expected) if expected else None)
                self.assertEqual(result.status, "CALCULADO" if expected else "PENDENTE_CONFERENCIA")

    def jit(self, **changes):
        values = dict(
            tipo_transporte="TRANSPORTADORA",
            nome_transportador="JUST IN TIME",
            codigo_fonte_tarifa="JUST_IN_TIME",
            codigo_zona_jit="ZONA_OESTE_1",
            peso_kg="60",
        )
        return payload(**(values | changes))

    def test_jit_calculates_unique_tier_and_invoice_ratio(self):
        result = calculate_freight(self.jit())
        self.assertEqual(result.valor_frete_bruto, Decimal("120.00"))
        self.assertEqual(result.percentual_frete, Decimal("0.012000"))

    def test_jit_overlapping_limits_and_gaps_are_pending(self):
        for weight in ("50.5", "100", "500", "3500", "12001"):
            with self.subTest(weight=weight):
                result = calculate_freight(self.jit(peso_kg=weight))
                self.assertEqual(result.status, "PENDENTE_CONFERENCIA")

    def test_jit_multiple_additions_unknown_additions_and_missing_tiers_are_pending(self):
        for changes in (
            {"adicionais_jit": ["ESCADA", "RAMPA"]},
            {"adicionais_jit": ["INEXISTENTE"]},
            {"adicionais_jit": ["ESCADA"], "peso_kg": "1100"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(
                    calculate_freight(self.jit(**changes)).status, "PENDENTE_CONFERENCIA"
                )

    def test_jit_empty_price_is_pending_instead_of_an_exception(self):
        tariffs = deepcopy(tariff_data())
        tariffs["just_in_time"]["zones"][0]["tiers"][1]["price"] = None
        with patch("app.modules.fretes.calculator.tariff_data", return_value=tariffs):
            self.assertEqual(calculate_freight(self.jit()).status, "PENDENTE_CONFERENCIA")

    def test_invalid_readings_precision_and_modalities_are_rejected(self):
        for changes in (
            {"km_final": "99"},
            {"km_inicial": "-1"},
            {"peso_kg": "NaN"},
            {"peso_kg": "1.0001"},
            {"valor_nota": "1.001"},
            {"quantidade_entregas": -1},
            {"id_motorista_agregado": None},
            {"codigo_fonte_tarifa": "PAULO_CRUZ"},
            {"adicionais_jit": ["ESCADA", " escada "]},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                payload(**changes)
